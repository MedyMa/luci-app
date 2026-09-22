#!/bin/bash
# rpcd-selftest.sh - offline regression for luci-app-traffic's rpcd backend.
#
# The page talks to the backend over ubus, and rpcd invokes a plugin as
#
#     <script> list                 # enumerate the methods
#     <script> call <method>        # with the arguments as JSON on stdin
#
# The method name is therefore the second argument and is NOT part of the stdin
# object.  Reading it out of that object instead (which is what the backend did)
# matches nothing, falls through to the default branch, and answers every single
# call with {"error":"unknown method"} - while the object itself looks healthy
# and `list` looks correct, so nothing anywhere reports a problem.  That is
# exactly what the LuCI page received, and why a working collector showed no
# data at all.  This file asserts the contract directly.
#
#   bash rpcd-selftest.sh
set -u

SELF="$(cd "$(dirname "$0")" && pwd)"
# RPCD_SRC points the same assertions at another revision of the backend: an
# assertion that cannot be made to fail on the code it was written against
# proves nothing, and the only honest way to check that is to run it there.
RPCD="${RPCD_SRC:-$(cd "$SELF/.." && pwd)/root/usr/libexec/rpcd/luci.traffic}"
[ -f "$RPCD" ] || { echo "luci.traffic not found next to $SELF" >&2; exit 1; }

echo "=== sh -n ==="
if ! sh -n "$RPCD"; then
    echo "FAIL: luci.traffic does not parse - aborting" >&2
    exit 1
fi
echo "luci.traffic syntax OK"

echo
echo "=== 分派契约 ==="
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

# A minimal jshn stand-in.  json_add_string prints what it was given, which is
# enough to tell which branch of the dispatch ran.  json_get_var answers from
# STUB_<key> so the test can feed a parameter in without a JSON parser, which is
# how the range and hour plumbing gets exercised.
cat > "$T/jshn.sh" <<'EOF'
json_init() { :; }
json_load() { :; }
json_get_var() {
	local v
	eval "v=\${STUB_$2:-}"
	eval "$1=\$v"
}
json_add_object() { :; }
json_close_object() { :; }
json_add_boolean() { :; }
json_add_string() { printf 'OUT:%s=%s\n' "$1" "$2"; }
json_dump() { :; }
json_cleanup() { :; }
EOF

sed "s#^\. /usr/share/libubox/jshn\.sh#. $T/jshn.sh#" "$RPCD" > "$T/lt.sh"

mkdir -p "$T/state"
printf '{"collected_at":123,"flows":7,"apps":[{"name":"X","down":1,"up":2}]}\n' > "$T/state/summary.json"

fail=0
chk() { if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (expect '$2', got '$3')"; fail=1; fi; }

got=$(STATE_DIR="$T/state" sh "$T/lt.sh" call getSummary < /dev/null)
chk "1 call getSummary 返回快照原文"       '{"collected_at":123,"flows":7,"apps":[{"name":"X","down":1,"up":2}]}' "$got"
chk "1a 而不是 unknown method"             "no"    "$(printf '%s' "$got" | grep -q 'unknown method' && echo yes || echo no)"

# The error branch still has to exist: a genuinely unknown method must be
# reported as one rather than silently returning nothing.
got=$(STATE_DIR="$T/state" sh "$T/lt.sh" call noSuchMethod < /dev/null)
chk "2 未知方法仍报 unknown method"        "OUT:error=unknown method" "$got"

# list must advertise every method the page declares, or the page cannot call it.
listing=$(STATE_DIR="$T/state" sh "$T/lt.sh" list < /dev/null)
PAGE="/d/Code/Luci-app/luci-app-traffic/htdocs/luci-static/resources/view/traffic/overview.js"
[ -f "$PAGE" ] || PAGE="$(cd "$SELF/.." && pwd)/htdocs/luci-static/resources/view/traffic/overview.js"
chk "3 list 声明 getSummary"              "1"     "$(grep -c 'json_add_object "getSummary"' "$RPCD")"
chk "3a list 声明 getSeries"              "1"     "$(grep -c 'json_add_object "getSeries"' "$RPCD")"
chk "3b list 声明 resetStats"             "1"     "$(grep -c 'json_add_object "resetStats"' "$RPCD")"
chk "3c list 声明 resolveNow"             "1"     "$(grep -c 'json_add_object "resolveNow"' "$RPCD")"
chk "3d 参数类型已声明（hours/range/what）" "3"    "$(printf '%s\n' "$listing" | grep -c '^OUT:')"

# Every method the page calls must be both advertised and dispatched, otherwise
# the page gets "unknown method" or a silent default.
for m in getSummary getHourly getConfig getSeries resolveNow resetStats; do
    chk "4 分派覆盖 $m"                   "1"     "$(grep -c "^			$m)" "$RPCD")"
done
page_methods=$(sed -n "s/.*rpc\.declare({ *object: 'luci\.traffic', *method: '\([A-Za-z]*\)'.*/\1/p" "$PAGE" | sort -u)
for m in $page_methods; do
    chk "5 页面调用的 $m 已被 list 声明"   "1"     "$(grep -c "json_add_object \"$m\"" "$RPCD")"
done

# An empty state directory must still answer with the documented shape, so the
# page reads one schema whether or not the collector has run yet.
got=$(STATE_DIR="$T/empty" sh "$T/lt.sh" call getSummary < /dev/null)
for k in collected_at interval hour flows dnsmap_lines pending rounds version acct querylog apps clients totals; do
    chk "6 空快照含字段 $k"                "1"     "$(printf '%s' "$got" | grep -c "\"$k\":")"
done
chk "6a 空快照是合法 JSON 形状"            "{"     "$(printf '%s' "$got" | head -c 1)"

echo
echo "=== 吞吐档位 ==="
# Every tier must resolve to its own file and interval.  If a tier reads the
# wrong file the page is not empty and not broken - it just plots the wrong
# history - so the file binding is asserted, not only the echoed range name.
cat > "$T/uci" <<EOF
#!/bin/sh
case "\$*" in
	*traffic.settings.datadir*)  echo "$T/data"; exit 0 ;;
	*traffic.settings.interval*) echo 10;       exit 0 ;;
esac
exit 1
EOF
chmod +x "$T/uci"
mkdir -p "$T/data"
printf '1000\t100\t10\n2000\t200\t20\n' > "$T/data/series1h.tsv"
# 800 minute points, so the 12h cap (720) is distinguishable from the 24h one.
awk 'BEGIN { for (i = 1; i <= 800; i++) printf "%d\t%d\t%d\n", i, i * 2, i }' > "$T/data/series60.tsv"

ser() { PATH="$T:$PATH" STATE_DIR="$T/state" STUB_range="$1" sh "$T/lt.sh" call getSeries < /dev/null; }
rng() { printf '%s' "$1" | sed -n 's/^{"range":"\([^"]*\)".*/\1/p'; }
npts() { printf '%s' "$1" | tr -cd '[' | wc -c | tr -d ' '; }

for r in 1h 12h 24h 7d; do
    chk "7 getSeries $r 回显档位"          "$r"    "$(rng "$(ser "$r")")"
done
chk "7a 未指定档位默认 1h"                 "1h"    "$(rng "$(PATH="$T:$PATH" STATE_DIR="$T/state" sh "$T/lt.sh" call getSeries < /dev/null)")"
chk "7b 7d 读取 series1h.tsv"             "[[1000,100,10,0,0,0],[2000,200,20,0,0,0]]" \
    "$(ser 7d | sed -n 's/.*"points":\(.*\)}$/\1/p')"
# The one second peak rides beside the round average so the chart can quote a
# real peak.  The bucket is the minute, so a peak recorded for minute 960 has to
# reach the point at 1000 and must not reach the one at 2000.
printf '960\t9000\t800\t7\n' > "$T/state/peaks.tsv"
chk "7g 1 秒峰值并入它那一分钟"            "[[1000,100,10,9000,800,7],[2000,200,20,0,0,0]]" \
    "$(ser 7d | sed -n 's/.*"points":\(.*\)}$/\1/p')"
# A peak of a later minute must not leak backwards into an earlier point.
printf '960\t9000\t800\t7\n1980\t5000\t400\t3\n' > "$T/state/peaks.tsv"
chk "7h 峰值只落进自己的分钟"              "[[1000,100,10,9000,800,7],[2000,200,20,5000,400,3]]" \
    "$(ser 7d | sed -n 's/.*"points":\(.*\)}$/\1/p')"
: > "$T/state/peaks.tsv"
chk "7c 12h 间隔 60 秒"                    "60"    "$(ser 12h | sed -n 's/.*"interval":\([0-9]*\).*/\1/p')"
chk "7d 7d 间隔 3600 秒"                   "3600"  "$(ser 7d | sed -n 's/.*"interval":\([0-9]*\).*/\1/p')"
chk "7e 12h 截断到 720 点"                 "720"   "$(( $(npts "$(ser 12h)") - 1 ))"
chk "7f 24h 保留 800 点"                   "800"   "$(( $(npts "$(ser 24h)") - 1 ))"
chk "7g 12h 与 24h 读同一文件"             "1"     "$(ser 12h | grep -c '"interval":60')"
chk "7h 未知档位回落 1h"                   "1h"    "$(rng "$(ser nonsense)")"

echo
echo "=== 范围聚合不丢行 ==="
# The page builds its 12h/24h/7d totals by summing the hours it is given, so an
# hour that comes back in part makes the range report less traffic than it
# contains - the total silently drops the tail of every hour.  Both lists are
# therefore asserted whole, with more rows than the caps they used to carry.
{
    awk 'BEGIN { for (i = 1; i <= 25; i++) printf "h1\tapp\tApp%02d\t%d\t%d\n", i, i * 100, i * 10 }'
    awk 'BEGIN { for (i = 1; i <= 15; i++) printf "h1\tclient\t10.0.0.%d\t%d\t0\n", i, i * 50 }'
    printf 'h1\trouter\tproxy\t999\t0\n'
} > "$T/data/hourly.tsv"
hr() { PATH="$T:$PATH" STATE_DIR="$T/state" STUB_hours="$1" sh "$T/lt.sh" call getHourly < /dev/null; }
out=$(hr 24)
chk "8 getHourly 返回全部应用行（旧上限 20）" "25" \
    "$(printf '%s' "$out" | grep -o '"name":"App' | wc -l | tr -d ' ')"
chk "8a getHourly 返回全部客户端行（旧上限 10）" "15" \
    "$(printf '%s' "$out" | grep -o '"ip":"10\.0\.0\.' | wc -l | tr -d ' ')"
chk "8b getHourly 隧道行仍在"               "999" "$(printf '%s' "$out" | sed -n 's/.*"router":\([0-9]*\).*/\1/p')"
chk "8c 只列出被请求的小时"                 "1"   "$(printf '%s' "$out" | grep -c '"hour":"h1"')"
# A second, older hour: the window must take the newest one and leave the other
# out of the totals entirely.
printf 'h0\tapp\tOld\t7\t7\n' >> "$T/data/hourly.tsv"
out1=$(hr 1)
chk "8d 只取最新小时"                       "0"   "$(printf '%s' "$out1" | grep -c 'Old')"
chk "8e 最新小时仍然完整"                   "25"  "$(printf '%s' "$out1" | grep -o '"name":"App' | wc -l | tr -d ' ')"
# The hour in progress.  The collector publishes it every round as the difference
# between its live counters and what is already archived, and the archive only
# gets its first row when the clock crosses the hour - so a range view has to
# take it from here, or it stays empty for the first hour after an install.
printf 'YouTube\t60000\t3600\n' > "$T/state/cur.apps"      # name, down, up
printf '10.0.0.9\t42000\n'      > "$T/state/cur.clients"   # ip, bytes
printf '777\n'                  > "$T/state/cur.router"
printf '2026-09-17T10\n'        > "$T/state/cur.hour"
: > "$T/data/hourly.tsv"
out2=$(hr 24)
chk "8f 归档为空时给出进行中的小时"          "1"   "$(printf '%s' "$out2" | grep -c '"hour":"2026-09-17T10"')"
chk "8g 进行中的小时含应用行"               "1"   "$(printf '%s' "$out2" | grep -c '"name":"YouTube"')"
chk "8h 进行中的小时下/上未错位"            "60000/3600" \
    "$(printf '%s' "$out2" | sed -n 's/.*{"name":"YouTube","down":\([0-9]*\),"up":\([0-9]*\)}.*/\1\/\2/p')"
chk "8i 进行中的小时含客户端"               "1"   "$(printf '%s' "$out2" | grep -c '"ip":"10\.0\.0\.9"')"
chk "8j 进行中的小时含隧道"                 "1"   "$(printf '%s' "$out2" | grep -c '"router":777')"
chk "8k 空归档时仍是合法 JSON"              '{"hours":' "$(printf '%s' "$out2" | cut -c1-9)"
# with an archive present, both come back
printf 'h1\tapp\tApp01\t100\t10\n' > "$T/data/hourly.tsv"
out3=$(hr 24)
chk "8l 有归档时归档与进行中的小时都在"      "2"   "$(printf '%s' "$out3" | grep -o '"hour":' | wc -l | tr -d ' ')"

echo
echo "=== 每 app 的客户端（归档行 + 进行中的小时行）==="
# The archive held application rows and client rows but not the correlation
# between them, so every per-application client column was a dash in a range view
# and only the session view could fill it.  roll_hour now writes the correlation
# as <hour> apptop <app> <client> <bytes> <clients>, and publish_current puts the
# same three figures on the end of the in-progress application rows - two separate
# paths that both have to carry them, and dropping the field from either one sends
# the page back to a dash with nothing else changing.  That is what happened once,
# which is why this is asserted here rather than checked by hand on the router.
{
    printf 'h1\tapp\tOpenAI\t1000\t500\n'
    printf 'h1\tapptop\tOpenAI\t192.168.2.120\t900\t3\n'
    printf 'h1\tapp\tNoRows\t10\t5\n'
} > "$T/data/hourly.tsv"
: > "$T/state/cur.apps"; : > "$T/state/cur.clients"
printf '0\n' > "$T/state/cur.router"; : > "$T/state/cur.hour"
out=$(hr 24)
chk "9 归档的 app 行带上客户端"  '{"name":"OpenAI","down":1000,"up":500,"top":"192.168.2.120","top_bytes":900,"clients":3}' \
    "$(printf '%s' "$out" | grep -o '{"name":"OpenAI"[^}]*}')"
chk "9a 没有 apptop 行的 app 不多出字段" '{"name":"NoRows","down":10,"up":5}' \
    "$(printf '%s' "$out" | grep -o '{"name":"NoRows"[^}]*}')"
# the hour in progress: publish_current appends the same three figures, in the
# order <name> <down> <up> <client> <bytes> <clients>
printf 'YouTube\t60000\t3600\t10.0.0.9\t42000\t4\n' > "$T/state/cur.apps"
printf '10.0.0.9\t42000\n' > "$T/state/cur.clients"
printf '2026-09-17T10\n'   > "$T/state/cur.hour"
out=$(hr 24)
chk "9b 进行中的小时行也带上客户端" \
    '{"name":"YouTube","down":60000,"up":3600,"top":"10.0.0.9","top_bytes":42000,"clients":4}' \
    "$(printf '%s' "$out" | grep -o '{"name":"YouTube"[^}]*}')"
# an application the collector had no client for still comes back whole
printf 'Solo\t70\t30\n' >> "$T/state/cur.apps"
out=$(hr 24)
chk "9c 缺客户端字段时仍是三字段行" '{"name":"Solo","down":70,"up":30}' \
    "$(printf '%s' "$out" | grep -o '{"name":"Solo"[^}]*}')"

echo
echo "=== 范围总量：每小时的网卡口径 ==="
# The archive's app rows are the attribution, which under flow offloading is a
# small fraction of what the box carried (measured: 147 MiB against 2579 MiB on
# the WAN device).  roll_hour therefore also archives one device row per hour as
# <hour> wan - <down> <up>, and the backend has to publish it on the bucket as
# iface so a range view can total up a real number.  Two things are asserted
# together, because each is a wrong page on its own:
#
#   - the field must be there when the archive has the row (else the range view
#     keeps showing a fraction of the traffic as its total);
#   - the field must be absent when the archive has no such row (an archive
#     written before this existed).  A zero standing in for the total is worse
#     than no field: the page cannot tell it from a quiet range.
#
# Every assertion is on a whole bucket object rather than on a substring, so a
# wrong implementation that leaks the row into the app list changes the string
# and fails here too.  "},{" separates two applications inside a bucket as well
# as two buckets, so the split is done by counting braces - splitting on the
# text would cut a bucket in half.
buckets() {
    printf '%s' "$1" | awk '
        { for (i = 1; i <= length($0); i++) {
              c = substr($0, i, 1)
              if (c == "{") { d++; if (d >= 2) buf = buf c }
              else if (c == "}") { if (d >= 2) buf = buf c; d--; if (d == 1) { print buf; buf = "" } }
              else if (d >= 2) { buf = buf c }
          } }'
}
one() { buckets "$1" | grep "^$2" | head -n 1; }

# The hour in progress is off for these: it is appended whenever it has rows, and
# that would put a second bucket in the answer.
: > "$T/state/cur.apps"; : > "$T/state/cur.clients"
printf '0\n' > "$T/state/cur.router"; : > "$T/state/cur.hour"
rm -f "$T/state/cur.iface"

# An archived hour that carries the device row.  Seeded asymmetrically: equal
# numbers would hide a swap between the two directions.
{
    printf 'h1\tapp\tOpenAI\t1000\t500\n'
    printf 'h1\twan\t-\t9000\t700\n'
} > "$T/data/hourly.tsv"
out=$(hr 24)
chk "10 归档小时的网卡总量发到桶上（含未错位）" \
    '{"hour":"h1","apps":[{"name":"OpenAI","down":1000,"up":500}],"clients":[],"router":0,"iface":{"down":9000,"up":700}}' \
    "$(one "$out" '{"hour":"h1"')"
chk "10a 网卡行不冒充应用"                   "0" \
    "$(printf '%s' "$out" | grep -c '"name":"-"')"
chk "10b 网卡行不冒充客户端"                 "0" \
    "$(printf '%s' "$out" | grep -c '"ip":"-"')"

# An archive written before the device rows existed: no row for the hour, so no
# field on the bucket.  The page reads that absence as "fall back to the
# attributed bytes", which is what keeps an upgraded router honest instead of
# showing it a total of zero.
printf 'h1\tapp\tNoWan\t1000\t500\n' > "$T/data/hourly.tsv"
out=$(hr 24)
chk "10c 旧归档的桶不下发 iface"             \
    '{"hour":"h1","apps":[{"name":"NoWan","down":1000,"up":500}],"clients":[],"router":0}' \
    "$(one "$out" '{"hour":"h1"')"
chk "10d 缺 iface 时仍是合法 JSON"           '{"hours":' "$(printf '%s' "$out" | cut -c1-9)"

# With offloading, a current hour may carry WAN bytes before any application
# or router-tunnel row arrives.  It still belongs in the selected range.
: > "$T/data/hourly.tsv"
: > "$T/state/cur.apps"; : > "$T/state/cur.clients"
printf '0\n' > "$T/state/cur.router"
printf '2026-09-17T10\n' > "$T/state/cur.hour"
printf '9000\n700\n' > "$T/state/cur.iface"
out=$(hr 24)
chk "10e 仅有网卡流量的当前小时不丢失" \
    '{"hour":"2026-09-17T10","apps":[],"clients":[],"router":0,"iface":{"down":9000,"up":700}}' \
    "$(one "$out" '{"hour":"2026-09-17T10"')"

# The hour in progress: publish_current writes cur.iface, the difference between
# the live device counters and what is already archived.  Without it the current
# hour would be the one bucket a range could never total from the device, and
# since the range always contains the current hour, no range could ever use it.
printf 'YouTube\t60000\t3600\n' > "$T/state/cur.apps"
printf '2026-09-17T10\n'        > "$T/state/cur.hour"
printf '500\n'                  > "$T/state/cur.router"
printf '7000\n900\n'            > "$T/state/cur.iface"
: > "$T/data/hourly.tsv"
out=$(hr 24)
chk "10e 进行中的小时也带上网卡总量" \
    '{"hour":"2026-09-17T10","apps":[{"name":"YouTube","down":60000,"up":3600}],"clients":[],"router":500,"iface":{"down":7000,"up":900}}' \
    "$(one "$out" '{"hour":"2026-09-17T10"')"

# The collector removes cur.iface when it could not measure a device this round,
# and a half-written or non-numeric file must not become a total either: a real
# down beside an up of zero reads as a direction that carried nothing.
rm -f "$T/state/cur.iface"
out=$(hr 24)
chk "10f 没有接口计数时不编造总量" \
    '{"hour":"2026-09-17T10","apps":[{"name":"YouTube","down":60000,"up":3600}],"clients":[],"router":500}' \
    "$(one "$out" '{"hour":"2026-09-17T10"')"
printf '7000\n' > "$T/state/cur.iface"
out=$(hr 24)
chk "10g 半截的 cur.iface 不下发 iface" \
    '{"hour":"2026-09-17T10","apps":[{"name":"YouTube","down":60000,"up":3600}],"clients":[],"router":500}' \
    "$(one "$out" '{"hour":"2026-09-17T10"')"
printf 'nope\n900\n' > "$T/state/cur.iface"
out=$(hr 24)
chk "10h 非数字的 cur.iface 不下发 iface" \
    '{"hour":"2026-09-17T10","apps":[{"name":"YouTube","down":60000,"up":3600}],"clients":[],"router":500}' \
    "$(one "$out" '{"hour":"2026-09-17T10"')"

# The current partial hour consumes one slot in a requested N-hour window.
# Returning N archived buckets plus the partial one silently spans N+1 buckets.
{
    printf 'h1\tapp\tOld\t1\t0\n'
    printf 'h2\tapp\tMid\t2\t0\n'
    printf 'h3\tapp\tNew\t3\t0\n'
} > "$T/data/hourly.tsv"
printf 'h4\n' > "$T/state/cur.hour"
printf '4\n0\n' > "$T/state/cur.iface"
out=$(hr 3)
chk "10i 三小时范围含当前小时共三个桶" "3" \
    "$(printf '%s' "$out" | grep -o '"hour":' | wc -l | tr -d ' ')"
chk "10j 最旧的第四桶不在范围内" "0" \
    "$(printf '%s' "$out" | grep -c '"hour":"h1"')"

# Client counters can have traffic before classification or WAN detection.
: > "$T/data/hourly.tsv"; : > "$T/state/cur.apps"
printf '10.0.0.9\t123\n' > "$T/state/cur.clients"
printf '0\n' > "$T/state/cur.router"
rm -f "$T/state/cur.iface"
out=$(hr 3)
chk "10k 仅客户端计数的当前小时不丢失" \
    '{"hour":"h4","apps":[],"clients":[{"ip":"10.0.0.9","bytes":123}],"router":0}' \
    "$(one "$out" '{"hour":"h4"')"

echo
if [ "$fail" = 0 ]; then echo "=== 全部通过 ==="; else echo "=== 有失败 ==="; fi
exit "$fail"

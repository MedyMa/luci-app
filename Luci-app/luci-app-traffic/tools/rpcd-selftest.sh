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
RPCD="$(cd "$SELF/.." && pwd)/root/usr/libexec/rpcd/luci.traffic"
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
chk "7b 7d 读取 series1h.tsv"             "[[1000,100,10],[2000,200,20]]" \
    "$(ser 7d | sed -n 's/.*"points":\(.*\)}$/\1/p')"
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

echo
if [ "$fail" = 0 ]; then echo "=== 全部通过 ==="; else echo "=== 有失败 ==="; fi
exit "$fail"

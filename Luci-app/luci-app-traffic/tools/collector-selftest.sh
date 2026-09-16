#!/bin/bash
# collector-selftest.sh - offline regression for luci-app-traffic's collector.
#
# Runs collector.sh against a synthetic conntrack snapshot, a stub lua (real
# AdGuard Home querylog answers are exercised separately by ans-check.js) and
# small apps/categories tables, then asserts every attribution path:
#
#   1. exact host name wins over a suffix       (music.163.com not 163.com)
#   2. plain suffix hit                          (www.taobao.com -> Taobao)
#   3. longest suffix wins                       (deep.cdn.example.com -> Deep,
#                                                 not the shorter example.com)
#   4. multi-label suffix needs no public suffix list
#                                                (a.bar.co.uk -> Foo Bar UK)
#   5. category suffix hit                       (x.fastly.net -> CDN)
#   6. nothing in either table -> the site itself (shop.unknownsite.org)
#   7. DNS answered for another client -> "any" (9.9.9.9 -> Example Org)
#   8. no DNS answer, protocol bucket            (443/tcp -> SSL/TLS, 443/udp ->
#                                                 QUIC, 554/tcp -> RTSP)
#   9. the same address:port over tcp and udp counted separately
#  10. router-originated traffic kept out of the application list
#  11. the catalogue is read only for new host names, and a changed catalogue
#      invalidates the cached name map
#  12. the box's own LAN addresses are not clients, whether v4 or v6, while a
#      real client on the same prefixes still is
#  13. an older state schema rebuilds the running totals instead of keeping a
#      row that must no longer exist, and a matching one does not
#
#   bash collector-selftest.sh
set -u

SELF="$(cd "$(dirname "$0")" && pwd)"
COLLECTOR="$(cd "$SELF/.." && pwd)/root/usr/share/traffic/collector.sh"
[ -f "$COLLECTOR" ] || { echo "collector.sh not found next to $SELF" >&2; exit 1; }

echo "=== sh -n ==="
# An apostrophe inside an awk comment closes the single-quoted program the shell
# is already inside - the awk program ends early, the rest of it is parsed as
# shell, and sh -n reports a syntax error far from the real cause.  It has been
# written three times in this file's history, so it gets its own check that
# names the offending line.
apostrophes=$(awk '
    /awk[[:space:]].*-v |awk -F.*\x27$/ { inawk = 1 }
    inawk && /^[[:space:]]*#/ {
        line = $0
        if (gsub(/\x27/, "\x27", line) > 0) { printf "  line %d: %s\n", NR, $0; hits++ }
    }
    inawk && /^(    )?.\x27 / { inawk = 0 }
    END { exit (hits > 0 ? 1 : 0) }
' "$COLLECTOR")
if [ -n "$apostrophes" ]; then
    echo "FAIL: apostrophe inside an awk comment closes the program early:" >&2
    echo "$apostrophes" >&2
    exit 1
fi
echo "no apostrophes inside awk programs"
if ! sh -n "$COLLECTOR"; then
    # A syntax error makes every later assertion meaningless, so stop here
    # rather than printing a wall of failures.  This is the check that catches
    # an apostrophe inside an awk comment, which closes the single-quoted awk
    # program the shell is already inside.
    echo "FAIL: collector.sh does not parse - aborting" >&2
    exit 1
fi
echo "collector syntax OK"

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"

# stub lua: swallow the querylog lines and emit fixed (client, domain, ip) rows.
# The last row resolves for a different client, which is what makes a flow fall
# back to the "any client answered this address" path.
cat > "$T/bin/lua" <<'EOF'
#!/bin/sh
n=0
while read -r _; do n=$((n+1)); done
[ "$n" -gt 0 ] || exit 0
printf '192.168.2.138\tmusic.163.com\t1.1.1.1\n'
printf '192.168.2.138\twww.taobao.com\t2.2.2.2\n'
printf '192.168.2.138\tx.fastly.net\t3.3.3.3\n'
printf '192.168.2.138\tdeep.cdn.example.com\t4.4.4.4\n'
printf '192.168.2.138\ta.bar.co.uk\t7.7.7.7\n'
printf '192.168.2.138\tshop.unknownsite.org\t8.8.8.8\n'
printf '192.168.2.138\tWWW.MEITUAN.COM\t10.10.10.10\n'
printf '192.168.2.139\texample.org\t9.9.9.9\n'
exit 0
EOF
chmod +x "$T/bin/lua"

# <name> <TAB> <key> <TAB> H|S   (H = exact host name, S = suffix match)
{
    printf 'NetEase Music\tmusic.163.com\tH\n'
    printf 'NetEase\t163.com\tS\n'
    printf 'Taobao\ttaobao.com\tS\n'
    printf 'Deep\tcdn.example.com\tS\n'
    printf 'Example\texample.com\tS\n'
    printf 'Foo Bar UK\tbar.co.uk\tS\n'
    printf 'Example Org\texample.org\tS\n'
    printf 'Meituan\tmeituan.com\tS\n'
} > "$T/apps.tsv"
printf '# category<TAB>suffix\nCDN\tfastly.net\nAds\tdoubleclick.net\n' > "$T/categories.tsv"
printf '{"IP":"192.168.2.138","QH":"x","Answer":"y"}\n'  > "$T/ql"

# One flow per line.  $6 is the client->server counter (upload) and $7 the
# server->client counter (download), matching the order the collector reads.
cat > "$T/ct" <<'EOF'
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=1.1.1.1 sport=1001 dport=443 packets=1 bytes=100 tos=0 src=1.1.1.1 dst=192.168.2.138 sport=443 dport=1001 packets=1 bytes=1000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=2.2.2.2 sport=1002 dport=443 packets=1 bytes=200 tos=0 src=2.2.2.2 dst=192.168.2.138 sport=443 dport=1002 packets=1 bytes=2000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=3.3.3.3 sport=1003 dport=443 packets=1 bytes=300 tos=0 src=3.3.3.3 dst=192.168.2.138 sport=443 dport=1003 packets=1 bytes=3000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=4.4.4.4 sport=1004 dport=443 packets=1 bytes=400 tos=0 src=4.4.4.4 dst=192.168.2.138 sport=443 dport=1004 packets=1 bytes=4000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=5.5.5.5 sport=1005 dport=443 packets=1 bytes=500 tos=0 src=5.5.5.5 dst=192.168.2.138 sport=443 dport=1005 packets=1 bytes=5000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 udp 17 119 ESTABLISHED src=192.168.2.138 dst=5.5.5.5 sport=1006 dport=443 packets=1 bytes=600 tos=0 src=5.5.5.5 dst=192.168.2.138 sport=443 dport=1006 packets=1 bytes=6000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=6.6.6.6 sport=1007 dport=554 packets=1 bytes=700 tos=0 src=6.6.6.6 dst=192.168.2.138 sport=554 dport=1007 packets=1 bytes=7000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=7.7.7.7 sport=1008 dport=443 packets=1 bytes=800 tos=0 src=7.7.7.7 dst=192.168.2.138 sport=443 dport=1008 packets=1 bytes=8000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=8.8.8.8 sport=1009 dport=443 packets=1 bytes=900 tos=0 src=8.8.8.8 dst=192.168.2.138 sport=443 dport=1009 packets=1 bytes=9000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=9.9.9.9 sport=1010 dport=443 packets=1 bytes=1000 tos=0 src=9.9.9.9 dst=192.168.2.138 sport=443 dport=1010 packets=1 bytes=10000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=10.10.10.10 sport=1011 dport=443 packets=1 bytes=1100 tos=0 src=10.10.10.10 dst=192.168.2.138 sport=443 dport=1011 packets=1 bytes=11000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.1.6 dst=45.149.157.234 sport=1012 dport=443 packets=1 bytes=800 tos=0 src=45.149.157.234 dst=192.168.1.6 sport=443 dport=1012 packets=1 bytes=8000 tos=0 [ASSURED] mark=0 zone=0 use=2
EOF

# Run the collector until it has finished one whole round, then stop it.
#
# A fixed timeout cannot express this.  A round costs a handful of forks per
# stage, so on a slow or loaded host a single round can outlast any budget worth
# writing - and when it does, the collector is killed halfway through and the
# assertion fails for a reason that has nothing to do with the code.  That is
# exactly what made phases 15, 17, 18 and 19 fail intermittently here.
#
# collected_at is written by the last stage of a round, so a change in it means
# the round is complete.  The timeout stays as a safety net for a collector that
# wedges before writing anything.
run_collector() {
    local cap="${1:-30}"; shift
    collect "$T/state" "$T/data" "$T/ct" "$T/ql" "$cap" "$@"
}

# The same, against a state directory of its own, so a phase that needs a clean
# slate does not have to disturb the one the earlier assertions built up.
run_collector_at() {
    local cap="${1:-30}" st="$2" da="$3" ct="$4" ql="$5"; shift 5
    collect "$st" "$da" "$ct" "$ql" "$cap" "$@"
}

snapshot_at() { sed -n 's/.*"collected_at":\([0-9]*\).*/\1/p' "$1" 2>/dev/null; }

collect() {
    local st="$1" da="$2" ct="$3" ql="$4" cap="$5"; shift 5
    local before pid i at
    before=$(snapshot_at "$st/summary.json")

    env "$@" UCI=/bin/true LUA="$T/bin/lua" CT="$ct" TRAFFIC_QUERYLOG="$ql" \
      TRAFFIC_LAN4=192.168.2. TRAFFIC_INTERVAL=2 TRAFFIC_DATADIR="$da" \
      TRAFFIC_APPMAP="$T/apps.tsv" TRAFFIC_CATEGORIES="$T/categories.tsv" \
      STATE_DIR="$st" SELF_DIR="$(cd "$SELF/../root/usr/share/traffic" && pwd)" \
      timeout "$cap" sh "$COLLECTOR" >/dev/null 2>&1 &
    pid=$!

    i=0
    while [ "$i" -lt $((cap * 5)) ]; do
        at=$(snapshot_at "$st/summary.json")
        [ -n "$at" ] && [ "$at" != "$before" ] && break
        sleep 0.2
        i=$((i + 1))
    done
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    return 0
}

run_collector 30

echo
echo "--- totals ---"
cat "$T/state/totals.tsv"
echo "--- router ---"; cat "$T/state/router.tsv"
echo "--- stat  ---"; cat "$T/state/stat.tsv"
echo "--- namemap (host, kind, name) ---"; cat "$T/state/namemap.tsv"

echo
echo "=== 断言 ==="
fail=0
row() { awk -F'\t' -v n="$1" '$1==n {print $2"/"$3}' "$T/state/totals.tsv"; }
nm()  { awk -F'\t' -v h="$1" '$1==h {print $2" "$3}' "$T/state/namemap.tsv"; }
chk() { if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (expect '$2', got '$3')"; fail=1; fi; }

chk "1  精确主机名优先于后缀"            "100/1000"   "$(row 'NetEase Music')"
chk "1a 同一后缀下的其他域归其自身"       ""           "$(row 'NetEase')"
chk "2  普通后缀命中"                    "200/2000"   "$(row 'Taobao')"
chk "3  最长后缀优先 (cdn.example.com)"  "400/4000"   "$(row 'Deep')"
chk "3a 短后缀未抢走长后缀的流量"         ""           "$(row 'Example')"
chk "4  多标签后缀 (bar.co.uk)"          "800/8000"   "$(row 'Foo Bar UK')"
chk "5  类别后缀命中 -> CDN"             "300/3000"   "$(row 'CDN')"
chk "6  无表项 -> 站点自身域名"           "900/9000"   "$(row 'unknownsite.org')"
chk "7  其他客户端解析过该地址 -> 命中"    "1000/10000" "$(row 'Example Org')"
chk "7b 大写主机名归一化后仍命中"          "1100/11000" "$(row 'Meituan')"
chk "8a 无 DNS + tcp/443 -> SSL/TLS"     "500/5000"   "$(row 'SSL/TLS')"
chk "8b 无 DNS + udp/443 -> QUIC"        "600/6000"   "$(row 'QUIC')"
chk "8c 无 DNS + tcp/554 -> RTSP"        "700/7000"   "$(row 'RTSP')"
chk "10 隧道流单独统计"                   "8800"       "$(cat "$T/state/router.tsv")"
chk "11 三类计数合计 = 客户端总量"         "72600"      "$(awk -F'\t' '{s+=$1+$2+$3+$4} END{print s+0}' "$T/state/stat.tsv")"
chk "11a 命名(同客户端 DNS)"              "38500"      "$(cut -f1 "$T/state/stat.tsv")"
chk "11b 命名(任意客户端 DNS)"            "11000"      "$(cut -f2 "$T/state/stat.tsv")"
chk "11c 分类归入"                        "3300"       "$(cut -f3 "$T/state/stat.tsv")"
chk "11d 其他（协议桶）"                  "19800"      "$(cut -f4 "$T/state/stat.tsv")"
chk "12 隧道未混入应用列表"               "11"         "$(grep -c . "$T/state/totals.tsv")"
# read a field out of the snapshot's totals object only - a bare grep for
# "down": would also match every per-application entry
tot() { grep -o '"totals":{[^}]*}' "$T/state/summary.json" | grep -o "\"$1\":[0-9]*" | cut -d: -f2; }
chk "13 快照 totals.down"                 "66000"      "$(tot down)"
chk "13a 快照 totals.up"                  "6600"       "$(tot up)"
chk "13b 快照 totals.router"              "8800"       "$(tot router)"

echo
echo "=== 名称缓存（resolve-on-insert）==="
chk "14 namemap 记录精确命中"             "app NetEase Music" "$(nm 'music.163.com')"
chk "14a namemap 记录最长后缀命中"         "app Deep"          "$(nm 'deep.cdn.example.com')"
chk "14b namemap 记录类别归入"             "cat CDN"           "$(nm 'x.fastly.net')"
chk "14c namemap 记录站点兜底"             "site unknownsite.org" "$(nm 'shop.unknownsite.org')"
chk "14d namemap 未收录无关主机"           ""                  "$(nm 'not.in.the.map')"
chk "14e namemap 键已归一化为小写"         "app Meituan"       "$(nm 'www.meituan.com')"
# the catalogue was already read once; without new host names it must not grow
nm_before=$(grep -c . "$T/state/namemap.tsv")

echo
echo "=== 吞吐时间序列（两级粒度）==="
# every round records one point, so the two tiers must agree with the totals
chk "16 series10 点与 totals 自洽（下行）"  "66000" "$(awk -F'\t' '{s+=$2} END{print s+0}' "$T/state/series10.tsv")"
chk "16a series10 点与 totals 自洽（上行）" "6600"  "$(awk -F'\t' '{s+=$3} END{print s+0}' "$T/state/series10.tsv")"
chk "16b 至少记录了 1 个采样点"             "yes"   "$(awk 'END{print (NR>=1)?"yes":"no"}' "$T/state/series10.tsv")"
chk "16c minute 累加器对齐整分钟"           "0"     "$(( $(sed -n '1p' "$T/state/minute.tsv") % 60 ))"

echo
echo "=== 目录变更必须让缓存失效 ==="
# Rewrite the application table (a different size, as a real upgrade would be)
# and point the suffix at a new name: the cached answer has to be replaced.
{
    printf 'NetEase Music\tmusic.163.com\tH\n'
    printf 'NetEase\t163.com\tS\n'
    printf 'Taobao\ttaobao.com\tS\n'
    printf 'Deep CDN\tcdn.example.com\tS\n'
    printf 'Example\texample.com\tS\n'
    printf 'Foo Bar UK\tbar.co.uk\tS\n'
    printf 'Example Org\texample.org\tS\n'
    printf 'Meituan\tmeituan.com\tS\n'
    printf 'Fastly\tfastly.net\tS\n'
} > "$T/apps.tsv"
# also stage a finished minute, so the next run has to fold it into the day tier
printf '%s\n%s\n%s\n' "$(( $(date +%s) / 60 * 60 - 60 ))" 4242 424 > "$T/state/minute.tsv"
run_collector 30
chk "15 目录变更后 namemap 重新解析"       "app Fastly"        "$(nm 'x.fastly.net')"
chk "15a 目录变更后长后缀重新解析"         "app Deep CDN"      "$(nm 'deep.cdn.example.com')"
chk "15b 缓存未被重复追加"                 "$nm_before"        "$(grep -c . "$T/state/namemap.tsv")"
chk "17 跨分钟后上一分钟落盘 series60"     "4242/424"          "$(awk -F'\t' 'END{print $2"/"$3}' "$T/data/series60.tsv")"
chk "17a series60 只保留完整分钟"          "0"                 "$(( $(awk -F'\t' 'END{print $1}' "$T/data/series60.tsv") % 60 ))"
# the conntrack snapshot is unchanged since the first run, so these rounds carry
# no traffic at all - and a quiet round must still get a point, otherwise the
# chart would show a hole instead of zero
chk "17b 无流量轮次记录为 0 点"            "yes"               "$(awk -F'\t' '$2=="0" && $3=="0" {print "yes"; exit}' "$T/state/series10.tsv" | grep -q . && echo yes || echo no)"

echo
echo "=== 冷数据窗口上限 ==="
# shrink the day tier to 3 points and pre-fill it: the oldest must be dropped
printf '1\t1\t1\n2\t2\t2\n3\t3\t3\n4\t4\t4\n5\t5\t5\n' > "$T/data/series60.tsv"
printf '%s\n%s\n%s\n' "$(( $(date +%s) / 60 * 60 - 60 ))" 77 7 > "$T/state/minute.tsv"
run_collector 30 TRAFFIC_SERIES_COLD=180
chk "18 series60 裁剪到上限（3 点）"       "3"                 "$(grep -c . "$T/data/series60.tsv")"
chk "18a 保留的是最新点而非最旧点"         "77/7"              "$(awk -F'\t' 'END{print $2"/"$3}' "$T/data/series60.tsv")"

# an idle minute is data too: skipping it would compress the chart's time axis,
# because the points are spaced by index.  A minute of its own (-120) keeps the
# point distinct from the one phase 18 wrote when both runs happen inside the
# same wall-clock minute.
printf '%s\n%s\n%s\n' "$(( $(date +%s) / 60 * 60 - 120 ))" 0 0 > "$T/state/minute.tsv"
run_collector 30 TRAFFIC_SERIES_COLD=180
chk "18b 空闲的一分钟仍会落盘"             "0/0"               "$(awk -F'\t' 'END{print $2"/"$3}' "$T/data/series60.tsv")"
chk "18c 空闲点也受窗口上限约束"           "3"                 "$(grep -c . "$T/data/series60.tsv")"

echo
echo "=== 按需解析（页面打开时不等节流窗口）==="
# a fresh resolve timestamp means the throttle would normally hold this host
# name back; the page asks for it now by dropping the flag
printf '%s\n' "$(date +%s)" > "$T/state/nmtime"
printf '192.168.2.138\tnewhost.meituan.com\t10.20.30.40\n' >> "$T/state/dnsmap.tsv"
printf '1\n' > "$T/state/pending"
run_collector 30
chk "19 节流生效：新主机名暂不解析"        ""                  "$(nm 'newhost.meituan.com')"
chk "19a 待解析数量会上报"                 "1"                 "$(sed -n '1p' "$T/state/pending")"
: > "$T/state/resolve.now"
run_collector 30
chk "19b resolveNow 让页面立刻拿到名称"    "app Meituan"       "$(nm 'newhost.meituan.com')"
chk "19c 标记被消费后清除"                 "no"                "$( [ -f "$T/state/resolve.now" ] && echo yes || echo no )"
chk "19d 解析完成后待解析归零"             "0"                 "$(sed -n '1p' "$T/state/pending")"

echo
echo "=== 路由器自身地址不计入客户端 ==="
# The box runs a proxy, so its own LAN address sources a pile of outbound
# connections.  Counted as a client, "192.168.2.1" sat at the top of the list
# with 39 MB against it, and the same for its v6 address.  A real v6 client is
# in the fixture too, so passing here cannot be explained by the LAN-prefix rule
# rather than by the self set: .0050 must be counted, .0001 must not.
mkdir -p "$T/state2" "$T/data2"
cat > "$T/ct2" <<'EOF'
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.50 dst=1.1.1.1 sport=2001 dport=443 packets=1 bytes=100 tos=0 src=1.1.1.1 dst=192.168.2.50 sport=443 dport=2001 packets=1 bytes=1000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.1 dst=2.2.2.2 sport=2002 dport=443 packets=1 bytes=200 tos=0 src=2.2.2.2 dst=192.168.2.1 sport=443 dport=2002 packets=1 bytes=2000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv6 2 tcp 6 119 ESTABLISHED src=fdc8:64ed:f962:0000:0000:0000:0000:0001 dst=2400:3200:0000:0000:0000:0000:0000:0001 sport=2003 dport=443 packets=1 bytes=300 tos=0 src=2400:3200:0000:0000:0000:0000:0000:0001 dst=fdc8:64ed:f962:0000:0000:0000:0000:0001 sport=443 dport=2003 packets=1 bytes=3000 tos=0 [ASSURED] mark=0 use=1
ipv6 2 tcp 6 119 ESTABLISHED src=fdc8:64ed:f962:0000:0000:0000:0000:0050 dst=2400:3200:0000:0000:0000:0000:0000:0002 sport=2004 dport=443 packets=1 bytes=400 tos=0 src=2400:3200:0000:0000:0000:0000:0000:0002 dst=fdc8:64ed:f962:0000:0000:0000:0000:0050 sport=443 dport=2004 packets=1 bytes=4000 tos=0 [ASSURED] mark=0 use=1
EOF
run_collector_at 30 "$T/state2" "$T/data2" "$T/ct2" /nonexistent \
    TRAFFIC_SELF="192.168.2.1 fdc8:64ed:f962:0000:0000:0000:0000:0001" \
    TRAFFIC_LAN6=fdc8:64ed:f962:
c2() { awk -F'\t' -v ip="$1" '$1==ip {print $2}' "$T/state2/clients.tsv"; }
chk "20 路由器自身 v4 地址不计入客户端"     ""                  "$(c2 '192.168.2.1')"
chk "20a 路由器自身 v6 地址不计入客户端"    ""                  "$(c2 'fdc8:64ed:f962:0000:0000:0000:0000:0001')"
chk "20b v6 客户端仍被统计"                 "4400"              "$(c2 'fdc8:64ed:f962:0000:0000:0000:0000:0050')"
chk "20c v4 客户端仍被统计"                 "1100"              "$(c2 '192.168.2.50')"
chk "20d 客户端恰好两台"                    "2"                 "$(grep -c . "$T/state2/clients.tsv")"
chk "20e 自身流量归入 router 而非客户端"    "5500"              "$(cat "$T/state2/router.tsv")"
chk "20f 快照不把自身地址列为客户端"        "0"                 "$(grep -o '"ip":"192.168.2.1"' "$T/state2/summary.json" 2>/dev/null | wc -l | tr -d ' ')"
chk "20g 快照报告自身地址（页面可见）"      "192.168.2.1 fdc8:64ed:f962:0000:0000:0000:0000:0001" \
    "$(grep -o '"self":"[^"]*"' "$T/state2/summary.json" 2>/dev/null | cut -d'"' -f4)"

echo
echo "=== 状态版本变更后重建存量计数器 ==="
# /tmp/traffic survives an upgrade, so the row that used to be the box's own
# address is already in clients.tsv - and a running total is only ever added to,
# so it would sit at the top of the client list forever.  An older schema forces
# a rebuild; the same schema must not, or every restart would wipe the counters.
mkdir -p "$T/state3" "$T/data3"
printf '192.168.2.1\t39587169\n' > "$T/state3/clients.tsv"
printf '999\n' > "$T/state3/version"
run_collector_at 30 "$T/state3" "$T/data3" "$T/ct" "$T/ql"
c3() { awk -F'\t' -v ip="$1" '$1==ip {print $2}' "$T/state3/clients.tsv"; }
chk "21 旧版本的存量客户端行被清除"         ""                  "$(c3 '192.168.2.1')"
chk "21a 新版本号已写入"                    "1"                 "$(sed -n '1p' "$T/state3/version")"
chk "21b 计数器是从新数据重建的"            "72600"             "$(c3 '192.168.2.138')"
# second run: the schema now matches, so the totals must survive it untouched
run_collector_at 30 "$T/state3" "$T/data3" "$T/ct" "$T/ql"
chk "21c 版本未变时不会清空计数器"          "72600"             "$(c3 '192.168.2.138')"

echo
if [ "$fail" = 0 ]; then echo "=== 全部通过 ==="; else echo "=== 有失败 ==="; fi
exit "$fail"

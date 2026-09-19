#!/bin/bash
# collector-selftest.sh - offline regression for luci-app-traffic's collector.
#
# Runs collector.sh against a synthetic conntrack snapshot, a stub lua standing
# in for ans.lua (the real one needs a lua interpreter and the router's querylog,
# so it is exercised on the device) and small apps/categories tables, then
# asserts every attribution path:
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
#  14. the box addresses are found without being configured, which is the path
#      the router actually takes
#
#   bash collector-selftest.sh
set -u

SELF="$(cd "$(dirname "$0")" && pwd)"
COLLECTOR="$(cd "$SELF/.." && pwd)/root/usr/share/traffic/collector.sh"
# The collector's live-counter schema, read from the collector rather than written
# out here.  A phase that seeds a counter file has to also seed a matching version,
# or init_state() treats the state as older and drops exactly what was seeded -
# which is how the WAN baseline phase first failed.  Deriving it means the next
# bump cannot silently break these phases.
SCHEMA=$(sed -n 's/^STATE_VERSION=//p' "$COLLECTOR")
[ -f "$COLLECTOR" ] || { echo "collector.sh not found next to $SELF" >&2; exit 1; }

echo "=== sh -n ==="
# An apostrophe inside an awk comment closes the single-quoted program the shell
# is already inside - the awk program ends early, the rest of it is parsed as
# shell, and sh -n reports a syntax error far from the real cause.  It has been
# written three times in this file's history, so it gets its own check that
# names the offending line.
#
# The check tracks whether an odd number of quotes has been opened, rather than
# entering an "inawk" state and leaving it again.  The state version carried an
# exit rule that required the closing quote to be followed by a space after at
# most four spaces of indent, so every TAB-indented closer and every eight-space
# closer in this file missed it.  inawk was therefore set by the first awk
# invocation and never cleared, and from there on it reported every ordinary
# shell comment that happened to contain an apostrophe - the day's, session's,
# hour's, page's.  That made the file fail its lint, and this suite exits on
# that failure, so it never reached a single functional assertion.  Which is how
# a joined-up line in record_sample shipped and crash-looped the collector
# without any test noticing.
#
# A line that starts with # while no quoted region is open is a shell comment:
# the shell does not look inside it for quotes at all, so it can neither open
# nor close an awk program and an apostrophe in it is harmless.
apostrophes=$(awk '
    BEGIN { q = 0 }
    {
        if (q % 2 == 0 && $0 ~ /^[[:space:]]*#/) next
        line = $0
        n = gsub(/\x27/, "\x27", line)
        if (q % 2 == 1 && $0 ~ /^[[:space:]]*#/ && n > 0) {
            printf "  line %d: %s\n", NR, $0
            hits++
        }
        q += n
    }
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
# Completed rounds, not collected_at: the collector now writes a snapshot as soon
# as it starts, so collected_at changes before any work is done.  Waiting on the
# round counter is what "one whole round has finished" actually means.
rounds_at() { sed -n 's/.*"rounds":\([0-9]*\).*/\1/p' "$1" 2>/dev/null; }

collect() {
    local st="$1" da="$2" ct="$3" ql="$4" cap="$5"; shift 5
    local before pid i at
    # Empty means "no snapshot yet", which is round 0, not "a round finished":
    # the collector publishes a snapshot at startup with rounds=0, so waiting for
    # the value to merely differ would return before the first round has run.
    before=$(rounds_at "$st/summary.json")
    case "$before" in ''|*[!0-9]*) before=0 ;; esac

    # Started directly rather than under timeout.  Wrapping it meant killing a
    # wrapper and hoping the signal reached the collector; when it did not, the
    # survivor kept collecting in the same state directory, advanced the round
    # counter by itself, and the next phase saw "a round finished" that its own
    # collector had not run - so that run was killed before doing any work.  That
    # is what made phases 15 to 19 fail intermittently for so long.  The bound on
    # the wait below is what timeout used to provide.
    env "$@" UCI=/bin/true LUA="$T/bin/lua" CT="$ct" TRAFFIC_QUERYLOG="$ql" \
      TRAFFIC_LAN4=192.168.2. TRAFFIC_INTERVAL=2 TRAFFIC_DATADIR="$da" \
      TRAFFIC_APPMAP="$T/apps.tsv" TRAFFIC_CATEGORIES="$T/categories.tsv" \
      STATE_DIR="$st" SELF_DIR="$(cd "$SELF/../root/usr/share/traffic" && pwd)" \
      sh "$COLLECTOR" >/dev/null 2>&1 &
    pid=$!

    i=0
    while [ "$i" -lt $((cap * 5)) ]; do
        at=$(rounds_at "$st/summary.json")
        case "$at" in ''|*[!0-9]*) at=0 ;; esac
        [ "$at" -gt "$before" ] && break
        sleep 0.2
        i=$((i + 1))
    done

    # Stop it for real before the next phase touches the same state: signal it,
    # wait for it to go, and then pause briefly, because a command it had already
    # started (the resolver appends to the name map) outlives the shell and would
    # otherwise still be writing while the next phase reads.
    kill "$pid" 2>/dev/null
    i=0
    while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 60 ]; do
        sleep 0.1
        i=$((i + 1))
    done
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    sleep 0.3
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
# Asserting that the seeded minute is present, rather than that it is the last
# row: if the run happens to span a real minute boundary the collector also
# flushes the minute that just ended, so the seeded row is no longer last.  That
# took a few percent of runs to fail, which is not a property worth asserting.
chk "17 跨分钟后上一分钟落盘 series60"     "1"                 "$(awk -F'\t' '$2==4242 && $3==424 { n++ } END { print n + 0 }' "$T/data/series60.tsv")"
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
# Same reasoning as 17: the invariant is that trimming dropped the oldest
# points, not which row happens to be last when the run spans a minute boundary.
chk "18a 保留的是最新点而非最旧点"         "0"                 "$(awk -F'\t' '($2==1 && $3==1) || ($2==2 && $3==2) { n++ } END { print n + 0 }' "$T/data/series60.tsv")"

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
# The throttle window has to outlast the run or this phase cannot mean anything.
# CFG_RESOLVE defaults to 30 and run_collector was asked for 30 seconds, so the
# window expired while the collector was still running and the name resolved -
# the assertion expected the opposite and had presumably been red since the day
# it was written.  Widening the window to an hour makes the run sit well inside
# it, so "the throttle held the name back" is a statement about the throttle and
# not about how long this phase happened to take.
run_collector 30 TRAFFIC_RESOLVE=3600
chk "19 节流生效：新主机名暂不解析"        ""                  "$(nm 'newhost.meituan.com')"
chk "19a 待解析数量会上报"                 "1"                 "$(sed -n '1p' "$T/state/pending")"
: > "$T/state/resolve.now"
# resolve.now has to beat the throttle, so it is checked against the same wide
# window that just held the name back
run_collector 30 TRAFFIC_RESOLVE=3600
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
chk "21a 新版本号已写入"                    "2"                 "$(sed -n '1p' "$T/state3/version")"
chk "21b 计数器是从新数据重建的"            "72600"             "$(c3 '192.168.2.138')"
# second run: the schema now matches, so the totals must survive it untouched
run_collector_at 30 "$T/state3" "$T/data3" "$T/ct" "$T/ql"
chk "21c 版本未变时不会清空计数器"          "72600"             "$(c3 '192.168.2.138')"

echo
echo "=== 自动探测路由器自身地址（设备实走路径）==="
# Nobody sets 'self' by hand: on the router the collector finds the addresses
# itself, which is the path the field report came from and the one that has to
# keep working.  A stub 'ip' stands in for the LAN interface, link-local
# address included, because 'ip -6 addr show' prints one.
mkdir -p "$T/fakebin" "$T/state4" "$T/data4"
cat > "$T/fakebin/ip" <<'EOF'
#!/bin/sh
case "$*" in
    "-4 addr show dev br-lan")
        printf '    inet 192.168.2.1/24 brd 192.168.2.255 scope global br-lan\n' ;;
    "-6 addr show dev br-lan")
        printf '    inet6 fdc8:64ed:f962::1/64 scope global\n'
        printf '    inet6 fe80::1/64 scope link\n' ;;
esac
EOF
chmod +x "$T/fakebin/ip"
# no TRAFFIC_SELF and no TRAFFIC_LAN6: both are detected through the stub
run_collector_at 30 "$T/state4" "$T/data4" "$T/ct2" /nonexistent "PATH=$T/fakebin:$PATH"
c4() { awk -F'\t' -v ip="$1" '$1==ip {print $2}' "$T/state4/clients.tsv"; }
chk "22 自动探测到 LAN 地址并排除"          ""                  "$(c4 '192.168.2.1')"
chk "22a 自动探测到 v6 地址并排除"          ""                  "$(c4 'fdc8:64ed:f962:0000:0000:0000:0000:0001')"
chk "22b v6 客户端不受影响"                 "4400"              "$(c4 'fdc8:64ed:f962:0000:0000:0000:0000:0050')"
chk "22c 探到的地址写入快照（v4+v6，v6 已展开）" \
    "192.168.2.1 fdc8:64ed:f962:0000:0000:0000:0000:0001 fe80:0000:0000:0000:0000:0000:0000:0001" \
    "$(grep -o '"self":"[^"]*"' "$T/state4/summary.json" 2>/dev/null | cut -d'"' -f4)"
chk "22d 自动探测时自身流量仍归 router"     "5500"              "$(cat "$T/state4/router.tsv")"

echo
echo "=== 逐客户端字节计数（nft）==="
# The counters are what makes the client totals independent of the conntrack
# table.  A stub nft stands in for the kernel: it remembers which chains and
# rules were added and prints the byte counters the test sets, so rule building,
# reading, the delta and the rebuild after a firewall reload are all exercised
# offline.
mkdir -p "$T/fakebin" "$T/nft5" "$T/state5" "$T/data5"
cat > "$T/fakebin/nft" <<'EOF'
#!/bin/sh
# The table is always "<family> traffic_acct", so the chain name is the fifth
# argument for every call shape the collector uses.
S=${NFTS:?}
mkdir -p "$S"
case "$1" in
    add)
        case "$2" in
            table) : ;;
            chain) : > "$S/rules.$5" ;;
            rule)
                ch="$5"; shift 5
                printf '%s\n' "$*" >> "$S/rules.$ch" ;;
        esac ;;
    flush)
        [ "$2" = chain ] && : > "$S/rules.$5" ;;
    list)
        ch="$5"
        [ -f "$S/rules.$ch" ] || exit 1
        printf 'table inet traffic_acct {\n\tchain %s {\n' "$ch"
        while read -r line; do
            [ -n "$line" ] || continue
            a=$(printf '%s\n' "$line" | awk '{ for (i = 1; i <= NF; i++) if ($i == "saddr" || $i == "daddr") print $(i + 1) }')
            b=$(awk -v a="$a" '$1 == a { print $2 }' "$S/counters.$ch" 2>/dev/null)
            [ -n "$b" ] || b=0
            printf '\t\t%s counter packets 1 bytes %s\n' "$line" "$b"
        done < "$S/rules.$ch"
        printf '\t}\n}\n' ;;
esac
exit 0
EOF
chmod +x "$T/fakebin/nft"
# one live host, one more live host, and a stale arp entry that is not a client
cat > "$T/arp5" <<'EOF'
IP address       HW type     Flags       HW address            Mask     Device
192.168.2.50     0x1         0x2         aa:bb:cc:dd:ee:01     *        br-lan
192.168.2.51     0x1         0x2         aa:bb:cc:dd:ee:02     *        br-lan
192.168.2.99     0x1         0x0         00:00:00:00:00:00     *        br-lan
192.168.1.7      0x1         0x2         aa:bb:cc:dd:ee:03     *        br-lan
EOF
printf '192.168.2.50 1000\n192.168.2.51 0\n' > "$T/nft5/counters.pre"
printf '192.168.2.50 10000\n192.168.2.51 0\n' > "$T/nft5/counters.post"
run_collector_at 30 "$T/state5" "$T/data5" "$T/ct2" /nonexistent \
    "PATH=$T/fakebin:$PATH" "NFTS=$T/nft5" "TRAFFIC_ARPFILE=$T/arp5" \
    TRAFFIC_SELF="192.168.2.1" TRAFFIC_LAN6=fdc8:64ed:f962:
chk "23 只给真正的 LAN 邻居建计数规则"      "2"                 "$(grep -c 'saddr' "$T/nft5/rules.pre" 2>/dev/null)"
chk "23a 陈旧的 arp 表项不建规则"           "0"                 "$(grep -c '192.168.2.99' "$T/nft5/rules.pre" 2>/dev/null)"
chk "23b WAN 网段邻居不建规则"              "0"                 "$(grep -c '192.168.1.7' "$T/nft5/rules.pre" 2>/dev/null)"
# The cumulative per-client file is asserted rather than the per-round delta:
# the collector primes its baseline at startup, so by the time the runner has
# seen a completed round the delta of that first reading is already accounted
# and the delta file shows the (zero) change of the round itself.
chk "23c 下行按目的地址计（postrouting）"   "10000"             "$(awk -F'\t' '$1=="192.168.2.50"{print $2}' "$T/state5/acct.tsv")"
chk "23d 上行按源地址计（prerouting）"      "1000"              "$(awk -F'\t' '$1=="192.168.2.50"{print $3}' "$T/state5/acct.tsv")"
chk "23e 客户端总量来自计数器"              "11000"             "$(awk -F'\t' '$1=="192.168.2.50"{print $2}' "$T/state5/clients.tsv")"
chk "23f 快照报告计数层已启用"              "1"                 "$(grep -o '"acct":[0-9]*' "$T/state5/summary.json" | cut -d: -f2)"
# The Makefile substitutes the package version in at build time; here it is the
# unsubstituted placeholder, and that it is present at all is what matters: the
# page shows it so an installed fix can be told from one that is not running.
chk "23f2 快照报告采集器版本"               "dev"               "$(grep -o '"version":"[^"]*"' "$T/state5/summary.json" | cut -d'"' -f4)"
acctf() { grep -o '"accounted":{[^}]*}' "$1" | sed -n "s/.*\"$2\":\([0-9]*\).*/\1/p"; }
chk "23g 快照报告计数器总量（下行）"        "10000"             "$(acctf "$T/state5/summary.json" down)"
chk "23g2 快照报告计数器总量（上行）"       "1000"              "$(acctf "$T/state5/summary.json" up)"
# second round: only the increase is added, not the absolute counter again
printf '192.168.2.50 3000\n192.168.2.51 0\n' > "$T/nft5/counters.pre"
printf '192.168.2.50 25000\n192.168.2.51 0\n' > "$T/nft5/counters.post"
run_collector_at 30 "$T/state5" "$T/data5" "$T/ct2" /nonexistent \
    "PATH=$T/fakebin:$PATH" "NFTS=$T/nft5" "TRAFFIC_ARPFILE=$T/arp5" \
    TRAFFIC_SELF="192.168.2.1" TRAFFIC_LAN6=fdc8:64ed:f962:
chk "23h 增量累加而不是重复计入绝对值"      "3000"              "$(awk -F'\t' '$1=="192.168.2.50"{print $3}' "$T/state5/acct.tsv")"
# A new client must not reset the counters that are already running: flushing
# and rebuilding the rule set on any neighbour change would throw away the
# traffic of the interval the rebuild happened in, and neighbour entries expire
# and come back all the time.
cat >> "$T/arp5" <<'EOF'
192.168.2.52     0x1         0x2         aa:bb:cc:dd:ee:04     *        br-lan
EOF
printf '192.168.2.50 13000\n192.168.2.51 0\n192.168.2.52 700\n' > "$T/nft5/counters.pre"
printf '192.168.2.50 35000\n192.168.2.51 0\n192.168.2.52 900\n' > "$T/nft5/counters.post"
run_collector_at 30 "$T/state5" "$T/data5" "$T/ct2" /nonexistent \
    "PATH=$T/fakebin:$PATH" "NFTS=$T/nft5" "TRAFFIC_ARPFILE=$T/arp5" \
    TRAFFIC_SELF="192.168.2.1" TRAFFIC_LAN6=fdc8:64ed:f962:
chk "23h2 新增客户端不重置已有计数器"       "13000"             "$(awk -F'\t' '$1=="192.168.2.50"{print $3}' "$T/state5/acct.tsv")"
chk "23h3 新增客户端立刻开始计数"           "700"               "$(awk -F'\t' '$1=="192.168.2.52"{print $3}' "$T/state5/acct.tsv")"
chk "23h4 新客户端也建了规则"               "3"                 "$(grep -c 'saddr' "$T/nft5/rules.pre" 2>/dev/null)"
# a firewall reload flushes the whole ruleset, ours included: the chains have to
# come back, and the counters restart from a lower value
rm -f "$T/nft5/rules.pre" "$T/nft5/rules.post"
printf '192.168.2.50 200\n192.168.2.51 0\n' > "$T/nft5/counters.pre"
printf '192.168.2.50 500\n192.168.2.51 0\n' > "$T/nft5/counters.post"
run_collector_at 30 "$T/state5" "$T/data5" "$T/ct2" /nonexistent \
    "PATH=$T/fakebin:$PATH" "NFTS=$T/nft5" "TRAFFIC_ARPFILE=$T/arp5" \
    TRAFFIC_SELF="192.168.2.1" TRAFFIC_LAN6=fdc8:64ed:f962:
chk "23i 防火墙重载后计数规则自愈"          "3"                 "$(grep -c 'saddr' "$T/nft5/rules.pre" 2>/dev/null)"
chk "23j 计数器归零后按新绝对值计增量"      "35500"             "$(awk -F'\t' '$1=="192.168.2.50"{print $2}' "$T/state5/acct.tsv")"
chk "23k 累计值在之前各轮基础上继续"        "13200"             "$(awk -F'\t' '$1=="192.168.2.50"{print $3}' "$T/state5/acct.tsv")"
# without nft the client totals fall back to conntrack, and the snapshot says so
run_collector_at 30 "$T/state6" "$T/data6" "$T/ct" "$T/ql" TRAFFIC_SELF="192.168.2.1"
chk "23l 无 nft 时降级并如实上报"           "0"                 "$(grep -o '"acct":[0-9]*' "$T/state6/summary.json" | cut -d: -f2)"
chk "23m 降级原因写入快照"                  "nft is not installed" "$(grep -o '"acct_error":"[^"]*"' "$T/state6/summary.json" | cut -d'"' -f4)"
chk "23n 降级时客户端总量仍由 conntrack 给出" "72600"           "$(awk -F'\t' '$1=="192.168.2.138"{print $2}' "$T/state6/clients.tsv")"

echo
echo "=== 快照结构（页面读取的字段必须在这一层）==="
# A field written into the wrong nesting level is invisible: rpcd only checks
# that the file starts with a brace, and the page simply reads undefined.  The
# whole status strip lost its rows that way once, so the shape is asserted
# rather than assumed.  awk is used so the suite keeps working without node.
shape() {
    # top-level keys only: strip everything inside the nested objects/arrays
    sed -e 's/,"apps":\[.*$//' -e 's/^[^{]*{//' "$1" \
        | tr ',' '\n' | sed -n 's/^"\([a-z_]*\)":.*/\1/p'
}
chk "25 快照是合法 JSON（首字符）"          "{"                 "$(head -c 1 "$T/state5/summary.json")"
chk "25a 元数据在顶层：version"             "version"           "$(shape "$T/state5/summary.json" | grep -x version)"
chk "25b 元数据在顶层：acct"                "acct"              "$(shape "$T/state5/summary.json" | grep -x acct)"
chk "25c 元数据在顶层：self"                "self"              "$(shape "$T/state5/summary.json" | grep -x self)"
chk "25d 元数据在顶层：pending"             "pending"           "$(shape "$T/state5/summary.json" | grep -x pending)"
chk "25e 总量仍在 totals 内"                "1"                 "$(grep -c '"totals":{"down"' "$T/state5/summary.json")"
chk "25f 元数据没有混进 totals"             "0"                 "$(sed -n 's/.*"totals":{\([^}]*\)}.*/\1/p' "$T/state5/summary.json" | grep -c '"version"')"
# a snapshot that does not parse is worse than one that is empty, and node is
# not available on the target, so balance is checked the cheap way
chk "25g 引号成对（偶数个双引号）"          "0"                 "$(( $(tr -cd '"' < "$T/state5/summary.json" | wc -c) % 2 ))"
# A snapshot written before the first round means "no snapshot" can only mean
# the service is not running; without it, a collector stuck in round one looks
# exactly like one that never started.
chk "25h 轮次计数器在快照里"                "1"                 "$(grep -c '"rounds":[0-9]' "$T/state5/summary.json")"
mkdir -p "$T/state8" "$T/data8"
( UCI=/bin/true LUA="$T/bin/lua" CT="$T/ct" TRAFFIC_QUERYLOG="$T/ql" TRAFFIC_LAN4=192.168.2. \
  TRAFFIC_INTERVAL=30 TRAFFIC_DATADIR="$T/data8" TRAFFIC_APPMAP="$T/apps.tsv" \
  TRAFFIC_CATEGORIES="$T/categories.tsv" STATE_DIR="$T/state8" \
  SELF_DIR="$(cd "$SELF/../root/usr/share/traffic" && pwd)" \
  timeout 8 sh "$COLLECTOR" >/dev/null 2>&1 ) &
stpid=$!
i=0
while [ "$i" -lt 40 ]; do
  [ -s "$T/state8/summary.json" ] && break
  sleep 0.2; i=$((i + 1))
done
chk "25i 启动即写出快照（第一轮之前）"      "0"                 "$(rounds_at "$T/state8/summary.json")"
chk "25j 启动快照已带版本与自身地址"        "yes"               "$(grep -q '"version":"' "$T/state8/summary.json" && grep -q '"self":"' "$T/state8/summary.json" && echo yes || echo no)"
kill $stpid 2>/dev/null; wait $stpid 2>/dev/null

echo
echo "=== dnsmasq 查询日志作为第二域名来源 ==="
# On a router where passwall has taken dnsmasq over, the proxied domains are
# answered by passwall and never reach AdGuard Home, and the queries AdGuard
# does see arrive from dnsmasq instead of from the device.  dnsmasq's own log has
# both the device address and those domains.
mkdir -p "$T/state7" "$T/data7"
cat > "$T/dnsmasq.log" <<'EOF'
Aug 10 12:00:00 router daemon.info dnsmasq[1234]: query[A] www.youtube.com from 192.168.2.50
Aug 10 12:00:00 router daemon.info dnsmasq[1234]: reply www.youtube.com is 142.250.185.78
Aug 10 12:00:01 router daemon.info dnsmasq[1234]: query[AAAA] www.youtube.com from 192.168.2.50
Aug 10 12:00:01 router daemon.info dnsmasq[1234]: reply www.youtube.com is <CNAME>
Aug 10 12:00:02 router daemon.info dnsmasq[1234]: query[A] cdn.example.net from 192.168.2.51
Aug 10 12:00:02 router daemon.info dnsmasq[1234]: forwarded cdn.example.net to 127.0.0.1
Aug 10 12:00:03 router daemon.info dnsmasq[1234]: cached cdn.example.net is 203.0.113.9
Aug 10 12:00:04 router daemon.info dnsmasq[1234]: query[A] bad.example.org from 192.168.2.50
Aug 10 12:00:04 router daemon.info dnsmasq[1234]: reply bad.example.org is NODATA
EOF
run_collector_at 30 "$T/state7" "$T/data7" "$T/ct2" /nonexistent \
    "TRAFFIC_DNSLOG=$T/dnsmasq.log" TRAFFIC_SELF="192.168.2.1" TRAFFIC_LAN6=fdc8:64ed:f962:
d7() { awk -F'\t' -v d="$1" '$2==d {print $1" "$3}' "$T/state7/dnsmap.tsv"; }
chk "24 从 dnsmasq 日志取得客户端与域名"    "192.168.2.50 142.250.185.78" "$(d7 'www.youtube.com')"
chk "24a cached 行同样算作应答"             "192.168.2.51 203.0.113.9"   "$(d7 'cdn.example.net')"
chk "24b CNAME 行不算地址"                  "0"                 "$(grep -c 'CNAME' "$T/state7/dnsmap.tsv" 2>/dev/null)"
chk "24c NODATA 行不算地址"                 "0"                 "$(grep -c 'NODATA' "$T/state7/dnsmap.tsv" 2>/dev/null)"
chk "24d forwarded 行（上游地址）不算应答"  "0"                 "$(grep -c '	127.0.0.1$' "$T/state7/dnsmap.tsv" 2>/dev/null)"
chk "24e 域名已归一化为小写"                "192.168.2.50 142.250.185.78" "$(d7 'www.youtube.com')"
# incremental: only what is new is read, so a repeated run must not duplicate
before=$(grep -c . "$T/state7/dnsmap.tsv")
cat >> "$T/dnsmasq.log" <<'EOF'
Aug 10 12:00:09 router daemon.info dnsmasq[1234]: query[A] news.example.com from 192.168.2.51
Aug 10 12:00:09 router daemon.info dnsmasq[1234]: reply news.example.com is 198.51.100.7
EOF
run_collector_at 30 "$T/state7" "$T/data7" "$T/ct2" /nonexistent \
    "TRAFFIC_DNSLOG=$T/dnsmasq.log" TRAFFIC_SELF="192.168.2.1" TRAFFIC_LAN6=fdc8:64ed:f962:
chk "24f 只读取新增部分"                    "$((before + 1))"  "$(grep -c . "$T/state7/dnsmap.tsv")"
chk "24g 新增段的域名也拿到了"              "192.168.2.51 198.51.100.7" "$(d7 'news.example.com')"

echo
echo "=== 整点滚动：hourly.tsv 与 series1h.tsv ==="
# roll_hour is the only writer of both files, and it runs when the hour string
# changes - which a test cannot wait for.  A date stub that serves the hour from
# a file makes the rollover happen on demand while every other date call (the
# epoch a sample is stamped with) still goes to the real clock.
REALDATE=$(command -v date)
mkdir -p "$T/bin" "$T/state9" "$T/data9"
printf '%s\n' "$SCHEMA" > "$T/state9/version"   # matching schema, so what is seeded stays
printf 'YouTube\t1000\t5000\n' > "$T/state9/totals.tsv"   # name, up, down
printf '192.168.2.99\t6000\n'  > "$T/state9/clients.tsv"
printf '777\n'                 > "$T/state9/router.tsv"
printf 'h0\n' > "$T/fakehour"
cat > "$T/bin/date" <<EOF
#!/bin/sh
case "\$1" in
    +%Y-%m-%dT%H) cat "$T/fakehour" 2>/dev/null ;;
    *) exec "$REALDATE" "\$@" ;;
esac
EOF
chmod +x "$T/bin/date"
: > "$T/ctempty"

wait_rounds() {
    local st="$1" want="$2" i=0 at
    while [ "$i" -lt 150 ]; do
        at=$(rounds_at "$st/summary.json")
        case "$at" in ''|*[!0-9]*) at=0 ;; esac
        [ "$at" -ge "$want" ] && return 0
        sleep 0.2
        i=$((i + 1))
    done
    return 1
}

PATH="$T/bin:$PATH" UCI=/bin/true LUA="$T/bin/lua" CT="$T/ctempty" \
  TRAFFIC_QUERYLOG=/nonexistent TRAFFIC_LAN4=192.168.2. TRAFFIC_INTERVAL=2 \
  TRAFFIC_DATADIR="$T/data9" TRAFFIC_APPMAP="$T/apps.tsv" \
  TRAFFIC_CATEGORIES="$T/categories.tsv" STATE_DIR="$T/state9" \
  SELF_DIR="$(cd "$SELF/../root/usr/share/traffic" && pwd)" \
  sh "$COLLECTOR" >/dev/null 2>&1 &
hpid=$!
# One round in the old hour, then turn the clock over and let it roll once.
wait_rounds "$T/state9" 1
printf 'h1\n' > "$T/fakehour"
wait_rounds "$T/state9" 3
# A second rollover with no traffic in between.  The history has to gain its
# point but not a second copy of the bytes the first roll already archived, and
# the live counters have to survive it untouched - that difference is the whole
# point of snapshotting and differencing instead of resetting.
printf 'h2\n' > "$T/fakehour"
wait_rounds "$T/state9" 5
kill "$hpid" 2>/dev/null
wait "$hpid" 2>/dev/null
sleep 0.3

h9="$T/data9/hourly.tsv"
# The archived row is <hour>\t<kind>\t<name>\t<down>\t<up>, which is the layout the
# backend reads.  Seeded asymmetrically on purpose: equal numbers would hide a
# swap, and a swap is exactly what this asserts against.
chk "26 整点应用行下/上未错位"              "5000/1000" "$(awk -F'\t' '$2=="app"    && $3=="YouTube" { printf "%s/%s", $4, $5 }' "$h9")"
chk "26a 整点客户端行记字节数"              "6000/0"    "$(awk -F'\t' '$2=="client" { printf "%s/%s", $4, $5 }' "$h9")"
chk "26b 整点隧道行记路由器自身流量"        "777"       "$(awk -F'\t' '$2=="router" { printf "%s", $4 }' "$h9")"
chk "26c 整点只归档一次"                    "1"         "$(awk -F'\t' '$2=="router"' "$h9" | wc -l | tr -d ' ')"
chk "26d 归档行数 = 三类各一行"             "3"         "$(grep -c . "$h9")"
# The week tier is one point per hour, and its down column carries the router
# total as well, because the box's own traffic belongs to the hour too.
chk "26e series1h 下行含路由器流量"         "5777"      "$(cut -f2 "$T/data9/series1h.tsv" | head -n 1)"
chk "26f series1h 上行"                     "1000"      "$(cut -f3 "$T/data9/series1h.tsv" | head -n 1)"
chk "26g series1h 每次滚动一个点"           "2"         "$(grep -c . "$T/data9/series1h.tsv")"
chk "26h series1h 无流量的小时为 0"         "0/0"       "$(sed -n '2p' "$T/data9/series1h.tsv" | cut -f2,3 | tr '\t' '/')"
# The second roll had nothing new to archive, and the live counters it measured
# against are still there: zeroing them here is what used to make the page lose
# the session's traffic at the top of every hour.
chk "26i 第二次滚动不重复归档"              "3"         "$(grep -c . "$h9")"
chk "26j 整点不再清空应用累计"              "5000"      "$(awk -F'\t' '$1=="YouTube"{print $3}' "$T/state9/totals.tsv")"
chk "26k 整点不再清空路由器累计"            "777"       "$(sed -n '1p' "$T/state9/router.tsv")"

echo
echo "=== WAN 接口计数器：权威总量与曲线 ==="
# Under flow offloading the attribution layer only sees a fraction of what the
# box carried - measured on the router, conntrack recorded 147 MiB while the WAN
# device carried 2579 MiB, 5.7% - so the totals, the series and the peak are
# taken from the WAN device's own counters instead.  Both the routing table that
# names the device and /proc/net/dev itself are overridable, which is what lets
# this run without a router.  eth2 carries rx=5000000, tx=800000.
#
# Every phase here is deterministic on purpose: the fake device counters never
# change, so a round contributes either the seeded difference or nothing at all,
# and the assertions hold however many rounds the collector manages to finish
# before it is stopped.
mkdir -p "$T/state10" "$T/data10" "$T/state11" "$T/data11" \
         "$T/state12" "$T/data12" "$T/state13" "$T/data13"
cat > "$T/netdev" <<'EOF'
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:    1000       10    0    0    0     0          0         0     1000       10    0    0    0     0       0          0
  eth2: 5000000     4000    0    0    0     0          0         0   800000     3000    0    0    0     0       0          0
EOF
: > "$T/netdev-noif"
printf 'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n' > "$T/route"
printf 'eth2\t00000000\t0102A8C1\t0003\t0\t0\t0\t00000000\t0\t0\t0\n' >> "$T/route"
NETW="TRAFFIC_PROC_NET_DEV=$T/netdev"
RTW="TRAFFIC_PROC_NET_ROUTE=$T/route"
NO6="TRAFFIC_PROC_NET_ROUTE6=/nonexistent"

# No explicit device setting: the default route is what names it, so this covers
# the /proc/net/route parse as well.
run_collector_at 30 "$T/state10" "$T/data10" "$T/ct2" /nonexistent "$NETW" "$RTW" "$NO6"
chk "27  默认路由识别出 WAN 设备"            "eth2" \
    "$(sed -n 's/.*"iface":{"dev":"\([^"]*\)".*/\1/p' "$T/state10/summary.json")"
# The device has counted 5000000 bytes since it came up.  None of that is this
# session's traffic, and a first round that added it would publish a total the
# box never carried in the session being shown.
chk "27a 首次读取只做基线不累加"             "0/0" \
    "$(sed -n 's/.*"iface":{[^}]*"down":\([0-9]*\),"up":\([0-9]*\).*/\1\/\2/p' "$T/state10/summary.json")"
chk "27b 首次读取不写负值"                   "0" "$(grep -c -- '-' "$T/state10/wan.tsv")"

# The curve is the whole point of this fix: it has to be the traffic the box
# carried, because that is what a speed test looks like on the chart.  Its own
# device file is used so the bump below cannot disturb the phases around it, and
# the conntrack file for this phase is empty - so the attributed sample for a
# round is zero, and a series point that is not zero can only have come from the
# interface counters.  The device counters are bumped between two rounds, which
# makes the size of that point exactly the bump: the pass before the first round
# absorbs the starting values as its baseline, and round two is the only round
# that sees the change.
cat > "$T/netdev11" <<'EOF'
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
  eth2: 5000000     4000    0    0    0     0          0         0   800000     3000    0    0    0     0       0          0
EOF
: > "$T/ctempty11"
env UCI=/bin/true LUA="$T/bin/lua" CT="$T/ctempty11" \
  TRAFFIC_QUERYLOG=/nonexistent TRAFFIC_LAN4=192.168.2. TRAFFIC_INTERVAL=2 \
  TRAFFIC_DATADIR="$T/data11" TRAFFIC_APPMAP="$T/apps.tsv" \
  TRAFFIC_CATEGORIES="$T/categories.tsv" STATE_DIR="$T/state11" \
  SELF_DIR="$(cd "$SELF/../root/usr/share/traffic" && pwd)" \
  "TRAFFIC_PROC_NET_DEV=$T/netdev11" "TRAFFIC_PROC_NET_ROUTE=$T/route" \
  TRAFFIC_PROC_NET_ROUTE6=/nonexistent \
  sh "$COLLECTOR" >/dev/null 2>&1 &
i11=$!
wait_rounds "$T/state11" 1
cat > "$T/netdev11" <<'EOF'
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
  eth2: 5005000     4100    0    0    0     0          0         0   801000     3000    0    0    0     0       0          0
EOF
wait_rounds "$T/state11" 2
kill "$i11" 2>/dev/null
wait "$i11" 2>/dev/null
sleep 0.3
chk "27c 会话总量取自接口计数器的增量"       "5000/1000" \
    "$(sed -n '1p' "$T/state11/wan.tsv")/$(sed -n '2p' "$T/state11/wan.tsv")"
chk "27d 快照总量取自接口计数器"             "5000/1000" \
    "$(sed -n 's/.*"iface":{[^}]*"down":\([0-9]*\),"up":\([0-9]*\).*/\1\/\2/p' "$T/state11/summary.json")"
chk "27e 曲线点取自接口增量而非归属值"       "5000/1000" \
    "$(sed -n '2p' "$T/state11/series10.tsv" | cut -f2,3 | tr '\t' '/')"

# A counter that went backwards means the device was re-created.  Its new reading
# is traffic nothing has accounted for yet; what this guards against is arithmetic
# on unsigned values, which turns a negative difference into an enormous total.
# The version file has to match, or init_state() drops the seeded baseline as
# stale state and the phase would silently test the first-reading path instead.
printf '%s\n' "$SCHEMA" > "$T/state12/version"
printf '9999999\n9999999\n' > "$T/state12/wan.abs"
run_collector_at 30 "$T/state12" "$T/data12" "$T/ct2" /nonexistent "$NETW" "$RTW" "$NO6"
chk "27f 计数回退后按新读数计"               "$(printf '5000000/800000')" \
    "$(sed -n '1p' "$T/state12/wan.tsv")/$(sed -n '2p' "$T/state12/wan.tsv")"
chk "27g 计数回退后没有负值"                 "0" "$(grep -c -- '-' "$T/state12/wan.tsv")"

# No device to measure: the key is not published at all, which is what the page
# reads as "fall back to the attributed numbers" rather than "the total is zero".
run_collector_at 30 "$T/state13" "$T/data13" "$T/ct2" /nonexistent \
    "TRAFFIC_PROC_NET_DEV=$T/netdev-noif" "TRAFFIC_WAN_IF=eth2" \
    "TRAFFIC_PROC_NET_ROUTE=/nonexistent" "$NO6"
chk "27h 设备不存在时不发布 iface"           "0" "$(grep -c '"iface"' "$T/state13/summary.json")"
chk "27i 设备不存在时不写接口累计"           "no" \
    "$([ -f "$T/state13/wan.tsv" ] && echo yes || echo no)"

# Whether the firewall offloads is always published, because it is what decides
# whether the attribution beside the total is a large share or a small one.
chk "27j 快照发布卸载状态"                   "0" \
    "$(sed -n 's/.*"offload":\([0-9]*\).*/\1/p' "$T/state10/summary.json")"

# The protocol buckets are the attribution's last resort, not applications: at
# about a third of the attributed traffic, listed among the applications they read
# as if an app called "SSL/TLS" had been used.
protoflag() {
    awk -v w="$1" 'BEGIN { RS = "{" }
        index($0, "\"name\":\"" w "\"") > 0 {
            print (index($0, "\"proto\":1") > 0) ? 1 : 0; exit
        }' "$2"
}
chk "27k 协议桶被打上 proto 标记"            "1" "$(protoflag 'SSL/TLS' "$T/state/summary.json")"
chk "27l 真实应用没有 proto 标记"            "0" "$(protoflag 'NetEase Music' "$T/state/summary.json")"

# A device that disappears mid-session.  The delta of the round it vanished in
# must not sit on disk and be drawn again by every later round - with an empty
# conntrack file the fallback sample is zero, so a repeated 5000 would mean the
# stale delta was reused, and the session total would keep growing on a device
# nobody can measure any more.
cat > "$T/netdev14" <<'EOF'
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
  eth2: 5000000     4000    0    0    0     0          0         0   800000     3000    0    0    0     0       0          0
EOF
env UCI=/bin/true LUA="$T/bin/lua" CT="$T/ctempty11" \
  TRAFFIC_QUERYLOG=/nonexistent TRAFFIC_LAN4=192.168.2. TRAFFIC_INTERVAL=2 \
  TRAFFIC_DATADIR="$T/data14" TRAFFIC_APPMAP="$T/apps.tsv" \
  TRAFFIC_CATEGORIES="$T/categories.tsv" STATE_DIR="$T/state14" \
  SELF_DIR="$(cd "$SELF/../root/usr/share/traffic" && pwd)" \
  "TRAFFIC_PROC_NET_DEV=$T/netdev14" "TRAFFIC_PROC_NET_ROUTE=$T/route" \
  TRAFFIC_PROC_NET_ROUTE6=/nonexistent \
  sh "$COLLECTOR" >/dev/null 2>&1 &
i14=$!
wait_rounds "$T/state14" 1
cat > "$T/netdev14" <<'EOF'
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
  eth2: 5005000     4100    0    0    0     0          0         0   801000     3000    0    0    0     0       0          0
EOF
wait_rounds "$T/state14" 2
: > "$T/netdev14"
wait_rounds "$T/state14" 3
kill "$i14" 2>/dev/null
wait "$i14" 2>/dev/null
sleep 0.3
chk "27m 设备消失后不再复用上一轮增量"       "0/0" \
    "$(sed -n '3p' "$T/state14/series10.tsv" | cut -f2,3 | tr '\t' '/')"
chk "27n 设备消失后会话总量不再增长"         "5000/1000" \
    "$(sed -n '1p' "$T/state14/wan.tsv")/$(sed -n '2p' "$T/state14/wan.tsv")"

echo
if [ "$fail" = 0 ]; then echo "=== 全部通过 ==="; else echo "=== 有失败 ==="; fi
exit "$fail"

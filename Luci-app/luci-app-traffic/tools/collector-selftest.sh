#!/bin/bash
# collector-selftest.sh - offline regression for luci-app-traffic's collector.
#
# Runs collector.sh against a synthetic conntrack snapshot, a stub lua (real
# AdGuard Home querylog answers are exercised separately by ans-check.js) and
# small apps/categories tables, then asserts every attribution path:
#
#   1. full host name hit in apps.tsv          (music.163.com -> NetEase Music)
#   2. registrable-domain hit in apps.tsv      (www.taobao.com -> Taobao)
#   3. category suffix hit                     (x.fastly.net    -> CDN)
#   4. no table entry at all                   (shop.example.com-> example.com)
#   5. no DNS answer, protocol bucket          (443/tcp -> SSL/TLS, 443/udp -> QUIC,
#                                               554/tcp -> RTSP)
#   6. the same address:port over tcp and udp counted separately
#   7. router-originated traffic kept out of the application list (proxy tunnel)
#
#   bash collector-selftest.sh
set -u

SELF="$(cd "$(dirname "$0")" && pwd)"
COLLECTOR="$(cd "$SELF/.." && pwd)/root/usr/share/traffic/collector.sh"
[ -f "$COLLECTOR" ] || { echo "collector.sh not found next to $SELF" >&2; exit 1; }

echo "=== sh -n ==="
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

# stub lua: swallow the querylog lines and emit fixed (client, domain, ip) rows
cat > "$T/bin/lua" <<'EOF'
#!/bin/sh
n=0
while read -r _; do n=$((n+1)); done
[ "$n" -gt 0 ] || exit 0
printf '192.168.2.138\tmusic.163.com\t1.1.1.1\n'
printf '192.168.2.138\twww.taobao.com\t2.2.2.2\n'
printf '192.168.2.138\tx.fastly.net\t3.3.3.3\n'
printf '192.168.2.138\tshop.example.com\t4.4.4.4\n'
exit 0
EOF
chmod +x "$T/bin/lua"

printf 'NetEase Music\tmusic.163.com\nTaobao\ttaobao.com\n' > "$T/apps.tsv"
printf 'CDN\tfastly.net\nAds\tdoubleclick.net\n'         > "$T/categories.tsv"
printf '{"IP":"192.168.2.138","QH":"x","Answer":"y"}\n'  > "$T/ql"

# one flow per line; "tcp"/"udp" is the protocol field
cat > "$T/ct" <<'EOF'
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=1.1.1.1 sport=1001 dport=443 packets=1 bytes=100 tos=0 src=1.1.1.1 dst=192.168.2.138 sport=443 dport=1001 packets=1 bytes=1000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=2.2.2.2 sport=1002 dport=443 packets=1 bytes=200 tos=0 src=2.2.2.2 dst=192.168.2.138 sport=443 dport=1002 packets=1 bytes=2000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=3.3.3.3 sport=1003 dport=443 packets=1 bytes=300 tos=0 src=3.3.3.3 dst=192.168.2.138 sport=443 dport=1003 packets=1 bytes=3000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=4.4.4.4 sport=1004 dport=443 packets=1 bytes=400 tos=0 src=4.4.4.4 dst=192.168.2.138 sport=443 dport=1004 packets=1 bytes=4000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=5.5.5.5 sport=1005 dport=443 packets=1 bytes=500 tos=0 src=5.5.5.5 dst=192.168.2.138 sport=443 dport=1005 packets=1 bytes=5000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 udp 17 119 src=192.168.2.138 dst=5.5.5.5 sport=1006 dport=443 packets=1 bytes=600 tos=0 src=5.5.5.5 dst=192.168.2.138 sport=443 dport=1006 packets=1 bytes=6000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.2.138 dst=6.6.6.6 sport=1007 dport=554 packets=1 bytes=700 tos=0 src=6.6.6.6 dst=192.168.2.138 sport=554 dport=1007 packets=1 bytes=7000 tos=0 [ASSURED] mark=0 zone=0 use=2
ipv4 2 tcp 6 119 ESTABLISHED src=192.168.1.6 dst=45.149.157.234 sport=1008 dport=443 packets=1 bytes=800 tos=0 src=45.149.157.234 dst=192.168.1.6 sport=443 dport=1008 packets=1 bytes=8000 tos=0 [ASSURED] mark=0 zone=0 use=2
EOF

UCI=/bin/true LUA="$T/bin/lua" CT="$T/ct" TRAFFIC_QUERYLOG="$T/ql" TRAFFIC_LAN4=192.168.2. \
  TRAFFIC_INTERVAL=2 TRAFFIC_DATADIR="$T/data" \
  TRAFFIC_APPMAP="$T/apps.tsv" TRAFFIC_CATEGORIES="$T/categories.tsv" \
  STATE_DIR="$T/state" SELF_DIR="$(cd "$SELF/../root/usr/share/traffic" && pwd)" \
  timeout 8 sh "$COLLECTOR" >/dev/null 2>&1

echo
echo "--- totals ---"
cat "$T/state/totals.tsv"
echo "--- router ---"; cat "$T/state/router.tsv"
echo "--- stat  ---"; cat "$T/state/stat.tsv"

echo
echo "=== 断言 ==="
fail=0
row() { awk -F'\t' -v n="$1" '$1==n {print $2"/"$3}' "$T/state/totals.tsv"; }
chk() { if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (expect '$2', got '$3')"; fail=1; fi; }

chk "1 精确主机名命中 apps.tsv"        "100/1000" "$(row 'NetEase Music')"
chk "2 可注册域名回退命中 apps.tsv"    "200/2000" "$(row 'Taobao')"
chk "3 类别后缀命中 -> CDN"            "300/3000" "$(row 'CDN')"
chk "4 无表项 -> 站点自身域名"          "400/4000" "$(row 'example.com')"
chk "5a 无 DNS + tcp/443 -> SSL/TLS"   "500/5000" "$(row 'SSL/TLS')"
chk "5b 无 DNS + udp/443 -> QUIC"      "600/6000" "$(row 'QUIC')"
chk "5c 无 DNS + tcp/554 -> RTSP"      "700/7000" "$(row 'RTSP')"
chk "6 隧道流单独统计"                  "8800"     "$(cat "$T/state/router.tsv")"
chk "7 三类计数合计 = 客户端总量"       "30800"    "$(awk -F'\t' '{s+=$1+$2+$3+$4} END{print s+0}' "$T/state/stat.tsv")"
chk "7a 命名(exact)"                   "7700"     "$(cut -f1 "$T/state/stat.tsv")"
chk "7b 命名(any)"                     "0"        "$(cut -f2 "$T/state/stat.tsv")"
chk "7c 分类归入"                      "3300"     "$(cut -f3 "$T/state/stat.tsv")"
chk "7d 其他（协议桶）"                "19800"    "$(cut -f4 "$T/state/stat.tsv")"
chk "8 隧道未混入应用列表"              "7"        "$(grep -c . "$T/state/totals.tsv")"
# read a field out of the snapshot's totals object only - a bare grep for
# "down": would also match every per-application entry
tot() { grep -o '"totals":{[^}]*}' "$T/state/summary.json" | grep -o "\"$1\":[0-9]*" | cut -d: -f2; }
chk "9 快照 totals.down"               "28000"    "$(tot down)"
chk "9a 快照 totals.up"                "2800"     "$(tot up)"
chk "9b 快照 totals.router"            "8800"     "$(tot router)"

echo
if [ "$fail" = 0 ]; then echo "=== 全部通过 ==="; else echo "=== 有失败 ==="; fi
exit "$fail"

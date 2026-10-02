#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
AWK="$ROOT/root/usr/share/router-status/wifi-delta.awk"
STAT_AWK="$ROOT/root/usr/share/router-status/wifi-stat.awk"
HISTORY_AWK="$ROOT/root/usr/share/router-status/wifi-history.awk"
COLLECTOR_SHELL="${WIFI_TEST_SHELL:-sh}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/stat" <<'EOF'
Tx success                      = 3467814
Tx fail count                   = 223665, PER=6.0%
Rx success                      = 13846075
Rx with CRC                     = 2649709, PER=16.0%
Rssi: -63 -65 -57 -127 -127
EOF
awk -f "$STAT_AWK" "$TMP/stat" > "$TMP/parsed"
grep -Fqx '3467814	223665	13846075	2649709' "$TMP/parsed"

cat > "$TMP/previous" <<'EOF'
P	MT7990_1_2	100	1000	100	2000	100	100000	50000
EOF
cat > "$TMP/current" <<'EOF'
C	MT7990_1_2	160	1120	110	2300	105	160000	80000
EOF
awk -F '\t' -f "$AWK" "$TMP/previous" "$TMP/current" > "$TMP/result"
grep -Fqx 'N	MT7990_1_2	160	1120	110	2300	105	160000	80000' "$TMP/result"
grep -Fqx 'H	160	MT7990_1_2	1000	500	7.7	1.6' "$TMP/result"

cat > "$TMP/current" <<'EOF'
C	MT7990_1_2	220	5	0	7	0	100	50
EOF
awk -F '\t' -f "$AWK" "$TMP/previous" "$TMP/current" > "$TMP/result"
if grep -q '^H' "$TMP/result"; then
    echo 'counter reset created a history point' >&2
    exit 1
fi

cat > "$TMP/current" <<'EOF'
C	MT7990_1_2	160	-1	-1	-1	-1	160000	80000
EOF
awk -F '\t' -f "$AWK" "$TMP/previous" "$TMP/current" > "$TMP/result"
grep -Fqx 'H	160	MT7990_1_2	1000	500	-	-' "$TMP/result"

cat > "$TMP/jshn.sh" <<'EOF'
json_load() { [ -n "$1" ]; CURRENT=root; }
json_select() {
    case "$1" in
        radios) CURRENT=radios ;;
        1) CURRENT=radio ;;
        ..) CURRENT=radios ;;
        *) return 1 ;;
    esac
}
json_get_keys() { [ -n "$2" ] && :; eval "$1='1'"; }
json_get_var() {
    case "$2" in
        name) value=MT7990_1_2 ;;
        ifname) value=rai0 ;;
        up) value=1 ;;
        *) value='' ;;
    esac
    eval "$1=\$value"
}
EOF
# Exercise the production JSON library when supplied by CI, rather than only
# the lightweight fixture. Only the external JSON decoder is replaced.
if [ -n "${WIFI_TEST_JSHN_LIBRARY:-}" ]; then
    cp "$WIFI_TEST_JSHN_LIBRARY" "$TMP/jshn.sh"
    cat >> "$TMP/jshn.sh" <<'REALJSON'
json_load() {
    json_init
    json_add_array radios
    json_add_object ''
    json_add_string name MT7990_1_2
    json_add_string ifname rai0
    json_add_boolean up 1
    json_close_object
    json_close_array
}
REALJSON
fi

cat > "$TMP/rpcd" <<'EOF'
#!/bin/sh
printf '%s\n' '{"radios":[{"name":"MT7990_1_2","ifname":"rai0","up":true}]}'
EOF
cat > "$TMP/iwpriv" <<'EOF'
#!/bin/sh
cat "$WIFI_TEST_STAT"
EOF
chmod +x "$TMP/rpcd" "$TMP/iwpriv"
mkdir -p "$TMP/net/rai0/statistics" "$TMP/state"
printf '%s\n' 100000 > "$TMP/net/rai0/statistics/rx_bytes"
printf '%s\n' 50000 > "$TMP/net/rai0/statistics/tx_bytes"
WIFI_STATE_DIR="$TMP/state" WIFI_RPCD="$TMP/rpcd" \
    WIFI_IWPRIV="$TMP/iwpriv" WIFI_JSHN="$TMP/jshn.sh" \
    WIFI_SYS_NET="$TMP/net" WIFI_STAT_AWK="$STAT_AWK" WIFI_DELTA_AWK="$AWK" WIFI_HISTORY_AWK="$HISTORY_AWK" \
    WIFI_TEST_STAT="$TMP/stat" WIFI_NOW=100 \
    "$COLLECTOR_SHELL" "$ROOT/root/usr/share/router-status/wifi-collector.sh" once

# A prior sample in the same public five-minute bucket must be replaced.
printf '130\tMT7990_1_2\t400\t200\t-\t-\n' > "$TMP/state/wifi-history.tsv"

sed 's/3467814/3467934/; s/223665/223675/; s/13846075/13846375/; s/2649709/2649714/' \
    "$TMP/stat" > "$TMP/stat2"
printf '%s\n' 160000 > "$TMP/net/rai0/statistics/rx_bytes"
printf '%s\n' 80000 > "$TMP/net/rai0/statistics/tx_bytes"
WIFI_STATE_DIR="$TMP/state" WIFI_RPCD="$TMP/rpcd" \
    WIFI_IWPRIV="$TMP/iwpriv" WIFI_JSHN="$TMP/jshn.sh" \
    WIFI_SYS_NET="$TMP/net" WIFI_STAT_AWK="$STAT_AWK" WIFI_DELTA_AWK="$AWK" WIFI_HISTORY_AWK="$HISTORY_AWK" \
    WIFI_TEST_STAT="$TMP/stat2" WIFI_NOW=160 \
    "$COLLECTOR_SHELL" "$ROOT/root/usr/share/router-status/wifi-collector.sh" once
grep -Fqx '160	MT7990_1_2	1000	500	7.7	1.6' "$TMP/state/wifi-history.tsv"

[ "$(wc -l < "$TMP/state/wifi-history.tsv")" -eq 1 ] || { echo 'redundant minute samples retained in one public bucket' >&2; exit 1; }

# One complete aligned day: three radios, 1,440 minute samples each.
# Storage must match the already public last-sample-per-five-minute view.
awk 'BEGIN { OFS="\t"; for (n=0;n<1440;n++) for(r=1;r<=3;r++)
    print 288000+n*60, "radio" r, n, r, "-", "-" }' > "$TMP/full-day"
awk -F '\t' -v cutoff=288000 -f "$HISTORY_AWK" "$TMP/full-day" > "$TMP/compact-day"
awk 'BEGIN { OFS="\t"; for (n=4;n<1440;n+=5) for(r=1;r<=3;r++)
    print 288000+n*60, "radio" r, n, r, "-", "-" }' > "$TMP/expected-day"
cmp "$TMP/expected-day" "$TMP/compact-day"
[ "$(wc -l < "$TMP/compact-day")" -eq 864 ]
awk 'BEGIN { OFS="\t"; for (r=1;r<=12010;r++)
    print 288000, "radio" r, 0, 0, "-", "-" }' > "$TMP/large-history"
awk -F '\t' -v cutoff=288000 -f "$HISTORY_AWK" "$TMP/large-history" > "$TMP/capped-history"
[ "$(wc -l < "$TMP/capped-history")" -eq 12000 ]
printf '287999\tradio1\t1\t1\t-\t-\n300000\tbad"name\t1\t1\t-\t-\n' > "$TMP/invalid-history"
awk -F '\t' -v cutoff=288000 -f "$HISTORY_AWK" "$TMP/invalid-history" > "$TMP/filtered-history"
[ ! -s "$TMP/filtered-history" ]

# A clock rollback must retain a revisited bucket as a new segment.
printf '3600\tradio1\t1\t1\t-\t-\n3900\tradio1\t2\t2\t-\t-\n3600\tradio1\t3\t3\t-\t-\n' > "$TMP/rollback"
awk -F '\t' -v cutoff=0 -f "$HISTORY_AWK" "$TMP/rollback" > "$TMP/rollback-actual"
cmp "$TMP/rollback" "$TMP/rollback-actual"

# The reported device fault was a daemon crash loop, not merely bad output.
WIFI_STATE_DIR="$TMP/state" WIFI_RPCD="$TMP/rpcd" \
    WIFI_IWPRIV="$TMP/iwpriv" WIFI_JSHN="$TMP/jshn.sh" \
    WIFI_SYS_NET="$TMP/net" WIFI_STAT_AWK="$STAT_AWK" WIFI_DELTA_AWK="$AWK" WIFI_HISTORY_AWK="$HISTORY_AWK" \
    WIFI_TEST_STAT="$TMP/stat2" WIFI_NOW=220 WIFI_SAMPLE_SECONDS=1 \
    "$COLLECTOR_SHELL" "$ROOT/root/usr/share/router-status/wifi-collector.sh" \
    > "$TMP/daemon.log" 2>&1 &
daemon_pid=$!
sleep 3
if ! kill -0 "$daemon_pid" 2>/dev/null; then
    cat "$TMP/daemon.log" >&2
    echo 'wireless sampler exited during repeated sampling' >&2
    exit 1
fi
kill "$daemon_pid"
wait "$daemon_pid" 2>/dev/null || :

echo 'Wi-Fi counter history: PASS'

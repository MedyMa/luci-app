#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
AWK="$ROOT/root/usr/share/router-status/wifi-delta.awk"
STAT_AWK="$ROOT/root/usr/share/router-status/wifi-stat.awk"
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
json_get_keys() { eval "$1='1'"; }
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
    WIFI_SYS_NET="$TMP/net" WIFI_STAT_AWK="$STAT_AWK" WIFI_DELTA_AWK="$AWK" \
    WIFI_TEST_STAT="$TMP/stat" WIFI_NOW=100 \
    sh "$ROOT/root/usr/share/router-status/wifi-collector.sh" once

sed 's/3467814/3467934/; s/223665/223675/; s/13846075/13846375/; s/2649709/2649714/' \
    "$TMP/stat" > "$TMP/stat2"
printf '%s\n' 160000 > "$TMP/net/rai0/statistics/rx_bytes"
printf '%s\n' 80000 > "$TMP/net/rai0/statistics/tx_bytes"
WIFI_STATE_DIR="$TMP/state" WIFI_RPCD="$TMP/rpcd" \
    WIFI_IWPRIV="$TMP/iwpriv" WIFI_JSHN="$TMP/jshn.sh" \
    WIFI_SYS_NET="$TMP/net" WIFI_STAT_AWK="$STAT_AWK" WIFI_DELTA_AWK="$AWK" \
    WIFI_TEST_STAT="$TMP/stat2" WIFI_NOW=160 \
    sh "$ROOT/root/usr/share/router-status/wifi-collector.sh" once
grep -Fqx '160	MT7990_1_2	1000	500	7.7	1.6' "$TMP/state/wifi-history.tsv"

echo 'Wi-Fi counter history: PASS'

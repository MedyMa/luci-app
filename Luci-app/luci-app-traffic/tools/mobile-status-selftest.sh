#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
RPCD=${RPCD_SRC:-"$ROOT/root/usr/libexec/rpcd/luci.traffic"}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/jshn.sh" <<'EOF'
json_init() { CURRENT=root; }
json_load() { CURRENT=root; [ -n "$1" ]; }
json_get_keys() {
    if [ "$CURRENT" = interfaces ]; then eval "$1='1'"
    else eval "$1='MT7990_1_1 MT7990_1_2 MT7990_2'"; fi
}
json_select() {
    case "$1" in
        ..) case "$CURRENT" in config|interfaces) CURRENT="$RADIO" ;; iface) CURRENT=interfaces ;; *) CURRENT=root ;; esac ;;
        config) [ "$CURRENT" != root ] || return 1; CURRENT=config ;;
        interfaces) CURRENT=interfaces ;;
        1) [ "$CURRENT" = interfaces ] || return 1; CURRENT=iface ;;
        *) RADIO="$1"; CURRENT="$1" ;;
    esac
}
json_get_var() {
    case "$2" in
        up) value=1 ;;
        band) case "$RADIO" in MT7990_1_1) value=2g ;; MT7990_1_2) value=5g ;; *) value=6g ;; esac ;;
        channel) case "$RADIO" in MT7990_1_1) value=3 ;; MT7990_1_2) value=40 ;; *) value=37 ;; esac ;;
        htmode) case "$RADIO" in MT7990_1_1) value=EHT40 ;; MT7990_1_2) value=EHT160 ;; *) value=EHT320 ;; esac ;;
        ifname) case "$RADIO" in MT7990_1_1) value=ra0 ;; MT7990_1_2) value=rai0 ;; *) value=rax0 ;; esac ;;
        *) value='' ;;
    esac
    eval "$1=\$value"
}
json_add_object() { printf 'object:%s\n' "$1"; }
json_close_object() { :; }
json_add_array() { printf 'array:%s\n' "$1"; }
json_close_array() { :; }
json_add_string() { printf '%s=%s\n' "$1" "$2"; }
json_add_boolean() { printf '%s=%s\n' "$1" "$2"; }
json_dump() { :; }
EOF

sed "s#^\. /usr/share/libubox/jshn\.sh#. $TMP/jshn.sh#" "$RPCD" > "$TMP/rpcd"
cat > "$TMP/ubus" <<'EOF'
#!/bin/sh
printf '%s\n' '{"MT7990_1_1":{"up":true,"config":{"band":"2g","channel":"3","htmode":"EHT40","key":"never-expose"},"interfaces":[{"ifname":"ra0","config":{"key":"never-expose"}}]}}'
EOF
chmod +x "$TMP/ubus"
mkdir -p "$TMP/net/rai0"
printf '%s\n' '02:11:22:33:44:55' > "$TMP/net/rai0/address"
printf 'cpu 10 20 30 40 50 60 70 80 90 100\n' > "$TMP/stat"

listed=$(sh "$TMP/rpcd" list)
printf '%s\n' "$listed" | grep -q 'getSystemMetrics'
printf '%s\n' "$listed" | grep -q 'getWirelessStatus'
printf '%s\n' "$listed" | grep -q 'getWirelessHistory'

metrics=$(PROC_STAT_PATH="$TMP/stat" sh "$TMP/rpcd" call getSystemMetrics </dev/null)
printf '%s\n' "$metrics" | grep -q '^total=360$'
printf '%s\n' "$metrics" | grep -q '^idle=90$'

wireless=$(PATH="$TMP:$PATH" WIFI_SYS_NET="$TMP/net" sh "$TMP/rpcd" call getWirelessStatus </dev/null)
[ "$(printf '%s\n' "$wireless" | grep -c '^name=MT7990')" -eq 3 ]
printf '%s\n' "$wireless" | grep -q '^band=6g$'
printf '%s\n' "$wireless" | grep -q '^channel=37$'
printf '%s\n' "$wireless" | grep -q '^htmode=EHT160$'
printf '%s\n' "$wireless" | grep -q '^ifname=rai0$'
printf '%s\n' "$wireless" | grep -q '^bssid=02:11:22:33:44:55$'
if printf '%s\n' "$wireless" | grep -q 'never-expose\|key='; then
    echo 'Wi-Fi key leaked through status projection' >&2
    exit 1
fi

mkdir -p "$TMP/state"
printf '160\tMT7990_1_2\t1000\t500\t7.7\t1.6\n' > "$TMP/state/wifi-history.tsv"
printf '161\tbad"name\t1\t2\t3\t4\n' >> "$TMP/state/wifi-history.tsv"
history=$(STATE_DIR="$TMP/state" sh "$TMP/rpcd" call getWirelessHistory </dev/null)
printf '%s\n' "$history" | grep -Fq '[160,"MT7990_1_2",1000,500,7.7,1.6]'
printf '%s\n' "$history" | grep -Fq '"interval":300'
if printf '%s\n' "$history" | grep -q 'bad"name'; then
    echo 'untrusted radio name leaked into history JSON' >&2
    exit 1
fi
printf '220\tMT7990_1_2\t1100\t550\t6.0\t2.0\n' >> "$TMP/state/wifi-history.tsv"
printf '340\tMT7990_1_2\t1200\t600\t5.0\t3.0\n' >> "$TMP/state/wifi-history.tsv"
history=$(STATE_DIR="$TMP/state" sh "$TMP/rpcd" call getWirelessHistory </dev/null)
printf '%s\n' "$history" | grep -Fq '[220,"MT7990_1_2",1100,550,6.0,2.0]'
printf '%s\n' "$history" | grep -Fq '[340,"MT7990_1_2",1200,600,5.0,3.0]'
if printf '%s\n' "$history" | grep -Fq '[160,"MT7990_1_2"'; then
    echo 'Wi-Fi history did not downsample within five-minute bucket' >&2
    exit 1
fi

grep -q 'getSystemMetrics.*getWirelessStatus' "$ROOT/root/usr/share/rpcd/acl.d/luci-app-traffic.json"
echo 'mobile status RPC: PASS'

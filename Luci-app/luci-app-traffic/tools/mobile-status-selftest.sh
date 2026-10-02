#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
RPCD=${RPCD_SRC:-"$ROOT/root/usr/libexec/rpcd/luci.traffic"}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/jshn.sh" <<'EOF'
json_init() { CURRENT=root; }
json_load() { CURRENT=root; [ -n "$1" ]; }
json_get_keys() { eval "$1='MT7990_1_1 MT7990_1_2 MT7990_2'"; }
json_select() {
    case "$1" in
        ..) case "$CURRENT" in config) CURRENT="$RADIO" ;; *) CURRENT=root ;; esac ;;
        config) [ "$CURRENT" != root ] || return 1; CURRENT=config ;;
        *) RADIO="$1"; CURRENT="$1" ;;
    esac
}
json_get_var() {
    case "$2" in
        up) value=1 ;;
        band) case "$RADIO" in MT7990_1_1) value=2g ;; MT7990_1_2) value=5g ;; *) value=6g ;; esac ;;
        channel) case "$RADIO" in MT7990_1_1) value=3 ;; MT7990_1_2) value=40 ;; *) value=37 ;; esac ;;
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
printf '%s\n' '{"MT7990_1_1":{"up":true,"config":{"band":"2g","channel":"3","key":"never-expose"}}}'
EOF
chmod +x "$TMP/ubus"
printf 'cpu 10 20 30 40 50 60 70 80 90 100\n' > "$TMP/stat"

listed=$(sh "$TMP/rpcd" list)
printf '%s\n' "$listed" | grep -q 'getSystemMetrics'
printf '%s\n' "$listed" | grep -q 'getWirelessStatus'

metrics=$(PROC_STAT_PATH="$TMP/stat" sh "$TMP/rpcd" call getSystemMetrics </dev/null)
printf '%s\n' "$metrics" | grep -q '^total=360$'
printf '%s\n' "$metrics" | grep -q '^idle=90$'

wireless=$(PATH="$TMP:$PATH" sh "$TMP/rpcd" call getWirelessStatus </dev/null)
[ "$(printf '%s\n' "$wireless" | grep -c '^name=MT7990')" -eq 3 ]
printf '%s\n' "$wireless" | grep -q '^band=6g$'
printf '%s\n' "$wireless" | grep -q '^channel=37$'
if printf '%s\n' "$wireless" | grep -q 'never-expose\|key='; then
    echo 'Wi-Fi key leaked through status projection' >&2
    exit 1
fi

grep -q 'getSystemMetrics.*getWirelessStatus' "$ROOT/root/usr/share/rpcd/acl.d/luci-app-traffic.json"
echo 'mobile status RPC: PASS'

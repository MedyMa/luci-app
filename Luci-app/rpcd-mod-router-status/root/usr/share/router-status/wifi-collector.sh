#!/bin/sh
# One-minute BE14 counter samples. Files stay in RAM under /tmp/router-status.
set -u
umask 077

. "${WIFI_JSHN:-/usr/share/libubox/jshn.sh}"

STATE_DIR=${WIFI_STATE_DIR:-/tmp/router-status}
RPCD=${WIFI_RPCD:-/usr/libexec/rpcd/router.status}
IWPRIV=${WIFI_IWPRIV:-iwpriv}
SYS_NET=${WIFI_SYS_NET:-/sys/class/net}
STAT_AWK=${WIFI_STAT_AWK:-/usr/share/router-status/wifi-stat.awk}
DELTA_AWK=${WIFI_DELTA_AWK:-/usr/share/router-status/wifi-delta.awk}

sample_once() {
    local now raw indexes index name ifname up rx tx stats
    local current result next history
    now=${WIFI_NOW:-$(date +%s)}
    case "$now" in ''|*[!0-9]*) return 0 ;; esac
    mkdir -p "$STATE_DIR" || return 0
    raw=$("$RPCD" call getWirelessStatus 2>/dev/null) || return 0
    json_load "$raw" 2>/dev/null || return 0
    json_select radios 2>/dev/null || return 0
    json_get_keys indexes

    current="$STATE_DIR/wifi-current.$$"
    result="$STATE_DIR/wifi-result.$$"
    next="$STATE_DIR/wifi-next.$$"
    history="$STATE_DIR/wifi-history.$$"
    : > "$current" || return 0
    for index in $indexes; do
        json_select "$index" 2>/dev/null || continue
        json_get_var name name
        json_get_var ifname ifname
        json_get_var up up
        json_select ..
        case "$name" in ''|*[!A-Za-z0-9_.-]*) continue ;; esac
        case "$ifname" in ''|*[!A-Za-z0-9_.-]*) continue ;; esac
        case "$up" in 1|true) : ;; *) continue ;; esac
        [ -r "$SYS_NET/$ifname/statistics/rx_bytes" ] || continue
        [ -r "$SYS_NET/$ifname/statistics/tx_bytes" ] || continue
        rx=$(cat "$SYS_NET/$ifname/statistics/rx_bytes")
        tx=$(cat "$SYS_NET/$ifname/statistics/tx_bytes")
        case "$rx:$tx" in *[!0-9:]*|:*|*:) continue ;; esac
        stats=$("$IWPRIV" "$ifname" stat 2>/dev/null | awk -f "$STAT_AWK")
        set -- $stats
        [ "$#" -eq 4 ] || set -- -1 -1 -1 -1
        printf 'C\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$name" "$now" "$1" "$2" "$3" "$4" "$rx" "$tx" >> "$current"
    done

    if [ -r "$STATE_DIR/wifi-prev.tsv" ]; then
        cat "$STATE_DIR/wifi-prev.tsv" "$current" |
            awk -F '\t' -f "$DELTA_AWK" > "$result"
    else
        awk -F '\t' -f "$DELTA_AWK" "$current" > "$result"
    fi
    awk -F '\t' '$1 == "N" { sub(/^N/, "P"); print }' "$result" > "$next"
    mv "$next" "$STATE_DIR/wifi-prev.tsv"
    {
        [ ! -r "$STATE_DIR/wifi-history.tsv" ] || cat "$STATE_DIR/wifi-history.tsv"
        awk -F '\t' '$1 == "H" { sub(/^H\t/, ""); print }' "$result"
    } | awk -F '\t' -v cutoff="$((now - 86400))" \
        'NF == 6 && $1 + 0 >= cutoff { print }' | tail -n 12000 > "$history"
    mv "$history" "$STATE_DIR/wifi-history.tsv"
    rm -f "$current" "$result"
}

if [ "${1:-}" = once ]; then
    sample_once
    exit 0
fi

while :; do
    sample_once
    sleep "${WIFI_SAMPLE_SECONDS:-60}"
done

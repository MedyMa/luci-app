#!/bin/sh
# One-minute BE14 counter samples. Files stay in RAM under /tmp/router-status.
# jshn reads optional parameters and unset internal variables; nounset is incompatible.
umask 077

. "${WIFI_JSHN:-/usr/share/libubox/jshn.sh}"

STATE_DIR=${WIFI_STATE_DIR:-/tmp/router-status}
RPCD=${WIFI_RPCD:-/usr/libexec/rpcd/router.status}
IWPRIV=${WIFI_IWPRIV:-iwpriv}
MWCTL=${WIFI_MWCTL:-mwctl}
SYS_NET=${WIFI_SYS_NET:-/sys/class/net}
STAT_AWK=${WIFI_STAT_AWK:-/usr/share/router-status/wifi-stat.awk}
DELTA_AWK=${WIFI_DELTA_AWK:-/usr/share/router-status/wifi-delta.awk}
HISTORY_AWK=${WIFI_HISTORY_AWK:-/usr/share/router-status/wifi-history.awk}

get_radio_stats() {
    local raw
    # WEXT and standalone cfg80211 expose the same statistics text through
    # different commands. Reuse this one bounded query for history and temps.
    if command -v "$IWPRIV" >/dev/null 2>&1; then
        raw=$(timeout -s KILL 2 "$IWPRIV" "$1" stat 2>/dev/null)
        if [ "$?" -eq 0 ] && [ -n "$raw" ]; then
            printf '%s\n' "$raw"
            return
        fi
    fi
    if command -v "$MWCTL" >/dev/null 2>&1; then
        timeout -s KILL 2 "$MWCTL" "$1" stat 2>/dev/null
    fi
}

sample_once() {
    local now raw indexes index name ifname up rx tx stats
    local current result next history temperatures
    now=${WIFI_NOW:-$(date +%s)}
    case "$now" in ''|*[!0-9]*) return 0 ;; esac
    [ -d "$STATE_DIR" ] || mkdir -p "$STATE_DIR" || return 0
    raw=$("$RPCD" call getWirelessStatus 2>/dev/null) || return 0
    json_load "$raw" 2>/dev/null || return 0
    json_select radios 2>/dev/null || return 0
    json_get_keys indexes

    current="$STATE_DIR/wifi-current.$$"
    result="$STATE_DIR/wifi-result.$$"
    next="$STATE_DIR/wifi-next.$$"
    history="$STATE_DIR/wifi-history.$$"
    temperatures="$STATE_DIR/wifi-temperatures.$$"
    : > "$current" || return 0
    : > "$temperatures" || return 0
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
        read -r rx < "$SYS_NET/$ifname/statistics/rx_bytes" || continue
        read -r tx < "$SYS_NET/$ifname/statistics/tx_bytes" || continue
        case "$rx:$tx" in *[!0-9:]*|:*|*:) continue ;; esac
        stats=$(get_radio_stats "$ifname" | awk -f "$STAT_AWK")
        set -- $stats
        [ "$#" -eq 5 ] || set -- -1 -1 -1 -1 -1
        case "$5" in ''|*[!0-9]*) : ;; *)
            if [ "$5" -le 150 ]; then
                printf '%s\t%s\t%s\n' "$now" "$name" "$5" >> "$temperatures"
            fi ;;
        esac
        printf 'C\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$name" "$now" "$1" "$2" "$3" "$4" "$rx" "$tx" >> "$current"
    done
    mv "$temperatures" "$STATE_DIR/wifi-temperatures.tsv"

    if [ -r "$STATE_DIR/wifi-prev.tsv" ]; then
        awk -F '\t' -f "$DELTA_AWK" "$STATE_DIR/wifi-prev.tsv" "$current" > "$result"
    else
        awk -F '\t' -f "$DELTA_AWK" "$current" > "$result"
    fi
    awk -F '\t' '$1 == "N" { sub(/^N/, "P"); print }' "$result" > "$next"
    mv "$next" "$STATE_DIR/wifi-prev.tsv"
    [ -e "$STATE_DIR/wifi-history.tsv" ] || : > "$STATE_DIR/wifi-history.tsv"
    if ! awk -F '\t' -v cutoff="$((now - 86400))" -f "$HISTORY_AWK" \
        "$STATE_DIR/wifi-history.tsv" "$result" > "$history"; then
        rm -f "$current" "$result" "$history"
        return 0
    fi
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

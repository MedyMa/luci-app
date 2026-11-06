#!/bin/sh
# Five-second software telemetry snapshots. Never read PPE MIBs or dump flows.
umask 077
. "${ACCEL_JSHN:-/usr/share/libubox/jshn.sh}"
STATE_DIR=${ACCEL_STATE_DIR:-/tmp/router-status}
STATS=${ACCEL_HNAT_STATS:-/sys/kernel/debug/hnat/hnat_stats}
STATS_AWK=${ACCEL_STATS_AWK:-/usr/share/router-status/acceleration-stats.awk}
MODULES=${ACCEL_SYS_MODULE:-/sys/module}
RPCD=${ACCEL_RPCD:-/usr/libexec/rpcd/router.status}

sample_once() {
    local stats values ppe=0 engines capacity bound ipv4 ipv6 other
    local npu_loaded=0 wed_loaded=0 npu=0 percent cores coverage
    local raw now rest epoch next
    mkdir -p "$STATE_DIR" || return 1
    next="$STATE_DIR/acceleration.$$"
    if [ -r "$STATS" ] && command -v timeout >/dev/null 2>&1; then
        stats=$(timeout -s KILL 2 head -c 2049 "$STATS" 2>/dev/null)
        if [ "$?" -eq 0 ] && [ "${#stats}" -le 2048 ]; then
            values=$(printf '%s\n' "$stats" | awk -f "$STATS_AWK")
            if [ "$?" -eq 0 ]; then
                set -- $values
                [ "$#" -eq 6 ] && {
                    ppe=1; engines=$1; capacity=$2; bound=$3
                    ipv4=$4; ipv6=$5; other=$6
                }
            fi
        fi
    fi
    [ ! -d "$MODULES/npu" ] || npu_loaded=1
    if [ -d "$MODULES/mtk_warp" ] || [ -d "$MODULES/mtk_wed" ]; then
        wed_loaded=1
    fi
    coverage=missing
    # Reuse the bounded, validated read-only RPC contract. Only the collector
    # requests utilization; overview refreshes consume the cached result.
    if [ "$npu_loaded" -eq 1 ] && [ -x "$RPCD" ]; then
        raw=$(timeout -s KILL 5 "$RPCD" call getNpuUsage 2>/dev/null)
        if [ "$?" -eq 0 ] && [ "${#raw}" -le 1024 ] && json_load "$raw" 2>/dev/null; then
            json_get_var npu available
            json_get_var percent percent_milli
            json_get_var cores core_count
            json_get_var coverage coverage
            [ "$npu:$cores:$coverage" = '1:5:complete' ] || npu=0
            case "$percent" in ''|*[!0-9]*) npu=0 ;; esac
            [ "${#percent}" -le 6 ] && [ "$percent" -le 100000 ] 2>/dev/null || npu=0
        else
            npu=0
        fi
    fi
    read -r now rest < "${ACCEL_UPTIME:-/proc/uptime}" || return 1
    now=${now%%.*}
    case "$now" in ''|*[!0-9]*) return 1 ;; esac
    epoch=$(date +%s)
    json_init
    json_add_int schema 1
    json_add_boolean available 1
    json_add_int sampled_uptime "$now"
    json_add_string sampled_at "$epoch"
    json_add_int interval 5
    json_add_object ppe
    json_add_boolean available "$ppe"
    json_add_string unit bound_table_entries
    if [ "$ppe" -eq 1 ]; then
        json_add_int engines "$engines"
        json_add_int capacity "$capacity"
        json_add_int bound "$bound"
        json_add_int ipv4 "$ipv4"
        json_add_int ipv6 "$ipv6"
        json_add_int other "$other"
    fi
    json_close_object
    json_add_object wed
    json_add_boolean module_loaded "$wed_loaded"
    json_close_object
    json_add_object npu
    json_add_boolean module_loaded "$npu_loaded"
    json_add_boolean available "$npu"
    if [ "$npu" -eq 1 ]; then
        json_add_int percent_milli "$percent"
        json_add_int core_count 5
    fi
    json_close_object
    json_dump > "$next" && mv "$next" "$STATE_DIR/acceleration.json"
    rm -f "$next"
}

is_watched() {
    local seen now rest
    [ -r "$STATE_DIR/acceleration.watch" ] || return 1
    read -r seen < "$STATE_DIR/acceleration.watch" || return 1
    read -r now rest < "${ACCEL_UPTIME:-/proc/uptime}" || return 1
    now=${now%%.*}
    case "$seen:$now" in *[!0-9:]*|:*|*:) return 1 ;; esac
    [ "${#seen}" -le 10 ] && [ "${#now}" -le 10 ] &&
        [ "$now" -ge "$seen" ] && [ "$((now - seen))" -le 60 ]
}

if [ "${1:-}" = once ]; then
    sample_once
    exit $?
fi
trap 'rm -f "$STATE_DIR/acceleration.$$"; exit' TERM INT
while :; do
    if is_watched; then
        sample_once
        sleep 5 &
    else
        sleep 2 &
    fi
    wait $! || exit 1
done

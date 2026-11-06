#!/bin/sh
# A separate procd instance keeps sampling independent of DNS work. OpenWrt
# defaults to BusyBox FLOAT_DURATION=n: fractional sleep fails instead of
# waiting. Use integer seconds and let live.sh measure the actual interval.
SELF_DIR=${SELF_DIR:-/usr/share/traffic}
STATE_DIR=${STATE_DIR:-/tmp/traffic}
WATCH_AGE=${LIVE_WATCH_AGE:-60}
case "$WATCH_AGE" in ''|*[!0-9]*) WATCH_AGE=60 ;; esac
export TRAFFIC_LIVE_WAN_ONLY=1

is_watched() {
	local seen now
	[ -r "$STATE_DIR/live.watch" ] || return 1
	read -r seen < "$STATE_DIR/live.watch" || return 1
	case "$seen" in ''|*[!0-9]*) return 1 ;; esac
	now=$(date +%s 2>/dev/null) || return 1
	[ "$now" -ge "$seen" ] && [ "$((now - seen))" -le "$WATCH_AGE" ]
}

while :; do
	if is_watched; then
		/bin/sh "$SELF_DIR/live.sh"
		# No catch-up burst: the next measurement uses its actual elapsed time.
		sleep 1 || exit 1
	else
		# Do not parse live.sh, spawn awk or write history with no viewer.
		sleep 2 || exit 1
	fi
done

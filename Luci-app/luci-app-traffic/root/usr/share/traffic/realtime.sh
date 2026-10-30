#!/bin/sh
# A separate procd instance keeps one-second sampling independent of DNS work.
SELF_DIR=${SELF_DIR:-/usr/share/traffic}
UPTIME=${TRAFFIC_PROC_UPTIME:-/proc/uptime}
export TRAFFIC_LIVE_WAN_ONLY=1

while :; do
	start=$(awk '{ printf "%.0f", $1 * 1000; exit }' "$UPTIME" 2>/dev/null)
	/bin/sh "$SELF_DIR/live.sh"
	# Sleep to a monotonic deadline; never issue a burst of catch-up samples.
	delay=$(awk -v start="$start" '{
		wait=1000-($1*1000-start); if(wait<50)wait=50
		printf "%.3f",wait/1000; exit
	}' "$UPTIME" 2>/dev/null)
	sleep "${delay:-1}"
done

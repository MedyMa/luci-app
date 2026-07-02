#!/bin/sh
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
logread -e AdGuardHome > /tmp/AdGuardHometmp.log
logread -e AdGuardHome -f >> /tmp/AdGuardHometmp.log &
pid=$!
echo "1" > /var/run/AdGuardHomesyslog
while true; do
	sleep 12
	# Rotate the syslog mirror if it exceeds 512 KB to prevent filling /tmp
	# (tmpfs = RAM).  Rewrite in-place so the logread -f fd stays valid.
	log_size=$(wc -c < /tmp/AdGuardHometmp.log 2>/dev/null || printf '0\n')
	if [ "${log_size:-0}" -gt 524288 ] 2>/dev/null; then
		tail -c 262144 /tmp/AdGuardHometmp.log > /tmp/AdGuardHometmp.log.new 2>/dev/null
		cat /tmp/AdGuardHometmp.log.new > /tmp/AdGuardHometmp.log 2>/dev/null
		rm -f /tmp/AdGuardHometmp.log.new
	fi
	watchdog=$(cat /var/run/AdGuardHomesyslog 2>/dev/null)
	if [ "$watchdog" = "0" ]; then
		kill "$pid" 2>/dev/null
		rm -f /tmp/AdGuardHometmp.log /var/run/AdGuardHomesyslog
		exit 0
	else
		echo "0" > /var/run/AdGuardHomesyslog
	fi
done
#!/bin/sh
PATH="/usr/sbin:/usr/bin:/sbin:/bin"

network_route_ready() {
	if command -v ip >/dev/null 2>&1 && ip route show default 2>/dev/null | grep -q .; then
		return 0
	fi
	[ -r /proc/net/route ] && awk '$2 == "00000000" { found = 1 } END { exit(found ? 0 : 1) }' /proc/net/route
}

network_ping_ready() {
	local target
	for target in 223.5.5.5 119.29.29.29 1.1.1.1 8.8.8.8 202.108.22.5; do
		ping -c 1 -W 1 -q "$target" >/dev/null 2>&1 && return 0
	done
	return 1
}

network_http_ready() {
	local url
	if command -v wget >/dev/null 2>&1; then
		for url in \
			http://connectivitycheck.gstatic.com/generate_204 \
			http://www.gstatic.com/generate_204 \
			http://detectportal.firefox.com/canonical.html
		do
			wget -q -T 2 -O /dev/null "$url" >/dev/null 2>&1 && return 0
		done
	fi
	if command -v curl >/dev/null 2>&1; then
		for url in \
			http://connectivitycheck.gstatic.com/generate_204 \
			http://www.gstatic.com/generate_204 \
			http://detectportal.firefox.com/canonical.html
		do
			curl -fsS --connect-timeout 2 --max-time 3 -o /dev/null "$url" >/dev/null 2>&1 && return 0
		done
	fi
	return 1
}

network_dns_ready() {
	local server
	command -v nslookup >/dev/null 2>&1 || return 1
	command -v timeout >/dev/null 2>&1 || return 1
	for server in 223.5.5.5 119.29.29.29 1.1.1.1 8.8.8.8; do
		timeout 3 nslookup openwrt.org "$server" 2>/dev/null | grep -q '^Name:' && return 0
	done
	return 1
}

network_reachable() {
	network_route_ready || return 1
	network_ping_ready || network_http_ready || network_dns_ready
}

count=0
delay=5

while :; do
	if network_reachable; then
		logger -t AdGuardHome "waitnet: network is reachable, starting service"
		AGH_WAITNET_READY=1 /etc/init.d/AdGuardHome force_reload
		exit 0
	fi

	count=$((count + 1))
	if [ "$count" = 1 ] || [ $((count % 6)) = 0 ]; then
		if network_route_ready; then
			logger -t AdGuardHome "waitnet: default route exists but ping/http/dns reachability checks failed"
		else
			logger -t AdGuardHome "waitnet: waiting for default route"
		fi
	fi

	sleep "$delay"
	[ "$delay" -lt 30 ] && delay=$((delay + 5))
done

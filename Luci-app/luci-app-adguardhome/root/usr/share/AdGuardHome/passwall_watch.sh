#!/bin/sh
PATH="/usr/sbin:/usr/bin:/sbin:/bin"

PASSWALL_CACHE='/tmp/etc/passwall/var'
PASSWALL2_CACHE='/tmp/etc/passwall2/var'
LAST_STATE_FILE='/var/run/AdGpasswall_state'

is_valid_port() {
	case "$1" in
		''|*[!0-9]*) return 1 ;;
	esac
	[ "$1" -ge 1 ] 2>/dev/null && [ "$1" -le 65535 ] 2>/dev/null
}

_uci_bool_enabled() {
	case "$1" in
		1|on|true|yes|enabled) return 0 ;;
	esac
	return 1
}

# Replicates resolve_redirect_compat_state logic from init.d/AdGuardHome
# Checks UCI switch + cache file + port validity to avoid false positives
passwall_state() {
	local enabled dns_redirect port

	enabled=$(uci -q get passwall.@global[0].enabled 2>/dev/null)
	if _uci_bool_enabled "$enabled"; then
		dns_redirect=$(uci -q get passwall.@global[0].dns_redirect 2>/dev/null)
		if [ "$dns_redirect" != '0' ] && [ -s "$PASSWALL_CACHE" ]; then
			port=$(awk -F '=' '$1 == "ACL_default_dns_port" { value = $2; gsub(/^"|"$/, "", value); print value }' "$PASSWALL_CACHE" 2>/dev/null | tail -n 1)
			if is_valid_port "$port"; then
				printf 'passwall'
				return 0
			fi
		fi
	fi

	enabled=$(uci -q get passwall2.@global[0].enabled 2>/dev/null)
	if _uci_bool_enabled "$enabled"; then
		dns_redirect=$(uci -q get passwall2.@global[0].dns_redirect 2>/dev/null)
		if [ "$dns_redirect" != '0' ] && [ -s "$PASSWALL2_CACHE" ]; then
			port=$(awk -F '=' '$1 == "ACL_default_dns_port" { value = $2; gsub(/^"|"$/, "", value); print value }' "$PASSWALL2_CACHE" 2>/dev/null | tail -n 1)
			if is_valid_port "$port"; then
				printf 'passwall2'
				return 0
			fi
		fi
	fi

	return 1
}

load_last_state() {
	[ -f "$LAST_STATE_FILE" ] && cat "$LAST_STATE_FILE" 2>/dev/null
}

save_state() {
	printf '%s\n' "$1" > "$LAST_STATE_FILE"
}

reapply() {
	logger -t AdGuardHome "passwall watch: state changed, reapplying redirect configuration"
	if /etc/init.d/AdGuardHome isrunning >/dev/null 2>&1; then
		# Verify AGH DNS port is actually listening before redirecting.
		# Fall back to trust-the-process when no port-check tool is available.
		local configpath agh_port port_ok
		configpath="$(uci -q get AdGuardHome.AdGuardHome.configpath 2>/dev/null || echo '/etc/config/adGuardConfig/AdGuardHome.yaml')"
		if [ -r "$configpath" ]; then
			agh_port=$(grep -A5 '^dns:' "$configpath" | grep '^  port:' | sed 's/.*: *//' 2>/dev/null)
		fi
		port_ok=0
		if [ -n "$agh_port" ] && is_valid_port "$agh_port"; then
			if command -v ss >/dev/null 2>&1; then
				ss -lntu 2>/dev/null | grep -q ":$agh_port " && port_ok=1
			elif command -v netstat >/dev/null 2>&1; then
				netstat -lntu 2>/dev/null | grep -q ":$agh_port " && port_ok=1
			else
				port_ok=1
			fi
		else
			port_ok=1
		fi
		if [ "$port_ok" = '1' ]; then
			/etc/init.d/AdGuardHome do_redirect 1
			return 0
		else
			logger -t AdGuardHome "passwall watch: AGH DNS port ${agh_port} not listening yet, deferring redirect"
			return 1
		fi
	fi
	return 0
}

# Initialise persisted state
if last=$(load_last_state); then
	# File existed - use its value (may be empty)
	:
else
	# File didn't exist - probe current state
	if state=$(passwall_state); then
		last="$state"
	else
		last=''
	fi
	save_state "$last"
fi

# Phase 1 (slow poll): wait for first detection (initial boot)
if [ -z "$last" ]; then
	while :; do
		sleep 5
		if state=$(passwall_state); then
			logger -t AdGuardHome "passwall watch: detected (${state}) after startup"
			if reapply; then
				save_state "$state"
				break
			fi
		fi
	done
fi

# Phase 2 (fast poll): monitor state transitions indefinitely
while :; do
	sleep 1
	state=''
	if passwall_state >/dev/null 2>&1; then
		state=$(passwall_state)
	fi
	last=$(load_last_state)
	if [ "$state" != "$last" ]; then
		if reapply; then
			save_state "${state:-}"
		fi
	fi
done

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

_has_cmd() {
	command -v "$1" >/dev/null 2>&1
}

_port_listen_regex() {
	local port="$1"
	is_valid_port "$port" || return 1
	printf '[:.]%s([[:space:]]|$)\n' "$port"
}

port_is_listening() {
	local port="$1" pattern checked
	pattern=$(_port_listen_regex "$port") || return 1
	checked=0
	if _has_cmd ss; then
		checked=1
		ss -lntu 2>/dev/null | grep -Eq "$pattern" && return 0
	fi
	if _has_cmd netstat; then
		checked=1
		netstat -lntu 2>/dev/null | grep -Eq "$pattern" && return 0
	fi
	[ "$checked" = '1' ] || return 2
	return 1
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
		# Verify AGH DNS port before redirecting.
		# If the router lacks ss/netstat, trust the running process instead of deadlocking.
		local configpath agh_port listen_state
		configpath="$(uci -q get AdGuardHome.AdGuardHome.configpath 2>/dev/null || echo '/etc/config/adGuardConfig/AdGuardHome.yaml')"
		if [ -r "$configpath" ]; then
			agh_port=$(grep -A5 '^dns:' "$configpath" | grep '^  port:' | sed 's/.*: *//' 2>/dev/null)
		fi
		if [ -n "$agh_port" ] && is_valid_port "$agh_port"; then
			port_is_listening "$agh_port"
			listen_state="$?"
			case "$listen_state" in
				0|2)
					/etc/init.d/AdGuardHome do_redirect 1
					return 0
					;;
			esac
			logger -t AdGuardHome "passwall watch: AGH DNS port ${agh_port} not listening yet, deferring redirect"
			return 1
		else
			/etc/init.d/AdGuardHome do_redirect 1
			return 0
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

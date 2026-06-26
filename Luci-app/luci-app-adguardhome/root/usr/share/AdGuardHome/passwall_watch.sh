#!/bin/sh
PATH="/usr/sbin:/usr/bin:/sbin:/bin"

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

cache_get() {
	local file="$1" key="$2"
	[ -s "$file" ] || return 1
	awk -F '=' -v key="$key" '$1 == key { value = $2 } END { gsub(/^"|"$/, "", value); if (value != "") print value }' "$file"
}

scan_cache_dns_port() {
	local file="$1"
	[ -s "$file" ] || return 1
	awk -F '=' '
		{
			key = tolower($1)
		}
		key ~ /dns/ && key ~ /port/ {
			value = $2
			gsub(/^"|"$/, "", value)
			if (value ~ /^[0-9]+$/ && value >= 1 && value <= 65535 && value != 53) {
				print value
				exit
			}
		}' "$file"
}

scan_chain_redirect_port() {
	local vendor="$1" text port
	case "$vendor" in
		passwall2)
			if command -v nft >/dev/null 2>&1; then
				text=$(nft list chain inet passwall2 PSW2_DNS 2>/dev/null)
			fi
			if [ -z "$text" ] && command -v iptables >/dev/null 2>&1; then
				text=$(iptables -t nat -S PSW2_DNS 2>/dev/null)
			fi
			;;
		*)
			if command -v nft >/dev/null 2>&1; then
				text=$(nft list chain inet passwall PSW_DNS 2>/dev/null)
			fi
			if [ -z "$text" ] && command -v iptables >/dev/null 2>&1; then
				text=$(iptables -t nat -S PSW_DNS 2>/dev/null)
			fi
			;;
	esac
	port=$(printf '%s\n' "$text" | sed -n \
		-e 's/.*redirect[[:space:]]\+to[[:space:]]*:\([0-9][0-9]*\).*/\1/p' \
		-e 's/.*--to-ports[[:space:]]\+\([0-9][0-9]*\).*/\1/p' | head -n 1)
	is_valid_port "$port" || return 1
	printf '%s\n' "$port"
}

detect_front_port() {
	local vendor="$1" file port
	case "$vendor" in
		passwall2) file='/tmp/etc/passwall2/var' ;;
		*) file='/tmp/etc/passwall/var' ;;
	esac
	for port in \
		"$(cache_get "$file" ACL_default_dns_port 2>/dev/null)" \
		"$(scan_cache_dns_port "$file" 2>/dev/null)" \
		"$(scan_chain_redirect_port "$vendor" 2>/dev/null)" \
		"$(uci -q get "$vendor.@global[0].dns_port" 2>/dev/null)" \
		"$(uci -q get "$vendor.@global[0].dns_forward_port" 2>/dev/null)"
	do
		is_valid_port "$port" && {
			printf '%s\n' "$port"
			return 0
		}
	done
	return 1
}

passwall_chain_ready() {
	if command -v nft >/dev/null 2>&1 && nft list chain inet passwall PSW_DNS >/dev/null 2>&1; then
		return 0
	fi
	command -v iptables >/dev/null 2>&1 && iptables -t nat -L PSW_DNS >/dev/null 2>&1
}

passwall2_chain_ready() {
	if command -v nft >/dev/null 2>&1 && nft list chain inet passwall2 PSW2_DNS >/dev/null 2>&1; then
		return 0
	fi
	command -v iptables >/dev/null 2>&1 && iptables -t nat -L PSW2_DNS >/dev/null 2>&1
}

# Replicates resolve_redirect_compat_state logic from init.d/AdGuardHome
# Checks UCI switch + DNS chain readiness to avoid false positives
passwall_state() {
	local enabled dns_redirect port

	enabled=$(uci -q get passwall.@global[0].enabled 2>/dev/null)
	if _uci_bool_enabled "$enabled"; then
		dns_redirect=$(uci -q get passwall.@global[0].dns_redirect 2>/dev/null)
		if [ "$dns_redirect" != '0' ] && passwall_chain_ready; then
			port=$(detect_front_port passwall 2>/dev/null || true)
			printf 'passwall:%s' "$port"
			return 0
		fi
	fi

	enabled=$(uci -q get passwall2.@global[0].enabled 2>/dev/null)
	if _uci_bool_enabled "$enabled"; then
		dns_redirect=$(uci -q get passwall2.@global[0].dns_redirect 2>/dev/null)
		if [ "$dns_redirect" != '0' ] && passwall2_chain_ready; then
			port=$(detect_front_port passwall2 2>/dev/null || true)
			printf 'passwall2:%s' "$port"
			return 0
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

# Re-apply once after startup. This covers watcher restarts and boot races where
# PassWall is already in the same state but our bypass/redirect rules are absent.
if reapply; then
	if state=$(passwall_state); then
		save_state "$state"
		last="$state"
	else
		save_state ''
		last=''
	fi
fi

# Monitor PassWall state transitions indefinitely. An empty state is valid and
# means AdGuard Home should keep its normal redirect mode without bypass rules.
while :; do
	sleep 10
	state=''
	state=$(passwall_state 2>/dev/null || true)
	if [ "$state" != "$last" ]; then
		if reapply; then
			save_state "${state:-}"
			last="${state:-}"
		fi
	fi
done

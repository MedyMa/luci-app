#!/bin/sh
PATH="/usr/sbin:/usr/bin:/sbin:/bin"

LAST_STATE_FILE='/var/run/AdGpasswall_state'
# AdGuard Home's uci section and service entry point.  The port-53 redirect
# rules belong to the init script, so the watcher re-applies through it instead
# of duplicating the firewall logic here.
AGH_CONFIG='AdGuardHome.AdGuardHome'
AGH_INIT='/etc/init.d/AdGuardHome'
AGH_REDIRECT_RETRY_FILE='/var/run/AdGwatch_redir_retry'
AGH_REDIRECT_RETRY_INTERVAL=30

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

# Returns 0 when the port is confirmed listening, or when neither ss nor
# netstat exists so the listening state cannot be verified (trust the chain
# and UCI signals in that case).
port_listening_or_unknown() {
	local state
	port_is_listening "$1"
	state="$?"
	[ "$state" = '0' ] || [ "$state" = '2' ]
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

# Mirrors resolve_passwall_dns_upstream() in init.d/AdGuardHome.  With PassWall's
# "DNS 重定向" off there is no dedicated front-end instance: PassWall stretches
# the system dnsmasq instead, so /tmp/etc/passwall/var carries no *_dns_port and
# GLOBAL_DNSMASQ_CONF points into the system dnsmasq conf-dir.  That is still a
# state AdGuard Home has to track, otherwise the managed upstream is never
# re-synced when PassWall switches between the two layouts.
passwall_dnsmasq_shunt_conf() {
	case "$1" in
		passwall2) cache_get /tmp/etc/passwall2/var GLOBAL_DNSMASQ_CONF 2>/dev/null | tail -n 1 ;;
		*) cache_get /tmp/etc/passwall/var GLOBAL_DNSMASQ_CONF 2>/dev/null | tail -n 1 ;;
	esac
}

passwall_dnsmasq_shunt_active() {
	local conf
	conf=$(passwall_dnsmasq_shunt_conf "$1" 2>/dev/null)
	case "$conf" in
		''|/tmp/etc/passwall/*|/tmp/etc/passwall2/*) return 1 ;;
	esac
	# PassWall only stretches the system dnsmasq while its own "DNS 重定向" is
	# off; with the redirect on the shunt lives in its dedicated instance.
	case "$1" in
		passwall2) [ "$(uci -q get passwall2.@global[0].dns_redirect 2>/dev/null)" = '0' ] || return 1 ;;
		*) [ "$(uci -q get passwall.@global[0].dns_redirect 2>/dev/null)" = '0' ] || return 1 ;;
	esac
	case "$1" in
		passwall2) passwall2_chain_ready ;;
		*) passwall_chain_ready ;;
	esac
}

# Port of the system dnsmasq carrying PassWall's stretched shunt.  It has to be
# part of the tracked state: uci reports the port dnsmasq was moved to (for
# example after the exchange mode swapped it), and a port change with the same
# layout would otherwise go unnoticed and leave AdGuard Home pointing at the
# previous port.
passwall_dnsmasq_shunt_port() {
	local port
	passwall_dnsmasq_shunt_active "$1" || return 1
	port=$(uci -q get dhcp.@dnsmasq[0].port 2>/dev/null)
	[ -n "$port" ] || port='53'
	is_valid_port "$port" || return 1
	printf '%s\n' "$port"
}

# Replicates resolve_redirect_compat_state logic from init.d/AdGuardHome.
# Checks UCI switch + DNS chain readiness AND that the PassWall DNS front port
# is actually listening, so a killed/crashed PassWall (leftover UCI switch or
# nft chain) is treated as down instead of keeping a dead upstream in AGH.
passwall_state() {
	local enabled dns_redirect port

	enabled=$(uci -q get passwall.@global[0].enabled 2>/dev/null)
	if _uci_bool_enabled "$enabled"; then
		dns_redirect=$(uci -q get passwall.@global[0].dns_redirect 2>/dev/null)
		if [ "$dns_redirect" != '0' ] && passwall_chain_ready; then
			port=$(detect_front_port passwall 2>/dev/null || true)
			if is_valid_port "$port" && port_listening_or_unknown "$port"; then
				printf 'passwall:%s' "$port"
				return 0
			fi
		fi
		if passwall_dnsmasq_shunt_active passwall; then
			printf 'passwall:dnsmasq:%s' "$(passwall_dnsmasq_shunt_port passwall 2>/dev/null || printf 'none')"
			return 0
		fi
	fi

	enabled=$(uci -q get passwall2.@global[0].enabled 2>/dev/null)
	if _uci_bool_enabled "$enabled"; then
		dns_redirect=$(uci -q get passwall2.@global[0].dns_redirect 2>/dev/null)
		if [ "$dns_redirect" != '0' ] && passwall2_chain_ready; then
			port=$(detect_front_port passwall2 2>/dev/null || true)
			if is_valid_port "$port" && port_listening_or_unknown "$port"; then
				printf 'passwall2:%s' "$port"
				return 0
			fi
		fi
		if passwall_dnsmasq_shunt_active passwall2; then
			printf 'passwall2:dnsmasq:%s' "$(passwall_dnsmasq_shunt_port passwall2 2>/dev/null || printf 'none')"
			return 0
		fi
	fi

	return 1
}

# AdGuard Home's DNS port, read from the dns: block of its YAML config.
# Section-aware parser: reads port: only inside the dns: block, robust
# regardless of how many keys precede it.  Mirrors resolve_dns_port() in
# update_core.sh.
agh_dns_port() {
	local configpath="$1"
	[ -r "$configpath" ] || return 1
	awk '
		BEGIN { in_dns = 0 }
		/^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
		/^[^[:space:]#][A-Za-z0-9_-]*:[[:space:]]*/ {
			in_dns = ($0 ~ /^dns:[[:space:]]*($|#)/)
			next
		}
		in_dns && /^[[:space:]]+port:[[:space:]]*/ {
			sub(/^[[:space:]]*port:[[:space:]]*/, "", $0)
			sub(/[[:space:]]+#.*$/, "", $0)
			gsub(/["'"'"']/, "", $0)
			print $0
			exit
		}' "$configpath" 2>/dev/null
}

# Are AdGuard Home's own port-53 redirect rules present?  Mirrors what
# set_firewall_redirect() installs in the init script: one udp and one tcp rule
# per LAN device in the ip and ip6 nat PREROUTING chains, targeting AGH's port.
# Returns 0 = present, 1 = absent, 2 = cannot be verified (no nft/iptables).
agh_redirect_rule_active() {
	local port="$1" pattern checked=0
	is_valid_port "$port" || return 2
	if _has_cmd nft; then
		checked=1
		pattern=$(printf 'redirect to :%s([[:space:]]|$)\n' "$port")
		nft list chain ip nat PREROUTING 2>/dev/null | grep -Eq "$pattern" && return 0
		nft list chain ip6 nat PREROUTING 2>/dev/null | grep -Eq "$pattern" && return 0
	fi
	if _has_cmd iptables; then
		checked=1
		iptables -t nat -S PREROUTING 2>/dev/null | \
			grep -Eq -e "--to-ports[[:space:]]+${port}([[:space:]]|\$)" && return 0
	fi
	if _has_cmd ip6tables; then
		checked=1
		ip6tables -t nat -S PREROUTING 2>/dev/null | \
			grep -Eq -e "--to-ports[[:space:]]+${port}([[:space:]]|\$)" && return 0
	fi
	[ "$checked" = '1' ] || return 2
	return 1
}

# Detect the gap left by the init script's redirect handling.  _do_redirect()
# removes the previous redirect rules *before* it checks whether AdGuard Home's
# DNS port is up, and when the port is not up yet it leaves the redirect
# disabled.  That decision is right on its own - LAN DNS must never be pointed
# at a dead port - but nothing retries afterwards, so recovery used to depend on
# another PassWall state change or a service restart.  A slow AdGuard Home start
# could therefore leave every LAN client bypassing it indefinitely.
#
# This runs on the watcher's existing 10 s tick and reports a repair only for a
# real mismatch, so a healthy system is left untouched.
agh_redirect_needs_repair() {
	local configpath enabled redirect port rule_state
	enabled=$(uci -q get "$AGH_CONFIG.enabled" 2>/dev/null)
	_uci_bool_enabled "$enabled" || return 1
	# Only the firewall-redirect mode installs rules that can be lost.  An unset
	# value is NOT this mode: the package default is dnsmasq-upstream.
	redirect=$(uci -q get "$AGH_CONFIG.redirect" 2>/dev/null)
	[ "$redirect" = 'redirect' ] || return 1
	configpath=$(uci -q get "$AGH_CONFIG.configpath" 2>/dev/null)
	[ -n "$configpath" ] || configpath='/etc/config/adGuardConfig/AdGuardHome.yaml'
	port=$(agh_dns_port "$configpath") || return 1
	is_valid_port "$port" || return 1
	# Never repair towards a port that is not listening: that is exactly the
	# state _do_redirect refuses to create on purpose.  An unverifiable port
	# state (neither ss nor netstat) is treated as "do not touch".
	port_is_listening "$port" || return 1
	agh_redirect_rule_active "$port"
	rule_state=$?
	[ "$rule_state" = '1' ]
}

# Re-apply through the init script, throttled.  Each attempt either restores the
# rules, or makes the init script settle on a different mode (auto-heal), so this
# converges; the throttle only keeps a persistently failing system from spinning
# and from flooding the log.
repair_agh_redirect_once() {
	local now last
	now=$(date +%s 2>/dev/null)
	last=$(cat "$AGH_REDIRECT_RETRY_FILE" 2>/dev/null)
	case "$now" in ''|*[!0-9]*) now=0 ;; esac
	case "$last" in ''|*[!0-9]*) last=0 ;; esac
	# A clock that stepped backwards (NTP) must not block repairs forever.
	[ "$last" -gt "$now" ] && last=0
	# Only throttle against a clock that is clearly set: before NTP the time is
	# 1970, where "seconds since the last attempt" is meaningless.
	if [ "$now" -ge 1000000000 ] && [ "$last" -ge 1000000000 ] && \
		[ $((now - last)) -lt "$AGH_REDIRECT_RETRY_INTERVAL" ]; then
		return 0
	fi
	printf '%s\n' "$now" > "$AGH_REDIRECT_RETRY_FILE" 2>/dev/null
	logger -t AdGuardHome "passwall watch: DNS redirect rule is missing while redirect mode is active; reapplying"
	"$AGH_INIT" do_redirect 1
}

load_last_state() {
	[ -f "$LAST_STATE_FILE" ] && cat "$LAST_STATE_FILE" 2>/dev/null
}

save_state() {
	printf '%s\n' "$1" > "$LAST_STATE_FILE"
}

reapply() {
	logger -t AdGuardHome "passwall watch: state changed, reapplying redirect configuration"
	if "$AGH_INIT" isrunning >/dev/null 2>&1; then
		# Verify AGH DNS port before redirecting.
		# If the router lacks ss/netstat, trust the running process instead of deadlocking.
		local configpath agh_port listen_state
		configpath="$(uci -q get "$AGH_CONFIG.configpath" 2>/dev/null || echo '/etc/config/adGuardConfig/AdGuardHome.yaml')"
		agh_port=$(agh_dns_port "$configpath" 2>/dev/null)
		if [ -n "$agh_port" ] && is_valid_port "$agh_port"; then
			port_is_listening "$agh_port"
			listen_state="$?"
			case "$listen_state" in
				0|2)
					"$AGH_INIT" do_redirect 1
					return 0
					;;
			esac
			logger -t AdGuardHome "passwall watch: AGH DNS port ${agh_port} not listening yet, deferring redirect"
			return 1
		else
			"$AGH_INIT" do_redirect 1
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
	# Independent of PassWall transitions: make sure our own port-53 redirect
	# rule did not get lost.  _do_redirect only installs it while AdGuard Home's
	# DNS port is already up, so a start-up race (or a rebuilt firewall) can
	# leave it missing until something else happens to re-apply it.
	agh_redirect_needs_repair && repair_agh_redirect_once
done

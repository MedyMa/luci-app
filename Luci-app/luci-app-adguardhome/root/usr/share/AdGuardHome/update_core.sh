#!/bin/sh

PATH='/usr/sbin:/usr/bin:/sbin:/bin'
CONFIGURATION='AdGuardHome'
LINKS_FILE='/usr/share/AdGuardHome/links.txt'
RUN_FILE='/var/run/update_core'
ERROR_FILE='/var/run/update_core_error'
UPDATE_LOG='/tmp/AdGuardHome_update.log'
WORK_DIR='/tmp/AdGuardHomeupdate'
DEFAULT_BINPATH='/etc/config/adGuardConfig/AdGuardHome'
DEFAULT_CONFIGPATH='/etc/config/adGuardConfig/AdGuardHome.yaml'
DEFAULT_WORKDIR='/etc/config/adGuardConfig/workspace'

exit_update() {
	if [ -f "$RUN_FILE" ] && [ "$(cat "$RUN_FILE" 2>/dev/null)" = "$$" ]; then
		rm -f "$RUN_FILE"
	fi
	[ "${1:-0}" = '0' ] || touch "$ERROR_FILE"
	exit "${1:-0}"
}

log_timestamp() {
	date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || printf '%s' '0000-00-00 00:00:00'
}

log_msg() {
	local level="$1"
	shift
	if [ "$#" -eq 0 ] || [ -z "$*" ]; then
		printf '\n'
		return 0
	fi
	printf '[%s] [%s] %s\n' "$(log_timestamp)" "$level" "$*"
}

log_line() {
	log_msg INFO "$@"
}

log_info() {
	log_msg INFO "$@"
}

log_warn() {
	log_msg WARN "$@"
}

log_error() {
	log_msg ERROR "$@"
}

log_success() {
	log_msg OK "$@"
}

log_section() {
	log_msg INFO "========== $* =========="
}

get_uci() {
	local option="$1" fallback="$2" value
	value=$(uci -q get "$CONFIGURATION.$CONFIGURATION.$option" 2>/dev/null)
	[ -n "$value" ] && printf '%s\n' "$value" || printf '%s\n' "$fallback"
}

resolve_binpath() {
	local path="$1" parent
	[ -n "$path" ] || path="$DEFAULT_BINPATH"
	while [ "${path%/}" != "$path" ]; do
		path="${path%/}"
	done
	[ -n "$path" ] || path="$DEFAULT_BINPATH"
	parent="${path%/*}"
	if [ "${path##*/}" = 'AdGuardHome' ] && [ "$parent" != "$path" ] && [ "${parent##*/}" = 'AdGuardHome' ] && [ -e "$parent" ] && [ ! -d "$parent" ]; then
		path="$parent"
	fi
	if [ -d "$path" ]; then
		printf '%s/AdGuardHome\n' "$path"
	else
		printf '%s\n' "$path"
	fi
}

normalize_runtime_path() {
	local path="$1" fallback="$2" binpath="$3" mode="$4" parent
	[ -n "$path" ] || path="$fallback"
	while [ "${path%/}" != "$path" ]; do
		path="${path%/}"
	done
	[ -n "$path" ] || path="$fallback"
	case "$path" in
		"$binpath"|"$binpath"/*) path="$fallback" ;;
	esac
	if [ "$mode" = 'dir' ] && [ -e "$path" ] && [ ! -d "$path" ]; then
		path="$fallback"
	fi
	parent="${path%/*}"
	if [ "$parent" != "$path" ] && [ -e "$parent" ] && [ ! -d "$parent" ]; then
		path="$fallback"
	fi
	printf '%s\n' "$path"
}

resolve_configpath() {
	normalize_runtime_path "$1" "$DEFAULT_CONFIGPATH" "$2" file
}

resolve_workdir() {
	normalize_runtime_path "$1" "$DEFAULT_WORKDIR" "$2" dir
}

resolve_dns_port() {
	# Section-aware resolver: only returns port under the dns: block,
	# ignoring any other port: keys at different YAML levels.
	[ -r "$1" ] || return 1
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
		gsub(/["\x27]/, "", $0)
		print $0
		exit
	}' "$1" 2>/dev/null
}

sync_runtime_paths() {
	local raw_binpath="$1" binpath="$2" raw_configpath="$3" configpath="$4" raw_workdir="$5" workdir="$6"
	if [ "$raw_binpath" != "$binpath" ] || [ "$raw_configpath" != "$configpath" ] || [ "$raw_workdir" != "$workdir" ]; then
		uci -q set "$CONFIGURATION.$CONFIGURATION.binpath=$binpath"
		uci -q set "$CONFIGURATION.$CONFIGURATION.configpath=$configpath"
		uci -q set "$CONFIGURATION.$CONFIGURATION.workdir=$workdir"
		uci -q commit "$CONFIGURATION"
	fi
}

setup_downloader() {
	if command -v curl >/dev/null 2>&1; then
		DOWNLOADER='curl'
		return 0
	fi
	if command -v wget >/dev/null 2>&1; then
		DOWNLOADER='wget'
		return 0
	fi
	if command -v wget-ssl >/dev/null 2>&1; then
		DOWNLOADER='wget-ssl'
		return 0
	fi
	log_error 'curl or wget is required.'
	return 1
}

classify_download_error() {
	local text="$1"
	case "$text" in
		*"Could not resolve host"*|*"bad address"*)
			DOWNLOAD_ERROR_HINT='DNS resolution failed while downloading the core. Keep AdGuard Home running during update, or make sure the router still has a working upstream DNS after stopping it.'
			;;
		*"Failed to connect"*|*"Connection refused"*|*"Network is unreachable"*|*"Operation timed out"*|*"Connection timed out"*)
			DOWNLOAD_ERROR_HINT='Network connection failed while downloading the core. Check WAN connectivity and upstream DNS reachability.'
			;;
	esac
}

format_bytes() {
	local bytes scaled whole frac unit
	bytes="${1:-0}"
	case "$bytes" in
		''|*[!0-9]*) bytes=0 ;;
	esac
	if [ "$bytes" -lt 1024 ] 2>/dev/null; then
		printf '%s B' "$bytes"
		return 0
	fi
	scaled=$((bytes * 10 / 1024))
	unit='KiB'
	if [ "$scaled" -ge 10240 ] 2>/dev/null; then
		scaled=$((scaled * 10 / 1024))
		unit='MiB'
	fi
	if [ "$scaled" -ge 10240 ] 2>/dev/null; then
		scaled=$((scaled * 10 / 1024))
		unit='GiB'
	fi
	if [ "$scaled" -ge 10240 ] 2>/dev/null; then
		scaled=$((scaled * 10 / 1024))
		unit='TiB'
	fi
	whole=$((scaled / 10))
	frac=$((scaled % 10))
	printf '%s.%s %s' "$whole" "$frac" "$unit"
}

get_file_size() {
	local file="$1"
	[ -e "$file" ] || return 1
	set -- $(wc -c "$file" 2>/dev/null)
	case "$1" in
		''|*[!0-9]*) return 1 ;;
	esac
	printf '%s\n' "$1"
}

make_progress_bar() {
	local percent="$1" width="$2" filled empty bar i
	case "$percent" in
		''|*[!0-9]*) percent=0 ;;
	esac
	case "$width" in
		''|*[!0-9]*) width=20 ;;
	esac
	[ "$percent" -gt 100 ] 2>/dev/null && percent=100
	[ "$percent" -lt 0 ] 2>/dev/null && percent=0
	filled=$((percent * width / 100))
	empty=$((width - filled))
	bar=''
	i=0
	while [ "$i" -lt "$filled" ]; do
		bar="${bar}#"
		i=$((i + 1))
	done
	i=0
	while [ "$i" -lt "$empty" ]; do
		bar="${bar}-"
		i=$((i + 1))
	done
	printf '[%s]' "$bar"
}

get_remote_size() {
	local url="$1" size
	case "$DOWNLOADER" in
		curl)
			size=$(curl -L -k --retry 2 --connect-timeout 20 --silent --show-error -I "$url" 2>/dev/null | tr -d '\r' | grep -i '^Content-Length:' | tail -1 | sed 's/^[^:]*:[[:space:]]*//')
			;;
		wget|wget-ssl)
			size=$("$DOWNLOADER" --server-response --spider --no-check-certificate -t 1 -T 20 "$url" 2>&1 | tr -d '\r' | grep -i '^[[:space:]]*Content-Length:' | tail -1 | sed 's/^[^:]*:[[:space:]]*//')
			;;
		*) size='' ;;
	esac
	case "$size" in
		''|*[!0-9]*) return 1 ;;
	esac
	printf '%s\n' "$size"
}

print_download_progress() {
	local output="$1" total_size="$2" size percent human_size human_total bar
	size=$(get_file_size "$output" 2>/dev/null || printf '%s\n' 0)
	human_size=$(format_bytes "$size")
	if [ -n "$total_size" ] && [ "$total_size" -gt 0 ] 2>/dev/null; then
		if [ "$size" -gt "$total_size" ]; then
			size="$total_size"
			human_size=$(format_bytes "$size")
		fi
		percent=$((size * 100 / total_size))
		[ "$percent" -gt 100 ] 2>/dev/null && percent=100
		human_total=$(format_bytes "$total_size")
		bar=$(make_progress_bar "$percent" 24)
		log_info "Download progress: $bar $percent% ($human_size / $human_total)"
	else
		bar=$(make_progress_bar 0 24)
		log_info "Download progress: $bar -- ($human_size downloaded)"
	fi
}

download_to() {
	local output="$1" url="$2" errfile errfull rc download_pid last_size total_size current_size final_size
	errfile="$WORK_DIR/download.stderr"
	errfull="$WORK_DIR/download.stderr.all"
	rm -f "$errfile" "$errfull"
	total_size=$(get_remote_size "$url" 2>/dev/null || true)
	if [ -n "$total_size" ] && [ "$total_size" -gt 0 ] 2>/dev/null; then
		log_info "Remote size: $(format_bytes "$total_size")."
	else
		log_warn 'Remote size is unavailable; progress will show downloaded bytes only.'
	fi
	case "$DOWNLOADER" in
		curl)
			log_info 'Downloader: curl.'
			curl -L -k --retry 2 --connect-timeout 20 --silent --show-error -o "$output" "$url" 2>"$errfile" &
			download_pid=$!
			;;
		wget|wget-ssl)
			log_info "Downloader: $DOWNLOADER."
			"$DOWNLOADER" --no-check-certificate -t 2 -T 20 -nv -O "$output" "$url" 2>"$errfile" &
			download_pid=$!
			;;
		*) return 1 ;;
	esac
	last_size='-1'
	print_download_progress "$output" "$total_size"
	while kill -0 "$download_pid" 2>/dev/null; do
		if [ -s "$errfile" ]; then
			cat "$errfile" >> "$errfull"
			: > "$errfile"
		fi
		current_size=$(get_file_size "$output" 2>/dev/null || true)
		if [ -n "$current_size" ] && [ "$current_size" != "$last_size" ]; then
			print_download_progress "$output" "$total_size"
			last_size="$current_size"
		fi
		sleep 1
	done
	wait "$download_pid"; rc=$?
	if [ -s "$errfile" ]; then
		cat "$errfile" >> "$errfull"
		: > "$errfile"
	fi
	current_size=$(get_file_size "$output" 2>/dev/null || true)
	if [ -n "$current_size" ] && [ "$current_size" != "$last_size" ]; then
		print_download_progress "$output" "$total_size"
	fi
	if [ -s "$errfull" ] || [ -s "$errfile" ]; then
		classify_download_error "$({
			cat "$errfull" "$errfile" 2>/dev/null
		} | grep -E '(Could not resolve host|bad address|Failed to connect|Connection refused|Network is unreachable|Operation timed out|Connection timed out)' | head -1)"
	fi
	final_size=$(get_file_size "$output" 2>/dev/null || true)
	if [ "${rc:-1}" = 0 ] && [ -n "$final_size" ]; then
		log_success "Download completed: $(format_bytes "$final_size")."
	else
		log_error "Download command failed with exit code ${rc:-1}."
		if [ -s "$errfull" ]; then
			while IFS= read -r line; do
				[ -n "$line" ] && log_warn "Downloader output: $line"
			done < "$errfull"
		fi
	fi
	rm -f "$errfile" "$errfull"
	return "${rc:-1}"
}

download_stdout() {
	local url="$1"
	case "$DOWNLOADER" in
		curl) curl -L -k --retry 2 --connect-timeout 20 "$url" ;;
		wget|wget-ssl) "$DOWNLOADER" --no-check-certificate -t 2 -T 20 -O - "$url" ;;
		*) return 1 ;;
	esac
}

normalize_arch() {
	local arch="$1" kernel machine
	case "$arch" in
		386|amd64|armv5|armv6|armv7|arm64|mips_softfloat|mips64_softfloat|mipsle_softfloat|mips64le_softfloat|ppc64le) printf '%s\n' "$arch"; return 0 ;;
	esac
	kernel=$(opkg info kernel 2>/dev/null | awk '/Architecture/{print $2; exit}')
	machine=$(uname -m 2>/dev/null)
	case "$kernel:$machine" in
		i386:*|i486:*|i686:*|i786:*) echo 386 ;;
		x86_64:*|x86:*) echo amd64 ;;
		mipsel:*|mips_24kc:*) echo mipsle_softfloat ;;
		mips64el:*) echo mips64le_softfloat ;;
		mips:*) echo mips_softfloat ;;
		mips64:*) echo mips64_softfloat ;;
		arm:armv8l|arm:armv7l) echo armv7 ;;
		arm:armv6l) echo armv6 ;;
		arm:*) echo armv5 ;;
		aarch64:*|*:aarch64) echo arm64 ;;
		powerpc64:*|ppc64le:*|*:ppc64le) echo ppc64le ;;
		*) echo "Unsupported architecture: $kernel $machine" >&2; return 1 ;;
	esac
}

latest_version() {
	local channel="$1" json
	if [ "$channel" = 'beta' ]; then
		json=$(download_stdout 'https://api.github.com/repos/AdguardTeam/AdGuardHome/releases' 2>/dev/null)
		printf '%s\n' "$json" | sed 's/},{/}\n{/g' | awk '/"prerelease": true/{p=1} p && /"tag_name"/{gsub(/[",]/,"",$2); print $2; exit}'
	else
		download_stdout 'https://api.github.com/repos/AdguardTeam/AdGuardHome/releases/latest' 2>/dev/null | awk -F '"' '/tag_name/{print $4; exit}'
	fi
}

current_version() {
	local binpath="$1"
	[ -x "$binpath" ] || return 0
	"$binpath" --version 2>/dev/null | grep -m 1 -oE 'v?[0-9]+[.][A-Za-z0-9._-]+'
}

validate_binary() {
	local binary="$1"
	[ -x "$binary" ] || return 1
	"$binary" --version >/dev/null 2>&1
}

is_valid_port() {
	case "$1" in
		''|*[!0-9]*) return 1 ;;
	esac
	[ "$1" -ge 1 ] 2>/dev/null && [ "$1" -le 65535 ] 2>/dev/null
}

apply_upx() {
	local binary="$1" flag="$2"
	[ -n "$flag" ] || return 0
	if ! command -v upx >/dev/null 2>&1; then
		log_warn 'UPX flag set, but upx is not installed. Skipping compression.'
		return 0
	fi
	log_info "Running UPX compression with flag: $flag."
	upx "$flag" "$binary" 2>&1 || true
}

prepare_links() {
	local latest_ver="$1" arch="$2" link
	grep -v '^[[:space:]]*#' "$LINKS_FILE" 2>/dev/null | sed '/^[[:space:]]*$/d' | while IFS= read -r link; do
		link=$(printf '%s\n' "$link" | sed "s/\${latest_ver}/$latest_ver/g; s/\${Arch}/$arch/g")
		printf '%s\n' "$link"
	done
}

prepare_runtime_layout() {
	local binpath="$1" configpath="$2" workdir="$3"
	mkdir -p "${binpath%/*}" "${configpath%/*}" "$workdir/data" || return 1
	[ -d "$workdir" ] && [ -d "$workdir/data" ]
}

wait_core_running() {
	local binpath="$1" configpath="$2" retry agh_port port_ret
	[ -x "$binpath" ] || return 1
	[ -n "$configpath" ] || configpath="$DEFAULT_CONFIGPATH"
	for retry in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
		pgrep -f "$binpath" >/dev/null 2>&1 || { sleep 1; continue; }
		agh_port=$(resolve_dns_port "$configpath")
		[ -z "$agh_port" ] && return 0
		port_is_listening "$agh_port"; port_ret=$?
		case "$port_ret" in
			0|2) return 0 ;;
		esac
		sleep 1
	done
	return 1
}

_restore_backup_and_exit() {
	if [ -x "$backupbin" ]; then
		log_warn 'Restoring previous core.'
		cp -fp "$backupbin" "$binpath" >/dev/null 2>&1 || true
		chmod 0755 "$binpath" >/dev/null 2>&1 || true
		if [ "$enabled" = '1' ]; then
			AGH_SKIP_UPDATE=1 /etc/init.d/AdGuardHome start >/dev/null 2>&1 || true
		fi
	fi
	exit_update 1
}

wait_core_stopped() {
	local binpath="$1" retry pid
	[ -n "$binpath" ] || return 0
	for retry in 1 2 3 4 5 6 7 8 9 10; do
		pgrep -f "$binpath" >/dev/null 2>&1 || return 0
		sleep 1
	done
	pgrep -f "$binpath" 2>/dev/null | while read -r pid; do
		[ -n "$pid" ] && kill "$pid" 2>/dev/null || true
	done
	for retry in 1 2 3 4 5; do
		pgrep -f "$binpath" >/dev/null 2>&1 || return 0
		sleep 1
	done
	return 1
}

port_is_listening() {
	local port="$1"
	[ -z "$port" ] && return 1
	if command -v ss >/dev/null 2>&1; then
		ss -lntu 2>/dev/null | grep -q ":$port " && return 0
		return 1
	fi
	if command -v netstat >/dev/null 2>&1; then
		netstat -lntu 2>/dev/null | grep -q ":$port " && return 0
		return 1
	fi
	return 2
}

dnsmasq_forwards_to_adguard() {
	local port="$1" server
	[ -n "$port" ] || return 1
	for server in $(uci -q get dhcp.@dnsmasq[0].server 2>/dev/null); do
		[ "$server" = "127.0.0.1#$port" ] && return 0
	done
	return 1
}

ensure_dns_before_network_update() {
	local binpath="$1" configpath="$2" agh_port listen_state
	[ -r "$configpath" ] || return 0
	agh_port=$(resolve_dns_port "$configpath")
	is_valid_port "$agh_port" || return 0
	dnsmasq_forwards_to_adguard "$agh_port" || return 0

	if pgrep -f "$binpath" >/dev/null 2>&1; then
		port_is_listening "$agh_port"
		listen_state="$?"
		case "$listen_state" in
			0|2) return 0 ;;
		esac
	fi

	log_warn "dnsmasq is forwarding to AdGuard Home on port ${agh_port}, but the DNS listener is not ready."
	log_warn 'Restoring dnsmasq DNS before checking/downloading the core.'
	/etc/init.d/AdGuardHome do_redirect 0 >/dev/null 2>&1 || true
}

run_update() {
	local force="$1" raw_binpath raw_configpath raw_workdir binpath configpath workdir upxflag channel arch latest_ver now_ver url archive downloadbin success basename enabled backupbin
	DOWNLOAD_ERROR_HINT=''
	log_section 'AdGuard Home core update started'
	if [ "$force" = 'force' ]; then
		log_info 'Update mode: forced core reinstall.'
	else
		log_info 'Update mode: normal core update.'
	fi
	raw_binpath=$(get_uci binpath "$DEFAULT_BINPATH")
	binpath=$(resolve_binpath "$raw_binpath")
	raw_configpath=$(get_uci configpath "$DEFAULT_CONFIGPATH")
	configpath=$(resolve_configpath "$raw_configpath" "$binpath")
	raw_workdir=$(get_uci workdir "$DEFAULT_WORKDIR")
	workdir=$(resolve_workdir "$raw_workdir" "$binpath")
	upxflag=$(get_uci upxflag '')
	channel=$(get_uci release_channel "$(get_uci tagname release)")
	enabled=$(get_uci enabled '0')
	arch=$(normalize_arch "$(get_uci downloadarch "$(get_uci arch auto)")") || exit_update 1
	sync_runtime_paths "$raw_binpath" "$binpath" "$raw_configpath" "$configpath" "$raw_workdir" "$workdir"
	log_info "Binary path: $binpath"
	log_info "Config path: $configpath"
	log_info "Work directory: $workdir"
	log_info "Release channel: $channel"
	log_info "Download architecture: $arch"
	mkdir -p "${binpath%/*}" "$WORK_DIR" /tmp/run || { log_error 'Failed to prepare binary directory.'; exit_update 1; }
	prepare_runtime_layout "$binpath" "$configpath" "$workdir" || { log_error 'Failed to prepare runtime directories.'; exit_update 1; }
	rm -rf "$WORK_DIR"/*
	setup_downloader || exit_update 1
	ensure_dns_before_network_update "$binpath" "$configpath"
	log_info "Selected downloader: $DOWNLOADER"
	log_section 'Version check'
	log_info 'Checking latest version...'
	latest_ver=$(latest_version "$channel")
	[ -n "$latest_ver" ] || { log_error 'Failed to check latest version.'; exit_update 1; }
	now_ver=$(current_version "$binpath")
	if [ "$force" != 'force' ] && [ -n "$now_ver" ] && [ "$now_ver" = "$latest_ver" ]; then
		log_success "Already latest: $now_ver"
		exit_update 0
	fi
	log_info "Local version: ${now_ver:-missing}."
	log_info "Cloud version: $latest_ver."
	[ "$force" = 'force' ] && log_warn 'Force update requested; the latest core will be downloaded and reinstalled.'
	success=0
	prepare_links "$latest_ver" "$arch" > /tmp/run/AdHlinks.txt
	log_section 'Download'
	while IFS= read -r url; do
		[ -n "$url" ] || continue
		basename=${url##*/}
		archive="$WORK_DIR/$basename"
		log_info "Download source: $url"
		if download_to "$archive" "$url"; then
			success=1
			break
		fi
		rm -f "$archive"
		log_warn 'Download failed, trying next source.'
	done < /tmp/run/AdHlinks.txt
	rm -f /tmp/run/AdHlinks.txt
	[ "$success" = 1 ] || {
		log_error 'No download source succeeded.'
		[ -n "$DOWNLOAD_ERROR_HINT" ] && log_error "$DOWNLOAD_ERROR_HINT"
		exit_update 1
	}
	log_section 'Install'
	case "$archive" in
		*.tar.gz|*.tgz)
			log_info "Extracting archive: $basename"
			tar -zxf "$archive" -C "$WORK_DIR" >/dev/null 2>&1 || { log_error 'Failed to extract archive.'; exit_update 1; }
			downloadbin="$WORK_DIR/AdGuardHome/AdGuardHome"
			;;
		*)
			log_info 'Downloaded file is treated as executable binary.'
			downloadbin="$archive"
			;;
	esac
	[ -f "$downloadbin" ] || { log_error 'AdGuardHome binary missing from downloaded package.'; exit_update 1; }
	chmod 0755 "$downloadbin"
	apply_upx "$downloadbin" "$upxflag"
	log_info 'Validating downloaded core binary.'
	validate_binary "$downloadbin" || { log_error 'Downloaded AdGuardHome binary failed validation.'; exit_update 1; }
	backupbin="$WORK_DIR/AdGuardHome.backup"
	rm -f "$backupbin"
	if [ -e "$binpath" ]; then
		log_info 'Backing up current core binary.'
		cp -fp "$binpath" "$backupbin" || { log_error 'Failed to back up current binary.'; exit_update 1; }
	fi
	log_info 'Stopping AdGuard Home service before replacing the core.'
	/etc/init.d/AdGuardHome stop nobackup >/dev/null 2>&1 || true
	wait_core_stopped "$binpath" || {
		log_error 'Timed out while stopping the current AdGuard Home process.'
		_restore_backup_and_exit
	}
	log_info 'Installing new core binary.'
	mv -f "$downloadbin" "$binpath" || {
		log_error 'Failed to install binary.'
		_restore_backup_and_exit
	}
	chmod 0755 "$binpath"
	prepare_runtime_layout "$binpath" "$configpath" "$workdir" || {
		log_error 'Failed to prepare runtime directories.'
		_restore_backup_and_exit
	}
	if [ "$enabled" = '1' ]; then
		log_info 'Starting AdGuard Home service after core replacement.'
		AGH_SKIP_UPDATE=1 /etc/init.d/AdGuardHome start >/dev/null 2>&1 || true
		if ! wait_core_running "$binpath" "$configpath"; then
			log_error 'Core updated, but failed to start service.'
			_restore_backup_and_exit
		fi
		log_success 'AdGuard Home service is running.'
	else
		log_info 'Service is disabled in UCI; core was installed without starting the service.'
	fi
	rm -rf "$WORK_DIR"
	log_section 'Finished'
	log_success 'Succeeded in updating core.'
	exit_update 0
}

if [ -f "$RUN_FILE" ]; then
	lock_pid=$(cat "$RUN_FILE" 2>/dev/null)
	case "$lock_pid" in
		''|*[!0-9]*) rm -f "$RUN_FILE" ;;
		*)
			kill -0 "$lock_pid" 2>/dev/null || rm -f "$RUN_FILE"
			;;
	esac
fi
(set -C; echo "$$" > "$RUN_FILE") 2>/dev/null || {
	log_line 'A task is already running.'
	exit 2
}
trap 'exit_update 1' INT TERM
: > "$UPDATE_LOG"
rm -f "$ERROR_FILE"
run_update "$1"

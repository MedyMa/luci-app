#!/bin/sh

PATH='/usr/sbin:/usr/bin:/sbin:/bin'
CONFIGURATION='AdGuardHome'
LINKS_FILE='/usr/share/AdGuardHome/links.txt'
RUN_FILE='/var/run/update_core'
ERROR_FILE='/var/run/update_core_error'
WORK_DIR='/tmp/AdGuardHomeupdate'
DEFAULT_BINPATH='/etc/config/adGuardConfig/AdGuardHome'
DEFAULT_CONFIGPATH='/etc/config/adGuardConfig/AdGuardHome.yaml'
DEFAULT_WORKDIR='/etc/config/adGuardConfig/workspace'

exit_update() {
	rm -f "$RUN_FILE"
	[ "${1:-0}" = '0' ] || touch "$ERROR_FILE"
	exit "${1:-0}"
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
	echo 'curl or wget is required.'
	return 1
}

download_to() {
	local output="$1" url="$2"
	case "$DOWNLOADER" in
		curl) curl -L -k --retry 2 --connect-timeout 20 -o "$output" "$url" ;;
		wget|wget-ssl) "$DOWNLOADER" --no-check-certificate -t 2 -T 20 -O "$output" "$url" ;;
		*) return 1 ;;
	esac
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

apply_upx() {
	local binary="$1" flag="$2"
	[ -n "$flag" ] || return 0
	if ! command -v upx >/dev/null 2>&1; then
		echo 'UPX flag set, but upx is not installed. Skipping compression.'
		return 0
	fi
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

run_update() {
	local force="$1" raw_binpath raw_configpath raw_workdir binpath configpath workdir upxflag channel arch latest_ver now_ver url archive downloadbin success basename enabled
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
	mkdir -p "${binpath%/*}" "$WORK_DIR" /tmp/run || { echo 'Failed to prepare binary directory.'; exit_update 1; }
	prepare_runtime_layout "$binpath" "$configpath" "$workdir" || { echo 'Failed to prepare runtime directories.'; exit_update 1; }
	rm -rf "$WORK_DIR"/*
	setup_downloader || exit_update 1
	echo 'Checking latest version...'
	latest_ver=$(latest_version "$channel")
	[ -n "$latest_ver" ] || { echo 'Failed to check latest version.'; exit_update 1; }
	now_ver=$(current_version "$binpath")
	if [ "$force" != 'force' ] && [ -n "$now_ver" ] && [ "$now_ver" = "$latest_ver" ]; then
		echo "Already latest: $now_ver"
		exit_update 0
	fi
	echo "Local version: ${now_ver:-missing}. Cloud version: $latest_ver."
	success=0
	prepare_links "$latest_ver" "$arch" > /tmp/run/AdHlinks.txt
	while IFS= read -r url; do
		[ -n "$url" ] || continue
		basename=${url##*/}
		archive="$WORK_DIR/$basename"
		echo "Downloading $url"
		if download_to "$archive" "$url"; then
			success=1
			break
		fi
		rm -f "$archive"
		echo 'Download failed, trying next source.'
	done < /tmp/run/AdHlinks.txt
	rm -f /tmp/run/AdHlinks.txt
	[ "$success" = 1 ] || { echo 'No download source succeeded.'; exit_update 1; }
	case "$archive" in
		*.tar.gz|*.tgz)
			tar -zxf "$archive" -C "$WORK_DIR" >/dev/null 2>&1 || { echo 'Failed to extract archive.'; exit_update 1; }
			downloadbin="$WORK_DIR/AdGuardHome/AdGuardHome"
			;;
		*) downloadbin="$archive" ;;
	esac
	[ -f "$downloadbin" ] || { echo 'AdGuardHome binary missing from downloaded package.'; exit_update 1; }
	chmod 0755 "$downloadbin"
	apply_upx "$downloadbin" "$upxflag"
	/etc/init.d/AdGuardHome stop nobackup >/dev/null 2>&1 || true
	mv -f "$downloadbin" "$binpath" || { echo 'Failed to install binary.'; exit_update 1; }
	chmod 0755 "$binpath"
	rm -rf "$WORK_DIR"
	rm -f "$RUN_FILE"
	prepare_runtime_layout "$binpath" "$configpath" "$workdir" || { echo 'Failed to prepare runtime directories.'; exit_update 1; }
	if [ "$enabled" = '1' ]; then
		AGH_SKIP_UPDATE=1 /etc/init.d/AdGuardHome start >/dev/null 2>&1 || { echo 'Core updated, but failed to start service.'; exit_update 1; }
	fi
	echo 'Succeeded in updating core.'
	exit_update 0
}

if [ -e "$RUN_FILE" ] && pgrep -f '/usr/share/AdGuardHome/update_core.sh' >/dev/null 2>&1; then
	echo 'A task is already running.'
	exit 2
fi
trap 'exit_update 1' INT TERM
touch "$RUN_FILE"
rm -f "$ERROR_FILE"
run_update "$1"

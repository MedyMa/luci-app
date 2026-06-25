#!/bin/sh

PATH='/usr/sbin:/usr/bin:/sbin:/bin'
CONFIG='AdGuardHome'
TMP_LIST='/tmp/gfwlist.txt'
TMP_ADG='/tmp/adguard.list'
TMP_FETCH='/tmp/gfwlist.base64'
GFW_DIR='/etc/AdGuardHome'
GFW_RULE_FILE="$GFW_DIR/gfw_upstream.txt"
DEFAULT_BINPATH='/etc/config/adGuardConfig/AdGuardHome'

mkdir -p "$GFW_DIR"

resolve_binpath() {
	local path="$1"
	[ -n "$path" ] || path="$DEFAULT_BINPATH"
	while [ "${path%/}" != "$path" ]; do
		path="${path%/}"
	done
	[ -n "$path" ] || path="$DEFAULT_BINPATH"
	if [ -d "$path" ]; then
		printf '%s/AdGuardHome\n' "$path"
	else
		printf '%s\n' "$path"
	fi
}

agh_is_running() {
	local raw_binpath binpath
	raw_binpath=$(uci -q get "$CONFIG.$CONFIG.binpath" 2>/dev/null)
	binpath=$(resolve_binpath "$raw_binpath")
	pgrep -f "$binpath" >/dev/null 2>&1
}

import_upstream_dns() {
	printf '{"ok":true,"message":"Automatic upstream_dns import is disabled. Copy entries from /etc/AdGuardHome/gfw_upstream.txt in the AdGuard Home console if needed."}\n'
	return 0
}

remove_imported_upstream_dns() {
	printf '{"ok":true,"message":"Automatic upstream_dns removal is disabled. Edit upstream DNS in the AdGuard Home console if needed."}\n'
	return 0
}

fetch_gfwlist() {
	local urls url line_count
	urls='https://cdn.jsdelivr.net/gh/gfwlist/gfwlist/gfwlist.txt https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt'
	rm -f "$TMP_FETCH" "$TMP_LIST"
	for url in $urls; do
		if command -v curl >/dev/null 2>&1; then
			curl -L -k --fail --silent --show-error "$url" -o "$TMP_FETCH" 2>/dev/null || continue
		else
			wget --no-check-certificate -T 30 -O "$TMP_FETCH" "$url" 2>/dev/null || continue
		fi
		base64 -d "$TMP_FETCH" > "$TMP_LIST" 2>/dev/null || continue
		line_count=$(wc -l < "$TMP_LIST" 2>/dev/null | tr -d ' ')
		case "$line_count" in
			''|*[!0-9]*) line_count=0 ;;
		esac
		if [ "$line_count" -gt 10 ] 2>/dev/null; then
			rm -f "$TMP_FETCH"
			return 0
		fi
	done
	rm -f "$TMP_FETCH" "$TMP_LIST"
	return 1
}

update_md5() {
	local nowmd5 lastmd5
	nowmd5=$(md5sum "$GFW_RULE_FILE" 2>/dev/null | awk '{print $1}')
	lastmd5=$(uci -q get "$CONFIG.$CONFIG.gfwlistmd5" 2>/dev/null)
	if [ -n "$nowmd5" ] && [ "$nowmd5" != "$lastmd5" ]; then
		uci -q set "$CONFIG.$CONFIG.gfwlistmd5=$nowmd5"
		uci -q commit "$CONFIG"
	fi
}

cleanup_legacy_yaml() {
	[ -f "$configpath" ] || return 0
	agh_is_running && return 0
	sed -i \
		-e '/programaddstart/,/programaddend/d' \
		-e '/gfwimportstart/,/gfwimportend/d' \
		"$configpath"
}

configpath=$(uci -q get "$CONFIG.$CONFIG.configpath" 2>/dev/null)
[ -n "$configpath" ] || configpath='/etc/config/adGuardConfig/AdGuardHome.yaml'

if [ "$1" = 'del' ]; then
	cleanup_legacy_yaml
	rm -f "$GFW_RULE_FILE" "$TMP_LIST" "$TMP_ADG"
	uci -q delete "$CONFIG.$CONFIG.gfwlistmd5"
	uci -q commit "$CONFIG"
	exit 0
fi

if [ "$1" = 'import' ]; then
	import_upstream_dns
	exit $?
fi

if [ "$1" = 'remove_import' ]; then
	remove_imported_upstream_dns
	exit $?
fi

gfwupstream=$(uci -q get "$CONFIG.$CONFIG.gfwupstream" 2>/dev/null)
[ -n "$gfwupstream" ] || gfwupstream='tcp://208.67.220.220:5353'

fetch_gfwlist || {
	echo 'Failed to download a non-empty GFW list from all known mirrors.' >&2
	exit 1
}
awk -v upst="$gfwupstream" '
BEGIN {
	print "    # Generated GFW upstream rules for manual import."
	print "    # Paste these entries into dns.upstream_dns when needed."
	getline
}
{
	s1 = substr($0, 1, 1)
	if (s1 == "!") next
	if (s1 == "@") { $0 = substr($0, 3); s1 = substr($0, 1, 1); white = 1 } else { white = 0 }
	if (s1 == "|") {
		s2 = substr($0, 2, 1)
		if (s2 == "|") { $0 = substr($0, 3); split($0, d, "/"); $0 = d[1] } else { split($0, d, "/"); $0 = d[3] }
	} else { split($0, d, "/"); $0 = d[1] }
	star = index($0, "*")
	if (star != 0) { $0 = substr($0, star + 1); dot = index($0, "."); if (dot != 0) $0 = substr($0, dot + 1); else next; s1 = substr($0, 1, 1) }
	if (s1 == ".") fin = substr($0, 2); else fin = $0
	if (index(fin, ".") == 0 || index(fin, "%") != 0 || index(fin, ":") != 0) next
	match(fin, "^[0-9.]+")
	if (RSTART == 1 && RLENGTH == length(fin)) next
	if (fin == "" || finl == fin) next
	finl = fin
	if (white == 0) print "    - '\''[/" fin "/]" upst "'\''"; else print "    - '\''[/" fin "/]#'\''"
}' "$TMP_LIST" > "$TMP_ADG"

if ! grep -q "^[[:space:]]*-[[:space:]]*'\[/" "$TMP_ADG" 2>/dev/null; then
	rm -f "$TMP_FETCH" "$TMP_LIST" "$TMP_ADG"
	echo 'Failed to generate a non-empty GFW rule file.' >&2
	exit 1
fi

cleanup_legacy_yaml
mv -f "$TMP_ADG" "$GFW_RULE_FILE"
update_md5
rm -f "$TMP_FETCH" "$TMP_LIST" "$TMP_ADG"

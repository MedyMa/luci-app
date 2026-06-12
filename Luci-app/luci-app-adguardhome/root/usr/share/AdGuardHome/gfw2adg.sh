#!/bin/sh

PATH='/usr/sbin:/usr/bin:/sbin:/bin'
CONFIG='AdGuardHome'
TMP_LIST='/tmp/gfwlist.txt'
TMP_ADG='/tmp/adguard.list'
TMP_FETCH='/tmp/gfwlist.base64'
GFW_DIR='/etc/AdGuardHome'
GFW_RULE_FILE="$GFW_DIR/gfw_upstream.txt"
TMP_IMPORT='/tmp/AdGuardHome_gfw_import.list'
TMP_CONFIG='/tmp/AdGuardHome_gfw_import.yaml'
TMP_CHECK='/tmp/AdGuardHome_gfw_import.log'
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

json_ok() {
	printf '{"ok":true}\n'
}

json_error() {
	local escaped
	escaped=$(printf '%s' "$1" | sed ':a;N;$!ba;s/\\/\\\\/g;s/"/\\"/g;s/\r//g;s/\n/\\n/g')
	printf '{"ok":false,"error":"%s"}\n' "$escaped"
}

prepare_yaml_mutation() {
	local raw_binpath
	raw_binpath=$(uci -q get "$CONFIG.$CONFIG.binpath" 2>/dev/null)
	MUTATION_BINPATH=$(resolve_binpath "$raw_binpath")

	if [ ! -r "$configpath" ]; then
		json_error 'Please create the YAML configuration first.'
		return 1
	fi

	if pgrep -f "$MUTATION_BINPATH" >/dev/null 2>&1; then
		json_error 'AdGuard Home is running. Stop the service before modifying upstream DNS.'
		return 1
	fi

	return 0
}

validate_and_commit_yaml() {
	if [ -x "$MUTATION_BINPATH" ]; then
		if ! "$MUTATION_BINPATH" -c "$TMP_CONFIG" --check-config > "$TMP_CHECK" 2>&1; then
			rm -f "$TMP_IMPORT" "$TMP_CONFIG" "$TMP_CHECK"
			json_error "$(cat "$TMP_CHECK" 2>/dev/null)"
			return 1
		fi
	fi

	mv -f "$TMP_CONFIG" "$configpath"
	rm -f "$TMP_IMPORT" "$TMP_CONFIG" "$TMP_CHECK"
	json_ok
	return 0
}

import_upstream_dns() {
	local cleaned_lines

	if [ ! -s "$GFW_RULE_FILE" ]; then
		json_error 'Please generate the GFW rule file first.'
		return 1
	fi

	if ! prepare_yaml_mutation; then
		return 1
	fi

	cleaned_lines=$(sed -e '/^[[:space:]]*# Generated GFW upstream rules/d' -e '/^[[:space:]]*# Paste these entries into dns\.upstream_dns when needed\./d' -e '/^[[:space:]]*$/d' "$GFW_RULE_FILE")
	if [ -z "$cleaned_lines" ]; then
		json_error 'The GFW rule file is empty.'
		return 1
	fi

	if ! grep -q '^[[:space:]]*upstream_dns:[[:space:]]*$' "$configpath"; then
		json_error 'The upstream_dns section was not found in YAML.'
		return 1
	fi

	{
		printf '    # gfwimportstart\n'
		printf '%s\n' "$cleaned_lines"
		printf '    # gfwimportend\n'
	} > "$TMP_IMPORT"

	sed '/gfwimportstart/,/gfwimportend/d' "$configpath" > "$TMP_CONFIG"
	if ! awk -v import_file="$TMP_IMPORT" '
		BEGIN { inserted = 0 }
		/^[[:space:]]*upstream_dns:[[:space:]]*$/ && !inserted {
			print
			while ((getline line < import_file) > 0)
				print line
			close(import_file)
			inserted = 1
			next
		}
		{ print }
		END { if (!inserted) exit 2 }
	' "$TMP_CONFIG" > "$TMP_CONFIG.new"; then
		rm -f "$TMP_IMPORT" "$TMP_CONFIG" "$TMP_CONFIG.new"
		json_error 'Failed to insert imported rules into upstream_dns.'
		return 1
	fi
	mv -f "$TMP_CONFIG.new" "$TMP_CONFIG"
	validate_and_commit_yaml
}

remove_imported_upstream_dns() {
	if ! prepare_yaml_mutation; then
		return 1
	fi

	if ! grep -q 'gfwimportstart' "$configpath" 2>/dev/null; then
		json_ok
		return 0
	fi

	sed '/gfwimportstart/,/gfwimportend/d' "$configpath" > "$TMP_CONFIG"
	validate_and_commit_yaml
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
	[ -f "$configpath" ] && sed -i '/programaddstart/,/programaddend/d' "$configpath"
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

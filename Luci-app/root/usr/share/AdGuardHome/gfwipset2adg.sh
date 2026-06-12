#!/bin/sh

PATH='/usr/sbin:/usr/bin:/sbin:/bin'
CONFIG='AdGuardHome'
TMP_LIST='/tmp/gfwlist.txt'
TMP_ADG='/tmp/adguard.list'
GFW_DIR='/etc/AdGuardHome'

mkdir -p "$GFW_DIR"

fetch_gfwlist() {
	local url='https://cdn.jsdelivr.net/gh/gfwlist/gfwlist/gfwlist.txt'
	if command -v curl >/dev/null 2>&1; then
		curl -L -k "$url" 2>/dev/null | base64 -d > "$TMP_LIST"
	else
		wget --no-check-certificate -T 30 -O - "$url" 2>/dev/null | base64 -d > "$TMP_LIST"
	fi
}

checkmd5() {
	local nowmd5 lastmd5
	nowmd5=$(md5sum "$TMP_ADG" 2>/dev/null | awk '{print $1}')
	lastmd5=$(uci -q get "$CONFIG.$CONFIG.ipsetlistmd5" 2>/dev/null)
	if [ -n "$nowmd5" ] && [ "$nowmd5" != "$lastmd5" ]; then
		uci -q set "$CONFIG.$CONFIG.ipsetlistmd5=$nowmd5"
		uci -q commit "$CONFIG"
		[ "$1" = 'noreload' ] || /etc/init.d/AdGuardHome reload
	fi
}

configpath=$(uci -q get "$CONFIG.$CONFIG.configpath" 2>/dev/null)
[ -n "$configpath" ] || configpath='/etc/config/adGuardConfig/AdGuardHome.yaml'

if [ "$1" = 'del' ]; then
	[ -f "$configpath" ] && sed -i -r 's#ipset_file:[[:space:]]*.*#ipset_file: ""#' "$configpath"
	: > "$TMP_ADG"
	checkmd5 "$2"
	exit 0
fi

if [ ! -f "$configpath" ]; then
	echo 'please make a config first'
	exit 1
fi

gfwupstream=$(uci -q get "$CONFIG.$CONFIG.gfwupstream" 2>/dev/null)
[ -n "$gfwupstream" ] || gfwupstream='tcp://208.67.220.220:5353'

fetch_gfwlist || exit 1
awk -v upst="$gfwupstream" '
BEGIN { getline }
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
	if (white == 0) print "[/" fin "/]" upst; else print "[/" fin "/]#"
}
END { print "[/programaddend/]#" }' "$TMP_LIST" > "$TMP_ADG"

sed -e 's:^\[/::' -e 's:/\].*:/gfwlist:' -e '/#/d' "$TMP_ADG" | sort -u > "$GFW_DIR/ipset.txt"
if [ -s "$GFW_DIR/ipset.txt" ] && command -v ipset >/dev/null 2>&1; then
	ipset list gfwlist >/dev/null 2>&1 || ipset create gfwlist hash:ip 2>/dev/null
	sed -i -r 's#ipset_file:[[:space:]]*.*#ipset_file: /etc/AdGuardHome/ipset.txt#' "$configpath"
fi

checkmd5 "$2"
rm -f "$TMP_LIST" "$TMP_ADG"

#!/bin/sh
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
configpath=$(uci -q get AdGuardHome.AdGuardHome.configpath 2>/dev/null)
redirect=$(uci -q get AdGuardHome.AdGuardHome.redirect 2>/dev/null)
while :
do
	sleep 10
	configpath=$(uci -q get AdGuardHome.AdGuardHome.configpath 2>/dev/null)
	redirect=$(uci -q get AdGuardHome.AdGuardHome.redirect 2>/dev/null)
	if [ "$redirect" = "none" ]; then
		break
	fi
	if [ -r "$configpath" ] && /etc/init.d/AdGuardHome isrunning >/dev/null 2>&1; then
		/etc/init.d/AdGuardHome do_redirect 1
		break
	fi
done
return 0

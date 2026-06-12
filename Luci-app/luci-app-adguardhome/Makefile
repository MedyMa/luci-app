# Copyright (C) 2018-2019 Lienol
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-adguardhome
PKG_VERSION:=1.8
PKG_RELEASE:=31

LUCI_TITLE:=LuCI app for AdGuard Home
LUCI_DESCRIPTION:=Modern LuCI dashboard for AdGuard Home
LUCI_DEPENDS:=+luci-base +rpcd +!wget&&!curl:wget
LUCI_PKGARCH:=all
PKG_MAINTAINER:=<https://github.com/AdguardTeam/AdGuardHome>

define Package/luci-app-adguardhome/conffiles
/usr/share/AdGuardHome/links.txt
/etc/config/AdGuardHome
/etc/config/adGuardConfig/AdGuardHome.yaml
endef

define Build/Prepare/$(PKG_NAME)
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/init.d/AdGuardHome
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/uci-defaults/40_luci-AdGuardHome
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/libexec/rpcd/luci.adguardhome
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/AdGuardHome/addhost.sh
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/AdGuardHome/firewall.start
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/AdGuardHome/getsyslog.sh
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/AdGuardHome/gfw2adg.sh
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/AdGuardHome/gfwipset2adg.sh
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/AdGuardHome/tailto.sh
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/AdGuardHome/update_core.sh
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/AdGuardHome/waitnet.sh
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/AdGuardHome/watchconfig.sh
endef

define Package/luci-app-adguardhome/postinst
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
	for runtime_file in \
		/etc/init.d/AdGuardHome \
		/etc/uci-defaults/40_luci-AdGuardHome \
		/usr/libexec/rpcd/luci.adguardhome \
		/usr/share/AdGuardHome/addhost.sh \
		/usr/share/AdGuardHome/firewall.start \
		/usr/share/AdGuardHome/getsyslog.sh \
		/usr/share/AdGuardHome/gfw2adg.sh \
		/usr/share/AdGuardHome/gfwipset2adg.sh \
		/usr/share/AdGuardHome/tailto.sh \
		/usr/share/AdGuardHome/update_core.sh \
		/usr/share/AdGuardHome/waitnet.sh \
		/usr/share/AdGuardHome/watchconfig.sh
	do
		[ -f "$$runtime_file" ] && chmod 0755 "$$runtime_file"
	done
	for legacy_file in \
		/usr/lib/lua/luci/controller/AdGuardHome.lua \
		/usr/lib/lua/luci/model/cbi/AdGuardHome/base.lua \
		/usr/lib/lua/luci/model/cbi/AdGuardHome/log.lua \
		/usr/lib/lua/luci/model/cbi/AdGuardHome/manual.lua \
		/usr/lib/lua/luci/view/AdGuardHome/AdGuardHome_check.htm \
		/usr/lib/lua/luci/view/AdGuardHome/AdGuardHome_chpass.htm \
		/usr/lib/lua/luci/view/AdGuardHome/AdGuardHome_status.htm \
		/usr/lib/lua/luci/view/AdGuardHome/log.htm \
		/usr/lib/lua/luci/view/AdGuardHome/yamleditor.htm
	do
		rm -f "$$legacy_file"
	done
	rmdir /usr/lib/lua/luci/model/cbi/AdGuardHome 2>/dev/null
	rmdir /usr/lib/lua/luci/view/AdGuardHome 2>/dev/null
	normalize_runtime_path() {
		path="$$1"; fallback="$$2"; binpath_value="$$3"; mode="$$4"
		[ -n "$$path" ] || path="$$fallback"
		while [ "$${path%/}" != "$$path" ]; do path="$${path%/}"; done
		[ -n "$$path" ] || path="$$fallback"
		case "$$path" in
			"$$binpath_value"|"$$binpath_value"/*) path="$$fallback" ;;
		esac
		if [ "$$mode" = 'dir' ] && [ -e "$$path" ] && [ ! -d "$$path" ]; then path="$$fallback"; fi
		parent_path="$${path%/*}"
		if [ "$$parent_path" != "$$path" ] && [ -e "$$parent_path" ] && [ ! -d "$$parent_path" ]; then path="$$fallback"; fi
		printf '%s\n' "$$path"
	}
	normalize_redirect_mode() {
		case "$$1" in
			none|dnsmasq-upstream|redirect|exchange) printf '%s\n' "$$1" ;;
			''|*) printf '%s\n' dnsmasq-upstream ;;
		esac
	}
	configpath="$$(uci -q get AdGuardHome.AdGuardHome.configpath 2>/dev/null)"
	workdir="$$(uci -q get AdGuardHome.AdGuardHome.workdir 2>/dev/null)"
	binpath="$$(uci -q get AdGuardHome.AdGuardHome.binpath 2>/dev/null)"
	redirect_mode="$$(uci -q get AdGuardHome.AdGuardHome.redirect 2>/dev/null)"
	[ -n "$$binpath" ] || binpath='/etc/config/adGuardConfig/AdGuardHome'
	while [ "$${binpath%/}" != "$$binpath" ]; do binpath="$${binpath%/}"; done
	[ -n "$$binpath" ] || binpath='/etc/config/adGuardConfig/AdGuardHome'
	parent="$${binpath%/*}"
	if [ "$${binpath##*/}" = 'AdGuardHome' ] && [ "$$parent" != "$$binpath" ] && [ "$${parent##*/}" = 'AdGuardHome' ] && [ -e "$$parent" ] && [ ! -d "$$parent" ]; then binpath="$$parent"; fi
	[ -d "$$binpath" ] && binpath="$$binpath/AdGuardHome"
	configpath="$$(normalize_runtime_path "$$configpath" '/etc/config/adGuardConfig/AdGuardHome.yaml' "$$binpath" file)"
	workdir="$$(normalize_runtime_path "$$workdir" '/etc/config/adGuardConfig/workspace' "$$binpath" dir)"
	[ -n "$$configpath" ] || configpath='/etc/config/adGuardConfig/AdGuardHome.yaml'
	[ -n "$$workdir" ] || workdir='/etc/config/adGuardConfig/workspace'
	redirect_mode="$$(normalize_redirect_mode "$$redirect_mode")"
	uci -q set AdGuardHome.AdGuardHome.configpath="$$configpath"
	uci -q set AdGuardHome.AdGuardHome.workdir="$$workdir"
	uci -q set AdGuardHome.AdGuardHome.binpath="$$binpath"
	uci -q set AdGuardHome.AdGuardHome.redirect="$$redirect_mode"
	uci -q get AdGuardHome.AdGuardHome.downloadarch >/dev/null 2>&1 || uci set AdGuardHome.AdGuardHome.downloadarch='auto'
	uci -q get AdGuardHome.AdGuardHome.release_channel >/dev/null 2>&1 || uci set AdGuardHome.AdGuardHome.release_channel='release'
	uci -q get AdGuardHome.AdGuardHome.username >/dev/null 2>&1 || uci set AdGuardHome.AdGuardHome.username='root'
	uci -q get AdGuardHome.AdGuardHome.password >/dev/null 2>&1 || uci set AdGuardHome.AdGuardHome.password='admin'
	uci -q commit AdGuardHome
	[ -x /etc/init.d/AdGuardHome ] && /etc/init.d/AdGuardHome enable >/dev/null 2>&1
	if [ "$$(uci -q get AdGuardHome.AdGuardHome.enabled 2>/dev/null)" = '1' ] && [ -x /etc/init.d/AdGuardHome ]; then
		/etc/init.d/AdGuardHome reload >/dev/null 2>&1 || /etc/init.d/AdGuardHome restart >/dev/null 2>&1 || true
	fi
	rm -rf /tmp/luci-modulecache/ /var/luci-modulecache/
	rm -f /tmp/luci-indexcache /tmp/luci-indexcache.* /var/luci-indexcache.* 2>/dev/null
	if [ -x /etc/init.d/rpcd ]; then
		/etc/init.d/rpcd reload >/dev/null 2>&1 || true
		( sleep 1; /etc/init.d/rpcd restart >/dev/null 2>&1 ) &
	fi
fi
exit 0
endef

define Package/luci-app-adguardhome/prerm
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
	/etc/init.d/AdGuardHome disable >/dev/null 2>&1 || true
	/etc/init.d/AdGuardHome stop >/dev/null 2>&1 || true
	uci -q batch <<-EOF >/dev/null 2>&1
		delete ucitrack.@AdGuardHome[-1]
		commit ucitrack
	EOF
fi
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

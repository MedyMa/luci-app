# This is free software, licensed under the Apache License, Version 2.0.
#
# Versioning rule for this package: every change bumps PKG_VERSION by one patch
# level and resets PKG_RELEASE to 1.  A package that keeps the same version
# across changes cannot be told apart after installation - opkg will not even
# treat it as an upgrade - and this package has already been through several
# rounds where the only way to see which collector was running was to read the
# file on the router.  PKG_VERSION is also substituted into the collector at
# build time, so the running version is reported by the page.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-traffic
PKG_VERSION:=0.1.37
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
LUCI_PKGARCH:=all

LUCI_TITLE:=LuCI per-application traffic statistics
LUCI_DESCRIPTION:=Per-application traffic statistics, UCG style: byte counters from conntrack correlated with AdGuard Home DNS answers, plus the proxy tunnel accounted separately.
LUCI_DEPENDS:=+luci-base +lua

define Build/Prepare/$(PKG_NAME)
	$(call Build/Prepare/Default)
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/uci-defaults/40_luci-traffic
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/init.d/traffic
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/libexec/rpcd/luci.traffic
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/traffic/collector.sh
	# The collector reports the version it was built as, so the page can show
	# which collector is actually running.  Substituting it here keeps the
	# Makefile the only place the version is written down.
	$(SED) 's|^COLLECTOR_VERSION=.*|COLLECTOR_VERSION=$(PKG_VERSION)-r$(PKG_RELEASE)|' \
		$(PKG_BUILD_DIR)/root/usr/share/traffic/collector.sh
	# Carry the translation in this package as well as in the generated
	# luci-i18n-<name>-<lang> one.  That package is published with a version of
	# 0, so opkg never treats a newer catalogue as an upgrade and a message added
	# after the first install stays missing on the router forever - which is how
	# the range dropdown ended up with one option in Chinese and the next in
	# English.  po2lmo is the same tool the generated package is built with, and
	# the source is read from ${CURDIR} for the same reason luci.mk does it: po/
	# is not part of what gets prepared into the build directory, and po2lmo
	# reports an unreadable input as a usage error rather than as a missing file.
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n
	po2lmo ${CURDIR}/po/zh_Hans/traffic.po \
		$(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n/traffic.zh-cn.lmo
endef

define Package/$(PKG_NAME)/conffiles
/etc/config/traffic
endef

# Removing the package used to leave the collector running: opkg deletes the
# files, but a shell that is already executing keeps going, so it went on
# polling and went on recreating its accounting chains - and those chains live
# in the kernel, not on disk, so they outlived the uninstall too.  Stop the
# service first, then take the table and the session state with it.  The
# history in /etc/traffic is deliberately kept: that is the user's data, and
# removing a package is not a reason to throw away a week of measurements.
define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
if [ -x /etc/init.d/traffic ]; then
	/etc/init.d/traffic stop >/dev/null 2>&1
	/etc/init.d/traffic disable >/dev/null 2>&1
fi
# the collector is a shell loop, so make sure none survived the stop
pkill -f '/usr/share/traffic/collector.sh' >/dev/null 2>&1
nft delete table inet traffic_acct >/dev/null 2>&1
rm -rf /tmp/traffic
exit 0
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
	[ -f /etc/uci-defaults/40_luci-traffic ] && chmod 0755 /etc/uci-defaults/40_luci-traffic
	[ -f /etc/init.d/traffic ] && chmod 0755 /etc/init.d/traffic
	[ -f /usr/libexec/rpcd/luci.traffic ] && chmod 0755 /usr/libexec/rpcd/luci.traffic
	[ -f /usr/share/traffic/collector.sh ] && chmod 0755 /usr/share/traffic/collector.sh
	rm -rf /tmp/luci-modulecache/ /var/luci-modulecache/
	rm -f /tmp/luci-indexcache /tmp/luci-indexcache.* /var/luci-indexcache.* 2>/dev/null
	[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload >/dev/null 2>&1 || true
	# uci-defaults only run at boot.  Run them here as well, so the querylog
	# path is filled in before the first page load rather than after a reboot.
	[ -x /etc/uci-defaults/40_luci-traffic ] && /etc/uci-defaults/40_luci-traffic >/dev/null 2>&1
	# Installing a procd service neither enables nor starts it, so a fresh
	# install showed no data at all until someone did it by hand.
	if [ -x /etc/init.d/traffic ]; then
		/etc/init.d/traffic enable >/dev/null 2>&1
		/etc/init.d/traffic restart >/dev/null 2>&1
	fi
fi
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

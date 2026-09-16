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
PKG_VERSION:=0.1.6
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
endef

define Package/$(PKG_NAME)/conffiles
/etc/config/traffic
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

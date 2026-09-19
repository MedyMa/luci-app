include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-traffic
PKG_VERSION:=0.1.90
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
LUCI_PKGARCH:=all

LUCI_TITLE:=LuCI per-application traffic statistics
LUCI_DESCRIPTION:=Per-application traffic statistics, UCG style: the totals come from the WAN interface counters, so they stay right with flow offloading on; the per-application breakdown comes from conntrack correlated with AdGuard Home DNS answers, and the proxy tunnel is accounted separately.
LUCI_DEPENDS:=+luci-base +lua

define Build/Prepare/$(PKG_NAME)
	$(call Build/Prepare/Default)
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/uci-defaults/40_luci-traffic
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/init.d/traffic
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/libexec/rpcd/luci.traffic
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/traffic/collector.sh
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/traffic/fetch-icons.sh
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/share/traffic/live.sh
	$(SED) 's|^COLLECTOR_VERSION=.*|COLLECTOR_VERSION=$(PKG_VERSION)-r$(PKG_RELEASE)|' \
		$(PKG_BUILD_DIR)/root/usr/share/traffic/collector.sh
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n
	po2lmo ${CURDIR}/translations/zh_Hans/traffic.po \
		$(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n/traffic.zh-cn.lmo
endef

define Package/$(PKG_NAME)/conffiles
/etc/config/traffic
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
if [ -x /etc/init.d/traffic ]; then
	/etc/init.d/traffic stop >/dev/null 2>&1
	/etc/init.d/traffic disable >/dev/null 2>&1
fi
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
	[ -x /etc/uci-defaults/40_luci-traffic ] && /etc/uci-defaults/40_luci-traffic >/dev/null 2>&1
	if [ -x /etc/init.d/traffic ]; then
		/etc/init.d/traffic enable >/dev/null 2>&1
		/etc/init.d/traffic restart >/dev/null 2>&1
	fi
fi
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# include/scan.mk finds packages by grepping their Makefile for "call
# BuildPackage", so this marker is what makes the package discoverable at all -
# without it the SDK skips the directory silently and the package is not built.
# call BuildPackage - OpenWrt buildroot signature

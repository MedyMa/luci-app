# This is free software, licensed under the Apache License, Version 2.0.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-sfp-status
PKG_VERSION:=0.1.0
PKG_RELEASE:=23
PKG_LICENSE:=Apache-2.0
PKGARCH:=all

LUCI_TITLE:=LuCI SFP status monitor
LUCI_DESCRIPTION:=Overview and detailed DOM status for SFP modules
LUCI_DEPENDS:=+luci-base

define Build/Prepare/$(PKG_NAME)
	$(call Build/Prepare/Default)
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/uci-defaults/40_luci-sfp-status
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/libexec/rpcd/luci.sfp-status
endef

define Package/$(PKG_NAME)/conffiles
/etc/config/sfp-status
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
	[ -f /usr/libexec/rpcd/luci.sfp-status ] && chmod 0755 /usr/libexec/rpcd/luci.sfp-status
	uci -q delete sfp-status.settings.interface
	uci -q commit sfp-status
	rm -rf /var/luci-modulecache/
	rm -f /var/luci-indexcache.*
	[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload
fi
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
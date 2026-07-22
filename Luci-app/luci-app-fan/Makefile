# Copyright (C) 2016 Openwrt.org
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-fan
PKG_VERSION:=0.1.0
PKG_RELEASE:=29
PKG_LICENSE:=Apache-2.0

LUCI_TITLE:=LuCI fan control
LUCI_DESCRIPTION:=Modern LuCI fan control dashboard for BPI-R4 pwm-fan control and thermal telemetry
LUCI_DEPENDS:=+luci-base +coreutils-stat
LUCI_PKGARCH:=all
PKG_MAINTAINER:=MedyMa

define Package/luci-app-fan/conffiles
/etc/config/luci-fan
endef

define Build/Prepare/$(PKG_NAME)
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/init.d/luci-fan
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/uci-defaults/luci-fan
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/libexec/fan-control
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/libexec/rpcd/luci.fan
endef

define Package/luci-app-fan/postinst
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
	for runtime_file in \
		/etc/init.d/luci-fan \
		/etc/uci-defaults/luci-fan \
		/usr/libexec/fan-control \
		/usr/libexec/rpcd/luci.fan
	do
		[ -f "$$runtime_file" ] && chmod 0755 "$$runtime_file"
	done
	rm -rf /tmp/luci-modulecache/ /var/luci-modulecache/
	rm -f /tmp/luci-indexcache /tmp/luci-indexcache.* /var/luci-indexcache.* 2>/dev/null
	/etc/init.d/luci-fan enable 2>/dev/null
	/etc/init.d/luci-fan start >/dev/null 2>&1 || true
	[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature



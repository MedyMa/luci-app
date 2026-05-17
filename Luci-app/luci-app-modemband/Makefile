#
# Copyright 2022-2024 Rafał Wabik - IceG - From eko.one.pl forum
#
# MIT License
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI JS Support for modemband application
LUCI_DESCRIPTION:=LuCI JS interface for the modemband. The package allows set LTE/5G bands for selected 4G/5G modems.
LUCI_DEPENDS:=+modemband

PKG_NAME:=luci-app-modemband
PKG_VERSION:=2.0
PKG_RELEASE:=23

define Package/luci-app-modemband/postinst
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
	rm -rf /tmp/luci-modulecache/ /var/luci-modulecache/
	rm -f /tmp/luci-indexcache /tmp/luci-indexcache.* /var/luci-indexcache.* 2>/dev/null
	[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

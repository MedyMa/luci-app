# Copyright (C) 2008-2026 Jerrykuku
#
# This is free software, licensed under the Apache License, Version 2.0 .

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Argon Theme
LUCI_DEPENDS:=+USE_APK:wget-any +!USE_APK:wget +jsonfilter
PKG_VERSION:=3.0.0
PKG_RELEASE:=1

CONFIG_LUCI_CSSTIDY:=

define Package/luci-theme-argon/conffiles
/etc/config/argon
endef

define Package/luci-theme-argon/postinst
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
	[ -f /etc/uci-defaults/30_luci-theme-argon ] && chmod 0755 /etc/uci-defaults/30_luci-theme-argon
	[ -f /usr/libexec/rpcd/luci.argon_wallpaper ] && chmod 0755 /usr/libexec/rpcd/luci.argon_wallpaper
	rm -rf /tmp/luci-modulecache/ /var/luci-modulecache/
	rm -f /tmp/luci-indexcache /tmp/luci-indexcache.* /var/luci-indexcache.* 2>/dev/null
	[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

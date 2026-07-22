# Copyright (C) 2008-2026 Jerrykuku
#
# This is free software, licensed under the Apache License, Version 2.0 .

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-argon
PKG_VERSION:=3.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0

LUCI_TITLE:=Argon Theme v3 — Modern Redesign
LUCI_DESCRIPTION:=Refactored Argon theme with CSS variable theming, system font stack, \
	button press feedback, prefers-reduced-motion, and component-based Less architecture.
LUCI_DEPENDS:=+USE_APK:wget-any +!USE_APK:wget +jsonfilter
LUCI_PKGARCH:=all
PKG_MAINTAINER:=MedyMa

define Package/luci-theme-argon/conffiles
/etc/config/argon
endef

define Build/Prepare/$(PKG_NAME)
	# Fix shell script permissions for runtime files
	for f in \
		root/etc/uci-defaults/30_luci-theme-argon \
		root/usr/libexec/rpcd/luci.argon_wallpaper \
		root/usr/share/rpcd/acl.d/luci-argon.json
	do
		[ -f "$(PKG_BUILD_DIR)/$$f" ] && chmod 0644 "$(PKG_BUILD_DIR)/$$f"
	done
	# Convert CRLF to LF for all scripts
	find "$(PKG_BUILD_DIR)/root" -type f \( \
		-name '*.sh' -o -path '*/init.d/*' -o -path '*/uci-defaults/*' -o -path '*/libexec/*' \
	\) -exec sed -i 's/\r$$//' {} + 2>/dev/null || true
endef

define Package/luci-theme-argon/postinst
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
	for runtime_file in \
		/etc/uci-defaults/30_luci-theme-argon \
		/usr/libexec/rpcd/luci.argon_wallpaper
	do
		[ -f "$$runtime_file" ] && chmod 0755 "$$runtime_file"
	done
	# Clean LuCI caches so new CSS/JS takes effect
	rm -rf /tmp/luci-modulecache/ /var/luci-modulecache/
	rm -f /tmp/luci-indexcache /tmp/luci-indexcache.* /var/luci-indexcache.* 2>/dev/null
	[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

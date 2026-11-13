# SPDX-License-Identifier: GPL-2.0-only
include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-hqos-mtk
PKG_VERSION:=2.0.0
PKG_RELEASE:=3
PKG_LICENSE:=GPL-2.0-only
PKG_MAINTAINER:=MedyMa <75345465+MedyMa@users.noreply.github.com>
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI MediaTek HQoS bandwidth control
  PKGARCH:=all
  DEPENDS:=@TARGET_mediatek +luci-base +lua +luci-lib-nixio +luci-lib-jsonc +libuci-lua +rpcd +flock +nftables +ip-full +tc-full +kmod-mediatek_hnat +kmod-sched-core +kmod-sched-flower +kmod-ifb
  CONFLICTS:=luci-app-eqos luci-app-eqos-mtk luci-app-mtk-hqos mtk-hqos mtkhqos_util
endef

define Package/$(PKG_NAME)/conffiles
/etc/config/mtk-hqos
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/hqos.js $(1)/www/luci-static/resources/view/
	$(CP) ./root/* $(1)/
	chmod 0600 $(1)/etc/config/mtk-hqos
	chmod 0644 $(1)/usr/share/mtk-hqos/*.lua \
		$(1)/usr/share/luci/menu.d/luci-app-hqos-mtk.json \
		$(1)/usr/share/rpcd/acl.d/luci-app-hqos-mtk.json \
		$(1)/usr/share/ucitrack/luci-app-hqos-mtk.json
	chmod 0755 $(1)/usr/sbin/mtk-hqos $(1)/usr/libexec/rpcd/luci.hqos \
		$(1)/etc/init.d/mtk-hqos $(1)/etc/uci-defaults/95-mtk-hqos \
		$(1)/usr/share/mtk-hqos/watch.sh
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
/etc/init.d/mtk-hqos stop || exit 1
if [ "$${1:-}" != upgrade ] && [ "$${PKG_UPGRADE:-0}" != 1 ]; then
	/etc/init.d/mtk-hqos disable
fi
exit 0
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
	/etc/uci-defaults/95-mtk-hqos || exit 1
	/etc/init.d/mtk-hqos start >/dev/null 2>&1
fi
exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))

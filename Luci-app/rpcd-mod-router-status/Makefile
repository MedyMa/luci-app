include $(TOPDIR)/rules.mk

PKG_NAME:=rpcd-mod-router-status
PKG_VERSION:=0.1.1
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Read-only router system and wireless status
  DEPENDS:=+rpcd +ubus +jshn
endef

define Package/$(PKG_NAME)/description
  Independent CPU counters, sanitized radio status and 24-hour wireless history.
  Does not require LuCI or a traffic statistics package.
endef

define Build/Compile
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/usr/libexec/rpcd $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DIR) $(1)/etc/init.d $(1)/usr/share/router-status
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/router.status $(1)/usr/libexec/rpcd/router.status
	$(INSTALL_BIN) ./root/etc/init.d/router-status $(1)/etc/init.d/router-status
	$(INSTALL_BIN) ./root/usr/share/router-status/wifi-collector.sh $(1)/usr/share/router-status/
	$(INSTALL_DATA) ./root/usr/share/router-status/*.awk $(1)/usr/share/router-status/
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/router-status.json $(1)/usr/share/rpcd/acl.d/
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
/etc/init.d/rpcd restart >/dev/null 2>&1 || exit 1
/etc/init.d/router-status enable
/etc/init.d/router-status restart
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
/etc/init.d/router-status stop >/dev/null 2>&1
/etc/init.d/router-status disable >/dev/null 2>&1
# Keep RAM history during a package upgrade. Reboot clears it naturally.
exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))

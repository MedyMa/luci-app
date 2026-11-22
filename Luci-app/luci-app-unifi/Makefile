include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-unifi
PKG_VERSION:=1.0
PKG_RELEASE:=11
PKG_LICENSE:=GPL-2.0-or-later

LUCI_TITLE:=UniFi management for the MediaTek BE14 access point
LUCI_DEPENDS:=+luci-base +be14-ucg
LUCI_EXTRA_DEPENDS:=be14-ucg (>=1.0-r12)
PKG_PO_VERSION:=$(PKG_VERSION)-r$(PKG_RELEASE)
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

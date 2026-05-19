#
# Copyright 2026 woziwrt
# https://github.com/woziwrt/luci-app-wifi7
#
# Apache-2.0 License
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-wifi7
PKG_VERSION:=1.0.0
PKG_RELEASE:=20260503

LUCI_TITLE:=LuCI WiFi 7 MT7996 module for BPI-R4
LUCI_DESCRIPTION:=LuCI module for WiFi 7 (MT7996 / BPI-R4) on OpenWrt 24.10 and 25.12. Provides Network > WiFi 7 with bilingual English/Simplified Chinese UI, Overview, MLD config, Radio, Networks, Stations and Diagnostics tabs, plus light and dark LuCI theme support.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all
PKG_LICENSE:=Apache-2.0

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

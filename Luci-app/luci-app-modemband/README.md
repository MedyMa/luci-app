# luci-app-modemband

LuCI JavaScript interface for the `modemband` package on OpenWrt and ImmortalWrt 24.10 based systems. The app provides a web UI for checking modem runtime status, viewing SIM and cellular network information, and managing preferred LTE/5G bands for supported 4G/5G modems.

## Features

- LuCI JS views under `Modem > Modem Configuration`.
- Runtime modem overview with manufacturer, model, revision, IMEI, status, power state, and primary AT port.
- Operator, registration, serving cell, region, signal strength, RSRP, RSRQ, SINR, TAC, CID, PCI, and ARFCN display.
- Module temperature and voltage collection through AT commands when supported by the modem.
- SIM card information card with status, ICCID, IMSI, EID, operator, SIM type, and emergency numbers.
- LTE, 5G SA, and 5G NSA band selection pages backed by the `modemband` command line tool.
- Configuration page for WAN restart behavior, modem restart behavior, AT restart command, communication port, and modem template selection.
- Argon-friendly light and dark styling for OpenWrt 24.10 LuCI pages.
- Simplified Chinese translation file in `po/zh_Hans/modemband.po`.

## Package Layout

```text
luci-app-modemband/
├── Makefile
├── htdocs/luci-static/resources/view/modem/
│   ├── overview.js
│   ├── blte.js
│   └── blteconfig.js
├── root/etc/config/modemband
├── root/etc/uci-defaults/
│   ├── setupmb.sh
│   └── set_up_bandz.sh
├── root/usr/bin/loaded.sh
├── root/usr/share/luci/menu.d/luci-app-modemband.json
├── root/usr/share/rpcd/acl.d/luci-app-modemband.json
├── root/usr/share/modemband/probeport.gcom
└── po/
    ├── pl/modemband.po
    └── zh_Hans/modemband.po
```

## Dependencies

The package declares the following LuCI package dependency:

```make
LUCI_DEPENDS:=+modemband
```

The overview page can use these runtime tools when present and permitted by the rpcd ACL:

- `/usr/bin/modemband.sh`
- `/usr/bin/loaded.sh`
- `/usr/bin/mmcli`
- `/usr/bin/sms_tool`

`ModemManager` is recommended for live runtime data. Without it, the page can still load but some status fields may show `--` or an unavailable state.

## SIM Information Sources

The SIM information card reads data from two sources:

1. ModemManager SIM object, using `mmcli -i <sim-index> -J` when the modem exposes a SIM path.
2. AT command fallback through `sms_tool`:
   - `AT+CPIN?` for SIM PIN or readiness state.
   - `AT+QCCID` and `AT+CCID` for ICCID.
   - `AT+CIMI` for IMSI.

If the modem reports `sim-missing`, the card explicitly shows `SIM not detected` instead of leaving the area looking inactive. If a SIM is inserted but ICCID or IMSI remains empty, verify that the selected AT port is correct and that the modem firmware allows those AT commands.

## Build

From an OpenWrt buildroot with the LuCI feed installed:

```sh
./scripts/feeds update luci
./scripts/feeds install luci-app-modemband
make package/luci-app-modemband/compile V=s
```

For a full image build, select or include the package as usual in the OpenWrt buildroot configuration.

## Install

Install the generated package on the router:

```sh
opkg install luci-app-modemband_*.ipk
```

After installation, reload LuCI and rpcd related caches if needed:

```sh
rm -rf /tmp/luci-modulecache
rm -f /tmp/luci-indexcache
/etc/init.d/rpcd reload
```

The page is available at:

```text
System menu: Modem > Modem Configuration
LuCI path: /cgi-bin/luci/admin/modem/luci-app-modemband/overview
```

## Configuration

The default UCI section is stored in `/etc/config/modemband`:

```text
config modemband
        option iface 'wan'
        option wanrestart '0'
        option modemrestart '0'
        option notify '0'
```

Common options are managed from the LuCI configuration page:

- WAN interface name used for connection restart.
- Whether to restart WAN after applying band changes.
- Whether to restart the modem after applying band changes.
- Optional AT command used for modem restart.
- AT communication port used by the app.
- Modem template assigned to the current USB Vendor and Product ID.

## Runtime Checks

Use these commands on the router to verify the runtime environment:

```sh
mmcli -L -J
mmcli -m 0 -J
mmcli -m 0 --location-get -J
sms_tool -d /dev/ttyUSB2 at 'AT+CPIN?'
sms_tool -d /dev/ttyUSB2 at 'AT+QCCID'
sms_tool -d /dev/ttyUSB2 at 'AT+CIMI'
```

Replace `/dev/ttyUSB2` with the AT port configured in the app if your modem uses a different port.

## Validation

For frontend syntax validation during development:

```sh
node --check htdocs/luci-static/resources/view/modem/overview.js
node --check htdocs/luci-static/resources/view/modem/blte.js
node --check htdocs/luci-static/resources/view/modem/blteconfig.js
```

Recommended manual checks after installing or hot-deploying changes:

- Open the Overview page and confirm the modem card renders.
- Confirm the SIM card information card shows either detected SIM details or a clear missing SIM status.
- Confirm signal, temperature, voltage, region, and serving cell fields do not block page rendering when a backend command is unavailable.
- Open Band Settings and verify LTE/5G selected bands load correctly.
- Open Configuration and verify the AT port and restart settings can be saved.

## Notes

- The app targets OpenWrt and LuCI 24.10 style JavaScript views.
- ACL permissions are intentionally limited to the tools and paths needed by the UI.
- Some modem fields depend on firmware support. Missing AT support should result in `--` or an unavailable state, not a blocked LuCI page.
- If LuCI keeps showing stale frontend code after deployment, clear `/tmp/luci-modulecache`, remove `/tmp/luci-indexcache`, and force-refresh the browser cache.

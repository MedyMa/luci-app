# rpcd-mod-router-status

Version 0.1.4 adds `getAccelerationStatus`, a read-only RAM snapshot for the
25.12 LuCI overview. One procd collector samples the passive `hnat_stats`
version 2 summary and optional bounded NPU utilization every five seconds.
The RPC only reads this cache; it never scans flows or reads hardware MIBs.
Its requests renew a monotonic interest marker. Collection stops after 60
seconds without a viewer; an idle router does not repeatedly query NPU firmware.
Snapshots older than 20 seconds of monotonic uptime are unavailable, including
after clock corrections. Missing, legacy, partial and invalid summaries have
no numeric PPE counts. IPv4 and IPv6 counts are bound table entries, with each
direction counted separately; mixed tunnel/translation formats are separate.
They are observational occupancy, not throughput, unique connections or exact
offload coverage. WED/WARP and NPU module presence is reported independently
and does not imply that traffic uses either engine. NPU usage is the actual
five-core mean, or unavailable; an unreadable source is never replaced by zero.
On other targets, unsupported acceleration sources remain unavailable.

Version 0.1.2 adds `temperatures` to `getSystemMetrics`: sanitized records with `kind` (`cpu`, `wifi`, `disk`), `name`, `celsius`, and epoch `sampled_at`. CPU/SoC thermal zones and NVMe/drivetemp hwmon files are read on demand. BE14 readings reuse the one-minute collector's existing `iwpriv stat` call; cache entries older than 180 seconds are omitted. No new daemon, package dependency, or wireless driver call is added. Unsupported sensors remain absent; the mobile app shows a dash.

Independent, read-only device telemetry for the ImmortalWrt mobile app.
No dependency on LuCI, traffic statistics, traffic configuration or traffic caches.

Version 0.1.3 adds optional `getNpuStatus`, backed by `mtk-tops-status` 0.1-r3 or newer. It returns bounded software metadata and explicit missing/failed coverage. No NPU driver or firmware is installed by this package, and no hardware forwarding is inferred from firmware readiness or synchronized parameters. The existing read ACL includes this method. TOPS event counts are never converted to traffic bytes.

## Interfaces

| Object / method | Source | Data |
|---|---|---|
| `router.status.getSystemMetrics` | `/proc/stat` | Aggregate CPU counters; usage requires two samples |
| `router.status.getAccelerationStatus` | Five-second RAM cache | PPE bound IPv4/IPv6/mixed-format counts, WED/WARP and NPU module presence, optional NPU utilization |
| `router.status.getWirelessStatus` | Local `network.wireless status`, sysfs | Radio name, up state, band, channel, EHT width, AP interface, BSSID |
| `router.status.getNpuStatus` | Optional `/usr/bin/mtk-tops-status` | Firmware/MCU readiness, bounded tunnel parameter snapshots and accounting coverage |
| `router.status.getWirelessHistory` | Independent sampler | 24-hour byte rates and interval TX failure / RX CRC percentages |

The raw netifd response may contain configured passwords. The RPC projects only
operational fields and does not expose SSIDs or passwords. It provides no write
methods and does not change driver settings. Vendor `iwpriv stat` is optional:
without it, byte rates still work and failure/CRC values stay null. Airtime,
retry counts and client signal distribution are not fabricated.

`router-status` runs independently under procd. Samples are collected once per
minute in `/tmp/router-status`, retained for 24 hours and returned at five-minute
resolution. Since 0.1.1, RAM storage also retains only the latest minute sample
in each five-minute bucket; legacy files compact automatically on the next sample.
For an aligned full day with three radios, 4,320 rows become 864, while the public
history points and their rate/failure semantics stay the same. Sysfs counters use
shell built-ins and history merging uses one awk pass to reduce process launches.
This reduces stored records and repeated file reads; it is not a measured claim
about total process RSS or CPU usage. There is no history before the first pair of samples. A reboot
clears history; a normal service restart or package upgrade preserves it.

## Installation / migration

1. Install `rpcd-mod-router-status` using the package matching the router's package
   manager (24.10 `.ipk`, 25.12 `.apk`). This is a router package, not an Android APK.
2. Install mobile app 0.4.0 or newer and confirm `router.status` reads work.
   Then upgrade `luci-app-traffic` to 1.1.7 to remove the previously added wireless/CPU
   RPCs and sampler. No statistics collector or archive format changes are made.
3. Installation starts the new sampler and restarts rpcd to register the object.
   Existing rpcd sessions expire; reconnect the mobile app and LuCI afterward.
4. A dedicated read-only account must include the `router-status` read ACL group
   alongside its existing device and flow read permissions. The new group also
   grants `system.info` for uptime, memory and session checks. Do not
   grant write permissions. Administrator accounts retaining `*` read access
   can use the new group after logging in again.
5. Older app versions call the withdrawn methods
   on `luci.traffic` and cannot read the migrated telemetry.

## Device verification

```sh
ubus -v list router.status
ubus call router.status getWirelessStatus '{}'
ubus call router.status getSystemMetrics '{}'
ubus call router.status getNpuStatus '{}'
ubus call router.status getWirelessHistory '{}'
/etc/init.d/router-status status
ubus -v list luci.traffic
```

The BE14 fixture reports 2.4 GHz / channel 3 / EHT40, 5 GHz / channel 40 /
EHT160, and 6 GHz / channel 37 / EHT320. Hardware must report its own current
values, not these fixture values. After at least two samples, history should
contain rates. CPU percentage must follow counter deltas, not load average.
Stop `traffic` temporarily only if desired: device/Wi-Fi reads must still work;
flow statistics naturally need the traffic service. No radio restart is needed.

Host tests verify parsing and package boundaries. Actual driver behavior,
account ACLs and router installation still require the device checks above.

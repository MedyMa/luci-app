# luci-app-traffic

Per-application traffic statistics for OpenWrt / ImmortalWrt, in the style of a
UniFi gateway: an application name, an icon, and how many bytes went down and
up — measured **on the router**, so it still works for traffic that a proxy
hides from an upstream gateway.

## Why this exists

An upstream device that classifies traffic by DPI (UniFi's application
breakdown, for example) only sees what leaves the router. Once PassWall or
OpenClash is in use, everything is inside an encrypted tunnel to one node, and
every byte collapses into a single `SSL/TLS` bucket. AdGuard Home makes it
worse for DNS-based identification: the clients' queries never leave the box.

The router, by contrast, sits at both ends of the tunnel. It can see
the domain a client resolved, and it can see how many bytes each flow carried.
This package joins those two facts and reports per-application traffic that an
upstream gateway fundamentally cannot.

## How it works

```
conntrack bytes  ─┐
                  ├─► (client, destination IP) ─► domain ─► application
AGH querylog     ─┘
```

1. **Byte counters** come from `/proc/net/nf_conntrack`. Every flow carries
   `packets=`/`bytes=` per direction (`nf_conntrack_acct` is already enabled by
   default in this tree), so the difference between two samples is that flow's
   traffic during the interval. The collector samples every
   `traffic.settings.interval` seconds (default 10).
2. **Domains** come from AdGuard Home's query log, read incrementally. Its
   `Answer` field is a base64 DNS message; `ans.lua` decodes it and yields
   `(client, domain, resolved IP)`.
3. **Attribution** matches a flow's `(source, destination)` against those
   mappings. A flow whose source is the router itself is the proxy tunnel and
   is reported separately, so the traffic it carries is not counted twice.
4. **Names** — every flow gets a name, in this order:
   1. `/etc/traffic/apps.tsv`, matched against the **full host name** first
      (AdGuard Home reports `music.163.com`, so sub-domain rules work) and then
      against the **registrable domain**;
   2. `/etc/traffic/categories.tsv`, longest suffix match — hardware and
      advertising domains then read as `CDN` / `Ads` / `Cloud` instead of a
      meaningless host name;
   3. the registrable domain itself: a website is identified by its domain,
      which is what the reader actually recognises;
   4. failing all of that (no DNS answer at all), a **protocol bucket** derived
      from protocol and port — `SSL/TLS`, `QUIC`, `HTTP`, `DNS`, `STUN`,
      `RTSP`, `Email`, `Other`. That is why an unnamed encrypted flow shows up
      as `SSL/TLS` rather than disappearing into an "unknown" heap.

Flow state lives in `/tmp/traffic`. Once an hour the counters are appended to
`<datadir>/hourly.tsv` and reset, which is the persistent history.

## Installation

```
opkg install luci-app-traffic      # 24.10
apk add luci-app-traffic           # 25.12, when built with CONFIG_USE_APK
```

The collector is enabled by default (`/etc/config/traffic`, `option enabled 1`)
and runs after the network is up. Nothing else needs configuring: the LAN
prefix is detected from the LAN interface and the querylog path from AdGuard
Home's workdir. Both are shown on the page and can be overridden.

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `enabled` | `1` | run the collector |
| `interval` | `10` | seconds between samples (minimum 2) |
| `datadir` | `/etc/traffic` | where `hourly.tsv` (the history) is kept |
| `querylog` | auto | AdGuard Home's `querylog.json` |
| `lan4` / `lan6` | auto | client prefixes; anything else is "the router itself" |
| `appmap` | `/etc/traffic/apps.tsv` | domain → friendly name |
| `retention_days` | `7` | how much hourly history to keep |
| `top_apps` / `top_clients` | `50` / `20` | how many entries the snapshot carries |

Every option can also be set through the environment (`TRAFFIC_INTERVAL`,
`TRAFFIC_QUERYLOG`, …), which is how the offline tests drive it.

## The page

Found under **Network → 流量统计** (`admin/network/traffic`).

The layout follows the Argon theme's card style: translucent blurred panels,
rounded corners, a soft shadow, and the theme's own primary colour as the
accent when it defines one (`var(--primary)`), with bright fallbacks so it also
looks right on the default theme. Dark mode is honoured through the class Argon
sets on `<body>`. Nothing depends on Argon-only class names.

Each application keeps a colour derived from **its own name**, never from its
rank, so the donut, the legend and the table always agree and nothing changes
colour just because the order moved. Two names that hash to the same slot are
separated in name order, which is likewise rank-independent.

* **Hero card** — total carried by clients, live down/up rates derived from two
  consecutive samples, the range selector and the reset button.
* **Donut card** — the ten largest applications with a matching legend.
* **List card** — application, down, up, total and share, 30 rows.
* **Footer card** — proxy tunnel total, client total, and the identification
  rate (by the same client's DNS, by any client's DNS, unidentified).

## Icons

The package ships **84 icons** in two clearly different kinds:

| Kind | Count | Source | Rendered as |
|---|---|---|---|
| Brand logos | 47 | [simple-icons](https://simpleicons.org) (brand colour) and [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) | the product mark |
| Category / protocol glyphs | 37 | [lucide-static](https://lucide.dev) (ISC) | line art in muted grey, plus a `TYPE` tag in the list |

The two kinds are deliberately not interchangeable. A brand logo answers *which
product*, a glyph answers *what kind of traffic* — SSL/TLS, QUIC, HTTP, DNS,
STUN, RTSP, CDN, Cloud, Ads, Email, Search, Social, Video, Software, Other. A
bucket row is drawn with its glyph, an italic muted name and a `TYPE` tag, so it
can never be mistaken for an application.

Brand icons are keyed by the application name: lower-cased with runs of
non-alphanumerics turned into dashes (`YouTube` → `youtube.svg`, `China Mobile`
→ `china-mobile.svg`). The page loads
`/luci-static/resources/traffic/icons/<name>.svg` and keeps its coloured letter
avatar until that file has actually loaded, so a missing icon is invisible
rather than broken. Both the image and the avatar occupy the same 26 px box, so
row rhythm never shifts. 13 of the 62 names in `apps.tsv` have no upstream match
(Tmall, iQIYI, Youku, JD, Didi, Pinduoduo, Toutiao, China Mobile/Telecom/Unicom,
Tencent Cloud, NetEase, NetEase Mail) and keep their avatar — the open sets
carry very little of the Chinese app landscape, so those are best added by hand.

To add or replace an icon, drop an SVG into
`htdocs/luci-static/resources/traffic/icons/` — no code change. To regenerate
the whole set (brand logos and glyphs) after editing `apps.tsv`:

```
pwsh -File tools/fetch-icons.ps1
```

Note that `currentColor` is replaced with an explicit grey when the glyphs are
saved: an SVG loaded through `<img>` does not inherit the page colour, so
`currentColor` would resolve to black and disappear in dark mode.

Icons remain the trademarks of their owners and are used here only to identify
the corresponding service; check the upstream licences before redistributing.

## Limitations — read before trusting the numbers

* **Coverage is not 100%.** Attribution needs a DNS answer. QUIC, ECH,
  hard-coded IPs and applications that resolve through another path show up as
  the destination's registrable name or as `unknown`. The page reports the
  match rate so the coverage is visible rather than implied.
* **Proxied destinations** are attributed from the client's own DNS lookups.
  The flows themselves keep their real destination IP under tproxy, so this
  works, but it is a correlation, not the proxy's own connection table.
* **Long-lived idle connections** keep a domain that was resolved hours
  earlier; a connection that outlives its DNS entry can be attributed to the
  wrong domain. The mapping is refreshed on every lookup.
* **IPv6** addresses are written differently by conntrack and by AdGuard Home
  (leading zeros), so some IPv6 flows will not match even though IPv4 does.
* The hourly history lives on the writable root. Add it to the sysupgrade keep
  list if you want it to survive an upgrade.

## Files

| Path | Purpose |
|---|---|
| `/usr/share/traffic/collector.sh` | sampling, attribution, snapshot |
| `/usr/share/traffic/ans.lua` | base64 DNS answer → A/AAAA records |
| `/etc/init.d/traffic` | procd service for the collector |
| `/usr/libexec/rpcd/luci.traffic` | snapshot, hourly aggregation, reset |
| `/www/luci-static/resources/view/traffic/overview.js` | the page |
| `/etc/config/traffic` | settings |
| `/etc/traffic/apps.tsv` | domain → friendly application name |
| `/etc/traffic/categories.tsv` | domain suffix → category (CDN, Ads, …) |

Not installed, but shipped in the repository for regeneration and verification:

| Path | Purpose |
|---|---|
| `tools/fetch-icons.ps1` | rebuild the icon set from the upstream sets |
| `tools/collector-selftest.sh` | offline regression: every attribution path |

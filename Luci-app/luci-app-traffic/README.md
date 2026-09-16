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
   1. `/etc/traffic/apps.tsv`, matched against the **host name exactly** first
      (AdGuard Home reports `music.163.com`, so sub-domain rules work) and then
      against the **longest matching domain suffix**;
   2. `/etc/traffic/categories.tsv`, longest suffix match — hardware and
      advertising domains then read as `CDN` / `Ads` / `Games` instead of a
      meaningless host name;
   3. the registrable domain itself: a website is identified by its domain,
      which is what the reader actually recognises;
   4. failing all of that (no DNS answer at all), a **protocol bucket** derived
      from protocol and port — `SSL/TLS`, `QUIC`, `HTTP`, `DNS`, `STUN`,
      `RTSP`, `Email`, `Other`. That is why an unnamed encrypted flow shows up
      as `SSL/TLS` rather than disappearing into an "unknown" heap.

   The two catalogues are large (see below), so they are **not** read on every
   poll: a host name is resolved once, when it is first seen, and the answer is
   cached in `/tmp/traffic/namemap.tsv`. The poll path then reads only that
   cache, which is what keeps a 32,000-key catalogue from costing more than the
   accounting itself. Replacing the catalogue (an upgrade) invalidates the
   cache and everything is resolved again in one batch.

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
| `appmap` | `/etc/traffic/apps.tsv` | the application catalogue |
| `retention_days` | `7` | how much hourly history to keep |
| `top_apps` / `top_clients` | `50` / `20` | how many entries the snapshot carries |
| `resolve_interval` | `30` | minimum seconds between catalogue reads (see below) |
| `dnsmap_max` | `50000` | upper bound on the `(client, host, ip)` map |

Every option can also be set through the environment (`TRAFFIC_INTERVAL`,
`TRAFFIC_QUERYLOG`, …), which is how the offline tests drive it.

## The catalogue

`/etc/traffic/apps.tsv` and `/etc/traffic/categories.tsv` are generated, not
hand-written. **1,631 applications** over ~32,000 keys, plus 44 categories:

| File | Rows | What it holds |
|---|---|---|
| `apps.tsv` | 32,015 | `<name>` `<TAB>` `<key>` `<TAB>` `H\|S` — `H` matches the host name exactly, `S` matches it as the longest domain suffix |
| `categories.tsv` | 10,384 | `<Category>` `<TAB>` `<key>` — suffix match only, used when no application claimed the host |

Both are built by `tools/build-catalog.js` from two upstream projects, because
neither is enough alone:

* **[domain-list-community](https://github.com/v2fly/domain-list-community)**
  (MIT) — 1,539 service files, the broadest domain coverage, but its file names
  are slugs (`googlefcm`, `2kgames`) and it composes services with `include:`;
* **[ios_rule_script](https://github.com/blackmatrix7/ios_rule_script)**
  (GPL-2.0) — 666 per-service rule sets whose directory names are already brand
  names (`XiaoHongShu`, `Epic`, `AppStore`, `AppleFirmware`) and which cover the
  game clients, app stores and Apple/macOS services.

```
node tools/build-catalog.js          # re-download, regenerate tables and icons
node tools/build-catalog.js --skip-icons
```

It also copies the icons: **580 brand logos** from
[dashboard-icons](https://github.com/homarr-labs/dashboard-icons),
[Iconify's logos collection](https://iconify.design),
[selfhst/icons](https://github.com/selfhst/icons) and
[simple-icons](https://simpleicons.org), matched by slug and, when that fails,
by prefix or substring so that `Sina` finds `sinaweibo`. The remaining names
keep their letter avatar — a logo is never invented.

Two rules keep the tables readable rather than merely large. Sources that are
*routing bundles* rather than products (`ChinaMax`, `Global`, `Proxy`, the
advertising and privacy blocklists) are excluded outright — the `Privacy`
bundle alone claimed 39,896 keys, over half the catalogue, and would have shown
every tracker as one row. And when two services claim the same key, the smaller
rule set wins, so `play.google.com` reads as *Google Play* rather than *Google*;
a small curated layer fixes the brands whose only upstream owner is a bundle
(`taobao.com` is listed under `alibaba` and nowhere else).

## Cost on the router, and on the page

The tables are large and the page polls while it is open, so both ends are
built to do nothing when nothing changed.

**On the router**, one poll (measured at 2,000 conntrack flows, 5,000 resolved
host names, 400 applications):

| Stage | Cost | Note |
|---|---|---|
| `poll_ct` | dominant | parsing `/proc/net/nf_conntrack` is the floor; it is what the accounting *is* |
| `classify` | small | reads the cached name map, not the catalogue |
| `write_summary` | small | the heaviest N are selected inside awk, so no `sort`/`head` pipeline is spawned |
| `resolve_names` | rare | reads the 786 KB catalogue only for host names never seen before |

The catalogue is the one genuinely large thing, and it is read **once per new
host name**, never per poll. Host names it has seen wait out `resolve_interval`
(30 s) before a second look — except while the page is open, when the page calls
`resolveNow` and the collector drops the wait, so a name that just appeared is
resolved within a poll. Nobody watching, no cost.

**On the page**, the DOM is updated rather than rebuilt. A refresh reuses the
row it already has for each application and only writes the cells whose text
actually changed. Measured over a 100-row table, second refresh:

| | rebuild (before) | reuse (now) |
|---|---|---|
| nodes created, data unchanged | 1,060 | **0** |
| nodes created, every byte changed | 1,060 | **0** |
| nodes created, values *and* order changed | 1,060 | 52 |
| `Image` objects created | 100 | **0** |
| `L.resource()` calls | 100 | **0** |

The icon count is the one that matters for memory: an `<img>` per row per
refresh means the browser decodes the same 100 SVGs again every five seconds.
Now each icon is created once, when its row first appears, and kept.

Two cheap gates sit in front of that. A refresh whose snapshot has not advanced
(the collector writes every 10 s, the page polls every 5 s) returns before
touching the DOM, and a hidden tab skips the fetch entirely until it is shown
again.

**On the RPC path**, `getSummary` hands the snapshot file straight to the caller
instead of parsing it with jshn and serialising it again. The collector writes
it write-to-temp-then-rename, so a reader never sees a partial file, and the
round trip was only ever validating a file this package wrote itself.

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
* **Throughput card** — down/up over time, drawn as plain SVG. The collector
  keeps two tiers, so the card's buttons choose a *granularity*, not a window
  width: **10 s points for the last hour** (the sharp view — a burst keeps its
  shape) and **1 min points for the last day** (the context view). The minute
  tier lives in `<datadir>/series60.tsv` so it survives a reboot; the 10 s tier
  is session state in `/tmp`. A quiet round is recorded as a zero point rather
  than skipped, so a gap in the chart always means the collector was not
  running, never merely "nothing happened".
* **Donut card** — the ten largest applications with a matching legend.
* **List card** — application, down, up, total and share, 30 rows.
* **Footer card** — proxy tunnel total, client total, and the identification
  rate (by the same client's DNS, by any client's DNS, unidentified).

## Icons

The package ships **649 icons** in two clearly different kinds:

| Kind | Count | Source | Rendered as |
|---|---|---|---|
| Brand logos | 580 | [dashboard-icons](https://github.com/homarr-labs/dashboard-icons), [Iconify logos](https://iconify.design), [selfhst/icons](https://github.com/selfhst/icons) and [simple-icons](https://simpleicons.org) | the product mark |
| Category / protocol glyphs | 69 | [lucide-static](https://lucide.dev) (ISC) | line art in muted grey, plus a `TYPE` tag in the list |

The two kinds are deliberately not interchangeable. A brand logo answers *which
product*, a glyph answers *what kind of traffic* — SSL/TLS, QUIC, HTTP, DNS,
STUN, RTSP, CDN, Media, Games, Ads, Tracker, IPTV… A bucket row is drawn with
its glyph, an italic muted name and a `TYPE` tag, so it can never be mistaken
for an application.

Brand icons are keyed by the application name: lower-cased with runs of
non-alphanumerics turned into dashes (`YouTube` → `youtube.svg`, `China Mobile`
→ `china-mobile.svg`). The page loads
`/luci-static/resources/traffic/icons/<name>.svg` and keeps its coloured letter
avatar until that file has actually loaded, so a missing icon is invisible
rather than broken. Both the image and the avatar occupy the same 26 px box, so
row rhythm never shifts.

**580 of 1,631 names** have an upstream logo — 64 of the 100 that carry the most
domains. The rest keep their avatar; the open sets carry comparatively little of
the Chinese app landscape and no logo is invented for a name that none of them
knows. To add one by hand, drop an SVG into
`htdocs/luci-static/resources/traffic/icons/` — no code change.

Note that `currentColor` is replaced with an explicit grey when a glyph is
saved, and a monochrome brand mark is pinned to the same grey: an SVG loaded
through `<img>` does not inherit the page colour, so `currentColor` would
resolve to black and disappear in dark mode.

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
| `/etc/traffic/apps.tsv` | application catalogue (`name`, `key`, `H\|S`) |
| `/etc/traffic/categories.tsv` | domain suffix → category (CDN, Games, Ads, …) |
| `/etc/traffic/hourly.tsv` | per-hour history (the persistent totals) |
| `/etc/traffic/series60.tsv` | 1-minute throughput for the last 24 h |
| `/tmp/traffic/series10.tsv` | 10-second throughput for the last hour |
| `/tmp/traffic/namemap.tsv` | host name → resolved name (the catalogue cache) |

Not installed, but shipped in the repository for regeneration and verification:

| Path | Purpose |
|---|---|
| `tools/build-catalog.js` | rebuild both catalogues and the icon set from upstream |
| `tools/collector-selftest.sh` | offline regression: every attribution path |

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
   is reported separately, so the traffic it carries is not counted twice. "The
   router itself" means two things: a source outside the LAN prefixes (the far
   end of a tunnel), and a source that *is* one of the box's own LAN addresses
   (`self`, auto-detected on the LAN interface, v4 and v6). The second case
   matters on a box that runs its own proxy: those connections are sourced from
   the LAN address, and counting them as a client put `192.168.2.1` at the top
   of the client list with 39 MB against it.
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

5. **Per-host counters** (the `accounting` option, on by default). Everything
   above is conntrack and DNS, which cannot be the whole story: a conntrack
   entry can be missed when the table is full, `nf_conntrack_acct` can be off,
   and a domain resolved by the proxy rather than locally leaves no DNS answer
   to name the flow with. So the client **totals** come from a byte counter per
   host, created in a small nftables table of its own (`inet traffic_acct`):

   | direction | hook | match |
   |---|---|---|
   | upload | `prerouting`, priority `raw` | `iifname <lan> ip saddr <client>` |
   | download | `postrouting`, priority `101` | `oifname <lan> ip daddr <client>` |

   Upload is matched by source and download by destination, and no packet
   matches both, so a directly routed download is not counted twice. Filtering
   on the LAN interface is what keeps the proxy's own sockets out of it, since
   those leave by the WAN device.

   This is the idea behind **wrtbwmon** — account per host with firewall
   counters rather than with conntrack — but deliberately **not** its hook
   choice. wrtbwmon counts in the `FORWARD` chain.
   That cannot work here: passwall's own nft table has only `prerouting` and
   `output` base chains, and every proxied connection ends in `tproxy to :port`
   or `redirect to :port`, both of which hand the connection to a local socket.
   Proxied client traffic therefore goes `PREROUTING → INPUT` and never reaches
   `FORWARD` — and AdGuard Home's DNS redirect leaves `PREROUTING` the same way.
   A `FORWARD` counter would miss exactly the bulk it was added to measure.
   (`wrtbwmon`'s `readDB.awk` is also gawk-only: it dispatches on `ARGIND`,
   which busybox `awk` does not have, so on this target it would silently do
   nothing at all.)

   The download hook must be `postrouting` and not `prerouting` for the same
   reason: the download half of a proxied connection is produced by a local
   socket and leaves through `OUTPUT`, so it never appears in `prerouting`.

   The counters are the client totals; the application breakdown stays
   conntrack-based, and the page reports both, so the share of traffic that
   could not be attributed is visible instead of hidden. With no `nft`
   installed, or with `accounting` set to `0`, the client totals fall back to
   conntrack and the page says so.

   **Flow offloading defeats any netfilter counter**, this one included: an
   offloaded flow stops traversing the hooks after its first packets. For exact
   totals, leave `option flow_offloading` off in `/etc/config/firewall`.

### Where the names come from, and where they cannot

Naming a flow needs a `(client, domain, resolved IP)` triple. On this kind of
router the client query does not necessarily reach AdGuard Home, because
passwall reshapes DNS:

* passwall's `helper_dnsmasq.lua` **stretches** the system dnsmasq — it takes
  over `dhcp.@dnsmasq[0].server` and installs its own conf-dir — so the client
  talks to dnsmasq and dnsmasq decides which domains go where;
* passwall's default `dns_shunt` is `chinadns-ng`, and its default
  `dns_redirect` is `1`, so proxied domains are answered by passwall itself;
* AdGuard Home's default redirect mode is literally `dnsmasq-upstream`: it sits
  *behind* dnsmasq, not in front of the clients.

Two consequences, both visible on a real router as a large unattributed share:

1. **A proxied domain is answered by passwall, so AdGuard never sees the query.**
   Its log cannot name that flow, and no local DNS answer exists to match the
   flow destination against.
2. **For the queries AdGuard does see, the client field is dnsmasq
   (`127.0.0.1`), not the device**, so an exact client-to-name match is
   impossible and the flow can only be named through the "any client resolved
   this address" path — or not at all.

The `dnsmasq_log` option closes both gaps where a log file exists, because
dnsmasq's own query log carries the real client address *and* the domains that
never reach AdGuard:

```
uci set dhcp.@dnsmasq[0].logqueries='1'
uci set dhcp.@dnsmasq[0].logfacility='/tmp/dnsmasq.log'
uci commit dhcp && /etc/init.d/dnsmasq restart
```

Reading that file is off unless it exists; `traffic.settings.dnsmasq_log` can
also point at it explicitly. It is read incrementally, and a query and its
answer are paired by name (the answer line carries no client), so two devices
asking for the same name at the same moment can be attributed to the wrong one —
rare, and still better than no name.

What remains unnameable by design: a domain the **proxy node resolves
remotely**. Nothing on the router ever sees that answer, so no counter, log or
catalogue here can name it; such flows stay in the protocol bucket. Naming them
needs the proxy's own logs, which is a different integration.

Flow state lives in `/tmp/traffic`. Once an hour the traffic of that hour is
appended to `<datadir>/hourly.tsv`, which is the persistent history. The live
counters are **not** reset by that: the page shows the session, and a session
that fell back to zero at the top of every hour read as traffic going missing.
The hour is worked out as the difference between the live counters and a
snapshot taken at the previous roll (in `/tmp/traffic/arch`), so each row in the
history still holds exactly one hour.

## Installation

```
opkg install luci-app-traffic      # 24.10
apk add luci-app-traffic           # 25.12, when built with CONFIG_USE_APK
```

The collector is enabled by default (`/etc/config/traffic`, `option enabled 1`)
and runs after the network is up. Nothing else needs configuring: the LAN
prefix is detected from the LAN interface and the querylog path from AdGuard
Home's workdir. Both are shown on the page and can be overridden.

## Versioning

**Every change bumps `PKG_VERSION` by one patch level and resets `PKG_RELEASE`
to 1.** The version is substituted into the collector at build time and the page
shows it in the status strip, so the build that is actually running can be told
from the one that was installed. Without this, two different collectors look
identical after installation and opkg does not even treat the second as an
upgrade.

## Configuration
| Option | Default | Meaning |
|---|---|---|
| `enabled` | `1` | run the collector |
| `interval` | `10` | seconds between samples (minimum 2) |
| `datadir` | `/etc/traffic` | where `hourly.tsv` (the history) is kept |
| `querylog` | auto | AdGuard Home's `querylog.json` |
| `dnsmasq_log` | auto | dnsmasq's query log, a second name source (see below) |
| `lan4` / `lan6` | auto | client prefixes; anything else is "the router itself" |
| `self` | auto | the box's own LAN addresses (space-separated); their flows are tunnel traffic, not a client |
| `accounting` | `1` | per-host nftables counters for the client totals; `0` falls back to conntrack alone |
| `appmap` | `/etc/traffic/apps.tsv` | the application catalogue |
| `retention_days` | `7` | how much hourly history to keep |
| `top_apps` / `top_clients` | `50` / `20` | how many entries the snapshot carries |
| `resolve_interval` | `30` | minimum seconds between catalogue reads (see below) |
| `dnsmap_max` | `50000` | upper bound on the `(client, host, ip)` map |
| `purge_size_mb` | `100` | history is dropped when the data directory passes this size (see below) |

Every option can also be set through the environment (`TRAFFIC_INTERVAL`,
`TRAFFIC_QUERYLOG`, …), which is how the offline tests drive it.

### The history is bounded by the collector, not by a button

There is deliberately no "clear" button on the page. Clearing is housekeeping,
and a button on a dashboard is an invitation to throw the history away by
accident; it also cannot be undone, which is a poor fit for a single click next
to the numbers.

The collector bounds its own store instead:

* once a **calendar month**, on the first start of a new month;
* whenever `<datadir>` grows past **`purge_size_mb`** (100 MB by default).

`hourly.tsv` is the file that actually grows without bound — an application row
and a client row per application and client, per hour, kept forever. The two
series files are already bounded by their point counts, and the name maps live
in tmpfs and are bounded by `dnsmap_max`; they are cleared too, because they are
what the purge is meant to reclaim.

**Only history is dropped.** The live counters are the session in progress, and
clearing them would make the page fall back to zero for traffic that is still on
the wire — the opposite of what the page is for. Each purge writes one line to
the log (`logread -e traffic`).

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

It also copies the icons: **662 brand logos** from
[dashboard-icons](https://github.com/homarr-labs/dashboard-icons),
[Iconify's logos collection](https://iconify.design),
[selfhst/icons](https://github.com/selfhst/icons) and
[simple-icons](https://simpleicons.org), matched by slug and, when that fails,
by prefix or substring so that `Sina` finds `sinaweibo`. Anything still missing
gets one more attempt through [Iconify's search
API](https://iconify.design/docs/api/search.html), accepted only when the icon it
returns actually names the application. The remaining names keep their letter
avatar — a logo is never invented.

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

**The donut and the chart are built with `createElementNS`.** LuCI's `E()` ends
up in `document.createElement()`, which never produces an SVG element — a chart
built that way is created without complaint, passes every syntax check, and then
renders as nothing at all. `tools/page-render-selftest.js` drives the real
`draw()`/`drawSeries()`/`drawStatus()` with a stub DOM that records namespaces
and asserts what actually landed in the tree, which is the only way this class
of bug shows up off-device.

**A status strip explains the state of the collector** — running or not, how old
the snapshot is, the interval, how many conntrack entries and host names it has,
how many names are waiting to be resolved, which layer produced the client
totals and which collector build is running. Each reading is its own soft grey
chip, so a label and its value read as one item instead of a long row where the
eye has to work out which caption belongs to which number. An empty page is
otherwise a dead end: "no traffic yet", "the service is not running" and "the
counters are not available" all look identical. The query log path is not shown:
it is a configuration detail the page acts on, not something a reader can use,
and it crowded out the readings that do say what is wrong.

**On the RPC path**, `getSummary` hands the snapshot file straight to the caller
instead of parsing it with jshn and serialising it again. The collector writes
it write-to-temp-then-rename, so a reader never sees a partial file, and the
round trip was only ever validating a file this package wrote itself.

## The page

Found under **Services → 流量统计** (`admin/services/traffic`).

The layout follows the Argon theme's card style: translucent blurred panels,
rounded corners, a soft shadow, and the theme's own primary colour as the
accent when it defines one (`var(--primary)`), with bright fallbacks so it also
looks right on the default theme. Dark mode is honoured through the class Argon
sets on `<body>`. Nothing depends on Argon-only class names.

Each application keeps a colour derived from **its own name**, never from its
rank, so the donut, the legend and the table always agree and nothing changes
colour just because the order moved. Two names that hash to the same slot are
separated in name order, which is likewise rank-independent.

* **Hero card** — total carried by clients, down/up rates, and the range
  selector. The range defaults to **one day**, which is the window the total, the
  donut, the table and the chart all describe. In "since start" the two rates are
  the live ones, derived from two consecutive samples; over a range they are the
  averages for that range, which is what a rate means once there is a window to
  divide by — the tooltip says so, because a dash in that position read as "no
  traffic" instead of "measured differently here". There is no reset button (see
  [above](#the-history-is-bounded-by-the-collector-not-by-a-button)).
* **Throughput card** — down/up over time, drawn as plain SVG. Its tier is not a
  second choice: the curve is the selected range at a coarser granularity, so the
  page carries **one** range control instead of two that could be set to
  disagree. The page opens on the day tier, and "since start" — which is not a
  window at all — keeps it, so the curve does not shrink to an hour when the
  table is switched to the session. **10 s points for the last hour** (the sharp view — a burst keeps its
  shape), **1 min points for 12 h and for the last day** (the same file, two
  lengths), and **1 h points for the last week**. The minute
  and hour tiers live in `<datadir>` (`series60.tsv`, `series1h.tsv`) so they
  survive a reboot; the 10 s tier is session state in `/tmp`. A quiet round is
  recorded as a zero point rather than skipped, so a gap in the chart always means
  the collector was not running, never merely "nothing happened". A colour key
  names the two curves under the header, because they often differ by orders of
  magnitude and a small upload curve would otherwise read as a stray line.
* **Donut card** — the ten largest applications with a matching legend, as a
  full-width block above the table. It used to be a second column beside the
  table, which stacked below the tablet breakpoint anyway and left a band of
  empty page beside the donut; as a block above, the legend can spread across the
  width instead of being squeezed into one narrow column.
* **List card** — application, total and share, received, sent, busiest client,
  device count; 100 rows kept in the DOM, so a page left open all day does not
  grow. The column widths live in a `<colgroup>`: under `table-layout:fixed` those
  are the widths the browser actually uses, and a percentage on the cells could be
  overridden by the theme, which collapsed the name column to its own ellipsis
  while the byte columns — the widest of which holds "528 KiB (32.4%)" — took the
  rest of the card. The name now takes whatever the icon and the `TYPE` tag leave,
  the tag never wraps into two stacked characters, the row backgrounds are set
  explicitly so the theme's stripes cannot show through the tinted total row, and
  each column's caption is aligned with its own data — the theme centres every
  cell, which left "总量" in the middle of its column while the figure under it
  hugged the right edge. Numbers are centred, the two text columns are left
  aligned, and every cell carries the same padding.
  Below the tablet width the list scrolls sideways rather than squeezing the names;
  on a phone the busiest-client and device-count columns drop out.
* **Footer card** — proxy tunnel total, client total, and the identification
  rate (by the same client's DNS, by any client's DNS, unidentified).

Column and caption strings are spelled out on purpose ("Application name",
"Total traffic", "Received"): the one-word msgids (`Application`, `Total`,
`Down`, `Up`, `Clients`) are translated by luci-base itself and its text wins at
runtime, so `Application` came out as *应用层* — a firewall term, not a label for
a list of apps.

## Icons

The package ships **731 icons** in two clearly different kinds:

| Kind | Count | Source | Rendered as |
|---|---|---|---|
| Brand logos | 662 | [dashboard-icons](https://github.com/homarr-labs/dashboard-icons), [Iconify logos](https://iconify.design), [selfhst/icons](https://github.com/selfhst/icons) and [simple-icons](https://simpleicons.org) | the product mark |
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

**644 of 1,631 names** have an upstream logo — 64 of the 100 that carry the most
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
| `/tmp/traffic/version` | state schema; a change rebuilds the live counters (see below) |

The live counters in `/tmp/traffic` are running totals, so a change in what they
mean cannot be applied to numbers already accumulated. `version` records the
schema they were built with: when it does not match the collector, the client,
application, router and attribution counters are dropped and rebuilt on the next
sample. The history in `<datadir>` (`hourly.tsv`, `series60.tsv`) and the
conntrack baseline (`flow.state`) are left alone, so the change costs the
session's totals, not the day's chart.

Not installed, but shipped in the repository for regeneration and verification:

| Path | Purpose |
|---|---|
| `tools/build-catalog.js` | rebuild both catalogues and the icon set from upstream |
| `tools/collector-selftest.sh` | offline regression: every attribution path, the box's own addresses, the state schema |
| `tools/page-render-selftest.js` | offline rendering check (SVG namespace, chart, status strip) |

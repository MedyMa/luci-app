#!/bin/sh
# collector.sh - per-application traffic accounting for luci-app-traffic.
#
# How the numbers are produced
# ---------------------------
#   1. /proc/net/nf_conntrack is sampled every <interval> seconds.  Every flow
#      carries packets=/bytes= per direction (nf_conntrack_acct is on by
#      default in this target tree), so the difference between two samples is
#      the traffic of that flow in that interval.
#   2. AdGuard Home's querylog is read incrementally.  Its base64 Answer field
#      is decoded by ans.lua, which yields (client, domain, resolved IP).
#      That is what turns a bare destination IP into a name.
#   3. The two catalogues (apps.tsv, categories.tsv) are large - a couple of
#      thousand applications over ~80k keys.  Reading them on every poll would
#      cost more than the accounting itself, so they are read ONLY when a host
#      name is seen for the first time: the answer is cached in
#      $STATE_DIR/namemap.tsv and the per-poll path reads just that cache.
#      A catalogue that changed under us (package upgrade) invalidates the
#      cache and every known host name is resolved again in one batch.
#   4. A flow is then given a name, in this order:
#        a. the host name itself, exactly, in the application table (DOMAIN and
#           full:host rules) - this is what separates music.163.com from 163.com;
#        b. the longest matching suffix in the application table (DOMAIN-SUFFIX
#           rules and bare domains) - note this handles multi-label suffixes
#           like co.uk without needing a public-suffix list;
#        c. the longest matching suffix in the category table (categories.tsv),
#           so infrastructure reads as CDN / Ads / Cloud rather than as a
#           meaningless host name;
#        d. the registrable domain itself - a website is identified by its
#           domain, which is what the reader actually recognises;
#        e. failing all of that (no DNS answer at all), a protocol bucket
#           derived from protocol and port: SSL/TLS, QUIC, HTTP, DNS, STUN,
#           RTSP, Email, Other.  This is why an unnamed encrypted flow shows
#           up as "SSL/TLS" instead of disappearing into an "unknown" heap.
#      A flow whose source is the router itself is the proxy tunnel and is
#      accounted separately, so it never doubles the client traffic it carries.
#
# State lives in /tmp/traffic (RAM).  Once an hour the session totals are
# appended to <datadir>/hourly.tsv and reset, which is the persistent history.
#
# The one thing this does change outside its own state is a pair of nftables
# counting chains of its own (table inet traffic_acct), used for the per-host
# byte counters.  It touches no firewall, DNS or proxy configuration: the chains
# only count, and they are removed when the service stops.  Set
# traffic.settings.accounting to 0 to leave the firewall alone entirely, in
# which case the client totals come from conntrack as they did before.

set -u

STATE_DIR=${STATE_DIR:-/tmp/traffic}
SELF_DIR=${SELF_DIR:-/usr/share/traffic}
CT=${CT:-/proc/net/nf_conntrack}
LUA=${LUA:-/usr/bin/lua}
UCI=${UCI:-/usr/bin/uci}

CFG_ENABLED=1
CFG_INTERVAL=10
CFG_DATADIR=/etc/traffic
CFG_QUERYLOG=
CFG_LAN4=
CFG_LAN6=
# the router's own LAN addresses, space separated; a source matching one of
# these is the router, not a client
CFG_SELF=
# per-host byte counters in nftables, on top of the conntrack accounting: they
# do not depend on nf_conntrack_acct or on the connection table having room, and
# they are what makes the client totals authoritative
CFG_ACCT=1
# set once per round by account_clients(): 1 when the nft counters are running
# and own the client totals, 0 when the conntrack totals stand in for them
ACCT_ON=0
CFG_APPMAP=$CFG_DATADIR/apps.tsv
CFG_CATEGORIES=$CFG_DATADIR/categories.tsv
CFG_RETENTION=7
CFG_TOP_APPS=50
CFG_TOP_CLIENTS=20
# Minimum seconds between catalogue reads.  Fresh host names keep arriving while
# someone browses, and re-reading an 80k-key catalogue for every one of them
# would cost more than the accounting itself; inside this window they simply
# wait, and until then they show as their registrable domain.  A large batch
# (first run, or a burst) is resolved immediately.
CFG_RESOLVE=30
# Upper bound on the (client, host, ip) map; older entries are dropped once an
# hour.  Names already resolved are kept separately, so this only bounds memory.
CFG_DNSMAP_MAX=50000
# Two-tier throughput history: a sharp recent window and a coarse long one.
# 10 s / 1 h keeps the shape of a burst, 1 min / 24 h gives the day's context;
# the point counts follow from these and the sampling interval.
CFG_SERIES_HOT=3600
CFG_SERIES_COLD=86400
SERIES10_MAX=360
SERIES60_MAX=1440

# Bumped whenever a change alters what the live counters mean.  They are running
# totals, so a change of meaning cannot be applied retroactively: after the fix
# that stopped the box's own LAN address from being a client, an upgraded router
# would otherwise keep showing "192.168.2.1" with tens of megabytes against it
# forever, because that row is already in clients.tsv and is only ever added to.
# On a mismatch the live counters are dropped and rebuilt; the history in
# <datadir> (series60, hourly) is left alone.
STATE_VERSION=1

log() { logger -t traffic "$*"; }

# ---------------------------------------------------------------- configuration
# Environment wins over uci, so the collector can be exercised offline (tests)
# and overridden in the field without touching the config file.
uci_get() {
    local key="$1" v=

    case "$key" in
        enabled)        v=${TRAFFIC_ENABLED:-} ;;
        interval)       v=${TRAFFIC_INTERVAL:-} ;;
        datadir)        v=${TRAFFIC_DATADIR:-} ;;
        querylog)       v=${TRAFFIC_QUERYLOG:-} ;;
        lan4)           v=${TRAFFIC_LAN4:-} ;;
        lan6)           v=${TRAFFIC_LAN6:-} ;;
        self)           v=${TRAFFIC_SELF:-} ;;
        accounting)     v=${TRAFFIC_ACCOUNTING:-} ;;
        appmap)         v=${TRAFFIC_APPMAP:-} ;;
        categories)     v=${TRAFFIC_CATEGORIES:-} ;;
        retention_days) v=${TRAFFIC_RETENTION_DAYS:-} ;;
        top_apps)       v=${TRAFFIC_TOP_APPS:-} ;;
        top_clients)    v=${TRAFFIC_TOP_CLIENTS:-} ;;
        resolve_interval) v=${TRAFFIC_RESOLVE:-} ;;
        dnsmap_max)     v=${TRAFFIC_DNSMAP_MAX:-} ;;
    esac
    if [ -n "$v" ]; then printf '%s\n' "$v"; return 0; fi

    [ -x "$UCI" ] && "$UCI" -q get "traffic.settings.$key" 2>/dev/null
}

detect_lan() {
    # Prefer the LAN address the box actually has, so a user who renumbered
    # their network does not have to configure anything.
    local ip br
    br=$(uci -q get network.lan.device 2>/dev/null)
    [ -n "$br" ] || br=br-lan
    ip=$(ip -4 addr show dev "$br" 2>/dev/null | awk '/inet /{print $2; exit}')
    if [ -n "$ip" ]; then
        ip=${ip%/*}
        printf '%s.\n' "${ip%.*}"
        return
    fi
    printf '192.168.1.\n'
}

detect_lan6() {
    local ip br
    br=$(uci -q get network.lan.device 2>/dev/null)
    [ -n "$br" ] || br=br-lan
    ip=$(ip -6 addr show dev "$br" scope global 2>/dev/null | awk '/inet6 /{print $2; exit}')
    [ -n "$ip" ] || ip=$(ip -6 addr show dev "$br" 2>/dev/null | awk '/inet6 /{print $2; exit}')
    if [ -n "$ip" ]; then
        # first 3 hextets are enough to recognise the prefix
        echo "$ip" | awk -F: '{printf "%s:%s:%s:\n", $1, $2, $3}'
        return
    fi
    printf 'fd00::\n'
}

# Expand an IPv6 address to the eight-group form the kernel writes into
# /proc/net/nf_conntrack.  "ip -6 addr" prints the compressed form, so a plain
# string comparison against a conntrack address would never match.
expand6() {
    awk -v a="$1" '
    function pad(s) { while (length(s) < 4) s = "0" s; return s }
    BEGIN {
        if (a == "") { print ""; exit }
        if (a !~ /:/) { print a; exit }              # not IPv6
        n = split(a, half, "::")
        if (n == 1) {
            m = split(a, g, ":")
            out = ""
            for (i = 1; i <= m; i++) out = out (i > 1 ? ":" : "") pad(g[i])
            print out
            exit
        }
        nl = (half[1] == "") ? 0 : split(half[1], L, ":")
        nr = (half[2] == "") ? 0 : split(half[2], R, ":")
        out = ""
        for (i = 1; i <= nl; i++) out = out (out == "" ? "" : ":") pad(L[i])
        for (i = nl + 1; i <= 8 - nr; i++) out = out (out == "" ? "" : ":") "0000"
        for (i = 1; i <= nr; i++) out = out ":" pad(R[i])
        print out
    }'
}

# The addresses of the router itself on the LAN.  Traffic whose source is one of
# these is the router talking, not a client: on a box that runs its own proxy it
# is the outbound connections of that proxy, and counting them as a client put
# "192.168.2.1" at the top of the client list with 40 MB against it.
detect_self() {
    local br a
    br=$($UCI -q get network.lan.device 2>/dev/null)
    [ -n "$br" ] || br=br-lan
    ip -4 addr show dev "$br" 2>/dev/null | awk '/inet /{ sub(/\/.*/, "", $2); print $2 }'
    ip -6 addr show dev "$br" 2>/dev/null | awk '/inet6 /{ sub(/\/.*/, "", $2); print $2 }' \
        | while read -r a; do expand6 "$a"; done
}

detect_querylog() {    local wl
    wl=$($UCI -q get AdGuardHome.AdGuardHome.workdir 2>/dev/null)
    if [ -n "$wl" ] && [ -r "$wl/data/querylog.json" ]; then
        printf '%s/data/querylog.json\n' "$wl"
        return
    fi
    for wl in /etc/config/adGuardConfig/workspace /etc/AdGuardHome /var/lib/AdGuardHome; do
        [ -r "$wl/data/querylog.json" ] && { printf '%s/data/querylog.json\n' "$wl"; return; }
    done
    printf '/etc/config/adGuardConfig/workspace/data/querylog.json\n'
}

load_config() {
    local v
    v=$(uci_get enabled);      [ -n "$v" ] && CFG_ENABLED=$v
    v=$(uci_get interval);     [ -n "$v" ] && CFG_INTERVAL=$v
    v=$(uci_get datadir);      [ -n "$v" ] && CFG_DATADIR=$v
    v=$(uci_get querylog);     [ -n "$v" ] && CFG_QUERYLOG=$v
    [ -n "$CFG_QUERYLOG" ] || CFG_QUERYLOG=$(detect_querylog)
    v=$(uci_get lan4);         [ -n "$v" ] && CFG_LAN4=$v
    [ -n "$CFG_LAN4" ] || CFG_LAN4=$(detect_lan)
    v=$(uci_get lan6);         [ -n "$v" ] && CFG_LAN6=$v
    [ -n "$CFG_LAN6" ] || CFG_LAN6=$(detect_lan6)
    v=$(uci_get self);         [ -n "$v" ] && CFG_SELF=$v
    v=$(uci_get accounting);   [ -n "$v" ] && CFG_ACCT=$v
    [ -n "$CFG_SELF" ] || CFG_SELF=$(detect_self | tr '\n' ' ')
    v=$(uci_get appmap);       [ -n "$v" ] && CFG_APPMAP=$v
    [ -n "$CFG_APPMAP" ] || CFG_APPMAP=$CFG_DATADIR/apps.tsv
    # the category table sits next to the application table, so relocating one
    # relocates the other
    v=$(uci_get categories);   [ -n "$v" ] && CFG_CATEGORIES=$v
    [ -n "$CFG_CATEGORIES" ] || CFG_CATEGORIES="${CFG_APPMAP%/*}/categories.tsv"
    v=$(uci_get retention_days); [ -n "$v" ] && CFG_RETENTION=$v
    v=$(uci_get top_apps);       [ -n "$v" ] && CFG_TOP_APPS=$v
    v=$(uci_get top_clients);    [ -n "$v" ] && CFG_TOP_CLIENTS=$v
    v=$(uci_get resolve_interval); [ -n "$v" ] && CFG_RESOLVE=$v
    v=$(uci_get dnsmap_max);     [ -n "$v" ] && CFG_DNSMAP_MAX=$v

    # sanity
    case "$CFG_INTERVAL" in ''|*[!0-9]*) CFG_INTERVAL=10 ;; esac
    [ "$CFG_INTERVAL" -lt 2 ] && CFG_INTERVAL=2
    case "$CFG_RETENTION" in ''|*[!0-9]*) CFG_RETENTION=7 ;; esac
    case "$CFG_TOP_APPS" in ''|*[!0-9]*) CFG_TOP_APPS=50 ;; esac
    case "$CFG_TOP_CLIENTS" in ''|*[!0-9]*) CFG_TOP_CLIENTS=20 ;; esac
    case "$CFG_RESOLVE" in ''|*[!0-9]*) CFG_RESOLVE=30 ;; esac
    case "$CFG_DNSMAP_MAX" in ''|*[!0-9]*) CFG_DNSMAP_MAX=50000 ;; esac
    # how many samples each tier keeps, from the configured interval
    case "${TRAFFIC_SERIES_HOT:-}" in ''|*[!0-9]*) ;; *) CFG_SERIES_HOT=$TRAFFIC_SERIES_HOT ;; esac
    case "${TRAFFIC_SERIES_COLD:-}" in ''|*[!0-9]*) ;; *) CFG_SERIES_COLD=$TRAFFIC_SERIES_COLD ;; esac
    SERIES10_MAX=$((CFG_SERIES_HOT / CFG_INTERVAL))
    [ "$SERIES10_MAX" -lt 2 ] && SERIES10_MAX=2
    SERIES60_MAX=$((CFG_SERIES_COLD / 60))
    [ "$SERIES60_MAX" -lt 2 ] && SERIES60_MAX=2
}

# ---------------------------------------------------------------- state
init_state() {
    local v
    mkdir -p "$STATE_DIR" "$CFG_DATADIR" || exit 1
    v=$(sed -n '1p' "$STATE_DIR/version" 2>/dev/null)
    if [ "$v" != "$STATE_VERSION" ]; then
        # The live counters are running totals, so a change in what they mean
        # cannot be applied to the existing numbers - they have to be rebuilt.
        # flow.state is kept on purpose: it is the conntrack baseline the next
        # delta is measured against, and clearing it would count every open
        # flow from zero once.
        rm -f "$STATE_DIR/totals.tsv" "$STATE_DIR/clients.tsv" "$STATE_DIR/router.tsv" \
              "$STATE_DIR/stat.tsv" "$STATE_DIR/ac.tsv" \
              "$STATE_DIR/acct.tsv" "$STATE_DIR/acct.abs" "$STATE_DIR/acct.hosts"
        printf '%s\n' "$STATE_VERSION" > "$STATE_DIR/version"
        [ -n "$v" ] && log "state schema $v -> $STATE_VERSION: live counters reset"
    fi
    [ -f "$STATE_DIR/flow.state" ] || : > "$STATE_DIR/flow.state"
    [ -f "$STATE_DIR/dnsmap.tsv" ] || : > "$STATE_DIR/dnsmap.tsv"
    [ -f "$STATE_DIR/totals.tsv" ] || : > "$STATE_DIR/totals.tsv"
    [ -f "$STATE_DIR/clients.tsv" ] || : > "$STATE_DIR/clients.tsv"
    [ -f "$STATE_DIR/router.tsv" ] || : > "$STATE_DIR/router.tsv"
    [ -f "$STATE_DIR/stat.tsv" ] || printf '0\n0\n0\n0\n' > "$STATE_DIR/stat.tsv"
    [ -f "$STATE_DIR/ac.tsv" ] || : > "$STATE_DIR/ac.tsv"
    [ -f "$STATE_DIR/namemap.tsv" ] || : > "$STATE_DIR/namemap.tsv"
    [ -f "$STATE_DIR/series10.tsv" ] || : > "$STATE_DIR/series10.tsv"
    [ -f "$STATE_DIR/minute.tsv" ] || printf '0\n0\n0\n' > "$STATE_DIR/minute.tsv"
    [ -f "$CFG_DATADIR/series60.tsv" ] || : > "$CFG_DATADIR/series60.tsv"
    [ -f "$STATE_DIR/meta" ] || printf '0\n0\n' > "$STATE_DIR/meta"
    [ -f "$STATE_DIR/nmoff" ] || printf '0\n' > "$STATE_DIR/nmoff"
    [ -f "$STATE_DIR/nmtime" ] || printf '0\n' > "$STATE_DIR/nmtime"
    [ -f "$STATE_DIR/pending" ] || printf '0\n' > "$STATE_DIR/pending"
    # the current hour bucket, written here so the page can always say which one
    # it is showing (roll_hour rewrites it when the hour turns over)
    [ -f "$STATE_DIR/hour" ] || date +%Y-%m-%dT%H > "$STATE_DIR/hour" 2>/dev/null
    [ -f "$CFG_DATADIR/hourly.tsv" ] || : > "$CFG_DATADIR/hourly.tsv"
}

# ---------------------------------------------------------------- querylog
poll_dns() {
    local size off
    [ -r "$CFG_QUERYLOG" ] || return 0
    size=$(wc -c < "$CFG_QUERYLOG" 2>/dev/null || echo 0)
    off=$(sed -n '1p' "$STATE_DIR/meta" 2>/dev/null)
    case "$off" in ''|*[!0-9]*) off=0 ;; esac
    # a rotated (smaller) file means we start over
    [ "$size" -lt "$off" ] && off=0
    if [ "$size" -gt "$off" ]; then
        # Lower-cased on the way in: DNS names are case-insensitive, and a
        # client that shouts must not miss the catalogue.  It also makes IPv6
        # literals agree with the way conntrack writes them.  Doing it here
        # keeps tolower() out of every awk program - busybox awk is not
        # guaranteed to have it.
        tail -c +$((off + 1)) "$CFG_QUERYLOG" 2>/dev/null \
            | "$LUA" "$SELF_DIR/ans.lua" 2>/dev/null \
            | tr 'A-Z' 'a-z' >> "$STATE_DIR/dnsmap.tsv"
    fi
    # Remember where we stopped.  A line still being written may be skipped;
    # at one line per round that is not worth the complexity of buffering.
    {
        printf '%s\n' "$size"
        sed -n '2p' "$STATE_DIR/meta" 2>/dev/null || echo 0
    } > "$STATE_DIR/meta.new" && mv -f "$STATE_DIR/meta.new" "$STATE_DIR/meta"
}

# ---------------------------------------------------------------- name resolution
# The catalogues are large (apps.tsv is ~80k keys), so they are read only when
# a host name is seen for the first time.  namemap.tsv then holds the answer:
#
#   <host name> <TAB> app|cat|site <TAB> <display name>
#
# classify() reads only that file, which is why the poll stays cheap no matter
# how big the catalogue grows.

# Fingerprint used to notice that the catalogue was replaced under us.
catalog_fingerprint() {
    printf '%s:%s\n' \
        "$(wc -c < "$CFG_APPMAP" 2>/dev/null || echo 0)" \
        "$(wc -c < "$CFG_CATEGORIES" 2>/dev/null || echo 0)"
}

# Resolve a batch of host names against the catalogue.  Prints namemap rows.
resolve_batch() {
    awk -v appmap="$CFG_APPMAP" -v catmap="$CFG_CATEGORIES" -v hosts="$1" '
    # The registrable domain: the fallback label when a host name is in neither
    # table.  A small public-suffix list is enough for that.
    function app_of(d,   n, p, last2) {
        if (d == "") return ""
        n = split(d, p, ".")
        if (n < 2) return d
        last2 = p[n-1] "." p[n]
        if (n >= 3 && (last2 == "com.cn" || last2 == "net.cn" || last2 == "org.cn" ||
                       last2 == "edu.cn" || last2 == "gov.cn" || last2 == "co.jp" ||
                       last2 == "co.uk" || last2 == "com.hk" || last2 == "com.tw" ||
                       last2 == "co.kr"))
            return p[n-2] "." last2
        return last2
    }
    # Longest suffix that the table knows, walking one label at a time.  This is
    # what keeps the lookup O(labels) instead of a scan over every key.
    function longest(h, tab,   s, i) {
        s = h
        if (s in tab) return tab[s]
        while ((i = index(s, ".")) > 0) {
            s = substr(s, i + 1)
            if (s in tab) return tab[s]
        }
        return ""
    }
    BEGIN {
        while ((getline l < appmap) > 0) {
            if (l ~ /^#/ || l == "") continue
            split(l, f, "\t")
            if (f[1] == "" || f[2] == "") continue
            if (f[3] == "H") ahost[f[2]] = f[1]
            else             asuf[f[2]] = f[1]
        }
        close(appmap)
        while ((getline l < catmap) > 0) {
            if (l ~ /^#/ || l == "") continue
            split(l, f, "\t")
            if (f[1] != "" && f[2] != "") csuf[f[2]] = f[1]
        }
        close(catmap)
        while ((getline h < hosts) > 0) {
            sub(/\r$/, "", h)
            if (h == "") continue
            if (h in ahost)      { print h "\tapp\t" ahost[h]; continue }
            n = longest(h, asuf)
            if (n != "")         { print h "\tapp\t" n; continue }
            c = longest(h, csuf)
            if (c != "")         { print h "\tcat\t" c; continue }
            print h "\tsite\t" app_of(h)
        }
        close(hosts)
    }' /dev/null
}

# Resolve the host names added since the last call.  Cheap when nothing is new,
# which is the common case: the catalogue is loaded only for a fresh host name.
resolve_names() {
    local off size fp
    [ -s "$STATE_DIR/dnsmap.tsv" ] || return 0

    # A replaced catalogue invalidates every cached answer, so start over.  The
    # whole known set is then re-resolved in a single batch.
    fp=$(catalog_fingerprint)
    if [ "$(cat "$STATE_DIR/catfp" 2>/dev/null)" != "$fp" ]; then
        : > "$STATE_DIR/namemap.tsv"
        printf '0\n' > "$STATE_DIR/nmoff"
        printf '0\n' > "$STATE_DIR/nmtime"
        printf '%s\n' "$fp" > "$STATE_DIR/catfp"
        log "catalogue changed, re-resolving known host names"
    fi
    size=$(wc -c < "$STATE_DIR/dnsmap.tsv" 2>/dev/null || echo 0)
    off=$(sed -n '1p' "$STATE_DIR/nmoff" 2>/dev/null)
    case "$off" in ''|*[!0-9]*) off=0 ;; esac
    [ "$size" -lt "$off" ] && off=0
    # nothing new since the last pass: nothing can be pending either
    [ "$size" -gt "$off" ] || { printf '0\n' > "$STATE_DIR/pending"; return 0; }

    # Host names we have already answered are dropped here, not inside awk, so
    # the batch stays proportional to what is genuinely new.
    tail -c +$((off + 1)) "$STATE_DIR/dnsmap.tsv" 2>/dev/null \
        | awk -F'\t' -v nm="$STATE_DIR/namemap.tsv" '
            BEGIN {
                while ((getline l < nm) > 0) {
                    split(l, f, "\t")
                    if (f[1] != "") known[f[1]] = 1
                }
                close(nm)
            }
            {
                h = $2
                sub(/\r$/, "", h)
                if (h != "" && !(h in known) && !(h in got)) { got[h] = 1; print h }
            }' > "$STATE_DIR/newhosts.txt" 2>/dev/null

    if [ -s "$STATE_DIR/newhosts.txt" ]; then
        local pending now last
        pending=$(wc -l < "$STATE_DIR/newhosts.txt" 2>/dev/null || echo 0)
        now=$(date +%s 2>/dev/null || echo 0)
        last=$(sed -n '1p' "$STATE_DIR/nmtime" 2>/dev/null)
        case "$last" in ''|*[!0-9]*) last=0 ;; esac
        # Throttle: a handful of fresh names is not worth re-reading the whole
        # catalogue.  The offset stays where it is so they are picked up on a
        # later pass - until then they read as their registrable domain.  The
        # page can cut that wait short: rpcd drops a flag when someone who is
        # actually looking at the page asks for the names now.
        if [ ! -f "$STATE_DIR/resolve.now" ] &&
           [ "$pending" -lt 500 ] && [ $((now - last)) -lt "$CFG_RESOLVE" ]; then
            printf '%s\n' "$pending" > "$STATE_DIR/pending"
            return 0
        fi
        rm -f "$STATE_DIR/resolve.now"
        resolve_batch "$STATE_DIR/newhosts.txt" >> "$STATE_DIR/namemap.tsv" 2>/dev/null
        printf '%s\n' "$now" > "$STATE_DIR/nmtime.new" && mv -f "$STATE_DIR/nmtime.new" "$STATE_DIR/nmtime"
    fi
    printf '0\n' > "$STATE_DIR/pending"

    printf '%s\n' "$size" > "$STATE_DIR/nmoff.new" && mv -f "$STATE_DIR/nmoff.new" "$STATE_DIR/nmoff"
    return 0
}

# ---------------------------------------------------------------- conntrack deltas
poll_ct() {
    # Both files are cleared first: awk only creates them when it has something
    # to write, so a stale delta would otherwise be counted a second time.
    rm -f "$STATE_DIR/flow.new" "$STATE_DIR/flow.delta"
    awk -v state="$STATE_DIR/flow.state" -v delta="$STATE_DIR/flow.delta" -v newst="$STATE_DIR/flow.new" '
    BEGIN {
        while ((getline l < state) > 0) {
            split(l, f, "\t"); if (f[1] != "") prev[f[1]] = f[2] " " f[3]
        }
        close(state)
    }
    {
        src=""; dst=""; sport=""; dport=""; np=0; b1=0; b2=0
        for (i = 1; i <= NF; i++) {
            t = $i
            if      (t ~ /^src=/)   { if (src   == "") src   = substr(t, 5) }
            else if (t ~ /^dst=/)   { if (dst   == "") dst   = substr(t, 5) }
            else if (t ~ /^sport=/) { if (sport == "") sport = substr(t, 7) }
            else if (t ~ /^dport=/) { if (dport == "") dport = substr(t, 7) }
            else if (t ~ /^bytes=/) { np++; if (np == 1) b1 = substr(t, 7) + 0
                                      else if (np == 2) b2 = substr(t, 7) + 0 }
        }
        if (src == "" || dst == "") next
        # $3 is the protocol name; it belongs in the key because the same
        # address/port pair can exist over both tcp and udp at once
        key = $1 "|" $3 "|" src "|" sport "|" dst "|" dport
        if (!(key in seen)) { seen[key] = 1; keys[++nk] = key }
        cb1[key] = b1; cb2[key] = b2
    }
    END {
        for (i = 1; i <= nk; i++) {
            k = keys[i]; pb1 = 0; pb2 = 0
            if (k in prev) { split(prev[k], q, " "); pb1 = q[1] + 0; pb2 = q[2] + 0 }
            d1 = cb1[k] - pb1; d2 = cb2[k] - pb2
            # a counter that went backwards means the entry was recreated
            if (d1 < 0) d1 = cb1[k]
            if (d2 < 0) d2 = cb2[k]
            if (d1 + d2 > 0) print k "\t" d1 "\t" d2 > delta
            print k "\t" cb1[k] "\t" cb2[k] > newst
        }
    }' "$CT" 2>/dev/null
    [ -f "$STATE_DIR/flow.new" ] && mv -f "$STATE_DIR/flow.new" "$STATE_DIR/flow.state"
    return 0
}

# ---------------------------------------------------------------- per-host accounting
# A byte counter per client, in the spirit of wrtbwmon: the router counts what
# each host really sends and receives, with no dependence on DNS, on the
# conntrack table or on nf_conntrack_acct being on.
#
# wrtbwmon counts in the FORWARD chain (RRDIPT_FORWARD in its readDB.awk).  That
# is the one hook this deployment cannot use.  passwall keeps its own nft table
# whose base chains are prerouting and output only (see gen_nft_tables in its
# nftables.sh), and every proxied connection ends in "tproxy to :port" or
# "redirect to :port", both of which hand it to a local socket.  Proxied client
# traffic therefore travels PREROUTING to INPUT and never reaches FORWARD, so a
# FORWARD counter would miss the bulk of what we want to measure - and AdGuard
# Home DNS is redirected out of PREROUTING in exactly the same way.
# (wrtbwmon's readDB.awk is also gawk-only: it dispatches on ARGIND, which
# busybox awk does not have, so on this target it would do nothing at all and
# report nothing.)
#
# The two hooks a packet from or to a LAN client crosses exactly once are:
#
#   upload    prerouting  priority raw   iifname <lan>  ip saddr <client>
#   download  postrouting priority 101   oifname <lan>  ip daddr <client>
#
# Upload is matched by source and download by destination, and no packet matches
# both, so a directly routed download is not counted twice.  Filtering on the
# LAN interface keeps the proxy own sockets out of it, since those leave by the
# WAN device.  The download hook has to be postrouting rather than prerouting:
# the download half of a proxied connection is produced by a local socket and
# leaves through OUTPUT, so it never appears in prerouting at all.
#
# One nft rule per client and direction is used, because a rule counter works on
# every nftables in this tree whereas per-element map counters do not.  The rule
# set is rebuilt only when the set of clients changes, and the counters are read
# before any rebuild, so rebuilding does not lose the round.
ACCT_TABLE=${ACCT_TABLE:-inet traffic_acct}

acct_available() { command -v nft >/dev/null 2>&1; }

# The LAN device: what separates client traffic from the proxy own.
detect_lan_dev() {
    local br
    br=$($UCI -q get network.lan.device 2>/dev/null)
    [ -n "$br" ] || br=br-lan
    printf '%s\n' "$br"
}

# Report, once per distinct reason, that the counters are unavailable.  The page
# reads this from the snapshot, so a silent fallback does not look like a
# working collector with suspiciously low numbers.
acct_off() {
    [ "$(sed -n '1p' "$STATE_DIR/acct.off" 2>/dev/null)" = "$1" ] && return 0
    printf '%s\n' "$1" > "$STATE_DIR/acct.off"
    log "per-host accounting off: $1"
}

# The hosts to count: every neighbour the kernel has on the LAN.  A failed or
# incomplete entry is not a client, and the MAC check keeps junk out of the
# rule set.
CFG_ARPFILE=${TRAFFIC_ARPFILE:-/proc/net/arp}

acct_hosts() {
    if [ -r "$CFG_ARPFILE" ]; then
        awk -v lan="$CFG_LAN4" '
            NR > 1 && $3 != "0x0" && $4 ~ /^([0-9a-fA-F][0-9a-fA-F]:){5}[0-9a-fA-F][0-9a-fA-F]$/ {
                if (lan == "" || index($1, lan) == 1) print $1
            }' "$CFG_ARPFILE"
    fi
    if command -v ip >/dev/null 2>&1; then
        ip -6 neigh show 2>/dev/null | awk -v lan="$CFG_LAN6" '
            /^[0-9a-fA-F:]+[ \t]/ {
                if ($0 ~ /(FAILED|INCOMPLETE)/) next
                a = $1
                sub(/%[^%]*$/, "", a)
                if (lan == "" || index(a, lan) == 1) print a
            }'
    fi
}

# Rebuild the counting rules when the client set or the LAN device changed, and
# also whenever the chains are gone: a firewall reload flushes the whole
# ruleset, ours included, and without this check the counters would stop for
# good while every number on the page stayed plausible.
acct_sync() {
    local lan hosts cur
    lan=$(detect_lan_dev)
    [ -n "$lan" ] || return 1
    hosts=$(acct_hosts | sort -u | tr '\n' ' ')
    cur=$(cat "$STATE_DIR/acct.hosts" 2>/dev/null)
    if [ "$hosts" = "$cur" ] && [ "$lan" = "$(cat "$STATE_DIR/acct.dev" 2>/dev/null)" ] &&
       nft list chain $ACCT_TABLE pre >/dev/null 2>&1 && nft list chain $ACCT_TABLE post >/dev/null 2>&1; then
        return 0
    fi

    nft add table $ACCT_TABLE 2>/dev/null
    nft add chain $ACCT_TABLE pre '{ type filter hook prerouting priority raw; policy accept; }' 2>/dev/null
    nft add chain $ACCT_TABLE post '{ type filter hook postrouting priority 101; policy accept; }' 2>/dev/null
    nft list chain $ACCT_TABLE pre >/dev/null 2>&1 || return 1
    nft list chain $ACCT_TABLE post >/dev/null 2>&1 || return 1
    nft flush chain $ACCT_TABLE pre 2>/dev/null
    nft flush chain $ACCT_TABLE post 2>/dev/null

    local h
    for h in $hosts; do
        case "$h" in
            *:*) nft add rule $ACCT_TABLE pre  iifname "$lan" ip6 saddr "$h" counter 2>/dev/null
                 nft add rule $ACCT_TABLE post oifname "$lan" ip6 daddr "$h" counter 2>/dev/null ;;
            *)   nft add rule $ACCT_TABLE pre  iifname "$lan" ip saddr "$h" counter 2>/dev/null
                 nft add rule $ACCT_TABLE post oifname "$lan" ip daddr "$h" counter 2>/dev/null ;;
        esac
    done
    printf '%s\n' "$hosts" > "$STATE_DIR/acct.hosts"
    printf '%s\n' "$lan" > "$STATE_DIR/acct.dev"
    return 0
}

# Print "<address> <TAB> <bytes>" for every counting rule in one chain.  The
# field order is searched rather than assumed, so it survives nft print changes.
acct_read() {
    nft list chain $ACCT_TABLE "$1" 2>/dev/null | awk '
        {
            a = ""; b = ""
            for (i = 1; i <= NF; i++) {
                if ($i == "saddr" || $i == "daddr") a = $(i + 1)
                else if ($i == "bytes") b = $(i + 1)
            }
            if (a != "" && b != "") print a "\t" b
        }'
}

# Turn the absolute counters into this round deltas and accumulate them per
# client.  A counter that went backwards means the rules were rebuilt (a
# firewall reload wipes our table), so the new value is used as the delta.
account_clients() {
    local m
    ACCT_ON=0
    [ "$CFG_ACCT" = "1" ] || return 0
    acct_available || { acct_off "nft is not installed"; return 0; }
    acct_sync || { acct_off "the counter table could not be set up"; return 0; }
    ACCT_ON=1
    rm -f "$STATE_DIR/acct.off"

    : > "$STATE_DIR/acct.new"
    for m in pre post; do
        acct_read "$m" | awk -v m="$m" -F'\t' '{ print m "\t" $1 "\t" $2 }' >> "$STATE_DIR/acct.new"
    done
    : > "$STATE_DIR/acct_delta.tsv"

    awk -F'\t' -v abs="$STATE_DIR/acct.abs" -v cum="$STATE_DIR/acct.tsv" \
        -v dl="$STATE_DIR/acct_delta.tsv" '
        BEGIN {
            while ((getline l < abs) > 0) { split(l, f, "\t"); old[f[1] "|" f[2]] = f[3] + 0 }
            close(abs)
            while ((getline l < cum) > 0) {
                split(l, f, "\t")
                td[f[1]] = f[2] + 0; tu[f[1]] = f[3] + 0
            }
            close(cum)
        }
        {
            b = $3 + 0
            d = b - old[$1 "|" $2]
            if (d < 0) d = b
            if ($1 == "pre") up[$2] += d; else down[$2] += d
            seen[$2] = 1
        }
        END {
            for (ip in seen) {
                td[ip] += down[ip]; tu[ip] += up[ip]
                if (down[ip] + up[ip] > 0) printf "%s\t%d\t%d\n", ip, down[ip], up[ip] > dl
            }
            for (ip in td) printf "%s\t%d\t%d\n", ip, td[ip], tu[ip] > cum
        }' "$STATE_DIR/acct.new" 2>/dev/null
    mv -f "$STATE_DIR/acct.new" "$STATE_DIR/acct.abs"

    # clients.tsv is what the page lists: when the counters are running they are
    # the client totals, and conntrack only supplies the application attribution.
    if [ "$ACCT_ON" = "1" ] && [ -f "$STATE_DIR/acct.tsv" ]; then
        awk -F'\t' '{ if ($2 + $3 > 0) printf "%s\t%d\t%d\t%d\n", $1, $2 + $3, $2, $3 }' \
            "$STATE_DIR/acct.tsv" > "$STATE_DIR/clients.new" 2>/dev/null \
            && mv -f "$STATE_DIR/clients.new" "$STATE_DIR/clients.tsv"
    fi
    return 0
}

# ---------------------------------------------------------------- attribution
classify() {
    if [ ! -s "$STATE_DIR/flow.delta" ]; then
        # No traffic this round is a fact worth recording: the series keeps a
        # point for it, so a quiet spell reads as zero rather than as a gap.
        printf '0\n0\n' > "$STATE_DIR/sample.new" && mv -f "$STATE_DIR/sample.new" "$STATE_DIR/sample.tsv"
        return 0
    fi
    awk -v dns="$STATE_DIR/dnsmap.tsv" -v tot="$STATE_DIR/totals.tsv" \
        -v cli="$STATE_DIR/clients.tsv" -v rt="$STATE_DIR/router.tsv" -v st="$STATE_DIR/stat.tsv" \
        -v acfile="$STATE_DIR/ac.tsv" -v acnew="$STATE_DIR/ac.new" \
        -v nmap="$STATE_DIR/namemap.tsv" -v smp="$STATE_DIR/sample.new" \
        -v lan4="$CFG_LAN4" -v lan6="$CFG_LAN6" -v self="$CFG_SELF" -v acct="$ACCT_ON" '
    # The registrable domain: what to show when a host name was in neither
    # catalogue, i.e. an unidentified website.  A small public-suffix list is
    # enough here.
    function app_of(d,   n, p, last2) {
        if (d == "") return ""
        n = split(d, p, ".")
        if (n < 2) return d
        last2 = p[n-1] "." p[n]
        if (n >= 3 && (last2 == "com.cn" || last2 == "net.cn" || last2 == "org.cn" ||
                       last2 == "edu.cn" || last2 == "gov.cn" || last2 == "co.jp" ||
                       last2 == "co.uk" || last2 == "com.hk" || last2 == "com.tw" ||
                       last2 == "co.kr"))
            return p[n-2] "." last2
        return last2
    }
    # Last resort: what the protocol and port alone say.  This is the layer that
    # turns an unnamed encrypted flow into "SSL/TLS" (or QUIC / HTTP / ...)
    # rather than leaving it in an undifferentiated heap.
    #
    # Everything here is decidable from the 5-tuple, which is the honest limit
    # of this design: a gateway that inspects payloads can also name media
    # containers (FLV, MP4) and obscure protocols, and that is out of reach
    # without deep packet inspection.
    function proto_bucket(proto, port,   p) {
        p = port + 0
        if (proto == "icmp" || proto == "icmpv6" || proto == "ipv6-icmp") return "ICMP"
        if (proto == "udp" && p == 443) return "QUIC"
        if (proto == "tcp" && (p == 443 || p == 8443 || p == 9443)) return "SSL/TLS"
        if (proto == "tcp" && (p == 80 || p == 8080 || p == 8000 || p == 8880)) return "HTTP"
        if (p == 53 || p == 853 || p == 5353 || p == 5355) return "DNS"
        if (proto == "udp" && (p == 3478 || p == 3479 || p == 3480 || p == 19302 || p == 5349)) return "STUN"
        if (proto == "tcp" && (p == 554 || p == 8554)) return "RTSP"
        if (proto == "tcp" && p == 1935) return "FLV"
        if (p == 25 || p == 110 || p == 143 || p == 465 || p == 587 || p == 993 || p == 995) return "Email"
        if (p == 22 || p == 2222) return "SSH"
        if (p == 23) return "Telnet"
        if (p == 20 || p == 21) return "FTP"
        if (p == 3389) return "RDP"
        if (p == 139 || p == 445) return "SMB"
        if (p == 1883 || p == 8883) return "MQTT"
        if (p == 1812 || p == 1813 || p == 1645 || p == 1646) return "RADIUS"
        if (p == 5060 || p == 5061) return "SIP"
        if (p == 1701) return "L2TP"
        if (p == 1723) return "PPTP"
        if (p == 500 || p == 4500) return "IPSec"
        if (p == 1433) return "MSSQL"
        if (p == 3306) return "MySQL"
        if (p == 5432) return "PostgreSQL"
        if (p == 6379) return "Redis"
        if (p == 123) return "NTP"
        if (p == 161 || p == 162) return "SNMP"
        if (p == 67 || p == 68) return "DHCP"
        return "Other"
    }
    BEGIN {
        # the router own LAN addresses: a flow sourced by one of them is the
        # box talking (mostly the outbound connections of a local proxy), not a
        # client, so it belongs with the tunnel rather than in the client list
        nself = split(self, slf, " ")
        for (i = 1; i <= nself; i++) if (slf[i] != "") isself[slf[i]] = 1
        while ((getline l < dns) > 0) {
            split(l, f, "\t")
            if (f[1] != "" && f[3] != "") { byclient[f[1] "|" f[3]] = f[2]; byip[f[3]] = f[2] }
        }
        close(dns)
        # namemap.tsv, not the catalogues: resolve_names() has already turned
        # every host name we have seen into app|cat|site plus a display name,
        # so this file stays small and the poll stays cheap.
        while ((getline l < nmap) > 0) {
            split(l, f, "\t")
            if (f[1] != "" && f[3] != "") nm[f[1]] = f[2] "\t" f[3]
        }
        close(nmap)
        while ((getline l < tot) > 0) { split(l, f, "\t"); up[f[1]] = f[2] + 0; dn[f[1]] = f[3] + 0 }
        close(tot)
        while ((getline l < cli) > 0) { split(l, f, "\t"); cb[f[1]] = f[2] + 0 }
        close(cli)
        if ((getline l < rt) > 0) rb_total = l + 0        # router.tsv is a single running total
        close(rt)
        if ((getline l < st) > 0) { split(l, f, "\t"); m_c = f[1] + 0; m_g = f[2] + 0; k_b = f[3] + 0; k_o = f[4] + 0 }
        close(st)
        # per (application, client) totals, so the page can show which device
        # drove an application and how many devices used it.
        # NOTE: no apostrophes in comments inside an awk program - one would
        # close the single-quoted program the shell is already inside.
        while ((getline l < acfile) > 0) {
            split(l, f, "\t")
            if (f[1] != "" && f[2] != "") ac[f[1] "|" f[2]] = f[3] + 0
        }
        close(acfile)
    }
    {
        split($1, k, "|")                 # family|proto|src|sport|dst|dport
        proto = k[2]; src = k[3]; dst = k[5]; port = k[6]
        u = $2 + 0; d = $3 + 0; t = u + d
        if (t <= 0) next
        # Not a client when the source is the router itself: either it is one of
        # the box own addresses, or it is outside the LAN prefix (a WAN-sourced
        # flow is the far end of the tunnel).
        if ((src in isself) || !(index(src, lan4) == 1 || index(src, lan6) == 1)) {
            rb["proxy"] += t
            next
        }
        cb[src] += t

        # Which client resolved this destination decides "exact" vs "any".
        dom = byclient[src "|" dst]; via = "exact"
        if (dom == "") { dom = byip[dst]; via = "any" }

        # The three kinds below must partition the client traffic, so the
        # counters are bumped only once the kind is known.
        if (dom == "") {
            # no DNS answer for this destination: the protocol is all we have
            a = proto_bucket(proto, port)
            k_o += t
        }
        else {
            # resolve_names() answered this host name already; the fallback only
            # covers the first poll of a brand new name.
            if (dom in nm) { split(nm[dom], np, "\t"); kind = np[1]; a = np[2] }
            else           { kind = "site"; a = app_of(dom) }

            if (kind == "cat") k_b += t
            else if (via == "exact") m_c += t
            else m_g += t
        }
        up[a] += u; dn[a] += d
        ac[a "|" src] += t
        # client-side throughput of this round, for the two-tier series; the
        # proxy tunnel is excluded because what it carries is already counted
        # on the client side of the flow
        sd += d; su += u
    }
    END {
        for (x in up) { if (up[x] + dn[x] > 0) printf "%s\t%d\t%d\n", x, up[x], dn[x] > tot }
        # The client totals come from the nft counters when they are running:
        # they see every packet, and the conntrack side of a proxied flow is not
        # where its bytes end up.  Only when the counters are unavailable does
        # the conntrack total stand in for them.
        if (!acct) for (y in cb) { if (cb[y] > 0) printf "%s\t%d\n", y, cb[y] > cli }
        printf "%d\n", rb_total + rb["proxy"] > rt
        printf "%d\t%d\t%d\t%d\n", m_c, m_g, k_b, k_o > st
        printf "%d\n%d\n", sd, su > smp
        for (z in ac) {
            if (ac[z] <= 0) continue
            split(z, zp, "|")
            printf "%s\t%s\t%d\n", zp[1], zp[2], ac[z] > acnew
        }
    }' "$STATE_DIR/flow.delta"
    [ -f "$STATE_DIR/ac.new" ] && mv -f "$STATE_DIR/ac.new" "$STATE_DIR/ac.tsv"
    [ -f "$STATE_DIR/sample.new" ] && mv -f "$STATE_DIR/sample.new" "$STATE_DIR/sample.tsv"
    return 0
}

# ---------------------------------------------------------------- throughput series
# One point per poll, in two tiers:
#
#   series10.tsv   10 s (or whatever interval is) for the last hour - sharp
#   series60.tsv   1 minute for the last day, and it persists in <datadir> so
#                  the day's context survives a reboot
#
# A point is <epoch> <TAB> <down bytes> <TAB> <up bytes> in that round.  The
# minute tier is the sum of the 10 s points inside it, flushed when the minute
# rolls over.
record_sample() {
    local ts="${1:-}" d u m cur_m cd cu n
    [ -n "$ts" ] || ts=$(date +%s 2>/dev/null || echo 0)
    d=0; u=0
    if [ -s "$STATE_DIR/sample.tsv" ]; then
        { read -r d; read -r u; } < "$STATE_DIR/sample.tsv"
    fi
    case "$d" in ''|*[!0-9]*) d=0 ;; esac
    case "$u" in ''|*[!0-9]*) u=0 ;; esac

    printf '%s\t%s\t%s\n' "$ts" "$d" "$u" >> "$STATE_DIR/series10.tsv"
    # The ring only needs trimming once it can have overrun, and counting the
    # lines costs a process: check every 60th sample instead of every sample.
    SAMPLE_N=$(( ${SAMPLE_N:-0} + 1 ))
    if [ $((SAMPLE_N % 60)) -eq 0 ]; then
        n=$(wc -l < "$STATE_DIR/series10.tsv" 2>/dev/null || echo 0)
        if [ "$n" -gt "$SERIES10_MAX" ]; then
            tail -n "$SERIES10_MAX" "$STATE_DIR/series10.tsv" > "$STATE_DIR/series10.new" 2>/dev/null \
                && mv -f "$STATE_DIR/series10.new" "$STATE_DIR/series10.tsv"
        fi
    fi

    m=$((ts / 60 * 60))
    cur_m=0; cd=0; cu=0
    if [ -s "$STATE_DIR/minute.tsv" ]; then
        { read -r cur_m; read -r cd; read -r cu; } < "$STATE_DIR/minute.tsv"
    fi
    case "$cur_m" in ''|*[!0-9]*) cur_m=0 ;; esac
    case "$cd" in ''|*[!0-9]*) cd=0 ;; esac
    case "$cu" in ''|*[!0-9]*) cu=0 ;; esac

    if [ "$cur_m" -gt 0 ] && [ "$cur_m" != "$m" ]; then
        # The minute that just ended is complete.  It is written even when it
        # carried nothing: the chart spaces its points by index, so a skipped
        # idle minute would silently compress the time axis.  A gap in the
        # series therefore means the collector was not running - nothing else.
        #
        # Trimming and appending happen in one rewrite and one rename, so the
        # ring is never over its cap and never half-written: a collector killed
        # mid-round leaves either the old file or the new one, both of them
        # within the window.
        awk -F'\t' -v keep="$((SERIES60_MAX - 1))" -v p="$cur_m" -v d="$cd" -v u="$cu" '
            { line[NR] = $0 }
            END {
                start = NR - keep + 1
                if (start < 1) start = 1
                for (i = start; i <= NR; i++) print line[i]
                printf "%s\t%s\t%s\n", p, d, u
            }' "$CFG_DATADIR/series60.tsv" > "$CFG_DATADIR/.series60.new" 2>/dev/null \
            && mv -f "$CFG_DATADIR/.series60.new" "$CFG_DATADIR/series60.tsv"
        cd=0; cu=0; cur_m=$m
    fi
    [ "$cur_m" -gt 0 ] || cur_m=$m
    printf '%s\n%s\n%s\n' "$cur_m" "$((cd + d))" "$((cu + u))" > "$STATE_DIR/minute.tsv"
    return 0
}

# ---------------------------------------------------------------- hour rollover
# Append the session totals to the persistent history and start a new hour.
roll_hour() {
    local hour now
    now=$(date +%s 2>/dev/null || echo 0)
    hour=$(date +%Y-%m-%dT%H 2>/dev/null)
    [ -n "$hour" ] || hour="h$now"
    [ -s "$STATE_DIR/totals.tsv" ] || return 0
    awk -F'\t' -v h="$hour" '{ printf "%s\tapp\t%s\t%d\t%d\n", h, $1, $2, $3 }' \
        "$STATE_DIR/totals.tsv" >> "$CFG_DATADIR/hourly.tsv"
    awk -F'\t' -v h="$hour" '{ printf "%s\tclient\t%s\t%d\t0\n", h, $1, $2 }' \
        "$STATE_DIR/clients.tsv" >> "$CFG_DATADIR/hourly.tsv"
    if [ -s "$STATE_DIR/router.tsv" ]; then
        printf '%s\trouter\tproxy\t%d\t0\n' "$hour" "$(cat "$STATE_DIR/router.tsv")" >> "$CFG_DATADIR/hourly.tsv"
    fi
    : > "$STATE_DIR/totals.tsv"
    : > "$STATE_DIR/clients.tsv"
    : > "$STATE_DIR/router.tsv"
    : > "$STATE_DIR/ac.tsv"
    # the session part of the per-client counters starts over with the bucket.
    # acct.abs is kept on purpose: it is the absolute baseline the next delta is
    # measured against, so clearing it would count every counter from zero once.
    : > "$STATE_DIR/acct.tsv"
    printf '0\n0\n0\n0\n' > "$STATE_DIR/stat.tsv"
    prune_hourly
    prune_dnsmap
    printf '%s\n' "$hour" > "$STATE_DIR/hour"
    log "hourly bucket $hour written"
}

# Bound the (client, host, ip) map.  It only grows while the box is up, and
# classify() reads it on every poll, so a busy network would slowly make every
# poll more expensive.  Names already resolved live in namemap.tsv and survive
# this, so a pruned entry degrades to "no DNS answer" for that address only.
prune_dnsmap() {
    local max=$CFG_DNSMAP_MAX n
    [ "$max" -gt 0 ] || return 0
    n=$(wc -l < "$STATE_DIR/dnsmap.tsv" 2>/dev/null || echo 0)
    [ "$n" -gt "$max" ] || return 0
    tail -n "$max" "$STATE_DIR/dnsmap.tsv" > "$STATE_DIR/dnsmap.new" 2>/dev/null \
        && mv -f "$STATE_DIR/dnsmap.new" "$STATE_DIR/dnsmap.tsv"
    # byte offsets into the file are meaningless after a rewrite
    printf '0\n' > "$STATE_DIR/nmoff"
    log "dnsmap pruned: $n -> $max entries"
}

# Keep only the newest $CFG_RETENTION*24 distinct hours.
prune_hourly() {
    local keep=$((CFG_RETENTION * 24))
    [ "$keep" -gt 0 ] || return 0
    awk -F'\t' -v keep="$keep" '
        { hours[$1] = 1 }
        END {
            n = 0
            for (h in hours) order[n++] = h
            # insertion sort: the number of distinct hours is small
            for (i = 1; i < n; i++) {
                v = order[i]; j = i - 1
                while (j >= 0 && order[j] > v) { order[j+1] = order[j]; j-- }
                order[j+1] = v
            }
            cutoff = ""
            if (n > keep) cutoff = order[n - keep]
            for (h in hours) if (cutoff != "" && h < cutoff) drop[h] = 1
            for (h in drop) print h
        }' "$CFG_DATADIR/hourly.tsv" > "$CFG_DATADIR/.drop" 2>/dev/null
    if [ -s "$CFG_DATADIR/.drop" ]; then
        awk -F'\t' 'NR == FNR { drop[$1] = 1; next } !($1 in drop)' \
            "$CFG_DATADIR/.drop" "$CFG_DATADIR/hourly.tsv" > "$CFG_DATADIR/.hourly.new" \
            && mv -f "$CFG_DATADIR/.hourly.new" "$CFG_DATADIR/hourly.tsv"
    fi
    rm -f "$CFG_DATADIR/.drop"
}

# ---------------------------------------------------------------- snapshot for rpcd
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

write_summary() {
    local hour flows dnsmap
    hour=$(cat "$STATE_DIR/hour" 2>/dev/null)
    # wc -l, not "grep -c . || echo 0": an empty file makes grep print 0 *and*
    # exit non-zero, so the fallback would append a second 0 and the "field":
    # value would end up spanning two lines, which is not valid JSON.
    flows=$(wc -l < "$STATE_DIR/flow.state" 2>/dev/null || echo 0)
    dnsmap=$(wc -l < "$STATE_DIR/dnsmap.tsv" 2>/dev/null || echo 0)

    {
        printf '{"collected_at":%s,"interval":%s,"hour":"%s","flows":%s,"dnsmap_lines":%s,' \
            "$(date +%s 2>/dev/null || echo 0)" "$CFG_INTERVAL" "$(json_escape "$hour")" "$flows" "$dnsmap"
        # Per-application client breakdown, rebuilt with every snapshot: how
        # many devices used an application, and which one carried most of it.
        # The output is redirected explicitly so it does not land in the
        # snapshot being assembled around it.
        awk -F'\t' '
            { sum[$1] += $3; cnt[$1] += 1
              if ($3 > best[$1]) { best[$1] = $3; who[$1] = $2 } }
            END { for (k in sum) printf "%s\t%d\t%d\t%s\n", k, cnt[k], best[k], who[k] }
        ' "$STATE_DIR/ac.tsv" 2>/dev/null > "$STATE_DIR/ac.agg"

        printf '"querylog":"%s","apps":[' "$(json_escape "$CFG_QUERYLOG")"
        # The heaviest N applications are picked inside awk instead of by a
        # "sort | head | awk" pipeline: the table is small but the pipeline cost
        # three processes on every snapshot, and a snapshot is written on every
        # poll.  A partial selection sort over N is a few thousand comparisons.
        awk -F'\t' -v acagg="$STATE_DIR/ac.agg" -v leases="${TRAFFIC_LEASES:-/tmp/dhcp.leases}" \
            -v top="$CFG_TOP_APPS" '
          BEGIN {
              while ((getline l < acagg) > 0) {
                  split(l, f, "\t")
                  if (f[1] == "") continue
                  acn[f[1]] = f[2] + 0; acb[f[1]] = f[3] + 0; act[f[1]] = f[4]
              }
              close(acagg)
              # a DHCP lease turns a bare address into something readable
              while ((getline l < leases) > 0) {
                  split(l, f, " ")
                  if (f[3] != "" && f[4] != "") {
                      nm = f[4]; gsub(/[^A-Za-z0-9._-]/, "_", nm); lname[f[3]] = nm
                  }
              }
              close(leases)
              n = 0
          }
          {
              t = $2 + $3
              if (t <= 0) next
              n++; key[n] = $1; val[n] = t; upv[n] = $2; dnv[n] = $3
          }
          END {
              k = (n < top) ? n : top
              for (i = 1; i <= k; i++) {
                  m = i
                  for (j = i + 1; j <= n; j++) if (val[j] > val[m]) m = j
                  if (m != i) {
                      tv = val[i]; val[i] = val[m]; val[m] = tv
                      tk = key[i]; key[i] = key[m]; key[m] = tk
                      tu = upv[i]; upv[i] = upv[m]; upv[m] = tu
                      td = dnv[i]; dnv[i] = dnv[m]; dnv[m] = td
                  }
                  who = act[key[i]]; wb = acb[key[i]]
                  disp = (who in lname) ? lname[who] : who
                  if (i > 1) printf ","
                  printf "{\"name\":\"%s\",\"down\":%d,\"up\":%d,\"clients\":%d,\"top\":\"%s\",\"top_bytes\":%d}",
                         key[i], dnv[i], upv[i], acn[key[i]], disp, wb
              }
          }' "$STATE_DIR/totals.tsv" 2>/dev/null
        printf '],"clients":['
        # same trick for the busiest clients
        awk -F'\t' -v leases="${TRAFFIC_LEASES:-/tmp/dhcp.leases}" -v top="$CFG_TOP_CLIENTS" '
          BEGIN {
              while ((getline l < leases) > 0) {
                  split(l, f, " ")
                  if (f[3] != "" && f[4] != "") {
                      nm = f[4]; gsub(/[^A-Za-z0-9._-]/, "_", nm); lname[f[3]] = nm
                  }
              }
              close(leases)
              n = 0
          }
          {
              b = $2 + 0
              if (b <= 0) next
              n++; cip[n] = $1; cby[n] = b
          }
          END {
              k = (n < top) ? n : top
              for (i = 1; i <= k; i++) {
                  m = i
                  for (j = i + 1; j <= n; j++) if (cby[j] > cby[m]) m = j
                  if (m != i) { tb = cby[i]; cby[i] = cby[m]; cby[m] = tb
                                ti = cip[i]; cip[i] = cip[m]; cip[m] = ti }
                  disp = (cip[i] in lname) ? lname[cip[i]] : cip[i]
                  if (i > 1) printf ","
                  printf "{\"ip\":\"%s\",\"name\":\"%s\",\"bytes\":%d}", cip[i], disp, cby[i]
              }
          }' "$STATE_DIR/clients.tsv" 2>/dev/null
        printf '],"totals":{'
        awk -F'\t' '{
            up += $2; down += $3
            if ($1 == "Other") ou += $2 + $3
        } END {
            printf "\"down\":%d,\"up\":%d,\"other\":%d", down, up, ou
        }' "$STATE_DIR/totals.tsv" 2>/dev/null
        printf ',"router":%s' "$(cat "$STATE_DIR/router.tsv" 2>/dev/null || echo 0)"
        printf ',"client_count":%s' "$(wc -l < "$STATE_DIR/clients.tsv" 2>/dev/null || echo 0)"
        # the per-host counters: how much every LAN client really moved, which is
        # the denominator the application breakdown is measured against.  When
        # they are not running (no nft, or the table could not be created) the
        # page is told, instead of being handed suspiciously small numbers.
        printf ',"acct":%s' "$ACCT_ON"
        if [ "$ACCT_ON" = "1" ]; then
            printf ',"accounted":{'
            awk -F'\t' '{ d += $2; u += $3 } END { printf "\"down\":%d,\"up\":%d}", d + 0, u + 0 }' \
                "$STATE_DIR/acct.tsv" 2>/dev/null || printf '"down":0,"up":0}'
        fi
        [ -s "$STATE_DIR/acct.off" ] && printf ',"acct_error":"%s"' "$(json_escape "$(sed -n '1p' "$STATE_DIR/acct.off")")"
        # host names still waiting for the resolver: the page asks for them to
        # be resolved at once while it is open, and does nothing when it is not
        printf ',"pending":%s' "$(sed -n '1p' "$STATE_DIR/pending" 2>/dev/null || echo 0)"
        # which addresses count as "the router itself" - shown by the page, and
        # the first thing to look at when a client list seems to have the box in it
        printf ',"self":"%s"' "$(printf '%s' "$CFG_SELF" | tr ' ' '\n' | grep -v '^$' | head -4 | tr '\n' ' ' | sed -e 's/ *$//' -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
        # stat.tsv: <named via same client> <named via any client> <bucket> <other>
        awk -F'\t' '{ printf ",\"exact\":%d,\"any\":%d,\"bucket\":%d,\"residual\":%d", $1, $2, $3, $4 }' \
            "$STATE_DIR/stat.tsv" 2>/dev/null
        printf '}}\n'
    } > "$STATE_DIR/summary.json.new" 2>/dev/null \
        && mv -f "$STATE_DIR/summary.json.new" "$STATE_DIR/summary.json"
}

# ---------------------------------------------------------------- main
run() {
    load_config
    [ "$CFG_ENABLED" = "1" ] || { log "disabled by uci"; return 0; }
    init_state
    log "started: interval=${CFG_INTERVAL}s lan4=$CFG_LAN4 lan6=$CFG_LAN6 querylog=$CFG_QUERYLOG"

    local hour last_hour now
    last_hour=$(cat "$STATE_DIR/hour" 2>/dev/null)
    while :; do
        poll_dns
        resolve_names
        poll_ct
        # the counters are read before classify(): they are what the client
        # totals come from, and reading them first keeps a rule rebuild from
        # swallowing the round
        account_clients
        classify
        # one clock read per round, shared by the sample and the hour check
        now=$(date +%s 2>/dev/null || echo 0)
        record_sample "$now"
        hour=$(date +%Y-%m-%dT%H 2>/dev/null)
        if [ -n "$last_hour" ] && [ "$hour" != "$last_hour" ]; then
            roll_hour
        fi
        [ -n "$hour" ] && last_hour=$hour
        write_summary
        sleep "$CFG_INTERVAL"
    done
}

run

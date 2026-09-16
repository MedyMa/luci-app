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
#      That is what turns a bare destination IP into an application name.
#   3. A flow whose source is a LAN client is attributed to the domain its
#      client resolved for that destination; a flow whose source is the router
#      itself is the proxy tunnel and is accounted separately, so it never
#      doubles the client traffic it carries.
#
# State lives in /tmp/traffic (RAM).  Once an hour the session totals are
# appended to <datadir>/hourly.tsv and reset, which is the persistent history.
#
# Read-only with respect to the rest of the system: nothing here changes
# firewall, DNS or proxy configuration.

set -u

STATE_DIR=${STATE_DIR:-/tmp/traffic}
SELF_DIR=${SELF_DIR:-/usr/share/traffic}
CT=${CT:-/proc/net/nf_conntrack}
LUA=${LUA:-/usr/bin/lua}
UCI=${UCI:-/usr/bin/uci}
HOSTNAME_BIN=${HOSTNAME_BIN:-/bin/hostname}

CFG_ENABLED=1
CFG_INTERVAL=10
CFG_DATADIR=/etc/traffic
CFG_QUERYLOG=
CFG_LAN4=
CFG_LAN6=
CFG_APPMAP=$CFG_DATADIR/apps.tsv
CFG_RETENTION=7
CFG_TOP_APPS=50
CFG_TOP_CLIENTS=20

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
        appmap)         v=${TRAFFIC_APPMAP:-} ;;
        retention_days) v=${TRAFFIC_RETENTION_DAYS:-} ;;
        top_apps)       v=${TRAFFIC_TOP_APPS:-} ;;
        top_clients)    v=${TRAFFIC_TOP_CLIENTS:-} ;;
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

detect_querylog() {
    local wl
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
    v=$(uci_get appmap);       [ -n "$v" ] && CFG_APPMAP=$v
    [ -n "$CFG_APPMAP" ] || CFG_APPMAP=$CFG_DATADIR/apps.tsv
    v=$(uci_get retention_days); [ -n "$v" ] && CFG_RETENTION=$v
    v=$(uci_get top_apps);       [ -n "$v" ] && CFG_TOP_APPS=$v
    v=$(uci_get top_clients);    [ -n "$v" ] && CFG_TOP_CLIENTS=$v

    # sanity
    case "$CFG_INTERVAL" in ''|*[!0-9]*) CFG_INTERVAL=10 ;; esac
    [ "$CFG_INTERVAL" -lt 2 ] && CFG_INTERVAL=2
    case "$CFG_RETENTION" in ''|*[!0-9]*) CFG_RETENTION=7 ;; esac
    case "$CFG_TOP_APPS" in ''|*[!0-9]*) CFG_TOP_APPS=50 ;; esac
    case "$CFG_TOP_CLIENTS" in ''|*[!0-9]*) CFG_TOP_CLIENTS=20 ;; esac
}

# ---------------------------------------------------------------- state
init_state() {
    mkdir -p "$STATE_DIR" "$CFG_DATADIR" || exit 1
    [ -f "$STATE_DIR/flow.state" ] || : > "$STATE_DIR/flow.state"
    [ -f "$STATE_DIR/dnsmap.tsv" ] || : > "$STATE_DIR/dnsmap.tsv"
    [ -f "$STATE_DIR/totals.tsv" ] || : > "$STATE_DIR/totals.tsv"
    [ -f "$STATE_DIR/clients.tsv" ] || : > "$STATE_DIR/clients.tsv"
    [ -f "$STATE_DIR/router.tsv" ] || : > "$STATE_DIR/router.tsv"
    [ -f "$STATE_DIR/stat.tsv" ] || : > "$STATE_DIR/stat.tsv"
    [ -f "$STATE_DIR/meta" ] || printf '0\n0\n' > "$STATE_DIR/meta"
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
        tail -c +$((off + 1)) "$CFG_QUERYLOG" 2>/dev/null \
            | "$LUA" "$SELF_DIR/ans.lua" 2>/dev/null >> "$STATE_DIR/dnsmap.tsv"
    fi
    # Remember where we stopped.  A line still being written may be skipped;
    # at one line per round that is not worth the complexity of buffering.
    {
        printf '%s\n' "$size"
        sed -n '2p' "$STATE_DIR/meta" 2>/dev/null || echo 0
    } > "$STATE_DIR/meta.new" && mv -f "$STATE_DIR/meta.new" "$STATE_DIR/meta"
}

# ---------------------------------------------------------------- conntrack deltas
poll_ct() {
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
        key = $1 "|" src "|" sport "|" dst "|" dport
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

# ---------------------------------------------------------------- attribution
classify() {
    [ -s "$STATE_DIR/flow.delta" ] || return 0
    awk -v dns="$STATE_DIR/dnsmap.tsv" -v tot="$STATE_DIR/totals.tsv" \
        -v cli="$STATE_DIR/clients.tsv" -v rt="$STATE_DIR/router.tsv" -v st="$STATE_DIR/stat.tsv" \
        -v appmap="$CFG_APPMAP" -v lan4="$CFG_LAN4" -v lan6="$CFG_LAN6" '
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
    BEGIN {
        while ((getline l < dns) > 0) {
            split(l, f, "\t")
            if (f[1] != "" && f[3] != "") { byclient[f[1] "|" f[3]] = f[2]; byip[f[3]] = f[2] }
        }
        close(dns)
        while ((getline l < appmap) > 0) {
            if (l ~ /^#/ || l == "") continue
            split(l, f, "\t")
            if (f[1] != "" && f[2] != "") pretty[f[2]] = f[1]
        }
        close(appmap)
        while ((getline l < tot) > 0) { split(l, f, "\t"); up[f[1]] = f[2] + 0; dn[f[1]] = f[3] + 0 }
        close(tot)
        while ((getline l < cli) > 0) { split(l, f, "\t"); cb[f[1]] = f[2] + 0 }
        close(cli)
        if ((getline l < rt) > 0) rb_total = l + 0        # router.tsv is a single running total
        close(rt)
        if ((getline l < st) > 0) { split(l, f, "\t"); m_c = f[1] + 0; m_g = f[2] + 0; m_n = f[3] + 0 }
        close(st)
    }
    {
        split($1, k, "|")                 # family|src|sport|dst|dport
        src = k[2]; dst = k[4]
        u = $2 + 0; d = $3 + 0; t = u + d
        if (t <= 0) next
        if (!(index(src, lan4) == 1 || index(src, lan6) == 1)) {
            rb["proxy"] += t
            next
        }
        cb[src] += t
        dom = byclient[src "|" dst]
        if (dom != "")          m_c += t
        else if (byip[dst] != "") { dom = byip[dst]; m_g += t }
        else                    m_n += t
        if (dom == "") { up["unknown"] += u; dn["unknown"] += d; next }
        # Look the full host name up first - AdGuard Home reports it, so a rule
        # can distinguish music.163.com from the rest of 163.com.  Only then fall
        # back to the registrable domain, which is all conntrack alone can give.
        if (dom in pretty)          a = pretty[dom]
        else {
            a = app_of(dom)
            if (a in pretty) a = pretty[a]
        }
        up[a] += u; dn[a] += d
    }
    END {
        for (x in up) { if (up[x] + dn[x] > 0) printf "%s\t%d\t%d\n", x, up[x], dn[x] > tot }
        for (y in cb) { if (cb[y] > 0) printf "%s\t%d\n", y, cb[y] > cli }
        printf "%d\n", rb_total + rb["proxy"] > rt
        printf "%d\t%d\t%d\n", m_c, m_g, m_n > st
    }' "$STATE_DIR/flow.delta"
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
    printf '0\n0\n0\n' > "$STATE_DIR/stat.tsv"
    prune_hourly
    printf '%s\n' "$hour" > "$STATE_DIR/hour"
    log "hourly bucket $hour written"
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
    flows=$(grep -c . "$STATE_DIR/flow.state" 2>/dev/null || echo 0)
    dnsmap=$(grep -c . "$STATE_DIR/dnsmap.tsv" 2>/dev/null || echo 0)

    {
        printf '{"collected_at":%s,"interval":%s,"hour":"%s","flows":%s,"dnsmap_lines":%s,' \
            "$(date +%s 2>/dev/null || echo 0)" "$CFG_INTERVAL" "$(json_escape "$hour")" "$flows" "$dnsmap"
        printf '"querylog":"%s","apps":[' "$(json_escape "$CFG_QUERYLOG")"
        awk -F'\t' '{ printf "%d\t%s\t%d\t%d\n", $2 + $3, $1, $2, $3 }' "$STATE_DIR/totals.tsv" 2>/dev/null \
            | sort -rn | head -n "$CFG_TOP_APPS" | awk -F'\t' '
            BEGIN { n = 0 }
            { if (n++) printf ","; printf "{\"name\":\"%s\",\"down\":%d,\"up\":%d}", $2, $4, $3 }'
        printf '],"clients":['
        sort -t"$(printf '\t')" -k2 -rn "$STATE_DIR/clients.tsv" 2>/dev/null | head -n "$CFG_TOP_CLIENTS" | awk -F'\t' '
            BEGIN { n = 0 }
            { if (n++) printf ","; printf "{\"ip\":\"%s\",\"bytes\":%d}", $1, $2 }'
        printf '],"totals":{'
        awk -F'\t' '{
            up += $2; down += $3
            if ($1 == "unknown") { uu += $2; ud += $3 }
        } END {
            printf "\"down\":%d,\"up\":%d,\"unknown\":%d", down, up, ud + uu
        }' "$STATE_DIR/totals.tsv" 2>/dev/null
        printf ',"router":%s' "$(cat "$STATE_DIR/router.tsv" 2>/dev/null || echo 0)"
        awk -F'\t' '{ printf ",\"matched\":%d,\"fallback\":%d,\"unmatched\":%d", $1, $2, $3 }' \
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

    local hour last_hour
    last_hour=$(cat "$STATE_DIR/hour" 2>/dev/null)
    while :; do
        poll_dns
        poll_ct
        classify
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


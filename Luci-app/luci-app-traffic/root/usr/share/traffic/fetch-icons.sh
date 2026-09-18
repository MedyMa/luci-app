#!/bin/sh
# Fetch icons for applications the package does not ship one for.
#
# Off by default.  The package carries ~700 icons and a page must never depend on
# an upstream host being reachable, so the fetching happens here, on the router,
# and only when the option is switched on - never in the browser.  What it saves
# lands in a local cache, so every later page load reads it from the router.
#
# The cache is /www/traffic-icons, which the web server already serves, so a file
# dropped there by hand works just as well.  Nothing here is fatal: a name whose
# icon cannot be fetched keeps its letter avatar, which is what the page shows
# while no file exists.
#
#   uci set traffic.settings.icons_fetch='1'
#   uci set traffic.settings.icons_url='https://cdn.simpleicons.org'
#   uci commit traffic
#
# A name is only ever tried once: every attempt is recorded, so a name upstream
# does not carry does not cost a request on every round for the rest of the
# router's uptime.

STATE_DIR=${STATE_DIR:-/tmp/traffic}
PKG_ICONS=${TRAFFIC_ICONS_PKG:-/www/luci-static/resources/traffic/icons}
CACHE=${TRAFFIC_ICONS_DIR:-/www/traffic-icons}
PER_RUN=${TRAFFIC_ICONS_PER_RUN:-5}
COLOUR=8b98a5

# The environment wins over uci, the same way the collector reads its own
# settings: it keeps this script runnable by hand, and testable without uci.
opt() {
    eval "v=\${$1:-}"
    [ -n "$v" ] && { printf '%s\n' "$v"; return; }
    uci -q get "traffic.settings.$2" 2>/dev/null
}

[ "$(opt TRAFFIC_ICONS_FETCH icons_fetch)" = "1" ] || exit 0
[ -s "$STATE_DIR/totals.tsv" ] || exit 0

BASE=$(opt TRAFFIC_ICONS_URL icons_url)
[ -n "$BASE" ] || BASE=https://cdn.simpleicons.org
BASE=${BASE%/}

f=''
for c in uclient-fetch wget curl; do
    if command -v "$c" >/dev/null 2>&1; then f=$c; break; fi
done
[ -n "$f" ] || exit 0

mkdir -p "$CACHE" 2>/dev/null || exit 0
TRIED=$STATE_DIR/icons.tried

fetch() {
    case "$f" in
        uclient-fetch) uclient-fetch -q -T 8 -O "$2" "$1" >/dev/null 2>&1 ;;
        wget)          wget -q -T 8 -O "$2" "$1" >/dev/null 2>&1 ;;
        curl)          curl -fsS -m 8 -o "$2" "$1" >/dev/null 2>&1 ;;
    esac
}

n=0
while IFS='	' read -r name rest; do
    [ -n "$name" ] || continue
    slug=$(printf '%s' "$name" | tr 'A-Z' 'a-z' | sed -e 's/[^a-z0-9][^a-z0-9]*/-/g' -e 's/^-//' -e 's/-$//')
    [ -n "$slug" ] || continue
    # already covered, by the package or by an earlier fetch
    [ -f "$PKG_ICONS/$slug.svg" ] && continue
    [ -f "$CACHE/$slug.svg" ] && continue
    grep -qxF "$slug" "$TRIED" 2>/dev/null && continue
    [ "$n" -ge "$PER_RUN" ] && break
    n=$((n + 1))
    printf '%s\n' "$slug" >> "$TRIED"
    tmp=$STATE_DIR/icon.$$
    fetch "$BASE/$slug/$COLOUR" "$tmp"
    if head -c 4 "$tmp" 2>/dev/null | grep -q '<svg'; then
        mv -f "$tmp" "$CACHE/$slug.svg"
    else
        rm -f "$tmp"
    fi
done < "$STATE_DIR/totals.tsv"

# Publish what the cache actually holds.
#
# The page asks for this one small file instead of probing a URL per name.  A
# name that is not listed is simply not requested, which is the whole point: on
# a real router the page was producing 381 404s per load - one for every
# application without a shipped icon - and that buried every other message in the
# console and made a working page look broken.
#
# The list is rebuilt from the directory rather than appended to, so it cannot
# drift away from what is on disk, and it is only replaced when it changed: this
# runs every round, and rewriting a file in flash for nothing is how a tmpfs
# habit wears out an overlay.
write_index() {
    [ -d "$CACHE" ] || return 0
    for f in "$CACHE"/*.svg; do
        [ -f "$f" ] || continue
        b=${f##*/}
        printf '%s\n' "${b%.svg}"
    done | sort -u > "$STATE_DIR/icons.index.new" 2>/dev/null || return 0
    cmp -s "$STATE_DIR/icons.index.new" "$CACHE/index.txt" 2>/dev/null ||
        mv -f "$STATE_DIR/icons.index.new" "$CACHE/index.txt"
    rm -f "$STATE_DIR/icons.index.new"
    return 0
}
write_index

exit 0

#!/bin/sh
# Does fetch-icons.sh do what it claims, without a router or a network?
#
# There is no uci and no upstream host here, so the script is run against a
# stubbed fetcher and a temporary state directory.  What this checks is the logic
# that would otherwise only be exercised on a live router: the tab-separated
# totals file, the slug a name turns into, skipping what the package already
# ships, recording an attempt so a name is never retried forever, refusing a
# response that is not an SVG, and the per-run cap.

set -u

SRC="$(cd "$(dirname "$0")/.." && pwd)/root/usr/share/traffic/fetch-icons.sh"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

fail=0
chk() {  # name expected actual
    if [ "$2" = "$3" ]; then printf 'ok   %s\n' "$1"
    else printf 'FAIL %s: expected [%s] got [%s]\n' "$1" "$2" "$3" >&2; fail=1; fi
}

mkdir -p "$T/bin" "$T/state" "$T/cache" "$T/pkg"
printf '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>' > "$T/can.svg"
printf 'not an svg at all' > "$T/bad.txt"

# One stub for every fetcher the script might pick, so the order it prefers does
# not decide whether this test touches the network.
for c in uclient-fetch wget curl; do
    cat > "$T/bin/$c" <<'STUB'
#!/bin/sh
out=''; url=''
while [ $# -gt 0 ]; do
    case "$1" in
        -o) out=$2; shift 2 ;;
        -O) out=$2; shift 2 ;;
        http*) url=$1; shift ;;
        *) shift ;;
    esac
done
case "$url" in
    *bad*) cp "$CAN_BAD" "$out" ;;
    *)     cp "$CAN" "$out" ;;
esac
exit 0
STUB
    chmod +x "$T/bin/$c"
done

# The package already ships youtube; the other four names are new.  One of them
# is routed to the bad-response stub so the "not an SVG" path is covered.
printf 'YouTube\t10\t20\nNetflix\t1\t2\nGenshin Impact\t3\t4\nStarlink\t5\t6\nBad\t7\t8\n' > "$T/state/totals.tsv"
: > "$T/pkg/youtube.svg"

run() {
    PATH="$T/bin:$PATH" CAN="$T/can.svg" CAN_BAD="$T/bad.txt" \
    TRAFFIC_ICONS_FETCH="${1:-1}" TRAFFIC_ICONS_DIR="$T/cache" \
    TRAFFIC_ICONS_PKG="$T/pkg" TRAFFIC_ICONS_PER_RUN="${2:-10}" \
    STATE_DIR="$T/state" sh "$SRC"
}

# The base URL decides which name gets the bad response: only "bad" matches.
PATH="$T/bin:$PATH" CAN="$T/can.svg" CAN_BAD="$T/bad.txt" \
TRAFFIC_ICONS_FETCH=1 TRAFFIC_ICONS_DIR="$T/cache" TRAFFIC_ICONS_PKG="$T/pkg" \
TRAFFIC_ICONS_PER_RUN=10 STATE_DIR="$T/state" \
TRAFFIC_ICONS_URL="https://example.invalid" sh "$SRC"
chk 'exit status' 0 "$?"

chk 'netflix fetched (dashless name)' 1 "$([ -f "$T/cache/netflix.svg" ] && echo 1 || echo 0)"
chk 'genshin slug has a dash' 1 "$([ -f "$T/cache/genshin-impact.svg" ] && echo 1 || echo 0)"
chk 'starlink fetched' 1 "$([ -f "$T/cache/starlink.svg" ] && echo 1 || echo 0)"
chk 'package icon not duplicated into the cache' 0 "$([ -f "$T/cache/youtube.svg" ] && echo 1 || echo 0)"
chk 'four attempts recorded' 4 "$(wc -l < "$T/state/icons.tried" | tr -d ' ')"
chk 'youtube never attempted' 0 "$(grep -cxF youtube "$T/state/icons.tried" || true)"
# A response that is not an SVG must not become an icon: the page would show a
# broken image instead of the letter avatar, which is strictly worse.
chk 'non-SVG response leaves no file' 0 "$([ -f "$T/cache/bad.svg" ] && echo 1 || echo 0)"

# A name already tried is not tried again, and a bad response leaves no file.
rm -rf "$T/cache"
PATH="$T/bin:$PATH" CAN="$T/can.svg" CAN_BAD="$T/bad.txt" \
TRAFFIC_ICONS_FETCH=1 TRAFFIC_ICONS_DIR="$T/cache" TRAFFIC_ICONS_PKG="$T/pkg" \
TRAFFIC_ICONS_PER_RUN=10 STATE_DIR="$T/state" \
TRAFFIC_ICONS_URL="https://example.invalid" sh "$SRC"
chk 'no refetch on a second run' 0 "$([ -d "$T/cache" ] && ls "$T/cache" | wc -l | tr -d ' ' || echo 0)"

# Switched off, nothing happens at all.
rm -rf "$T/cache" "$T/state/icons.tried"
run 0 10
chk 'disabled: no cache dir' 0 "$([ -d "$T/cache" ] && echo 1 || echo 0)"
chk 'disabled: no attempts' 0 "$([ -f "$T/state/icons.tried" ] && echo 1 || echo 0)"

# The per-run cap bounds a burst: one name per round, and the rest next round.
rm -rf "$T/cache" "$T/state/icons.tried"
run 1 1
chk 'cap: exactly one fetched' 1 "$([ -d "$T/cache" ] && ls "$T/cache" | wc -l | tr -d ' ' || echo 0)"

[ "$fail" = 0 ] || exit 1
echo 'fetch-icons-selftest: all checks passed'

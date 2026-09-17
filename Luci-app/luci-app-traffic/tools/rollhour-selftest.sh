#!/bin/sh
# Does roll_hour archive a busiest-client row for each application?
#
# It must, in both counter modes.  The block that writes those rows once sat
# inside the "elif clients.tsv" branch of the client rewrite, which is only
# reached when acct.tsv is empty - that is, only when the per-host nft counters
# are off.  On a router running them no archived hour carried a busiest client,
# so every range view drew a dash in the client column while the session view
# filled it.  Nothing about the page could show that, because the reader was
# correct and the writer was unreachable.
#
# The function is extracted from collector.sh rather than copied, so the test
# cannot drift away from the code it is checking.

# Deliberately no "set -e" and no "set -u".  roll_hour reads files that do not
# exist yet on the first hour (arch/router is written at the end of it), and it
# reads tunables the collector defines at startup (SERIES1H_MAX and friends).
# Either option would abort the harness on something the product treats as
# normal, and this test is about which rows reach the archive.

# COLLECTOR_SRC exists so the same checks can be pointed at an older revision:
# a test that cannot be made to fail on the broken version proves nothing.
SRC="${COLLECTOR_SRC:-$(cd "$(dirname "$0")/.." && pwd)/root/usr/share/traffic/collector.sh}"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

start=$(grep -n '^roll_hour() {' "$SRC" | cut -d: -f1)
[ -n "$start" ] || { echo "FAIL roll_hour not found in $SRC" >&2; exit 1; }
end=$(awk -v s="$start" 'NR > s && /^[a-zA-Z_][a-zA-Z0-9_]*\(\) \{/ { print NR - 1; exit }' "$SRC")
[ -n "$end" ] || { echo "FAIL could not find the end of roll_hour" >&2; exit 1; }
sed -n "${start},${end}p" "$SRC" > "$T/roll_hour.inc"
grep -q '^roll_hour() {' "$T/roll_hour.inc" || { echo "FAIL extraction produced no function" >&2; exit 1; }

fail=0
chk() {
    # name expected actual
    if [ "$2" = "$3" ]; then
        printf 'ok   %s\n' "$1"
    else
        printf 'FAIL %s: expected [%s] got [%s]\n' "$1" "$2" "$3" >&2
        fail=1
    fi
}

# The rest of the collector is stubbed: this test is about where the row is
# written, so everything that only reacts to the archive is switched off.  A
# missing stub would show up as a command-not-found on stderr, not as a pass.
log() { :; }
publish_current() { :; }
write_summary() { :; }
prune_hourly() { :; }
prune_dnsmap() { :; }
json_escape() { printf '%s' "$1"; }
record_sample() { :; }

STATE_DIR="$T/state"
CFG_DATADIR="$T/data"
mkdir -p "$STATE_DIR" "$CFG_DATADIR"
export STATE_DIR CFG_DATADIR
. "$T/roll_hour.inc"

# One application with a busiest client, and the totals the app rows come from.
# totals.tsv is <name> <up> <down>; the archive snapshot holds the same shape.
printf 'YouTube\t100\t900\n' > "$STATE_DIR/totals.tsv"
mkdir -p "$STATE_DIR/arch"
printf 'YouTube\t0\t0\n' > "$STATE_DIR/arch/totals.tsv"
printf '1\n' > "$STATE_DIR/router.tsv"
printf 'YouTube\t3\t5000\t192.168.2.50\n' > "$STATE_DIR/ac.agg"

# Mode 1: the nft counters are running, so acct.tsv has content and the client
# rewrite takes the "if" branch.  This is the case that used to lose the row.
printf '192.168.2.50\t100\t900\n' > "$STATE_DIR/acct.tsv"
: > "$CFG_DATADIR/hourly.tsv"
roll_hour
chk 'counters on: an apptop row is archived' 1 \
    "$(grep -c 'apptop' "$CFG_DATADIR/hourly.tsv" || true)"
chk 'counters on: the row names the busiest client' 1 \
    "$(grep -c 'apptop	YouTube	192.168.2.50	5000	3$' "$CFG_DATADIR/hourly.tsv" || true)"

# Mode 2: the counters are off, so acct.tsv is empty and the client rewrite
# takes the elif branch - the only place the row used to be written.
rm -f "$STATE_DIR/acct.tsv"
printf '192.168.2.50\t1000\n' > "$STATE_DIR/clients.tsv"
: > "$CFG_DATADIR/hourly.tsv"
roll_hour
chk 'counters off: an apptop row is archived' 1 \
    "$(grep -c 'apptop' "$CFG_DATADIR/hourly.tsv" || true)"

[ "$fail" = 0 ] || exit 1
echo 'rollhour-selftest: all checks passed'

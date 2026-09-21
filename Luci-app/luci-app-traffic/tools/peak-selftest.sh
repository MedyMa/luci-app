#!/bin/sh
# The one second peak collector: peak_read() keeps each round maximum from the
# sample the tick loop just took, record_peak() folds it into a minute bucket.
#
# The functions are extracted from the shipped collector.sh rather than copied,
# so this tests the text that runs on the router.  Nothing else in the collector
# test covers them: rpcd-selftest only checks that a bucket already in
# peaks.tsv reaches the page, which says nothing about whether anything ever
# puts it there.
here=$(cd "$(dirname "$0")" && pwd)
SRC="${COLLECTOR_SRC:-$here/../root/usr/share/traffic/collector.sh}"
T=$(mktemp -d)
pass=0; fail=0
ck() { # ck <name> <expected> <actual>
	if [ "$2" = "$3" ]; then pass=$((pass + 1)); printf 'ok   %-48s %s\n' "$1" "$2"
	else fail=$((fail + 1)); printf 'FAIL %-48s expected=%s got=%s\n' "$1" "$2" "$3"; fi
}

awk '/1 s peak tracker/{f=1} /throughput series/{f=0} f' "$SRC" > "$T/funcs.sh"
grep -q 'peak_read()' "$T/funcs.sh" || { echo "could not extract the functions"; exit 1; }
grep -q 'record_peak()' "$T/funcs.sh" || { echo "could not extract the functions"; exit 1; }
STATE_DIR="$T/state"
mkdir -p "$STATE_DIR"
export STATE_DIR
. "$T/funcs.sh"

PEAK_D=0; PEAK_U=0; PEAK_N=0

# ---- 1. nothing to read -----------------------------------------------------
peak_read
ck "no live.json keeps the counters at zero" "0 0" "$PEAK_D $PEAK_N"
# A failed redirection is reported by the shell itself, so the 2>/dev/null on
# the read does not silence it.  This runs once a second, so a missing file must
# say nothing at all: the router would otherwise log 86400 lines a day.
err=$(peak_read 2>&1 >/dev/null)
ck "a missing live.json says nothing on stderr" "" "$err"

# ---- 2. the placeholder the collector writes before any sample --------------
# This is what the page saw on the router while nobody had it open, and it must
# not be mistaken for a sample of zero bytes.
printf '{"ready":0,"bps_down":0,"bps_up":0,"source":""}\n' > "$STATE_DIR/live.json"
peak_read
ck "the ready:0 placeholder is not a sample" "0 0" "$PEAK_D $PEAK_N"
record_peak
ck "and it writes no bucket"                 "absent" "$([ -e "$STATE_DIR/peaks.tsv" ] && echo present || echo absent)"

# ---- 3. a real one second sample -------------------------------------------
printf '{"at":100,"bps_down":118000000,"bps_up":2400000,"source":"conntrack","ready":1,"dt":1}\n' > "$STATE_DIR/live.json"
peak_read
ck "a ready:1 sample is kept"                "118000000 1" "$PEAK_D $PEAK_N"

# ---- 4. the maximum, not the last reading ----------------------------------
printf '{"at":101,"bps_down":5000,"bps_up":9000000,"source":"conntrack","ready":1,"dt":1}\n' > "$STATE_DIR/live.json"
peak_read
ck "the maximum down is kept, not the last"  "118000000" "$PEAK_D"
ck "up keeps its own maximum"                "9000000"   "$PEAK_U"
ck "the sample count accumulates"            "2"         "$PEAK_N"

# ---- 5. one bucket per minute ----------------------------------------------
# The minute is pinned rather than read off the clock afterwards.  record_peak
# reads the minute itself, and the few hundred milliseconds between its own
# `date` and the one here is enough to cross a minute boundary under load: the
# expectation then names the next minute, record_peak writes the row under the
# previous one, and every assertion below ends up comparing a second, unrelated
# row.  That is exactly how this suite failed once out of five runs while the
# text it tests was correct.  PEAK_AT is the override the collector already
# honours, and pinning it is also what makes the merge cases that follow test
# one minute on purpose instead of by luck.
PEAK_AT=1789990020
record_peak
b=$(( PEAK_AT / 60 * 60 ))
ck "one row written"                         "1"          "$(wc -l < "$STATE_DIR/peaks.tsv")"
ck "the bucket is the minute"                "$b"         "$(cut -f1 "$STATE_DIR/peaks.tsv")"
ck "the maximum is recorded"                 "118000000"  "$(cut -f2 "$STATE_DIR/peaks.tsv")"
ck "the up maximum is recorded"              "9000000"    "$(cut -f3 "$STATE_DIR/peaks.tsv")"
ck "the sample count is recorded"            "2"          "$(cut -f4 "$STATE_DIR/peaks.tsv")"
ck "the counters reset for the next round"   "0 0 0"      "$PEAK_D $PEAK_U $PEAK_N"

# ---- 6. a second round inside the same minute merges ------------------------
PEAK_D=1; PEAK_U=2; PEAK_N=3
record_peak
ck "the same minute stays one row"           "1"          "$(wc -l < "$STATE_DIR/peaks.tsv")"
ck "a smaller round does not lower the peak" "118000000"  "$(cut -f2 "$STATE_DIR/peaks.tsv")"
ck "the sample counts add up"                "5"          "$(cut -f4 "$STATE_DIR/peaks.tsv")"

# ---- 7. a larger round in the same minute wins ------------------------------
PEAK_D=999000000; PEAK_U=3; PEAK_N=1
record_peak
ck "a larger round raises the peak"          "999000000"  "$(cut -f2 "$STATE_DIR/peaks.tsv")"
ck "still one row for the minute"            "1"          "$(wc -l < "$STATE_DIR/peaks.tsv")"

# ---- 8. nothing sampled this round writes nothing ---------------------------
PEAK_D=0; PEAK_U=0; PEAK_N=0
record_peak
ck "an unwatched round adds no row"          "1"          "$(wc -l < "$STATE_DIR/peaks.tsv")"

# ---- 9. counters that are not numbers must not poison the bucket ------------
printf '{"at":102,"bps_down":abc,"bps_up":,"source":"conntrack","ready":1,"dt":1}\n' > "$STATE_DIR/live.json"
PEAK_D=0; PEAK_U=0; PEAK_N=0
peak_read
ck "a malformed down reading is refused"     "0"          "$PEAK_D"
ck "and it is not counted as a sample"       "0"          "$PEAK_N"

# ---- 10. the row shape the page and rpcd expect -----------------------------
PEAK_D=7; PEAK_U=8; PEAK_N=9
record_peak
ck "the recorded row has four fields"        "4"          "$(awk -F'\t' 'END{print NF}' "$STATE_DIR/peaks.tsv")"

# ---- 11. an interface sample reaches the peak at the same scale -------------
# live.sh takes its number from the WAN device counters when the collector has
# named one, and this peak is folded from whatever live.sh publishes.  So the
# sampler is run for real here, against a fake /proc/net/dev, and its published
# sample is handed to peak_read: the peak has to come out in the same unit as
# the meter beside it - bytes per second - or the page would show a maximum
# taken from a different scale than the live rate under it.
LIVE="$here/../root/usr/share/traffic/live.sh"
LD="$T/live"
mkdir -p "$LD"
export TRAFFIC_PROC_NET_DEV="$T/netdev"
printf 'Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n  eth2: 1000000 11 0 0 0 0 0 0 2000000 22 0 0 0 0 0 0\n' > "$T/netdev"
cat > "$LD/live.env" <<'EOF'
LAN4=192.168.1.
LAN6=
SELF=192.168.1.1
SOURCE=conntrack
TABLE=inet traffic_acct
WAN_IF=eth2
EOF
# conntrack is left unreachable on purpose: the interface path must not need it
CT="$T/absent-conntrack" STATE_DIR="$LD" sh "$LIVE" --force
printf 'Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n  eth2: 1300000 11 0 0 0 0 0 0 2720000 22 0 0 0 0 0 0\n' > "$T/netdev"
CT="$T/absent-conntrack" STATE_DIR="$LD" sh "$LIVE" --force

STATE_DIR="$LD"
PEAK_D=0; PEAK_U=0; PEAK_N=0
peak_read
ck "an interface sample is counted as a sample" "1" "$PEAK_N"
# The published rate is an integer floor of delta/dt, so the check is the delta
# the peak implies, not an equality that an odd interval would break.
dt=$(sed -n 's/.*"dt":\([0-9]*\).*/\1/p' "$STATE_DIR/live.json")
case "$dt" in ''|*[!0-9]*) dt=1 ;; esac
ck "the peak keeps the interface download rate" "yes" \
	"$([ $((PEAK_D * dt)) -le 300000 ] && [ $((300000 - PEAK_D * dt)) -lt "$dt" ] && echo yes || echo no)"
ck "the peak keeps the interface upload rate" "yes" \
	"$([ $((PEAK_U * dt)) -le 720000 ] && [ $((720000 - PEAK_U * dt)) -lt "$dt" ] && echo yes || echo no)"

# ---- 12. with no override the bucket is the minute the clock was in ---------
# The path the router actually takes: PEAK_AT unset, so the minute comes from
# the clock.  Pinning it everywhere would leave this default untested, and
# reading the clock only afterwards is what made the old section 5 flaky, so
# both minutes the call could have landed in are accepted here.  The assertion
# is then true whichever side of a boundary the call ends up on.
S2="$T/state2"
mkdir -p "$S2"
STATE_DIR="$S2"
PEAK_D=5; PEAK_U=0; PEAK_N=1
unset PEAK_AT
lo=$(( $(date +%s) / 60 * 60 ))
record_peak
hi=$(( $(date +%s) / 60 * 60 ))
got=$(cut -f1 "$S2/peaks.tsv")
if [ "$got" = "$lo" ] || [ "$got" = "$hi" ]; then w=yes; else w=no; fi
ck "with no override the bucket is the minute" "yes" "$w"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
rm -rf "$T"
[ "$fail" -eq 0 ]

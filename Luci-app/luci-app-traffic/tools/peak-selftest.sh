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
SRC="$here/../root/usr/share/traffic/collector.sh"
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
record_peak
b=$(( $(date +%s) / 60 * 60 ))
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

printf '\n%d passed, %d failed\n' "$pass" "$fail"
rm -rf "$T"
[ "$fail" -eq 0 ]

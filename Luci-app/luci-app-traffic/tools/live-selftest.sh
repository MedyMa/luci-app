#!/bin/sh
# Self-test for live.sh - the one-second sampler behind the page's realtime
# rate.  Runs against a stubbed nft and a fake conntrack file, so it needs
# neither a router nor root.
#
#   sh tools/live-selftest.sh
#
# The cases are the ones that decide whether the number on the page is true:
# direction (a swapped pair would show upload as download), a counter that goes
# backwards (a firewall reload restarts the counters at zero), the LAN-prefix
# filter (address prefixes, not interface names - an equality test matches
# nothing and reports a permanent 0 B/s), and the unwatched path (a router
# nobody is looking at must not pay for sampling).
#
# Two mistakes this test made itself, both worth keeping in mind:
#   * it asserted byte deltas as if the interval were always one second.  The
#     published number is a rate over the REAL elapsed time, so on a machine
#     where an invocation takes a second or two the same correct code produced
#     half the expected value.  The assertion now checks bps * dt == delta,
#     which is true whatever the interval was.
#   * it forgot that the watch timestamp expires after LIVE_WATCH_AGE seconds,
#     so every case after the first few read a stale file from the case before
#     it and "passed" or failed for the wrong reason.  Each sample refreshes it.

set -u

here=$(cd "$(dirname "$0")" && pwd)
live="$here/../root/usr/share/traffic/live.sh"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

pass=0; fail=0
ck() { # ck <name> <expected> <actual>
	if [ "$2" = "$3" ]; then pass=$((pass + 1)); printf 'ok   %-46s %s\n' "$1" "$3"
	else fail=$((fail + 1)); printf 'FAIL %-46s expected=%s got=%s\n' "$1" "$2" "$3"; fi
}

export STATE_DIR="$T/state"
mkdir -p "$STATE_DIR" "$T/bin"

# ---- stub nft: prints one counting rule per chain, value read from a file ----
cat > "$T/bin/nft" <<'STUB'
#!/bin/sh
# nft list chain <table> <chain>: the chain is the LAST argument ($3 is the
# table, which is what the first version of this stub got wrong - it matched no
# branch, printed nothing and made every nft case report 0 B/s).
for a in "$@"; do chain=$a; done
v=$(cat "$STATE_DIR/$chain.bytes" 2>/dev/null || echo 0)
case "$chain" in
	pre)  printf 'iifname "br-lan" ip saddr 192.168.1.5 counter packets 1 bytes %s\n' "$v" ;;
	post) printf 'oifname "br-lan" ip daddr 192.168.1.5 counter packets 1 bytes %s\n' "$v" ;;
	*)    exit 1 ;;
esac
STUB
chmod +x "$T/bin/nft"
PATH="$T/bin:$PATH"
export PATH

write_env() { # write_env <source>
	cat > "$STATE_DIR/live.env" <<EOF
LAN4=192.168.1.
LAN6=
SELF=192.168.1.1
SOURCE=$1
TABLE=inet traffic_acct
EOF
}

# Sample the way the collector does, but bypassing the watch gate: the gate is
# exercised on its own below, and every other case must actually run.
run_live() { date +%s > "$STATE_DIR/live.watch"; sh "$live" --force; }

json()  { sed -n 's/.*"bps_down":\([0-9]*\).*/\1/p' "$STATE_DIR/live.json"; }
jsonu() { sed -n 's/.*"bps_up":\([0-9]*\).*/\1/p' "$STATE_DIR/live.json"; }
ready() { sed -n 's/.*"ready":\([0-9]*\).*/\1/p' "$STATE_DIR/live.json"; }
dts()   { sed -n 's/.*"dt":\([0-9]*\).*/\1/p' "$STATE_DIR/live.json"; }

# Assert the interval delta, not the rate: the rate is over whatever the real
# elapsed time turned out to be.  The published rate is an integer, so it is the
# FLOOR of delta/dt and bps*dt is up to dt-1 bytes below the delta - asserting
# equality would fail on any interval that does not divide evenly, which is what
# the first version of this helper did.
ck_delta() { # ck_delta <name> <expected bytes> <down|up>
	if [ "$3" = "up" ]; then v=$(jsonu); else v=$(json); fi
	dt=$(dts)
	got=$((v * dt))
	if [ "$got" -le "$2" ] && [ $(( $2 - got )) -lt "$dt" ]; then
		pass=$((pass + 1)); printf 'ok   %-46s %s (over %ss)\n' "$1" "$2" "$dt"
	else
		fail=$((fail + 1)); printf 'FAIL %-46s expected=%s got=%s\n' "$1" "$2" "$got"
	fi
}

# ---- 1. nobody watching: no sampling, no file ------------------------------
write_env nft
echo 1000 > "$STATE_DIR/pre.bytes"; echo 5000 > "$STATE_DIR/post.bytes"
sh "$live"
ck "unwatched run writes nothing" "no" "$([ -f "$STATE_DIR/live.json" ] && echo yes || echo no)"

# a stale watch timestamp is the same as nobody watching
echo 1 > "$STATE_DIR/live.watch"
sh "$live"
ck "stale watch writes nothing" "no" "$([ -f "$STATE_DIR/live.json" ] && echo yes || echo no)"

# ---- 2. nft path: pre is upload, post is download --------------------------
rm -f "$STATE_DIR/live.cur" "$STATE_DIR/live.json"
echo 1000 > "$STATE_DIR/pre.bytes"; echo 5000 > "$STATE_DIR/post.bytes"
run_live
ck "first nft sample is a baseline, not a rate" "0" "$(ready)"
echo 3000 > "$STATE_DIR/pre.bytes"; echo 9000 > "$STATE_DIR/post.bytes"
run_live
ck_delta "nft download = growth of post" "4000" down
ck_delta "nft upload = growth of pre" "2000" up
ck "nft sample is ready" "1" "$(ready)"

# ---- 3. counters restarted by a firewall reload ----------------------------
echo 10 > "$STATE_DIR/pre.bytes"; echo 20 > "$STATE_DIR/post.bytes"
run_live
ck "counter reset: down is zero, not negative" "0" "$(json)"
ck "counter reset: up is zero, not negative" "0" "$(jsonu)"

# ---- 4. conntrack path -----------------------------------------------------
write_env conntrack
export CT="$T/conntrack"
rm -f "$STATE_DIR/live.cur" "$STATE_DIR/live.json" "$STATE_DIR/live.flows"
# client 192.168.1.5 downloads from 1.2.3.4: b1 = client->remote, b2 = reply
cat > "$CT" <<'EOF'
ipv4 2 tcp 6 100 ESTABLISHED src=192.168.1.5 dst=1.2.3.4 sport=40000 dport=443 packets=10 bytes=1000 src=1.2.3.4 dst=192.168.1.5 sport=443 dport=40000 packets=8 bytes=90000 [ASSURED]
EOF
run_live
ck "first conntrack sample is a baseline" "0" "$(ready)"
cat > "$CT" <<'EOF'
ipv4 2 tcp 6 100 ESTABLISHED src=192.168.1.5 dst=1.2.3.4 sport=40000 dport=443 packets=12 bytes=1500 src=1.2.3.4 dst=192.168.1.5 sport=443 dport=40000 packets=20 bytes=250000 [ASSURED]
EOF
run_live
ck_delta "conntrack download counts reply growth" "160000" down
ck_delta "conntrack upload counts client growth" "500" up
ck "conntrack sample is ready" "1" "$(ready)"

# a flow that disappears between samples must not produce negative traffic
rm -f "$STATE_DIR/live.flows"
: > "$CT"
run_live; run_live
ck "vanished flow: down is zero" "0" "$(json)"
ck "vanished flow: up is zero" "0" "$(jsonu)"

# ---- 5. what must not be counted -------------------------------------------
# Each case asserts BOTH directions, so a filter that is too strict and a filter
# that is too loose cannot both pass: the string-concatenation shortcut used
# first ("0" vs "00") made the assertion unfalsifiable.
rm -f "$STATE_DIR/live.flows"
cat > "$CT" <<'EOF'
ipv4 2 tcp 6 100 ESTABLISHED src=192.168.1.1 dst=9.9.9.9 sport=50000 dport=443 packets=1 bytes=111 src=9.9.9.9 dst=192.168.1.1 sport=443 dport=50000 packets=1 bytes=222 [ASSURED]
EOF
run_live; run_live
ck "router own flow: not counted as down" "0" "$(json)"
ck "router own flow: not counted as up" "0" "$(jsonu)"

rm -f "$STATE_DIR/live.flows"
cat > "$CT" <<'EOF'
ipv4 2 tcp 6 100 ESTABLISHED src=192.168.1.5 dst=192.168.1.9 sport=50000 dport=445 packets=1 bytes=333 src=192.168.1.9 dst=192.168.1.5 sport=445 dport=50000 packets=1 bytes=444 [ASSURED]
EOF
run_live; run_live
ck "LAN-to-LAN: not counted as down" "0" "$(json)"
ck "LAN-to-LAN: not counted as up" "0" "$(jsonu)"

rm -f "$STATE_DIR/live.flows"
cat > "$CT" <<'EOF'
ipv4 2 tcp 6 100 ESTABLISHED src=10.8.0.2 dst=1.2.3.4 sport=50000 dport=443 packets=1 bytes=555 src=1.2.3.4 dst=10.8.0.2 sport=443 dport=50000 packets=1 bytes=666 [ASSURED]
EOF
run_live; run_live
ck "non-LAN client: not counted as down" "0" "$(json)"
ck "non-LAN client: not counted as up" "0" "$(jsonu)"

# ---- 6. a stale pending state file must not replace the baseline ------------
# The awk writes the new flow table to live.flows.new and the script moves it
# over live.flows.  If that move happens when the pending file is empty - the
# awk matched nothing and never wrote to it, or a run was interrupted - the
# baseline becomes empty, and the next sample then finds every live flow unknown
# and credits each one with its whole lifetime.  An unknown flow is given its
# full count on purpose, so a short-lived flow is not lost; against a wiped
# baseline that turns every established flow into a spike.  This is the case
# with the stale file present, which is the only way the guard can be shown to
# do anything.
rm -f "$STATE_DIR/live.flows" "$STATE_DIR/live.flows.new"
cat > "$CT" <<'EOF'
ipv4 2 tcp 6 100 ESTABLISHED src=192.168.1.5 dst=1.2.3.4 sport=40000 dport=443 packets=12 bytes=1500 src=1.2.3.4 dst=192.168.1.5 sport=443 dport=40000 packets=20 bytes=250000 [ASSURED]
EOF
run_live
ck "stale-pending case: baseline first" "0" "$(ready)"

# a sample that matches nothing, with an empty pending file already lying there
: > "$STATE_DIR/live.flows.new"
: > "$CT"
run_live
ck "an empty sample still reports zero, not unknown" "1" "$(ready)"
ck "an empty sample reports no traffic" "0" "$(json)"
ck "the stale pending file is gone" "absent" "$([ -e "$STATE_DIR/live.flows.new" ] && echo present || echo absent)"

# the same flow returns, having grown by 500 up and 160000 down
cat > "$CT" <<'EOF'
ipv4 2 tcp 6 100 ESTABLISHED src=192.168.1.5 dst=1.2.3.4 sport=40000 dport=443 packets=15 bytes=2000 src=1.2.3.4 dst=192.168.1.5 sport=443 dport=40000 packets=25 bytes=410000 [ASSURED]
EOF
run_live
ck_delta "baseline survives an empty sample" "160000" down
ck_delta "baseline survives an empty sample (up)" "500" up

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]

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

# write_env <source> [wan_if]: WAN_IF is always written, empty when the
# collector could not identify a WAN device - which is the signal to fall back.
write_env() {
	cat > "$STATE_DIR/live.env" <<EOF
LAN4=192.168.1.
LAN6=
SELF=192.168.1.1
SOURCE=$1
TABLE=inet traffic_acct
WAN_IF=${2:-}
EOF
}

# Sample the way the collector does, but bypassing the watch gate: the gate is
# exercised on its own below, and every other case must actually run.
run_live() { date +%s > "$STATE_DIR/live.watch"; sh "$live" --force; }

json()  { sed -n 's/.*"bps_down":\([0-9]*\).*/\1/p' "$STATE_DIR/live.json"; }
jsonu() { sed -n 's/.*"bps_up":\([0-9]*\).*/\1/p' "$STATE_DIR/live.json"; }
ready() { sed -n 's/.*"ready":\([0-9]*\).*/\1/p' "$STATE_DIR/live.json"; }
dts()   { sed -n 's/.*"dt":\([0-9]*\).*/\1/p' "$STATE_DIR/live.json"; }
src()   { sed -n 's/.*"source":"\([^"]*\)".*/\1/p' "$STATE_DIR/live.json"; }

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

# ---- 7. the WAN device counters are the authoritative source ----------------
# With flow offloading on, both counter layers the script used to read are
# bypassed: measured on a real router, conntrack had seen 147 MiB in the window
# in which the WAN device carried 2579 MiB (5.7%).  The device counters live in
# the driver, below the fast path, so when the collector has named a WAN device
# the meter reads that device.  TRAFFIC_PROC_NET_DEV points the reader at a fake
# table, which is how this suite stays off a real router.
export TRAFFIC_PROC_NET_DEV="$T/netdev"

netdev() { # netdev <rx> <tx>
	cat > "$T/netdev" <<EOF
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
  eth2: $1 11 0 0 0 0 0 0 $2 22 0 0 0 0 0 0
 br-lan: 999 1 0 0 0 0 0 0 888 1 0 0 0 0 0 0
EOF
}

# The nft counters move in the same window, and deliberately by a DIFFERENT
# amount: a fallback to them must not be mistakable for the interface answer.
write_env nft eth2
rm -f "$STATE_DIR/live.wan" "$STATE_DIR/live.cur" "$STATE_DIR/live.json" "$STATE_DIR/live.flows"
echo 1000 > "$STATE_DIR/pre.bytes"; echo 5000 > "$STATE_DIR/post.bytes"
netdev 1000000 2000000
# Baselines left over from the counter layers, from before the interface path
# took over.  If either survived the interface era, the first sample after the
# device disappeared would measure the whole gap as one interval: conntrack
# would find every established flow unknown and credit each one with its whole
# lifetime, and the absolute nft counters would report everything the table had
# gained meanwhile.  Either way it is a spike, and it would become the peak.
printf 'stale\t1\t2\n' > "$STATE_DIR/live.flows"
printf '1\t2\n' > "$STATE_DIR/live.cur"
run_live
ck "device baseline: source is the interface" "iface" "$(src)"
ck "device baseline: not a rate yet"          "0"     "$(ready)"
if [ -e "$STATE_DIR/live.flows" ] || [ -e "$STATE_DIR/live.cur" ]; then stale=present; else stale=absent; fi
ck "device baseline: stale counter baselines dropped" "absent" "$stale"

netdev 1300000 2700000
echo 2000 > "$STATE_DIR/pre.bytes"; echo 9000 > "$STATE_DIR/post.bytes"
run_live
ck_delta "device download = rx growth"        "300000" down
ck_delta "device upload = tx growth"          "700000" up
ck "device sample: source is the interface"   "iface"  "$(src)"
ck "device sample is ready"                   "1"      "$(ready)"

# ---- 8. a device that was recreated restarted its counters ------------------
# The same case as the nft counter reset above, from the other source: the
# absolute reading goes backwards, and negative traffic is not a reading.
netdev 1000 2000
echo 12000 > "$STATE_DIR/pre.bytes"; echo 19000 > "$STATE_DIR/post.bytes"
run_live
ck "device restart: down is zero, not negative" "0" "$(json)"
ck "device restart: up is zero, not negative"   "0" "$(jsonu)"
ck "device restart: still the interface"        "iface" "$(src)"

# ---- 9. the interface answer does not depend on a counter layer -------------
# Neither nft nor conntrack can be reached here, and the meter must still
# report: that is the whole point of reading a layer that offloading cannot
# bypass.  The stale ready:1 placeholder is written first so a run that falls
# back and publishes nothing cannot be read as a pass.
write_env conntrack eth2
export CT="$T/absent-conntrack"
rm -f "$STATE_DIR/live.wan" "$STATE_DIR/live.cur"
printf '{"at":0,"bps_down":1,"bps_up":1,"source":"conntrack","ready":1,"dt":1}\n' > "$STATE_DIR/live.json"
netdev 5000000 6000000
run_live
netdev 5123456 6654321
run_live
ck "interface source does not need conntrack" "iface"  "$(src)"
ck_delta "interface download without conntrack" "123456" down
ck_delta "interface upload without conntrack"   "654321" up

# ---- 10. the device can be absent while the collector still names one -------
# A WAN that is down, or a name the collector derived from a route that has
# since gone: the description in live.env is not re-checked, so the reader has
# to notice and fall back to the old path on its own.
write_env conntrack eth2
export CT="$T/conntrack"
rm -f "$STATE_DIR/live.flows" "$STATE_DIR/live.wan"
cat > "$T/netdev" <<'EOF'
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
 br-lan: 999 1 0 0 0 0 0 0 888 1 0 0 0 0 0 0
EOF
cat > "$CT" <<'EOF'
ipv4 2 tcp 6 100 ESTABLISHED src=192.168.1.5 dst=1.2.3.4 sport=41000 dport=443 packets=3 bytes=700 src=1.2.3.4 dst=192.168.1.5 sport=443 dport=41000 packets=4 bytes=99000 [ASSURED]
EOF
run_live
ck "absent device: first sample is a baseline" "0"         "$(ready)"
ck "absent device: source is conntrack"        "conntrack" "$(src)"
cat > "$CT" <<'EOF'
ipv4 2 tcp 6 100 ESTABLISHED src=192.168.1.5 dst=1.2.3.4 sport=41000 dport=443 packets=3 bytes=1200 src=1.2.3.4 dst=192.168.1.5 sport=443 dport=41000 packets=4 bytes=199000 [ASSURED]
EOF
run_live
ck_delta "absent device: conntrack still counts down" "100000" down
ck_delta "absent device: conntrack still counts up"   "500"    up
ck "absent device: source stays conntrack"            "conntrack" "$(src)"
ck "absent device: no interface state written"        "absent" "$([ -e "$STATE_DIR/live.wan" ] && echo present || echo absent)"

# ---- 11. an empty WAN_IF is the old behaviour, unchanged --------------------
write_env conntrack
rm -f "$STATE_DIR/live.flows" "$STATE_DIR/live.wan" "$STATE_DIR/live.json"
cat > "$CT" <<'EOF'
ipv4 2 tcp 6 100 ESTABLISHED src=192.168.1.5 dst=1.2.3.4 sport=42000 dport=443 packets=3 bytes=800 src=1.2.3.4 dst=192.168.1.5 sport=443 dport=42000 packets=4 bytes=50000 [ASSURED]
EOF
run_live
cat > "$CT" <<'EOF'
ipv4 2 tcp 6 100 ESTABLISHED src=192.168.1.5 dst=1.2.3.4 sport=42000 dport=443 packets=3 bytes=1300 src=1.2.3.4 dst=192.168.1.5 sport=443 dport=42000 packets=4 bytes=150000 [ASSURED]
EOF
run_live
ck_delta "empty WAN_IF: conntrack download" "100000" down
ck_delta "empty WAN_IF: conntrack upload"   "500"    up
ck "empty WAN_IF: source is conntrack"      "conntrack" "$(src)"
ck "empty WAN_IF: no interface state"       "absent" "$([ -e "$STATE_DIR/live.wan" ] && echo present || echo absent)"

# ---- 12. a missing state file must not log ---------------------------------
# The reads were left to fail on their own, and the shell reports a failed
# redirection itself, so the 2>/dev/null beside them never silenced it.  These
# run every second, and the files do not exist until rpcd has been polled once,
# so a router with the page closed wrote a line a second about nothing - the
# same class of noise already fixed in the collector.
rm -f "$STATE_DIR/live.watch"
err=$(sh "$live" 2>&1 >/dev/null)
ck "no watch file: nothing on stderr" "" "$err"
rm -f "$STATE_DIR/live.at"
err=$(sh "$live" --force 2>&1 >/dev/null)
ck "no timestamp file: nothing on stderr" "" "$err"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]

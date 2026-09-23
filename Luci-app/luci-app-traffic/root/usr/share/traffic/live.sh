#!/bin/sh
# One-second traffic sample for the page's realtime meter.
#
# The page used to work its rate out from two summary snapshots, so the fastest
# it could ever move was the collector interval - ten seconds.  This is the fast
# path: it reads the same counters the collector reads and publishes how many
# bytes moved since the previous second.  It is a read-only observer - it does
# not touch the collector totals, history or attribution - so the number it
# reports is the same quantity as the one in the summary, sampled ten times
# more often.
#
# Two things are easy to get wrong here, and both were wrong in the first
# version of this file:
#
#  1. Do not diff two absolute totals on the conntrack path.  The only number
#     available there is the byte count of each live flow, and that total FALLS
#     whenever a connection closes, so subtracting two totals both invents
#     negative traffic and loses the last burst of every flow that ends between
#     the samples.  Each flow is compared against its own previous value
#     instead, and only the growth is counted - the same technique the
#     collector uses, and the reason its totals only ever go up.
#  2. Do not subtract a running total from an interval delta.  The conntrack
#     path already produces a delta; diffing it again against the published
#     total halved the number in a way that still looked plausible.  Both paths
#     therefore report an interval delta, and the only arithmetic left here is
#     dividing by the elapsed time.
#
# The source of the number is chosen per tick, not per build.  When the
# collector has identified the WAN device, this reads that device's own counters
# in /proc/net/dev: they sit in the driver, below the fast path a firewall takes
# when flow offloading is on, so they count every byte whether or not offloading
# is enabled.  Measured on a real router with flow_offloading=1, the conntrack
# layer had seen 147 MiB in the window in which the WAN device carried 2579 MiB
# (5.7%) - and a peak taken from a layer that blind is a peak of the wrong
# quantity.  When there is no WAN device to read, the conntrack/nft paths below
# are unchanged and still in charge.
#
# Cost control: the page tells rpcd it is open by polling getLive, and rpcd
# writes that timestamp here.  Without a fresh timestamp this script exits after
# two stat() calls, so a router nobody is watching pays nothing.
#
# The window is 60 seconds, not the 10 it started with.  A browser throttles the
# timers of a tab that is not in the foreground - down to about one call a
# minute - so a 10-second window meant that looking at another window for a
# moment stopped the sampling, and the meter then looked broken rather than
# merely idle.
#
# Usage: live.sh          -> writes $STATE_DIR/live.json when it can
#        live.sh --force  -> sample even when nobody is watching (used by tests)

STATE_DIR=${STATE_DIR:-/tmp/traffic}
CT=${CT:-/proc/net/nf_conntrack}
# Where the authoritative device counters come from.  Overridable so the offline
# suite can drive the interface path against a file it owns, with no device and
# no root - the same reason CT is a variable.  The environment wins over the
# config, which is the convention the collector's own detection is written to.
NETDEV=${TRAFFIC_PROC_NET_DEV:-/proc/net/dev}
WATCH="$STATE_DIR/live.watch"
ENVF="$STATE_DIR/live.env"
STATE="$STATE_DIR/live.flows"
AT="$STATE_DIR/live.at"
CUR="$STATE_DIR/live.cur"
# The previous absolute reading of the WAN device, one line per direction.  It
# is not the collector's wan.abs: this runs ten times as often as the collector,
# and two writers on one baseline would hand each other a delta covering the
# wrong interval.
WANABS="$STATE_DIR/live.wan"
OUT="$STATE_DIR/live.json"
WATCH_AGE=${LIVE_WATCH_AGE:-60}

force=0
[ "${1:-}" = "--force" ] && force=1

now=$(date +%s 2>/dev/null || echo 0)
case "$now" in ''|*[!0-9]*) now=0 ;; esac

if [ "$force" != "1" ]; then
	seen=
	# Tested before the read, not left to the redirect: a failed redirection is
	# reported by the shell itself, so the 2>/dev/null beside the read does not
	# silence it, and this runs once a second.  The file only exists after rpcd
	# has been polled once, so a router with the page closed would log a line a
	# second about nothing.
	[ -r "$WATCH" ] && read -r seen < "$WATCH"
	case "$seen" in ''|*[!0-9]*) seen=0 ;; esac
	# nobody is looking, so there is nothing to publish
	[ "$now" -gt 0 ] && [ $((now - seen)) -le "$WATCH_AGE" ] || exit 0
fi

# What the collector detected on its last round: the LAN prefixes, the router
# addresses, which counter layer is authoritative and which device the WAN
# actually is.  The collector writes this because the detection is not trivial
# (it reads the network config, the bridge layout and the firewall), and a
# second copy of it would drift away from the first.
[ -f "$ENVF" ] || exit 0
# One pass over the file instead of six sed+head pairs, which matters here
# because this runs once a second and every process spawn is charged to the tick
# that the meter is timed against.  publish_live_env writes each key exactly
# once.  SELF holds a space-separated address list, and it survives because the
# separator below is `=` alone.
LAN4=; LAN6=; SELF=; SOURCE=; TABLE=; WAN_IF=
while IFS='=' read -r key value; do
	case "$key" in
	LAN4)   LAN4=$value ;;
	LAN6)   LAN6=$value ;;
	SELF)   SELF=$value ;;
	SOURCE) SOURCE=$value ;;
	TABLE)  TABLE=$value ;;
	WAN_IF) WAN_IF=$value ;;
	esac
done < "$ENVF"
TABLE=${TABLE:-inet traffic_acct}

# ---------------------------------------------------------- device counters
# The preferred source: the WAN device's own counters.  They are read in the
# driver, below the forwarding fast path, so they keep counting while flow
# offloading hands established flows past netfilter entirely - measured on a
# real router, conntrack had seen 147 MiB in the window in which the WAN device
# carried 2579 MiB.  rx is what the device received (download) and tx is what it
# sent (upload), and the caller divides the delta by the real elapsed time
# exactly as it does for the other two paths.
sample_iface() {
	[ -n "$WAN_IF" ] || return 1
	[ -r "$NETDEV" ] || return 1
	local cur rx tx prx ptx dd du
	# Field 1 is the device name with its colon, field 2 is rx_bytes and field
	# 10 is tx_bytes.  No match means the device is not in the table at all - a
	# WAN that is down, or a name the collector derived from a route that has
	# since gone - and the caller falls back to a counter layer instead.
	cur=$(awk -v dev="$WAN_IF" '
		$1 == dev ":" { print $2 "\t" $10; found = 1; exit }
		END { if (!found) exit 1 }' "$NETDEV" 2>/dev/null) || return 1
	rx=; tx=
	read -r rx tx <<EOF
$cur
EOF
	# A reading that is not a number is a broken file, not traffic: refuse it
	# rather than publish something computed from nothing.
	case "$rx" in ''|*[!0-9]*) return 1 ;; esac
	case "$tx" in ''|*[!0-9]*) return 1 ;; esac
	# Two lines, read with two reads rather than with a literal tab in a
	# pattern - a tab in this file is exactly what an editor turns into spaces
	# without anyone noticing.
	prx=; ptx=
	if [ -s "$WANABS" ]; then
		{
			read -r prx
			read -r ptx
		} < "$WANABS"
	fi
	# These are absolute counters since the device came up, so the delta is
	# this interval and the file holds the latest reading rather than a sum.
	# Atomic, like every other file written here: an interrupted sample must
	# not leave half a baseline behind.
	printf '%s\n%s\n' "$rx" "$tx" > "$WANABS.new" && mv -f "$WANABS.new" "$WANABS"
	case "$prx" in ''|*[!0-9]*) prx= ;; esac
	case "$ptx" in ''|*[!0-9]*) ptx= ;; esac
	# No usable previous reading means this sample only establishes the
	# baseline, the same first-sample rule the other two paths follow.
	[ -n "$prx" ] && [ -n "$ptx" ] || { printf '0\t0\t0\n'; return 0; }
	dd=$((rx - prx)); du=$((tx - ptx))
	# The device was recreated (a pppoe session torn down and rebuilt, a veth
	# replaced) and its counters restarted at zero.  Negative traffic is not a
	# reading.
	[ "$dd" -lt 0 ] && dd=0
	[ "$du" -lt 0 ] && du=0
	printf '1\t%s\t%s\n' "$dd" "$du"
}

# ---------------------------------------------------------------- nft counters
# One counter per client per direction, so these are absolute counters since the
# rules were created.  A firewall reload wipes the table and they restart at
# zero; a negative delta means exactly that, and zero is reported rather than
# negative traffic.
nft_sum() { # nft_sum <chain>
	nft list chain $TABLE "$1" 2>/dev/null | awk '
		{ for (i = 1; i <= NF; i++) if ($i == "bytes") s += $(i + 1) }
		END { print s + 0 }'
}

sample_nft() {
	local pre post prev pd pu dd du
	pre=$(nft_sum pre); post=$(nft_sum post)          # pre is upload, post is down
	[ -n "$pre" ] && [ -n "$post" ] || return 1
	prev=$(cat "$CUR" 2>/dev/null)
	pd=$(printf '%s\n' "$prev" | awk -F'\t' '{ print $1 + 0 }')
	pu=$(printf '%s\n' "$prev" | awk -F'\t' '{ print $2 + 0 }')
	printf '%s\t%s\n' "$post" "$pre" > "$CUR.new" && mv -f "$CUR.new" "$CUR"
	# No previous value means this sample only establishes the baseline.
	[ -n "$prev" ] || { printf '0\t0\t0\n'; return 0; }
	dd=$((post - pd)); du=$((pre - pu))
	[ "$dd" -lt 0 ] && dd=0
	[ "$du" -lt 0 ] && du=0
	printf '1\t%s\t%s\n' "$dd" "$du"
}

# ---------------------------------------------------------- conntrack counters
# Every flow keeps its own previous pair, so a flow that ends between two
# samples contributes the bytes it gained while it was alive.
sample_ct() {
	[ -r "$CT" ] || return 1
	local first=0 cur
	# With no state file yet every flow would look brand new and its entire
	# byte count would be reported as one second of traffic - a spike that is
	# pure fiction on a busy router.  The first sample only writes the baseline.
	[ -s "$STATE" ] || first=1
	cur=$(awk -v state="$STATE" -v newst="$STATE_DIR/live.flows.new" \
	    -v lan4="$LAN4" -v lan6="$LAN6" -v selfip="$SELF" '
	# CFG_LAN4/CFG_LAN6 are address PREFIXES ("192.168.1." with the trailing
	# dot), not interface names, and the collector tests them with
	# index(a, lan4) == 1.  Comparing them for equality - which the first
	# version of this script did - matches nothing and reports a permanent
	# 0 B/s.
	# NOTE: no apostrophes in any comment inside this program.  The awk body is
	# a single-quoted shell string, so one apostrophe ends it and the whole
	# script fails to parse - which is exactly what happened first.
	function is_lan(a) {
		return (lan4 != "" && index(a, lan4) == 1) || (lan6 != "" && index(a, lan6) == 1)
	}
	BEGIN {
		n = split(selfip, sp, " ")
		for (i = 1; i <= n; i++) if (sp[i] != "") isself[sp[i]] = 1
		while ((getline l < state) > 0) {
			split(l, f, "\t")
			if (f[1] != "") prev[f[1]] = f[2] + 0 " " f[3] + 0
		}
		close(state)
	}
	{
		src = ""; dst = ""; sport = ""; dport = ""; np = 0; b1 = 0; b2 = 0
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
		# a flow between two LAN hosts is not internet traffic
		if (is_lan(src) && is_lan(dst)) next
		# direction: the bytes a client sent are up, what it received is down.
		# The second bytes= is the reply direction, so it belongs to the other
		# side.  A flow whose client end is the router address itself is not
		# client traffic - the same rule the collector applies.
		up = 0; down = 0
		if (is_lan(src) && !(src in isself)) { up = b1; down = b2 }
		else if (is_lan(dst) && !(dst in isself)) { down = b1; up = b2 }
		else next
		key = $1 "|" $3 "|" src "|" sport "|" dst "|" dport
		if (!(key in seen)) { seen[key] = 1; keys[++nk] = key }
		cu[key] = up; cd[key] = down
	}
	END {
		for (i = 1; i <= nk; i++) {
			k = keys[i]; pu = 0; pd = 0
			if (k in prev) { split(prev[k], q, " "); pu = q[1] + 0; pd = q[2] + 0 }
			du = cu[k] - pu; dd = cd[k] - pd
			if (du < 0) du = cu[k]          # the entry was recreated
			if (dd < 0) dd = cd[k]
			tu += du; td += dd
			# Keep decimal byte counters; awk print may use scientific notation.
			printf "%s\t%.0f\t%.0f\n", k, cu[k], cd[k] > newst
		}
		# How many flows were matched, first, because the caller has to know
		# whether this sample is worth keeping as a baseline.
		printf "%d\t%.0f\t%.0f\n", nk, td, tu
	}' "$CT" 2>/dev/null)
	# A sample that matched no flow at all must NOT replace the baseline with an
	# empty file.  The next sample would then see every live flow as new, and an
	# unknown flow is credited its whole lifetime - which is deliberate, because
	# that is what keeps a short-lived flow's bytes from being lost.  Against a
	# wiped baseline it turns every established flow into one, and the meter
	# jumps: a run of 0 B/s followed by 11 MB/s on a router doing 1 MB/s is that
	# signature, and it is a reading, not traffic.
	match=; td=; tu=
	read -r match td tu <<EOF
$cur
EOF
	case "$match" in ''|*[!0-9]*) match=0 ;; esac
	case "$td"    in ''|*[!0-9]*) td=0    ;; esac
	case "$tu"    in ''|*[!0-9]*) tu=0    ;; esac
	if [ "$match" -gt 0 ]; then
		[ -f "$STATE_DIR/live.flows.new" ] && mv -f "$STATE_DIR/live.flows.new" "$STATE"
	else
		rm -f "$STATE_DIR/live.flows.new"
	fi
	[ -n "$cur" ] || return 1
	[ "$first" = "1" ] && { printf '0\t0\t0\n'; return 0; }
	printf '1\t%s\t%s\n' "$td" "$tu"
}

# The interface counters are the authoritative source whenever the collector has
# identified a WAN device, so they are tried first and a counter layer is the
# fallback.  Both counter-layer baselines are dropped while this path is in
# charge.  Left alone they would age for as long as the interface stays usable,
# and the first sample after the device goes away would measure the whole gap as
# one interval: conntrack would find every established flow unknown and credit
# each one with its whole lifetime, and the absolute nft counters would report
# everything the table gained meanwhile - the same fictional spike from either
# side.  Dropping them makes that first fallback sample a baseline instead, the
# rule the guard in sample_ct above already follows for a first sample.
if cur=$(sample_iface); then
	SRC=iface
	[ -e "$STATE" ] && rm -f "$STATE"
	[ -e "$CUR" ] && rm -f "$CUR"
elif [ "$SOURCE" = "nft" ]; then
	SRC=$SOURCE
	cur=$(sample_nft) || exit 0
else
	SRC=$SOURCE
	cur=$(sample_ct) || exit 0
fi
[ -n "$cur" ] || exit 0

# ready / down / up, parsed by the shell rather than by three more awk
# processes.  The separator is a tab and every value is an integer, so the
# default IFS is already the right one - which is also why no literal tab is
# written here: a tab in a pattern is exactly what an editor turns into spaces
# without anyone noticing.  A here-document does not word-split, so the tabs
# reach `read` intact.  The non-numeric guards replace the `+ 0` the awk did.
ready=; down=; up=
read -r ready down up <<EOF
$cur
EOF
case "$ready" in ''|*[!0-9]*) ready=0 ;; esac
case "$down"  in ''|*[!0-9]*) down=0  ;; esac
case "$up"    in ''|*[!0-9]*) up=0    ;; esac

# The bytes were counted over however long it has been since the previous
# sample, which is a second only when nothing delayed the tick; dividing by the
# real elapsed time is what keeps a slow round from inflating the rate.
prev_at=
# Tested before the read for the same reason as the watch file above: this runs
# once a second and the first tick has no file yet.
[ -r "$AT" ] && read -r prev_at < "$AT"
case "$prev_at" in ''|*[!0-9]*) prev_at=0 ;; esac
printf '%s\n' "$now" > "$AT.new" && mv -f "$AT.new" "$AT"
dt=$((now - prev_at))
[ "$dt" -lt 1 ] && dt=1

if [ "$ready" != "1" ]; then
	printf '{"at":%s,"bps_down":0,"bps_up":0,"source":"%s","ready":0}\n' "$now" "$SRC" > "$OUT.new" \
		&& mv -f "$OUT.new" "$OUT"
	exit 0
fi

# Bytes in the interval divided by the seconds in it, as integers: the page
# formats them, so the two cannot disagree about what the number means.  The
# unit does not depend on which source produced the delta: all three report
# bytes since the previous sample.
printf '{"at":%s,"bps_down":%s,"bps_up":%s,"source":"%s","ready":1,"dt":%s}\n' \
	"$now" "$((down / dt))" "$((up / dt))" "$SRC" "$dt" > "$OUT.new" \
	&& mv -f "$OUT.new" "$OUT"
exit 0

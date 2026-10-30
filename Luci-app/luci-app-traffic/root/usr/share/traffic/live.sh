#!/bin/sh
# Passive WAN bytes/packets sampled by one procd worker while getLive is watched.
# Rates use actual monotonic elapsed time. Device changes, counter resets and
# delayed samples establish a new baseline and leave gaps in a five-minute RAM
# series. Interface traffic, application attribution and NPU busy time have
# separate sources; this sampler never updates application totals or MIBs.
#
# The default WAN-only mode performs no full CT/nft scan. An explicit
# TRAFFIC_LIVE_WAN_ONLY=0 retains the old CLI fallback for compatibility tests.
# live.sh --force bypasses the watch gate for offline counter fixtures.

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
UPTIME=${TRAFFIC_PROC_UPTIME:-/proc/uptime}
SYSNET=${TRAFFIC_SYS_CLASS_NET:-/sys/class/net}

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

mono=$(awk '{ printf "%.0f", $1 * 1000; exit }' "$UPTIME" 2>/dev/null)
case "$mono" in ''|*[!0-9]*) exit 0 ;; esac

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
case "$WAN_IF" in *[!a-zA-Z0-9_.:@-]*) WAN_IF= ;; esac

# ---------------------------------------------------------- device counters
# The preferred source: the WAN device's own counters.  They are read in the
# driver, below the forwarding fast path, so they keep counting while flow
# offloading hands established flows past netfilter entirely - measured on a
# real router, conntrack had seen 147 MiB in the window in which the WAN device
# carried 2579 MiB.  rx is what the device received (download) and tx is what it
# sent (upload), and the caller divides the delta by the real elapsed time
# exactly as it does for the other two paths.
sample_iface() {
	[ -n "$WAN_IF" ] && [ -r "$NETDEV" ] || return 1
	case "$WAN_IF" in *[!a-zA-Z0-9_.:@-]*) return 1 ;; esac
	local cur rx tx rp tp prx ptx prp ptp dev_before mono_before dt_ms identity ifindex
	cur=$(awk -v dev="$WAN_IF" '
		$1 == dev ":" { print $2, $10, $3, $11; found = 1; exit }
		END { if (!found) exit 1 }' "$NETDEV" 2>/dev/null) || return 1
	read -r rx tx rp tp <<EOF
$cur
EOF
	for value in "$rx" "$tx" "$rp" "$tp"; do
		case "$value" in ''|*[!0-9]*) return 1 ;; esac
	done
	ifindex=
	[ -r "$SYSNET/$WAN_IF/ifindex" ] && read -r ifindex < "$SYSNET/$WAN_IF/ifindex"
	case "$ifindex" in *[!0-9]*) ifindex= ;; esac
	identity="$WAN_IF:$ifindex"
	prx=; ptx=; prp=; ptp=; dev_before=; mono_before=
	if [ -r "$WANABS" ]; then
		{ read -r prx; read -r ptx; read -r prp; read -r ptp;
		  read -r dev_before; read -r mono_before; } < "$WANABS"
	fi
	printf '%s\n' "$rx" "$tx" "$rp" "$tp" "$identity" "$mono" > "$WANABS.new" &&
		mv -f "$WANABS.new" "$WANABS"
	for value in "$prx" "$ptx" "$prp" "$ptp" "$mono_before"; do
		case "$value" in ''|*[!0-9]*) printf '0 0 0 0 0 0\n'; return 0 ;; esac
	done
	dt_ms=$((mono - mono_before))
	# A source change, reset or delayed sampler establishes a new baseline.
	# Averages across an unobserved gap are not one-second observations.
	if [ "$identity" != "$dev_before" ] || [ "$dt_ms" -le 0 ] || [ "$dt_ms" -gt 2500 ] ||
	   [ "$rx" -lt "$prx" ] || [ "$tx" -lt "$ptx" ] ||
	   [ "$rp" -lt "$prp" ] || [ "$tp" -lt "$ptp" ]; then
		printf '0 0 0 0 0 0\n'
	else
		printf '1 %s %s %s %s %s\n' "$((rx-prx))" "$((tx-ptx))" \
			"$((rp-prp))" "$((tp-ptp))" "$dt_ms"
	fi
}

# ---------------------------------------------------------------- nft counters
# One counter per client per direction, so these are absolute counters since the
# rules were created.  A firewall reload wipes the table and they restart at
# zero; a negative delta means exactly that, and zero is reported rather than
# negative traffic.
nft_sum() { # nft_sum <chain>
	local snapshot
	command -v timeout >/dev/null 2>&1 || return 1
	# A failed/partial read is unavailable, not a new counter value of zero.
	# Keep the old baseline so recovery spans the whole missed interval.
	snapshot=$(timeout 2 nft list chain $TABLE "$1" 2>/dev/null) || return 1
	printf '%s\n' "$snapshot" | awk '
		{ for (i = 1; i <= NF; i++) if ($i == "bytes") s += $(i + 1) }
		END { print s + 0 }'
}

sample_nft() {
	local pre post prev pd pu dd du
	pre=$(nft_sum pre) || return 1                  # pre is upload, post is down
	post=$(nft_sum post) || return 1
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
		nt = 0; tb1 = 0; tb2 = 0; badtotal = 0
		for (i = 1; i <= NF; i++) {
			t = $i
			if      (t ~ /^src=/)   { if (src   == "") src   = substr(t, 5) }
			else if (t ~ /^dst=/)   { if (dst   == "") dst   = substr(t, 5) }
			else if (t ~ /^sport=/) { if (sport == "") sport = substr(t, 7) }
			else if (t ~ /^dport=/) { if (dport == "") dport = substr(t, 7) }
			else if (t ~ /^bytes=/) { np++; if (np == 1) b1 = substr(t, 7) + 0
			                          else if (np == 2) b2 = substr(t, 7) + 0 }
			else if (t ~ /^bytes_total=/) {
				nt++
				if (t !~ /^bytes_total=[0-9]+$/) badtotal = 1
				else if (nt == 1) tb1 = substr(t, 13) + 0
				else if (nt == 2) tb2 = substr(t, 13) + 0
			}
		}
		if (src == "" || dst == "") next
		# The optional lifetime pair is not cleared by nlbwmon. Kernels
		# without it continue to supply the original resettable counters.
		if (nt == 2 && !badtotal) { b1 = tb1; b2 = tb2 }
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

# The realtime service measures WAN counters. Legacy CLI fallback remains
# available for compatibility, but the service never scans conntrack each second.
if cur=$(sample_iface); then
	SRC=iface
	[ ! -e "$STATE" ] || rm -f "$STATE"
	[ ! -e "$CUR" ] || rm -f "$CUR"
elif [ "${TRAFFIC_LIVE_WAN_ONLY:-1}" = 1 ]; then
	SRC=unavailable
	cur='0 0 0'
elif [ "$SOURCE" = nft ]; then
	SRC=nft
	cur=$(sample_nft) || cur='0 0 0'
else
	SRC=conntrack
	cur=$(sample_ct) || cur='0 0 0'
fi
ready=0; down=0; up=0; pd=; pu=; dt_ms=
read -r ready down up pd pu dt_ms <<EOF
$cur
EOF
prev_at=
[ -r "$AT" ] && read -r prev_at < "$AT"
case "$prev_at" in ''|*[!0-9]*) prev_at=$now ;; esac
printf '%s\n' "$now" > "$AT.new" && mv -f "$AT.new" "$AT"
if [ -z "$dt_ms" ]; then
	dt_ms=$(((now - prev_at) * 1000))
	[ "$dt_ms" -gt 0 ] || dt_ms=1000
fi
# One bounded RAM history, shared by every browser. nulls are real gaps.
awk -v state="$STATE_DIR/live.series" -v next_state="$STATE_DIR/live.series.new" \
    -v out="$OUT.new" -v at="$now" -v mono="$mono" -v ready="$ready" \
    -v down="$down" -v up="$up" -v pd="$pd" -v pu="$pu" -v dt="$dt_ms" \
    -v source="$SRC" -v dev="$WAN_IF" '
function nonnegative(x) { return x ~ /^[0-9]+$/ }
BEGIN {
    while ((getline line < state) > 0) {
        n=split(line,f,"\t")
        if (n==6 && nonnegative(f[1]) && f[1]+0>mono-300000 && f[1]+0<mono) {
            for (j=1;j<=6;j++) old[++nf]=f[j]
            count++
        }
    }
    close(state)
    if (count>300) { drop=count-300; count=300 } else drop=0
    valid=ready==1 && nonnegative(down) && nonnegative(up) && dt>0
    d=valid ? int(down*1000/dt) : "-"; u=valid ? int(up*1000/dt) : "-"
    pdown=valid && nonnegative(pd) ? int(pd*1000/dt) : "-"
    pup=valid && nonnegative(pu) ? int(pu*1000/dt) : "-"
    series=""; sep=""; peakd=0; peaku=0; sumd=0; sumu=0; duration=0
    for (i=drop+1;i<=count+drop+1;i++) {
        if (i<=count+drop) {
            k=(i-1)*6; t=old[k+1]; vd=old[k+2]; vu=old[k+3]
            vpd=old[k+4]; vpu=old[k+5]; span=old[k+6]
        } else { t=mono; vd=d; vu=u; vpd=pdown; vpu=pup; span=valid ? dt : 0 }
        printf "%s\t%s\t%s\t%s\t%s\t%s\n",t,vd,vu,vpd,vpu,span > next_state
        series=series sep "[" t "," (vd=="-"?"null":vd) "," (vu=="-"?"null":vu) "," (vpd=="-"?"null":vpd) "," (vpu=="-"?"null":vpu) "]"; sep=","
        if (vd!="-" && vu!="-" && span>0) {
            if (vd>peakd) peakd=vd; if(vu>peaku) peaku=vu
            sumd+=vd*span; sumu+=vu*span; duration+=span
        }
    }
    close(next_state)
    printf "{\"at\":%.0f,\"monotonic_ms\":%.0f,\"ready\":%d,\"bps_down\":%.0f,\"bps_up\":%.0f,\"pps_down\":%s,\"pps_up\":%s,\"dt\":%.3f,\"source\":\"%s\",\"device\":\"%s\",\"peak_bps_down\":%.0f,\"peak_bps_up\":%.0f,\"average_bps_down\":%s,\"average_bps_up\":%s,\"series\":[%s]}\n",at,mono,valid,valid?d:0,valid?u:0,pdown=="-"?"null":pdown,pup=="-"?"null":pup,dt/1000,source,dev,peakd,peaku,(duration>0?int(sumd/duration):"null"),(duration>0?int(sumu/duration):"null"),series > out
}' && mv -f "$STATE_DIR/live.series.new" "$STATE_DIR/live.series" && mv -f "$OUT.new" "$OUT"
exit 0

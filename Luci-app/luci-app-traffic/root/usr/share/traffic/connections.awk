# One collector scan supplies attribution deltas and bounded quality metadata.
# Optional final CT records recover connections between live snapshots.
function uint(s) { return s ~ /^[0-9]+$/ && length(s)<=20 && (length(s)<20 || ("x" s)<="x18446744073709551615") }
function cmp(a,b) { if(length(a)!=length(b))return length(a)>length(b)?1:-1; return ("x" a)==("x" b)?0:(("x" a)>("x" b)?1:-1) }
function diff(a,b,    i,j,v,borrow,out) {
    # Subtract decimal strings before converting the small interval to double.
    if(cmp(a,b)<0)return -1
    borrow=0; out=""; j=length(b)
    for(i=length(a);i>0;i--) { v=substr(a,i,1)-(j>0?substr(b,j--,1):0)-borrow; borrow=v<0; if(borrow)v+=10; out=v out }
    return out+0
}
function lan(a) { return (lan4!=""&&index(a,lan4)==1)||(lan6!=""&&index(a,lan6)==1) }
function number(n) { return sprintf("%.0f",n) }
function keyid(k, v) { v=k; if(v!~/[|]id:/)return ""; sub(/^.*[|]id:/,"",v); return v }
function save(k) {
    printf "%s\t%s\t%s\t%s\t%s\t%.0f\t%.0f\t%s\n",k,prev1[k],prev2[k],pp1[k],pp2[k],when[k],activity[k],oldmode[k] > newst
    saved++
}
BEGIN {
    while((getline line<state)>0) {
        split(line,f,"\t")
        if(f[1]=="@schema") { version=f[2] }
        else if(f[1]=="@gaps") { old_gaps=f[2]+0 }
        else if(f[1]=="@floor") { floor_id=f[2] }
        else if(f[1]=="@closed") { cursor=f[2]+0; have_cursor=1 }
        else if(f[1]=="@sample") { previous_mono=f[2]+0; have_sample=1 }
        else if(f[1]!="") {
            prev1[f[1]]=f[2]; prev2[f[1]]=f[3]; pp1[f[1]]=f[4]; pp2[f[1]]=f[5]
            when[f[1]]=f[6]+0; activity[f[1]]=f[7]+0; oldmode[f[1]]=f[8]
            have_sample=1; old_entries++
            if(old_entries>65536) { bad=1; break }
        }
    }
    close(state)
    current_gaps=old_gaps
    migration=old_entries>0&&version!="2"
    if(!uint(floor_id))floor_id="0"
    nself=split(selfip,selves," "); for(i=1;i<=nself;i++)if(selves[i]!="")self[selves[i]]=1
    sample_dt=previous_mono>0?mono-previous_mono:0
}
/^schema=/ {
    if($0 !~ /^schema=1 sequence=[0-9]+ capacity=[0-9]+ scope=init_net unit=ct_lifetime( gaps=[0-9]+)?$/) { bad=1; next }
    split($2,a,"="); ring_seq=a[2]+0; split($3,a,"="); capacity=a[2]+0
    if(capacity<1||capacity>4096||ring_seq<cursor) { bad=1; next }
    ring=1
    if(NF==6) {
        split($6,a,"="); current_gaps=a[2]+0
        gap_events=have_cursor?current_gaps-old_gaps:0
        if(gap_events<0) { bad=1; next }
    }
    if(!have_cursor)cursor=ring_seq
    lost=ring_seq-capacity-cursor; if(lost<0)lost=0
    expected=ring_seq-cursor; if(expected>capacity)expected=capacity
    next
}
{
    src=""; dst=""; sport=""; dport=""; rs=""; rd=""; rsp=""; rdp=""
    nb=0; nt=0; np=0; npt=0; malformed=0; id=""; zone="0"; seq=0
    b1="0"; b2="0"; p1="0"; p2="0"; tb1=""; tb2=""; tp1=""; tp2=""
    for(i=1;i<=NF;i++) {
        t=$i; split(t,a,"="); v=a[2]
        if(a[1]=="src") { if(src=="")src=v; else rs=v }
        else if(a[1]=="dst") { if(dst=="")dst=v; else rd=v }
        else if(a[1]=="sport") { if(sport=="")sport=v; else rsp=v }
        else if(a[1]=="dport") { if(dport=="")dport=v; else rdp=v }
        else if(a[1]=="bytes") { nb++; if(!uint(v))malformed=1; if(nb==1)b1=v; else b2=v }
        else if(a[1]=="packets") { np++; if(!uint(v))malformed=1; if(np==1)p1=v; else p2=v }
        else if(a[1]=="bytes_total") { nt++; if(!uint(v))malformed=1; if(nt==1)tb1=v; else tb2=v }
        else if(a[1]=="packets_total") { npt++; if(!uint(v))malformed=1; if(npt==1)tp1=v; else tp2=v }
        else if(a[1]=="traffic_id") { if(!uint(v))malformed=1; else id=v }
        else if(a[1]=="zone") { if(v!~/^[0-9]+$/||v+0>65535)malformed=1; else zone=v }
        else if(a[1]=="closed_seq")seq=v+0
    }
    if(seq) {
        if(!ring||seq>ring_seq||id=="") { bad=1; next }
        if(seq<=cursor)next
        if(seen_seq[seq]++) { bad=1; next }
        received++
    }
    if(src!~/^[0-9a-fA-F:.]+$/||dst!~/^[0-9a-fA-F:.]+$/||length(src)>45||length(dst)>45||$3!~/^[a-z0-9_-]+$/) {
        if(seq)bad=1; else invalid++; next
    }
    if((nt&&nt!=2)||(npt&&npt!=2)||malformed||(!nt&&nb!=2)) {
        if(seq)bad=1; else invalid++; next
    }
    if(nt==2) { b1=tb1; b2=tb2; lifetime++ } else resettable++
    if(npt==2) { p1=tp1; p2=tp2; if(!seq)packet_lifetime++ }
    mode=(nt==2?"total":"reset") ":" (npt==2?"total":"reset")
    suffix="|z:" zone (id!=""?"|id:" id:"")
    key=$1 "|" $3 "|" src "|" sport "|" dst "|" dport suffix
    if(!seq&&(key in live))next
    if(!(key in observed)&&++observed_count>65536) { bad=1; exit 2 }
    # DNAT clients live in the reply source tuple. Keep the original connection
    # identity for the baseline; only attribution uses the translated LAN end.
    asrc=src; adst=dst; asp=sport; adp=dport
    if(!lan(src)&&!lan(dst)) {
        if(lan(rs)&&!(rs in self)) { adst=rs; adp=rsp }
        else if(lan(rd)&&!(rd in self)) { asrc=rd; asp=rdp }
    }
    attribution=$1 "|" $3 "|" asrc "|" asp "|" adst "|" adp suffix
    d1=b1+0; d2=b2+0; dp1=p1+0; dp2=p2+0
    elapsed=(key in when)&&when[key]>0?mono-when[key]:sample_dt
    rate_ok=have_sample&&elapsed>0&&elapsed<=60000
    if(key in prev1) {
        if(oldmode[key]!=""&&oldmode[key]!=mode) { d1=0; d2=0; dp1=0; dp2=0; rate_ok=0 }
        else {
            d1=diff(b1,prev1[key]); d2=diff(b2,prev2[key])
            if(d1<0||d2<0) {
                # A unique lifetime ID must never move backwards.
                if(nt==2&&id!="") { d1=0; d2=0 } else { if(d1<0)d1=b1+0; if(d2<0)d2=b2+0 }
                rate_ok=0; resets++
            }
            dp1=uint(pp1[key])?diff(p1,pp1[key]):-1
            dp2=uint(pp2[key])?diff(p2,pp2[key]):-1
        }
    } else {
        if(id=="")rate_ok=0
        if(migration||(id!=""&&cmp(id,floor_id)<=0)) {
            d1=0; d2=0; dp1=0; dp2=0; rate_ok=0
            if(!migration)baseline_lost++
        }
    }
    if(d1+d2>0) { changes[attribution]+=d1; replies[attribution]+=d2; activity[key]=at }
    # Preserve a terminal value for the rest of this scan if it appears twice.
    prev1[key]=b1; prev2[key]=b2; pp1[key]=p1; pp2[key]=p2; when[key]=mono; oldmode[key]=mode
    observed[key]=1
    if(seq) {
        ended[key]=1; closed_seen++
        if(key in live) {
            delete live[key]; live_count--
            if(was_active[key])active_count--
            if(was_packet_lifetime[key])packet_lifetime--
        }
        next
    }
    live[key]=1; live_count++
    active=rate_ok&&d1+d2>0; if(active)active_count++
    was_active[key]=active; was_packet_lifetime[key]=npt==2

}
END {
    if(ring&&received!=expected)bad=1
    if(bad) {
        print "{\"available\":false,\"coverage\":\"incomplete_snapshot\",\"sampled_at\":" number(at) "}" > status
        exit 2
    }
    print "@schema\t2" > newst
    print "@sample\t" number(mono) > newst
    if(ring||have_cursor)print "@closed\t" number(ring?ring_seq:cursor) > newst
    print "@gaps\t" number(ring?current_gaps:old_gaps) > newst
    # Keep recently missing IDs until their final record arrives. A kernel
    # without the bounded final-record API reports its coverage explicitly.
    # Live baselines take priority. Retained missing IDs share the same bound;
    # a burst of entirely new flows cannot double the next state file forever.
    for(k in live)save(k)
    for(k in prev1)if(!(k in ended)&&!(k in live)) {
        if(saved<65536&&when[k]>0&&mono-when[k]<60000)
            save(k)
        else {
            forgotten=keyid(k)
            if(uint(forgotten)&&cmp(forgotten,floor_id)>0)floor_id=forgotten
        }
    }
    print "@floor\t" floor_id > newst
    for(k in changes)if(changes[k]+replies[k]>0)
        printf "%s\t%.0f\t%.0f\n",k,changes[k],replies[k] > delta
    coverage=ring?(lost>0?"overflow":(gap_events>0?"gap":"complete")):"unavailable"
    printf "{\"available\":true,\"sampled_at\":%.0f,\"interval_ms\":%.0f,\"source\":\"conntrack\",\"counter_coverage\":\"%s\",\"closed_coverage\":\"%s\",\"closed_gap_events\":%.0f,\"closed_lost\":%.0f,\"closed_merged\":%.0f,\"invalid_rows\":%.0f,\"counter_resets\":%.0f,\"unknown_baselines\":%.0f,\"active_connections\":%.0f,\"transferring_connections\":%.0f,\"packet_lifetime_rows\":%.0f}\n",at,(sample_dt>0?sample_dt:0),(resettable?(lifetime?"mixed":"resettable"):(lifetime?"lifetime":"empty")),coverage,gap_events,lost,closed_seen,invalid,resets,baseline_lost,live_count,active_count,packet_lifetime > status
}

#!/usr/bin/env python3
"""Run the installed WAN sampler and connection parser against deterministic counters."""
import json, os, re, shutil, subprocess, tempfile
from pathlib import Path
app = Path(__file__).resolve().parents[1]
live_script = app/'root/usr/share/traffic/live.sh'
parser = app/'root/usr/share/traffic/connections.awk'
checks = 0

def check(value, label):
    global checks
    checks += 1
    assert value, label

with tempfile.TemporaryDirectory(prefix='traffic-live-') as temp:
    t=Path(temp); state=t/'state'; state.mkdir(); (state/'live.env').write_text('WAN_IF=wan0\nSOURCE=conntrack\nLAN4=192.168.1.\n')
    net=t/'netdev'; uptime=t/'uptime'; sysnet=t/'net'; (sysnet/'wan0').mkdir(parents=True); (sysnet/'wan0/ifindex').write_text('7\n')
    env=dict(os.environ, STATE_DIR=str(state), TRAFFIC_PROC_NET_DEV=str(net), TRAFFIC_PROC_UPTIME=str(uptime), TRAFFIC_SYS_CLASS_NET=str(sysnet), CT=str(t/'never-read-ct'))
    def tick(ms,rx,tx,rp,tp,force=True):
        uptime.write_text(f'{ms/1000:.3f} 0.00\n')
        net.write_text(f'wan0: {rx} {rp} 0 0 0 0 0 0 {tx} {tp} 0 0 0 0 0 0\n')
        subprocess.run(['sh',str(live_script)]+(['--force'] if force else []),env=env,check=True,capture_output=True,text=True)
        return json.loads((state/'live.json').read_text())
    r=tick(10000,1000000000,2000000000,1000000,2000000)
    check(r['ready']==0 and r['series'][-1][1] is None,'first observation is a gap/baseline')
    r=tick(11000,1125000000,2062500000,1100000,2050000)
    check(r['ready']==1 and r['bps_down']==125000000 and r['bps_up']==62500000,'1 Gbps / 500 Mbps rates')
    check(r['pps_down']==100000 and r['pps_up']==50000,'packets use the same WAN observation')
    r=tick(12250,1281250000,2140625000,1225000,2112500)
    check(r['dt']==1.25 and r['bps_down']==125000000 and r['pps_down']==100000,'jitter divides by actual monotonic time')
    r=tick(22250,1406250000,2203125000,1325000,2162500)
    check(r['ready']==0 and r['series'][-1][1] is None,'scheduling pause leaves a gap')
    r=tick(23250,1531250000,2265625000,1425000,2212500)
    check(r['ready']==1 and r['bps_down']==125000000,'sampling recovers without a catch-up peak')
    r=tick(24250,10,20,1,2)
    check(r['ready']==0,'counter rollback starts a baseline')
    (sysnet/'wan0/ifindex').write_text('8\n')
    r=tick(25250,125000010,62500020,100001,50002)
    check(r['ready']==0,'device recreation invalidates an otherwise growing counter')
    r=tick(26250,250000010,125000020,200001,100002)
    check(r['ready']==1 and r['bps_down']==125000000,'device recreation recovers on the next complete interval')
    # Numeric zero is distinct from a missing sample.
    r=tick(27250,250000010,125000020,200001,100002)
    check(r['ready']==1 and r['pps_down']==0 and r['bps_down']==0,'a measured zero stays valid')
    (state/'live.env').write_text('WAN_IF=missing\nSOURCE=conntrack\n')
    r=tick(28250,250000010,125000020,200001,100002)
    check(r['ready']==0 and r['source']=='unavailable' and not (state/'live.flows').exists(),'no full conntrack scan in the one-second path')
    before=(state/'live.json').read_bytes(); tick(29250,0,0,0,0,False)
    check((state/'live.json').read_bytes()==before,'unwatched sampler does not publish traffic')
    (state/'live.env').write_text('WAN_IF=wan0\nSOURCE=conntrack\n')
    (state/'live.series').write_text(''.join(f'{ms}\t100\t200\t1\t2\t1000\n' for ms in range(690000,1000000,1000)))
    r=tick(1000000,300000000,200000000,300000,300000)
    check(len(r['series'])<=301 and all(p[0]>=700000 for p in r['series']),'five-minute history is bounded and expired rows are removed')

with tempfile.TemporaryDirectory(prefix='traffic-connections-') as temp:
    t=Path(temp); state=t/'state'; current=t/'ct'; closed=t/'closed'; new=t/'new'; delta=t/'delta'; status=t/'status'
    def ct(identity=1,ob='100',rb='1000',op='1',rp='2',src='192.168.1.2',dst='198.51.100.1',proto='tcp',seq=0,reply_src=None,reply_dst=None):
        return (f'ipv4 2 {proto} {6 if proto=="tcp" else 17} 100 ESTABLISHED src={src} dst={dst} sport=1234 dport=443 packets=0 bytes=0 '
                f'src={reply_src or dst} dst={reply_dst or src} sport=443 dport=1234 packets=0 bytes=0 '
                f'traffic_id={identity} packets_total={op} bytes_total={ob} packets_total={rp} bytes_total={rb} zone=0'+(f' closed_seq={seq}' if seq else '')+'\n')
    def ring(seq,rows='',capacity=2048,gaps=None):
        return f'schema=1 sequence={seq} capacity={capacity} scope=init_net unit=ct_lifetime'+(f' gaps={gaps}' if gaps is not None else '')+'\n'+rows
    stamp=0
    def scan(text,events=None,success=True):
        current.write_text(text)
        # A sequence of exact 10-second intervals, without real sleeps.
        scan.stamp+=10000
        args=['awk','-v',f'state={state}','-v',f'newst={new}','-v',f'delta={delta}','-v',f'status={status}','-v',f'mono={scan.stamp}','-v',f'at={scan.stamp//1000}','-v','lan4=192.168.1.','-v','lan6=2001:db8:1:','-v','selfip=192.168.1.1','-f',str(parser),str(current)]
        if events is not None: closed.write_text(events); args.append(str(closed))
        if delta.exists():delta.unlink()
        if new.exists():new.unlink()
        run=subprocess.run(args,capture_output=True,text=True)
        check((run.returncode==0)==success,f'parser return: {run.stderr}')
        if run.returncode==0:shutil.move(new,state)
        value=json.loads(status.read_text()); changes=[]
        if delta.exists():changes=[(v[0],int(v[1]),int(v[2]))for v in (l.split('\t')for l in delta.read_text().splitlines())]
        return value,changes
    scan.stamp=0
    r,d=scan(ct(),ring(0)); check(r['interval_ms']==0 and 'entries' not in r,'the first sample has no interval or ranked flow cache')
    r,d=scan(ct(ob='200',rb='2000',op='3',rp='5'),ring(0))
    check(sum(x[1]for x in d)==100 and sum(x[2]for x in d)==1000,'lifetime bytes survive raw counter resets')
    check('\t3\t5\t' in state.read_text(),'lifetime packets remain available in the collector baseline')
    r,d=scan(ct(ob='200',rb='2000',op='3',rp='5'),ring(0))
    check(r['transferring_connections']==0 and not d,'established idle connections do not create traffic')
    r,d=scan(ct(2,ob='500'),ring(0)); check(sum(x[1]for x in d)==500,'same tuple with a new CT ID has its own baseline')
    r,d=scan(ct(2,ob='500'),ring(1,ct(1,ob='250',rb='2100',seq=1)))
    check(sum(x[1]for x in d)==50 and sum(x[2]for x in d)==100,'final record credits only the unobserved tail')
    r,d=scan(ct(2,ob='500'),ring(1,ct(1,ob='250',rb='2100',seq=1))); check(not d,'final ring replay is not double-counted')
    r,d=scan('',ring(2,ct(1,ob='250',rb='2100',seq=1)+ct(3,ob='800',rb='900',seq=2)))
    check(sum(x[1]for x in d)==800 and sum(x[2]for x in d)==900,'a short connection absent from both live samples is recovered')
    r,d=scan('',ring(5,ct(4,seq=4)+ct(5,seq=5),2)); check(r['closed_coverage']=='overflow' and r['closed_lost']==1,'ring overflow is explicit')
    before=state.read_bytes(); r,d=scan('',ring(6,'',2),False)
    check(state.read_bytes()==before and r['coverage']=='incomplete_snapshot','partial final snapshot preserves the old cursor and baselines')
    scan('',ring(6,ct(5,seq=5)+ct(6,seq=6),2))
    big=str(2**60+5); scan(ct(100,ob=big),ring(6,ct(5,seq=5)+ct(6,seq=6),2))
    r,d=scan(ct(100,ob=str(2**60+15)),ring(6,ct(5,seq=5)+ct(6,seq=6),2))
    check(sum(x[1]for x in d)==10 and str(2**60+15) in state.read_text(),'uint64 subtraction does not lose small deltas above 2^53')
    r,d=scan(ct(101,src='203.0.113.2',dst='198.51.100.2',reply_src='192.168.1.4'),ring(6,ct(5,seq=5)+ct(6,seq=6),2))
    check(any('|192.168.1.4|'in x[0]for x in d) and '|203.0.113.2|1234|198.51.100.2|' in state.read_text(),'DNAT attribution uses the LAN reply endpoint while its baseline retains the original tuple')
    r,d=scan(ct(102,src='2001:db8:1::2',dst='2001:db8:2::1')+ct(103,src='2001:db8:1::3',dst='2001:db8:2::1'),ring(6,ct(5,seq=5)+ct(6,seq=6),2))
    check(r['active_connections']==2 and all(ip in state.read_text() for ip in ['2001:db8:1::2','2001:db8:1::3']),'multiple IPv6 addresses remain separate connection identities')
    r,d=scan('',ring(6,'',gaps=1))
    check(r['closed_coverage']=='gap' and r['closed_gap_events']==1,'an expired kernel watch reports a gap even without ring overflow')
    r,d=scan('',ring(6,'',gaps=1))
    check(r['closed_coverage']=='complete' and r['closed_gap_events']==0,'the gap event is consumed once')
    r,d=scan(ct(105,ob='10'),ring(6,'',gaps=1))
    r,d=scan(ct(105,ob='20'),ring(7,ct(105,ob='30',seq=7),gaps=1))
    check(sum(x[1] for x in d)==20 and r['active_connections']==0 and r['transferring_connections']==0,'a flow closing during the live scan is merged once')
    # Old installed three-column state must not credit the full live lifetime again.
    state.write_text('ipv4|tcp|192.168.1.2|1234|198.51.100.1|443\t50\t60\n')
    r,d=scan(ct(104,ob='1000',rb='2000'),ring(6,''))
    check(not d,'collector upgrade establishes baselines without replaying existing lifetime bytes')
    # The union of missing and newly observed flows must stay bounded too.
    state.write_text('@schema\t2\n@sample\t'+str(scan.stamp)+'\n'+''.join(
        f'ipv4|tcp|192.168.1.2|1234|198.51.100.1|443|z:0|id:{i}\t10\t20\t1\t2\t{scan.stamp}\t0\ttotal:total\n'
        for i in range(1,65537)))
    r,d=scan(ct(100000),ring(0))
    check(sum(not line.startswith('@') for line in state.read_text().splitlines())==65536 and '|id:100000\t' in state.read_text(),'new live flows and retained missing baselines share one capacity bound')

with tempfile.TemporaryDirectory(prefix='traffic-ct-read-failure-') as temp:
    t=Path(temp); (t/'flow.state').write_text('previous baseline\n')
    collector=(app/'root/usr/share/traffic/collector.sh').read_text()
    function=re.search(r'(?ms)^poll_ct\(\) \{.*?^\}',collector).group()
    script=t/'test.sh'; script.write_text(function+'\npoll_ct\n')
    env=dict(os.environ,STATE_DIR=str(t),CT=str(t),SELF_DIR=str(parser.parent),CFG_LAN4='',CFG_LAN6='',CFG_SELF='')
    subprocess.run(['sh',str(script)],env=env,capture_output=True,text=True)
    check(json.loads((t/'conntrack.json').read_text())['available'] is False and (t/'flow.state').read_text()=='previous baseline\n' and not (t/'flow.delta').exists(),'a failed CT read never publishes a complete partial snapshot or consumes its baseline')
print(json.dumps({'checks':checks,'failures':0,'scope':'real WAN sampler and real AWK collector; synthetic counters, no router'}))

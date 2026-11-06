#!/usr/bin/env python3
"""Run the production worker with integer-only sleep and bounded fake counters."""
from pathlib import Path
import argparse,os,subprocess,tempfile,time,signal,json

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--worker',type=Path,default=Path(__file__).resolve().parents[1]/'root/usr/share/traffic/realtime.sh')
p.add_argument('--busybox',type=Path)
p.add_argument('--shell',type=Path,default=Path('/bin/sh'))
p.add_argument('--output',type=Path)
a=p.parse_args();rows=[]
with tempfile.TemporaryDirectory(prefix='traffic-worker-') as tmp:
    root=Path(tmp);binary=root/'bin';binary.mkdir();state=root/'state';state.mkdir();scripts=root/'scripts';scripts.mkdir();ticks=root/'ticks';sleeps=root/'sleeps'
    (scripts/'live.sh').write_text('#!/bin/sh\nprintf "tick\\n" >> "$TEST_TICKS"\nexit "${TEST_SAMPLE_EXIT:-0}"\n')
    if a.busybox:
        sleep_body='exec "'+str(a.busybox.resolve())+'" sleep "$@"\n'
    else:
        sleep_body='case "$1" in ""|*[!0-9]*) exit 1 ;; esac\nexec /bin/sleep "$@"\n'
    (binary/'sleep').write_text('#!/bin/sh\nprintf "%s\\n" "$1" >> "$TEST_SLEEPS"\n'+sleep_body);(binary/'sleep').chmod(0o755)
    env=dict(os.environ,PATH=str(binary)+':'+os.environ['PATH'],SELF_DIR=str(scripts),STATE_DIR=str(state),TEST_TICKS=str(ticks),TEST_SLEEPS=str(sleeps))
    def run(name,watched,seconds,exit_code='0'):
        ticks.write_text('');sleeps.write_text('');watch=state/'live.watch';watch.unlink(missing_ok=True)
        if watched is not None:watch.write_text(str(int(time.time())+watched)+'\n')
        start=time.monotonic();proc=subprocess.Popen([str(a.shell),str(a.worker)],env={**env,'TEST_SAMPLE_EXIT':exit_code},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        try:time.sleep(seconds)
        finally:
            if proc.poll() is None:os.killpg(proc.pid,signal.SIGTERM)
            proc.wait(timeout=3)
        count=len(ticks.read_text().splitlines());durations=sleeps.read_text().splitlines()
        row={'case':name,'samples':count,'sleep_arguments':durations,'elapsed':round(time.monotonic()-start,2)};rows.append(row)
        assert durations and all(s.isdigit() and int(s)>0 for s in durations),row
        if watched==0:assert 1<=count<=3,row
        else:assert count==0,row
    run('active-viewer',0,2.25)
    run('no-viewer',None,0.25)
    run('expired-viewer',-70,0.25)
    run('future-wallclock-watch',70,0.25)
    run('sample-command-failure-still-waits',0,1.25,'17')
record={'passed':len(rows),'busybox':str(a.busybox) if a.busybox else 'strict integer-sleep fixture','cases':rows,'hardware_test':False}
if a.output:a.output.write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'passed':len(rows),'failed':0,'sleep':'integer-only','hardware_test':False}))

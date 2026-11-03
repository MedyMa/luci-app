#!/usr/bin/env python3
"""Exercise both real optional NPU RPC functions with real host jshn.

Traffic reads the collector cache; router.status retains its optional helper.
Paths are relocated to fixtures. No router or service is accessed.
"""
import argparse
import hashlib
import json
import os
import shlex
from pathlib import Path
import subprocess
import tempfile

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--jshn-bin', type=Path, required=True)
p.add_argument('--jshn-shell', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
app = Path(__file__).resolve().parents[1]
sources = [app/'root/usr/libexec/rpcd/luci.traffic', app.parent/'rpcd-mod-router-status/root/usr/libexec/rpcd/router.status']
out = a.output.resolve(); out.mkdir(parents=True, exist_ok=True)
rows = []
valid = {'schema':3,'npu':{},'tunnels':{},'accounting':{}}
with tempfile.TemporaryDirectory(prefix='tops-rpc-') as temp:
    t = Path(temp); binary=t/'bin'; binary.mkdir()
    # SDK host tools may be launchers with paths relative to their own $0.
    launcher=binary/'jshn'
    launcher.write_text('#!/bin/sh\nexec '+shlex.quote(str(a.jshn_bin.resolve()))+' \"$@\"\n')
    launcher.chmod(0o755)
    helper=t/'mtk-tops-status'; payload=t/'payload.json'
    helper.write_text('#!/bin/sh\ncat "'+str(payload)+'"\nexit "${TEST_HELPER_EXIT:-0}"\n'); helper.chmod(0o755)
    for source in sources:
        text = source.read_text(); start=text.index('get_npu_status() {'); end=text.index('\n}\n', start)+3
        function=text[start:end]
        cached=source.name=='luci.traffic'
        script=t/'rpc.sh'; script.write_text('. "'+str(a.jshn_shell.resolve())+'"\nSTATE_DIR="'+str(t)+'"\n'+function.replace('/usr/bin/mtk-tops-status',str(helper))+'\nget_npu_status\n')
        assert 'getNpuStatus' in text and 'getNpuStatus) get_npu_status' in text
        acl = json.loads((source.parents[2]/'share/rpcd/acl.d'/('router-status.json' if source.name=='router.status' else 'luci-app-traffic.json')).read_text())
        assert any('getNpuStatus' in group.get('read',{}).get('ubus',{}).get(source.name,[]) for group in acl.values())
        cases = [
            ('schema4',json.dumps(dict(valid,schema=4)),None,0,False,False),
            ('schema4-large',json.dumps(dict(valid,schema=4,diagnostic_fixture='x'*50000)),None,0,False,False),
            ('schema3',json.dumps(valid),None,0,False,False),
            ('schema2',json.dumps(dict(valid,schema=2)),None,0,False,False),
            ('invalid-json','{','provider_invalid',0,False,False),
            ('wrong-shape','true','provider_invalid',0,False,False),
            ('missing-object',json.dumps({'schema':3,'npu':{}}),'provider_invalid',0,False,False),
            ('future-schema',json.dumps(dict(valid,schema=5)),'provider_invalid',0,False,False),
            ('helper-error','{}','provider_failed',7,False,False),
            ('oversized',' '*131073,'provider_failed',0,False,False),
            ('missing-helper','{}','provider_missing',0,True,False),
            ('missing-timeout','{}','no_timeout_tool',0,False,True),
        ]
        if cached:
            cases=[(name,data,('collector_invalid' if expected else None),0,False,False)
                   for name,data,expected,_,_,_ in cases[:8]]+[
                ('oversized',' '*131073,'collector_invalid',0,False,False),
                ('missing-cache','{}','collector_pending',0,True,False)]
        for name,data,expected,exit_code,missing,no_timeout in cases:
            payload.write_text(data); helper.chmod(0o644 if missing else 0o755)
            if cached:
                cache=t/'npu.json'
                if missing: cache.unlink(missing_ok=True)
                else: cache.write_text(data)
            env=os.environ.copy(); env['PATH']=str(binary)+('' if no_timeout else ':'+env.get('PATH','')); env['TEST_HELPER_EXIT']=str(exit_code)
            r=subprocess.run(['/bin/bash',str(script)],env=env,capture_output=True,text=True,timeout=15)
            d=json.loads(r.stdout)
            ok=r.returncode==0 and not r.stderr and (d.get('coverage')==expected if expected else d==json.loads(data))
            if expected: ok=ok and d.get('available') is False
            rows.append({'provider':source.name,'case':name,'pass':ok,'exit':r.returncode,'stderr':r.stderr[:300],'stdout':r.stdout[:300]})
            assert ok,rows[-1]
receipt={'scope':__doc__,'inputs':{str(p):hashlib.sha256(p.read_bytes()).hexdigest()for p in sources},'cases':rows}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'cases':len(rows),'failed':0,'providers':[p.name for p in sources]}))

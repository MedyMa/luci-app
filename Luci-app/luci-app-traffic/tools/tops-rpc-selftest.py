#!/usr/bin/env python3
"""Exercise both real optional NPU RPC functions with real host jshn.

Only the fixed helper path is relocated to an executable fixture. No router,
service, settings or traffic collection is accessed.
"""
import argparse
import hashlib
import json
import os
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
    t = Path(temp); binary=t/'bin'; binary.mkdir(); (binary/'jshn').symlink_to(a.jshn_bin.resolve())
    helper=t/'mtk-tops-status'; payload=t/'payload.json'
    helper.write_text('#!/bin/sh\ncat "'+str(payload)+'"\nexit "${TEST_HELPER_EXIT:-0}"\n'); helper.chmod(0o755)
    for source in sources:
        text = source.read_text(); start=text.index('get_npu_status() {'); end=text.index('\n}\n', start)+3
        function=text[start:end]
        script=t/'rpc.sh'; script.write_text('. "'+str(a.jshn_shell.resolve())+'"\n'+function.replace('/usr/bin/mtk-tops-status',str(helper))+'\nget_npu_status\n')
        assert 'getNpuStatus' in text and 'getNpuStatus) get_npu_status' in text
        acl = json.loads((source.parents[2]/'share/rpcd/acl.d'/('router-status.json' if source.name=='router.status' else 'luci-app-traffic.json')).read_text())
        assert any('getNpuStatus' in group.get('read',{}).get('ubus',{}).get(source.name,[]) for group in acl.values())
        for name,data,expected,exit_code,missing,no_timeout in [
            ('schema3',json.dumps(valid),None,0,False,False),
            ('schema2',json.dumps(dict(valid,schema=2)),None,0,False,False),
            ('invalid-json','{','provider_invalid',0,False,False),
            ('wrong-shape','true','provider_invalid',0,False,False),
            ('missing-object',json.dumps({'schema':3,'npu':{}}),'provider_invalid',0,False,False),
            ('future-schema',json.dumps(dict(valid,schema=4)),'provider_invalid',0,False,False),
            ('helper-error','{}','provider_failed',7,False,False),
            ('oversized',' '*32769,'provider_failed',0,False,False),
            ('missing-helper','{}','provider_missing',0,True,False),
            ('missing-timeout','{}','no_timeout_tool',0,False,True),
        ]:
            payload.write_text(data); helper.chmod(0o644 if missing else 0o755)
            env=os.environ.copy(); env['PATH']=str(binary)+('' if no_timeout else ':'+env.get('PATH','')); env['TEST_HELPER_EXIT']=str(exit_code)
            r=subprocess.run(['/bin/bash',str(script)],env=env,capture_output=True,text=True,timeout=15)
            d=json.loads(r.stdout)
            ok=r.returncode==0 and not r.stderr and (d.get('coverage')==expected if expected else d==json.loads(data))
            if expected: ok=ok and d.get('available') is False
            rows.append({'provider':source.name,'case':name,'pass':ok,'exit':r.returncode,'stderr':r.stderr[:300]})
            assert ok,rows[-1]
receipt={'scope':__doc__,'inputs':{str(p):hashlib.sha256(p.read_bytes()).hexdigest()for p in sources},'cases':rows}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'cases':len(rows),'failed':0,'providers':[p.name for p in sources]}))

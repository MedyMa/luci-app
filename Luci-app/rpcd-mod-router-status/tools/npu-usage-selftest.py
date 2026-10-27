#!/usr/bin/env python3
"""Exercise real getNpuUsage with a fixed executable fixture and host jshn."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--jshn-bin',type=Path,required=True)
p.add_argument('--jshn-shell',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
package=Path(__file__).resolve().parents[1]
source=package/'root/usr/libexec/rpcd/router.status'
original=source.read_text();rows=[]
valid={'schema':1,'available':True,'unit':'mean_core_busy_percent','percent_milli':12400,'core_count':5,'coverage':'complete'}
with tempfile.TemporaryDirectory(prefix='npu-rpc-usage-')as temp:
    root=Path(temp);helper=root/'helper';response=root/'response.json';rpc=root/'router.status'
    binary=root/'bin';binary.mkdir();(binary/'jshn').symlink_to(a.jshn_bin.resolve())
    env=os.environ.copy();env['PATH']=str(binary)+':'+env.get('PATH','')
    rpc.write_text(original.replace('/usr/share/libubox/jshn.sh',str(a.jshn_shell.resolve())).replace('/usr/bin/mtk-npu-usage',str(helper)))
    def check(name,data=valid,coverage='complete',missing=False,body=None):
        response.write_text(data if isinstance(data,str)else json.dumps(data))
        helper.write_text(body or ('#!/bin/sh\nexec cat '+shlex.quote(str(response))+'\n'))
        helper.chmod(0o644 if missing else 0o755)
        # OpenWrt jshn uses export -n (supported by ash/bash, not host dash).
        result=subprocess.run(['/bin/bash',str(rpc),'call','getNpuUsage'],env=env,capture_output=True,text=True,timeout=6)
        if result.returncode:
            trace=subprocess.run(['/bin/bash','-x',str(rpc),'call','getNpuUsage'],env=env,capture_output=True,text=True,timeout=6)
            (a.output/'failed.trace').write_text(trace.stdout+trace.stderr)
        assert result.returncode==0,(name,result.returncode,result.stdout,result.stderr)
        value=json.loads(result.stdout);assert value['coverage']==coverage,(name,value)
        if coverage=='complete':
            assert value==valid if data==valid else value['percent_milli']==data['percent_milli'],(name,value)
        else:
            assert value['available']is False and 'percent_milli'not in value,(name,value)
        rows.append({'case':name,'pass':True})
    check('real-current-usage')
    check('real-zero',{**valid,'percent_milli':0})
    check('real-100',{**valid,'percent_milli':100000})
    check('missing-provider',missing=True,coverage='provider_missing')
    for name,data in [
        ('invalid-json','{'),('missing-fields',{}),('future-schema',{**valid,'schema':2}),
        ('string-schema',{**valid,'schema':'1'}),('float-schema',{**valid,'schema':1.0}),
        ('string-percent',{**valid,'percent_milli':'12400'}),('negative',{**valid,'percent_milli':-1}),
        ('above-100',{**valid,'percent_milli':100001}),('float-percent',{**valid,'percent_milli':12400.0}),
        ('wrong-unit',{**valid,'unit':'active_tunnels'}),('partial-cores',{**valid,'core_count':4}),
        ('string-cores',{**valid,'core_count':'5'}),('nonboolean',{**valid,'available':1}),
        ('unknown-unavailable',{'schema':1,'available':False,'unit':'mean_core_busy_percent','coverage':'bogus'}),
    ]:
        check(name,data,coverage='provider_invalid')
    for coverage in ['missing','no_timeout_tool','read_failed','oversized','invalid','driver_unsupported']:
        check('unavailable-'+coverage,{'schema':1,'available':False,'unit':'mean_core_busy_percent','coverage':coverage},coverage=coverage)
    check('oversized',' ' * 1025,coverage='provider_failed')
    check('provider-exit',coverage='provider_failed',body='#!/bin/sh\nexit 7\n')
    check('provider-timeout',coverage='provider_failed',body='#!/bin/sh\nexec sleep 5\n')
    methods=json.loads(subprocess.check_output(['/bin/bash',str(rpc),'list'],env=env,text=True))
    assert 'getNpuUsage'in methods and 'getNpuStatus'in methods
    acl=json.loads((package/'root/usr/share/rpcd/acl.d/router-status.json').read_text())
    assert any('getNpuUsage'in v.get('read',{}).get('ubus',{}).get('router.status',[])for v in acl.values())
receipt={'scope':__doc__,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'passed':len(rows),'failed':0,'cases':rows}
(a.output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'passed':len(rows),'failed':0}))

#!/usr/bin/env node
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),assert=require('assert');
const dir=fs.mkdtempSync(path.join(process.env.TRAFFIC_TEST_DIR||os.tmpdir(),'traffic-chunks-'));
const posix=p=>process.platform==='win32'?p.replace(/\\/g,'/').replace(/^([A-Za-z]):/,(m,d)=>'/'+d.toLowerCase()):p;
const sh=process.platform==='win32'?'C:/Program Files/Git/bin/sh.exe':'sh';
try {
 const state=path.join(dir,'state'),data=path.join(dir,'data');fs.mkdirSync(state);fs.mkdirSync(data);
 fs.writeFileSync(path.join(dir,'jshn.sh'),`json_init() { :; }
json_load() { :; }
json_get_var() { eval "$1=\\\"\\\${STUB_$2:-}\\\""; }
json_add_string() { :; }
json_dump() { printf '{}\\n'; }
`);
 const src=fs.readFileSync(path.join(__dirname,'../root/usr/libexec/rpcd/luci.traffic'),'utf8');
 fs.writeFileSync(path.join(dir,'backend.sh'),src.replace('. /usr/share/libubox/jshn.sh','. "'+posix(path.join(dir,'jshn.sh'))+'"'));
 fs.writeFileSync(path.join(dir,'uci'),`#!/bin/sh\necho '${posix(data)}'\n`,{mode:0o755});
 let tsv='';for(let h=0;h<168;h++)for(let a=0;a<100;a++)
  tsv+=`h${String(h).padStart(3,'0')}\tapp\t网站${a}\t${a+1}\t2\n`;
 fs.writeFileSync(path.join(data,'hourly.tsv'),tsv);
 const call=(method,args={})=>{
  const env={...process.env,PATH:posix(dir)+path.delimiter+process.env.PATH,STATE_DIR:posix(state)};
  // Git's shell uses POSIX separators, while its inherited Windows PATH is translated at startup.
  if(process.platform==='win32')env.PATH=dir+path.delimiter+process.env.PATH;
  for(const [k,v] of Object.entries(args))env['STUB_'+k]=String(v);
  const r=cp.spawnSync(sh,[posix(path.join(dir,'backend.sh')),'call',method],{env,input:'{}\n',maxBuffer:8*1024*1024});
  if(r.error)throw r.error;
  assert.equal(r.status,0,r.stderr.toString());return r.stdout;
 };
 const first=JSON.parse(call('getHourlyChunk',{hours:168}));
 assert(first.cursor && first.data,'chunk method must return a snapshot cursor and data');
 // Mutating the history between pages must not change the fixed reply.
 fs.writeFileSync(path.join(data,'hourly.tsv'),'h999\tapp\tchanged\t999\t0\n');
 let offset=0,chunk=first,buffers=[];
 for(let i=0;i<2048;i++){
  assert.equal(chunk.cursor,first.cursor);assert.equal(chunk.offset,offset);
  const bytes=Buffer.from(chunk.data,'base64');assert(bytes.length>0&&bytes.length<=32768);
  assert(Buffer.byteLength(JSON.stringify(chunk))<48000,'each RPC reply must have a byte bound');
  buffers.push(bytes);offset+=bytes.length;assert.equal(chunk.next,offset);
  if(chunk.done){assert.equal(offset,chunk.total);break;}
  chunk=JSON.parse(call('getHourlyChunk',{hours:168,cursor:first.cursor,offset}));
 }
 const result=JSON.parse(Buffer.concat(buffers).toString('utf8'));
 assert.equal(result.hours.length,168);
 assert(result.hours.every(h=>h.apps.length===100));
 assert.equal(result.hours[0].apps.reduce((n,a)=>n+a.down+a.up,0),5250);
 assert(result.hours.every(h=>h.apps.every(a=>a.name.startsWith('网站'))),'UTF-8 must survive chunk boundaries');
 assert(!fs.existsSync(path.join(state,first.cursor)),'completed snapshot removed');
 assert(JSON.parse(call('getHourlyChunk',{cursor:'../../etc/shadow',offset:0})).error,'path traversal rejected');
 assert(JSON.parse(call('getHourlyChunk',{cursor:first.cursor,offset:0})).error,'missing snapshot rejected');
 fs.writeFileSync(path.join(data,'hourly.tsv'),tsv);
 const guarded=call('getHourly',{hours:168});
 assert(guarded.length<48000&&JSON.parse(guarded).error,'old interface must safely refuse oversized replies');
 console.log('PASS full 168-hour snapshot, bounded chunks, UTF-8, immutable pages, cleanup, invalid cursor and legacy guard');
} finally {fs.rmSync(dir,{recursive:true,force:true});}

#!/usr/bin/env node
const fs=require('fs'),assert=require('assert');
const src=fs.readFileSync(__dirname+'/../htdocs/luci-static/resources/view/traffic/overview.js','utf8');
const body=src.match(/function callHourly\(hours\) \{([\s\S]*?)\n\}/);
assert(body,'range reader must use bounded chunk transport');
const build=rpc=>new Function('callHourlyChunk','atob','TextDecoder','Uint8Array',
 'return function(hours){'+body[1]+'\n}')(rpc,atob,TextDecoder,Uint8Array);
(async()=>{
 const payload={hours:Array.from({length:168},(_,i)=>({hour:String(i),apps:[{name:'网站'.repeat(200),down:i,up:5}],clients:[{ip:'::1',bytes:i+5}]}))};
 const bytes=Buffer.from(JSON.stringify(payload));let calls=0;
 const read=build(async(hours,cursor,offset)=>{
  assert.equal(hours,168);assert.equal(cursor,calls?'token':'');calls++;
  const end=Math.min(offset+32768,bytes.length);
  return {cursor:'token',offset,next:end,total:bytes.length,done:end===bytes.length,data:bytes.subarray(offset,end).toString('base64')};
 });
 assert.deepEqual(await read(168),payload);assert(calls>1);
 await assert.rejects(build(async()=>({error:'expired'}))(168),/expired/);
 await assert.rejects(build(async()=>({cursor:'t',offset:0,next:100,total:100,done:true,data:'e30='}))(168));
 let n=0;
 await assert.rejects(build(async(h,c,o)=>{
  if(n++)throw Error('network stopped');
  return {cursor:'t',offset:0,next:32768,total:65536,done:false,data:Buffer.alloc(32768).toString('base64')};
 })(168),/network stopped/);
 // A slower seven-day transfer must not overwrite a newer range selection.
 const refreshBody=src.match(/\trefresh: function\(\) \{([\s\S]*?)\n\t\},/)[1];
 const pending=new Map(), shown=[];
 const refresh=new Function('callSummary','callHourly','rememberNames',
  'return function(){'+refreshBody+'\n}')(
   async()=>({}),hours=>new Promise(resolve=>pending.set(hours,resolve)),()=>{});
 const view={range:'168',renderHourly:h=>shown.push(h),renderLive:()=>{},updateRate:()=>{},drawStatus:()=>{}};
 const older=refresh.call(view);await Promise.resolve();
 view.range='1';const newer=refresh.call(view);await Promise.resolve();
 pending.get(1)({hours:[{hour:'new'}]});await newer;
 pending.get(168)({hours:[{hour:'old'}]});await older;
 assert.equal(shown.length,1);assert.equal(shown[0].hours[0].hour,'new');
 console.log('PASS full UTF-8 history, chunk continuity, errors and incomplete response rejection');
})().catch(e=>{console.error(e);process.exitCode=1;});

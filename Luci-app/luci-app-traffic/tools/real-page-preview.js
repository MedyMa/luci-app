#!/usr/bin/env node
/*
 * real-page-preview.js - render the actual page, offline, to a PNG-able HTML.
 *
 * The hand-drawn mock in Test/ proves a layout idea; this proves the page.  It
 * loads the real view with the same stub DOM the render selftest uses, drives the
 * real render()/renderHourly()/drawStatus()/drawSeries() paths with a fixture,
 * then serialises the tree the page actually built next to the stylesheet it
 * actually injected.  What lands in the HTML file is therefore the real markup and
 * the real CSS, not a copy of either - so a layout mistake in the stylesheet shows
 * up here instead of on the router.
 *
 *   node tools/real-page-preview.js            # writes both variants
 *   node tools/real-page-preview.js --dark     # dark only
 */
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, '..', '..', 'design');
const VIEW = path.join(__dirname, '..', 'htdocs', 'luci-static', 'resources', 'view', 'traffic', 'overview.js');
const src = fs.readFileSync(VIEW, 'utf8')
  .replace(/^'use strict';\s*$/m, '').replace(/^'require [^']+';\s*$/gm, '');

const SVG='http://www.w3.org/2000/svg', XHTML='http://www.w3.org/1999/xhtml';
function mk(ns,tag,attrs,children){
  const n={tag,ns,attrs:{},children:[],parentNode:null,_text:'',style:{},
    setAttribute(k,v){ this.attrs[k]=v; }, removeAttribute(k){ delete this.attrs[k]; },
    addEventListener(){}, removeEventListener(){}, focus(){},
    appendChild(c){ if(c.parentNode)c.parentNode.removeChild(c); c.parentNode=this; this.children.push(c); return c; },
    insertBefore(c,ref){ if(c.parentNode)c.parentNode.removeChild(c);
      const i=ref?this.children.indexOf(ref):-1;
      if(i<0)this.children.push(c); else this.children.splice(i,0,c);
      c.parentNode=this; return c; },
    removeChild(c){ const i=this.children.indexOf(c); if(i>=0)this.children.splice(i,1); c.parentNode=null; return c; },
    get firstChild(){ return this.children[0]||null; },
    // a real DOM replaces every child when textContent is assigned
    set textContent(v){ this._text=String(v); this.children=[]; },
    get textContent(){ return this._text; },
    get classList(){ return {add(){},remove(){}}; },
    set className(v){ this.attrs['class']=v; }, get className(){ return this.attrs['class']||''; }
  };
  for(const k in (attrs||{})) n.attrs[k]=attrs[k];
  (children||[]).forEach(c=>n.appendChild(c));
  return n;
}
function E(tag,attrs,children){ return mk(XHTML,tag,attrs,children); }
global.__capturedCss='';
const cssParts=[];
const documentStub={
  createElement(t){ const n=mk(XHTML,t);
    if(t==='style') n.appendChild=function(c){ cssParts.push((c&&c._text)||''); };
    return n; },
  createElementNS(ns,t){ return mk(ns,t); },
  createTextNode(t){ const n=mk(null,'#text'); n._text=String(t); return n; },
  getElementById(){ return null; }, addEventListener(){}, removeEventListener(){},
  head:{ appendChild(){} }, hidden:false, body:mk(XHTML,'body')
};
const factory=new Function('view','rpc','dom','poll','_','E','L','document','Image','confirm',
  src.replace(/return view\.extend\(/, 'global.__injectCss = injectCss;\nreturn view.extend('));
const viewStub={extend(o){ viewStub.__obj=o; return o; }};
const domStub={content(node,ch){ node.children=[]; (Array.isArray(ch)?ch:[ch]).forEach(x=>{ if(x) node.appendChild(x); }); }};
const rpcStub={declare(){ return ()=>Promise.resolve({}); }};
factory(viewStub,rpcStub,domStub,{add(){}},s=>s,E,{bind(f,c){return f.bind(c);},resource(p){return p;},env:{}},
  documentStub,function(){ return {onload:null,src:'',className:''}; },()=>true);
const view=viewStub.__obj;

/* ---- fixture: a day of history, so the ranged (default) view has something ---- */
const APPS=[['OpenAI',3.78e6,3.64e6],['ChatGPT',1.30e6,.39e6],['SSL/TLS',642e3,185e3],
            ['Tencent Time',631e3,95.9e3],['Other',194e3,112e3],['DNS',120e3,44e3]];
const HOURS=Array.from({length:24},(_,h)=>{
  const f=0.35+0.65*Math.abs(Math.sin(h/3.1));
  return { hour:'2026-09-17T'+String(h).padStart(2,'0'),
    apps:APPS.map(([name,d,u],i)=>({name,down:Math.round(d*f*(1-i*0.07)),up:Math.round(u*f*(1-i*0.07))})),
    clients:[{ip:'192.168.2.'+(20+h%5),bytes:Math.round(2.2e6*f)},
             {ip:'192.168.2.'+(30+h%3),bytes:Math.round(1.4e6*f)},
             {ip:'192.168.2.'+(40+h%4),bytes:Math.round(0.8e6*f)}],
    router:Math.round(90e3*f) };
});
const SUMMARY={ collected_at:Math.floor(Date.now()/1000), interval:10, flows:371,
  dnsmap_lines:9305, pending:0, acct:1, version:'0.1.23-r1', hour:'2026-09-17T10',
  totals:{down:2.84e9,up:3.76e9,router:1.07e9,client_count:9,exact:120,bucket:60,residual:20},
  clients:[{name:'Mac',ip:'192.168.2.21',bytes:8.09e9}], apps:[] };
/* bursty rather than a clean sine: real traffic is long quiet stretches with
 * sharp spikes, which is exactly the shape that shows whether the curve is
 * smoothed and whether it overshoots */
const SERIES={ range:'24h', interval:60, points:Array.from({length:180},(_,i)=>{
  const t=1789530000+i*60;
  const burst=Math.pow(Math.abs(Math.sin(i/17)),8)*Math.abs(Math.cos(i/53));
  const slow=0.22*Math.abs(Math.sin(i/41));
  const d=Math.max(0,Math.round(4.6e6*(burst+slow)));
  return [t,d,Math.round(d*0.16)]; }) };

/* ---- build the page for real ---- */
function build(){
  cssParts.length=0;
  const v=Object.create(view);
  const page=view.render.call(v,SUMMARY);       // real markup + injectCss()
  v.seriesRange='24h'; v.series=SERIES;
  view.drawSeries.call(v);
  view.renderHourly.call(v,{hours:HOURS});
  view.drawStatus.call(v,SUMMARY,v.lastItems||[]);
  return { page, css:cssParts.join('') };
}
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const VOID={col:1,br:1,img:1,input:1,hr:1,meta:1,link:1};
function ser(n){
  if(n==null) return '';
  // E() accepts bare strings as children (a translated caption is just a string)
  if(typeof n!=='object') return esc(n);
  if(n.ns===null) return esc(n._text);
  let s='<'+n.tag;
  for(const k in (n.attrs||{})){ const v=n.attrs[k]; if(v===''||v==null) continue; s+=' '+k+'="'+esc(v)+'"'; }
  s+='>';
  if(VOID[n.tag]) return s;
  if((n.children||[]).length) s+=n.children.map(ser).join('');
  else if(n._text) s+=esc(n._text);
  return s+'</'+n.tag+'>';
}
const {page,css}=build();
// the same page in dark: the stylesheet already keys dark off .tf-page.tf-dark
const darkPage=(()=>{ const {page:p}=build(); p.attrs['class']=(p.attrs['class']||'')+' tf-dark'; return p; })();
// the session view too: it is the one that carries the extra note line
const sessionPage=(()=>{ const v=Object.create(view); const p=view.render.call(v,SUMMARY);
  view.renderLive.call(v,SUMMARY); return p; })();
const sessionDark=(()=>{ const v=Object.create(view); const p=view.render.call(v,SUMMARY);
  view.renderLive.call(v,SUMMARY); p.attrs['class']=(p.attrs['class']||'')+' tf-dark'; return p; })();

function write(name,node,theme){
  const html='<!DOCTYPE html>\n<html lang="zh"><head><meta charset="utf-8">\n<style>\n'+
    'html,body{margin:0;padding:0;background:'+(theme==='dark'?'#191d24':'#eef1f5')+';}\n'+
    'body{padding:20px 24px 30px;width:1200px;box-sizing:border-box;'+
    'font:100%/1.5 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}\n'+
    css+'\n</style></head><body>\n'+ser(node)+'\n</body></html>\n';
  const f=path.join(OUT,name);
  fs.writeFileSync(f,html,'utf8');
  console.log('wrote '+f+'  ('+html.length+' bytes, css '+css.length+')');
}
write('traffic-real-range.html',page,'light');
write('traffic-real-range-dark.html',darkPage,'dark');
write('traffic-real-session.html',sessionPage,'light');
write('traffic-real-session-dark.html',sessionDark,'dark');

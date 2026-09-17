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
const PO = loadPo(path.join(__dirname, '..', 'po', 'zh_Hans', 'traffic.po'));
// an untranslated string falls through to its msgid, which is what LuCI does
const translate = s => (PO[s] !== undefined ? PO[s] : s);
factory(viewStub,rpcStub,domStub,{add(){}},translate,E,{bind(f,c){return f.bind(c);},resource(p){return p;},env:{}},
  documentStub,function(){ return {onload:null,src:'',className:''}; },()=>true);
const view=viewStub.__obj;

/* The page's labels come from po/zh_Hans/traffic.po, and the preview has to show
 * them: the strip boxes are sized for the Chinese ones, which are two to six
 * characters.  An English preview hides the very thing the width was chosen for
 * (and made long captions wrap, which Chinese never does), so it is not a
 * faithful picture of the page.  The catalogue is flat, so a small gettext
 * reader is enough. */
function loadPo(file){
  const map = {};
  const unesc = s => s.replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\');
  const unq = s => { const m = /^\s*"([\s\S]*)"\s*$/.exec(s); return m ? m[1] : ''; };
  let id = null, str = null, mode = null;
  const put = () => { if (id && str) map[unesc(id)] = unesc(str); id = null; str = null; mode = null; };
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    if (line.startsWith('msgid ')) { put(); id = unq(line.slice(6)); mode = 'id'; }
    else if (line.startsWith('msgstr ')) { str = unq(line.slice(7)); mode = 'str'; }
    else if (line[0] === '"') { if (mode === 'id') id += unq(line); else if (mode === 'str') str += unq(line); }
  }
  put();
  return map;
}
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
  dnsmap_lines:9305, pending:0, acct:1, version:'0.1.27-r1', hour:'2026-09-17T10',
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
/* The chart is built in the browser from a viewBox chosen by window.innerWidth,
 * and this generator serialises the SVG it built - so a phone's chart can only be
 * previewed by building the page as if the window were that narrow.  That is what
 * the width argument is for. */
function build(narrowWidth){
  global.window = narrowWidth ? { innerWidth: narrowWidth } : undefined;
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
  // the stub keeps style as its own object, so an inline display:none (how the
  // page hides the note card) has to be written out or the preview shows a card
  // the real page does not
  const st=n.style||{};
  const inline=Object.keys(st).map(k=>k+':'+st[k]+';').join('');
  if(inline) s+=' style="'+esc(inline)+'"';
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
    // no fixed width: a hardcoded 1200px body made the page ignore the window,
    // so it could not be used to check any width but one.  At a 1200px window
    // this renders exactly as before.
    'body{padding:20px 24px 30px;box-sizing:border-box;'+
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
// the same page as a 390px phone sees it, chart canvas included
const phoneNarrow=(()=>{ global.window={innerWidth:390};
  const v=Object.create(view); const p=view.render.call(v,SUMMARY);
  v.seriesRange='24h'; v.series=SERIES; view.drawSeries.call(v);
  view.renderHourly.call(v,{hours:HOURS}); view.drawStatus.call(v,SUMMARY,v.lastItems||[]);
  return p; })();
write('traffic-real-phone.html',phoneNarrow,'light');
global.window=undefined;

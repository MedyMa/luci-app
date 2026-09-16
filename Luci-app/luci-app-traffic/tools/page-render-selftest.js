#!/usr/bin/env node
/*
 * page-render-selftest.js - offline rendering check for the traffic page.
 *
 * The interesting failure this catches is one no syntax check can see: LuCI's
 * E() ends up in document.createElement(), which never produces an SVG element.
 * A donut or chart built that way is created happily, passes node --check, and
 * then renders as nothing at all - an empty card on the page.
 *
 * It loads the real view file with a stub DOM that records namespaces, drives
 * the real draw()/drawSeries()/drawStatus() paths, and asserts what landed in
 * the tree.
 *
 *   node tools/page-render-selftest.js
 */
const fs = require('fs');
const path = require('path');
const VIEW = path.join(__dirname, '..', 'htdocs', 'luci-static', 'resources', 'view', 'traffic', 'overview.js');
const src = fs.readFileSync(VIEW, 'utf8')
  .replace(/^'use strict';\s*$/m, '').replace(/^'require [^']+';\s*$/gm, '');
const SVG='http://www.w3.org/2000/svg', XHTML='http://www.w3.org/1999/xhtml';
const seen={ns:{}, htmlUsed:0, wrongNs:[], tags:{}};
function mk(ns,tag,attrs,children){
  seen.ns[ns==null?'null':ns]=(seen.ns[ns==null?'null':ns]||0)+1;
  seen.tags[tag]=(seen.tags[tag]||0)+1;
  if(ns===XHTML && ['svg','g','circle','path','line','text'].includes(tag)) seen.wrongNs.push(tag);
  const n={tag,ns,attrs:{},children:[],parentNode:null,_text:'',
    setAttribute(k,v){ this.attrs[k]=v; }, removeAttribute(k){ delete this.attrs[k]; },
    appendChild(c){ if(c.parentNode)c.parentNode.removeChild(c); c.parentNode=this; this.children.push(c); return c; },
    removeChild(c){ const i=this.children.indexOf(c); if(i>=0)this.children.splice(i,1); c.parentNode=null; return c; },
    get firstChild(){ return this.children[0]||null; },
    set textContent(v){ this._text=String(v); if(v==='')this.children=[]; },
    get textContent(){ return this._text; },
    get classList(){ return {add(){},remove(){}}; },
    set className(v){ this.attrs['class']=v; }, get className(){ return this.attrs['class']; }
  };
  for(const k in (attrs||{})) n.attrs[k]=attrs[k];
  (children||[]).forEach(c=>n.appendChild(c));
  return n;
}
function E(tag,attrs,children){ return mk(XHTML,tag,attrs,children); }
const documentStub={
  createElement(t){ return mk(XHTML,t); },
  createElementNS(ns,t){ return mk(ns,t); },
  createTextNode(){ return mk(null,'#text'); },
  getElementById(){ return null; }, head:{appendChild(){}}, hidden:false
};
function ImageStub(){ return {onload:null,src:'',className:''}; }
const factory=new Function('view','rpc','dom','poll','_','E','L','document','Image','confirm',src);
const viewStub={extend(o){ viewStub.__obj=o; return o; }};
const domStub={content(node,ch){ node.children=[]; (Array.isArray(ch)?ch:[ch]).forEach(x=>{ if(x) node.appendChild(x); }); }};
const _id=s=>s;
factory(viewStub,{declare(){return ()=>Promise.resolve({});}},domStub,{add(){}},_id,
  E,{bind(f,c){return f.bind(c);},resource(p){return p;},env:{}},documentStub,ImageStub,()=>true);
const view=viewStub.__obj;
let fail=0; const chk=(c,m)=>{ console.log(`  ${c?'PASS':'FAIL'} ${m}`); if(!c)fail++; };
const walk=(n,fn)=>{ fn(n); (n.children||[]).forEach(c=>walk(c,fn)); };
const texts=(root)=>{ const a=[]; (root.children||[]).forEach(c=>walk(c,n=>{ if(n.tag==='span'&&n._text)a.push(n._text); })); return a; };
const count=(root,tag)=>{ let k=0; (root.children||[]).forEach(c=>walk(c,n=>{ if(n.tag===tag)k++; })); return k; };

function freshView(){
  return { rowsEl:E('tbody'), donutEl:E('div'), legendEl:E('div'), totalEl:E('div'),
           metaEl:E('div'), statusEl:E('div'), chartEl:E('div'), chartNote:E('span'),
           rateDown:E('b'), rateUp:E('b') };
}
const items=[{name:'YouTube',down:1e6,up:1e5,bytes:11e5,clients:3,top:'192.168.2.5',top_bytes:5e5},
             {name:'Google',down:9e5,up:9e4,bytes:99e4,clients:5,top:'192.168.2.7',top_bytes:4e5},
             {name:'CDN',down:8e5,up:8e4,bytes:88e4,clients:9,top:'192.168.2.9',top_bytes:3e5}];
const stats={total:11e5+99e4+88e4,down:27e5,up:27e4,topText:'192.168.2.5 1.2 MiB',clientCount:12};

console.log('=== draw(): 环形图走真实渲染路径 ===');
for(const k in seen.ns) delete seen.ns[k]; seen.wrongNs=[];
const v=freshView();
view.draw.call(v,items,stats);
const donutCount=count(v.donutEl,'svg');
chk(donutCount===1, `donutEl 里有 1 个 svg（${donutCount}）`);
const svgNode=(function find(n){ if(n.tag==='svg')return n; for(const c of (n.children||[])){ const r=find(c); if(r)return r; } return null; })(v.donutEl);
chk(svgNode && svgNode.ns===SVG, `环形图根元素在 SVG 命名空间（ns=${svgNode&&svgNode.ns===SVG?'SVG':'HTML'}）`);
chk(svgNode && svgNode.attrs.viewBox==='0 0 168 168', `viewBox = ${svgNode&&svgNode.attrs.viewBox}`);
chk(svgNode && svgNode.attrs.width == 168, `有内在宽度 ${svgNode&&svgNode.attrs.width}（否则卡片会塌成空盒）`);
chk(count(v.donutEl,'circle')===3, `3 个扇形圆（${count(v.donutEl,'circle')}）`);
chk(seen.wrongNs.length===0, `没有把 SVG 标签建成 HTML 元素（异常 ${seen.wrongNs.join(',')||'无'}）`);
console.log(`  命名空间统计: SVG=${seen.ns[SVG]||0}, XHTML=${seen.ns[XHTML]||0}`);

console.log('=== 空数据时环形图不再是空盒 ===');
const v2=freshView();
view.draw.call(v2,[],{total:0,down:0,up:0,topText:'—',clientCount:0});
chk(count(v2.donutEl,'circle')===1, `灰色占位圈 1 个（${count(v2.donutEl,'circle')}）`);
chk(count(v2.donutEl,'text')===1, `占位文字 1 个（${count(v2.donutEl,'text')}）`);

console.log('=== drawSeries(): 吞吐曲线 ===');
const v3=freshView();
v3.seriesRange='1h';
v3.series={range:'1h',interval:10,points:Array.from({length:120},(_,i)=>[1789530000+i*10,i*1000,i*400])};
view.drawSeries.call(v3);
chk(count(v3.chartEl,'svg')===1, `chartEl 里有 1 个 svg（${count(v3.chartEl,'svg')}）`);
chk(count(v3.chartEl,'line')===3, `网格线 3 条（${count(v3.chartEl,'line')}）`);
chk(count(v3.chartEl,'path')===4, `折线+面积 4 条（${count(v3.chartEl,'path')}）`);
chk(count(v3.chartEl,'text')>=5, `文字标注 >=5（${count(v3.chartEl,'text')}）`);
const csvg=(function find(n){ if(n.tag==='svg')return n; for(const c of (n.children||[])){ const r=find(c); if(r)return r; } return null; })(v3.chartEl);
chk(csvg && csvg.ns===SVG, `曲线根元素在 SVG 命名空间`);
chk(csvg && typeof csvg.attrs.viewBox==='string' && csvg.attrs.viewBox.startsWith('0 0 720'), `viewBox = ${csvg&&csvg.attrs.viewBox}`);

console.log('=== 无采样时也画轴（避免空卡片）===');
const v4=freshView();
v4.seriesRange='1h'; v4.series={range:'1h',interval:10,points:[]};
view.drawSeries.call(v4);
chk(count(v4.chartEl,'svg')===1 && count(v4.chartEl,'line')===3, `空数据仍有轴：svg=${count(v4.chartEl,'svg')}, line=${count(v4.chartEl,'line')}`);
chk(count(v4.chartEl,'div')>=1, `并有"暂无采样"提示（${count(v4.chartEl,'div')}）`);

console.log('=== 状态条（信息展示）===');
const v5=freshView();
view.drawStatus.call(v5,{collected_at:Math.floor(Date.now()/1000),interval:10,flows:1234,dnsmap_lines:5678,pending:3,querylog:'/etc/config/adGuardConfig/workspace/data/querylog.json'},items);
const stats5=[]; walk(v5.statusEl,n=>{ if(n.tag==='span') stats5.push(n._text); });
chk(stats5.length>=12, `状态条内容项 ${stats5.length} 个（应为 6 项×2）`);
chk(stats5.some(t=>t==='Running'), `含运行状态（${stats5.slice(0,4).join(' | ')}）`);
chk(stats5.some(t=>t==='1234'), '含 conntrack 条目数');
chk(stats5.some(t=>t==='5678'), '含已解析主机名数');
chk(stats5.some(t=>t==='3'), '含待解析数');
const v6=freshView();
view.drawStatus.call(v6,{collected_at:0,interval:0,flows:0,dnsmap_lines:0,pending:0,querylog:''},[]);
const s6=[]; walk(v6.statusEl,n=>{ if(n.tag==='span') s6.push(n._text); });
chk(s6.some(t=>t==='Collector has not produced a snapshot yet'), `无快照时明确提示（${s6.slice(0,4).join(' | ')}）`);

console.log(fail?`\n  ${fail} 项失败`:'\n  页面渲染验证全部通过');
process.exit(fail?1:0);



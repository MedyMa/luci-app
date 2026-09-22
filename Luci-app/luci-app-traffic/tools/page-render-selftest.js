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
  const n={tag,ns,attrs:{},children:[],parentNode:null,_text:'',style:{},
    setAttribute(k,v){ this.attrs[k]=v; }, removeAttribute(k){ delete this.attrs[k]; },
    _listeners:{},
    addEventListener(type,fn){ this._listeners[type]=fn; },
    removeEventListener(type){ delete this._listeners[type]; }, focus(){},
    appendChild(c){ if(c.parentNode)c.parentNode.removeChild(c); c.parentNode=this; this.children.push(c); return c; },
    // the strip re-appends boxes that are out of order, so the stub needs this
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
    // a real element's className is '' until something sets it, not undefined
    set className(v){ this.attrs['class']=v; }, get className(){ return this.attrs['class']||''; }
  };
  for(const k in (attrs||{})) n.attrs[k]=attrs[k];
  (children||[]).forEach(c=>n.appendChild(c));
  return n;
}
function E(tag,attrs,children){ return mk(XHTML,tag,attrs,children); }
// capture what injectCss() puts into the <style> element
global.__capturedCss = '';
const documentStub={
  createElement(t){
    const n=mk(XHTML,t);
    if(t==='style') n.appendChild=function(c){ global.__capturedCss += (c && c._text) || ''; };
    return n;
  },
  createElementNS(ns,t){ return mk(ns,t); },
  createTextNode(t){ const n=mk(null,'#text'); n._text=String(t); return n; },
  getElementById(){ return null; },
  addEventListener(){}, removeEventListener(){},
  head:{ appendChild(n){ if(n && n.id==='tf-css') global.__capturedCss=global.__capturedCss||''; } },
  hidden:false
};
const imageRequests=[];
function ImageStub(){
  let source='';
  const img={onload:null,className:''};
  Object.defineProperty(img,'src',{get(){return source;},set(v){source=v;imageRequests.push(v);}});
  return img;
}
const factory=new Function('view','rpc','dom','poll','_','E','L','document','Image','confirm',
  src.replace(/return view\.extend\(/,
    'global.__injectCss = injectCss;\n' +
    'global.__iconTest = {makeIcon:makeIcon,setPending:function(p){iconIndexPromise=p;shippedIcons={};cachedIcons=null;},' +
    'setShipped:function(m){shippedIcons=m;},setDomains:function(m){domainIcons=m;}};\nreturn view.extend('));
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
// the strip's boxes, in order: one caption/value pair each
const boxes=root=>(root.children||[]).filter(c=>(c.attrs||{}).class==='tf-stat')
  .map(c=>{ const s=c.children.filter(x=>x.tag==='span'); return {cap:s[0]&&s[0]._text, val:s[1]&&s[1]._text}; });
const txt=n=>{ let s=''; (function go(x){ if(!x||typeof x!=='object')return;
  if(x._text)s+=x._text+' '; ((x.children)||[]).forEach(go); })(n); return s; };

function freshView(){
  // the ring is drawn into the figure inside .tf-donut, and the strip/diag
  // composers are methods on the view, so the fake has to be view-prototyped
  // and nested the way render() builds it
  const donutFigEl=E('div'), donutEl=E('div',{'class':'tf-donut'});
  donutEl.appendChild(donutFigEl);
  return Object.assign(Object.create(view), {
           rowsEl:E('tbody'), donutEl:donutEl, donutFigEl:donutFigEl, donutTotalEl:E('div'),
           legendEl:E('div'), totalEl:E('div'), diagEl:E('div'), diagCardEl:E('div'),
           statusEl:E('div'), chartEl:E('div'), chartNote:E('span'),
           rateDown:E('b'), rateUp:E('b'),
           // render() still builds the protocol-bucket block and the hero caption,
           // and draw() still reaches both (renderProto gets an empty list now, so
           // it only ever hides the block); these tests drive draw directly, so the
           // stubs stay.  The hero caption is rewritten by draw() as before.
           protoEl:E('div'), protoListEl:E('div'), protoSumEl:E('span'),
           heroCapEl:E('div') });
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

console.log('=== 环形图小扇区与未归属分开 ===');
const vMicro=freshView();
view.draw.call(vMicro,[
  {name:'Large',down:12000,up:0,bytes:12000},
  {name:'Proto',down:7000,up:0,bytes:7000},
  {name:'Tiny',down:1000,up:0,bytes:1000}
],{total:1000000,down:1000000,up:0,shareTotal:20000,shareDown:20000,shareUp:0,
  topText:'—',clientCount:1});
chk(!vMicro.legendCache.Tiny && !!vMicro.rowCache.Tiny,
  '不足总量 0.5% 的应用合并到图例，完整表格仍保留原行');
chk(!!vMicro.legendCache['Other attributed traffic'] &&
    vMicro.legendCache['Other attributed traffic'].pct.textContent==='0.1%',
  '小扇区计入其余已归属，分母仍是总流量');
chk(!!vMicro.legendCache.Unattributed &&
    vMicro.legendCache.Unattributed.pct.textContent==='98.0%',
  '未归属与其余已归属分开，百分比可对账');

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
chk(count(v3.chartEl,'path')===4, `曲线+面积 4 条（${count(v3.chartEl,'path')}）`);
chk(count(v3.chartEl,'text')>=5, `文字标注 >=5（${count(v3.chartEl,'text')}）`);
const csvg=(function find(n){ if(n.tag==='svg')return n; for(const c of (n.children||[])){ const r=find(c); if(r)return r; } return null; })(v3.chartEl);
chk(csvg && csvg.ns===SVG, `曲线根元素在 SVG 命名空间`);
chk(csvg && typeof csvg.attrs.viewBox==='string' && csvg.attrs.viewBox.startsWith('0 0 720'), `viewBox = ${csvg&&csvg.attrs.viewBox}`);

console.log('=== 曲线平滑：单调三次贝塞尔 ===');
// The curve has to be smooth without being allowed to lie.  A plain spline
// through traffic samples overshoots between a spike and the next low reading -
// below the floor on the way down, and a hump on a flat stretch - which draws
// bytes that were never transferred.  Monotone tangents (Fritsch-Carlson) limit
// each segment so it stays between the two samples it joins, so the shape is
// checked as well as the smoothness.
const curveDs=[], areaDs=[];
walk(v3.chartEl,n=>{ const c=(n.attrs||{}).class||'';
  if(n.tag==='path' && /tf-curve/.test(c)) curveDs.push(n.attrs.d);
  if(n.tag==='path' && /tf-area/.test(c)) areaDs.push(n.attrs.d); });
chk(curveDs.length===2, `两条曲线路径（${curveDs.length}）`);
chk(curveDs.every(d=>(d.match(/C/g)||[]).length===119 && !/L/.test(d)),
    `每条 119 段三次贝塞尔、无直线段（C=${(curveDs[0]||'').match(/C/g)?.length}）`);
chk(areaDs.length===2 && areaDs.every((d,i)=>d.indexOf(curveDs[i])===0),
    '面积填充用的是同一条曲线，而不是另画一条更直的');
// every y in the path - samples and Bezier control points alike - has to sit
// inside the plot band, which is what "no overshoot" means once it is drawn
const ysOf=d=>{
  const toks=d.match(/[MCL]|-?\d+(?:\.\d+)?/g)||[]; const ys=[]; let cur=null, k=0;
  for(const t of toks){
    if(t==='M'||t==='L'||t==='C'){ cur=t; k=0; continue; }
    k++; if(cur==='M'||cur==='L'){ if(k===2) ys.push(Number(t)); }
    else if(cur==='C'){ if(k%2===0) ys.push(Number(t)); }
  }
  return ys;
};
const plotTop=14, plotBottom=14+(190-14-22);
const allY=curveDs.concat(areaDs).flatMap(ysOf);
const bad=allY.filter(y=>y<plotTop-0.6||y>plotBottom+0.6);
chk(allY.length>100 && bad.length===0,
    `所有 y 都在绘图区内（${allY.length} 个，越界 ${bad.length}${bad.length?'，例如 '+bad.slice(0,3).join(','):''}）`);

console.log('=== 波形时间轴、采样空档与独立峰值 ===');
const chartPaths=root=>{const a=[];walk(root,n=>{if(n.tag==='path')a.push(n);});return a;};
const vGap=freshView();
vGap.seriesRange='1h';
vGap.series={range:'1h',interval:10,points:[
  [1000,1000,0],[1010,2000,0],[1100,3000,0],[1110,4000,0]]};
view.drawSeries.call(vGap);
const gapCurve=chartPaths(vGap.chartEl).find(n=>n.attrs.class==='tf-curve tf-curve-down');
const gapArea=chartPaths(vGap.chartEl).find(n=>n.attrs.class==='tf-area-down');
chk(gapCurve && (gapCurve.attrs.d.match(/M/g)||[]).length===2,
  '超过采样间隔的空档被断成两段曲线');
chk(gapArea && (gapArea.attrs.d.match(/Z/g)||[]).length===2,
  '面积填充也在空档处分段');
const starts=gapCurve && [...gapCurve.attrs.d.matchAll(/M([\d.]+)/g)].map(x=>Number(x[1]));
chk(starts && starts[1]-starts[0]>500,
  `横坐标反映 90 秒真实时间空档（${starts&&starts.join(',')}）`);
const vPeak=freshView();
vPeak.seriesRange='1h';
vPeak.series={range:'1h',interval:10,points:[[1000,1000,0,0,0,0],
  [1010,1000,0,1000000,0,1],[1020,1000,0,0,0,0]]};
view.drawSeries.call(vPeak);
const peakSvg=vPeak.chartEl.children[0];
const peakTicks=[];walk(peakSvg,n=>{if(n.tag==='text'&&n.attrs.class==='tf-chart-tick')peakTicks.push(n._text);});
chk(peakTicks.some(t=>/128 B\/s/.test(t)) && !peakTicks.some(t=>/977 KiB\/s/.test(t)),
  `纵轴依区间平均速率而非 1 秒峰值（${peakTicks.join(', ')}）`);
let peakMarks=0;walk(peakSvg,n=>{if((n.attrs.class||'').includes('tf-peak-mark'))peakMarks++;});
chk(peakMarks>0 && vPeak.chartNote.textContent.includes('977 KiB/s'),
  '1 秒峰值有独立标记且保留准确数值');
const vManyPeaks=freshView();
vManyPeaks.seriesRange='1h';
vManyPeaks.series={range:'1h',interval:10,points:Array.from({length:80},(_,i)=>
  [1000+i*10,1000,1000,100000+i*1000,120000+i*1000,1])};
view.drawSeries.call(vManyPeaks);
let peakMarkCount=0;walk(vManyPeaks.chartEl,n=>{
  if((n.attrs.class||'').includes('tf-peak-mark'))peakMarkCount++;
});
chk(peakMarkCount<=2, `每个方向只标最强的 1 秒峰值（${peakMarkCount} 个标记）`);

console.log('=== 无采样时也画轴（避免空卡片）===');
const v4=freshView();
v4.seriesRange='1h'; v4.series={range:'1h',interval:10,points:[]};
view.drawSeries.call(v4);
chk(count(v4.chartEl,'svg')===1 && count(v4.chartEl,'line')===3, `空数据仍有轴：svg=${count(v4.chartEl,'svg')}, line=${count(v4.chartEl,'line')}`);
chk(count(v4.chartEl,'div')>=1, `并有"暂无采样"提示（${count(v4.chartEl,'div')}）`);

console.log('=== 状态条：一行十一个等宽框 ===');
const v5=freshView();
view.drawStatus.call(v5,{collected_at:Math.floor(Date.now()/1000),interval:10,flows:1234,
  dnsmap_lines:5678,pending:3,acct:1,version:'0.1.23-r1'},items);
view.drawSummary.call(v5,[{cap:'Bucket',val:'24'},{cap:'Browser clients',val:'1.2 MiB'},
  {cap:'Router and tunnel',val:'0 B'},{cap:'Client count',val:'12'},{cap:'Apps and sites',val:'7'}]);
const b5=boxes(v5.statusEl);
chk(b5.length===11, `收集器状态 + 窗口合计共 11 个框（${b5.length}）`);
chk(b5[0] && b5[0].cap==='State' && b5[0].val==='Running', `第一格是运行状态（${b5[0]&&b5[0].val}）`);
chk(b5[5] && b5[5].cap==='Collector version', `第六格是采集器版本（${b5[5]&&b5[5].cap}）`);
chk(b5[6] && b5[6].cap==='Bucket',
    `分隔线后第一格是周期（${b5[6]&&b5[6].cap}）｜全表 ${b5.map(b=>b.cap).join('|')}`);
// The two sets have to come out the same width, which is the whole reason they
// are laid out as one flex line: two rows would each share out their own width,
// and six boxes in one against five in the other cannot match.
const kids=v5.statusEl.children;
chk(kids.filter(c=>(c.attrs||{}).class==='tf-stat').length===11 &&
    kids.filter(c=>(c.attrs||{}).class==='tf-stat-sep').length===1,
    '十一个框加一条分隔线，按 6|5 排列');
chk(kids[6] && kids[6].attrs.class==='tf-stat-sep', `分隔线在第 7 个位置（${kids[6]&&kids[6].attrs.class}）`);
// the last box counts the applications the table below is listing, so it has to
// stay last: it is the one reading that describes the rows rather than the bytes
chk(b5[10] && b5[10].cap==='Apps and sites' && b5[10].val==='7',
    `最后一格是应用数（${b5[10]&&b5[10].cap}=${b5[10]&&b5[10].val}）`);
// the strip keeps its shape when only one of the two callers has run
const vOnly=freshView();
view.drawStatus.call(vOnly,{collected_at:Math.floor(Date.now()/1000),interval:10,flows:1,
  dnsmap_lines:1,pending:0,acct:1},items);
chk(boxes(vOnly.statusEl).length===6, `只有收集器状态时 6 个框、无分隔线（${boxes(vOnly.statusEl).length}）`);
chk(!vOnly.statusEl.children.some(c=>(c.attrs||{}).class==='tf-stat-sep'), '缺一组时不画分隔线');
chk(b5.some(b=>b.val==='1234'), '含 conntrack 条目数');
chk(b5.some(b=>b.val==='5678'), '含已解析主机名数');
chk(b5.some(b=>b.cap==='Client totals') && b5.some(b=>b.val==='nft counters'),
    '计数层启用时标明来源为 nft 计数器');

console.log('=== 注释行：条件性读数不进条 ===');
chk(txt(v5.diagEl).indexOf('Waiting to resolve')>=0, `待解析在注释行（${txt(v5.diagEl).trim()}）`);
chk(txt(v5.diagEl).indexOf('3')>=0, '待解析数量可见');
chk(v5.diagCardEl.style.display==='', '注释行有内容时显示');
const v9=freshView();
view.drawStatus.call(v9,{collected_at:Math.floor(Date.now()/1000),interval:10,flows:1,
  dnsmap_lines:1,pending:0,acct:1,version:'0.1.23-r1'},items);
chk(txt(v9.diagEl).trim()==='', '没有条件时不产生注释');
chk(v9.diagCardEl.style.display==='none', '注释行为空时整张卡片隐藏');
// "Bucket" used to label two different readings, which only showed once the two
// strips were merged into one row: the archived-hour count and the hour being
// accumulated.  The second is a tooltip on the first now: as a note of its own it
// put a whole card at the bottom of the page to carry one raw bucket label.
const v10=freshView();
view.drawStatus.call(v10,{collected_at:Math.floor(Date.now()/1000),interval:10,flows:1,
  dnsmap_lines:1,pending:0,acct:1,hour:'2026-09-17T10'},items);
view.drawSummary.call(v10,[{cap:'Bucket',val:'24'},{cap:'Browser clients',val:'1 B'},
  {cap:'Router and tunnel',val:'0 B'},{cap:'Devices',val:'1'}]);
chk(txt(v10.diagEl).trim()==='', '当前小时不再占用注释行');
chk(v10.diagCardEl.style.display==='none', '普通场景下注释卡整张不显示');
const bucketRow=(v10.statusEl.children||[]).filter(c=>(c.attrs||{}).class==='tf-stat')
  .filter(c=>(c.children[0]||{})._text==='Bucket')[0];
chk(bucketRow && String((bucketRow.attrs||{}).title||'').indexOf('2026-09-17T10')>=0,
    `当前小时挂在周期的提示里（${bucketRow&&bucketRow.attrs.title}）`);
chk(boxes(v10.statusEl).filter(b=>b.cap==='Bucket').length===1, '只有一个周期框');
const v8=freshView();
view.drawStatus.call(v8,{collected_at:Math.floor(Date.now()/1000),interval:10,flows:1,
  dnsmap_lines:1,pending:0,acct:0,acct_error:'nft is not installed'},items);
chk(boxes(v8.statusEl).some(b=>b.val==='conntrack'), '降级时条里标明来源为连接跟踪');
chk(txt(v8.diagEl).indexOf('Counter error')>=0 && txt(v8.diagEl).indexOf('nft is not installed')>=0,
    '降级原因在注释行可见（不是静默失败）');
// the box the strip reserved for the box own addresses is gone: it was the one
// reading long enough to force one box wider than the rest
chk(txt(v5.statusEl).indexOf('Router addresses')===-1, '条里不再有路由器自身地址');
chk(!/shortAddrs/.test(src), '不再有只为它存在的缩写函数');
const v6=freshView();
view.drawStatus.call(v6,{collected_at:0,interval:0,flows:0,dnsmap_lines:0,pending:0},[]);
chk(txt(v6.statusEl).indexOf('Collector has not produced a snapshot yet')>=0,
    `无快照时明确提示（${txt(v6.statusEl).slice(0,40)}）`);
chk(boxes(v6.statusEl).length===6, `无快照时六个框仍在（${boxes(v6.statusEl).length}）`);

console.log('=== 速率：两种档位都是相邻快照的实时增量 ===');
// The two figures under 下载/上传 are the difference between two consecutive
// snapshots, in every view.  The ranged view used to divide the window's bytes by
// the window's length instead, which on a real router barely moved - the archive
// only grows as hours are archived - and a rate that sits still next to a total
// that moves reads as a stalled page.  The window's average is still derivable
// from the total and the bucket count, both of which the strip shows.
const flat=n=>{ let s=''; (function go(x){ if(typeof x==='string'){ s+=x; return; } if(x&&x._text)s+=x._text; ((x&&x.children)||[]).forEach(go); })(n); return s; };
const mkView=(o)=>Object.assign(Object.create(view),freshView(),o||{});
const rv=mkView({});
view.renderHourly.call(rv,{hours:[{hour:'h0',apps:[{name:'YouTube',down:36000,up:18000}],clients:[],router:0}]});
chk(flat(rv.rateDown)==='' && flat(rv.rateUp)==='',
    `范围视图不再自己写速率（[${flat(rv.rateDown)}] / [${flat(rv.rateUp)}]）`);
chk(!/average/.test(String((rv.rateDown.attrs||{}).title||'')), '不再有"区间平均"提示');
chk((src.match(/updateRate/g)||[]).length>=3,
    `两条绘制路径共用 updateRate（${(src.match(/updateRate/g)||[]).length} 处）`);
// 20 KiB down and 1 KiB up in a 10 s window
const live=mkView({});
view.updateRate.call(live,{collected_at:1000,totals:{down:1000,up:100}});
chk(flat(live.rateDown)==='0 B/s', `第一次没有前一份快照，速率还是 0（${flat(live.rateDown)}）`);
view.updateRate.call(live,{collected_at:1010,totals:{down:1000+20480,up:100+1024}});
chk(/KiB\/s/.test(flat(live.rateDown)), `10 秒 20 KiB → KiB/s 级下行速率（${flat(live.rateDown)}）`);
chk(/B\/s/.test(flat(live.rateUp)), `上行按同一窗口算（${flat(live.rateUp)}）`);
chk(flat(live.rateDown)!=='0 B/s', `有前一份快照后速率不再停在 0（${flat(live.rateDown)}）`);
// The page polls twice as often as the collector writes, so every other poll
// hands back the very same snapshot.  That must keep the figure rather than
// divide by a zero interval, which would flash 0 B/s every five seconds.
view.updateRate.call(live,{collected_at:1010,totals:{down:1000+20480,up:100+1024}});
chk(flat(live.rateDown)==='2.00 KiB/s',
    `同一份快照再轮询一次，速率不变（${flat(live.rateDown)}）`);
// A snapshot that really is ten seconds later with nothing in it is a zero rate:
// the honest reading, and not the case above.
view.updateRate.call(live,{collected_at:1020,totals:{down:1000+20480,up:100+1024}});
chk(flat(live.rateDown)==='0 B/s', `十秒内没有新流量就是 0（${flat(live.rateDown)}）`);

console.log('=== 页面结构：一个下拉、列宽在 colgroup ===');
const page=view.render.call(Object.assign(Object.create(view),freshView()),{});
const colClasses=[]; walk(page,n=>{ if(n.tag==='col') colClasses.push((n.attrs||{}).class); });
chk(colClasses.length===6, `表格有 6 个 <col>（${colClasses.length}）`);
chk(colClasses[0]==='tf-col-app', `首个 <col> 是名称列（${colClasses[0]}）`);
// 固定布局下 col 才是浏览器真正采用的宽度，主题对 th/td 的规则够不到它，
// 名称列不会又被压成省略号而字节列占掉整张卡片
const selects=[]; walk(page,n=>{ if(n.tag==='select') selects.push(n); });
chk(selects.length===0, `页面不再有原生 <select>（${selects.length} 个）`);
const ddBtn=[]; walk(page,n=>{ if(n.tag==='button'&&/tf-dd-btn/.test((n.attrs||{}).class||'')) ddBtn.push(n); });
chk(ddBtn.length===1, `范围控件是自绘按钮（${ddBtn.length} 个）`);
chk(/listbox/.test(String((ddBtn[0]&&ddBtn[0].attrs||{}).role||'')+String((ddBtn[0]&&ddBtn[0].attrs||{})['aria-haspopup']||'')),
    '自绘下拉带 listbox 语义');
const ddItems=[]; walk(page,n=>{ if(/tf-dd-item/.test((n.attrs||{}).class||'')) ddItems.push(n); });
chk(ddItems.length===5, `下拉有 5 个区间选项（${ddItems.length}）`);
// The hero lays its three captions out on one row and the three readings on the
// next.  Three caption/reading pairs as their own columns read worse: with the
// bottoms aligned the captions come out at three different heights, because a
// 1.7rem line box and a 1.05rem one do not start at the same y.
const heroStats=[]; walk(page,n=>{ if((n.attrs||{}).class==='tf-hero-stats') heroStats.push(n); });
chk(heroStats.length===1, `hero 是一个网格（${heroStats.length}）`);
chk(heroStats[0] && heroStats[0].children.length===6,
    `网格里 6 个单元：三个标题在前、三个读数在后（${heroStats[0]&&heroStats[0].children.length}）`);
const heroOrder=(heroStats[0]?heroStats[0].children:[]).map(c=>(c.attrs||{}).class);
chk(heroOrder.slice(0,3).every(c=>/tf-hero-cap/.test(c)),
    `前三格都是标题（${heroOrder.slice(0,3).join(' / ')}）`);
chk(/tf-grand-total/.test(heroOrder[3]||'') && /tf-rate/.test(heroOrder[4]||'') && /tf-rate/.test(heroOrder[5]||''),
    `后三格是总计、下行、上行（${heroOrder.slice(3).join(' / ')}）`);
// the two cards the merge produced: one strip, and the note line under the table
const cardClasses=[]; walk(page,n=>{ if(/tf-card/.test((n.attrs||{}).class||'')) cardClasses.push((n.attrs||{}).class); });
chk(cardClasses.some(c=>/tf-stat-card/.test(c)), '有状态条卡片');
chk(cardClasses.some(c=>/tf-diag-card/.test(c)), '有表格下的注释行卡片');
chk(!cardClasses.some(c=>/tf-status-card|tf-meta-card/.test(c)), '原来的两张卡片已合并，不再存在');
// the donut has a hole to put the total in
const donutCenter=[]; walk(page,n=>{ if((n.attrs||{}).class==='tf-donut-center') donutCenter.push(n); });
chk(donutCenter.length===1 && donutCenter[0].children.length===2,
    `环形图中心有总计+标题两层（${donutCenter.length}）`);

console.log('=== 档位跟随范围，默认一天 ===');
const pv=Object.assign(Object.create(view),freshView());
view.render.call(pv,{});
chk(pv.range==='24', `默认范围是一天（${pv.range}）`);
chk(pv.seriesRange==='24h', `曲线默认读 24 小时档（${pv.seriesRange}）`);
// 每一个窗口档都要落到它自己的粒度
for(const [r,want] of [['1','1h'],['12','12h'],['24','24h'],['168','7d']]){
  pv.setSeriesRange('1h');
  pv.setRange(r);
  chk(pv.seriesRange===want, `范围 ${r} → 档位 ${want}（${pv.seriesRange}）`);
}
// "本次启动以来"不是窗口：曲线保持一天，不缩成 1 小时
pv.setSeriesRange('1h');
pv.setRange('session');
chk(pv.seriesRange==='24h', `会话档的曲线仍是 24 小时（${pv.seriesRange}）`);

console.log('=== 注入的 CSS：括号平衡与圆润控件 ===');
// render() already injects once, so reset: otherwise these assertions run against
// two concatenated copies and a single replace() no longer removes every match
global.__capturedCss='';
global.__injectCss();
const css=global.__capturedCss||'';
chk(css.length>1500, `样式表已注入（${css.length} 字符）`);
const open=(css.match(/\{/g)||[]).length, close=(css.match(/\}/g)||[]).length;
chk(open===close, `大括号平衡（{ ${open} / } ${close}）`);
chk(!/;\s*;/.test(css), '没有连续分号（空声明）');
// The phone hero keeps the total on a row of its own: its caption and its figure
// each span both columns, so the figure cannot be squeezed beside the caption by
// the grid's auto first column.  That squeeze is what "总计" sitting far left of
// "354 MiB" on one row looked like at 486px, and the 1.45rem shrink was there to
// work around the same narrow column, so it goes with the fix.
chk(/\.tf-page \.tf-hero-stats\{grid-template-columns:1fr 1fr;/.test(css) &&
    /\.tf-page \.tf-hero-stats>\*:nth-child\(1\)\{grid-area:1\/1\/2\/3;\}/.test(css) &&
    /\.tf-page \.tf-hero-stats>\*:nth-child\(4\)\{grid-area:2\/1\/3\/3;\}/.test(css) &&
    !/\.tf-page \.tf-grand-total\{font-size:1\.45rem;\}/.test(css),
    '窄屏 hero：总计标签与数值各占整行，不再缩小字号');
// The hairline between 下载 and 上传 is drawn by the same pseudo-element at every
// width: between columns two and three on a wide screen, and on the two rows the
// rates occupy on a phone.  One of the two missing is the bug this guards.
const heroLine=(css.match(/\.tf-page \.tf-hero-stats::after\{[^}]*\}/g)||[]);
chk(heroLine.length===2 && /grid-area:1\/2\/3\/3/.test(heroLine[0]) &&
    /grid-area:3\/1\/5\/2/.test(heroLine[1]),
    `hero 分隔线在两种宽度各就位（${heroLine.length} 条：${heroLine.map(s=>(s.match(/grid-area:[^;]*/)||[''])[0]).join(' / ')}）`);
// The page carries one range control, not two: the chart tier is derived from
// the range, so the only dropdown on the page is the picker in the hero.
for(const sel of ['.tf-page .tf-range','.tf-page .tf-dd-menu','.tf-page .tf-col-app',
                  '.tf-page .tf-stat-strip','.tf-page .tf-stat-sep','.tf-page .tf-diag',
                  '.tf-page .tf-hero-stats','.tf-page .tf-donut-center',
                  '.tf-page .tf-curve-down','.tf-page .tf-curve-up',
                  '.tf-page .tf-area-down','.tf-page .tf-area-up']){
  const re=new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\{([^}]*)\\}');
  chk(re.test(css), `有 ${sel} 规则`);
}
chk(!/\.tf-chart-ctl/.test(css), '图表上重复的档位控件已移除');
// The pill shape comes from the .tf-range rule that both dropdowns share, which
// is what makes the chart control read as the same control as the one in the
// hero rather than a second, differently-styled select.
const pill=css.match(/\.tf-page \.tf-range\{([^}]*)\}/);
chk(!!pill && /border-radius:999px/.test(pill[1]), '.tf-range 是圆角（999px 药丸形）');
// A presentation attribute cannot read a custom property, so every colour the
// page draws has to come from a rule: the curve kept its light-mode blue on a
// dark page until these four moved out of the SVG attributes.
chk(/--tf-area-down/.test(css) && /--tf-area-up/.test(css), '曲线填充色有深浅两套变量');
const hardDown=(css.match(/#00a8e8/g)||[]).length;
const varDown=(css.match(/--tf-down:#00a8e8;/g)||[]).length;
chk(hardDown===varDown, `写死的下行色只出现在变量定义里（共 ${hardDown} 处，其中 ${varDown} 处是定义）`);
const hardUp=(css.match(/#26c281/g)||[]).length;
const varUp=(css.match(/--tf-up:#26c281;/g)||[]).length;
chk(hardUp===varUp, `写死的上行色只出现在变量定义里（共 ${hardUp} 处，其中 ${varUp} 处是定义）`);
// the strip has to reach both edges without leaving a ragged gap, and the boxes
// have to stay the same size
const statRule=css.match(/\.tf-page \.tf-stat\{([^}]*)\}/);
chk(!!statRule && /flex:1 1/.test(statRule[1]) && /min-width/.test(statRule[1]),
    '数据框按 flex-basis 分配、有最小宽度');
// The page must style its own controls and nothing else: a rule against a LuCI
// core class would restyle the core view action buttons on every other page.
// The buttons here therefore carry app classes (tf-*) rather than core ones.
chk(css.indexOf('.cbi-')===-1, '样式表没有改写任何 LuCI 核心类选择器');
chk(!/\.cbi-/.test(css) && !/cbi-button/.test(css), '未提及核心按钮类');
// keyboard users still need a visible focus ring on the dropdowns that no
// longer inherit one from a core control class
chk(/\.tf-range:focus-visible/.test(css) && /outline:2px solid/.test(css),
    '自绘控件保留了键盘焦点环');
// The same rule as above, enforced over the whole sheet rather than one class:
// every selector has to be anchored on this page own classes (tf-*), including
// the dark-mode ones, so no part of the stylesheet can reach core markup.
const bare=(()=>{
  const body=css.replace(/\/\*[\s\S]*?\*\//g,'');
  const out=[];
  for(const chunk of body.split('}')){
    const i=chunk.lastIndexOf('{');
    if(i<0) continue;
    for(const sel of chunk.slice(0,i).split(',')){
      const s=sel.trim();
      if(s && !/\.tf-/.test(s)) out.push(s);
    }
  }
  return out;
})();
chk(bare.length===0, `所有选择器都以 tf-* 约束（未约束 ${bare.length} 条${bare.length?': '+bare.slice(0,3).join(' / '):''}）`);
chk(/appearance:none/.test(css), '下拉框去掉了原生外观（才能自绘圆角箭头）');
chk(/data:image\/svg\+xml/.test(css), '用了内联 SVG 箭头（无额外请求）');
const darkRules=(css.match(/\.dark \.tf-page \.tf-range/g)||[]).length;
chk(darkRules>=1, '深色模式箭头单独覆盖');
chk(!/\.tf-page, \[data-darkmode[^{]*\.tf-range/.test(css), '深色后代选择器没有错误地只作用于列表最后一项');

console.log('=== 权威总量：有 iface 用接口计数，无 iface 回退归属值 ===');
// 页面此前把各应用归属字节的求和当作「总计」显示。开流卸载时 netfilter/conntrack
// 被绕过，那个求和只有实际承载量的百分之几（实测 147 MiB vs 2579 MiB），而页面上
// 没有任何东西说明这一点。采集器现在把 /proc/net/dev 的接口计数放进 summary.iface，
// 那是开不开卸载都准确的会话总量；没有该字段时必须原样回退到 totals。
const TOT={down:2.0e8,up:5.0e7,router:1e7,client_count:7,exact:10,bucket:5,residual:3};
const IFACE={dev:'eth2',down:3.0e9,up:1.0e9};
const ATTR=TOT.down+TOT.up, CARRIED=IFACE.down+IFACE.up;
const sharePct=(100*ATTR/CARRIED).toFixed(1)+'%';
const sumOf=(o)=>Object.assign({collected_at:1700000000,interval:10,flows:10,dnsmap_lines:10,
  pending:0,acct:1,version:'0.1.90-r1',hour:'2026-09-17T10',totals:TOT,
  clients:[{name:'Mac',ip:'192.168.2.21',bytes:1.5e8}],apps:[]},o||{});

const vIf=mkView({});
view.renderLive.call(vIf, sumOf({iface:IFACE,offload:1}));
chk(flat(vIf.totalEl)==='3.73 GiB', `总计取接口计数而不是归属值（${flat(vIf.totalEl)}）`);
chk(flat(vIf.grandRow.cells.down)==='2.79 GiB' && flat(vIf.grandRow.cells.up)==='954 MiB',
    `总行下载/上传也取接口计数（${flat(vIf.grandRow.cells.down)} / ${flat(vIf.grandRow.cells.up)}）`);
chk(flat(vIf.heroCapEl)==='total', `总计确实来自接口时标题才是「总计」（${flat(vIf.heroCapEl)}）`);
// 环形图的读数现在与它的扇形同源——都是总计，环画的是整个窗口的构成，所以环心必须
// 是被切的那个数，而不是各段之和；标题也跟着总量的来源走，与 hero 用同一个词。
// render() 建出环心的两个节点，draw() 才写它们，所以这里两个都要跑：标题取自真正
// 建出来的节点，而不是测试自己搭的替身。
const vIfPage=mkView({});
view.render.call(vIfPage,{});
view.renderLive.call(vIfPage, sumOf({iface:IFACE,offload:1}));
const dcap=[]; walk(vIfPage.donutEl,n=>{ if((n.attrs||{}).class==='tf-donut-cap') dcap.push(n); });
chk(flat(vIfPage.donutTotalEl)===flat(vIfPage.totalEl) && flat(vIfPage.donutTotalEl)==='3.73 GiB' &&
    dcap.length===1 && flat(dcap[0])==='total',
    `环形图中心是总计，与 hero 同数同词（${flat(vIfPage.donutTotalEl)} / ${flat(dcap[0])}）`);
// 环形图右侧的清单标题不能沿用表头那份「应用」，也不再是「已归属流量」：环里现在
// 有未归属那一段，这份清单是整张环的构成
const pageIf=view.render.call(Object.assign(Object.create(view),freshView()),{});
const lcap=[]; walk(pageIf,n=>{ if((n.attrs||{}).class==='tf-legend-cap') lcap.push(n); });
chk(lcap.length===1 && flat(lcap[0])==='Traffic breakdown',
    `环形图清单标题是「流量构成」，不再是「已归属流量」或「应用」（${flat(lcap[0])}）`);
// 已归属 X%：本次运行里归属层能说出名字的流量占实际承载的比例
chk(txt(vIf.diagEl).indexOf('Attributed')>=0 && txt(vIf.diagEl).indexOf(sharePct)>=0,
    `诊断行给出已归属占比 ${sharePct}（${txt(vIf.diagEl).trim()}）`);
const aRow=(vIf.diagRows||[]).filter(r=>r.k&&r.k._text==='Attributed')[0];
chk(aRow && /tf-warn/.test(aRow.v.className), '占比过低时该行是告警色（不是静默）');
// 卸载告警整段被删掉了：它把采集器的一个内部状态（offload）摆到读者看数字的地方，
// 而「总量到底来自接口计数还是归属值」现在由标题自己说了（总计 / 已归属），不再需要
// 一句告警来解释。所以会话视图与范围视图、offload=1 与 offload=0，四种组合下诊断区
// 都不该出现这套文案。断言是反向的：断言它不在，而不是把断言删掉——删掉就再也看不见
// 它回来了。
const OFFLOAD_WORDS=['flow offloading is on','Counter mode','Counting mode','计数口径'];
const offloadWords=t=>OFFLOAD_WORDS.filter(w=>t.indexOf(w)>=0);
// 非空前提：同一份快照下诊断区确实在渲染内容，否则「没有告警」是空集上的真命题
chk(txt(vIf.diagEl).indexOf('Attributed')>=0,
    `会话视图诊断区非空，下面的「没有告警」才不是空集（${txt(vIf.diagEl).trim()}）`);
chk(offloadWords(txt(vIf.diagEl)).length===0,
    `offload=1 时会话视图没有卸载文案（${txt(vIf.diagEl).trim()}）`);
const vIf0=mkView({});
view.renderLive.call(vIf0, sumOf({iface:IFACE,offload:0}));
chk(offloadWords(txt(vIf0.diagEl)).length===0,
    `offload=0 时也没有（两种取值都不出现：${txt(vIf0.diagEl).trim()}）`);

const vNo=mkView({});
view.renderLive.call(vNo, sumOf({}));
chk(flat(vNo.totalEl)==='238 MiB' && flat(vNo.grandRow.cells.total)==='238 MiB',
    `没有 iface 时回退到 totals（${flat(vNo.totalEl)}）`);
// 边界：iface 存在但计数全为 0（刚开机/刚重置）以及 iface 里是垃圾值，都不能变成 NaN
const vZero=mkView({});
view.renderLive.call(vZero, sumOf({iface:{dev:'eth2',down:0,up:0}}));
chk(flat(vZero.totalEl)==='0 B' && flat(vZero.totalEl).indexOf('NaN')===-1,
    `计数为 0 时是 0 B 而不是 NaN（${flat(vZero.totalEl)}）`);
chk(txt(vZero.diagEl).indexOf('Attributed')===-1, '承载量为 0 时不给出除零的占比');
const vJunk=mkView({});
view.renderLive.call(vJunk, sumOf({iface:{dev:'eth2',down:'x',up:null}}));
chk(flat(vJunk.totalEl)==='238 MiB' && flat(vJunk.totalEl).indexOf('NaN')===-1,
    `iface 是非法值时回退到 totals（${flat(vJunk.totalEl)}）`);
chk(flat(vNo.heroCapEl)==='Attributed' && flat(vNo.grandRow.label)==='Attributed',
    `归属值不再自称「总计」（${flat(vNo.heroCapEl)} / ${flat(vNo.grandRow.label)}）`);
chk(txt(vNo.diagEl).indexOf('Attributed')===-1 && flat(vNo.donutTotalEl)==='238 MiB',
    '没有 iface 时不编造已归属占比，环形图读数不变');

console.log('=== 环形图代表总计：一段未归属，全卡只有一个分母 ===');
// 同一张卡上出现两个分母正是这次要修的毛病：环曾经 100% = 已归属的 2.78 GiB，而它
// 上面那行写着 7.32 GiB，于是 SSL/TLS 在同一张卡上既是 46.1% 又是 17.5%，页面上没
// 有任何东西说明那个 100% 是谁的。现在环的每一段都除以总计，未归属占掉剩下的部分，
// 环仍是一整圈，图例与表格也改用同一个分母。
// 12 个应用（前十名之外还有两个）加一个远大于归属值的接口计数，一次覆盖三种段：
// 前十名、其余应用、未归属。
const BIGAPPS=Array.from({length:12},(_,i)=>({name:'App'+String(i+1).padStart(2,'0'),
  down:(12-i)*8e7, up:(12-i)*2e7, clients:i, top:'', top_bytes:0}));
const BIGDOWN=BIGAPPS.reduce((s,a)=>s+a.down,0);
const BIGUP=BIGAPPS.reduce((s,a)=>s+a.up,0);
const BIGATTR=BIGDOWN+BIGUP;                       // 7.8e9
const BIGIFACE={dev:'eth2',down:10e9,up:4e9};
const BIGTOTAL=BIGIFACE.down+BIGIFACE.up;          // 1.4e10
const BIGUNATTR=BIGTOTAL-BIGATTR;                  // 6.2e9 → 44.3%
const DONUT_C=2*Math.PI*74;                        // makeDonut 里 r=(168-20)/2
// 每一段是一个 circle：dasharray 的长度是它画出来的弧，dashoffset 是它起点离圆周零点
// 的距离。每段被缩短 2px 作分隔，所以 (len + 2) / C 是它真正占圆周的比例；而最后一段
// 的终点离起点应当正好是那 2px——这就是「环是闭合的一圈」在这次改动里的可测量形式。
const slices=v=>{ const out=[]; walk(v.donutEl,n=>{ if(n.tag==='circle'&&(n.attrs||{}).stroke){
  const a=String(n.attrs['stroke-dasharray']).split(' ');
  out.push({ stroke:String(n.attrs.stroke), len:parseFloat(a[0]),
    off:Math.max(-(parseFloat(n.attrs['stroke-dashoffset'])||0),0) }); } }); return out; };
const fracOf=s=>(s.len+2)/DONUT_C;
const ringEnd=bs=>bs.length?bs[bs.length-1].off+bs[bs.length-1].len:0;
const closed=bs=>bs.length>0 && Math.abs(ringEnd(bs)-(DONUT_C-2))<1;
const PALCOL=((src.match(/var PALETTE = \[([\s\S]*?)\];/)||[])[1]||'').match(/#[0-9a-f]{6}/g)||[];
const GREY='#9aa5b1';
const greyOf=bs=>bs.filter(s=>s.stroke.toLowerCase()===GREY);
const rowByText=(v,name)=>(v.rowsEl.children||[]).filter(tr=>tr.tag==='tr' &&
  flat((tr.children||[])[0]||{}).indexOf(name)>=0)[0]||null;
const legendRows=v=>{ const out=[]; (v.legendEl.children||[]).forEach(r=>{
  const kids=r.children||[];
  const nm=kids.filter(c=>(c.attrs||{}).class==='tf-legend-name')[0];
  const pc=kids.filter(c=>(c.attrs||{}).class==='tf-legend-pct')[0];
  const dt=kids.filter(c=>(c.attrs||{}).class==='tf-legend-dot')[0];
  out.push({ name:nm?flat(nm):'', pct:pc?flat(pc):'', dot:((dt||{}).attrs||{}).style||'' });
}); return out; };

const vBig=mkView({});
view.render.call(vBig,{});        // 环心与图例的节点由 render() 建，draw() 才写它们
view.renderLive.call(vBig, sumOf({apps:BIGAPPS, iface:BIGIFACE, offload:1,
  totals:{down:BIGDOWN,up:BIGUP,router:0,client_count:1,exact:1,bucket:1,residual:0}}));
const bs=slices(vBig), bg=greyOf(bs);
// 旧口径下这里只有 11 段（前十名 + 其余应用），而且环的 100% 是 7.8e9 而不是 1.4e10
chk(bs.length===12 && bg.length===1 && PALCOL.indexOf(GREY)===-1 &&
    Math.abs(fracOf(bg[0])-BIGUNATTR/BIGTOTAL)<0.002 && closed(bs),
    `环 = 前十名 + 其余应用 + 未归属 共 12 段，未归属是唯一的中性灰段并占 ${(100*BIGUNATTR/BIGTOTAL).toFixed(1)}%，各段收成整圈（段 ${bs.length}，灰 ${bg.length}${bg.length?'='+(100*fracOf(bg[0])).toFixed(1)+'%':''}，终点离起点 ${bs.length?(DONUT_C-ringEnd(bs)).toFixed(1):'—'}px）`);
// 最大一段的弧长按总计算：旧口径下它是 15.4%（对 7.8e9），不是 8.6%
chk(bs.length>0 && Math.abs(fracOf(bs[0])-(BIGAPPS[0].down+BIGAPPS[0].up)/BIGTOTAL)<0.002,
    `第一段的弧长 = 该应用字节 / 总计（${bs.length?(100*fracOf(bs[0])).toFixed(1):'—'}%，应为 8.6%）`);
const bigCaps=[]; walk(vBig.donutEl,n=>{ if((n.attrs||{}).class==='tf-donut-cap') bigCaps.push(n); });
chk(flat(vBig.donutTotalEl)==='13.0 GiB' && flat(vBig.totalEl)==='13.0 GiB' &&
    bigCaps.length===1 && flat(bigCaps[0])==='total',
    `环心就是 hero 那个总计，同数同词（${flat(vBig.donutTotalEl)} / ${bigCaps.length?flat(bigCaps[0]):'（无）'}）`);
// 表格：一行未归属，字节 = 总计 − 已归属，百分比同样对总计
const uRow=rowByText(vBig,'Unattributed');
chk(!!uRow && flat(uRow.children[1])==='5.77 GiB (44.3%)',
    `表格里有一行未归属、字节 = 总计 − 已归属（${uRow?flat(uRow.children[1]):'（没有这一行）'}）`);
// 它紧跟「所有流量」那一行：合计行的余数就该在合计行旁边，而不是在 300 行之下的表尾
const btrs=(vBig.rowsEl.children||[]).filter(c=>c.tag==='tr');
chk(btrs.length>1 && /tf-grand/.test((btrs[0].attrs||{}).class||'') &&
    /tf-unattr/.test((btrs[1].attrs||{}).class||''),
    `未归属那一行紧跟所有流量（第 1 行 ${btrs[0]&&(btrs[0].attrs||{}).class} / 第 2 行 ${btrs[1]&&(btrs[1].attrs||{}).class}）`);
const a1Row=rowByText(vBig,'App01');
chk(!!a1Row && flat(a1Row.children[1])==='1.12 GiB (8.6%)',
    `应用行的百分比也按总计算（${a1Row?flat(a1Row.children[1]):'（没有这一行）'}，旧口径是 15.4%）`);
// 图例：列出全部 12 段（含其余应用与未归属），百分比因此合计 100%
const lg=legendRows(vBig);
const lsum=lg.reduce((s,r)=>s+parseFloat(r.pct),0);
chk(lg.length===12 && Math.abs(lsum-100)<0.15,
    `图例列出全部 12 段、百分比合计 ${lsum.toFixed(1)}%（旧口径只列前十名，合计到不了 100%）`);
const lgU=lg.filter(r=>r.name==='Unattributed')[0];
chk(!!lgU && lgU.pct==='44.3%' && lgU.dot.indexOf(GREY)>=0,
    `图例里未归属那行用同一段灰、同一个分母（${lgU?lgU.name+' '+lgU.pct+' / '+lgU.dot:'（没有这一行）'}）`);

console.log('=== 范围视图：归档带设备行才多出未归属，不带就一段不多 ===');
// 范围视图的底数可以是本范围自己的设备计数（归档每小时一行 wan）。那种情况下环同样
// 要有一段未归属；而归档里没有设备行时，总量就是归属值，未归属为 0，环必须与旧口径
// 一模一样——既不能多出 0% 的切片，也不能少画一段。
const RH2=iface=>[{hour:'h0',apps:[{name:'YouTube',down:36000,up:18000},
  {name:'QUIC',down:1000,up:500}],clients:[],router:0,iface:iface}];
const RDOWN=3e6, RUP=1e6, RTOTAL=RDOWN+RUP, RATTR=36000+18000+1000+500;
const vRIf=mkView({});
view.renderHourly.call(vRIf,{hours:RH2({dev:'wan',down:RDOWN,up:RUP})});
const rs=slices(vRIf), rg=greyOf(rs);
chk(rs.length===3 && rg.length===1 &&
    Math.abs(fracOf(rg[0])-(RTOTAL-RATTR)/RTOTAL)<0.002 && closed(rs),
    `范围视图的环也以本范围的设备计数为底，未归属占 ${(100*(RTOTAL-RATTR)/RTOTAL).toFixed(1)}%，各段收成整圈（段 ${rs.length}，灰 ${rg.length}，终点离起点 ${rs.length?(DONUT_C-ringEnd(rs)).toFixed(1):'—'}px）`);
const vRNo=mkView({});
view.renderHourly.call(vRNo,{hours:RH2(undefined)});
const ns=slices(vRNo);
chk(ns.length===2 && greyOf(ns).length===0 && closed(ns) &&
    flat(vRNo.donutTotalEl)==='54.2 KiB' && flat(vRNo.totalEl)==='54.2 KiB',
    `归档没有设备行时未归属 = 0：不多画 0% 的切片，环与旧口径完全一致（段 ${ns.length}，灰 ${greyOf(ns).length}，终点离起点 ${ns.length?(DONUT_C-ringEnd(ns)).toFixed(1):'—'}px，环心 ${flat(vRNo.donutTotalEl)}）`);

console.log('=== 实时速率：优先接口增量，且不跨来源相减 ===');
const rIf=mkView({});
view.updateRate.call(rIf, sumOf({iface:IFACE}));
view.updateRate.call(rIf, sumOf({collected_at:1700000010,
  iface:{dev:'eth2',down:IFACE.down+20480,up:IFACE.up+1024}}));
chk(/KiB\/s/.test(flat(rIf.rateDown)) && /B\/s/.test(flat(rIf.rateUp)),
    `速率由接口增量算出（${flat(rIf.rateDown)} / ${flat(rIf.rateUp)}）`);
// 接口计数不变而归属值暴涨：若速率还从 totals 取，这里会读出一个巨大的假速率
const rMix=mkView({});
view.updateRate.call(rMix, {collected_at:1700000000,iface:{down:1000,up:100},totals:{down:0,up:0}});
view.updateRate.call(rMix, {collected_at:1700000010,iface:{down:1000,up:100},totals:{down:1e9,up:1e8}});
chk(flat(rMix.rateDown)==='0 B/s' && flat(rMix.rateUp)==='0 B/s',
    `接口计数没动就是 0（${flat(rMix.rateDown)} / ${flat(rMix.rateUp)}）`);

console.log('=== 协议桶与应用同表列出（不再单独成块）===');
// SSL/TLS、QUIC、HTTP、DNS、STUN 这些「应用名」其实是归属的兜底标签，占了归属流量
// 的三分之一左右。曾经把它们从表里摘出来、放进表下独立的「协议（非应用）」区块，
// 那个版本被否掉了：在开卸载的路由器上，相当大的一部分流量就落在 SSL/TLS / QUIC /
// Other 上，摘走之后表格加起来远小于它上面的总量，而读者用的本来就是「一张按字节
// 排序的单一列表」。页面代码里 isProto() 现在恒为 false，协议桶照旧是应用表的行；
// 表下那个区块还留在 DOM 里（renderProto 仍会被调用一次），但恒收到空数组，所以
// 恒为空、恒隐藏。下面这些断言是反向的：它们证明协议桶确实回到了应用表，而区块
// 确实空了——把回归弄瞎的做法是删断言，不是这么写。
const PICKS=[{name:'YouTube',down:1e6,up:1e5,clients:3,top:'192.168.2.5',top_bytes:5e5},
             {name:'QUIC',down:6e5,up:1e4,proto:1},
             {name:'DNS',down:2e5,up:1e4,proto:1}];
const inRows=(v,n)=>!!(v.rowCache||{})[n];
const rowCls=(v,n)=>((v.rowCache||{})[n]||{tr:{attrs:{}}}).tr.attrs.class||'';
const vP=mkView({});
view.renderLive.call(vP, sumOf({apps:PICKS,
  totals:Object.assign({},TOT,{down:1.8e6,up:1.2e5}),
  clients:[{name:'Mac',ip:'192.168.2.21',bytes:1e6}]}));
chk(inRows(vP,'QUIC') && inRows(vP,'DNS') && inRows(vP,'YouTube'),
    `协议桶与应用同表列出（表内：${Object.keys(vP.rowCache||{}).join('|')}）`);
// 名字是 span 里的裸字符串，txt() 只收 _text，所以在 table 上必须用 flat()
const tableRows=(vP.rowsEl.children||[]).filter(c=>c.tag==='tr' &&
  !/tf-grand/.test((c.attrs||{}).class||'') && !/tf-unattr/.test((c.attrs||{}).class||''));
chk(Object.keys(vP.rowCache||{}).length===PICKS.length && tableRows.length===PICKS.length,
    `表格里真有一行一条，一个都没被摘走（rowCache ${Object.keys(vP.rowCache||{}).length}，<tr> ${tableRows.length}/${PICKS.length}）`);
chk(flat(vP.rowsEl).indexOf('QUIC')>=0 && flat(vP.rowsEl).indexOf('DNS')>=0,
    `应用表的文本里能看到协议桶（${flat(vP.rowsEl).trim().slice(-64)}）`);
// 「是个桶」和「不是应用」现在是两件事：表里的协议桶行仍带桶标记（斜体名与字形靠
// 它），只是它不再是一个单独区块里的行
chk(/tf-isbucket/.test(rowCls(vP,'QUIC')) && !/tf-isbucket/.test(rowCls(vP,'YouTube')),
    `表里协议桶行带桶标记、真应用不带（QUIC=${rowCls(vP,'QUIC')} / YouTube=${rowCls(vP,'YouTube')||'（空）'}）`);
chk(Object.keys(vP.protoRows||{}).length===0 && vP.protoEl.style.display==='none',
    `表下的协议区块恒为空且恒隐藏（protoRows=${Object.keys(vP.protoRows||{}).length}, display=${vP.protoEl.style.display}）`);
chk(flat(vP.protoListEl).trim()==='', `协议区块里没有任何条目（${flat(vP.protoListEl).trim()||'（空）'}）`);
chk((boxes(vP.statusEl).filter(b=>b.cap==='Apps and sites')[0]||{}).val==='1',
    `「应用与站点」格数只算应用和站点（${(boxes(vP.statusEl).filter(b=>b.cap==='Apps and sites')[0]||{}).val}）`);
// 环形图的清单是「已归属流量」的构成。isProto 恒 false 之后协议桶在里面就是普通
// 一行；若它还带桶标记，同一份清单和下面那张表就会把 QUIC 分成两种东西
const legProto=(vP.legendCache||{})['QUIC'];
chk(!!legProto && /tf-isbucket/.test((legProto.row.attrs||{}).class||''),
    `环形图清单里协议桶有桶标记（${legProto&&legProto.row.attrs.class}）`);
chk(!!vP.legendCache['YouTube'] && !/tf-isbucket/.test((vP.legendCache['YouTube'].row.attrs||{}).class||''),
    '环形图清单里真应用也不带桶标记');
const vP0=mkView({});
view.renderLive.call(vP0, sumOf({apps:[{name:'YouTube',down:1e6,up:1e5}]}));
chk(!!vP0.protoEl && vP0.protoEl.style.display==='none' &&
    Object.keys(vP0.protoRows||{}).length===0, '没有协议桶时整个区块同样隐藏（与上面一致）');
// 归档的小时行只有名字、没有 proto 标记：范围视图走的也是同一条路，QUIC 照旧进应用表
const vPH=mkView({});
view.renderHourly.call(vPH,{hours:[{hour:'h0',apps:[{name:'YouTube',down:36000,up:18000},
  {name:'QUIC',down:1000,up:500}],clients:[],router:0}]});
chk(inRows(vPH,'QUIC') && inRows(vPH,'YouTube') && Object.keys(vPH.protoRows||{}).length===0 &&
    vPH.protoEl.style.display==='none',
    `范围视图同样把协议桶列进应用表（表内：${Object.keys(vPH.rowCache||{}).join('|')}）`);

console.log('=== 热门客户端：跨窗口的荒谬百分比不再印出 ===');
// 归档里的 apptop 存的是会话累计的客户端字节，而同一行的小时字节只是那一小时；
// 两者相除就是 114.7%/2458% 这种「占比」的来源。
const vT=mkView({});
view.draw.call(vT,[{name:'YouTube',down:1e6,up:0,bytes:1e6,clients:2,top:'192.168.2.9',top_bytes:5e8}],
  {total:1e6,down:1e6,up:0,topText:'—',clientCount:2});
chk(/%/.test(flat(vT.rowCache['YouTube'].cells.top))===false &&
    flat(vT.rowCache['YouTube'].cells.top).indexOf('192.168.2.9')>=0,
    `客户端字节大于本行字节时不再给出比例（${flat(vT.rowCache['YouTube'].cells.top)}）`);
const vT2=mkView({});
view.draw.call(vT2,[{name:'YouTube',down:1e6,up:0,bytes:1e6,clients:2,top:'192.168.2.9',top_bytes:5e5}],
  {total:1e6,down:1e6,up:0,topText:'—',clientCount:2});
chk(/\(50\.0%\)/.test(flat(vT2.rowCache['YouTube'].cells.top)),
    `同一窗口内的比例照常给出（${flat(vT2.rowCache['YouTube'].cells.top)}）`);
const vG=mkView({});
view.renderLive.call(vG, sumOf({clients:[{name:'Mac',ip:'192.168.2.21',bytes:4e8}]}));
chk(/%/.test(flat(vG.grandRow.cells.top))===false && flat(vG.grandRow.cells.top).indexOf('Mac')>=0,
    `总行的客户端占比超过 100% 时同样不印（${flat(vG.grandRow.cells.top)}）`);
const vG2=mkView({});
view.renderLive.call(vG2, sumOf({totals:Object.assign({},TOT,{client_bytes:2.5e8}),
  clients:[{name:'Mac',ip:'192.168.2.21',bytes:1.5e8}]}));
chk(/\(60\.0%\)/.test(flat(vG2.grandRow.cells.top)),
    `总行以同来源的客户端总量计算占比（${flat(vG2.grandRow.cells.top)}）`);
const vG3=mkView({});
view.renderLive.call(vG3,sumOf({clients:[{name:'Mac',ip:'192.168.2.21',bytes:1.5e8}]}));
chk(!/%/.test(flat(vG3.grandRow.cells.top)),
  '后端尚无客户端总量时不拿应用归属量充当分母');
// 合计行的热门客户端属于该行自己的窗口，单元格自己说明是哪一个
chk(String((vG2.grandRow.cells.top.attrs||{}).title||'').indexOf('current run')>=0,
    `会话视图合计行的客户端标注为本次运行（${(vG2.grandRow.cells.top.attrs||{}).title}）`);

console.log('=== 会话/范围分界：范围视图绝不借用会话 iface ===');
// iface 是 /proc/net/dev 的会话累计，归档小时来自归属层（roll_hour 存的是
// totals.tsv），所以范围视图没有对应的接口总量。把会话总量放到 7 天标签下会是
// 一个新造的错误数字——正是这次要修的这类问题。
const RSU=sumOf({iface:IFACE,offload:1});
const vR=mkView({summary:RSU});
view.renderHourly.call(vR,{hours:[{hour:'h0',apps:[{name:'YouTube',down:36000,up:18000},
  {name:'QUIC',down:1000,up:500}],clients:[{ip:'192.168.2.5',bytes:50000}],router:0}]});
view.drawStatus.call(vR, RSU, vR.lastItems||[]);
chk(flat(vR.totalEl)==='54.2 KiB' && flat(vR.totalEl)!=='3.73 GiB',
    `范围视图用本范围的归属字节（${flat(vR.totalEl)}）`);
chk(flat(vR.heroCapEl)==='Attributed' && flat(vR.grandRow.label)==='Attributed',
    `范围视图的总量标注为已归属（${flat(vR.heroCapEl)} / ${flat(vR.grandRow.label)}）`);
chk(txt(vR.diagEl).indexOf('Attributed')===-1,
    `范围视图不显示会话级的已归属占比（${txt(vR.diagEl).trim()}）`);
chk(offloadWords(txt(vR.diagEl)).length===0,
    `范围视图也没有卸载文案（${txt(vR.diagEl).trim()||'（诊断区为空）'}）`);
// vR 这份快照的诊断区本来就是空的，「没有告警」在空集上恒真，所以再造一份诊断区
// 非空的：pending>0 会写出「等待解析」，而卸载文案仍然不出现。顺带确认范围视图的
// 协议桶也走应用表那条路（上面 vPH 只查了表，这里查了完整的一轮绘制）
const RSU2=sumOf({iface:IFACE,offload:1,pending:5});
const vR2=mkView({summary:RSU2});
view.renderHourly.call(vR2,{hours:[{hour:'h0',apps:[{name:'YouTube',down:36000,up:18000},
  {name:'QUIC',down:1000,up:500}],clients:[{ip:'192.168.2.5',bytes:50000}],router:0}]});
view.drawStatus.call(vR2, RSU2, vR2.lastItems||[]);
chk(txt(vR2.diagEl).indexOf('Waiting to resolve')>=0,
    `范围视图诊断区确实非空，下面的「没有告警」才不是空集（${txt(vR2.diagEl).trim()}）`);
chk(offloadWords(txt(vR2.diagEl)).length===0,
    `范围视图诊断区非空时同样没有卸载文案（${txt(vR2.diagEl).trim()}）`);
chk(inRows(vR2,'QUIC') && Object.keys(vR2.protoRows||{}).length===0 &&
    vR2.protoEl.style.display==='none',
    `范围视图一轮完整绘制后协议桶仍在应用表里（表内：${Object.keys(vR2.rowCache||{}).join('|')}）`);
chk(String((vR.grandRow.cells.top.attrs||{}).title||'').indexOf('selected range')>=0,
    `范围视图合计行的客户端标注为所选范围（${(vR.grandRow.cells.top.attrs||{}).title}）`);

console.log('=== 文案：页面里的 _() 都有中文条目 ===');
console.log('=== 站点归并与小流量显示 ===');
const vSites=mkView({});
view.draw.call(vSites,[{name:'Samsung',down:3000,up:0,bytes:3000}],
  {total:3000,down:3000,up:0,topText:'—',clientCount:1});
chk(!vSites.rowCache.Samsung.toggle, '首次只有品牌行时不显示展开控件');
view.draw.call(vSites,[
  {name:'samsungcloudcn.com',down:1000,up:0,bytes:1000},
  {name:'samsung.com.cn',down:2000,up:0,bytes:2000},
  {name:'Samsung',down:3000,up:0,bytes:3000},
  {name:'WangSuKeJi',down:1000,up:0,bytes:1000}
],{total:1e8,down:1e8,up:0,shareTotal:7000,topText:'—',clientCount:1});
chk(!!vSites.rowCache.Samsung && flat(vSites.rowCache.Samsung.cells.total).indexOf('5.86 KiB')>=0,
  '已核实的三星域名归并到 Samsung，流量合计正确');
chk(!!vSites.rowCache.Samsung && /<0\.1%/.test(flat(vSites.rowCache.Samsung.cells.total)),
  '非零小占比显示为 <0.1%');
chk(!!vSites.rowCache.Samsung && !!vSites.rowCache.Samsung.toggle,
  '归并行提供展开域名的控件');
if(vSites.rowCache.Samsung && vSites.rowCache.Samsung.toggle &&
   vSites.rowCache.Samsung.toggle._listeners.click)
  vSites.rowCache.Samsung.toggle._listeners.click();
chk(!!vSites.rowCache['domain:Samsung:samsungcloudcn.com'] &&
    !!vSites.rowCache['domain:Samsung:samsung.com.cn'],
  '展开后能看到原始域名明细');
chk(!!vSites.rowCache.WangSuKeJi && !vSites.rowCache.WangSuKeJi.children,
  '共享 CDN 不归并到三星');
const vOtherSites=mkView({});
view.draw.call(vOtherSites,[
  {name:'producthunt.com',down:800,up:0,bytes:800},
  {name:'brandfetch.io',down:700,up:0,bytes:700},
  {name:'trip.com',down:600,up:0,bytes:600},
  {name:'qrstuuvwxyzab.com',down:500,up:0,bytes:500}
],{total:2600,down:2600,up:0,topText:'—',clientCount:1});
chk(!!vOtherSites.rowCache['Product Hunt'] && !!vOtherSites.rowCache.Brandfetch &&
    !!vOtherSites.rowCache['Trip.com'],
  '其他已核实品牌域名也能显示品牌身份');
chk(!!vOtherSites.rowCache['qrstuuvwxyzab.com'],
  '身份不明域名仍保留原名');
const vBucketCount=mkView({});
view.renderLive.call(vBucketCount,sumOf({apps:[{name:'YouTube',down:1000,up:0},
  {name:'QUIC',down:1000,up:0,proto:1}]}));
chk((boxes(vBucketCount.statusEl).filter(b=>b.cap==='Apps and sites')[0]||{}).val==='1',
  '应用数不包含协议桶');
const rangeCountHead=mk(XHTML,'th');
const vRangeCount=mkView({clientsHead:rangeCountHead});
view.renderHourly.call(vRangeCount,{hours:[
  {hour:'h0',apps:[{name:'YouTube',down:100,up:0,clients:2}],clients:[]},
  {hour:'h1',apps:[{name:'YouTube',down:100,up:0,clients:3}],clients:[]}
]});
chk(flat(vRangeCount.rowCache.YouTube.cells.clients)==='3' &&
    flat(rangeCountHead)==='Peak clients/hour',
  '区间应用客户端数明确标为单小时峰值，而非跨小时去重数');
const sessionCountHead=mk(XHTML,'th');
const vSessionCount=mkView({clientsHead:sessionCountHead});
view.draw.call(vSessionCount,[{name:'YouTube',down:100,up:0,bytes:100,clients:2}],
  {total:100,down:100,up:0,topScope:'session'});
chk(flat(sessionCountHead)==='Client count',
  '本次运行仍标示会话内客户端数');
const vSmallTop=mkView({});
view.draw.call(vSmallTop,[{name:'YouTube',down:1000,up:0,bytes:1000,
  top:'192.168.2.9',top_bytes:500}],{total:1000,down:1000,up:0,
  topText:'—',clientCount:1,topScope:'range'});
chk(!/%/.test(flat(vSmallTop.rowCache.YouTube.cells.top)),
  '归档客户端读数不计算跨口径的行占比');
chk(flat(vSmallTop.rowCache.YouTube.cells.top).trim()==='192.168.2.9',
  '归档应用行只显示客户端身份，不显示不同窗口的字节数');
// 新文案必须同时进 catalogs，否则中文界面上会露出英文 msgid
function loadCatalog(file){
  const map={}; const unesc=s=>s.replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\');
  const unq=s=>{ const m=/^\s*"([\s\S]*)"\s*$/.exec(s); return m?m[1]:''; };
  let id=null,str=null,mode=null;
  const put=()=>{ if(id&&str) map[unesc(id)]=unesc(str); id=null; str=null; mode=null; };
  for(const raw of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    const line=raw.trim();
    if(!line||line[0]==='#') continue;
    if(line.startsWith('msgid ')){ put(); id=unq(line.slice(6)); mode='id'; }
    else if(line.startsWith('msgstr ')){ str=unq(line.slice(7)); mode='str'; }
    else if(line[0]==='"'){ if(mode==='id') id+=unq(line); else if(mode==='str') str+=unq(line); }
  }
  put(); return map;
}
const PO=loadCatalog(path.join(__dirname,'..','translations','zh_Hans','traffic.po'));
const ids=new Set();
for(const m of src.matchAll(/_\(\s*'([^']*)'/g)) ids.add(m[1]);
const missing=[...ids].filter(s=>s&&PO[s]===undefined);
chk(ids.size>40, `页面用了 ${ids.size} 条 _() 文案`);
chk(missing.length===0, `每条 _() 文案都在 traffic.po 里（缺 ${missing.length}${missing.length?': '+missing.slice(0,4).join(' | '):''}）`);

console.log('=== 图标索引晚到时补装已有图标 ===');
let finishIndex;
const pendingIndex=new Promise(resolve=>{finishIndex=resolve;});
global.__iconTest.setPending(pendingIndex);
const iconBox=global.__iconTest.makeIcon('Samsung');
global.__iconTest.setShipped({samsung:1,stripe:1,cdn:1,producthunt:1,'trip-com':1,brandfetch:1,'1password':1,rockstargames:1});
global.__iconTest.setDomains({'1password.com':'1password'});
finishIndex();
pendingIndex.then(()=>{
  chk(imageRequests.some(u=>u.indexOf('samsung.svg')>=0),
    '首轮行创建后索引才到时仍请求已存在的 Samsung 图标');
  chk(!!iconBox, '图标盒始终存在');
  global.__iconTest.makeIcon('stripe.com');
  global.__iconTest.makeIcon('WangSuKeJi');
  global.__iconTest.makeIcon('producthunt.com');
  global.__iconTest.makeIcon('trip.com');
  global.__iconTest.makeIcon('brandfetch.io');
  global.__iconTest.makeIcon('login.1password.com');
  global.__iconTest.makeIcon('Rockstar');
  return Promise.resolve();
}).then(()=>{
  chk(imageRequests.some(u=>u.indexOf('stripe.svg')>=0),
    '未收录服务的简单根域名可复用本地品牌图标');
  chk(imageRequests.some(u=>u.indexOf('cdn.svg')>=0),
    '网宿科技使用中性的 CDN 图形，不冒充站点品牌');
  chk(['producthunt.svg','trip-com.svg','brandfetch.svg'].every(f=>
    imageRequests.some(u=>u.indexOf(f)>=0)),
    '新增的品牌图标可被相应站点使用');
  chk(imageRequests.some(u=>u.indexOf('1password.svg')>=0),
    '包内域名索引可为子域名加载已核实的站点图标');
  chk(imageRequests.some(u=>u.indexOf('rockstargames.svg')>=0),
    '目录中的发行商名称能匹配新增游戏图标');
  const unknownIcon=global.__iconTest.makeIcon('qrstuuvwxyzab.com');
  chk(flat(unknownIcon).indexOf('QR')>=0,
    '无图标的域名显示可区分的双字母标识');
  console.log(fail?`\n  ${fail} 项失败`:'\n  页面渲染验证全部通过');
  process.exit(fail?1:0);
});

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
    addEventListener(){}, removeEventListener(){}, focus(){},
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
function ImageStub(){ return {onload:null,src:'',className:''}; }
const factory=new Function('view','rpc','dom','poll','_','E','L','document','Image','confirm',
  src.replace(/return view\.extend\(/, 'global.__injectCss = injectCss;\nreturn view.extend('));
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
           rateDown:E('b'), rateUp:E('b') });
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

console.log('=== 无采样时也画轴（避免空卡片）===');
const v4=freshView();
v4.seriesRange='1h'; v4.series={range:'1h',interval:10,points:[]};
view.drawSeries.call(v4);
chk(count(v4.chartEl,'svg')===1 && count(v4.chartEl,'line')===3, `空数据仍有轴：svg=${count(v4.chartEl,'svg')}, line=${count(v4.chartEl,'line')}`);
chk(count(v4.chartEl,'div')>=1, `并有"暂无采样"提示（${count(v4.chartEl,'div')}）`);

console.log('=== 状态条：一行十个等宽框 ===');
const v5=freshView();
view.drawStatus.call(v5,{collected_at:Math.floor(Date.now()/1000),interval:10,flows:1234,
  dnsmap_lines:5678,pending:3,acct:1,version:'0.1.23-r1'},items);
view.drawSummary.call(v5,[{cap:'Bucket',val:'24'},{cap:'Browser clients',val:'1.2 MiB'},
  {cap:'Router and tunnel',val:'0 B'},{cap:'Client count',val:'12'}]);
const b5=boxes(v5.statusEl);
chk(b5.length===10, `收集器状态 + 窗口合计共 10 个框（${b5.length}）`);
chk(b5[0] && b5[0].cap==='State' && b5[0].val==='Running', `第一格是运行状态（${b5[0]&&b5[0].val}）`);
chk(b5[5] && b5[5].cap==='Collector version', `第六格是采集器版本（${b5[5]&&b5[5].cap}）`);
chk(b5[6] && b5[6].cap==='Bucket',
    `分隔线后第一格是周期（${b5[6]&&b5[6].cap}）｜全表 ${b5.map(b=>b.cap).join('|')}`);
// The two sets have to come out the same width, which is the whole reason they
// are laid out as one flex line: two rows would each share out their own width,
// and six boxes in one against four in the other cannot match.
const kids=v5.statusEl.children;
chk(kids.filter(c=>(c.attrs||{}).class==='tf-stat').length===10 &&
    kids.filter(c=>(c.attrs||{}).class==='tf-stat-sep').length===1,
    '十个框加一条分隔线，按 6|4 排列');
chk(kids[6] && kids[6].attrs.class==='tf-stat-sep', `分隔线在第 7 个位置（${kids[6]&&kids[6].attrs.class}）`);
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

console.log('=== 范围视图：速率按区间取平均 ===');
// A rate needs a window.  In the ranged view the window is the range itself, so
// the two figures are averages over it - and they used to be a dash, which next
// to a card full of bytes read as "nothing is happening".
// renderHourly reaches for the view own draw()/drawMeta(), so the fake object
// takes the view as its prototype and overrides only the element handles.
const flat=n=>{ let s=''; (function go(x){ if(typeof x==='string'){ s+=x; return; } if(x&&x._text)s+=x._text; ((x&&x.children)||[]).forEach(go); })(n); return s; };
const rateOf=(hours)=>{ const v=Object.assign(Object.create(view),freshView()); view.renderHourly.call(v,{hours:hours}); return v; };
const one=rateOf([{hour:'h0',apps:[{name:'YouTube',down:36000,up:18000}],clients:[],router:0}]);
chk(flat(one.rateDown)!=='—', `下行给区间均速而不是破折号（${flat(one.rateDown)}）`);
chk(flat(one.rateUp)!=='—', `上行给区间均速（${flat(one.rateUp)}）`);
chk(/average/.test(String((one.rateDown.attrs||{}).title||'')), '均速在提示里说明是区间平均');
const ten=rateOf(Array.from({length:10},(_,i)=>({hour:'h'+i,
  apps:i?[]:[{name:'YouTube',down:36000,up:18000}],clients:[],router:0})));
chk(flat(ten.rateDown)!==flat(one.rateDown),
    `同一批字节摊到更长窗口，均速变小（1h ${flat(one.rateDown)} → 10h ${flat(ten.rateDown)}）`);

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

console.log(fail?`\n  ${fail} 项失败`:'\n  页面渲染验证全部通过');
process.exit(fail?1:0);



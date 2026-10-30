#!/usr/bin/env node
/* Exercise the shipped realtime models, SVG paths and DOM rendering offline. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const file = path.join(__dirname, '../htdocs/luci-static/resources/view/traffic/overview.js');
const source = fs.readFileSync(file, 'utf8').replace(/^'require [^']+';\s*$/gm, '');
let checks = 0;
const check = (value, label) => { checks++; assert(value, label); };
function node(tag, attrs = {}, children = []) {
  return { tag, attrs, children, style: {}, textContent: '',
    appendChild(c) { this.children.push(c); }, setAttribute(k,v) { this.attrs[k] = v; } };
}
const capture = {}, document = { createElementNS(ns,t) { return node(t); }, createElement(t) { return node(t); },
  createTextNode(s) { return s; }, getElementById() { return null; }, head: node('head') };
new Function('view','rpc','dom','poll','_','E','L','document','Image','capture','Date',
  source.replace('return view.extend(', 'capture.live = realtimeModel; capture.chart = makeRealtimeChart; capture.panel = makeRealtimePanel; capture.tops = topsStatusModel; return view.extend('))(
  {extend:v=>v}, {declare:()=>()=>Promise.resolve({})}, {content(n,c) { n.children = c; }}, {add(){}}, s=>s,
  node, {bind:(f,c)=>f.bind(c)}, document, function(){}, capture, {now:()=>3000000});
function text(n) { return typeof n === 'string' ? n : n == null ? '' : (n.textContent || '') + (n.children || []).map(text).join(' '); }
function all(n, tag) { return (n && n.tag === tag ? [n] : []).concat(...((n && n.children) || []).filter(x=>typeof x === 'object').map(x=>all(x,tag))); }
const sample = () => ({ at:3000, monotonic_ms:600000, ready:1, bps_down:125000000, bps_up:62500000,
  pps_down:100000, pps_up:50000, source:'iface', device:'pppoe-wan', peak_bps_down:125000000,
  peak_bps_up:62500000, average_bps_down:100000000, average_bps_up:50000000,
  series:[[596000,0,0,0,0],[597000,125000000,62500000,100000,50000],[598000,null,null,null,null],
    [599000,100000000,50000000,80000,40000],[600000,125000000,62500000,100000,50000]] });
let s = sample(), m = capture.live(s);
check(m && m.fresh && m.points.length === 5, 'validated WAN samples preserve both rates and gaps');
let paths = all(capture.chart(m),'path');
check(paths.length === 2, 'one path per direction');
check(paths.every(p=>(p.attrs.d.match(/M/g)||[]).length===2 && !/[CQ]/.test(p.attrs.d)), 'nulls break straight paths without smoothing or interpolation');
global.window={innerWidth:390};
check(capture.chart(m).attrs.viewBox==='0 0 310 175','phone charts keep readable height and axis labels');
delete global.window;
s = sample(); s.series = [[595000,1,1,1,1],[599000,2,2,2,2],[600000,3,3,3,3]];
check(all(capture.chart(capture.live(s)),'path').every(p=>(p.attrs.d.match(/M/g)||[]).length===2), 'missed intervals break the curve even without an explicit null');
for (const mutate of [s=>s.series[1][0]=s.series[0][0], s=>s.series[0][0]=1, s=>s.series[0][1]=-1,
  s=>s.series[0][0]=600001, s=>s.bps_down=Infinity, s=>s.source='conntrack', s=>s.ready='1']) {
  s=sample(); mutate(s); check(capture.live(s)===null,'invalid samples cannot appear as a fresh WAN curve');
}
s=sample();s.at=2990;check(!capture.live(s).fresh,'cached WAN samples become stale');
const panel = capture.panel(); panel.live(sample());
check(text(panel.node).includes('1000.0 Mbps') && text(panel.node).includes('100,000 PPS'),'Mbps and PPS use their respective WAN counters');
s=sample();s.bps_down=0;s.pps_down=0;panel.live(s);
check(text(panel.node).includes('0.00 Mbps') && text(panel.node).includes('0 PPS'),'a measured zero is displayed as zero');
s.pps_down=null;s.ready=0;panel.live(s);
check(text(panel.node).includes('Sample unavailable or establishing a new baseline.') && !text(panel.node).includes('0 PPS'),'missing samples are not displayed as measured zeros');
check(!text(panel.node).includes('Current large flows') && !source.includes('getConnections'), 'no flow table or dedicated flow RPC polling');
const tops = {schema:3, npu:{status_node_present:true,firmware_ready:true,mcu_alive:true,registered_tunnel_types:3,
  coverage:'complete',utilization:{available:true,coverage:'complete',unit:'mean_core_busy_percent',core_count:5,
    percent_milli:40000,cores:{Core0:0,Core1:20000,Core2:40000,Core3:60000,CoreM:80000}}},
  tunnels:{coverage:'complete',capacity:32,count:0,entries:[]},accounting:{}};
check(capture.tops(tops).cores[0].percent===0 && capture.tops(tops).cores[4].percent===80,'five real cores include a valid zero');
tops.npu.utilization.cores.CoreM=80001;check(capture.tops(tops).cores!==null,'integer mean rounding is allowed');
tops.npu.utilization.cores.CoreM=81000;check(capture.tops(tops).cores===null,'inconsistent core and mean reports are not combined');
delete tops.npu.utilization.cores;check(capture.tops(tops).cores===null && capture.tops(tops).utilization===40,'legacy mean-only reports remain supported');
console.log(JSON.stringify({checks,failures:0,scope:'Actual view models, SVG and panel DOM; offline fixtures only.'}));

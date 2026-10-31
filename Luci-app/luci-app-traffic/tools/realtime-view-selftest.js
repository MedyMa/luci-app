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
  source.replace('return view.extend(', 'capture.live = realtimeModel; capture.tops = topsStatusModel; return view.extend('))(
  {extend:v=>{capture.view=v;return v;}}, {declare:()=>()=>Promise.resolve({})}, {content(n,c) { n.children = Array.isArray(c) ? c : [c]; }}, {add(){}}, s=>s,
  node, {bind:(f,c)=>f.bind(c)}, document, function(){}, capture, {now:()=>3000000});
function text(n) { return typeof n === 'string' ? n : n == null ? '' : (n.textContent || '') + (n.children || []).map(text).join(' '); }
const sample = () => ({ at:3000, monotonic_ms:600000, ready:1, dt:1, bps_down:125000000, bps_up:62500000,
  pps_down:100000, pps_up:50000, source:'iface', device:'pppoe-wan' });
let s = sample(), m = capture.live(s);
check(m && m.fresh, 'current WAN sample is validated');
for (const mutate of [s=>s.at=0,s=>s.at=NaN,s=>s.bps_down=Infinity,s=>s.source='conntrack',s=>s.ready='1',
  s=>s.dt=0,s=>s.dt=3,s=>s.pps_up=-1,s=>s.pps_down=1.5,s=>s.device='<img>']) {
  s=sample();mutate(s);check(capture.live(s)===null,'invalid counters and observations cannot reach the headline');
}
s=sample();s.at=2990;check(!capture.live(s).fresh,'cached WAN sample becomes stale');
s=sample();s.at=3010;check(!capture.live(s).fresh,'future observation is not current');
const v=Object.assign(Object.create(capture.view),{rateDown:node('b'),rateUp:node('b'),packetsDown:node('b'),packetsUp:node('b'),liveNote:node('small')});
v.renderRealtime(sample());
check(text(v.rateDown).includes('1000.0 Mbps') && text(v.packetsDown).includes('100,000 PPS'),'bandwidth and packet rate share the WAN sample');
s=sample();s.bps_down=0;s.pps_down=0;v.renderRealtime(s);
check(text(v.rateDown)==='0.00 Mbps' && text(v.packetsDown)==='0 PPS','measured zeros remain zeros');
s.ready=0;v.renderRealtime(s);
check(text(v.rateDown)==='—' && text(v.packetsDown)==='—','baseline is unavailable, not zero traffic');
v.renderRealtime(null);check(text(v.rateUp)==='—','failed fetch clears the headline');
check(!source.includes('makeRealtimeChart') && !source.includes('tf-realtime-card'),'the separate realtime chart has been removed');
check(!source.includes('getConnections'),'no duplicate client or connection table');
const tops = {schema:3, npu:{status_node_present:true,firmware_ready:true,mcu_alive:true,registered_tunnel_types:3,
  coverage:'complete',utilization:{available:true,coverage:'complete',unit:'mean_core_busy_percent',core_count:5,
    percent_milli:40000,cores:{Core0:0,Core1:20000,Core2:40000,Core3:60000,CoreM:80000}}},
  tunnels:{coverage:'complete',capacity:32,count:0,entries:[]},accounting:{}};
check(capture.tops(tops).cores[0].percent===0 && capture.tops(tops).cores[4].percent===80,'five real cores include a valid zero');
tops.npu.utilization.cores.CoreM=80001;check(capture.tops(tops).cores!==null,'integer mean rounding is allowed');
tops.npu.utilization.cores.CoreM=81000;check(capture.tops(tops).cores===null,'inconsistent core and mean reports are not combined');
delete tops.npu.utilization.cores;check(capture.tops(tops).cores===null && capture.tops(tops).utilization===40,'legacy mean-only reports remain supported');
console.log(JSON.stringify({checks,failures:0,scope:'Actual view models, SVG and panel DOM; offline fixtures only.'}));

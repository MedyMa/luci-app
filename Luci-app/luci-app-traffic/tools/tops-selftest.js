#!/usr/bin/env node
/* Execute the actual TOPS view methods with a DOM/RPC shim. No device access. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const file = path.join(__dirname, '../htdocs/luci-static/resources/view/traffic/overview.js');
const source = fs.readFileSync(file, 'utf8').replace(/^'require [^']+';\s*$/gm, '');
let response = {}, reject = false, checks = 0;
function node(tag, attrs = {}, children = []) {
  return { tag, attrs, style: {}, children, appendChild(c) { this.children.push(c); }, setAttribute(k,v) { this.attrs[k] = v; } };
}
const capture = {}, view = { extend(v) { capture.view = v; return v; } };
const dom = { content(n, children) { n.children = children; } };
const rpc = { declare(spec) { return () => reject ? Promise.reject(new Error('RPC failed')) : Promise.resolve(spec.method === 'getNpuStatus' ? response : {}); } };
const document = { getElementById() { return null; }, createElement(t) { return node(t); }, createTextNode(s) { return s; }, head: node('head') };
new Function('view','rpc','dom','poll','_','E','L','document','Image','capture', source.replace('return view.extend(', 'capture.model = topsStatusModel; return view.extend('))(
  view, rpc, dom, {add(){}}, s=>s, node, {bind:(f,c)=>f.bind(c)}, document, function(){}, capture);
const fresh = () => Object.assign(Object.create(capture.view), { topsCardEl: node('div'), total: 123, lastRates: {up:99} });
const base = () => ({ schema:3, npu:{status_node_present:true,firmware_ready:true,mcu_alive:true,registered_tunnel_types:3,coverage:'complete',packet_offload_verified:false},
  tunnels:{coverage:'complete',capacity:32,count:0,entries:[]},accounting:{conntrack_setting_coverage:'complete',conntrack_accounting_enabled:true} });
const entry = (index, protocol='gretap') => ({ index,protocol,local_address:'192.0.2.1',remote_address:'198.51.100.1',local_port:0,remote_port:0,encapsulation:true,decapsulation:true,synchronized:true });
function text(n) { return typeof n === 'string' ? n : n == null ? '' : (n.children || []).map(text).join(' '); }
function contains(n, s) { return text(n).includes(s); }
function check(c, message) { checks++; assert(c, message); }
async function run() {
  let v = fresh(); v.topsCardEl.style.display = 'none';
  response = {available:false,coverage:'provider_missing'}; await v.pollTops();
  check(v.topsCardEl.style.display === 'none', 'old provider remains optional');
  response = base(); await v.pollTops();
  check(contains(v.topsCardEl,'No tunnel entries'), 'complete empty snapshot has an explicit empty state');
  check(contains(v.topsCardEl,'Waiting for supported tunnel traffic.'), 'ready does not mean active tunnel');
  check(contains(v.topsCardEl,'Not verified'), 'firmware ready never establishes hardware forwarding');
  check(!contains(v.topsCardEl,'Parameters synchronized'), 'no fabricated tunnel status for empty table');
  check(v.total === 123 && v.lastRates.up === 99, 'TOPS polling does not change byte totals or rates');
  const data = base(); data.tunnels.entries = [entry(0),entry(1,'vxlan'),entry(2,'l2tpv2')]; data.tunnels.count = 3;
  data.tunnels.entries[1].synchronized = false; data.tunnels.entries[1].local_port = 4789;
  response = data; await v.pollTops();
  check(v.lastTops.synced === 2, 'synchronized count comes from validated entries');
  check(contains(v.topsCardEl,'Parameters synchronized') && contains(v.topsCardEl,'Pending'), 'pending and synchronized entries are distinct');
  check(contains(v.topsCardEl,'192.0.2.1:4789'), 'UDP port is displayed');
  response=base(); response.tunnels.entries=[Object.assign(entry(0), {synchronized:false,sync_health:{
    unit:'parameter_sync_attempts',attempts:'3',failures:'3',stage:3,last_error:-110,synced_generation:'0'}})];
  response.tunnels.count=1; await v.pollTops();
  check(contains(v.topsCardEl,'Synchronization failed')&&contains(v.topsCardEl,'Management core ACK (-110)'), 'actual sync stage and errno are visible');
  response.tunnels.entries[0].sync_health.last_error=0; await v.pollTops();
  check(contains(v.topsCardEl,'Pending')&&!contains(v.topsCardEl,'Synchronization failed'), 'retry with no current error is pending');
  for (const change of [h=>h.stage=7,h=>h.last_error=-5000,h=>h.attempts='18446744073709551616',h=>h.unit='packets']) {
    const d=base(), e=entry(0);e.sync_health={unit:'parameter_sync_attempts',attempts:'1',failures:'0',stage:6,last_error:0,synced_generation:'1'};
    change(e.sync_health);d.tunnels.entries=[e];d.tunnels.count=1;
    const m=capture.model(d);check(!m.complete&&m.entries.length===1&&!m.entries[0].sync_health,'invalid sync metadata is not trusted');
  }
  response=data; await v.pollTops();
  check(!contains(v.topsCardEl,'198.51.100.1:0'), 'GRE does not display a fabricated port zero');
  check(contains(v.topsCardEl,'GRETAP') && contains(v.topsCardEl,'VXLAN') && contains(v.topsCardEl,'L2TPv2'), 'three protocol names are readable');
  reject = true; await v.pollTops(); reject = false;
  check(contains(v.topsCardEl,'Snapshot out of date') && contains(v.topsCardEl,'Unable to refresh; showing the last snapshot.'), 'RPC failure visibly marks retained data stale');
  check(contains(v.topsCardEl,'GRETAP'), 'transient RPC failure retains the last snapshot');
  response = {schema:4,npu:{}}; await v.pollTops();
  check(contains(v.topsCardEl,'Snapshot out of date'), 'unknown schemas never silently replace a valid snapshot');
  response = base(); response.tunnels.coverage = 'truncated'; await v.pollTops();
  check(contains(v.topsCardEl,'Tunnel state is incomplete or unavailable.'), 'truncated table is explicitly unavailable');
  check(!contains(v.topsCardEl,'No tunnel entries'), 'truncation is not a genuine empty table');
  for (const mutation of [e=>e.index=32,e=>e.local_port=65536,e=>e.local_address='999.1.2.3',e=>e.local_address='1.2.3.4.',e=>e.protocol='<script>',e=>e.synchronized='false',e=>e.encapsulation=1]) {
    const d=base(), e=entry(0); mutation(e); d.tunnels.entries=[e]; d.tunnels.count=1;
    const m=capture.model(d);
    check(!m.complete && m.entries.length===0, 'malformed row is rejected and coverage is incomplete');
  }
  response=base(); response.tunnels.entries=[entry(0),entry(0)]; response.tunnels.count=2;
  await v.pollTops(); check(v.lastTops.entries.length===1&&!v.lastTops.complete,'duplicate index is incomplete');
  response=base(); response.npu.firmware_ready='true'; await v.pollTops();
  check(contains(v.topsCardEl,'Snapshot out of date'),'string true is invalid rather than a fresh readiness observation');
  response=base(); response.npu.status_node_present=false; response.npu.coverage='missing'; await v.pollTops();
  check(contains(v.topsCardEl,'Not loaded'), 'installed helper with absent driver remains visible');
  response=base(); response.npu.mcu_alive=false; await v.pollTops();
  check(contains(v.topsCardEl,'Not ready'), 'stopped MCU is not ready');
  response=base(); response.accounting.conntrack_accounting_enabled=false; await v.pollTops();
  check(contains(v.topsCardEl,'Conntrack accounting is disabled'), 'accounting opt-out is explained without changing it');
  response=base(); response.accounting.conntrack_setting_coverage='missing'; await v.pollTops();
  check(contains(v.topsCardEl,'Conntrack accounting status is unavailable.'), 'missing setting is not labeled disabled');
  response=base(); response.schema=2; await v.pollTops(); check(v.lastTops.ready,'schema 2 remains supported');
  check(!/innerHTML\s*=/.test(source.slice(source.indexOf('renderTops:'),source.indexOf('setRange:'))),'TOPS labels use escaped DOM text');
  console.log(JSON.stringify({checks,failures:0,scope:'Actual view model, rendering and asynchronous poll handlers; DOM/RPC services modeled. No hardware test.'}));
}
run().catch(e=>{console.error(e);process.exitCode=1;});

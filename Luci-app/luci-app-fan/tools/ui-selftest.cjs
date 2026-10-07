'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/fan.js'), 'utf8');
const frames = new Map();
let id = 0, removed = 0;
const document = { hidden: false, documentElement: { lang: 'zh-CN' }, body: { className: '' }, removeEventListener() {} };
const sandbox = {
 document, window: { removeEventListener() {} }, console,
 _: s => s, E() {}, form: {}, uci: {}, L: {},
 rpc: { declare: () => () => Promise.resolve({}) },
 view: { extend: value => value }, poll: { remove() { removed++; } },
 requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
 cancelAnimationFrame(value) { frames.delete(value); }
};
const view = vm.runInNewContext('(function(){' + source + '\n})()', sandbox);
view.disposed = false;
view.root = { isConnected: true };
view.motion = { matches: false, removeEventListener() {} };
view.rate = 1;
view.animation = {
 state: 'paused', updates: 0,
 play() { this.state = 'running'; }, pause() { this.state = 'paused'; },
 updatePlaybackRate(rate) { this.rate = rate; this.updates++; }, cancel() { this.state = 'cancelled'; }
};
for (const key of ['device', 'note', 'cpu', 'pwm', 'rpm', 'speedSource', 'mode']) view[key] = { textContent: '' };
view.badge = { dataset: {}, lastChild: { textContent: '' } };
view.progress = Object.fromEntries(['rpm','cpu','pwm'].map(key => [key, {dataset:{}, firstChild:{style:{}}, setAttribute(key,value){this[key]=value;}, removeAttribute(key){delete this[key];}}]));
const status = { supported: true, running: true, enabled: true, pwm_percent: 62, fan_rpm: 1860, rpm_source: 'estimated', zone_temp: 48.6, fan_max_rpm: 3000, configured_on_temp: 60, mode: 'smart' };
view.updateStatus(status);
assert.equal(view.badge.lastChild.textContent, '运行中');
assert.equal(view.animation.state, 'running');
assert.equal(frames.size, 0, 'Stable rotation should not run a JS frame loop');
assert.equal(view.cpu.textContent, '48.6');
assert.equal(view.rpm.textContent, '1860', 'RPM must not use thousands separators');
assert.equal(view.progress.rpm.firstChild.style.width, '62%'); assert.equal(view.progress.cpu.firstChild.style.width, '81%'); assert.equal(view.progress.cpu.dataset.warning, 'true');
view.updateProgress('pwm', 200, 100); assert.equal(view.progress.pwm.firstChild.style.width,'100%'); view.updateProgress('rpm', 20, 0); assert.equal(view.progress.rpm.firstChild.style.width,'0%'); assert.equal(view.progress.rpm['aria-valuenow'],undefined);
assert.match(view.speedSource.textContent, /估算/);
view.updateStatus({ ...status, running: false });
assert.equal(view.badge.lastChild.textContent, '已停止', 'Configured enabled must not imply running');
assert.equal(view.animation.state, 'paused');
assert.match(view.note.textContent, /尚未运行/);
view.updateStatus({ ...status, enabled: false }); assert.equal(view.badge.lastChild.textContent, '已停用'); assert.equal(view.mode.textContent, '—'); assert.equal(view.animation.state, 'paused');
view.updateStatus({ ...status, pwm_percent: 0, fan_rpm: 0 });
assert.equal(view.animation.state, 'paused');
view.updateStatus({ ...status, rpm_source: 'actual', fan_rpm: 0 });
assert.equal(view.animation.state, 'paused', 'Measured zero RPM takes precedence over PWM');
view.updateStatus({ ...status, pwm_percent: 100, fan_rpm: 3000, rpm_source: 'actual' });
assert.match(view.speedSource.textContent, /实测/);
let ticks = 0;
while (frames.size) {
 const [key, callback] = frames.entries().next().value;
 frames.delete(key); callback(++ticks * 16);
 assert(ticks < 200, 'Speed transition must settle and stop scheduling frames');
}
assert(Math.abs(view.animation.rate - 100 / 62) < .003);
document.hidden = true; view.syncAnimation(); assert.equal(view.animation.state, 'paused');
document.hidden = false; view.motion.matches = true; view.syncAnimation(); assert.equal(view.animation.state, 'paused');
view.motion.matches = false;
view.updateStatus({ ...status, supported: false }); assert.equal(view.animation.state, 'paused');
view.updateStatus({ ...status, mode: 'manual', mode_supported: false });
assert.equal(view.badge.lastChild.textContent, '模式不可用'); assert.match(view.note.textContent, /智能模式/); assert.equal(view.mode.textContent, '不可用'); assert.equal(view.animation.state, 'paused');
view.syncAnimation(); assert.equal(view.animation.state, 'paused', 'Unsupported mode must stay paused on visibility resume');
view.updateStatus({}, true); assert.equal(view.badge.lastChild.textContent, '状态获取失败');
assert.equal(view.progress.cpu.firstChild.style.width,'0%'); assert.equal(view.progress.cpu['aria-valuenow'],undefined); assert.equal(view.cpu.textContent, '—'); assert.match(view.note.textContent, /自动重试/);
view.updateStatus(status); assert.equal(view.note.textContent, '');
view.poller = () => {}; const animation = view.animation; view.cleanup();
assert.equal(removed, 1); assert.equal(animation.state, 'cancelled'); assert.equal(view.animation, null); assert(view.disposed);
console.log('PASS fan runtime state, bounded animation, hidden/reduced motion, failure recovery and cleanup');

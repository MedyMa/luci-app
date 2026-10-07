'use strict';
'require view';
'require form';
'require poll';
'require rpc';
'require uci';

var callGetStatus = rpc.declare({ object: 'luci.fan', method: 'getStatus', expect: { '': {} } });
function t(message, chinese) {
 var translated = _(message);
 return translated === message && (/^zh(?:[-_]|$)/i.test(document.documentElement.lang || '') || /\blang_zh(?:[-_][^\s]+)?\b/i.test(document.body.className || '')) ? chinese : translated;
}
function number(value) { if (value == null || value === '') return null; value = Number(value); return isFinite(value) ? value : null; }
function yes(value) { return value === true || value === 1 || value === '1'; }
function modeLabel(mode) { return mode === 'turbo' ? t('Turbo', '狂暴') : mode === 'manual' ? t('Manual', '手动') : t('Smart', '智能'); }
var style = `
.lf-page{--surface:#fff;--soft:#f7f9fb;--line:#e3e7ee;--muted:#6c7689;--purple:#4c3e87;--green:#16814b;--blue:#2463c5;--teal:#087d86;--blade-start:#b4bcca;--blade-end:#e8ecf2;color:#283044;max-width:1120px;width:100%;margin:24px auto;display:grid;gap:16px;font-family:inherit;font-size:14px;line-height:1.5}
.lf-page.lf-dark{color:#e8edf7;--surface:#232628;--soft:#282d30;--line:#3a4145;--muted:#b7c0c8;--purple:#a18be4;--green:#47d68b;--blue:#87b8ff;--teal:#75d5d7;--blade-start:#626b7e;--blade-end:#adb5c3}
.lf-page *{box-sizing:border-box}.lf-page .lf-heading{display:flex;align-items:center;gap:12px;margin-bottom:4px}.lf-page .lf-heading h2{all:unset;display:block;font-family:inherit;font-size:27px;font-weight:650;line-height:1.3;color:inherit}.lf-page .lf-icon{width:43px;height:43px;display:grid;place-items:center;border-radius:14px;background:var(--soft);color:var(--purple);font-size:28px}
.lf-page .lf-card{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:22px}.lf-page .lf-status{display:flex;align-items:center;gap:12px;padding:16px 20px;border-radius:13px}.lf-page .lf-chip{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:5px 12px;font-weight:600;color:var(--green);background:color-mix(in srgb,var(--green) 9%,transparent);white-space:nowrap}.lf-page .lf-chip i{height:8px;width:8px;background:currentColor;border-radius:50%}.lf-page .lf-tag{border-radius:999px;padding:4px 10px;border:1px solid var(--line);font-size:12px;background:var(--soft)}.lf-page .lf-muted{font-size:12px;color:var(--muted)}.lf-page .lf-status .lf-muted{margin-left:auto}
.lf-page .lf-live{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:stretch}.lf-page .lf-fan-unit,.lf-page .lf-metric{position:relative;height:208px;background:var(--soft);border-radius:15px;padding:20px;min-width:0;display:flex;flex-direction:column;justify-content:center}.lf-page .lf-fan-unit{text-align:center;align-items:center}.lf-page .lf-fan-stage{position:relative;width:150px;height:150px;flex-shrink:0;display:block}.lf-page .lf-fan{width:100%;height:100%;display:block}.lf-page .lf-housing{fill:var(--soft);stroke:var(--line);stroke-width:1.5}.lf-page .lf-rotor{transform-origin:120px 120px}.lf-page .lf-label{font-size:13px;color:var(--muted)}.lf-page .lf-number,.lf-page .lf-fan-value{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}.lf-page .lf-number{font-size:28px;line-height:1.4;margin:9px 0 3px}.lf-page .lf-fan-value{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);margin:0;width:68px;height:68px;border-radius:50%;background:var(--surface);border:1px solid var(--line);display:flex;flex-direction:column;justify-content:center;align-items:center;color:var(--teal);font-size:19px;line-height:1.2;letter-spacing:-.5px}.lf-page .lf-fan-value small{font-size:14px;font-weight:500;letter-spacing:.5px;margin-top:3px;color:var(--muted)}.lf-page .lf-progress{position:absolute;bottom:12px;left:20px;right:20px;height:4px;border-radius:999px;background:var(--line);overflow:hidden}.lf-page .lf-progress-fill{display:block;height:100%;border-radius:inherit;background:var(--teal)}.lf-page .lf-progress-cpu .lf-progress-fill{background:var(--blue)}.lf-page .lf-progress-pwm .lf-progress-fill{background:var(--purple)}.lf-page .lf-progress[data-warning=true] .lf-progress-fill{background:#dc9132}.lf-page .lf-number small{font-size:14px;font-weight:500}.lf-page .lf-blue{color:var(--blue)}.lf-page .lf-purple{color:var(--purple)}.lf-page .lf-green{color:var(--green)}.lf-page :focus-visible{outline:2px solid var(--purple);outline-offset:3px}
@media(max-width:720px){.lf-page{margin:20px auto}.lf-page .lf-card{padding:16px}.lf-page .lf-live{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.lf-page .lf-fan-unit,.lf-page .lf-metric{height:160px;padding:14px}.lf-page .lf-fan-stage{width:106px;height:106px}.lf-page .lf-fan-value{width:52px;height:52px;font-size:15px}.lf-page .lf-fan-value small{font-size:8px;margin-top:2px}.lf-page .lf-fan-unit>.lf-muted{font-size:10px;line-height:1.4}.lf-page .lf-progress{left:14px;right:14px}.lf-page .lf-number{font-size:25px}.lf-page .lf-number small{font-size:12px}.lf-page .lf-label{font-size:12px}.lf-page .lf-status{gap:9px;flex-wrap:wrap}.lf-page .lf-status .lf-muted{font-size:11px}}
@media(prefers-reduced-motion:reduce){.lf-page *{transition:none!important}}
.lf-page .cbi-map{border:1px solid var(--line)!important;border-radius:20px!important;background:var(--surface)!important;padding:22px!important;box-shadow:none!important;margin:0!important}
.lf-page .cbi-map>h2,.lf-page .cbi-section>h3{display:none}.lf-page .cbi-map::before{content:attr(data-heading);display:block;font-size:18px;font-weight:650;margin-bottom:18px}

.lf-page .cbi-section{margin:0!important;padding:0!important;border:0!important;background:none!important;box-shadow:none!important}
.lf-page .cbi-section-node{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin:0!important;padding:0!important}
.lf-page .cbi-value{display:block;margin:0!important;padding:0!important;border:0!important;background:none!important;min-width:0}
.lf-page .cbi-value-title{float:none!important;width:auto!important;display:block!important;text-align:left!important;padding:0!important;margin:0 0 8px!important;font-size:14px;font-weight:600;color:inherit}
.lf-page .cbi-value-field{display:block!important;margin:0!important;width:auto!important;padding:0!important}.lf-page .cbi-value-description{font-size:12px;line-height:1.5;color:var(--muted);padding-top:7px}
.lf-page [data-name=enabled],.lf-page [data-name=mode]{grid-column:1/-1}
.lf-page [data-name=enabled]{display:flex;align-items:center;justify-content:space-between;gap:16px}.lf-page [data-name=enabled] .cbi-value-title{margin:0!important}
.lf-page input[type=text],.lf-page input[type=number]{width:100%!important;max-width:none!important;min-height:44px!important;font:inherit!important;font-size:16px!important;color:inherit!important;background:var(--soft)!important;border:1px solid var(--line)!important;border-radius:11px!important;padding:10px 13px!important;box-shadow:none!important}
.lf-page .cbi-checkbox input[type=checkbox]{appearance:none!important;-webkit-appearance:none!important;position:relative!important;display:block!important;opacity:1!important;width:45px!important;height:26px!important;margin:0!important;background:#8e97a1!important;border:0!important;border-radius:999px!important;cursor:pointer}
.lf-page .cbi-checkbox input:checked{background:var(--purple)!important}.lf-page .cbi-checkbox input::after{content:'';position:absolute;left:3px;top:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:transform .2s ease-out}.lf-page .cbi-checkbox input:checked::after{transform:translateX(19px)}.lf-page .cbi-checkbox>label{display:none!important}
 .lf-page [data-name=mode] .cbi-value-field>div{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;font-size:0}.lf-page [data-name=mode] .cbi-radio{position:relative;display:block!important;border:1px solid var(--line);border-radius:16px;background:var(--soft);padding:13px 15px;min-width:0;font-size:14px}.lf-page [data-name=mode] .cbi-radio:has(input:checked){border-color:var(--purple);color:var(--purple)}.lf-page [data-name=mode] .cbi-radio>input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;margin:0}.lf-page [data-name=mode] .cbi-radio>label{display:none}.lf-page [data-name=mode] .cbi-radio>span{display:block;pointer-events:none}.lf-page [data-name=mode] small{display:block;font-size:12px;color:var(--muted);margin-top:3px}.lf-page [data-name=mode] .cbi-radio:focus-within{outline:2px solid var(--purple);outline-offset:3px}
.lf-page input[type=radio],.lf-page input[type=range]{accent-color:var(--purple)}.lf-page input[type=range]{width:100%}.lf-page input:disabled{opacity:.65;cursor:default}.lf-page .range-value{font-weight:600;color:var(--purple)}.lf-page .cbi-section-node>.hidden{display:none!important}
.lf-page .lf-chip[data-state=running]{min-width:120px;justify-content:center;padding:6px 20px;color:inherit;background:var(--line)}.lf-page .lf-chip[data-state=running] i{display:none}.lf-page .lf-chip[data-state=running][data-heat=cool]{background:#a5e1b8;color:#173b24}.lf-page .lf-chip[data-state=running][data-heat=warm]{background:#ffcd75;color:#493000}.lf-page .lf-chip[data-state=running][data-heat=hot]{background:#f59ca7;color:#541b27}.lf-page .lf-chip[data-state=stopped]{color:var(--muted)}.lf-page .lf-chip[data-state=error],.lf-page .lf-runtime-error{color:#d14462}.lf-page .lf-runtime-error:empty{display:none}
#maincontent:has(.lf-page) .cbi-page-actions .cbi-button{border-radius:999px;min-height:44px;padding:10px 20px}#maincontent:has(.lf-page) .cbi-page-actions .cbi-button-apply,#maincontent:has(.lf-page) .cbi-page-actions .cbi-button-save{background:#4c3e87!important;border-color:#4c3e87!important;color:#fff!important}
#maincontent:has(.lf-page) .cbi-page-actions{display:flex!important;flex-wrap:wrap;justify-content:flex-end;gap:10px;box-sizing:border-box;width:100%;max-width:1120px;margin-left:auto;margin-right:auto}#maincontent:has(.lf-page) .cbi-page-actions>.cbi-button{margin:0!important}#maincontent:has(.lf-page) .cbi-page-actions .cbi-button-reset{background:#f7f9fb!important;border:1px solid #e3e7ee!important;color:#283044!important}#maincontent:has(.lf-page.lf-dark) .cbi-page-actions .cbi-button-reset{background:#282d30!important;border-color:#3a4145!important;color:#e8edf7!important}
@media(max-width:720px){.lf-page .cbi-map{padding:16px!important}.lf-page .cbi-section-node{grid-template-columns:1fr;gap:16px}.lf-page [data-name=mode] .cbi-value-field>div{gap:6px}.lf-page [data-name=mode] .cbi-radio{padding:11px 9px}}

.lf-page .lf-curve{width:100%;margin-top:14px;font-size:11px;color:var(--muted)}.lf-page .lf-curve[hidden],.lf-page .lf-curve-marker[hidden]{display:none!important}.lf-page .lf-curve-track{height:5px;border-radius:999px;background:linear-gradient(90deg,#80bd9b,#efbc76,#f59168);position:relative;margin:8px 0 10px}.lf-page .lf-curve-marker{position:absolute;top:-3px;width:3px;height:11px;transform:translateX(-50%);background:var(--surface);border:1px solid var(--purple);border-radius:2px}.lf-page .lf-curve-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.lf-page .lf-curve-values b{display:block;font-weight:600;font-size:12px;white-space:nowrap}
@media(max-width:720px){.lf-page .lf-curve{font-size:9px;margin-top:7px}.lf-page .lf-curve-track{margin:6px 0 7px}.lf-page .lf-curve-values{gap:2px}.lf-page .lf-curve-values b{font-size:10px}}
`;
function fanIcon() {
 var blades = '';
 for (var i = 0; i < 7; i++) blades += '<path transform="rotate(' + (i * 360 / 7) + ')" d="M-9-19C-21-37-31-67-15-89C-4-104 22-103 39-91C58-77 64-53 47-34C33-19 9-13-9-19Z"/>';
 var node = E('div');
 node.innerHTML = '<svg class="lf-fan" viewBox="0 0 240 240" aria-hidden="true"><defs><linearGradient id="lf-fan-blade" x1="0" y1="0" x2="1" y2="1"><stop stop-color="var(--blade-start)"/><stop offset="1" stop-color="var(--blade-end)"/></linearGradient></defs><rect class="lf-housing" x="5" y="5" width="230" height="230" rx="29"/><circle cx="120" cy="120" r="104" fill="none" stroke="var(--line)" stroke-width="1"/><g fill="var(--muted)" opacity=".35"><circle cx="24" cy="24" r="2.5"/><circle cx="216" cy="24" r="2.5"/><circle cx="24" cy="216" r="2.5"/><circle cx="216" cy="216" r="2.5"/></g><g class="lf-rotor"><g transform="translate(120 120)" fill="url(#lf-fan-blade)" stroke="var(--blade-start)" stroke-width=".8">' + blades + '</g></g></svg>';
 return node.firstElementChild;
}
return view.extend({
 load: function() { return Promise.all([uci.load('luci-fan'), L.resolveDefault(callGetStatus(), {})]); },
 cleanup: function() {
  if (this.poller) poll.remove(this.poller);
  if (this.frame) cancelAnimationFrame(this.frame);
  if (this.animation) this.animation.cancel();
  if (this.observer) this.observer.disconnect();
  if (this.visibility) document.removeEventListener('visibilitychange', this.visibility);
  if (this.leave) window.removeEventListener('pagehide', this.leave);
  if (this.visibility) window.removeEventListener('pageshow', this.visibility);
  if (this.motion && this.visibility) this.motion.removeEventListener('change', this.visibility);
  this.poller = this.frame = this.animation = this.observer = null;
  this.disposed = true;
 },
 syncAnimation: function() {
  if (!this.animation || this.disposed) return;
  var s = this.status || {}, rpm = number(s.fan_rpm), pwm = number(s.pwm_percent);
  var output = s.rpm_source === 'actual' && rpm === 0 ? 0 : pwm != null ? pwm : rpm != null && rpm > 0 ? 50 : 0;
  var compatible = s.mode_supported == null || yes(s.mode_supported) || s.mode === 'smart';
  this.target = yes(s.supported) && yes(s.running) && yes(s.enabled) && compatible && output > 0 ? Math.max(.2, Math.min(2.2, output / 62)) : 0;
  if (this.frame) cancelAnimationFrame(this.frame);
  this.frame = null;
  if (document.hidden || !this.root.isConnected || this.motion.matches || this.target === 0) { this.animation.pause(); return; }
  this.animation.play();
  var last = 0, owner = this;
  function ease(timestamp) {
   var dt = last ? Math.min(timestamp - last, 100) : 16; last = timestamp;
   owner.rate += (owner.target - owner.rate) * (1 - Math.exp(-dt / 180));
   owner.animation.updatePlaybackRate(owner.rate);
   if (Math.abs(owner.rate - owner.target) > .003) owner.frame = requestAnimationFrame(ease);
   else { owner.rate = owner.target; owner.animation.updatePlaybackRate(owner.rate); owner.frame = null; }
  }
  if (Math.abs(this.rate - this.target) > .003) this.frame = requestAnimationFrame(ease);
 },
 updateStatus: function(status, failed) {
  if (this.disposed) return;
  this.status = failed ? {} : status || {};
  var s = this.status, supported = yes(s.supported), running = yes(s.running) && yes(s.enabled);
  var unsupportedMode = supported && s.mode_supported != null && !yes(s.mode_supported) && s.mode !== 'smart';
  this.badge.dataset.state = failed || !supported || unsupportedMode ? 'error' : running ? 'running' : 'stopped';
  this.badge.lastChild.textContent = failed ? t('Status unavailable', '状态获取失败') : !supported ? t('Unsupported device', '设备不支持') : unsupportedMode ? t('Mode unavailable', '模式不可用') : running ? t('Cooling', '正在散热') : !yes(s.enabled) ? t('Disabled', '已停用') : t('Stopped', '已停止');
  this.device.textContent = s.model_name || s.board_name || t('Device unavailable', '设备信息未获取');
  this.note.textContent = failed ? t('Unable to read fan status. Retrying automatically.', '无法读取风扇状态，正在自动重试。') : !supported ? t('No compatible fan control was detected.', '未检测到兼容的温度传感器或风扇控制接口。') : unsupportedMode ? t('Manual and Turbo modes require a writable PWM fan interface.', '此设备不支持手动和狂暴模式，请使用智能模式。') : yes(s.enabled) && !running ? t('Service is enabled but not running.', '服务已启用，但尚未运行。') : s.error ? t('Fan control unavailable.', '风扇控制不可用。') : '';
  var temp = number(s.zone_temp), pwm = number(s.pwm_percent), rpm = number(s.fan_rpm);
  var off = number(s.configured_off_temp), on = number(s.configured_on_temp);
  this.badge.dataset.heat = running && supported && !unsupportedMode && temp != null && off != null && on != null && on > off ? temp >= on ? 'hot' : temp >= off ? 'warm' : 'cool' : 'unknown';
  this.cpu.textContent = temp == null ? '—' : temp.toFixed(1);
  this.pwm.textContent = pwm == null ? '—' : String(Math.round(pwm));
  this.rpm.textContent = rpm == null ? '—' : String(Math.round(rpm));
  this.speedSource.textContent = s.rpm_source === 'actual' ? t('Measured speed · illustrative rotation', '实测转速 · 动画仅示意') : s.rpm_source === 'estimated' ? t('Estimated from PWM · illustrative rotation', '按 PWM 估算 · 动画仅示意') : t('Speed unavailable', '转速未获取');
  this.mode.textContent = unsupportedMode ? t('Unavailable', '不可用') : supported && running ? modeLabel(s.mode) : '—';
  this.curve.hidden = !(supported && running && !unsupportedMode && s.mode === 'smart');
  this.curveOff.textContent = off == null ? '—' : off + ' °C';
  this.curveCurrent.textContent = temp == null ? '—' : temp.toFixed(1) + ' °C';
  this.curveOn.textContent = on == null ? '—' : on + ' °C';
  this.curveMarker.hidden = temp == null || off == null || on == null || on <= off;
  this.curveMarker.style.left = this.curveMarker.hidden ? '0%' : Math.max(0, Math.min(100, (temp - off) / (on - off) * 100)) + '%';
  this.updateProgress('rpm', rpm, number(s.fan_max_rpm));
  this.updateProgress('cpu', temp, on);
  this.updateProgress('pwm', pwm, 100);
  this.syncAnimation();
 },
 updateProgress: function(key, value, maximum) {
  var bar = this.progress[key], valid = value != null && maximum != null && maximum > 0;
  var ratio = valid ? Math.max(0, Math.min(100, value / maximum * 100)) : 0;
  bar.firstChild.style.width = ratio + '%';
  bar.dataset.warning = String(key === 'cpu' && valid && ratio >= 80);
  if (valid) { bar.setAttribute('aria-valuenow', ratio.toFixed(1)); bar.setAttribute('aria-valuetext', value + ' / ' + maximum); }
  else { bar.removeAttribute('aria-valuenow'); bar.setAttribute('aria-valuetext', '—'); }
 },
 pollStatus: function() {
  if (this.disposed || document.hidden) return Promise.resolve();
  return callGetStatus().then(function(s) { this.updateStatus(s); }.bind(this), function() { this.updateStatus({}, true); }.bind(this));
 },
 render: function(data) {
  this.cleanup(); this.disposed = false; this.rate = 1;
  var owner = this, initial = data[1] || {};
  var m = new form.Map('luci-fan');
  // LuCI removes old widgets during save/reset before inserting the new form.
  var checkDepends = m.checkDepends, renderContents = m.renderContents;
  m.checkDepends = function() { if (!this._fanRendering) return checkDepends.apply(this, arguments); };
  m.renderContents = function() {
   var map = this; map._fanRendering = true;
   return Promise.resolve().then(function() { return renderContents.call(map); }).then(function(node) {
    map._fanRendering = false; map.checkDepends(); return node;
   }, function(error) { map._fanRendering = false; throw error; });
  };
  var s = m.section(form.TypedSection, 'luci-fan'); s.anonymous = true; s.addremove = false;
  var o = s.option(form.Flag, 'enabled', t('Enable service', '启用服务')); o.rmempty = false; o.default = '0';
  var renderEnabled = o.renderWidget;
  o.renderWidget = function(id, index, value) {
   var widget = renderEnabled.call(this, id, index, value);
   widget.querySelector('input[type=checkbox]').setAttribute('aria-label', t('Enable service', '启用服务'));
   return widget;
  };
  o = s.option(form.ListValue, 'mode', t('Control mode', '控制模式')); o.widget = 'radio'; o.rmempty = false; o.default = 'smart';
  o.value('smart', E('span', {}, [ E('strong', {}, modeLabel('smart')), E('small', {}, t('Follow temperature', '随温度自动调速')) ]));
  o.value('turbo', E('span', {}, [ E('strong', {}, modeLabel('turbo')), E('small', {}, t('Maximum PWM output', '持续满速散热')) ]));
  o.value('manual', E('span', {}, [ E('strong', {}, modeLabel('manual')), E('small', {}, t('Fixed PWM output', '固定 PWM 输出')) ]));
  var renderMode = o.renderWidget;
  o.renderWidget = function(id, index, value) {
   var widget = renderMode.call(this, id, index, value);
   Array.from(widget.childNodes).forEach(function(node) { if (node.nodeType === 3) node.remove(); });
   widget.querySelectorAll('input').forEach(function(input) { input.setAttribute('aria-label', modeLabel(input.value)); });
   return widget;
  };
  function temperature(key, title, description, fallback) {
   var option = s.option(form.Value, key, title); option.rmempty = false; option.default = String(fallback); option.datatype = 'ufloat'; option.description = description; option.depends('mode', 'smart');
   option.validate = function(id, value) {
    var other = this.map.lookupOption(key === 'off_temp' ? 'on_temp' : 'off_temp', id)[0];
    var peer = other.formvalue(id); if (peer == null) peer = other.cfgvalue(id) || other.default;
    return number(value) != null && Number(value) >= 0 && (key === 'off_temp' ? Number(value) < Number(peer) : Number(value) > Number(peer)) ? true : t('Stop temperature must be lower than full-speed temperature.', '停转温度必须低于满速温度。');
   };
  }
  temperature('off_temp', t('Stop temperature (°C)', '停转温度（°C）'), t('Stop the fan below this temperature.', '低于此温度时停止风扇。'), 30);
  temperature('on_temp', t('Full-speed temperature (°C)', '满速温度（°C）'), t('Use maximum PWM at this temperature.', '达到此温度时输出最高 PWM。'), 60);
  o = s.option(form.Value, 'manual_pwm', t('Manual PWM (%)', '手动 PWM（%）')); o.rmempty = false; o.default = '70'; o.datatype = 'and(uinteger,min(0),max(100))'; o.depends('mode', 'manual'); o.description = t('0 stops the fan; 100 uses maximum PWM.', '0 停转，100 输出最高 PWM。');
  var renderManual = o.renderWidget;
  o.renderWidget = function(id, index, value) {
   var widget = renderManual.call(this, id, index, value), input = widget.querySelector('input');
   if (input) { input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1'; }
   var output = E('output', { 'class': 'range-value' }, (value == null ? this.default : value) + '%'); widget.appendChild(output);
   if (input) input.addEventListener('input', function() { output.textContent = input.value + '%'; });
   return widget;
  };
  o = s.option(form.Value, 'max_rpm', t('Maximum speed (RPM)', '最大转速（RPM）')); o.rmempty = false; o.default = '3000'; o.datatype = 'and(uinteger,min(500),max(10000))'; o.description = t('Speed display and estimation ceiling.', '用于匹配风扇的显示与估算上限。');
  o = s.option(form.Value, 'poll_interval', t('Control interval (seconds)', '控制间隔（秒）')); o.rmempty = false; o.default = '5'; o.datatype = 'and(uinteger,min(1),max(30))'; o.description = t('Five seconds is recommended.', '建议保持 5 秒。');
  this.map = m;
  return m.render().then(function(mapNode) {
   mapNode.dataset.heading = t('Basic settings', '基本设置');
   owner.badge = E('span', { 'class': 'lf-chip' }, [ E('i'), E('span') ]); owner.device = E('span', { 'class': 'lf-tag' }); owner.note = E('p', { 'class': 'lf-runtime-error lf-muted', role: 'status' });
   var interval = Math.max(2, Math.min(30, number(initial.poll_interval) || 5));
   owner.progress = {};
   function progress(key, label) {
    return owner.progress[key] = E('div', { 'class': 'lf-progress lf-progress-' + key, role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100' }, [E('span', { 'class': 'lf-progress-fill' })]);
   }
   owner.curveMarker = E('i', { 'class': 'lf-curve-marker', 'aria-hidden': 'true' });
   owner.curveOff = E('b'); owner.curveCurrent = E('b'); owner.curveOn = E('b');
   owner.curve = E('div', { 'class': 'lf-curve' }, [ E('div', {}, t('Smart curve', '智能曲线')), E('div', { 'class': 'lf-curve-track', 'aria-hidden': 'true' }, [owner.curveMarker]),
    E('div', { 'class': 'lf-curve-values' }, [ E('span', {}, [t('Stop', '停转'), owner.curveOff]), E('span', {}, [t('Current', '当前'), owner.curveCurrent]), E('span', {}, [t('Full speed', '满速'), owner.curveOn]) ]) ]);
   function metric(title, key, unit, color) {
    owner[key] = E('span');
    return E('div', { 'class': 'lf-metric' }, [ E('span', { 'class': 'lf-label' }, title), E('div', { 'class': 'lf-number lf-' + color }, [ owner[key], E('small', {}, unit) ]) ].concat(key === 'mode' ? [owner.curve] : [progress(key, title)]));
   }
   owner.rpm = E('span'); owner.speedSource = E('span', { 'class': 'lf-muted' }); var svg = fanIcon();
   owner.root = E('div', { 'class': 'lf-page' }, [ E('style', {}, style), E('div', { 'class': 'lf-heading' }, [ E('span', { 'class': 'lf-icon', 'aria-hidden': 'true' }, '✾'), E('h2', {}, t('Fan Control', '风扇控制')) ]),
    E('div', { 'class': 'lf-card lf-status' }, [ owner.badge, owner.device, E('span', { 'class': 'lf-muted' }, t('Refresh every %s seconds', '每 %s 秒刷新').format(interval)) ]), owner.note,
    E('div', { 'class': 'lf-card lf-live' }, [ E('div', { 'class': 'lf-fan-unit' }, [ E('div', { 'class': 'lf-fan-stage' }, [svg, E('div', { 'class': 'lf-fan-value' }, [owner.rpm, E('small', {}, 'RPM')])]), owner.speedSource, progress('rpm', t('Maximum speed (RPM)', '最大转速（RPM）')) ]), metric(t('CPU temperature', 'CPU 温度'), 'cpu', ' °C', 'blue'), metric(t('PWM duty', 'PWM 占空比'), 'pwm', ' %', 'purple'), metric(t('Running mode', '运行模式'), 'mode', '', 'green') ]), mapNode ]);
   owner.motion = matchMedia('(prefers-reduced-motion: reduce)'); var rotor = svg.querySelector('.lf-rotor');
   if (rotor.animate) { owner.animation = rotor.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 2400, iterations: Infinity }); owner.animation.pause(); }
   owner.visibility = function() { owner.syncAnimation(); if (!document.hidden) owner.pollStatus(); };
   document.addEventListener('visibilitychange', owner.visibility); owner.motion.addEventListener('change', owner.visibility);
   owner.leave = function(event) {
    if (!event.persisted) { owner.cleanup(); return; }
    if (owner.frame) cancelAnimationFrame(owner.frame);
    owner.frame = null;
    if (owner.animation) owner.animation.pause();
   };
   window.addEventListener('pagehide', owner.leave); window.addEventListener('pageshow', owner.visibility);
   var attached = false;
   owner.observer = new MutationObserver(function() {
    if (owner.root.isConnected) {
     if (!attached) { attached = true; owner.syncAnimation(); }
     var html = document.documentElement, body = document.body;
     var theme = html.className + ' ' + body.className + ' ' + html.getAttribute('data-theme') + ' ' + body.getAttribute('data-theme');
     var background = getComputedStyle(body).backgroundColor.match(/\d+/g);
     owner.root.classList.toggle('lf-dark', /\b(?:dark|mode-dark|argon-dark)\b/i.test(theme) || !!(background && Number(background[0]) < 100));
    } else if (attached) owner.cleanup();
   });
   owner.observer.observe(document.body, { childList: true, attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
   owner.observer.observe(document.getElementById('view') || document.getElementById('maincontent') || document.body, { childList: true });
   owner.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
   owner.updateStatus(initial); owner.poller = owner.pollStatus.bind(owner); poll.add(owner.poller, interval);
   return owner.root;
  });
 }
});

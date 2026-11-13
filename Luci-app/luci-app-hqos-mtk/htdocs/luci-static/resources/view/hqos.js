'use strict';
'require form';
'require uci';
'require view';
'require rpc';
'require poll';
'require network';

var style = `
.mtk-hqos,#cbi-mtk-hqos,.modal:has(>#cbi-mtk-hqos){--hqos-accent:var(--primary,#5e72e4);--hqos-text:#263b58;--hqos-line:rgba(134,153,181,.22);--hqos-panel:linear-gradient(150deg,rgba(255,255,255,.74),rgba(248,251,255,.58));--hqos-hero:linear-gradient(110deg,rgba(231,239,255,.76),rgba(252,254,255,.60),rgba(230,249,252,.66));--hqos-input:rgba(255,255,255,.48);--hqos-shadow:0 5px 18px rgba(50,73,109,.07),inset 0 1px rgba(255,255,255,.62);--hqos-control-width:380px}
.mtk-hqos.hqos-dark,body:has(.mtk-hqos.hqos-dark) #cbi-mtk-hqos,body:has(.mtk-hqos.hqos-dark) .modal:has(>#cbi-mtk-hqos){--hqos-accent:var(--dark-link-color,#b0c1ff);--hqos-text:#d5deeb;--hqos-line:rgba(183,200,224,.16);--hqos-panel:linear-gradient(150deg,rgba(42,46,56,.66),rgba(24,29,39,.56));--hqos-hero:linear-gradient(110deg,rgba(47,56,82,.70),rgba(30,36,48,.58),rgba(29,49,55,.62));--hqos-input:rgba(12,17,26,.32);--hqos-shadow:0 6px 20px rgba(0,0,0,.18),inset 0 1px rgba(255,255,255,.07)}
.mtk-hqos{display:grid;grid-template-columns:minmax(0,1fr);align-content:start;gap:12px;width:100%;min-width:0;color:var(--hqos-text);font-family:inherit;font-size:14px;line-height:1.5;text-transform:none;background:radial-gradient(ellipse at 5% 0%,rgba(113,137,224,.10),transparent 55%),radial-gradient(ellipse at 95% 35%,rgba(64,176,186,.06),transparent 55%);border-radius:16px}
.mtk-hqos *{box-sizing:border-box}
.mtk-hqos .hqos-header,.mtk-hqos .cbi-section{min-width:0;max-width:100%;border:1px solid var(--hqos-line);border-radius:16px;background:var(--hqos-panel)!important;box-shadow:var(--hqos-shadow);backdrop-filter:blur(16px) saturate(145%);-webkit-backdrop-filter:blur(16px) saturate(145%);padding:16px;margin:0;overflow:visible;position:relative}
.mtk-hqos .cbi-section{display:block}
.mtk-hqos .cbi-section:has(.cbi-dropdown[open]){z-index:10}
.mtk-hqos .hqos-header{background:var(--hqos-hero)!important;display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,.8fr);gap:16px;align-items:center}
.mtk-hqos .hqos-identity{display:flex;align-items:center;gap:12px;min-width:0}
.mtk-hqos .hqos-identity>div{min-width:0}
.mtk-hqos .hqos-icon{display:grid;place-items:center;width:52px;height:52px;flex-shrink:0;border-radius:14px;background:linear-gradient(140deg,var(--primary,#5e72e4),color-mix(in srgb,var(--primary,#5e72e4) 74%,white));color:#fff;box-shadow:inset 0 1px rgba(255,255,255,.20)}
.mtk-hqos .hqos-icon svg{width:34px;height:34px}
.mtk-hqos .hqos-title{margin:0 0 6px;padding:0;border:0;background:none;box-shadow:none;font-size:20px;font-weight:700;line-height:1.3;color:inherit}
.mtk-hqos .hqos-subtitle{margin:5px 0 0;font-size:12px;opacity:.7}
.mtk-hqos .hqos-status{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:12px;line-height:1.5;background:rgba(128,128,128,.12);color:inherit}
.mtk-hqos .hqos-status::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
.mtk-hqos .hqos-good{color:#159b70}.mtk-hqos .hqos-status.hqos-good{background:rgba(21,155,112,.12)}
.mtk-hqos .hqos-bad{color:var(--red,#f5365c)}.mtk-hqos .hqos-status.hqos-bad{background:rgba(245,54,92,.10)}
.mtk-hqos .hqos-metrics{display:grid;gap:8px;min-width:0}
.mtk-hqos .hqos-metric{min-width:0;border:1px solid var(--hqos-line);border-radius:12px;padding:8px 12px;background:var(--hqos-input)}
.mtk-hqos .hqos-metric>span{display:block;font-size:12px;opacity:.7;margin-bottom:3px}
.mtk-hqos .hqos-metric>strong{font-size:20px;line-height:1.2;color:var(--hqos-accent);font-variant-numeric:tabular-nums}
.mtk-hqos .hqos-metric>strong.hqos-good{color:#159b70}
.mtk-hqos .cbi-map{margin:0;padding:0;border:0;background:transparent!important;box-shadow:none;display:grid;grid-template-columns:minmax(0,1fr);gap:12px;overflow:visible}
.mtk-hqos .cbi-map>h2,.mtk-hqos .cbi-map-descr{display:none}
.mtk-hqos .cbi-section>h3{margin:0 0 10px;padding:0;background:none;border:0;box-shadow:none;color:inherit;font-size:17px;line-height:1.4;overflow:visible}
.mtk-hqos .cbi-section-descr{margin:0 0 8px;padding:0;font-size:12px;line-height:1.5;color:inherit;opacity:.75}
#cbi-mtk-hqos{color:var(--hqos-text);font-family:inherit;font-size:14px;line-height:1.5;text-transform:none;container-type:inline-size;container-name:hqos-form}
#cbi-mtk-hqos .cbi-section-node{margin:0;padding:0;gap:0;background:none;border:0;box-shadow:none}
#cbi-mtk-hqos-global{display:grid;grid-template-columns:minmax(0,1fr);gap:0;align-items:start}
#cbi-mtk-hqos .cbi-section-node>.cbi-value:not(.hidden){display:grid;grid-template-columns:140px minmax(0,var(--hqos-control-width));align-items:start;column-gap:12px;row-gap:5px;min-width:0;min-height:0;height:auto;margin:0;padding:6px 0;background:none;border:0}
#cbi-mtk-hqos .cbi-section-node>.cbi-value>.cbi-value-title{float:none;flex:none;min-width:0;min-height:0;width:auto;height:auto;max-width:100%;padding:8px 0 0;text-align:left;line-height:20px;color:inherit;overflow:visible}
#cbi-mtk-hqos .cbi-section-node>.cbi-value>.cbi-value-field{display:block;flex:none;min-width:0;min-height:0;width:100%;height:auto;margin:0;padding:0;line-height:20px}
#cbi-mtk-hqos .cbi-value-field>div[id]:not(.cbi-checkbox){width:100%;max-width:var(--hqos-control-width)}
#cbi-mtk-hqos input[type=text],#cbi-mtk-hqos input[type=number],#cbi-mtk-hqos select,#cbi-mtk-hqos .cbi-dropdown,#cbi-mtk-hqos .cbi-dynlist{font:inherit;line-height:20px;box-sizing:border-box;width:100%!important;max-width:var(--hqos-control-width)!important;min-width:0!important}
#cbi-mtk-hqos input[type=text],#cbi-mtk-hqos input[type=number],#cbi-mtk-hqos select,#cbi-mtk-hqos .cbi-dropdown{height:36px;min-height:36px;border:1px solid var(--hqos-line);border-radius:8px;padding:7px 10px;background-color:var(--hqos-input)!important;color:var(--hqos-text)!important;box-shadow:inset 0 1px rgba(255,255,255,.05)}
#cbi-mtk-hqos .cbi-dropdown[open]{height:auto}
#cbi-mtk-hqos input:focus-visible,#cbi-mtk-hqos select:focus-visible,#cbi-mtk-hqos .cbi-dropdown:focus-within{outline:2px solid var(--hqos-accent);outline-offset:2px}
#cbi-mtk-hqos input[type=checkbox]{accent-color:var(--hqos-accent)}
#cbi-mtk-hqos .cbi-checkbox{display:inline-flex;align-items:center;width:auto;min-width:0;height:32px;min-height:32px;margin:0;padding:0}
#cbi-mtk-hqos #cbi-mtk-hqos-global>.cbi-value[data-name="enabled"]{grid-column:1/-1;align-items:center;min-height:36px;padding:2px 0}
#cbi-mtk-hqos #cbi-mtk-hqos-global>.cbi-value[data-name="enabled"]>.cbi-value-title{padding-top:0}
#cbi-mtk-hqos .cbi-dynlist{gap:4px}
#cbi-mtk-hqos .cbi-dynlist>.item{width:100%;max-width:100%;height:36px;min-height:36px;margin:0;box-sizing:border-box}
#cbi-mtk-hqos .cbi-dynlist>.item>span{flex:1 1 auto;width:auto;min-width:0;height:36px;padding:7px 10px;line-height:20px;font:inherit}
#cbi-mtk-hqos .cbi-dynlist>.item::after{flex-basis:36px;width:36px!important;height:36px}
#cbi-mtk-hqos .cbi-dynlist>.add-item{width:100%;margin:0}
#cbi-mtk-hqos .cbi-dynlist>.add-item>.cbi-dropdown{width:100%!important}
#cbi-mtk-hqos .cbi-dropdown>ul{min-width:0}
#cbi-mtk-hqos .cbi-value-description{display:block;padding:0;margin:5px 0 0;font-size:12px;line-height:1.5;max-width:var(--hqos-control-width)}
#cbi-mtk-hqos .cbi-value-description:empty{display:none}
.mtk-hqos .cbi-button,#cbi-mtk-hqos .cbi-button,.modal:has(>#cbi-mtk-hqos)>.button-row>.cbi-button{font-family:inherit;font-size:13px;line-height:20px;text-transform:none;border-radius:8px;min-height:34px;padding:6px 10px}
.mtk-hqos .table{width:100%;margin:0 0 8px;background:transparent}
.mtk-hqos .tr,.mtk-hqos .th,.mtk-hqos .td{background:transparent;color:inherit}
.mtk-hqos .th{font-size:12px;font-weight:600;line-height:1.5;text-transform:none}
.mtk-hqos .td{font-size:13px;line-height:1.5}
.mtk-hqos .cbi-section-table-titles{background:color-mix(in srgb,var(--hqos-accent) 6%,transparent)}
.mtk-hqos .hqos-error{padding:10px 12px;border:1px solid currentColor;border-radius:10px;color:var(--red,#f5365c);background:rgba(245,54,92,.06);font-size:13px}
.mtk-hqos [hidden]{display:none!important}
.mtk-hqos .hqos-queue-scroll{min-width:0;max-width:100%;overflow-x:auto;border:1px solid var(--hqos-line);border-radius:10px}
.mtk-hqos .hqos-queues{min-width:600px;margin:0}
.mtk-hqos .hqos-queues.table{display:table;table-layout:fixed;width:100%}
.mtk-hqos .hqos-queues .tr,.mtk-hqos .hqos-queues .table-titles{display:table-row}
.mtk-hqos .hqos-queues .td,.mtk-hqos .hqos-queues .th{display:table-cell;white-space:nowrap;padding:8px 10px;font-variant-numeric:tabular-nums}
.mtk-hqos .hqos-note{margin:8px 0 0;font-size:12px;opacity:.7}
#modal_overlay .modal.cbi-modal:has(>#cbi-mtk-hqos){box-sizing:border-box;width:calc(100% - 32px);max-width:640px;min-width:0;max-height:calc(100vh - 40px);max-height:calc(100dvh - 40px);margin:20px auto;padding:18px;overflow-y:auto;font-family:inherit;font-size:14px;line-height:1.5;text-transform:none;color:var(--hqos-text);background:var(--hqos-panel);border:1px solid var(--hqos-line);box-shadow:var(--hqos-shadow);backdrop-filter:blur(18px) saturate(145%);-webkit-backdrop-filter:blur(18px) saturate(145%)}
#modal_overlay .modal.cbi-modal:has(>#cbi-mtk-hqos)>h4{font-size:17px;line-height:1.4;margin:0 0 8px;color:inherit}
#modal_overlay #cbi-mtk-hqos .cbi-section{padding:0;margin:0;border:0;box-shadow:none;background:none}
#modal_overlay .modal.cbi-modal:has(>#cbi-mtk-hqos)>.button-row{flex-wrap:nowrap;gap:8px;padding-top:8px;margin-top:6px}
#modal_overlay .modal.cbi-modal:has(>#cbi-mtk-hqos)>.button-row>.cbi-button{flex:0 0 auto}
@container hqos-form (min-width:58rem){.mtk-hqos #cbi-mtk-hqos-global{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:24px}}
@container hqos-form (max-width:34rem){
 #cbi-mtk-hqos .cbi-section-node>.cbi-value:not(.hidden){grid-template-columns:minmax(0,1fr);row-gap:5px;padding:5px 0}
 #cbi-mtk-hqos .cbi-section-node>.cbi-value>.cbi-value-title{padding:0}
 #cbi-mtk-hqos #cbi-mtk-hqos-global>.cbi-value[data-name="enabled"]{grid-template-columns:auto minmax(0,1fr);padding:2px 0}
}
@media(max-width:700px){
 .mtk-hqos{gap:10px}
 #cbi-mtk-hqos input[type=text],#cbi-mtk-hqos input[type=number],#cbi-mtk-hqos select,#cbi-mtk-hqos .cbi-dropdown,#cbi-mtk-hqos .cbi-dynlist{font-size:16px}
 .mtk-hqos .hqos-header,.mtk-hqos .cbi-section{padding:12px;border-radius:14px}
 .mtk-hqos .hqos-header{grid-template-columns:minmax(0,1fr);gap:10px}
 .mtk-hqos .hqos-identity{gap:10px}.mtk-hqos .hqos-icon{width:44px;height:44px;border-radius:12px}.mtk-hqos .hqos-icon svg{width:30px;height:30px}.mtk-hqos .hqos-title{font-size:18px}
 .mtk-hqos .hqos-metric{padding:7px 10px}.mtk-hqos .hqos-metric>strong{font-size:18px}
 .mtk-hqos .cbi-section>h3{font-size:16px;margin-bottom:8px}
 #cbi-mtk-hqos-rule tbody{display:block}
 #cbi-mtk-hqos-rule tbody>.tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px;padding:10px;border:1px solid var(--hqos-line);border-radius:10px;margin-bottom:8px;background:var(--hqos-input)!important}
 #cbi-mtk-hqos-rule tbody>.tr>.td{width:auto!important;min-width:0!important;padding:0;text-align:left;overflow-wrap:anywhere}
 #cbi-mtk-hqos-rule tbody>.tr>.td:before{display:block;width:auto;margin:0 0 3px;font-size:12px;font-weight:400;opacity:.65}
 #cbi-mtk-hqos-rule .td[data-name="_path"]{grid-column:1/-1}
 #cbi-mtk-hqos-rule .cbi-section-actions{grid-column:1/-1;padding-top:2px!important}
 #cbi-mtk-hqos-rule .cbi-section-actions>div{display:flex;justify-content:flex-end;gap:6px}
 .mtk-hqos #cbi-mtk-hqos #cbi-mtk-hqos-global>.cbi-value:not(.hidden):not([data-name="enabled"]){grid-template-columns:96px minmax(0,1fr);column-gap:10px;align-items:start}
}
@media(max-width:600px){
 #cbi-mtk-hqos .cbi-section-node>.cbi-value:not(.hidden){grid-template-columns:minmax(0,1fr);row-gap:5px;padding:5px 0}
 #cbi-mtk-hqos .cbi-section-node>.cbi-value>.cbi-value-title{padding:0}
 #cbi-mtk-hqos #cbi-mtk-hqos-global>.cbi-value[data-name="enabled"]{grid-template-columns:auto minmax(0,1fr);padding:2px 0}
 #modal_overlay .modal.cbi-modal:has(>#cbi-mtk-hqos){width:calc(100% - 20px);max-height:calc(100vh - 20px);max-height:calc(100dvh - 20px);margin:10px auto;padding:14px}
}

`;

var callStatus = rpc.declare({ object: 'luci.hqos', method: 'getStatus', expect: { '': {} } });
var callInterfaces = rpc.declare({ object: 'network.interface', method: 'dump', expect: { 'interface': [] } });
var CONFIG = 'mtk-hqos';

function list(value) { return Array.isArray(value) ? value : []; }
function rateRead(section) { return String(Number(uci.get(CONFIG, section, this.option) || 0) / 1000); }
function rateWrite(section, value) { uci.set(CONFIG, section, this.option, String(Math.round(Number(value) * 1000))); }
function rateValidate(section, value) {
	var n = Number(value), kbit = n * 1000;
	return /^\d+(\.\d{1,3})?$/.test(value) && Number.isFinite(n) && n >= 0 && n <= 10000 &&
		Math.abs(kbit - Math.round(kbit)) < 0.000001 || _('范围为 0–10000 Mbit/s，最多三位小数。');
}
function rateText(section) {
	var n = Number(uci.get(CONFIG, section, this.option) || 0);
	return n > 0 ? (n / 1000) + ' Mbit/s' : _('不限速');
}
function label(state) {
	if (state.busy) return _('正在应用');
	if (state.schema !== 1) return _('状态不可用');
	if (state.error) return _('需要处理');
	if (!state.enabled) return state.owned ? _('待清理') : _('未开启');
	if (state.applied) return _('已应用');
	return _('等待应用');
}
function countText(value) {
	return Number.isFinite(value) && value >= 0 ? value.toLocaleString() : _('不可用');
}
function target(section) {
	var kind = uci.get(CONFIG, section, 'selector') || 'ip';
	if (kind === 'port') return (uci.get(CONFIG, section, 'proto') || 'both').toUpperCase() + ' ' +
		(uci.get(CONFIG, section, 'ports') || '—') + (uci.get(CONFIG, section, 'address') ? ' · ' + uci.get(CONFIG, section, 'address') : '');
	return uci.get(CONFIG, section, kind) || '—';
}
function speedIcon() {
	var node = E('span', { 'class': 'hqos-icon', 'aria-hidden': 'true' });
	node.innerHTML = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 35a18 18 0 1 1 30 0"/><path d="m24 24 10-10M9 24h3m24 0h3M14 12l2 3m8-9v3m10 3-2 3"/><circle cx="24" cy="24" r="3" fill="currentColor"/></svg>';
	return node;
}

return view.extend({
	load: function() {
		return Promise.all([ uci.load(CONFIG), L.resolveDefault(callStatus(), {}),
			L.resolveDefault(network.getHostHints(), {}), L.resolveDefault(callInterfaces(), []) ]);
	},
	render: function(data) {
		var state = data[1] || {}, hosts = data[2].hosts || {}, interfaces = list(data[3]);
		var m = new form.Map(CONFIG), s, o, page;
		var service = E('strong', { 'class': 'hqos-status', 'role': 'status' });
		var queueCount = E('strong'), ruleCount = E('strong');
		var message = E('div', { 'class': 'hqos-error', 'role': 'status' });
		var queues = E('div', { 'class': 'table hqos-queues', 'role': 'table', 'aria-label': _('QDMA 队列') });
		var paths = {};
		var header = E('div', { 'class': 'hqos-header' }, [
			E('div', { 'class': 'hqos-identity' }, [ speedIcon(), E('div', {}, [
				E('h2', { 'class': 'hqos-title' }, _('网速控制')), service,
				E('p', { 'class': 'hqos-subtitle' }, _('设备与端口限速'))
			]) ]),
			E('div', { 'class': 'hqos-metrics', 'style': 'grid-template-columns:repeat(2,minmax(0,1fr))' }, [
				E('div', { 'class': 'hqos-metric' }, [ E('span', {}, _('已应用规则')), ruleCount ]),
				E('div', { 'class': 'hqos-metric' }, [ E('span', {}, _('可见硬件队列')), queueCount ])
			])
		]);

		s = m.section(form.NamedSection, 'global', 'hqos', _('基本设置'));
		s.anonymous = true;
		o = s.option(form.Flag, 'enabled', _('启用限速'));
		o.default = '0'; o.rmempty = false;
		o = s.option(form.ListValue, 'lan', _('LAN 网络'));
		o.rmempty = false;
		interfaces.forEach(function(item) { if (item.interface !== 'loopback') o.value(item.interface, item.interface + (item.l3_device ? ' · ' + item.l3_device : '')); });
		var configuredLan = uci.get(CONFIG, 'global', 'lan') || 'lan';
		if (!interfaces.some(function(item) { return item.interface === configuredLan; })) o.value(configuredLan);
		o = s.option(form.DynamicList, 'wan', _('WAN 网络'));
		o.rmempty = false; o.datatype = 'uciname';
		interfaces.forEach(function(item) { if (item.interface !== 'loopback') o.value(item.interface); });
		[ 'download', 'upload' ].forEach(function(key) {
			o = s.option(form.Value, key, (key === 'download' ? _('硬件总下载') : _('硬件总上传')) + ' (Mbit/s)');
			o.rmempty = false; o.default = '0'; o.datatype = 'and(ufloat,min(0),max(10000))'; o.validate = rateValidate;
			o.description = _('0 表示不设置总上限；软件限速规则独立生效。');
		});

		s = m.section(form.GridSection, 'rule', _('限速规则'));
		s.anonymous = true; s.addremove = true; s.sortable = true; s.nodescriptions = true;
		s.modaltitle = _('编辑限速规则');
		s.description = _('自动模式优先分配硬件队列，条件或队列不足时使用软件限速。代理流量请选软件限速。');
		o = s.option(form.Flag, 'enabled', _('启用'));
		o.default = '1'; o.rmempty = false; o.editable = true;
		o = s.option(form.Value, 'name', _('名称'));
		o.datatype = 'maxlength(80)'; o.modalonly = true;
		o = s.option(form.DummyValue, '_target', _('目标'));
		o.modalonly = false;
		o.textvalue = function(section) { return uci.get(CONFIG, section, 'name') || target(section); };
		o = s.option(form.ListValue, 'selector', _('匹配类型'));
		o.modalonly = true; o.rmempty = false; o.default = 'ip';
		o.value('ip', _('IPv4 地址或网段')); o.value('ip6', _('IPv6 地址或网段')); o.value('mac', _('MAC 地址')); o.value('port', _('TCP / UDP 端口'));
		o.write = function(section, value) {
			uci.set(CONFIG, section, 'selector', value);
			[ 'ip', 'ip6', 'mac', 'ports', 'proto', 'port_side', 'address' ].forEach(function(key) {
				if (key !== value && !(value === 'port' && [ 'ports', 'proto', 'port_side', 'address' ].indexOf(key) >= 0)) uci.unset(CONFIG, section, key);
			});
		};
		[ 'ip', 'ip6', 'mac' ].forEach(function(kind) {
			o = s.option(form.Value, kind, kind === 'mac' ? _('MAC 地址') : kind === 'ip6' ? _('IPv6 地址或网段') : _('IPv4 地址或网段'));
			o.modalonly = true; o.rmempty = false; o.depends('selector', kind);
			o.datatype = kind === 'mac' ? 'macaddr' : kind === 'ip6' ? 'ip6addr' : 'ip4addr';
			Object.keys(hosts).forEach(function(mac) {
				var host = hosts[mac], values = kind === 'mac' ? [ mac ] : L.toArray(host[kind === 'ip6' ? 'ip6addrs' : 'ipaddrs'] || host[kind === 'ip6' ? 'ipv6' : 'ipv4']);
				values.forEach(function(address) { o.value(address, host.name ? host.name + ' (' + address + ')' : address); });
			});
		});
		o = s.option(form.ListValue, 'proto', _('协议'));
		o.modalonly = true; o.depends('selector', 'port'); o.default = 'both'; o.rmempty = false;
		o.value('both', 'TCP + UDP'); o.value('tcp', 'TCP'); o.value('udp', 'UDP');
		o = s.option(form.Value, 'ports', _('端口'));
		o.modalonly = true; o.depends('selector', 'port'); o.rmempty = false; o.placeholder = '443,8000-8100';
		o.validate = function(section, value) {
			var terms = String(value || '').replace(/\s/g, '').split(',');
			return terms.length <= 16 && terms.every(function(term) {
				var match = /^(\d+)(?:[-:](\d+))?$/.exec(term);
				return match && +match[1] >= 1 && +match[1] <= 65535 && (!match[2] || (+match[2] >= +match[1] && +match[2] <= 65535));
			}) || _('请输入端口或端口段，最多 16 项。');
		};
		o = s.option(form.ListValue, 'port_side', _('端口位置'));
		o.modalonly = true; o.depends('selector', 'port'); o.default = 'remote'; o.rmempty = false;
		o.value('remote', _('远端服务端口')); o.value('local', _('本地设备端口')); o.value('any', _('任一端'));
		o = s.option(form.Value, 'address', _('限定设备或网段'));
		o.modalonly = true; o.depends('selector', 'port'); o.datatype = 'ipaddr';
		o.description = _('留空时匹配所选 LAN 的设备。');
		o = s.option(form.ListValue, 'engine', _('限速方式'));
		o.modalonly = true; o.rmempty = false; o.default = 'auto';
		o.value('auto', _('自动')); o.value('hardware', _('硬件')); o.value('software', _('软件'));
		o = s.option(form.DummyValue, '_path', _('应用路径'));
		o.modalonly = false;
		o.textvalue = function(section) {
			var rule = paths[section];
			var text = !rule ? _('待应用') : rule.pending_address ? _('等待设备地址') : rule.path === 'hardware' ? 'Q' + rule.up_qid + ' ↑ / Q' + rule.down_qid + ' ↓' : _('软件');
			return E('span', { 'data-hqos-rule': section }, text);
		};
		[ 'download', 'upload' ].forEach(function(key) {
			o = s.option(form.Value, key, (key === 'download' ? _('下载') : _('上传')) + ' (Mbit/s)');
			o.datatype = 'and(ufloat,min(0),max(10000))'; o.rmempty = false; o.default = '0';
			o.cfgvalue = rateRead; o.write = rateWrite; o.validate = rateValidate; o.textvalue = rateText;
			o.description = _('0 表示不限速。');
		});

		function update(updated) {
			if (!updated || updated.schema !== 1) updated = { schema: 0, error: _('无法获取网速控制状态') };
			if (updated.busy) { service.textContent = label(updated); return; }
			state = updated;
			paths = {};
			list(state.rules).forEach(function(rule) { paths[rule.id] = rule; });
			service.textContent = label(state);
			service.className = 'hqos-status ' + (state.error ? 'hqos-bad' : state.applied ? 'hqos-good' : '');
			queueCount.textContent = countText(state.total_queues);
			ruleCount.textContent = String(list(state.rules).length);
			message.textContent = state.error || '';
			message.hidden = !state.error;
			queues.replaceChildren(E('div', { 'class': 'tr table-titles', 'role': 'row' },
				[ _('队列'), _('方向'), _('实际上限'), _('包数'), _('丢包'), _('字节') ].map(function(text) { return E('div', { 'class': 'th', 'role': 'columnheader' }, text); })));
			list(state.queues).forEach(function(queue) {
				queues.appendChild(E('div', { 'class': 'tr', 'role': 'row' }, [
					E('div', { 'class': 'td' }, 'Q' + queue.id + (queue.verified ? '' : ' !')),
					E('div', { 'class': 'td' }, queue.direction === 'up' ? _('上传') : _('下载')),
					E('div', { 'class': 'td' }, queue.rate_kbps > 0 ? (queue.rate_kbps / 1000) + ' Mbit/s' : _('不限速')),
					E('div', { 'class': 'td' }, countText(queue.packets)), E('div', { 'class': 'td' }, countText(queue.drops)),
					E('div', { 'class': 'td' }, Number.isFinite(queue.bytes) ? '%1024.2mB'.format(queue.bytes) : _('不可用'))
				]));
			});
			if (!list(state.queues).length) queues.appendChild(E('div', { 'class': 'tr' }, E('div', { 'class': 'td' }, _('暂无已分配的硬件队列'))));
			if (page) {
				page.querySelectorAll('[data-hqos-rule]').forEach(function(node) {
					var rule = paths[node.getAttribute('data-hqos-rule')];
					node.textContent = !rule ? _('待应用') : rule.pending_address ? _('等待设备地址') : rule.path === 'hardware' ? 'Q' + rule.up_qid + ' ↑ / Q' + rule.down_qid + ' ↓' : _('软件');
				});
				var root = document.documentElement, mode = root.getAttribute('data-argon-mode');
				var background = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
				var opaqueDark = background && (background.length < 4 || Number(background[3]) > 0) && Number(background[0]) < 100;
				page.classList.toggle('hqos-dark', mode === 'dark' || mode !== 'light' && (getComputedStyle(root).colorScheme === 'dark' || opaqueDark));
			}
		}
		update(state);
		poll.add(function() { return callStatus().then(update).catch(function() { update({ schema: 0 }); }); }, 5);
		return m.render().then(function(formNode) {
			page = E('div', { 'class': 'mtk-hqos' }, [ E('style', {}, style), header, message, formNode,
				E('section', { 'class': 'cbi-section' }, [ E('h3', {}, _('QDMA 队列')),
					E('div', { 'class': 'hqos-queue-scroll' }, queues),
					E('p', { 'class': 'hqos-note' }, _('计数来自驱动；缺失时显示不可用。')) ]) ]);
			update(state);
			return page;
		});
	}
});

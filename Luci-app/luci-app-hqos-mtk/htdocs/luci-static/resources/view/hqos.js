'use strict';
'require form';
'require uci';
'require view';
'require rpc';
'require poll';
'require ui';
'require network';

var style = `
.mtk-hqos,#cbi-mtk-hqos{--hqos-accent:var(--primary,#5e72e4);--hqos-text:#263b58;--hqos-line:#dfe7f1;--hqos-panel:linear-gradient(180deg,rgba(255,255,255,.98),rgba(249,252,255,.99));--hqos-hero:linear-gradient(100deg,#e9f1ff 0%,#f8fbff 52%,#eefbff 100%);--hqos-input:linear-gradient(180deg,#fbfdff,#f5f8fc);--hqos-help-color:#5878a6;--hqos-shadow:0 6px 16px rgba(73,99,135,.08)}
.mtk-hqos{display:grid;gap:18px;width:100%;min-width:0;color:var(--hqos-text);font-family:inherit;font-size:14px;line-height:1.5;text-transform:none}
.mtk-hqos.hqos-dark,body:has(.mtk-hqos.hqos-dark) #cbi-mtk-hqos{--hqos-accent:var(--dark-primary,var(--primary,#5e72e4));--hqos-text:#cbd8ea;--hqos-line:rgba(120,146,188,.22);--hqos-panel:linear-gradient(180deg,rgba(19,29,44,.98),rgba(13,22,35,.99));--hqos-hero:linear-gradient(100deg,rgba(22,34,58,.98),rgba(17,27,48,.98) 52%,rgba(14,34,45,.98));--hqos-input:linear-gradient(180deg,rgba(30,42,60,.98),rgba(18,28,42,.98));--hqos-help-color:#b0cdf0;--hqos-shadow:0 14px 30px rgba(0,0,0,.28)}
#cbi-mtk-hqos{color:var(--hqos-text)}
.mtk-hqos *{box-sizing:border-box}
.mtk-hqos .hqos-header,.mtk-hqos .cbi-section{border:1px solid var(--hqos-line);border-radius:20px;background:var(--hqos-panel)!important;box-shadow:var(--hqos-shadow);backdrop-filter:none;padding:22px;margin:0;overflow:visible;position:relative}
.mtk-hqos .hqos-header:has(.hqos-hint:hover,.hqos-hint:focus-within),.mtk-hqos .cbi-section:has(.hqos-hint:hover,.hqos-hint:focus-within){z-index:2}
.mtk-hqos .hqos-header{background:var(--hqos-hero)!important;display:grid;grid-template-columns:minmax(0,1.5fr) minmax(220px,1fr);gap:24px;align-items:center}
.mtk-hqos .hqos-identity{--hqos-icon-space:92px;display:flex;align-items:center;gap:18px;min-width:0}
.mtk-hqos .hqos-identity>div{position:relative;min-width:0}.mtk-hqos .hqos-identity .hqos-hint{position:static;width:100%}
.mtk-hqos .hqos-icon{display:grid;place-items:center;width:74px;height:74px;flex-shrink:0;border-radius:20px;background:linear-gradient(140deg,var(--hqos-accent),color-mix(in srgb,var(--hqos-accent) 72%,white));color:white}
.mtk-hqos .hqos-icon svg{width:48px;height:48px}
.mtk-hqos .hqos-title{margin:0 0 10px;padding:0;border:0;background:none;box-shadow:none;font-size:22px;font-weight:700;color:inherit}
.mtk-hqos .hqos-status{display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;font-size:13px;background:rgba(128,128,128,.12);color:inherit}
.mtk-hqos .hqos-status::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}
.mtk-hqos .hqos-good{color:#159b70}.mtk-hqos .hqos-status.hqos-good{background:rgba(21,155,112,.12)}
.mtk-hqos .hqos-bad{color:var(--red,#f5365c)}.mtk-hqos .hqos-status.hqos-bad{background:rgba(245,54,92,.10)}
.mtk-hqos .hqos-metrics{display:grid;gap:10px;min-width:0}
.mtk-hqos .hqos-metric{border:1px solid var(--hqos-line);border-radius:14px;padding:10px 16px;background:var(--hqos-input)}
.mtk-hqos .hqos-metric>span{display:block;font-size:12px;opacity:.75;margin-bottom:4px}
.mtk-hqos .hqos-metric>strong{font-size:22px;line-height:1.2;color:var(--hqos-accent);font-variant-numeric:tabular-nums}
.mtk-hqos .hqos-metric>strong.hqos-good{color:#159b70}
.mtk-hqos .cbi-map{margin:0;padding:0;border:0;background:transparent!important;box-shadow:none;display:grid;gap:18px;overflow:visible}
.mtk-hqos .cbi-map>h2,.mtk-hqos .cbi-map-descr{display:none}
.mtk-hqos .cbi-section>h3{margin:0 0 18px;padding:0;background:none;border:0;box-shadow:none;color:inherit;font-size:19px;overflow:visible}
.mtk-hqos .cbi-section-node{padding:0;background:none;border:0;box-shadow:none}
.mtk-hqos .cbi-section-node>.cbi-value{display:flex;align-items:center;gap:18px;margin:0;padding:12px 0;background:none;border:0}
.mtk-hqos .cbi-value-title{float:none;flex:0 0 160px;width:160px;padding:0;text-align:left;color:inherit;overflow:visible}
.mtk-hqos .cbi-value-field{margin:0;min-width:0;padding:0;flex:1;line-height:1.5}
#cbi-mtk-hqos input[type=text],#cbi-mtk-hqos input[type=number]{width:100%;max-width:420px;min-height:40px;border-radius:10px;background:var(--hqos-input)!important;color:var(--hqos-accent)!important;box-shadow:none}
#cbi-mtk-hqos input,#cbi-mtk-hqos select,#cbi-mtk-hqos .cbi-dropdown{border-color:var(--hqos-accent)!important;accent-color:var(--hqos-accent)}
#cbi-mtk-hqos input:focus-visible,#cbi-mtk-hqos select:focus-visible,.mtk-hqos .hqos-hint:focus-visible{outline:2px solid var(--hqos-accent);outline-offset:3px}
.mtk-hqos .table{width:100%;margin:0 0 12px;background:transparent}
.mtk-hqos .tr,.mtk-hqos .th,.mtk-hqos .td{background:transparent;color:inherit}
.mtk-hqos .cbi-section-table-titles{background:color-mix(in srgb,var(--hqos-accent) 6%,transparent)}
.mtk-hqos .hqos-error{padding:14px 18px;border:1px solid currentColor;border-radius:12px;color:var(--red,#f5365c);background:rgba(245,54,92,.06)}
.mtk-hqos .hqos-hint{position:relative;display:inline-flex;align-items:center;max-width:100%;cursor:help;outline-offset:3px}
.mtk-hqos .cbi-value-title .hqos-hint::after,.mtk-hqos h3 .hqos-hint::after{content:'ⓘ';font-size:12px;opacity:.6;margin-left:7px}
.mtk-hqos .hqos-tooltip{position:absolute;left:0;bottom:calc(100% + 10px);z-index:1100;display:block;width:max-content;max-width:min(360px,calc(100vw - 64px));padding:13px 15px;border:1px solid var(--hqos-line);border-radius:14px;background:transparent;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 14px 30px rgba(15,23,42,.18);color:var(--hqos-help-color);font-size:.82rem;font-weight:600;line-height:1.55;white-space:normal;text-align:left;opacity:0;visibility:hidden}
.mtk-hqos.hqos-dark .hqos-tooltip{box-shadow:0 14px 30px rgba(0,0,0,.42)}
.mtk-hqos .hqos-identity .hqos-tooltip{left:calc(100% + 12px);top:50%;bottom:auto;transform:translateY(-50%)}
.mtk-hqos .hqos-tooltip::after{content:'';position:absolute;left:0;right:0;bottom:-12px;height:12px}
.mtk-hqos .hqos-identity .hqos-tooltip::after{left:-12px;right:auto;top:0;bottom:0;width:12px;height:auto}
.mtk-hqos .hqos-hint:hover>.hqos-tooltip,.mtk-hqos .hqos-hint:focus-within>.hqos-tooltip{opacity:1;visibility:visible}
.mtk-hqos [hidden]{display:none!important}
@media(max-width:1100px){.mtk-hqos .hqos-identity{align-items:flex-start}.mtk-hqos .hqos-identity>div{flex:1}.mtk-hqos .hqos-identity .hqos-hint{display:flex;flex-direction:column;align-items:flex-start}.mtk-hqos .hqos-identity .hqos-tooltip{position:relative;left:calc(-1 * var(--hqos-icon-space));top:auto;bottom:auto;transform:none;display:none;width:calc(100% + var(--hqos-icon-space));max-width:360px;margin-top:12px}.mtk-hqos .hqos-identity .hqos-hint:hover>.hqos-tooltip,.mtk-hqos .hqos-identity .hqos-hint:focus-within>.hqos-tooltip{display:block}.mtk-hqos .hqos-identity .hqos-tooltip::after{display:none}}
@media(max-width:700px){.mtk-hqos .hqos-identity{--hqos-icon-space:78px}.mtk-hqos .hqos-header{grid-template-columns:1fr;gap:18px}.mtk-hqos .hqos-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.mtk-hqos .hqos-header,.mtk-hqos .cbi-section{padding:16px;border-radius:16px}.mtk-hqos .hqos-icon{width:60px;height:60px;border-radius:16px}.mtk-hqos .hqos-title{font-size:20px}.mtk-hqos .cbi-value-title{flex-basis:124px;width:124px}.mtk-hqos .cbi-section-node>.cbi-value{gap:10px}}
@media(max-width:430px){.mtk-hqos .cbi-section-node>.cbi-value{align-items:flex-start;flex-direction:column}.mtk-hqos .cbi-value-title{width:auto;flex-basis:auto}.mtk-hqos .cbi-value-field{width:100%}.mtk-hqos .hqos-metric{padding:10px}.mtk-hqos .hqos-metric>strong{font-size:19px}}
.mtk-hqos .hqos-queue-scroll{max-width:100%;overflow-x:auto;border:1px solid var(--hqos-line);border-radius:12px}
#view>.mtk-hqos{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;width:100%;min-width:0}
.mtk-hqos>.cbi-map{grid-template-columns:minmax(0,1fr)}
.mtk-hqos .cbi-section,.mtk-hqos .hqos-header,.mtk-hqos .hqos-queue-scroll{min-width:0;max-width:100%;box-sizing:border-box}
.mtk-hqos .hqos-queues{min-width:620px;margin:0}
.mtk-hqos .hqos-queues.table{display:table;table-layout:fixed;width:100%}
.mtk-hqos .hqos-queues .tr,.mtk-hqos .hqos-queues .table-titles{display:table-row}
.mtk-hqos .hqos-queues .td,.mtk-hqos .hqos-queues .th{display:table-cell;white-space:nowrap}
.mtk-hqos .hqos-queues .td,.mtk-hqos .hqos-queues .th{padding:12px 14px;font-variant-numeric:tabular-nums}
.mtk-hqos .hqos-actions{display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:16px}
.mtk-hqos .hqos-actions p{flex:1;margin:0;font-size:.85rem;opacity:.7}
.mtk-hqos.hqos-dark,body:has(.mtk-hqos.hqos-dark) #cbi-mtk-hqos{--hqos-accent:var(--dark-link-color,#b0c1ff)}
.mtk-hqos.hqos-dark .hqos-icon{background:linear-gradient(140deg,var(--dark-primary,#5a6cc5),#6f83d4)}
@media(max-width:700px){.mtk-hqos .hqos-actions{align-items:flex-start;flex-direction:column}.mtk-hqos .hqos-actions button{align-self:flex-end}}
#cbi-mtk-hqos{font-family:inherit;font-size:14px;line-height:1.5;text-transform:none}
#cbi-mtk-hqos-global{display:block}
#cbi-mtk-hqos .cbi-section-node>.cbi-value{padding:10px 0;align-items:flex-start}
#cbi-mtk-hqos .cbi-section-node>.cbi-value>.cbi-value-title{padding-top:10px;line-height:20px}
#cbi-mtk-hqos .cbi-value-field>div[id]{width:100%;max-width:420px}
#cbi-mtk-hqos input[type=text],#cbi-mtk-hqos input[type=number],#cbi-mtk-hqos select,#cbi-mtk-hqos .cbi-dropdown,#cbi-mtk-hqos .cbi-dynlist{font:inherit;line-height:20px;box-sizing:border-box;width:100%!important;max-width:420px!important;min-width:0!important}
#cbi-mtk-hqos input[type=text],#cbi-mtk-hqos input[type=number],#cbi-mtk-hqos select,#cbi-mtk-hqos .cbi-dropdown{height:40px;min-height:40px;border-radius:10px;padding-top:9px;padding-bottom:9px}
#cbi-mtk-hqos .cbi-dynlist>.item{width:100%;max-width:100%;min-height:40px;box-sizing:border-box}
#cbi-mtk-hqos .cbi-dynlist>.item>span{flex:1 1 auto;width:auto;min-width:0;line-height:20px;font:inherit}
#cbi-mtk-hqos .cbi-dynlist>.add-item{width:100%}
#cbi-mtk-hqos .cbi-dynlist>.add-item>.cbi-dropdown{width:100%!important}
#cbi-mtk-hqos .cbi-dropdown>ul{min-width:0}
#cbi-mtk-hqos .cbi-value-description{margin-top:7px;font-size:12px;line-height:1.6;max-width:420px}
.mtk-hqos .cbi-button,#cbi-mtk-hqos .cbi-button{font-family:inherit;font-size:14px;line-height:20px;text-transform:none;border-radius:8px}
.mtk-hqos .th{font-size:13px;font-weight:600;line-height:1.5;text-transform:none}
.mtk-hqos .td{font-size:14px;line-height:1.5}
@media(max-width:700px){
 #cbi-mtk-hqos-rule tbody{display:block}
 #cbi-mtk-hqos-rule tbody>.tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;padding:14px;border:1px solid var(--hqos-line);border-radius:12px;margin-bottom:12px;background:var(--hqos-input)!important}
 #cbi-mtk-hqos-rule tbody>.tr>.td{width:auto!important;min-width:0!important;padding:0;text-align:left;overflow-wrap:anywhere}
 #cbi-mtk-hqos-rule tbody>.tr>.td:before{display:block;width:auto;margin:0 0 4px;font-size:12px;font-weight:400;opacity:.65}
 #cbi-mtk-hqos-rule .td[data-name="_path"]{grid-column:1/-1}
 #cbi-mtk-hqos-rule .cbi-section-actions{grid-column:1/-1;padding-top:4px!important}
 #cbi-mtk-hqos-rule .cbi-section-actions>div{display:flex;justify-content:flex-end;gap:8px}
}
@media(max-width:430px){#cbi-mtk-hqos .cbi-section-node>.cbi-value>.cbi-value-title{padding-top:0}#cbi-mtk-hqos .cbi-section-node>.cbi-value{gap:8px}}

`;

var callStatus = rpc.declare({ object: 'luci.hqos', method: 'getStatus', expect: { '': {} } });
var callApply = rpc.declare({ object: 'luci.hqos', method: 'apply', expect: { '': {} } });
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
		var reapply = E('button', { 'class': 'cbi-button cbi-button-action', 'type': 'button', 'disabled': !L.hasViewPermission() || null, 'click': ui.createHandlerFn(this, function() {
			return callApply().then(function(result) {
				return callStatus().then(function(updated) {
					update(updated);
					if (!result.success) ui.addNotification(null, E('p', {}, updated.error || _('应用失败，请检查配置。')), 'error');
				});
			});
		}) }, _('重新应用'));
		var header = E('div', { 'class': 'hqos-header' }, [
			E('div', { 'class': 'hqos-identity' }, [ speedIcon(), E('div', {}, [
				E('h2', { 'class': 'hqos-title' }, 'HQoS'), service,
				E('p', { 'style': 'margin:12px 0 0;opacity:.75' }, _('设备与端口限速'))
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
			o = s.option(form.Value, key, (key === 'download' ? _('硬件转发总下载') : _('硬件转发总上传')) + ' (Mbit/s)');
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
			if (!updated || updated.schema !== 1) updated = { schema: 0, error: _('无法获取 HQoS 状态') };
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
					E('div', { 'class': 'hqos-actions' }, [ E('p', {}, _('计数来自驱动；缺失时显示不可用。')), reapply ]) ]) ]);
			update(state);
			return page;
		});
	}
});

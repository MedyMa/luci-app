/* Copyright (C) 2022 ImmortalWrt.org */

'use strict';
'require dom';
'require form';
'require poll';
'require rpc';
'require uci';
'require view';

var getSystemFeatures = rpc.declare({
	object: 'luci.turboacc',
	method: 'getSystemFeatures',
	expect: { '': {} }
});

var getFastPathStat = rpc.declare({
	object: 'luci.turboacc',
	method: 'getFastPathStat',
	expect: { '': {} }
});

var getFullConeStat = rpc.declare({
	object: 'luci.turboacc',
	method: 'getFullConeStat',
	expect: { '': {} }
});

var getTCPCCAStat = rpc.declare({
	object: 'luci.turboacc',
	method: 'getTCPCCAStat',
	expect: { '': {} }
});

var getMTKPPEStat = rpc.declare({
	object: 'luci.turboacc',
	method: 'getMTKPPEStat',
	expect: { '': {} }
});

function getServiceStatus() {
	return Promise.all([
		L.resolveDefault(getFastPathStat(), {}),
		L.resolveDefault(getFullConeStat(), {}),
		L.resolveDefault(getTCPCCAStat(), {})
	]);
}

function getMTKPPEStatus() {
	return L.resolveDefault(getMTKPPEStat(), {});
}

function trimValue(value) {
	return value == null ? '' : String(value).replace(/^\s+|\s+$/g, '');
}

function parseInteger(value) {
	var parsed = parseInt(value, 10);

	return isNaN(parsed) ? null : parsed;
}

function boolValue(value) {
	return value === true || value === '1' || value === 1;
}

function displayValue(value) {
	return (value != null && value !== '') ? value : '--';
}

function compactChildren(children) {
	return (children || []).filter(function(child) {
		return child != null;
	});
}

function parseTokenList(value) {
	var tokens = trimValue(value).split(/\s+/).filter(function(token) {
		return token !== '';
	});

	tokens.sort();
	return tokens;
}

function normalizeFastpathValue(value) {
	value = trimValue(value);

	return (!value || value === 'none') ? 'disabled' : value;
}

function getDefaultFullcone(features) {
	return features && features.hasXTFULLCONENAT ? '1' : '2';
}

function getConfigState(features) {
	return {
		fastpath: normalizeFastpathValue(uci.get('turboacc', 'config', 'fastpath')),
		fastpath_fo_hw: boolValue(uci.get('turboacc', 'config', 'fastpath_fo_hw')),
		fastpath_fc_br: boolValue(uci.get('turboacc', 'config', 'fastpath_fc_br')),
		fastpath_fc_ipv6: boolValue(uci.get('turboacc', 'config', 'fastpath_fc_ipv6')),
		fastpath_mh_eth_hnat: boolValue(uci.get('turboacc', 'config', 'fastpath_mh_eth_hnat')),
		fastpath_mh_eth_hnat_v6: boolValue(uci.get('turboacc', 'config', 'fastpath_mh_eth_hnat_v6')),
		fastpath_mh_eth_hnat_ap: trimValue(uci.get('turboacc', 'config', 'fastpath_mh_eth_hnat_ap')),
		fastpath_mh_eth_hnat_bind_rate: trimValue(uci.get('turboacc', 'config', 'fastpath_mh_eth_hnat_bind_rate')) || '30',
		fullcone: trimValue(uci.get('turboacc', 'config', 'fullcone')) || getDefaultFullcone(features),
		tcpcca: trimValue(uci.get('turboacc', 'config', 'tcpcca')) || 'cubic'
	};
}

function getAvailableEngines(features) {
	var engines = [];

	if (features.hasFLOWOFFLOADING)
		engines.push({ key: 'flow_offloading', label: _('流量分载') });
	if (features.hasFASTCLASSIFIER)
		engines.push({ key: 'fast_classifier', label: _('快速分类器') });
	if (features.hasSHORTCUTFECM)
		engines.push({ key: 'shortcut_fe_cm', label: _('SFE 连接管理器') });
	if (features.hasMEDIATEKHNAT)
		engines.push({ key: 'mediatek_hnat', label: _('MediaTek HNAT') });

	return engines;
}

function getEngineLabel(value) {
	switch (normalizeFastpathValue(value)) {
	case 'flow_offloading':
		return _('流量分载');
	case 'fast_classifier':
		return _('快速分类器');
	case 'shortcut_fe_cm':
		return _('SFE 连接管理器');
	case 'mediatek_hnat':
		return _('MediaTek HNAT');
	default:
		return _('已禁用');
	}
}

function getEngineShortLabel(value) {
	switch (normalizeFastpathValue(value)) {
	case 'flow_offloading':
		return 'FLOW';
	case 'fast_classifier':
		return 'FAST';
	case 'shortcut_fe_cm':
		return 'SFE';
	case 'mediatek_hnat':
		return 'HNAT';
	default:
		return 'OFF';
	}
}

function getEngineDescription(value) {
	switch (normalizeFastpathValue(value)) {
	case 'flow_offloading':
		return _('基于软件的路由/NAT 流量分载。');
	case 'fast_classifier':
		return _('用于 Shortcut Forwarding Engine 的快速分类器连接管理器。');
	case 'shortcut_fe_cm':
		return _('Shortcut Forwarding Engine 的简易连接管理器。');
	case 'mediatek_hnat':
		return _('MediaTek 的开源硬件流量分载引擎。');
	default:
		return _('用于路由/NAT 的流量分载引擎。');
	}
}

function getRuntimeLabel(token) {
	token = trimValue(token);

	switch (token) {
	case 'Flow offloading':
		return _('流量分载');
	case 'Fast classifier':
		return _('快速分类器');
	case 'Shortcut-FE CM':
		return _('SFE 连接管理器');
	case 'MediaTek HNAT':
		return _('MediaTek HNAT');
	case 'xt_FULLCONENAT':
		return _('XT_FULLCONE_NAT');
	case 'Boardcom Fullcone':
		return _('Boardcom_FULLCONE_NAT');
	case 'Ethernet HNAT Disabled':
		return _('以太网 HNAT 未启用');
	case 'Wireless HNAT Disabled':
		return _('无线 HNAT 未启用');
	default:
		return token;
	}
}

function buildStatusMeta(value, emptyDetail) {
	var parts = trimValue(value).split(' / ').map(function(part) {
		return getRuntimeLabel(part);
	}).filter(function(part) {
		return part !== '';
	});

	return {
		primary: parts.length ? parts[0] : _('已禁用'),
		warnings: parts.length > 1 ? parts.slice(1) : [],
		detail: parts.length > 1 ? parts.slice(1).join(' · ') : (emptyDetail || _('未检测到活动加速通路。'))
	};
}

function getFullconeConfigLabel(value) {
	switch (trimValue(value)) {
	case '1':
		return _('XT_FULLCONE_NAT');
	case '2':
		return _('Boardcom_FULLCONE_NAT');
	default:
		return _('已禁用');
	}
}

function getIPv6ModeText(config, features) {
	var fastpath = normalizeFastpathValue(config.fastpath);

	if (!features.hasIPV6)
		return _('不可用');

	switch (fastpath) {
	case 'fast_classifier':
		return config.fastpath_fc_ipv6 ? _('已启用') : _('已禁用');
	case 'mediatek_hnat':
		return (config.fastpath_mh_eth_hnat && config.fastpath_mh_eth_hnat_v6) ? _('已启用') : _('已禁用');
	case 'disabled':
		return _('已禁用');
	default:
		return _('不可用');
	}
}

function getIPv6ModeDetail(config, features) {
	var fastpath = normalizeFastpathValue(config.fastpath);

	if (!features.hasIPV6)
		return _('不可用');

	switch (fastpath) {
	case 'fast_classifier':
		return _('启用 IPv6 加速。');
	case 'mediatek_hnat':
		return _('为有线 IPv6 连接启用硬件加速。');
	case 'disabled':
		return _('未检测到活动加速通路。');
	default:
		return _('当前平台支持 IPv6，但所选引擎没有独立的 IPv6 开关。');
	}
}

function getPPESummary(ppeStats) {
	var count = parseInteger(ppeStats.PPE_NUM);
	var index;
	var cards = [];
	var totalBound = 0;
	var totalAll = 0;
	var bound;
	var all;

	if (count == null)
		return {
			count: null,
			cards: [],
			totalBound: null,
			totalAll: null
		};

	for (index = 0; index < count; index++) {
		bound = parseInteger(ppeStats['BIND_PPE' + index]) || 0;
		all = parseInteger(ppeStats['ALL_PPE' + index]) || 0;
		totalBound += bound;
		totalAll += all;
		cards.push({
			index: index,
			bound: bound,
			all: all,
			percent: all > 0 ? Math.round((bound / all) * 100) : 0
		});
	}

	return {
		count: count,
		cards: cards,
		totalBound: totalBound,
		totalAll: totalAll
	};
}

function formatSessions(bound, all) {
	if (bound == null || all == null)
		return '--';

	return String(bound) + ' / ' + String(all);
}

function isDarkTheme() {
	if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body)
		return false;

	var html = document.documentElement;
	var htmlClass = html ? (html.className || '') : '';
	var bodyClass = document.body.className || '';
	var htmlTheme = html ? (html.getAttribute('data-theme') || '') : '';
	var bodyTheme = document.body.getAttribute('data-theme') || '';
	var background = window.getComputedStyle(document.body).backgroundColor || '';
	var channels = background.match(/\d+(?:\.\d+)?/g);
	var luminance;

	if (/\b(?:dark|mode-dark|argon-dark)\b/i.test(htmlClass) || /\b(?:dark|mode-dark|argon-dark)\b/i.test(bodyClass))
		return true;

	if (/dark/i.test(htmlTheme) || /dark/i.test(bodyTheme))
		return true;

	if (/light/i.test(htmlTheme) || /light/i.test(bodyTheme))
		return false;

	if (!channels || channels.length < 3)
		return false;

	luminance = (Number(channels[0]) * 299 + Number(channels[1]) * 587 + Number(channels[2]) * 114) / 1000;
	return luminance < 140;
}

function applyThemeClass(node, darkClass) {
	function syncThemeClass() {
		node.classList.toggle(darkClass, isDarkTheme());
	}

	var retries = [ 0, 80, 220, 480, 900 ];
	var index;
	var themeObserver;
	var mediaQuery;

	syncThemeClass();

	if (typeof window !== 'undefined') {
		for (index = 0; index < retries.length; index++)
			window.setTimeout(syncThemeClass, retries[index]);

		if (window.requestAnimationFrame)
			window.requestAnimationFrame(syncThemeClass);

		if (typeof MutationObserver !== 'undefined' && document.documentElement) {
			themeObserver = new MutationObserver(syncThemeClass);
			themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: [ 'class', 'style', 'data-theme' ] });

			if (document.body && document.body !== document.documentElement)
				themeObserver.observe(document.body, { attributes: true, attributeFilter: [ 'class', 'style', 'data-theme' ] });
		}

		if (window.matchMedia) {
			mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

			if (mediaQuery) {
				if (mediaQuery.addEventListener)
					mediaQuery.addEventListener('change', syncThemeClass);
				else if (mediaQuery.addListener)
					mediaQuery.addListener(syncThemeClass);
			}
		}

		window.addEventListener('pageshow', syncThemeClass);
		window.addEventListener('focus', syncThemeClass);
	}

	return node;
}

function renderChip(text, extraClass) {
	if (text == null || text === '')
		return null;

	return E('span', { 'class': 'ta-status-chip ' + (extraClass || '') }, String(text));
}

function renderHeroGlyph(label) {
	return E('div', { 'class': 'ta-device-glyph' }, [
		E('div', { 'class': 'ta-network-icon' }, [
			E('span', { 'class': 'ta-network-line is-top' }),
			E('span', { 'class': 'ta-network-line is-left' }),
			E('span', { 'class': 'ta-network-line is-right' }),
			E('span', { 'class': 'ta-network-node is-core' }),
			E('span', { 'class': 'ta-network-node is-top' }),
			E('span', { 'class': 'ta-network-node is-left' }),
			E('span', { 'class': 'ta-network-node is-right' })
		]),
		E('span', { 'class': 'ta-device-chip' }, label)
	]);
}

function renderDetailRows(items) {
	items = (items || []).filter(function(item) {
		return item[1] != null && item[1] !== '';
	});

	if (!items.length)
		return null;

	return E('div', { 'class': 'ta-detail-rows' }, items.map(function(item) {
		return E('div', { 'class': 'ta-detail-row' }, [
			E('span', { 'class': 'ta-detail-label' }, item[0]),
			E('strong', { 'class': 'ta-detail-value' }, displayValue(item[1]))
		]);
	}));
}

function renderMetricBadge(label, extraClass) {
	return E('span', { 'class': 'ta-overview-card-badge ' + (extraClass || '') }, label);
}

function renderMetricCard(title, value, detail, extraClass, badge) {
	return E('div', { 'class': 'ta-overview-card ' + (extraClass || '') }, compactChildren([
		E('div', { 'class': 'ta-overview-card-head' }, compactChildren([
			E('div', { 'class': 'ta-overview-card-title' }, title),
			badge || null
		])),
		E('div', { 'class': 'ta-overview-card-main' }, compactChildren([
			E('div', { 'class': 'ta-overview-card-value' }, [
				E('span', { 'class': 'ta-value-highlight' }, displayValue(value))
			]),
			detail ? E('div', { 'class': 'ta-overview-card-detail' }, detail) : null
		]))
	]));
}

function renderPPEProgress(ppe) {
	if (!ppe || !ppe.cards || !ppe.cards.length)
		return null;

	return E('div', { 'class': 'ta-section-card ta-progress-card is-progress-panel' }, [
		E('div', { 'class': 'ta-section-title' }, _('PPE 已绑定连接数')),
		E('div', { 'class': 'ta-progress-list' }, ppe.cards.map(function(card) {
			var width = card.percent > 0 ? Math.max(card.percent, 1) : 0;

			return E('div', { 'class': 'ta-progress-row' }, [
				E('div', { 'class': 'ta-progress-head' }, [
					E('div', { 'class': 'ta-progress-label' }, 'PPE' + card.index + ' ' + _('已绑定连接数')),
					E('div', { 'class': 'ta-progress-value' }, formatSessions(card.bound, card.all) + ' (' + card.percent + '%)')
				]),
				E('div', { 'class': 'ta-progress-track' }, [
					E('div', { 'class': 'ta-progress-fill', 'style': 'width:' + String(width) + '%' })
				])
			]);
		}))
	]);
}

function renderSpotlightCard(title, value, subtitle, extraClass, tags, details) {
	tags = (tags || []).filter(function(tag) {
		return tag != null && tag !== '';
	});

	return E('div', { 'class': 'ta-spotlight-card ' + (extraClass || '') }, compactChildren([
		E('div', { 'class': 'ta-spotlight-head' }, [
			E('div', { 'class': 'ta-spotlight-title' }, title)
		]),
		E('div', { 'class': 'ta-spotlight-body' }, compactChildren([
			E('div', { 'class': 'ta-spotlight-value' }, displayValue(value)),
			subtitle ? E('div', { 'class': 'ta-spotlight-subtitle' }, subtitle) : null,
			tags.length ? E('div', { 'class': 'ta-chip-list' }, tags.map(function(tag) {
				return renderChip(tag, 'is-warning');
			})) : null
		])),
		renderDetailRows(details)
	]));
}

function renderInfoTable(rows) {
	rows = rows.filter(function(row) {
		return row[1] != null;
	});

	if (!rows.length)
		return null;

	return E('div', { 'class': 'ta-info-grid' }, rows.map(function(row) {
		return E('div', { 'class': 'ta-info-row' }, [
			E('div', { 'class': 'ta-info-label' }, row[0]),
			E('div', { 'class': 'ta-info-value' }, row[1])
		]);
	}));
}

function renderFeatureStatus(flag) {
	return renderChip(flag ? _('Available') : _('Unavailable'), flag ? 'is-ok' : 'is-muted');
}

function renderNoteList(notes) {
	return E('ul', { 'class': 'ta-note-list' }, notes.map(function(note) {
		return E('li', {}, note);
	}));
}

function renderHero(config, fastpathMeta, fullconeMeta, tcpccaLabel, availableEngines) {
	var heroPills = [
		fastpathMeta.primary,
		fullconeMeta.primary,
		_('TCP CCA') + ': ' + tcpccaLabel
	];

	return E('div', { 'class': 'ta-hero-card' }, [
		E('div', { 'class': 'ta-hero-badge-shell' }, [
			renderHeroGlyph(getEngineShortLabel(config.fastpath)),
			E('div', { 'class': 'ta-hero-badge-label' }, _('路由/NAT 引擎'))
		]),
		E('div', { 'class': 'ta-hero-copy' }, [
			E('div', { 'class': 'ta-hero-kicker' }, _('TurboACC 设置')),
			E('div', { 'class': 'ta-hero-title' }, _('TurboACC')),
			E('div', { 'class': 'ta-hero-subtitle' }, compactChildren(heroPills.map(function(item) {
				return item ? E('span', { 'class': 'ta-pill' }, item) : null;
			})))
		])
	]);
}

function renderOverviewContent(state) {
	var features = state.features || {};
	var config = state.config || {};
	var service = state.service || [];
	var ppeStats = state.ppe || {};
	var hnatProfile = normalizeFastpathValue(config.fastpath) === 'mediatek_hnat';
	var availableEngines = getAvailableEngines(features);
	var availableLabels = availableEngines.map(function(item) {
		return item.label;
	}).join(' · ');
	var fastpathMeta = buildStatusMeta(service[0] && service[0].type, _('未检测到活动加速通路。'));
	var fullconeMeta = buildStatusMeta(service[1] && service[1].type, _('已禁用'));
	var fullconeLabel = getFullconeConfigLabel(config.fullcone);
	var tcpccaLabel = trimValue(service[2] && service[2].type) || (config.tcpcca ? String(config.tcpcca).toUpperCase() : _('已禁用'));
	var ppe = getPPESummary(ppeStats);
	var runtimeWarnings = fastpathMeta.warnings.length ? E('div', { 'class': 'ta-inline-chips' }, fastpathMeta.warnings.map(function(tag) {
		return renderChip(tag, 'is-warning');
	})) : null;
	var sessionsValue = hnatProfile ? formatSessions(ppe.totalBound, ppe.totalAll) : String(availableEngines.length);
	var sessionsDetail = hnatProfile
		? (_('PPE 通道数') + ': ' + displayValue(ppe.count) + ' · ' + _('HNAT连接速率绑定阈值(pps)') + ': ' + config.fastpath_mh_eth_hnat_bind_rate + ' pps')
		: (availableLabels || _('不可用'));

	return E('div', { 'class': 'ta-overview-stack' }, compactChildren([
		renderHero(config, fastpathMeta, fullconeMeta, tcpccaLabel, availableEngines),
		E('div', { 'class': 'ta-overview-grid compact' }, compactChildren([
			renderMetricCard(_('实时通路'), fastpathMeta.primary, getEngineDescription(config.fastpath), 'is-runtime', renderMetricBadge(_('实时'))),
			renderMetricCard(_('全锥形 NAT'), fullconeLabel, fullconeMeta.primary + ' · ' + _('TCP 拥塞控制算法') + ': ' + tcpccaLabel, 'is-policy', renderMetricBadge('NAT')),
			renderMetricCard(_('IPv6 加速'), getIPv6ModeText(config, features), getIPv6ModeDetail(config, features), 'is-ipv6', renderMetricBadge('IPv6')),
			renderMetricCard(hnatProfile ? _('已绑定会话') : _('可用引擎'), sessionsValue, sessionsDetail, hnatProfile ? 'is-sessions' : 'is-capability', renderMetricBadge(hnatProfile ? 'PPE' : _('引擎')))
		])),
		hnatProfile ? renderPPEProgress(ppe) : null,
		E('div', { 'class': 'ta-detail-layout' }, compactChildren([
				E('div', { 'class': 'ta-section-card is-runtime-panel' }, [
				E('div', { 'class': 'ta-section-title' }, _('运行状态')),
				renderInfoTable([
					[ _('运行告警'), runtimeWarnings ],
					[ _('全锥形 NAT'), fullconeMeta.primary ],
					[ _('TCP 拥塞控制算法'), tcpccaLabel ],
					[ _('PPE 通道数'), hnatProfile ? displayValue(ppe.count) : null ],
					[ _('已绑定会话'), hnatProfile ? formatSessions(ppe.totalBound, ppe.totalAll) : null ],
					[ _('总会话容量'), hnatProfile && ppe.totalAll != null ? String(ppe.totalAll) : null ],
					[ _('IPv6 加速'), getIPv6ModeText(config, features) ],
					[ _('HNAT连接速率绑定阈值(pps)'), hnatProfile ? (config.fastpath_mh_eth_hnat_bind_rate + ' pps') : null ],
					[ _('AP 模式目标 IP'), hnatProfile && config.fastpath_mh_eth_hnat_ap ? config.fastpath_mh_eth_hnat_ap : null ]
				])
			]),
				E('div', { 'class': 'ta-section-card is-capability-panel' }, [
				E('div', { 'class': 'ta-section-title' }, _('能力矩阵')),
				renderInfoTable([
					[ _('流量分载'), renderFeatureStatus(features.hasFLOWOFFLOADING) ],
						[ _('快速分类器'), renderFeatureStatus(features.hasFASTCLASSIFIER) ],
					[ _('SFE 连接管理器'), renderFeatureStatus(features.hasSHORTCUTFECM) ],
					[ _('MediaTek HNAT'), renderFeatureStatus(features.hasMEDIATEKHNAT) ],
					[ _('XT_FULLCONE_NAT'), renderFeatureStatus(features.hasXTFULLCONENAT) ],
					[ _('内核 IPv6 协议栈'), renderFeatureStatus(features.hasIPV6) ]
				])
			])
		]))
	]));
}

function buildForm(features, config) {
	var m = new form.Map('turboacc', _('网络加速设置'),
		_('在当前页面完成有线加速、NAT 行为和拥塞控制的调整。'));
	var s = m.section(form.NamedSection, 'config', 'turboacc');
	var o;
	var tcpccaOptions = parseTokenList(features.hasTCPCCA);

	s.tab('engine', _('加速方案'), _('选择用于路由和 NAT 的主加速引擎。'));
	s.tab('nat', _('NAT 与拥塞控制'), _('全锥形 NAT（NAT1）可以有效提升游戏体验。'));

	if (features.hasMEDIATEKHNAT)
		s.tab('hnat', _('HNAT 调优'), _('针对 MediaTek 平台调整有线 HNAT 行为。'));

	o = s.taboption('engine', form.ListValue, 'fastpath', _('路由/NAT 引擎'),
		_('选择主数据通路，上方运行状态区域会显示内核当前实际使用的引擎。'));
	o.value('disabled', _('禁用'));
	if (features.hasFLOWOFFLOADING)
		o.value('flow_offloading', _('流量分载'));
	if (features.hasFASTCLASSIFIER)
		o.value('fast_classifier', _('快速分类器'));
	if (features.hasSHORTCUTFECM)
		o.value('shortcut_fe_cm', _('SFE 连接管理器'));
	if (features.hasMEDIATEKHNAT)
		o.value('mediatek_hnat', _('MediaTek HNAT'));
	o.default = config.fastpath || 'disabled';
	o.rmempty = false;
	o.cfgvalue = function(section_id) {
		return normalizeFastpathValue(uci.get('turboacc', section_id, 'fastpath'));
	};
	o.write = function(section_id, value) {
		return uci.set('turboacc', section_id, 'fastpath', value === 'disabled' ? 'none' : value);
	};

	if (features.hasFLOWOFFLOADING) {
		o = s.taboption('engine', form.Flag, 'fastpath_fo_hw', _('硬件流量分载'),
			_('需要硬件 NAT 支持，目前至少 mt7621 已实现。'));
		o.default = o.disabled;
		o.rmempty = false;
		o.depends('fastpath', 'flow_offloading');
	}

	if (features.hasFASTCLASSIFIER) {
		o = s.taboption('engine', form.Flag, 'fastpath_fc_br', _('桥接加速'),
			_('启用桥接加速（可能与桥接模式 VPN 服务冲突）。'));
		o.default = o.disabled;
		o.rmempty = false;
		o.depends('fastpath', 'fast_classifier');

		if (features.hasIPV6) {
			o = s.taboption('engine', form.Flag, 'fastpath_fc_ipv6', _('IPv6 加速'),
				_('启用 IPv6 加速。'));
			o.default = o.disabled;
			o.rmempty = false;
			o.depends('fastpath', 'fast_classifier');
		}
	}

	if (features.hasMEDIATEKHNAT) {
		o = s.taboption('hnat', form.Flag, 'fastpath_mh_eth_hnat', _('启用有线 HNAT'),
			_('OpenWrt 24.10 下 mt798x 首选的 HNAT 通路。'));
		o.default = o.enabled;
		o.rmempty = false;
		o.depends('fastpath', 'mediatek_hnat');

		o = s.taboption('hnat', form.Flag, 'fastpath_mh_eth_hnat_v6', _('启用有线 IPv6 HNAT'),
			_('当前驱动支持时，让有线 IPv6 会话也走 HNAT 通路。'));
		o.default = o.enabled;
		o.rmempty = false;
		o.depends({ fastpath: 'mediatek_hnat', fastpath_mh_eth_hnat: '1' });

		o = s.taboption('hnat', form.Value, 'fastpath_mh_eth_hnat_ap', _('AP 模式地址'),
			_('填写一个 LAN IPv4 地址，重启后切换为 AP 模式。'));
		o.optional = true;
		o.datatype = 'ip4addr';
		o.depends({ fastpath: 'mediatek_hnat', fastpath_mh_eth_hnat: '1' });

		o = s.taboption('hnat', form.Value, 'fastpath_mh_eth_hnat_bind_rate', _('HNAT 绑定速率阈值（pps）'),
			_('阈值越小，连接越容易被加速。'));
		o.optional = true;
		o.datatype = 'range(1,30)';
		o.placeholder = '30';
		o.depends({ fastpath: 'mediatek_hnat', fastpath_mh_eth_hnat: '1' });
	}

	o = s.taboption('nat', form.ListValue, 'fullcone', _('全锥形 NAT'),
		_('全锥形 NAT（NAT1）可以有效提升游戏体验。'));
	o.value('0', _('禁用'));
	if (features.hasXTFULLCONENAT || config.fullcone === '1')
		o.value('1', _('XT_FULLCONE_NAT'));
	o.value('2', _('Boardcom_FULLCONE_NAT'));
	o.default = config.fullcone || getDefaultFullcone(features);
	o.rmempty = false;

	if (tcpccaOptions.indexOf(config.tcpcca) < 0)
		tcpccaOptions.push(config.tcpcca);

	o = s.taboption('nat', form.ListValue, 'tcpcca', _('TCP 拥塞控制算法'),
		_('TCP 拥塞控制算法。'));
	tcpccaOptions.forEach(function(item) {
		o.value(item, String(item).toUpperCase());
	});
	o.default = config.tcpcca || 'cubic';
	o.rmempty = false;

	return m;
}

function renderStyle() {
	return E('style', [
		'.ta-page{display:flex;flex-direction:column;gap:16px;padding-top:8px;--ta-card-border:rgba(76,108,157,.14);--ta-card-border-soft:rgba(76,108,157,.08);--ta-card-bg:linear-gradient(180deg,rgba(255,255,255,.98),rgba(243,248,253,.98));--ta-hero-bg:linear-gradient(135deg,rgba(255,255,255,.995),rgba(248,251,255,.995) 52%,rgba(243,248,253,.995));--ta-pill-bg:rgba(32,72,120,.06);--ta-badge-bg:rgba(32,72,120,.08);--ta-detail-bg:rgba(32,72,120,.04);--ta-glyph-bg:linear-gradient(160deg,#3347b8,#4f46e5);--ta-glyph-shadow:0 12px 24px rgba(79,70,229,.20);--ta-text:#102132;--ta-text-strong:#0f172a;--ta-text-muted:#64748b;--ta-chip-text:#1f3347;--ta-action-bar-bg:linear-gradient(180deg,rgba(255,255,255,.96),rgba(241,246,252,.96));--ta-button-neutral-bg:linear-gradient(180deg,#ffffff,#f3f6fa);--ta-button-secondary-bg:rgba(32,72,120,.06);--ta-button-primary-bg:linear-gradient(90deg,#1b7ea3,#2563eb);--ta-button-primary-shadow:0 10px 18px rgba(37,99,235,.16)}',
		'.ta-page.ta-dark,body.dark .ta-page,html.dark .ta-page,body.mode-dark .ta-page,body.argon-dark .ta-page,html[data-theme="dark"] .ta-page,body[data-theme="dark"] .ta-page{--ta-card-border:rgba(124,147,186,.22);--ta-card-border-soft:rgba(124,147,186,.16);--ta-card-bg:linear-gradient(180deg,rgba(18,28,44,.96),rgba(10,17,29,.98));--ta-hero-bg:linear-gradient(135deg,rgba(18,28,44,.985),rgba(13,22,36,.99) 52%,rgba(20,34,52,.99));--ta-pill-bg:rgba(125,174,255,.16);--ta-badge-bg:rgba(125,174,255,.14);--ta-detail-bg:rgba(255,255,255,.05);--ta-glyph-bg:linear-gradient(160deg,#2c3e9f,#4338ca);--ta-glyph-shadow:0 16px 28px rgba(49,46,129,.32);--ta-text:#dbe7f3;--ta-text-strong:#f8fbff;--ta-text-muted:#9fb2cb;--ta-chip-text:#edf6ff;--ta-action-bar-bg:linear-gradient(180deg,rgba(18,28,44,.92),rgba(10,17,29,.98));--ta-button-neutral-bg:linear-gradient(180deg,rgba(33,46,68,.98),rgba(20,30,47,.98));--ta-button-secondary-bg:rgba(125,174,255,.12);--ta-button-primary-bg:linear-gradient(90deg,#177ea5,#2563eb);--ta-button-primary-shadow:0 10px 20px rgba(0,0,0,.18)}',
		'.ta-overview-stack{display:flex;flex-direction:column;gap:16px}',
		'.ta-hero-card{position:relative;overflow:hidden;isolation:isolate;display:grid;grid-template-columns:minmax(72px,86px) 1fr;align-items:center;gap:16px;padding:15px 18px;border:1px solid var(--ta-card-border);border-radius:18px;background:var(--ta-hero-bg);box-shadow:0 8px 22px rgba(15,23,42,.045)}',
		'.ta-hero-card:after{display:none}',
		'.ta-hero-badge-shell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}',
		'.ta-device-glyph{position:relative;width:72px;height:72px;border-radius:20px;background:var(--ta-glyph-bg);display:flex;align-items:center;justify-content:center;box-shadow:var(--ta-glyph-shadow)}',
		'.ta-network-icon{position:relative;width:38px;height:38px;color:rgba(255,255,255,.92)}',
		'.ta-network-node{position:absolute;width:10px;height:10px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px rgba(255,255,255,.08)}',
		'.ta-network-node.is-core{left:16px;top:16px;width:12px;height:12px}',
		'.ta-network-node.is-top{left:17px;top:2px}',
		'.ta-network-node.is-left{left:2px;top:28px}',
		'.ta-network-node.is-right{right:2px;top:28px}',
		'.ta-network-line{position:absolute;background:rgba(255,255,255,.58);border-radius:999px;transform-origin:center}',
		'.ta-network-line.is-top{left:21px;top:10px;width:2px;height:12px}',
		'.ta-network-line.is-left{left:11px;top:25px;width:14px;height:2px;transform:rotate(-28deg)}',
		'.ta-network-line.is-right{right:11px;top:25px;width:14px;height:2px;transform:rotate(28deg)}',
		'.ta-device-chip{position:absolute;left:50%;bottom:7px;transform:translateX(-50%);display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:20px;padding:0 7px;border-radius:999px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.18);color:#fff;font-size:.68rem;font-weight:700;letter-spacing:.05em;text-shadow:0 1px 2px rgba(0,0,0,.28)}',
		'.ta-hero-badge-label{font-size:.74rem;font-weight:700;color:var(--ta-text-muted);line-height:1.2;text-align:center}',
		'.ta-hero-copy{display:flex;flex-direction:column;justify-content:center;gap:6px;min-width:0}',
		'.ta-hero-kicker{font-size:.74rem;letter-spacing:.07em;text-transform:uppercase;color:var(--ta-text-muted)}',
		'.ta-hero-title{font-size:1.34rem;font-weight:700;line-height:1.18;word-break:break-word;color:var(--ta-text-strong)}',
		'.ta-hero-summary{max-width:50rem;font-size:.88rem;line-height:1.48;color:var(--ta-text)}',
		'.ta-hero-subtitle{display:flex;flex-wrap:wrap;gap:6px}',
		'.ta-pill{display:inline-flex;align-items:center;padding:5px 10px;border-radius:11px;background:var(--ta-pill-bg);border:1px solid var(--ta-card-border-soft);font-size:.78rem;font-weight:700;color:var(--ta-chip-text);line-height:1.2}',
		'.ta-chip-list,.ta-inline-chips{display:flex;flex-wrap:wrap;gap:8px}',
		'.ta-status-chip{display:inline-flex;align-items:center;max-width:100%;padding:6px 10px;border-radius:999px;background:var(--ta-pill-bg);border:1px solid var(--ta-card-border-soft);color:var(--ta-chip-text);font-size:.82rem;font-weight:700;line-height:1.2;word-break:break-word}',
		'.ta-status-chip.is-ok{background:rgba(34,197,94,.12);color:#15803d}',
		'.ta-status-chip.is-muted{background:rgba(148,163,184,.14);color:var(--ta-text-muted)}',
		'.ta-status-chip.is-warning{background:rgba(249,115,22,.12);color:#c2410c}',
		'.ta-page.ta-dark .ta-status-chip.is-ok,body.dark .ta-page .ta-status-chip.is-ok,html.dark .ta-page .ta-status-chip.is-ok,body.mode-dark .ta-page .ta-status-chip.is-ok,body.argon-dark .ta-page .ta-status-chip.is-ok,html[data-theme="dark"] .ta-page .ta-status-chip.is-ok,body[data-theme="dark"] .ta-page .ta-status-chip.is-ok{background:rgba(34,197,94,.2);color:#bbf7d0}',
		'.ta-page.ta-dark .ta-status-chip.is-warning,body.dark .ta-page .ta-status-chip.is-warning,html.dark .ta-page .ta-status-chip.is-warning,body.mode-dark .ta-page .ta-status-chip.is-warning,body.argon-dark .ta-page .ta-status-chip.is-warning,html[data-theme="dark"] .ta-page .ta-status-chip.is-warning,body[data-theme="dark"] .ta-page .ta-status-chip.is-warning{background:rgba(249,115,22,.2);color:#fed7aa}',
		'.ta-overview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;align-items:stretch}',
		'.ta-overview-grid.compact{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}',
		'.ta-detail-layout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}',
		'.ta-overview-card,.ta-section-card,.ta-config-shell{position:relative;display:flex;flex-direction:column;border:1px solid var(--ta-card-border);border-radius:16px;background:var(--ta-card-bg);padding:16px;box-shadow:0 6px 18px rgba(15,23,42,.04)}',
		'.ta-overview-card{height:100%}',
		'.ta-overview-card:before{content:"";position:absolute;inset:0 auto 0 0;width:4px;border-radius:16px 0 0 16px;background:linear-gradient(180deg,#cbd5e1,#94a3b8)}',
		'.ta-overview-card.is-runtime:before{background:linear-gradient(180deg,#0284c7,#2563eb)}',
		'.ta-overview-card.is-policy:before{background:linear-gradient(180deg,#f59e0b,#ef4444)}',
		'.ta-overview-card.is-config:before{background:linear-gradient(180deg,#0ea5e9,#2563eb)}',
		'.ta-overview-card.is-capability:before{background:linear-gradient(180deg,#22c55e,#14b8a6)}',
		'.ta-overview-card.is-ipv6:before{background:linear-gradient(180deg,#8b5cf6,#2563eb)}',
		'.ta-overview-card.is-threshold:before{background:linear-gradient(180deg,#f59e0b,#f97316)}',
		'.ta-overview-card.is-sessions:before{background:linear-gradient(180deg,#ef4444,#ec4899)}',
		'.ta-overview-card.is-ppe:before{background:linear-gradient(180deg,#ef4444,#ec4899)}',
		'.ta-overview-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
		'.ta-overview-card-title{display:flex;align-items:center;gap:8px;font-size:.8rem;font-weight:700;color:var(--ta-text-muted)}',
		'.ta-overview-card-badge{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:30px;padding:0 8px;border-radius:11px;background:var(--ta-badge-bg);color:var(--ta-chip-text);font-size:.74rem;font-weight:800;letter-spacing:.04em}',
		'.ta-overview-card-main{display:flex;flex-direction:column;gap:8px;margin-top:auto}',
		'.ta-overview-card-value{font-size:1.24rem;font-weight:700;line-height:1.25;word-break:break-word;color:var(--ta-text-strong)}',
		'.ta-value-highlight{display:inline;padding:0 .16em .03em;border-radius:7px;box-decoration-break:clone;-webkit-box-decoration-break:clone;background-image:linear-gradient(transparent 54%,var(--ta-highlight-fill,rgba(37,99,235,.14)) 54%);color:var(--ta-highlight-text,var(--ta-text-strong));font-weight:800}',
		'.ta-overview-card.is-runtime .ta-value-highlight{--ta-highlight-fill:rgba(37,99,235,.16);--ta-highlight-text:#123766}',
		'.ta-overview-card.is-policy .ta-value-highlight{--ta-highlight-fill:rgba(249,115,22,.18);--ta-highlight-text:#7c2d12}',
		'.ta-overview-card.is-ipv6 .ta-value-highlight{--ta-highlight-fill:rgba(139,92,246,.17);--ta-highlight-text:#4c1d95}',
		'.ta-overview-card.is-sessions .ta-value-highlight,.ta-overview-card.is-capability .ta-value-highlight{--ta-highlight-fill:rgba(236,72,153,.16);--ta-highlight-text:#831843}',
		'.ta-page.ta-dark .ta-overview-card.is-runtime .ta-value-highlight,body.dark .ta-page .ta-overview-card.is-runtime .ta-value-highlight,html.dark .ta-page .ta-overview-card.is-runtime .ta-value-highlight,body.mode-dark .ta-page .ta-overview-card.is-runtime .ta-value-highlight,body.argon-dark .ta-page .ta-overview-card.is-runtime .ta-value-highlight,html[data-theme="dark"] .ta-page .ta-overview-card.is-runtime .ta-value-highlight,body[data-theme="dark"] .ta-page .ta-overview-card.is-runtime .ta-value-highlight{--ta-highlight-fill:rgba(96,165,250,.22);--ta-highlight-text:#eff6ff}',
		'.ta-page.ta-dark .ta-overview-card.is-policy .ta-value-highlight,body.dark .ta-page .ta-overview-card.is-policy .ta-value-highlight,html.dark .ta-page .ta-overview-card.is-policy .ta-value-highlight,body.mode-dark .ta-page .ta-overview-card.is-policy .ta-value-highlight,body.argon-dark .ta-page .ta-overview-card.is-policy .ta-value-highlight,html[data-theme="dark"] .ta-page .ta-overview-card.is-policy .ta-value-highlight,body[data-theme="dark"] .ta-page .ta-overview-card.is-policy .ta-value-highlight{--ta-highlight-fill:rgba(251,146,60,.24);--ta-highlight-text:#fff7ed}',
		'.ta-page.ta-dark .ta-overview-card.is-ipv6 .ta-value-highlight,body.dark .ta-page .ta-overview-card.is-ipv6 .ta-value-highlight,html.dark .ta-page .ta-overview-card.is-ipv6 .ta-value-highlight,body.mode-dark .ta-page .ta-overview-card.is-ipv6 .ta-value-highlight,body.argon-dark .ta-page .ta-overview-card.is-ipv6 .ta-value-highlight,html[data-theme="dark"] .ta-page .ta-overview-card.is-ipv6 .ta-value-highlight,body[data-theme="dark"] .ta-page .ta-overview-card.is-ipv6 .ta-value-highlight{--ta-highlight-fill:rgba(167,139,250,.24);--ta-highlight-text:#f5f3ff}',
		'.ta-page.ta-dark .ta-overview-card.is-sessions .ta-value-highlight,.ta-page.ta-dark .ta-overview-card.is-capability .ta-value-highlight,body.dark .ta-page .ta-overview-card.is-sessions .ta-value-highlight,body.dark .ta-page .ta-overview-card.is-capability .ta-value-highlight,html.dark .ta-page .ta-overview-card.is-sessions .ta-value-highlight,html.dark .ta-page .ta-overview-card.is-capability .ta-value-highlight,body.mode-dark .ta-page .ta-overview-card.is-sessions .ta-value-highlight,body.mode-dark .ta-page .ta-overview-card.is-capability .ta-value-highlight,body.argon-dark .ta-page .ta-overview-card.is-sessions .ta-value-highlight,body.argon-dark .ta-page .ta-overview-card.is-capability .ta-value-highlight,html[data-theme="dark"] .ta-page .ta-overview-card.is-sessions .ta-value-highlight,html[data-theme="dark"] .ta-page .ta-overview-card.is-capability .ta-value-highlight,body[data-theme="dark"] .ta-page .ta-overview-card.is-sessions .ta-value-highlight,body[data-theme="dark"] .ta-page .ta-overview-card.is-capability .ta-value-highlight{--ta-highlight-fill:rgba(244,114,182,.22);--ta-highlight-text:#fdf2f8}',
		'.ta-overview-card-detail{padding-top:8px;border-top:1px solid var(--ta-card-border-soft);font-size:.86rem;color:var(--ta-text-muted);line-height:1.45;word-break:break-word}',
		'.ta-section-card{overflow:hidden}',
		'.ta-section-card:before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,#cbd5e1,#e2e8f0)}',
		'.ta-section-card.is-runtime-panel:before{background:linear-gradient(90deg,#0891b2,#2563eb)}',
		'.ta-section-card.is-capability-panel:before{background:linear-gradient(90deg,#10b981,#22c55e)}',
		'.ta-section-card.is-progress-panel:before{background:linear-gradient(90deg,#ec4899,#8b5cf6)}',
		'.ta-section-title{display:flex;align-items:center;gap:8px;padding:4px 0 12px;margin-bottom:12px;border-bottom:1px solid var(--ta-card-border-soft);font-size:.82rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ta-text-muted)}',
		'.ta-info-grid{display:grid;gap:10px}',
		'.ta-info-row{display:grid;grid-template-columns:minmax(112px,42%) 1fr;gap:12px;align-items:start;padding:11px 12px;border:1px solid var(--ta-card-border-soft);border-radius:12px;background:var(--ta-detail-bg)}',
		'.ta-info-label{font-size:.85rem;color:var(--ta-text-muted);line-height:1.4}',
		'.ta-info-value{display:flex;justify-content:flex-end;align-items:flex-start;gap:8px;min-width:0;text-align:right;color:var(--ta-text-strong);font-size:.9rem;font-weight:600;line-height:1.45;word-break:break-word}',
		'.ta-info-value .ta-inline-chips{justify-content:flex-end}',
		'.ta-progress-card{padding:14px 16px}',
		'.ta-progress-list{display:grid;gap:12px}',
		'.ta-progress-row{display:grid;gap:8px}',
		'.ta-progress-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
		'.ta-progress-label{font-size:.9rem;font-weight:600;color:var(--ta-text)}',
		'.ta-progress-value{font-size:.84rem;color:var(--ta-text-muted);white-space:nowrap}',
		'.ta-progress-track{height:10px;border-radius:999px;background:rgba(148,163,184,.18);overflow:hidden}',
		'.ta-progress-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#60a5fa,#2563eb)}',
		'.ta-config-shell>.cbi-map{margin:0;background:transparent;border:none;box-shadow:none;padding:0}',
		'.ta-config-shell .cbi-section{margin-top:0}',
		'.ta-config-shell h2{margin:0 0 6px;color:var(--ta-text-strong)}',
		'.ta-config-shell .cbi-map-descr{margin:0 0 14px;color:var(--ta-text-muted)}',
		'.ta-config-shell .cbi-tabmenu{margin:0 0 14px;padding:0;border-bottom:none;display:flex;flex-wrap:wrap;gap:8px}',
		'.ta-config-shell .cbi-tabmenu li{display:inline-flex;align-items:stretch;margin:0;float:none;border:1px solid var(--ta-card-border-soft);border-radius:10px !important;background:var(--ta-button-neutral-bg);box-shadow:none !important;overflow:hidden;transition:background-color .18s ease,color .18s ease,border-color .18s ease}',
		'.ta-config-shell .cbi-tabmenu li a{display:inline-flex;align-items:center;min-height:38px;padding:8px 14px;border:none !important;border-radius:0 !important;background:none !important;color:var(--ta-chip-text) !important;-webkit-text-fill-color:var(--ta-chip-text);box-shadow:none !important;transition:background-color .18s ease,color .18s ease,border-color .18s ease}',
		'.ta-config-shell .cbi-tabmenu li.cbi-tab,.ta-config-shell .cbi-tabmenu li.active{background:var(--ta-button-primary-bg) !important;border-color:transparent !important;box-shadow:var(--ta-button-primary-shadow) !important}',
		'.ta-config-shell .cbi-tabmenu li.cbi-tab a,.ta-config-shell .cbi-tabmenu li.active a{color:#fff !important;-webkit-text-fill-color:#fff !important}',
		'.ta-config-shell .cbi-tab-descr,.ta-config-shell .cbi-section-descr,.ta-config-shell .cbi-value-description{color:var(--ta-text-muted) !important;-webkit-text-fill-color:var(--ta-text-muted);opacity:1}',
		'.ta-config-shell label,.ta-config-shell .cbi-value-title,.ta-config-shell .cbi-section-node{color:var(--ta-text)}',
		'.ta-config-shell input[type="text"],.ta-config-shell input:not([type]),.ta-config-shell select,.ta-config-shell textarea,.ta-config-shell .cbi-dropdown{min-height:38px;box-sizing:border-box;border-radius:10px !important;background:var(--ta-button-neutral-bg) !important;border:1px solid var(--ta-card-border) !important;color:var(--ta-text) !important;-webkit-text-fill-color:var(--ta-text);box-shadow:0 0 0 1px rgba(255,255,255,.02) inset !important}',
		'.ta-config-shell .cbi-page-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:flex-start;margin:16px 0 0;padding:12px 14px;border:1px solid var(--ta-card-border);border-radius:16px;background:var(--ta-action-bar-bg);box-shadow:inset 0 1px 0 rgba(255,255,255,.16)}',
		'.ta-config-shell .cbi-page-actions>*{margin:0 !important;float:none !important}',
		'.ta-config-shell .cbi-page-actions .cbi-button{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 16px;border-radius:10px !important;border:1px solid var(--ta-card-border-soft) !important;background:var(--ta-button-neutral-bg) !important;color:var(--ta-text) !important;box-shadow:none !important;transition:transform .16s ease,filter .16s ease}',
		'.ta-config-shell .cbi-page-actions .cbi-button:hover{transform:translateY(-1px);filter:brightness(1.01)}',
		'.ta-config-shell .cbi-page-actions .cbi-button-apply,.ta-config-shell .cbi-page-actions .cbi-button-save{border-color:transparent !important;background:var(--ta-button-primary-bg) !important;color:#fff !important;box-shadow:var(--ta-button-primary-shadow) !important}',
		'.ta-config-shell .cbi-page-actions .cbi-button-reset{background:var(--ta-button-secondary-bg) !important;color:var(--ta-text-muted) !important}',
		'@media (max-width:900px){.ta-detail-layout{grid-template-columns:1fr}}',
		'@media (max-width:780px){.ta-info-row{grid-template-columns:1fr}.ta-info-value,.ta-info-value .ta-inline-chips{text-align:left;justify-content:flex-start}.ta-progress-head{flex-direction:column;align-items:flex-start}.ta-progress-value{white-space:normal}.ta-config-shell .cbi-page-actions .cbi-button{width:100%;justify-content:center}}',
		'@media (max-width:640px){.ta-hero-card{grid-template-columns:1fr;gap:12px;padding:14px 15px}.ta-hero-badge-shell{flex-direction:row;justify-content:flex-start}.ta-hero-badge-label{text-align:left}.ta-device-glyph{width:64px;height:64px}.ta-network-icon{width:34px;height:34px}.ta-hero-title{font-size:1.18rem}}'
	].join('\n'));
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('turboacc'),
			L.resolveDefault(getSystemFeatures(), {}),
			L.resolveDefault(getServiceStatus(), []),
			L.resolveDefault(getMTKPPEStatus(), {})
		]);
	},

	render: function(data) {
		var features = data[1];
		var service = data[2] || [];
		var ppeStats = data[3] || {};
		var overviewRoot = E('div', { 'class': 'ta-overview-root' });
		var page = applyThemeClass(E('div', { 'class': 'ta-page' }, [
			renderStyle(),
			overviewRoot
		]), 'ta-dark');
		var self = this;
		var config = getConfigState(features);
		var map = buildForm(features, config);

		dom.content(overviewRoot, renderOverviewContent({
			features: features,
			config: config,
			service: service,
			ppe: ppeStats
		}));

		return map.render().then(function(mapNode) {
			page.appendChild(E('div', { 'class': 'ta-config-shell' }, [ mapNode ]));

			poll.add(function() {
				return Promise.all([
					L.resolveDefault(getServiceStatus(), []),
					L.resolveDefault(getMTKPPEStatus(), {})
				]).then(function(nextData) {
					dom.content(overviewRoot, renderOverviewContent({
						features: features,
						config: getConfigState(features),
						service: nextData[0],
						ppe: nextData[1]
					}));
				});
			}, 3);

			return page;
		});
	}
});

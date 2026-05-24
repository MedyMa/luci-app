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

function configUsesEngine(config, key) {
	return normalizeFastpathValue(config && config.fastpath) === key;
}

function isEngineAvailable(flag, config, key) {
	return !!flag || configUsesEngine(config, key);
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

function getAvailableEngines(features, config) {
	var engines = [];

	if (isEngineAvailable(features.hasFLOWOFFLOADING, config, 'flow_offloading'))
		engines.push({ key: 'flow_offloading', label: _('流量分载') });
	if (isEngineAvailable(features.hasFASTCLASSIFIER, config, 'fast_classifier'))
		engines.push({ key: 'fast_classifier', label: _('快速分类器') });
	if (isEngineAvailable(features.hasSHORTCUTFECM, config, 'shortcut_fe_cm'))
		engines.push({ key: 'shortcut_fe_cm', label: _('SFE 连接管理器') });
	if (isEngineAvailable(features.hasMEDIATEKHNAT, config, 'mediatek_hnat'))
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
		return _('软件路由/NAT 分载，通用性最好，但加速深度偏保守。');
	case 'fast_classifier':
		return _('面向 SFE 的快速分类器，适合希望继续启用桥接加速的场景。');
	case 'shortcut_fe_cm':
		return _('SFE 的轻量连接管理器，路径简单，但平台覆盖面更窄。');
	case 'mediatek_hnat':
		return _('mt798x 在 24.10 下的主力有线加速通路，可配合 PPE 实时观察绑定情况。');
	default:
		return _('当前未启用主加速引擎。');
	}
}

function getRuntimeLabel(token) {
	token = trimValue(token);

	switch (token) {
	case 'Flow Offloading':
	case 'Flow offloading':
		return _('流量分载');
	case 'Fast classifier':
		return _('快速分类器');
	case 'Shortcut-FE CM':
		return _('SFE 连接管理器');
	case 'MediaTek HWNAT':
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

function getRuntimeEngineKey(value) {
	value = trimValue(value);

	if (!value)
		return 'disabled';

	if (value.indexOf('MediaTek HNAT') >= 0 || value.indexOf('MediaTek HWNAT') >= 0)
		return 'mediatek_hnat';
	if (value.indexOf('Fast classifier') >= 0)
		return 'fast_classifier';
	if (value.indexOf('Shortcut-FE CM') >= 0)
		return 'shortcut_fe_cm';
	if (value.indexOf('Flow offloading') >= 0 || value.indexOf('Flow Offloading') >= 0)
		return 'flow_offloading';

	return 'disabled';
}

function buildStatusMeta(value, emptyDetail, activeDetail) {
	var parts = trimValue(value).split(' / ').map(function(part) {
		return getRuntimeLabel(part);
	}).filter(function(part) {
		return part !== '';
	});

	return {
		primary: parts.length ? parts[0] : _('已禁用'),
		warnings: parts.length > 1 ? parts.slice(1) : [],
		detail: parts.length > 1 ? parts.slice(1).join(' · ') : (parts.length ? (activeDetail || parts[0]) : (emptyDetail || _('未检测到活动加速通路。')))
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
		return _('跟随主通路');
	}
}

function getIPv6ModeDetail(config, features) {
	var fastpath = normalizeFastpathValue(config.fastpath);

	if (!features.hasIPV6)
		return _('当前平台未开放 IPv6 加速能力。');

	switch (fastpath) {
	case 'fast_classifier':
		return config.fastpath_fc_ipv6 ? _('Fast classifier 已打开 IPv6 加速。') : _('Fast classifier 可单独启用 IPv6 加速。');
	case 'mediatek_hnat':
		return config.fastpath_mh_eth_hnat_v6 ? _('有线 IPv6 会话可进入 HNAT 通路。') : _('当前仅加速 IPv4，会保留 IPv6 走常规栈。');
	case 'disabled':
		return _('主通路关闭时不会有独立 IPv6 加速。');
	default:
		return _('当前引擎没有单独的 IPv6 开关。');
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

	if (count == null) {
		return {
			count: null,
			cards: [],
			totalBound: null,
			totalAll: null
		};
	}

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

	return E('span', { 'class': 'ta-chip ' + (extraClass || '') }, String(text));
}

function renderSectionPill(label, value, tone) {
	return E('div', { 'class': 'ta-section-pill ' + (tone || '') }, [
		E('span', { 'class': 'ta-section-pill-label' }, label),
		E('strong', { 'class': 'ta-section-pill-value' }, displayValue(value))
	]);
}

function renderStatCard(title, value, detail, tone, chips) {
	chips = compactChildren(chips);

	return E('div', { 'class': 'ta-stat-card ' + (tone || '') }, compactChildren([
		E('div', { 'class': 'ta-stat-title' }, title),
		E('div', { 'class': 'ta-stat-value' }, displayValue(value)),
		detail ? E('div', { 'class': 'ta-stat-detail' }, detail) : null,
		chips.length ? E('div', { 'class': 'ta-chip-list' }, chips) : null
	]));
}

function renderInsightCard(title, value, detail, tone, rows, chips) {
	rows = (rows || []).filter(function(row) {
		return row[1] != null && row[1] !== '';
	});
	chips = compactChildren(chips);

	return E('div', { 'class': 'ta-insight-card ' + (tone || '') }, compactChildren([
		E('div', { 'class': 'ta-insight-head' }, [
			E('div', { 'class': 'ta-insight-title' }, title),
			E('div', { 'class': 'ta-insight-value' }, displayValue(value))
		]),
		detail ? E('div', { 'class': 'ta-insight-detail' }, detail) : null,
		chips.length ? E('div', { 'class': 'ta-chip-list' }, chips) : null,
		rows.length ? E('div', { 'class': 'ta-kv-list' }, rows.map(function(row) {
			return E('div', { 'class': 'ta-kv-row' }, [
				E('span', { 'class': 'ta-kv-label' }, row[0]),
				E('strong', { 'class': 'ta-kv-value' }, displayValue(row[1]))
			]);
		})) : null
	]));
}

function renderInfoGrid(rows) {
	rows = (rows || []).filter(function(row) {
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

function renderChecklist(title, items, tone) {
	items = (items || []).filter(function(item) {
		return item != null && item !== '';
	});

	if (!items.length)
		return null;

	return E('div', { 'class': 'ta-note-card ' + (tone || '') }, [
		E('div', { 'class': 'ta-note-title' }, title),
		E('ul', { 'class': 'ta-note-list' }, items.map(function(item) {
			return E('li', {}, item);
		}))
	]);
}

function renderEngineCard(engine, configKey, runtimeKey) {
	var chips = [];
	var tone = 'is-neutral';

	if (engine.key === configKey) {
		chips.push(renderChip(_('当前配置'), 'is-info'));
		tone = 'is-selected';
	}

	if (engine.key === runtimeKey) {
		chips.push(renderChip(_('实时生效'), 'is-ok'));
		tone = 'is-live';
	}

	if (!chips.length)
		chips.push(renderChip(_('可切换'), 'is-muted'));

	return E('div', { 'class': 'ta-engine-card ' + tone }, [
		E('div', { 'class': 'ta-engine-top' }, [
			E('div', { 'class': 'ta-engine-code' }, getEngineShortLabel(engine.key)),
			E('div', { 'class': 'ta-engine-name' }, engine.label)
		]),
		E('div', { 'class': 'ta-engine-detail' }, getEngineDescription(engine.key)),
		E('div', { 'class': 'ta-chip-list' }, chips)
	]);
}

function renderPPEPanel(ppe) {
	if (!ppe || !ppe.cards || !ppe.cards.length)
		return null;

	var rows = [0, 1, 2].map(function(index) {
		return ppe.cards[index] || {
			index: index,
			bound: null,
			all: null,
			percent: 0
		};
	});

	return E('div', { 'class': 'ta-panel ta-ppe-panel' }, [
		E('div', { 'class': 'ta-panel-head' }, [
			E('div', { 'class': 'ta-panel-title' }, _('PPE 明细')), 
			E('div', { 'class': 'ta-panel-subtitle' }, _('三条 PPE 通道的已绑定连接数。'))
		]),
		E('div', { 'class': 'ta-progress-list' }, rows.map(function(card) {
			var width = card.bound > 0 && card.all > 0 ? Math.max(card.percent, 1) : 0;
			var value = card.bound == null || card.all == null
				? '--'
				: formatSessions(card.bound, card.all) + ' (' + card.percent + '%)';

			return E('div', { 'class': 'ta-progress-row' }, [
				E('div', { 'class': 'ta-progress-head' }, [
					E('div', { 'class': 'ta-progress-label' }, 'PPE' + card.index),
					E('div', { 'class': 'ta-progress-value' }, value)
				]),
				E('div', { 'class': 'ta-progress-track' }, [
					E('div', { 'class': 'ta-progress-fill', 'style': 'width:' + String(width) + '%' })
				])
			]);
		}))
	]);
}

function renderFeatureTag(flag, label) {
	return renderChip((label ? label + ' · ' : '') + (flag ? _('可用') : _('不可用')), flag ? 'is-ok' : 'is-muted');
}

function getHealthState(state) {
	var features = state.features || {};
	var config = state.config || {};
	var service = state.service || [];
	var ppe = state.ppe || {};
	var configuredKey = normalizeFastpathValue(config.fastpath);
	var runtimeType = trimValue(service[0] && service[0].type);
	var runtimeKey = getRuntimeEngineKey(runtimeType);
	var runtimeMeta = buildStatusMeta(runtimeType, _('未检测到活动加速通路。'), _('当前内核返回的主加速通路。'));
	var fullconeMeta = buildStatusMeta(service[1] && service[1].type, _('已禁用'));
	var tcpccaLabel = trimValue(service[2] && service[2].type) || String(config.tcpcca || '').toUpperCase() || '--';
	var notes = [];
	var pills = [];
	var level = 'is-idle';
	var headline = _('已禁用');
	var headlineTone = 'is-disabled';
	var summary = _('当前页面没有检测到活动的数据通路。');
	var aligned = configuredKey === runtimeKey || (configuredKey === 'disabled' && runtimeKey === 'disabled');

	if (configuredKey === 'disabled' && runtimeKey === 'disabled') {
		level = 'is-idle';
		headline = _('已禁用');
		headlineTone = 'is-disabled';
		summary = _('当前未启用主加速引擎。');
	}
	else if (configuredKey !== 'disabled' && runtimeKey === configuredKey) {
		level = 'is-healthy';
		headline = _('已启用');
		headlineTone = 'is-enabled';
		summary = _('配置与实时通路一致。');
	}
	else if (configuredKey !== 'disabled' && runtimeKey !== 'disabled') {
		level = 'is-attention';
		headline = _('已启用');
		headlineTone = 'is-enabled';
		summary = _('实时通路与配置不一致。');
	}
	else {
		level = 'is-warning';
		headline = _('已禁用');
		headlineTone = 'is-disabled';
		summary = _('已配置，但当前未看到活动通路。');
	}

	pills.push(renderChip(_('配置') + ' · ' + getEngineLabel(configuredKey), 'is-info'));
	pills.push(renderChip(_('实时') + ' · ' + runtimeMeta.primary, runtimeKey === 'disabled' ? 'is-muted' : 'is-ok'));
	if (configuredKey === 'mediatek_hnat' && ppe.totalAll != null)
		pills.push(renderChip(_('PPE') + ' · ' + formatSessions(ppe.totalBound, ppe.totalAll), 'is-info'));

	if (!aligned && configuredKey !== 'disabled')
		notes.push(_('已选择 ') + getEngineLabel(configuredKey) + _('，但实时内核仍显示 ') + runtimeMeta.primary + _('。'));

	if (runtimeMeta.warnings.length)
		notes.push(_('运行告警：') + runtimeMeta.warnings.join(' · '));

	if (configuredKey === 'mediatek_hnat' && !config.fastpath_mh_eth_hnat)
		notes.push(_('已选 MediaTek HNAT，但“启用有线 HNAT”当前未打开。'));

	if (configuredKey === 'mediatek_hnat' && config.fastpath_mh_eth_hnat && features.hasIPV6 && !config.fastpath_mh_eth_hnat_v6)
		notes.push(_('IPv6 当前未进入 HNAT，若有纯 IPv6 场景可视需求再开启。'));

	if (configuredKey === 'fast_classifier' && config.fastpath_fc_br)
		notes.push(_('桥接加速已打开，若桥接模式 VPN 出现异常，应优先回看这一项。'));

	if (config.fastpath_mh_eth_hnat_ap)
		notes.push(_('已填写 AP 模式地址，保存后切换拓扑需要重启才能完全生效。'));

	if (configuredKey === 'mediatek_hnat' && ppe.totalAll != null)
		notes.push(_('当前 PPE 总容量：') + formatSessions(ppe.totalBound, ppe.totalAll));

	return {
		level: level,
		headline: headline,
		summary: summary,
		configuredKey: configuredKey,
		runtimeKey: runtimeKey,
		runtimeMeta: runtimeMeta,
		fullconeMeta: fullconeMeta,
		tcpccaLabel: tcpccaLabel,
		headlineTone: headlineTone,
		pills: pills,
		notes: notes
	};
}

function renderHero(state, health) {
	var config = state.config || {};
	var ppe = state.ppe || {};
	var hnatProfile = normalizeFastpathValue(config.fastpath) === 'mediatek_hnat';
	var summaryValue = hnatProfile
		? formatSessions(ppe.totalBound, ppe.totalAll)
		: health.runtimeMeta.primary;

	return E('div', { 'class': 'ta-hero ' + health.level }, [
		E('div', { 'class': 'ta-hero-main' }, [
			E('div', { 'class': 'ta-hero-badge' }, [
				E('span', { 'class': 'ta-hero-badge-code' }, getEngineShortLabel(config.fastpath)),
				E('span', { 'class': 'ta-hero-badge-dot' })
			]),
			E('div', { 'class': 'ta-hero-copy' }, [
				E('div', { 'class': 'ta-hero-kicker' }, _('TurboACC 控制台')),
				E('div', { 'class': 'ta-hero-title ' + health.headlineTone }, health.headline),
				E('div', { 'class': 'ta-hero-summary' }, health.summary)
			])
		]),
		E('div', { 'class': 'ta-hero-side' }, compactChildren([
			renderSectionPill(_('实时通路'), health.runtimeMeta.primary, health.runtimeKey === 'disabled' ? 'is-muted' : 'is-good'),
			hnatProfile ? renderSectionPill(_('PPE 连接数'), summaryValue, 'is-accent') : null
		]))
	]);
}

function renderStatusStrip(state, health) {
	var features = state.features || {};
	var config = state.config || {};

	return E('div', { 'class': 'ta-status-strip' }, [
		E('div', { 'class': 'ta-status-item' }, [
			E('span', {}, _('配置')),
			E('strong', {}, getEngineLabel(config.fastpath))
		]),
		E('div', { 'class': 'ta-status-item' }, [
			E('span', {}, _('NAT')),
			E('strong', {}, getFullconeConfigLabel(config.fullcone))
		]),
		E('div', { 'class': 'ta-status-item' }, [
			E('span', {}, _('IPv6')),
			E('strong', {}, getIPv6ModeText(config, features))
		]),
		E('div', { 'class': 'ta-status-item' }, [
			E('span', {}, _('TCP')),
			E('strong', {}, health.tcpccaLabel)
		])
	]);
}

function renderSummaryGrid(state, health) {
	var features = state.features || {};
	var config = state.config || {};
	var ppe = state.ppe || {};
	var ipv6Text = getIPv6ModeText(config, features);
	var availableEngines = getAvailableEngines(features, config);
	var engineCount = availableEngines.length;
	var sessionValue = normalizeFastpathValue(config.fastpath) === 'mediatek_hnat'
		? formatSessions(ppe.totalBound, ppe.totalAll)
		: String(engineCount);
	var sessionDetail = normalizeFastpathValue(config.fastpath) === 'mediatek_hnat'
		? (_('PPE 通道') + ': ' + displayValue(ppe.count) + ' · ' + _('绑定阈值') + ': ' + config.fastpath_mh_eth_hnat_bind_rate + ' pps')
		: (_('当前可切换主引擎数量') + ': ' + String(engineCount));

	return E('div', { 'class': 'ta-summary-grid' }, [
		renderStatCard(_('配置档案'), getEngineLabel(config.fastpath), getEngineDescription(config.fastpath), 'is-primary', [
			renderChip(config.fastpath === 'disabled' ? _('未启用') : _('已选择'), config.fastpath === 'disabled' ? 'is-muted' : 'is-info')
		]),
		renderStatCard(_('实时通路'), health.runtimeMeta.primary, health.runtimeMeta.detail, 'is-good', health.runtimeMeta.warnings.map(function(tag) {
			return renderChip(tag, 'is-warning');
		})),
		renderStatCard(_('NAT / TCP 策略'), getFullconeConfigLabel(config.fullcone), _('TCP CCA') + ' · ' + health.tcpccaLabel, 'is-warning', [
			renderChip(_('IPv6') + ' · ' + ipv6Text, ipv6Text === _('已启用') ? 'is-ok' : 'is-muted')
		]),
		renderStatCard(normalizeFastpathValue(config.fastpath) === 'mediatek_hnat' ? _('PPE 会话') : _('引擎储备'), sessionValue, sessionDetail, 'is-accent', [
			renderChip(_('实时遥测'), 'is-info')
		])
	]);
}

function renderFocusGrid(state, health) {
	var features = state.features || {};
	var config = state.config || {};
	var ppe = state.ppe || {};
	var hnatEnabled = normalizeFastpathValue(config.fastpath) === 'mediatek_hnat';

	return E('div', { 'class': 'ta-focus-grid' }, [
		renderInsightCard(
			_('有线数据通路'),
			hnatEnabled ? (config.fastpath_mh_eth_hnat ? _('已放行') : _('待放行')) : health.runtimeMeta.primary,
			hnatEnabled ? _('MediaTek HNAT 是 mt798x 24.10 上最值得优先确认的主通路。') : _('当前主通路决定了大部分路由/NAT 转发行为。'),
			'is-primary',
			[
				[ _('实时引擎'), health.runtimeMeta.primary ],
				[ _('桥接加速'), config.fastpath_fc_br ? _('已启用') : _('未启用') ],
				[ _('有线 HNAT'), hnatEnabled ? (config.fastpath_mh_eth_hnat ? _('已启用') : _('未启用')) : null ]
			],
			[
				renderChip(hnatEnabled ? _('优先检查') : _('按需切换'), 'is-info')
			]
		),
		renderInsightCard(
			_('游戏与 NAT 行为'),
			getFullconeConfigLabel(config.fullcone),
			_('全锥形 NAT 主要影响联机和端口映射体验，不代表主通路本身一定工作。'),
			'is-warning',
			[
				[ _('实时反馈'), health.fullconeMeta.primary ],
				[ _('风险提示'), trimValue(config.fullcone) === '0' ? _('联机型业务更依赖手动映射') : _('更适合游戏主机与 P2P 场景') ]
			],
			[
				renderChip(_('体验侧'), 'is-warning')
			]
		),
		renderInsightCard(
			_('IPv6 与高级调优'),
			getIPv6ModeText(config, features),
			getIPv6ModeDetail(config, features),
			'is-accent',
			[
				[ _('绑定阈值'), hnatEnabled && config.fastpath_mh_eth_hnat ? (config.fastpath_mh_eth_hnat_bind_rate + ' pps') : null ],
				[ _('AP 模式地址'), config.fastpath_mh_eth_hnat_ap || null ],
				[ _('PPE 总览'), hnatEnabled ? formatSessions(ppe.totalBound, ppe.totalAll) : null ]
			],
			[
				renderChip(_('高级项'), 'is-muted')
			]
		)
	]);
}

function renderEngineRail(state, health) {
	var availableEngines = getAvailableEngines(state.features || {}, state.config || {});

	if (!availableEngines.length)
		return null;

	return E('div', { 'class': 'ta-panel' }, [
		E('div', { 'class': 'ta-panel-head' }, [
			E('div', { 'class': 'ta-panel-title' }, _('通路候选')), 
			E('div', { 'class': 'ta-panel-subtitle' }, _('把“当前配置”和“实时生效”并排摆出来，避免只看配置误判真实状态。'))
		]),
		E('div', { 'class': 'ta-engine-grid' }, availableEngines.map(function(engine) {
			return renderEngineCard(engine, health.configuredKey, health.runtimeKey);
		}))
	]);
}

function renderTelemetryGrid(state, health) {
	var features = state.features || {};
	var config = state.config || {};
	var ppe = state.ppe || {};

	return E('div', { 'class': 'ta-telemetry-grid' }, compactChildren([
		E('div', { 'class': 'ta-panel' }, [
			E('div', { 'class': 'ta-panel-head' }, [
				E('div', { 'class': 'ta-panel-title' }, _('实时遥测')), 
				E('div', { 'class': 'ta-panel-subtitle' }, _('这里读的是当前内核和 rpcd 的实际返回，不是单纯的表单配置。'))
			]),
			renderInfoGrid([
				[ _('主加速引擎'), health.runtimeMeta.primary ],
				[ _('运行告警'), health.runtimeMeta.warnings.length ? E('div', { 'class': 'ta-chip-list' }, health.runtimeMeta.warnings.map(function(tag) {
					return renderChip(tag, 'is-warning');
				})) : renderChip(_('无'), 'is-ok') ],
				[ _('全锥形 NAT'), health.fullconeMeta.primary ],
				[ _('TCP CCA'), health.tcpccaLabel ],
				[ _('IPv6 加速'), getIPv6ModeText(config, features) ],
				[ _('PPE 通道数'), normalizeFastpathValue(config.fastpath) === 'mediatek_hnat' ? displayValue(ppe.count) : null ],
				[ _('已绑定会话'), normalizeFastpathValue(config.fastpath) === 'mediatek_hnat' ? formatSessions(ppe.totalBound, ppe.totalAll) : null ]
			])
		]),
		E('div', { 'class': 'ta-side-stack' }, compactChildren([
			renderChecklist(_('当前判断'), health.notes.slice(0, 4), health.level),
			E('div', { 'class': 'ta-note-card is-neutral' }, [
				E('div', { 'class': 'ta-note-title' }, _('能力矩阵')), 
				E('div', { 'class': 'ta-capability-grid' }, [
					renderFeatureTag(features.hasFLOWOFFLOADING, _('流量分载')),
					renderFeatureTag(features.hasFASTCLASSIFIER, _('快速分类器')),
					renderFeatureTag(features.hasSHORTCUTFECM, _('SFE')),
					renderFeatureTag(features.hasMEDIATEKHNAT, _('HNAT')),
					renderFeatureTag(features.hasXTFULLCONENAT, _('FullCone')),
					renderFeatureTag(features.hasIPV6, _('IPv6'))
				]),
				renderInfoGrid([
					[ _('流量分载'), renderFeatureTag(features.hasFLOWOFFLOADING) ],
					[ _('快速分类器'), renderFeatureTag(features.hasFASTCLASSIFIER) ],
					[ _('SFE 连接管理器'), renderFeatureTag(features.hasSHORTCUTFECM) ],
					[ _('MediaTek HNAT'), renderFeatureTag(features.hasMEDIATEKHNAT) ],
					[ _('XT_FULLCONE_NAT'), renderFeatureTag(features.hasXTFULLCONENAT) ],
					[ _('内核 IPv6 协议栈'), renderFeatureTag(features.hasIPV6) ]
				])
			])
		]))
	]));
}

function renderCompactHero(state, health) {
	var config = state.config || {};
	var ppe = state.ppe || {};
	var hnatProfile = normalizeFastpathValue(config.fastpath) === 'mediatek_hnat';
	var chips = compactChildren([
		renderChip(_('配置') + ' · ' + getEngineLabel(config.fastpath), 'is-info'),
		renderChip(_('实时') + ' · ' + health.runtimeMeta.primary, health.runtimeKey === 'disabled' ? 'is-muted' : 'is-ok'),
		renderChip(_('TCP') + ' · ' + health.tcpccaLabel, 'is-info'),
		hnatProfile ? renderChip(_('PPE') + ' · ' + formatSessions(ppe.totalBound, ppe.totalAll), 'is-info') : null
	]);

	return E('div', { 'class': 'ta-panel ta-compact-hero ' + health.level }, compactChildren([
		E('div', { 'class': 'ta-compact-hero-top' }, [
			E('div', { 'class': 'ta-compact-hero-copy' }, [
				E('div', { 'class': 'ta-compact-kicker' }, _('TurboACC 控制台')),
				E('div', { 'class': 'ta-compact-headline' }, health.headline),
				E('div', { 'class': 'ta-compact-summary' }, health.summary)
			]),
			E('div', { 'class': 'ta-compact-state ' + health.headlineTone }, health.runtimeMeta.primary)
		]),
		chips.length ? E('div', { 'class': 'ta-chip-list' }, chips) : null
	]));
}

function renderCompactOverview(state, health) {
	var features = state.features || {};
	var config = state.config || {};
	var ppe = state.ppe || {};
	var rows = [
		[ _('主加速引擎'), getEngineLabel(config.fastpath) ],
		[ _('实时通路'), health.runtimeMeta.primary ],
		[ _('全锥形 NAT'), health.fullconeMeta.primary ],
		[ _('TCP CCA'), health.tcpccaLabel ],
		[ _('IPv6'), getIPv6ModeText(config, features) ]
	];

	if (normalizeFastpathValue(config.fastpath) === 'mediatek_hnat') {
		rows.push(
			[ _('PPE 通道数'), displayValue(ppe.count) ],
			[ _('PPE 连接数'), formatSessions(ppe.totalBound, ppe.totalAll) ],
			[ _('绑定阈值'), config.fastpath_mh_eth_hnat ? (config.fastpath_mh_eth_hnat_bind_rate + ' pps') : null ]
		);
	}

	return E('div', { 'class': 'ta-compact-grid' }, compactChildren([
		E('div', { 'class': 'ta-panel' }, [
			E('div', { 'class': 'ta-panel-head' }, [
				E('div', { 'class': 'ta-panel-title' }, _('运行状态')),
				E('div', { 'class': 'ta-panel-subtitle' }, _('只保留最常用的运行状态与实时信息。'))
			]),
			renderInfoGrid(rows)
		]),
		renderChecklist(_('提示'), health.notes.slice(0, 3), health.level)
	]));
}

function renderOverviewContent(state) {
	var health = getHealthState(state);

	return E('div', { 'class': 'ta-overview' }, compactChildren([
		renderCompactHero(state, health),
		renderCompactOverview(state, health),
		renderPPEPanel(state.ppe)
	]));
}

function buildForm(features, config) {
	var m = new form.Map('turboacc', _('TurboACC 配置面板'),
		_('只保留常用配置项，更改后保存并应用即可。'));
	var s = m.section(form.NamedSection, 'config', 'turboacc');
	var o;
	var tcpccaOptions = parseTokenList(features.hasTCPCCA);
	var showFlowOffloading = isEngineAvailable(features.hasFLOWOFFLOADING, config, 'flow_offloading');
	var showFastClassifier = isEngineAvailable(features.hasFASTCLASSIFIER, config, 'fast_classifier');
	var showShortcutFeCm = isEngineAvailable(features.hasSHORTCUTFECM, config, 'shortcut_fe_cm');
	var showMediatekHnat = isEngineAvailable(features.hasMEDIATEKHNAT, config, 'mediatek_hnat');

	s.tab('engine', _('主通路'), _('选择主加速引擎。'));
	s.tab('experience', _('体验优化'), _('NAT 与 TCP 设置。'));

	if (showMediatekHnat)
		s.tab('hnat', _('HNAT 高级项'), _('MediaTek HNAT 专用设置。'));

	o = s.taboption('engine', form.ListValue, 'fastpath', _('主加速引擎'),
		_('选择当前使用的加速通路。'));
	o.value('disabled', _('禁用'));
	if (showFlowOffloading)
		o.value('flow_offloading', _('流量分载'));
	if (showFastClassifier)
		o.value('fast_classifier', _('快速分类器'));
	if (showShortcutFeCm)
		o.value('shortcut_fe_cm', _('SFE 连接管理器'));
	if (showMediatekHnat)
		o.value('mediatek_hnat', _('MediaTek HNAT'));
	o.default = config.fastpath || 'disabled';
	o.rmempty = false;
	o.cfgvalue = function(section_id) {
		return normalizeFastpathValue(uci.get('turboacc', section_id, 'fastpath'));
	};
	o.write = function(section_id, value) {
		return uci.set('turboacc', section_id, 'fastpath', value === 'disabled' ? 'none' : value);
	};

	if (showFlowOffloading) {
		o = s.taboption('engine', form.Flag, 'fastpath_fo_hw', _('启用硬件流量分载'),
			_('硬件支持时可开启。'));
		o.default = o.disabled;
		o.rmempty = false;
		o.depends('fastpath', 'flow_offloading');
	}

	if (showFastClassifier) {
		o = s.taboption('engine', form.Flag, 'fastpath_fc_br', _('启用桥接加速'),
			_('可能影响桥接 VPN。'));
		o.default = o.disabled;
		o.rmempty = false;
		o.depends('fastpath', 'fast_classifier');

		if (features.hasIPV6) {
			o = s.taboption('engine', form.Flag, 'fastpath_fc_ipv6', _('为 Fast classifier 打开 IPv6'),
				_('启用 IPv6 加速。'));
			o.default = o.disabled;
			o.rmempty = false;
			o.depends('fastpath', 'fast_classifier');
		}
	}

	o = s.taboption('experience', form.ListValue, 'fullcone', _('全锥形 NAT'),
		_('游戏或 P2P 需要时开启。'));
	o.value('0', _('禁用'));
	if (features.hasXTFULLCONENAT || config.fullcone === '1')
		o.value('1', _('XT_FULLCONE_NAT'));
	o.value('2', _('Boardcom_FULLCONE_NAT'));
	o.default = config.fullcone || getDefaultFullcone(features);
	o.rmempty = false;

	if (tcpccaOptions.indexOf(config.tcpcca) < 0)
		tcpccaOptions.push(config.tcpcca);

	o = s.taboption('experience', form.ListValue, 'tcpcca', _('TCP 拥塞控制算法'),
		_('选择 TCP 拥塞控制。'));
	tcpccaOptions.forEach(function(item) {
		o.value(item, String(item).toUpperCase());
	});
	o.default = config.tcpcca || 'cubic';
	o.rmempty = false;

	if (showMediatekHnat) {
		o = s.taboption('hnat', form.Flag, 'fastpath_mh_eth_hnat', _('启用有线 HNAT'),
			_('启用有线硬件加速。'));
		o.default = o.enabled;
		o.rmempty = false;
		o.depends('fastpath', 'mediatek_hnat');

		o = s.taboption('hnat', form.Flag, 'fastpath_mh_eth_hnat_v6', _('启用有线 IPv6 HNAT'),
			_('启用 IPv6 HNAT。'));
		o.default = o.enabled;
		o.rmempty = false;
		o.depends({ fastpath: 'mediatek_hnat', fastpath_mh_eth_hnat: '1' });

		o = s.taboption('hnat', form.Value, 'fastpath_mh_eth_hnat_ap', _('AP 模式地址'),
			_('需要 AP 模式时填写。'));
		o.optional = true;
		o.datatype = 'ip4addr';
		o.depends({ fastpath: 'mediatek_hnat', fastpath_mh_eth_hnat: '1' });

		o = s.taboption('hnat', form.Value, 'fastpath_mh_eth_hnat_bind_rate', _('HNAT 绑定速率阈值（pps）'),
			_('默认 30。'));
		o.optional = true;
		o.datatype = 'range(1,30)';
		o.placeholder = '30';
		o.depends({ fastpath: 'mediatek_hnat', fastpath_mh_eth_hnat: '1' });
	}

	return m;
}

function renderStyle() {
	return E('style', [
		'.ta-page{display:flex;flex-direction:column;gap:18px;padding-top:22px;--ta-bg:linear-gradient(180deg,rgba(248,251,255,.98),rgba(240,245,252,.98));--ta-panel-bg:linear-gradient(180deg,rgba(255,255,255,.98),rgba(245,248,253,.98));--ta-panel-border:rgba(60,88,138,.13);--ta-panel-border-soft:rgba(60,88,138,.08);--ta-shadow:0 10px 24px rgba(15,23,42,.05);--ta-text:#122033;--ta-text-strong:#0f172a;--ta-text-muted:#5f728b;--ta-chip:#19324a;--ta-chip-bg:rgba(27,63,111,.06);--ta-chip-border:rgba(27,63,111,.10);--ta-info-bg:rgba(27,63,111,.04);--ta-good:#0f766e;--ta-good-bg:rgba(13,148,136,.13);--ta-warn:#b45309;--ta-warn-bg:rgba(245,158,11,.13);--ta-danger:#b91c1c;--ta-danger-bg:rgba(239,68,68,.13);--ta-info:#1d4ed8;--ta-info-bg:rgba(37,99,235,.14);--ta-accent:#7c3aed;--ta-accent-bg:rgba(124,58,237,.14);--ta-hero-orb:radial-gradient(circle at 20% 20%,rgba(37,99,235,.18),transparent 48%),radial-gradient(circle at 82% 12%,rgba(14,165,233,.16),transparent 34%),radial-gradient(circle at 70% 78%,rgba(124,58,237,.14),transparent 34%);--ta-hero-badge:linear-gradient(145deg,#1d4ed8,#3b82f6 52%,#0ea5e9);--ta-button-bg:linear-gradient(180deg,#ffffff,#f2f6fb);--ta-button-primary:linear-gradient(90deg,#0f766e,#2563eb);--ta-button-shadow:0 10px 18px rgba(37,99,235,.16)}',
		'.ta-page.ta-dark,body.dark .ta-page,html.dark .ta-page,body.mode-dark .ta-page,body.argon-dark .ta-page,html[data-theme="dark"] .ta-page,body[data-theme="dark"] .ta-page{--ta-bg:linear-gradient(180deg,rgba(9,15,25,.99),rgba(13,21,34,.99));--ta-panel-bg:linear-gradient(180deg,rgba(17,27,42,.98),rgba(10,18,31,.99));--ta-panel-border:rgba(120,146,188,.22);--ta-panel-border-soft:rgba(120,146,188,.14);--ta-shadow:0 14px 30px rgba(0,0,0,.22);--ta-text:#d8e4f1;--ta-text-strong:#f8fbff;--ta-text-muted:#9cb0c9;--ta-chip:#edf5ff;--ta-chip-bg:rgba(114,157,232,.15);--ta-chip-border:rgba(114,157,232,.20);--ta-info-bg:rgba(255,255,255,.04);--ta-good:#bbf7d0;--ta-good-bg:rgba(16,185,129,.18);--ta-warn:#fde68a;--ta-warn-bg:rgba(245,158,11,.18);--ta-danger:#fecaca;--ta-danger-bg:rgba(239,68,68,.18);--ta-info:#dbeafe;--ta-info-bg:rgba(59,130,246,.20);--ta-accent:#ede9fe;--ta-accent-bg:rgba(139,92,246,.20);--ta-hero-orb:radial-gradient(circle at 18% 20%,rgba(59,130,246,.20),transparent 48%),radial-gradient(circle at 84% 14%,rgba(14,165,233,.16),transparent 34%),radial-gradient(circle at 68% 80%,rgba(124,58,237,.16),transparent 34%);--ta-hero-badge:linear-gradient(145deg,#1e3a8a,#2563eb 52%,#0891b2);--ta-button-bg:linear-gradient(180deg,rgba(35,47,67,.98),rgba(21,31,48,.98));--ta-button-primary:linear-gradient(90deg,#0f766e,#2563eb);--ta-button-shadow:0 12px 22px rgba(0,0,0,.24)}',
		'.ta-overview{display:flex;flex-direction:column;gap:18px}',
		'.ta-compact-hero{display:grid;gap:14px;padding:18px}',
		'.ta-compact-hero-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}',
		'.ta-compact-hero-copy{display:grid;gap:8px;min-width:0}',
		'.ta-compact-kicker{font-size:.76rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ta-text-muted)}',
		'.ta-compact-headline{font-size:1.18rem;font-weight:800;line-height:1.3;color:var(--ta-text-strong)}',
		'.ta-compact-summary{font-size:.92rem;line-height:1.6;color:var(--ta-text-muted)}',
		'.ta-compact-state{display:inline-flex;align-items:center;justify-content:center;min-width:132px;min-height:42px;padding:0 18px;border-radius:999px;font-size:.92rem;font-weight:800;line-height:1.2;text-align:center;box-shadow:0 8px 16px rgba(15,23,42,.08)}',
		'.ta-compact-state.is-enabled{background:var(--ta-good-bg);color:var(--ta-good)}',
		'.ta-compact-state.is-disabled{background:var(--ta-danger-bg);color:var(--ta-danger)}',
		'.ta-compact-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(240px,.8fr);gap:14px}',
		'.ta-hero,.ta-panel,.ta-stat-card,.ta-insight-card,.ta-note-card,.ta-config-shell{position:relative;border:1px solid var(--ta-panel-border);border-radius:22px;background:var(--ta-panel-bg);box-shadow:var(--ta-shadow);color:var(--ta-text);overflow:hidden}',
		'.ta-hero{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(240px,.9fr);gap:18px;padding:22px;background-image:var(--ta-hero-orb),var(--ta-panel-bg)}',
		'.ta-hero:before{content:"";position:absolute;inset:auto -60px -60px auto;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.22),transparent 62%);pointer-events:none}',
		'.ta-hero.is-healthy{border-color:rgba(13,148,136,.28)}',
		'.ta-hero.is-attention{border-color:rgba(245,158,11,.28)}',
		'.ta-hero.is-warning{border-color:rgba(239,68,68,.28)}',
		'.ta-hero-main{display:flex;gap:18px;align-items:flex-start;min-width:0}',
		'.ta-hero-badge{position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:88px;height:88px;border-radius:28px;background:var(--ta-hero-badge);box-shadow:0 18px 26px rgba(37,99,235,.18)}',
		'.ta-hero-badge-code{color:#fff;font-size:1rem;font-weight:800;letter-spacing:.08em}',
		'.ta-hero-badge-dot{position:absolute;right:12px;bottom:12px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 0 5px rgba(255,255,255,.18)}',
		'.ta-hero-copy{display:flex;flex-direction:column;gap:8px;min-width:0}',
		'.ta-hero-kicker{font-size:.76rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ta-text-muted)}',
		'.ta-hero-title{display:inline-flex;align-items:center;justify-content:center;width:fit-content;max-width:100%;padding:10px 22px;border:1px solid transparent;border-radius:999px;font-size:1rem;line-height:1.2;font-weight:800;letter-spacing:.08em;box-shadow:0 10px 18px rgba(15,23,42,.08)}',
		'.ta-hero-title.is-enabled{background:var(--ta-good-bg);border-color:rgba(34,197,94,.24);color:var(--ta-good)}',
		'.ta-hero-title.is-disabled{background:var(--ta-danger-bg);border-color:rgba(239,68,68,.24);color:var(--ta-danger)}',
		'.ta-hero-summary{font-size:.94rem;line-height:1.6;color:var(--ta-text);max-width:48rem}',
		'.ta-hero-side{display:grid;gap:10px;align-content:start}',
		'.ta-section-pill{display:grid;gap:4px;padding:13px 14px;border-radius:16px;background:rgba(255,255,255,.28);border:1px solid var(--ta-panel-border-soft);backdrop-filter:blur(6px)}',
		'.ta-page.ta-dark .ta-section-pill,body.dark .ta-page .ta-section-pill,html.dark .ta-page .ta-section-pill,body.mode-dark .ta-page .ta-section-pill,body.argon-dark .ta-page .ta-section-pill,html[data-theme="dark"] .ta-page .ta-section-pill,body[data-theme="dark"] .ta-page .ta-section-pill{background:rgba(255,255,255,.03)}',
		'.ta-section-pill-label{font-size:.78rem;color:var(--ta-text-muted);font-weight:700;letter-spacing:.03em}',
		'.ta-section-pill-value{font-size:1rem;color:var(--ta-text-strong);line-height:1.3}',
		'.ta-chip-list{display:flex;flex-wrap:wrap;gap:8px}',
		'.ta-chip{display:inline-flex;align-items:center;max-width:100%;padding:6px 11px;border-radius:999px;background:var(--ta-chip-bg);border:1px solid var(--ta-chip-border);color:var(--ta-chip);font-size:.8rem;font-weight:700;line-height:1.2;word-break:break-word}',
		'.ta-chip.is-ok{background:var(--ta-good-bg);color:var(--ta-good)}',
		'.ta-chip.is-warning{background:var(--ta-warn-bg);color:var(--ta-warn)}',
		'.ta-chip.is-info{background:var(--ta-info-bg);color:var(--ta-info)}',
		'.ta-chip.is-muted{background:rgba(148,163,184,.14);color:var(--ta-text-muted)}',
		'.ta-status-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}',
		'.ta-status-item{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;padding:12px 14px;border:1px solid var(--ta-panel-border);border-radius:16px;background:var(--ta-panel-bg);box-shadow:0 6px 16px rgba(15,23,42,.035);color:var(--ta-text)}',
		'.ta-status-item span{font-size:.82rem;font-weight:700;color:var(--ta-text-muted);white-space:nowrap}',
		'.ta-status-item strong{min-width:0;font-size:.92rem;line-height:1.3;color:var(--ta-text-strong);text-align:right;word-break:break-word}',
		'.ta-summary-grid,.ta-focus-grid,.ta-engine-grid{display:grid;gap:14px}',
		'.ta-summary-grid{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}',
		'.ta-focus-grid{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}',
		'.ta-engine-grid{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}',
		'.ta-stat-card{display:flex;flex-direction:column;gap:10px;padding:18px;min-height:182px}',
		'.ta-stat-card.is-primary{border-color:rgba(37,99,235,.22)}',
		'.ta-stat-card.is-good{border-color:rgba(13,148,136,.24)}',
		'.ta-stat-card.is-warning{border-color:rgba(245,158,11,.24)}',
		'.ta-stat-card.is-accent{border-color:rgba(124,58,237,.24)}',
		'.ta-stat-title{font-size:.82rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ta-text-muted)}',
		'.ta-stat-value{font-size:1.34rem;font-weight:800;line-height:1.25;color:var(--ta-text-strong)}',
		'.ta-stat-detail{margin-top:auto;font-size:.88rem;line-height:1.55;color:var(--ta-text-muted)}',
		'.ta-insight-card{display:flex;flex-direction:column;gap:12px;padding:18px}',
		'.ta-insight-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
		'.ta-insight-title{font-size:1rem;font-weight:800;color:var(--ta-text-strong)}',
		'.ta-insight-value{font-size:1rem;font-weight:800;color:var(--ta-text)}',
		'.ta-insight-detail{font-size:.9rem;line-height:1.6;color:var(--ta-text-muted)}',
		'.ta-kv-list{display:grid;gap:10px}',
		'.ta-kv-row{display:grid;grid-template-columns:minmax(112px,42%) 1fr;gap:10px;padding:10px 12px;border-radius:14px;background:var(--ta-info-bg);border:1px solid var(--ta-panel-border-soft)}',
		'.ta-kv-label{font-size:.84rem;color:var(--ta-text-muted);line-height:1.45}',
		'.ta-kv-value{font-size:.9rem;line-height:1.45;color:var(--ta-text-strong);text-align:right;word-break:break-word}',
		'.ta-panel{padding:18px}',
		'.ta-panel-head{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}',
		'.ta-panel-title{font-size:1rem;font-weight:800;color:var(--ta-text-strong)}',
		'.ta-panel-subtitle{font-size:.88rem;line-height:1.55;color:var(--ta-text-muted)}',
		'.ta-engine-card{display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:18px;background:var(--ta-info-bg);border:1px solid var(--ta-panel-border-soft)}',
		'.ta-engine-card.is-selected{border-color:rgba(37,99,235,.25);background:rgba(37,99,235,.06)}',
		'.ta-engine-card.is-live{border-color:rgba(13,148,136,.26);background:rgba(13,148,136,.08)}',
		'.ta-engine-top{display:flex;align-items:center;gap:12px}',
		'.ta-engine-code{display:inline-flex;align-items:center;justify-content:center;min-width:48px;height:34px;padding:0 10px;border-radius:12px;background:var(--ta-hero-badge);color:#fff;font-size:.78rem;font-weight:800;letter-spacing:.06em}',
		'.ta-engine-name{font-size:.96rem;font-weight:800;color:var(--ta-text-strong)}',
		'.ta-engine-detail{font-size:.88rem;line-height:1.55;color:var(--ta-text-muted)}',
		'.ta-telemetry-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.9fr);gap:14px}',
		'.ta-side-stack{display:grid;gap:14px}',
		'.ta-note-card{padding:16px}',
		'.ta-note-title{font-size:.92rem;font-weight:800;color:var(--ta-text-strong);margin-bottom:10px}',
		'.ta-note-list{margin:0;padding-left:18px;display:grid;gap:8px;color:var(--ta-text);line-height:1.55}',
		'.ta-note-card.is-healthy{border-color:rgba(13,148,136,.24)}',
		'.ta-note-card.is-attention{border-color:rgba(245,158,11,.24)}',
		'.ta-note-card.is-warning{border-color:rgba(239,68,68,.24)}',
		'.ta-info-grid{display:grid;gap:10px}',
		'.ta-info-row{display:grid;grid-template-columns:minmax(120px,42%) 1fr;gap:12px;align-items:start;padding:11px 12px;border-radius:14px;background:var(--ta-info-bg);border:1px solid var(--ta-panel-border-soft)}',
		'.ta-info-label{font-size:.84rem;color:var(--ta-text-muted);line-height:1.45}',
		'.ta-info-value{display:flex;align-items:flex-start;justify-content:flex-end;gap:8px;font-size:.9rem;color:var(--ta-text-strong);font-weight:700;line-height:1.45;text-align:right;word-break:break-word}',
		'.ta-info-value .ta-chip-list{justify-content:flex-end}',
		'.ta-capability-grid{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}',
		'.ta-ppe-panel .ta-panel-head{margin-bottom:16px}',
		'.ta-progress-list{display:grid;gap:12px}',
		'.ta-progress-row{display:grid;gap:8px}',
		'.ta-progress-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
		'.ta-progress-label{font-size:.9rem;font-weight:700;color:var(--ta-text-strong)}',
		'.ta-progress-value{font-size:.84rem;color:var(--ta-text-muted);white-space:nowrap}',
		'.ta-progress-track{height:10px;border-radius:999px;background:rgba(148,163,184,.18);overflow:hidden}',
		'.ta-progress-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#16a34a,#22c55e);box-shadow:0 0 12px rgba(34,197,94,.36)}',
		'.ta-config-shell>.cbi-map{margin:0;background:transparent;border:none;box-shadow:none;padding:18px}',
		'.ta-config-shell .cbi-section{margin-top:0}',
		'.ta-config-shell h2{margin:0 0 8px;color:var(--ta-text-strong)}',
		'.ta-config-shell .cbi-map-descr{margin:0 0 16px;color:var(--ta-text-muted);line-height:1.6}',
		'.ta-config-shell .cbi-tabmenu{margin:0 0 14px;padding:0;border-bottom:none;display:flex;flex-wrap:wrap;gap:8px}',
		'.ta-config-shell .cbi-tabmenu li{display:inline-flex;align-items:stretch;margin:0;float:none;border:1px solid var(--ta-panel-border-soft);border-radius:12px !important;background:var(--ta-button-bg);box-shadow:none !important;overflow:hidden;transition:background-color .18s ease,color .18s ease,border-color .18s ease}',
		'.ta-config-shell .cbi-tabmenu li a{display:inline-flex;align-items:center;min-height:40px;padding:8px 15px;border:none !important;border-radius:0 !important;background:none !important;color:var(--ta-chip) !important;-webkit-text-fill-color:var(--ta-chip);box-shadow:none !important;transition:background-color .18s ease,color .18s ease,border-color .18s ease}',
		'.ta-config-shell .cbi-tabmenu li.cbi-tab,.ta-config-shell .cbi-tabmenu li.active{background:var(--ta-button-primary) !important;border-color:transparent !important;box-shadow:var(--ta-button-shadow) !important}',
		'.ta-config-shell .cbi-tabmenu li.cbi-tab a,.ta-config-shell .cbi-tabmenu li.active a{color:#fff !important;-webkit-text-fill-color:#fff !important}',
		'.ta-config-shell .cbi-tab-descr,.ta-config-shell .cbi-section-descr,.ta-config-shell .cbi-value-description{color:var(--ta-text-muted) !important;-webkit-text-fill-color:var(--ta-text-muted);opacity:1}',
		'.ta-config-shell label,.ta-config-shell .cbi-value-title,.ta-config-shell .cbi-section-node{color:var(--ta-text)}',
		'.ta-config-shell input[type="text"],.ta-config-shell input:not([type]),.ta-config-shell select,.ta-config-shell textarea,.ta-config-shell .cbi-dropdown{min-height:40px;box-sizing:border-box;border-radius:12px !important;background:var(--ta-button-bg) !important;border:1px solid var(--ta-panel-border) !important;color:var(--ta-text) !important;-webkit-text-fill-color:var(--ta-text);box-shadow:0 0 0 1px rgba(255,255,255,.02) inset !important}',
		'.ta-config-shell .cbi-dropdown > ul:not(.dropdown),.ta-config-shell .cbi-dropdown ul.preview{background:var(--ta-button-bg) !important;border-radius:12px !important}',
		'.ta-config-shell .cbi-page-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:flex-start;margin:16px 0 0;padding:14px 16px;border:1px solid var(--ta-panel-border);border-radius:18px;background:var(--ta-bg);box-shadow:inset 0 1px 0 rgba(255,255,255,.14)}',
		'.ta-config-shell .cbi-page-actions>*{margin:0 !important;float:none !important}',
		'.ta-config-shell .cbi-page-actions .cbi-button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 18px;border-radius:12px !important;border:1px solid var(--ta-panel-border-soft) !important;background:var(--ta-button-bg) !important;color:var(--ta-text) !important;box-shadow:none !important;transition:transform .16s ease,filter .16s ease}',
		'.ta-config-shell .cbi-page-actions .cbi-button:hover{transform:translateY(-1px);filter:brightness(1.02)}',
		'.ta-config-shell .cbi-page-actions .cbi-button-apply,.ta-config-shell .cbi-page-actions .cbi-button-save{border-color:transparent !important;background:var(--ta-button-primary) !important;color:#fff !important;box-shadow:var(--ta-button-shadow) !important}',
		'.ta-config-shell .cbi-page-actions .cbi-button-reset{background:rgba(148,163,184,.12) !important;color:var(--ta-text-muted) !important}',
		'@media (max-width:1040px){.ta-hero{grid-template-columns:1fr}.ta-telemetry-grid{grid-template-columns:1fr}.ta-status-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.ta-compact-grid{grid-template-columns:1fr}}',
		'@media (max-width:760px){.ta-hero{padding:18px}.ta-hero-main{flex-direction:column}.ta-hero-badge{width:76px;height:76px;border-radius:24px}.ta-status-strip{grid-template-columns:1fr}.ta-status-item{align-items:flex-start;flex-direction:column}.ta-status-item strong{text-align:left}.ta-kv-row,.ta-info-row{grid-template-columns:1fr}.ta-kv-value,.ta-info-value,.ta-info-value .ta-chip-list{text-align:left;justify-content:flex-start}.ta-progress-head{flex-direction:column;align-items:flex-start}.ta-progress-value{white-space:normal}.ta-compact-hero-top{flex-direction:column;align-items:flex-start}.ta-compact-state{width:100%;justify-content:flex-start}.ta-config-shell>.cbi-map{padding:16px}.ta-config-shell .cbi-page-actions .cbi-button{width:100%;justify-content:center}}'
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
		var features = data[1] || {};
		var service = data[2] || [];
		var ppeStats = data[3] || {};
		var overviewRoot = E('div', { 'class': 'ta-overview-root' });
		var page = applyThemeClass(E('div', { 'class': 'ta-page' }, [
			renderStyle(),
			overviewRoot
		]), 'ta-dark');
		var map = buildForm(features, getConfigState(features));

		function refreshOverview(nextService, nextPpe) {
			dom.content(overviewRoot, renderOverviewContent({
				features: features,
				config: getConfigState(features),
				service: nextService,
				ppe: getPPESummary(nextPpe || {})
			}));
		}

		refreshOverview(service, ppeStats);

		return map.render().then(function(mapNode) {
			page.appendChild(E('div', { 'class': 'ta-config-shell' }, [ mapNode ]));

			poll.add(function() {
				return Promise.all([
					L.resolveDefault(getServiceStatus(), []),
					L.resolveDefault(getMTKPPEStatus(), {})
				]).then(function(nextData) {
					refreshOverview(nextData[0], nextData[1]);
				});
			}, 3);

			return page;
		});
	}
});

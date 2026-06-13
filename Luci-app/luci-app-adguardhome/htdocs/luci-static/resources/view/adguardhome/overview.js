'use strict';
'require view';
'require rpc';
'require poll';

var callGetStatus = rpc.declare({ object: 'luci.adguardhome', method: 'getStatus', expect: { '': {} } });
var callGetStats = rpc.declare({ object: 'luci.adguardhome', method: 'getStats', expect: { '': {} } });

function t(message) {
	return _(message);
}

function actionError(err, fallback) {
	var message = err && (err.message || err.toString && err.toString()) || '';
	if (/Object not found/i.test(message))
		return t('The luci.adguardhome rpcd object is not available. Reinstall this package or restart rpcd, then refresh LuCI.');
	if (/Method not found/i.test(message))
		return t('The rpcd backend is outdated and does not provide this view data. Reinstall this package or restart rpcd, then refresh LuCI.');
	return fallback + (message ? ': ' + message : '');
}

function safeCall(promise, fallback) {
	return promise.catch(function(err) {
		return Object.assign({ _rpc_error: err }, fallback || {});
	});
}

function yes(value) {
	return value === true || value === 1 || value === '1';
}

function text(value, fallback) {
	value = value == null ? '' : String(value);
	return value || fallback || '-';
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

var style = [
	'.agh-page{display:grid;gap:18px;color:var(--agh-text,var(--text-color-high,#203042));--agh-text:var(--text-color-high,#203042);--agh-text-high:var(--text-color-high,#17373c);--agh-text-muted:var(--text-color-medium,#667084);--agh-border:rgba(76,108,157,.12);--agh-card-bg:rgba(249,252,255,.98);--agh-card-shadow:0 12px 30px rgba(25,50,87,.09);--agh-alert-bg:#fff4df;--agh-alert-fg:#805718;--agh-path-bg:linear-gradient(180deg,rgba(255,255,255,.98) 0%,rgba(239,245,255,.99) 100%);--agh-path-code:var(--text-color-high,#17373c);--agh-chip-bg:rgba(255,255,255,.16);--agh-chip-border:rgba(255,255,255,.18);--agh-hero-bg:linear-gradient(135deg,#294a7a 0%,#3d679f 52%,#6f93cc 100%);--agh-hero-shadow:0 20px 42px rgba(25,50,87,.18);--agh-compat-text:#eef5fd;--agh-compat-muted:rgba(247,251,248,.72);--agh-compat-pop-bg:linear-gradient(180deg,rgba(244,248,255,.98) 0%,rgba(237,244,255,.96) 100%);--agh-compat-pop-border:rgba(84,119,176,.16);--agh-compat-pop-shadow:0 16px 34px rgba(31,55,92,.16),inset 0 1px 0 rgba(255,255,255,.6);--agh-compat-pill-bg:rgba(255,255,255,.78);--agh-compat-pill-border:rgba(84,119,176,.12);--agh-compat-pill-strong:#355989}',
	'.agh-page.agh-dark,body.dark .agh-page,html.dark .agh-page,body.mode-dark .agh-page,body.argon-dark .agh-page,html[data-theme="dark"] .agh-page,body[data-theme="dark"] .agh-page{--agh-text:#e7eef7;--agh-text-high:#eef5fd;--agh-text-muted:#a8b7c7;--agh-border:rgba(124,147,186,.22);--agh-card-bg:rgba(16,24,38,.96);--agh-card-shadow:0 14px 32px rgba(0,0,0,.24);--agh-alert-bg:rgba(92,68,24,.32);--agh-alert-fg:#f5d28a;--agh-path-bg:linear-gradient(180deg,rgba(17,27,43,.92) 0%,rgba(10,17,29,.98) 100%);--agh-path-code:#eef5fd;--agh-chip-bg:rgba(255,255,255,.10);--agh-chip-border:rgba(255,255,255,.14);--agh-hero-bg:linear-gradient(135deg,#0c1424 0%,#15253d 52%,#234267 100%);--agh-hero-shadow:0 22px 44px rgba(0,0,0,.3);--agh-compat-text:#eef5fd;--agh-compat-muted:rgba(231,238,247,.74);--agh-compat-pop-bg:linear-gradient(180deg,rgba(17,27,43,.98) 0%,rgba(12,20,35,.96) 100%);--agh-compat-pop-border:rgba(124,147,186,.22);--agh-compat-pop-shadow:0 16px 34px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.03);--agh-compat-pill-bg:rgba(255,255,255,.08);--agh-compat-pill-border:rgba(124,147,186,.18);--agh-compat-pill-strong:#eef5fd}',
	'.agh-shell{position:relative;overflow:hidden;border-radius:24px;background:var(--agh-hero-bg);box-shadow:var(--agh-hero-shadow)}',
	'.agh-shell:before{content:"";position:absolute;right:-90px;top:-100px;width:300px;height:300px;border-radius:999px;background:radial-gradient(circle,rgba(160,196,255,.26),rgba(160,196,255,0) 70%)}',
	'.agh-shell:after{content:"";position:absolute;left:-110px;bottom:-140px;width:340px;height:340px;border-radius:999px;background:radial-gradient(circle,rgba(214,230,255,.20),rgba(214,230,255,0) 70%)}',
	'.agh-hero{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr);gap:18px;padding:26px;color:#f7fbf8}',
	'.agh-hero-main{display:grid;align-content:start;gap:14px}',
	'.agh-hero-topline{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
	'.agh-eyebrow{display:inline-flex;align-items:center;width:max-content;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.13);font-size:12px;letter-spacing:.08em;text-transform:uppercase}',
	'.agh-title{all:unset;display:block!important;margin:14px 0 10px!important;font-size:30px!important;line-height:1.16!important;font-weight:700!important;color:#fff!important;background:transparent!important;border:0!important;box-shadow:none!important}',
	'.agh-copy{max-width:68rem;margin:0;color:rgba(247,251,248,.86);font-size:14px;line-height:1.75}',
	'.agh-actions{display:flex;flex-wrap:wrap;gap:10px}',
	'.agh-hero-link{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 16px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.12);color:#fff!important;-webkit-text-fill-color:#fff!important;text-decoration:none!important;box-shadow:none!important;text-shadow:none!important;font-weight:600;transition:background .2s ease,border-color .2s ease,transform .2s ease,box-shadow .2s ease}',
	'.agh-hero-link:hover,.agh-hero-link:focus{color:#fff!important;-webkit-text-fill-color:#fff!important;transform:translateY(-1px);box-shadow:0 10px 24px rgba(10,21,38,.18)}',
	'.agh-hero-link-panel{background:linear-gradient(135deg,#1f9a5b 0%,#36b46f 100%);border-color:rgba(162,245,196,.42)}',
	'.agh-hero-link-panel:hover,.agh-hero-link-panel:focus{background:linear-gradient(135deg,#23aa63 0%,#3cc97b 100%);border-color:rgba(189,255,215,.58)}',
	'.agh-hero-link-settings{background:linear-gradient(135deg,#bd4659 0%,#d65d6d 100%);border-color:rgba(255,188,196,.42)}',
	'.agh-hero-link-settings:hover,.agh-hero-link-settings:focus{background:linear-gradient(135deg,#cc4e62 0%,#e46d7c 100%);border-color:rgba(255,208,214,.58)}',
	'.agh-hero-link-log{background:linear-gradient(135deg,#5b6675 0%,#707b8c 100%);border-color:rgba(223,230,238,.32)}',
	'.agh-hero-link-log:hover,.agh-hero-link-log:focus{background:linear-gradient(135deg,#667284 0%,#7d899a 100%);border-color:rgba(235,241,248,.46)}',
	'.agh-quick{display:grid;gap:10px;align-content:start}',
	'.agh-chip{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:16px;background:var(--agh-chip-bg);border:1px solid var(--agh-chip-border);color:#fff}',
	'.agh-chip span{color:rgba(247,251,248,.72);font-size:12px}.agh-chip strong{font-size:15px}',
	'.agh-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}',
	'.agh-card{padding:18px;border-radius:20px;background:var(--agh-card-bg);border:1px solid var(--agh-border);box-shadow:var(--agh-card-shadow)}',
	'.agh-label{font-size:12px;line-height:1.5;color:var(--agh-text-muted)}.agh-value{margin-top:10px;font-size:24px;line-height:1.15;font-weight:700;color:var(--agh-text-high);word-break:break-word}',
	'.agh-ok{color:#1c8b58}.agh-warn{color:#b27716}.agh-bad{color:#c94d5c}',
	'.agh-alert{padding:16px 18px;border-radius:18px;background:var(--agh-alert-bg);border:1px solid rgba(178,119,22,.2);color:var(--agh-alert-fg);box-shadow:0 10px 26px rgba(178,119,22,.08);line-height:1.7}',
	'.agh-alert-compat{position:relative;display:inline-flex;align-items:center;max-width:100%}',
	'.agh-alert-head{display:inline-flex;align-items:center;gap:0;max-width:100%;min-height:30px;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.13);box-shadow:none;cursor:help;user-select:none;color:var(--agh-compat-text);backdrop-filter:saturate(140%) blur(2px)}',
	'.agh-alert-head:hover,.agh-alert-head:focus-within{background:rgba(255,255,255,.17)}',
	'.agh-alert-title{font-size:12px;font-weight:700;line-height:1.4;letter-spacing:.08em;text-transform:uppercase;color:var(--agh-compat-text);white-space:nowrap}',
	'.agh-alert-copy{margin:0;font-size:12px;line-height:1.65;color:var(--agh-text-muted)}',
	'.agh-alert-meta{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}',
	'.agh-alert-pill{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:0 10px;border-radius:999px;background:var(--agh-compat-pill-bg);border:1px solid var(--agh-compat-pill-border);color:var(--agh-text-high)}',
	'.agh-alert-pill span{font-size:11px;color:var(--agh-text-muted)}',
	'.agh-alert-pill strong{font-size:12px;font-weight:700;color:var(--agh-compat-pill-strong)}',
	'.agh-alert-pop{position:absolute;left:0;top:calc(100% + 8px);z-index:8;display:grid;gap:10px;min-width:min(560px,calc(100vw - 32px));max-width:620px;padding:14px 16px;border-radius:16px;background:var(--agh-compat-pop-bg);border:1px solid var(--agh-compat-pop-border);box-shadow:var(--agh-compat-pop-shadow);opacity:0;visibility:hidden;transform:translateY(-4px);transition:opacity .18s ease,transform .18s ease,visibility .18s ease;pointer-events:none}',
	'.agh-alert-compat:hover .agh-alert-pop,.agh-alert-compat:focus-within .agh-alert-pop{opacity:1;visibility:visible;transform:translateY(0);pointer-events:auto}',
	'.agh-paths{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.agh-path{padding:14px;border-radius:16px;background:var(--agh-path-bg);border:1px solid var(--agh-border);min-width:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}.agh-path span{display:block;font-size:12px;color:var(--agh-text-muted)!important}.agh-path code{display:block;margin-top:8px;padding:0;background:transparent!important;border:0!important;border-radius:0!important;white-space:normal;word-break:break-all;color:var(--agh-path-code)!important;-webkit-text-fill-color:var(--agh-path-code)!important;box-shadow:none!important;text-shadow:none!important}',
	'@media(max-width:1080px){.agh-hero,.agh-grid,.agh-paths{grid-template-columns:1fr 1fr}.agh-quick{grid-column:1/-1}}',
	'@media(max-width:720px){.agh-hero,.agh-grid,.agh-paths{grid-template-columns:1fr}.agh-hero{padding:20px}.agh-title{font-size:24px!important}.agh-alert-pop{min-width:min(420px,calc(100vw - 32px))}}'
].join('\n');

function card(label, value, cls) {
	return E('div', { 'class': 'agh-card' }, [ E('div', { 'class': 'agh-label' }, label), E('div', { 'class': 'agh-value ' + (cls || '') }, value) ]);
}

function pathItem(label, value) {
	return E('div', { 'class': 'agh-path' }, [ E('span', {}, label), E('code', {}, text(value, '-')) ]);
}

function redirectModeLabel(value) {
	switch (value) {
	case 'dnsmasq-upstream':
		return t('Use as dnsmasq upstream');
	case 'redirect':
		return t('Redirect port 53');
	case 'exchange':
		return t('Swap with dnsmasq port');
	case 'none':
	case '':
	case null:
	case undefined:
		return t('None');
	default:
		return t('Unknown');
	}
}

function effectiveRedirectMode(status) {
	if (status && status.effective_redirect)
		return status.effective_redirect;

	return status ? status.redirect : '';
}

function redirectConflictMessage(status) {
	if (!yes(status && status.redirect_conflict))
		return '';

	if (status.redirect_conflict_reason === 'passwall2-dns-redirect')
		return t('PassWall2 DNS redirect is active. AdGuard Home switched to dnsmasq upstream mode to avoid conflicts on port 53.');

	return t('PassWall DNS redirect is active. AdGuard Home switched to dnsmasq upstream mode to avoid conflicts on port 53.');
}

function renderRedirectCompatAlert(status) {
	if (!yes(status && status.redirect_compat))
		return null;

	var upstream = text(status.redirect_compat_upstream, '');
	var vendor = status.redirect_compat_reason === 'passwall2-dns-redirect' ? 'PassWall2' : 'PassWall';
	var title = vendor === 'PassWall2'
		? t('PassWall2 Compatibility Mode')
		: t('PassWall Compatibility Mode');
	var summary = vendor === 'PassWall2'
		? t('AdGuard Home keeps handling LAN DNS on port 53 and forwards unmatched queries to the PassWall2 DNS frontend.')
		: t('AdGuard Home keeps handling LAN DNS on port 53 and forwards unmatched queries to the PassWall DNS frontend.');

	return E('div', { 'class': 'agh-alert-compat' }, [
		E('div', { 'class': 'agh-alert-head', 'tabindex': '0', 'title': summary }, [
			E('strong', { 'class': 'agh-alert-title' }, title)
		]),
		E('div', { 'class': 'agh-alert-pop' }, [
			E('p', { 'class': 'agh-alert-copy' }, summary),
			E('div', { 'class': 'agh-alert-meta' }, [
				E('div', { 'class': 'agh-alert-pill' }, [
					E('span', {}, t('DNS Frontend')),
					E('strong', {}, vendor)
				]),
				upstream ? E('div', { 'class': 'agh-alert-pill' }, [
					E('span', {}, t('Frontend Port')),
					E('strong', {}, upstream)
				]) : ''
			])
		])
	]);
}

function formatHost(hostname) {
	hostname = hostname == null ? '' : String(hostname);
	return hostname.indexOf(':') >= 0 && hostname.charAt(0) !== '[' ? '[' + hostname + ']' : hostname;
}

function panelUrl(status) {
	var current = typeof window !== 'undefined' ? window.location : null;
	var hostname = current && current.hostname ? current.hostname : '';
	var port = text(status && status.httpport, '3000');
	var scheme = port === '443' ? 'https://' : 'http://';

	if (!hostname)
		return '#';

	if ((scheme === 'http://' && port === '80') || (scheme === 'https://' && port === '443'))
		return scheme + formatHost(hostname);

	return scheme + formatHost(hostname) + ':' + port;
}

function heroLink(label, href, extraClass, newTab) {
	var attrs = { 'class': 'agh-hero-link' + (extraClass ? ' ' + extraClass : ''), 'href': href || '#' };

	if (newTab) {
		attrs.target = '_blank';
		attrs.rel = 'noopener noreferrer';
	}

	return E('a', attrs, label);
}

return view.extend({
	load: function() {
		return Promise.all([
			safeCall(callGetStatus(), {}),
			safeCall(callGetStats(), { ok: false, num_dns_queries: 0, num_blocked_filtering: 0, avg_processing_time: '0' })
		]);
	},
	render: function(data) {
		var status = data[0] || {};
		var stats = data[1] || {};
		var root = applyThemeClass(E('div', { 'class': 'agh-page' }), 'agh-dark');
		var rpcError = status._rpc_error;
		var statsOk = stats.ok === true || stats.ok === 1 || stats.ok === '1';
		var state = yes(status.running) ? t('Running') : t('Stopped');
		var stateClass = yes(status.running) ? 'agh-ok' : 'agh-bad';
		var settingsUrl = L.url('admin', 'services', 'adguardhome', 'settings');
		var logUrl = L.url('admin', 'services', 'adguardhome', 'log');

		root.appendChild(E('style', {}, style));
		if (rpcError)
			root.appendChild(E('section', { 'class': 'agh-alert' }, actionError(rpcError, t('Overview data unavailable'))));
		if (!rpcError && yes(status.redirect_conflict))
			root.appendChild(E('section', { 'class': 'agh-alert' }, redirectConflictMessage(status)));
		root.appendChild(E('section', { 'class': 'agh-shell' }, E('div', { 'class': 'agh-hero' }, [
			E('div', { 'class': 'agh-hero-main' }, [
				E('div', { 'class': 'agh-hero-topline' }, [
					E('span', { 'class': 'agh-eyebrow' }, t('Network DNS Guard')),
					(!rpcError && yes(status.redirect_compat)) ? renderRedirectCompatAlert(status) : ''
				]),
				E('h2', { 'class': 'agh-title' }, 'AdGuard Home'),
				E('div', { 'class': 'agh-actions' }, [
					heroLink(t('Control Panel'), panelUrl(status), 'agh-hero-link-panel', true),
					heroLink(t('Open Settings'), settingsUrl, 'agh-hero-link-settings'),
					heroLink(t('View Logs'), logUrl, 'agh-hero-link-log')
				])
			]),
			E('div', { 'class': 'agh-quick' }, [
				E('div', { 'class': 'agh-chip agh-service-chip' }, [ E('span', {}, t('Service')), E('strong', { 'class': rpcError ? 'agh-bad' : stateClass }, rpcError ? t('Backend missing') : state) ]),
				E('div', { 'class': 'agh-chip' }, [ E('span', {}, t('Core')), E('strong', { 'class': yes(status.core_ready) ? 'agh-ok' : 'agh-warn' }, yes(status.core_ready) ? text(status.version) : t('Missing')) ]),
				E('div', { 'class': 'agh-chip' }, [ E('span', {}, t('DNS Port')), E('strong', {}, text(status.dns_port, rpcError ? '?' : '-')) ]),
				E('div', { 'class': 'agh-chip agh-redirect-chip' }, [ E('span', {}, t('Running Mode')), E('strong', { 'class': yes(status.redirected) ? 'agh-ok' : '' }, redirectModeLabel(effectiveRedirectMode(status))) ])
			])
		])));
		root.appendChild(E('section', { 'class': 'agh-grid' }, [
			card(t('Web Console'), text(status.httpport, '3000'), 'agh-ok'),
			card(t('Config File'), yes(status.config_ready) ? t('Ready') : t('Missing'), yes(status.config_ready) ? 'agh-ok' : 'agh-warn'),
			card(t('Workspace'), yes(status.workdir_ready) ? t('Ready') : t('Missing'), yes(status.workdir_ready) ? 'agh-ok' : 'agh-warn'),
			card(t('Update Task'), yes(status.update_running) ? t('Running') : t('Idle'), yes(status.update_running) ? 'agh-warn' : 'agh-ok')
		]));

		var statsSectionRef = null;
		var queriesEl = null;
		var blockedEl = null;
		var ratioEl = null;
		var avgTimeEl = null;

		if (statsOk) {
			var numQueries = stats.num_dns_queries != null ? String(stats.num_dns_queries) : '0';
			var numBlocked = stats.num_blocked_filtering != null ? String(stats.num_blocked_filtering) : '0';
			var queriesInt = parseInt(stats.num_dns_queries, 10) || 0;
			var blockedInt = parseInt(stats.num_blocked_filtering, 10) || 0;
			var blockedPct = queriesInt > 0 ? ((blockedInt / queriesInt) * 100).toFixed(1) : '0.0';
			var avgTime = text(stats.avg_processing_time, '0');

			var qCard = card(t('DNS Queries'), numQueries, 'agh-ok');
			var bCard = card(t('Blocked'), numBlocked, 'agh-bad');
			var rCard = card(t('Blocked Ratio'), blockedPct + '%', blockedInt > 0 ? 'agh-bad' : 'agh-ok');
			var aCard = card(t('Avg. Processing'), avgTime + ' ms', '');

			statsSectionRef = E('section', { 'class': 'agh-grid agh-stats-grid' });
			statsSectionRef.appendChild(qCard);
			statsSectionRef.appendChild(bCard);
			statsSectionRef.appendChild(rCard);
			statsSectionRef.appendChild(aCard);
			root.appendChild(statsSectionRef);

			queriesEl = qCard.querySelector('.agh-value');
			blockedEl = bCard.querySelector('.agh-value');
			ratioEl = rCard.querySelector('.agh-value');
			avgTimeEl = aCard.querySelector('.agh-value');
		} else if (yes(status.running)) {
			var statsErr = stats.error || '';
			var statsMsg = t('DNS statistics unavailable. AdGuard Home API may require authentication from localhost.');
			if (statsErr)
				statsMsg = statsErr;
			root.appendChild(E('section', { 'class': 'agh-alert agh-stats-error' }, statsMsg));
		}

		root.appendChild(E('section', { 'class': 'agh-card' }, [
			E('div', { 'class': 'agh-paths' }, [
				pathItem(t('Core Binary'), status.binpath),
				pathItem(t('YAML Config'), status.configpath),
				pathItem(t('Work Directory'), status.workdir)
			])
		]));

		function refreshStatusChips(s) {
			var serviceChip = root.querySelector('.agh-service-chip strong');
			var redirectChip = root.querySelector('.agh-redirect-chip strong');
			if (serviceChip) {
				var isRun = yes(s.running);
				serviceChip.textContent = isRun ? t('Running') : t('Stopped');
				serviceChip.className = isRun ? 'agh-ok' : 'agh-bad';
			}
			if (redirectChip) {
				var isRedir = yes(s.redirected);
				redirectChip.textContent = redirectModeLabel(effectiveRedirectMode(s));
				redirectChip.className = isRedir ? 'agh-ok' : '';
			}
		}

		function updateStatsCards(s) {
			if (!statsSectionRef) return;
			if (s._rpc_error || s.ok !== true) {
				var errEl = root.querySelector('.agh-stats-error');
				if (!errEl) {
					errEl = E('section', { 'class': 'agh-alert agh-stats-error' }, s.error || t('DNS statistics fetch failed.'));
					statsSectionRef.parentNode && statsSectionRef.parentNode.insertBefore(errEl, statsSectionRef);
					statsSectionRef.style.display = 'none';
				}
				return;
			}
			var errEl = root.querySelector('.agh-stats-error');
			if (errEl && statsSectionRef.style.display === 'none') {
				statsSectionRef.style.display = '';
				errEl.parentNode && errEl.parentNode.removeChild(errEl);
			}
			var nq = s.num_dns_queries != null ? String(s.num_dns_queries) : '0';
			var nb = s.num_blocked_filtering != null ? String(s.num_blocked_filtering) : '0';
			var qi = parseInt(s.num_dns_queries, 10) || 0;
			var bi = parseInt(s.num_blocked_filtering, 10) || 0;
			var pct = qi > 0 ? ((bi / qi) * 100).toFixed(1) : '0.0';
			var at = text(s.avg_processing_time, '0');
			if (queriesEl) queriesEl.textContent = nq;
			if (blockedEl) blockedEl.textContent = nb;
			if (ratioEl) ratioEl.textContent = pct + '%';
			if (avgTimeEl) avgTimeEl.textContent = at + ' ms';
		}

		function startPoll() {
			poll.add(function() {
				return safeCall(callGetStatus(), {}).then(function(s) {
					refreshStatusChips(s);
				});
			}, 5);
			poll.add(function() {
				return safeCall(callGetStats(), { ok: false }).then(function(s) {
					updateStatsCards(s);
				});
			}, 10);
		}

		if (typeof poll !== 'undefined' && poll.add)
			startPoll();

		return root;
	}
	,
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});

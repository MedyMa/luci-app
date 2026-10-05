'use strict';
'require view';
'require adguardhome.ui as aghui';
'require rpc';
'require poll';

var callGetStatus = rpc.declare({ object: 'luci.adguardhome', method: 'getStatus', expect: { '': {} } });
var callGetStats = rpc.declare({ object: 'luci.adguardhome', method: 'getStats', expect: { '': {} } });

function hasChineseLocale() {
	var htmlLang = document.documentElement ? (document.documentElement.lang || '') : '';
	var bodyClass = document.body ? (document.body.className || '') : '';
	return /^zh(?:-|_|$)/i.test(htmlLang) || /\blang_zh(?:[-_][^\s]+)?\b/i.test(bodyClass);
}

function t(message, fallback) {
	var translated = _(message);
	return translated !== message || !fallback || !hasChineseLocale() ? translated : fallback;
}

function actionError(err, fallback) {
	var message = err && (err.message || err.toString && err.toString()) || '';
	if (/Object not found/i.test(message))
		return t('The luci.adguardhome rpcd object is missing. Reinstall this package or restart rpcd, then refresh LuCI.');
	if (/Method not found/i.test(message))
		return t('The rpcd backend is outdated and lacks this view data. Reinstall this package or restart rpcd, then refresh LuCI.');
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

	node._aghTeardown = function() {
		if (themeObserver) {
			themeObserver.disconnect();
			themeObserver = null;
		}
		if (mediaQuery) {
			if (mediaQuery.removeEventListener)
				mediaQuery.removeEventListener('change', syncThemeClass);
			else if (mediaQuery.removeListener)
				mediaQuery.removeListener(syncThemeClass);
			mediaQuery = null;
		}
		if (typeof window !== 'undefined') {
			window.removeEventListener('pageshow', syncThemeClass);
			window.removeEventListener('focus', syncThemeClass);
		}
	};

	return node;
}

var style = aghui.style;

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
		return t('PassWall2 DNS redirect is active; AdGuard Home keeps intercepting and adds compatibility bypass rules.', 'PassWall2 已开启 DNS 重定向；AdGuard Home 保持拦截并加兼容旁路规则。');

	return t('PassWall DNS redirect is active; AdGuard Home keeps intercepting and adds compatibility bypass rules.', 'PassWall 已开启 DNS 重定向；AdGuard Home 保持拦截并加兼容旁路规则。');
}

function renderRedirectCompatAlert(status) {
	if (!yes(status && status.redirect_compat))
		return null;

	var upstream = text(status.redirect_compat_upstream, '');
	var vendor = status.redirect_compat_reason === 'passwall2-dns-redirect' ? 'PassWall2' : 'PassWall';
	var title = vendor === 'PassWall2'
		? t('PassWall2 Compatibility Mode', 'PassWall2 兼容模式')
		: t('PassWall Compatibility Mode', 'PassWall 兼容模式');
	var autoUpstream = yes(status.passwall_upstream_auto);
	var summary = vendor === 'PassWall2'
		? (autoUpstream
			? t('AdGuard Home intercepts LAN DNS, bypassing the PassWall2 redirect chain; one managed upstream is kept when the frontend port is known.', 'AdGuard Home 拦截局域网 DNS、绕过 PassWall2 重定向链；已知前端端口时维护一条托管上游。')
			: t('AdGuard Home intercepts LAN DNS, bypassing the PassWall2 redirect chain; upstream DNS is left untouched.', 'AdGuard Home 拦截局域网 DNS、绕过 PassWall2 重定向链；上游 DNS 不自动修改。'))
		: (autoUpstream
			? t('AdGuard Home intercepts LAN DNS, bypassing the PassWall redirect chain; one managed upstream is kept when the frontend port is known.', 'AdGuard Home 拦截局域网 DNS、绕过 PassWall 重定向链；已知前端端口时维护一条托管上游。')
			: t('AdGuard Home intercepts LAN DNS, bypassing the PassWall redirect chain; upstream DNS is left untouched.', 'AdGuard Home 拦截局域网 DNS、绕过 PassWall 重定向链；上游 DNS 不自动修改。'));

	return E('details', { 'class': 'agh-alert-compat' }, [
		E('summary', { 'class': 'agh-alert-head', 'title': summary }, [
			E('strong', { 'class': 'agh-alert-title' }, title)
		]),
		E('div', { 'class': 'agh-alert-pop' }, [
			E('p', { 'class': 'agh-alert-copy' }, summary),
			E('div', { 'class': 'agh-alert-meta' }, [
				E('div', { 'class': 'agh-alert-pill' }, [
					E('span', {}, t('DNS Frontend', 'DNS 前端')),
					E('strong', {}, vendor)
				]),
				upstream ? E('div', { 'class': 'agh-alert-pill' }, [
					E('span', {}, t('Frontend Port', '前端端口')),
					E('strong', {}, upstream)
				]) : '',
				autoUpstream && upstream ? E('div', { 'class': 'agh-alert-pill' }, [
					E('span', {}, t('Managed Upstream', '托管上游')),
					E('strong', {}, '127.0.0.1:' + upstream)
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
	// Module-level lifecycle state — survives across render() calls
	_aghPollHandles: [],
	_aghThemeRoot: null,
	_aghCleanupRegistered: false,
	_aghOnPageHide: function() { this._aghStopAll(); },
	_aghOnBeforeUnload: function() { this._aghStopAll(); },
	_aghBoundPageHide: null,
	_aghBoundBeforeUnload: null,

	_aghStopPoll: function() {
		var h;
		while (this._aghPollHandles.length) {
			h = this._aghPollHandles.pop();
			if (h != null && typeof poll !== 'undefined' && poll.remove) {
				try { poll.remove(h); } catch(e) { /* already removed by LuCI nav */ }
			}
		}
	},
	_aghStopTheme: function() {
		if (this._aghThemeRoot && this._aghThemeRoot._aghTeardown) {
			this._aghThemeRoot._aghTeardown();
			this._aghThemeRoot = null;
		}
	},
	_aghStopAll: function() {
		this._aghStopPoll();
		this._aghStopTheme();
		if (typeof window !== 'undefined') {
			if (this._aghBoundPageHide) {
				window.removeEventListener('pagehide', this._aghBoundPageHide);
				this._aghBoundPageHide = null;
			}
			if (this._aghBoundBeforeUnload) {
				window.removeEventListener('beforeunload', this._aghBoundBeforeUnload);
				this._aghBoundBeforeUnload = null;
			}
		}
		this._aghCleanupRegistered = false;
	},
	_aghEnsureCleanup: function() {
		if (this._aghCleanupRegistered) return;
		this._aghCleanupRegistered = true;
		if (typeof window !== 'undefined') {
			this._aghBoundPageHide = this._aghOnPageHide.bind(this);
			this._aghBoundBeforeUnload = this._aghOnBeforeUnload.bind(this);
			window.addEventListener('pagehide', this._aghBoundPageHide);
			window.addEventListener('beforeunload', this._aghBoundBeforeUnload);
		}
	},

	load: function() {
		return Promise.all([
			safeCall(callGetStatus(), {}),
			safeCall(callGetStats(), { ok: false, num_dns_queries: 0, num_blocked_filtering: 0, avg_processing_time: '0' })
		]);
	},
	render: function(data) {
		var status = data[0] || {};
		var stats = data[1] || {};
		this._aghStopAll();
		var root = applyThemeClass(E('div', { 'class': 'agh-page agh-ui' }), 'agh-dark');
		this._aghThemeRoot = root;
		this._aghEnsureCleanup();
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
		root.appendChild(aghui.header('overview', panelUrl(status)));
		root.appendChild(E('section', { 'class': 'agh-statusbar' }, [
			E('div', {}, [
				E('span', { 'class': 'agh-service-chip' }, E('strong', { 'class': 'agh-state ' + (rpcError ? 'agh-bad' : stateClass) }, rpcError ? t('Backend missing') : state)),
				E('span', { 'class': 'agh-core-chip' }, t('Core') + ' · ' + (yes(status.core_ready) ? text(status.version) : t('Missing')))
			]),
			E('a', { 'class': 'btn', href: settingsUrl }, t('Open Settings'))
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

		function infoRow(label, value, cls) {
			return E('div', { 'class': 'agh-info-row' }, [E('span', {}, label), E('strong', { 'class': cls || '' }, value)]);
		}
		root.appendChild(E('section', { 'class': 'agh-card' }, [
			E('h3', { 'class': 'agh-section-title' }, t('DNS Access', 'DNS 接入')),
			E('div', { 'class': 'agh-info' }, [
				E('div', { 'class': 'agh-redirect-chip agh-info-row' }, [E('span', {}, t('Running Mode')), E('strong', {}, redirectModeLabel(effectiveRedirectMode(status)))]),
				infoRow(t('DNS Port'), text(status.dns_port, rpcError ? '?' : '-')),
				infoRow(t('Web Console'), text(status.httpport, '3000')),
				infoRow(t('Update Task'), yes(status.update_running) ? t('Running') : t('Idle'), yes(status.update_running) ? 'agh-warn' : ''),
				infoRow(t('Config File'), yes(status.config_ready) ? t('Ready') : t('Missing'), yes(status.config_ready) ? 'agh-ok' : 'agh-warn'),
				infoRow(t('Workspace'), yes(status.workdir_ready) ? t('Ready') : t('Missing'), yes(status.workdir_ready) ? 'agh-ok' : 'agh-warn')
			]),
			(!rpcError && yes(status.redirect_compat)) ? renderRedirectCompatAlert(status) : ''
		]));
		root.appendChild(E('details', { 'class': 'agh-card' }, [
			E('summary', {}, t('Configuration paths', '配置路径')),
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
				serviceChip.className = 'agh-state ' + (isRun ? 'agh-ok' : 'agh-bad');
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

		var _pollHandles = this._aghPollHandles;
		var _view = this;

		function startPoll() {
			_view._aghStopPoll();
			_pollHandles.length = 0;
			if (typeof poll !== 'undefined' && poll.add) {
				_pollHandles.push(poll.add(function() {
					return safeCall(callGetStatus(), {}).then(function(s) {
						refreshStatusChips(s);
					});
				}, 5));
				_pollHandles.push(poll.add(function() {
					return safeCall(callGetStats(), { ok: false }).then(function(s) {
						updateStatsCards(s);
					});
				}, 10));
			}
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

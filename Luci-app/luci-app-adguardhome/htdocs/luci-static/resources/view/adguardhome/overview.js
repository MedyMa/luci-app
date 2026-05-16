'use strict';
'require view';
'require rpc';
'require poll';

var callGetStatus = rpc.declare({ object: 'luci.adguardhome', method: 'getStatus', expect: { '': {} } });

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
		return t('The luci.adguardhome rpcd object is not available. Reinstall this package or restart rpcd, then refresh LuCI.', '当前设备没有导出 luci.adguardhome rpcd 后端对象。请重新安装当前软件包或重启 rpcd，然后刷新 LuCI。');
	if (/Method not found/i.test(message))
		return t('The rpcd backend is outdated and does not provide this view data. Reinstall this package or restart rpcd, then refresh LuCI.', '当前设备上的 rpcd 后端版本过旧，未提供此页面所需数据。请重新安装当前软件包或重启 rpcd，然后刷新 LuCI。');
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
	'.agh-page{display:grid;gap:18px;color:var(--agh-text,var(--text-color-high,#203042));--agh-text:var(--text-color-high,#203042);--agh-text-high:var(--text-color-high,#17373c);--agh-text-muted:var(--text-color-medium,#667084);--agh-border:rgba(76,108,157,.12);--agh-card-bg:rgba(249,252,255,.98);--agh-card-shadow:0 12px 30px rgba(25,50,87,.09);--agh-alert-bg:#fff4df;--agh-alert-fg:#805718;--agh-path-bg:linear-gradient(180deg,rgba(255,255,255,.98) 0%,rgba(239,245,255,.99) 100%);--agh-path-code:var(--text-color-high,#17373c);--agh-chip-bg:rgba(255,255,255,.16);--agh-chip-border:rgba(255,255,255,.18);--agh-hero-bg:linear-gradient(135deg,#294a7a 0%,#3d679f 52%,#6f93cc 100%);--agh-hero-shadow:0 20px 42px rgba(25,50,87,.18)}',
	'.agh-page.agh-dark,body.dark .agh-page,html.dark .agh-page,body.mode-dark .agh-page,body.argon-dark .agh-page,html[data-theme="dark"] .agh-page,body[data-theme="dark"] .agh-page{--agh-text:#e7eef7;--agh-text-high:#eef5fd;--agh-text-muted:#a8b7c7;--agh-border:rgba(124,147,186,.22);--agh-card-bg:rgba(16,24,38,.96);--agh-card-shadow:0 14px 32px rgba(0,0,0,.24);--agh-alert-bg:rgba(92,68,24,.32);--agh-alert-fg:#f5d28a;--agh-path-bg:linear-gradient(180deg,rgba(17,27,43,.92) 0%,rgba(10,17,29,.98) 100%);--agh-path-code:#eef5fd;--agh-chip-bg:rgba(255,255,255,.10);--agh-chip-border:rgba(255,255,255,.14);--agh-hero-bg:linear-gradient(135deg,#0c1424 0%,#15253d 52%,#234267 100%);--agh-hero-shadow:0 22px 44px rgba(0,0,0,.3)}',
	'.agh-shell{position:relative;overflow:hidden;border-radius:24px;background:var(--agh-hero-bg);box-shadow:var(--agh-hero-shadow)}',
	'.agh-shell:before{content:"";position:absolute;right:-90px;top:-100px;width:300px;height:300px;border-radius:999px;background:radial-gradient(circle,rgba(160,196,255,.26),rgba(160,196,255,0) 70%)}',
	'.agh-shell:after{content:"";position:absolute;left:-110px;bottom:-140px;width:340px;height:340px;border-radius:999px;background:radial-gradient(circle,rgba(214,230,255,.20),rgba(214,230,255,0) 70%)}',
	'.agh-hero{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr);gap:18px;padding:26px;color:#f7fbf8}',
	'.agh-eyebrow{display:inline-flex;align-items:center;width:max-content;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.13);font-size:12px;letter-spacing:.08em;text-transform:uppercase}',
	'.agh-title{all:unset;display:block!important;margin:14px 0 10px!important;font-size:30px!important;line-height:1.16!important;font-weight:700!important;color:#fff!important;background:transparent!important;border:0!important;box-shadow:none!important}',
	'.agh-copy{max-width:68rem;margin:0;color:rgba(247,251,248,.86);font-size:14px;line-height:1.75}',
	'.agh-quick{display:grid;gap:10px;align-content:start}',
	'.agh-chip{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:16px;background:var(--agh-chip-bg);border:1px solid var(--agh-chip-border);color:#fff}',
	'.agh-chip span{color:rgba(247,251,248,.72);font-size:12px}.agh-chip strong{font-size:15px}',
	'.agh-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}',
	'.agh-card{padding:18px;border-radius:20px;background:var(--agh-card-bg);border:1px solid var(--agh-border);box-shadow:var(--agh-card-shadow)}',
	'.agh-label{font-size:12px;line-height:1.5;color:var(--agh-text-muted)}.agh-value{margin-top:10px;font-size:24px;line-height:1.15;font-weight:700;color:var(--agh-text-high);word-break:break-word}',
	'.agh-ok{color:#1c8b58}.agh-warn{color:#b27716}.agh-bad{color:#c94d5c}',
	'.agh-alert{padding:16px 18px;border-radius:18px;background:var(--agh-alert-bg);border:1px solid rgba(178,119,22,.2);color:var(--agh-alert-fg);box-shadow:0 10px 26px rgba(178,119,22,.08);line-height:1.7}',
	'.agh-paths{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.agh-path{padding:14px;border-radius:16px;background:var(--agh-path-bg);border:1px solid var(--agh-border);min-width:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}.agh-path span{display:block;font-size:12px;color:var(--agh-text-muted)!important}.agh-path code{display:block;margin-top:8px;padding:0;background:transparent!important;border:0!important;border-radius:0!important;white-space:normal;word-break:break-all;color:var(--agh-path-code)!important;-webkit-text-fill-color:var(--agh-path-code)!important;box-shadow:none!important;text-shadow:none!important}',
	'@media(max-width:1080px){.agh-hero,.agh-grid,.agh-paths{grid-template-columns:1fr 1fr}.agh-quick{grid-column:1/-1}}',
	'@media(max-width:720px){.agh-hero,.agh-grid,.agh-paths{grid-template-columns:1fr}.agh-hero{padding:20px}.agh-title{font-size:24px!important}}'
].join('\n');

function card(label, value, cls) {
	return E('div', { 'class': 'agh-card' }, [ E('div', { 'class': 'agh-label' }, label), E('div', { 'class': 'agh-value ' + (cls || '') }, value) ]);
}

function pathItem(label, value) {
	return E('div', { 'class': 'agh-path' }, [ E('span', {}, label), E('code', {}, text(value, '-')) ]);
}

return view.extend({
	load: function() {
		return safeCall(callGetStatus(), {});
	},
	render: function(status) {
		var root = applyThemeClass(E('div', { 'class': 'agh-page' }), 'agh-dark');
		var rpcError = status._rpc_error;
		var state = yes(status.running) ? t('Running', '运行中') : t('Stopped', '未运行');
		var stateClass = yes(status.running) ? 'agh-ok' : 'agh-bad';

		root.appendChild(E('style', {}, style));
		if (rpcError)
			root.appendChild(E('section', { 'class': 'agh-alert' }, actionError(rpcError, t('Overview data unavailable', '概览数据不可用'))));
		root.appendChild(E('section', { 'class': 'agh-shell' }, E('div', { 'class': 'agh-hero' }, [
			E('div', {}, [
				E('span', { 'class': 'agh-eyebrow' }, t('Network DNS Guard', '网络 DNS 防护')),
				E('h2', { 'class': 'agh-title' }, 'AdGuard Home'),
				E('p', { 'class': 'agh-copy' }, t('Modern LuCI dashboard for service state, DNS redirect, core update readiness and runtime path health. Designed for OpenWrt 24.10/25.12 and Argon theme.', '面向 OpenWrt 24.10/25.12 与 Argon 主题重新构建的现代 LuCI 状态页，集中展示服务状态、DNS 重定向、核心更新就绪情况以及运行目录健康度。'))
			]),
			E('div', { 'class': 'agh-quick' }, [
				E('div', { 'class': 'agh-chip' }, [ E('span', {}, t('Service', '服务')), E('strong', { 'class': rpcError ? 'agh-bad' : stateClass }, rpcError ? t('Backend missing', '后端缺失') : state) ]),
				E('div', { 'class': 'agh-chip' }, [ E('span', {}, t('Core', '核心')), E('strong', { 'class': yes(status.core_ready) ? 'agh-ok' : 'agh-warn' }, yes(status.core_ready) ? text(status.version) : t('Missing', '缺失')) ]),
				E('div', { 'class': 'agh-chip' }, [ E('span', {}, t('DNS Port', 'DNS 端口')), E('strong', {}, text(status.dns_port, rpcError ? '?' : '-')) ]),
				E('div', { 'class': 'agh-chip' }, [ E('span', {}, t('Redirect', '重定向')), E('strong', { 'class': yes(status.redirected) ? 'agh-ok' : '' }, yes(status.redirected) ? t('Active', '已启用') : text(status.redirect, 'none')) ])
			])
		])));

		root.appendChild(E('section', { 'class': 'agh-grid' }, [
			card(t('Web Console', 'Web 控制台'), text(status.httpport, '3000'), 'agh-ok'),
			card(t('Config File', '配置文件'), yes(status.config_ready) ? t('Ready', '就绪') : t('Missing', '缺失'), yes(status.config_ready) ? 'agh-ok' : 'agh-warn'),
			card(t('Workspace', '工作区'), yes(status.workdir_ready) ? t('Ready', '就绪') : t('Missing', '缺失'), yes(status.workdir_ready) ? 'agh-ok' : 'agh-warn'),
			card(t('Update Task', '更新任务'), yes(status.update_running) ? t('Running', '运行中') : t('Idle', '空闲'), yes(status.update_running) ? 'agh-warn' : 'agh-ok')
		]));

		root.appendChild(E('section', { 'class': 'agh-card' }, [
			E('div', { 'class': 'agh-paths' }, [
				pathItem(t('Core Binary', '核心文件'), status.binpath),
				pathItem(t('YAML Config', 'YAML 配置'), status.configpath),
				pathItem(t('Work Directory', '工作目录'), status.workdir)
			])
		]));

		return root;
	}
	,
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});

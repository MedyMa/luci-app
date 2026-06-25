'use strict';
'require view';
'require form';
'require rpc';
'require uci';

var callGetStatus = rpc.declare({ object: 'luci.adguardhome', method: 'getStatus', expect: { '': {} } });
var callGetMeta = rpc.declare({ object: 'luci.adguardhome', method: 'getMeta', expect: { '': {} } });
var callSetLinks = rpc.declare({ object: 'luci.adguardhome', method: 'setLinks', params: [ 'content', 'channel', 'download_arch' ], expect: { '': {} } });
var callStartUpdate = rpc.declare({ object: 'luci.adguardhome', method: 'startUpdate', params: [ 'force' ], expect: { '': {} } });
var callGfwAction = rpc.declare({ object: 'luci.adguardhome', method: 'gfwAction', params: [ 'action' ], expect: { '': {} } });

var ACTION_MUTATES_GFW_YAML = {
	ipset_add: true,
	ipset_del: true
};

function hasChineseLocale() {
	var htmlLang = document.documentElement ? (document.documentElement.lang || '') : '';
	var bodyClass = document.body ? (document.body.className || '') : '';
	return /^zh(?:-|_|$)/i.test(htmlLang) || /\blang_zh(?:[-_][^\s]+)?\b/i.test(bodyClass);
}

function t(message, fallback) {
	var translated = _(message);
	return translated !== message || !fallback || !hasChineseLocale() ? translated : fallback;
}

function normalizeChannel(value) {
	return [ 'release', 'beta', 'github', 'custom' ].indexOf(value) >= 0 ? value : 'release';
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

function buildLinks(channel) {
	switch (normalizeChannel(channel)) {
	case 'beta':
		return '# Beta channel\nhttps://static.adguard.com/adguardhome/beta/AdGuardHome_linux_${Arch}.tar.gz\n# Stable fallback\nhttps://static.adguard.com/adguardhome/release/AdGuardHome_linux_${Arch}.tar.gz\n# GitHub fallback\nhttps://github.com/AdguardTeam/AdGuardHome/releases/download/${latest_ver}/AdGuardHome_linux_${Arch}.tar.gz';
	case 'github':
		return '# GitHub release channel\nhttps://github.com/AdguardTeam/AdGuardHome/releases/download/${latest_ver}/AdGuardHome_linux_${Arch}.tar.gz\n# Stable fallback\nhttps://static.adguard.com/adguardhome/release/AdGuardHome_linux_${Arch}.tar.gz';
	default:
		return '# Stable channel\nhttps://static.adguard.com/adguardhome/release/AdGuardHome_linux_${Arch}.tar.gz\n# GitHub fallback\nhttps://github.com/AdguardTeam/AdGuardHome/releases/download/${latest_ver}/AdGuardHome_linux_${Arch}.tar.gz\n# Beta channel\n#https://static.adguard.com/adguardhome/beta/AdGuardHome_linux_${Arch}.tar.gz';
	}
}

function actionError(err, fallback) {
	var message = err && (err.message || err.toString && err.toString()) || '';
	var knownErrors = [
		[/Failed to download a non-empty GFW list from all known mirrors\./i, t('Unable to download a usable GFW list from any known mirror. Check the router network or DNS connectivity to jsDelivr and GitHub Raw, then try again.', '无法从已知镜像下载可用的 GFW 列表。请检查路由器到 jsDelivr 和 GitHub Raw 的联网或 DNS 连通性后重试。')],
		[/Failed to generate a non-empty GFW rule file\./i, t('The downloaded GFW list did not produce any usable upstream DNS rules. Try generating the rule file again later or check the source content.', '下载到的 GFW 列表没有生成任何可用的上游 DNS 规则。请稍后重试生成，或检查上游列表内容。')],
		[/Please generate the GFW rule file first\./i, t('Generate the GFW rule file first, then copy entries manually in the AdGuard Home console if needed.', '请先生成 GFW 规则文件；如有需要，请在 AdGuard Home 控制台手动复制条目。')],
		[/The GFW rule file is empty\./i, t('The current GFW rule file only contains headers and no usable DNS rules. Regenerate the rule file before copying entries manually.', '当前 GFW 规则文件只有表头，没有可用的 DNS 规则。请先重新生成规则文件，再手动复制条目。')]
	];
	var i;
	if (/Object not found/i.test(message))
		return t('The luci.adguardhome rpcd object is not available. Reinstall this package or restart rpcd, then refresh LuCI.', '当前设备没有导出 luci.adguardhome rpcd 后端对象。请重新安装当前软件包或重启 rpcd，然后刷新 LuCI。');
	if (/Method not found/i.test(message))
		return t('The rpcd backend is outdated and does not provide this action. Reinstall this package or restart rpcd, then refresh LuCI.', '当前设备上的 rpcd 后端版本过旧，未提供此操作。请重新安装当前软件包或重启 rpcd，然后刷新 LuCI。');
	for (i = 0; i < knownErrors.length; i++)
		if (knownErrors[i][0].test(message))
			return knownErrors[i][1];
	return fallback + (message ? ': ' + message : '');
}

function safeCall(promise, fallback) {
	return promise.catch(function(err) {
		return Object.assign({ _rpc_error: err }, fallback || {});
	});
}

function setBusy(button, busy) {
	button.disabled = !!busy;
	button.classList.toggle('spinning', !!busy);
}

function createStatusBox(message) {
	return E('div', { 'class': 'agh-status' }, message || t('Ready.', '就绪。'));
}

function actionHeader(label, title) {
	return E('div', { 'class': 'agh-action-head' }, [
		E('span', { 'class': 'agh-action-badge' }, label),
		E('h3', {}, title)
	]);
}

function runRpcAction(button, statusBox, call, success, fallback) {
	setBusy(button, true);
	return call().then(function(res) {
		if (res && res.ok === false)
			throw new Error(res.error || fallback);
		statusBox.textContent = success;
	}).catch(function(err) {
		statusBox.textContent = actionError(err, fallback);
	}).finally(function() {
		setBusy(button, false);
	});
}

function ensureScript(src, id) {
	if (document.getElementById(id))
		return Promise.resolve();
	return new Promise(function(resolve, reject) {
		var script = document.createElement('script');
		script.id = id;
		script.src = src;
		script.onload = resolve;
		script.onerror = reject;
		document.head.appendChild(script);
	});
}

function ensureBcrypt() {
	return ensureScript(L.resource('twin-bcrypt.min.js'), 'agh-bcrypt-script');
}

function softButtonClass(extraClass) {
	return 'btn cbi-button agh-soft-btn' + (extraClass ? ' ' + extraClass : '');
}


var style = [
	'.agh-settings{display:grid;gap:18px;color:var(--agh-text,var(--text-color-high,#203042));--agh-text:var(--text-color-high,#203042);--agh-text-high:var(--text-color-high,#17373c);--agh-text-muted:var(--text-color-medium,#667084);--agh-text-soft:#60708a;--agh-border:rgba(76,108,157,.14);--agh-border-soft:rgba(76,108,157,.08);--agh-card-bg:rgba(249,252,255,.98);--agh-card-grad:linear-gradient(180deg,rgba(255,255,255,.99) 0%,rgba(240,246,255,.99) 100%);--agh-surface-bg:rgba(232,240,251,.92);--agh-chip-bg:rgba(255,255,255,.97);--agh-chip-border:rgba(76,108,157,.14);--agh-chip-shadow:0 8px 24px rgba(25,50,87,.08);--agh-status-bg:rgba(232,240,251,.94);--agh-input-bg:rgba(255,255,255,.97);--agh-input-border:rgba(76,108,157,.18);--agh-tabmenu-bg:rgba(232,240,251,.94);--agh-tab-text:#4d617d;--agh-tab-active-text:var(--agh-text-high,#17373c);--agh-tab-active-bg:rgba(255,255,255,.98);--agh-badge-bg:rgba(61,103,159,.12);--agh-badge-fg:#315d9a;--agh-button-shadow:none;--agh-inline-btn-bg:rgba(61,103,159,.10);--agh-inline-btn-bg-hover:rgba(61,103,159,.16);--agh-inline-btn-border:rgba(61,103,159,.20);--agh-inline-btn-fg:#315d9a;--agh-hero-bg:linear-gradient(135deg,#294a7a 0%,#3d679f 54%,#6f93cc 100%);--agh-hero-shadow:0 18px 38px rgba(25,50,87,.16);--agh-form-shell-bg:rgba(255,255,255,.88);--agh-form-shell-border:rgba(76,108,157,.14);--agh-form-row-bg:rgba(255,255,255,.56);--agh-form-row-hover:rgba(245,249,255,.96);--agh-desc-bg:rgba(232,240,251,.72);--agh-page-actions-bg:rgba(249,252,255,.88);--agh-page-actions-border:rgba(76,108,157,.16);--agh-page-actions-shadow:0 -8px 26px rgba(17,48,54,.10);--agh-checkbox-bg:rgba(255,255,255,.96);--agh-checkbox-border:rgba(76,108,157,.24);--agh-checkbox-active-bg:linear-gradient(135deg,#4f6fb6 0%,#6887cf 100%);--agh-checkbox-active-border:#6b8ed6}',
	'.agh-settings.agh-dark,body.dark .agh-settings,html.dark .agh-settings,body.mode-dark .agh-settings,body.argon-dark .agh-settings,html[data-theme="dark"] .agh-settings,body[data-theme="dark"] .agh-settings{--agh-text:#e7eef7;--agh-text-high:#f2f7ff;--agh-text-muted:#b9c8d8;--agh-text-soft:#c7d4e2;--agh-border:rgba(124,147,186,.24);--agh-border-soft:rgba(124,147,186,.16);--agh-card-bg:rgba(16,24,38,.96);--agh-card-grad:linear-gradient(180deg,rgba(18,28,44,.96) 0%,rgba(10,17,29,.98) 100%);--agh-surface-bg:rgba(9,15,27,.84);--agh-chip-bg:rgba(17,26,40,.94);--agh-chip-border:rgba(124,147,186,.18);--agh-chip-shadow:0 10px 26px rgba(0,0,0,.24);--agh-status-bg:rgba(9,15,27,.88);--agh-input-bg:rgba(8,14,24,.94);--agh-input-border:rgba(124,147,186,.22);--agh-tabmenu-bg:rgba(9,15,27,.88);--agh-tab-text:#d4dfeb;--agh-tab-active-text:#f2f7ff;--agh-tab-active-bg:rgba(23,35,52,.96);--agh-badge-bg:rgba(104,146,214,.18);--agh-badge-fg:#a9c6f3;--agh-inline-btn-bg:rgba(104,146,214,.16);--agh-inline-btn-bg-hover:rgba(104,146,214,.24);--agh-inline-btn-border:rgba(104,146,214,.28);--agh-inline-btn-fg:#c1d7f7;--agh-hero-bg:linear-gradient(135deg,#0c1424 0%,#15253d 54%,#234267 100%);--agh-hero-shadow:0 20px 40px rgba(0,0,0,.28);--agh-form-shell-bg:rgba(7,12,22,.82);--agh-form-shell-border:rgba(124,147,186,.20);--agh-form-row-bg:rgba(12,19,31,.42);--agh-form-row-hover:rgba(18,28,43,.80);--agh-desc-bg:rgba(12,19,31,.78);--agh-page-actions-bg:rgba(8,14,24,.86);--agh-page-actions-border:rgba(124,147,186,.20);--agh-page-actions-shadow:0 -12px 30px rgba(0,0,0,.30);--agh-checkbox-bg:rgba(14,22,35,.96);--agh-checkbox-border:rgba(124,147,186,.30);--agh-checkbox-active-bg:linear-gradient(135deg,#4966b2 0%,#6480d0 100%);--agh-checkbox-active-border:#7c97d1}',
	'.agh-settings{--agh-ok-fg:#169f98;--agh-ok-glow:0 0 14px rgba(22,159,152,.18);--agh-live-fg:#1d8b5b;--agh-live-glow:0 0 14px rgba(29,139,91,.16)}',
	'.agh-settings.agh-dark,body.dark .agh-settings,html.dark .agh-settings,body.mode-dark .agh-settings,body.argon-dark .agh-settings,html[data-theme="dark"] .agh-settings,body[data-theme="dark"] .agh-settings{--agh-ok-fg:#7de9df;--agh-ok-glow:0 0 18px rgba(125,233,223,.26);--agh-live-fg:#59d18f;--agh-live-glow:0 0 18px rgba(89,209,143,.24)}',
	'.agh-hero{position:relative;overflow:hidden;border-radius:22px;padding:26px;color:#f7fbf8;background:var(--agh-hero-bg);box-shadow:var(--agh-hero-shadow)}',
	'.agh-hero h2{all:unset;display:block!important;margin:0 0 10px!important;font-size:28px!important;line-height:1.18!important;font-weight:700!important;color:#fff!important;background:transparent!important;border:0!important;box-shadow:none!important}',
	'.agh-hero p{max-width:72rem;margin:0;color:rgba(247,251,248,.86);font-size:14px;line-height:1.75}',
	'.agh-status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.agh-chip{padding:14px;border-radius:16px;background:var(--agh-chip-bg);border:1px solid var(--agh-chip-border);box-shadow:var(--agh-chip-shadow);min-width:0}.agh-chip span{display:block;font-size:12px;color:var(--agh-text-muted)}.agh-chip strong{display:block;margin-top:6px;font-size:18px;line-height:1.2;color:var(--agh-text-high);word-break:break-word}.agh-chip.agh-ok strong,.agh-chip strong.agh-ok{color:var(--agh-ok-fg)!important;-webkit-text-fill-color:var(--agh-ok-fg)!important;text-shadow:var(--agh-ok-glow)!important}.agh-chip.agh-live strong,.agh-chip strong.agh-live{color:var(--agh-live-fg)!important;-webkit-text-fill-color:var(--agh-live-fg)!important;text-shadow:var(--agh-live-glow)!important}.agh-chip.agh-warn strong,.agh-chip strong.agh-warn{color:#ad7417!important;-webkit-text-fill-color:#ad7417!important}.agh-chip.agh-bad strong,.agh-chip strong.agh-bad{color:#c94d5c!important;-webkit-text-fill-color:#c94d5c!important}',
	'.agh-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}',
	'.agh-action{position:relative;display:grid;align-content:start;gap:12px;padding:18px;border-radius:18px;background:linear-gradient(180deg,var(--agh-action-bg-start,var(--agh-card-bg)) 0%,var(--agh-action-bg-end,var(--agh-surface-bg)) 100%);border:1px solid var(--agh-border);box-shadow:0 10px 28px rgba(17,48,54,.07);min-width:0;overflow:hidden}',
	'.agh-action:before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:var(--agh-accent,#1f6a5d)}',
	'.agh-action-head{display:grid;gap:8px;padding-bottom:2px}',
	'.agh-action-badge{display:inline-flex;align-items:center;width:max-content;padding:5px 10px;border-radius:999px;background:var(--agh-action-badge-bg,var(--agh-badge-bg));color:var(--agh-action-badge-fg,var(--agh-badge-fg))!important;-webkit-text-fill-color:var(--agh-action-badge-fg,var(--agh-badge-fg))!important;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;text-shadow:none!important;opacity:1!important}',
	'.agh-action h3{all:unset;display:block;font-size:17px;line-height:1.35;font-weight:700;color:var(--agh-text-high)!important;-webkit-text-fill-color:var(--agh-text-high)!important;text-shadow:none!important;opacity:1!important}',
	'.agh-action p{margin:0;color:var(--agh-text)!important;-webkit-text-fill-color:var(--agh-text)!important;line-height:1.7;font-size:13px;text-shadow:none!important;opacity:1!important}',
    '.agh-action textarea{width:100%;min-height:150px;border-radius:16px;border:1px solid var(--agh-input-border)!important;background:var(--agh-input-bg)!important;color:var(--agh-text-high)!important;-webkit-text-fill-color:var(--agh-text-high)!important;text-shadow:none!important;caret-color:var(--agh-text-high)!important;font-family:monospace;font-size:14px;line-height:1.6;font-weight:500;opacity:1!important;box-sizing:border-box;resize:vertical}.agh-action-links textarea{min-height:176px}',
	'.agh-action textarea::placeholder,.agh-action input::placeholder{color:var(--agh-text-muted)!important;opacity:1!important}',
	'.agh-action-update{--agh-accent:#2f6fb0;--agh-action-bg-start:var(--agh-card-bg);--agh-action-bg-end:rgba(47,111,176,.08);--agh-action-badge-bg:rgba(47,111,176,.12);--agh-action-badge-fg:#2b5f96}',
	'.agh-action-links{--agh-accent:#3b82c4;--agh-action-bg-start:var(--agh-card-bg);--agh-action-bg-end:rgba(59,130,196,.08);--agh-action-badge-bg:rgba(59,130,196,.12);--agh-action-badge-fg:#316ea5}',
	'.agh-action-password{--agh-accent:#5b78c7;--agh-action-bg-start:var(--agh-card-bg);--agh-action-bg-end:rgba(91,120,199,.08);--agh-action-badge-bg:rgba(91,120,199,.12);--agh-action-badge-fg:#4860ab}',
	'.agh-action-gfw{--agh-accent:#5874b0;--agh-action-bg-start:var(--agh-card-bg);--agh-action-bg-end:rgba(88,116,176,.08);--agh-action-badge-bg:rgba(88,116,176,.12);--agh-action-badge-fg:#486396}',
	'.agh-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.agh-row .btn{border-radius:12px;box-shadow:var(--agh-button-shadow)}',
	'.agh-button-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px}',
	'.agh-soft-btn{display:inline-flex!important;align-items:center;justify-content:center;min-height:40px;padding:9px 14px!important;border-radius:12px!important;border:1px solid var(--agh-inline-btn-border)!important;background:var(--agh-inline-btn-bg)!important;color:var(--agh-inline-btn-fg)!important;box-shadow:none!important;text-decoration:none!important;font-weight:600;line-height:1.4;transition:background-color .18s ease,border-color .18s ease,color .18s ease,transform .18s ease}',
	'.agh-soft-btn:hover:not([disabled]),.agh-soft-btn:focus-visible:not([disabled]){background:var(--agh-inline-btn-bg-hover)!important;border-color:var(--agh-inline-btn-fg)!important;color:var(--agh-inline-btn-fg)!important;transform:translateY(-1px)}',
	'.agh-soft-btn[disabled],.agh-soft-btn.spinning{opacity:.6;color:var(--agh-text-muted)!important;background:var(--agh-surface-bg)!important;border-color:var(--agh-border)!important;transform:none;cursor:not-allowed}',
	'.agh-row select,.agh-row input{max-width:100%;min-height:34px;border:1px solid var(--agh-input-border)!important;border-radius:16px!important;background:var(--agh-input-bg)!important;color:var(--agh-text-high)!important;-webkit-text-fill-color:var(--agh-text-high)!important;text-shadow:none!important;opacity:1!important}',
	'.agh-status{margin-top:12px;padding:12px 14px;border:1px solid var(--agh-border-soft);border-radius:16px;background:var(--agh-status-bg);color:var(--agh-text-soft);font-size:12px;line-height:1.6}',
	'.agh-settings .cbi-map{border-radius:22px;border:1px solid var(--agh-border);box-shadow:0 12px 30px rgba(17,48,54,.08);overflow:visible;background:var(--agh-card-grad)}',
	'.agh-settings .cbi-map>h2,.agh-settings .cbi-map>.cbi-map-descr{display:none}',
	'.agh-settings .cbi-section{margin:0;padding:0 16px 18px;border:0;box-shadow:none;background:transparent}.agh-settings .cbi-section>h3{margin:0;padding:20px 22px 0;color:var(--agh-text-high)!important;font-size:24px;line-height:1.2}.agh-settings .cbi-section>.cbi-section-descr{margin:10px 22px 0;padding:12px 14px;border:1px solid var(--agh-border-soft);border-radius:16px;background:var(--agh-desc-bg);color:var(--agh-text-soft)!important;-webkit-text-fill-color:var(--agh-text-soft)!important;opacity:1!important;line-height:1.7}.agh-settings .cbi-section-node{margin-top:18px;padding-top:0;background:var(--agh-form-shell-bg);border:1px solid var(--agh-form-shell-border);border-radius:20px;overflow:hidden;box-shadow:0 14px 30px rgba(17,48,54,.08)}',
	'.agh-settings .cbi-tabmenu{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:0;padding:16px 18px 0;border-bottom:1px solid var(--agh-border-soft);background:var(--agh-tabmenu-bg)}.agh-settings .cbi-tab,.agh-settings .cbi-tab-disabled{margin:0;padding:0;border-radius:0;background:transparent;border:0}.agh-settings .cbi-tab>a,.agh-settings .cbi-tab-disabled>a{display:block;padding:10px 14px;border-radius:16px;color:var(--agh-tab-text)!important;background:transparent!important;text-shadow:none!important;font-weight:650;line-height:1.35;transition:background-color .18s ease,color .18s ease,box-shadow .18s ease}.agh-settings .cbi-tab>a:hover,.agh-settings .cbi-tab>a:focus-visible{background:var(--agh-surface-bg)!important;color:var(--agh-text-high)!important}.agh-settings .cbi-tab-disabled>a{opacity:.55}.agh-settings .cbi-tab-active,.agh-settings .cbi-tab-active>a{background:transparent!important}.agh-settings .cbi-tab-active>a{background:var(--agh-tab-active-bg)!important;color:var(--agh-tab-active-text)!important;box-shadow:0 10px 22px rgba(11,18,31,.18)}.agh-settings .cbi-tabcontainer{padding:12px 0 0;background:transparent}.agh-settings .cbi-tab-descr{margin:0 22px 14px;padding:12px 14px;border:1px solid var(--agh-border-soft);border-radius:16px;background:var(--agh-desc-bg);color:var(--agh-text-soft)!important;-webkit-text-fill-color:var(--agh-text-soft)!important;font-size:13px;line-height:1.7;text-shadow:none!important;opacity:1!important}',
	'.agh-settings .cbi-value{display:grid;grid-template-columns:minmax(220px,280px) minmax(0,1fr);column-gap:22px;row-gap:12px;align-items:start;justify-items:stretch;padding:18px 22px;border-top:1px solid var(--agh-border-soft);background:var(--agh-form-row-bg);transition:background-color .18s ease,border-color .18s ease}.agh-settings .cbi-value:first-child{border-top:0}.agh-settings .cbi-value:hover{background:var(--agh-form-row-hover)}.agh-settings .cbi-value-title,.agh-settings label.cbi-value-title{display:block;grid-column:1;align-self:start;justify-self:stretch;width:100%!important;min-width:0!important;max-width:100%!important;box-sizing:border-box;margin:0;color:var(--agh-text-high)!important;-webkit-text-fill-color:var(--agh-text-high)!important;font-weight:700;line-height:1.55;text-shadow:none!important;opacity:1!important;overflow-wrap:anywhere;word-break:break-word}.agh-settings .cbi-value-field{grid-column:2;min-width:0;max-width:100%;width:100%;color:var(--agh-text)!important}.agh-settings .cbi-value-field,.agh-settings .cbi-value-field span,.agh-settings .cbi-value-field .hide-open,.agh-settings .cbi-value-field .hide-close{color:var(--agh-text)!important;-webkit-text-fill-color:var(--agh-text)!important;text-shadow:none!important;opacity:1!important}.agh-settings .cbi-value-description,.agh-settings .cbi-value-field .cbi-value-description{max-width:62rem;margin-top:10px;padding:12px 14px;border-radius:16px;border:1px solid var(--agh-border-soft);background:var(--agh-desc-bg);color:var(--agh-text-soft)!important;-webkit-text-fill-color:var(--agh-text-soft)!important;font-size:13px;line-height:1.7;opacity:1!important}.agh-settings .cbi-value-field .btn,.agh-settings .cbi-value-field .cbi-button{border-radius:16px!important;border:1px solid var(--agh-inline-btn-border)!important;background:var(--agh-inline-btn-bg)!important;color:var(--agh-inline-btn-fg)!important;box-shadow:none!important}',
	'.agh-settings input[type="text"],.agh-settings input[type="password"],.agh-settings textarea,.agh-settings select{border-radius:16px;border-color:var(--agh-input-border);background:var(--agh-input-bg);color:var(--agh-text-high);-webkit-text-fill-color:var(--agh-text-high)!important;text-shadow:none!important;caret-color:var(--agh-text-high);box-shadow:none}',
	'.agh-settings select option,.agh-settings select optgroup{background:var(--agh-input-bg)!important;color:var(--agh-text-high)!important}',
	'.agh-settings input[type="text"]::placeholder,.agh-settings input[type="password"]::placeholder,.agh-settings textarea::placeholder{color:var(--agh-text-muted)}',
	'.agh-settings .cbi-checkbox{display:flex;align-items:center;min-height:24px}.agh-settings .cbi-checkbox input{width:20px;height:20px;margin:0;accent-color:var(--agh-checkbox-active-border);box-shadow:none!important;outline:none}.agh-settings .cbi-checkbox input:focus,.agh-settings .cbi-checkbox input:focus-visible{box-shadow:0 0 0 3px rgba(104,146,214,.18)!important;border-radius:6px}.agh-settings .cbi-checkbox label{display:none!important}.agh-settings .cbi-radio label{border:1px solid var(--agh-checkbox-border)!important;background:var(--agh-checkbox-bg)!important;box-shadow:none!important}.agh-settings .cbi-radio input:checked + label{background:var(--agh-checkbox-active-bg)!important;border-color:var(--agh-checkbox-active-border)!important}.agh-settings .cbi-radio input:focus + label{box-shadow:0 0 0 3px rgba(104,146,214,.18)!important}',
	'.agh-settings .cbi-dropdown,.agh-settings .cbi-dropdown ul{z-index:60}',
	'.agh-settings .cbi-page-actions{position:sticky;bottom:0;z-index:25;display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;align-items:center;margin:18px -1px -1px;padding:16px 18px;border-top:1px solid var(--agh-page-actions-border);background:var(--agh-page-actions-bg);box-shadow:var(--agh-page-actions-shadow);backdrop-filter:blur(12px)}.agh-settings .cbi-page-actions .cbi-button,.agh-settings .cbi-page-actions .cbi-dropdown{min-height:40px;border-radius:16px!important;box-shadow:none!important}.agh-settings .cbi-page-actions .cbi-dropdown ul{padding:6px;background:var(--agh-card-bg)!important;border:1px solid var(--agh-border)!important;border-radius:16px;box-shadow:0 12px 30px rgba(0,0,0,.22)}.agh-settings .cbi-page-actions .cbi-dropdown li{padding:10px 12px;border-radius:12px;color:var(--agh-text-high)!important;background:transparent!important}.agh-settings .cbi-page-actions .cbi-dropdown li[selected],.agh-settings .cbi-page-actions .cbi-dropdown li:hover{background:var(--agh-surface-bg)!important}.agh-settings .cbi-page-actions .more,.agh-settings .cbi-page-actions .open{color:inherit!important}',
	'@media(max-width:1180px){.agh-actions,.agh-status-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
	'@media(max-width:860px){.agh-settings .cbi-value{grid-template-columns:1fr;gap:10px}.agh-settings .cbi-page-actions{justify-content:stretch}.agh-settings .cbi-page-actions .cbi-button,.agh-settings .cbi-page-actions .cbi-dropdown{flex:1 1 140px}}',
	'@media(max-width:720px){.agh-actions,.agh-status-grid{grid-template-columns:1fr}.agh-hero{padding:20px}.agh-hero h2{font-size:24px!important}.agh-settings .cbi-section{padding:0 12px 14px}.agh-settings .cbi-section>h3{padding:18px 18px 0;font-size:22px}.agh-settings .cbi-section>.cbi-section-descr{margin:10px 18px 0;padding:12px 14px}.agh-settings .cbi-tabmenu{padding:14px 14px 0}.agh-settings .cbi-tab-descr{margin:0 16px 12px;padding:12px 14px}.agh-settings .cbi-value{padding:16px 16px}}'
].join('\n');

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('AdGuardHome'),
			safeCall(callGetStatus(), {}),
			safeCall(callGetMeta(), { backup_choices: [ 'filters', 'stats.db', 'querylog.json', 'sessions.db' ] })
		]);
	},
	render: function(data) {
		var status = data[1] || {};
		var meta = data[2] || {};
		var linksText = meta.links || buildLinks(status.release_channel);
		var rpcError = status._rpc_error || meta._rpc_error;
		var passwallUpstreamPort = text(status.redirect_compat_upstream, '');
		var passwallUpstreamDetected = /^[0-9]+$/.test(passwallUpstreamPort);
		var passwallUpstreamAutoEnabled = yes(status.passwall_upstream_auto);
		var passwallUpstreamHelp = passwallUpstreamDetected
			? t('Detected PassWall DNS frontend: ', '检测到 PassWall DNS 前端：') + '127.0.0.1:' + passwallUpstreamPort + '. ' +
				t('When enabled, only this managed AdGuard Home upstream entry is maintained; other upstream DNS entries stay untouched.', '启用后，只维护这一条受管 AdGuard Home 上游记录，其它上游 DNS 不会被改动。')
			: t('Managed PassWall upstream is enabled, but the PassWall DNS frontend port is not detected yet. The last managed upstream entry is kept until a new port is detected.', '托管 PassWall 上游已启用，但暂未检测到 PassWall DNS 前端端口。上一条受管上游记录会保留，直到检测到新端口。');
		var linksBox = E('textarea', {}, linksText);
		var channelSelect = E('select', {}, [
			E('option', { value: 'release' }, t('Stable', '稳定版')),
			E('option', { value: 'beta' }, t('Beta', '测试版')),
			E('option', { value: 'github' }, 'GitHub'),
			E('option', { value: 'custom' }, t('Custom', '自定义'))
		]);
		var archSelect = E('select', {}, [
			E('option', { value: 'auto' }, t('Auto', '自动')),
			E('option', { value: '386' }, 'i386'), E('option', { value: 'amd64' }, 'x86_64'), E('option', { value: 'armv5' }, 'armv5'), E('option', { value: 'armv6' }, 'armv6'), E('option', { value: 'armv7' }, 'armv7'), E('option', { value: 'arm64' }, 'aarch64'), E('option', { value: 'mips_softfloat' }, 'mips'), E('option', { value: 'mips64_softfloat' }, 'mips64'), E('option', { value: 'mipsle_softfloat' }, 'mipsel'), E('option', { value: 'mips64le_softfloat' }, 'mips64el'), E('option', { value: 'ppc64le' }, 'powerpc64')
		]);

		channelSelect.value = normalizeChannel(status.release_channel);
		archSelect.value = status.downloadarch || 'auto';
		channelSelect.addEventListener('change', function() {
			if (channelSelect.value !== 'custom')
				linksBox.value = buildLinks(channelSelect.value);
		});
		linksBox.addEventListener('input', function() { channelSelect.value = 'custom'; });

		var m = new form.Map('AdGuardHome', 'AdGuard Home', t('Grouped service, network, update and maintenance options. Use Save & Apply after changing UCI settings.', '设置项已按服务、网络、更新和维护分组。修改 UCI 配置后请点击保存并应用。'));
		var s = m.section(form.NamedSection, 'AdGuardHome', 'AdGuardHome', t('Configuration', '配置'));
		s.addremove = false;
		s.anonymous = true;
		s.tab('service', t('Service', '服务'), t('Enable the daemon and define how it starts.', '启用守护进程并设置启动方式。'));
		s.tab('network', t('Network', '网络'), t('Management port and DNS redirect behaviour.', '网页管理端口与 DNS 重定向行为。'));
		s.tab('files', t('Files', '文件'), t('Binary, YAML, workspace and log paths.', '核心文件、YAML、工作目录和日志路径。'));
		s.tab('update', t('Update', '更新'), t('Core update source and startup update behaviour.', '核心更新源和启动更新行为。'));
		s.tab('rules', t('Rules', '规则'), t('GFW rule export and upstream options.', 'GFW 规则导出与上游 DNS 选项。'));
		s.tab('maintenance', t('Maintenance', '维护'), t('Backup, upgrade retention and scheduled tasks.', '备份、升级保留和计划任务。'));
		var o;
		o = s.taboption('service', form.Flag, 'enabled', t('Enable service', '启用服务'), t('Start AdGuard Home through procd when this option is enabled.', '启用后通过 procd 启动 AdGuard Home。'));
		o = s.taboption('service', form.Flag, 'waitonboot', t('Wait for network on boot', '开机等待网络'), t('Delay service startup until the network is ready.', '开机时等待网络就绪后再启动服务。'));
		o = s.taboption('service', form.Value, 'username', t('API login username', 'API 登录用户名'), t('Username LuCI uses when requesting the local AdGuard Home API. Keep it in sync with the AdGuard Home admin account.', 'LuCI 请求本地 AdGuard Home API 时使用的用户名，请与 AdGuard Home 管理员账号保持一致。')); o.placeholder = 'root'; o.rmempty = false;
		o = s.taboption('service', form.Value, 'password', t('API login password', 'API 登录密码'), t('Password LuCI uses when requesting the local AdGuard Home API. Update it whenever you change the AdGuard Home web password.', 'LuCI 请求本地 AdGuard Home API 时使用的密码。修改 AdGuard Home 后台密码后，这里也要同步更新。')); o.password = true; o.rmempty = true;
		o = s.taboption('service', form.Value, 'hashpass', t('Web password bcrypt hash', 'Web 密码 bcrypt 哈希'), t('Use the password helper above to generate a hash, then save and apply.', '可使用上方密码助手生成哈希，然后保存并应用。')); o.password = true; o.rmempty = true;

		o = s.taboption('network', form.Value, 'httpport', t('Web console port', 'Web 控制台端口'), t('Port used by the AdGuard Home management UI.', 'AdGuard Home 管理界面使用的端口。')); o.datatype = 'port'; o.placeholder = '3000';
		o = s.taboption('network', form.ListValue, 'redirect', t('DNS redirect mode', 'DNS 重定向模式'), t('Choose how LAN DNS traffic is handed to AdGuard Home.', '选择局域网 DNS 流量交给 AdGuard Home 的方式。')); o.default = 'dnsmasq-upstream'; o.value('none', t('None', '无')); o.value('dnsmasq-upstream', t('Use as dnsmasq upstream', '作为 dnsmasq 上游')); o.value('redirect', t('Redirect port 53', '重定向 53 端口')); o.value('exchange', t('Swap with dnsmasq port', '与 dnsmasq 交换端口'));
		if (passwallUpstreamDetected || passwallUpstreamAutoEnabled) {
			o = s.taboption('network', form.Flag, 'passwall_upstream_auto', t('Managed PassWall upstream', '托管 PassWall 上游'), passwallUpstreamHelp);
			o.default = '0';
			o.rmempty = false;
		} else {
			o = s.taboption('network', form.DummyValue, '_passwall_upstream_auto_wait', t('Managed PassWall upstream', '托管 PassWall 上游'), t('The switch appears after redirect compatibility detects a PassWall DNS frontend port.', '检测到 PassWall DNS 前端端口后才会显示此开关。'));
			o.cfgvalue = function() {
				return t('Waiting for PassWall DNS frontend', '等待 PassWall DNS 前端');
			};
		}

		o = s.taboption('files', form.Value, 'binpath', t('Core binary path', '核心文件路径'), t('Executable path for the AdGuard Home binary.', 'AdGuard Home 核心可执行文件路径。')); o.placeholder = '/etc/config/adGuardConfig/AdGuardHome'; o.rmempty = false;
		o = s.taboption('files', form.Value, 'configpath', t('YAML config path', 'YAML 配置路径'), t('Main YAML configuration file edited by the YAML editor.', 'YAML 编辑器操作的主配置文件。')); o.placeholder = '/etc/config/adGuardConfig/AdGuardHome.yaml'; o.rmempty = false;
		o = s.taboption('files', form.Value, 'workdir', t('Work directory', '工作目录'), t('Directory that stores filters, statistics, sessions and query logs.', '用于保存过滤器、统计、会话和查询日志的目录。')); o.placeholder = '/etc/config/adGuardConfig/workspace'; o.rmempty = false;
		o = s.taboption('files', form.Value, 'logfile', t('Runtime log file', '运行日志文件'), t('Use syslog to follow system logs, or set a dedicated file path.', '可填 syslog 查看系统日志，也可填写独立日志文件路径。')); o.placeholder = '/tmp/AdGuardHome.log'; o.rmempty = true;
		o = s.taboption('files', form.Flag, 'verbose', t('Verbose runtime log', '详细运行日志'), t('Enable more detailed service output when troubleshooting.', '排查问题时输出更详细的运行日志。'));

		o = s.taboption('update', form.Flag, 'update', t('Check core update on startup', '启动时检查核心更新'), t('Run the updater when the service starts.', '服务启动时自动运行核心更新检查。'));
		o = s.taboption('update', form.ListValue, 'upxflag', t('UPX compression after download', '下载后 UPX 压缩'), t('Optional compression for the downloaded core binary.', '对下载后的核心文件进行可选压缩。')); o.value('', t('Disabled', '禁用')); o.value('-1', t('Fast', '快速')); o.value('-9', t('Better', '更高压缩')); o.value('--best', t('Best', '最佳')); o.value('--brute', t('Brute force', '强力压缩')); o.rmempty = true;

		o = s.taboption('rules', form.Flag, 'gfw', t('Maintain GFW rule export file', '维护 GFW 规则导出文件'), t('Generate an external GFW rule file for manual import. This no longer writes DNS entries into YAML automatically.', '生成供手动导入的 GFW 规则文件，不再自动把 DNS 条目写入 YAML。'));
		o = s.taboption('rules', form.Flag, 'gfwipset', t('Enable GFW ipset file', '启用 GFW ipset 文件'), t('Generate ipset file references for rule based routing.', '生成用于规则分流的 ipset 文件引用。'));
		o = s.taboption('rules', form.Value, 'gfwupstream', t('GFW upstream DNS', 'GFW 上游 DNS'), t('Upstream DNS used when generating the external GFW rule file for manual import.', '生成手动导入用的 GFW 规则文件时使用的上游 DNS。')); o.placeholder = 'tcp://208.67.220.220:5353'; o.rmempty = true;

		o = s.taboption('maintenance', form.MultiValue, 'upprotect', t('Keep files on system upgrade', '系统升级保留文件'), t('Files listed here are added to sysupgrade keep rules.', '这里选择的文件会加入系统升级保留列表。')); o.widget = 'checkbox'; o.value('$binpath', t('Core binary', '核心文件')); o.value('$configpath', t('Config file', '配置文件')); o.value('$logfile', t('Log file', '日志文件')); o.value('$workdir/data/sessions.db', 'sessions.db'); o.value('$workdir/data/stats.db', 'stats.db'); o.value('$workdir/data/querylog.json', 'querylog.json'); o.value('$workdir/data/filters', 'filters');
		o = s.taboption('maintenance', form.Flag, 'backup', t('Backup on shutdown', '停止服务时备份'), t('Copy selected workdir files to the backup path when stopping the service.', '停止服务时将选中的工作目录文件复制到备份路径。'));
		o = s.taboption('maintenance', form.MultiValue, 'backupfile', t('Backup workdir files', '备份工作目录文件'), t('Choose files under the work directory that should be backed up.', '选择需要备份的工作目录文件。')); o.widget = 'checkbox'; (meta.backup_choices || [ 'filters', 'stats.db', 'querylog.json', 'sessions.db' ]).forEach(function(item) { o.value(item, item); });
		o = s.taboption('maintenance', form.Value, 'backupwdpath', t('Backup path', '备份路径'), t('Destination directory for shutdown backups.', '停止服务备份的目标目录。')); o.placeholder = '/etc/config/adGuardConfig/workspace';
		o = s.taboption('maintenance', form.MultiValue, 'crontab', t('Scheduled tasks', '计划任务'), t('Legacy cron jobs managed by the init script.', '由 init 脚本维护的旧版计划任务。')); o.widget = 'checkbox'; o.value('autoupdate', t('Auto update core', '自动更新核心')); o.value('cutquerylog', t('Trim query log', '裁剪查询日志')); o.value('cutruntimelog', t('Trim runtime log', '裁剪运行日志')); o.value('autohost', t('Update IPv6 hosts', '更新 IPv6 hosts')); o.value('autogfw', t('Update GFW rule file', '更新 GFW 规则文件')); o.value('autogfwipset', t('Update GFW ipset', '更新 GFW ipset'));

		return m.render().then(function(formNode) {
			return applyThemeClass(E('div', { 'class': 'agh-settings' }, [
				E('style', {}, style),
				E('section', { 'class': 'agh-hero' }, [ E('h2', {}, t('AdGuard Home Settings', 'AdGuard Home 设置中心')) ]),
				statusSummary(status, rpcError),
				E('section', { 'class': 'agh-actions' }, [ updateCard(rpcError), linksCard(channelSelect, archSelect, linksBox, rpcError), passwordCard(), gfwCard(rpcError, yes(status.running)) ]),
				formNode
			]), 'agh-dark');
		});
	}
});

function statusSummary(status, rpcError) {
	return E('section', { 'class': 'agh-status-grid' }, [
		chip(t('Service', '服务'), rpcError ? t('Backend missing', '后端未加载') : (yes(status.running) ? t('Running', '运行中') : t('Stopped', '未运行')), rpcError ? 'agh-bad' : (yes(status.running) ? 'agh-live' : 'agh-warn')),
		chip(t('Core', '核心'), yes(status.core_ready) ? text(status.version, t('Ready', '就绪')) : t('Missing', '缺失'), yes(status.core_ready) ? 'agh-live' : 'agh-warn'),
		chip(t('Download', '下载'), normalizeChannel(status.release_channel), 'agh-ok'),
		chip(t('Architecture', '架构'), text(status.downloadarch, 'auto'), 'agh-ok')
	]);
}

function chip(label, value, cls) {
	return E('div', { 'class': 'agh-chip' + (cls ? ' ' + cls : '') }, [ E('span', {}, label), E('strong', { 'class': cls || '' }, value) ]);
}

function updateCard(rpcError) {
	var statusBox = createStatusBox(rpcError ? actionError(rpcError, t('RPC backend unavailable', 'RPC 后端不可用')) : t('Ready.', '就绪。'));
	var updateButton = E('button', { 'class': 'btn cbi-button cbi-button-action' }, t('Update', '更新'));
	var forceButton = E('button', { 'class': 'btn cbi-button cbi-button-negative' }, t('Force update', '强制更新'));
	if (rpcError) {
		updateButton.disabled = true;
		forceButton.disabled = true;
	}
	updateButton.addEventListener('click', function() {
		runRpcAction(updateButton, statusBox, function() { return callStartUpdate(false); }, t('Update scheduled.', '已调度更新。'), t('Update failed', '启动更新失败'));
	});
	forceButton.addEventListener('click', function() {
		runRpcAction(forceButton, statusBox, function() { return callStartUpdate(true); }, t('Forced update scheduled.', '已调度强制更新。'), t('Forced update failed', '启动强制更新失败'));
	});
	return E('div', { 'class': 'agh-action agh-action-update' }, [
		actionHeader(t('Version Update', '版本更新'), t('Core Version Update', '核心版本更新')),
		E('p', {}, t('Queue a core upgrade task through rpcd and move to the log page when you need to track output.', '通过 rpcd 调度核心升级任务；需要查看执行输出时，可直接切换到运行日志页面。')),
		E('div', { 'class': 'agh-row' }, [
			updateButton,
			forceButton,
			E('a', { 'class': softButtonClass(), 'href': L.url('admin', 'services', 'adguardhome', 'log') }, t('Open Log', '打开日志'))
		]), statusBox
	]);
}

function linksCard(channelSelect, archSelect, linksBox, rpcError) {
	var statusBox = createStatusBox(rpcError ? actionError(rpcError, t('RPC backend unavailable', 'RPC 后端不可用')) : t('Ready.', '就绪。'));
	var saveButton = E('button', { 'class': 'btn cbi-button cbi-button-action' }, t('Save source', '保存源'));
	if (rpcError)
		saveButton.disabled = true;
	saveButton.addEventListener('click', function() {
		runRpcAction(saveButton, statusBox, function() { return callSetLinks(linksBox.value, channelSelect.value, archSelect.value); }, t('Download source saved.', '下载源已保存。'), t('Saving download source failed', '保存下载源失败'));
	});
	return E('div', { 'class': 'agh-action agh-action-links' }, [
		actionHeader(t('Source', '源设置'), t('Download Sources', '下载源与架构')),
		E('p', {}, t('Choose a release channel, confirm the target architecture, or keep a fully custom source list when needed.', '可选择发布通道、确认目标架构，也可以继续维护完整的自定义下载源列表。')),
		E('div', { 'class': 'agh-row' }, [ channelSelect, archSelect, saveButton ]),
		linksBox,
		statusBox
	]);
}


function passwordCard() {
	var statusBox = createStatusBox(t('Generate a hash and it will be filled into the hash field below. The plain password field will also be updated for local API access.', '生成哈希后会自动写入下方哈希字段，并同步更新本地 API 使用的明文密码字段。'));
	var input = E('input', { type: 'password', placeholder: t('New web password', '新的网页密码') });
	var button = E('button', { 'class': softButtonClass(), 'click': function() { ensureBcrypt().then(function() { var bcrypt = window.TwinBcrypt || (window.dcodeIO && window.dcodeIO.bcrypt); var rawPassword = input.value || ''; var hash = bcrypt && bcrypt.hashSync ? bcrypt.hashSync(rawPassword, 10) : ''; var hashTarget = document.querySelector('[data-name="hashpass"] input'); var plainTarget = document.querySelector('[data-name="password"] input'); if (hashTarget && hash) { hashTarget.value = hash; if (plainTarget) plainTarget.value = rawPassword; statusBox.textContent = t('Hash generated and both password fields were updated.', '哈希已生成，并已同步更新两个密码字段。'); } else { statusBox.textContent = t('bcrypt library unavailable or hash generation failed.', 'bcrypt 库不可用，或哈希生成失败。'); } }); } }, t('Generate hash', '生成哈希'));
	return E('div', { 'class': 'agh-action agh-action-password' }, [
		actionHeader(t('Security', '安全'), t('Password Hash Helper', '密码哈希助手')),
		E('p', {}, t('Generate a bcrypt hash for the AdGuard Home web console password, write it into the hash field, and keep the local API password field in sync.', '为 AdGuard Home 后台密码生成 bcrypt 哈希，自动写入哈希字段，并同步本地 API 密码字段。')),
		E('div', { 'class': 'agh-row' }, [ input, button ]),
		statusBox
	]);
}

function gfwCard(rpcError, running) {
	var statusBox = createStatusBox(rpcError ? actionError(rpcError, t('RPC backend unavailable', 'RPC 后端不可用')) : t('Ready.', '就绪。'));
	function button(action, text, label) {
		var node = E('button', { 'class': softButtonClass() }, text);
		if (rpcError || (running && ACTION_MUTATES_GFW_YAML[action]))
			node.disabled = true;
		node.addEventListener('click', function() {
			runRpcAction(node, statusBox, function() { return callGfwAction(action); }, label, t('GFW action failed', 'GFW 操作失败'));
		});
		return node;
	}
	return E('div', { 'class': 'agh-action agh-action-gfw' }, [
		actionHeader(t('Rules', '规则'), t('GFW Rule Tools', 'GFW 规则工具')),
		E('p', {}, t('Generate or clean the external GFW rule file at /etc/AdGuardHome/gfw_upstream.txt. Upstream DNS is never written by this page; edit it in the AdGuard Home console.', '生成或清理 /etc/AdGuardHome/gfw_upstream.txt 外部规则文件。本页面不会写入上游 DNS；需要时请到 AdGuard Home 控制台手动填写。')),
		E('div', { 'class': 'agh-button-row' }, [
			button('add', t('Generate rule file', '生成规则文件'), t('GFW rule file generated. Import it manually into YAML if needed.', 'GFW 规则文件已生成；如有需要，请手动导入 YAML。')),
			button('del', t('Delete rule file', '删除规则文件'), t('GFW rule file deleted and legacy injected YAML rules were cleaned if present.', 'GFW 规则文件已删除；若存在旧版自动注入的 YAML 规则，也已一并清理。')),
			button('import', t('Manual DNS note', '手动DNS提示'), t('Automatic upstream DNS import is disabled. Copy entries from /etc/AdGuardHome/gfw_upstream.txt in the AdGuard Home console if needed.', '已禁用自动导入上游 DNS。如有需要，请在 AdGuard Home 控制台手动复制 /etc/AdGuardHome/gfw_upstream.txt 中的条目。')),
			button('remove_import', t('Manual cleanup note', '手动清理提示'), t('Automatic upstream DNS removal is disabled. Edit upstream DNS in the AdGuard Home console if needed.', '已禁用自动移除上游 DNS。如有需要，请在 AdGuard Home 控制台手动编辑上游 DNS。')),
			button('ipset_add', t('Add ipset', '添加 ipset'), t('GFW ipset task started.', 'GFW ipset 任务已启动。')),
			button('ipset_del', t('Delete ipset', '删除 ipset'), t('GFW ipset delete task started.', 'GFW ipset 删除任务已启动。'))
		]),
		running ? E('div', { 'class': 'agh-status' }, t('Changing ipset references is disabled while AdGuard Home is running. Upstream DNS is only edited in the AdGuard Home console.', 'AdGuard Home 运行中时不允许修改 ipset 引用。上游 DNS 只在 AdGuard Home 控制台中编辑。')) : '',
		statusBox
	]);
}

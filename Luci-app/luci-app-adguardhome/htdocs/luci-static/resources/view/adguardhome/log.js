'use strict';
'require view';
'require rpc';
'require poll';

var callGetLog = rpc.declare({ object: 'luci.adguardhome', method: 'getLog', params: [ 'scope', 'position' ], expect: { '': {} } });
var callClearLog = rpc.declare({ object: 'luci.adguardhome', method: 'clearLog', params: [ 'scope' ], expect: { '': {} } });

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
		return t('The rpcd backend is outdated and does not provide log actions. Reinstall this package or restart rpcd, then refresh LuCI.', '当前设备上的 rpcd 后端版本过旧，未提供日志相关操作。请重新安装当前软件包或重启 rpcd，然后刷新 LuCI。');
	return fallback + (message ? ': ' + message : '');
}

function safeCall(promise, fallback) {
	return promise.catch(function(err) {
		return Object.assign({ _rpc_error: err }, fallback || {});
	});
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


function normalizeLogContent(content) {
	return String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function createTerminalState() {
	return { committed: '', line: '' };
}

function renderTerminalContent(state, content, reset) {
	var source = String(content || '');
	var committed = reset ? '' : state.committed;
	var line = reset ? '' : state.line;
	var index;

	for (index = 0; index < source.length; index++) {
		var chr = source.charAt(index);
		var next = source.charAt(index + 1);

		if (chr === '\r') {
			if (next === '\n')
				continue;
			line = '';
			continue;
		}

		if (chr === '\n') {
			committed += line + '\n';
			line = '';
			continue;
		}

		line += chr;
	}

	state.committed = committed;
	state.line = line;

	return committed + line;
}

var style = [
	'.agh-log{display:grid;gap:18px;color:var(--agh-text,var(--text-color-high,#203042));--agh-text:var(--text-color-high,#203042);--agh-border:rgba(76,108,157,.14);--agh-border-soft:rgba(76,108,157,.08);--agh-card-bg:rgba(249,252,255,.98);--agh-toolbar-bg:rgba(232,240,251,.94);--agh-tab-bg:rgba(224,235,250,.92);--agh-tab-active-bg:rgba(255,255,255,.98);--agh-tab-text:#5e6f88;--agh-tab-active-text:var(--text-color-high,#17373c);--agh-status-bg:rgba(232,240,251,.94);--agh-status-text:#5e6f88;--agh-console-bg:#0f1a2c;--agh-console-fg:#d7e8ff;--agh-alert-bg:#fff4df;--agh-alert-fg:#805718;--agh-hero-bg:linear-gradient(135deg,#294a7a 0%,#3d679f 52%,#6f93cc 100%);--agh-hero-shadow:0 20px 42px rgba(25,50,87,.16)}',
	'.agh-log.agh-dark,body.dark .agh-log,html.dark .agh-log,body.mode-dark .agh-log,body.argon-dark .agh-log,html[data-theme="dark"] .agh-log,body[data-theme="dark"] .agh-log{--agh-border:rgba(124,147,186,.22);--agh-border-soft:rgba(124,147,186,.16);--agh-card-bg:rgba(16,24,38,.96);--agh-toolbar-bg:rgba(9,15,27,.84);--agh-tab-bg:rgba(10,17,30,.9);--agh-tab-active-bg:rgba(23,35,52,.96);--agh-tab-text:#9eb1c5;--agh-tab-active-text:#f1f6fc;--agh-status-bg:rgba(9,15,27,.88);--agh-status-text:#aebed0;--agh-console-bg:#08111d;--agh-console-fg:#dce7f8;--agh-alert-bg:rgba(92,68,24,.32);--agh-alert-fg:#f5d28a;--agh-hero-bg:linear-gradient(135deg,#0c1424 0%,#15253d 52%,#234267 100%);--agh-hero-shadow:0 22px 44px rgba(0,0,0,.3)}',
	'.agh-hero{border-radius:24px;padding:26px;color:#f7fbf8;background:var(--agh-hero-bg);box-shadow:var(--agh-hero-shadow)}',
	'.agh-hero h2{all:unset;display:block!important;margin:0 0 10px!important;font-size:28px!important;line-height:1.18!important;font-weight:700!important;color:#fff!important;background:transparent!important;border:0!important;box-shadow:none!important}',
	'.agh-hero p{max-width:72rem;margin:0;color:rgba(247,251,248,.86);font-size:14px;line-height:1.75}',
	'.agh-card{border-radius:22px;background:var(--agh-card-bg);border:1px solid var(--agh-border);box-shadow:0 12px 30px rgba(17,48,54,.08);overflow:hidden}',
	'.agh-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:16px 18px;border-bottom:1px solid var(--agh-border-soft);background:var(--agh-toolbar-bg)}.agh-toolbar .btn{border-radius:12px}',
	'.agh-toolbar .btn[disabled]{opacity:.6;cursor:not-allowed}',
	'.agh-tabs{display:inline-flex;gap:6px;padding:4px;border-radius:14px;background:var(--agh-tab-bg)}.agh-tab{border:0;border-radius:10px;padding:8px 13px;background:transparent;color:var(--agh-tab-text);cursor:pointer}.agh-tab.active{background:var(--agh-tab-active-bg);color:var(--agh-tab-active-text);box-shadow:0 3px 12px rgba(17,48,54,.09)}',
	'.agh-console{margin:0;min-height:560px;max-height:72vh;overflow:auto;padding:18px;background:var(--agh-console-bg);color:var(--agh-console-fg);font-family:ui-monospace,SFMono-Regular,Consolas,Monaco,monospace;font-size:12px;line-height:1.65;white-space:pre-wrap;word-break:break-word}',
	'.agh-status{padding:12px 18px;border-top:1px solid var(--agh-border-soft);background:var(--agh-status-bg);color:var(--agh-status-text);font-size:12px;line-height:1.55}',
	'.agh-alert{padding:16px 18px;border-bottom:1px solid var(--agh-border-soft);background:var(--agh-alert-bg);color:var(--agh-alert-fg);line-height:1.7}',
	'@media(max-width:720px){.agh-hero{padding:20px}.agh-hero h2{font-size:24px!important}.agh-console{min-height:480px}}'
].join('\n');

return view.extend({
	load: function() {
		return Promise.resolve({ scope: 'runtime', position: 0, content: '', size: 0, running: false });
	},
	render: function(data) {
		var scope = 'runtime';
		var rpcError = data._rpc_error;
		var positions = { runtime: Number(data.position || 0), update: 0 };
		var terminalStates = { runtime: createTerminalState(), update: createTerminalState() };
		var output = E('pre', { 'class': 'agh-console' }, rpcError ? actionError(rpcError, t('Log backend unavailable', '日志后端不可用')) : t('Loading current log…', '正在载入当前日志…'));
		var status = E('div', { 'class': 'agh-status' }, rpcError ? actionError(rpcError, t('Log backend unavailable', '日志后端不可用')) : t('Loading runtime log…', '正在载入运行日志…'));
		var runtimeTab = E('button', { 'class': 'agh-tab active', 'disabled': rpcError ? 'disabled' : null }, t('Runtime', '运行日志'));
		var updateTab = E('button', { 'class': 'agh-tab', 'disabled': rpcError ? 'disabled' : null }, t('Update', '更新日志'));
		var reloadButton = E('button', { 'class': 'btn cbi-button', 'disabled': rpcError ? 'disabled' : null }, t('Reload', '重新载入'));
		var clearButton = E('button', { 'class': 'btn cbi-button cbi-button-negative', 'disabled': rpcError ? 'disabled' : null }, t('Clear', '清空'));

		function appendLog(res, reset) {
			positions[scope] = Number(res.position || positions[scope] || 0);

			if (scope === 'update') {
				output.textContent = renderTerminalContent(terminalStates.update, res.content, reset);
			}
			else {
				var content = normalizeLogContent(res.content);
				if (reset)
					output.textContent = content;
				else if (content)
					output.textContent += content;
			}

			status.textContent = t('Size', '大小') + ': ' + (res.size || 0) + ' B' + (res.running ? ' · ' + t('Task running', '任务运行中') : '');
			output.scrollTop = output.scrollHeight;
		}

		function loadScope(nextScope) {
			scope = nextScope;
			runtimeTab.classList.toggle('active', scope === 'runtime');
			updateTab.classList.toggle('active', scope === 'update');
			positions[scope] = 0;
			terminalStates[scope] = createTerminalState();
			output.textContent = t('Loading current log…', '正在载入当前日志…');
			status.textContent = scope === 'update'
				? t('Loading update log…', '正在载入更新日志…')
				: t('Loading runtime log…', '正在载入运行日志…');
			return callGetLog(scope, 0).then(function(res) {
				appendLog(res, true);
			}).catch(function(err) {
				output.textContent = '';
				status.textContent = actionError(err, t('Loading log failed', '载入日志失败'));
			});
		}

		runtimeTab.addEventListener('click', function() { loadScope('runtime'); });
		updateTab.addEventListener('click', function() { loadScope('update'); });
		reloadButton.addEventListener('click', function() {
			positions[scope] = 0;
			callGetLog(scope, 0).then(function(res) {
				appendLog(res, true);
			}).catch(function(err) {
				status.textContent = actionError(err, t('Reloading log failed', '重新载入日志失败'));
			});
		});
		clearButton.addEventListener('click', function() {
			callClearLog(scope).then(function() {
				positions[scope] = 0;
				terminalStates[scope] = createTerminalState();
				output.textContent = '';
				status.textContent = t('Log cleared.', '日志已清空。');
			}).catch(function(err) {
				status.textContent = actionError(err, t('Clearing log failed', '清空日志失败'));
			});
		});

		if (!rpcError) {
			loadScope('runtime');
			poll.add(function() {
				return callGetLog(scope, positions[scope] || 0).then(function(res) {
					appendLog(res, false);
				}).catch(function(err) {
					status.textContent = actionError(err, t('Polling log failed', '轮询日志失败'));
				});
			}, 3);
		}

		return applyThemeClass(E('div', { 'class': 'agh-log' }, [
			E('style', {}, style),
			E('section', { 'class': 'agh-hero' }, [ E('h2', {}, t('Runtime Logs', '运行日志')), E('p', {}, t('Follow service and core update output from one responsive console.', '在一个响应式控制台里查看服务运行日志和核心更新日志。')) ]),
			E('section', { 'class': 'agh-card' }, [
				rpcError ? E('div', { 'class': 'agh-alert' }, actionError(rpcError, t('Log backend unavailable', '日志后端不可用'))) : '',
				E('div', { 'class': 'agh-toolbar' }, [
					E('div', { 'class': 'agh-tabs' }, [ runtimeTab, updateTab ]),
					reloadButton,
					clearButton
				]),
				output,
				status
			])
		]), 'agh-dark');
	}
});

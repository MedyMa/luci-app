'use strict';
'require view';
'require adguardhome.ui as aghui';
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
		return t('The luci.adguardhome rpcd object is missing. Reinstall this package or restart rpcd, then refresh LuCI.', '缺少 luci.adguardhome rpcd 后端对象，请重装本包或重启 rpcd 后刷新 LuCI。');
	if (/Method not found/i.test(message))
		return t('The rpcd backend is outdated and lacks log actions. Reinstall this package or restart rpcd, then refresh LuCI.', 'rpcd 后端过旧、不支持日志相关操作，请重装本包或重启 rpcd 后刷新 LuCI。');
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
	var mediaQuery;

	syncThemeClass();

	if (typeof window !== 'undefined') {
		for (index = 0; index < retries.length; index++)
			window.setTimeout(syncThemeClass, retries[index]);

		if (window.requestAnimationFrame)
			window.requestAnimationFrame(syncThemeClass);

		/* Singleton MutationObserver — avoid observer accumulation on re-render */
		if (typeof MutationObserver !== 'undefined' && document.documentElement) {
			if (!applyThemeClass._themeObserver) {
				applyThemeClass._themeObserver = new MutationObserver(function() {
					var nodes = applyThemeClass._themeQueue;
					var i;
					if (!nodes) return;
					for (i = 0; i < nodes.length; i++) {
						if (nodes[i] && nodes[i].classList)
							nodes[i].classList.toggle(darkClass, isDarkTheme());
					}
				});
				applyThemeClass._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: [ 'class', 'style', 'data-theme' ] });
				if (document.body && document.body !== document.documentElement)
					applyThemeClass._themeObserver.observe(document.body, { attributes: true, attributeFilter: [ 'class', 'style', 'data-theme' ] });
			}
			if (!applyThemeClass._themeQueue)
				applyThemeClass._themeQueue = [];
			/* Prune detached nodes to prevent unbounded growth on re-render */
			applyThemeClass._themeQueue = applyThemeClass._themeQueue.filter(function(n) { return n && document.body && document.body.contains(n); });
			if (applyThemeClass._themeQueue.indexOf(node) === -1)
				applyThemeClass._themeQueue.push(node);
		}

		/* Singleton mediaQuery — register once, traverse queue on change */
		applyThemeClass._darkClass = darkClass;
		if (!applyThemeClass._mediaQueryRegistered && window.matchMedia) {
			applyThemeClass._mediaQueryRegistered = true;
			var mq = window.matchMedia('(prefers-color-scheme: dark)');
			if (mq) {
				var onColorSchemeChange = function() {
					var nodes = applyThemeClass._themeQueue;
					var i;
					if (!nodes) return;
					for (i = 0; i < nodes.length; i++) {
						if (nodes[i] && nodes[i].classList)
							nodes[i].classList.toggle(applyThemeClass._darkClass || darkClass, isDarkTheme());
					}
				};
				if (mq.addEventListener)
					mq.addEventListener('change', onColorSchemeChange);
				else if (mq.addListener)
					mq.addListener(onColorSchemeChange);
			}
		}

		/* Singleton window listeners — register once, not per applyThemeClass call */
		if (!applyThemeClass._windowListenersAttached) {
			applyThemeClass._windowListenersAttached = true;
			window.addEventListener('pageshow', syncThemeClass);
			window.addEventListener('focus', syncThemeClass);
		}
	}

	return node;
}


function stripLogStyles(content) {
	return String(content || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function normalizeLogContent(content) {
	return stripLogStyles(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function createTerminalState() {
	return { committed: '', line: '' };
}

function renderTerminalContent(state, content, reset) {
	var source = stripLogStyles(content);
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

var style = aghui.style;

return view.extend({
	load: function() {
		return Promise.resolve({ scope: 'runtime', position: 0, content: '', size: 0, running: false });
	},
	render: function(data) {
		var scope = 'runtime';
		var inFlight = null, generation = 0;
		var rpcError = data._rpc_error;
		var positions = { runtime: Number(data.position || 0), update: 0 };
		var terminalStates = { runtime: createTerminalState(), update: createTerminalState() };
		var output = E('pre', { 'class': 'agh-console' }, rpcError ? actionError(rpcError, t('Log backend unavailable', '日志后端不可用')) : t('Loading current log…', '正在载入当前日志…'));
		var status = E('div', { 'class': 'agh-status' }, rpcError ? actionError(rpcError, t('Log backend unavailable', '日志后端不可用')) : t('Loading runtime log…', '正在载入运行日志…'));
		var runtimeTab = E('button', { 'class': 'agh-tab active', 'disabled': rpcError ? 'disabled' : null }, t('Runtime', '运行日志'));
		var updateTab = E('button', { 'class': 'agh-tab', 'disabled': rpcError ? 'disabled' : null }, t('Update log', '更新日志'));
		var reloadButton = E('button', { 'class': 'btn cbi-button', 'disabled': rpcError ? 'disabled' : null }, t('Reload', '重新载入'));
		var clearButton = E('button', { 'class': 'btn cbi-button cbi-button-negative', 'disabled': rpcError ? 'disabled' : null }, t('Clear', '清空'));

		function appendLog(res, reset) {
			var nextPos = Number(res.position || 0);
			/* If the log file shrank (syslog mirror rotation, update log
			 * truncation), the previous position no longer applies: replace
			 * the view instead of appending, otherwise already-displayed
			 * content is shown a second time. */
			var shrank = nextPos < positions[scope];
			if (shrank)
				terminalStates[scope] = createTerminalState();
			positions[scope] = nextPos;

			if (scope === 'update') {
				output.textContent = renderTerminalContent(terminalStates.update, res.content, reset || shrank);
			}
			else {
				var content = normalizeLogContent(res.content);
				if (reset || shrank)
					output.textContent = content;
				else if (content)
					output.textContent += content;
			}

			status.textContent = t('Size', '大小') + ': ' + (res.size || 0) + ' B' + (res.running ? ' · ' + t('Task running', '任务运行中') : '');
			output.scrollTop = output.scrollHeight;
		}

		function fetchLog(reset) {
			if (inFlight) return reset ? inFlight.then(function() { return fetchLog(true); }) : inFlight;
			var requestedScope=scope, requestedGeneration=generation;
			inFlight=callGetLog(requestedScope, reset ? 0 : positions[requestedScope] || 0).then(function(res) {
				if(requestedScope===scope && requestedGeneration===generation)appendLog(res, reset);
			}).catch(function(err) {
				if(requestedScope===scope && requestedGeneration===generation)status.textContent=actionError(err,t('Loading log failed','载入日志失败'));
			}).then(function() { inFlight=null; });
			return inFlight;
		}

		function loadScope(nextScope) {
			scope = nextScope;
			generation++;
			runtimeTab.classList.toggle('active', scope === 'runtime');
			updateTab.classList.toggle('active', scope === 'update');
			positions[scope] = 0;
			terminalStates[scope] = createTerminalState();
			output.textContent = t('Loading current log…', '正在载入当前日志…');
			status.textContent = scope === 'update'
				? t('Loading update log…', '正在载入更新日志…')
				: t('Loading runtime log…', '正在载入运行日志…');
			return fetchLog(true);
		}

		runtimeTab.addEventListener('click', function() { loadScope('runtime'); });
		updateTab.addEventListener('click', function() { loadScope('update'); });
		reloadButton.addEventListener('click', function() { loadScope(scope); });
		clearButton.addEventListener('click', function() {
			var clearedScope=scope, clearedGeneration=++generation;
			callClearLog(clearedScope).then(function() {
				if(clearedScope!==scope || clearedGeneration!==generation)return;
				positions[scope] = 0;
				terminalStates[scope] = createTerminalState();
				output.textContent = '';
				status.textContent = t('Log cleared.', '日志已清空。');
				return fetchLog(true);
			}).catch(function(err) {
				if(clearedScope===scope && clearedGeneration===generation)
					status.textContent = actionError(err, t('Clearing log failed', '清空日志失败'));
			});
		});

		if (!rpcError) {
			loadScope('runtime');
			/* Store poll handle for cleanup on re-render */
			if (this._aghPollHandle != null && typeof poll !== 'undefined' && poll.remove) {
				try { poll.remove(this._aghPollHandle); } catch(e) { /* already removed by LuCI nav */ }
			}
			if (typeof poll !== 'undefined' && poll.add)
				this._aghPollHandle = poll.add(function() {
					if(document.hidden)return Promise.resolve();
					return fetchLog(false);
				}, 3);
			else
				this._aghPollHandle = null;   // prevent stale handle on re-render
		} else {
			this._aghPollHandle = null;   // rpcError: clear handle from previous success
		}

		return applyThemeClass(E('div', { 'class': 'agh-log agh-ui' }, [
			E('style', {}, style),
			aghui.header('log'),
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
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});

'use strict';
'require view';
'require adguardhome.ui as aghui';
'require rpc';
'require fs';
'require poll';

var callGetStatus = rpc.declare({ object: 'luci.adguardhome', method: 'getStatus', expect: { '': {} } });
var callGetYaml = rpc.declare({ object: 'luci.adguardhome', method: 'getYaml', expect: { '': {} } });
var callGetCurrentYaml = rpc.declare({ object: 'luci.adguardhome', method: 'getCurrentYaml', expect: { '': {} } });
var callGetTemplate = rpc.declare({ object: 'luci.adguardhome', method: 'getTemplateConfig', expect: { '': {} } });
var callSaveYaml = rpc.declare({ object: 'luci.adguardhome', method: 'saveYaml', params: [ 'content' ], expect: { '': {} } });
var callDiscardYaml = rpc.declare({ object: 'luci.adguardhome', method: 'discardYaml', expect: { '': {} } });

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
		return t('The rpcd backend is outdated and lacks YAML actions. Reinstall this package or restart rpcd, then refresh LuCI.', 'rpcd 后端过旧、不支持 YAML 相关操作，请重装本包或重启 rpcd 后刷新 LuCI。');
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

function ensureStyle(src, id) {
	if (document.getElementById(id))
		return;
	var link = document.createElement('link');
	link.id = id;
	link.rel = 'stylesheet';
	link.href = src;
	document.head.appendChild(link);
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

function ensureCodeMirror() {
	ensureStyle(L.resource('codemirror/lib/codemirror.css'), 'agh-cm-base');
	return ensureScript(L.resource('codemirror/lib/codemirror.js'), 'agh-cm-script').then(function() {
		return ensureScript(L.resource('codemirror/mode/yaml/yaml.js'), 'agh-cm-yaml');
	});
}

function resolvedConfigPath(status) {
	return status && status.configpath || '/etc/config/adGuardConfig/AdGuardHome.yaml';
}

function readCurrentYamlDirect(status) {
	return L.resolveDefault(fs.read_direct(resolvedConfigPath(status), 'text'), '');
}

var style = aghui.style;

return view.extend({
	load: function() {
		return Promise.all([
			safeCall(callGetYaml(), { content: '', test_log: '', source: 'template', current_exists: false, current_content: '' }),
			safeCall(callGetStatus(), { configpath: '/etc/config/adGuardConfig/AdGuardHome.yaml', config_ready: false })
		]);
	},
	render: function(data) {
		var yamlData = data[0] || {};
		var statusData = data[1] || {};
		var rpcError = yamlData._rpc_error;
		var editingLocked = !rpcError && yes(statusData.running);
		var useTemplateDefault = !rpcError && yamlData.source === 'template';
		var showingTemplate = useTemplateDefault;
		var hasCurrentFile = !!yamlData.current_exists || !!statusData.config_ready;
		var lockMessage = t('AdGuard Home is running. Stop the service before editing the YAML file.', 'AdGuard Home 正在运行。请先停止服务，再修改 YAML 文件。');
		var textarea = E('textarea', {}, yamlData.content || '');
		var statusBox = E('div', { 'class': 'agh-status' }, rpcError ? actionError(rpcError, t('YAML backend unavailable', 'YAML 后端不可用')) : (yamlData.test_log || (useTemplateDefault ? t('Template loaded by default.', '已默认载入模板。') : t('Ready.', '就绪。'))));
		var editor = null;
		var saveButton = E('button', { 'class': 'btn cbi-button cbi-button-action', 'disabled': (rpcError || editingLocked) ? 'disabled' : null }, t('Save & Apply', '保存并应用'));
		var templateButton = E('button', { 'class': 'btn cbi-button', 'disabled': (rpcError || editingLocked) ? 'disabled' : null }, t('Use template', '使用模板'));
		var discardButton = E('button', { 'class': 'btn cbi-button', 'disabled': rpcError ? 'disabled' : null }, '');
		var lockNote = !rpcError ? E('div', { 'class': 'agh-alert', 'style': editingLocked ? '' : 'display:none' }, editingLocked ? lockMessage : '') : null;

		function value() { return editor ? editor.getValue() : textarea.value; }
		function setValue(content) { editor ? editor.setValue(content || '') : textarea.value = content || ''; }
		function setStatus(message) { statusBox.textContent = message; }
		function setButtonDisabled(button, disabled) {
			if (disabled)
				button.setAttribute('disabled', 'disabled');
			else
				button.removeAttribute('disabled');
		}
		function syncEditLock() {
			var readOnly = !!rpcError || editingLocked;

			if (readOnly)
				textarea.setAttribute('readonly', 'readonly');
			else
				textarea.removeAttribute('readonly');

			setButtonDisabled(saveButton, readOnly);
			setButtonDisabled(templateButton, readOnly);

			if (lockNote) {
				lockNote.textContent = editingLocked ? lockMessage : '';
				lockNote.style.display = editingLocked ? '' : 'none';
			}

			if (editor)
				editor.setOption('readOnly', readOnly ? 'nocursor' : false);
		}
		function loadCurrentFile(statusMessage) {
			setStatus(statusMessage || t('Loading current YAML…', '正在载入当前 YAML…'));
			return readCurrentYamlDirect(statusData).then(function(content) {
				setValue(content || '');
				showingTemplate = false;
				hasCurrentFile = true;
				updateDiscardButton();
				setStatus(t('Current YAML loaded.', '已载入当前 YAML。'));
			});
		}
		function updateDiscardButton() {
			discardButton.textContent = showingTemplate && hasCurrentFile
				? t('Load current file', '载入当前文件')
				: t('Discard temporary', '丢弃临时修改');
		}

		updateDiscardButton();
		syncEditLock();

		if (!rpcError && !yamlData.content && hasCurrentFile)
			loadCurrentFile(t('Loading current YAML…', '正在载入当前 YAML…')).catch(function(err) {
				setStatus(actionError(err, t('Loading current YAML failed', '载入当前 YAML 失败')));
			});

		saveButton.addEventListener('click', function() {
			if (editingLocked) {
				setStatus(lockMessage);
				return;
			}

			callSaveYaml(value()).then(function(res) {
				if (res.ok) {
					showingTemplate = false;
					hasCurrentFile = true;
					updateDiscardButton();
					setStatus(t('YAML saved and service reload scheduled.', 'YAML 已保存，并已调度服务重载。'));
				}
				else {
					setStatus(res.error || t('Validation failed.', '校验失败。'));
				}
			}).catch(function(err) {
				setStatus(actionError(err, t('Saving YAML failed', '保存 YAML 失败')));
			});
		});

		templateButton.addEventListener('click', function() {
			if (editingLocked) {
				setStatus(lockMessage);
				return;
			}

			callGetTemplate().then(function(res) {
				setValue(res.content || '');
				showingTemplate = true;
				updateDiscardButton();
				setStatus(t('Template loaded.', '模板已载入。'));
			}).catch(function(err) {
				setStatus(actionError(err, t('Loading template failed', '加载模板失败')));
			});
		});

		discardButton.addEventListener('click', function() {
			if (showingTemplate && hasCurrentFile) {
				loadCurrentFile(t('Loading current YAML…', '正在载入当前 YAML…')).catch(function(err) {
					setStatus(actionError(err, t('Loading current YAML failed', '载入当前 YAML 失败')));
				});
				return;
			}

			if (!showingTemplate && !value() && hasCurrentFile) {
				loadCurrentFile(t('Loading current YAML…', '正在载入当前 YAML…')).catch(function(err) {
					setStatus(actionError(err, t('Loading current YAML failed', '载入当前 YAML 失败')));
				});
				return;
			}

			callDiscardYaml().then(function() {
				return callGetYaml();
			}).then(function(res) {
				setValue(res.content || '');
				showingTemplate = res.source === 'template';
				hasCurrentFile = !!res.current_exists;
				updateDiscardButton();
				if (res.source === 'config')
					setStatus(t('Current YAML loaded.', '已载入当前 YAML。'));
				else if (res.source === 'template')
					setStatus(t('Template loaded.', '模板已载入。'));
				else
					setStatus(t('Temporary YAML changes discarded.', '临时 YAML 修改已丢弃。'));
			}).catch(function(err) {
				setStatus(actionError(err, t('Discarding YAML changes failed', '丢弃 YAML 修改失败')));
			});
		});

		var node = applyThemeClass(E('div', { 'class': 'agh-yaml agh-ui' }, [
			E('style', {}, style),
			aghui.header(),
			E('section', { 'class': 'agh-card' }, [
				rpcError ? E('div', { 'class': 'agh-alert' }, actionError(rpcError, t('YAML backend unavailable', 'YAML 后端不可用'))) : '',
				lockNote || '',
				E('div', { 'class': 'agh-toolbar' }, [
					saveButton,
					templateButton,
					discardButton
				]),
				E('div', { 'class': 'agh-editor' }, textarea),
				statusBox
			])
		]), 'agh-dark');

		/* Destroy previous CodeMirror instance before creating a new one */
		if (this._aghCmInstance && this._aghCmInstance.toTextArea) {
			this._aghCmInstance.toTextArea();
			this._aghCmInstance = null;
		}

		var _view = this;  // capture view instance for callback

		ensureCodeMirror().then(function() {
			if (!window.CodeMirror)
				return;
			editor = window.CodeMirror.fromTextArea(textarea, {
				mode: 'yaml',
				theme: 'default',
				lineNumbers: true,
				lineWrapping: false,
				indentUnit: 2,
				tabSize: 2
			});
			_view._aghCmInstance = editor;  // store for cleanup on re-render
			syncEditLock();
		}).catch(function(err) {
			setStatus(t('CodeMirror failed to load, using textarea: ', 'CodeMirror 加载失败，已回退为文本框：') + err.message);
		});

		/* Clean up previous poll handle before re-adding */
		if (this._aghPollHandle != null && typeof poll !== 'undefined' && poll.remove) {
			try { poll.remove(this._aghPollHandle); } catch(e) { /* already removed by LuCI nav */ }
		}

		if (!rpcError && typeof poll !== 'undefined' && poll.add)
			this._aghPollHandle = poll.add(function() {
				return callGetStatus().then(function(nextStatus) {
					statusData = nextStatus || {};
					editingLocked = yes(statusData.running);
					hasCurrentFile = hasCurrentFile || !!statusData.config_ready;
					syncEditLock();
					updateDiscardButton();
				}).catch(function() {
					return null;
				});
			});
		else
			this._aghPollHandle = null;   // prevent stale handle on re-render

		return node;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});

'use strict';
'require view';
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
		return t('The luci.adguardhome rpcd object is not available. Reinstall this package or restart rpcd, then refresh LuCI.', '当前设备没有导出 luci.adguardhome rpcd 后端对象。请重新安装当前软件包或重启 rpcd，然后刷新 LuCI。');
	if (/Method not found/i.test(message))
		return t('The rpcd backend is outdated and does not provide YAML actions. Reinstall this package or restart rpcd, then refresh LuCI.', '当前设备上的 rpcd 后端版本过旧，未提供 YAML 相关操作。请重新安装当前软件包或重启 rpcd，然后刷新 LuCI。');
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

	var background = window.getComputedStyle(document.body).backgroundColor || '';
	var channels = background.match(/\d+(?:\.\d+)?/g);
	var luminance;

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

	syncThemeClass();

	if (typeof window !== 'undefined') {
		for (index = 0; index < retries.length; index++)
			window.setTimeout(syncThemeClass, retries[index]);

		if (window.requestAnimationFrame)
			window.requestAnimationFrame(syncThemeClass);
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
	ensureStyle(L.resource('codemirror/theme/dracula.css'), 'agh-cm-theme');
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

var style = [
	'.agh-yaml{display:grid;gap:18px;color:var(--agh-text,var(--text-color-high,#203042));--agh-text:var(--text-color-high,#203042);--agh-border:rgba(76,108,157,.14);--agh-border-soft:rgba(76,108,157,.08);--agh-card-bg:rgba(249,252,255,.98);--agh-toolbar-bg:rgba(232,240,251,.94);--agh-status-bg:rgba(232,240,251,.94);--agh-status-text:#5e6f88;--agh-alert-bg:#fff4df;--agh-alert-fg:#805718;--agh-editor-bg:rgba(255,255,255,.99);--agh-hero-bg:linear-gradient(135deg,#294a7a 0%,#3d679f 52%,#6f93cc 100%);--agh-hero-shadow:0 20px 42px rgba(25,50,87,.16)}',
	'.agh-yaml.agh-dark,body.dark .agh-yaml,html.dark .agh-yaml,body.mode-dark .agh-yaml,body.argon-dark .agh-yaml,html[data-theme="dark"] .agh-yaml,body[data-theme="dark"] .agh-yaml{--agh-border:rgba(124,147,186,.22);--agh-border-soft:rgba(124,147,186,.16);--agh-card-bg:rgba(16,24,38,.96);--agh-toolbar-bg:rgba(9,15,27,.84);--agh-status-bg:rgba(9,15,27,.88);--agh-status-text:#aebed0;--agh-alert-bg:rgba(92,68,24,.32);--agh-alert-fg:#f5d28a;--agh-editor-bg:rgba(8,14,24,.94);--agh-hero-bg:linear-gradient(135deg,#0c1424 0%,#15253d 52%,#234267 100%);--agh-hero-shadow:0 22px 44px rgba(0,0,0,.3)}',
	'.agh-hero{border-radius:24px;padding:26px;color:#f7fbf8;background:var(--agh-hero-bg);box-shadow:var(--agh-hero-shadow)}',
	'.agh-hero h2{all:unset;display:block!important;margin:0 0 10px!important;font-size:28px!important;line-height:1.18!important;font-weight:700!important;color:#fff!important;background:transparent!important;border:0!important;box-shadow:none!important}',
	'.agh-hero p{max-width:72rem;margin:0;color:rgba(247,251,248,.86);font-size:14px;line-height:1.75}',
	'.agh-card{border-radius:22px;background:var(--agh-card-bg);border:1px solid var(--agh-border);box-shadow:0 12px 30px rgba(17,48,54,.08);overflow:hidden}',
	'.agh-toolbar{display:flex;gap:10px;flex-wrap:wrap;padding:16px 18px;border-bottom:1px solid var(--agh-border-soft);background:var(--agh-toolbar-bg)}.agh-toolbar .btn{border-radius:12px}',
	'.agh-toolbar .btn[disabled]{opacity:.6;cursor:not-allowed}',
	'.agh-editor{padding:0;background:var(--agh-editor-bg)}.agh-editor textarea{width:100%;min-height:620px;border:0;border-radius:0;font-family:monospace;font-size:13px;box-sizing:border-box;background:var(--agh-editor-bg);color:var(--agh-text)}',
	'.agh-editor textarea[readonly]{cursor:not-allowed;opacity:.92}',
	'.CodeMirror{height:auto;min-height:620px;font-size:13px;line-height:1.65}.CodeMirror-scroll{min-height:620px}',
	'.agh-status{padding:12px 18px;border-top:1px solid var(--agh-border-soft);background:var(--agh-status-bg);color:var(--agh-status-text);font-size:12px;line-height:1.55;white-space:pre-wrap}',
	'.agh-alert{padding:16px 18px;border-bottom:1px solid var(--agh-border-soft);background:var(--agh-alert-bg);color:var(--agh-alert-fg);line-height:1.7}',
	'@media(max-width:720px){.agh-hero{padding:20px}.agh-hero h2{font-size:24px!important}.CodeMirror,.CodeMirror-scroll,.agh-editor textarea{min-height:520px}}'
].join('\n');

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

		var node = applyThemeClass(E('div', { 'class': 'agh-yaml' }, [
			E('style', {}, style),
			E('section', { 'class': 'agh-hero' }, [ E('h2', {}, t('YAML Editor', 'YAML 编辑器')), E('p', {}, t('Edit the file-backed AdGuard Home YAML configuration with template generation, validation and apply through rpcd.', '通过 rpcd 编辑文件型 AdGuard Home YAML 配置，支持模板生成、校验和应用。')) ]),
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

		ensureCodeMirror().then(function() {
			if (!window.CodeMirror)
				return;
			editor = window.CodeMirror.fromTextArea(textarea, {
				mode: 'yaml',
				theme: 'dracula',
				lineNumbers: true,
				lineWrapping: false,
				indentUnit: 2,
				tabSize: 2
			});
			syncEditLock();
		}).catch(function(err) {
			setStatus(t('CodeMirror failed to load, using textarea: ', 'CodeMirror 加载失败，已回退为文本框：') + err.message);
		});

		if (!rpcError)
			poll.add(function() {
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

		return node;
	}
});

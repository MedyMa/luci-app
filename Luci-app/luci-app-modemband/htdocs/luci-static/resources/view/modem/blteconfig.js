'use strict';
'require form';
'require fs';
'require view';
'require uci';
'require ui';
'require tools.widgets as widgets'

/*
	Copyright 2022-2024 Rafał Wabik - IceG - From eko.one.pl forum
*/

function resolveWithTimeout(promise, fallback, timeout) {
	return new Promise(function(resolve) {
		var settled = false;
		var timer = window.setTimeout(function() {
			if (settled)
				return;

			settled = true;
			resolve(fallback);
		}, timeout || 3000);

		L.resolveDefault(promise, fallback).then(function(value) {
			if (settled)
				return;

			settled = true;
			window.clearTimeout(timer);
			resolve(value);
		});
	});
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

function normalizeActionLayout(node) {
	function syncLayout() {
		var parent = node && node.parentElement;
		var actions = node && node.nextElementSibling;

		if (!parent)
			return;

		parent.classList.add('mb-config-layout');

		if (actions && actions.classList.contains('cbi-page-actions'))
			actions.classList.add('mb-config-actions');
	}
	var retries = [ 0, 80, 220, 480, 900 ];
	var index;

	syncLayout();

	if (typeof window !== 'undefined') {
		for (index = 0; index < retries.length; index++)
			window.setTimeout(syncLayout, retries[index]);

		if (window.requestAnimationFrame)
			window.requestAnimationFrame(syncLayout);
	}

	return node;
}

function normalizeTemplateEditor(node) {
	function syncEditor() {
		var row = node && node.querySelector('.cbi-value[data-name="_tmpl"]');
		var field = row && row.querySelector('.cbi-value-field');
		var textarea = row && row.querySelector('textarea');
		var description = row && row.querySelector('.cbi-value-description');

		if (row)
			row.classList.add('mb-config-editor-row');

		if (field)
			field.classList.add('mb-config-editor-field');

		if (description)
			description.classList.add('mb-config-editor-description');

		if (!textarea)
			return;

		textarea.classList.add('mb-config-editor-textarea');
		textarea.spellcheck = false;
		textarea.setAttribute('spellcheck', 'false');
		textarea.setAttribute('autocapitalize', 'off');
		textarea.setAttribute('autocomplete', 'off');
		textarea.setAttribute('autocorrect', 'off');
	}
	var retries = [ 0, 80, 220, 480, 900 ];
	var index;

	syncEditor();

	if (typeof window !== 'undefined') {
		for (index = 0; index < retries.length; index++)
			window.setTimeout(syncEditor, retries[index]);

		if (window.requestAnimationFrame)
			window.requestAnimationFrame(syncEditor);
	}

	return node;
}

function compactLabel(value, maxLength) {
	value = String(value || '').trim();
	maxLength = maxLength || 24;

	if (value.length <= maxLength)
		return value;

	return value.slice(0, Math.max(6, maxLength - 7)) + '...' + value.slice(-4);
}

function formatPortChoice(devName) {
	var value = String(devName || '');

	if (/^ttyUSB/.test(devName))
		return value + ' · AT';

	if (/^ttyACM/.test(devName))
		return value + ' · ACM';

	if (/^cdc-wdm/.test(devName))
		return value + ' · QMI';

	if (/^mhi_/.test(devName))
		return value + ' · MHI';

	if (/^wwan/.test(devName))
		return value + ' · WWAN';

	return value;
}

function formatTemplateChoice(name) {
	var value = String(name || '');
	var match = value.match(/^([0-9A-Fa-f]{8})(.+)$/);
	var suffix;

	if (!match)
		return compactLabel(value, 22);

	suffix = match[2].replace(/^[-_.]+/, '').replace(/[_]+/g, ' ').trim();

	return suffix ? (match[1] + ' · ' + compactLabel(suffix, 18)) : match[1];
}

return view.extend({
	load: function() {
		return Promise.all([
			resolveWithTimeout(fs.list('/dev'), []).then(function(devs) {
				return devs.filter(function(dev) {
					return dev.name.match(/^ttyUSB/) || dev.name.match(/^cdc-wdm/) || dev.name.match(/^ttyACM/) || dev.name.match(/^mhi_/) || dev.name.match(/^wwan/);
				});
			}),
			resolveWithTimeout(fs.exec_direct('/usr/bin/loaded.sh', [ 'json' ]), '{}')
		]);
	},

	renderStyle: function() {
		return E('style', { 'type': 'text/css' }, [
			'.mb-config-layout{display:block !important}',
			'.mb-config-shell{display:block;--mb-editor-log-bg:rgb(8,17,29);--mb-editor-log-fg:rgb(220,231,248);--mb-editor-log-border:rgba(124,147,186,.22);--mb-editor-log-shadow:0 12px 30px rgba(17,48,54,.08)}',
			'.mb-config-layout > .mb-config-shell{max-width:62rem}',
			'.mb-config-shell .cbi-map{max-width:62rem}',
			'.mb-config-shell .cbi-map h2{margin-bottom:.35rem}',
			'.mb-config-shell .cbi-map-descr{max-width:72ch}',
			'.mb-config-shell .cbi-tabmenu{margin-top:.75rem}',
			'.mb-config-shell .cbi-value[data-name="iface"] > .cbi-value-field,.mb-config-shell .cbi-value[data-name="restartcmd"] > .cbi-value-field,.mb-config-shell .cbi-value[data-name="modemid"] > .cbi-value-field{max-width:22rem}',
			'.mb-config-shell .cbi-value[data-name="set_port"] > .cbi-value-field{max-width:19rem}',
			'.mb-config-shell .cbi-value[data-name="wanrestart"] > .cbi-value-field,.mb-config-shell .cbi-value[data-name="modemrestart"] > .cbi-value-field,.mb-config-shell .cbi-value[data-name="notify"] > .cbi-value-field{max-width:22rem}',
			'.mb-config-shell .mb-config-editor-row{display:grid !important;grid-template-columns:1fr !important;align-items:start !important;padding-left:12px;padding-right:12px}',
			'.mb-config-shell .mb-config-editor-row > .cbi-value-title,.mb-config-shell .mb-config-editor-row > label.cbi-value-title{display:block !important;width:auto !important;max-width:none !important;margin:0 0 .4rem !important;padding:0 !important;text-align:left !important}',
			'.mb-config-shell .mb-config-editor-field,.mb-config-shell .mb-config-editor-field > div{width:100% !important;max-width:none !important;min-width:0 !important;margin:0 !important;justify-self:stretch !important}',
			'.mb-config-shell .mb-config-editor-textarea{display:block !important;width:min(100%,58rem) !important;max-width:58rem !important;min-height:30rem;padding:1rem 1.1rem;margin:0 auto !important;border:1px solid transparent !important;border-radius:16px;text-align:left;background:var(--mb-editor-log-bg) !important;color:var(--mb-editor-log-fg) !important;-webkit-text-fill-color:var(--mb-editor-log-fg);caret-color:var(--mb-editor-log-fg);font-family:Consolas,Monaco,monospace;line-height:1.55;resize:vertical;box-sizing:border-box;box-shadow:var(--mb-editor-log-shadow),0 0 0 1px var(--mb-editor-log-border),inset 0 0 0 1px rgba(255,255,255,.015);white-space:pre-wrap !important;overflow-wrap:anywhere !important;word-break:break-word !important}',
			'.mb-config-shell .mb-config-editor-description{width:min(100%,58rem);max-width:58rem;margin:10px auto 0 !important;text-align:left}',
			'.mb-config-shell .cbi-value[data-name="modemid"] select,.mb-config-shell .cbi-value[data-name="restartcmd"] input[type="text"],.mb-config-shell .cbi-value[data-name="restartcmd"] input:not([type]),.mb-config-shell .cbi-value[data-name="restartcmd"] .cbi-input-text{width:100% !important;font-family:Consolas,Monaco,monospace}',
			'.mb-config-shell .cbi-value[data-name="_template_loaded"] .cbi-value-field,.mb-config-shell .cbi-value[data-name="modemid"] select option{font-family:Consolas,Monaco,monospace}',
			'.mb-config-shell .cbi-dropdown{width:100% !important;max-width:22rem !important;min-height:3rem;box-sizing:border-box}',
			'.mb-config-shell .cbi-value[data-name="set_port"] .cbi-dropdown{max-width:19rem !important}',
			'.mb-config-shell .cbi-value[data-name="set_port"] .cbi-dropdown,.mb-config-shell .cbi-value[data-name="set_port"] .cbi-dropdown *{font-family:inherit !important}',
			'.mb-config-shell .cbi-dropdown > ul.preview,.mb-config-shell .cbi-dropdown > ul:not(.dropdown){flex:1 1 auto;min-width:0;overflow:hidden;display:flex;align-items:center;flex-wrap:nowrap}',
			'.mb-config-shell .cbi-dropdown > ul.preview > li,.mb-config-shell .cbi-dropdown > ul:not(.dropdown) > li{display:none !important;flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
			'.mb-config-shell .cbi-dropdown > ul.preview > li[selected],.mb-config-shell .cbi-dropdown > ul.preview > li[display="0"],.mb-config-shell .cbi-dropdown > ul:not(.dropdown) > li[selected],.mb-config-shell .cbi-dropdown > ul:not(.dropdown) > li[display="0"]{display:block !important}',
			'.mb-config-shell .cbi-dropdown > ul.preview > li > span,.mb-config-shell .cbi-dropdown > ul.preview > li > .ifacebadge,.mb-config-shell .cbi-dropdown > ul:not(.dropdown) > li > span,.mb-config-shell .cbi-dropdown > ul:not(.dropdown) > li > .ifacebadge{display:inline-flex;align-items:center;gap:.45rem;max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.mb-config-shell .cbi-value[data-name="iface"] .ifacebadge,.mb-config-shell .cbi-value[data-name="set_port"] .ifacebadge{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.mb-config-layout > .mb-config-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-start;width:100%;max-width:62rem;margin:12px 0 0;padding:12px 14px;border:1px solid rgba(76,108,157,.14);border-radius:16px;background:rgba(255,255,255,.03);box-sizing:border-box}',
			'.mb-config-layout > .mb-config-actions > *{margin:0 !important;float:none !important}',
			'.mb-config-layout > .mb-config-actions .cbi-button,.mb-config-layout > .mb-config-actions .cbi-dropdown{min-height:38px;border-radius:10px !important;box-shadow:none !important}',
			'body.dark .mb-config-layout > .mb-config-actions,html.dark .mb-config-layout > .mb-config-actions,body.mode-dark .mb-config-layout > .mb-config-actions,body.argon-dark .mb-config-layout > .mb-config-actions,html[data-theme="dark"] .mb-config-layout > .mb-config-actions,body[data-theme="dark"] .mb-config-layout > .mb-config-actions{border-color:rgba(124,147,186,.2);background:rgba(12,19,31,.52)}',
			'@media (max-width:640px){.mb-config-shell .cbi-value[data-name="iface"] > .cbi-value-field,.mb-config-shell .cbi-value[data-name="set_port"] > .cbi-value-field,.mb-config-shell .cbi-value[data-name="restartcmd"] > .cbi-value-field,.mb-config-shell .cbi-value[data-name="modemid"] > .cbi-value-field,.mb-config-shell .cbi-value[data-name="wanrestart"] > .cbi-value-field,.mb-config-shell .cbi-value[data-name="modemrestart"] > .cbi-value-field,.mb-config-shell .cbi-value[data-name="notify"] > .cbi-value-field,.mb-config-shell .cbi-dropdown{max-width:none !important}.mb-config-layout > .mb-config-actions .cbi-button,.mb-config-layout > .mb-config-actions .cbi-dropdown{width:100%;justify-content:center}}'
		].join('\n'));
	},

	render: function(data) {
		var devs = data[0] || [];
		var loadedData = data[1];
		var json = {};
		var modemName = '';
		var m, s, o;

		try {
			json = JSON.parse(loadedData || '{}');
		}
		catch (err) {
			ui.addNotification(null, E('p', _('Waiting to read data from the modem...')), 'warning');
			json = {};
		}

		modemName = (typeof(json.modem) == 'string') ? json.modem : '';

		m = new form.Map('modemband', _('Configuration'), _('Manage modem communication, restart behavior and template customization from one page.'));

		s = m.section(form.TypedSection, 'modemband', null, null);
		s.anonymous = true;
		s.addremove = false;
		s.tab('general', _('Device communication'));
		s.tab('actions', _('Restart and notification behavior'));
		s.tab('template', _('Template selection'));
		s.tab('editor', _('Template editor'));

		o = s.taboption('general', widgets.NetworkSelect, 'iface', _('Interface'),
			_('Network interface for Internet access.')
		);
		o.exclude = s.section;
		o.nocreate = true;
		o.rmempty = false;
		o.default = 'wan';

		o = s.taboption('general', form.Value, 'set_port', _('Port for communication with the modem'),
			_('Select one of the available ttyUSBX ports.'));
		devs.sort(function(a, b) {
			return String(a.name).localeCompare(String(b.name));
		});
		devs.forEach(function(dev) {
			o.value('/dev/' + dev.name, formatPortChoice(dev.name));
		});
		o.placeholder = _('Please select a port');
		o.rmempty = false;

		o = s.taboption('actions', form.Flag, 'wanrestart', _('Restart WAN'),
			_('WAN restart after making changes to bands.')
		);
		o.rmempty = false;

		o = s.taboption('actions', form.Flag, 'modemrestart', _('Modem restart'),
			_('Modem restart after making changes to bands.')
		);
		o.rmempty = false;

		o = s.taboption('actions', form.Value, 'restartcmd', _('Restart with AT command'),
			_('AT command to restart the modem.')
		);
		o.default = 'AT+CFUN=1,1';
		o.depends('modemrestart', '1');
		o.rmempty = false;

		o = s.taboption('actions', form.Flag, 'notify', _('Turn off notifications'),
			_('Checking this option disables the notification that appears every time the bands are changed.')
		);
		o.rmempty = false;

		o = s.taboption('template', form.DummyValue, '_template_loaded', _('Template loaded'));
		o.cfgvalue = function() {
			return modemName.length > 1 ? formatTemplateChoice(modemName) : '-';
		};

		o = s.taboption('template', form.ListValue, 'modemid', _('Select the modem settings file'),
			_('Select the template assigned to the Vendor and ProdID of the modem.'));
		o.load = function(section_id) {
			return resolveWithTimeout(fs.list('/usr/share/modemband'), []).then(L.bind(function(modems) {
				if (modems.length > 0) {
					modems.sort(function(a, b) {
						return String(a.name).localeCompare(String(b.name));
					});
					modems.forEach(function(entry) {
						if (entry && /^\d/.test(entry.name))
							this.value(entry.name, formatTemplateChoice(entry.name));
					}, this);
				}
				return this.super('load', [ section_id ]);
			}, this));
		};
		o.rmempty = false;
		o.default = modemName;
		o.cfgvalue = function(section_id) {
			return uci.get('modemband', section_id, 'modemid') || modemName;
		};
		o.write = function(section_id, value) {
			uci.set('modemband', '@modemband[0]', 'modemid', L.toArray(value).join(' '));
		};
		o.onchange = function(ev, section_id, value) {
			uci.set('modemband', '@modemband[0]', 'modemid', L.toArray(value).join(' '));
			return uci.save().then(function() {
				return uci.apply();
			}).then(function() {
				window.setTimeout(function() {
					location.reload();
				}, 1000);
			});
		};

		o = s.taboption('editor', form.TextValue, '_tmpl', _('Edit'),
			_('Supported bands depend on the region in which the modem operates. By modifying the DEFAULT_LTE_BANDS variable, you can easily adapt the package to your modem.'));
		o.rows = 18;
		o.wrap = 'soft';
		o.cfgvalue = function() {
			if (modemName.length > 1)
				return fs.trimmed('/usr/share/modemband/' + modemName);

			return '';
		};
		o.write = function(section_id, formvalue) {
			if (modemName.length < 1)
				return;

			return fs.write('/usr/share/modemband/' + modemName, String(formvalue || '').trim().replace(/\r\n/g, '\n') + '\n');
		};

		return m.render().then(L.bind(function(mapEl) {
			return normalizeTemplateEditor(normalizeActionLayout(applyThemeClass(E('div', { 'class': 'mb-config-shell' }, [
				this.renderStyle(),
				mapEl
			]), 'mb-dark')));
		}, this));
	}
});

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
			'.modemband-settings-page { --modemband-border: rgba(76, 108, 157, 0.14); --modemband-border-soft: rgba(76, 108, 157, 0.08); --modemband-shadow: 0 18px 38px rgba(25, 50, 87, 0.10); --modemband-card-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(240, 246, 255, 0.99)); --modemband-tab-bg: rgba(232, 240, 251, 0.88); --modemband-tab-active-bg: rgba(255, 255, 255, 0.98); --modemband-input-bg: rgba(255, 255, 255, 0.97); --modemband-input-border: rgba(76, 108, 157, 0.18); }',
			'.modemband-settings-page.modemband-dark, body.dark .modemband-settings-page, html.dark .modemband-settings-page, body.mode-dark .modemband-settings-page, body.argon-dark .modemband-settings-page, html[data-theme="dark"] .modemband-settings-page, body[data-theme="dark"] .modemband-settings-page { --modemband-border: rgba(124, 147, 186, 0.22); --modemband-border-soft: rgba(124, 147, 186, 0.16); --modemband-shadow: 0 20px 40px rgba(0, 0, 0, 0.28); --modemband-card-bg: linear-gradient(180deg, rgba(18, 28, 44, 0.96), rgba(10, 17, 29, 0.98)); --modemband-tab-bg: rgba(9, 15, 27, 0.88); --modemband-tab-active-bg: rgba(23, 35, 52, 0.96); --modemband-input-bg: rgba(8, 14, 24, 0.94); --modemband-input-border: rgba(124, 147, 186, 0.22); }',
			'.modemband-settings-page .cbi-map { display: flex; flex-direction: column; gap: 1rem; max-width: 62rem; }',
			'.modemband-settings-page .cbi-section {',
				'border: 1px solid var(--modemband-border);',
				'border-radius: 20px;',
				'overflow: visible;',
				'box-shadow: var(--modemband-shadow);',
				'background: var(--modemband-card-bg, var(--background-color-secondary, rgba(255, 255, 255, 0.96)));',
			'}',
			'.modemband-settings-page .cbi-page-actions { display: flex !important; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 0.8rem; margin: 0 !important; padding: 1rem 1.2rem !important; border: 1px solid var(--modemband-border); border-radius: 20px; box-shadow: var(--modemband-shadow); background: var(--modemband-card-bg, var(--background-color-secondary, rgba(255, 255, 255, 0.96))); }',
			'.modemband-settings-page .cbi-page-actions > * { margin: 0 !important; float: none !important; }',
			'.modemband-settings-page .cbi-page-actions .btn, .modemband-settings-page .cbi-page-actions .cbi-button, .modemband-settings-page .cbi-page-actions input[type="submit"], .modemband-settings-page .cbi-page-actions button { border-radius: 14px !important; }',
			'.modemband-settings-page .cbi-map-descr { max-width: 72ch; margin-bottom: 1.25rem; }',
			'.modemband-settings-page .cbi-section-node { padding: 0; background: transparent; }',
			'.modemband-settings-page .cbi-value { display: grid !important; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr) !important; gap: 1rem; align-items: start; padding: 1.05rem 1.2rem; border-top: 1px solid var(--modemband-border-soft); background: transparent !important; }',
			'.modemband-settings-page .cbi-value:first-child { border-top: 0; }',
			'.modemband-settings-page .cbi-value-title, .modemband-settings-page label.cbi-value-title { display: block !important; margin: 0 !important; padding: 0.2rem 1.2rem 0 0; line-height: 1.6; font-weight: 600; }',
			'.modemband-settings-page .cbi-value-field { display: block !important; width: 100% !important; max-width: none !important; min-width: 0 !important; }',
			'.modemband-settings-page .cbi-value-field > * { max-width: none; }',
			'.modemband-settings-page .cbi-value[data-name="iface"], .modemband-settings-page .cbi-value[data-name="set_port"], .modemband-settings-page .cbi-value[data-name="wanrestart"], .modemband-settings-page .cbi-value[data-name="modemrestart"], .modemband-settings-page .cbi-value[data-name="restartcmd"], .modemband-settings-page .cbi-value[data-name="notify"], .modemband-settings-page .cbi-value[data-name="_template_loaded"], .modemband-settings-page .cbi-value[data-name="modemid"] { grid-template-columns: 1fr !important; gap: 0.6rem; justify-items: start; align-items: stretch; padding-top: 1.15rem; padding-bottom: 1.15rem; }',
			'.modemband-settings-page .cbi-value[data-name="iface"] > .cbi-value-title, .modemband-settings-page .cbi-value[data-name="set_port"] > .cbi-value-title, .modemband-settings-page .cbi-value[data-name="wanrestart"] > .cbi-value-title, .modemband-settings-page .cbi-value[data-name="modemrestart"] > .cbi-value-title, .modemband-settings-page .cbi-value[data-name="restartcmd"] > .cbi-value-title, .modemband-settings-page .cbi-value[data-name="notify"] > .cbi-value-title, .modemband-settings-page .cbi-value[data-name="_template_loaded"] > .cbi-value-title, .modemband-settings-page .cbi-value[data-name="modemid"] > .cbi-value-title, .modemband-settings-page .cbi-value[data-name="iface"] > label.cbi-value-title, .modemband-settings-page .cbi-value[data-name="set_port"] > label.cbi-value-title, .modemband-settings-page .cbi-value[data-name="wanrestart"] > label.cbi-value-title, .modemband-settings-page .cbi-value[data-name="modemrestart"] > label.cbi-value-title, .modemband-settings-page .cbi-value[data-name="restartcmd"] > label.cbi-value-title, .modemband-settings-page .cbi-value[data-name="notify"] > label.cbi-value-title, .modemband-settings-page .cbi-value[data-name="_template_loaded"] > label.cbi-value-title, .modemband-settings-page .cbi-value[data-name="modemid"] > label.cbi-value-title { width: auto !important; max-width: 38rem; padding: 0 !important; text-align: left !important; justify-self: start; line-height: 1.45; }',
			'.modemband-settings-page .cbi-value[data-name="iface"] > .cbi-value-field, .modemband-settings-page .cbi-value[data-name="set_port"] > .cbi-value-field, .modemband-settings-page .cbi-value[data-name="restartcmd"] > .cbi-value-field, .modemband-settings-page .cbi-value[data-name="modemid"] > .cbi-value-field { width: min(100%, 34rem) !important; max-width: 34rem !important; }',
			'.modemband-settings-page .cbi-value[data-name="wanrestart"] > .cbi-value-field, .modemband-settings-page .cbi-value[data-name="modemrestart"] > .cbi-value-field, .modemband-settings-page .cbi-value[data-name="notify"] > .cbi-value-field { display: flex !important; flex-wrap: wrap; align-items: center; gap: 0.75rem; width: min(100%, 34rem) !important; max-width: 34rem !important; padding: 0.8rem 1rem; border: 1px solid var(--modemband-input-border); border-radius: 18px; background: var(--modemband-input-bg); box-sizing: border-box; }',
			'.modemband-settings-page .cbi-value[data-name="wanrestart"] input[type="checkbox"], .modemband-settings-page .cbi-value[data-name="modemrestart"] input[type="checkbox"], .modemband-settings-page .cbi-value[data-name="notify"] input[type="checkbox"] { width: 1.05rem; height: 1.05rem; margin: 0; accent-color: #4f8cff; }',
			'.modemband-settings-page .cbi-value[data-name="iface"] .cbi-value-description, .modemband-settings-page .cbi-value[data-name="set_port"] .cbi-value-description, .modemband-settings-page .cbi-value[data-name="restartcmd"] .cbi-value-description, .modemband-settings-page .cbi-value[data-name="wanrestart"] .cbi-value-description, .modemband-settings-page .cbi-value[data-name="modemrestart"] .cbi-value-description, .modemband-settings-page .cbi-value[data-name="notify"] .cbi-value-description, .modemband-settings-page .cbi-value[data-name="modemid"] .cbi-value-description { display: block; width: 100%; max-width: none; margin: 0.05rem 0 0; }',
			'.modemband-settings-page .cbi-value[data-name="_template_loaded"] > .cbi-value-field { display: inline-flex !important; align-items: center; gap: 0.55rem; width: auto !important; max-width: 34rem !important; padding: 0.78rem 1rem; border: 1px solid var(--modemband-input-border); border-radius: 18px; background: var(--modemband-tab-active-bg); font-family: Consolas, Monaco, monospace; font-weight: 600; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
			'.modemband-settings-page .cbi-value[data-name="iface"] .cbi-dropdown, .modemband-settings-page .cbi-value[data-name="set_port"] .cbi-dropdown, .modemband-settings-page .cbi-value[data-name="modemid"] .cbi-dropdown, .modemband-settings-page .cbi-value[data-name="iface"] select, .modemband-settings-page .cbi-value[data-name="set_port"] select, .modemband-settings-page .cbi-value[data-name="modemid"] select { width: 100% !important; max-width: none !important; }',
			'.modemband-settings-page .cbi-value[data-name="modemid"] select { min-height: 3.45rem; padding: 0.7rem 0.95rem; border: 1px solid var(--modemband-input-border); border-radius: 18px; background: var(--modemband-input-bg); box-sizing: border-box; }',
			'.modemband-settings-page .cbi-value[data-name="restartcmd"] input[type="text"], .modemband-settings-page .cbi-value[data-name="restartcmd"] input:not([type]), .modemband-settings-page .cbi-value[data-name="restartcmd"] .cbi-input-text { width: 100% !important; max-width: none !important; min-height: 3.25rem; padding: 0.72rem 0.95rem; border-radius: 16px; font-family: Consolas, Monaco, monospace; box-sizing: border-box; }',
			'.modemband-settings-page .cbi-value[data-name="_tmpl"] { grid-template-columns: 1fr !important; gap: 0.8rem; align-items: stretch; }',
			'.modemband-settings-page .cbi-value[data-name="_tmpl"] > .cbi-value-title, .modemband-settings-page .cbi-value[data-name="_tmpl"] > label.cbi-value-title { width: auto !important; max-width: 56rem; padding-right: 0; text-align: left !important; justify-self: start; }',
			'.modemband-settings-page .cbi-value[data-name="_tmpl"] > .cbi-value-field { max-width: 56rem !important; }',
			'.modemband-settings-page .cbi-value[data-name="_tmpl"] > .cbi-value-field > div { width: min(100%, 56rem) !important; max-width: 56rem !important; }',
			'.modemband-settings-page .cbi-value[data-name="_tmpl"] .cbi-value-description { max-width: 56rem; }',
			'.modemband-settings-page .cbi-tabmenu {',
				'display: flex;',
				'flex-wrap: wrap;',
				'gap: 0.6rem;',
				'padding: 1.1rem 1.2rem 0;',
				'margin: 0;',
				'border-bottom: 1px solid var(--modemband-border-soft);',
			'}',
			'.modemband-settings-page .cbi-tabmenu li, .modemband-settings-page .cbi-tabmenu li.cbi-tab, .modemband-settings-page .cbi-tabmenu li.cbi-tab-active, .modemband-settings-page .cbi-tabmenu li.cbi-tab-disabled { margin: 0 0 0.7rem; padding: 0 !important; width: auto !important; min-width: 0 !important; background: transparent !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }',
			'.modemband-settings-page .cbi-tabmenu li a {',
				'display: inline-flex !important;',
				'align-items: center;',
				'justify-content: center;',
				'min-height: 2.55rem;',
				'border-radius: 14px !important;',
				'padding: 0.62rem 0.92rem !important;',
				'font-weight: 600;',
				'line-height: 1.25;',
				'background: var(--modemband-tab-bg, rgba(226, 232, 240, 0.72)) !important;',
				'border: 1px solid var(--modemband-border-soft) !important;',
				'box-shadow: none !important;',
				'transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s ease;',
			'}',
			'.modemband-settings-page .cbi-tabmenu li.cbi-tab > a:hover,',
			'.modemband-settings-page .cbi-tabmenu li.cbi-tab-active > a {',
				'background: var(--modemband-tab-active-bg, var(--modemband-card-bg, rgba(255, 255, 255, 0.98))) !important;',
				'border-color: var(--modemband-border) !important;',
				'box-shadow: 0 10px 20px rgba(0, 0, 0, 0.16) !important;',
				'transform: translateY(-1px);',
			'}',
			'.modemband-settings-page .cbi-section-node .cbi-value,',
			'.modemband-settings-page .cbi-section-node .cbi-section-table-row {',
				'padding-left: 1.2rem;',
				'padding-right: 1.2rem;',
			'}',
			'.modemband-settings-page .cbi-section-node textarea {',
				'width: 100% !important;',
				'min-height: 30rem;',
				'padding: 1rem 1.1rem;',
				'border: 1px solid var(--modemband-input-border);',
				'border-radius: 18px;',
				'font-family: Consolas, Monaco, monospace;',
				'line-height: 1.55;',
				'background: var(--modemband-input-bg);',
				'border-color: var(--modemband-input-border);',
				'box-sizing: border-box;',
				'resize: vertical;',
				'white-space: pre-wrap !important;',
				'overflow-wrap: anywhere !important;',
				'word-break: break-word !important;',
				'overflow-x: auto !important;',
				'overflow-y: auto !important;',
			'}',
			'.modemband-settings-page .cbi-dropdown {',
				'width: min(100%, 31rem) !important;',
				'max-width: 31rem !important;',
				'display: flex !important;',
				'align-items: center;',
				'gap: 0.4rem;',
				'min-height: 3.6rem;',
				'padding: 0.45rem 2.8rem 0.45rem 0.55rem;',
				'border: 1px solid var(--modemband-input-border);',
				'border-radius: 18px;',
				'background: var(--modemband-input-bg);',
				'box-sizing: border-box;',
				'overflow: visible;',
			'}',
			'.modemband-settings-page .cbi-value[data-name="iface"] .cbi-dropdown, .modemband-settings-page .cbi-value[data-name="set_port"] .cbi-dropdown { width: 100% !important; max-width: none !important; }',
			'.modemband-settings-page .cbi-dropdown > ul.preview,',
			'.modemband-settings-page .cbi-dropdown > ul:not(.dropdown) {',
				'flex: 1 1 auto;',
				'width: auto !important;',
				'max-width: none !important;',
				'min-width: 0;',
				'min-height: 2.8rem;',
				'padding: 0;',
				'overflow: hidden;',
				'display: flex;',
				'align-items: center;',
				'flex-wrap: nowrap;',
			'}',
			'.modemband-settings-page .cbi-dropdown > ul.preview > li,',
			'.modemband-settings-page .cbi-dropdown > ul:not(.dropdown) > li {',
				'display: none !important;',
				'max-width: 100%;',
				'min-width: 0;',
				'flex: 1 1 auto;',
				'padding: 0;',
				'overflow: hidden;',
				'white-space: nowrap;',
				'text-overflow: ellipsis;',
			'}',
			'.modemband-settings-page .cbi-dropdown > ul.preview > li[selected],',
			'.modemband-settings-page .cbi-dropdown > ul.preview > li[display="0"],',
			'.modemband-settings-page .cbi-dropdown > ul:not(.dropdown) > li[selected],',
			'.modemband-settings-page .cbi-dropdown > ul:not(.dropdown) > li[display="0"] {',
				'display: block !important;',
				'width: 100%;',
			'}',
			'.modemband-settings-page .cbi-dropdown > ul.preview > li > span,',
			'.modemband-settings-page .cbi-dropdown > ul.preview > li > .ifacebadge,',
			'.modemband-settings-page .cbi-dropdown > ul:not(.dropdown) > li > span,',
			'.modemband-settings-page .cbi-dropdown > ul:not(.dropdown) > li > .ifacebadge {',
				'display: inline-flex;',
				'align-items: center;',
				'gap: 0.65rem;',
				'width: 100%;',
				'max-width: 100%;',
				'min-width: 0;',
				'min-height: 2.8rem;',
				'padding: 0.42rem 0.9rem;',
				'border-radius: 14px;',
				'overflow: hidden;',
				'text-overflow: ellipsis;',
				'white-space: nowrap;',
				'box-sizing: border-box;',
			'}',
			'.modemband-settings-page .cbi-dropdown > ul.dropdown {',
				'min-width: 100% !important;',
				'width: max-content !important;',
				'max-width: min(40rem, calc(100vw - 2rem));',
				'padding: 0.55rem;',
				'border: 1px solid var(--modemband-input-border);',
				'border-radius: 18px;',
				'background: var(--modemband-input-bg);',
				'box-sizing: border-box;',
				'overflow: auto;',
				'max-height: 18rem;',
				'z-index: 80;',
			'}',
			'.modemband-settings-page .cbi-dropdown > ul.dropdown > li {',
				'display: block;',
				'padding: 0;',
				'border-radius: 14px;',
				'overflow: hidden;',
			'}',
			'.modemband-settings-page .cbi-dropdown > ul.dropdown > li > span,',
			'.modemband-settings-page .cbi-dropdown > ul.dropdown > li > .ifacebadge {',
				'display: flex;',
				'align-items: center;',
				'gap: 0.65rem;',
				'width: 100%;',
				'min-height: 2.9rem;',
				'padding: 0.5rem 1rem;',
				'border-radius: 14px;',
				'white-space: nowrap;',
				'box-sizing: border-box;',
			'}',
			'.modemband-settings-page .cbi-dropdown > ul.dropdown > li[selected] > span,',
			'.modemband-settings-page .cbi-dropdown > ul.dropdown > li[selected] > .ifacebadge,',
			'.modemband-settings-page .cbi-dropdown > ul.dropdown > li:hover > span,',
			'.modemband-settings-page .cbi-dropdown > ul.dropdown > li:hover > .ifacebadge {',
				'background: var(--modemband-tab-active-bg);',
			'}',
			'.modemband-settings-page .cbi-dropdown > .more { display: none !important; }',
			'.modemband-settings-page .cbi-dropdown > .open {',
				'right: 0.45rem;',
				'display: flex;',
				'align-items: center;',
				'justify-content: center;',
				'min-width: 1.55rem;',
				'height: calc(100% - 0.9rem);',
				'padding: 0;',
				'border-radius: 12px;',
			'}',
			'.modemband-settings-page input[type="text"],',
			'.modemband-settings-page input[type="password"],',
			'.modemband-settings-page select { background: var(--modemband-input-bg); border-color: var(--modemband-input-border); }',
			'.modemband-settings-page .cbi-value-description { max-width: 72ch; }',
			'@media (max-width: 768px) {',
				'.modemband-settings-page .cbi-section { border-radius: 16px; }',
				'.modemband-settings-page .cbi-page-actions { padding: 0.9rem !important; border-radius: 16px; justify-content: stretch; }',
				'.modemband-settings-page .cbi-page-actions > * { width: 100%; }',
				'.modemband-settings-page .cbi-tabmenu { padding: 1rem 0.9rem 0; gap: 0.45rem; }',
				'.modemband-settings-page .cbi-tabmenu li a { width: 100%; justify-content: flex-start; }',
				'.modemband-settings-page .cbi-value { grid-template-columns: 1fr !important; gap: 0.65rem; }',
				'.modemband-settings-page .cbi-value-title, .modemband-settings-page label.cbi-value-title { padding-right: 0; }',
				'.modemband-settings-page .cbi-dropdown { width: 100% !important; max-width: none !important; padding-right: 2.4rem; }',
				'.modemband-settings-page .cbi-section-node .cbi-value,',
				'.modemband-settings-page .cbi-section-node .cbi-section-table-row {',
					'padding-left: 0.9rem;',
					'padding-right: 0.9rem;',
				'}',
			'}'
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
			o.value('/dev/' + dev.name);
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
			return 'modemband / ' + (modemName.length > 1 ? modemName : '-');
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
							this.value(entry.name);
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
			return applyThemeClass(E('div', { 'class': 'modemband-settings-page' }, [
				this.renderStyle(),
				mapEl
			]), 'modemband-dark');
		}, this));
	}
});

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
			'.modemband-settings-page .cbi-map { max-width: 1180px; }',
			'.modemband-settings-page .cbi-section {',
				'border: 1px solid var(--modemband-border);',
				'border-radius: 20px;',
				'overflow: hidden;',
				'box-shadow: var(--modemband-shadow);',
				'background: var(--modemband-card-bg, var(--background-color-secondary, rgba(255, 255, 255, 0.96)));',
			'}',
			'.modemband-settings-page .cbi-map-descr { max-width: 72ch; margin-bottom: 1.25rem; }',
			'.modemband-settings-page .cbi-tabmenu {',
				'display: flex;',
				'flex-wrap: wrap;',
				'gap: 0.6rem;',
				'padding: 1.1rem 1.2rem 0;',
				'margin: 0;',
				'border-bottom: 1px solid var(--modemband-border-soft);',
			'}',
			'.modemband-settings-page .cbi-tabmenu li { margin: 0 0 0.9rem; }',
			'.modemband-settings-page .cbi-tabmenu li a {',
				'border-radius: 999px;',
				'padding: 0.62rem 1rem;',
				'font-weight: 600;',
				'background: var(--modemband-tab-bg, rgba(226, 232, 240, 0.72));',
				'border: 1px solid transparent;',
				'transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;',
			'}',
			'.modemband-settings-page .cbi-tabmenu li.cbi-tab > a:hover,',
			'.modemband-settings-page .cbi-tabmenu li.cbi-tab-active > a {',
				'background: var(--modemband-tab-active-bg, var(--modemband-card-bg, rgba(255, 255, 255, 0.98)));',
				'border-color: var(--modemband-border);',
				'transform: translateY(-1px);',
			'}',
			'.modemband-settings-page .cbi-section-node .cbi-value,',
			'.modemband-settings-page .cbi-section-node .cbi-section-table-row {',
				'padding-left: 1.2rem;',
				'padding-right: 1.2rem;',
			'}',
			'.modemband-settings-page .cbi-section-node textarea {',
				'min-height: 26rem;',
				'font-family: Consolas, Monaco, monospace;',
				'line-height: 1.55;',
				'background: var(--modemband-input-bg);',
				'border-color: var(--modemband-input-border);',
			'}',
			'.modemband-settings-page input[type="text"],',
			'.modemband-settings-page input[type="password"],',
			'.modemband-settings-page select { background: var(--modemband-input-bg); border-color: var(--modemband-input-border); }',
			'.modemband-settings-page .cbi-value-description { max-width: 72ch; }',
			'@media (max-width: 768px) {',
				'.modemband-settings-page .cbi-section { border-radius: 16px; }',
				'.modemband-settings-page .cbi-tabmenu { padding: 1rem 0.9rem 0; gap: 0.45rem; }',
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

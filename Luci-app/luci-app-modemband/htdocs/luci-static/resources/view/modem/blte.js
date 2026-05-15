'use strict';
'require form';
'require fs';
'require view';
'require ui';
'require uci';
'require poll';
'require dom';

var BAND_TECHS = [
	{
		key: 'lte',
		option: 'set_bands',
		action: 'setbands',
		supported: 'supported',
		enabled: 'enabled',
		prefix: 'B',
		title: _('Preferred LTE bands'),
		currentTitle: _('Currently set LTE bands'),
		supportedTitle: _('Supported LTE bands'),
		error: _('LTE bands cannot be read. Check if your modem supports this technology and if it is in the list of supported modems.')
	},
	{
		key: '5gsa',
		option: 'set_5gsabands',
		action: 'setbands5gsa',
		supported: 'supported5gsa',
		enabled: 'enabled5gsa',
		prefix: 'n',
		title: _('Preferred 5G SA bands'),
		currentTitle: _('Currently set 5G SA bands'),
		supportedTitle: _('Supported 5G SA bands'),
		error: _('5G bands cannot be read. Check if your modem supports this technology and if it is in the list of supported modems.')
	},
	{
		key: '5gnsa',
		option: 'set_5gnsabands',
		action: 'setbands5gnsa',
		supported: 'supported5gnsa',
		enabled: 'enabled5gnsa',
		prefix: 'n',
		title: _('Preferred 5G NSA bands'),
		currentTitle: _('Currently set 5G NSA bands'),
		supportedTitle: _('Supported 5G NSA bands'),
		error: _('5G bands cannot be read. Check if your modem supports this technology and if it is in the list of supported modems.')
	}
];

var currentBandJson = {};
var applyBandsHandler = null;

var CBISelectswitch = form.DummyValue.extend({
	renderWidget: function(section_id, option_id, cfgvalue) {
		var section = this.section;
		var option = this.bandOption;

		return E('span', { 'class': 'control-group mb-band-actions' }, [
			E('button', {
				'class': 'cbi-button cbi-button-neutral',
				'click': ui.createHandlerFn(this, function() {
					var dropdown = section.getUIElement(section_id, option);

					if (dropdown)
						dropdown.setValue([]);
				})
			}, _('Deselect all')),
			' ',
			E('button', {
				'class': 'cbi-button cbi-button-action important',
				'click': ui.createHandlerFn(this, function() {
					var dropdown = section.getUIElement(section_id, option);

					if (dropdown)
						dropdown.setValue(Object.keys(dropdown.choices || {}));
				})
			}, _('Select all')),
			' ',
			E('button', {
				'class': 'cbi-button cbi-button-save',
				'click': ui.createHandlerFn(this, function() {
					if (typeof(applyBandsHandler) == 'function')
						return applyBandsHandler();
				})
			}, _('Apply changes'))
		]);
	}
});

var cbiRichListValue = form.ListValue.extend({
	renderWidget: function(section_id, option_index, cfgvalue) {
		var choices = this.transformChoices();
		var widget = new ui.Dropdown((cfgvalue != null) ? cfgvalue : this.default, choices, {
			id: this.cbid(section_id),
			sort: this.keylist,
			optional: true,
			multiple: true,
			display_items: 6,
			dropdown_items: 12,
			select_placeholder: this.select_placeholder || this.placeholder,
			custom_placeholder: this.custom_placeholder || this.placeholder,
			validate: L.bind(this.validate, this, section_id),
			disabled: (this.readonly != null) ? this.readonly : this.map.readonly
		});

		return widget.render();
	},

	value: function(value, title, description) {
		if (description) {
			form.ListValue.prototype.value.call(this, value, E([], [
				E('span', { 'class': 'hide-open' }, [ title ]),
				E('div', { 'class': 'hide-close mb-band-choice' }, [
					E('strong', [ title ]),
					E('br'),
					E('span', description)
				])
			]));
		}
		else {
			form.ListValue.prototype.value.call(this, value, title);
		}
	}
});

var BANDmagic = form.DummyValue.extend({
	load: function() {
		this.default = E('div', { 'class': 'mb-toolbar' }, [
			E('button', {
				'class': 'cbi-button cbi-button-neutral',
				'click': ui.createHandlerFn(this, function() {
					location.reload();
				})
			}, _('Refresh')),
			E('button', {
				'class': 'cbi-button cbi-button-reset',
				'click': ui.createHandlerFn(this, function() {
					return handleRestoreDefault();
				})
			}, _('Restore default bands'))
		]);

		return this.default;
	}
});

var SYSTmagic = form.DummyValue.extend({
	load: function() {
		this.default = E('div', { 'class': 'mb-toolbar' }, [
			E('button', {
				'class': 'cbi-button cbi-button-neutral',
				'click': ui.createHandlerFn(this, function() {
					return restartWan();
				})
			}, _('Restart')),
			E('button', {
				'class': 'cbi-button cbi-button-neutral',
				'click': ui.createHandlerFn(this, function() {
					return rebootDevice();
				})
			}, _('Perform reboot'))
		]);

		return this.default;
	}
});

function parseJson(data) {
	try {
		return JSON.parse(data || '{}');
	}
	catch (err) {
		console.log('modemband: invalid json: ' + err.message);
		return { error: err.message };
	}
}

function bandValue(value) {
	if (value == null)
		return '';

	if (typeof(value) == 'object' && value.band != null)
		value = value.band;

	return String(value);
}

function bandNumber(value) {
	var match = bandValue(value).match(/\d+$/);

	return match ? match[0] : bandValue(value);
}

function normalizeBands(values) {
	var normalized = [];
	var seen = {};

	values = L.toArray(values);

	for (var i = 0; i < values.length; i++) {
		var value = bandValue(values[i]);

		if (value === '' || seen[value])
			continue;

		seen[value] = true;
		normalized.push(value);
	}

	return normalized;
}

function serializeBands(values) {
	return normalizeBands(values).join(' ');
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

function hasBandData(json, tech) {
	return Array.isArray(json[tech.supported]) && Array.isArray(json[tech.enabled]) && json[tech.supported].length > 0;
}

function formatBandList(values, prefix, enabled) {
	var bands = normalizeBands(values).map(function(value) {
		return prefix + bandNumber(value);
	});

	if (enabled && bands.indexOf(prefix + '0') > -1)
		return _('Bands are disabled...');

	return bands.length ? bands.join('  ') : '-';
}

function handleErrors(json) {
	if (!json || !json.error)
		return;

	if (json.error.indexOf('No supported') > -1)
		ui.addNotification(null, E('p', _('No supported modem was found, quitting...')), 'error');
	else if (json.error.indexOf('Port not found') > -1)
		ui.addNotification(null, E('p', _('Port not found, quitting...')), 'error');
	else
		ui.addNotification(null, E('p', _('The modemband error.')), 'error');
}

function renderStyle() {
	return E('style', [
		'#maincontent .alert-message{opacity:1;transform:translateY(0);transition:opacity .2s ease,transform .2s ease}',
		'#maincontent .alert-message.fade-out{opacity:0;transform:translateY(-8px);pointer-events:none}',
		'.mb-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:.75rem 0 1.25rem;--mb-panel-border:rgba(76,108,157,.14);--mb-panel-border-soft:rgba(76,108,157,.08);--mb-panel-bg:linear-gradient(180deg,rgba(255,255,255,.99),rgba(240,246,255,.99));--mb-label-color:#60708a}',
		'.mb-summary.mb-dark,body.dark .mb-summary,html.dark .mb-summary,body.mode-dark .mb-summary,body.argon-dark .mb-summary,html[data-theme="dark"] .mb-summary,body[data-theme="dark"] .mb-summary{--mb-panel-border:rgba(124,147,186,.22);--mb-panel-border-soft:rgba(124,147,186,.16);--mb-panel-bg:linear-gradient(180deg,rgba(18,28,44,.96),rgba(10,17,29,.98));--mb-label-color:#a8b7c7}',
		'.mb-panel{border:1px solid var(--mb-panel-border);border-radius:8px;padding:14px;background:var(--mb-panel-bg)}',
		'.mb-panel h3{margin:0 0 10px;font-size:1.05rem}',
		'.mb-row{display:grid;grid-template-columns:minmax(110px,38%) 1fr;gap:10px;padding:7px 0;border-top:1px solid var(--mb-panel-border-soft)}',
		'.mb-row:first-of-type{border-top:0}',
		'.mb-label{color:var(--mb-label-color)}',
		'.mb-value{font-weight:600;word-break:break-word}',
		'.mb-toolbar,.mb-band-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
		'.mb-toolbar .cbi-button,.mb-band-actions .cbi-button{border-radius:10px;box-shadow:none}',
		'.mb-band-choice{min-width:min(28rem,72vw);white-space:normal}',
		'.mb-band-choice span{white-space:normal}',
		'@media (max-width:640px){.mb-row{grid-template-columns:1fr}.mb-panel{padding:12px}.mb-toolbar .cbi-button{width:100%;justify-content:center}}'
	].join('\n'));
}

function renderSummary(json) {
	var summary = applyThemeClass(E('div', { 'class': 'mb-summary' }, BAND_TECHS.map(function(tech) {
		var supported = hasBandData(json, tech);

		return E('div', { 'class': 'mb-panel' }, [
			E('h3', tech.title),
			E('div', { 'class': 'mb-row' }, [
				E('div', { 'class': 'mb-label' }, _('Modem')),
				E('div', { 'class': 'mb-value' }, json.modem || '-')
			]),
			E('div', { 'class': 'mb-row' }, [
				E('div', { 'class': 'mb-label' }, tech.currentTitle),
				E('div', { 'class': 'mb-value', 'id': 'mb-current-' + tech.key }, supported ? formatBandList(json[tech.enabled], tech.prefix, true) : '-')
			]),
			E('div', { 'class': 'mb-row' }, [
				E('div', { 'class': 'mb-label' }, tech.supportedTitle),
				E('div', { 'class': 'mb-value' }, supported ? formatBandList(json[tech.supported], tech.prefix, false) : '-')
			]),
			supported ? '' : E('p', { 'class': 'cbi-section-descr' }, tech.error)
		]);
	})), 'mb-dark');

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', _('Modem information')),
		summary
	]);
}

function updateCurrentBands(json) {
	for (var i = 0; i < BAND_TECHS.length; i++) {
		var tech = BAND_TECHS[i];
		var node = document.getElementById('mb-current-' + tech.key);

		if (!node)
			continue;

		node.textContent = hasBandData(json, tech) ? formatBandList(json[tech.enabled], tech.prefix, true) : '-';
	}
}

function handleRestoreDefault() {
	if (!confirm(_('Do you really want to set up all possible bands for the modem?')))
		return;

	var tasks = BAND_TECHS.filter(function(tech) {
		return hasBandData(currentBandJson, tech);
	}).map(function(tech) {
		return fs.exec_direct('/usr/bin/modemband.sh', [ tech.action, 'default' ]);
	});

	if (!tasks.length) {
		ui.addNotification(null, E('p', _('No supported modem was found, quitting...')), 'error');
		return;
	}

	return Promise.all(tasks).then(function() {
		return uci.load('modemband').then(function() {
			var notify = uci.get('modemband', '@modemband[0]', 'notify');

			if (notify != '1' || notify == null)
				ui.addNotification(null, E('p', _('The new bands settings have been sent to the modem. If the changes are not visible, a restart of the connection, modem or router may be required.')), 'info');
		});
	});
}

function restartWan() {
	return uci.load('modemband').then(function() {
		var wname = uci.get('modemband', '@modemband[0]', 'iface') || 'wan';

		wname = wname.replace(/@/g, '');
		fs.exec('/sbin/ifdown', [ wname ]);
		fs.exec('sleep', [ '3' ]);
		fs.exec('/sbin/ifup', [ wname ]);
	});
}

function rebootDevice() {
	if (!confirm(_('Do you really want to restart the device?')))
		return;

	L.ui.showModal(_('Rebooting…'), [
		E('p', { 'class': 'spinning' }, _('Waiting for device...'))
	]);

	return fs.exec('/sbin/reboot');
}

function restartAfterApply() {
	return uci.load('modemband').then(function() {
		var wrestart = uci.get('modemband', '@modemband[0]', 'wanrestart');
		var mrestart = uci.get('modemband', '@modemband[0]', 'modemrestart');
		var cmdrestart = uci.get('modemband', '@modemband[0]', 'restartcmd');
		var wname = uci.get('modemband', '@modemband[0]', 'iface') || 'wan';
		var sport = uci.get('modemband', '@modemband[0]', 'set_port');

		wname = wname.replace(/@/g, '');

		if (wrestart == '1') {
			fs.exec('/sbin/ifdown', [ wname ]);
			fs.exec('sleep', [ '3' ]);
			fs.exec('/sbin/ifup', [ wname ]);
		}

		if (mrestart == '1' && sport && cmdrestart) {
			fs.exec('sleep', [ '20' ]);
			fs.exec_direct('/usr/bin/sms_tool', [ '-d', sport, 'at', cmdrestart ]);
		}
	});
}

return view.extend({
	formdata: { modemband: {} },
	bandState: {},
	json: {},

	load: function() {
		return L.resolveDefault(fs.exec_direct('/usr/bin/modemband.sh', [ 'json' ]), '{}');
	},

	render: function(data) {
		var m, s, o;
		var json = parseJson(data);
		var info = _('Configuration modem frequency bands. More information about the modemband application on the %seko.one.pl forum%s.').format('<a href="https://eko.one.pl/?p=openwrt-modemband" target="_blank">', '</a>');

		this.json = json;
		currentBandJson = json;
		this.bandState = {};
		handleErrors(json);

		for (var i = 0; i < BAND_TECHS.length; i++) {
			var tech = BAND_TECHS[i];

			if (hasBandData(json, tech))
				this.bandState[tech.key] = serializeBands(json[tech.enabled]);
		}

		m = new form.JSONMap(this.formdata, _('Band Settings'), info);

		s = m.section(form.TypedSection, 'modemband', '', '');
		s.anonymous = true;
		s.render = L.bind(function() {
			return E([], [ renderStyle(), renderSummary(json) ]);
		}, this);

		s = m.section(form.TypedSection, 'modemband', _('Preferred bands settings'));
		s.anonymous = true;
		s.addremove = false;

		for (var j = 0; j < BAND_TECHS.length; j++) {
			var bandTech = BAND_TECHS[j];

			s.tab(bandTech.key, bandTech.title, hasBandData(json, bandTech) ? '' : bandTech.error);

			if (!hasBandData(json, bandTech)) {
				o = s.taboption(bandTech.key, form.DummyValue, '_unsupported_' + bandTech.key, _('Modem information'));
				o.default = E('em', bandTech.error);
				continue;
			}

			o = s.taboption(bandTech.key, cbiRichListValue, bandTech.option, _('Modification of the bands'), _('Select the preferred band(s) for the modem.'));

			for (var k = 0; k < json[bandTech.supported].length; k++) {
				var item = json[bandTech.supported][k];
				var value = bandValue(item);
				o.value(value, bandTech.prefix + bandNumber(item), item.txt);
			}

			o.multiple = true;
			o.placeholder = _('Please select a band(s)');
			o.cfgvalue = (function(currentTech) {
				return function(section_id) {
					return normalizeBands(json[currentTech.enabled]);
				};
			})(bandTech);

			o = s.taboption(bandTech.key, CBISelectswitch, '_switch_' + bandTech.key, _('Band selection switch'));
			o.bandOption = bandTech.option;
		}

		s = m.section(form.TypedSection);
		s.anonymous = true;
		o = s.option(BANDmagic);

		s = m.section(form.TypedSection, 'modemband', _('Additional options'), _('Additional options useful for modem configuration.'));
		s.anonymous = true;
		s.tab('restart', _('Connection / router restart'));

		o = s.taboption('restart', form.DummyValue, '_restart_hint');
		o.rawhtml = true;
		o.default = '<div class="cbi-section-descr">' + _('Hint: The name of the WAN section can be changed in the package settings panel.') + '</div>';

		o = s.taboption('restart', SYSTmagic);

		poll.add(function() {
			return L.resolveDefault(fs.exec_direct('/usr/bin/modemband.sh', [ 'json' ]), '{}').then(function(res) {
				updateCurrentBands(parseJson(res));
			});
		});

		applyBandsHandler = L.bind(this.handleBANDZSETup, this);

		return m.render();
	},

	handleBANDZSETup: function(ev) {
		var map = document.querySelector('#maincontent .cbi-map');
		var data = this.formdata;
		var changed = [];
		var self = this;

		return dom.callClassMethod(map, 'save').then(function() {
			for (var i = 0; i < BAND_TECHS.length; i++) {
				var tech = BAND_TECHS[i];
				var original = self.bandState[tech.key];

				if (original == null)
					continue;

				var value = data.modemband[tech.option];
				var selected = value == null ? original : serializeBands(value);

				if (selected === original)
					continue;

				if (selected.length < 1) {
					ui.addNotification(null, E('p', _('Check if you have selected the bands correctly.')), 'info');
					return;
				}

				changed.push({ tech: tech, value: selected });
			}

			if (!changed.length) {
				ui.addNotification(null, E('p', _('No band changes to apply.')), 'info');
				return;
			}

			var tasks = changed.map(function(item) {
				return fs.exec_direct('/usr/bin/modemband.sh', [ item.tech.action, item.value ]);
			});

			return Promise.all(tasks).then(function() {
				return uci.load('modemband').then(function() {
					var notify = uci.get('modemband', '@modemband[0]', 'notify');

					if (notify != '1' || notify == null)
						ui.addNotification(null, E('p', _('The new bands settings have been sent to the modem. If the changes are not visible, a restart of the connection, modem or router may be required.')), 'info');

					return restartAfterApply();
				});
			});
		});
	},

	addFooter: function() {
		return E('div', { 'class': 'cbi-page-actions', 'style': 'display:none' }, [
			E('button', {
				'class': 'cbi-button cbi-button-save',
				'click': L.ui.createHandlerFn(this, 'handleBANDZSETup')
			}, [ _('Apply changes') ])
		]);
	}
});
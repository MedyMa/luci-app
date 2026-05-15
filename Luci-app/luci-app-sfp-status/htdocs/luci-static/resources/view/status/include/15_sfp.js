'use strict';
'require baseclass';
'require rpc';
'require uci';

const callGetStatuses = rpc.declare({
	object: 'luci.sfp-status',
	method: 'getStatuses',
	params: [ 'interface' ],
	expect: {}
});

let lastSuccessfulReply = null;

function resolveWithTimeout(promise, fallback, timeoutMs) {
	return new Promise(function(resolve) {
		let settled = false;
		const timer = window.setTimeout(function() {
			if (settled)
				return;

			settled = true;
			resolve(fallback);
		}, timeoutMs > 0 ? timeoutMs : 4000);

		Promise.resolve(L.resolveDefault(promise, fallback)).then(function(value) {
			if (settled)
				return;

			settled = true;
			window.clearTimeout(timer);
			resolve(value);
		}).catch(function() {
			if (settled)
				return;

			settled = true;
			window.clearTimeout(timer);
			resolve(fallback);
		});
	});
}

function valueOrDash(value) {
	if (value == null)
		return '-';

	const stringValue = String(value).trim();
	return stringValue !== '' ? stringValue : '-';
}

function normalizeContent(content) {
	return Array.isArray(content) ? content : [ content ];
}

function buildTable(fields, status) {
	const table = E('table', { 'class': 'table' });

	for (let index = 0; index < fields.length; index++) {
		const field = fields[index];
		const content = field.render ? field.render(status) : valueOrDash(status?.[field.key]);

		table.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', {
				'class': 'td left',
				'width': '33%'
			}, [ field.label ]),
			E('td', {
				'class': 'td left'
			}, normalizeContent(content))
		]));
	}

	return table;
}

const widgetStyle = [
	'.sfp-overview-widget .table{margin:0}'
].join('\n');

function buildModuleBlock(title, fields, status) {
	const children = [];

	if (title)
		children.push(E('div', { 'class': 'sfp-module-title' }, [ title ]));

	children.push(E('div', {}, [ buildTable(fields, status) ]));

	return E('div', { 'class': 'sfp-module' }, children);
}

function buildMergedOverview(modules) {
	const fields = [
		{ label: _('SFP Name'), key: 'module_name' },
		{ label: _('Temperature'), key: 'temperature' },
		{ label: _('SFP Speed'), key: 'speed' },
		{ label: _('Voltage'), key: 'voltage' },
		{ label: _('Bias Current'), key: 'bias_current' },
		{ label: _('RX Power'), key: 'rx_power' },
		{ label: _('TX Power'), key: 'tx_power' }
	];
	const table = E('table', { 'class': 'table' });
	const headerCells = [
		E('th', { 'class': 'th left', 'width': '24%' }, [ _('Module') ])
	];

	for (let index = 0; index < modules.length; index++)
		headerCells.push(E('th', { 'class': 'th left' }, [ valueOrDash(modules[index]?.module_slot || modules[index]?.interface) ]));

	table.appendChild(E('tr', { 'class': 'tr table-titles' }, headerCells));

	for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
		const field = fields[fieldIndex];
		const rowCells = [
			E('td', { 'class': 'td left', 'width': '24%' }, [ field.label ])
		];

		for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
			rowCells.push(E('td', { 'class': 'td left' }, normalizeContent(valueOrDash(modules[moduleIndex]?.[field.key]))));
		}

		table.appendChild(E('tr', { 'class': 'tr' }, rowCells));
	}

	return table;
}

function renderUnavailable(status) {
	return buildModuleBlock(null, [
		{ label: _('Status'), render: function() { return valueOrDash(status?.error || _('Unavailable')); } },
		{ label: _('Interface'), render: function() { return valueOrDash(status?.interface); } },
		{ label: _('Available Interfaces'), render: function() {
			const interfaces = Array.isArray(status?.interfaces) ? status.interfaces : [];
			return interfaces.length ? interfaces.join(', ') : '-';
		} }
	], status || {});
}


function buildModuleFields(status, options) {
	const fields = [];
	const sectionTitle = options && options.sectionTitle;

	if (options && options.showModuleRow)
		fields.push({ label: _('Module'), render: function() { return valueOrDash(status?.module_slot || status?.interface); } });

	if (status?.interface && String(status.interface) !== String(sectionTitle))
		fields.push({ label: _('Interface'), render: function() { return valueOrDash(status.interface); } });

	fields.push(
		{ label: _('SFP Name'), key: 'module_name' },
		{ label: _('Temperature'), key: 'temperature' },
		{ label: _('SFP Speed'), key: 'speed' },
		{ label: _('Voltage'), key: 'voltage' },
		{ label: _('Bias Current'), key: 'bias_current' },
		{ label: _('RX Power'), key: 'rx_power' },
		{ label: _('TX Power'), key: 'tx_power' }
	);

	return fields;
}

function renderModuleOverview(status, options) {
	if (!status || status.supported === false)
		return renderUnavailable(status);

	const sectionTitle = options && options.title ? options.title : _('SFP');

	return buildModuleBlock(sectionTitle, buildModuleFields(status, {
		sectionTitle: sectionTitle,
		showModuleRow: options && options.showModuleRow
	}), status);
}

function renderOverview(reply) {
	const modules = Array.isArray(reply?.modules) ? reply.modules : [];
	const children = [ E('style', {}, widgetStyle) ];

	if (!modules.length)
		children.push(renderUnavailable(reply));
	else if (modules.length === 1)
		children.push(renderModuleOverview(modules[0], {
			title: null,
			showModuleRow: true
		}));
	else
		children.push(buildMergedOverview(modules));

	return E('div', { 'class': 'sfp-overview-widget' }, children);
}

function loadStatuses(interfaceName, timeoutMs) {
	const fallback = {
		supported: false,
		interfaces: [],
		modules: [],
		interface: interfaceName || '',
		error: _('Unavailable')
	};

	return new Promise(function(resolve) {
		let settled = false;
		const timer = window.setTimeout(function() {
			if (settled)
				return;

			settled = true;
			resolve(lastSuccessfulReply || fallback);
		}, timeoutMs > 0 ? timeoutMs : 6000);

		Promise.resolve(callGetStatuses(interfaceName)).then(function(status) {
			if (settled)
				return;

			settled = true;
			window.clearTimeout(timer);

			if (Array.isArray(status?.modules) && status.modules.length)
				lastSuccessfulReply = status;

			resolve(status || fallback);
		}).catch(function() {
			if (settled)
				return;

			settled = true;
			window.clearTimeout(timer);
			resolve(lastSuccessfulReply || fallback);
		});
	});
}

return baseclass.extend({
	title: _('SFP'),

	load() {
		return Promise.all([
			resolveWithTimeout(uci.load('sfp-status'), null, 2500),
			L.resolveDefault(loadStatuses(''), {})
		]);
	},

	render(data) {
		const enabled = uci.get('sfp-status', 'settings', 'overview_enabled');

		if (enabled === '0')
			return null;

		return renderOverview(data ? data[1] : null);
	}
});
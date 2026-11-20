'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

const getStatus = rpc.declare({ object: 'luci.unifi', method: 'status', expect: { '': {} } });
const configure = rpc.declare({ object: 'luci.unifi', method: 'configure', params: ['previous', 'settings'], expect: { '': {} } });
const setModel = rpc.declare({ object: 'luci.unifi', method: 'set_model', params: ['mac', 'previous', 'model'], expect: { '': {} } });
const bands = { ng: '2.4 GHz', na: '5 GHz', '6e': '6 GHz' };
const unknown = '—';

function t(value) {
	return document.createTextNode(value == null || value === '' ? unknown : String(value));
}

function div(cls, children) {
	return E('div', { 'class': cls }, children);
}

function btn(label, cls, action) {
	return E('button', { type: 'button', 'class': cls, click: action }, t(label));
}

function metric(label, value) {
	return div('uf-metric', [E('dt', {}, t(label)), E('dd', {}, t(value))]);
}

function chip(label, tone) {
	return E('span', { 'class': 'uf-chip ' + (tone || '') }, [E('i'), t(label)]);
}

function bytes(n) {
	if (!Number.isFinite(n)) return unknown;
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	const index = Math.min(units.length - 1, Math.floor(Math.log2(Math.max(1, n)) / 10));
	return (n / Math.pow(1024, index)).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ' + units[index];
}

function traffic(aps, key) {
	return aps.length && aps.every(a => Number.isFinite(a[key]))
		? bytes(aps.reduce((total, ap) => total + ap[key], 0)) : unknown;
}

function endpointHost(url) {
	try { return new URL(url).host; } catch (e) { return unknown; }
}

function connection(d) {
	if (!d.settings.enabled) return [_('Disabled'), ''];
	if (!d.running) return [_('Agent stopped'), 'warn'];
	if (d.state_error) return [_('Check adoption'), 'warn'];
	if (!d.paired) return [_('Awaiting adoption'), 'warn'];
	if (d.inform_age != null && d.inform_age <= 120) return [_('Controller responded'), 'ok'];
	return [d.last_inform ? _('Last response is stale') : _('Awaiting inform response'), 'warn'];
}

const colors = { ng: '#0a84ff', na: '#29b793', '6e': '#9974ed' };
const clientShapes = [
	['tablet', /ipad|tablet|galaxy[ -]?tab|平板/i],
	['laptop', /macbook|thinkpad|laptop|notebook|笔记本/i],
	['speaker', /homepod|audioaccessory|speaker|sonos|音箱/i],
	['television', /apple[ -]?tv|smart[ -]?tv|chromecast|电视/i],
	['phone', /iphone|smartphone|pixel[ -]?\d{1,2}(?:a|pro|fold|\b)|手机/i],
	['desktop', /imac|mac[ -]?(?:mini|studio|pro)|desktop|workstation|台式/i]
];

function icon(name) {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	const use = document.createElementNS(svg.namespaceURI, 'use');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	svg.setAttribute('class', 'uf-icon');
	use.setAttribute('href', L.resource('view/unifi/assets/icons.svg') + '#' + name);
	svg.appendChild(use);
	return svg;
}

function clientMark(client) {
	// The reported model takes precedence over the local hostname. This is a display hint only.
	let shape;
	for (const hint of [client.model, client.name]) {
		shape = hint && clientShapes.find(([, pattern]) => pattern.test(hint));
		if (shape) break;
	}
	const kind = shape ? shape[0] : 'endpoint';
	return E('span', { 'class': 'uf-client-mark', 'data-kind': kind }, [icon(kind)]);
}

function rate(link) {
	if (!link || !Number.isFinite(link.speed) || link.speed <= 0) return unknown;
	return link.speed >= 1000 ? (link.speed / 1000).toLocaleString() + ' GbE' : link.speed + ' Mb/s';
}

function heading(d, reload, valid) {
	const buttons = [E('button', { type: 'button', 'class': 'uf-cmd uf-icon-only',
		title: _('Refresh'), 'aria-label': _('Refresh'), click: reload }, [icon('refresh')])];
	if (valid && L.hasViewPermission() !== false)
		buttons.push(btn(_('Settings'), 'uf-cmd uf-primary', () => showSettings(d, reload)));
	return div('uf-mast', [div('uf-id', [
		div('uf-mark', [icon('access-point')]),
		div('uf-title', [E('h2', {}, t('UniFi')), E('p', {}, t([d.hostname || _('Access point management'), d.model].filter(Boolean).join(' · ')))])
	]), div('uf-actions', buttons)]);
}

function summaryMetric(label, value, cls, glyph) {
	return div('uf-metric ' + cls, [E('dt', {}, [icon(glyph), t(label)]), E('dd', {}, t(value))]);
}

function hero(d, reload) {
	const aps = d.radio_error ? [] : d.radios.flatMap(r => r.aps);
	return E('section', { 'class': 'uf-card uf-hero uf-summary' }, [heading(d, reload, true),
		E('dl', { 'class': 'uf-metrics' }, [
			summaryMetric(_('Wireless clients'), d.total, 'uf-total', 'clients'),
			summaryMetric(_('Wired uplink'), rate(d.uplink), 'uf-speed', 'wire'),
			summaryMetric(_('Wireless RX total'), traffic(aps, 'rx'), 'uf-rx', 'receive'),
			summaryMetric(_('Wireless TX total'), traffic(aps, 'tx'), 'uf-tx', 'send')
		])]);
}

function hardware(image, fallback, title, value) {
	const picture = E('img', { src: L.resource('view/unifi/assets/' + image + '.webp'),
		width: 324, height: 188, alt: '', decoding: 'async', error: e => e.currentTarget.replaceWith(icon(fallback)) });
	return div('uf-device', [div('uf-hardware', [picture]),
		E('strong', {}, t(title)), E('small', {}, t(value))]);
}

function reportedVersion(d) {
	return d.last_version || d.settings.firmware_version || d.default_version;
}

function hostState(d) {
	if (!d.settings.enabled || !d.settings.wired_host) return _('Disabled');
	const host = d.wired_host || {};
	if (host.state === 'leased' && host.ip) return host.ip;
	if (host.state === 'dhcp') return _('Waiting for DHCP');
	if (host.state === 'error') return _('Interface unavailable');
	return _('Waiting for Ethernet');
}

function topology(d, band, showAll) {
	const port = d.uplink?.name;
	const nodes = d.clients.filter(c => !band || c.band === band);
	const leaves = nodes.slice(0, 3).map(c => E('li', { 'class': 'uf-leaf' }, [
		clientMark(c), div('', [E('strong', {}, t(c.name || c.model || c.mac)), E('small', {}, t(
			[bands[c.band], c.signal != null ? c.signal + ' dBm' : null].filter(Boolean).join(' · ')))])]));
	if (nodes.length > leaves.length) {
		const more = btn(_('%s more').format(nodes.length - leaves.length), 'uf-link', showAll);
		leaves.push(E('li', { 'class': 'uf-more' }, [more]));
	}
	const connectionLabel = port ? [port, rate(d.uplink)].filter(x => x !== unknown).join(' · ') : _('Inform');
	return E('section', { 'class': 'uf-card uf-topology' }, [
		div('uf-card-head', [E('h3', {}, t(_('Network topology'))), chip(...connection(d))]),
		div('uf-graph', [hardware('gateway', 'wire', _('Controller'), endpointHost(d.settings.inform_url)),
			E('div', { 'class': 'uf-edge' + (d.uplink?.up ? ' uf-carrier' : ''), title: _('R4 uplink') }, [E('span', {}, t(connectionLabel)), E('i')]),
			hardware('bpi-r4', 'board', 'BPI-R4 · BE14', d.ip)]),
		E('dl', { 'class': 'uf-path-facts' }, [
			metric(_('Management interface'), [d.settings.management_network, d.management_device].filter(Boolean).join(' · ')),
			metric(_('Reported firmware'), reportedVersion(d))
		]),
		...(d.settings.wired_host && d.settings.enabled ? [div('uf-host', [
			icon('wire'), E('strong', {}, t(_('BPI-R4 wired client'))), E('small', {}, t(hostState(d)))])] : []),
		...(leaves.length ? [E('ul', { 'class': 'uf-leaves' }, leaves)] : [])
	]);
}

function distribution(d, active, select) {
	const radio = new Map(d.radios.map(r => [r.band, r]));
	const complete = Object.keys(bands).every(k => Number.isInteger(radio.get(k)?.clients));
	const count = complete ? d.radios.reduce((sum, r) => sum + r.clients, 0) : null;
	const stops = [];
	let used = 0;
	const legend = Object.entries(bands).map(([key, title]) => {
		const r = radio.get(key);
		const ssids = [...new Set((r?.aps || []).map(ap => ap.ssid).filter(Boolean))].join(' · ');
		const channel = !r ? _('Unavailable') : !r.up ? _('Radio down') : _('Channel %s').format(r.channel ?? unknown);
		const width = r?.up && (r.width ? r.width + ' MHz' : r.configured && _('Configured %s').format(r.configured));
		if (count && r.clients) {
			const from = used * 100 / count;
			used += r.clients;
			stops.push(colors[key] + ' ' + from + '% ' + (used * 100 / count) + '%');
		}
		return E('button', { type: 'button', 'class': 'uf-legend-row', 'data-band': key,
			'aria-pressed': String(active === key), click: () => select(key) }, [
			E('span', { 'class': 'uf-band-mark', style: '--band-color:' + colors[key] }, [icon('radio')]), div('uf-legend-name', [
				div('uf-band-name', [E('strong', {}, t(title)),
					...(ssids ? [E('span', { title: ssids }, t(ssids))] : [])]),
				E('small', {}, t([channel, width].filter(Boolean).join(' · '))),
				...(r?.aps.length ? [div('uf-band-traffic', [
					E('span', { title: _('Wireless RX total') }, [t('RX ' + traffic(r.aps, 'rx'))]),
					E('span', { title: _('Wireless TX total') }, [t('TX ' + traffic(r.aps, 'tx'))])
				])] : [])
			]), E('b', {}, t(r?.clients))]);
	});
	const ring = div('uf-ring', [E('i', { 'aria-hidden': 'true',
		style: stops.length ? 'background:conic-gradient(' + stops.join(',') + ')' : '' }),
		div('uf-ring-value', [E('b', {}, t(count)), E('small', {}, t(_('Associations')))])]);
	return E('section', { 'class': 'uf-card uf-composition' }, [
		div('uf-card-head', [E('h3', {}, t(_('Band distribution'))),
			E('small', { 'class': 'uf-caption' }, t(!complete ? _('Unavailable') :
				_('%s / 3 radios up').format(d.radios.filter(r => r.up).length)))]),
		div('uf-composition-body', [ring, div('uf-legend', legend)])]);
}

function managementFacts(d) {
	const facts = [metric(_('Operating system'), d.system), metric(_('Management MAC'), d.mac?.toUpperCase()),
		metric(_('Last inform response'), d.last_inform ? new Date(d.last_inform * 1000).toLocaleTimeString() : unknown)];
	if (d.settings.wired_host) {
		const reachable = d.wired_host?.gateway_reachable;
		facts.push(metric(_('Wired gateway check'), reachable == null ? unknown : reachable ? _('Gateway replied') : _('No ping response')));
	}
	return facts;
}

function devices(d) {
	const link = d.uplink || {};
	return E('dl', { 'class': 'uf-facts' }, [
		metric(_('Hardware'), d.board),
		metric(_('Management interface'), [d.settings.management_network, d.management_device].filter(Boolean).join(' · ')),
		metric(_('Ethernet port'), link.name),
		metric(_('Negotiated link'), link.name && link.up === false ? _('Down') : rate(link)),
		metric(_('BPI-R4 wired client'), hostState(d)), metric(_('Wired client MAC'), d.wired_host?.mac?.toUpperCase()),
		metric(_('UniFi model'), d.model),
		metric(_('Reported firmware'), reportedVersion(d)), ...managementFacts(d)
	]);
}

function dataTable(columns, rows, empty) {
	if (!rows.length) return E('p', { 'class': 'uf-empty' }, t(empty));
	const body = rows.map(cells => E('tr', {}, cells.map((contents, i) =>
		E(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : { 'data-label': columns[i] }, contents))));
	return E('table', { 'class': 'uf-table' }, [E('thead', {}, [E('tr', {}, columns.map(col =>
		E('th', { scope: 'col' }, t(col))))]), E('tbody', {}, body)]);
}

function radiosPanel(d) {
	return dataTable([_('Band'), _('Status'), _('Channel'), _('Configured mode'), _('Operating width'), _('Controller WLAN')],
		d.radios.map(r => [[E('strong', {}, t(bands[r.band])), E('small', {}, t(r.ifname))],
			chip(r.up ? _('Up') : _('Down'), r.up ? 'ok' : ''), t(r.channel), t(r.configured),
			t(r.width ? r.width + ' MHz' : unknown), r.aps.length ? r.aps.map(ap =>
				div('uf-ssid', [t(ap.ssid), chip(ap.matched ? _('Matched') : _('Unmatched'), ap.matched ? 'ok' : '')])) : t(unknown)]),
		d.radio_error ? _('Radio data could not be read.') : _('No radios reported.'));
}

function editModel(client, reload) {
	const manual = client.model_source === 'manual' ? client.model : '';
	const input = E('input', { type: 'text', value: manual, maxlength: 96, placeholder: client.model || '' });
	const err = E('p', { 'class': 'uf-error', role: 'alert' });
	const save = btn(_('Save'), 'btn cbi-button cbi-button-positive important', async () => {
		save.disabled = true;
		try {
			const res = await setModel(client.mac, manual, input.value.trim());
			if (!res.saved) {
				err.textContent = res.error === 'model' ? _('Enter a printable model name of up to 96 bytes.') :
					_('Client or settings changed. Close and refresh before retrying.');
				return;
			}
			await reload(true);
			ui.hideModal();
		} catch (e) { err.textContent = _('Could not apply settings.'); }
		finally { save.disabled = false; }
	});
	ui.showModal(_('Client model'), [div('uf-settings', [
		E('label', { 'class': 'uf-field' }, [E('span', {}, t(client.mac)), input,
			E('small', {}, t(_('Enter the model of this device, or leave empty to use discovery.')))]), err]),
		div('right', [btn(_('Cancel'), 'btn cbi-button', ui.hideModal), t(' '), save])]);
}

function clientsPanel(d, band, reload) {
	const clients = d.clients.filter(c => !band || c.band === band);
	const rows = clients.map(c => [
		[div('uf-client', [clientMark(c), div('', [
			E('strong', {}, t(c.name || c.mac)), E('small', {}, t(c.name ? c.mac : c.ip))])])],
		[L.hasViewPermission() === false ? t(c.model || _('Not identified')) :
			btn(c.model || _('Set model'), 'uf-link', () => editModel(c, reload)),
			...(c.model_source ? [E('small', {}, t(c.model_source === 'manual' ? _('Manual') : 'mDNS'))] : [])],
		t(c.ip || c.ipv6[0]), [t(bands[c.band]), E('small', {}, t(c.ssid))],
		[t(c.wifi ? 'Wi-Fi ' + c.wifi : unknown), E('small', {}, t(c.signal != null ? c.signal + ' dBm' : unknown))],
		[E('span', { 'class': 'uf-received' }, t('↓ ' + bytes(c.rx))), E('small', { 'class': 'uf-sent' }, t('↑ ' + bytes(c.tx)))]
	]);
	return dataTable([_('Client'), _('Device model'), _('IP address'), _('Band / SSID'), _('Link / signal'), _('RX / TX bytes')], rows,
		d.radio_error || (band ? d.radios.find(r => r.band === band)?.clients == null : d.total == null)
			? _('Association data is unavailable.') : _('No associated clients.'));
}

function detailPanel(d, tab, band, change, clear, reload) {
	const tabs = [['clients', _('Associated clients')], ['radios', _('Radios')], ['device', _('Device information')]];
	const buttons = tabs.map(([key, name]) => E('button', { type: 'button', 'data-panel': key,
		'aria-pressed': String(tab === key), 'aria-controls': 'uf-detail-body', click: () => change(key) }, t(name)));
	const controls = [div('uf-tabs', buttons)];
	if (tab === 'clients' && band) controls.push(btn(bands[band] + ' ×', 'uf-filter', clear));
	const panel = E('section', { 'class': 'uf-card uf-detail' }, [div('uf-detail-head', controls),
		E('div', { id: 'uf-detail-body' }, [tab === 'device' ? devices(d) : tab === 'radios' ? radiosPanel(d) : clientsPanel(d, band, reload)])]);
	if (tab === 'device') return panel;
	return div('uf-lower', [panel, E('aside', { 'class': 'uf-card uf-management' }, [
		div('uf-card-head', [E('h3', {}, t(_('Management status')))]),
		E('dl', {}, managementFacts(d))
	])]);
}

function showSettings(d, reload) {
	const old = d.settings;
	const input = (value, attrs) => E('input', Object.assign({ type: 'text', value: value || '', autocomplete: 'off' }, attrs));
	const enabled = E('input', { type: 'checkbox' });
	enabled.checked = old.enabled;
	const wired = E('input', { type: 'checkbox' });
	wired.checked = old.wired_host;
	const url = input(old.inform_url, { placeholder: 'http://192.168.1.1:8080/inform', maxlength: 250 });
	const version = input(old.firmware_version, { placeholder: d.default_version, maxlength: 27 });
	const net = E('select', {}, [...new Set([...d.networks, old.management_network])].filter(Boolean)
		.map(n => E('option', { value: n }, t(n))));
	net.value = old.management_network;
	const wid = input(old.wlan_id, { maxlength: 24 });
	const choices = new Map(d.candidates.map(x => [x.section, bands[x.band]]));
	for (const section of old.sections) if (!choices.has(section)) choices.set(section, '');
	const checks = [...choices].map(([section, band]) => {
		const field = E('input', { type: 'checkbox', value: section });
		field.checked = old.sections.includes(section);
		return { section, field, node: E('label', { 'class': 'uf-check' }, [field, t([section, band].filter(Boolean).join(' · '))]) };
	});
	const field = (name, el, help) => E('label', { 'class': 'uf-field' }, [E('span', {}, t(name)), el, ...(help ? [E('small', {}, t(help))] : [])]);
	const err = E('p', { 'class': 'uf-error', role: 'alert' });
	const errors = { url: _('Enter a controller IP URL ending in /inform.'), network: _('Select an available management interface.'),
		version: _('Use three or four numeric components, for example 8.8.14.20179.'),
		paired_url: _('The saved adoption belongs to another controller. Complete re-adoption before changing this URL.'),
		binding: _('Select one independent AP at most per band and enter its controller WLAN ID.'),
		conflict: _('Settings changed in another session. Close and reopen this form.'),
		service: _('Settings were saved. The service could not be applied. Reopen the form to retry.') };
	const save = btn(_('Save and apply'), 'btn cbi-button cbi-button-positive important', async () => {
		err.textContent = '';
		save.disabled = true;
		try {
			const cfg = { enabled: enabled.checked, wired_host: wired.checked, inform_url: url.value.trim(), firmware_version: version.value.trim(),
				management_network: net.value, wlan_id: wid.value.trim(), sections: checks.filter(c => c.field.checked).map(c => c.section).sort() };
			const reply = await configure(JSON.stringify(old), JSON.stringify(cfg));
			if (!reply.saved || reply.error) { err.textContent = errors[reply.error] || _('Could not apply settings.'); return; }
			await reload(true);
			ui.hideModal();
		} catch (e) { err.textContent = _('Could not apply settings.'); }
		finally { save.disabled = false; }
	});
	ui.showModal(_('UniFi settings'), [
		div('uf-settings', [
			E('label', { 'class': 'uf-check' }, [enabled, t(_('Enable UniFi agent'))]),
			field(_('Controller inform URL'), url), field(_('Management interface'), net),
			div('uf-field', [E('label', { 'class': 'uf-check' }, [wired, t(_('Show BPI-R4 as a wired client'))]),
				E('small', {}, t(_('Requests a separate DHCP address on the Ethernet uplink. The gateway can list BPI-R4 alongside the adopted E7.')))]),
			field(_('Reported E7 firmware'), version, _('Leave empty to use %s. This value is sent to UniFi Network.').format(d.default_version)),
			E('details', {}, [E('summary', {}, t(_('WLAN provisioning'))),
				field(_('Controller WLAN ID'), wid, _('Leave unbound to report existing SSIDs. Select independent BSS interfaces to allow provisioning.')),
				...(checks.length ? checks.map(c => c.node) : [E('small', {}, t(_('No eligible independent BSS interfaces.')))])]),
			err
		]),
		div('right', [btn(_('Cancel'), 'btn cbi-button', ui.hideModal), t(' '), save])]);
}

return view.extend({
	load() { return getStatus().catch(() => ({})); },
	render(initial) {
		const root = div('uf-page');
		let band = null, tab = 'clients', latest = initial, inFlight = null;
		const show = key => { tab = key; update(); };
		const choose = key => { band = band === key ? null : key; show('clients'); };
		const jump = () => { show('clients'); root.querySelector('.uf-detail').scrollIntoView({ block: 'start' }); };
		const update = () => {
			const active = root.contains(document.activeElement) ? document.activeElement.dataset : {};
			const d = latest;
			if (!d.settings || d.error) {
				root.replaceChildren(E('section', { 'class': 'uf-card uf-hero' }, [heading(d, reload, false),
					E('p', { 'class': 'uf-empty' }, t(_('Unable to read the UniFi agent.')))]));
				return;
			}
			root.replaceChildren(hero(d, reload), div('uf-visuals', [topology(d, band, jump), distribution(d, band, choose)]),
				detailPanel(d, tab, band, show, () => choose(band), reload));
			if (bands[active.band]) root.querySelector('[data-band="' + active.band + '"]')?.focus({ preventScroll: true });
			if (['clients', 'radios', 'device'].includes(active.panel))
				root.querySelector('[data-panel="' + active.panel + '"]')?.focus({ preventScroll: true });
		};
		function reload(fresh) {
			if (inFlight) return fresh === true ? inFlight.then(() => reload(true)) : inFlight;
			inFlight = getStatus().catch(() => ({})).then(data => { latest = data; update(); })
				.finally(() => { inFlight = null; });
			return inFlight;
		}
		update();
		poll.add(reload, 15);
		return E('div', {}, [E('link', { rel: 'stylesheet', href: L.resource('view/unifi/style.css') }), root]);
	},
	handleSaveApply: null, handleSave: null, handleReset: null
});

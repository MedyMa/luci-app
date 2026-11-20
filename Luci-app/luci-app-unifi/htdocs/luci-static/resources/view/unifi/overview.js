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

function phyRate(kbps) {
	return Number.isFinite(kbps) && kbps > 0
		? (kbps / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' Mbps' : unknown;
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

function subtitle(d) {
	return [d.hostname || _('Access point management'), d.model].filter(Boolean).join(' · ');
}

function heading(d, reload, openSettings) {
	const buttons = [E('button', { type: 'button', 'class': 'uf-cmd uf-icon-only',
		title: _('Refresh'), 'aria-label': _('Refresh'), click: reload }, [icon('refresh')])];
	if (openSettings && L.hasViewPermission() !== false)
		buttons.push(btn(_('Settings'), 'uf-cmd uf-primary', openSettings));
	return div('uf-mast', [div('uf-id', [
		div('uf-mark', [icon('access-point')]),
		div('uf-title', [E('h2', {}, t('UniFi')), E('p', {}, t(subtitle(d)))])
	]), div('uf-actions', buttons)]);
}

function summaryMetric(label, value, cls, glyph) {
	return div('uf-metric ' + cls, [E('dt', {}, [icon(glyph), t(label)]), E('dd', {}, t(value))]);
}

function metrics(d) {
	const aps = d.radio_error ? [] : d.radios.flatMap(r => r.aps);
	return E('dl', { 'class': 'uf-metrics' }, [
		summaryMetric(_('Wireless clients'), d.total, 'uf-total', 'clients'),
		summaryMetric(_('Wired uplink'), rate(d.uplink), 'uf-speed', 'wire'),
		summaryMetric(_('Wireless RX total'), traffic(aps, 'rx'), 'uf-rx', 'receive'),
		summaryMetric(_('Wireless TX total'), traffic(aps, 'tx'), 'uf-tx', 'send')
	]);
}

function topologyNode(glyph, title, value) {
	return div('uf-device uf-' + glyph, [div('uf-node-mark', [icon(glyph)]),
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
	if (host.state === 'retrying') return _('Retrying DHCP');
	if (host.state === 'starting') return _('Awaiting wired client status');
	if (host.state === 'stopped') return _('Wired client stopped');
	if (host.state === 'error') return _('Interface unavailable');
	return _('Waiting for Ethernet');
}

function gatewayState(d) {
	const host = d.wired_host || {};
	if (!d.settings.enabled || !d.settings.wired_host) return _('Disabled');
	if (host.state === 'dhcp' || host.state === 'retrying') return _('Waiting for a lease to check the gateway');
	if (host.state !== 'leased') return hostState(d);
	if (typeof host.gateway_reachable === 'boolean') {
		const result = host.gateway_reachable ? _('Gateway replied') : _('No ping response');
		return host.gateway ? host.gateway + ' · ' + result : result;
	}
	if (host.probe_error) return _('Gateway probe unavailable');
	return host.gateway ? _('Checking gateway') : _('No gateway in DHCP lease');
}

function topology(d, band, showAll, stale) {
	const port = d.uplink?.name;
	const nodes = d.clients.filter(c => !band || c.band === band);
	const leaves = nodes.slice(0, 3).map(c => E('li', { 'class': 'uf-leaf' }, [
		clientMark(c), div('', [E('strong', {}, t(c.name || c.model || c.mac)), E('small', {}, t(
			[bands[c.band], c.signal != null ? c.signal + ' dBm' : null].filter(Boolean).join(' · ')))])]));
	if (nodes.length > leaves.length) {
		const more = btn(_('%s more').format(nodes.length - leaves.length), 'uf-link', showAll);
		leaves.push(E('li', { 'class': 'uf-more' }, [more]));
	}
	const [status, tone] = stale ? [_('Refresh failed · showing last data'), 'warn'] : connection(d);
	const online = tone === 'ok' && d.uplink?.up !== false;
	const linkRate = d.uplink?.up === false ? _('Down') : rate(d.uplink);
	const connectionLabel = port ? [port, linkRate].filter(x => x !== unknown).join(' · ') : _('Inform');
	const graph = div('uf-graph' + (online ? ' uf-online' : ''), [
		topologyNode('controller', _('Controller'), endpointHost(d.settings.inform_url)),
		E('div', { 'class': 'uf-edge' + (d.uplink?.up ? ' uf-carrier' : ''), title: _('R4 uplink') }, [
			E('span', { 'class': 'uf-edge-label', title: connectionLabel }, t(connectionLabel)),
			E('span', { 'class': 'uf-rail', 'aria-hidden': 'true' }, [
				E('i', { 'class': 'uf-report' }), E('i', { 'class': 'uf-reply' })])
		]),
		topologyNode('radio', 'BPI-R4 · BE14', d.ip)
	]);
	// Keep the pulse in phase when fresh telemetry rebuilds the graph.
	if (online) graph.style.setProperty('--uf-phase', -Math.round(performance.now()) + 'ms');
	return E('section', { 'class': 'uf-card uf-topology' }, [
		div('uf-card-head', [E('h3', {}, t(_('Network topology'))), chip(status, tone)]),
		graph,
		E('dl', { 'class': 'uf-path-facts' }, [
			metric(_('Management interface'), [d.settings.management_network, d.management_device].filter(Boolean).join(' · ')),
			metric(_('Reported firmware'), reportedVersion(d))
		]),
		...(d.settings.wired_host && d.settings.enabled ? [div('uf-host', [
			icon('wire'), E('strong', {}, t(_('BPI-R4 wired client'))), E('small', {}, t(hostState(d)))])] : []),
		...(leaves.length ? [E('ul', { 'class': 'uf-leaves' }, leaves)] : [])
	]);
}

function distribution(d, active, select, current) {
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
	const caption = !complete ? _('Unavailable') : _('%s / 3 radios up').format(d.radios.filter(r => r.up).length);
	if (current) {
		current.querySelector('.uf-caption').textContent = caption;
		current.querySelector('.uf-ring').replaceWith(ring);
		current.querySelectorAll('.uf-legend-row').forEach((row, i) => {
			row.setAttribute('aria-pressed', legend[i].getAttribute('aria-pressed'));
			if (!row.isEqualNode(legend[i])) row.replaceChildren(...legend[i].childNodes);
		});
		return current;
	}
	return E('section', { 'class': 'uf-card uf-composition' }, [
		div('uf-card-head', [E('h3', {}, t(_('Band distribution'))),
			E('small', { 'class': 'uf-caption' }, t(caption))]),
		div('uf-composition-body', [ring, div('uf-legend', legend)])]);
}

function managementFacts(d) {
	const facts = [metric(_('Operating system'), d.system), metric(_('Management MAC'), d.mac?.toUpperCase()),
		metric(_('Last inform response'), d.last_inform ? new Date(d.last_inform * 1000).toLocaleTimeString() : unknown)];
	if (d.settings.wired_host) {
		facts.push(metric(_('Wired gateway check'), gatewayState(d)));
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
	return dataTable([_('Band'), _('Status'), _('Channel'), _('Configured mode'), _('Channel width'), _('Controller WLAN')],
		d.radios.map(r => [[E('strong', {}, t(bands[r.band])), E('small', {}, t(r.ifname))],
			chip(r.up ? _('Up') : _('Down'), r.up ? 'ok' : ''), t(r.channel), t(r.configured),
			radioWidth(r), r.aps.length ? r.aps.map(ap =>
				div('uf-ssid', [t(ap.ssid), chip(ap.matched ? _('Matched') : _('Unmatched'), ap.matched ? 'ok' : '')])) : t(unknown)]),
		d.radio_error ? _('Radio data could not be read.') : _('No radios reported.'));
}

function radioWidth(r) {
	if (!r.up) return t(_('Radio down'));
	if (r.width) return [t(r.width + ' MHz'), E('small', {}, t(_('Operating width')))];
	if (r.configured_width) return t(_('%s MHz (configured)').format(r.configured_width));
	return t(unknown);
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
		[t('RX ' + phyRate(c.rx_rate)), E('small', {}, t('TX ' + phyRate(c.tx_rate)))],
		[E('span', { 'class': 'uf-received' }, t('↓ ' + bytes(c.rx))), E('small', { 'class': 'uf-sent' }, t('↑ ' + bytes(c.tx)))]
	]);
	return dataTable([_('Client'), _('Device model'), _('IP address'), _('Band / SSID'), _('Link / signal'), _('AP PHY rate'), _('RX / TX bytes')], rows,
		d.radio_error || (band ? d.radios.find(r => r.band === band)?.clients == null : d.total == null)
			? _('Association data is unavailable.') : _('No associated clients.'));
}

function detailPanel(change, clear, reload) {
	const tabs = [['clients', _('Associated clients')], ['radios', _('Radios')], ['device', _('Device information')]];
	const buttons = tabs.map(([key, name]) => E('button', { type: 'button', 'data-panel': key,
		'aria-controls': 'uf-detail-body', click: () => change(key) }, t(name)));
	const filter = btn('', 'uf-filter', clear);
	const head = div('uf-detail-head', [div('uf-tabs', buttons), filter]);
	const body = E('div', { id: 'uf-detail-body' });
	const panel = E('section', { 'class': 'uf-card uf-detail' }, [head, body]);
	const facts = E('dl');
	const aside = E('aside', { 'class': 'uf-card uf-management' }, [
		div('uf-card-head', [E('h3', {}, t(_('Management status')))]), facts]);
	const node = div('uf-lower', [panel, aside]);
	return { node, head, panel, update(d, tab, band) {
		for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.panel === tab));
		filter.hidden = tab !== 'clients' || !band;
		if (!filter.hidden) filter.textContent = bands[band] + ' ×';
		node.classList.toggle('uf-full', tab === 'device');
		const next = tab === 'device' ? devices(d) : tab === 'radios' ? radiosPanel(d) : clientsPanel(d, band, reload);
		if (!body.firstElementChild?.isEqualNode(next)) body.replaceChildren(next);
		facts.replaceChildren(...managementFacts(d));
	} };
}

// Argon scrolls .main-right; other LuCI themes scroll the document.
function scrollParent(node) {
	for (let p = node.parentElement; p && p !== document.body; p = p.parentElement)
		if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
	return document.scrollingElement;
}

function keepReadingPosition(detail, visuals, draw, switching) {
	if (!detail.node.isConnected || getComputedStyle(detail.head).position !== 'sticky') return draw();
	const scroll = scrollParent(detail.node);
	const scrolled = scroll.scrollTop > 0;
	const top = scroll === document.scrollingElement ? 0 : scroll.getBoundingClientRect().top + scroll.clientTop;
	const bottom = Math.min(window.innerHeight, top + scroll.clientHeight);
	const bar = detail.head.getBoundingClientRect();
	let anchor = visuals.lastElementChild;
	if (anchor.getBoundingClientRect().top > top) anchor = visuals;
	let wanted = anchor.getBoundingClientRect().top;
	if (bar.top < bottom && bar.bottom > top) {
		anchor = detail.panel;
		const inset = anchor.clientTop + parseFloat(getComputedStyle(anchor).paddingTop);
		wanted = switching ? bar.top - inset : anchor.getBoundingClientRect().top;
		// A shorter tab needs just enough room below the visible buttons to avoid scroll clamping.
		anchor.style.setProperty('--uf-reading-room', Math.ceil(bottom - bar.top + inset) + 'px');
	} else {
		detail.panel.style.removeProperty('--uf-reading-room');
	}
	draw();
	const shift = anchor.getBoundingClientRect().top - wanted;
	if (scrolled && Math.abs(shift) > 1) scroll.scrollTop += shift;
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
		const visuals = div('uf-visuals');
		const detail = detailPanel(show, () => choose(band), reload);
		let band = null, tab = 'clients', latest = null, stale = false, inFlight = null;
		function show(key) {
			if (tab === key) return;
			tab = key;
			keepReadingPosition(detail, visuals, () => detail.update(latest, tab, band), true);
			if (key === 'device') reload();
		}
		function choose(key) {
			band = band === key ? null : key;
			tab = 'clients';
			keepReadingPosition(detail, visuals, draw);
		}
		function jump() {
			show('clients');
			detail.panel.scrollIntoView({ block: 'start' });
		}
		function draw() {
			const graph = topology(latest, band, jump, stale);
			if (root.contains(detail.node)) {
				const summary = root.firstElementChild;
				summary.querySelector('.uf-title p').textContent = subtitle(latest);
				summary.querySelector('.uf-metrics').replaceWith(metrics(latest));
				visuals.firstElementChild.replaceWith(graph);
				distribution(latest, band, choose, visuals.lastElementChild);
			} else {
				const summary = E('section', { 'class': 'uf-card uf-hero uf-summary' }, [
					heading(latest, reload, () => showSettings(latest, reload)), metrics(latest)]);
				visuals.replaceChildren(graph, distribution(latest, band, choose));
				root.replaceChildren(summary, visuals, detail.node);
			}
			detail.update(latest, tab, band);
		}
		function accept(data) {
			const failed = !data?.settings || data.error;
			if (latest && failed) {
				if (stale) return;
				stale = true;
			} else if (latest && data.radio_error && !latest.radio_error &&
				latest.settings.management_network === data.settings.management_network &&
				latest.settings.inform_url === data.settings.inform_url && latest.settings.enabled === data.settings.enabled) {
				// The wired worker publishes independently of the wireless snapshot.
				latest = Object.assign({}, latest, { settings: data.settings, wired_host: data.wired_host, running: data.running });
				stale = true;
			} else if (failed) {
				if (!root.firstElementChild)
					root.appendChild(E('section', { 'class': 'uf-card uf-hero' }, [heading({}, reload),
						E('p', { 'class': 'uf-empty' }, t(_('Unable to read the UniFi agent.')))]));
				return;
			} else {
				latest = data;
				stale = false;
			}
			keepReadingPosition(detail, visuals, draw);
		}
		function reload(fresh) {
			if (inFlight) return fresh === true ? inFlight.then(() => reload(true)) : inFlight;
			inFlight = getStatus().catch(() => ({})).then(accept)
				.finally(() => { inFlight = null; });
			return inFlight;
		}
		accept(initial);
		poll.add(reload, 15);
		return E('div', {}, [E('link', { rel: 'stylesheet', href: L.resource('view/unifi/style.css') }), root]);
	},
	handleSaveApply: null, handleSave: null, handleReset: null
});

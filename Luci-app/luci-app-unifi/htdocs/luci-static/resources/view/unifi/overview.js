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

function traffic(data, key) {
	const aps = data.radios.flatMap(r => r.aps);
	return !data.radio_error && aps.length && aps.every(a => Number.isFinite(a[key]))
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

function topology(d, active, select) {
	function hardware(type, title, value) {
		return div('uf-device', [div('uf-glyph ' + type, [E('i'), E('b')]),
			div('uf-device-text', [E('strong', {}, t(title)), E('small', {}, t(value))])]);
	}
	const radios = new Map(d.radios.map(r => [r.band, r]));
	const nodes = Object.entries(bands).map(([key, name]) => {
		const radio = radios.get(key);
		const node = E('button', { type: 'button', 'class': 'uf-band ' + key, 'data-band': key,
			'aria-pressed': String(active === key), click: () => select(key) }, [
			div('uf-band-label', [E('i', { 'class': radio?.up ? 'on' : '' }), t(name)]),
			E('small', {}, t(!radio ? _('Unavailable') : !radio.up ? _('Radio down') :
				_('Channel %s').format(radio.channel ?? unknown))),
			E('span', { 'class': 'uf-band-count' }, t(radio?.clients === 1 ? _('1 client') : _('%s clients').format(radio?.clients ?? unknown)))]);
		return node;
	});
	return E('section', { 'class': 'uf-card uf-topology' }, [
		div('uf-card-head', [E('h3', {}, t(_('Network topology'))), chip(...connection(d))]),
		div('uf-diagram', [
			div('uf-backbone', [hardware('uf-gateway', _('Controller'), endpointHost(d.settings.inform_url)),
				div('uf-wire', [E('i')]), hardware('uf-board', 'BPI-R4 · BE14', d.ip)]),
			div('uf-branches', nodes)
		])
	]);
}

function devices(d) {
	const address = d.mac ? d.mac.toUpperCase() : unknown;
	return E('section', { 'class': 'uf-card uf-details' }, [
		div('uf-card-head', [E('h3', {}, t(_('Device information')))]),
		E('dl', {}, [
			metric(_('Hardware'), d.board), metric(_('Operating system'), d.system),
			metric(_('Management interface'), d.settings.management_network),
			metric(_('Management MAC'), address),
			metric(_('UniFi model'), d.model), metric(_('Reported firmware'), d.last_version || d.settings.firmware_version || d.default_version),
			metric(_('Last inform response'), d.last_inform ? new Date(d.last_inform * 1000).toLocaleTimeString() : unknown)
		])
	]);
}

function radiosPanel(d) {
	const rows = d.radios.map(r => {
		const matches = r.aps.map(ap => div('uf-ssid', [t(ap.ssid), chip(ap.matched ? _('Matched') : _('Unmatched'), ap.matched ? 'ok' : '')]));
		return E('tr', {}, [E('th', { scope: 'row' }, [E('strong', {}, t(bands[r.band])), E('small', {}, t(r.ifname))]),
			E('td', {}, t(r.up ? _('Up') : _('Down'))), E('td', {}, t(r.channel)),
			E('td', {}, t(r.configured)), E('td', {}, t(r.width ? r.width + ' MHz' : unknown)),
			E('td', {}, matches.length ? matches : t(unknown))]);
	});
	return panelTable(_('Radios'), [_('Band'), _('Status'), _('Channel'), _('Configured mode'), _('Operating width'), _('Controller WLAN')], rows,
		d.radio_error ? _('Radio data could not be read.') : _('No radios reported.'));
}

function panelTable(title, columns, rows, empty, action) {
	return E('section', { 'class': 'uf-card uf-table-panel' }, [
		div('uf-card-head', [E('h3', {}, t(title)), ...(action ? [action] : [])]),
		rows.length ? div('uf-scroll', [E('table', { 'class': 'uf-table' }, [
			E('thead', {}, [E('tr', {}, columns.map(c => E('th', { scope: 'col' }, t(c))))]),
			E('tbody', {}, rows)])]) : E('p', { 'class': 'uf-empty' }, t(empty))
	]);
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
			ui.hideModal();
			await reload();
		} catch (e) { err.textContent = _('Could not apply settings.'); }
		finally { save.disabled = false; }
	});
	ui.showModal(_('Client model'), [div('uf-settings', [
		E('label', { 'class': 'uf-field' }, [E('span', {}, t(client.mac)), input,
			E('small', {}, t(_('Enter the model of this device, or leave empty to use discovery.')))]), err]),
		div('right', [btn(_('Cancel'), 'btn cbi-button', ui.hideModal), t(' '), save])]);
}

function clientsPanel(d, band, reset, reload) {
	const clients = d.clients.filter(c => !band || c.band === band);
	const rows = clients.map(c => E('tr', {}, [
		E('th', { scope: 'row' }, [E('strong', {}, t(c.name || c.mac)), ...(c.name ? [E('small', {}, t(c.mac))] : [])]),
		E('td', {}, [L.hasViewPermission() === false ? t(c.model || _('Not identified')) :
			btn(c.model || _('Set model'), 'uf-edit-model', () => editModel(c, reload)),
			...(c.model_source ? [E('small', {}, t(c.model_source === 'manual' ? _('Manual') : 'mDNS'))] : [])]),
		E('td', {}, t(c.ip || c.ipv6[0])),
		E('td', {}, [t(bands[c.band]), E('small', {}, t(c.ssid))]),
		E('td', {}, t(c.wifi ? 'Wi-Fi ' + c.wifi : unknown)), E('td', {}, t(c.signal != null ? c.signal + ' dBm' : unknown)),
		E('td', {}, [t(bytes(c.rx)), E('small', {}, t(bytes(c.tx)))])
	]));
	const label = band ? bands[band] + ' ×' : null;
	return panelTable(_('Associated clients'), [_('Client'), _('Device model'), _('IP address'), _('Band / SSID'),
		_('Wi-Fi standard'), _('Signal'), _('RX / TX bytes')], rows,
		d.radio_error || (band ? d.radios.find(r => r.band === band)?.clients == null : d.total == null)
			? _('Association data is unavailable.') : _('No associated clients.'),
		band ? btn(label, 'uf-filter', reset) : null);
}

function showSettings(d, reload) {
	const old = d.settings;
	const input = (value, attrs) => E('input', Object.assign({ type: 'text', value: value || '', autocomplete: 'off' }, attrs));
	const enabled = E('input', { type: 'checkbox' });
	enabled.checked = old.enabled;
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
			const cfg = { enabled: enabled.checked, inform_url: url.value.trim(), firmware_version: version.value.trim(),
				management_network: net.value, wlan_id: wid.value.trim(), sections: checks.filter(c => c.field.checked).map(c => c.section).sort() };
			const reply = await configure(JSON.stringify(old), JSON.stringify(cfg));
			if (!reply.saved || reply.error) { err.textContent = errors[reply.error] || _('Could not apply settings.'); return; }
			ui.hideModal();
			await reload();
		} catch (e) { err.textContent = _('Could not apply settings.'); }
		finally { save.disabled = false; }
	});
	ui.showModal(_('UniFi settings'), [
		div('uf-settings', [
			E('label', { 'class': 'uf-check' }, [enabled, t(_('Enable UniFi agent'))]),
			field(_('Controller inform URL'), url), field(_('Management interface'), net),
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
		let band = null, latest = initial, loading = false;
		const update = () => {
			const focus = root.contains(document.activeElement) ? document.activeElement.dataset.band : null;
			const d = latest;
			const refresh = btn(_('Refresh'), 'btn cbi-button', reload);
			const buttons = [refresh];
			if (d.settings && L.hasViewPermission() !== false)
				buttons.push(btn(_('Settings'), 'btn cbi-button cbi-button-action important', () => showSettings(d, reload)));
			const header = div('uf-head', [div('uf-title', [E('h2', {}, t('UniFi')), E('p', {}, t(d.hostname || _('Access point management')))]), div('uf-actions', buttons)]);
			if (!d.settings || d.error) { root.replaceChildren(header, div('uf-card uf-empty', t(_('Unable to read the UniFi agent.')))); return; }
			const select = key => { band = band === key ? null : key; update(); };
			const stats = E('dl', { 'class': 'uf-summary' }, [metric(_('Associated clients'), d.total),
				metric(_('Active radios'), d.radio_error ? unknown : d.radios.filter(r => r.up).length + ' / ' + d.radios.length),
				metric(_('Wireless RX total'), traffic(d, 'rx')), metric(_('Wireless TX total'), traffic(d, 'tx'))]);
			root.replaceChildren(header, stats, div('uf-overview', [topology(d, band, select), devices(d)]),
				radiosPanel(d), clientsPanel(d, band, () => select(band), reload));
			if (focus && bands[focus]) root.querySelector('[data-band="' + focus + '"]')?.focus({ preventScroll: true });
		};
		async function reload() {
			if (loading) return;
			loading = true;
			try { latest = await getStatus(); } catch (e) { latest = {}; }
			finally { loading = false; update(); }
		}
		update();
		poll.add(reload, 15);
		return E('div', {}, [E('link', { rel: 'stylesheet', href: L.resource('view/unifi/style.css') }), root]);
	},
	handleSaveApply: null, handleSave: null, handleReset: null
});

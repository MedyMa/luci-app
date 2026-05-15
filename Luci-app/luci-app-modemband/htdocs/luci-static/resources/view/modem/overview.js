'use strict';
'require view';
'require fs';
'require uci';
'require poll';
'require dom';

var MMCLI_BIN = '/usr/bin/mmcli';
var MODEMBAND_BIN = '/usr/bin/modemband.sh';
var SMS_TOOL_BIN = '/usr/bin/sms_tool';
var AT_COMMAND_TIMEOUT_MS = 4000;

var AT_COMMANDS = {
	csq: 'AT+CSQ',
	cops: 'AT+COPS?',
	cpin: 'AT+CPIN?',
	iccid: [ 'AT+QCCID', 'AT+CCID' ],
	imsi: 'AT+CIMI',
	qnwinfo: [ 'AT+QNWINFO', 'AT+QNWINFO' ],
	qtemp: [ 'AT+QTEMP', 'AT+QTEMP?', 'AT+CPMUTEMP' ],
	cbc: [ 'AT+CBC', 'AT+CBC' ],
	qeng: [ 'AT+QENG="servingcell"', 'AT+QENG="servingcell"' ]
};

var PLMN_OPERATOR_MAP = {
	'46000': 'China Mobile',
	'46002': 'China Mobile',
	'46004': 'China Mobile',
	'46007': 'China Mobile',
	'46008': 'China Mobile',
	'46001': 'China Unicom',
	'46006': 'China Unicom',
	'46009': 'China Unicom',
	'46003': 'China Telecom',
	'46005': 'China Telecom',
	'46011': 'China Telecom',
	'46015': 'China Broadnet'
};

var MCC_REGION_MAP = {
	'460': 'China Mainland',
	'454': 'Hong Kong',
	'455': 'Macao',
	'466': 'Taiwan'
};

function parseJson(data) {
	try {
		return JSON.parse(data || '{}');
	}
	catch (err) {
		return null;
	}
}

function normalizeValue(value) {
	if (value == null)
		return null;

	if (typeof(value) == 'string') {
		value = value.trim();
		if (value === '' || value === '--')
			return null;
	}

	return value;
}

function normalizeDeep(value) {
	var key;

	if (value == null)
		return null;

	if (Array.isArray(value))
		return value.map(normalizeDeep);

	if (typeof(value) == 'object') {
		for (key in value)
			value[key] = normalizeDeep(value[key]);

		return value;
	}

	return normalizeValue(value);
}

function execText(path, args) {
	return L.resolveDefault(fs.exec_direct(path, args), '').then(function(output) {
		return String(output || '').replace(/\r/g, '');
	});
}

function execTextWithTimeout(path, args, timeout) {
	return new Promise(function(resolve) {
		var settled = false;
		var timer = window.setTimeout(function() {
			if (settled)
				return;

			settled = true;
			resolve('');
		}, timeout || AT_COMMAND_TIMEOUT_MS);

		execText(path, args).then(function(output) {
			if (settled)
				return;

			settled = true;
			window.clearTimeout(timer);
			resolve(output);
		});
	});
}

function execJson(path, args) {
	return execText(path, args).then(function(output) {
		var json = parseJson(output);

		return normalizeDeep(json);
	});
}

function resolveWithTimeout(promise, fallback, timeout) {
	return new Promise(function(resolve) {
		var settled = false;
		var timer = window.setTimeout(function() {
			if (settled)
				return;

			settled = true;
			resolve(fallback);
		}, timeout || AT_COMMAND_TIMEOUT_MS);

		L.resolveDefault(promise, fallback).then(function(value) {
			if (settled)
				return;

			settled = true;
			window.clearTimeout(timer);
			resolve(value);
		});
	});
}

function getAtPayloadLines(output, command) {
	var lines = String(output || '').replace(/\r/g, '\n').split('\n').map(function(line) {
		return line.trim();
	}).filter(Boolean);
	var normalizedCommand = normalizeValue(command);

	return lines.filter(function(line) {
		if (/^(OK|ERROR|\+CME ERROR:.*)$/i.test(line))
			return false;

		if (normalizedCommand && line === normalizedCommand)
			return false;

		return true;
	});
}


function hasUsefulAtPayload(output, command, commandKey) {
	if (commandKey === 'csq')
		return parseCSQ(output) != null;

	if (commandKey === 'cops')
		return /\+COPS:/i.test(output);

	if (commandKey === 'cpin')
		return parseCPIN(output) != null;

	if (commandKey === 'iccid')
		return parseICCID(output) != null;

	if (commandKey === 'imsi')
		return parseIMSI(output) != null;

	if (commandKey === 'qnwinfo')
		return parseQNWINFO(output) != null;

	if (commandKey === 'qtemp')
		return parseTemperature(output) != null;

	if (commandKey === 'cbc')
		return parseCBC(output) != null;

	if (commandKey === 'qeng')
		return parseQENG(output) != null;

	return getAtPayloadLines(output, command).length > 0;
}

function execAtCommand(port, commands, commandKey) {
	commands = Array.isArray(commands) ? commands : [ commands ];

	function run(index, firstResult) {
		var command;

		if (index >= commands.length)
			return Promise.resolve(firstResult || { command: null, output: '' });

		command = commands[index];

		return execTextWithTimeout(SMS_TOOL_BIN, [ '-d', port, 'at', command ], AT_COMMAND_TIMEOUT_MS).then(function(output) {
			var result = {
				command: command,
				output: output
			};

			if (hasUsefulAtPayload(result.output, result.command, commandKey))
				return result;

			return run(index + 1, firstResult || result);
		});
	}

	return run(0, null);
}

function parseIndex(dbusPath) {
	var parts;

	if (!dbusPath)
		return null;

	parts = String(dbusPath).split('/');
	return parts.length ? parts[parts.length - 1] : null;
}

function normalizePort(port) {
	port = normalizeValue(port);

	if (!port)
		return null;

	if (String(port).indexOf('/dev/') === 0)
		return String(port);

	return '/dev/' + String(port);
}

function joinList(values) {
	values = Array.isArray(values) ? values.filter(function(item) {
		return normalizeValue(item) != null;
	}) : [];

	return values.length ? values.join(', ') : null;
}

function formatBandList(values, prefix) {
	values = Array.isArray(values) ? values : [];

	if (!values.length)
		return null;

	return values.map(function(value) {
		return prefix + String(value).replace(/[^0-9]/g, '');
	}).join(' ');
}

function formatMetric(value, suffix) {
	if (value == null || value === '')
		return null;

	return String(value) + (suffix || '');
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

function parseInteger(value) {
	var parsed = parseInt(value, 10);

	return isNaN(parsed) ? null : parsed;
}

function parseCSQ(output) {
	var match = output.match(/\+CSQ:\s*(\d+),(\d+)/);
	var value;

	if (!match)
		return null;

	value = parseInteger(match[1]);
	if (value == null || value === 99)
		return { value: value, percent: null, dbm: null };

	return {
		value: value,
		percent: Math.round((value / 31) * 100),
		dbm: -113 + (value * 2)
	};
}

function parseCBC(output) {
	var match = output.match(/\+CBC:\s*(\d+),(\d+),(\d+)/);
	var millivolts;

	if (!match)
		return null;

	millivolts = parseInteger(match[3]);

	return millivolts == null ? null : {
		millivolts: millivolts,
		volts: (millivolts / 1000).toFixed(2)
	};
}

function parseCPIN(output) {
	var match = output.match(/\+CPIN:\s*([^\r\n]+)/i);

	return match ? normalizeValue(match[1].replace(/"/g, '')) : null;
}

function parseICCID(output) {
	var match = output.match(/\+(?:QCCID|CCID):\s*"?([0-9A-F]+)"?/i);
	var payload;

	if (match)
		return normalizeValue(match[1]);

	payload = getAtPayloadLines(output).filter(function(line) {
		return /^[0-9A-F]{16,24}$/i.test(line);
	})[0];

	return normalizeValue(payload);
}

function parseIMSI(output) {
	var payload = getAtPayloadLines(output).filter(function(line) {
		return /^\d{5,18}$/.test(line);
	})[0];

	return normalizeValue(payload);
}

function parseQNWINFO(output) {
	var match;

	if (!output)
		return null;

	if (/No Service/i.test(output))
		return { network: _('No Service') };

	match = output.match(/\+QNWINFO:\s*"([^"]+)","([^"]+)","([^"]+)"(?:,(\d+))?/);
	if (!match)
		return null;

	return {
		network: normalizeValue(match[1]),
		plmn: normalizeValue(match[2]),
		band: normalizeValue(match[3]),
		channel: normalizeValue(match[4])
	};
}

function normalizeTemperatureCandidate(value) {
	var parsed = parseFloat(value);

	if (isNaN(parsed))
		return null;

	if (Math.abs(parsed) >= 1000)
		parsed = Math.round(parsed / 100) / 10;

	return parsed > -80 && parsed < 200 ? parsed : null;
}

function parseTemperature(output) {
	var values = [];
	var lines = getAtPayloadLines(output).filter(function(line) {
		return /(?:\+)?(?:QTEMP|CPMUTEMP)\b/i.test(line);
	});
	var i;

	for (i = 0; i < lines.length; i++) {
		var sanitized = lines[i]
			.replace(/^.*?(?:\+)?(?:QTEMP|CPMUTEMP)\s*:?\s*/i, '')
			.replace(/"([^"]*)"/g, function(match, token) {
				return /^-?\d+(?:\.\d+)?$/.test(token) ? token : ' ';
			});
		var matches = sanitized.match(/-?\d+(?:\.\d+)?/g);

		if (!matches)
			continue;

		values = values.concat(matches.map(normalizeTemperatureCandidate).filter(function(value) {
			return value != null;
		}));
	}

	if (!values.length)
		return null;

	return values.length ? { celsius: Math.max.apply(null, values), values: values } : null;
}

function parseCsvLine(text) {
	var tokens = [];
	var match;
	var line = text.split('\n').filter(function(item) {
		return item.indexOf('+QENG:') > -1;
	})[0];
	var body;
	var regex;

	if (!line)
		return null;

	body = line.replace(/^.*\+QENG:\s*/, '');
	regex = /"([^"]*)"|([^,]+)/g;

	while ((match = regex.exec(body)) !== null)
		tokens.push((match[1] != null ? match[1] : match[2]).trim());

	return tokens;
}

function parseQENG(output) {
	var tokens = parseCsvLine(output);
	var data = {};

	if (!tokens || !tokens.length)
		return null;

	if (tokens[0] !== 'servingcell')
		return { raw: tokens.join(', ') };

	data.state = normalizeValue(tokens[1]);
	data.mode = normalizeValue(tokens[2]);
	data.duplex = normalizeValue(tokens[3]);
	data.mcc = normalizeValue(tokens[4]);
	data.mnc = normalizeValue(tokens[5]);

	if (data.mode === 'NR5G-SA' && tokens.length >= 17) {
		data.cellId = normalizeValue(tokens[6]);
		data.pci = normalizeValue(tokens[7]);
		data.tac = normalizeValue(tokens[8]);
		data.arfcn = normalizeValue(tokens[9]);
		data.band = normalizeValue(tokens[10]);
		data.bandwidth = normalizeValue(tokens[11]);
		data.rsrp = parseInteger(tokens[12]);
		data.rsrq = parseInteger(tokens[13]);
		data.sinr = parseInteger(tokens[14]);
	}
	else {
		data.band = normalizeValue(tokens[10]);
	}

	return data;
}

function lookupOperatorName(code) {
	code = normalizeValue(code);

	if (!code || !PLMN_OPERATOR_MAP[String(code)])
		return null;

	return _(PLMN_OPERATOR_MAP[String(code)]);
}

function lookupRegionName(mcc) {
	mcc = normalizeValue(mcc);

	if (!mcc || !MCC_REGION_MAP[String(mcc)])
		return null;

	return _(MCC_REGION_MAP[String(mcc)]);
}

function percentFromRSRP(rsrp) {
	if (rsrp == null)
		return null;

	return Math.max(0, Math.min(100, Math.round(((rsrp + 140) / 70) * 100)));
}

function getSignalPercent(mmInfo, atInfo) {
	if (atInfo && atInfo.qeng && atInfo.qeng.rsrp != null)
		return percentFromRSRP(atInfo.qeng.rsrp);

	if (mmInfo && mmInfo.signalQuality != null)
		return mmInfo.signalQuality;

	if (atInfo && atInfo.csq && atInfo.csq.percent != null)
		return atInfo.csq.percent;

	return null;
}

function getSignalBars(percent) {
	if (percent == null)
		return 0;

	if (percent >= 80)
		return 4;
	if (percent >= 55)
		return 3;
	if (percent >= 30)
		return 2;
	if (percent >= 10)
		return 1;

	return 0;
}

function getMmInfo(mmState) {
	var modem = mmState && mmState.modem && mmState.modem.modem ? mmState.modem.modem : {};
	var generic = modem.generic || {};
	var modem3gpp = modem['3gpp'] || {};
	var location = mmState && mmState.location && mmState.location.modem && mmState.location.modem.location ? mmState.location.modem.location['3gpp'] || {} : {};

	return {
		manufacturer: normalizeValue(generic.manufacturer),
		model: normalizeValue(generic.model),
		revision: normalizeValue(generic.revision),
		imei: normalizeValue(modem3gpp.imei || generic['equipment-identifier']),
		deviceIdentifier: normalizeValue(generic['device-identifier']),
		powerState: normalizeValue(generic['power-state']),
		state: normalizeValue(generic.state),
		failReason: normalizeValue(generic['state-failed-reason']),
		accessTechnologies: joinList(generic['access-technologies']),
		currentCapabilities: joinList(generic['current-capabilities']),
		signalQuality: parseInteger(generic['signal-quality'] && generic['signal-quality'].value),
		simPath: normalizeValue(generic.sim),
		operatorName: normalizeValue(modem3gpp['operator-name']),
		operatorCode: normalizeValue(modem3gpp['operator-code']),
		registrationState: normalizeValue(modem3gpp['registration-state']),
		packetServiceState: normalizeValue(modem3gpp['packet-service-state']),
		primaryPort: normalizePort(generic['primary-port']),
		location: {
			cid: normalizeValue(location.cid),
			lac: normalizeValue(location.lac),
			mcc: normalizeValue(location.mcc),
			mnc: normalizeValue(location.mnc),
			tac: normalizeValue(location.tac)
		}
	};
}

function getSimInfo(mmState, atInfo) {
	var sim = mmState && mmState.sim && mmState.sim.sim ? mmState.sim.sim : {};
	var properties = sim.properties || {};
	var operatorCode = normalizeValue(properties['operator-identifier']);
	var operatorName = normalizeValue(properties['operator-name']) || lookupOperatorName(operatorCode);

	return {
		path: normalizeValue(mmState && mmState.simPath),
		active: normalizeValue(properties.active),
		iccid: normalizeValue(properties.iccid) || (atInfo && atInfo.iccid ? atInfo.iccid : null),
		imsi: normalizeValue(properties.imsi) || (atInfo && atInfo.imsi ? atInfo.imsi : null),
		eid: normalizeValue(properties.eid),
		operatorCode: operatorCode,
		operatorName: operatorName,
		simType: normalizeValue(properties['sim-type']),
		emergencyNumbers: joinList(properties['emergency-numbers']),
		pinState: atInfo && atInfo.cpin ? atInfo.cpin : null
	};
}

function getLocationInfo(mmInfo, atInfo) {
	var location = mmInfo && mmInfo.location ? mmInfo.location : {};
	var qeng = atInfo && atInfo.qeng ? atInfo.qeng : {};

	return {
		mcc: normalizeValue(location.mcc || qeng.mcc),
		mnc: normalizeValue(location.mnc || qeng.mnc),
		lac: normalizeValue(location.lac),
		tac: normalizeValue(location.tac || qeng.tac),
		cid: normalizeValue(location.cid || qeng.cellId)
	};
}

function formatAreaCode(locationInfo) {
	if (locationInfo.tac)
		return 'TAC ' + locationInfo.tac;

	if (locationInfo.lac)
		return 'LAC ' + locationInfo.lac;

	return null;
}

function formatRegion(mmInfo, atInfo) {
	var locationInfo = getLocationInfo(mmInfo, atInfo);
	var parts = [];
	var regionName = lookupRegionName(locationInfo.mcc);
	var areaCode = formatAreaCode(locationInfo);

	if (regionName)
		parts.push(regionName);
	if (locationInfo.mcc || locationInfo.mnc)
		parts.push('MCC/MNC ' + [ locationInfo.mcc, locationInfo.mnc ].filter(Boolean).join('/'));
	if (areaCode)
		parts.push(areaCode);
	if (locationInfo.cid)
		parts.push('CID ' + locationInfo.cid);

	return parts.length ? parts.join(' · ') : null;
}

function formatRegionDetail(mmInfo, atInfo) {
	var locationInfo = getLocationInfo(mmInfo, atInfo);
	var parts = [];
	var areaCode = formatAreaCode(locationInfo);

	if (areaCode)
		parts.push(areaCode);
	if (locationInfo.cid)
		parts.push('CID ' + locationInfo.cid);

	return parts.length ? parts.join(' · ') : null;
}

function formatOperator(mmInfo, atInfo) {
	var operatorCode = mmInfo.operatorCode || (atInfo && atInfo.qnwinfo ? atInfo.qnwinfo.plmn : null) || ((atInfo && atInfo.qeng && atInfo.qeng.mcc && atInfo.qeng.mnc) ? String(atInfo.qeng.mcc) + String(atInfo.qeng.mnc) : null);
	var operatorName = mmInfo.operatorName || lookupOperatorName(operatorCode);
	var details = [];

	if (operatorName)
		details.push(operatorName);
	if (operatorCode)
		details.push(operatorCode);

	return details.length ? details.join(' · ') : null;
}

function formatSimOperator(simInfo) {
	var details = [];

	if (simInfo.operatorName)
		details.push(simInfo.operatorName);
	if (simInfo.operatorCode)
		details.push(simInfo.operatorCode);

	return details.length ? details.join(' · ') : null;
}

function formatSimStatus(simInfo, mmInfo) {
	if (simInfo.pinState)
		return simInfo.pinState;

	if (mmInfo && mmInfo.failReason === 'sim-missing')
		return '未检测到 SIM 卡 · sim-missing';

	if (simInfo.active != null)
		return simInfo.active ? '已启用' : '未启用';

	if (!simInfo.path)
		return '未检测到 SIM 卡';

	return '--';
}

function formatAccess(mmInfo, atInfo) {
	var parts = [];

	if (atInfo && atInfo.qeng && atInfo.qeng.mode)
		parts.push(atInfo.qeng.mode + (atInfo.qeng.duplex ? ' / ' + atInfo.qeng.duplex : ''));
	else if (atInfo && atInfo.qnwinfo && atInfo.qnwinfo.network)
		parts.push(atInfo.qnwinfo.network);
	else if (mmInfo.accessTechnologies)
		parts.push(mmInfo.accessTechnologies);

	if (mmInfo.registrationState)
		parts.push(mmInfo.registrationState);

	return parts.length ? parts.join(' · ') : null;
}

function formatServingBand(atInfo) {
	if (atInfo && atInfo.qeng && atInfo.qeng.band)
		return (atInfo.qeng.mode && atInfo.qeng.mode.indexOf('NR5G') > -1 ? 'n' : 'B') + atInfo.qeng.band;

	if (atInfo && atInfo.qnwinfo && atInfo.qnwinfo.band)
		return atInfo.qnwinfo.band;

	return null;
}

function formatSignalDetails(mmInfo, atInfo) {
	var parts = [];

	if (atInfo && atInfo.qeng && atInfo.qeng.rsrp != null)
		parts.push('RSRP ' + atInfo.qeng.rsrp + ' dBm');
	if (atInfo && atInfo.qeng && atInfo.qeng.rsrq != null)
		parts.push('RSRQ ' + atInfo.qeng.rsrq + ' dB');
	if (atInfo && atInfo.qeng && atInfo.qeng.sinr != null)
		parts.push('SINR ' + atInfo.qeng.sinr + ' dB');
	if (!parts.length && atInfo && atInfo.csq && atInfo.csq.dbm != null)
		parts.push('RSSI ' + atInfo.csq.dbm + ' dBm');
	if (!parts.length && mmInfo.signalQuality != null)
		parts.push(_('Signal Quality') + ' ' + mmInfo.signalQuality + '%');

	return parts.length ? parts.join(' · ') : null;
}

function getModuleBadge(mmInfo, atInfo, bands) {
	if (atInfo && atInfo.qeng && atInfo.qeng.mode && atInfo.qeng.mode.indexOf('NR5G') > -1)
		return '5G';
	if (bands && Array.isArray(bands.enabled5gsa) && bands.enabled5gsa.length)
		return '5G';
	if (bands && Array.isArray(bands.enabled5gnsa) && bands.enabled5gnsa.length)
		return '5G';
	if (mmInfo.currentCapabilities && mmInfo.currentCapabilities.indexOf('lte') > -1)
		return '4G';

	return 'WWAN';
}

function getTemperatureText(atInfo) {
	if (atInfo && atInfo.qtemp && atInfo.qtemp.celsius != null)
		return atInfo.qtemp.celsius + ' °C';

	return _('Unavailable from current backend');
}

function getVoltageText(atInfo) {
	if (atInfo && atInfo.cbc && atInfo.cbc.volts)
		return atInfo.cbc.volts + ' V';

	return _('Unavailable from current backend');
}

function displayValue(value) {
	return (value != null && value !== '') ? value : '--';
}

function compactChildren(children) {
	return (children || []).filter(function(child) {
		return child != null;
	});
}

function formatModuleName(mmInfo, bands) {
	var manufacturer = normalizeValue(mmInfo.manufacturer);
	var model = normalizeValue(mmInfo.model) || normalizeValue(bands.modem);

	if (manufacturer && model && String(model).toLowerCase().indexOf(String(manufacturer).toLowerCase()) === 0)
		return model;

	if (manufacturer || model)
		return [ manufacturer, model ].filter(Boolean).join(' ');

	return _('Unknown');
}

function getBandTokens(values, prefix) {
	values = Array.isArray(values) ? values : [];

	if (!values.length)
		return [];

	values = values.map(function(value) {
		return prefix + String(value).replace(/[^0-9]/g, '');
	});

	if (values.indexOf(prefix + '0') > -1)
		return [ _('Bands are disabled...') ];

	return values;
}

function renderTag(text, extraClass) {
	if (text == null || text === '')
		return null;

	return E('span', { 'class': 'mb-status-chip ' + (extraClass || '') }, String(text));
}

function renderDetailRows(items) {
	items = (items || []).filter(function(item) {
		return item[1] != null && item[1] !== '';
	});

	if (!items.length)
		return null;

	return E('div', { 'class': 'mb-detail-rows' }, items.map(function(item) {
		return E('div', { 'class': 'mb-detail-row' }, [
			E('span', { 'class': 'mb-detail-label' }, item[0]),
			E('strong', { 'class': 'mb-detail-value' }, displayValue(item[1]))
		]);
	}));
}

function renderMetricCard(title, value, detail, extraClass, icon) {
	return E('div', { 'class': 'mb-overview-card ' + (extraClass || '') }, compactChildren([
		E('div', { 'class': 'mb-overview-card-head' }, compactChildren([
			E('div', { 'class': 'mb-overview-card-title' }, title),
			icon ? E('span', { 'class': 'mb-overview-card-badge' }, icon) : null
		])),
		E('div', { 'class': 'mb-overview-card-main' }, compactChildren([
			E('div', { 'class': 'mb-overview-card-value' }, displayValue(value)),
			detail ? E('div', { 'class': 'mb-overview-card-detail' }, detail) : null
		]))
	]));
}

function renderMetricBadgeIcon(kind) {
	if (kind === 'signal')
		return E('span', { 'class': 'mb-badge-icon mb-badge-icon-signal' }, [
			E('span', { 'class': 'mb-mini-bars' }, [
				E('span', { 'class': 'mb-mini-bar' }),
				E('span', { 'class': 'mb-mini-bar' }),
				E('span', { 'class': 'mb-mini-bar' }),
				E('span', { 'class': 'mb-mini-bar' })
			])
		]);

	if (kind === 'thermal')
		return E('span', { 'class': 'mb-badge-icon mb-badge-icon-thermal' }, [
			E('span', { 'class': 'mb-badge-icon-thermal-fill' })
		]);

	if (kind === 'power')
		return E('span', { 'class': 'mb-badge-icon mb-badge-icon-power' });

	if (kind === 'region')
		return E('span', { 'class': 'mb-badge-icon mb-badge-icon-region' }, [
			E('span', { 'class': 'mb-badge-icon-region-dot' })
		]);

	return null;
}

function renderSpotlightCard(title, value, subtitle, extraClass, tags, details) {
	tags = (tags || []).filter(function(tag) {
		return tag != null && tag !== '';
	});

	return E('div', { 'class': 'mb-spotlight-card ' + (extraClass || '') }, compactChildren([
		E('div', { 'class': 'mb-spotlight-head' }, compactChildren([
			E('div', { 'class': 'mb-spotlight-title' }, title)
		])),
		E('div', { 'class': 'mb-spotlight-body' }, compactChildren([
			E('div', { 'class': 'mb-spotlight-value' }, displayValue(value)),
			subtitle ? E('div', { 'class': 'mb-spotlight-subtitle' }, subtitle) : null,
			tags.length ? E('div', { 'class': 'mb-chip-list' }, tags.map(function(tag) {
				return renderTag(tag);
			})) : null
		])),
		renderDetailRows(details)
	]));
}

function renderModuleHero(mmInfo, atInfo, bands, signalPercent) {
	var badge = getModuleBadge(mmInfo, atInfo, bands);
	var bars = getSignalBars(signalPercent);
	var barsNode = [];
	var i;

	for (i = 0; i < 4; i++) {
		barsNode.push(E('span', {
			'class': 'mb-signal-bar' + (i < bars ? ' is-active' : ''),
			'style': 'height:' + String(6 + (i * 4)) + 'px'
		}));
	}

	return E('div', { 'class': 'mb-hero-card' }, compactChildren([
		E('div', { 'class': 'mb-hero-icon' }, compactChildren([
			E('div', { 'class': 'mb-device-glyph' }, [ E('span', { 'class': 'mb-device-chip' }, badge) ]),
			E('div', { 'class': 'mb-device-signal' }, barsNode)
		])),
		E('div', { 'class': 'mb-hero-copy' }, compactChildren([
			E('div', { 'class': 'mb-hero-kicker' }, _('Modem Overview')),
			E('div', { 'class': 'mb-hero-title' }, formatModuleName(mmInfo, bands)),
			E('div', { 'class': 'mb-hero-subtitle' }, compactChildren([
				E('span', { 'class': 'mb-pill' }, badge),
				mmInfo.state ? E('span', { 'class': 'mb-pill' }, mmInfo.state) : null,
				mmInfo.powerState ? E('span', { 'class': 'mb-pill' }, mmInfo.powerState) : null
			]))
		]))
	]));
}

function renderInfoTable(rows) {
	return E('table', { 'class': 'table' }, rows.filter(function(row) {
		return row[1] != null;
	}).map(function(row) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left', 'width': '32%' }, row[0]),
			E('td', { 'class': 'td left' }, row[1])
		]);
	}));
}

function renderOverview(state) {
	var bands = state.bands || {};
	var mmInfo = state.mmInfo || {};
	var simInfo = state.simInfo || {};
	var atInfo = state.atInfo || {};
	var signalPercent = getSignalPercent(mmInfo, atInfo);
	var registration = mmInfo.registrationState || (atInfo.qnwinfo && atInfo.qnwinfo.network) || _('No active network information is currently available.');
	var operatorInfo = formatOperator(mmInfo, atInfo) || _('Unavailable from current backend');
	var regionInfo = formatRegion(mmInfo, atInfo) || _('Unavailable from current backend');
	var regionDetail = formatRegionDetail(mmInfo, atInfo);
	var signalDetail = formatSignalDetails(mmInfo, atInfo) || _('No active network information is currently available.');
	var signalValue = signalPercent != null ? (signalPercent + '%') : '--';
	var accessInfo = formatAccess(mmInfo, atInfo) || _('Unavailable from current backend');
	var servingBand = formatServingBand(atInfo) || null;
	var operatorCode = mmInfo.operatorCode || (atInfo.qnwinfo && atInfo.qnwinfo.plmn) || null;
	var cellIdentity = atInfo.qeng && atInfo.qeng.cellId ? ('CID ' + atInfo.qeng.cellId) : null;

	return applyThemeClass(E('div', { 'class': 'mb-overview-root' }, compactChildren([
		renderModuleHero(mmInfo, atInfo, bands, signalPercent),
		!state.mmAvailable ? E('div', { 'class': 'alert-message warning' }, _('No runtime modem data is available. Install and start ModemManager to show live status.')) : null,
		E('div', { 'class': 'mb-spotlight-grid' }, compactChildren([
			renderSpotlightCard(_('Operator Information'), operatorInfo, registration, 'is-operator', [
				operatorCode,
				atInfo.qnwinfo && atInfo.qnwinfo.network ? atInfo.qnwinfo.network : null
			], [
				[ _('Access Technology'), accessInfo ],
				[ _('Region'), regionInfo ],
				[ 'PLMN', operatorCode ]
			]),
			renderSpotlightCard(_('Current Cell'), servingBand || cellIdentity || '--', signalDetail, 'is-cell', [
				atInfo.qeng && atInfo.qeng.mode ? atInfo.qeng.mode : null,
				atInfo.qeng && atInfo.qeng.duplex ? atInfo.qeng.duplex : null,
				atInfo.qeng && atInfo.qeng.bandwidth ? formatMetric(atInfo.qeng.bandwidth, ' MHz') : null
			], [
				[ 'PCI', atInfo.qeng && atInfo.qeng.pci ? atInfo.qeng.pci : null ],
				[ 'ARFCN', atInfo.qeng && atInfo.qeng.arfcn ? atInfo.qeng.arfcn : null ],
				[ 'TAC', atInfo.qeng && atInfo.qeng.tac ? atInfo.qeng.tac : mmInfo.location && mmInfo.location.tac ? mmInfo.location.tac : null ],
				[ 'CID', atInfo.qeng && atInfo.qeng.cellId ? atInfo.qeng.cellId : mmInfo.location && mmInfo.location.cid ? mmInfo.location.cid : null ]
			])
		])),
		E('div', { 'class': 'mb-overview-grid' }, compactChildren([
			renderMetricCard(_('Signal Strength'), signalValue, signalDetail, 'is-signal', renderMetricBadgeIcon('signal')),
			renderMetricCard(_('Module Temperature'), getTemperatureText(atInfo), atInfo.qtemp && atInfo.qtemp.values && atInfo.qtemp.values.length > 1 ? (atInfo.qtemp.values.join(' / ') + ' °C') : null, 'is-thermal', renderMetricBadgeIcon('thermal')),
			renderMetricCard(_('Module Voltage'), getVoltageText(atInfo), atInfo.cbc && atInfo.cbc.millivolts ? (atInfo.cbc.millivolts + ' mV') : null, 'is-power', renderMetricBadgeIcon('power')),
			renderMetricCard(_('Region'), regionInfo, regionDetail, 'is-region', renderMetricBadgeIcon('region'))
		])),
		E('div', { 'class': 'mb-overview-grid two-column' }, compactChildren([
			E('div', { 'class': 'mb-section-card' }, [
				E('div', { 'class': 'mb-section-title' }, _('Module Information')),
				renderInfoTable([
					[ _('Manufacturer'), mmInfo.manufacturer || normalizeValue(bands.modem) || '--' ],
					[ _('Model'), mmInfo.model || normalizeValue(bands.modem) || '--' ],
					[ _('Revision'), mmInfo.revision || '--' ],
					[ _('IMEI'), mmInfo.imei || '--' ],
					[ _('Device Status'), mmInfo.state || '--' ],
					[ _('Failure Reason'), mmInfo.failReason || '--' ],
					[ _('Power State'), mmInfo.powerState || '--' ],
					[ _('Primary Port'), state.port || mmInfo.primaryPort || '--' ]
				])
			]),
			E('div', { 'class': 'mb-section-card' }, [
				E('div', { 'class': 'mb-section-title' }, 'SIM 卡信息'),
				renderInfoTable([
					[ 'SIM 状态', formatSimStatus(simInfo, mmInfo) ],
					[ 'ICCID', simInfo.iccid || '--' ],
					[ 'IMSI', simInfo.imsi || '--' ],
					[ 'EID', simInfo.eid || '--' ],
					[ _('Operator'), formatSimOperator(simInfo) || operatorInfo || '--' ],
					[ 'SIM 类型', simInfo.simType || '--' ],
					[ '紧急号码', simInfo.emergencyNumbers || '--' ]
				])
			]),
			E('div', { 'class': 'mb-section-card' }, [
				E('div', { 'class': 'mb-section-title' }, _('Signal Details')),
				renderInfoTable([
					[ _('Access Technology'), accessInfo || '--' ],
					[ _('Registration State'), registration || '--' ],
					[ _('Serving Band'), servingBand || '--' ],
					[ _('Signal Details'), signalDetail || '--' ],
					[ 'TAC', atInfo.qeng && atInfo.qeng.tac ? atInfo.qeng.tac : mmInfo.location && mmInfo.location.tac ? mmInfo.location.tac : '--' ],
					[ 'CID', atInfo.qeng && atInfo.qeng.cellId ? atInfo.qeng.cellId : mmInfo.location && mmInfo.location.cid ? mmInfo.location.cid : '--' ],
					[ 'PCI', atInfo.qeng && atInfo.qeng.pci ? atInfo.qeng.pci : '--' ],
					[ 'ARFCN', atInfo.qeng && atInfo.qeng.arfcn ? atInfo.qeng.arfcn : '--' ]
				])
			])
		]))
	])), 'mb-dark');
}

function renderStyle() {
	return E('style', [
		'.mb-overview-root{display:flex;flex-direction:column;gap:16px;--mb-card-border:rgba(76,108,157,.14);--mb-card-border-soft:rgba(76,108,157,.08);--mb-card-bg:rgba(249,252,255,.98);--mb-hero-bg:linear-gradient(135deg,rgba(41,74,122,.12),rgba(255,255,255,.98) 56%,rgba(118,150,205,.16));--mb-spotlight-bg:linear-gradient(180deg,rgba(255,255,255,.99),rgba(240,246,255,.99));--mb-pill-bg:rgba(41,74,122,.07);--mb-badge-bg:rgba(41,74,122,.08);--mb-detail-bg:rgba(41,74,122,.04);--mb-glyph-bg:linear-gradient(160deg,#234170,#3d69a8);--mb-glyph-shadow:0 14px 24px rgba(49,93,154,.22);--mb-signal-bg:rgba(61,103,159,.18)}',
		'.mb-overview-root.mb-dark,body.dark .mb-overview-root,html.dark .mb-overview-root,body.mode-dark .mb-overview-root,body.argon-dark .mb-overview-root,html[data-theme="dark"] .mb-overview-root,body[data-theme="dark"] .mb-overview-root{--mb-card-border:rgba(124,147,186,.22);--mb-card-border-soft:rgba(124,147,186,.16);--mb-card-bg:rgba(16,24,38,.96);--mb-hero-bg:linear-gradient(135deg,rgba(12,20,36,.96),rgba(18,30,49,.98) 58%,rgba(35,66,103,.42));--mb-spotlight-bg:linear-gradient(180deg,rgba(18,28,44,.96),rgba(10,17,29,.98));--mb-pill-bg:rgba(104,146,214,.12);--mb-badge-bg:rgba(104,146,214,.12);--mb-detail-bg:rgba(255,255,255,.045);--mb-glyph-bg:linear-gradient(160deg,#0f1c31,#23466f);--mb-glyph-shadow:0 16px 28px rgba(0,0,0,.28);--mb-signal-bg:rgba(255,255,255,.16)}',
		'.mb-hero-card{display:grid;grid-template-columns:minmax(86px,110px) 1fr;gap:18px;padding:18px;border:1px solid var(--mb-card-border);border-radius:18px;background:var(--mb-hero-bg);box-shadow:0 10px 30px rgba(15,23,42,.06)}',
		'.mb-hero-icon{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}',
		'.mb-device-glyph{width:82px;height:82px;border-radius:22px;background:var(--mb-glyph-bg);display:flex;align-items:center;justify-content:center;box-shadow:var(--mb-glyph-shadow)}',
		'.mb-device-chip{display:inline-flex;align-items:center;justify-content:center;min-width:52px;height:52px;padding:0 10px;border-radius:16px;background:rgba(255,255,255,.14);color:#fff;font-size:1rem;font-weight:700;letter-spacing:.04em}',
		'.mb-device-signal{display:flex;align-items:flex-end;gap:4px;height:24px}',
		'.mb-signal-bar{display:block;width:8px;border-radius:999px;background:var(--mb-signal-bg)}',
		'.mb-signal-bar.is-active{background:linear-gradient(180deg,#22c55e,#16a34a)}',
		'.mb-hero-copy{display:flex;flex-direction:column;justify-content:center;gap:8px;min-width:0}',
		'.mb-hero-kicker{font-size:.82rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#64748b)}',
		'.mb-hero-title{font-size:1.55rem;font-weight:700;line-height:1.2;word-break:break-word}',
		'.mb-hero-subtitle{display:flex;flex-wrap:wrap;gap:8px}',
		'.mb-pill{display:inline-flex;align-items:center;padding:5px 10px;border-radius:999px;background:var(--mb-pill-bg);font-size:.84rem;color:var(--text-color-high,#1f2937)}',
		'.mb-spotlight-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;align-items:stretch}',
		'.mb-spotlight-card{position:relative;overflow:hidden;display:flex;flex-direction:column;gap:12px;height:100%;border:1px solid var(--mb-card-border);border-radius:18px;background:var(--mb-spotlight-bg);padding:18px;box-shadow:0 10px 24px rgba(15,23,42,.06)}',
		'.mb-spotlight-card:before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,#94a3b8,#e2e8f0)}',
		'.mb-spotlight-card.is-operator:before{background:linear-gradient(90deg,#0ea5e9,#2563eb)}',
		'.mb-spotlight-card.is-cell:before{background:linear-gradient(90deg,#10b981,#22c55e)}',
		'.mb-spotlight-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
		'.mb-spotlight-title{display:flex;align-items:center;gap:8px;font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#64748b)}',
		'.mb-spotlight-body{display:flex;flex-direction:column;gap:10px;min-height:0}',
		'.mb-spotlight-value{font-size:1.55rem;font-weight:700;line-height:1.25;word-break:break-word}',
		'.mb-spotlight-subtitle{font-size:.92rem;color:var(--text-color-high,#334155);line-height:1.45;word-break:break-word}',
		'.mb-chip-list{display:flex;flex-wrap:wrap;gap:8px}',
		'.mb-status-chip{display:inline-flex;align-items:center;max-width:100%;padding:6px 10px;border-radius:999px;background:var(--mb-pill-bg);color:var(--text-color-high,#334155);font-size:.82rem;font-weight:600;line-height:1.2;word-break:break-word}',
		'.mb-status-chip.is-band{background:rgba(37,99,235,.08);color:#1d4ed8}',
		'.mb-status-chip.is-family{background:rgba(245,158,11,.12);color:#b45309}',
		'.mb-status-chip.is-placeholder{color:var(--text-muted,#64748b);font-weight:500}',
		'.mb-detail-rows{display:grid;gap:10px;margin-top:auto;padding-top:4px}',
		'.mb-detail-row{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--mb-card-border-soft);border-radius:12px;background:var(--mb-detail-bg)}',
		'.mb-detail-label{color:var(--text-muted,#64748b);font-size:.85rem}',
		'.mb-detail-value{color:var(--text-color-high,#0f172a);font-size:.9rem;text-align:right;word-break:break-word}',
		'.mb-overview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;align-items:stretch}',
		'.mb-overview-grid.two-column{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}',
		'.mb-overview-card,.mb-section-card{position:relative;display:flex;flex-direction:column;height:100%;border:1px solid var(--mb-card-border);border-radius:16px;background:var(--mb-card-bg);padding:16px;box-shadow:0 6px 18px rgba(15,23,42,.05)}',
		'.mb-overview-card:before{content:"";position:absolute;inset:0 auto 0 0;width:4px;border-radius:16px 0 0 16px;background:linear-gradient(180deg,#cbd5e1,#94a3b8)}',
		'.mb-overview-card.is-signal:before{background:linear-gradient(180deg,#22c55e,#14b8a6)}',
		'.mb-overview-card.is-thermal:before{background:linear-gradient(180deg,#f59e0b,#ef4444)}',
		'.mb-overview-card.is-power:before{background:linear-gradient(180deg,#8b5cf6,#2563eb)}',
		'.mb-overview-card.is-region:before{background:linear-gradient(180deg,#0ea5e9,#06b6d4)}',
		'.mb-overview-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
		'.mb-overview-card-title,.mb-section-title{display:flex;align-items:center;gap:8px;font-size:.82rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#64748b)}',
		'.mb-overview-card-badge{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:34px;padding:0 8px;border-radius:12px;background:var(--mb-badge-bg);color:var(--text-color-high,#1f2937)}',
		'.mb-overview-card.is-signal .mb-overview-card-badge{background:rgba(56,189,248,.12);color:#38bdf8}',
		'.mb-overview-card.is-thermal .mb-overview-card-badge{background:rgba(249,115,22,.12);color:#f97316}',
		'.mb-overview-card.is-power .mb-overview-card-badge{background:rgba(59,130,246,.12);color:#2563eb}',
		'.mb-overview-card.is-region .mb-overview-card-badge{background:rgba(6,182,212,.12);color:#0891b2}',
		'.mb-overview-card-main{display:flex;flex-direction:column;gap:10px;margin-top:auto}',
		'.mb-overview-card-value{font-size:1.5rem;font-weight:700;line-height:1.2;word-break:break-word}',
		'.mb-overview-card-detail{padding-top:10px;border-top:1px solid var(--mb-card-border-soft);font-size:.9rem;color:var(--text-muted,#64748b);line-height:1.45;word-break:break-word}',
		'.mb-badge-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:none}',
		'.mb-mini-bars{display:flex;align-items:flex-end;gap:2px;height:16px}',
		'.mb-mini-bar{display:block;width:3px;height:100%;background:currentColor;border-radius:999px}',
		'.mb-mini-bar:nth-child(1){height:25%}',
		'.mb-mini-bar:nth-child(2){height:50%}',
		'.mb-mini-bar:nth-child(3){height:75%}',
		'.mb-mini-bar:nth-child(4){height:100%}',
		'.mb-badge-icon-signal .mb-mini-bars{height:16px}',
		'.mb-badge-icon-thermal:before{content:"";position:absolute;left:6px;top:1px;width:6px;height:13px;border:2px solid currentColor;border-bottom:none;border-radius:999px 999px 0 0;box-sizing:border-box;opacity:.92}',
		'.mb-badge-icon-thermal:after{content:"";position:absolute;left:4px;bottom:0;width:10px;height:10px;border-radius:50%;background:currentColor}',
		'.mb-badge-icon-thermal-fill{position:absolute;left:8px;top:5px;width:2px;height:7px;border-radius:999px;background:currentColor}',
		'.mb-badge-icon-power:before{content:"";position:absolute;inset:1px 2px 1px 3px;background:currentColor;clip-path:polygon(58% 0,100% 0,67% 40%,100% 40%,34% 100%,46% 60%,0 60%)}',
		'.mb-badge-icon-region:before{content:"";position:absolute;left:3px;top:1px;width:12px;height:12px;border:2px solid currentColor;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-sizing:border-box}',
		'.mb-badge-icon-region-dot{position:absolute;left:7px;top:5px;width:4px;height:4px;border-radius:50%;background:currentColor}',
		'.mb-section-title{padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid var(--mb-card-border-soft)}',
		'.mb-section-card .table{margin-bottom:0}',
		'.mb-section-card .table tr + tr td{border-top:1px solid var(--mb-card-border-soft)}',
		'.mb-section-card .table td:first-child{color:var(--text-muted,#64748b)}',
		'.mb-section-card .table td{vertical-align:top}',
		'@media (max-width:780px){.mb-detail-row{flex-direction:column;align-items:flex-start}.mb-detail-value{text-align:left}}',
		'@media (max-width:640px){.mb-hero-card{grid-template-columns:1fr;gap:14px}.mb-hero-icon{flex-direction:row;justify-content:flex-start}.mb-hero-title{font-size:1.3rem}.mb-band-focus-value{font-size:1.1rem}}'
	].join('\n'));
}

return view.extend({
	loadRuntimeState: function() {
		return execJson(MMCLI_BIN, [ '-L', '-J' ]).then(function(list) {
			var index = list && Array.isArray(list['modem-list']) ? parseIndex(list['modem-list'][0]) : null;

			if (index == null)
				return null;

			return Promise.all([
				execJson(MMCLI_BIN, [ '-m', String(index), '-J' ]),
				execJson(MMCLI_BIN, [ '-m', String(index), '--location-get', '-J' ])
			]).then(function(results) {
				var modem = results[0] && results[0].modem && results[0].modem.modem ? results[0].modem.modem : {};
				var generic = modem.generic || {};
				var simIndex = parseIndex(generic.sim);

				function buildState(sim) {
					return {
						index: index,
						modem: results[0],
						location: results[1],
						sim: sim,
						simPath: normalizeValue(generic.sim)
					};
				}

				if (simIndex == null)
					return buildState(null);

				return resolveWithTimeout(execJson(MMCLI_BIN, [ '-i', String(simIndex), '-J' ]), null, 4000).then(buildState);
			});
		});
	},

	loadAtState: function(port) {
		var sequence;
		var raw = {};
		var key;

		if (!port)
			return Promise.resolve(null);

		sequence = Promise.resolve();

		function functionFactory(commandKey) {
			return function(result) {
				raw[commandKey] = result.output;
			};
		}

		for (key in AT_COMMANDS)
			sequence = sequence.then(execAtCommand.bind(null, port, AT_COMMANDS[key], key)).then(functionFactory(key));

		return sequence.then(function() {
			var parsed = {};

			parsed.csq = parseCSQ(raw.csq || '');
			parsed.cops = normalizeValue(raw.cops);
			parsed.cpin = parseCPIN(raw.cpin || '');
			parsed.iccid = parseICCID(raw.iccid || '');
			parsed.imsi = parseIMSI(raw.imsi || '');
			parsed.qnwinfo = parseQNWINFO(raw.qnwinfo || '');
			parsed.qtemp = parseTemperature(raw.qtemp || '');
			parsed.cbc = parseCBC(raw.cbc || '');
			parsed.qeng = parseQENG(raw.qeng || '');
			parsed.raw = raw;

			return parsed;
		});
	},

	fetchState: function() {
		var self = this;

		if (self._fetchStatePromise)
			return self._fetchStatePromise;

		self._fetchStatePromise = Promise.all([
			execJson(MODEMBAND_BIN, [ 'json' ]),
			this.loadRuntimeState(),
			resolveWithTimeout(uci.load('modemband'), null, 5000)
		]).then(function(results) {
			var bands = results[0] || {};
			var mmState = results[1];
			var mmInfo = getMmInfo(mmState);
			var configuredPort = normalizePort(uci.get('modemband', '@modemband[0]', 'set_port'));
			var port = configuredPort || mmInfo.primaryPort || null;

			return self.loadAtState(port).then(function(atInfo) {
				return {
					bands: bands,
					mmAvailable: !!mmState,
					mmState: mmState,
					mmInfo: mmInfo,
					simInfo: getSimInfo(mmState, atInfo),
					atInfo: atInfo,
					port: port
				};
			});
		}).then(function(state) {
			self._fetchStatePromise = null;
			return state;
		}, function(err) {
			self._fetchStatePromise = null;
			throw err;
		});

		return self._fetchStatePromise;
	},

	load: function() {
		return this.fetchState();
	},

	render: function(state) {
		var root = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Modem Overview')),
			renderStyle(),
			E('div')
		]);
		var container = root.lastElementChild;
		var self = this;

		dom.content(container, renderOverview(state));

		poll.add(function() {
			return self.fetchState().then(function(nextState) {
				dom.content(container, renderOverview(nextState));
			});
		}, 10);

		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
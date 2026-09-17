'use strict';
'require view';
'require rpc';
'require dom';
'require poll';

var callSummary = rpc.declare({ object: 'luci.traffic', method: 'getSummary' });
var callHourly  = rpc.declare({ object: 'luci.traffic', method: 'getHourly', params: [ 'hours' ] });
var callSeries  = rpc.declare({ object: 'luci.traffic', method: 'getSeries', params: [ 'range' ] });
var callResolveNow = rpc.declare({ object: 'luci.traffic', method: 'resolveNow' });

/* Vivid, evenly spaced hues: bright enough to read on a light card and to keep
 * their identity on a dark one. */
var PALETTE = [
	'#00b4ff', '#ff7a45', '#36cfc9', '#ff4d8d', '#7c5cff',
	'#ffc53d', '#40d97b', '#ff9f1c', '#5cd1ff', '#b37feb'
];

var ICON = 26;   /* one size everywhere: list rows, donut legend */

/* Throughput history.  The collector keeps two tiers, so the range selector on
 * the chart is a choice of granularity, not of window width: 10 s points for
 * the last hour, 1 min points for the last day.  A point is [epoch, down, up]
 * in bytes, and the rate is bytes divided by the tier's interval. */
var SERIES_RANGES = {
	'1h':  { label: 'Last hour',      interval: 10 },
	'12h': { label: 'Last 12 hours',  interval: 60 },
	'24h': { label: 'Last 24 hours',  interval: 60 },
	'7d':  { label: 'Last 7 days',    interval: 3600 }
};
/* The one range control on the page.  It picks the window the application table
 * aggregates over, and because the throughput curve is that same window drawn at
 * a coarser granularity, it picks the tier the curve is read from too.  The page
 * used to carry two dropdowns for this - one in the hero for the table and one on
 * the chart for the tier - and they could be set to disagree. */
var RANGE_OPTIONS = [
	/* "Since start" is not a window, so the curve cannot follow it: it keeps the
	 * day tier, which is what the page opens on.  Every other choice is a window
	 * and the curve shows exactly that window. */
	{ value: 'session', label: 'Since start',   tier: '24h' },
	{ value: '1',       label: 'Last hour',     tier: '1h'  },
	{ value: '12',      label: 'Last 12 hours', tier: '12h' },
	{ value: '24',      label: 'Last 24 hours', tier: '24h' },
	{ value: '168',     label: 'Last 7 days',   tier: '7d'  }
];

function tierOfRange(v) {
	for (var i = 0; i < RANGE_OPTIONS.length; i++)
		if (RANGE_OPTIONS[i].value === v) return RANGE_OPTIONS[i].tier;
	return '1h';
}

var CHART_W = 720, CHART_H = 190, CHART_PAD = { l: 10, r: 10, t: 14, b: 22 };

/* Names that are not an application or a website but a bucket: a protocol
 * (SSL/TLS, QUIC, ...) or an infrastructure category (CDN, Ads, ...).  They are
 * drawn with their category glyph and muted text, so a row reads as "what kind
 * of traffic" rather than "which product".  Kept in sync with the bucket names
 * the collector produces and with the glyph files shipped for them. */
var BUCKETS = {
	'Ads': 1, 'Adult': 1, 'AI': 1, 'Android App Download': 1,
	'Automotive': 1, 'Blog': 1, 'Browser': 1, 'Business': 1,
	'CDN': 1, 'Certificate': 1, 'Cloud Storage': 1, 'Communication': 1,
	'Crypto': 1, 'DDNS': 1, 'DHCP': 1, 'DNS': 1,
	'Education': 1, 'Email': 1, 'Entertainment': 1, 'Finance': 1,
	'FLV': 1, 'Food': 1, 'Forums': 1, 'FTP': 1,
	'Games': 1, 'Geo': 1, 'Government': 1, 'Hardware': 1,
	'Health': 1, 'HTTP': 1, 'ICMP': 1, 'IPSec': 1,
	'IPTV': 1, 'L2TP': 1, 'Logistics': 1, 'Media': 1,
	'Media Server': 1, 'MQTT': 1, 'MSSQL': 1, 'MySQL': 1,
	'NTP': 1, 'Other': 1, 'PostgreSQL': 1, 'PPTP': 1,
	'Proxy': 1, 'QUIC': 1, 'RADIUS': 1, 'RDP': 1,
	'Redis': 1, 'RTSP': 1, 'Security': 1, 'Shopping': 1,
	'SIP': 1, 'SMB': 1, 'SMS': 1, 'SNMP': 1,
	'Social': 1, 'Software': 1, 'Speed Test': 1, 'SSH': 1,
	'SSL/TLS': 1, 'STUN': 1, 'Telnet': 1, 'Torrent': 1,
	'Tracker': 1, 'VPN': 1, 'Website': 1, 'Wiki': 1
};

function isBucket(name) { return BUCKETS[name] === 1; }

/* A row is only worth drawing when something was actually measured. */
function hasTraffic(item) { return (item.down + item.up) > 0; }

/* The address list is the one status value that is naturally long, so it is
 * shortened here and keeps its exact value in the tooltip: the first address
 * plus how many others there are. */
function shortAddrs(v) {
	var a = String(v || '').split(/\s+/).filter(function(s) { return s.length > 0; });
	if (!a.length) return '—';
	if (a.length === 1) return a[0];
	return a[0] + ' +' + (a.length - 1);
}

function fmtBytes(n) {
	n = Number(n) || 0;
	var units = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ], i = 0;
	while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
	if (i === 0) return n.toFixed(0) + ' B';
	return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : n.toFixed(0)) + ' ' + units[i];
}

function fmtRate(bps) {
	if (!(bps > 0)) return '0 B/s';
	return fmtBytes(bps) + '/s';
}

function slug(name) {
	return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* Colours are derived from the application name, never from its rank, so an
 * application keeps the same colour while the ranking moves around.  Two names
 * that hash to the same slot are separated in *name* order, which is also
 * rank-independent - so the palette stays stable across refreshes. */
var colorMap = {};

function baseIndex(name) {
	var h = 0, s = String(name);
	for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h % PALETTE.length;
}

function assignColors(items) {
	var used = {}, map = {};
	var names = items.map(function(a) { return a.name; })
		.filter(function(n, i, arr) { return arr.indexOf(n) === i; })
		.sort();
	names.forEach(function(n) {
		var i = baseIndex(n), guard = 0;
		while (used[i] && guard++ < PALETTE.length) i = (i + 1) % PALETTE.length;
		used[i] = true;
		map[n] = i;
	});
	return map;
}

function colorFor(name) {
	var i = (name in colorMap) ? colorMap[name] : baseIndex(name);
	return PALETTE[i];
}

/* Icon: a bundled SVG if one exists for this name, else a letter avatar in the
 * app's own colour.  Same box size either way, so rows never jump. */
function makeIcon(name) {
	var box = E('span', {
		'class': 'tf-icon',
		'style': 'background:' + colorFor(name)
	}, [ E('span', { 'class': 'tf-icon-letter' }, [ (name || '?').charAt(0).toUpperCase() ]) ]);

	var img = new Image();
	img.onload = function() {
		box.textContent = '';
		box.style.background = 'transparent';
		box.style.boxShadow = 'none';
		img.className = 'tf-icon-img';
		box.appendChild(img);
	};
	img.src = L.resource('traffic/icons/' + slug(name) + '.svg');
	return box;
}

/* Donut drawn with one stroked circle per slice (dash offset), which needs no
 * arc maths and stays crisp at any size. */
function makeDonut(items, total) {
	var size = 168, stroke = 20, r = (size - stroke) / 2, c = 2 * Math.PI * r;
	var svg = S('svg', { 'width': size, 'height': size, 'viewBox': '0 0 ' + size + ' ' + size,
		'class': 'tf-donut-svg' });
	var g = S('g', { 'transform': 'translate(' + (size / 2) + ',' + (size / 2) + ') rotate(-90)' });

	if (!total || !items.length) {
		g.appendChild(S('circle', { 'r': r, 'fill': 'none', 'stroke': 'rgba(140,160,180,.22)', 'stroke-width': stroke }));
	}
	else {
		var offset = 0;
		for (var i = 0; i < items.length; i++) {
			var frac = items[i].bytes / total;
			var len = Math.max(frac * c - 2, 0.6);
			g.appendChild(S('circle', {
				'r': r, 'fill': 'none', 'stroke-linecap': 'butt',
				'stroke': colorFor(items[i].name),
				'stroke-width': stroke,
				'stroke-dasharray': len + ' ' + (c - len),
				'stroke-dashoffset': -offset
			}));
			offset += frac * c;
		}
	}
	svg.appendChild(g);
	if (!total || !items.length) {
		svg.appendChild(S('text', { 'x': size / 2, 'y': size / 2 + 4, 'text-anchor': 'middle',
			'class': 'tf-donut-empty', 'text': _('No traffic recorded yet.') }));
	}
	return svg;
}

function el(tag, attrs, children) { return E(tag, attrs || {}, children || []); }

/* SVG needs its own namespace.
 *
 * LuCI's E() ends up in dom.create(), which calls document.createElement() -
 * and that never produces an SVG element, so a donut or a chart built with E()
 * simply does not render (it becomes an unknown HTML element with no size).
 * Everything drawn as SVG therefore goes through S(). */
var SVG_NS = 'http://www.w3.org/2000/svg';
function S(tag, attrs, children) {
	var n = document.createElementNS(SVG_NS, tag), k;
	for (k in (attrs || {})) {
		if (k === 'class') n.setAttribute('class', attrs[k]);
		else if (k === 'text') n.textContent = attrs[k];
		else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== '') n.setAttribute(k, attrs[k]);
	}
	(children || []).forEach(function(c) { if (c) n.appendChild(c); });
	return n;
}

/* Write text only when it actually changed.  The page polls every 5 s and most
 * of what it redraws is identical to the previous round; skipping the write
 * keeps the browser from invalidating layout and repainting for nothing. */
function setText(node, text) {
	text = String(text);
	if (node.__tfText === text) return;
	node.__tfText = text;
	node.textContent = text;
}

/* A range picker drawn by this page instead of by the browser.  A native
 * <select> can only be styled while it is closed: the list that opens is the
 * operating system's, so it keeps square corners and the system highlight while
 * every other control here is a rounded chip - which is exactly how it looked on
 * the router.  This is the same control built from elements the page owns, and
 * it keeps the keyboard behaviour a select has (Enter/Space opens, the arrows
 * move, Escape closes), so nothing is given up by not using one. */
function makeRangePicker(options, value, onChange) {
	var current = value, open = false;
	var label = el('span', { 'class': 'tf-dd-label' });
	var btn = el('button', { 'class': 'tf-range tf-dd-btn', 'type': 'button',
		'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, [ label ]);
	var menu = el('div', { 'class': 'tf-dd-menu', 'role': 'listbox' });
	var wrap = el('div', { 'class': 'tf-dd' }, [ btn, menu ]);

	var rows = options.map(function(o) {
		var row = el('button', { 'class': 'tf-dd-item', 'type': 'button', 'role': 'option',
			'click': function(ev) { ev.stopPropagation(); pick(o.value); } }, [ o.label ]);
		menu.appendChild(row);
		return { value: o.value, label: o.label, row: row, cls: '' };
	});

	function paint() {
		var chosen = null;
		rows.forEach(function(r) {
			if (r.value === current) chosen = r;
			var on = (r.value === current);
			r.row.setAttribute('aria-selected', on ? 'true' : 'false');
			var cls = 'tf-dd-item' + (on ? ' tf-dd-on' : '');
			if (r.cls !== cls) { r.cls = cls; r.row.className = cls; }
		});
		setText(label, chosen ? chosen.label : '');
	}

	function show(on) {
		if (on === open) return;
		open = on;
		btn.setAttribute('aria-expanded', on ? 'true' : 'false');
		wrap.className = 'tf-dd' + (on ? ' tf-dd-open' : '');
	}

	function pick(v) {
		show(false);
		if (v === current) return;
		current = v;
		paint();
		onChange(v);
	}

	btn.addEventListener('click', function(ev) { ev.stopPropagation(); show(!open); });
	btn.addEventListener('keydown', function(ev) {
		var k = ev.key;
		if (k === 'Escape') { show(false); return; }
		if (k !== 'ArrowDown' && k !== 'ArrowUp' && k !== 'Enter' && k !== ' ') return;
		ev.preventDefault();
		if (!open) { show(true); return; }
		var at = -1;
		rows.forEach(function(r, i) { if (r.value === current) at = i; });
		var n = rows.length;
		var next = (k === 'ArrowUp') ? (at <= 0 ? n - 1 : at - 1) : (at >= n - 1 ? 0 : at + 1);
		if (rows[next]) pick(rows[next].value);
	});
	/* the menu must not close itself through the document handler below */
	menu.addEventListener('click', function(ev) { ev.stopPropagation(); });
	menu.addEventListener('keydown', function(ev) {
		if (ev.key === 'Escape') { show(false); btn.focus(); }
	});
	/* clicking anywhere else on the page closes it, the way a select does */
	document.addEventListener('click', function() { show(false); });

	paint();
	return {
		node: wrap,
		set: function(v) { if (v !== current) { current = v; paint(); } }
	};
}

/* A row is remembered by application name so a refresh can update the numbers
 * in place.  Rebuilding instead would recreate ~12 nodes, a letter avatar and
 * an <img> per row every 5 s - and the <img> would be decoded again each time. */
function makeRow(name, bucket) {
	var icon = makeIcon(name);
	var nameEl = el('span', { 'class': 'tf-app-name', 'title': name }, [ name ]);
	var cells = {
		total: el('td', { 'class': 'tf-num tf-total' }),
		down:  el('td', { 'class': 'tf-num tf-down' }),
		up:    el('td', { 'class': 'tf-num tf-up' }),
		top:   el('td', { 'class': 'tf-top' }),
		clients: el('td', { 'class': 'tf-num' })
	};
	var tr = el('tr', { 'class': bucket ? 'tf-isbucket' : '' }, [
		el('td', { 'class': 'tf-app' }, [
			icon, nameEl,
			bucket ? el('span', { 'class': 'tf-tag' }, [ _('type') ]) : ''
		]),
		cells.total, cells.down, cells.up, cells.top, cells.clients
	]);
	return { tr: tr, cells: cells };
}

function updateRow(row, a, total) {
	var share = total ? (100 * a.bytes / total) : 0;
	setText(row.cells.total, fmtBytes(a.bytes) + ' (' + share.toFixed(1) + '%)');
	setText(row.cells.down, fmtBytes(a.down));
	setText(row.cells.up, fmtBytes(a.up));
	var topText = '—';
	if (a.top) {
		var ts = a.bytes ? (100 * (a.top_bytes || 0) / a.bytes) : 0;
		topText = a.top + ' ' + fmtBytes(a.top_bytes || 0) + ' (' + ts.toFixed(1) + '%)';
	}
	setText(row.cells.top, topText);
	setText(row.cells.clients, a.clients === undefined ? '—' : String(a.clients));
}

/* The legend rows are reused the same way: only the percentage moves. */
function makeLegendRow(name) {
	var pctEl = el('span', { 'class': 'tf-legend-pct' });
	var row = el('div', { 'class': 'tf-legend-row' }, [
		el('span', { 'class': 'tf-legend-dot', 'style': 'background:' + colorFor(name) }),
		el('span', { 'class': 'tf-legend-name' }, [ name ]),
		pctEl
	]);
	return { row: row, pct: pctEl };
}

/* "14:05" for the axis labels, from an epoch in seconds. */
function hhmm(t) {
	var d = new Date((Number(t) || 0) * 1000);
	function p(n) { return (n < 10 ? '0' : '') + n; }
	return p(d.getHours()) + ':' + p(d.getMinutes());
}

/* Round the top of the axis to a value that also reads well: the ladder is
 * binary because fmtRate() labels in KiB/MiB, so 1.5 MiB/s is a nicer gridline
 * than 1.91 MiB/s. */
function niceTop(peak) {
	if (!(peak > 0)) return 1;
	var k = Math.floor(Math.log(peak) / Math.log(1024));
	if (k < 0) k = 0;
	var base = Math.pow(1024, k), m = peak / base;
	var ladder = [ 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024 ];
	for (var i = 0; i < ladder.length; i++)
		if (m <= ladder[i] + 1e-9) return ladder[i] * base;
	return 1024 * base;
}

/* The throughput chart: one stroked polyline per direction over a translucent
 * area, drawn by hand so it needs no chart library and inherits the page's
 * colours.  A flat zero reads as a line on the floor rather than as a gap. */
function makeChart(series) {
	var pad = CHART_PAD, W = CHART_W, H = CHART_H;
	var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
	var n = series.length;

	var peak = 0;
	for (var i = 0; i < n; i++) {
		if (series[i].down > peak) peak = series[i].down;
		if (series[i].up > peak) peak = series[i].up;
	}
	var top = niceTop(peak);

	var x = function(k) { return pad.l + (n < 2 ? iw / 2 : (k * iw) / (n - 1)); };
	var y = function(v) { return pad.t + ih - (Math.max(0, Math.min(1, v / top)) * ih); };

	var svg = S('svg', {
		'class': 'tf-chart-svg', 'viewBox': '0 0 ' + W + ' ' + H, 'role': 'img'
	});

	/* horizontal grid, with the value on each line */
	for (var gi = 0; gi <= 2; gi++) {
		var gv = top * (gi / 2), gy = y(gv);
		svg.appendChild(S('line', {
			'x1': pad.l, 'x2': W - pad.r, 'y1': gy, 'y2': gy,
			'stroke': 'rgba(140,160,180,.20)', 'stroke-width': 1,
			'stroke-dasharray': gi === 0 ? '' : '3 4'
		}));
		svg.appendChild(S('text', {
			'x': W - pad.r - 2, 'y': gy - 3, 'text-anchor': 'end',
			'class': 'tf-chart-tick', 'text': fmtRate(gv)
		}));
	}

	function path(key, fill) {
		var d = '', area = '';
		for (var k = 0; k < n; k++) {
			d += (k ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(series[k][key]).toFixed(1) + ' ';
		}
		area = d + 'L' + x(n - 1).toFixed(1) + ' ' + (pad.t + ih) + ' L' + x(0).toFixed(1) + ' ' + (pad.t + ih) + ' Z';
		if (fill) svg.appendChild(S('path', { 'd': area, 'fill': fill, 'stroke': 'none' }));
		svg.appendChild(S('path', {
			'd': d, 'fill': 'none', 'stroke': key === 'down' ? '#00a8e8' : '#26c281',
			'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
		}));
	}

	path('down', 'rgba(0,168,232,.13)');
	path('up', 'rgba(38,194,129,.11)');

	/* first and last timestamp, so the window is unambiguous */
	svg.appendChild(S('text', { 'x': pad.l, 'y': H - 6, 'class': 'tf-chart-tick',
		'text': hhmm(series[0].t) }));
	svg.appendChild(S('text', { 'x': W - pad.r, 'y': H - 6, 'text-anchor': 'end',
		'class': 'tf-chart-tick', 'text': hhmm(series[n - 1].t) }));

	return svg;
}

return view.extend({
	summary: null,
	prev: null,
	rate: { down: 0, up: 0 },
	/* One day by default: it is the window the total, the donut and the table
	 * all describe, and the one the reference layout opens on.  "Since start"
	 * stays available for watching the current session move. */
	range: '24',

	load: function() { return callSummary(); },

	render: function(summary) {
		this.summary = summary || {};
		var self = this;

		this.rateDown = el('b', {}, [ '—' ]);
		this.rateUp   = el('b', {}, [ '—' ]);
		this.totalEl  = el('div', { 'class': 'tf-grand-total' }, [ '—' ]);
		this.donutEl  = el('div', { 'class': 'tf-donut' });
		this.legendEl = el('div', { 'class': 'tf-legend' });
		this.rowsEl   = el('tbody');
		this.metaEl   = el('div', { 'class': 'tf-meta' });
		this.chartEl  = el('div', { 'class': 'tf-chart' });
		this.chartNote = el('span', { 'class': 'tf-chart-note' });
		/* The key for the two curves.  They are drawn in the same colours the
		 * chart uses, so a small upload curve is identifiable rather than
		 * looking like a stray line at the floor. */
		this.chartLegend = el('div', { 'class': 'tf-chart-legend' }, [
			el('span', { 'class': 'tf-lg-down' }, [ el('i'), _('Received') ]),
			el('span', { 'class': 'tf-lg-up' }, [ el('i'), _('Sent') ])
		]);
		this.statusEl = el('div', { 'class': 'tf-status' });
		/* One day by default: it is the window that answers "what has been
		 * happening", where the hour view is mostly the last few minutes. */
		/* the chart tier is derived from the range, never chosen separately */
		this.seriesRange = tierOfRange(this.range);
		this.series = null;

		this.rangePicker = makeRangePicker(
			RANGE_OPTIONS.map(function(o) { return { value: o.value, label: _(o.label) }; }),
			this.range,
			L.bind(this.setRange, this));

		var node = el('div', { 'class': 'tf-page' }, [
			el('div', { 'class': 'tf-card tf-hero' }, [
				el('div', { 'class': 'tf-hero-main' }, [
					this.totalEl,
					el('div', { 'class': 'tf-hero-cap' }, [ _('total') ])
				]),
				el('div', { 'class': 'tf-hero-rates' }, [
					el('div', { 'class': 'tf-rate tf-rate-down' }, [
						el('span', { 'class': 'tf-rate-arrow' }, [ '↓' ]), this.rateDown,
						el('span', { 'class': 'tf-rate-cap' }, [ _('Received') ])
					]),
					el('div', { 'class': 'tf-rate tf-rate-up' }, [
						el('span', { 'class': 'tf-rate-arrow' }, [ '↑' ]), this.rateUp,
						el('span', { 'class': 'tf-rate-cap' }, [ _('Sent') ])
					])
				]),
				el('div', { 'class': 'tf-hero-ctl' }, [ this.rangePicker.node ])
			]),

			el('div', { 'class': 'tf-card tf-chart-card' }, [
				el('div', { 'class': 'tf-chart-head' }, [
					el('h3', {}, [ _('Throughput') ])
				]),
				el('div', { 'class': 'tf-chart-sub' }, [
					this.chartNote,
					this.chartLegend
				]),
				this.chartEl
			]),

			el('div', { 'class': 'tf-card tf-status-card' }, [ this.statusEl ]),

			/* The composition sits above the table rather than beside it: the two
			 * were a flexible two-column row, and below the tablet breakpoint that
			 * row stacked anyway, so the breakdown pushed the table down and left
			 * a band of empty page beside the donut.  Above the table it is one
			 * readable block at every width, and the legend can spread sideways
			 * instead of being squeezed into one column. */
			el('div', { 'class': 'tf-card tf-donut-card' }, [
				el('div', { 'class': 'tf-donut-wrap' }, [ this.donutEl, this.legendEl ])
			]),

			el('div', { 'class': 'tf-card tf-list-card' }, [
				el('table', { 'class': 'table tf-table' }, [
					/* the column widths: under fixed layout these are what the
					 * browser actually uses, and no theme rule on th/td can
					 * override them */
					el('colgroup', {}, [
						el('col', { 'class': 'tf-col-app' }),
						el('col', { 'class': 'tf-col-total' }),
						el('col', { 'class': 'tf-col-down' }),
						el('col', { 'class': 'tf-col-up' }),
						el('col', { 'class': 'tf-col-top' }),
						el('col', { 'class': 'tf-col-clients' })
					]),
					el('thead', {}, [ el('tr', {}, [
						el('th', { 'class': 'tf-app' }, [ _('Application name') ]),
						el('th', { 'class': 'tf-num' }, [ _('Total traffic') ]),
						el('th', { 'class': 'tf-num' }, [ _('Received') ]),
						el('th', { 'class': 'tf-num' }, [ _('Sent') ]),
						el('th', { 'class': 'tf-top-h' }, [ _('Top client') ]),
						el('th', { 'class': 'tf-num' }, [ _('Client count') ])
					]) ]),
					this.rowsEl
				])
			]),

			el('div', { 'class': 'tf-card tf-meta-card' }, [ this.metaEl ])
		]);

		injectCss();
		/* the page works out its own dark mode; see watchTheme() */
		watchTheme(node);
		this.refresh(false);
		this.loadSeries();
		poll.add(L.bind(function() {
			this.ticks = (this.ticks || 0) + 1;
			/* the chart moves on a slower clock than the counters: a redraw
			 * every 5 s of 360 points is work nobody can see.  A tab that was
			 * hidden is refreshed at once, though, so it never shows stale
			 * numbers after being brought back. */
			if (this.seriesStale || this.ticks % 6 === 0) this.loadSeries();
			return this.refresh(false);
		}, this), 5);
		return node;
	},

	/* The picker calls this.  It is a method rather than a closure so that the
	 * two things a range change does - which window the table aggregates and
	 * which tier the curve reads - can be driven and checked as one step. */
	setRange: function(v) {
		this.range = v;
		this.setSeriesRange(tierOfRange(v));
		this.refresh(true);
	},

	setSeriesRange: function(range) {
		if (!SERIES_RANGES[range] || this.seriesRange === range) return;
		this.seriesRange = range;
		this.loadSeries();
	},

	loadSeries: function() {
		var self = this;
		/* a hidden tab has nobody looking at it: skip the RPC and the redraw
		 * until it comes back, then draw immediately (the poll below keeps
		 * running, so the first visible tick refreshes it) */
		if (document.hidden) {
			this.seriesStale = true;
			return Promise.resolve();
		}
		this.seriesStale = false;
		return callSeries(this.seriesRange).then(function(s) {
			self.series = s || null;
			self.drawSeries();
		}).catch(function() {
			self.series = null;
			self.drawSeries();
		});
	},

	drawSeries: function() {
		var s = this.series, pts = (s && s.points) || [];
		var meta = SERIES_RANGES[(s && s.range) || this.seriesRange] || SERIES_RANGES['1h'];
		var iv = Number(s && s.interval) || meta.interval;

		while (this.chartEl.firstChild) this.chartEl.removeChild(this.chartEl.firstChild);

		/* An empty chart still gets its frame: a card with nothing in it reads
		 * as broken, a flat line at the floor reads as "no traffic yet". */
		var series = pts.map(function(p) {
			return { t: Number(p[0]) || 0, down: (Number(p[1]) || 0) / iv, up: (Number(p[2]) || 0) / iv };
		});
		var now = Math.floor(Date.now() / 1000);
		if (!series.length) {
			var spans = { '1h': 3600, '12h': 43200, '24h': 86400, '7d': 604800 };
			var span = spans[(s && s.range) || this.seriesRange] || 3600;
			series = [ { t: now - span, down: 0, up: 0 }, { t: now, down: 0, up: 0 } ];
		}
		this.chartEl.appendChild(makeChart(series));

		if (!pts.length) {
			var empty = el('div', { 'class': 'tf-chart-empty' }, [ _('No samples yet') ]);
			this.chartEl.appendChild(empty);
			this.chartNote.textContent = meta.label + ' · ' + iv + 's';
			return;
		}

		var peak = 0, sumD = 0, sumU = 0;
		series.forEach(function(p) {
			if (p.down > peak) peak = p.down;
			if (p.up > peak) peak = p.up;
			sumD += p.down; sumU += p.up;
		});
		var first = series[0].t, last = series[series.length - 1].t;
		this.chartNote.textContent = _('Peak') + ' ' + fmtRate(peak) +
			' · ' + _('avg down') + ' ' + fmtRate(sumD / series.length) +
			' / ' + _('up') + ' ' + fmtRate(sumU / series.length) +
			' · ' + hhmm(first) + '–' + hhmm(last);
	},

	refresh: function() {
		var self = this;
		/* The collector state is fetched in every mode, not only in the session
		 * view: the strip describes the running collector rather than a window,
		 * so it is drawn whichever window the data cards are showing.  This is
		 * also what makes choosing a range a whole-page refresh, instead of a
		 * curve that moves while the readings around it stay as they were. */
		return callSummary().then(function(s) {
			self.summary = s || {};
			if (self.range === 'session') { self.renderLive(self.summary); return; }
			return callHourly(Number(self.range)).then(function(h) {
				/* Nothing archived yet for this range.  That is the normal state
				 * for the first hour after an install or a reflash, because the
				 * history only gets its first row when the clock crosses the
				 * hour - and waiting for it left the default view blank while the
				 * collector was measuring perfectly well.  There is data to show,
				 * so show it: the session counters are what "since start" draws.
				 * The bucket reading stays 0, which is what says the archive is
				 * still empty rather than pretending a day of history exists. */
				if (!h || !h.hours || !h.hours.length) {
					self.archiveEmpty = true;
					self.renderLive(self.summary);
					return;
				}
				self.archiveEmpty = false;
				self.renderHourly(h);
				self.drawStatus(self.summary, self.lastItems || []);
			});
		});
	},

	/* Footer, also reused: five label/value pairs whose values move every
	 * refresh but whose structure never does. */
	drawMeta: function(list) {
		var self = this;
		if (!this.metaRows) this.metaRows = [];
		list.forEach(function(m, i) {
			var r = self.metaRows[i];
			if (!r) {
				var val = el('span', { 'class': 'tf-meta-val' });
				r = {
					val: val,
					row: el('div', { 'class': 'tf-meta-item' }, [
						el('span', { 'class': 'tf-meta-cap' }, [ m.cap ]), val
					])
				};
				self.metaRows[i] = r;
				self.metaEl.appendChild(r.row);
			}
			setText(r.val, m.val);
			if (r.title !== m.title) {
				r.title = m.title;
				if (m.title) r.val.setAttribute('title', m.title);
				else r.val.removeAttribute('title');
			}
			var cls = m.warn ? 'tf-meta-val tf-warn' : 'tf-meta-val';
			if (r.cls !== cls) { r.cls = cls; r.val.className = cls; }
		});
		while (this.metaRows.length > list.length) {
			var extra = this.metaRows.pop();
			if (extra.row.parentNode) extra.row.parentNode.removeChild(extra.row);
		}
	},

	/* A single strip that explains the state of the collector.  Without it an
	 * empty page is a dead end: the reader cannot tell "no traffic yet" from
	 * "the service is not running" or "the query log path is wrong". */
	drawStatus: function(s, items) {
		var self = this;
		var now = Math.floor(Date.now() / 1000);
		var at = Number(s.collected_at) || 0;
		var age = at ? (now - at) : -1;
		var iv = Number(s.interval) || 0;

		var state, warn = false;
		if (!at) {
			state = _('Collector has not produced a snapshot yet');
			warn = true;
		}
		else if (iv && age > iv * 3 + 15) {
			state = _('Snapshot is stale') + ' (' + age + 's)';
			warn = true;
		}
		else if (!items.length) {
			state = _('Running, no traffic measured yet');
		}
		else {
			state = _('Running');
		}

		var bits = [];
		bits.push({ k: _('State'), v: state, warn: warn });
		if (iv) bits.push({ k: _('Interval'), v: iv + 's' });
		bits.push({ k: _('Flows'), v: String(Number(s.flows) || 0) });
		bits.push({ k: _('Host names'), v: String(Number(s.dnsmap_lines) || 0) });
		if (Number(s.pending) > 0) bits.push({ k: _('Waiting to resolve'), v: String(Number(s.pending)), warn: true });
		/* which layer is producing the client totals: the nft counters see every
		   packet, the conntrack fallback only what the connection table knows.
		   A fallback is not an error, but it must not look like one and the
		   same page, or a silent degradation reads as "the network got quiet". */
		bits.push({ k: _('Client totals'), v: s.acct ? _('nft counters') : _('conntrack'),
			warn: !s.acct && !!s.acct_error });
		if (!s.acct && s.acct_error) bits.push({ k: _('Counter error'), v: s.acct_error, warn: true });
		/* which collector build is running: the first thing to check when a fix
		   does not seem to be in effect after installing the package */
		if (s.version) bits.push({ k: _('Collector version'), v: s.version, mono: true });
		/* what the collector treats as the box itself: the first thing to check
		   when a client list looks like it has the router in it.  The full list
		   is not something anyone reads in a strip, so it is shortened and the
		   exact value left a hover away. */
		if (s.self) bits.push({ k: _('Router addresses'), v: shortAddrs(s.self), title: s.self, mono: true });
		if (s.hour) bits.push({ k: _('Bucket'), v: s.hour });

		if (!this.statusEl) return;
		if (!this.statusRows) this.statusRows = [];
		bits.forEach(function(b, i) {
			var r = self.statusRows[i];
			if (!r) {
				var v = el('span', { 'class': 'tf-stat-val' });
				r = { v: v, k: null, row: el('div', { 'class': 'tf-stat' }, [
					el('span', { 'class': 'tf-stat-cap' }), v
				]) };
				r.k = r.row.firstChild;
				self.statusRows[i] = r;
				self.statusEl.appendChild(r.row);
			}
			setText(r.k, b.k);
			setText(r.v, b.v);
			/* the shortened value keeps its exact form in the tooltip, so nothing
			 * is lost by showing it short */
			var tip = b.title || '';
			if (r.tip !== tip) { r.tip = tip; r.row.setAttribute('title', tip); }
			var cls = 'tf-stat-val' + (b.warn ? ' tf-warn' : '') + (b.mono ? ' tf-mono' : '');
			if (r.cls !== cls) { r.cls = cls; r.v.className = cls; }
		});
		while (this.statusRows.length > bits.length) {
			var extra = this.statusRows.pop();
			if (extra.row.parentNode) extra.row.parentNode.removeChild(extra.row);
		}
	},

	renderLive: function(s) {
		var t = s.totals || {};
		var down = Number(t.down) || 0, up = Number(t.up) || 0;

		var items = (s.apps || []).map(function(a) {
			var d = Number(a.down) || 0, u = Number(a.up) || 0;
			return {
				name: a.name, down: d, up: u, bytes: d + u,
				clients: (a.clients === undefined) ? undefined : Number(a.clients),
				top: a.top || '',
				top_bytes: Number(a.top_bytes) || 0
			};
		}).filter(hasTraffic);

		this.lastItems = items;

		/* The status strip is drawn before the early return below, on purpose.
		 * Its whole job is to say when the snapshot stopped arriving, and the
		 * signature does not change while the collector is stuck - so skipping
		 * it would mean the page never gets to say "stale", and a dead collector
		 * would look exactly like a quiet network. */
		this.drawStatus(s, items);

		/* The collector writes a snapshot every interval while the page polls
		 * twice as often, so half the refreshes have nothing new in them: skip
		 * the table and the chart without touching the DOM. */
		var sig = [ Number(s.collected_at) || 0, down, up, items.length ].join('|');
		if (sig === this.lastSig) return;
		this.lastSig = sig;

		/* rates come from the difference between two snapshots */
		if (this.prev) {
			var dt = (Number(s.collected_at) || 0) - (Number(this.prev.collected_at) || 0);
			var pd = Number(this.prev.totals.down) || 0, pu = Number(this.prev.totals.up) || 0;
			if (dt > 0 && down >= pd && up >= pu)
				this.rate = { down: (down - pd) / dt, up: (up - pu) / dt };
		}
		this.prev = s;

		/* these two are the live sampling deltas again, not the range averages
		 * the ranged view leaves behind, so the tooltip goes with them */
		if (this.rateAvg !== false) {
			this.rateAvg = false;
			this.rateDown.removeAttribute('title');
			this.rateUp.removeAttribute('title');
		}
		dom.content(this.rateDown, fmtRate(this.rate.down));
		dom.content(this.rateUp, fmtRate(this.rate.up));

		/* the grand-total row carries the busiest client overall; down+up is the
		 * same client-side total the footer breaks down by kind */
		var clientTotal = down + up;
		var topClient = (s.clients && s.clients.length) ? s.clients[0] : null;
		var topText = '—';
		if (topClient && clientTotal > 0) {
			topText = (topClient.name || topClient.ip) + ' ' + fmtBytes(topClient.bytes) +
				' (' + (100 * Number(topClient.bytes) / clientTotal).toFixed(1) + '%)';
		}

		this.draw(items, {
			total: clientTotal, down: down, up: up,
			topText: topText,
			clientCount: (t.client_count === undefined) ? undefined : Number(t.client_count)
		});

		/* The three kinds partition the client traffic, so the shares add up to
		 * 100%.  exact/any only says which client's DNS answer did the naming. */
		var namedE = Number(t.exact) || 0, namedA = Number(t.any) || 0;
		var bucket = Number(t.bucket) || 0, residual = Number(t.residual) || 0;
		var named = namedE + namedA;
		var all = named + bucket + residual;
		var pct = function(v) { return all ? (100 * v / all).toFixed(1) + '%' : '—'; };

		/* When the per-host nft counters are running they are the honest total:
		 * they count every packet the clients sent or received, including the
		 * proxied traffic that never shows up in a DNS answer and the traffic
		 * the conntrack accounting can miss.  The application breakdown is then
		 * a share *of that total*, and the gap between the two is what the page
		 * should be honest about rather than hide. */
		var acct = s.accounted || null;
		var acctAll = acct ? (Number(acct.down) || 0) + (Number(acct.up) || 0) : 0;
		var rows = [
			{ cap: _('Router and tunnel'), val: fmtBytes(t.router) },
			{ cap: _('Browser clients'), val: fmtBytes(all) },
			{ cap: _('Domain identified'), val: pct(named),
			  title: _('by client DNS') + ': ' + pct(namedE) + ', ' + _('by any client DNS') + ': ' + pct(namedA) },
			{ cap: _('Categorised'), val: pct(bucket) },
			{ cap: _('Other'), val: pct(residual), warn: true }
		];
		if (acctAll > 0) {
			rows.push({ cap: _('Counter total'), val: fmtBytes(acctAll),
				title: _('every packet counted at the LAN interface, proxied traffic included') });
			rows.push({ cap: _('Accounted share'), val: (100 * all / acctAll).toFixed(1) + '%',
				warn: all / acctAll < 0.5 });
		}
		/* When a range view had no archive to read and fell back to this session,
		 * say so.  The bucket count is the reading that means "hours archived",
		 * and 0 is the honest answer - without it the footer would show session
		 * identification rates under a "last 24 hours" label and nothing would
		 * tell the reader that the day is not actually there yet. */
		if (this.archiveEmpty) rows.unshift({ cap: _('Bucket'), val: '0' });
		this.drawMeta(rows);

		/* New host names wait for the resolver's next pass, which is throttled
		 * so that browsing cannot make every poll pay for a fresh name.  When
		 * someone is actually looking at the page, ask for that pass now - it
		 * costs nothing while nobody is. */
		var pending = Number(s.pending) || 0;
		if (pending > 0 && !this.resolvePending) {
			this.resolvePending = true;
			callResolveNow().then(function() {}, function() {}).then(L.bind(function() {
				this.resolvePending = false;
			}, this));
		}
	},

	renderHourly: function(h) {
		var hours = (h && h.hours) || [];
		var agg = {}, clAgg = {};
		hours.forEach(function(b) {
			(b.apps || []).forEach(function(a) {
				var k = a.name;
				if (!agg[k]) agg[k] = { name: k, down: 0, up: 0 };
				agg[k].down += Number(a.down) || 0;
				agg[k].up += Number(a.up) || 0;
			});
			(b.clients || []).forEach(function(c) {
				var ip = c.ip || '?';
				clAgg[ip] = (clAgg[ip] || 0) + (Number(c.bytes) || 0);
			});
		});
		var items = Object.keys(agg).map(function(k) {
			agg[k].bytes = agg[k].down + agg[k].up;
			return agg[k];
		}).filter(hasTraffic)
		  .sort(function(a, b) { return b.bytes - a.bytes; });
		/* the status strip is drawn by refresh() from these, in either mode */
		this.lastItems = items;

		var total = items.reduce(function(s, a) { return s + a.bytes; }, 0);
		var gd = items.reduce(function(s, a) { return s + a.down; }, 0);
		var gu = items.reduce(function(s, a) { return s + a.up; }, 0);

		/* The clients are summed across the hours the same way the applications
		 * are, so the two grand-total columns mean here what they mean in the
		 * session view: the busiest device of the range and how many devices
		 * moved anything in it.  The per-application columns stay empty on
		 * purpose - "which client drove this application" is not a question an
		 * hour's totals can answer, and a guess would be worse than the dash. */
		var cl = Object.keys(clAgg).map(function(ip) {
			return { ip: ip, bytes: clAgg[ip] };
		}).sort(function(a, b) { return b.bytes - a.bytes; });
		var topText = '—';
		if (cl.length && total > 0) {
			topText = cl[0].ip + ' ' + fmtBytes(cl[0].bytes) +
				' (' + (100 * cl[0].bytes / total).toFixed(1) + '%)';
		}
		this.draw(items, {
			total: total, down: gd, up: gu,
			topText: topText, clientCount: cl.length
		});
		/* A rate needs a window to divide by, and in this view the window is the
		 * range itself: these are the averages over it, not the last sampling
		 * interval.  They were left as a dash before, which next to a card full
		 * of bytes reads as "nothing is happening" rather than "this figure is
		 * not measured that way here", so the tooltip says which one it is. */
		var win = Math.max(1, hours.length) * 3600;
		dom.content(this.rateDown, fmtRate(gd / win));
		dom.content(this.rateUp, fmtRate(gu / win));
		if (this.rateAvg !== true) {
			this.rateAvg = true;
			var tip = _('average over the selected range');
			this.rateDown.setAttribute('title', tip);
			this.rateUp.setAttribute('title', tip);
		}
		/* The footer says what the range held, from what the history actually
		 * keeps: the number of buckets, the client bytes, the tunnel and how many
		 * devices moved them.  The identification rates below are not here
		 * because the history does not store them - those counters live in the
		 * session, and inventing a range figure out of a session one is exactly
		 * the kind of number this page should not show. */
		var rt = 0;
		hours.forEach(function(b) { rt += Number(b.router) || 0; });
		this.drawMeta([
			{ cap: _('Bucket'), val: String(hours.length) },
			{ cap: _('Browser clients'), val: fmtBytes(total) },
			{ cap: _('Router and tunnel'), val: fmtBytes(rt) },
			{ cap: _('Client count'), val: String(cl.length) }
		]);
	},

	draw: function(items, stats) {
		/* one palette assignment for everything drawn this round, so the donut,
		 * the legend and the table cannot disagree about a colour */
		colorMap = assignColors(items.slice(0, 30));
		var top = items.slice(0, 10);
		var total = stats.total;
		var self = this;

		/* Everything below updates what is already on the page rather than
		 * replacing it.  Only structure that genuinely changed (a new
		 * application, a different order) touches the DOM tree. */
		if (!this.rowCache) { this.rowCache = {}; this.rowNames = []; this.legendCache = {}; }

		setText(this.totalEl, fmtBytes(total));

		/* donut: redrawn only when its composition changed, not when the bytes
		 * behind the slices moved */
		var donutSig = top.map(function(a) {
			return a.name + ':' + (total ? Math.round(1000 * a.bytes / total) : 0);
		}).join('|');
		if (donutSig !== this.donutSig) {
			this.donutSig = donutSig;
			dom.content(this.donutEl, makeDonut(top, total));
		}

		/* legend, keyed by name so the rows survive a reshuffle */
		var legendSeen = {};
		top.forEach(function(a) {
			legendSeen[a.name] = 1;
			var lr = self.legendCache[a.name];
			if (!lr) {
				lr = makeLegendRow(a.name);
				self.legendCache[a.name] = lr;
			}
			setText(lr.pct, (total ? (100 * a.bytes / total) : 0).toFixed(1) + '%');
		});
		Object.keys(this.legendCache).forEach(function(n) {
			if (legendSeen[n]) return;
			var lr = self.legendCache[n];
			if (lr.row.parentNode) lr.row.parentNode.removeChild(lr.row);
			delete self.legendCache[n];
		});
		/* Re-append in the order of the list, not in the order the rows were
		 * first created.  Only appending new rows (which is what this did) left
		 * the legend in first-seen order, so a slice that had grown to 11% could
		 * still sit below one at 2% - the table reordered, the legend did not,
		 * and the two disagreed about the same list.  Appending an attached node
		 * moves it, which is all that is needed. */
		top.forEach(function(a) {
			var lr = self.legendCache[a.name];
			if (lr) self.legendEl.appendChild(lr.row);
		});

		/* grand total row, built once */
		if (!this.grandRow) {
			var gc = {
				total: el('td', { 'class': 'tf-num tf-total' }),
				down:  el('td', { 'class': 'tf-num tf-down' }),
				up:    el('td', { 'class': 'tf-num tf-up' }),
				top:   el('td', { 'class': 'tf-top' }),
				clients: el('td', { 'class': 'tf-num' })
			};
			this.grandRow = {
				tr: el('tr', { 'class': 'tf-grand' }, [
					el('td', { 'class': 'tf-app' }, [ el('span', { 'class': 'tf-app-name' }, [ _('All traffic') ]) ]),
					gc.total, gc.down, gc.up, gc.top, gc.clients
				]),
				cells: gc
			};
			this.rowsEl.appendChild(this.grandRow.tr);
		}
		setText(this.grandRow.cells.total, fmtBytes(total));
		setText(this.grandRow.cells.down, fmtBytes(stats.down));
		setText(this.grandRow.cells.up, fmtBytes(stats.up));
		setText(this.grandRow.cells.top, stats.topText || '—');
		setText(this.grandRow.cells.clients, stats.clientCount === undefined ? '—' : String(stats.clientCount));

		/* the 100 heaviest applications, each row created once and then only
		 * nudged: this is what keeps a page open for hours flat in memory */
		var wanted = items.slice(0, 100);
		var seen = {}, order = [];
		wanted.forEach(function(a) {
			seen[a.name] = 1;
			order.push(a.name);
			var row = self.rowCache[a.name];
			if (!row) {
				row = makeRow(a.name, isBucket(a.name));
				self.rowCache[a.name] = row;
				self.rowsEl.appendChild(row.tr);
			}
			updateRow(row, a, total);
		});
		Object.keys(this.rowCache).forEach(function(n) {
			if (seen[n]) return;
			var row = self.rowCache[n];
			if (row.tr.parentNode) row.tr.parentNode.removeChild(row.tr);
			delete self.rowCache[n];
		});

		/* reordering is 100 node moves, so it waits until the order really
		 * changed - which, sorted by bytes, is far less often than the bytes */
		var orderSig = order.join('\u0001');
		if (orderSig !== this.orderSig) {
			this.orderSig = orderSig;
			order.forEach(function(n) { self.rowsEl.appendChild(self.rowCache[n].tr); });
		}

		if (!items.length && !this.emptyRow) {
			this.emptyRow = el('tr', {}, [ el('td', { 'colspan': 6, 'class': 'tf-empty' }, [ _('No traffic recorded yet.') ]) ]);
			this.rowsEl.appendChild(this.emptyRow);
		}
		else if (items.length && this.emptyRow) {
			if (this.emptyRow.parentNode) this.emptyRow.parentNode.removeChild(this.emptyRow);
			this.emptyRow = null;
		}
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});

/* Chevron for the pill select, as an inline SVG so no extra request is needed.
 * Quotes are percent-encoded, which keeps the whole thing free of characters
 * that would have to be escaped inside the CSS and JS strings. */
function CHEVRON(color) {
	return 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27' +
		' viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27' + encodeURIComponent(color) + '%27' +
		' stroke-width=%272.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E' +
		'%3Cpolyline points=%276 9 12 15 18 9%27/%3E%3C/svg%3E';
}

/* Kept at the bottom so the view body reads as layout rather than styling.
 *
 * Argon adaptation: the accent colour and the card surface are taken from the
 * theme's own custom properties when it defines them (--primary, --card-color,
 * --font-color and friends), with bright fallbacks so the page also looks right
 * on the default theme.  Nothing here depends on Argon-only class names, and
 * dark mode is honoured through the class Argon sets on <body>. */
	/* Dark mode is decided by looking at the page rather than by guessing which
	 * marker the theme used.  The three selectors above cover the mechanisms seen
	 * so far, and a theme that switches some other way - or only follows the
	 * system preference - left the cards bright on a dark background, which is
	 * exactly how it looked on the router.  Reading the computed background of
	 * the document works for any of them, and the class it sets is one the
	 * stylesheet already knows: .tf-page.tf-dark. */
	function watchTheme(node) {
		if (typeof getComputedStyle !== 'function') return;
		function luminance(el) {
			if (!el) return null;
			var c = getComputedStyle(el).backgroundColor;
			var m = c && c.match(/^rgba?\(([^)]+)\)$/);
			if (!m) return null;
			var p = m[1].split(',').map(function(x) { return parseFloat(x); });
			if (p.length > 3 && p[3] === 0) return null;          /* transparent */
			return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
		}
		function textLuminance(el) {
			if (!el) return null;
			var c = getComputedStyle(el).color;
			var m = c && c.match(/^rgba?\(([^)]+)\)$/);
			if (!m) return null;
			var p = m[1].split(',').map(function(x) { return parseFloat(x); });
			if (p.length > 3 && p[3] === 0) return null;
			return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
		}
		function apply() {
			/* The background is the direct answer, but it is not always readable:
			 * a theme that paints with a gradient or an image has no opaque
			 * background colour at all, and that is exactly the case that left a
			 * bright table on a dark page - the measurement came back empty and
			 * this fell through to the markers, which is what had already failed.
			 * The text colour is the signal that survives it: a dark theme writes
			 * light text, a light theme writes dark text, whatever it does with
			 * its background.  Either measurement saying "dark" is taken. */
			var bg = luminance(document.body);
			if (bg === null) bg = luminance(document.documentElement);
			var fg = textLuminance(document.body);
			if (fg === null) fg = textLuminance(document.documentElement);
			var dark;
			if (bg === null && fg === null) {
				var b = document.body, r = document.documentElement;
				dark = !!(b && b.classList && b.classList.contains('dark')) ||
					!!(r && r.getAttribute && (r.getAttribute('data-darkmode') === 'true' ||
						r.getAttribute('data-theme') === 'dark'));
			}
			else {
				dark = (bg !== null && bg < 128) || (fg !== null && fg > 140);
			}
			var cls = dark ? 'add' : 'remove';
			if (node.classList && node.classList[cls]) node.classList[cls]('tf-dark');
		}
		apply();
		/* the theme can be switched while the page is open */
		try {
			var obs = new MutationObserver(apply);
			var opts = { attributes: true, attributeFilter: [ 'class', 'data-darkmode', 'data-theme' ] };
			obs.observe(document.documentElement, opts);
			if (document.body) obs.observe(document.body, opts);
		} catch (e) { /* no MutationObserver: the first answer stands */ }
		try {
			if (window.matchMedia) {
				var mq = window.matchMedia('(prefers-color-scheme: dark)');
				if (mq.addEventListener) mq.addEventListener('change', apply);
				else if (mq.addListener) mq.addListener(apply);
			}
		} catch (e2) { /* same */ }
	}

function injectCss() {
	if (document.getElementById('tf-css')) return;

	var DARK = '.dark .tf-page, [data-darkmode="true"] .tf-page, [data-theme="dark"] .tf-page, .tf-page.tf-dark';
	/* A comma-separated selector list cannot be extended by appending a
	 * descendant: only the last one would get it.  Anything that needs to be
	 * scoped to dark mode expands the list one selector at a time. */
	var DARK_ONE = [ '.dark .tf-page', '[data-darkmode="true"] .tf-page', '[data-theme="dark"] .tf-page', '.tf-page.tf-dark' ];
	var darkOf = function(sel) {
		return DARK_ONE.map(function(d) { return d + ' ' + sel; }).join(',');
	};
	var css = [
		'.tf-page{--tf-accent:var(--primary,#00b4ff);--tf-accent2:#7c5cff;',
		'--tf-card:rgba(255,255,255,.72);--tf-card-brd:rgba(255,255,255,.75);',
		'--tf-chip:rgba(140,160,180,.16);--tf-menu:rgba(255,255,255,.99);',
		'--tf-fg:var(--font-color,#20303d);--tf-dim:rgba(32,48,61,.55);',
		'--tf-shadow:0 6px 22px rgba(31,66,102,.10);',
		'--tf-down:#00a8e8;--tf-up:#26c281;',
		'margin:-.4rem 0 0;color:var(--tf-fg);',
		/* The page is a wrapping flex column of full-width cards, with the
		 * composition and the curve sharing one row.  It was a grid placed by
		 * named areas, which read well but did not survive contact with a real
		 * browser here: the area template was ignored and the columns fell back
		 * to auto, so every card shrank to its own content and the page came out
		 * as a ragged left-aligned stack.  order does the same job with nothing
		 * to ignore, and the two halves are sized from the same calc() so they
		 * stay equal.
		 *
		 * No gap anywhere: flex gap needs Safari 14.1, and a browser without it
		 * silently drops the spacing - the cards would touch.  The gutter is a
		 * margin on the left half instead, which every browser has understood
		 * for a very long time. */
		'display:flex;flex-wrap:wrap;align-items:flex-start;}',
		'.tf-page .tf-hero,.tf-page .tf-status-card,',
		'.tf-page .tf-meta-card,.tf-page .tf-list-card{order:1;flex:0 0 100%;max-width:100%;}',
		'.tf-page .tf-status-card{order:2;}',
		'.tf-page .tf-chart-card{order:3;flex:0 0 calc(50% - .5rem);max-width:calc(50% - .5rem);',
		'margin-right:1rem;}',
		'.tf-page .tf-donut-card{order:4;flex:0 0 calc(50% - .5rem);max-width:calc(50% - .5rem);}',
		'.tf-page .tf-meta-card{order:5;}',
		'.tf-page .tf-list-card{order:6;}',

		/* cards: translucent + blurred, which is what gives the "bright" look */
		'.tf-page .tf-card{background:var(--tf-card);border:1px solid var(--tf-card-brd);',
		'border-radius:16px;box-shadow:var(--tf-shadow);backdrop-filter:blur(14px) saturate(150%);',
		'-webkit-backdrop-filter:blur(14px) saturate(150%);padding:1rem 1.15rem;margin-bottom:1rem;}',

		/* hero.  The big number has its own class: "tf-total" is also the class
		 * of the table's total cell, and sharing it made every row's total
		 * render at 2rem. */
		/* z-index is not decoration: the card blurs its backdrop, and an element
		 * with backdrop-filter starts a stacking context, so the range menu's own
		 * z-index only ever counted inside this card - the cards below painted
		 * over the open list and cut it off.  Lifting the card itself puts the
		 * menu above them, which is where a dropdown belongs. */
		'.tf-page .tf-hero{display:flex;align-items:center;gap:1.4rem;flex-wrap:wrap;',
		'position:relative;z-index:5;',
		'background:linear-gradient(135deg,rgba(0,180,255,.14),rgba(124,92,255,.14)),var(--tf-card);}',
		'.tf-page .tf-grand-total{font-size:1.7rem;font-weight:700;line-height:1.1;letter-spacing:.4px;',
		'font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-hero-cap{font-size:.74rem;color:var(--tf-dim);text-transform:uppercase;letter-spacing:.08em;}',
		'.tf-page .tf-hero-rates{display:flex;gap:1.6rem;}',
		'.tf-page .tf-rate{display:flex;align-items:baseline;gap:.35rem;font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-rate b{font-size:1.05rem;font-weight:600;}',
		'.tf-page .tf-rate-arrow{font-size:1rem;}',
		'.tf-page .tf-rate-down .tf-rate-arrow,.tf-page .tf-rate-down b{color:var(--tf-down);}',
		'.tf-page .tf-rate-up .tf-rate-arrow,.tf-page .tf-rate-up b{color:var(--tf-up);}',
		'.tf-page .tf-rate-cap{font-size:.75rem;color:var(--tf-dim);}',
		'.tf-page .tf-hero-ctl{margin-left:auto;display:flex;gap:.6rem;align-items:center;}',

		/* throughput chart.  Title and range on one line, the reading and the
		 * colour key on the next: the title used to sit alone with the controls
		 * on the row below, which left the top of the card looking empty. */
		'.tf-page .tf-chart-head{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;margin-bottom:.3rem;}',
		'.tf-page .tf-chart-head h3{margin:0;font-size:.95rem;font-weight:600;}',
		'.tf-page .tf-chart-sub{display:flex;align-items:center;gap:.6rem 1rem;flex-wrap:wrap;margin-bottom:.45rem;}',
		'.tf-page .tf-chart-note{font-size:.76rem;color:var(--tf-dim);font-variant-numeric:tabular-nums;}',
		/* the colour key: the two curves are the same shape at different
		 * magnitudes, so without a key a small upload reads as a stray line */
		'.tf-page .tf-chart-legend{display:flex;gap:.9rem;margin-left:auto;font-size:.76rem;color:var(--tf-dim);}',
		'.tf-page .tf-chart-legend span{display:inline-flex;align-items:center;gap:.34rem;}',
		'.tf-page .tf-chart-legend i{width:.62rem;height:.62rem;border-radius:2px;display:inline-block;}',
		'.tf-page .tf-chart-legend .tf-lg-down i{background:#00a8e8;}',
		'.tf-page .tf-chart-legend .tf-lg-up i{background:#26c281;}',
		'.tf-page .tf-chart-svg{display:block;width:100%;height:auto;max-height:190px;}',
		'.tf-page .tf-chart-tick{font-size:9px;fill:var(--tf-dim);}',
		'.tf-page .tf-chart{position:relative;}',
		'.tf-page .tf-chart-empty{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);',
		'text-align:center;color:var(--tf-dim);font-size:.85rem;pointer-events:none;}',

		/* collector state strip: makes an empty page self-explanatory.  Each
		 * reading is its own soft grey chip: as a bare caption over a value in a
		 * long wrapping row the eye has to work out which label belongs to which
		 * number, and the chips settle that grouping at a glance. */
		'.tf-page .tf-status-card{display:flex;gap:1.6rem;flex-wrap:wrap;padding:.85rem 1.15rem;}',
		'.tf-page .tf-status{display:flex;gap:.55rem;flex-wrap:wrap;align-items:stretch;}',
		'.tf-page .tf-stat{display:flex;flex-direction:column;gap:.05rem;min-width:0;max-width:100%;',
		'padding:.38rem .72rem;background:var(--tf-chip);border-radius:12px;}',
		/* No text-transform: the labels are mostly Chinese, which it cannot touch
		 * anyway, so forcing upper case only made the few English ones (the
		 * collector version among them) look like a different kind of label. */
		'.tf-page .tf-stat-cap{font-size:.7rem;color:var(--tf-dim);letter-spacing:.04em;}',
		'.tf-page .tf-stat-val{font-size:.86rem;font-weight:600;font-variant-numeric:tabular-nums;',
		'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}',
		/* Long values (a query log path, the box own addresses) are normal text,
		 * not code: monospace here made two entries of one row look like they
		 * came from a different font, and read worse at this size. */
		'.tf-page .tf-mono{font-family:inherit;font-weight:600;font-size:.86rem;}',

		/* layout: the donut card is a full-width block above the table, so these
		 * are ordinary cards rather than the two flexible columns they used to be */
		'.tf-page .tf-list-card{min-width:0;padding-bottom:.4rem;overflow-x:auto;}',
		'.tf-page .tf-donut-wrap{display:flex;align-items:center;gap:1.1rem 1.6rem;flex-wrap:wrap;}',
		'.tf-page .tf-donut-svg{flex:0 0 168px;width:168px;height:168px;}',
		'.tf-page .tf-donut-empty{font-size:11px;fill:var(--tf-dim);}',

		/* legend: the ten rows spread across the width the card now has, instead
		 * of one narrow column with the rest of the card empty beside it */
		'.tf-page .tf-legend{flex:1 1 22rem;display:grid;min-width:0;',
		'grid-template-columns:repeat(auto-fill,minmax(13rem,1fr));gap:.3rem 1.1rem;}',
		'.tf-page .tf-legend-row{display:flex;align-items:center;gap:.45rem;font-size:.82rem;min-width:0;}',
		'.tf-page .tf-legend-dot{width:9px;height:9px;border-radius:50%;flex:0 0 9px;}',
		'.tf-page .tf-legend-name{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}',
		'.tf-page .tf-legend-pct{color:var(--tf-dim);font-variant-numeric:tabular-nums;}',

		/* table
		 *
		 * The widths live in a <colgroup> in the markup, not in rules on the
		 * cells.  Fixed layout takes its column widths from the first row, and
		 * the theme styles these cells too, so a percentage on a cell could be
		 * overridden and the name column collapsed to the width of its own
		 * ellipsis while the byte columns took the rest of the card.  A col is
		 * not something a theme rule on th/td can reach.
		 *
		 * The row backgrounds are set explicitly as well.  The theme stripes
		 * every second row of a .table, and the stripes came through behind the
		 * row that is tinted and the row under the pointer, which is what made
		 * the list look like it had bands in the wrong places. */
		'.tf-page .tf-table{margin:0;background:transparent;table-layout:fixed;',
		'width:100%;min-width:40rem;border-collapse:collapse;}',
		/* the name gets the room the numbers do not need: "528 KiB (32.4%)" is
		 * the widest figure in the table and it is nowhere near a third of it */
		'.tf-page .tf-col-app{width:30%;}',
		'.tf-page .tf-col-total{width:16%;}',
		'.tf-page .tf-col-down{width:13%;}',
		'.tf-page .tf-col-up{width:13%;}',
		'.tf-page .tf-col-top{width:20%;}',
		'.tf-page .tf-col-clients{width:8%;}',
		'.tf-page .tf-table>thead>tr>th{border-bottom:1px solid rgba(128,150,175,.18);',
		'font-size:.78rem;font-weight:600;color:var(--tf-dim);letter-spacing:.04em;padding:.5rem .6rem;',
		'white-space:nowrap;background:transparent;}',
		/* Alignment is per kind of column, and the header follows its own data:
		 * the theme centres every .table cell, which is what left the caption
		 * "总量" sitting in the middle of its column while the figure under it
		 * hugged the right edge - the two never lined up.  Numbers are centred
		 * (matching what the captions already did), the two text columns are
		 * left-aligned with their captions, so each column reads as one thing. */
		'.tf-page .tf-table>thead>tr>th.tf-app,.tf-page .tf-table>tbody>tr>td.tf-app,',
		'.tf-page .tf-table>thead>tr>th.tf-top-h,.tf-page .tf-table>tbody>tr>td.tf-top{text-align:left;}',
		'.tf-page .tf-table>thead>tr>th.tf-num,.tf-page .tf-table>tbody>tr>td.tf-num{text-align:center;}',
		/* the theme colours .table cells itself.  Left alone, a dark page got a
		 * light table with dark text - a bright slab in the middle of the page -
		 * and once the card is dark the same override would have given dark text
		 * on a dark card.  The page's own colour wins here. */
		'.tf-page .tf-table>thead>tr>th,.tf-page .tf-table>tbody>tr>td{color:inherit;}',
		'.tf-page .tf-table>tbody>tr{background:transparent;}',
		'.tf-page .tf-table>tbody>tr>td{border-bottom:1px solid rgba(128,150,175,.10);',
		'padding:.5rem .6rem;vertical-align:middle;overflow:hidden;background:transparent;}',
		'.tf-page .tf-table>tbody>tr:last-child>td{border-bottom:none;}',
		'.tf-page .tf-table>tbody>tr:hover>td{background:rgba(0,180,255,.07);}',
		'.tf-page .tf-num{white-space:nowrap;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;}',
		'.tf-page .tf-down{color:var(--tf-down);}',
		'.tf-page .tf-up{color:var(--tf-up);}',
		'.tf-page .tf-total{font-weight:600;}',
		/* the grand total leads the table, so it is tinted rather than roped off */
		'.tf-page .tf-table>tbody>tr.tf-grand>td{background:rgba(0,180,255,.08);font-weight:600;',
		'border-bottom:1px solid rgba(128,150,175,.22)!important;}',
		'.tf-page .tf-top{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
		'color:var(--tf-dim);font-size:.85rem;}',

		/* app cell + icon: one 26px box for both the avatar and a real SVG */
		'.tf-page .tf-app{display:flex;align-items:center;gap:.55rem;min-width:0;}',
		/* the name takes whatever the icon and the tag leave behind.  A fixed max
		 * width truncated it while the byte columns sat half empty, which is
		 * what "NetEase…" next to a wide 总量 column was. */
		'.tf-page .tf-app-name{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
		/* a bucket is a kind of traffic, not a product: muted name plus a tag,
		 * so it never reads as if it were an application */
		'.tf-page .tf-isbucket .tf-app-name{color:var(--tf-dim);font-style:italic;}',
		'.tf-page .tf-isbucket .tf-total{font-weight:400;color:var(--tf-dim);}',
		/* nowrap on both axes: the tag is two characters wide, and letting it
		 * wrap is what stacked it as 类 over 型 in a narrow row */
		'.tf-page .tf-tag{flex:0 0 auto;white-space:nowrap;margin-left:.15rem;padding:.05rem .34rem;',
		'border-radius:6px;font-size:.62rem;line-height:1.5;',
		'letter-spacing:.04em;color:var(--tf-dim);background:rgba(128,150,175,.16);text-transform:uppercase;}',
		'.tf-page .tf-icon{width:' + ICON + 'px;height:' + ICON + 'px;flex:0 0 ' + ICON + 'px;',
		'border-radius:8px;display:inline-flex;align-items:center;justify-content:center;',
		'box-shadow:0 2px 6px rgba(31,66,102,.18);}',
		'.tf-page .tf-icon-letter{color:#fff;font-size:.82rem;font-weight:700;line-height:1;}',
		'.tf-page .tf-icon-img{width:' + ICON + 'px;height:' + ICON + 'px;border-radius:8px;display:block;}',

		/* footer stats + misc.  .tf-meta is the flex row - styling the card
		 * instead left the five items stacked in a column and the card grew to
		 * the height of the page. */
		'.tf-page .tf-meta-card{padding:.85rem 1.15rem;}',
		'.tf-page .tf-meta{display:flex;gap:.55rem;flex-wrap:wrap;align-items:stretch;}',
		'.tf-page .tf-meta-item{display:flex;flex-direction:column;gap:.1rem;min-width:0;',
		'padding:.38rem .72rem;background:var(--tf-chip);border-radius:12px;}',
		'.tf-page .tf-meta-cap{font-size:.72rem;color:var(--tf-dim);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;}',
		'.tf-page .tf-meta-val{font-size:.95rem;font-weight:600;font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-warn{color:#ff8f1f;}',
		'.tf-page .tf-empty{text-align:center;color:var(--tf-dim);padding:1.2rem 0;}',
		/* controls: every chip and field is a pill, so the toolbar reads as one
		 * row of soft shapes rather than as mismatched theme widgets.
		 *
		 * Every selector below names a class of this page own (tf-*); none of
		 * them rewrites a LuCI core class, so nothing here can leak into the
		 * core view action buttons on other pages.  The toolbar buttons carry
		 * no core button class either - they are described in full below,
		 * light and dark - so their look is this app business alone.
		 *
		 * border-radius carries !important only because themes style bare
		 * button elements too; the selectors match nothing but these controls. */
		/* The range picker, drawn here rather than by the browser: a native
		 * select can be styled only while closed, so its list kept square corners
		 * and the system highlight on a page where everything else is rounded.
		 * The button reuses .tf-range, so the pill, the chevron and the focus
		 * ring are the same ones the rest of the page uses. */
		'.tf-page .tf-range{display:inline-flex;align-items:center;font-family:inherit;',
		'text-align:left;',
		'-webkit-appearance:none;appearance:none;min-width:9.5rem;',
		'height:2.05rem;padding:0 2.05rem 0 .9rem;font-size:.82rem;line-height:2.05rem;',
		'color:var(--tf-fg);background-color:var(--tf-chip);',
		'background-image:url("' + CHEVRON('#6b7c8c') + '");',
		'background-repeat:no-repeat;background-position:right .72rem center;background-size:.95rem;',
		'border:1px solid rgba(128,150,175,.22);border-radius:999px!important;box-shadow:none;cursor:pointer;',
		'transition:background-color .15s,border-color .15s,box-shadow .15s;}',
		'.tf-page .tf-dd{position:relative;display:inline-flex;}',
		'.tf-page .tf-dd-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
		'.tf-page .tf-dd-menu{display:none;position:absolute;right:0;top:calc(100% + .35rem);z-index:30;',
		'min-width:100%;padding:.3rem;',
		'background:var(--tf-menu);border:1px solid rgba(128,150,175,.24);border-radius:14px;',
		'box-shadow:var(--tf-shadow);}',
		'.tf-page .tf-dd-open .tf-dd-menu{display:block;}',
		'.tf-page .tf-dd-item{display:block;width:100%;margin:0;text-align:left;',
		'border:1px solid transparent;border-radius:10px;background:transparent;box-shadow:none;',
		'color:var(--tf-fg);font-family:inherit;font-size:.82rem;line-height:1.95;',
		'padding:0 .7rem;cursor:pointer;white-space:nowrap;}',
		'.tf-page .tf-dd-item:hover{background:rgba(140,160,180,.18);}',
		'.tf-page .tf-dd-on{background:rgba(0,168,232,.14);color:var(--tf-accent);font-weight:600;}',
		'.tf-page .tf-range:hover{background-color:rgba(140,160,180,.22);}',
		'.tf-page .tf-range:focus{outline:none;border-color:var(--tf-accent);',
		'box-shadow:0 0 0 3px rgba(0,168,232,.18);}',
		/* The dropdown carries no core control class, so the focus ring it used to
		 * inherit from one is spelled out here. */
		'.tf-page .tf-range:focus-visible{outline:2px solid var(--tf-accent);outline-offset:2px;}',
		'.tf-page .tf-hero-ctl{gap:.7rem;}',

		/* dark: Argon sets .dark on <body> when its dark mode is on */
		DARK + '{--tf-card:rgba(30,38,48,.66);--tf-card-brd:rgba(255,255,255,.08);',
		'--tf-chip:rgba(255,255,255,.08);--tf-menu:rgba(36,45,57,.99);',
		'--tf-fg:#e6edf3;--tf-dim:rgba(230,237,243,.55);',
		'--tf-shadow:0 6px 22px rgba(0,0,0,.35);',
		'--tf-down:#4dd2ff;--tf-up:#3ddc97;}',
		darkOf('.tf-range') + '{background-image:url("' + CHEVRON('#a9b6c2') + '");}',
		/* Layout by width rather than by device: the cards stack as soon as they
		 * cannot both fit, and the two columns a phone cannot spare (the busiest
		 * client and the device count) drop out there instead of squeezing the
		 * numbers nobody can read at 320px. */
		'@media (max-width:52rem){.tf-page .tf-chart-card,.tf-page .tf-donut-card{',
		'flex:0 0 100%;max-width:100%;margin-right:0;}',
		'.tf-page .tf-hero{flex-wrap:wrap;gap:.6rem;}',
		'.tf-page .tf-hero-ctl{margin-left:0;width:100%;justify-content:flex-start;}',
		'.tf-page .tf-donut-wrap{justify-content:center;}',
		'.tf-page .tf-status{gap:.45rem;}',
		/* the list scrolls sideways here instead of squeezing the name column:
		 * every column stays readable and nothing wraps into a second line */
		'.tf-page .tf-table{min-width:34rem;}}',
		'@media (max-width:34rem){.tf-page .tf-hero-rates{gap:.7rem;flex-wrap:wrap;}',
		'.tf-page .tf-table{font-size:.86rem;min-width:0;}',
		'.tf-page .tf-table>thead>tr>th,.tf-page .tf-table>tbody>tr>td{padding:.35rem .3rem;}',
		/* the two columns a phone cannot spare drop out, and the four that stay
		 * take the whole width */
		'.tf-page .tf-table>thead>tr>th:nth-child(5),.tf-page .tf-table>tbody>tr>td:nth-child(5),',
		'.tf-page .tf-table>thead>tr>th:nth-child(6),.tf-page .tf-table>tbody>tr>td:nth-child(6){display:none;}',
		'.tf-page .tf-col-app{width:46%;}.tf-page .tf-col-total{width:24%;}',
		'.tf-page .tf-col-down{width:15%;}.tf-page .tf-col-up{width:15%;}}'
	].join('');

	var st = document.createElement('style');
	st.id = 'tf-css';
	st.appendChild(document.createTextNode(css));
	document.head.appendChild(st);
}

'use strict';
'require view';
'require rpc';
'require dom';
'require poll';

var callSummary = rpc.declare({ object: 'luci.traffic', method: 'getSummary' });
var callHourly  = rpc.declare({ object: 'luci.traffic', method: 'getHourly', params: [ 'hours' ] });
var callReset   = rpc.declare({ object: 'luci.traffic', method: 'resetStats', params: [ 'what' ] });
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
	'24h': { label: 'Last 24 hours',  interval: 60 }
};
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
	var size = 208, stroke = 22, r = (size - stroke) / 2, c = 2 * Math.PI * r;
	var svg = E('svg', { 'width': size, 'height': size, 'viewBox': '0 0 ' + size + ' ' + size });
	var g = E('g', { 'transform': 'translate(' + (size / 2) + ',' + (size / 2) + ') rotate(-90)' });

	if (!total || !items.length) {
		g.appendChild(E('circle', { 'r': r, 'fill': 'none', 'stroke': 'rgba(140,160,180,.22)', 'stroke-width': stroke }));
	}
	else {
		var offset = 0;
		for (var i = 0; i < items.length; i++) {
			var frac = items[i].bytes / total;
			var len = Math.max(frac * c - 2, 0.6);
			g.appendChild(E('circle', {
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
	return svg;
}

function el(tag, attrs, children) { return E(tag, attrs || {}, children || []); }

/* Write text only when it actually changed.  The page polls every 5 s and most
 * of what it redraws is identical to the previous round; skipping the write
 * keeps the browser from invalidating layout and repainting for nothing. */
function setText(node, text) {
	text = String(text);
	if (node.__tfText === text) return;
	node.__tfText = text;
	node.textContent = text;
}

/* A row is remembered by application name so a refresh can update the numbers
 * in place.  Rebuilding instead would recreate ~12 nodes, a letter avatar and
 * an <img> per row every 5 s - and the <img> would be decoded again each time. */
function makeRow(name, bucket) {
	var icon = makeIcon(name);
	var nameEl = el('span', { 'class': 'tf-app-name' }, [ name ]);
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

	var svg = E('svg', {
		'class': 'tf-chart-svg', 'viewBox': '0 0 ' + W + ' ' + H, 'role': 'img'
	});

	/* horizontal grid, with the value on each line */
	for (var gi = 0; gi <= 2; gi++) {
		var gv = top * (gi / 2), gy = y(gv);
		svg.appendChild(E('line', {
			'x1': pad.l, 'x2': W - pad.r, 'y1': gy, 'y2': gy,
			'stroke': 'rgba(140,160,180,.20)', 'stroke-width': 1,
			'stroke-dasharray': gi === 0 ? '' : '3 4'
		}));
		svg.appendChild(E('text', {
			'x': W - pad.r - 2, 'y': gy - 3, 'text-anchor': 'end',
			'class': 'tf-chart-tick'
		}, [ fmtRate(gv) ]));
	}

	function path(key, fill) {
		var d = '', area = '';
		for (var k = 0; k < n; k++) {
			d += (k ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(series[k][key]).toFixed(1) + ' ';
		}
		area = d + 'L' + x(n - 1).toFixed(1) + ' ' + (pad.t + ih) + ' L' + x(0).toFixed(1) + ' ' + (pad.t + ih) + ' Z';
		if (fill) svg.appendChild(E('path', { 'd': area, 'fill': fill, 'stroke': 'none' }));
		svg.appendChild(E('path', {
			'd': d, 'fill': 'none', 'stroke': key === 'down' ? '#00a8e8' : '#26c281',
			'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
		}));
	}

	path('down', 'rgba(0,168,232,.13)');
	path('up', 'rgba(38,194,129,.11)');

	/* first and last timestamp, so the window is unambiguous */
	svg.appendChild(E('text', { 'x': pad.l, 'y': H - 6, 'class': 'tf-chart-tick' }, [ hhmm(series[0].t) ]));
	svg.appendChild(E('text', { 'x': W - pad.r, 'y': H - 6, 'text-anchor': 'end', 'class': 'tf-chart-tick' },
		[ hhmm(series[n - 1].t) ]));

	return svg;
}

return view.extend({
	summary: null,
	prev: null,
	rate: { down: 0, up: 0 },
	range: 'session',

	load: function() { return callSummary(); },

	render: function(summary) {
		this.summary = summary || {};
		var self = this;

		this.rateDown = el('b', {}, [ '—' ]);
		this.rateUp   = el('b', {}, [ '—' ]);
		this.totalEl  = el('div', { 'class': 'tf-total' }, [ '—' ]);
		this.donutEl  = el('div', { 'class': 'tf-donut' });
		this.legendEl = el('div', { 'class': 'tf-legend' });
		this.rowsEl   = el('tbody');
		this.metaEl   = el('div', { 'class': 'tf-meta' });
		this.chartEl  = el('div', { 'class': 'tf-chart' });
		this.chartNote = el('span', { 'class': 'tf-chart-note' });
		this.seriesRange = '1h';
		this.series = null;

		var rangeSel = el('select', { 'class': 'cbi-input-select tf-range', 'change': function(ev) {
			self.range = ev.target.value;
			self.refresh(true);
		} }, [
			el('option', { 'value': 'session' }, [ _('Since start') ]),
			el('option', { 'value': '24' }, [ _('Last 24 hours') ]),
			el('option', { 'value': '168' }, [ _('Last 7 days') ])
		]);

		var clearBtn = el('button', {
			'class': 'cbi-button cbi-button-negative tf-clear',
			'click': function() {
				if (!confirm(_('Clear the counters collected so far?'))) return;
				callReset('session').then(function() {
					self.prev = null;
					return callSummary();
				}).then(function(s) { self.summary = s; self.refresh(true); });
			}
		}, [ _('Clear') ]);

		var node = el('div', { 'class': 'tf-page' }, [
			el('div', { 'class': 'tf-card tf-hero' }, [
				el('div', { 'class': 'tf-hero-main' }, [
					this.totalEl,
					el('div', { 'class': 'tf-hero-cap' }, [ _('total') ])
				]),
				el('div', { 'class': 'tf-hero-rates' }, [
					el('div', { 'class': 'tf-rate tf-rate-down' }, [
						el('span', { 'class': 'tf-rate-arrow' }, [ '↓' ]), this.rateDown,
						el('span', { 'class': 'tf-rate-cap' }, [ _('Down') ])
					]),
					el('div', { 'class': 'tf-rate tf-rate-up' }, [
						el('span', { 'class': 'tf-rate-arrow' }, [ '↑' ]), this.rateUp,
						el('span', { 'class': 'tf-rate-cap' }, [ _('Up') ])
					])
				]),
				el('div', { 'class': 'tf-hero-ctl' }, [ rangeSel, clearBtn ])
			]),

			el('div', { 'class': 'tf-card tf-chart-card' }, [
				el('div', { 'class': 'tf-chart-head' }, [
					el('h3', {}, [ _('Throughput') ]),
					this.chartNote,
					el('div', { 'class': 'tf-chart-ctl' }, [
						el('button', { 'class': 'cbi-button tf-gran tf-gran-on', 'data-range': '1h',
							'click': function(ev) { self.setSeriesRange('1h', ev.target); } }, [ _('Last hour') ]),
						el('button', { 'class': 'cbi-button tf-gran', 'data-range': '24h',
							'click': function(ev) { self.setSeriesRange('24h', ev.target); } }, [ _('Last 24 hours') ])
					])
				]),
				this.chartEl
			]),

			el('div', { 'class': 'tf-grid' }, [
				el('div', { 'class': 'tf-card tf-donut-card' }, [
					el('div', { 'class': 'tf-donut-wrap' }, [ this.donutEl, this.legendEl ])
				]),
				el('div', { 'class': 'tf-card tf-list-card' }, [
					el('table', { 'class': 'table tf-table' }, [
						el('thead', {}, [ el('tr', {}, [
							el('th', {}, [ _('Application') ]),
							el('th', { 'class': 'tf-num' }, [ _('Total') ]),
							el('th', { 'class': 'tf-num' }, [ _('Down') ]),
							el('th', { 'class': 'tf-num' }, [ _('Up') ]),
							el('th', {}, [ _('Top client') ]),
							el('th', { 'class': 'tf-num' }, [ _('Clients') ])
						]) ]),
						this.rowsEl
					])
				])
			]),

			el('div', { 'class': 'tf-card tf-meta-card' }, [ this.metaEl ])
		]);

		injectCss();
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

	setSeriesRange: function(range, btn) {
		if (!SERIES_RANGES[range] || this.seriesRange === range) return;
		this.seriesRange = range;
		var bar = btn && btn.parentNode;
		if (bar) {
			for (var i = 0; i < bar.childNodes.length; i++) {
				var b = bar.childNodes[i];
				if (b.classList) b.classList[b === btn ? 'add' : 'remove']('tf-gran-on');
			}
		}
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

		if (!pts.length) {
			this.chartNote.textContent = '';
			this.chartEl.appendChild(el('div', { 'class': 'tf-chart-empty' }, [ _('No traffic recorded yet.') ]));
			return;
		}

		/* bytes in a bucket -> bytes per second, so the axis reads in the same
		 * unit as the live rates in the hero card */
		var series = pts.map(function(p) {
			return { t: Number(p[0]) || 0, down: (Number(p[1]) || 0) / iv, up: (Number(p[2]) || 0) / iv };
		});
		this.chartEl.appendChild(makeChart(series));

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
		if (this.range === 'session')
			return callSummary().then(function(s) { self.renderLive(s); });
		return callHourly(Number(this.range)).then(function(h) { self.renderHourly(h); });
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

	renderLive: function(s) {
		var t = s.totals || {};
		var down = Number(t.down) || 0, up = Number(t.up) || 0;

		/* The collector writes a snapshot every interval while the page polls
		 * twice as often, so half the refreshes have nothing new in them: skip
		 * those without touching the DOM at all. */
		var sig = [ Number(s.collected_at) || 0, down, up, (s.apps || []).length ].join('|');
		if (sig === this.lastSig) return;
		this.lastSig = sig;

		var items = (s.apps || []).map(function(a) {
			var d = Number(a.down) || 0, u = Number(a.up) || 0;
			return {
				name: a.name, down: d, up: u, bytes: d + u,
				clients: (a.clients === undefined) ? undefined : Number(a.clients),
				top: a.top || '',
				top_bytes: Number(a.top_bytes) || 0
			};
		}).filter(hasTraffic);

		/* rates come from the difference between two snapshots */
		if (this.prev) {
			var dt = (Number(s.collected_at) || 0) - (Number(this.prev.collected_at) || 0);
			var pd = Number(this.prev.totals.down) || 0, pu = Number(this.prev.totals.up) || 0;
			if (dt > 0 && down >= pd && up >= pu)
				this.rate = { down: (down - pd) / dt, up: (up - pu) / dt };
		}
		this.prev = s;

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

		this.drawMeta([
			{ cap: _('Proxy tunnel'), val: fmtBytes(t.router) },
			{ cap: _('Browser clients'), val: fmtBytes(all) },
			{ cap: _('Domain identified'), val: pct(named),
			  title: _('by client DNS') + ': ' + pct(namedE) + ', ' + _('by any client DNS') + ': ' + pct(namedA) },
			{ cap: _('Categorised'), val: pct(bucket) },
			{ cap: _('Other'), val: pct(residual), warn: true }
		]);

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
		var agg = {};
		hours.forEach(function(b) {
			(b.apps || []).forEach(function(a) {
				var k = a.name;
				if (!agg[k]) agg[k] = { name: k, down: 0, up: 0 };
				agg[k].down += Number(a.down) || 0;
				agg[k].up += Number(a.up) || 0;
			});
		});
		var items = Object.keys(agg).map(function(k) {
			agg[k].bytes = agg[k].down + agg[k].up;
			return agg[k];
		}).filter(hasTraffic)
		  .sort(function(a, b) { return b.bytes - a.bytes; });

		var total = items.reduce(function(s, a) { return s + a.bytes; }, 0);
		var gd = items.reduce(function(s, a) { return s + a.down; }, 0);
		var gu = items.reduce(function(s, a) { return s + a.up; }, 0);
		/* the hourly history keeps application totals only, so the per-client
		 * columns stay empty here rather than showing something invented */
		this.draw(items, { total: total, down: gd, up: gu });
		dom.content(this.rateDown, '—');
		dom.content(this.rateUp, '—');
		this.drawMeta([ { cap: _('Bucket'), val: String(hours.length) } ]);
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
				self.legendEl.appendChild(lr.row);
			}
			setText(lr.pct, (total ? (100 * a.bytes / total) : 0).toFixed(1) + '%');
		});
		Object.keys(this.legendCache).forEach(function(n) {
			if (legendSeen[n]) return;
			var lr = self.legendCache[n];
			if (lr.row.parentNode) lr.row.parentNode.removeChild(lr.row);
			delete self.legendCache[n];
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

/* Kept at the bottom so the view body reads as layout rather than styling.
 *
 * Argon adaptation: the accent colour and the card surface are taken from the
 * theme's own custom properties when it defines them (--primary, --card-color,
 * --font-color and friends), with bright fallbacks so the page also looks right
 * on the default theme.  Nothing here depends on Argon-only class names, and
 * dark mode is honoured through the class Argon sets on <body>. */
function injectCss() {
	if (document.getElementById('tf-css')) return;

	var DARK = '.dark .tf-page, [data-darkmode="true"] .tf-page, [data-theme="dark"] .tf-page';
	var css = [
		'.tf-page{--tf-accent:var(--primary,#00b4ff);--tf-accent2:#7c5cff;',
		'--tf-card:rgba(255,255,255,.72);--tf-card-brd:rgba(255,255,255,.75);',
		'--tf-fg:var(--font-color,#20303d);--tf-dim:rgba(32,48,61,.55);',
		'--tf-shadow:0 6px 22px rgba(31,66,102,.10);',
		'--tf-down:#00a8e8;--tf-up:#26c281;',
		'margin:-.4rem 0 0;color:var(--tf-fg);}',

		/* cards: translucent + blurred, which is what gives the "bright" look */
		'.tf-page .tf-card{background:var(--tf-card);border:1px solid var(--tf-card-brd);',
		'border-radius:16px;box-shadow:var(--tf-shadow);backdrop-filter:blur(14px) saturate(150%);',
		'-webkit-backdrop-filter:blur(14px) saturate(150%);padding:1rem 1.15rem;margin-bottom:1rem;}',

		/* hero */
		'.tf-page .tf-hero{display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;',
		'background:linear-gradient(135deg,rgba(0,180,255,.14),rgba(124,92,255,.14)),var(--tf-card);}',
		'.tf-page .tf-total{font-size:2rem;font-weight:700;line-height:1.15;letter-spacing:.5px;}',
		'.tf-page .tf-hero-cap{font-size:.8rem;color:var(--tf-dim);text-transform:uppercase;letter-spacing:.08em;}',
		'.tf-page .tf-hero-rates{display:flex;gap:1.6rem;}',
		'.tf-page .tf-rate{display:flex;align-items:baseline;gap:.35rem;font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-rate b{font-size:1.05rem;font-weight:600;}',
		'.tf-page .tf-rate-arrow{font-size:1rem;}',
		'.tf-page .tf-rate-down .tf-rate-arrow,.tf-page .tf-rate-down b{color:var(--tf-down);}',
		'.tf-page .tf-rate-up .tf-rate-arrow,.tf-page .tf-rate-up b{color:var(--tf-up);}',
		'.tf-page .tf-rate-cap{font-size:.75rem;color:var(--tf-dim);}',
		'.tf-page .tf-hero-ctl{margin-left:auto;display:flex;gap:.6rem;align-items:center;}',

		/* throughput chart */
		'.tf-page .tf-chart-head{display:flex;align-items:baseline;gap:.7rem;flex-wrap:wrap;margin-bottom:.35rem;}',
		'.tf-page .tf-chart-head h3{margin:0;font-size:.95rem;font-weight:600;}',
		'.tf-page .tf-chart-note{font-size:.76rem;color:var(--tf-dim);font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-chart-ctl{margin-left:auto;display:flex;gap:.35rem;}',
		'.tf-page .tf-chart-ctl .cbi-button{font-size:.74rem;padding:.2rem .6rem;border-radius:8px;',
		'background:rgba(140,160,180,.14);border:1px solid transparent;color:var(--tf-fg);cursor:pointer;}',
		'.tf-page .tf-chart-ctl .tf-gran-on{background:rgba(0,168,232,.16);border-color:rgba(0,168,232,.45);',
		'color:var(--tf-fg);font-weight:600;}',
		'.tf-page .tf-chart-svg{display:block;width:100%;height:auto;}',
		'.tf-page .tf-chart-tick{font-size:9px;fill:var(--tf-dim);}',
		'.tf-page .tf-chart-empty{padding:2.2rem 0;text-align:center;color:var(--tf-dim);font-size:.85rem;}',

		/* layout */
		'.tf-page .tf-grid{display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-start;}',
		'.tf-page .tf-donut-card{flex:0 0 auto;}',
		'.tf-page .tf-list-card{flex:1 1 30rem;min-width:24rem;padding-bottom:.4rem;}',
		'.tf-page .tf-donut-wrap{display:flex;align-items:center;gap:1.1rem;}',

		/* legend */
		'.tf-page .tf-legend{display:flex;flex-direction:column;gap:.3rem;min-width:9.5rem;}',
		'.tf-page .tf-legend-row{display:flex;align-items:center;gap:.45rem;font-size:.82rem;}',
		'.tf-page .tf-legend-dot{width:9px;height:9px;border-radius:50%;flex:0 0 9px;}',
		'.tf-page .tf-legend-name{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:8.5rem;}',
		'.tf-page .tf-legend-pct{color:var(--tf-dim);font-variant-numeric:tabular-nums;}',

		/* table */
		'.tf-page .tf-table{margin:0;background:transparent;}',
		'.tf-page .tf-table>thead>tr>th{border-bottom:1px solid rgba(128,150,175,.18);',
		'font-size:.78rem;font-weight:600;color:var(--tf-dim);text-transform:uppercase;letter-spacing:.06em;padding:.35rem .5rem;}',
		'.tf-page .tf-table>tbody>tr>td{border-bottom:1px solid rgba(128,150,175,.10);padding:.42rem .5rem;vertical-align:middle;}',
		'.tf-page .tf-table>tbody>tr:last-child>td{border-bottom:none;}',
		'.tf-page .tf-table>tbody>tr:hover>td{background:rgba(0,180,255,.06);}',
		'.tf-page .tf-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-down{color:var(--tf-down);}',
		'.tf-page .tf-up{color:var(--tf-up);}',
		'.tf-page .tf-total{font-weight:600;}',
		/* the grand total leads the table, so it is tinted rather than roped off */
		'.tf-page .tf-grand>td{background:rgba(0,180,255,.07);font-weight:600;',
		'border-bottom:1px solid rgba(128,150,175,.22)!important;}',
		'.tf-page .tf-top{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
		'max-width:14rem;color:var(--tf-dim);font-size:.85rem;}',

		/* app cell + icon: one 26px box for both the avatar and a real SVG */
		'.tf-page .tf-app{display:flex;align-items:center;gap:.6rem;}',
		'.tf-page .tf-app-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:16rem;}',
		/* a bucket is a kind of traffic, not a product: muted name plus a tag,
		 * so it never reads as if it were an application */
		'.tf-page .tf-isbucket .tf-app-name{color:var(--tf-dim);font-style:italic;}',
		'.tf-page .tf-isbucket .tf-total{font-weight:400;color:var(--tf-dim);}',
		'.tf-page .tf-tag{margin-left:.15rem;padding:.05rem .34rem;border-radius:6px;font-size:.62rem;',
		'letter-spacing:.04em;color:var(--tf-dim);background:rgba(128,150,175,.16);text-transform:uppercase;}',
		'.tf-page .tf-icon{width:' + ICON + 'px;height:' + ICON + 'px;flex:0 0 ' + ICON + 'px;',
		'border-radius:8px;display:inline-flex;align-items:center;justify-content:center;',
		'box-shadow:0 2px 6px rgba(31,66,102,.18);}',
		'.tf-page .tf-icon-letter{color:#fff;font-size:.82rem;font-weight:700;line-height:1;}',
		'.tf-page .tf-icon-img{width:' + ICON + 'px;height:' + ICON + 'px;border-radius:8px;display:block;}',

		/* footer stats + misc */
		'.tf-page .tf-meta-card{display:flex;gap:1.8rem;flex-wrap:wrap;padding:.8rem 1.15rem;}',
		'.tf-page .tf-meta-item{display:flex;flex-direction:column;gap:.1rem;}',
		'.tf-page .tf-meta-cap{font-size:.75rem;color:var(--tf-dim);}',
		'.tf-page .tf-meta-val{font-size:.95rem;font-weight:600;font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-warn{color:#ff8f1f;}',
		'.tf-page .tf-empty{text-align:center;color:var(--tf-dim);padding:1.6rem 0;}',
		'.tf-page .tf-range{min-width:9rem;}',

		/* dark: Argon sets .dark on <body> when its dark mode is on */
		DARK + '{--tf-card:rgba(30,38,48,.66);--tf-card-brd:rgba(255,255,255,.08);',
		'--tf-fg:#e6edf3;--tf-dim:rgba(230,237,243,.55);',
		'--tf-shadow:0 6px 22px rgba(0,0,0,.35);',
		'--tf-down:#4dd2ff;--tf-up:#3ddc97;}',
		'@media (max-width:52rem){.tf-page .tf-list-card{min-width:0;flex-basis:100%;}',
		'.tf-page .tf-donut-card{flex-basis:100%;}.tf-page .tf-hero-ctl{margin-left:0;}}'
	].join('');

	var st = document.createElement('style');
	st.id = 'tf-css';
	st.appendChild(document.createTextNode(css));
	document.head.appendChild(st);
}

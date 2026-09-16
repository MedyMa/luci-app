'use strict';
'require view';
'require rpc';
'require dom';
'require poll';

var callSummary = rpc.declare({ object: 'luci.traffic', method: 'getSummary' });
var callHourly  = rpc.declare({ object: 'luci.traffic', method: 'getHourly', params: [ 'hours' ] });
var callReset   = rpc.declare({ object: 'luci.traffic', method: 'resetStats', params: [ 'what' ] });

/* Vivid, evenly spaced hues: bright enough to read on a light card and to keep
 * their identity on a dark one. */
var PALETTE = [
	'#00b4ff', '#ff7a45', '#36cfc9', '#ff4d8d', '#7c5cff',
	'#ffc53d', '#40d97b', '#ff9f1c', '#5cd1ff', '#b37feb'
];

var ICON = 26;   /* one size everywhere: list rows, donut legend */

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
		poll.add(L.bind(function() { return this.refresh(false); }, this), 5);
		return node;
	},

	refresh: function() {
		var self = this;
		if (this.range === 'session')
			return callSummary().then(function(s) { self.renderLive(s); });
		return callHourly(Number(this.range)).then(function(h) { self.renderHourly(h); });
	},

	renderLive: function(s) {
		var items = (s.apps || []).map(function(a) {
			var down = Number(a.down) || 0, up = Number(a.up) || 0;
			return {
				name: a.name, down: down, up: up, bytes: down + up,
				clients: (a.clients === undefined) ? undefined : Number(a.clients),
				top: a.top || '',
				top_bytes: Number(a.top_bytes) || 0
			};
		}).filter(hasTraffic);

		var t = s.totals || {};
		var down = Number(t.down) || 0, up = Number(t.up) || 0;

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

		dom.content(this.metaEl, [
			el('div', { 'class': 'tf-meta-item' }, [
				el('span', { 'class': 'tf-meta-cap' }, [ _('Proxy tunnel') ]),
				el('span', { 'class': 'tf-meta-val' }, [ fmtBytes(t.router) ])
			]),
			el('div', { 'class': 'tf-meta-item' }, [
				el('span', { 'class': 'tf-meta-cap' }, [ _('Browser clients') ]),
				el('span', { 'class': 'tf-meta-val' }, [ fmtBytes(all) ])
			]),
			el('div', { 'class': 'tf-meta-item' }, [
				el('span', { 'class': 'tf-meta-cap' }, [ _('Domain identified') ]),
				el('span', {
					'class': 'tf-meta-val',
					'title': _('by client DNS') + ': ' + pct(namedE) + ', ' + _('by any client DNS') + ': ' + pct(namedA)
				}, [ pct(named) ])
			]),
			el('div', { 'class': 'tf-meta-item' }, [
				el('span', { 'class': 'tf-meta-cap' }, [ _('Categorised') ]),
				el('span', { 'class': 'tf-meta-val' }, [ pct(bucket) ])
			]),
			el('div', { 'class': 'tf-meta-item' }, [
				el('span', { 'class': 'tf-meta-cap' }, [ _('Other') ]),
				el('span', { 'class': 'tf-meta-val tf-warn' }, [ pct(residual) ])
			])
		]);
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
		dom.content(this.metaEl, [
			el('div', { 'class': 'tf-meta-item' }, [
				el('span', { 'class': 'tf-meta-cap' }, [ _('Bucket') ]),
				el('span', { 'class': 'tf-meta-val' }, [ String(hours.length) ])
			])
		]);
	},

	draw: function(items, stats) {
		/* one palette assignment for everything drawn this round, so the donut,
		 * the legend and the table cannot disagree about a colour */
		colorMap = assignColors(items.slice(0, 30));
		var top = items.slice(0, 10);
		var total = stats.total;

		dom.content(this.donutEl, makeDonut(top, total));
		dom.content(this.totalEl, fmtBytes(total));

		/* legend beside the ring: name, share, one line each so ten entries fit */
		dom.content(this.legendEl, top.map(function(a) {
			var pct = total ? (100 * a.bytes / total) : 0;
			return el('div', { 'class': 'tf-legend-row' }, [
				el('span', { 'class': 'tf-legend-dot', 'style': 'background:' + colorFor(a.name) }),
				el('span', { 'class': 'tf-legend-name' }, [ a.name ]),
				el('span', { 'class': 'tf-legend-pct' }, [ pct.toFixed(1) + '%' ])
			]);
		}));

		var rows = [];

		/* the grand total leads the table, the way the reference gateway does it */
		rows.push(el('tr', { 'class': 'tf-grand' }, [
			el('td', { 'class': 'tf-app' }, [ el('span', { 'class': 'tf-app-name' }, [ _('All traffic') ]) ]),
			el('td', { 'class': 'tf-num tf-total' }, [ fmtBytes(total) ]),
			el('td', { 'class': 'tf-num tf-down' }, [ fmtBytes(stats.down) ]),
			el('td', { 'class': 'tf-num tf-up' }, [ fmtBytes(stats.up) ]),
			el('td', { 'class': 'tf-top' }, [ stats.topText || '—' ]),
			el('td', { 'class': 'tf-num' }, [ stats.clientCount === undefined ? '—' : String(stats.clientCount) ])
		]));

		items.slice(0, 100).forEach(function(a) {
			var bucket = isBucket(a.name);
			var pct = total ? (100 * a.bytes / total) : 0;
			var topText = '—';
			if (a.top) {
				var share = a.bytes ? (100 * (a.top_bytes || 0) / a.bytes) : 0;
				topText = a.top + ' ' + fmtBytes(a.top_bytes || 0) + ' (' + share.toFixed(1) + '%)';
			}
			rows.push(el('tr', { 'class': bucket ? 'tf-isbucket' : '' }, [
				el('td', { 'class': 'tf-app' }, [
					makeIcon(a.name),
					el('span', { 'class': 'tf-app-name' }, [ a.name ]),
					bucket ? el('span', { 'class': 'tf-tag' }, [ _('type') ]) : ''
				]),
				el('td', { 'class': 'tf-num tf-total' }, [ fmtBytes(a.bytes) + ' (' + pct.toFixed(1) + '%)' ]),
				el('td', { 'class': 'tf-num tf-down' }, [ fmtBytes(a.down) ]),
				el('td', { 'class': 'tf-num tf-up' }, [ fmtBytes(a.up) ]),
				el('td', { 'class': 'tf-top' }, [ topText ]),
				el('td', { 'class': 'tf-num' }, [ a.clients === undefined ? '—' : String(a.clients) ])
			]));
		});

		if (!items.length)
			rows.push(el('tr', {}, [ el('td', { 'colspan': 6, 'class': 'tf-empty' }, [ _('No traffic recorded yet.') ]) ]));
		dom.content(this.rowsEl, rows);
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

'use strict';
'require view';
'require rpc';
'require dom';
'require poll';

var callSummary = rpc.declare({ object: 'luci.traffic', method: 'getSummary' });
var callHourly  = rpc.declare({ object: 'luci.traffic', method: 'getHourly', params: [ 'hours' ] });
var callSeries  = rpc.declare({ object: 'luci.traffic', method: 'getSeries', params: [ 'range' ] });
var callResolveNow = rpc.declare({ object: 'luci.traffic', method: 'resolveNow' });
var callLive    = rpc.declare({ object: 'luci.traffic', method: 'getLive' });

/* Vivid, evenly spaced hues: bright enough to read on a light card and to keep
 * their identity on a dark one. */
var PALETTE = [
	'#00b4ff', '#ff7a45', '#36cfc9', '#ff4d8d', '#7c5cff',
	'#ffc53d', '#40d97b', '#ff9f1c', '#5cd1ff', '#b37feb'
];

/* The colour of the ring's "nothing could name this" slice, and the only one on
 * the page that is not derived from a name.  It is not an application, so it
 * must not wear an application's colour: a hue out of the palette above would
 * read as one more thing that had been identified.  Fixed rather than hashed
 * from the label, because the label is translated - a hash of 未归属 would put
 * the slice in a different colour on a Chinese page than on an English one. */
var UNATTR_COLOR = '#9aa5b1';

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

/* The right padding is wide enough to hold the value labels, so they sit beside
 * the plot instead of inside it: they are right-anchored on the plot's right
 * edge, and with a 10px margin the floor label sat where the upload curve runs,
 * which drew a line through "0 B/s".  A label a curve can cross is worse than a
 * slightly narrower plot. */
var CHART_W = 720, CHART_H = 190, CHART_PAD = { l: 10, r: 54, t: 14, b: 22 };
/* A phone gets its own canvas.  The chart is drawn in user units and its labels
 * are sized in those units, so a 720-unit box scaled into a 275px column renders
 * 9-unit text at about 3.5px and flattens the plot into a 72px ribbon - the curve
 * is there, and nobody can read it.  Fewer units across means the same labels come
 * out at a readable size, and a squarer box keeps a usable plot height.  The
 * breakpoint matches the stylesheet, which lifts the 190px max-height there so the
 * aspect is not fought. */
var CHART_NARROW_W = 300, CHART_NARROW_H = 130,
    CHART_NARROW_PAD = { l: 8, r: 42, t: 12, b: 20 },
    CHART_NARROW_MAX = 624;

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

/* The names the collector marks with "proto":1.  They are not applications and
 * never were: they are the transport or the infrastructure label the attribution
 * falls back to when a flow's destination never got a name, and together they
 * carried about a third of the attributed traffic.  The flag is what decides;
 * this list is the same one collector.sh carries and covers the archived hours,
 * whose rows are rebuilt from a name and carry no flag. */
/* The collector still marks the protocol buckets with "proto":1, but they are
 * listed with the applications rather than in a block of their own: on a router
 * that offloads, SSL/TLS / QUIC / Other are where a large part of the traffic
 * actually lands, and pulling them out of the table left the table summing to
 * much less than the total above it.  One list, sorted by bytes, is what the
 * reader was using.  isProto stays as the single place that decision is made. */
var PROTO_NAMES = {
	'SSL/TLS': 1, 'QUIC': 1, 'HTTP': 1, 'DNS': 1, 'STUN': 1,
	'RTSP': 1, 'Email': 1, 'ICMP': 1, 'Other': 1
};

function isProto(item) {
	return false;
}

/* The headline total of the session: what the box actually carried.
 *
 * It comes from the interface counters the collector publishes as summary.iface
 * (read from /proc/net/dev).  Those sit in the driver, below the fast path that
 * flow offloading uses, so they count the forwarded traffic that never reaches
 * netfilter or conntrack - which is why the old headline, the sum of the
 * per-application attribution (summary.totals), understated the traffic by about
 * twenty times on a router with offloading on.
 *
 * summary.totals is the fallback for a router whose WAN device could not be
 * identified, and it is a *session* reading either way: there is no interface
 * counter for a range, so the ranged view must never call this.
 *
 * Numbers, never NaN: a missing or non-numeric field falls back, and the source
 * is returned so the caller can label the figure honestly. */
function headlineTotals(s) {
	var t = (s && s.totals) || {};
	var ifc = s && s.iface;
	if (ifc) {
		var d = Number(ifc.down), u = Number(ifc.up);
		if (isFinite(d) && isFinite(u) && d >= 0 && u >= 0)
			return { down: d, up: u, total: d + u, source: 'iface' };
	}
	d = Number(t.down) || 0;
	u = Number(t.up) || 0;
	return { down: d, up: u, total: d + u, source: 'totals' };
}

/* Address to device name, taken from the live snapshot, which carries the names
 * a DHCP lease gave.  The archive stores the address it saw; turning that into a
 * name is presentation, and the live map is the one place that knows it. */
var clientNames = {};
function clientName(v) { return (v && clientNames[v]) ? clientNames[v] : (v || ''); }
function rememberNames(s) {
	clientNames = {};
	((s && s.clients) || []).forEach(function(c) {
		if (c && c.ip && c.name) clientNames[c.ip] = c.name;
	});
}

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

/* Which icons exist, so the page never asks for one that does not.
 *
 * There are two sets: the ~860 shipped inside the package and whatever the
 * router has fetched into /traffic-icons.  Each has an index beside it, and each
 * index is one small request, so a page load costs two requests instead of one
 * doomed request per application without an icon - 381 of them on a real router,
 * which buried every other console message and made a working page look broken.
 *
 * The fallback differs on purpose.  An unreadable cache index means "the router
 * has fetched nothing", which is the honest answer and costs only a letter
 * avatar.  An unreadable SHIPPED index would mean showing no icons at all for a
 * whole page load, far worse than a few 404s, so in that case the URL is tried
 * as before. */
var shippedIcons = null, cachedIcons = null, shippedIndexFailed = false;

function loadIndex(url, onFail) {
	return fetch(url)
		.then(function(r) { return r.ok ? r.text() : null; })
		.then(function(t) {
			if (t === null) { onFail(); return {}; }
			var m = {};
			t.split('\n').forEach(function(l) {
				l = l.trim();
				if (l) m[l] = 1;
			});
			return m;
		})
		.catch(function() { onFail(); return {}; });
}

function ensureIconIndexes() {
	if (shippedIcons) return;
	shippedIcons = {};
	cachedIcons = {};
	loadIndex(L.resource('traffic/icons/index.txt'), function() { shippedIndexFailed = true; })
		.then(function(m) { shippedIcons = m; });
	loadIndex('/traffic-icons/index.txt', function() {})
		.then(function(m) { cachedIcons = m; });
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
 * app's own colour.  Same box size either way, so rows never jump.
 *
 * There are two places an icon can come from: the ~700 shipped inside the
 * package, and a cache the router may have filled at runtime.  The packaged one
 * wins; the cache is only consulted when it is missing, and the letter avatar
 * stays when neither has it.  Nothing here reaches the network - a page must not
 * depend on an upstream icon host being reachable, which is the whole reason the
 * fetching, when it is enabled at all, happens on the router and not here.
 *
 * `color` overrides the name-derived colour for the rows that are not
 * applications - the ring's 未归属 slice - so the avatar agrees with the slice. */
function makeIcon(name, color) {
	var box = E('span', {
		'class': 'tf-icon',
		'style': 'background:' + (color || colorFor(name))
	}, [ E('span', { 'class': 'tf-icon-letter' }, [ (name || '?').charAt(0).toUpperCase() ]) ]);

	var tries = [];
	/* ask only for what an index says exists; if the shipped index could not be
	 * read, fall back to asking, because a failed index must not cost the whole
	 * page its icons */
	if (shippedIndexFailed || !shippedIcons || shippedIcons[slug(name)])
		tries.push(L.resource('traffic/icons/' + slug(name) + '.svg'));
	if (cachedIcons && cachedIcons[slug(name)])
		tries.push('/traffic-icons/' + slug(name) + '.svg');
	/* Nothing is known to exist.  Do not create an <img> at all: an empty src
	 * makes the browser request the page itself, which is a worse request to
	 * emit than the one this was meant to avoid.  The letter avatar above is
	 * already the right answer. */
	if (!tries.length) return box;
	var img = new Image();
	img.onload = function() {
		box.textContent = '';
		box.style.background = 'transparent';
		box.style.boxShadow = 'none';
		img.className = 'tf-icon-img';
		box.appendChild(img);
	};
	img.onerror = function() {
		if (tries.length) img.src = tries.shift();
	};
	img.src = tries.shift();
	return box;
}

/* Donut drawn with one stroked circle per slice (dash offset), which needs no
 * arc maths and stays crisp at any size.  `total` is the denominator of every
 * slice, so the slices add up to the whole circle; the caller passes the number
 * the headline and the table's first row show, not the sum of the named rows. */
function makeDonut(items, total) {
	var size = 168, stroke = 20, r = (size - stroke) / 2, c = 2 * Math.PI * r;
	var svg = S('svg', { 'width': size, 'height': size, 'viewBox': '0 0 ' + size + ' ' + size,
		'class': 'tf-donut-svg' });
	var g = S('g', { 'transform': 'translate(' + (size / 2) + ',' + (size / 2) + ') rotate(-90)' });

	if (!total || !items.length) {
		g.appendChild(S('circle', { 'class': 'tf-ring', 'r': r, 'fill': 'none', 'stroke': 'rgba(140,160,180,.22)', 'stroke-width': stroke }));
	}
	else {
		var offset = 0;
		for (var i = 0; i < items.length; i++) {
			var frac = items[i].bytes / total;
			var len = Math.max(frac * c - 2, 0.6);
			g.appendChild(S('circle', {
				'r': r, 'fill': 'none', 'stroke-linecap': 'butt',
				/* the marker, not the name, decides: the unattributed slice is
				 * named by a translated string and must stay neutral grey */
				'stroke': items[i].unattr ? UNATTR_COLOR : colorFor(items[i].name),
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
		/* the cell says which window its figure belongs to: the recorded top
		 * client is a current-run reading, the byte columns beside it may cover
		 * the selected range */
		top:   el('td', { 'class': 'tf-top',
			'title': _('the busiest client of each application is recorded for the current run, while the byte columns can cover the selected range') }),
		clients: el('td', { 'class': 'tf-num' })
	};
	var tr = el('tr', { 'class': bucket ? 'tf-isbucket' : '' }, [
		/* No tag on a bucket row: "type" said nothing about what kind of thing the
		 * row was - every reader asked what type of what - and it took room from
		 * the column the names need.  The glyph, the italic name and the muted
		 * colour already carry the only distinction that matters: a kind of
		 * traffic rather than a product. */
		el('td', { 'class': 'tf-app' }, [ icon, nameEl ]),
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
		var tb = a.top_bytes || 0;
		/* The recorded top client is a current-run figure while this row's own
		 * bytes can cover the selected range (the archive stores the session
		 * counters a range view cannot reconcile).  A ratio taken across the two
		 * windows is not a share, so above 100% it is left off rather than
		 * printed - 2458.0% in a 总量 column beside "30 MiB" is what it looked
		 * like on a real page. */
		topText = clientName(a.top) + ' ' + fmtBytes(tb) +
			(a.bytes && tb <= a.bytes ? ' (' + (100 * tb / a.bytes).toFixed(1) + '%)' : '');
	}
	setText(row.cells.top, topText);
	setText(row.cells.clients, a.clients === undefined ? '—' : String(a.clients));
}

/* The legend rows are reused the same way: only the percentage moves.  A
 * protocol bucket gets the same mark the table gives it, so the ring's key
 * cannot read as a list of applications either.  `color` overrides the dot for
 * the slice that is not an application at all. */
function makeLegendRow(name, proto, color) {
	var pctEl = el('span', { 'class': 'tf-legend-pct' });
	var row = el('div', { 'class': 'tf-legend-row' + (proto ? ' tf-isbucket' : '') }, [
		el('span', { 'class': 'tf-legend-dot', 'style': 'background:' + (color || colorFor(name)) }),
		makeIcon(name, color),
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

/* The throughput chart: one smooth stroked curve per direction over a
 * translucent area, drawn by hand so it needs no chart library and inherits the
 * page's colours.  A flat zero reads as a line on the floor rather than as a
 * gap. */
function makeChart(series) {
	var narrow = (typeof window !== 'undefined') && (window.innerWidth || 0) > 0 &&
		window.innerWidth <= CHART_NARROW_MAX;
	var pad = narrow ? CHART_NARROW_PAD : CHART_PAD;
	var W = narrow ? CHART_NARROW_W : CHART_W;
	var H = narrow ? CHART_NARROW_H : CHART_H;
	var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
	var n = series.length;

	var peak = 0;
	for (var i = 0; i < n; i++) {
		if (series[i].down > peak) peak = series[i].down;
		if (series[i].up > peak) peak = series[i].up;
		/* A one second peak can be far above every average on the curve, and the
		 * axis has to hold it or the top gridline would sit below the number the
		 * note quotes. */
		if (series[i].pk > peak) peak = series[i].pk;
		if (series[i].pu > peak) peak = series[i].pu;
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
			'class': 'tf-grid',
			'stroke-width': 1,
			'stroke-dasharray': gi === 0 ? '' : '3 4'
		}));
		/* anchored at the SVG's right edge, not the plot's: the right padding is
		 * the label's own gutter, and anchoring on the plot edge (which is what
		 * this did) left the label inside the plot no matter how wide the
		 * padding was, so the upload curve still ran through "0 B/s" */
		svg.appendChild(S('text', {
			'x': W - 3, 'y': gy - 3, 'text-anchor': 'end',
			'class': 'tf-chart-tick', 'text': fmtRate(gv)
		}));
	}

	/* A smooth curve through the samples rather than a chain of straight
	 * segments.  Monotone cubic interpolation - the same shape d3 calls
	 * curveMonotoneX - gives each segment a cubic Bezier whose tangents are
	 * limited so the curve cannot overshoot the two samples it joins.
	 *
	 * That limit matters more here than the smoothness does.  An ordinary spline
	 * through traffic samples dips below the floor between a spike and the next
	 * low reading, which draws bytes that were never transferred, and invents a
	 * hump on a flat stretch.  Monotone keeps every value between its two
	 * neighbours, so the curve stays inside what was actually measured.
	 *
	 * Both colours come from classes: a stroke set as a presentation attribute
	 * cannot read a custom property, so the curve kept its light-mode blue on a
	 * dark page while the table under it turned over correctly. */
	function curve(key) {
		var pts = [], k;
		for (k = 0; k < n; k++) pts.push({ x: x(k), y: y(series[k][key]) });
		var d = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);

		if (pts.length >= 3) {
			/* secant slope of each span, then the Fritsch-Carlson tangent at each
			 * sample: the weighted harmonic mean of the two secants, or zero at a
			 * local extreme where the sign flips. */
			var dx = [], sec = [], m = [];
			for (k = 0; k < pts.length - 1; k++) {
				dx[k] = pts[k + 1].x - pts[k].x || 1;
				sec[k] = (pts[k + 1].y - pts[k].y) / dx[k];
			}
			m[0] = sec[0];
			m[pts.length - 1] = sec[pts.length - 2];
			for (k = 1; k < pts.length - 1; k++) {
				if (sec[k - 1] * sec[k] <= 0) m[k] = 0;
				else {
					var w1 = 2 * dx[k] + dx[k - 1], w2 = dx[k] + 2 * dx[k - 1];
					m[k] = (w1 + w2) / (w1 / sec[k - 1] + w2 / sec[k]);
				}
			}
			for (k = 0; k < pts.length - 1; k++) {
				var h = dx[k];
				d += 'C' + (pts[k].x + h / 3).toFixed(1) + ' ' + (pts[k].y + m[k] * h / 3).toFixed(1) +
				     ' ' + (pts[k + 1].x - h / 3).toFixed(1) + ' ' + (pts[k + 1].y - m[k + 1] * h / 3).toFixed(1) +
				     ' ' + pts[k + 1].x.toFixed(1) + ' ' + pts[k + 1].y.toFixed(1);
			}
		}
		else {
			for (k = 1; k < pts.length; k++)
				d += 'L' + pts[k].x.toFixed(1) + ' ' + pts[k].y.toFixed(1);
		}
		return d;
	}

	function path(key) {
		var d = curve(key);
		var base = (pad.t + ih).toFixed(1);
		/* the fill follows the same curve, so the area under it is the area the
		 * line encloses rather than a second, straighter shape */
		var area = d + 'L' + x(n - 1).toFixed(1) + ' ' + base +
			' L' + x(0).toFixed(1) + ' ' + base + ' Z';
		svg.appendChild(S('path', { 'd': area, 'class': 'tf-area-' + key, 'stroke': 'none' }));
		svg.appendChild(S('path', {
			'd': d, 'fill': 'none', 'class': 'tf-curve tf-curve-' + key,
			'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
		}));
	}

	path('down');
	path('up');

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
		/* The ring and the total laid over its hole.  The total moves on every
		 * refresh while the ring is only rebuilt when the composition of it
		 * changed, so the two are separate nodes rather than one SVG. */
		this.donutFigEl   = el('div', { 'class': 'tf-donut-fig' });
		this.donutTotalEl = el('div', { 'class': 'tf-donut-total' }, [ '—' ]);
		/* The ring is the composition of the *whole* window now - its slices are
		 * the named applications, 其余应用 and 未归属 - so its own reading is the
		 * same total the headline above shows, and its caption is the headline's
		 * caption: 总计 while that number really is everything the box carried,
		 * 已归属 when the ring could only be built from the attributed sum (a
		 * ranged view whose archive has no device counters).  One number, one
		 * word, in both places. */
		this.donutCapEl = el('div', { 'class': 'tf-donut-cap' }, [ _('Attributed') ]);
		this.donutEl  = el('div', { 'class': 'tf-donut' }, [
			this.donutFigEl,
			el('div', { 'class': 'tf-donut-center' }, [
				this.donutTotalEl,
				this.donutCapEl
			])
		]);
		this.legendEl = el('div', { 'class': 'tf-legend' });
		this.rowsEl   = el('tbody');
		/* The protocol buckets live under the table rather than in it: they are
		 * real attributed bytes - the ring above still counts them - but they are
		 * not applications, and a table whose column header says 应用 must not
		 * list a transport protocol as one.  Built here so a refresh only moves
		 * the text. */
		this.protoTitleEl = el('span', { 'class': 'tf-proto-title' }, [ _('Protocols (not applications)') ]);
		this.protoSumEl   = el('span', { 'class': 'tf-proto-sum' });
		this.protoListEl  = el('div', { 'class': 'tf-proto-list' });
		this.protoEl = el('div', { 'class': 'tf-proto' }, [
			el('div', { 'class': 'tf-proto-cap' }, [ this.protoTitleEl, this.protoSumEl ]),
			this.protoListEl
		]);
		this.protoEl.style.display = 'none';
		this.diagEl   = el('div', { 'class': 'tf-diag' });
		this.chartEl  = el('div', { 'class': 'tf-chart' });
		this.chartNote = el('span', { 'class': 'tf-chart-note' });
		/* The key for the two curves.  They are drawn in the same colours the
		 * chart uses, so a small upload curve is identifiable rather than
		 * looking like a stray line at the floor. */
		this.chartLegend = el('div', { 'class': 'tf-chart-legend' }, [
			el('span', { 'class': 'tf-lg-down' }, [ el('i'), _('Received') ]),
			el('span', { 'class': 'tf-lg-up' }, [ el('i'), _('Sent') ])
		]);
		this.statusEl = el('div', { 'class': 'tf-stat-strip' });
		/* the card around it, held here so renderStrip can mark it when a reading
		 * is a warning - the stylesheet keeps this card off a phone except then */
		this.statCardEl = el('div', { 'class': 'tf-card tf-stat-card' }, [ this.statusEl ]);
		/* the readings that do not belong in the strip, under the table they
		 * comment on.  Hidden until there is something to say. */
		this.diagCardEl = el('div', { 'class': 'tf-card tf-diag-card' }, [ this.diagEl ]);
		this.diagCardEl.style.display = 'none';
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
			/* One grid of three columns: the three captions on the first row and
			 * the three readings on the second.  The stylesheet says why this is
			 * a grid rather than three caption/reading pairs. */
			el('div', { 'class': 'tf-card tf-hero' }, [
				el('div', { 'class': 'tf-hero-stats' }, [
					/* The caption follows the reading: 总计 only while the number
					 * under it really is everything the box carried (the interface
					 * counters), 已归属 when it is the attributed sum - which is
					 * all a ranged view or a router without a WAN device can show. */
					this.heroCapEl = el('div', { 'class': 'tf-hero-cap' }, [ _('total') ]),
					el('div', { 'class': 'tf-hero-cap' }, [ _('Received') ]),
					el('div', { 'class': 'tf-hero-cap' }, [ _('Sent') ]),
					this.totalEl,
					el('div', { 'class': 'tf-rate tf-rate-down' }, [
						el('span', { 'class': 'tf-rate-arrow' }, [ '↓' ]), this.rateDown
					]),
					el('div', { 'class': 'tf-rate tf-rate-up' }, [
						el('span', { 'class': 'tf-rate-arrow' }, [ '↑' ]), this.rateUp
					])
				]),
				el('div', { 'class': 'tf-hero-ctl' }, [ this.rangePicker.node ])
			]),

			el('div', { 'class': 'tf-mid' }, [
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

			this.statCardEl,

			/* The composition sits above the table rather than beside it: the two
			 * were a flexible two-column row, and below the tablet breakpoint that
			 * row stacked anyway, so the breakdown pushed the table down and left
			 * a band of empty page beside the donut.  Above the table it is one
			 * readable block at every width, and the legend can spread sideways
			 * instead of being squeezed into one column. */
			el('div', { 'class': 'tf-card tf-donut-card' }, [
				el('div', { 'class': 'tf-donut-wrap' }, [
					this.donutEl,
					/* The legend is its own labelled block: as a bare list of names
					 * beside a ring it read as an unlabelled column of text. */
					el('div', { 'class': 'tf-legend-box' }, [
						/* The ring's key lists every slice of the ring, 未归属
						 * included - so it is neither 应用 (the table's name
						 * column) nor 已归属流量 (which it no longer is: the ring
						 * is the whole total now).  流量构成 is what it is: the
						 * breakdown of the total, named and unnamed alike. */
						el('div', { 'class': 'tf-legend-cap' }, [ _('Traffic breakdown') ]),
						this.legendEl
					])
				])
			]),
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
						/* The per-application client figure is recorded for the
						 * current run - the archive keeps the correlation it was
						 * built from, which is the session counters - while the
						 * byte columns beside it can cover the selected range.  The
						 * column says which window it belongs to, because a
						 * percentage taken across the two is what printed 114.7%
						 * and 2458% on a real page. */
						el('th', { 'class': 'tf-top-h',
							'title': _('the busiest client of each application is recorded for the current run, while the byte columns can cover the selected range') },
							[ _('Top client (this session)') ]),
						el('th', { 'class': 'tf-num' }, [ _('Client count') ])
					]) ]),
					this.rowsEl
				])
			]),

			this.diagCardEl
		]);

		injectCss();
		/* which icons exist, shipped and fetched: one small request each, so the
		 * page never asks for an icon that is not there */
		ensureIconIndexes();
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
		/* The realtime meter has its own one-second clock.  LuCI's poll scheduler
		 * ticks on a 1000 ms setInterval and treats the interval as a number of
		 * ticks, so 1 is valid and fires on every tick.
		 *
		 * It does NOT stop while the tab is hidden - luci.js has no
		 * visibilitychange handler at all; the slowdown in a background tab is
		 * the browser throttling its own timers, so a hidden page still samples,
		 * just far less often.  What ends the sampling is closing the page,
		 * because then nothing calls getLive and the timestamp live.sh checks
		 * goes stale. */
		poll.add(L.bind(this.pollLive, this), 1);
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
			return { t: Number(p[0]) || 0, down: (Number(p[1]) || 0) / iv, up: (Number(p[2]) || 0) / iv,
				pk: Number(p[3]) || 0, pu: Number(p[4]) || 0, pn: Number(p[5]) || 0 };
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

		/* The peak is quoted from the one second samples whenever a point has any,
		 * and the label says which of the two it is showing.  The highest round
		 * average is not a peak: a gigabit burst inside one round reads a tenth
		 * of what it was, which is how a 991 Mbps speed test was published as
		 * 12.9 MiB/s while the live rate beside it read higher than its own
		 * "peak".  Where no one second sample exists - nobody had the page open,
		 * or the router rebooted and the session tier went with it - the round
		 * average is the only honest number and it is labelled as such. */
		var peak = 0, peakN = 0, sumD = 0, sumU = 0;
		series.forEach(function(p) {
			if (p.down > peak) peak = p.down;
			if (p.up > peak) peak = p.up;
			if (p.pk > peak) peak = p.pk;
			if (p.pu > peak) peak = p.pu;
			peakN += p.pn;
			sumD += p.down; sumU += p.up;
		});
		var first = series[0].t, last = series[series.length - 1].t;
		this.chartNote.textContent = (peakN > 0 ? _('Peak (1 s)') : _('Peak (interval avg)')) + ' ' + fmtRate(peak) +
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
			rememberNames(self.summary);
			if (self.range === 'session') { self.renderLive(self.summary); return; }
			return callHourly(Number(self.range)).then(function(h) {
				/* remembered so the strip can still answer "how many hours does
				 * the archive hold" after the reader switches to the session
				 * view, which does not fetch the history at all */
				self.archHours = ((h && h.hours) || []).length;
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
				/* the same live rate the session view shows, from the same two
				 * snapshots, so choosing a range changes the window and not the
				 * meaning of the two figures under 下载 and 上传 */
				self.updateRate(self.summary);
				self.drawStatus(self.summary, self.lastItems || []);
			});
		});
	},

	/* The strip: one row of identical boxes holding the collector's own state and
	 * the totals of the window on screen.  The two sets are produced by two
	 * different callers - the state comes from the summary, which is fetched in
	 * every mode, and the totals come from whichever window is being shown - so
	 * they are stored separately and laid out together here.  Laying them out in
	 * one pass is the point: two rows would each share out their own width, and
	 * six boxes in one against four in the other cannot come out equally wide. */
	renderStrip: function() {
		if (!this.statusEl) return;
		var a = this.statBits || [], b = this.sumBits || [], bits = a.concat(b);
		var self = this;
		if (!this.statRows) this.statRows = [];
		if (!this.statSep) this.statSep = el('div', { 'class': 'tf-stat-sep' });
		bits.forEach(function(x, i) {
			var r = self.statRows[i];
			if (!r) {
				var v = el('span', { 'class': 'tf-stat-val' });
				r = { v: v, k: null, tip: null, cls: null,
					row: el('div', { 'class': 'tf-stat' }, [
						el('span', { 'class': 'tf-stat-cap' }), v
					]) };
				r.k = r.row.firstChild;
				self.statRows[i] = r;
			}
			setText(r.k, x.k);
			setText(r.v, x.v);
			/* a shortened value keeps its exact form in the tooltip, so nothing
			 * is lost by showing it short */
			var tip = x.title || '';
			if (r.tip !== tip) { r.tip = tip; r.row.setAttribute('title', tip); }
			var cls = 'tf-stat-val' + (x.warn ? ' tf-warn' : '') + (x.mono ? ' tf-mono' : '');
			if (r.cls !== cls) { r.cls = cls; r.v.className = cls; }
		});
		while (this.statRows.length > bits.length) {
			var extra = this.statRows.pop();
			if (extra.row.parentNode) extra.row.parentNode.removeChild(extra.row);
		}
		/* The two sets are drawn by different callers, so one that grows after
		 * the other is already in the DOM would otherwise append its new boxes
		 * past the separator instead of before it.  Re-appending only what is
		 * out of place costs one comparison per box. */
		var want = [], i;
		for (i = 0; i < a.length; i++) want.push(this.statRows[i].row);
		if (a.length && b.length) want.push(this.statSep);
		for (i = a.length; i < bits.length; i++) want.push(this.statRows[i].row);
		for (i = 0; i < want.length; i++) {
			if (this.statusEl.children[i] !== want[i])
				this.statusEl.insertBefore(want[i], this.statusEl.children[i] || null);
		}
		/* The stylesheet hides this card on a phone, where ten boxes cannot fit -
		 * but a stale or dead collector has to stay visible, and the state box is
		 * the only thing that says so.  The class is what lets the stylesheet bring
		 * back just that one box.  A selector like :has() would say it in CSS alone
		 * and is exactly the kind of thing this page avoids, since the reason it
		 * uses no flex gap is a Safari that lacks it. */
		var warn = false;
		for (i = 0; i < bits.length; i++) if (bits[i].warn) warn = true;
		var cls = 'tf-card tf-stat-card' + (warn ? ' tf-stat-warn' : '');
		if (this.statCardEl && this.statCardEl.className !== cls)
			this.statCardEl.className = cls;
	},

	/* The window's own totals: the four readings that describe whatever range is
	 * on screen rather than the collector.  Callers pass caption/value pairs, the
	 * same shape the note line takes; the strip itself works in k/v, so the two
	 * names meet here rather than at every call site. */
	drawSummary: function(list) {
		var hour = this.hourLabel;
		this.sumBits = (list || []).map(function(x) {
			var b = { k: x.cap, v: x.val, warn: x.warn, title: x.title, mono: x.mono };
			/* the archived-hour count is the reading the current bucket belongs
			 * to, so the bucket label hangs off it rather than taking a card */
			if (hour && x.cap === _('Bucket'))
				b.title = _('Current hour') + ': ' + hour;
			return b;
		});
		this.renderStrip();
	},

	/* Everything else: the readings that only exist in the session view, and the
	 * ones that are only present while something is wrong or still settling.
	 * They are notes rather than boxes - see the strip rules in the stylesheet -
	 * and the line hides itself when there is nothing to say.
	 *
	 * Two sources write here, for the same reason as the strip: the collector's
	 * own conditions and the window's rates are produced by different callers.
	 * Each keeps its list and this lays the two out together. */
	drawDiag: function(list) {
		this.viewDiag = list || [];
		this.renderDiag();
	},

	renderDiag: function() {
		if (!this.diagEl) return;
		var self = this;
		var list = (this.statDiag || []).concat(this.viewDiag || []);
		if (!this.diagRows) this.diagRows = [];
		list.forEach(function(d, i) {
			var r = self.diagRows[i];
			if (!r) {
				var v = el('span', { 'class': 'tf-diag-val' });
				r = { v: v, k: null, tip: null, cls: null,
					row: el('span', { 'class': 'tf-diag-item' }, [
						el('span', { 'class': 'tf-diag-cap' }), v
					]) };
				r.k = r.row.firstChild;
				self.diagRows[i] = r;
				self.diagEl.appendChild(r.row);
			}
			setText(r.k, d.cap);
			setText(r.v, d.val);
			var tip = d.title || '';
			if (r.tip !== tip) { r.tip = tip; r.row.setAttribute('title', tip); }
			var cls = 'tf-diag-val' + (d.warn ? ' tf-warn' : '');
			if (r.cls !== cls) { r.cls = cls; r.v.className = cls; }
		});
		while (this.diagRows.length > list.length) {
			var extra = this.diagRows.pop();
			if (extra.row.parentNode) extra.row.parentNode.removeChild(extra.row);
		}
		this.diagCardEl.style.display = list.length ? '' : 'none';
	},

	/* The strip's first six boxes, plus a note line and the strip's own two
	 * conditional readings.  A single strip that explains the state of the
	 * collector.  Without it an empty page is a dead end: the reader cannot tell
	 * "no traffic yet" from "the service is not running" or "the query log path
	 * is wrong". */
	drawStatus: function(s, items, sessionScope) {
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

		/* The six that are always there, in this order, so the strip does not
		 * reshuffle itself as the collector's state changes. */
		var bits = [
			{ k: _('State'), v: state, warn: warn },
			{ k: _('Interval'), v: iv ? iv + 's' : '—' },
			{ k: _('Flows'), v: String(Number(s.flows) || 0) },
			{ k: _('Host names'), v: String(Number(s.dnsmap_lines) || 0) },
			/* which layer is producing the client totals: the nft counters see
			   every packet, the conntrack fallback only what the connection table
			   knows.  A fallback is not an error, but it must not look like one
			   and the same page, or a silent degradation reads as "the network
			   got quiet". */
			{ k: _('Client totals'), v: s.acct ? _('nft counters') : _('conntrack'),
			  warn: !s.acct && !!s.acct_error },
			/* which collector build is running: the first thing to check when a
			   fix does not seem to be in effect after installing the package */
			{ k: _('Collector version'), v: s.version || '—', mono: !!s.version }
		];

		/* The rest are conditions rather than readings - they come and go with
		 * the state of the box - so they go on the note line, where a long value
		 * (an error string, the hour label) costs nothing the way it would in a
		 * box of fixed width. */
		var diag = [];
		if (Number(s.pending) > 0)
			diag.push({ cap: _('Waiting to resolve'), val: String(Number(s.pending)), warn: true });
		if (!s.acct && s.acct_error)
			diag.push({ cap: _('Counter error'), val: s.acct_error, warn: true });
		/* The counters hang on the netfilter hooks and the firewall offloads: the
		 * forwarded traffic bypasses them, so the attribution is a fraction of
		 * what the box actually carried.  Said out loud, because nothing else on
		 * the page looks wrong when it happens.
		 *
		 * The gate used to be acct_offload, which the shipped auto mode never
		 * sets - the collector turns the nft counters off when it sees offloading
		 * - so the warning could not fire on the router it was written for.  The
		 * collector reports the condition itself now, in s.offload.
		 *
		 * Which wording is true depends on what the cards are showing: in the
		 * session view the totals come from the interface counters and are exact,
		 * in a ranged view they are the range's attributed bytes and nothing
		 * more.  One sentence for both would be a new wrong number in the place
		 * this fix is about. */
		/* The hour being accumulated is not a note.  It is a raw bucket label
		 * ("2026-09-17T10") that no reader acts on, and as a note it put a whole
		 * card at the bottom of every ordinary page load carrying nothing else -
		 * which is the one thing the note card was not for.  The question it does
		 * answer, which hour is being written, is worth keeping, so it rides as
		 * the tooltip on the 周期 box where it costs no space at all. */
		this.hourLabel = s.hour || '';

		this.statBits = bits;
		this.statDiag = diag;
		this.renderStrip();
		this.renderDiag();
	},

	/* The rate under 下载/上传: the difference between two consecutive snapshots
	 * over the time between them, so it is the speed right now.
	 *
	 * This used to be computed in the session view only, while the ranged view
	 * replaced it with the window's average.  That average hardly moves on a busy
	 * router: its denominator is the whole range and its numerator only grows as
	 * the archive does, so within one hour the figure is nearly constant - and a
	 * figure under a label that says 下载 is read as "now", which makes a number
	 * that sits still read as a page that has stopped.  Both views show the live
	 * rate now.  The window's own average is not lost: it is the window total
	 * divided by the bucket count, both of which the strip already shows. */
	updateRate: function(s) {
		/* The two figures under 下载/上传 describe the moment, not the window, so
		 * they come from the authoritative counters whenever those exist: an
		 * interface delta is what the box really moved between the two snapshots,
		 * where an attributed delta only counts what the accounting layer saw.
		 * The source is part of the reading - differencing an interface reading
		 * against an attributed one would report the gap between two different
		 * meters as traffic - so a change of source between two snapshots keeps
		 * the previous figure instead. */
		var cur = headlineTotals(s);
		var down = cur.down, up = cur.up;
		/* rates come from the difference between two snapshots */
		if (this.prev) {
			var prev = headlineTotals(this.prev);
			var dt = (Number(s.collected_at) || 0) - (Number(this.prev.collected_at) || 0);
			if (dt > 0 && prev.source === cur.source && down >= prev.down && up >= prev.up)
				this.rate = { down: (down - prev.down) / dt, up: (up - prev.up) / dt };
		}
		this.prev = s;

		/* a plain rate has no window to explain, so the tooltip that described
		 * the ranged view's average goes with the average itself */
		if (this.rateAvg !== false) {
			this.rateAvg = false;
			this.rateDown.removeAttribute('title');
			this.rateUp.removeAttribute('title');
		}
		/* The one-second sampler owns these two numbers while it is working; this
		 * interval rate is the fallback, not a second opinion.  Writing both made
		 * the number flick back to a ten-second average once per snapshot, which
		 * reads as a glitch rather than as a rate. */
		if (this.liveOn) return;
		dom.content(this.rateDown, fmtRate(this.rate.down));
		dom.content(this.rateUp, fmtRate(this.rate.up));
	},

	/* The realtime meter: one call a second, which is also what tells the backend
	 * that somebody is looking.  rpcd writes the timestamp live.sh checks, so
	 * closing the page stops the sampling instead of leaving it running forever.
	 *
	 * These two numbers are the one-second rate in EVERY range.  They used to
	 * depend on the selected range - the session view showed the live rate and
	 * every other range showed a ten-second interval value - and that was a
	 * hidden mode: a page left on the 24-hour range looked like a meter that had
	 * stopped refreshing, twice, to the person using it.  A number that means
	 * something different depending on a control elsewhere on the page is a
	 * worse idea than a number that always means the same thing.  The window
	 * averages are still in the chart's own subtitle, where they belong. */
	pollLive: function() {
		return callLive().then(L.bind(function(r) {
			if (!r || Number(r.ready) !== 1) throw new Error('no live sample yet');
			this.liveMisses = 0;
			this.liveOn = true;
			dom.content(this.rateDown, fmtRate(Number(r.bps_down) || 0));
			dom.content(this.rateUp, fmtRate(Number(r.bps_up) || 0));
		}, this)).catch(L.bind(function() {
			/* Three misses in a row is not a hiccup, it is this build running on
			 * an older backend: hand the two numbers back to the interval rate
			 * instead of freezing them at the last live value. */
			this.liveMisses = (this.liveMisses || 0) + 1;
			if (this.liveMisses >= 3) this.liveOn = false;
		}, this));
	},

	renderLive: function(s) {
		var t = s.totals || {};
		/* The headline of the session: the interface counters when the collector
		 * identified the WAN device, the attributed sum when it did not.  Both
		 * readings here describe the same window - since the collector started -
		 * which is what makes iface usable at all; a ranged view has no interface
		 * counter and must not borrow this one. */
		var head = headlineTotals(s);
		var down = head.down, up = head.up;
		/* The attributed session total: what the application and client rows can
		 * name.  It is the denominator of every share the table and the ring show
		 * - those rows are a breakdown of this sum, not of the traffic the box
		 * carried - and it is not the headline. */
		var accDown = Number(t.down) || 0, accUp = Number(t.up) || 0;
		var accTotal = accDown + accUp;

		var items = (s.apps || []).map(function(a) {
			var d = Number(a.down) || 0, u = Number(a.up) || 0;
			return {
				name: a.name, down: d, up: u, bytes: d + u,
				/* the collector's own marking of a protocol bucket.  It is left
				 * undefined when the collector did not send one, so isProto()
				 * falls back to the name list instead of calling it a real app. */
				proto: (a.proto === undefined ? undefined : Number(a.proto)),
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
		this.drawStatus(s, items, true);

		/* The collector writes a snapshot every interval while the page polls
		 * twice as often, so half the refreshes have nothing new in them: skip
		 * the table and the chart without touching the DOM. */
		var sig = [ Number(s.collected_at) || 0, down, up, items.length ].join('|');
		if (sig === this.lastSig) return;
		this.lastSig = sig;

		/* the live rate, from this snapshot and the one before it; the ranged
		 * view calls the same method so the two agree */
		this.updateRate(s);

		/* The grand-total row carries the busiest client overall.  Its share is
		 * of the attributed total - the same sum the row's own byte columns
		 * describe.  A figure above 100% is not a share at all: the client bytes
		 * and the application bytes come from different counters, so the ratio is
		 * left off rather than printed (it was the source of the 114.7%). */
		var clientTotal = accTotal;
		var topClient = (s.clients && s.clients.length) ? s.clients[0] : null;
		var topText = '—';
		if (topClient && clientTotal > 0) {
			var tb = Number(topClient.bytes) || 0;
			topText = (topClient.name || topClient.ip) + ' ' + fmtBytes(tb) +
				(tb <= clientTotal ? ' (' + (100 * tb / clientTotal).toFixed(1) + '%)' : '');
		}

		this.draw(items, {
			total: head.total, down: head.down, up: head.up,
			totalSource: head.source,
			/* The attributed sum is what the ring's named slices and the table's
			 * rows cover; draw() measures every percentage against the headline
			 * above instead, and shows the difference as 未归属.  It is also
			 * passed split by direction so that row's 下载/上传 columns can be
			 * filled and the three byte columns all reconcile. */
			shareTotal: clientTotal, shareDown: accDown, shareUp: accUp,
			topText: topText,
			/* the grand row's client is the current run's, like the app cells */
			topScope: 'session',
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
		/* The window's boxed readings.  They are the same five in both views so
		 * the strip keeps its shape when the range changes; in the session view
		 * there is no archive bucket count to read, and a dash is the honest
		 * answer rather than a number borrowed from another window.  The last one
		 * counts what the table below is listing, so a window that covers more
		 * applications than the table shows says so instead of quietly leaving
		 * the reader to assume the rows are all of them. */
		this.drawSummary([
			{ cap: _('Bucket'), val: this.archiveEmpty ? '0'
				: (this.archHours === undefined ? '—' : String(this.archHours)) },
			{ cap: _('Browser clients'), val: fmtBytes(all) },
			{ cap: _('Router and tunnel'), val: fmtBytes(t.router) },
			{ cap: _('Devices'), val: String(Number(t.client_count) || 0) },
			/* the applications the table is listing: the protocol buckets are not
			 * applications and no longer sit in that table */
			{ cap: _('Apps'), val: String(items.filter(function(a) { return !isProto(a); }).length) }
		]);

		/* The two numbers that belong together: what the box carried (the
		 * interface counters, and the headline above) and what the attribution
		 * could name (totals, and every byte in the table).  Their ratio is the
		 * one reading that says how much of the traffic the app and client lists
		 * actually explain - a few percent under flow offloading, where before
		 * the page showed the fraction as if it were the whole.  It is a session
		 * reading on both sides, so it belongs to this view and not to a range. */
		var diag = [];
		var ifc = s.iface;
		var carried = ifc ? (Number(ifc.down) || 0) + (Number(ifc.up) || 0) : 0;
		if (carried > 0) {
			var share = accTotal / carried;
			diag.push({ cap: _('Attributed'), val: (100 * share).toFixed(1) + '%',
				title: _('share of the traffic the router carried that the app and client accounting could name'),
				warn: share < 0.5 });
		}
		/* How much of the traffic the page managed to name, which is the only
		 * reading that says whether the DNS lookup is working at all. */
		diag.push(
			{ cap: _('Domain identified'), val: pct(named),
			  title: _('by client DNS') + ': ' + pct(namedE) + ', ' + _('by any client DNS') + ': ' + pct(namedA) },
			{ cap: _('Categorised'), val: pct(bucket) },
			{ cap: _('Other'), val: pct(residual), warn: true }
		);
		if (acctAll > 0) {
			diag.push({ cap: _('Counter total'), val: fmtBytes(acctAll),
				title: _('every packet counted at the LAN interface, proxied traffic included') });
			diag.push({ cap: _('Accounted share'), val: (100 * all / acctAll).toFixed(1) + '%',
				warn: all / acctAll < 0.5 });
		}
		this.drawDiag(diag);

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
				if (!agg[k]) agg[k] = { name: k, down: 0, up: 0, top: '', top_bytes: 0, clients: undefined };
				agg[k].down += Number(a.down) || 0;
				agg[k].up += Number(a.up) || 0;
				/* The busiest client of this application, which the archive only
				 * started recording recently; across the hours the one with the most
				 * bytes wins.  The client count is the largest single hour rather
				 * than a sum: the archive has no way to tell whether the same device
				 * was counted in two hours, and a sum would overstate it. */
				var tb = Number(a.top_bytes) || 0;
				if (a.top && tb >= (agg[k].top_bytes || 0)) {
					agg[k].top = a.top;
					agg[k].top_bytes = tb;
				}
				if (a.clients !== undefined) {
					var n = Number(a.clients) || 0;
					if (agg[k].clients === undefined || n > agg[k].clients) agg[k].clients = n;
				}
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

		/* The range in the device counters, which is what the box actually
		 * carried: since 0.1.91 roll_hour archives one "wan" row per hour, and
		 * the backend publishes it on the bucket as iface.  This is the range's
		 * own reading - never summary.iface, which is the session cumulative
		 * count from /proc/net/dev and would be a session figure under a 7-day
		 * label, the exact mix-up this page is being fixed for.
		 *
		 * Only a range the archive covers hour for hour can be totalised this
		 * way.  An archive written before the interface rows existed has none
		 * of them, and a range that mixes the two would sum device counters for
		 * some hours and a partial attribution for others - a number smaller
		 * than the attribution it replaces, presented as a total.  So the
		 * reading is used only when every bucket carries it, and otherwise the
		 * attributed sum stands, labelled 已归属 as it was before. */
		var ifDown = 0, ifUp = 0, ifHours = 0;
		hours.forEach(function(b) {
			var f = b && b.iface;
			if (!f) return;
			var d = Number(f.down), u = Number(f.up);
			if (!isFinite(d) || !isFinite(u) || d < 0 || u < 0) return;
			ifDown += d; ifUp += u; ifHours++;
		});
		var ifaceRange = (ifHours > 0 && ifHours === hours.length);
		var headDown = ifaceRange ? ifDown : gd;
		var headUp = ifaceRange ? ifUp : gu;
		var headTotal = headDown + headUp;

		/* The clients are summed across the hours the same way the applications
		 * are, so the two grand-total columns mean here what they mean in the
		 * session view: the busiest device of the range and how many devices
		 * moved anything in it.  The per-application columns stay empty on
		 * purpose - "which client drove this application" is not a question an
		 * hour's totals can answer, and a guess would be worse than the dash. */
		var cl = Object.keys(clAgg).map(function(ip) {
			return { ip: ip, bytes: clAgg[ip] };
		}).sort(function(a, b) { return b.bytes - a.bytes; });
		/* The share is of the client total, not of the application total.  The two
		 * are different sums - a client carries bytes no application row accounts
		 * for, the tunnel and anything the DNS correlation could not name - so
		 * dividing by the application total reported the busiest client as using
		 * more than all of the traffic (144.8% on a real page). */
		var clTotal = cl.reduce(function(s, c) { return s + c.bytes; }, 0);
		var topText = '—';
		if (cl.length && clTotal > 0) {
			topText = cl[0].ip + ' ' + fmtBytes(cl[0].bytes) +
				' (' + (100 * cl[0].bytes / clTotal).toFixed(1) + '%)';
		}
		this.draw(items, {
			/* The range's own total, from the device counters when the archive
			 * carries them for every hour the range covers - that is when it is
			 * really 总计 - and from the range's attributed bytes otherwise,
			 * which draw() then labels 已归属.  summary.iface is deliberately NOT
			 * used here: it is a session cumulative count from /proc/net/dev,
			 * and showing that under a 7-day label would be a new wrong number
			 * of exactly the kind this page is being fixed for. */
			total: headTotal, down: headDown, up: headUp,
			totalSource: ifaceRange ? 'iface' : 'totals',
			/* The attributed sum - the range's own application rows - is what the
			 * ring's named slices cover and what the protocol block is a share
			 * of; every percentage the page prints is measured against the
			 * headline instead, and 未归属 carries the difference.  When the
			 * archive carries no device counters the two are the same number, the
			 * difference is zero, and the ring is exactly what it was before. */
			shareTotal: total, shareDown: gd, shareUp: gu,
			topText: topText, clientCount: cl.length,
			/* this row's client comes from the range's own client rows, so the
			 * cell must not claim to be the current run's */
			topScope: 'range'
		});
		/* The two rates are deliberately not written here.  They describe the
		 * sampling interval rather than the window, exactly as in the session
		 * view, and refresh() keeps them current through updateRate().  Dividing
		 * the window's bytes by the window's length, which is what this used to
		 * do, gave a figure that barely moved - and next to a total that does
		 * move, a rate that does not reads as a stalled page. */
		/* The footer says what the range held, from what the history actually
		 * keeps: the number of buckets, the client bytes, the tunnel and how many
		 * devices moved them.  The identification rates below are not here
		 * because the history does not store them - those counters live in the
		 * session, and inventing a range figure out of a session one is exactly
		 * the kind of number this page should not show. */
		var rt = 0;
		hours.forEach(function(b) { rt += Number(b.router) || 0; });
		this.drawSummary([
			{ cap: _('Bucket'), val: String(hours.length) },
			{ cap: _('Browser clients'), val: fmtBytes(total) },
			{ cap: _('Router and tunnel'), val: fmtBytes(rt) },
			{ cap: _('Devices'), val: String(cl.length) },
			{ cap: _('Apps'), val: String(items.filter(function(a) { return !isProto(a); }).length) }
		]);
		/* nothing to add here: every note this view has is already in the strip */
		this.drawDiag([]);
	},

	draw: function(items, stats) {
		/* Protocol buckets are not applications.  They are the transport or the
		 * infrastructure label the attribution falls back to, and listed among
		 * the applications they read as if an app called "QUIC" had been used.
		 * They keep their share of the ring above, where the composition of the
		 * whole total is the point; the table below lists applications, so
		 * they are drawn in their own block under it. */
		var apps = items.filter(function(a) { return !isProto(a); });
		var protos = items.filter(isProto);

		/* one palette assignment for everything drawn this round, so the donut,
		 * the legend and the table cannot disagree about a colour */
		colorMap = assignColors(items.slice(0, 30));
		/* the headline: what the box carried in the session view, or the window's
		 * own total in a ranged view */
		var total = stats.total;
		/* What the app and client accounting could name: the sum the table's own
		 * rows are part of, and the part of the total the ring's named slices
		 * cover.  The remainder of the total is the slice that says so. */
		var shareTotal = (stats.shareTotal === undefined) ? total : stats.shareTotal;
		/* the same two numbers split by direction, so the 未归属 row can fill the
		 * 下载/上传 columns instead of leaving them short */
		var shareDown = (stats.shareDown === undefined) ? stats.down : stats.shareDown;
		var shareUp = (stats.shareUp === undefined) ? stats.up : stats.shareUp;
		/* 总计 is only true when the number really is everything the box carried;
		 * otherwise the reading is the attributed sum and says so. */
		var exact = stats.totalSource === 'iface';
		var self = this;

		/* The ring is the whole window, not the named part of it: the ten named
		 * applications, 其余应用, and one slice for what nothing could name.  Its
		 * 100% is therefore the same number the headline and the table's first
		 * row show - which is the point of drawing it this way.  The ring used to
		 * be 100% of the *attributed* sum while the row above it read 7.32 GiB,
		 * so SSL/TLS was 46.1% of one number and 17.5% of the other on the same
		 * card, with nothing on the page saying which 100% it meant.
		 *
		 * 其余应用 is shareTotal minus the top ten, not the literal sum of ranks
		 * 11 and below.  The two are the same number whenever the publisher sent
		 * every application - the collector sends the top 300 - and taking the
		 * difference is what keeps the ring closed by construction when it did
		 * not: the gap the rest slice was added to remove would come back, only
		 * wider, if the slices were summed from a list that stops short. */
		var top = items.slice(0, 10);
		var topSum = 0;
		for (var ti = 0; ti < top.length; ti++) topSum += top[ti].bytes;
		var restBytes = Math.max(shareTotal - topSum, 0);
		var unattrBytes = Math.max(total - shareTotal, 0);
		var ring = top.slice();
		if (restBytes > 0) ring.push({ name: _('Other apps'), bytes: restBytes, rest: 1 });
		/* the marker is what gives this slice its neutral grey: it is not an
		 * application and must not borrow an application's colour, and the slice
		 * is drawn from a translated name, so hashing the name would not do */
		if (unattrBytes > 0) ring.push({ name: _('Unattributed'), bytes: unattrBytes, rest: 1, unattr: 1 });

		/* Everything below updates what is already on the page rather than
		 * replacing it.  Only structure that genuinely changed (a new
		 * application, a different order) touches the DOM tree. */
		if (!this.rowCache) { this.rowCache = {}; this.rowNames = []; this.legendCache = {}; }

		setText(this.totalEl, fmtBytes(total));
		if (this.heroCapEl) setText(this.heroCapEl, exact ? _('total') : _('Attributed'));

		/* The ring is the answer the ring center is a breakdown of, so it sits in
		 * the hole rather than only in the hero above.  It moves on every refresh,
		 * which is why it is its own node: folding it into the SVG would mean
		 * rebuilding the ring on every poll to change one line of text.  Its
		 * reading is the total the slices are measured against - the headline
		 * number, whatever that is - and its caption names that number the same
		 * way the headline does. */
		setText(this.donutTotalEl, fmtBytes(total));
		if (this.donutCapEl) setText(this.donutCapEl, exact ? _('total') : _('Attributed'));
		var off = (this.donutEl.className.indexOf('tf-donut-off') >= 0);
		if ((total <= 0) !== off)
			this.donutEl.className = total > 0 ? 'tf-donut' : 'tf-donut tf-donut-off';

		/* donut: redrawn only when its composition changed, not when the bytes
		 * behind the slices moved */
		var donutSig = ring.map(function(a) {
			return a.name + ':' + (total ? Math.round(1000 * a.bytes / total) : 0);
		}).join('|');
		if (donutSig !== this.donutSig) {
			this.donutSig = donutSig;
			dom.content(this.donutFigEl, makeDonut(ring, total));
		}

		/* legend, keyed by name so the rows survive a reshuffle.  It lists every
		 * slice of the ring, 其余应用 and 未归属 included: a key that leaves out
		 * the largest slice is not a key, and one that lists only the top ten
		 * cannot add up to the 100% the ring itself is measured in. */
		var legendSeen = {};
		ring.forEach(function(a) {
			legendSeen[a.name] = 1;
			var lr = self.legendCache[a.name];
			if (!lr) {
				lr = makeLegendRow(a.name, isProto(a), a.unattr ? UNATTR_COLOR : null);
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
		/* ring is the top ten followed by the two aggregate slices, so this is the
		 * order the ring draws as well: the named rows, then the ones that are
		 * not applications */
		ring.forEach(function(a) {
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
			/* the label follows the same rule as the hero caption: 所有流量 only
			 * while the row's figures are the whole of what the box carried */
			var glabel = el('span', { 'class': 'tf-app-name' }, [ _('All traffic') ]);
			this.grandRow = {
				tr: el('tr', { 'class': 'tf-grand' }, [
					el('td', { 'class': 'tf-app' }, [ glabel ]),
					gc.total, gc.down, gc.up, gc.top, gc.clients
				]),
				label: glabel,
				cells: gc
			};
			this.rowsEl.appendChild(this.grandRow.tr);
		}
		setText(this.grandRow.label, exact ? _('All traffic') : _('Attributed'));
		setText(this.grandRow.cells.total, fmtBytes(total));
		setText(this.grandRow.cells.down, fmtBytes(stats.down));
		setText(this.grandRow.cells.up, fmtBytes(stats.up));
		setText(this.grandRow.cells.top, stats.topText || '—');
		/* The grand row's client belongs to the window the row itself describes -
		 * the current run in the session view, the selected range in a ranged one
		 * (the archived client rows) - while the per-application cells above it
		 * are always the current run.  The column says which one, and so does the
		 * cell, so neither window is read as the other. */
		this.grandRow.cells.top.setAttribute('title', stats.topScope === 'range'
			? _('the busiest client of the selected range, from the archived client rows')
			: _('the busiest client overall, for the current run'));
		setText(this.grandRow.cells.clients, stats.clientCount === undefined ? '—' : String(stats.clientCount));

		/* the 300 heaviest applications, each row created once and then only
		 * nudged: this is what keeps a page open for hours flat in memory.  The
		 * ceiling matches the number the collector publishes (top_apps), so the
		 * session view is never showing fewer rows than the page is willing to
		 * draw; the ranged view builds its own rows from the archive, which
		 * keeps every application it saw.  Only applications: the protocol
		 * buckets are not rows of this table. */
		var wanted = apps.slice(0, 300);
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

		if (!apps.length && !protos.length && !this.emptyRow) {
			this.emptyRow = el('tr', {}, [ el('td', { 'colspan': 6, 'class': 'tf-empty' }, [ _('No traffic recorded yet.') ]) ]);
			this.rowsEl.appendChild(this.emptyRow);
		}
		else if ((apps.length || protos.length) && this.emptyRow) {
			if (this.emptyRow.parentNode) this.emptyRow.parentNode.removeChild(this.emptyRow);
			this.emptyRow = null;
		}

		/* The row that reconciles the table with the total above it.  The rows
		 * below add up to the grand row only when the part of the total nothing
		 * could name is a row of its own; without it the reader sees 7.32 GiB,
		 * a list that adds to 2.78 GiB, and no explanation.
		 *
		 * It sits directly under the grand total - the row it is the remainder of
		 * - and not at the foot of a ranked list that can be 300 rows long, where
		 * the number it reconciles with is a screen away.  It is not an
		 * application, so it carries no icon: it lines up with 所有流量 instead,
		 * the other row that is about the total rather than about one app.
		 *
		 * Its 下载/上传 split is derived from the total's so that all three byte
		 * columns reconcile exactly.  The split itself is not something the
		 * accounting knows - these are the bytes that were never attributed - and
		 * a dash in the two columns would have been honest but left them short. */
		if (unattrBytes > 0) {
			if (!this.unattrRow) {
				var uc = {
					total: el('td', { 'class': 'tf-num tf-total' }),
					down:  el('td', { 'class': 'tf-num tf-down' }),
					up:    el('td', { 'class': 'tf-num tf-up' }),
					top:   el('td', { 'class': 'tf-top' }),
					clients: el('td', { 'class': 'tf-num' })
				};
				this.unattrRow = {
					tr: el('tr', { 'class': 'tf-unattr' }, [
						el('td', { 'class': 'tf-app' }, [
							el('span', { 'class': 'tf-app-name' }, [ _('Unattributed') ])
						]),
						uc.total, uc.down, uc.up, uc.top, uc.clients
					]),
					cells: uc
				};
			}
			var uDown = Math.max(stats.down - shareDown, 0);
			var uUp = Math.max(stats.up - shareUp, 0);
			/* the two remainders are the total's remainder whenever the attributed
			 * sum sits inside the total, which is what it does by construction;
			 * the clamp above is what could stop them adding up, and the row must
			 * not contradict its own total cell, so 上传 carries that difference */
			if (uDown + uUp !== unattrBytes) uUp = Math.max(unattrBytes - uDown, 0);
			setText(this.unattrRow.cells.total, fmtBytes(unattrBytes) + ' (' +
				(total ? (100 * unattrBytes / total).toFixed(1) : '0.0') + '%)');
			setText(this.unattrRow.cells.down, fmtBytes(uDown));
			setText(this.unattrRow.cells.up, fmtBytes(uUp));
			setText(this.unattrRow.cells.top, '—');
			setText(this.unattrRow.cells.clients, '—');
			var firstApp = order.length ? self.rowCache[order[0]].tr : null;
			var anchor = firstApp || self.emptyRow || null;
			if (anchor) self.rowsEl.insertBefore(this.unattrRow.tr, anchor);
			else self.rowsEl.appendChild(this.unattrRow.tr);
		}
		else if (this.unattrRow) {
			if (this.unattrRow.tr.parentNode) this.unattrRow.tr.parentNode.removeChild(this.unattrRow.tr);
			this.unattrRow = null;
		}

		/* and the protocol buckets, in their own labelled block under the table */
		this.renderProto(protos, total);
	},

	/* The protocol buckets: real attributed bytes, so the ring above counts them,
	 * but not applications, so they are not rows of the application table.  They
	 * get a muted block of their own under it, with the count and their share of
	 * the page's one total, and something else in the table's place would have to
	 * be a lie about what an application is. */
	renderProto: function(list, total) {
		if (!this.protoEl) return;
		var self = this;
		if (!this.protoRows) this.protoRows = {};

		var rows = list.slice().sort(function(a, b) { return b.bytes - a.bytes; });
		var sum = 0;
		rows.forEach(function(a) { sum += a.bytes; });

		var seen = {};
		rows.forEach(function(a) {
			seen[a.name] = 1;
			var r = self.protoRows[a.name];
			if (!r) {
				var nm = el('span', { 'class': 'tf-proto-name', 'title': a.name }, [ a.name ]);
				var by = el('span', { 'class': 'tf-proto-bytes' });
				r = { name: nm, bytes: by,
					row: el('div', { 'class': 'tf-proto-row' }, [ makeIcon(a.name), nm, by ]) };
				self.protoRows[a.name] = r;
			}
			setText(r.bytes, fmtBytes(a.bytes) + ' (' +
				(total ? (100 * a.bytes / total).toFixed(1) : '0.0') + '%)');
			self.protoListEl.appendChild(r.row);
		});
		Object.keys(this.protoRows).forEach(function(n) {
			if (seen[n]) return;
			var r = self.protoRows[n];
			if (r.row.parentNode) r.row.parentNode.removeChild(r.row);
			delete self.protoRows[n];
		});

		if (this.protoSumEl)
			setText(this.protoSumEl, rows.length
				? String(rows.length) + ' · ' + fmtBytes(sum)
				: '');
		this.protoEl.style.display = rows.length ? '' : 'none';
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
		/* The card surface, the two traffic colours and the secondary text are the
		 * design's palette.  They are written as rgba() rather than as the
		 * 8-digit hex the design shows (#FFFFFFCC, #2C2C2ECC): the colours are
		 * identical and rgba() is what every browser this page targets
		 * understands, including the older Safari the layout works around. */
		'--tf-card:rgba(255,255,255,.8);--tf-card-brd:rgba(255,255,255,.75);',
		'--tf-chip:rgba(140,160,180,.16);--tf-menu:rgba(255,255,255,.99);',
		/* Every line, tint and shadow on this page comes from a variable, so a
		 * theme that paints its dark mode some way this page cannot name still
		 * gets a page that is dark all through.  A hardcoded colour is what left
		 * a light table on a dark page. */
		'--tf-line:rgba(128,150,175,.20);--tf-tint:rgba(10,132,255,.07);',
		'--tf-icon-shadow:0 2px 6px rgba(31,66,102,.18);',
		'--tf-fg:var(--font-color,#20303d);--tf-dim:#68727c;',
		'--tf-shadow:0 6px 22px rgba(31,66,102,.10);',
		'--tf-down:#0a84ff;--tf-up:#30d158;',
		'--tf-area-down:rgba(10,132,255,.13);--tf-area-up:rgba(48,209,88,.11);',
		/* width, not just flex:1: the page is a flex item in the wrapper LuCI
		 * puts a view in, and as one it was sized by its own content.  With the
		 * cards laid out inside it that came out circular - the halves took
		 * their width from the page and the page from them - and the whole thing
		 * collapsed to a narrow column. */
		'width:100%;margin:-.4rem 0 0;color:var(--tf-fg);',
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
		'display:block;}',
		/* A plain block column, with the one side-by-side part stated locally in
		 * .tf-mid below.
		 *
		 * It used to be a single wrapping flex container with the cards placed by
		 * order, and on the router that came apart.  A flex container whose own
		 * width is not definite does not wrap at all, so every card went on one
		 * line - the full-width strip, the two halves, then the table, running off
		 * the right of the screen - and the line was then as tall as its tallest
		 * card, which is why the others stretched into huge empty boxes.  Block
		 * layout has no such failure mode: block children fill the width they are
		 * given, whatever that turns out to be. */
		/* One wrapping row holding the strip and the chart-and-ring pair: the strip
		 * is 100%, so it takes a line of its own and the two halves share the next.
		 * They are a row rather than three blocks because the two halves have to
		 * sit side by side and be the same height. */
		'.tf-page .tf-mid{display:flex;flex-wrap:wrap;align-items:stretch;}',
		/* The whole layout is sized in percentages and in flex-basis, and both are
		 * only arithmetic that adds up under border-box: with the content box,
		 * flex-basis:6.25rem means 100px of text plus the padding, so ten boxes
		 * needed 1244px inside a 1152px card and the tenth wrapped onto a row of
		 * its own - and the two 50% cards, each 36.8px wider than half, stopped
		 * fitting beside each other.  The theme sets this globally and every other
		 * page leans on that; this page states it for its own subtree so it does
		 * not depend on which theme happens to be installed. */
		'.tf-page,.tf-page *,.tf-page *:before,.tf-page *:after{box-sizing:border-box;}',
		'.tf-page .tf-stat-card{order:1;flex:0 0 100%;}',
		'.tf-page .tf-chart-card{order:2;flex:0 0 calc(50% - .5rem);max-width:calc(50% - .5rem);',
		'margin-right:1rem;}',
		'.tf-page .tf-donut-card{order:3;flex:0 0 calc(50% - .5rem);max-width:calc(50% - .5rem);}',

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
		'.tf-page .tf-hero{display:flex;align-items:flex-end;gap:1.4rem;flex-wrap:wrap;',
		'position:relative;z-index:5;}',
		/* The hero used to paint its own cyan-to-violet wash over the card.  The
		 * design gives it the same glass surface as every other card and lets the
		 * size of the number carry the emphasis, so the wash is gone: the palette
		 * has no violet in it, and a second material for one card is the opposite
		 * of the layered-but-uniform look the design asks for. */
		/* The three captions sit on one line and the three readings on the next,
		 * so the hero reads as a label row over a value row.  Pairing each
		 * caption with its own reading in a column reads worse: with the bottoms
		 * aligned - which is what makes the numbers share a line - a 1.7rem line
		 * box and a 1.05rem one do not start at the same y, so the three captions
		 * come out at three different heights.  Aligning them by row fixes that,
		 * and the column widths are the same either way. */
		'.tf-page .tf-hero-stats{display:grid;grid-template-columns:repeat(3,auto);',
		'align-items:end;column-gap:1.6rem;row-gap:.1rem;}',
		/* The hairline the design draws between the two traffic readings.  It is a
		 * grid item rather than a border or an absolutely placed box: a border on
		 * the cells would come out as two stubs, one under the caption and one
		 * under the figure, and the rows have no fixed height to position against.
		 * Placing it in the caption's own column, pushed to that column's end and
		 * pulled back by half the gap, puts it in the middle of the gap spanning
		 * both rows - here between columns two and three, which is 下载 and 上传.
		 * The narrow layout moves the same element to the rows the rates occupy on
		 * a phone, so every width gets the same line between the same two.
		 *
		 * Every child is placed explicitly because of it.  A grid item - and a
		 * pseudo-element counts as one - claims its cells, and auto flow then has
		 * to steer around them: the six readings are emitted captions-first, so
		 * with the hairline holding column two's two rows the rest packed into
		 * columns one and three and the hero came apart, which the desktop render
		 * showed before this. */
		'.tf-page .tf-hero-stats>*:nth-child(1){grid-area:1/1;}',
		'.tf-page .tf-hero-stats>*:nth-child(2){grid-area:1/2;}',
		'.tf-page .tf-hero-stats>*:nth-child(3){grid-area:1/3;}',
		'.tf-page .tf-hero-stats>*:nth-child(4){grid-area:2/1;}',
		'.tf-page .tf-hero-stats>*:nth-child(5){grid-area:2/2;}',
		'.tf-page .tf-hero-stats>*:nth-child(6){grid-area:2/3;}',
		'.tf-page .tf-hero-stats::after{content:"";grid-area:1/2/3/3;',
		'justify-self:end;align-self:stretch;width:1px;margin-right:-.8rem;',
		'background:var(--tf-line);}',
		'.tf-page .tf-grand-total{font-size:1.7rem;font-weight:700;line-height:1.1;letter-spacing:.4px;',
		'font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-hero-cap{font-size:.74rem;color:var(--tf-dim);letter-spacing:.04em;}',
		'.tf-page .tf-rate{display:flex;align-items:baseline;gap:.35rem;font-size:1.05rem;',
		'font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-rate b{font-size:1.05rem;font-weight:600;}',
		'.tf-page .tf-rate-arrow{font-size:1rem;}',
		'.tf-page .tf-rate-down .tf-rate-arrow,.tf-page .tf-rate-down b{color:var(--tf-down);}',
		'.tf-page .tf-rate-up .tf-rate-arrow,.tf-page .tf-rate-up b{color:var(--tf-up);}',
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
		'.tf-page .tf-chart-legend .tf-lg-down i{background:var(--tf-down);}',
		'.tf-page .tf-chart-legend .tf-lg-up i{background:var(--tf-up);}',
		'.tf-page .tf-chart-svg{display:block;width:100%;height:auto;max-height:190px;}',
		'.tf-page .tf-chart-tick{font-size:9px;fill:var(--tf-dim);}',
		'.tf-page .tf-chart{position:relative;}',
		'.tf-page .tf-chart-empty{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);',
		'text-align:center;color:var(--tf-dim);font-size:.85rem;pointer-events:none;}',

		/* One strip of identical boxes: the collector's own state and the totals
		 * of the selected window, in a single row.  They used to be two cards
		 * with two rows of chips of different widths, which read as two unrelated
		 * things rather than as one band of readings.  One flex line is also what
		 * keeps the boxes the same size: two rows would each share out their own
		 * width, and six boxes in one against four in the other cannot come out
		 * equally wide.
		 *
		 * flex-basis with grow rather than a fixed width, so the row ends flush
		 * with the card instead of leaving a ragged gap on a wide screen, and
		 * min-width keeps a box from ever being squeezed under its own label. */
		'.tf-page .tf-stat-card{padding:.85rem 1.15rem;}',
		'.tf-page .tf-stat-strip{display:flex;flex-wrap:wrap;align-items:stretch;gap:.5rem;}',
		/* .35rem of side padding rather than .5: at the 6.25rem minimum width the
		 * longest English caption ("Router and tunnel") measures 87px against the
		 * 84px that .5rem leaves, so it ellipsised.  The Chinese labels are two to
		 * six characters and were never near the edge. */
		/* max-width is what keeps the boxes the same size.  With grow alone they
		 * are equal only while the row is full: as soon as the last row has fewer
		 * boxes they share that whole row between them, and a 10-box strip on a
		 * 1024px screen ended with two boxes 449px wide against the first row's
		 * 105.  Capping the growth means every box is between 6.25 and 6.75rem at
		 * every width - 103px on a 1200px screen, 108 on a phone, where the rows
		 * come out equal instead of merely full. */
		'.tf-page .tf-stat{flex:1 1 6.25rem;min-width:6.25rem;max-width:6.75rem;',
		'display:flex;flex-direction:column;',
		'align-items:center;justify-content:center;text-align:center;gap:.05rem;',
		'padding:.4rem .35rem;background:var(--tf-chip);border-radius:12px;}',
		/* the two sets are not the same kind of reading, so a hairline divides them */
		'.tf-page .tf-stat-sep{flex:0 0 1px;align-self:stretch;margin:.2rem .1rem;background:var(--tf-line);}',
		/* No text-transform: the labels are mostly Chinese, which it cannot touch
		 * anyway, so forcing upper case only made the few English ones (the
		 * collector version among them) look like a different kind of label.
		 *
		 * The caption is allowed to wrap rather than being cut with an ellipsis.
		 * The boxes are sized for the Chinese labels, which are two to six
		 * characters; the longest English ones ("Router and tunnel", "Collector
		 * version") are wider than a box, and "Collector versi…" is a label the
		 * reader has to guess at.  Wrapping costs one line of height in English
		 * and nothing in Chinese, and the boxes stay equal because they stretch.
		 * The value below never wraps: a number split across two lines is worse
		 * than one that is cut. */
		'.tf-page .tf-stat-cap{font-size:.7rem;color:var(--tf-dim);letter-spacing:.03em;',
		'max-width:100%;overflow-wrap:break-word;}',
		'.tf-page .tf-stat-val{font-size:.86rem;font-weight:600;font-variant-numeric:tabular-nums;',
		'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}',
		/* Long values (a query log path, the box own addresses) are normal text,
		 * not code: monospace here made two entries of one row look like they
		 * came from a different font, and read worse at this size. */
		'.tf-page .tf-mono{font-family:inherit;font-weight:600;font-size:.86rem;}',
		/* The readings that are conditional - present only while a counter is on
		 * a fallback, or while names are still resolving - and the ones that only
		 * exist in the session view are a note under the table rather than more
		 * boxes.  In the strip they would make the row longer than the ten boxes
		 * it is designed for, and a strip whose length changes with the state of
		 * the collector is a strip nobody can read at a glance. */
		'.tf-page .tf-diag-card{padding:.55rem 1.15rem;}',
		'.tf-page .tf-diag{display:flex;flex-wrap:wrap;align-items:baseline;gap:.15rem 1.1rem;',
		'font-size:.75rem;color:var(--tf-dim);font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-diag-item{display:inline-flex;align-items:baseline;gap:.35rem;min-width:0;}',
		'.tf-page .tf-diag-val{color:var(--tf-fg);font-weight:600;}',

		/* layout: the donut card is a full-width block above the table, so these
		 * are ordinary cards rather than the two flexible columns they used to be */
		'.tf-page .tf-list-card{min-width:0;padding-bottom:.4rem;overflow-x:auto;}',
		'.tf-page .tf-donut-wrap{display:flex;align-items:center;gap:1.1rem 1.6rem;flex-wrap:wrap;}',
		/* the ring is a fixed 168px figure, so it is the positioned box and the
		 * total is laid over its hole - no arc maths and no second copy of the
		 * number inside the SVG */
		'.tf-page .tf-donut{position:relative;flex:0 0 168px;width:168px;height:168px;}',
		'.tf-page .tf-donut-center{position:absolute;left:0;right:0;top:0;bottom:0;',
		'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.05rem;',
		'text-align:center;pointer-events:none;}',
		'.tf-page .tf-donut-total{font-size:1.05rem;font-weight:700;letter-spacing:-.02em;',
		'font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-donut-cap{font-size:.72rem;color:var(--tf-dim);}',
		/* with nothing recorded the ring is empty and says so, and a "0 B" over
		 * that message would be two answers to the same question */
		'.tf-page .tf-donut-off .tf-donut-center{display:none;}',
		'.tf-page .tf-donut-svg{display:block;width:168px;height:168px;}',
		'.tf-page .tf-donut-empty{font-size:11px;fill:var(--tf-dim);}',
		/* The ring and the grid are drawn in SVG, where a colour cannot come from
		 * a variable: a presentation attribute has no var().  A class can, and a
		 * CSS rule outranks the attribute, so the literal stays as the fallback
		 * while the variable does the work - which is what keeps the empty ring
		 * and the grid from staying light on a dark page. */
		'.tf-page .tf-ring,.tf-page .tf-grid{stroke:var(--tf-line);}',
		/* The curves and the two fills need the same treatment.  These were the
		 * last hardcoded colours on the page, and they showed: on a dark page the
		 * table numbers and the legend dots came out one shade of blue while the
		 * curve above them stayed the light-mode one. */
		'.tf-page .tf-curve-down{stroke:var(--tf-down);}',
		'.tf-page .tf-curve-up{stroke:var(--tf-up);}',
		'.tf-page .tf-area-down{fill:var(--tf-area-down);}',
		'.tf-page .tf-area-up{fill:var(--tf-area-up);}',

		/* legend: the ten rows spread across the width the card now has, instead
		 * of one narrow column with the rest of the card empty beside it */
		'.tf-page .tf-legend{flex:1 1 22rem;display:grid;min-width:0;',
		'grid-template-columns:repeat(auto-fill,minmax(13rem,1fr));gap:.3rem 1.1rem;}',
		'.tf-page .tf-legend-row{display:flex;align-items:center;gap:.45rem;font-size:.82rem;min-width:0;}',
		/* The legend gets the same marks as the list, miniaturised: at the list
		 * size (26px) they made every legend row twice as tall as the text in it,
		 * which is why the ten rows stopped fitting beside the ring. */
		/* The basis has to fit beside the ring, or the whole legend wraps under it
		 * and the donut card grows a head taller than the chart card next to it.
		 * 22rem (352px) did not fit in a 568px card: 168 of ring + 1.6rem of gap
		 * + 352 is more than the 529px of content, so it wrapped, took the full
		 * width, and split into two columns - the card came out 85px taller than
		 * the one beside it.  16rem leaves room beside the ring, and the legend
		 * then lays out in one column, which is what puts the percentages on a
		 * single right-hand edge instead of two. */
		'.tf-page .tf-legend-box{flex:1 1 16rem;min-width:0;display:flex;flex-direction:column;gap:.4rem;}',
		'.tf-page .tf-legend-box .tf-legend{flex:0 0 auto;}',
		'.tf-page .tf-legend-cap{font-size:.72rem;color:var(--tf-dim);letter-spacing:.04em;}',
		'.tf-page .tf-legend-row .tf-icon,.tf-page .tf-legend-row .tf-icon-img{',
		'width:16px;height:16px;flex:0 0 16px;border-radius:5px;box-shadow:none;}',
		'.tf-page .tf-legend-row .tf-icon-letter{font-size:.58rem;}',
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
		/* the name column was 30% and sat half empty while the busiest-client
		 * column - the one whose content is always the longest - was squeezed.
		 * The widths now follow the content: a name needs room for about twenty
		 * characters, a client reading needs room for "Mac 8.09 MiB (104.2%)" */
		'.tf-page .tf-col-app{width:22%;}',
		'.tf-page .tf-col-total{width:16%;}',
		'.tf-page .tf-col-down{width:13%;}',
		'.tf-page .tf-col-up{width:13%;}',
		'.tf-page .tf-col-top{width:26%;}',
		'.tf-page .tf-col-clients{width:10%;}',
		'.tf-page .tf-table>thead>tr>th{border-bottom:1px solid var(--tf-line);',
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
		'.tf-page .tf-table>tbody>tr{background:transparent;border:none;}',
		/* No rule under the data rows.  A line between every row made the list read
		 * as a stack of boxes, and with 20-odd rows on a dark card the repeated
		 * line was the loudest thing in the table.  Rows are told apart by the
		 * row height and by the hover tint; the header keeps its own rule, which
		 * is what still separates the captions from the data. */
		'.tf-page .tf-table>tbody>tr>td{border:none;',
		'padding:.5rem .6rem;vertical-align:middle;overflow:hidden;background:transparent;}',
		'.tf-page .tf-table>tbody>tr:hover>td{background:var(--tf-tint);}',
		'.tf-page .tf-num{white-space:nowrap;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;}',
		'.tf-page .tf-down{color:var(--tf-down);}',
		'.tf-page .tf-up{color:var(--tf-up);}',
		'.tf-page .tf-total{font-weight:600;}',
		/* the grand total leads the table, so it is tinted rather than roped off */
		'.tf-page .tf-table>tbody>tr.tf-grand>td{background:var(--tf-tint);font-weight:600;}',
		/* the unattributed row sits directly under it and wears the same tint, so
		 * the two read as one band - the total and its remainder - while the dim
		 * name keeps it from reading as a second total */
		'.tf-page .tf-table>tbody>tr.tf-unattr>td{background:var(--tf-tint);}',
		'.tf-page .tf-unattr .tf-app-name{color:var(--tf-dim);}',
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
		/* the same mark on the ring's key, where a protocol bucket would otherwise
		 * look exactly like an application */
		'.tf-page .tf-legend-row.tf-isbucket .tf-legend-name{color:var(--tf-dim);font-style:italic;}',
		/* nowrap on both axes: the tag is two characters wide, and letting it
		 * wrap is what stacked it as 类 over 型 in a narrow row */
		'.tf-page .tf-tag{flex:0 0 auto;white-space:nowrap;margin-left:.15rem;padding:.05rem .34rem;',
		'border-radius:6px;font-size:.62rem;line-height:1.5;',
		'letter-spacing:.04em;color:var(--tf-dim);background:rgba(128,150,175,.16);text-transform:uppercase;}',
		'.tf-page .tf-icon{width:' + ICON + 'px;height:' + ICON + 'px;flex:0 0 ' + ICON + 'px;',
		'border-radius:8px;display:inline-flex;align-items:center;justify-content:center;',
		'box-shadow:var(--tf-icon-shadow);}',
		'.tf-page .tf-icon-letter{color:#fff;font-size:.82rem;font-weight:700;line-height:1;}',
		'.tf-page .tf-icon-img{width:' + ICON + 'px;height:' + ICON + 'px;border-radius:8px;display:block;}',

		'.tf-page .tf-warn{color:#ff8f1f;}',
		'.tf-page .tf-empty{text-align:center;color:var(--tf-dim);padding:1.2rem 0;}',
		/* The protocol buckets, under the table rather than in it.  They are a
		 * kind of traffic and not a product, so the block is muted and separated
		 * by the same hairline the table header uses - visibly a footnote to the
		 * list above, not a second page of applications. */
		'.tf-page .tf-proto{border-top:1px solid var(--tf-line);margin-top:.35rem;',
		'padding:.45rem .6rem .5rem;display:flex;flex-direction:column;gap:.25rem;}',
		'.tf-page .tf-proto-cap{display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap;',
		'font-size:.72rem;color:var(--tf-dim);letter-spacing:.04em;}',
		'.tf-page .tf-proto-title{font-weight:600;}',
		'.tf-page .tf-proto-sum{font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-proto-list{display:grid;gap:.15rem 1.1rem;',
		'grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));}',
		'.tf-page .tf-proto-row{display:flex;align-items:center;gap:.45rem;min-width:0;',
		'font-size:.8rem;color:var(--tf-dim);font-style:italic;}',
		'.tf-page .tf-proto-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
		'.tf-page .tf-proto-bytes{white-space:nowrap;font-variant-numeric:tabular-nums;}',
		'.tf-page .tf-proto-row .tf-icon,.tf-page .tf-proto-row .tf-icon-img{',
		'width:16px;height:16px;flex:0 0 16px;border-radius:5px;box-shadow:none;}',
		'.tf-page .tf-proto-row .tf-icon-letter{font-size:.58rem;}',
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
		'border:1px solid var(--tf-line);border-radius:999px!important;box-shadow:none;cursor:pointer;',
		'transition:background-color .15s,border-color .15s,box-shadow .15s;}',
		'.tf-page .tf-dd{position:relative;display:inline-flex;}',
		'.tf-page .tf-dd-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
		'.tf-page .tf-dd-menu{display:none;position:absolute;right:0;top:calc(100% + .35rem);z-index:30;',
		'min-width:100%;padding:.3rem;',
		'background:var(--tf-menu);border:1px solid var(--tf-line);border-radius:14px;',
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
		/* Translucent, and neutral.  Pointing these at the theme's panel colour made
		 * the cards opaque on a theme that defines it - Argon paints its panels
		 * #333333 - and the glass material went with it.
		 *
		 * The colour that did not match the theme was never "translucent": it was
		 * that the literal was dark *blue*.  Measured against the real page, the
		 * theme paints its panels and its page as neutral grey (#333333 and #1A1A1A,
		 * no channel offset) while every card here came out #1E2329.  A neutral
		 * white lift has no hue of its own, so it takes whatever the theme's
		 * background is and keeps the material.  Borders still come from the theme,
		 * where its own hairline colour is the right answer. */
		DARK + '{--tf-card:rgba(44,44,46,.8);',
		'--tf-card-brd:var(--border-color-low,rgba(255,255,255,.08));',
		'--tf-chip:rgba(255,255,255,.08);',
		/* the one surface that must stay legible over whatever is behind it, so it
		 * keeps a near-opaque neutral rather than going translucent - the same
		 * neutral the card uses, at nearly full alpha */
		'--tf-menu:rgba(44,44,46,.98);',
		'--tf-line:var(--border-color-low,rgba(255,255,255,.12));',
		/* the highlight follows the theme's accent too: it was a cyan of this
		 * page's own choosing, which is the same kind of mismatch as the surfaces
		 * were; --primary-low is the theme's own washed accent */
		'--tf-tint:var(--primary-low,rgba(255,255,255,.06));',
		'--tf-icon-shadow:0 2px 6px rgba(0,0,0,.45);',
		'--tf-fg:#e6edf3;--tf-dim:#aeb5bc;',
		'--tf-shadow:0 6px 22px rgba(0,0,0,.35);',
		'--tf-down:#55c7ff;--tf-up:#42d993;',
		'--tf-area-down:rgba(85,199,255,.18);--tf-area-up:rgba(66,217,147,.15);}',
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
		'.tf-page .tf-stat-strip{gap:.35rem;}',
		/* Three boxes to a row instead of two, which is the difference between a
		 * five-row strip and a four-row one on a 360px phone.  A 5.3rem box still
		 * holds the longest label (客户端合计 is 58px against 85 - 11 of padding). */
		'.tf-page .tf-stat{flex:0 0 5.3rem;min-width:5.3rem;max-width:5.3rem;}',
		/* the list scrolls sideways here instead of squeezing the name column:
		 * every column stays readable and nothing wraps into a second line */
		'.tf-page .tf-table{min-width:34rem;}}',
		'@media (max-width:39rem){.tf-page .tf-chart-svg{max-height:none;}}',
		/* The hero on a phone: the total gets a row of its own, full width, and the
		 * two rates sit under it as two columns.
		 *
		 * Three columns of nowrap figures cannot fit a 305px card at 390px, let
		 * alone 235px at 320px, and the browser answered by breaking the big number
		 * across two lines - "181" over "MiB" - which is what the render showed.
		 * The children are placed explicitly: the markup emits the three captions
		 * first and the three readings after, so no auto flow can pair them.
		 *
		 * The first version of this kept the total beside its caption, in the second
		 * column of an "auto 1fr" grid.  That column is only what the widest first
		 * column cell leaves - the down rate, about 130px - so the caption ended up
		 * far from its figure while the rates below were caption-over-figure pairs.
		 * The total now spans both columns and stacks like the others, which also
		 * gives it back the width the 1.45rem override was compensating for. */
		'@media (max-width:34rem){.tf-page .tf-hero-stats{grid-template-columns:1fr 1fr;',
		'justify-content:start;column-gap:.9rem;row-gap:.15rem;}',
		'.tf-page .tf-hero-stats>*:nth-child(1){grid-area:1/1/2/3;}',
		'.tf-page .tf-hero-stats>*:nth-child(4){grid-area:2/1/3/3;}',
		'.tf-page .tf-hero-stats>*:nth-child(2){grid-area:3/1;}',
		'.tf-page .tf-hero-stats>*:nth-child(3){grid-area:3/2;}',
		'.tf-page .tf-hero-stats>*:nth-child(5){grid-area:4/1;}',
		'.tf-page .tf-hero-stats>*:nth-child(6){grid-area:4/2;}',
		/* The hairline between the two rates, as the design draws it: one line
		 * spanning both the caption row and the figure row, not two stubs with a
		 * gap between them - which is what a border on the cells would give.  It
		 * is a grid item rather than an absolutely placed box because the rows
		 * have no fixed height to position against; grid-area 3/1/5/2 covers rows
		 * three and four, and the negative margin drops it into the middle of the
		 * column gap.  Written here and not in the markup, so the six children
		 * stay the six the strip logic and the tests expect. */
		'.tf-page .tf-hero-stats::after{content:"";grid-area:3/1/5/2;',
		'justify-self:end;align-self:stretch;width:1px;margin-right:-.45rem;',
		'background:var(--tf-line);}',
		'.tf-page .tf-table{font-size:.86rem;min-width:0;}',
		'.tf-page .tf-table>thead>tr>th,.tf-page .tf-table>tbody>tr>td{padding:.35rem .3rem;}',
		/* A phone gets three columns: the application, and its two byte figures.
		 * The total is the one that goes, because it is the sum of the other two -
		 * it is also the widest cell, the only one carrying a share as well, so it
		 * is the column a phone can drop without losing a reading.
		 *
		 * The widths are set by column index, not by what each column means: the
		 * <col> elements line up with the columns positionally even when a column's
		 * cells are hidden, so a column that is hidden needs its width zeroed or it
		 * keeps holding space. */
		'.tf-page .tf-table>thead>tr>th:nth-child(2),.tf-page .tf-table>tbody>tr>td:nth-child(2),',
		'.tf-page .tf-table>thead>tr>th:nth-child(5),.tf-page .tf-table>tbody>tr>td:nth-child(5),',
		'.tf-page .tf-table>thead>tr>th:nth-child(6),.tf-page .tf-table>tbody>tr>td:nth-child(6){display:none;}',
		/* The widths are set by position, and that is the whole subtlety here: a
		 * hidden cell leaves the row with one cell fewer, and the remaining cells
		 * fall back onto the <col> elements in order.  Hiding column 2 therefore
		 * moves the download cell into <col> 2 - so a width given by column name
		 * lands on the wrong column, and the download cell rendered into the zero
		 * width this rule used to put on "total".  The first three <col> elements
		 * are the three visible cells, whatever they used to be called, and the
		 * rest are zeroed so the fixed layout cannot leave empty columns behind. */
		'.tf-page .tf-table colgroup col:nth-child(1){width:40%;}',
		'.tf-page .tf-table colgroup col:nth-child(2),',
		'.tf-page .tf-table colgroup col:nth-child(3){width:30%;}',
		'.tf-page .tf-table colgroup col:nth-child(4),',
		'.tf-page .tf-table colgroup col:nth-child(5),',
		'.tf-page .tf-table colgroup col:nth-child(6){width:0;}',
		/* The ten-box strip does not fit a phone - measured, it needed four rows at
		 * 390px and five at 320px, which is a third of the screen spent on readings
		 * that are reference rather than the answer.  It goes.  What stays is the
		 * state box, and only when it has something to warn about, so "the snapshot
		 * stopped arriving" is still said out loud on a phone. */
		'.tf-page .tf-stat-card{display:none;}',
		'.tf-page .tf-stat-card.tf-stat-warn{display:block;}',
		'.tf-page .tf-stat-card.tf-stat-warn .tf-stat{display:none;}',
		'.tf-page .tf-stat-card.tf-stat-warn .tf-stat:first-child{display:flex;}',
		'.tf-page .tf-stat-card.tf-stat-warn .tf-stat-sep{display:none;}}'
	].join('');

	var st = document.createElement('style');
	st.id = 'tf-css';
	st.appendChild(document.createTextNode(css));
	document.head.appendChild(st);
}

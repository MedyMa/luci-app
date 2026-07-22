'use strict';
'require view';
'require form';
'require poll';
'require rpc';
'require uci';

var callGetStatus = rpc.declare({
	object: 'luci.fan',
	method: 'getStatus',
	expect: { '': {} }
});

function hasChineseLocale() {
	if (typeof document === 'undefined')
		return false;

	var bodyClass = document.body ? (document.body.className || '') : '';
	var htmlLang = document.documentElement ? (document.documentElement.lang || '') : '';

	return /\blang_zh(?:[-_][^\s]+)?\b/i.test(bodyClass) || /^zh(?:-|_|$)/i.test(htmlLang);
}

function t(message, fallback) {
	var translated = _(message);

	if (translated !== message || !fallback || !hasChineseLocale())
		return translated;

	return fallback;
}

function isDarkTheme() {
	if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body)
		return false;

	var html = document.documentElement;
	var htmlClass = html ? (html.className || '') : '';
	var bodyClass = document.body.className || '';
	var htmlTheme = html ? (html.getAttribute('data-theme') || '') : '';
	var bodyTheme = document.body.getAttribute('data-theme') || '';
	var background = window.getComputedStyle(document.body).backgroundColor || '';
	var channels = background.match(/\d+(?:\.\d+)?/g);
	var luminance;

	if (/\b(?:dark|mode-dark|argon-dark)\b/i.test(htmlClass) || /\b(?:dark|mode-dark|argon-dark)\b/i.test(bodyClass))
		return true;

	if (/dark/i.test(htmlTheme) || /dark/i.test(bodyTheme))
		return true;

	if (/light/i.test(htmlTheme) || /light/i.test(bodyTheme))
		return false;

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
	var mediaQuery;

	syncThemeClass();

	if (typeof window !== 'undefined') {
		for (index = 0; index < retries.length; index++)
			window.setTimeout(syncThemeClass, retries[index]);

		if (window.requestAnimationFrame)
			window.requestAnimationFrame(syncThemeClass);

		/* Singleton MutationObserver — avoid observer accumulation on re-render */
		if (typeof MutationObserver !== 'undefined' && document.documentElement) {
			if (!applyThemeClass._themeObserver) {
				applyThemeClass._themeObserver = new MutationObserver(function() {
					isDarkTheme(); /* prime the internal state if needed */
				});
				applyThemeClass._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: [ 'class', 'style', 'data-theme' ] });
				if (document.body && document.body !== document.documentElement)
					applyThemeClass._themeObserver.observe(document.body, { attributes: true, attributeFilter: [ 'class', 'style', 'data-theme' ] });
			}
			/* Re-run all registered nodes on theme change via a microtask queue */
			if (!applyThemeClass._themeQueue)
				applyThemeClass._themeQueue = [];
			if (applyThemeClass._themeQueue.indexOf(node) === -1)
				applyThemeClass._themeQueue.push(node);

			if (!applyThemeClass._themeFlusher) {
				applyThemeClass._themeFlusher = new MutationObserver(function() {
					var nodes = applyThemeClass._themeQueue;
					var i;

					for (i = 0; i < nodes.length; i++) {
						if (nodes[i] && nodes[i].classList)
							nodes[i].classList.toggle(darkClass, isDarkTheme());
					}
				});
				applyThemeClass._themeFlusher.observe(document.documentElement, { attributes: true, attributeFilter: [ 'class', 'style', 'data-theme' ] });
			}
		}

		if (window.matchMedia) {
			mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

			if (mediaQuery) {
				if (mediaQuery.addEventListener)
					mediaQuery.addEventListener('change', syncThemeClass);
				else if (mediaQuery.addListener)
					mediaQuery.addListener(syncThemeClass);
			}
		}

		/* Singleton window listeners — register once, not per applyThemeClass call */
		if (!applyThemeClass._windowListenersAttached) {
			applyThemeClass._windowListenersAttached = true;
			window.addEventListener('pageshow', syncThemeClass);
			window.addEventListener('focus', syncThemeClass);
		}
	}

	return node;
}

var dashboardStyle = [
	/* ── Design Tokens ── */
	/* Easing: Emil Kowalski style — strong custom cubic-beziers, never ease-in */
	'.lf-page {',
	'  --lf-ease-out: cubic-bezier(0.23, 1, 0.32, 1);',
	'  --lf-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);',
	'  --lf-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);',
	'  --lf-duration-fast: 100ms;',
	'  --lf-duration-normal: 200ms;',
	'  --lf-duration-slow: 350ms;',
	'  display: grid; gap: 18px;',

	/* ── Light Shell ── */
	'  --lf-shell-bg: linear-gradient(135deg, #294a7a 0%, #3d679f 48%, #7da4d8 100%);',
	'  --lf-shell-shadow: 0 20px 40px rgba(25, 50, 87, 0.16);',
	'  --lf-frost-bg: rgba(255, 255, 255, 0.12);',
	'  --lf-frost-border: rgba(255, 255, 255, 0.14);',
	'  --lf-frost-soft: rgba(255, 255, 255, 0.10);',
	'  --lf-deep-surface: rgba(11, 24, 45, 0.20);',
	'  --lf-deep-surface-soft: rgba(11, 24, 45, 0.18);',
	'  --lf-form-bg: linear-gradient(180deg, rgba(249, 252, 255, 0.98), rgba(240, 246, 255, 0.99));',
	'  --lf-form-border: rgba(76, 108, 157, 0.12);',
	'  --lf-form-title: #1a3556;',
	'  --lf-field-border: rgba(76, 108, 157, 0.18);',
	'  --lf-field-bg: var(--background-color-high, #fff);',
	'  --lf-range-pill-bg: rgba(41, 74, 122, 0.08);',
	'  --lf-range-pill-text: #1d3d67;',
	'  --lf-preset-bg: rgba(17, 32, 54, 0.18);',
	'  --lf-preset-border: rgba(255, 255, 255, 0.18);',
	'  --lf-preset-hover: rgba(120, 169, 231, 0.18);',
	'  --lf-preset-hover-border: rgba(120, 169, 231, 0.45);',
	'  --lf-preset-active: rgba(120, 169, 231, 0.24);',
	'  --lf-preset-active-border: rgba(120, 169, 231, 0.60);',
	'}',

	/* ── Dark Shell (Argon / theme-agnostic) ── */
	'.lf-page.lf-dark,',
	'body.dark .lf-page, html.dark .lf-page,',
	'body.mode-dark .lf-page, body.argon-dark .lf-page,',
	'html[data-theme="dark"] .lf-page, body[data-theme="dark"] .lf-page,',
	'html[data-theme="dark"] body .lf-page,',
	'body[data-theme="dark"] .lf-page {',
	'  --lf-shell-bg: linear-gradient(135deg, #0c1424 0%, #15253d 48%, #24456d 100%);',
	'  --lf-shell-shadow: 0 24px 46px rgba(0, 0, 0, 0.32);',
	'  --lf-frost-bg: rgba(255, 255, 255, 0.08);',
	'  --lf-frost-border: rgba(255, 255, 255, 0.10);',
	'  --lf-frost-soft: rgba(255, 255, 255, 0.07);',
	'  --lf-deep-surface: rgba(7, 14, 24, 0.38);',
	'  --lf-deep-surface-soft: rgba(10, 18, 30, 0.32);',
	'  --lf-form-bg: linear-gradient(180deg, rgba(18, 28, 44, 0.96), rgba(10, 17, 29, 0.98));',
	'  --lf-form-border: rgba(124, 147, 186, 0.22);',
	'  --lf-form-title: #eef5fd;',
	'  --lf-field-border: rgba(124, 147, 186, 0.22);',
	'  --lf-field-bg: rgba(8, 14, 24, 0.94);',
	'  --lf-range-pill-bg: rgba(8, 14, 24, 0.86);',
	'  --lf-range-pill-text: #dce7f3;',
	'}',

	/* ── Shell & Entrance ── */
	'.lf-dashboard-shell { position: relative; overflow: hidden; border: 0; border-radius: 24px; box-shadow: var(--lf-shell-shadow); background: var(--lf-shell-bg); }',
	'.lf-dashboard-shell.lf-entering { animation: lf-shell-enter 500ms var(--lf-ease-out) both; }',
	'@keyframes lf-shell-enter { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }',

	/* Decorative ambient glows — Apple-style soft radial gradients */
	'.lf-dashboard-shell:before, .lf-dashboard-shell:after { content: ""; position: absolute; inset: auto; pointer-events: none; }',
	'.lf-dashboard-shell:before { top: -60px; right: -80px; width: 260px; height: 260px; border-radius: 50%; background: radial-gradient(circle, rgba(176, 205, 255, 0.28) 0%, rgba(176, 205, 255, 0) 70%); }',
	'.lf-dashboard-shell:after { left: -100px; bottom: -120px; width: 320px; height: 320px; border-radius: 50%; background: radial-gradient(circle, rgba(214, 229, 255, 0.22) 0%, rgba(214, 229, 255, 0) 72%); }',

	'.lf-dashboard { position: relative; z-index: 1; padding: 28px; color: #eef6ef; }',
	'.lf-hero { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.85fr); gap: 24px; align-items: stretch; }',
	'.lf-copy { min-width: 0; }',

	/* Eyebrow badge */
	'.lf-eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: var(--lf-frost-bg); border: 1px solid var(--lf-frost-border); backdrop-filter: blur(16px) saturate(140%); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; }',

	/* Headline — reset all LuCI overrides */
	'.lf-headline { all: unset; display: block !important; width: auto !important; margin: 16px 0 10px !important; padding: 0 !important; min-height: 0 !important; background: transparent !important; background-color: transparent !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; font-size: 30px !important; font-weight: 700 !important; line-height: 1.15 !important; color: #ffffff !important; text-shadow: none !important; }',
	'.lf-headline:before, .lf-headline:after { display: none; content: none; }',
	'.lf-copy p { max-width: 52rem; margin: 0; font-size: 14px; line-height: 1.7; color: rgba(238, 246, 239, 0.88); }',

	'.lf-chip-row, .lf-metrics, .lf-grid, .lf-config-grid, .lf-ladder-scale { display: grid; gap: 14px; }',
	'.lf-chip-row { grid-template-columns: repeat(auto-fit, minmax(140px, max-content)); margin-top: 18px; }',
	'.lf-chip { display: inline-flex; align-items: center; justify-content: center; padding: 8px 14px; border-radius: 999px; background: var(--lf-frost-bg); border: 1px solid var(--lf-frost-border); backdrop-filter: blur(12px); font-size: 12px; line-height: 1.4; color: #ffffff; }',
	'.lf-chip-muted { background: var(--lf-deep-surface); color: rgba(238, 246, 239, 0.86); }',
	'.lf-chip-alert { background: rgba(246, 135, 83, 0.2); border-color: rgba(246, 135, 83, 0.35); }',

	/* Runtime state badge colors */
	'.lf-runtime-badge[data-state="active"] { background: #ffcb72; border-color: #ffcb72; color: #2d1f04; }',
	'.lf-runtime-badge[data-state="transition"] { background: #9adfb9; border-color: #9adfb9; color: #143325; }',
	'.lf-runtime-badge[data-state="standby"] { background: #cbe7f0; border-color: #cbe7f0; color: #173843; }',
	'.lf-runtime-badge[data-state="disabled"], .lf-runtime-badge[data-state="unsupported"] { background: rgba(255, 255, 255, 0.16); color: #ffffff; }',

	'.lf-visual { min-width: 0; display: grid; gap: 16px; align-content: start; justify-items: stretch; }',

	/* Fan orb — Apple-style glass surface with top-edge light catch */
	'.lf-orb { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; min-height: 280px; padding: 18px; overflow: hidden; border-radius: 26px; background: linear-gradient(180deg, var(--lf-deep-surface), var(--lf-frost-soft)) !important; border: 1px solid var(--lf-frost-border) !important; backdrop-filter: blur(18px); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 8px 24px rgba(0,0,0,0.08) !important; }',
	'.lf-orb canvas, #lf-fan-canvas { display: block !important; width: 260px !important; height: 260px !important; max-width: 100% !important; max-height: 260px !important; margin: 0 auto !important; background: transparent !important; background-color: transparent !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; outline: 0 !important; }',

	'.lf-temp-readout { position: absolute; top: 50%; left: 50%; z-index: 1; transform: translate(-50%, -50%); text-align: center; pointer-events: none; }',
	'.lf-temp-number { font-size: 42px; line-height: 1; font-weight: 700; }',
	'.lf-temp-unit { margin-top: 4px; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(238, 246, 239, 0.72); }',
	'.lf-temp-caption { margin-top: 8px; font-size: 12px; color: rgba(238, 246, 239, 0.82); }',

	/* Demand bar — smooth width transition with strong ease-in-out */
	'.lf-demand { width: 100%; box-sizing: border-box; padding: 16px 18px 18px; border-radius: 18px; background: var(--lf-frost-soft); border: 1px solid var(--lf-frost-border); backdrop-filter: blur(10px); }',
	'.lf-demand-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 13px; }',
	'.lf-demand-row strong { font-size: 18px; }',
	'.lf-demand-bar { margin-top: 10px; height: 12px; border-radius: 999px; background: rgba(5, 16, 19, 0.34); overflow: hidden; }',
	'#lf-demand-fill { height: 100%; width: 0; border-radius: inherit; background: linear-gradient(90deg, #7de2b8 0%, #f3d07b 55%, #f68753 100%);',
	'  transition: width 350ms var(--lf-ease-in-out), background 350ms var(--lf-ease-in-out); }',

	/* Metrics grid — translucency + blur */
	'.lf-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 22px; }',
	'.lf-metric, .lf-card, .lf-ladder-card { padding: 18px; border-radius: 20px; background: var(--lf-frost-bg); border: 1px solid var(--lf-frost-border); backdrop-filter: blur(12px) saturate(140%); }',
	'.lf-metric-label { font-size: 12px; line-height: 1.5; color: rgba(238, 246, 239, 0.76); }',
	'.lf-metric-value { margin-top: 10px; font-size: 28px; line-height: 1.1; font-weight: 700; color: #ffffff;',
	'  transition: color 200ms var(--lf-ease-out); }',

	/* Ladder (smart curve visualisation) */
	'.lf-ladder-card { margin-top: 22px; }',
	'.lf-ladder-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }',
	'.lf-ladder-head h4, .lf-card h4 { margin: 0; font-size: 16px; color: #ffffff; }',
	'.lf-source-pill { padding: 6px 10px; border-radius: 999px; background: var(--lf-deep-surface); font-size: 12px; color: rgba(238, 246, 239, 0.84); }',
	'.lf-ladder-track { position: relative; height: 18px; margin-top: 18px; border-radius: 999px; background: linear-gradient(90deg, rgba(125, 226, 184, 0.45) 0%, rgba(250, 206, 118, 0.72) 55%, rgba(246, 135, 83, 0.95) 100%); overflow: hidden; }',
	'.lf-ladder-track:before { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(6, 18, 22, 0.25), rgba(255, 255, 255, 0.04)); }',
	'.lf-marker { position: absolute; top: -5px; width: 2px; height: 28px; background: #ffffff; box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.16); transform: translateX(-50%);',
	'  transition: left 400ms var(--lf-ease-out), opacity 200ms var(--lf-ease-out); }',
	'.lf-marker-current { height: 34px; top: -8px; background: #ffd17c; box-shadow: 0 0 0 4px rgba(255, 209, 124, 0.18); }',
	'.lf-ladder-scale { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 16px; }',
	'.lf-scale-item { padding: 10px 12px; border-radius: 14px; background: var(--lf-deep-surface-soft); }',
	'.lf-scale-item span { display: block; font-size: 11px; line-height: 1.5; color: rgba(238, 246, 239, 0.76); }',
	'.lf-scale-item strong { display: block; margin-top: 6px; font-size: 18px; line-height: 1.2; color: #ffffff;',
	'  transition: color 200ms var(--lf-ease-out); }',

	'.lf-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 22px; }',
	'.lf-card p { margin: 12px 0 0; font-size: 13px; line-height: 1.7; color: rgba(238, 246, 239, 0.82); }',

	/* ── Preset Buttons (Emil-style: :active scale feedback, strong easing) ── */
	'.lf-preset-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }',
	'.lf-preset {',
	'  min-height: 48px; padding: 0 14px; border-radius: 14px;',
	'  border: 1px solid var(--lf-preset-border);',
	'  background: var(--lf-preset-bg);',
	'  color: #ffffff; box-shadow: none; cursor: pointer;',
	'  outline: none;',
	'  -webkit-tap-highlight-color: transparent;',
	'  transition: transform 160ms var(--lf-ease-out),',
	'              background-color 200ms var(--lf-ease-out),',
	'              border-color 200ms var(--lf-ease-out),',
	'              box-shadow 200ms var(--lf-ease-out);',
	'}',
	'.lf-preset:active { transform: scale(0.97); transition: transform 100ms var(--lf-ease-out); }',
	'.lf-preset:hover, .lf-preset:focus-visible { transform: translateY(-1px); background: var(--lf-preset-hover); border-color: var(--lf-preset-hover-border); }',
	'.lf-preset:focus-visible { box-shadow: 0 0 0 3px rgba(120, 169, 231, 0.4); }',
	'.lf-preset.is-active { background: var(--lf-preset-active); border-color: var(--lf-preset-active-border); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }',

	'.lf-note, .lf-insights, .lf-config-grid { margin-top: 14px; }',
	'.lf-insight { margin: 0 0 10px; padding: 10px 12px; border-radius: 14px; background: var(--lf-deep-surface-soft); font-size: 13px; line-height: 1.6; color: rgba(238, 246, 239, 0.9); }',
	'.lf-config-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }',
	'.lf-config-item { padding: 10px 12px; border-radius: 14px; background: var(--lf-deep-surface-soft); }',
	'.lf-config-item span { display: block; font-size: 11px; line-height: 1.5; color: rgba(238, 246, 239, 0.76); }',
	'.lf-config-item strong { display: block; margin-top: 6px; font-size: 18px; line-height: 1.3; color: #ffffff;',
	'  transition: color 200ms var(--lf-ease-out); }',

	/* ── LuCI Form Integration ── */
	'.lf-dashboard-shell + .cbi-map { margin-top: 0; border-radius: 22px; border: 1px solid var(--lf-form-border); box-shadow: 0 12px 30px rgba(17, 48, 54, 0.08); overflow: hidden; background: var(--lf-form-bg); }',
	'.lf-dashboard-shell + .cbi-map > h2, .lf-dashboard-shell + .cbi-map > .cbi-map-descr { display: none; }',
	'.lf-dashboard-shell + .cbi-map .cbi-section { margin: 0; border: 0; box-shadow: none; background: transparent; }',
	'.lf-dashboard-shell + .cbi-map .cbi-section-node { padding-top: 6px; background: transparent; }',
	'.lf-dashboard-shell + .cbi-map .cbi-section-node h3 { margin-top: 4px; font-size: 20px; color: var(--lf-form-title); }',
	'.lf-dashboard-shell + .cbi-map .cbi-value { padding: 14px 18px; border-top: 1px solid var(--lf-form-border); }',
	'.lf-dashboard-shell + .cbi-map .cbi-value-title { font-weight: 600; color: var(--lf-form-title); }',
	'.lf-dashboard-shell + .cbi-map input[type="text"],',
	'.lf-dashboard-shell + .cbi-map input[type="password"],',
	'.lf-dashboard-shell + .cbi-map input[type="number"],',
	'.lf-dashboard-shell + .cbi-map select {',
	'  border-radius: 12px; border-color: var(--lf-field-border);',
	'  background: var(--lf-field-bg); color: var(--lf-form-title);',
	'  box-shadow: none;',
	'  transition: border-color 200ms var(--lf-ease-out);',
	'}',
	'.lf-dashboard-shell + .cbi-map input[type="text"]:focus,',
	'.lf-dashboard-shell + .cbi-map input[type="number"]:focus,',
	'.lf-dashboard-shell + .cbi-map select:focus {',
	'  border-color: rgba(120, 169, 231, 0.5);',
	'  box-shadow: 0 0 0 3px rgba(120, 169, 231, 0.15);',
	'}',
	'.lf-dashboard-shell + .cbi-map input[type="range"] { width: 100%; accent-color: #1d6d5d; }',
	'.lf-range-output { display: inline-flex; align-items: center; justify-content: center; min-width: 72px; margin-top: 10px; padding: 6px 12px; border-radius: 999px; background: var(--lf-range-pill-bg); color: var(--lf-range-pill-text); font-size: 12px; font-weight: 600;',
	'  transition: background-color 200ms var(--lf-ease-out), color 200ms var(--lf-ease-out); }',

	/* ── Reduced Motion ── */
	'@media (prefers-reduced-motion: reduce) {',
	'  .lf-dashboard-shell.lf-entering { animation: none; }',
	'  .lf-preset, .lf-preset:active, .lf-preset:hover, .lf-preset:focus-visible { transition: none; transform: none; }',
	'  #lf-demand-fill { transition: none; }',
	'  .lf-marker { transition: none; }',
	'  .lf-metric-value, .lf-scale-item strong, .lf-config-item strong { transition: none; }',
	'  .lf-dashboard-shell + .cbi-map input[type="text"],',
	'  .lf-dashboard-shell + .cbi-map input[type="number"],',
	'  .lf-dashboard-shell + .cbi-map select { transition: none; }',
	'  .lf-range-output { transition: none; }',
	'}',

	/* ── Responsive ── */
	'@media screen and (max-width: 1180px) { .lf-hero, .lf-grid { grid-template-columns: 1fr; } .lf-metrics, .lf-preset-list, .lf-ladder-scale { grid-template-columns: repeat(2, minmax(0, 1fr)); } }',
	'@media screen and (max-width: 760px) { .lf-dashboard { padding: 20px; } .lf-headline { font-size: 24px !important; } .lf-metrics, .lf-preset-list, .lf-grid, .lf-config-grid, .lf-ladder-scale { grid-template-columns: 1fr; } .lf-orb { min-height: 240px; } }'
].join('\n');

var texts = {
	enabled: t('Enabled', '已启用'),
	disabled: t('Disabled', '未启用'),
	active: t('Cooling active', '正在散热'),
	transition: t('Modulating', '调速中'),
	standby: t('Standby', '待机'),
	unsupported: t('Unavailable', '不可用'),
	unavailable: t('Sensor unavailable', '传感器不可用'),
	toStart: t('to start', '后启动'),
	thresholdReached: t('Full-speed ceiling reached', '已达到满速温度上限'),
	saveApply: t('Save & Apply below to persist changes.', '需要点击下方的“保存并应用”后，修改才会真正生效。'),
	enableAndSave: t('Enable the service and Save & Apply to start the fan daemon.', '启用服务后，再点击“保存并应用”即可启动风扇守护进程。'),
	loadedToForm: t('Loaded into the form', '已写入表单'),
	notAvailable: t('Not available', '不可用'),
	unsupportedHint: t('This device needs a readable CPU thermal zone and a writable pwm-fan hwmon interface for the full temperature-driven control loop.', '当前设备需要可读的 CPU 温区和可写的 PWM 风扇 hwmon 接口，才能使用完整的温度驱动控速。'),
	modeUnsupportedHint: t('Turbo and Manual modes require a writable pwm-fan hwmon interface on the target board.', '狂暴模式和手动模式需要目标设备提供可写的 pwm-fan hwmon 接口。'),
	telemetryWaiting: t('Waiting for telemetry...', '正在等待遥测数据...'),
	monitoringState: t('Monitoring state', '监控状态'),
	currentDevice: t('Current device', '当前设备'),
	bpiHero: t('BPI-R4 tuned layout with live CPU temperature, PWM duty, and fan speed feedback across smart, manual and turbo modes.', '已针对 BPI-R4 优化，实时展示 CPU 温度、PWM 占空比，以及智能、手动、狂暴三种模式下的风扇转速反馈。'),
	genericHero: t('Live OpenWrt cooling dashboard with a configurable smart temperature window, plus manual and turbo profiles on pwm-fan capable hardware.', '当目标硬件提供 pwm-fan 能力时，可在这里实时查看 OpenWrt 散热状态，并使用可配置智能温区、手动和狂暴三种模式。'),
	turbo: t('Turbo', '狂暴'),
	smart: t('Smart', '智能'),
	manual: t('Manual', '手动'),
	turboHint: t('Turbo mode locks the fan at the configured full-speed RPM ceiling after Save & Apply.', '狂暴模式在“保存并应用”后会把风扇锁定在已配置的满速转速上限。'),
	smartHint: t('Smart mode linearly ramps from the stop temperature to the configured full-speed RPM ceiling.', '智能模式会在停转温度到满速温度之间线性调速，并遵循已配置的满速转速上限。'),
	manualHint: t('Manual mode applies the selected duty target after Save & Apply and reports the available fan speed feedback.', '手动模式会在“保存并应用”后采用所选占空比，并显示当前可用的风扇转速反馈。'),
	modePending: t('Mode target', '目标模式'),
	currentDuty: t('Current fan duty', '当前风扇占空比'),
	estimatedTag: t('(estimated)', '（估算）'),
	actualTag: t('(actual)', '（真实）'),
	speedSourceEstimated: t('PWM speed feedback', 'PWM 转速反馈'),
	speedSourceActual: t('Hardware speed feedback', '硬件转速反馈'),
	speedSourceUnavailable: t('Speed feedback unavailable', '转速反馈不可用'),
	speedFeedback: t('Speed feedback', '转速反馈'),
	smartFloor: t('Fan stop below', '低于此温度停转'),
	smartCeiling: t('Full speed above', '高于此温度满速'),
	curveModulating: t('The fan is linearly modulating between the stop floor and the full-speed ceiling.', '当前风扇正在停转温度和满速温度之间线性调速。'),
	precisionHint: t('Backend control uses the kernel thermal reading directly, so the smart curve tracks temperature changes at 0.1 C granularity.', '后端直接使用内核热区读数，因此智能曲线按 0.1 摄氏度粒度跟踪温度变化。')
};

function toNumber(value) {
	var parsed = parseFloat(value);
	return isNaN(parsed) ? null : parsed;
}

function toBool(value) {
	return value === true || value === 1 || value === '1';
}

function roundTemp(value) {
	if (value === null || typeof value === 'undefined' || isNaN(value))
		return null;

	return Math.round(value * 10) / 10;
}

function clamp(value, minimum, maximum) {
	if (value < minimum)
		return minimum;
	if (value > maximum)
		return maximum;
	return value;
}

function escapeHtml(value) {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function normalizeStatus(data) {
	data = data || {};
	var supported = data.supported;

	if (supported == null)
		supported = !!(data.zone || data.fan_on_temp || data.pwm_percent);

	return {
		supported: toBool(supported),
		thermal_supported: toBool(data.thermal_supported),
		pwm_supported: toBool(data.pwm_supported),
		mode_supported: toBool(data.mode_supported),
		error: data.error || '',
		zone: data.zone || '',
		trip_point: data.trip_point,
		thermal_type: data.thermal_type || '',
		zone_temp: toNumber(data.zone_temp),
		fan_on_temp: toNumber(data.fan_on_temp),
		fan_off_temp: toNumber(data.fan_off_temp),
		configured_on_temp: toNumber(data.configured_on_temp),
		configured_off_temp: toNumber(data.configured_off_temp),
		hysteresis: toNumber(data.hysteresis),
		next_trip_temp: toNumber(data.next_trip_temp),
		headroom: toNumber(data.headroom),
		start_delta: toNumber(data.start_delta),
		load_ratio: toNumber(data.load_ratio) || 0,
		enabled: toBool(data.enabled),
		state: data.state || 'disabled',
		board_name: data.board_name || '',
		model_name: data.model_name || '',
		is_bpi_r4: toBool(data.is_bpi_r4),
		profile: data.profile || 'generic',
		mode: data.mode || 'smart',
		manual_pwm: toNumber(data.manual_pwm),
		poll_interval: toNumber(data.poll_interval),
		hwmon_name: data.hwmon_name || '',
		hwmon_path: data.hwmon_path || '',
		pwm_raw: toNumber(data.pwm_raw),
		pwm_percent: toNumber(data.pwm_percent),
		pwm_enable_mode: data.pwm_enable_mode || '',
		fan_rpm: toNumber(data.fan_rpm),
		actual_fan_rpm: toNumber(data.actual_fan_rpm),
		estimated_fan_rpm: toNumber(data.estimated_fan_rpm),
		rpm_source: data.rpm_source || 'unavailable',
		fan_max_rpm: toNumber(data.fan_max_rpm),
		smart_min_temp: toNumber(data.smart_min_temp),
		smart_max_temp: toNumber(data.smart_max_temp)
	};
}

function recommendedSmartWindow(status) {
	var off = status.smart_min_temp != null ? status.smart_min_temp : (status.configured_off_temp != null ? status.configured_off_temp : 30);
	var on = status.smart_max_temp != null ? status.smart_max_temp : (status.configured_on_temp != null ? status.configured_on_temp : 60);

	if (on <= off)
		on = off + 0.1;

	return {
		on: on,
		off: off
	};
}

return view.extend({
	requestFrame: function(callback) {
		var id;

		if (window.requestAnimationFrame) {
			id = window.requestAnimationFrame.call(window, callback);
			this._animFrameId = id;
			return id;
		}

		id = window.setTimeout(function() { callback(Date.now()); }, 33);
		this._cleanupTimers.push(id);
		return id;
	},

	statusPollInterval: function() {
		var backendInterval = this.runtime && this.runtime.poll_interval != null ? Math.round(this.runtime.poll_interval) : 5;
		return clamp(Math.max(2, backendInterval - 2), 2, 8);
	},

	_stopPoll: function() {
		if (this._pollHandle !== null && typeof poll !== 'undefined' && poll.remove) {
			poll.remove(this._pollHandle);
			this._pollHandle = null;
		}
	},

	_stopAnimation: function() {
		if (this._animFrameId !== null && window.cancelAnimationFrame) {
			window.cancelAnimationFrame(this._animFrameId);
			this._animFrameId = null;
		}
	},

	_clearTimers: function() {
		var id;
		while (this._cleanupTimers.length) {
			id = this._cleanupTimers.pop();
			window.clearTimeout(id);
		}
	},

	degreeUnit: ' ' + String.fromCharCode(176) + 'C',
	lastTick: 0,
	rotorAngle: 0,
	targetRotorSpeed: 0,
	currentRotorSpeed: 0,
	animationStarted: false,
	runtimeSignature: null,
	pendingSyncFrame: null,
	reducedMotion: false,

	load: function() {
		return Promise.all([
			uci.load('luci-fan'),
			L.resolveDefault(callGetStatus(), {})
		]);
	},

	formatTemp: function(value) {
		var rounded = roundTemp(value);
		if (rounded === null)
			return '--';

		return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)) + this.degreeUnit;
	},

	formatReadout: function(value) {
		var rounded = roundTemp(value);
		if (rounded === null)
			return '--';

		return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
	},

	formatPercent: function(value) {
		if (value === null || typeof value === 'undefined' || isNaN(value))
			return '--';

		return Math.round(value) + '%';
	},

	resolveMaxRpm: function(value) {
		var resolved = toNumber(value);

		if (resolved === null && this.runtime && this.runtime.fan_max_rpm != null)
			resolved = this.runtime.fan_max_rpm;
		if (resolved === null)
			resolved = 3000;

		return clamp(Math.round(resolved), 500, 10000);
	},

	clampRpm: function(value, maxRpm) {
		if (value === null || typeof value === 'undefined' || isNaN(value))
			return null;

		return clamp(Math.round(value), 0, this.resolveMaxRpm(maxRpm));
	},

	estimateRpmFromPercent: function(value, maxRpm) {
		var percent = clamp(toNumber(value) || 0, 0, 100);
		var resolvedMaxRpm = this.resolveMaxRpm(maxRpm);

		return Math.round((percent * resolvedMaxRpm) / 100);
	},

	formatRpm: function(value, source) {
		if (value === null || typeof value === 'undefined' || isNaN(value))
			return texts.notAvailable;

		return this.clampRpm(value) + ' RPM';
	},

	formatSpeedFeedback: function() {
		if (!this.runtime)
			return texts.speedSourceUnavailable;

		if (this.runtime.rpm_source === 'actual')
			return texts.speedSourceActual;
		if (this.runtime.rpm_source === 'estimated')
			return texts.speedSourceEstimated;

		return texts.speedSourceUnavailable;
	},

	modeLabel: function(mode) {
		switch (mode) {
		case 'turbo':
			return texts.turbo;
		case 'manual':
			return texts.manual;
		default:
			return texts.smart;
		}
	},

	setText: function(node, value) {
		if (node)
			node.textContent = value;
	},

	readPreviewNumber: function(field, fallback) {
		if (!field)
			return fallback;

		var value = toNumber(field.value);
		return value === null ? fallback : value;
	},

	getPreview: function() {
		var smartWindow = recommendedSmartWindow(this.runtime || {});

		return {
			enabled: this.fields.enabled ? !!this.fields.enabled.checked : !!(this.runtime && this.runtime.enabled),
			mode: this.fields.mode ? this.fields.mode.value : (this.runtime ? this.runtime.mode : 'smart'),
			manual_pwm: this.readPreviewNumber(this.fields.manual, this.runtime ? this.runtime.manual_pwm : 70),
			max_rpm: this.readPreviewNumber(this.fields.maxRpm, this.runtime ? this.runtime.fan_max_rpm : 3000),
			on: this.readPreviewNumber(this.fields.on, smartWindow.on),
			off: this.readPreviewNumber(this.fields.off, smartWindow.off)
		};
	},

	isPreviewDirty: function(preview) {
		var runtimeManual;
		var smartWindow;

		if (!this.runtime)
			return false;

		if (preview.enabled !== !!this.runtime.enabled)
			return true;

		if (preview.mode !== this.runtime.mode)
			return true;

		if (this.resolveMaxRpm(preview.max_rpm) !== this.resolveMaxRpm())
			return true;

		if (preview.mode === 'smart') {
			smartWindow = recommendedSmartWindow(this.runtime);
			if (Math.abs((preview.off || 0) - smartWindow.off) >= 0.05)
				return true;
			if (Math.abs((preview.on || 0) - smartWindow.on) >= 0.05)
				return true;
		}

		if (preview.mode !== 'manual')
			return false;

		runtimeManual = this.runtime.manual_pwm != null ? Math.round(this.runtime.manual_pwm) : 70;
		return Math.round(preview.manual_pwm || 0) !== runtimeManual;
	},

	buildDisplayState: function(preview) {
		var dirty = this.isPreviewDirty(preview);
		var demand = this.deriveDemand(preview);
		var plannedPercent;
		var runtimePercent = this.runtime && this.runtime.pwm_percent != null ? Math.round(this.runtime.pwm_percent) : null;
		var runtimeRpm = this.runtime && this.runtime.fan_rpm != null ? this.runtime.fan_rpm : null;
		var thermalType = this.runtime && this.runtime.thermal_type ? this.runtime.thermal_type : '--';
		var maxRpm = this.resolveMaxRpm(preview.max_rpm);

		if (!preview.enabled)
			plannedPercent = 0;
		else if (preview.mode === 'turbo')
			plannedPercent = 100;
		else if (preview.mode === 'manual' && preview.manual_pwm !== null)
			plannedPercent = clamp(Math.round(preview.manual_pwm), 0, 100);
		else
			plannedPercent = clamp(Math.round(demand * 100), 0, 100);

		return {
			dirty: dirty,
			demand: demand,
			maxRpm: maxRpm,
			dutyPercent: dirty ? plannedPercent : (runtimePercent !== null ? runtimePercent : plannedPercent),
			fanRpm: this.clampRpm(dirty ? this.estimateRpmFromPercent(plannedPercent, maxRpm) : (runtimeRpm !== null ? runtimeRpm : this.estimateRpmFromPercent(plannedPercent, maxRpm)), maxRpm),
			rpmSource: dirty ? 'estimated' : (this.runtime ? this.runtime.rpm_source : 'estimated'),
			caption: this.runtime && this.runtime.zone_temp !== null
				? (this.modeLabel(preview.mode) + ' / ' + thermalType + (dirty ? ' / ' + texts.modePending : ''))
				: ((this.runtime && this.runtime.error) || texts.unavailable)
		};
	},

	deriveDemand: function(preview) {
		if (!preview.enabled)
			return 0;

		if (preview.mode === 'turbo')
			return 1;

		if (preview.mode === 'manual' && preview.manual_pwm !== null)
			return clamp(preview.manual_pwm / 100, 0, 1);

		if (!this.runtime || this.runtime.zone_temp === null)
			return this.runtime && this.runtime.pwm_percent !== null ? clamp(this.runtime.pwm_percent / 100, 0, 1) : 0;

		if (preview.off !== null && preview.on !== null && preview.on > preview.off)
			return clamp((this.runtime.zone_temp - preview.off) / (preview.on - preview.off), 0, 1);

		if (preview.on !== null && preview.on > 0)
			return clamp(this.runtime.zone_temp / preview.on, 0, 1);

		return clamp(this.runtime.load_ratio || 0, 0, 1);
	},

	deriveDemandDisplayRatio: function(demand) {
		return clamp(demand || 0, 0, 1);
	},

	updateMetricCards: function(preview) {
		var display = this.buildDisplayState(preview);

		this.setText(this.nodes.metricCpu, this.formatTemp(this.runtime && this.runtime.zone_temp));
		this.setText(this.nodes.metricFan, this.formatRpm(display.fanRpm, display.rpmSource));
		this.setText(this.nodes.metricPwm, this.formatPercent(display.dutyPercent));
		this.setText(this.nodes.metricMode, this.modeLabel(preview.mode));
		this.setText(this.nodes.configEnabled, preview.enabled ? texts.enabled : texts.disabled);
		this.setText(this.nodes.configMode, this.modeLabel(preview.mode));
		this.setText(this.nodes.configManual, this.formatPercent(preview.manual_pwm));
		this.setText(this.nodes.configOn, this.formatTemp(preview.on));
		this.setText(this.nodes.configOff, this.formatTemp(preview.off));
		this.setText(this.nodes.configRpm, this.formatRpm(display.fanRpm, display.rpmSource));
	},

	setMarker: function(node, value, minimum, maximum) {
		if (!node)
			return;

		if (value === null || maximum <= minimum) {
			node.style.display = 'none';
			return;
		}

		node.style.display = 'block';
		node.style.left = (((value - minimum) / (maximum - minimum)) * 100) + '%';
	},

	updateLadder: function(preview) {
		var values = [];

		if (preview.off !== null)
			values.push(preview.off);
		if (this.runtime && this.runtime.zone_temp !== null)
			values.push(this.runtime.zone_temp);
		if (preview.on !== null)
			values.push(preview.on);

		if (!values.length)
			return;

		var minimum = Math.max(0, Math.floor(Math.min.apply(Math, values) - 4));
		var maximum = Math.ceil(Math.max.apply(Math, values) + 4);
		if (maximum <= minimum)
			maximum = minimum + 10;

		this.setMarker(this.nodes.markerOff, preview.off, minimum, maximum);
		this.setMarker(this.nodes.markerCurrent, this.runtime ? this.runtime.zone_temp : null, minimum, maximum);
		this.setMarker(this.nodes.markerOn, preview.on, minimum, maximum);
		this.setMarker(this.nodes.markerNext, null, minimum, maximum);

		this.setText(this.nodes.scaleOff, this.formatTemp(preview.off));
		this.setText(this.nodes.scaleCurrent, this.formatTemp(this.runtime && this.runtime.zone_temp));
		this.setText(this.nodes.scaleOn, this.formatTemp(preview.on));
		this.setText(this.nodes.scaleNext, this.formatSpeedFeedback());
	},

	updateDemand: function(preview) {
		var demand = this.deriveDemand(preview);
		var displayRatio = this.deriveDemandDisplayRatio(demand);
		var hue = Math.round(150 - (demand * 120));

		this.nodes.demandFill.style.width = Math.round(displayRatio * 100) + '%';
		this.nodes.demandFill.style.background = 'linear-gradient(90deg, hsl(148, 60%, 64%) 0%, hsl(42, 88%, 72%) 58%, hsl(' + Math.max(12, hue) + ', 88%, 62%) 100%)';
		this.setText(this.nodes.demandValue, Math.round(demand * 100) + '%');
		return demand;
	},

	updateManualOutput: function(preview) {
		if (this.manualOutput)
			this.manualOutput.textContent = this.formatPercent(preview.manual_pwm);
	},

	renderInsights: function(preview) {
		var hints = [];
		var startDelta = (this.runtime && this.runtime.zone_temp !== null && preview.off !== null) ? (preview.off - this.runtime.zone_temp) : null;
		var ceilingDelta = (this.runtime && this.runtime.zone_temp !== null && preview.on !== null) ? (preview.on - this.runtime.zone_temp) : null;
		var maxRpm = this.resolveMaxRpm(preview.max_rpm);

		if (!this.runtime || !this.runtime.supported) {
			hints.push((this.runtime && this.runtime.error) || texts.unsupportedHint);
		} else if (!preview.enabled) {
			hints.push(texts.enableAndSave);
		} else if (preview.mode === 'turbo') {
			hints.push(texts.turboHint + ' ' + maxRpm + ' RPM.');
		} else if (preview.mode === 'manual') {
			hints.push(texts.manualHint + ' ' + texts.modePending + ': ' + this.formatPercent(preview.manual_pwm) + ' / ' + maxRpm + ' RPM.');
		} else {
			hints.push(texts.smartHint);
			hints.push(texts.smartFloor + ': ' + this.formatTemp(preview.off) + ' / ' + texts.smartCeiling + ': ' + this.formatTemp(preview.on) + ' / ' + maxRpm + ' RPM');

			if (startDelta !== null && startDelta > 0)
				hints.push(this.formatTemp(startDelta) + ' ' + texts.toStart);
			else if (ceilingDelta !== null && ceilingDelta <= 0)
				hints.push(texts.thresholdReached);
			else if (ceilingDelta !== null)
				hints.push(texts.curveModulating);

			hints.push(texts.precisionHint);
		}

		hints.push(texts.speedFeedback + ': ' + this.formatSpeedFeedback());

		if (!this.runtime || !this.runtime.mode_supported)
			hints.push(texts.modeUnsupportedHint);
		else
			hints.push(texts.saveApply);

		this.nodes.insights.innerHTML = '';
		hints.forEach(function(hint) {
			this.nodes.insights.appendChild(E('p', { 'class': 'lf-insight' }, [ hint ]));
		}, this);
	},

	syncFormState: function() {
		if (!this.runtime)
			return;

		var preview = this.getPreview();
		this.updateRuntimeBadge(preview);
		this.updateOptionVisibility(preview.mode);
		this.updatePresetStates(preview.mode);
		this.updateMetricCards(preview);
		this.updateLadder(preview);
		this.updateDemand(preview);
		this.updateManualOutput(preview);
		this.renderInsights(preview);
	},

	scheduleSyncFormState: function() {
		if (this.pendingSyncFrame !== null)
			return;

		this.pendingSyncFrame = this.requestFrame(function() {
			this.pendingSyncFrame = null;
			this.syncFormState();
		}.bind(this));
	},

	pickProfile: function(name) {
		var defaults = recommendedSmartWindow(this.runtime || {});

		if (this.fields.mode)
			this.fields.mode.value = name;

		switch (name) {
		case 'turbo':
			if (this.fields.manual)
				this.fields.manual.value = '100';
			this.setText(this.nodes.presetNote, texts.loadedToForm + ': ' + texts.turbo + '. ' + texts.saveApply);
			break;
		case 'manual':
			if (this.fields.manual)
				this.fields.manual.value = String(Math.round((this.runtime && this.runtime.manual_pwm != null) ? this.runtime.manual_pwm : 70));
			this.setText(this.nodes.presetNote, texts.loadedToForm + ': ' + texts.manual + ' / ' + this.formatPercent(this.readPreviewNumber(this.fields.manual, 70)) + '. ' + texts.saveApply);
			break;
		default:
			this.setText(this.nodes.presetNote, texts.loadedToForm + ': ' + texts.smart + ' / ' + defaults.off.toFixed(1) + this.degreeUnit + ' - ' + defaults.on.toFixed(1) + this.degreeUnit + '. ' + texts.saveApply);
			break;
		}

		this.scheduleSyncFormState();
	},

	setFieldVisible: function(node, visible) {
		if (!node)
			return;

		node.classList.toggle('hidden', !visible);
		node.style.display = visible ? '' : 'none';
	},

	updateOptionVisibility: function(mode) {
		var isManual = mode === 'manual';
		var isSmart = mode === 'smart';

		this.setFieldVisible(this.fieldRows.manual, isManual);
		this.setFieldVisible(this.fieldRows.smartOff, isSmart);
		this.setFieldVisible(this.fieldRows.smartOn, isSmart);
	},

	updatePresetStates: function(mode) {
		Array.prototype.forEach.call(this.root.querySelectorAll('.lf-preset'), function(node) {
			node.classList.toggle('is-active', node.getAttribute('data-preset') === mode);
		});
	},

	bindFields: function() {
		var manualField;

		this.fields = {
			enabled: this.mapNode.querySelector('[data-name="enabled"] input[type="checkbox"]'),
			mode: this.mapNode.querySelector('[data-name="mode"] select'),
			manual: this.mapNode.querySelector('[data-name="manual_pwm"] input'),
			maxRpm: this.mapNode.querySelector('[data-name="max_rpm"] input'),
			off: this.mapNode.querySelector('[data-name="off_temp"] input'),
			on: this.mapNode.querySelector('[data-name="on_temp"] input')
		};
		this.fieldRows = {
			manual: this.mapNode.querySelector('[data-name="manual_pwm"]'),
			smartOff: this.mapNode.querySelector('[data-name="off_temp"]'),
			smartOn: this.mapNode.querySelector('[data-name="on_temp"]')
		};

		if (this.fields.manual) {
			this.fields.manual.type = 'range';
			this.fields.manual.min = '0';
			this.fields.manual.max = '100';
			this.fields.manual.step = '1';
			manualField = this.mapNode.querySelector('[data-name="manual_pwm"] .cbi-value-field');
			if (manualField && !manualField.querySelector('.lf-range-output')) {
				this.manualOutput = E('span', { 'class': 'lf-range-output' }, [ this.formatPercent(toNumber(this.fields.manual.value)) ]);
				manualField.appendChild(this.manualOutput);
			} else if (manualField) {
				this.manualOutput = manualField.querySelector('.lf-range-output');
			}
		}

		if (this.fields.off) {
			this.fields.off.type = 'number';
			this.fields.off.min = '0';
			this.fields.off.max = '149.9';
			this.fields.off.step = '0.1';
		}

		if (this.fields.on) {
			this.fields.on.type = 'number';
			this.fields.on.min = '0.1';
			this.fields.on.max = '150';
			this.fields.on.step = '0.1';
		}

		if (this.fields.maxRpm) {
			this.fields.maxRpm.type = 'number';
			this.fields.maxRpm.min = '500';
			this.fields.maxRpm.max = '10000';
			this.fields.maxRpm.step = '100';
		}

		if (this.fields.enabled)
			this.fields.enabled.addEventListener('change', this.scheduleSyncFormState.bind(this));
		if (this.fields.mode)
			this.fields.mode.addEventListener('change', this.scheduleSyncFormState.bind(this));
		if (this.fields.manual)
			this.fields.manual.addEventListener('input', this.scheduleSyncFormState.bind(this));
		if (this.fields.maxRpm)
			this.fields.maxRpm.addEventListener('input', this.scheduleSyncFormState.bind(this));
		if (this.fields.off)
			this.fields.off.addEventListener('input', this.scheduleSyncFormState.bind(this));
		if (this.fields.on)
			this.fields.on.addEventListener('input', this.scheduleSyncFormState.bind(this));

		Array.prototype.forEach.call(this.root.querySelectorAll('.lf-preset'), function(node) {
			node.addEventListener('click', function(event) {
				this.pickProfile(event.currentTarget.getAttribute('data-preset'));
			}.bind(this));
		}, this);

		this.updateOptionVisibility(this.fields.mode ? this.fields.mode.value : 'smart');
		this.updatePresetStates(this.fields.mode ? this.fields.mode.value : 'smart');
	},

	drawFan: function(demand) {
		var canvas = this.nodes.canvas;
		if (!canvas || !canvas.getContext)
			return;

		var context = canvas.getContext('2d');
		var centerX = canvas.width / 2;
		var centerY = canvas.height / 2;
		var outerRadius = 94;
		var innerRadius = 58;
		var bladeColor = demand > 0.72 ? '#f79259' : (demand > 0.42 ? '#f3cf7c' : '#7de2b8');
		var glowColor = demand > 0.72 ? 'rgba(247, 146, 89, 0.22)' : (demand > 0.42 ? 'rgba(243, 207, 124, 0.22)' : 'rgba(125, 226, 184, 0.2)');

		context.clearRect(0, 0, canvas.width, canvas.height);
		context.save();
		context.translate(centerX, centerY);

		context.beginPath();
		context.arc(0, 0, outerRadius + 18, 0, Math.PI * 2, false);
		context.fillStyle = glowColor;
		context.fill();

		context.beginPath();
		context.arc(0, 0, outerRadius, 0, Math.PI * 2, false);
		context.fillStyle = 'rgba(7, 20, 26, 0.38)';
		context.fill();

		context.lineWidth = 12;
		context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
		context.beginPath();
		context.arc(0, 0, outerRadius, 0, Math.PI * 2, false);
		context.stroke();

		context.lineCap = 'round';
		context.strokeStyle = bladeColor;
		context.beginPath();
		context.arc(0, 0, outerRadius, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * demand), false);
		context.stroke();

		for (var blade = 0; blade < 4; blade++) {
			context.save();
			context.rotate(this.rotorAngle + (blade * Math.PI / 2));
			context.beginPath();
			context.moveTo(0, -12);
			context.bezierCurveTo(58, -42, 48, -108, 0, -84);
			context.bezierCurveTo(-18, -74, -18, -24, 0, -12);
			context.closePath();
			context.fillStyle = bladeColor;
			context.fill();
			context.restore();
		}

		context.beginPath();
		context.arc(0, 0, innerRadius, 0, Math.PI * 2, false);
		context.fillStyle = 'rgba(10, 27, 33, 0.92)';
		context.fill();

		context.beginPath();
		context.arc(0, 0, 18, 0, Math.PI * 2, false);
		context.fillStyle = bladeColor;
		context.fill();

		context.restore();
	},

	deriveAnimationSpeed: function(preview, demand) {
		var display = this.runtime ? this.buildDisplayState(preview) : null;
		var rpm = display ? display.fanRpm : null;
		var maxRpm = display ? display.maxRpm : this.resolveMaxRpm();

		if (rpm !== null) {
			if (rpm <= 0)
				return 0;

			return 0.12 + (clamp(rpm, 0, maxRpm) / maxRpm) * 1.33;
		}

		if (!preview.enabled)
			return 0.08;

		if (preview.mode === 'turbo')
			return 1.25;
		if (preview.mode === 'manual')
			return 0.22 + (demand * 0.95);
		if (this.runtime && this.runtime.state === 'active')
			return 0.55 + (demand * 0.8);
		if (this.runtime && this.runtime.state === 'transition')
			return 0.3 + (demand * 0.5);

		return 0.15 + (demand * 0.3);
	},

	animationLoop: function(timestamp) {
		if (!this.root || !document.body || !document.body.contains(this.root)) {
			this.lastTick = 0;
			this._stopAnimation();
			return;
		}

		this.animationStarted = true;

		var preview = this.runtime ? this.getPreview() : { enabled: false, mode: 'smart', manual_pwm: 70, on: null, off: null };
		var demand = this.runtime ? this.deriveDemand(preview) : 0;
		var targetSpeed = this.deriveAnimationSpeed(preview, demand);
		var dt;
		var smoothing;

		if (!this.lastTick)
			this.lastTick = timestamp;

		dt = Math.min((timestamp - this.lastTick) / 1000, 0.1);

		/* Smooth rotor speed transitions — spring-like interpolation toward target */
		if (this.reducedMotion) {
			this.currentRotorSpeed = 0;
		} else {
			smoothing = dt * 4.5;
			if (smoothing > 1)
				smoothing = 1;
			this.targetRotorSpeed = targetSpeed;
			this.currentRotorSpeed += (this.targetRotorSpeed - this.currentRotorSpeed) * smoothing;
		}

		this.rotorAngle += dt * this.currentRotorSpeed * Math.PI;
		this.lastTick = timestamp;
		this.drawFan(demand);
		this.requestFrame(this.animationLoop.bind(this));
	},

	pollStatus: function() {
		return L.resolveDefault(callGetStatus(), null).then(function(status) {
			if (status)
				this.updateRuntime(status);
		}.bind(this));
	},

	renderDashboardShell: function(status) {
		var shell = E('div', { 'class': 'lf-dashboard-shell' }, [
			E('style', {}, dashboardStyle)
		]);
		var dashboard = E('div', {
			'class': 'cbi-section-node lf-dashboard',
			'id': 'lf-dashboard',
			'data-zone': status.zone || '--',
			'data-type': status.thermal_type || '--',
			'data-is-bpi-r4': status.is_bpi_r4 ? '1' : '0'
		});
		var heroText = status.is_bpi_r4 ? texts.bpiHero : texts.genericHero;
		var primaryChip = escapeHtml(status.model_name || texts.currentDevice);
		var sourceText = escapeHtml((status.hwmon_name || '--') + ' / ' + (status.zone || '--'));

		dashboard.innerHTML = '' +
			'<div class="lf-hero">' +
				'<div class="lf-copy">' +
					'<div class="lf-eyebrow">' + escapeHtml(t('Adaptive Fan Profile', '自适应风扇控制')) + '</div>' +
					'<div class="lf-headline" style="all:unset;display:block;margin:16px 0 10px;padding:0;background:transparent;color:#ffffff;font-size:30px;font-weight:700;line-height:1.15;">' + escapeHtml(t('Live Cooling Dashboard', '实时散热面板')) + '</div>' +
					'<p>' + escapeHtml(heroText) + '</p>' +
					'<div class="lf-chip-row">' +
						'<span class="lf-chip">' + primaryChip + '</span>' +
						'<span class="lf-chip lf-chip-alert" id="lf-support-chip" style="display:none"></span>' +
						'<span class="lf-chip lf-runtime-badge" id="lf-runtime-badge" data-state="disabled">' + escapeHtml(texts.monitoringState) + '</span>' +
					'</div>' +
				'</div>' +
				'<div class="lf-visual">' +
					'<div class="lf-orb">' +
						'<canvas id="lf-fan-canvas" width="260" height="260" style="display:block;width:260px;height:260px;max-width:100%;background:transparent;border:0;border-radius:0;box-shadow:none;"></canvas>' +
						'<div class="lf-temp-readout">' +
							'<div class="lf-temp-number" id="lf-temp-number">--</div>' +
							'<div class="lf-temp-unit">' + escapeHtml(String.fromCharCode(176) + 'C') + '</div>' +
							'<div class="lf-temp-caption" id="lf-temp-caption">' + escapeHtml(texts.unavailable) + '</div>' +
						'</div>' +
					'</div>' +
					'<div class="lf-demand">' +
						'<div class="lf-demand-row">' +
							'<span>' + escapeHtml(texts.currentDuty) + '</span>' +
							'<strong id="lf-demand-value">--%</strong>' +
						'</div>' +
						'<div class="lf-demand-bar"><div id="lf-demand-fill"></div></div>' +
					'</div>' +
				'</div>' +
			'</div>' +
			'<div class="lf-metrics">' +
				'<div class="lf-metric"><div class="lf-metric-label">' + escapeHtml(t('CPU temperature', 'CPU 温度')) + '</div><div class="lf-metric-value" id="lf-metric-cpu">--</div></div>' +
				'<div class="lf-metric"><div class="lf-metric-label">' + escapeHtml(t('Fan speed', '风扇转速')) + '</div><div class="lf-metric-value" id="lf-metric-fan">--</div></div>' +
				'<div class="lf-metric"><div class="lf-metric-label">' + escapeHtml(t('Current PWM duty', '当前 PWM 占空比')) + '</div><div class="lf-metric-value" id="lf-metric-pwm">--</div></div>' +
				'<div class="lf-metric"><div class="lf-metric-label">' + escapeHtml(t('Control mode', '控制模式')) + '</div><div class="lf-metric-value" id="lf-metric-mode">--</div></div>' +
			'</div>' +
			'<div class="lf-ladder-card">' +
				'<div class="lf-ladder-head">' +
					'<h4>' + escapeHtml(t('Smart curve', '智能曲线')) + '</h4>' +
					'<span class="lf-source-pill" id="lf-source-label">' + sourceText + '</span>' +
				'</div>' +
				'<div class="lf-ladder-track">' +
					'<div class="lf-marker" id="lf-marker-off"></div>' +
					'<div class="lf-marker lf-marker-current" id="lf-marker-current"></div>' +
					'<div class="lf-marker" id="lf-marker-on"></div>' +
					'<div class="lf-marker" id="lf-marker-next"></div>' +
				'</div>' +
				'<div class="lf-ladder-scale">' +
					'<div class="lf-scale-item"><span>' + escapeHtml(texts.smartFloor) + '</span><strong id="lf-scale-off">--</strong></div>' +
					'<div class="lf-scale-item"><span>' + escapeHtml(t('Current temperature', '当前温度')) + '</span><strong id="lf-scale-current">--</strong></div>' +
					'<div class="lf-scale-item"><span>' + escapeHtml(texts.smartCeiling) + '</span><strong id="lf-scale-on">--</strong></div>' +
					'<div class="lf-scale-item"><span>' + escapeHtml(texts.speedFeedback) + '</span><strong id="lf-scale-next">--</strong></div>' +
				'</div>' +
			'</div>' +
			'<div class="lf-grid">' +
				'<div class="lf-card">' +
					'<h4>' + escapeHtml(t('Operating profiles', '运行模式')) + '</h4>' +
					'<p>' + escapeHtml(t('Use these shortcuts to load Turbo, Smart or Manual targets into the form below before Save & Apply.', '可用这些快捷按钮把狂暴、智能或手动目标写入下方表单，然后再执行“保存并应用”。')) + '</p>' +
					'<div class="lf-preset-list">' +
						'<button type="button" class="lf-preset" data-preset="turbo">' + escapeHtml(t('Turbo mode', '狂暴模式')) + '</button>' +
						'<button type="button" class="lf-preset" data-preset="smart">' + escapeHtml(t('Smart mode', '智能模式')) + '</button>' +
						'<button type="button" class="lf-preset" data-preset="manual">' + escapeHtml(t('Manual mode', '手动模式')) + '</button>' +
					'</div>' +
					'<p class="lf-note" id="lf-preset-note">' + escapeHtml(texts.saveApply) + '</p>' +
				'</div>' +
				'<div class="lf-card">' +
					'<h4>' + escapeHtml(t('Runtime insight', '运行提示')) + '</h4>' +
					'<div class="lf-insights" id="lf-insights"><p class="lf-insight">' + escapeHtml(texts.telemetryWaiting) + '</p></div>' +
				'</div>' +
				'<div class="lf-card">' +
					'<h4>' + escapeHtml(t('Current config', '当前设置')) + '</h4>' +
					'<div class="lf-config-grid">' +
						'<div class="lf-config-item"><span>' + escapeHtml(t('Enabled in UCI', 'UCI 启用状态')) + '</span><strong id="lf-config-enabled">--</strong></div>' +
						'<div class="lf-config-item"><span>' + escapeHtml(t('Control mode', '控制模式')) + '</span><strong id="lf-config-mode">--</strong></div>' +
						'<div class="lf-config-item"><span>' + escapeHtml(t('Manual target', '手动目标')) + '</span><strong id="lf-config-manual">--</strong></div>' +
						'<div class="lf-config-item"><span>' + escapeHtml(t('Runtime fan speed', '当前风扇转速')) + '</span><strong id="lf-config-rpm">--</strong></div>' +
						'<div class="lf-config-item"><span>' + escapeHtml(texts.smartFloor) + '</span><strong id="lf-config-off">--</strong></div>' +
						'<div class="lf-config-item"><span>' + escapeHtml(texts.smartCeiling) + '</span><strong id="lf-config-on">--</strong></div>' +
					'</div>' +
				'</div>' +
			'</div>';

		shell.appendChild(dashboard);
		return shell;
	},

	collectNodes: function() {
		this.nodes = {
			runtimeBadge: this.root.querySelector('#lf-runtime-badge'),
			supportChip: this.root.querySelector('#lf-support-chip'),
			tempNumber: this.root.querySelector('#lf-temp-number'),
			tempCaption: this.root.querySelector('#lf-temp-caption'),
			demandValue: this.root.querySelector('#lf-demand-value'),
			demandFill: this.root.querySelector('#lf-demand-fill'),
			metricCpu: this.root.querySelector('#lf-metric-cpu'),
			metricFan: this.root.querySelector('#lf-metric-fan'),
			metricPwm: this.root.querySelector('#lf-metric-pwm'),
			metricMode: this.root.querySelector('#lf-metric-mode'),
			markerOff: this.root.querySelector('#lf-marker-off'),
			markerCurrent: this.root.querySelector('#lf-marker-current'),
			markerOn: this.root.querySelector('#lf-marker-on'),
			markerNext: this.root.querySelector('#lf-marker-next'),
			scaleOff: this.root.querySelector('#lf-scale-off'),
			scaleCurrent: this.root.querySelector('#lf-scale-current'),
			scaleOn: this.root.querySelector('#lf-scale-on'),
			scaleNext: this.root.querySelector('#lf-scale-next'),
			insights: this.root.querySelector('#lf-insights'),
			presetNote: this.root.querySelector('#lf-preset-note'),
			configEnabled: this.root.querySelector('#lf-config-enabled'),
			configMode: this.root.querySelector('#lf-config-mode'),
			configManual: this.root.querySelector('#lf-config-manual'),
			configRpm: this.root.querySelector('#lf-config-rpm'),
			configOn: this.root.querySelector('#lf-config-on'),
			configOff: this.root.querySelector('#lf-config-off'),
			sourceLabel: this.root.querySelector('#lf-source-label'),
			canvas: this.root.querySelector('#lf-fan-canvas')
		};
	},

	updateRuntimeBadge: function(preview) {
		if (!this.runtime)
			return;

		var display = preview ? this.buildDisplayState(preview) : null;
		var state = this.runtime.supported ? (this.runtime.state || 'disabled') : 'unsupported';
		var label = texts.disabled;
		var zoneName = this.runtime.zone || '--';
		var thermalType = this.runtime.thermal_type || '--';
		var sourceText = (this.runtime.hwmon_name || '--') + ' / ' + zoneName;

		if (!this.runtime.supported)
			label = texts.unsupported;
		else if (state === 'active')
			label = texts.active;
		else if (state === 'transition')
			label = texts.transition;
		else if (state === 'standby')
			label = texts.standby;

		this.root.setAttribute('data-zone', zoneName);
		this.root.setAttribute('data-type', thermalType);
		this.root.setAttribute('data-is-bpi-r4', this.runtime.is_bpi_r4 ? '1' : '0');

		this.nodes.runtimeBadge.setAttribute('data-state', state);
		this.setText(this.nodes.runtimeBadge, label);
		this.setText(this.nodes.tempNumber, this.formatReadout(this.runtime.zone_temp));
		this.setText(this.nodes.tempCaption, display ? display.caption : (this.runtime.zone_temp !== null ? (this.modeLabel(this.runtime.mode) + ' / ' + thermalType) : (this.runtime.error || texts.unavailable)));
		this.setText(this.nodes.sourceLabel, sourceText);

		if (!this.runtime.mode_supported && this.runtime.supported)
			this.nodes.supportChip.style.display = 'inline-flex';
		else if (!this.runtime.supported)
			this.nodes.supportChip.style.display = 'inline-flex';
		else
			this.nodes.supportChip.style.display = 'none';

		this.setText(this.nodes.supportChip, this.runtime.supported ? texts.modeUnsupportedHint : (this.runtime.error || texts.unsupportedHint));
	},

	updateRuntime: function(data) {
		var nextRuntime = normalizeStatus(data);
		var nextSignature = JSON.stringify(nextRuntime);

		if (this.runtimeSignature === nextSignature)
			return;

		this.runtimeSignature = nextSignature;
		this.runtime = nextRuntime;
		this.updateRuntimeBadge();
		this.syncFormState();
	},

	render: function(data) {
		/* Initialize per-instance mutable state (avoid prototype sharing) */
		this._pollHandle = null;
		this._animFrameId = null;
		this._cleanupTimers = [];
		this.animationStarted = false;
		this.runtimeSignature = null;
		this.pendingSyncFrame = null;
		this.lastTick = 0;
		this.rotorAngle = 0;
		this.targetRotorSpeed = 0;
		this.currentRotorSpeed = 0;

		var initialStatus = normalizeStatus(data[1]);
		var m = new form.Map('luci-fan', t('Fan Control', '风扇控制'), t('Configure Smart, Turbo and Manual fan profiles for pwm-fan capable boards such as the BPI-R4. The live panel reads CPU temperature, PWM duty, and fan speed feedback over ubus.', '为 BPI-R4 等支持 pwm-fan 的设备配置智能、狂暴和手动风扇模式。实时面板会通过 ubus 读取 CPU 温度、PWM 占空比，以及风扇转速反馈。'));
		var s = m.section(form.TypedSection, 'luci-fan', t('Profile Settings', '基本设置'));
		var o;
		var dashboard = this.renderDashboardShell(initialStatus);

		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', t('Enable fan service', '启用风扇服务'));
		o.rmempty = false;
		o.default = '0';
		o.description = t('Start the fan daemon on Save & Apply. Smart mode uses the configured temperature window, Turbo holds the configured RPM ceiling, and Manual applies the slider target on pwm-fan capable boards.', '点击“保存并应用”后会启动风扇守护进程。智能模式会按已配置的温度区间调速，狂暴模式固定在已配置的满速转速上限，手动模式会在支持 pwm-fan 的设备上应用滑条目标。');

		o = s.option(form.ListValue, 'mode', t('Control mode', '控制模式'));
		o.rmempty = false;
		o.default = initialStatus.mode || 'smart';
		o.value('smart', t('Smart', '智能'));
		o.value('turbo', t('Turbo', '狂暴'));
		o.value('manual', t('Manual', '手动'));
		o.description = t('Smart mode follows the configured stop and full-speed temperatures. Turbo and Manual require pwm-fan hwmon support on the target board.', '智能模式会按已配置的停转温度和满速温度调速。狂暴模式和手动模式需要目标设备提供 pwm-fan hwmon 支持。');

		o = s.option(form.Value, 'off_temp', texts.smartFloor);
		o.datatype = 'ufloat';
		o.placeholder = String(initialStatus.smart_min_temp != null ? roundTemp(initialStatus.smart_min_temp) : 30);
		o.default = String(initialStatus.smart_min_temp != null ? roundTemp(initialStatus.smart_min_temp) : 30);
		o.description = t('Temperature in C below which the smart profile stops the fan. You can customize when the fan starts to stay off.', '智能模式下低于该温度时风扇停转，可自定义风扇开始保持关闭的温度。');
		o.depends('mode', 'smart');

		o = s.option(form.Value, 'on_temp', texts.smartCeiling);
		o.datatype = 'ufloat';
		o.placeholder = String(initialStatus.smart_max_temp != null ? roundTemp(initialStatus.smart_max_temp) : 60);
		o.default = String(initialStatus.smart_max_temp != null ? roundTemp(initialStatus.smart_max_temp) : 60);
		o.description = t('Temperature in C at which smart mode reaches the configured RPM ceiling.', '智能模式下达到该温度时会拉到已配置的满速转速上限。');
		o.depends('mode', 'smart');

		o = s.option(form.Value, 'max_rpm', t('Maximum fan RPM', '风扇最大转速'));
		o.datatype = 'and(uinteger,min(500),max(10000))';
		o.placeholder = String(initialStatus.fan_max_rpm != null ? Math.round(initialStatus.fan_max_rpm) : 3000);
		o.default = String(initialStatus.fan_max_rpm != null ? Math.round(initialStatus.fan_max_rpm) : 3000);
		o.description = t('Display and estimation ceiling for fan speed. Set values such as 2500, 3000 or 3500 to match your hardware.', '风扇转速的显示和估算上限。可设置为 2500、3000 或 3500 等数值，以匹配你的风扇。');

		o = s.option(form.Value, 'manual_pwm', t('Manual PWM target', '手动 PWM 目标'));
		o.datatype = 'and(uinteger,min(0),max(100))';
		o.placeholder = String(initialStatus.manual_pwm != null ? Math.round(initialStatus.manual_pwm) : 70);
		o.default = String(initialStatus.manual_pwm != null ? Math.round(initialStatus.manual_pwm) : 70);
		o.description = t('Duty target in percent for Manual mode. 0 turns the fan off, 100 drives the maximum PWM value, which maps to the configured RPM ceiling in the display.', '手动模式下的目标占空比，单位为百分比。0 表示关闭风扇，100 表示输出最大 PWM，对应页面显示中已配置的转速上限。');
		o.depends('mode', 'manual');

		o = s.option(form.Value, 'poll_interval', t('Polling interval', '轮询间隔'));
		o.datatype = 'and(uinteger,min(1),max(30))';
		o.placeholder = String(initialStatus.poll_interval != null ? Math.round(initialStatus.poll_interval) : 5);
		o.default = String(initialStatus.poll_interval != null ? Math.round(initialStatus.poll_interval) : 5);
		o.description = t('Fan daemon loop interval in seconds. The default 5-second cadence is usually enough for the configurable smart curve and reduces unnecessary PWM writes.', '风扇守护进程的轮询间隔，单位为秒。默认 5 秒通常已足够匹配可配置智能曲线，并可减少无意义的 PWM 写入。');

		return m.render().then(function(mapNode) {

			this.mapNode = mapNode;
			this.root = dashboard.querySelector('#lf-dashboard');

			/* Detect reduced-motion preference */
			if (typeof window !== 'undefined' && window.matchMedia)
				this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

			/* Entrance animation — scale+fade the shell in, remove class after animation completes */
			if (dashboard && !this.reducedMotion) {
				dashboard.classList.add('lf-entering');
				this._cleanupTimers.push(window.setTimeout(function() {
					dashboard.classList.remove('lf-entering');
				}, 550));
			}

			this.collectNodes();
			this.bindFields();
			this.updateRuntime(initialStatus);

			/* Stop previous poll before adding a new one (prevents accumulation on re-render) */
			this._stopPoll();

			this._animFrameId = null; /* allow new animation loop */
			this.requestFrame(this.animationLoop.bind(this));
			this._pollHandle = poll.add(this.pollStatus.bind(this), this.statusPollInterval());
			return applyThemeClass(E('div', { 'class': 'lf-page' }, [ dashboard, mapNode ]), 'lf-dark');
		}.bind(this));
	}
});
#!/usr/bin/env node
/* Reproducible, source-recorded site icon expansion. Run from any directory. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ICONS = path.join(ROOT, 'htdocs/luci-static/resources/traffic/icons');
const APPS = path.join(ROOT, 'root/etc/traffic/apps.tsv');
const LOCK = path.join(__dirname, 'site-icons.tsv');
const DOMAIN_LOCK = path.join(__dirname, 'site-icon-domains.tsv');
/* The provenance manifest ships outside the web directory, under the package's
 * own share directory; see the note in check-icons.js. */
const MANIFEST = path.join(ROOT, 'root', 'usr', 'share', 'traffic', 'icons', 'SOURCES.tsv');
const DOMAINS = path.join(ICONS, 'domains.tsv');
const TARGET = 1500;
const GAME_SOURCE = [
  ['bluearchive.svg', 'Bluearchive', 'blue-archive'],
  ['wuthering-waves.svg', 'Wuthering Waves', 'wuthering-waves'],
  ['honkai-star-rail.svg', 'Honkai Star Rail', 'honkai-star-rail'],
  ['honkai-impact-3rd.svg', 'Honkai Impact 3rd', 'honkai-impact-3rd'],
  ['zenless-zone-zero.svg', 'Zenless Zone Zero', 'zenless-zone-zero'],
];
const GAME_PRIORITIES = new Set([
  '2k', 'atari', 'boardgamegeek', 'eslgaming', 'gamebanana', 'gamejolt',
  'gameloft', 'gamescience', 'heroicgameslauncher', 'pcgamingwiki',
  'playstation2', 'playstation3', 'playstation4', 'playstation5',
  'playstationportable', 'playstationvita', 'redcandlegames',
  'robloxstudio', 'rockstargames', 'sega', 'squareenix', 'steamdb',
  'steamdeck', 'steamworks', 'wegame', 'youtubegaming',
]);

const existing = new Set(fs.readdirSync(ICONS).filter(f => f.endsWith('.svg')));
const catalogueDomains = new Set(fs.readFileSync(APPS, 'utf8').split(/\r?\n/)
  .filter(line => line && !line.startsWith('#')).map(line => line.split('\t')[1]));

function iconSlug(icon) {
  const replacements = { '+': 'plus', '.': 'dot', '&': 'and',
    'đ': 'd', 'ħ': 'h', 'ı': 'i', 'ĸ': 'k', 'ŀ': 'l', 'ł': 'l',
    'ß': 'ss', 'ŧ': 't', 'ø': 'o' };
  return icon.slug || icon.title.toLowerCase()
    .replace(/[+.&đħıĸŀłßŧø]/g, char => replacements[char])
    .normalize('NFD').replace(/[^a-z0-9]/g, '');
}

function brandDomain(icon, slug) {
  let host;
  try { host = new URL(icon.source).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every(s => /^[a-z0-9-]+$/.test(s))) return '';
  const root = labels[labels.length - 2];
  const tld = labels[labels.length - 1];
  /* Match only a brand's own registered root. A logo sourced from GitHub,
   * Wikimedia or another company's media page must never claim that host. */
  if (root !== slug || root.length < 2 || tld.length < 2) return '';
  if (['com', 'net', 'org', 'co', 'gov', 'edu'].includes(root)) return '';
  return root + '.' + tld;
}

function contrastHex(hex) {
  if (!/^[a-f0-9]{6}$/i.test(hex || '')) return 'AAB6C2';
  const channels = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const luminance = channels.map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((s, c, i) => s + c * [.2126, .7152, .0722][i], 0);
  return luminance < .07 ? 'AAB6C2' : hex.toUpperCase();
}

async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 700));
    }
  }
}

async function selection() {
  if (fs.existsSync(LOCK)) return fs.readFileSync(LOCK, 'utf8').split(/\r?\n/)
    .filter(line => line && !line.startsWith('#'))
    .map(line => { const [slug, title, domain, hex] = line.split('\t'); return { slug, title, domain, hex }; });
  const cached = path.join(os.tmpdir(), 'traffic-simple-icons-metadata.json');
  const data = fs.existsSync(cached) ? fs.readFileSync(cached, 'utf8') :
    await get('https://raw.githubusercontent.com/simple-icons/simple-icons/develop/data/simple-icons.json');
  const metadata = JSON.parse(data);
  const candidates = metadata.map(icon => {
    const slug = iconSlug(icon);
    const domain = brandDomain(icon, slug);
    return { slug, title: icon.title, domain, hex: contrastHex(icon.hex) };
  }).filter(icon => (icon.domain || GAME_PRIORITIES.has(icon.slug)) &&
    /^[a-z0-9-]+$/.test(icon.slug) &&
    !existing.has(icon.slug + '.svg'));
  const specialCount = GAME_SOURCE.filter(([file]) => !existing.has(file)).length +
    (existing.has('2k-games.svg') ? 0 : 1);
  const wanted = TARGET - existing.size - specialCount;
  if (wanted <= 0 || candidates.length < wanted) throw new Error('target exceeds verified candidates');
  /* First: games and domains in the catalogue. Then take a deterministic,
   * distributed sample so the extra site set spans many brands and industries. */
  candidates.sort((a, b) => {
    const score = x => (GAME_PRIORITIES.has(x.slug) ? 1000 : 0) +
      (catalogueDomains.has(x.domain) ? 500 : 0);
    return score(b) - score(a) ||
      crypto.createHash('sha256').update(a.slug).digest('hex').localeCompare(
        crypto.createHash('sha256').update(b.slug).digest('hex'));
  });
  const selected = candidates.slice(0, wanted);
  for (const slug of GAME_PRIORITIES)
    if (candidates.some(c => c.slug === slug) && !selected.some(c => c.slug === slug))
      throw new Error(`game priority excluded: ${slug}`);
  fs.writeFileSync(LOCK, '# Simple Icons title, verified source domain and display colour\n' +
    selected.map(x => [x.slug, x.title, x.domain, x.hex].join('\t')).join('\n') + '\n');
  return selected;
}

async function domainMappings() {
  if (fs.existsSync(DOMAIN_LOCK)) return fs.readFileSync(DOMAIN_LOCK, 'utf8')
    .split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split('\t'));
  const cached = path.join(os.tmpdir(), 'traffic-simple-icons-metadata.json');
  const data = fs.existsSync(cached) ? fs.readFileSync(cached, 'utf8') :
    await get('https://raw.githubusercontent.com/simple-icons/simple-icons/develop/data/simple-icons.json');
  const rows = [];
  for (const icon of JSON.parse(data)) {
    const slug = iconSlug(icon), domain = brandDomain(icon, slug);
    if (domain && fs.existsSync(path.join(ICONS, slug + '.svg')))
      rows.push([domain, slug, icon.source]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  fs.writeFileSync(DOMAIN_LOCK, '# Site domain\tpackaged SVG slug\tupstream brand source URL\n' +
    rows.map(row => row.join('\t')).join('\n') + '\n');
  return rows;
}

function validSvg(svg) {
  return /^\s*<svg\b/.test(svg) && /<\/svg>\s*$/.test(svg) &&
    !/<script\b|<foreignObject\b|javascript:|\bonload\s*=/i.test(svg);
}

async function main() {
  const chosen = await selection();
  const failed = [];
  let completed = 0;
  for (let start = 0; start < chosen.length; start += 20) {
    await Promise.all(chosen.slice(start, start + 20).map(async icon => {
      const file = path.join(ICONS, icon.slug + '.svg');
      if (fs.existsSync(file)) { completed++; return; }
      try {
        let svg = await get(`https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/${icon.slug}.svg`);
        if (!validSvg(svg)) throw new Error('invalid SVG');
        svg = svg.replace(/<svg\b/, `<svg fill="#${icon.hex}"`);
        fs.writeFileSync(file, svg.trim() + '\n');
        completed++;
      } catch (e) { failed.push(`${icon.slug}: ${e.message}`); }
    }));
    if (start % 100 === 0) console.log(`site icons: ${completed}/${chosen.length}`);
  }
  for (const [file, , source] of GAME_SOURCE) {
    const dest = path.join(ICONS, file);
    if (fs.existsSync(dest)) continue;
    let svg = await get(`https://api.iconify.design/arcticons/${source}.svg`);
    if (!validSvg(svg)) throw new Error(`invalid game SVG: ${source}`);
    svg = svg.replace(/currentColor/g, '#8b98a5');
    fs.writeFileSync(dest, svg.trim() + '\n');
  }
  if (!fs.existsSync(path.join(ICONS, '2k.svg')))
    throw new Error('2k.svg is needed for the catalogue alias');
  fs.copyFileSync(path.join(ICONS, '2k.svg'), path.join(ICONS, '2k-games.svg'));

  const rows = fs.readFileSync(MANIFEST, 'utf8').trimEnd().split(/\r?\n/);
  const recorded = new Set(rows.filter(x => x && !x.startsWith('#')).map(x => x.split('\t')[0]));
  const simpleLicence = 'CC0-1.0 (trademarks: see DISCLAIMER.md)';
  const simpleUrl = 'https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md';
  for (const icon of chosen) {
    const file = icon.slug + '.svg';
    if (!fs.existsSync(path.join(ICONS, file)) || recorded.has(file)) continue;
    rows.push([file, icon.title, 'simple-icons', icon.slug, simpleLicence, simpleUrl, ''].join('\t'));
    recorded.add(file);
  }
  const gameRows = [
    ['2k-games.svg', '2K Games', 'simple-icons', '2k', simpleLicence, simpleUrl, ''],
    ...GAME_SOURCE.map(([file, title, source]) =>
      [file, title, 'iconify:arcticons', source, 'CC BY-SA 4.0',
        'https://github.com/Donnnno/Arcticons', '']),
  ];
  for (const row of gameRows) if (!recorded.has(row[0])) rows.push(row.join('\t'));
  fs.writeFileSync(MANIFEST, rows.join('\n') + '\n');

  const domains = new Map();
  for (const [domain, slug] of await domainMappings())
    if (fs.existsSync(path.join(ICONS, slug + '.svg'))) domains.set(domain, slug);
  for (const icon of chosen)
    if (icon.domain && fs.existsSync(path.join(ICONS, icon.slug + '.svg')) && !domains.has(icon.domain))
      domains.set(icon.domain, icon.slug);
  fs.writeFileSync(DOMAINS, '# brand-owned source domain\tpackaged SVG slug\n' +
    [...domains].sort((a, b) => a[0].localeCompare(b[0]))
      .map(row => row.join('\t')).join('\n') + '\n');

  const check = spawnSync(process.execPath, [path.join(__dirname, 'check-icons.js'), '--write'],
    { stdio: 'inherit' });
  if (failed.length) { console.error(failed.join('\n')); process.exitCode = 1; }
  if (check.status !== 0) process.exitCode = 1;
  console.log(`${fs.readdirSync(ICONS).filter(f => f.endsWith('.svg')).length} SVGs; ${domains.size} source-domain mappings`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });

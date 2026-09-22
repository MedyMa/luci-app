#!/usr/bin/env node
/* Replace untraceable legacy artwork with recorded upstream SVGs or an original
 * neutral placeholder. Never infer a licence from a similar filename. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'htdocs/luci-static/resources/traffic/icons');
const sources = {
  abema: 'abema-tv', antutu: 'antutu-3dbench', blizzard: 'blizzard-authenticator',
  cainiao: 'cainiao-wireless', camera360: 'camera360', cdek: 'cdek',
  chaoxing: 'chaoxing-mobile', coolapk: 'coolapk', coupang: 'coupang',
  craigslist: 'craigslist', damai: 'damaiapp', dewu: 'dewu', didi: 'didi',
  dingtalk: 'dingtalk', divar: 'divar', dw: 'dw', economist: 'economist',
  eneba: 'eneba', espn: 'espn', familymart: 'familymart', forza: 'forza',
  gaijin: 'gaijin-pass', garena: 'garena', 'genshin-impact': 'genshin-impact',
  giffgaff: 'giffgaff'
};
const logos = new Set(['dyndns', 'embedly', 'geetest']);
async function main() {
  const manifest = path.join(dir, 'SOURCES.tsv');
  const lines = fs.readFileSync(manifest, 'utf8').trimEnd().split(/\r?\n/);
  const collections = {};
  async function collection(set) {
    if (collections[set]) return collections[set];
    const cache = path.join(os.tmpdir(), 'traffic-catalog', 'iconify-' + set + '.json');
    if (fs.existsSync(cache)) return collections[set] = JSON.parse(fs.readFileSync(cache));
    const response = await fetch('https://raw.githubusercontent.com/iconify/icon-sets/master/json/' + set + '.json');
    if (!response.ok) throw new Error(set + ': HTTP ' + response.status);
    return collections[set] = await response.json();
  }
  let repaired = 0, neutral = 0;
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i].split('\t');
    if (row[2] !== 'unknown' && !(row[0] === 'sto-express.svg' && row[2] !== 'local:neutral')) continue;
    const key = row[0].replace(/\.svg$/, '');
    const set = logos.has(key) ? 'logos' : 'arcticons';
    const source = logos.has(key) ? key : sources[key];
    let svg;
    if (source) {
      const data = await collection(set), icon = data.icons[source];
      if (!icon) throw new Error('Missing upstream ' + set + ':' + source);
      const w = icon.width || data.width || 24, h = icon.height || data.height || 24;
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${icon.body}</svg>`;
      svg = svg.replace(/currentColor/g, '#8b98a5');
      row.splice(2, 5, 'iconify:' + set, source,
        set === 'arcticons' ? 'CC BY-SA 4.0' : 'see the collection licence',
        'https://icon-sets.iconify.design/' + set + '/' + source + '/', '');
    } else {
      // Two unbranded circles: own geometry, explicitly not a product logo.
      svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="2" y="2" width="28" height="28" rx="8" fill="#667585"/><circle cx="11" cy="16" r="3" fill="#fff"/><circle cx="21" cy="16" r="3" fill="#fff"/></svg>';
      row.splice(2, 5, 'local:neutral', key, 'CC0-1.0',
        'tools/repair-icon-sources.js', 'neutral placeholder; not a brand logo');
      neutral++;
    }
    fs.writeFileSync(path.join(dir, row[0]), svg + '\n');
    lines[i] = row.join('\t');
    repaired++;
  }
  fs.writeFileSync(manifest, lines.join('\n') + '\n');
  for (const file of fs.readdirSync(dir).filter(x => x.endsWith('.svg'))) {
    const target = path.join(dir, file), svg = fs.readFileSync(target, 'utf8');
    const tag = svg.match(/<svg\b[^>]*>/);
    if (!tag || /\bviewBox=/.test(tag[0])) continue;
    const w = tag[0].match(/\bwidth="([\d.]+)"/), h = tag[0].match(/\bheight="([\d.]+)"/);
    if (w && h) fs.writeFileSync(target, svg.replace('<svg', `<svg viewBox="0 0 ${w[1]} ${h[1]}"`));
  }
  console.log(`Repaired ${repaired} sources (${neutral} explicitly neutral placeholders)`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });

#!/usr/bin/env node
/* Coverage contract for the packaged game and site icon expansion. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const icons = path.join(root, 'htdocs/luci-static/resources/traffic/icons');
const files = new Set(fs.readdirSync(icons).filter(f => f.endsWith('.svg')));
const domainsFile = path.join(icons, 'domains.tsv');
const domains = new Map(fs.existsSync(domainsFile)
  ? fs.readFileSync(domainsFile, 'utf8').split(/\r?\n/).filter(x => x && !x.startsWith('#')).map(x => x.split('\t'))
  : []);
const errors = [];
function check(ok, message) { if (!ok) errors.push(message); }
check(files.size >= 1450 && files.size <= 1550, `expected about 1500 SVGs, got ${files.size}`);
for (const name of ['2k-games', 'bluearchive', 'wuthering-waves',
  'honkai-star-rail', 'honkai-impact-3rd', 'zenless-zone-zero',
  'atari', 'gameloft', 'rockstargames', 'sega', 'squareenix',
  'steamdeck', 'playstation5', 'wegame'])
  check(files.has(name + '.svg'), `missing game/platform icon: ${name}`);
check(domains.size >= 800, `expected at least 800 mapped site domains, got ${domains.size}`);
for (const [domain, icon] of domains)
  check(files.has(icon + '.svg'), `mapped site ${domain} has no packaged ${icon}.svg`);
check(domains.get('1password.com') === '1password', '1password.com should use its brand icon');
check(domains.get('2k.com') === '2k', '2k.com should use the 2K icon');
check(!domains.has('github.com') || domains.get('github.com') === 'github',
  'shared upstream hosting must not claim a different brand icon');
if (errors.length) { errors.forEach(e => console.error('FAIL ' + e)); process.exit(1); }
console.log(`PASS ${files.size} SVGs, ${domains.size} verified site-domain mappings, game/platform set`);

#!/usr/bin/env node
/* Exercise the shipped page resolver with the shipped indexes, not a copied
 * slug algorithm. Counts describe catalogue rules, never observed traffic. */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'htdocs/luci-static/resources/traffic/icons');
const read = file => fs.readFileSync(file, 'utf8');
const entries = text => text.split(/\r?\n/).filter(x => x && !x.startsWith('#'));
const have = Object.fromEntries(entries(read(path.join(dir, 'index.txt'))).map(k => [k, 1]));
const domains = Object.fromEntries(entries(read(path.join(dir, 'domains.tsv'))).map(x => x.split('\t')));
const src = read(path.join(root, 'htdocs/luci-static/resources/view/traffic/overview.js'));
const resolve = new Function('rpc', '_', 'have', 'domains', src.slice(0, src.indexOf('return view.extend({')) +
  '\nshippedIcons=have; cachedIcons={}; domainIcons=domains; return iconKey;')(
  { declare: () => () => {} }, x => x, have, domains);
for (const [name, key] of [['producthunt.com','producthunt'], ['Product Hunt','producthunt'],
  ['brandfetch.io','brandfetch'], ['login.1password.com','1password'], ['Rockstar','rockstargames']]) {
  assert.strictEqual(resolve(name), key, name);
  assert(have[key], name + ' packaged file');
}
const rows = entries(read(path.join(root, 'root/etc/traffic/apps.tsv'))).map(x => x.split('\t'));
const names = [...new Set(rows.map(x => x[0]))];
const nameHits = names.filter(x => have[resolve(x)]).length;
const ruleHits = rows.filter(x => have[resolve(x[0])]).length;
const domainHits = Object.entries(domains).filter(([host, key]) => resolve(host) === key).length;
const selection = entries(read(path.join(__dirname, 'site-icons.tsv'))).map(x => x.split('\t'));
const unused = selection.filter(([key, name, domain]) => resolve(name) !== key && (!domain || resolve(domain) !== key));
assert.deepStrictEqual(unused, [], 'every selected extra icon must resolve by its title or site domain');
/* The counters are this suite's whole point, so they are asserted and not
 * merely printed: pruning domains.tsv to the four rows the literal checks
 * above happen to touch used to leave every number plausible and the suite
 * green.  The floors are floors - a catalogue that grows keeps passing, a
 * regression that drops coverage does not.
 *
 * The two domain assertions are deliberately a pair.  "every row resolves" on
 * its own is invariant under deleting rows - both sides of the comparison come
 * from the same file, so a truncated index satisfies it - which is exactly the
 * prune that went unnoticed before.  The floor is what pins the claim. */
assert.strictEqual(domainHits, Object.keys(domains).length,
  'every packaged domain mapping must resolve to its own icon');
assert(Object.keys(domains).length >= 875,
  'the packaged domain index shrank to ' + Object.keys(domains).length + ' rows');
assert(nameHits >= 830, 'catalogue name coverage fell to ' + nameHits);
assert(ruleHits >= 25000, 'catalogue rule coverage fell to ' + ruleHits);
console.log(JSON.stringify({svgFiles:Object.keys(have).length, catalogueNames:names.length,
  resolvedCatalogueNames:nameHits, resolvedCatalogueRulePercent:+(100*ruleHits/rows.length).toFixed(1),
  siteDomainMappings:Object.keys(domains).length, matchingSiteDomainMappings:domainHits,
  selectedExtraIcons:selection.length, unreachableSelectedIcons:unused.length}, null, 2));

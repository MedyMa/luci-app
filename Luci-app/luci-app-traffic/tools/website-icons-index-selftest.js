'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/traffic/overview.js'), 'utf8');
const rows = 'vector.com\tvector.com.svg\t123\nold.com\told.com.ico\t1\n' +
  'png.com\tpng.com.png\nwrong.com\tvector.com.svg\nevil.com\tevil.com.html\n';
const load = new Function('rpc', '_', 'fetch', src.slice(0, src.indexOf('return view.extend({')) + '\nreturn loadWebsiteIndex;')(
  {declare:()=>()=>{}}, x=>x, async()=>({ok:true,text:async()=>rows}));
load().then(map=> {
  assert.deepStrictEqual(map, {'vector.com':'vector.com.svg?v=123','old.com':'old.com.ico?v=1','png.com':'png.com.png'});
  console.log('website-icons-index-selftest: passed');
}).catch(error=> {console.error(error);process.exitCode=1;});

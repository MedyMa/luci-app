const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const status = path.join(root, 'Luci-app/rpcd-mod-router-status');
const traffic = path.join(root, 'Luci-app/luci-app-traffic');
function read(p) { return fs.readFileSync(p, 'utf8'); }
assert(fs.existsSync(status), 'standalone status package is missing');
for (const file of ['Makefile', 'root/usr/libexec/rpcd/router.status', 'root/etc/init.d/router-status', 'root/usr/share/router-status/wifi-collector.sh', 'root/usr/share/rpcd/acl.d/router-status.json']) {
  assert(!/luci\.traffic|\/tmp\/traffic|\/usr\/share\/traffic|luci-app-traffic/.test(read(path.join(status, file))), `${file} depends on traffic`);
}
for (const file of ['root/usr/libexec/rpcd/luci.traffic', 'root/etc/init.d/traffic', 'root/usr/share/rpcd/acl.d/luci-app-traffic.json', 'Makefile']) {
  assert(!/getWireless|wifi-collector|wifi-history|getSystemMetrics|router\.status/.test(read(path.join(traffic, file))), `traffic still owns monitoring in ${file}`);
}
const acl = JSON.parse(read(path.join(status, 'root/usr/share/rpcd/acl.d/router-status.json')));
assert.deepEqual(acl['router-status'].read.ubus['router.status'].sort(), ['getSystemMetrics', 'getWirelessHistory', 'getWirelessStatus'].sort());
assert(!acl['router-status'].write, 'status ACL must be read-only');
console.log('Independent router status boundaries: PASS');

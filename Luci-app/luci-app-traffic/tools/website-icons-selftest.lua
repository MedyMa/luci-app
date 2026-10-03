local M = dofile(arg[1])
local files, stamp, requests = {}, 1000000, 0
local png = '\137PNG\13\10\26\10' .. string.rep('\0', 8) .. '\0\0\0\32\0\0\0\32' .. string.rep('\0', 16)
local env = {
  now = function() return stamp end,
  read = function(p) return files[p] and files[p].data end,
  write = function(p, data) files[p] = {data=data, mtime=stamp}; return true end,
  remove = function(p) files[p] = nil end,
  list = function() local a={}; for p in pairs(files) do a[#a+1]=p end; return a end,
  stat = function(p) local f=files[p]; return f and {size=#f.data, blocks=math.ceil(#f.data / 4096)*8, mtime=f.mtime} end,
  fetch = function(url) requests=requests+1; return png end
}
local function check(v, why) assert(v, why); print('ok '..why) end
check(not M.host('SSL/TLS') and not M.host('192.168.2.1') and not M.host('../example.com') and not M.host('router.local'), 'reject names and local destinations')
check(M.public('93.184.216.34') and not M.public('10.1.2.3') and not M.public('100.64.0.1') and not M.public('::1'), 'public IPv4 restriction')
check(M.public('240e:ff:e020:966:0:ff:b042:f296') and M.public('2606:4700:4700::1111') and
  M.public('2001:4860:4860:0:0:0:0:8888'), 'public IPv6 addresses including compressed notation')
for _,ip in ipairs({'::','::1','fc00::1','fd12::1','fe80::1','ff02::1',
  '::ffff:192.168.1.1','::ffff:c0a8:101','64:ff9b::c0a8:101','2001:db8::1',
  '2001::1','2002:c0a8:101::1','3fff::1','5f00::1','2606::1%eth0',
  '2606:::1','2606::1::2','2606:4700:1','2606:4700:0:0:0:0:0:0:1','2606:47000::1'}) do
  check(not M.public(ip), 'reject non-public or malformed IPv6 '..ip)
end
check(M.storage('/dev/nvme0n1p1 /mnt/nvme ext4 rw,relatime 0 0\n', function() return true end) == '/mnt/nvme/traffic-site-icons', 'automatic NVMe storage')
check(M.storage('/dev/nvme0n1p1 /mnt/nvme ext4 ro 0 0\n', function() return true end) == '/tmp/traffic-site-icons', 'read-only NVMe falls back')
check(M.storage('/dev/sda1 /mnt/usb ext4 rw 0 0\n', function() return true end) == '/tmp/traffic-site-icons', 'no writes to flash or arbitrary disks')
check(M.kind(png)=='png' and not M.kind('<html>error</html>') and not M.kind('<svg onload="evil()"/>'), 'raster signature validation')
check(not M.kind(png:sub(1,16)..'\0\0\16\0\0\0\16\0'), 'oversized dimensions rejected')
local function le4(n) return string.char(n%256,math.floor(n/256)%256,0,0) end
local ico='\0\0\1\0\1\0'..'\32\32\0\0\1\0\32\0'..le4(#png)..le4(22)..png
check(M.kind(ico)=='ico', 'bounded ICO accepted')
local large_png=png:sub(1,16)..'\0\0\16\0\0\0\16\0'..png:sub(25)
check(not M.kind(ico:sub(1,22)..large_png), 'embedded ICO PNG cannot bypass dimensions cap')
check(M.candidates('<LINK href="/assets/Logo.png" rel="icon">','example.com')[1]=='https://example.com/assets/Logo.png', 'relative favicon discovery preserves path case')
check(M.candidates('<link rel="icon" href="http://example.com/a.png">','example.com')[1]==nil, 'no HTTP fallback')
local r=M.run(env, {'example.com','second.com'}, {})
check(requests==1 and r.index:find('example.com\texample.com.png',1,true), 'one download per run and same-origin index')
M.run(env, {'example.com'}, {})
check(requests==1, 'fresh success not fetched again')
stamp=stamp+7*86400+1
M.run(env, {'example.com'}, {})
check(requests==2, 'seven day success refresh')
env.fetch=function() requests=requests+1; return nil end
local prior=files['example.com.png'].data
stamp=stamp+7*86400+1
M.run(env, {'example.com'}, {})
check(files['example.com.png'].data==prior, 'failed refresh preserves old artwork')
M.run(env, {'missing.com'}, {})
local first=requests
M.run(env, {'missing.com'}, {})
check(requests==first, '24 hour negative cache')
stamp=stamp+86401
M.run(env, {'missing.com'}, {})
check(requests>first, 'negative cache expires')
env.fetch=function() requests=requests+1; return string.rep('x',65537) end
M.run(env, {'large.com'}, {})
check(not files['large.com.png'], '64 KiB rejected before saving')
env.fetch=function(url) requests=requests+1; return png end
local before=requests
M.run(env, {'known.com'}, {['known.com']=true})
check(requests==before, 'packaged domain artwork wins')
env.fetch=function() error('simulated process interruption') end
check(not pcall(M.run,env,{'interrupted.com'},{}), 'interrupted download simulated')
env.fetch=function() error('should be backed off') end
check(pcall(M.run,env,{'interrupted.com'},{}), 'interrupted download retains 24 hour cooldown')
env.fetch=function() requests=requests+1; return png end
local manifest=files['records.tsv'].data
for i=1,300 do
  files['old'..i..'.com.png']={data=string.rep('x',65536),mtime=stamp-i}
  manifest=manifest..'old'..i..'.com\t'..(stamp-i)..'\t0\told'..i..'.com.png\n'
end
files['records.tsv'].data=manifest
M.run(env, {'new.com'}, {})
local bytes,count=0,0
for p,f in pairs(files) do bytes=bytes+math.ceil(#f.data/4096)*4096; if p:match('%.png$') then count=count+1 end end
check(bytes<=16*1024*1024 and count<=M.count, 'bounded cache including metadata')
local fullfiles, fetched={},{}
local fullenv={now=function() return stamp end,
  read=function(p) return fullfiles[p] end,
  write=function(p,data) fullfiles[p]=data; return true end,
  remove=function(p) fullfiles[p]=nil end,
  list=function() local r={}; for p in pairs(fullfiles) do r[#r+1]=p end; return r end,
  stat=function(p) return fullfiles[p] and {size=#fullfiles[p],blocks=8} end,
  fetch=function(url) fetched[url]=true; return png end}
local all={}; for i=1,300 do all[i]='site'..i..'.com' end
for i=1,300 do M.run(fullenv,all,{}) end
local successes=0; for _ in fullfiles['websites.tsv']:gmatch('[^\n]+') do successes=successes+1 end
check(successes==300, 'all 300 small website icons remain available beyond old 256 limit')
local oldcount=M.count; M.count=2; fullfiles={}; fetched={}
for i=1,6 do M.run(fullenv,{'first.com','second.com','third.com'},{}) end
check(fetched['https://third.com/favicon.ico'], 'bounded cache cannot starve later websites')
M.count=oldcount
print('website-icons-selftest: passed')

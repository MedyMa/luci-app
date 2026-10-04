-- Exercise the production nixio/curl adapter with in-memory files and DNS.
local core_path, runner_path=arg[1],arg[2]
local real_dofile,real_open,real_popen=dofile,io.open,io.popen
local png='\137PNG\13\10\26\10'..string.rep('\0',8)..'\0\0\0\32\0\0\0\32'..string.rep('\0',16)
local files={['/proc/mounts']='/dev/nvme0n1p1 /mnt/nvme ext4 rw 0 0\n'}
local dirs,links={['/mnt/nvme']=true},{}
local requests, private, locked=0,false,false
local real_time=os.time
local stamp,total_opens=1000000,0
local total_rows={'comfylink.com\t50\t20'}
os.time=function() return stamp end
local dns_case='ipv4'
local expected_pin='comfylink.com:443:93.184.216.34'
local function check_mode(mode, expected)
  assert(type(mode)=='string' and mode:match('^[0-7][0-7][0-7]$'),
    'nixio permissions must be an octal string, not a decimal integer')
  assert(mode==expected,'unexpected permissions')
end
local fs={
  readfile=function(p)
    if files[p] == nil then return nil,2,'No such file or directory' end
    return files[p]
  end,
  access=function(p) return dirs[p] end,
  mkdir=function(p,mode) check_mode(mode,'755'); dirs[p]=true; return true end,
  writefile=function(p,data) files[p]=data; return true end,
  lstat=function(p) return links[p] and {type='lnk'} end,
  readlink=function(p) return links[p] end,
  symlink=function(target,p) links[p]=target; return true end,
  unlink=function(p) files[p]=nil; links[p]=nil; return true end,
  rename=function(a,b) files[b]=files[a]; files[a]=nil; return true end,
  stat=function(p,field)
    if field=='dev' then return 10 end
    if files[p] then return {type='reg',size=#files[p],blocks=math.ceil(#files[p]/4096)*8} end
  end,
  dir=function(dir)
    local keys={}; for p in pairs(files) do if p:sub(1,#dir+1)==dir..'/' then keys[#keys+1]=p:sub(#dir+2) end end
    local i=0; return function() i=i+1; return keys[i] end
  end
}
package.loaded['nixio.fs']=fs
package.loaded.nixio={
  open=function(p,flags,mode)
    assert(p=='/tmp/traffic-website-icons.lock' and flags=='w','lock open contract')
    check_mode(mode,'600')
    return {lock=function() if locked then return nil end; locked=true; return true end,
    close=function() locked=false end} end,
  getaddrinfo=function(host,family)
    assert(family=='any','dual-stack DNS lookup')
    if private then return {{address=dns_case=='ipv6' and 'fd12::1' or '192.168.2.1'}} end
    if dns_case=='ipv6' then return {{address='240e:ff:e020:966:0:ff:b042:f296'}} end
    if dns_case=='dual' then return {{address='93.184.216.34'},
      {address='2606:4700:4700::1111'},{address='93.184.216.34'}} end
    return {{address='93.184.216.34'}}
  end
}
dofile=function(path) if path=='/usr/share/traffic/website-icons-core.lua' then path=core_path end; return real_dofile(path) end
io.open=function(path,mode)
  if path=='/tmp/traffic/totals.tsv' then
    total_opens=total_opens+1
    local i=0; return {lines=function() return function() i=i+1; return total_rows[i] end end,close=function() end}
  end
  return real_open(path,mode)
end
io.popen=function(command)
  requests=requests+1
  assert(command:find('--max-filesize 65536',1,true),'transfer cap')
  assert(command:find('--resolve',1,true) and command:find(expected_pin,1,true),'validated DNS pin')
  assert(command:find('--max-time 4 --connect-timeout 2',1,true),'dual-stack preserves time budget')
  assert(command:find('--noproxy "*"',1,true),'no proxy credentials')
  assert(not command:find(' -L',1,true),'no unchecked redirect')
  return {read=function() return png end,close=function() return true end}
end
dofile(runner_path)
assert(requests==1 and links['/www/traffic-site-icons']=='/mnt/nvme/traffic-site-icons','shared automatic NVMe cache')
assert(files['/mnt/nvme/traffic-site-icons/websites.tsv']:find('comfylink.com.png',1,true),'published index')
assert(files['/tmp/traffic/website-icons.metrics']:find('allocated_bytes=',1,true),'actual allocated space metric')
dofile(runner_path)
assert(requests==1,'warm adapter performs no transfer')
files['/mnt/nvme/traffic-site-icons/records.tsv']=nil
files['/mnt/nvme/traffic-site-icons/comfylink.com.png']=nil
private=true
dofile(runner_path)
assert(requests==1,'private DNS never reaches curl')
local function reset_cache()
  files['/mnt/nvme/traffic-site-icons/records.tsv']=nil
  files['/mnt/nvme/traffic-site-icons/comfylink.com.png']=nil
end
private=false; dns_case='ipv6'; reset_cache()
expected_pin='comfylink.com:443:[240e:ff:e020:966:0:ff:b042:f296]'
dofile(runner_path)
assert(requests==2 and files['/mnt/nvme/traffic-site-icons/websites.tsv']:find('comfylink.com.png',1,true),
  'IPv6-only site is fetched and published')
dns_case='dual'; reset_cache()
expected_pin='comfylink.com:443:[2606:4700:4700::1111],93.184.216.34'
dofile(runner_path)
assert(requests==3,'dual-stack list deduplicated and pinned in a single curl transfer')
private=true; dns_case='ipv6'; reset_cache()
dofile(runner_path)
assert(requests==3,'private IPv6 never reaches curl')
assert(total_opens==1,'minute worker reuses full scan snapshot for one hour')
for i=1,300 do total_rows[#total_rows+1]='site'..i..'.com\t1\t0' end
stamp=stamp+3600
dofile(runner_path)
assert(total_opens==2,'full website list scanned again after one hour')
assert(files['/tmp/traffic/website-icons.metrics']:find('candidate_sites=301',1,true),
  'hourly discovery includes all 301 websites without ranking cutoff')
assert(files['/tmp/traffic/website-sites.tsv']:find('site300.com',1,true),'later websites enter work queue')
for _,bad_stamp in ipairs({false,'','not-a-timestamp'}) do
  files['/tmp/traffic/website-sites.at']=bad_stamp or nil
  if bad_stamp==false then
    files['/tmp/traffic/website-sites.tsv']=nil
    files['/tmp/traffic/website-icons.metrics']=nil
  end
  local opens=total_opens
  dofile(runner_path)
  assert(total_opens==opens+1,'missing or invalid scan timestamp triggers fresh discovery')
  assert(tonumber(files['/tmp/traffic/website-sites.at'])==stamp,'scan timestamp restored')
  assert(files['/tmp/traffic/website-icons.metrics'],'metrics restored after reboot')
end
print('website-icons-runner-selftest: passed (permissions, NVMe, publish, IPv4/IPv6 DNS pin, no repeat transfer, private DNS, metrics)')
io.open,io.popen,dofile=real_open,real_popen,real_dofile
os.time=real_time

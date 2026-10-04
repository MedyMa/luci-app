#!/usr/bin/lua
local nixio,fs=require('nixio'),require('nixio.fs')
local M=dofile('/usr/share/traffic/website-icons-core.lua')
local F=dofile('/usr/share/traffic/website-icons-fetch.lua')
local lock=nixio.open('/tmp/traffic-website-icons.lock','w','600')
if not lock or not lock:lock('tlock') then os.exit(0) end
local started=os.clock()
local cache=M.storage(fs.readfile('/proc/mounts',65536),function(p) return fs.access(p,'w') end)
fs.mkdir(cache,'755')
if not fs.access(cache,'w') then cache='/tmp/traffic-site-icons'; fs.mkdir(cache,'755') end
local st=fs.lstat('/www/traffic-site-icons')
if not st or st.type=='lnk' then
  if fs.readlink('/www/traffic-site-icons')~=cache then
    fs.unlink('/www/traffic-site-icons'); fs.symlink(cache,'/www/traffic-site-icons')
  end
end
local cache_dev=fs.stat(cache,'dev')
local function quote(s) return "'"..s:gsub("'","'\\''").."'" end
local network_started=nixio.sysinfo().uptime
local fetch,network_stats=F.new(M,{
  now=function() return nixio.sysinfo().uptime end,
  resolve=function(host) return nixio.getaddrinfo(host,'any') end,
  request=function(url,host,ips,limit,seconds)
    -- Every hop is pinned separately. Headers/body are bounded in memory, with
    -- no temporary download files, proxy credentials, cookies or unchecked -L.
    local cmd='curl --silent --include --max-time '..seconds..' --connect-timeout '..math.min(3,seconds)..
      ' --max-filesize '..limit..' --proto "=https" --noproxy "*" --user-agent "TrafficIconCache/1.1" --resolve '..
      quote(host..':443:'..table.concat(ips,','))..' --url '..quote(url)..
      ' 2>/dev/null; printf "\\nTRAFFIC_CURL_EXIT:%s\\n" "$?"'
    local p=io.popen(cmd,'r'); if not p then return {reason='transfer'} end
    local raw=p:read(limit+16384+128); p:close()
    return F.response(raw,limit)
  end
})
local packaged={}
local pkg='/www/luci-static/resources/traffic/icons/'
local slugs={}
for line in (fs.readfile(pkg..'index.txt',131072) or ''):gmatch('[^\n]+') do slugs[line]=true end
for line in (fs.readfile(pkg..'domains.tsv',262144) or ''):gmatch('[^\n]+') do
  local host,key=line:match('^([^\t]+)\t([^\t]+)')
  if host and slugs[key] then packaged[host]=true end
end
local names,seen_names={},{}
local scan_file='/tmp/traffic/website-sites.tsv'
-- nixio returns nil, errno, message for a missing file. Keep only its first
-- value so errno cannot become tonumber's optional numeric-base argument.
local scan_stamp=fs.readfile('/tmp/traffic/website-sites.at',32)
local scan_at=tonumber(scan_stamp) or 0
local snapshot=fs.readfile(scan_file,8*1024*1024)
local now=os.time()
if not snapshot or now<scan_at or now-scan_at>=3600 then
 local input=io.open('/tmp/traffic/totals.tsv','r')
 if input then
  for line in input:lines() do
    local host=M.host(line:match('^([^\t]+)') or '')
    if host then
      local matched=slugs[host:gsub('[^a-z0-9]+','-')] or packaged[host]
      local parent=host
      while not matched and parent:find('.',1,true) do
        parent=parent:match('^[^.]+%.(.+)$'); matched=packaged[parent]
      end
      local root,suffix=host:match('^([^.]+)%.(.+)$')
      local suffixes={com=true,net=true,org=true,io=true,cn=true,ai=true,app=true,dev=true,co=true,tv=true,me=true,['com.cn']=true,['net.cn']=true,['org.cn']=true}
      if not matched and root and suffixes[suffix] then matched=slugs[root] end
      if not matched then
        if not seen_names[host] then names[#names+1]=host; seen_names[host]=true end
      end
    end
  end
  input:close()
 end
 table.sort(names)
 fs.writefile(scan_file,table.concat(names,'\n'))
 fs.writefile('/tmp/traffic/website-sites.at',tostring(now))
 scan_at=now
else
 for host in snapshot:gmatch('[^\n]+') do
   if M.host(host) and not seen_names[host] then names[#names+1]=host; seen_names[host]=true end
 end
end
-- Full hourly discovery, serial minute-by-minute downloads with a fair cursor.
local result=M.run({
  now=os.time, fetch=fetch,
  read=function(file) return fs.readfile(cache..'/'..file,4*1024*1024) end,
  stat=function(file) return fs.stat(cache..'/'..file) end,
  list=function()
    local files={}; for file in fs.dir(cache) do files[#files+1]=file end; return files
  end,
  remove=function(file) return fs.unlink(cache..'/'..file) end,
  write=function(file,data)
    -- A detached NVMe must not turn a cached path into writes on root flash.
    if fs.stat(cache,'dev')~=cache_dev then return nil end
    local temp=cache..'/'..file..'.new'
    if not fs.writefile(temp,data) then fs.unlink(temp); return nil end
    return fs.rename(temp,cache..'/'..file)
  end
},names,packaged)
local allocated=0
for file in fs.dir(cache) do
  local s=fs.stat(cache..'/'..file)
  if s and s.type=='reg' then allocated=allocated+(s.blocks or math.ceil(s.size/512))*512 end
end
fs.writefile('/tmp/traffic/website-icons.metrics',string.format(
  'cache=%s\nallocated_bytes=%d\nentries=%d\ncandidate_sites=%d\nscan_at=%d\nlua_heap_kib=%.1f\ncpu_seconds=%.4f\nnetwork_requests=%d\nwall_seconds=%d\nsampled_at=%d\n',
  cache,allocated,result.entries,#names,scan_at,collectgarbage('count'),os.clock()-started,
  network_stats.requests,nixio.sysinfo().uptime-network_started,os.time()))
lock:close()

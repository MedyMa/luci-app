#!/usr/bin/lua
local nixio,fs=require('nixio'),require('nixio.fs')
local M=dofile('/usr/share/traffic/website-icons-core.lua')
local lock=nixio.open('/tmp/traffic-website-icons.lock','w','600')
if not lock or not lock:lock('tlock') then os.exit(0) end
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
local function fetch(url,limit)
  if #url>2048 then return nil end
  local host=url:match('^https://([a-z0-9%.%-]+)/[^%s]*$')
  if not M.host(host) then return nil end
  local addresses=nixio.getaddrinfo(host,'any')
  if not addresses or #addresses==0 then return nil end
  local ipv6,ipv4,seen={},{},{}
  for _,a in ipairs(addresses) do
    if not M.public(a.address) then return nil end
    if not seen[a.address] then
      seen[a.address]=true
      local v6=a.address:find(':',1,true)
      local target=v6 and ipv6 or ipv4
      if #target<4 then target[#target+1]=v6 and '['..a.address..']' or a.address end
    end
  end
  for _,ip in ipairs(ipv4) do ipv6[#ipv6+1]=ip end
  -- Pin the validated address to prevent DNS rebinding. No proxies, cookies,
  -- redirects, credentials or router session headers are used by this client.
  local cmd='curl --silent --fail --max-time 4 --connect-timeout 2 --max-filesize '..limit..
    ' --proto "=https" --noproxy "*" --resolve '..quote(host..':443:'..table.concat(ipv6,','))..
    ' --url '..quote(url)..' 2>/dev/null'
  local p=io.popen(cmd,'r'); if not p then return nil end
  local data=p:read(limit+1)
  local ok=p:close()
  if not ok or not data or #data>limit then return nil end
  return data
end
local packaged={}
local pkg='/www/luci-static/resources/traffic/icons/'
local slugs={}
for line in (fs.readfile(pkg..'index.txt',131072) or ''):gmatch('[^\n]+') do slugs[line]=true end
for line in (fs.readfile(pkg..'domains.tsv',262144) or ''):gmatch('[^\n]+') do
  local host,key=line:match('^([^\t]+)\t([^\t]+)')
  if host and slugs[key] then packaged[host]=true end
end
local names,weights,scanned={},{},0
local input=io.open('/tmp/traffic/totals.tsv','r')
if input then
  for line in input:lines() do
    scanned=scanned+1
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
        if not weights[host] then names[#names+1]=host end
        local down,up=line:match('^[^\t]+\t(%d+)\t(%d+)')
        weights[host]=(weights[host] or 0)+(tonumber(down) or 0)+(tonumber(up) or 0)
      end
    end
    if scanned>=10000 or #names>=4096 then break end
  end
  input:close()
end
-- Cache the busiest 256 unknown sites; the complete UI list is never truncated.
-- A stable working set prevents negative-cache eviction from causing retry churn.
table.sort(names,function(a,b) return weights[a]==weights[b] and a<b or weights[a]>weights[b] end)
while #names>256 do table.remove(names) end
local started=os.clock()
local result=M.run({
  now=os.time, fetch=fetch,
  read=function(file) return fs.readfile(cache..'/'..file,262144) end,
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
  'cache=%s\nallocated_bytes=%d\nentries=%d\nlua_heap_kib=%.1f\ncpu_seconds=%.4f\nsampled_at=%d\n',
  cache,allocated,result.entries,collectgarbage('count'),os.clock()-started,os.time()))
lock:close()

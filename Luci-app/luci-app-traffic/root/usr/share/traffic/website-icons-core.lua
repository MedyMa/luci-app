-- Bounded website icon cache policy. Lua 5.1; IO/network supplied by the runner.
local M = {limit=65536, budget=16*1024*1024, count=256}
function M.host(name)
  if type(name)~='string' or #name>253 then return nil end
  name=name:lower()
  if not name:match('^[a-z0-9][a-z0-9%.%-]*%.[a-z]+$') then return nil end
  for part in name:gmatch('[^.]+') do
    if #part>63 or not part:match('^[a-z0-9]') or not part:match('[a-z0-9]$') then return nil end
  end
  if name:find('..',1,true) then return nil end
  local suffix=name:match('%.([^.]+)$')
  if #suffix<2 or ({['local']=true,localhost=true,internal=true,invalid=true,test=true,example=true,home=true,lan=true})[suffix] then return nil end
  return name
end
function M.public(ip)
  local a,b,c,d=ip:match('^(%d+)%.(%d+)%.(%d+)%.(%d+)$')
  a,b,c,d=tonumber(a),tonumber(b),tonumber(c),tonumber(d)
  return a and b and c and d and a>0 and a<224 and b<256 and c<256 and d<256 and
    a~=10 and a~=127 and not(a==169 and b==254) and not(a==172 and b>=16 and b<=31) and
    not(a==192 and (b==168 or b==0)) and not(a==100 and b>=64 and b<=127) and
    not(a==198 and (b==18 or b==19))
end
function M.storage(mounts, writable)
  local candidates={}
  for line in (mounts or ''):gmatch('[^\n]+') do
    local dev,path,kind,options=line:match('^(%S+)%s+(%S+)%s+(%S+)%s+(%S+)')
    if dev and dev:match('^/dev/nvme%d+n%d+p?%d*$') and path~='/' and path~='/overlay' and
       (','..options..','):find(',rw,',1,true) then
      path=path:gsub('\\(%d%d%d)', function(o) return string.char(tonumber(o,8)) end)
      if writable(path) then candidates[#candidates+1]=path end
    end
  end
  table.sort(candidates)
  return (#candidates>0 and candidates[1] or '/tmp')..'/traffic-site-icons'
end
local function be(s,p,n)
  local v=0; for i=p,p+n-1 do v=v*256+(s:byte(i) or 0) end; return v
end
local function le(s,p,n)
  local v=0; for i=p+n-1,p,-1 do v=v*256+(s:byte(i) or 0) end; return v
end
local function dimensions(w,h) return w>0 and h>0 and w<=1024 and h<=1024 end
function M.kind(s)
  if not s or #s<24 or #s>M.limit then return nil end
  if s:sub(1,8)=='\137PNG\13\10\26\10' and dimensions(be(s,17,4),be(s,21,4)) then return 'png' end
  if s:sub(1,4)=='\0\0\1\0' then
    local count=s:byte(5)+256*s:byte(6)
    if count<1 or count>8 or #s<6+count*16 then return nil end
    for i=1,count do
      local p=7+(i-1)*16
      local size,offset=le(s,p+8,4),le(s,p+12,4)
      if size<40 or offset<6+count*16 or offset+size>#s then return nil end
      local start=offset+1
      if s:sub(start,start+7)=='\137PNG\13\10\26\10' then
        if not dimensions(be(s,start+16,4),be(s,start+20,4)) then return nil end
      elseif not dimensions(le(s,start+4,4),le(s,start+8,4)/2) then return nil end
    end
    return 'ico'
  end
  -- PNG and ICO cover favicons without accepting active SVG or large animations.
end
function M.candidates(page, host)
  local result,seen={},{}
  for tag in (page or ''):gmatch('<[^>]+>') do
    if tag:sub(1,5):lower()=='<link' then
      local attrs={}
      for key,quote,value in tag:gmatch('([%w_-]+)%s*=%s*([\'"])(.-)%2') do attrs[key:lower()]=value end
      local rel=(attrs.rel or ''):lower()
      local href=attrs.href
      if href and ((' '..rel..' '):find(' icon ',1,true) or rel=='apple-touch-icon') then
        href=href:gsub('&amp;','&')
        if href:sub(1,2)=='//' then href='https:'..href
        elseif href:sub(1,1)=='/' then href='https://'..host..href
        elseif not href:find(':',1,true) then href='https://'..host..'/'..href end
        if href:match('^https://') and not seen[href] then
          seen[href]=true; result[#result+1]=href
          if #result>=3 then break end
        end
      end
    end
  end
  return result
end
local function trim(env, records)
  local entries,bytes,dirty={},0,false
  for host,r in pairs(records) do
    local stat=r.file~='' and env.stat(r.file)
    local size=stat and (stat.blocks and stat.blocks*512 or math.ceil(stat.size/4096)*4096) or 0
    if stat and stat.size>M.limit then env.remove(r.file); r.file=''; r.good=0; size=0; dirty=true end
    entries[#entries+1]={host=host,r=r,size=size}; bytes=bytes+size
  end
  table.sort(entries,function(a,b)
    local aa,bb=math.max(a.r.good,a.r.bad),math.max(b.r.good,b.r.bad)
    return aa==bb and a.host<b.host or aa<bb
  end)
  local count=#entries
  -- Reserve 512 KiB for both indexes, atomic replacements and one 64 KiB fetch.
  for _,e in ipairs(entries) do
    if count>M.count or bytes>M.budget-512*1024 then
      if e.r.file~='' then env.remove(e.r.file) end
      records[e.host]=nil; count=count-1; bytes=bytes-e.size; dirty=true
    else break end
  end
  return count,bytes,dirty
end
local function publish(env, records)
  local ordered={}; for host in pairs(records) do ordered[#ordered+1]=host end; table.sort(ordered)
  local manifest,index={},{}
  for _,host in ipairs(ordered) do
    local r=records[host]
    manifest[#manifest+1]=table.concat({host,r.good,r.bad,r.file},'\t')..'\n'
    if r.file~='' then index[#index+1]=host..'\t'..r.file..'\t'..r.good..'\n' end
  end
  manifest,index=table.concat(manifest),table.concat(index)
  if manifest~=(env.read('records.tsv') or '') and not env.write('records.tsv',manifest) then return nil end
  if index~=env.read('websites.tsv') then env.write('websites.tsv',index) end
  return index
end
function M.run(env, names, packaged)
  local records, now, dirty={},env.now(),false
  local old=env.read('records.tsv') or ''
  for line in old:gmatch('[^\n]+') do
    local host,good,bad,file=line:match('^([^\t]+)\t(%d+)\t(%d+)\t([^\t]*)$')
    if M.host(host) and (file=='' or file==host..'.png' or file==host..'.ico') then
      records[host]={good=tonumber(good),bad=tonumber(bad),file=file}
    end
  end
  -- Account actual allocation, not just compressed image sizes. Remove orphans
  -- left by interruption and all .new files, under the runner's exclusive lock.
  for _,file in ipairs(env.list()) do
    if file:match('%.new$') then env.remove(file)
    elseif file:match('%.png$') or file:match('%.ico$') then
      local host=file:gsub('%.[^.]+$','')
      if not records[host] or records[host].file~=file then env.remove(file); dirty=true end
    end
  end
  local active={}; for _,host in ipairs(names) do if M.host(host) then active[host]=true end end
  for host,r in pairs(records) do
    if r.file~='' and not env.stat(r.file) then r.file=''; r.good=0; dirty=true end
    if not active[host] and now-math.max(r.good,r.bad)>7*86400 then
      if r.file~='' then env.remove(r.file) end; records[host]=nil; dirty=true
    end
  end
  for _,name in ipairs(names) do
    local host=M.host(name)
    local r=host and records[host]
    if host and not packaged[host] and (not r or
       ((r.good==0 or now-r.good>=7*86400 or now<r.good) and
        (r.bad==0 or now-r.bad>=86400 or now<r.bad))) then
      r=r or {good=0,bad=0,file=''}
      -- Persist cooldown BEFORE DNS/download. A killed/timed-out task must not
      -- retry the same unresponsive site on every minute of the collector.
      r.bad=now; records[host]=r
      local count,bytes=trim(env,records)
      if not publish(env,records) then return {index='',entries=count,bytes=bytes,dirty=true} end
      local data=env.fetch('https://'..host..'/favicon.ico',M.limit)
      local kind=M.kind(data)
      if not kind then
        local page=env.fetch('https://'..host..'/',M.limit)
        for _,url in ipairs(M.candidates(page,host)) do
          data=env.fetch(url,M.limit); kind=M.kind(data); if kind then break end
        end
      end
      if kind then
        local file=host..'.'..kind
        if env.write(file,data) then
          if r.file~='' and r.file~=file then env.remove(r.file) end
          r.file=file; r.good=now; r.bad=0
        else r.bad=now end
      else r.bad=now end
      records[host]=r; dirty=true; break -- one site per pass, never a download burst
    end
  end
  local count,bytes,trimmed=trim(env,records)
  local index=publish(env,records) or ''
  return {index=index,entries=count,bytes=bytes,dirty=dirty or trimmed}
end
return M

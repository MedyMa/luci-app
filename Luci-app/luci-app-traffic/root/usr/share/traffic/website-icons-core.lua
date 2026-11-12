-- Bounded website icon cache policy. Lua 5.1; IO/network supplied by the runner.
local M = {limit=65536, page_limit=131072, budget=16*1024*1024, count=4096}
local source=debug.getinfo(1,'S').source:sub(2)
local S=dofile(source:gsub('website%-icons%-core.lua$','website-icons-formats.lua'))
function M.host(name)
  if type(name)~='string' or #name>253 then return nil end
  name=name:lower():gsub('%.$','')
  if not name:match('^[a-z0-9][a-z0-9%.%-]*%.[a-z0-9%-]+$') then return nil end
  for part in name:gmatch('[^.]+') do
    if #part>63 or not part:match('^[a-z0-9]') or not part:match('[a-z0-9]$') then return nil end
  end
  if name:find('..',1,true) then return nil end
  local suffix=name:match('%.([^.]+)$')
  if #suffix<2 or not(suffix:match('^[a-z]+$') or suffix:match('^xn%-%-[a-z0-9%-]+$')) or
    ({['local']=true,localhost=true,internal=true,invalid=true,test=true,example=true,home=true,lan=true})[suffix] then return nil end
  return name
end
-- Match the App/LuCI lookup boundary. Unknown suffixes stay exact-only. Never
-- turn a tenant's favicon into the mark for a different shared-hosting tenant.
local suffixes={}
for suffix in ('com net org io cn ai app dev co tv me com.cn net.cn org.cn gov.cn edu.cn '..
  'co.uk org.uk ac.uk gov.uk net.uk com.au net.au org.au edu.au gov.au '..
  'co.jp ne.jp or.jp ac.jp go.jp co.nz net.nz org.nz co.kr com.tw com.hk com.sg com.br co.in co.za '..
  'github.io gitlab.io codeberg.page pages.dev workers.dev vercel.app netlify.app appspot.com '..
  'firebaseapp.com web.app blogspot.com blogspot.co.uk wordpress.com notion.site cloudfront.net '..
  'azurewebsites.net azurestaticapps.net herokuapp.com readthedocs.io readthedocs.org surge.sh '..
  'duckdns.org ddns.net synology.me myqnapcloud.com r2.dev'):gmatch('%S+') do suffixes[suffix]=true end
function M.parents(host)
  local result,labels={},{}
  if not M.host(host) or host:match('%.amazonaws%.com$') then return result end
  for word in host:gmatch('[^.]+') do labels[#labels+1]=word end
  local boundary
  for i=2,#labels do
    if suffixes[table.concat(labels,'.',i)] then boundary=i; break end
  end
  if boundary then
    for i=2,boundary-1 do result[#result+1]=table.concat(labels,'.',i) end
  end
  return result
end
function M.public(ip)
  if type(ip)~='string' then return false end
  if ip:find(':',1,true) then
    -- Only ordinary global unicast IPv6. Reject scoped, mapped, translation,
    -- tunnelling and special-use addresses rather than reaching local services.
    if not ip:match('^[0-9a-fA-F:]+$') then return false end
    local left,right=ip:match('^(.-)::(.-)$')
    local groups={}
    local function parse(part)
      if part=='' then return true end
      if part:sub(1,1)==':' or part:sub(-1)==':' or part:find('::',1,true) then return false end
      for word in part:gmatch('[^:]+') do
        if #word>4 then return false end
        groups[#groups+1]=tonumber(word,16)
      end
      return true
    end
    if left then
      if not parse(left) then return false end
      local nleft=#groups
      if not parse(right) or #groups>=8 then return false end
      local missing=8-#groups
      for i=1,missing do table.insert(groups,nleft+1,0) end
    elseif not parse(ip) or #groups~=8 then return false end
    local a,b=groups[1],groups[2]
    return a>=0x2000 and a<0x4000 and a~=0x2002 and
      not(a==0x2001 and (b<0x200 or b==0xdb8)) and
      not(a==0x3fff and b<0x1000)
  end
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
function M.image(s)
  local kind=M.kind(s)
  if kind then return s,kind end
  local clean=S.svg(s,M.limit)
  if clean then return clean,'svg' end
  return nil,nil,'unsupported_format'
end
function M.inline(uri)
  if type(uri)~='string' or #uri>3*M.limit then return nil end
  local mime,params,encoded=uri:match('^data:(image/[%w.+-]+)([^,]*),(.+)$')
  local kinds={['image/png']='png',['image/x-icon']='ico',['image/ico']='ico',['image/icon']='ico',['image/vnd.microsoft.icon']='ico',['image/svg+xml']='svg'}
  if not mime or not kinds[mime:lower()] then return nil end
  mime,params=mime:lower(),params:lower()
  local decoded
  if params==';base64' or params==';charset=utf-8;base64' then decoded=S.base64(encoded,M.limit)
  elseif mime=='image/svg+xml' and (params=='' or params==';charset=utf-8') then
    if encoded:gsub('%%%x%x',''):find('%%') then return nil end
    decoded=encoded:gsub('%%(%x%x)',function(n) return string.char(tonumber(n,16)) end)
  end
  local data,kind=M.image(decoded)
  if kind==kinds[mime] then return data,kind end
end
local function entity(s)
  return (s:gsub('&amp;','&'):gsub('&quot;','"'):gsub('&apos;',"'"):gsub('&#[xX](%x+);',function(n)
    n=tonumber(n,16); return n and n>=32 and n<127 and string.char(n) or ''
  end):gsub('&#(%d+);',function(n)
    n=tonumber(n); return n and n>=32 and n<127 and string.char(n) or ''
  end))
end
-- Resolve only ordinary HTTPS URLs. Redirect destinations use the same parser.
function M.url(base, href)
  if type(base)~='string' or type(href)~='string' or #href>2048 or href:find('[%s%c\\]') then return nil end
  href=href:gsub('#.*$','')
  if href:sub(1,2)=='//' then href='https:'..href end
  if not href:match('^[%a][%w+.-]*:') then
    local origin,path=base:match('^(https://[^/]+)(/.*)$')
    if not origin then origin=base:match('^(https://[^/]+)$'); path='/' end
    if not origin then return nil end
    path=path:gsub('%?.*$','')
    if href:sub(1,1)=='/' then href=origin..href
    elseif href:sub(1,1)=='?' then href=origin..path..href
    elseif href=='' then href=base:gsub('#.*$','')
    else href=origin..(path:match('^(.*)/') or '')..'/'..href end
  end
  local authority,path=href:match('^https://([^/?#]+)(.*)$')
  if not authority then return nil end
  authority=authority:lower():gsub(':443$','')
  authority=M.host(authority)
  if not authority then return nil end
  if path=='' or path:sub(1,1)=='?' then path='/'..path end
  local query=path:match('(%?.*)$') or ''
  local raw=path:gsub('%?.*$','')
  local parts={}
  -- Empty segments are meaningful: /icons//logo.png may be a different resource.
  for part in (raw..'/'):gmatch('(.-)/') do
    if part=='..' then
      if #parts>1 then table.remove(parts) end
    elseif part~='.' then parts[#parts+1]=part end
  end
  if raw:match('/%.%.?$') then parts[#parts+1]='' end
  local normalized=table.concat(parts,'/')
  if normalized=='' then normalized='/' end
  return 'https://'..authority..normalized..query
end
local function attributes(tag)
  local attrs={}
  -- Remove quoted values before handling unquoted ones, so spaces inside quoted
  -- URLs do not become new attributes and every form follows one validation path.
  local rest=tag:gsub('([%w_-]+)%s*=%s*([\'"])(.-)%2',function(key,quote,value)
    attrs[key:lower()]=entity(value); return ''
  end)
  for key,value in rest:gmatch('([%w_-]+)%s*=%s*([^%s>]+)') do
    if not attrs[key:lower()] then attrs[key:lower()]=entity(value) end
  end
  return attrs
end
local function links(page, host)
  local base=host:match('^https://') and host or 'https://'..host..'/'
  page=(page or ''):sub(1,M.page_limit):gsub('<!%-%-.-%-%->','')
  page=page:gsub('<[sS][cC][rR][iI][pP][tT][^>]*>.-</[sS][cC][rR][iI][pP][tT]%s*>','')
    :gsub('<[sS][tT][yY][lL][eE][^>]*>.-</[sS][tT][yY][lL][eE]%s*>','')
  local head_end=page:lower():find('</head',1,true)
  if head_end then page=page:sub(1,head_end-1) end
  for tag in page:gmatch('<[^>]+>') do
    if tag:lower():match('^<base[%s>]') then
      local href=attributes(tag).href
      -- HTML selects the first base carrying href, even when our HTTPS policy
      -- rejects it. In that case only explicit HTTPS icon URLs remain eligible.
      if href~=nil then base=M.url(base,href); break end
    end
  end
  local result={}
  for tag in page:gmatch('<[^>]+>') do
    if tag:lower():match('^<link[%s>]') then
      local attrs=attributes(tag)
      attrs.rel=(attrs.rel or ''):lower():gsub('%s+',' ')
      result[#result+1]=attrs
      if #result>=128 then break end
    end
  end
  return result,base
end
local function ranked(entries,base,limit)
  local all,seen={},{}
  for _,attrs in ipairs(entries) do
    local href=type(attrs.href)=='string' and attrs.href or attrs.src
    if type(href)~='string' then href=nil end
    href=href and (href:match('^data:') and (M.inline(href) and href) or M.url(base or '',href))
    local ext=href and href:lower():gsub('%?.*$',''):match('%.([a-z]+)$')
    local mime=(attrs.type or ''):lower():gsub(';.*$',''):gsub('^%s+',''):gsub('%s+$','')
    local unsupported=({webp=true,gif=true,jpg=true,jpeg=true,avif=true})[ext or ''] or
      (mime~='' and not ({['image/png']=true,['image/x-icon']=true,['image/ico']=true,['image/icon']=true,['image/vnd.microsoft.icon']=true,['image/svg+xml']=true,['application/octet-stream']=true})[mime])
    if href and not unsupported and not seen[href] then
      seen[href]=true
      local vector=ext=='svg' or mime=='image/svg+xml' or href:match('^data:image/svg')
      local score=vector and 0 or 100
      if ext=='png' or mime=='image/png' then score=score+10 end
      local size=0
      for w,h in (attrs.sizes or ''):lower():gmatch('(%d+)x(%d+)') do
        w,h=tonumber(w),tonumber(h)
        if w==h and w>=32 and w<=256 then size=math.max(size,w) end
      end
      if size>0 then score=score+20+size/256 end
      all[#all+1]={href=href,score=score,order=#all+1}
    end
  end
  table.sort(all,function(a,b) return a.score==b.score and a.order<b.order or a.score>b.score end)
  local result={}; for i=1,math.min(limit,#all) do result[#result+1]=all[i].href end
  return result
end
function M.candidates(page, host)
  local found,base=links(page,host)
  local icons={}
  for _,attrs in ipairs(found) do
    local rel=' '..attrs.rel..' '
    if rel:find(' icon ',1,true) or rel:find(' apple-touch-icon ',1,true) or
      rel:find(' apple-touch-icon-precomposed ',1,true) then icons[#icons+1]=attrs end
  end
  return ranked(icons,base,3)
end
function M.manifests(page, host)
  local found,base=links(page,host)
  local result={}
  for _,attrs in ipairs(found) do
    if (' '..attrs.rel..' '):find(' manifest ',1,true) then
      local href=M.url(base or '',attrs.href)
      if href then result[#result+1]=href; if #result>=2 then break end end
    end
  end
  return result
end
function M.manifest_candidates(value, base)
  local entries={}
  if type(value)=='table' and type(value.icons)=='table' then
    for i,icon in ipairs(value.icons) do
      if i>32 then break end
      if type(icon)=='table' and type(icon.src)=='string' and
        (icon.type==nil or type(icon.type)=='string') and
        (icon.sizes==nil or type(icon.sizes)=='string') then entries[#entries+1]=icon end
    end
  end
  return ranked(entries,base,2)
end
local function cooldown(reason)
  if ({dns=true,connect=true,timeout=true,tls=true,transfer=true,budget=true,interrupted=true,storage=true,http_429=true,http_500=true,http_502=true,http_503=true,http_504=true})[reason] then return 900 end
  return 86400
end
local function trim(env, records)
  local entries,bytes,dirty,metadata={},0,false,0
  for host,r in pairs(records) do
    local stat=r.file~='' and env.stat(r.file)
    local size=stat and (stat.blocks and stat.blocks*512 or math.ceil(stat.size/4096)*4096) or 0
    if stat and stat.size>M.limit then env.remove(r.file); r.file=''; r.good=0; size=0; dirty=true end
    -- Allow both current and atomic replacement indexes, including blocks.
    local meta=2*(#host+33+#r.file+#(r.reason or '')+(r.file~='' and #host+16+#r.file or 0))
    metadata=metadata+meta
    entries[#entries+1]={host=host,r=r,size=size,meta=meta}; bytes=bytes+size
  end
  table.sort(entries,function(a,b)
    local aa,bb=math.max(a.r.good,a.r.bad),math.max(b.r.good,b.r.bad)
    return aa==bb and a.host<b.host or aa<bb
  end)
  local count=#entries
  -- The 16 MiB cap includes growing metadata, not just compressed images.
  for _,e in ipairs(entries) do
    if count>M.count or bytes>M.budget-math.max(512*1024,metadata+128*1024) then
      if e.r.file~='' then env.remove(e.r.file) end
      records[e.host]=nil; count=count-1; bytes=bytes-e.size; metadata=metadata-e.meta; dirty=true
    else break end
  end
  return count,bytes,dirty
end
local function publish(env, records)
  local ordered={}; for host in pairs(records) do ordered[#ordered+1]=host end; table.sort(ordered)
  local manifest,index={},{}
  for _,host in ipairs(ordered) do
    local r=records[host]
    manifest[#manifest+1]=table.concat({host,r.good,r.bad,r.file,r.reason or ''},'\t')..'\n'
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
    local host,good,bad,file,reason=line:match('^([^\t]+)\t(%d+)\t(%d+)\t([^\t]*)\t?([^\t]*)$')
    if M.host(host) and (file=='' or file==host..'.png' or file==host..'.ico' or file==host..'.svg') then
      records[host]={good=tonumber(good),bad=tonumber(bad),file=file,
        reason=reason and reason:match('^[a-z0-9_]*$') and reason:sub(1,32) or ''}
    end
  end
  -- Account actual allocation, not just compressed image sizes. Remove orphans
  -- left by interruption and all .new files, under the runner's exclusive lock.
  for _,file in ipairs(env.list()) do
    if file:match('%.new$') then env.remove(file)
    elseif file:match('%.png$') or file:match('%.ico$') or file:match('%.svg$') then
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
  local cursor=env.read('scan-cursor.txt') or ''
  local start=0; for i,name in ipairs(names) do if name==cursor then start=i; break end end
  for offset=1,#names do
    local name=names[(start+offset-1)%#names+1]
    local host=M.host(name)
    local r=host and records[host]
    if host and not packaged[host] and (not r or
       ((r.good==0 or now-r.good>=7*86400 or now<r.good) and
        (r.bad==0 or now-r.bad>=cooldown(r.reason) or now<r.bad))) then
      r=r or {good=0,bad=0,file=''}
      -- Persist cooldown BEFORE DNS/download. A killed/timed-out task must not
      -- retry the same unresponsive site on every minute of the collector.
      r.bad=now; r.reason='interrupted'; records[host]=r
      env.write('scan-cursor.txt',host)
      local count,bytes=trim(env,records)
      if not publish(env,records) then return {index='',entries=count,bytes=bytes,dirty=true} end
      local data,kind,reason
      local origins,seen={host},{[host]=true}
      local parents=M.parents(host)
      local root=parents[#parents] or host
      for _,origin in ipairs({root,'www.'..root}) do
        if M.host(origin) and not seen[origin] then origins[#origins+1]=origin; seen[origin]=true end
      end
      for _,origin in ipairs(origins) do
        local final,why
        local function icon(url)
          if url:match('^data:') then data,kind=M.inline(url); why=nil
          else data,final,why=env.fetch(url,M.limit); data,kind=M.image(data) end
          reason=why or (not kind and 'unsupported_format') or reason
          return kind~=nil
        end
        -- Keep the inexpensive conventional icon path. Modern declarations and
        -- manifests fill the gaps, under the same shared fetch/deadline budget.
        icon('https://'..origin..'/favicon.ico')
        local page,page_url,page_why
        if not kind then
          page,page_url,page_why=env.fetch('https://'..origin..'/',M.page_limit)
          reason=page_why or (page and 'no_supported_icon') or reason
          for _,url in ipairs(M.candidates(page,page_url or origin)) do if icon(url) then break end end
        end
        if not kind and env.decode then
          for _,url in ipairs(M.manifests(page,page_url or origin)) do
            local text,manifest_url,manifest_why=env.fetch(url,M.limit)
            reason=manifest_why or reason
            if text then
              local ok,value=pcall(env.decode,text)
              if ok then
                for _,candidate in ipairs(M.manifest_candidates(value,manifest_url or url)) do if icon(candidate) then break end end
              end
            end
            if kind then break end
          end
        end
        if kind then break end
        if reason=='budget' then break end
      end
      if kind then
        local file=host..'.'..kind
        if env.write(file,data) then
          if r.file~='' and r.file~=file then env.remove(r.file) end
          r.file=file; r.good=now; r.bad=0; r.reason='ok'
        else r.bad=now; r.reason='storage' end
      else r.bad=now; r.reason=reason or 'no_supported_icon' end
      records[host]=r; dirty=true; break -- one site per pass, never a download burst
    end
  end
  local count,bytes,trimmed=trim(env,records)
  local index=publish(env,records) or ''
  return {index=index,entries=count,bytes=bytes,dirty=dirty or trimmed}
end
return M

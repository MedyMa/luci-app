-- HTTP discovery without unchecked curl redirects. Lua 5.1, injectable IO.
local F={}
function F.response(raw,limit)
  if not raw then return {reason='transfer'} end
  local output,code=raw:match('^(.*)\nTRAFFIC_CURL_EXIT:(%d+)\n$')
  code=tonumber(code)
  if not output or not code then return {reason='transfer'} end
  if code~=0 then
    return {reason=({[6]='dns',[7]='connect',[28]='timeout',[35]='tls',[51]='tls',[58]='tls',[60]='tls',[63]='too_large'})[code] or 'transfer'}
  end
  local consumed,status,location=0
  while output:match('^HTTP/') do
    local ending,last=output:find('\r\n\r\n',1,true)
    if not ending then ending,last=output:find('\n\n',1,true) end
    if not ending or consumed+last>16384 then return {reason='headers'} end
    local head=output:sub(1,ending-1)
    status=tonumber(head:match('^HTTP/%S+%s+(%d+)'))
    location=nil
    for line in head:gmatch('[^\r\n]+') do
      local key,value=line:match('^([^:]+):%s*(.-)%s*$')
      if key and key:lower()=='location' then location=value end
    end
    consumed=consumed+last; output=output:sub(last+1)
    -- Only informational/proxy preamble blocks can be followed by headers;
    -- a body beginning with HTTP/ must stay a body.
    if not status or not (status<200 or head:lower():find('connection established',1,true)) then break end
  end
  if not status then return {reason='headers'} end
  if #output>limit then return {reason='too_large'} end
  return {status=status,location=location,body=output}
end
function F.new(M,io)
  local deadline=io.now()+16
  local stats={requests=0}
  local function fetch(url,limit)
    local seen={}
    for hop=0,3 do
      url=M.url(url,url)
      if not url then return nil,nil,'unsafe_url' end
      if seen[url] then return nil,nil,'redirect_loop' end
      seen[url]=true
      if stats.requests>=8 or io.now()>=deadline then return nil,nil,'budget' end
      local host=url:match('^https://([^/]+)/')
      local addresses=io.resolve(host)
      if not addresses or #addresses==0 then return nil,nil,'dns' end
      local ipv6,ipv4,known={},{},{}
      for _,a in ipairs(addresses) do
        if not M.public(a.address) then return nil,nil,'private_address' end
        if not known[a.address] then
          known[a.address]=true
          local v6=a.address:find(':',1,true)
          local target=v6 and ipv6 or ipv4
          if #target<4 then target[#target+1]=v6 and '['..a.address..']' or a.address end
        end
      end
      for _,ip in ipairs(ipv4) do ipv6[#ipv6+1]=ip end
      local remaining=deadline-io.now()
      if remaining<=0 then return nil,nil,'budget' end
      stats.requests=stats.requests+1
      local r=io.request(url,host,ipv6,limit,math.min(6,remaining))
      if not r or r.reason then return nil,nil,r and r.reason or 'transfer' end
      if r.status==301 or r.status==302 or r.status==303 or r.status==307 or r.status==308 then
        if hop==3 then return nil,nil,'redirect_limit' end
        url=r.location and M.url(url,r.location)
        if not url then return nil,nil,'unsafe_url' end
      elseif r.status and r.status>=200 and r.status<300 then
        return r.body,url
      else return nil,nil,'http_'..tostring(r.status or 0) end
    end
  end
  return fetch,stats
end
return F

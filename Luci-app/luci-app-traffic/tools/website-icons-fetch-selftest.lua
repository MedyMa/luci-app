local M=dofile(arg[1]); local F=dofile(arg[2])
local stamp,requests,dns=0,{},{}
local replies={}
local fetch=F.new(M,{
 now=function() return stamp end,
 resolve=function(host) dns[#dns+1]=host; return {{address=host=='private.com' and '192.168.2.1' or '93.184.216.34'}} end,
 request=function(url,host,ips,limit,seconds)
   assert(host==url:match('^https://([^/]+)')); assert(ips[1]=='93.184.216.34')
   assert(seconds<=6 and limit==65536); requests[#requests+1]=url
   return replies[url] or {status=404,body=''}
 end
})
replies['https://example.com/favicon.ico']={status=302,location='https://www.example.com/icons/logo.png'}
replies['https://www.example.com/icons/logo.png']={status=200,body='image'}
local data,final=fetch('https://example.com/favicon.ico',65536)
assert(data=='image' and final=='https://www.example.com/icons/logo.png' and #dns==2,'redirect target independently resolved')
replies['https://example.com/private']={status=302,location='https://private.com/i'}
local before=#requests; local _,_,reason=fetch('https://example.com/private',65536)
assert(reason=='private_address' and #requests==before+1,'private redirect blocked before request')
replies['https://example.com/plain']={status=302,location='http://example.com/icon'}
_,_,reason=fetch('https://example.com/plain',65536); assert(reason=='unsafe_url','no downgrade')
replies['https://example.com/loop']={status=302,location='/loop'}
_,_,reason=fetch('https://example.com/loop',65536); assert(reason=='redirect_loop','redirect loops bounded')
stamp=17; before=#requests
_,_,reason=fetch('https://example.com/late',65536)
assert(reason=='budget' and #requests==before,'deadline stops transfers')
local raw='HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 200\r\nContent-Type: image/png\r\n\r\nabc\nTRAFFIC_CURL_EXIT:0\n'
local reply=F.response(raw,65536)
assert(reply.status==200 and reply.body=='abc','header blocks and exit trailer parsed')
assert(F.response('HTTP/2 200\r\n\r\npartial\nTRAFFIC_CURL_EXIT:28\n',65536).reason=='timeout','partial timed-out body not accepted')
assert(F.response('HTTP/2 302\r\nLocation: /logo.png\r\n\r\n\nTRAFFIC_CURL_EXIT:0\n',65536).location=='/logo.png','redirect header extracted')
assert(F.response('HTTP/2 200\r\n\r\n'..string.rep('x',65537)..'\nTRAFFIC_CURL_EXIT:0\n',65536).reason=='too_large','payload bounded')
assert(F.response('broken',65536).reason=='transfer','truncated output rejected')
local calls=0
local bounded=F.new(M,{now=function() return 0 end,resolve=function() return {{address='93.184.216.34'}} end,
 request=function() calls=calls+1; return {status=200,body='ok'} end})
for i=1,8 do assert(bounded('https://example.com/'..i,65536)=='ok') end
_,_,reason=bounded('https://example.com/ninth',65536)
assert(reason=='budget' and calls==8,'total task request cap')
calls=0
local hops=F.new(M,{now=function() return 0 end,resolve=function() return {{address='93.184.216.34'}} end,
 request=function() calls=calls+1; return {status=302,location='/'..calls} end})
_,_,reason=hops('https://example.com/start',65536)
assert(reason=='redirect_limit' and calls==4,'maximum three redirect hops')
assert(M.url('https://example.com/a?x=1','')=='https://example.com/a?x=1','query retained')
assert(M.url('https://example.com/a/b/','..')=='https://example.com/a/','directory dot segment retained')
assert(F.response('HTTP/2 200\r\nX: '..string.rep('x',16384)..'\r\n\r\na\nTRAFFIC_CURL_EXIT:0\n',65536).reason=='headers','header cap')
print('website-icons-fetch-selftest: passed')

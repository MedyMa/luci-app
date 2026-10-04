local M=dofile(arg[1])
local png='\137PNG\13\10\26\10'..string.rep('\0',8)..'\0\0\0\32\0\0\0\32'..string.rep('\0',16)
local svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#123abc" d="M0 0h32v32H0z"/></svg>'
local function check(value,label) assert(value,label) end
local function b64(s)
 local chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
 local out={}
 for i=1,#s,3 do
  local a,b,c=s:byte(i,i+2); local n=a*65536+(b or 0)*256+(c or 0)
  local x,y,z,w=math.floor(n/262144)%64,math.floor(n/4096)%64,math.floor(n/64)%64,n%64
  out[#out+1]=chars:sub(x+1,x+1)..chars:sub(y+1,y+1)..(b and chars:sub(z+1,z+1) or '=')..(c and chars:sub(w+1,w+1) or '=')
 end
 return table.concat(out)
end
local data,kind=M.image(svg)
check(kind=='svg' and data:find('width="64"',1,true),'static SVG accepted and normalized')
check(M.image(data)==data,'normalized SVG is idempotent')
local uri='data:image/png;base64,'..b64(png)
data,kind=M.inline(uri)
check(data==png and kind=='png','inline PNG decoded and validated')
data,kind=M.inline('data:image/svg+xml;base64,'..b64(svg))
check(kind=='svg' and data:find('viewBox="0 0 32 32"',1,true),'inline static SVG')
local ico='\0\0\1\0\1\0'..'\32\32\0\0\1\0\32\0'..string.char(#png,0,0,0,22,0,0,0)..png
check(select(2,M.inline('data:image/x-icon;base64,'..b64(ico)))=='ico','inline ICO')
for _,bad in ipairs({'data:image/png;base64,!!!!','data:image/png;base64,AAA',
 'data:image/png;base64,AA=A','data:image/png;base64,AB==',
 'data:image/png;base64,AAB=','data:text/html;base64,'..b64(png),
 'data:image/png;base64,'..b64(svg), 'data:image/png;base64,'..b64(string.rep('x',65537))}) do
 check(not M.inline(bad),'reject malformed, mislabeled or oversized inline data')
end
for _,bad in ipairs({
 '<svg onload="alert(1)" viewBox="0 0 32 32"/>',
 '<svg viewBox="0 0 32 32"><script>alert(1)</script></svg>',
 '<svg viewBox="0 0 32 32"><image href="https://example.com/a.png"/></svg>',
 '<svg viewBox="0 0 32 32"><use href="#a"/></svg>',
 '<!DOCTYPE svg [<!ENTITY a SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 32 32"/>',
 '<svg viewBox="0 0 32 32"><path style="fill:url(https://example.com/)"/></svg>',
 '<svg viewBox="0 0 32 32"><path fill="url(&#104;ttps://example.com/)"/></svg>',
 '<svg xmlns="http://evil.example/" viewBox="0 0 32 32"/>',
 '<svg viewBox="0 0 32 32"><foreignObject/></svg>',
 '<svg viewBox="0 0 32 32"><path d="M0 0"/></g>',
 '<svg viewBox="0 0 32 32"/><svg viewBox="0 0 32 32"/>',
 '<svg viewBox="0 0 32 32" fill="red" fill="blue"/>',
 '<svg viewBox="0 0 99999 99999"/>',
 '<svg viewBox="0 0 32 32"><path d="M1e999 0"/></svg>',
 '<svg viewBox="0 0 32 32"><path d="M0 0 L"/></svg>',
 '<svg viewBox="0 0 32 32"><path d="M0"/></svg>',
 '<svg viewBox="0 0 32 32"><path d="L0 0"/></svg>',
 '<svg viewBox="0 0 32 32"><path d="M0 0z0"/></svg>',
 '<svg viewBox="0 0 32 32"><path d="M0 0 A1 1 0 7 9 10 10"/></svg>',
 '<svg viewBox="0 0 32 32"><path d="M0 0 A-1 1 0 0 0 10 10"/></svg>',
 '<svg viewBox="0 0 32 32"><path d="M0 0 L32 0" stroke="black" stroke-dasharray="1e-300 1e-300"/></svg>',
 '<svg viewBox="0 0 32 32"><path d="M0 0 L32 0" stroke="black" stroke-dasharray="1 1"/></svg>',
 '<svg viewBox="0 0 32 32"><path d="M0 0 L32 0" stroke="black" stroke-dasharray="1 -1"/></svg>',
 '<svg viewBox="0 0 32 32"><defs><clipPath id="c"><path d="M0 0h32v32z" clip-path="url(#c)"/></clipPath></defs><path d="M0 0h32v32z" clip-path="url(#c)"/></svg>',
 '<svg viewBox="0 0 32 32"><g transform="scale(4096) scale(4096)"><path d="M0 0h32v32z"/></g></svg>',
 '<svg viewBox="0 0 32 32"><g transform="scale(4096)"><g transform="scale(4096)"><path d="M0 0h32v32z"/></g></g></svg>',
 '<svg viewBox="0 0 1e-300 1e-300"><path d="M0 0h32v32z"/></svg>',
 '<svg viewBox="0 0 32 32"><path fill="url(#missing)"/></svg>',
 '<svg viewBox="0 0 32 32"><g id="a"/><path fill="url(#a)"/></svg>',
 '<svg viewBox="0 0 32 32">'..string.rep('<g>',17)..string.rep('</g>',17)..'</svg>',
 '<svg viewBox="0 0 32 32">'..string.rep('<path d="M0 0"/>',256)..'</svg>',
 '<svg viewBox="0 0 32 32"><path d="M'..string.rep('0 ',4097)..'"/></svg>',
 '<svg viewBox="0 0 32 32" width="4096" height="4096"/>',
 '<svg viewBox="0 0 32 32"><!-- '..string.rep('x',65536)..' --></svg>'}) do
 check(not M.image(bad),'reject unsafe or excessive SVG: '..bad:sub(1,80))
end
local gradient='<svg viewBox="0 0 64 64"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient><clipPath id="c"><rect width="64" height="64"/></clipPath></defs><rect width="64" height="64" fill="url(#g)" clip-path="url(#c)"/></svg>'
check(select(2,M.image(gradient))=='svg','local gradients and clips retained')
check(select(2,M.image('<svg width="32.5px" height="32.5px"><g transform="translate(1 1) rotate(15) scale(.5)"><path d="M0 0 A10 10 0 0 1 20 20 L0 0z" stroke="black" stroke-dasharray="none"/></g></svg>'))=='svg','bounded transforms, arcs, fractional dimensions and solid strokes')
check(select(2,M.image('<svg viewBox="0 0 32 32"><path d="M1. 1. L31. 31."/></svg>'))=='svg','SVG numbers may end in a decimal point')
check(select(2,M.image('\239\187\191<?xml version="1.0" encoding="UTF-8"?>'..svg))=='svg','ordinary XML declaration and BOM')
check(M.candidates('<link rel="icon" href="'..uri..'">','example.com')[1]==uri,'inline candidate discovery')
check(M.candidates('<link rel="icon" href="/one.svg"><link rel="icon" href="/real.png">','example.com')[1]=='https://example.com/real.png','raster candidates preferred to vectors')
local files={}; local requests=0; local stamp=1000000
local env={now=function() return stamp end, read=function(p) return files[p] end,
 write=function(p,d) files[p]=d; return true end, remove=function(p) files[p]=nil end,
 list=function() local a={}; for p in pairs(files) do a[#a+1]=p end; return a end,
 stat=function(p) return files[p] and {size=#files[p],blocks=8} end,
 fetch=function(url) requests=requests+1; if url:match('/favicon.ico$') then return nil,nil,'http_404' end
   return '<link rel="icon" href="'..uri..'">',url end}
M.run(env,{'inline.com'},{})
check(requests==2 and files['inline.com.png']==png,'inline icon avoids an extra HTTP request')
env.fetch=function() return svg end
M.run(env,{'vector.com'},{})
check(files['vector.com.svg'] and files['websites.tsv']:find('vector.com.svg',1,true),'SVG cache published')
M.run(env,{'vector.com','inline.com'},{})
check(files['vector.com.svg'],'SVG cache survives subsequent passes')
local previous=files['vector.com.svg']
stamp=stamp+7*86400+1; env.fetch=function() return '<svg onload="bad()" viewBox="0 0 32 32"/>' end
M.run(env,{'vector.com'},{})
check(files['vector.com.svg']==previous and files['websites.tsv']:find('vector.com.svg',1,true),'rejected refresh preserves last valid SVG')
stamp=stamp+7*86400+1; env.fetch=function() return png end
M.run(env,{'vector.com'},{})
check(files['vector.com.png'] and not files['vector.com.svg'],'format switch removes old SVG')
print('website-icons-formats-selftest: passed')

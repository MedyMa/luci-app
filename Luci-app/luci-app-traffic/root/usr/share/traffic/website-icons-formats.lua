-- Passive SVG subset and strict inline decoding. No renderer, XML entities,
-- CSS, scripts, external resources, fonts, animation or recursive <use>.
local S={}
function S.base64(s,limit)
  if type(s)~='string' or #s==0 or #s>4*math.ceil(limit/3) or #s%4~=0 then return nil end
  local chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  local values={}; for i=1,#chars do values[chars:sub(i,i)]=i-1 end
  local out={}
  for i=1,#s,4 do
    local a,b,c,d=s:sub(i,i),s:sub(i+1,i+1),s:sub(i+2,i+2),s:sub(i+3,i+3)
    local x,y,z,w=values[a],values[b],values[c],values[d]
    if not x or not y then return nil end
    if c=='=' then
      if d~='=' or i+3~=#s or y%16~=0 then return nil end
    elseif not z then return nil
    elseif d=='=' then
      if i+3~=#s or z%4~=0 then return nil end
    elseif not w then return nil end
    local n=x*262144+y*4096+(z or 0)*64+(w or 0)
    out[#out+1]=string.char(math.floor(n/65536))..
      (z and string.char(math.floor(n/256)%256) or '')..(w and string.char(n%256) or '')
  end
  local data=table.concat(out)
  return #data<=limit and data or nil
end

local tags={svg=true,g=true,defs=true,path=true,rect=true,circle=true,ellipse=true,
 line=true,polyline=true,polygon=true,linearGradient=true,radialGradient=true,
 stop=true,clipPath=true,title=true,desc=true}
local numeric={x=true,y=true,x1=true,x2=true,y1=true,y2=true,cx=true,cy=true,r=true,
 rx=true,ry=true,fx=true,fy=true,width=true,height=true,offset=true,
 opacity=true,['fill-opacity']=true,['stroke-opacity']=true,['stroke-width']=true,
 ['stroke-miterlimit']=true,['stroke-dashoffset']=true,['stop-opacity']=true}
local enums={['fill-rule']={nonzero=true,evenodd=true},['clip-rule']={nonzero=true,evenodd=true},
 ['stroke-linecap']={butt=true,round=true,square=true},['stroke-linejoin']={miter=true,round=true,bevel=true},
 gradientUnits={userSpaceOnUse=true,objectBoundingBox=true},
 clipPathUnits={userSpaceOnUse=true,objectBoundingBox=true},
 spreadMethod={pad=true,reflect=true,['repeat']=true}}
local function number_token(v)
  local token=v:match('^[+-]?%d+%.?%d*') or v:match('^[+-]?%.%d+')
  if not token then return nil end
  local tail=v:sub(#token+1)
  if tail:match('^[eE]') then
    local exponent=tail:match('^[eE][+-]?%d+')
    if not exponent then return nil end
    token=token..exponent
  end
  return token
end
function S.svg(s,limit)
  if type(s)~='string' or #s>limit then return nil end
  s=s:gsub('^\239\187\191','')
  s=s:gsub('^%s*<%?xml%s+version=[\'"]1%.0[\'"]%s+encoding=[\'"]UTF%-8[\'"]%s*%?>','')
  -- Comments have no graphical meaning; never interpret their contents as tags.
  s=s:gsub('<!%-%-.-%-%->','')
  if s:find('[&%z\1-\8\11\12\14-\31]') or s:find('<!',1,true) or s:find('<?',1,true) then return nil end
  local stack,frames,out,ids,refs={},{},{},{},{}
  local elements,numbers,roots,pos=0,0,0,1
  local identity={1,0,0,1,0,0}
  local function multiply(a,b)
    local m={a[1]*b[1]+a[3]*b[2],a[2]*b[1]+a[4]*b[2],
      a[1]*b[3]+a[3]*b[4],a[2]*b[3]+a[4]*b[4],
      a[1]*b[5]+a[3]*b[6]+a[5],a[2]*b[5]+a[4]*b[6]+a[6]}
    for _,n in ipairs(m) do if n~=n or math.abs(n)>4096 then return nil end end
    return m
  end
  local function nums(v)
    local list={}
    while #v>0 do
      v=v:gsub('^[%s,]+','')
      if v=='' then break end
      local token=number_token(v)
      if not token then return nil end
      local n=tonumber(token)
      if not n or n~=n or math.abs(n)>4096 or (n~=0 and math.abs(n)<1e-6) then return nil end
      numbers=numbers+1; if numbers>4096 then return nil end
      list[#list+1]=n; v=v:sub(#token+1)
    end
    return list
  end
  local function path_valid(v)
    if #v>8192 then return false end
    local sizes={M=2,L=2,H=1,V=1,C=6,S=4,Q=4,T=2,A=7}
    local command,count,group=nil,0,{}
    local function complete()
      return not command or (count>0 and count%sizes[command]==0)
    end
    local first=true
    while #v>0 do
      v=v:gsub('^[%s,]+',''); if v=='' then break end
      local op=v:match('^[MmZzLlHhVvCcSsQqTtAa]')
      if op then
        if not complete() or (first and op~='M' and op~='m') then return false end
        first=false; command=op:upper(); count=0; group={}; v=v:sub(2)
        if command=='Z' then command=nil end
      else
        if not command then return false end
        local token=number_token(v); local n=token and nums(token)
        if not n or #n~=1 then return false end
        count=count+1; group[#group+1]=n[1]; v=v:sub(#token+1)
        if #group==sizes[command] then
          if command=='A' and (group[1]<0 or group[2]<0 or
            (group[4]~=0 and group[4]~=1) or (group[5]~=0 and group[5]~=1)) then return false end
          group={}
        end
      end
    end
    return not first and complete()
  end
  local function paint(v)
    local id=v:match('^url%(%#([%a_][%w_.-]*)%)$')
    if id then refs[#refs+1]={id=id,kind='paint'}; return true end
    return v:match('^#%x%x%x$') or v:match('^#%x%x%x%x%x%x$') or
      v:match('^#%x%x%x%x%x%x%x%x$') or (#v<=20 and v:match('^[%a]+$'))
  end
  while pos<=#s do
    local first,last,tag=s:find('<([^<>]+)>',pos)
    if not first then if s:sub(pos):match('^%s*$') then break else return nil end end
    local text=s:sub(pos,first-1)
    if not text:match('^%s*$') and stack[#stack]~='title' and stack[#stack]~='desc' then return nil end
    pos=last+1
    local closing=tag:match('^/([%a][%w]*)%s*$')
    if closing then
      if stack[#stack]~=closing then return nil end
      table.remove(stack); table.remove(frames); out[#out+1]='</'..closing..'>'
    else
      local name,rest=tag:match('^([%a][%w]*)(.*)$')
      if not name or not tags[name] then return nil end
      if #stack==0 then if name~='svg' or roots~=0 then return nil end; roots=roots+1
      elseif name=='svg' or stack[#stack]=='title' or stack[#stack]=='desc' then return nil end
      elements=elements+1; if elements>256 or #stack>=16 then return nil end
      local selfclose=rest:match('/%s*$')~=nil
      if selfclose then rest=rest:gsub('/%s*$','') end
      local attrs,ordered={},{}
      while not rest:match('^%s*$') do
        local gap,key,quote,value,tail=rest:match('^(%s+)([%a_][%w_:.-]*)%s*=%s*([\'"])(.-)%3(.*)$')
        if not gap or attrs[key] or #ordered>=32 or value:find('[<>"\'&%c]') then return nil end
        attrs[key]=value; ordered[#ordered+1]=key; rest=tail
      end
      local root=name=='svg'
      local local_matrix=identity
      for key,v in pairs(attrs) do
        local valid=false
        if key=='xmlns' then valid=root and v=='http://www.w3.org/2000/svg'
        elseif key=='version' then valid=root and (v=='1.0' or v=='1.1')
        elseif key=='id' then
          valid=#v<=64 and v:match('^[%a_][%w_.-]*$') and not ids[v]
          if valid then ids[v]=name end
        elseif key=='viewBox' then
          local n=nums(v); valid=root and n and #n==4 and n[3]>0 and n[4]>0 and n[3]<=1024 and n[4]<=1024
        elseif key=='d' then
          valid=name=='path' and path_valid(v)
        elseif key=='points' then
          local n=nums(v); valid=(name=='polygon' or name=='polyline') and n and #n>=4 and #n%2==0
        elseif numeric[key] then
          local n=nums((v:gsub('%%$',''):gsub('px$',''))); valid=n and #n==1
          if valid and root and (key=='width' or key=='height') then valid=n[1]>0 and n[1]<=1024 end
        elseif key=='fill' or key=='stroke' or key=='stop-color' or key=='color' then valid=paint(v)
        elseif key=='clip-path' then
          local id=v:match('^url%(%#([%a_][%w_.-]*)%)$')
          valid=id~=nil; if id then refs[#refs+1]={id=id,kind='clip'} end
          -- A clip definition referencing itself/another clip can recurse in
          -- client renderers. Only ordinary drawing groups/shapes may clip.
          if root or name=='clipPath' then valid=false end
          for _,ancestor in ipairs(stack) do if ancestor=='defs' or ancestor=='clipPath' then valid=false end end
        elseif key=='transform' or key=='gradientTransform' then
          local remaining=v
          local matrix=identity
          valid=#v<=1024
          while valid and not remaining:match('^%s*$') do
            local op,args,tail=remaining:match('^%s*([%a]+)%s*%(([^()]*)%)(.*)$')
            local n=args and nums(args)
            valid=n and ((op=='matrix' and #n==6) or ((op=='translate' or op=='scale') and (#n==1 or #n==2)) or
              (op=='rotate' and (#n==1 or #n==3)) or ((op=='skewX' or op=='skewY') and #n==1))
            if valid then
              local next_matrix
              if op=='matrix' then next_matrix=n
              elseif op=='translate' then next_matrix={1,0,0,1,n[1],n[2] or 0}
              elseif op=='scale' then next_matrix={n[1],0,0,n[2] or n[1],0,0}
              elseif op=='rotate' then
                local c,t=math.cos(n[1]*math.pi/180),math.sin(n[1]*math.pi/180)
                local x,y=n[2] or 0,n[3] or 0
                next_matrix={c,t,-t,c,x-c*x+t*y,y-t*x-c*y}
              elseif op=='skewX' then next_matrix={1,0,math.tan(n[1]*math.pi/180),1,0,0}
              else next_matrix={1,math.tan(n[1]*math.pi/180),0,1,0,0} end
              matrix=multiply(matrix,next_matrix); valid=matrix~=nil
            end
            remaining=tail or ''
          end
          if key=='transform' and valid then local_matrix=matrix end
        elseif key=='preserveAspectRatio' then valid=root and (v=='none' or v=='xMidYMid' or v=='xMidYMid meet')
        -- Client SVG compilers expand dashed strokes into individual segments.
        -- Even a small document can otherwise allocate unbounded path commands.
        elseif key=='stroke-dasharray' then valid=v=='none'
        elseif enums[key] then valid=enums[key][v] end
        if not valid then return nil end
      end
      if root then
        if not attrs.viewBox then
          local wt=(attrs.width or ''):gsub('px$','')
          local ht=(attrs.height or ''):gsub('px$','')
          local w,h=tonumber(wt),tonumber(ht)
          if not w or not h or w<=0 or h<=0 then return nil end
          attrs.viewBox='0 0 '..w..' '..h
        end
        attrs.width='64'; attrs.height='64'; attrs.xmlns='http://www.w3.org/2000/svg'
      end
      -- Rebuild the document using only validated elements/attributes.
      local keys={}; for key in pairs(attrs) do keys[#keys+1]=key end; table.sort(keys)
      local serial={'<'..name}; for _,key in ipairs(keys) do serial[#serial+1]=' '..key..'="'..attrs[key]..'"' end
      serial[#serial+1]=selfclose and '/>' or '>'; out[#out+1]=table.concat(serial)
      local effective=multiply(frames[#frames] or identity,local_matrix)
      if not effective then return nil end
      if not selfclose then stack[#stack+1]=name; frames[#frames+1]=effective end
    end
  end
  if roots~=1 or #stack~=0 then return nil end
  for _,r in ipairs(refs) do
    if (r.kind=='clip' and ids[r.id]~='clipPath') or
       (r.kind=='paint' and ids[r.id]~='linearGradient' and ids[r.id]~='radialGradient') then return nil end
  end
  local data=table.concat(out)
  return #data<=limit and data or nil
end
return S

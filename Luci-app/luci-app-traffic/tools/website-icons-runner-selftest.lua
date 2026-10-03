-- Exercise the production nixio/curl adapter with in-memory files and DNS.
local core_path, runner_path=arg[1],arg[2]
local real_dofile,real_open,real_popen=dofile,io.open,io.popen
local png='\137PNG\13\10\26\10'..string.rep('\0',8)..'\0\0\0\32\0\0\0\32'..string.rep('\0',16)
local files={['/proc/mounts']='/dev/nvme0n1p1 /mnt/nvme ext4 rw 0 0\n'}
local dirs,links={['/mnt/nvme']=true},{}
local requests, private, locked=0,false,false
local function check_mode(mode, expected)
  assert(type(mode)=='string' and mode:match('^[0-7][0-7][0-7]$'),
    'nixio permissions must be an octal string, not a decimal integer')
  assert(mode==expected,'unexpected permissions')
end
local fs={
  readfile=function(p) return files[p] end,
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
  getaddrinfo=function() return {{address=private and '192.168.2.1' or '93.184.216.34'}} end
}
dofile=function(path) if path=='/usr/share/traffic/website-icons-core.lua' then path=core_path end; return real_dofile(path) end
io.open=function(path,mode)
  if path=='/tmp/traffic/totals.tsv' then
    local sent=false; return {lines=function() return function() if not sent then sent=true; return 'comfylink.com\t50\t20' end end end,close=function() end}
  end
  return real_open(path,mode)
end
io.popen=function(command)
  requests=requests+1
  assert(command:find('--max-filesize 65536',1,true),'transfer cap')
  assert(command:find('--resolve',1,true) and command:find('93.184.216.34',1,true),'validated DNS pin')
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
print('website-icons-runner-selftest: passed (NVMe, publish, DNS pin, no repeat transfer, private DNS, metrics)')
io.open,io.popen,dofile=real_open,real_popen,real_dofile

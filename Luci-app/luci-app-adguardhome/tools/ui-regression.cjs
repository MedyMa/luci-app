const fs=require('fs'),path=require('path'),http=require('http'),os=require('os'),assert=require('assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'agh-regression-'));
// Pinned LuCI 24.10 runtime, with isolated HTTP/ubus fixtures (no router connection).
const luciRevision=process.env.AGH_LUCI_REVISION||'ad0b5676921df503d322454029839a856d17a07c';
const resources=path.join(root,'htdocs/luci-static/resources');
let calls=[],failure=null,running=false,readonly=false;
const initial={'.type':'AdGuardHome','.name':'AdGuardHome','.anonymous':false,'.index':0,enabled:'0',waitonboot:'1',username:'root',password:'admin',hashpass:'',httpport:'3000',redirect:'dnsmasq-upstream',passwall_upstream_auto:'0',binpath:'/etc/AdGuardHome',configpath:'/etc/AdGuardHome.yaml',workdir:'/etc/agh-work',logfile:'syslog',verbose:'0',update:'1',upxflag:'',gfw:'0',gfwipset:'0',gfwupstream:'tls://1.1.1.1',upprotect:[],backup:'0',backupfile:['filters'],backupwdpath:'/etc/backup',crontab:[],downloadarch:'auto',release_channel:'release'};
let config={...initial};
const status=()=>({running,core_ready:true,version:'v0.107.71',dns_port:53,httpport:3000,config_ready:true,workdir_ready:true,redirect:'dnsmasq-upstream',release_channel:'release',downloadarch:'auto'});
function response(msg){
 const [,object,method,args]=msg.params||[];calls.push({object,method,args});
 if(method===failure)return {jsonrpc:'2.0',id:msg.id,error:{code:-32000,message:'Regression failure fixture'}};
 let data={};
 if(object==='session')data={access:!readonly};
 if(object==='uci'){
   if(method==='get')data={values:args.config==='AdGuardHome'?{AdGuardHome:{...config}}:{}};
   if(method==='set')Object.assign(config,args.values);
   if(method==='delete')for(const key of args.options||[])delete config[key];
   if(method==='changes')data={changes:{}};
 }
 if(object==='luci.adguardhome')data=({getStatus:status(),getMeta:{links:'https://example.com/core.tar.gz',backup_choices:['filters','stats.db']},getStats:{ok:true,num_dns_queries:300,num_blocked_filtering:20,avg_processing_time:'1.4'},getYaml:{source:'config',current_exists:true,content:'dns:\n  port: 53\n'},getCurrentYaml:{content:'dns:\n  port: 53\n'},getTemplateConfig:{content:'dns:\n  port: 5353\n'},getLog:{content:'\u001b[32mstarted\u001b[0m\n',position:18},saveYaml:{ok:true,test_log:'valid'},discardYaml:{ok:true},startUpdate:{ok:true},setLinks:{ok:true},gfwAction:{ok:true},clearLog:{ok:true}})[method]||{};
 if(object==='file'&&method==='list')data={entries:[]};
 return {jsonrpc:'2.0',id:msg.id,result:[0,data]};
}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://local');
 if(req.method==='POST'){
   let text='';for await(const chunk of req)text+=chunk;
   if(url.pathname==='/cgi-bin/cgi-download'){calls.push({object:'file',method:'readDirect',args:Object.fromEntries(new URLSearchParams(text))});res.setHeader('Content-Type','text/plain');res.end('dns:\n  port: 53\n');return;}
   const json=JSON.parse(text);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(Array.isArray(json)?json.map(response):response(json)));return;
 }
 if(url.pathname==='/'){
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/argon.css"><style>body{padding:24px;background:#f4f5f7}#view{max-width:1100px;margin:auto}</style></head><body><main id="maincontent"><div id="view"></div></main><script>window._=s=>s;window.cbi_init=()=>{};</script><script src="/resources/cbi.js"></script><script src="/resources/luci.js"></script><script>window.L=new LuCI({base_url:'/resources',resource:'/resources',scriptname:'/cgi-bin/luci',ubuspath:'/ubus',sessionid:'test',token:'test',documentroot:'/',pollinterval:60,requestpath:['admin','services','adguardhome','settings'],nodespec:{satisfied:true,readonly:false}});</script></body></html>`);return;
 }
 let file;
 if(url.pathname==='/argon.css'){res.setHeader('Content-Type','text/css');res.end(':root{--dark-primary:#483d8b;--text-color-high:#283044}body.dark{background:#101722!important;--text-color-high:#e8edf7}.cbi-tab-disabled+div{display:none}');return;}
 else if(url.pathname.startsWith('/resources/')){
   const name=url.pathname.slice(11);file=path.join(resources,name);
   if(!fs.existsSync(file)&&fs.existsSync(path.join(root,'root/www/luci-static/resources',name)))file=path.join(root,'root/www/luci-static/resources',name);
   if(!fs.existsSync(file)){
     file=path.join(dir,'luci-runtime',name);if(!fs.existsSync(file)){
       const upstream=await fetch('https://raw.githubusercontent.com/openwrt/luci/'+luciRevision+'/modules/luci-base/htdocs/luci-static/resources/'+name);
       if(!upstream.ok){res.statusCode=404;res.end();return;}
       fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.from(await upstream.arrayBuffer()));
     }
   }
 }else{res.statusCode=404;res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'application/javascript');res.end(fs.readFileSync(file));
 }catch(e){console.error(e);res.statusCode=500;res.end(String(e))}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.AGH_BROWSER_PATH||undefined,headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.stack));let checks=0;
 async function open(name){calls=[];await page.goto(base);await page.waitForFunction(()=>L.loaded,{timeout:45000});await page.evaluate(async n=>{window.currentView=await L.require('view.adguardhome.'+n)},name);await page.locator(name==='settings'?'.agh-settings':'.agh-ui').waitFor();if(name==='yaml')await page.waitForFunction(()=>currentView._aghCmInstance);}
 async function clickAndWait(button,method){const response=page.waitForResponse(r=>r.request().method()==='POST'&&(method==='readDirect'?new URL(r.url()).pathname.endsWith('/cgi-download'):(r.request().postData()||'').includes('"'+method+'"')));await button.click();await response;}
 await open('settings');
 assert.equal(await page.locator('.cbi-value:not([data-name^="_agh_"])').count(),23);checks++;
 assert.equal(await page.locator('.agh-action-password').count(),1);assert.equal(await page.locator('.agh-action-update').count(),1);assert.equal(await page.locator('.agh-action-links').count(),1);assert.equal(await page.locator('.agh-action-gfw').count(),1);checks+=4;
 // Real LuCI save parses every tab, including tool DummyValues.
 await page.locator('[data-name="username"] input').fill('regression-admin');
 await page.evaluate(()=>currentView.handleSave());assert.equal(config.username,'regression-admin');checks++;
 const writes=calls.filter(c=>c.object==='uci'&&['set','delete'].includes(c.method));assert(writes.length>0);assert(!writes.some(c=>JSON.stringify(c.args).includes('_agh_')));checks+=2;
 await page.getByRole('link',{name:'DNS 接入',exact:true}).click();await page.locator('[data-name="httpport"] input').fill('70000');
 let invalid=false;try{await page.evaluate(()=>currentView.handleSave())}catch{invalid=true;}assert(invalid);assert.equal(config.httpport,'3000');await page.evaluate(()=>L.ui.hideModal());checks+=2;
 await page.locator('[data-name="httpport"] input').fill('3001');await page.evaluate(()=>currentView.handleSave());assert.equal(config.httpport,'3001');checks++;
 await page.getByRole('link',{name:'基础设置',exact:true}).click();
 // Actual bundled bcrypt script runs; generated fields must reach actual UCI save.
 await page.locator('.agh-action-password input').fill('ui-regression-secret');await page.getByRole('button',{name:'生成哈希',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-name="hashpass"] input').value.startsWith('$2'));
 await page.evaluate(()=>currentView.handleSave());assert.equal(config.password,'ui-regression-secret');assert(/\$2[aby]\$10\$/.test(config.hashpass));checks+=2;
 await page.getByRole('link',{name:'核心更新',exact:true}).click();
 await page.getByRole('button',{name:'更新',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.agh-action-update .agh-status').classList.contains('agh-ok'));
 await page.getByRole('button',{name:'强制更新',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.agh-action-update .agh-status').classList.contains('agh-ok'));
 assert.deepEqual(calls.filter(c=>c.method==='startUpdate').map(c=>c.args.force),[false,true]);checks++;
 await page.getByRole('button',{name:'保存源',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.agh-action-links .agh-status').classList.contains('agh-ok'));assert(calls.some(c=>c.method==='setLinks'&&c.args.content==='https://example.com/core.tar.gz'));checks++;
 failure='startUpdate';await page.getByRole('button',{name:'更新',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.agh-action-update .agh-status').classList.contains('agh-bad'));assert.equal(await page.getByRole('button',{name:'更新',exact:true}).isDisabled(),false);failure=null;checks++;
 await page.getByRole('link',{name:'GFW 规则',exact:true}).click();
 for(const btn of await page.locator('.agh-action-gfw button').all()){await btn.click();await page.waitForFunction(()=>!document.querySelector('.agh-action-gfw button:disabled'))}
 assert.deepEqual(calls.filter(c=>c.method==='gfwAction').map(c=>c.args.action),['add','del','import','remove_import','ipset_add','ipset_del']);checks++;
 await page.screenshot({path:path.join(dir,'real-luci-settings.png'),fullPage:true});
 await open('yaml');await page.evaluate(()=>currentView._aghCmInstance.setValue('dns:\n  port: 5354\n'));await clickAndWait(page.getByRole('button',{name:'保存并应用',exact:true}),'saveYaml');assert(calls.some(c=>c.method==='saveYaml'&&c.args.content.includes('5354')));checks++;
 await clickAndWait(page.getByRole('button',{name:'使用模板',exact:true}),'getTemplateConfig');await page.waitForFunction(()=>currentView._aghCmInstance.getValue().includes('5353'));assert(calls.some(c=>c.method==='getTemplateConfig'));checks++;
 await clickAndWait(page.locator('.agh-toolbar button').last(),'readDirect');await page.waitForFunction(()=>currentView._aghCmInstance.getValue().includes('port: 53\n'));assert(calls.some(c=>c.method==='readDirect'));checks++;
 await clickAndWait(page.locator('.agh-toolbar button').last(),'discardYaml');assert(calls.some(c=>c.method==='discardYaml'));checks++;
 running=true;await open('yaml');assert.equal(await page.getByRole('button',{name:'保存并应用',exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>currentView._aghCmInstance.getOption('readOnly')),'nocursor');checks+=2;
 await open('settings');await page.getByRole('link',{name:'GFW 规则',exact:true}).click();assert.equal(await page.locator('.agh-action-gfw button:disabled').count(),2);checks++;
 await open('log');await clickAndWait(page.getByRole('button',{name:'更新日志',exact:true}),'getLog');await clickAndWait(page.getByRole('button',{name:'清空',exact:true}),'clearLog');assert(calls.some(c=>c.method==='clearLog'&&c.args.scope==='update'));checks++;
 await open('overview');assert.equal(await page.locator('.agh-grid .agh-card').count(),4);checks++;
 for(const name of ['overview','settings','log','yaml']){await open(name);await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' mobile overflow');checks++;}
 assert.deepEqual(errors,[],'No uncaught browser errors during regression');
 console.log(`PASS: ${checks} real LuCI runtime checks including real form parsing, validation, UCI saving and bcrypt. HTTP/ubus endpoints isolated; no router modified.`);
 await browser.close();server.close();fs.rmSync(dir,{recursive:true,force:true});
})().catch(e=>{console.error(e);server.close();process.exit(1)});

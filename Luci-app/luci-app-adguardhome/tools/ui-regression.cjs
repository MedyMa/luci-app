const fs=require('fs'),path=require('path'),http=require('http'),os=require('os'),assert=require('assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'agh-regression-'));
// Pinned LuCI 24.10 runtime, with isolated HTTP/ubus fixtures (no router connection).
const luciRevision=process.env.AGH_LUCI_REVISION||'ad0b5676921df503d322454029839a856d17a07c';
const argonRevision='23c3e525578374d6b20f5e7b93d27874cd01a252';
const menuConfig=JSON.parse(fs.readFileSync(path.join(root,'root/usr/share/luci/menu.d/luci-app-adguardhome.json'),'utf8'));
const translations=Object.fromEntries([...fs.readFileSync(path.join(root,'po/zh_Hans/AdGuardHome.po'),'utf8').matchAll(/msgid "([^"\n]+)"\s+msgstr "([^"\n]+)"/g)].map(m=>[m[1],m[2]]));
translations.Diagnostics='网络诊断';
const resources=path.join(root,'htdocs/luci-static/resources');
let calls=[],failure=null,running=false,readonly=false,holdStats=false,releaseStats=null,updating=false;
const initial={'.type':'AdGuardHome','.name':'AdGuardHome','.anonymous':false,'.index':0,enabled:'0',waitonboot:'1',username:'root',password:'admin',hashpass:'',httpport:'3000',redirect:'dnsmasq-upstream',passwall_upstream_auto:'0',binpath:'/etc/AdGuardHome',configpath:'/etc/AdGuardHome.yaml',workdir:'/etc/agh-work',logfile:'syslog',verbose:'0',update:'1',upxflag:'',gfw:'0',gfwipset:'0',gfwupstream:'tls://1.1.1.1',upprotect:[],backup:'0',backupfile:['filters'],backupwdpath:'/etc/backup',crontab:[],downloadarch:'auto',release_channel:'release'};
let config={...initial};
const status=()=>({running,update_running:updating,core_ready:true,version:'v0.107.71',dns_port:53,httpport:3000,config_ready:true,workdir_ready:true,redirect:'dnsmasq-upstream',release_channel:'release',downloadarch:'auto'});
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
   const payload=JSON.stringify(Array.isArray(json)?json.map(response):response(json));if(text.includes('"getStats"')&&holdStats)await new Promise(r=>{releaseStats=r;});res.setHeader('Content-Type','application/json');res.end(payload);return;
 }
 if(url.pathname==='/'){
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/argon.css"><style>body{padding:0!important;margin:0;background:#f4f5f7}#regression-shell{display:grid;grid-template-columns:180px minmax(0,1fr);min-height:100vh}#regression-sidebar{background:#303030;padding:24px 12px}#maincontent{padding:24px;min-width:0;margin:0!important}#view{max-width:none;margin:0}body.dark{background:#1e1e1e!important;color:#ddd;--text-color-high:#e8edf7}#tabmenu:empty{display:none}@media(max-width:720px){#regression-shell{grid-template-columns:1fr}#regression-sidebar{display:none}#maincontent{padding:12px}}</style></head><body><div id="regression-shell"><aside id="regression-sidebar"><h3>ImmortalWrt</h3><div id="mainmenu"></div></aside><main id="maincontent"><div id="tabmenu"></div><div id="view"></div></main></div><script>const translations=${JSON.stringify(translations)};window._=s=>translations[s]||s;window.cbi_init=()=>{};</script><script src="/resources/cbi.js"></script><script src="/resources/luci.js"></script><script>window.L=new LuCI({base_url:'/resources',resource:'/resources',scriptname:'/cgi-bin/luci',ubuspath:'/ubus',sessionid:'test',token:'test',documentroot:'/',pollinterval:60,requestpath:['admin','services','adguardhome','settings'],nodespec:{satisfied:true,readonly:false}});</script></body></html>`);return;
 }
 let file;
 if(url.pathname==='/argon.css'||url.pathname==='/menu-argon.js'){
   const name=url.pathname==='/argon.css'?'htdocs/luci-static/argon/css/cascade.css':'htdocs/luci-static/resources/menu-argon.js';
   file=path.join(dir,path.basename(url.pathname));if(!fs.existsSync(file)){const r=await fetch('https://raw.githubusercontent.com/jerrykuku/luci-theme-argon/'+argonRevision+'/'+name);if(!r.ok)throw new Error('Argon fixture download failed: '+r.status);fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()));}
 }
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
 async function open(name){calls=[];await page.goto(base);await page.waitForFunction(()=>L.loaded,{timeout:45000});await page.evaluate(async n=>{const poll=await L.require('poll');window.testPolls=[];const add=poll.add;poll.add=function(fn,interval){testPolls.push({fn,interval});return add.call(this,fn,interval);};window.currentView=await L.require('view.adguardhome.'+n)},name);await page.locator(name==='settings'?'.agh-settings':'.agh-ui').waitFor();
 await page.evaluate(async defs=>{
  const tree={children:{}};
  for(const [url,entry] of Object.entries(defs)){let n=tree;for(const part of url.split('/')){n.children??={};n.children[part]??={children:{},satisfied:true};n=n.children[part];}Object.assign(n,entry,{satisfied:true});}
  const node=tree.children.admin.children.services.children.adguardhome;
  window.aghMenuTree=node;
  const source=await (await fetch('/menu-argon.js')).text();
  const theme=new Function('baseclass','ui',source)({extend:o=>o},L.ui);
  theme.renderTabMenu(node,'admin/services/adguardhome');
  tree.children.admin.children.services.title='服务';
  L.env.dispatchpath=['admin','services','adguardhome'];
  theme.renderMainMenu(tree.children.admin,'admin');
 },menuConfig);
 assert.equal(await page.locator('#tabmenu a').count(),0,'No duplicate Argon navigation');
 assert.equal(await page.locator('.agh-nav a').count(),3);checks+=2;
if(name==='yaml')await page.waitForFunction(()=>currentView._aghCmInstance);}
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
	await page.getByRole('link',{name:'高级选项',exact:true}).click();
	await page.locator('.agh-settings-detail summary').click();
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
 await open('log');await page.waitForFunction(()=>document.querySelector('.agh-console').textContent.includes('started'));calls=[];
 await page.evaluate(async()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});for(const p of testPolls)await p.fn();delete document.hidden;});assert(!calls.some(c=>c.method==='getLog'));checks++;
 calls=[];await page.evaluate(()=>Promise.all(testPolls.flatMap(p=>[p.fn(),p.fn(),p.fn()])));assert.equal(calls.filter(c=>c.method==='getLog').length,1,'Concurrent log polling is coalesced');checks++;
 await open('overview');assert.equal(await page.locator('.agh-grid .agh-card').count(),4);checks++;
 assert.equal(await page.locator('.agh-flow').count(),0);assert.equal(await page.locator('.agh-heading a').textContent(),'控制面板');assert(!/[↗→]/.test(await page.locator('.agh-ui').textContent()));assert.equal(new Set(await page.locator('.agh-stats-grid .agh-value').evaluateAll(es=>es.map(e=>getComputedStyle(e).color))).size,4);checks+=4;
 await open('overview');assert.deepEqual(await page.evaluate(()=>testPolls.map(p=>p.interval)),[15,10]);checks++;
 calls=[];await page.evaluate(async()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});for(const p of testPolls)await p.fn();delete document.hidden;});assert.equal(calls.length,0,'Hidden overview performs no automatic requests');checks++;
 // Drain scheduled polling before explicitly controlling the response order.
 await page.evaluate(async()=>{const poll=await L.require('poll');poll.stop();for(const p of testPolls)await p.fn();});
 holdStats=true;calls=[];await page.evaluate(()=>{window.delayedStats=testPolls[1].fn();});
 for(let n=0;!releaseStats&&n<100;n++)await new Promise(r=>setTimeout(r,20));assert(releaseStats,'Delayed stats request started');
 running=false;updating=true;await page.evaluate(()=>testPolls[0].fn());holdStats=false;releaseStats();releaseStats=null;await page.evaluate(()=>delayedStats);
 assert.equal(await page.locator('.agh-stats-grid .agh-value').allTextContents().then(x=>x.join('|')),'—|—|—|—');assert.equal(await page.locator('.agh-bottom-grid .agh-operation').last().locator('span').last().evaluate(e=>e.classList.contains('agh-warn')),true,'Update task remains visibly active during status refresh');updating=false;checks+=2;

 running=false;await open('overview');assert.equal(await page.locator('.agh-stats-grid .agh-value').allTextContents().then(x=>x.join('|')),'—|—|—|—');assert(!calls.some(c=>c.method==='getStats'),'Stopped service does not query stats API');checks+=2;
 running=true;failure='getStats';await open('overview');assert.equal(await page.locator('.agh-stats-grid .agh-card').count(),4);assert((await page.locator('.agh-stat-note').textContent()).includes('统计暂不可用'));failure=null;checks+=2;
 await page.setViewportSize({width:2560,height:1440});await open('overview');await page.evaluate(()=>document.body.classList.add('dark'));await page.waitForTimeout(150);assert((await page.locator('.agh-ui').boundingBox()).width<=1120);assert.equal(await page.locator('.agh-nav').textContent(),'概览设置诊断');checks+=2;
 if(process.env.AGH_SCREENSHOT_DIR){fs.mkdirSync(process.env.AGH_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.AGH_SCREENSHOT_DIR,'real-argon-overview.png'),fullPage:true});await open('settings');await page.evaluate(()=>document.body.classList.add('dark'));await page.waitForTimeout(150);await page.getByRole('link',{name:'基础设置',exact:true}).click();await page.screenshot({path:path.join(process.env.AGH_SCREENSHOT_DIR,'real-argon-settings.png'),fullPage:true});}
 for(const name of ['overview','settings','log','yaml']){await open(name);await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' mobile overflow');checks++;}
 await open('settings');await page.getByRole('link',{name:'基础设置',exact:true}).click();assert.equal(await page.locator('div[data-tab=service]').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');assert.equal(await page.locator('[data-name=username] .cbi-value-title').evaluate(e=>getComputedStyle(e).textAlign),'left');checks+=2;
 assert.deepEqual(errors,[],'No uncaught browser errors during regression');
 console.log(`PASS: ${checks} real LuCI runtime checks including real form parsing, validation, UCI saving and bcrypt. HTTP/ubus endpoints isolated; no router modified.`);
 await browser.close();server.close();fs.rmSync(dir,{recursive:true,force:true});
})().catch(e=>{console.error(e);server.close();process.exit(1)});

// Isolated Chrome, real OPFS and TCP; only synthetic video. No deployment settings used.
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../proctoring/tests/ui/node_modules/playwright');
const root=path.resolve(__dirname,'../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-recovery-'));
let context,server;let saved=false,posts=0,lose=false;const sockets=new Set();const checks=[];
(async()=>{
 server=http.createServer((req,res)=>{
  if(req.url==='/hang')return;
  if(req.url==='/hangbody'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{');return;}
  if(req.url.startsWith('/status/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({videosSaved:saved,processingStarted:saved}));return;}
  if(req.url==='/upload_video'){req.resume();req.on('end',()=>{posts++;saved=true;if(lose){res.writeHead(200,{'Content-Type':'application/json'});res.write('{');setTimeout(()=>req.socket.destroy(),20);return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,videosSaved:true}));});return;}
  res.end('Synthetic fixture');
 });server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 context=await chromium.launchPersistentContext(path.join(dir,'profile'),{executablePath:'/usr/bin/google-chrome',headless:true,acceptDownloads:true,ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox','--enable-unsafe-extension-debugging']});
 const cdp=await context.browser().newBrowserCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(dir,'downloads')});
 await cdp.send('Extensions.loadUnpacked',{path:path.join(root,'client')});
 const page=await context.newPage(),extension='chrome-extension://nlhjjbgkbfkopkigkbkojpkbffbkeohg';await page.goto(extension+'/pages/help.html');
 await page.evaluate(async base=>{
  window.api=await import('../scripts/upload.js');window.settings={server_connection:true,local_video_saving:false,server_url:base};
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');ctx.fillStyle='green';ctx.fillRect(0,0,160,90);
  const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];
  window.video=await new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/webm'}));const drawing=setInterval(()=>{ctx.fillStyle=Date.now()%2?'green':'blue';ctx.fillRect(0,0,160,90);},40);recorder.start();setTimeout(()=>{clearInterval(drawing);recorder.stop();},1000);});stream.getTracks().forEach(t=>t.stop());
  window.seed=async()=>{
   const root=await navigator.storage.getDirectory();for await(const [name] of root.entries())await root.removeEntry(name);
   await chrome.storage.local.clear();
   const name='proctoring_screen_test.webm',handle=await root.getFileHandle(name,{create:true}),writer=await handle.createWritable();await writer.write(window.video);await writer.close();
   await chrome.storage.local.set({sessionId:'123456789012345678901234',tempFiles:[name],metadata:{recording_sessions:[]},session_status:'in_progress'});
  };
  window.state=()=>chrome.storage.local.get(null);window.upload=()=>api.uploadSession(settings);
  window.attempt=async()=>{try{await upload();return null;}catch(e){return e.message;}};
 },base);
 const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
 await check('lost real upload response preserves OPFS and attempt; retry recovers ACK without POST',async()=>{
  await page.evaluate(()=>seed());lose=true;saved=false;const error=await page.evaluate(()=>attempt());assert.ok(error);assert.equal(posts,1);
  const state=await page.evaluate(()=>state());assert.ok(state.uploadAttempt);assert.equal(state.tempFiles.length,1);
  lose=false;await page.evaluate(()=>upload());assert.equal(posts,1);assert.equal((await page.evaluate(()=>state())).tempFiles.length,0);
 });
 await check('continuation after uncertain upload blocked; unexpected new segment retained',async()=>{
  saved=false;lose=true;await page.evaluate(()=>seed());await page.evaluate(()=>attempt());lose=false;
  assert.match(await page.evaluate(async()=>{try{await api.assertCanResume();return '';}catch(e){return e.message;}}),/Сначала/);
  const media=await context.newPage();await media.goto(extension+'/pages/media.html');await media.waitForLoadState('load');
  const blocked=await page.evaluate(()=>chrome.runtime.sendMessage({action:'startRecording',formData:{}}));
  assert.equal(blocked.success,false);assert.match(blocked.error,/Сначала/);await media.close();
  await page.evaluate(async()=>{const root=await navigator.storage.getDirectory(),name='proctoring_screen_extra.webm',h=await root.getFileHandle(name,{create:true}),w=await h.createWritable();await w.write(video);await w.close();const {tempFiles}=await state();await chrome.storage.local.set({tempFiles:[...tempFiles,name]});});
  assert.match(await page.evaluate(()=>attempt()),/изменились/);assert.equal((await page.evaluate(()=>state())).tempFiles.length,2);
  const files=await page.evaluate(async()=>{const out=[];for await(const [name] of (await navigator.storage.getDirectory()).entries())out.push(name);return out;});assert.equal(files.length,2);
 });
 await check('OPFS deletion failure retains index and metadata; retry finishes cleanup',async()=>{
  saved=false;await page.evaluate(()=>seed());
  await page.evaluate(()=>{window.remove=FileSystemDirectoryHandle.prototype.removeEntry;FileSystemDirectoryHandle.prototype.removeEntry=async()=>{throw new DOMException('Synthetic disk failure','UnknownError');};});
  assert.match(await page.evaluate(()=>attempt()),/Индекс восстановления/);const s=await page.evaluate(()=>state());assert.ok(s.sessionId);assert.ok(s.metadata);assert.equal(s.tempFiles.length,1);
  await page.evaluate(()=>{FileSystemDirectoryHandle.prototype.removeEntry=window.remove;});await page.evaluate(()=>upload());assert.equal((await page.evaluate(()=>state())).sessionId,undefined);
 });
 await check('missing OPFS file does not prevent recovering server ACK',async()=>{
  saved=false;lose=true;await page.evaluate(()=>seed());await page.evaluate(()=>attempt());lose=false;
  await page.evaluate(async()=>{await(await navigator.storage.getDirectory()).removeEntry('proctoring_screen_test.webm');});
  await page.evaluate(()=>upload());assert.equal((await page.evaluate(()=>state())).sessionId,undefined);
 });
 await check('OPFS quota/write failure preserves previously committed video and index',async()=>{
  await page.evaluate(()=>seed());
  const result=await page.evaluate(async()=>{
   const {attachRecorderWriter}=await import('../scripts/recorder-writer.js');
   const root=await navigator.storage.getDirectory(),handle=await root.getFileHandle('proctoring_screen_test.webm'),before=(await handle.getFile()).size;
   const original=FileSystemFileHandle.prototype.createWritable;
   FileSystemFileHandle.prototype.createWritable=async()=>{throw new DOMException('Synthetic quota failure','QuotaExceededError');};
   const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;canvas.getContext('2d').fillRect(0,0,160,90);
   const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream),writer=attachRecorderWriter(recorder,()=>handle);
   let error;try{recorder.start();await new Promise(r=>setTimeout(r,150));try{await writer.stop();}catch(e){error=e.name;}}
   finally{FileSystemFileHandle.prototype.createWritable=original;stream.getTracks().forEach(t=>t.stop());}
   return {error,before,after:(await handle.getFile()).size,state:await state()};
  });
  assert.equal(result.error,'QuotaExceededError');assert.equal(result.before,result.after);assert.equal(result.state.tempFiles.length,1);
 });
 await check('OPFS read failure before upload retains recovery state and sends no POST',async()=>{
  saved=false;await page.evaluate(()=>seed());const count=posts;
  await page.evaluate(()=>{window.getFile=FileSystemFileHandle.prototype.getFile;FileSystemFileHandle.prototype.getFile=async()=>{throw new DOMException('Synthetic read error','NotReadableError');};});
  assert.ok(await page.evaluate(()=>attempt()));assert.equal(posts,count);assert.equal((await page.evaluate(()=>state())).tempFiles.length,1);
  await page.evaluate(()=>{FileSystemFileHandle.prototype.getFile=window.getFile;});
 });
 await check('stalled response and stalled JSON body time out without losing OPFS',async()=>{
  for(const endpoint of ['/hang','/hangbody']){
   const message=await page.evaluate(async({base,endpoint})=>{try{await api.requestJSON(base+endpoint,{timeoutMs:150});return '';}catch(e){return e.message;}},{base,endpoint});assert.match(message,/время ожидания/);
  }
  assert.equal((await page.evaluate(()=>state())).tempFiles.length,1);
 });
 await check('recordings viewer enumerates orphan file, plays real WebM and downloads without deletion',async()=>{
  await page.evaluate(async()=>{const root=await navigator.storage.getDirectory(),h=await root.getFileHandle('orphan.webm',{create:true}),w=await h.createWritable();await w.write(video);await w.close();});
  const viewer=await context.newPage();await viewer.goto(extension+'/pages/recordings.html');await viewer.getByText('Файлов: 2',{exact:true}).waitFor();
  const video=viewer.locator('video').first();await video.evaluate(async v=>{v.muted=true;v.loop=true;await v.play();});await viewer.waitForFunction(()=>document.querySelector('video').currentTime>0);
  const row=viewer.locator('article').filter({has:viewer.getByText('orphan.webm',{exact:true})});await row.getByRole('button',{name:'Скачать',exact:true}).click();await row.getByRole('button',{name:'Показать в папке'}).waitFor();
  const downloaded=await viewer.evaluate(async()=>{const [item]=await chrome.downloads.search({limit:1,orderBy:['-startTime']});return {state:item.state,filename:item.filename};});assert.equal(downloaded.state,'complete');assert.ok(fs.statSync(downloaded.filename).size>0);assert.equal((await page.evaluate(()=>state())).tempFiles.length,1);
  await viewer.screenshot({path:path.join(dir,'recordings.png')});
 });
 fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({browser:context.browser().version(),checks,status:'passed'},null,2));console.log('REPORT '+dir);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(context)await context.close();for(const s of sockets)s.destroy();if(server)await new Promise(r=>server.close(r));});

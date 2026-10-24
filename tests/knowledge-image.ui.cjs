const wb=require('./workbench-helpers.cjs');
/* Image selection regression in real Electron; no IPC or input mocks. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {_electron}=require('playwright-core');
const {writeTaskData}=require('../app/main/storage.cjs');
const source=path.resolve(__dirname,'..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const run=process.env.LOOP_IMAGE_QA_DIR?path.resolve(process.env.LOOP_IMAGE_QA_DIR):await fs.mkdtemp(path.join(os.tmpdir(),'loop-image-click-'));
 const profile=path.join(run,'user-data'),out=path.join(run,'evidence');await fs.mkdir(out,{recursive:true});
 await fs.access(path.join(profile,'task-data.json')).then(()=>{throw Error('Refusing to overwrite test data')},()=>{});
 const snippet='![测试图片](task-image:image-fixture)';
 const standalone='# 图片点击回归\n\n'+Array.from({length:18},(_,i)=>'图片前段落 '+i+'\n').join('\n')+'\n'+snippet+'\n\n图片后正文：光标应停在图片旁边。\n\n'+Array.from({length:16},(_,i)=>'图片后段落 '+i+'\n').join('\n');
 const inline='# 行内与连续图片\n\n图片前文字 '+snippet+' 图片后文字。\n\n'+snippet+'\n\n末尾正文。\n';
 const svg=process.env.LOOP_IMAGE_SIZE==='small'
  ?'<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80" viewBox="0 0 180 80"><rect width="180" height="80" rx="8" fill="#d5e8dd"/><text x="20" y="48" font-size="20">本地图片</text></svg>'
  :'<svg xmlns="http://www.w3.org/2000/svg" width="440" height="260" viewBox="0 0 440 260"><rect width="440" height="260" fill="#d5e8dd"/><text x="70" y="140" font-size="30">图片点击测试</text></svg>';
 const image='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'),stamp=new Date().toISOString();
 await writeTaskData(profile,{version:2,knowledgeSchemaVersion:1,activeTaskId:'image-a',taskFilter:'all',attachments:{images:{'image-fixture':image}},tasks:[['image-a',standalone],['image-b',inline],['image-c','# 提示块图片\n\n> [!NOTE] 图片\n>\n> '+snippet+'\n\n末尾正文\n'],['image-d','# 嵌入笔记图片\n\n![[note:note-image-b]]\n\n末尾正文\n']].map(([id,notes])=>({id,title:id==='image-a'?'独立图片点击':id==='image-b'?'行内图片点击':id==='image-c'?'提示块图片':'嵌入笔记图片',notes,nodes:[],createdAt:stamp,updatedAt:stamp,knowledgeNote:{noteId:'note-'+id,title:id,documentState:'DRAFT'}}))});
 const env={...process.env,LOOP_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:require('electron'),args:[source],cwd:source,env}),results=[],errors=[];let page;
 try{
  for(let i=0;i<150;i++){page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));if(page)break;await pause(80)}
  page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.navigation');
  await page.waitForFunction(()=>typeof knowledgeOpen==='function');
  for(const id of (process.env.LOOP_IMAGE_COMPOUND_ONLY?[]:['image-a','image-b']))for(const width of [1024,1440]){
   const label=id+'-'+width;
   try{
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(width,820),width);
    await page.evaluate(id=>knowledgeOpen(state.tasks.find(t=>t.id===id)),id);
    await page.waitForFunction(id=>knowledgeCurrentEntry(id)?.view,id);
    await wb.mode(page,'edit');
    await page.waitForFunction(()=>knowledgeCurrentEntry()?.mode==='edit');
    await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.locate(Math.max(0,e.getEditorText().indexOf('![')-2));});
    const image=page.locator('.kn-edit-surface .kn-live-widget img').first();await image.waitFor();await image.scrollIntoViewIfNeeded();await pause(150);
    const before=await page.evaluate(()=>{const e=knowledgeCurrentEntry(),img=document.querySelector('.kn-edit-surface .kn-live-widget img'),r=img.getBoundingClientRect();window.__imageNode=img;window.__imageView=e.view;return {markdown:e.getMarkdown(),top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,scroll:document.querySelector('.knowledge-body').scrollTop}});
    await page.screenshot({path:path.join(out,label+'-before.png')});
    const snapshots=[];
    for(const [x,y] of [[.1,.1],[.5,.85],[.9,.45]]){
     await image.click({position:{x:before.width*x,y:before.height*y}});await pause(100);
     const observed=await page.evaluate(()=>{const e=knowledgeCurrentEntry(),img=document.querySelector('.kn-edit-surface .kn-live-widget img'),r=img?.getBoundingClientRect(),caret=e.view.dom.querySelector('.cm-cursor')?.getBoundingClientRect();return {markdown:e.getMarkdown(),anchor:e.view.state.selection.main.head,sameImage:window.__imageNode===img,sameView:window.__imageView===e.view,top:r?.top,bottom:r?.bottom,left:r?.left,right:r?.right,height:r?.height,caret:caret?{left:caret.left,top:caret.top,bottom:caret.bottom}:null,scroll:document.querySelector('.knowledge-body').scrollTop,focused:e.view.hasFocus,images:document.querySelectorAll('.kn-edit-surface .kn-live-widget img').length}});
     snapshots.push(observed);await fs.writeFile(path.join(out,label+'-observations.json'),JSON.stringify({before,snapshots},null,2));
     await page.screenshot({path:path.join(out,label+'-clicked.png')});
     assert.equal(observed.markdown,before.markdown);assert.equal(observed.sameImage,true,'Click must keep image preview connected');assert.equal(observed.sameView,true);assert.equal(observed.focused,true);
     assert.ok(Math.abs(observed.top-before.top)<2,'Image click moved its vertical position');assert.ok(Math.abs(observed.scroll-before.scroll)<2,'Image click changed note scroll');
     assert.equal(observed.anchor,before.markdown.indexOf(snippet)+snippet.length,'Caret must stay at the clicked image boundary');
     assert.ok(observed.caret,'The visible caret must exist');
     assert.ok(observed.caret.top>=observed.bottom-35,'Visible caret must align with the bottom of the image, not appear above it');
     assert.ok(observed.caret.left>=observed.right-2||observed.caret.top>=observed.bottom-2,'Visible caret must be to the right of or below the image');
    }
    await page.keyboard.insertText('图片后输入');
    const typed=await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());assert.equal(typed,before.markdown.replace(snippet,snippet+'图片后输入'));
    const typedPosition=await page.evaluate(()=>{
      const view=knowledgeCurrentEntry().view,img=view.dom.querySelector('.kn-image-widget img').getBoundingClientRect(),walker=document.createTreeWalker(view.contentDOM,NodeFilter.SHOW_TEXT);let node;
      while(node=walker.nextNode()){const at=node.textContent.indexOf('图片后输入');if(at<0)continue;const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+5);return {image:{right:img.right,bottom:img.bottom},text:[...range.getClientRects()].map(r=>({left:r.left,top:r.top,bottom:r.bottom}))};}
    });
    assert.ok(typedPosition,'Typed text must be visibly rendered');
    assert.ok(typedPosition.text.length>0);
    assert.ok(typedPosition.text.every(r=>r.top>=typedPosition.image.bottom-35),'Typed text may not appear on a line above the image');
    assert.ok(typedPosition.text.every(r=>r.left>=typedPosition.image.right-2||r.top>=typedPosition.image.bottom-2),'Typed text must appear after the image');
    await fs.writeFile(path.join(out,label+'-typed-position.json'),JSON.stringify(typedPosition,null,2));
    await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),before.markdown);
    await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().view.state.selection.main.head),before.markdown.indexOf(snippet));
    await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().view.state.selection.main.head),before.markdown.indexOf(snippet)+snippet.length);
    await page.keyboard.press('Backspace');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),before.markdown.replace(snippet,''));
    await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),before.markdown);
    await wb.mode(page,'source');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),before.markdown);
    await wb.mode(page,'preview');await page.locator('.kn-reading img').first().click();assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),before.markdown);
    await page.screenshot({path:path.join(out,label+'-after.png')});results.push({label,status:'PASS',clicks:snapshots.length,typingUndoAtomicNavigationAndDelete:true});
   }catch(error){results.push({label,status:'FAIL',error:error.stack});await page.screenshot({path:path.join(out,label+'-failure.png')}).catch(()=>{})}
   await fs.writeFile(path.join(out,'results.json'),JSON.stringify({source,profile,results,errors},null,2));
  }
  for(const id of ['image-c','image-d']){
   try{
    await page.evaluate(id=>knowledgeOpen(state.tasks.find(t=>t.id===id)),id);await page.waitForFunction(id=>knowledgeCurrentEntry(id)?.view,id);
    await wb.mode(page,'edit');
    await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({selection:{anchor:0}})});
    const img=page.locator('.kn-edit-surface .kn-live-widget img').first();await img.waitFor();await img.scrollIntoViewIfNeeded();
    const before=await page.evaluate(()=>{const e=knowledgeCurrentEntry(),img=document.querySelector('.kn-edit-surface .kn-live-widget img');window.__compoundImage=img;return {source:e.getMarkdown(),anchor:e.view.state.selection.main.head,top:img.getBoundingClientRect().top,scroll:document.querySelector('.knowledge-body').scrollTop}});
    await img.click({position:{x:40,y:40}});await pause(100);
    const after=await page.evaluate(()=>{const e=knowledgeCurrentEntry(),img=document.querySelector('.kn-edit-surface .kn-live-widget img');return {source:e.getMarkdown(),anchor:e.view.state.selection.main.head,top:img.getBoundingClientRect().top,scroll:document.querySelector('.knowledge-body').scrollTop,same:img===window.__compoundImage}});
    await fs.writeFile(path.join(out,id+'-compound-observations.json'),JSON.stringify({before,after},null,2));
    assert.equal(after.same,true);assert.equal(after.source,before.source);assert.equal(after.anchor,before.anchor);assert.ok(Math.abs(after.top-before.top)<2);assert.ok(Math.abs(after.scroll-before.scroll)<2);
    results.push({label:id,status:'PASS',compoundImagePreservesCaretAndLayout:true});
   }catch(error){results.push({label:id,status:'FAIL',error:error.stack})}
  }
 }finally{await app.close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify({source,profile,results,errors},null,2))}
 console.log(JSON.stringify({results,errors}));if(results.some(r=>r.status==='FAIL')||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});

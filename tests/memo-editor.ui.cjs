const assert=require('node:assert/strict');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
const http=require('node:http');
(async()=>{
 const h=await launchRepository({activeTaskId:'memo',tasks:[task('memo',{title:'编辑行为',notes:'# 编辑行为\n\n[正文链接](https://example.com/body)\n\n| 项目 | 内容 |\n| --- | --- |\n| 编辑 | [表格链接](https://example.com/table) 后面的普通文字 |',nodes:[{id:'node',title:'节点标题',status:'todo',children:[],note:'原始记录'}]})]},'memo-editor');
 const {app,page:p}=h;
 const clipboard=await app.evaluate(({clipboard})=>({text:clipboard.readText(),html:clipboard.readHTML(),image:clipboard.readImage().toDataURL()}));
 try{
  await p.locator('[data-pane="notes"]').click();await p.waitForFunction(()=>knowledgeCurrentEntry()?.view);
  await p.evaluate(()=>{globalThis.__opened=[];knowledgeCurrentEntry().options.onExternalLink=url=>__opened.push(url);});
  await p.locator('.kn-table-widget tbody td').nth(1).click({position:{x:170,y:13}});
  assert.equal(await p.evaluate(()=>__opened.length),0);
  let input=p.locator('.kn-table-cell-editor');await input.evaluate(el=>el.setSelectionRange(3,3));await input.press('Control+Enter');assert.deepEqual(await p.evaluate(()=>__opened),['https://example.com/table']);assert.equal(await p.locator('.kn-table-widget table tr').count(),2);await p.evaluate(()=>__opened=[]);
  await input.fill('首行');await input.press('Shift+Enter');await input.pressSequentially('second');await input.press('Control+Enter');assert.equal(await p.evaluate(()=>__opened.length),0);assert.equal(await p.locator('.kn-table-widget table tr').count(),2);
  await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});assert.equal(await input.count(),1);
  await p.evaluate(()=>{const e=knowledgeCurrentEntry();globalThis.__finish=e.options.onFinishInput;e.options.onFinishInput=async()=>false;});
  await input.press('Enter');await p.waitForFunction(()=>!knowledgeCurrentEntry().activeTableCell?.finishing);
  assert.equal(await input.count(),1);assert.equal(await input.inputValue(),'首行\nsecond');
  await p.evaluate(()=>{knowledgeCurrentEntry().options.onFinishInput=__finish;});
  await input.press('Enter');await p.waitForFunction(()=>!knowledgeCurrentEntry().activeTableCell);
  assert.equal(await p.locator('.kn-table-widget table tr').count(),2);
  assert.ok(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown().includes('首行<br>second')));
  await p.locator('.kn-edit-surface .kn-external-link').first().click();assert.deepEqual(await p.evaluate(()=>__opened),['https://example.com/body']);
  await p.evaluate(()=>{const e=knowledgeCurrentEntry(),pos=e.getEditorText().indexOf('正文链接')+1;e.view.dispatch({selection:{anchor:pos}});e.view.focus();});
  await p.keyboard.press('Control+Enter');assert.equal(await p.evaluate(()=>__opened.length),2);
  await p.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({selection:{anchor:2}});e.view.focus();});await p.keyboard.press('Control+Enter');assert.equal(await p.evaluate(()=>__opened.length),2);
  const before=await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
  await p.keyboard.press('ControlOrMeta+b');assert.equal(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),before);
  await p.evaluate(()=>{const c=document.createElement('canvas');c.width=8;c.height=6;c.getContext('2d').fillRect(0,0,8,6);state.attachments.images.fixture=c.toDataURL();const e=knowledgeCurrentEntry();e.view.dispatch({selection:{anchor:e.view.state.doc.length}});e.insertText('\n\n![复制测试](task-image:fixture)\n');});
  const image=p.locator('.kn-edit-surface .kn-image-widget img').last();await image.waitFor();await image.click();
  const imageSource=await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
  await p.keyboard.press('ControlOrMeta+c');
  await p.waitForFunction(async()=>{const data=await personalTaskTrack.clipboard.readImageDataUrl();if(!data)return false;const img=new Image();img.src=data;await img.decode();return img.naturalWidth===8&&img.naturalHeight===6;});
  assert.deepEqual(await app.evaluate(({clipboard})=>clipboard.readImage().getSize()),{width:8,height:6});
  await image.click({button:'right'});await p.locator('[data-copy-image]').click();
  assert.equal(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),imageSource);
  const svgCopy=await p.evaluate(async()=>{
    const image=new Image();image.src='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="7"><rect width="10" height="7" fill="#888"/></svg>');await image.decode();return knowledgeCurrentEntry().copyImage(image);
  });assert.equal(svgCopy,true,await p.evaluate(()=>knowledgeCurrentEntry().statusHost.textContent));assert.deepEqual(await app.evaluate(({clipboard})=>clipboard.readImage().getSize()),{width:10,height:7});
  const imageServer=http.createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'image/svg+xml'});response.end('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="9"><rect width="12" height="9" fill="#777"/></svg>');});
  await new Promise(resolve=>imageServer.listen(0,'127.0.0.1',resolve));
  try{assert.equal(await p.evaluate(async url=>{const image=new Image();image.src=url;await image.decode();return knowledgeCurrentEntry().copyImage(image);},'http://127.0.0.1:'+imageServer.address().port+'/image.svg'),true);assert.deepEqual(await app.evaluate(({clipboard})=>clipboard.readImage().getSize()),{width:12,height:9});}
  finally{imageServer.closeAllConnections();await new Promise(resolve=>imageServer.close(resolve));}
  await p.locator('[data-pane="flow"]').click();await p.locator('.node-title[data-node-id="node"]').dblclick();
  input=p.locator('[data-shell-node-rename]');await input.fill('第一行');await input.press('Shift+Enter');await input.pressSequentially('second');
  await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});assert.equal(await input.count(),1);
  await input.press('Enter');await p.waitForFunction(()=>!shellNodeRenameDraft);
  assert.equal(await p.locator('.node-title[data-node-id="node"]').innerText(),'第一行\nsecond');
  await p.locator('[data-action="edit-node-conclusion"]').click();input=p.locator('[data-shell-node-conclusion]');await input.fill('结论');await input.press('Shift+Enter');await input.pressSequentially('second');await input.press('Enter');await p.waitForFunction(()=>!shellConclusionDraft);
  await p.evaluate(()=>flushSave());await p.reload();await p.locator('.node-title[data-node-id="node"]').waitFor();
  assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'node').title),'第一行\nsecond');
  assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'node').conclusion),'结论\nsecond');
  assert.deepEqual(h.errors,[]);console.log('memo stage 2: table/flow Enter, Shift+Enter, composition guards, failed-save edit retention, image system clipboard, link hit/open and removed format shortcut passed');
 }finally{
  await app.evaluate(({clipboard,nativeImage},old)=>{clipboard.write({text:old.text,html:old.html,...(old.image?{image:nativeImage.createFromDataURL(old.image)}:{})});},clipboard);await h.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});

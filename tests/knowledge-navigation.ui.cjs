// Real production editors and resource tabs; no replacement document session.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
const paragraphs=label=>Array.from({length:100},(_,i)=>`${label}第${i+1}段：保留原文、草稿、选区与阅读位置。\n\n`).join('');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'loop-navigation-'));
 const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>导航网页</title><h1>返回来源笔记</h1>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/page';
 const source='# 来源笔记\n\n'+paragraphs('来源')+'[打开B](./B.md)\n\n[打开网页]('+url+')\n\n[[note:third|内部笔记C]]\n\n[缺失文件](./missing.md)\n\n[回到标题](#来源笔记)\n\n'+paragraphs('末尾');
 const b='# 笔记B\n\n'+paragraphs('B')+'[打开C](./C.md)\n\n'+paragraphs('B末尾');
 const c='# 笔记C\n\n'+paragraphs('C');
 for(const [name,text] of [['source.md',source],['B.md',b],['C.md',c]])await fs.writeFile(path.join(directory,name),text);
 const metadata=await readKnowledgeDocument(path.join(directory,'source.md'));
 const h=await launchRepository({activeTaskId:'source',tasks:[task('source',{notes:source,knowledgeNote:{noteId:'source',title:'来源笔记',documentState:'SAVED',...metadata}})],
  knowledgeDocuments:[{id:'third',title:'内部笔记C',notes:c,knowledgeNote:{noteId:'third',title:'内部笔记C',documentState:'DRAFT'}}]},'knowledge-navigation');
 const {app,page:p}=h;
 const settle=()=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))));
 const active=async name=>{await p.waitForFunction(name=>knowledgeActiveDocument()?.knowledgeNote?.filePath?.endsWith(name)&&knowledgeCurrentEntry()?.root?.isConnected,name);await settle();};
 const position=()=>p.evaluate(()=>{const e=knowledgeCurrentEntry(),r=e.view.state.selection.main;return {body:document.querySelector('.knowledge-body').scrollTop,cm:e.view.scrollDOM.scrollTop,read:e.readHost.scrollTop,anchor:r.anchor,head:r.head};});
 const place=async(needle,top)=>{
  await p.evaluate(({needle,top})=>{const e=knowledgeCurrentEntry(),from=e.getEditorText().indexOf(needle);e.view.dispatch({selection:{anchor:from+2,head:from+4}});e.view.focus();document.querySelector('.knowledge-body').scrollTop=top;e.view.scrollDOM.scrollTop=top;},{needle,top});
  await settle();return position();
 };
 const same=async expected=>{await settle();const actual=await position();for(const key of ['body','cm','read'])assert.ok(Math.abs(actual[key]-expected[key])<3,`${key}: expected ${expected[key]}, got ${actual[key]}`);assert.equal(actual.anchor,expected.anchor);assert.equal(actual.head,expected.head);};
 const closeActive=()=>p.locator('.kn-document-tab:has([data-kn-document][aria-selected="true"]) [data-kn-detach]').click();
 try{
  await p.locator('[data-pane="notes"]').click();await p.waitForFunction(()=>knowledgeCurrentEntry()?.view);
  await p.evaluate(()=>{knowledgeSetMode('source');globalThis.__originEntry=knowledgeCurrentEntry();globalThis.__originView=knowledgeCurrentEntry().view;});await settle();
  const sourcePosition=await place('[打开B]',1500);
  await p.keyboard.press('Control+Enter');await active('B.md');
  assert.ok((await position()).body<100,'new note starts at its own position');
  const bId=await p.evaluate(()=>knowledgeActiveDocument().id),bPosition=await place('[打开C]',900);
  await p.keyboard.press('Control+Enter');await active('C.md');
  await closeActive();await active('B.md');await same(bPosition);
  await p.locator('.knowledge-body').dispatchEvent('mouseup',{button:3,bubbles:true});
  await active('source.md');await same(sourcePosition);
  assert.equal(await p.evaluate(()=>knowledgeCurrentEntry()===__originEntry&&knowledgeCurrentEntry().view===__originView),true);
  assert.equal(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),source);

  // Closing a reused target returns to the actual opener, not the adjacent tab.
  await p.evaluate(id=>knowledgeAttach(knowledgeFindDocument(id)),bId);await active('B.md');
  await p.locator('[data-kn-document="source"]').click();await active('source.md');
  const webPosition=await place('[打开网页]',1800);
  await p.keyboard.press('Control+Enter');await p.waitForFunction(()=>knowledgeActiveResource()?.status==='ready');
  await p.locator('.kn-document-tab:has([data-kn-resource][aria-selected="true"]) [data-kn-resource-close]').click();
  await active('source.md');await same(webPosition);

  // The native window command reaches the same history through the preload.
  await p.evaluate(url=>knowledgeOpenResource(url),url);await p.waitForFunction(()=>knowledgeActiveResource()?.status==='ready');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).emit('app-command',{preventDefault(){}},'browser-backward'));
  await p.waitForFunction(()=>!knowledgeActiveResource());await same(webPosition);

  // Internal wiki links share navigation history and keep unsaved Undo state.
  await p.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({changes:{from:e.view.state.doc.length,insert:'\n未保存草稿连续性'},userEvent:'input'});});
  const wikiPosition=await place('[[note:third',1300);
  await p.keyboard.press('Control+Enter');await p.waitForFunction(()=>knowledgeActiveDocument()?.id==='third'&&knowledgeCurrentEntry()?.root.isConnected);await settle();
  await p.locator('.knowledge-body').dispatchEvent('mouseup',{button:3,bubbles:true});await active('source.md');await same(wikiPosition);
  assert.ok(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown().endsWith('未保存草稿连续性')));
  await p.evaluate(()=>knowledgeCurrentEntry().view.focus());await p.keyboard.press('ControlOrMeta+z');
  assert.equal(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),source,'the same source Undo journal survives navigation');
  await settle(); // CodeMirror scrolls the restored Undo selection on its next measure.
  const beforeFailure=await position(),historySize=await p.evaluate(()=>knowledgeNavigationHistory.get(state.activeTaskId)?.length||0);
  await p.evaluate(()=>knowledgeOpenResource('./missing.md'));
  assert.match(await p.locator('#overlay').innerText(),/文件不存在/);
  assert.equal(await p.evaluate(()=>knowledgeNavigationHistory.get(state.activeTaskId)?.length||0),historySize,'failed opening cannot add a return destination');
  await p.evaluate(()=>shellCloseOverlay({restoreFocus:false}));await same(beforeFailure);
  await p.evaluate(()=>{const e=knowledgeCurrentEntry();e.openLinkAt(e.getEditorText().indexOf('[回到标题]')+2);});await settle();
  assert.equal(await p.evaluate(()=>knowledgeCurrentEntry().view.state.selection.main.head),0,'document anchors locate the current note');

  // Reading mode and ordinary tab switching have separate note positions too.
  await p.evaluate(()=>knowledgeSetMode('preview'));await settle();
  const readingPosition=await p.evaluate(()=>{document.querySelector('.knowledge-body').scrollTop=1700;return document.querySelector('.knowledge-body').scrollTop;});
  await p.evaluate(()=>knowledgeOpenResource('./B.md'));await active('B.md');
  await closeActive();await active('source.md');await settle();
  assert.ok(Math.abs(await p.locator('.knowledge-body').evaluate(el=>el.scrollTop)-readingPosition)<3);
  await p.locator('[data-kn-document="third"]').click();await settle();
  await p.locator('[data-kn-document="source"]').click();await active('source.md');
  assert.ok(Math.abs(await p.locator('.knowledge-body').evaluate(el=>el.scrollTop)-readingPosition)<3);
  assert.deepEqual(h.errors,[]);
  console.log('knowledge navigation: Ctrl+Enter chained Markdown, close/back source scroll+selection, independent tab positions, web/native back bridge, wiki links, same editor/Undo/draft and reading mode passed');
 }finally{await h.close();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});

const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
function smallPDF(){
 const stream='BT /F1 16 Tf 30 120 Td (Loop PDF Preview) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let body='%PDF-1.4\n',offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(body));body+=(index+1)+' 0 obj\n'+object+'\nendobj\n';});const xref=Buffer.byteLength(body);body+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return body;
}
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'loop-resources-'));
 const server=http.createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html','X-Frame-Options':'DENY'});response.end('<!doctype html><title>网页资源验收</title><h1>独立网页</h1><script>window.testIsolation={bridge:typeof window.personalTaskTrack,node:typeof require,process:typeof process}</script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/page';
 const source='# 来源笔记\n\n[网页]('+url+')\n\n[代码](<./代码 文件.c>)\n\n[笔记](./另一篇.md)\n\n[Office](./文档.docx)\n\n[PDF](./report.pdf)\n\n[缺失](./missing.c)\n';
 const filePath=path.join(directory,'source.md');await fs.writeFile(filePath,source);await fs.writeFile(path.join(directory,'代码 文件.c'),'int main(void) { return 0; }\n<script>neverExecute()</script>');await fs.writeFile(path.join(directory,'另一篇.md'),'# 另一篇\n\n独立 Markdown 正文');await fs.writeFile(path.join(directory,'文档.docx'),'synthetic test document');
 const metadata=await readKnowledgeDocument(filePath);const h=await launchRepository({activeTaskId:'source',tasks:[task('source',{title:'来源笔记',notes:source,knowledgeNote:{noteId:'note-source',title:'来源笔记',documentState:'SAVED',...metadata}})]},'resource-tabs');
 await fs.writeFile(path.join(directory,'report.pdf'),smallPDF());
 const {app,page:p}=h;
 try{
  await p.locator('[data-pane="notes"]').click();await p.waitForFunction(()=>knowledgeCurrentEntry()?.view);
  await p.evaluate(()=>{globalThis.__sourceEntry=knowledgeCurrentEntry();globalThis.__sourceView=knowledgeCurrentEntry().view;});
  await app.evaluate(({shell})=>{globalThis.__external=[];shell.openExternal=async url=>{__external.push(url);};shell.openPath=async file=>{__external.push(file);return '';};});
  await p.evaluate(url=>knowledgeOpenResource(url),url);await p.locator('[data-kn-resource][aria-selected="true"]').waitFor();
  await p.waitForFunction(()=>knowledgeActiveResource()?.status==='ready');
  const native=await app.evaluate(async({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')),view=win.contentView.children.find(v=>v.webContents&&/^http:/.test(v.webContents.getURL()));return {isolation:await view.webContents.executeJavaScript('window.testIsolation'),bounds:view.getBounds(),visible:view.getVisible(),preload:view.webContents.getLastWebPreferences().preload};});
  assert.deepEqual(native.isolation,{bridge:'undefined',node:'undefined',process:'undefined'});assert.ok(native.bounds.width>200&&native.bounds.height>200);assert.equal(native.visible,true);assert.ok(!native.preload);
  await p.locator('[data-kn-document="source"]').click();await p.locator('.knowledge-body .cm-content').waitFor();assert.equal(await p.evaluate(()=>knowledgeCurrentEntry()===__sourceEntry&&knowledgeCurrentEntry().view===__sourceView),true);assert.equal(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),source);
  // A note switch restores the saved selection after the viewport's own frames.
  // Wait before moving the caret programmatically, which emits no pointer event.
  await p.evaluate(async()=>{for(let frame=0;frame<4;frame++)await new Promise(resolve=>requestAnimationFrame(resolve));});
  const codeLink=await p.evaluate(()=>{
   const entry=knowledgeCurrentEntry(),position=entry.getEditorText().indexOf('代码')+1;
   entry.view.dispatch({selection:{anchor:position}});entry.view.focus();
   return entry.linkAt(entry.view.state.selection.main.head)?.url;
  });
  assert.equal(codeLink,'./代码 文件.c');
  await p.keyboard.press('Control+Enter');await p.locator('.kn-resource-code').waitFor();assert.ok((await p.locator('.kn-resource-code').innerText()).includes('<script>neverExecute()</script>'));assert.equal(await p.locator('.kn-resource-code [contenteditable]').count(),0);
  await p.locator('[data-kn-document="source"]').click();await p.evaluate(url=>knowledgeOpenResource(url),url);assert.equal(await p.locator('[data-kn-resource]').count(),2,'reopening website reuses the resource tab');
  await p.evaluate(()=>shellMountSurface('<div class="surface-popover" role="menu">测试菜单</div>',document.querySelector('.kn-resource > header'),180));
  await p.waitForFunction(()=>Boolean(document.querySelector('#overlay > *')));await p.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).contentView.children.find(v=>v.webContents&&/^http:/.test(v.webContents.getURL())).getVisible()),false);
  await p.evaluate(()=>shellCloseOverlay({restoreFocus:false}));await p.locator('[data-kn-document="source"]').click();
  await p.locator('.kn-external-link').filter({hasText:'网页'}).click({button:'right'});await p.locator('[data-resource-open-external]').click();assert.ok((await app.evaluate(()=>__external)).includes(url));
  await p.evaluate(()=>knowledgeOpenResource('./report.pdf'));await p.waitForFunction(()=>knowledgeActiveResource()?.kind==='pdf'&&knowledgeActiveResource()?.status==='ready');
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).contentView.children.some(v=>v.webContents&&v.webContents.getURL().endsWith('/report.pdf'))),true);
  await p.locator('[data-kn-document="source"]').click();await p.evaluate(()=>knowledgeOpenResource('http://127.0.0.1:1/unavailable'));await p.waitForFunction(()=>knowledgeActiveResource()?.status==='failed');assert.ok((await p.locator('.kn-resource-message').innerText()).includes('无法在 Loop 中预览'));
  await p.locator('[data-kn-document="source"]').click();
  await p.evaluate(()=>knowledgeOpenResource('./另一篇.md'));await p.waitForFunction(()=>knowledgeActiveDocument()?.knowledgeNote?.filePath?.endsWith('另一篇.md')&&knowledgeCurrentEntry()?.view);assert.ok(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown().includes('独立 Markdown 正文')));
  await p.locator('[data-kn-document="source"]').click();await p.evaluate(()=>knowledgeOpenResource('./文档.docx'));await p.locator('.kn-resource [data-resource-external]').click();assert.ok((await app.evaluate(()=>__external)).some(value=>value.endsWith('文档.docx')));
  await p.locator('[data-kn-document="source"]').click();const rejected=await p.evaluate(()=>personalTaskTrack.knowledgeResources.open({href:'/etc/passwd',noteId:'source'}));assert.equal(rejected.success,false);assert.match(rejected.message,/有效链接/);
  const missing=await p.evaluate(()=>personalTaskTrack.knowledgeResources.open({href:'./missing.c',noteId:'source'}));assert.equal(missing.success,false);assert.match(missing.message,/不存在/);
  await p.evaluate(()=>{applySetting('resource-open-mode','external');save();});await p.evaluate(url=>knowledgeOpenResource(url),url);assert.ok((await app.evaluate(()=>__external)).includes(url));
  await p.evaluate(()=>flushSave());await p.reload();await p.waitForFunction(()=>state.knowledgeWorkspace.resourceOpenMode==='external');assert.equal(await p.evaluate(()=>state.knowledgeWorkspace.resourceOpenMode),'external');
  assert.deepEqual(h.errors,[]);console.log('memo stage 5: isolated native website, tab reuse/editor continuity, Ctrl+Enter code, Markdown, Office fallback, file authorization/errors and shared setting reload passed');
 }finally{await h.close();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});

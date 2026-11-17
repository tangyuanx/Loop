const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
const wb=require('./workbench-helpers.cjs'),mod=process.platform==='darwin'?'Meta':'Control';
async function main(){
 const evidence=await fs.mkdtemp(path.resolve('.local-review/clipboard-caret-'));
 const file=path.join(evidence,'Clipboard.md');await fs.writeFile(file,'start\n\nend');
 const disk=await readKnowledgeDocument(file);
 let run=await launchRepository({activeTaskId:'qa',taskPane:'notes',tasks:[task('qa',{notes:disk.content,knowledgeNote:{...disk,title:'Clipboard',documentState:'SAVED',dirty:false}})]},'clipboard-caret',process.env.LOOP_APP_EXECUTABLE);
 const cases=[],originalClipboard=await run.app.evaluate(({clipboard})=>({text:clipboard.readText(),html:clipboard.readHTML()}));
 try{
  let {page}=run;await page.locator('[data-pane=notes]').click();await wb.minimizeTaskInfo(page);await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);
  const source=()=>page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
  const reset=async text=>{await page.evaluate(text=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.setMode('edit');e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:text},selection:{anchor:0}});e.view.focus();},text);await page.waitForTimeout(100);};
  const table='<table><tr><th>A</th><th>B</th></tr><tr><td>one</td><td>two</td></tr></table>';
  const selections=[
   {name:'mixed article',html:'<h2>Before</h2>'+table+'<p>After</p>',text:'Before\nA\tB\none\ttwo\nAfter'},
   {name:'two tables',html:table+'<p>Between</p>'+table,text:'A\tB\none\ttwo\nBetween\nA\tB\none\ttwo'},
   {name:'tabular surrounding text',html:'<p>Before</p>'+table+'<p>After</p>',text:'Before\tintro\nA\tB\none\ttwo\nAfter\tending'},
   {name:'table caption',html:table.replace('<table>','<table><caption>Caption</caption>'),text:'Caption\nA\tB\none\ttwo'},
   {name:'nested table',html:'<table><tr><td>Outer'+table+'</td></tr></table>',text:'Outer\nA\tB\none\ttwo'},
  ];
  for(const sample of selections){
   await reset('start\n\nend');await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({selection:{anchor:7}});e.view.focus();});
   await run.app.evaluate(({clipboard},sample)=>clipboard.write({text:sample.text,html:sample.html}),sample);
   await page.keyboard.press(mod+'+v');await page.waitForTimeout(100);
   assert.equal(await source(),'start\n\n'+sample.text+'end',sample.name+' preserves the complete plain-text selection');
   await page.keyboard.press(mod+'+z');assert.equal(await source(),'start\n\nend');await page.keyboard.press(mod+'+Shift+z');assert.equal(await source(),'start\n\n'+sample.text+'end');cases.push(sample.name);
  }
  await reset('');await run.app.evaluate(({clipboard},html)=>clipboard.write({text:'A\tB\none\ttwo',html}),'<html><head><style>td{color:red}</style></head><body><div>'+table+'</div></body></html>');await page.keyboard.press(mod+'+v');
  await page.locator('.kn-table-widget').waitFor();assert.match(await source(),/\| A \| B \|/);assert.match(await source(),/one/);cases.push('whole HTML table retains table conversion');
  await reset('');
  await page.evaluate(html=>{const data=new DataTransfer();data.setData('text/html',html);knowledgeCurrentEntry().view.contentDOM.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));},'<p>Before</p>'+table+'<p>After</p><script>evil()</script>');
  const htmlOnly=await source();assert.ok(htmlOnly.startsWith('Before\n')&&htmlOnly.includes('one\ttwo')&&htmlOnly.endsWith('After'),htmlOnly);assert.ok(!htmlOnly.includes('evil'));cases.push('HTML-only mixed content retains all visible text');
  await require('./knowledge-selection-stability.cjs')({page,reset,source,cases,mod});
  const code='plain before\n\n```js\nconst value = 42;\nconst other = 9;\n```\n\nplain after [legal]';
  for(const theme of ['light','dark'])for(const scale of [1,1.3]){
   await reset(code);await page.evaluate(({theme,scale})=>{state.theme=theme;render();knowledgeCurrentEntry().root.style.setProperty('--font-scale',String(scale));},{theme,scale});
   await page.waitForTimeout(100);
   for(const lineIndex of [0,1]){
    const point=await page.locator('.kn-code pre code').evaluate((code,lineIndex)=>{
     const walker=document.createTreeWalker(code,NodeFilter.SHOW_TEXT);let node,remaining=lineIndex?code.textContent.indexOf('\n')+7:7;
     while((node=walker.nextNode())){if(remaining<=node.length)break;remaining-=node.length;}
     const range=document.createRange();range.setStart(node,remaining);range.setEnd(node,remaining+1);const rect=range.getBoundingClientRect();return {x:rect.left+1,y:rect.top+rect.height/2,height:rect.height,top:rect.top};
    },lineIndex);
    await page.mouse.click(point.x,point.y);
    const caret=await page.locator('.kn-block-caret').boundingBox();assert.ok(Math.abs(caret.height-point.height)<=1,JSON.stringify({theme,scale,lineIndex,caret,point}));assert.ok(Math.abs(caret.y-point.top)<=1);
    assert.equal(await source(),code);
    if(lineIndex===1)await page.screenshot({path:path.join(evidence,'caret-'+theme+'-'+scale+'.png')});
   }
   // Moving a selection away from rendered code must remove its synthetic
   // blinking cursor and restore the ordinary editor selection/cursor.
   await page.evaluate(()=>{const e=knowledgeCurrentEntry(),at=e.getEditorText().indexOf('plain after');e.view.dispatch({selection:{anchor:at,head:at+5}});e.view.focus();});
   assert.equal(await page.locator('.kn-block-caret').count(),0);assert.equal(await page.locator('.kn-block-caret-active').count(),0);
   await page.waitForTimeout(250);
   const stable=await page.evaluate(async()=>{const e=knowledgeCurrentEntry();let mutations=0;const observer=new MutationObserver(items=>mutations+=items.length);observer.observe(e.view.contentDOM,{subtree:true,childList:true,attributes:true,characterData:true});await new Promise(r=>setTimeout(r,1200));observer.disconnect();return {mutations,selection:e.view.state.selection.main.toJSON(),source:e.getMarkdown()};});
   assert.equal(stable.mutations,0);assert.equal(stable.source,code);
   await page.keyboard.press('Backspace');assert.ok((await source()).endsWith(' after [legal]'));await page.keyboard.press(mod+'+z');assert.equal(await source(),code);
   await page.screenshot({path:path.join(evidence,theme+'-'+scale+'.png')});cases.push(theme+' '+scale+' code rows, stable selection, legitimate bracket and undo');
  }
  await wb.mode(page,'source');await page.locator('.cm-content').click();await page.keyboard.press(mod+'+a');await page.keyboard.insertText('```text\nkeep code\n```');
  await page.keyboard.press('ArrowUp');await page.keyboard.press('Home');await run.app.evaluate(({clipboard},html)=>clipboard.write({text:'A\tB\none\ttwo',html}),table);await page.keyboard.press(mod+'+v');assert.ok((await source()).includes('A\tB'));cases.push('source mode preserves plain text');
  const expected=await source();assert.equal((await page.evaluate(()=>saveKnowledgeTask('qa'))).success,true);assert.equal(await fs.readFile(file,'utf8'),expected);
  await page.evaluate(async()=>{save();await flushSave();});const saved=JSON.parse(await fs.readFile(path.join(run.profile,'task-data.json'),'utf8'));const errors=run.errors.slice();
  await run.app.evaluate(({clipboard},original)=>clipboard.write(original),originalClipboard);await run.close();run=await launchRepository(saved,'clipboard-caret-reopen',process.env.LOOP_APP_EXECUTABLE);page=run.page;await page.locator('[data-pane=notes]').click();await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);assert.equal(await source(),expected);assert.deepEqual(errors.concat(run.errors),[]);
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({passed:true,cases,htmlOnly,expected,errors},null,2));console.log(JSON.stringify({passed:true,evidence,cases:cases.length}));
 }finally{await run.app.evaluate(({clipboard},original)=>clipboard.write(original),originalClipboard).catch(()=>{});await run.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

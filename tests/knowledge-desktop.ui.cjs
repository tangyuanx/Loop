/* Real Electron/production IPC. Only file picker results and explicit failure
   injections are substituted. Every run owns a new profile and external files. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');
const { writeTaskData } = require('../app/main/storage.cjs');
const { readKnowledgeDocument } = require('../app/main/knowledge-file.cjs');
const { readyNoteDocument } = require('../app/main/knowledge-export.cjs');
const source = path.resolve(__dirname, '..');
const simple = '```mermaid\nflowchart LR\n A[输入] --> B[结果]\n```\n';
const longCode = Array.from({length:115}, (_, i) => `console.log("多页代码 ${i+1}");`).join('\n');
const rich = '# 技术内容保真\n\n原公式：$x^2+y^2=z^2$\n\n' + simple +
  '\n## 扩展公式\n\n$$\\frac{1}{2}+\\sqrt{x_1^2+y_{n+1}^2}=\\sum_{i=1}^{n}i$$\n\n$$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$$\n\n' +
  '```mermaid\nflowchart TD\n A[中文长标签：检查输入内容] --> B[生成正确结果]\n```\n\n' +
  '![本地附件](attachments/sample.svg)\n\n> [!NOTE]- 折叠内容也应完整导出\n>\n> 不可遗漏的提示内容\n\n![[note:note-b]]\n\n- [x] 已核对\n- [ ] 待验收\n\n' +
  '| 项目 | 状态 |\n| --- | --- |\n| 图表与公式 | 等待验收 |\n\n## 多页代码\n\n```js\n' + longCode + '\n```\n\n文档结束标记。\n';
let app, page, run, out, files, profile;
const results = [], errors = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 15000) { const t=Date.now(); while(Date.now()-t<timeout) { if(await fn())return; await pause(80); } throw Error('Condition timed out'); }
async function json(name, value) { await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(value,null,2)); }
async function shot(name) { await page.screenshot({path:path.join(out,name+'.png')}); }
async function test(id, fn) {
  if(process.env.LOOP_KNOWLEDGE_QA_ONLY && !process.env.LOOP_KNOWLEDGE_QA_ONLY.split(',').includes(id))return;
  try { const detail = await fn(); results.push({id,status:'PASS',detail}); }
  catch(error) {results.push({id,status:'FAIL',error:error.stack});await shot(id+'-failure').catch(()=>{});}
  await json('results',{run,source,profile,files,results,errors});console.log(JSON.stringify(results.at(-1)));
}
async function choose(id) {
  await page.keyboard.press('Escape');await page.locator(`[data-task-row="${id}"] .task-select`).click();
  await page.locator('[data-pane="notes"]').click();
  await page.waitForFunction(id=>knowledgeCurrentEntry(id)?.view && document.querySelector('.knowledge-pane')?.dataset.taskId===id,id);
}
async function mode(value) { await page.locator(`[data-action="knowledge-mode"][data-mode="${value}"]`).click();await page.waitForFunction(value=>knowledgeCurrentEntry()?.mode===value,value); }
async function nativeSave(file) { await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>file?{canceled:false,filePath:file}:{canceled:true};},file); }
async function openExport(format='html') {
  await page.keyboard.press('Escape');await page.locator('[data-action="knowledge-file-menu"]').click();
  await page.locator('[role="menu"] [data-action="export-knowledge-note"]').click();
  await page.locator('#knowledge-export-format').selectOption(format);
  await page.waitForFunction(()=>!document.querySelector('#knowledge-export-status')?.textContent.includes('正在'));
}
async function download(name, format, {open=true}={}) {
  const file=path.join(files,name+'.'+format);await nativeSave(file);if(open)await openExport(format);
  await page.locator('#knowledge-export-download').click();
  await until(async()=>{try{return(await fs.stat(file)).size>0}catch{return false}});
  await page.locator('#knowledge-export-download').waitFor({state:'detached'});return file;
}
async function exportedWindow(file, fn) {
  await app.evaluate(async({BrowserWindow},file)=>{global.__exportInspect=new BrowserWindow({show:false,width:1000,height:1000,webPreferences:{sandbox:true}});await global.__exportInspect.loadFile(file);},file);
  await until(()=>app.windows().some(p=>p.url().endsWith(path.basename(file))));
  const tab=app.windows().find(p=>p.url().endsWith(path.basename(file)));
  try{return await fn(tab)}finally{await app.evaluate(()=>global.__exportInspect.destroy())}
}
(async()=>{
  run = process.env.LOOP_KNOWLEDGE_QA_DIR ? path.resolve(process.env.LOOP_KNOWLEDGE_QA_DIR) : await fs.mkdtemp(path.join(os.tmpdir(),'loop-knowledge-desktop-'));
  out=path.join(run,'evidence');files=path.join(run,'files');profile=path.join(run,'user-data');
  await fs.mkdir(out,{recursive:true});await fs.mkdir(path.join(files,'attachments'),{recursive:true});
  await fs.access(path.join(profile,'task-data.json')).then(()=>{throw Error('Refusing to overwrite existing test data')},()=>{});
  await fs.writeFile(path.join(files,'attachments/sample.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80" viewBox="0 0 180 80"><rect width="180" height="80" rx="8" fill="#d5e8dd"/><text x="20" y="48" font-size="20">本地图片</text></svg>');
  const bound=path.join(files,'bound.md');await fs.writeFile(bound,rich);const disk=await readKnowledgeDocument(bound);
  const stamp=new Date().toISOString();
  const task=(id,title,notes,note={})=>({id,title,notes,nodes:[],createdAt:stamp,updatedAt:stamp,knowledgeNote:{noteId:'note-'+id,title,documentState:'DRAFT',...note}});
  await writeTaskData(profile,{version:2,knowledgeSchemaVersion:1,taskFilter:'all',activeTaskId:'a',tasks:[
    task('a','S1 公式、图表与多页导出',rich,{filePath:bound,documentState:'SAVED',dirty:false,...disk}),
    task('b','快照嵌入笔记','# 嵌入内容\n\n快照中的旧嵌入内容。\n'),
    task('c','异常图表与资源','# 异常内容\n\n```mermaid\nflowchart LR\n A[bad syntax\n```\n\n![缺失附件](attachments/missing.png)\n\n![网络图片](https://example.invalid/remote.png)\n'),
    task('d','超宽图表','# 超宽图表\n\n```mermaid\nflowchart LR\n'+Array.from({length:18},(_,i)=>` N${i}[中文节点${i}] --> N${i+1}[中文节点${i+1}]`).join('\n')+'\n```\n'),
    task('e','简单图表','# 简单图表\n\n'+simple),
  ]});
  const env={...process.env,LOOP_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:process.env.LOOP_APP_EXECUTABLE||require('electron'),args:process.env.LOOP_APP_EXECUTABLE?[]:[source],cwd:source,env});
  try{
    await until(()=>{page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));return page});
    page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.navigation');
    await json('runtime',await app.evaluate(({app})=>({version:app.getVersion(),userData:app.getPath('userData'),appPath:app.getAppPath(),versions:process.versions})));
    await test('E03-layouts-and-modes',async()=>{
      await choose('e');const metrics=[];
      for(const theme of ['light','dark'])for(const [width,height] of [[1024,680],[1280,820],[1440,900]]){
        await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(...size),[width,height]);
        await page.evaluate(theme=>{state.theme=theme;render();},theme);
        for(const value of ['edit','source','preview'])await mode(value);
        await page.waitForSelector('.kn-reading .kn-mermaid svg',{state:'attached'});
        const geometry=await page.locator('.kn-reading .kn-mermaid svg').evaluate(svg=>{const r=svg.getBoundingClientRect();return {width:r.width,height:r.height,actualTheme:document.documentElement.dataset.theme,text:[...svg.querySelectorAll('text')].map(e=>e.textContent),fill:getComputedStyle(svg.querySelector('.node rect')).fill,stroke:getComputedStyle(svg.querySelector('.flowchart-link')).stroke,overflow:document.documentElement.scrollWidth>innerWidth}});
        assert.equal(geometry.actualTheme,theme);
        assert.ok(geometry.width>=240 && geometry.height>=40);assert.ok(geometry.text.some(t=>t.includes('输入')));assert.ok(geometry.text.some(t=>t.includes('结果')));assert.equal(geometry.overflow,false);assert.notEqual(geometry.stroke,'none');
        metrics.push({theme,width,height,...geometry});await shot(`E03-${theme}-${width}`);
      }
      await page.evaluate(()=>{state.theme='light';render();});return metrics;
    });
    await test('E01-E02-E04-E06-E07-E08-rich-exports',async()=>{
      await choose('a');await mode('preview');await page.waitForSelector('.kn-reading .kn-mermaid svg',{state:'attached'});await shot('rich-app');
      const before=await page.evaluate(()=>({note:structuredClone(shellActiveTask().knowledgeNote),markdown:knowledgeCurrentEntry().getMarkdown()}));
      const outputs={};for(const format of ['md','html','pdf'])outputs[format]=await download('rich-export',format);
      assert.equal(await fs.readFile(outputs.md,'utf8'),before.markdown);
      assert.deepEqual(await page.evaluate(()=>({note:structuredClone(shellActiveTask().knowledgeNote),markdown:knowledgeCurrentEntry().getMarkdown()})),before);
      const moved=path.join(run,'relocated');await fs.mkdir(moved);const html=path.join(moved,'offline.html');await fs.copyFile(outputs.html,html);
      const observation=await exportedWindow(html,async tab=>{
        const requests=[];tab.on('request',r=>requests.push(r.url()));await tab.context().setOffline(true);
        await tab.reload();await tab.evaluate(()=>document.fonts.ready);await tab.screenshot({path:path.join(out,'rich-offline-html.png'),fullPage:true});
        const data=await tab.evaluate(()=>({svg:document.querySelectorAll('.kn-mermaid svg').length,katex:document.querySelectorAll('.katex').length,
          diagramLabels:[...document.querySelectorAll('.kn-mermaid text')].map(e=>e.textContent),
          loadedFonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family),missingFonts:[...document.fonts].filter(f=>f.status==='error').map(f=>f.family),
          images:[...document.images].map(i=>({src:i.getAttribute('src').slice(0,40),complete:i.complete,naturalWidth:i.naturalWidth})),
          buttons:document.querySelectorAll('button,input').length,collapsed:document.querySelectorAll('.is-collapsed').length,
          embedded:document.querySelector('.kn-embed-body')?.textContent,ending:document.body.textContent.includes('文档结束标记'),
          mathHidden:(()=>{const e=document.querySelector('.katex-mathml');const s=getComputedStyle(e);return {position:s.position,clip:s.clip,width:s.width,height:s.height}})()}));
        await tab.context().setOffline(false);assert.equal(requests.filter(r=>/^https?:/.test(r)).length,0);
        assert.equal(data.svg,2);assert.equal(data.katex,3);assert.ok(data.loadedFonts.includes('KaTeX_Main'));assert.equal(data.missingFonts.length,0);
        assert.ok(data.diagramLabels.some(t=>t.includes('输入')));assert.ok(data.diagramLabels.some(t=>t.includes('结果')));assert.ok(data.diagramLabels.some(t=>t.includes('中文长标签')));
        assert.ok(data.images.every(i=>i.complete&&i.naturalWidth>0&&i.src.startsWith('data:')));assert.equal(data.images.length,1);
        assert.equal(data.buttons,0);assert.equal(data.collapsed,0);assert.match(data.embedded,/旧嵌入内容/);assert.equal(data.ending,true);return {...data,requests};
      });await json('rich-offline-observation',observation);return {outputs,observation};
    });
    await test('E08-snapshot-cancel-failure',async()=>{
      await choose('a');const original=await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
      await nativeSave(null);await openExport('html');await page.locator('#knowledge-export-download').click();assert.equal(await page.locator('#knowledge-export-download').count(),1);
      await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>{throw Error('测试：文件选择失败')}});
      await page.locator('#knowledge-export-download').click();await until(async()=>!(await page.locator('#knowledge-export-error').isHidden()));assert.match(await page.locator('#knowledge-export-error').innerText(),/文件选择失败/);
      await page.evaluate(()=>{state.tasks.find(t=>t.id==='b').notes='# 已改变\n\n不应该出现在旧快照';});
      const file=await download('snapshot-stable','html',{open:false});const html=await fs.readFile(file,'utf8');
      assert.match(html,/快照中的旧嵌入内容/);assert.ok(!html.includes('不应该出现在旧快照'));
      assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),original);return {file,cancelKeptDialog:true,errorShown:true,embeddedSnapshotStable:true};
    });
    await test('E08-unbound-export-has-no-side-effects',async()=>{
      await choose('e');const before=await page.evaluate(()=>({note:structuredClone(shellActiveTask().knowledgeNote),markdown:knowledgeCurrentEntry().getMarkdown()}));
      assert.equal(before.note.filePath||'','');const outputs=[];
      for(const format of ['md','html','pdf'])outputs.push(await download('unbound-export',format));
      assert.deepEqual(await page.evaluate(()=>({note:structuredClone(shellActiveTask().knowledgeNote),markdown:knowledgeCurrentEntry().getMarkdown()})),before);
      return {outputs,metadataAndMarkdownUnchanged:true};
    });
    await test('E05-E09-explicit-incomplete-retry',async()=>{
      await choose('c');await openExport('html');assert.ok(await page.locator('#knowledge-export-download').isDisabled());
      const text=await page.locator('#knowledge-export-issues').innerText();assert.match(text,/图表/);assert.match(text,/图片不可用/);assert.match(text,/网络图片未内嵌/);
      await shot('incomplete-error');await page.locator('#knowledge-export-incomplete').check();assert.equal(await page.locator('#knowledge-export-download').isDisabled(),false);
      await page.locator('#knowledge-export-retry').click();await page.waitForFunction(()=>!document.querySelector('#knowledge-export-status').textContent.includes('正在'));
      assert.equal(await page.locator('#knowledge-export-incomplete').isChecked(),false);assert.ok(await page.locator('#knowledge-export-download').isDisabled());
      await page.locator('#knowledge-export-incomplete').check();const file=await download('incomplete-explicit','html',{open:false});
      assert.match(await fs.readFile(file,'utf8'),/bad syntax/);return {issues:text,file};
    });
    await test('E04-E07-wide-chart-and-page-limit',async()=>{
      await choose('d');await mode('preview');await page.waitForSelector('.kn-reading .kn-mermaid svg',{state:'attached'});
      const geometry=await page.locator('.kn-reading .kn-mermaid').evaluate(el=>({clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth}));
      assert.ok(geometry.scrollWidth>geometry.clientWidth);assert.equal(geometry.documentOverflow,false);await shot('wide-chart-scroll');
      const html=await download('wide-chart','html');await openExport('pdf');await nativeSave(path.join(files,'should-not-exist.pdf'));await page.locator('#knowledge-export-download').click();
      await until(async()=>!(await page.locator('#knowledge-export-error').isHidden()));const message=await page.locator('#knowledge-export-error').innerText();assert.match(message,/单页可读尺寸/);
      await fs.access(path.join(files,'should-not-exist.pdf')).then(()=>assert.fail('Unreadable PDF was written'),()=>{});await shot('wide-chart-limit');await page.keyboard.press('Escape');return {geometry,html,message};
    });
    await test('E05-timeout-abort-cleanup',async()=>{
      const result=await page.evaluate(async()=>{
        const renderer=LoopKnowledgeEditor.createRenderer({getNotes:()=>[],getContent:()=>'',offlineExport:true});
        const directed=await renderer.exportStatic('```mermaid\n%%{init: {"htmlLabels": true}}%%\nflowchart LR\n A[输入] --> B[结果]\n```');
        const host=document.createElement('div');host.innerHTML=directed.html;
        const secureLabels=[...host.querySelectorAll('text')].map(e=>e.textContent).join(' ');
        const graph='```mermaid\nflowchart TD\n'+Array.from({length:70},(_,i)=>' A'+i+' --> A'+(i+1)).join('\n')+'\n```';
        const timed=await renderer.exportStatic(graph,{}, {timeoutMs:0});
        const controller=new AbortController();const pending=renderer.exportStatic(graph,{}, {signal:controller.signal});controller.abort();
        let aborted=false;try{await pending}catch(error){aborted=error.name==='AbortError'}
        return {issues:timed.issues,aborted,secureLabels,remaining:document.querySelectorAll('.kn-export-surface').length};
      });assert.match(result.issues.join(' '),/超时/);assert.match(result.secureLabels,/输入/);assert.match(result.secureLabels,/结果/);assert.equal(result.aborted,true);assert.equal(result.remaining,0);return result;
    });
    await test('E09-font-failure-and-resource-propagation',async()=>{
      const result=await exportedWindow(path.join(files,'rich-export.html'),async tab=>{
        await tab.evaluate(()=>{const style=document.createElement('style');style.textContent='@font-face{font-family:BrokenFont;src:url(data:font/woff2;base64,AAAA)}body{font-family:BrokenFont}';document.head.append(style);document.body.offsetHeight;});
        return tab.evaluate(`(${readyNoteDocument.toString()})({print:false})`).then(()=>({rejected:false}),e=>({rejected:true,message:e.message}));
      });assert.equal(result.rejected,true);assert.match(result.message,/字体加载失败/);return result;
    });
    await test('E10-task-and-node-pdf',async()=>{
      const outputs=[];
      for(const kind of ['task','node']){
        const file=path.join(files,kind+'-regression.pdf');await nativeSave(file);
        const receipt=await page.evaluate(async kind=>kind==='task'?personalTaskTrack.export.taskDocument({taskTitle:'任务回归',format:'pdf',html:'<h2>任务正文</h2><p>周边功能保持</p>',markdown:'任务正文'}):personalTaskTrack.export.nodeDetailPdf({nodeTitle:'节点回归',taskTitle:'任务',html:'<p>节点正文保持</p>'}),kind);
        assert.equal(receipt.filePath,file);assert.ok((await fs.readFile(file)).subarray(0,5).equals(Buffer.from('%PDF-')));outputs.push(file);
      }return outputs;
    });
    await test('E03-restart',async()=>{
      await app.close();app=await _electron.launch({executablePath:process.env.LOOP_APP_EXECUTABLE||require('electron'),args:process.env.LOOP_APP_EXECUTABLE?[]:[source],cwd:source,env});
      await until(()=>{page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));return page});await page.waitForSelector('.navigation');
      await choose('e');await mode('preview');await page.waitForSelector('.kn-reading .kn-mermaid svg',{state:'attached'});
      const rect=await page.locator('.kn-reading .kn-mermaid svg').evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));assert.ok(rect.width>=240&&rect.height>=40);return rect;
    });
  }finally{await app?.close().catch(()=>{});await json('results',{run,source,profile,files,results,errors})}
  if(results.some(r=>r.status==='FAIL')||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});

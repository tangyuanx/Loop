const wb=require('./workbench-helpers.cjs');
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
const lineBreaks = ['测试知识笔记：检查逐行文字与图片','测试第一行','测试第二行','测','测试第三行',
  '![终端截图](attachments/terminal.svg)','现在在哪里？','测试第四行','测试第五行','',
  '同行图片 ![行内图标](attachments/inline.svg) 后面文字','','硬换行  ','下一行','','反斜线换行\\','下一段',
  '','- 列表首行','  列表续行','','> 引用首行','> 引用续行','',
  '| 项目 | 内容 |','| --- | --- |','| 表格 | 原样保留 |','','```text','原样代码','下一行代码','```','',
  '![[note:note-g]]','表格与代码之后','结束行',
  ...Array.from({length:8},(_,i)=>`尾部第${i+1}行`),''].join('\r\n');
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
  await wb.minimizeTaskInfo(page);
}
async function mode(value) { await wb.mode(page,value);await page.waitForFunction(value=>knowledgeCurrentEntry()?.mode===value,value); }
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
  await app.evaluate(async({BrowserWindow},file)=>{
    // Windows does not reliably produce compositor frames for a hidden native
    // window. Show the isolated offline artifact there so screenshots verify
    // the actual output instead of waiting forever on an occluded surface.
    global.__exportInspect=new BrowserWindow({show:process.platform==='win32',width:1000,height:1000,webPreferences:{sandbox:true,backgroundThrottling:false}});
    await global.__exportInspect.loadFile(file);
  },file);
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
  await fs.writeFile(path.join(files,'attachments/terminal.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="273" height="146"><rect width="273" height="146" rx="4" fill="black"/><text x="12" y="80" fill="white" font-family="monospace" font-size="20">vim session1.txt</text></svg>');
  await fs.writeFile(path.join(files,'attachments/inline.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="7" fill="#387356"/></svg>');
  const bound=path.join(files,'bound.md');await fs.writeFile(bound,rich);const disk=await readKnowledgeDocument(bound);
  const linesFile=path.join(files,'line-breaks.md');await fs.writeFile(linesFile,lineBreaks);const linesDisk=await readKnowledgeDocument(linesFile);
  const tableSource=['# 表格回归','','| 项目 | 内容 |','| --- | --- |','| 甲 | 一 |','| 乙 | 二 |','','表格后正文。',''].join('\n');
  const tableFile=path.join(files,'table.md');await fs.writeFile(tableFile,tableSource);const tableDisk=await readKnowledgeDocument(tableFile);
  const stamp=new Date().toISOString();
  const task=(id,title,notes,note={})=>({id,title,notes,nodes:[],createdAt:stamp,updatedAt:stamp,knowledgeNote:{noteId:'note-'+id,title,documentState:'DRAFT',...note}});
  await writeTaskData(profile,{version:2,knowledgeSchemaVersion:1,taskFilter:'all',activeTaskId:'a',tasks:[
    task('a','S1 公式、图表与多页导出',rich,{filePath:bound,documentState:'SAVED',dirty:false,...disk}),
    task('b','快照嵌入笔记','# 嵌入内容\n\n快照中的旧嵌入内容。\n'),
    task('c','异常图表与资源','# 异常内容\n\n```mermaid\nflowchart LR\n A[bad syntax\n```\n\n![缺失附件](attachments/missing.png)\n\n![网络图片](https://example.invalid/remote.png)\n'),
    task('d','超宽图表','# 超宽图表\n\n```mermaid\nflowchart LR\n'+Array.from({length:18},(_,i)=>` N${i}[中文节点${i}] --> N${i+1}[中文节点${i+1}]`).join('\n')+'\n```\n'),
    task('e','简单图表','# 简单图表\n\n'+simple),
    task('f','编辑与阅读换行一致性',lineBreaks,{filePath:linesFile,documentState:'SAVED',dirty:false,...linesDisk}),
    task('g','换行嵌入目标','嵌入第一行\n嵌入第二行\n'),
    task('h','表格回归',tableSource,{filePath:tableFile,documentState:'SAVED',dirty:false,...tableDisk}),
  ]});
  const env={...process.env,LOOP_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:process.env.LOOP_APP_EXECUTABLE||require('electron'),args:process.env.LOOP_APP_EXECUTABLE?[]:(process.env.LOOP_NO_SANDBOX?['--no-sandbox',source]:[source]),cwd:source,env});
  try{
    await until(()=>{page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));return page});
    page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.navigation');
    await json('runtime',await app.evaluate(({app})=>({version:app.getVersion(),userData:app.getPath('userData'),appPath:app.getAppPath(),versions:process.versions})));
    await test('E11-line-breaks-images-and-source-fidelity',async()=>{
      await choose('f');const observations=[];
      async function layout(scope) {
        return page.locator(scope).evaluate(root=>{
          function text(value) {
            const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
            while(node=walker.nextNode()) {const at=node.textContent.indexOf(value);if(at<0)continue;
              const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+value.length);const r=range.getBoundingClientRect();
              return {left:r.left,top:r.top,bottom:r.bottom};}
            throw Error('Missing rendered text: '+value);
          }
          const image=root.querySelector('img[alt="终端截图"]'),r=image.getBoundingClientRect();
          return {lines:['测试第一行','测试第二行','测试第三行','现在在哪里？','测试第四行','测试第五行'].map(text),
            image:{left:r.left,top:r.top,bottom:r.bottom,width:r.width,height:r.height},
            inline:[text('同行图片'),text('后面文字')],breaks:root.querySelectorAll('br').length};
        });
      }
      function separated(result) {
        for(let i=1;i<result.lines.length;i++)assert.ok(result.lines[i].top>result.lines[i-1].top+10,'separate source lines must remain separate visual lines');
        assert.ok(result.image.top>=result.lines[2].bottom-1,'image follows its preceding text');
        assert.ok(result.lines[3].top>=result.image.bottom-1,'text after an image begins on the next line');
        assert.ok(Math.abs(result.lines[0].left-result.image.left)<2,'standalone image aligns with text');
        assert.ok(Math.abs(result.inline[0].top-result.inline[1].top)<2,'same-source-line image and text remain inline');
      }
      for(const theme of ['light','dark'])for(const size of [[1024,820],[1440,960]]){
        await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(...size),size);
        await page.evaluate(theme=>{state.theme=theme;render();},theme);
        for(const value of ['edit','preview']){
          await mode(value);const scope=value==='edit'?'.cm-content':'.kn-reading';
          await page.waitForFunction(scope=>{const img=document.querySelector(scope+' img[alt="终端截图"]');return img?.complete&&img.naturalWidth>0},scope);
          const result=await layout(scope);await shot(`E11-${theme}-${size[0]}-${value}`);separated(result);
          assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),lineBreaks);
          observations.push({theme,width:size[0],mode:value,...result});
        }
      }
      const structures=await page.evaluate(()=>{
        const renderer=knowledgeRendererForTask(shellActiveTask()),root=document.querySelector('.kn-reading');
        const endings=['\n','\r\n','\r'].map(ending=>{const el=document.createElement('div');el.innerHTML=renderer.render(['首行','次行','末行'].join(ending));return el.querySelectorAll('br').length});
        return {endings,hardBreaks:[...root.querySelectorAll('p')].filter(p=>p.textContent.includes('硬换行')||p.textContent.includes('反斜线换行')).map(p=>p.querySelectorAll('br').length),
          list:root.querySelector('li')?.querySelectorAll('br').length,quote:root.querySelector('blockquote')?.querySelectorAll('br').length,
          cells:root.querySelectorAll('td').length,code:root.querySelector('pre code')?.textContent,
          embedded:root.querySelector('.kn-embed-body')?.querySelectorAll('br').length};
      });
      assert.deepEqual(structures.endings,[2,2,2]);assert.deepEqual(structures.hardBreaks,[1,1]);
      assert.equal(structures.list,1);assert.equal(structures.quote,1);assert.equal(structures.cells,2);
      assert.equal(structures.code,'原样代码\n下一行代码\n');assert.equal(structures.embedded,1);
      const outputs={};for(const format of ['md','html','pdf'])outputs[format]=await download('line-breaks',format);
      assert.equal(await fs.readFile(outputs.md,'utf8'),lineBreaks);
      await exportedWindow(outputs.html,async tab=>{
        await tab.waitForFunction(()=>[...document.images].every(img=>img.complete&&img.naturalWidth>0));
        const main=tab.locator('main');assert.ok(await main.locator('br').count()>10);
        const result=await main.evaluate(root=>{const image=root.querySelector('img[alt="终端截图"]'),texts=[];const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
          while(node=walker.nextNode())for(const label of ['测试第三行','现在在哪里？']){const at=node.textContent.indexOf(label);if(at<0)continue;const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+label.length);texts.push({label,top:range.getBoundingClientRect().top,bottom:range.getBoundingClientRect().bottom});}
          const r=image.getBoundingClientRect();return {texts,top:r.top,bottom:r.bottom};});
        assert.ok(result.top>=result.texts.find(r=>r.label==='测试第三行').bottom-1);assert.ok(result.texts.find(r=>r.label==='现在在哪里？').top>=result.bottom-1);
        await tab.screenshot({path:path.join(out,'E11-export-html.png'),fullPage:true});
      });
      await mode('source');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),lineBreaks);
      assert.equal((await page.evaluate(()=>saveKnowledgeTask('f'))).success,true);assert.equal(await fs.readFile(linesFile,'utf8'),lineBreaks);
      return {observations,structures,outputs,sourceUnchanged:true};
    });
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
    /* 使用性回归：点击必须落在用户看到的那一行。判据不取自 CodeMirror 的
       高度图（它正是可能出错的一方），而是 DOM 真值：caretRangeFromPoint →
       posAtDOM 得到的源码行。块级控件（代码块、表格、提示框）与图片附近的
       行都要覆盖，并且点击点取在行的下半部——这正是"点到某一行、光标却掉到
       下一行"最容易出现的坐标。 */
    const clickLine = async (label, side = 'text') => {
      // The probe must see the line the way the user does: fully on screen. A line
      // clipped by the footer would make a lower-half click land outside the
      // editor surface, which says nothing about the editor's own mapping.
      for (let attempt = 0; attempt < 4; attempt++) {
        const state = await page.evaluate(label => {
          const view = knowledgeCurrentEntry().view;
          const line = [...view.contentDOM.querySelectorAll('.cm-line')].find(el => el.textContent.trim() === label);
          if (!line) return 'unrendered';
          const r = line.getBoundingClientRect();
          const body = (document.querySelector('.knowledge-body') || view.scrollDOM).getBoundingClientRect();
          return r.top < body.top + 24 || r.bottom > body.bottom - 64 ? 'clipped' : 'visible';
        }, label);
        if (state === 'visible') break;
        await page.evaluate(label => {
          const entry = knowledgeCurrentEntry(), view = entry.view;
          const el = [...view.contentDOM.querySelectorAll('.cm-line')].find(line => line.textContent.trim() === label);
          if (el) { el.scrollIntoView({ block: 'center' }); return; }
          // A line far outside the rendered viewport is not in the DOM at all:
          // scroll to its source position so CodeMirror materializes it.
          const index = view.state.doc.toString().split('\n').findIndex(line => line.trim() === label);
          if (index >= 0) entry.locate(view.state.doc.line(index + 1).from);
        }, label);
        await page.waitForTimeout(180);
      }
      const box = await page.evaluate(([label, side]) => {
        const view = knowledgeCurrentEntry().view;
        const line = [...view.contentDOM.querySelectorAll('.cm-line')].find(el => el.textContent.trim() === label);
        if (!line) return null;
        const r = line.getBoundingClientRect(), content = view.contentDOM.getBoundingClientRect();
        const source = view.state.doc.lineAt(view.posAtDOM(line, 0)).number;
        const x = side === 'right' ? Math.min(content.right - 14, r.right + 60) : Math.min(r.left + 40, content.right - 24);
        return { line: source, x, y: r.top + r.height * 0.75, top: r.top, bottom: r.bottom, screenX: x };
      }, [label, side]);
      assert.ok(box, `找不到渲染行「${label}」`);
      const onLine = await page.evaluate(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (hit.closest('.cm-line') || hit.closest('.cm-content')));
      }, [box.x, box.y]);
      assert.ok(onLine, `点击坐标必须仍落在「${label}」这一行的 DOM 上`);
      await page.mouse.click(box.x, box.y);
      await page.waitForTimeout(150);
      const actual = await page.evaluate(() => {
        const entry = knowledgeCurrentEntry(), view = entry.view;
        const pos = entry.getSelection().start, caret = view.coordsAtPos(pos);
        return { line: view.state.doc.lineAt(pos).number, caretTop: caret?.top ?? null, caretBottom: caret?.bottom ?? null };
      });
      assert.equal(actual.line, box.line, `点击「${label}」后光标应落在第 ${box.line} 行，实际第 ${actual.line} 行`);
      assert.ok(actual.caretTop !== null && actual.caretTop <= box.y + 2 && actual.caretBottom >= box.y - 2,
        `「${label}」的光标绘制位置（${Math.round(actual.caretTop)}–${Math.round(actual.caretBottom)}）必须与点击位置 ${Math.round(box.y)} 同行`);
      return { label, side, expected: box.line, actual: actual.line, caret: [Math.round(actual.caretTop), Math.round(actual.caretBottom)], y: Math.round(box.y) };
    };
    await test('E13-caret-lands-on-the-clicked-line-below-images-and-blocks', async () => {
      await choose('f'); await mode('edit');
      const observations = [];
      // 图片、表格、代码块之后的行：这些行此前会被块级替换装饰整体上移一行。
      for (const label of ['现在在哪里？', '测试第四行', '测试第五行', '下一行', '下一段', '列表续行', '引用续行', '表格与代码之后', '结束行']) {
        if (!await page.locator('.cm-content').getByText(label, { exact: true }).count()) continue;
        observations.push(await clickLine(label));
      }
      for (const label of ['测试第五行', '列表续行', '表格与代码之后']) {
        if (!await page.locator('.cm-content').getByText(label, { exact: true }).count()) continue;
        observations.push(await clickLine(label, 'right'));
      }
      // 图片所在行之后的第一行正文，必须仍能点中它自己。
      assert.ok(observations.length >= 9, '点击探针过少，说明目标行没有渲染出来');
      assert.equal(await page.evaluate(() => knowledgeCurrentEntry().getMarkdown()), lineBreaks, '点击本身不得改写源文件');
      return observations;
    });
    /* 滚动之后重建视口装饰，是这个编辑器另一处高风险路径：控件在视口内重新生成，
       高度图与 DOM 更容易错位。判据同上，全部使用 DOM 真值。 */
    await test('E14-caret-follows-the-clicked-line-after-scrolling', async () => {
      await choose('f'); await mode('edit');
      const body = page.locator('.knowledge-body');
      await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(900);
      const visible = await page.evaluate(() => {
        const view = knowledgeCurrentEntry().view;
        const content = view.contentDOM.getBoundingClientRect();
        const widgets = [...view.contentDOM.querySelectorAll('.kn-live-widget')].map(w => w.getBoundingClientRect());
        return [...view.contentDOM.querySelectorAll('.cm-line')]
          .map(el => ({ el, text: el.textContent.trim(), r: el.getBoundingClientRect() }))
          .filter(({ el, text, r }) => text.length > 1 && r.height > 8 && r.top > content.top + 30 && r.bottom < content.bottom - 70 &&
            !el.querySelector('.kn-live-widget,input,img,.kn-task-box'))
          // Lines below a rendered block are exactly the ones the height map
          // used to misplace after the viewport rebuilt while scrolling.
          .filter(({ r }) => widgets.some(w => w.bottom <= r.top + 1))
          .map(({ text }) => text);
      });
      assert.ok(visible.length >= 6, `滚动后块控件下方应有足够多的行可测，实际 ${visible.length} 行`);
      const observations = [];
      for (const text of visible.slice(0, 6)) observations.push(await clickLine(text));
      // 再滚回上部并重复一次，覆盖相反的滚动方向。
      await body.evaluate(el => { el.scrollTop = 0; });
      await page.waitForTimeout(700);
      for (const label of ['下一段', '引用续行', '表格与代码之后']) observations.push(await clickLine(label));
      return observations;
    });
    /* 表格行列操作回归：增删行列后 Markdown 形状、格子文本、保存与重开都一致；
       空单元格写入必须保持 "| 值 |" 的标准间距；表格后紧跟的正文不得被吞掉。 */
    await test('E15-table-row-and-column-edits-survive-save-and-reopen', async () => {
      await choose('h'); await mode('edit');
      await page.waitForSelector('.kn-table-widget table');
      const shape = () => page.evaluate(() => {
        const entry = knowledgeCurrentEntry(), markdown = entry.getMarkdown();
        const table = LoopKnowledgeCore.tableAt(markdown, Math.max(0, markdown.search(/^\|/m)));
        const widget = document.querySelector('.kn-table-widget');
        return { markdown, rows: table?.rows.length ?? null, columns: table?.rows[0].length ?? null,
          cells: table?.rows.map(row => row.join('|')) ?? null,
          domRows: widget?.querySelectorAll('table tr').length ?? null, domColumns: widget?.querySelector('table tr')?.cells.length ?? null };
      });
      const initial = await shape();
      assert.deepEqual({ rows: initial.rows, columns: initial.columns }, { rows: 4, columns: 2 }, JSON.stringify(initial));
      // 单元格里 Ctrl+Enter：在下方插入行，并把焦点交给新行。
      await page.locator('.kn-table-widget tbody tr').first().locator('td').first().click();
      await page.locator('.kn-table-cell-editor').waitFor();
      await page.keyboard.press('Control+Enter');
      await page.waitForTimeout(400);
      assert.match(await page.locator('.kn-table-cell-editor').getAttribute('aria-label'), /第2行，第1列/);
      await page.keyboard.type('丙');
      await page.keyboard.press('Tab');
      await page.keyboard.type('三');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      let current = await shape();
      assert.deepEqual({ rows: current.rows, columns: current.columns }, { rows: 5, columns: 2 }, JSON.stringify(current));
      assert.match(current.markdown, /^\| 丙 \| 三 \|$/m, `新增行必须保持标准单元格间距\n${current.markdown}`);
      // 悬停 + 按钮增加一列。
      await page.locator('.kn-table-widget th').first().hover();
      await page.locator('.kn-table-add-column').click({ force: true });
      await page.waitForTimeout(400);
      current = await shape();
      assert.deepEqual({ rows: current.rows, columns: current.columns }, { rows: 5, columns: 3 }, JSON.stringify(current));
      assert.match(current.markdown, /^\| 项目 \| 内容 \|  \|$/m, `新增列必须补齐表头\n${current.markdown}`);
      // 行菜单删除一行，列菜单删除一列。
      await page.locator('.kn-table-widget tbody tr').last().locator('td').first().click({ button: 'right' });
      await page.locator('.kn-table-menu [data-table-command="row-menu"]').click();
      await page.locator('.kn-table-menu [data-table-command="row-delete"]').click();
      await page.waitForTimeout(400);
      assert.deepEqual((({ rows, columns }) => ({ rows, columns }))(await shape()), { rows: 4, columns: 3 });
      await page.locator('.kn-table-widget th').last().click({ button: 'right' });
      await page.locator('.kn-table-menu [data-table-command="column-menu"]').click();
      await page.locator('.kn-table-menu [data-table-command="column-delete"]').click();
      await page.waitForTimeout(400);
      current = await shape();
      assert.deepEqual({ rows: current.rows, columns: current.columns }, { rows: 4, columns: 2 }, JSON.stringify(current));
      assert.ok(!current.markdown.includes('乙'), '删除的行不得残留');
      // 空行之后的正文必须仍是正文行，并且可以点击定位。
      const following = page.locator('.cm-content').getByText('表格后正文。', { exact: true }).first();
      assert.equal(await following.count(), 1, '表格后紧跟的正文必须仍然渲染为正文行');
      await following.click();
      assert.equal(await page.evaluate(() => { const e = knowledgeCurrentEntry(); return e.view.state.doc.lineAt(e.getSelection().start).text; }), '表格后正文。');
      // 保存到文件：磁盘字节与重新解析出的表格形状都必须一致。
      const saved = current.markdown;
      assert.equal((await page.evaluate(() => saveKnowledgeTask('h'))).success, true);
      const diskText = await fs.readFile(tableFile, 'utf8');
      assert.equal(diskText, saved, '保存必须逐字节写入本次编辑结果');
      const reparsed = await page.evaluate(text => {
        const table = LoopKnowledgeCore.tableAt(text, Math.max(0, text.search(/^\|/m)));
        return { rows: table?.rows.length ?? null, columns: table?.rows[0].length ?? null, cells: table?.rows.map(row => row.join('|')) ?? null };
      }, diskText);
      assert.deepEqual({ rows: reparsed.rows, columns: reparsed.columns }, { rows: 4, columns: 2 }, JSON.stringify(reparsed));
      // 关闭并重新打开笔记：编辑器重新挂载后必须渲染同样的表格与正文。
      await page.evaluate(() => {
        const session = state.knowledgeWorkspace;
        session.openIds = session.openIds.filter(id => id !== 'h');
        if (session.activeId === 'h') session.activeId = '';
        render();
      });
      await page.evaluate(() => knowledgeAttach(knowledgeFindDocument('h')));
      await page.waitForSelector('.kn-table-widget table');
      await page.waitForTimeout(300);
      const reopened = await shape();
      assert.equal(reopened.markdown, saved, '重新打开后的正文必须与保存时一致');
      assert.deepEqual({ rows: reopened.rows, columns: reopened.columns }, { rows: 4, columns: 2 }, JSON.stringify(reopened));
      return { initial: { rows: initial.rows, columns: initial.columns }, saved, reparsed: { rows: reparsed.rows, columns: reparsed.columns }, reopened: { rows: reopened.rows, columns: reopened.columns } };
    });
    /* 长期界面规则：输入控件（含搜索、标题改名、富文本、表格单元格）不得出现
       绿色 border/outline/外圈/光晕，外层容器的 :focus-within 也不能间接加回；
       明暗主题都要成立。判据取渲染后的计算样式。 */
    await test('E16-inputs-never-show-a-green-focus-ring', async () => {
      const greenish = value => {
        const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!match) return false;
        const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
        return g > r + 12 && g > b + 8;
      };
      const audit = async label => page.evaluate(({ label, greenish }) => {
        const green = new Function('value', `return (${greenish})(value)`);
        const rows = [];
        const check = (el, role) => {
          if (!el) return;
          const style = getComputedStyle(el);
          const shadows = style.boxShadow === 'none' ? [] : style.boxShadow.match(/rgba?\([^)]*\)/g) || [];
          const borders = ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor']
            .filter(k => parseFloat(style[k.replace('Color', 'Width')]) > 0 && green(style[k])).map(k => k + '=' + style[k]);
          if (borders.length || green(style.outlineColor) && style.outlineStyle !== 'none' || shadows.some(green)) {
            rows.push({ label, role, cls: String(el.className).slice(0, 60), borders, outline: style.outlineStyle + ' ' + style.outlineColor, shadow: style.boxShadow });
          }
        };
        for (const el of document.querySelectorAll('input, textarea, select, [contenteditable="true"], .cm-content, .kn-table-cell-editor')) check(el, 'control');
        for (const el of document.querySelectorAll('.list-search, .kn-find-field, .kn-switcher-search, .widget-capture, .recovery26-search, .control22-field')) check(el, 'wrapper');
        return rows;
      }, { label, greenish: greenish.toString() });
      const violations = [];
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { state.theme = theme; render(); }, theme);
        await page.waitForTimeout(250);
        await choose('f');
        await page.locator('.list-search input').focus();
        violations.push(...await audit(`${theme}-search`));
        await page.locator('[data-kn-action="find"]').click();
        await page.locator('.kn-find input').first().focus();
        violations.push(...await audit(`${theme}-find`));
        await page.keyboard.press('Escape');
        await page.locator('.kn-table-widget tbody td').first().click();
        await page.locator('.kn-table-cell-editor').waitFor();
        violations.push(...await audit(`${theme}-table-cell`));
        await page.keyboard.press('Escape');
        await page.locator('[data-wb-action="more"]').click();
        await page.locator('.wb-more-menu [data-kn-action="rename"]').click();
        await page.locator('#kn-rename-title').focus();
        violations.push(...await audit(`${theme}-rename`));
        await page.keyboard.press('Escape');
        await page.locator('[data-action="toggle-settings"]').click();
        await page.waitForTimeout(400);
        violations.push(...await audit(`${theme}-settings`));
        await page.locator('[data-action="toggle-settings"]').click();
        await page.waitForTimeout(250);
      }
      assert.deepEqual(violations, [], '输入控件不得出现绿色焦点：' + JSON.stringify(violations));
      await page.evaluate(() => { state.theme = 'light'; render(); });
      return { auditedThemes: ['light', 'dark'], surfaces: ['search', 'find', 'table-cell', 'rename', 'settings'] };
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
      await app.close();app=await _electron.launch({executablePath:process.env.LOOP_APP_EXECUTABLE||require('electron'),args:process.env.LOOP_APP_EXECUTABLE?[]:(process.env.LOOP_NO_SANDBOX?['--no-sandbox',source]:[source]),cwd:source,env});
      await until(()=>{page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));return page});await page.waitForSelector('.navigation');
      await choose('e');await mode('preview');await page.waitForSelector('.kn-reading .kn-mermaid svg',{state:'attached'});
      const rect=await page.locator('.kn-reading .kn-mermaid svg').evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));assert.ok(rect.width>=240&&rect.height>=40);return rect;
    });
  }finally{await app?.close().catch(()=>{});await json('results',{run,source,profile,files,results,errors})}
  if(results.some(r=>r.status==='FAIL')||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});

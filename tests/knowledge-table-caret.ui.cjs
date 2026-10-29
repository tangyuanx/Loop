/* Pointer coordinates come from DOM text ranges, independently of CodeMirror's
   height map. Exercise the production editor and stylesheet order. */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright-core');
const repository=path.resolve(__dirname,'..');
(async()=>{
  const index=await fs.readFile(path.join(repository,'app/renderer/index.html'),'utf8');
  const styles=[...index.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m=>m[0]).join('\n');
  const body=index.match(/<body([^>]*)>/)[1];
  const fixture=`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><base href="/app/renderer/">${styles}
    <style>body{display:block;margin:0}.knowledge-pane{height:100vh}.knowledge-body{overflow:auto}</style>
    </head><body${body}><main class="workspace knowledge-workspace"><section class="knowledge-pane">
    <div class="knowledge-body"><div class="knowledge-page width-default"><div id="editor" class="knowledge-rich-host"></div></div></div>
    </section></main><script src="src/knowledge-core.js"></script><script src="src/vendor/knowledge-editor.js"></script></body></html>`;
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');return res.end(fixture);}
    const file=path.resolve(repository,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(repository+path.sep))return res.writeHead(403).end();
    try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(await fs.readFile(file));}
    catch{res.writeHead(404).end();}
  });
  let browser;const errors=[];let clicks=0;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,executablePath:process.env.LOOP_TEST_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
    const page=await browser.newPage({viewport:{width:1280,height:820}});
    page.on('pageerror',error=>{errors.push(error.message);console.error('PAGEERROR',error.message,error.stack);});
    page.on('console',message=>{if(message.type()==='error')console.error(message.text());});
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    const paragraphs=label=>Array.from({length:12},(_,i)=>`${label}${String(i+1).padStart(2,'0')}：正文点击定位，中文 English 123。`).join('\n');
    const source=`表格之前的正文\n\n| 项目 | 内容 |\n| --- | --- |\n| 一 | 原始内容 |\n| 二 | 第二行 |\n\n${paragraphs('首表之后')}\n\n| 列一 | 列二 |\n| --- | --- |\n| 三 | 第三行 |\n\n${paragraphs('次表之后')}\n`;
    await page.evaluate(async source=>{window.editor=await LoopKnowledgeEditor.create({root:document.querySelector('#editor'),markdown:source,mode:'edit',noteId:'caret-regression'});await document.fonts.ready;},source);
    const settled=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    async function clickText(text,offset=6){
      const line=page.locator('.cm-line').filter({hasText:text}).first();
      await line.scrollIntoViewIfNeeded();await settled();
      const target=await line.evaluate((el,offset)=>{
        const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node,remaining=offset;
        while((node=walker.nextNode())){if(remaining<node.length)break;remaining-=node.length;}
        if(!node)throw new Error('Text offset outside line');
        const range=document.createRange();range.setStart(node,remaining);range.setEnd(node,remaining+1);
        const r=range.getBoundingClientRect();
        return {x:r.left+0.2,y:(r.top+r.bottom)/2,expected:editor.view.posAtDOM(node,remaining)};
      },offset);
      await page.mouse.click(target.x,target.y);await settled();
      const actual=await page.evaluate(()=>({head:editor.view.state.selection.main.head,caret:editor.view.coordsAtPos(editor.view.state.selection.main.head),cursor:editor.root.querySelector('.cm-cursor')?.getBoundingClientRect().toJSON()}));
      assert.equal(actual.head,target.expected,`${text}: click at ${target.y} selected ${actual.head}, expected ${target.expected}`);
      assert.ok(actual.caret.top<=target.y+1&&actual.caret.bottom>=target.y-1,`${text}: caret shifted vertically`);
      assert.ok(actual.cursor&&actual.cursor.top<=target.y+1&&actual.cursor.bottom>=target.y-1,`${text}: painted cursor shifted vertically`);
      clicks++;
    }
    for(const theme of ['light','dark'])for(const width of [1280,1024])for(const scale of [1,1.25]){
      await page.setViewportSize({width,height:820});
      await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.setProperty('--font-scale',scale);editor.view.requestMeasure();},{theme,scale});
      await settled();
      for(const prefix of ['首表之后','次表之后'])for(const number of ['01','02','06','12'])await clickText(prefix+number);
    }
    // Table edits, wrapping and width changes must not leave stale body geometry.
    await page.evaluate(()=>{editor.resizeTableColumn(1,140);editor.view.requestMeasure();});
    await page.locator('.kn-table-widget tbody td').first().click();
    await page.locator('.kn-table-cell-editor').fill('长内容 '.repeat(25));
    await page.keyboard.press('Escape');await settled();
    await clickText('首表之后01');await clickText('次表之后02');
    await page.keyboard.insertText('定位插入');
    assert.ok(await page.evaluate(()=>editor.getMarkdown().includes('次表之后02定位插入：正文')));
    await page.evaluate(()=>editor.format('undo'));
    assert.ok(await page.evaluate(()=>!editor.getMarkdown().includes('定位插入')));
    await page.evaluate(()=>editor.setMode('source'));await settled();await clickText('首表之后02');
    await page.evaluate(()=>editor.setMode('edit'));await settled();await clickText('次表之后06');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'PASS',clicks,checks:'two tables, DOM pointer vs source selection and painted cursor, scrolling, light/dark, widths, font scales, table edit/width, insertion/undo, source/edit modes'}));
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

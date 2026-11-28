/* #106 and #111: table selections and menus are UI-only in the real editor. */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');

async function main(){
  const review=process.argv.includes('--review'),root=path.resolve(__dirname,'..');
  const evidence=await fs.mkdtemp(path.join(root,'.local-review/table-highlight-'));
  const text='# 表格行列反馈\n\n点击行或列按钮查看作用范围。移开鼠标仍保留，点击表格外恢复。\n\n'+
    '| 项目 | 状态 | 负责人 |\n| --- | --- | --- |\n| 方案 | [已确认](https://example.com) | 小林 |\n| 设计 | 进行中 | 小陈 |\n| 验证 | 待执行 | ![样图](./fixture.png) |\n\n'+
    '第二张表格\n\n| 阶段 | 内容 | 结果 |\n| --- | --- | --- |\n'+
    Array.from({length:18},(_,i)=>`| 阶段${i+1} | 工作${i+1} | 记录${i+1} |`).join('\n')+'\n\n表格外正文';
  const file=path.join(evidence,'表格行列反馈.md');await fs.writeFile(file,text);
  await fs.writeFile(path.join(evidence,'fixture.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=','base64'));
  const disk=await readKnowledgeDocument(file);
  const run=await launchRepository({activeTaskId:'highlight',taskPane:'notes',tasks:[task('highlight',{
    title:'表格行列反馈',notes:text,knowledgeNote:{...disk,title:'表格行列反馈',documentState:'SAVED',dirty:false}
  })]},'table-highlight');
  const {app,page,profile,errors}=run;
  const runtime=await app.evaluate(({app})=>({appPath:app.getAppPath(),userData:app.getPath('userData'),pid:process.pid,version:app.getVersion()}));
  assert.equal(runtime.appPath,root);assert.equal(runtime.userData,profile);
  const report={runtime,evidence,file,checks:[],errors};
  const check=label=>{report.checks.push(label);console.log('PASS '+label);};
  const widgets=page.locator('.kn-table-widget'),widget=i=>widgets.nth(i);
  const handle=(kind,index,table=0)=>widget(table).locator(`[data-table-handle="${kind}"][data-index="${index}"]`);
  const ranges=()=>page.locator('.kn-table-widget').evaluateAll(widgets=>widgets.flatMap((widget,t)=>
    [...widget.querySelector('table').rows].flatMap((row,r)=>[...row.cells].flatMap((cell,c)=>cell.hasAttribute('data-table-highlight')?[[t,r,c]]:[]))));
  const expected=(kind,index,table=0,rows=4,columns=3)=>kind==='row'?Array.from({length:columns},(_,c)=>[table,index,c]):Array.from({length:rows},(_,r)=>[table,r,index]);
  const menu=page.locator('.kn-table-menu');
  const rowCell=(row,column=0,table=0)=>widget(table).locator('tbody tr').nth(row-1).locator('td').nth(column);
  const selectRow=async(index,table=0)=>{
    await handle('row',index,table).click();
    assert.equal(await menu.count(),0,'left click only selects the row');
    assert.deepEqual(await ranges(),expected('row',index,table,table?19:4));
  };
  const choose=async(kind,index,table=0)=>{
    await handle(kind,index,table).click({button:'right'});
    await menu.waitFor();
    assert.deepEqual(await ranges(),expected(kind,index,table,table?19:4));
  };
  const dismiss=async()=>{await page.keyboard.press('Escape');await page.locator('.kn-table-menu').waitFor({state:'detached'});};
  const outside=()=>page.locator('.knowledge-footer [data-kn-mode-status]').click();
  try{
    await page.locator('[data-pane=notes]').click();await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);
    await page.waitForFunction(()=>knowledgeCurrentEntry().getMarkdown().includes('阶段18'));
    if(review){
      runtime.title=await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html'));window.setTitle('Loop · 需求111 表格行菜单验收');window.setSize(1280,850);window.show();window.focus();return window.getTitle();});
      await selectRow(2);await page.mouse.move(1000,210);
      await page.screenshot({path:path.join(evidence,'candidate.png')});
      await fs.writeFile(path.join(evidence,'runtime.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify(report));await new Promise(resolve=>app.once('close',resolve));return;
    }
    await page.evaluate(async()=>{save();await flushSave();});
    const snapshot=()=>page.evaluate(()=>{const note=knowledgeActiveDocument();return {text:knowledgeCurrentEntry().getMarkdown(),note:note.knowledgeNote,updatedAt:note.updatedAt};});
    const before=await snapshot(),stat=await fs.stat(file);
    await handle('row',1).hover();assert.deepEqual(await ranges(),[]);
    await selectRow(1);await selectRow(1);await page.mouse.move(1000,210);assert.deepEqual(await ranges(),expected('row',1));
    for(const column of [0,2]){
      await rowCell(1,column).click({button:'right',position:column===0?{x:27,y:10}:{x:85,y:25}});
      await menu.waitFor();
      assert.equal(await menu.getAttribute('aria-label'),'第 1 行操作');
      assert.deepEqual(await ranges(),expected('row',1));
      assert.equal(await page.locator('.kn-table-cell-editor').count(),0);
      await dismiss();
    }
    await rowCell(2).click({button:'right'});
    await menu.waitFor();
    assert.equal(await menu.getAttribute('aria-label'),'3 行 · 3 列操作','right-click on an unselected row keeps the general table menu');
    await dismiss();
    await choose('row',2);
    assert.equal(await menu.getAttribute('aria-label'),'第 2 行操作');
    await selectRow(3);
    await choose('row',3);await selectRow(3);
    await choose('row',1);
    await dismiss();assert.deepEqual(await ranges(),expected('row',1));
    assert.equal(await handle('row',1).evaluate(el=>el===document.activeElement),true);
    await rowCell(1,1).locator('a').click({button:'right'});
    await page.getByRole('menu',{name:'链接操作'}).waitFor();
    assert.equal(await menu.count(),0);
    await page.keyboard.press('Escape');
    await selectRow(3);
    await rowCell(3,2).locator('img').click({button:'right'});
    await page.getByRole('menu',{name:'图片操作'}).waitFor();
    assert.equal(await menu.count(),0);
    await page.keyboard.press('Escape');
    await selectRow(2);
    await rowCell(2).click();
    await page.locator('.kn-table-cell-editor').click({button:'right'});
    await page.getByRole('menu',{name:'单元格格式菜单'}).waitFor();
    assert.equal(await menu.count(),0);
    await page.keyboard.press('Escape');
    await selectRow(1);
    await handle('column',2).hover();assert.deepEqual(await ranges(),expected('row',1),'hover never switches the clicked range');
    for(const column of [0,2,2]){
      await handle('column',column).click();
      assert.equal(await menu.count(),0,'left click only selects the column');
      assert.deepEqual(await ranges(),expected('column',column));
    }
    await choose('column',0);await handle('column',2).click();
    assert.equal(await menu.count(),0,'left click closes the old menu');assert.deepEqual(await ranges(),expected('column',2));
    await rowCell(2,2).click({button:'right',position:{x:30,y:12}});await menu.waitFor();
    assert.equal(await menu.getAttribute('aria-label'),'第 3 列操作');assert.deepEqual(await ranges(),expected('column',2));await dismiss();
    await handle('column',0).focus();await page.keyboard.press('Shift+F10');await menu.waitFor();
    assert.equal(await menu.getAttribute('aria-label'),'第 1 列操作');await dismiss();
    await choose('column',1);await dismiss();
    await widget(0).locator('tbody td').first().click();assert.deepEqual(await ranges(),expected('column',1),'inside-table clicks preserve the range');
    const input=page.locator('.kn-table-cell-editor');
    assert.equal(await input.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    await page.keyboard.press('Escape');
    await choose('row',0);await dismiss();assert.deepEqual(await ranges(),expected('row',0),'header rows are included');
    await outside();assert.deepEqual(await ranges(),[]);
    await handle('column',0).hover();assert.deepEqual(await ranges(),[]);
    await page.evaluate(()=>knowledgeCurrentEntry().view.dom.blur());
    assert.deepEqual(await snapshot(),before,'range feedback does not dirty or change the document');
    assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().format('undo')),false,'range feedback adds no undo entry');
    assert.equal(await fs.readFile(file,'utf8'),text);assert.equal((await fs.stat(file)).mtimeMs,stat.mtimeMs);
    check('left-select, both right-click targets, correct row, menu switching, link/image priority and unchanged file/state/history');

    await handle('column',2).focus();await page.keyboard.press('Enter');
    await page.locator('.kn-table-menu').waitFor();assert.deepEqual(await ranges(),expected('column',2));await dismiss();
    await handle('row',3).focus();await page.keyboard.press('Space');
    await page.locator('.kn-table-menu').waitFor();assert.deepEqual(await ranges(),expected('row',3));await dismiss();
    await handle('row',1).focus();await page.keyboard.press('Shift+F10');
    await menu.waitFor();assert.equal(await menu.getAttribute('aria-label'),'第 1 行操作');await dismiss();
    check('Enter, Space and Shift+F10 retain keyboard menu access');

    for(const theme of ['light','dark'])for(const width of [1280,1024]){
      await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(width,820),width);
      await page.evaluate(theme=>{state.theme=theme;state.fontScale=theme==='dark'?'largest':'larger';render();},theme);
      await choose('column',1);await dismiss();await page.mouse.move(1000,200);
      const colors=await widget(0).locator('tbody td').evaluateAll(cells=>{
        const ctx=document.createElement('canvas').getContext('2d');
        const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
        return cells.map(cell=>({background:rgb(getComputedStyle(cell).backgroundColor),text:rgb(getComputedStyle(cell).color),marked:cell.hasAttribute('data-table-highlight')}));
      });
      const luminance=rgb=>rgb.map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
      for(const color of colors.filter(color=>color.marked)){
        const levels=[luminance(color.background),luminance(color.text)].sort((a,b)=>b-a);
        assert.ok((levels[0]+.05)/(levels[1]+.05)>=4.5,'highlighted cell text remains readable');
      }
      assert.notDeepEqual(colors[0].background,colors[1].background,'the selected background visibly differs');
      await page.screenshot({path:path.join(evidence,`${theme}-${width}.png`)});
      await outside();
    }
    check('light/dark neutral background, readable text, normal/largest type and 1280/1024 windows');

    await page.evaluate(()=>{state.theme='light';state.fontScale='larger';render();});
    await selectRow(10,1);
    await rowCell(10,1,1).click({button:'right'});
    await menu.waitFor();assert.equal(await menu.getAttribute('aria-label'),'第 10 行操作');
    assert.deepEqual(await ranges(),expected('row',10,1,19));
    assert.equal(await menu.evaluate(el=>{const rect=el.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight;}),true);
    await dismiss();
    await choose('column',2,1);await dismiss();assert.equal((await ranges()).length,19,'the second table clears the first');
    await page.mouse.move(900,500);await page.mouse.wheel(0,320);
    assert.deepEqual(await ranges(),expected('column',2,1,19),'vertical scrolling preserves the actual cells');
    await outside();
    await page.evaluate(()=>{const e=knowledgeCurrentEntry(),widget=e.root.querySelector('.kn-table-widget');e.resizeTableColumn(0,350,widget);e.resizeTableColumn(1,350,widget);e.resizeTableColumn(2,350,widget);});
    await choose('column',0);await dismiss();
    const scrolled=await widget(0).evaluate(el=>{el.scrollLeft=130;return el.scrollLeft;});assert.ok(scrolled>0);
    assert.deepEqual(await ranges(),expected('column',0));
    await outside();await page.evaluate(()=>knowledgeCurrentEntry().fitTableWidth(0));
    check('multiple tables and vertical/horizontal scrolling keep the selected range attached to cells');

    const command=async(kind,index,name)=>{await choose(kind,index);await page.locator(`[data-table-command="${name}"]:not(:disabled)`).first().click();await page.waitForFunction(()=>!document.querySelector('.kn-table-menu'));assert.deepEqual(await ranges(),[],'outside menu action clears stale ranges');};
    const undo=async()=>{await page.evaluate(()=>knowledgeCurrentEntry().format('undo'));};
    await command('row',1,'row-add');assert.equal(await widget(0).locator('tr').count(),5);await undo();
    await command('column',1,'column-delete');assert.equal(await widget(0).locator('th').count(),2);await undo();
    await command('row',1,'row-move');assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/\| 设计.*\n\| 方案/);await undo();
    await choose('row',1);await dismiss();
    const start=await handle('row',1).boundingBox(),end=await handle('row',3).boundingBox();
    await page.evaluate(()=>{window.__rowDragEvents=[];window.__rowDragAbort=new AbortController();for(const type of ['pointerdown','pointermove','pointerup','pointerleave'])document.addEventListener(type,event=>window.__rowDragEvents.push({type,target:event.target.className,x:event.clientX,y:event.clientY}),{capture:true,signal:window.__rowDragAbort.signal});});
    await page.mouse.move(start.x+8,start.y+start.height/2);await page.mouse.down();await page.mouse.move(end.x+8,end.y+end.height/2,{steps:12});await page.mouse.up();
    report.drag={start,end,events:await page.evaluate(()=>{window.__rowDragAbort.abort();return window.__rowDragEvents;})};
    assert.deepEqual(await ranges(),[]);assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/\| 验证.*\n\| 方案/);await undo();
    await choose('column',0);await dismiss();
    await page.reload();await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);
    assert.deepEqual(await ranges(),[],'transient range does not return after a renderer restart');
    assert.equal(await fs.readFile(file,'utf8'),text);
    check('insert/delete/reorder/drag, undo and renderer restart leave no stale range or file changes');
    assert.deepEqual(errors,[]);report.passed=true;
  }catch(error){report.error=error.stack;await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}
  finally{await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2));console.log('Table highlight evidence: '+evidence);await run.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

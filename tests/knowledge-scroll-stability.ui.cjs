const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');

const mod=process.platform==='darwin'?'Meta':'Control';
const sections=Array.from({length:35},(_,i)=>[
  `## Section ${i}`,'','```js',
  ...Array.from({length:8},(_,j)=>`const value${j} = ${i};`),'```','',
  `> [!note] Callout ${i}`,'> first','> second','',
  '$$\\frac{1}{1+x^2}$$','',
  '![local](image.png "[loop-image width=48 align=left]")','',
].join('\n')).join('\n');
const table='| Name | Value |\n| --- | --- |\n'+Array.from({length:65},(_,i)=>
  `| Row ${i} | ${i%2?'**bold**<br>second':'plain text'} |`).join('\n');
const paragraphs=Array.from({length:150},(_,i)=>`Following paragraph ${i}\n\n`).join('');

async function main(){
  const review=path.resolve('.local-review');await fs.mkdir(review,{recursive:true});
  const evidence=await fs.mkdtemp(path.join(review,'scroll-stability-120-'));
  const file=path.join(evidence,'Scroll.md');
  await fs.copyFile(path.resolve('app/resources/icon.png'),path.join(evidence,'image.png'));
  const initialSource=sections+'\n'+table+'\n\n'+paragraphs;
  await fs.writeFile(file,initialSource);
  const disk=await readKnowledgeDocument(file);
  const run=await launchRepository({activeTaskId:'scroll',taskPane:'notes',tasks:[task('scroll',{
    notes:initialSource,knowledgeNote:{...disk,title:'Scroll',documentState:'SAVED',dirty:false},
  })]},'scroll-stability',process.env.LOOP_APP_EXECUTABLE);
  const {page,errors}=run,results=[];
  const settle=()=>page.waitForTimeout(350);
  const source=()=>page.evaluate(()=>knowledgeCurrentEntry().getEditorText());
  const snapshot=cell=>cell.evaluate(cell=>{
    const b=knowledgeCurrentEntry().root.closest('.knowledge-body'),r=cell.getBoundingClientRect();
    const table=knowledgeCurrentEntry().root.querySelector('.kn-table-widget table');
    return {top:r.top,left:r.left,width:r.width,height:r.height,scroll:b.scrollTop,documentHeight:b.scrollHeight,
      tableTop:table?.getBoundingClientRect().top,rows:table&&[...table.rows].map(row=>row.getBoundingClientRect().height),
      layout:[...knowledgeCurrentEntry().view.contentDOM.children].map(el=>({
        text:el.textContent.slice(0,60),kind:el.className,height:el.getBoundingClientRect().height,
      }))};
  });
  async function observe(cell,label,action,{sameHeight=true}={}){
    const before=await snapshot(cell);
    await cell.evaluate(cell=>{
      const b=knowledgeCurrentEntry().root.closest('.knowledge-body');
      window.scrollFrames=[];
      const sample=()=>{
        const r=cell.getBoundingClientRect();
        scrollFrames.push({top:r.top,scroll:b.scrollTop,height:b.scrollHeight});
        window.scrollFrame=requestAnimationFrame(sample);
      };sample();
    });
    await action();await settle();
    const frames=await page.evaluate(()=>{cancelAnimationFrame(window.scrollFrame);return scrollFrames;});
    const after=await snapshot(cell);
    results.push({label,before,after,frames});
    await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({results,errors},null,2));
    assert.ok(Math.abs(after.top-before.top)<=1,`${label}: target moved ${before.top} → ${after.top}`);
    assert.ok(Math.abs(after.scroll-before.scroll)<=1,`${label}: scroll moved ${before.scroll} → ${after.scroll}`);
    assert.ok(frames.every(f=>Math.abs(f.top-before.top)<=1),`${label}: target jumped during an animation frame`);
    if(sameHeight)assert.ok(Math.abs(after.documentHeight-before.documentHeight)<=1,`${label}: document height changed`);
  }
  async function revealSource(needle){
    await page.evaluate(needle=>{
      const e=knowledgeCurrentEntry(),at=e.getEditorText().indexOf(needle);
      if(at<0)throw Error('Missing source: '+needle);
      e.view.dispatch({selection:{anchor:at},scrollIntoView:true});
    },needle);
    await settle();
  }
  try{
    await page.locator('[data-pane=notes]').click();
    await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);
    await page.evaluate(()=>document.fonts.ready);
    const initial=await source();
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>{state.theme=theme;render();},theme);
      await revealSource('| Name');
      for(const [row,col] of [[5,0],[5,1],[30,0],[45,1]]){
        const cell=page.locator('.kn-table-widget tbody tr').nth(row).locator('td').nth(col);
        await cell.scrollIntoViewIfNeeded();await settle();
        const value=await source(),label=`${theme} row ${row} col ${col}`;
        await observe(cell,label+' click',async()=>{
          const r=await cell.boundingBox();await page.mouse.click(r.x+20,r.y+18);
        });
        assert.equal(await cell.locator('.kn-table-cell-editor:visible').count(),1);
        assert.equal(await source(),value,'click never rewrites Markdown');
        await observe(cell,label+' input',async()=>{await page.keyboard.press('End');await page.keyboard.type('X');});
        assert.notEqual(await source(),value);
        await observe(cell,label+' undo',()=>page.keyboard.press(mod+'+z'));
        assert.equal(await source(),value);
        await observe(cell,label+' redo',()=>page.keyboard.press(mod+'+Shift+z'));
        await observe(cell,label+' save refresh',async()=>{
          await page.evaluate(()=>saveKnowledgeTask(knowledgeActiveDocument().id));
        });
        await observe(cell,label+' finish',()=>page.keyboard.press('Enter'));
        await cell.locator('.kn-table-cell-editor').waitFor({state:'detached'});
      }
    }
    const imeCell=page.locator('.kn-table-widget tbody tr').nth(5).locator('td').first();
    await imeCell.scrollIntoViewIfNeeded();await settle();await imeCell.click();await page.keyboard.press('End');
    const cdp=await page.context().newCDPSession(page);
    await observe(imeCell,'Chinese IME composition',()=>cdp.send('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2}));
    await observe(imeCell,'Chinese IME commit',()=>cdp.send('Input.insertText',{text:'中文'}));
    assert.ok((await source()).includes('中文'));
    await observe(imeCell,'Chinese IME finish',()=>page.keyboard.press('Enter'));
    assert.notEqual(await source(),initial);
    await page.evaluate(()=>saveKnowledgeTask(knowledgeActiveDocument().id));
    assert.equal(await fs.readFile(file,'utf8'),await source());
    await page.screenshot({path:path.join(evidence,'table.png')});

    // The same issue occurs outside tables, when the edited paragraph follows
    // offscreen code/callout/math/image widgets. Exercise both scroll directions.
    const noTable=sections+'\n'+paragraphs;
    await page.evaluate(markdown=>{
      const e=knowledgeCurrentEntry();e.finishTableCell();
      e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:markdown},selection:{anchor:0}});
    },noTable);
    for(const number of [5,95,20]){
      await revealSource('Following paragraph '+number+'\n');
      const line=page.locator('.cm-line').filter({hasText:new RegExp(`^Following paragraph ${number}X?$`)});
      await line.evaluate(el=>el.scrollIntoView({block:'center'}));await settle();
      await observe(line,'paragraph '+number+' click',async()=>{
        const r=await line.boundingBox();await page.mouse.click(r.x+60,r.y+r.height/2);
      });
      await observe(line,'paragraph '+number+' input',async()=>{await page.keyboard.press('End');await page.keyboard.type('X');});
    }
    // A click on a rendered block still keeps it rendered, while explicit
    // editing and mode switches continue to work after removing scroll rebuilds.
    await revealSource('const value0 = 20;');
    const code=page.locator('.kn-code').filter({hasText:'const value0 = 20;'});
    await code.scrollIntoViewIfNeeded();await settle();
    await observe(code,'code click',async()=>{
      const r=await code.locator('pre').boundingBox();await page.mouse.click(r.x+40,r.y+25);
    });
    await code.dblclick({position:{x:60,y:40}});
    await code.waitFor({state:'detached'});
    await page.keyboard.type('X');
    assert.ok((await source()).includes('X'));
    for(const mode of ['source','preview','edit']){
      await page.evaluate(mode=>knowledgeCurrentEntry().setMode(mode),mode);await settle();
      assert.equal(await page.locator('.kn-editor-host').getAttribute('data-mode'),mode);
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'PASS',observations:results.length,evidence,checks:'long mixed notes, plain/rich cells, frame-by-frame position, undo/redo, save, paragraphs without tables, code click/explicit edit, mode switches, light/dark'}));
  }finally{await run.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

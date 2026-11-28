const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {launchRepository,resizeRepositoryWindow,task}=require('./electron-ui-helpers.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');

const mod=process.platform==='darwin'?'Meta':'Control';
const redo=process.platform==='darwin'?'Meta+Shift+z':'Control+y';
const notes=Array.from({length:24},(_,i)=>[
  `## 表格 ${i}`,'',`| 表头 ${i} | 说明 |`,'| --- | --- |',
  ...Array.from({length:12+i%4*8},(_,r)=>`| 项目 ${i}-${r} | ${r%3?'普通文字':'**粗体**<br>第二行'} |`),
  '',`表格 ${i} 后的正文。`,'',
].join('\n')).join('\n');

async function main(){
  const base=path.resolve('.local-review');await fs.mkdir(base,{recursive:true});
  const evidence=await fs.mkdtemp(path.join(base,'table-headers-'));
  const file=path.join(evidence,'Tables.md');await fs.writeFile(file,notes);
  const disk=await readKnowledgeDocument(file);
  const run=await launchRepository({activeTaskId:'headers',taskPane:'notes',tasks:[task('headers',{
    notes,knowledgeNote:{...disk,title:'多表格稳定性',documentState:'SAVED',dirty:false},
  })]},'table-headers',process.env.LOOP_APP_EXECUTABLE);
  const {page,app,errors}=run,results=[];
  const settle=()=>page.waitForTimeout(250);
  const widget=index=>page.locator('.kn-table-widget').filter({has:page.locator('th').filter({hasText:new RegExp(`^表头 ${index}$`)})});
  const source=()=>page.evaluate(()=>knowledgeCurrentEntry().getEditorText());
  async function reveal(index){
    await page.evaluate(index=>{
      const e=knowledgeCurrentEntry(),at=e.getEditorText().indexOf(`| 表头 ${index} |`);
      if(at<0)throw Error('Missing table');
      e.view.dispatch({selection:{anchor:at},scrollIntoView:true});
    },index);
    await widget(index).waitFor();await settle();
    const cell=widget(index).locator('tbody tr').nth(8).locator('td').first();
    await cell.scrollIntoViewIfNeeded();await settle();
    await cell.evaluate(cell=>{
      const b=cell.closest('.knowledge-body'),r=cell.getBoundingClientRect(),v=b.getBoundingClientRect();
      b.scrollTop+=r.top-v.top-b.clientHeight/2;
    });await settle();
  }
  async function observe(index,label,action){
    await page.evaluate(index=>{
      const e=knowledgeCurrentEntry(),b=e.root.closest('.knowledge-body');
      if(e.tableScrollHost!==b||!b.isConnected)throw Error('Table headers must follow the live scroll container');
      window.headerFrames=[];
      const sample=()=>{
        const t=[...e.root.querySelectorAll('.kn-table-widget table')].find(t=>t.querySelector('th')?.textContent===`表头 ${index}`);
        const cell=t?.tBodies[0]?.rows[8]?.cells[0],h=t?.tHead;
        headerFrames.push({scroll:b.scrollTop,height:b.scrollHeight,cell:cell?.getBoundingClientRect().top,
          table:t?.getBoundingClientRect().top,header:h?.getBoundingClientRect().top});
        window.headerFrame=requestAnimationFrame(sample);
      };sample();
    },index);
    await action();await settle();
    const frames=await page.evaluate(()=>{cancelAnimationFrame(headerFrame);return headerFrames;});
    const before=frames[0],after=frames.at(-1);
    results.push({label,before,after,frames});
    await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({results,errors},null,2));
    assert.ok(frames.length>2,label+' sampled painted frames');
    for(const key of ['scroll','height','cell','table','header']){
      assert.ok(frames.every(frame=>Number.isFinite(frame[key])&&Math.abs(frame[key]-before[key])<=1),
        `${label}: ${key} moved ${before[key]} → ${after[key]}`);
    }
  }
  try{
    await page.locator('[data-pane=notes]').click();await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);
    await page.evaluate(()=>document.fonts.ready);
    for(const [theme,size,index] of [['light',[1280,850],17],['dark',[1024,768],20]]){
      await resizeRepositoryWindow(app,page,...size);
      await page.evaluate(theme=>{state.theme=theme;render();},theme);
      // Measure several preceding tables, then let CodeMirror virtualize them.
      // The edited document creates equal, unmounted widget instances; a save
      // refresh must retain their measured heights as well as the active table.
      for(let warm=0;warm<24;warm++)await reveal(warm);
      await reveal(index);
      const cell=widget(index).locator('tbody tr').nth(8).locator('td').first();
      const activeEditor=cell.locator('.kn-table-cell-editor:focus');
      const initial=await source();
      await widget(index).evaluate(widget=>{
        const header=widget.querySelector('thead').getBoundingClientRect();
        const edge=widget.querySelector('.kn-table-row-resizer[data-row="0"]').getBoundingClientRect();
        if(Math.abs(edge.top+edge.height/2-header.bottom)>1)
          throw Error('Header resize edge did not follow its row: '+JSON.stringify({headerBottom:header.bottom,edgeY:edge.top+edge.height/2}));
      });
      await observe(index,theme+' cell click',async()=>{
        await cell.click();
        await activeEditor.waitFor();
      });
      await observe(index,theme+' input',async()=>{
        await activeEditor.press('End');
        await page.keyboard.insertText('X');
        await page.waitForFunction(initial=>knowledgeCurrentEntry()?.getEditorText()!==initial,initial);
      });
      assert.notEqual(await source(),initial);
      await observe(index,theme+' save refresh',()=>page.evaluate(()=>saveKnowledgeTask(knowledgeActiveDocument().id)));
      assert.equal(await fs.readFile(file,'utf8'),await source());
      await observe(index,theme+' undo',()=>page.keyboard.press(mod+'+z'));assert.equal(await source(),initial);
      await observe(index,theme+' redo',()=>page.keyboard.press(redo));
      await observe(index,theme+' finish',()=>page.keyboard.press('Enter'));
      for(let i=0;i<3;i++)await observe(index,`${theme} repeated refresh ${i}`,()=>page.evaluate(()=>knowledgeCurrentEntry().refresh()));
      await page.screenshot({path:path.join(evidence,theme+'.png')});
      // A pinned header returns to its first row when scrolling back up, and
      // remains pinned in preview mode despite the hidden editor viewport.
      for(const mode of ['preview','edit']){
        await page.evaluate(mode=>knowledgeCurrentEntry().setMode(mode),mode);await settle();
        if(mode==='edit')await reveal(index);
        const table=mode==='preview'?page.locator('.kn-reading table').nth(index):widget(index).locator('table');
        await table.evaluate(t=>{
          const b=t.closest('.knowledge-body'),r=t.getBoundingClientRect();
          b.scrollTop+=r.top-b.getBoundingClientRect().top+r.height/2;
        });await settle();
        const position=await table.evaluate(t=>({header:t.tHead.getBoundingClientRect().top,viewport:t.closest('.knowledge-body').getBoundingClientRect().top}));
        assert.ok(Math.abs(position.header-position.viewport)<=2,mode+' header pinned: '+JSON.stringify(position));
        await table.evaluate(t=>t.scrollIntoView({block:'start'}));await settle();
        const reset=await table.locator('thead').evaluate(h=>({
          offset:parseFloat(h.style.translate.split(' ')[1])||0,
          top:h.getBoundingClientRect().top-h.parentElement.getBoundingClientRect().top,
        }));
        assert.ok(Math.abs(reset.offset)<=1&&Math.abs(reset.top)<=1,mode+' header returned to first row');
      }
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'PASS',observations:results.length,evidence,checks:'24 tables, offscreen measured heights, editing, actual file save, undo/redo, repeated refresh, edit/preview headers, light/dark and two window sizes'}));
  }finally{await run.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

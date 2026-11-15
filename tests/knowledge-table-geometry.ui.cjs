const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');

const samples=[
  {name:'有序',source:'<ol start="9"><li>first</li><li>second<ol><li>nested</li></ol></li></ol>',text:['first','second','nested'],elements:['ol','li']},
  {name:'无序',source:'<ul><li>first</li><li>second<ul><li>nested</li></ul></li></ul>',text:['first','second','nested'],elements:['ul','li']},
  {name:'行内',source:'**strong** *emphasis* ~~strike~~ `literal` [link](https://example.com/very-long-destination)',text:['strong','emphasis','strike','literal','link'],elements:['strong','em','s','code','a']},
  {name:'代码',source:'<pre><code class="language-js">const a = 1;&#10;&#10;const b = a;</code></pre>',text:['const a','const b'],elements:['pre','pre code']},
  {name:'换行',source:'first<br>second<br>third',text:['first','second','third'],elements:['br']},
  {name:'图片',source:'![local](sample.png "[loop-image width=48 align=center]")<br>caption',text:['caption'],elements:['img']},
  {name:'单独图片',source:'![local](sample.png "[loop-image width=48 align=center]")',text:[],elements:['img']},
  {name:'组合',source:'**before**<br><ul><li>one</li></ul><br><pre><code>example</code></pre><br>after',text:['before','one','example','after'],elements:['strong','ul','pre']},
];
function capture(cell,{text,elements}){
  const field=cell.querySelector('.kn-table-cell-visual')||cell;
  const rect=({left:x,top:y,width,height})=>[x,y,width,height];
  const cells=[cell,...cell.parentElement.cells];
  const textRects=[];
  for(const string of text){
    const walker=document.createTreeWalker(field,NodeFilter.SHOW_TEXT);
    let node,start=-1;
    while(node=walker.nextNode()){
      start=node.data.indexOf(string);
      if(start!==-1)break;
    }
    if(node){
      const range=new Range();range.setStart(node,start);range.setEnd(node,start+string.length);
      textRects.push([string,rect(range.getBoundingClientRect())]);
    }else {
      // Syntax highlighting can split a code line across several spans.
      const code=field.querySelector('pre code');
      const all=code&&[...code.childNodes];
      if(!all)throw Error('Missing visible text '+string);
      const position=code.textContent.indexOf(string);
      const codeWalker=document.createTreeWalker(code,NodeFilter.SHOW_TEXT);
      let offset=0,head=null,tail=null;
      while(node=codeWalker.nextNode()){
        if(!head&&position>=offset&&position<offset+node.length)head=[node,position-offset];
        if(head&&position+string.length<=offset+node.length){tail=[node,position+string.length-offset];break;}
        offset+=node.length;
      }
      if(!head||!tail)throw Error('Missing code text '+string);
      const range=new Range();range.setStart(...head);range.setEnd(...tail);textRects.push([string,rect(range.getBoundingClientRect())]);
    }
  }
  return {cells:cells.map(el=>rect(el.getBoundingClientRect())),textRects,elements:elements.flatMap(selector=>[...field.querySelectorAll(selector)].filter(el=>!el.matches('.ProseMirror-trailingBreak,.ProseMirror-separator')).map(el=>({selector,box:rect(el.getBoundingClientRect()),align:getComputedStyle(el).textAlign,marker:getComputedStyle(el,'::marker').font,start:el.getAttribute('start')})))};
}
function closeNumbers(a,b,label,ignoreHeight=false){
 for(let i=0;i<a.length;i++){
  if(ignoreHeight&&i===3)continue;
  assert.ok(Math.abs(a[i]-b[i])<=1,`${label}: ${a.join(',')} → ${b.join(',')}`);
 }
}
function compare(a,b,label){
  a.cells.forEach((item,index)=>closeNumbers(item,b.cells[index],label+' cell '+index));
  a.textRects.forEach(([key,item],index)=>closeNumbers(item,b.textRects[index][1],label+' '+key));
  assert.equal(a.elements.length,b.elements.length,label+' element count');
  a.elements.forEach((item,index)=>{
    const next=b.elements[index];
    assert.deepEqual([item.selector,item.align,item.marker,item.start],[next.selector,next.align,next.marker,next.start]);
    if(item.selector!=='br')closeNumbers(item.box,next.box,label+' '+item.selector,item.selector==='pre code');
  });
}

async function main(){
  const review=path.join(process.cwd(),'.local-review');await fs.mkdir(review,{recursive:true});
  const evidence=await fs.mkdtemp(path.join(review,'table-geometry-'));
  const file=path.join(evidence,'Alignment.md');
  await fs.copyFile(path.join(process.cwd(),'app/resources/icon.png'),path.join(evidence,'sample.png'));
  const notes=['# 富文本表格对齐','', '| 变体 | 左 | 中 | 右 |','| --- | :--- | :---: | ---: |',...samples.map(({name,source})=>`| ${name} | ${source} | ${source} | ${source} |`),''].join('\n');
  await fs.writeFile(file,notes);
  const disk=await readKnowledgeDocument(file);
  const run=await launchRepository({activeTaskId:'geometry',taskPane:'notes',tasks:[task('geometry',{title:'表格对齐',notes,knowledgeNote:{...disk,title:'表格对齐',documentState:'SAVED',dirty:false}})]},'table-geometry');
  const {page,app,errors}=run;
  try{
    await page.locator('[data-pane=notes]').click();
    await page.waitForFunction(count=>document.querySelectorAll('.kn-table-widget tbody tr').length===count,samples.length);
    await page.waitForFunction(()=>[...document.querySelectorAll('.kn-table-widget img')].filter(el=>el.complete&&el.naturalWidth).length===6);
    const results=[];
    for(const theme of ['light','dark']){
      await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(...size),theme==='light'?[1280,850]:[1024,768]);
      await page.evaluate(theme=>{state.theme=theme;render();},theme);
      const table=page.locator('.kn-table-widget').first();
      for(const [row,sample] of samples.entries())for(const column of [1,2,3]){
        const cell=table.locator('tbody tr').nth(row).locator('td').nth(column);
        await cell.scrollIntoViewIfNeeded();
        const before=await cell.evaluate(capture,sample);
        await cell.click({position:{x:7,y:8}});
        const field=cell.locator('.kn-table-cell-visual');
        await field.waitFor();
        const focus=await field.evaluate(el=>({
          shadow:getComputedStyle(el).boxShadow,
          outline:getComputedStyle(el).outlineStyle,
          parent:getComputedStyle(el.closest('td')).boxShadow,
        }));
        assert.equal(focus.parent,'none');
        assert.equal(focus.outline,'none');
        const rgb=focus.shadow.match(/rgb\((\d+), (\d+), (\d+)\)/);
        assert.ok(rgb,focus.shadow);
        assert.equal(rgb[1],rgb[2]);assert.equal(rgb[2],rgb[3]);
        const editing=await cell.evaluate(capture,sample);
        compare(before,editing,`${theme} ${sample.name} col${column}`);
        await field.press('Enter');await field.waitFor({state:'detached'});
        compare(before,await cell.evaluate(capture,sample),`${theme} ${sample.name} col${column} after`);
        results.push({theme,sample:sample.name,column,before,editing});
      }
      await page.screenshot({path:path.join(evidence,theme+'.png')});
    }
    const rightList=page.locator('.kn-table-widget tbody tr').first().locator('td').last();
    await rightList.scrollIntoViewIfNeeded();
    const point=await rightList.locator('li').nth(1).evaluate(el=>{
      const range=new Range();range.setStart(el.firstChild,3);range.collapse(true);
      const bounds=range.getBoundingClientRect();return {x:bounds.x,y:bounds.y+bounds.height/2};
    });
    await page.mouse.click(point.x,point.y);
    await page.keyboard.insertText('X');
    assert.equal(await rightList.locator('.kn-table-cell-visual ol > li').nth(1).locator('p').first().innerText(),'secXond');
    await page.keyboard.press('Escape');
    assert.equal(await rightList.locator('ol > li').nth(1).evaluate(el=>el.firstChild.textContent),'second');
    assert.equal(await fs.readFile(file,'utf8'),notes);
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({evidence,cases:results.length}));
  }finally{await run.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

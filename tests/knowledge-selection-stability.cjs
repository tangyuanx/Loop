const assert=require('node:assert/strict');
module.exports=async({page,reset,source,cases,mod,redoKey=process.platform==='darwin'?'Meta+Shift+z':'Control+y'})=>{
 for(const theme of ['light','dark'])for(const format of ['[word]','[word](https://example.com)','**word**','`word`','==word==','[[word]]'])for(const reverse of [false,true]){
  const original='start\n\nplain '+format+' keep [legal]\n\nend',expected='start\n\n keep [legal]\n\nend';
  await reset(original);await page.evaluate(theme=>{state.theme=theme;render();},theme);await page.waitForTimeout(100);
  const target=await page.locator('.cm-line').filter({hasText:'word'}).first().evaluate(line=>{
   const walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);let node;
   while((node=walker.nextNode()))if(node.data.includes('word'))break;
   const range=document.createRange(),at=node.data.indexOf('word');range.setStart(node,at);range.setEnd(node,at+4);const rect=range.getBoundingClientRect();
   window.selectionFrames=[];window.sampleSelection=()=>{if(!line.isConnected)return;const r=range.getBoundingClientRect();selectionFrames.push({left:r.left,top:r.top});window.selectionFrame=requestAnimationFrame(sampleSelection);};sampleSelection();
   return {left:line.getBoundingClientRect().left,right:rect.right,top:rect.top,y:rect.top+rect.height/2,wordLeft:rect.left};
  });
  await page.mouse.move(reverse?target.right+2:target.left+1,target.y);await page.mouse.down();await page.mouse.move(reverse?target.left+1:target.right+2,target.y,{steps:18});await page.mouse.up();
  await page.waitForTimeout(150);
  const frames=await page.evaluate(()=>{cancelAnimationFrame(selectionFrame);return selectionFrames;});
  assert.ok(frames.every(f=>Math.abs(f.left-target.wordLeft)<=1&&Math.abs(f.top-target.top)<=1),JSON.stringify({theme,format,reverse,target,frames}));
  assert.equal(await source(),original,'selection alone never edits source');
  // Background syntax parsing can replace equivalent spans after selection.
  // Observe the visible outcome rather than requiring zero internal mutations.
  const quiet=await page.evaluate(async()=>{
   const e=knowledgeCurrentEntry(),frames=[],mutations=[],initial=e.view.state.selection.main.toJSON(),markdown=e.getMarkdown();
   const observer=new MutationObserver(items=>mutations.push(...items.map(r=>({type:r.type,tag:r.target.nodeName,attribute:r.attributeName}))));observer.observe(e.view.contentDOM,{subtree:true,childList:true,attributes:true,characterData:true});
   // Saving calls refresh asynchronously. Exercise it explicitly while the
   // selection is stationary, so this does not depend on the save timer.
   setTimeout(()=>e.refresh(),100);
   const end=performance.now()+750;
   await new Promise(resolve=>{const sample=()=>{
    const walker=document.createTreeWalker(e.view.contentDOM,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))if(node.data.includes('word'))break;
    let rect=null;if(node){const range=document.createRange(),at=node.data.indexOf('word');range.setStart(node,at);range.setEnd(node,at+4);const r=range.getBoundingClientRect();rect={left:r.left,top:r.top};}
    const backgrounds=[...e.root.querySelectorAll('.cm-selectionBackground')].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {width:r.width,height:r.height,color:s.backgroundColor,opacity:s.opacity};});
    frames.push({rect,selection:e.view.state.selection.main.toJSON(),unchanged:e.getMarkdown()===markdown,backgrounds});
    if(performance.now()<end)requestAnimationFrame(sample);else resolve();};requestAnimationFrame(sample);});observer.disconnect();return {initial,frames,mutations};
  });
  assert.ok(quiet.frames.length>=2&&quiet.frames.every(f=>f.rect&&Math.abs(f.rect.left-target.wordLeft)<=1&&Math.abs(f.rect.top-target.top)<=1&&f.unchanged&&JSON.stringify(f.selection)===JSON.stringify(quiet.initial)&&f.backgrounds.some(b=>b.width>0&&b.height>0&&b.opacity!=='0'&&b.color!=='rgba(0, 0, 0, 0)')),JSON.stringify({theme,format,reverse,quiet}));
  await page.keyboard.press(reverse?'Delete':'Backspace');assert.equal(await source(),expected,JSON.stringify({theme,format,reverse}));
  await page.keyboard.press(mod+'+z');assert.equal(await source(),original);await page.keyboard.press(redoKey);assert.equal(await source(),expected);
  cases.push({label:theme+' '+format+' '+(reverse?'reverse/Delete':'forward/Backspace')+' stable geometry and no residual syntax',quiet});
 }
 // A partial selection must leave the enclosing link and its unselected
 // characters intact. Source mode keeps literal Markdown deletion semantics.
 await reset('before [word](https://example.com) after [legal]');
 await page.evaluate(()=>{const e=knowledgeCurrentEntry(),at=e.getEditorText().indexOf('word');e.view.dispatch({selection:{anchor:at+2,head:at+4}});e.view.focus();});
 await page.keyboard.press('Backspace');assert.equal(await source(),'before [wo](https://example.com) after [legal]');await page.keyboard.press(mod+'+z');
 await page.evaluate(()=>{const e=knowledgeCurrentEntry(),at=e.getEditorText().indexOf('word');e.view.dispatch({selection:{anchor:at,head:at+4}});e.view.focus();});
 await page.keyboard.insertText('new');assert.equal(await source(),'before [new](https://example.com) after [legal]');
 await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.setMode('source');const at=e.getEditorText().indexOf('new');e.view.dispatch({selection:{anchor:at,head:at+3}});e.view.focus();});await page.keyboard.press('Backspace');assert.equal(await source(),'before [](https://example.com) after [legal]');
 cases.push('partial selection, replacement formatting and literal source deletion');
};

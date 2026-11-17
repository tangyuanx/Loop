const assert=require('node:assert/strict');
module.exports=async({page,reset,source,cases,mod})=>{
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
  const quiet=await page.evaluate(async()=>{const e=knowledgeCurrentEntry();let mutations=0;const observer=new MutationObserver(items=>mutations+=items.length);observer.observe(e.view.contentDOM,{subtree:true,childList:true,attributes:true,characterData:true});await new Promise(r=>setTimeout(r,250));observer.disconnect();return mutations;});assert.equal(quiet,0);
  await page.keyboard.press(reverse?'Delete':'Backspace');assert.equal(await source(),expected,JSON.stringify({theme,format,reverse}));
  await page.keyboard.press(mod+'+z');assert.equal(await source(),original);await page.keyboard.press(mod+'+Shift+z');assert.equal(await source(),expected);
  cases.push(theme+' '+format+' '+(reverse?'reverse/Delete':'forward/Backspace')+' stable geometry and no residual syntax');
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

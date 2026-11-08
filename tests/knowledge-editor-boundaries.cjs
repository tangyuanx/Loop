const assert=require('node:assert/strict');
module.exports=async({page,choose,mode,markdown})=>{
 await choose('c');await mode('edit');
 const reset=source=>page.evaluate(source=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.setMode('edit');e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:source},selection:{anchor:0}});},source);
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 console.log('Editor boundaries: stale reading offset, exact code copy and denied clipboard feedback.');
 await reset('长文档'.repeat(100));
 await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({selection:{anchor:280}});e.setMode('preview');e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:'短文'}});});
 await settle();assert.equal(await markdown(),'短文');
 // A mode change before the queued frame must also cancel the old scroll.
 await reset('长文档'.repeat(100));
 await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({selection:{anchor:280}});e.setMode('preview');e.setMode('edit');e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:'正文'}});});
 await settle();assert.equal(await markdown(),'正文');
 await page.evaluate(()=>{window.__boundaryCopyWrite=navigator.clipboard.writeText;window.__boundaryCopy='';navigator.clipboard.writeText=async text=>{window.__boundaryCopy=text;};});
 try{
  for(const code of ['const 值 = `a|b`;\n// 第二行','保留最后一个空行\n','']){
   const source='```text\n'+code+'\n```';await reset(source);await mode('preview');
   await page.locator('.kn-code-copy').first().click();
   await page.waitForFunction(()=>document.querySelector('.kn-code-copy')?.textContent==='已复制');
   assert.equal(await page.evaluate(()=>window.__boundaryCopy),code,'copy omits the fence terminator and preserves explicit blank lines');
   assert.equal(await markdown(),source);
  }
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('QA clipboard permission denied');};});
  await page.locator('.kn-code-copy').first().click();
  await page.waitForFunction(()=>document.querySelector('.kn-code-copy')?.textContent==='复制失败');
 }finally{await page.evaluate(()=>{navigator.clipboard.writeText=window.__boundaryCopyWrite;delete window.__boundaryCopyWrite;delete window.__boundaryCopy;});}
 await mode('edit');
};

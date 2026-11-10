const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');

(async () => {
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#859b91"/></svg>';
  const original='# 图片布局\n\n![图片](task-image:sample "原注释")\n\n正文仍在这里。\n';
  const imageData='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
  const run=await launchRepository({tasks:[task('image',{notes:original})],attachments:{images:{sample:imageData}}},'image-layout');
  const {app,page}=run;
  const image=page.locator('.kn-edit-surface .kn-image-widget img');
  try {
    await page.locator('[data-pane="notes"]').click();await image.waitFor();
    await image.evaluate(el=>el.decode());
    const before=await image.boundingBox();await image.click();
    const handle=page.locator('.kn-image-resize');await handle.waitFor();const rect=await handle.boundingBox();
    await page.mouse.move(rect.x+5,rect.y+5);await page.mouse.down();await page.mouse.move(rect.x-75,rect.y+5,{steps:6});await page.mouse.up();
    await page.waitForFunction(()=>knowledgeCurrentEntry().getMarkdown().includes('[loop-image'));
    const resized=await image.boundingBox();assert.ok(resized.width<before.width-50);assert.ok(Math.abs(resized.width/resized.height-2)<.03);
    await image.click({button:'right'});await page.locator('[data-image-align="right"]').click();
    assert.equal(await image.evaluate(el=>getComputedStyle(el.closest('.kn-image-layout')).textAlign),'right');
    assert.equal(await image.getAttribute('title'),'原注释');
    const markdown=await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
    assert.match(markdown,/align=right/);assert.match(markdown,/正文仍在这里/);
    await image.click();
    const caret=await image.evaluate(async el=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const image=el.getBoundingClientRect(),cursor=el.closest('.cm-editor').querySelector('.cm-cursor').getBoundingClientRect();
      return {imageBottom:image.bottom,cursorTop:cursor.top};
    });
    assert.ok(caret.cursorTop>=caret.imageBottom-35,`aligned images keep the visual caret after the image (${JSON.stringify(caret)})`);
    await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.focus();});await page.keyboard.press('ControlOrMeta+z');
    assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/align=left/);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    const file=path.join(run.profile,'image-note.md');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
    assert.equal((await page.evaluate(()=>saveKnowledgeTask(knowledgeActiveDocument().id))).success,true);
    const saved=await fs.readFile(file,'utf8');
    assert.equal(saved,await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()));
    assert.match(saved,/原注释 \[loop-image width=\d+ align=right\]/);
    await page.evaluate(()=>flushSave());await page.reload();await image.waitFor();
    assert.equal(await image.getAttribute('width'),String(Math.round(resized.width)));
    assert.equal(await image.evaluate(el=>getComputedStyle(el.closest('.kn-image-layout')).textAlign),'right');
    await page.evaluate(()=>knowledgeCurrentEntry().setMode('preview'));
    assert.equal(await page.locator('.kn-reading img').getAttribute('width'),String(Math.round(resized.width)));
    assert.equal(await page.locator('.kn-reading .kn-image-layout').evaluate(el=>getComputedStyle(el).textAlign),'right');
    const exported=await page.evaluate(async()=>{
      const entry=knowledgeCurrentEntry();
      const result=await entry.renderer.exportStatic(entry.getMarkdown(),{noteId:entry.options.noteId});
      const html=document.createElement('div');html.innerHTML=result.html;
      return {width:html.querySelector('img')?.getAttribute('width'),align:html.querySelector('.kn-image-layout')?.style.textAlign,controls:html.querySelectorAll('.kn-image-resize').length};
    });
    assert.deepEqual(exported,{width:String(Math.round(resized.width)),align:'right',controls:0});
    const asset=await page.evaluate(()=>LoopKnowledgeCore.imageReferences(knowledgeCurrentEntry().getMarkdown())[0].url);
    const assetFile=path.resolve(run.profile,decodeURIComponent(asset)),assetBytes=await fs.readFile(assetFile);
    await page.evaluate(()=>knowledgeSetMode('source'));
    assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),saved);
    await page.evaluate(()=>knowledgeSetMode('edit'));await image.waitFor();
    await image.click({button:'right'});assert.equal(await page.locator('[data-image-align="right"]').getAttribute('aria-checked'),'true');
    assert.equal(await page.locator('[data-image-align="right"] svg').isVisible(),true);
    await page.locator('[data-image-align="center"]').click();
    assert.equal((await page.evaluate(()=>saveKnowledgeTask(knowledgeActiveDocument().id))).success,true);
    assert.deepEqual(await fs.readFile(assetFile),assetBytes,'changing layout must not rewrite the original saved image');
    await page.evaluate(()=>knowledgeCurrentEntry().refresh());await image.waitFor();
    assert.equal(await image.evaluate(el=>getComputedStyle(el.closest('.kn-image-layout')).textAlign),'center');
    const external=(await fs.readFile(file,'utf8')).replace('正文仍在这里。','外部编辑保留了布局。');
    await fs.writeFile(file,external);
    await page.evaluate(()=>action({action:'reload-knowledge',taskId:knowledgeActiveDocument().id}));
    await page.waitForFunction(content=>knowledgeCurrentEntry()?.getMarkdown()===content,external);
    await image.waitFor();
    assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),external);
    assert.equal(await image.getAttribute('width'),String(Math.round(resized.width)));
    assert.equal(await image.evaluate(el=>getComputedStyle(el.closest('.kn-image-layout')).textAlign),'center');

    const fixture=async(id,notes)=>{
      await page.evaluate(({id,notes})=>{const note={id,title:id,notes,createdAt:now(),updatedAt:now(),knowledgeNote:knowledgeDocument.createKnowledgeNoteMetadata({taskId:id,title:id})};state.knowledgeDocuments.push(note);knowledgeAttach(note);},{id,notes});
      await page.waitForFunction(id=>knowledgeActiveDocument()?.id===id&&knowledgeCurrentEntry()?.root.isConnected,id);
      await page.waitForFunction(()=>[...document.querySelectorAll('.kn-edit-surface .kn-live-widget img')].every(img=>img.complete&&img.naturalWidth));
    };
    const picture=index=>page.locator('.kn-edit-surface .kn-live-widget img').nth(index||0);
    const align=async(img,value)=>{await img.click({button:'right'});await page.locator(`[data-image-align="${value}"]`).click();};
    const tiny='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="#859b91"/></svg>';
    await page.evaluate(data=>{state.attachments.images.tiny=data;},'data:image/svg+xml;base64,'+Buffer.from(tiny).toString('base64'));
    await fixture('tiny','![小图](task-image:tiny)\n');
    const tinyBefore=await picture().boundingBox();await align(picture(),'center');
    assert.equal(await picture().getAttribute('width'),null,'align-only does not invent a width');
    assert.ok(Math.abs((await picture().boundingBox()).width-tinyBefore.width)<1,'align-only does not enlarge tiny images');
    assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/\[loop-image align=center\]/);

    await fixture('quoted','![特殊](task-image:sample \'注释 "引号" \\目录 &amp;amp;\')\n');
    for(const value of ['right','center','left']){
      await align(picture(),value);assert.equal(await picture().getAttribute('title'),'注释 "引号" \\目录 &amp;');
      assert.equal((await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown())).match(/\[loop-image/g).length,1);
    }
    await picture().click();let handleBox=await page.locator('.kn-image-resize').boundingBox(),sizeBefore=await picture().boundingBox();
    await page.mouse.move(handleBox.x+5,handleBox.y+5);await page.mouse.down();await page.mouse.move(handleBox.x+5,handleBox.y-25,{steps:4});await page.mouse.up();
    assert.ok((await picture().boundingBox()).width<sizeBefore.width-40,'a purely vertical corner drag resizes proportionally');
    const afterVertical=await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
    await picture().click();handleBox=await page.locator('.kn-image-resize').boundingBox();
    await page.mouse.move(handleBox.x+5,handleBox.y+5);await page.mouse.down();await page.mouse.move(handleBox.x+55,handleBox.y+5,{steps:4});
    await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:999})));
    assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),afterVertical,'another pointer cannot commit the drag');
    await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),afterVertical,'cancel restores original display without changing Markdown');
    const quotedFile=path.join(run.profile,'quoted-note.md');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},quotedFile);
    assert.equal((await page.evaluate(()=>saveKnowledgeTask(knowledgeActiveDocument().id))).success,true);
    const quotedSaved=await fs.readFile(quotedFile,'utf8');
    assert.ok(!quotedSaved.includes('task-image:sample'),'an escaped quote in the title must not block attachment migration');
    assert.ok(quotedSaved.includes('width='));

    const references='![一][asset]\n\n![二][asset]\n\n[asset]: task-image:sample "共享注释"\n';
    await fixture('references',references);assert.equal(await picture().count(),1);assert.equal(await page.locator('.kn-image-widget img').count(),2);
    await align(picture(),'right');
    const referenceSource=await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
    assert.ok(referenceSource.includes('![二][asset]'));assert.ok(referenceSource.endsWith('[asset]: task-image:sample "共享注释"\n'));
    assert.match(referenceSource,/!\[一\]\(<task-image:sample> "共享注释 \[loop-image align=right\]"\)/);
    assert.equal(await picture(1).getAttribute('width'),null,'shared reference siblings stay unchanged');

    await fixture('compound','> [!NOTE]\n> ![缺失](task-image:missing)\n>\n> ![第一张](task-image:sample "第一张")\n>\n> ![第二张](task-image:sample "第二张")\n\n| 图片 | 说明 |\n| --- | --- |\n| ![表格图](task-image:sample "表格&#124;图") | 保留单元格 |\n');
    await align(picture(1),'center');
    const compound=await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
    assert.ok(compound.includes('![第一张](task-image:sample "第一张")'));assert.ok(compound.includes('第二张 [loop-image align=center]'));
    const tableImage=page.locator('.kn-table-widget img');await align(tableImage,'right');
    assert.equal(await page.locator('.kn-table-cell-editor').count(),0,'image layout does not open a cell editor');
    assert.ok((await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown())).includes('保留单元格'));
    assert.equal(await tableImage.evaluate(el=>getComputedStyle(el.closest('.kn-image-layout')).textAlign),'right');
    assert.equal(await tableImage.getAttribute('title'),'表格|图');
    await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({changes:{from:e.view.state.doc.length,insert:'\n重新解析后的正文。'},userEvent:'input'});});
    assert.equal(await tableImage.evaluate(el=>getComputedStyle(el.closest('.kn-image-layout')).textAlign),'right');
    for(const theme of ['light','dark']){
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1024,820));
      await page.evaluate(theme=>{state.theme=theme;render();},theme);
      assert.ok(await tableImage.evaluate(el=>el.getBoundingClientRect().width<=document.querySelector('.knowledge-body').clientWidth+1));
    }
    assert.equal(await page.evaluate(()=>state.attachments.images.sample),imageData);
    assert.deepEqual(run.errors,[]);
    console.log('PASS #85 horizontal/vertical proportional drag, cancel/pointer identity, all alignments/tiny image/quoted titles, inline/reference/callout/table targeting, source/reparse, original bytes, undo/redo, disk/reload/read/export and light/dark width bounds');
  } finally {await run.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

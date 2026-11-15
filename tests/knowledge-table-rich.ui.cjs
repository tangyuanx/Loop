const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const { readKnowledgeDocument } = require('../app/main/knowledge-file.cjs');

const initial = [
  '# 富文本表格', '',
  '| 格式 | 内容 | 备注 |', '| :--- | :--- | ---: |',
  '| 文本 | 强调 倾斜 删除 代码 外部链接 | 原有内容 |',
  '| 列表 | 第一项 | 旧格式<br/>换行 |',
  '| 代码 |  | 保留 `\u003cbr>` |',
  '| 图片 |  |  |', '',
  '| 普通表格 | 不改写 |', '| -------- | --- |', '| legacy | **bold** |', '',
].join('\r\n');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=', 'base64');

async function waitForFile(file, predicate) {
  const deadline = Date.now() + 10000;
  do {
    if(predicate(await fs.readFile(file,'utf8')))return;
    await new Promise(resolve=>setTimeout(resolve,100));
  } while(Date.now()<deadline);
  assert.fail('The bound Markdown file did not reach the expected state');
}
function visibleGreen(color) {
  for(const rgb of color.matchAll(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/g)){
    if(rgb[4]==='0')continue;
    if(Number(rgb[2])>Number(rgb[1])+12&&Number(rgb[2])>Number(rgb[3])+8)return true;
  }
  return false;
}
function focusStyles(el) {
  const styles=[];
  for(let node=el;node&&node.closest('.knowledge-pane');node=node.parentElement){
    const css=getComputedStyle(node);
    const outline=css.outlineStyle==='none'||css.outlineWidth==='0px'?'':css.outlineColor;
    const borders=['Top','Right','Bottom','Left'].flatMap(side=>css['border'+side+'Style']!=='none'&&css['border'+side+'Width']!=='0px'?[css['border'+side+'Color']]:[]);
    styles.push({target:String(node.className),outline,borders,shadow:css.boxShadow,background:css.backgroundColor,width:node.clientWidth});
  }
  return styles;
}
function assertNeutralFocus(styles) {
  for(const style of styles){
    for(const color of [style.outline,style.shadow,...style.borders]){
      assert.equal(visibleGreen(color),false,style.target+' '+color);
    }
  }
}

async function main() {
  const review = path.join(process.cwd(), '.local-review');
  await fs.mkdir(review,{recursive:true});
  const evidence = await fs.mkdtemp(path.join(review, 'table-rich-'));
  const file = path.join(evidence, '表格验收.md');
  const image = path.join(evidence, 'fixture.png');
  await fs.writeFile(file, initial);
  await fs.writeFile(image, png);
  const disk = await readKnowledgeDocument(file);
  assert.equal(disk.success, true);
  const run = await launchRepository({ activeTaskId:'rich-table', taskPane:'notes', tasks:[task('rich-table', {
    title:'富文本表格', notes:initial, knowledgeNote:{ ...disk, title:'富文本表格', documentState:'SAVED', dirty:false },
  })] }, 'table-rich');
  const { app, page, profile, errors } = run;
  const identity = await app.evaluate(({ app }) => ({ version:app.getVersion(), appPath:app.getAppPath(), profile:app.getPath('userData'), pid:process.pid }));
  assert.equal(identity.appPath, process.cwd());
  assert.equal(identity.profile, profile);
  const editor = page.locator('.kn-table-cell-editor');
  const firstTable = page.locator('.kn-table-widget').first();
  const cell = (row, col = 1) => firstTable.locator('tbody tr').nth(row).locator('td').nth(col);
  const markdown = () => page.evaluate(() => knowledgeCurrentEntry().getMarkdown());
  const saveFile = () => page.evaluate(() => saveKnowledgeTask(knowledgeActiveDocument().id));
  const source = () => page.evaluate(()=>knowledgeCurrentEntry().activeTableCell.input.value);
  const select = (value, reverse = false) => page.evaluate(({ value, reverse }) => {
    const entry=knowledgeCurrentEntry(),{input}=entry.activeTableCell;
    const at = input.value.indexOf(value);
    if(at < 0)throw new Error('Missing text: ' + value + ' in ' + input.value);
    entry.setTableSelection(at, at + value.length, reverse ? 'backward' : 'forward');
  }, { value, reverse });
  const replaceAll = async value => {
    const raw=await source();
    await select(raw);
    await editor.evaluate((field,value)=>{
      const clipboardData=new DataTransfer();clipboardData.setData('text/plain',value);
      field.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
    },value);
  };
  const openMenu = () => editor.press('Shift+F10');
  const action = name => page.getByRole('menuitem', { name, exact:true });
  const format = async (name, group) => {
    await openMenu();
    if(group)await action(group).click();
    await action(name).click();
    await editor.waitFor();
  };
  const finish = async () => { await editor.press('Enter'); await editor.waitFor({ state:'detached' }); };
  const pass = message => console.log('PASS '+message);
  try {
    await page.locator('[data-pane=notes]').click();
    await page.waitForFunction(() => knowledgeCurrentEntry()?.getEditorText().includes('普通表格'));
    await firstTable.waitFor();
    assert.equal(await markdown(), initial);
    await cell(1,2).click(); await finish();
    await cell(2,2).click(); await finish();
    assert.equal(await markdown(), initial);
    pass('entire untouched note, legacy line endings and literal inline HTML');

    await cell(0).click();
    await select('强调', true);
    await format('加粗');
    assert.deepEqual(await page.evaluate(()=>{const el=knowledgeCurrentEntry().activeTableCell.input;return [el.value.slice(el.selectionStart,el.selectionEnd),el.selectionDirection];}), ['强调','backward']);
    await format('加粗'); assert.doesNotMatch(await source(), /\*\*强调\*\*/);
    await format('加粗');
    for(const [label, command] of [['倾斜','倾斜'],['删除','删除线'],['代码','行内代码']]){
      await select(label); await format(command);
    }
    await select('外部链接'); await openMenu(); await action('添加链接…').click();
    await page.locator('#wb-link').fill('https://example.com/loop-cell');
    await page.locator('#wb-link-insert').click();
    await select('外部链接'); await format('移除链接');
    await select('外部链接'); await openMenu(); await action('添加链接…').click();
    await page.locator('#wb-link').fill('https://example.com/loop-cell');
    await page.locator('#wb-link-insert').click();
    await page.evaluate(()=>{globalThis.richOpened = [];knowledgeCurrentEntry().options.onExternalLink = url => richOpened.push(url);});
    await select('部'); await editor.press('Control+Enter');
    assert.deepEqual(await page.evaluate(()=>richOpened), ['https://example.com/loop-cell']);
    await finish();
    for(const [tag, value] of [['strong','强调'],['em','倾斜'],['s','删除'],['code','代码'],['a','外部链接']]){
      assert.equal(await cell(0).locator(tag).innerText(), value);
    }
    pass('cell selection, right-click commands, mark toggling, link add/remove/open');

    await cell(1).click();
    await editor.press('End'); await format('无序列表','段落设置');
    await editor.press('End'); await editor.press('Shift+Enter'); await editor.pressSequentially('nested item');
    assert.equal(await source(), '- 第一项\n- nested item');
    await format('增加列表缩进','段落设置');
    assert.match(await source(), /\n  - nested item$/);
    await format('减少列表缩进','段落设置');
    assert.match(await source(), /\n- nested item$/);
    await format('增加列表缩进','段落设置');
    await editor.press('End'); await editor.press('Shift+Enter'); await editor.press('Shift+Enter');
    await editor.pressSequentially('third');
    await finish();
    assert.equal(await cell(1).locator('ul ul li').innerText(), 'nested item');
    assert.match(await cell(1).locator('ul > li').last().innerText(), /third/);
    await cell(1,2).click();
    await replaceAll('one\ntwo'); await select('one\ntwo'); await format('有序列表','段落设置');
    await select('two'); await format('增加列表缩进','段落设置');
    assert.match(await markdown(), /<ol><li>one<ol start="2"><li>two<\/li><\/ol><\/li><\/ol>/);
    await format('减少列表缩进','段落设置');
    await finish();
    assert.deepEqual(await cell(1,2).locator('ol li').allTextContents(), ['one','two']);
    pass('list creation, same-level continuation, indentation, empty item exit, numbered list');

    await cell(2).click();
    const code = 'const r = a | b;\n\nconst text = "![fake](missing.png) <tag> &lt;";';
    await editor.fill(code); await editor.selectText(); await format('代码块','插入');
    await editor.press('Shift+Enter'); await editor.pressSequentially('line');
    await finish();
    const expectedCode = '\nline'+code;
    assert.equal(await cell(2).locator('pre code').textContent(), expectedCode);
    await cell(2).click();
    const beforeCancel = await markdown();
    await select('lineconst');await page.keyboard.insertText('取消这次修改');
    await waitForFile(file,text=>text.includes('取消这次修改'));
    await editor.press('Escape'); await editor.waitFor({ state:'detached' });
    assert.equal(await markdown(), beforeCancel);
    await waitForFile(file,text=>text===beforeCancel);
    await cell(2).click();
    await select('lineconst');await page.keyboard.insertText('重做测试'); await editor.press('ControlOrMeta+z');
    assert.match(await source(), /lineconst[\s\S]*missing\.png/);
    await editor.press('ControlOrMeta+Shift+z');
    assert.match(await source(), /重做测试/);
    await editor.press('Escape'); await editor.waitFor({ state:'detached' });
    assert.equal(await markdown(), beforeCancel);
    pass('multiline code, literal pipes/entities, document undo/redo, Escape restores source');

    await cell(3).click();
    await openMenu(); await action('插入').click();
    const chooserPromise = page.waitForEvent('filechooser');
    await action('图片…').click();
    const chooser = await chooserPromise;
    await chooser.setFiles(image);
    await page.waitForFunction(() => /!\[fixture.png\]\(task-image:/.test(knowledgeCurrentEntry().getMarkdown()));
    await editor.press('End'); await editor.press('Shift+Enter');
    await editor.evaluate((input, bytes) => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File([Uint8Array.from(bytes)], 'pasted.png', { type:'image/png' }));
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles:true, cancelable:true, clipboardData }));
    }, [...png]);
    await page.waitForFunction(() => /!\[pasted.png\]\(task-image:/.test(knowledgeCurrentEntry().getMarkdown()));
    await finish();
    await cell(3).locator('img').last().waitFor();
    assert.equal(await cell(3).locator('img').count(), 2);
    assert.equal((await saveFile()).success, true);
    const saved = await fs.readFile(file, 'utf8');
    assert.match(saved, /!\[fixture\.png\]\(\.\/attachments\//);
    assert.match(saved, /!\[pasted\.png\]\(\.\/attachments\//);
    assert.doesNotMatch(saved, /task-image:/);
    assert.ok(saved.includes(initial.slice(initial.indexOf('| 普通表格'))));
    assert.equal(saved.replace(/\r\n/g,'').includes('\n'), false);
    pass('real file picker and pasted image, attachment migration, CRLF and untouched table');

    await page.reload();
    await page.waitForFunction(() => knowledgeCurrentEntry()?.getEditorText().includes('<ul>'));
    await firstTable.waitFor();
    assert.equal(await markdown(), saved);
    assert.equal(await cell(2).locator('pre code').textContent(), expectedCode);
    assert.equal(await cell(3).locator('img').count(), 2);
    await cell(3).locator('img').first().click({button:'right'});
    await action('从单元格移除图片').click();
    assert.equal(await cell(3).locator('img').count(), 1);
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await cell(3).locator('img').count(), 2);
    assert.equal((await saveFile()).success, true);
    await page.evaluate(() => knowledgeSetMode('source'));
    assert.equal(await markdown(), saved);
    await page.evaluate(() => knowledgeSetMode('preview'));
    assert.equal(await page.locator('.kn-reading table pre code').textContent(), expectedCode);
    await page.locator('.knowledge-pane [data-wb-action=more]').click();
    await page.locator('[data-action=export-knowledge-note]').click();
    const preview=page.locator('#knowledge-export-preview');
    await preview.locator('pre code').waitFor();
    assert.equal(await preview.locator('pre code').textContent(),expectedCode);
    assert.equal(await preview.locator('img[src^="data:image/"]').count(),2);
    assert.equal(await preview.locator('ul ul li').innerText(),'nested item');
    await page.getByRole('dialog',{name:'导出笔记'}).getByRole('button',{name:'取消'}).click();
    assert.equal(await markdown(),saved);
    assert.deepEqual(await page.evaluate(()=>{
      const references=LoopShareMarkdown.scan(knowledgeCurrentEntry().getMarkdown());
      return references.filter(ref=>ref.destination.includes('/attachments/')).map(ref=>ref.image);
    }),[true,true]);
    await page.evaluate(() => knowledgeSetMode('edit'));
    for(const theme of ['light','dark']){
      await app.evaluate(({BrowserWindow},size)=>{
        BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(...size);
      },theme==='light'?[1280,850]:[1024,768]);
      await page.evaluate(theme=>{state.theme=theme;render();},theme);
      await cell(0,2).click({position:{x:15,y:14}});
      const styles = await editor.evaluate(focusStyles);
      assertNeutralFocus(styles);
      const focus = styles[0];
      assert.notEqual(focus.shadow,'none');
      assert.equal(focus.background,'rgba(0, 0, 0, 0)');
      assert.ok(focus.width >= 80);
      await finish();
      const exited=await firstTable.evaluate(focusStyles);
      assertNeutralFocus(exited);
      assert.match(exited[0].outline,/^rgb/);
      await page.screenshot({ path:path.join(evidence,theme+'.png') });
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({ identity, file, checks:'passed' },null,2));
    pass('reload and source/reading, remove and restore images, export and real resource scanning, light/dark focus');
    console.log(JSON.stringify({ evidence, identity, file }));
  } finally { await run.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

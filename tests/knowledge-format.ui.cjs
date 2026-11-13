const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');
const { readKnowledgeDocument } = require('../app/main/knowledge-file.cjs');
const { readTaskData, writeTaskData } = require('../app/main/storage.cjs');
const wb = require('./workbench-helpers.cjs');

const root = path.resolve(__dirname, '..');
const initial = [
  '---', 'title: YAML中文', '---', '', '## 9、 总结API', '', '##### 7.1 检查Node', '',
  '第二章API', '---------', '', '普通API  文本ABC123，中文2  全角Ａ。',
  '有意换行  ', '    下一行React', '', '-   列表Node  项', '',
  '`函数Node  空格` [链接Node](./文件Node.md#标题ABC) [[笔记API#标题ABC|显示ABC]]',
  'C:\\项目Node\\文件ABC.md ./中文API/文件A www.example.com/中文API 中文Vue',
  '', '$$', '中文API  x', '', '中文Vue  y', '$$', '',
  '> 引用Node  内容', '', '使用**API**验证，React*中文*，结果$中文API$。', '', '| 中文API | 路径 |', '| --- | --- |', '| 中文Vue  字段 | `中文ABC` |', '',
  '```text', '# 不编号API  保留', '```', '', '    缩进代码API  保留', '',
  '# 12 重名ABC', '', '# 22 重名ABC', '', '# 2026 年度计划', '',
].join('\r\n');
const spacing = initial
  .replace('总结API', '总结 API').replace('检查Node', '检查 Node').replace('第二章API', '第二章 API')
  .replace('普通API  文本ABC123', '普通 API  文本 ABC123').replace('全角Ａ','全角 Ａ')
  .replace('下一行React','下一行 React').replace('列表Node', '列表 Node').replace('中文Vue\r\n\r\n$$',()=> '中文 Vue\r\n\r\n$$')
  .replace('引用Node','引用 Node').replace('| 中文API','| 中文 API').replace('| 中文Vue','| 中文 Vue')
  .replace('使用**API**验证，React*中文*','使用 **API** 验证，React *中文*');
const full = spacing
  .replace('## 9、','## 1').replace('##### 7.1','##### 1.1').replace('第二章 API','2 第二章 API')
  .replace('API  文本','API 文本').replace('中文2  全角','中文2 全角').replace('Node  项','Node 项')
  .replace('Node  内容','Node 内容').replace('Vue  字段','Vue 字段').replace('# 2026 年度计划','# 3 2026 年度计划');

async function run() {
  const runDir = path.resolve(process.env.LOOP_FORMAT_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'loop-format-')));
  const profile = path.join(runDir, 'profile');
  await fs.mkdir(runDir, { recursive: true });
  await fs.access(path.join(profile, 'task-data.json')).then(() => { throw Error('Refusing existing profile'); }, () => {});
  const file = path.join(runDir, 'formatted.md');
  await fs.writeFile(file, initial, { flag: 'wx' });
  const disk = await readKnowledgeDocument(file);
  const stamp = new Date().toISOString();
  await writeTaskData(profile, { version: 2, taskFilter: 'all', activeTaskId: 'format', tasks: [
    { id: 'format', title: '文档格式化验收', notes: initial, nodes: [], createdAt: stamp, updatedAt: stamp,
      knowledgeNote: { ...disk, filePath: file, noteId: 'format-note', title: '文档格式化验收', documentState: 'SAVED', dirty: false } },
    { id: 'input', title: '输入与右键格式验收', notes: '# 正文\n\n混合文字\n\n中文内容\n\n| 列 |\n| --- |\n| 表格 |\n',
      nodes: [], createdAt: stamp, updatedAt: stamp, knowledgeNote: { noteId: 'input-note', title: '输入与右键格式验收' } },
  ] });
  const env = { ...process.env, LOOP_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
  let page;
  try {
    for(let attempt=0;attempt<150&&!page;attempt++){
      page=app.windows().find(candidate=>candidate.url().endsWith('/app/renderer/index.html'));
      if(!page)await new Promise(resolve=>setTimeout(resolve,80));
    }
    assert.ok(page,'main Loop window');
    const runtime = await app.evaluate(({ app }) => ({ path: app.getAppPath(), profile: app.getPath('userData'), pid: process.pid }));
    assert.equal(runtime.path, root);
    assert.equal(runtime.profile, profile);
    await fs.writeFile(path.join(runDir,'runtime.json'), JSON.stringify(runtime, null, 2));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(8500);
    const open = async id => {
      await page.locator(`[data-task-row="${id}"] .task-select`).click();
      await page.locator('[data-pane=notes]').click();
      await page.waitForFunction(id => knowledgeCurrentEntry()?.options.noteId === id + '-note', id);
    };
    const markdown = () => page.evaluate(() => knowledgeCurrentEntry().getMarkdown());
    const select = (text, atEnd = false) => page.evaluate(({text,atEnd}) => {
      const e = knowledgeCurrentEntry();
      const at = e.getEditorText().indexOf(text);
      if(at < 0) throw Error('Cannot select ' + text);
      e.view.dispatch({selection:{anchor:atEnd?at+text.length:at,head:at+text.length},scrollIntoView:true});
      e.view.focus();
    }, {text,atEnd});
    const openFormat = async rules => {
      await wb.more(page);
      await page.locator('[data-wb-action=format-document]').click();
      assert.equal(await page.locator('#overlay .dialog-backdrop').count(),0);
      assert.equal(await page.locator('#wb-apply-format').isDisabled(), true);
      for (const rule of rules) await page.locator(`.wb-document-rules [name="${rule}"]`).check();
    };
    const apply = () => page.locator('#wb-apply-format').click();
    const undo = () => page.keyboard.press('ControlOrMeta+z');
    const redo = () => page.keyboard.press('ControlOrMeta+Shift+z');

    await open('format');
    await wb.mode(page,'source');
    await openFormat(['spacing']);
    await apply();
    assert.equal(await markdown(), spacing);
    await undo();
    assert.equal(await markdown(), initial);

    await openFormat(['spacing','spaces','headings']);
    await apply();
    assert.equal(await markdown(), full);
    assert.equal(await page.evaluate(() => {
      const e=knowledgeCurrentEntry(), text=e.getEditorText();
      const off=LoopKnowledgeCore.anchorOffset(text, '9、 总结API');
      return text.slice(off).startsWith('## 1 总结 API') &&
        LoopKnowledgeCore.fragment(text,'7.1 检查Node').startsWith('##### 1.1 检查 Node') &&
        LoopKnowledgeCore.anchorOffset(text,'重名ABC')===null &&
        text.slice(LoopKnowledgeCore.anchorOffset(text,'22 重名ABC')).startsWith('# 22');
    }), true);
    await openFormat(['spacing','spaces','headings']);
    await apply();
    assert.equal(await markdown(), full);
    await undo();
    assert.equal(await markdown(), initial, 'the no-op did not add an undo step');
    await redo();
    assert.equal(await markdown(), full);
    await page.evaluate(() => saveKnowledgeTask('format'));
    assert.equal(await fs.readFile(file,'utf8'),full);
    await page.reload();
    await open('format');
    assert.equal(await markdown(), full);

    // A real formatted draft cannot overwrite newer external bytes.
    await wb.mode(page,'source');
    await select('普通 API',true);
    await page.keyboard.insertText('新增React');
    await openFormat(['spacing']);
    await apply();
    assert.match(await markdown(), /新增 React/);
    const external=full+'外部写入。\r\n';
    await fs.writeFile(file,external);
    await page.evaluate(() => saveKnowledgeTask('format'));
    assert.equal(await fs.readFile(file,'utf8'),external);
    assert.match(await markdown(), /新增 React/);

    await open('input');
    await wb.mode(page,'source');
    await wb.more(page);
    await page.locator('[data-action=open-knowledge-settings]').click();
    const toggle=page.getByRole('switch',{name:'中英文自动加空格'});
    assert.equal(await toggle.getAttribute('aria-checked'),'false');
    await toggle.click();
    await page.waitForFunction(() => state.uiPreferences.knowledgeAutoSpacing);
    await page.evaluate(() => flushSave());
    assert.equal((await readTaskData(profile)).uiPreferences.knowledgeAutoSpacing,true);
    await page.reload();
    await open('input');
    await select('混合文字',true);
    await page.keyboard.insertText('Vue');
    assert.match(await markdown(), /混合文字 Vue/);
    await undo();
    assert.doesNotMatch(await markdown(), /Vue/);
    await select('混合文字',true);
    await page.keyboard.insertText('2，Vue');
    assert.match(await markdown(), /混合文字2，Vue/);
    await select('中文内容',true);
    await page.keyboard.insertText('React');
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition',{text:'zhong',selectionStart:5,selectionEnd:5});
    await cdp.send('Input.insertText',{text:'中文'});
    await page.waitForFunction(()=>knowledgeCurrentEntry().getEditorText().includes('中文内容 React 中文'));
    await undo();
    assert.doesNotMatch(await markdown(), /React 中文/);
    await redo();
    assert.match(await markdown(), /React 中文/);

    await select('混合文字');
    await page.keyboard.press('Shift+F10');
    for(const format of ['bold','italic','strike','inline']){
      await page.locator(`.wb-context-menu [data-wb-format="${format}"]`).click();
      assert.equal(await page.evaluate(()=>{const e=knowledgeCurrentEntry();return e.view.state.sliceDoc(e.view.state.selection.main.from,e.view.state.selection.main.to)}),'混合文字');
      await page.keyboard.press('Shift+F10');
      await page.locator(`.wb-context-menu [data-wb-format="${format}"]`).click();
      assert.match(await markdown(), /^混合文字2，Vue/m);
      await page.keyboard.press('Shift+F10');
    }
    await page.locator('.wb-context-menu [data-wb-action=link]').click();
    await page.locator('#wb-link').fill('https://example.com/notes');
    await page.locator('#wb-link-insert').click();
    assert.match(await markdown(), /\[混合文字\]\(https:\/\/example\.com\/notes\)/);
    await page.keyboard.press('Shift+F10');
    await page.locator('.wb-context-menu [data-wb-format=unlink]').click();
    assert.doesNotMatch(await markdown(), /https:\/\/example\.com/);
    await undo();
    assert.match(await markdown(), /https:\/\/example\.com/);
    await redo();
    assert.doesNotMatch(await markdown(), /https:\/\/example\.com/);

    await page.evaluate(()=>{
      const e=knowledgeCurrentEntry(),doc=e.getEditorText(),from=doc.indexOf('混合文字'),to=doc.indexOf('中文内容')+'中文内容'.length;
      e.view.dispatch({selection:{anchor:to,head:from}});e.view.focus();
    });
    await page.keyboard.press('Shift+F10');
    assert.equal(await page.locator('.wb-context-menu [data-wb-format=inline]').count(),0);
    assert.equal(await page.locator('.wb-context-menu [data-wb-action=link]').count(),0);
    await page.locator('.wb-context-menu [data-wb-format=bold]').click();
    assert.match(await markdown(), /\*\*混合文字2，Vue\*\*\n\n\*\*中文内容\*\*/);
    assert.equal(await page.evaluate(()=>{const r=knowledgeCurrentEntry().view.state.selection.main;return r.anchor>r.head;}),true);
    await undo();

    await wb.mode(page,'edit');
    await page.locator('.kn-table-widget td').click();
    const cell=page.locator('.kn-table-cell-editor');
    await cell.press('End');
    await page.keyboard.insertText('React');
    assert.equal(await cell.inputValue(),'表格 React');
    await cell.press('Escape');

    for(const theme of ['light','dark']){
      await page.evaluate(theme=>{state.theme=theme;render();},theme);
      await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(width,720),theme==='light'?1280:1024);
      await openFormat(['headings']);
      const panel=page.getByRole('form',{name:'格式化文档'});
      const more=page.locator('.knowledge-note-actions [data-wb-action=more]');
      const anchor=await more.boundingBox(),bounds=await panel.boundingBox();
      assert.ok(bounds.height<156 && Math.abs(anchor.x+anchor.width-bounds.x-bounds.width)<4);
      assert.ok(bounds.y>=anchor.y+anchor.height);
      const choice=page.locator('.wb-document-rules input').last();
      await page.keyboard.press('Tab');
      await choice.focus();
      const styles=await choice.evaluate(el=>{const c=getComputedStyle(el),r=el.getBoundingClientRect();return {outline:c.outlineStyle,color:c.outlineColor,width:r.width,height:r.height};});
      assert.equal(styles.outline,'solid');
      assert.match(styles.color,/^rgb\((\d+), \1, \1\)$/);
      assert.deepEqual([styles.width,styles.height],[15,15]);
      if(process.env.LOOP_FORMAT_QA_DIR)await page.screenshot({path:path.join(runDir,theme+'-format.png')});
      await page.keyboard.press('Escape');
      await panel.waitFor({state:'detached'});
      assert.equal(await more.getAttribute('aria-expanded'),'false');
      assert.equal(await more.evaluate(el=>document.activeElement===el),true);
      await openFormat([]);
      await page.locator('#search').click();
      await panel.waitFor({state:'detached'});
      assert.equal(await page.locator('#search').evaluate(el=>document.activeElement===el),true);
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: format options, Markdown protection, heading anchors, undo/redo, save/reopen, external conflict, persistent setting, IME, cell typing, selection menu and themes.');
  } catch (error) {
    if(page)await page.screenshot({path:path.join(runDir,'failure.png')}).catch(()=>{});
    throw error;
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

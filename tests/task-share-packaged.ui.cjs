const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');
const { writeTaskData, readTaskData } = require('../app/main/storage.cjs');
const { readTaskPackage } = require('../app/main/task-share-format.cjs');

const root = path.resolve(__dirname, '..');
const stamp = '2026-11-14T01:15:00.000Z';
const deadline = '2026-12-31T23:45:00.000Z';
const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const document = Buffer.from('Loop #103 UTF-8 文档附件字节。\n');
const taskTitle = '跨平台分享 · 同名任务';
const senderTaskId = 'sender-task';
const recipientTaskId = 'receiver-existing-task';
const notes = [
  { id: 'sender-document-a', title: '同名笔记', content: '# 同名笔记\r\n\r\n## 目标节\r\n\r\n目标正文 A。\r\n' },
  { id: 'sender-document-b', title: '同名笔记', content: '# 同名笔记\r\n\r\n保留正文 B。\r\n' },
];
const sourceMarkdown = '# 接收后另存\r\n\r\n![图片](<附件/样 本.png> "[loop-image width=42 align=center]")\r\n' +
  '[下载正文](<附件/文 本.txt>)\r\n\r\n[[note:sender-document-a#目标节|目标笔记]]\r\n\r\n' +
  '[[note:excluded-document|排除链接]]\r\n\r\n' +
  '| 对齐 | 保真 |\r\n| --- | --- |\r\n| 甲 | 乙 |\r\n';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeTask(id, title, fields = {}) {
  return { id, title, createdAt: stamp, updatedAt: stamp, nodes: [], ...fields };
}

function makeNote(item, filePath = '') {
  return { id: item.id, title: item.title, creatorTaskId: senderTaskId, notes: item.content, createdAt: stamp, updatedAt: stamp,
    knowledgeNote: { noteId: item.id, title: item.title, documentState: filePath ? 'SAVED' : 'DRAFT', filePath, lastSavedHash: filePath ? digest(Buffer.from(item.content)) : null } };
}

function assertSuccess(result) {
  assert.equal(result?.success, true, JSON.stringify(result));
  return result;
}

async function launch(profile) {
  const executable = process.env.LOOP_APP_EXECUTABLE;
  const env = { ...process.env, LOOP_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: executable || require('electron'), args: executable ? [] : [root], cwd: root, env });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForURL(/\/app\/renderer\/index\.html$/);
    await page.locator('.app').waitFor();
    const runtime = await app.evaluate(({ app }) => ({ appPath: app.getAppPath(), profile: app.getPath('userData'), version: app.getVersion() }));
    assert.equal(path.resolve(runtime.profile), path.resolve(profile));
    if (executable) assert.match(runtime.appPath, /app\.asar$/);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    return { app, page, runtime, errors };
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function saveDialog(app, output) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => filePath ? { canceled: false, filePath } : { canceled: true };
  }, output);
}

async function openDialog(app, input) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => file ? { canceled: false, filePaths: [file] } : { canceled: true, filePaths: [] };
  }, input);
}

async function exportedPack(run, output) {
  const sourceDirectory = path.join(run, '发送者');
  const sourcePath = path.join(sourceDirectory, '源笔记.md');
  const profile = path.join(run, 'sender-profile');
  await fs.mkdir(path.join(sourceDirectory, '附件'), { recursive: true });
  await fs.writeFile(sourcePath, sourceMarkdown);
  await fs.writeFile(path.join(sourceDirectory, '附件', '样 本.png'), picture);
  await fs.writeFile(path.join(sourceDirectory, '附件', '文 本.txt'), document);
  const primary = makeNote({ id: senderTaskId, title: '接收后另存', content: sourceMarkdown }, sourcePath);
  const omitted = { ...makeNote({ id: 'excluded-document', title: 'Excluded secret title', content: 'Excluded secret content' }), creatorTaskId: '' };
  const node = { id: 'sender-node', title: '完成节点', status: 'done', hypothesis: '进展', conclusion: '结论\n保留长行', note: '节点记录', updatedAt: stamp,
    children: [{ id: 'sender-child', title: '子节点', status: 'review', note: '子记录', hypothesis: '', conclusion: '子结论', updatedAt: stamp, children: [], downstreamNodeIds: [] }], downstreamNodeIds: [] };
  const sender = makeTask(senderTaskId, taskTitle, { description: '背景', hypothesis: '任务进展', conclusion: '任务结论',
    deadlineAt: deadline, deadlineReminderMinutes: 60, recurrence: { frequency: 'daily' }, nodes: [node],
    notes: sourceMarkdown, knowledgeNote: primary.knowledgeNote, knowledgeLinks: notes.map(note => note.id) });
  await writeTaskData(profile, { tasks: [sender], knowledgeDocuments: [...notes.map(item => makeNote(item)), omitted] });
  const { app, page, runtime, errors } = await launch(profile);
  try {
    await page.waitForFunction(id => state.tasks.some(task => task.id === id), senderTaskId);
    await saveDialog(app, output);
    await page.locator(`.task-select[data-task-id="${senderTaskId}"]`).click();
    await page.locator(`.task-share-action[data-task-id="${senderTaskId}"]`).click();
    assert.equal(await page.locator('.task-share-source h3').textContent(), taskTitle);
    assert.equal(await page.locator('#task-share-format').inputValue(), 'md');
    assert.equal(await page.locator('#task-share-scope').isVisible(), false);
    const summary = page.locator('#task-share-summary');
    await summary.getByText(/个节点|预览未完成/).waitFor();
    assert.match(await summary.textContent(), /2 个节点（含记录）.*3 篇笔记.*2 个附件/,
      await page.locator('[data-task-share-dialog]').innerText());
    await page.locator('#task-share-format').selectOption('pack');
    await page.locator('#task-share-export').click();
    await page.locator('#task-share-receipt').getByText(path.basename(output), { exact: false }).waitFor();
    const unpack = path.join(run, 'export-verification');
    await fs.mkdir(unpack);
    const verified = await readTaskPackage(output, unpack);
    assert.equal(verified.pack.task.title, taskTitle);
    assert.deepEqual([...verified.assets.values()].map(asset => asset.sha256).sort(), [digest(picture), digest(document)].sort());
    assert.doesNotMatch(JSON.stringify(verified.pack), /Excluded secret|sender-document-a|sender-node|源笔记\.md|附件\/样 本/);
    assert.match(verified.pack.notes[0].content, /\[loop-image width=42 align=center\]/);
    assert.deepEqual(errors, []);
    return { ...runtime, packageSha256: digest(await fs.readFile(output)), bytes: (await fs.stat(output)).size };
  } finally { await app.close(); }
}

async function importedPack(run, input) {
  const profile = path.join(run, 'receiver-profile');
  const files = path.join(run, '接收者');
  await fs.mkdir(files);
  const existing = makeTask(recipientTaskId, taskTitle, { description: '接收端原有任务', notes: '原有草稿' });
  await writeTaskData(profile, { tasks: [existing] });
  let runtime;
  let importedId;
  let receiver = await launch(profile);
  try {
    const { app, page, errors } = receiver;
    runtime = receiver.runtime;
    await page.waitForFunction(id => state.tasks.some(task => task.id === id), recipientTaskId);
    await openDialog(app, input);
    const preview = assertSuccess(await page.evaluate(() => window.personalTaskTrack.taskShare.inspect()));
    assert.equal(preview.title, taskTitle);
    assert.equal(preview.records, true);
    assert.equal(preview.nodeCount, 2);
    assert.equal(preview.notes.length, 3);
    assert.equal(preview.files.length, 2);
    assert.equal(preview.deadlineAt, deadline);
    assert.equal((await readTaskData(profile)).tasks.length, 1);
    const revision = await page.evaluate(async () => (await window.personalTaskTrack.storage.read()).shareRevision);
    const payload = { token: preview.token, title: taskTitle, groupId: '', revision };
    const receipt = assertSuccess(await page.evaluate(payload => window.personalTaskTrack.taskShare.commit(payload), payload));
    importedId = receipt.task.id;
    const replay = assertSuccess(await page.evaluate(payload => window.personalTaskTrack.taskShare.commit(payload), payload));
    assert.equal(replay.task.id, importedId);
    const saved = await readTaskData(profile);
    assert.equal(saved.tasks.length, 2);
    assert.equal(saved.tasks.find(task => task.id === recipientTaskId).description, existing.description);
    const task = saved.tasks.find(task => task.id === importedId);
    assert.notEqual(task.id, senderTaskId);
    assert.equal(task.deadlineAt, deadline);
    assert.equal(task.deadlineReminderMinutes, null);
    assert.equal(task.recurrence.frequency, 'none');
    assert.equal(task.nodes[0].status, 'done');
    assert.equal(task.nodes[0].children[0].status, 'review');
    assert.equal(task.nodes[0].children[0].parentId, task.nodes[0].id);
    assert.equal(task.nodes[0].conclusion, '结论\n保留长行');
    assert.equal(task.nodes[0].note, '节点记录');
    assert.equal(task.knowledgeNote.documentState, 'DRAFT');
    assert.ok(!task.knowledgeNote.filePath);
    const target = saved.knowledgeDocuments.find(note => note.notes.includes('目标正文 A'));
    const sameTitle = saved.knowledgeDocuments.find(note => note.notes.includes('保留正文 B'));
    assert.equal(target.title, sameTitle.title);
    assert.notEqual(target.id, sameTitle.id);
    assert.match(task.notes, new RegExp(`\\[\\[note:${target.knowledgeNote.noteId}#目标节\\|目标笔记\\]\\]`));
    await page.reload();
    await page.waitForFunction(id => state.tasks.some(task => task.id === id), importedId);
    await openDialog(app, input);
    await page.getByRole('button', { name: '导入任务包', exact: true }).click();
    await page.locator('#task-share-import-status').getByText(/完整任务/).waitFor();
    assert.match(await page.locator('#task-share-import-details').innerText(), /提醒关闭/);
    await page.locator('#task-share-import-title').fill('再次导入 · 独立副本');
    await page.getByRole('button', { name: '导入为新任务' }).click();
    await page.locator('#task-share-import-status').getByText(/已导入/).waitFor();
    await page.getByRole('button', { name: '打开任务' }).click();
    const duplicate = (await readTaskData(profile)).tasks.find(item => item.title === '再次导入 · 独立副本');
    assert.ok(duplicate && duplicate.id !== importedId);
    assert.deepEqual(errors, []);
  } finally { await receiver.app.close(); }
  receiver = await launch(profile);
  try {
    const { app, page, errors } = receiver;
    await page.waitForFunction(id => state.tasks.some(task => task.id === id), importedId);
    await page.evaluate(id => knowledgeOpen(state.tasks.find(task => task.id === id)), importedId);
    const waitForImage = () => page.waitForFunction(() => [...document.querySelectorAll('.knowledge-pane img')].some(image => image.naturalWidth > 0));
    await waitForImage();
    await saveDialog(app, null);
    const canceled = await page.evaluate(id => saveKnowledgeTask(id), importedId);
    assert.equal(canceled.canceled, true, JSON.stringify(canceled));
    const stillDraft = (await readTaskData(profile)).tasks.find(task => task.id === importedId);
    assert.ok(!stillDraft.knowledgeNote.filePath);
    const destination = path.join(files, '首次另存 · 成品.md');
    await saveDialog(app, destination);
    assertSuccess(await page.evaluate(id => saveKnowledgeTask(id), importedId));
    await waitForImage();
    const markdown = await fs.readFile(destination, 'utf8');
    assert.match(markdown, /\[loop-image width=42 align=center\]/);
    assert.doesNotMatch(markdown, /loop-asset:/);
    assert.match(markdown, /\| 甲 \| 乙 \|\r\n/);
    const attachments = await fs.readdir(path.join(files, 'attachments'));
    assert.equal(attachments.length, 2);
    const bytes = await Promise.all(attachments.map(file => fs.readFile(path.join(files, 'attachments', file))));
    assert.deepEqual(bytes.map(digest).sort(), [digest(picture), digest(document)].sort());
    assert.deepEqual(errors, []);
    return { ...runtime, packageSha256: digest(await fs.readFile(input)), importedId, attachments, destination };
  } finally { await receiver.app.close(); }
}

async function main() {
  const [mode = 'roundtrip', explicit] = process.argv.slice(2);
  assert.ok(['produce', 'consume', 'roundtrip'].includes(mode), 'Expected produce, consume, or roundtrip');
  const run = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-task-package-'));
  const file = explicit ? path.resolve(explicit) : path.join(run, '跨平台样本.looptask');
  const evidence = process.env.LOOP_TASK_SHARE_QA_DIR || path.join(run, 'evidence');
  await fs.mkdir(evidence, { recursive: true });
  const results = { mode, platform: process.platform, arch: process.arch, file };
  try {
    if (mode !== 'consume') results.sender = await exportedPack(run, file);
    if (mode !== 'produce') results.receiver = await importedPack(run, file);
    results.success = true;
  } catch (error) {
    results.error = error.stack;
    throw error;
  } finally {
    await fs.writeFile(path.join(evidence, `${mode}-${process.platform}.json`), JSON.stringify(results, null, 2));
    console.log(`Loop #103 evidence: ${evidence}`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

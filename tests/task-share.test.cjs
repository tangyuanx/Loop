const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { candidates, project } = require('../app/renderer/src/task-share-model.js');
const { scan, updateDestinations } = require('../app/renderer/src/task-share-markdown.js');
const { prepareContent, markdownDocuments } = require('../app/main/task-share-content.cjs');
const { readTaskPackage, writeTaskPackage } = require('../app/main/task-share-format.cjs');
const { writeArchive } = require('../app/main/task-share-archive.cjs');
const { taskShareStore } = require('../app/main/task-share-store.cjs');
const { recoverAssetImports, stageImportedAssets } = require('../app/main/task-share-assets.cjs');

const node = (id, children = [], links = []) => ({ id, title: id, note: `record-${id}`, children, downstreamNodeIds: links });
const snapshot = { task: { id: 'task', title: 'Task', status: 'done', groupId: 'private-group', deadlineAt: '2026-11-13T00:00:00.000Z',
  deadlineReminderMinutes: 60, knowledgeLinks: ['linked'], description: 'Brief', notes: 'main note',
  nodes: [node('a', [node('child')], ['b']), node('b')] },
documents: [{ id: 'linked', title: 'Linked', notes: 'Linked contents' }, { id: 'open', title: 'Open', notes: 'Open contents' }],
tabIds: ['open', 'linked'] };

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-task-share-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('scope projection includes only selected tree, notes and scheduling fields', () => {
  const full = project(snapshot, { preset: 'full' });
  assert.equal(full.records, true);
  assert.deepEqual(full.notes.map(note => note.id), ['task']);
  assert.equal(full.task.nodes[0].note, 'record-a');
  assert.equal(full.task.deadlineAt, snapshot.task.deadlineAt);
  assert.doesNotMatch(JSON.stringify(full), /private-group|deadlineReminderMinutes|Open contents/);
  const branch = project(snapshot, { preset: 'node', nodeId: 'a' });
  assert.deepEqual(branch.task.nodes.map(item => item.id), ['a']);
  assert.deepEqual(branch.task.nodes[0].downstreamNodeIds, []);
  assert.deepEqual(branch.notes, []);
  assert.equal(branch.records, false);
  assert.doesNotMatch(JSON.stringify(branch), /record-|Brief|deadlineAt/);
  const custom = project(snapshot, { preset: 'custom', noteIds: ['open'], flow: true });
  assert.equal(custom.records, false);
  assert.deepEqual(custom.notes.map(note => note.id), ['open']);
});

test('explicit task membership controls defaults independently of provenance and open tabs', () => {
  const source = { ...snapshot, task: { ...snapshot.task, knowledgeNoteIds: ['open'] } };
  assert.deepEqual(project(source, { preset: 'full' }).notes.map(note => note.id), ['open']);
  assert.deepEqual(project({ ...source, tabIds: [] }, { preset: 'full' }).notes.map(note => note.id), ['open']);
  assert.deepEqual(project({ ...source, task: { ...source.task, knowledgeNoteIds: [] } }, { preset: 'full' }).notes, []);
  assert.equal(candidates(source.task, source.documents, source.tabIds).find(note => note.id === 'linked').defaultSelected, false);
  assert.deepEqual(project(source, { preset: 'custom', noteIds: ['linked'] }).notes.map(note => note.id), ['linked']);
  assert.deepEqual(source.task.knowledgeNoteIds, ['open'], 'one-time export selection does not change membership');
});

test('external Markdown references never request attachments and selected note links still resolve', async t => {
  const root = await fixture(t);
  const source = { ...snapshot.task, knowledgeNoteIds: ['task'], notes:
    '[Other](./not-registered.md)\n[Encoded](./%E5%8F%82%E8%80%83%2Emd)\n[Local](<C:/private/missing.markdown>)\n' +
    '[Selected](./selected.md#target)\n[File](./missing.pdf)\n\n`[Sample](./literal.md)`\n',
    knowledgeNote: { filePath: path.join(root, 'main.md') } };
  const selected = { id: 'selected', title: 'Selected', notes: '### target', knowledgeNote: { filePath: path.join(root, 'selected.md') } };
  const data = { tasks: [source], knowledgeDocuments: [selected] };
  const result = await prepareContent(data, { taskId: source.id, ...project({ task: source, documents: [selected] },
    { preset: 'full', noteIds: ['task', 'selected'] }) }, { directory: root, userData: root });
  assert.equal(result.references.length, 3);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].name, 'File');
  assert.ok(result.issues[0].reason);
  const main = result.pack.notes.find(note => note.main).content;
  assert.match(main, /\[\[note:note_2#target\|Selected\]\]/);
  assert.match(main, /`\[Sample\]\(\.\/literal\.md\)`/);
  assert.doesNotMatch(main, /C:\/private|not-registered\.md|%2Emd/);
});

test('package and readable Markdown preserve source while local paths and omitted documents are removed', async t => {
  const root = await fixture(t);
  const selected = project(snapshot, { preset: 'notes', noteId: 'open' });
  selected.notes[0].content = '# Heading\r\n\r\n[[#Heading|here]]\r\n\r\n<file:///Users/private/report.txt>\r\n\r\n[Web](https://example.org/a%20b)\r\n';
  const content = await prepareContent({ tasks: [snapshot.task], knowledgeDocuments: snapshot.documents }, { taskId: 'task', ...selected }, { directory: root, userData: root });
  assert.equal(content.issues.length, 1);
  const readable = markdownDocuments(content.pack)[0].bytes.toString('utf8');
  assert.match(readable, /\[here\]\(<#Heading>\)/);
  assert.match(readable, /a%20b/);
  assert.doesNotMatch(readable, /\/Users\/private|note_1\.md|Open contents|%2520/);
  const destination = path.join(root, 'share.looptask');
  await writeTaskPackage(destination, content.pack, [], 'test');
  const extract = path.join(root, 'extract');
  await fs.mkdir(extract);
  const parsed = await readTaskPackage(destination, extract);
  assert.equal(parsed.pack.notes[0].content, content.pack.notes[0].content);
  assert.equal(parsed.pack.task.status, 'done');
  const broken = path.join(root, 'broken.looptask');
  await writeArchive(broken, [{ name: 'manifest.json', bytes: Buffer.from('{"format":"loop-task-share","version":2}') }]);
  await assert.rejects(readTaskPackage(broken, extract), { code: 'SHARE_VERSION' });
  const unknown = path.join(root, 'unexpected.looptask');
  await writeArchive(unknown, [{ name: 'unexpected.txt', bytes: Buffer.from('unused') }]);
  await assert.rejects(readTaskPackage(unknown, extract), { code: 'SHARE_FORMAT' });
});

test('rewriting a saved resource updates exact link destinations and preserves literal samples', () => {
  const input = '`loop-asset:asset_example`\r\n![image](<loop-asset:asset_example> "image title")\r\n[File][file]\r\n\r\n[file]: <loop-asset:asset_example#page=1>\r\n';
  assert.equal(scan(input).filter(item => !item.definition).length, 2);
  const output = updateDestinations(input, new Map([['loop-asset:asset_example', './attachments/a.png'],
    ['loop-asset:asset_example#page=1', './attachments/a.pdf#page=1']]));
  assert.equal(output, '`loop-asset:asset_example`\r\n![image](<./attachments/a.png> "image title")\r\n[File][file]\r\n\r\n[file]: <./attachments/a.pdf#page=1>\r\n');
});

test('append serializes behind an in-flight save and rejects a queued stale snapshot', async () => {
  let data = { tasks: [] };
  let release;
  const delay = new Promise(resolve => { release = resolve; });
  const store = taskShareStore({ read: async () => data, assertWritable: () => {}, write: async value => {
    if (value.wait) await delay;
    data = value;
    return data;
  } });
  const first = store.save({ tasks: ['edited'], wait: true }, 0);
  const append = store.append(0, async (current, write) => {
    await write({ tasks: [...current.tasks, 'imported'] });
    return { imported: true };
  });
  const stale = assert.rejects(store.save({ tasks: ['older'] }, 0), { code: 'DATA_STALE_REVISION' });
  release();
  await first;
  assert.equal((await append).revision, 1);
  await stale;
  assert.deepEqual((await store.readForRenderer()).tasks, ['edited', 'imported']);
  await store.save({ tasks: ['edited again', 'imported'] }, 1);
  assert.deepEqual(data.tasks, ['edited again', 'imported']);
});

test('task activity keeps versions, status, moves and deleted node content without logging view changes', () => {
  const { recordTaskActivity, readTaskActivity } = require('../app/main/task-history.cjs');
  const time = seconds => new Date(Date.UTC(2026, 10, 15, 0, 0, seconds));
  const old = { tasks: [{ id: 'task_a', title: '核对材料', status: 'done', conclusion: '旧结论', nodes: [
    { id: 'node_a', title: '核对时间', note: '旧记录' },
    { id: 'node_b', title: '提交' },
    { id: 'node_c', title: '临时线索', note: '仍可追溯的记录' },
  ] }] };
  const viewOnly = structuredClone(old);
  viewOnly.tasks[0].updatedAt = time(1).toISOString();
  viewOnly.tasks[0].nodes[1].collapsed = true;
  viewOnly.theme = 'dark';
  viewOnly.knowledgeDocuments = [{ id: 'empty-draft', title: '未命名', notes: '' }];
  viewOnly.tasks[0].knowledgeNoteIds = ['empty-draft'];
  assert.equal(recordTaskActivity(old, viewOnly, { now: time(1) }).taskActivity, undefined);

  const next = structuredClone(viewOnly);
  const [nodeA, nodeB] = next.tasks[0].nodes;
  next.tasks[0].status = 'active';
  next.tasks[0].conclusion = '新结论';
  nodeA.note = '新记录';
  nodeB.children = [nodeA];
  next.tasks[0].nodes = [nodeB];
  const stored = recordTaskActivity(viewOnly, next, { now: time(10) });
  const events = readTaskActivity(stored, 'task_a').events;
  assert.equal(events.length, 3);
  const taskChange = events.find(event => event.targetKind === 'task');
  assert.deepEqual(taskChange.changes, [
    { field: 'status', before: 'done', after: 'active' },
    { field: 'conclusion', before: '旧结论', after: '新结论' },
  ]);
  assert.equal(taskChange.at, time(10).toISOString());
  const move = events.find(event => event.targetId === 'node_a');
  assert.deepEqual(move.changes, [
    { field: 'placement', before: { parentId: '', parentTitle: '', order: 1 }, after: { parentId: 'node_b', parentTitle: '提交', order: 1 } },
    { field: 'note', before: '旧记录', after: '新记录' },
  ]);
  const removed = events.find(event => event.targetId === 'node_c');
  assert.equal(removed.kind, 'deleted');
  assert.equal(removed.changes[0].before, '仍可追溯的记录');
});

test('task activity coalesces nearby text edits and pages older entries without pruning', () => {
  const { recordTaskActivity, readTaskActivity, normalizeTaskActivity } = require('../app/main/task-history.cjs');
  const timestamp = seconds => new Date(Date.UTC(2026, 10, 15, 0, 0, seconds));
  const state = title => ({ tasks: [{ id: 'task_a', title }] });
  let data = recordTaskActivity(state('初稿'), state('初稿甲'), { now: timestamp(5) });
  const first = data.taskActivity[0];
  data = recordTaskActivity(data, state('初稿甲乙'), { now: timestamp(7) });
  assert.equal(data.taskActivity.length, 1);
  assert.equal(data.taskActivity[0].id, first.id);
  assert.equal(data.taskActivity[0].startedAt, timestamp(5).toISOString());
  assert.deepEqual(data.taskActivity[0].changes, [{ field: 'title', before: '初稿', after: '初稿甲乙' }]);
  for (let index = 1; index <= 45; index += 1) {
    data = recordTaskActivity(data, state('编辑批次 ' + index), { now: timestamp(index * 60) });
  }
  const pages = readTaskActivity(data, 'task_a');
  assert.equal(pages.events.length, 40);
  assert.equal(readTaskActivity(data, 'task_a', pages.beforeId).events.length, 6);
  assert.deepEqual(normalizeTaskActivity(data.taskActivity), data.taskActivity);
  assert.deepEqual(readTaskActivity(data, 'task_other').events, []);
});

test('task activity and restored versions share the committed workspace transaction', async t => {
  const { readTaskData, writeTaskData } = require('../app/main/storage.cjs');
  const root = await fixture(t);
  const task = { id: 'task_versions', title: '任务', conclusion: '旧版结论', nodes: [{ id: 'node_record', title: '节点', note: '旧版记录' }] };
  await writeTaskData(root, { tasks: [task] });
  const input = await readTaskData(root);
  const edited = structuredClone(input);
  edited.tasks[0].conclusion = '新版结论';
  edited.tasks[0].nodes[0].note = '新版记录';
  let rejectWrite = true;
  const options = { read: () => readTaskData(root), assertWritable: () => {},
    write: async data => {
      if (rejectWrite) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      return writeTaskData(root, data);
    } };
  const store = taskShareStore(options);
  await assert.rejects(store.save(edited, 0), { code: 'ENOSPC' });
  assert.deepEqual((await store.historyFor(task.id)).events, []);
  rejectWrite = false;
  await store.save(edited, 0);
  const reopened = taskShareStore(options);
  const events = (await reopened.historyFor(task.id)).events;
  assert.equal(events.length, 2);
  const previousNode = events.find(event => event.targetId === 'node_record');
  rejectWrite = true;
  const request = { taskId: task.id, eventId: previousNode.id, field: 'note', side: 'before', revision: 0 };
  await assert.rejects(reopened.restoreHistory(request), { code: 'ENOSPC' });
  assert.equal((await reopened.historyFor(task.id)).events.length, 2);
  rejectWrite = false;
  const receipt = await reopened.restoreHistory(request);
  assert.equal(receipt.revision, 1);
  await assert.rejects(reopened.save(edited, 0), { code: 'DATA_STALE_REVISION' });
  const postRestore = await readTaskData(root);
  assert.equal(postRestore.tasks[0].nodes[0].note, '旧版记录');
  assert.equal(postRestore.tasks[0].conclusion, '新版结论');
  assert.equal(postRestore.taskActivity.at(-1).kind, 'restored-version');
  assert.deepEqual(postRestore.taskActivity.at(-1).changes, [{ field: 'note', before: '新版记录', after: '旧版记录' }]);
  assert.equal((await reopened.readForRenderer()).taskActivity, undefined);
});

test('Recently Deleted survives beyond 500 items on disk', async t => {
  const { readTaskData, writeTaskData } = require('../app/main/storage.cjs');
  const root = await fixture(t);
  const recentlyDeleted = Array.from({ length: 501 }, (_, index) => ({
    id: 'deleted_' + index, kind: 'task', deletedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    record: { id: 'task_' + index, title: '归档' },
  }));
  await writeTaskData(root, { tasks: [], recentlyDeleted });
  const stored = await readTaskData(root);
  assert.equal(stored.recentlyDeleted.length, 501);
  assert.equal(stored.version, 4, 'an older app must not be allowed to truncate this archive');
  assert.equal(stored.recentlyDeleted.at(-1).id, 'deleted_0');
});

test('inline images in task activity and live node records share one stored asset', async t => {
  const { readTaskData, writeTaskData, DATA_FILE } = require('../app/main/storage.cjs');
  const { IMAGE_ASSETS_DIR } = require('../app/main/image-store.cjs');
  const root = await fixture(t);
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const image = `![照片](${src})`;
  const tasks = [{ id: 'task_image', title: '图片测试', nodes: [{ id: 'node_image', title: '现场', note: `原说明\n${image}` }] }];
  await writeTaskData(root, { tasks });
  const store = taskShareStore({ read: () => readTaskData(root), write: data => writeTaskData(root, data), assertWritable: () => {} });
  const modified = await readTaskData(root);
  modified.tasks[0].nodes[0].note = `新说明\n${image}`;
  await store.save(modified, 0);
  const saved = await readTaskData(root);
  assert.equal(saved.taskActivity[0].changes[0].before, `原说明\n${image}`);
  assert.equal(saved.taskActivity[0].changes[0].after, `新说明\n${image}`);
  assert.equal((await fs.readdir(path.join(root, IMAGE_ASSETS_DIR))).length, 1);
  assert.ok(!(await fs.readFile(path.join(root, DATA_FILE), 'utf8')).includes(src));
});

test('asset recovery removes only the unfinished import, retaining the committed one', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'file.txt');
  const sha256 = require('node:crypto').createHash('sha256').update('content').digest('hex');
  await fs.writeFile(file, 'content');
  const assets = new Map([['resource_1', { file, entry: `assets/${sha256}.txt`, sha256, type: 'text/plain', name: 'file.txt' }]]);
  const done = `task_${randomUUID()}`;
  const pending = `task_${randomUUID()}`;
  const bindings = id => new Map([['resource_1', { id: `asset_${randomUUID()}`, owners: new Set([id]) }]]);
  const durable = await stageImportedAssets(root, done, assets, bindings(done));
  await stageImportedAssets(root, pending, assets, bindings(pending));
  await fs.writeFile(path.join(root, 'task-data.json'), JSON.stringify({ version: 3, tasks: [{ id: done, sharedAssets: durable.index }] }));
  await recoverAssetImports(root);
  assert.deepEqual(await fs.readdir(path.join(root, 'task-share-assets')), [done]);
  assert.deepEqual(await fs.readdir(path.join(root, 'task-share-assets', done)), [`${sha256}.txt`]);
});

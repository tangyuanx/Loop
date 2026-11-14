const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { project } = require('../app/renderer/src/task-share-model.js');
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
  assert.deepEqual(full.notes.map(note => note.id), ['linked', 'task']);
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

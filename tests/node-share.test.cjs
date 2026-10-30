const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vm = require('node:vm');
const path = require('node:path');
const model = require('../app/renderer/src/node-share-model.js');
const { normalizeTaskData, writeTaskData, readTaskData } = require('../app/main/storage.cjs');
const os = require('node:os');
const node = (id, children = [], links = [], order = 0) => ({ id, title: id, note: `record-${id}`, status: 'todo', order, downstreamNodeIds: links, children });
const tree = () => [node('before'), node('a', [node('a1', [node('a11')]), node('a2', [], ['c'])], ['b'], 1), node('unrelated', [], [], 2), node('b', [node('b1')], ['c'], 3), node('c', [], ['a'], 4)];
const ids = result => [...result.ids].sort();

test('default shares descendants and explicit transitive downstream only, safely deduplicating cycles', () => {
  const nodes = tree(), original = JSON.stringify(nodes), result = model.select(nodes, 'a');
  assert.deepEqual(ids(result), ['a', 'a1', 'a11', 'a2', 'b', 'b1', 'c']);
  assert.equal(result.count, 7);
  assert.deepEqual(result.nodes.map(n => n.id), ['a', 'b', 'c']);
  assert.equal(JSON.stringify(nodes), original);
});
test('child and downstream depth budgets are independent and include only selected tree content', () => {
  assert.deepEqual(ids(model.select(tree(), 'a', { childDepth: 0, downstreamDepth: 0 })), ['a']);
  assert.deepEqual(ids(model.select(tree(), 'a', { childDepth: 1, downstreamDepth: 0 })), ['a', 'a1', 'a2']);
  assert.deepEqual(ids(model.select(tree(), 'a', { childDepth: 0, downstreamDepth: 1 })), ['a', 'b']);
  assert.deepEqual(ids(model.select(tree(), 'a', { childDepth: 1, downstreamDepth: 1 })), ['a', 'a1', 'a2', 'b', 'b1', 'c']);
  assert.deepEqual(model.select(tree(), 'a1', { downstreamDepth: 0 }).nodes.map(n => n.id), ['a1']);
});
test('invalid/dangling links, missing roots, completed and collapsed nodes', () => {
  const nodes = [node('a', [node('child')], ['missing', 'a'])]; nodes[0].collapsed = true; nodes[0].status = 'done';
  assert.deepEqual(ids(model.select(nodes, 'a')), ['a', 'child']);
  assert.equal(model.select(nodes, 'missing').count, 0);
});
test('link validation rejects cycles through explicit links and tree ancestry', () => {
  const nodes = [node('a', [node('child')], ['b']), node('b', [], ['c']), node('c'), node('d')];
  assert.equal(model.canLink(nodes, 'c', 'a'), false);
  assert.equal(model.canLink(nodes, 'child', 'a'), false);
  assert.equal(model.canLink(nodes, 'a', 'a'), false);
  assert.equal(model.canLink(nodes, 'a', 'missing'), false);
  assert.equal(model.canLink(nodes, 'c', 'd'), true);
});
test('node Markdown export omits unrelated task content and optionally records, retaining selected links', async () => {
  const code = await fs.readFile(path.join(__dirname, '../app/renderer/src/node-share.js'), 'utf8');
  const app = await fs.readFile(path.join(__dirname, '../app/renderer/src/app.js'), 'utf8');
  const helper = app.slice(app.indexOf('function nodeMarkdownLines('), app.indexOf('function safeDownloadName('));
  const context = vm.createContext({ LoopNodeShare: model, sort: n => n, nodeStatusText: () => '待处理' });
  vm.runInContext(code + '\n' + helper, context);
  context.source = tree()[1]; context.selection = model.select(tree(), 'a');
  const markdown = vm.runInContext('nodeShareMarkdown(source, selection)', context);
  assert.match(markdown, /record-a11/); assert.match(markdown, /a → b/); assert.match(markdown, /b → c/);
  assert.doesNotMatch(markdown, /unrelated|before|背景|知识笔记/);
  assert.doesNotMatch(vm.runInContext('nodeShareMarkdown(source, selection, false)', context), /record-/);
});
test('desktop persistence normalizes links and preserves them across disk reload', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-share-storage-'));
  try {
    const data = { tasks: [{ id: 'task', nodes: [node('a', [], ['b', 'b', 'a', null, '', 2]), node('b')] }] };
    const normalized = normalizeTaskData(data);
    assert.deepEqual(normalized.tasks[0].nodes[0].downstreamNodeIds, ['b']);
    await writeTaskData(profile, data);
    assert.deepEqual((await readTaskData(profile)).tasks[0].nodes[0].downstreamNodeIds, ['b']);
  } finally { await fs.rm(profile, { recursive: true, force: true }); }
});

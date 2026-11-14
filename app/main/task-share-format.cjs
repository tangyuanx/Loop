const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { limits, assertShare, assertSize, readArchive, writeArchive } = require('./task-share-archive.cjs');

const FORMAT = 'loop-task-share';
const VERSION = 1;
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const scopeNames = Object.freeze({ full: '完整任务', brief: '任务简报', flow: '处理流', node: '节点／子树', notes: '知识笔记', custom: '自定义' });
const packageKey = /^[a-z][a-z0-9_-]{0,79}$/;
const digestKey = /^[a-f0-9]{64}$/;
const noteEntry = /^notes\/([a-z][a-z0-9_-]{0,79})\.md$/;
const assetEntry = /^assets\/([a-f0-9]{64})\.([a-z0-9]{1,8})$/;
const assetTypes = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', pdf: 'application/pdf', txt: 'text/plain',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });

function requireFormat(condition, message = '任务包的结构或引用不完整，请让发送方重新导出。') {
  assertShare(condition, 'SHARE_FORMAT', message);
}

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isText(value, limit = 512 * 1024) { return typeof value === 'string' && Buffer.byteLength(value) <= limit; }
function dateValue(value) { return isText(value, 40) && Number.isFinite(Date.parse(value)); }

function validateTask(value) {
  requireFormat(record(value) && Object.hasOwn(scopeNames, value.scope) && typeof value.records === 'boolean');
  const { task, notes, nodeStates, resources } = value;
  requireFormat(record(task) && isText(task.title, 1024) && task.title.trim() && ['active', 'done'].includes(task.status));
  for (const field of ['description', 'hypothesis', 'conclusion']) requireFormat(task[field] === undefined || isText(task[field]));
  requireFormat(task.deadlineAt === undefined || dateValue(task.deadlineAt));
  requireFormat(task.priority === undefined || ['high', 'medium', 'low'].includes(task.priority));
  requireFormat(Array.isArray(nodeStates) && Array.isArray(notes) && Array.isArray(resources));
  assertSize(nodeStates.length, 24); assertSize(notes.length, limits.notes); assertSize(resources.length, limits.assets);
  const statuses = new Set(['todo', 'done', 'review']);
  for (const status of nodeStates) {
    requireFormat(record(status) && packageKey.test(status.id) && !statuses.has(status.id) &&
      isText(status.name, 96) && status.name.trim() && /^#[a-f\d]{6}$/i.test(status.color));
    statuses.add(status.id);
  }
  const ids = new Set();
  const links = [];
  const walk = (items, depth) => {
    requireFormat(Array.isArray(items));
    if (items.length) assertSize(depth, limits.depth);
    for (const node of items) {
      requireFormat(record(node) && typeof node.id === 'string' && packageKey.test(node.id) && !ids.has(node.id));
      ids.add(node.id);
      assertSize(ids.size, limits.nodes);
      requireFormat(isText(node.title, 4096) && statuses.has(node.status) && isText(node.hypothesis) && isText(node.conclusion));
      requireFormat(node.note === undefined || value.records && isText(node.note));
      requireFormat(node.updatedAt === undefined || dateValue(node.updatedAt));
      requireFormat(Array.isArray(node.downstreamNodeIds) && node.downstreamNodeIds.length <= limits.nodes);
      links.push([node.id, node.downstreamNodeIds]);
      walk(node.children, depth + 1);
    }
  };
  walk(task.nodes, 1);
  for (const [id, downstream] of links) {
    requireFormat(new Set(downstream).size === downstream.length && downstream.every(next => next !== id && ids.has(next)));
  }
  const noteIds = new Set();
  let mainNotes = 0;
  for (const note of notes) {
    requireFormat(record(note) && typeof note.id === 'string' && packageKey.test(note.id) && !noteIds.has(note.id));
    noteIds.add(note.id);
    requireFormat(isText(note.title, 1024) && typeof note.main === 'boolean' && note.entry === `notes/${note.id}.md`);
    if (note.main) requireFormat(++mainNotes === 1);
  }
  const resourceIds = new Set();
  for (const resource of resources) {
    requireFormat(record(resource) && typeof resource.id === 'string' && packageKey.test(resource.id) && !resourceIds.has(resource.id));
    resourceIds.add(resource.id);
    const match = typeof resource.entry === 'string' && assetEntry.exec(resource.entry);
    requireFormat(match && Object.hasOwn(assetTypes, match[2]) && resource.type === assetTypes[match[2]] &&
      isText(resource.name, 512) && resource.name.trim() && !/[<>:"/\\|?*\u0000-\u001f]/.test(resource.name));
  }
  return { nodeCount: ids.size, noteIds, resourceIds };
}

function entryLimit(name) {
  if (name === 'manifest.json' || name === 'task.json') return limits.metadata;
  if (noteEntry.test(name)) return limits.note;
  if (assetEntry.test(name)) return limits.asset;
  return 0;
}

function jsonBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function entryBytes(name, bytes) {
  assertSize(bytes.length, entryLimit(name));
  return { name, bytes, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function writeTaskPackage(destination, pack, assets, version, signal) {
  const metadata = { ...pack, notes: pack.notes.map(({ content: _content, ...note }) => note) };
  validateTask(metadata);
  const documents = pack.notes.map(note => entryBytes(note.entry, Buffer.from(note.content, 'utf8')));
  assertSize(documents.reduce((sum, entry) => sum + entry.size, 0), limits.notesBytes);
  const entries = [entryBytes('task.json', jsonBytes(metadata)), ...documents, ...assets];
  const manifest = { format: FORMAT, version: VERSION, generator: version,
    entries: entries.map(({ name, size, sha256 }) => ({ name, size, sha256 })) };
  entries.unshift(entryBytes('manifest.json', jsonBytes(manifest)));
  assertSize(entries.length, limits.entries);
  assertSize(entries.reduce((sum, entry) => sum + entry.size, 0), limits.total);
  await writeArchive(destination, entries, signal);
  assertSize((await fs.stat(destination)).size, limits.archive);
}

async function entryText(entry) {
  requireFormat(entry);
  return textDecoder.decode(await fs.readFile(entry.file));
}

async function readTaskPackage(source, directory, signal) {
  const entries = await readArchive(source, { directory, entryLimit, signal });
  const manifest = JSON.parse(await entryText(entries.get('manifest.json')));
  requireFormat(record(manifest) && manifest.format === FORMAT, '此文件不是 Loop 任务包。完整备份请从设置中恢复。');
  assertShare(manifest.version === VERSION, 'SHARE_VERSION', '此任务包版本不受支持，请更新 Loop 或请发送方重新导出。');
  assertShare(manifest.requires === undefined || Array.isArray(manifest.requires) && manifest.requires.length === 0,
    'SHARE_VERSION', '此任务包需要当前 Loop 不支持的功能，请更新 Loop。');
  requireFormat(Array.isArray(manifest.entries) && manifest.entries.length === entries.size - 1);
  const declared = new Set();
  for (const item of manifest.entries) {
    requireFormat(record(item) && typeof item.name === 'string' && item.name !== 'manifest.json' && !declared.has(item.name));
    declared.add(item.name);
    const entry = entries.get(item.name);
    assertShare(entry && entry.size === item.size && digestKey.test(item.sha256) && entry.sha256 === item.sha256,
      'SHARE_CORRUPT', '任务包的内容摘要校验失败，请重新取得文件。');
  }
  const metadata = JSON.parse(await entryText(entries.get('task.json')));
  const { nodeCount } = validateTask(metadata);
  const required = new Set(['task.json', ...metadata.notes.map(note => note.entry), ...metadata.resources.map(resource => resource.entry)]);
  requireFormat(required.size === declared.size && [...required].every(name => declared.has(name)));
  let noteBytes = 0;
  const notes = [];
  for (const note of metadata.notes) {
    const entry = entries.get(note.entry);
    noteBytes += entry.size;
    assertSize(noteBytes, limits.notesBytes);
    notes.push({ ...note, content: await entryText(entry) });
  }
  const assets = new Map();
  for (const resource of metadata.resources) {
    const entry = entries.get(resource.entry);
    requireFormat(entry.sha256 === assetEntry.exec(resource.entry)[1]);
    assets.set(resource.id, { ...entry, ...resource });
  }
  return { pack: { ...metadata, notes }, assets, nodeCount, noteBytes };
}

module.exports = { scopeNames, assetTypes, limits, requireFormat, validateTask, writeTaskPackage, readTaskPackage };

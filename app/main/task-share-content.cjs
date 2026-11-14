const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { resolveResource } = require('./knowledge-resources.cjs');
const core = require('../renderer/src/knowledge-core.js');
const { scan, rewrite } = require('../renderer/src/task-share-markdown.js');
const { assetTypes, requireFormat, limits } = require('./task-share-format.cjs');
const { managedAsset, newAssetId } = require('./task-share-assets.cjs');
const { stagedCopy, assertSize } = require('./task-share-archive.cjs');

const assetRef = /^loop-asset:([a-z][a-z0-9_-]*)(#.*)?$/;
const fields = ['description', 'hypothesis', 'conclusion'];
const builtInStatus = new Set(['todo', 'done', 'review']);
const allowedLink = /^(?:https?:\/\/|mailto:|#)/i;
const imageData = /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,([a-z0-9+/=\s]+)$/i;
const possibleLocalPath = /(?:file:\/\/[^\s<>`"']+|(?:\b[A-Z]:[\\/]|\\\\|(?<![a-z\d:/.-])\/(?:Users|home|Volumes|private|tmp|var|mnt)\/)[^\s<>`"']+)/gi;

function escapeMarkdown(value) { return String(value ?? '').replace(/[\\[\]`*_<>]/g, '\\$&').replace(/[\r\n]+/g, ' '); }
function safeName(value, fallback = '附件') {
  return String(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 100) || fallback;
}
function plainReference(ref, fallback = '未共享的链接') {
  return escapeMarkdown(ref.autolink || ref.label === ref.destination ? fallback : ref.label || fallback);
}
function link(label, dest, image = false) { return `${image ? '!' : ''}[${escapeMarkdown(label)}](<${dest}>)`; }
function validAssetHeader(bytes, extension) {
  const head = bytes.subarray(0, 16);
  if (extension === 'png') return head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (extension === 'jpg' || extension === 'jpeg') return head[0] === 255 && head[1] === 216 && head[2] === 255;
  if (extension === 'gif') return /^GIF8[79]a/.test(head.toString('ascii'));
  if (extension === 'webp') return /^RIFF....WEBP/s.test(head.toString('latin1'));
  if (extension === 'avif') return head.subarray(4, 12).toString('ascii') === 'ftypavif' || head.subarray(4, 12).toString('ascii') === 'ftypavis';
  if (extension === 'bmp') return head.subarray(0, 2).toString('ascii') === 'BM';
  if (extension === 'pdf') return head.subarray(0, 5).toString('ascii') === '%PDF-';
  if (['docx', 'xlsx', 'pptx'].includes(extension)) return head.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'));
  return !bytes.includes(0) && Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
}

async function assertAssetTypes(assets) {
  for (const asset of assets.values()) {
    const extension = path.extname(asset.entry).slice(1);
    const handle = await fs.open(asset.file, 'r');
    let bytes;
    try {
      if (/^(?:image\/|application\/pdf|application\/vnd\.)/.test(asset.type)) {
        bytes = Buffer.alloc(Math.min(asset.size, 16));
        await handle.read(bytes, 0, bytes.length, 0);
      } else bytes = await handle.readFile();
    } finally { await handle.close(); }
    requireFormat(validAssetHeader(bytes, extension), `附件「${asset.name}」与声明的文件类型不符。`);
  }
}

function flatten(nodes, output = []) {
  for (const node of nodes || []) { output.push(node); flatten(node.children, output); }
  return output;
}

function persistedNotes(data) {
  return [...(data?.tasks || []), ...(data?.knowledgeDocuments || [])].filter(note => !note.knowledgeNote?.isDeleted);
}

async function prepareContent(data, source, { directory, signal, userData, approvedFiles = new Map() }) {
  const sourceTask = data?.tasks?.find(task => task.id === source.taskId);
  const notesOnDisk = persistedNotes(data);
  const notes = source.notes || [];
  assertSize(notes.length, limits.notes);
  const noteMap = new Map(notes.map((note, index) => [note.id, `note_${index + 1}`]));
  const localNotes = new Map(notesOnDisk.map(note => [note.id, note]));
  const sourceNodes = flatten(source.task.nodes);
  assertSize(sourceNodes.length, limits.nodes);
  const nodeMap = new Map(sourceNodes.map((node, index) => [node.id, `node_${index + 1}`]));
  const statusMap = new Map(source.nodeStates.map((status, index) => [status.id, `status_${index + 1}`]));
  const assets = new Map();
  const cached = new Map();
  const issues = new Map();
  const localPaths = new Set();
  const activeResources = new Set();
  const sourceTitle = sourceTask?.title || source.task.title;

  function missing(ref, owner, context) {
    const key = `${owner}\0${ref.destination}`;
    if (!issues.has(key)) issues.set(key, { id: randomUUID(), owner, destination: ref.destination,
      name: safeName(ref.label || path.basename(ref.destination.replaceAll('\\', '/')).split('#')[0]), context });
    return escapeMarkdown(`[附件未包含：${ref.autolink || ref.label === ref.destination ? '本地文件' : ref.label || '本地文件'}]`);
  }

  async function collect(ref, owner, originPath) {
    const destination = ref.destination.split('#')[0];
    const approved = approvedFiles.get(`${owner}\0${ref.destination}`);
    const key = approved ? `approved:${approved}` : `${owner}\0${destination}`;
    if (cached.has(key)) return cached.get(key);
    const staged = path.join(directory, randomUUID());
    let extension;
    let name;
    let bytes;
    let diskFile;
    const inline = imageData.exec(destination);
    const sourceImage = destination.startsWith('task-image:') && data?.attachments?.images?.[destination.slice(11)];
    const embedded = inline || (sourceImage && imageData.exec(sourceImage));
    if (embedded && !approved) {
      extension = embedded[1].toLowerCase();
      assertSize(Math.ceil(embedded[2].length * 3 / 4), limits.asset + 3);
      bytes = Buffer.from(embedded[2], 'base64');
      if (!validAssetHeader(bytes, extension)) return null;
      name = `${safeName(ref.label, '图片')}.${extension}`;
    } else if (assetRef.test(ref.destination) && !approved) {
      const item = await managedAsset(userData, data, assetRef.exec(ref.destination)[1], owner).catch(() => null);
      if (!item) return null;
      diskFile = item.file; name = item.name; extension = path.extname(item.file).slice(1);
    } else {
      if (!approved && (!originPath || /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(destination))) return null;
      try {
        const requested = approved || resolveResource(destination, originPath).filePath;
        diskFile = await fs.realpath(requested);
        const stat = await fs.stat(diskFile);
        if (!stat.isFile()) return null;
        if (!approved) {
          const root = await fs.realpath(path.dirname(originPath));
          const relative = path.relative(root, diskFile);
          if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null;
        }
        assertSize(stat.size, limits.asset);
        extension = path.extname(diskFile).slice(1).toLowerCase();
        name = safeName(path.basename(requested));
      } catch (error) {
        if (error.code === 'SHARE_LIMIT') throw error;
        return null;
      }
    }
    if (!Object.hasOwn(assetTypes, extension) || ref.image && !assetTypes[extension].startsWith('image/')) return null;
    let asset;
    if (bytes) {
      await fs.writeFile(staged, bytes, { flag: 'wx', mode: 0o600, signal });
      asset = { file: staged, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    } else asset = await stagedCopy(diskFile, staged, limits.asset, signal);
    const entry = `assets/${asset.sha256}.${extension}`;
    const existing = assets.get(entry);
    if (existing) { await fs.rm(staged); asset = existing; }
    else {
      asset = { ...asset, id: `resource_${assets.size + 1}`, entry, name, type: assetTypes[extension] };
      await assertAssetTypes(new Map([[asset.id, asset]]));
      assets.set(entry, asset);
      assertSize(assets.size, limits.assets);
      assertSize([...assets.values()].reduce((total, item) => total + item.size, 0), limits.total);
    }
    cached.set(key, asset);
    return asset;
  }

  async function body(value, owner, context) {
    if (value === undefined) return undefined;
    requireFormat(typeof value === 'string');
    assertSize(Buffer.byteLength(value), limits.note);
    const text = value;
    const origin = localNotes.get(owner);
    const originPath = origin?.knowledgeNote?.filePath;
    const replacements = new Map();
    const references = scan(text);
    for (const ref of references) {
      signal?.throwIfAborted();
      const dest = ref.destination;
      if (ref.definition) { replacements.set(ref, ''); continue; }
      if (ref.kind === 'wiki') {
        const target = core.resolve(dest, notesOnDisk, origin);
        const id = target.status === 'resolved' && noteMap.get(target.note.id);
        if (id) {
          const label = String(ref.label || core.noteTitle(target.note)).replace(/[\[\]|\r\n]/g, ' ');
          replacements.set(ref, `${ref.image ? '!' : ''}[[note:${id}${ref.anchor ? `#${ref.anchor}` : ''}|${label}]]`);
        } else replacements.set(ref, plainReference(ref));
        continue;
      }
      if (allowedLink.test(dest)) {
        if (ref.image) replacements.set(ref, link(ref.label || '网络图片', dest.replace(/[<>\r\n]/g, '')));
        else if (ref.reference) replacements.set(ref, { destination: dest });
        continue;
      }
      if (originPath && !ref.image && /\.md(?:#|$)/i.test(dest)) {
        let target;
        try {
          const resolved = resolveResource(dest, originPath);
          target = notesOnDisk.find(note => note.knowledgeNote?.filePath && path.resolve(note.knowledgeNote.filePath) === resolved.filePath);
          if (target) {
            const id = noteMap.get(target.id);
            replacements.set(ref, id ? `[[note:${id}${resolved.anchor ? `#${resolved.anchor}` : ''}|${String(ref.label || core.noteTitle(target)).replace(/[\[\]|\r\n]/g, ' ')}]]` : plainReference(ref));
            continue;
          }
        } catch { /* Let the resource pass report an invalid destination. */ }
      }
      if (/^(?:javascript|vbscript|blob|loop|about):/i.test(dest) || /^data:/i.test(dest) && !imageData.test(dest)) {
        replacements.set(ref, plainReference(ref));
        continue;
      }
      let asset;
      try { asset = await collect(ref, owner, originPath); }
      catch (error) { if (!['SHARE_FORMAT', 'ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
      const destination = asset && `loop-asset:${asset.id}${dest.includes('#') ? dest.slice(dest.indexOf('#')) : ''}`;
      replacements.set(ref, asset ? (ref.autolink ? link(asset.name, destination) : { destination }) : missing(ref, owner, context));
    }
    const edits = new Map([...replacements].map(([ref, replacement]) => [`${ref.from}:${ref.to}`, replacement]));
    const cleaned = rewrite(text, references, ref => edits.get(`${ref.from}:${ref.to}`));
    if (possibleLocalPath.test(cleaned)) localPaths.add(context || '正文');
    possibleLocalPath.lastIndex = 0;
    const safe = source.redactPaths ? cleaned.replace(possibleLocalPath, '〔已隐藏本机路径〕') : cleaned;
    for (const ref of scan(safe)) {
      const id = !ref.definition && assetRef.exec(ref.destination)?.[1];
      if (id) activeResources.add(id);
    }
    return safe;
  }

  async function nodes(items) {
    const output = [];
    for (const item of items) {
      const node = { id: nodeMap.get(item.id), title: item.title, status: builtInStatus.has(item.status) ? item.status : statusMap.get(item.status) || 'todo',
        hypothesis: await body(item.hypothesis, item.id, item.title), conclusion: await body(item.conclusion, item.id, item.title),
        downstreamNodeIds: item.downstreamNodeIds.filter(id => id !== item.id && nodeMap.has(id)).map(id => nodeMap.get(id)),
        children: await nodes(item.children) };
      if (item.note !== undefined && source.records) node.note = await body(item.note, item.id, item.title);
      if (item.updatedAt && Number.isFinite(Date.parse(item.updatedAt))) node.updatedAt = item.updatedAt;
      output.push(node);
    }
    return output;
  }

  const task = { title: source.task.title, status: source.task.status, priority: source.task.priority, deadlineAt: source.task.deadlineAt };
  for (const field of fields) if (source.task[field] !== undefined) task[field] = await body(source.task[field], source.taskId, sourceTitle);
  task.nodes = await nodes(source.task.nodes);
  const documents = [];
  for (const note of notes) {
    const id = noteMap.get(note.id);
    documents.push({ id, title: note.title, main: note.main, entry: `notes/${id}.md`, content: await body(note.content, note.id, note.title) });
  }
  for (const [entry, asset] of assets) if (!activeResources.has(asset.id)) assets.delete(entry);
  const resources = [...assets.values()].map(({ id, entry, name, type }) => ({ id, entry, name, type }));
  return { pack: { scope: source.scope, records: source.records, task, notes: documents, resources,
    nodeStates: source.nodeStates.map(({ id, name, color }) => ({ id: statusMap.get(id), name, color })) },
    assets, issues: [...issues.values()], localPaths: [...localPaths] };
}

function portableBody(content, pack, from = '', inlined = false) {
  const notes = new Map(pack.notes.map(note => [note.id, note]));
  const assets = new Map(pack.resources.map(asset => [asset.id, asset]));
  return rewrite(content, scan(content), ref => {
    if (ref.definition) return '';
    if (ref.kind === 'wiki') {
      const note = notes.get(ref.destination.replace(/^note:/, ''));
      if (!note) return plainReference(ref);
      const anchor = ref.anchor ? `#${encodeURIComponent(ref.anchor)}` : '';
      return link(ref.label || note.title, `${inlined || from === note.entry ? '' : from ? path.posix.relative(path.posix.dirname(from), note.entry) : note.entry}${anchor || (inlined || from === note.entry ? '#' : '')}`);
    }
    const match = assetRef.exec(ref.destination);
    if (!match) return undefined;
    const asset = assets.get(match[1]);
    if (!asset) return plainReference(ref);
    return { destination: `${from ? path.posix.relative(path.posix.dirname(from), asset.entry) : asset.entry}${match[2] || ''}` };
  });
}

function markdownDocuments(pack) {
  const { task } = pack;
  const statusLabel = (status) => ({ todo: '未完成', done: '已完成', review: '待确认' }[status] || pack.nodeStates.find(item => item.id === status)?.name || '未完成');
  const nodes = flatten(task.nodes);
  const index = new Map(nodes.map(node => [node.id, node.title]));
  const standalone = pack.notes.length <= 1 && pack.resources.length === 0;
  const flow = (items, depth = 0) => items.flatMap(node => {
    const indent = '    '.repeat(depth);
    const text = (label, value) => value ? ['', `${indent}    ${label}`, ...portableBody(value, pack, '', standalone).split('\n').map(line => `${indent}    ${line}`), ''] : [];
    return [`${indent}- ${escapeMarkdown(node.title)}（${statusLabel(node.status)}）`,
      ...text('进展', node.hypothesis), ...text('结论', node.conclusion), ...text('记录', node.note), ...flow(node.children, depth + 1)];
  });
  if (standalone && pack.scope === 'notes' && pack.notes.length === 1) {
    return [{ name: 'README.md', bytes: Buffer.from(portableBody(pack.notes[0].content, pack, '', true), 'utf8') }];
  }
  const lines = [`# ${escapeMarkdown(task.title)}`, '', `- 状态：${task.status === 'done' ? '已完成' : '处理中'}`];
  if (task.priority) lines.push(`- 优先级：${({ high: '高', medium: '中', low: '低' })[task.priority]}`);
  if (task.deadlineAt) lines.push(`- 截止时间：${task.deadlineAt}`);
  for (const [field, title] of [['description', '背景'], ['hypothesis', '进展'], ['conclusion', '结论']]) {
    if (task[field] !== undefined) lines.push('', `## ${title}`, '', portableBody(task[field], pack, '', standalone));
  }
  if (nodes.length) {
    lines.push('', '## 处理流', '', ...flow(task.nodes));
    const edges = nodes.flatMap(node => node.downstreamNodeIds.map(id => `- ${escapeMarkdown(node.title)} → ${escapeMarkdown(index.get(id))}`));
    if (edges.length) lines.push('', '## 后续关联', '', ...edges);
  }
  if (pack.notes.length) {
    lines.push('', '## 知识笔记', '');
    if (standalone) lines.push(portableBody(pack.notes[0].content, pack, '', true));
  }
  const readme = lines.join('\n');
  const content = !standalone && pack.notes.length
    ? `${readme}\n${pack.notes.map(note => `- ${link(note.title, note.entry)}`).join('\n')}\n` : `${readme}\n`;
  return [{ name: 'README.md', bytes: Buffer.from(content, 'utf8') },
    ...(!standalone ? pack.notes.map(note => ({ name: note.entry, bytes: Buffer.from(portableBody(note.content, pack, note.entry), 'utf8') })) : [])];
}

function staticDocument(pack) {
  const documents = markdownDocuments(pack);
  const additional = documents.slice(1).map((entry, index) => `\n## ${escapeMarkdown(pack.notes[index].title)}\n\n${entry.bytes.toString('utf8')}`);
  const source = [documents[0].bytes.toString('utf8'), ...additional].join('\n');
  return rewrite(source, scan(source), ref => /(?:^|\/)assets\/[a-f\d]{64}\./i.test(ref.destination) ? plainReference(ref, '附件') : undefined);
}

function remapImportedContent(pack, plan, assets) {
  const owners = new Map([...assets.keys()].map(id => [id, { id: newAssetId(), owners: new Set() }]));
  const visit = (value, owner) => rewrite(value, scan(value), ref => {
    if (ref.definition) return '';
    if (ref.kind === 'wiki') {
      const id = plan.documentIdMap.get(ref.destination.replace(/^note:/, ''));
      requireFormat(id);
      return `${ref.image ? '!' : ''}[[note:${id}${ref.anchor ? `#${ref.anchor}` : ''}|${String(ref.label || '知识笔记').replace(/[\[\]|\r\n]/g, ' ')}]]`;
    }
    const match = assetRef.exec(ref.destination);
    if (match) {
      const binding = owners.get(match[1]);
      requireFormat(binding);
      binding.owners.add(owner);
      return { destination: `loop-asset:${binding.id}${match[2] || ''}` };
    }
    if (allowedLink.test(ref.destination)) {
      if (ref.image) return link(ref.label || '网络图片', ref.destination.replace(/[<>\r\n]/g, ''));
      return ref.reference ? { destination: ref.destination } : undefined;
    }
    return plainReference(ref);
  });
  for (const field of fields) plan.task[field] = visit(plan.task[field], plan.task.id);
  for (const node of flatten(plan.task.nodes)) for (const field of ['hypothesis', 'conclusion', 'note']) node[field] = visit(node[field], node.id);
  for (const note of pack.notes) {
    const id = plan.documentIdMap.get(note.id);
    const doc = id === plan.task.id ? plan.task : plan.documents.find(item => item.id === id);
    requireFormat(doc);
    doc.notes = visit(note.content, id);
  }
  for (const item of owners.values()) requireFormat(item.owners.size);
  return owners;
}

module.exports = { prepareContent, markdownDocuments, staticDocument, remapImportedContent, assertAssetTypes, assetRef, safeName };

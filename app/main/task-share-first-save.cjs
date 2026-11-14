const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { managedAsset } = require('./task-share-assets.cjs');
const { limits } = require('./task-share-archive.cjs');
const { scan, rewrite } = require('../renderer/src/task-share-markdown.js');

const managedReference = /^loop-asset:([a-z][a-z0-9_-]*)(#[^\r\n]*)?$/;
const storedName = /^([a-f\d]{64})\.([a-z\d]{1,8})$/;

function migrationError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function prepareManagedKnowledgeSave(userData, data, noteId, content) {
  const referenced = new Map();
  for (const ref of scan(content)) {
    const match = !ref.definition && ref.kind === 'link' && managedReference.exec(ref.destination);
    if (match) referenced.set(ref.destination, match[1]);
  }
  if (!referenced.size) return [];
  if (referenced.size > limits.entries) throw migrationError('ASSET_LIMIT', '笔记附件数量过多。');
  const owner = [...(data.tasks || []), ...(data.knowledgeDocuments || [])]
    .find(item => !item.knowledgeNote?.isDeleted && (item.id === noteId || item.knowledgeNote?.noteId === noteId));
  if (!owner) throw migrationError('ASSET_OWNER_MISSING', '找不到这份笔记的附件归属。');
  const assets = [];
  const byId = new Map();
  for (const [source, id] of referenced) {
    if (!byId.has(id)) {
      const item = await managedAsset(userData, data, id, owner.id).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!item) throw migrationError('ASSET_UNAVAILABLE', '笔记引用的导入附件不可用。');
      const [ , sha256, extension] = storedName.exec(path.basename(item.file)) || [];
      if (!sha256) throw migrationError('ASSET_UNAVAILABLE', '笔记附件记录无效。');
      byId.set(id, { sourcePath: item.file, sha256, extension, type: item.type });
    }
    assets.push({ ...byId.get(id), source });
  }
  return assets;
}

async function attachmentDirectory(targetPath, fsOps) {
  const root = await fsOps.realpath(path.dirname(targetPath));
  const directory = path.join(root, 'attachments');
  try {
    await fsOps.mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const stats = await fsOps.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || await fsOps.realpath(directory) !== directory) {
    throw migrationError('ASSET_PATH_OUTSIDE_NOTE', '附件目录必须是笔记旁的普通文件夹。');
  }
  return directory;
}

async function digestHandle(handle, { destination, expected } = {}) {
  const stats = await handle.stat();
  if (!stats.isFile() || stats.size > limits.asset) throw migrationError('ASSET_UNAVAILABLE', '笔记附件不可读或超出容量限制。');
  if (expected !== undefined && expected !== stats.size) return null;
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
    size += chunk.length;
    if (size > limits.asset) throw migrationError('ASSET_UNAVAILABLE', '笔记附件超出容量限制。');
    hash.update(chunk);
    if (destination) {
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await destination.write(chunk, offset, chunk.length - offset);
        if (bytesWritten === 0) throw migrationError('ASSET_WRITE_FAILED', '笔记附件写入未完成。');
        offset += bytesWritten;
      }
    }
  }
  return { size, sha256: hash.digest('hex') };
}

async function copyAsset(asset, directory, fsOps, createdFiles) {
  const fileName = `loop-${asset.sha256}.${asset.extension}`;
  const filePath = path.join(directory, fileName);
  const input = await fsOps.open(asset.sourcePath, 'r');
  let output;
  try {
    try {
      output = await fsOps.open(filePath, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (output) createdFiles.push(filePath);
    const result = await digestHandle(input, { destination: output });
    if (result.sha256 !== asset.sha256) throw migrationError('ASSET_DIGEST_MISMATCH', '笔记附件内容已变化，无法保存。');
    if (output) {
      await output.sync();
    } else {
      const stats = await fsOps.lstat(filePath);
      if (!stats.isFile() || stats.isSymbolicLink() || await fsOps.realpath(filePath) !== filePath) {
        throw migrationError('ASSET_ALREADY_EXISTS', '目标位置已有无法复用的同名附件，请选择其他保存位置。');
      }
      const existing = await fsOps.open(filePath, 'r');
      try {
        const old = await digestHandle(existing, { expected: result.size });
        if (old?.sha256 !== asset.sha256) {
          throw migrationError('ASSET_ALREADY_EXISTS', '目标目录存在内容不同的同名附件，请选择其他保存位置。');
        }
      } finally {
        await existing.close();
      }
    }
    return { fileName, filePath };
  } finally {
    await Promise.allSettled([input.close(), output?.close()]);
  }
}

async function copyManagedKnowledgeAssets(targetPath, content, assets, fsOps = fs) {
  const createdFiles = [];
  const assetFiles = [];
  if (!assets.length) return { content, assetFiles, createdFiles };
  const directory = await attachmentDirectory(targetPath, fsOps);
  const replacements = new Map();
  const byDigest = new Map();
  try {
    for (const asset of assets) {
      const key = `${asset.sha256}.${asset.extension}`;
      if (!byDigest.has(key)) byDigest.set(key, await copyAsset(asset, directory, fsOps, createdFiles));
      const { fileName, filePath } = byDigest.get(key);
      const fragment = managedReference.exec(asset.source)[2] || '';
      const relativePath = `./attachments/${fileName}${fragment}`;
      replacements.set(asset.source, relativePath);
      assetFiles.push({ source: asset.source, relativePath, fileName, filePath, type: asset.type, managed: true });
    }
    const migrated = rewrite(content, scan(content), ref => {
      if (ref.kind !== 'link' || !replacements.has(ref.destination)) return undefined;
      const destination = replacements.get(ref.destination);
      if (ref.reference && !ref.definition) return undefined;
      if (ref.autolink) return `[附件](<${destination}>)`;
      return { destination };
    });
    return { content: migrated, assetFiles, createdFiles };
  } catch (error) {
    await Promise.all(createdFiles.map(file => fsOps.rm(file, { force: true }).catch(() => {})));
    throw error;
  }
}

module.exports = { prepareManagedKnowledgeSave, copyManagedKnowledgeAssets };

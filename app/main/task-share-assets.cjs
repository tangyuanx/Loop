const { randomUUID, createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { limits, assertShare, stagedCopy } = require('./task-share-archive.cjs');

const ASSET_DIRECTORY = 'task-share-assets';
const localId = /^[a-z]+_[a-f\d-]{36}$/;
const resourceFile = /^[a-f\d]{64}\.[a-z\d]{1,8}$/;

function localPath(userData, taskId, file) {
  if (typeof taskId !== 'string' || !localId.test(taskId) || typeof file !== 'string' || !resourceFile.test(file)) return '';
  return path.join(userData, ASSET_DIRECTORY, taskId, file);
}

async function managedAsset(userData, taskData, id, ownerId) {
  if (!ownerId || typeof id !== 'string' || !localId.test(id)) return null;
  const archived = (taskData?.recentlyDeleted || []).filter(entry => ['task', 'quick'].includes(entry.kind)).map(entry => entry.record).filter(Boolean);
  for (const task of [...(taskData?.tasks || []), ...archived]) {
    const item = task.sharedAssets?.find?.(asset => asset.id === id && Array.isArray(asset.owners) && asset.owners.includes(ownerId));
    if (!item) continue;
    const file = localPath(userData, task.id, item.file);
    if (!file) return null;
    const root = await fs.realpath(path.join(userData, ASSET_DIRECTORY));
    const real = await fs.realpath(file);
    const relative = path.relative(root, real);
    if (relative !== path.join(task.id, item.file) || !(await fs.stat(real)).isFile()) return null;
    return { ...item, file: real, url: pathToFileURL(real).href };
  }
  return null;
}

async function stageImportedAssets(userData, taskId, assets, owners) {
  if (!assets.size) return { index: [], finish: async () => {}, abort: async () => {} };
  const root = path.join(userData, ASSET_DIRECTORY);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  assertShare(localId.test(taskId), 'SHARE_FORMAT', '任务附件的保存位置无效。');
  const directory = path.join(root, taskId);
  await fs.mkdir(directory, { mode: 0o700 });
  const pending = path.join(directory, '.pending');
  const abort = () => fs.rm(directory, { recursive: true, force: true });
  try {
    const marker = await fs.open(pending, 'wx', 0o600);
    try { await marker.sync(); } finally { await marker.close(); }
    const index = [];
    const copied = new Set();
    for (const [key, asset] of assets) {
      const file = path.basename(asset.entry);
      if (!copied.has(file)) {
        const target = localPath(userData, taskId, file);
        const copy = await stagedCopy(asset.file, target, limits.asset);
        assertShare(copy.sha256 === asset.sha256, 'SHARE_CORRUPT', '附件校验失败，请重新打开任务包。');
        const handle = await fs.open(target, 'r+');
        try { await handle.sync(); } finally { await handle.close(); }
        copied.add(file);
      }
      const binding = owners.get(key);
      index.push({ id: binding.id, file, type: asset.type, name: asset.name, owners: [...binding.owners] });
    }
    return { index, abort, finish: () => fs.rm(pending, { force: true }) };
  } catch (error) {
    await abort().catch(() => {});
    throw error;
  }
}

async function recoverAssetImports(userData) {
  const root = path.join(userData, ASSET_DIRECTORY);
  let entries;
  let data;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
    data = JSON.parse(await fs.readFile(path.join(userData, 'task-data.json'), 'utf8'));
    if (!Array.isArray(data?.tasks) || !Number.isInteger(data.version) || data.version > 3) return;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !localId.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    const pending = path.join(directory, '.pending');
    try { await fs.access(pending); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const task = data.tasks.find(item => item.id === entry.name);
    if (task || (data.recentlyDeleted || []).some(item => item.objectId === entry.name || item.record?.id === entry.name)) {
      if (task?.sharedAssets?.length && !(await verifyPendingAssets(userData, task))) continue;
      await fs.rm(pending);
    }
    else await fs.rm(directory, { recursive: true, force: true });
  }
}

async function verifyPendingAssets(userData, task) {
  try {
    for (const name of new Set(task.sharedAssets.map(asset => asset.file))) {
      const file = localPath(userData, task.id, name);
      if (!file || !(await fs.lstat(file)).isFile() || (await fs.stat(file)).size > limits.asset) return false;
      const hash = createHash('sha256');
      for await (const bytes of createReadStream(file)) hash.update(bytes);
      if (hash.digest('hex') !== name.split('.')[0]) return false;
    }
    return true;
  } catch (error) { return false; }
}

function newAssetId() { return `asset_${randomUUID()}`; }

module.exports = { ASSET_DIRECTORY, managedAsset, stageImportedAssets, recoverAssetImports, newAssetId };

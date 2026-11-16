const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fileDigest, writeDurableJson } = require("./data-continuity.cjs");
const { IMAGE_ASSETS_DIR, isImageFileName, storedImageNames, syncDirectory } = require("./image-store.cjs");
const { readKnowledgeRecovery } = require("./recovery.cjs");
const { DATA_VERSION, dataFilePath, normalizeRecentlyDeleted, readTaskData } = require("./storage.cjs");
const { ASSET_DIRECTORY, localPath } = require("./task-share-assets.cjs");

const RETENTION_FILE = "recently-deleted-retention.json";
const RETENTION_DAYS = new Set([0, 7, 30, 90]);
const DAY_MS = 24 * 60 * 60 * 1000;
const LEGACY_RECOVERY = /^(?:task-data\.(?:corrupt|pre-migration)-.+\.json|knowledge-note-recovery\.json\.(?:corrupt|pre-migration)-.+|(?:task-data|knowledge-note-recovery)\.json\.tmp-.+)$/i;
const SHARED_ASSET_ID = /^asset_[a-f\d-]{36}$/;

const archiveId = entry => typeof entry?.id === "string" ? entry.id.trim() : "";

function archivedTasks(entry) {
  if (entry.kind === "task" || entry.kind === "quick") return [entry.record];
  if (entry.kind === "group" && Array.isArray(entry.members)) return entry.members.map(member => member?.record);
  return [];
}

function planRetention(data, days, time) {
  const archive = data?.recentlyDeleted || [];
  const cutoff = time.getTime() - days * DAY_MS;
  const entriesById = new Map();
  for (const entry of archive) {
    const id = archiveId(entry);
    entriesById.set(id, entriesById.has(id) ? null : entry);
  }
  const known = normalizeRecentlyDeleted(archive);
  const expired = new Set(known.filter(entry => {
    const original = entriesById.get(entry.id);
    const deletedAt = typeof original?.deletedAt === "string" ? Date.parse(original.deletedAt) : NaN;
    // A missing, ambiguous or malformed legacy timestamp cannot authorize a purge.
    return days > 0 && deletedAt <= cutoff && new Date(deletedAt).toISOString() === original.deletedAt;
  }).map(entry => entry.id));

  const activeTasks = new Set((data?.tasks || []).map(task => task.id));
  const requiredOwners = new Set(known.filter(entry =>
    entry.kind === "node" && !expired.has(entry.id) && !activeTasks.has(entry.ownerTaskId),
  ).map(entry => entry.ownerTaskId));
  for (const entry of known) {
    if (archivedTasks(entry).some(task => task?.id && requiredOwners.has(task.id))) expired.delete(entry.id);
  }
  const removed = archive.filter(entry => expired.has(archiveId(entry)));
  return {
    archive: archive.filter(entry => !expired.has(archiveId(entry))),
    removed,
    signature: createHash("sha256").update(JSON.stringify([days, removed])).digest("hex"),
    count: removed.length,
    recordBytes: removed.length ? Buffer.byteLength(JSON.stringify(removed, null, 2)) : 0,
  };
}

function assetPath(root, key) {
  const segments = key.split("/");
  if (segments.length === 2 && segments[0] === IMAGE_ASSETS_DIR && isImageFileName(segments[1])) {
    return path.join(root, ...segments);
  }
  if (segments.length === 3 && segments[0] === ASSET_DIRECTORY) return localPath(root, segments[1], segments[2]);
  return "";
}

function addAssetCandidates(pending, root, entries, dataVersion) {
  if (Number(dataVersion) === DATA_VERSION) {
    for (const name of storedImageNames(entries)) pending.set(`${IMAGE_ASSETS_DIR}/${name}`, new Set());
  }
  for (const entry of entries) {
    for (const task of archivedTasks(entry)) {
      for (const asset of Array.isArray(task?.sharedAssets) ? task.sharedAssets : []) {
        const key = `${ASSET_DIRECTORY}/${asset?.taskId || task.id}/${asset?.file}`;
        if (!assetPath(root, key) || !SHARED_ASSET_ID.test(asset?.id)) continue;
        if (!pending.has(key)) pending.set(key, new Set());
        pending.get(key).add(asset.id);
      }
    }
  }
}

function collectAssetReferences(text, references) {
  for (const match of text.matchAll(/(?:[a-f\d]{64}\.[a-z\d]{1,8}|asset_[a-f\d-]{36})\b/gi)) {
    references.add(match[0].toLowerCase());
  }
}

async function assetReferences(root, data, recovery) {
  const references = new Set();
  collectAssetReferences(JSON.stringify(data), references);
  collectAssetReferences(JSON.stringify(recovery), references);
  // Legacy recovery copies may still depend on the profile's image store.
  // Explicit and automatic backups carry independent copies of managed files.
  for (const name of await fs.readdir(root)) {
    if (!LEGACY_RECOVERY.test(name)) continue;
    const file = path.join(root, name);
    if (!(await fs.lstat(file)).isFile()) throw new Error("Legacy recovery source is not a regular file");
    collectAssetReferences(await fs.readFile(file, "utf8"), references);
  }
  return references;
}

async function removeVerifiedAsset(root, key) {
  const file = assetPath(root, key);
  const segments = key.split("/");
  let directory = root;
  try {
    for (const segment of segments.slice(0, -1)) {
      directory = path.join(directory, segment);
      if (!(await fs.lstat(directory)).isDirectory()) throw new Error("Invalid managed asset directory");
    }
    if (segments[0] === ASSET_DIRECTORY) {
      const pending = await fs.lstat(path.join(directory, ".pending")).catch(error => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (pending) throw new Error("Asset import is pending");
    }
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("Invalid managed asset file");
    const { bytes, sha256 } = await fileDigest(file);
    const checked = await fs.lstat(file);
    if (sha256 !== path.basename(file).split(".")[0] || checked.ino !== stat.ino ||
      checked.dev !== stat.dev || checked.mtimeMs !== stat.mtimeMs || checked.size !== stat.size || checked.nlink !== 1) {
      throw new Error("Managed asset changed during verification");
    }
    await fs.unlink(file);
    await syncDirectory(directory);
    return bytes;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

function createRecentlyDeletedRetention(userDataPath, { now = () => new Date() } = {}) {
  const policyPath = path.join(userDataPath, RETENTION_FILE);
  // A freshly staged image may be in use before its draft metadata reaches disk.
  const stagedImages = new Set();
  const rememberStagedImage = name => stagedImages.add(name);

  async function readPolicy() {
    let raw;
    try {
      raw = await fs.readFile(policyPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { days: 0, pendingAssets: [] };
      throw error;
    }
    const policy = JSON.parse(raw);
    if (!RETENTION_DAYS.has(policy?.days) || !Array.isArray(policy.pendingAssets)
      || policy.pendingAssets.some(asset => typeof asset?.key !== "string" || !assetPath(userDataPath, asset.key)
        || !Array.isArray(asset.ids) || asset.ids.some(id => typeof id !== "string" || !SHARED_ASSET_ID.test(id)))) {
      throw new Error("Invalid recently deleted retention settings");
    }
    return policy;
  }

  async function writePendingAssets(policy, pending) {
    const pendingAssets = Array.from(pending, ([key, ids]) => ({ key, ids: [...ids] }));
    if (JSON.stringify(pendingAssets) === JSON.stringify(policy.pendingAssets)) return policy;
    const next = { ...policy, pendingAssets };
    await writeDurableJson(policyPath, next);
    return next;
  }

  async function setDays(days) {
    if (!RETENTION_DAYS.has(days)) throw new Error("Invalid recently deleted retention period");
    const policy = await readPolicy();
    if (policy.days !== days) await writeDurableJson(policyPath, { ...policy, days });
    return { days };
  }

  async function preview(days) {
    const policy = await readPolicy();
    const selected = days ?? policy.days;
    if (!RETENTION_DAYS.has(selected)) throw new Error("Invalid recently deleted retention period");
    const data = selected ? await readTaskData(userDataPath, { validateOnly: true }) : null;
    const { count, recordBytes, signature } = planRetention(data, selected, now());
    return { days: selected, count, recordBytes, signature };
  }

  // Called only under the task writer queue and recovery write barrier.
  async function clean(expectedSignature) {
    let policy = await readPolicy();
    const result = { days: policy.days, removedIds: [], recordBytes: 0, assetBytes: 0, assetError: false };
    if (!policy.days && !expectedSignature) return result;
    const data = await readTaskData(userDataPath, { validateOnly: true });
    const plan = planRetention(data, policy.days, now());
    if (expectedSignature && expectedSignature !== plan.signature) {
      return { ...result, changed: true };
    }
    if (!data || (!plan.count && !policy.pendingAssets.length)) return result;

    const recovery = await readKnowledgeRecovery(userDataPath, { validateOnly: true });
    const pending = new Map(policy.pendingAssets.map(asset => [asset.key, new Set(asset.ids)]));
    const next = plan.count ? { ...data, recentlyDeleted: plan.archive } : data;
    if (plan.count) {
      addAssetCandidates(pending, userDataPath, plan.removed, data.version);
      // Journal before changing references. An interrupted or failed commit
      // leaves all still-referenced files protected by the next scan.
      policy = await writePendingAssets(policy, pending);
      const file = dataFilePath(userDataPath);
      const before = (await fs.stat(file)).size;
      const after = await writeDurableJson(file, next);
      result.removedIds = plan.removed.map(archiveId);
      result.recordBytes = Math.max(0, before - after);
    }
    if (!pending.size) return result;

    try {
      const root = await fs.realpath(userDataPath);
      const references = await assetReferences(root, next, recovery);
      const remaining = new Map(pending);
      for (const [key, ids] of pending) {
        const name = path.posix.basename(key);
        if (references.has(name) || stagedImages.has(name) || [...ids].some(id => references.has(id))) continue;
        try {
          result.assetBytes += await removeVerifiedAsset(root, key);
          remaining.delete(key);
        } catch (error) {
          console.error("[recently-deleted] Managed asset cleanup failed.", error.code || error.message);
          result.assetError = true;
        }
      }
      if (remaining.size !== pending.size) {
        await writePendingAssets(policy, remaining);
      }
    } catch (error) {
      console.error("[recently-deleted] Managed asset cleanup could not finish.", error.code || error.message);
      result.assetError = true;
    }
    return result;
  }

  return { status: async () => ({ days: (await readPolicy()).days }), setDays, preview, clean, rememberStagedImage };
}

module.exports = { RETENTION_FILE, createRecentlyDeletedRetention };

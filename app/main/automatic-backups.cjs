const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { isManagedEntry } = require("./data-continuity.cjs");
const { IMAGE_ASSETS_DIR, syncDirectory } = require("./image-store.cjs");
const { RECOVERY_FILE, readKnowledgeRecovery } = require("./recovery.cjs");
const { DATA_FILE, readTaskData } = require("./storage.cjs");
const { exportWorkspaceBackup, verifyWorkspaceBackup } = require("./workspace-backup.cjs");

const SNAPSHOT_DIRECTORY = "workspace-snapshots";
const SNAPSHOT_LIMIT = 3;
const SNAPSHOT_BUDGET = 512 * 1024 * 1024;
const SNAPSHOT_NAME = /^loop-auto-(\d{4}-\d{2}-\d{2})-(\d{8}T\d{9}Z)-[a-f0-9-]{36}\.loopbackup$/;
const CHECK_INTERVAL = 15 * 60 * 1000;
const FIRST_CHECK_DELAY = 10 * 1000;
const CACHE_DIRECTORIES = new Set([
  "Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "ShaderCache", "Service Worker",
  "blob_storage", "Session Storage", "Local Storage", "IndexedDB", "Network", "Crashpad", "logs",
]);

async function optionalStats(file) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function localDay(now) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function snapshotName(now) {
  const timestamp = now.toISOString().replace(/[-:.]/g, "");
  return `loop-auto-${localDay(now)}-${timestamp}-${randomUUID()}.loopbackup`;
}

async function listSnapshots(directory) {
  const stats = await optionalStats(directory);
  if (!stats) return [];
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw Object.assign(new Error("自动备份位置不可用。"), { code: "SNAPSHOT_DIRECTORY_INVALID" });
  const snapshots = [];
  for (const name of await fs.readdir(directory)) {
    const parts = SNAPSHOT_NAME.exec(name);
    if (!parts) continue;
    const filePath = path.join(directory, name);
    const file = await optionalStats(filePath);
    if (!file?.isFile()) continue;
    const [, day, timestamp] = parts;
    const at = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}.${timestamp.slice(15)}`;
    snapshots.push({ path: filePath, day, at, bytes: file.size });
  }
  return snapshots.sort((left, right) => right.at.localeCompare(left.at) || right.path.localeCompare(left.path));
}

function totalBytes(snapshots) {
  return snapshots.reduce((bytes, snapshot) => bytes + snapshot.bytes, 0);
}

async function pruneSnapshots(snapshots, newPath, limit, budget) {
  // The caller has just produced a verified archive. Keep it even when it
  // alone exceeds the budget, and never touch directories or user exports.
  const retained = snapshots.find(snapshot => snapshot.path === newPath);
  if (!retained) throw Object.assign(new Error("无法验证新备份的保存位置。"), { code: "SNAPSHOT_NOT_SAVED" });

  let count = snapshots.length;
  let bytes = totalBytes(snapshots);
  for (const snapshot of [...snapshots].reverse()) {
    if (count <= limit && bytes <= budget) break;
    if (snapshot === retained) continue;
    await fs.rm(snapshot.path, { force: true });
    count--;
    bytes -= snapshot.bytes;
  }
}

function createAutomaticBackupController({
  userDataPath,
  appVersion,
  runExclusive = operation => operation(),
  now = () => new Date(),
  snapshotLimit = SNAPSHOT_LIMIT,
  byteBudget = SNAPSHOT_BUDGET,
  exportBackup = exportWorkspaceBackup,
} = {}) {
  const directory = path.join(userDataPath, SNAPSHOT_DIRECTORY);
  let timer = null;
  let started = false;
  let scheduleId = 0;
  let pending = null;
  const state = { latestPath: "", latestAt: "", count: 0, bytes: 0, busy: false, error: "" };

  function update(snapshots) {
    state.latestPath = snapshots[0]?.path || "";
    state.latestAt = snapshots[0]?.at || "";
    state.count = snapshots.length;
    state.bytes = totalBytes(snapshots);
  }

  async function refresh() {
    const verified = [];
    let unavailable = 0;
    for (const snapshot of await listSnapshots(directory)) {
      try {
        await verifyWorkspaceBackup(snapshot.path);
        verified.push(snapshot);
      } catch {
        unavailable++;
      }
    }
    update(verified);
    if (unavailable) state.error = "部分本机备份未通过校验，已保留原文件。";
    return verified;
  }

  async function checkSnapshot() {
    const time = now();
    const current = await refresh();
    if (current.some(snapshot => snapshot.day === localDay(time))) return;
    if (!(await optionalStats(path.join(userDataPath, DATA_FILE)))) return;
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const destinationPath = path.join(directory, snapshotName(time));
    await exportBackup({
      userDataPath, destinationPath, appVersion, includeBoundNotes: false, now: () => time,
      captureSnapshot: operation => runExclusive(async () => {
        await readTaskData(userDataPath, { validateOnly: true });
        await readKnowledgeRecovery(userDataPath, { validateOnly: true });
        return operation();
      }),
    });
    // The export API verifies archive bytes before replacing the destination.
    await syncDirectory(directory);
    await syncDirectory(userDataPath);
    const snapshots = await refresh();
    await pruneSnapshots(snapshots, destinationPath, Math.max(1, snapshotLimit), byteBudget);
    await refresh();
  }

  function status() { return { ...state }; }

  function check() {
    if (pending) return pending;
    state.busy = true;
    state.error = "";
    pending = checkSnapshot().catch(error => {
      state.error = error?.code === "ENOSPC" ? "自动备份失败，磁盘空间不足。" : "自动备份未完成，请检查工作区和磁盘。";
      console.warn("Loop automatic backup failed", error?.code || error?.name);
    }).finally(() => {
      pending = null;
      state.busy = false;
    }).then(status);
    return pending;
  }

  function schedule(delay) {
    const currentSchedule = scheduleId;
    timer = setTimeout(async () => {
      await check();
      if (started && currentSchedule === scheduleId) schedule(CHECK_INTERVAL);
    }, delay);
    timer.unref?.();
  }

  function start() {
    if (started) return;
    started = true;
    schedule(FIRST_CHECK_DELAY);
  }

  function stop() {
    started = false;
    scheduleId++;
    clearTimeout(timer);
    timer = null;
  }

  return { start, stop, check, status, refresh };
}

async function sizeOf(file) {
  const stats = await optionalStats(file);
  if (!stats) return 0;
  if (stats.isFile()) return stats.size;
  if (!stats.isDirectory()) return 0;
  let bytes = 0;
  for (const name of await fs.readdir(file)) bytes += await sizeOf(path.join(file, name));
  return bytes;
}

function spaceCategory(name) {
  if (name === DATA_FILE) return "taskDataBytes";
  if (name === RECOVERY_FILE || name === "knowledge-note-recovery") return "recoveryBytes";
  if (name === IMAGE_ASSETS_DIR) return "imageBytes";
  if (name === "task-share-assets") return "sharedAssetBytes";
  if (name === "workspace-notes") return "restoredNoteBytes";
  if (name === SNAPSHOT_DIRECTORY) return "backupBytes";
  if (CACHE_DIRECTORIES.has(name)) return "cacheBytes";
  if (isManagedEntry(name) || name === ".loop-restore" || name === ".loop-backup-staging") return "otherManagedBytes";
  return "";
}

async function workspaceDiskUsage(userDataPath, backupRoot) {
  const usage = { taskDataBytes: 0, recoveryBytes: 0, imageBytes: 0, sharedAssetBytes: 0, restoredNoteBytes: 0, backupBytes: 0, cacheBytes: 0, otherManagedBytes: 0 };
  const entries = await fs.readdir(userDataPath).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const name of entries) {
    const category = spaceCategory(name);
    if (category) usage[category] += await sizeOf(path.join(userDataPath, name));
  }
  if (backupRoot && !entries.some(name => path.resolve(userDataPath, name) === path.resolve(backupRoot) && spaceCategory(name))) {
    usage.backupBytes += await sizeOf(backupRoot);
  }
  return usage;
}

module.exports = { SNAPSHOT_BUDGET, SNAPSHOT_DIRECTORY, SNAPSHOT_LIMIT, createAutomaticBackupController, workspaceDiskUsage };

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { LEGACY_USER_DATA_DIRECTORY } = require("./app-identity.cjs");
const { isNewerThanSupported } = require("./storage.cjs");

const TASK_DATA_FILE = "task-data.json";
const BACKUP_ROOT_DIRECTORY = "Personal Task Track Upgrade Backups";
const INSTALL_BACKUP_DIRECTORY = "Loop Data Backups";
const LEGACY_DIRECTORY_NAMES = Object.freeze([
  LEGACY_USER_DATA_DIRECTORY,
  "personal-task-track",
  "PersonalTaskTrack",
  "Loop",
]);
const MANAGED_ENTRIES = new Set([
  TASK_DATA_FILE,
  "knowledge-note-recovery.json",
  "knowledge-note-recovery",
  "task-share-assets",
  "deadline-reminders.json",
  "today-widget-preferences.json",
  "update-preferences.json",
]);

function safeSegment(value) {
  return String(value || "unknown").replace(/[^0-9A-Za-z._-]/g, "-").slice(0, 80) || "unknown";
}

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function isManagedEntry(name) {
  return MANAGED_ENTRIES.has(name)
    || /^task-data\.(?:corrupt|pre-migration)-.+\.json$/i.test(name)
    || /^knowledge-note-recovery\.json\.(?:corrupt|pre-migration)-/i.test(name);
}

async function pathExists(filePath, fileSystem = fs) {
  try {
    await fileSystem.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function managedEntryNames(sourcePath, fileSystem = fs) {
  try {
    const entries = await fileSystem.readdir(sourcePath, { withFileTypes: true });
    return entries.map((entry) => entry.name).filter(isManagedEntry).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function regularFiles(rootPath, fileSystem = fs, relativePath = "") {
  const directory = path.join(rootPath, relativePath);
  const entries = await fileSystem.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = path.join(relativePath, entry.name);
    if (entry.isDirectory()) files.push(...await regularFiles(rootPath, fileSystem, childRelative));
    else if (entry.isFile()) files.push(childRelative);
  }
  return files;
}

async function fileDigest(filePath, fileSystem = fs) {
  const content = await fileSystem.readFile(filePath);
  return { bytes: content.length, sha256: crypto.createHash("sha256").update(content).digest("hex") };
}

async function createManifest(dataPath, fileSystem = fs) {
  const files = await regularFiles(dataPath, fileSystem);
  const manifestFiles = [];
  for (const relativePath of files) {
    manifestFiles.push({ relativePath: relativePath.split(path.sep).join("/"), ...await fileDigest(path.join(dataPath, relativePath), fileSystem) });
  }
  return manifestFiles;
}

async function createManagedManifest(sourcePath, fileSystem = fs) {
  const entries = await managedEntryNames(sourcePath, fileSystem);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(sourcePath, entry);
    const stat = await fileSystem.stat(entryPath);
    const relativeFiles = stat.isDirectory() ? await regularFiles(sourcePath, fileSystem, entry) : [entry];
    for (const relativePath of relativeFiles) {
      files.push({ relativePath: relativePath.split(path.sep).join("/"), ...await fileDigest(path.join(sourcePath, relativePath), fileSystem) });
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function verifyManifest(dataPath, expectedFiles, fileSystem = fs) {
  const byPath = (a, b) => a.relativePath.localeCompare(b.relativePath);
  const actualFiles = (await createManifest(dataPath, fileSystem)).sort(byPath);
  const normalizedExpected = [...expectedFiles].sort(byPath);
  if (JSON.stringify(actualFiles) !== JSON.stringify(normalizedExpected)) {
    throw Object.assign(new Error("Upgrade backup verification failed."), { code: "UPGRADE_BACKUP_VERIFY_FAILED" });
  }
  return true;
}

async function createVerifiedBackup({
  sourcePath,
  backupRoot,
  backupName,
  reason,
  fileSystem = fs,
  now = () => new Date(),
} = {}) {
  const entries = await managedEntryNames(sourcePath, fileSystem);
  if (!entries.length) return null;
  const backupPath = path.join(backupRoot, safeSegment(backupName));
  const dataPath = path.join(backupPath, "data");
  await fileSystem.mkdir(dataPath, { recursive: true });
  for (const entry of entries) {
    await fileSystem.cp(path.join(sourcePath, entry), path.join(dataPath, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  const files = await createManifest(dataPath, fileSystem);
  await verifyManifest(dataPath, files, fileSystem);
  const manifest = {
    format: 1,
    reason: String(reason || "upgrade"),
    sourcePath,
    createdAt: now().toISOString(),
    files,
  };
  await fileSystem.writeFile(path.join(backupPath, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { backupPath, dataPath, manifest };
}

async function mirrorVerifiedBackup(backup, installDirectory, fileSystem = fs) {
  if (!backup || !installDirectory) return null;
  const destination = path.join(installDirectory, INSTALL_BACKUP_DIRECTORY, path.basename(backup.backupPath));
  try {
    await fileSystem.mkdir(path.dirname(destination), { recursive: true });
    await fileSystem.cp(backup.backupPath, destination, { recursive: true, force: false, errorOnExist: true });
    await verifyManifest(path.join(destination, "data"), backup.manifest.files, fileSystem);
    return destination;
  } catch (error) {
    await fileSystem.rm(destination, { recursive: true, force: true }).catch(() => {});
    throw Object.assign(new Error("Unable to place a verified backup in the current installation directory."), {
      code: "INSTALL_DIRECTORY_BACKUP_FAILED",
      cause: error,
      stableBackupPath: backup.backupPath,
    });
  }
}

async function createPreInstallBackup({
  appDataPath,
  userDataPath,
  installDirectory,
  currentVersion,
  targetVersion,
  fileSystem = fs,
  now = () => new Date(),
} = {}) {
  const name = `pre-update-${safeSegment(currentVersion)}-to-${safeSegment(targetVersion)}-${backupTimestamp(now())}`;
  const backup = await createVerifiedBackup({
    sourcePath: userDataPath,
    backupRoot: path.join(appDataPath, BACKUP_ROOT_DIRECTORY),
    backupName: name,
    reason: "in-app-update",
    fileSystem,
    now,
  });
  if (!backup) return { skipped: true, reason: "no-managed-data" };
  const installBackupPath = await mirrorVerifiedBackup(backup, installDirectory, fileSystem);
  return { ...backup, installBackupPath, skipped: false };
}

function countNodes(nodes) {
  return Array.isArray(nodes)
    ? nodes.reduce((total, node) => total + 1 + countNodes(node?.children), 0)
    : 0;
}

async function taskDataSummary(userDataPath, fileSystem = fs) {
  try {
    const raw = await fileSystem.readFile(path.join(userDataPath, TASK_DATA_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || !Array.isArray(parsed.tasks)) {
      throw Object.assign(new Error("Invalid task database structure."), { code: "INVALID_IMPORTED_TASK_DATA" });
    }
    if (isNewerThanSupported(parsed)) {
      throw Object.assign(new Error("Task data requires a newer Loop version."), { code: "UNSUPPORTED_DATA_VERSION" });
    }
    const tasks = parsed.tasks;
    const nodes = tasks.reduce((total, task) => total + countNodes(task?.nodes), 0);
    return { valid: true, tasks: tasks.length, nodes, bytes: Buffer.byteLength(raw), score: tasks.length * 1_000_000 + nodes * 10_000 + Buffer.byteLength(raw) };
  } catch (error) {
    return { valid: false, tasks: 0, nodes: 0, bytes: 0, score: 0, errorCode: error?.code || "INVALID_JSON" };
  }
}

async function restoreManagedBackup(backup, destinationPath, fileSystem = fs) {
  await fileSystem.mkdir(destinationPath, { recursive: true });
  const entries = await fileSystem.readdir(backup.dataPath, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(backup.dataPath, entry.name);
    const destination = path.join(destinationPath, entry.name);
    if (entry.name === TASK_DATA_FILE && entry.isFile()) {
      const temporary = `${destination}.migration-${process.pid}-${crypto.randomUUID()}`;
      await fileSystem.copyFile(source, temporary);
      await fileSystem.rename(temporary, destination);
    } else {
      await fileSystem.cp(source, destination, { recursive: true, force: true });
    }
  }
  const restoredTaskData = await fileDigest(path.join(destinationPath, TASK_DATA_FILE), fileSystem);
  const expectedTaskData = backup.manifest.files.find((file) => file.relativePath === TASK_DATA_FILE);
  if (!expectedTaskData || JSON.stringify(restoredTaskData) !== JSON.stringify({ bytes: expectedTaskData.bytes, sha256: expectedTaskData.sha256 })) {
    throw Object.assign(new Error("Migrated task data verification failed."), { code: "TASK_DATA_MIGRATION_VERIFY_FAILED" });
  }
  for (const file of backup.manifest.files) {
    const actual = await fileDigest(path.join(destinationPath, ...file.relativePath.split("/")), fileSystem);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) {
      throw Object.assign(new Error("Restored backup file verification failed."), { code: "RESTORED_BACKUP_VERIFY_FAILED" });
    }
  }
}

function safeBackupRelativePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized === "..") return "";
  const firstSegment = normalized.split("/")[0];
  return isManagedEntry(firstSegment) ? normalized : "";
}

async function exportPortableBackup({
  userDataPath,
  destinationPath,
  appVersion,
  fileSystem = fs,
  now = () => new Date(),
} = {}) {
  const manifest = await createManagedManifest(userDataPath, fileSystem);
  if (!manifest.some((file) => file.relativePath === TASK_DATA_FILE)) {
    throw Object.assign(new Error("No task database is available to export."), { code: "EXPORT_TASK_DATA_MISSING" });
  }
  const files = [];
  for (const file of manifest) {
    files.push({
      ...file,
      contentBase64: (await fileSystem.readFile(path.join(userDataPath, ...file.relativePath.split("/")))).toString("base64"),
    });
  }
  const payload = {
    format: "loop-portable-backup",
    version: 1,
    appVersion: String(appVersion || ""),
    exportedAt: now().toISOString(),
    files,
  };
  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fileSystem.writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const validated = await readPortableBackup(temporaryPath, fileSystem);
    if (validated.files.length !== files.length) throw new Error("Portable backup verification failed.");
    await fileSystem.rename(temporaryPath, destinationPath);
    return { destinationPath, fileCount: files.length, bytes: Buffer.byteLength(JSON.stringify(payload)) };
  } catch (error) {
    await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readPortableBackup(filePath, fileSystem = fs) {
  const payload = JSON.parse(await fileSystem.readFile(filePath, "utf8"));
  if (payload?.format !== "loop-portable-backup" || payload?.version !== 1 || !Array.isArray(payload.files)) {
    throw Object.assign(new Error("Unsupported Loop backup format."), { code: "INVALID_PORTABLE_BACKUP" });
  }
  const seen = new Set();
  const files = [];
  for (const file of payload.files) {
    const relativePath = safeBackupRelativePath(file?.relativePath);
    if (!relativePath || seen.has(relativePath) || typeof file?.contentBase64 !== "string") {
      throw Object.assign(new Error("Loop backup contains an unsafe or duplicate path."), { code: "INVALID_PORTABLE_BACKUP_PATH" });
    }
    const content = Buffer.from(file.contentBase64, "base64");
    const digest = crypto.createHash("sha256").update(content).digest("hex");
    if (content.length !== file.bytes || digest !== file.sha256) {
      throw Object.assign(new Error("Loop backup file verification failed."), { code: "PORTABLE_BACKUP_HASH_MISMATCH" });
    }
    seen.add(relativePath);
    files.push({ relativePath, bytes: content.length, sha256: digest, content });
  }
  if (!seen.has(TASK_DATA_FILE)) {
    throw Object.assign(new Error("Loop backup does not contain task-data.json."), { code: "PORTABLE_BACKUP_TASK_DATA_MISSING" });
  }
  return { ...payload, files };
}

async function stagePortableBackup(filePath, fileSystem = fs) {
  const payload = await readPortableBackup(filePath, fileSystem);
  const root = await fileSystem.mkdtemp(path.join(os.tmpdir(), "loop-portable-import-"));
  const dataPath = path.join(root, "data");
  await fileSystem.mkdir(dataPath, { recursive: true });
  for (const file of payload.files) {
    const destination = path.join(dataPath, ...file.relativePath.split("/"));
    await fileSystem.mkdir(path.dirname(destination), { recursive: true });
    await fileSystem.writeFile(destination, file.content, { mode: 0o600 });
  }
  const manifestFiles = payload.files.map(({ relativePath, bytes, sha256 }) => ({ relativePath, bytes, sha256 }));
  await verifyManifest(dataPath, manifestFiles, fileSystem);
  return { backupPath: root, dataPath, manifest: { files: manifestFiles }, temporary: true, cleanupPath: root };
}

async function findImportDataDirectory(selectedPath, fileSystem = fs) {
  const direct = path.join(selectedPath, TASK_DATA_FILE);
  if (await pathExists(direct, fileSystem)) return selectedPath;
  const standard = path.join(selectedPath, "data", TASK_DATA_FILE);
  if (await pathExists(standard, fileSystem)) return path.join(selectedPath, "data");
  const candidates = [];
  async function visit(directory, depth) {
    if (depth > 3) return;
    let entries;
    try {
      entries = await fileSystem.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      if (await pathExists(path.join(child, TASK_DATA_FILE), fileSystem)) {
        const summary = await taskDataSummary(child, fileSystem);
        if (summary.valid) candidates.push({ path: child, summary });
      }
      await visit(child, depth + 1);
    }
  }
  await visit(selectedPath, 0);
  candidates.sort((a, b) => b.summary.score - a.summary.score);
  return candidates[0]?.path || "";
}

async function stageDirectoryBackup(selectedPath, fileSystem = fs, now = () => new Date()) {
  const sourcePath = await findImportDataDirectory(selectedPath, fileSystem);
  if (!sourcePath) throw Object.assign(new Error("No task database was found in the selected backup directory."), { code: "IMPORT_TASK_DATA_MISSING" });
  const backupRoot = await fileSystem.mkdtemp(path.join(os.tmpdir(), "loop-directory-import-"));
  const backup = await createVerifiedBackup({
    sourcePath,
    backupRoot,
    backupName: `selected-backup-${backupTimestamp(now())}`,
    reason: "manual-import-source",
    fileSystem,
    now,
  });
  if (!backup?.manifest.files.some((file) => file.relativePath === TASK_DATA_FILE)) {
    throw Object.assign(new Error("Selected backup does not contain task data."), { code: "IMPORT_TASK_DATA_MISSING" });
  }
  return { ...backup, temporary: true, cleanupPath: backupRoot };
}

async function removeManagedData(destinationPath, fileSystem = fs) {
  for (const entry of await managedEntryNames(destinationPath, fileSystem)) {
    await fileSystem.rm(path.join(destinationPath, entry), { recursive: true, force: true });
  }
}

async function importBackup({
  selectedPath,
  selectionType,
  appDataPath,
  userDataPath,
  installDirectory,
  fileSystem = fs,
  now = () => new Date(),
} = {}) {
  const incoming = selectionType === "directory"
    ? await stageDirectoryBackup(selectedPath, fileSystem, now)
    : await stagePortableBackup(selectedPath, fileSystem);
  const incomingSummary = await taskDataSummary(incoming.dataPath, fileSystem);
  if (!incomingSummary.valid) {
    if (incoming.temporary) await fileSystem.rm(incoming.cleanupPath || incoming.backupPath, { recursive: true, force: true }).catch(() => {});
    throw Object.assign(new Error("备份中的任务数据无效，或需要更高版本的 Loop；当前工作空间未修改。"), { code: incomingSummary.errorCode || "INVALID_IMPORTED_TASK_DATA" });
  }

  const current = await createVerifiedBackup({
    sourcePath: userDataPath,
    backupRoot: path.join(appDataPath, BACKUP_ROOT_DIRECTORY),
    backupName: `pre-manual-import-${backupTimestamp(now())}`,
    reason: "before-manual-import",
    fileSystem,
    now,
  });
  if (current && installDirectory) await mirrorVerifiedBackup(current, installDirectory, fileSystem);

  try {
    await removeManagedData(userDataPath, fileSystem);
    await restoreManagedBackup(incoming, userDataPath, fileSystem);
    const restored = await taskDataSummary(userDataPath, fileSystem);
    if (!restored.valid || restored.score !== incomingSummary.score) throw new Error("Imported data verification failed.");
    return { imported: true, tasks: restored.tasks, nodes: restored.nodes, safetyBackupPath: current?.backupPath || "" };
  } catch (error) {
    await removeManagedData(userDataPath, fileSystem).catch(() => {});
    let rollbackFailure = null;
    if (current) {
      try {
        await restoreManagedBackup(current, userDataPath, fileSystem);
      } catch (failure) {
        rollbackFailure = failure;
      }
    }
    if (rollbackFailure) {
      // The safety backup still exists, so never hide it behind a generic error.
      const safetyBackupPath = current?.backupPath || "";
      throw Object.assign(
        new Error(`导入失败，且自动回滚未能完成（${rollbackFailure.code || "UNKNOWN"}）。当前数据可能不完整；校验过的安全备份位于：${safetyBackupPath || "未生成"}`),
        { code: "IMPORT_ROLLBACK_FAILED", safetyBackupPath, importError: error, cause: rollbackFailure },
      );
    }
    throw Object.assign(new Error("Import failed and the previous data was restored."), { code: "IMPORT_ROLLED_BACK", cause: error });
  } finally {
    if (incoming.temporary) await fileSystem.rm(incoming.cleanupPath || incoming.backupPath, { recursive: true, force: true }).catch(() => {});
  }
}

async function recoverLegacyUserData({
  appDataPath,
  canonicalUserDataPath,
  recoverRicherLegacy = false,
  fileSystem = fs,
  now = () => new Date(),
} = {}) {
  const canonicalSummary = await taskDataSummary(canonicalUserDataPath, fileSystem);
  if (canonicalSummary.valid && canonicalSummary.tasks > 0 && !recoverRicherLegacy) {
    return { migrated: false, reason: "canonical-has-data" };
  }

  const candidates = [];
  for (const directoryName of LEGACY_DIRECTORY_NAMES) {
    const candidatePath = path.join(appDataPath, directoryName);
    if (path.resolve(candidatePath) === path.resolve(canonicalUserDataPath)) continue;
    const summary = await taskDataSummary(candidatePath, fileSystem);
    const richerThanCanonical = !canonicalSummary.valid
      || canonicalSummary.tasks === 0
      || summary.tasks > canonicalSummary.tasks
      || summary.nodes > canonicalSummary.nodes;
    if (summary.valid && summary.tasks > 0 && (!recoverRicherLegacy || richerThanCanonical)) candidates.push({ candidatePath, summary });
  }
  candidates.sort((a, b) => b.summary.score - a.summary.score);
  const selected = candidates[0];
  if (!selected) return { migrated: false, reason: "no-richer-legacy-data" };

  const backupRoot = path.join(appDataPath, BACKUP_ROOT_DIRECTORY);
  if ((await managedEntryNames(canonicalUserDataPath, fileSystem)).length) {
    await createVerifiedBackup({
      sourcePath: canonicalUserDataPath,
      backupRoot,
      backupName: `pre-migration-${backupTimestamp(now())}`,
      reason: "before-legacy-recovery",
      fileSystem,
      now,
    });
  }
  const sourceBackup = await createVerifiedBackup({
    sourcePath: selected.candidatePath,
    backupRoot,
    backupName: `legacy-recovery-${safeSegment(path.basename(selected.candidatePath))}-${backupTimestamp(now())}`,
    reason: "legacy-data-recovery",
    fileSystem,
    now,
  });
  await restoreManagedBackup(sourceBackup, canonicalUserDataPath, fileSystem);
  const recoveredSummary = await taskDataSummary(canonicalUserDataPath, fileSystem);
  if (!recoveredSummary.valid || recoveredSummary.score !== selected.summary.score) {
    throw Object.assign(new Error("Recovered task data does not match the legacy source."), { code: "LEGACY_DATA_RECOVERY_VERIFY_FAILED" });
  }
  return { migrated: true, sourcePath: selected.candidatePath, backupPath: sourceBackup.backupPath };
}

module.exports = {
  BACKUP_ROOT_DIRECTORY,
  INSTALL_BACKUP_DIRECTORY,
  LEGACY_DIRECTORY_NAMES,
  createPreInstallBackup,
  createVerifiedBackup,
  exportPortableBackup,
  importBackup,
  isManagedEntry,
  readPortableBackup,
  recoverLegacyUserData,
  taskDataSummary,
  verifyManifest,
};

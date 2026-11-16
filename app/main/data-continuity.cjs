const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { LEGACY_USER_DATA_DIRECTORY } = require("./app-identity.cjs");
const storage = require("./storage.cjs");
const { readKnowledgeRecovery } = require("./recovery.cjs");

const TASK_DATA_FILE = "task-data.json";
const BACKUP_ROOT_DIRECTORY = "Personal Task Track Upgrade Backups";
const INSTALL_BACKUP_DIRECTORY = "Loop Data Backups";
const BACKUP_MANIFEST = "backup-manifest.json";
const RESTORE_DIRECTORY = ".loop-restore";
const RESTORE_JOURNAL = "journal.json";
const RESTORE_PHASES = new Set(["saving-previous", "installing", "rolling-back", "committed"]);
const DIRECTORY_ENTRIES = new Set(["knowledge-note-recovery", "task-share-assets", "image-assets", "workspace-notes"]);
const LEGACY_DIRECTORY_NAMES = Object.freeze([
  LEGACY_USER_DATA_DIRECTORY,
  "personal-task-track",
  "PersonalTaskTrack",
  "Loop",
]);
const MANAGED_ENTRIES = new Set([
  TASK_DATA_FILE,
  "task-data.workspace",
  "knowledge-note-recovery.json",
  "knowledge-note-recovery",
  "task-share-assets",
  "image-assets",
  "workspace-notes",
  "deadline-reminders.json",
  "today-widget-preferences.json",
  "update-preferences.json",
]);

function safeSegment(value) {
  const segment = String(value || "").replace(/[^0-9A-Za-z._-]/g, "-").slice(0, 80);
  if (segment === "." || segment === "..") return "unknown";
  return segment || "unknown";
}

function backupTimestamp(date = new Date()) {
  return `${date.toISOString().replace(/[-:.]/g, "")}-${crypto.randomUUID().slice(0, 8)}`;
}

function isManagedEntry(name) {
  return MANAGED_ENTRIES.has(name)
    || /^task-data\.(?:corrupt|pre-migration)-.+\.json$/i.test(name)
    || /^knowledge-note-recovery\.json\.(?:corrupt|pre-migration)-/i.test(name);
}

function backupError(message, code) {
  return Object.assign(new Error(message), { code });
}

async function pathExists(filePath, fileSystem = fs) {
  try {
    await fileSystem.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function syncPath(filePath, flags, fileSystem = fs) {
  const handle = await fileSystem.open(filePath, flags);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory, fileSystem = fs) {
  // Node cannot open directory handles for fsync on Windows.
  if (process.platform !== "win32") await syncPath(directory, "r", fileSystem);
}

async function writeDurableJson(filePath, value, fileSystem = fs) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const temp = `${filePath}.tmp-${crypto.randomUUID()}`;
  const handle = await fileSystem.open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fileSystem.rename(temp, filePath);
    await syncDirectory(path.dirname(filePath), fileSystem);
    return Buffer.byteLength(content);
  } finally {
    await fileSystem.rm(temp, { force: true }).catch(() => {});
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
  for (const entry of entries.filter((entry) => entry.name !== ".DS_Store" && !entry.name.startsWith("._"))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = path.join(relativePath, entry.name);
    if (entry.isDirectory()) files.push(...await regularFiles(rootPath, fileSystem, childRelative));
    else if (entry.isFile()) files.push(childRelative);
    else throw backupError("备份包含不支持的链接或特殊文件。", "UNSUPPORTED_BACKUP_FILE");
  }
  return files;
}

async function fileDigest(filePath, fileSystem = fs) {
  const hash = crypto.createHash("sha256");
  const handle = await fileSystem.open(filePath, "r");
  let bytes = 0;
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
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
    const stat = await fileSystem.lstat(entryPath);
    if (DIRECTORY_ENTRIES.has(entry) ? !stat.isDirectory() : !stat.isFile()) {
      throw backupError("工作区含有类型不符的托管数据。", "UNSUPPORTED_BACKUP_FILE");
    }
    const relativeFiles = stat.isDirectory() ? await regularFiles(sourcePath, fileSystem, entry) : [entry];
    for (const relativePath of relativeFiles) {
      files.push({ relativePath: relativePath.split(path.sep).join("/"), ...await fileDigest(path.join(sourcePath, relativePath), fileSystem) });
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function syncTree(root, fileSystem = fs) {
  await fileSystem.chmod(root, 0o700);
  for (const entry of await fileSystem.readdir(root, { withFileTypes: true })) {
    const item = path.join(root, entry.name);
    if (entry.isDirectory()) await syncTree(item, fileSystem);
    else if (entry.isFile()) {
      await fileSystem.chmod(item, 0o600);
      await syncPath(item, "r+", fileSystem);
    } else {
      throw backupError("备份包含不支持的链接或特殊文件。", "UNSUPPORTED_BACKUP_FILE");
    }
  }
  await syncDirectory(root, fileSystem);
}

async function copyVerifiedManagedData(sourcePath, dataPath, files, fileSystem = fs) {
  await fileSystem.mkdir(dataPath, { mode: 0o700 });
  for (const entry of await managedEntryNames(sourcePath, fileSystem)) {
    await fileSystem.cp(path.join(sourcePath, entry), path.join(dataPath, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  await verifyManifest(dataPath, files, fileSystem);
  await verifyManagedManifest(sourcePath, files, fileSystem);
  await syncTree(dataPath, fileSystem);
}

async function verifyManagedManifest(dataPath, expectedFiles, fileSystem = fs) {
  const actual = await createManagedManifest(dataPath, fileSystem);
  if (JSON.stringify(actual) !== JSON.stringify(sortManifest(expectedFiles))) {
    throw backupError("工作区数据与校验清单不一致。", "WORKSPACE_MANIFEST_MISMATCH");
  }
}

function sortManifest(files) {
  return [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function verifyManifest(dataPath, expectedFiles, fileSystem = fs) {
  const actualFiles = sortManifest(await createManifest(dataPath, fileSystem));
  const normalizedExpected = sortManifest(expectedFiles);
  if (JSON.stringify(actualFiles) !== JSON.stringify(normalizedExpected)) {
    throw Object.assign(new Error("Upgrade backup verification failed."), { code: "UPGRADE_BACKUP_VERIFY_FAILED" });
  }
  return true;
}

async function publishVerifiedDirectory(destination, build, fileSystem = fs) {
  const parent = path.dirname(destination);
  await fileSystem.mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = await fileSystem.mkdtemp(path.join(parent, ".loop-backup-"));
  let reserved = false;
  try {
    const manifest = await build(path.join(staging, "data"));
    await writeDurableJson(path.join(staging, BACKUP_MANIFEST), manifest, fileSystem);
    // Reserve the final name without ever replacing another backup. A backup
    // becomes discoverable only when its verified data directory is published.
    await fileSystem.mkdir(destination, { mode: 0o700 });
    reserved = true;
    await fileSystem.rename(path.join(staging, BACKUP_MANIFEST), path.join(destination, BACKUP_MANIFEST));
    await fileSystem.rename(path.join(staging, "data"), path.join(destination, "data"));
    reserved = false;
    await syncDirectory(destination, fileSystem);
    await syncDirectory(parent, fileSystem);
    return manifest;
  } finally {
    if (reserved) await fileSystem.rm(destination, { recursive: true, force: true }).catch(() => {});
    await fileSystem.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
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
  const files = validateManifestFiles(await createManagedManifest(sourcePath, fileSystem));
  const manifest = await publishVerifiedDirectory(backupPath, async (stagedData) => {
    await copyVerifiedManagedData(sourcePath, stagedData, files, fileSystem);
    return {
      format: 1,
      reason: String(reason || "upgrade"),
      sourcePath,
      createdAt: now().toISOString(),
      files,
    };
  }, fileSystem);
  return { backupPath, dataPath, manifest };
}

async function mirrorVerifiedBackup(backup, installDirectory, fileSystem = fs) {
  if (!backup || !installDirectory) return null;
  const destination = path.join(installDirectory, INSTALL_BACKUP_DIRECTORY, path.basename(backup.backupPath));
  try {
    await publishVerifiedDirectory(destination, async (stagedData) => {
      await copyVerifiedManagedData(backup.dataPath, stagedData, backup.manifest.files, fileSystem);
      return backup.manifest;
    }, fileSystem);
    return destination;
  } catch (error) {
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
    if (storage.isNewerThanSupported(parsed)) {
      throw Object.assign(new Error("Task data requires a newer Loop version."), { code: "UNSUPPORTED_DATA_VERSION" });
    }
    storage.validateTaskDataStructure(parsed);
    const tasks = parsed.tasks;
    const nodes = tasks.reduce((total, task) => total + countNodes(task?.nodes), 0);
    return { valid: true, tasks: tasks.length, nodes, bytes: Buffer.byteLength(raw) };
  } catch (error) {
    return { valid: false, tasks: 0, nodes: 0, bytes: 0, errorCode: error?.code || "INVALID_JSON" };
  }
}

function safeBackupRelativePath(value) {
  if (typeof value !== "string") return "";
  const segments = value.replaceAll("\\", "/").split("/");
  const [root] = segments;
  if (!isManagedEntry(root) || DIRECTORY_ENTRIES.has(root) !== (segments.length > 1)) return "";
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || /[. ]$/.test(segment)
      || /[<>:"|?*\u0000-\u001f]/.test(segment)
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment)) return "";
  }
  return segments.join("/");
}

function validateManifestFiles(files, code = "INVALID_BACKUP_MANIFEST") {
  if (!Array.isArray(files)) throw backupError("备份校验清单格式无效。", code);
  const seen = new Set();
  const directories = new Set();
  return files.map((file) => {
    const relativePath = safeBackupRelativePath(file?.relativePath);
    const key = relativePath.normalize("NFC").toLowerCase();
    if (!relativePath || seen.has(key) || directories.has(key)) throw backupError("备份包含不安全或重复的路径。", code);
    let parent = path.posix.dirname(key);
    while (parent !== ".") {
      if (seen.has(parent)) throw backupError("备份的文件路径与目录重复。", code);
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[0-9a-f]{64}$/.test(file.sha256)) {
      throw backupError("备份校验清单格式无效。", code);
    }
    seen.add(key);
    return { relativePath, bytes: file.bytes, sha256: file.sha256 };
  });
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
  const contentFiles = payload.files.filter((file) => !isVolumeMetadataFile(file));
  const manifest = validateManifestFiles(contentFiles, "INVALID_PORTABLE_BACKUP_PATH");
  const files = contentFiles.map((file, index) => {
    if (typeof file.contentBase64 !== "string") throw backupError("备份文件内容无效。", "INVALID_PORTABLE_BACKUP");
    const content = Buffer.from(file.contentBase64, "base64");
    const digest = crypto.createHash("sha256").update(content).digest("hex");
    if (content.length !== file.bytes || digest !== file.sha256) {
      throw Object.assign(new Error("Loop backup file verification failed."), { code: "PORTABLE_BACKUP_HASH_MISMATCH" });
    }
    return { ...manifest[index], content };
  });
  if (!files.some((file) => file.relativePath === TASK_DATA_FILE)) {
    throw Object.assign(new Error("Loop backup does not contain task-data.json."), { code: "PORTABLE_BACKUP_TASK_DATA_MISSING" });
  }
  return { ...payload, files };
}

async function stagePortableBackup(filePath, { fileSystem = fs, dataPath } = {}) {
  const payload = await readPortableBackup(filePath, fileSystem);
  await fileSystem.mkdir(dataPath, { mode: 0o700 });
  for (const file of payload.files) {
    const destination = path.join(dataPath, ...file.relativePath.split("/"));
    await fileSystem.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fileSystem.writeFile(destination, file.content, { flag: "wx", mode: 0o600 });
  }
  const manifestFiles = payload.files.map(({ relativePath, bytes, sha256 }) => ({ relativePath, bytes, sha256 }));
  return { dataPath, manifest: { files: manifestFiles } };
}

async function identifyBackupDirectory(directory, fileSystem) {
  const dataChild = path.join(directory, "data");
  const manifestChild = path.join(directory, BACKUP_MANIFEST);
  if (await pathExists(manifestChild, fileSystem)) {
    return { sourcePath: dataChild, manifestPath: manifestChild };
  }
  if (await pathExists(path.join(directory, TASK_DATA_FILE), fileSystem)) {
    const parentManifest = path.join(path.dirname(directory), BACKUP_MANIFEST);
    const useParentManifest = path.basename(directory) === "data" && await pathExists(parentManifest, fileSystem);
    return { sourcePath: directory, manifestPath: useParentManifest ? parentManifest : "" };
  }
  if (await pathExists(path.join(dataChild, TASK_DATA_FILE), fileSystem)) {
    return { sourcePath: dataChild, manifestPath: "" };
  }
  return null;
}

async function findImportDataDirectory(selectedPath, fileSystem = fs) {
  const direct = await identifyBackupDirectory(selectedPath, fileSystem);
  if (direct) return direct;
  const candidates = [];
  async function visit(directory, depth) {
    for (const entry of await fileSystem.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".loop-")) continue;
      const child = path.join(directory, entry.name);
      const candidate = await identifyBackupDirectory(child, fileSystem);
      if (candidate && await pathExists(path.join(candidate.sourcePath, TASK_DATA_FILE), fileSystem)) {
        candidates.push(candidate);
      } else if (!candidate && depth < 3) {
        await visit(child, depth + 1);
      }
    }
  }
  await visit(selectedPath, 1);
  if (candidates.length > 1) {
    throw backupError("所选目录包含多个备份。请选择其中一份具体的备份目录。", "AMBIGUOUS_BACKUP_DIRECTORY");
  }
  if (!candidates.length) throw backupError("在所选目录中找不到任务数据库。", "IMPORT_TASK_DATA_MISSING");
  return candidates[0];
}

function isVolumeMetadataFile(file) {
  if (typeof file?.relativePath !== "string") return false;
  const segments = file.relativePath.replaceAll("\\", "/").split("/");
  return segments.every(segment => segment && segment !== "." && segment !== ".." && !/[<>:"|?*\u0000-\u001f]/.test(segment))
    && segments.some(segment => segment === ".DS_Store" || segment.startsWith("._"));
}

async function readDirectoryManifest(manifestPath, fileSystem) {
  if (!(await fileSystem.lstat(manifestPath)).isFile()) {
    throw backupError("备份清单必须是普通文件。", "INVALID_BACKUP_MANIFEST");
  }
  let payload;
  try {
    payload = JSON.parse(await fileSystem.readFile(manifestPath, "utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw backupError("备份校验清单损坏。", "INVALID_BACKUP_MANIFEST");
  }
  if (payload?.format !== 1) throw backupError("备份清单版本不受支持。", "INVALID_BACKUP_MANIFEST");
  return validateManifestFiles(Array.isArray(payload.files)
    ? payload.files.filter(file => !isVolumeMetadataFile(file))
    : payload.files);
}

async function stageDirectoryBackup(selectedPath, { fileSystem, dataPath }) {
  const { sourcePath, manifestPath } = await findImportDataDirectory(selectedPath, fileSystem);
  const files = manifestPath
    ? await readDirectoryManifest(manifestPath, fileSystem)
    : validateManifestFiles(await createManagedManifest(sourcePath, fileSystem));
  if (!files.some((file) => file.relativePath === TASK_DATA_FILE)) {
    throw backupError("所选备份没有任务数据库。", "IMPORT_TASK_DATA_MISSING");
  }
  await copyVerifiedManagedData(sourcePath, dataPath, files, fileSystem);
  return { dataPath, manifest: { files }, legacyUnverified: !manifestPath };
}

function restorePaths(userDataPath) {
  const root = path.join(userDataPath, RESTORE_DIRECTORY);
  return {
    root,
    journal: path.join(root, RESTORE_JOURNAL),
    previous: path.join(root, "previous"),
    incoming: path.join(root, "incoming"),
    displaced: path.join(root, "displaced"),
    userDataPath,
  };
}

async function assertRestoreDirectory(directory, fileSystem) {
  if (!(await fileSystem.lstat(directory)).isDirectory()) {
    throw backupError("恢复目录必须是普通目录。", "INVALID_RESTORE_JOURNAL");
  }
}

function verifyEntryNames(actual, expected) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw backupError("工作区的文件与恢复记录不一致。", "RESTORE_ENTRY_MISMATCH");
  }
}

function validateJournalEntries(entries, files) {
  if (!Array.isArray(entries) || new Set(entries).size !== entries.length
    || !entries.every((entry) => typeof entry === "string" && !/[\\/]/.test(entry) && isManagedEntry(entry))
    || files.some((file) => !entries.includes(file.relativePath.split("/")[0]))) {
    throw backupError("恢复记录中的托管路径无效。", "INVALID_RESTORE_JOURNAL");
  }
  return entries;
}

async function readRestoreJournal(paths, fileSystem) {
  if (!(await fileSystem.lstat(paths.journal)).isFile()) {
    throw backupError("恢复记录必须是普通文件。", "INVALID_RESTORE_JOURNAL");
  }
  const journal = JSON.parse(await fileSystem.readFile(paths.journal, "utf8"));
  if (journal?.format !== 1 || !RESTORE_PHASES.has(journal.phase)) {
    throw backupError("恢复记录无效。", "INVALID_RESTORE_JOURNAL");
  }
  const previousFiles = validateManifestFiles(journal.previousFiles, "INVALID_RESTORE_JOURNAL");
  const incomingFiles = validateManifestFiles(journal.incomingFiles, "INVALID_RESTORE_JOURNAL");
  if (!incomingFiles.some((file) => file.relativePath === TASK_DATA_FILE)) {
    throw backupError("恢复记录缺少传入数据库。", "INVALID_RESTORE_JOURNAL");
  }
  return {
    ...journal,
    previousFiles,
    incomingFiles,
    previousEntries: validateJournalEntries(journal.previousEntries, previousFiles),
    incomingEntries: validateJournalEntries(journal.incomingEntries, incomingFiles),
  };
}

async function moveEntries(names, source, destination, fileSystem) {
  for (const entry of names) {
    const target = path.join(destination, entry);
    if (await pathExists(target, fileSystem)) throw backupError("恢复目标已有同名文件。", "RESTORE_ENTRY_COLLISION");
    await fileSystem.rename(path.join(source, entry), target);
  }
  await syncDirectory(source, fileSystem);
  await syncDirectory(destination, fileSystem);
}

async function advanceRestore(paths, journal, phase, fileSystem) {
  const next = { ...journal, phase };
  await writeDurableJson(paths.journal, next, fileSystem);
  return next;
}

async function detachRestore(paths, fileSystem) {
  const completed = `${paths.root}-complete-${crypto.randomUUID()}`;
  await fileSystem.rename(paths.root, completed);
  await syncDirectory(paths.userDataPath, fileSystem);
  await fileSystem.rm(completed, { recursive: true, force: true }).catch(() => {});
}

async function cleanupDetachedRestores(userDataPath, fileSystem) {
  let entries;
  try {
    entries = await fileSystem.readdir(userDataPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && /^\.loop-restore-complete-[0-9a-f-]{36}$/.test(entry.name)) {
      await fileSystem.rm(path.join(userDataPath, entry.name), { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function restorePrevious(paths, journal, fileSystem) {
  await assertRestoreDirectory(paths.previous, fileSystem);
  const active = await managedEntryNames(paths.userDataPath, fileSystem);
  const previous = await managedEntryNames(paths.previous, fileSystem);
  verifyEntryNames([...active, ...previous], journal.previousEntries);
  const splitManifest = [
    ...await createManagedManifest(paths.userDataPath, fileSystem),
    ...await createManagedManifest(paths.previous, fileSystem),
  ];
  if (JSON.stringify(sortManifest(splitManifest)) !== JSON.stringify(sortManifest(journal.previousFiles))) {
    throw backupError("上一次工作区的校验失败。", "RESTORE_PREVIOUS_MISMATCH");
  }
  await moveEntries(previous, paths.previous, paths.userDataPath, fileSystem);
  await verifyManagedManifest(paths.userDataPath, journal.previousFiles, fileSystem);
}

async function recoverInterruptedRestore({ userDataPath, fileSystem = fs } = {}) {
  const paths = restorePaths(userDataPath);
  let safetyBackupPath = "";
  try {
    await cleanupDetachedRestores(userDataPath, fileSystem);
    if (!(await pathExists(paths.root, fileSystem))) return { recovered: false };
    await assertRestoreDirectory(paths.root, fileSystem);
    if (!(await pathExists(paths.journal, fileSystem))) {
      // Before the first durable journal entry, no active file has moved.
      await detachRestore(paths, fileSystem);
      return { recovered: true, status: "discarded-staging" };
    }
    let journal = await readRestoreJournal(paths, fileSystem);
    safetyBackupPath = typeof journal.safetyBackupPath === "string" ? journal.safetyBackupPath : "";
    if (journal.phase === "committed") {
      verifyEntryNames(await managedEntryNames(userDataPath, fileSystem), journal.incomingEntries);
      await verifyManagedManifest(userDataPath, journal.incomingFiles, fileSystem);
      await detachRestore(paths, fileSystem);
      return { recovered: true, status: "committed" };
    }
    if (journal.phase === "installing") {
      await assertRestoreDirectory(paths.previous, fileSystem);
      verifyEntryNames(await managedEntryNames(paths.previous, fileSystem), journal.previousEntries);
      await verifyManagedManifest(paths.previous, journal.previousFiles, fileSystem);
      await fileSystem.mkdir(paths.displaced, { recursive: true, mode: 0o700 });
      await assertRestoreDirectory(paths.displaced, fileSystem);
      const active = await managedEntryNames(userDataPath, fileSystem);
      if (active.some((entry) => !journal.incomingEntries.includes(entry))) {
        throw backupError("工作区内出现了恢复记录之外的文件。", "RESTORE_ENTRY_MISMATCH");
      }
      await moveEntries(active, userDataPath, paths.displaced, fileSystem);
      journal = await advanceRestore(paths, journal, "rolling-back", fileSystem);
    }
    await restorePrevious(paths, journal, fileSystem);
    await detachRestore(paths, fileSystem);
    return { recovered: true, status: "rolled-back", safetyBackupPath };
  } catch (cause) {
    const backupDetail = safetyBackupPath ? ` 可用安全备份位于 ${safetyBackupPath}。` : "";
    throw Object.assign(
      new Error(`上一次恢复未能完成。工作区已暂停写入。${backupDetail}`),
      { code: "RESTORE_RECOVERY_FAILED", safetyBackupPath, cause },
    );
  }
}

async function installStagedWorkspace(paths, journal, fileSystem) {
  await moveEntries(journal.previousEntries, paths.userDataPath, paths.previous, fileSystem);
  await verifyManifest(paths.previous, journal.previousFiles, fileSystem);
  const installing = await advanceRestore(paths, journal, "installing", fileSystem);
  await moveEntries(journal.incomingEntries, paths.incoming, paths.userDataPath, fileSystem);
  verifyEntryNames(await managedEntryNames(paths.userDataPath, fileSystem), journal.incomingEntries);
  await verifyManagedManifest(paths.userDataPath, journal.incomingFiles, fileSystem);
  await advanceRestore(paths, installing, "committed", fileSystem);
}

async function stageAndRestore({ userDataPath, fileSystem, prepare, saveCurrent }) {
  const paths = restorePaths(userDataPath);
  await fileSystem.mkdir(userDataPath, { recursive: true, mode: 0o700 });
  try {
    await fileSystem.mkdir(paths.root, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    throw backupError("工作区仍有待处理的恢复操作，请重启 Loop。", "RESTORE_ALREADY_PENDING");
  }
  let safetyBackupPath = "";
  let activationAttempted = false;
  let result;
  try {
    const incoming = await prepare(paths.incoming);
    if (incoming?.dataPath !== paths.incoming) {
      throw backupError("备份未写入指定的暂存目录。", "INVALID_BACKUP_STAGING");
    }
    await assertRestoreDirectory(paths.incoming, fileSystem);
    const incomingFiles = validateManifestFiles(incoming.manifest?.files);
    await verifyManifest(paths.incoming, incomingFiles, fileSystem);
    const summary = await taskDataSummary(paths.incoming, fileSystem);
    if (!summary.valid) {
      throw backupError("备份中的任务数据无效，或需要更高版本的 Loop；当前工作空间未修改。", summary.errorCode);
    }
    await storage.readTaskData(paths.incoming, { fileSystem, validateOnly: true });
    await readKnowledgeRecovery(paths.incoming, { fileSystem, validateOnly: true });
    await syncTree(paths.incoming, fileSystem);
    const current = await saveCurrent?.();
    safetyBackupPath = current?.backupPath || "";
    const journal = {
      format: 1,
      phase: "saving-previous",
      previousFiles: current?.manifest.files || [],
      previousEntries: await managedEntryNames(userDataPath, fileSystem),
      incomingFiles,
      incomingEntries: await managedEntryNames(paths.incoming, fileSystem),
      safetyBackupPath,
    };
    await verifyManagedManifest(userDataPath, journal.previousFiles, fileSystem);
    await fileSystem.mkdir(paths.previous, { mode: 0o700 });
    await syncDirectory(userDataPath, fileSystem);
    result = { imported: true, tasks: summary.tasks, nodes: summary.nodes, safetyBackupPath, legacyUnverified: incoming.legacyUnverified === true };
    activationAttempted = true;
    await writeDurableJson(paths.journal, journal, fileSystem);
    await installStagedWorkspace(paths, journal, fileSystem);
  } catch (error) {
    if (!activationAttempted) {
      await detachRestore(paths, fileSystem).catch(() => {});
      throw error;
    }
    let recovered;
    try {
      recovered = await recoverInterruptedRestore({ userDataPath, fileSystem });
    } catch (failure) {
      const backupDetail = safetyBackupPath ? ` 校验过的安全备份位于 ${safetyBackupPath}。` : "";
      throw Object.assign(
        new Error(`导入失败，且自动回滚未能完成。当前工作区已暂停写入。${backupDetail}`),
        { code: "IMPORT_ROLLBACK_FAILED", safetyBackupPath, importError: error, cause: failure },
      );
    }
    if (recovered.status === "committed") return result;
    throw Object.assign(new Error("Import failed and the previous data was restored."), { code: "IMPORT_ROLLED_BACK", cause: error });
  }
  // A cleanup failure leaves a committed journal for the next startup. The
  // active workspace has already been verified and no data is removed here.
  await detachRestore(paths, fileSystem).catch(() => {});
  return result;
}

async function importBackup({
  selectedPath,
  selectionType,
  appDataPath,
  userDataPath,
  installDirectory,
  stageBackupFile,
  fileSystem = fs,
  now = () => new Date(),
} = {}) {
  return stageAndRestore({
    userDataPath,
    fileSystem,
    prepare: async (dataPath) => {
      const options = { fileSystem, userDataPath, dataPath };
      if (selectionType === "directory") return stageDirectoryBackup(selectedPath, options);
      return await stageBackupFile?.(selectedPath, options) || stagePortableBackup(selectedPath, options);
    },
    saveCurrent: async () => {
      const current = await createVerifiedBackup({
        sourcePath: userDataPath,
        backupRoot: path.join(appDataPath, BACKUP_ROOT_DIRECTORY),
        backupName: `pre-manual-import-${backupTimestamp(now())}`,
        reason: "before-manual-import",
        fileSystem,
        now,
      });
      if (current && installDirectory) await mirrorVerifiedBackup(current, installDirectory, fileSystem);
      return current;
    },
  });
}

async function recoverLegacyUserData({
  appDataPath,
  canonicalUserDataPath,
  fileSystem = fs,
  now = () => new Date(),
} = {}) {
  const canonicalSummary = await taskDataSummary(canonicalUserDataPath, fileSystem);
  if (canonicalSummary.valid) {
    return { migrated: false, reason: "canonical-has-data" };
  }
  if (canonicalSummary.errorCode !== "ENOENT" || (await managedEntryNames(canonicalUserDataPath, fileSystem)).length) {
    return { migrated: false, reason: "canonical-needs-recovery" };
  }

  const candidates = [];
  for (const directoryName of LEGACY_DIRECTORY_NAMES) {
    const candidatePath = path.join(appDataPath, directoryName);
    if (path.resolve(candidatePath) === path.resolve(canonicalUserDataPath)) continue;
    const summary = await taskDataSummary(candidatePath, fileSystem);
    if (summary.valid) candidates.push(candidatePath);
  }
  if (candidates.length > 1) {
    throw backupError("找到了多个旧版工作区。请从恢复入口选择所需的工作区目录。", "LEGACY_WORKSPACE_AMBIGUOUS");
  }
  const [sourcePath] = candidates;
  if (!sourcePath) return { migrated: false, reason: "no-legacy-data" };

  const backupRoot = path.join(appDataPath, BACKUP_ROOT_DIRECTORY);
  const sourceBackup = await createVerifiedBackup({
    sourcePath,
    backupRoot,
    backupName: `legacy-recovery-${safeSegment(path.basename(sourcePath))}-${backupTimestamp(now())}`,
    reason: "legacy-data-recovery",
    fileSystem,
    now,
  });
  await stageAndRestore({
    userDataPath: canonicalUserDataPath,
    fileSystem,
    async prepare(dataPath) {
      const { files } = sourceBackup.manifest;
      await copyVerifiedManagedData(sourceBackup.dataPath, dataPath, files, fileSystem);
      return { dataPath, manifest: { files } };
    },
  });
  return { migrated: true, sourcePath, backupPath: sourceBackup.backupPath };
}

module.exports = {
  BACKUP_ROOT_DIRECTORY,
  INSTALL_BACKUP_DIRECTORY,
  LEGACY_DIRECTORY_NAMES,
  createPreInstallBackup,
  createVerifiedBackup,
  createManagedManifest,
  exportPortableBackup,
  fileDigest,
  importBackup,
  isManagedEntry,
  readPortableBackup,
  recoverInterruptedRestore,
  recoverLegacyUserData,
  validateManifestFiles,
  taskDataSummary,
  verifyManifest,
  writeDurableJson,
};

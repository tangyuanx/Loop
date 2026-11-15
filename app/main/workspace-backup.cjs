const { createHash, randomUUID } = require("node:crypto");
const { createReadStream, createWriteStream } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Transform, Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { TextDecoder } = require("node:util");
const yauzl = require("yauzl");
const yazl = require("yazl");
const { createVerifiedBackup, isManagedEntry } = require("./data-continuity.cjs");
const { MAGIC, decryptBackup, encryptBackup } = require("./backup-encryption.cjs");
const { scan } = require("../renderer/src/task-share-markdown.js");

const FORMAT = "loop-workspace-backup";
const VERSION = 2;
const NOTES_DIRECTORY = "workspace-notes";
const STAGING_DIRECTORY = ".loop-backup-staging";
const MANIFEST = "manifest.json";
const DATA_FILE = "task-data.json";
const ENTRY_LIMIT = 50_000;
const FILE_LIMIT = 4 * 1024 ** 3;
const TOTAL_LIMIT = 24 * 1024 ** 3;
const INDEX_LIMIT = 24 * 1024 ** 2;
const MANIFEST_LIMIT = 16 * 1024 ** 2;
const decoder = new TextDecoder("utf-8", { fatal: true });

function backupFailure(code, message, cause) {
  return Object.assign(new Error(message, { cause }), { code });
}

function ensure(condition, code, message) {
  if (!condition) throw backupFailure(code, message);
}

function portablePath(relative) {
  if (typeof relative !== "string" || !relative || relative.length > 1024) return false;
  return relative.split("/").every((part) =>
    part && part !== "." && part !== ".." && part.length <= 255 &&
    !/[\\<>:"|?*\u0000-\u001f]/u.test(part) && !/[. ]$/u.test(part) &&
    !/^(?:CON|PRN|AUX|NUL|(?:COM|LPT)[1-9¹²³])(?:\.|$)/iu.test(part),
  );
}

function pathKey(relative) {
  return relative.normalize("NFC").toLowerCase();
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

function* noteBindings(database) {
  const documentBinding = (item) => item?.knowledgeNote &&
    typeof item.knowledgeNote.filePath === "string" && item.knowledgeNote.filePath
    ? { note: item.knowledgeNote, body: item.notes } : null;
  for (const item of [...(database.tasks || []), ...(database.knowledgeDocuments || [])]) {
    const binding = documentBinding(item);
    if (binding) yield binding;
  }
  for (const entry of database.recentlyDeleted || []) {
    if (entry?.kind === "note" && entry.knowledgeNote && (entry.sourcePath || entry.knowledgeNote.filePath)) {
      yield { note: entry.knowledgeNote, archive: entry, body: entry.body };
    }
    if (entry?.kind === "task" || entry?.kind === "quick") {
      const binding = documentBinding(entry.record);
      if (binding) yield binding;
    }
    if (entry?.kind === "group") {
      for (const member of entry.members || []) {
        const binding = documentBinding(member.record);
        if (binding) yield binding;
      }
    }
  }
}

function bindToPath({ note, archive }, target) {
  note.filePath = target || null;
  if (archive) archive.sourcePath = target || "";
  if (!target) {
    note.documentState = "DRAFT";
    note.lastSavedHash = null;
    note.lastSavedMtime = null;
  }
}

async function copyExternal(source, destination, seen) {
  const previous = seen.get(pathKey(destination));
  if (previous) return previous === source;
  const stats = await fs.stat(source);
  ensure(stats.isFile() && stats.size <= FILE_LIMIT, "BACKUP_UNSUPPORTED_FILE", "备份含无法读取或过大的文件。");
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const original = await hashFile(source);
  await fs.copyFile(source, destination, require("node:fs").constants.COPYFILE_EXCL);
  const copied = await hashFile(destination);
  const after = await hashFile(source);
  ensure(original.bytes === copied.bytes && original.sha256 === copied.sha256 &&
    after.bytes === copied.bytes && after.sha256 === copied.sha256,
  "BACKUP_CHANGED", "备份时有引用文件发生变化，请重试。");
  seen.set(pathKey(destination), source);
  return true;
}

function resourceRelativePath(destination) {
  if (!destination || destination.startsWith("#") || /^(?:https?:|mailto:|data:|task-image:|loop-asset:)/i.test(destination)) return null;
  try {
    const relative = decodeURIComponent(destination.split(/[?#]/u, 1)[0]).replace(/^(?:\.\/)+/u, "");
    return portablePath(relative) ? relative : "";
  } catch {
    return "";
  }
}

async function captureBoundNotes(dataPath, userDataPath, { includeBoundNotes }) {
  const databasePath = path.join(dataPath, DATA_FILE);
  const database = JSON.parse(await fs.readFile(databasePath, "utf8"));
  ensure(database && Array.isArray(database.tasks), "BACKUP_DATABASE_INVALID", "当前任务文件无效，无法生成工作区备份。");
  const bindings = [...noteBindings(database)];
  if (includeBoundNotes && database.knowledgeWorkspace) {
    delete database.knowledgeWorkspace.saveDirectoriesByTask;
  }
  const inventory = { boundNotes: 0, includedNotes: 0, missingNotes: 0, excludedNotes: 0, missingResources: 0 };
  const results = new Map();
  const seen = new Map();
  const missing = new Set();
  const managedNotes = path.join(userDataPath, NOTES_DIRECTORY);
  const userDataReal = await fs.realpath(userDataPath);

  for (const binding of bindings) {
    const source = binding.archive?.sourcePath || binding.note.filePath;
    if (!results.has(source)) {
      inventory.boundNotes++;
      let captured = null;
      let alreadyManaged = false;
      try {
        const real = await fs.realpath(source);
        alreadyManaged = isInside(managedNotes, source) && isInside(path.join(userDataReal, NOTES_DIRECTORY), real);
        if (alreadyManaged || includeBoundNotes) {
          const basename = path.basename(source);
          ensure(path.isAbsolute(source) && /\.md(?:own)?$/i.test(source) && /\.md(?:own)?$/i.test(real) &&
            portablePath(basename), "BACKUP_NOTE_PATH", "知识笔记路径无法移植。");
          const directory = path.dirname(real);
          const directoryId = createHash("sha256").update(directory).digest("hex").slice(0, 32);
          const local = alreadyManaged
            ? path.relative(userDataPath, source).split(path.sep).join("/")
            : `${NOTES_DIRECTORY}/${directoryId}/${basename}`;
          ensure(portablePath(local), "BACKUP_NOTE_PATH", "知识笔记路径无法移植。");
          const target = path.join(dataPath, ...local.split("/"));
          const stats = await fs.stat(alreadyManaged ? target : real);
          ensure(stats.isFile() && stats.size <= INDEX_LIMIT, "BACKUP_NOTE_TOO_LARGE", "知识笔记超过可索引大小。");
          const content = decoder.decode(await fs.readFile(alreadyManaged ? target : real));
          if (!alreadyManaged) {
            ensure(await copyExternal(real, target, seen), "BACKUP_NOTE_COLLISION", "知识笔记文件名在目标系统上冲突。");
            ensure(decoder.decode(await fs.readFile(target)) === content,
              "BACKUP_CHANGED", "备份时有知识笔记发生变化，请重试。");
          }
          captured = { local, directory, target, content, alreadyManaged };
        }
      } catch (error) {
        if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP", "BACKUP_NOTE_PATH", "BACKUP_NOTE_TOO_LARGE", "BACKUP_NOTE_COLLISION", "ERR_ENCODING_INVALID_ENCODED_DATA"].includes(error?.code)) throw error;
      }
      if (captured) inventory.includedNotes++;
      else if (alreadyManaged || includeBoundNotes) inventory.missingNotes++;
      else inventory.excludedNotes++;
      results.set(source, captured);
    }
    const captured = results.get(source);
    if (captured || includeBoundNotes || !path.isAbsolute(source)) bindToPath(binding, captured?.local);
    if (!captured) continue;
    for (const body of [captured.content, binding.body]) {
      if (typeof body !== "string") continue;
      for (const ref of scan(body)) {
        if (ref.definition || ref.kind === "wiki") continue;
        const relative = resourceRelativePath(ref.destination);
        if (relative === null) continue;
        const key = captured.local + "\0" + ref.destination;
        if (!relative || relative.split("/").some(part => part.startsWith("."))) { missing.add(key); continue; }
        const original = path.join(captured.directory, ...relative.split("/"));
        try {
          const real = await fs.realpath(original);
          if (!isInside(captured.directory, real)) { missing.add(key); continue; }
          const stats = await fs.stat(real);
          if (!stats.isFile() || stats.size > FILE_LIMIT) { missing.add(key); continue; }
          const target = path.join(path.dirname(captured.target), ...relative.split("/"));
          if (captured.alreadyManaged) {
            if (!(await fs.stat(target)).isFile()) missing.add(key);
          } else if (!(await copyExternal(real, target, seen))) {
            missing.add(key);
          }
        } catch (error) {
          if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EEXIST", "ELOOP"].includes(error?.code)) throw error;
          // The referenced file may already be copied as another bound note.
          if (error.code !== "EEXIST" || seen.get(pathKey(path.join(path.dirname(captured.target), ...relative.split("/")))) === undefined) missing.add(key);
        }
      }
    }
  }
  inventory.missingResources = missing.size;
  await fs.writeFile(databasePath, JSON.stringify(database) + "\n", { mode: 0o600 });
  return inventory;
}

async function hashFile(file) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    ensure(bytes <= FILE_LIMIT, "BACKUP_FILE_LIMIT", "备份包含超过限制的文件。");
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function manifestFiles(directory) {
  const files = [];
  async function visit(parent) {
    for (const item of await fs.readdir(path.join(directory, parent), { withFileTypes: true })) {
      if (item.name === ".DS_Store" || item.name.startsWith("._")) continue;
      const relative = parent ? `${parent}/${item.name}` : item.name;
      ensure(portablePath(relative), "BACKUP_INVALID_PATH", "存在无法在 macOS 和 Windows 间迁移的资源名称。");
      if (item.isDirectory()) await visit(relative);
      else {
        ensure(item.isFile(), "BACKUP_UNSUPPORTED_FILE", "备份包含符号链接或非普通文件。");
        ensure(files.length < ENTRY_LIMIT, "BACKUP_FILE_LIMIT", "备份文件数量超过容量限制。");
        files.push({ relativePath: relative, ...await hashFile(path.join(directory, ...relative.split("/"))) });
      }
    }
  }
  await visit("");
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function validateManifest(manifest) {
  ensure(manifest?.format === FORMAT && manifest.version === VERSION && Array.isArray(manifest.files), "BACKUP_FORMAT", "无法识别此版本的工作区备份。");
  ensure(["portable", "local"].includes(manifest.scope), "BACKUP_FORMAT", "无法识别备份的恢复范围。");
  const expected = new Map(), keys = new Set();
  let total = 0;
  ensure(manifest.files.length <= ENTRY_LIMIT, "BACKUP_FILE_LIMIT", "备份文件数量超过容量限制。");
  for (const file of manifest.files) {
    const name = file?.relativePath;
    ensure(portablePath(name) && isManagedEntry(name.split("/")[0]) && !keys.has(pathKey(name)) &&
      /^[a-f0-9]{64}$/.test(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= FILE_LIMIT,
    "BACKUP_MANIFEST", "备份文件清单无效或路径冲突。");
    total += file.bytes;
    ensure(total <= TOTAL_LIMIT, "BACKUP_FILE_LIMIT", "备份解压后超过容量限制。");
    expected.set(name, file);
    keys.add(pathKey(name));
  }
  for (const name of keys) {
    const parts = name.split("/");
    for (let count = 1; count < parts.length; count++) {
      ensure(!keys.has(parts.slice(0, count).join("/")), "BACKUP_MANIFEST", "备份文件和目录名称冲突。");
    }
  }
  ensure(expected.has(DATA_FILE), "BACKUP_MANIFEST", "备份不含任务数据。");
  return expected;
}

async function verifyArchive(file, destination) {
  const zip = await yauzl.openPromise(file, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  try {
    ensure(zip.entryCount > 1 && zip.entryCount <= ENTRY_LIMIT + 1, "BACKUP_FILE_LIMIT", "备份文件数量超过容量限制。");
    let manifest;
    let expected;
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
      ensure((!unixType || unixType === 0o100000) && !entry.isEncrypted(), "BACKUP_FORMAT", "备份含有不能还原的文件类型。");
      if (!manifest) {
        ensure(name === MANIFEST && entry.uncompressedSize <= MANIFEST_LIMIT, "BACKUP_MANIFEST", "备份缺少有效的清单。");
        const chunks = [];
        for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
        manifest = JSON.parse(decoder.decode(Buffer.concat(chunks)));
        expected = validateManifest(manifest);
        continue;
      }
      const item = expected.get(name);
      ensure(item && item.bytes === entry.uncompressedSize, "BACKUP_MANIFEST", "备份内容与清单不一致。");
      const hash = createHash("sha256");
      let bytes = 0;
      const meter = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      } });
      let output;
      if (destination) {
        const target = path.join(destination, ...name.split("/"));
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        output = createWriteStream(target, { flags: "wx", mode: 0o600 });
      } else {
        output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      }
      await pipeline(await zip.openReadStreamPromise(entry), meter, output);
      ensure(bytes === item.bytes && hash.digest("hex") === item.sha256, "BACKUP_CHECKSUM", "备份文件的完整性校验失败。");
      expected.delete(name);
    }
    ensure(manifest && !expected.size, "BACKUP_MANIFEST", "备份缺少清单中的文件。");
    return manifest;
  } finally {
    zip.close();
  }
}

async function writeArchive(dataPath, target, manifest) {
  const zip = new yazl.ZipFile();
  const output = pipeline(zip.outputStream, createWriteStream(target, { flags: "wx", mode: 0o600 }));
  zip.on("error", error => zip.outputStream.destroy(error));
  try {
    const encoded = Buffer.from(JSON.stringify(manifest));
    ensure(encoded.length <= MANIFEST_LIMIT, "BACKUP_MANIFEST", "备份清单超过容量限制。");
    zip.addBuffer(encoded, MANIFEST, { mode: 0o100600 });
    for (const file of manifest.files) {
      zip.addFile(path.join(dataPath, ...file.relativePath.split("/")), file.relativePath, { mode: 0o100600 });
    }
    zip.end();
  } catch (error) {
    zip.outputStream.destroy(error);
  }
  await output;
}

async function backupStagingRoot(userDataPath) {
  const root = path.join(userDataPath, STAGING_DIRECTORY);
  await fs.mkdir(root, { mode: 0o700 }).catch(error => {
    if (error?.code !== "EEXIST") throw error;
  });
  const entry = await fs.lstat(root);
  ensure(entry.isDirectory() && !entry.isSymbolicLink(), "BACKUP_STAGING_PATH", "备份暂存目录无法安全使用。");
  return root;
}

async function clearBackupStaging(userDataPath) {
  const root = path.join(userDataPath, STAGING_DIRECTORY);
  const entry = await fs.lstat(root).catch(error => {
    if (error?.code !== "ENOENT") throw error;
    return null;
  });
  if (!entry) return;
  ensure(entry.isDirectory() && !entry.isSymbolicLink(), "BACKUP_STAGING_PATH", "备份暂存目录无法安全使用。");
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    if (item.isDirectory() && /^snapshot-[A-Za-z0-9]{6}$/.test(item.name)) {
      await fs.rm(path.join(root, item.name), { recursive: true, force: true });
    }
  }
}

async function exportWorkspaceBackup({ userDataPath, destinationPath, appVersion, includeBoundNotes = true, password = "", captureSnapshot = operation => operation(), now = () => new Date() }) {
  ensure(path.extname(destinationPath).toLowerCase() === ".loopbackup", "BACKUP_EXTENSION", "请选择扩展名为 .loopbackup 的备份文件。");
  const directory = await fs.realpath(path.dirname(destinationPath));
  const profile = await fs.realpath(userDataPath);
  const profileRelative = path.relative(profile, directory);
  ensure(!isInside(profile, directory) || (!isManagedEntry(profileRelative.split(path.sep)[0]) &&
    profileRelative.split(path.sep)[0] !== STAGING_DIRECTORY), "BACKUP_DESTINATION", "请将备份保存到工作区内容目录之外。");
  const temporary = await fs.mkdtemp(path.join(await backupStagingRoot(userDataPath), "snapshot-"));
  const output = path.join(directory, `.loop-backup-output-${randomUUID()}`);
  const packed = password ? path.join(temporary, "archive.zip") : output;
  try {
    const snapshot = await captureSnapshot(() => createVerifiedBackup({
      sourcePath: userDataPath, backupRoot: temporary, backupName: "snapshot", reason: "portable-workspace",
    }));
    ensure(snapshot?.manifest.files.some(item => item.relativePath === DATA_FILE), "EXPORT_TASK_DATA_MISSING", "当前没有可导出的任务数据。");
    const inventory = await captureBoundNotes(snapshot.dataPath, userDataPath, { includeBoundNotes });
    const files = await manifestFiles(snapshot.dataPath);
    const manifest = { format: FORMAT, version: VERSION, scope: includeBoundNotes ? "portable" : "local", appVersion, exportedAt: now().toISOString(), inventory, files };
    validateManifest(manifest);
    await writeArchive(snapshot.dataPath, packed, manifest);
    await verifyArchive(packed);
    if (password) {
      await encryptBackup(packed, output, password);
      await decryptBackup(output, password);
    }
    const handle = await fs.open(output, "r+");
    try { await handle.sync(); } finally { await handle.close(); }
    await fs.rename(output, destinationPath);
    return { destinationPath, fileCount: files.length, bytes: (await fs.stat(destinationPath)).size, inventory, encrypted: Boolean(password) };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
    await fs.rm(output, { force: true }).catch(() => {});
  }
}

async function stageWorkspaceBackup(selectedPath, { userDataPath, dataPath, password = "", localRestore = false }) {
  const handle = await fs.open(selectedPath, "r");
  const header = Buffer.alloc(MAGIC.length);
  try {
    const file = await handle.stat();
    ensure(file.isFile() && file.size <= TOTAL_LIMIT + MANIFEST_LIMIT, "BACKUP_FILE_LIMIT", "备份文件超过容量限制或无法读取。");
    await handle.read(header, 0, header.length, 0);
  } finally { await handle.close(); }
  if (!header.equals(MAGIC) && header.subarray(0, 4).toString("hex") !== "504b0304") return null;
  let manifest;
  if (header.equals(MAGIC)) {
    const staging = path.dirname(dataPath);
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    const decrypted = path.join(staging, `.unlocked-${randomUUID()}`);
    try {
      await decryptBackup(selectedPath, password, decrypted);
      manifest = await verifyArchive(decrypted, dataPath);
    } finally {
      await fs.rm(decrypted, { force: true }).catch(() => {});
    }
  } else {
    manifest = await verifyArchive(selectedPath, dataPath);
  }
  const databasePath = path.join(dataPath, DATA_FILE);
  const original = await fs.readFile(databasePath);
  const database = JSON.parse(original);
  ensure(database && Array.isArray(database.tasks), "BACKUP_DATABASE_INVALID", "备份中的任务文件无效。");
  const present = new Set(manifest.files.map(file => file.relativePath));
  let rebased = false;
  for (const binding of noteBindings(database)) {
    const relative = binding.archive?.sourcePath || binding.note.filePath;
    if (manifest.scope === "local" && (path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative))) {
      if (!localRestore) {
        bindToPath(binding, null);
        rebased = true;
      }
      continue;
    }
    ensure(portablePath(relative) && relative.startsWith(NOTES_DIRECTORY + "/") &&
      /\.md(?:own)?$/i.test(relative) && present.has(relative),
    "BACKUP_NOTE_PATH", "备份中的知识笔记路径无法校验。");
    bindToPath(binding, path.join(userDataPath, ...relative.split("/")));
    rebased = true;
  }
  if (manifest.scope === "local" && !localRestore && database.knowledgeWorkspace?.saveDirectoriesByTask) {
    delete database.knowledgeWorkspace.saveDirectoriesByTask;
    rebased = true;
  }
  if (rebased) {
    await fs.writeFile(databasePath, JSON.stringify(database) + "\n", { mode: 0o600 });
    Object.assign(manifest.files.find(file => file.relativePath === DATA_FILE), await hashFile(databasePath));
  }
  return { dataPath, manifest, inventory: manifest.inventory };
}

module.exports = { clearBackupStaging, exportWorkspaceBackup, stageWorkspaceBackup, verifyWorkspaceBackup: verifyArchive };

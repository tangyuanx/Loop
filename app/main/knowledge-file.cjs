const crypto = require("node:crypto");
const fsNative = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { migrateKnowledgeAssets, readKnowledgeAssetFiles } = require("./knowledge-assets.cjs");
const { imageReferences } = require("../renderer/src/knowledge-core.js");

const saveQueues = new Map();

function createFsOperations(overrides = {}) {
  return {
    lstat: overrides.lstat || ((...args) => fs.lstat(...args)),
    realpath: overrides.realpath || ((...args) => fs.realpath(...args)),
    mkdir: overrides.mkdir || ((...args) => fs.mkdir(...args)),
    open: overrides.open || ((...args) => fs.open(...args)),
    readFile: overrides.readFile || ((...args) => fs.readFile(...args)),
    readdir: overrides.readdir || ((...args) => fs.readdir(...args)),
    rename: overrides.rename || ((...args) => fs.rename(...args)),
    rm: overrides.rm || ((...args) => fs.rm(...args)),
    stat: overrides.stat || ((...args) => fs.stat(...args)),
    writeFile: overrides.writeFile || ((...args) => fs.writeFile(...args)),
    access: overrides.access || ((...args) => fs.access(...args)),
  };
}

function sanitizeFileName(value, fallback = "未命名知识笔记") {
  let name = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 90)
    .replace(/[. ]+$/g, "");
  if (!name) name = fallback;
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(name)) name = `-${name}`;
  return name;
}

function defaultMarkdownFileName(title) {
  const name = sanitizeFileName(title);
  return name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
}

function ensureMarkdownExtension(filePath) {
  const normalized = path.resolve(String(filePath || ""));
  return normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
}

function canonicalFilePath(filePath, platform = process.platform) {
  const pathApi = platform === "win32" ? path.win32 : path;
  const resolved = pathApi.resolve(String(filePath || ""));
  const normalized = resolved.replaceAll("\\", "/").replace(/\/$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizeMarkdownContent(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

function fileError(error, filePath, operation = "read") {
  return {
    canceled: false,
    success: false,
    code: "FILE_READ_FAILED",
    errorCode: error?.code || "UNKNOWN",
    operation,
    filePath,
    message: saveErrorMessage(error),
  };
}

async function recoverInterruptedReplacement(filePath, fsOps) {
  try {
    await fsOps.access(filePath);
    return false;
  } catch (error) {
    if (error?.code !== "ENOENT") return false;
  }

  let entries;
  try {
    entries = await fsOps.readdir(path.dirname(filePath));
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  // Only replace-file backups written by this app (name.bak-<pid>-<uuid>) may be
  // restored. A user's own copy such as `note.md.bak-manual` must never be moved
  // onto the document path.
  const backupPrefix = `${path.basename(filePath)}.bak-`;
  const backups = entries
    .map((entry) => String(entry))
    .filter((entry) => entry.startsWith(backupPrefix) && /^\d+-[0-9a-f-]{36}$/i.test(entry.slice(backupPrefix.length)))
    .sort()
    .reverse();
  for (const backupName of backups) {
    try {
      await fsOps.rename(path.join(path.dirname(filePath), backupName), filePath);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      if (error?.code === "EEXIST") return false;
      throw error;
    }
  }
  return false;
}

async function readKnowledgeDocument(filePath, { fsOps: injectedFsOps } = {}) {
  const normalizedPath = ensureMarkdownExtension(filePath);
  const fsOps = createFsOperations(injectedFsOps);
  try {
    await recoverInterruptedReplacement(normalizedPath, fsOps);
    const rawBuffer = await fsOps.readFile(normalizedPath);
    const rawBytes = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(String(rawBuffer || ""), "utf8");
    const rawContent = rawBytes.toString("utf8");
    // Loose UTF-8 decoding replaces undecodable bytes with U+FFFD; saving the
    // re-encoded text would rewrite the original bytes. Tell the caller so the
    // file is protected instead of silently transcoded.
    const unsupportedEncoding = !Buffer.from(rawContent, "utf8").equals(rawBytes);
    // Preserve source bytes, including line separators. Hash the same text we
    // return so a formatting-only external change is also a real CAS conflict.
    const content = rawContent;
    const stats = await fsOps.stat(normalizedPath);
    const assetRead = await readKnowledgeAssetFiles(normalizedPath, content, { fsOps });
    let readOnly = false;
    try {
      await fsOps.access(normalizedPath, fsNative.constants.W_OK);
    } catch (error) {
      if (["EACCES", "EPERM", "EROFS"].includes(error?.code)) readOnly = true;
      else throw error;
    }
    const lastSavedHash = crypto.createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
    return {
      canceled: false,
      success: true,
      filePath: normalizedPath,
      content,
      lastSavedHash,
      lastSavedMtime: stats.mtimeMs,
      encoding: "UTF-8",
      lineEnding: rawContent.includes("\r\n") ? "CRLF" : "LF",
      readOnly,
      unsupportedEncoding,
      assetFiles: assetRead.assetFiles,
      missingAssetFiles: assetRead.missingAssetFiles,
    };
  } catch (error) {
    return fileError(error, normalizedPath);
  }
}

async function chooseKnowledgeDocument({ dialog, parent = null, boundPaths = [], platform = process.platform, purpose = 'open' } = {}) {
  if (!dialog?.showOpenDialog) throw new Error("Open dialog is unavailable.");
  const options = {
    title: purpose === 'relocate' ? "重新定位知识笔记" : "打开知识笔记",
    properties: ["openFile"],
    filters: [{ name: "Markdown", extensions: ["md"] }],
  };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const filePath = ensureMarkdownExtension(result.filePaths[0]);
  if (hasDuplicateBinding(filePath, boundPaths, platform)) {
    return { canceled: false, success: false, code: "DUPLICATE_BINDING", filePath };
  }
  return readKnowledgeDocument(filePath);
}

function hasDuplicateBinding(filePath, boundPaths = [], platform = process.platform) {
  const target = canonicalFilePath(filePath, platform);
  return boundPaths.some((candidate) => canonicalFilePath(candidate, platform) === target);
}

function temporaryFilePath(filePath) {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  );
}

function isExistingTargetError(error) {
  return ["EEXIST", "ENOTEMPTY", "EPERM"].includes(error?.code);
}

async function removeTemporaryFile(filePath, fsOps) {
  if (!filePath) return;
  try {
    await fsOps.rm(filePath, { force: true });
  } catch {
    // A failed cleanup must not hide the original save error.
  }
}

async function replaceFile(tempPath, targetPath, { fsOps, platform }) {
  if (platform !== "win32") {
    await fsOps.rename(tempPath, targetPath);
    return "atomic-rename";
  }

  // Node's portable rename API does not overwrite an existing Windows file.
  // Try the simple path first, then use a same-directory backup/rollback so
  // a failed replacement never truncates the existing document.
  try {
    await fsOps.rename(tempPath, targetPath);
    return "atomic-rename";
  } catch (error) {
    if (!isExistingTargetError(error)) throw error;
  }

  const backupPath = `${targetPath}.bak-${process.pid}-${crypto.randomUUID()}`;
  let originalMoved = false;
  try {
    await fsOps.rename(targetPath, backupPath);
    originalMoved = true;
    await fsOps.rename(tempPath, targetPath);
  } catch (error) {
    if (originalMoved) {
      try {
        await fsOps.rename(backupPath, targetPath);
      } catch (restoreError) {
        error.restoreError = restoreError;
      }
    }
    throw error;
  }

  await removeTemporaryFile(backupPath, fsOps);
  return "windows-backup-replace";
}

async function atomicWriteFile(filePath, content, { fsOps, platform, beforeReplace } = {}) {
  const tempPath = temporaryFilePath(filePath);
  let handle = null;
  // Keep the existing access mode: an atomic replace must not silently turn a
  // shared 0644 document into 0600.
  let mode = null;
  try {
    const stats = await fsOps.stat(filePath);
    if (stats) mode = stats.mode & 0o777;
  } catch {
    // A new file keeps the secure default.
  }
  try {
    handle = await fsOps.open(tempPath, "wx", mode === null ? 0o600 : mode);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    if (mode !== null) {
      try {
        await handle.chmod(mode);
      } catch {
        // Best effort: some platforms do not expose POSIX modes.
      }
    }
    await handle.close();
    handle = null;
    // The hash was checked before the attachments and the temp write. Check it
    // once more immediately before the rename so an external write in that
    // window is reported instead of overwritten.
    if (beforeReplace) await beforeReplace();
    const replacement = await replaceFile(tempPath, filePath, { fsOps, platform });
    return { replacement };
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Preserve the original write/replace error.
      }
    }
    await removeTemporaryFile(tempPath, fsOps);
    throw error;
  }
}

// Relative image destinations that live next to the Markdown file.
function relativeImageDestinations(content) {
  return imageReferences(content).flatMap(({ url }) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(url)) return [];
    try {
      return [decodeURIComponent(url.split('#')[0])];
    } catch {
      return [];
    }
  });
}

function assertAssetInsideDirectory(root, filePath) {
  const relative = path.relative(root, filePath);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw Object.assign(new Error("附件路径超出笔记目录，已停止复制"), { code: "ASSET_PATH_OUTSIDE_NOTE" });
  }
}

async function assetDestinationDirectory(root, directory, fsOps) {
  // Check the existing ancestor before recursive mkdir can follow a symlink.
  let ancestor = directory;
  while (true) {
    try {
      assertAssetInsideDirectory(root, await fsOps.realpath(ancestor));
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  await fsOps.mkdir(directory, { recursive: true });
  const resolved = await fsOps.realpath(directory);
  assertAssetInsideDirectory(root, resolved);
  return resolved;
}

// "Save as" into another directory must carry the note's own attachments so the
// copy is not a document full of broken images. Relative destinations keep their
// path, so the Markdown itself does not change (KN-11).
async function copyRelativeAssets(content, sourceFilePath, targetPath, fsOps) {
  const destinations = new Set(relativeImageDestinations(content));
  if (!destinations.size) return [];
  let sourceDir;
  try {
    sourceDir = await fsOps.realpath(path.dirname(String(sourceFilePath)));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const targetDir = await fsOps.realpath(path.dirname(targetPath));
  const copied = [];
  if (sourceDir === targetDir) return copied;
  try {
    for (const destination of destinations) {
      const from = path.resolve(sourceDir, destination);
      const to = path.resolve(targetDir, destination);
      assertAssetInsideDirectory(sourceDir, from);
      assertAssetInsideDirectory(targetDir, to);
      let bytes;
      try {
        const source = await fsOps.realpath(from);
        assertAssetInsideDirectory(sourceDir, source);
        bytes = await fsOps.readFile(source);
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "EISDIR") continue;
        throw error;
      }
      const directory = await assetDestinationDirectory(targetDir, path.dirname(to), fsOps);
      const filePath = path.join(directory, path.basename(to));
      let handle;
      try {
        handle = await fsOps.open(filePath, "wx", 0o600);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existingPath = await fsOps.realpath(filePath);
        assertAssetInsideDirectory(targetDir, existingPath);
        const existing = await fsOps.readFile(existingPath);
        if (!Buffer.from(existing).equals(Buffer.from(bytes))) {
          throw Object.assign(new Error("目标目录存在内容不同的同名附件，请选择其他保存位置"), { code: "ASSET_ALREADY_EXISTS" });
        }
        continue;
      }
      copied.push(filePath);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    return copied;
  } catch (error) {
    await Promise.all(copied.map(filePath => removeTemporaryFile(filePath, fsOps)));
    throw error;
  }
}

function saveErrorMessage(error) {
  switch (error?.code) {
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return "文件或目录不可写";
    case "ENOSPC":
      return "磁盘空间不足";
    case "ENOENT":
      return "文件或目录不可用";
    case "EIO":
      return "磁盘 I/O 操作失败";
    default:
      return error?.message || "未知文件错误";
  }
}

function saveFailure(error, filePath, operation = "save") {
  return {
    canceled: false,
    success: false,
    code: "SAVE_FAILED",
    errorCode: error?.code || "UNKNOWN",
    operation,
    filePath,
    message: saveErrorMessage(error),
  };
}

function assetMigrationFailure(error, filePath) {
  return {
    canceled: false,
    success: false,
    code: "ASSET_MIGRATION_FAILED",
    errorCode: error?.code || "UNKNOWN",
    operation: "asset-migration",
    filePath,
    message: saveErrorMessage(error),
  };
}

function enqueueSave(key, operation) {
  const previous = saveQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  saveQueues.set(key, current);
  return current.finally(() => {
    if (saveQueues.get(key) === current) saveQueues.delete(key);
  });
}

async function saveKnowledgeDocument(payload, {
  dialog,
  parent = null,
  platform = process.platform,
  fsOps: injectedFsOps,
} = {}) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  let filePath = safePayload.filePath ? String(safePayload.filePath) : "";
  if (!filePath || safePayload.saveAs === true) {
    if (!dialog?.showSaveDialog) throw new Error("Save dialog is unavailable.");
    const options = {
      title: safePayload.saveAs === true ? "另存为知识笔记" : "保存知识笔记",
      defaultPath: defaultMarkdownFileName(safePayload.title),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    };
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };
    filePath = result.filePath;
  }

  filePath = ensureMarkdownExtension(filePath);
  if (hasDuplicateBinding(filePath, safePayload.boundPaths, platform)) {
    return { canceled: false, success: false, code: "DUPLICATE_BINDING", filePath };
  }

  const content = String(safePayload.content ?? "");
  const fsOps = createFsOperations(injectedFsOps);
  const queueKey = canonicalFilePath(filePath, platform);
  const save = async () => {
    let copiedAssets = [];
    let committed = false;
    try {
      // Write through symlinks so the link itself survives; replacing the link
      // path would turn a symlink into an ordinary file (KN-13).
      let targetPath = filePath;
      try {
        const linkStats = await fsOps.lstat(filePath);
        if (linkStats?.isSymbolicLink()) targetPath = await fsOps.realpath(filePath);
      } catch {
        // Missing target: the save creates it.
      }
      // An existing file that is not writable must not be bypassed by replacing
      // its directory entry: report READ_ONLY and keep the original untouched.
      try {
        await fsOps.access(targetPath, fsNative.constants.W_OK);
      } catch (error) {
        if (["EACCES", "EPERM", "EROFS"].includes(error?.code)) {
          return { canceled: false, success: false, code: "READ_ONLY", filePath, message: "文件不可写，请先在系统中恢复写入权限或另存为。" };
        }
        if (error?.code !== "ENOENT") throw error;
      }
      if (safePayload.expectedLastSavedHash && safePayload.allowExternalOverwrite !== true) {
        const currentFile = await readKnowledgeDocument(targetPath, { fsOps });
        if (!currentFile?.success) return currentFile;
        if (currentFile.lastSavedHash !== safePayload.expectedLastSavedHash) {
          return {
            canceled: false,
            success: false,
            code: "EXTERNAL_CHANGE_REQUIRES_CONFIRMATION",
            filePath,
            lastSavedHash: currentFile.lastSavedHash,
            lastSavedMtime: currentFile.lastSavedMtime,
            message: "文件已被外部修改，请先重新加载、明确覆盖或另存为。",
          };
        }
      }
      await fsOps.mkdir(path.dirname(targetPath), { recursive: true });
      // Refuse to transcode a document whose original bytes are not valid UTF-8.
      try {
        const existing = await fsOps.readFile(targetPath);
        const bytes = Buffer.isBuffer(existing) ? existing : Buffer.from(String(existing || ""), "utf8");
        if (!Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)) {
          return { canceled: false, success: false, code: "UNSUPPORTED_ENCODING", filePath, message: "文件含非 UTF-8 字节，保存会改写原始字节；请另存为或先转码。" };
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      // Copy only after validating the destination Markdown. Existing assets
      // are reused only when byte-identical and never enter the rollback list.
      if (safePayload.sourceFilePath) {
        try {
          copiedAssets = await copyRelativeAssets(content, String(safePayload.sourceFilePath), targetPath, fsOps);
        } catch (error) {
          return { canceled: false, success: false, code: "ASSET_MIGRATION_FAILED", errorCode: error?.code || "UNKNOWN", filePath, message: `附件复制失败：${saveErrorMessage(error)}` };
        }
      }
      let migrated = { content, assetFiles: [], attachmentsDirectory: null };
      if (Array.isArray(safePayload.assets) && safePayload.assets.length) {
        try {
          migrated = await migrateKnowledgeAssets(targetPath, content, safePayload.assets, { fsOps });
        } catch (error) {
          return assetMigrationFailure(error, filePath);
        }
      }
      let written;
      try {
        written = await atomicWriteFile(targetPath, migrated.content, {
          fsOps,
          platform,
          beforeReplace: async () => {
            if (!safePayload.expectedLastSavedHash || safePayload.allowExternalOverwrite === true) return;
            const current = await readKnowledgeDocument(targetPath, { fsOps });
            if (!current?.success) throw Object.assign(new Error(current?.message || "文件在保存提交前不可用"), { code: "EXTERNAL_CHANGE_BEFORE_COMMIT" });
            if (current.lastSavedHash !== safePayload.expectedLastSavedHash) {
              throw Object.assign(new Error("文件在保存提交前被外部修改"), { code: "EXTERNAL_CHANGE_BEFORE_COMMIT" });
            }
          },
        });
      } catch (error) {
        // The Markdown never landed: remove attachments this save created so no
        // unreferenced file is left behind (pre-existing assets are kept).
        if (Array.isArray(migrated.createdFiles) && migrated.createdFiles.length) {
          await Promise.all(migrated.createdFiles.map((created) => removeTemporaryFile(created, fsOps)));
        }
        if (error?.code === "EXTERNAL_CHANGE_BEFORE_COMMIT") {
          return { canceled: false, success: false, code: "EXTERNAL_CHANGE_REQUIRES_CONFIRMATION", filePath, message: error.message };
        }
        throw error;
      }
      committed = true;
      const { replacement } = written;
      const stats = await fsOps.stat(targetPath);
      const lastSavedHash = crypto.createHash("sha256").update(Buffer.from(migrated.content, "utf8")).digest("hex");
      return {
        canceled: false,
        success: true,
        filePath,
        content: migrated.content,
        assetFiles: migrated.assetFiles,
        attachmentsDirectory: migrated.attachmentsDirectory,
        lastSavedHash,
        lastSavedMtime: stats.mtimeMs,
        encoding: "UTF-8",
        lineEnding: migrated.content.includes("\r\n") ? "CRLF" : "LF",
        atomic: true,
        replacement,
      };
    } catch (error) {
      return saveFailure(error, filePath);
    } finally {
      if (!committed) {
        await Promise.all(copiedAssets.map(filePath => removeTemporaryFile(filePath, fsOps)));
      }
    }
  };
  // A failed Save As must finish rolling back before another Save As can reuse
  // the files it created. Ordinary per-document saves retain their own queue.
  return enqueueSave(queueKey, () => safePayload.sourceFilePath ? enqueueSave("relative-assets", save) : save());
}

module.exports = {
  canonicalFilePath,
  defaultMarkdownFileName,
  ensureMarkdownExtension,
  hasDuplicateBinding,
  normalizeMarkdownContent,
  sanitizeFileName,
  readKnowledgeDocument,
  chooseKnowledgeDocument,
  atomicWriteFile,
  replaceFile,
  saveKnowledgeDocument,
  temporaryFilePath,
};

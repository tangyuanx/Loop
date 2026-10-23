const crypto = require("node:crypto");
const fsNative = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { migrateKnowledgeAssets, readKnowledgeAssetFiles } = require("./knowledge-assets.cjs");

const saveQueues = new Map();

function createFsOperations(overrides = {}) {
  return {
    mkdir: overrides.mkdir || ((...args) => fs.mkdir(...args)),
    open: overrides.open || ((...args) => fs.open(...args)),
    readFile: overrides.readFile || ((...args) => fs.readFile(...args)),
    readdir: overrides.readdir || ((...args) => fs.readdir(...args)),
    rename: overrides.rename || ((...args) => fs.rename(...args)),
    rm: overrides.rm || ((...args) => fs.rm(...args)),
    stat: overrides.stat || ((...args) => fs.stat(...args)),
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

  const backupPrefix = `${path.basename(filePath)}.bak-`;
  const backups = entries
    .map((entry) => String(entry))
    .filter((entry) => entry.startsWith(backupPrefix))
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
    const rawContent = Buffer.isBuffer(rawBuffer) ? rawBuffer.toString("utf8") : String(rawBuffer || "");
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
      assetFiles: assetRead.assetFiles,
      missingAssetFiles: assetRead.missingAssetFiles,
    };
  } catch (error) {
    return fileError(error, normalizedPath);
  }
}

async function chooseKnowledgeDocument({ dialog, parent = null, boundPaths = [], platform = process.platform } = {}) {
  if (!dialog?.showOpenDialog) throw new Error("Open dialog is unavailable.");
  const options = {
    title: "重新定位知识笔记",
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

async function atomicWriteFile(filePath, content, { fsOps, platform }) {
  const tempPath = temporaryFilePath(filePath);
  let handle = null;
  try {
    handle = await fsOps.open(tempPath, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
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
  return enqueueSave(queueKey, async () => {
    try {
      if (safePayload.expectedLastSavedHash && safePayload.allowExternalOverwrite !== true) {
        const currentFile = await readKnowledgeDocument(filePath, { fsOps });
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
      await fsOps.mkdir(path.dirname(filePath), { recursive: true });
      let migrated = { content, assetFiles: [], attachmentsDirectory: null };
      if (Array.isArray(safePayload.assets) && safePayload.assets.length) {
        try {
          migrated = await migrateKnowledgeAssets(filePath, content, safePayload.assets, { fsOps });
        } catch (error) {
          return assetMigrationFailure(error, filePath);
        }
      }
      const { replacement } = await atomicWriteFile(filePath, migrated.content, { fsOps, platform });
      const stats = await fsOps.stat(filePath);
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
    }
  });
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

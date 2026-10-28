/**
 * Loop -- knowledge note path gate
 *
 * The renderer decides which Markdown file a knowledge note is bound to, but it
 * must not be able to point the main process at an arbitrary path on disk.
 * A file operation is therefore only allowed when the path
 *   - is already bound to a note in the persisted task data (the user picked it
 *     through a native dialog at some point), or
 *   - was explicitly picked through a native dialog in this session, or
 *   - is a managed recovery asset that this application wrote itself.
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const RECOVERY_ASSETS_DIR = "knowledge-note-recovery";

/**
 * Normalize a path the same way on both sides of the IPC boundary.
 * Empty input stays empty instead of resolving to the working directory.
 */
function canonicalPath(value, platform = process.platform) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const pathApi = platform === "win32" ? path.win32 : path;
  const normalized = pathApi.resolve(raw).replaceAll("\\", "/").replace(/\/+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** Collect the Markdown files the user has bound to notes in task-data.json. */
function boundFilePaths(taskData) {
  const tasks = Array.isArray(taskData?.tasks) ? taskData.tasks : [];
  return [...tasks, ...(Array.isArray(taskData?.knowledgeDocuments) ? taskData.knowledgeDocuments : [])]
    .map((task) => task?.knowledgeNote?.filePath)
    .filter((filePath) => typeof filePath === "string" && filePath.trim().length > 0);
}

/** Collect the recovery asset paths referenced by a save payload. */
function assetSourcePaths(payload) {
  const assets = Array.isArray(payload?.assets) ? payload.assets : [];
  return assets
    .map((asset) => asset?.sourcePath || asset?.filePath)
    .filter((sourcePath) => typeof sourcePath === "string" && sourcePath.trim().length > 0);
}

function deniedPathResult(filePath, operation = "read") {
  return {
    canceled: false,
    success: false,
    code: "PATH_NOT_ALLOWED",
    errorCode: "PATH_NOT_ALLOWED",
    operation,
    filePath: String(filePath || ""),
    message: "该文件未绑定到任何任务的 Markdown 笔记，已阻止访问。",
  };
}

function createKnowledgePathGate({
  userDataPath,
  dataFilePath,
  platform = process.platform,
  fileSystem = fs,
} = {}) {
  const approvedPaths = new Set();
  const recoveryRoot = canonicalPath(path.join(String(userDataPath || ""), RECOVERY_ASSETS_DIR), platform);
  let cache = { signature: null, paths: new Set() };

  async function persistedPaths() {
    let signature = "unavailable";
    try {
      const stats = await fileSystem.stat(dataFilePath);
      signature = `${stats.mtimeMs}:${stats.size}`;
    } catch {
      // A missing or unreadable database simply yields no persisted bindings.
    }
    if (cache.signature !== signature) {
      let paths = [];
      try {
        paths = boundFilePaths(JSON.parse(await fileSystem.readFile(dataFilePath, "utf8")));
      } catch {
        paths = [];
      }
      cache = { signature, paths: new Set(paths.map((value) => canonicalPath(value, platform))) };
    }
    return cache.paths;
  }

  /** Remember a path the user just picked through a native dialog. */
  function approve(filePath) {
    const value = canonicalPath(filePath, platform);
    if (value) approvedPaths.add(value);
    return value;
  }

  async function isAllowed(filePath) {
    const value = canonicalPath(filePath, platform);
    if (!value) return false;
    if (approvedPaths.has(value)) return true;
    return (await persistedPaths()).has(value);
  }

  /** Recovery assets are written by this application, never by the renderer. */
  function isRecoveryAssetPath(filePath) {
    const value = canonicalPath(filePath, platform);
    if (!value || !recoveryRoot) return false;
    return value === recoveryRoot || value.startsWith(`${recoveryRoot}/`);
  }

  return {
    approve,
    assetSourcePaths,
    canonical: (value) => canonicalPath(value, platform),
    isAllowed,
    isRecoveryAssetPath,
    persistedPaths,
  };
}

module.exports = {
  RECOVERY_ASSETS_DIR,
  assetSourcePaths,
  boundFilePaths,
  canonicalPath,
  createKnowledgePathGate,
  deniedPathResult,
};

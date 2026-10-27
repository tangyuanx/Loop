const fs = require("node:fs");
const path = require("node:path");
const {
  canonicalFilePath,
  readKnowledgeDocument,
} = require("./knowledge-file.cjs");

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_READ_TIMEOUT_MS = 5000;

function createKnowledgeFileWatcher({
  debounceMs = DEFAULT_DEBOUNCE_MS,
  readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
  fsApi = fs,
  fileReader = readKnowledgeDocument,
  onChange = () => {},
  platform = process.platform,
} = {}) {
  const entries = new Map();

  function emit(event) {
    try {
      onChange(event);
    } catch {
      // A renderer listener must not stop file monitoring for other notes.
    }
  }

  function clearEntryTimer(entry) {
    if (!entry.timer) return;
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  function closeEntry(entry) {
    clearEntryTimer(entry);
    try {
      entry.watcher?.close();
    } catch {
      // The watcher may already be closed after a rename event.
    }
    entry.watcher = null;
    if (entry.pollListener) {
      fsApi.unwatchFile?.(entry.filePath, entry.pollListener);
      entry.pollListener = null;
    }
  }

  function unwatch(noteId) {
    const entry = entries.get(noteId);
    if (!entry) return false;
    closeEntry(entry);
    entries.delete(noteId);
    return true;
  }

  function emitUnavailable(entry, error) {
    emit({
      type: "file-unavailable",
      noteId: entry.noteId,
      filePath: entry.filePath,
      errorCode: error?.code || "UNKNOWN",
      message: error?.message || "文件不可用",
    });
  }

  async function inspect(entry) {
    entry.timer = null;
    if (entries.get(entry.noteId) !== entry) return;
    let result;
    try {
      let timeout;
      try {
        result = await Promise.race([
          fileReader(entry.filePath),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(Object.assign(new Error("文件读取超时"), { code: "ETIMEDOUT" })), Math.max(1, readTimeoutMs));
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    } catch (error) {
      if (entries.get(entry.noteId) === entry) emitUnavailable(entry, error);
      return;
    }
    if (entries.get(entry.noteId) !== entry) return;

    if (!result?.success) {
      const missing = ["ENOENT", "ENOTDIR"].includes(result?.errorCode);
      const readOnly = ["EACCES", "EPERM", "EROFS"].includes(result?.errorCode);
      if (missing) {
        emit({
          type: "file-missing",
          noteId: entry.noteId,
          filePath: entry.filePath,
          errorCode: result?.errorCode || "UNKNOWN",
          message: result?.message || "文件不存在",
        });
      } else if (readOnly) {
        emit({
          type: "read-only",
          noteId: entry.noteId,
          filePath: entry.filePath,
          errorCode: result?.errorCode || "UNKNOWN",
          message: result?.message || "文件只读",
        });
      } else {
        emitUnavailable(entry, { code: result?.errorCode, message: result?.message });
      }
      return;
    }

    const sameContent = !entry.lastSavedHash || result.lastSavedHash === entry.lastSavedHash;
    if (sameContent) {
      entry.lastSavedHash = result.lastSavedHash;
      entry.lastSavedMtime = result.lastSavedMtime;
      if (result.readOnly) {
        emit({
          type: "read-only",
          noteId: entry.noteId,
          filePath: entry.filePath,
          ...result,
        });
      } else {
        emit({
          type: "baseline",
          noteId: entry.noteId,
          filePath: entry.filePath,
          ...result,
        });
      }
      return;
    }

    emit({
      type: "external-changed",
      noteId: entry.noteId,
      filePath: entry.filePath,
      ...result,
    });
  }

  function schedule(entry, delay = debounceMs) {
    if (entries.get(entry.noteId) !== entry) return;
    clearEntryTimer(entry);
    entry.timer = setTimeout(() => {
      void inspect(entry);
    }, Math.max(0, delay));
  }

  function watch({ noteId, filePath, lastSavedHash = null, lastSavedMtime = null } = {}) {
    const normalizedNoteId = String(noteId || "").trim();
    const normalizedPath = String(filePath || "").trim();
    if (!normalizedNoteId || !normalizedPath) return { success: false, code: "INVALID_WATCH_TARGET" };

    unwatch(normalizedNoteId);
    const entry = {
      noteId: normalizedNoteId,
      filePath: normalizedPath,
      canonicalPath: canonicalFilePath(normalizedPath, platform),
      lastSavedHash: lastSavedHash || null,
      lastSavedMtime: lastSavedMtime ?? null,
      watcher: null,
      timer: null,
    };
    entries.set(normalizedNoteId, entry);
    const watchedDirectory = path.dirname(normalizedPath);
    const watchedName = path.basename(normalizedPath);
    try {
      // Watch the parent directory instead of the file itself: editors save with
      // an atomic rename, which leaves a watch bound to the old inode silent
      // forever and lets the next in-app save overwrite the external change.
      entry.watcher = fsApi.watch(watchedDirectory, { persistent: false }, (_eventType, changedName) => {
        if (changedName && String(changedName) !== watchedName) return;
        schedule(entry);
      });
      if (typeof entry.watcher?.on === "function") {
        entry.watcher.on("error", (error) => {
          if (entries.get(normalizedNoteId) === entry) emitUnavailable(entry, error);
        });
      }
      // Directory notifications can be dropped by removable/network volumes
      // and restricted macOS environments. Stat polling follows replacement
      // inodes as well; it reads document contents only after metadata changes.
      if (typeof fsApi.watchFile === "function" && typeof fsApi.unwatchFile === "function") {
        entry.pollListener = (current, previous) => {
          if (current.mtimeMs !== previous.mtimeMs || current.ctimeMs !== previous.ctimeMs
            || current.size !== previous.size || current.ino !== previous.ino) schedule(entry);
        };
        fsApi.watchFile(normalizedPath, { persistent: false, interval: 1000 }, entry.pollListener);
      }
    } catch (error) {
      closeEntry(entry);
      entries.delete(normalizedNoteId);
      const missing = ["ENOENT", "ENOTDIR"].includes(error?.code);
      emit({
        type: missing ? "file-missing" : "file-unavailable",
        noteId: normalizedNoteId,
        filePath: normalizedPath,
        errorCode: error?.code || "UNKNOWN",
        message: error?.message || "文件不可用",
      });
      return { success: false, code: missing ? "FILE_MISSING" : "WATCH_FAILED", errorCode: error?.code || "UNKNOWN" };
    }
    schedule(entry, 0);
    return { success: true, noteId: normalizedNoteId, filePath: normalizedPath };
  }

  function updateBaseline(noteId, baseline = {}) {
    const entry = entries.get(noteId);
    if (!entry) return false;
    const nextPath = String(baseline.filePath || entry.filePath).trim();
    if (canonicalFilePath(nextPath, platform) !== entry.canonicalPath) {
      return watch({ noteId, ...baseline, filePath: nextPath });
    }
    entry.lastSavedHash = baseline.lastSavedHash || entry.lastSavedHash;
    entry.lastSavedMtime = baseline.lastSavedMtime ?? entry.lastSavedMtime;
    return true;
  }

  function closeAll() {
    for (const noteId of entries.keys()) unwatch(noteId);
  }

  return Object.freeze({
    closeAll,
    updateBaseline,
    unwatch,
    watch,
    get size() {
      return entries.size;
    },
  });
}

module.exports = {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_READ_TIMEOUT_MS,
  createKnowledgeFileWatcher,
};

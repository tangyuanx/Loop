const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { packImageText, syncDirectory, unpackImageText } = require("./image-store.cjs");
const { DATA_VERSION, readOnDiskDataVersion } = require("./storage.cjs");
const knowledgeRecovery = require("../renderer/src/knowledge-recovery.js");

const RECOVERY_FILE = "knowledge-note-recovery.json";
const IMAGE_RECOVERY_VERSION = 2;
let writeQueue = Promise.resolve();

function recoveryFilePath(userDataPath) {
  return path.join(userDataPath, RECOVERY_FILE);
}

async function readKnowledgeRecovery(userDataPath, { fileSystem = fs, validateOnly = false } = {}) {
  let raw;
  try {
    raw = await fileSystem.readFile(recoveryFilePath(userDataPath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return knowledgeRecovery.normalizeRecoveryData({});
    throw error;
  }
  const invalid = (cause) => Object.assign(new Error("知识笔记恢复文件已损坏，已保留原文件。", { cause }), {
    code: "CORRUPT_KNOWLEDGE_RECOVERY",
  });
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw invalid(error);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || !parsed.records || typeof parsed.records !== "object" || Array.isArray(parsed.records)
    || Object.values(parsed.records).some(record => !record || typeof record !== "object" || Array.isArray(record))) {
    throw invalid();
  }
  if (Number(parsed.version) > IMAGE_RECOVERY_VERSION) {
    throw Object.assign(new Error("知识笔记恢复文件版本高于当前应用支持范围，已保留原文件。"), {
      code: "UNSUPPORTED_KNOWLEDGE_RECOVERY_VERSION",
    });
  }
  const usable = Number(parsed.version) === IMAGE_RECOVERY_VERSION
    ? await unpackImageText(userDataPath, parsed, { fileSystem, validateOnly })
    : parsed;
  return validateOnly ? parsed : knowledgeRecovery.normalizeRecoveryData(usable);
}

async function writeRecoveryData(userDataPath, data) {
  await fs.mkdir(userDataPath, { recursive: true });
  const filePath = recoveryFilePath(userDataPath);
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const normalized = knowledgeRecovery.normalizeRecoveryData(data);
  let persisted = normalized;
  // Older builds guard the task schema before editing. Keep the recovery file
  // compatible until the primary database has committed the matching version.
  if (await readOnDiskDataVersion(userDataPath) >= DATA_VERSION) {
    const { packed, usesImageStore } = await packImageText(userDataPath, normalized);
    if (usesImageStore) packed.version = IMAGE_RECOVERY_VERSION;
    persisted = packed;
  }
  const content = `${JSON.stringify(persisted, null, 2)}\n`;
  let handle = null;
  try {
    handle = await fs.open(tempPath, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, filePath);
    await syncDirectory(userDataPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function enqueueWrite(operation) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => {});
  return next;
}

function writeKnowledgeRecovery(userDataPath, value) {
  const record = knowledgeRecovery.normalizeRecoveryRecord(value);
  if (!record) throw new TypeError("A recovery record requires a noteId.");
  return enqueueWrite(async () => {
    const data = await readKnowledgeRecovery(userDataPath);
    data.records[record.noteId] = record;
    await writeRecoveryData(userDataPath, data);
    return record;
  });
}

function deleteKnowledgeRecovery(userDataPath, noteId) {
  const normalizedNoteId = String(noteId || "").trim();
  if (!normalizedNoteId) return Promise.resolve(false);
  return enqueueWrite(async () => {
    const data = await readKnowledgeRecovery(userDataPath);
    const existed = Boolean(data.records[normalizedNoteId]);
    delete data.records[normalizedNoteId];
    if (existed) await writeRecoveryData(userDataPath, data);
    return existed;
  });
}

module.exports = {
  RECOVERY_FILE,
  deleteKnowledgeRecovery,
  readKnowledgeRecovery,
  recoveryFilePath,
  waitForKnowledgeRecoveryWrites: () => writeQueue,
  writeKnowledgeRecovery,
};

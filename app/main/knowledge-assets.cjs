const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { imageReferences } = require("../renderer/src/knowledge-core.js");

const RECOVERY_ASSETS_DIR = "knowledge-note-recovery";
const ATTACHMENTS_DIR = "attachments";
const MIME_EXTENSIONS = Object.freeze({
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "image/webp": "webp",
});
const EXTENSION_MIME = Object.freeze(Object.fromEntries(
  Object.entries(MIME_EXTENSIONS).map(([mime, extension]) => [extension, mime]),
));

function createFsOperations(overrides = {}) {
  return {
    access: overrides.access || ((...args) => fs.access(...args)),
    realpath: overrides.realpath || ((...args) => fs.realpath(...args)),
    mkdir: overrides.mkdir || ((...args) => fs.mkdir(...args)),
    open: overrides.open || ((...args) => fs.open(...args)),
    readFile: overrides.readFile || ((...args) => fs.readFile(...args)),
    rename: overrides.rename || ((...args) => fs.rename(...args)),
    rm: overrides.rm || ((...args) => fs.rm(...args)),
  };
}

function normalizeText(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function imageDataUrl(value) {
  const source = normalizeText(value).trim();
  const match = source.match(/^data:(image\/[a-z0-9.+-]+)(;[^,]*)?,([\s\S]*)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!MIME_EXTENSIONS[mime]) return null;
  try {
    const body = match[2]?.toLowerCase().includes(";base64")
      ? Buffer.from(match[3], "base64")
      : Buffer.from(decodeURIComponent(match[3]), "utf8");
    if (!body.length) return null;
    return { dataUrl: source, mime, extension: MIME_EXTENSIONS[mime], buffer: body };
  } catch {
    return null;
  }
}

function noteIdDirectory(noteId) {
  return crypto.createHash("sha256").update(normalizeText(noteId).trim()).digest("hex").slice(0, 32);
}

function recoveryAssetsDirectory(userDataPath, noteId) {
  return path.join(userDataPath, RECOVERY_ASSETS_DIR, noteIdDirectory(noteId), "assets");
}

function formalAssetsDirectory(markdownPath) {
  return path.join(path.dirname(markdownPath), ATTACHMENTS_DIR);
}

function assetTempPath(filePath) {
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`);
}

async function removeFile(filePath, fsOps) {
  try {
    await fsOps.rm(filePath, { force: true });
  } catch {
    // Cleanup must not hide the original asset migration failure.
  }
}

async function writeAssetFile(filePath, buffer, fsOps) {
  try {
    await fsOps.access(filePath);
    return { reused: true };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const tempPath = assetTempPath(filePath);
  let handle = null;
  try {
    handle = await fsOps.open(tempPath, "wx", 0o600);
    await handle.writeFile(buffer);
    if (typeof handle.sync === "function") await handle.sync();
    await handle.close();
    handle = null;
    try {
      await fsOps.rename(tempPath, filePath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await removeFile(tempPath, fsOps);
      return { reused: true };
    }
    return { reused: false };
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Preserve the original write error.
      }
    }
    await removeFile(tempPath, fsOps);
    throw error;
  }
}

function normalizeAsset(value) {
  const raw = value && typeof value === "object" ? value : {};
  const source = normalizeText(raw.source).trim();
  const dataUrl = normalizeText(raw.dataUrl).trim();
  const sourcePath = normalizeText(raw.sourcePath || raw.filePath).trim();
  if (!source || (!dataUrl && !sourcePath)) return null;
  return { source, dataUrl, sourcePath };
}

async function stageKnowledgeAssets(userDataPath, { noteId, assets = [], fsOps: injectedFsOps } = {}) {
  const normalizedNoteId = normalizeText(noteId).trim();
  const normalizedAssets = Array.isArray(assets) ? assets.map(normalizeAsset).filter(Boolean) : [];
  if (!normalizedAssets.length) return { success: true, assets: [] };
  if (!normalizedNoteId) {
    return { success: false, code: "ASSET_STAGE_FAILED", errorCode: "INVALID_NOTE_ID", message: "知识笔记缺少资源归属标识" };
  }

  const fsOps = createFsOperations(injectedFsOps);
  const directory = recoveryAssetsDirectory(userDataPath, normalizedNoteId);
  try {
    await fsOps.mkdir(directory, { recursive: true });
    const result = [];
    for (const asset of normalizedAssets) {
      const parsed = imageDataUrl(asset.dataUrl);
      if (!parsed) continue;
      const digest = crypto.createHash("sha256").update(parsed.buffer).digest("hex").slice(0, 24);
      const fileName = `asset-${digest}.${parsed.extension}`;
      const filePath = path.join(directory, fileName);
      await writeAssetFile(filePath, parsed.buffer, fsOps);
      result.push({
        source: asset.source,
        dataUrl: parsed.dataUrl,
        fileName,
        filePath,
        recoveryDirectory: directory,
      });
    }
    return { success: true, noteId: normalizedNoteId, assets: result, recoveryDirectory: directory };
  } catch (error) {
    return {
      success: false,
      code: "ASSET_STAGE_FAILED",
      errorCode: error?.code || "UNKNOWN",
      message: error?.message || "恢复资源暂存失败",
      recoveryDirectory: directory,
    };
  }
}

async function readAssetBuffer(asset, fsOps) {
  if (!asset.sourcePath) {
    const parsed = imageDataUrl(asset.dataUrl);
    if (parsed) return parsed;
    throw Object.assign(new Error("资源文件不可用"), { code: "ENOENT" });
  }
  const buffer = await fsOps.readFile(asset.sourcePath);
  const extension = path.extname(asset.sourcePath).replace(/^\./, "").toLowerCase() || "bin";
  return {
    dataUrl: asset.dataUrl || "",
    extension: /^[a-z0-9]{1,8}$/.test(extension) ? extension : "bin",
    buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
  };
}

function mimeForExtension(extension) {
  return EXTENSION_MIME[normalizeText(extension).toLowerCase()] || "application/octet-stream";
}

async function readKnowledgeAssetFiles(markdownPath, content, { fsOps: injectedFsOps } = {}) {
  const references = new Set();
  imageReferences(normalizeText(content)).forEach((match) => {
    const reference = match.url;
    if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(reference)) return;
    let decoded;
    try { decoded = decodeURIComponent(reference); } catch { return; }
    const extension = path.extname(decoded).slice(1).toLowerCase();
    if (!EXTENSION_MIME[extension] && extension !== "jpeg") return;
    if (decoded.split(/[\\/]/).includes("..")) return;
    references.add(reference);
  });
  if (!references.size) return { assetFiles: [], missingAssetFiles: [] };
  const fsOps = createFsOperations(injectedFsOps);
  const result = [];
  const missingAssetFiles = [];
  for (const relativePath of references) {
    const decoded = decodeURIComponent(relativePath);
    const relativeName = path.basename(decoded);
    const filePath = path.resolve(path.dirname(markdownPath), decoded);
    try {
      const root = await fsOps.realpath(path.dirname(markdownPath));
      const real = await fsOps.realpath(filePath);
      const relative = path.relative(root, real);
      if (relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) continue;
      const buffer = await fsOps.readFile(filePath);
      const extension = path.extname(relativeName).replace(/^\./, "").toLowerCase();
      result.push({
        fileName: relativeName,
        filePath,
        relativePath,
        dataUrl: `data:${mimeForExtension(extension === "jpeg" ? "jpg" : extension)};base64,${Buffer.from(buffer).toString("base64")}`,
      });
    } catch (error) {
      missingAssetFiles.push({
        fileName: relativeName,
        filePath,
        relativePath,
        errorCode: error?.code || "UNKNOWN",
        message: error?.message || "附件不可用",
      });
    }
  }
  return { assetFiles: result, missingAssetFiles };
}

async function migrateKnowledgeAssets(markdownPath, content, assets = [], { fsOps: injectedFsOps } = {}) {
  const normalizedAssets = Array.isArray(assets) ? assets.map(normalizeAsset).filter(Boolean) : [];
  if (!normalizedAssets.length) return { content: normalizeText(content), assetFiles: [], attachmentsDirectory: null };

  const fsOps = createFsOperations(injectedFsOps);
  const directory = formalAssetsDirectory(markdownPath);
  await fsOps.mkdir(directory, { recursive: true });
  let migratedContent = normalizeText(content);
  const assetFiles = [];
  const createdFiles = [];
  const seenSources = new Set();
  try {
    for (const asset of normalizedAssets) {
      if (seenSources.has(asset.source)) continue;
      seenSources.add(asset.source);
      const parsed = await readAssetBuffer(asset, fsOps);
      const digest = crypto.createHash("sha256").update(parsed.buffer).digest("hex").slice(0, 24);
      const fileName = `asset-${digest}.${parsed.extension}`;
      const filePath = path.join(directory, fileName);
      const writeResult = await writeAssetFile(filePath, parsed.buffer, fsOps);
      if (!writeResult.reused) createdFiles.push(filePath);
      const relativePath = `./${ATTACHMENTS_DIR}/${fileName}`;
      for (const reference of imageReferences(migratedContent).filter((item) => item.url === asset.source).reverse()) {
        migratedContent = migratedContent.slice(0, reference.from) + relativePath + migratedContent.slice(reference.to);
      }
      assetFiles.push({
        source: asset.source,
        fileName,
        filePath,
        relativePath,
        dataUrl: parsed.dataUrl || asset.dataUrl || "",
      });
    }
  } catch (error) {
    await Promise.all(createdFiles.map((filePath) => removeFile(filePath, fsOps)));
    throw error;
  }

  return { content: migratedContent, assetFiles, attachmentsDirectory: directory };
}

module.exports = {
  ATTACHMENTS_DIR,
  RECOVERY_ASSETS_DIR,
  formalAssetsDirectory,
  imageDataUrl,
  migrateKnowledgeAssets,
  readKnowledgeAssetFiles,
  recoveryAssetsDirectory,
  stageKnowledgeAssets,
};

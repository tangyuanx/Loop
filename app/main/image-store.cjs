const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const IMAGE_ASSETS_DIR = "image-assets";
const IMAGE_TEXT_FIELD = "$loopImageText";
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
const IMAGE_FILE_NAME = /^([a-f0-9]{64})\.(avif|bmp|gif|jpg|png|svg|tiff|webp)$/;
const EMBEDDED_DATA_URL = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}/g;

function imageDataUrl(value) {
  const dataUrl = typeof value === "string" ? value.trim() : "";
  const match = /^data:(image\/[a-z0-9.+-]+)(;[^,]*)?,([\s\S]*)$/i.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const extension = MIME_EXTENSIONS[mime];
  if (!extension) return null;
  try {
    const buffer = match[2]?.toLowerCase().includes(";base64")
      ? Buffer.from(match[3], "base64")
      : Buffer.from(decodeURIComponent(match[3]), "utf8");
    return buffer.length ? { dataUrl, mime, extension, buffer } : null;
  } catch {
    return null;
  }
}

function digest(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function isImageFileName(value) {
  return typeof value === "string" && IMAGE_FILE_NAME.test(value);
}

function mimeForExtension(extension) {
  return EXTENSION_MIME[String(extension || "").toLowerCase()] || "application/octet-stream";
}

function imageError(code, message, cause) {
  return Object.assign(new Error(message, { cause }), { code });
}

function invalidImage() {
  return imageError("TASK_IMAGE_INVALID", "工作区图片索引或文件校验失败，已保留原始数据。");
}

async function imageDirectory(userDataPath, fileSystem, { create = false } = {}) {
  if (create) await fileSystem.mkdir(userDataPath, { recursive: true });
  const root = await fileSystem.realpath(userDataPath);
  const directory = path.join(root, IMAGE_ASSETS_DIR);
  if (create) await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await fileSystem.lstat(directory)).isDirectory()) throw invalidImage();
  return directory;
}

async function readImage(directory, fileName, fileSystem) {
  const match = IMAGE_FILE_NAME.exec(fileName);
  if (!match) throw invalidImage();
  const filePath = path.join(directory, fileName);
  if (!(await fileSystem.lstat(filePath)).isFile()) throw invalidImage();
  const buffer = await fileSystem.readFile(filePath);
  if (digest(buffer) !== match[1]) throw invalidImage();
  return buffer;
}

async function readStoredImage(filePath, fileSystem = fs) {
  const directory = path.dirname(filePath);
  if (!(await fileSystem.lstat(directory)).isDirectory()) throw invalidImage();
  return readImage(directory, path.basename(filePath).toLowerCase(), fileSystem);
}

async function syncDirectory(directory, fileSystem = fs) {
  // Windows does not expose a portable directory handle through fs.open.
  if (process.platform === "win32") return;
  const handle = await fileSystem.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function putImage(directory, fileName, buffer, fileSystem) {
  const filePath = path.join(directory, fileName);
  try {
    await readImage(directory, fileName, fileSystem);
    return filePath;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const temporary = `${filePath}.tmp-${crypto.randomUUID()}`;
  let handle;
  try {
    handle = await fileSystem.open(temporary, "wx", 0o600);
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      // Writers for the same content address only publish identical bytes.
      await fileSystem.rename(temporary, filePath);
    } catch (error) {
      if (!["EEXIST", "EPERM", "EACCES"].includes(error.code)) throw error;
      try { await readImage(directory, fileName, fileSystem); }
      catch (existingError) { throw existingError.code === "ENOENT" ? error : existingError; }
    }
    return filePath;
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fileSystem.rm(temporary, { force: true }).catch(() => {});
  }
}

async function storeImage(userDataPath, parsedImage, fileSystem = fs) {
  const directory = await imageDirectory(userDataPath, fileSystem, { create: true });
  const fileName = `${digest(parsedImage.buffer)}.${parsedImage.extension}`;
  await putImage(directory, fileName, parsedImage.buffer, fileSystem);
  await syncDirectory(directory, fileSystem);
  await syncDirectory(path.dirname(directory), fileSystem);
  return { fileName, filePath: path.join(userDataPath, IMAGE_ASSETS_DIR, fileName) };
}

function mapImageText(value, visit) {
  const replacement = visit(value);
  if (replacement !== value) return replacement;
  if (Array.isArray(value)) return value.map((item) => mapImageText(item, visit));
  if (value && typeof value === "object" && typeof value.toJSON !== "function") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapImageText(item, visit)]));
  }
  return value;
}

// Tagged fragments preserve the original text exactly, including inline images
// in archived tasks, node records, and Markdown examples. Legacy noncanonical
// data URLs remain inline because their spelling could be significant.
async function packImageText(userDataPath, value, fileSystem = fs) {
  const registered = new Map();
  const blobs = new Map();
  const packed = mapImageText(value, (text) => {
    if (text && typeof text === "object" && Object.hasOwn(text, IMAGE_TEXT_FIELD)) throw invalidImage();
    if (typeof text !== "string" || !text.includes("data:image/")) return text;
    const fragments = [];
    let end = 0;
    for (const match of text.matchAll(EMBEDDED_DATA_URL)) {
      const url = match[0];
      let fileName = registered.get(url);
      if (!fileName) {
        const parsed = imageDataUrl(url);
        if (!parsed || url !== `data:${parsed.mime};base64,${parsed.buffer.toString("base64")}`) continue;
        fileName = `${digest(parsed.buffer)}.${parsed.extension}`;
        registered.set(url, fileName);
        blobs.set(fileName, parsed.buffer);
      }
      fragments.push(text.slice(end, match.index), fileName);
      end = match.index + url.length;
    }
    if (!fragments.length) return text;
    fragments.push(text.slice(end));
    return { [IMAGE_TEXT_FIELD]: fragments };
  });
  if (!blobs.size) return { packed, usesImageStore: false };
  const directory = await imageDirectory(userDataPath, fileSystem, { create: true });
  for (const [fileName, buffer] of blobs) await putImage(directory, fileName, buffer, fileSystem);
  await syncDirectory(directory, fileSystem);
  await syncDirectory(path.dirname(directory), fileSystem);
  return { packed, usesImageStore: true };
}

function imageFragments(value) {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, IMAGE_TEXT_FIELD)) return null;
  const fragments = value[IMAGE_TEXT_FIELD];
  if (Object.keys(value).length !== 1 || !Array.isArray(fragments) || fragments.length < 3 || fragments.length % 2 !== 1
    || fragments.some((part, index) => index % 2 === 0 ? typeof part !== "string" : !isImageFileName(part))) {
    throw invalidImage();
  }
  return fragments;
}

async function unpackImageText(userDataPath, value, { fileSystem = fs, validateOnly = false } = {}) {
  const files = new Set();
  mapImageText(value, (item) => {
    const fragments = imageFragments(item);
    if (!fragments) return item;
    fragments.forEach((part, index) => { if (index % 2 === 1) files.add(part); });
    return null;
  });
  if (!files.size) return value;

  const dataUrls = new Map();
  try {
    const directory = await imageDirectory(userDataPath, fileSystem);
    for (const fileName of files) {
      const buffer = await readImage(directory, fileName, fileSystem);
      if (!validateOnly) dataUrls.set(fileName, `data:${mimeForExtension(path.extname(fileName).slice(1))};base64,${buffer.toString("base64")}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw imageError("TASK_IMAGE_MISSING", "工作区图片文件缺失，已保留原始数据。", error);
  }
  if (validateOnly) return value;
  return mapImageText(value, (item) => {
    const fragments = imageFragments(item);
    return fragments ? fragments.map((part, index) => index % 2 === 0 ? part : dataUrls.get(part)).join("") : item;
  });
}

module.exports = { IMAGE_ASSETS_DIR, imageDataUrl, isImageFileName, mimeForExtension, packImageText, readStoredImage, storeImage, syncDirectory, unpackImageText };

const { createHash, randomUUID } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const yazl = require('yazl');

const MiB = 1024 * 1024;
const limits = Object.freeze({ archive: 256 * MiB, total: 256 * MiB, asset: 32 * MiB,
  metadata: 4 * MiB, note: 4 * MiB, notesBytes: 32 * MiB, assets: 512, notes: 100,
  entries: 1024, nodes: 10000, depth: 32 });

function shareError(code, message) {
  return Object.assign(new Error(message), { code });
}

function assertShare(condition, code, message) {
  if (!condition) throw shareError(code, message);
}

function assertSize(size, maximum) {
  assertShare(Number.isSafeInteger(size) && size >= 0 && size <= maximum, 'SHARE_LIMIT', '文件或内容超出任务分享容量，请缩小分享范围。');
}

function writeArchive(destination, entries, signal) {
  const zip = new yazl.ZipFile();
  const writer = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  const done = pipeline(zip.outputStream, writer, { signal });
  zip.on('error', error => zip.outputStream.destroy(error));
  try {
    for (const entry of entries) {
      const options = { mtime: new Date(2000, 0, 1), mode: 0o100600 };
      if (entry.file) zip.addFile(entry.file, entry.name, options);
      else zip.addBuffer(entry.bytes, entry.name, options);
    }
    zip.end();
  } catch (error) {
    zip.outputStream.destroy(error);
  }
  return done;
}

async function readArchive(source, { directory, entryLimit, signal }) {
  signal?.throwIfAborted();
  const file = await fs.stat(source);
  assertShare(file.isFile(), 'SHARE_FORMAT', '请选择一个 Loop 任务包文件。');
  assertSize(file.size, limits.archive);
  const zip = await yauzl.openPromise(source, { strictFileNames: true, validateEntrySizes: true, lazyEntries: true });
  const entries = new Map();
  let total = 0;
  try {
    assertSize(zip.entryCount, limits.entries);
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      const name = entry.fileName;
      const ceiling = entryLimit(name);
      const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
      assertShare(ceiling && !entries.has(name) && (!unixType || unixType === 0o100000) && !entry.isEncrypted(),
        'SHARE_FORMAT', '任务包含有重复、未知或无法读取的文件条目。');
      assertSize(entry.uncompressedSize, ceiling);
      assertSize(total + entry.uncompressedSize, limits.total);
      const input = await zip.openReadStreamPromise(entry);
      const digest = createHash('sha256');
      const staged = path.join(directory, randomUUID());
      let size = 0;
      const meter = new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length;
        try {
          assertSize(size, Math.min(ceiling, entry.uncompressedSize));
          digest.update(chunk);
          callback(null, chunk);
        } catch (error) { callback(error); }
      } });
      await pipeline(input, meter, createWriteStream(staged, { flags: 'wx', mode: 0o600 }), { signal });
      assertShare(size === entry.uncompressedSize, 'SHARE_CORRUPT', '任务包的文件长度校验失败，请重新取得文件。');
      total += size;
      entries.set(name, { file: staged, size, sha256: digest.digest('hex') });
    }
    return entries;
  } finally {
    zip.close();
  }
}

async function stagedCopy(source, target, maximum, signal) {
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length;
    try { assertSize(size, maximum); hash.update(chunk); callback(null, chunk); }
    catch (error) { callback(error); }
  } });
  await pipeline(createReadStream(source), meter, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
  return { file: target, size, sha256: hash.digest('hex') };
}

async function atomicOutput(destination, write) {
  const temp = path.join(path.dirname(destination), `.loop-export-${randomUUID()}`);
  try {
    await write(temp);
    const handle = await fs.open(temp, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, destination);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

module.exports = { limits, shareError, assertShare, assertSize, writeArchive, readArchive, stagedCopy, atomicOutput };

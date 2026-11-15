const { createCipheriv, createDecipheriv, randomBytes, scrypt } = require("node:crypto");
const { createReadStream, createWriteStream } = require("node:fs");
const fs = require("node:fs/promises");
const { Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { promisify } = require("node:util");

const MAGIC = Buffer.from("LOOPBK2E");
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + NONCE_BYTES;
const TAG_BYTES = 16;
const deriveKey = promisify(scrypt);

function encryptionError(code, message, cause) {
  return Object.assign(new Error(message, { cause }), { code });
}

async function backupKey(password, salt) {
  if (typeof password !== "string" || !password || Buffer.byteLength(password, "utf8") > 1024) {
    throw encryptionError("BACKUP_PASSWORD_REQUIRED", "请填写此备份的密码（至多 1024 字节）。");
  }
  return deriveKey(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 ** 2 });
}

async function encryptBackup(source, destination, password) {
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const header = Buffer.concat([MAGIC, salt, nonce]);
  const key = await backupKey(password, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(header);
    await fs.writeFile(destination, header, { flag: "wx", mode: 0o600 });
    await pipeline(createReadStream(source), cipher, createWriteStream(destination, { flags: "a" }));
    await fs.appendFile(destination, cipher.getAuthTag());
  } finally {
    key.fill(0);
  }
}

async function decryptBackup(source, password, destination) {
  const handle = await fs.open(source, "r");
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  let size;
  try {
    const info = await handle.stat();
    size = info.size;
    if (!info.isFile() || size <= HEADER_BYTES + TAG_BYTES ||
        (await handle.read(header, 0, HEADER_BYTES, 0)).bytesRead !== HEADER_BYTES ||
        !header.subarray(0, MAGIC.length).equals(MAGIC) ||
        (await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES)).bytesRead !== TAG_BYTES) {
      throw encryptionError("BACKUP_ENCRYPTION_FORMAT", "加密备份文件不完整。");
    }
    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
    const nonce = header.subarray(MAGIC.length + SALT_BYTES);
    const key = await backupKey(password, salt);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
      decipher.setAAD(header);
      decipher.setAuthTag(tag);
      const output = destination
        ? createWriteStream(destination, { flags: "wx", mode: 0o600 })
        : new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      await pipeline(handle.createReadStream({ start: HEADER_BYTES, end: size - TAG_BYTES - 1, autoClose: false }), decipher, output);
    } catch (error) {
      if (error.code && error.code !== "ERR_OSSL_EVP_BAD_DECRYPT") throw error;
      throw encryptionError("BACKUP_PASSWORD_INCORRECT", "备份密码有误，或加密备份已损坏。", error);
    } finally {
      key.fill(0);
    }
  } finally {
    await handle.close();
  }
}

module.exports = { MAGIC, decryptBackup, encryptBackup };

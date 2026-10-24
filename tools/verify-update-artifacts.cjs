const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function verifyReleaseDirectory(releaseDirectory, requireAllPlatforms = false) {
const allowedExtensions = new Set([".blockmap", ".dmg", ".exe", ".yml", ".zip"]);

if (!fs.existsSync(releaseDirectory)) fail(`Release directory does not exist: ${releaseDirectory}`);

const files = fs.readdirSync(releaseDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase()))
  .map((entry) => entry.name);
const available = new Set(files);
const metadataFiles = files.filter((name) => /^latest(?:-mac)?\.yml$/i.test(name));

if (!metadataFiles.length) fail("No latest.yml or latest-mac.yml update metadata was generated.");
if (requireAllPlatforms) {
  for (const required of ["latest.yml", "latest-mac.yml"]) {
    if (!available.has(required)) fail(`Combined release is missing required update metadata: ${required}`);
  }
}

let verifiedArtifacts = 0;
for (const metadataFile of metadataFiles) {
  const content = fs.readFileSync(path.join(releaseDirectory, metadataFile), "utf8");
  const metadata = parseUpdateMetadata(content);
  const targets = [...metadata.files];
  if (metadata.path && !targets.some((target) => path.basename(String(target.url || "")) === path.basename(metadata.path))) {
    targets.push({ url: metadata.path, sha512: metadata.sha512 });
  }
  if (!targets.length) fail(`${metadataFile} does not contain any artifact URL.`);
  for (const target of targets) {
    const url = decodeURIComponent(String(target.url || "")).split(/[?#]/, 1)[0];
    const name = path.basename(url);
    if (!available.has(name)) fail(`${metadataFile} references missing artifact: ${name}`);
    if (/\s/.test(name)) fail(`${metadataFile} references a filename containing spaces: ${name}`);
    // The filenames alone prove nothing: the feed has to match the real bytes,
    // otherwise a tampered or stale artifact can be published unnoticed.
    verifyArtifactBytes(metadataFile, name, target, releaseDirectory);
    verifiedArtifacts += 1;
  }
}

for (const file of files) {
  if (/\s/.test(file)) fail(`Release artifact contains spaces and is unsafe for the update feed: ${file}`);
}

console.log(`Verified ${metadataFiles.length} update metadata file(s) and ${verifiedArtifacts} artifact digest(s) against ${files.length} release artifact(s).`);
}

/**
 * Read the artifact shape that electron-builder writes: a top-level version and
 * a `files:` block sequence whose items carry url, sha512 and size.
 */
function parseUpdateMetadata(content) {
  const result = { files: [], path: "", sha512: "", version: "" };
  let entry = null;
  let inFiles = false;
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;

    const item = /^-\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (inFiles && indent > 0 && item) {
      entry = { [item[1]]: unquoteYamlValue(item[2]) };
      result.files.push(entry);
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!pair) continue;
    const key = pair[1];
    const value = unquoteYamlValue(pair[2]);
    if (indent === 0) {
      entry = null;
      inFiles = key === "files" && value === "";
      if (key === "path") result.path = value;
      if (key === "sha512") result.sha512 = value;
      if (key === "version") result.version = value;
      continue;
    }
    if (inFiles && entry) entry[key] = value;
  }
  return result;
}

function unquoteYamlValue(value) {
  const text = String(value || "").trim();
  if (text.length >= 2 && ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith("\"") && text.endsWith("\"")))) {
    return text.slice(1, -1);
  }
  return text;
}

function verifyArtifactBytes(metadataFile, name, target, releaseDirectory) {
  const filePath = path.join(releaseDirectory, name);
  const stats = fs.statSync(filePath);
  const declaredSize = Number(target.size);
  if (Number.isFinite(declaredSize) && declaredSize > 0 && stats.size !== declaredSize) {
    fail(`${metadataFile} declares ${name} as ${declaredSize} bytes but the file is ${stats.size} bytes.`);
  }
  if (!String(target.sha512 || "").trim()) {
    fail(`${metadataFile} does not record a sha512 for ${name}, so the artifact cannot be verified.`);
  }
  const expected = normalizeSha512(target.sha512);
  const actual = sha512Base64(filePath);
  if (actual !== expected) fail(`${metadataFile} sha512 mismatch for ${name}.`);
}

function normalizeSha512(value) {
  const text = unquoteYamlValue(value);
  return /^[0-9a-f]{128}$/i.test(text) ? Buffer.from(text, "hex").toString("base64") : text;
}

function sha512Base64(filePath) {
  const hash = crypto.createHash("sha512");
  const descriptor = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    let read = 0;
    while ((read = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("base64");
}

function fail(message) {
  console.error(`Update artifact verification failed: ${message}`);
  process.exit(1);
}

module.exports = { parseUpdateMetadata, verifyReleaseDirectory };
if (require.main === module) verifyReleaseDirectory(path.resolve(process.argv[2] || "release"), process.argv.includes("--require-all-platforms"));

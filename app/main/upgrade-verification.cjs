const fs = require("node:fs/promises");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { LEGACY_USER_DATA_DIRECTORY } = require("./app-identity.cjs");
const { BACKUP_ROOT_DIRECTORY, INSTALL_BACKUP_DIRECTORY, copyVerifiedManagedData, createManagedManifest,
  createPreInstallBackup, fileDigest, stageAndRestore, validateManifestFiles, verifyManifest, writeDurableJson,
} = require("./data-continuity.cjs");
const { IMAGE_ASSETS_DIR, packImageText, storedImageNames, unpackImageText } = require("./image-store.cjs");
const { readKnowledgeRecovery } = require("./recovery.cjs");
const { DATA_FILE, DATA_VERSION, readTaskData } = require("./storage.cjs");
const { noteBindings, resourceRelativePath } = require("./workspace-backup.cjs");
const { scan } = require("../renderer/src/task-share-markdown.js");

const PENDING = ".loop-upgrade-next.json";
const REPORT = ".loop-upgrade-report.json";
const ROLLBACK = ".loop-upgrade-rollback.json";
const INSTALL_MARKER = ".loop-install-check";
const versionPattern = /^\d+\.\d+\.\d+(?:-[a-z0-9][a-z0-9.-]*)?$/i;
const installerAttemptPattern = /^attempt-([1-9][0-9]{0,9})$/;
const backupPattern = /^pre-update-[a-z0-9.-]+-to-[a-z0-9.-]+-\d{8}T\d{9}Z-[a-f0-9]{8}$/i;
const missing = error => error.code === "ENOENT" || error.code === "ENOTDIR";

async function stat(file) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function readJson(file) {
  const entry = await stat(file);
  if (!entry) return null;
  if (!entry.isFile()) throw new Error("升级检查记录不可读。");
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function realDirectories(...directories) {
  for (const dir of directories) {
    if (!(await stat(dir))?.isDirectory()) return false;
  }
  return true;
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

async function externalNoteFiles(raw, userDataPath) {
  const files = new Map();
  async function inspect(file) {
    if (files.has(file)) return files.get(file);
    let digest = null;
    try {
      if (path.isAbsolute(file) && (await fs.stat(file)).isFile()) digest = await fileDigest(file);
    } catch (error) {
      if (!missing(error) && !["EACCES", "EPERM", "ELOOP"].includes(error.code)) throw error;
    }
    files.set(file, digest);
    return digest;
  }
  for (const { note, archive, body } of noteBindings(raw)) {
    const file = archive?.sourcePath || note.filePath;
    if (inside(path.join(userDataPath, "workspace-notes"), file) || files.has(file)) continue;
    if (!(await inspect(file))) continue;
    let content;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      files.set(file, null);
      continue;
    }
    for (const text of [content, body]) {
      if (typeof text !== "string") continue;
      for (const ref of scan(text)) {
        if (ref.definition || ref.kind === "wiki") continue;
        const relative = resourceRelativePath(ref.destination);
        if (relative) await inspect(path.resolve(path.dirname(file), relative));
      }
    }
  }
  return [...files].sort(([left], [right]) => left.localeCompare(right));
}

async function prepareUpgradeVerification({ appDataPath, userDataPath, currentVersion, targetVersion }) {
  if (!versionPattern.test(currentVersion) || !versionPattern.test(targetVersion)) throw new Error("更新版本无法识别。");
  const backup = await createPreInstallBackup({ appDataPath, userDataPath, currentVersion, targetVersion });
  if (!backup.manifest?.files.some(file => file.relativePath === DATA_FILE)) return;
  const raw = await readTaskData(backup.dataPath, { validateOnly: true });
  await readKnowledgeRecovery(backup.dataPath, { validateOnly: true });
  await writeDurableJson(path.join(userDataPath, PENDING), {
    version: targetVersion, previousVersion: currentVersion, name: path.basename(backup.backupPath),
    external: await externalNoteFiles(raw, userDataPath),
  });
}

function sourceLocation(options, source) {
  const root = path.join(options.appDataPath, BACKUP_ROOT_DIRECTORY);
  if (source.kind === "app" && backupPattern.test(source.name)) {
    const folder = path.join(root, source.name);
    return { folder, data: path.join(folder, "data"), parents: [root, folder] };
  }
  if ((source.kind === "installer" || source.kind === "mirror") && versionPattern.test(source.version)) {
    const backupRoot = source.kind === "mirror" && options.installDirectory
      ? path.join(options.installDirectory, INSTALL_BACKUP_DIRECTORY) : root;
    const versionFolder = path.join(backupRoot, "installer-pre-" + source.version);
    if (source.attempt !== undefined && !installerAttemptPattern.test(source.attempt)) {
      throw new Error("升级备份标识无效。");
    }
    const folder = source.attempt ? path.join(versionFolder, source.attempt) : versionFolder;
    const data = path.join(folder, LEGACY_USER_DATA_DIRECTORY);
    const parents = source.attempt ? [backupRoot, versionFolder, folder] : [backupRoot, folder];
    return { folder, data, parents };
  }
  throw new Error("升级备份标识无效。");
}

async function readInstallerAttempt(options) {
  if (!options.allowInstaller) return null;
  const legacy = { kind: "installer", version: options.version };
  const { folder, parents } = sourceLocation(options, legacy);
  if (!(await realDirectories(...parents))) return null;
  const attempts = (await fs.readdir(folder, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && installerAttemptPattern.test(entry.name))
    .map(entry => entry.name)
    .sort((left, right) => Number(right.slice(8)) - Number(left.slice(8)));
  for (const attempt of [...attempts, undefined]) {
    const source = attempt ? { ...legacy, attempt } : legacy;
    const location = sourceLocation(options, source);
    if (!(await realDirectories(...location.parents))) continue;
    const marker = path.join(location.folder, INSTALL_MARKER);
    if (!(await stat(marker))?.isFile()) continue;
    const contents = await fs.readFile(marker);
    if (!attempt) {
      const [format, previousVersion] = contents.toString("utf8").trimEnd().split(/\r?\n/);
      if (format === "1") return { source, previousVersion, marker };
      continue;
    }
    const [format, previousVersion, mode, payload, installDirectory] = contents.toString("utf16le").replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/);
    if (format === "2" && ["manual", "update"].includes(mode) && ["workspace", "empty"].includes(payload)
      && options.installDirectory && installDirectory && path.isAbsolute(installDirectory)
      && path.relative(options.installDirectory, installDirectory) === "") {
      return { attempt, source: payload === "empty" ? null : source, previousVersion, mode };
    }
  }
  return null;
}

async function inspectSource(options, source) {
  const { folder, data, parents } = sourceLocation(options, source);
  if (!(await realDirectories(...parents, data))) throw new Error("升级备份目录不可读。");
  let manifest;
  if (source.kind === "app") {
    const recorded = await readJson(path.join(folder, "backup-manifest.json"));
    if (recorded?.format !== 1 || recorded.reason !== "in-app-update" ||
      path.resolve(recorded.sourcePath || ".") !== path.resolve(options.userDataPath)) {
      throw new Error("无法确认升级备份的来源。");
    }
    manifest = validateManifestFiles(recorded.files);
  } else {
    manifest = validateManifestFiles(await createManagedManifest(data));
  }
  if (!manifest.some(file => file.relativePath === DATA_FILE)) throw new Error("升级备份缺少任务库。");
  await verifyManifest(data, manifest);
  return { source, manifest, data, folder, parents };
}

async function readWorkspace(directory) {
  const raw = await readTaskData(directory, { validateOnly: true });
  if (!raw) throw new Error("工作区缺少任务库。");
  await readKnowledgeRecovery(directory, { validateOnly: true });
  return raw;
}

function migrationFrom(raw) {
  return DATA_VERSION === 4 && [undefined, 1, 2, 3].includes(raw.version);
}

async function assertMigratedContent(before, after, directory, baseline, current) {
  if (!migrationFrom(before) || after.version !== DATA_VERSION) throw new Error("升级前后任务库或工作区文件的内容不一致。");
  const { version, ...decoded } = await unpackImageText(directory, after);
  const { version: previousVersion, ...original } = before;
  if (!isDeepStrictEqual(original, decoded)) throw new Error("迁移前后任务、笔记或历史内容不一致。");
  const files = new Map(current.map(file => [file.relativePath, file]));
  for (const file of baseline) {
    if (file.relativePath !== DATA_FILE && !isDeepStrictEqual(file, files.get(file.relativePath))) {
      throw new Error("迁移后有笔记、附件或其他工作区文件发生变化。");
    }
    files.delete(file.relativePath);
  }
  const allowedImages = storedImageNames(after);
  for (const key of files.keys()) {
    if (!key.startsWith(IMAGE_ASSETS_DIR + "/") || !allowedImages.has(path.posix.basename(key))) {
      throw new Error("迁移生成了无法识别的工作区文件。");
    }
  }
}

async function migrate(options, backup, before) {
  await stageAndRestore({
    userDataPath: options.userDataPath,
    saveCurrent: () => ({ backupPath: backup.folder, manifest: { files: backup.manifest } }),
    prepare: async data => {
      await copyVerifiedManagedData(backup.data, data, backup.manifest);
      // Keep every legacy field. This conversion only changes image storage.
      const { packed } = await packImageText(data, before);
      packed.version = DATA_VERSION;
      await writeDurableJson(path.join(data, DATA_FILE), packed);
      const files = await createManagedManifest(data);
      await assertMigratedContent(before, await readWorkspace(data), data, backup.manifest, files);
      return { dataPath: data, manifest: { files } };
    },
  });
}

async function removeVerifiedCopy(options, backup) {
  if (!await realDirectories(...backup.parents, backup.data)) throw new Error("备份清理位置不可用。");
  await verifyManifest(backup.data, backup.manifest);
  if (backup.source.kind === "app") {
    const entries = (await fs.readdir(backup.folder)).sort();
    if (!isDeepStrictEqual(entries, ["backup-manifest.json", "data"])) throw new Error("备份目录中有额外文件。");
    await fs.rm(backup.folder, { recursive: true });
  } else {
    await fs.rm(backup.data, { recursive: true });
    if (backup.source.kind === "mirror") {
      for (const label of ["personal-task-track", "PersonalTaskTrack", "Loop"]) {
        await fs.rmdir(path.join(backup.folder, label)).catch(() => {});
      }
      await fs.rmdir(backup.folder).catch(() => {});
      if (backup.source.attempt) await fs.rmdir(path.dirname(backup.folder)).catch(() => {});
      await fs.rmdir(path.join(options.installDirectory, INSTALL_BACKUP_DIRECTORY)).catch(() => {});
    }
  }
}

async function runUpgradeVerification(options, { retry = false } = {}) {
  const { version, userDataPath } = options;
  if (!versionPattern.test(version)) return null;
  const reportFile = path.join(userDataPath, REPORT);
  const last = await readJson(reportFile);
  const installation = await readInstallerAttempt(options);
  if (last?.version === version && last.installerAttempt === installation?.attempt && (!retry || last.status !== "failed")) {
    return last.status === "checked" ? { ...last, status: "warning", message: "升级自检已通过，备份清理曾中断，剩余文件已保留。" } : last;
  }
  const pending = installation?.mode === "manual" ? null : await readJson(path.join(userDataPath, PENDING));
  const appSource = pending?.version === version ? { kind: "app", name: pending.name } : null;
  const installerSource = installation?.source;
  if (!appSource && !installerSource) return null;

  const previousVersion = (installation?.attempt && installation.previousVersion)
    || (appSource && pending.previousVersion) || installation?.previousVersion;
  const report = {
    version, previousVersion: versionPattern.test(previousVersion) ? previousVersion : "",
    installerAttempt: installation?.attempt,
    status: "failed", source: null,
  };
  const save = async (status, message) => {
    Object.assign(report, { status, message });
    await writeDurableJson(reportFile, report);
    return { ...report, fresh: true };
  };
  const copies = [];
  let baseline;
  let before;
  let converted;
  let uncertainty = 0;
  try {
    for (const source of [appSource, installerSource].filter(Boolean)) {
      try {
        const backup = await inspectSource(options, source);
        const raw = await readWorkspace(backup.data);
        copies.push(backup);
        if (!baseline) {
          baseline = backup;
          before = raw;
          report.source = backup.source;
          report.manifest = backup.manifest;
        }
      } catch {
        uncertainty++;
      }
    }
    if (!baseline) throw new Error("升级前的备份无法通过校验。");
    const current = await readWorkspace(userDataPath);
    const currentFiles = await createManagedManifest(userDataPath);
    converted = migrationFrom(before);
    if (isDeepStrictEqual(currentFiles, baseline.manifest)) {
      if (converted) {
        await migrate(options, baseline, before);
        await assertMigratedContent(before, await readWorkspace(userDataPath), userDataPath,
          baseline.manifest, await createManagedManifest(userDataPath));
      }
    } else {
      await assertMigratedContent(before, current, userDataPath, baseline.manifest, currentFiles);
    }
    const external = await externalNoteFiles(before, userDataPath);
    const previous = new Map(appSource && Array.isArray(pending.external) ? pending.external : []);
    const unresolved = external.filter(([file, digest]) =>
      !digest || (previous.has(file) && !isDeepStrictEqual(previous.get(file), digest))).length;
    uncertainty += copies.filter(backup => !isDeepStrictEqual(backup.manifest, baseline.manifest)).length;
    const unknownFormat = !converted && before.version !== DATA_VERSION;
    const unfinishedImport = currentFiles.some(file =>
      /^task-share-assets\/[^/]+\/\.pending$/.test(file.relativePath));
    if (unresolved || uncertainty || unknownFormat || unfinishedImport) return save("warning", [
      unresolved ? `有 ${unresolved} 项外部笔记或附件无法确认，可能已移动、离线或在升级前后改动。` : "",
      uncertainty ? "部分升级副本无法确认与此次升级的数据完全一致。" : "",
      unknownFormat ? "当前数据格式可能仍需在首次保存时转换。" : "",
      unfinishedImport ? "发现上一次未完成的附件导入。" : "",
      "本次升级备份已保留。",
    ].filter(Boolean).join(""));
  } catch (error) {
    if (error.code === "IMPORT_ROLLBACK_FAILED") throw error;
    const detail = error.message.startsWith("升级") || error.message.startsWith("迁移") || error.message.startsWith("工作区")
      ? error.message : "升级后的工作区暂时无法完成数据校验。";
    return save("failed", detail + " 本次升级备份已保留。");
  }

  // Persist the successful verification before any deletion. An interruption
  // during cleanup can leave extra copies, but must never turn into a new check.
  await save("checked", "升级自检通过，正在清理本次升级的备份副本。");
  try {
    if (installerSource && options.installDirectory) {
      const mirror = { ...installerSource, kind: "mirror" };
      if (await stat(sourceLocation(options, mirror).data)) {
        const copy = await inspectSource(options, mirror);
        if (!isDeepStrictEqual(baseline.manifest, copy.manifest)) throw new Error("安装目录副本与升级前的数据不一致。");
        await removeVerifiedCopy(options, copy);
      }
    }
    if (converted) {
      const rollbackFile = path.join(userDataPath, ROLLBACK);
      const previous = await readJson(rollbackFile);
      await writeDurableJson(rollbackFile, { source: baseline.source, manifest: baseline.manifest });
      if (!installation?.attempt && previous && !isDeepStrictEqual(previous.source, baseline.source)) {
        const old = await inspectSource(options, previous.source);
        if (isDeepStrictEqual(old.manifest, previous.manifest)) await removeVerifiedCopy(options, old);
      }
    }
    const redundant = copies.filter(copy => copy !== baseline);
    if (!converted) redundant.push(baseline);
    for (const copy of redundant.filter(copy => !copy.source.attempt)) {
      await removeVerifiedCopy(options, copy);
    }
    if (installerSource && !installation.attempt && (!converted || baseline.source !== installerSource)) {
      const installerPaths = sourceLocation(options, installerSource);
      await fs.rm(installation.marker, { force: true });
      for (const label of ["personal-task-track", "PersonalTaskTrack", "Loop"]) {
        await fs.rmdir(path.join(installerPaths.folder, label)).catch(() => {});
      }
      await fs.rmdir(installerPaths.folder).catch(() => {});
    }
    if (appSource) await fs.rm(path.join(userDataPath, PENDING), { force: true });
    if (!converted) {
      const retained = copies.find(copy => copy.source.attempt);
      report.source = retained?.source ?? null;
      if (retained) report.manifest = retained.manifest;
      else delete report.manifest;
    }
    return save("passed", converted || installerSource?.attempt ? "升级自检通过，已保留升级前的备份。" : "升级自检通过，本次升级备份已清理。");
  } catch {
    return save("warning", "升级自检通过，部分升级备份暂时无法安全清理，已保留。");
  }
}

async function upgradeRecoveryPath(options, report) {
  if (!report?.source) return "";
  try {
    const backup = await inspectSource(options, report.source);
    if (!isDeepStrictEqual(backup.manifest, report.manifest)) return "";
    await readWorkspace(backup.data);
    return backup.source.kind === "app" ? backup.folder : backup.data;
  } catch {
    return "";
  }
}

async function finishUpgradeRecovery(options, report) {
  if (report?.version !== options.version) return;
  await writeDurableJson(path.join(options.userDataPath, REPORT), {
    ...report, status: "restored", message: "已恢复所选备份，原升级备份已保留。",
  });
}

module.exports = { finishUpgradeRecovery, prepareUpgradeVerification, runUpgradeVerification, upgradeRecoveryPath };

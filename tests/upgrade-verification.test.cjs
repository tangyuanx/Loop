const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BACKUP_ROOT_DIRECTORY, importBackup } = require("../app/main/data-continuity.cjs");
const { readTaskData } = require("../app/main/storage.cjs");
const { finishUpgradeRecovery, prepareUpgradeVerification, runUpgradeVerification, upgradeRecoveryPath } =
  require("../app/main/upgrade-verification.cjs");

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nFkAAAAASUVORK5CYII=";
const original = {
  version: 4, tasks: [{ id: "task-1", title: "原任务", notes: png, nodes: [{ id: "node-1", title: "节点" }] }],
};

async function fixture(t, data = original) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "loop-upgrade-verification-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { appDataPath: root, userDataPath: path.join(root, "Personal Task Track"),
    installDirectory: path.join(root, "install"), version: "0.2.70", allowInstaller: true };
  const backupRoot = path.join(root, BACKUP_ROOT_DIRECTORY);
  const taskFile = path.join(options.userDataPath, "task-data.json");
  const write = async (file, content) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  };
  const writeData = value => write(taskFile, JSON.stringify(value));
  const prepare = () => prepareUpgradeVerification({ ...options, currentVersion: "0.2.69", targetVersion: options.version });
  const installer = async ({ attempt, complete = true, mode = "manual", payload = "workspace", installDirectory = options.installDirectory } = {}) => {
    const folder = attempt ? path.join("installer-pre-" + options.version, `attempt-${attempt}`) : "installer-pre-" + options.version;
    const copied = path.join(backupRoot, folder, "Personal Task Track");
    const mirrored = path.join(options.installDirectory, "Loop Data Backups", folder, "Personal Task Track");
    await fs.mkdir(path.dirname(copied), { recursive: true });
    await fs.mkdir(path.dirname(mirrored), { recursive: true });
    await fs.cp(options.userDataPath, copied, { recursive: true, filter: source => !path.basename(source).startsWith(".loop-") });
    await fs.cp(copied, mirrored, { recursive: true });
    const marker = complete ? ".loop-install-check" : ".loop-install-pending";
    await write(path.join(path.dirname(copied), marker), attempt
      ? Buffer.from(`\uFEFF2\r\n0.2.69\r\n${mode}\r\n${payload}\r\n${installDirectory}\r\n`, "utf16le") : "1\r\n");
    return { copied, mirrored };
  };
  await writeData(data);
  await write(path.join(options.userDataPath, "workspace-notes", "attachment.txt"), "笔记附件");
  return { root, options, backupRoot, write, writeData, prepare, installer, taskFile };
}

test("verified unchanged copies are cleared after app and Windows installer upgrade; historical backups stay", async t => {
  const f = await fixture(t);
  const history = path.join(f.backupRoot, "installer-pre-0.2.69", "previous-install-backups", "task-data.json");
  await f.write(history, '{"tasks":[]}');
  await f.prepare();
  const { copied, mirrored } = await f.installer();
  const result = await runUpgradeVerification(f.options);
  assert.equal(result.status, "passed", result.message);
  assert.equal(await fs.readFile(f.taskFile, "utf8"), JSON.stringify(original));
  await assert.rejects(fs.stat(copied), { code: "ENOENT" });
  await assert.rejects(fs.stat(mirrored), { code: "ENOENT" });
  assert.equal((await fs.readdir(f.backupRoot)).some(name => name.startsWith("pre-update-")), false);
  assert.equal(await fs.readFile(history, "utf8"), '{"tasks":[]}');
  assert.equal((await runUpgradeVerification(f.options)).status, "passed");
});

test("a version upgrade migrates a v3 workspace losslessly and retains one verified rollback copy", async t => {
  const legacy = { ...original, version: 3, customLegacyField: "保留旧字段" };
  const f = await fixture(t, legacy);
  await f.write(path.join(f.options.userDataPath, "knowledge-note-recovery.json"), '{"records":{}}');
  const { copied, mirrored } = await f.installer();
  const result = await runUpgradeVerification(f.options);
  assert.equal(result.status, "passed", result.message);
  assert.equal(await upgradeRecoveryPath(f.options, result), copied);
  assert.equal(await fs.readFile(path.join(copied, "task-data.json"), "utf8"), JSON.stringify(legacy));
  await assert.rejects(fs.stat(mirrored), { code: "ENOENT" });
  const active = JSON.parse(await fs.readFile(f.taskFile, "utf8"));
  assert.equal(active.version, 4);
  assert.equal(active.customLegacyField, legacy.customLegacyField);
  assert.equal(typeof active.tasks[0].notes, "object");
  assert.equal((await readTaskData(f.options.userDataPath)).tasks[0].notes, png);
  assert.equal(await fs.readFile(path.join(f.options.userDataPath, "workspace-notes", "attachment.txt"), "utf8"), "笔记附件");
  assert.equal((await fs.readdir(f.backupRoot)).some(name => name.startsWith("pre-update-")), false);
});

test("structurally valid data loss blocks completion; the verified pre-upgrade backup can restore it", async t => {
  const f = await fixture(t);
  await f.prepare();
  await f.writeData({ version: 4, tasks: [] });
  const result = await runUpgradeVerification({ ...f.options, allowInstaller: false });
  assert.equal(result.status, "failed");
  const selectedPath = await upgradeRecoveryPath(f.options, result);
  assert.ok(selectedPath);
  assert.equal(JSON.parse(await fs.readFile(f.taskFile, "utf8")).tasks.length, 0);
  const recovery = await importBackup({ ...f.options, selectedPath, selectionType: "directory" });
  assert.ok(recovery.safetyBackupPath);
  await finishUpgradeRecovery(f.options, result);
  assert.equal((await runUpgradeVerification(f.options)).status, "restored");
  assert.equal(await fs.readFile(f.taskFile, "utf8"), JSON.stringify(original));
  assert.ok(await upgradeRecoveryPath(f.options, result));
});

test("a missing external note attachment is a warning and keeps the app backup", async t => {
  const f = await fixture(t);
  const note = path.join(f.root, "笔记.md");
  const attachment = path.join(f.root, "附件.txt");
  await f.write(note, "[附件](附件.txt)");
  await f.write(attachment, "外部附件");
  await f.writeData({ ...original, tasks: [{ ...original.tasks[0], knowledgeNote: { filePath: note } }] });
  await f.prepare();
  await fs.rm(attachment);
  const result = await runUpgradeVerification(f.options);
  assert.equal(result.status, "warning");
  assert.match(result.message, /1 项外部笔记或附件/);
  assert.ok(await upgradeRecoveryPath(f.options, result));
});

test("an unmarked old installer backup is never used or deleted by a first launch", async t => {
  const f = await fixture(t);
  const { copied } = await f.installer();
  await fs.rm(path.join(path.dirname(copied), ".loop-install-check"));
  assert.equal(await runUpgradeVerification(f.options), null);
  assert.ok(await fs.stat(copied));
});

test("an unrelated file in an upgrade directory prevents deleting that backup", async t => {
  const f = await fixture(t);
  await f.prepare();
  const [name] = await fs.readdir(f.backupRoot);
  const unexpected = path.join(f.backupRoot, name, "keep.txt");
  await f.write(unexpected, "user file");
  const result = await runUpgradeVerification(f.options);
  assert.equal(result.status, "warning");
  assert.equal(await fs.readFile(unexpected, "utf8"), "user file");
  assert.ok(await upgradeRecoveryPath(f.options, result));
});

test("a completed retry replaces the same-version result and keeps earlier and interrupted backups", async t => {
  const f = await fixture(t);
  const legacy = await f.installer();
  const older = await f.installer({ attempt: 9 });
  const first = await runUpgradeVerification(f.options);
  assert.equal(first.installerAttempt, "attempt-9");
  assert.equal(first.status, "passed", first.message);
  assert.ok(await fs.stat(older.copied));

  const changed = { ...original, tasks: [{ ...original.tasks[0], title: "重试前的新任务" }] };
  await f.writeData(changed);
  const latest = await f.installer({ attempt: 10 });
  const interrupted = await f.installer({ attempt: 11, complete: false });
  const otherInstall = await f.installer({ attempt: 12, installDirectory: path.join(f.root, "other-install") });
  const retry = await runUpgradeVerification(f.options);
  assert.equal(retry.installerAttempt, "attempt-10");
  assert.equal(retry.status, "passed", retry.message);
  assert.equal(await fs.readFile(path.join(older.copied, "task-data.json"), "utf8"), JSON.stringify(original));
  assert.equal(await fs.readFile(path.join(legacy.copied, "task-data.json"), "utf8"), JSON.stringify(original));
  assert.equal(await fs.readFile(path.join(latest.copied, "task-data.json"), "utf8"), JSON.stringify(changed));
  assert.ok(await fs.stat(interrupted.copied));
  assert.ok(await fs.stat(otherInstall.copied));
  assert.equal(await fs.readFile(f.taskFile, "utf8"), JSON.stringify(changed));
});

test("same-version manual reinstall ignores an older pending in-app update and keeps its copy", async t => {
  const f = await fixture(t);
  await f.prepare();
  const [appBackup] = await fs.readdir(f.backupRoot);
  await f.writeData({ ...original, tasks: [] });
  const current = await f.installer({ attempt: 1 });
  const result = await runUpgradeVerification(f.options);
  assert.equal(result.status, "passed", result.message);
  assert.equal(await upgradeRecoveryPath(f.options, result), current.copied);
  assert.ok(await fs.stat(path.join(f.backupRoot, appBackup, "data", "task-data.json")));
});

test("a complete empty attempt suppresses stale same-version installer verification", async t => {
  const f = await fixture(t);
  await f.installer();
  await f.installer({ attempt: 1, payload: "empty" });
  assert.equal(await runUpgradeVerification(f.options), null);
});

test("an in-app update detects data lost between the app snapshot and the installer snapshot", async t => {
  const f = await fixture(t);
  await f.prepare();
  await f.writeData({ ...original, tasks: [] });
  const snapshot = await f.installer({ attempt: 1, mode: "update" });
  const result = await runUpgradeVerification(f.options);
  assert.equal(result.status, "failed");
  assert.equal(result.installerAttempt, "attempt-1");
  assert.equal(result.source.kind, "app");
  assert.ok(await upgradeRecoveryPath(f.options, result));
  assert.ok(await fs.stat(snapshot.copied));
});

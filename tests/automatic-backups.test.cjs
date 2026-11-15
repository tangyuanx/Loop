const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAutomaticBackupController, SNAPSHOT_DIRECTORY, workspaceDiskUsage } = require("../app/main/automatic-backups.cjs");
const { writeTaskData } = require("../app/main/storage.cjs");
const { exportWorkspaceBackup, stageWorkspaceBackup } = require("../app/main/workspace-backup.cjs");
const { createDataMaintenanceLock } = require("../app/main/data-maintenance.cjs");

test("a snapshot drains existing writes and resumes new writes after its read barrier", async () => {
  const lock = createDataMaintenanceLock();
  const events = [];
  let finishFirst;
  const first = lock.track(async () => {
    events.push("first-start");
    await new Promise(resolve => { finishFirst = resolve; });
    events.push("first-end");
  });
  await Promise.resolve();
  const release = lock.begin("workspace-backup");
  const later = lock.track(() => events.push("later-write"));
  finishFirst();
  await lock.waitForWrites();
  events.push("snapshot-read");
  assert.deepEqual(events, ["first-start", "first-end", "snapshot-read"]);
  release();
  await Promise.all([first, later]);
  assert.deepEqual(events, ["first-start", "first-end", "snapshot-read", "later-write"]);
});

test("a queued snapshot write is rejected if an import starts before the barrier ends", async () => {
  const lock = createDataMaintenanceLock();
  const releaseBackup = lock.begin("workspace-backup");
  let wrote = false;
  const pending = lock.track(() => { wrote = true; });
  const rejected = assert.rejects(pending, { code: "DATA_MAINTENANCE" });
  const releaseImport = lock.begin("manual-import");
  releaseBackup();
  await rejected;
  assert.equal(wrote, false);
  assert.equal(lock.reason(), "manual-import");
  assert.throws(lock.assertWritable, { code: "DATA_MAINTENANCE" });
  releaseBackup();
  assert.equal(lock.isActive(), true, "releasing a holder twice cannot release the import");
  releaseImport();
  await lock.track(() => { wrote = true; });
  assert.equal(wrote, true);
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "loop-auto-snapshot-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function day(number) { return new Date(2026, 10, number, 12); }

test("automatic backups wait for real task data and retain three verified daily archives", async t => {
  const userDataPath = await fixture(t);
  const directory = path.join(userDataPath, SNAPSHOT_DIRECTORY);
  let time = day(7);
  const options = { userDataPath, appVersion: "0.2.42", now: () => time };
  const controller = createAutomaticBackupController(options);
  assert.equal((await controller.check()).count, 0);
  await assert.rejects(fs.access(directory), { code: "ENOENT" });

  await writeTaskData(userDataPath, { tasks: [{ id: "task_fixture", title: "Saves in snapshots" }] });
  const first = await controller.check();
  assert.equal(first.count, 1);
  assert.equal(first.latestAt, time.toISOString());
  assert.equal((await controller.check()).latestPath, first.latestPath);
  const reloaded = createAutomaticBackupController(options);
  assert.equal((await reloaded.check()).latestPath, first.latestPath);
  const manual = path.join(directory, "manual.loopbackup");
  await fs.writeFile(manual, "This export is not subject to rotation.");

  for (const number of [8, 9, 10]) {
    time = day(number);
    const status = await controller.check();
    assert.equal(status.error, "");
    assert.equal(status.latestAt, time.toISOString());
  }
  const final = controller.status();
  assert.equal(final.count, 3);
  await assert.rejects(fs.access(first.latestPath), { code: "ENOENT" });
  await fs.access(manual);
  const dataPath = path.join(userDataPath, "verify-snapshot");
  const backup = await stageWorkspaceBackup(final.latestPath, { userDataPath, dataPath });
  assert.equal(backup.manifest.inventory.excludedNotes, 0);
  const stored = JSON.parse(await fs.readFile(path.join(dataPath, "task-data.json"), "utf8"));
  assert.equal(stored.tasks[0].title, "Saves in snapshots");
});

test("failed snapshots retain the prior archive and one good snapshot survives a small budget", async t => {
  const userDataPath = await fixture(t);
  let time = day(7);
  let fail = false;
  let exclusive = false;
  let captures = 0;
  const controller = createAutomaticBackupController({
    userDataPath, appVersion: "0.2.42", now: () => time, byteBudget: 1,
    runExclusive: async operation => {
      assert.equal(exclusive, false);
      exclusive = true;
      try { return await operation(); } finally { exclusive = false; }
    },
    exportBackup: async (options) => {
      assert.equal(exclusive, false);
      if (fail) throw Object.assign(new Error("Disk full"), { code: "ENOSPC" });
      return exportWorkspaceBackup({ ...options, captureSnapshot: operation => options.captureSnapshot(async () => {
        assert.equal(exclusive, true);
        captures++;
        return operation();
      }) });
    },
  });
  await writeTaskData(userDataPath, { tasks: [] });
  const first = await controller.check();
  assert.equal(first.count, 1);
  fail = true;
  time = day(8);
  const failed = await controller.check();
  assert.match(failed.error, /空间不足/);
  assert.equal(failed.latestPath, first.latestPath);
  await fs.access(first.latestPath);
  fail = false;
  const final = await controller.check();
  assert.equal(final.count, 1);
  assert.equal(final.error, "");
  assert.equal(captures, 2);
  assert.notEqual(final.latestPath, first.latestPath);
  assert.ok(final.bytes > 1);
  await assert.rejects(fs.access(first.latestPath), { code: "ENOENT" });
});

test("workspace disk usage counts managed data and skips external paths and symlinks", async t => {
  const root = await fixture(t);
  const userDataPath = path.join(root, "profile");
  const backupRoot = path.join(root, "backup-root");
  async function write(base, file, bytes) {
    const target = path.join(base, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.alloc(bytes));
  }
  await write(userDataPath, "task-data.json", 3);
  await write(userDataPath, "knowledge-note-recovery.json", 5);
  await write(userDataPath, "knowledge-note-recovery/asset", 2);
  await write(userDataPath, "image-assets/blob", 11);
  await write(userDataPath, "task-share-assets/asset", 13);
  await write(userDataPath, "workspace-notes/note.md", 17);
  await write(userDataPath, "workspace-snapshots/backup.loopbackup", 19);
  await write(userDataPath, "Cache/data", 23);
  await write(userDataPath, "update-preferences.json", 29);
  await write(userDataPath, "unrelated/data", 31);
  await write(backupRoot, "backup", 37);
  if (process.platform !== "win32") await fs.symlink(backupRoot, path.join(userDataPath, "Cache", "external"));

  assert.deepEqual(await workspaceDiskUsage(userDataPath, backupRoot), {
    taskDataBytes: 3, recoveryBytes: 7, imageBytes: 11, sharedAssetBytes: 13,
    restoredNoteBytes: 17, backupBytes: 56, cacheBytes: 23, otherManagedBytes: 29,
  });
});

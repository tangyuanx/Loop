const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createDataMaintenanceLock } = require("../app/main/data-maintenance.cjs");
const { IMAGE_ASSETS_DIR } = require("../app/main/image-store.cjs");
const { RETENTION_FILE, createRecentlyDeletedRetention } = require("../app/main/recently-deleted-retention.cjs");
const { writeKnowledgeRecovery } = require("../app/main/recovery.cjs");
const { dataFilePath, readTaskData, writeTaskData } = require("../app/main/storage.cjs");
const { taskShareStore } = require("../app/main/task-share-store.cjs");
const { exportWorkspaceBackup, stageWorkspaceBackup } = require("../app/main/workspace-backup.cjs");

const now = () => new Date("2026-11-16T12:00:00.000Z");
const old = "2026-10-01T12:00:00.000Z";

function archivedTask(id, notes = "", deletedAt = old, extra = {}) {
  return { id, kind: "task", deletedAt, title: id, record: { id: `task-${id}`, notes, ...extra } };
}

function archivedNote(id, body) {
  return { id, kind: "note", deletedAt: old, title: id, body };
}

function image(label) {
  return {
    url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
    name: crypto.createHash("sha256").update(label).digest("hex") + ".png",
  };
}

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "loop-retention-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("cleanup is opt-in and preserves unknown dates and prerequisites for retained nodes", async t => {
  const root = await workspace(t);
  const outsideNote = path.join(root, "user-note.md");
  await fs.writeFile(outsideNote, "Source notes");
  const futureField = { preserved: true };
  const original = {
    version: 2,
    tasks: [{ id: "live", title: "Live" }],
    futureField,
    recentlyDeleted: [
      archivedTask("expired", "", old, { knowledgeNote: { filePath: outsideNote } }),
      archivedTask("threshold", "", "2026-11-09T12:00:00.000Z"),
      archivedTask("young", "", "2026-11-09T12:00:00.001Z"),
      archivedTask("unknown", "", ""),
      archivedTask("invalid", "", "2026-10-32T12:00:00.000Z"),
      archivedTask("owner"),
      { id: "group", kind: "group", deletedAt: old, members: [{ record: { id: "member" } }] },
      { id: "node", kind: "node", deletedAt: "2026-11-15T00:00:00.000Z", ownerTaskId: "task-owner", record: { id: "child" } },
      { id: "group-node", kind: "node", deletedAt: "", ownerTaskId: "member", record: { id: "other-child" } },
    ],
  };
  await fs.writeFile(dataFilePath(root), JSON.stringify(original, null, 2) + "\n");
  const retention = createRecentlyDeletedRetention(root, { now });
  assert.deepEqual(await retention.status(), { days: 0 });
  assert.deepEqual((await retention.clean()).removedIds, []);
  await assert.rejects(retention.setDays(1));
  await retention.setDays(7);
  const preview = await retention.preview();
  assert.equal(preview.count, 2);
  const result = await retention.clean(preview.signature);
  assert.deepEqual(result.removedIds, ["expired", "threshold"]);
  assert.ok(result.recordBytes > 0);
  assert.deepEqual((await retention.clean()).removedIds, []);
  assert.equal(await fs.readFile(outsideNote, "utf8"), "Source notes");
  const current = JSON.parse(await fs.readFile(dataFilePath(root), "utf8"));
  assert.deepEqual(current, { ...original, recentlyDeleted: original.recentlyDeleted.slice(2) });
  assert.deepEqual(await createRecentlyDeletedRetention(root, { now }).status(), { days: 7 });
});

test("only unreferenced managed assets are reclaimed and a prior backup remains restorable", async t => {
  const dir = await workspace(t);
  const root = path.join(dir, "profile");
  const removable = image("only expired");
  const shared = image("still in live task");
  const historical = image("still in task history");
  const archived = image("still in another archived record");
  const draft = image("still in recovery");
  const staged = image("held by in-flight editor");
  const legacy = image("referenced by legacy recovery file");
  const taskId = "task_39d7f6ea-a472-450a-9ffe-b521e06cf201";
  const importedContent = "imported attachment represented in an archived group";
  const importedFile = crypto.createHash("sha256").update(importedContent).digest("hex") + ".pdf";
  const imported = path.join(root, "task-share-assets", taskId, importedFile);
  const importedId = "asset_d31c837b-e32f-4245-80e2-8ba16378294c";
  const linkedId = "asset_9187ffc7-399d-4188-b08b-c8a5f58af48f";
  const linkedContent = "imported attachment still referenced by a recovery draft";
  const linkedFile = crypto.createHash("sha256").update(linkedContent).digest("hex") + ".pdf";
  const linked = path.join(path.dirname(imported), linkedFile);
  await writeTaskData(root, {
    tasks: [{ id: "live", title: "Live", notes: shared.url }],
    taskActivity: [{
      id: "evt", taskId: "live", targetId: "live", targetKind: "task", kind: "changed", at: old,
      changes: [{ field: "notes", before: historical.url, after: shared.url }],
    }],
    recentlyDeleted: [
      ...[removable, shared, historical, archived, draft, staged, legacy].map(item => archivedNote(item.name, item.url)),
      archivedTask("recent", archived.url, "2026-11-15T00:00:00.000Z"),
      { id: "group", kind: "group", deletedAt: old, members: [{ record: { id: taskId, sharedAssets: [
        { id: importedId, file: importedFile }, { id: linkedId, file: linkedFile },
      ] } }] },
    ],
  });
  await fs.mkdir(path.dirname(imported), { recursive: true });
  await fs.writeFile(imported, importedContent);
  await fs.writeFile(linked, linkedContent);
  await writeKnowledgeRecovery(root, { noteId: "draft-note", content: `${draft.url}\n[附件](loop-asset:${linkedId})` });
  await fs.writeFile(path.join(root, "task-data.pre-migration-old.json"), JSON.stringify({ snapshot: legacy.name }));
  const baseline = await readTaskData(root);
  assert.equal(baseline.taskActivity[0].changes[0].before, historical.url);

  const destinationPath = path.join(dir, "before.loopbackup");
  await exportWorkspaceBackup({ userDataPath: root, destinationPath, includeBoundNotes: false });
  const retention = createRecentlyDeletedRetention(root, { now });
  retention.rememberStagedImage(staged.name);
  await retention.setDays(7);
  const result = await retention.clean();
  assert.equal(result.removedIds.length, 8);
  assert.equal(result.assetBytes, Buffer.byteLength("only expired") + Buffer.byteLength(importedContent));
  for (const item of [shared, historical, archived, draft, staged, legacy]) {
    await fs.access(path.join(root, IMAGE_ASSETS_DIR, item.name));
  }
  await assert.rejects(fs.access(path.join(root, IMAGE_ASSETS_DIR, removable.name)), { code: "ENOENT" });
  await assert.rejects(fs.access(imported), { code: "ENOENT" });
  assert.equal(await fs.readFile(linked, "utf8"), linkedContent);
  const dataPath = path.join(dir, "restored");
  await stageWorkspaceBackup(destinationPath, { userDataPath: root, dataPath, localRestore: true });
  assert.deepEqual((await readTaskData(dataPath)).recentlyDeleted, baseline.recentlyDeleted);
  assert.equal(await fs.readFile(path.join(dataPath, "task-share-assets", taskId, importedFile), "utf8"), importedContent);
  assert.equal((await retention.clean()).assetBytes, 0);
});

test("failed commits leave the archive intact and failed asset deletions retry after restart", async t => {
  const root = await workspace(t);
  const item = image("retryable image");
  const file = path.join(root, IMAGE_ASSETS_DIR, item.name);
  const retention = createRecentlyDeletedRetention(root, { now });
  await writeTaskData(root, { tasks: [], recentlyDeleted: [archivedNote("expired", item.url)] });
  const baseline = await fs.readFile(dataFilePath(root), "utf8");
  await retention.setDays(7);

  const rename = fs.rename;
  try {
    fs.rename = (from, to) => to === dataFilePath(root)
      ? Promise.reject(Object.assign(new Error("Synthetic disk full"), { code: "ENOSPC" })) : rename(from, to);
    await assert.rejects(retention.clean(), { code: "ENOSPC" });
  } finally {
    fs.rename = rename;
  }
  assert.equal(await fs.readFile(dataFilePath(root), "utf8"), baseline);
  await fs.access(file);

  const unlink = fs.unlink;
  try {
    fs.unlink = name => name.endsWith(item.name)
      ? Promise.reject(Object.assign(new Error("Synthetic file lock"), { code: "EPERM" })) : unlink(name);
    const result = await retention.clean();
    assert.deepEqual(result.removedIds, ["expired"]);
    assert.equal(result.assetError, true);
  } finally {
    fs.unlink = unlink;
  }
  await fs.access(file);
  const restarted = createRecentlyDeletedRetention(root, { now });
  const result = await restarted.clean();
  assert.equal(result.assetBytes, Buffer.byteLength("retryable image"));
  assert.deepEqual(result.removedIds, []);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, RETENTION_FILE), "utf8")).pendingAssets, []);
});

test("a changed preview cannot clean more records and queued saves cannot reintroduce purged IDs", async t => {
  const root = await workspace(t);
  const retention = createRecentlyDeletedRetention(root, { now });
  const first = { tasks: [{ id: "live", title: "Before cleanup" }], recentlyDeleted: [archivedTask("expired")] };
  await writeTaskData(root, first);
  await retention.setDays(7);
  const preview = await retention.preview();
  const later = { ...first, recentlyDeleted: [...first.recentlyDeleted, archivedTask("also-expired")] };
  await writeTaskData(root, later);
  assert.equal((await retention.clean(preview.signature)).changed, true);
  assert.equal((await readTaskData(root)).recentlyDeleted.length, 2);

  const lock = createDataMaintenanceLock();
  const store = taskShareStore({
    now, read: () => readTaskData(root), write: data => writeTaskData(root, data), assertWritable: lock.assertWritable,
  });
  const stale = await store.readForRenderer();
  const events = [];
  const cleanup = store.cleanRecentlyDeleted(async () => {
    const release = lock.begin("recently-deleted-cleanup");
    const draft = lock.track(() => events.push("draft write"));
    try {
      await lock.waitForWrites();
      const result = await retention.clean();
      events.push("cleanup");
      return result;
    } finally {
      release();
      await draft;
    }
  });
  const save = store.save({ ...stale, tasks: [{ ...stale.tasks[0], title: "Edited during cleanup" }] }, stale.shareRevision);
  await Promise.all([cleanup, save]);
  assert.deepEqual(events, ["cleanup", "draft write"]);
  const current = await readTaskData(root);
  assert.equal(current.tasks[0].title, "Edited during cleanup");
  assert.deepEqual(current.recentlyDeleted, []);
  assert.deepEqual((await store.readForRenderer()).recentlyDeleted, []);
});

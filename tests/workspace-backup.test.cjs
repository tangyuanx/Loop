const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yazl = require("yazl");
const { createWriteStream } = require("node:fs");
const { pipeline } = require("node:stream/promises");
const { createHash } = require("node:crypto");
const { importBackup } = require("../app/main/data-continuity.cjs");
const { readTaskData, writeTaskData } = require("../app/main/storage.cjs");
const { readKnowledgeRecovery, writeKnowledgeRecovery } = require("../app/main/recovery.cjs");
const { clearBackupStaging, exportWorkspaceBackup, stageWorkspaceBackup, verifyWorkspaceBackup } = require("../app/main/workspace-backup.cjs");
const { createDataMaintenanceLock } = require("../app/main/data-maintenance.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "loop-workspace-backup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profile = path.join(root, "profile");
  await writeTaskData(profile, { tasks: [{ id: "task-one", title: "数据保护", conclusion: "原结论", nodes: [] }] });
  return { root, profile, archive: path.join(root, "portable.loopbackup") };
}

function stageWith(password = "", localRestore = false) {
  return (file, options) => stageWorkspaceBackup(file, { ...options, password, localRestore });
}

test("portable backup independently restores bound notes, relative attachments, drafts and image identities", async t => {
  const { root, profile, archive } = await fixture(t);
  const notes = path.join(root, "old-machine");
  await fs.mkdir(path.join(notes, "attachments"), { recursive: true });
  const image = Buffer.from("a distinct synthetic image");
  const dataUrl = "data:image/png;base64," + image.toString("base64");
  const attachment = Buffer.from("user attached document");
  const markdown = "![图片](attachments/picture.png)\n[文档](attachments/file.pdf)";
  const original = path.join(notes, "知识笔记.md");
  await fs.writeFile(original, markdown);
  await fs.writeFile(path.join(notes, "attachments", "picture.png"), image);
  await fs.writeFile(path.join(notes, "attachments", "file.pdf"), attachment);
  const contentHash = createHash("sha256").update(markdown).digest("hex");
  const note = { noteId: "note-one", filePath: original, documentState: "SAVED", lastSavedHash: contentHash };
  await writeTaskData(profile, {
    tasks: [{ id: "task-one", title: "数据保护", notes: markdown, knowledgeNote: note }],
    knowledgeWorkspace: { saveDirectoriesByTask: { "task-one": notes } },
    attachments: { images: { "one": dataUrl, "same": dataUrl } },
  });
  await writeKnowledgeRecovery(profile, { noteId: "note-one", content: "新的未提交正文", assets: [{ source: "task-image:one", dataUrl }], updatedAt: new Date().toISOString() });
  const exported = await exportWorkspaceBackup({ userDataPath: profile, destinationPath: archive, appVersion: "candidate" });
  assert.equal(exported.inventory.includedNotes, 1);
  assert.equal(exported.inventory.missingResources, 0);
  assert.equal(exported.inventory.missingNotes, 0);
  await fs.rename(notes, notes + "-offline");

  const target = path.join(root, "new-machine");
  await importBackup({ selectedPath: archive, userDataPath: target, appDataPath: root, stageBackupFile: stageWith() });
  const restored = await readTaskData(target);
  const restoredNote = restored.tasks[0].knowledgeNote;
  assert.ok(restoredNote.filePath.startsWith(path.join(target, "workspace-notes") + path.sep));
  assert.equal(await fs.readFile(restoredNote.filePath, "utf8"), markdown);
  assert.deepEqual(await fs.readFile(path.join(path.dirname(restoredNote.filePath), "attachments", "file.pdf")), attachment);
  assert.equal(restoredNote.lastSavedHash, contentHash);
  assert.equal(restored.attachments.images.one, dataUrl);
  assert.equal(restored.attachments.images.same, dataUrl);
  assert.equal((await fs.readdir(path.join(target, "image-assets"))).length, 1);
  assert.equal((await readKnowledgeRecovery(target)).records["note-one"].content, "新的未提交正文");
  assert.deepEqual(restored.knowledgeWorkspace.saveDirectoriesByTask, {});
});

test("missing files preserve cached note text and export a truthful incomplete inventory", async t => {
  const { root, profile, archive } = await fixture(t);
  await writeTaskData(profile, { tasks: [{
    id: "task-one", title: "缺失文件", notes: "只有这份正文",
    knowledgeNote: { noteId: "lost-note", filePath: path.join(root, "gone.md"), documentState: "SAVED" },
  }] });
  const exported = await exportWorkspaceBackup({ userDataPath: profile, destinationPath: archive });
  assert.equal(exported.inventory.missingNotes, 1);
  const target = path.join(root, "restored");
  await importBackup({ selectedPath: archive, userDataPath: target, appDataPath: root, stageBackupFile: stageWith() });
  const restored = (await readTaskData(target)).tasks[0];
  assert.equal(restored.notes, "只有这份正文");
  assert.equal(restored.knowledgeNote.filePath, null);
  assert.equal(restored.knowledgeNote.documentState, "DRAFT");
});

test("password archives require a valid password and failures leave current data unchanged", async t => {
  const { root, profile, archive } = await fixture(t);
  const secret = "long random fixture password";
  const exported = await exportWorkspaceBackup({ userDataPath: profile, destinationPath: archive, password: secret });
  assert.equal(exported.encrypted, true);
  assert.equal((await fs.readFile(archive)).subarray(0, 8).toString(), "LOOPBK2E");
  const target = path.join(root, "current");
  await writeTaskData(target, { tasks: [{ id: "task-current", title: "原工作区" }] });
  const before = await fs.readFile(path.join(target, "task-data.json"));
  for (const password of ["", "wrong password"]) {
    await assert.rejects(importBackup({
      selectedPath: archive, userDataPath: target, appDataPath: root, stageBackupFile: stageWith(password),
    }), error => ["BACKUP_PASSWORD_REQUIRED", "BACKUP_PASSWORD_INCORRECT"].includes(error.code));
    assert.deepEqual(await fs.readFile(path.join(target, "task-data.json")), before);
  }
  await importBackup({ selectedPath: archive, userDataPath: target, appDataPath: root, stageBackupFile: stageWith(secret) });
  assert.equal((await readTaskData(target)).tasks[0].id, "task-one");

  const tampered = Buffer.from(await fs.readFile(archive));
  tampered[tampered.length - 20] ^= 1;
  const damaged = path.join(root, "damaged.loopbackup");
  await fs.writeFile(damaged, tampered);
  const recovered = await fs.readFile(path.join(target, "task-data.json"));
  await assert.rejects(importBackup({
    selectedPath: damaged, userDataPath: target, appDataPath: root, stageBackupFile: stageWith(secret),
  }), { code: "BACKUP_PASSWORD_INCORRECT" });
  assert.deepEqual(await fs.readFile(path.join(target, "task-data.json")), recovered);
});

test("local archives preserve original external bindings only through explicit same-profile restoration", async t => {
  const { root, profile, archive } = await fixture(t);
  const noteFile = path.join(root, "reference.md");
  await fs.writeFile(noteFile, "外部文档");
  await writeTaskData(profile, { tasks: [{
    id: "task-one", title: "参考", notes: "缓存文本",
    knowledgeNote: { noteId: "note-one", filePath: noteFile },
  }] });
  const result = await exportWorkspaceBackup({ userDataPath: profile, destinationPath: archive, includeBoundNotes: false });
  assert.equal(result.inventory.excludedNotes, 1);
  const target = path.join(root, "copied");
  await importBackup({ selectedPath: archive, userDataPath: target, appDataPath: root, stageBackupFile: stageWith() });
  assert.equal((await readTaskData(target)).tasks[0].knowledgeNote.filePath, null);
  await importBackup({ selectedPath: archive, userDataPath: profile, appDataPath: root, stageBackupFile: stageWith("", true) });
  assert.equal((await readTaskData(profile)).tasks[0].knowledgeNote.filePath, noteFile);
});

test("portable export rejects recursive destinations and cleans only owned interrupted staging", async t => {
  const { root, profile, archive } = await fixture(t);
  const internal = path.join(profile, "workspace-notes");
  await fs.mkdir(internal);
  await assert.rejects(exportWorkspaceBackup({ userDataPath: profile, destinationPath: path.join(internal, "bad.loopbackup") }), { code: "BACKUP_DESTINATION" });
  const staging = path.join(profile, ".loop-backup-staging");
  await fs.mkdir(path.join(staging, "snapshot-ABC123"), { recursive: true });
  await fs.writeFile(path.join(staging, "snapshot-ABC123", "aborted"), "private workspace");
  await fs.writeFile(path.join(staging, "other"), "preserved");
  await clearBackupStaging(profile);
  await assert.rejects(fs.access(path.join(staging, "snapshot-ABC123")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(staging, "other"), "utf8"), "preserved");
  await exportWorkspaceBackup({ userDataPath: profile, destinationPath: archive });
  assert.equal((await verifyWorkspaceBackup(archive)).format, "loop-workspace-backup");
  assert.deepEqual(await fs.readdir(staging), ["other"]);
});

test("portable backup refuses symlink resource escapes and records links without copying them", async t => {
  if (process.platform === "win32") return t.skip("Symlink creation requires elevated Windows privileges.");
  const { root, profile, archive } = await fixture(t);
  const notes = path.join(root, "notes");
  await fs.mkdir(notes);
  await fs.writeFile(path.join(root, "private.txt"), "unrelated secret");
  await fs.symlink(path.join(root, "private.txt"), path.join(notes, "linked.txt"));
  const content = "[文件](linked.txt)\n[路径](../private.txt)\n[配置](.env)\n[[参考笔记]]\n";
  await fs.writeFile(path.join(notes, "note.md"), content);
  await fs.writeFile(path.join(notes, ".env"), "private");
  await writeTaskData(profile, { tasks: [{ id: "task-one", notes: content, knowledgeNote: { noteId: "note-one", filePath: path.join(notes, "note.md") } }] });
  const result = await exportWorkspaceBackup({ userDataPath: profile, destinationPath: archive });
  assert.equal(result.inventory.missingResources, 3);
  const manifest = await verifyWorkspaceBackup(archive);
  assert.equal(manifest.files.filter(file => file.relativePath.startsWith("workspace-notes/")).length, 1);
});

test("maintenance fence waits for existing resource writes and refuses later ones", async () => {
  const lock = createDataMaintenanceLock();
  let complete;
  const started = lock.track(() => new Promise(resolve => { complete = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const release = lock.begin("backup");
  let done = false;
  const waiting = lock.waitForWrites().then(() => { done = true; });
  await assert.rejects(lock.track(() => {}), { code: "DATA_MAINTENANCE" });
  assert.equal(done, false);
  complete();
  await started;
  await waiting;
  assert.equal(done, true);
  release();
  assert.equal(await lock.track(() => 9), 9);
});

test("damaged archive digests, reserved paths and duplicate destinations are rejected before replacement", async t => {
  const { root, profile } = await fixture(t);
  const text = Buffer.from(JSON.stringify({ tasks: [] }));
  for (const scenario of ["checksum", "reserved", "case-collision"]) {
    const archive = path.join(root, scenario + ".loopbackup");
    const task = { relativePath: "task-data.json", bytes: text.length, sha256: createHash("sha256").update(text).digest("hex") };
    const files = [task];
    if (scenario === "checksum") task.sha256 = "0".repeat(64);
    if (scenario === "reserved") files.push({ ...task, relativePath: "workspace-notes/CON.md" });
    if (scenario === "case-collision") files.push({ ...task, relativePath: "TASK-DATA.JSON" });
    const zip = new yazl.ZipFile();
    const writing = pipeline(zip.outputStream, createWriteStream(archive));
    zip.addBuffer(Buffer.from(JSON.stringify({ format: "loop-workspace-backup", version: 2, scope: "portable", files })), "manifest.json");
    for (const entry of files) zip.addBuffer(text, entry.relativePath);
    zip.end();
    await writing;
    const before = await fs.readFile(path.join(profile, "task-data.json"));
    await assert.rejects(importBackup({ selectedPath: archive, userDataPath: profile, appDataPath: root, stageBackupFile: stageWith() }));
    assert.deepEqual(await fs.readFile(path.join(profile, "task-data.json")), before);
  }
});

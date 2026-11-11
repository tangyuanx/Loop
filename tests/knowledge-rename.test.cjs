/* #88: a knowledge note's name is the name of its Markdown file. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  readKnowledgeDocument,
  renameKnowledgeDocument,
  saveKnowledgeDocument,
} = require("../app/main/knowledge-file.cjs");
const { validateNoteName } = require("../app/renderer/src/knowledge-core.js");
const { linksToFile, rewriteLinksToFile } = require("../app/renderer/src/knowledge-core.js");
const { createKnowledgeFileWatcher } = require("../app/main/knowledge-watcher.cjs");

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "loop-knowledge-rename-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("note names are validated against every file system Loop ships on", () => {
  const valid = validateNoteName("设计方案");
  assert.deepEqual(valid, { ok: true, base: "设计方案", fileName: "设计方案.md" });
  // A typed extension is part of the name, never a second extension.
  assert.equal(validateNoteName("设计方案.md").fileName, "设计方案.md");
  assert.equal(validateNoteName("  方案  ").fileName, "方案.md");
  assert.equal(validateNoteName("").code, "NAME_EMPTY");
  assert.equal(validateNoteName("   ").code, "NAME_EMPTY");
  assert.equal(validateNoteName(".md").code, "NAME_EMPTY");
  for (const name of ["a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b", "a\u0001b"]) {
    assert.equal(validateNoteName(name).code, "NAME_INVALID_CHARS", name);
  }
  assert.equal(validateNoteName("方案.").code, "NAME_INVALID_CHARS");
  // Trailing spaces are trimmed rather than rejected: the name is still usable.
  assert.equal(validateNoteName("方案 ").fileName, "方案.md");
  assert.equal(validateNoteName("CON").code, "NAME_RESERVED");
  assert.equal(validateNoteName("nul.md").code, "NAME_RESERVED");
  assert.equal(validateNoteName("长".repeat(80)).code, "NAME_TOO_LONG");
});

test("renaming a note renames its file, keeps the content and the extension", async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, "设计方案.md");
  const content = "# 设计方案\n\n正文与 😀\n\n```js\nconst kept = true;\n```\n";
  await fs.writeFile(filePath, content);

  const result = await renameKnowledgeDocument({ filePath, title: "新设计方案" });
  assert.equal(result.success, true);
  assert.equal(result.previousFilePath, filePath);
  assert.equal(result.filePath, path.join(directory, "新设计方案.md"));
  assert.equal(await fs.readFile(result.filePath, "utf8"), content);
  await assert.rejects(fs.access(filePath));
  assert.deepEqual((await fs.readdir(directory)).sort(), ["新设计方案.md"]);

  const reopened = await readKnowledgeDocument(result.filePath);
  assert.equal(reopened.success, true);
  assert.equal(reopened.content, content);
});

test("the extension survives a title that carries one, and saving still targets the new path", async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, "旧名.md");
  await fs.writeFile(filePath, "旧内容");
  const renamed = await renameKnowledgeDocument({ filePath, title: "新名.md" });
  assert.equal(renamed.filePath, path.join(directory, "新名.md"));
  assert.deepEqual((await fs.readdir(directory)).sort(), ["新名.md"]);

  const saved = await saveKnowledgeDocument({
    filePath: renamed.filePath,
    content: "改名后继续保存",
    expectedLastSavedHash: (await readKnowledgeDocument(renamed.filePath)).lastSavedHash,
  });
  assert.equal(saved.success, true);
  assert.equal(await fs.readFile(renamed.filePath, "utf8"), "改名后继续保存");
});

test("an existing file with the new name is never overwritten", async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, "设计方案.md");
  const occupied = path.join(directory, "新设计方案.md");
  await fs.writeFile(filePath, "原笔记");
  await fs.writeFile(occupied, "别人的文件");

  const result = await renameKnowledgeDocument({ filePath, title: "新设计方案" });
  assert.equal(result.success, false);
  assert.equal(result.code, "NAME_CONFLICT");
  assert.equal(result.filePath, filePath);
  assert.equal(await fs.readFile(filePath, "utf8"), "原笔记");
  assert.equal(await fs.readFile(occupied, "utf8"), "别人的文件");
});

test("an illegal, reserved or missing target is reported instead of renamed", async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, "设计方案.md");
  await fs.writeFile(filePath, "原笔记");

  const illegal = await renameKnowledgeDocument({ filePath, title: "方案/第一期" });
  assert.equal(illegal.code, "INVALID_NAME");
  assert.equal(illegal.errorCode, "NAME_INVALID_CHARS");
  assert.match(illegal.message, /字符/);
  assert.equal(await fs.readFile(filePath, "utf8"), "原笔记");

  const reserved = await renameKnowledgeDocument({ filePath, title: "com1" });
  assert.equal(reserved.code, "INVALID_NAME");
  assert.equal(reserved.errorCode, "NAME_RESERVED");

  const missing = await renameKnowledgeDocument({ filePath: path.join(directory, "不存在.md"), title: "新名" });
  assert.equal(missing.success, false);
  assert.equal(missing.code, "FILE_MISSING");
  assert.deepEqual((await fs.readdir(directory)).sort(), ["设计方案.md"]);
});

test("a refused rename leaves the old name in place and reports a permission failure", async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, "设计方案.md");
  await fs.writeFile(filePath, "原笔记");
  const denied = await renameKnowledgeDocument({ filePath, title: "新名" }, {
    fsOps: { rename: async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } },
  });
  assert.equal(denied.success, false);
  assert.equal(denied.code, "PERMISSION_DENIED");
  assert.match(denied.message, /权限/);
  assert.equal(await fs.readFile(filePath, "utf8"), "原笔记");
  assert.deepEqual((await fs.readdir(directory)).sort(), ["设计方案.md"]);
});

test("a name bound to another note is rejected before the file moves", async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, "设计方案.md");
  const otherPath = path.join(directory, "新设计方案.md");
  await fs.writeFile(filePath, "原笔记");
  await fs.writeFile(otherPath, "另一篇笔记");

  const result = await renameKnowledgeDocument({
    filePath,
    title: "新设计方案",
    boundPaths: [otherPath],
  });
  assert.equal(result.code, "DUPLICATE_BINDING");
  assert.equal(await fs.readFile(filePath, "utf8"), "原笔记");
  assert.equal(await fs.readFile(otherPath, "utf8"), "另一篇笔记");
});

test("renaming to the current name changes nothing", async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, "设计方案.md");
  await fs.writeFile(filePath, "原笔记");
  const result = await renameKnowledgeDocument({ filePath, title: "设计方案" });
  assert.equal(result.success, true);
  assert.equal(result.unchanged, true);
  assert.equal(result.filePath, filePath);
});

test("an undo by exact file name restores the previous file after a failed record write", async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, "设计方案.md");
  await fs.writeFile(filePath, "原笔记");
  const renamed = await renameKnowledgeDocument({ filePath, title: "新设计方案" });
  const restored = await renameKnowledgeDocument({
    filePath: renamed.filePath,
    targetName: "设计方案.md",
  });
  assert.equal(restored.success, true);
  assert.equal(restored.filePath, filePath);
  assert.equal(await fs.readFile(filePath, "utf8"), "原笔记");
  assert.deepEqual((await fs.readdir(directory)).sort(), ["设计方案.md"]);
});

test("a save queued on the old path cannot recreate the file that was just renamed", async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, "设计方案.md");
  await fs.writeFile(filePath, "旧内容");
  const [saved, renamed] = await Promise.all([
    saveKnowledgeDocument({ filePath, content: "保存中的新内容" }),
    renameKnowledgeDocument({ filePath, title: "新设计方案" }),
  ]);
  assert.equal(saved.success, true);
  assert.equal(renamed.success, true);
  assert.deepEqual((await fs.readdir(directory)).sort(), ["新设计方案.md"]);
  assert.equal(await fs.readFile(renamed.filePath, "utf8"), "保存中的新内容");
});

test("relative links to a renamed file are found and rewritten without touching anything else", async (t) => {
  const notePath = "/notes/关联笔记.md";
  const previousPath = "/notes/设计方案.md";
  const nextPath = "/notes/新设计方案.md";
  const note = [
    "# 关联笔记",
    "",
    "[设计方案](./设计方案.md)",
    "[同名目录](../notes/设计方案.md#细节)",
    "[带空格](<设计方案.md>)",
    "[编码](%E8%AE%BE%E8%AE%A1%E6%96%B9%E6%A1%88.md)",
    "[其他](../other/设计方案.md)",
    "[外链](https://example.com/设计方案.md)",
    "![图片](./设计方案.md)",
    "`[代码](./设计方案.md)`",
    "[[设计方案]] 与 [[note:note-main|设计方案]]",
  ].join("\n");
  const found = linksToFile(note, { noteFilePath: notePath, filePath: previousPath, platform: "linux" });
  assert.equal(found.length, 4);

  const rewritten = rewriteLinksToFile(note, { noteFilePath: notePath, filePath: previousPath, nextPath, platform: "linux" });
  assert.equal(rewritten.changed, 4);
  assert.match(rewritten.content, /\[设计方案\]\(\.\/新设计方案\.md\)/);
  assert.match(rewritten.content, /\[同名目录\]\(新设计方案\.md#细节\)/);
  assert.match(rewritten.content, /\[带空格\]\(<新设计方案\.md>\)/);
  assert.match(rewritten.content, /\[编码\]\(%E6%96%B0%E8%AE%BE%E8%AE%A1%E6%96%B9%E6%A1%88\.md\)/);
  // Unrelated links, embeds, code spans, wiki links and note identity stay byte-identical.
  assert.match(rewritten.content, /\[其他\]\(\.\.\/other\/设计方案\.md\)/);
  assert.match(rewritten.content, /\[外链\]\(https:\/\/example\.com\/设计方案\.md\)/);
  assert.match(rewritten.content, /!\[图片\]\(\.\/设计方案\.md\)/);
  assert.match(rewritten.content, /`\[代码\]\(\.\/设计方案\.md\)`/);
  assert.match(rewritten.content, /\[\[设计方案\]\] 与 \[\[note:note-main\|设计方案\]\]/);
  assert.equal(rewriteLinksToFile(rewritten.content, { noteFilePath: notePath, filePath: previousPath, nextPath, platform: "linux" }).changed, 0);
});

test("a link in another directory is rewritten relative to its own note", () => {
  const rewritten = rewriteLinksToFile("[子目录](../设计方案.md)", {
    noteFilePath: "/notes/sub/笔记.md",
    filePath: "/notes/设计方案.md",
    nextPath: "/notes/新设计方案.md",
    platform: "win32",
  });
  assert.equal(rewritten.content, "[子目录](../新设计方案.md)");
  // Windows resolves case-insensitively, so this link still matches the file.
  const windowsLink = { noteFilePath: "C:/notes/其他.md", filePath: "c:/NOTES/设计方案.md" };
  assert.equal(linksToFile("[x](./设计方案.MD)", { ...windowsLink, platform: "win32" }).length, 1);
  assert.equal(linksToFile("[x](./设计方案.MD)", { ...windowsLink, platform: "linux" }).length, 0);
});

test("re-pointing the watcher after a rename stays silent and still detects later edits", async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, "设计方案.md");
  await fs.writeFile(filePath, "# 原内容\n");
  const baseline = await readKnowledgeDocument(filePath);
  const events = [];
  const watcher = createKnowledgeFileWatcher({ debounceMs: 40, onChange: (event) => events.push(event) });
  t.after(() => watcher.closeAll());
  watcher.watch({ noteId: "note-silent", filePath, lastSavedHash: baseline.lastSavedHash });
  await pause(140);
  events.length = 0;

  const renamed = await renameKnowledgeDocument({ filePath, title: "新设计方案" });
  const rewatched = watcher.updateBaseline("note-silent", {
    filePath: renamed.filePath,
    lastSavedHash: baseline.lastSavedHash,
  }, { emitBaseline: false });
  assert.equal(rewatched?.success, true);
  await pause(350);
  assert.deepEqual(events, []);

  // An external edit after the rename is still reported, on the new path.
  await fs.writeFile(renamed.filePath, "# 外部修改\n");
  await pause(400);
  const changed = events.filter((event) => event.type === "external-changed");
  assert.equal(changed.length, 1);
  assert.equal(changed[0].filePath, renamed.filePath);
});

test("the watcher follows the renamed path instead of reporting our own rename as missing", async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, "设计方案.md");
  await fs.writeFile(filePath, "# 内容\n");
  const baseline = await readKnowledgeDocument(filePath);
  const events = [];
  const watcher = createKnowledgeFileWatcher({ debounceMs: 40, onChange: (event) => events.push(event) });
  t.after(() => watcher.closeAll());
  watcher.watch({
    noteId: "note-rename",
    filePath,
    lastSavedHash: baseline.lastSavedHash,
    lastSavedMtime: baseline.lastSavedMtime,
  });
  await pause(120);

  const renamed = await renameKnowledgeDocument({ filePath, title: "新设计方案" });
  assert.equal(renamed.success, true);
  watcher.updateBaseline("note-rename", { filePath: renamed.filePath, lastSavedHash: baseline.lastSavedHash });
  await pause(400);

  assert.deepEqual(events.filter((event) => event.type === "file-missing"), []);
  assert.ok(events.some((event) => event.type === "baseline" && event.filePath === renamed.filePath));
  assert.equal(watcher.updateBaseline("note-rename", { filePath: renamed.filePath }), true);
});

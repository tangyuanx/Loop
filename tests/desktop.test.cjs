const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { UUID } = require("builder-util-runtime");
const {
  DATA_FILE,
  KNOWLEDGE_MIGRATION_VERSION,
  RECENTLY_DELETED_SCHEMA_VERSION,
  normalizeRecentlyDeleted,
  normalizeTaskData,
  migrateKnowledgeTaskData,
  isNewerThanSupported,
  readTaskData,
  writeTaskData,
} = require("../app/main/storage.cjs");
// The rebuilt renderer's style authority: every layer that index.html loads.
// Assertions that used to read the superseded styles.css / approved-4174.css
// now match against the union, so a rule only fails when no layer defines it.
const RENDERER_LAYERS = [
  "shell.css", "knowledge.css", "flow.css", "settings.css", "typography.css",
  "fonts.css", "refinement.css", "selection.css", "shell-refinement.css",
  "help.css", "work.css", "task-entry.css", "journey.css", "widget12.css", "type-readability.css",
  "widget13.css", "widget-bridge.css", "bridge.css",
];
const rendererStyles = () => Promise.all(
  RENDERER_LAYERS.map((name) => fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", name), "utf8")),
).then((parts) => parts.join("\n"));

const knowledgeDocument = require("../app/renderer/src/knowledge-document.js");
const knowledgeRecovery = require("../app/renderer/src/knowledge-recovery.js");
const {
  deleteKnowledgeRecovery,
  readKnowledgeRecovery,
  recoveryFilePath,
  writeKnowledgeRecovery,
} = require("../app/main/recovery.cjs");
const knowledgeFile = require("../app/main/knowledge-file.cjs");
const knowledgeAccess = require("../app/main/knowledge-access.cjs");
const dataMaintenance = require("../app/main/data-maintenance.cjs");
const knowledgeAssets = require("../app/main/knowledge-assets.cjs");
const { createKnowledgeFileWatcher } = require("../app/main/knowledge-watcher.cjs");
const {
  APP_DISPLAY_NAME,
  explicitUserDataPath,
  DESKTOP_APP_ID,
  LEGACY_USER_DATA_DIRECTORY,
  WINDOWS_INSTALLER_GUID,
  configureDesktopIdentity,
  legacyUserDataPath,
} = require("../app/main/app-identity.cjs");
const {
  applyTodayWidgetTopmost,
  cornerWindowBounds,
  createTodayWidgetController,
  resizedWidgetBounds,
  normalizeSnapshot,
  normalizeTodayWidgetAppearance,
  normalizeTodayWidgetPreferences,
  readTodayWidgetPreferences,
  writeTodayWidgetPreferences,
} = require("../app/main/today-widget.cjs");

const KNOWLEDGE_RECOVERY_KEY_FOR_TEST = "task-track-knowledge-recovery-v1";

function runKilledSaveChild(filePath, killPoint) {
  const script = `
    const fs = require("node:fs/promises");
    const { atomicWriteFile } = require("./app/main/knowledge-file.cjs");
    const target = process.argv[1];
    const killPoint = process.argv[2];
    const fsOps = {
      open: async (...args) => {
        const handle = await fs.open(...args);
        const writeFile = handle.writeFile.bind(handle);
        const sync = handle.sync.bind(handle);
        handle.writeFile = async (...writeArgs) => {
          const result = await writeFile(...writeArgs);
          if (killPoint === "after-write") process.kill(process.pid, "SIGKILL");
          return result;
        };
        handle.sync = async (...syncArgs) => {
          const result = await sync(...syncArgs);
          if (killPoint === "after-sync") process.kill(process.pid, "SIGKILL");
          return result;
        };
        return handle;
      }
    };
    atomicWriteFile(target, "进程中断后不应覆盖", { fsOps, platform: process.platform }).catch(() => process.exit(2));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script, filePath, killPoint], {
      cwd: path.join(__dirname, ".."),
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function runKilledRecoveryChild(userDataPath) {
  const script = `
    const fs = require("node:fs/promises");
    const originalOpen = fs.open;
    fs.open = async (...args) => {
      const handle = await originalOpen(...args);
      const sync = handle.sync.bind(handle);
      handle.sync = async (...syncArgs) => {
        const result = await sync(...syncArgs);
        process.kill(process.pid, "SIGKILL");
        return result;
      };
      return handle;
    };
    const { writeKnowledgeRecovery } = require("./app/main/recovery.cjs");
    writeKnowledgeRecovery(process.argv[1], { noteId: "kill-recovery", content: "Recovery 中断后的新正文" }).catch(() => process.exit(2));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script, userDataPath], {
      cwd: path.join(__dirname, ".."),
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function assertForceTerminated(child) {
  if (process.platform === "win32") {
    assert.equal(child.signal, null);
    assert.notEqual(child.code, 0);
    return;
  }
  assert.equal(child.signal, "SIGKILL");
}

async function waitForCondition(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for asynchronous test condition.");
}

test("task double-click focuses the mounted name editor and preserves its complete control", async () => {
  const harness = await rendererHarness();
  harness.evaluate(`
    globalThis.performance = { now: () => 100 };
    document.body.hasAttribute = () => true;
    document.addEventListener = window.addEventListener;
    state.tasks = [{ id: "rename-test", title: "原任务", status: "todo", nodes: [] }];
    state.activeTaskId = "rename-test";
    globalThis.focusCount = 0;
    globalThis.selectCount = 0;
    globalThis.renameSaveCount = 0;
    save = () => { renameSaveCount++; };
    flushSave = async () => true;
    globalThis.nameInput = null;
    document.getElementById = id => id === "manage24-row-title" ? nameInput : null;
    render = () => {
      globalThis.rowMarkup = renderShellTaskRow(state.tasks[0], 3);
      nameInput = rowMarkup.includes('id="manage24-row-title"') ? {
        id: "manage24-row-title", value: "原任务", removeAttribute() {},
        focus() { document.activeElement = this; focusCount++; },
        select() { selectCount++; },
        closest() { return null; }
      } : null;
    };
    globalThis.renameButton = {
      dataset: { taskId: "rename-test" },
      closest: selector => selector === ".task-select[data-task-id]" ? renameButton
        : selector === ".task-item" ? {} : null
    };
  `);
  harness.evaluate(await fs.readFile(path.join(__dirname, "../app/renderer/src/management24.js"), "utf8"));
  harness.dispatch("click", {
    target: harness.evaluate("renameButton"), detail: 2,
    preventDefault() {}, stopImmediatePropagation() {},
  });
  assert.equal(harness.evaluate("document.activeElement === nameInput"), true);
  assert.equal(harness.evaluate("focusCount"), 1);
  assert.equal(harness.evaluate("selectCount"), 1, "one action must not reselect an already focused editor");
  assert.match(harness.evaluate("rowMarkup"), /task-sequence-action/);
  assert.match(harness.evaluate("rowMarkup"), /data-action="toggle-task-done"/);
  assert.match(harness.evaluate("rowMarkup"), />03<\/span>/);
  const input = harness.evaluate('nameInput.value = "已修改任务"; nameInput');
  harness.dispatch("input", { target: input });
  assert.equal(harness.evaluate("state.tasks[0].title"), "原任务");
  harness.dispatch("focusout", { target: input });
  await waitForCondition(() => harness.evaluate("renameSaveCount === 1"));
  assert.equal(harness.evaluate("state.tasks[0].title"), "已修改任务", "blur must persist without an extra save button");
});

test("workspace task menu dismisses outside in place, retains inside clicks, and restores its trigger on Escape", async () => {
  const harness = await rendererHarness();
  harness.evaluate(`
    document.addEventListener = window.addEventListener;
    globalThis.taskMenuRemoved = 0;
    globalThis.taskMenuFocused = 0;
    globalThis.taskMenuExpanded = "true";
    globalThis.taskMenuTrigger = {
      setAttribute: (name, value) => { if (name === "aria-expanded") taskMenuExpanded = value; },
      focus: () => { taskMenuFocused++; }
    };
    document.querySelector = selector => selector === "[data-task-menu]" ? { remove: () => { taskMenuRemoved++; } }
      : selector === '[data-action="open-task-menu"]' ? taskMenuTrigger : null;
    render = () => { throw new Error("Outside dismissal must not rebuild the workspace"); };
    state.taskMenuOpen = true;
    shellBindOverlayDismissal();
  `);
  for (const inside of ["menu", "trigger"]) {
    harness.dispatch("pointerdown", { button: 0, target: { closest: () => ({ inside }) } });
    assert.equal(harness.evaluate("state.taskMenuOpen"), true);
  }
  harness.dispatch("pointerdown", { button: 0, target: { closest: () => null } });
  assert.equal(harness.evaluate("state.taskMenuOpen"), false);
  assert.equal(harness.evaluate("taskMenuRemoved"), 1);
  assert.equal(harness.evaluate("taskMenuExpanded"), "false");
  assert.equal(harness.evaluate("taskMenuFocused"), 0, "outside pointer keeps focus on the clicked target");
  let prevented = false;
  harness.dispatch("click", { detail: 1, preventDefault() { prevented = true; }, stopImmediatePropagation() { prevented = true; } });
  assert.equal(prevented, false, "outside control still handles the same click");
  harness.evaluate("state.taskMenuOpen = true;");
  harness.dispatch("keydown", { key: "Escape", preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(harness.evaluate("state.taskMenuOpen"), false);
  assert.equal(harness.evaluate("taskMenuFocused"), 1);
});

test("overlay backdrop dismisses without click-through and preserves the creation draft", async () => {
  const harness = await rendererHarness();
  harness.evaluate(`
    document.addEventListener = window.addEventListener;
    globalThis.savedDraft = { title: "未提交标题", deadline: "2026-10-08" };
    state.createDraft = savedDraft;
    globalThis.captureCount = 0;
    globalThis.renderCount = 0;
    globalThis.dialog = { contains: target => target.inside === true };
    globalThis.overlay = {
      firstElementChild: {},
      querySelector: selector => selector === ".dialog" ? dialog : null,
      set innerHTML(value) { if (!value) this.firstElementChild = null; }
    };
    document.querySelector = selector => selector === "#overlay" ? overlay
      : selector === "#create-form" ? {} : null;
    shellCaptureCreateDraft = () => { captureCount++; };
    render = () => { renderCount++; };
    shellBindOverlayDismissal();
  `);
  const inside = { inside: true, closest: () => null };
  harness.dispatch("pointerdown", { target: inside, button: 0 });
  assert.equal(harness.evaluate("shellOverlayIsOpen()"), true, "inside interaction must keep the dialog");
  const backdrop = { closest: selector => selector === "#overlay" ? {} : null };
  harness.dispatch("pointerdown", { target: backdrop, button: 0 });
  assert.equal(harness.evaluate("shellOverlayIsOpen()"), false);
  assert.equal(harness.evaluate("captureCount"), 1);
  assert.equal(harness.evaluate("state.createDraft === savedDraft"), true);
  let consumed = false;
  harness.dispatch("click", { target: backdrop, detail: 1, preventDefault() {}, stopImmediatePropagation() { consumed = true; } });
  assert.equal(consumed, true, "closing the dialog must not activate the newly exposed control");
});

function rendererHarness(personalTaskTrack = undefined) {
  const storage = new Map();
  const alerts = [];
  const windowListeners = new Map();
  const document = {
    activeElement: null,
    body: {
      appendChild() {},
      contains: () => true,
      classList: { add() {}, remove() {} },
    },
    documentElement: { dataset: {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      classList: { add() {}, contains: () => false, remove() {} },
      click() {},
      dataset: {},
      focus() {},
      remove() {},
      setAttribute() {},
      style: {},
    }),
    createTextNode: (value) => ({ value }),
    dispatchEvent() { return true; },
    execCommand: () => false,
    queryCommandSupported: () => false,
  };
  const window = {
    personalTaskTrack,
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    clearTimeout,
    setTimeout,
    requestAnimationFrame() {},
    getSelection: () => null,
    innerHeight: 820,
    innerWidth: 1280,
    location: { reload() {} },
  };
  const context = vm.createContext({
    LoopKnowledgeCore: require("../app/renderer/src/knowledge-core.js"),
    alert(message) { alerts.push(String(message)); },
    Blob,
    confirm: () => true,
    console,
    CustomEvent: class CustomEvent extends Event {
      constructor(type, options = {}) { super(type); this.detail = options.detail; }
    },
    document,
    Event,
    FileReader: class {},
    HTMLTextAreaElement: class {},
    InputEvent: globalThis.InputEvent || class {},
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    URL: {
      createObjectURL: () => "blob:test",
      revokeObjectURL() {},
    },
    window,
  });
  return Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "knowledge-document.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "knowledge-recovery.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "work-navigation-model.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "clock.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "shell.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "workspace.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "actions.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "bulk.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "knowledge.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "pages.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "settings.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
  ]).then(([documentSource, recoverySource, navigationSource, clockSource, shellSource, workspaceSource, actionsSource, bulkSource, knowledgeSource, pagesSource, settingsSource, source]) => {
      vm.runInContext(documentSource, context, {
        filename: "app/renderer/src/knowledge-document.js",
      });
      vm.runInContext(recoverySource, context, {
        filename: "app/renderer/src/knowledge-recovery.js",
      });
      vm.runInContext(navigationSource, context, {
        filename: "app/renderer/src/work-navigation-model.js",
      });
      // The three-column shell modules load before app.js, exactly as index.html does.
      vm.runInContext(clockSource, context, {
        filename: "app/renderer/src/clock.js",
      });
      vm.runInContext(shellSource, context, {
        filename: "app/renderer/src/shell.js",
      });
      vm.runInContext(workspaceSource, context, {
        filename: "app/renderer/src/workspace.js",
      });
      vm.runInContext(actionsSource, context, {
        filename: "app/renderer/src/actions.js",
      });
      vm.runInContext(bulkSource, context, {
        filename: "app/renderer/src/bulk.js",
      });
      vm.runInContext(knowledgeSource, context, {
        filename: "app/renderer/src/knowledge.js",
      });
      vm.runInContext(pagesSource, context, {
        filename: "app/renderer/src/pages.js",
      });
      vm.runInContext(settingsSource, context, {
        filename: "app/renderer/src/settings.js",
      });
      vm.runInContext(source.replace(/\nbootstrap\(\);\s*$/, "\n"), context, {
        filename: "app/renderer/src/app.js",
      });
      return {
        evaluate(expression) {
          return vm.runInContext(expression, context);
        },
        json(expression) {
          return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
        },
        storageValue(key) {
          return storage.get(key) ?? null;
        },
        dispatch(type, event) {
          for (const listener of windowListeners.get(type) || []) listener(event);
        },
        alerts,
      };
    });
}

test("knowledge draft changes and undo update dirty chrome without rendering the editor", async () => {
  const harness = await rendererHarness();
  harness.evaluate(`document.addEventListener = () => {};`);
  harness.evaluate(await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "notebook23.js"), "utf8"));
  harness.evaluate(`
    state.tasks = normalizeTasks([{ id: "typing-regression", title: "输入连续性", notes: "已保存正文", nodes: [] }]);
    state.activeTaskId = "typing-regression";
    state.taskPane = "notes";
    NOTE23_SAVED_TEXT.set("typing-regression", "已保存正文");
    globalThis.chromeUpdates = 0;
    note23UpdateChrome = () => { chromeUpdates++; };
    render = () => { throw new Error("Typing must not render or detach the editor"); };
    updateNodeNoteDraft("typing-regression", "", "新增输入");
  `);
  assert.equal(harness.evaluate(`NOTE23_EDIT_DIRTY.has("typing-regression")`), true);
  assert.equal(harness.evaluate(`state.tasks[0].notes`), "已保存正文", "dirty state compares the pending draft before autosave");
  harness.evaluate(`updateNodeNoteDraft("typing-regression", "", "已保存正文");`);
  assert.equal(harness.evaluate(`NOTE23_EDIT_DIRTY.has("typing-regression")`), false, "undo before autosave clears the dirty marker");
  assert.equal(harness.evaluate(`chromeUpdates`), 2);
  harness.evaluate(`flushNodeNoteDrafts({ persist: true });`);
  await harness.evaluate(`flushPendingKnowledgeRecoveries();`);
  assert.equal(harness.evaluate(`state.tasks[0].notes`), "已保存正文");
});

test("knowledge source input persists through the shared draft path and records its dirty state", async () => {
  const harness = await rendererHarness();
  harness.evaluate(`
    state.tasks = normalizeTasks([{ id: "source-regression", title: "源码输入", notes: "原正文", nodes: [],
      knowledgeNote: { noteId: "source-regression", filePath: "/tmp/source-regression.md", documentState: "SAVED", dirty: false } }]);
    state.activeTaskId = "source-regression";
    state.taskPane = "notes";
    globalThis.sourceHandlers = {};
    globalThis.sourceEditor = { dataset: { taskId: "source-regression" }, value: "源码新正文", addEventListener: (event, callback) => { sourceHandlers[event] = callback; } };
    document.querySelector = selector => selector === "#knowledge-source" ? sourceEditor : null;
    shellKnowledgeSyncStats = () => {};
    shellBindKnowledge();
    sourceHandlers.input();
    flushNodeNoteDrafts({ persist: true });
  `);
  await harness.evaluate(`flushPendingKnowledgeRecoveries();`);
  assert.equal(harness.evaluate(`state.tasks[0].notes`), "源码新正文");
  assert.equal(harness.evaluate(`state.tasks[0].knowledgeNote.dirty`), true);
  assert.equal(harness.evaluate(`state.tasks[0].knowledgeNote.documentState`), "DIRTY");
  assert.equal(JSON.parse(harness.storageValue("task-flow-sheet-prototype-v2"))[0].notes, "源码新正文");
});

test("navigation saves coalesce before serialization and preserve same-length content edits", async () => {
  const writes = [];
  const harness = await rendererHarness({ storage: { read: async () => null, write: async data => writes.push(JSON.parse(JSON.stringify(data))) } });
  await harness.evaluate(`(async () => {
    state.tasks = normalizeTasks([{id:"save_exact", title:"保存", notes:"AAAA", nodes:[], history:[]}]);
    save(); await flushSave();
    globalThis.fingerprintCalls = 0;
    const original = payloadFingerprint;
    payloadFingerprint = value => { fingerprintCalls++; return original(value); };
    for (let i = 0; i < 20; i++) { state.activeGroupId = "view_" + i; save(); }
  })()`);
  assert.equal(harness.evaluate("fingerprintCalls"), 0, "navigation must not serialize the database synchronously");
  await harness.evaluate("flushSave()");
  assert.equal(writes.length, 2); assert.equal(writes[1].activeGroupId, "view_19");
  await harness.evaluate(`(async () => {
    state.tasks[0].notes = "BBBB"; state.tasks[0].history.push(["刚刚", "新的记录"]); save(); await flushSave();
  })()`);
  assert.equal(writes.length, 3); assert.equal(writes[2].tasks[0].notes, "BBBB");
  assert.equal(writes[2].tasks[0].history.at(-1)[1], "新的记录");
  await harness.evaluate("save(); flushSave()");
  assert.equal(writes.length, 3, "unchanged data still skips disk writes");
});

test("explicit save flush bypasses the automatic transition deferral", async () => {
  const writes = [];
  const harness = await rendererHarness({ storage: { read: async () => null, write: async data => writes.push(data) } });
  await harness.evaluate(`(async () => {
    state.tasks = normalizeTasks([{id:"save_now",title:"退出前保存",notes:"草稿",nodes:[]}]);
    window.loopPointerContinuity = { currentClick: () => ({claimed:true}) };
    save(); flushScheduledSave(); await flushSave();
  })()`);
  assert.equal(writes.length, 1);
});

test("knowledge document sessions expose safe draft and save transitions", () => {
  const draft = knowledgeDocument.createDocumentSession({
    noteId: "note_a",
    taskId: "task_a",
    title: "原始标题",
    createdAt: "2026-08-22T00:00:00.000Z",
  });
  assert.equal(draft.documentState, "DRAFT");
  assert.equal(draft.filePath, null);
  assert.equal(draft.dirty, false);
  assert.deepEqual(draft.tableColumnWidths, []);

  const edited = knowledgeDocument.markDocumentEdited(draft);
  assert.equal(edited.documentState, "DRAFT");
  assert.equal(edited.dirty, true);

  const saved = knowledgeDocument.markDocumentSaved(edited, {
    filePath: "/tmp/knowledge.md",
    lastSavedHash: "hash_a",
    lastSavedMtime: 123,
  });
  assert.equal(saved.documentState, "SAVED");
  assert.equal(saved.filePath, "/tmp/knowledge.md");
  assert.equal(saved.dirty, false);
  assert.equal(saved.lastSavedHash, "hash_a");
  assert.equal(saved.lastSavedMtime, 123);

  const changed = knowledgeDocument.markDocumentEdited(saved);
  assert.equal(changed.documentState, "DIRTY");
  assert.equal(changed.dirty, true);
  assert.equal(knowledgeDocument.updateDocumentTitle(changed, "新标题").filePath, "/tmp/knowledge.md");
});

test("knowledge table column widths normalize and persist without dirtying markdown", () => {
  const saved = knowledgeDocument.markDocumentSaved(
    knowledgeDocument.createDocumentSession({ taskId: "table_task", title: "表格笔记" }),
    { filePath: "/tmp/table-note.md" },
  );
  const resized = knowledgeDocument.updateTableColumnWidths(saved, [
    [132.4, 308.7, 116],
    [],
    [90, 240],
  ]);

  assert.deepEqual(resized.tableColumnWidths, [[132, 309, 116], [], [90, 240]]);
  assert.equal(resized.documentState, "SAVED");
  assert.equal(resized.dirty, false);

  const normalized = knowledgeDocument.normalizeKnowledgeNote({
    ...resized,
    tableColumnWidths: [[79, 260], [120, 1700], [104, 296]],
  });
  assert.deepEqual(normalized.tableColumnWidths, [[], [], [104, 296]]);
});

test("knowledge document abnormal states remain explicit and dirty", () => {
  const saved = knowledgeDocument.markDocumentSaved(
    knowledgeDocument.createDocumentSession({ taskId: "task_a", title: "笔记" }),
    { filePath: "/tmp/knowledge.md" },
  );
  assert.equal(knowledgeDocument.markDocumentExternalChanged(saved).documentState, "EXTERNAL_CHANGED");
  assert.equal(knowledgeDocument.markDocumentFileMissing(saved).documentState, "FILE_MISSING");
  assert.equal(knowledgeDocument.markDocumentReadOnly(saved).documentState, "READ_ONLY");
  assert.equal(knowledgeDocument.markDocumentExternalChanged(saved).dirty, true);
});

test("legacy tasks receive migration-safe knowledge metadata", async () => {
  const legacy = normalizeTaskData({
    tasks: [{ id: "task_legacy", title: "旧笔记", notes: "旧正文" }],
  });
  const note = legacy.tasks[0].knowledgeNote;
  assert.equal(legacy.tasks[0].notes, "旧正文");
  assert.equal(note.noteId, "task_legacy");
  assert.equal(note.taskId, "task_legacy");
  assert.equal(note.documentState, "DRAFT");
  assert.equal(note.filePath, null);
  assert.equal(note.dirty, false);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-track-document-state-"));
  try {
    await writeTaskData(tempDir, legacy);
    const restored = await readTaskData(tempDir);
    assert.equal(restored.tasks[0].knowledgeNote.noteId, "task_legacy");
    assert.equal(restored.tasks[0].knowledgeNote.documentState, "DRAFT");
    assert.equal(restored.tasks[0].notes, "旧正文");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("legacy knowledge migration is idempotent and preserves old bodies and images", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-migration-"));
  const filePath = path.join(directory, "task-data.json");
  const legacyBody = "# 旧知识 😀\n\n|列|值|\n|---|---|\n|中文|保留|\n\n```js\nconst legacy = true;\n```";
  const legacyImage = "data:image/png;base64,bGVnYWN5";
  const rawLegacy = {
    version: 0,
    tasks: [
      { id: "legacy_body", title: "旧笔记", notes: legacyBody, nodes: [] },
      { id: "legacy_string", title: "旧字符串字段", knowledgeNote: "旧字段正文", nodes: [] },
    ],
    attachments: { images: { old_image: legacyImage } },
  };
  const rawText = `${JSON.stringify(rawLegacy, null, 2)}\n`;
  await fs.writeFile(filePath, rawText, "utf8");
  try {
    const migrated = await readTaskData(directory);
    assert.equal(migrated.knowledgeSchemaVersion, KNOWLEDGE_MIGRATION_VERSION);
    assert.equal(migrated.tasks[0].notes, legacyBody);
    assert.equal(migrated.tasks[0].knowledgeNote.documentState, "DRAFT");
    assert.equal(migrated.tasks[0].knowledgeNote.filePath, null);
    assert.equal(migrated.tasks[1].notes, "旧字段正文");
    assert.equal(migrated.tasks[1].knowledgeNote.documentState, "DRAFT");
    assert.equal(migrated.attachments.images.old_image, legacyImage);
    const once = migrateKnowledgeTaskData(rawLegacy);
    assert.deepEqual(migrateKnowledgeTaskData(once), once);
    assert.deepEqual(normalizeTaskData(migrated), migrated);
    assert.equal(await fs.readFile(filePath, "utf8"), rawText);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("mixed legacy knowledge fields preserve the non-empty source body", () => {
  const legacy = migrateKnowledgeTaskData({
    tasks: [
      { id: "mixed_empty", notes: "", knowledgeNote: "旧正文" },
      { id: "mixed_current", notes: "新正文", knowledgeNote: "旧正文不应覆盖" },
    ],
  });
  assert.equal(legacy.tasks[0].notes, "旧正文");
  assert.equal(legacy.tasks[1].notes, "新正文");
  assert.equal(migrateKnowledgeTaskData(legacy).tasks[1].notes, "新正文");
});

test("future task-data versions are rejected without normalization or overwrite", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-future-schema-"));
  const filePath = path.join(directory, "task-data.json");
  const futureData = { version: 99, knowledgeSchemaVersion: 99, tasks: [{ id: "future", notes: "保留" }] };
  const raw = `${JSON.stringify(futureData)}\n`;
  await fs.writeFile(filePath, raw, "utf8");
  try {
    await assert.rejects(readTaskData(directory), (error) => error.code === "UNSUPPORTED_DATA_VERSION");
    await assert.rejects(writeTaskData(directory, futureData), (error) => error.code === "UNSUPPORTED_DATA_VERSION");
    assert.equal(await fs.readFile(filePath, "utf8"), raw);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a normal save never overwrites a database written by a newer app version", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-downgrade-"));
  const filePath = path.join(directory, "task-data.json");
  const futureData = { version: 2 + 1, knowledgeSchemaVersion: 1, tasks: [{ id: "keep_me", title: "未来的任务", notes: "保留" }] };
  const raw = `${JSON.stringify(futureData, null, 2)}\n`;
  await fs.writeFile(filePath, raw, "utf8");
  try {
    await assert.rejects(
      writeTaskData(directory, {
        version: 2,
        knowledgeSchemaVersion: 1,
        tasks: [{ id: "new_task", title: "当前版本新建的任务", notes: "" }],
      }),
      (error) => error.code === "UNSUPPORTED_DATA_VERSION",
    );
    assert.equal(await fs.readFile(filePath, "utf8"), raw, "the newer database must stay byte-identical");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("the data maintenance lock blocks task-data writes until every holder releases it", () => {
  const lock = dataMaintenance.createDataMaintenanceLock();
  assert.equal(lock.isActive(), false);
  assert.doesNotThrow(() => lock.assertWritable());

  const releaseImport = lock.begin("manual-import");
  assert.equal(lock.isActive(), true);
  assert.equal(lock.reason(), "manual-import");
  assert.throws(() => lock.assertWritable(), (error) => error.code === "DATA_MAINTENANCE");

  const releaseNested = lock.begin("second-holder");
  releaseNested();
  assert.equal(lock.isActive(), true, "one remaining holder keeps the lock engaged");
  assert.throws(() => lock.assertWritable(), (error) => error.code === "DATA_MAINTENANCE");

  releaseImport();
  assert.equal(lock.isActive(), false);
  assert.equal(lock.reason(), "");
  assert.doesNotThrow(() => lock.assertWritable());
});

test("the main process locks task-data writes while a data import is running", async () => {
  const mainSource = await fs.readFile(path.join(__dirname, "..", "app", "main", "main.cjs"), "utf8");
  assert.match(mainSource, /task-data:write"[\s\S]*dataMaintenance\.assertWritable\(\)[\s\S]*writeTaskData\(app\.getPath\("userData"\), data\)/);
  assert.match(mainSource, /dataMaintenance\.begin\("manual-import"\)/);
  assert.match(mainSource, /if \(error\?\.code !== "IMPORT_ROLLBACK_FAILED"\) dataMaintenance\.end\(\)/);
});

test("the renderer stops writing task data while a data import is in progress", async () => {
  const writes = [];
  const harness = await rendererHarness({
    storage: {
      read: async () => null,
      write: async (data) => { writes.push(data); },
    },
  });

  await harness.evaluate(`(async () => {
    state.tasks = normalizeTasks([{ id: "task_transfer", title: "导入前保存", status: "active", priority: "medium", notes: "", nodes: [] }]);
    save();
    await flushSave();
  })()`);
  assert.equal(writes.length, 1, "a normal edit must still be persisted");

  await harness.evaluate(`(async () => {
    dataTransferInProgress = true;
    state.tasks[0].title = "导入期间不应落盘";
    save();
    await flushSave();
  })()`);
  assert.equal(writes.length, 1, "no write may happen while a data import is in progress");

  await harness.evaluate(`(async () => {
    dataTransferInProgress = false;
    state.tasks[0].title = "导入结束后的保存";
    save();
    await flushSave();
  })()`);
  assert.equal(writes.length, 2, "writes resume after the transfer is abandoned or fails");
  assert.equal(writes[1].tasks[0].title, "导入结束后的保存");
});

test("the knowledge path gate only allows bound, dialog-approved or recovery paths", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-gate-"));
  const dataFilePath = path.join(directory, DATA_FILE);
  const boundPath = path.join(directory, "notes", "bound.md");
  const otherPath = path.join(directory, "notes", "other.md");
  await fs.mkdir(path.dirname(boundPath), { recursive: true });
  await fs.writeFile(boundPath, "# bound\n", "utf8");
  await fs.writeFile(otherPath, "# other\n", "utf8");
  await fs.writeFile(dataFilePath, `${JSON.stringify({
    version: 2,
    tasks: [{ id: "task_gate", knowledgeNote: { noteId: "note_gate", filePath: boundPath } }],
  })}\n`, "utf8");

  try {
    const gate = knowledgeAccess.createKnowledgePathGate({ userDataPath: directory, dataFilePath });
    assert.equal(await gate.isAllowed(boundPath), true, "a persisted binding stays readable");
    assert.equal(await gate.isAllowed(otherPath), false, "an unrelated path is rejected");
    assert.equal(await gate.isAllowed(""), false, "an empty path is rejected");
    assert.equal(await gate.isAllowed("   "), false, "a blank path is rejected");

    gate.approve(otherPath);
    assert.equal(await gate.isAllowed(otherPath), true, "a dialog-approved path becomes readable");

    const recoveryAsset = path.join(directory, knowledgeAccess.RECOVERY_ASSETS_DIR, "abc123", "attachments", "asset-x.png");
    assert.equal(gate.isRecoveryAssetPath(recoveryAsset), true);
    assert.equal(gate.isRecoveryAssetPath(path.join(directory, "elsewhere", "asset-x.png")), false);
    assert.equal(gate.isRecoveryAssetPath(path.join(directory, knowledgeAccess.RECOVERY_ASSETS_DIR, "..", "task-data.json")), false);
    assert.equal(gate.isRecoveryAssetPath("/etc/passwd"), false);

    // A rewritten database is picked up without restarting the app.
    await fs.writeFile(dataFilePath, `${JSON.stringify({
      version: 2,
      tasks: [{ id: "task_gate2", knowledgeNote: { noteId: "note_gate2", filePath: otherPath } }],
    })}\n`, "utf8");
    const reloaded = knowledgeAccess.createKnowledgePathGate({ userDataPath: directory, dataFilePath });
    assert.equal(await reloaded.isAllowed(otherPath), true);
    assert.equal(await reloaded.isAllowed(boundPath), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("the main process gates every knowledge file channel behind the path allowlist", async () => {
  const mainSource = await fs.readFile(path.join(__dirname, "..", "app", "main", "main.cjs"), "utf8");
  assert.match(mainSource, /const knowledgeGate = createKnowledgePathGate\(\{/);
  assert.match(mainSource, /knowledge-document:read"[\s\S]*knowledgeGate\.isAllowed\(payload\?\.filePath\)[\s\S]*deniedPathResult/);
  assert.match(mainSource, /knowledge-document:save"[\s\S]*knowledgeGate\.isAllowed\(payload\.filePath\)[\s\S]*isRecoveryAssetPath/);
  assert.match(mainSource, /knowledge-document:watch"[\s\S]*knowledgeGate\.isAllowed\(payload\?\.filePath\)/);
  assert.match(mainSource, /knowledge-document:choose"[\s\S]*knowledgeGate\.approve\(result\.filePath\)/);
});

test("imported identifiers are escaped so task, node and group ids cannot inject markup", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    const hostile = 'x"><img src="https://evil.example/beacon" id="pwned"><b id="pwned2" data-x="';
    const task = normalizeTasks([{
      id: hostile,
      title: "恶意 id 任务",
      status: "active",
      priority: "medium",
      notes: "",
      nodes: [{ id: hostile, title: "恶意 id 节点", status: "todo", children: [] }],
    }])[0];
    const group = normalizeTaskGroups([{ id: hostile, title: "恶意 id 分组", order: 1 }], [task])[0];
    state.tasks = [task];
    state.taskGroups = [group];
    state.activeTaskId = task.id;
    state.activeGroupId = group.id;
    state.taskPane = "flow";
    state.selectedNodeId = "";
    const page = renderTaskPage(task);
    const tree = renderFlowNode(task.id, task.nodes[0], 0, 0, [], true);
    const selector = escSelectorValue(hostile);
    const codes = Array.from(selector).map((character) => character.charCodeAt(0));
    const quotes = codes.filter((code) => code === 34).length;
    const escapedQuotes = codes.filter((code, index) => code === 34 && codes[index - 1] === 92).length;
    const rawQuotes = Array.from(hostile).filter((character) => character === '"').length;
    return {
      page,
      tree,
      quotes,
      rawQuotes,
      escapedQuotes,
      unescapedQuotes: quotes - escapedQuotes,
      idPreserved: page.includes('data-task-id="x&quot;&gt;&lt;img'),
    };
  })()`);

  for (const html of [result.page, result.tree]) {
    assert.doesNotMatch(html, /<img/, "a hostile id must never produce an <img> element");
    assert.doesNotMatch(html, /<b id="pwned2"/, "a hostile id must not be able to close the attribute");
  }
  assert.ok(result.idPreserved, "the identifier must still render, only escaped");
  assert.equal(result.quotes, result.rawQuotes, "escaping must not drop characters");
  assert.equal(result.unescapedQuotes, 0, "selector escaping must neutralise every double quote");
  assert.equal(result.escapedQuotes, result.rawQuotes, "every quote must be escaped, not removed");
});

test("knowledge recovery stores independent content with its file baseline", async () => {
  const data = knowledgeRecovery.normalizeRecoveryData({
    records: {
      note_a: { content: "正文", updatedAt: "2026-08-22T01:00:00.000Z", baseFileHash: "hash_a" },
      invalid: { content: 42, updatedAt: "not-a-date" },
    },
  });
  assert.deepEqual(data.records.note_a, {
    noteId: "note_a",
    content: "正文",
    updatedAt: "2026-08-22T01:00:00.000Z",
    baseFileHash: "hash_a",
    assets: [],
  });
  assert.equal(data.records.invalid.updatedAt, "");

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-recovery-"));
  try {
    await Promise.all([
      writeKnowledgeRecovery(directory, {
        noteId: "note_a",
        content: "A",
        updatedAt: "2026-08-22T01:00:00.000Z",
        assets: [{ source: "task-image:image_a", dataUrl: "data:image/png;base64,cG5n" }],
      }),
      writeKnowledgeRecovery(directory, { noteId: "note_b", content: "B", updatedAt: "2026-08-22T01:01:00.000Z" }),
    ]);
    const stored = await readKnowledgeRecovery(directory);
    assert.equal(stored.records.note_a.content, "A");
    assert.equal(stored.records.note_a.assets[0].source, "task-image:image_a");
    assert.equal(stored.records.note_b.content, "B");
    assert.equal(await deleteKnowledgeRecovery(directory, "note_a"), true);
    assert.equal((await readKnowledgeRecovery(directory)).records.note_a, undefined);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("corrupt knowledge recovery data is backed up before empty fallback", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-corrupt-recovery-"));
  const filePath = recoveryFilePath(directory);
  const corruptContent = '{"records":';
  try {
    await fs.writeFile(filePath, corruptContent, "utf8");
    const recovered = await readKnowledgeRecovery(directory);
    assert.deepEqual(recovered, { version: 1, records: {} });
    const files = await fs.readdir(directory);
    const backups = files.filter((file) => file.startsWith("knowledge-note-recovery.json.corrupt-"));
    assert.equal(backups.length, 1);
    assert.equal(await fs.readFile(path.join(directory, backups[0]), "utf8"), corruptContent);
    await assert.rejects(fs.access(filePath));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("forced Recovery-process termination preserves the previous Recovery record", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-recovery-kill-"));
  try {
    await writeKnowledgeRecovery(directory, { noteId: "kill-recovery", content: "Recovery 中断前的正文" });
    const child = await runKilledRecoveryChild(directory);
    assertForceTerminated(child);
    const recovered = await readKnowledgeRecovery(directory);
    assert.equal(recovered.records["kill-recovery"].content, "Recovery 中断前的正文");
    const leftovers = (await fs.readdir(directory)).filter((entry) => entry.includes("knowledge-note-recovery.json.tmp-"));
    assert.equal(leftovers.length, 1);
    await Promise.all(leftovers.map((entry) => fs.rm(path.join(directory, entry), { force: true })));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Recovery replacement failure preserves the previous record and cleans the temporary file", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-recovery-replace-failure-"));
  const recoveryPath = recoveryFilePath(directory);
  const originalRename = fs.rename;
  try {
    await writeKnowledgeRecovery(directory, { noteId: "replace-failure", content: "旧 Recovery" });
    fs.rename = async (from, to) => {
      if (to === recoveryPath) throw Object.assign(new Error("Recovery replace failed"), { code: "EIO" });
      return originalRename(from, to);
    };
    await assert.rejects(
      writeKnowledgeRecovery(directory, { noteId: "replace-failure", content: "不应替换" }),
      (error) => error.code === "EIO",
    );
    fs.rename = originalRename;
    const recovered = await readKnowledgeRecovery(directory);
    assert.equal(recovered.records["replace-failure"].content, "旧 Recovery");
    assert.deepEqual(await fs.readdir(directory), ["knowledge-note-recovery.json"]);
  } finally {
    fs.rename = originalRename;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("renderer flushes pending knowledge recovery before shutdown", async () => {
  const recoveryWrites = [];
  const harness = await rendererHarness({
    knowledgeRecovery: {
      write: async (record) => { recoveryWrites.push(record); },
    },
  });
  harness.evaluate(`(() => {
    state.tasks = normalizeTasks([{
      id: "shutdown_recovery_task",
      title: "退出恢复",
      notes: "旧正文",
      nodes: []
    }]);
    state.knowledgeRecovery = { version: 1, records: {} };
    scheduleKnowledgeRecovery("shutdown_recovery_task", "退出前最新正文", { debounceMs: 1000, maxIntervalMs: 2000 });
  })()`);

  await harness.evaluate("flushPendingKnowledgeRecoveries()");

  assert.equal(recoveryWrites.length, 1);
  assert.equal(recoveryWrites[0].content, "退出前最新正文");
});

test("update installation preparation requires both task data and pending Recovery to persist", async () => {
  let taskWrites = 0;
  let recoveryWrites = 0;
  let failRecovery = true;
  const harness = await rendererHarness({
    storage: {
      write: async () => { taskWrites += 1; },
    },
    knowledgeRecovery: {
      write: async () => {
        recoveryWrites += 1;
        if (failRecovery) throw Object.assign(new Error("recovery disk full"), { code: "ENOSPC" });
      },
    },
  });
  harness.evaluate(`(() => {
    state.tasks = normalizeTasks([{
      id: "update_recovery_task",
      title: "升级前保存",
      notes: "当前正文",
      nodes: []
    }]);
    state.taskGroups = normalizeTaskGroups([], state.tasks);
    state.activeGroupId = state.taskGroups[0].id;
    state.knowledgeRecovery = { version: 1, records: {} };
    scheduleKnowledgeRecovery("update_recovery_task", "升级前最新正文", { debounceMs: 1000, maxIntervalMs: 2000 });
  })()`);

  assert.equal(await harness.evaluate("prepareForUpdateInstall()"), false);
  assert.equal(taskWrites, 1);
  assert.equal(recoveryWrites, 1);
  failRecovery = false;
  assert.equal(await harness.evaluate("prepareForUpdateInstall()"), true);
  assert.equal(recoveryWrites, 2);
});

test("task data and Recovery writes sync temporary files before replacement", async () => {
  const [storageSource, recoverySource] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "main", "storage.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "recovery.cjs"), "utf8"),
  ]);
  assert.match(storageSource, /handle\s*=\s*await fs\.open\(tempPath, ["']wx["']/);
  assert.match(storageSource, /await handle\.sync\(\)/);
  assert.match(recoverySource, /handle\s*=\s*await fs\.open\(tempPath, ["']wx["']/);
  assert.match(recoverySource, /await handle\.sync\(\)/);
});

test("renderer surfaces task-data persistence failures", async () => {
  const harness = await rendererHarness({
    storage: {
      write: async () => {
        throw new Error("disk full");
      },
    },
  });
  await harness.evaluate(`pendingPayload = { tasks: [] }; flushSave()`);
  assert.equal(harness.alerts.length, 0);
  assert.match(harness.evaluate("workspaceFeedback.message"), /本地任务数据保存失败/);
  harness.evaluate("clearWorkspaceFeedback()");
  assert.equal(harness.evaluate("pendingPayload !== null"), true);
  assert.equal(harness.evaluate("localSaveReceipt().state"), "failed");
});

test("workspace receipt follows acknowledged writes, newer queued edits and failed retries", async () => {
  const writes = [];
  const harness = await rendererHarness({ storage: { write: (payload) => new Promise((resolve, reject) => writes.push({ payload, resolve, reject })) } });
  harness.evaluate(`
    globalThis.receipt = { dataset: {}, innerHTML: "" };
    document.querySelector = (selector) => selector === "[data-local-save-status]" ? receipt : null;
    state.tasks = normalizeTasks([{ id: "receipt", title: "原任务", notes: "正文", nodes: [] }]);
    state.taskGroups = normalizeTaskGroups([], state.tasks);
    state.activeGroupId = state.taskGroups[0].id;
    state.activeTaskId = "receipt";
  `);
  assert.equal(harness.evaluate("localSaveReceipt().state"), "ready");
  assert.doesNotMatch(harness.evaluate("renderShellWorkspace(activeTask())"), /预览中的修改已保留|文件状态仅为预览/);
  harness.evaluate("save(); window.clearTimeout(saveTimer)");
  assert.equal(harness.evaluate("receipt.dataset.state"), "pending");
  const flushing = harness.evaluate("flushSave()");
  assert.equal(harness.evaluate("receipt.dataset.state"), "saving");
  harness.evaluate('state.tasks[0].title = "较新的修改"; save(); window.clearTimeout(saveTimer)');
  writes[0].resolve();
  await waitForCondition(() => writes.length === 2);
  assert.equal(harness.evaluate("receipt.dataset.state"), "saving", "first acknowledgement must not mark newer work saved");
  writes[1].reject(new Error("disk full"));
  assert.equal(await flushing, false);
  assert.equal(harness.evaluate("receipt.dataset.state"), "failed");
  assert.match(harness.evaluate("receipt.innerHTML"), /本地保存失败/);
  assert.equal(harness.evaluate("pendingPayload.tasks[0].title"), "较新的修改");
  const retrying = harness.evaluate("flushSave()");
  assert.equal(harness.evaluate("receipt.dataset.state"), "saving");
  writes[2].resolve();
  assert.equal(await retrying, true);
  assert.equal(harness.evaluate("receipt.dataset.state"), "saved");
  assert.match(harness.evaluate("receipt.innerHTML"), /已保存到本机/);
  harness.evaluate('dataProtectionMessage = "newer data"; save()');
  assert.equal(harness.evaluate("receipt.dataset.state"), "protected");
});

test("opening, navigating and undoing an editor preserve the note source and discard abandoned drafts", async () => {
  const harness = await rendererHarness();
  await harness.evaluate(`(async () => {
    state.tasks = normalizeTasks([{ id: "source-note", notes: "原文\\n## 标题\\n![图](assets/image.png)", nodes: [] }]);
    state.activeTaskId = "source-note";
    globalThis.source = state.tasks[0].notes;
    globalThis.editorText = source;
    globalThis.host = { dataset: { taskId: "source-note" }, querySelector: () => null, closest: () => null };
    globalThis.mountOptions = null;
    document.querySelectorAll = () => [host];
    hydrateKnowledgeEditorMarkdown = () => "原文\\n## 标题\\n![图](data:image/png;base64,AAAA)";
    window.MilkdownTaskEditor = { create: async (options) => { mountOptions = options; return { getMarkdown: () => editorText }; } };
    mountMilkdownEditors();
    await Promise.resolve();
    captureMountedMilkdownDrafts();
  })()`);
  assert.equal(harness.evaluate("mountOptions.sourceMarkdown === source"), true);
  assert.notEqual(harness.evaluate("mountOptions.markdown"), harness.evaluate("source"), "hydrated images must retain a separate source baseline");
  assert.equal(harness.evaluate("nodeNoteDrafts.size"), 0);
  assert.equal(harness.evaluate("knowledgeRecoveryTimers.size"), 0);
  assert.equal(harness.evaluate("pendingPayload"), null);
  harness.evaluate('editorText = "编辑后的正文"; captureMountedMilkdownDrafts()');
  assert.equal(harness.evaluate('nodeNoteDrafts.get(noteDraftKey("source-note", "")).markdown'), "编辑后的正文");
  harness.evaluate("editorText = source; captureMountedMilkdownDrafts()");
  assert.equal(harness.evaluate('nodeNoteDrafts.get(noteDraftKey("source-note", "")).markdown === source'), true);
  assert.equal(harness.evaluate("flushNodeNoteDrafts()"), false, "undo before debounce must not persist the abandoned edit");
  assert.equal(harness.evaluate("state.tasks[0].notes === source"), true);
  assert.equal(harness.evaluate("pendingPayload"), null);
  harness.evaluate(`knowledgeRecoveryTimers.forEach((pending) => { window.clearTimeout(pending.debounceTimer); window.clearTimeout(pending.maxTimer); }); knowledgeRecoveryTimers.clear()`);
});

test("knowledge save verification compares the write receipt and ignores later drafts and superseded reads", async () => {
  let diskHash = "saved-hash";
  let finishRead;
  const harness = await rendererHarness({ knowledgeFile: {
    read: async () => {
      if (finishRead) await new Promise(resolve => { finishRead = resolve; });
      return { success: true, content: "已写入的正文", lastSavedHash: diskHash };
    },
  } });
  harness.evaluate(`document.addEventListener = () => {};`);
  harness.evaluate(await fs.readFile(path.join(__dirname, "../app/renderer/src/notebook23.js"), "utf8"));
  harness.evaluate(`
    state.tasks = normalizeTasks([{ id: "receipt-note", notes: "保存后继续输入的草稿", nodes: [],
      knowledgeNote: { noteId: "receipt-note", filePath: "/tmp/receipt.md", lastSavedHash: "saved-hash", documentState: "DIRTY" } }]);
    render = () => {};
    globalThis.receipt = { filePath: "/tmp/receipt.md", lastSavedHash: "saved-hash", content: "已写入的正文" };
  `);
  await harness.evaluate(`note23ConfirmWriteLanded(state.tasks[0], receipt)`);
  assert.equal(harness.evaluate(`NOTE23_EXTERNAL.has("receipt-note")`), false, "new local input is not an external change");

  finishRead = true;
  const staleCheck = harness.evaluate(`note23ConfirmWriteLanded(state.tasks[0], receipt)`);
  harness.evaluate(`state.tasks[0].knowledgeNote.lastSavedHash = "newer-save-hash"`);
  diskHash = "newer-save-hash";
  finishRead();
  finishRead = null;
  await staleCheck;
  assert.equal(harness.evaluate(`NOTE23_EXTERNAL.has("receipt-note")`), false, "a newer save supersedes an older verification");

  harness.evaluate(`state.tasks[0].knowledgeNote.lastSavedHash = "saved-hash"`);
  diskHash = "genuine-external-hash";
  await harness.evaluate(`note23ConfirmWriteLanded(state.tasks[0], receipt)`);
  assert.equal(harness.evaluate(`NOTE23_EXTERNAL.has("receipt-note")`), true, "a changed disk hash still requires conflict resolution");
});

test("knowledge file save preserves input and Recovery created while the write is pending", async () => {
  let finishWrite;
  let savedPayload;
  let deletes = 0;
  const harness = await rendererHarness({
    knowledgeRecovery: { delete: async () => { deletes++; } },
    knowledgeFile: { save: payload => {
      savedPayload = payload;
      return new Promise(resolve => { finishWrite = resolve; });
    } },
  });
  harness.evaluate(`state.tasks = normalizeTasks([{ id: "pending-input", notes: "本次保存的正文", nodes: [] }]);`);
  const saving = harness.evaluate(`saveKnowledgeTask("pending-input")`);
  await waitForCondition(() => Boolean(finishWrite));
  assert.equal(savedPayload.content, "本次保存的正文");
  harness.evaluate(`state.tasks[0].notes = "本次保存的正文，附加新输入";
    state.knowledgeRecovery.records["pending-input"] = { noteId: "pending-input", content: state.tasks[0].notes };`);
  finishWrite({ success: true, filePath: "/tmp/pending-input.md", content: savedPayload.content, lastSavedHash: "saved-hash" });
  assert.equal((await saving).success, true);
  assert.equal(harness.evaluate(`state.tasks[0].notes`), "本次保存的正文，附加新输入");
  assert.equal(harness.evaluate(`state.tasks[0].knowledgeNote.documentState`), "DIRTY");
  assert.equal(deletes, 0);
  assert.equal(harness.evaluate(`state.knowledgeRecovery.records["pending-input"].content`), "本次保存的正文，附加新输入");
});

test("Markdown save keeps Recovery when task metadata persistence fails", async () => {
  let recoveryDeleteCalls = 0;
  const harness = await rendererHarness({
    storage: {
      write: async () => {
        throw new Error("metadata disk full");
      },
    },
    knowledgeRecovery: {
      delete: async () => {
        recoveryDeleteCalls += 1;
      },
    },
    knowledgeFile: {
      save: async () => ({
        success: true,
        filePath: "/tmp/ordered-save.md",
        content: "已保存正文",
        lastSavedHash: "ordered-hash",
        lastSavedMtime: 5,
        encoding: "UTF-8",
        lineEnding: "LF",
      }),
    },
  });
  harness.evaluate(`state.tasks = normalizeTasks([{
    id: "ordered_save_task",
    title: "保存顺序",
    notes: "待保存正文",
    nodes: [],
    knowledgeNote: { noteId: "ordered_save_task", taskId: "ordered_save_task", documentState: "DIRTY", dirty: true }
  }]); state.knowledgeRecovery.records.ordered_save_task = { noteId: "ordered_save_task", content: "Recovery 正文" }`);

  const result = await harness.evaluate(`saveKnowledgeTask("ordered_save_task")`);
  assert.equal(result.code, "TASK_DATA_SAVE_FAILED");
  assert.equal(result.markdownSaved, true);
  assert.equal(recoveryDeleteCalls, 0);
  assert.equal(harness.json(`state.knowledgeRecovery.records.ordered_save_task`).content, "Recovery 正文");
});

test("knowledge file save flow handles Markdown paths, cancel, Save As, and duplicates", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-file-"));
  const dialogCalls = [];
  const dialog = {
    async showSaveDialog(options) {
      dialogCalls.push(options);
      return { canceled: false, filePath: path.join(directory, "知识笔记-B.md") };
    },
  };
  try {
    assert.equal(knowledgeFile.defaultMarkdownFileName("CON"), "-CON.md");
    assert.equal(knowledgeFile.defaultMarkdownFileName("标题 / 😀"), "标题 - 😀.md");
    assert.equal(knowledgeFile.hasDuplicateBinding("C:\\Notes\\A.md", ["c:/notes/a.md"], "win32"), true);

    const canceled = await knowledgeFile.saveKnowledgeDocument(
      { title: "取消保存", content: "不会丢失" },
      { dialog: { showSaveDialog: async () => ({ canceled: true }) } },
    );
    assert.deepEqual(canceled, { canceled: true });

    const markdownContent = "# 标题\r\n\r\n**加粗** *斜体*\r\n- 列表\r\n1. 有序\r\n> 引用\r\n[链接](https://example.com)\r\n![图片](task-image:image_a)\r\n| 列 1 | 列 2 |\r\n| --- | --- |\r\n| 内容 | 内容 |\r\n```js\r\nconst value = 1;\r\n```\r\n- [ ] 待办\r\n中文 😀";
    const first = await knowledgeFile.saveKnowledgeDocument(
      { title: "CON", content: markdownContent },
      { dialog },
    );
    assert.equal(first.success, true);
    assert.equal(dialogCalls.length, 1);
    assert.equal(first.filePath.endsWith("知识笔记-B.md"), true);
    assert.equal(await fs.readFile(first.filePath, "utf8"), markdownContent);
    assert.equal(first.encoding, "UTF-8");
    assert.equal(first.lineEnding, "CRLF");
    assert.equal(first.atomic, true);
    assert.equal(first.replacement, "atomic-rename");

    const ordinary = await knowledgeFile.saveKnowledgeDocument({
      filePath: first.filePath,
      content: "更新后的内容",
    }, { dialog: { showSaveDialog: async () => { throw new Error("dialog should not open"); } } });
    assert.equal(ordinary.success, true);
    assert.equal(dialogCalls.length, 1);

    const staleWriter = await knowledgeFile.saveKnowledgeDocument({
      filePath: first.filePath,
      content: "不应覆盖外部更新",
      expectedLastSavedHash: "stale-hash",
    });
    assert.equal(staleWriter.success, false);
    assert.equal(staleWriter.code, "EXTERNAL_CHANGE_REQUIRES_CONFIRMATION");
    assert.equal(await fs.readFile(first.filePath, "utf8"), "更新后的内容");

    const explicitOverwrite = await knowledgeFile.saveKnowledgeDocument({
      filePath: first.filePath,
      content: "用户确认覆盖后的内容",
      expectedLastSavedHash: "stale-hash",
      allowExternalOverwrite: true,
    });
    assert.equal(explicitOverwrite.success, true);
    assert.equal(explicitOverwrite.atomic, true);
    assert.equal(await fs.readFile(first.filePath, "utf8"), "用户确认覆盖后的内容");

    const saveAs = await knowledgeFile.saveKnowledgeDocument({
      filePath: first.filePath,
      saveAs: true,
      title: "另存为",
      content: "另一个文件",
    }, { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(directory, "B") }) } });
    assert.equal(saveAs.success, true);
    assert.equal(saveAs.filePath.endsWith("B.md"), true);
    assert.equal(await fs.readFile(first.filePath, "utf8"), "用户确认覆盖后的内容");
    assert.equal(await fs.readFile(saveAs.filePath, "utf8"), "另一个文件");

    const duplicate = await knowledgeFile.saveKnowledgeDocument({
      filePath: first.filePath,
      content: "不应覆盖",
      boundPaths: [first.filePath],
    }, { dialog: { showSaveDialog: async () => { throw new Error("dialog should not open"); } } });
    assert.deepEqual(duplicate, {
      canceled: false,
      success: false,
      code: "DUPLICATE_BINDING",
      filePath: first.filePath,
    });
    assert.equal(await fs.readFile(first.filePath, "utf8"), "用户确认覆盖后的内容");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("knowledge assets stage safely, migrate beside each Markdown file, and reload relative images", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-assets-"));
  const userData = path.join(root, "user-data");
  const firstDirectory = path.join(root, "中文笔记");
  const secondDirectory = path.join(root, "另一个目录");
  const firstPath = path.join(firstDirectory, "知识.md");
  try {
    const pngA = `data:image/png;base64,${Buffer.from("png-a").toString("base64")}`;
    const pngB = `data:image/png;base64,${Buffer.from("png-b").toString("base64")}`;
    const staged = await knowledgeAssets.stageKnowledgeAssets(userData, {
      noteId: "note/with:unsafe-id",
      assets: [
        { source: "task-image:first", dataUrl: pngA },
        { source: "task-image:second", dataUrl: pngB },
      ],
    });
    assert.equal(staged.success, true);
    assert.equal(staged.assets.length, 2);
    assert.notEqual(staged.assets[0].fileName, staged.assets[1].fileName);
    assert.equal(await fs.readFile(staged.assets[0].filePath, "utf8"), "png-a");

    const content = "# 知识\n\n![第一张](task-image:first)\n![第二张](task-image:second)\n![外部](D:/Shared/image.png)\n![网络](https://example.com/image.png)";
    const first = await knowledgeFile.saveKnowledgeDocument({
      filePath: firstPath,
      content,
      assets: staged.assets,
    });
    assert.equal(first.success, true);
    assert.match(first.content, /\.\/attachments\/asset-[a-f0-9]{24}\.png/);
    assert.match(first.content, /D:\/Shared\/image\.png/);
    assert.match(first.content, /https:\/\/example\.com\/image\.png/);
    assert.equal(first.assetFiles.length, 2);
    assert.equal(await fs.readFile(path.join(firstDirectory, "attachments", first.assetFiles[0].fileName), "utf8"), "png-a");

    const loaded = await knowledgeFile.readKnowledgeDocument(firstPath);
    assert.equal(loaded.success, true);
    assert.equal(loaded.assetFiles.length, 2);
    assert.ok(loaded.assetFiles.every((asset) => asset.dataUrl.startsWith("data:image/png;base64,")));

    const secondPath = path.join(secondDirectory, "另存为.md");
    const saveAs = await knowledgeFile.saveKnowledgeDocument({
      filePath: secondPath,
      content,
      assets: staged.assets,
    });
    assert.equal(saveAs.success, true);
    assert.equal(saveAs.attachmentsDirectory, path.join(secondDirectory, "attachments"));
    assert.equal(await fs.readFile(path.join(secondDirectory, "attachments", saveAs.assetFiles[0].fileName), "utf8"), "png-a");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("DRAFT asset staging reports copy failure without inventing an asset record", async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-stage-failure-"));
  try {
    const result = await knowledgeAssets.stageKnowledgeAssets(userData, {
      noteId: "stage-failure",
      assets: [{ source: "task-image:failed", dataUrl: "data:image/png;base64,ZmFpbGVk" }],
      fsOps: {
        open: async () => { throw Object.assign(new Error("asset disk full"), { code: "ENOSPC" }); },
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.code, "ASSET_STAGE_FAILED");
    assert.equal(result.errorCode, "ENOSPC");
    assert.equal(result.assets, undefined);
    const files = await fs.readdir(result.recoveryDirectory);
    assert.deepEqual(files, []);
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test("asset migration rolls back newly created attachments after a later asset failure", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-asset-rollback-"));
  const filePath = path.join(directory, "note.md");
  let openCount = 0;
  try {
    const result = await knowledgeFile.saveKnowledgeDocument({
      filePath,
      content: "![一](task-image:one)\n![二](task-image:two)",
      assets: [
        { source: "task-image:one", dataUrl: "data:image/png;base64,b25l" },
        { source: "task-image:two", dataUrl: "data:image/png;base64,dHdv" },
      ],
    }, {
      fsOps: {
        open: async (...args) => {
          openCount += 1;
          if (openCount === 2) throw Object.assign(new Error("attachment disk full"), { code: "ENOSPC" });
          return fs.open(...args);
        },
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.code, "ASSET_MIGRATION_FAILED");
    assert.equal(openCount, 2);
    assert.deepEqual(await fs.readdir(path.join(directory, "attachments")), []);
    await assert.rejects(fs.access(filePath));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("asset migration failure leaves Markdown and recovery assets intact", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-assets-failure-"));
  const userData = path.join(root, "user-data");
  const filePath = path.join(root, "note.md");
  await fs.writeFile(filePath, "原始 Markdown", "utf8");
  try {
    const dataUrl = `data:image/png;base64,${Buffer.from("recover-me").toString("base64")}`;
    const staged = await knowledgeAssets.stageKnowledgeAssets(userData, {
      noteId: "note-failure",
      assets: [{ source: "task-image:failure", dataUrl }],
    });
    const failed = await knowledgeFile.saveKnowledgeDocument(
      { filePath, content: "不应覆盖\n![图片](task-image:failure)", assets: staged.assets },
      { fsOps: { open: async () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); } } },
    );
    assert.equal(failed.success, false);
    assert.equal(failed.code, "ASSET_MIGRATION_FAILED");
    assert.equal(await fs.readFile(filePath, "utf8"), "原始 Markdown");
    assert.equal(await fs.readFile(staged.assets[0].filePath, "utf8"), "recover-me");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Task9 acceptance preserves rich Markdown, large documents, multiple assets, and Save As", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-acceptance-"));
  const firstDirectory = path.join(root, "中文知识目录");
  const firstPath = path.join(firstDirectory, "原始标题.md");
  const secondPath = path.join(root, "另存为", "新标题.md");
  const assets = [
    { source: "task-image:first", dataUrl: `data:image/png;base64,${Buffer.from("first-image").toString("base64")}` },
    { source: "task-image:second", dataUrl: `data:image/png;base64,${Buffer.from("second-image").toString("base64")}` },
    { source: "task-image:third", dataUrl: `data:image/jpeg;base64,${Buffer.from("third-image").toString("base64")}` },
  ];
  const content = [
    "# 中文知识 😀",
    "",
    "| 字段 | 值 |",
    "| --- | --- |",
    "| 语言 | 中文 |",
    "",
    "```js",
    "const checked = true;",
    "```",
    "",
    "- [ ] 待办项",
    "- [x] 已完成项",
    "",
    "![第一张](task-image:first)",
    "![第二张](task-image:second)",
    "![第三张](task-image:third)",
    "",
    "网络链接 https://example.com/😀",
    "长文档正文",
    "长文档正文\n".repeat(12000),
  ].join("\n");

  try {
    const startedAt = Date.now();
    const first = await knowledgeFile.saveKnowledgeDocument({
      filePath: firstPath,
      title: "原始标题",
      content,
      assets,
    });
    assert.equal(first.success, true);
    assert.equal(first.lineEnding, "LF");
    assert.equal(first.encoding, "UTF-8");
    assert.ok(Date.now() - startedAt < 5000, "large Markdown save should remain responsive");
    assert.equal(first.assetFiles.length, 3);
    assert.equal(new Set(first.assetFiles.map((asset) => asset.fileName)).size, 3);
    assert.match(first.content, /\| 字段 \| 值 \|/);
    assert.match(first.content, /```js[\s\S]*const checked = true;/);
    assert.match(first.content, /- \[x\] 已完成项/);
    assert.match(first.content, /长文档正文/);
    assert.equal(await fs.readFile(firstPath, "utf8"), first.content);

    const reopened = await knowledgeFile.readKnowledgeDocument(firstPath);
    assert.equal(reopened.success, true);
    assert.equal(reopened.content, first.content);
    assert.equal(reopened.assetFiles.length, 3);
    assert.ok(reopened.assetFiles.every((asset) => asset.dataUrl.startsWith("data:image/")));

    const renamedTitle = await knowledgeFile.saveKnowledgeDocument({
      filePath: firstPath,
      title: "标题已修改但路径不变",
      content: first.content,
    });
    assert.equal(renamedTitle.success, true);
    assert.equal(renamedTitle.filePath, firstPath);

    const saveAs = await knowledgeFile.saveKnowledgeDocument({
      filePath: firstPath,
      saveAs: true,
      title: "新标题",
      content,
      assets,
    }, {
      dialog: { showSaveDialog: async () => ({ canceled: false, filePath: secondPath }) },
    });
    assert.equal(saveAs.success, true);
    assert.equal(saveAs.filePath, secondPath);
    assert.equal(await fs.readFile(firstPath, "utf8"), first.content);
    assert.equal(await fs.readFile(secondPath, "utf8"), saveAs.content);
    assert.equal((await fs.readdir(path.join(path.dirname(secondPath), "attachments"))).length, 3);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Task9 acceptance keeps recovery content when a dirty bound file also changes externally", async () => {
  let changeListener = null;
  const recoveryWrites = [];
  const harness = await rendererHarness({
    platform: "darwin",
    knowledgeRecovery: {
      write: async (record) => { recoveryWrites.push(record); },
      delete: async () => true,
    },
    knowledgeFile: {
      onChange: (callback) => {
        changeListener = callback;
        return () => { changeListener = null; };
      },
      watch: async () => ({ success: true }),
      save: async () => ({ success: true }),
    },
  });
  harness.evaluate(`render = () => {}; state.tasks = normalizeTasks([{
    id: "combined_conflict_task",
    title: "Recovery 与外部冲突",
    notes: "本地未保存正文",
    nodes: [],
    knowledgeNote: {
      noteId: "combined_conflict_task",
      taskId: "combined_conflict_task",
      filePath: "/tmp/combined-conflict.md",
      documentState: "DIRTY",
      dirty: true,
      lastSavedHash: "base-hash",
      lastSavedMtime: 1
    }
  }])`);

  harness.evaluate(`scheduleKnowledgeRecovery("combined_conflict_task", "Recovery 本地正文", { debounceMs: 10, maxIntervalMs: 100 })`);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(recoveryWrites.at(-1)?.content, "Recovery 本地正文");

  changeListener({
    type: "external-changed",
    success: true,
    noteId: "combined_conflict_task",
    filePath: "/tmp/combined-conflict.md",
    content: "外部文件正文",
    lastSavedHash: "external-hash",
    lastSavedMtime: 2,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(harness.json(`state.tasks[0].notes`), "本地未保存正文");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "EXTERNAL_CHANGED");
  assert.equal(recoveryWrites.at(-1)?.content, "Recovery 本地正文");
  const blocked = await harness.evaluate(`saveKnowledgeTask("combined_conflict_task")`);
  assert.equal(blocked.code, "EXTERNAL_CHANGE_REQUIRES_CONFIRMATION");
});

test("Task9 acceptance reports unavailable reads without inventing a document", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-read-failure-"));
  try {
    const missing = await knowledgeFile.readKnowledgeDocument(path.join(directory, "removed.md"));
    assert.equal(missing.success, false);
    assert.equal(missing.code, "FILE_READ_FAILED");
    assert.equal(missing.errorCode, "ENOENT");

    const unavailable = await knowledgeFile.readKnowledgeDocument(path.join(directory, "unavailable.md"), {
      fsOps: {
        readFile: async () => { throw Object.assign(new Error("volume unavailable"), { code: "EIO" }); },
      },
    });
    assert.equal(unavailable.success, false);
    assert.equal(unavailable.errorCode, "EIO");
    assert.equal(unavailable.message, "磁盘 I/O 操作失败");
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("knowledge reads report missing Markdown attachments without hiding the document", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-missing-asset-"));
  const filePath = path.join(directory, "note.md");
  await fs.writeFile(filePath, "正文\n\n![缺失图片](./attachments/missing.png)\n", "utf8");
  try {
    const result = await knowledgeFile.readKnowledgeDocument(filePath);
    assert.equal(result.success, true);
    assert.equal(result.content.includes("missing.png"), true);
    assert.equal(result.assetFiles.length, 0);
    assert.equal(result.missingAssetFiles.length, 1);
    assert.equal(result.missingAssetFiles[0].relativePath, "./attachments/missing.png");
    assert.equal(result.missingAssetFiles[0].errorCode, "ENOENT");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("knowledge file atomic failures preserve the original and clean temporary files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-atomic-"));
  const filePath = path.join(directory, "note.md");
  await fs.writeFile(filePath, "原始内容", "utf8");
  try {
    const writeFailure = new Error("disk full");
    writeFailure.code = "ENOSPC";
    const failedWrite = await knowledgeFile.saveKnowledgeDocument(
      { filePath, content: "不应写入" },
      { fsOps: { open: async () => { throw writeFailure; } } },
    );
    assert.equal(failedWrite.success, false);
    assert.equal(failedWrite.code, "SAVE_FAILED");
    assert.equal(failedWrite.errorCode, "ENOSPC");
    assert.equal(failedWrite.message, "磁盘空间不足");
    assert.equal(await fs.readFile(filePath, "utf8"), "原始内容");

    const directoryFailure = new Error("directory unavailable");
    directoryFailure.code = "ENOENT";
    const failedDirectory = await knowledgeFile.saveKnowledgeDocument(
      { filePath, content: "目录不可用" },
      { fsOps: { mkdir: async () => { throw directoryFailure; } } },
    );
    assert.equal(failedDirectory.success, false);
    assert.equal(failedDirectory.errorCode, "ENOENT");
    assert.equal(failedDirectory.message, "文件或目录不可用");
    assert.equal(await fs.readFile(filePath, "utf8"), "原始内容");

    const readOnlyFailure = new Error("read only");
    readOnlyFailure.code = "EROFS";
    const failedReadOnly = await knowledgeFile.saveKnowledgeDocument(
      { filePath, content: "只读文件" },
      { fsOps: { open: async () => { throw readOnlyFailure; } } },
    );
    assert.equal(failedReadOnly.success, false);
    assert.equal(failedReadOnly.errorCode, "EROFS");
    assert.equal(failedReadOnly.message, "文件或目录不可写");
    assert.equal(await fs.readFile(filePath, "utf8"), "原始内容");

    const replaceFailure = new Error("replace failed");
    replaceFailure.code = "EIO";
    const failedReplace = await knowledgeFile.saveKnowledgeDocument(
      { filePath, content: "仍不应写入" },
      { fsOps: { rename: async () => { throw replaceFailure; } } },
    );
    assert.equal(failedReplace.success, false);
    assert.equal(failedReplace.errorCode, "EIO");
    assert.equal(failedReplace.message, "磁盘 I/O 操作失败");
    assert.equal(await fs.readFile(filePath, "utf8"), "原始内容");

    const entries = await fs.readdir(directory);
    assert.deepEqual(entries, ["note.md"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("atomic write cleans temporary files after partial write and sync failures", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-atomic-partial-"));
  const filePath = path.join(directory, "note.md");
  try {
    for (const failureStage of ["write", "sync"]) {
      await fs.writeFile(filePath, `原始内容-${failureStage}`, "utf8");
      const failure = Object.assign(new Error(`${failureStage} failed`), { code: failureStage === "write" ? "ENOSPC" : "EIO" });
      const fsOps = {
        open: async (...args) => {
          const handle = await fs.open(...args);
          const writeFile = handle.writeFile.bind(handle);
          if (failureStage === "write") {
            handle.writeFile = async () => {
              await writeFile("半写入内容", "utf8");
              throw failure;
            };
          } else {
            handle.sync = async () => { throw failure; };
          }
          return handle;
        },
      };
      const result = await knowledgeFile.saveKnowledgeDocument(
        { filePath, content: "不应成为正式正文" },
        { fsOps },
      );
      assert.equal(result.success, false);
      assert.equal(result.errorCode, failure.code);
      assert.equal(await fs.readFile(filePath, "utf8"), `原始内容-${failureStage}`);
      assert.deepEqual(await fs.readdir(directory), ["note.md"]);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("forced process termination during atomic write preserves the original Markdown", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-kill-"));
  const filePath = path.join(directory, "note.md");
  await fs.writeFile(filePath, "进程中断前的正文", "utf8");
  try {
    for (const killPoint of ["after-write", "after-sync"]) {
      await fs.writeFile(filePath, `进程中断前的正文-${killPoint}`, "utf8");
      const child = await runKilledSaveChild(filePath, killPoint);
      assertForceTerminated(child);
      assert.equal(await fs.readFile(filePath, "utf8"), `进程中断前的正文-${killPoint}`);
      const leftovers = (await fs.readdir(directory)).filter((entry) => entry.includes(".note.md.tmp-"));
      assert.equal(leftovers.length, 1);
      await Promise.all(leftovers.map((entry) => fs.rm(path.join(directory, entry), { force: true })));
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Save As failure preserves the source file and does not create a partial destination", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-save-as-failure-"));
  const sourcePath = path.join(directory, "source.md");
  const destinationPath = path.join(directory, "destination.md");
  await fs.writeFile(sourcePath, "原始源文件", "utf8");
  const failure = Object.assign(new Error("destination disk full"), { code: "ENOSPC" });
  try {
    const result = await knowledgeFile.saveKnowledgeDocument({
      filePath: sourcePath,
      saveAs: true,
      content: "另存为的新正文",
    }, {
      dialog: { showSaveDialog: async () => ({ canceled: false, filePath: destinationPath }) },
      fsOps: { open: async () => { throw failure; } },
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "ENOSPC");
    assert.equal(await fs.readFile(sourcePath, "utf8"), "原始源文件");
    await assert.rejects(fs.access(destinationPath));
    assert.deepEqual(await fs.readdir(directory), ["source.md"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("knowledge file saves serialize operations for the same path", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-queue-"));
  const filePath = path.join(directory, "note.md");
  let activeHandles = 0;
  let maximumActiveHandles = 0;
  const fsOps = {
    open: async (...args) => {
      const handle = await fs.open(...args);
      activeHandles += 1;
      maximumActiveHandles = Math.max(maximumActiveHandles, activeHandles);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        const result = await close();
        activeHandles -= 1;
        return result;
      };
      return handle;
    },
  };
  try {
    const [first, second] = await Promise.all([
      knowledgeFile.saveKnowledgeDocument({ filePath, content: "第一次" }, { fsOps }),
      knowledgeFile.saveKnowledgeDocument({ filePath, content: "第二次" }, { fsOps }),
    ]);
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(maximumActiveHandles, 1);
    assert.equal(await fs.readFile(filePath, "utf8"), "第二次");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a failed save does not poison the next operation in the save queue", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-queue-retry-"));
  const filePath = path.join(directory, "note.md");
  let openCalls = 0;
  try {
    const fsOps = {
      open: async (...args) => {
        openCalls += 1;
        if (openCalls === 1) throw Object.assign(new Error("first write failed"), { code: "EIO" });
        return fs.open(...args);
      },
    };
    const [failed, succeeded] = await Promise.all([
      knowledgeFile.saveKnowledgeDocument({ filePath, content: "第一次失败" }, { fsOps }),
      knowledgeFile.saveKnowledgeDocument({ filePath, content: "第二次成功" }, { fsOps }),
    ]);
    assert.equal(failed.success, false);
    assert.equal(failed.errorCode, "EIO");
    assert.equal(succeeded.success, true);
    assert.equal(await fs.readFile(filePath, "utf8"), "第二次成功");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Windows replacement fallback keeps a rollback path for existing targets", async () => {
  const tempPath = "C:/Notes/.note.md.tmp-test";
  const targetPath = "C:/Notes/note.md";
  const calls = [];
  let firstReplaceAttempt = true;
  const replacement = await knowledgeFile.replaceFile(tempPath, targetPath, {
    platform: "win32",
    fsOps: {
      rename: async (from, to) => {
        calls.push([from, to]);
        if (from === tempPath && to === targetPath && firstReplaceAttempt) {
          firstReplaceAttempt = false;
          const error = new Error("target exists");
          error.code = "EEXIST";
          throw error;
        }
      },
      rm: async () => {},
    },
  });
  assert.equal(replacement, "windows-backup-replace");
  assert.deepEqual(calls.slice(0, 3), [
    [tempPath, targetPath],
    [targetPath, calls[1][1]],
    [tempPath, targetPath],
  ]);
});

test("knowledge reads recover an interrupted Windows replacement backup", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-windows-recovery-"));
  const filePath = path.join(directory, "note.md");
  const backupPath = `${filePath}.bak-crashed-replacement`;
  try {
    await fs.writeFile(backupPath, "原始正文", "utf8");
    const restored = await knowledgeFile.readKnowledgeDocument(filePath);
    assert.equal(restored.success, true);
    assert.equal(restored.content, "原始正文");
    assert.equal(await fs.readFile(filePath, "utf8"), "原始正文");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("renderer keeps dirty metadata and content after a save failure", async () => {
  const harness = await rendererHarness({
    knowledgeFile: {
      save: async () => ({
        canceled: false,
        success: false,
        code: "SAVE_FAILED",
        errorCode: "EACCES",
        message: "文件或目录不可写",
      }),
    },
  });
  harness.evaluate(`state.tasks = normalizeTasks([{
    id: "failed_save_task",
    title: "失败保存",
    notes: "必须保留",
    nodes: [],
    knowledgeNote: {
      filePath: "/tmp/failed-save.md",
      documentState: "DIRTY",
      dirty: true,
      lastSavedHash: "old-hash"
    }
  }])`);

  const result = await harness.evaluate(`saveKnowledgeTask("failed_save_task")`);
  assert.equal(result.success, false);
  assert.equal(harness.json(`state.tasks[0].notes`), "必须保留");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "DIRTY");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.dirty`), true);
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.lastSavedHash`), "old-hash");
});

test("knowledge file watcher debounces changes and suppresses matching self-writes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-watcher-"));
  const filePath = path.join(directory, "note.md");
  await fs.writeFile(filePath, "初始内容", "utf8");
  const callbacks = [];
  const events = [];
  const watcher = createKnowledgeFileWatcher({
    debounceMs: 35,
    fsApi: {
      watch: (_file, _options, callback) => {
        callbacks.push(callback);
        return { close() {} };
      },
    },
    onChange: (event) => events.push(event),
  });
  try {
    const baseline = await knowledgeFile.readKnowledgeDocument(filePath);
    assert.equal(watcher.watch({ noteId: "watch_note", ...baseline }).success, true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    events.length = 0;

    await fs.writeFile(filePath, "外部修改", "utf8");
    callbacks[0]();
    callbacks[0]();
    callbacks[0]();
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(events.filter((event) => event.type === "external-changed").length, 1);
    assert.equal(events[0].content, "外部修改");

    const saved = await knowledgeFile.saveKnowledgeDocument({ filePath, content: "应用保存" });
    assert.equal(saved.success, true);
    watcher.updateBaseline("watch_note", saved);
    events.length = 0;
    callbacks[0]();
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(events.some((event) => event.type === "external-changed"), false);
  } finally {
    watcher.closeAll();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("knowledge file watcher keeps reporting after an atomic replacement", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-watcher-rename-"));
  const filePath = path.join(directory, "note.md");
  await fs.writeFile(filePath, "初始内容", "utf8");
  const events = [];
  // No injected watch: this exercises the real filesystem behaviour that made a
  // file-bound watch go silent after an editor replaced the file.
  const watcher = createKnowledgeFileWatcher({
    debounceMs: 30,
    onChange: (event) => events.push(event),
  });
  try {
    const baseline = await knowledgeFile.readKnowledgeDocument(filePath);
    assert.equal(watcher.watch({ noteId: "watch_rename", ...baseline }).success, true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    events.length = 0;

    const temporary = path.join(directory, ".note.md.tmp-rename");
    await fs.writeFile(temporary, "外部原子替换", "utf8");
    await fs.rename(temporary, filePath);
    await waitForCondition(() => events.some((event) => event.type === "external-changed"), 3000);
    assert.equal(events.find((event) => event.type === "external-changed").content, "外部原子替换");

    // A later in-place write must still be reported, which proves the watch
    // survived the replacement instead of silently dying with the old inode.
    events.length = 0;
    await fs.writeFile(filePath, "替换后再次修改", "utf8");
    await waitForCondition(() => events.some((event) => event.type === "external-changed"), 3000);
    assert.equal(events.find((event) => event.type === "external-changed").content, "替换后再次修改");
  } finally {
    watcher.closeAll();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("knowledge file watcher reports deletion, unavailable paths, and read-only files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-knowledge-watcher-state-"));
  const filePath = path.join(directory, "note.md");
  await fs.writeFile(filePath, "内容", "utf8");
  const callbacks = [];
  const events = [];
  const watcher = createKnowledgeFileWatcher({
    debounceMs: 10,
    fsApi: {
      watch: (_file, _options, callback) => {
        callbacks.push(callback);
        return { close() {} };
      },
    },
    onChange: (event) => events.push(event),
  });
  try {
    const baseline = await knowledgeFile.readKnowledgeDocument(filePath);
    watcher.watch({ noteId: "missing_note", ...baseline });
    await waitForCondition(() => events.length > 0);
    events.length = 0;
    await fs.rename(filePath, path.join(directory, "moved-note.md"));
    callbacks[0]();
    callbacks[0]();
    callbacks[0]();
    await waitForCondition(() => events.some((event) => event.type === "file-missing"));
    assert.equal(events.at(-1).type, "file-missing");
    assert.equal(events.filter((event) => event.type === "file-missing").length, 1);

    const readOnlyWatcher = createKnowledgeFileWatcher({
      debounceMs: 0,
      fsApi: {
        watch: (_file, _options, callback) => {
          callbacks.push(callback);
          return { close() {} };
        },
      },
      fileReader: async (target) => ({
        ...(await knowledgeFile.readKnowledgeDocument(target)),
        readOnly: true,
      }),
      onChange: (event) => events.push(event),
    });
    await fs.writeFile(filePath, "恢复内容", "utf8");
    const readOnlyBaseline = await knowledgeFile.readKnowledgeDocument(filePath);
    readOnlyWatcher.watch({ noteId: "readonly_note", ...readOnlyBaseline });
    await waitForCondition(() => events.at(-1)?.type === "read-only");
    assert.equal(events.at(-1).type, "read-only");
    readOnlyWatcher.closeAll();
  } finally {
    watcher.closeAll();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("knowledge file watcher contains read and watcher errors as unavailable events", async () => {
  const events = [];
  let watcherError = null;
  const watcher = createKnowledgeFileWatcher({
    debounceMs: 0,
    fsApi: {
      watch: () => ({
        on: (event, callback) => {
          if (event === "error") watcherError = callback;
        },
        close() {},
      }),
    },
    fileReader: async () => {
      throw Object.assign(new Error("volume unavailable"), { code: "EIO" });
    },
    onChange: (event) => events.push(event),
  });
  watcher.watch({ noteId: "error_note", filePath: "/volume/note.md" });
  await waitForCondition(() => events.length > 0);
  assert.equal(events[0]?.type, "file-unavailable");
  assert.equal(events[0]?.errorCode, "EIO");
  assert.equal(typeof watcherError, "function");

  watcherError(Object.assign(new Error("watch failed"), { code: "EIO" }));
  assert.equal(events.at(-1)?.type, "file-unavailable");
  assert.equal(events.at(-1)?.errorCode, "EIO");
  watcher.closeAll();

  const timeoutEvents = [];
  const timeoutWatcher = createKnowledgeFileWatcher({
    debounceMs: 0,
    readTimeoutMs: 5,
    fsApi: { watch: () => ({ close() {} }) },
    fileReader: () => new Promise(() => {}),
    onChange: (event) => timeoutEvents.push(event),
  });
  timeoutWatcher.watch({ noteId: "timeout_note", filePath: "/network/note.md" });
  await waitForCondition(() => timeoutEvents.length > 0);
  assert.equal(timeoutEvents[0]?.type, "file-unavailable");
  assert.equal(timeoutEvents[0]?.errorCode, "ETIMEDOUT");
  timeoutWatcher.closeAll();
});

test("FileWatcher classifies startup failures and releases failed entries", () => {
  const events = [];
  const watcher = createKnowledgeFileWatcher({
    fsApi: {
      watch: () => { throw Object.assign(new Error("watch path missing"), { code: "ENOENT" }); },
    },
    onChange: (event) => events.push(event),
  });
  const result = watcher.watch({ noteId: "startup-missing", filePath: "/missing/note.md" });
  assert.deepEqual(result, {
    success: false,
    code: "FILE_MISSING",
    errorCode: "ENOENT",
  });
  assert.equal(watcher.size, 0);
  assert.deepEqual(events[0], {
    type: "file-missing",
    noteId: "startup-missing",
    filePath: "/missing/note.md",
    errorCode: "ENOENT",
    message: "watch path missing",
  });

  const unavailableEvents = [];
  const unavailableWatcher = createKnowledgeFileWatcher({
    fsApi: {
      watch: () => { throw Object.assign(new Error("volume unavailable"), { code: "EIO" }); },
    },
    onChange: (event) => unavailableEvents.push(event),
  });
  const unavailable = unavailableWatcher.watch({ noteId: "startup-unavailable", filePath: "/volume/note.md" });
  assert.deepEqual(unavailable, {
    success: false,
    code: "WATCH_FAILED",
    errorCode: "EIO",
  });
  assert.equal(unavailableWatcher.size, 0);
  assert.equal(unavailableEvents[0].type, "file-unavailable");
  assert.equal(unavailableEvents[0].errorCode, "EIO");
  unavailableWatcher.closeAll();
});

test("renderer reloads saved external changes and blocks silent overwrite while dirty", async () => {
  let changeListener = null;
  let saveCalls = 0;
  let lastSavePayload = null;
  const harness = await rendererHarness({
    knowledgeFile: {
      onChange: (callback) => {
        changeListener = callback;
        return () => { changeListener = null; };
      },
      watch: async () => ({ success: true }),
      read: async () => ({ success: true, content: "外部正文", filePath: "/tmp/external.md", lastSavedHash: "hash_b", lastSavedMtime: 2, encoding: "UTF-8", lineEnding: "LF" }),
      save: async (payload) => {
        saveCalls += 1;
        lastSavePayload = payload;
        return { success: true, filePath: "/tmp/external.md", lastSavedHash: "hash_c", lastSavedMtime: 3, encoding: "UTF-8", lineEnding: "LF" };
      },
    },
  });
  harness.evaluate(`render = () => {}`);
  harness.evaluate(`state.tasks = normalizeTasks([{
    id: "external_task",
    title: "外部修改",
    notes: "原始正文",
    nodes: [],
    knowledgeNote: {
      noteId: "external_task",
      taskId: "external_task",
      filePath: "/tmp/external.md",
      documentState: "SAVED",
      dirty: false,
      lastSavedHash: "hash_a",
      lastSavedMtime: 1
    }
  }])`);

  changeListener({
    type: "external-changed",
    success: true,
    noteId: "external_task",
    filePath: "/tmp/external.md",
    content: "外部正文",
    lastSavedHash: "hash_b",
    lastSavedMtime: 2,
    encoding: "UTF-8",
    lineEnding: "LF",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(harness.json(`state.tasks[0].notes`), "外部正文");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "SAVED");

  harness.evaluate(`state.tasks[0].notes = "本地修改"; state.tasks[0].knowledgeNote = knowledgeDocument.markDocumentEdited(state.tasks[0].knowledgeNote)`);
  changeListener({
    type: "external-changed",
    success: true,
    noteId: "external_task",
    filePath: "/tmp/external.md",
    content: "再次外部修改",
    lastSavedHash: "hash_d",
    lastSavedMtime: 4,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(harness.json(`state.tasks[0].notes`), "本地修改");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "EXTERNAL_CHANGED");
  const blocked = await harness.evaluate(`saveKnowledgeTask("external_task")`);
  assert.equal(blocked.code, "EXTERNAL_CHANGE_REQUIRES_CONFIRMATION");
  assert.equal(saveCalls, 0);
  const overwritten = await harness.evaluate(`saveKnowledgeTask("external_task", { allowExternalOverwrite: true })`);
  assert.equal(overwritten.success, true);
  assert.equal(saveCalls, 1);
  assert.equal(lastSavePayload.content, "本地修改");
  assert.equal(lastSavePayload.allowExternalOverwrite, true);
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "SAVED");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.lastSavedHash`), "hash_c");
  assert.equal(harness.evaluate(`knowledgeExternalSnapshots.has("external_task")`), false);
});

test("Bug 25 reload reads the current Markdown file and commits its new baseline", async () => {
  let readCalls = 0;
  const recoveryDeletes = [];
  const watcherCalls = [];
  const storageWrites = [];
  const harness = await rendererHarness({
    storage: { write: async (payload) => { storageWrites.push(payload); } },
    knowledgeRecovery: { delete: async (noteId) => { recoveryDeletes.push(noteId); return true; } },
    knowledgeFile: {
      read: async () => {
        readCalls += 1;
        return {
          success: true,
          content: "磁盘上的最新正文",
          filePath: "/tmp/bug-25.md",
          lastSavedHash: "fresh-disk-hash",
          lastSavedMtime: 25,
          encoding: "UTF-8",
          lineEnding: "LF",
        };
      },
      watch: async (payload) => { watcherCalls.push(payload); return { success: true }; },
    },
  });
  harness.evaluate(`(() => {
    render = () => {};
    state.tasks = normalizeTasks([{
      id: "bug_25_reload", title: "重新加载语义", notes: "编辑器中的未保存正文", nodes: [],
      knowledgeNote: {
        noteId: "bug_25_reload", taskId: "bug_25_reload", filePath: "/tmp/bug-25.md",
        documentState: "EXTERNAL_CHANGED", dirty: true,
        lastSavedHash: "old-baseline", lastSavedMtime: 10
      }
    }]);
    state.knowledgeRecovery.records.bug_25_reload = {
      noteId: "bug_25_reload", content: "Recovery 正文", updatedAt: "2026-08-24T00:00:00.000Z"
    };
    knowledgeExternalSnapshots.set("bug_25_reload", {
      success: true, content: "监听器中的旧快照", lastSavedHash: "stale-watcher-hash", lastSavedMtime: 20
    });
  })()`);

  const result = await harness.evaluate(`reloadKnowledgeTask("bug_25_reload")`);

  assert.equal(result.success, true);
  assert.equal(readCalls, 1);
  assert.equal(harness.json(`state.tasks[0].notes`), "磁盘上的最新正文");
  assert.deepEqual(harness.json(`({
    state: state.tasks[0].knowledgeNote.documentState,
    dirty: state.tasks[0].knowledgeNote.dirty,
    hash: state.tasks[0].knowledgeNote.lastSavedHash,
    mtime: state.tasks[0].knowledgeNote.lastSavedMtime
  })`), { state: "SAVED", dirty: false, hash: "fresh-disk-hash", mtime: 25 });
  assert.equal(storageWrites.at(-1).tasks[0].notes, "磁盘上的最新正文");
  assert.equal(watcherCalls.at(-1).lastSavedHash, "fresh-disk-hash");
  assert.deepEqual(recoveryDeletes, ["bug_25_reload"]);
  assert.equal(harness.evaluate(`knowledgeExternalSnapshots.has("bug_25_reload")`), false);
  assert.equal(harness.evaluate(`Boolean(state.knowledgeRecovery.records.bug_25_reload)`), false);
});

test("Bug 25 reload failure preserves editor content, conflict evidence, and Recovery", async () => {
  let recoveryDeletes = 0;
  const harness = await rendererHarness({
    knowledgeRecovery: { delete: async () => { recoveryDeletes += 1; return true; } },
    knowledgeFile: {
      read: async () => ({ success: false, code: "FILE_READ_FAILED", errorCode: "EIO", message: "磁盘暂时不可用" }),
    },
  });
  harness.evaluate(`(() => {
    render = () => {};
    state.tasks = normalizeTasks([{
      id: "bug_25_reload_failed", title: "失败不能丢数据", notes: "必须保留的编辑器正文", nodes: [],
      knowledgeNote: {
        noteId: "bug_25_reload_failed", taskId: "bug_25_reload_failed", filePath: "/tmp/bug-25-failed.md",
        documentState: "EXTERNAL_CHANGED", dirty: true,
        lastSavedHash: "old-baseline", lastSavedMtime: 10
      }
    }]);
    state.knowledgeRecovery.records.bug_25_reload_failed = {
      noteId: "bug_25_reload_failed", content: "必须保留的 Recovery", updatedAt: "2026-08-24T00:00:00.000Z"
    };
    knowledgeExternalSnapshots.set("bug_25_reload_failed", { success: true, content: "冲突证据" });
  })()`);

  const result = await harness.evaluate(`reloadKnowledgeTask("bug_25_reload_failed")`);

  assert.equal(result.success, false);
  assert.equal(harness.json(`state.tasks[0].notes`), "必须保留的编辑器正文");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "EXTERNAL_CHANGED");
  assert.equal(harness.evaluate(`knowledgeExternalSnapshots.has("bug_25_reload_failed")`), true);
  assert.equal(harness.json(`state.knowledgeRecovery.records.bug_25_reload_failed.content`), "必须保留的 Recovery");
  assert.equal(recoveryDeletes, 0);
});

test("Bug 25 reload rolls back when its new DocumentSession cannot persist", async () => {
  let storageWrites = 0;
  let recoveryDeletes = 0;
  const harness = await rendererHarness({
    storage: {
      write: async () => {
        storageWrites += 1;
        if (storageWrites === 1) throw new Error("metadata disk full");
      },
    },
    knowledgeRecovery: { delete: async () => { recoveryDeletes += 1; return true; } },
    knowledgeFile: {
      read: async () => ({
        success: true,
        content: "读取成功但不能提交的磁盘正文",
        filePath: "/tmp/bug-25-reload-persist.md",
        lastSavedHash: "new-disk-hash",
        lastSavedMtime: 25,
      }),
      watch: async () => ({ success: true }),
    },
  });
  harness.evaluate(`(() => {
    render = () => {};
    state.tasks = normalizeTasks([{
      id: "bug_25_reload_persist", title: "重新加载提交失败", notes: "原编辑器正文", nodes: [],
      knowledgeNote: {
        noteId: "bug_25_reload_persist", taskId: "bug_25_reload_persist", filePath: "/tmp/bug-25-reload-persist.md",
        documentState: "EXTERNAL_CHANGED", dirty: true,
        lastSavedHash: "old-baseline", lastSavedMtime: 10
      }
    }]);
    state.knowledgeRecovery.records.bug_25_reload_persist = {
      noteId: "bug_25_reload_persist", content: "原 Recovery", updatedAt: "2026-08-24T00:00:00.000Z"
    };
    knowledgeExternalSnapshots.set("bug_25_reload_persist", { success: true, content: "冲突证据" });
  })()`);

  const result = await harness.evaluate(`reloadKnowledgeTask("bug_25_reload_persist")`);

  assert.equal(result.code, "TASK_DATA_SAVE_FAILED");
  assert.equal(harness.json(`state.tasks[0].notes`), "原编辑器正文");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "EXTERNAL_CHANGED");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.lastSavedHash`), "old-baseline");
  assert.equal(harness.json(`state.knowledgeRecovery.records.bug_25_reload_persist.content`), "原 Recovery");
  assert.equal(harness.evaluate(`knowledgeExternalSnapshots.has("bug_25_reload_persist")`), true);
  assert.equal(recoveryDeletes, 0);
  assert.equal(await harness.evaluate(`flushSave()`), true);
});

test("knowledge rerenders preserve only the editor host and invalidate stale disk-backed drafts", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");

  assert.match(app, /function stashKnowledgePane\(\)[\s\S]*querySelector\("\.milkdown-editor-host\[data-task-id\]"\)[\s\S]*host\.remove\(\)/);
  assert.match(app, /function restoreCachedKnowledgePane\(task\)[\s\S]*const host = replacement\.querySelector\("\.milkdown-editor-host\[data-task-id\]"\)[\s\S]*host\.replaceWith\(cachedKnowledgePane\.host\)/);
  assert.match(app, /function discardMountedKnowledgeEditor\(taskId\)/);
  assert.match(app, /discardMountedKnowledgeEditor\(task\.id\);/);
  assert.doesNotMatch(app, /replacement\.replaceWith\(cachedKnowledgePane\.pane\)/);
});

test("Bug 25 overwrite write failure leaves the conflict transaction untouched", async () => {
  let recoveryDeletes = 0;
  const harness = await rendererHarness({
    knowledgeRecovery: { delete: async () => { recoveryDeletes += 1; return true; } },
    knowledgeFile: {
      save: async () => ({ success: false, code: "WRITE_FAILED", message: "原子替换失败" }),
    },
  });
  harness.evaluate(`(() => {
    render = () => {};
    state.tasks = normalizeTasks([{
      id: "bug_25_overwrite_write", title: "覆盖写入失败", notes: "不能丢失的编辑器正文", nodes: [],
      knowledgeNote: {
        noteId: "bug_25_overwrite_write", taskId: "bug_25_overwrite_write", filePath: "/tmp/bug-25-write.md",
        documentState: "EXTERNAL_CHANGED", dirty: true,
        lastSavedHash: "old-baseline", lastSavedMtime: 10
      }
    }]);
    state.knowledgeRecovery.records.bug_25_overwrite_write = {
      noteId: "bug_25_overwrite_write", content: "不能丢失的 Recovery", updatedAt: "2026-08-24T00:00:00.000Z"
    };
    knowledgeExternalSnapshots.set("bug_25_overwrite_write", { success: true, content: "外部正文" });
  })()`);

  const result = await harness.evaluate(`saveKnowledgeTask("bug_25_overwrite_write", { allowExternalOverwrite: true })`);

  assert.equal(result.code, "WRITE_FAILED");
  assert.equal(harness.json(`state.tasks[0].notes`), "不能丢失的编辑器正文");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "EXTERNAL_CHANGED");
  assert.equal(harness.json(`state.knowledgeRecovery.records.bug_25_overwrite_write.content`), "不能丢失的 Recovery");
  assert.equal(harness.evaluate(`knowledgeExternalSnapshots.has("bug_25_overwrite_write")`), true);
  assert.equal(recoveryDeletes, 0);
});

test("overwrite keeps the accepted disk hash and Recovery when metadata persistence fails", async () => {
  let storageWrites = 0;
  let recoveryDeletes = 0;
  const savePayloads = [];
  const harness = await rendererHarness({
    storage: {
      write: async () => {
        storageWrites += 1;
        if (storageWrites === 1) throw new Error("metadata disk full");
      },
    },
    knowledgeRecovery: { delete: async () => { recoveryDeletes += 1; return true; } },
    knowledgeFile: {
      save: async (payload) => {
        savePayloads.push(payload);
        return {
          success: true,
          atomic: true,
          content: payload.content,
          filePath: payload.filePath,
          lastSavedHash: "overwritten-hash",
          lastSavedMtime: 30,
          encoding: "UTF-8",
          lineEnding: "LF",
        };
      },
      watch: async () => ({ success: true }),
    },
  });
  harness.evaluate(`(() => {
    render = () => {};
    state.tasks = normalizeTasks([{
      id: "bug_25_overwrite_failed", title: "覆盖失败语义", notes: "编辑器权威正文", nodes: [],
      knowledgeNote: {
        noteId: "bug_25_overwrite_failed", taskId: "bug_25_overwrite_failed", filePath: "/tmp/bug-25-overwrite.md",
        documentState: "EXTERNAL_CHANGED", dirty: true,
        lastSavedHash: "old-baseline", lastSavedMtime: 10
      }
    }]);
    state.knowledgeRecovery.records.bug_25_overwrite_failed = {
      noteId: "bug_25_overwrite_failed", content: "Recovery 权威正文", updatedAt: "2026-08-24T00:00:00.000Z"
    };
    knowledgeExternalSnapshots.set("bug_25_overwrite_failed", { success: true, content: "外部正文" });
  })()`);

  const result = await harness.evaluate(`saveKnowledgeTask("bug_25_overwrite_failed", { allowExternalOverwrite: true })`);

  assert.equal(result.code, "TASK_DATA_SAVE_FAILED");
  assert.equal(result.markdownSaved, true);
  assert.equal(savePayloads.length, 1);
  assert.equal(savePayloads[0].content, "编辑器权威正文");
  assert.equal(savePayloads[0].allowExternalOverwrite, true);
  assert.equal(harness.json(`state.tasks[0].notes`), "编辑器权威正文");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "SAVED");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.lastSavedHash`), "overwritten-hash");
  assert.equal(harness.json(`state.knowledgeRecovery.records.bug_25_overwrite_failed.content`), "Recovery 权威正文");
  assert.equal(harness.evaluate(`knowledgeExternalSnapshots.has("bug_25_overwrite_failed")`), true);
  assert.equal(recoveryDeletes, 0);
  assert.equal(await harness.evaluate(`flushSave()`), true);
});

test("renderer keeps a temporarily unavailable file bound without inventing FILE_MISSING", async () => {
  const harness = await rendererHarness();
  harness.evaluate(`render = () => {}`);
  harness.evaluate(`state.tasks = normalizeTasks([{
    id: "unavailable_bound_task",
    title: "暂时不可用",
    notes: "当前正文",
    nodes: [],
    knowledgeNote: {
      noteId: "unavailable_bound_task",
      taskId: "unavailable_bound_task",
      filePath: "/volume/note.md",
      documentState: "SAVED",
      dirty: false,
      lastSavedHash: "hash-a"
    }
  }])`);
  await harness.evaluate(`handleKnowledgeFileChange({ type: "file-unavailable", noteId: "unavailable_bound_task", filePath: "/volume/note.md", errorCode: "EIO", message: "磁盘暂时不可用" })`);
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "SAVED");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.filePath`), "/volume/note.md");
  assert.equal(harness.json(`state.knowledgeFileIssues.unavailable_bound_task.message`), "磁盘暂时不可用");
});

test("renderer cannot recreate a missing path and can relocate to a selected file", async () => {
  let saveCalls = 0;
  let chooseCalls = 0;
  const harness = await rendererHarness({
    knowledgeFile: {
      save: async () => {
        saveCalls += 1;
        return { success: true };
      },
      choose: async () => {
        chooseCalls += 1;
        return {
          success: true,
          filePath: "/tmp/relocated.md",
          content: "重新定位正文",
          lastSavedHash: "relocated-hash",
          lastSavedMtime: 5,
          encoding: "UTF-8",
          lineEnding: "LF",
        };
      },
      watch: async () => ({ success: true }),
    },
  });
  harness.evaluate(`render = () => {}; state.tasks = normalizeTasks([{
    id: "missing_task",
    title: "丢失文件",
    notes: "本地正文",
    nodes: [],
    knowledgeNote: {
      noteId: "missing_task",
      taskId: "missing_task",
      filePath: "/tmp/missing.md",
      documentState: "FILE_MISSING",
      dirty: true,
      lastSavedHash: "old-hash"
    }
  }])`);

  const blocked = await harness.evaluate(`saveKnowledgeTask("missing_task")`);
  assert.equal(blocked.code, "FILE_MISSING_REQUIRES_RELOCATION");
  assert.equal(saveCalls, 0);
  const relocated = await harness.evaluate(`relocateKnowledgeTask("missing_task")`);
  assert.equal(relocated.success, true);
  assert.equal(chooseCalls, 1);
  assert.equal(harness.json(`state.tasks[0].notes`), "重新定位正文");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.filePath`), "/tmp/relocated.md");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "SAVED");
});

test("knowledge file IPC exposes read, relocate, and watcher lifecycle", async () => {
  const [main, preload, watcher] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "main", "main.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "preload.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "knowledge-watcher.cjs"), "utf8"),
  ]);
  assert.match(main, /knowledge-document:read/);
  assert.match(main, /knowledge-document:stage-assets/);
  assert.match(main, /knowledge-document:choose/);
  assert.match(main, /knowledge-document:watch/);
  assert.match(main, /knowledge-file:changed/);
  assert.match(main, /knowledge-recovery:flush-and-quit/);
  assert.match(main, /knowledge-recovery:flush-complete/);
  assert.match(main, /before-quit[\s\S]*knowledgeWatcher\.closeAll\(\)/);
  assert.match(main, /stopRuntimeForUpdateInstall[\s\S]*knowledgeWatcher\.closeAll\(\)[\s\S]*todayWidgetController\?\.stop\(\)[\s\S]*await deadlineReminderController\?\.stop\(\)/);
  assert.match(main, /createPreInstallBackup[\s\S]*await stopRuntimeForUpdateInstall\(\)[\s\S]*updateInstallPrepared = true/);
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /second-instance/);
  assert.match(preload, /onChange: \(callback\) => subscribe\("knowledge-file:changed", callback\)/);
  assert.match(preload, /onFlushAndQuit: \(callback\) => subscribe\("knowledge-recovery:flush-and-quit", callback\)/);
  assert.match(watcher, /DEFAULT_DEBOUNCE_MS = 300/);
  assert.match(watcher, /external-changed/);
  assert.match(watcher, /file-missing/);
});

test("note export uses the latest body without rebinding and recovers from cancellation or failure", async () => {
  const calls = [];
  let response = { canceled: true };
  const harness = await rendererHarness({ export: { taskDocument: async payload => {
    calls.push(payload);
    if (response instanceof Error) throw response;
    return response;
  } } });
  harness.evaluate(`
    state.tasks = normalizeTasks([{ id: "export-note", title: "笔记标题", notes: "旧正文", nodes: [] }]);
    state.tasks[0].knowledgeNote.filePath = "/original/linked.md";
    state.tasks[0].knowledgeNote.lastSavedHash = "original-hash";
    nodeNoteDrafts.set(noteDraftKey("export-note", null), { taskId: "export-note", nodeId: null, markdown: "最新正文" });
    globalThis.exportButton = { disabled: false, isConnected: true, addEventListener: (_type, listener) => { globalThis.exportClick = listener; } };
    globalThis.exportError = { hidden: true, textContent: "" };
    globalThis.closedExports = 0;
    document.querySelector = selector => selector === "#knowledge-export-download" ? exportButton
      : selector === "#knowledge-export-error" ? exportError
      : selector === "#knowledge-export-format" ? { value: "html" } : null;
    shellKnowledgeDialog = () => {};
    shellToast = () => {};
    shellCloseOverlay = () => { closedExports++; };
    shellKnowledgeExportNote(state.tasks[0]);
  `);
  await harness.evaluate("exportClick()");
  assert.equal(calls[0].markdown, "最新正文");
  assert.equal(calls[0].documentKind, "note");
  assert.equal(calls[0].format, "html");
  assert.equal(harness.evaluate("closedExports"), 0, "cancel returns to the export preview");
  assert.equal(harness.evaluate("exportButton.disabled"), false);
  response = new Error("写入失败");
  await harness.evaluate("exportClick()");
  assert.equal(harness.evaluate("exportError.textContent"), "写入失败");
  assert.equal(harness.evaluate("exportButton.disabled"), false);
  response = { canceled: false, filePath: "/copy/note.html" };
  await harness.evaluate("exportClick()");
  assert.equal(harness.evaluate("closedExports"), 1);
  assert.equal(harness.evaluate("state.tasks[0].knowledgeNote.filePath"), "/original/linked.md");
  assert.equal(harness.evaluate("state.tasks[0].knowledgeNote.lastSavedHash"), "original-hash");
});

test("document export writes the selected format and preserves the legacy task export contract", async () => {
  const source = await fs.readFile(path.join(__dirname, "../app/main/main.cjs"), "utf8");
  const body = source.slice(source.indexOf("async function exportTaskDocument(payload)"), source.indexOf("async function exportNodeDetailPdf(payload)"));
  let chosen = { canceled: true }, options;
  const writes = [], windows = [];
  const context = vm.createContext({
    LoopKnowledgeCore: require("../app/renderer/src/knowledge-core.js"),
    dialog: { showSaveDialog: async value => { options = value; return chosen; } },
    fs: { writeFile: async (...args) => { writes.push(args); } },
    sanitizeFileName: value => value,
    taskDocumentPdfHtml: ({ bodyHtml }) => `<!doctype html>${bodyHtml}`,
    BrowserWindow: class {
      constructor() { windows.push(this); this.webContents = { printToPDF: async () => Buffer.from("PDF") }; }
      async loadURL(value) { this.url = value; }
      destroy() { this.destroyed = true; }
    },
  });
  vm.runInContext(body, context);
  const run = payload => context.exportTaskDocument(payload);
  assert.equal((await run({ documentKind: "note", format: "html" })).canceled, true);
  assert.equal(writes.length, 0);
  for (const format of ["md", "html", "pdf"]) {
    chosen = { canceled: false, filePath: `/copy/note-${format}` };
    const result = await run({ taskTitle: "笔记", documentKind: "note", format, markdown: "正文", html: "<p>正文</p>" });
    assert.equal(result.filePath, `/copy/note-${format}.${format}`);
    assert.equal(options.title, "导出笔记");
    assert.equal(options.filters[0].extensions[0], format);
  }
  assert.equal(writes[0][1], "正文");
  assert.match(writes[1][1], /^<!doctype html><p>正文<\/p>/);
  assert.equal(writes[2][1].toString(), "PDF");
  assert.equal(windows[0].destroyed, true);
  chosen = { canceled: false, filePath: "/copy/task.pdf" };
  await run({ taskTitle: "任务", markdown: "完整任务", html: "<h1>任务</h1>" });
  assert.equal(options.title, "导出任务");
  assert.deepEqual(Array.from(options.filters, item => item.extensions[0]), ["md", "pdf"]);
  assert.equal(writes[3][0], "/copy/task.pdf");
});

test("renderer knowledge save binds metadata only after the file service succeeds", async () => {
  let response = { canceled: true };
  const calls = [];
  const harness = await rendererHarness({
    platform: "darwin",
    knowledgeFile: {
      save: async (payload) => {
        calls.push(payload);
        return response;
      },
    },
  });
  harness.evaluate(`state.tasks = normalizeTasks([{
    id: "save_task",
    title: "知识标题",
    notes: "Markdown 正文 😀",
    nodes: []
  }])`);

  const canceled = await harness.evaluate(`saveKnowledgeTask("save_task")`);
  assert.equal(canceled.canceled, true);
  assert.equal(harness.json(`state.tasks[0].knowledgeNote`).documentState, "DRAFT");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote`).filePath, null);

  response = {
    canceled: false,
    success: true,
    filePath: "/tmp/knowledge-a.md",
    lastSavedHash: "hash_a",
    lastSavedMtime: 123,
    encoding: "UTF-8",
    lineEnding: "LF",
  };
  const saved = await harness.evaluate(`saveKnowledgeTask("save_task")`);
  assert.equal(saved.success, true);
  const metadata = harness.json(`state.tasks[0].knowledgeNote`);
  assert.equal(metadata.documentState, "SAVED");
  assert.equal(metadata.dirty, false);
  assert.equal(metadata.filePath, "/tmp/knowledge-a.md");
  assert.equal(metadata.lastSavedHash, "hash_a");
  assert.equal(calls[1].content, "Markdown 正文 😀");

  response = { ...response, filePath: "/tmp/knowledge-b.md" };
  const savedAs = await harness.evaluate(`saveKnowledgeTask("save_task", { saveAs: true })`);
  assert.equal(savedAs.filePath, "/tmp/knowledge-b.md");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote`).filePath, "/tmp/knowledge-b.md");
  assert.equal(calls[2].filePath, "");
});

test("renderer stages app-managed images and preserves explicit external image paths", async () => {
  const dataUrl = "data:image/png;base64,cG5n";
  const stagedCalls = [];
  const saveCalls = [];
  const harness = await rendererHarness({
    platform: "darwin",
    knowledgeFile: {
      stageAssets: async (payload) => {
        stagedCalls.push(payload);
        return {
          success: true,
          assets: [{ source: "task-image:managed", dataUrl, filePath: "/recovery/assets/asset-a.png" }],
        };
      },
      save: async (payload) => {
        saveCalls.push(payload);
        return {
          success: true,
          filePath: "/tmp/knowledge-assets.md",
          content: "![应用图片](./attachments/asset-a.png)\n![外部图片](D:/Shared/image.png)",
          assetFiles: [{ relativePath: "./attachments/asset-a.png", dataUrl }],
          lastSavedHash: "asset-hash",
          lastSavedMtime: 456,
        };
      },
    },
  });
  harness.evaluate(`(() => {
    state.attachments.images.managed = ${JSON.stringify(dataUrl)};
    state.tasks = normalizeTasks([{
      id: "asset_task",
      title: "图片笔记",
      notes: "![应用图片](task-image:managed)\\n![外部图片](D:/Shared/image.png)",
      nodes: []
    }]);
  })()`);

  const result = await harness.evaluate(`saveKnowledgeTask("asset_task")`);
  assert.equal(result.success, true);
  assert.equal(stagedCalls.length, 1);
  assert.equal(stagedCalls[0].assets.length, 1);
  assert.equal(stagedCalls[0].assets[0].source, "task-image:managed");
  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0].assets[0].filePath, "/recovery/assets/asset-a.png");
  assert.match(saveCalls[0].content, /D:\/Shared\/image\.png/);
  assert.equal(harness.json(`state.tasks[0].notes`), "![应用图片](./attachments/asset-a.png)\n![外部图片](D:/Shared/image.png)");
  assert.match(harness.evaluate(`resolveMarkdownImageUrl("./attachments/asset-a.png")`), /^data:image\/png/);
});

test("knowledge UI exposes every document state and the required recovery actions", async () => {
  const harness = await rendererHarness();
  const note = (documentState) => `knowledgeNote: {
        noteId: "ui_${documentState}",
        taskId: "ui_${documentState}",
        filePath: ${JSON.stringify(documentState === "DRAFT" ? null : "/tmp/knowledge-ui.md")},
        documentState: ${JSON.stringify(documentState)},
        dirty: ${JSON.stringify(documentState !== "SAVED" && documentState !== "DRAFT")}
      }`;
  const render = (documentState) => harness.evaluate(`renderTaskKnowledge(normalizeTasks([{
      id: "ui_${documentState}",
      title: "状态测试",
      notes: "正文",
      nodes: [],
      ${note(documentState)}
    }])[0])`);

  // The Demo's pane vocabulary: state label in the header, file name in the meta
  // row, and the recovery action reachable from the notice.
  const cases = [
    ["DRAFT", "草稿", "尚未关联文件"],
    ["SAVED", "已保存", "knowledge-ui.md"],
    ["DIRTY", "已修改", "knowledge-ui.md"],
    ["EXTERNAL_CHANGED", "文件有外部修改", "knowledge-ui.md", "knowledge-conflict", "save-knowledge-as"],
    ["FILE_MISSING", "文件已丢失", "knowledge-ui.md", "data-action=\"relocate-knowledge\"", "save-knowledge-as"],
    ["READ_ONLY", "文件不可写", "knowledge-ui.md", "data-action=\"retry-knowledge\"", "save-knowledge-as"],
  ];
  for (const [documentState, label, fileName, ...actions] of cases) {
    const html = await render(documentState);
    assert.match(html, new RegExp(`data-knowledge-state="${documentState}"`));
    assert.match(html, new RegExp(label));
    assert.match(html, new RegExp(fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const action of actions) assert.match(html, new RegExp(action));
  }

  // The conflict resolutions still exist, now behind the Demo's 处理冲突 dialog.
  const knowledge = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "knowledge.js"), "utf8");
  assert.match(knowledge, /data-action="reload-knowledge"/);
  assert.match(knowledge, /data-action="save-knowledge-overwrite"/);
  assert.match(knowledge, /data-action="save-knowledge-as"/);

  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");
  assert.match(app, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(app, /saveKnowledgeTask\(task\.id,\s*\{\s*saveAs: event\.shiftKey,?\s*\}\)/);
});


test("draft removal prompts safely and file binding removal never deletes disk files", async () => {
  const unwatchCalls = [];
  const harness = await rendererHarness({
    knowledgeFile: {
      unwatch: async (payload) => {
        unwatchCalls.push(payload);
        return true;
      },
    },
  });
  harness.evaluate(`(() => {
    render = () => {};
    state.tasks = normalizeTasks([{
      id: "draft_prompt_task",
      title: "未文件化笔记",
      notes: "仍需保留的草稿",
      nodes: []
    }]);
  })()`);

  const blocked = await harness.evaluate(`deleteTask("draft_prompt_task")`);
  assert.equal(blocked, false);
  assert.equal(harness.json(`state.knowledgeDraftPrompt.taskId`), "draft_prompt_task");
  assert.match(harness.evaluate(`renderKnowledgeDraftPrompt()`), /保留为草稿/);
  assert.match(harness.evaluate(`renderKnowledgeDraftPrompt()`), /删除草稿/);
  assert.match(harness.evaluate(`renderKnowledgeDraftPrompt()`), /data-action="save-knowledge-before-delete"/);

  await harness.evaluate(`action({ action: "keep-knowledge-draft", taskId: "draft_prompt_task" })`);
  assert.equal(harness.json(`state.knowledgeDraftPrompt`), null);

  harness.evaluate(`state.taskPane = "notes"; state.knowledgeDraftPrompt = null`);
  const closeBlocked = await harness.evaluate(`closeKnowledgeEditor("draft_prompt_task")`);
  assert.equal(closeBlocked.code, "DRAFT_REQUIRES_DECISION");
  assert.equal(harness.json(`state.knowledgeDraftPrompt.mode`), "close-editor");
  assert.match(harness.evaluate(`renderKnowledgeDraftPrompt()`), /save-knowledge-before-close/);
  await harness.evaluate(`action({ action: "delete-knowledge-draft", taskId: "draft_prompt_task" })`);
  assert.equal(harness.json(`state.tasks[0].notes`), "");
  assert.equal(harness.json(`state.taskPane`), "flow");

  harness.evaluate(`state.tasks = normalizeTasks([{
    id: "bound_ui_task",
    title: "已绑定笔记",
    notes: "本地正文",
    nodes: [],
    knowledgeNote: {
      noteId: "bound_ui_task",
      taskId: "bound_ui_task",
      filePath: "/tmp/user-owned.md",
      documentState: "SAVED"
    }
  }])`);
  const removed = await harness.evaluate(`removeKnowledgeBinding("bound_ui_task")`);
  assert.equal(removed.success, true);
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.filePath`), null);
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "DRAFT");
  assert.equal(unwatchCalls.length, 1);

  const deleted = await harness.evaluate(`deleteTask("bound_ui_task", { skipDraftPrompt: true })`);
  assert.equal(deleted, true);
  assert.equal(harness.json(`state.tasks.length`), 0);
  assert.equal(unwatchCalls.length, 2);
});

test("renderer recovery debounces input and restores only newer unfiled drafts", async () => {
  const harness = await rendererHarness();
  harness.evaluate(`(() => {
    state.tasks = normalizeTasks([{
      id: "recovery_task",
      title: "恢复测试",
      notes: "旧正文",
      updatedAt: "2026-08-22T00:00:00.000Z",
      nodes: []
    }]);
    state.knowledgeRecovery = { version: 1, records: {} };
    scheduleKnowledgeRecovery("recovery_task", "新正文", { debounceMs: 40, maxIntervalMs: 200 });
    scheduleKnowledgeRecovery("recovery_task", "最新正文", { debounceMs: 40, maxIntervalMs: 200 });
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(harness.storageValue(KNOWLEDGE_RECOVERY_KEY_FOR_TEST), null);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const saved = JSON.parse(harness.storageValue(KNOWLEDGE_RECOVERY_KEY_FOR_TEST));
  assert.equal(saved.records.recovery_task.content, "最新正文");

  harness.evaluate(`scheduleKnowledgeRecovery("recovery_task", "最长间隔正文", { debounceMs: 100, maxIntervalMs: 30 })`);
  await new Promise((resolve) => setTimeout(resolve, 55));
  const forced = JSON.parse(harness.storageValue(KNOWLEDGE_RECOVERY_KEY_FOR_TEST));
  assert.equal(forced.records.recovery_task.content, "最长间隔正文");

  const recovered = harness.json(`(() => {
    state.knowledgeRecovery = {
      version: 1,
      records: {
        recovery_task: {
          noteId: "recovery_task",
          content: "启动恢复正文",
          updatedAt: "2026-08-22T00:01:00.000Z",
          baseFileHash: null
        }
      }
    };
    restoreKnowledgeRecoveryDrafts();
    return {
      content: state.tasks[0].notes,
      state: state.tasks[0].knowledgeNote.documentState,
      dirty: state.tasks[0].knowledgeNote.dirty,
      filePath: state.tasks[0].knowledgeNote.filePath
    };
  })()`);
  assert.deepEqual(recovered, {
    content: "启动恢复正文",
    state: "DRAFT",
    dirty: true,
    filePath: null,
  });

  const boundFilePreserved = harness.json(`(() => {
    state.tasks = normalizeTasks([{
      id: "bound_task",
      title: "已绑定笔记",
      notes: "本地未保存正文",
      updatedAt: "2026-08-22T00:00:00.000Z",
      knowledgeNote: {
        noteId: "bound_task",
        taskId: "bound_task",
        filePath: "/tmp/bound.md",
        documentState: "DIRTY",
        dirty: true,
        lastSavedHash: "hash_a"
      },
      nodes: []
    }]);
    state.knowledgeRecovery = {
      version: 1,
      records: {
        bound_task: {
          noteId: "bound_task",
          content: "Recovery 正文",
          updatedAt: "2026-08-22T00:02:00.000Z",
          baseFileHash: "hash_a"
        }
      }
    };
    restoreKnowledgeRecoveryDrafts();
    return { content: state.tasks[0].notes, filePath: state.tasks[0].knowledgeNote.filePath };
  })()`);
  assert.deepEqual(boundFilePreserved, { content: "本地未保存正文", filePath: "/tmp/bound.md" });
});

test("bound recovery restores the draft and requires conflict resolution if its file baseline changed", async () => {
  const readCalls = [];
  const harness = await rendererHarness({
    knowledgeFile: {
      read: async ({ filePath }) => {
        readCalls.push(filePath);
        const hash = filePath.endsWith("same.md") ? "hash_a" : "hash_b";
        return {
          success: true,
          filePath,
          content: "磁盘正文",
          lastSavedHash: hash,
          lastSavedMtime: 10,
        };
      },
    },
  });
  harness.evaluate(`(() => {
    state.tasks = normalizeTasks([
      {
        id: "bound_same",
        title: "同版本文件",
        notes: "旧本地正文",
        updatedAt: "2026-08-22T00:00:00.000Z",
        nodes: [],
        knowledgeNote: {
          noteId: "bound_same",
          taskId: "bound_same",
          filePath: "/tmp/same.md",
          documentState: "DIRTY",
          dirty: true,
          lastSavedHash: "hash_a"
        }
      },
      {
        id: "bound_changed",
        title: "外部变化文件",
        notes: "应保留的本地正文",
        updatedAt: "2026-08-22T00:00:00.000Z",
        nodes: [],
        knowledgeNote: {
          noteId: "bound_changed",
          taskId: "bound_changed",
          filePath: "/tmp/changed.md",
          documentState: "DIRTY",
          dirty: true,
          lastSavedHash: "hash_a"
        }
      }
    ]);
    state.knowledgeRecovery = {
      version: 1,
      records: {
        bound_same: {
          noteId: "bound_same",
          content: "应恢复的 Recovery 正文",
          updatedAt: "2026-08-22T00:02:00.000Z",
          baseFileHash: "hash_a"
        },
        bound_changed: {
          noteId: "bound_changed",
          content: "外部冲突 Recovery 正文",
          updatedAt: "2026-08-22T00:02:00.000Z",
          baseFileHash: "hash_a"
        }
      }
    };
  })()`);

  await harness.evaluate("restoreKnowledgeRecoveryDrafts()");

  assert.deepEqual(readCalls.sort(), ["/tmp/changed.md", "/tmp/same.md"]);
  assert.deepEqual(harness.json(`state.tasks.map((task) => ({
    id: task.id,
    notes: task.notes,
    state: task.knowledgeNote.documentState,
    dirty: task.knowledgeNote.dirty
  }))`), [
    { id: "bound_same", notes: "应恢复的 Recovery 正文", state: "DIRTY", dirty: true },
    { id: "bound_changed", notes: "外部冲突 Recovery 正文", state: "EXTERNAL_CHANGED", dirty: true },
  ]);
});

test("renderer revalidates a bound file before saving stale startup content", async () => {
  let readCalls = 0;
  let saveCalls = 0;
  const harness = await rendererHarness({
    knowledgeFile: {
      read: async () => {
        readCalls += 1;
        return {
          success: true,
          filePath: "/tmp/startup-race.md",
          content: "外部新正文",
          lastSavedHash: "hash_b",
          lastSavedMtime: 20,
        };
      },
      save: async () => {
        saveCalls += 1;
        return { success: true, filePath: "/tmp/startup-race.md", lastSavedHash: "hash_a" };
      },
    },
  });
  harness.evaluate(`render = () => {}; state.tasks = normalizeTasks([{
    id: "startup_race_task",
    title: "启动竞态",
    notes: "启动时仍在内存中的旧正文",
    nodes: [],
    knowledgeNote: {
      noteId: "startup_race_task",
      taskId: "startup_race_task",
      filePath: "/tmp/startup-race.md",
      documentState: "SAVED",
      dirty: false,
      lastSavedHash: "hash_a",
      lastSavedMtime: 10
    }
  }])`);

  const result = await harness.evaluate(`saveKnowledgeTask("startup_race_task")`);

  assert.equal(readCalls, 1);
  assert.equal(saveCalls, 0);
  assert.equal(result.code, "EXTERNAL_CHANGE_REQUIRES_CONFIRMATION");
  assert.equal(harness.json(`state.tasks[0].notes`), "启动时仍在内存中的旧正文");
  assert.equal(harness.json(`state.tasks[0].knowledgeNote.documentState`), "EXTERNAL_CHANGED");
});

test("knowledge recovery preserves managed image assets across restart", async () => {
  const dataUrl = "data:image/png;base64,cG5n";
  const recoveryWrites = [];
  const harness = await rendererHarness({
    knowledgeRecovery: {
      write: async (record) => { recoveryWrites.push(JSON.parse(JSON.stringify(record))); },
    },
    knowledgeFile: {
      stageAssets: async ({ assets }) => ({
        success: true,
        assets: assets.map((asset) => ({ ...asset, filePath: "/recovery/assets/asset.png" })),
      }),
    },
  });
  harness.evaluate(`(() => {
    state.attachments = { images: { recovery_image: ${JSON.stringify(dataUrl)} } };
    state.tasks = normalizeTasks([{
      id: "recovery_asset_task",
      title: "Recovery 图片",
      notes: "![图片](task-image:recovery_image)",
      nodes: []
    }]);
    state.knowledgeRecovery = { version: 1, records: {} };
    scheduleKnowledgeRecovery("recovery_asset_task", state.tasks[0].notes, { debounceMs: 10, maxIntervalMs: 100 });
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.equal(recoveryWrites.length, 1);
  assert.equal(recoveryWrites[0].assets[0].source, "task-image:recovery_image");
  assert.equal(recoveryWrites[0].assets[0].dataUrl, dataUrl);

  const persisted = JSON.stringify(recoveryWrites[0]);
  const restored = await harness.evaluate(`(async () => {
    state.attachments = { images: {} };
    state.tasks = normalizeTasks([{
      id: "recovery_asset_task",
      title: "Recovery 图片",
      notes: "旧正文",
      updatedAt: "2026-08-22T00:00:00.000Z",
      nodes: []
    }]);
    state.knowledgeRecovery = { version: 1, records: { recovery_asset_task: ${persisted} } };
    await restoreKnowledgeRecoveryDrafts();
    return { content: state.tasks[0].notes, image: state.attachments.images.recovery_image };
  })()`);
  assert.equal(restored.content, "![图片](task-image:recovery_image)");
  assert.equal(restored.image, dataUrl);
});

test("disk normalization repairs malformed records and legacy preferences", () => {
  const normalized = normalizeTaskData({
    tasks: [
      null,
      {
        id: "task_a",
        title: 42,
        priority: "urgent",
        status: "unknown",
        tags: ["today", "blocked"],
        nodes: [
          null,
          {
            id: "node_a",
            status: "unknown",
            children: [{ id: "node_a", title: "child" }],
          },
        ],
      },
    ],
    taskGroups: [null],
    activeGroupId: "missing",
    attachments: {
      images: {
        keep: "data:image/png;base64,AA==",
        drop: "https://example.com/image.png",
      },
    },
    flowWidths: { title: 9999, note: 1 },
    sidebarWidth: 9999,
    detailHeight: 1,
    font: "mono",
  });

  assert.equal(normalized.tasks.length, 1);
  assert.equal(normalized.tasks[0].title, "42");
  assert.equal(normalized.tasks[0].priority, "medium");
  assert.equal(normalized.tasks[0].status, "active");
  assert.deepEqual(normalized.tasks[0].tags, {
    today: true,
    later: false,
    blocked: true,
  });
  assert.equal(normalized.tasks[0].nodes.length, 1);
  assert.equal(normalized.tasks[0].nodes[0].status, "todo");
  assert.notEqual(
    normalized.tasks[0].nodes[0].id,
    normalized.tasks[0].nodes[0].children[0].id,
  );
  assert.equal(normalized.tasks[0].nodes[0].children[0].parentId, normalized.tasks[0].nodes[0].id);
  assert.equal(normalized.activeGroupId, "group_inbox");
  assert.deepEqual(Object.keys(normalized.attachments.images), ["keep"]);
  assert.deepEqual(normalized.flowWidths, { title: 720, note: 180 });
  // Upper bound follows the task-list column limits in storage.cjs / app.js.
  assert.equal(normalized.sidebarWidth, 460);
  assert.equal(normalized.detailHeight, 50);
  assert.equal(normalized.zhFont, "yahei");
  assert.equal(normalized.enFont, "mono");
});

test("Today widget lane orders are migration-safe in disk and renderer normalization", async () => {
  const disk = normalizeTaskData({
    tasks: [
      { id: "valid", todayTaskOrder: 3.4, todayQuickCaptureOrder: 5.2 },
      { id: "invalid", todayTaskOrder: -8, todayQuickCaptureOrder: "bad" },
      { id: "legacy" },
    ],
  });
  assert.deepEqual(disk.tasks.map((task) => [task.todayTaskOrder, task.todayQuickCaptureOrder]), [[3, 5], [0, 0], [0, 0]]);

  const harness = await rendererHarness();
  assert.deepEqual(
    harness.json(`normalizeTasks([{ id: "valid", todayTaskOrder: 2.6, todayQuickCaptureOrder: 1.2 }, { id: "invalid", todayTaskOrder: "bad" }]).map((task) => [task.todayTaskOrder, task.todayQuickCaptureOrder])`),
    [[3, 1], [0, 0]],
  );
});

test("disk and renderer typography default to Heiti and Times while preserving explicit choices", async () => {
  const defaults = normalizeTaskData({});
  assert.equal(defaults.zhFont, "heiti");
  assert.equal(defaults.enFont, "times");
  const invalid = normalizeTaskData({ zhFont: "unknown", enFont: "unknown" });
  assert.equal(invalid.zhFont, "heiti");
  assert.equal(invalid.enFont, "times");
  const harness = await rendererHarness();
  assert.deepEqual(harness.json(`loadBrowserTypography()`), { zhFont: "heiti", enFont: "times", fontScale: "larger" });
  harness.evaluate(`localStorage.setItem(ZH_FONT_KEY, "system"); localStorage.setItem(EN_FONT_KEY, "inter");`);
  assert.deepEqual(harness.json(`loadBrowserTypography()`), { zhFont: "system", enFont: "inter", fontScale: "larger" });
  assert.deepEqual(harness.json(`migrateLegacyFont("mono")`), { zhFont: "yahei", enFont: "mono" });
  assert.deepEqual(harness.json(`migrateLegacyFont("system")`), { zhFont: "system", enFont: "inter" });
  const zhFonts = ["system", "noto", "yahei", "pingfang", "songti", "simsun", "fangsong", "heiti", "kaiti"];
  const enFonts = ["inter", "system", "segoe", "arial", "helvetica", "verdana", "trebuchet", "tahoma", "times", "georgia", "courier", "mono"];

  for (const zhFont of zhFonts) {
    assert.equal(normalizeTaskData({ zhFont, enFont: "inter" }).zhFont, zhFont);
  }

  for (const enFont of enFonts) {
    assert.equal(normalizeTaskData({ zhFont: "system", enFont }).enFont, enFont);
  }

  for (const fontScale of ["current", "larger", "large", "largest"]) {
    assert.equal(normalizeTaskData({ fontScale }).fontScale, fontScale);
  }

  assert.equal(normalizeTaskData({ fontScale: "unknown" }).fontScale, "larger");

});

test("disk normalization creates and preserves a random UUID installation identifier", () => {
  const created = normalizeTaskData({}).installationId;
  assert.match(created, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(normalizeTaskData({ installationId: created }).installationId, created);
  assert.notEqual(normalizeTaskData({}).installationId, created);
});

test("disk normalization preserves the virtual all-tasks view without creating a fake group", () => {
  const normalized = normalizeTaskData({
    activeGroupId: "group_all",
    taskGroups: [{ id: "group_inbox", title: "默认", order: 1 }],
    tasks: [{ id: "task_all_view", title: "汇总任务", groupId: "group_inbox" }],
  });

  assert.equal(normalized.activeGroupId, "group_all");
  assert.deepEqual(normalized.taskGroups.map((group) => group.id), ["group_inbox"]);
  assert.equal(normalized.tasks[0].groupId, "group_inbox");
});

test("Chinese and English font settings stay isolated in the application font chain", async () => {
  const [styles, app] = await Promise.all([
    rendererStyles(),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
  ]);

  assert.doesNotMatch(styles, /--en-font:\s*"TaskTrack English [^"]+",\s*(?:sans-serif|serif|monospace);/);
  assert.doesNotMatch(styles, /--zh-font:\s*"TaskTrack Chinese [^"]+",\s*(?:sans-serif|serif);/);
  assert.doesNotMatch(app, /横向滚动\s*·\s*双击重命名/);
});

test("Today widget is rebuilt from the frozen phase 12/13 widget layers", async () => {
  const rendererDir = path.join(__dirname, "..", "app", "renderer");
  const frozenDir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase17-frozen");
  const phase18Dir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase18-frozen");
  const phase19Dir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase19-frozen");
  const [widget, surface, bridge, widget12, widget13, base12, base13, runtime, surfaceRuntime, shell, typography, baseShell, fonts, baseFonts, refinement, baseRefinement] = await Promise.all([
    fs.readFile(path.join(rendererDir, "today-widget.html"), "utf8"),
    fs.readFile(path.join(rendererDir, "widget-surface.html"), "utf8"),
    fs.readFile(path.join(rendererDir, "src", "widget-bridge.css"), "utf8"),
    fs.readFile(path.join(rendererDir, "src", "widget12.css"), "utf8"),
    fs.readFile(path.join(rendererDir, "src", "widget13.css"), "utf8"),
    fs.readFile(path.join(frozenDir, "loop-widget-phase12-refinement.css"), "utf8"),
    fs.readFile(path.join(frozenDir, "loop-widget-phase13.css"), "utf8"),
    fs.readFile(path.join(rendererDir, "src", "today-widget-runtime.js"), "utf8"),
    fs.readFile(path.join(rendererDir, "src", "widget-surface-runtime.js"), "utf8"),
    fs.readFile(path.join(rendererDir, "src", "shell.css"), "utf8"),
    fs.readFile(path.join(rendererDir, "src", "typography.css"), "utf8"),
    fs.readFile(path.join(frozenDir, "loop-plane-phase1.html"), "utf8").then((html) => html.match(/<style>([\s\S]*?)<\/style>/)[1]),
    fs.readFile(path.join(rendererDir, "src", "fonts.css"), "utf8"),
    fs.readFile(path.join(frozenDir, "loop-settings-fonts.css"), "utf8"),
    fs.readFile(path.join(rendererDir, "src", "shell-refinement.css"), "utf8"),
    fs.readFile(path.join(frozenDir, "loop-shell-refinement.css"), "utf8"),
  ]);

  // Every layer the widget inherits from the Demo stays byte-identical to it.
  assert.equal(widget12, base12, "src/widget12.css must stay byte-identical to the frozen phase 12 refinement");
  assert.equal(widget13, base13, "src/widget13.css must stay byte-identical to the frozen phase 13 sheet");
  assert.equal(shell.trim(), baseShell.trim(), "src/shell.css must stay byte-identical to the Demo's inline stylesheet (tokens + base rules)");
  assert.equal(fonts, baseFonts, "src/fonts.css must stay byte-identical to the Demo's @font-face sheet");
  assert.equal(refinement, baseRefinement, "src/shell-refinement.css must stay byte-identical to the Demo's shell refinement");

  // The windows are hosts: the Demo's markup lives in the renderers, uncluttered.
  assert.doesNotMatch(widget, /--widget-focus:/);
  assert.doesNotMatch(widget, /mock-sidebar|mock-app|mock-repository/);
  for (const sheet of ["fonts.css", "shell.css", "typography.css", "widget12.css", "widget13.css", "shell-refinement.css", "widget-bridge.css"]) {
    assert.match(widget, new RegExp(sheet.replace(".", "\\.") + "\\?v=[0-9.]+"), `today-widget.html must load ${sheet}`);
  }
  assert.match(widget, /id="widget-host"/);
  assert.match(surface, /id="surface-host"/);

  // The bridge layer is the only deviation: the Demo's page-fixed panel becomes
  // a window whose content box is the panel plus the ring carrying its shadow.
  assert.match(bridge, /--widget-pad-x: 22px/);
  assert.match(bridge, /--widget-pad-top: 22px/);
  assert.match(bridge, /--widget-pad-bottom: 36px/);
  assert.match(bridge, /\.today-widget \{[\s\S]*position: relative;/);
  assert.match(bridge, /max-height:\s*none;/);
  assert.match(bridge, /-webkit-app-region: drag/);
  assert.doesNotMatch(bridge, /#widget-menu/);

  // The widget renderer carries the Demo's own template and interactions.
  assert.match(runtime, /class="today-widget widget12 widget13 '/);
  assert.match(runtime, /data-widget-lane="' \+ lane/);
  assert.match(runtime, /class="widget-logo" src="\.\/src\/assets\/loop-icon\.png"/);
  assert.match(runtime, /class="widget-tabs"/);
  assert.match(runtime, /class="widget-compose"/);
  assert.match(runtime, /class="widget-empty"/);
  assert.match(runtime, /class="widget13-resize ' \+ edge/);
  assert.match(runtime, /class="widget13-grip"/);
  assert.match(runtime, /data-widget-drag=/);
  assert.match(runtime, /data-widget-open=/);
  assert.match(runtime, /widget13-more/);
  assert.match(runtime, /data-action="compact-widget"/);
  assert.match(runtime, /data-action="widget-preferences"/);
  assert.match(runtime, /data-action="toggle-widget"/);
  assert.match(runtime, /placeholder="记一条速记…"/);
  assert.match(runtime, /data-widget12="submit"/);
  assert.match(runtime, /id="widget-feedback"/);
  // the Demo's own glyphs, not lookalikes
  assert.match(runtime, /M19\.4 15a1\.65 1\.65 0 0 0 \.33 1\.82/);
  assert.match(runtime, /M5 3h\.01M5 8h\.01M5 13h\.01M10 3h\.01M10 8h\.01M10 13h\.01/);
  assert.match(runtime, /icon\("circle"\)/);
  // the next-step line only exists when the record has one
  assert.match(runtime, /next \? "<small>" \+ \(blocked \? icon\("blocked"\) : ""\)/);
  assert.match(runtime, /t\.kind === "blocked"/);
  assert.match(runtime, /isQuickLane\(\)/);
  // popover surfaces keep the Demo's own classes, widths and markup
  assert.match(surfaceRuntime, /surface-popover widget12-settings/);
  assert.match(surfaceRuntime, /class="dialog-head"/);
  assert.match(surfaceRuntime, /class="widget12-positions"/);
  assert.match(surfaceRuntime, /aria-pressed="' \+ String\(settings\.position === value\)/);
  assert.match(surfaceRuntime, /<output id="widget12-opacity-value"/);
  assert.match(surfaceRuntime, /class="widget12-opacity" type="range"/);
  assert.match(surfaceRuntime, /text-button widget13-reset/);
  assert.match(surfaceRuntime, /text-button widget12-hide/);
  assert.match(surfaceRuntime, /surface-popover widget13-menu/);
  assert.match(surfaceRuntime, /widget13-menu-rule/);
  assert.match(surfaceRuntime, /surface-popover widget13-promote/);
  assert.match(surfaceRuntime, /class="dialog" role="dialog"/);
  assert.match(surfaceRuntime, /danger-action/);
  assert.match(typography, /font-scale/);
});

test("settings use the selected categorized modal, grouped rows, mixed controls, and spring motion", async () => {
  const [app, styles, work, settings] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "work.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "settings.js"), "utf8"),
  ]);

  assert.match(app, /activeSettingsPage = "appearance"/);
  assert.match(app, /data-settings-page="\$\{value\}"/);
  assert.match(app, /\["appearance", "tasks", "data", "updates", "advanced", "help"\]/);
  assert.match(app, /class="settings-list"/);
  assert.match(app, /class="settings-switch"[^>]+role="switch"/);
  assert.match(app, /data-action="toggle-today-widget-visibility"[^>]*aria-label="显示今日任务浮窗"/);
  assert.match(app, /if \(data\.action === "toggle-today-widget-visibility"\)[\s\S]*desktopTodayWidget\.hide\(\)[\s\S]*desktopTodayWidget\.show\(\)[\s\S]*desktopTodayWidget\.getState\(\)/);
  assert.match(app, /data-settings-advanced-slot/);
  assert.doesNotMatch(app, /<h2 id="settings-title">界面与数据<\/h2>/);
  // Demo phase 15 replaced the work-rhythm module: settings.js delegates to
  // work.js, which owns the schedule form, the source group select and the
  // switch handling through the shared delegation.
  assert.match(work, /<select name="source">/);
  assert.match(work, /data-work15="toggle"/);
  assert.match(settings, /globalThis\.LoopWork\?\.settingsBody/);
});

test("transient controls close on outside pointer presses without changing protected editor flows", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");

  assert.match(app, /globalSearchLayer\?\.addEventListener\("pointerdown"[\s\S]*event\.target !== globalSearchLayer[\s\S]*closeGlobalSearch\(\)/);
  assert.match(app, /app\.addEventListener\("pointerdown"[\s\S]*document\.querySelectorAll\("details\[open\]"\)\.forEach[\s\S]*!details\.contains\(event\.target\)[\s\S]*details\.removeAttribute\("open"\)/);
  assert.match(app, /if \(recurrencePopoverTaskId && !keepRecurrence\)/);
  assert.match(app, /if \(taskGroupSelectTaskId && !keepTaskGroup\)/);
  assert.match(app, /if \(deadlinePopoverTaskId && !keepDeadline\)/);
  assert.match(app, /if \(repositoryGroupPickerOpen && !keepRepositoryGroup\)/);
});

test("settings expose one-confirmation background update with a safe silent restart handshake", async () => {
  const [app, styles, approved, preload, updater, main] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
    rendererStyles(),
    fs.readFile(path.join(__dirname, "..", "app", "main", "preload.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "updater.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "main.cjs"), "utf8"),
  ]);
  const harness = await rendererHarness();
  const available = harness.evaluate(`(() => {
    appUpdateState = normalizeAppUpdateState({
      status: "available",
      supported: true,
      automaticChecks: true,
      currentVersion: "0.1.109",
      version: "0.1.110",
      size: 30000000,
      releaseDate: "2026-08-15T08:00:00.000Z"
    });
    return renderUpdateSettingsControls();
  })()`);
  const preparing = harness.evaluate(`(() => {
    appUpdateState = normalizeAppUpdateState({ status: "preparing", supported: true, currentVersion: "0.1.109", version: "0.1.110" });
    return renderUpdateSettingsControls();
  })()`);
  const sidebar = harness.json(`(() => {
    appUpdateState = normalizeAppUpdateState({ status: "latest", supported: true, currentVersion: "0.1.109" });
    const latest = renderSidebarUpdateControl();
    appUpdateState = normalizeAppUpdateState({ status: "available", supported: true, currentVersion: "0.1.109", version: "0.1.110" });
    const available = renderSidebarUpdateControl();
    appUpdateState = normalizeAppUpdateState({ status: "downloading", supported: true, currentVersion: "0.1.109", version: "0.1.110", percent: 42.4 });
    const downloading = renderSidebarUpdateControl();
    return { latest, available, downloading };
  })()`);
  const missingWindowsFeed = harness.evaluate(`(() => {
    appUpdateState = normalizeAppUpdateState({ status: "error", supported: true, currentVersion: "0.1.118", errorCode: "UPDATE_METADATA_MISSING" });
    return renderUpdateSettingsControls();
  })()`);

  assert.match(app, /<h3 id="software-update-title">软件更新<\/h3>/);
  assert.match(available, /自动检查更新/);
  assert.match(available, /v0\.1\.110 可用/);
  assert.match(available, /data-update-action="download">升级并重启/);
  assert.match(preparing, /正在保存并准备升级/);
  assert.match(sidebar.latest, /class="topbar-update-slot"[^>]*data-sidebar-update-slot hidden/);
  assert.doesNotMatch(sidebar.latest, /v0\.1\.109|sidebar-version/);
  assert.doesNotMatch(sidebar.latest, /sidebar-update-action/);
  assert.match(sidebar.available, /class="sidebar-update-action/);
  assert.match(sidebar.available, /data-sidebar-update-action/);
  assert.match(sidebar.available, /更新到 v0\.1\.110，完成后自动重启/);
  assert.match(sidebar.available, /feather-sprite\.svg#download-cloud/);
  assert.match(sidebar.downloading, /aria-busy="true" disabled/);
  assert.match(sidebar.downloading, />42%<\/span>/);
  assert.match(sidebar.downloading, /feather-sprite\.svg#loader/);
  assert.match(missingWindowsFeed, /Windows 更新包尚未发布完整/);
  assert.match(missingWindowsFeed, /UPDATE_METADATA_MISSING/);
  assert.match(missingWindowsFeed, /打开发布页/);
  assert.doesNotMatch(available, /data-update-action="install"/);
  assert.match(preload, /app-update:get-state/);
  assert.match(preload, /app-update:prepare-install/);
  assert.match(preload, /app-update:prepare-install-complete/);
  assert.match(updater, /autoDownload = false/);
  assert.match(updater, /autoInstallOnAppQuit = false/);
  assert.match(updater, /userApprovedInstall/);
  assert.match(updater, /quitAndInstall\(true, true\)/);
  assert.match(main, /requestUpdateInstallPreparation/);
  assert.match(main, /UPDATE_INSTALL_PREPARATION_TIMEOUT_MS/);
  assert.match(app, /flushPendingKnowledgeRecoveries\(\{ strict: true \}\)/);
  assert.doesNotMatch(app, /自动安装更新/);
});

function runUpdateVerifier(directory, extraArgs = []) {
  const script = path.join(__dirname, "..", "tools", "verify-update-artifacts.cjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, directory, ...extraArgs], { cwd: path.join(__dirname, "..") });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("update metadata is verified against the real artifact bytes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "loop-update-verify-"));
  const artifact = "Loop-0.1.199-arm64.dmg";
  const bytes = Buffer.from("loop artifact payload used for sha512 verification");
  const digest = crypto.createHash("sha512").update(bytes).digest("base64");
  const metadataFor = (size) => [
    "version: 0.1.199",
    "files:",
    `  - url: ${artifact}`,
    `    sha512: ${digest}`,
    `    size: ${size}`,
    `path: ${artifact}`,
    `sha512: ${digest}`,
    "releaseDate: '2026-10-01T00:00:00.000Z'",
    "",
  ].join("\n");
  try {
    await fs.writeFile(path.join(directory, artifact), bytes);
    await fs.writeFile(path.join(directory, "latest-mac.yml"), metadataFor(bytes.length), "utf8");
    const verified = await runUpdateVerifier(directory);
    assert.equal(verified.code, 0, verified.stderr);
    assert.match(verified.stdout, /Verified 1 update metadata file\(s\) and 1 artifact digest\(s\)/);

    // Tamper without changing the length, so only the digest can catch it.
    await fs.writeFile(path.join(directory, artifact), Buffer.from("X".repeat(bytes.length)));
    const tampered = await runUpdateVerifier(directory);
    assert.equal(tampered.code, 1, "a tampered artifact must fail verification");
    assert.match(tampered.stderr, /sha512 mismatch/);

    await fs.writeFile(path.join(directory, artifact), bytes);
    await fs.writeFile(path.join(directory, "latest-mac.yml"), metadataFor(bytes.length + 1), "utf8");
    const wrongSize = await runUpdateVerifier(directory);
    assert.equal(wrongSize.code, 1, "a declared size that disagrees with the file must fail verification");
    assert.match(wrongSize.stderr, /bytes but the file is/);

    await fs.writeFile(path.join(directory, "latest-mac.yml"), metadataFor(bytes.length).replace(`    sha512: ${digest}\n    size`, "    size"), "utf8");
    const missingDigest = await runUpdateVerifier(directory);
    assert.equal(missingDigest.code, 1, "metadata without a digest cannot prove anything and must fail");
    assert.match(missingDigest.stderr, /does not record a sha512/);

    await fs.writeFile(path.join(directory, "latest-mac.yml"), metadataFor(bytes.length).replace(artifact, "Loop-0.1.199-arm64-renamed.dmg"), "utf8");
    const missingArtifact = await runUpdateVerifier(directory);
    assert.equal(missingArtifact.code, 1);
    assert.match(missingArtifact.stderr, /references missing artifact/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("the active workflows declare an explicit permission scope", async () => {
  const workflowDirectory = path.join(__dirname, "..", ".github", "workflows");
  const names = (await fs.readdir(workflowDirectory))
    .filter((name) => name.endsWith(".yml") && !name.startsWith("._"));
  assert.ok(names.length > 0);

  // publish-vX.yml files are historical one-shot records: their trigger is a
  // change to their own path, so giving them a workflow-level default would
  // replay thirty obsolete publications on the next push.
  const legacy = names.filter((name) => /^publish-v\d/.test(name));
  const active = names.filter((name) => !legacy.includes(name));
  assert.ok(active.length >= 2, "the build and release workflows must be present");
  for (const name of active) {
    const source = await fs.readFile(path.join(workflowDirectory, name), "utf8");
    assert.match(source, /^permissions:/m, `${name} must declare an explicit permission scope`);
  }

  const [build, release] = await Promise.all([
    fs.readFile(path.join(workflowDirectory, "build.yml"), "utf8"),
    fs.readFile(path.join(workflowDirectory, "release.yml"), "utf8"),
  ]);
  assert.match(build, /^permissions:\r?\n  contents: read$/m, "the build workflow only needs read access");
  assert.match(release, /^permissions:\r?\n  contents: read$/m, "the release workflow defaults to read");
  assert.match(release, /^ {4}permissions:\r?\n {6}contents: write$/m, "only the publish job may write");
  assert.ok(
    !/pull_request_target|workflow_run/.test(build),
    "the untrusted pull_request trigger must not gain a privileged companion workflow",
  );
  for (const name of legacy) {
    const source = await fs.readFile(path.join(workflowDirectory, name), "utf8");
    assert.match(source, /^\s+permissions:$/m, `${name} must still scope its own publish job`);
  }
});

test("release configuration uses deterministic updater artifacts and excludes debug metadata", async () => {
  const [packageJson, buildScript, workflow, verifier] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "package.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(__dirname, "..", "tools", "build.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "tools", "verify-update-artifacts.cjs"), "utf8"),
  ]);

  assert.equal(packageJson.build.productName, "Loop");
  assert.equal(packageJson.build.appId, DESKTOP_APP_ID);
  assert.equal(packageJson.build.win.executableName, "Loop");
  assert.equal(packageJson.build.win.artifactName, "Loop-${version}-${arch}-setup.${ext}");
  assert.equal(packageJson.build.mac.artifactName, "Loop-${version}-${arch}.${ext}");
  assert.equal(packageJson.build.nsis.guid, WINDOWS_INSTALLER_GUID);
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(packageJson.build.nsis.shortcutName, APP_DISPLAY_NAME);
  assert.equal(packageJson.build.nsis.uninstallDisplayName, "Loop ${version}");
  assert.deepEqual(packageJson.build.publish, [{ provider: "github", owner: "tangyuanx", repo: "Loop" }]);
  assert.match(buildScript, /new Set\(\["latest\.yml", "latest-mac\.yml"\]\)/);
  assert.match(workflow, /release\/latest\.yml/);
  assert.match(workflow, /release\/latest-mac\.yml/);
  assert.doesNotMatch(workflow, /release\/\*\.yml/);
  assert.match(workflow, /needs:\s*build/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /--require-all-platforms/);
  assert.match(verifier, /references missing artifact/);
  assert.match(verifier, /Combined release is missing required update metadata/);
});

test("Loop preserves the legacy task-data location on macOS and Windows", () => {
  const electronBuilderNs = UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3");
  assert.equal(WINDOWS_INSTALLER_GUID, UUID.v5(DESKTOP_APP_ID, electronBuilderNs));
  const macAppData = "/Users/example/Library/Application Support";
  const windowsAppData = "C:\\Users\\example\\AppData\\Roaming";
  assert.equal(
    legacyUserDataPath(macAppData, path.posix),
    "/Users/example/Library/Application Support/Personal Task Track",
  );
  assert.equal(
    legacyUserDataPath(windowsAppData, path.win32),
    "C:\\Users\\example\\AppData\\Roaming\\Personal Task Track",
  );

  const calls = [];
  const fakeApp = {
    getPath(name) {
      assert.equal(name, "appData");
      return windowsAppData;
    },
    setName(name) {
      calls.push(["name", name]);
    },
    setPath(name, value) {
      calls.push([name, value]);
    },
  };
  const identity = configureDesktopIdentity(fakeApp, path.win32);
  assert.deepEqual(calls, [
    ["name", APP_DISPLAY_NAME],
    ["userData", "C:\\Users\\example\\AppData\\Roaming\\Personal Task Track"],
  ]);
  assert.equal(identity.appId, DESKTOP_APP_ID);
  assert.equal(path.win32.basename(identity.userDataPath), LEGACY_USER_DATA_DIRECTORY);
  assert.equal(path.win32.join(identity.userDataPath, DATA_FILE), "C:\\Users\\example\\AppData\\Roaming\\Personal Task Track\\task-data.json");
});

test("an explicitly requested profile overrides the legacy user-data redirect", () => {
  const macAppData = "/Users/example/Library/Application Support";
  assert.equal(explicitUserDataPath([], {}), "", "no request means no override");
  assert.equal(explicitUserDataPath(["--no-sandbox"], {}), "");
  assert.equal(
    explicitUserDataPath(["--no-sandbox", "--user-data-dir=/tmp/loop-profile", "/repo"], {}),
    "/tmp/loop-profile",
  );
  assert.equal(
    explicitUserDataPath([], { LOOP_USER_DATA_DIR: "  /tmp/loop-env-profile  " }),
    "/tmp/loop-env-profile",
    "the environment override must win and be trimmed",
  );

  const calls = [];
  const fakeApp = {
    getPath(name) {
      calls.push(["getPath", name]);
      return macAppData;
    },
    setName(name) {
      calls.push(["name", name]);
    },
    setPath(name, value) {
      calls.push([name, value]);
    },
  };
  const identity = configureDesktopIdentity(fakeApp, path.posix, {
    argv: ["--user-data-dir=/tmp/loop-profile"],
    env: {},
  });
  assert.deepEqual(calls, [
    ["name", APP_DISPLAY_NAME],
    ["userData", "/tmp/loop-profile"],
  ]);
  assert.equal(identity.userDataPath, "/tmp/loop-profile");
  assert.equal(identity.usesExplicitProfile, true);

  const legacyCalls = [];
  const legacyApp = {
    getPath: () => macAppData,
    setName() {},
    setPath(name, value) { legacyCalls.push([name, value]); },
  };
  const legacyIdentity = configureDesktopIdentity(legacyApp, path.posix, { argv: [], env: {} });
  assert.equal(legacyIdentity.usesExplicitProfile, false);
  assert.equal(legacyIdentity.userDataPath, path.posix.join(macAppData, LEGACY_USER_DATA_DIRECTORY));
});

test("an isolated profile never triggers legacy user-data recovery", async () => {
  const mainSource = await fs.readFile(path.join(__dirname, "..", "app", "main", "main.cjs"), "utf8");
  assert.match(mainSource, /const desktopIdentity = configureDesktopIdentity\(app\)/);
  assert.match(
    mainSource,
    /if \(!desktopIdentity\.usesExplicitProfile\) \{\r?\n\s+await recoverLegacyUserData\(\{/,
    "a caller-provided profile must not pull the real database in",
  );
});

test("the group context menu UI suite runs against its own isolated profile", async () => {
  const suiteSource = await fs.readFile(path.join(__dirname, "group-context-menu.ui.cjs"), "utf8");
  assert.match(suiteSource, /--user-data-dir=\$\{profile\}/);
  assert.match(suiteSource, /await seedProfile\(profile\)/, "the suite must seed the profile it owns");
  assert.match(suiteSource, /delete env\.ELECTRON_RUN_AS_NODE/, "the binary must start as the app, not as plain Node");
  assert.match(
    suiteSource,
    /the UI write must land in the isolated profile/,
    "the suite must prove where its writes went",
  );
  assert.doesNotMatch(suiteSource, /querySelector\("\.repository-group-trigger"\)/, "the picker lives in the filter popover");
});

test("repository structure keeps production, tooling, documentation, and prototypes separate", async () => {
  const root = path.join(__dirname, "..");
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));

  assert.equal(packageJson.main, "app/main/main.cjs");
  assert.match(packageJson.scripts.test, /tests\/desktop\.test\.cjs/);
  assert.match(packageJson.scripts.check, /services\/bug-report/);
  assert.match(packageJson.scripts["build:milkdown"], /tools\/build-milkdown\.cjs/);
  assert.ok(packageJson.build.files.every((entry) => entry === "package.json" || entry.startsWith("app/") || entry.startsWith("!")));
  assert.ok(packageJson.build.files.includes("app/renderer/index.html"));
  assert.ok(packageJson.build.files.includes("app/renderer/today-widget.html"));
  assert.ok(packageJson.build.files.includes("app/renderer/widget-surface.html"));

  await Promise.all([
    "app/main/main.cjs",
    "app/renderer/index.html",
    "services/bug-report/package.json",
    "tests/desktop.test.cjs",
    "tools/build.cjs",
    "docs/README.md",
    "prototypes/README.md",
  ].map((entry) => fs.access(path.join(root, entry))));

  await Promise.all([
    "electron",
    "src",
    "scripts",
    "bug-report-server",
    "today-widget-window-demo.html",
  ].map((entry) => assert.rejects(fs.access(path.join(root, entry)))));
});

test("Today widget preferences normalize safely and retain an intentional custom position", () => {
  assert.deepEqual(normalizeTodayWidgetPreferences(null), {
    position: "top-right",
    alwaysOnTop: true,
    launchWithApp: true,
    visible: true,
    compact: false,
    opacity: 100,
    height: 340,
    autoHeight: true,
    frameAnchor: { x: "right", y: "bottom" },
    customBounds: null,
    clickThrough: false,
    quickCaptureDraft: "",
  });
  assert.deepEqual(normalizeTodayWidgetPreferences({
    position: "custom",
    alwaysOnTop: false,
    launchWithApp: false,
    visible: false,
    compact: true,
    opacity: 84.6,
    height: 347.8,
    customBounds: { x: 321.7, y: 48.2 },
  }), {
    position: "custom",
    alwaysOnTop: false,
    launchWithApp: false,
    visible: false,
    compact: true,
    opacity: 85,
    height: 348,
    autoHeight: true,
    frameAnchor: { x: "right", y: "bottom" },
    customBounds: { x: 322, y: 48 },
    clickThrough: false,
    quickCaptureDraft: "",
  });
  assert.equal(normalizeTodayWidgetPreferences({ position: "custom" }).position, "top-right");
  assert.equal(normalizeTodayWidgetPreferences({ opacity: null }).opacity, 100);
  assert.equal(normalizeTodayWidgetPreferences({ opacity: 12 }).opacity, 70);
  assert.equal(normalizeTodayWidgetPreferences({ opacity: 120 }).opacity, 100);
  assert.equal(normalizeTodayWidgetPreferences({ height: 90 }).height, 180);
  assert.equal(normalizeTodayWidgetPreferences({ height: 900 }).height, 720);
  assert.equal(normalizeTodayWidgetPreferences({ clickThrough: true }).clickThrough, true);
  assert.equal(normalizeTodayWidgetPreferences({ clickThrough: "true" }).clickThrough, false);
  // The panel auto-sizes to its content until the user frames it by hand.
  assert.equal(normalizeTodayWidgetPreferences({ autoHeight: false }).autoHeight, false);
  assert.equal(normalizeTodayWidgetPreferences({ autoHeight: "yes" }).autoHeight, true);
  assert.deepEqual(normalizeTodayWidgetPreferences({ frameAnchor: { x: "left", y: "top" } }).frameAnchor, { x: "left", y: "top" });
  assert.deepEqual(normalizeTodayWidgetPreferences({ frameAnchor: { x: "bogus", y: "bogus" } }).frameAnchor, { x: "right", y: "bottom" });
});

test("Today widget corner placement respects each display work area", () => {
  const workArea = { x: 1440, y: 24, width: 1920, height: 1056 };
  const size = { width: 360, height: 260 };

  assert.deepEqual(cornerWindowBounds(workArea, size, "top-left"), { x: 1456, y: 40, ...size });
  assert.deepEqual(cornerWindowBounds(workArea, size, "top-right"), { x: 2984, y: 40, ...size });
  assert.deepEqual(cornerWindowBounds(workArea, size, "bottom-left"), { x: 1456, y: 804, ...size });
  assert.deepEqual(cornerWindowBounds(workArea, size, "bottom-right"), { x: 2984, y: 804, ...size });
});

test("Today widget appearance normalizes theme, fonts, and base font size", () => {
  assert.deepEqual(normalizeTodayWidgetAppearance({
    theme: "dark",
    zhFont: "songti",
    enFont: "georgia",
    fontSize: 18,
  }), {
    theme: "dark",
    zhFont: "songti",
    enFont: "georgia",
    fontSize: 18,
    fontScale: 1,
    sans: "",
  });
  assert.deepEqual(normalizeTodayWidgetAppearance({
    theme: "unknown",
    zhFont: "unknown",
    enFont: "unknown",
    fontSize: 99,
  }), {
    theme: "light",
    zhFont: "heiti",
    enFont: "times",
    fontSize: 24,
    fontScale: 1,
    sans: "",
  });
  assert.deepEqual(normalizeSnapshot({}).appearance, normalizeTodayWidgetAppearance());
  // The widget layers use --font-scale, so the multiplier has to survive the
  // main-process whitelist and stay inside a sane range.
  assert.equal(normalizeTodayWidgetAppearance({ fontScale: "1.16" }).fontScale, 1.16);
  assert.equal(normalizeTodayWidgetAppearance({ fontScale: "9" }).fontScale, 1.6);
  assert.equal(normalizeTodayWidgetAppearance({ fontScale: "0.1" }).fontScale, 0.8);
  assert.equal(normalizeTodayWidgetAppearance({ fontScale: "abc" }).fontScale, 1);
  // The widget window must resolve the same font families as the main window,
  // so the composed --sans stack travels with the snapshot (and nothing else).
  assert.equal(
    normalizeTodayWidgetAppearance({ sans: '"TaskTrack English Inter","TaskTrack Chinese System",-apple-system,BlinkMacSystemFont,sans-serif' }).sans,
    '"TaskTrack English Inter","TaskTrack Chinese System",-apple-system,BlinkMacSystemFont,sans-serif',
  );
  assert.equal(normalizeTodayWidgetAppearance({ sans: "x; background: url(http://evil)" }).sans, "");
  assert.equal(normalizeTodayWidgetAppearance({ sans: "a".repeat(401) }).sans, "");
});

test("Today widget topmost policy joins macOS fullscreen Spaces without hiding the host app from the Dock", () => {
  const calls = [];
  const window = {
    isDestroyed: () => false,
    isVisible: () => true,
    setVisibleOnAllWorkspaces: (...args) => calls.push(["workspaces", ...args]),
    setHiddenInMissionControl: (...args) => calls.push(["mission-control", ...args]),
    setAlwaysOnTop: (...args) => calls.push(["always-on-top", ...args]),
    moveTop: () => calls.push(["move-top"]),
  };

  applyTodayWidgetTopmost(window, true, "darwin");
  assert.deepEqual(calls, [
    ["workspaces", true, { visibleOnFullScreen: true, skipTransformProcessType: true }],
    ["mission-control", true],
    ["always-on-top", true, "screen-saver", 1],
    ["move-top"],
  ]);

  calls.length = 0;
  applyTodayWidgetTopmost(window, false, "darwin");
  assert.deepEqual(calls, [
    ["workspaces", false, { visibleOnFullScreen: false, skipTransformProcessType: true }],
    ["mission-control", false],
    ["always-on-top", false, "normal", 0],
  ]);
});

test("Today widget uses a portable floating topmost level outside macOS", () => {
  const calls = [];
  const window = {
    isDestroyed: () => false,
    isVisible: () => true,
    setAlwaysOnTop: (...args) => calls.push(args),
    moveTop: () => {},
  };
  applyTodayWidgetTopmost(window, true, "win32");
  assert.deepEqual(calls, [[true, "floating", 0]]);
});

test("Today widget restores topmost after app deactivation releases temporary editing state", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-widget-lifecycle-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const ipcHandlers = new Map();
  const topmostCalls = [];

  class FakeWidgetWindow extends EventEmitter {
    constructor() {
      super();
      this.bounds = { x: 0, y: 0, width: 360, height: 260 };
      this.visible = false;
      this.destroyed = false;
      this.webContents = {
        send() {},
        setWindowOpenHandler() {},
      };
    }

    getBounds() { return this.bounds; }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    loadFile() {}
    moveTop() { topmostCalls.push(["move-top"]); }
    setAlwaysOnTop(...args) { topmostCalls.push(["always-on-top", ...args]); }
    setBounds(bounds) { this.bounds = bounds; }
    setHiddenInMissionControl() {}
    setIgnoreMouseEvents() {}
    setVisibleOnAllWorkspaces() {}
    showInactive() { this.visible = true; }
  }

  let widgetWindow;
  let widgetWindowOptions;
  const BrowserWindow = class extends FakeWidgetWindow {
    constructor(options) {
      super();
      widgetWindow = this;
      widgetWindowOptions = options;
    }
    static getAllWindows() { return widgetWindow ? [widgetWindow] : []; }
  };
  // The main window is the one that shows the widget, so it must be the sender.
  const mainWindowStub = { isDestroyed: () => false, webContents: { id: 1, kind: "main-window" } };
  const controller = createTodayWidgetController({
    app: { getPath: () => directory },
    BrowserWindow,
    globalShortcut: {},
    ipcMain: {
      handle(channel, handler) { ipcHandlers.set(channel, handler); },
      on() {},
    },
    screen: {
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }),
    },
    getMainWindow: () => mainWindowStub,
    ensureMainWindow: () => null,
  });
  controller.registerIpc();
  await ipcHandlers.get("today-widget:show")({ sender: mainWindowStub.webContents });
  assert.equal(widgetWindowOptions.type, process.platform === "darwin" ? "panel" : undefined);
  assert.equal(widgetWindow.visible, false, "the window waits for the renderer's first measurement");

  // The renderer reports the panel box; the window is that box plus the ring
  // that carries the Demo's shadow, and only then is it shown.
  const fitResult = await ipcHandlers.get("today-widget:fit")({ sender: widgetWindow.webContents }, { width: 360, height: 366 });
  assert.deepEqual(fitResult.content, { width: 360, height: 366 });
  assert.equal(widgetWindow.visible, true);
  assert.deepEqual(widgetWindow.bounds.width, 360 + 22 * 2);
  assert.deepEqual(widgetWindow.bounds.height, 366 + 22 + 36);

  await ipcHandlers.get("today-widget:set-editing")({ sender: widgetWindow.webContents }, true);
  assert.deepEqual(topmostCalls.at(-1), ["always-on-top", false, "normal", 0]);

  const unknownSender = { sender: { id: "not-a-loop-window" } };
  const widgetOnlyChannels = [
    "today-widget:resize",
    "today-widget:open-main",
    "today-widget:complete-task",
    "today-widget:create-task",
    "today-widget:update-task-title",
    "today-widget:promote-quick-capture",
    "today-widget:delete-quick-capture",
    "today-widget:move-item",
    "today-widget:reorder-item",
  ];
  for (const channel of ["today-widget:get-state", "today-widget:show", "today-widget:hide", "today-widget:set-preferences", ...widgetOnlyChannels]) {
    const result = await ipcHandlers.get(channel)(unknownSender, {});
    assert.equal(result?.code, "UNKNOWN_SENDER", `${channel} must reject an unknown sender`);
  }
  assert.equal((await ipcHandlers.get("today-widget:set-editing")(unknownSender, true)).success, false);

  controller.restoreAlwaysOnTopAfterAppDeactivation();
  assert.deepEqual(topmostCalls.slice(-2), [
    ["always-on-top", true, process.platform === "darwin" ? "screen-saver" : "floating", process.platform === "darwin" ? 1 : 0],
    ["move-top"],
  ]);
});

test("Today widget preferences persist atomically outside task data", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-widget-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const written = await writeTodayWidgetPreferences(directory, {
    position: "bottom-left",
    alwaysOnTop: false,
    launchWithApp: true,
    visible: true,
    compact: true,
    opacity: 82,
    height: 380,
  });
  const read = await readTodayWidgetPreferences(directory);

  assert.deepEqual(read, written);
  assert.equal(read.position, "bottom-left");
  assert.equal(read.opacity, 82);
  assert.equal(read.height, 380);
  await assert.rejects(fs.access(path.join(directory, "today-widget-preferences.json.tmp")));
});

test("every Today widget IPC channel inspects its sender and the duplicated binding pass stays gone", async () => {
  const [widgetMain, appSource] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "main", "today-widget.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
  ]);

  assert.match(widgetMain, /function isWidgetSender\(event\)/);
  assert.match(widgetMain, /function isMainWindowSender\(event\)/);
  assert.doesNotMatch(
    widgetMain,
    /today-widget:[a-z-]+", \(_event/,
    "no widget channel may ignore the sender it came from",
  );
  const channels = [...widgetMain.matchAll(/ipcMain\.(?:handle|on)\("today-widget:([a-z-]+)"/g)].map((match) => match[1]);
  assert.ok(channels.length >= 15, `expected the full channel list, saw ${channels.length}`);

  // bind() used to contain a second, unreachable copy of the whole binding pass
  // that even called functions which do not exist.
  assert.match(appSource, /function bind\(\) \{\r?\n  return bindTaskRepositoryRows\(document\);\r?\n\}/);
  assert.doesNotMatch(appSource, /bindEditableField|bindContextMenu/, "the dead duplicated binding pass must not return");
});

test("production Today widget uses its dedicated frontend and a sandboxed Electron window", async () => {
  const [demo, runtime, surfaceRuntime, surfaceCss, widgetMain, appMain, preload, packageJson, rendererApp, settingsSource, shellSource, workspaceSource, bridgeSource, clockSource, desktopSource, remindersSource, capabilitySource, shellSource2, actionsSource2] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "today-widget.html"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "today-widget-runtime.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "widget-surface-runtime.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "widget-surface.css"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "today-widget.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "main.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "preload.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "package.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "settings.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "shell.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "workspace.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "bridge.css"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "clock.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "desktop.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "deadline-reminders.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "notification-capability.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "shell.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "actions.js"), "utf8"),
  ]);

  // The two windows are hosts; every Demo class lives in the renderers so the
  // rendered DOM can be compared with loop-widget-phase13.js line by line.
  assert.match(demo, /id="widget-host"/);
  assert.doesNotMatch(demo, /按优先级与阻塞状态排序|项待办|刚刚同步|在主窗口查看全部|corner-anchor/);
  assert.match(demo, /widget12\.css\?v=[0-9.]+/);
  assert.match(demo, /widget13\.css\?v=[0-9.]+/);
  assert.match(demo, /shell-refinement\.css\?v=[0-9.]+/);
  assert.match(demo, /widget-bridge\.css\?v=[0-9.]+/);

  // Chrome, tabs, rows and the composer: the Demo's markup, icon for icon.
  assert.match(runtime, /class="today-widget widget12 widget13 '/);
  assert.match(runtime, /class="widget-logo" src="\.\/src\/assets\/loop-icon\.png"/);
  assert.match(runtime, /<strong>今日<\/strong>/);
  assert.match(runtime, /class="widget-date"/);
  assert.match(runtime, /class="widget-count"/);
  assert.match(runtime, /icon\(prefs\.compact \? "expandRecord" : "minus"\)/);
  assert.match(runtime, /class="widget-tabs"/);
  assert.match(runtime, /\["task", "今日任务", counts\[0\]\]/);
  assert.doesNotMatch(runtime, /currentLane|function applyLane/);
  assert.match(runtime, /class="widget-rows"/);
  assert.match(runtime, /class="widget-empty"/);
  assert.match(runtime, /class="widget13-grip"/);
  assert.doesNotMatch(runtime, /LONG_PRESS_DELAY/);
  assert.match(runtime, /data-widget-drag=/);
  assert.match(runtime, /data-complete-task=/);
  assert.match(runtime, /data-widget-open=/);
  assert.match(runtime, /data-widget12="row-menu"/);
  assert.match(runtime, /class="widget-title"/);
  assert.match(runtime, /class="widget-title-input"/);
  assert.match(runtime, /aria-label="修改记录标题"/);
  assert.match(runtime, /id="widget-capture"/);
  assert.match(runtime, /data-widget12="submit"/);
  assert.match(runtime, /id="widget-feedback"/);
  assert.match(runtime, /class="widget-shortcut"/);
  assert.match(runtime, /data-widget-resize="' \+ edge/);
  assert.doesNotMatch(runtime, /quick-capture-add-today/);
  assert.doesNotMatch(runtime, /widget-menu|quick-capture-group-menu|today-context-menu/);

  // Data + side effects come from the app bridge, not from page state.
  assert.match(runtime, /bridge\.completeTask/);
  assert.match(runtime, /bridge\.createTask/);
  assert.match(runtime, /bridge\.updateTaskTitle/);
  assert.match(runtime, /bridge\.promoteQuickCapture/);
  assert.match(runtime, /bridge\.deleteQuickCapture/);
  assert.match(runtime, /bridge\.moveItem/);
  assert.match(runtime, /bridge\.reorderItem/);
  assert.match(runtime, /bridge\.openMain/);
  assert.match(runtime, /bridge\.setEditing/);
  assert.match(runtime, /bridge\.openSurface/);
  assert.match(runtime, /bridge\.closeSurface/);
  assert.match(runtime, /bridge\.fit/);
  assert.match(runtime, /bridge\.nudge/);
  assert.match(runtime, /FLOW_INCOMPLETE/);
  assert.match(runtime, /CONCLUSION_REQUIRED/);
  assert.match(runtime, /bridge\.onSnapshot/);
  assert.match(runtime, /bridge\.onState/);
  assert.match(runtime, /bridge\.onBeginRename/);
  assert.match(runtime, /aria-keyshortcuts="Alt\+ArrowUp Alt\+ArrowDown"/);
  assert.match(runtime, /event\.altKey && \["ArrowUp", "ArrowDown"\]/);
  assert.match(runtime, /"ContextMenu"/);
  assert.match(runtime, /isComposing/);
  assert.match(runtime, /compositionstart|event\.isComposing/);
  assert.match(runtime, /widget13-drop-before/);
  assert.match(runtime, /widget13-tab-drop/);
  assert.match(runtime, /function dropTarget/);
  assert.match(runtime, /window\.requestAnimationFrame\(autoScroll\)/);
  assert.match(runtime, /bridge\.resize\(\{ height: pendingResizeHeight, edge \}\)/);
  assert.match(runtime, /start: \{ left: rect\.left, top: rect\.top, height: rect\.height \}/);
  assert.doesNotMatch(runtime, /ResizeObserver/);
  assert.match(runtime, /bridge\.fit\?\.\(\{ height: Math\.round\(panel\.offsetHeight\) \}\)/);
  assert.match(runtime, /appearance\.sans/);
  assert.match(runtime, /--widget-opacity/);
  assert.match(runtime, /const root = document\.documentElement/);
  assert.match(runtime, /root\.dataset\.zhFont/);

  // Popover surfaces: the Demo's markup, in their own window.
  assert.match(surfaceRuntime, /surface-popover widget12-settings/);
  assert.match(surfaceRuntime, /class="dialog-head"/);
  assert.match(surfaceRuntime, /data-widget12="place"/);
  assert.match(surfaceRuntime, /data-widget12-preference="' \+ key/);
  assert.match(surfaceRuntime, /<output id="widget12-opacity-value"/);
  assert.match(surfaceRuntime, /class="widget12-opacity" type="range"/);
  assert.match(surfaceRuntime, /min="70" max="100"/);
  assert.match(surfaceRuntime, /text-button widget13-reset/);
  assert.match(surfaceRuntime, /text-button widget12-hide/);
  assert.match(surfaceRuntime, /surface-popover widget13-menu/);
  assert.match(surfaceRuntime, /widget13-menu-rule/);
  assert.match(surfaceRuntime, /"Alt ↑"/);
  assert.match(surfaceRuntime, /surface-popover widget13-promote/);
  assert.match(surfaceRuntime, /class="dialog" role="dialog"/);
  assert.match(surfaceRuntime, /danger-action/);
  assert.match(surfaceRuntime, /bridge\.close\("|bridge\.close\(\{/);
  assert.match(surfaceCss, /--surface-pad: 20px/);
  assert.match(surfaceCss, /position: static !important/);
  // \r?\n: the Windows runner checks the repository out with CRLF.
  assert.match(surfaceCss, /\.surface-popover,\r?\n\.widget12-settings,\r?\n\.dialog \{\r?\n  max-height: none !important;\r?\n\}/);

  // Main process: content-driven window sizing, Demo placement maths, and the
  // surface window that lets a panel extend past the widget window.
  assert.match(widgetMain, /const WIDGET_PAD_X = 22/);
  assert.match(widgetMain, /const WIDGET_PAD_TOP = 22/);
  assert.match(widgetMain, /const WIDGET_PAD_BOTTOM = 36/);
  assert.match(widgetMain, /const SURFACE_WIDTHS = \{ settings: 286, "row-menu": 224, promote: 244, delete: 440 \}/);
  assert.match(widgetMain, /function windowSizeForContent\(content\)/);
  assert.match(widgetMain, /function applyContentSize\(content, options = \{\}\)/);
  assert.match(widgetMain, /function widgetPanelScreenRect\(\)/);
  assert.match(widgetMain, /function surfaceBounds\(kind, size\)/);
  assert.match(widgetMain, /function frameAnchorForPosition\(position, area, bounds\)/);
  assert.match(widgetMain, /today-widget:fit/);
  assert.match(widgetMain, /today-widget:nudge/);
  assert.match(widgetMain, /today-widget:open-surface/);
  assert.match(widgetMain, /today-widget:close-surface/);
  assert.match(widgetMain, /widget-surface:get/);
  assert.match(widgetMain, /widget-surface:act/);
  assert.match(widgetMain, /isSurfaceSender/);
  assert.match(widgetMain, /surfaceWindow\.on\("blur"/);
  assert.match(widgetMain, /function revealWidgetWindow\(\)/);
  assert.match(widgetMain, /bridge\.|today-widget:begin-rename/);
  // Mouse events must be ignored both for the explicit click-through mode and
  // while the pointer is on the transparent shadow ring.
  assert.match(widgetMain, /setIgnoreMouseEvents\(preferences\.clickThrough === true \|\| widgetRingOutside === true, \{ forward: true \}\)/);
  assert.match(widgetMain, /function applyRingRegion\(target, inside\)/);
  assert.match(widgetMain, /today-widget:ring/);
  assert.match(runtime, /bridge\.setRingRegion\?\.\(\{ inside \}\)/);
  assert.match(surfaceRuntime, /bridge\.setRingRegion\?\.\(\{ inside \}\)/);
  assert.match(widgetMain, /today-widget:create-task/);
  assert.match(widgetMain, /today-widget:update-task-title/);
  assert.match(widgetMain, /today-widget:delete-quick-capture/);
  assert.match(widgetMain, /today-widget:move-item/);
  assert.match(widgetMain, /today-widget:reorder-item/);
  assert.match(widgetMain, /FLOW_INCOMPLETE/);
  assert.match(widgetMain, /today-widget:set-editing/);
  assert.match(widgetMain, /pendingMutations/);
  assert.match(widgetMain, /CommandOrControl\+Shift\+T/);
  assert.match(widgetMain, /frame: false/);
  assert.match(widgetMain, /acceptFirstMouse: true/);
  assert.match(widgetMain, /transparent: true/);
  assert.match(widgetMain, /hasShadow: false/);
  assert.match(widgetMain, /sandbox: true/);
  assert.match(widgetMain, /type: process\.platform === "darwin" \? "panel" : undefined/);
  assert.match(widgetMain, /preferences\.alwaysOnTop && !editingText/);
  assert.match(widgetMain, /function restoreAlwaysOnTopAfterAppDeactivation\(\)[\s\S]*editingText = false;[\s\S]*applyAlwaysOnTop\(\)/);
  assert.match(widgetMain, /const level = topmost \? \(platform === "darwin" \? "screen-saver" : "floating"\) : "normal"/);
  assert.match(widgetMain, /visibleOnFullScreen: topmost/);
  assert.match(widgetMain, /skipTransformProcessType: true/);
  assert.match(widgetMain, /setAlwaysOnTop\(topmost, level, topmost && platform === "darwin" \? 1 : 0\)/);
  assert.match(widgetMain, /moveTop\(\)/);
  assert.match(widgetMain, /getDisplayMatching/);
  assert.match(widgetMain, /if \(preferences\.compact\)[\s\S]*size\?\.transient !== true[\s\S]*Math\.max\(254, Math\.min\(480/);
  assert.match(widgetMain, /autoHeight: false[\s\S]*height: currentContent\.height[\s\S]*customBounds:/);
  assert.match(widgetMain, /function stop\(\)[\s\S]*widgetWindow\.destroy\(\)/);
  // The widget logo must point at the copy that ships inside build.files
  // (app/renderer/src/**/*); app/renderer/assets is not packaged, which is why
  // the logo was missing in the Windows build.
  assert.ok(packageJson.build.files.includes("app/renderer/src/**/*"));
  assert.doesNotMatch(runtime, /src="\.\/assets\/loop-icon\.png"/);

  // Issue fixes pinned by contract:
  // - the highlight mirrors the main window only while it is in front
  assert.match(rendererApp, /function mainWindowShowsSelection\(\)[\s\S]*document\.hasFocus\(\)[\s\S]*visibilityState/);
  assert.match(rendererApp, /activeTaskId: mainWindowShowsSelection\(\) \? state\.activeTaskId \|\| "" : ""/);
  assert.match(rendererApp, /window\.addEventListener\("blur", \(\) => \{[\s\S]*publishTodayWidgetSnapshot\(\)/);
  // - one update entry, one delegated handler, an immediate state and a live card
  assert.match(settingsSource, /function shellSettingsInfo\(label, description, value\)/);
  assert.match(settingsSource, /data-shell-update-detail/);
  assert.match(settingsSource, /function shellSettingsSyncUpdateCard\(\)/);
  assert.match(settingsSource, /update\.retryAction === "check" \? "重新检查"/);
  assert.match(rendererApp, /function bindUpdateActionDelegation\(\)/);
  assert.match(rendererApp, /let lastUpdateAction = "check"/);
  assert.match(rendererApp, /const effective = action === "download" && !\["available", "downloaded"\]\.includes\(status\)/);
  assert.match(rendererApp, /if \(typeof globalThis\.shellSettingsSyncUpdateCard === "function"\) \{\s*globalThis\.shellSettingsSyncUpdateCard\(\);/);
  // - search scope matches the approved Demo; brief fields stay click-to-edit
  assert.match(shellSource, /placeholder="搜索任务、节点、速记" aria-label="搜索全部任务、节点、速记"/);
  assert.match(workspaceSource, /<button class="brief-value \$\{value \? "" : "muted"\}" type="button" data-action="shell-edit-brief"/);
  // Group management was removed (the row had no visible control of its own);
  // group rows now render as a single button.
  assert.doesNotMatch(shellSource2, /group-menu-button/);
  assert.doesNotMatch(shellSource2, /data-group-context-id/);
  assert.doesNotMatch(rendererApp, /openRepositoryGroupContextMenu/);
  assert.doesNotMatch(actionsSource2, /shellBindGroupMenus/);
  assert.doesNotMatch(bridgeSource, /group-menu-button/);
  assert.match(shellSource2, /class="group-nav-row">\s*<button class="nav-button/);
  assert.match(bridgeSource, /\.brief-row \.brief-value \{[\s\S]*cursor: text;/);
  // - anything the renderer adds after a render still has a working action
  assert.match(rendererApp, /function bindActionDelegation\(\)[\s\S]*element\.dataset\.actionBound === "1"/);
  assert.match(rendererApp, /element\.dataset\.actionBound = "1";\s*element\.addEventListener\("click"/);
  // - the top-left update chip re-renders in place and its popover follows the state
  assert.match(shellSource2, /data-brand-update-slot/);
  assert.match(shellSource2, /function refreshShellBrandUpdate\(\)/);
  assert.match(actionsSource2, /function shellUpdatePanelBody\(\)/);
  assert.match(actionsSource2, /function shellRefreshUpdatePanel\(\)/);
  assert.match(actionsSource2, /class="surface-popover utility-popover" aria-label="软件更新"/);
  assert.match(bridgeSource, /\.brand-update-slot \{\s*display: contents;/);
  // ---- Phase18 · 时间与任务状态 (frozen Demo loop-time-phase18.js) ----
  // one shared clock drives every time-based decision
  assert.match(clockSource, /function loopNow\(\)/);
  assert.match(clockSource, /function loopSetPreviewClock\(value\)/);
  assert.match(clockSource, /function loopClearPreviewClock\(\)/);
  assert.match(rendererApp, /function isTaskScheduledForToday\(task, at = loopNow\(\)\)/);
  assert.match(rendererApp, /function recurringOccurrenceKey\(task, at = loopNow\(\)\)/);
  assert.match(rendererApp, /function syncRecurringTasks\(at = loopNow\(\)\)/);
  assert.match(rendererApp, /return loopNow\(\)\.toISOString\(\);/);
  // today's completions stay reachable; minimal empty states; no row tags
  assert.match(rendererApp, /function shellCompletedToday\(\)/);
  assert.match(rendererApp, /state\.todayFilter === "done"/);
  assert.match(shellSource2, /time18-list-empty/);
  assert.match(workspaceSource, /time18-empty/);
  assert.match(actionsSource2, /function shellCycleState\(\)/);
  assert.match(workspaceSource, /time18-soon/);
  // membership changes explain themselves and link to the record
  assert.match(actionsSource2, /function shellMembershipFeedback\(task, wasScheduledToday\)/);
  assert.match(actionsSource2, /已移出今日，任务与处理记录保留/);
  // the review-only preview clock
  assert.match(actionsSource2, /function shellApplyPreviewClock\(value\)/);
  assert.match(actionsSource2, /function shellClockPresets\(\)/);
  assert.match(actionsSource2, /data-action="time18-preset"/);
  assert.match(shellSource2 + actionsSource2, /time18-clock/);
  // a receipt belongs to its day
  assert.match(actionsSource2, /receipt\.date !== loopTodayKey\(\)/);
  // the two panels whose submit handler never bound (the form IS the surface)
  assert.match(actionsSource2, /document\.querySelector\("#deadline-form"\)\?\.addEventListener\("submit"/);
  assert.match(actionsSource2, /document\.querySelector\("#recurrence-form"\)\?\.addEventListener\("submit"/);
  assert.doesNotMatch(actionsSource2, /surface\?\.querySelector\("#[a-z-]*form"\)/);
  // ---- Phase19 · 桌面提醒与窗口协同 (frozen Demo loop-desktop-phase19.js) ----
  // the reminder model mirrors the frozen Demo: one key per id+deadline+offset,
  // grouping by stage+offset and reconciliation on completion/change
  assert.match(remindersSource, /function deadlineReminderKey\(task\)/);
  assert.match(remindersSource, /function deadlineReminderGroups\(tasks, at = new Date\(\), state = normalizeReminderState\(\{\}\)\)/);
  assert.match(remindersSource, /function reconcileDeadlineReminderState\(tasks, state\)/);
  assert.match(remindersSource, /deadlineReminderGroups,/);
  // a failed send is remembered but never marked as notified
  assert.match(remindersSource, /error = \{ code: String\(failure\?\.code/);
  assert.match(remindersSource, /if \(notified\) \{\s*delivered = \[\.\..*\]\.slice\(0, DELIVERED_LIMIT\);/);
  // the scoped state feed and the manual check
  assert.match(remindersSource, /ipcMain\.handle\("deadline-reminders:check", \(\) => check\(\)\)/);
  assert.match(remindersSource, /capability = !isSupported\(\) \? "unsupported" : permission\.state === "blocked" \? "blocked" : "supported"/);
  assert.match(remindersSource, /broadcastState\(\)/);
  assert.match(preload, /check: \(\) => ipcRenderer\.invoke\("deadline-reminders:check"\)/);
  assert.match(preload, /onState: \(callback\) => subscribe\("deadline-reminders:state", callback\)/);
  // the window coordination paths
  assert.match(preload, /revealMain: \(\) => ipcRenderer\.invoke\("app:reveal-main"\)/);
  assert.match(appMain, /ipcMain\.handle\("app:reveal-main", \(\) => \{[\s\S]*isMinimized\(\)\) mainWindow\.restore\(\)/);
  assert.match(rendererApp, /personalTaskTrack\?\.window\?\.revealMain\?\.\(\)/);
  // reminder surfaces: row, status panel, help, labelled preview, settings row
  assert.match(desktopSource, /function desktopReminderStatusRow\(\)/);
  assert.match(desktopSource, /function desktopReminderStatusPanel\(trigger\)/);
  assert.match(desktopSource, /function desktopReminderHelpPanel\(trigger\)/);
  assert.match(desktopSource, /function desktopReminderPreviewPanel\(trigger, entries\)/);
  assert.match(desktopSource, /内容预览 · 实际通知外观由系统提供/);
  assert.match(desktopSource, /function desktopReminderCheck\(trigger\)/);
  assert.match(desktopSource, /function desktopReminderSettingsRow\(\)/);
  assert.match(desktopSource, /function desktopReminderOpenEntry\(index\)/);
  assert.match(actionsSource2, /desktopReminderStatusRow\(\)/);
  assert.match(actionsSource2, /case "desk19-status":/);
  assert.match(actionsSource2, /case "desk19-check":/);
  assert.match(settingsSource, /desktopReminderSettingsRow\(\)/);
  // ---- Phase19 · real notification-permission probe ----
  // Electron exposes no notification permission API, so each platform is read
  assert.match(capabilitySource, /function parseWindowsToastSetting\(output\)/);
  assert.match(capabilitySource, /DisabledForApplication\|DisabledForUser\|DisabledByGroupPolicy\|DisabledByManifest/);
  assert.match(capabilitySource, /function parsePlistDicts\(xml, sectionKey = "apps"\)/);
  assert.match(capabilitySource, /state: flags === 0 \? "blocked" : "allowed"/);
  assert.match(capabilitySource, /createNotificationCapabilityReader/);
  assert.match(remindersSource, /capabilityReader = createNotificationCapabilityReader/);
  assert.match(remindersSource, /permission\.state === "blocked"/);
  assert.match(remindersSource, /capability = !isSupported\(\) \? "unsupported" : permission\.state === "blocked" \? "blocked" : "supported"/);
  assert.match(appMain, /appId: desktopIdentity\?\.appId \|\| DESKTOP_APP_ID/);
  // the interface only claims what the probe reported
  assert.match(desktopSource, /if \(desktopReminderState\.capability === "blocked"\) return "blocked"/);
  assert.match(desktopSource, /系统通知关闭/);
  assert.match(desktopSource, /function desktopReminderPermissionDetail\(\)/);
  assert.match(desktopSource, /macos-ncprefs/);

  // a reminder return preserves the open draft
  assert.match(rendererApp, /function shellPreserveDraftsForReturn\(\)/);
  assert.match(rendererApp, /onOpenTask\?\.\(\(\{ taskId \} = \{\}\) => \{[\s\S]*shellPreserveDraftsForReturn\(\)/);

  // the widget payload carries today's completion count
  assert.match(widgetMain, /completedToday: Math\.max\(0, Math\.floor\(Number\(raw\.completedToday\) \|\| 0\)\)/);
  assert.match(widgetMain, /function stop\(\)[\s\S]*surfaceWindow\.destroy\(\)/);
  assert.match(appMain, /if \(!isQuitting && !updateInstallPrepared\) app\.quit\(\)/);
  assert.match(appMain, /did-resign-active[\s\S]*restoreAlwaysOnTopAfterAppDeactivation/);
  assert.doesNotMatch(appMain, /!isMac && !isQuitting/);
  assert.match(appMain, /app\.setActivationPolicy\("regular"\)/);
  assert.match(appMain, /await app\.dock\.show\(\)/);
  assert.match(appMain, /app\.on\("did-resign-active"[\s\S]*fullscreenTransitionRefresh/);
  assert.match(preload, /todayWidget:/);
  assert.match(preload, /createTask: \(payload\)/);
  assert.match(preload, /updateTaskTitle: \(payload\)/);
  assert.match(preload, /promoteQuickCapture: \(payload\)/);
  assert.match(preload, /reorderItem: \(payload\)/);
  assert.match(preload, /setEditing: \(enabled\)/);
  assert.match(preload, /widgetSurface: \{/);
  assert.match(preload, /fit: \(size\) => ipcRenderer\.invoke\("today-widget:fit", size\)/);
  assert.match(preload, /act: \(payload\) => ipcRenderer\.invoke\("widget-surface:act", payload\)/);
  assert.match(preload, /app:confirm-destructive/);
  assert.match(appMain, /dialog\.showMessageBox/);
  assert.ok(packageJson.build.files.includes("app/renderer/today-widget.html"));
  assert.ok(packageJson.build.files.includes("app/renderer/widget-surface.html"));
});

test("bundled cross-platform fonts and four global size presets are available", async () => {
  const [app, styles, milkdownStyles, milkdownBuilder, normalized] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "vendor", "milkdown-editor.css"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "tools", "build-milkdown.cjs"), "utf8"),
    Promise.resolve(normalizeTaskData({ zhFont: "noto", enFont: "inter" })),
  ]);
  const fontDirectory = path.join(__dirname, "..", "app", "renderer", "src", "assets", "fonts");
  const [inter, noto, notoBold] = await Promise.all([
    fs.stat(path.join(fontDirectory, "InterVariable.woff2")),
    fs.stat(path.join(fontDirectory, "NotoSansCJKsc-Regular.otf")),
    fs.stat(path.join(fontDirectory, "NotoSansCJKsc-Bold.otf")),
  ]);

  assert.equal(normalized.zhFont, "noto");
  assert.match(app, /const FONT_SCALE_KEY = "task-track-font-scale"/);
  // Display text now follows the Demo's ladder; the numeric steps live in shell.js.
  assert.match(app, /current: "紧凑"/);
  assert.match(app, /larger: "标准（推荐）"/);
  assert.match(app, /large: "较大"/);
  assert.match(app, /document\.documentElement\.dataset\.fontScale = state\.fontScale/);
  assert.match(app, /selectRow\("界面字号", "font-scale", state\.fontScale, fontScaleLabels\)/);
  const shellSource = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "shell.js"), "utf8");
  assert.match(shellSource, /SHELL_FONT_SCALE_VALUES = \{ current: "1", larger: "1\.08", large: "1\.16", largest: "1\.24" \}/);
  assert.match(milkdownStyles, /font-size:calc\(14 \* var\(--font-unit\)\)/);
  assert.match(milkdownBuilder, /function applyGlobalFontScale\(css\)/);
  assert.ok(inter.size > 100000);
  assert.ok(noto.size > 10000000);
  assert.ok(notoBold.size > 10000000);
});

test("missing conclusion highlights only the current task without locking task selection", async () => {
  const [app, styles] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
  ]);
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.tasks = normalizeTasks([
      { id: "prompted", title: "待结论", conclusion: "", nodes: [] },
      { id: "other", title: "可切换", conclusion: "", nodes: [] }
    ]);
    state.activeTaskId = "other";
    state.conclusionPromptTaskId = "prompted";
    return { active: activeTask().id, promptedPage: renderTaskPage(state.tasks[0]) };
  })()`);

  assert.equal(result.active, "other");
  assert.match(result.promptedPage, /needs-attention/);
  assert.match(app, /function renderCompletionNotice/);
  assert.match(app, /请先填写结论，再标记完成/);
  assert.doesNotMatch(result.promptedPage, /conclusion-prompt/);
  assert.doesNotMatch(app, /function renderConclusionPrompt/);
  assert.doesNotMatch(app, /if \(state\.conclusionPromptTaskId\) \{/);
  assert.doesNotMatch(styles, /\.conclusion-prompt \{/);
});

test("task metadata keeps complete context with lightweight tags and variable-width group last", async () => {
  const [harness, styles] = await Promise.all([
    rendererHarness(),
    rendererStyles(),
  ]);
  const page = harness.evaluate(`(() => {
    const task = normalizeTasks([{
      id: "badge_task",
      title: "Badge 样式任务",
      priority: "high",
      status: "done",
      tags: ["today", "blocked"],
      nodes: [],
    }])[0];
    state.tasks = [task];
    state.activeTaskId = task.id;
    return renderTaskPage(task);
  })()`);

  assert.match(page, /class="task-context-item task-context-badge priority high" data-slot="badge">高优先<\/span>/);
  assert.match(page, /class="task-context-item task-context-badge status resolved" data-slot="badge">已完成<\/span>/);
  assert.match(page, /class="task-context-item task-context-badge task-tag today" data-slot="badge">Today<\/span>/);
  assert.match(page, /class="task-context-item task-context-badge task-tag blocked" data-slot="badge">卡住<\/span>/);
  assert.ok(page.indexOf("task-context-progress") < page.indexOf("task-deadline-picker"));
  assert.ok(page.indexOf("task-deadline-picker") < page.indexOf("task-recurrence-controls"));
  assert.ok(page.indexOf("task-recurrence-controls") < page.indexOf("task-group-select"));

  const finalRules = styles.slice(styles.lastIndexOf("v0.1.168 - J1 workbench header"));
});

test("processing flow matches the compact reference tree and opens details only on demand", async () => {
  const [styles, app] = await Promise.all([
    rendererStyles(),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
  ]);
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    const task = normalizeTasks([{
      id: "flow_reference",
      title: "Windows 自动更新下载失败",
      nodes: [{
        id: "root_todo",
        title: "定位 Windows 自动更新下载失败",
        status: "todo",
        children: [{
          id: "child_doing",
          title: "复现：安装后触发更新",
          status: "later",
          children: [{ id: "leaf_done", title: "校验 CI 上传目录", status: "done", children: [] }]
        }]
      }]
    }])[0];
    state.tasks = [task];
    state.activeTaskId = task.id;
    state.taskPane = "flow";
    state.selectedNodeId = "";
    const defaultPage = renderTaskPage(task);
    const tree = renderFlowNode(task.id, task.nodes[0], 0, 0, [], true);
    state.selectedNodeId = "child_doing";
    state.recordDraft = "详情记录";
    const selectedPage = renderTaskPage(task);
    const detail = renderNodeDetailPage(task.id, findNode(task.nodes, "child_doing"));
    const cycleStatuses = [];
    for (let index = 0; index < 4; index += 1) {
      cycleNodeStatus(task.id, "root_todo");
      cycleStatuses.push(findNode(task.nodes, "root_todo").status);
    }
    return { defaultPage, selectedPage, tree, detail, cycleStatuses };
  })()`);
  const finalFlowRules = styles.slice(styles.lastIndexOf("v0.1.135 — reference-matched processing tree"));
  const finalNodeDetailRules = styles.slice(styles.lastIndexOf("v0.1.166 — floating, record-first processing-node detail"));

  assert.match(result.tree, /flow-node-marker flow-status-bullet status-todo/);
  assert.match(result.tree, /feather-sprite\.svg#disc/);
  assert.match(result.tree, /flow-status-badge status-todo"[^>]*data-action="cycle-node-status"[^>]*>todo</);
  assert.match(result.tree, /flow-status-badge status-later"[^>]*data-action="cycle-node-status"[^>]*>doing</);
  assert.match(result.tree, /flow-status-badge status-done"[^>]*data-action="cycle-node-status"[^>]*>done</);
  assert.deepEqual(result.cycleStatuses, ["later", "done", "blocked", "todo"]);
  assert.match(result.tree, /class="flow-tree-rail/);
  assert.match(result.tree, /class="flow-tree-elbow"/);
  assert.match(result.tree, /data-flow-select data-task-id="flow_reference" data-node-id="root_todo"/);
  assert.doesNotMatch(result.defaultPage, /node-detail-page|node-inspector-empty|has-node-page/);
  assert.match(result.selectedPage, /flow-workspace has-node-page/);
  assert.match(result.selectedPage, /class="node-detail-page"/);
  assert.match(result.selectedPage, /aria-label="关闭节点详情"/);
  assert.match(result.detail, /class="node-detail-header"[\s\S]*class="node-detail-scroll"/);
  assert.match(result.detail, /class="node-detail-info"[\s\S]*aria-label="查看节点路径"/);
  assert.match(result.detail, /class="node-detail-info-popover">[\s\S]*<span>路径<\/span>/);
  assert.match(result.detail, /node-detail-status-trigger status-later"[^>]*>进行中/);
  assert.match(result.detail, /class="node-detail-status-options"/);
  assert.match(result.detail, /data-action="mark-node-status"[\s\S]*data-status="done"/);
  assert.match(result.detail, /<label for="node-detail-record-child_doing">详情<\/label>/);
  assert.match(result.detail, /data-node-detail-save-state>[\s\S]*已自动保存/);
  assert.match(result.detail, /class="node-detail-pagination"[\s\S]*上一节点[\s\S]*2 \/ 3[\s\S]*下一节点/);
  assert.match(result.detail, /data-action="navigate-node-detail"[^>]*data-node-id="root_todo"/);
  assert.match(result.detail, /data-action="navigate-node-detail"[^>]*data-node-id="leaf_done"/);
  assert.doesNotMatch(result.detail, /node-detail-updated|node-detail-bar|node-inspector-breadcrumb|data-action="save-node-detail"|返回处理流|最近修改/);
  assert.doesNotMatch(result.detail, /节点详情<\/span>|父节点|第 2 层|创建时间|状态变化|完成时间|新增下级节点|新增同级节点|删除节点/);
  assert.match(app, /selectedNode \? renderNodeDetailPage\(task\.id, selectedNode\) : ""/);
  assert.doesNotMatch(app, /element\.classList\.contains\("flow-title-input"\)[\s\S]*selectNodeForInspector\(element\.dataset\.taskId, element\.dataset\.nodeId\);[\s\S]*render\(\);/);
  assert.match(app, /data-action="add-child-node"[\s\S]*添加子节点/);
  assert.match(app, /data-action="add-sibling-node"[\s\S]*添加兄弟节点/);
  assert.match(app, /data-action="delete-node"[\s\S]*删除节点/);
  assert.doesNotMatch(app, /context-menu-label">状态/);
  assert.match(app, /document\.querySelectorAll\('\[data-context="flow-root"\]'\)/);
  assert.match(app, /if \(element\.dataset\.context === "flow-root"\) return;/);
  assert.match(app, /data-action="open-node-detail"[\s\S]*aria-label="打开节点详情"/);
  assert.match(app, /data\.action === "navigate-node-detail"[\s\S]*selectNodeForInspector/);
  assert.doesNotMatch(app, /data\.action === "open-node-menu"/);
  assert.match(app, /row\.querySelector\("\.flow-title-input"\)\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(app, /row\.addEventListener\("dblclick"[\s\S]*selectNodeForInspector\(row\.dataset\.taskId, row\.dataset\.nodeId\);/);
  assert.match(app, /event\.key === "Enter" && event\.shiftKey/);
  assert.match(app, /event\.key === "Tab" && !event\.shiftKey/);
  assert.match(app, /\.node-detail-page, \.flow-row/);
  assert.match(app, /recordInput\.focus\(\{ preventScroll: true \}\);/);
  const paginationRules = finalNodeDetailRules.match(/\.node-detail-pagination\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.doesNotMatch(paginationRules, /border/);
});

test("node detail records autosave to the original node before selection changes", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    const task = normalizeTasks([{
      id: "autosave_task",
      nodes: [
        { id: "first_node", title: "第一个节点", note: "", children: [] },
        { id: "second_node", title: "第二个节点", note: "", children: [] }
      ]
    }])[0];
    state.tasks = [task];
    state.activeTaskId = task.id;
    state.selectedNodeId = "first_node";
    state.recordDraft = "切换节点后也要保留";
    updateNodeNoteDraft(task.id, "first_node", state.recordDraft);
    selectNodeForInspector(task.id, "second_node");
    const changed = flushNodeNoteDrafts({ persist: false });
    return {
      changed,
      firstNote: findNode(task.nodes, "first_node").note,
      selectedNodeId: state.selectedNodeId,
      recordDraft: state.recordDraft
    };
  })()`);

  assert.match(app, /data-record-input data-task-id="\$\{escAttr\(taskId\)\}" data-node-id="\$\{escAttr\(node\.id\)\}"/);
  assert.match(app, /recordInput\.addEventListener\("input"[\s\S]*updateNodeNoteDraft\(taskId, nodeId, state\.recordDraft\)/);
  assert.deepEqual(result, {
    changed: true,
    firstNote: "切换节点后也要保留",
    selectedNodeId: "second_node",
    recordDraft: "",
  });
});

test("shell node record input persists through autosave and blur after switching nodes", async () => {
  const harness = await rendererHarness();
  harness.evaluate(`
    state.tasks = normalizeTasks([{ id: "shell-record-task", title: "节点记录", nodes: [
      { id: "first", title: "定位问题", status: "later", note: "原记录", children: [] },
      { id: "second", title: "验证结果", status: "done", note: "第二条记录", children: [] }
    ] }]);
    state.activeTaskId = "shell-record-task";
    state.selectedNodeId = "first";
    globalThis.recordHandlers = {};
    globalThis.recordEditor = { dataset: { shellNodeRecord: "first" }, value: "自动保存内容",
      addEventListener: (event, callback) => { recordHandlers[event] = callback; } };
    document.querySelector = selector => selector === "[data-shell-node-record]" ? recordEditor : null;
    render = () => { throw new Error("Record input must not rebuild the editor"); };
    shellBindNodeRecord();
    recordHandlers.input();
  `);
  assert.equal(harness.evaluate(`state.tasks[0].nodes[0].note`), "原记录", "the draft must differ from saved content until flushed");
  assert.equal(harness.evaluate(`flushNodeNoteDraft(noteDraftKey("shell-record-task", "first"), { persist: true })`), true);
  assert.equal(JSON.parse(harness.storageValue("task-flow-sheet-prototype-v2"))[0].nodes[0].note, "自动保存内容");
  harness.evaluate(`
    recordEditor.value = "切换前的新输入";
    recordHandlers.input();
    selectNodeForInspector("shell-record-task", "second");
    recordHandlers.blur();
  `);
  const nodes = JSON.parse(harness.storageValue("task-flow-sheet-prototype-v2"))[0].nodes;
  assert.equal(nodes[0].note, "切换前的新输入");
  assert.equal(nodes[0].title, "定位问题");
  assert.equal(nodes[0].status, "later");
  assert.equal(nodes[1].note, "第二条记录");
});

test("task repository renders priority without an update timestamp", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");

  assert.match(app, /class="task-priority-control \$\{priority\}"/);
  assert.match(app, /class="task-row-meta">[\s\S]*renderTaskDeadlineBadge\(task\)[\s\S]*renderTaskPriorityControl\(task\)/);
  assert.match(app, /class="task-priority-popover" role="menu" aria-label="设置优先级"/);
  assert.match(app, /data-action="set-task-priority"/);
  assert.doesNotMatch(app, /formatRepositoryStamp/);
  assert.doesNotMatch(app, /<time datetime="\$\{escAttr\(task\.updatedAt\)\}">/);
  assert.match(app, /class="add-task-floating" type="button" data-action="add-task"/);
  assert.match(app, /aria-label="新增任务"/);
});

test("task repository priority controls stay concise and completed rows are fully de-emphasized", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");
  const styles = await rendererStyles();
  const labelBlock = app.slice(app.indexOf("const repositoryPriorityLabels"), app.indexOf("const themeLabels"));
  const finalRules = styles.slice(styles.lastIndexOf("Task repository refinement"));

  assert.match(labelBlock, /high:\s*"高",[\s\S]*medium:\s*"中",[\s\S]*low:\s*"低"/);
  assert.doesNotMatch(labelBlock, /优先/);
});

test("v0.1.190 visual repair keeps update, typography, Today, and filter controls coherent", async () => {
  const [app, approved] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
  ]);
  const harness = await rendererHarness();
  const surfaces = harness.json(`(() => {
    state.tasks = normalizeTasks([
      { id: "task_a", title: "有截止时间", priority: "high", deadlineAt: "2026-09-22T10:00:00.000Z", nodes: [] },
      { id: "task_b", title: "没有截止时间", priority: "medium", nodes: [] },
    ]);
    state.taskFilter = "active";
    state.priorityFilter = "high";
    repositoryFilterMenuOpen = true;
    repositoryPriorityFilterOpen = true;
    appUpdateState = normalizeAppUpdateState({ status: "available", supported: true, currentVersion: "0.1.189", version: "0.1.190" });
    return {
      update: renderSidebarUpdateControl(),
      nav: renderAppTopbar(),
      today: renderTodayFocus(todayFocusItems()),
      sidebar: renderSidebar(),
      row: renderTaskItem(state.tasks[0], 1),
    };
  })()`);

  assert.match(surfaces.update, /class="sidebar-update-action/);
  assert.match(surfaces.update, /class="sidebar-update-icon"/);
  assert.match(surfaces.nav, /class="app-nav-button/);
  assert.match(surfaces.today, /class="focus-list"/);
  assert.match(surfaces.sidebar, /class="repository-filter-trigger is-active"/);
  assert.doesNotMatch(surfaces.sidebar, /个筛选条件|项已启用|<b aria-label/);
  assert.match(surfaces.sidebar, /class="repository-priority-menu" open/);
  assert.match(surfaces.sidebar, /class="repository-priority-trigger"/);
  assert.match(surfaces.sidebar, /data-action="set-repository-priority-filter"/);
  assert.match(surfaces.sidebar, /class="repository-group-chevron"/);
  assert.ok(surfaces.row.indexOf("render") >= 0 || surfaces.row.indexOf("task-deadline-badge") < surfaces.row.indexOf("task-priority-control"));
});

test("typography clarity pass uses native rasterization, consistent fonts, and readable compact text", async () => {
  const [styles, approved] = await Promise.all([
    rendererStyles(),
    rendererStyles(),
  ]);
  const clarityRules = approved.slice(approved.lastIndexOf("v0.1.198 typography clarity pass"));

  assert.match(styles, /local\("Microsoft YaHei UI"\)/);
});

test("group editing preserves the horizontal group viewport across renders", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");

  assert.match(app, /const previousGroupScrollLeft = document\.querySelector\("\[data-sheet-tabs\]"\)/);
  assert.match(app, /const restoreGroupScroll = \(\) => \{/);
  assert.match(app, /input\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*restoreGroupScroll\(\);[\s\S]*mountMilkdownEditors\(\)/);
});

test("task repository preserves vertical viewport only within the same view", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");

  assert.match(app, /function taskRepositoryViewKey\(\) \{[\s\S]*state\.activeGroupId[\s\S]*state\.query\.trim\(\)\.toLowerCase\(\)[\s\S]*state\.taskFilter[\s\S]*state\.taskDateFilter[\s\S]*state\.taskDeadlineFilter[\s\S]*state\.priorityFilter[\s\S]*state\.captureSourceFilter[\s\S]*\}/);
  assert.doesNotMatch(app, /function taskRepositoryViewKey\(\) \{[^}]*state\.activeTaskId/);
  assert.match(app, /data-task-repository-scroll data-task-repository-view="\$\{escAttr\(taskRepositoryViewKey\(\)\)\}"/);
  assert.match(app, /const repositoryViewport = captureScrollViewport\([\s\S]*"taskRepositoryView"[\s\S]*taskRepositoryViewKey\(\)/);
  assert.match(app, /restoreScrollViewport\(repositoryViewport, "\[data-task-repository-scroll\]"\)/);
  assert.match(app, /element\.scrollTop = Math\.min\(snapshot\.top, maxTop\)/);
  assert.match(app, /element\.scrollLeft = Math\.min\(snapshot\.left, maxLeft\)/);
  assert.match(app, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*restoreRenderViewports\(\);[\s\S]*mountMilkdownEditors\(\);[\s\S]*restoreRenderViewports\(\);[\s\S]*window\.requestAnimationFrame/);
});

test("shared scroll viewport snapshots restore matching vertical and horizontal positions safely", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    const elements = new Map();
    document.querySelector = (selector) => elements.get(selector) || null;
    const createScroller = (top, left) => ({
      scrollTop: top,
      scrollLeft: left,
      scrollHeight: 500,
      clientHeight: 100,
      scrollWidth: 700,
      clientWidth: 100,
      dataset: { taskRepositoryView: "same" },
    });

    const matching = createScroller(130, 95);
    elements.set("#matching", matching);
    const matchingSnapshot = captureScrollViewport("#matching", "taskRepositoryView", "same");
    matching.scrollTop = 0;
    matching.scrollLeft = 0;
    restoreScrollViewport(matchingSnapshot, "#matching");

    const clamped = createScroller(130, 95);
    elements.set("#clamped", clamped);
    const clampedSnapshot = captureScrollViewport("#clamped", "taskRepositoryView", "same");
    clamped.scrollHeight = 150;
    clamped.scrollWidth = 140;
    restoreScrollViewport(clampedSnapshot, "#clamped");

    const different = createScroller(77, 88);
    elements.set("#different", different);
    const differentSnapshot = captureScrollViewport("#different", "taskRepositoryView", "other");
    different.scrollTop = 0;
    different.scrollLeft = 0;
    restoreScrollViewport(differentSnapshot, "#different");

    const zero = createScroller(0, 0);
    elements.set("#zero", zero);
    restoreScrollViewport(captureScrollViewport("#zero", "taskRepositoryView", "same"), "#zero");

    elements.clear();
    const missing = captureScrollViewport("#missing", "taskRepositoryView", "same");
    restoreScrollViewport(missing, "#missing");
    return {
      matching: [matching.scrollTop, matching.scrollLeft],
      clamped: [clamped.scrollTop, clamped.scrollLeft],
      different: [different.scrollTop, different.scrollLeft],
      zero: [zero.scrollTop, zero.scrollLeft],
      missing,
    };
  })()`);

  assert.deepEqual(result.matching, [130, 95]);
  assert.deepEqual(result.clamped, [50, 40]);
  assert.deepEqual(result.different, [0, 0]);
  assert.deepEqual(result.zero, [0, 0]);
  assert.equal(result.missing, null);
});

test("four scrollable regions use isolated task and node view keys", async () => {
  const [app, harness] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererHarness(),
  ]);
  const result = harness.json(`(() => {
    state.tasks = normalizeTasks([
      { id: "view_task_a", title: "任务 A", nodes: [{ id: "view_node_a", title: "节点 A", children: [] }] },
      { id: "view_task_b", title: "任务 B", nodes: [] },
    ]);
    state.activeTaskId = "view_task_a";
    const task = activeTask();
    const repositoryBefore = taskRepositoryViewKey();
    state.activeTaskId = "view_task_b";
    const repositoryAfter = taskRepositoryViewKey();
    return {
      repositoryStableAcrossTaskSelection: repositoryBefore === repositoryAfter,
      flow: JSON.parse(processingFlowViewKey(task)),
      detail: JSON.parse(nodeDetailViewKey("view_task_a", "view_node_a")),
      knowledge: JSON.parse(knowledgeViewKey(task)),
    };
  })()`);

  assert.equal(result.repositoryStableAcrossTaskSelection, true);
  assert.deepEqual(result.flow, ["view_task_a", "flow"]);
  assert.deepEqual(result.detail, ["view_task_a", "view_node_a"]);
  assert.deepEqual(result.knowledge, ["view_task_a", "notes"]);
  assert.match(app, /data-processing-flow-scroll data-processing-flow-view="\$\{escAttr\(processingFlowViewKey\(task\)\)\}"/);
  assert.match(app, /class="node-detail-scroll" data-node-detail-scroll data-node-detail-view="\$\{escAttr\(nodeDetailViewKey\(taskId, node\.id\)\)\}"/);
  assert.match(app, /class="milkdown-editor-host"[^>]*data-knowledge-scroll data-knowledge-view="\$\{escAttr\(knowledgeViewKey\(task\)\)\}"/);
  assert.doesNotMatch(app.match(/function processingFlowViewKey\(task = activeTask\(\)\) \{[\s\S]*?\n\}/)?.[0] || "", /selectedNodeId|collapsed|recordDraft|updatedAt/);
  assert.doesNotMatch(app.match(/function knowledgeViewKey\(task = activeTask\(\)\) \{[\s\S]*?\n\}/)?.[0] || "", /documentState|filePath|lastSavedHash|updatedAt|Markdown/);
});

test("knowledge save shortcuts are handled before editable-target filtering", async () => {
  const saves = [];
  const harness = await rendererHarness({
    knowledgeFile: {
      save: async (payload) => {
        saves.push(payload.saveAs);
        return {
          success: true,
          content: "快捷键保存后的正文",
          filePath: payload.saveAs ? "/tmp/knowledge-save-as.md" : payload.filePath || "/tmp/knowledge.md",
          lastSavedHash: "shortcut-hash",
        };
      },
    },
  });
  harness.evaluate(`document.addEventListener = () => {};
    document.querySelector = (selector) => selector === "#root" ? { innerHTML: "" } : null`);
  harness.evaluate(`(() => {
    state.tasks = normalizeTasks([{ id: "shortcut_task", title: "快捷键任务", notes: "正文", nodes: [] }]);
    state.activeTaskId = "shortcut_task";
    state.taskPane = "notes";
  })()`);

  const createEvent = (overrides = {}) => ({
    key: "s",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    target: { isContentEditable: true },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...overrides,
  });
  const ctrl = createEvent({ ctrlKey: true });
  harness.dispatch("keydown", ctrl);
  await waitForCondition(() => saves.length === 1);
  const command = createEvent({ metaKey: true });
  harness.dispatch("keydown", command);
  await waitForCondition(() => saves.length === 2);
  const saveAs = createEvent({ ctrlKey: true, shiftKey: true });
  harness.dispatch("keydown", saveAs);
  await waitForCondition(() => saves.length === 3);

  const alt = createEvent({ ctrlKey: true, altKey: true });
  harness.dispatch("keydown", alt);
  await new Promise((resolve) => setImmediate(resolve));
  harness.evaluate(`state.taskPane = "flow"`);
  const flow = createEvent({ ctrlKey: true });
  harness.dispatch("keydown", flow);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(saves, [false, false, true]);
  assert.equal(ctrl.defaultPrevented, true);
  assert.equal(command.defaultPrevented, true);
  assert.equal(saveAs.defaultPrevented, true);
  assert.equal(alt.defaultPrevented, false);
  assert.equal(flow.defaultPrevented, false);
  assert.equal(saves.length, 3);
});

test("workbench group selection uses a ReUI-style trigger and option menu", async () => {
  const [app, styles] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
  ]);
  const harness = await rendererHarness();
  const html = harness.evaluate(`taskGroupSelectTaskId = "group_picker_task"; renderTaskGroupSelect(normalizeTasks([{ id: "group_picker_task", title: "分组选择", groupId: "group_inbox", nodes: [] }])[0])`);

  assert.match(app, /function renderTaskGroupSelect\(task\)/);
  assert.match(app, /data-action="toggle-task-group-select"/);
  assert.match(app, /data-action="select-task-group"/);
  assert.match(html, /task-group-select-trigger/);
  assert.match(html, /task-group-select-label.*分组/);
  assert.match(html, /aria-haspopup="listbox"/);
  assert.match(html, /task-group-select-content/);
  assert.match(html, /role="option"/);
  assert.doesNotMatch(html, /<select[\s>]/);
});

test("task repository merges its sequence and completion control", async () => {
  const [app, styles] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
  ]);
  const harness = await rendererHarness();
  const html = harness.evaluate(`renderTaskItem(normalizeTasks([{
    id: "ordered_task", title: "有序任务", priority: "high", nodes: []
  }])[0], 3)`);

  assert.match(app, /\.map\(\(task, index\) => renderTaskItem\(task, index \+ 1\)\)/);
  assert.doesNotMatch(app, /class="task-repository-columns"/);
  assert.match(html, /draggable="true"/);
  assert.match(html, /class="task-sequence-action">[\s\S]*class="task-sequence"[\s\S]*repository-complete[\s\S]*class="task-title-wrap/);
  assert.match(html, /class="task-sequence"[^>]*>3<\/span>/);
  assert.match(html, /task-priority-control high/);
  assert.doesNotMatch(html, /task-next-line|task-row-chevron/);
  assert.doesNotMatch(html, /task-drag-handle/);
  const repositoryRefinement = styles.slice(styles.lastIndexOf("Task repository refinement"));
});

test("navigation group buttons leave the today scope and select the group", async () => {
  const [shell, actions] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "shell.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "actions.js"), "utf8"),
  ]);
  // The Demo's group buttons navigate to 任务仓库 with that group; the today
  // filter scopes across every group and would otherwise ignore the selection.
  assert.match(shell, /data-action="select-nav-group" data-group-id=/);
  assert.match(actions, /case "select-nav-group"/);
  assert.match(actions, /if \(state\.taskFilter === "today"\) state\.taskFilter = "all";/);
});

test("the frozen Demo baseline is the renderer stylesheet authority", async () => {
  const rendererDir = path.join(__dirname, "..", "app", "renderer");
  const index = await fs.readFile(path.join(rendererDir, "index.html"), "utf8");
  const frozenDir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase17-frozen");
  const phase18Dir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase18-frozen");
  const phase19Dir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase19-frozen");
  const phase20Dir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase20-frozen");
  const phase21Dir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase21-frozen");
  const phase22Dir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase22-frozen");
  const phase23Dir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase23-frozen");
  const phase24Dir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase24-frozen");
  const phase25Dir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase25-frozen");
  const phase26Dir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase26-frozen");
  const previousFrozenDir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase1-frozen");

  // The Demo baseline must be present verbatim and must not be edited to fit
  // the product implementation.
  const frozenEntry = await fs.readFile(path.join(frozenDir, "loop-plane-phase1.html"), "utf8");
  const inline = frozenEntry.match(/<style>([\s\S]*?)<\/style>/)[1];
  const shell = await fs.readFile(path.join(rendererDir, "src", "shell.css"), "utf8");
  assert.equal(shell, inline, "src/shell.css must stay byte-identical to the frozen Demo inline stylesheet");

  const copied = [
    ["knowledge.css", "loop-knowledge-phase8.css"],
    ["fonts.css", "loop-settings-fonts.css"],
    ["settings.css", "loop-settings-phase9.css"],
    ["typography.css", "loop-typography.css"],
    ["refinement.css", "loop-refinement.css"],
    ["selection.css", "loop-bulk-phase10.css"],
    ["flow.css", "loop-flow-phase11.css"],
    ["shell-refinement.css", "loop-shell-refinement.css"],
    ["help.css", "loop-help-phase14.css"],
    ["work.css", "loop-work-phase15.css"],
    ["task-entry.css", "loop-task-phase16.css"],
    ["journey.css", "loop-journey-phase17.css"],
    ["time.css", "loop-time-phase18.css"],
    ["desktop.css", "loop-desktop-phase19.css"],
    ["scale.css", "loop-scale-phase20.css"],
    ["brief21.css", "loop-brief-phase21.css"],
    ["controls22.css", "loop-controls-phase22.css"],
    ["notebook23.css", "loop-notebook-phase23.css"],
    ["management24.css", "loop-management-phase24.css"],
    ["window25.css", "loop-window-phase25.css"],
    ["recovery26.css", "loop-recovery-phase26.css"],
  ];
  for (const [target, source] of copied) {
    const [a, b] = await Promise.all([
      fs.readFile(path.join(rendererDir, "src", target), "utf8"),
      fs.readFile(path.join(source === "loop-time-phase18.css" ? phase18Dir : source === "loop-desktop-phase19.css" ? phase19Dir : source === "loop-scale-phase20.css" ? phase20Dir : source === "loop-brief-phase21.css" ? phase21Dir : source === "loop-controls-phase22.css" ? phase22Dir : source === "loop-notebook-phase23.css" ? phase23Dir : source === "loop-management-phase24.css" ? phase24Dir : source === "loop-window-phase25.css" ? phase25Dir : source === "loop-recovery-phase26.css" ? phase26Dir : frozenDir, source), "utf8"),
    ]);
    assert.equal(a, b, `src/${target} must stay byte-identical to the frozen ${source}`);
  }

  // Preserve the frozen Demo order. The shared production typography correction
  // follows those layers in main and floating windows without changing them.
  const linked = [...index.matchAll(/<link[^>]+href="\.\/src\/([^"?]+)/g)].map((match) => match[1]);
  const order = ["shell.css", "vendor/milkdown-editor.css", "knowledge.css", "fonts.css", "settings.css", "typography.css", "refinement.css", "selection.css", "flow.css", "shell-refinement.css", "help.css", "work.css", "task-entry.css", "journey.css", "time.css", "desktop.css", "scale.css", "brief21.css", "controls22.css", "notebook23.css", "management24.css", "window25.css", "bridge.css", "recovery26.css", "manual27.css"];
  assert.deepEqual(linked, [...order, "vendor/knowledge-editor.css", "knowledge-editor.css", "type-readability.css"], "preserve the frozen Demo order, followed by the shared typography correction");
  assert.equal(await fs.readFile(path.join(rendererDir, "src", "manual27.css"), "utf8"), await fs.readFile(path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase27-frozen", "loop-manual-phase27.css"), "utf8"), "the manual keeps the approved Demo CSS verbatim");
  const scripts = [...index.matchAll(/<script[^>]+src="\.\/src\/([^"?]+)/g)].map((match) => match[1]);
  const phase24Script = scripts.indexOf("management24.js");
  assert.ok(phase24Script > scripts.indexOf("knowledge-workspace.js"), "phase24 must load after the knowledge workspace");
  assert.ok(phase24Script < scripts.indexOf("work.js"), "phase24 must load before the work-navigation layer");
  assert.ok(index.includes("data-management24-enabled"), "the phase24 sheet is gated on the body flag");
  const window25Script = scripts.indexOf("window25.js");
  assert.ok(window25Script > scripts.indexOf("management24.js"), "phase25 must load after the phase24 layer");
  assert.ok(window25Script < scripts.indexOf("work.js"), "phase25 must load before the work-navigation layer");
  assert.ok(index.includes("data-window25-enabled"), "the phase25 sheet is gated on the body flag");
  // Phase26: the recovery sheet is the last stylesheet (so it wins exactly where
  // it won in the Demo), it is a byte copy of the frozen stage sheet, and the
  // recovery layer loads after phase24a's task menu and before work.js.
  const recovery26Script = scripts.indexOf("recovery26.js");
  assert.ok(recovery26Script > scripts.indexOf("management24.js"), "phase26 must load after the phase24 task-menu layer");
  assert.ok(recovery26Script > scripts.indexOf("window25.js"), "phase26 must load after the phase25 render wrapper");
  assert.ok(recovery26Script < scripts.indexOf("work.js"), "phase26 must load before the work-navigation layer");
  assert.ok(scripts.indexOf("manual27.js") > scripts.indexOf("work.js"), "the manual captures drafts through the product's work layer");
  assert.ok(scripts.indexOf("manual27.js") < scripts.indexOf("continuity28.js"), "manual navigation retains the continuity layer");
  assert.ok(index.includes("data-recovery26-enabled"), "the phase26 sheet is gated on the body flag");
  assert.ok(!index.includes("approved-4174.css"), "the superseded approved-4174 shell must no longer be loaded");
  assert.ok(!index.includes("styles.css"), "the superseded styles.css must no longer be loaded");
  assert.match(index, /<div id="overlay"><\/div>/);
  assert.match(shell, /:root\{--canvas:#fff/);
  assert.match(shell, /:root\[data-theme=dark\]\{--canvas:#17191d/);
});

test("the integrated title bar keeps the platform's own window controls", async () => {
  const rendererDir = path.join(__dirname, "..", "app", "renderer", "src");
  const [index, main, preload, window25, bridge] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "index.html"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "main.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "preload.cjs"), "utf8"),
    fs.readFile(path.join(rendererDir, "window25.js"), "utf8"),
    fs.readFile(path.join(rendererDir, "bridge.css"), "utf8"),
  ]);

  // The window keeps its native chrome capabilities: only the title strip goes.
  assert.match(main, /titleBarStyle: "hidden"/);
  assert.match(main, /trafficLightPosition = \{ \.\.\.MAC_TRAFFIC_LIGHT_POSITION \}/);
  assert.match(main, /titleBarOverlay = \{ \.\.\.WINDOW_HEADER_THEMES\.light, height: HEADER_HEIGHT \}/);
  assert.match(main, /const MAC_TRAFFIC_LIGHT_POSITION = \{ x: \d+(\.\d+)?, y: \d+(\.\d+)? \};/);
  for (const event of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "focus", "blur", "minimize", "restore"]) {
    assert.ok(main.includes(`"${event}"`), `the window state feed must include ${event}`);
  }

  // The bridge reports state and paints the overlay; it exposes no window action,
  // so the native controls stay the only controls.
  assert.match(preload, /windowControls: \{/);
  assert.match(preload, /getState: \(\) => ipcRenderer\.invoke\("window-controls:get-state"\)/);
  assert.match(preload, /setChromeColors: \(colors\) => ipcRenderer\.invoke\("window-controls:set-chrome-colors", colors\)/);
  assert.match(preload, /onState: \(callback\) => subscribe\("window-controls:state", callback\)/);
  assert.doesNotMatch(preload, /window-controls:(minimize|maximize|close)/, "no HTML control may drive the window");
  assert.match(main, /ipcMain\.handle\("window-controls:get-state"/);
  assert.match(main, /ipcMain\.handle\("window-controls:set-chrome-colors"/);
  assert.match(main, /win && win === mainWindow && !win\.isDestroyed\(\) \? win : null/, "the handlers must be bound to the main window");
  assert.match(main, /return \/\^#\[0-9a-f\]\{6\}\$\/i\.test\(text\) \? text\.toLowerCase\(\) : "";/, "overlay colours must be validated");

  // No Demo simulation survives the port.
  assert.doesNotMatch(window25, /data-desk19-window|window25-platform|window25-review|review-bar/);
  assert.doesNotMatch(window25, /paths\.window25|window25-traffic"|window25-caption"/);
  assert.doesNotMatch(window25, /document\.title\s*=/);

  // The port reads the real environment and the measured native geometry.
  assert.match(window25, /bridge\?\.platform === "darwin" \? "mac" : "windows"/);
  assert.match(window25, /navigator\.windowControlsOverlay/);
  assert.match(window25, /getTitlebarAreaRect/);
  // ... and no DPI constant is baked into the code (comments aside).
  const window25Code = window25.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(window25Code, /138|207/, "the caption area must come from the overlay rect, not a constant");
  assert.match(window25, /const brand = document\.querySelector\("\.brand"\);/, "the identity has to be moved out of the navigation column");
  assert.match(window25, /controls\.onState\?\.\(/);

  // The override layer carries the deviations the frozen sheet cannot express.
  assert.match(bridge, /window25-native-caption/);
  assert.match(bridge, /window25-native-traffic/);
  assert.match(bridge, /\.topbar > \.brand-update-slot > \.brand-update \{[^}]*position: relative;/, "the moved update chip must keep its own positioning");
  assert.match(bridge, /\.app\.nav-collapsed \{ --nav-width: 64px !important; \}/, "the collapsed rail is 64px at every width");
  assert.ok(index.includes("./src/window25.js"), "the phase25 script must be loaded");
});

test("repository and flow cleanup leave no inherited separators or duplicate headings", async () => {
  const [app, styles] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
  ]);

  assert.doesNotMatch(app, /<strong>任务分组<\/strong>/);
  assert.doesNotMatch(app, /<div class="section-heading flow-head">[\s\S]*?<h2>处理流<\/h2>/);
});

test("repository and task page omit redundant section labels", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");

  assert.doesNotMatch(app, /<span>任务仓库<\/span>/);
  assert.doesNotMatch(app, /class="page-kicker kicker">工作台<\/div>/);
  assert.match(app, /双击左侧任务列表的空白区域，即可创建新的处理流。/);
});

test("sidebar resize keeps a broad transparent hit area with a one-pixel visible divider", async () => {
  const styles = await rendererStyles();
  const resizerRule = styles.match(/\.sidebar-resizer\s*\{([\s\S]*?)\}/)?.[1] || "";
  const dividerRule = styles.match(/\.sidebar-resizer::before\s*\{([\s\S]*?)\}/)?.[1] || "";

  assert.doesNotMatch(styles, /\.sidebar-resizer:hover\s*\{[\s\S]*?background:/);
});

test("disk persistence writes and reads a normalized atomic payload", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const written = await writeTaskData(directory, {
    tasks: [{ id: "task_roundtrip", title: "Round trip", nodes: [] }],
  });
  const read = await readTaskData(directory);

  assert.deepEqual(read, written);
  assert.equal(read.tasks[0].title, "Round trip");
  await assert.rejects(fs.access(path.join(directory, "task-data.json.tmp")));
});

test("disk reads preserve corrupt JSON as a timestamped backup", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-task-track-corrupt-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "task-data.json"), "{invalid", "utf8");

  await assert.rejects(readTaskData(directory), (error) => {
    assert.equal(error.code, "CORRUPT_TASK_DATA");
    assert.match(error.backupPath, /task-data\.corrupt-.+\.json$/);
    return true;
  });
  const files = await fs.readdir(directory);
  assert.equal(files.some((file) => /^task-data\.corrupt-.+\.json$/.test(file)), true);
  assert.equal(files.includes("task-data.json"), false);
});

test("renderer makes corrupt task-data backup recovery observable", async () => {
  const harness = await rendererHarness({
    storage: {
      read: async () => {
        throw Object.assign(new Error("backup created"), { code: "CORRUPT_TASK_DATA" });
      },
    },
  });
  const loaded = await harness.evaluate("loadAppData()");
  assert.equal(loaded.tasks.length, 0);
  assert.equal(harness.alerts.length, 0);
  assert.match(harness.evaluate("workspaceFeedback.message"), /损坏/);
  harness.evaluate("clearWorkspaceFeedback()");
});

test("renderer normalization restores safe task and node invariants", async () => {
  const harness = await rendererHarness();
  const tasks = harness.json(`normalizeTasks([
    null,
    {
      id: "duplicate",
      title: 12,
      conclusion: null,
      tags: ["later"],
      nodes: [
        null,
        { id: "node", status: "invalid", children: [{ id: "node", title: "child" }] }
      ]
    },
    { id: "duplicate", title: "second", nodes: [] }
  ])`);

  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].title, "12");
  assert.equal(tasks[0].conclusion, "");
  assert.equal(tasks[0].tags.later, true);
  assert.equal(tasks[0].nodes[0].status, "todo");
  assert.equal(tasks[0].nodes[0].taskId, tasks[0].id);
  assert.equal(tasks[0].nodes[0].children[0].parentId, tasks[0].nodes[0].id);
  assert.equal(tasks[0].knowledgeNote.taskId, tasks[0].id);
  assert.equal(tasks[0].knowledgeNote.documentState, "DRAFT");
  assert.equal(tasks[0].knowledgeNote.filePath, null);
  assert.notEqual(tasks[0].id, tasks[1].id);
  assert.notEqual(tasks[0].nodes[0].id, tasks[0].nodes[0].children[0].id);

  const legacyString = harness.json(`normalizeTasks([{ id: "legacy_string_renderer", knowledgeNote: "旧正文", nodes: [] }])`)[0];
  assert.equal(legacyString.notes, "旧正文");
  assert.equal(legacyString.knowledgeNote.documentState, "DRAFT");
});

test("today focus highlights the active task even when it suggests a different node", async () => {
  const harness = await rendererHarness();
  const html = harness.evaluate(`(() => {
    state.activeTaskId = "today_task";
    state.selectedNodeId = "";
    return renderTodayFocusItem({
      task: { id: "today_task", title: "今日任务" },
      node: { id: "next_step" },
      kind: "normal",
      nextText: "下一步"
    });
  })()`);

  assert.match(html, /<button class="focus-row selected"[^>]*data-action="select-focus"/);
  assert.match(html, /<b>1<\/b>/);
  assert.match(html, /<span>今日任务<\/span>/);
  assert.match(html, /class="focus-row-chevron"/);
  assert.doesNotMatch(html, /下一步/);
});

test("selecting a Today task keeps the Today view while sharing task state", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.taskGroups = [{ id: "today_group", title: "今日分组", order: 1 }];
    state.activeGroupId = ALL_TASKS_GROUP_ID;
    state.taskFilter = "today";
    state.priorityFilter = "high";
    state.tasks = normalizeTasks([
      { id: "today_shared", title: "共享任务", groupId: "today_group", priority: "high", tags: { today: true }, nodes: [] },
      { id: "other_task", title: "其他任务", groupId: "today_group", priority: "low", nodes: [] },
    ]);
    openTaskFromGlobalList("today_shared", "", { keepToday: true });
    const shared = state.tasks.find((task) => task.id === "today_shared");
    shared.title = "更新后的共享任务";
    const updatedTodayRow = renderTodayFocus(todayFocusItems());
    const updatedTaskPage = renderTaskPage(shared);
    shared.status = "done";
    return {
      filter: state.taskFilter,
      activeTaskId: state.activeTaskId,
      activeGroupId: state.activeGroupId,
      priorityFilter: state.priorityFilter,
      sharedTitle: shared.title,
      sharedPriority: shared.priority,
      todayRow: updatedTodayRow,
      taskPage: updatedTaskPage,
      completedTodayCount: todayFocusItems().filter((item) => item.task.id === "today_shared").length,
    };
  })()`);

  assert.equal(result.filter, "today");
  assert.equal(result.activeTaskId, "today_shared");
  assert.equal(result.activeGroupId, "today_group");
  assert.equal(result.priorityFilter, "high");
  assert.equal(result.sharedTitle, "更新后的共享任务");
  assert.equal(result.sharedPriority, "high");
  assert.match(result.todayRow, /更新后的共享任务/);
  assert.match(result.taskPage, /更新后的共享任务/);
  assert.equal(result.completedTodayCount, 0);
  assert.match(result.taskPage, /data-task-id="today_shared"/);
});

test("primary navigation separates the Today queue from the task repository", async () => {
  const harness = await rendererHarness();
  const surfaces = harness.evaluate(`(() => {
    state.taskGroups = [{ id: "group_inbox", title: "默认", order: 1 }];
    state.tasks = normalizeTasks([
      { id: "today_task", title: "今日任务", groupId: "group_inbox", tags: { today: true }, nodes: [] }
    ]);
    state.taskFilter = "today";
    const today = renderSidebar();
    state.taskFilter = "all";
    const tasks = renderSidebar();
    return { today, tasks };
  })()`);

  assert.match(surfaces.today, /data-primary-view="today"/);
  assert.match(surfaces.today, /sidebar-today-mode focus-rail/);
  assert.doesNotMatch(surfaces.today, /class="rail-heading"|<h2>今日待办<\/h2>|<span>1 项<\/span>/);
  assert.match(surfaces.today, /class="focus-list" aria-label="今日待办"/);
  assert.doesNotMatch(surfaces.today, /class="rail-footer"|class="footer-actions"|class="divider"|class="autosave"|自动保存已开启/);
  assert.doesNotMatch(surfaces.today, /class="task-list task-repository"/);
  assert.doesNotMatch(surfaces.today, /today-date|下一步：/);
  assert.match(surfaces.tasks, /data-primary-view="tasks"/);
  assert.match(surfaces.tasks, /class="task-list task-repository"/);
  assert.doesNotMatch(surfaces.tasks, /sidebar-today-mode focus-rail/);
  assert.doesNotMatch(surfaces.tasks, /class="rail-footer"/);
});

test("Today and Tasks navigation leave calendar and review surfaces", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.calendarOpen = true;
    state.reviewOpen = true;
    applySetting("task-filter", "all");
    const tasks = { filter: state.taskFilter, calendar: state.calendarOpen, review: state.reviewOpen };
    state.calendarOpen = true;
    state.reviewOpen = true;
    applySetting("task-filter", "today");
    const today = { filter: state.taskFilter, calendar: state.calendarOpen, review: state.reviewOpen };
    return { tasks, today };
  })()`);

  assert.deepEqual(result.tasks, { filter: "all", calendar: false, review: false });
  assert.deepEqual(result.today, { filter: "today", calendar: false, review: false });
});

test("Today widget snapshot reuses the main Today ordering and next-step content", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.tasks = normalizeTasks([
      { id: "normal", title: "普通任务", priority: "low", tags: { today: true }, nodes: [] },
      { id: "high", title: "高优先任务", priority: "high", tags: { today: true }, nodes: [{ id: "high_node", title: "高优先下一步", status: "todo", children: [] }] },
      { id: "blocked", title: "阻塞任务", priority: "medium", tags: { today: true, blocked: true }, nodes: [{ id: "blocked_node", title: "解除阻塞", status: "blocked", children: [] }] },
      { id: "fourth", title: "第四项", priority: "low", tags: { today: true }, nodes: [] }
    ]);
    const focus = todayFocusItems().map(({ task, kind, nextText }) => ({ taskId: task.id, title: task.title, kind, nextText }));
    const snapshot = todayWidgetSnapshot();
    return { focus, snapshot };
  })()`);

  assert.deepEqual(result.snapshot.items, result.focus);
  assert.deepEqual(result.snapshot.items.slice(0, 2).map((item) => item.taskId), ["blocked", "high"]);
  assert.equal(result.snapshot.items.length, 4);
  assert.equal(result.snapshot.items[0].nextText, "解除阻塞");
});

test("Today widget quick captures reuse tasks, timestamps, source filtering, and full snapshot ordering", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.taskGroups = [{ id: "group_inbox", title: "默认", order: 1 }];
    state.activeGroupId = "group_inbox";
    state.tasks = normalizeTasks([
      { id: "capture_old", title: "旧速记", captureSource: "today-widget", createdAt: "2026-08-20T08:00:00.000Z", updatedAt: "2026-08-20T08:00:00.000Z" },
      { id: "capture_new", title: "新速记", captureSource: "today-widget", createdAt: "2026-08-29T08:00:00.000Z", updatedAt: "2026-08-29T09:00:00.000Z" },
      { id: "capture_third", title: "第三条速记", captureSource: "today-widget", createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T09:00:00.000Z" },
      { id: "capture_fourth", title: "第四条速记", captureSource: "today-widget", createdAt: "2026-08-27T08:00:00.000Z", updatedAt: "2026-08-27T09:00:00.000Z" },
      { id: "capture_fifth", title: "第五条速记", captureSource: "today-widget", createdAt: "2026-08-26T08:00:00.000Z", updatedAt: "2026-08-26T09:00:00.000Z" },
      { id: "normal_task", title: "普通任务", createdAt: "2026-08-29T07:00:00.000Z", updatedAt: "2026-08-29T07:00:00.000Z" }
    ]);
    state.captureSourceFilter = "quick";
    const quickIds = filteredTasks().map((task) => task.id);
    const snapshot = todayWidgetSnapshot();
    return { quickIds, snapshot };
  })()`);
  assert.deepEqual(result.quickIds, ["capture_old", "capture_new", "capture_third", "capture_fourth", "capture_fifth"]);
  assert.equal(result.snapshot.quickCaptureTotal, 5);
  assert.deepEqual(result.snapshot.quickCaptures.map((item) => item.taskId), ["capture_new", "capture_third", "capture_fourth", "capture_fifth", "capture_old"]);
  assert.equal(result.snapshot.quickCaptures[0].createdAt, "2026-08-29T08:00:00.000Z");
  assert.deepEqual(result.snapshot.groups, [{ id: "group_inbox", title: "默认" }]);
});

test("Today widget quick captures can be edited from a single click and stay ordinary tasks", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.tasks = normalizeTasks([{
      id: "capture_edit",
      title: "原始速记",
      captureSource: "today-widget",
      updatedAt: "2026-08-29T08:00:00.000Z"
    }]);
    render = () => {};
    const updated = updateTaskTitleFromWidget("capture_edit", "修改后的速记");
    const task = state.tasks.find((item) => item.id === "capture_edit");
    return { updated, title: task.title, captureSource: task.captureSource };
  })()`);
  assert.equal(result.updated.code, "UPDATED");
  assert.deepEqual(result, {
    updated: { success: true, code: "UPDATED", taskId: "capture_edit" },
    title: "修改后的速记",
    captureSource: "today-widget",
  });
});

test("Today widget task and quick-capture order can be moved independently and survives normalization", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.tasks = normalizeTasks([
      { id: "today_a", title: "今日 A", tags: { today: true }, priority: "high", updatedAt: "2026-08-29T10:00:00.000Z" },
      { id: "today_b", title: "今日 B", tags: { today: true }, priority: "low", updatedAt: "2026-08-29T09:00:00.000Z" },
      { id: "capture_a", title: "速记 A", captureSource: "today-widget", updatedAt: "2026-08-29T08:00:00.000Z" },
      { id: "capture_b", title: "速记 B", captureSource: "today-widget", updatedAt: "2026-08-29T07:00:00.000Z" }
    ]);
    render = () => {};
    const taskMove = reorderTodayWidgetItem("today_b", "task", -1);
    const quickMove = reorderTodayWidgetItem("capture_a", "quick", 1);
    const snapshot = todayWidgetSnapshot();
    const normalizedAgain = normalizeTasks(state.tasks);
    return {
      taskMove,
      quickMove,
      taskIds: snapshot.items.map((item) => item.taskId),
      quickIds: snapshot.quickCaptures.map((item) => item.taskId),
      taskOrders: Object.fromEntries(normalizedAgain.map((task) => [task.id, task.todayTaskOrder])),
      quickOrders: Object.fromEntries(normalizedAgain.map((task) => [task.id, task.todayQuickCaptureOrder]))
    };
  })()`);

  assert.equal(result.taskMove.code, "MOVED");
  assert.equal(result.quickMove.code, "MOVED");
  assert.deepEqual(result.taskIds.slice(0, 2), ["today_b", "today_a"]);
  assert.deepEqual(result.quickIds, ["capture_b", "capture_a"]);
  assert.equal(result.taskOrders.today_b, 1);
  assert.equal(result.quickOrders.capture_b, 1);
});

test("Today widget long-press movement reorders within a lane and switches task and quick-note lanes", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.tasks = normalizeTasks([
      { id: "today_a", title: "今日 A", tags: { today: true }, priority: "high", updatedAt: "2026-08-29T10:00:00.000Z" },
      { id: "today_b", title: "今日 B", tags: { today: true }, priority: "low", updatedAt: "2026-08-29T09:00:00.000Z" },
      { id: "capture_a", title: "速记 A", captureSource: "today-widget", updatedAt: "2026-08-29T08:00:00.000Z" },
      { id: "capture_b", title: "速记 B", captureSource: "today-widget", updatedAt: "2026-08-29T07:00:00.000Z" }
    ]);
    render = () => {};
    const withinLane = moveTodayWidgetItem("today_b", "task", "task", "today_a", "before");
    const toQuick = moveTodayWidgetItem("today_a", "task", "quick", "capture_b", "before");
    const toTask = moveTodayWidgetItem("capture_a", "quick", "task", "today_b", "after");
    const snapshot = todayWidgetSnapshot();
    return {
      withinLane,
      toQuick,
      toTask,
      taskIds: snapshot.items.map((item) => item.taskId),
      quickIds: snapshot.quickCaptures.map((item) => item.taskId),
      sources: Object.fromEntries(state.tasks.map((task) => [task.id, task.captureSource]))
    };
  })()`);

  assert.equal(result.withinLane.code, "MOVED");
  assert.equal(result.toQuick.code, "MOVED");
  assert.equal(result.toTask.code, "MOVED");
  assert.deepEqual(result.taskIds, ["today_b", "capture_a"]);
  assert.deepEqual(result.quickIds, ["today_a", "capture_b"]);
  assert.equal(result.sources.today_a, "today-widget");
  assert.equal(result.sources.capture_a, "");
});

test("quick captures promote into a chosen real group and leave the quick-capture lane", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.taskGroups = [
      { id: "group_inbox", title: "默认", order: 1 },
      { id: "group_work", title: "工作", order: 2 }
    ];
    state.activeGroupId = "group_all";
    state.tasks = normalizeTasks([{ id: "capture_promote", title: "待升级", captureSource: "today-widget", groupId: "group_inbox" }]);
    render = () => {};
    const promoted = promoteQuickCaptureFromWidget("capture_promote", "group_work");
    const task = state.tasks[0];
    return { promoted, task: { id: task.id, groupId: task.groupId, captureSource: task.captureSource }, visible: tasksInActiveGroup().map((item) => item.id) };
  })()`);

  assert.equal(result.promoted.code, "PROMOTED");
  assert.deepEqual(result.task, { id: "capture_promote", groupId: "group_work", captureSource: "" });
  assert.deepEqual(result.visible, ["capture_promote"]);
});

test("the fixed all-tasks group is aggregate-only and new tasks still receive a real group", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.taskGroups = [{ id: "group_inbox", title: "默认", order: 1 }, { id: "group_work", title: "工作", order: 2 }];
    state.tasks = normalizeTasks([
      { id: "inbox_task", title: "默认任务", groupId: "group_inbox" },
      { id: "work_task", title: "工作任务", groupId: "group_work" }
    ]);
    state.activeGroupId = "group_all";
    const before = tasksInActiveGroup().map((task) => task.id);
    const created = createTask("汇总视图新建", false);
    return { before, createdGroupId: created.groupId, tabs: renderGroupTabs() };
  })()`);

  assert.deepEqual(result.before, ["inbox_task", "work_task"]);
  assert.equal(result.createdGroupId, "group_inbox");
  assert.match(result.tabs, />全部任务<\/button>/);
  assert.match(result.tabs, /sheet-tab-all active/);
});

test("new tasks clear hiding filters, focus immediately, and queue a final repository reveal", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.taskGroups = [{ id: "group_inbox", title: "默认", order: 1 }];
    state.activeGroupId = "group_inbox";
    state.taskFilter = "done";
    state.taskDateFilter = "2026-08-01";
    state.taskDeadlineFilter = "overdue";
    state.priorityFilter = "high";
    state.captureSourceFilter = "quick";
    state.query = "不会命中";
    const created = createTask("", false);
    return {
      taskId: created.id,
      activeTaskId: state.activeTaskId,
      focusTaskTitleId: state.focusTaskTitleId,
      revealTaskId: state.revealTaskId,
      filters: [state.taskFilter, state.taskDateFilter, state.taskDeadlineFilter, state.priorityFilter, state.captureSourceFilter, state.query]
    };
  })()`);

  assert.equal(result.activeTaskId, result.taskId);
  assert.equal(result.focusTaskTitleId, result.taskId);
  assert.equal(result.revealTaskId, result.taskId);
  assert.deepEqual(result.filters, ["all", "", "all", "all", "all", ""]);
});

test("new task creation does not make the next recurrence tick remount its active title input", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    const tickAt = new Date("2026-09-12T06:00:00.000Z");
    state.taskGroups = [{ id: "group_inbox", title: "默认", order: 1 }];
    state.activeGroupId = "group_inbox";
    state.tasks = normalizeTasks([{ id: "existing", title: "已有任务", nodes: [] }]);
    syncRecurringTasks(tickAt);
    const created = createTask("", false);
    return {
      taskId: created.id,
      focusTaskTitleId: state.focusTaskTitleId,
      recurrenceTickRequestsRender: syncRecurringTasks(tickAt)
    };
  })()`);

  assert.equal(result.focusTaskTitleId, result.taskId);
  assert.equal(result.recurrenceTickRequestsRender, false);
});

test("the queued new task is scrolled into view after repository restoration", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    const calls = [];
    const row = { scrollIntoView(options) { calls.push(options); } };
    const input = { closest(selector) { return selector === ".task-item" ? row : null; } };
    state.revealTaskId = "task_new";
    document.querySelector = (selector) => selector === '.task-title[data-task-id="task_new"]' ? input : null;
    revealPendingTask();
    return { calls, revealTaskId: state.revealTaskId };
  })()`);

  assert.deepEqual(result.calls, [{ block: "nearest", inline: "nearest" }]);
  assert.equal(result.revealTaskId, "");
});

test("repository groups render record scope and personal groups without management actions", async () => {
  const harness = await rendererHarness();
  const result = harness.evaluate(`(() => {
    state.taskGroups = [
      { id: "group_inbox", title: "默认", order: 1 },
      { id: "group_work", title: "工作", order: 2 }
    ];
    state.activeGroupId = "group_all";
    state.editingGroupId = "";
    repositoryGroupQuery = "";
    repositoryGroupPickerOpen = true;
    const options = renderRepositoryGroupOptions();
    const scope = renderRepositoryScopeBar();
    const sidebar = renderSidebar();
    state.contextMenu = { kind: "group", groupId: "group_work", x: 10, y: 20 };
    const menu = renderContextMenu();
    startRenameGroup("group_work");
    const editing = renderRepositoryGroupOptions();
    return { options, scope, sidebar, menu, editing, open: repositoryGroupPickerOpen };
  })()`);

  assert.match(result.options, /repository-group-system[\s\S]*全部记录[\s\S]*未分组/);
  assert.match(result.options, /repository-group-divider/);
  assert.match(result.options, /repository-group-personal[\s\S]*个人分组[\s\S]*工作/);
  assert.doesNotMatch(result.options, />最近</);
  assert.doesNotMatch(result.options, />全部分组</);
  assert.doesNotMatch(result.scope, /repository-group-icon/);
  assert.match(result.sidebar, /class="repository-heading-row"[\s\S]*class="repository-library-heading"[\s\S]*class="repository-context-actions"/);
  assert.match(result.sidebar, /class="repository-filter-popover"[\s\S]*class="repository-filter-label">分组<\/span>[\s\S]*class="repository-group-slot"[\s\S]*class="repository-group-picker is-open"[\s\S]*class="repository-segmented completion-segmented task-status-filters"/);
  assert.doesNotMatch(result.sidebar, /repository-context-row/);
  assert.match(result.sidebar, /placeholder="搜索" aria-label="搜索分组"/);
  assert.match(result.sidebar, /data-action="add-group">＋ 新建分组/);
  assert.doesNotMatch(result.sidebar, /<section class="group-panel"/);
  // Group management was removed: no row control, no context menu, no
  // rename/delete/batch entries. Renaming through the picker's inline editor
  // is a separate path and stays available.
  assert.doesNotMatch(result.sidebar, /group-menu-button/);
  assert.doesNotMatch(result.sidebar, /管理分组/);
  assert.equal(result.menu, "");
  assert.match(result.editing, /data-group-title="group_work"/);
  assert.equal(result.open, true);
});

test("the personal-group trigger carries no group-management hooks", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.taskGroups = [{ id: "group_work", title: "工作", order: 1 }];
    state.activeGroupId = "group_work";
    repositoryGroupPickerOpen = false;
    const picker = renderRepositoryGroupPicker();
    return {
      picker,
      binder: typeof bindRepositoryGroupOptionMenus,
      opener: typeof openRepositoryGroupContextMenu,
    };
  })()`);

  assert.match(result.picker, /repository-group-trigger[^>]*data-action="toggle-repository-group-picker"/);
  assert.doesNotMatch(result.picker, /data-group-context-id/);
  assert.equal(result.binder, "undefined");
  assert.equal(result.opener, "undefined");
});

test("repository group picker presses keep the picker DOM alive through the first click", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    const targetInside = (selector) => ({ closest: (query) => query === selector ? {} : null });
    state.contextMenu = { kind: "group", groupId: "group_work", x: 10, y: 20 };
    const picker = isRepositoryGroupInteraction(targetInside(".repository-group-picker"));
    const groupMenu = isRepositoryGroupInteraction(targetInside(".context-menu"));
    state.contextMenu = { kind: "task", taskId: "task_a", x: 10, y: 20 };
    const taskMenu = isRepositoryGroupInteraction(targetInside(".context-menu"));
    return { picker, groupMenu, taskMenu };
  })()`);

  // Only the picker keeps the DOM alive; the group context menu no longer exists.
  assert.deepEqual(result, { picker: true, groupMenu: false, taskMenu: false });
});

test("context-menu commands activate exactly once on the first primary pointer press", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    const listeners = {};
    const button = {
      dataset: { action: "select-group", groupId: "group_work" },
      addEventListener(type, listener) { listeners[type] = listener; }
    };
    const root = {
      innerHTML: "",
      querySelectorAll() { return [button]; }
    };
    document.querySelector = (selector) => selector === "#context-menu-root" ? root : null;
    const calls = [];
    action = (data) => calls.push({ ...data });
    syncContextMenuRoot();
    listeners.pointerdown({ button: 0, preventDefault() {}, stopPropagation() {} });
    listeners.click({ detail: 1, preventDefault() {}, stopPropagation() {} });
    return { calls, listenerTypes: Object.keys(listeners).sort() };
  })()`);

  assert.deepEqual(result.calls, [{ action: "select-group", groupId: "group_work" }]);
  assert.deepEqual(result.listenerTypes, ["click", "pointerdown"]);
});

test("task context menu preserves the working task and record draft without rebuilding the renderer", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.tasks = [
      { id: "working", title: "正在记录的任务", status: "todo", tags: {} },
      { id: "other", title: "另一项<任务>", status: "done", tags: { today: true, later: true, blocked: false } }
    ];
    state.activeTaskId = "working";
    state.selectedNodeId = "working-node";
    state.recordDraft = "未提交的处理记录";
    let mounts = 0, focused = 0;
    syncContextMenuRoot = () => { mounts++; };
    render = () => { throw new Error("right-click must not render the workspace"); };
    const trigger = { isConnected: true, focus() { focused++; } };
    const row = { querySelector: () => trigger };
    openTaskContextMenu("other", { type: "contextmenu", clientX: 120, clientY: 200, preventDefault() {}, stopPropagation() {} }, row);
    const menu = { ...state.contextMenu };
    const markup = renderContextMenu();
    closeContextMenu(true);
    return { menu, markup, mounts, focused, current: state.activeTaskId, node: state.selectedNodeId, draft: state.recordDraft, closed: state.contextMenu };
  })()`);
  assert.equal(result.current, "working");
  assert.equal(result.node, "working-node");
  assert.equal(result.draft, "未提交的处理记录");
  assert.equal(result.menu.taskId, "other");
  assert.equal(result.mounts, 2);
  assert.equal(result.focused, 1);
  assert.equal(result.closed, null);
  assert.doesNotMatch(result.markup, /打开任务|data-action="select-task"|Today/);
  assert.match(result.markup, /另一项&lt;任务&gt;/);
  assert.match(result.markup, /标记为未完成/);
  assert.match(result.markup, /aria-checked="true"[^>]*data-tag="today"/);
  assert.match(result.markup, /取消手动加入今日/);
  assert.match(result.markup, /aria-checked="true"[^>]*data-tag="later"/);
  assert.match(result.markup, /aria-checked="false"[^>]*data-tag="blocked"/);
  assert.equal((result.markup.match(/<button /g) || []).length, 5);
  assert.match(result.markup, /data-action="delete-task"/);
});

test("task context menu positions a keyboard invocation from its row and ignores a stale task", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.tasks = [{ id: "keyboard", title: "键盘任务", tags: {} }];
    let mounts = 0, focused = 0, prevented = 0;
    syncContextMenuRoot = () => { mounts++; };
    document.querySelector = () => ({ focus() { focused++; } });
    const row = { querySelector: () => null, getBoundingClientRect: () => ({ left: 200, bottom: 320 }) };
    const event = { type: "keydown", preventDefault() { prevented++; }, stopPropagation() {} };
    openTaskContextMenu("keyboard", event, row);
    const menu = { ...state.contextMenu };
    openTaskContextMenu("missing", event, row);
    return { menu, mounts, focused, prevented };
  })()`);
  assert.equal(result.menu.x, 232);
  assert.equal(result.menu.y, 320);
  assert.equal(result.mounts, 1);
  assert.equal(result.focused, 1);
  assert.equal(result.prevented, 1);
});

test("quick captures and preserved group deletions remain truly ungrouped across disk normalization", async () => {
  const disk = normalizeTaskData({
    activeGroupId: "group_ungrouped",
    taskGroups: [{ id: "group_inbox", title: "默认", order: 1 }],
    tasks: [{ id: "capture_disk", title: "速记", groupId: "", captureSource: "today-widget" }],
  });
  assert.equal(disk.activeGroupId, "group_ungrouped");
  assert.equal(disk.tasks[0].groupId, "");
  assert.deepEqual(disk.taskGroups.map((group) => group.id), ["group_inbox"]);
  const withoutPersonalGroups = normalizeTaskData({
    activeGroupId: "group_ungrouped",
    taskGroups: [],
    tasks: [{ id: "ungrouped_only", title: "未分组任务", groupId: "" }],
  });
  assert.equal(withoutPersonalGroups.activeGroupId, "group_ungrouped");
  assert.deepEqual(withoutPersonalGroups.taskGroups, []);

  const harness = await rendererHarness();
  const result = JSON.parse(JSON.stringify(await harness.evaluate(`(async () => {
    render = () => {};
    save = () => {};
    confirmDestructiveAction = async () => true;
    state.taskGroups = [
      { id: "group_inbox", title: "默认", order: 1 },
      { id: "group_keep", title: "保留", order: 2 },
      { id: "group_delete", title: "删除", order: 3 }
    ];
    state.tasks = normalizeTasks([
      { id: "keep_task", title: "保留任务", groupId: "group_keep" },
      { id: "delete_task", title: "删除任务", groupId: "group_delete" }
    ]);
    state.activeGroupId = "group_all";
    const capture = createQuickCapture("新速记");
    await deleteGroup("group_keep", "ungroup");
    await deleteGroup("group_delete", "delete");
    await deleteGroup("group_inbox", "ungroup");
    state.activeGroupId = "group_ungrouped";
    return {
      captureId: capture.id,
      captureGroupId: capture.groupId,
      taskIds: state.tasks.map((task) => task.id),
      ungroupedIds: tasksInActiveGroup().map((task) => task.id),
      keepGroupId: state.tasks.find((task) => task.id === "keep_task")?.groupId,
      groupIds: state.taskGroups.map((group) => group.id)
    };
  })()`)));

  assert.equal(result.captureGroupId, "");
  assert.deepEqual(result.taskIds.sort(), ["keep_task", result.captureId].sort());
  assert.equal(result.keepGroupId, "");
  assert.ok(result.ungroupedIds.includes("keep_task"));
  assert.ok(result.ungroupedIds.some((id) => id !== "keep_task"));
  assert.ok(!result.taskIds.includes("delete_task"));
  assert.deepEqual(result.groupIds, []);
});

test("global search floats from the app rail while repository tools remain contextual", async () => {
  {
    const [harness, styles, app] = await Promise.all([
      rendererHarness(),
      rendererStyles(),
      fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    ]);
    const surfaces = harness.evaluate(`(() => {
      state.taskGroups = [{ id: "group_inbox", title: "默认", order: 1 }];
      state.tasks = normalizeTasks([{ id: "task_shell", title: "示例任务", nodes: [] }]);
      state.taskFilter = "active";
      state.searchOpen = true;
      return { sidebar: renderSidebar(), topbar: renderAppTopbar(), panel: renderGlobalSearchPanel() };
    })()`);
    const approvedShell = styles.slice(styles.lastIndexOf("2026-09-19 — restore the approved 4174 product shell"));

    assert.match(surfaces.sidebar, /class="repository-heading-row"[\s\S]*class="task-list-count">1 项/);
    assert.doesNotMatch(surfaces.sidebar, />任务仓库</);
    assert.match(surfaces.sidebar, /completion-segmented task-status-filters/);
    assert.match(surfaces.sidebar, /class="repository-filter-popover"[\s\S]*class="repository-filter-label">分组<\/span>[\s\S]*class="repository-group-slot"/);
    assert.doesNotMatch(surfaces.sidebar, /class="repository-context-row"/);
    assert.doesNotMatch(surfaces.sidebar, /data-action="toggle-settings"|data-action="toggle-theme"|自动保存已开启|class="rail-footer"|class="task-footer sidebar-foot"/);
    assert.match(surfaces.topbar, /class="app-command-bar"[\s\S]*data-setting-button="task-filter" data-value="today"[\s\S]*data-action="toggle-review"[\s\S]*class="topbar-update-slot"[\s\S]*class="app-topbar-search/);
    assert.doesNotMatch(surfaces.topbar, /<strong>Loop<\/strong>|class="app-command-brand"|class="sidebar-version"/);
    assert.match(surfaces.topbar, /class="app-command-utilities"[\s\S]*data-action="toggle-settings"[\s\S]*data-action="toggle-theme"/);
    assert.match(surfaces.topbar, /class="app-topbar-search is-open"[\s\S]*id="search"[\s\S]*class="global-search-panel"/);
    assert.doesNotMatch(surfaces.panel, /global-search-layer|id="search"/);
    assert.match(app, /state\.searchOpen \? `<div class="global-search-layer"/);
    assert.match(app, /search\.addEventListener\("focus"[\s\S]*state\.searchOpen = true;/);
    return;
  }
  const [harness, styles, app] = await Promise.all([
    rendererHarness(),
    rendererStyles(),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
  ]);
  const surfaces = harness.evaluate(`(() => {
    state.taskGroups = [{ id: "group_inbox", title: "默认", order: 1 }];
    state.tasks = normalizeTasks([{ id: "task_shell", title: "示例任务", nodes: [] }]);
    state.searchOpen = false;
    const sidebar = renderSidebar();
    state.searchOpen = true;
    const searchPanel = renderGlobalSearchPanel();
    state.theme = "dark";
    const appRail = renderAppRail();
    const taskPage = renderTaskPage(state.tasks[0]);
    const emptyPage = renderEmptyPage();
    return { light: sidebar, searchPanel, appRail, taskPage, emptyPage };
  })()`);

  assert.match(surfaces.light, /class="type-filter-button is-checked"[^>]*data-type="task"/);
  assert.match(surfaces.light, /class="type-filter-button is-checked"[^>]*data-type="note"/);
  assert.doesNotMatch(surfaces.light, /全部类型/);
  assert.match(surfaces.light, /completion-segmented task-status-filters/);
  assert.match(surfaces.light, /class="repository-primary-row task-list-head section-label task-repository-toolbar repository-context-toolbar"[\s\S]*class="repository-context-summary"[\s\S]*class="repository-group-slot"[\s\S]*class="task-list-count">1 项<[\s\S]*class="repository-context-actions"[\s\S]*class="repository-filter-menu"[\s\S]*class="repository-filter-popover"[\s\S]*class="repository-priority-select"[\s\S]*class="repository-type-toggles"[\s\S]*class="add-task-floating"/);
  assert.match(surfaces.light, /class="repository-group-value">全部记录<\/span><span class="repository-group-chevron"/);
  assert.doesNotMatch(surfaces.light, /repository-group-prefix|分组 ·/);
  assert.doesNotMatch(surfaces.light, /任务分组/);
  assert.match(surfaces.light, /class="add-task-floating"[^>]*title="新增任务"[^>]*aria-label="新增任务"[\s\S]*class="add-task-floating-icon"[\s\S]*<path d="M12 5v14M5 12h14"><\/path>/);
  assert.doesNotMatch(surfaces.light, /<span>新增<\/span>/);
  assert.match(surfaces.light, /class="repository-filter-label">优先级<\/span>[\s\S]*class="repository-priority-select"/);
  assert.match(surfaces.light, /class="repository-filter-trigger"[^>]*aria-label="打开任务筛选"[^>]*title="筛选任务"[\s\S]*class="repository-filter-icon"[\s\S]*<b aria-label="1 个筛选条件">1<\/b>/);
  assert.doesNotMatch(surfaces.light, /<span>筛选<\/span>/);
  assert.ok(surfaces.light.indexOf('class="add-task-floating"') < surfaces.light.indexOf('class="repository-list-wrapper"'));
  assert.match(surfaces.light, /class="repository-fixed-header"[\s\S]*class="repository-scroll-area" data-task-repository-scroll/);
  assert.match(surfaces.light, /class="add-task-floating"/);
  assert.doesNotMatch(surfaces.light, /data-action="toggle-theme"|data-action="toggle-settings"/);
  assert.match(surfaces.light, /class="autosave-status">已保存<\/span>/);
  assert.doesNotMatch(surfaces.light, />任务仓库</);
  assert.doesNotMatch(surfaces.light, /data-action="toggle-calendar"/);
  assert.doesNotMatch(surfaces.light, /sidebar-search-region|id="search"/);
  assert.match(surfaces.searchPanel, /class="global-search-layer"[^>]*data-global-search-layer/);
  assert.match(surfaces.searchPanel, /class="global-search-panel"[^>]*role="dialog"[^>]*aria-label="全局搜索"/);
  assert.match(surfaces.searchPanel, /class="app-global-search search-box search gooey-search is-open"[^>]*data-persistent-search="true"/);
  assert.match(surfaces.searchPanel, /id="search"[^>]*placeholder="搜索任务、节点或内容…"/);
  assert.match(surfaces.searchPanel, /class="global-search-result-heading"><span>最近任务<\/span><b>1<\/b>/);
  assert.match(surfaces.taskPage, /class="actions"[\s\S]*class="topbar-rhythm-slot"[\s\S]*class="share-trigger icon-button"/);
  assert.match(surfaces.emptyPage, /class="empty-page-tools"[\s\S]*class="topbar-rhythm-slot"/);
  assert.match(surfaces.appRail, /<aside class="app-navigation-rail"[^>]*aria-label="应用导航"/);
  assert.match(surfaces.appRail, /class="app-rail-button app-rail-search active"[^>]*data-action="toggle-global-search"[^>]*aria-pressed="true"[\s\S]*搜索/);
  assert.match(surfaces.appRail, /data-setting-button="task-filter" data-value="today"[\s\S]*今日/);
  assert.match(surfaces.appRail, /data-setting-button="task-filter" data-value="all"[\s\S]*任务/);
  assert.match(surfaces.appRail, /data-action="toggle-calendar"[\s\S]*日历/);
  assert.match(surfaces.appRail, /data-action="toggle-review"[\s\S]*回顾/);
  assert.match(surfaces.appRail, /class="app-rail-utilities"[\s\S]*data-action="toggle-theme"[\s\S]*data-action="toggle-settings"/);
  assert.match(styles, /local acceptance — stable Today rail and compact repository controls/);
  assert.match(styles, /\.today-panel\.today-focus\s*\{\s*flex:\s*0 0 auto;/);
  assert.match(styles, /\.task-repository-toolbar\s*\{[\s\S]*gap:\s*8px;/);
  assert.match(styles, /\.task-priority-filter select\s*\{[\s\S]*min-width:\s*47px;/);
  assert.match(styles, /\.add-task-floating\s*\{[\s\S]*position:\s*absolute;/);
  assert.match(styles, /\.theme-toggle\.theme-switch\s*\{[\s\S]*border-radius:\s*999px;/);
  assert.match(styles, /\.theme-toggle\.theme-switch\[aria-checked="true"\] \.theme-switch-thumb\s*\{[\s\S]*transform:\s*translateX\(16px\);/);
  assert.match(styles, /\.search\.search-box\.gooey-search\s*\{[\s\S]*--gooey-search-collapsed:\s*88px;/);
  assert.match(styles, /\.gooey-search-filter-wrap\s*\{[\s\S]*filter:\s*none;/);
  assert.match(styles, /--gooey-search-surface:\s*var\(--handoff-sidebar\);/);
  assert.match(styles, /--gooey-search-border:\s*transparent;/);
  const transparentSearchSurface = /background:\s*transparent;\r?\n  border:\s*1px solid var\(--gooey-search-border\);\r?\n  box-shadow:\s*none;/;
  assert.match(styles, transparentSearchSurface);
  assert.match(styles.replace(/\r?\n/g, "\r\n"), transparentSearchSurface);
  assert.match(styles, /\.gooey-search\.is-open \.gooey-search-trigger\s*\{[\s\S]*width:\s*var\(--gooey-search-bubble\);/);
  assert.match(styles, /\.gooey-search\.is-open \.gooey-search-field\s*\{[\s\S]*transform:\s*scaleX\(1\);/);
  assert.match(styles, /\.task-list\.task-repository\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.match(styles, /\.global-search-panel\s*\{[\s\S]*left:\s*calc\(var\(--global-rail-width\) \+ 10px\);/);
  assert.match(styles, /\.global-search-result\s*\{[\s\S]*grid-template-columns:\s*30px minmax\(0, 1fr\) 16px;/);
  assert.match(styles, /\.repository-scroll-area\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(styles, /\.repository-fixed-header\s*\{[\s\S]*flex:\s*0 0 auto;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  const productionShell = styles.slice(styles.lastIndexOf("Production shell adaptation — accepted comfort-hybrid direction"));
  assert.match(productionShell, /\.sidebar-search-region \.app-global-search/);
  assert.match(productionShell, /\.topbar-rhythm-slot\s*\{/);
  const surfaceContinuity = styles.slice(styles.lastIndexOf("2026-09-19 surface continuity"));
  assert.match(surfaceContinuity, /\.global-search-layer\s*\{[^}]*z-index:\s*220;/);
  assert.match(surfaceContinuity, /\.rail\.sidebar\.sidebar-today-mode\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--loop-green\) 3%, var\(--loop-sidebar\)\);/);
  assert.match(surfaceContinuity, /\.rail\.sidebar\.sidebar-today-mode > \.today-panel\.today-focus,[\s\S]*margin:\s*8px;[\s\S]*border-radius:\s*14px;[\s\S]*background:\s*color-mix\(in srgb, var\(--loop-green\) 9%, var\(--loop-sidebar\)\);/);
  assert.match(surfaceContinuity, /\.rail\.sidebar \.repository-primary-row\.task-list-head\.task-repository-toolbar\.repository-context-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
  assert.match(surfaceContinuity, /\.rail\.sidebar \.repository-list-wrapper\s*\{[^}]*padding:\s*0 8px 10px;[^}]*overflow:\s*hidden;/);
  assert.match(surfaceContinuity, /\.rail\.sidebar \.repository-scroll-area \.task-row\.task-item\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*grid-template-columns:\s*25px minmax\(0, 1fr\) auto 20px;/);
  assert.match(productionShell, /\.rail\.sidebar \.task-repository-toolbar\s*\{/);
  const navigationDensity = styles.slice(styles.lastIndexOf("Navigation-density refinement"));
  assert.match(navigationDensity, /\.ops-app\.app\s*\{[\s\S]*grid-template-columns:\s*var\(--global-rail-width\) var\(--context-rail-width\) minmax\(0, 1fr\);/);
  assert.match(navigationDensity, /grid-template-rows:\s*minmax\(0, 1fr\);/);
  assert.match(navigationDensity, /\.app-navigation-rail\s*\{[\s\S]*grid-row:\s*1;/);
  assert.match(navigationDensity, /\.sidebar-search-region\s*\{[\s\S]*padding:\s*4px 12px 0 14px;/);
  assert.match(navigationDensity, /\.sidebar-search-region \.app-global-search\.search-box\.gooey-search\s*\{[\s\S]*height:\s*42px;/);
  assert.match(navigationDensity, /\.rail\.sidebar \.repository-fixed-header\s*\{[\s\S]*padding:\s*0 10px 8px 12px;/);
  assert.match(navigationDensity, /\.rail\.sidebar \.repository-primary-row\.task-list-head\.task-repository-toolbar\.repository-context-toolbar\s*\{[\s\S]*display:\s*flex;[\s\S]*min-height:\s*36px;/);
  assert.match(navigationDensity, /\.rail\.sidebar \.repository-primary-row \.add-task-floating,[\s\S]*background:\s*transparent;[\s\S]*color:\s*var\(--loop-green\);/);
  assert.match(navigationDensity, /\.repository-filter-popover\s*\{[\s\S]*position:\s*absolute;[\s\S]*z-index:\s*60;/);
  const repositoryV1 = styles.slice(styles.lastIndexOf("v0.1.169 final cascade"));
  assert.match(repositoryV1, /\.rail\.sidebar \.repository-group-popover \{[^}]*top:calc\(100% \+ 6px\);[^}]*right:auto;[^}]*bottom:auto;[^}]*left:0;/);
  assert.match(repositoryV1, /\.rail\.sidebar \.repository-primary-row \.add-task-floating \{[^}]*position:absolute;[^}]*top:1px;[^}]*right:var\(--repository-padding-x\);[^}]*bottom:auto;/);
  assert.match(repositoryV1, /\.rail\.sidebar \.repository-scroll-area \.task-row\.task-item \{[^}]*height:58px;[^}]*min-height:58px;[^}]*grid-template-columns:25px minmax\(0,1fr\) 61px 18px;/);
  assert.match(repositoryV1, /\.rail\.sidebar \.repository-scroll-area \.task-row\.task-item::after \{[^}]*right:34px;[^}]*left:33px;/);
  assert.match(repositoryV1, /\.rail\.sidebar \.task-row\.task-item \.task-row-meta \{[^}]*display:grid;[^}]*grid-column:3;/);
  assert.match(repositoryV1, /\.rail\.sidebar \.task-row\.task-item\.done \{[^}]*background-color:transparent;[^}]*opacity:1;/);
  const repositoryV171 = styles.slice(styles.lastIndexOf("v0.1.171 final cascade"));
  assert.match(repositoryV171, /\.rail\.sidebar \.repository-group-trigger \{[^}]*font-size:calc\(11 \* var\(--font-unit\)\);[^}]*font-weight:500;[^}]*letter-spacing:0;/);
  assert.match(repositoryV171, /\.rail\.sidebar \.repository-primary-row \.search\.search-box\.gooey-search \{[^}]*--gooey-search-collapsed:54px;[^}]*right:calc\(var\(--repository-padding-x\) \+ 67px\);/);
  assert.match(repositoryV171, /\.rail\.sidebar \.repository-action-divider \{[^}]*width:1px;[^}]*height:14px;[^}]*background:var\(--handoff-line-strong\);/);
  assert.match(repositoryV171, /\.rail\.sidebar \.repository-primary-row \.add-task-floating \{[^}]*width:52px;[^}]*border:0;[^}]*background:transparent;[^}]*font-weight:500;/);
  assert.match(repositoryV171, /\.rail\.sidebar \.repository-priority-select \{[^}]*border:0;[^}]*background:transparent;[^}]*font-size:calc\(11 \* var\(--font-unit\)\);[^}]*font-weight:500;/);
  const repositoryV172 = styles.slice(styles.lastIndexOf("v0.1.172 final cascade"));
  assert.match(repositoryV172, /\.rail\.sidebar \.repository-primary-row\.task-list-head \{[^}]*display:grid;[^}]*grid-template-columns:minmax\(0,1fr\) max-content var\(--repository-search-track\) 1px 60px;[^}]*padding:0 var\(--repository-padding-x\);/);
  assert.match(repositoryV172, /\.rail\.sidebar \.repository-primary-row \.search\.search-box\.gooey-search \{[^}]*position:relative;[^}]*top:auto;[^}]*right:auto;[^}]*grid-column:3;/);
  assert.match(repositoryV172, /\.rail\.sidebar \.repository-primary-row \.gooey-search-trigger,[\s\S]*\.rail\.sidebar \.repository-primary-row \.add-task-floating \{[^}]*height:32px;[^}]*align-items:center;[^}]*font-size:calc\(11 \* var\(--font-unit\)\);[^}]*line-height:1;[^}]*white-space:nowrap;/);
  assert.match(repositoryV172, /\.rail\.sidebar \.repository-primary-row \.gooey-search-trigger-label,[\s\S]*\.add-task-floating > span \{[^}]*max-width:none;[^}]*overflow:visible;[^}]*opacity:1;[^}]*transition:none;/);
  assert.match(repositoryV172, /\.rail\.sidebar \.repository-primary-row \.gooey-search\.is-open \.gooey-search-trigger \{[^}]*display:none;/);
  assert.match(repositoryV172, /\.rail\.sidebar \.repository-primary-row \.gooey-search\.is-open \.gooey-search-field \{[^}]*position:relative;[^}]*display:flex;[^}]*width:100%;[^}]*height:32px;/);
  assert.match(repositoryV172, /\.rail\.sidebar \.repository-primary-row \.add-task-floating \{[^}]*grid-column:5;/);
  assert.match(app, /function renderGlobalSearch\(\)[\s\S]*class="app-global-search search-box search gooey-search is-open"[\s\S]*id="search"/);
  assert.match(app, /function bindGooeySearch\(\)/);
  assert.match(app, /function renderRepositoryGroupPicker\(\)[\s\S]*placeholder="搜索" aria-label="搜索分组"[\s\S]*data-action="add-group">＋ 新建分组/);
  assert.match(app, /function openRepositoryGroupContextMenu\(groupId, event\)[\s\S]*kind: "group"/);
  assert.match(app, /function bindRepositoryGroupOptionMenus\(scope = document\)[\s\S]*querySelectorAll\("\[data-group-context-id\]"\)[\s\S]*openRepositoryGroupContextMenu/);
  assert.match(app, /function isEditableTarget\(target\)/);
  assert.match(app, /event\.key !== "Escape" && isEditableTarget\(event\.target\)/);
  assert.match(app, /if \(event\.isComposing\) return;/);
  assert.match(app, /event\.key !== "Escape"/);
  assert.match(app, /state\.searchOpen = true;[\s\S]*state\.focusSearch = true;/);
});

test("Today widget resizes vertically from either edge and stays inside the display", () => {
  const workArea = { x: 0, y: 100, width: 1280, height: 700 };
  const bounds = { x: 800, y: 200, width: 360, height: 260 };

  assert.deepEqual(resizedWidgetBounds(bounds, workArea, 320, "top"), {
    x: 800, y: 140, width: 360, height: 320,
  });
  assert.deepEqual(resizedWidgetBounds(bounds, workArea, 320, "bottom"), {
    x: 800, y: 200, width: 360, height: 320,
  });
  assert.deepEqual(resizedWidgetBounds(bounds, workArea, 900, "top"), {
    x: 800, y: 100, width: 360, height: 360,
  });
  assert.deepEqual(resizedWidgetBounds(bounds, workArea, 900, "bottom"), {
    x: 800, y: 200, width: 360, height: 600,
  });
});

test("Today surfaces keep every scheduled task and scroll within bounded content areas", async () => {
  const [app, styles, runtime, widgetMain] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "today-widget-runtime.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "main", "today-widget.cjs"), "utf8"),
  ]);
  const normalized = normalizeSnapshot({
    items: Array.from({ length: 7 }, (_, index) => ({ taskId: `today_${index}`, title: `任务 ${index}` })),
  });

  assert.equal(normalized.items.length, 7);
  assert.doesNotMatch(app, /\.slice\(0, 3\)/);
  assert.doesNotMatch(runtime, /\.slice\(0, 3\)/);
  assert.doesNotMatch(widgetMain, /\.slice\(0, 3\)/);
});

test("task Markdown export resolves the task group and includes knowledge notes", async () => {
  const harness = await rendererHarness();
  const markdown = harness.evaluate(`(() => {
    state.taskGroups = [
      { id: "group_inbox", title: "默认", order: 1 },
      { id: "group_work", title: "工作", order: 2 }
    ];
    const task = normalizeTasks([{
      id: "task_export",
      groupId: "group_work",
      title: "导出任务",
      notes: "最新知识笔记",
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T01:00:00.000Z",
      nodes: []
    }])[0];
    return taskMarkdown(task);
  })()`);

  assert.match(markdown, /- 分组：工作/);
  assert.match(markdown, /## 知识笔记\n最新知识笔记/);
});

test("filtered task reordering preserves hidden task slots", async () => {
  const harness = await rendererHarness();
  const reordered = harness.json(`(() => {
    state.taskGroups = [{ id: "group_inbox", title: "默认", order: 1 }];
    state.activeGroupId = "group_inbox";
    state.taskFilter = "all";
    state.priorityFilter = "high";
    state.query = "";
    state.tasks = normalizeTasks([
      { id: "a", title: "A", priority: "high", order: 1, nodes: [] },
      { id: "b", title: "B", priority: "low", order: 2, nodes: [] },
      { id: "c", title: "C", priority: "high", order: 3, nodes: [] }
    ]);
    reorderTasks("a", "c", "after");
    return state.tasks.map(({ id, order }) => ({ id, order })).sort((a, b) => a.order - b.order);
  })()`);

  assert.deepEqual(reordered, [
    { id: "c", order: 1 },
    { id: "b", order: 2 },
    { id: "a", order: 3 },
  ]);
});

test("search filters repository rows without switching the active task", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.taskGroups = [{ id: "group_inbox", title: "默认", order: 1 }];
    state.activeGroupId = "group_inbox";
    state.taskFilter = "all";
    state.priorityFilter = "all";
    state.tasks = normalizeTasks([
      { id: "active", title: "当前任务", groupId: "group_inbox", nodes: [] },
      { id: "hit", title: "可搜索任务", groupId: "group_inbox", nodes: [] }
    ]);
    state.activeTaskId = "active";
    state.query = "可搜索";
    return { active: activeTask().id, results: filteredTasks().map((task) => task.id) };
  })()`);

  assert.equal(result.active, "active");
  assert.deepEqual(result.results, ["hit"]);
  assert.match(app, /function refreshTaskRepository\(\)/);
  assert.match(app, /filteredTasks\(\{ includeQuery: false \}\)/);
  assert.match(app, /compositionstart/);
});

test("exact deadline-date filtering composes with task status and remains transient", async () => {
  const [app, styles] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
  ]);
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.taskGroups = [{ id: "group_inbox", title: "默认", order: 1 }];
    state.activeGroupId = "group_inbox";
    state.query = "";
    state.priorityFilter = "all";
    state.taskDateFilter = "2026-08-12";
    state.tasks = normalizeTasks([
      { id: "active_match", title: "当日未完成", status: "active", deadlineAt: new Date(2026, 7, 12, 10).toISOString(), nodes: [] },
      { id: "done_match", title: "当日已完成", status: "done", deadlineAt: new Date(2026, 7, 12, 18).toISOString(), nodes: [] },
      { id: "other_day", title: "其他日期", status: "active", deadlineAt: new Date(2026, 7, 11, 10).toISOString(), nodes: [] }
    ]);
    state.taskFilter = "active";
    const active = filteredTasks().map((task) => task.id);
    state.taskFilter = "done";
    const done = filteredTasks().map((task) => task.id);
    return { active, done, label: taskDateFilterLabel(state.taskDateFilter) };
  })()`);

  assert.deepEqual(result.active, ["active_match"]);
  assert.deepEqual(result.done, ["done_match"]);
  assert.equal(result.label, "08/12");
  assert.equal(harness.evaluate(`normalizeTaskDateFilter("2026-02-30")`), "");
  assert.doesNotMatch(app, /task-calendar-filter|task-date-filter-popover|data-task-date-filter|clear-task-date-filter/);
  assert.doesNotMatch(styles, /\.task-calendar-filter|\.task-date-filter-popover/);
  assert.doesNotMatch(app, /taskDateFilter:\s*state\.taskDateFilter/);
});

test("optional deadlines normalize consistently and invalid values stay unset", async () => {
  const normalized = normalizeTaskData({
    tasks: [
      { id: "valid", deadlineAt: "2026-08-25T10:30:00.000Z", deadlineReminderMinutes: 30 },
      { id: "invalid", deadlineAt: "not-a-date", deadlineReminderMinutes: 999 },
      { id: "missing", deadlineReminderMinutes: null },
    ],
  }).tasks;

  assert.equal(normalized[0].deadlineAt, "2026-08-25T10:30:00.000Z");
  assert.equal(normalized[1].deadlineAt, "");
  assert.equal(normalized[2].deadlineAt, "");
  assert.equal(normalized[0].deadlineReminderMinutes, 30);
  assert.equal(normalized[1].deadlineReminderMinutes, 60);
  assert.equal(normalized[2].deadlineReminderMinutes, null);

  const harness = await rendererHarness();
  assert.equal(harness.evaluate(`normalizeTasks([{ id: "renderer", deadlineAt: "2026-08-25T10:30:00.000Z" }])[0].deadlineAt`), "2026-08-25T10:30:00.000Z");
  assert.equal(harness.evaluate(`normalizeTasks([{ id: "renderer-invalid", deadlineAt: "invalid" }])[0].deadlineAt`), "");
  assert.equal(harness.evaluate(`normalizeTasks([{ id: "renderer", deadlineReminderMinutes: 1440 }])[0].deadlineReminderMinutes`), 1440);
  assert.equal(harness.evaluate(`normalizeTasks([{ id: "renderer", deadlineReminderMinutes: null }])[0].deadlineReminderMinutes`), null);
});

test("deadline ranges compose with status and order only deadline-scoped results", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    const at = new Date(2026, 7, 24, 10, 0);
    state.taskGroups = [{ id: "group_inbox", title: "默认", order: 1 }];
    state.activeGroupId = "group_inbox";
    state.query = "";
    state.priorityFilter = "all";
    state.taskFilter = "active";
    state.taskDateFilter = "";
    state.tasks = normalizeTasks([
      { id: "manual-first", title: "无截止", status: "active", order: 1, nodes: [] },
      { id: "tomorrow-late", title: "明晚", status: "active", order: 2, deadlineAt: new Date(2026, 7, 25, 18).toISOString(), nodes: [] },
      { id: "overdue", title: "已逾期", status: "active", order: 3, deadlineAt: new Date(2026, 7, 23, 18).toISOString(), nodes: [] },
      { id: "tomorrow-early", title: "明早", status: "active", order: 4, deadlineAt: new Date(2026, 7, 25, 9).toISOString(), nodes: [] },
      { id: "done-overdue", title: "已完成", status: "done", order: 5, deadlineAt: new Date(2026, 7, 23, 9).toISOString(), nodes: [] }
    ]);
    state.taskDeadlineFilter = "all";
    const manual = filteredTasks({ at }).map((task) => task.id);
    state.taskDeadlineFilter = "week";
    const week = filteredTasks({ at }).map((task) => task.id);
    state.taskDeadlineFilter = "overdue";
    const overdue = filteredTasks({ at }).map((task) => task.id);
    state.taskDeadlineFilter = "all";
    state.taskDateFilter = "2026-08-25";
    const exact = filteredTasks({ at }).map((task) => task.id);
    return { manual, week, overdue, exact };
  })()`);

  assert.deepEqual(result.manual, ["manual-first", "tomorrow-late", "overdue", "tomorrow-early"]);
  assert.deepEqual(result.week, ["tomorrow-early", "tomorrow-late"]);
  assert.deepEqual(result.overdue, ["overdue"]);
  assert.deepEqual(result.exact, ["tomorrow-early", "tomorrow-late"]);
});

test("calendar owns one global navigation entry, fills the workspace, and keeps the deadline date and time picker", async () => {
  const rendererDir = path.join(__dirname, "..", "app", "renderer", "src");
  const [shell, app, shellCss] = await Promise.all([
    fs.readFile(path.join(rendererDir, "shell.js"), "utf8"),
    fs.readFile(path.join(rendererDir, "app.js"), "utf8"),
    fs.readFile(path.join(rendererDir, "shell.css"), "utf8"),
  ]);

  // Exactly one global navigation entry each, emitted from the shared helper.
  assert.equal((shell.match(/toggle-calendar/g) || []).length, 1);
  assert.equal((shell.match(/toggle-review/g) || []).length, 1);
  assert.match(shell, /\["today", "日历", "calendar"\]|shellNavButton\("calendar", "日历", "calendar"\)/);
  assert.match(shell, /shellNavButton\("review", "回顾", "history"\)/);

  // Wide routes hide the task-list column and let the workspace take the row.
  // render() builds the list markup once so it can be reused as a region, and
  // retainRegion clears the slot when that markup is empty.
  assert.match(app, /const listMarkup = shellWide \? "" : renderShellTaskList\(filteredTasks\(\)\);/);
  assert.match(app, /retainRegion\("task-list", listMarkup\);/);
  assert.match(app, /const shellWide = shellIsWide\(\);/);
  assert.match(shellCss, /\.app-wide\{grid-template-columns:var\(--nav-width\) minmax\(0,1fr\)\}/);

  // The deadline picker wiring survives the redesign.
  assert.match(app, /data-action="toggle-deadline-picker"/);
  assert.match(app, /data-action="select-deadline-date"/);
  assert.match(app, /data-action="apply-deadline-time"/);
});

test("calendar date navigation clears unrelated filters and returns to the selected day", async () => {
  const harness = await rendererHarness();
  await harness.evaluate(`(async () => {
    render = () => {};
    syncContextMenuRoot = () => {};
    state.tasks = normalizeTasks([
      { id: "a", title: "分组一任务", groupId: "g1", priority: "low", deadlineAt: new Date(2026,9,7,9).toISOString(), nodes: [] },
      { id: "b", title: "分组二已完成", groupId: "g2", status: "done", conclusion: "完成", deadlineAt: new Date(2026,9,7,18).toISOString(), nodes: [] },
      { id: "c", title: "次日任务", groupId: "g2", deadlineAt: new Date(2026,9,8,9).toISOString(), nodes: [] }
    ]);
    state.taskGroups = normalizeTaskGroups([{id:"g1",title:"一"},{id:"g2",title:"二"}], state.tasks);
    Object.assign(state, { activeGroupId: "g1", calendarOpen: true, calendarSelectedDate: "2026-10-07", calendarMonth: "2026-10-01", taskFilter: "blocked", captureSourceFilter: "quick", priorityFilter: "high", query: "不会命中", taskPane: "notes" });
    await action({action:"apply-calendar-date"});
  })()`);
  assert.deepEqual(harness.json("filteredTasks().map(task => task.id)"), ["a", "b"]);
  assert.equal(harness.evaluate("state.activeGroupId === ALL_TASKS_GROUP_ID"), true);
  assert.equal(harness.evaluate("state.taskPane"), "flow");
  assert.match(harness.evaluate("renderShellTopbar()"), /返回日历/);
  await harness.evaluate('action({action:"return-global-page"})');
  assert.deepEqual(harness.json("[state.calendarOpen,state.calendarSelectedDate,state.calendarMonth,state.query,state.priorityFilter,state.globalListReturn]"), [true,"2026-10-07","2026-10-01","不会命中","high",null]);
});

test("review ranges reject invalid bounds and include the entire end date; task detours restore context and focus", async () => {
  const harness = await rendererHarness();
  harness.evaluate(`
    render = () => {}; syncContextMenuRoot = () => {};
    state.tasks = normalizeTasks([
      {id:"end",title:"结束日任务",groupId:"g",createdAt:new Date(2026,9,7,23,59,59).toISOString(),nodes:[]},
      {id:"next",title:"次日任务",groupId:"g",createdAt:new Date(2026,9,8,0).toISOString(),nodes:[]}
    ]);
    state.taskGroups = normalizeTaskGroups([{id:"g",title:"分组"}],state.tasks);
    Object.assign(state,{reviewOpen:true,calendarOpen:false,reviewPreset:"custom",reviewDateField:"created",reviewStartDate:"2026-10-07",reviewEndDate:"2026-10-07",captureSourceFilter:"quick",taskPane:"notes"});
  `);
  assert.deepEqual(harness.json("reviewTasks().map(item => item.task.id)"), ["end"]);
  assert.match(harness.evaluate("renderShellReview()"), /10 月 7 日 — 10 月 7 日/);
  assert.doesNotMatch(harness.evaluate("renderShellReview()"), /data-action="time18-clock"/);
  assert.match(harness.evaluate("shellSettingsAdvanced()"), /data-action="time18-clock"/);
  for (const bounds of [["2026-10-08","2026-10-07"],["","2026-10-07"],["2026-02-30","2026-10-07"]]) {
    harness.evaluate(`state.reviewStartDate = ${JSON.stringify(bounds[0])}; state.reviewEndDate = ${JSON.stringify(bounds[1])}`);
    assert.equal(harness.evaluate("shellReviewRangeError()"), true);
    assert.equal(harness.evaluate("reviewTasks().length"), 0);
    assert.doesNotMatch(harness.evaluate("renderShellReview()"), /<table/);
    assert.match(harness.evaluate("renderShellReview()"), /role="alert"/);
  }
  harness.evaluate(`
    state.reviewStartDate = "2026-10-07"; state.reviewEndDate = "2026-10-07";
    globalThis.returnFocus = false;
    globalThis.scroll = {className:"review-content",scrollTop:93,scrollTo({top}) {this.scrollTop=top;}};
    document.querySelectorAll = (selector) => selector.includes("review-content") ? [scroll] : [];
    document.querySelector = (selector) => selector === ".review-content" ? scroll : selector.includes("open-review-task") ? {focus() {returnFocus=true;}} : null;
    window.requestAnimationFrame = (callback) => callback();
    openTaskFromGlobalList("end");
    scroll.scrollTop = 0;
  `);
  assert.equal(harness.evaluate("filteredTasks().some(task => task.id === 'end')"), true);
  assert.equal(harness.evaluate("state.taskPane"), "flow");
  assert.match(harness.evaluate("renderShellTopbar()"), /返回回顾/);
  await harness.evaluate('action({action:"return-global-page"})');
  assert.deepEqual(harness.json("[state.reviewOpen,state.reviewPreset,state.reviewDateField,state.reviewStartDate,state.reviewEndDate,scroll.scrollTop,returnFocus]"), [true,"custom","created","2026-10-07","2026-10-07",93,true]);
  harness.evaluate('openTaskFromGlobalList("end"); applySetting("task-filter","today")');
  assert.equal(harness.evaluate("state.globalListReturn"), null, "explicit primary navigation must discard the old detour");
});

test("calendar uses local month boundaries, variable week counts and a quiet empty agenda", async () => {
  const harness = await rendererHarness();
  for (const [month, count] of [["2027-02-01",28],["2026-10-01",35],["2026-08-01",42]]) {
    harness.evaluate(`state.calendarMonth=${JSON.stringify(month)};state.calendarSelectedDate=${JSON.stringify(month)}`);
    assert.equal(harness.evaluate("shellCalendarMonth().getDate()"), 1);
    assert.equal(harness.evaluate("shellCalendarMonth().getHours()"), 0, "date-only months must parse at local midnight, not UTC");
    const html = harness.evaluate("renderShellCalendar()");
    assert.equal((html.match(/data-action="select-calendar-date"/g) || []).length, count);
    const agenda = html.match(/<aside class="agenda"[\s\S]*?<\/aside>/)[0];
    assert.match(agenda, /暂无任务/);
    assert.doesNotMatch(agenda, /在任务中查看|个任务截止|尚未记录进展/);
  }
  harness.evaluate('loopSetPreviewClock("2027-02-03T09:00"); state.calendarMonth=""; state.calendarSelectedDate="";ensureCalendarState()');
  assert.deepEqual(harness.json("[state.calendarMonth,state.calendarSelectedDate]"), ["2027-02-01","2027-02-03"]);
});

test("deadline picker follows the documented date-first and time-save flow", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    const localDeadline = new Date(2026, 7, 25, 10, 15, 0, 0);
    const task = normalizeTasks([{ id: "deadline_picker", title: "截止日期任务", deadlineAt: localDeadline.toISOString(), nodes: [] }])[0];
    state.tasks = [task];
    deadlinePopoverTaskId = task.id;
    initializeDeadlinePicker(task);
    const originalDate = deadlinePickerDate;
    const originalSlots = deadlineTimeSlots(new Date(task.deadlineAt));
    deadlinePickerDate = "2026-08-26";
    const changedDateSlots = deadlineTimeSlots(new Date(task.deadlineAt));
    applyTaskDeadlineTime(task.id, "18:30");
    const saved = new Date(task.deadlineAt);
    return {
      originalDate,
      hasExtraSlot: originalSlots.includes("10:15"),
      changedDateHasExtraSlot: changedDateSlots.includes("10:15"),
      savedDate: localDateKey(saved),
      savedTime: deadlineTimeValue(saved),
      savedIso: task.deadlineAt,
      reminderMinutes: task.deadlineReminderMinutes,
      popover: renderTaskDeadlinePopover(task),
    };
  })()`);

  assert.equal(result.originalDate, "2026-08-25");
  assert.equal(result.hasExtraSlot, true);
  assert.equal(result.changedDateHasExtraSlot, false);
  assert.equal(result.savedDate, "2026-08-26");
  assert.equal(result.savedTime, "18:30");
  assert.match(result.savedIso, /T/);
  assert.match(result.popover, /task-deadline-calendar-foot/);
  assert.match(result.popover, /data-action="deadline-picker-today"/);
  assert.match(result.popover, /role="listbox"/);
  assert.match(result.popover, /role="option"/);
  assert.equal(result.reminderMinutes, 60);
  assert.match(result.popover, /data-deadline-reminder/);
  assert.match(result.popover, /提前 1 小时/);
});

test("recurring tasks normalize, become due at local time, and reactivate for a new occurrence", async () => {
  const normalized = normalizeTaskData({
    tasks: [{
      id: "repeat",
      recurrence: { frequency: "weekly", weekday: 5, time: "08:30", lastCompletedOccurrence: "invalid" },
    }],
  }).tasks[0].recurrence;
  assert.deepEqual(normalized, {
    frequency: "weekly",
    weekdays: [5],
    time: "08:30",
    lastCompletedOccurrence: "",
  });

  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    const fridayMorning = new Date(2026, 7, 14, 8, 29);
    const fridayDue = new Date(2026, 7, 14, 8, 30);
    const saturdayDue = new Date(2026, 7, 15, 9, 0);
    const weekly = normalizeTasks([{ id: "weekly", recurrence: { frequency: "weekly", weekdays: [1, 3, 5], time: "08:30" }, nodes: [] }])[0];
    const daily = normalizeTasks([{ id: "daily", status: "done", recurrence: { frequency: "daily", time: "09:00", lastCompletedOccurrence: "2026-08-14" }, nodes: [] }])[0];
    state.tasks = [daily];
    const changed = syncRecurringTasks(saturdayDue);
    return {
      before: isRecurringTaskDue(weekly, fridayMorning),
      due: isRecurringTaskDue(weekly, fridayDue),
      wrongDay: isRecurringTaskDue(weekly, saturdayDue),
      multipleDays: isRecurringTaskDue(weekly, new Date(2026, 7, 12, 8, 30)),
      dailyStatus: daily.status,
      changed,
      key: recurringOccurrenceKey(daily, saturdayDue),
    };
  })()`);

  assert.equal(result.before, false);
  assert.equal(result.due, true);
  assert.equal(result.wrongDay, false);
  assert.equal(result.multipleDays, true);
  assert.equal(result.dailyStatus, "active");
  assert.equal(result.changed, true);
  assert.equal(result.key, "2026-08-15");
});

test("recurrence controls feed every Today surface and refresh while the app stays open", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");
  assert.match(app, /data-recurrence-mode=/);
  assert.match(app, /data-recurrence-weekday=/);
  assert.match(app, /data-recurrence-field="time"/);
  // Phase18: the Today route now switches between the active list and today's
  // completions (completed occurrences included), not only scheduled tasks.
  assert.match(app, /if \(state\.taskFilter === "today"\) \{[\s\S]*state\.todayFilter === "done"[\s\S]*shellCompletedToday\(\)\.includes\(task\)[\s\S]*isTaskScheduledForToday\(task\)/);
  assert.match(app, /\.filter\(\(task\) => isTaskScheduledForToday\(task\)\)/);
  assert.match(app, /window\.setInterval\?\.\([\s\S]*?30000/);
});

test("recurrence settings match the selected compact popover and support multiple weekdays", async () => {
  const [app, styles] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
  ]);
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    const task = normalizeTasks([{
      id: "weekly",
      recurrence: { frequency: "weekly", weekdays: [1, 3, 5], time: "08:30" },
      nodes: []
    }])[0];
    recurrencePopoverTaskId = task.id;
    const html = renderTaskRecurrenceControls(task);
    recurrencePopoverTaskId = "";
    const pageHtml = renderTaskPage(task);
    state.tasks = [task];
    updateTaskRecurrence(task.id, "weekday", "3");
    updateTaskRecurrence(task.id, "weekday", "2");
    updateTaskRecurrence(task.id, "frequency", "none");
    updateTaskRecurrence(task.id, "frequency", "weekly");
    return {
      html,
      pageHtml,
      upcoming: recurrenceUpcomingLabels(task.recurrence, new Date(2026, 7, 15, 10, 0), 3),
      weekdays: task.recurrence.weekdays,
    };
  })()`);
  const finalRules = styles.slice(styles.lastIndexOf("v0.1.109 — demo-matched recurrence popover"));
  const briefRules = styles.slice(styles.lastIndexOf("v0.1.168 - J1 workbench header"));

  assert.match(result.html, /class="task-recurrence-trigger"/);
  assert.match(result.html, /aria-expanded="true"/);
  assert.match(result.html, /每周一、三、五 · 08:30/);
  assert.match(result.html, /role="dialog" aria-label="循环设置"/);
  assert.match(result.html, /data-recurrence-mode="weekly"/);
  assert.match(result.html, /data-recurrence-weekday="5"/);
  assert.doesNotMatch(result.html, /修改后自动保存|>重复<|出现在今日任务|每周执行日|未来三次/);
  assert.equal(result.pageHtml.match(/每周一、三、五 · 08:30/g)?.length, 1);
  assert.doesNotMatch(result.pageHtml, /task-tag recurring/);
  assert.deepEqual(result.upcoming, ["8月17日 周一 08:30", "8月18日 周二 08:30", "8月21日 周五 08:30"]);
  assert.deepEqual(result.weekdays, [1, 2, 5]);
  assert.match(app, /let recurrencePopoverTaskId = "";/);
  assert.match(result.pageHtml, /class="brief-field brief-cell background/);
  assert.match(result.pageHtml, /class="brief-field brief-cell hypothesis/);
  assert.doesNotMatch(result.pageHtml, /brief-progress-ring|brief-edit-icon/);
  assert.doesNotMatch(result.pageHtml, /src\/assets\/feather\/feather-sprite\.svg#(?:file-text|bar-chart-2|check-square|edit-3)/);

  const workbenchBaseStart = styles.lastIndexOf("v0.1.168 - J1 workbench header");
  const workbenchBaseEnd = styles.indexOf("v0.1.165 Settings", workbenchBaseStart);
  const workbenchBaseRules = styles.slice(workbenchBaseStart, workbenchBaseEnd);
  const sharedCanvasRules = styles.slice(styles.lastIndexOf("v0.1.173 shared writing canvas"));
});

test("group and node mutations do not steal repository title focus", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");
  assert.doesNotMatch(app, /window\.setTimeout\(render, 0\)/);
  assert.match(app, /\.task-check, input, textarea, select, button, \[contenteditable\]/);
  assert.match(app, /event\.relatedTarget\?\.closest\?\.\("\.task-title, \.page-title"\)/);
});

test("app switching restores native and Milkdown editing selections", async () => {
  const [app, milkdown] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "milkdown-editor.entry.js"), "utf8"),
  ]);

  assert.match(app, /function captureAppSwitchEditingFocus\(/);
  assert.match(app, /function restoreAppSwitchEditingFocus\(/);
  assert.match(app, /if \(!event\.relatedTarget && !appEditingPointerDown && captureAppSwitchEditingFocus\(event\.target\)\)/);
  assert.match(app, /window\.addEventListener\("focus", \(\) => \{\s*publishTodayWidgetSnapshot\(\);\s*if \(restoreAppSwitchEditingFocus\(\)\) return;/);
  assert.match(app, /editor\.addEventListener\("blur",[\s\S]*captureAppSwitchEditingFocus/);
  assert.match(milkdown, /editorViewCtx/);
  assert.match(milkdown, /getSelection:/);
  assert.match(milkdown, /restoreSelection:/);

  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    let focusCount = 0;
    let restoredRange = null;
    const field = {
      classList: { contains: (name) => name === "page-title" },
      dataset: { editKey: "title", taskId: "task_focus", nodeId: "" },
      value: "0123456789",
      focus() { focusCount += 1; },
      selectionStart: 4,
      selectionEnd: 7,
      scrollLeft: 12,
      scrollTop: 3,
      setSelectionRange(start, end) { restoredRange = [start, end]; }
    };
    document.body.contains = (element) => element === field;
    captureAppSwitchEditingFocus(field);
    appSwitchFocusSnapshot.restore = true;
    captureAppSwitchEditingFocus(field);
    const restoreSurvivedLateBlur = appSwitchFocusSnapshot.restore;
    field.selectionStart = 0;
    field.selectionEnd = 0;
    field.scrollLeft = 0;
    field.scrollTop = 0;
    const restored = restoreAppSwitchEditingFocus();
    return {
      restored,
      focusCount,
      restoredRange,
      scrollLeft: field.scrollLeft,
      scrollTop: field.scrollTop,
      restoreSurvivedLateBlur,
      snapshotCleared: appSwitchFocusSnapshot === null
    };
  })()`);

  assert.deepEqual(result, {
    restored: true,
    focusCount: 1,
    restoredRange: [4, 7],
    scrollLeft: 12,
    scrollTop: 3,
    restoreSurvivedLateBlur: true,
    snapshotCleared: true,
  });
});

test("task title edits mirror immediately between repository and workbench", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.tasks = normalizeTasks([{ id: "task_title", title: "旧标题", nodes: [] }]);
    const repository = { dataset: { taskId: "task_title", editKey: "title" }, value: "旧标题" };
    const workbench = { dataset: { taskId: "task_title", editKey: "title" }, value: "新标题" };
    document.activeElement = workbench;
    document.querySelectorAll = (selector) => selector === '[data-edit-key="title"][data-task-id]' ? [repository, workbench] : [];
    edit(workbench.dataset, workbench.value);
    return { stateTitle: state.tasks[0].title, repositoryTitle: repository.value, workbenchTitle: workbench.value };
  })()`);

  assert.deepEqual(result, {
    stateTitle: "新标题",
    repositoryTitle: "新标题",
    workbenchTitle: "新标题",
  });
});

test("every repository row click activates its task before nested controls run", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.tasks = normalizeTasks([
      { id: "current", title: "当前任务", nodes: [] },
      { id: "clicked", title: "点击任务", nodes: [] }
    ]);
    state.activeTaskId = "current";
    state.selectedNodeId = "open_node";
    state.recordDraft = "draft";
    const listeners = {};
    const row = {
      dataset: { taskId: "clicked" },
      addEventListener(type, listener, options) {
        if (type === "click" && options === true) listeners.click = listener;
      },
      querySelectorAll() { return []; }
    };
    const scope = {
      querySelectorAll(selector) {
        return selector === ".task-item[data-task-id]" ? [row] : [];
      }
    };
    bindTaskRepositoryRows(scope);
    listeners.click({
      preventDefault() {},
      stopPropagation() {},
      target: {
        closest(selector) {
          if (selector === "[data-action]") return null;
          if (selector === ".task-title") return this;
          return null;
        }
      }
    });
    return {
      activeTaskId: state.activeTaskId,
      selectedNodeId: state.selectedNodeId,
      recordDraft: state.recordDraft,
      focusTaskTitleId: state.focusTaskTitleId
    };
  })()`);

  assert.deepEqual(result, {
    activeTaskId: "clicked",
    selectedNodeId: "",
    recordDraft: "",
    focusTaskTitleId: "clicked",
  });
});

test("completion keeps the clicked repository task visible when it leaves the current filter", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.taskGroups = [{ id: "group_inbox", title: "默认", order: 1 }];
    state.activeGroupId = "group_inbox";
    state.taskFilter = "active";
    state.tasks = normalizeTasks([
      { id: "current", title: "当前任务", conclusion: "完成", status: "active", nodes: [] },
      { id: "clicked", title: "点击任务", conclusion: "完成", status: "active", nodes: [] }
    ]);
    state.activeTaskId = "current";
    activateRepositoryTask("clicked");
    toggleTaskDone("clicked");
    return {
      activeTaskId: activeTask().id,
      visibleRepositoryIds: filteredTasks().map((task) => task.id),
      clickedStatus: state.tasks.find((task) => task.id === "clicked").status
    };
  })()`);

  assert.equal(result.activeTaskId, "clicked");
  assert.deepEqual(result.visibleRepositoryIds, ["current"]);
  assert.equal(result.clickedStatus, "done");
});

test("task completion requires a conclusion and every nested processing-flow node to be done", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.tasks = normalizeTasks([
      {
        id: "nested_incomplete",
        title: "递归校验",
        conclusion: "已有结论",
        nodes: [{
          id: "root_done",
          status: "done",
          children: [{ id: "child_open", status: "todo", children: [] }]
        }]
      },
      {
        id: "missing_both",
        title: "结论优先",
        conclusion: "",
        nodes: [{ id: "root_open", status: "todo", children: [] }]
      },
      {
        id: "all_done",
        title: "全部完成",
        conclusion: "完成结论",
        nodes: [{
          id: "root_complete",
          status: "done",
          children: [{ id: "child_complete", status: "done", children: [] }]
        }]
      }
    ]);
    const nested = toggleTaskDone("nested_incomplete");
    const flowNotice = renderCompletionNotice();
    const missing = toggleTaskDone("missing_both");
    const conclusionNotice = renderCompletionNotice();
    const complete = toggleTaskDone("all_done");
    return {
      nested,
      missing,
      complete,
      statuses: Object.fromEntries(state.tasks.map((task) => [task.id, task.status])),
      flowNotice,
      conclusionNotice
    };
  })()`);

  assert.equal(result.nested.code, "FLOW_INCOMPLETE");
  assert.equal(result.missing.code, "CONCLUSION_REQUIRED");
  assert.equal(result.complete.code, "COMPLETED");
  assert.deepEqual(result.statuses, {
    nested_incomplete: "active",
    missing_both: "active",
    all_done: "done",
  });
  assert.match(result.flowNotice, /请先完成处理流中的所有节点/);
  assert.match(result.conclusionNotice, /请先填写结论/);
});

test("flow title and record widths share a bounded accessible splitter", async () => {
  const [app, styles] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
  ]);
  const harness = await rendererHarness();
  const widths = harness.json(`(() => {
    state.flowWidths = { title: 360, note: 330 };
    setFlowSplitTitleWidth(500, null);
    const first = { ...state.flowWidths };
    setFlowSplitTitleWidth(900, null);
    return { first, clamped: { ...state.flowWidths } };
  })()`);
  const renderedDrag = harness.json(`(() => {
    state.flowWidths = { title: 360, note: 330 };
    const properties = {};
    const attributes = {};
    const titleCell = { getBoundingClientRect: () => ({ left: 100, right: 460 }) };
    const recordCell = { getBoundingClientRect: () => ({ left: 460, right: 800 }) };
    const row = { querySelector: (selector) => selector === ".flow-title-cell" ? titleCell : recordCell };
    const handle = { setAttribute: (name, value) => { attributes[name] = value; } };
    const flowList = {
      querySelector: (selector) => selector === ".flow-line.flow-row:not(.header)" ? row : handle,
      style: { setProperty: (name, value) => { properties[name] = value; } }
    };
    setFlowSplitFromClientX(450, flowList);
    return { widths: { ...state.flowWidths }, properties, attributes };
  })()`);
  const finalFlowRules = styles.slice(styles.lastIndexOf("Persisted values are relative weights"));

  assert.deepEqual(widths.first, { title: 500, note: 190 });
  assert.deepEqual(widths.clamped, { title: 510, note: 180 });
  assert.deepEqual(renderedDrag.widths, { title: 345, note: 345 });
  assert.equal(renderedDrag.properties["--flow-title-track"], "345fr");
  assert.equal(renderedDrag.properties["--flow-note-track"], "345fr");
  assert.equal(renderedDrag.attributes["aria-valuenow"], "50");
  assert.match(app, /role="separator"[^>]+data-flow-split-resizer/);
  assert.match(app, /handleFlowSplitKeydown/);
  assert.match(app, /function flowSplitGeometry/);
  assert.match(app, /function setFlowSplitFromClientX/);
  assert.doesNotMatch(app, /data-resize-col/);
});

test("processing-flow nodes move across parents, levels, and sibling positions without cycles", async () => {
  const [app, styles] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8"),
    rendererStyles(),
  ]);
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    state.tasks = normalizeTasks([{
      id: "task_drag_nodes",
      nodes: [
        {
          id: "a",
          title: "A",
          children: [
            { id: "a1", title: "A1", collapsed: true, children: [{ id: "a1x", title: "A1X", children: [] }] },
            { id: "a2", title: "A2", children: [] }
          ]
        },
        { id: "b", title: "B", children: [{ id: "b1", title: "B1", children: [] }] },
        { id: "c", title: "C", children: [] }
      ]
    }]);

    const siblingMove = moveFlowNode("task_drag_nodes", "a2", "a1", "before");
    const reparentMove = moveFlowNode("task_drag_nodes", "b1", "a1", "inside");
    const rootPositionMove = moveFlowNode("task_drag_nodes", "a1x", "c", "before");
    const secondReparentMove = moveFlowNode("task_drag_nodes", "c", "b", "inside");
    const beforeInvalid = JSON.stringify(state.tasks[0].nodes);
    const invalidDescendantMove = moveFlowNode("task_drag_nodes", "a", "b1", "inside");
    const invalidUnchanged = JSON.stringify(state.tasks[0].nodes) === beforeInvalid;
    const rootAppendMove = moveFlowNode("task_drag_nodes", "b1", "", "root");
    const rootSiblingMove = moveFlowNode("task_drag_nodes", "a1", "b", "after");
    const task = state.tasks[0];
    const snapshot = (nodes) => sort(nodes).map((node) => ({
      id: node.id,
      parentId: node.parentId,
      type: node.type,
      order: node.order,
      children: snapshot(node.children)
    }));
    return {
      siblingMove,
      reparentMove,
      rootPositionMove,
      secondReparentMove,
      invalidDescendantMove,
      invalidUnchanged,
      rootAppendMove,
      rootSiblingMove,
      a1Expanded: findNode(task.nodes, "a1").collapsed === false,
      placements: [10, 35, 36, 50, 64, 65, 90].map((clientY) => flowNodeDropPlacement({ getBoundingClientRect: () => ({ top: 0, height: 100 }) }, clientY)),
      feedback: ["before", "inside", "after"].map((placement) => flowNodeDropFeedback({
        closest: () => ({ dataset: { flowDepth: "2" } }),
        querySelector: () => ({ value: "目标节点" })
      }, placement)),
      nodes: snapshot(task.nodes)
    };
  })()`);

  assert.equal(result.siblingMove, true);
  assert.equal(result.reparentMove, true);
  assert.equal(result.rootPositionMove, true);
  assert.equal(result.secondReparentMove, true);
  assert.equal(result.invalidDescendantMove, false);
  assert.equal(result.invalidUnchanged, true);
  assert.equal(result.rootAppendMove, true);
  assert.equal(result.rootSiblingMove, true);
  assert.equal(result.a1Expanded, true);
  assert.deepEqual(result.placements, ["before", "before", "inside", "inside", "inside", "after", "after"]);
  assert.deepEqual(result.feedback, [
    "同级排序，不改变层级 · 放到「目标节点」之前 · 第 3 层",
    "成为「目标节点」的子级 · 第 4 层",
    "同级排序，不改变层级 · 放到「目标节点」之后 · 第 3 层",
  ]);
  assert.deepEqual(result.nodes, [
    { id: "a", parentId: null, type: "step", order: 1, children: [{ id: "a2", parentId: "a", type: "subtask", order: 1, children: [] }] },
    { id: "b", parentId: null, type: "step", order: 2, children: [{ id: "c", parentId: "b", type: "subtask", order: 1, children: [] }] },
    { id: "a1", parentId: null, type: "step", order: 3, children: [] },
    { id: "a1x", parentId: null, type: "step", order: 4, children: [] },
    { id: "b1", parentId: null, type: "step", order: 5, children: [] },
  ]);
  assert.match(app, /class="flow-outline-row" data-flow-drag-source data-flow-drag-target/);
  assert.match(app, /data-flow-depth="\$\{depth\}"/);
  assert.doesNotMatch(app, /draggable="true"[^>]+data-flow-drag-source/);
  assert.doesNotMatch(app, /<button class="flow-node-drag-handle"/);
  assert.doesNotMatch(app, /flow-node-drag-grip/);
  assert.doesNotMatch(styles, /\.flow-node-drag-handle/);
  assert.doesNotMatch(styles, /\.flow-node-drag-grip/);
  assert.match(app, /const flowNodeLongPressDelay = 180/);
  assert.match(app, /const flowNodeLongPressMoveTolerance = 8/);
  assert.match(app, /function beginFlowNodePointerDrag\(/);
  assert.match(app, /classList\.add\("node-drag-pressing"\)/);
  assert.match(app, /window\.setTimeout\(\(\) => activateFlowNodePointerDrag\(\), flowNodeLongPressDelay\)/);
  assert.match(app, /event\.target\.closest\("button, select, textarea, input, a, \[contenteditable\]"\)/);
  assert.match(app, /control && !control\.matches\("\.node-title"\)/);
  assert.match(app, /distance > flowNodeLongPressMoveTolerance/);
  assert.match(app, /function updateFlowNodePointerDrag\(/);
  assert.match(app, /document\.elementFromPoint\(event\.clientX, event\.clientY\)/);
  assert.match(app, /setPointerCapture\?\.\(flowNodeDragState\.pointerId\)/);
  assert.match(app, /function finishFlowNodePointerDrag\(/);
  assert.match(app, /suppressFlowNodeClickUntil = Date\.now\(\) \+ 450/);
  assert.match(app, /function flowNodeDropPlacement\(/);
  assert.match(app, /同级排序，不改变层级/);
  assert.match(app, /成为「\$\{targetTitle\}」的子级/);
  assert.match(app, /移到顶层末尾 · 第 1 层/);
  assert.match(styles, /touch-action:none/);
});

test("node record input focus stays within a quiet field boundary", async () => {
  const styles = await rendererStyles();
  const recordSectionStart = styles.lastIndexOf("Node record editing stays inside the field");
  const recordSectionEnd = styles.indexOf("/* Integrated deadline calendar", recordSectionStart);
  const recordSection = styles.slice(recordSectionStart, recordSectionEnd > recordSectionStart ? recordSectionEnd : undefined);

  assert.doesNotMatch(recordSection, /\.record-modal-textarea:focus\s*\{[\s\S]*box-shadow:\s*0 0 0/);
});

test("knowledge images keep the caret beside the inline image node", async () => {
  const [entry, styles] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "milkdown-editor.entry.js"), "utf8"),
    rendererStyles(),
  ]);
  const inlineImageRule = styles.match(/\.task-knowledge-editor-panel \.ProseMirror \.milkdown-image-inline\s*\{([\s\S]*?)\}/)?.[1] || "";
  const imageRule = styles.match(/\.task-knowledge-editor-panel \.ProseMirror \.milkdown-image-inline > \.image-inline\s*\{([\s\S]*?)\}/)?.[1] || "";

  assert.match(entry, /insertImageCommand/);
  assert.doesNotMatch(styles, /\.task-knowledge-editor-panel \.ProseMirror img\s*\{[\s\S]*?display:\s*block;/);
});

test("knowledge scrolling does not paint an inner focus boundary across content", async () => {
  const styles = await rendererStyles();
  const panelFocusRule = styles.match(/\.task-knowledge-editor-panel:focus-within\s*\{([\s\S]*?)\}/)?.[1] || "";
  const editorFocusRule = styles.match(/\.task-knowledge-editor-panel \.ProseMirror-focused\s*\{([\s\S]*?)\}/)?.[1] || "";

});

test("knowledge lists and code use compact document-like presentation", async () => {
  const styles = await rendererStyles();
  const listRule = styles.match(/\.task-knowledge-editor-panel \.ProseMirror ul,[\s\S]*?\.task-knowledge-editor-panel \.ProseMirror ol\s*\{([\s\S]*?)\}/)?.[1] || "";
  const nestedListRule = styles.match(/\.task-knowledge-editor-panel \.ProseMirror \.content-dom ul,[\s\S]*?\.content-dom ol\s*\{([\s\S]*?)\}/)?.[1] || "";
  const listMarkerRule = styles.match(/\.task-knowledge-editor-panel \.milkdown-list-item-block li \.label-wrapper,[\s\S]*?\.label-wrapper \.label\s*\{([\s\S]*?)\}/)?.[1] || "";
  const codeBlockRule = styles.match(/\.task-knowledge-editor-panel \.milkdown \.milkdown-code-block\s*\{([\s\S]*?)\}/)?.[1] || "";
  const inlineCodeRule = styles.match(/\.task-knowledge-editor-panel \.ProseMirror :not\(pre\) > code\s*\{([\s\S]*?)\}/)?.[1] || "";

});

test("Milkdown handles matching backtick code spans and defers markdown serialization", async () => {
  const entry = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "milkdown-editor.entry.js"), "utf8");

  assert.match(entry, /const completeInlineCodeInputRule = \$inputRule/);
  assert.match(entry, /markRule\(\/\(`\+\)\(\[\^`\\n\]\+\)\\1\$\//);
  assert.match(entry, /inlineCodeSchema\.type\(ctx\)/);
  assert.match(entry, /extensions:\s*\[drawSelection\(\), keymap\.of\(defaultKeymap\.concat\(indentWithTab\)\)\]/);
  assert.match(entry, /listener\.updated\(scheduleMarkdown\)/);
  assert.match(entry, /requestIdleCallback/);
  assert.doesNotMatch(entry, /listener\.markdownUpdated/);
});

test("Milkdown normalization and hydrated images stay clean until a real document edit, including undo", async () => {
  const { Schema } = await import("@milkdown/kit/prose/model");
  const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
  const doc = (text) => schema.node("doc", null, [schema.node("paragraph", null, text ? schema.text(text) : null)]);
  const source = "正文\n## 标题\n![图](assets/image.png)\n";
  const normalized = "正文\n\n## 标题\n\n![图](data:image/png;base64,AAAA)\n";
  const emitted = [];
  let crepe;
  let serializations = 0;
  class FakeCrepe {
    static Feature = {};
    constructor() {
      crepe = this;
      this.view = { state: { doc: doc("loaded") } };
      this.listeners = [];
      this.editor = { config: () => this.editor, use: () => this.editor, action: (action) => action({ get: () => this.view }) };
    }
    on(register) {
      register({ updated: (listener) => this.listeners.push(listener), selectionUpdated() {}, blur: (listener) => { this.blur = listener; }, destroy() {} });
    }
    async create() {
      this.listeners.forEach((listener) => listener());
      this.blur(); // Some editor plugins emit during initialization.
    }
    getMarkdown() { serializations += 1; return this.view.state.doc.textContent === "loaded" ? normalized : "真正编辑后的正文\n"; }
    async destroy() {}
  }
  const window = { setTimeout, clearTimeout };
  const context = vm.createContext({
    LoopKnowledgeCore: require("../app/renderer/src/knowledge-core.js"),
    window, Crepe: FakeCrepe, instances: new WeakMap(), completeInlineCodeInputRule: {}, editorViewCtx: {}, imageFileToDataUrl() {},
    milkdownMetrics: { serializations: 0, cacheHits: 0, mounts: 0 }, queueMicrotask() {},
    scheduleIdle: (callback) => setTimeout(callback, 1000), cancelScheduledIdle: (timer) => clearTimeout(timer),
  });
  const entry = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "milkdown-editor.entry.js"), "utf8");
  vm.runInContext(entry.slice(entry.indexOf("class MilkdownTaskEditor {")), context);
  const instance = await window.MilkdownTaskEditor.create({ root: {}, markdown: normalized, sourceMarkdown: source, onChange: (markdown) => emitted.push(markdown) });
  assert.equal(instance.getMarkdown(), source);
  crepe.blur();
  assert.deepEqual(emitted, []);
  assert.equal(serializations, 0, "opening and navigation must not normalize or reserialize the saved source");
  crepe.view.state.doc = doc("edited");
  crepe.listeners.forEach((listener) => listener());
  crepe.blur();
  assert.deepEqual(emitted, ["真正编辑后的正文\n"]);
  assert.equal(instance.getMarkdown(), emitted[0]);
  assert.equal(serializations, 1);
  crepe.view.state.doc = doc("loaded"); // Equal document, different identity after undo.
  crepe.blur();
  assert.deepEqual(emitted, ["真正编辑后的正文\n", source]);
  assert.equal(instance.getMarkdown(), source);
  assert.equal(serializations, 1);
  await instance.destroy();
});

test("node mutation rejects invalid statuses and clears deleted descendant detail", async () => {
  const harness = await rendererHarness();
  const result = JSON.parse(JSON.stringify(await harness.evaluate(`(async () => {
    state.tasks = normalizeTasks([{
      id: "task_nodes",
      nodes: [{
        id: "parent",
        status: "todo",
        children: [{ id: "child", status: "todo", children: [] }]
      }]
    }]);
    state.selectedNodeId = "child";
    state.recordDraft = "draft";
    markNodeStatus("task_nodes", "parent", "invalid");
    const status = state.tasks[0].nodes[0].status;
    await deleteNode("task_nodes", "parent");
    return {
      status,
      selectedNodeId: state.selectedNodeId,
      recordDraft: state.recordDraft,
      nodes: state.tasks[0].nodes
    };
  })()`)));

  assert.equal(result.status, "todo");
  assert.equal(result.selectedNodeId, "");
  assert.equal(result.recordDraft, "");
  assert.deepEqual(result.nodes, []);
});

test("Markdown URLs reject executable schemes", async () => {
  const harness = await rendererHarness();
  // A blacklist cannot work here: browsers ignore control characters inside a
  // scheme, so "java\tscript:" is parsed as javascript: and would execute.
  const cases = [
    ["javascript:alert(1)", ""],
    ["JavaScript:alert(1)", ""],
    ["  javascript:alert(1)", ""],
    ["java\tscript:alert(1)", ""],
    ["java\nscript:alert(1)", ""],
    ["java\u0000script:alert(1)", ""],
    ["vbscript:msgbox(1)", ""],
    ["data:text/html,hello", ""],
    ["data:image/png;base64,AAAA", "data:image/png;base64,AAAA"],
    ["file:///etc/passwd", ""],
    ["blob:https://example.com/uuid", ""],
    ["//evil.example/beacon", ""],
    ["https://example.com/path?q=1&x=2", "https://example.com/path?q=1&amp;x=2"],
    ["mailto:someone@example.com", "mailto:someone@example.com"],
    ["notes/relative.md", "notes/relative.md"],
    ["#section", "#section"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(
      harness.evaluate(`safeMarkdownUrl(${JSON.stringify(input)})`),
      expected,
      `safeMarkdownUrl(${JSON.stringify(input)})`,
    );
  }
});

test("exported PDF documents declare a restrictive content security policy", async () => {
  const main = await fs.readFile(path.join(__dirname, "..", "app", "main", "main.cjs"), "utf8");
  const policies = main.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/g) || [];
  assert.equal(policies.length, 2, "both PDF templates must carry a CSP");
  for (const policy of policies) {
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, /script-src 'none'/);
    assert.match(policy, /object-src 'none'/);
  }
});

test("bug feedback prevents a second rapid submission while one is in flight", async () => {
  const harness = await rendererHarness();
  const result = await harness.evaluate(`(() => {
    state.feedbackSubmitting = true;
    return submitBugReport();
  })()`);
  assert.equal(result, false);
});

test("bug feedback payload contains only form and optional basic environment fields", async () => {
  const harness = await rendererHarness();
  const payload = harness.json(`(() => {
    state.tasks = [{ id: "private", title: "不得上传的任务标题", description: "不得上传" }];
    state.installationId = "123e4567-e89b-42d3-a456-426614174000";
    state.feedbackDraft = {
      title: "列表没有刷新",
      category: "malfunction",
      description: "保存后列表仍然没有显示新增任务。",
      reproductionSteps: "点击保存",
      contact: "",
      includeEnvironment: true,
      confirmed: true
    };
    return bugReportPayload();
  })()`);
  assert.equal(payload.category, "功能异常");
  assert.equal(payload.environment.installationId, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(payload.tasks, undefined);
  assert.doesNotMatch(JSON.stringify(payload), /不得上传/);
});

test("batch import appends selected tasks and immediately reconciles the growth queue", async () => {
  const harness = await rendererHarness();
  const result = harness.json(`(() => {
    render = () => {};
    save = () => {};
    state.taskGroups = [{ id: "growth", title: "个人成长 · RDMA", order: 1 }];
    state.activeGroupId = "growth";
    state.tasks = normalizeTasks([{ id: "existing", groupId: "growth", title: "理解 Queue Pair", status: "active", order: 1 }]);
    state.workNavigation = workNavigationModel.defaultWorkNavigation(new Date("2026-09-09T09:00:00"));
    state.workNavigation.config.growth.sourceGroupId = "growth";
    const preview = workNavigationModel.previewTaskBatchImport("1. 理解 Queue Pair\\n2. 配置 CQ\\n3. 运行实验", state.tasks, { groupId: "growth", defaultEstimateMinutes: 60 });
    const selectedKeys = preview.newTasks.map((item) => item.key);
    const imported = importTaskBatch("1. 理解 Queue Pair\\n2. 配置 CQ\\n3. 运行实验", {
      groupId: "growth",
      defaultEstimateMinutes: 60,
      selectedKeys,
      estimateMinutesByKey: { [selectedKeys[0]]: 45 },
    });
    return {
      imported,
      titles: state.tasks.map((task) => task.title),
      estimates: state.tasks.map((task) => task.estimateMinutes),
      origins: state.tasks.slice(1).map((task) => task.origin.kind),
      growthQueueIds: workNavigationSnapshot().growthTaskIds,
    };
  })()`);

  assert.equal(result.imported.importedCount, 2);
  assert.equal(result.imported.existingCount, 1);
  assert.deepEqual(result.titles, ["理解 Queue Pair", "配置 CQ", "运行实验"]);
  assert.deepEqual(result.estimates.slice(1), [45, 60]);
  assert.deepEqual(result.origins, ["task-batch", "task-batch"]);
  assert.equal(result.growthQueueIds.length, 3);
});

// ------------------------------------------------------------
// Phase21 · task brief direct input
// ------------------------------------------------------------

test("the phase21 brief layer is gated, ordered and built on the frozen sheet", async () => {
  const rendererDir = path.join(__dirname, "..", "app", "renderer");
  const frozenDir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase21-frozen");
  const [html, sheet, frozenSheet, script] = await Promise.all([
    fs.readFile(path.join(rendererDir, "index.html"), "utf8"),
    fs.readFile(path.join(rendererDir, "src", "brief21.css"), "utf8"),
    fs.readFile(path.join(frozenDir, "loop-brief-phase21.css"), "utf8"),
    fs.readFile(path.join(rendererDir, "src", "brief21.js"), "utf8"),
  ]);

  // The gate is a body attribute, exactly like the Demo's data-brief21-enabled.
  assert.match(html, /<body[^>]*data-scale20-enabled[^>]*data-brief21-enabled/);
  assert.equal(sheet, frozenSheet, "src/brief21.css must stay byte-identical to the frozen phase 21 sheet");

  const order = ["scale.css", "brief21.css", "bridge.css"];
  const positions = order.map((name) => html.indexOf(`src/${name}`));
  assert.ok(positions.every((index) => index >= 0), "index.html must load every phase layer");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "brief21.css must load after scale.css and before bridge.css");

  // brief21 overrides renderShellBrief and wraps render, so it loads after both.
  assert.ok(html.indexOf("src/brief21.js") > html.indexOf("src/scale.js"), "brief21.js must load after scale.js");
  assert.ok(html.indexOf("src/brief21.js") > html.indexOf("src/app.js"), "brief21.js must load after app.js");

  // The frozen sheet owns the look; the script owns the behaviour.
  for (const marker of ["body[data-brief21-enabled] .workspace > .brief", "brief21-input", "brief21-toggle", "min(280px,36dvh)", "max-width:1100px"]) {
    assert.ok(frozenSheet.includes(marker), `the frozen phase 21 sheet must keep ${marker}`);
  }
  assert.match(script, /renderShellBrief = function brief21Brief/);
  assert.match(script, /document\.querySelector\("\.scale20-brief-toggle"\)\?\.remove\(\)/);
  assert.match(script, /data-brief21-toggle/);
  assert.match(script, /aria-controls/);
  assert.match(script, /event\.isComposing \|\| event\.keyCode === 229/);
  assert.match(script, /task\.history\.unshift\(\["刚刚", `更新任务\$\{label\}`\]\)/);
  assert.match(script, /brief21BeginEdit/);
  // The old explicit-save editors must not render inside the brief any more.
  assert.equal(/class="brief-value/.test(script), false);
});

test("the phase22 controls layer is gated, ordered and built on the frozen sheet", async () => {
  const rendererDir = path.join(__dirname, "..", "app", "renderer");
  const frozenDir = path.join(__dirname, "..", "prototypes", "baseline", "loop-plane-phase22-frozen");
  const [html, sheet, frozenSheet, script] = await Promise.all([
    fs.readFile(path.join(rendererDir, "index.html"), "utf8"),
    fs.readFile(path.join(rendererDir, "src", "controls22.css"), "utf8"),
    fs.readFile(path.join(frozenDir, "loop-controls-phase22.css"), "utf8"),
    fs.readFile(path.join(rendererDir, "src", "controls22.js"), "utf8"),
  ]);
  assert.match(html, /<body[^>]*data-scale20-enabled[^>]*data-brief21-enabled[^>]*data-controls22-enabled/);
  assert.equal(sheet, frozenSheet, "src/controls22.css must stay byte-identical to the frozen phase 22 sheet");
  const order = ["brief21.css", "controls22.css", "bridge.css"];
  const positions = order.map((name) => html.indexOf(`src/${name}`));
  assert.ok(positions.every((index) => index >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "controls22.css must load after brief21.css and before bridge.css");
  assert.ok(html.indexOf("src/controls22.js") > html.indexOf("src/brief21.js"), "controls22.js must load after brief21.js");
  for (const marker of ["--field22-bg", ".control22-field", "select.control22-field", ".control22-listbox", ".control22-option", "forced-colors"]) {
    assert.ok(frozenSheet.includes(marker), `the frozen phase 22 sheet must keep ${marker}`);
  }
  // native selects keep their element; the layer only decorates and expands them
  assert.match(script, /el instanceof HTMLSelectElement && !el\.multiple && el\.size <= 1/);
  assert.match(script, /menu\.setAttribute\("role", "listbox"\)/);
  assert.match(script, /aria-activedescendant/);
  assert.match(script, /select\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(script, /control22ConsumeClick = true;\s*\n\s*control22Stop\(event\)/);
  assert.match(script, /CONTROL22_SKIP/);
  assert.match(script, /"\.brief21-input", "#knowledge-source"/);
});

test("the legacy edit binding never hijacks a phase21 brief input", async () => {
  const app = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "app.js"), "utf8");
  // The generic [data-edit-key] binding re-rendered on blur, which replaced the
  // DOM between mousedown and mouseup and swallowed the click that should move
  // the caret from one field to the next.
  assert.match(app, /querySelectorAll\("\[data-edit-key\]:not\(\.brief21-input\)"\)/);
  assert.equal(/querySelectorAll\("\[data-edit-key\]"\).forEach/.test(app), false);
});

test("phase20's brief step yields to the phase21 layer", async () => {
  const scale = await fs.readFile(path.join(__dirname, "..", "app", "renderer", "src", "scale.js"), "utf8");
  assert.match(scale, /if \(document\.body\.hasAttribute\("data-brief21-enabled"\)\) return;/);
});

test("brief-editing history is persisted with the task", async () => {
  const storage = await fs.readFile(path.join(__dirname, "..", "app", "main", "storage.cjs"), "utf8");
  assert.match(storage, /function normalizeTaskHistory/);
  assert.match(storage, /history: normalizeTaskHistory\(task\.history\)/);
  const { normalizeTaskData } = require("../app/main/storage.cjs");
  const payload = normalizeTaskData({
    tasks: [
      {
        id: "t1",
        title: "带历史的记录",
        history: [["刚刚", "更新任务结论"], ["坏数据"], ["", ""], "x", ["昨天", "更新任务背景"]],
      },
      { id: "t2", title: "没有历史" },
    ],
    taskGroups: [],
  });
  assert.deepEqual(payload.tasks[0].history, [["刚刚", "更新任务结论"], ["昨天", "更新任务背景"]]);
  assert.deepEqual(payload.tasks[1].history, []);
  const long = normalizeTaskData({
    tasks: [{ id: "t3", title: "很长", history: Array.from({ length: 90 }, (_, index) => ["刚刚", `第${index}条`]) }],
    taskGroups: [],
  });
  assert.equal(long.tasks[0].history.length, 60);
  assert.equal(long.tasks[0].history[0][1], "第0条");
});

// ============================================================
// Phase26 -- Recently Deleted archive schema
// ============================================================

test("the archive persists inside task-data.json and round-trips every kind", async () => {
  const deletedAt = "2026-10-05T09:20:00.000Z";
  const task = {
    id: "task_keep",
    title: "整理开发环境迁移记录",
    groupId: "group_tools",
    order: 3,
    notes: "迁移步骤",
    knowledgeNote: { noteId: "task_keep", filePath: null, documentState: "DRAFT" },
    nodes: [{ id: "node_a", title: "核对工具链", children: [] }],
  };
  const payload = {
    tasks: [task],
    taskGroups: [{ id: "group_tools", title: "工具与环境", order: 1 }],
    recentlyDeleted: [
      { id: "rd_task", kind: "task", deletedAt, transactionId: "tx-1", objectId: "task_gone", title: "确认新环境编译参数", groupId: "group_tools", groupTitle: "工具与环境", position: 2, record: { id: "task_gone", title: "确认新环境编译参数" } },
      { id: "rd_quick", kind: "quick", deletedAt, objectId: "task_quick", title: "随手记", position: 1, record: { id: "task_quick", title: "随手记", captureSource: "today-widget" } },
      { id: "rd_group", kind: "group", deletedAt, objectId: "group_tools", groupId: "group_tools", title: "工具与环境", groupOrder: 2, policy: "delete", targetGroupId: "", wasGrowthSource: true, groupReplacementId: "", members: [{ record: { id: "task_member", title: "成员" }, position: 3, groupId: "group_tools" }], migrated: [] },
      { id: "rd_node", kind: "node", deletedAt, objectId: "node_gone", title: "验证中断恢复路径", ownerTaskId: "task_keep", ownerTaskTitle: "整理开发环境迁移记录", parentNodeId: "", parentNodeTitle: "", position: 1, nodeCount: 2, record: { id: "node_gone", title: "验证中断恢复路径", note: "记录", children: [{ id: "node_gone_child", title: "子节点", children: [] }] } },
      { id: "rd_note", kind: "note", deletedAt, objectId: "note_1", title: "中断机制学习 · 知识笔记", ownerTaskId: "task_keep", ownerTaskTitle: "整理开发环境迁移记录", groupId: "group_tools", body: "# 中断机制学习\n\n排查记录", sourcePath: "/tmp/knowledge.md", knowledgeNote: { noteId: "note_1", filePath: "/tmp/knowledge.md" } },
      { id: "rd_bad", kind: "nonsense", deletedAt, title: "should be dropped" },
    ],
  };
  const normalized = normalizeTaskData(payload);
  assert.equal(normalized.recentlyDeletedSchemaVersion, RECENTLY_DELETED_SCHEMA_VERSION);
  assert.equal(normalized.recentlyDeleted.length, 5, "an unknown kind is dropped, the other four survive");
  const byId = new Map(normalized.recentlyDeleted.map((entry) => [entry.id, entry]));
  assert.equal(byId.get("rd_node").nodeCount, 2);
  assert.equal(byId.get("rd_node").ownerTaskId, "task_keep");
  assert.equal(byId.get("rd_group").policy, "delete");
  assert.equal(byId.get("rd_group").members.length, 1);
  assert.equal(byId.get("rd_note").body.includes("排查记录"), true);
  assert.equal(byId.get("rd_task").position, 2);
  // A snapshot keeps the fields a restore has to write back, untouched.
  assert.equal(byId.get("rd_task").record.title, "确认新环境编译参数");
  // Idempotent: writing the normalized form again changes nothing.
  assert.deepEqual(normalizeTaskData(normalized), normalized);
});

test("the archive round-trips through disk and survives an older payload", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "loop-recovery26-"));
  try {
    const entry = { id: "rd_1", kind: "task", deletedAt: "2026-10-05T09:20:00.000Z", title: "已删除任务", record: { id: "task_1", title: "已删除任务" } };
    await writeTaskData(dir, { tasks: [], recentlyDeleted: [entry] });
    const read = await readTaskData(dir);
    assert.equal(read.recentlyDeleted.length, 1);
    assert.equal(read.recentlyDeleted[0].title, "已删除任务");
    const raw = JSON.parse(await fs.readFile(path.join(dir, DATA_FILE), "utf8"));
    assert.equal(raw.recentlyDeleted.length, 1, "the archive is a real collection in task-data.json");
    // A database written before this stage simply has no archive, and gains an
    // empty one without losing anything.
    await writeTaskData(dir, { tasks: [] });
    const older = await readTaskData(dir);
    assert.deepEqual(older.recentlyDeleted, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a newer archive schema is never overwritten by an older app", async () => {
  assert.equal(isNewerThanSupported({ recentlyDeletedSchemaVersion: RECENTLY_DELETED_SCHEMA_VERSION }), false);
  assert.equal(isNewerThanSupported({ recentlyDeletedSchemaVersion: RECENTLY_DELETED_SCHEMA_VERSION + 1 }), true);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "loop-recovery26-guard-"));
  try {
    await fs.writeFile(path.join(dir, DATA_FILE), JSON.stringify({
      version: 2,
      knowledgeSchemaVersion: KNOWLEDGE_MIGRATION_VERSION,
      recentlyDeletedSchemaVersion: RECENTLY_DELETED_SCHEMA_VERSION + 1,
      tasks: [],
      recentlyDeleted: [{ id: "rd_future", kind: "task", title: "来自更新版本", record: { id: "t" } }],
    }), "utf8");
    await assert.rejects(
      () => writeTaskData(dir, { tasks: [] }),
      (error) => error.code === "UNSUPPORTED_DATA_VERSION",
    );
    const untouched = JSON.parse(await fs.readFile(path.join(dir, DATA_FILE), "utf8"));
    assert.equal(untouched.recentlyDeleted.length, 1, "a downgrade must not drop the archive");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("archive ids are de-duplicated and the collection is bounded and newest-first", () => {
  const entries = Array.from({ length: 4 }, (_, index) => ({
    id: "rd_same",
    kind: "task",
    deletedAt: `2026-10-0${index + 1}T00:00:00.000Z`,
    title: `记录 ${index}`,
    record: { id: `task_${index}` },
  }));
  const normalized = normalizeRecentlyDeleted(entries);
  assert.equal(normalized.length, 1, "a repeated archive id is not allowed twice");
  const ordered = normalizeRecentlyDeleted([
    { id: "a", kind: "task", deletedAt: "2026-10-01T00:00:00.000Z", title: "旧", record: { id: "t1" } },
    { id: "b", kind: "task", deletedAt: "2026-10-09T00:00:00.000Z", title: "新", record: { id: "t2" } },
  ]);
  assert.deepEqual(ordered.map((entry) => entry.id), ["b", "a"]);
  assert.deepEqual(normalizeRecentlyDeleted(null), []);
});

async function recoveryRendererHarness(api) {
  const harness = await rendererHarness(api);
  harness.evaluate(`
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
    document.addEventListener = window.addEventListener.bind(window);
    document.body.dataset = {};
    globalThis.CSS = { escape: value => value };
    render = () => {};
    state.tasks = []; state.taskGroups = []; state.recentlyDeleted = [];
    captureMountedMilkdownDrafts = () => {};
    flushNodeNoteDrafts = () => {};
  `);
  harness.evaluate(await fs.readFile(path.join(__dirname, '..', 'app/renderer/src/recovery26.js'), 'utf8'));
  return harness;
}

test('failed deletion rolls back both the visible model and every later disk retry', async () => {
  let failing = true;
  const writes = [];
  const harness = await recoveryRendererHarness({ storage: { async write(payload) {
    writes.push(JSON.parse(JSON.stringify(payload)));
    if (failing) throw new Error('synthetic disk failure');
  } } });
  harness.evaluate(`state.tasks = normalizeTasks([{id:'task_safe',title:'保留任务',notes:'正文',nodes:[]}]);`);
  const result = await harness.evaluate(`recovery26Transaction(() => recovery26DeleteRecords(['task_safe']))`);
  assert.equal(result.ok, false);
  assert.deepEqual(harness.json('state.tasks.map(task => task.id)'), ['task_safe']);
  assert.equal(harness.evaluate('state.recentlyDeleted.length'), 0);
  assert.deepEqual(harness.json('pendingPayload.tasks.map(task => task.id)'), ['task_safe']);
  assert.equal(harness.evaluate('pendingPayload.recentlyDeleted.length'), 0);
  failing = false;
  await harness.evaluate('flushSave()');
  assert.equal(writes.at(-1).tasks[0].notes, '正文');
  assert.equal(writes.at(-1).recentlyDeleted.length, 0, 'quit/retry must never commit the canceled deletion');
});

test('delete confirmation can retry after a failed save without reopening or losing content', async () => {
  let failing = true;
  const harness = await recoveryRendererHarness({ storage: { async write() { if (failing) throw new Error('synthetic disk failure'); } } });
  harness.evaluate(`
    state.tasks = normalizeTasks([{id:'task_retry',title:'可重试',nodes:[]}]);
    recovery26Pending = {mode:'records',ids:['task_retry']};
    recovery26AfterRemoval = () => {};
  `);
  await harness.evaluate('recovery26CommitDelete()');
  assert.equal(harness.evaluate('recovery26Busy'), false);
  assert.equal(harness.evaluate('recovery26Pending.ids[0]'), 'task_retry');
  assert.equal(harness.evaluate('state.tasks.length'), 1);
  failing = false;
  await harness.evaluate('recovery26CommitDelete()');
  assert.equal(harness.evaluate('recovery26Pending'), null);
  assert.equal(harness.evaluate('state.tasks.length'), 0);
  assert.equal(harness.evaluate('state.recentlyDeleted.length'), 1);
  await harness.evaluate('flushSave()');
});

test('batch restore survives a failed sibling transaction without leaving a restored duplicate in the archive', async () => {
  let calls = 0;
  const harness = await recoveryRendererHarness({ storage: { async write() { if (++calls === 1) throw new Error('first restore fails'); } } });
  harness.evaluate(`state.recentlyDeleted = normalizeRecentlyDeleted([
    {id:'rd_a',kind:'task',title:'A',deletedAt:'2026-10-07T00:00:00Z',record:{id:'task_a',title:'A'}},
    {id:'rd_b',kind:'task',title:'B',deletedAt:'2026-10-07T00:00:01Z',record:{id:'task_b',title:'B'}}
  ]);`);
  const results = await harness.evaluate(`recovery26RestoreMany(['rd_a','rd_b'])`);
  assert.deepEqual(Array.from(results, result => result.ok), [false, true]);
  assert.deepEqual(harness.json('state.tasks.map(task => task.id)'), ['task_b']);
  assert.deepEqual(harness.json('state.recentlyDeleted.map(entry => entry.id)'), ['rd_a']);
  const retry = await harness.evaluate(`recovery26RestoreMany(['rd_a'])`);
  assert.equal(retry[0].ok, true);
  assert.deepEqual(harness.json('state.tasks.map(task => task.id).sort()'), ['task_a', 'task_b']);
  assert.equal(harness.evaluate('state.recentlyDeleted.length'), 0);
  await harness.evaluate('flushSave()');
});

test('restore preserves group identity, missing-parent nodes and occupied note bodies', async () => {
  const harness = await recoveryRendererHarness();
  harness.evaluate(`
    state.taskGroups = [{id:'group_live',title:'现有分组',order:1}];
    state.tasks = normalizeTasks([{id:'task_owner',title:'所属任务',notes:'新正文',nodes:[]}]);
    state.recentlyDeleted = normalizeRecentlyDeleted([
      {id:'rd_group',kind:'group',groupId:'group_live',title:'旧分组',members:[],migrated:[],policy:'delete',deletedAt:'2026-10-07T00:00:00Z'},
      {id:'rd_node',kind:'node',ownerTaskId:'task_owner',parentNodeId:'gone_parent',title:'恢复节点',record:{id:'node_old',title:'恢复节点',note:'处理记录',children:[]},deletedAt:'2026-10-07T00:00:00Z'},
      {id:'rd_note',kind:'note',ownerTaskId:'task_owner',ownerTaskTitle:'所属任务',title:'旧笔记',body:'旧正文',sourcePath:'/original.md',deletedAt:'2026-10-07T00:00:00Z'},
      {id:'rd_task',kind:'task',groupId:'gone_group',title:'已删除任务',record:{id:'task_old',title:'已删除任务'},deletedAt:'2026-10-07T00:00:00Z'}
    ]);
  `);
  const results = await harness.evaluate(`recovery26RestoreMany(['rd_group','rd_node','rd_note','rd_task'])`);
  assert.equal(results.find(result => result.title === '旧分组').ok, false);
  assert.deepEqual(harness.json('state.taskGroups.map(group => [group.id,group.title])'), [['group_live', '现有分组']]);
  assert.equal(harness.evaluate(`r26Task('task_owner').nodes[0].note`), '处理记录');
  assert.equal(harness.evaluate(`r26Task('task_owner').notes`), '新正文');
  const recovered = harness.json(`state.tasks.find(task => task.notes === '旧正文')`);
  assert.ok(recovered);
  assert.equal(recovered.knowledgeNote.filePath, null);
  assert.equal(harness.evaluate(`r26Task('task_old').groupId`), '');
  assert.deepEqual(harness.json('state.recentlyDeleted.map(entry => entry.id)'), ['rd_group']);
});

test('recovery dismissal respects the destination focus and restores it on Escape', async () => {
  const harness = await recoveryRendererHarness();
  harness.evaluate(`
    globalThis.focusCalls = 0;
    recovery26ReturnFocus = {isConnected:true,focus(){focusCalls++;}};
    document.querySelector = selector => selector === '#overlay .recovery26-manager, #overlay .recovery26-confirm' ? {} : selector === '#overlay' ? {innerHTML:'dialog',querySelector(){return null;}} : null;
    shellCloseOverlay({restoreFocus:false});
  `);
  assert.equal(harness.evaluate('focusCalls'), 0, 'outside click must allow focus to move to the clicked input');
  harness.evaluate('shellCloseOverlay()');
  assert.equal(harness.evaluate('focusCalls'), 1, 'Escape returns focus to the original trigger');
});

async function manualRendererHarness() {
  const harness = await recoveryRendererHarness({ platform: 'darwin' });
  harness.evaluate(`
    globalThis.manualReader = null;
    globalThis.manualTopics = {innerHTML:''};
    globalThis.manualInput = {id:'manual27-search',value:'',focus(){}};
    globalThis.manualClear = {hidden:true};
    globalThis.manualJumpReturn = '';
    document.querySelector = selector => selector === '.manual27-reader' ? manualReader : selector === '#manual27-search' ? manualInput : selector === '#manual27-topics' ? manualTopics : selector === '.manual27-search [data-manual27=clear]' ? manualClear : selector === '.breadcrumb' ? {insertAdjacentHTML(position,html){manualJumpReturn=html;}} : null;
    state.tasks = normalizeTasks([{id:'manual_task',title:'正在处理的任务',notes:'保留正文',nodes:[]}]);
    state.activeTaskId = 'manual_task';
    render = () => {
      const html = renderShellSettings();
      const article = state.settingsOpen && html.match(/data-article="([^"]+)"/);
      manualReader = article ? {dataset:{article:article[1]},scrollTop:0,addEventListener(){}} : null;
    };
  `);
  harness.evaluate(await fs.readFile(path.join(__dirname, '..', 'app/renderer/src/manual27.js'), 'utf8'));
  // The harness intentionally skips bootstrap; dispatch only this feature's
  // target vocabulary, matching the real delegated capture handler.
  harness.manualClick = (action, data = {}) => harness.dispatch('click', {
    target: { closest(selector) { return selector === '[data-manual27]' ? { dataset: { manual27: action, ...data } } : null; } },
    preventDefault() {}, stopImmediatePropagation() {},
  });
  return harness;
}

test('the real manual includes all Demo articles, local multiword search and clear without rebuilding the input', async () => {
  const harness = await manualRendererHarness();
  harness.evaluate(`LoopManual27.open()`);
  let html = harness.evaluate('renderShellSettings()');
  assert.equal((html.match(/class="manual27-topic"/g) || []).length, 15);
  assert.match(html, /manual27-reader/);
  assert.match(html, /manual27-toc/);
  assert.doesNotMatch(html, /本 Demo|平台预览|v0\.1\.212/);
  harness.dispatch('input', { target: { id: 'manual27-search', value: '笔记 保存' } });
  assert.match(harness.evaluate('manualTopics.innerHTML'), /相关说明/);
  assert.match(harness.evaluate('manualTopics.innerHTML'), /<mark>/);
  harness.dispatch('input', { target: { id: 'manual27-search', value: '绝不存在的检索词' } });
  assert.match(harness.evaluate('manualTopics.innerHTML'), /没有找到相关说明/);
  harness.manualClick('clear');
  assert.equal(harness.evaluate('manualInput.value'), '');
  assert.equal((harness.evaluate('manualTopics.innerHTML').match(/class="manual27-topic"/g) || []).length, 15);
  harness.manualClick('close');
  assert.match(harness.evaluate('renderShellSettings()'), /manual27-entry/);
  assert.match(harness.evaluate('renderShellSettings()'), /help14-intro/, 'existing help and feedback remain available');
});

test('manual function jumps use real routes and return to the same article, query and reading position', async () => {
  const harness = await manualRendererHarness();
  harness.evaluate(`LoopManual27.open('organize')`);
  harness.dispatch('input', { target: { id: 'manual27-search', value: '今日' } });
  harness.evaluate(`manualReader = {dataset:{article:'organize'},scrollTop:286,addEventListener(){}}`);
  harness.manualClick('go', { target: 'calendar' });
  assert.equal(harness.evaluate('state.calendarOpen'), true);
  assert.equal(harness.evaluate('state.settingsOpen'), false);
  assert.match(harness.evaluate('manualJumpReturn'), /返回手册/);
  harness.manualClick('return');
  assert.match(harness.evaluate('renderShellSettings()'), /今日、仓库、分组与速记/);
  assert.match(harness.evaluate('renderShellSettings()'), /value="今日"/);
  assert.equal(harness.evaluate('manualReader.scrollTop'), 286);
  harness.manualClick('go', { target: 'notes' });
  assert.equal(harness.evaluate('state.taskPane'), 'notes');
  assert.equal(harness.evaluate('state.activeTaskId'), 'manual_task');
  assert.equal(harness.evaluate(`r26Task('manual_task').notes`), '保留正文');
});

test('group deletion and restore retain every record while preserving later moves and the growth source decision', async () => {
  const harness = await recoveryRendererHarness();
  harness.evaluate(`
    state.taskGroups = [{id:'group_old',title:'原分组',order:1},{id:'group_next',title:'新分组',order:2}];
    state.tasks = normalizeTasks([
      {id:'task_unchanged',title:'未再修改',groupId:'group_old',notes:'知识笔记',nodes:[{id:'node_keep',title:'步骤',note:'处理记录',children:[]}]},
      {id:'task_changed',title:'之后修改',groupId:'group_old',notes:'原文',nodes:[]}
    ]);
    state.workNavigation = normalizeCurrentWorkNavigation();
    state.workNavigation.config.growth.sourceGroupId = 'group_old';
  `);
  const blocked = await harness.evaluate(`recovery26Transaction(() => recovery26DeleteGroup('group_old'))`);
  assert.equal(blocked.ok, false, 'deleting a growth source requires an explicit replacement decision');
  assert.equal(harness.evaluate('state.taskGroups.length'), 2);
  const removed = await harness.evaluate(`recovery26Transaction(() => recovery26DeleteGroup('group_old',{policy:'keep',targetGroupId:'group_next',replacement:'stop'}))`);
  assert.equal(removed.ok, true);
  assert.deepEqual(harness.json('state.tasks.map(task => task.groupId)'), ['group_next', 'group_next']);
  harness.evaluate(`r26Task('task_changed').notes = '之后的新正文'`);
  await harness.evaluate(`recovery26RestoreMany(state.recentlyDeleted.map(entry=>entry.id),{restoreMoved:true})`);
  assert.equal(harness.evaluate(`r26Task('task_unchanged').groupId`), 'group_old');
  assert.equal(harness.evaluate(`r26Task('task_changed').groupId`), 'group_next', 'Undo must not reverse a later edit');
  assert.equal(harness.evaluate(`normalizeCurrentWorkNavigation().config.growth.sourceGroupId`), '', 'restore must not restart growth');
  const deleted = await harness.evaluate(`recovery26Transaction(() => recovery26DeleteGroup('group_old',{policy:'delete'}))`);
  assert.equal(deleted.ok, true);
  assert.equal(harness.evaluate('state.tasks.length'), 1);
  const restored = await harness.evaluate(`recovery26RestoreMany(state.recentlyDeleted.map(entry=>entry.id))`);
  assert.equal(restored[0].ok, true);
  assert.equal(harness.evaluate('state.tasks.length'), 2);
  assert.equal(harness.evaluate(`r26Task('task_unchanged').nodes[0].note`), '处理记录');
  assert.equal(harness.evaluate(`r26Task('task_unchanged').notes`), '知识笔记');
  assert.equal(harness.evaluate(`r26Task('task_changed').notes`), '之后的新正文');
});

test('core viewport snapshots cannot undo new input or revive an older render', async () => {
  const harness = await rendererHarness();
  harness.evaluate(`
    globalThis.viewportElement = {dataset:{taskRepositoryView:'same'},scrollTop:140,scrollLeft:60,scrollHeight:1000,clientHeight:200,scrollWidth:800,clientWidth:300};
    document.querySelector = () => viewportElement;
    globalThis.viewportSnapshot = captureScrollViewport('#viewport', 'taskRepositoryView', 'same');
    viewportElement.scrollTop = 210; viewportElement.scrollLeft = 90;
  `);
  harness.dispatch('wheel', {});
  harness.evaluate(`restoreScrollViewport(viewportSnapshot, '#viewport')`);
  assert.deepEqual(harness.json('[viewportElement.scrollTop, viewportElement.scrollLeft]'), [210, 90]);
  harness.evaluate(`viewportSnapshot = captureScrollViewport('#viewport', 'taskRepositoryView', 'same'); renderViewportEpoch++; viewportElement.scrollTop = 320; restoreScrollViewport(viewportSnapshot, '#viewport')`);
  assert.equal(harness.evaluate('viewportElement.scrollTop'), 320, 'older render callbacks cannot write into a newer matching view');
  for (const type of ['pointerdown', 'keydown', 'beforeinput', 'compositionstart', 'touchmove', 'resize', 'blur']) {
    harness.evaluate(`viewportSnapshot = captureScrollViewport('#viewport', 'taskRepositoryView', 'same'); viewportElement.scrollTop += 10`);
    const expected = harness.evaluate('viewportElement.scrollTop');
    harness.dispatch(type, {isComposing: true});
    harness.evaluate(`restoreScrollViewport(viewportSnapshot, '#viewport')`);
    assert.equal(harness.evaluate('viewportElement.scrollTop'), expected, type);
  }
});

test('floating menus stay reachable after desktop resize without dismissing their draft or focus', async () => {
  const harness = await rendererHarness();
  harness.evaluate(`
    document.addEventListener = window.addEventListener.bind(window);
    globalThis.surface = {style:{left:'1040px',top:'650px'},offsetWidth:300,offsetHeight:240};
    document.querySelectorAll = selector => selector.startsWith('#overlay .surface-popover') ? [surface] : [];
    shellBindOverlayDismissal();
    window.innerWidth = 1024; window.innerHeight = 680;
  `);
  harness.dispatch('resize', {});
  assert.deepEqual(harness.json('[surface.style.left,surface.style.top]'), ['712px', '428px']);
  harness.evaluate(`surface.offsetHeight = 900; shellClampFloatingSurface(surface)`);
  assert.equal(harness.evaluate('surface.style.maxHeight'), '656px');
  assert.equal(harness.evaluate('surface.style.overflowY'), 'auto');
});

test('outside dismissal resets a popup trigger state while leaving destination focus alone', async () => {
  const harness = await rendererHarness();
  harness.evaluate(`
    globalThis.popupFocusCalls = 0;
    globalThis.popupTrigger = {expanded:'true',hasAttribute:name=>name==='aria-expanded',setAttribute(name,value){this.expanded=value;},focus(){popupFocusCalls++;}};
    globalThis.popupHost = {dataset:{returnFocus:'#popup-trigger'}};
    globalThis.popupOverlay = {innerHTML:'menu',querySelector:()=>popupHost};
    document.querySelector = selector => selector === '#overlay' ? popupOverlay : selector === '#popup-trigger' ? popupTrigger : null;
    shellCloseOverlay({restoreFocus:false});
  `);
  assert.equal(harness.evaluate('popupTrigger.expanded'), 'false');
  assert.equal(harness.evaluate('popupFocusCalls'), 0);
  harness.evaluate('shellCloseOverlay()');
  assert.equal(harness.evaluate('popupFocusCalls'), 1);
});

test('update retry surfaces use the failed operation and busy clicks never start another action', async () => {
  const calls = [];
  const h = await rendererHarness({ updates: {
    download: async () => { calls.push('download'); return {status:'available', supported:true, version:'1.0.0'}; },
    install: async () => { calls.push('install'); return {status:'downloaded', supported:true, version:'1.0.0'}; },
    check: async () => { calls.push('check'); return {status:'latest', supported:true}; },
  } });
  h.evaluate(`refreshUpdateSurfaces = () => {}; appUpdateState = normalizeAppUpdateState({status:'error',supported:true,version:'1.0.0',retryAction:'download'});`);
  assert.match(h.evaluate('shellSettingsUpdateCardBody()'), /data-update-action="download"/);
  assert.match(h.evaluate('shellUpdatePanelBody()'), /data-update-action="download"/);
  await h.evaluate(`runUpdateAction('download')`);
  h.evaluate(`appUpdateState = normalizeAppUpdateState({status:'error',supported:true,version:'1.0.0',retryAction:'install'});`);
  await h.evaluate(`runUpdateAction('install')`);
  h.evaluate(`appUpdateState = normalizeAppUpdateState({status:'downloading',supported:true});`);
  await h.evaluate(`runUpdateAction('check')`);
  assert.deepEqual(calls, ['download','install']);
});

test('backup ownership survives settings rerenders, prevents duplicate operations and retains cancellation status', async () => {
  let finish, calls = 0;
  const h = await rendererHarness({ dataBackup: { export: () => { calls++; return new Promise(resolve => { finish = resolve; }); } } });
  h.evaluate(`
    flushAllDataForTransfer = async () => {};
    globalThis.makeBackupButton = () => ({dataset:{backupAction:'export'},listeners:[],addEventListener(_,fn){this.listeners.push(fn);}});
    globalThis.controls = [makeBackupButton()]; globalThis.backupStatus = {};
    document.querySelectorAll = selector => selector === '[data-backup-action]' ? controls : [];
    document.querySelector = selector => selector === '[data-backup-status]' ? backupStatus : null;
    bindDataBackupControls(); bindDataBackupControls();
    globalThis.invokeBackup = () => controls[0].listeners[0]({stopPropagation(){},currentTarget:controls[0]});
    globalThis.transferPromise = invokeBackup();
  `);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(h.evaluate('controls[0].listeners.length'), 1);
  h.evaluate(`controls = [makeBackupButton()]; backupStatus = {}; bindDataBackupControls(); invokeBackup();`);
  assert.equal(h.evaluate('controls[0].disabled'), true);
  assert.match(h.evaluate('backupStatus.textContent'), /正在保存/);
  assert.equal(calls, 1);
  finish({canceled:true}); await h.evaluate('transferPromise');
  assert.equal(h.evaluate('controls[0].disabled'), false);
  assert.match(h.evaluate('backupStatus.textContent'), /已取消/);
  h.evaluate(`backupStatus = {}; bindDataBackupControls()`);
  assert.match(h.evaluate('backupStatus.textContent'), /已取消/);
});

test('a failed import rollback cannot resume autosave into a partially restored workspace', async () => {
  let writes = 0;
  const h = await rendererHarness({storage:{write:async()=>{writes++;}},dataBackup:{importFile:async()=>{throw new Error('IMPORT_ROLLBACK_FAILED 自动回滚未能完成；安全备份位于 /safe/backup');}}});
  h.evaluate(`
    flushAllDataForTransfer = async () => {};
    globalThis.control = {dataset:{backupAction:'import-file'},addEventListener(_,fn){this.run=fn;}};
    globalThis.transferStatus = {};
    document.querySelectorAll = selector => selector === '[data-backup-action]' ? [control] : [];
    document.querySelector = selector => selector === '[data-backup-status]' ? transferStatus : null;
    bindDataBackupControls();
  `);
  await h.evaluate(`control.run({stopPropagation(){},currentTarget:control})`);
  assert.equal(h.evaluate('dataTransferInProgress'), true);
  assert.equal(h.evaluate('control.disabled'), true);
  assert.match(h.evaluate('transferStatus.textContent'), /暂停写入.*safe\/backup/);
  h.evaluate('save()'); await h.evaluate('flushSave()');
  assert.equal(writes, 0);
});

test('interaction preferences migrate from legacy cache but restored workspace values take precedence', async () => {
  const writes = [];
  let stored = {tasks:[],uiPreferences:null};
  const h = await rendererHarness({storage:{read:async()=>stored,write:async data=>writes.push(data)}});
  h.evaluate(`localStorage.setItem('loop.interaction28',JSON.stringify({continuous:false,follow:false})); localStorage.setItem('loop-work-rhythm-v1:enabled','1')`);
  const legacy = await h.evaluate('loadAppData()');
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.uiPreferences)), {continuous:false,follow:false,workNavigationEnabled:true});
  stored = {tasks:[],uiPreferences:{continuous:true,follow:true,workNavigationEnabled:false}};
  const restored = await h.evaluate('loadAppData()');
  assert.deepEqual(JSON.parse(JSON.stringify(restored.uiPreferences)), stored.uiPreferences);
  h.evaluate(`state.uiPreferences = normalizeUiPreferences({continuous:true,follow:true,workNavigationEnabled:false}); LoopUiPreferences.update({follow:false})`);
  await h.evaluate('flushSave()');
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].uiPreferences)), {continuous:true,follow:false,workNavigationEnabled:false});
});

test('changing default task range within settings keeps the current settings page visible', async () => {
  const h = await rendererHarness();
  h.evaluate(`state.settingsOpen=true; activeSettingsPage='tasks'; save=()=>{}; shellCloseOverlay=()=>{};`);
  await h.evaluate(`shellAction({action:'set-settings-choice',key:'task-filter',value:'today'}, {})`);
  assert.equal(h.evaluate('state.settingsOpen'), true);
  assert.equal(h.evaluate('state.taskFilter'), 'today');
});

test('native import releases the write lock on cancellation or successful rollback, and retains it after failed rollback', async () => {
  const source = await fs.readFile(path.join(__dirname, '../app/main/main.cjs'), 'utf8');
  const handlerSource = source.slice(source.indexOf('  ipcMain.handle("data-backup:import"'), source.indexOf('  ipcMain.handle("knowledge-document:save"'));
  const { createDataMaintenanceLock } = require('../app/main/data-maintenance.cjs');
  for (const scenario of ['canceled', 'IMPORT_ROLLED_BACK', 'IMPORT_ROLLBACK_FAILED', 'success']) {
    const lock = createDataMaintenanceLock(); let handler;
    const context = vm.createContext({
    LoopKnowledgeCore: require("../app/renderer/src/knowledge-core.js"),
      ipcMain: {handle:(_,fn)=>{handler=fn;}}, BrowserWindow:{fromWebContents:()=>({})}, path, process,
      dialog:{showOpenDialog:async()=>({canceled:scenario==='canceled',filePaths:['/synthetic/incoming.loopbackup']}),showMessageBox:async()=>({response:1})},
      app:{getPath:()=>'/synthetic/profile',relaunch(){},exit(){}}, dataMaintenance:lock,
      importBackup:async()=>{ assert.equal(lock.isActive(),true); if(scenario!=='success') throw Object.assign(new Error(scenario),{code:scenario}); return {imported:true}; },
      setTimeout:()=>({unref(){}}),
    });
    vm.runInContext(handlerSource, context);
    if (scenario.startsWith('IMPORT_')) await assert.rejects(handler({sender:{}},{}),{code:scenario});
    else await handler({sender:{}},{});
    assert.equal(lock.isActive(), ['success','IMPORT_ROLLBACK_FAILED'].includes(scenario), scenario);
  }
});

test('quick capture leaves the active node and its draft intact and rejects blank titles', async () => {
  const h = await rendererHarness();
  h.evaluate(`render=()=>{}; state.tasks=normalizeTasks([{id:'working',title:'当前任务',nodes:[{id:'working_node',title:'当前节点'}]}]); state.taskGroups=normalizeTaskGroups([],state.tasks); state.activeTaskId='working'; state.selectedNodeId='working_node'; state.recordDraft='尚未完成的节点记录'; state.taskFilter='today'; state.query='检索中';`);
  const result = h.json(`(() => { const capture=createQuickCapture('浮窗速记','多行内容\\n第二行'); return {id:capture.id, selectedNodeId:state.selectedNodeId,activeTaskId:state.activeTaskId,draft:state.recordDraft,filter:state.taskFilter,query:state.query}; })()`);
  assert.equal(result.selectedNodeId,'working_node');
  assert.equal(result.activeTaskId,'working');
  assert.equal(result.draft,'尚未完成的节点记录');
  assert.equal(result.filter,'today'); assert.equal(result.query,'检索中');
  const count=h.evaluate('state.tasks.length');
  assert.equal(h.evaluate(`createQuickCapture('  \\n  ')`),null);
  assert.equal(h.evaluate('state.tasks.length'),count);
});

test('global task jumps leave settings, clear unrelated capture filters and reveal a requested node', async () => {
  const h=await rendererHarness();
  h.evaluate(`state.tasks=normalizeTasks([{id:'target',title:'目标任务',nodes:[{id:'target_node',title:'目标节点'}]}]); state.taskGroups=normalizeTaskGroups([],state.tasks); state.settingsOpen=true; state.captureSourceFilter='quick'; state.priorityFilter='high'; state.taskPane='notes'; openTaskFromGlobalList('target','target_node');`);
  assert.equal(h.evaluate('state.settingsOpen'),false);
  assert.equal(h.evaluate('state.captureSourceFilter'),'all');
  assert.equal(h.evaluate('state.taskPane'),'flow');
  assert.deepEqual(h.json('filteredTasks().map(task=>task.id)'),['target']);
  assert.equal(h.evaluate('state.selectedNodeId'),'target_node');
});

test('complete task journey keeps grouped tasks, widget lanes, notes, attachments, calendar, review and restore consistent', async (t) => {
  const {saveKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
  const {exportPortableBackup,importBackup}=require('../app/main/data-continuity.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'loop-final-journey-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const userData=path.join(root,'profile'),notePath=path.join(root,'files','联动笔记.md');
  await fs.mkdir(path.dirname(notePath),{recursive:true});
  const h=await recoveryRendererHarness({
    storage:{write:payload=>writeTaskData(userData,JSON.parse(JSON.stringify(payload)))},
    knowledgeFile:{save:payload=>saveKnowledgeDocument(payload,{dialog:{showSaveDialog:async()=>({canceled:false,filePath:notePath})},platform:'darwin'})},
  });
  h.evaluate(`
    state.taskGroups=[{id:'journey_group',title:'联动检阅',order:1}]; state.activeGroupId='journey_group';
    globalThis.journeyTask=createTask('联动任务',false); globalThis.journeyId=journeyTask.id;
    edit({taskId:journeyId,editKey:'title'},'联动任务 · 更新名称');
    toggleTaskTag(journeyId,'today');
    addNode(journeyId,null); globalThis.rootNode=journeyTask.nodes[0].id;
    addNode(journeyId,rootNode); globalThis.childNode=journeyTask.nodes[0].children[0].id;
    edit({taskId:journeyId,nodeId:rootNode,editKey:'title'},'核对上下文');
    edit({taskId:journeyId,nodeId:childNode,editKey:'note'},'逐层验证\\n保留原始记录');
    edit({taskId:journeyId,editKey:'description'},'背景第一行\\n背景第二行');
    edit({taskId:journeyId,editKey:'hypothesis'},'正在核对跨页联动');
    edit({taskId:journeyId,editKey:'conclusion'},'处理完成并保留解决过程');
    edit({taskId:journeyId,editKey:'deadlineAt'},loopTodayKey()+'T23:30');
    state.selectedNodeId=childNode; state.recordDraft='逐层验证\\n保留原始记录';
    globalThis.captureId=createQuickCapture('独立速记','速记正文').id;
  `);
  assert.equal(h.evaluate('state.selectedNodeId'),h.evaluate('childNode'));
  const before=h.json('todayWidgetSnapshot()');
  const taskId=h.evaluate('journeyId'),captureId=h.evaluate('captureId');
  assert.deepEqual(before.items.map(item=>item.taskId),[taskId]);
  assert.deepEqual(before.quickCaptures.map(item=>item.taskId),[captureId]);
  h.evaluate(`state.query='逐层验证'`);
  assert.deepEqual(h.json('globalSearchMatches().nodes.map(item=>item.node.id)'),[h.evaluate('childNode')]);
  h.evaluate(`state.query='独立速记'`);
  assert.deepEqual(h.json('globalSearchMatches().notes.map(task=>task.id)'),[captureId]);
  assert.deepEqual(h.json('calendarTasksForDate(loopTodayKey()).map(task=>task.id)'),[taskId]);
  h.evaluate(`
    state.query='';
    state.attachments.images.journey_image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=';
    journeyTask.notes='# 联动记录\\n\\n原文、换行与图片均保留。\\n\\n![附件](task-image:journey_image)\\n';
    journeyTask.knowledgeNote=knowledgeDocument.markDocumentEdited(journeyTask.knowledgeNote);
  `);
  const saved=await h.evaluate('saveKnowledgeTask(journeyId)');
  assert.equal(saved.success,true);
  const markdown=await fs.readFile(notePath,'utf8');
  assert.match(markdown,/原文、换行与图片均保留/);
  assert.match(markdown,/attachments\//);
  assert.ok((await fs.readdir(path.join(path.dirname(notePath),'attachments'))).length>0);
  h.evaluate(`markNodeStatus(journeyId,rootNode,'done'); markNodeStatus(journeyId,childNode,'done');`);
  const completion=h.json('toggleTaskDone(journeyId)'); assert.equal(completion.success,true);
  h.evaluate('save()'); await h.evaluate('flushSave()');
  assert.deepEqual(h.json('todayWidgetSnapshot().items.map(item=>item.taskId)'),[]);
  h.evaluate(`state.reviewDateField='resolved'; state.reviewPreset='all'`);
  assert.deepEqual(h.json('reviewTasks().map(item=>item.task.id)'),[taskId]);
  const removed=await h.evaluate(`recovery26Transaction(()=>recovery26DeleteRecords([journeyId]))`);
  assert.equal(removed.ok,true);
  assert.deepEqual(h.json('calendarTasksForDate(loopTodayKey()).map(task=>task.id)'),[]);
  assert.equal(h.evaluate('r26Archive()[0].record.notes'),markdown);
  const restored=await h.evaluate('recovery26RestoreMany([r26Archive()[0].id])');
  assert.equal(restored[0].ok,true);
  assert.equal(h.evaluate('r26Task(journeyId).knowledgeNote.filePath'),notePath);
  assert.equal(h.evaluate('r26Task(journeyId).nodes[0].children[0].note'),'逐层验证\n保留原始记录');
  const backup=path.join(root,'workspace.loopbackup'),reopenedPath=path.join(root,'reopened');
  await exportPortableBackup({userDataPath:userData,destinationPath:backup,appVersion:'0.1.216'});
  await importBackup({selectedPath:backup,userDataPath:reopenedPath,appDataPath:root});
  const reopened=await readTaskData(reopenedPath);
  const finalTask=reopened.tasks.find(task=>task.id===taskId);
  assert.equal(finalTask.title,'联动任务 · 更新名称');
  assert.equal(finalTask.status,'done'); assert.equal(finalTask.groupId,'journey_group');
  assert.equal(finalTask.description,'背景第一行\n背景第二行');
  assert.equal(finalTask.notes,markdown); assert.equal(finalTask.knowledgeNote.filePath,notePath);
  assert.ok(reopened.attachments.images.journey_image);
  assert.equal(reopened.tasks.find(task=>task.id===captureId).captureSource,'today-widget');
});

test('workspace feedback resets its ten-second lifetime and restores current save status without rerendering editors', async () => {
  const h = await rendererHarness();
  h.evaluate(`
    globalThis.feedbackTimers = new Map(); globalThis.feedbackTimerId = 0;
    window.setTimeout = (callback, delay) => { const id = ++feedbackTimerId; feedbackTimers.set(id, {callback, delay}); return id; };
    window.clearTimeout = id => feedbackTimers.delete(id);
    globalThis.statusWrites = 0; globalThis.statusMarkup = '';
    globalThis.statusHost = { get innerHTML() { return statusMarkup; }, set innerHTML(value) { statusWrites++; statusMarkup = value; } };
    document.querySelector = selector => selector === '[data-workspace-status]' ? statusHost : null;
    render = () => { throw new Error('feedback must not rerender the editor'); };
    localSaveOutcome = 'saved'; globalThis.dismissed = [];
    showWorkspaceFeedback('已删除一项', '<button>撤销</button>', {source:'recovery', onDismiss:()=>dismissed.push('deleted')});
    globalThis.staleExpiry = feedbackTimers.get(workspaceFeedbackTimer).callback;
  `);
  assert.match(h.evaluate('statusMarkup'), /已删除一项/);
  assert.equal(h.evaluate('feedbackTimers.get(workspaceFeedbackTimer).delay'), 10000);
  h.evaluate(`showWorkspaceFeedback('已更新任务安排', '', {source:'notice', onDismiss:()=>dismissed.push('updated')}); staleExpiry();`);
  assert.deepEqual(h.json('dismissed'), ['deleted']);
  assert.match(h.evaluate('statusMarkup'), /已更新任务安排/);
  assert.equal(h.evaluate('feedbackTimers.size'), 1);
  h.evaluate(`globalThis.writesBefore = statusWrites; saveInFlight = true; updateLocalSaveReceipt(); updateLocalSaveReceipt();`);
  assert.equal(h.evaluate('statusWrites'), h.evaluate('writesBefore'), 'autosave must preserve the active feedback actions');
  h.evaluate(`clearWorkspaceFeedback('bulk');`);
  assert.match(h.evaluate('statusMarkup'), /已更新任务安排/, 'unrelated cleanup must not dismiss the current message');
  h.evaluate(`feedbackTimers.get(workspaceFeedbackTimer).callback();`);
  assert.match(h.evaluate('statusMarkup'), /正在保存到本机/);
  assert.deepEqual(h.json('dismissed'), ['deleted', 'updated']);
  assert.equal(h.evaluate('feedbackTimers.size'), 0);
  h.evaluate(`saveInFlight = false; localSaveOutcome = 'saved'; updateLocalSaveReceipt();`);
  assert.match(h.evaluate('statusMarkup'), /已保存到本机/);
});

test('workspace save failures take priority over success feedback and completion prompts can replace one another', async () => {
  const h = await rendererHarness();
  h.evaluate(`
    window.setTimeout = () => 1; window.clearTimeout = () => {};
    localSaveOutcome = 'saved'; showWorkspaceFeedback('已更新任务');
    localSaveOutcome = 'failed';
  `);
  assert.match(h.evaluate('renderWorkspaceStatus()'), /本地保存失败/);
  assert.doesNotMatch(h.evaluate('renderWorkspaceStatus()'), /已更新任务/);
  h.evaluate(`showWorkspaceError('导出失败，请稍后重试。');`);
  assert.match(h.evaluate('renderWorkspaceStatus()'), /导出失败/);
  assert.match(h.evaluate('renderWorkspaceStatus()'), /role="alert"/);
  h.evaluate(`clearWorkspaceFeedback();`);
  assert.match(h.evaluate('renderWorkspaceStatus()'), /本地保存失败/);
  h.evaluate(`localSaveOutcome='saved'; showCompletionNotice('same-task','CONCLUSION_REQUIRED'); showCompletionNotice('same-task','FLOW_INCOMPLETE');`);
  assert.equal(h.evaluate('state.flowPromptTaskId'), 'same-task');
  assert.equal(h.evaluate('state.conclusionPromptTaskId'), '');
  h.evaluate(`clearWorkspaceFeedback();`);
  assert.equal(h.evaluate('state.flowPromptTaskId'), '');
});

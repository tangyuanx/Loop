const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("../tools/guarded-electron.cjs");
const { writeTaskData, readTaskData } = require("../app/main/storage.cjs");
const { readKnowledgeDocument } = require("../app/main/knowledge-file.cjs");
const { exportWorkspaceBackup } = require("../app/main/workspace-backup.cjs");
const { SNAPSHOT_DIRECTORY } = require("../app/main/automatic-backups.cjs");

const repository = path.resolve(__dirname, "..");
const stamp = new Date().toISOString();
const data = { tasks: [{ id: "data-test", title: "数据保护候选", conclusion: "原结论", status: "active", priority: "medium", nodes: [], createdAt: stamp, updatedAt: stamp }] };

async function start(profile) {
  const env = { ...process.env, LOOP_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require("electron"), args: [repository], cwd: repository, env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), profile);
  assert.equal(await app.evaluate(({ app }) => app.getAppPath()), repository);
  return { app, page, errors };
}

async function interceptQuitPrompt(app) {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (_parent, options) => new Promise(resolve => {
      globalThis.quitPrompt = options;
      globalThis.answerQuitPrompt = response => resolve({ response });
    });
  });
}

async function waitForQuitPrompt(app) {
  const prompt = await app.evaluate(async () => {
    const deadline = Date.now() + 13000;
    while (!globalThis.quitPrompt && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return globalThis.quitPrompt;
  });
  assert.ok(prompt, "the application offers to quit without saving");
  assert.deepEqual(prompt.buttons, ["返回编辑", "放弃未保存内容并退出"]);
  assert.equal(prompt.defaultId, 0);
  assert.equal(prompt.cancelId, 0);
  return prompt;
}

async function discardAndWaitForExit(app) {
  const closed = app.waitForEvent("close", { timeout: 10000 });
  await app.evaluate(() => { answerQuitPrompt(1); });
  await closed;
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "loop-data-product-"));
  let app;
  try {
    const profile = path.join(root, "daily");
    await writeTaskData(profile, data);
    let run = await start(profile);
    ({ app } = run);
    const page = run.page;
    await page.locator(".app").waitFor();
    await page.waitForFunction(() => typeof recovery26Open === "function");
    const disk = () => fs.readFile(path.join(profile, "task-data.json"), "utf8");
    await page.evaluate(() => {
      state.settingsOpen = true;
      activeSettingsPage = "data";
      render();
    });
    await page.locator("[data-backup-usage]").filter({ hasText: "任务数据" }).waitFor();
    assert.deepEqual(await page.locator(".data-settings h3").allTextContents(),
      ["数据概况", "备份与迁移", "最近删除", "恢复整个工作区"]);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { state.theme = theme; render(); }, theme);
      for (const input of await page.locator("[data-backup-password]").all()) {
        await input.focus();
        const colors = await input.evaluate(element => {
          const result = [];
          for (let node = element; node && node !== document.body; node = node.parentElement) {
            const style = getComputedStyle(node);
            result.push({ border: style.borderColor, outline: style.outlineColor, outlineWidth: style.outlineWidth, shadow: style.boxShadow });
          }
          return result;
        });
        const green = color => {
          const matches = [...color.matchAll(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/g)];
          return matches.some(([, r, g, b]) => +g > +r + 25 && +g > +b + 10);
        };
        assert.equal(colors.some(item => green(item.border) || item.outlineWidth !== "0px" && green(item.outline) || green(item.shadow)), false);
      }
    }

    const archive = path.join(root, "encrypted.loopbackup");
    await app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, archive);
    await page.locator('[data-backup-password="export"]').fill("my independent backup password");
    await page.locator('[data-backup-password="import"]').fill("different restore password");
    await page.locator("[data-backup-action='export']").click();
    await page.locator("[data-backup-status]").filter({ hasText: "加密备份已保存" }).waitFor();
    assert.equal(await page.locator('[data-backup-status="restore"]').textContent(), "");
    assert.equal(await page.locator('[data-backup-password="import"]').inputValue(), "different restore password");
    assert.equal((await fs.readFile(archive)).subarray(0, 8).toString(), "LOOPBK2E");

    await page.evaluate(async () => {
      state.settingsOpen = false;
      state.tasks[0].title = "退出前尚未保存的新标题";
      save();
      await flushSave();
    });
    const previous = await disk();
    await app.evaluate(({ app }) => {
      const fs = process.mainModule.require("node:fs/promises");
      const original = fs.rename;
      globalThis.restoreDataRename = () => { fs.rename = original; };
      fs.rename = async (from, to) => {
        if (String(to).endsWith("task-data.json")) throw Object.assign(new Error("Synthetic disk failure"), { code: "ENOSPC" });
        return original(from, to);
      };
    });
    await page.evaluate(async () => {
      state.tasks[0].title = "磁盘失败后仍要保留的标题";
      save();
      await flushSave();
    });
    await interceptQuitPrompt(app);
    await app.evaluate(({ app }) => { app.quit(); });
    assert.equal((await waitForQuitPrompt(app)).message, "有修改未能保存。");
    await app.evaluate(() => { answerQuitPrompt(0); });
    await page.getByRole("alert").filter({ hasText: "有修改未能保存" }).waitFor();
    assert.equal(await disk(), previous);
    assert.equal(await page.evaluate(() => state.tasks[0].title), "磁盘失败后仍要保留的标题");
    await app.evaluate(() => { restoreDataRename(); });
    assert.equal(await page.evaluate(() => flushAllDataForTransfer().then(() => true)), true);
    assert.equal((await readTaskData(profile)).tasks[0].title, "磁盘失败后仍要保留的标题");
    assert.deepEqual(run.errors, []);
    await app.close();
    app = null;

    const quitProfile = path.join(root, "quit-without-saving");
    const notePath = path.join(root, "已保存的笔记.md");
    const savedNote = Buffer.from("# 已保存的笔记\r\n\r\n这部分必须保留。\r\n");
    await fs.writeFile(notePath, savedNote);
    const { lastSavedHash, lastSavedMtime } = await readKnowledgeDocument(notePath);
    await writeTaskData(quitProfile, { tasks: [{ ...data.tasks[0], notes: savedNote.toString(), knowledgeNote: {
      noteId: "quit-note", title: "已保存的笔记", filePath: notePath, documentState: "SAVED", lastSavedHash, lastSavedMtime,
    } }] });
    run = await start(quitProfile);
    ({ app } = run);
    await run.page.waitForFunction(() => typeof recurrenceScheduleTimer !== "undefined" && recurrenceScheduleTimer !== 0);
    await run.page.evaluate(() => flushAllDataForTransfer());
    const quitDisk = () => fs.readFile(path.join(quitProfile, "task-data.json"));
    const savedWorkspace = await quitDisk();
    await app.evaluate((_electron, maintenancePath) => {
      process.mainModule.require(maintenancePath).begin("manual-import");
    }, path.join(repository, "app", "main", "data-maintenance.cjs"));
    const failedSave = await run.page.evaluate(async () => {
      updateNodeNoteDraft("data-test", "", "# 放弃这段尚未保存的笔记");
      const result = await saveKnowledgeTask("data-test");
      return { success: result.success, message: result.message };
    });
    assert.equal(failedSave.success, false);
    assert.match(failedSave.message, /正在恢复或导入数据/);
    await interceptQuitPrompt(app);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html")).close();
    });
    assert.equal((await waitForQuitPrompt(app)).message, "有修改未能保存。");
    await discardAndWaitForExit(app);
    app = null;
    assert.deepEqual(await fs.readFile(notePath), savedNote);
    assert.deepEqual(await quitDisk(), savedWorkspace);

    run = await start(quitProfile);
    ({ app } = run);
    await run.page.waitForFunction(() => typeof recurrenceScheduleTimer !== "undefined" && recurrenceScheduleTimer !== 0);
    await run.page.evaluate(() => flushAllDataForTransfer());
    assert.equal(await run.page.evaluate(() => state.tasks[0].notes.replaceAll("\r\n", "\n")), savedNote.toString().replaceAll("\r\n", "\n"));
    await run.page.evaluate(() => {
      flushAllDataForTransfer = () => new Promise(resolve => { window.finishDelayedQuitSave = resolve; });
    });
    await interceptQuitPrompt(app);
    await app.evaluate(({ app }) => { app.quit(); });
    assert.match((await waitForQuitPrompt(app)).message, /还没有收到保存完成的确认/);
    await run.page.evaluate(() => window.finishDelayedQuitSave());
    const restartedWorkspace = await quitDisk();
    await run.page.evaluate(() => { state.tasks[0].notes = "# 放弃此时仍未保存的内容"; });
    await discardAndWaitForExit(app);
    app = null;
    assert.deepEqual(await fs.readFile(notePath), savedNote);
    assert.deepEqual(await quitDisk(), restartedWorkspace);

    const protectedProfile = path.join(root, "protected");
    await writeTaskData(protectedProfile, data);
    const snapshots = path.join(protectedProfile, SNAPSHOT_DIRECTORY);
    await fs.mkdir(snapshots);
    const automatic = path.join(snapshots, "loop-auto-2026-11-15-20261115T123456000Z-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.loopbackup");
    await exportWorkspaceBackup({ userDataPath: protectedProfile, destinationPath: automatic, includeBoundNotes: false });
    await fs.writeFile(path.join(protectedProfile, "task-data.json"), '{"tasks":null}');
    run = await start(protectedProfile);
    ({ app } = run);
    await run.page.getByRole("heading", { name: "工作区已进入只读保护" }).waitFor();
    assert.equal(await run.page.locator(".app").count(), 0);
    assert.equal(await fs.readFile(path.join(protectedProfile, "task-data.json"), "utf8"), '{"tasks":null}');
    await run.page.locator("[data-backup-action='import-recent']:not([hidden])").waitFor();
    await app.evaluate(({ app, dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
      app.relaunch = () => {};
      app.exit = () => {};
    });
    await run.page.locator("[data-backup-action='import-recent']").click();
    await run.page.locator("[data-backup-status]").filter({ hasText: "数据已恢复并校验成功" }).waitFor();
    assert.equal((await readTaskData(protectedProfile)).tasks[0].title, "数据保护候选");
    const localSafetyBackups = path.join(protectedProfile, ".isolated-backups", "Personal Task Track Upgrade Backups");
    assert.equal((await fs.readdir(localSafetyBackups)).filter(name => !name.startsWith("._")).length, 1);
    assert.deepEqual(run.errors, []);
    await app.close();
    app = null;
    console.log("Data product UI passed: encrypted export, neutral focus in both themes, quit after save failure or timeout, cancel and retry, corrupt-workspace protection and native backup restoration.");
  } finally {
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app?.close().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

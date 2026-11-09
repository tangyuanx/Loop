const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

/**
 * Regression for the today-widget quick-capture draft.
 *
 * The main process echoes the stored draft on every state broadcast (dragging,
 * resizing, opacity). That echo used to replace text the user had typed but not
 * yet published, silently dropping the last keystrokes. A deliberate clear from
 * the main window (promote, delete) must still reach the widget.
 */
(async () => {
  const repository = path.join(__dirname, "..");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "loop-widget-draft-ui-"));
  let app;
  try {
    const env = { ...process.env, ELECTRON_DISABLE_SANDBOX: "1" };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      executablePath: require("electron"),
      args: ["--no-sandbox", `--user-data-dir=${profile}`, repository],
      cwd: repository,
      env,
    });
    await app.firstWindow();
    const deadline = Date.now() + 15_000;
    let main = null;
    let widget = null;
    while (Date.now() < deadline && !(main && widget)) {
      for (const candidate of app.windows()) {
        if (candidate.url().endsWith("/app/renderer/index.html")) main = candidate;
        if (candidate.url().endsWith("/app/renderer/today-widget.html")) widget = candidate;
      }
      if (!main || !widget) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!main || !widget) throw new Error("Loop must open both the main window and the today widget");
    // The main window's root is `.app` (the `.ops-app` class this test used to
    // wait for no longer exists anywhere in the rebuilt front end).
    await main.locator(".app").first().waitFor();
    // The Demo only mounts the composer in the 速记 lane.
    await widget.locator(".today-widget").waitFor();
    await widget.evaluate(() => document.querySelector('[data-widget-type="quick"]')?.click());
    await widget.locator("#widget-capture").waitFor();

    const readDraft = () => widget.evaluate(() => document.querySelector("#widget-capture").value);
    const storeDraft = (draft) => main.evaluate(
      (value) => window.personalTaskTrack.todayWidget.setPreferences({ quickCaptureDraft: value }),
      draft,
    );
    const broadcastState = () => main.evaluate(
      () => window.personalTaskTrack.todayWidget.setPreferences({ opacity: 0.9 }),
    );

    await storeDraft("已恢复的草稿");
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await readDraft(), "已恢复的草稿", "a stored draft must still be restored into the widget");

    await widget.evaluate(() => {
      const input = document.querySelector("#widget-capture");
      input.focus();
      input.value = "已恢复的草稿 + 新输入";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await broadcastState();
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(
      await readDraft(),
      "已恢复的草稿 + 新输入",
      "a state broadcast must not replace text the user is still typing",
    );

    // Hiding and re-showing the window must not drop what has been typed.
    await main.evaluate(() => window.personalTaskTrack.todayWidget.hide());
    await new Promise((resolve) => setTimeout(resolve, 300));
    await main.evaluate(() => window.personalTaskTrack.todayWidget.show());
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(
      await readDraft(),
      "已恢复的草稿 + 新输入",
      "an unsubmitted draft must survive hiding and re-showing the widget",
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
    await storeDraft("");
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await readDraft(), "", "an explicit clear must still reach the widget");

    const field = widget.getByPlaceholder("添加速记…");
    assert.equal(await widget.getByText("暂无速记", { exact: true }).count(), 0);
    await field.click();
    await widget.keyboard.insertText("点击提示直接输入");
    assert.equal(await readDraft(), "点击提示直接输入");
    await widget.keyboard.press("Enter");
    await widget.locator(".widget-row").getByText("点击提示直接输入", { exact: true }).waitFor();
    console.log("PASS empty quick lane accepts and saves input after one click; draft continuity preserved");
  } finally {
    await app?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

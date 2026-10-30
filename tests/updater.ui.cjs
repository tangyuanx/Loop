const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "loop-updater-ui-"));
  const evidence = path.resolve(process.env.LOOP_UPDATE_QA_DIR || ".local-review/updater");
  await fs.mkdir(evidence, { recursive: true });
  const env = { ...process.env, LOOP_USER_DATA_DIR: profile, TZ: "Asia/Shanghai" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath: require("electron"),
      args: [...(process.env.LOOP_UPDATE_HEADLESS ? ["--no-sandbox", "--disable-gpu", "--ozone-platform=headless"] : []), path.join(__dirname, "fixtures/updater-ui-main.cjs")],
      cwd: root, env,
    });
    let page;
    for (let attempts = 0; attempts < 100 && !page; attempts++) {
      page = app.windows().find((item) => item.url().endsWith("/app/renderer/index.html"));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(page, "the production main window opens");
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.locator(".app").waitFor();
    assert.equal(await page.locator('[data-action="open-update-panel"]').count(), 0, "no update shortcut before a release is detected");
    await page.evaluate(() => { state.settingsOpen = true; activeSettingsPage = "updates"; render(); });
    await page.locator('[data-update-action="check"]').click();
    await page.waitForFunction(() => appUpdateState.releaseNotesStatus === "ready");
    await page.locator('[data-action="open-update-panel"]').click();
    assert.equal(await page.locator('.utility-popover [data-update-action="download"]').innerText(), "下载更新");
    assert.equal(await page.locator('.utility-popover [data-update-release="0.1.251"]').getAttribute("open"), "");
    await page.screenshot({ path: path.join(evidence, "available-popover.png") });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".update-release-notes").count(), 1);
    assert.match(await page.locator(".update-release-notes").innerText(), /本次涵盖 31 个版本/);
    assert.equal(await page.locator('[data-update-release="0.1.251"]').getAttribute("open"), "");
    assert.equal(await page.locator('[data-update-release="earlier"]').getAttribute("open"), null);
    await page.locator('[data-update-release="earlier"]>summary').click();
    await page.locator('[data-update-release="0.1.250"]>summary').click();
    assert.match(await page.locator('[data-update-release="0.1.250"]').innerText(), /版本 250/);
    await page.evaluate(() => { document.querySelector("[data-update-notes-scroll]").scrollTop = 100; });
    await page.locator('[data-update-action="download"]').click();
    await page.waitForFunction(() => appUpdateState.status === "downloading");
    assert.equal(await page.locator('[data-action="open-update-panel"]').isDisabled(), true, "detected update remains visible while downloading");
    assert.equal(await page.locator('[data-update-release="0.1.250"]').getAttribute("open"), "");
    assert.ok(await page.locator("[data-update-notes-scroll]").evaluate((node) => node.scrollTop) >= 90);
    await page.locator('[data-update-release="0.1.250"]>summary').focus();
    await app.evaluate(() => global.__loopUpdaterTest.progress(72));
    await page.waitForFunction(() => appUpdateState.percent === 72);
    assert.equal(await page.evaluate(() => document.activeElement?.parentElement?.dataset.updateRelease), "0.1.250");
    assert.equal(await page.locator('[data-update-release="earlier"]').getAttribute("open"), "");
    await app.evaluate(() => global.__loopUpdaterTest.finishDownload());
    await page.waitForFunction(() => appUpdateState.status === "downloaded");
    assert.equal(await page.locator('[data-action="open-update-panel"]').isEnabled(), true, "downloaded update stays reachable until installed");
    assert.deepEqual(await app.evaluate(() => {
      const { downloads, preparations, installs } = global.__loopUpdaterTest;
      return { downloads, preparations, installs };
    }), { downloads: 1, preparations: 0, installs: 0 });
    await page.locator('[data-update-release="earlier"]>summary').click();
    await page.evaluate(() => { document.querySelector("[data-update-notes-scroll]").scrollTop = 0; });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => { applySetting("theme", value); render(); }, theme);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
      await page.screenshot({ path: path.join(evidence, `downloaded-${theme}.png`) });
      const box = await page.locator(".update-release-notes").boundingBox();
      assert.ok(box.width > 200 && box.width < 1100);
    }
    await page.setViewportSize({ width: 1024, height: 680 });
    await page.screenshot({ path: path.join(evidence, "downloaded-compact.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('[data-update-action="install"]').click();
    await page.waitForFunction(() => appUpdateState.status === "installing");
    assert.deepEqual(await app.evaluate(() => {
      const { downloads, preparations, installs } = global.__loopUpdaterTest;
      return { downloads, preparations, installs };
    }), { downloads: 1, preparations: 1, installs: 1 });
    assert.deepEqual(errors, []);
    console.log("PASS real Electron: cross-version notes, folding, scroll retention, themes, compact layout, download waiting and explicit installation handshake");
  } finally {
    await app?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

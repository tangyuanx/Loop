const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { launchRepository, task } = require("./electron-ui-helpers.cjs");
const { readTaskData } = require("../app/main/storage.cjs");

const deletedAt = days => new Date(Date.now() - days * 86_400_000).toISOString();
const archivedTask = (id, title, days) => ({
  id, kind: "task", title, deletedAt: deletedAt(days), record: task("task_" + id, { title }),
});

(async () => {
  const run = await launchRepository({
    tasks: [task("active", { title: "当前任务" })],
    recentlyDeleted: [
      archivedTask("manual", "手动清理样例", 60),
      archivedTask("automatic", "自动清理样例", 8),
      archivedTask("restorable", "仍可恢复样例", 2),
    ],
  }, "recently-deleted-retention");
  const { app, page, profile } = run;
  try {
    assert.equal(await app.evaluate(({ app }) => app.getAppPath()), path.resolve(__dirname, ".."));
    await app.evaluate(({ dialog }) => {
      globalThis.retentionConfirmations = [];
      globalThis.retentionResponse = 0;
      dialog.showMessageBox = async (_parent, options) => {
        retentionConfirmations.push(options);
        return { response: retentionResponse };
      };
    });
    const confirmations = () => app.evaluate(() => retentionConfirmations);
    const respond = value => app.evaluate((_, response) => { globalThis.retentionResponse = response; }, value);
    const file = path.join(profile, "task-data.json");
    const ids = async () => (await readTaskData(profile)).recentlyDeleted.map(entry => entry.id).sort();

    await page.locator('[data-action="toggle-settings"]').first().click();
    await page.locator('[data-action="set-settings-page"][data-page="data"]').click();
    const retention = page.locator('.prefs-choice[data-key="recently-deleted-retention"]');
    const choose = async name => {
      await retention.click();
      await page.getByRole("menuitemradio", { name, exact: true }).click();
    };
    const clean = page.getByRole("button", { name: "预览并清理…" });
    const status = page.locator("[data-retention-status]");
    await page.waitForFunction(() => document.querySelector('.prefs-choice[data-key="recently-deleted-retention"]')?.disabled === false);
    assert.equal((await retention.textContent()).trim(), "永久保留");
    assert.equal(await clean.isDisabled(), true);

    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { state.theme = theme; render(); }, theme);
      await retention.hover();
      await retention.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      const styles = await retention.evaluate(node => {
        const own = getComputedStyle(node);
        const focus = node.matches(":focus-visible");
        const ancestors = [];
        for (let element = node; element && element !== document.body; element = element.parentElement) {
          const style = getComputedStyle(element);
          ancestors.push([style.borderColor, style.boxShadow, style.outlineWidth === "0px" ? "" : style.outlineColor]);
        }
        return { focus, outline: own.outlineWidth, offset: own.outlineOffset, ancestors };
      });
      assert.equal(styles.focus, true);
      assert.equal(styles.outline, "1px");
      assert.equal(styles.offset, "-2px");
      const colors = styles.ancestors.flat().join(" ");
      for (const [, r, g, b] of colors.matchAll(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/g)) {
        assert.ok(!(Number(g) > Number(r) + 25 && Number(g) > Number(b) + 10), colors);
      }
    }

    await choose("30 天");
    await page.waitForFunction(() => document.querySelector('.prefs-choice[data-key="recently-deleted-retention"]')?.disabled === false);
    assert.equal((await retention.textContent()).trim(), "永久保留");
    assert.match((await confirmations()).at(-1).detail, /1 项已过期/);
    assert.deepEqual(await ids(), ["automatic", "manual", "restorable"]);
    await respond(1);
    await choose("30 天");
    await status.filter({ hasText: "已设置保留 30 天" }).waitFor();

    await respond(0);
    await clean.click();
    await page.waitForFunction(() => !document.querySelector("[data-retention-clean]").disabled);
    assert.match((await confirmations()).at(-1).message, /清理 1 项过期归档/);
    assert.deepEqual(await ids(), ["automatic", "manual", "restorable"]);

    await app.evaluate(() => {
      const fs = process.mainModule.require("node:fs/promises");
      const rename = fs.rename;
      globalThis.restoreRetentionRename = () => { fs.rename = rename; };
      fs.rename = (from, to) => String(to).endsWith("task-data.json")
        ? Promise.reject(Object.assign(new Error("Synthetic disk full"), { code: "ENOSPC" })) : rename(from, to);
    });
    const before = await fs.readFile(file, "utf8");
    await respond(1);
    await clean.click();
    await status.filter({ hasText: "清理未完成" }).waitFor();
    assert.equal(await fs.readFile(file, "utf8"), before);
    await app.evaluate(() => { restoreRetentionRename(); });
    await clean.click();
    await status.filter({ hasText: "已清理 1 项过期归档，减少本机用量" }).waitFor();
    assert.deepEqual(await ids(), ["automatic", "restorable"]);

    await page.getByRole("button", { name: "查看最近删除" }).click();
    const manager = page.getByRole("dialog", { name: "最近删除" });
    await manager.getByRole("button", { name: /仍可恢复样例/ }).click();
    await manager.getByRole("button", { name: "恢复", exact: true }).click();
    await manager.getByRole("button", { name: /仍可恢复样例/ }).waitFor({ state: "hidden" });
    assert.deepEqual(await ids(), ["automatic"]);
    await manager.getByRole("button", { name: "关闭", exact: true }).click();
    await manager.waitFor({ state: "hidden" });
    if (!await retention.isVisible()) {
      await page.locator('[data-action="toggle-settings"]').first().click();
      await page.locator('[data-action="set-settings-page"][data-page="data"]').click();
    }

    await choose("7 天");
    await status.filter({ hasText: "已设置保留 7 天" }).waitFor();
    await status.filter({ hasText: "已清理 1 项过期归档" }).waitFor({ timeout: 65000 });
    const current = await readTaskData(profile);
    assert.deepEqual(current.recentlyDeleted, []);
    assert.deepEqual(current.tasks.map(item => item.id).sort(), ["active", "task_restorable"]);
    assert.ok(current.taskActivity.length);
    assert.deepEqual(run.errors, []);
    console.log("Verified real Electron retention defaults, native preview and cancellation, write failure, retry, restore, and timed cleanup.");
  } finally {
    await run.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

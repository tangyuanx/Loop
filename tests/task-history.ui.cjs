const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { launchRepository, task } = require("./electron-ui-helpers.cjs");

(async () => {
  const h = await launchRepository({ tasks: [task("history-test", { title: "追溯测试", conclusion: "历史结论" })] }, "task-history");
  const { app, page, profile, errors } = h;
  try {
    const conclusion = page.locator('[data-brief21-key="history-test:conclusion"]');
    await conclusion.fill("当前结论");
    await conclusion.press("ControlOrMeta+Enter");
    await page.locator('button[data-action="switch-task-pane"][data-pane="history"]').click();
    const changed = page.locator(".task-activity-row").filter({ hasText: "更新结论" });
    await changed.locator("summary").click();
    assert.deepEqual(await changed.locator("pre").allTextContents(), ["历史结论", "当前结论"]);

    await app.evaluate(({ dialog }) => {
      const original = dialog.showMessageBox;
      dialog.showMessageBox = (...args) => {
        const options = args.at(-1);
        if (options.title === "恢复历史版本" && options.buttons[1] === "恢复版本") return Promise.resolve({ response: 1 });
        return original(...args);
      };
    });
    await changed.getByRole("button", { name: "恢复变更前版本" }).click();
    const restored = page.locator(".task-activity-row").filter({ hasText: "恢复版本" });
    await restored.locator("summary").click();
    assert.deepEqual(await restored.locator("pre").allTextContents(), ["当前结论", "历史结论"]);
    assert.equal(await conclusion.inputValue(), "历史结论");

    const disk = JSON.parse(await fs.readFile(path.join(profile, "task-data.json"), "utf8"));
    assert.equal(disk.tasks[0].conclusion, "历史结论");
    assert.equal(disk.taskActivity.at(-1).kind, "restored-version");
    assert.deepEqual(disk.taskActivity.at(-1).changes, [{ field: "conclusion", before: "当前结论", after: "历史结论" }]);
    await page.reload();
    await page.locator('button[data-action="switch-task-pane"][data-pane="history"]').click();
    assert.equal(await restored.locator("summary").textContent(), "恢复版本 · 任务「追溯测试」");
    assert.deepEqual(errors, []);
    console.log("Task activity UI passed: a real brief edit produces durable versions, restoration records a new version, and reload preserves the timeline.");
  } finally {
    await h.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

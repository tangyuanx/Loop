const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');

(async () => {
  const run = await launchRepository({ taskGroups: [{ id: 'work', title: '默认', order: 1 }, { id: 'other', title: '另一组', order: 2 }],
    tasks: [task('seed', { groupId: 'work' })] }, 'group-menu');
  const { page, profile } = run;
  try {
    const menu = page.getByRole('menu', { name: '分组操作' });
    const work = page.getByRole('button', { name: '分组：默认', exact: true });
    const trigger = page.getByRole('button', { name: '默认 分组操作', exact: true });
    const count = work.locator('.count');
    const ungrouped = page.getByRole('button', { name: '未分组', exact: true });

    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { state.theme = theme; render(); }, theme);
      await page.mouse.move(900, 700);
      const countBounds = await count.boundingBox();
      assert.equal(await count.innerText(), '1');
      assert.equal(await count.isVisible(), true);
      assert.equal(await trigger.evaluate(button => getComputedStyle(button).opacity), '0');

      await work.hover();
      assert.equal(await count.isVisible(), false);
      const triggerBounds = await trigger.boundingBox();
      assert.equal(triggerBounds.x, countBounds.x);
      assert.equal(triggerBounds.width, countBounds.width);
      assert.ok(await trigger.locator('svg').evaluate(icon => icon.getBBox().width > 0));

      await ungrouped.hover();
      assert.equal(await count.isVisible(), true);
      assert.equal(await ungrouped.locator('.count').isVisible(), true);
    }

    await work.click();
    await page.mouse.move(900, 700);
    assert.equal(await count.isVisible(), true);
    await work.hover();
    await trigger.click();
    await menu.waitFor();
    assert.equal(await work.getAttribute('aria-current'), 'page');
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    await page.mouse.move(900, 700);
    await work.focus();
    await page.keyboard.press('Tab');
    assert.equal(await trigger.evaluate(button => button === document.activeElement), true);
    assert.equal(await count.isVisible(), false);
    await page.keyboard.press('Enter');
    await menu.waitFor();
    await page.keyboard.press('Escape');

    await page.locator('.nav-section-heading [data-action="add-group"]').click();
    await page.locator('#group-title').fill('右键验收分组'); await page.keyboard.press('Enter');
    const id = await page.evaluate(() => state.taskGroups.find(g => g.title === '右键验收分组').id);
    const row = () => page.locator(`.navigation [data-action="select-nav-group"][data-group-id="${id}"]`);
    await row().click({ button: 'right' });
    await menu.waitFor(); await menu.getByRole('menuitem', { name: '上移', exact: true }).click();
    await page.waitForFunction(id => sort(state.taskGroups)[1].id === id, id);
    await row().focus(); await page.keyboard.press('Shift+F10');
    await menu.getByRole('menuitem', { name: '重命名', exact: true }).click();
    await page.locator('#group-title').fill('重新命名的分组'); await page.keyboard.press('Enter');
    await page.waitForFunction(id => state.taskGroups.find(g => g.id === id).title === '重新命名的分组', id);
    await row().click({ button: 'right' }); await menu.getByRole('menuitem', { name: '整理分组' }).click();
    await page.locator('.manage24-organizer').waitFor();
    await page.locator('#manage24-organizer-search').fill('不存在');
    assert.match(await page.locator('.manage24-no-results').innerText(), /没有匹配/);
    await page.keyboard.press('Escape');
    await row().click({ button: 'right' }); await menu.waitFor();
    await page.mouse.click(900, 700); assert.equal(await menu.count(), 0);
    await row().click({ button: 'right' }); await menu.waitFor(); await page.keyboard.press('Escape');
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    await page.waitForFunction(id => document.activeElement?.matches(`.navigation [data-group-id="${id}"]`), id)
      .catch(async error => { throw new Error(`${error.message}; actual focus: ${await page.evaluate(() => document.activeElement.outerHTML.slice(0, 800))}`); });
    await page.evaluate(async () => { save(); await flushSave(); });
    const stored = JSON.parse(await fs.readFile(path.join(profile, 'task-data.json'), 'utf8'));
    assert.ok(stored.taskGroups.some(g => g.title === '重新命名的分组'));
    assert.deepEqual(run.errors, []);
    console.log('PASS: real shell group count/menu slot in both themes, mouse and keyboard menus, group management and isolated persistence.');
  } finally { await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

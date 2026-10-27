const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');

(async () => {
  const run = await launchRepository({ taskGroups: [{ id: 'work', title: '默认', order: 1 }, { id: 'other', title: '另一组', order: 2 }],
    tasks: [task('seed', { groupId: 'work' })] }, 'group-menu');
  const { page, profile } = run;
  try {
    await page.locator('.nav-section-heading [data-action="add-group"]').click();
    await page.locator('#group-title').fill('右键验收分组'); await page.keyboard.press('Enter');
    const id = await page.evaluate(() => state.taskGroups.find(g => g.title === '右键验收分组').id);
    const row = () => page.locator(`.navigation [data-action="select-nav-group"][data-group-id="${id}"]`);
    await row().click({ button: 'right' });
    const menu = page.getByRole('menu', { name: '分组操作' });
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
    console.log('PASS: real shell group create/rename/reorder/organize, keyboard menu, outside dismissal, focus return and isolated persistence.');
  } finally { await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

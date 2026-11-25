const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');

const output = process.env.LOOP_REVIEW_OUTPUT;
const node = { id: 'node', title: '处理节点', status: 'todo', children: [] };
const data = {
  activeTaskId: 'first', zhFont: 'heiti', enFont: 'times', fontScale: 'current',
  tasks: [task('first', { title: '已选任务', order: 0 }), task('second', { title: '版本管理', nodes: [node] })],
};

async function renderAt(page, theme, chinese = 'heiti', english = 'times') {
  await page.evaluate(({ theme, chinese, english }) => {
    Object.assign(state, { theme, zhFont: chinese, enFont: english });
    render();
  }, { theme, chinese, english });
  await page.evaluate(() => document.fonts.ready);
}

async function screenshot(cdp, name) {
  if (!output) return;
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(data, 'base64'));
}

async function verifySelection(page, dpr, theme) {
  await renderAt(page, theme);
  const first = page.locator('[data-task-row="first"]');
  const second = page.locator('[data-task-row="second"]');
  await first.locator('.task-select').click();
  await first.and(page.locator('.selected')).waitFor();
  const titleX = element => element.getBoundingClientRect().x;
  const x = await second.locator('.task-item-title').evaluate(titleX);
  await second.locator('.task-select').click();
  const selectedTitle = second.and(page.locator('.selected')).locator('.task-item-title');
  await selectedTitle.waitFor();
  assert.equal(await selectedTitle.evaluate(titleX), x, 'selecting a task keeps its title in place');
  await page.locator('.node-title[data-node-id="node"]').click();
  await page.waitForSelector('.flow-row.selected');
  await page.mouse.move(1, 1);

  const styles = await page.evaluate(async () => {
    const selectors = ['.navigation .nav-button.active', '.task-item.selected', '.flow-row.selected'];
    const rows = selectors.map(selector => document.querySelector(selector));
    await Promise.all(rows.flatMap(row => row.getAnimations().map(animation => animation.finished)));
    const labels = ['.navigation .nav-button.active > span', '.task-item.selected .task-item-title',
      '.flow-row.selected .node-title', '.nav-section-heading'];
    return {
      rows: rows.map(row => {
        const style = getComputedStyle(row);
        const marker = getComputedStyle(row, '::before');
        return { fill: style.backgroundColor, shadow: style.boxShadow, width: parseFloat(marker.width), left: marker.left };
      }),
      dpr: devicePixelRatio,
      density: document.documentElement.dataset.density,
      labels: labels.map(selector => {
        const style = getComputedStyle(document.querySelector(selector));
        return { selector, font: style.fontFamily, weight: style.fontWeight, size: parseFloat(style.fontSize) };
      }),
    };
  });
  assert.equal(styles.dpr, dpr);
  assert.equal(styles.density, 'standard');
  assert.equal(new Set(styles.rows.map(row => row.fill)).size, 1);
  for (const row of styles.rows) {
    assert.notEqual(row.fill, 'rgba(0, 0, 0, 0)');
    assert.equal(row.shadow, 'none');
    assert.equal(row.left, '0px');
    assert.ok(Math.abs(row.width * dpr - Math.round(3 * dpr)) < 0.01, `${dpr}x: ${JSON.stringify(row)}`);
  }
  for (const label of styles.labels) {
    assert.match(label.font, /Loop Windows Latin.*Loop Windows CJK/);
    assert.equal(label.weight, '400');
    assert.ok(label.size >= 12, `${dpr}x: ${JSON.stringify(label)}`);
  }
  assert.equal(await page.locator('.task-title').evaluate(element => getComputedStyle(element).fontWeight), '700');
  const input = page.locator('.list-search input');
  const surface = input.locator('..');
  const background = await input.evaluate(element => getComputedStyle(element).backgroundColor);
  await input.focus();
  await surface.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished));
  });
  const focus = await surface.evaluate(element => {
    const style = getComputedStyle(element);
    return { shadow: style.boxShadow, color: style.getPropertyValue('--focus-line').trim() };
  });
  assert.equal(await input.evaluate(element => getComputedStyle(element).backgroundColor), background, 'search input stays transparent on focus');
  assert.match(focus.color, /^#(6e6e6e|969696)$/);
  assert.match(focus.shadow, /inset/);
}

async function verifyWindowsFonts(page, cdp) {
  const selectors = ['.navigation .nav-button.active > span', '.task-item.selected .task-item-title', '.flow-row.selected .node-title'];
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  for (const selector of selectors) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert.ok(fonts.length > 0 && fonts.every(font => font.familyName === 'Microsoft YaHei UI' && !/Bold/i.test(font.postScriptName)),
      `${selector} must use regular Microsoft YaHei UI: ${JSON.stringify(fonts)}`);
  }
}

async function verifyDesktop(dpr) {
  const windows = process.platform === 'win32';
  const args = windows ? [`--force-device-scale-factor=${dpr}`] : [];
  const fixture = await launchRepository(data, 'typography-selection', '', args);
  const { app, page } = fixture;
  try {
    if (windows) {
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/app/renderer/index.html'));
        window.setContentSize(1240, 820);
      });
    }
    await page.waitForFunction(() => Boolean(document.documentElement.dataset.os));
    const cdp = await page.context().newCDPSession(page);
    async function emulate(scale) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1240, height: 820, deviceScaleFactor: scale, mobile: false });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    }
    if (process.platform === 'darwin') {
      await emulate(2);
      await renderAt(page, 'light');
      const baseline = await page.evaluate(() => ({ os: document.documentElement.dataset.os,
        density: document.documentElement.dataset.density, font: getComputedStyle(document.body).fontFamily,
        marker: getComputedStyle(document.querySelector('.navigation .nav-button.active'), '::before').display }));
      assert.equal(baseline.os, 'mac');
      assert.equal(baseline.density, 'high');
      assert.match(baseline.font, /TaskTrack English Times.*TaskTrack Chinese Heiti/);
      assert.equal(baseline.marker, 'none');
      await screenshot(cdp, 'mac-retina');
    }
    if (!windows) await page.evaluate(() => { document.documentElement.dataset.os = 'windows'; });
    for (const scale of windows ? [dpr] : [1, 1.25, 1.5]) {
      for (const theme of ['light', 'dark']) {
        if (!windows) await emulate(scale);
        await page.waitForFunction(expected => devicePixelRatio === expected && document.documentElement.dataset.density === 'standard', scale);
        await verifySelection(page, scale, theme);
        if (windows) await verifyWindowsFonts(page, cdp);
        await page.locator('.list-search input').blur();
        await screenshot(cdp, `${windows ? 'windows' : 'windows-styles'}-${scale}x-${theme}`);
      }
    }
    await renderAt(page, 'light', 'noto', 'arial');
    const customFont = () => page.locator('body').evaluate(element => getComputedStyle(element).fontFamily);
    assert.match(await customFont(), /TaskTrack English Arial.*TaskTrack Chinese Noto/);
    await renderAt(page, 'light', 'heiti', 'arial');
    assert.match(await customFont(), /TaskTrack English Arial.*Loop Windows CJK/);
    assert.deepEqual(fixture.errors, []);
  } finally {
    await fixture.close();
  }
}

(async () => {
  if (output) await fs.mkdir(output, { recursive: true });
  for (const dpr of process.platform === 'win32' ? [1, 1.25, 1.5] : [undefined]) await verifyDesktop(dpr);
  console.log('Typography and selection passed at 1x, 1.25x and 1.5x in light and dark mode.');
})().catch(error => { console.error(error); process.exitCode = 1; });

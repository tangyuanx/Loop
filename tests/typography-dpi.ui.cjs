const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

(async () => {
  const repo = path.resolve(__dirname, '..');
  const server = http.createServer(async (request, response) => {
    const file = path.resolve(repo, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(repo + path.sep)) { response.writeHead(403).end(); return; }
    try {
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.otf') ? 'font/otf' : 'text/html');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.LOOP_TEST_CHROMIUM || undefined, headless: true,
      args: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const stamp = new Date().toISOString();
      localStorage.setItem('task-flow-sheet-prototype-v2', JSON.stringify([
        { id: 'glyph', title: '版本管理系统', status: 'active', createdAt: stamp, updatedAt: stamp,
          nodes: [{ id: 'node', title: '管道管理 · 缓存一致性 · 描述与结论', status: 'todo', children: [] }] },
      ]));
      localStorage.setItem('task-track-task-filter', 'all');
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/app/renderer/index.html`);
    await page.waitForSelector('.task-item-title');
    const cdp = await page.context().newCDPSession(page);
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 1]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: dpr, mobile: false });
      await page.waitForFunction(dpr => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-pixel')) - 1 / dpr) < 0.00001, dpr);
      for (const scale of ['current', 'larger', 'large', 'largest']) {
        await page.evaluate(scale => { state.fontScale = scale; render(); }, scale);
        await page.evaluate(() => document.fonts.ready);
        const labels = await page.evaluate(() => {
          const c = document.createElement('canvas').getContext('2d');
          return [...document.querySelectorAll('.task-item-title, .node-title, .nav-button > span:first-of-type')]
            .filter(e => e.getBoundingClientRect().height).map(e => {
              const s = getComputedStyle(e); c.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
              const ink = c.measureText('版本管理系统');
              return { text: e.textContent, size: parseFloat(s.fontSize), weight: s.fontWeight,
                height: e.getBoundingClientRect().height, ink: ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent };
            });
        });
        assert.ok(labels.some(x => x.text === '版本管理系统'));
        for (const label of labels) {
          assert.equal(label.weight, '400', JSON.stringify({ dpr, scale, label }));
          assert.ok(Math.abs(label.size * dpr - Math.round(label.size * dpr)) < 0.002, JSON.stringify({ dpr, scale, label }));
          assert.ok(label.height >= label.ink, JSON.stringify({ dpr, scale, label }));
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log('Typography passed: 100–200% DPR, four sizes, cross-display return, 管 glyph ink bounds.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

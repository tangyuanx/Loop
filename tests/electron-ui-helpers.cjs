const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function launchRepository(data, name = 'repository') {
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), `loop-${name}-`));
  await fs.writeFile(path.join(profile, 'task-data.json'), JSON.stringify({ version: 2, knowledgeSchemaVersion: 1,
    taskFilter: 'all', activeGroupId: 'group_all', ...data }));
  const env = { ...process.env, LOOP_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
    const deadline = Date.now() + 15000;
    let page;
    while (!page && Date.now() < deadline) {
      page = app.windows().find(p => p.url().endsWith('/app/renderer/index.html'));
      if (!page) await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(page, 'the real production main window opens');
    page.setDefaultTimeout(10000);
    await page.locator('.app').waitFor();
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    return { app, page, profile, errors, async close() { await app.close(); await fs.rm(profile, { recursive: true, force: true }); } };
  } catch (error) { await app?.close(); await fs.rm(profile, { recursive: true, force: true }); throw error; }
}

const task = (id, fields = {}) => ({ id, title: id, status: 'active', priority: 'medium', order: 1,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), nodes: [], ...fields });
module.exports = { launchRepository, task };

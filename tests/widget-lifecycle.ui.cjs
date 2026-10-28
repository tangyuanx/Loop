const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const evidence = path.resolve(process.env.LOOP_WIDGET_LIFECYCLE_QA_DIR || '.local-review/frontend-remediation/stage-07/lifecycle');

(async () => {
  await fs.mkdir(evidence, { recursive: true });
  const run = await launchRepository({ tasks: [task('draft-record', { title: '尚未改名', captureSource: 'today-widget' })] }, 'widget-lifecycle');
  const report = { profile: run.profile };
  let second;
  try {
    const widget = run.app.windows().find(p => p.url().endsWith('/today-widget.html')) || await run.app.waitForEvent('window');
    await widget.locator('.today-widget').waitFor();
    await widget.locator('[data-widget-type="quick"]').click();
    await widget.locator('#widget-capture').fill('主窗关闭后仍保留的速记\n完整详情');
    await widget.locator('[data-widget12="edit"]').focus();
    await widget.keyboard.press('Enter');
    await widget.locator('#widget-title-input').fill('退出后待确认的改名草稿');
    const closed = run.app.waitForEvent('close');
    await run.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).close();
    }).catch(() => {}); // A successful close can end the evaluation transport.
    await closed;
    report.actualMainCloseExited = true;

    const root = path.resolve(__dirname, '..');
    const env = { ...process.env, LOOP_USER_DATA_DIR: run.profile };
    delete env.ELECTRON_RUN_AS_NODE;
    second = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
    await second.firstWindow();
    let restored;
    for (let attempt = 0; attempt < 100 && !restored; attempt++) {
      restored = second.windows().find(p => p.url().endsWith('/today-widget.html'));
      if (!restored) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(restored, 'the real widget reopens after restarting this profile');
    await restored.locator('#widget-title-input').waitFor();
    assert.equal(await restored.locator('#widget-title-input').inputValue(), '退出后待确认的改名草稿');
    assert.equal(await restored.locator('#widget-capture').inputValue(), '主窗关闭后仍保留的速记\n完整详情');
    await restored.locator('#widget-title-input').focus();
    await restored.keyboard.press('Escape');
    report.captureAndRenameRestored = true;
    report.complete = true;
    console.log('PASS actual main close exits app; restart restores capture and uncommitted rename');
  } catch (error) { report.failure = error.stack; throw error; }
  finally {
    await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2));
    await second?.close();
    await run.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

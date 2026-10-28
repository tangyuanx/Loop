// Production Electron and isolated synthetic data. Native picker answers,
// explicit disk faults and feedback service responses are test fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const evidence = path.resolve(process.env.LOOP_SYSTEM_QA_DIR || '.local-review/frontend-remediation/stage-06/ui');
const report = { checks: [], layouts: [], inputs: [], errors: [], fixtures: ['native picker answers', 'task-data write faults/delays', 'feedback service responses', 'updater presentation states; no installation'] };
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

(async () => {
  await fs.mkdir(evidence, { recursive: true });
  const run = await launchRepository({ tasks: [
    task('keep', { title: '保留任务与恢复内容', notes: '# 原始笔记\n\n合成内容与换行必须保留。', tags: { today: true } }),
    task('victim', { title: '验证删除影响、撤销和恢复', notes: '# 恢复正文\n\n合成数据。' }),
    task('long', { title: '检查长标题的恢复边界'.repeat(16), groupId: 'group-long', notes: '长记录。'.repeat(800) }),
  ], taskGroups: [{ id: 'group-long', title: '需要完整保留的长分组名称'.repeat(5), order: 1 }] }, 'system-stage6');
  const { page, app, profile } = run;
  report.profile = profile;
  const check = label => { report.checks.push(label); console.log(`PASS ${label}`); };
  const settings = async value => {
    await page.evaluate(value => { shellCloseOverlay({ restoreFocus: false }); state.settingsOpen = true; activeSettingsPage = value; state.calendarOpen = state.reviewOpen = false; render(); }, value);
    await settle(page);
  };
  const shot = async name => { if (process.env.LOOP_SYSTEM_FUNCTIONAL_ONLY) return; await settle(page); await page.screenshot({ path: path.join(evidence, `${name}.png`) }); };
  const fault = value => app.evaluate((_e, value) => { global.__s6Fault = value; }, value);
  try {
    await page.waitForFunction(() => globalThis.LoopManual27 && typeof recovery26Open === 'function');
    await page.evaluate(() => flushSave());
    await app.evaluate(({ dialog, ipcMain, app }, profile) => {
      app.setPath('appData', profile);
      const fs = process.mainModule.require('node:fs/promises'), open = fs.open, rename = fs.rename;
      global.__s6Fault = {};
      fs.open = async (...args) => {
        const fault = global.__s6Fault;
        if (fault.prefix && String(args[0]).startsWith(fault.prefix)) {
          if (fault.delay) { global.__s6Blocked = true; await new Promise(resolve => { global.__s6Release = resolve; }); }
          if (fault.fail) throw Object.assign(Error('测试：磁盘写入失败'), { code: 'ENOSPC' });
        }
        return open(...args);
      };
      fs.rename = async (...args) => {
        if (global.__s6RestoreFault && String(args[0]).includes('.migration-') && String(args[1]) === profile + '/task-data.json') {
          global.__s6RestoreFault = false;
          throw Object.assign(Error('测试：导入写入失败'), { code: 'EIO' });
        }
        return rename(...args);
      };
      global.__s6DialogCalls = [];
      dialog.showSaveDialog = async (_parent, options) => { global.__s6DialogCalls.push(options); return { canceled: false, filePath: profile + '/protected.loopbackup' }; };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [global.__s6ImportPath || profile + '/protected.loopbackup'] });
      dialog.showMessageBox = async (_parent, options) => { global.__s6DialogCalls.push(options); return { response: global.__s6Confirm ?? 0 }; };
      ipcMain.removeHandler('bug-report:submit');
      ipcMain.handle('bug-report:submit', async (_event, payload) => {
        global.__s6FeedbackCalls = (global.__s6FeedbackCalls || 0) + 1;
        global.__s6FeedbackPayload = payload;
        if (global.__s6FeedbackMode === 'delay') await new Promise(resolve => { global.__s6FeedbackRelease = resolve; });
        return global.__s6FeedbackMode === 'success' ? { success: true, reportId: 'local-fixture', issueNumber: 123 } : { success: false, message: '测试服务暂不可用，请稍后重试' };
      });
    }, profile);

    await settings('appearance');
    await page.locator('[data-action="open-settings-choice"][data-key="font-scale"]').click();
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => state.fontScale), 'largest');
    await page.locator('[data-action="open-settings-choice"][data-key="font-scale"]').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.key), 'font-scale');
    await page.evaluate(() => { applySetting('font-scale', 'large'); save(); });
    await settings('knowledge');
    await page.locator('[data-key="knowledge-mode"][data-action="open-settings-choice"]').click();
    await page.locator('[data-action="set-settings-choice"][data-value="source"]').click();
    assert.equal(await page.evaluate(() => shellKnowledgeMode()), 'source');
    await page.evaluate(() => { applySetting('knowledge-mode', 'edit'); save(); });
    check('settings menus support keyboard selection, focus return and released global note preferences');

    await settings('help');
    await page.locator('[data-action="open-help-feedback"]').click();
    await page.locator('[data-action="submit-feedback"]').click();
    assert.equal(await page.locator('#help14-title').getAttribute('aria-invalid'), 'true');
    // The dialog restores focus in its next animation frame after replacing
    // the markup. Wait for that public behavior, not just the new error text.
    await page.waitForFunction(() => document.activeElement.id === 'help14-title');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'help14-title');
    await shot('feedback-invalid');
    await page.locator('#help14-title').fill('合成反馈标题');
    await page.locator('#help14-category').selectOption({ index: 1 });
    await page.locator('#help14-description').fill('这是一段仅在独立测试中使用的问题描述。');
    await page.locator('[data-feedback-field="confirmed"]').check();
    await page.locator('[data-feedback-field="includeEnvironment"]').uncheck();
    assert.equal(await page.locator('[data-feedback-environment]').isVisible(), false);
    assert.equal(await page.locator('#help14-title').getAttribute('aria-invalid'), 'false');
    await app.evaluate(() => { global.__s6FeedbackMode = 'delay'; });
    await page.locator('[data-action="submit-feedback"]').click();
    await page.waitForFunction(() => state.feedbackSubmitting);
    assert.equal(await page.locator('#help14-form').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('[data-action="close-help-feedback"]').first().isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.mouse.click(8, 300);
    assert.equal(await page.locator('#help14-form').count(), 1);
    await shot('feedback-submitting');
    await app.evaluate(() => { global.__s6FeedbackRelease(); });
    await page.waitForFunction(() => !state.feedbackSubmitting);
    assert.match(await page.locator('[data-feedback-message]').innerText(), /服务暂不可用/);
    assert.equal(await page.locator('#help14-title').inputValue(), '合成反馈标题');
    assert.equal(await app.evaluate(() => global.__s6FeedbackCalls), 1);
    assert.equal(await app.evaluate(() => global.__s6FeedbackPayload.includeEnvironment), false);
    await shot('feedback-failed');
    await app.evaluate(() => { global.__s6FeedbackMode = 'success'; });
    await page.locator('[data-action="submit-feedback"]').click();
    await page.locator('.help14-result').waitFor();
    await shot('feedback-success');
    await page.locator('.help14-result [data-action="close-help-feedback"]').click();
    await settle(page);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'open-help-feedback');
    check('feedback edits reach the draft, validates inline, blocks dismissal/duplicates while busy, retains failure and handles fixture success');

    await page.locator('[data-manual27="open"]').click();
    await page.locator('#manual27-search').fill('恢复');
    assert.ok(await page.locator('.manual27-result').count() > 0);
    await page.keyboard.press('Enter');
    const manualTitle = await page.locator('#manual27-title').innerText();
    await page.locator('#manual27-search').fill('没有匹配的合成词qzx');
    assert.equal(await page.locator('.manual27-no-results').count(), 1);
    await page.locator('#manual27-search').dispatchEvent('keydown', { key: 'Escape', isComposing: true });
    assert.equal(await page.locator('#manual27-search').inputValue(), '没有匹配的合成词qzx');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#manual27-search').inputValue(), '');
    assert.equal(await page.locator('#manual27-title').innerText(), manualTitle);
    const win = await app.browserWindow(page); await win.evaluate(w => w.setSize(1024, 740));
    await page.locator('[data-manual27="directory"]').click();
    const lastToc = page.locator('.manual27-directory-popup button').last(); await lastToc.focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.manual27-directory-popup button')), true);
    await page.keyboard.press('Escape');
    await settle(page);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.manual27), 'directory');
    await shot('manual-narrow');
    await page.locator('[data-manual27="close"]').click();
    check('manual searches, empty results, IME-safe Escape and directory focus/return retain reading context');

    await settings('data');
    assert.equal(await page.locator('[data-recovery26="open"]').count(), 1);
    await page.evaluate(() => recovery26ReviewDelete(['victim']));
    assert.match(await page.locator('.recovery26-confirm').innerText(), /磁盘中的笔记文件和附件会保留/);
    await fault({ prefix: path.join(profile, 'task-data.json.tmp-'), fail: true });
    await page.locator('[data-recovery26="commit-delete"]').click();
    await page.waitForFunction(() => !recovery26Busy);
    assert.match(await page.locator('#recovery26-confirm-error').innerText(), /内容保持不变/);
    assert.equal(await page.evaluate(() => state.tasks.some(t => t.id === 'victim') && !r26Archive().some(e => e.objectId === 'victim')), true);
    await shot('delete-write-failed');
    await fault({ prefix: path.join(profile, 'task-data.json.tmp-'), delay: true });
    await page.locator('[data-recovery26="commit-delete"]').click();
    await page.waitForFunction(() => Recovery26Persisting);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.recovery26-confirm').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('[data-recovery26="commit-delete"]').isDisabled(), true);
    await app.evaluate(() => { global.__s6Fault = {}; global.__s6Release?.(); });
    await page.waitForFunction(() => !recovery26Busy && !document.querySelector('.recovery26-confirm'));
    assert.equal(await page.evaluate(() => workspaceFeedback.expiresAt === Infinity && typeof recovery26Undo === 'function'), true);
    await page.locator('[data-recovery26="undo"]').click();
    await page.waitForFunction(() => state.tasks.some(t => t.id === 'victim'));
    assert.match(await page.evaluate(() => r26Task('victim').notes), /恢复正文/);
    check('delete uses atomic persistence, rollback on real disk failure, blocks dismissal while writing and retains undo');

    await page.evaluate(async () => { await recovery26Transaction(() => recovery26DeleteRecords(['long'])); recovery26Open(); });
    const entryId = await page.evaluate(() => r26Archive().find(e => e.objectId === 'long').id);
    await page.locator(`[data-recovery26="select"][data-id="${entryId}"]`).click();
    await page.evaluate(() => { state.tasks.push(normalizeTasks([{id:'long', title:'已有同ID的任务'}])[0]); });
    await page.evaluate(() => recovery26DrawList());
    assert.equal(await page.locator('[data-recovery26="restore"]').isDisabled(), true);
    await shot('restore-conflict');
    await page.evaluate(() => { state.tasks = state.tasks.filter(t => t.id !== 'long'); recovery26DrawList(); });
    await fault({ prefix: path.join(profile, 'task-data.json.tmp-'), fail: true });
    await page.locator('[data-recovery26="restore"]').click();
    await page.waitForFunction(() => !recovery26Busy);
    assert.equal(await page.evaluate(id => r26Archive().some(e => e.id === id) && !r26Task('long'), entryId), true);
    assert.match(await page.locator('#recovery26-restore-error').innerText(), /内容保持不变/);
    await fault({});
    await page.locator('[data-recovery26="purge"]').click();
    await page.locator('[data-recovery26="cancel"]').click();
    assert.equal(await page.locator('.recovery26-manager').count(),1);
    await page.locator('[data-recovery26="purge"]').click();
    assert.equal(await page.locator('[data-recovery26="purge-confirm"]').isDisabled(), true);
    await page.locator('#recovery26-purge-agree').check();
    await fault({ prefix: path.join(profile, 'task-data.json.tmp-'), fail: true });
    await page.locator('[data-recovery26="purge-confirm"]').click();
    await page.waitForFunction(() => !recovery26Busy);
    assert.equal(await page.evaluate(() => recovery26Pending?.mode), 'purge');
    await fault({});
    await page.locator('[data-recovery26="purge-confirm"]').click();
    await page.waitForFunction(id => !recovery26Busy && !r26Archive().some(e => e.id === id), entryId);
    await page.keyboard.press('Escape');
    check('restore conflicts remain actionable; failed restore retains archive; permanent-delete consent and failed-write retry work');

    await settings('data');
    await page.locator('[data-recovery26="open"]').click();
    await page.keyboard.press('Escape'); await settle(page);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.recovery26), 'open');
    const bound = path.join(profile, 'protected-note.md');
    await fs.writeFile(bound, '# 受保护的外部笔记副本\n');
    await page.evaluate(bound => {
      const t=r26Task('keep');
      t.knowledgeNote=knowledgeDocument.normalizeKnowledgeNote({...t.knowledgeNote,filePath:bound,dirty:false,documentState:'SAVED'}, {taskId:t.id,title:t.title});
      recovery26ReviewUnlinkNote(t.id);
    }, bound);
    await fault({prefix:path.join(profile,'task-data.json.tmp-'),fail:true});
    await page.locator('[data-recovery26="unlink-confirm"]').click();
    await page.waitForFunction(() => !recovery26Busy);
    assert.equal(await page.evaluate(() => recovery26Pending?.mode), 'unlink');
    assert.equal(await page.evaluate(() => r26Task('keep').knowledgeNote.filePath), bound);
    await fault({});
    await page.locator('[data-recovery26="unlink-confirm"]').click();
    await page.waitForFunction(() => !recovery26Busy && !document.querySelector('.recovery26-confirm'));
    await fault({prefix:path.join(profile,'task-data.json.tmp-'),fail:true});
    await page.locator('[data-recovery26="undo"]').click();
    await page.waitForFunction(() => workspaceFeedback?.source === 'error');
    assert.equal(await page.evaluate(() => Boolean(r26Task('keep').knowledgeNote.filePath)), false);
    assert.equal(await page.evaluate(() => workspaceFeedback.expiresAt === Infinity), true);
    assert.equal(await fs.readFile(bound,'utf8'), '# 受保护的外部笔记副本\n');
    await fault({}); await page.evaluate(() => flushSave());
    check('recovery returns to its live trigger; unlink failure retries and failed undo rolls back without claiming success or touching external content');

    await settings('updates');
    const actualUpdate = await page.evaluate(() => ({...appUpdateState}));
    assert.equal(actualUpdate.supported, false);
    assert.equal(actualUpdate.status, 'unsupported');
    for (const status of ['checking','available','downloading','downloaded','preparing','installing','error','latest']) {
      await page.evaluate(status => { appUpdateState = {...appUpdateState, supported:true, status, percent:47, version:'fixture-version', retryAction:'download', errorCode:status === 'error' ? 'NETWORK_ERROR' : ''}; shellSettingsSyncUpdateCard(); }, status);
      report.layouts.push({ kind:'updater-presentation-fixture', status });
      if (status === 'downloading') assert.equal(await page.locator('[role="progressbar"]').getAttribute('aria-valuenow'), '47');
      if (['checking','downloading','preparing','installing'].includes(status)) assert.equal(await page.locator('[data-shell-update-detail] button').isDisabled(), true);
    }
    await page.evaluate(value => { appUpdateState = value; shellSettingsSyncUpdateCard(); }, actualUpdate);
    await settings('tasks');
    await page.locator('[data-action="desk19-status"]').click();
    const actualReminder = await page.evaluate(() => ({...desktopReminderState}));
    report.reminder = actualReminder;
    await page.keyboard.press('Escape');
    await page.evaluate(() => { desktopReminderReadFailed = true; desktopSyncReminderLabels(); });
    assert.match(await page.locator('[data-desktop-reminder-settings]').innerText(), /暂时无法读取/);
    await page.evaluate(() => { desktopReminderReadFailed = false; });
    await page.locator('[data-action="desk19-status"]').click();
    await page.locator('[data-action="desk19-check"]').click();
    await page.waitForFunction(() => !desktopReminderChecking);
    assert.equal(await page.locator('.desk19-panel').count(), 1);
    await page.keyboard.press('Escape');
    check('development updater stays unsupported; all update state fixtures render; real reminder state/check and unreadable state remain distinct');

    for (const theme of ['light','dark']) for (const width of [1280,1024]) {
      await win.evaluate((w, width) => w.setSize(width, 820), width);
      for (const category of ['appearance','tasks','knowledge','data','updates','advanced','help']) {
        await page.evaluate(theme => { state.theme = theme; }, theme);
        await settings(category);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await shot(`${theme}-${width}-${category}`);
        report.layouts.push({theme,width,category});
      }
      await page.locator('[data-action="open-help-feedback"]').click();
      for (const selector of ['#help14-title','#help14-category','#help14-description','#help14-contact']) {
        const field = page.locator(selector);
        for (const state of ['default','hover','focus']) {
          if (state === 'hover') await field.hover();
          if (state === 'focus') await field.focus();
          const styles = await field.evaluate(el => [el,el.parentElement].map(node => {
            const s=getComputedStyle(node); return {border:s.borderColor,outline:s.outlineStyle,outlineWidth:s.outlineWidth,shadow:s.boxShadow,background:s.backgroundColor};
          }));
          const green = color => { const n=color.match(/[\d.]+/g)?.map(Number); return n?.length >= 3 && n[1] > n[0]+8 && n[1] > n[2]+8; };
          for (const s of styles) { assert.equal(green(s.border), false); assert.ok(s.outline === 'none' || s.outlineWidth === '0px'); assert.equal(s.shadow, 'none'); }
          report.inputs.push({theme,width,selector,state,styles});
        }
      }
      await page.keyboard.press('Escape');
      await page.locator('[data-manual27="open"]').click();
      await shot(`${theme}-${width}-manual`);
      await page.locator('[data-manual27="close"]').click();
      await settings('data');
      await page.locator('[data-recovery26="open"]').click();
      await shot(`${theme}-${width}-recovery-empty`);
      await page.keyboard.press('Escape');
    }
    check('all settings, manual and recovery empty states in light/dark at both desktop widths; feedback fields and parents obey neutral input contract');

    await settings('data');
    const recoveryPath=path.join(profile,'knowledge-note-recovery.json');
    const recovery=content=>JSON.stringify({version:1,records:{'s6-protected':{noteId:'s6-protected',content,updatedAt:new Date().toISOString(),baseFileHash:null,assets:[]}}});
    await fs.writeFile(recoveryPath,recovery('备份中的合成Recovery正文'));
    await page.locator('[data-backup-action="export"]').click();
    await page.waitForFunction(() => !dataBackupOperation.busy);
    assert.match(await page.locator('[data-backup-status]').innerText(), /已保存/);
    const exported = JSON.parse(await fs.readFile(path.join(profile,'protected.loopbackup'),'utf8'));
    assert.equal(exported.format, 'loop-portable-backup');
    const diskBefore = await fs.readFile(path.join(profile,'task-data.json'),'utf8');
    await page.locator('[data-backup-action="import-file"]').click();
    await page.waitForFunction(() => !dataBackupOperation.busy);
    assert.match(await page.locator('[data-backup-status]').innerText(), /已取消/);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8')).tasks, JSON.parse(diskBefore).tasks);
    await fs.writeFile(path.join(profile,'corrupt.loopbackup'),'invalid test backup');
    await app.evaluate(() => { global.__s6Confirm=1; global.__s6ImportPath=process.mainModule.require('node:path').join(process.env.LOOP_USER_DATA_DIR,'corrupt.loopbackup'); });
    await page.locator('[data-backup-action="import-file"]').click();
    await page.waitForFunction(() => !dataBackupOperation.busy);
    assert.match(await page.locator('[data-backup-status]').innerText(), /操作未完成/);
    assert.equal(await page.evaluate(() => dataTransferInProgress), false);
    const currentRecovery=recovery('导入失败必须保留的当前Recovery正文');
    await fs.writeFile(recoveryPath,currentRecovery);
    await app.evaluate(() => { global.__s6ImportPath='';global.__s6RestoreFault=true; });
    await page.locator('[data-backup-action="import-file"]').click();
    await page.waitForFunction(() => !dataBackupOperation.busy);
    assert.match(await page.locator('[data-backup-status]').innerText(), /回滚/);
    assert.equal(await page.evaluate(() => dataTransferInProgress), false);
    assert.equal(await fs.readFile(recoveryPath,'utf8'),currentRecovery);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8')).tasks, JSON.parse(diskBefore).tasks);
    // Safety-copy names use whole seconds and refuse to overwrite an earlier
    // copy. Separate the failed-import and successful-import scenarios.
    await app.evaluate(() => new Promise(resolve => setTimeout(resolve,1100)));
    await app.evaluate(({app}) => {
      global.__s6ImportPath='';
      app.relaunch=()=>{global.__s6Relaunch=true};
      app.exit=()=>{global.__s6Exit=true};
    });
    await page.locator('[data-backup-action="import-file"]').click();
    await page.waitForFunction(() => !dataBackupOperation.busy);
    await app.evaluate(() => new Promise(resolve => setTimeout(resolve,450)));
    assert.equal(await app.evaluate(() => global.__s6Relaunch && global.__s6Exit), true, await page.locator('[data-backup-status]').innerText());
    const restored = JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8'));
    assert.equal(restored.tasks.find(t=>t.id==='keep').notes, '# 原始笔记\n\n合成内容与换行必须保留。');
    assert.equal(JSON.parse(await fs.readFile(recoveryPath,'utf8')).records['s6-protected'].content,'备份中的合成Recovery正文');
    const dialogs = await app.evaluate(() => global.__s6DialogCalls);
    assert.ok(dialogs.some(d=>/替换/.test(d.message) && /校验/.test(d.detail)));
    report.backup = {tasks:restored.tasks.length, restart:'real import completed; relaunch/exit intercepted in this protected test instance', safetyRoot:profile};
    check('real backup IPC exports, cancel and invalid import preserve data, failed import rolls back database plus Recovery, protected success requests restart');
    assert.deepEqual(run.errors, []);
  } catch (error) {
    report.errors.push(error.stack); await shot('failure').catch(()=>{}); throw error;
  } finally {
    report.pageErrors = run.errors;
    await fs.writeFile(path.join(evidence,'results.json'), JSON.stringify(report,null,2));
    await run.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

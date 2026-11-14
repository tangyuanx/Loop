const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { assertShare, atomicOutput, writeArchive, limits, assertSize } = require('./task-share-archive.cjs');
const { scopeNames, readTaskPackage, writeTaskPackage } = require('./task-share-format.cjs');
const { prepareContent, markdownDocuments, staticDocument, remapImportedContent, assertAssetTypes, safeName } = require('./task-share-content.cjs');
const { stageImportedAssets } = require('./task-share-assets.cjs');
const { prepareImport } = require('./task-share-import-model.cjs');

const leaseLifetime = 30 * 60 * 1000;
const errorMessages = {
  ENOSPC: '磁盘空间不足。请释放空间后重试。',
  EACCES: '没有权限读取或写入所选位置。请选择其他位置后重试。',
  EPERM: '没有权限读取或写入所选位置。请选择其他位置后重试。',
  ENOENT: '文件或目录已移动，请重新选择后重试。',
};

function registerTaskShare({ ipcMain, dialog, shell, app, getWindow, store, exportDocument }) {
  const leases = new Map();
  const windowListeners = new WeakSet();
  const userData = app.getPath('userData');
  const pending = new Map();

  function owner(event) {
    const win = getWindow();
    assertShare(win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame,
      'SHARE_OWNER', '任务分享请求来源无效。');
    if (!windowListeners.has(event.sender)) {
      windowListeners.add(event.sender);
      const id = event.sender.id;
      event.sender.once('destroyed', () => {
        for (const lease of leases.values()) if (lease.owner === id) void remove(lease);
      });
    }
    return win;
  }

  async function remove(lease) {
    if (lease.committing) return;
    leases.delete(lease.token);
    clearTimeout(lease.timer);
    lease.controller.abort();
    await fs.rm(lease.directory, { recursive: true, force: true }).catch(error => console.error('Share staging cleanup failed', error.code));
  }

  async function makeLease(win, kind) {
    const ownerId = win.webContents.id;
    const key = `${ownerId}:${kind}`;
    const token = randomUUID();
    pending.set(key, token);
    for (const lease of leases.values()) if (lease.owner === ownerId && lease.kind === kind) await remove(lease);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-task-share-'));
    if (pending.get(key) !== token) {
      await fs.rm(directory, { recursive: true, force: true });
      throw new DOMException('Superseded task share preview', 'AbortError');
    }
    pending.delete(key);
    const lease = { token, kind, directory, owner: ownerId, controller: new AbortController(), approvedFiles: new Map() };
    lease.timer = setTimeout(() => void remove(lease), leaseLifetime);
    lease.timer.unref();
    leases.set(token, lease);
    return lease;
  }

  function getLease(win, token, kind) {
    const lease = leases.get(token);
    assertShare(lease?.owner === win.webContents.id && lease.kind === kind, 'SHARE_EXPIRED', '预览已过期，请重新打开。');
    return lease;
  }

  function on(channel, action) {
    ipcMain.handle(`task-share:${channel}`, async (event, payload = {}) => {
      try { return await action(owner(event), payload); }
      catch (error) {
        if (error.name === 'AbortError') return { canceled: true };
        const known = typeof error.code === 'string' && /^(?:SHARE|IMPORT|DATA)_/.test(error.code);
        if (!known && !errorMessages[error.code]) console.error(`Task share ${channel} failed:`, error.code || error.name);
        return { success: false, code: error.code || 'SHARE_FAILED',
          message: known ? error.message : errorMessages[error.code] || (channel === 'inspect' ? '任务包无法读取或已损坏，请重新取得文件。' : '任务分享操作未完成，请重试。'),
          statusConflicts: error.statusConflicts, availableStatuses: error.availableStatuses };
      }
    });
  }

  function exportSummary(lease) {
    const { pack, assets, issues, localPaths, references } = lease.prepared;
    const files = [...assets.values()].map(({ name, size, type }) => ({ name, size, type }));
    const preview = markdownDocuments(pack)[0].bytes.toString('utf8');
    return { success: true, token: lease.token, files, localPaths, references,
      issues: issues.map(({ id, name, context, owner, reason }) => ({ id, name, context, owner, reason })),
      bytes: files.reduce((sum, file) => sum + file.size, Buffer.byteLength(preview)), preview: preview.slice(0, 64000), document: staticDocument(pack) };
  }

  async function prepare(lease) {
    await fs.rm(path.join(lease.directory, 'content'), { recursive: true, force: true });
    const directory = path.join(lease.directory, 'content');
    await fs.mkdir(directory, { mode: 0o700 });
    lease.prepared = await prepareContent(await store.read(), lease.source, { userData, directory,
      signal: lease.controller.signal, approvedFiles: lease.approvedFiles });
    return exportSummary(lease);
  }

  on('prepare', async (win, { source }) => {
    assertShare(source?.task && Array.isArray(source.notes) && Array.isArray(source.nodeStates) && Array.isArray(source.task.nodes),
      'SHARE_SCOPE', '请选择有效的分享范围。');
    assertSize(source.notes.length, limits.notes);
    assertSize(source.nodeStates.length, 24);
    for (const note of source.notes) assertSize(Buffer.byteLength(note.content || ''), limits.note);
    assertSize(source.notes.reduce((bytes, note) => bytes + Buffer.byteLength(note.content || ''), 0), limits.notesBytes);
    const lease = await makeLease(win, 'export');
    lease.source = source;
    try { return await prepare(lease); }
    catch (error) { await remove(lease); throw error; }
  });

  on('locate', async (win, { token, issueId }) => {
    const lease = getLease(win, token, 'export');
    const issue = lease.prepared.issues.find(item => item.id === issueId);
    assertShare(issue, 'SHARE_SCOPE', '此附件已更改，请刷新预览。');
    const selection = await dialog.showOpenDialog(win, { title: `重新选择附件 ${issue.name}`, properties: ['openFile'] });
    if (selection.canceled || !selection.filePaths?.length) return { canceled: true };
    lease.approvedFiles.set(`${issue.owner}\0${issue.destination}`, selection.filePaths[0]);
    return prepare(lease);
  });

  on('export', async (win, { token, format, allowIncomplete, html }) => {
    const lease = getLease(win, token, 'export');
    const { pack, assets, issues } = lease.prepared;
    assertShare(!issues.length || allowIncomplete === true, 'SHARE_RESOURCES', '请重新选择缺失附件，或确认排除后继续。');
    if (format === 'pdf' || format === 'html') {
      assertShare(!assets.size || allowIncomplete === true, 'SHARE_RESOURCES', '请先确认保留附件说明。');
      const markdown = markdownDocuments(pack)[0].bytes.toString('utf8');
      return exportDocument({ taskTitle: pack.task.title, format, markdown,
        documentKind: pack.scope === 'notes' ? 'note' : 'task', html: typeof html === 'string' ? html : '' });
    }
    assertShare(format === 'md' || format === 'pack', 'SHARE_FORMAT', '请选择支持的分享格式。');
    const documents = format === 'md' ? markdownDocuments(pack) : [];
    const extension = format === 'pack' ? 'looptask' : documents.length > 1 || assets.size ? 'zip' : 'md';
    const chosen = await dialog.showSaveDialog(win, { title: '保存分享文件', defaultPath: `${safeName(pack.task.title, 'Loop 任务')}.${extension}`,
      filters: [{ name: { looptask: 'Loop 任务包', md: 'Markdown', zip: 'Markdown ZIP' }[extension], extensions: [extension] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'] });
    if (chosen.canceled || !chosen.filePath) return { canceled: true };
    const filePath = chosen.filePath.toLowerCase().endsWith(`.${extension}`) ? chosen.filePath : `${chosen.filePath}.${extension}`;
    const entries = [...assets.values()].map(asset => ({ ...asset, name: asset.entry }));
    const signal = lease.controller.signal;
    await atomicOutput(filePath, async temp => {
      if (extension === 'looptask') await writeTaskPackage(temp, pack, entries, app.getVersion(), signal);
      else if (extension === 'zip') {
        assertSize([...documents, ...entries].reduce((sum, item) => sum + (item.size ?? item.bytes.length), 0), limits.total);
        await writeArchive(temp, [...documents, ...entries], signal);
      } else await fs.writeFile(temp, documents[0].bytes, { mode: 0o600, flag: 'wx', signal });
    });
    lease.exportedFile = filePath;
    return { success: true, fileName: path.basename(filePath), token };
  });

  on('reveal', (win, { token }) => {
    const lease = getLease(win, token, 'export');
    if (lease.exportedFile) shell.showItemInFolder(lease.exportedFile);
    return { success: true };
  });

  on('inspect', async (win) => {
    const selected = await dialog.showOpenDialog(win, { title: '导入 Loop 任务包', properties: ['openFile'],
      filters: [{ name: 'Loop 任务包', extensions: ['looptask'] }] });
    if (selected.canceled || !selected.filePaths?.length) return { canceled: true };
    const source = selected.filePaths[0];
    assertShare(path.extname(source).toLowerCase() === '.looptask', 'SHARE_FORMAT', '请选择 .looptask 文件。完整备份可在设置中恢复。');
    const lease = await makeLease(win, 'import');
    try {
      lease.sourcePath = source;
      lease.sourceStat = await fs.stat(source);
      lease.prepared = await readTaskPackage(source, lease.directory, lease.controller.signal);
      await assertAssetTypes(lease.prepared.assets);
      lease.taskId = `task_${randomUUID()}`;
      const { pack, nodeCount, noteBytes, assets } = lease.prepared;
      const check = prepareImport({}, pack, { taskId: lease.taskId });
      remapImportedContent(pack, check, assets);
      const data = await store.read();
      let status = {};
      try {
        const proposed = prepareImport(data || {}, pack, { taskId: lease.taskId });
        status.added = proposed.nodeStates.filter(item => !data?.nodeStates?.some(existing => existing.id === item.id));
      } catch (error) {
        if (!error.statusConflicts) throw error;
        status = { conflicts: error.statusConflicts, choices: error.availableStatuses };
      }
      const files = [...assets.values()].map(({ name, type, size }) => ({ name, type, size }));
      return { success: true, token: lease.token, title: pack.task.title, scope: scopeNames[pack.scope], status,
        taskStatus: pack.task.status, deadlineAt: pack.task.deadlineAt, records: pack.records, nodeCount,
        notes: pack.notes.map(note => note.title), files, bytes: noteBytes + files.reduce((sum, file) => sum + file.size, 0) };
    } catch (error) { await remove(lease); throw error; }
  });

  on('commit', async (win, { token, title, groupId, statusMap, revision }) => {
    const lease = getLease(win, token, 'import');
    if (lease.receipt) return lease.receipt;
    if (lease.committing) return lease.committing;
    lease.committing = (async () => {
      const current = await fs.stat(lease.sourcePath);
      assertShare(['size', 'mtimeMs', 'ctimeMs', 'ino'].every(key => current[key] === lease.sourceStat[key]),
        'SHARE_CHANGED', '任务包在预览后发生变化，请重新打开。');
      const { pack, assets } = lease.prepared;
      assertShare(typeof title === 'string' && Buffer.byteLength(title) <= 1024, 'SHARE_TITLE', '请输入有效的任务名称。');
      return store.append(revision, async (data, write) => {
        const plan = prepareImport(data, pack, { taskId: lease.taskId, title, groupId, statusMap });
        const owners = remapImportedContent(pack, plan, assets);
        const staged = await stageImportedAssets(userData, lease.taskId, assets, owners);
        plan.task.sharedAssets = staged.index;
        const knowledgeWorkspace = { ...data.knowledgeWorkspace,
          tabsByTask: { ...data.knowledgeWorkspace?.tabsByTask, [plan.task.id]: plan.tabs },
          lastByTask: { ...data.knowledgeWorkspace?.lastByTask, [plan.task.id]: plan.tabs[0] || '' } };
        let saved;
        try {
          saved = await write({ ...data, tasks: [...(data.tasks || []), plan.task],
            knowledgeDocuments: [...(data.knowledgeDocuments || []), ...plan.documents], knowledgeWorkspace, nodeStates: plan.nodeStates });
        } catch (error) { await staged.abort().catch(() => {}); throw error; }
        await staged.finish().catch(error => console.error('Task share commit journal cleanup failed', error.code));
        return { task: saved.tasks.find(task => task.id === lease.taskId), documents: plan.documents,
          nodeStates: saved.nodeStates, tabs: plan.tabs };
      });
    })();
    try { lease.receipt = await lease.committing; return lease.receipt; }
    finally { lease.committing = null; }
  });

  on('cancel', async (win, { token }) => {
    const lease = leases.get(token);
    if (lease?.owner === win.webContents.id) await remove(lease);
    return { success: true };
  });
}

module.exports = { registerTaskShare };

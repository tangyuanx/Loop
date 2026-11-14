const taskShareBridge = window.personalTaskTrack?.taskShare;
const taskShareScopes = { full: '完整任务', brief: '任务简报', flow: '处理流', node: '节点／子树', notes: '知识笔记', custom: '自定义' };
const taskShareImages = new Map();
const taskShareImagePending = new Set();

function taskShareAssetOwner(href, requested) {
  if (requested) return requested;
  const id = href.split('#')[0].slice('loop-asset:'.length);
  return [...state.tasks, ...state.knowledgeDocuments, ...state.recentlyDeleted.map(entry=>entry.record).filter(Boolean)]
    .flatMap(task=>task.sharedAssets||[]).find(asset=>asset.id===id)?.owners?.[0] || '';
}

function taskShareImage(owner, href) {
  owner = taskShareAssetOwner(href, owner);
  if (!owner || !taskShareBridge?.asset) return '';
  const key = `${owner}\0${href}`;
  if (taskShareImages.has(key)) return taskShareImages.get(key);
  if (!taskShareImagePending.has(key)) {
    taskShareImagePending.add(key);
    void taskShareBridge.asset({ href, ownerId: owner }).then(result => {
      if (!result?.dataUrl) return;
      if (taskShareImages.size >= 12) taskShareImages.delete(taskShareImages.keys().next().value);
      taskShareImages.set(key, result.dataUrl);
      const entry = typeof knowledgeCurrentEntry === 'function' ? knowledgeCurrentEntry(owner) : null;
      entry?.refresh?.();
      for (const image of document.querySelectorAll('img[data-task-share-src]')) {
        if (image.dataset.taskShareSrc === href) image.src = result.dataUrl;
      }
    }).catch(() => {}).finally(() => taskShareImagePending.delete(key));
  }
  return '';
}

async function openTaskShareAsset(href, owner) {
  try {
    const result = await taskShareBridge.asset({ href, ownerId: taskShareAssetOwner(href, owner), open: true });
    if (!result?.success) throw new Error(result?.message || '附件不可用。');
  } catch (error) { showWorkspaceError(taskShareFailure(error)); }
}

document.addEventListener('click', event => {
  const asset = event.target.closest?.('[data-task-share-asset]');
  if (!asset) return;
  event.preventDefault();
  void openTaskShareAsset(asset.dataset.taskShareAsset, asset.closest('[data-node-id]')?.dataset.nodeId);
});

function taskShareSnapshot(taskId, noteId) {
  captureMountedMilkdownDrafts();
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) return null;
  const cloneNodes = items => items.map(node => ({ ...node,
    note: nodeNoteDrafts.get(noteDraftKey(taskId, node.id))?.markdown ?? node.note,
    children: cloneNodes(node.children || []) }));
  const brief = Object.fromEntries(['description', 'hypothesis', 'conclusion'].map(field => [field,
    state.shellDrafts?.[`${taskId}:${field}`] ?? task[field]]));
  const tabIds = state.knowledgeWorkspace.tabsByTask?.[taskId] || [];
  const ownerTitles = new Map();
  for (const owner of state.tasks) {
    if (owner.id === taskId) continue;
    for (const id of knowledgeDocument.taskNoteIds(owner, state.knowledgeDocuments)) {
      if (!ownerTitles.has(id)) ownerTitles.set(id, []);
      ownerTitles.get(id).push(owner.title || '未命名任务');
    }
  }
  return {
    task: { ...task, ...brief, nodes: cloneNodes(task.nodes), notes: knowledgeText(task) },
    documents: knowledgeAllDocuments().filter(item => item.id !== taskId).map(item => ({
      id: item.id, creatorTaskId: item.creatorTaskId, title: item.title,
      knowledgeNote: { ...item.knowledgeNote }, notes: knowledgeText(item),
      ownerTitles: ownerTitles.get(item.id) || [] })),
    tabIds: [...new Set([...tabIds, ...(noteId ? [noteId] : [])])],
    nodeStates: state.nodeStates.map(item => ({ ...item })),
    noteId,
  };
}

function taskShareSize(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function taskShareFailure(error) {
  return String(error?.message || '操作未完成，请重试。').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

function taskShareCloseObserver(dialog, cleanup) {
  const observer = new MutationObserver(() => {
    if (dialog.isConnected) return;
    observer.disconnect();
    cleanup();
  });
  observer.observe(shellOverlay(), { childList: true });
}

function taskShareOptions(values, selected) {
  return Object.entries(values).map(([id, label]) => `<option value="${escAttr(id)}" ${id === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

function taskShareNodeList(nodes) {
  return nodes.length ? `<ul>${nodes.map(node => `<li>${esc(node.title || '未命名节点')}${taskShareNodeList(node.children)}</li>`).join('')}</ul>` : '';
}

function openTaskShare(taskId, { nodeId = '', noteId = '', trigger, resume } = {}) {
  let snapshot = taskShareSnapshot(taskId, noteId);
  if (!snapshot || !taskShareBridge) return;
  const returnFocus = nodeId ? `.node-title[data-node-id="${CSS.escape(nodeId)}"]` : noteId
    ? `.knowledge-pane[data-task-id="${CSS.escape(noteId)}"] [data-wb-action="more"]` : `.task-share-action[data-task-id="${CSS.escape(taskId)}"]`;
  let selection;
  let preview = null;
  let busy = '';
  let revision = 0;
  let redactPaths = resume?.redactPaths ?? false;
  let prepareTimer;
  let displayed = null;
  let referenceQuery = '';
  const available = () => LoopTaskShare.candidates(snapshot.task, snapshot.documents, snapshot.tabIds);
  const startPreset = preset => {
    if (preset === 'custom' && selection) { selection = { ...selection, preset }; return; }
    selection = { preset, nodeId: preset === 'node' ? nodeId : '', childDepth: 'all', downstreamDepth: '0', records: preset === 'full',
      brief: preset === 'full' || preset === 'brief', flow: ['full', 'flow', 'node'].includes(preset),
      noteIds: preset === 'full' ? available().filter(note => note.defaultSelected).map(note => note.id)
        : preset === 'notes' && noteId ? [noteId] : [], deadline: preset === 'full', priority: preset === 'full' };
  };
  if (resume) selection = resume.selection;
  else startPreset(nodeId ? 'node' : noteId ? 'notes' : 'full');
  const scopes = { ...taskShareScopes };
  if (!nodeId) delete scopes.node;
  const formats = {
    md: { label: 'Markdown', hint: '用文本编辑器阅读', action: '导出 Markdown…' },
    pack: { label: 'Loop 任务包', hint: '可在另一台设备的 Loop 中导入并编辑', action: '导出任务包…' },
    pdf: { label: 'PDF', hint: '以固定版式阅读和打印', action: '导出 PDF…' },
  };
  const formatOptions = Object.fromEntries(Object.entries(formats).map(([key, format]) => [key, format.label]));
  const depthOptions = { all: '全部', 0: '不包含', 1: '1 层', 2: '2 层', 3: '3 层' };
  const sourceTitle = nodeId ? LoopNodeShare.indexNodes(snapshot.task.nodes).get(nodeId)?.title
    : noteId ? available().find(note => note.id === noteId)?.title : snapshot.task.title;
  const initialFormat = resume?.format ?? 'md';
  const disclosure = (label, meta = '') => `<summary class="task-share-disclosure" tabindex="0"><span>${label}</span>${meta}${shellIcon('down')}</summary>`;
  shellKnowledgeDialog(nodeId ? '分享节点' : noteId ? '分享当前笔记' : '分享任务', `
    <div class="task-share-dialog-body task-share-send" data-task-share-dialog>
      <div class="task-share-source">
        <h3>${esc(sourceTitle || (nodeId ? '未命名节点' : noteId ? '未命名笔记' : '未命名任务'))}</h3>
        <p id="task-share-summary" role="status" aria-live="polite"></p>
      </div>
      <div class="task-share-format-row">
        <label for="task-share-format">导出格式<span id="task-share-format-hint"></span></label>
        <select id="task-share-format" aria-describedby="task-share-format-hint">${taskShareOptions(formatOptions, initialFormat)}</select>
      </div>
      <details id="task-share-adjust" ${resume ? 'open' : ''}>
        ${disclosure('调整分享内容', '<span id="task-share-scope-label" class="task-share-meta"></span>')}
        <div class="task-share-settings">
          <label class="task-share-field">范围<select id="task-share-scope">${taskShareOptions(scopes, selection.preset)}</select></label>
          <div id="task-share-options"></div>
          <details id="task-share-preview-details" class="task-share-preview" hidden>
            ${disclosure('查看导出预览', '<span id="task-share-size" class="task-share-meta"></span>')}
            <div id="task-share-preview-lists"></div><pre id="task-share-preview"></pre>
          </details>
          <div class="task-share-tools">
            <button class="text-button" id="task-share-refresh" type="button">刷新内容</button>
            ${nodeId ? '<button class="text-button" id="task-share-relations" type="button">维护后续关联</button>' : ''}
          </div>
        </div>
      </details>
      <div id="task-share-issues" hidden></div>
      <div class="task-share-feedback">
        <p id="task-share-error" class="error" role="alert" hidden></p>
        <button class="text-button" id="task-share-retry" type="button" hidden>重试</button>
        <p id="task-share-receipt" role="status" hidden></p>
        <button class="text-button" id="task-share-reveal" type="button" hidden>在文件夹中显示</button>
      </div>
    </div>`, '<button class="button" data-action="close-dialog" type="button">取消</button><button class="button primary" id="task-share-export" type="button" disabled></button>', 500, returnFocus);
  const dialog = document.querySelector('[data-task-share-dialog]').closest('[role="dialog"]');
  dialog.classList.add('task-share-send-dialog');
  const get = suffix => dialog.querySelector(`#task-share-${suffix}`);
  const setError = (value, retry = false) => {
    get('error').textContent = value;
    get('error').hidden = !value;
    get('retry').hidden = !retry;
  };
  const checkbox = (name, title, checked) => `<label class="node-share-check"><input type="checkbox" data-share-field="${name}" ${checked ? 'checked' : ''}><span>${title}</span></label>`;

  function syncOptions() {
    get('scope').value = selection.preset;
    get('scope-label').textContent = scopes[selection.preset];
    get('format-hint').textContent = formats[get('format').value].hint;
    get('options').querySelector('[data-share-field="records"]').disabled = !selection.flow;
    if (nodeId) get('depth').hidden = !selection.nodeId || !selection.flow;
    get('title-field').hidden = get('format').value !== 'pack' || selection.preset === 'full';
    const selectedNotes=available().filter(note=>selection.noteIds.includes(note.id));
    if (get('note-count')) get('note-count').textContent = `已选 ${selectedNotes.filter(note=>note.relation==='owned').length} 篇`;
    if (get('reference-count')) {
      const count=selectedNotes.filter(note=>note.relation!=='owned').length;
      get('reference-count').textContent=count?`已选 ${count} 篇`:'';
    }
  }

  function noteChoices(notes) {
    return notes.map(note=>`<label class="node-share-check"><input type="checkbox" data-share-note="${escAttr(note.id)}" ${selection.noteIds.includes(note.id)?'checked':''}><span>${esc(note.title)}${note.ownerTitles.length?`<small>所属任务 · ${esc(note.ownerTitles.join('、'))}</small>`:''}</span></label>`).join('');
  }

  function showReferenceNotes() {
    const query=referenceQuery.trim().toLocaleLowerCase();
    const notes=available().filter(note=>note.relation!=='owned'&&
      (query?[note.title,...note.ownerTitles].join(' ').toLocaleLowerCase().includes(query):
        ['open','linked'].includes(note.relation)||note.main||note.id===noteId||selection.noteIds.includes(note.id)));
    get('reference-list').innerHTML=noteChoices(notes)||(query?'<p class="task-share-meta">没有匹配的参考笔记</p>':'');
  }

  function showOptions() {
    const notes = available();
    const notesOpen = get('notes')?.open;
    const referencesOpen=get('references')?.open;
    const owned=notes.filter(note=>note.relation==='owned');
    get('options').innerHTML = `
      <div class="task-share-fields task-share-toggles">
        ${checkbox('brief', '任务简报', selection.brief)}${checkbox('flow', '处理流', selection.flow)}
        ${checkbox('records', '节点记录', selection.records)}
        ${checkbox('priority', '优先级', selection.priority)}${checkbox('deadline', '截止日期', selection.deadline)}
      </div>
      ${nodeId ? `<div id="task-share-depth" class="task-share-fields"><label>子节点深度<select data-share-field="childDepth">${taskShareOptions(depthOptions, selection.childDepth)}</select></label><label>下游关联层数<select data-share-field="downstreamDepth">${taskShareOptions(depthOptions, selection.downstreamDepth)}</select></label></div>` : ''}
      ${owned.length ? `<details id="task-share-notes" ${notesOpen ? 'open' : ''}>${disclosure('本任务笔记', '<span id="task-share-note-count" class="task-share-meta"></span>')}<div class="task-share-notes">${noteChoices(owned)}</div></details>` : ''}
      <details id="task-share-references" ${referencesOpen?'open':''}>
        ${disclosure('额外包含参考笔记','<span id="task-share-reference-count" class="task-share-meta"></span>')}
        <div class="kn-switcher-search task-share-note-search">${shellIcon('search')}<input id="task-share-reference-query" type="search" value="${escAttr(referenceQuery)}" placeholder="搜索其他知识笔记…" aria-label="搜索参考笔记"></div>
        <div class="task-share-notes" id="task-share-reference-list"></div>
      </details>
      <label class="task-share-title" id="task-share-title-field">导入后的任务名（可选）<input maxlength="200" data-share-field="title" value="${escAttr(selection.title || '')}" placeholder="自动取自分享内容"></label>`;
    syncOptions();
    showReferenceNotes();
  }

  function clearReceipt() {
    get('receipt').hidden = true;
    get('reveal').hidden = true;
  }

  function updateExportButton() {
    const incomplete = (preview?.issues.length || get('format').value === 'pdf' && preview?.files.length) && !get('allow-incomplete')?.checked;
    get('export').disabled = Boolean(busy || !preview || incomplete);
    get('export').textContent = busy === 'export' ? '正在导出…' : formats[get('format').value].action;
    get('format').disabled=Boolean(busy);
    get('adjust').inert=Boolean(busy);
    get('issues').inert=Boolean(busy);
    dialog.setAttribute('aria-busy',String(Boolean(busy)));
  }

  function showPrepared(result, project) {
    preview = result;
    displayed = project;
    const count = LoopNodeShare.indexNodes(project.task.nodes).size;
    const ownedNotes=new Set(available().filter(note=>note.relation==='owned').map(note=>note.id));
    const summary = [
      Object.hasOwn(project.task, 'description') && '任务简报',
      count && `${count} 个节点${project.records ? '（含记录）' : ''}`,
      project.notes.length && `${project.notes.length} 篇${project.notes.every(note=>ownedNotes.has(note.id))?'任务':''}笔记`,
      result.files.length && `${result.files.length} 个附件`,
    ];
    get('summary').textContent = summary.filter(Boolean).join(' · ');
    get('preview-details').hidden = false;
    get('size').textContent = `约 ${taskShareSize(result.bytes)}`;
    get('preview').textContent = result.preview;
    const conflicts = available().filter(note => project.notes.some(item => item.id === note.id) && ['EXTERNAL_CHANGED', 'FILE_MISSING'].includes(note.documentState));
    const tree = taskShareNodeList(project.task.nodes);
    get('preview-lists').innerHTML = `
      ${tree ? `<details class="task-share-tree">${disclosure('所选节点')}${tree}</details>` : ''}
      ${result.files.length ? `<details>${disclosure('附件清单')}<ul>${result.files.map(file => `<li>${esc(file.name)} · ${taskShareSize(file.size)}</li>`).join('')}</ul></details>` : ''}
      ${result.references?.length?`<details>${disclosure('外部笔记引用',`<span class="task-share-meta">${result.references.length} 项</span>`)}<ul>${result.references.map(ref=>`<li>${esc(ref.context)} · ${esc(ref.label)}</li>`).join('')}</ul></details>`:''}`;
    const issueGroups=new Map();
    for(const issue of result.issues){
      const key=issue.owner||issue.context||'正文';
      if(!issueGroups.has(key))issueGroups.set(key,[]);
      issueGroups.get(key).push(issue);
    }
    const missingOpen=get('missing')?.open;
    const openSources=new Set([...get('issues').querySelectorAll('[data-share-issue-source][open]')].map(item=>item.dataset.shareIssueSource));
    get('issues').innerHTML = `
      ${result.localPaths?.length ? `<div><p>这些正文中可能有本机路径：${result.localPaths.map(esc).join('、')}</p><label class="node-share-check"><input type="checkbox" id="task-share-redact" ${redactPaths ? 'checked' : ''}>遮盖疑似本机路径</label></div>` : ''}
      ${conflicts.length ? '<p>所选笔记有外部文件变更或缺失。本次使用当前 Loop 草稿，可取消后处理冲突。</p>' : ''}
      ${result.issues.length ? `<details id="task-share-missing" class="task-share-missing" ${missingOpen?'open':''}>
        ${disclosure(`${result.issues.length} 项附件不可用`,`<span class="task-share-meta">${issueGroups.size} 处正文</span>`)}
        <div class="task-share-issue-groups">${[...issueGroups].map(([source,issues])=>`<details data-share-issue-source="${escAttr(source)}" ${openSources.has(source)?'open':''}>
          ${disclosure(esc(issues[0].context||'正文'),`<span class="task-share-meta">${issues.length} 项</span>`)}
          <ul>${issues.map(item=>`<li><span>${esc(item.name)}<small>${esc(item.reason||'附件文件已移动或无法读取。')}</small></span><button type="button" class="button" data-share-locate="${escAttr(item.id)}">重新选择</button></li>`).join('')}</ul>
        </details>`).join('')}</div>
        <label class="node-share-check"><input type="checkbox" id="task-share-allow-incomplete">排除这些附件并保留说明</label>
      </details>` : get('format').value === 'pdf' && result.files.length ? '<label class="node-share-check"><input type="checkbox" id="task-share-allow-incomplete">PDF 中保留附件说明，继续导出</label>' : ''}`;
    get('issues').hidden = !get('issues').childElementCount;
    updateExportButton();
  }

  function queuePreview() {
    const sequence = ++revision;
    clearTimeout(prepareTimer);
    if (preview?.token) void taskShareBridge.cancel(preview.token);
    preview = null;
    clearReceipt();
    updateExportButton();
    setError('');
    get('issues').replaceChildren();
    get('issues').hidden = true;
    get('preview-details').hidden = true;
    get('preview').textContent = '';
    const project = LoopTaskShare.project(snapshot, {
      ...selection,
      title: get('format').value === 'pack' && selection.preset !== 'full' ? selection.title : '',
    });
    if (!project.task.nodes.length && !project.notes.length && !Object.hasOwn(project.task, 'description')) {
      get('summary').textContent = '请选择要分享的内容。';
      return;
    }
    get('summary').textContent = '正在准备分享内容…';
    prepareTimer = setTimeout(async () => {
      try {
        const result = await taskShareBridge.prepare({ source: { taskId, ...project, redactPaths } });
        if (!dialog.isConnected || sequence !== revision) { if (result?.token) void taskShareBridge.cancel(result.token); return; }
        if (!result.success) throw new Error(result.message);
        showPrepared(result, project);
      } catch (error) {
        if (!dialog.isConnected || sequence !== revision) return;
        get('summary').textContent = '预览未完成。';
        setError(taskShareFailure(error), true);
      }
    }, 150);
  }

  get('scope').onchange = () => {
    startPreset(get('scope').value);
    showOptions();
    if (selection.preset === 'notes' && !noteId && get('notes')) get('notes').open = true;
    queuePreview();
  };
  get('format').onchange = () => {
    syncOptions();
    clearReceipt();
    if (selection.title) { queuePreview(); return; }
    if (preview) {
      setError('');
      showPrepared(preview, displayed);
    } else updateExportButton();
  };
  get('options').onchange = event => {
    const { shareField, shareNote } = event.target.dataset;
    if (shareField === 'title'||(!shareField&&!shareNote)) return;
    if (shareField) selection[shareField] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    if (shareNote) selection.noteIds = event.target.checked ? [...selection.noteIds, shareNote] : selection.noteIds.filter(id => id !== shareNote);
    if (!selection.flow) {
      selection.records = false;
      get('options').querySelector('[data-share-field="records"]').checked = false;
    }
    if (!['childDepth', 'downstreamDepth'].includes(shareField)) selection.preset = 'custom';
    syncOptions();
    queuePreview();
  };
  get('options').oninput = event => {
    if(event.target.id==='task-share-reference-query'){
      referenceQuery=event.target.value;
      showReferenceNotes();
      return;
    }
    if (event.target.dataset.shareField !== 'title') return;
    selection.title = event.target.value;
    queuePreview();
  };
  get('issues').onchange = event => {
    if (event.target.id === 'task-share-redact') { redactPaths = event.target.checked; queuePreview(); }
    else updateExportButton();
  };
  get('issues').onclick = async event => {
    const issueId = event.target.closest('[data-share-locate]')?.dataset.shareLocate;
    if (!issueId || !preview || busy) return;
    const token = preview.token;
    event.target.disabled = true;
    busy = 'locate';
    updateExportButton();
    try {
      const result = await taskShareBridge.locate({ token, issueId });
      if (!dialog.isConnected || preview?.token !== token || result.canceled) return;
      if (!result.success) throw new Error(result.message);
      showPrepared(result, displayed);
    } catch (error) { if (dialog.isConnected) setError(taskShareFailure(error)); }
    finally {
      busy = '';
      if (event.target.isConnected) event.target.disabled = false;
      if (dialog.isConnected) updateExportButton();
    }
  };
  get('retry').onclick = get('refresh').onclick = () => {
    snapshot = taskShareSnapshot(taskId, noteId) || snapshot;
    if (selection.preset === 'full') selection.noteIds = available().filter(note => note.defaultSelected).map(note => note.id);
    else selection.noteIds = available().filter(note => selection.noteIds.includes(note.id)).map(note => note.id);
    showOptions();
    queuePreview();
  };
  if (nodeId) get('relations').onclick = () => {
    const settings = { selection, format: get('format').value, redactPaths };
    openNodeShare(taskId, nodeId, trigger, { onReturn: () => openTaskShare(taskId, { nodeId, trigger, resume: settings }) });
  };
  get('export').onclick = async () => {
    if (!preview || busy) return;
    const token = preview.token;
    const format = get('format').value;
    busy = 'export';
    clearReceipt();
    updateExportButton();
    setError('');
    try {
      const html = format === 'pdf' ? renderMarkdown(preview.document) : '';
      const result = await taskShareBridge.export({ token, format, allowIncomplete: Boolean(get('allow-incomplete')?.checked), html });
      if (!dialog.isConnected || result.canceled) return;
      if (!result.success && !result.filePath) throw new Error(result.message);
      get('receipt').hidden = false;
      get('receipt').textContent = result.fileName ? `已导出 ${result.fileName}` : '已导出文件';
      get('reveal').hidden = !result.fileName;
      get('reveal').onclick = () => void taskShareBridge.reveal({ token });
    } catch (error) { if (dialog.isConnected) setError(taskShareFailure(error)); }
    finally { busy = ''; if (dialog.isConnected) updateExportButton(); }
  };
  taskShareCloseObserver(dialog, () => { clearTimeout(prepareTimer); if (preview?.token) void taskShareBridge.cancel(preview.token); });
  showOptions();
  queuePreview();
  if (resume) get('relations')?.focus();
}

async function openTaskPackageImport() {
  if (!taskShareBridge || dataProtectionMessage || dataTransferInProgress || taskShareCommitBusy) return;
  const returnFocus = '[data-action="import-task-share"]';
  shellKnowledgeDialog('导入任务包', '<div class="task-share-dialog-body"><p id="task-share-import-status" role="status">正在检查任务包…</p><div id="task-share-import-details"></div><p id="task-share-import-error" class="error" role="alert" hidden></p></div>',
    '<button class="button" data-action="close-dialog" type="button">取消</button><button class="button primary" id="task-share-import-confirm" type="button" disabled>导入为新任务</button>', 640, returnFocus);
  const confirm = document.querySelector('#task-share-import-confirm');
  const dialog = confirm.closest('[role="dialog"]');
  const details = dialog.querySelector('#task-share-import-details');
  const status = dialog.querySelector('#task-share-import-status');
  const error = dialog.querySelector('#task-share-import-error');
  const showError = message => { error.hidden = !message; error.textContent = message; };
  let preview;
  taskShareCloseObserver(dialog, () => { if (preview?.token) void taskShareBridge.cancel(preview.token); });
  try { preview = await taskShareBridge.inspect(); }
  catch (failure) { preview = { success: false, message: taskShareFailure(failure) }; }
  if (!dialog.isConnected) { if (preview.token) void taskShareBridge.cancel(preview.token); return; }
  if (preview.canceled) { shellCloseOverlay(); return; }
  if (!preview.success) { status.textContent = '无法读取任务包。'; showError(preview.message); return; }
  status.textContent = `${preview.scope} · ${preview.nodeCount} 个节点 · ${preview.records ? '包含记录' : '未选记录'} · ${preview.notes.length} 篇笔记 · ${preview.files.length} 个附件 · 约 ${taskShareSize(preview.bytes)}`;
  details.innerHTML = `
    <div class="task-share-fields"><label>任务名称<input id="task-share-import-title" maxlength="200" value="${escAttr(preview.title)}"></label>
    <label>分组<select id="task-share-import-group"><option value="">未分组</option>${state.taskGroups.map(group => `<option value="${escAttr(group.id)}">${esc(group.title)}</option>`).join('')}</select></label></div>
    <p>${preview.taskStatus === 'done' ? '已完成' : '处理中'}${preview.deadlineAt ? ` · 截止 ${esc(new Date(preview.deadlineAt).toLocaleString())}` : ''} · 提醒关闭 · 无重复计划</p>
    ${preview.notes.length ? `<details><summary>笔记将作为 Loop 草稿导入</summary><ul>${preview.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul></details>` : ''}
    ${preview.files.length ? `<details><summary>附件清单</summary><ul>${preview.files.map(file => `<li>${esc(file.name)} · ${taskShareSize(file.size)}</li>`).join('')}</ul></details>` : ''}
    ${preview.status?.added?.length ? `<p>新增节点状态：${preview.status.added.map(item => esc(item.name)).join('、')}</p>` : ''}
    <div id="task-share-status-map"></div>`;
  const stateMap = dialog.querySelector('#task-share-status-map');
  function showConflicts(conflicts, choices) {
    if (!conflicts?.length) return;
    stateMap.innerHTML = `<p>自定义状态已达上限，请选择对应状态。</p>${conflicts.map(item => `<label>${esc(item.name)}<select data-share-status="${escAttr(item.id)}"><option value="">请选择</option>${choices.map(choice => `<option value="${escAttr(choice.id)}">${esc(choice.name)}</option>`).join('')}</select></label>`).join('')}`;
  }
  showConflicts(preview.status?.conflicts, preview.status?.choices);
  confirm.disabled = false;
  confirm.onclick = async () => {
    if (confirm.disabled || taskShareCommitBusy) return;
    const title = details.querySelector('#task-share-import-title').value.trim();
    const groupId = details.querySelector('#task-share-import-group').value;
    const statusMap = Object.fromEntries([...stateMap.querySelectorAll('select')].map(item => [item.dataset.shareStatus, item.value]));
    if (!title) { showError('请输入任务名称。'); return; }
    if (Object.values(statusMap).some(value => !value)) { showError('请选择对应的节点状态。'); return; }
    confirm.disabled = true;
    confirm.textContent = '正在写入…';
    showError('');
    try {
      await flushAllDataForTransfer();
      if (!dialog.isConnected) return;
      taskShareCommitBusy = true;
      const result = await taskShareBridge.commit({ token: preview.token, title, groupId, statusMap, revision: taskShareRevision });
      if (!result.success) {
        showConflicts(result.statusConflicts, result.availableStatuses);
        throw new Error(result.message);
      }
      taskShareRevision = result.revision;
      if (!state.tasks.some(task => task.id === result.task.id)) {
        state.tasks.push(result.task);
        state.knowledgeDocuments.push(...result.documents);
        state.knowledgeWorkspace.tabsByTask[result.task.id] = result.tabs;
        state.knowledgeWorkspace.lastByTask[result.task.id] = result.tabs[0] || '';
        state.nodeStates = result.nodeStates;
      }
      pendingPayload = null;
      taskShareCommitBusy = false;
      save();
      publishDeadlineReminderSnapshot();
      status.textContent = `已导入「${result.task.title}」。`;
      details.hidden = true;
      confirm.textContent = '打开任务';
      confirm.onclick = () => {
        shellCloseOverlay({ restoreFocus: false });
        state.taskPane = result.tabs.length && !result.task.nodes.length ? 'notes' : 'flow';
        openTaskFromGlobalList(result.task.id);
        render();
      };
    } catch (failure) {
      showError(taskShareFailure(failure));
      confirm.textContent = '导入为新任务';
    } finally {
      const wasBusy = taskShareCommitBusy;
      taskShareCommitBusy = false;
      if (wasBusy) save();
      confirm.disabled = false;
    }
  };
}

/* Knowledge notes remain task.notes + task.knowledgeNote, persisted by Loop's
   existing storage/recovery/file IPC. This replaces phase23's competing receipts. */
const knowledgeFileWriteBusy = new Set();
const knowledgeSaveQueue = new LoopKnowledgeCore.SerialQueue();
const knowledgeAutosaveTimers = new Map();
const knowledgeSaveResults = new Map();
const knowledgePanels = new Set();
const knowledgeGenerations = new Map();
const knowledgeBacklinkCache = new Map();
const knowledgeDeferredFileEvents = new Map();
let knowledgeIndexTimer = 0;

function knowledgeNotes() { return state.tasks.filter(task => task.knowledgeNote && !task.knowledgeNote.isDeleted && (knowledgeText(task).length || task.knowledgeNote.filePath || (task.id===state.activeTaskId && state.taskPane==='notes'))); }
function knowledgeText(task) { return nodeNoteDrafts.get(noteDraftKey(task.id, ''))?.markdown ?? task.notes ?? ''; }
function knowledgeCurrentEntry(taskId = state.activeTaskId) { return milkdownEditors.get(noteDraftKey(taskId, ''))?.instance; }
function knowledgeDetail(task) {
  const group = state.taskGroups.find(g => g.id === task.groupId)?.title || '未分组';
  return `${group} · ${task.title} · ${LoopKnowledgeCore.noteId(task).slice(-8)}`;
}
function knowledgeRendererForTask(task) { return LoopKnowledgeEditor.createRenderer(knowledgeEditorOptions(task)); }
function knowledgeEditorOptions(task) {
  const noteId = LoopKnowledgeCore.noteId(task);
  return { noteId, getNotes: knowledgeNotes, getCurrentNote: () => state.tasks.find(t => t.id === task.id),
    getContent: knowledgeText, noteDetail: knowledgeDetail,
    resolveImage: (_id, source) => {
      if (source.startsWith('task-image:')) return state.attachments?.images?.[source.slice(11)] || '';
      const scope=state.knowledgeAssetScopes?.[_id]||{};
      if(scope[source])return scope[source];
      try{return scope[decodeURIComponent(source)]||'';}catch{return '';}
    },
    onSelectionChange: () => { shellRefreshNoteFormatState(); knowledgeUpdateOutlineActive(task); },
    onSave: () => void saveKnowledgeTask(task.id),
    onToggleMode: () => knowledgeSetMode(shellKnowledgeMode() === 'preview' ? 'edit' : 'preview'),
    onEditForSearch: () => knowledgeSetMode('source'),
    onOpenLink: link => knowledgeOpenLink(link, task),
    onRelativeLink: url => knowledgeOpenRelative(url, task),
    onExternalLink: url => { if (/^(https?:|mailto:)/i.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); },
    uploadImage: async (dataUrl, fileName) => {
      if (!state.tasks.includes(task)) throw new Error('笔记已删除');
      const imageId = id('image'), reference = 'task-image:' + imageId;
      // Reuse the managed attachment staging API. In the production desktop
      // environment success means the image is already durable on disk.
      if (!desktopKnowledgeFile?.stageAssets) throw new Error('请在 Loop 桌面应用中上传图片');
      const receipt = await desktopKnowledgeFile.stageAssets({noteId, assets: [{source: reference, dataUrl}]});
      if (receipt?.success === false) throw new Error(receipt.message || '图片暂存失败');
      if (!state.tasks.includes(task)) throw new Error('笔记已删除');
      state.attachments = normalizeAttachments(state.attachments);
      state.attachments.images[imageId] = dataUrl;
      save(); if (!(await flushSave())) throw new Error('附件记录未能保存，请重试');
      return `![${String(fileName || '图片').replace(/[\[\]\r\n]/g, ' ')}](${reference})`;
    },
  };
}
function knowledgeSetMode(mode) {
  captureMountedMilkdownDrafts(); flushNodeNoteDrafts({persist:true});
  state.markdownMode = mode; render();
}
function knowledgeReceipt(task) {
  const status = knowledgeSaveResults.get(task.id), note = task.knowledgeNote;
  if (knowledgeFileWriteBusy.has(task.id)) return {text:'保存中…', state:'saving'};
  if (status?.error) return {text:'保存失败 · 点击保存重试', state:'failed'};
  if (['EXTERNAL_CHANGED','FILE_MISSING','READ_ONLY'].includes(note.documentState)) return {text:SHELL_KNOWLEDGE_STATE_LABELS[note.documentState]+' · 当前草稿保留',state:'conflict'};
  if (nodeNoteDrafts.has(noteDraftKey(task.id,'')) || knowledgeAutosaveTimers.has(task.id)) return {text:'等待保存…',state:'pending'};
  if (localSaveOutcome === 'failed') return {text:'本地保存失败 · 草稿保留',state:'failed'};
  if (note.filePath && note.dirty) return {text:'草稿已保留 · 文件尚未同步',state:'pending'};
  if (!note.filePath && (pendingPayload || saveInFlight)) return {text:'正在保留草稿…',state:'pending'};
  return {text:note.filePath ? '已保存到文件' : '已保存到 Loop',state:'saved'};
}
function knowledgeUpdateChrome(task) {
  const pane = document.querySelector('.knowledge-pane');
  if (!pane || pane.dataset.taskId !== task?.id) return;
  const noteState=shellKnowledgeState(task),file=shellKnowledgeFileName(task.knowledgeNote);
  pane.dataset.knowledgeState=noteState.key;
  const title=pane.querySelector('.kn-note-title');
  if(title)title.title=`重命名笔记 · ${noteState.label} · ${file.text} · ${file.title}`;
  const receipt = knowledgeReceipt(task), target = pane.querySelector('[data-kn-receipt]');
  if (target) {target.textContent = receipt.text;target.dataset.state=receipt.state;target.title=knowledgeSaveResults.get(task.id)?.error||receipt.text;}
  const saveButton = pane.querySelector('[data-note-save]');
  if (saveButton) {saveButton.disabled=knowledgeFileWriteBusy.has(task.id); saveButton.innerHTML=shellIcon('check')+(knowledgeFileWriteBusy.has(task.id)?'保存中…':'保存');}
  const meta=pane.querySelector('.knowledge-file-meta');
  if(meta && !meta.querySelector('[data-kn-action="rename"]')) meta.innerHTML=`<button type="button" class="kn-note-title" data-kn-action="rename" title="重命名笔记">${esc(LoopKnowledgeCore.noteTitle(task))}</button>`;
  const statsTarget=pane.querySelector('[data-note-stats]');
  if(statsTarget){const text=knowledgeText(task),characters=[...text].length,words=(text.match(/[\p{Script=Han}]/gu)||[]).length+(text.match(/[\p{L}\p{N}]+/gu)||[]).filter(word=>!/[\p{Script=Han}]/u.test(word)).length;statsTarget.textContent=`${words} 字/词 · ${characters} 字符`;}
  pane.querySelector('[data-note-recovery]')?.remove();
}
// Names used by the old draft hooks now have one implementation and one state.
function note23EvaluateDraft(task) { knowledgeUpdateChrome(task); }
function note23UpdateChrome(task) { knowledgeUpdateChrome(task); }
function note23Headings(text) { return LoopKnowledgeCore.headings(text); }
function note23FileName(task) { return LoopKnowledgeCore.noteTitle(task); }
function note23RefreshOutline(task) { knowledgeRefreshPanels(task); }

function knowledgeDidEdit(taskId) {
  const task = state.tasks.find(t => t.id === taskId); if(!task)return;
  knowledgeSaveResults.delete(taskId);
  clearTimeout(knowledgeAutosaveTimers.get(taskId));
  knowledgeAutosaveTimers.set(taskId,setTimeout(()=>{
    knowledgeAutosaveTimers.delete(taskId);
    const entry=knowledgeCurrentEntry(taskId);
    if(entry?.view?.composing){knowledgeDidEdit(taskId);return;}
    void knowledgeAutoSave(taskId);
  },1200));
  knowledgeUpdateChrome(task);
  clearTimeout(knowledgeIndexTimer);knowledgeIndexTimer=setTimeout(()=>knowledgeRefreshPanels(task),500);
}
async function knowledgeAutoSave(taskId) {
  const task=state.tasks.find(t=>t.id===taskId); if(!task)return;
  if(task.knowledgeNote.filePath) {
    if(['SAVED','DIRTY'].includes(task.knowledgeNote.documentState)) await saveKnowledgeTask(taskId,{automatic:true});
    return;
  }
  return knowledgeSaveQueue.run(taskId,async()=>{
    if(!state.tasks.includes(task))return {canceled:true};
    knowledgeFileWriteBusy.add(taskId);knowledgeUpdateChrome(task);
    try {
      captureMountedMilkdownDrafts();flushNodeNoteDraft(noteDraftKey(taskId,''),{persist:true});
      const content=task.notes;
      await flushKnowledgeRecovery(task.knowledgeNote.noteId,{strict:true});
      await knowledgeRecoveryWriteQueue;
      save();if(!(await flushSave()))throw new Error('本地笔记未能持久化');
      knowledgeSaveResults.set(taskId,{content});
      return {success:true,content,internal:true};
    }catch(error){knowledgeSaveResults.set(taskId,{error:error.message});return {success:false,message:error.message};}
    finally{knowledgeFileWriteBusy.delete(taskId);knowledgeUpdateChrome(task);const pane=document.querySelector('.knowledge-pane');if(pane?.dataset.taskId===taskId)knowledgeSyncNotice(task,pane);}
  });
}
const knowledgePriorSave = saveKnowledgeTask;
saveKnowledgeTask = function knowledgeSerializedSave(taskId, options={}) {
  clearTimeout(knowledgeAutosaveTimers.get(taskId));knowledgeAutosaveTimers.delete(taskId);
  const unbound=state.tasks.find(t=>t.id===taskId);
  if(unbound && !unbound.knowledgeNote.filePath && !options.saveAs) return knowledgeAutoSave(taskId);
  return knowledgeSaveQueue.run(taskId,async()=>{
    const task=state.tasks.find(t=>t.id===taskId);if(!task)return {canceled:true};
    const generation=knowledgeGenerations.get(taskId)||0;
    knowledgeFileWriteBusy.add(taskId);knowledgeSaveResults.delete(taskId);knowledgeUpdateChrome(task);
    let result;
    try {
      // Recovery must land before a disk write or a user-selected Save As path.
      captureMountedMilkdownDrafts();flushNodeNoteDraft(noteDraftKey(taskId,''),{persist:true});
      await flushKnowledgeRecovery(task.knowledgeNote.noteId,{strict:true});
      result=await knowledgePriorSave(taskId,options);
      if((knowledgeGenerations.get(taskId)||0)!==generation)return result;
      if(result?.success)knowledgeSaveResults.set(taskId,{content:result.content??task.notes});
      else if(!result?.canceled)knowledgeSaveResults.set(taskId,{error:result?.message||'保存未完成，请重试'});
    }catch(error){result={success:false,code:'SAVE_FAILED',message:error.message};knowledgeSaveResults.set(taskId,{error:error.message});}
    finally{
      knowledgeFileWriteBusy.delete(taskId);knowledgeUpdateChrome(task);
      if(knowledgeDeferredFileEvents.has(taskId)){knowledgeDeferredFileEvents.delete(taskId);void knowledgeInspectDeferredChange(task);}
      const pane=document.querySelector('.knowledge-pane');
      if(pane?.dataset.taskId===taskId)knowledgeSyncNotice(task,pane);
    }
    return result;
  });
};
function knowledgeSyncNotice(task,pane) {
  pane.querySelector('[data-kn-save-error]')?.remove();
  const error=knowledgeSaveResults.get(task.id)?.error;
  if(!error)return;
  const notice=document.createElement('div');notice.className='knowledge-notice attention';notice.dataset.knSaveError='true';notice.setAttribute('role','status');
  const text=document.createElement('span');text.textContent=error;notice.append(text);
  const retry=document.createElement('button');retry.type='button';retry.className='text-button';retry.textContent='重试';retry.onclick=()=>void saveKnowledgeTask(task.id);notice.append(retry);
  if(task.knowledgeNote.documentState==='EXTERNAL_CHANGED') {
    const resolve=document.createElement('button');resolve.type='button';resolve.className='text-button';resolve.textContent='处理冲突';resolve.onclick=()=>shellKnowledgeConflict(task);notice.append(resolve);
  }
  pane.querySelector('.knowledge-header')?.after(notice);
}
function knowledgeRefreshPanels(task) {
  const pane=document.querySelector('.knowledge-pane');if(pane?.dataset.taskId!==task?.id)return;
  const body=pane.querySelector('.knowledge-body');if(!body)return;
  let aside=pane.querySelector('.kn-side-panel');
  const open=knowledgePanels.has(task.id);
  pane.querySelector('.knowledge-header [data-kn-action="panels"]')?.setAttribute('aria-expanded',String(open));
  if(!open){aside?.remove();return;}
  if(!aside){aside=document.createElement('aside');aside.className='kn-side-panel';aside.id='kn-side-panel';aside.setAttribute('aria-label','大纲与关联笔记');body.append(aside);}
  const headings=LoopKnowledgeCore.headings(knowledgeText(task));
  const backlinks=[];
  for(const note of knowledgeNotes()){
    if(note.id===task.id)continue;
    const text=knowledgeText(note);let cached=knowledgeBacklinkCache.get(note.id);
    if(cached?.text!==text){cached={text,links:LoopKnowledgeCore.links(text)};knowledgeBacklinkCache.set(note.id,cached);}
    if(cached.links.some(link=>LoopKnowledgeCore.resolve(link.target,knowledgeNotes(),note).note?.id===task.id))backlinks.push(note);
  }
  const base=Math.min(...headings.map(h=>h.level),6);
  const html=`<header><strong>大纲</strong><button type="button" class="icon-button" data-kn-action="panels" aria-label="关闭关联面板">${shellIcon('close')}</button></header><nav aria-label="笔记大纲">${headings.length?headings.map((h,i)=>`<button type="button" class="kn-outline-link" style="padding-left:${8+(h.level-base)*12}px" data-kn-heading="${i}" title="${escAttr(h.text)}">${esc(h.text)}</button>`).join(''):'<p>添加标题后会显示在这里</p>'}</nav><h4>反向链接 <small>${backlinks.length}</small></h4>${backlinks.map(note=>`<button type="button" class="kn-backlink" data-kn-note="${escAttr(note.id)}">${esc(LoopKnowledgeCore.noteTitle(note))}<small>${esc(knowledgeDetail(note))}</small></button>`).join('')||'<p>暂无笔记引用</p>'}`;
  if(aside.knowledgeHTML!==html){aside.innerHTML=html;aside.knowledgeHTML=html;}
  knowledgeUpdateOutlineActive(task);
}
function knowledgeUpdateOutlineActive(task) {
  if(!knowledgePanels.has(task.id))return;
  const editor=knowledgeCurrentEntry(task.id);if(!editor)return;
  const headings=LoopKnowledgeCore.headings(editor.getEditorText()),pos=editor.view.state.selection.main.head;
  const index=headings.findLastIndex(h=>h.offset<=pos);
  document.querySelectorAll('.kn-side-panel [data-kn-heading]').forEach(button=>{
    if(Number(button.dataset.knHeading)===index)button.setAttribute('aria-current','location');
    else button.removeAttribute('aria-current');
  });
}
function knowledgeOpen(task,anchor='') {
  captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});void flushPendingKnowledgeRecoveries();
  openTaskFromGlobalList(task.id);
  state.activeTaskId=task.id;state.selectedNodeId='';state.taskPane='notes';state.settingsOpen=false;state.reviewOpen=false;state.calendarOpen=false;
  shellCloseOverlay({restoreFocus:false});render();
  if(anchor){let attempts=0;const locate=()=>{const editor=knowledgeCurrentEntry(task.id);if(editor)editor.locateAnchor(anchor);else if(attempts++<30)requestAnimationFrame(locate);};requestAnimationFrame(locate);}
}
function knowledgeOpenLink(link,origin) {
  const resolved=LoopKnowledgeCore.resolve(link.target,knowledgeNotes(),origin);
  if(resolved.status==='resolved'){knowledgeOpen(resolved.note,link.anchor);return;}
  if(resolved.status==='ambiguous'){knowledgeShowSwitcher('',resolved.candidates,link.anchor);return;}
  const deleted=state.tasks.find(task=>task.knowledgeNote?.isDeleted && (link.target==='note:'+LoopKnowledgeCore.noteId(task)||LoopKnowledgeCore.noteTitle(task)===link.target));
  const archived=deleted && state.recentlyDeleted.find(entry=>entry.kind==='note' && entry.ownerTaskId===deleted.id);
  if(archived){
    shellKnowledgeDialog('目标笔记已移除',`<p class="knowledge-dialog-copy">${esc(LoopKnowledgeCore.noteTitle(deleted))} 可从最近删除中恢复。</p>`,'<button class="button" data-action="close-dialog">取消</button><button class="button primary" id="kn-restore-target">恢复笔记</button>');
    document.querySelector('#kn-restore-target').onclick=async()=>{await recovery26RestoreMany([archived.id],{restoreMoved:true});const restored=state.tasks.find(task=>task.id===deleted.id);if(restored)knowledgeOpen(restored,link.anchor);};return;
  }

  shellKnowledgeDialog('目标笔记不存在',`<p class="knowledge-dialog-copy">${esc(link.target)} 尚未创建。</p>`,'<button class="button" data-action="close-dialog">取消</button><button class="button primary" data-kn-action="create-missing">创建笔记</button>');
  document.querySelector('[data-kn-action="create-missing"]').onclick=()=>knowledgeCreate(link.target,origin,link.anchor);
}
function knowledgeOpenRelative(url,origin) {
  let decoded;try{decoded=decodeURIComponent(url);}catch{decoded=url;}
  const [path,anchor='']=decoded.split('#');
  if(!path){knowledgeCurrentEntry(origin.id)?.locateAnchor(anchor);return;}
  const normalize=value=>{const parts=[];for(const p of value.replaceAll('\\','/').split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}return parts.join('/');};
  const parent=origin.knowledgeNote.filePath?.replaceAll('\\','/').split('/').slice(0,-1).join('/');
  const expected=parent?normalize(parent+'/'+path):null;
  const byPath=expected?knowledgeNotes().filter(note=>normalize(note.knowledgeNote.filePath||'')===expected):[];
  if(byPath.length===1){knowledgeOpen(byPath[0],anchor);return;}
  knowledgeOpenLink({target:path.replace(/\.md$/i,''),anchor},origin);
}
async function knowledgeCreate(title,origin=state.tasks.find(t=>t.id===state.activeTaskId),anchor='') {
  title=String(title).trim();if(!title || title.startsWith('note:')){knowledgeShowSwitcher();return;}
  const task=createTask(title,false);task.groupId=origin?.groupId||task.groupId;state.focusTaskTitleId='';
  task.notes='# '+title.replace(/[\r\n]/g,' ')+'\n\n';task.knowledgeNote=knowledgeDocument.markDocumentEdited(task.knowledgeNote);
  scheduleKnowledgeRecovery(task.id,task.notes);save();knowledgeDidEdit(task.id);knowledgeOpen(task,anchor);
}
function knowledgeShowSwitcher(query='',candidates=null,anchor='') {
  shellKnowledgeDialog('知识笔记',`<div class="kn-switcher-search"><input id="kn-switcher-query" type="search" placeholder="搜索标题、正文或标签…" autocomplete="off" value="${escAttr(query)}" aria-label="搜索笔记"><button class="button" type="button" id="kn-create-note">新建</button></div><div id="kn-switcher-list" class="kn-switcher-list" role="listbox" aria-label="笔记列表"></div>`, '<button class="button" type="button" data-action="close-dialog">关闭</button>');
  const input=document.querySelector('#kn-switcher-query'),list=document.querySelector('#kn-switcher-list');let selected=0,current=[];
  const refresh=()=>{
    const q=input.value.toLocaleLowerCase().trim();current=(candidates||knowledgeNotes()).filter(n=>(LoopKnowledgeCore.noteTitle(n)+'\n'+knowledgeDetail(n)+'\n'+knowledgeText(n)).toLocaleLowerCase().includes(q)).slice(0,80);selected=Math.min(selected,Math.max(0,current.length-1));
    list.innerHTML=current.map((n,i)=>`<button class="kn-switcher-row" type="button" role="option" aria-selected="${i===selected}" data-kn-switch="${escAttr(n.id)}"><strong>${esc(LoopKnowledgeCore.noteTitle(n))}</strong><small>${esc(knowledgeDetail(n))}</small></button>`).join('')||'<p>没有匹配的笔记。可用当前名称新建。</p>';
  };
  input.addEventListener('input',()=>{selected=0;refresh();});input.addEventListener('keydown',event=>{
    if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();selected=(selected+(event.key==='ArrowDown'?1:Math.max(0,current.length-1)))%Math.max(1,current.length);refresh();list.children[selected]?.scrollIntoView({block:'nearest'});}
    if(event.key==='Enter'){event.preventDefault();if(current[selected])knowledgeOpen(current[selected],anchor);else if(input.value.trim())void knowledgeCreate(input.value);}
  });
  list.onclick=event=>{const row=event.target.closest('[data-kn-switch]');const note=state.tasks.find(t=>t.id===row?.dataset.knSwitch);if(note)knowledgeOpen(note,anchor);};
  document.querySelector('#kn-create-note').onclick=()=>{
    if(input.value.trim())void knowledgeCreate(input.value);
    else {input.placeholder='输入新笔记名称';input.focus();}
  };
  refresh();input.focus();
}
function knowledgeRename(task) {
  shellKnowledgeDialog('重命名笔记',`<label class="knowledge-dialog-copy" for="kn-rename-title">笔记名称</label><input id="kn-rename-title" value="${escAttr(LoopKnowledgeCore.noteTitle(task))}" maxlength="200">`,'<button class="button" data-action="close-dialog">取消</button><button class="button primary" id="kn-rename-commit">保存名称</button>');
  const field=document.querySelector('#kn-rename-title');field.focus();field.select();
  const commit=async()=>{const title=field.value.trim();if(!title)return;
    const previous=task.knowledgeNote;task.knowledgeNote=knowledgeDocument.updateDocumentTitle(previous,title);task.updatedAt=now();save();
    if(!(await flushSave())){task.knowledgeNote=previous;showWorkspaceError('重命名未能保存，请重试');return;}
    shellCloseOverlay();knowledgeCurrentEntry(task.id)?.refresh();render();
  };
  document.querySelector('#kn-rename-commit').onclick=commit;field.onkeydown=event=>{if(event.key==='Enter')void commit();};
}
function knowledgeTableTools() {
  const editor=knowledgeCurrentEntry();if(!editor)return;
  const table=LoopKnowledgeCore.tableAt(editor.getEditorText(),editor.view.state.selection.main.head);
  if(!table){shellToast('请先将光标放入表格的源码单元格。');return;}
  shellKnowledgeDialog('编辑表格',`<div class="kn-table-controls"><label>列 <select id="kn-table-column">${table.rows[0].map((_,i)=>`<option value="${i}" ${i===(editor.tableColumn||0)?'selected':''}>${i+1}</option>`).join('')}</select></label><label>单元格 <input id="kn-table-value" value="${escAttr(table.rows[table.row]?.[editor.tableColumn||0]||'')}"></label><button class="button" data-kn-table="cell">更新单元格</button><button class="button" data-kn-table="row-add">在下方插入行</button><button class="button" data-kn-table="row-delete">删除当前行</button><button class="button" data-kn-table="column-add">在右侧插入列</button><button class="button" data-kn-table="column-delete">删除当前列</button><label>对齐 <select id="kn-table-align"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label><button class="button" data-kn-table="align">应用对齐</button></div>`,'<button class="button" data-action="close-dialog">关闭</button>');
  const column=document.querySelector('#kn-table-column'),value=document.querySelector('#kn-table-value');
  column.onchange=()=>value.value=table.rows[table.row]?.[Number(column.value)]||'';
  document.querySelectorAll('[data-kn-table]').forEach(button=>button.onclick=()=>{const operation=button.dataset.knTable,idx=Number(column.value),v=operation==='align'?document.querySelector('#kn-table-align').value:value.value;
    shellCloseOverlay({restoreFocus:false});if(!editor.table(operation,idx,v))shellToast('当前行或列不能执行此操作。');
  });
}
const knowledgePriorBind = shellBindKnowledge;
shellBindKnowledge = function() {
  knowledgePriorBind();
  const task=state.tasks.find(t=>t.id===state.activeTaskId);if(!task||!document.querySelector('.knowledge-pane'))return;
  knowledgeCurrentEntry(task.id)?.setMode(shellKnowledgeMode());knowledgeUpdateChrome(task);knowledgeRefreshPanels(task);
};
function knowledgeInsertMenu(trigger) {
  const item=(action,icon,label,extra='')=>`<button class="button" type="button" role="menuitem" data-kn-action="${action}" ${extra}>${shellIcon(icon)}${label}</button>`;
  shellMountSurface(`<div class="surface-popover kn-insert-menu" role="menu" aria-label="插入与更多格式">
    ${item('insert-format','knowledgeTable','表格','data-kn-format="table"')}
    ${item('table-tools','knowledgeTable','编辑表格行列…')}
    ${item('insert-format','knowledgeCode','代码块','data-kn-format="code"')}
    ${item('upload','knowledgeImage','图片…')}
    <div class="menu-divider"></div>
    ${item('insert-format','noteQuote','引用','data-kn-format="quote"')}
    ${item('insert-format','noteOrdered','有序列表','data-kn-format="ordered"')}
    ${item('insert-format','noteStrike','删除线','data-kn-format="strike"')}
    ${item('insert-format','noteRule','分隔线','data-kn-format="rule"')}
  </div>`,trigger,210);
  const menu=document.querySelector('.kn-insert-menu');
  if(menu)menu.dataset.returnFocus='[data-kn-action="insert-menu"]';
  menu?.querySelector('button')?.focus({preventScroll:true});
  menu?.addEventListener('keydown',event=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const items=[...menu.querySelectorAll('[role="menuitem"]')],index=items.indexOf(document.activeElement);
    items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();
  });
}
document.addEventListener('click',event=>{
  const heading=event.target.closest('[data-kn-heading]');if(heading){const task=state.tasks.find(t=>t.id===state.activeTaskId),h=LoopKnowledgeCore.headings(knowledgeCurrentEntry()?.getEditorText()||LoopKnowledgeCore.sourceFormat(knowledgeText(task)).text)[Number(heading.dataset.knHeading)];if(h)knowledgeCurrentEntry()?.locate(h.offset);return;}
  const back=event.target.closest('[data-kn-note]');if(back){const note=state.tasks.find(t=>t.id===back.dataset.knNote);if(note)knowledgeOpen(note);return;}
  const button=event.target.closest('[data-kn-action]');if(!button)return;
  const task=state.tasks.find(t=>t.id===state.activeTaskId);if(!task)return;
  const action=button.dataset.knAction;
  if(button.closest('.kn-insert-menu'))shellCloseOverlay({restoreFocus:false});
  if(action==='insert-menu')knowledgeInsertMenu(button);
  if(action==='insert-format')shellApplyNoteFormat(button.dataset.knFormat);
  if(action==='switcher')knowledgeShowSwitcher();
  if(action==='panels'){const closing=button.closest('.kn-side-panel');if(knowledgePanels.has(task.id))knowledgePanels.delete(task.id);else knowledgePanels.add(task.id);knowledgeRefreshPanels(task);if(closing)document.querySelector('.knowledge-header [data-kn-action="panels"]')?.focus({preventScroll:true});}
  if(action==='rename')knowledgeRename(task);
  if(action==='find')knowledgeCurrentEntry()?.openSearch();
  if(action==='table-tools')knowledgeTableTools();
  if(action==='upload'){const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp';input.multiple=true;const editor=knowledgeCurrentEntry();input.onchange=()=>{for(const file of input.files)void editor?.upload(file);};input.click();}
},true);
document.addEventListener('keydown',event=>{
  if(event.isComposing||!(event.ctrlKey||event.metaKey)||state.taskPane!=='notes'||shellOverlayIsOpen())return;
  const key=event.key.toLowerCase();
  if(key==='o'){event.preventDefault();event.stopImmediatePropagation();knowledgeShowSwitcher();}
  if(key==='e'){event.preventDefault();event.stopImmediatePropagation();knowledgeSetMode(shellKnowledgeMode()==='preview'?'edit':'preview');}
  if(key==='f' && !document.activeElement?.closest('.cm-editor')){event.preventDefault();event.stopImmediatePropagation();knowledgeCurrentEntry()?.openSearch();}
},true);
// Dismissing this formatting menu must not rerender the workspace and discard
// the trigger's keyboard focus. Other Loop dialogs keep their own dismissal.
window.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||event.isComposing||!document.querySelector('.kn-insert-menu'))return;
  event.preventDefault();event.stopImmediatePropagation();shellCloseOverlay();
},true);
window.addEventListener('beforeunload',()=>{captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});void flushPendingKnowledgeRecoveries();});
// The single-instance desktop app scopes all notes to the current Loop data
// directory. Its existing path gate remains the only disk-access authority.

async function knowledgeInspectDeferredChange(task) {
  if(!state.tasks.includes(task)||!task.knowledgeNote.filePath)return;
  try {
    const current=await desktopKnowledgeFile.read({filePath:task.knowledgeNote.filePath});
    if(current?.success && current.lastSavedHash!==task.knowledgeNote.lastSavedHash) {
      await handleKnowledgeFileChange({...current,type:'external-changed',noteId:task.knowledgeNote.noteId});
      knowledgeUpdateChrome(task);
    }
  } catch { /* The existing watcher will report an unavailable file on its next scan. */ }
}

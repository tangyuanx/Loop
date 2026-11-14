/* Independent document sessions reuse Loop's storage/recovery/file IPC.
   Legacy task.notes retain their identity until explicitly removed. */
const knowledgeFileWriteBusy = new Set();
const knowledgeMembershipBusy = new Set();
const knowledgeSaveQueue = new LoopKnowledgeCore.SerialQueue();
const knowledgeAutosaveTimers = new Map();
const knowledgeSaveResults = new Map();
const knowledgePanels = new Set();
const knowledgeBacklinkPanels = new Set();
const knowledgeGenerations = new Map();
const knowledgeBacklinkCache = new Map();
const knowledgeDeferredFileEvents = new Map();
let knowledgeIndexTimer = 0;
let knowledgeLastTabClick = null;
let knowledgeTabDragClickPending = false;
const knowledgeTabLandings = new WeakMap();
const knowledgeTabsBindings = new Map();
const knowledgeTabSessions = new WeakMap();
const knowledgeToolbarBindings = new Map();
const knowledgeResourceTabs=new Map(),knowledgeResourceActive=new Map(),knowledgeResourcePending=new Set();
let knowledgeResourceEpoch=0,knowledgeResourceBinding=null,knowledgeResourceFrame=0,knowledgeResourcePlacement='';
// Session-only navigation keeps the existing editor/Undo objects alive. A
// return destination is a specific document or resource, never a tab index.
const knowledgeNavigationHistory=new Map(),knowledgeReadingPositions=new Map();
// Layout stores document identities only. Editors, undo and persistence remain
// owned by the existing per-document session and file/recovery queues.
function knowledgeSplitLayout(owner = activeTask()) {
  const split = state.knowledgeWorkspace.splitsByTask?.[owner?.id];
  if (!split) return null;
  const tabs = (state.knowledgeWorkspace.tabsByTask[owner.id]||[]).filter(id => {
    const note = knowledgeFindDocument(id);return note && !note.knowledgeNote?.isDeleted;
  });
  const normalized = knowledgeDocument.normalizeSplitLayout(split,tabs);
  if (!normalized) return null;
  // Preserve the live object used by divider/drag sessions.
  Object.assign(split,normalized);return split;
}
function knowledgePane(taskId = knowledgeActiveDocument()?.id) {
  return taskId ? document.querySelector(`.knowledge-pane[data-task-id="${CSS.escape(taskId)}"]`) : document.querySelector('.knowledge-pane');
}
function knowledgePaneMode(taskId = knowledgeActiveDocument()?.id, base = 'edit') {
  const split = knowledgeSplitLayout();
  const side = split && split.leftId === taskId ? 'left' : split && split.rightId === taskId ? 'right' : '';
  return side ? split[side+'Mode'] || base : base;
}
function knowledgeActivateSide(side) {
  const split = knowledgeSplitLayout();
  if (!split || !['left','right'].includes(side)) return;
  const session = state.knowledgeWorkspace, target = split[side+'Id'];
  const changed = split.active !== side || session.activeId !== target;
  split.active = side; session.activeId = target; session.lastByTask[state.activeTaskId] = target;
  for (const pane of document.querySelectorAll('[data-kn-side]')) pane.dataset.active = String(pane.dataset.knSide === side);
  for (const tab of document.querySelectorAll('[data-kn-document]')) {
    const side = tab.closest('[data-kn-tab-side]')?.dataset.knTabSide;
    const selected = tab.dataset.knDocument === (side ? split[side+'Id'] : target);
    tab.setAttribute('aria-selected',String(selected)); tab.tabIndex = selected ? 0 : -1;
  }
  if (changed) { knowledgeResourceEpoch++; save(); }
  knowledgeSyncFocus();
}
function knowledgeSyncFocus() {
  const enabled = Workbench.focus && state.taskPane === 'notes' && !!document.querySelector('.knowledge-pane');
  document.body.classList.toggle('wb-focus',enabled);
  const split = knowledgeSplitLayout(), layout = document.querySelector('.kn-split');
  if (layout) layout.dataset.knFocus = enabled ? split?.active || '' : '';
  for (const button of document.querySelectorAll('[data-wb-action="focus"]')) {
    const active = enabled && (!split || button.closest('[data-kn-side]')?.dataset.knSide === split.active);
    const changed = button.getAttribute('aria-pressed') !== String(active);
    button.setAttribute('aria-pressed',String(active)); button.setAttribute('aria-label',`${active?'退出':'进入'}专注模式`);
    if (changed) button.innerHTML = shellIcon(active?'restoreRecord':'expandRecord');
  }
}
function renderKnowledgeSplitActions() {
  const split = knowledgeSplitLayout(), available = state.knowledgeWorkspace.openIds.length > 1;
  return `<div class="menu-divider"></div><button type="button" class="button" role="menuitem" data-kn-layout="split" ${!available?'disabled title="请先打开两篇笔记"':''}>${split?'更换另一栏笔记…':'左右分屏'}</button>${split?'<button type="button" class="button" role="menuitem" data-kn-layout="merge">合并为单栏</button>':''}`;
}
function knowledgeSplitOpen(noteId, side = 'right', { keepSplit = true } = {}) {
  const session = state.knowledgeWorkspace, owner = activeTask(), current = knowledgeActiveDocument();
  if (!owner || !current) return;
  let target = knowledgeFindDocument(noteId);
  if (!target || target.knowledgeNote?.isDeleted) return;
  captureMountedMilkdownDrafts(); flushNodeNoteDrafts({persist:true});
  const split = knowledgeSplitLayout(owner);
  if (split) {
    if (split[side+'Tabs'].includes(target.id)) knowledgeAttach(target);
    else knowledgeMoveTab(target.id,side,null,keepSplit);
    return;
  } else {
    const other = current.id !== target.id ? current : session.openIds.map(knowledgeFindDocument).find(note => note && note.id !== target.id && !note.knowledgeNote?.isDeleted);
    if (!other) { shellToast('请先打开另一篇笔记，再左右分屏'); return; }
    const mode = shellKnowledgeMode();
    session.openIds = knowledgeDocument.normalizeNoteLinks([...session.openIds,target.id]);
    const rest = session.openIds.filter(id=>id!==target.id);
    (session.splitsByTask ||= {})[owner.id] = {leftId:side==='left'?target.id:other.id,rightId:side==='right'?target.id:other.id,active:side,ratio:.5,leftMode:mode,rightMode:mode,
      leftTabs:side==='left'?[target.id]:rest,rightTabs:side==='right'?[target.id]:rest};
  }
  session.tabsByTask[owner.id] = session.openIds.slice();
  const layout = knowledgeSplitLayout(owner);
  session.activeId = layout[side+'Id']; session.lastByTask[owner.id] = session.activeId;
  knowledgeResourceActive.delete(owner.id); knowledgeResourceEpoch++;
  shellCloseOverlay({restoreFocus:false}); save(); render();
}

function knowledgeCommitTabGroups(split) {
  const session=state.knowledgeWorkspace,owner=activeTask();
  if (!owner) return;
  session.openIds=knowledgeDocument.normalizeNoteLinks([...split.leftTabs,...split.rightTabs]);
  session.tabsByTask[owner.id]=session.openIds.slice();
  if (!split.leftTabs.length || !split.rightTabs.length) {
    const remaining=split.leftTabs.length?'left':'right';
    session.activeId=split[remaining+'Id'];
    delete session.splitsByTask[owner.id];applySetting('knowledge-mode',split[remaining+'Mode']);
  } else session.activeId=split[split.active+'Id'];
  session.lastByTask[owner.id]=session.activeId;
}

// Move the tab identity, retaining the document's original editor/recovery.
// The split command can keep both panes by exchanging their current tabs.
// Dragging the last tab to the other pane closes the empty source pane.
function knowledgeMoveTab(noteId,side,index=null,keepSplit=false) {
  const split=knowledgeSplitLayout(),session=state.knowledgeWorkspace;
  if (!split || !['left','right'].includes(side) || !knowledgeFindDocument(noteId)) return;
  captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});
  const from=split.leftTabs.includes(noteId)?'left':split.rightTabs.includes(noteId)?'right':'';
  const mode=knowledgeCurrentEntry(noteId)?.mode||(from?split[from+'Mode']:shellKnowledgeMode());
  if (from) {
    const previousIndex=split[from+'Tabs'].indexOf(noteId);
    split[from+'Tabs']=split[from+'Tabs'].filter(id=>id!==noteId);
    if (split[from+'Id']===noteId) split[from+'Id']=split[from+'Tabs'][Math.max(0,previousIndex-1)]||'';
    if (from!==side&&keepSplit&&!split[from+'Tabs'].length) {
      const replacement=split[side+'Id'];
      split[side+'Tabs']=split[side+'Tabs'].filter(id=>id!==replacement);
      split[from+'Tabs']=[replacement];split[from+'Id']=replacement;split[from+'Mode']=split[side+'Mode'];
    }
  }
  const tabs=split[side+'Tabs'];
  tabs.splice(index===null?tabs.length:Math.max(0,Math.min(tabs.length,index)),0,noteId);
  split[side+'Id']=noteId;split[side+'Mode']=mode;split.active=side;
  knowledgeCommitTabGroups(split);
  knowledgeResourceActive.delete(state.activeTaskId);knowledgeResourceEpoch++;
  shellCloseOverlay({restoreFocus:false});save();render();requestAnimationFrame(knowledgeRevealActiveTab);
}
function knowledgeMergeSplit() {
  const split = knowledgeSplitLayout(); if (!split) return;
  const mode = split[split.active+'Mode'];
  delete state.knowledgeWorkspace.splitsByTask[state.activeTaskId];
  applySetting('knowledge-mode',mode); shellCloseOverlay({restoreFocus:false}); save(); render();
}
let knowledgeSplitBinding = null;
function knowledgeBindSplit() {
  const divider = document.querySelector('.kn-split-divider');
  if (divider === knowledgeSplitBinding?.divider) return;
  knowledgeSplitBinding?.finish(true);
  knowledgeSplitBinding?.controller.abort();
  knowledgeSplitBinding = null;
  if (!divider) return;
  const controller = new AbortController(), signal = controller.signal, layout = divider.parentElement;
  let gesture = null;
  const set = ratio => {
    const split = knowledgeSplitLayout(); if (!split) return;
    const minimum = Math.min(.5,Math.max(.25,180/layout.clientWidth));
    split.ratio = Math.max(minimum,Math.min(1-minimum,ratio));
    layout.style.setProperty('--kn-left',split.ratio*100+'%');
    divider.setAttribute('aria-valuenow',String(Math.round(split.ratio*100)));
  };
  const finish = cancel => {
    if (!gesture) return;
    const last = gesture; gesture = null;
    if (cancel) set(last.ratio);
    if (divider.hasPointerCapture(last.id)) divider.releasePointerCapture(last.id);
    layout.classList.remove('kn-split-resizing'); save();
  };
  knowledgeSplitBinding = {divider,controller,finish};
  divider.addEventListener('pointerdown',event=>{
    if(event.button!==0||!knowledgeSplitLayout())return;
    event.preventDefault(); gesture={id:event.pointerId,ratio:knowledgeSplitLayout().ratio};
    divider.setPointerCapture(event.pointerId);layout.classList.add('kn-split-resizing');
  },{signal});
  divider.addEventListener('pointermove',event=>{
    if(!gesture||gesture.id!==event.pointerId)return;
    event.preventDefault();const bounds=layout.getBoundingClientRect();set((event.clientX-bounds.left)/bounds.width);
  },{signal});
  divider.addEventListener('pointerup',()=>finish(false),{signal});
  divider.addEventListener('pointercancel',()=>finish(true),{signal});
  divider.addEventListener('lostpointercapture',()=>finish(true),{signal});
  window.addEventListener('blur',()=>finish(true),{signal});
  window.addEventListener('keydown',event=>{if(gesture&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(true);}},{signal,capture:true});
  divider.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home'].includes(event.key)||event.isComposing)return;
    event.preventDefault();set(event.key==='Home'?.5:knowledgeSplitLayout().ratio+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?.1:.025));save();
  },{signal});
  divider.addEventListener('dblclick',()=>{set(.5);save();},{signal});
}
function knowledgeSplitMenu(trigger) {
  const split = knowledgeSplitLayout();
  if (!split) { knowledgeSplitOpen(knowledgeActiveDocument()?.id); return; }
  const other = split.active === 'left' ? 'right' : 'left';
  const rows = state.knowledgeWorkspace.openIds.map(knowledgeFindDocument).filter(note=>note&&!note.knowledgeNote?.isDeleted&&note.id!==split[split.active+'Id']);
  shellMountSurface(`<div class="surface-popover kn-split-menu" role="menu" aria-label="选择另一栏笔记">${rows.map(note=>`<button class="button" type="button" role="menuitem" data-kn-split-note="${escAttr(note.id)}" data-side="${other}">${esc(LoopKnowledgeCore.noteTitle(note))}</button>`).join('')}</div>`,trigger,240);
}
document.addEventListener('pointerdown',event=>{const pane=event.target.closest('[data-kn-side]');if(pane)knowledgeActivateSide(pane.dataset.knSide);},true);
document.addEventListener('focusin',event=>{const pane=event.target.closest('[data-kn-side]');if(pane)knowledgeActivateSide(pane.dataset.knSide);},true);
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-kn-layout]');
  if(action){event.preventDefault();event.stopImmediatePropagation();if(action.dataset.knLayout==='merge')knowledgeMergeSplit();else knowledgeSplitMenu(action);return;}
  const note=event.target.closest('[data-kn-split-note]');
  if(note){event.preventDefault();event.stopImmediatePropagation();knowledgeSplitOpen(note.dataset.knSplitNote,note.dataset.side);}
  const move=event.target.closest('[data-kn-move-tab]');
  if(move){event.preventDefault();event.stopImmediatePropagation();knowledgeMoveTab(move.dataset.knMoveTab,move.dataset.side);}
},true);
document.addEventListener('contextmenu',event=>{
  const tab=event.target.closest('[data-kn-document]');if(!tab)return;
  event.preventDefault();event.stopImmediatePropagation();
  const split=knowledgeSplitLayout(),other=split?.leftTabs.includes(tab.dataset.knDocument)?'right':'left';
  shellMountSurface(`<div class="surface-popover kn-split-menu" role="menu" aria-label="笔记页签操作"><button type="button" class="button" role="menuitem" data-kn-split-note="${escAttr(tab.dataset.knDocument)}" data-side="left">在左侧分屏打开</button><button type="button" class="button" role="menuitem" data-kn-split-note="${escAttr(tab.dataset.knDocument)}" data-side="right">在右侧分屏打开</button>${split?`<button type="button" class="button" role="menuitem" data-kn-move-tab="${escAttr(tab.dataset.knDocument)}" data-side="${other}">移动到${other==='left'?'左':'右'}栏</button><button type="button" class="button" role="menuitem" data-kn-layout="merge">合并为单栏</button>`:''}</div>`,tab,210);
},true);
function knowledgeLocation() {
  const resource=knowledgeActiveResource();
  return resource?{kind:'resource',id:resource.id}:{kind:'note',id:knowledgeActiveDocument()?.id};
}
function knowledgeSameLocation(a,b){return a?.kind===b?.kind&&a?.id===b?.id;}
function knowledgeCapturePosition() {
  if(state.taskPane!=='notes'||!document.querySelector('.knowledge-pane'))return null;
  const location=knowledgeLocation();if(!location.id)return null;
  const pane=knowledgePane(location.id),body=pane?.querySelector('.knowledge-body'),code=document.querySelector('.kn-resource-code');
  if(location.kind==='note'&&(!body?.getClientRects().length))return null;
  if(location.kind==='resource'&&document.querySelector('.kn-resource')?.dataset.resourceId!==location.id)return null;
  const saved={...location,owner:state.activeTaskId,bodyTop:body?.scrollTop||0,bodyLeft:body?.scrollLeft||0,
    editor:location.kind==='note'?knowledgeCurrentEntry()?.captureNavigationState?.():null,codeTop:code?.scrollTop||0};
  const key=JSON.stringify([saved.owner,saved.kind,saved.id]);knowledgeReadingPositions.delete(key);knowledgeReadingPositions.set(key,saved);
  while(knowledgeReadingPositions.size>180)knowledgeReadingPositions.delete(knowledgeReadingPositions.keys().next().value);
  return saved;
}
function knowledgeRecordNavigation(source,target) {
  if(!source||source.owner!==state.activeTaskId||knowledgeSameLocation(source,target))return;
  const history=knowledgeNavigationHistory.get(source.owner)||[];
  history.push({source,target});if(history.length>100)history.shift();knowledgeNavigationHistory.set(source.owner,history);
}
function knowledgeRestorePosition(saved) {
  if(!saved)return;
  const revision=renderViewportEpoch;let attempts=0;
  const restore=()=>{
    if(revision!==renderViewportEpoch||saved.owner!==state.activeTaskId||state.taskPane!=='notes'||!knowledgeSameLocation(saved,knowledgeLocation()))return;
    const editor=saved.kind==='note'?knowledgeCurrentEntry():null;
    if(saved.kind==='note'&&!editor?.root?.isConnected){if(attempts++<30)requestAnimationFrame(restore);return;}
    editor?.restoreNavigationState?.(saved.editor);
    const body=knowledgePane(saved.id)?.querySelector('.knowledge-body');
    if(body&&saved.kind==='note'){body.scrollTop=saved.bodyTop;body.scrollLeft=saved.bodyLeft;}
    const code=document.querySelector('.kn-resource-code');if(code&&saved.kind==='resource')code.scrollTop=saved.codeTop;
  };
  // The incumbent render restores its viewports through two frames. Restore
  // this document's exact pre-link snapshot afterwards, yielding to new input.
  requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(restore)));
}
function knowledgeTakeReturn(location) {
  const history=knowledgeNavigationHistory.get(state.activeTaskId)||[];
  if(!knowledgeSameLocation(history.at(-1)?.target,location))return null;
  while(history.length){
    const {source}=history.pop();
    const valid=source.kind==='note'?state.knowledgeWorkspace.openIds.includes(source.id)&&!knowledgeFindDocument(source.id)?.knowledgeNote?.isDeleted&&knowledgeFindDocument(source.id)
      :(knowledgeResourceTabs.get(state.activeTaskId)||[]).some(item=>item.id===source.id);
    if(valid&&!knowledgeSameLocation(source,location))return source;
  }
  return null;
}
function knowledgeReturnTo(saved) {
  if(saved.owner!==state.activeTaskId)return;
  if(saved.kind==='resource')knowledgeSelectResource(saved.id);
  else knowledgeAttach(knowledgeFindDocument(saved.id));
  knowledgeRestorePosition(saved);
}
function knowledgeGoBack() {
  if(state.taskPane!=='notes')return false;
  const saved=knowledgeTakeReturn(knowledgeLocation());if(!saved)return false;
  knowledgeReturnTo(saved);return true;
}
function knowledgeActiveResource(owner=shellActiveTask()) {
  return (knowledgeResourceTabs.get(owner?.id)||[]).find(item=>item.id===knowledgeResourceActive.get(owner?.id));
}
function renderKnowledgeResourceTabs(owner) {
  return (knowledgeResourceTabs.get(owner?.id)||[]).map(item=>`<div class="kn-document-tab"><button type="button" role="tab" tabindex="${knowledgeActiveResource(owner)?.id===item.id?0:-1}" aria-selected="${knowledgeActiveResource(owner)?.id===item.id}" data-kn-resource="${item.id}" title="${escAttr(item.url)}"><span>${esc(item.title)}</span></button><button type="button" class="kn-document-close" data-kn-resource-close="${item.id}" aria-label="关闭资源：${escAttr(item.title)}">${shellIcon('close')}</button></div>`).join('');
}
function knowledgeSelectResource(resourceId,source=null) {
  knowledgeCapturePosition();knowledgeRecordNavigation(source,{kind:'resource',id:resourceId});
  knowledgeResourceEpoch++;knowledgeResourceActive.set(state.activeTaskId,resourceId);shellCloseOverlay({restoreFocus:false});render();requestAnimationFrame(knowledgeRevealActiveTab);
  knowledgeRestorePosition(knowledgeReadingPositions.get(JSON.stringify([state.activeTaskId,'resource',resourceId])));
}
async function knowledgeCloseResource(resourceId) {
  const owner=state.activeTaskId,tabs=knowledgeResourceTabs.get(owner)||[];
  const returning=knowledgeActiveResource()?.id===resourceId?knowledgeTakeReturn({kind:'resource',id:resourceId}):null;
  knowledgeResourceTabs.set(owner,tabs.filter(item=>item.id!==resourceId));
  if(knowledgeResourceActive.get(owner)===resourceId)knowledgeResourceActive.delete(owner);
  if(![...knowledgeResourceTabs.values()].some(items=>items.some(item=>item.id===resourceId)))await personalTaskTrack.knowledgeResources?.close({id:resourceId});
  if(owner!==state.activeTaskId)return;
  knowledgeResourceEpoch++;
  if(returning)knowledgeReturnTo(returning);else render();
  document.querySelector('.kn-document-tabs [aria-selected="true"]')?.focus({preventScroll:true});
}
async function knowledgeOpenResource(href,origin=knowledgeActiveDocument(),{external=false,internal=false}={}) {
  if (String(href).startsWith('loop-asset:') && typeof openTaskShareAsset === 'function') return openTaskShareAsset(href, origin?.id);
  const bridge=window.personalTaskTrack?.knowledgeResources;if(!bridge){shellToast('请在 Loop 桌面应用中打开资源链接');return;}
  const ownerId=state.activeTaskId,epoch=knowledgeResourceEpoch,pending=ownerId+'\n'+href;if(knowledgeResourcePending.has(pending))return;
  const source=knowledgeCapturePosition();
  knowledgeResourcePending.add(pending);
  try{
    captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});save();if(!(await flushSave()))throw new Error('来源笔记未能保存，请重试');
    const result=await bridge.open({href,noteId:origin?.id,external:external||(!internal&&state.knowledgeWorkspace.resourceOpenMode==='external')});
    if(!result?.success)throw new Error(result?.message||'资源打开失败');if(result.external)return;
    if(result.kind==='markdown'){
      let note=knowledgeAllDocuments().find(n=>!n.knowledgeNote?.isDeleted&&n.knowledgeNote?.filePath&&knowledgeDocument.canonicalFilePath(n.knowledgeNote.filePath,desktopPlatform)===knowledgeDocument.canonicalFilePath(result.filePath,desktopPlatform));
      if(!note){const stamp=now(),noteId=id('document');note={id:noteId,title:result.title.replace(/\.md(?:own)?$/i,''),notes:result.content,creatorTaskId:'',createdAt:stamp,updatedAt:stamp,knowledgeNote:knowledgeDocument.markDocumentSaved(knowledgeDocument.createKnowledgeNoteMetadata({taskId:noteId,title:result.title,createdAt:stamp}),result)};if(result.readOnly||result.unsupportedEncoding)note.knowledgeNote=knowledgeDocument.markDocumentReadOnly(note.knowledgeNote);state.knowledgeDocuments.push(note);rememberKnowledgeAssetFiles(result.assetFiles,note.knowledgeNote.noteId);await syncKnowledgeFileWatcher(note);}
      if(ownerId===state.activeTaskId&&epoch===knowledgeResourceEpoch)knowledgeAttach(note,result.anchor,source);
      else{const session=state.knowledgeWorkspace;session.tabsByTask[ownerId]=knowledgeDocument.normalizeNoteLinks([...(session.tabsByTask[ownerId]||[]),note.id]);save();}
      return;
    }
    const tabs=knowledgeResourceTabs.get(ownerId)||[];if(!tabs.some(item=>item.id===result.id))tabs.push(result);knowledgeResourceTabs.set(ownerId,tabs);
    if(ownerId===state.activeTaskId&&epoch===knowledgeResourceEpoch)knowledgeSelectResource(result.id,source);
  }catch(error){
    shellKnowledgeDialog('无法打开链接',`<p class="knowledge-dialog-copy" role="alert">${esc(error.message)}</p>`,'<button class="button" data-action="close-dialog">关闭</button><button class="button" type="button" data-resource-retry>重试</button>');
    document.querySelector('[data-resource-retry]').onclick=()=>{shellCloseOverlay({restoreFocus:false});void knowledgeOpenResource(href,origin,{external,internal});};
  }
  finally{knowledgeResourcePending.delete(pending);}
}
function knowledgeScheduleResourceView() {
  if(knowledgeResourceFrame)return;
  knowledgeResourceFrame=requestAnimationFrame(()=>{
    knowledgeResourceFrame=0;const bridge=window.personalTaskTrack?.knowledgeResources;if(!bridge)return;
    const item=knowledgeActiveResource(),viewport=document.querySelector('.kn-resource-viewport');
    const obscured=Boolean(document.querySelector('#overlay > *,#context-menu-root > *'));
    const bounds=viewport?.getBoundingClientRect(),visible=item&&['web','pdf'].includes(item.kind)&&!obscured&&bounds?.width>0&&bounds?.height>0;
    const payload=visible?{id:item.id,bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}}:{};
    const key=JSON.stringify(payload);if(key===knowledgeResourcePlacement)return;knowledgeResourcePlacement=key;
    void bridge.show(payload).catch(()=>{});
  });
}
function knowledgeBindResources() {
  const surface=document.querySelector('.knowledge-note-surface'),item=knowledgeActiveResource();
  for(const el of surface?.querySelectorAll(':scope > .knowledge-body,:scope > .knowledge-note-actions,:scope > .knowledge-footer,:scope > .kn-empty-document')||[])el.toggleAttribute('hidden',Boolean(item));
  let panel=surface?.querySelector('.kn-resource');
  if(!item)panel?.remove();
  else if(surface&&panel?.dataset.resourceId!==item.id){
    panel?.remove();panel=document.createElement('section');panel.className='kn-resource';panel.dataset.resourceId=item.id;panel.setAttribute('aria-label',item.title);
    panel.innerHTML=`<header><span class="kn-resource-location" title="${escAttr(item.url)}">${esc(item.url)}</span>${item.canExternal?'<button class="text-button" type="button" data-resource-external>使用系统'+(item.kind==='web'?'浏览器':'应用')+'打开</button>':''}</header>`+
      (item.kind==='code'?`<pre class="kn-resource-code" tabindex="0" aria-label="只读文件预览"><code>${esc(item.content)}</code></pre>`:`<div class="kn-resource-viewport"><p class="kn-resource-message" role="status">${item.kind==='unsupported'?'此文件类型请使用系统应用打开。':'正在打开资源…'}</p></div>`);
    surface.append(panel);panel.querySelector('[data-resource-external]')?.addEventListener('click',async()=>{const result=await personalTaskTrack.knowledgeResources.external({id:item.id});if(!result?.success)shellToast(result.message||'打开失败');});
  }
  if(panel){const message=panel.querySelector('.kn-resource-message');if(message)message.textContent=item.status==='failed'?'无法在 Loop 中预览，请使用系统应用打开。':item.kind==='unsupported'?'此文件类型请使用系统应用打开。':item.status==='ready'?'':'正在打开资源…';}
  knowledgeResourceBinding?.disconnect();
  if(surface&&typeof ResizeObserver==='function'){knowledgeResourceBinding=new ResizeObserver(knowledgeScheduleResourceView);knowledgeResourceBinding.observe(surface);const viewport=surface.querySelector('.kn-resource-viewport');if(viewport)knowledgeResourceBinding.observe(viewport);}
  knowledgeScheduleResourceView();
}
function knowledgeResourceLinkMenu(href,origin,trigger,point) {
  const label=/^https?:/i.test(href)?'使用默认浏览器打开':'使用系统应用打开';
  const menu=shellMountSurface(`<div class="surface-popover wb-menu" role="menu" aria-label="链接操作"><div class="wb-menu-list"><button type="button" role="menuitem" data-resource-open-internal>在 Loop 页签打开</button><button type="button" role="menuitem" data-resource-open-external>${label}</button></div></div>`,trigger,220);
  menu.style.left=Math.max(8,Math.min(point.x,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(point.y,innerHeight-menu.offsetHeight-8))+'px';
  menu.querySelector('[data-resource-open-internal]').onclick=()=>{shellCloseOverlay({restoreFocus:false});void knowledgeOpenResource(href,origin,{internal:true});};
  menu.querySelector('[data-resource-open-external]').onclick=()=>{shellCloseOverlay({restoreFocus:false});void knowledgeOpenResource(href,origin,{external:true});};
  menu.querySelector('button').focus();
}
window.personalTaskTrack?.knowledgeResources?.onChange(change=>{
  for(const tabs of knowledgeResourceTabs.values())for(const item of tabs)if(item.id===change.id)Object.assign(item,change);
  document.querySelectorAll('[data-kn-resource]').forEach(button=>{const item=(knowledgeResourceTabs.get(state.activeTaskId)||[]).find(item=>item.id===button.dataset.knResource);if(item)button.querySelector('span').textContent=item.title;});
  knowledgeBindResources();
});
window.personalTaskTrack?.knowledgeResources?.onNewLink(event=>void knowledgeOpenResource(event.href));
window.personalTaskTrack?.knowledgeResources?.onNavigateBack?.(()=>knowledgeGoBack());
window.addEventListener('mouseup',event=>{if(event.button===3&&state.taskPane==='notes'){event.preventDefault();event.stopImmediatePropagation();knowledgeGoBack();}},true);
window.addEventListener('auxclick',event=>{if(event.button===3&&state.taskPane==='notes')event.preventDefault();},true);
window.addEventListener('keydown',event=>{if(event.key==='BrowserBack'&&state.taskPane==='notes'){event.preventDefault();event.stopImmediatePropagation();knowledgeGoBack();}},true);
window.addEventListener('resize',knowledgeScheduleResourceView);document.addEventListener('scroll',knowledgeScheduleResourceView,true);
if(typeof MutationObserver==='function')new MutationObserver(knowledgeScheduleResourceView).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});

function knowledgeToolbarContentUnder(actions, surface) {
  const body=surface.querySelector('.knowledge-body'),content=body?.querySelector('.knowledge-rich-host');
  if(!content)return false;
  const bounds=actions.getBoundingClientRect(),viewport=body.getBoundingClientRect();
  const hit={left:Math.max(bounds.left,viewport.left),right:Math.min(bounds.right,viewport.right),top:Math.max(bounds.top,viewport.top),bottom:Math.min(bounds.bottom,viewport.bottom)};
  if(hit.right<=hit.left||hit.bottom<=hit.top)return false;
  const intersects=rect=>rect.width>0&&rect.height>0&&rect.right>hit.left&&rect.left<hit.right&&rect.bottom>hit.top&&rect.top<hit.bottom;
  for(const block of content.querySelectorAll('table,pre,img,.kn-mermaid,.kn-callout,.kn-frontmatter,.kn-embed,hr')){
    if(block.getClientRects().length&&intersects(block.getBoundingClientRect()))return true;
  }
  // A CodeMirror line spans the whole column even when its text is short.
  // Measure painted text ranges, so empty space never raises the toolbar.
  const roots=content.querySelectorAll('.cm-line,.kn-reading>*,[contenteditable="true"]>*,.kn-live-widget');
  const visited=new Set(),range=document.createRange();
  for(const root of roots){
    if(!intersects(root.getBoundingClientRect()))continue;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())){
      if(visited.has(node)||!node.nodeValue.trim()||node.parentElement.closest('button,svg,script,style,[hidden]'))continue;
      visited.add(node);
      if(getComputedStyle(node.parentElement).visibility==='hidden')continue;
      range.selectNodeContents(node);
      for(const rect of range.getClientRects())if(intersects(rect))return true;
    }
  }
  return false;
}

function knowledgeBindToolbar() {
  for (const [surface, old] of knowledgeToolbarBindings) if (!surface.isConnected) {
    old.resize.disconnect();old.mutations.disconnect();old.controller.abort();cancelAnimationFrame(old.frame);
    knowledgeToolbarBindings.delete(surface);
  }
  for (const surface of document.querySelectorAll('.knowledge-note-surface')) {
  if(knowledgeToolbarBindings.has(surface)){knowledgeToolbarBindings.get(surface).schedule();continue;}
  const actions=surface.querySelector('.knowledge-note-actions');if(!actions)continue;
  const controller=new AbortController();
  const card=surface.closest('.task-work-area')?.querySelector('[data-task-info]');
  const fitChrome=()=>{
    surface.style.setProperty('--knowledge-actions-clearance',actions.offsetTop+actions.offsetHeight+8+'px');
    if(!card?.getClientRects().length)return;
    const clearance=Math.floor(actions.getBoundingClientRect().top-card.getBoundingClientRect().top-8);
    const header=card.querySelector('.task-info-head').offsetHeight;
    const limit=Math.max(header,clearance)+'px';
    if(card.style.getPropertyValue('--task-info-max-height')!==limit)card.style.setProperty('--task-info-max-height',limit);
  };
  const binding={surface,actions,controller,frame:0};
  const update=()=>{
    binding.frame=0;
    if(!surface.isConnected)return;
    for(const group of [actions,surface.querySelector('.knowledge-footer-meta')].filter(Boolean))group.toggleAttribute('data-over-content',knowledgeToolbarContentUnder(group,surface));
  };
  const schedule=()=>{if(!binding.frame)binding.frame=requestAnimationFrame(update);};
  const resize=new ResizeObserver(()=>{fitChrome();schedule();}),mutations=new MutationObserver(schedule);
  Object.assign(binding,{schedule,resize,mutations});knowledgeToolbarBindings.set(surface,binding);
  resize.observe(surface);resize.observe(actions);
  mutations.observe(surface,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','data-mode']});
  surface.addEventListener('scroll',schedule,{capture:true,passive:true,signal:controller.signal});
  document.fonts?.addEventListener('loadingdone',schedule,{signal:controller.signal});
  fitChrome();
  schedule();
  }
}

function knowledgeUpdateTabScroll(binding) {
  for(const current of binding?[binding]:knowledgeTabsBindings.values()){
  const {bar,viewport,session}=current;
  session.scroll=viewport.scrollLeft;
  bar.querySelector('[data-kn-scroll="-1"]').disabled=viewport.scrollLeft<=1;
  bar.querySelector('[data-kn-scroll="1"]').disabled=viewport.scrollLeft+viewport.clientWidth>=viewport.scrollWidth-1;
  }
}

function knowledgeRevealBindingTab(binding) {
  const {viewport}=binding;
  const tab=viewport?.querySelector('[aria-selected="true"]')?.parentElement;
  if(!tab)return;
  const rect=tab.getBoundingClientRect(),visible=viewport.getBoundingClientRect();
  if(rect.left<visible.left)viewport.scrollLeft+=rect.left-visible.left;
  else if(rect.right>visible.right)viewport.scrollLeft+=rect.right-visible.right;
  knowledgeUpdateTabScroll(binding);
}

function knowledgeRevealActiveTab(side) {
  const target=['left','right'].includes(side)?side:document.querySelector('.kn-split')?knowledgeSplitLayout()?.active||'':'';
  for(const binding of knowledgeTabsBindings.values())if(binding.bar.dataset.knTabSide===target)knowledgeRevealBindingTab(binding);
}

function knowledgeLayoutTabs(binding) {
  const bar=binding?.bar;
  if(!bar?.isConnected)return;
  const resized=binding.width!==undefined&&binding.width!==bar.clientWidth;
  binding.width=bar.clientWidth;
  const {viewport}=binding,count=viewport.children.length;
  const css=getComputedStyle(bar),gap=parseFloat(getComputedStyle(viewport).columnGap);
  const minimum=parseFloat(css.getPropertyValue('--kn-tab-min-width'));
  const maximum=parseFloat(css.getPropertyValue('--kn-tab-max-width'));
  const available=bar.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)-(bar.querySelector('.kn-document-new')?.offsetWidth||0)-6;
  const fitted=count?Math.floor((available-(count-1)*gap)/count):maximum;
  const width=Math.max(minimum,Math.min(maximum,fitted));
  bar.style.setProperty('--kn-tab-width',width+'px');
  bar.toggleAttribute('data-compact',width<=minimum+6);
  for(const button of bar.querySelectorAll('[data-kn-scroll]')){
    button.hidden=fitted>=minimum;
    if(button.hidden&&button===document.activeElement)viewport.querySelector('[aria-selected="true"]')?.focus({preventScroll:true});
  }
  if(resized)knowledgeRevealBindingTab(binding);
  else knowledgeUpdateTabScroll(binding);
}

function knowledgeBindTabs() {
  const bars=[...document.querySelectorAll('.kn-document-bar')];
  for(const [bar,binding]of knowledgeTabsBindings)if(!bars.includes(bar)){
    binding.controller.abort();binding.observer.disconnect();knowledgeTabsBindings.delete(bar);
  }
  const owner=activeTask();if(!owner)return;
  const sessions=knowledgeTabSessions.get(owner)||new Map();knowledgeTabSessions.set(owner,sessions);
  for(const bar of bars){
  for(const close of bar.querySelectorAll('[data-kn-detach]')){
    const note=knowledgeFindDocument(close.dataset.knDetach);
    close.toggleAttribute('data-unsaved',Boolean(note&&(!note.knowledgeNote.filePath||note.knowledgeNote.dirty||nodeNoteDrafts.has(noteDraftKey(note.id,'')))));
  }
  const retained=knowledgeTabsBindings.get(bar);
  if(retained){
    // Retained regions briefly leave the document during render, which resets
    // their native scrollLeft even though the same nodes are mounted again.
    const scroll=retained.session.scroll;
    knowledgeLayoutTabs(retained);
    retained.viewport.scrollLeft=scroll;
    knowledgeUpdateTabScroll(retained);continue;
  }
  const viewport=bar.querySelector('.kn-document-tabs');
  const side=bar.dataset.knTabSide||'',session=sessions.get(side)||{scroll:0,activeId:''};sessions.set(side,session);
  const activeId=viewport.querySelector('[aria-selected="true"]')?.dataset.knDocument||'';
  const changed=activeId!==session.activeId;
  session.activeId=activeId;
  const scroll=session.scroll;
  const controller=new AbortController();
  const binding={bar,viewport,session,controller};
  const observer=new ResizeObserver(()=>knowledgeLayoutTabs(binding));binding.observer=observer;
  knowledgeTabsBindings.set(bar,binding);
  knowledgeLayoutTabs(binding);
  viewport.scrollLeft=scroll;
  if(changed)knowledgeRevealBindingTab(binding);
  knowledgeUpdateTabScroll(binding);
  observer.observe(bar);
  viewport.addEventListener('scroll',()=>knowledgeUpdateTabScroll(binding),{passive:true,signal:controller.signal});
  viewport.addEventListener('wheel',event=>{
    if(event.ctrlKey||viewport.scrollWidth<=viewport.clientWidth)return;
    const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
    if(!delta)return;
    const unit=event.deltaMode===1?16:event.deltaMode===2?viewport.clientWidth:1;
    event.preventDefault();
    viewport.scrollLeft+=delta*unit;
    knowledgeUpdateTabScroll(binding);
  },{passive:false,signal:controller.signal});
  knowledgeBindTabReordering(viewport,owner,controller.signal);
  }
}

function knowledgeSaveTabOrder(viewport,owner) {
  if(owner!==activeTask())return;
  const session=state.knowledgeWorkspace;
  const ids=[...viewport.querySelectorAll('[data-kn-document]')].map(tab=>tab.dataset.knDocument);
  const side=viewport.closest('[data-kn-tab-side]')?.dataset.knTabSide,split=knowledgeSplitLayout(owner);
  if(side&&split){split[side+'Tabs']=ids;knowledgeCommitTabGroups(split);}
  else{session.openIds=ids;session.tabsByTask[owner.id]=ids.slice();}
  retainedRegionMarkup.delete('workspace');
  save();
}

function knowledgeLandDraggedTab(noteId, from) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const tab = document.querySelector(`[data-kn-document="${CSS.escape(noteId)}"]`)?.parentElement;
  if (!tab) return;
  const to = tab.getBoundingClientRect();
  const x = from.left - to.left, y = from.top - to.top;
  // Only settle short moves. A different pane layout can change tab widths
  // or put the selected tab beyond the portion of the bar that was visible.
  if (Math.abs(x) > 96 || Math.abs(y) > 30 || Math.abs(from.width - to.width) > 2 || Math.hypot(x, y) < 1) return;
  knowledgeTabLandings.get(tab)?.cancel();
  const animation = tab.animate([{transform:`translate(${x}px, ${y}px)`},{transform:'none'}], {
    duration: 140, easing: 'cubic-bezier(.2,.75,.25,1)',
  });
  knowledgeTabLandings.set(tab, animation);
}

document.addEventListener('pointerdown', () => { knowledgeTabDragClickPending = false; }, true);

function knowledgeBindTabReordering(viewport,owner,bindingSignal) {
  viewport.addEventListener('pointerdown',event=>{
    const button=event.target.closest('[data-kn-document]');
    if(event.button!==0||!event.isPrimary||!button||event.target.closest('input,textarea,[data-kn-detach]'))return;
    const tab=button.parentElement,original=[...viewport.children],startX=event.clientX,startY=event.clientY,startScroll=viewport.scrollLeft;
    const sourceSide=viewport.closest('.kn-document-bar').dataset.knTabSide;
    const onlyTabInPane=Boolean(sourceSide)&&viewport.querySelectorAll('[data-kn-document]').length===1;
    const mergesInto=side=>onlyTabInPane&&Boolean(side)&&side!==sourceSide;
    const startBounds=tab.getBoundingClientRect();
    const grabX=startX-startBounds.left,grabY=startY-startBounds.top;
    const gesture=new AbortController(),signal=gesture.signal;
    let dragging=false,finished=false,autoFrame=0,pointerX=startX,pointerY=startY,drop=null,preview=null,ghost=null;
    const clearMarks=()=>{
      for(const item of document.querySelectorAll('[data-tab-insert],[data-tab-after]')){
        item.removeAttribute('data-tab-insert');
        item.removeAttribute('data-tab-after');
      }
    };
    const clearPreview=()=>{preview?.remove();preview=null;};
    const showPreview=(side,bounds,label)=>{
      if(!preview){
        preview=document.createElement('div');preview.className='kn-tab-drop-preview';preview.setAttribute('aria-hidden','true');
        preview.append(document.createElement('span'));document.body.append(preview);
      }
      preview.dataset.knDropSide=side;
      Object.assign(preview.style,{left:bounds.left+'px',top:bounds.top+'px',width:bounds.width+'px',height:bounds.height+'px'});
      preview.firstElementChild.textContent=label;
    };
    const peerAnimations=new Map();
    const followPointer=()=>{
      if(!ghost){
        ghost=document.createElement('div');
        ghost.className='kn-tab-drag-ghost';ghost.setAttribute('aria-hidden','true');
        ghost.style.width=startBounds.width+'px';ghost.style.height=startBounds.height+'px';
        ghost.toggleAttribute('data-selected',button.getAttribute('aria-selected')==='true');
        const compact=viewport.closest('.kn-document-bar').hasAttribute('data-compact');
        ghost.toggleAttribute('data-compact',compact);
        const title=document.createElement('span');title.className='kn-tab-drag-title';
        const label=button.querySelector('span')?.textContent||button.getAttribute('aria-label')||'笔记';
        title.textContent=compact?Array.from(label)[0]:label;ghost.append(title);
        const workspace=getComputedStyle(viewport);
        for(const name of ['--canvas','--text','--line'])ghost.style.setProperty(name,workspace.getPropertyValue(name));
        document.body.append(ghost);document.body.classList.add('kn-tab-drag-active');
      }
      // Track the grab point directly, keeping the full tab readable at the window edge.
      const x=Math.max(0,Math.min(pointerX-grabX,window.innerWidth-startBounds.width));
      const y=Math.max(0,Math.min(pointerY-grabY,window.innerHeight-startBounds.height));
      ghost.style.transform=`translate3d(${x}px,${y}px,0)`;
    };
    const scrolled=new Map([[viewport,startScroll]]);
    const restore=()=>{viewport.append(...original);for(const [target,scroll]of scrolled)target.scrollLeft=scroll;};
    const finish=cancel=>{
      if(finished)return;finished=true;
      gesture.abort();
      cancelAnimationFrame(autoFrame);
      bindingSignal.removeEventListener('abort',cancelGesture);
      const landing=ghost?.getBoundingClientRect();
      const committedDrop=!cancel&&owner===activeTask()?drop:null;
      const sameBar=committedDrop?.kind==='bar'&&committedDrop.viewport===viewport;
      if(!sameBar)for(const animation of peerAnimations.values())animation.cancel();
      if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
      tab.classList.remove('kn-tab-dragging');
      clearMarks();clearPreview();ghost?.remove();document.body.classList.remove('kn-tab-drag-active');
      if(dragging){
        knowledgeLastTabClick=null;
        if(!committedDrop)restore();
        else if(sameBar)knowledgeSaveTabOrder(viewport,owner);
        else{
          restore();
          if(committedDrop.kind==='bar')knowledgeMoveTab(button.dataset.knDocument,committedDrop.side,committedDrop.index);
          else knowledgeSplitOpen(button.dataset.knDocument,committedDrop.side,{keepSplit:committedDrop.keepSplit});
        }
        knowledgeUpdateTabScroll();
        if(committedDrop?.kind==='bar'&&landing)knowledgeLandDraggedTab(button.dataset.knDocument,landing);
      }
    };
    const cancelGesture=()=>finish(true);
    bindingSignal.addEventListener('abort',cancelGesture,{once:true});
    const place=target=>{
      const peers=[...target.querySelectorAll('[data-kn-document]')].map(item=>item.parentElement).filter(item=>item!==tab);
      // Compare against layout positions. Transforming neighbours must not
      // shift the hit thresholds while they slide into their new positions.
      const contentLeft=target.getBoundingClientRect().left-target.scrollLeft;
      const next=peers.find(item=>pointerX<contentLeft+item.offsetLeft+item.offsetWidth/2);
      const anchor=next||target.querySelector('[data-kn-resource]')?.parentElement||null;
      if(target===viewport&&tab.nextElementSibling!==anchor){
        const before=new Map(peers.map(item=>[item,item.getBoundingClientRect().left]));
        for(const animation of peerAnimations.values())animation.cancel();
        peerAnimations.clear();
        target.insertBefore(tab,anchor);
        if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const item of peers){
          const shift=before.get(item)-item.getBoundingClientRect().left;
          if(shift)peerAnimations.set(item,item.animate([{transform:`translateX(${shift}px)`},{transform:'none'}],{duration:130,easing:'ease-out'}));
        }
      }
      clearMarks();
      if(target===viewport)tab.setAttribute('data-tab-insert','');
      else if(next)next.setAttribute('data-tab-insert','');
      else peers.at(-1)?.setAttribute('data-tab-after','');
      return next?peers.indexOf(next):peers.length;
    };
    const contains=(rect,x,y)=>rect.width>0&&rect.height>0&&x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom;
    const hit=()=>{
      clearMarks();drop=null;
      // Header hit testing wins: even at the extreme edge it is only sorting
      // or a cross-pane move, never a request to create a split.
      const bar=[...document.querySelectorAll('.kn-document-bar')].find(bar=>contains(bar.getBoundingClientRect(),pointerX,pointerY));
      if(bar){
        const target=bar.querySelector('.kn-document-tabs'),side=bar.dataset.knTabSide;
        if(!scrolled.has(target))scrolled.set(target,target.scrollLeft);
        drop={kind:'bar',viewport:target,side,index:place(target)};
        const destination=mergesInto(side)&&bar.closest('.kn-split-pane')?.querySelector('.knowledge-note-surface');
        if(destination)showPreview(side,destination.getBoundingClientRect(),'松手合并为单栏');
        else clearPreview();
        return;
      }
      const pointedElement=document.elementFromPoint(pointerX,pointerY);
      const pointedPane=pointedElement?.closest('.kn-split-pane');
      const surface=pointedElement?.closest('.knowledge-note-surface')
        || (mergesInto(pointedPane?.dataset.knSide)&&pointedPane.querySelector('.knowledge-note-surface'));
      if(!surface||!state.knowledgeWorkspace.openIds.some(id=>id!==button.dataset.knDocument)){
        clearPreview();return;
      }

      const bounds=surface.getBoundingClientRect();
      const split=surface.closest('.kn-split');
      const focused=Boolean(split?.dataset.knFocus);
      const half=bounds.width/2;
      const side=split&&!focused
        ? surface.closest('[data-kn-side]').dataset.knSide
        : pointerX<bounds.left+half?'left':'right';
      let previewLeft=bounds.left,previewWidth=bounds.width;
      if(!split){
        const dividerWidth=parseFloat(getComputedStyle(viewport).getPropertyValue('--kn-divider-width'));
        previewWidth=half;
        if(side==='right'){
          previewLeft+=half+dividerWidth;
          previewWidth-=dividerWidth;
        }
      }
      drop={kind:'split',side,keepSplit:focused};
      const sideName=side==='left'?'左':'右';
      const label=!focused&&mergesInto(side)?'松手合并为单栏':split?`在${sideName}栏打开`:`在${sideName}侧分屏`;
      showPreview(side,{left:previewLeft,top:bounds.top,width:previewWidth,height:bounds.height},label);
    };
    const autoScroll=()=>{
      autoFrame=0;if(!dragging||signal.aborted)return;
      if(drop?.kind!=='bar')return;
      const target=drop.viewport,bounds=target.getBoundingClientRect(),before=target.scrollLeft;
      const delta=pointerX<bounds.left+30?-18:pointerX>bounds.right-30?18:0;
      if(!delta)return;
      target.scrollLeft+=delta;
      if(target.scrollLeft!==before){drop.index=place(target);knowledgeUpdateTabScroll();autoFrame=requestAnimationFrame(autoScroll);}
    };
    window.addEventListener('pointermove',move=>{
      if(move.pointerId!==event.pointerId)return;
      if(!dragging&&Math.hypot(move.clientX-startX,move.clientY-startY)<5)return;
      move.preventDefault();pointerX=move.clientX;pointerY=move.clientY;
      if(!dragging){
        dragging=true;knowledgeTabDragClickPending=true;
        viewport.setPointerCapture(event.pointerId);
        knowledgeTabLandings.get(tab)?.cancel();
        tab.classList.add('kn-tab-dragging');
      }
      followPointer();hit();if(!autoFrame)autoFrame=requestAnimationFrame(autoScroll);
    },{passive:false,signal});
    window.addEventListener('pointerup',up=>{if(up.pointerId===event.pointerId)finish(false);},{signal});
    window.addEventListener('pointercancel',cancel=>{if(cancel.pointerId===event.pointerId)cancelGesture();},{signal});
    viewport.addEventListener('lostpointercapture',lost=>{
      if(dragging&&lost.pointerId===event.pointerId&&!viewport.hasPointerCapture(event.pointerId))cancelGesture();
    },{signal});
    window.addEventListener('blur',cancelGesture,{signal});
    document.addEventListener('keydown',key=>{if(dragging&&key.key==='Escape'){key.preventDefault();key.stopImmediatePropagation();cancelGesture();}},{capture:true,signal});
  },{signal:bindingSignal});
}

// Global mode/page width preferences use the v0.1.246 task-data save path.

function knowledgeNotes() { return knowledgeAllDocuments().filter(task => task.knowledgeNote && !task.knowledgeNote.isDeleted && (knowledgeText(task).length || task.knowledgeNote.filePath || !state.tasks.includes(task))); }
// Paths and titles are compared with one normalisation so links, backlinks and
// note identity agree.
function knowledgeNormalizePath(value) {
  const parts=[];
  for(const part of String(value||'').replaceAll('\\','/').split('/')){
    if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part);
  }
  return parts.join('/');
}
function knowledgeNormalizeTitle(value) { return String(value??'').normalize('NFC').trim().replace(/\.md$/i,'').toLocaleLowerCase(); }
function knowledgeAbsolutePath(from, relative) {
  const base=String(from||'').replaceAll('\\','/').split('/').slice(0,-1).join('/');
  return knowledgeNormalizePath(base?base+'/'+relative:relative);
}
function knowledgeText(task) { return nodeNoteDrafts.get(noteDraftKey(task.id, ''))?.markdown ?? task.notes ?? ''; }
function knowledgeCurrentEntry(taskId = knowledgeActiveDocument()?.id) { return milkdownEditors.get(noteDraftKey(taskId, ''))?.instance; }
function knowledgeSaveOwner(task) {
  const active=state.tasks.find(t=>t.id===state.activeTaskId);
  if(active&&knowledgeDocument.taskNoteIds(active,state.knowledgeDocuments).includes(task.id))return active;
  return state.tasks.find(t=>knowledgeDocument.taskNoteIds(t,state.knowledgeDocuments).includes(task.id));
}
function knowledgeSaveDirectory(task,ownerId) {
  const owner=ownerId===undefined?knowledgeSaveOwner(task):state.tasks.find(t=>t.id===ownerId);if(!owner)return '';
  const remembered=state.knowledgeWorkspace.saveDirectoriesByTask?.[owner.id];if(remembered)return remembered;
  const ids=new Set(knowledgeDocument.taskNoteIds(owner,state.knowledgeDocuments));
  const saved=knowledgeAllDocuments().filter(n=>ids.has(n.id)&&n.knowledgeNote?.filePath&&n.knowledgeNote.lastSavedHash)
    .sort((a,b)=>(b.knowledgeNote.lastSavedMtime||0)-(a.knowledgeNote.lastSavedMtime||0));
  return saved[0]?.knowledgeNote.filePath.replace(/[\\/][^\\/]+$/,'')||'';
}
function knowledgeRememberSaveDirectory(task,filePath,ownerId) {
  const owner=ownerId===undefined?knowledgeSaveOwner(task):state.tasks.find(t=>t.id===ownerId);if(!owner||!filePath)return;
  const directories=state.knowledgeWorkspace.saveDirectoriesByTask||={};
  directories[owner.id]=filePath.replace(/[\\/][^\\/]+$/,'');
}
async function knowledgeSetMembership(taskId,noteId,joined,button) {
  const owner=state.tasks.find(task=>task.id===taskId),note=knowledgeFindDocument(noteId);
  if(!owner||!note||note.knowledgeNote?.isDeleted||knowledgeMembershipBusy.has(taskId))return;
  const status=button?.closest('[role="menu"]')?.querySelector('[data-kn-membership-status]');
  const report=message=>{
    if(status?.isConnected){status.textContent=message;status.hidden=!message;}
    else if(message)showWorkspaceError(message);
  };
  if(dataProtectionMessage||dataTransferInProgress||taskShareCommitBusy){report('当前数据暂时无法写入，请稍后重试。');return;}
  knowledgeMembershipBusy.add(taskId);
  if(button){button.disabled=true;button.textContent='正在保存归属…';}
  report('');
  const ids=knowledgeDocument.taskNoteIds(owner,state.knowledgeDocuments);
  owner.knowledgeNoteIds=joined?knowledgeDocument.normalizeNoteLinks([...ids,noteId]):ids.filter(id=>id!==noteId);
  try{
    save();
    if(!await flushSave())throw Error('笔记归属保存失败，当前选择已保留，请重试。');
    if(button?.isConnected){
      workbenchClose(false);
      knowledgePane(noteId)?.querySelector('[data-wb-action="more"]')?.focus({preventScroll:true});
    }
    return {success:true};
  }catch(error){
    report(error.message||'笔记归属保存失败，请重试。');
    if(button?.isConnected)button.textContent='重试保存归属';
    return {success:false};
  }finally{
    knowledgeMembershipBusy.delete(taskId);
    for(const item of document.querySelectorAll('[data-kn-action="membership"]')){
      if(item.dataset.ownerTaskId===taskId)item.disabled=false;
    }
  }
}
function knowledgeAttach(note,anchor='',source=null) {
  const task=state.tasks.find(t=>t.id===state.activeTaskId);if(!task||!note)return;
  if(note.knowledgeNote?.isDeleted)return;
  const split=knowledgeSplitLayout(task);
  if(split){
    const side=split.leftTabs.includes(note.id)?'left':split.rightTabs.includes(note.id)?'right':split.active;
    if(split[side+'Id']===note.id&&!knowledgeActiveResource(task)){
      knowledgeCapturePosition();knowledgeRecordNavigation(source,{kind:'note',id:note.id});
      knowledgeActivateSide(side);
      if(anchor)knowledgeCurrentEntry(note.id)?.locateAnchor(anchor);
      return;
    }
    if(!split[side+'Tabs'].includes(note.id))split[side+'Tabs'].push(note.id);
    split[side+'Id']=note.id;split.active=side;
  }
  knowledgeCapturePosition();knowledgeRecordNavigation(source,{kind:'note',id:note.id});
  knowledgeResourceActive.delete(task.id);knowledgeResourceEpoch++;
  captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});
  knowledgeActiveDocument(task);
  const session=state.knowledgeWorkspace;
  session.openIds=knowledgeDocument.normalizeNoteLinks([...session.openIds,note.id]);
  session.activeId=note.id;session.taskId=task.id;session.lastByTask[task.id]=note.id;
  session.tabsByTask[task.id]=session.openIds.slice();
  if(split)knowledgeCommitTabGroups(split);
  session.recentIds=[note.id,...session.recentIds.filter(id=>id!==note.id)].slice(0,40);
  state.taskPane='notes';save();shellCloseOverlay({restoreFocus:false});render();
  requestAnimationFrame(knowledgeRevealActiveTab);
  if(anchor){let attempts=0;const locate=()=>{if(knowledgeActiveDocument()?.id!==note.id)return;const entry=knowledgeCurrentEntry();if(entry?.root?.isConnected)entry.locateAnchor(anchor);else if(attempts++<30)requestAnimationFrame(locate);};requestAnimationFrame(locate);}
  else knowledgeRestorePosition(knowledgeReadingPositions.get(JSON.stringify([task.id,'note',note.id])));
}
function knowledgeDetach(noteId) {
  const task=state.tasks.find(t=>t.id===state.activeTaskId);if(!task)return;
  captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});
  const session=state.knowledgeWorkspace,index=session.openIds.indexOf(noteId);
  const split=knowledgeSplitLayout(task);
  const returning=!knowledgeActiveResource()&&session.activeId===noteId?knowledgeTakeReturn({kind:'note',id:noteId}):null;
  if(split){
    for(const side of ['left','right']){
      const position=split[side+'Tabs'].indexOf(noteId);
      split[side+'Tabs']=split[side+'Tabs'].filter(id=>id!==noteId);
      if(split[side+'Id']===noteId)split[side+'Id']=split[side+'Tabs'][Math.max(0,position-1)]||'';
    }
    knowledgeCommitTabGroups(split);
  }
  session.openIds=session.openIds.filter(id=>id!==noteId);
  if(session.activeId===noteId)session.activeId=session.openIds[Math.max(0,index-1)]||'';
  session.lastByTask[task.id]=session.activeId;
  session.tabsByTask[task.id]=session.openIds.slice();
  save();if(returning)knowledgeReturnTo(returning);else render();
  const focus=document.querySelector(`[data-kn-document="${CSS.escape(session.activeId)}"]`)||document.querySelector('.knowledge-pane [data-wb-action="more"]');
  focus?.focus({preventScroll:true});
}
function knowledgePreserveTaskNote(task) {
  const keepMain=!task.knowledgeNote?.isDeleted&&Boolean(task.notes?.trim()||task.knowledgeNote?.filePath);
  if(keepMain&&!state.knowledgeDocuments.some(note=>note.id===task.id))state.knowledgeDocuments.push({id:task.id,title:LoopKnowledgeCore.noteTitle(task),creatorTaskId:task.id,notes:task.notes,knowledgeNote:structuredClone(task.knowledgeNote),createdAt:task.createdAt,updatedAt:task.updatedAt});
  // An imported note can outlive the source task and its Recently Deleted entry.
  for(const note of state.knowledgeDocuments){
    const assets=(task.sharedAssets||[]).filter(asset=>asset.owners?.includes(note.id));
    if(!assets.length)continue;
    const byId=new Map((note.sharedAssets||[]).map(asset=>[asset.id,asset]));
    for(const asset of assets)byId.set(asset.id,{...asset,taskId:asset.taskId||task.id,owners:[note.id]});
    note.sharedAssets=[...byId.values()];
  }
  return keepMain;
}
function knowledgeRejoinTaskNote(task) {
  const note=state.knowledgeDocuments.find(note=>note.id===task.id);if(!note)return;
  task.notes=note.notes;task.knowledgeNote=note.knowledgeNote;
  state.knowledgeDocuments=state.knowledgeDocuments.filter(candidate=>candidate!==note);
}
function knowledgeNewDialog() {
  return knowledgeCreate();
}
async function knowledgeOpenFile() {
  const owner=state.tasks.find(t=>t.id===state.activeTaskId);if(!owner||!desktopKnowledgeFile?.choose)return;
  const result=await desktopKnowledgeFile.choose({boundPaths:[]});if(result?.canceled)return;
  if(!result?.success){shellToast(result?.message||'打开文件失败，请重试。');return;}
  const canonical=path=>knowledgeDocument.canonicalFilePath(path,desktopPlatform);
  let note=knowledgeAllDocuments().find(n=>n.knowledgeNote.filePath&&canonical(n.knowledgeNote.filePath)===canonical(result.filePath));
  if(!note){
    const stamp=now(),documentId=id('document'),title=result.filePath.split(/[\\/]/).at(-1).replace(/\.md$/i,'');
    note={id:documentId,title,creatorTaskId:'',notes:result.content,createdAt:stamp,updatedAt:stamp,knowledgeNote:knowledgeDocument.markDocumentSaved(knowledgeDocument.createKnowledgeNoteMetadata({taskId:documentId,title,createdAt:stamp}),result)};
    if(result.readOnly)note.knowledgeNote=knowledgeDocument.markDocumentReadOnly(note.knowledgeNote);
    state.knowledgeDocuments.push(note);rememberKnowledgeAssetFiles(result.assetFiles,note.knowledgeNote.noteId);rememberKnowledgeAssetDiagnostics(note.knowledgeNote.noteId,result);
    await syncKnowledgeFileWatcher(note);
  }
  if(owner.id===state.activeTaskId)knowledgeAttach(note);
  else {const session=state.knowledgeWorkspace;session.tabsByTask[owner.id]=knowledgeDocument.normalizeNoteLinks([...(session.tabsByTask[owner.id]||[]),note.id]);session.recentIds=[note.id,...session.recentIds.filter(id=>id!==note.id)].slice(0,40);session.lastByTask[owner.id]=note.id;save();}
}
function knowledgeDetail(task) {
  const note=task.knowledgeNote,updated=note.updatedAt||task.updatedAt;
  const location=note.filePath?.replace(/\\/g,'/').split('/').at(-1)||'Loop 草稿';
  const time=updated?new Date(updated).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
  return [location,time].filter(Boolean).join(' · ');
}
function knowledgeRendererForTask(task) { return LoopKnowledgeEditor.createRenderer(knowledgeEditorOptions(task)); }
function knowledgeEditorOptions(task) {
  const noteId = LoopKnowledgeCore.noteId(task);
  return { noteId, getNotes: knowledgeNotes, getCurrentNote: () => knowledgeAllDocuments().find(t => t.id === task.id),
    getContent: knowledgeText, noteDetail: knowledgeDetail,
    autoSpacing: () => state.uiPreferences.knowledgeAutoSpacing,
    resolveImage: (_id, source) => {
      if (source.startsWith('loop-asset:') && typeof taskShareImage === 'function') {
        const owner = knowledgeAllDocuments().find(item => LoopKnowledgeCore.noteId(item) === _id);
        return taskShareImage(owner?.id || task.id, source);
      }
      if (source.startsWith('task-image:')) return state.attachments?.images?.[source.slice(11)] || '';
      const scope=state.knowledgeAssetScopes?.[_id]||{};
      if(scope[source])return scope[source];
      try{return scope[decodeURIComponent(source)]||'';}catch{return '';}
    },
    onSelectionChange: () => { shellRefreshNoteFormatState(); knowledgeUpdateOutlineActive(task); },
    onFeedback: message=>shellToast(message),
    onImageMenu: (image,point,copy,layout) => {
      const alignments=[['left','左对齐'],['center','居中'],['right','右对齐']];
      const align=layout?'<div class="menu-divider"></div>'+alignments.map(([value,label])=>{
        const checked=layout.align===value;
        return `<button type="button" role="menuitemradio" aria-checked="${checked}" data-image-align="${value}"><span>${label}</span>${checked?shellIcon('check'):''}</button>`;
      }).join(''):'';
      const menu=shellMountSurface('<div class="surface-popover wb-menu" role="menu" aria-label="图片操作"><div class="wb-menu-list"><button type="button" role="menuitem" data-copy-image>复制图片</button>'+align+'</div></div>',image,180);
      menu.style.left=Math.max(8,Math.min(point.x,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(point.y,innerHeight-menu.offsetHeight-8))+'px';
      menu.querySelector('button').onclick=()=>{shellCloseOverlay({restoreFocus:false});void copy();};menu.querySelector('button').focus();
      menu.querySelectorAll('[data-image-align]').forEach(button=>{button.onclick=()=>{shellCloseOverlay({restoreFocus:false});layout.set({align:button.dataset.imageAlign});};});
    },
    onSave: () => void saveKnowledgeTask(task.id),
    onFinishInput: async () => {captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});save();return flushSave();},
    onTableTools: () => knowledgeTableTools(),
    onTableMenu: context => knowledgeTableMenu(context),
    onToggleMode: () => knowledgeSetMode(shellKnowledgeMode(task.id) === 'preview' ? 'edit' : 'preview',task.id),
    onEditForSearch: () => knowledgeSetMode('source',task.id),
    onOpenLink: link => knowledgeOpenLink(link, task),
    onRelativeLink: url => knowledgeOpenRelative(url, task),
    onExternalLink: url => void knowledgeOpenResource(url,task),
    onResourceMenu: (href,trigger,point)=>knowledgeResourceLinkMenu(href,task,trigger,point),
    uploadImage: async (dataUrl, fileName) => {
      if (!knowledgeHasDocument(task)) throw new Error('笔记已删除');
      const imageId = id('image'), reference = 'task-image:' + imageId;
      // Reuse the managed attachment staging API. In the production desktop
      // environment success means the image is already durable on disk.
      if (!desktopKnowledgeFile?.stageAssets) throw new Error('请在 Loop 桌面应用中上传图片');
      const receipt = await desktopKnowledgeFile.stageAssets({noteId, assets: [{source: reference, dataUrl}]});
      if (receipt?.success === false) throw new Error(receipt.message || '图片暂存失败');
      if (!knowledgeHasDocument(task)) throw new Error('笔记已删除');
      state.attachments = normalizeAttachments(state.attachments);
      state.attachments.images[imageId] = dataUrl;
      save(); if (!(await flushSave())) throw new Error('附件记录未能保存，请重试');
      return `![${String(fileName || '图片').replace(/[\[\]\r\n]/g, ' ')}](${reference})`;
    },
  };
}
function knowledgeSetMode(mode,taskId=knowledgeActiveDocument()?.id) {
  if(!['edit','source','preview'].includes(mode))return;
  captureMountedMilkdownDrafts(); flushNodeNoteDrafts({persist:true});
  const split=knowledgeSplitLayout(),side=split&&split.leftId===taskId?'left':split&&split.rightId===taskId?'right':'';
  if(side)split[side+'Mode']=mode;else applySetting('knowledge-mode', mode);
  save(); render();
}
function knowledgeReceipt(task) {
  return knowledgeSavePresentation(task);
}
function knowledgeSaveStatus(task) {
  const status=knowledgeSaveResults.get(task.id);
  return status && (status.filePath||null)===(task.knowledgeNote.filePath||null)?status:null;
}
function knowledgeSavePresentation(task) {
  const bound=Boolean(task.knowledgeNote?.filePath);
  return {
    ...knowledgeReceiptState(task),
    destination:bound?'file':'loop',
    shortcut:`⌘ / Ctrl + S ${bound?'保存到文件':'选择位置并保存'}`,
    menuLabel:bound?'保存到文件':'保存…',
  };
}
function knowledgeReceiptState(task) {
  const status = knowledgeSaveStatus(task), note = task.knowledgeNote;
  if (knowledgeFileWriteBusy.has(task.id)) return {text:'保存中…', state:'saving'};
  if (status?.error) return {text:'保存失败 · 点击保存重试', state:'failed'};
  if (note.filePath && state.knowledgeFileIssues?.[note.noteId]) return {text:'文件未同步 · 当前内容仍保留',state:'failed'};
  if (['EXTERNAL_CHANGED','FILE_MISSING','READ_ONLY'].includes(note.documentState)) return {text:SHELL_KNOWLEDGE_STATE_LABELS[note.documentState]+' · 当前内容仍保留',state:'conflict'};
  if (nodeNoteDrafts.has(noteDraftKey(task.id,'')) || knowledgeAutosaveTimers.has(task.id)) return {text:'等待保存…',state:'pending'};
  if (localSaveOutcome === 'failed') return {text:'本地保存失败 · 当前内容仍在本页',state:'failed'};
  if (note.filePath && note.dirty) return {text:pendingPayload||saveInFlight||knowledgeRecoveryTimers.has(note.noteId)?'文件未同步 · 正在保留草稿…':'草稿已保留 · 文件尚未同步',state:'pending'};
  if (!note.filePath && (pendingPayload || saveInFlight)) return {text:'正在保留草稿…',state:'pending'};
  return {text:note.filePath ? '已保存到文件' : '草稿已保留 · 尚未保存为文件',state:note.filePath?'saved':'draft'};
}
function knowledgeUpdateChrome(task) {
  const pane = knowledgePane(task?.id);
  if (!pane || pane.dataset.taskId !== task?.id) return;
  const noteState=shellKnowledgeState(task);
  pane.dataset.knowledgeState=noteState.key;
  document.querySelectorAll('[data-kn-document]').forEach(button=>{
    if(button.dataset.knDocument!==task.id)return;
    const title=LoopKnowledgeCore.noteTitle(task),close=button.parentElement.querySelector('[data-kn-detach]');
    button.querySelector('span').textContent=title;button.title=knowledgeTabTitle(task);button.setAttribute('aria-label',title);
    close?.setAttribute('aria-label','关闭笔记：'+title);
    if(close){close.title='关闭笔记：'+title+'（草稿仍保留）';close.toggleAttribute('data-unsaved',!task.knowledgeNote.filePath||task.knowledgeNote.dirty||nodeNoteDrafts.has(noteDraftKey(task.id,'')));}
  });
  const receipt = knowledgeReceipt(task), target = pane.querySelector('[data-kn-receipt]');
  if (target) {target.textContent = receipt.text;target.dataset.state=receipt.state;target.title=knowledgeSaveStatus(task)?.error||receipt.text;target.hidden=!['failed','conflict'].includes(receipt.state);}
  const saveButton = pane.querySelector('[data-note-save]');
  if (saveButton) {saveButton.hidden=receipt.state==='saved';saveButton.disabled=knowledgeFileWriteBusy.has(task.id); saveButton.title=receipt.shortcut;saveButton.innerHTML=shellIcon('check')+(knowledgeFileWriteBusy.has(task.id)?'保存中…':'保存');}
  const shortcut=document.querySelector('.workspace-foot .foot-shortcut');
  if(shortcut)shortcut.textContent='';
  const menuSave=document.querySelector(`[data-knowledge-save-label][data-task-id="${CSS.escape(task.id)}"]`);
  if(menuSave){menuSave.textContent=receipt.menuLabel;menuSave.disabled=knowledgeFileWriteBusy.has(task.id);}
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
  const task = knowledgeAllDocuments().find(t => t.id === taskId); if(!task)return;
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
  const task=knowledgeAllDocuments().find(t=>t.id===taskId); if(!task)return;
  if(task.knowledgeNote.filePath) {
    if(['SAVED','DIRTY'].includes(task.knowledgeNote.documentState)) await saveKnowledgeTask(taskId,{automatic:true});
    return;
  }
  return knowledgeSaveQueue.run(taskId,async()=>{
    if(!knowledgeHasDocument(task))return {canceled:true};
    knowledgeFileWriteBusy.add(taskId);knowledgeUpdateChrome(task);
    try {
      captureMountedMilkdownDrafts();flushNodeNoteDraft(noteDraftKey(taskId,''),{persist:true});
      const content=task.notes;
      await flushKnowledgeRecovery(task.knowledgeNote.noteId,{strict:true});
      await knowledgeRecoveryWriteQueue;
      save();if(!(await flushSave()))throw new Error('本地笔记未能持久化');
      knowledgeSaveResults.set(taskId,{content,filePath:null});
      return {success:true,content,internal:true};
    }catch(error){knowledgeSaveResults.set(taskId,{error:error.message,filePath:null});return {success:false,message:error.message};}
    finally{knowledgeFileWriteBusy.delete(taskId);knowledgeUpdateChrome(task);const pane=knowledgePane(taskId);if(pane)knowledgeSyncNotice(task,pane);}
  });
}
const knowledgePriorSave = saveKnowledgeTask;
saveKnowledgeTask = function knowledgeSerializedSave(taskId, options={}) {
  clearTimeout(knowledgeAutosaveTimers.get(taskId));knowledgeAutosaveTimers.delete(taskId);
  const unbound=knowledgeAllDocuments().find(t=>t.id===taskId);
  if(unbound && !unbound.knowledgeNote.filePath && options.automatic) return knowledgeAutoSave(taskId);
  return knowledgeSaveQueue.run(taskId,async()=>{
    const task=knowledgeAllDocuments().find(t=>t.id===taskId);if(!task)return {canceled:true};
    const generation=knowledgeGenerations.get(taskId)||0;
    knowledgeFileWriteBusy.add(taskId);knowledgeSaveResults.delete(taskId);knowledgeUpdateChrome(task);
    let result;
    try {
      // Recovery must land before a disk write or a user-selected Save As path.
      captureMountedMilkdownDrafts();flushNodeNoteDraft(noteDraftKey(taskId,''),{persist:true});
      await flushKnowledgeRecovery(task.knowledgeNote.noteId,{strict:true});
      result=await knowledgePriorSave(taskId,options);
      if((knowledgeGenerations.get(taskId)||0)!==generation)return result;
      if(result?.success)knowledgeSaveResults.set(taskId,{content:result.content??task.notes,filePath:task.knowledgeNote.filePath||null});
      else if(!result?.canceled)knowledgeSaveResults.set(taskId,{error:result?.message||'保存未完成，请重试',filePath:task.knowledgeNote.filePath||null});
    }catch(error){result={success:false,code:'SAVE_FAILED',message:error.message};knowledgeSaveResults.set(taskId,{error:error.message,filePath:task.knowledgeNote.filePath||null});}
    finally{
      knowledgeFileWriteBusy.delete(taskId);knowledgeUpdateChrome(task);
      if(knowledgeDeferredFileEvents.has(taskId)){knowledgeDeferredFileEvents.delete(taskId);void knowledgeInspectDeferredChange(task);}
      const pane=knowledgePane(taskId);
      if(pane?.dataset.taskId===taskId)knowledgeSyncNotice(task,pane);
    }
    return result;
  });
};
const knowledgePriorReload = reloadKnowledgeTask;
reloadKnowledgeTask = async function knowledgeReloadWithReceipt(taskId) {
  const result = await knowledgePriorReload(taskId);
  if (result?.success) {
    knowledgeSaveResults.delete(taskId);
    const task=knowledgeAllDocuments().find(t=>t.id===taskId),pane=knowledgePane(taskId);
    if(task){knowledgeUpdateChrome(task);if(pane?.dataset.taskId===taskId)knowledgeSyncNotice(task,pane);}
  }
  return result;
};
function knowledgeSyncNotice(task,pane) {
  pane.querySelector('[data-kn-save-error]')?.remove();
  const error=knowledgeSaveStatus(task)?.error;
  if(!error || renderShellKnowledgeNotice(task,shellKnowledgeState(task)))return;
  const notice=document.createElement('div');notice.className='knowledge-notice attention';notice.dataset.knSaveError='true';notice.setAttribute('role','status');
  const text=document.createElement('span');text.textContent=error;notice.append(text);
  const retry=document.createElement('button');retry.type='button';retry.className='text-button';retry.textContent='重试';retry.onclick=()=>void saveKnowledgeTask(task.id);notice.append(retry);
  if(task.knowledgeNote.documentState==='EXTERNAL_CHANGED') {
    const resolve=document.createElement('button');resolve.type='button';resolve.className='text-button';resolve.textContent='处理冲突';resolve.onclick=()=>shellKnowledgeConflict(task);notice.append(resolve);
  }
  pane.querySelector('.knowledge-note-surface')?.before(notice);
}
function knowledgeRefreshPanels(task) {
  const pane=knowledgePane(task?.id);if(!pane)return;
  const body=pane.querySelector('.knowledge-body');if(!body)return;
  let aside=pane.querySelector('.kn-side-panel');
  const backlinksOpen=knowledgeBacklinkPanels.has(task.id),open=knowledgePanels.has(task.id)||backlinksOpen;
  pane.querySelector('.knowledge-header [data-kn-action="panels"]')?.setAttribute('aria-expanded',String(open));
  if(!open){aside?.remove();return;}
  if(!aside){aside=document.createElement('aside');aside.className='kn-side-panel';aside.id='kn-side-panel';body.append(aside);}
  aside.setAttribute('aria-label',backlinksOpen?'反向链接':'笔记大纲');
  const headings=LoopKnowledgeCore.headings(knowledgeText(task));
  if(!backlinksOpen){
    const base=Math.min(...headings.map(h=>h.level),6);
    const html=`<header><strong>大纲</strong><button type="button" class="icon-button" data-kn-action="panels" aria-label="关闭大纲">${shellIcon('close')}</button></header><nav aria-label="笔记大纲">${headings.length?headings.map((h,i)=>`<button type="button" class="kn-outline-link" style="padding-left:${8+(h.level-base)*12}px" data-kn-heading="${i}" title="${escAttr(h.text)}">${esc(h.text)}</button>`).join(''):'<p>添加标题后会显示在这里</p>'}</nav>`;
    if(aside.knowledgeHTML!==html){aside.innerHTML=html;aside.knowledgeHTML=html;}
    knowledgeUpdateOutlineActive(task);return;
  }
  const notes=knowledgeNotes();
  // Index titles and paths once: resolving every link against every note made a
  // 1,100-reference panel block for about half a second (KN-39).
  const byTitle=new Map(), byId=new Map(), byPath=new Map();
  for(const note of notes){
    byId.set(note.id,note);
    // Stable links address the note's own identifier, which may differ from the
    // task id when a note is shared between tasks.
    byId.set(LoopKnowledgeCore.noteId(note),note);
    const filePath=note.knowledgeNote?.filePath;
    if(filePath)byPath.set(knowledgeNormalizePath(filePath),note);
    for(const title of [LoopKnowledgeCore.noteTitle(note),note.title,...(note.knowledgeNote?.aliases||[])]){
      const key=knowledgeNormalizeTitle(title||'');
      if(!key)continue;
      if(!byTitle.has(key))byTitle.set(key,[]);
      // A note's display title, stored title and aliases may be identical.
      // Only different documents make a title ambiguous.
      if(!byTitle.get(key).some(candidate=>candidate.id===note.id))byTitle.get(key).push(note);
    }
  }
  const targetPath=task.knowledgeNote?.filePath?knowledgeNormalizePath(task.knowledgeNote.filePath):null;
  const backlinks=[];const seen=new Set();
  for(const note of notes){
    if(note.id===task.id||seen.has(note.id))continue;
    const text=knowledgeText(note);let cached=knowledgeBacklinkCache.get(note.id);
    if(cached?.text!==text){cached={text,links:LoopKnowledgeCore.links(text),relatives:LoopKnowledgeCore.relativeLinks(text)};knowledgeBacklinkCache.set(note.id,cached);}
    let hit=false;
    for(const link of cached.links){
      const target=link.target||'';
      if(target.startsWith('note:')){hit=byId.get(target.slice(5))?.id===task.id;}
      else{const matches=byTitle.get(knowledgeNormalizeTitle(target))||[];hit=matches.length===1&&matches[0].id===task.id;}
      if(hit)break;
    }
    if(!hit&&targetPath&&note.knowledgeNote?.filePath){
      for(const reference of cached.relatives){
        if(knowledgeAbsolutePath(note.knowledgeNote.filePath,reference.dest)===targetPath){hit=true;break;}
      }
    }
    if(hit){seen.add(note.id);backlinks.push(note);}
  }
  const base=Math.min(...headings.map(h=>h.level),6);
  const html=`<header><strong>反向链接 <small>${backlinks.length}</small></strong><button type="button" class="icon-button" data-kn-action="backlinks" aria-label="关闭反向链接">${shellIcon('close')}</button></header>${backlinks.map(note=>`<button type="button" class="kn-backlink" data-kn-note="${escAttr(note.id)}">${esc(LoopKnowledgeCore.noteTitle(note))}<small>${esc(knowledgeDetail(note))}</small></button>`).join('')||'<p>暂无笔记引用</p>'}`;
  if(aside.knowledgeHTML!==html){aside.innerHTML=html;aside.knowledgeHTML=html;}
  knowledgeUpdateOutlineActive(task);
}
function knowledgeUpdateOutlineActive(task) {
  if(!knowledgePanels.has(task.id))return;
  const editor=knowledgeCurrentEntry(task.id);if(!editor)return;
  const headings=LoopKnowledgeCore.headings(editor.getEditorText()),pos=editor.view.state.selection.main.head;
  const index=headings.findLastIndex(h=>h.offset<=pos);
  knowledgePane(task.id)?.querySelectorAll('.kn-side-panel [data-kn-heading]').forEach(button=>{
    if(Number(button.dataset.knHeading)===index)button.setAttribute('aria-current','location');
    else button.removeAttribute('aria-current');
  });
}
function knowledgeOpen(task,anchor='') {
  if(!state.tasks.includes(task)){knowledgeAttach(task,anchor);return;}
  captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});void flushPendingKnowledgeRecoveries();
  openTaskFromGlobalList(task.id);
  state.activeTaskId=task.id;state.selectedNodeId='';state.taskPane='notes';state.settingsOpen=false;state.reviewOpen=false;state.calendarOpen=false;
  const note=knowledgeActiveDocument(task);if(note){const session=state.knowledgeWorkspace;session.recentIds=[note.id,...session.recentIds.filter(id=>id!==note.id)].slice(0,40);}save();
  shellCloseOverlay({restoreFocus:false});render();
  if(anchor){let attempts=0;const locate=()=>{const editor=knowledgeCurrentEntry(note?.id);if(editor)editor.locateAnchor(anchor);else if(attempts++<30)requestAnimationFrame(locate);};requestAnimationFrame(locate);}
}
function knowledgeOpenLink(link,origin) {
  const resolved=LoopKnowledgeCore.resolve(link.target,knowledgeNotes(),origin);
  if(resolved.status==='resolved'){knowledgeAttach(resolved.note,link.anchor,knowledgeCapturePosition());return;}
  if(resolved.status==='ambiguous'){knowledgeShowSwitcher('',resolved.candidates,link.anchor);return;}
  const deleted=knowledgeAllDocuments().find(task=>task.knowledgeNote?.isDeleted && (link.target==='note:'+LoopKnowledgeCore.noteId(task)||LoopKnowledgeCore.noteTitle(task)===link.target));
  const archived=deleted && state.recentlyDeleted.find(entry=>entry.kind==='note' && entry.ownerTaskId===deleted.id);
  if(archived){
    shellKnowledgeDialog('目标笔记已移除',`<p class="knowledge-dialog-copy">${esc(LoopKnowledgeCore.noteTitle(deleted))} 可从最近删除中恢复。</p>`,'<button class="button" data-action="close-dialog">取消</button><button class="button primary" id="kn-restore-target">恢复笔记</button>');
    document.querySelector('#kn-restore-target').onclick=async()=>{await recovery26RestoreMany([archived.id],{restoreMoved:true});const restored=knowledgeAllDocuments().find(task=>task.id===deleted.id);if(restored)knowledgeOpen(restored,link.anchor);};return;
  }

  shellKnowledgeDialog('目标笔记不存在',`<p class="knowledge-dialog-copy">${esc(link.target)} 尚未创建。</p>`,'<button class="button" data-action="close-dialog">取消</button><button class="button primary" data-kn-action="create-missing">创建笔记</button>');
  document.querySelector('[data-kn-action="create-missing"]').onclick=()=>knowledgeCreate(link.target,origin,link.anchor);
}
function knowledgeOpenRelative(url,origin) {
  return knowledgeOpenResource(url,origin);
}
async function knowledgeCreate(title='',origin=knowledgeAllDocuments().find(t=>t.id===state.activeTaskId),anchor='') {
  title=String(title).trim();if(title.startsWith('note:')){knowledgeShowSwitcher();return;}
  const stamp=now(),noteId=id('document'),creatorTaskId=state.activeTaskId;
  const content=title?'# '+title.replace(/[\r\n]/g,' ')+'\n\n':'';title=title||'未命名';
  const task={id:noteId,title,creatorTaskId,notes:content,createdAt:stamp,updatedAt:stamp,knowledgeNote:knowledgeDocument.createKnowledgeNoteMetadata({taskId:noteId,title,createdAt:stamp})};
  const owner=state.tasks.find(task=>task.id===creatorTaskId);
  if(owner)owner.knowledgeNoteIds=knowledgeDocument.normalizeNoteLinks([...knowledgeDocument.taskNoteIds(owner,state.knowledgeDocuments),noteId]);
  state.knowledgeDocuments.push(task);task.knowledgeNote=knowledgeDocument.markDocumentEdited(task.knowledgeNote);
  if(shellKnowledgeMode()==='preview'){
    const split=knowledgeSplitLayout();
    if(split)split[split.active+'Mode']='edit';else applySetting('knowledge-mode','edit');
  }
  scheduleKnowledgeRecovery(task.id,task.notes);save();knowledgeDidEdit(task.id);knowledgeAttach(task,anchor);
  let attempts=0;const focus=()=>{if(knowledgeActiveDocument()?.id!==task.id)return;const editor=knowledgeCurrentEntry(task.id);if(editor)editor.view.focus();else if(attempts++<60)requestAnimationFrame(focus);};requestAnimationFrame(focus);return task;
}
function knowledgeShowSwitcher(query='',candidates=null,anchor='') {
  shellKnowledgeDialog('知识笔记',`<div class="kn-switcher-search"><input id="kn-switcher-query" type="search" placeholder="搜索标题、正文或标签…" autocomplete="off" value="${escAttr(query)}" aria-label="搜索笔记"><button class="button" type="button" id="kn-create-note">新建</button></div><div id="kn-switcher-list" class="kn-switcher-list" role="listbox" aria-label="笔记列表"></div>`, '<button class="button" type="button" data-action="close-dialog">关闭</button>');
  const input=document.querySelector('#kn-switcher-query'),list=document.querySelector('#kn-switcher-list');let selected=0,current=[];
  const refresh=()=>{
    const q=input.value.toLocaleLowerCase().trim();current=(candidates||knowledgeNotes()).filter(n=>(LoopKnowledgeCore.noteTitle(n)+'\n'+knowledgeDetail(n)+'\n'+knowledgeText(n)).toLocaleLowerCase().includes(q)).slice(0,80);selected=Math.min(selected,Math.max(0,current.length-1));
    list.innerHTML=current.map((n,i)=>`<button class="kn-switcher-row" type="button" role="option" aria-selected="${i===selected}" data-kn-switch="${escAttr(n.id)}"><strong>${esc(LoopKnowledgeCore.noteTitle(n))}</strong><small>${esc(knowledgeDetail(n))}</small></button>`).join('')||'<p>没有匹配的笔记。可用当前名称新建。</p>';
  };
  let composing=false;
  input.addEventListener('compositionstart',()=>{composing=true;});
  input.addEventListener('compositionend',()=>{composing=false;selected=0;refresh();});
  input.addEventListener('input',()=>{if(!composing){selected=0;refresh();}});input.addEventListener('keydown',event=>{
    if(composing||event.isComposing||event.keyCode===229)return;
    if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();selected=(selected+(event.key==='ArrowDown'?1:Math.max(0,current.length-1)))%Math.max(1,current.length);refresh();list.children[selected]?.scrollIntoView({block:'nearest'});}
    if(event.key==='Enter'){event.preventDefault();if(current[selected])knowledgeAttach(current[selected],anchor);else if(input.value.trim())void knowledgeCreate(input.value);}
  });
  list.onclick=event=>{const row=event.target.closest('[data-kn-switch]');const note=knowledgeAllDocuments().find(t=>t.id===row?.dataset.knSwitch);if(note)knowledgeAttach(note,anchor);};
  document.querySelector('#kn-create-note').onclick=()=>{
    if(input.value.trim())void knowledgeCreate(input.value);
    else {input.placeholder='输入新笔记名称';input.focus();}
  };
  refresh();input.focus();
}
function knowledgeShowRecent() {
  captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});
  const session=state.knowledgeWorkspace;
  const ids=knowledgeDocument.normalizeNoteLinks([...session.recentIds,...session.openIds,
    ...knowledgeNotes().slice().sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).map(note=>note.id)]);
  const notes=ids.map(knowledgeFindDocument).filter(note=>note&&!note.knowledgeNote?.isDeleted).slice(0,40);
  shellKnowledgeDialog('最近打开',`<div class="kn-switcher-list" aria-label="最近打开的笔记">${notes.map(note=>`<button class="kn-switcher-row" type="button" data-kn-note="${escAttr(note.id)}"><strong>${esc(LoopKnowledgeCore.noteTitle(note))}</strong><small>${esc(note.knowledgeNote.filePath||'尚未保存为文件 · 草稿已保留')}</small></button>`).join('')||'<p class="knowledge-dialog-copy">还没有打开记录</p>'}</div>`,'<button class="button" data-kn-action="open-file">打开本地笔记…</button><button class="button" data-action="close-dialog">关闭</button>');
}
function knowledgeFileName(filePath) { return String(filePath||'').replace(/\\/g,'/').split('/').at(-1)||''; }
function knowledgeRenameFailureText(failure) {
  switch(failure?.code){
    case 'INVALID_NAME':return failure.message||'名称包含文件系统不允许的内容，请换一个名称';
    case 'NAME_CONFLICT':return '同名文件已存在，请换一个名称';
    case 'DUPLICATE_BINDING':return '这个文件名已绑定到另一篇笔记，请换一个名称';
    case 'FILE_MISSING':return '原文件已不存在，无法同步改名；请先重新定位文件';
    case 'PERMISSION_DENIED':return '没有权限重命名文件，请检查文件或所在目录的权限';
    case 'LOCAL_SAVE_FAILED':return failure.message||'重命名未能保存，请重试';
    case 'NOTE_CHANGED':return failure.message||'笔记已在重命名过程中被移除';
    default:return failure?.message||'重命名未能完成，请重试';
  }
}
// Undoing a rename has to name the exact previous file, not the previous
// title: the file name and the note name are only guaranteed equal after #88.
async function knowledgeRenameFileTo(filePath,targetName) {
  if(!desktopKnowledgeFile?.rename||!filePath||!targetName)return false;
  try{const result=await desktopKnowledgeFile.rename({filePath,targetName});return result?.success===true;}
  catch(failure){console.error('Failed to restore the previous knowledge file name.',failure);return false;}
}
// Notes whose relative Markdown links still address the old file name. Stable
// `[[note:…]]` links carry the identifier and title links keep the previous
// name as an alias, so only these relative references can break (KN-88).
function knowledgeReferencingNotes(previousPath) {
  const entries=[];
  for(const note of knowledgeNotes()){
    const filePath=note.knowledgeNote?.filePath;if(!filePath)continue;
    const content=knowledgeText(note);if(!content||!content.includes(']('))continue;
    const links=LoopKnowledgeCore.linksToFile(content,{noteFilePath:filePath,filePath:previousPath,platform:desktopPlatform});
    if(links.length)entries.push({note,links});
  }
  return entries;
}
async function knowledgeUpdateFileLinks(previousPath,nextPath) {
  const entries=knowledgeReferencingNotes(previousPath);
  let updated=0,failed=0;
  for(const {note} of entries){
    if(!knowledgeHasDocument(note))continue;
    const notePath=note.knowledgeNote?.filePath;if(!notePath)continue;
    const rewritten=LoopKnowledgeCore.rewriteLinksToFile(knowledgeText(note),{noteFilePath:notePath,filePath:previousPath,nextPath,platform:desktopPlatform});
    if(!rewritten.changed)continue;
    updated+=rewritten.changed;
    note.notes=rewritten.content;
    note.knowledgeNote=knowledgeDocument.markDocumentEdited(note.knowledgeNote);
    note.updatedAt=now();
    discardMountedKnowledgeEditor(note.id);
    save();
    const result=await saveKnowledgeTask(note.id,{automatic:true});
    if(!result?.success)failed++;
  }
  if(entries.length)render();
  return {updated,failed};
}
function knowledgeOfferLinkUpdate(previousPath,nextPath) {
  const entries=knowledgeReferencingNotes(previousPath);
  if(!entries.length)return;
  const count=entries.reduce((total,entry)=>total+entry.links.length,0);
  const names=entries.slice(0,4).map(entry=>LoopKnowledgeCore.noteTitle(entry.note));
  shellKnowledgeDialog('更新文件链接',`<p class="knowledge-dialog-copy">有 ${count} 处相对链接仍指向「${esc(knowledgeFileName(previousPath))}」，更新后会改为指向新的文件名。稳定链接（[[note:…]] 或笔记名称）不受影响。</p><p class="knowledge-dialog-copy">涉及：${esc(names.join('、'))}${entries.length>names.length?` 等 ${entries.length} 篇`:''}</p>`,'<button class="button" data-action="close-dialog">保留旧链接</button><button class="button primary" id="kn-update-links">更新链接</button>',520,'[data-wb-action="more"]');
  const commit=document.querySelector('#kn-update-links');
  if(commit)commit.onclick=async()=>{
    shellCloseOverlay({restoreFocus:false});
    const result=await knowledgeUpdateFileLinks(previousPath,nextPath);
    shellToast(result.failed?`已更新 ${result.updated} 处链接，${result.failed} 篇笔记未能写入文件，请手动保存。`:`已更新 ${result.updated} 处链接`);
  };
}
function knowledgeRename(task,trigger) {
  // Escape/cancel must return to the control the dialog was opened from.
  const returnFocus=trigger?.dataset.knDocument?`[data-kn-document="${CSS.escape(task.id)}"]`:'[data-wb-action="more"]';
  shellKnowledgeDialog('重命名笔记',`<label class="knowledge-dialog-copy" for="kn-rename-title">笔记名称</label><input id="kn-rename-title" value="${escAttr(LoopKnowledgeCore.noteTitle(task))}" maxlength="200" aria-describedby="kn-rename-error"><p id="kn-rename-error" class="kn-rename-error" role="alert"></p>${task.knowledgeNote.filePath?'<p class="knowledge-dialog-copy">保存后会同步重命名本地文件，扩展名保持不变。</p>':''}`,'<button class="button" data-action="close-dialog">取消</button><button class="button primary" id="kn-rename-commit">保存名称</button>',520,returnFocus);
  const field=document.querySelector('#kn-rename-title'),button=document.querySelector('#kn-rename-commit'),error=document.querySelector('#kn-rename-error'),surface=field.closest('[role="dialog"]');
  const noteId=task.knowledgeNote.noteId;let busy=false,composing=false;
  field.focus();field.select();
  const owns=()=>surface.isConnected && document.querySelector('#kn-rename-title')===field;
  const clearError=()=>{error.textContent='';field.removeAttribute('aria-invalid');};
  field.oninput=()=>{if(field.value.trim())clearError();};
  field.oncompositionstart=()=>{composing=true;};field.oncompositionend=()=>{composing=false;};
  const commit=async()=>{
    if(busy||composing)return;
    const title=field.value.trim();
    if(!title){error.textContent='请输入笔记名称';field.setAttribute('aria-invalid','true');field.focus();return;}
    if(!knowledgeHasDocument(task)||task.knowledgeNote.noteId!==noteId)return;
    if(title===LoopKnowledgeCore.noteTitle(task)){shellCloseOverlay();return;}
    clearError();busy=true;button.disabled=true;field.readOnly=true;surface.setAttribute('aria-busy','true');button.textContent='正在保存…';
    const previous={...task.knowledgeNote},previousUpdatedAt=task.updatedAt,previousTitle=task.title;
    let outcome;
    try{
      // The per-note queue is the same one saves use: a pending save of the old
      // path can never run after the file has moved.
      outcome=await knowledgeSaveQueue.run(task.id,async()=>{
        captureMountedMilkdownDrafts();flushNodeNoteDraft(noteDraftKey(task.id,''),{persist:true});
        let filePath=previous.filePath||null,renamedFile=false,missingFile=false,watched=false;
        // #88: the file is the source of truth. Only a committed filesystem
        // rename may change the name this note shows.
        if(previous.filePath&&desktopKnowledgeFile?.rename){
          let renamed;
          try{renamed=await desktopKnowledgeFile.rename({noteId:previous.noteId||task.id,filePath:previous.filePath,title,boundPaths:boundKnowledgeFilePaths(task.id),lastSavedHash:previous.lastSavedHash});}
          catch(failure){renamed={success:false,code:'RENAME_FAILED',message:failure?.message};}
          if(renamed?.canceled)return {canceled:true};
          if(renamed?.code==='FILE_MISSING')missingFile=true;
          else if(!renamed?.success)return {failure:renamed};
          else if(renamed.filePath){renamedFile=renamed.filePath!==previous.filePath;filePath=renamed.filePath;watched=renamed.watched===true;}
        }
        if(!knowledgeHasDocument(task)||task.knowledgeNote.noteId!==noteId){
          if(renamedFile)await knowledgeRenameFileTo(filePath,knowledgeFileName(previous.filePath));
          return {failure:{code:'NOTE_CHANGED',message:'笔记已被移除，文件名已恢复'}};
        }
        task.knowledgeNote=knowledgeDocument.updateDocumentTitle(previous,title);
        if(renamedFile)task.knowledgeNote={...task.knowledgeNote,filePath};
        task.updatedAt=now();
        if(!state.tasks.includes(task))task.title=title;
        save();
        if(!(await flushSave())){
          // A name the app cannot remember after a restart must not survive on
          // disk either, so the rename is undone before the error is shown.
          const restored=renamedFile?await knowledgeRenameFileTo(filePath,knowledgeFileName(previous.filePath)):true;
          if(restored){
            task.knowledgeNote=previous;task.updatedAt=previousUpdatedAt;
            if(!state.tasks.includes(task))task.title=previousTitle;
            save();
            return {failure:{code:'LOCAL_SAVE_FAILED',message:renamedFile?'重命名未能保存，文件名已恢复':'重命名未能保存，请重试'}};
          }
          return {failure:{code:'LOCAL_SAVE_FAILED',message:`文件已改名为「${knowledgeFileName(filePath)}」，但笔记记录未能保存，请重试保存`}};
        }
        return {success:true,filePath,previousFilePath:renamedFile?previous.filePath:null,missingFile,watched};
      });
    }catch(failure){console.error('Failed to rename knowledge note.',failure);outcome={failure:{code:'RENAME_FAILED',message:failure?.message}};}
    finally{busy=false;button.disabled=false;field.readOnly=false;surface.removeAttribute('aria-busy');button.textContent='保存名称';}
    if(outcome?.canceled)return;
    if(outcome?.failure){
      if(owns()){error.textContent=knowledgeRenameFailureText(outcome.failure);if(knowledgeActiveDocument()?.id===task.id)field.focus();}
      return;
    }
    if(owns())shellCloseOverlay();
    knowledgeCurrentEntry(task.id)?.refresh();render();
    // Main already re-pointed the watcher silently; only re-sync when it had no
    // entry to update, otherwise a baseline read could mark a draft as saved.
    if(!outcome?.watched){
      try{await syncKnowledgeFileWatcher(task);}catch(failure){console.error('Failed to refresh the knowledge file watcher after a rename.',failure);}
    }
    if(outcome?.missingFile)shellToast('原文件不存在，已只更新笔记名称；恢复文件后请重新定位。');
    else if(outcome?.previousFilePath){
      shellToast(`文件已重命名为「${knowledgeFileName(outcome.filePath)}」`);
      knowledgeOfferLinkUpdate(outcome.previousFilePath,outcome.filePath);
    }
  };
  button.onclick=()=>void commit();field.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229&&!composing){event.preventDefault();void commit();}};
}
function knowledgeFocusTableCell(editor,widget,row,column,selection=null) {
  if(editor!==knowledgeCurrentEntry()||editor.destroyed)return;
  const cell=widget?.isConnected&&widget.querySelector('table')?.rows[row]?.cells[column];
  if(cell){
    editor.editTableCell(widget,cell,false,selection?.start??null);
    if(selection)editor.activeTableCell?.input.setSelectionRange(selection.start,selection.end,selection.direction);
  }else if(widget?.isConnected)widget.focus({preventScroll:true});
  else editor.view.focus();
}
function knowledgeTableMenu({widget,row=0,column=0,cellSelection=null,scope='table',trigger,point}) {
  const editor=knowledgeCurrentEntry();if(!editor||editor.mode==='preview')return;
  const from=Number(widget.dataset.sourcePos),source=editor.view.state.doc;
  const table=LoopKnowledgeCore.tableAt(editor.getEditorText(),from);if(!table)return;
  const rows=widget.querySelector('table').rows,caption=scope==='row'?(row===0?'表头行':`第 ${row} 行`):scope==='column'?`第 ${column+1} 列`:`${rows.length-1} 行 · ${rows[0].cells.length} 列`;
  const item=(operation,label,{disabled=false,value,checked,shortcut=''}={})=>`<button type="button" role="${checked===undefined?'menuitem':'menuitemradio'}" ${checked===undefined?'':`aria-checked="${checked}"`} data-table-command="${operation}" ${value===undefined?'':`data-value="${escAttr(String(value))}"`} ${disabled?'disabled':''}><span>${label}</span>${shortcut?`<kbd>${shortcut}</kbd>`:''}</button>`;
  const divider='<div class="menu-divider" role="separator"></div>';
  const align=table.rows[1][column]||'---',alignment=/^:.*:$/.test(align)?'center':/:$/.test(align)?'right':'left';
  const rowItems=()=>item('row-before','上方插入行')+item('row-add','下方插入行')+item('row-duplicate','复制一行',{disabled:row===0})+divider+
    item('row-move','上移一行',{value:row,disabled:row<=1})+item('row-move','下移一行',{value:row+2,disabled:row===0||row>=rows.length-1})+divider+item('row-clear','清空这一行')+item('row-delete','删除这一行',{disabled:row===0});
  const columnItems=()=>item('column-before','左侧插入列')+item('column-add','右侧插入列')+item('column-duplicate','复制一列')+divider+
    item('column-move','向左移动',{value:column-1,disabled:column===0})+item('column-move','向右移动',{value:column+1,disabled:column>=rows[0].cells.length-1})+divider+
    [['left','左对齐'],['center','居中'],['right','右对齐']].map(([value,label])=>item('align',label,{value,checked:alignment===value})).join('')+divider+item('column-clear','清空这一列')+item('column-delete','删除这一列',{disabled:rows[0].cells.length<=1});
  const content=scope==='row'?rowItems():scope==='column'?columnItems():
    item('fit','适应页宽')+item('auto-width','自动列宽')+divider+item('row-menu','当前行操作…')+item('column-menu','当前列操作…')+item('cell-clear','清空当前单元格')+divider+item('copy','复制 Markdown')+item('details','精确设置…')+divider+item('delete','删除表格');
  const menu=shellMountSurface(`<div class="surface-popover wb-menu kn-table-menu" role="menu" aria-label="${escAttr(caption)}操作"><div class="kn-table-menu-caption">${caption}</div><div class="wb-menu-list">${content}</div></div>`,trigger||widget,218);
  if(trigger?.dataset.tableAction)menu.dataset.returnFocus=`.kn-table-widget[data-source-pos="${from}"] [data-table-action="${trigger.dataset.tableAction}"]`;
  else if(trigger?.dataset.tableHandle)menu.dataset.returnFocus=`.kn-table-widget[data-source-pos="${from}"] [data-table-handle="${trigger.dataset.tableHandle}"][data-index="${trigger.dataset.index}"]`;
  if(point){menu.style.left=Math.max(8,Math.min(point.x,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(point.y,innerHeight-menu.offsetHeight-8))+'px';}
  const restore=()=>{
    if(editor!==knowledgeCurrentEntry()||editor.destroyed||editor.view.state.doc!==source||!widget.isConnected){shellCloseOverlay({restoreFocus:false});shellToast('表格已变化，请重新打开菜单。');return false;}
    const range=editor.tableCellRange(widget,row,column);if(!range)return false;
    editor.finishTableCell();editor.tableColumn=column;editor.view.dispatch({selection:{anchor:range.from},scrollIntoView:false});return true;
  };
  menu.addEventListener('click',async event=>{
    const button=event.target.closest('[data-table-command]');if(!button||button.disabled)return;
    event.preventDefault();event.stopPropagation();if(!restore())return;
    const command=button.dataset.tableCommand;const next={widget,row,column,cellSelection,trigger};
    shellCloseOverlay({restoreFocus:false});
    if(command==='row-menu'){knowledgeTableMenu({...next,scope:'row'});return;}
    if(command==='column-menu'){knowledgeTableMenu({...next,scope:'column'});return;}
    if(command==='details'){knowledgeTableTools(next);return;}
    if(command==='copy'){try{await navigator.clipboard.writeText(editor.getEditorText().slice(table.from,table.to));shellToast('已复制表格 Markdown');}catch{shellToast('无法复制，请在源码模式选择表格后复制。');}knowledgeFocusTableCell(editor,widget,row,column,cellSelection);return;}
    if(command==='fit'||command==='auto-width'){
      if(command==='fit')editor.fitTableWidth(0,widget);
      else editor.fitTableWidth(0);
      // The main editor represents a table as one block widget. Focusing it
      // here paints a block-height caret at the table edge instead of the cell.
      knowledgeFocusTableCell(editor,widget,row,column,cellSelection);
      return;
    }
    if(!editor.table(command,column,button.dataset.value))shellToast('当前行列无法执行这项操作。');
  });
  menu.addEventListener('keydown',event=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const items=[...menu.querySelectorAll('button:not(:disabled)')],index=items.indexOf(document.activeElement);
    items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();
  });
  menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
}
function knowledgeTableTools(context=null) {
  const editor=knowledgeCurrentEntry();if(!editor)return;
  const table=LoopKnowledgeCore.tableAt(editor.getEditorText(),editor.view.state.selection.main.head);
  if(!table){shellToast('请先点击需要编辑的表格单元格。');return;}
  const widget=context?.widget||editor.root.querySelector(`.kn-table-widget[data-source-pos="${table.from}"]`);
  shellKnowledgeDialog('编辑表格',`<div class="kn-table-controls"><label>列 <select id="kn-table-column">${table.rows[0].map((_,i)=>`<option value="${i}" ${i===(editor.tableColumn||0)?'selected':''}>${i+1}</option>`).join('')}</select></label><label>单元格 <input id="kn-table-value" value="${escAttr(table.rows[table.row]?.[editor.tableColumn||0]||'')}"></label><button class="button" data-kn-table="cell">更新单元格</button><button class="button" data-kn-table="row-add">在下方插入行</button><button class="button" data-kn-table="row-delete">删除当前行</button><button class="button" data-kn-table="column-add">在右侧插入列</button><button class="button" data-kn-table="column-delete">删除当前列</button><label>对齐 <select id="kn-table-align"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label><button class="button" data-kn-table="align">应用对齐</button></div>`,'<button class="button" data-action="close-dialog">关闭</button>');
  const column=document.querySelector('#kn-table-column'),value=document.querySelector('#kn-table-value');
  const controls=document.querySelector('.kn-table-controls'),rowLabel=document.createElement('label');rowLabel.textContent='行 ';
  const row=document.createElement('select');row.id='kn-table-row';
  table.rows.forEach((_,index)=>{if(index===1)return;const option=document.createElement('option');option.value=index;option.textContent=index===0?'表头':`第${index-1}行`;option.selected=index===table.row;row.append(option);});rowLabel.append(row);controls.prepend(rowLabel);
  for(const [operation,label] of [['row-before','在上方插入行'],['column-before','在左侧插入列'],['delete','删除整张表格']]){const button=document.createElement('button');button.type='button';button.className='button';button.dataset.knTable=operation;button.textContent=label;controls.append(button);}
  const align=document.querySelector('#kn-table-align');
  const refresh=()=>{const index=Number(column.value);value.value=table.rows[Number(row.value)]?.[index]||'';align.value=/^:.*:$/.test(table.rows[1][index])?'center':/:$/.test(table.rows[1][index])?'right':'left';document.querySelector('[data-kn-table="row-delete"]').disabled=Number(row.value)===0;document.querySelector('[data-kn-table="column-delete"]').disabled=table.rows[0].length===1;};
  row.onchange=refresh;column.onchange=refresh;refresh();
  const widthLabel=document.createElement('label');widthLabel.textContent='列宽（px） ';
  const width=document.createElement('input');width.type='number';width.min='80';width.max='1600';width.value=editor.options.tableColumnWidths?.[editor.tableIndex(table.from)]?.[Number(column.value)]||120;widthLabel.append(width);controls.append(widthLabel);
  const resize=document.createElement('button');resize.type='button';resize.className='button';resize.textContent='设置列宽';resize.onclick=()=>{
    if(!width.reportValidity())return;
    const targetRow=Number(row.value)===0?0:Number(row.value)-1,targetColumn=Number(column.value);
    const selection=context?.row===targetRow&&context?.column===targetColumn?context.cellSelection:null;
    shellCloseOverlay({restoreFocus:false});editor.resizeTableColumn(targetColumn,width.value,widget);
    knowledgeFocusTableCell(editor,widget,targetRow,targetColumn,selection);
  };controls.append(resize);
  column.addEventListener('change',()=>{width.value=editor.options.tableColumnWidths?.[editor.tableIndex(table.from)]?.[Number(column.value)]||120;});
  document.querySelectorAll('[data-kn-table]').forEach(button=>button.onclick=()=>{const operation=button.dataset.knTable,idx=Number(column.value),v=operation==='align'?document.querySelector('#kn-table-align').value:value.value;
    const pos=table.from+editor.getEditorText().slice(table.from,table.to).split('\n').slice(0,Number(row.value)).reduce((sum,line)=>sum+line.length+1,0);
    shellCloseOverlay({restoreFocus:false});editor.finishTableCell();editor.view.dispatch({selection:{anchor:pos}});if(!editor.table(operation,idx,v))shellToast('当前行或列不能执行此操作。');
  });
}
const knowledgePriorBind = shellBindKnowledge;
shellBindKnowledge = function() {
  knowledgePriorBind();
  knowledgeBindTabs();
  knowledgeBindToolbar();
  knowledgeBindResources();
  knowledgeBindSplit();
  knowledgeSyncFocus();
  const task=knowledgeActiveDocument();if(!task||!document.querySelector('.knowledge-pane'))return;
  for(const pane of document.querySelectorAll('.knowledge-pane[data-task-id]')){
    const note=knowledgeFindDocument(pane.dataset.taskId);if(!note)continue;
    knowledgeCurrentEntry(note.id)?.setMode(shellKnowledgeMode(note.id));knowledgeUpdateChrome(note);knowledgeRefreshPanels(note);
  }
};
function knowledgeInsertMenu(trigger) {
  const item=(action,icon,label,extra='')=>`<button class="button" type="button" role="menuitem" data-kn-action="${action}" ${extra}>${shellIcon(icon)}${label}</button>`;
  shellMountSurface(`<div class="surface-popover kn-insert-menu" role="menu" aria-label="插入与更多格式">
    ${item('insert-format','knowledgeTable','表格','data-kn-format="table"')}
    ${item('table-tools','knowledgeTable','编辑表格行列…')}
    ${item('insert-format','knowledgeCode','代码块','data-kn-format="code"')}
    ${item('insert-format','knowledgeDiagram','Mermaid 图表','data-kn-format="diagram"')}
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
  if(event.detail>0&&knowledgeTabDragClickPending&&event.target.closest('.kn-document-bar')){
    knowledgeTabDragClickPending=false;event.preventDefault();event.stopImmediatePropagation();return;
  }
  const resource=event.target.closest('[data-kn-resource]');if(resource){knowledgeSelectResource(resource.dataset.knResource);return;}
  const resourceClose=event.target.closest('[data-kn-resource-close]');if(resourceClose){void knowledgeCloseResource(resourceClose.dataset.knResourceClose);return;}
  const tab=event.target.closest('[data-kn-document]');
  if(tab){
    const note=knowledgeFindDocument(tab.dataset.knDocument);if(!note)return;
    // Activating an inactive tab replaces its DOM. Track the note identity so
    // the second click can still open rename after that render.
    const click={id:note.id,time:event.timeStamp,x:event.clientX,y:event.clientY};
    const pair=event.detail>0&&knowledgeLastTabClick?.id===note.id&&
      (event.detail===2||(click.time-knowledgeLastTabClick.time<=500&&Math.hypot(click.x-knowledgeLastTabClick.x,click.y-knowledgeLastTabClick.y)<=6));
    knowledgeLastTabClick=event.detail>0&&!pair?click:null;
    if(knowledgeActiveResource()||knowledgeActiveDocument()?.id!==note.id)knowledgeAttach(note);
    if(pair)knowledgeRename(note,tab);
    return;
  }
  knowledgeLastTabClick=null;
  const close=event.target.closest('[data-kn-detach]');if(close){knowledgeDetach(close.dataset.knDetach);return;}
  const scroll=event.target.closest('[data-kn-scroll]');
  if(scroll){
    const viewport=scroll.closest('.kn-document-bar').querySelector('.kn-document-tabs');
    viewport.scrollLeft+=Number(scroll.dataset.knScroll)*Math.max(120,viewport.clientWidth*.65);
    knowledgeUpdateTabScroll();return;
  }
  const heading=event.target.closest('[data-kn-heading]');if(heading){const task=knowledgeActiveDocument(),h=LoopKnowledgeCore.headings(knowledgeCurrentEntry()?.getEditorText()||LoopKnowledgeCore.sourceFormat(knowledgeText(task)).text)[Number(heading.dataset.knHeading)];if(h)knowledgeCurrentEntry()?.locate(h.offset);return;}
  const back=event.target.closest('[data-kn-note]');if(back){const note=knowledgeAllDocuments().find(t=>t.id===back.dataset.knNote);if(note)knowledgeAttach(note);return;}
  const button=event.target.closest('[data-kn-action]');if(!button)return;
  const action=button.dataset.knAction;
  if(action==='membership'){
    void knowledgeSetMembership(button.dataset.ownerTaskId,button.dataset.noteId,button.dataset.joined==='true',button);
    return;
  }
  if(action==='new-note'){void knowledgeNewDialog();return;}
  if(action==='open-file'){shellCloseOverlay({restoreFocus:false});void knowledgeOpenFile();return;}
  if(action==='recent'){knowledgeShowRecent();return;}
  if(action==='switcher'){knowledgeShowSwitcher();return;}
  const task=knowledgeActiveDocument();if(!task)return;
  if(button.closest('.kn-insert-menu'))shellCloseOverlay({restoreFocus:false});
  if(action==='insert-menu')knowledgeInsertMenu(button);
  if(action==='insert-format')shellApplyNoteFormat(button.dataset.knFormat);
  if(action==='panels'||action==='backlinks'){
    const closing=button.closest('.kn-side-panel'),current=action==='panels'?knowledgePanels:knowledgeBacklinkPanels,other=action==='panels'?knowledgeBacklinkPanels:knowledgePanels;
    if(current.has(task.id))current.delete(task.id);else{current.add(task.id);other.delete(task.id);}
    shellCloseOverlay({restoreFocus:false});knowledgeRefreshPanels(task);if(closing)document.querySelector('[data-wb-action="more"]')?.focus({preventScroll:true});
  }
  if(action==='rename')knowledgeRename(task,button);
  if(action==='find')knowledgeCurrentEntry()?.openSearch();
  if(action==='table-tools')knowledgeTableTools();
  if(action==='upload'){const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp';input.multiple=true;const editor=knowledgeCurrentEntry();input.onchange=()=>{for(const file of input.files)void editor?.upload(file);};input.click();}
},true);
document.addEventListener('keydown',event=>{
  const tab=event.target.closest('.kn-document-tabs [role=tab]');
  if(tab&&(event.isComposing||event.keyCode===229))return;
  if(tab?.dataset.knDocument&&event.altKey&&event.shiftKey&&['ArrowLeft','ArrowRight'].includes(event.key)){
    event.preventDefault();event.stopImmediatePropagation();
    const viewport=tab.closest('.kn-document-tabs'),item=tab.parentElement;
    const peer=event.key==='ArrowLeft'?item.previousElementSibling:item.nextElementSibling;
    if(!peer?.querySelector('[data-kn-document]'))return;
    viewport.insertBefore(item,event.key==='ArrowLeft'?peer:peer.nextElementSibling);
    knowledgeSaveTabOrder(viewport,activeTask());tab.focus({preventScroll:true});knowledgeUpdateTabScroll();return;
  }
  if(tab?.dataset.knResource&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const tabs=[...tab.closest('[role=tablist]').querySelectorAll('[role=tab]')],index=tabs.indexOf(tab),next=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];
    if(next.dataset.knResource)knowledgeSelectResource(next.dataset.knResource);else knowledgeAttach(knowledgeFindDocument(next.dataset.knDocument));document.querySelector(next.dataset.knDocument?`[data-kn-document="${CSS.escape(next.dataset.knDocument)}"]`:'.kn-document-tabs [aria-selected=true]')?.focus();return;
  }
  if(tab&&event.key==='F2'&&!event.isComposing){
    event.preventDefault();knowledgeLastTabClick=null;
    const note=knowledgeFindDocument(tab.dataset.knDocument);if(!note)return;
    if(knowledgeActiveDocument()?.id!==note.id)knowledgeAttach(note);
    knowledgeRename(note,tab);return;
  }
  if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const tabs=[...tab.closest('[role=tablist]').querySelectorAll('[role=tab]')],index=tabs.indexOf(tab);
    const next=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];
    if(next.dataset.knResource)knowledgeSelectResource(next.dataset.knResource);else knowledgeAttach(knowledgeFindDocument(next.dataset.knDocument));document.querySelector(next.dataset.knDocument?`[data-kn-document="${CSS.escape(next.dataset.knDocument)}"]`:'.kn-document-tabs [aria-selected=true]')?.focus();return;
  }
  if(event.isComposing||!(event.ctrlKey||event.metaKey)||state.taskPane!=='notes'||shellOverlayIsOpen())return;
  const key=event.key.toLowerCase();
  if(key==='o'){event.preventDefault();event.stopImmediatePropagation();void knowledgeOpenFile();}
  if(key==='f'){event.preventDefault();event.stopImmediatePropagation();knowledgeCurrentEntry()?.openSearch();}
},true);
// Dismissing this formatting menu must not rerender the workspace and discard
// the trigger's keyboard focus. Other Loop dialogs keep their own dismissal.
window.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||event.isComposing||!document.querySelector('.kn-insert-menu'))return;
  event.preventDefault();event.stopImmediatePropagation();shellCloseOverlay();
},true);
window.addEventListener('beforeunload',()=>{captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});save();void flushPendingKnowledgeRecoveries();});
// The single-instance desktop app scopes all notes to the current Loop data
// directory. Its existing path gate remains the only disk-access authority.

async function knowledgeInspectDeferredChange(task) {
  if(!knowledgeHasDocument(task)||!task.knowledgeNote.filePath)return;
  try {
    const current=await desktopKnowledgeFile.read({filePath:task.knowledgeNote.filePath});
    if(current?.success && current.lastSavedHash!==task.knowledgeNote.lastSavedHash) {
      await handleKnowledgeFileChange({...current,type:'external-changed',noteId:task.knowledgeNote.noteId});
      knowledgeUpdateChrome(task);
    }
  } catch { /* The existing watcher will report an unavailable file on its next scan. */ }
}

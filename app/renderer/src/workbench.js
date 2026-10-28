/* Workbench presentation only. All editing, search, file and save operations
   delegate to the existing knowledge editor and its persistence pipeline. */
const Workbench = {details:new Set(),focus:false,context:null,parents:new Map()};

function renderWorkbenchContext(task) {
  const deadline=shellDeadlineProperty(task),tags=normalizeTaskTags(task.tags),open=Workbench.details.has(task.id);
  return `<div class="task-properties wb-task-context"><button class="badge ${isTaskScheduledForToday(task)?'green':''}" type="button" data-action="toggle-task-tag" data-tag="today" data-task-id="${escAttr(task.id)}" aria-pressed="${tags.today}">${esc(shellTodayReason(task))}</button><span>${shellTaskDone(task)?'已完成':'处理中'}</span>${task.deadlineAt?`<button class="property ${deadline.classes}" type="button" data-action="toggle-deadline-picker" data-task-id="${escAttr(task.id)}" title="${escAttr(deadline.title)}">${shellIcon('calendar')}${esc(deadline.text)}</button>`:''}<button class="property" type="button" data-wb-action="details" aria-expanded="${open}" aria-controls="wb-task-details">任务详情${shellIcon('down')}</button></div>`;
}
function renderWorkbenchDetails(task) {
  return Workbench.details.has(task.id)?`<section class="wb-task-details" id="wb-task-details" aria-label="任务详情">${renderShellTaskProperties(task)}${renderShellBrief(task)}</section>`:'';
}
function workbenchClearChildren(depth=1) {
  document.querySelectorAll('.wb-submenu').forEach(menu=>{const level=Number(menu.dataset.wbDepth);if(level>=depth){const parent=Workbench.parents.get(level);parent?.classList.remove('submenu-open');parent?.setAttribute('aria-expanded','false');Workbench.parents.delete(level);menu.remove();}});
}
function workbenchClose(focus=true) {
  workbenchClearChildren();shellCloseOverlay({restoreFocus:false});
  const context=Workbench.context;Workbench.context=null;
  document.querySelector('[data-wb-action="more"]')?.setAttribute('aria-expanded','false');
  if(focus&&context?.entry===knowledgeCurrentEntry()&&!context.entry.destroyed){if(context.entry.mode==='preview')context.entry.readHost.focus({preventScroll:true});else context.entry.view.focus();}
}
function workbenchSnapshot() {
  const entry=knowledgeCurrentEntry(),task=shellActiveTask();if(!entry?.view||!task)return null;
  return {taskId:task.id,entry,doc:entry.view.state.doc,selection:entry.getSelection(),reading:entry.mode==='preview'?window.getSelection()?.toString()||'':''};
}
function workbenchRestore(context=Workbench.context) {
  if(!context||context.taskId!==state.activeTaskId||context.entry!==knowledgeCurrentEntry()||context.entry.destroyed||context.doc!==context.entry.view.state.doc){workbenchClose(false);shellToast('笔记内容已变化，请重新打开菜单。');return null;}
  if(context.entry.mode!=='preview')context.entry.restoreSelection(context.selection);
  return context.entry;
}
function workbenchRow(label,attributes='',shortcut='') {
  return `<button type="button" role="menuitem" ${attributes}><span>${esc(label)}</span>${shortcut?`<kbd>${esc(shortcut)}</kbd>`:''}</button>`;
}
function workbenchBranch(label,group) {
  return `<button type="button" role="menuitem" data-wb-sub="${group}" aria-haspopup="menu" aria-expanded="false"><span>${esc(label)}</span>${shellIcon('chevron')}</button>`;
}
const WB_DIVIDER='<div class="menu-divider" role="separator"></div>';
function workbenchFormatRow(label,format,value,shortcut='') {
  return workbenchRow(label,`data-wb-format="${format}" ${value===undefined?'':`data-wb-value="${value}"`}`,shortcut);
}
function workbenchGroup(group) {
  const row=workbenchRow,fmt=workbenchFormatRow;
  if(group==='text')return fmt('加粗','bold',undefined,'⌘ B')+fmt('倾斜','italic',undefined,'⌘ I')+fmt('删除线','strike')+fmt('高亮','highlight')+WB_DIVIDER+fmt('行内代码','inline')+row('清除格式','data-wb-action="clear-format"');
  if(group==='paragraph')return fmt('正文','heading',0)+workbenchBranch('标题','headings')+WB_DIVIDER+fmt('无序列表','bullet')+fmt('有序列表','ordered')+fmt('任务列表','task')+WB_DIVIDER+fmt('引用','quote');
  if(group==='headings')return [1,2,3,4,5,6].map(n=>fmt(`标题 ${n}`,'heading',n)).join('');
  if(group==='insert')return row('内部链接…','data-wb-action="wiki"')+row('外部链接…','data-wb-action="link"')+row('图片…','data-kn-action="upload"')+row('表格','data-wb-format="table"')+row('编辑表格行列…','data-kn-action="table-tools"')+WB_DIVIDER+fmt('代码块','code')+row('数学公式','data-wb-action="math"')+row('Mermaid 图表','data-wb-action="diagram"')+fmt('分隔线','rule');
  return '';
}
function workbenchSubmenu(trigger,focus=false) {
  const depth=Number(trigger.closest('[data-wb-depth]').dataset.wbDepth)+1;
  if(trigger.classList.contains('submenu-open')){if(focus)document.querySelector(`.wb-submenu[data-wb-depth="${depth}"] button`)?.focus();return;}
  workbenchClearChildren(depth);
  const menu=document.createElement('div');menu.className='surface-popover wb-menu wb-submenu';menu.dataset.wbDepth=depth;menu.setAttribute('role','menu');menu.setAttribute('aria-label',trigger.textContent.trim());
  menu.innerHTML=`<div class="wb-menu-list">${workbenchGroup(trigger.dataset.wbSub)}</div>`;shellOverlay().append(menu);
  Workbench.parents.set(depth,trigger);trigger.classList.add('submenu-open');trigger.setAttribute('aria-expanded','true');
  const rect=trigger.getBoundingClientRect(),left=rect.right+menu.offsetWidth+8>innerWidth?rect.left-menu.offsetWidth+3:rect.right-3;
  menu.style.left=`${Math.max(8,left)}px`;menu.style.top=`${Math.max(8,Math.min(rect.top-5,innerHeight-menu.offsetHeight-8))}px`;
  if(focus)menu.querySelector('button')?.focus({preventScroll:true});
}
function workbenchFormatMenu(trigger,point) {
  const snapshot=workbenchSnapshot();if(!snapshot)return;
  const selected=snapshot.reading||snapshot.doc.sliceString(Math.min(snapshot.selection.start,snapshot.selection.end),Math.max(snapshot.selection.start,snapshot.selection.end));
  const edit=snapshot.entry.mode!=='preview';
  const short=selected.length>14?selected.slice(0,14)+'…':selected;
  const row=workbenchRow;
  const content=(edit?workbenchFormatRow('撤销','undo',undefined,'⌘ Z')+workbenchFormatRow('重做','redo',undefined,'⇧ ⌘ Z')+WB_DIVIDER:'')+(selected?row(`查找“${short}”`,'data-wb-action="find-selection"'):'')+
    (edit?workbenchBranch('文本格式','text')+workbenchBranch('段落设置','paragraph')+workbenchBranch('插入','insert'):row('进入编辑模式','data-wb-mode="edit"'))+WB_DIVIDER+
    (edit?row('剪切','data-wb-action="cut"','⌘ X'):'')+row('复制','data-wb-action="copy"','⌘ C')+
    (edit?row('粘贴','data-wb-action="paste"','⌘ V')+row('以纯文本形式粘贴','data-wb-action="paste-text"','⇧ ⌘ V'):'')+row('全选','data-wb-action="select-all"','⌘ A');
  const menu=shellMountSurface(`<div class="surface-popover wb-menu wb-context-menu" role="menu" aria-label="正文右键菜单" data-wb-depth="0"><div class="wb-menu-list">${content}</div></div>`,trigger,224);
  Workbench.context=snapshot;
  if(point){menu.style.left=`${Math.max(8,Math.min(point.x,innerWidth-menu.offsetWidth-8))}px`;menu.style.top=`${Math.max(8,Math.min(point.y,innerHeight-menu.offsetHeight-8))}px`;}
  menu.tabIndex=-1;menu.focus({preventScroll:true});
}
function workbenchSetFocus(value=!Workbench.focus) {
  Workbench.focus=value;document.body.classList.toggle('wb-focus',value);
  const button=document.querySelector('[data-wb-action="focus"]');if(button){button.setAttribute('aria-pressed',String(value));button.setAttribute('aria-label',`${value?'退出':'进入'}专注模式`);button.innerHTML=shellIcon(value?'restoreRecord':'expandRecord');}
}
function workbenchLinkDialog(internal=false) {
  const context=Workbench.context||workbenchSnapshot();workbenchClose(false);Workbench.context=context;
  shellKnowledgeDialog(internal?'插入内部链接':'插入链接',`<label class="wb-link-label">${internal?'笔记名称或稳定链接目标':'链接地址'}<input id="wb-link" autocomplete="off" placeholder="${internal?'笔记名称':'https://'}"></label><p class="error" id="wb-link-error" role="alert"></p>`,'<button class="button" data-action="close-dialog">取消</button><button class="button primary" id="wb-link-insert">插入</button>',360);
  const input=document.querySelector('#wb-link');input.focus();
  const insert=()=>{const value=input.value.trim();if(!value||(!internal&&!LoopKnowledgeEditor.safeURL(value))){document.querySelector('#wb-link-error').textContent='请输入有效的链接目标';return;}
    const entry=workbenchRestore(context);if(!entry)return;workbenchClose(false);if(internal)entry.insertText(`[[${value.replace(/[\[\]\r\n]/g,'')}]]`);else entry.format('link',value);
  };
  document.querySelector('#wb-link-insert').onclick=insert;input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();insert();}};
}
function workbenchClearFormat(entry) {
  const range=entry.view.state.selection.main,doc=entry.view.state.doc,text=doc.sliceString(range.from,range.to);
  let insert=text;for(let i=0;i<8;i++){const next=insert.replace(/^(\*\*|\*|~~|==|`)([\s\S]*)\1$/,'$2');if(next===insert)break;insert=next;}
  if(insert!==text){entry.view.dispatch({changes:{from:range.from,to:range.to,insert},selection:{anchor:range.from,head:range.from+insert.length},userEvent:'input.format'});return;}
  for(const [action,token] of [['bold','**'],['italic','*'],['strike','~~'],['highlight','=='],['inline','`']])if(range.from>=token.length&&doc.sliceString(range.from-token.length,range.from)===token&&doc.sliceString(range.to,range.to+token.length)===token){entry.format(action);return;}
}
document.addEventListener('pointerover',event=>{
  if(!document.querySelector('.wb-context-menu'))return;const button=event.target.closest('[role=menuitem]');if(!button?.closest('.wb-menu'))return;
  if(button.dataset.wbSub)workbenchSubmenu(button);else workbenchClearChildren(Number(button.closest('[data-wb-depth]').dataset.wbDepth)+1);
});
document.addEventListener('contextmenu',event=>{
  const host=event.target.closest('.knowledge-pane .kn-editor-host');
  if(!host||event.target.closest('input,textarea,select,a,img')||event.isComposing)return;
  const entry=knowledgeCurrentEntry();if(!entry||entry.view.composing)return;
  const widget=event.target.closest('.kn-table-widget'),cell=event.target.closest('td,th');
  if(widget&&cell&&entry.mode!=='preview'){
    event.preventDefault();event.stopPropagation();const row=cell.parentElement.rowIndex,column=cell.cellIndex,range=entry.tableCellRange(widget,row,column);if(!range)return;
    entry.finishTableCell();entry.view.dispatch({selection:{anchor:range.from},scrollIntoView:false});entry.tableColumn=column;
    knowledgeTableMenu({widget,row,column,scope:event.shiftKey?'row':'table',trigger:cell,point:{x:event.clientX,y:event.clientY}});return;
  }
  event.preventDefault();event.stopPropagation();
  if(entry.mode!=='preview'){
    const pos=entry.view.posAtCoords({x:event.clientX,y:event.clientY}),range=entry.view.state.selection.main;
    if(pos!==null&&(range.empty||pos<range.from||pos>range.to))entry.view.dispatch({selection:{anchor:pos},scrollIntoView:false});
  }
  workbenchFormatMenu(host,{x:event.clientX,y:event.clientY});
},true);
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  const action=button.dataset.wbAction,sub=button.dataset.wbSub,format=button.dataset.wbFormat,mode=button.dataset.wbMode;
  if(!action&&!sub&&!format&&!mode){
    if(button.closest('.wb-more-menu,.wb-menu')&&(button.dataset.knAction||button.dataset.action||button.dataset.recovery26)){
      if(button.dataset.knAction==='upload'||button.dataset.knAction==='table-tools')if(!workbenchRestore())return;
      workbenchClose(false);
    }
    return;
  }
  event.preventDefault();event.stopImmediatePropagation();
  if(sub){workbenchSubmenu(button,true);return;}
  if(format){const entry=workbenchRestore();if(!entry)return;workbenchClose(false);entry.format(format,button.dataset.wbValue);return;}
  if(mode){workbenchClose(false);knowledgeSetMode(mode);return;}
  if(action==='details'){const task=shellActiveTask();if(Workbench.details.has(task.id))Workbench.details.delete(task.id);else Workbench.details.add(task.id);render();return;}
  if(action==='focus'){workbenchSetFocus();return;}
  if(action==='more'){shellKnowledgeFileMenu(button);return;}
  if(action==='mode'){
    shellMountSurface(`<div class="surface-popover wb-mode-menu" role="menu" aria-label="笔记视图">${[['edit','实时预览（编辑）'],['source','Markdown 源码'],['preview','阅读']].map(([value,label])=>`<button class="button" type="button" role="menuitemradio" data-wb-mode="${value}" aria-checked="${shellKnowledgeMode()===value}">${label}</button>`).join('')}</div>`,button,192);return;
  }
  if(action==='format'){const entry=knowledgeCurrentEntry();shellCloseOverlay({restoreFocus:false});workbenchFormatMenu(entry.root);return;}
  if(action==='properties'){shellCloseOverlay({restoreFocus:false});knowledgeSetMode('source');requestAnimationFrame(()=>knowledgeCurrentEntry()?.locate(0));return;}
  if(action==='link'||action==='wiki'){workbenchLinkDialog(action==='wiki');return;}
  const context=Workbench.context,entry=workbenchRestore();if(!entry)return;
  if(action==='find-selection'){const query=context.reading||entry.view.state.sliceDoc(entry.view.state.selection.main.from,entry.view.state.selection.main.to);workbenchClose(false);entry.openSearch();if(query){entry.find.input.value=query;entry.find.apply();}return;}
  if(action==='select-all'){workbenchClose(false);if(entry.mode==='preview'){const range=document.createRange();range.selectNodeContents(entry.readHost);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}else{entry.view.dispatch({selection:{anchor:0,head:entry.view.state.doc.length}});entry.view.focus();}return;}
  if(action==='clear-format'){workbenchClose(false);workbenchClearFormat(entry);entry.view.focus();return;}
  if(action==='math'||action==='diagram'){workbenchClose(false);entry.insertText(action==='math'?'\n\n$$\nx^2 + y^2 = z^2\n$$\n\n':'\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n');return;}
  const text=context.reading||entry.view.state.sliceDoc(entry.view.state.selection.main.from,entry.view.state.selection.main.to);
  if(action==='copy'||action==='cut'){
    navigator.clipboard.writeText(text).then(()=>{if(action==='cut'){const current=workbenchRestore(context);if(current)current.insertText('');}workbenchClose();}).catch(()=>{workbenchClose();shellToast('请使用系统复制或剪切快捷键');});return;
  }
  if(action==='paste'||action==='paste-text'){
    // Reuse the production image staging/upload transaction. Plain text paste
    // deliberately skips images, without depending on deprecated execCommand.
    (async()=>{
      const image=action==='paste'?await window.personalTaskTrack?.clipboard?.readImageDataUrl?.():'';
      if(image){const [header,payload]=image.split(','),type=/^data:([^;]+)/.exec(header)?.[1]||'image/png',bytes=Uint8Array.from(atob(payload),char=>char.charCodeAt(0));const current=workbenchRestore(context);if(current){workbenchClose(false);void current.upload(new File([bytes],'粘贴图片.png',{type}));}return;}
      const value=await navigator.clipboard.readText(),current=workbenchRestore(context);if(current){workbenchClose(false);current.insertText(value);}
    })().catch(()=>{workbenchClose();shellToast('请使用 Ctrl/Cmd+V 或 Ctrl/Cmd+Shift+V 粘贴');});
  }
},true);
window.addEventListener('keydown',event=>{
  if(event.isComposing||event.keyCode===229)return;
  const root=Workbench.context?document.querySelector('.wb-context-menu'):null;
  if(root){
    const active=document.activeElement,panel=active.closest('.wb-submenu')||root;
    if(event.key==='ArrowRight'&&active.dataset.wbSub){event.preventDefault();event.stopImmediatePropagation();workbenchSubmenu(active,true);return;}
    if(['Escape','ArrowLeft'].includes(event.key)){
      event.preventDefault();event.stopImmediatePropagation();
      if(panel!==root){const depth=Number(panel.dataset.wbDepth),parent=Workbench.parents.get(depth);workbenchClearChildren(depth);parent?.focus();}else workbenchClose();return;
    }
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();event.stopImmediatePropagation();const items=[...panel.querySelectorAll('button:not(:disabled)')],i=items.indexOf(active);
      items[event.key==='Home'?0:event.key==='End'?items.length-1:i<0?(event.key==='ArrowDown'?0:items.length-1):(i+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();return;
    }
  }
  if((event.shiftKey&&event.key==='F10'||event.key==='ContextMenu')&&event.target.closest('.knowledge-pane .kn-editor-host')){event.preventDefault();event.stopImmediatePropagation();const entry=knowledgeCurrentEntry(),coords=entry.view.coordsAtPos(entry.view.state.selection.main.head);workbenchFormatMenu(entry.root,coords?{x:coords.left,y:coords.bottom}:null);return;}
  if(event.key==='Escape'&&Workbench.focus&&!shellOverlayIsOpen()&&!knowledgeCurrentEntry()?.find?.active){event.preventDefault();workbenchSetFocus(false);}
},true);
window.addEventListener('resize',()=>{if(Workbench.context&&document.querySelector('.wb-context-menu'))workbenchClose(false);});

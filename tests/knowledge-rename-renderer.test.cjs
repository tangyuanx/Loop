// Execute the production rename dialog with a minimal DOM adapter. The real
// file service runs against temporary files; no Electron/UI claim is made.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../app/renderer/src/knowledge-core.js');
const documents=require('../app/renderer/src/knowledge-document.js');
const {renameKnowledgeDocument}=require('../app/main/knowledge-rename.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
const source=require('node:fs').readFileSync(path.join(__dirname,'../app/renderer/src/knowledge-workspace.js'),'utf8');
const dialog=source.slice(source.indexOf('function knowledgeRename(task,trigger)'),source.indexOf('function knowledgeFocusTableCell('));

async function fixture(t,bound=true){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'loop-rename-dialog-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,'old.md'),diskText='# 磁盘原文\r\n\n![图片](attachments/img.png)';await fs.writeFile(filePath,diskText);
  const disk=await readKnowledgeDocument(filePath);
  const task={id:'note',title:'旧名称',notes:'尚未写入文件的正文与选区',updatedAt:'before',
    knowledgeNote:{...documents.createKnowledgeNoteMetadata({noteId:'stable',taskId:'note',title:'旧名称'}),
      ...(bound?disk:{}),title:'旧名称',documentState:bound?'DIRTY':'DRAFT',dirty:true}};
  const attrs=new Map(),surface={isConnected:true,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
  const field={value:'新名称',readOnly:false,focus(){},select(){},closest:()=>surface,
    setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
  const error={textContent:''},button={disabled:false};let calls=0,closed=0,flushes=0,flush=async()=>true;
  const queue=new core.SerialQueue();
  const context=vm.createContext({console,CSS:{escape:s=>s},LoopKnowledgeCore:core,knowledgeDocument:documents,
    state:{tasks:[]},knowledgeSaveQueue:queue,knowledgeFileWriteBusy:new Set(),knowledgeDeferredFileEvents:new Map(),
    document:{querySelector:s=>s==='#kn-rename-title'?field:s==='#kn-rename-commit'?button:s==='#kn-rename-error'?error:null},
    shellKnowledgeDialog(){},escAttr:s=>s,knowledgeHasDocument:()=>true,knowledgeActiveDocument:()=>task,
    knowledgeCurrentEntry:()=>({refresh(){}}),shellCloseOverlay(){closed++;surface.isConnected=false;},render(){},
    captureMountedMilkdownDrafts(){},flushNodeNoteDraft(){},noteDraftKey:(a,b)=>a+':'+b,
    flushKnowledgeRecovery:async()=>{},save(){},flushSave:async()=>{flushes++;return flush(flushes);},
    desktopKnowledgeFile:{rename:async payload=>{calls++;return renameKnowledgeDocument(payload);}},
    syncKnowledgeFileWatcher:async()=>{},scheduleKnowledgeRecovery(){},knowledgeUpdateChrome(){},now:()=>new Date().toISOString(),
  });
  vm.runInContext(dialog,context);context.knowledgeRename(task);
  const commit=async name=>{field.value=name;button.onclick();await new Promise(resolve=>setImmediate(resolve));
    const end=Date.now()+3000;while(button.disabled&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(button.disabled,false,'commit completed');};
  return {task,context,field,error,button,dir,filePath,diskText,commit,queue,
    setFlush(fn){flush=fn;},counts:()=>({calls,closed,flushes})};
}

test('invalid names leave title, file path and unsaved text untouched without IPC',async t=>{
  const h=await fixture(t);await h.commit('CON');
  assert.match(h.error.textContent,/保留名称/);assert.equal(h.counts().calls,0);
  assert.equal(h.task.knowledgeNote.title,'旧名称');assert.equal(h.task.knowledgeNote.filePath,h.filePath);
  assert.equal(await fs.readFile(h.filePath,'utf8'),h.diskText);
});

test('successful disk rename keeps dirty content, stable identity, aliases and new save path',async t=>{
  const h=await fixture(t),notes=h.task.notes;await h.commit('新名称');
  assert.equal(h.error.textContent,'');assert.equal(h.counts().closed,1);
  assert.equal(h.task.knowledgeNote.filePath,path.join(h.dir,'新名称.md'));
  assert.equal(h.task.knowledgeNote.noteId,'stable');assert.equal(h.task.knowledgeNote.dirty,true);
  assert.equal(h.task.knowledgeNote.documentState,'DIRTY');assert.equal(h.task.notes,notes);
  assert.ok(h.task.knowledgeNote.aliases.includes('旧名称'));
  await assert.rejects(fs.access(h.filePath));assert.equal(await fs.readFile(h.task.knowledgeNote.filePath,'utf8'),h.diskText);
});

test('disk collision retains the actual old name and allows correcting the input',async t=>{
  const h=await fixture(t);await fs.writeFile(path.join(h.dir,'已存在.md'),'他人的内容');
  await h.commit('已存在');assert.match(h.error.textContent,/已存在/);
  assert.equal(h.task.knowledgeNote.title,'旧名称');assert.equal(h.task.knowledgeNote.filePath,h.filePath);
  assert.equal(h.counts().closed,0);await h.commit('更正名称');assert.equal(h.counts().closed,1);
  assert.equal(await fs.readFile(path.join(h.dir,'已存在.md'),'utf8'),'他人的内容');
});

test('metadata failure after disk rename retains the real path and a retry never recreates the old file',async t=>{
  const h=await fixture(t);h.setFlush(async n=>n!==2);await h.commit('新名称');
  assert.match(h.error.textContent,/文件已改名.*路径信息尚未保存/);
  assert.equal(h.counts().closed,0);assert.equal(h.task.knowledgeNote.filePath,path.join(h.dir,'新名称.md'));
  await assert.rejects(fs.access(h.filePath));h.setFlush(async()=>true);await h.commit('新名称');
  assert.equal(h.counts().closed,1);assert.ok(h.task.knowledgeNote.lastSavedHash);await assert.rejects(fs.access(h.filePath));
});

test('unbound title failure reverts only the current rename and keeps the input available',async t=>{
  const h=await fixture(t,false);h.setFlush(async()=>false);await h.commit('草稿新名称');
  assert.match(h.error.textContent,/重命名未能保存/);assert.equal(h.task.knowledgeNote.title,'旧名称');
  assert.equal(h.task.title,'旧名称');assert.equal(h.task.updatedAt,'before');assert.equal(h.field.value,'草稿新名称');
  assert.equal(h.counts().calls,0);
});

test('rename waits for pending note saves and a later save sees only the new path',async t=>{
  const h=await fixture(t);let release;const pending=h.queue.run('note',()=>new Promise(resolve=>{release=resolve;}));
  await new Promise(resolve=>setImmediate(resolve));h.field.value='队列新名称';h.button.onclick();
  let laterPath;const later=h.queue.run('note',()=>{laterPath=h.task.knowledgeNote.filePath;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(h.counts().calls,0);
  release();await pending;await later;
  assert.equal(laterPath,path.join(h.dir,'队列新名称.md'));assert.equal(h.counts().closed,1);
});

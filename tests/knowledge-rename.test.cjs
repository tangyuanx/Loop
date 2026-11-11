const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {validateNoteFileName}=require('../app/renderer/src/knowledge-core.js');
const {renameKnowledgeDocument}=require('../app/main/knowledge-rename.cjs');
const {readKnowledgeDocument,saveKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
async function fixture(t,name='原始笔记.md'){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'loop-rename-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,name),content='---\r\ntitle: 原文\r\n---\r\n\n# 中文 😀\n\n![图片](./attachments/图.png)\n';
  await fs.mkdir(path.join(dir,'attachments'));await fs.writeFile(path.join(dir,'attachments/图.png'),Buffer.from('image fixture'));
  await fs.writeFile(filePath,content);const baseline=await readKnowledgeDocument(filePath);
  return {dir,filePath,content,payload:{filePath,name:'新名称',expectedLastSavedHash:baseline.lastSavedHash}};
}

test('cross-platform validation rejects illegal names before any disk operation',async()=>{
  const bad=['','  ','a/b','a\\b','a:b','a*b','a?b','a"b','a<b','a>b','a|b','a\0b','a\nb',
    '.','..','.md','foo.','foo ',' foo','CON','con.md','PRN.other','AUX','NUL','COM1','LPT9','COM¹','LPT²',
    '中'.repeat(85),'😀'.repeat(64),'x'.repeat(253),'a\ud800'];
  for(const name of bad){
    assert.equal(validateNoteFileName(name).success,false,JSON.stringify(name));
    const result=await renameKnowledgeDocument({filePath:'/never-read.md',name,expectedLastSavedHash:'x'},
      {fsOps:{lstat:()=>{throw Error('Invalid names must not reach disk');}}});
    assert.equal(result.code,'INVALID_FILE_NAME',JSON.stringify(name));
  }
  for(const [name,fileName,title] of [['中文 笔记😀','中文 笔记😀.md','中文 笔记😀'],['Foo.MD','Foo.MD','Foo'],['v1.2','v1.2.md','v1.2'],['CONSOLE','CONSOLE.md','CONSOLE']]){
    assert.deepEqual(validateNoteFileName(name),{success:true,fileName,title});
  }
});

test('rename keeps Markdown bytes and relative assets intact, with a reusable saved hash',async t=>{
  const f=await fixture(t),asset=await fs.readFile(path.join(f.dir,'attachments/图.png'));
  const result=await renameKnowledgeDocument(f.payload);assert.equal(result.success,true,JSON.stringify(result));
  assert.equal(result.filePath,path.join(f.dir,'新名称.md'));
  await assert.rejects(fs.access(f.filePath));assert.equal(await fs.readFile(result.filePath,'utf8'),f.content);
  assert.deepEqual(await fs.readFile(path.join(f.dir,'attachments/图.png')),asset);
  assert.equal((await saveKnowledgeDocument({filePath:result.filePath,expectedLastSavedHash:result.lastSavedHash,content:f.content+'后续修改'})).success,true);
});

test('identical name is a no-op retaining hash and mtime for future saves',async t=>{
  const f=await fixture(t);const result=await renameKnowledgeDocument({...f.payload,name:'原始笔记.md'});
  assert.equal(result.success,true);assert.equal(result.unchanged,true);
  assert.equal(result.lastSavedHash,f.payload.expectedLastSavedHash);assert.ok(result.lastSavedMtime>0);
});

test('existing files and a destination created concurrently are never overwritten',async t=>{
  const f=await fixture(t),target=path.join(f.dir,'新名称.md');await fs.writeFile(target,'别人的文件');
  assert.equal((await renameKnowledgeDocument(f.payload)).code,'FILE_ALREADY_EXISTS');
  await fs.unlink(target);
  const raced=await renameKnowledgeDocument(f.payload,{fsOps:{link:async(source,destination)=>{
    await fs.writeFile(destination,'同时创建的文件');return fs.link(source,destination);
  }}});
  assert.equal(raced.code,'FILE_ALREADY_EXISTS');assert.equal(await fs.readFile(target,'utf8'),'同时创建的文件');
  assert.equal(await fs.readFile(f.filePath,'utf8'),f.content);
});

test('exFAT-style link unavailability uses exclusive copying without changing the source bytes',async t=>{
  const f=await fixture(t);const result=await renameKnowledgeDocument(f.payload,{fsOps:{link:async()=>{throw Object.assign(Error('No hard links'),{code:'ENOTSUP'});}}});
  assert.equal(result.success,true,JSON.stringify(result));assert.equal(await fs.readFile(result.filePath,'utf8'),f.content);
  await assert.rejects(fs.access(f.filePath));
});

test('source unlink failure retains original and removes only our unmodified new file',async t=>{
  const f=await fixture(t);const result=await renameKnowledgeDocument(f.payload,{fsOps:{unlink:async file=>{
    if(file===f.filePath)throw Object.assign(Error('File is busy'),{code:'EPERM'});return fs.unlink(file);
  }}});
  assert.equal(result.success,false);assert.equal(await fs.readFile(f.filePath,'utf8'),f.content);
  await assert.rejects(fs.access(path.join(f.dir,'新名称.md')));
});

test('external source changes and a changed copied target are preserved',async t=>{
  const f=await fixture(t);await fs.writeFile(f.filePath,'外部修改');
  assert.equal((await renameKnowledgeDocument(f.payload)).code,'EXTERNAL_CHANGE_REQUIRES_CONFIRMATION');
  assert.equal(await fs.readFile(f.filePath,'utf8'),'外部修改');
  await fs.writeFile(f.filePath,f.content);
  const result=await renameKnowledgeDocument(f.payload,{fsOps:{link:async()=>{throw Object.assign(Error(),{code:'ENOTSUP'});},
    copyFile:async(a,b,flags)=>{await fs.copyFile(a,b,flags);await fs.writeFile(b,'外部修改了目标');}}});
  assert.equal(result.success,false);assert.equal(result.retainedPath,path.join(f.dir,'新名称.md'));
  assert.equal(await fs.readFile(f.filePath,'utf8'),f.content);assert.equal(await fs.readFile(result.retainedPath,'utf8'),'外部修改了目标');
});

test('missing files, symlinks and missing baselines cannot be renamed',async t=>{
  const f=await fixture(t);
  assert.equal((await renameKnowledgeDocument({...f.payload,expectedLastSavedHash:null})).code,'MISSING_BASELINE');
  const link=path.join(f.dir,'链接.md');await fs.symlink(f.filePath,link);
  assert.equal((await renameKnowledgeDocument({...f.payload,filePath:link})).code,'UNSUPPORTED_FILE_TYPE');
  await fs.unlink(f.filePath);assert.equal((await renameKnowledgeDocument(f.payload)).code,'ENOENT');
});

test('competing renames and a stale queued save cannot recreate or overwrite renamed files',async t=>{
  const f=await fixture(t);
  const [a,b,save]=await Promise.all([
    renameKnowledgeDocument(f.payload),renameKnowledgeDocument({...f.payload,name:'另一个名称'}),
    saveKnowledgeDocument({filePath:f.filePath,expectedLastSavedHash:f.payload.expectedLastSavedHash,content:'过期保存'}),
  ]);
  assert.equal(a.success,true,JSON.stringify(a));assert.equal(b.success,false);assert.equal(save.success,false);
  assert.equal(await fs.readFile(a.filePath,'utf8'),f.content);await assert.rejects(fs.access(f.filePath));
});

test('case-only rename succeeds on the current filesystem with no temporary artifacts',async t=>{
  const f=await fixture(t,'Name.md');const result=await renameKnowledgeDocument({...f.payload,name:'name.md'});
  assert.equal(result.success,true,JSON.stringify(result));assert.ok((await fs.readdir(f.dir)).includes('name.md'));
  assert.ok(!(await fs.readdir(f.dir)).includes('Name.md'));assert.ok(!(await fs.readdir(f.dir)).some(n=>n.startsWith('.loop-rename-')));
  assert.equal(await fs.readFile(result.filePath,'utf8'),f.content);
});

test('case-only destination failure restores the original spelling and bytes',async t=>{
  const f=await fixture(t,'Name.md'),target=path.join(f.dir,'name.md');
  // The host may be case-sensitive; force the directory lookup used by the
  // case-insensitive branch while all actual file operations remain real.
  const original=await fs.lstat(f.filePath);
  const result=await renameKnowledgeDocument({...f.payload,name:'name.md'},{fsOps:{
    lstat:async file=>file===target?original:fs.lstat(file),
    link:async(a,b)=>{if(b===target)throw Object.assign(Error('目标不可写'),{code:'EACCES'});return fs.link(a,b);},
  }});
  assert.equal(result.success,false);assert.equal(await fs.readFile(f.filePath,'utf8'),f.content);
  assert.ok((await fs.readdir(f.dir)).includes('Name.md'));assert.ok(!(await fs.readdir(f.dir)).some(n=>n.startsWith('.loop-rename-')));
});

test('a distinct pre-existing hard link remains a destination conflict',async t=>{
  const f=await fixture(t);const target=path.join(f.dir,'新名称.md');await fs.link(f.filePath,target);
  assert.equal((await renameKnowledgeDocument(f.payload)).code,'FILE_ALREADY_EXISTS');
  assert.equal(await fs.readFile(f.filePath,'utf8'),f.content);assert.equal(await fs.readFile(target,'utf8'),f.content);
});

test('rename IPC keeps path authorization and rebinds the watcher to the actual destination',async t=>{
  const vm=require('node:vm'),raw=await fs.readFile(path.join(__dirname,'../app/main/main.cjs'),'utf8');
  const start=raw.indexOf('  ipcMain.handle("knowledge-document:rename"'),end=raw.indexOf('  ipcMain.handle("knowledge-document:read"',start);
  const handlers=new Map(),watched=[],unwatched=[],approved=[];let operations=0;
  const context=vm.createContext({ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},
    knowledgeGate:{isAllowed:async p=>p===context.allowedPath,approve:p=>approved.push(p)},
    knowledgeWatcher:{unwatch:id=>unwatched.push(id),watch:async value=>watched.push(value)},
    renameKnowledgeDocument:async payload=>{operations++;return renameKnowledgeDocument(payload);},
    deniedPathResult:require('../app/main/knowledge-access.cjs').deniedPathResult});
  vm.runInContext(raw.slice(start,end),context);const handler=handlers.get('knowledge-document:rename');
  assert.equal((await handler({}, {filePath:'/private.md',noteId:'n',name:'x'})).code,'PATH_NOT_ALLOWED');
  assert.equal(operations,0);assert.equal(unwatched.length,0);
  const f=await fixture(t);context.allowedPath=f.filePath;
  const result=await handler({}, {...f.payload,noteId:'n'});assert.equal(result.success,true);
  assert.equal(unwatched[0],'n');assert.equal(approved[0],result.filePath);assert.equal(watched[0].filePath,result.filePath);
  assert.equal(watched[0].lastSavedHash,f.payload.expectedLastSavedHash);
});

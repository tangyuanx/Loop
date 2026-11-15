const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {saveKnowledgeDocument,readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
const {DATA_VERSION, dataFilePath, readTaskData, verifyTaskWorkspace, writeTaskData}=require('../app/main/storage.cjs');
const {stageKnowledgeAssets}=require('../app/main/knowledge-assets.cjs');
const {IMAGE_ASSETS_DIR}=require('../app/main/image-store.cjs');
const {readKnowledgeRecovery,recoveryFilePath,writeKnowledgeRecovery}=require('../app/main/recovery.cjs');
const {createKnowledgePathGate}=require('../app/main/knowledge-access.cjs');
const {SerialQueue}=require('../app/renderer/src/knowledge-core.js');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'loop-knowledge-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('disk reads and saves preserve mixed separators and reject external line-ending-only changes',async t=>{
 const dir=await fixture(t),filePath=path.join(dir,'换行.md'),content='# 中文😀\r\n\r\n正文\n下一行\r末行';
 const saved=await saveKnowledgeDocument({filePath,content});assert.equal(saved.success,true);
 assert.equal(await fs.readFile(filePath,'utf8'),content);
 const baseline=await readKnowledgeDocument(filePath);assert.equal(baseline.content,content);
 assert.equal(baseline.lastSavedHash,saved.lastSavedHash);
 const changed=content.replace(/\r\n?/g,'\n');await fs.writeFile(filePath,changed);
 const rejected=await saveKnowledgeDocument({filePath,content:content+'本地修改',expectedLastSavedHash:baseline.lastSavedHash});
 assert.equal(rejected.code,'EXTERNAL_CHANGE_REQUIRES_CONFIRMATION');assert.equal(await fs.readFile(filePath,'utf8'),changed);
});
test('two competing file writers cannot silently overwrite the newer revision',async t=>{
 const dir=await fixture(t),filePath=path.join(dir,'中文😀.md');await fs.writeFile(filePath,'原始\n\n\n');
 const baseline=await readKnowledgeDocument(filePath);
 const results=await Promise.all(['新版本 A 😀','过期版本 B'].map(content=>saveKnowledgeDocument({filePath,content,expectedLastSavedHash:baseline.lastSavedHash})));
 assert.equal(results.filter(r=>r.success).length,1);
 assert.equal(results.find(r=>!r.success).code,'EXTERNAL_CHANGE_REQUIRES_CONFIRMATION');
 assert.equal(await fs.readFile(filePath,'utf8'),'新版本 A 😀');
});
test('serialized renderer operations obtain a fresh hash for each successive revision',async t=>{
 const dir=await fixture(t),filePath=path.join(dir,'连续保存.md');await fs.writeFile(filePath,'0');
 let revision=(await readKnowledgeDocument(filePath)).lastSavedHash;const queue=new SerialQueue();
 const receipts=await Promise.all(['1','2','3','4'].map(content=>queue.run('note',async()=>{
  const result=await saveKnowledgeDocument({filePath,content,expectedLastSavedHash:revision});if(result.success)revision=result.lastSavedHash;return result;
 })));
 assert.ok(receipts.every(r=>r.success));assert.equal(await fs.readFile(filePath,'utf8'),'4');
});
test('save failure leaves the old file and permits a successful retry with exact original Markdown',async t=>{
 const dir=await fixture(t),filePath=path.join(dir,'正文.md');await fs.writeFile(filePath,'安全旧内容');
 const baseline=await readKnowledgeDocument(filePath),content='---\nquoted: \'原文\'\n---\n# 中文 😀\n\n\n末行\n';
 const failed=await saveKnowledgeDocument({filePath,content,expectedLastSavedHash:baseline.lastSavedHash},{fsOps:{open:async()=>{throw Object.assign(new Error('disk full'),{code:'ENOSPC'});}}});
 assert.equal(failed.success,false);assert.equal(await fs.readFile(filePath,'utf8'),'安全旧内容');
 assert.equal((await saveKnowledgeDocument({filePath,content,expectedLastSavedHash:baseline.lastSavedHash})).success,true);
 assert.equal(await fs.readFile(filePath,'utf8'),content);
});
test('a missing or unreadable note never becomes an empty write; path gate stays authoritative',async t=>{
 const dir=await fixture(t),filePath=path.join(dir,'不存在.md');
 const result=await saveKnowledgeDocument({filePath,content:'',expectedLastSavedHash:'old'});
 assert.equal(result.success,false);await assert.rejects(fs.access(filePath));
 const gate=createKnowledgePathGate({userDataPath:dir,dataFilePath:path.join(dir,'task-data.json')});
 assert.equal(await gate.isAllowed('/etc/passwd'),false);
 await writeTaskData(dir,{version:2,tasks:[{id:'a',title:'A',notes:'中文\n\n😀',knowledgeNote:{noteId:'stable-a',filePath},nodes:[]}]});
 assert.equal(await gate.isAllowed(filePath),true);
 const restored=await readTaskData(dir);assert.equal(restored.tasks[0].notes,'中文\n\n😀');assert.equal(restored.tasks[0].knowledgeNote.noteId,'stable-a');
});
test('relative images stay inside the selected note directory, including symlink targets',async t=>{
 const dir=await fixture(t),notes=path.join(dir,'notes');await fs.mkdir(path.join(notes,'images'),{recursive:true});
 await fs.writeFile(path.join(notes,'images','test.png'),Buffer.from('safe image'));
 await fs.writeFile(path.join(dir,'private.png'),Buffer.from('private image'));
 await fs.symlink(path.join(dir,'private.png'),path.join(notes,'images','escape.png'));
 const filePath=path.join(notes,'正文.md');await fs.writeFile(filePath,'![普通](images/test.png)\n![泄露](images/escape.png)\n![上级](../private.png)');
 const result=await readKnowledgeDocument(filePath);assert.equal(result.success,true);
 assert.deepEqual(result.assetFiles.map(a=>a.relativePath),['images/test.png']);
 assert.equal(Buffer.from(result.assetFiles[0].dataUrl.split(',')[1],'base64').toString(),'safe image');
});
test('attachment migration changes image destinations while preserving code samples and ordinary text',async t=>{
 const dir=await fixture(t),filePath=path.join(dir,'附件.md'),source='task-image:sample';
 const content='![真实]('+source+')\n\n`![源码]('+source+')`\n\n```md\n![代码]('+source+')\n```\n\n%% ![注释]('+source+') %%\n\n普通文字 '+source;
 const result=await saveKnowledgeDocument({filePath,content,assets:[{source,dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII='}]});
 assert.equal(result.success,true);assert.match(result.content,/!\[真实\]\(\.\/attachments\//);
 assert.match(result.content,/`!\[源码\]\(task-image:sample\)`/);assert.match(result.content,/!\[代码\]\(task-image:sample\)/);assert.match(result.content,/!\[注释\]\(task-image:sample\)/);assert.ok(result.content.endsWith('普通文字 '+source));
});

async function saveAsFixture(t, content = '![图片](images/shared.png)') {
 const directory = await fixture(t);
 const sourceDirectory = path.join(directory, 'source');
 const targetDirectory = path.join(directory, 'target');
 for (const root of [sourceDirectory, targetDirectory]) await fs.mkdir(path.join(root, 'images'), {recursive:true});
 const sourceFilePath = path.join(sourceDirectory, 'note.md');
 const filePath = path.join(targetDirectory, 'copy.md');
 await fs.writeFile(sourceFilePath, content);
 return {
  directory, sourceDirectory, targetDirectory, sourceFilePath, filePath, content,
  payload: {filePath:sourceFilePath, sourceFilePath, content, saveAs:true},
  dialog: {showSaveDialog:async()=>({canceled:false,filePath})},
 };
}

test('Save As rejects different same-name attachments without overwriting either document',async t=>{
 const context = await saveAsFixture(t);
 await fs.writeFile(path.join(context.sourceDirectory,'images/shared.png'),'SOURCE');
 await fs.writeFile(path.join(context.targetDirectory,'images/shared.png'),'EXISTING');
 await fs.writeFile(context.filePath,'EXISTING MARKDOWN');
 const result = await saveKnowledgeDocument(context.payload,{dialog:context.dialog});
 assert.equal(result.code,'ASSET_MIGRATION_FAILED');
 assert.equal(result.errorCode,'ASSET_ALREADY_EXISTS');
 assert.equal(await fs.readFile(path.join(context.targetDirectory,'images/shared.png'),'utf8'),'EXISTING');
 assert.equal(await fs.readFile(context.filePath,'utf8'),'EXISTING MARKDOWN');
 assert.equal(await fs.readFile(context.sourceFilePath,'utf8'),context.content);
});

test('Save As reuses identical assets and rolls back only new files before a successful retry',async t=>{
 const context = await saveAsFixture(t,'![已有](images/shared.png)\n![新建](images/new.png)');
 for (const root of [context.sourceDirectory,context.targetDirectory]) await fs.writeFile(path.join(root,'images/shared.png'),'SHARED');
 await fs.writeFile(path.join(context.sourceDirectory,'images/new.png'),'NEW');
 await fs.writeFile(context.filePath,'OLD MARKDOWN');
 const failed = await saveKnowledgeDocument(context.payload,{
  dialog:context.dialog,
  fsOps:{rename:async()=>{throw Object.assign(new Error('disk failure'),{code:'EIO'});}},
 });
 assert.equal(failed.errorCode,'EIO');
 assert.equal(await fs.readFile(context.filePath,'utf8'),'OLD MARKDOWN');
 assert.equal(await fs.readFile(path.join(context.targetDirectory,'images/shared.png'),'utf8'),'SHARED');
 await assert.rejects(fs.access(path.join(context.targetDirectory,'images/new.png')));
 assert.equal((await saveKnowledgeDocument(context.payload,{dialog:context.dialog})).success,true);
 assert.equal(await fs.readFile(context.filePath,'utf8'),context.content);
 assert.equal(await fs.readFile(path.join(context.targetDirectory,'images/new.png'),'utf8'),'NEW');
});

test('Save As rolls back a partially written copy and assets copied before a later collision',async t=>{
 const context = await saveAsFixture(t,'![第一张](images/new.png)\n![第二张](images/shared.png)');
 await fs.writeFile(path.join(context.sourceDirectory,'images/new.png'),'NEW');
 await fs.writeFile(path.join(context.sourceDirectory,'images/shared.png'),'SOURCE');
 await fs.writeFile(path.join(context.targetDirectory,'images/shared.png'),'EXISTING');
 const collision = await saveKnowledgeDocument(context.payload,{dialog:context.dialog});
 assert.equal(collision.errorCode,'ASSET_ALREADY_EXISTS');
 assert.deepEqual(await fs.readdir(path.join(context.targetDirectory,'images')),['shared.png']);
 const failed = await saveKnowledgeDocument(context.payload,{
  dialog:context.dialog,
  fsOps:{open:async(...args)=>{
   const handle = await fs.open(...args);
   return {
    writeFile:async bytes=>{await handle.writeFile(bytes.subarray(0,1));throw Object.assign(new Error('disk full'),{code:'ENOSPC'});},
    sync:handle.sync.bind(handle),close:handle.close.bind(handle),
   };
  }},
 });
 assert.equal(failed.errorCode,'ENOSPC');
 assert.deepEqual(await fs.readdir(path.join(context.targetDirectory,'images')),['shared.png']);
 assert.equal(await fs.readFile(path.join(context.targetDirectory,'images/shared.png'),'utf8'),'EXISTING');
 await assert.rejects(fs.access(context.filePath));
});

test('Save As removes copied relative files when managed asset migration fails',async t=>{
 const context = await saveAsFixture(t);
 await fs.writeFile(path.join(context.sourceDirectory,'images/shared.png'),'SOURCE');
 const result = await saveKnowledgeDocument({...context.payload,assets:[{source:'task-image:missing',sourcePath:path.join(context.directory,'missing.png')}]},{dialog:context.dialog});
 assert.equal(result.code,'ASSET_MIGRATION_FAILED');
 await assert.rejects(fs.access(path.join(context.targetDirectory,'images/shared.png')));
 await assert.rejects(fs.access(context.filePath));
});

test('Save As blocks source and destination symlink escapes before copying or creating directories',async t=>{
 for (const variant of ['source-file','target-file','target-directory']) {
  const context = await saveAsFixture(t,variant==='target-directory'?'![图片](images/nested/shared.png)':'![图片](images/shared.png)');
  const outside = path.join(context.directory,'outside');
  await fs.mkdir(outside);
  const privateFile = path.join(outside,'private.png');
  await fs.writeFile(privateFile,'PRIVATE');
  await fs.mkdir(path.join(context.sourceDirectory,'images/nested'));
  await fs.writeFile(path.join(context.sourceDirectory,'images/shared.png'),'SOURCE');
  await fs.writeFile(path.join(context.sourceDirectory,'images/nested/shared.png'),'SOURCE');
  if (variant==='source-file') {
   await fs.rm(path.join(context.sourceDirectory,'images/shared.png'));
   await fs.symlink(privateFile,path.join(context.sourceDirectory,'images/shared.png'));
  } else if (variant==='target-file') {
   await fs.symlink(privateFile,path.join(context.targetDirectory,'images/shared.png'));
  } else {
   await fs.rm(path.join(context.targetDirectory,'images'),{recursive:true});
   await fs.symlink(outside,path.join(context.targetDirectory,'images'));
  }
  const result = await saveKnowledgeDocument(context.payload,{dialog:context.dialog});
  assert.equal(result.errorCode,'ASSET_PATH_OUTSIDE_NOTE',variant);
  assert.equal(await fs.readFile(privateFile,'utf8'),'PRIVATE');
  assert.deepEqual(await fs.readdir(outside),['private.png']);
  await assert.rejects(fs.access(context.filePath));
 }
});

test('Save As copies encoded and titled image paths while preserving code samples and internal symlinks',async t=>{
 const content='![图片](<images/a b(1).png> "标题")\n![编码](images/%E4%B8%AD%E6%96%87.png)\n![内部链接](images/link.png)\n`![代码](images/code.png)`\n\n```md\n![围栏](images/code.png)\n```';
 const context = await saveAsFixture(t,content);
 await fs.writeFile(path.join(context.sourceDirectory,'images/a b(1).png'),'SPACE');
 await fs.writeFile(path.join(context.sourceDirectory,'images/中文.png'),'CHINESE');
 await fs.writeFile(path.join(context.sourceDirectory,'images/code.png'),'CODE');
 await fs.symlink(path.join(context.sourceDirectory,'images/中文.png'),path.join(context.sourceDirectory,'images/link.png'));
 const result = await saveKnowledgeDocument(context.payload,{dialog:context.dialog});
 assert.equal(result.success,true,result.message);
 assert.equal(await fs.readFile(context.filePath,'utf8'),content);
 assert.deepEqual((await fs.readdir(path.join(context.targetDirectory,'images'))).sort(),['a b(1).png','link.png','中文.png']);
 assert.equal(await fs.readFile(path.join(context.targetDirectory,'images/link.png'),'utf8'),'CHINESE');
});

test('concurrent Save As retries do not reuse an attachment before a failed writer rolls it back',async t=>{
 const context = await saveAsFixture(t);
 await fs.writeFile(path.join(context.sourceDirectory,'images/shared.png'),'SOURCE');
 let release, notify;
 const blocked = new Promise(resolve=>release=resolve);
 const ready = new Promise(resolve=>notify=resolve);
 const first = saveKnowledgeDocument(context.payload,{
  dialog:context.dialog,
  fsOps:{rename:async()=>{notify();await blocked;throw Object.assign(new Error('disk failure'),{code:'EIO'});}},
 });
 await ready;
 const secondPath = path.join(context.targetDirectory,'second.md');
 const second = saveKnowledgeDocument(context.payload,{dialog:{showSaveDialog:async()=>({canceled:false,filePath:secondPath})}});
 release();
 assert.equal((await first).success,false);
 assert.equal((await second).success,true);
 assert.equal(await fs.readFile(path.join(context.targetDirectory,'images/shared.png'),'utf8'),'SOURCE');
 assert.equal(await fs.readFile(secondPath,'utf8'),context.content);
});

test('Save As still saves the text when the previous note directory has disappeared',async t=>{
 const context = await saveAsFixture(t);
 await fs.rm(context.sourceDirectory,{recursive:true});
 const result = await saveKnowledgeDocument(context.payload,{dialog:context.dialog});
 assert.equal(result.success,true,result.message);
 assert.equal(await fs.readFile(context.filePath,'utf8'),context.content);
});

test('Save As IPC rejects an unapproved source before the native picker or file service runs',async()=>{
 const source = await fs.readFile(path.join(__dirname,'../app/main/main.cjs'),'utf8');
 const start = source.indexOf('  ipcMain.handle("knowledge-document:save"');
 const end = source.indexOf('  ipcMain.handle("knowledge-document:stage-assets"',start);
 let handler, saves = 0;
 require('node:vm').runInNewContext(source.slice(start,end),{
  ipcMain:{handle:(_name,fn)=>{handler=fn;}},
  BrowserWindow:{fromWebContents:()=>null},
  knowledgeGate:{isAllowed:async filePath=>filePath==='/approved.md'},
  deniedPathResult:require('../app/main/knowledge-access.cjs').deniedPathResult,
  assetSourcePaths:()=>[],
  dataMaintenance:require('../app/main/data-maintenance.cjs').createDataMaintenanceLock(),
  saveKnowledgeDocument:async()=>{saves++;return {canceled:true};},
  dialog:{},process,
 });
 const rejected = await handler({sender:{}},{saveAs:true,sourceFilePath:'/private.md'});
 assert.equal(rejected.code,'PATH_NOT_ALLOWED');
 assert.equal(rejected.operation,'asset-source');
 assert.equal(saves,0);
 assert.equal((await handler({sender:{}},{saveAs:true,sourceFilePath:'/approved.md'})).canceled,true);
 assert.equal(saves,1);
});

test('legacy inline images migrate to one blob across tasks, drafts, and archived records', async t => {
  const profile = await fixture(t);
  const file = dataFilePath(profile);
  const payload = Buffer.alloc(1024 * 1024, 41);
  const dataUrl = `data:image/png;base64,${payload.toString('base64')}`;
  const body = `原始正文\n\n![图片](${dataUrl})\n`;
  const raw = JSON.stringify({
    version: 2,
    tasks: [{ id: 'task_fixture', notes: body }],
    attachments: { images: { first: dataUrl, second: dataUrl } },
    recentlyDeleted: [{ id: 'archive_fixture', kind: 'note', body }],
  });
  await fs.writeFile(file, raw);
  const legacy = await readTaskData(profile);
  assert.equal(legacy.tasks[0].notes, body);
  assert.equal(await fs.readFile(file, 'utf8'), raw, 'read leaves the legacy bytes intact');

  const assets = [{ source: 'task-image:first', dataUrl }];
  const staged = await stageKnowledgeAssets(profile, { noteId: 'fixture', assets });
  assert.equal(staged.success, true);
  const storage = createKnowledgePathGate({ userDataPath: profile, dataFilePath: file });
  assert.equal(storage.isRecoveryAssetPath(staged.assets[0].filePath), true);
  assert.equal(storage.isRecoveryAssetPath(path.join(profile, IMAGE_ASSETS_DIR, 'unknown.png')), false);
  await writeTaskData(profile, legacy);
  await writeKnowledgeRecovery(profile, { noteId: 'fixture', content: body, assets });

  const blobs = await fs.readdir(path.join(profile, IMAGE_ASSETS_DIR));
  assert.equal(blobs.length, 1);
  assert.deepEqual(await fs.readFile(path.join(profile, IMAGE_ASSETS_DIR, blobs[0])), payload);
  assert.ok((await fs.stat(file)).size < 10_000);
  assert.ok((await fs.stat(recoveryFilePath(profile))).size < 1_000);
  const reopened = await readTaskData(profile);
  assert.equal(reopened.version, DATA_VERSION);
  assert.equal(reopened.tasks[0].notes, body);
  assert.equal(reopened.recentlyDeleted[0].body, body);
  assert.deepEqual(reopened.attachments.images, { first: dataUrl, second: dataUrl });
  const recovery = await readKnowledgeRecovery(profile);
  assert.equal(recovery.records.fixture.content, body);
  assert.deepEqual(recovery.records.fixture.assets, assets);
});

test('missing and altered image blobs leave both the working database and draft untouched', async t => {
  const profile = await fixture(t);
  const dataUrl = 'data:image/png;base64,d29ya3NwYWNlIGltYWdl';
  const snapshot = { tasks: [], attachments: { images: { fixture: dataUrl } } };
  await writeTaskData(profile, snapshot);
  await writeKnowledgeRecovery(profile, { noteId: 'fixture', assets: [{ source: 'task-image:fixture', dataUrl }] });
  const [fileName] = await fs.readdir(path.join(profile, IMAGE_ASSETS_DIR));
  const blob = path.join(profile, IMAGE_ASSETS_DIR, fileName);
  const raw = await fs.readFile(dataFilePath(profile));
  const draft = await fs.readFile(recoveryFilePath(profile));
  await fs.writeFile(blob, 'a different image');
  await assert.rejects(verifyTaskWorkspace(profile), { code: 'TASK_IMAGE_INVALID' });
  await assert.rejects(writeTaskData(profile, { tasks: [] }), { code: 'TASK_IMAGE_INVALID' });
  await fs.rm(blob);
  await assert.rejects(readTaskData(profile), { code: 'TASK_IMAGE_MISSING' });
  await assert.rejects(readKnowledgeRecovery(profile), { code: 'TASK_IMAGE_MISSING' });
  assert.deepEqual(await fs.readFile(dataFilePath(profile)), raw);
  assert.deepEqual(await fs.readFile(recoveryFilePath(profile)), draft);
});

test('structurally invalid data and a missing initialized database enter recovery', async t => {
  const profile = await fixture(t);
  const file = dataFilePath(profile);
  assert.equal(await verifyTaskWorkspace(profile), null);
  const invalid = '{"version":2,"tasks":null}';
  await fs.writeFile(file, invalid);
  await assert.rejects(verifyTaskWorkspace(profile), { code: 'CORRUPT_TASK_DATA' });
  await assert.rejects(writeTaskData(profile, { tasks: [] }), { code: 'CORRUPT_TASK_DATA' });
  assert.equal(await fs.readFile(file, 'utf8'), invalid);

  await fs.writeFile(file, JSON.stringify({ tasks: [{ id: 'task_fixture' }] }));
  assert.equal((await verifyTaskWorkspace(profile)).tasks.length, 1);
  await fs.rm(file);
  await assert.rejects(verifyTaskWorkspace(profile), { code: 'MISSING_TASK_DATA' });
  await assert.rejects(writeTaskData(profile, { tasks: [] }), { code: 'MISSING_TASK_DATA' });
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
});

test('the trash keeps more than 500 records after a round trip', async t => {
  const profile = await fixture(t);
  const recentlyDeleted = Array.from({ length: 501 }, (_, index) => ({
    id: `archive_${index}`, kind: 'task', record: { id: `task_${index}` },
  }));
  await writeTaskData(profile, { tasks: [], recentlyDeleted });
  const reopened = await readTaskData(profile);
  assert.equal(reopened.recentlyDeleted.length, 501);
  assert.equal(reopened.version, DATA_VERSION);
  assert.ok(reopened.recentlyDeleted.some(item => item.id === 'archive_0'));
});

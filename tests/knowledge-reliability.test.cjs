const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {saveKnowledgeDocument,readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
const {writeTaskData,readTaskData}=require('../app/main/storage.cjs');
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

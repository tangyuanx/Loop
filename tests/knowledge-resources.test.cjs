const test=require('node:test'),assert=require('node:assert/strict');
const {resolveResource,destinations}=require('../app/main/knowledge-resources.cjs');
const {normalizeTaskData}=require('../app/main/storage.cjs');
test('resource paths preserve encoded hash, Chinese/space, Windows drive and relative anchors',()=>{
 assert.equal(resolveResource('./代码%20文件.c#section','/notes/source.md','darwin').filePath,'/notes/代码 文件.c');
 assert.equal(resolveResource('./a%23b.md#section','/notes/source.md','darwin').filePath,'/notes/a#b.md');
 assert.equal(resolveResource('../src/main.c','D:\\notes\\source.md','win32').filePath,'D:\\src\\main.c');
 assert.equal(resolveResource('file:///D:/notes/%E4%B8%AD%20a.md','','win32').filePath,'D:\\notes\\中 a.md');
 assert.throws(()=>resolveResource('D:\\notes\\a.md','','darwin'),/Windows/);
 assert.throws(()=>resolveResource('./a.c'),/先保存/);
 for(const href of ['javascript:alert(1)','data:text/html,test','vbscript:test'])assert.throws(()=>resolveResource(href),/不支持/);
});
test('link authorization excludes code/images and handles balanced paths/angle spaces',()=>{
 assert.deepEqual(destinations('`[隐藏](./secret.c)`\n![图片](./pic.png)\n[代码](<./代码 文件.c>)\n[括号](./a(b).c)\n```\n[隐藏](./secret2.c)\n```'),['./代码 文件.c','./a(b).c']);
 assert.equal(resolveResource('/tmp/a.js').kind,'code');assert.equal(resolveResource('/tmp/a.js').canExternal,false);
 assert.equal(resolveResource('/tmp/a.exe').canExternal,false);assert.equal(resolveResource('/tmp/a.docx').canExternal,true);
});
test('node states and shared resource preference survive desktop normalization without changing completion semantics',()=>{
 const data=normalizeTaskData({nodeStates:[{id:'custom_wait',name:'等待中',color:'#847c55'}],knowledgeWorkspace:{resourceOpenMode:'external'},tasks:[{id:'a',nodes:[{id:'n',status:'custom_wait'}]}]});
 assert.equal(data.tasks[0].nodes[0].status,'custom_wait');assert.equal(data.nodeStates[0].name,'等待中');assert.equal(data.knowledgeWorkspace.resourceOpenMode,'external');
 assert.equal(normalizeTaskData({}).knowledgeWorkspace.resourceOpenMode,'internal');
});

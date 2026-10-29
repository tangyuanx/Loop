const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../app/renderer/src/knowledge-core.js');
const metadata=require('../app/renderer/src/knowledge-document.js');
const {normalizeTaskData}=require('../app/main/storage.cjs');
const fs=require('node:fs');
const note=(id,title)=>({id:'task-'+id,title,knowledgeNote:{noteId:id,title,aliases:[]}});

test('document workspace restores tabs and per-task last document without creating task notes',()=>{
 const tasks=[{id:'empty'},{id:'legacy',notes:'旧正文'},{id:'linked',activeKnowledgeId:'d'}],docs=[{id:'d',notes:''},{id:'deleted',knowledgeNote:{isDeleted:true}}];
 const migrated=metadata.normalizeWorkspace(null,tasks,docs);
 assert.deepEqual(migrated.openIds,[]);assert.deepEqual(migrated.lastByTask,{legacy:'legacy',linked:'d'});
 const input={openIds:['d','d','legacy','missing','deleted'],activeId:'d',recentIds:['legacy','d','deleted'],taskId:'linked',lastByTask:{empty:'d',legacy:'',linked:'missing'},visible:true};
 const normalized=metadata.normalizeWorkspace(input,tasks,docs);
 assert.deepEqual(normalized.openIds,['d']);assert.equal(normalized.activeId,'d');assert.equal(normalized.lastByTask.legacy,'');assert.equal(normalized.lastByTask.empty,'d');assert.equal(normalized.lastByTask.linked,'d');
 assert.deepEqual(normalized.tabsByTask,{empty:['d'],legacy:[],linked:['d']});assert.deepEqual(normalized.recentIds,['legacy','d']);
 assert.deepEqual(metadata.normalizeWorkspace(normalized,tasks,docs),normalized);
 const persisted=normalizeTaskData({version:2,tasks,knowledgeDocuments:docs,knowledgeWorkspace:input});
 assert.equal(persisted.knowledgeWorkspace.activeId,'d');assert.equal(persisted.tasks[0].notes,'');
});

test('task tab sessions keep multiple documents separate and retain explicit empty sessions',()=>{
 const tasks=[{id:'a'},{id:'b'},{id:'new'}],documents=[{id:'one'},{id:'two'},{id:'three'}];
 const input={taskId:'b',activeId:'three',openIds:['one','three'],recentIds:['three','two','one'],lastByTask:{a:'two',b:'three'},tabsByTask:{a:['one','two','two'],b:['three','missing']},visible:true};
 const normalized=metadata.normalizeWorkspace(input,tasks,documents);
 assert.deepEqual(normalized.openIds,['three']);assert.deepEqual(normalized.tabsByTask.a,['one','two']);assert.deepEqual(normalized.tabsByTask.b,['three']);assert.equal(normalized.tabsByTask.new,undefined);
 assert.deepEqual(metadata.normalizeWorkspace(normalized,tasks,documents),normalized);
 const closed=metadata.normalizeWorkspace({...normalized,activeId:'',openIds:[],lastByTask:{...normalized.lastByTask,b:''},tabsByTask:{...normalized.tabsByTask,b:[]}},tasks,documents);
 assert.deepEqual(closed.openIds,[]);assert.equal(closed.activeId,'');assert.deepEqual(closed.tabsByTask.a,['one','two']);
});

test('open and relocate use the corresponding native file picker titles',async()=>{
 const {chooseKnowledgeDocument}=require('../app/main/knowledge-file.cjs');const seen=[];
 const dialog={showOpenDialog:async options=>{seen.push(options);return {canceled:true}}};
 await chooseKnowledgeDocument({dialog});await chooseKnowledgeDocument({dialog,purpose:'relocate'});
 assert.deepEqual(seen.map(options=>options.title),['打开知识笔记','重新定位知识笔记']);
 assert.deepEqual(seen[0].properties,['openFile']);
});

test('independent documents and task associations survive desktop normalization without manufacturing tasks',()=>{
 const stamp='2026-10-28T00:00:00.000Z';
 const input={version:2,tasks:[{id:'t',title:'任务',knowledgeLinks:['d','d',null],activeKnowledgeId:'d'}],knowledgeDocuments:[{id:'d',title:'独立方案',creatorTaskId:'t',notes:'| A |\n| --- |\n| 数据 |',createdAt:stamp,knowledgeNote:{noteId:'stable-d',tableColumnWidths:[[240]]}}]};
 const data=normalizeTaskData(input);assert.equal(data.tasks.length,1);assert.deepEqual(data.tasks[0].knowledgeLinks,['d']);assert.equal(data.tasks[0].activeKnowledgeId,'d');assert.equal(data.knowledgeDocuments[0].knowledgeNote.noteId,'stable-d');assert.deepEqual(data.knowledgeDocuments[0].knowledgeNote.tableColumnWidths,[[240]]);
 assert.deepEqual(normalizeTaskData(data),data);
 const {boundFilePaths}=require('../app/main/knowledge-access.cjs');data.knowledgeDocuments[0].knowledgeNote.filePath='/tmp/独立方案.md';assert.deepEqual(boundFilePaths(data),['/tmp/独立方案.md']);
 assert.equal(metadata.normalizeDocuments([null,{id:'t'},input.knowledgeDocuments[0],input.knowledgeDocuments[0]],data.tasks).length,1);
});

test('table boundary edits keep valid Markdown and protect header and final column',()=>{
 const source='前文\n\n| A |\n| :---: |\n| 值 |\n\n后文',pos=source.indexOf('值');
 const apply=change=>source.slice(0,change.from)+change.insert+source.slice(change.to);
 for(const operation of ['row-before','column-before','row-add','column-add']){const change=core.editTable(source,pos,operation,0);const result=apply(change);assert.match(result,/^前文/);assert.match(result,/后文$/);assert.ok(core.tableAt(result,change.from));}
 const headerOnly=apply(core.editTable(source,pos,'row-delete'));assert.equal(core.tableAt(headerOnly,headerOnly.indexOf('| A')).rows.length,2);
 assert.equal(core.editTable(source,source.indexOf('A'),'row-delete'),null);assert.equal(core.editTable(source,pos,'column-delete',0),null);
 assert.equal(apply(core.editTable(source,pos,'delete')).replace(/\s/g,''),'前文后文');
});

test('table row and column actions preserve aligned data and protected header',()=>{
 const source='正文\n\n| 项目 | 值 |\n| :--- | ---: |\n| A | 1 |\n| B | 2 |\n\n结尾',pos=source.indexOf('| A');
 const run=(op,col,value)=>{const c=core.editTable(source,pos,op,col,value);assert.ok(c,op);return core.tableAt(c.insert,0).rows;};
 assert.deepEqual(run('row-duplicate',0)[3],['A','1']);assert.deepEqual(run('row-clear',0)[2],['','']);
 assert.deepEqual(run('row-move',0,3).slice(2),[['B','2'],['A','1']]);
 assert.deepEqual(run('column-move',0,1),[['值','项目'],['---:',':---'],['1','A'],['2','B']]);
 assert.deepEqual(run('column-duplicate',1)[2],['A','1','1']);assert.deepEqual(run('column-clear',1)[1],[':---','---:']);
 assert.equal(core.editTable(source,source.indexOf('项目'),'row-move',0,3),null);
 assert.equal(core.editTable(source,pos,'row-move',0,1),null);
});

test('wiki indexing excludes fenced/inline code, escapes, comments and frontmatter',()=>{
 const md=['---','title: "[[yaml]]"','---','[[有效#标题|显示]]','`[[code]]`','`` a ` [[code2]] ``','\\[[escaped]]','<!-- [[html-comment]] -->','%% [[comment]]','[[comment2]] %%','```js','[[fence]]','```','~~~','[[tilde]]','~~~','    [[indented-code]]','![[目标#^block]]'].join('\n');
 assert.deepEqual(core.links(md).map(l=>({target:l.target,anchor:l.anchor,label:l.label,embed:l.embed})),[
  {target:'有效',anchor:'标题',label:'显示',embed:false},{target:'目标',anchor:'^block',label:'',embed:true}]);
 assert.deepEqual(core.links('\\\\[[真实]]').map(l=>l.target),['真实']);
 assert.deepEqual(core.links('`incomplete [[仍可编辑]]').map(l=>l.target),['仍可编辑']);
});
test('new links use stable identity; historical titles survive normalized rename and persistence',()=>{
 let a=note('a','旧名称'),b=note('b','同名');
 a.knowledgeNote=metadata.updateDocumentTitle(a.knowledgeNote,'新名称');
 const data=normalizeTaskData({version:2,tasks:[a,b],taskGroups:[]});a=data.tasks[0];
 assert.equal(core.resolve('旧名称',data.tasks).note.id,a.id);
 assert.equal(core.resolve('note:a',data.tasks).note.id,a.id);
 assert.equal(core.stableLink(a),'[[note:a|新名称]]');
 const duplicate=note('c','新名称');
 assert.equal(core.resolve('新名称',[a,duplicate]).status,'ambiguous');
 assert.equal(core.resolve('note:c',[a,duplicate]).note.id,duplicate.id);
 assert.equal(core.resolve('note:private',[a,b]).status,'missing');
});
test('anchors extract a heading section or a whole paragraph block with a stable block ID',()=>{
 const doc='# 外层\n\n## 目标\n\n段落一\n继续 ^block\n\n### 子标题\n正文\n\n## 下一节\n其余';
 assert.equal(core.fragment(doc,'^block'),'段落一\n继续');
 assert.match(core.fragment(doc,'目标'),/### 子标题/);
 assert.doesNotMatch(core.fragment(doc,'目标'),/下一节/);
 assert.equal(core.fragment(doc,'不存在'),null);
 assert.equal(core.fragment('```\n隐藏 ^block\n```','^block'),null);
});
test('headings ignore YAML and code and preserve source offsets',()=>{
 const text='---\nkey: value\n---\n# 一\n\n```\n# 假标题\n```\n###### 六\n';
 const headings=core.headings(text);
 assert.deepEqual(headings.map(h=>h.level),[1,6]);
 headings.forEach(h=>assert.equal(text[h.offset],'#'));
 assert.deepEqual(core.headings('一级\n===\n\n二级\n---\n').map(h=>h.level),[1,2]);
});
test('table editing preserves alignment, escaped pipes and surrounding Markdown',()=>{
 const text='前文\n\n| A | B |\n| :--- | ---: |\n| a\\|b | `x|y` |\n| c | d |\n\n后文';
 const pos=text.indexOf('a\\|b'),table=core.tableAt(text,pos);
 assert.equal(table.rows[2].length,2);assert.equal(table.rows[2][1],'`x|y`');
 for(const [op,count] of [['column-add',3],['column-delete',1]]){
  const change=core.editTable(text,pos,op,0);const edited=text.slice(0,change.from)+change.insert+text.slice(change.to);
  assert.match(edited,/^前文/);assert.match(edited,/后文$/);assert.equal(core.tableAt(edited,pos).rows[0].length,count);
 }
 const cell=core.editTable(text,pos,'cell',1,'新|内容');assert.match(cell.insert,/新\\\|内容/);
 const align=core.editTable(text,pos,'align',0,'center');assert.match(align.insert,/:---:/);
 assert.equal(core.editTable('普通文本',0,'row-add'),null);
});
test('the Markdown fixture round-trips metadata normalization without conversion',()=>{
 const source=fs.readFileSync('tests/fixtures/knowledge.md','utf8');
 const normalized=normalizeTaskData({version:2,tasks:[{id:'historical',title:'历史',notes:source,nodes:[]}]});
 assert.equal(normalized.tasks[0].notes,source);
 assert.ok(core.links(source).some(l=>l.embed));
 assert.ok(!core.links(source).some(l=>l.target==='不是真实链接'));
});
test('per-note save serialization continues after failure and permits independent notes',async()=>{
 const queue=new core.SerialQueue();let release;const block=new Promise(r=>release=r);const order=[];
 const one=queue.run('a',async()=>{order.push('a1');await block;throw new Error('disk full');});
 const two=queue.run('a',async()=>{order.push('a2');return 2;});
 await queue.run('b',async()=>order.push('b'));
 assert.deepEqual(order,['a1','b']);release();await assert.rejects(one,/disk full/);assert.equal(await two,2);
 assert.deepEqual(order,['a1','b','a2']);assert.equal(queue.queues.size,0);
});
test('image destination scanning respects code, comments, escapes, titles and balanced parentheses',()=>{
 const source='![a](task-image:a "描述")\n`![code](task-image:a)`\n\\![escaped](task-image:a)\n%% ![comment](task-image:a) %%\n![b](images/test(1).png)\n![c](<images/space name.png>)';
 const refs=core.imageReferences(source);
 assert.deepEqual(refs.map(r=>r.url),['task-image:a','images/test(1).png','images/space name.png']);
 refs.forEach(r=>assert.equal(source.slice(r.from,r.to),r.url));
});
test('source serialization retains CRLF, CR, LF, mixed separators and Unicode offsets',()=>{
 for(const source of ['中文😀\r\n\r\n尾行\r\n','中文😀\r尾行\r','中文😀\n尾行\n','中文😀\r\n空行\n\r末行']){
  const format=core.sourceFormat(source);
  assert.ok(!format.text.includes('\r'));
  assert.equal(core.serializeSource(format.text,format),source);
 }
 for(const ending of ['\n','\r\n','\r'])assert.equal(core.sourceFormat(('行'+ending).repeat(10000)).breaks.size,0);
});

test('spreadsheet paste expands a table grid, escapes pipes and preserves surrounding prose',()=>{
 const source='前文\n\n| 一 | 二 |\n| --- | --- |\n| 旧 | 保留 |\n\n后文';
 const pos=source.indexOf('旧');
 const change=core.pasteTable(source,pos,1,'甲\t乙|丙\r\n丁\t戊\r\n');
 const result=source.slice(0,change.from)+change.insert+source.slice(change.to);
 assert.equal(result,'前文\n\n| 一 | 二 |  |\n| --- | --- | --- |\n| 旧 | 甲 | 乙\\|丙 |\n|  | 丁 | 戊 |\n\n后文');
 assert.equal(core.tableAt(result,result.indexOf('戊')).rows.length,4);
 assert.equal(core.pasteTable('普通正文',0,0,'甲\t乙'),null);
 const header=core.pasteTable(source,source.indexOf('一'),0,'新一\t新二\n值一\t值二');
 assert.match(header.insert,/\| 新一 \| 新二 \|\n\| --- \| --- \|\n\| 值一 \| 值二 \|/);
});

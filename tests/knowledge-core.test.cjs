const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../app/renderer/src/knowledge-core.js');
const metadata=require('../app/renderer/src/knowledge-document.js');
const {normalizeTaskData}=require('../app/main/storage.cjs');
const fs=require('node:fs');
const note=(id,title)=>({id:'task-'+id,title,knowledgeNote:{noteId:id,title,aliases:[]}});

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

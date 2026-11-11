// Production renderer lifecycle tests with a small DOM/save-queue adapter.
// These test model transitions and asynchronous confirmation, not native UI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const listeners = new Map(), elements = new Map(), bindings = new WeakMap();
  const task = {id:'t', description:'背景原文', hypothesis:'进展原文', conclusion:'结论原文', history:[],
    nodes:[{id:'n',title:'节点原文',note:'记录原文',conclusion:'节点结论',children:[]}]};
  const document = {activeElement:null, querySelector:key=>elements.get(key)||null,
    querySelectorAll:key=>elements.has(key)?[elements.get(key)]:[], addEventListener() {}, getElementById:()=>null};
  const field = (value, dataset={}) => {
    const handlers = new Map(), attrs = new Map();
    const el = {value, dataset, isConnected:true, style:{}, scrollHeight:26, scrollTop:0,
      selectionStart:0, selectionEnd:0, selectionDirection:'none', title:'',
      classList:{contains:()=>false}, matches:s=>s==='.brief21-input'&&!!dataset.brief21Key,
      closest:()=>({querySelector:()=>null}),
      addEventListener:(name,fn)=>handlers.set(name,[...(handlers.get(name)||[]),fn]),
      setAttribute:(k,v)=>attrs.set(k,v), getAttribute:k=>attrs.get(k), removeAttribute:k=>attrs.delete(k),
      setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},
      focus(){document.activeElement=this;this.fire('focus');},
      blur(){document.activeElement=null;this.fire('blur');}, select(){},
      fire(name,props={}) {
        const event={target:this,key:'',preventDefault(){this.defaultPrevented=true;},
          stopImmediatePropagation(){this.stopped=true;},...props};
        for(const fn of handlers.get(name)||[])fn(event);
        return event;
      },
    };
    return el;
  };
  let writes=0, confirms=0, closed=0, result=true;
  const context = vm.createContext({document,console,Event,queueMicrotask,Date,
    window:{addEventListener:(name,fn)=>listeners.set(name,[...(listeners.get(name)||[]),fn]),setTimeout},
    localStorage:{getItem:()=>null}, CSS:{escape:s=>s},
    state:{tasks:[task],activeTaskId:'t',taskPane:'flow',selectedNodeId:'n',shellDrafts:{},nodeStates:[]},
    retainedRegionMarkup:new Map(), nodeNoteDrafts:new Map(),
    activeTask:()=>task, now:()=>new Date().toISOString(),
    flatten:nodes=>nodes.flatMap(n=>[n,...context.flatten(n.children||[])]),
    findNode:(nodes,id)=>context.flatten(nodes).find(n=>n.id===id),
    bindRenderElement:(el,key)=>{const set=bindings.get(el)||new Set();bindings.set(el,set);if(set.has(key))return false;set.add(key);return true;},
    save:()=>{writes++;},flushSave:async()=>{confirms++;return typeof result==='function'?result():result;},
    render(){},clearConclusionNotice(){},
    shellBriefFields:()=>['description','hypothesis','conclusion'].map(field=>({field,label:field,value:task[field]})),
    updateNodeNoteDraft:(taskId,nodeId,markdown)=>context.nodeNoteDrafts.set(nodeId,{markdown}),
    flushNodeNoteDrafts:()=>{for(const [id,draft] of context.nodeNoteDrafts){context.findNode(task.nodes,id).note=draft.markdown;}context.nodeNoteDrafts.clear();},
  });
  for(const name of ['workspace.js','actions.js','brief21.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/renderer/src',name),'utf8'),context,{filename:name});
  // Geometry/DOM replacement is exercised by the Electron suite. Keep this
  // adapter limited to recording the close requested by the production code.
  context.shellBindNodeRecordWindow=()=>{};
  context.shellSyncNodeRecordMeta=()=>{};
  context.exitNodeDetail=()=>{closed++;context.state.selectedNodeId='';};
  context.render=()=>{};
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  const dispatch=(name,el,props={})=>{
    const event={target:el,key:'',preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...props};
    for(const fn of listeners.get(name)||[])fn(event);
    return event;
  };
  const brief=()=>{const el=field(task.description,{brief21Key:'t:description'});el.focus();dispatch('focusin',el);return el;};
  return {context,task,document,elements,field,brief,dispatch,settle,
    setResult(value){result=value;},counts:()=>({writes,confirms,closed})};
}

test('brief Enter waits for persistence; later text remains in the same session', async()=>{
  const h=harness(),el=h.brief();el.value='已提交内容';h.dispatch('input',el);
  let release;h.setResult(()=>new Promise(resolve=>{release=resolve;}));
  assert.equal(h.dispatch('keydown',el,{key:'Enter'}).defaultPrevented,true);
  assert.equal(h.document.activeElement,el);
  el.value='保存期间的新内容';h.dispatch('input',el);release(true);await h.settle();
  assert.equal(h.document.activeElement,el);assert.equal(h.task.description,'保存期间的新内容');
  h.setResult(true);h.dispatch('keydown',el,{key:'Enter'});await h.settle();
  assert.equal(h.document.activeElement,null);assert.equal(h.task.history.length,1);
});

test('brief Escape restores autosaved text without creating a changed-session history entry', async()=>{
  const h=harness(),el=h.brief();el.value='自动保存过的修改';h.dispatch('input',el);
  assert.equal(h.task.description,el.value);
  h.dispatch('keydown',el,{key:'Escape'});await h.settle();
  assert.equal(h.task.description,'背景原文');assert.equal(el.value,'背景原文');
  assert.equal(h.task.history.length,0);assert.equal(h.document.activeElement,null);
});

test('brief failed save keeps its input and edit session available for retry', async()=>{
  const h=harness(),el=h.brief();el.value='失败不丢';h.dispatch('input',el);h.setResult(false);
  h.dispatch('keydown',el,{key:'Enter'});await h.settle();
  assert.equal(el.value,'失败不丢');assert.equal(el.getAttribute('aria-invalid'),'true');
  assert.equal(h.document.activeElement,el);
  h.setResult(true);h.dispatch('keydown',el,{key:'Enter'});await h.settle();
  assert.equal(h.document.activeElement,null);
});

test('brief Shift+Enter and IME confirmation do not submit or cancel',()=>{
  const h=harness(),el=h.brief();
  assert.ok(!h.dispatch('keydown',el,{key:'Enter',shiftKey:true}).defaultPrevented);
  for(const props of [{key:'Enter',isComposing:true},{key:'Escape',keyCode:229}])h.dispatch('keydown',el,props);
  assert.equal(h.counts().confirms,0);assert.equal(h.document.activeElement,el);
});

test('node rename Escape reverses a failed submitted value but preserves an external replacement',async()=>{
  for(const external of [false,true]){
    const h=harness(),el=h.field('新标题',{taskId:'t',nodeId:'n'});
    h.context.input=el;
    vm.runInContext("shellNodeRenameDraft={taskId:'t',nodeId:'n',original:'节点原文',value:'新标题'}",h.context);
    h.elements.set('[data-shell-node-rename]',el);h.context.shellBindInlineNodeTitles();h.setResult(false);
    el.fire('keydown',{key:'Enter'});await h.settle();assert.equal(h.task.nodes[0].title,'新标题');
    if(external)h.task.nodes[0].title='其他操作修改';
    h.elements.delete('[data-shell-node-rename]');h.context.shellFinishNodeTitleEdit(false);
    assert.equal(h.task.nodes[0].title,external?'其他操作修改':'节点原文');
  }
});

test('node rename blur failure keeps draft and field for retry',async()=>{
  const h=harness(),el=h.field('点击外部提交',{taskId:'t',nodeId:'n'});
  vm.runInContext("shellNodeRenameDraft={taskId:'t',nodeId:'n',original:'节点原文',value:'点击外部提交'}",h.context);
  h.elements.set('[data-shell-node-rename]',el);h.context.shellBindInlineNodeTitles();h.setResult(false);
  el.fire('blur');await h.settle();
  assert.equal(vm.runInContext('shellNodeRenameDraft.value',h.context),'点击外部提交');
  assert.equal(el.getAttribute('aria-invalid'),'true');
});

test('record Escape replaces queued and autosaved edits with the focus-session baseline',async()=>{
  const h=harness(),el=h.field('记录原文',{shellNodeRecord:'n'});
  h.elements.set('[data-shell-node-record]',el);h.context.shellBindNodeRecord();el.focus();
  el.value='自动保存文本';el.fire('input');h.context.flushNodeNoteDrafts();
  el.value='仍在队列的文本';el.fire('input');
  el.fire('keydown',{key:'Escape'});await h.settle();
  assert.equal(h.task.nodes[0].note,'记录原文');assert.equal(h.context.nodeNoteDrafts.size,0);
  assert.equal(h.counts().closed,1);
});

test('record failure retains editor; a real focus departure starts a new cancel baseline',async()=>{
  const h=harness(),el=h.field('记录原文',{shellNodeRecord:'n'});
  h.elements.set('[data-shell-node-record]',el);h.context.shellBindNodeRecord();el.focus();
  el.value='第一次编辑';el.fire('input');el.blur();await h.settle();el.focus();
  el.value='第二次编辑';el.fire('input');h.setResult(false);el.fire('keydown',{key:'Enter'});await h.settle();
  assert.equal(h.counts().closed,0);assert.equal(el.value,'第二次编辑');
  h.setResult(true);el.fire('keydown',{key:'Escape'});await h.settle();
  assert.equal(h.task.nodes[0].note,'第一次编辑');assert.equal(h.counts().closed,1);
});

test('record redraw focus reuse keeps cancel baseline and replacement model is never modified',async()=>{
  const h=harness(),el=h.field('记录原文',{shellNodeRecord:'n'});
  h.elements.set('[data-shell-node-record]',el);h.context.shellBindNodeRecord();el.focus();
  el.value='重绘前修改';el.fire('input');el.blur();el.focus();await h.settle();
  el.fire('keydown',{key:'Escape'});await h.settle();assert.equal(h.task.nodes[0].note,'记录原文');
  h.task.nodes[0]={...h.task.nodes[0],note:'导入的新模型'};el.fire('keydown',{key:'Escape'});await h.settle();
  assert.equal(h.task.nodes[0].note,'导入的新模型');
});

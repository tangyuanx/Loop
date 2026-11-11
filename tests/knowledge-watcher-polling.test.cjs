// Preserved from the original dirty worktree during frontend stage 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createKnowledgeFileWatcher } = require('../app/main/knowledge-watcher.cjs');

test('knowledge watcher polling fallback cleans up its own listener', () => {
  let poll, removed, closed = false;
  const watcher = createKnowledgeFileWatcher({
    fsApi: {
      watch: () => ({ on() {}, close() { closed = true; } }),
      watchFile: (_path, options, callback) => {
        assert.equal(options.persistent, false);
        poll = callback;
      },
      unwatchFile: (_path, callback) => { removed = callback; },
    },
    fileReader: async () => ({ success: true, lastSavedHash: 'baseline' }),
  });
  watcher.watch({ noteId: 'poll-note', filePath: '/tmp/poll-note.md', lastSavedHash: 'baseline' });
  watcher.closeAll();
  assert.equal(closed, true);
  assert.equal(removed, poll);
  assert.equal(watcher.size, 0);
});

test('silent rebind ignores initial polling baselines but reports external edits and read errors', async t => {
  let poll, result = {success:true,lastSavedHash:'saved',lastSavedMtime:1};
  const events = [];
  const watcher = createKnowledgeFileWatcher({
    debounceMs:1,
    fsApi:{watch:()=>({on(){},close(){}}),watchFile:(_path,_options,callback)=>{poll=callback;},unwatchFile(){}},
    fileReader:async()=>result,onChange:event=>events.push(event),
  });
  t.after(()=>watcher.closeAll());
  watcher.watch({noteId:'silent',filePath:'/tmp/silent.md',lastSavedHash:'saved'},{emitBaseline:false});
  const inspect=async()=>{
    poll({mtimeMs:1,ctimeMs:1,size:1,ino:1},{mtimeMs:0,ctimeMs:0,size:0,ino:0});
    await new Promise(resolve=>setTimeout(resolve,15));
  };
  await inspect();assert.deepEqual(events,[],'the initial watchFile callback must not mark dirty text saved');
  result={success:false,errorCode:'EIO',message:'disk read failed'};
  await inspect();assert.equal(events.pop().type,'file-unavailable','silent baselines must not hide disk failures');
  result={success:true,lastSavedHash:'external',lastSavedMtime:2};
  await inspect();assert.equal(events.pop().type,'external-changed');
  watcher.updateBaseline('silent',{lastSavedHash:'external'});
  await inspect();assert.equal(events.pop().type,'baseline','an acknowledged save resumes normal baselines');
});

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

test('a failed directory watcher still monitors a note through stat polling', async t => {
  let poll;
  let disk = {success:true, lastSavedHash:'saved'};
  const events = [];
  const watcher = createKnowledgeFileWatcher({
    debounceMs: 0,
    fsApi: {
      watch() { throw Object.assign(new Error('directory watch limit'), {code:'EMFILE'}); },
      watchFile(_path, _options, listener) { poll = listener; },
      unwatchFile() {},
    },
    fileReader: async () => disk,
    onChange: event => events.push(event),
  });
  t.after(() => watcher.closeAll());
  assert.equal(watcher.watch({noteId:'poll-only',filePath:'/tmp/poll-only.md',lastSavedHash:'saved'},{emitBaseline:false}).success, true);
  assert.deepEqual(events, []);
  async function changed(result) {
    disk = result;
    poll({ino:2},{ino:1});
    await new Promise(resolve => setTimeout(resolve, 20));
    return events.pop();
  }
  assert.equal((await changed({success:false,errorCode:'ENOENT'})).type, 'file-missing');
  assert.equal((await changed({success:true,lastSavedHash:'saved'})).type, 'baseline');
  assert.equal((await changed({success:true,lastSavedHash:'external'})).type, 'external-changed');
});

test('an in-flight read cannot report an old file version after a save is acknowledged', async t => {
  let finishRead, startRead;
  const started = new Promise(resolve => { startRead = resolve; });
  const events = [];
  const watcher = createKnowledgeFileWatcher({
    fsApi: {watch: () => ({on(){}, close(){}})},
    fileReader: () => new Promise(resolve => { finishRead = resolve; startRead(); }),
    onChange: event => events.push(event),
  });
  t.after(() => watcher.closeAll());
  watcher.watch({noteId:'saving',filePath:'/tmp/saving.md',lastSavedHash:'before'});
  await started;
  watcher.updateBaseline('saving', {lastSavedHash:'after'});
  finishRead({success:true,lastSavedHash:'before'});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, []);
});

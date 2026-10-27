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

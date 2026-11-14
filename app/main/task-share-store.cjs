const { assertShare } = require('./task-share-archive.cjs');

function taskShareStore({ read, write, assertWritable }) {
  let queue = Promise.resolve();
  let revision = 0;
  function serialize(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }
  function verify(expected) {
    assertShare(expected === revision, 'DATA_STALE_REVISION', '任务数据已更新，请重新读取后重试。');
  }
  return {
    serialize,
    read: () => serialize(read),
    readForRenderer: () => serialize(async () => {
      const data = await read();
      return data ? { ...data, shareRevision: revision } : data;
    }),
    save: (data, expected) => serialize(async () => {
      assertWritable();
      verify(expected ?? 0);
      return write(data);
    }),
    append: (expected, operation) => serialize(async () => {
      assertWritable();
      verify(expected ?? 0);
      const result = await operation((await read()) || {}, write);
      revision += 1;
      return { ...result, success: true, revision };
    }),
  };
}

module.exports = { taskShareStore };

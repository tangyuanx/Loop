const { assertShare } = require('./task-share-archive.cjs');
const { readTaskActivity, recordTaskActivity, restoreTaskActivityValue } = require('./task-history.cjs');

function taskShareStore({ read, write, assertWritable, now = () => new Date() }) {
  let queue = Promise.resolve();
  let revision = 0;
  let current;
  function serialize(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }
  function verify(expected) {
    assertShare(expected === revision, 'DATA_STALE_REVISION', '任务数据已更新，请重新读取后重试。');
  }
  async function snapshot() {
    if (current === undefined) current = (await read()) ?? null;
    return current;
  }
  async function commit(previous, next, { now: stamp = now(), ...context } = {}) {
    const data = recordTaskActivity(previous, next, { now: stamp, ...context });
    const result = await write(data);
    current = result ?? data;
    return result;
  }
  return {
    serialize,
    read: () => serialize(snapshot),
    readForRenderer: () => serialize(async () => {
      const data = await snapshot();
      if (!data) return data;
      const { taskActivity, ...workspace } = data;
      return { ...workspace, shareRevision: revision };
    }),
    save: (data, expected) => serialize(async () => {
      assertWritable();
      verify(expected ?? 0);
      return commit(await snapshot(), data, { source: "save" });
    }),
    append: (expected, operation) => serialize(async () => {
      assertWritable();
      verify(expected ?? 0);
      const previous = (await snapshot()) || {};
      const result = await operation(previous, data => commit(previous, data, { source: "import" }));
      revision += 1;
      return { ...result, success: true, revision };
    }),
    historyFor: (taskId, beforeId) => serialize(async () => readTaskActivity(await snapshot(), taskId, beforeId)),
    restoreHistory: payload => serialize(async () => {
      assertWritable();
      verify(payload?.revision ?? 0);
      const previous = await snapshot();
      const at = now();
      const restored = restoreTaskActivityValue(previous, payload || {}, at);
      assertShare(restored, "TASK_HISTORY_VERSION_UNAVAILABLE", "这段历史内容已无法恢复，或原节点已移入最近删除。");
      if (restored.next !== previous) {
        await commit(previous, restored.next, { now: at, restoredTarget: restored.receipt });
        revision += 1;
      }
      return { ...restored.receipt, revision };
    }),
  };
}

module.exports = { taskShareStore };

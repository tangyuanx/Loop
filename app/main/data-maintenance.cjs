/**
 * Loop -- data maintenance lock
 *
 * Importing or restoring a data set replaces the managed files in place, so the
 * renderer must not be able to write task data while that is happening. The lock
 * stays engaged after a successful import until the relaunch, because a late
 * debounced autosave would otherwise overwrite the freshly restored database.
 */

function createDataMaintenanceLock() {
  const holders = [];
  const waiters = new Set();
  const writes = new Set();

  function notify() {
    for (const resolve of waiters) resolve();
    waiters.clear();
  }

  function release(holder = holders.at(-1)) {
    const index = holders.indexOf(holder);
    if (index < 0) return;
    holders.splice(index, 1);
    notify();
  }

  function begin(reason = "data-restore") {
    const holder = { reason: String(reason || "data-restore") };
    holders.push(holder);
    notify();
    return () => release(holder);
  }

  function isActive() {
    return holders.length > 0;
  }

  function currentReason() {
    return holders.at(-1)?.reason || "";
  }

  function assertWritable() {
    if (isActive()) {
      throw Object.assign(
        new Error("正在恢复或导入数据，已暂停写入以保护当前数据"),
        { code: "DATA_MAINTENANCE" },
      );
    }
  }

  async function track(operation) {
    // Snapshot and cleanup operations need a stable view of recovery assets.
    // Wait outside their drain set so arriving writes can resume afterward.
    while (holders.length && holders.every(holder =>
      holder.reason === "workspace-backup" || holder.reason === "recently-deleted-cleanup")) {
      await new Promise(resolve => waiters.add(resolve));
    }
    assertWritable();
    const pending = Promise.resolve().then(operation);
    writes.add(pending);
    try { return await pending; } finally { writes.delete(pending); }
  }

  function waitForWrites() {
    return Promise.allSettled(writes);
  }

  return { begin, end: release, isActive, reason: currentReason, assertWritable, track, waitForWrites };
}

const defaultLock = createDataMaintenanceLock();

module.exports = {
  createDataMaintenanceLock,
  defaultLock,
  assertWritable: defaultLock.assertWritable,
  begin: defaultLock.begin,
  end: defaultLock.end,
  isActive: defaultLock.isActive,
  reason: defaultLock.reason,
  track: defaultLock.track,
  waitForWrites: defaultLock.waitForWrites,
};

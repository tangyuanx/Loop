/**
 * Loop -- data maintenance lock
 *
 * Importing or restoring a data set replaces the managed files in place, so the
 * renderer must not be able to write task data while that is happening. The lock
 * stays engaged after a successful import until the relaunch, because a late
 * debounced autosave would otherwise overwrite the freshly restored database.
 */

function createDataMaintenanceLock() {
  let depth = 0;
  let activeReason = "";
  const writes = new Set();

  function release() {
    depth = Math.max(0, depth - 1);
    if (depth === 0) activeReason = "";
  }

  function begin(reason = "data-restore") {
    depth += 1;
    activeReason = String(reason || "data-restore");
    return release;
  }

  function isActive() {
    return depth > 0;
  }

  function currentReason() {
    return activeReason;
  }

  function assertWritable() {
    if (depth > 0) {
      throw Object.assign(
        new Error("正在恢复或导入数据，已暂停写入以保护当前数据"),
        { code: "DATA_MAINTENANCE" },
      );
    }
  }

  async function track(operation) {
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

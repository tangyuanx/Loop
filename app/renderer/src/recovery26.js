// ============================================================
// Loop -- Phase26 · 删除与恢复 (Recently Deleted)
//
// Ported from the frozen Demo baseline:
//   prototypes/baseline/loop-plane-phase26-frozen/loop-plane-phase26.js
//   prototypes/baseline/loop-plane-phase26-frozen/loop-recovery-phase26.css
//
// The markup, class names, copy, sizes and interaction vocabulary are the
// Demo's, byte for byte. What is NOT the Demo's:
//
//   * the archive lives in the product's own store (`state.recentlyDeleted`,
//     persisted inside task-data.json) instead of a page-memory array;
//   * every object is addressed by its stable id (task / group / node /
//     noteId), never by title, and grouping uses `groupId`;
//   * a delete is one transaction: the archive entry and the removal of the
//     live object are written by the same atomic save, and both are rolled
//     back if that write fails;
//   * the Demo's review scaffolding (page-memory seed examples, "本 Demo
//     仅操作页面示例", the review bar) stays out.
//
// Entry points wired here: the task more-menu, the group menu, batch delete,
// the node-operations menu, the knowledge file menu, Settings → 数据, the
// empty task list, and the Today widget's quick-capture delete.
// ============================================================

const RECOVERY26_TYPES = { task: "任务", quick: "速记", group: "分组", node: "处理流节点", note: "知识笔记" };
const RECOVERY26_TITLE_MAX = 80;

let recovery26Active = "";
let recovery26Query = "";
let recovery26Filter = "all";
let recovery26Picked = new Set();
let recovery26Pending = null;
let recovery26Undo = null;
let recovery26ReturnFocus = null;
let recovery26Busy = false;
let recovery26LastGroupChoice = "";
let recovery26LastSourceChoice = "";

// ------------------------------------------------------------
// Local helpers (the project's own names for the Demo's scaffolding)
// ------------------------------------------------------------

const r26 = (selector) => document.querySelector(selector);
const r26Archive = () => (Array.isArray(state.recentlyDeleted) ? state.recentlyDeleted : []);
const r26Task = (taskId) => state.tasks.find((task) => task.id === taskId) || null;
const r26Group = (groupId) => state.taskGroups.find((group) => group.id === groupId) || null;
const r26IsQuick = (task) => shellTaskIsNote(task);
const r26Kind = (task) => (r26IsQuick(task) ? "quick" : "task");
const r26Flatten = (nodes) => flatten(nodes || []);
const r26GroupTitle = (groupId) => (groupId && r26Group(groupId) ? r26Group(groupId).title : "未分组");
const r26Icon = (entry) => shellIcon(entry.kind === "group" ? "folder" : entry.kind === "note" ? "note" : "tasks");
const r26TransactionId = () => `rd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const r26Escape = (value) => esc(value);

function r26Button(action, label, className = "button", extra = "") {
  return `<button type="button" class="${className}" data-recovery26="${action}" ${extra}>${label}</button>`;
}

/** Stable revision of a record, used to prove an object was untouched since. */
function r26Revision(record) {
  return JSON.stringify(record);
}

/** The Demo's "刚刚 / 今天 09:20 / 昨天 18:10" stamp, from a real timestamp. */
function r26Stamp(iso) {
  const date = safeDate(iso);
  if (!date) return "";
  const minutes = Math.round((loopNow().getTime() - date.getTime()) / 60000);
  if (minutes < 1) return "刚刚";
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const today = localDateKey(date) === loopTodayKey();
  if (today) return minutes < 60 ? `${minutes} 分钟前` : `今天 ${time}`;
  const yesterday = new Date(loopNow().getTime() - 86400000);
  if (localDateKey(yesterday) === localDateKey(date)) return `昨天 ${time}`;
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${time}`;
}

function r26NodeCountLabel(task) {
  const total = r26Flatten(task?.nodes).length;
  return `${total} 个节点${String(task?.notes || "").trim() ? " · 含知识笔记" : ""}`;
}

/** The Demo's summary line for a task/quick entry. */
function r26TaskSummary(record) {
  const nodes = r26Flatten(record?.nodes).length;
  return `${nodes} 个节点${String(record?.notes || "").trim() ? " · 含知识笔记" : ""}`;
}

/** The Demo's excerpt source per kind. */
function r26Excerpt(entry) {
  if (entry.kind === "note") return entry.body || "";
  if (entry.kind === "node") return entry.record?.note || "";
  if (entry.kind === "group") {
    return entry.policy === "delete" ? entry.members.map((member) => member.record.title).join("\n") : "";
  }
  const record = entry.record || {};
  return record.description || record.hypothesis || record.notes || "";
}

// ------------------------------------------------------------
// Capture, transaction and receipt
// ------------------------------------------------------------

/**
 * Fold every mounted editor and node-record draft into the model before a
 * snapshot is taken. Without this a delete would archive stale text.
 */
function recovery26Capture() {
  try { captureMountedMilkdownDrafts(); } catch (error) { /* no editor mounted */ }
  try { flushNodeNoteDrafts({ persist: false }); } catch (error) { /* nothing pending */ }
}

/** Persist the current model and report whether it really reached disk. */
async function recovery26Persist() {
  save();
  if (typeof flushSave !== "function") return true;
  Recovery26Persisting = true;
  try {
    return (await flushSave()) !== false;
  } finally {
    Recovery26Persisting = false;
  }
}

// A deletion transaction reports write errors in its decision dialog.
// Suppress the ordinary footer error while that transaction is in flight.
let Recovery26Persisting = false;

/**
 * Run a delete or a restore as one transaction: snapshot what will change,
 * mutate, persist, and roll the whole model back if the write failed. Nothing
 * is reported as successful before the data is on disk.
 */
async function recovery26Transaction(mutate) {
  const before = snapshotRecovery26State();
  let outcome;
  try {
    outcome = mutate();
  } catch (error) {
    restoreRecovery26State(before);
    console.error("[recovery26] transaction threw", error);
    return { ok: false, message: "操作未完成，内容保持不变" };
  }
  if (outcome?.ok === false) {
    restoreRecovery26State(before);
    return outcome;
  }
  let persisted = false;
  try {
    persisted = await recovery26Persist();
  } catch (error) {
    console.error("[recovery26] persistence threw", error);
  }
  if (!persisted) {
    restoreRecovery26State(before);
    // flushSave keeps failed writes queued. Replace that payload with the
    // rolled-back model before a retry, quit flush or later edit can write it.
    // Keep this rollback queued even if synchronous browser storage fails.
    if (typeof pendingPayload !== "undefined") pendingPayload = null;
    try { save(); } catch (error) { console.error("[recovery26] rollback save failed", error); }
    return { ok: false, message: "未能写入本地数据，内容保持不变" };
  }
  return outcome || { ok: true };
}

function snapshotRecovery26State() {
  return {
    tasks: structuredClone(state.tasks),
    taskGroups: structuredClone(state.taskGroups),
    recentlyDeleted: structuredClone(state.recentlyDeleted || []),
    workNavigation: structuredClone(state.workNavigation),
    activeTaskId: state.activeTaskId,
    selectedNodeId: state.selectedNodeId,
    activeGroupId: state.activeGroupId,
    recordDraft: state.recordDraft,
    nodeDetailFullscreen: state.nodeDetailFullscreen,
    nodeDetailPosition: state.nodeDetailPosition,
  };
}

function restoreRecovery26State(before) {
  state.tasks = before.tasks;
  state.taskGroups = before.taskGroups;
  state.recentlyDeleted = before.recentlyDeleted;
  state.workNavigation = before.workNavigation;
  state.activeTaskId = before.activeTaskId;
  state.selectedNodeId = before.selectedNodeId;
  state.activeGroupId = before.activeGroupId;
  state.recordDraft = before.recordDraft;
  state.nodeDetailFullscreen = before.nodeDetailFullscreen;
  state.nodeDetailPosition = before.nodeDetailPosition;
}

/** Append one archive entry, newest first, bounded like storage.cjs does. */
function recovery26Archive(entry) {
  const record = {
    id: `rd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    deletedAt: new Date().toISOString(),
    ...entry,
  };
  r26Archive().unshift(record);
  if (state.recentlyDeleted.length > RECENTLY_DELETED_LIMIT) {
    state.recentlyDeleted.length = RECENTLY_DELETED_LIMIT;
  }
  return record;
}

function recovery26RemoveArchive(entry) {
  const list = r26Archive();
  // A failed sibling transaction replaces the archive with cloned objects.
  // Identity is the stable archive id, never the pre-rollback object reference.
  const index = list.findIndex((item) => item.id === entry.id);
  if (index >= 0) list.splice(index, 1);
  recovery26Picked.delete(entry.id);
}

/** The Demo's receipt: message, optional Undo, optional Recently Deleted. */
function recovery26Receipt(message, entries = [], action = null) {
  recovery26Undo = action || (entries.length
    ? () => recovery26RestoreMany(entries.map((entry) => entry.id), { restoreMoved: true })
    : null);
  const undo = recovery26Undo;
  const actions = `${undo ? r26Button("undo", "撤销", "text-button") : ""}${entries.length ? r26Button("open", "最近删除", "text-button") : ""}`;
  showWorkspaceFeedback(message, actions, { source: "recovery", onDismiss: () => {
    if (recovery26Undo === undo) recovery26Undo = null;
  } });
}

// ------------------------------------------------------------
// Unified confirmation surface (the Demo's `.recovery26-confirm`)
// ------------------------------------------------------------

function recovery26OpenConfirm(title, body, footer, { form = false } = {}) {
  if (typeof shellCloseOverlay === "function") shellCloseOverlay({ restoreFocus: false });
  state.taskMenuOpen = false;
  state.contextMenu = null;
  recovery26ReturnFocus = document.activeElement;
  const tag = form ? "form" : "section";
  const overlay = r26("#overlay");
  if (!overlay) return;
  overlay.innerHTML = `<div class="dialog-backdrop"><${tag} class="dialog recovery26-confirm" ${form ? 'id="recovery26-delete-form"' : ""} role="dialog" aria-modal="true" aria-label="${r26Escape(title)}">${shellSurfaceHeader(title)}${body}<footer>${footer}</footer></${tag}></div>`;
  const focus = r26("#overlay .recovery26-confirm [autofocus]") || r26("#overlay .recovery26-confirm button, #overlay .recovery26-confirm input, #overlay .recovery26-confirm select");
  focus?.focus({ preventScroll: true });
}

// ------------------------------------------------------------
// Delete: records (task / quick capture), single or batch
// ------------------------------------------------------------

/**
 * The one confirmation every record delete goes through (single task, quick
 * capture, widget quick capture and batch selection).
 */
function recovery26ReviewDelete(ids) {
  recovery26Capture();
  const tasks = ids.map(r26Task).filter(Boolean);
  if (!tasks.length) return false;
  recovery26Pending = { mode: "records", ids: tasks.map((task) => task.id) };
  state.taskMenuOpen = false;
  state.contextMenu = null;
  const single = tasks.length === 1;
  const task = tasks[0];
  const noun = single ? (r26IsQuick(task) ? "速记" : "任务") : "所选记录";
  const name = single ? task.title || `未命名${noun}` : `${tasks.length} 项记录`;
  const impact = single
    ? `${noun}的简报、处理流、知识笔记和历史会一起保留。`
    : "所选记录及其简报、处理流、知识笔记和历史会一起保留。";
  const list = single ? "" : `<ul class="recovery26-impact-list">${tasks.map((item) => `<li>${r26Escape(item.title || "未命名记录")}<small>${r26Escape(r26GroupTitle(item.groupId))} · ${r26Escape(r26IsQuick(item) ? "速记" : r26NodeCountLabel(item))}</small></li>`).join("")}</ul>`;
  recovery26OpenConfirm(
    `删除${noun}？`,
    `<p><strong>${r26Escape(name)}</strong></p>
     <p class="recovery26-hint">${r26Escape(impact)}</p>
     ${list}
     <p class="recovery26-hint">可在最近删除中恢复。磁盘中的笔记文件和附件会保留。</p>`,
    r26Button("cancel", "取消") + r26Button("commit-delete", "移到最近删除", "button danger-action"),
    { form: true },
  );
  return true;
}

function recovery26DeleteRecords(ids) {
  const tasks = ids.map(r26Task).filter(Boolean);
  if (!tasks.length) return { ok: false, message: "记录已不存在" };
  const transactionId = r26TransactionId();
  const entries = [];
  for (const task of tasks) {
    const position = state.tasks.indexOf(task);
    entries.push(recovery26Archive({
      kind: r26Kind(task),
      transactionId,
      objectId: task.id,
      title: task.title || "未命名记录",
      groupId: task.groupId || "",
      groupTitle: r26GroupTitle(task.groupId),
      position: position + 1,
      record: structuredClone(task),
      noteId: task.knowledgeNote?.noteId || task.id,
    }));
  }
  const removed = new Set(tasks.map((task) => task.id));
  state.tasks = state.tasks.filter((task) => !removed.has(task.id));
  const navigation = normalizeCurrentWorkNavigation();
  for (const taskId of removed) {
    if (navigation.runtime.activeWorkTaskId === taskId) navigation.runtime.activeWorkTaskId = "";
    if (navigation.runtime.activeGrowthTaskId === taskId) navigation.runtime.activeGrowthTaskId = "";
  }
  for (const task of tasks) recovery26ReleaseTaskResources(task);
  reorder(state.tasks);
  if (removed.has(state.activeTaskId)) {
    state.activeTaskId = "";
    state.selectedNodeId = "";
    state.recordDraft = "";
  }
  return { ok: true, entries };
}

/** Release everything that points at a task that is leaving the live model. */
function recovery26ReleaseTaskResources(task) {
  const noteId = task.knowledgeNote?.noteId || task.id;
  try { discardMountedKnowledgeEditor(task.id); } catch (error) { /* no editor mounted */ }
  try { discardPendingKnowledgeRecovery?.(noteId); } catch (error) { /* nothing pending */ }
  try { knowledgeExternalSnapshots?.delete(noteId); } catch (error) { /* optional in this build */ }
  try { delete state.knowledgeFileIssues?.[noteId]; } catch (error) { /* optional in this build */ }
  if (task.knowledgeNote?.filePath && desktopKnowledgeFile?.unwatch) {
    void desktopKnowledgeFile.unwatch({ noteId });
  }
}

// ------------------------------------------------------------
// Delete: a flow node and its whole subtree
// ------------------------------------------------------------

function recovery26ReviewDeleteNode(taskId, nodeId) {
  recovery26Capture();
  const task = r26Task(taskId);
  const node = task ? findNode(task.nodes, nodeId) : null;
  if (!task || !node) return false;
  recovery26Pending = { mode: "node", taskId, nodeId, ids: [taskId] };
  state.taskMenuOpen = false;
  state.contextMenu = null;
  const children = r26Flatten(node.children).length;
  const impact = children
    ? `包含当前节点及 ${children} 个子节点和所有处理记录。`
    : "包含当前节点和所有处理记录。";
  recovery26OpenConfirm(
    "删除节点？",
    `<p><strong>${r26Escape(node.title || "未命名节点")}</strong></p>
     <p class="recovery26-hint">${r26Escape(impact)}</p>
     <p class="recovery26-hint">可在最近删除中恢复。所属任务、其它节点与磁盘文件不受影响。</p>`,
    r26Button("cancel", "取消") + r26Button("commit-delete", "移到最近删除", "button danger-action"),
    { form: true },
  );
  return true;
}

/** Locate a node inside a task tree: its parent, its sibling list and index. */
function recovery26NodeLocation(nodes, nodeId) {
  for (let index = 0; index < (nodes || []).length; index += 1) {
    const node = nodes[index];
    if (node.id === nodeId) return { parent: null, siblings: nodes, index, node };
    const hit = recovery26NodeLocation(node.children, nodeId);
    if (hit) return { parent: hit.parent || node, siblings: hit.siblings, index: hit.index, node: hit.node };
  }
  return null;
}

function recovery26DeleteNode(taskId, nodeId) {
  const task = r26Task(taskId);
  const located = task ? recovery26NodeLocation(task.nodes, nodeId) : null;
  if (!task || !located) return { ok: false, message: "节点已不存在" };
  const subtree = r26Flatten([located.node]);
  const entry = recovery26Archive({
    kind: "node",
    transactionId: r26TransactionId(),
    objectId: located.node.id,
    title: located.node.title || "未命名节点",
    ownerTaskId: task.id,
    ownerTaskTitle: task.title || "未命名任务",
    groupId: task.groupId || "",
    groupTitle: r26GroupTitle(task.groupId),
    parentNodeId: located.parent?.id || "",
    parentNodeTitle: located.parent?.title || "",
    position: located.index + 1,
    nodeCount: subtree.length,
    record: structuredClone(located.node),
  });
  located.siblings.splice(located.index, 1);
  reorder(located.siblings);
  task.updatedAt = now();
  // No dangling selection, detail pane or draft may point at the removed ids.
  const removedIds = new Set(subtree.map((item) => item.id));
  if (removedIds.has(state.selectedNodeId)) {
    state.selectedNodeId = "";
    state.recordDraft = "";
    state.nodeDetailFullscreen = false;
    state.nodeDetailPosition = null;
  }
  if (state.focusNodeTitleId && removedIds.has(state.focusNodeTitleId)) state.focusNodeTitleId = "";
  for (const id of removedIds) {
    try { nodeNoteDrafts?.delete(noteDraftKey(task.id, id)); } catch (error) { /* optional */ }
    window.clearTimeout(nodeNoteSaveTimers?.get(noteDraftKey(task.id, id)));
    try { nodeNoteSaveTimers?.delete(noteDraftKey(task.id, id)); } catch (error) { /* optional */ }
  }
  return { ok: true, entries: [entry] };
}

// ------------------------------------------------------------
// Delete: a group, with the Demo's two policies and growth-source choice
// ------------------------------------------------------------

function recovery26ReviewDeleteGroup(groupId) {
  recovery26Capture();
  const group = r26Group(groupId);
  if (!group) return false;
  const members = state.tasks.filter((task) => (task.groupId || "") === groupId);
  const wasGrowthSource = normalizeCurrentWorkNavigation().config.growth.sourceGroupId === groupId;
  const targets = state.taskGroups.filter((item) => item.id !== groupId);
  const target = targets.some((item) => item.id === recovery26LastGroupChoice) ? recovery26LastGroupChoice : "";
  const replacement = targets.some((item) => item.id === recovery26LastSourceChoice) ? recovery26LastSourceChoice : "";
  recovery26Pending = { mode: "group", groupId, ids: members.map((task) => task.id) };
  state.taskMenuOpen = false;
  state.contextMenu = null;
  const options = (list, current) => list.map((item) => `<option value="${r26Escape(item.id)}" ${item.id === current ? "selected" : ""}>${r26Escape(item.title)}</option>`).join("");
  const totalNodes = r26Flatten(members.flatMap((task) => task.nodes)).length;
  recovery26OpenConfirm(
    "删除分组？",
    `<p><strong>${r26Escape(group.title)}</strong></p>
     <p class="recovery26-hint">${members.filter((task) => !r26IsQuick(task)).length} 个任务 · ${members.filter(r26IsQuick).length} 条速记</p>
     <label class="recovery26-option"><input type="radio" name="groupPolicy26" value="keep" checked><span>保留其中的内容<small>任务与速记移到下方选择的分组，处理流与知识笔记保持。</small></span></label>
     <div class="recovery26-field" id="recovery26-target-field"><label for="recovery26-target">移动到</label><select id="recovery26-target"><option value="" ${target === "" ? "selected" : ""}>未分组</option>${options(targets, target)}</select>${totalNodes ? `<p class="recovery26-hint">其中 ${totalNodes} 个处理流节点会随记录一起保留。</p>` : ""}</div>
     <label class="recovery26-option"><input type="radio" name="groupPolicy26" value="delete"><span>同时删除其中的内容<small>连同分组一起进入最近删除，可整体恢复。</small></span></label>
     ${wasGrowthSource ? `<div class="recovery26-field"><label for="recovery26-source">此分组是增长模式来源</label><select id="recovery26-source"><option value="">选择新的来源或停止增长</option><option value="stop" ${replacement === "stop" ? "selected" : ""}>停止增长</option>${options(targets, replacement)}</select></div>` : ""}
     <p class="recovery26-error" id="recovery26-error" role="alert"></p>`,
    r26Button("cancel", "取消") + r26Button("commit-delete", "删除分组", "button danger-action"),
    { form: true },
  );
  return true;
}

function recovery26DeleteGroup(groupId, { policy = "keep", targetGroupId = "", replacement = null } = {}) {
  const group = r26Group(groupId);
  if (!group) return { ok: false, message: "分组已不存在" };
  const remove = policy === "delete";
  const navigation = normalizeCurrentWorkNavigation();
  const wasGrowthSource = navigation.config.growth.sourceGroupId === groupId;
  if (wasGrowthSource && replacement === null) return { ok: false, message: "请选择新的来源或停止增长" };
  const members = state.tasks.filter((task) => (task.groupId || "") === groupId);
  const entry = recovery26Archive({
    kind: "group",
    transactionId: r26TransactionId(),
    objectId: group.id,
    groupId: group.id,
    title: group.title,
    groupOrder: group.order || state.taskGroups.indexOf(group) + 1,
    policy: remove ? "delete" : "keep",
    targetGroupId: remove ? "" : (targetGroupId || ""),
    wasGrowthSource,
    groupReplacementId: wasGrowthSource ? (replacement === "stop" ? "" : replacement || "") : "",
    members: remove
      ? members.map((task) => ({
        record: structuredClone(task),
        position: state.tasks.indexOf(task) + 1,
        groupId: task.groupId || "",
      }))
      : [],
    migrated: [],
  });
  if (remove) {
    const removed = new Set(members.map((task) => task.id));
    state.tasks = state.tasks.filter((task) => !removed.has(task.id));
    for (const task of members) recovery26ReleaseTaskResources(task);
    if (removed.has(state.activeTaskId)) {
      state.activeTaskId = "";
      state.selectedNodeId = "";
      state.recordDraft = "";
    }
  } else {
    for (const task of members) {
      task.groupId = targetGroupId || "";
      task.updatedAt = now();
      entry.migrated.push({
        taskId: task.id,
        direction: "ungrouped",
        revision: r26Revision(task),
      });
    }
  }
  state.taskGroups = state.taskGroups.filter((item) => item.id !== groupId);
  state.taskGroups = normalizeTaskGroups(state.taskGroups, state.tasks);
  if (wasGrowthSource) {
    const next = normalizeCurrentWorkNavigation();
    next.config.growth.sourceGroupId = replacement === "stop" ? "" : replacement || "";
    if (!next.config.growth.sourceGroupId) next.runtime.activeGrowthTaskId = "";
    state.workNavigation = next;
  }
  if (state.activeGroupId === groupId) {
    state.activeGroupId = remove ? ALL_TASKS_GROUP_ID : (targetGroupId || UNGROUPED_TASKS_GROUP_ID);
    state.activeTaskId = tasksInActiveGroup()[0]?.id || "";
    state.selectedNodeId = "";
  }
  state.editingGroupId = "";
  state.focusGroupTitleId = "";
  return { ok: true, entries: [entry] };
}

// ------------------------------------------------------------
// Delete: knowledge note (unlink the binding / remove the note body)
// ------------------------------------------------------------

function recovery26ReviewUnlinkNote(taskId) {
  recovery26Capture();
  const task = r26Task(taskId);
  const note = task?.knowledgeNote;
  if (!task || !note?.filePath) return false;
  recovery26Pending = {
    mode: "unlink",
    ids: [task.id],
    body: String(task.notes || ""),
    before: structuredClone(note),
  };
  state.taskMenuOpen = false;
  state.contextMenu = null;
  recovery26OpenConfirm(
    "解除文件关联？",
    `<p class="recovery26-hint">保留当前正文，转为未落盘草稿。磁盘文件不会被修改。</p>
     <p>${r26Escape(note.filePath)}</p>`,
    r26Button("cancel", "取消") + r26Button("unlink-confirm", "解除关联", "button primary"),
    { form: true },
  );
  return true;
}

function recovery26UnlinkNote(taskId) {
  const task = r26Task(taskId);
  const note = task?.knowledgeNote;
  if (!task || !note?.filePath) return { ok: false, message: "文件关联已不存在" };
  const before = {
    noteId: note.noteId || task.id,
    knowledgeNote: structuredClone(note),
    filePath: note.filePath,
    body: String(task.notes || ""),
  };
  if (desktopKnowledgeFile?.unwatch) void desktopKnowledgeFile.unwatch({ noteId: before.noteId });
  try { knowledgeExternalSnapshots?.delete(before.noteId); } catch (error) { /* optional */ }
  task.knowledgeNote = knowledgeDocument.normalizeKnowledgeNote({
    ...note,
    filePath: null,
    documentState: "DRAFT",
    dirty: false,
    lastSavedHash: null,
    lastSavedMtime: null,
    updatedAt: now(),
  }, { taskId: task.id, title: task.title });
  task.updatedAt = now();
  // The body stays a draft; the binding can only come back while nothing about
  // the text or the file state changed.
  return { ok: true, entries: [], unlink: { taskId: task.id, before } };
}

/** Give the association back, but never over a later edit or a new binding. */
function recovery26UndoUnlink(payload) {
  const task = r26Task(payload.taskId);
  if (!task) {
    recovery26Receipt("所属任务已不存在，无法恢复文件关联");
    return;
  }
  const noteId = payload.before.noteId;
  if (String(task.notes || "") !== payload.before.body || task.knowledgeNote?.filePath) {
    recovery26Receipt("当前笔记已变更，请重新选择文件关联");
    return;
  }
  if (task.knowledgeNote?.noteId !== noteId) {
    recovery26Receipt("当前笔记已变更，请重新选择文件关联");
    return;
  }
  task.knowledgeNote = knowledgeDocument.normalizeKnowledgeNote(payload.before.knowledgeNote, {
    taskId: task.id,
    title: task.title,
  });
  task.updatedAt = now();
  render();
  void recovery26Persist();
  recovery26Receipt("文件关联已恢复");
}

function recovery26ReviewRemoveNote(taskId) {
  recovery26Capture();
  const task = r26Task(taskId);
  if (!task || !String(task.notes || "").trim()) return false;
  recovery26Pending = { mode: "note", ids: [task.id] };
  state.taskMenuOpen = false;
  state.contextMenu = null;
  recovery26OpenConfirm(
    "移除软件内笔记？",
    `<p><strong>${r26Escape(task.title || "未命名任务")}</strong></p>
     <p class="recovery26-hint">当前正文将进入最近删除，软件内的文件关联会解除。磁盘中的 Markdown 和附件会保留。</p>`,
    r26Button("cancel", "取消") + r26Button("commit-delete", "移到最近删除", "button danger-action"),
    { form: true },
  );
  return true;
}

function recovery26RemoveNote(taskId) {
  recovery26Capture();
  const task = r26Task(taskId);
  if (!task || !String(task.notes || "").trim()) return { ok: false, message: "这篇笔记没有正文" };
  const noteId = task.knowledgeNote?.noteId || task.id;
  discardMountedKnowledgeEditor(task.id);
  const entry = recovery26Archive({
    kind: "note",
    transactionId: r26TransactionId(),
    objectId: noteId,
    title: `${task.title || "未命名任务"} · 知识笔记`,
    ownerTaskId: task.id,
    ownerTaskTitle: task.title || "未命名任务",
    groupId: task.groupId || "",
    groupTitle: r26GroupTitle(task.groupId),
    body: String(task.notes || ""),
    sourcePath: task.knowledgeNote?.filePath || "",
    knowledgeNote: structuredClone(task.knowledgeNote || null),
    hadFileBinding: Boolean(task.knowledgeNote?.filePath),
  });
  if (task.knowledgeNote?.filePath && desktopKnowledgeFile?.unwatch) {
    void desktopKnowledgeFile.unwatch({ noteId });
  }
  try { discardPendingKnowledgeRecovery?.(noteId); } catch (error) { /* nothing pending */ }
  try { knowledgeExternalSnapshots?.delete(noteId); } catch (error) { /* optional */ }
  void clearKnowledgeRecoveryRecord(noteId);
  task.notes = "";
  task.knowledgeNote = knowledgeDocument.normalizeKnowledgeNote({
    ...(task.knowledgeNote || {}),
    isDeleted: true,
    filePath: null,
    documentState: "DRAFT",
    dirty: false,
    lastSavedHash: null,
    lastSavedMtime: null,
    updatedAt: now(),
  }, { taskId: task.id, title: task.title });
  task.updatedAt = now();
  return { ok: true, entries: [entry] };
}

// ------------------------------------------------------------
// Commit: the Demo's single "commit-delete" action
// ------------------------------------------------------------

async function recovery26CommitDelete() {
  const pending = recovery26Pending;
  if (!pending || recovery26Busy) return;
  if (pending.mode === "group") {
    const group = r26Group(pending.groupId);
    if (!group) return;
    const replacementSelect = r26("#recovery26-source");
    const replacement = replacementSelect ? replacementSelect.value : null;
    const wasGrowthSource = normalizeCurrentWorkNavigation().config.growth.sourceGroupId === pending.groupId;
    if (wasGrowthSource && !replacement) {
      const error = r26("#recovery26-error");
      if (error) error.textContent = "请选择新的来源或停止增长";
      return;
    }
    const policy = r26('input[name="groupPolicy26"]:checked')?.value === "delete" ? "delete" : "keep";
    const target = r26("#recovery26-target")?.value || "";
    recovery26LastGroupChoice = target;
    recovery26LastSourceChoice = wasGrowthSource ? replacement : recovery26LastSourceChoice;
    recovery26Busy = true;
    const outcome = await recovery26Transaction(() => recovery26DeleteGroup(pending.groupId, {
      policy,
      targetGroupId: target,
      replacement: wasGrowthSource ? replacement : null,
    }));
    recovery26Busy = false;
    if (!outcome.ok) {
      recovery26ShowConfirmError(outcome.message);
      return;
    }
    if (recovery26Pending === pending) recovery26Pending = null;
    recovery26AfterRemoval(outcome.entries, outcome.entries.length === 1 ? "1 项已移到最近删除" : `${outcome.entries.length} 项已移到最近删除`);
    return;
  }
  if (pending.mode === "records") {
    recovery26Busy = true;
    const outcome = await recovery26Transaction(() => recovery26DeleteRecords(pending.ids));
    recovery26Busy = false;
    if (!outcome.ok) {
      recovery26ShowConfirmError(outcome.message);
      return;
    }
    if (recovery26Pending === pending) recovery26Pending = null;
    if (pending.ids.length > 1 && typeof shellBulkStop === "function") shellBulkStop();
    recovery26AfterRemoval(outcome.entries, `${outcome.entries.length} 项已移到最近删除`);
    return;
  }
  if (pending.mode === "node") {
    recovery26Busy = true;
    const outcome = await recovery26Transaction(() => recovery26DeleteNode(pending.taskId, pending.nodeId));
    recovery26Busy = false;
    if (!outcome.ok) {
      recovery26ShowConfirmError(outcome.message);
      return;
    }
    if (recovery26Pending === pending) recovery26Pending = null;
    recovery26AfterRemoval(outcome.entries, "1 项已移到最近删除");
    return;
  }
  if (pending.mode === "note") {
    recovery26Busy = true;
    const outcome = await recovery26Transaction(() => recovery26RemoveNote(pending.ids[0]));
    recovery26Busy = false;
    if (!outcome.ok) {
      recovery26ShowConfirmError(outcome.message);
      return;
    }
    if (recovery26Pending === pending) recovery26Pending = null;
    recovery26AfterRemoval(outcome.entries, "1 项已移到最近删除");
  }
}

function recovery26ShowConfirmError(message) {
  const host = r26("#recovery26-error");
  if (host) {
    host.textContent = message || "操作未完成";
    return;
  }
  recovery26Receipt(message || "操作未完成");
}

/** Close the confirmation, resync the workspace, then report the result. */
function recovery26AfterRemoval(entries, message) {
  if (typeof shellCloseOverlay === "function") shellCloseOverlay({ restoreFocus: false });
  state.taskMenuOpen = false;
  state.contextMenu = null;
  if (!state.tasks.some((task) => task.id === state.activeTaskId)) {
    state.activeTaskId = state.tasks[0]?.id || "";
    state.selectedNodeId = "";
  }
  render();
  // The receipt keeps the Demo's 12-second 撤销, backed by the same validated
  // restore the manager uses. The archive itself never expires, so losing the
  // receipt only loses the shortcut, never the record.
  recovery26Receipt(message, entries, () => recovery26UndoEntries(entries));
}

// ------------------------------------------------------------
// Restore rules
// ------------------------------------------------------------

/**
 * The receipt's 撤销 is a *restore*, not a second delete path: it runs the same
 * validated restore as 最近删除 (including the group rules about members and
 * about content that was moved and later changed), then re-reports the result.
 */
function recovery26UndoEntries(entries) {
  const ids = (entries || []).map((entry) => entry.id);
  if (!ids.length) return Promise.resolve();
  return recovery26RestoreMany(ids, { restoreMoved: true }).then((results) => {
    render();
    if (results.some((result) => !result.ok)) {
      recovery26ShowResults(results);
      return;
    }
    recovery26Receipt(results.length === 1 ? results[0].message : `已恢复 ${results.length} 项`);
  });
}

/** Everything that blocks a restore of this entry, in the Demo's wording. */
function recovery26RestoreProblem(entry) {
  if (entry.kind === "task" || entry.kind === "quick") {
    // A stable id is never overwritten or silently merged.
    return r26Task(entry.record?.id) ? "此记录已存在，未覆盖现有内容。" : "";
  }
  if (entry.kind === "node") {
    const task = r26Task(entry.ownerTaskId);
    if (!task) return "所属任务已删除，请先恢复任务。";
    const ids = new Set(r26Flatten(task.nodes).map((node) => node.id));
    return r26Flatten([entry.record]).some((node) => ids.has(node.id))
      ? "现有处理流中已存在同 ID 节点，未覆盖现有内容。"
      : "";
  }
  if (entry.kind === "group") {
    if (entry.groupId && r26Group(entry.groupId)) return "此分组已存在，未覆盖现有内容。";
    if (entry.members.some((member) => r26Task(member.record?.id))) {
      return "组内有记录已存在，需先处理冲突再整体恢复。";
    }
    return "";
  }
  return "";
}

function recovery26RestoreTarget(entry) {
  const groupId = entry.groupId || "";
  if (groupId && r26Group(groupId)) return groupId;
  return "";
}

/**
 * A note whose owner is gone (or already has text) becomes a copy in a new
 * task: the existing text is never overwritten, and the new task starts with
 * no flow, schedule, deadline, reminder or recurrence from the old one.
 */
function recovery26NewNoteTask(entry) {
  const taskId = id("task");
  const groupId = entry.groupId && r26Group(entry.groupId) ? entry.groupId : "";
  const task = {
    id: taskId,
    order: state.tasks.length + 1,
    todayTaskOrder: 0,
    todayQuickCaptureOrder: 0,
    groupId,
    title: `${entry.ownerTaskTitle || "未命名任务"} · 恢复的笔记`,
    knowledgeNote: knowledgeDocument.createKnowledgeNoteMetadata({
      noteId: taskId,
      taskId,
      title: `${entry.ownerTaskTitle || "未命名任务"} · 恢复的笔记`,
      createdAt: now(),
      updatedAt: now(),
    }),
    description: "",
    status: "active",
    priority: "medium",
    tags: { today: false, later: false, blocked: false },
    recurrence: normalizeTaskRecurrence(null),
    notes: entry.body || "",
    hypothesis: "",
    hypothesisUpdatedAt: "",
    conclusion: "",
    history: [[r26Stamp(new Date().toISOString()), "从最近删除恢复笔记"]],
    navigationRecovery: workNavigationModel.normalizeRecovery(null),
    estimateMinutes: 0,
    origin: null,
    createdAt: now(),
    updatedAt: now(),
    deadlineAt: "",
    // A restore does not re-fire an old reminder or start work/growth; the note
    // arrives as a draft and the deadline is simply absent until it is set
    // again through the existing entry points.
    deadlineReminderMinutes: null,
    resolvedAt: "",
    nodes: [],
  };
  state.tasks.push(task);
  reorder(state.tasks);
  // The note text is protected as an unsaved draft, exactly like a new note.
  try {
    scheduleKnowledgeRecovery(taskId, task.notes);
  } catch (error) { /* recovery is optional in this build */ }
  return task;
}

/**
 * Restore one archive entry in place. `restoreMoved` is the immediate Undo
 * path: only then may content that the delete moved away be moved back, and
 * only while it is provably unchanged.
 */
function recovery26RestoreEntry(entry, { target = "", name = "", restoreMoved = false } = {}) {
  const problem = recovery26RestoreProblem(entry);
  if (problem) return { ok: false, title: entry.title, message: problem };
  let message = "已恢复";
  if (entry.kind === "task" || entry.kind === "quick") {
    const record = normalizeTasks([structuredClone(entry.record)])[0];
    const resolved = (target && r26Group(target)) ? target : recovery26RestoreTarget(entry);
    record.groupId = resolved;
    record.updatedAt = now();
    state.tasks.splice(Math.min(Math.max(0, (entry.position || 1) - 1), state.tasks.length), 0, record);
    reorder(state.tasks);
    if (String(record.notes || "").trim() && record.knowledgeNote?.documentState === "DRAFT") {
      try { scheduleKnowledgeRecovery(record.id, record.notes); } catch (error) { /* optional */ }
    }
    message = resolved === (entry.groupId || "") ? "已恢复到原分组" : `已恢复到 ${r26GroupTitle(resolved)}`;
  } else if (entry.kind === "node") {
    const task = r26Task(entry.ownerTaskId);
    if (!task) return { ok: false, title: entry.title, message: "所属任务已删除，请先恢复任务。" };
    const parent = entry.parentNodeId ? findNode(task.nodes, entry.parentNodeId) : null;
    const siblings = parent ? (parent.children = parent.children || []) : task.nodes;
    const record = normalizeNodes([structuredClone(entry.record)], task.id, parent?.id || null)[0];
    siblings.splice(Math.min(Math.max(0, (entry.position || 1) - 1), siblings.length), 0, record);
    reorder(siblings);
    task.updatedAt = now();
    if (entry.parentNodeId && !parent) {
      message = "原父节点已不存在，已恢复到处理流根层";
    } else {
      message = "节点已恢复";
    }
  } else if (entry.kind === "group") {
    // An empty inline input falls back to the archived name; `??` would not,
    // because an empty string is not nullish.
    const title = String(name || entry.title || "").trim();
    if (!title) return { ok: false, title: entry.title, message: "请输入分组名称" };
    if (state.taskGroups.some((group) => group.title === title)) {
      return { ok: false, title: entry.title, message: "分组名称已存在，请修改名称" };
    }
    const group = { id: entry.groupId || id("group"), title, order: entry.groupOrder || state.taskGroups.length + 1 };
    state.taskGroups.splice(Math.min(Math.max(0, (entry.groupOrder || 1) - 1), state.taskGroups.length), 0, group);
    state.taskGroups = normalizeTaskGroups(state.taskGroups, state.tasks);
    // Only an archive that removed its members restores them. An archive that
    // kept them restores the group structure alone.
    let restored = 0;
    for (const member of entry.members || []) {
      if (r26Task(member.record.id)) continue;
      const record = normalizeTasks([structuredClone(member.record)])[0];
      record.groupId = group.id;
      record.updatedAt = now();
      state.tasks.splice(Math.min(Math.max(0, (member.position || 1) - 1), state.tasks.length), 0, record);
      restored += 1;
    }
    reorder(state.tasks);
    let returned = 0;
    if (restoreMoved) {
      for (const item of entry.migrated || []) {
        const task = r26Task(item.taskId);
        if (!task || r26Revision(task) !== item.revision) continue;
        task.groupId = group.id;
        task.updatedAt = now();
        returned += 1;
      }
    }
    // 恢复分组 does not restart growth and does not reselect a source.
    message = restored
      ? `已恢复分组及 ${restored} 项内容`
      : returned
        ? "分组已恢复，未再次变更的内容已放回"
        : "分组已恢复，保留的内容仍在当前分组";
  } else if (entry.kind === "note") {
    const task = r26Task(entry.ownerTaskId);
    if (!task || String(task.notes || "").trim()) {
      const created = recovery26NewNoteTask(entry);
      message = `已恢复为新任务中的笔记副本：${created.title}`;
    } else {
      task.notes = entry.body || "";
      task.knowledgeNote = knowledgeDocument.normalizeKnowledgeNote({
        ...(entry.knowledgeNote || task.knowledgeNote || {}),
        filePath: null,
        documentState: "DRAFT",
        dirty: false,
        lastSavedHash: null,
        lastSavedMtime: null,
        updatedAt: now(),
      }, { taskId: task.id, title: task.title });
      task.updatedAt = now();
      try { scheduleKnowledgeRecovery(task.id, task.notes); } catch (error) { /* optional */ }
      message = "笔记已恢复为草稿";
    }
  } else {
    return { ok: false, title: entry.title, message: "未知的归档类型" };
  }
  recovery26RemoveArchive(entry);
  return { ok: true, title: entry.title, message };
}

/** Restore several entries, dependencies first, each one transactionally. */
async function recovery26RestoreMany(ids, { restoreMoved = false } = {}) {
  recovery26Capture();
  const order = ["group", "task", "quick", "note", "node"];
  const entries = ids
    .map((entryId) => r26Archive().find((entry) => entry.id === entryId))
    .filter(Boolean)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const results = [];
  for (const original of entries) {
    const entry = r26Archive().find((item) => item.id === original.id);
    if (!entry) continue;
    const outcome = await recovery26Transaction(() => recovery26RestoreEntry(entry, { restoreMoved }));
    results.push({ ok: outcome.ok, title: entry.title, message: outcome.message || "已恢复" });
  }
  // Dependency order is group -> task/quick -> note -> node, so a restored task
  // is already present by the time its archived node is put back.
  return results;
}

// ------------------------------------------------------------
// Recently Deleted manager (the Demo's `.recovery26-manager`)
// ------------------------------------------------------------

function recovery26Visible() {
  const query = recovery26Query.trim().toLowerCase();
  return r26Archive().filter((entry) => {
    if (recovery26Filter !== "all" && entry.kind !== recovery26Filter) return false;
    if (!query) return true;
    const haystack = `${entry.title || ""} ${entry.groupTitle || ""} ${entry.ownerTaskTitle || ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

function recovery26ManagerMarkup() {
  const filters = Object.entries(RECOVERY26_TYPES)
    .map(([value, label]) => `<option value="${value}" ${recovery26Filter === value ? "selected" : ""}>${label}</option>`)
    .join("");
  return `<div class="dialog-backdrop"><section class="dialog recovery26-manager" role="dialog" aria-modal="true" aria-label="最近删除">${shellSurfaceHeader("最近删除")}
    <div class="recovery26-toolbar"><label class="recovery26-search">${shellIcon("search")}<input id="recovery26-search" class="control22-field" aria-label="搜索最近删除" placeholder="搜索名称、分组或所属任务" value="${r26Escape(recovery26Query)}"></label><select id="recovery26-filter" aria-label="内容类型"><option value="all">全部类型</option>${filters}</select></div>
    <div class="recovery26-main"><div class="recovery26-list" aria-label="最近删除内容"></div><div class="recovery26-detail"></div></div>
    <footer><span class="recovery26-footer-count"></span>${r26Button("purge-selected", "清空…", "text-button danger-action")}${r26Button("restore-selected", "恢复所选", "button")}</footer>
  </section></div>`;
}

function recovery26Manager() {
  recovery26Capture();
  if (typeof shellCloseOverlay === "function") shellCloseOverlay({ restoreFocus: false });
  state.taskMenuOpen = false;
  state.contextMenu = null;
  recovery26ReturnFocus = document.activeElement;
  const overlay = r26("#overlay");
  if (!overlay) return;
  overlay.innerHTML = recovery26ManagerMarkup();
  recovery26DrawList();
  r26("#recovery26-search")?.focus({ preventScroll: true });
}

function recovery26DetailsMarkup(entry) {
  if (!entry) return '<p class="recovery26-empty">选择一项查看内容与恢复位置</p>';
  const error = recovery26RestoreProblem(entry);
  const owner = entry.ownerTaskId ? r26Task(entry.ownerTaskId) : null;
  const summary = entry.kind === "group"
    ? (entry.policy === "delete" ? `包含 ${entry.members.length} 项记录` : `${entry.migrated.length} 项内容保留在 ${r26GroupTitle(entry.targetGroupId)}`)
    : entry.kind === "node"
      ? `${r26Flatten([entry.record]).length} 个节点及处理记录`
      : entry.kind === "note"
        ? `${String(entry.body || "").length} 字符 · 正文快照`
        : r26TaskSummary(entry.record);
  const groupExists = entry.groupId && r26Group(entry.groupId);
  const target = groupExists ? entry.groupId : "";
  const missingGroup = Boolean(entry.groupId) && !groupExists;
  const options = (current) => `<option value="" ${current === "" ? "selected" : ""}>未分组</option>${state.taskGroups.map((group) => `<option value="${r26Escape(group.id)}" ${group.id === current ? "selected" : ""}>${r26Escape(group.title)}</option>`).join("")}`;
  let recovery = "";
  if (entry.kind === "task" || entry.kind === "quick") {
    recovery = `<div class="recovery26-field"><label for="recovery26-restore-target">恢复到分组</label><select id="recovery26-restore-target">${options(target)}</select></div>${missingGroup ? '<p class="recovery26-hint">原分组已不存在，默认恢复到未分组。</p>' : ""}`;
  }
  if (entry.kind === "group") {
    recovery = `<div class="recovery26-field"><label for="recovery26-group-name">分组名称</label><input id="recovery26-group-name" class="control22-field" maxlength="${RECOVERY26_TITLE_MAX}" value="${r26Escape(entry.title)}"></div>
      <p class="recovery26-hint">${entry.policy === "keep" ? "仅恢复分组；保留的内容维持当前位置。" : "同时恢复归档的任务与速记。"}${entry.wasGrowthSource ? "增长来源需另行选择，不会自动启动。" : ""}</p>`;
  }
  if (entry.kind === "node" && owner && entry.parentNodeId && !findNode(owner.nodes, entry.parentNodeId)) {
    recovery = '<p class="recovery26-notice">原父节点已不存在，将恢复到所属任务的处理流根层。</p>';
  }
  if (entry.kind === "note") {
    recovery = `<p class="recovery26-hint">${!owner ? "所属任务已删除，将恢复为新任务中的笔记副本。" : String(owner.notes || "").trim() ? "所属任务已有笔记，将恢复为新任务中的副本，保留现有正文。" : "恢复为未落盘草稿。"}原文件关联需重新选择。</p>`;
  }
  const ownerEntry = entry.kind === "node" && !owner
    ? r26Archive().find((item) => (item.kind === "task" || item.kind === "quick") && item.record?.id === entry.ownerTaskId)
    : null;
  const restoreLabel = entry.kind === "note" && (!owner || String(owner.notes || "").trim()) ? "恢复为副本" : "恢复";
  const excerpt = r26Excerpt(entry);
  return `<div class="recovery26-detailbody">
    <div class="recovery26-kind">${r26Icon(entry)}${RECOVERY26_TYPES[entry.kind]}</div>
    <h3>${r26Escape(entry.title)}</h3>
    <dl class="recovery26-meta"><dt>删除时间</dt><dd>${r26Escape(r26Stamp(entry.deletedAt))}</dd><dt>${entry.ownerTaskId ? "所属任务" : "原分组"}</dt><dd>${r26Escape(entry.ownerTaskTitle || entry.groupTitle || "未分组")}</dd><dt>包含内容</dt><dd>${r26Escape(summary)}</dd>${entry.sourcePath ? `<dt>原文件</dt><dd>${r26Escape(entry.sourcePath)}</dd>` : ""}</dl>
    ${excerpt ? `<div class="recovery26-excerpt">${r26Escape(String(excerpt).slice(0, 1200))}</div>` : ""}
    ${recovery}
    ${error ? `<p class="recovery26-notice">${r26Escape(error)}</p>` : ""}
    <p class="recovery26-error" id="recovery26-restore-error" role="alert"></p>
  </div>
  <div class="recovery26-actions">${r26Button("restore", restoreLabel, "button primary", error ? "disabled" : "")}${ownerEntry ? r26Button("owner", "先查看所属任务", "text-button", `data-id="${ownerEntry.id}"`) : ""}${r26Button("purge", "永久移除…", "text-button danger-action")}</div>`;
}

function recovery26DrawList() {
  const list = recovery26Visible();
  if (!list.some((entry) => entry.id === recovery26Active)) recovery26Active = list[0]?.id || "";
  const host = r26(".recovery26-list");
  if (!host) return;
  const archive = r26Archive();
  const all = list.length > 0 && list.every((entry) => recovery26Picked.has(entry.id));
  host.innerHTML = `<div class="recovery26-listhead"><input type="checkbox" id="recovery26-all" aria-label="选择当前结果" ${all ? "checked" : ""} ${list.length ? "" : "disabled"}><span>${list.length} 项</span></div>${list.length
    ? list.map((entry) => `<div class="recovery26-item" data-selected="${entry.id === recovery26Active}"><input type="checkbox" data-recovery26-check="${entry.id}" aria-label="选择 ${r26Escape(entry.title)}" ${recovery26Picked.has(entry.id) ? "checked" : ""}><button class="recovery26-record" type="button" data-recovery26="select" data-id="${entry.id}" aria-pressed="${entry.id === recovery26Active}">${r26Icon(entry)}<span><strong>${r26Escape(entry.title)}</strong><small>${RECOVERY26_TYPES[entry.kind]} · ${r26Escape(r26Stamp(entry.deletedAt))}</small></span></button></div>`).join("")
    : `<div class="recovery26-empty">${archive.length ? "没有匹配的内容" : "最近删除为空"}${archive.length ? `<div>${r26Button("clear-search", "清除筛选", "text-button")}</div>` : ""}</div>`}`;
  recovery26DrawDetail();
  recovery26UpdateFooter();
}

function recovery26DrawDetail() {
  const host = r26(".recovery26-detail");
  if (!host) return;
  const entry = r26Archive().find((item) => item.id === recovery26Active);
  host.innerHTML = recovery26DetailsMarkup(entry);
}

function recovery26UpdateFooter() {
  const count = recovery26Picked.size;
  const countHost = r26(".recovery26-footer-count");
  if (countHost) countHost.textContent = count ? `已选 ${count} 项` : "内容保留至手动移除";
  const restore = r26('[data-recovery26="restore-selected"]');
  const remove = r26('[data-recovery26="purge-selected"]');
  if (restore) {
    restore.disabled = !count;
    restore.textContent = `恢复所选${count ? ` ${count} 项` : ""}`;
  }
  if (remove) {
    remove.disabled = r26Archive().length === 0;
    remove.textContent = count ? "永久移除所选…" : "清空…";
  }
}

/** The Demo's restore-results dialog, used whenever something needs attention. */
function recovery26ShowResults(results) {
  const ok = results.filter((result) => result.ok).length;
  if (results.some((result) => !result.ok)) {
    recovery26OpenConfirm(
      "恢复结果",
      `<p>${ok} 项已恢复，${results.length - ok} 项需要处理。</p><ul class="recovery26-impact-list">${results.map((result) => `<li>${r26Escape(result.title)}<small>${r26Escape(result.message)}</small></li>`).join("")}</ul>`,
      r26Button("open", "返回最近删除", "button primary"),
    );
    return;
  }
  recovery26Manager();
  recovery26Receipt(results.length === 1 ? results[0].message : `已恢复 ${ok} 项`);
}

function recovery26RestoreActive() {
  const entry = r26Archive().find((item) => item.id === recovery26Active);
  if (!entry || recovery26Busy) return;
  recovery26Capture();
  const target = r26("#recovery26-restore-target")?.value || "";
  const name = r26("#recovery26-group-name")?.value ?? "";
  recovery26Busy = true;
  recovery26Transaction(() => recovery26RestoreEntry(entry, { target, name })).then((outcome) => {
    recovery26Busy = false;
    if (!outcome.ok) {
      const errorHost = r26("#recovery26-restore-error");
      if (errorHost) errorHost.textContent = outcome.message;
      const nameInput = r26("#recovery26-group-name");
      if (nameInput && entry.kind === "group") nameInput.setAttribute("aria-invalid", "true");
      const hasInlineError = Boolean(r26("#recovery26-restore-error") || r26("#recovery26-group-name"));
      if (!hasInlineError) recovery26Receipt(outcome.message);
      return;
    }
    render();
    recovery26Manager();
    recovery26Receipt(outcome.message);
  });
}

function recovery26PurgeReview(ids) {
  const list = ids.map((entryId) => r26Archive().find((entry) => entry.id === entryId)).filter(Boolean);
  if (!list.length) return;
  recovery26Pending = { mode: "purge", ids: list.map((entry) => entry.id) };
  const scope = list.length === 1 ? r26Escape(list[0].title) : `${list.length} 项内容`;
  recovery26OpenConfirm(
    "永久移除？",
    `<p>${scope}将从最近删除中移除。</p>
     <p class="recovery26-hint">此后无法通过最近删除恢复。磁盘文件、附件和已有备份会保留。</p>
     <label class="recovery26-option"><input id="recovery26-purge-agree" type="checkbox"><span>我确认永久移除这些软件内内容</span></label>
     <p class="recovery26-demo-note">仅清理 Loop 内的归档快照；磁盘文件、附件与已有备份会保留。</p>`,
    r26Button("cancel", "取消") + r26Button("purge-confirm", "永久移除", "button danger-action", "disabled"),
  );
}

async function recovery26PurgeConfirm() {
  const pending = recovery26Pending;
  if (!pending || pending.mode !== "purge" || recovery26Busy) return;
  if (!r26("#recovery26-purge-agree")?.checked) return;
  const ids = new Set(pending.ids);
  recovery26Busy = true;
  const outcome = await recovery26Transaction(() => {
    state.recentlyDeleted = r26Archive().filter((entry) => !ids.has(entry.id));
    for (const entryId of ids) recovery26Picked.delete(entryId);
    return { ok: true };
  });
  recovery26Busy = false;
  recovery26Pending = null;
  if (!outcome.ok) {
    recovery26ShowConfirmError(outcome.message);
    return;
  }
  recovery26Undo = null;
  recovery26Manager();
  recovery26Receipt(ids.size === 1 ? "所选归档已永久移除" : `已永久移除 ${ids.size} 项归档`);
}

// ------------------------------------------------------------
// Public entry points
// ------------------------------------------------------------

function recovery26Open() {
  recovery26Manager();
}

function recovery26OpenFromTaskMenu() {
  state.taskMenuOpen = false;
  recovery26Manager();
}

function recovery26ReviewDeleteTask(taskId) {
  return recovery26ReviewDelete([taskId]);
}

function recovery26ReviewDeleteBulk(ids) {
  return recovery26ReviewDelete(ids);
}

function recovery26DeleteQuickFromWidget(taskId) {
  const task = r26Task(taskId);
  if (!task) return Promise.resolve({ success: false, code: "TASK_NOT_FOUND", taskId });
  return recovery26Transaction(() => recovery26DeleteRecords([taskId])).then((outcome) => {
    if (!outcome.ok) return { success: false, code: "DELETE_FAILED", taskId };
    state.taskMenuOpen = false;
    render();
    recovery26Receipt("1 项已移到最近删除", outcome.entries);
    return { success: true, code: "DELETED", taskId };
  });
}

// ------------------------------------------------------------
// Bindings
// ------------------------------------------------------------

function recovery26OnClick(event) {
  // While the manager is mounted, a click inside #overlay that is not one of its
  // own controls belongs to the shared layer (a menu, a control22 listbox, a
  // dialog); re-mounting the list here would tear that surface down.
  const overlay = r26("#overlay");
  const target = event.target;
  if (overlay?.querySelector(".recovery26-manager") && !target.closest?.(".recovery26-manager")) return;
  if (overlay?.querySelector(".recovery26-confirm") && !target.closest?.(".recovery26-confirm")) return;
  const notebook = event.target.closest?.('[data-knowledge-action="remove-binding"]');
  if (notebook) {
    if (!r26Task(event.target.closest?.("[data-task-id]")?.dataset.taskId || state.activeTaskId)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    recovery26ReviewUnlinkNote(state.activeTaskId);
    return;
  }
  const button = event.target.closest?.("[data-recovery26]");
  if (!button || button.disabled) return;
  const action = button.dataset.recovery26;
  if (action === "owner") {
    event.preventDefault();
    event.stopImmediatePropagation();
    recovery26Active = button.dataset.id;
    recovery26DrawList();
    r26(`[data-recovery26="select"][data-id="${CSS.escape(recovery26Active)}"]`)?.focus({ preventScroll: true });
    return;
  }
  if (action === "select") {
    event.preventDefault();
    event.stopImmediatePropagation();
    recovery26Active = button.dataset.id;
    recovery26DrawList();
    r26(`[data-recovery26="select"][data-id="${CSS.escape(recovery26Active)}"]`)?.focus({ preventScroll: true });
    return;
  }
  if (action === "undo") {
    event.preventDefault();
    event.stopImmediatePropagation();
    const undo = recovery26Undo;
    clearWorkspaceFeedback("recovery");
    recovery26Undo = null;
    if (typeof undo === "function") {
      Promise.resolve(undo()).catch((error) => console.error("[recovery26] undo failed", error));
    }
    return;
  }
  if (!["open", "cancel", "clear-search", "commit-delete", "restore", "restore-selected", "purge", "purge-selected", "purge-confirm", "unlink-confirm", "remove-note", "delete-bulk"].includes(action)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (action === "open") {
    recovery26Manager();
    return;
  }
  if (action === "cancel") {
    if (typeof shellCloseOverlay === "function") shellCloseOverlay({ restoreFocus: false });
    recovery26Pending = null;
    recovery26ReturnFocus?.isConnected && recovery26ReturnFocus.focus({ preventScroll: true });
    if (r26Archive().length && r26(".recovery26-manager")) recovery26Manager();
    else render();
    return;
  }
  if (action === "clear-search") {
    recovery26Query = "";
    recovery26Filter = "all";
    recovery26Manager();
    return;
  }
  if (action === "commit-delete") {
    void recovery26CommitDelete();
    return;
  }
  if (action === "remove-note") {
    // The file menu's own entry carries the task id; the legacy action path has
    // none, so fall back to the active task.
    const taskId = button.dataset.taskId || state.activeTaskId;
    state.taskMenuOpen = false;
    recovery26ReviewRemoveNote(taskId);
    return;
  }
  if (action === "delete-bulk") {
    // Real selected ids only, and every object is re-verified before it is
    // archived: a record that vanished since the selection is simply skipped.
    const ids = [...document.querySelectorAll('[data-bulk-id][aria-checked="true"]')]
      .map((element) => element.dataset.bulkId)
      .filter((taskId) => Boolean(r26Task(taskId)));
    recovery26ReviewDeleteBulk(ids);
    return;
  }
  if (action === "restore") {
    recovery26RestoreActive();
    return;
  }
  if (action === "restore-selected") {
    const ids = [...recovery26Picked];
    if (!ids.length) return;
    recovery26Busy = true;
    recovery26RestoreMany(ids).then((results) => {
      recovery26Busy = false;
      render();
      recovery26ShowResults(results);
    }).catch((error) => {
      recovery26Busy = false;
      console.error("[recovery26] batch restore failed", error);
      recovery26Receipt("恢复未完成，请重试");
    });
    return;
  }
  if (action === "purge") {
    recovery26PurgeReview([recovery26Active]);
    return;
  }
  if (action === "purge-selected") {
    recovery26PurgeReview(recovery26Picked.size ? [...recovery26Picked] : r26Archive().map((entry) => entry.id));
    return;
  }
  if (action === "purge-confirm") {
    void recovery26PurgeConfirm();
    return;
  }
  if (action === "unlink-confirm") {
    const pending = recovery26Pending;
    if (!pending || pending.mode !== "unlink") return;
    const taskId = pending.ids[0];
    const body = pending.body;
    const before = pending.before;
    recovery26Pending = null;
    recovery26Transaction(() => recovery26UnlinkNote(taskId)).then((outcome) => {
      if (!outcome.ok) {
        recovery26ShowConfirmError(outcome.message);
        return;
      }
      render();
      const target = r26Task(taskId);
      const note = target?.knowledgeNote;
      if (!target || String(target.notes || "") !== body || note?.filePath) {
        recovery26Receipt("当前笔记已变更，请重新选择文件关联");
        return;
      }
      recovery26Receipt("文件关联已解除，正文保留", [], () => {
        const live = r26Task(taskId);
        if (!live || String(live.notes || "") !== body || r26Task(taskId)?.knowledgeNote?.filePath) {
          recovery26Receipt("当前笔记已变更，请重新选择文件关联");
          return;
        }
        live.knowledgeNote = knowledgeDocument.normalizeKnowledgeNote(before, { taskId: live.id, title: live.title });
        live.updatedAt = now();
        render();
        void recovery26Persist();
        recovery26Receipt("文件关联已恢复");
      });
    });
  }
}

function recovery26OnInput(event) {
  if (event.target.id !== "recovery26-search") return;
  recovery26Query = event.target.value;
  recovery26DrawList();
}

function recovery26OnChange(event) {
  const target = event.target;
  if (target.id === "recovery26-filter") {
    recovery26Filter = target.value;
    // A filter never silently drops the checkbox selection.
    recovery26DrawList();
    return;
  }
  if (target.id === "recovery26-all") {
    for (const entry of recovery26Visible()) {
      if (target.checked) recovery26Picked.add(entry.id);
      else recovery26Picked.delete(entry.id);
    }
    recovery26DrawList();
    return;
  }
  if (target.id === "recovery26-purge-agree") {
    const confirm = r26('[data-recovery26="purge-confirm"]');
    if (confirm) confirm.disabled = !target.checked;
    return;
  }
  if (target.name === "groupPolicy26") {
    const field = r26("#recovery26-target-field");
    if (field) field.hidden = target.value === "delete";
    return;
  }
  if (target.dataset?.recovery26Check) {
    const id = target.dataset.recovery26Check;
    if (target.checked) recovery26Picked.add(id);
    else recovery26Picked.delete(id);
    recovery26UpdateFooter();
  }
}

/**
 * The batch footer's selection state is owned by bulk.js, so the phase26
 * confirmation reads the real selected ids from the DOM and re-verifies each
 * object before it is archived.
 */
function recovery26Bind() {
  window.addEventListener("click", recovery26OnClick, true);
  document.addEventListener("input", recovery26OnInput);
  document.addEventListener("change", recovery26OnChange);
}

recovery26Bind();

// Shared outside-click and Escape dismissal must return focus just like the
// explicit cancel button. Keep the original element instead of guessing a
// selector for the many task, group, note and settings entry points.
const recovery26PreviousCloseOverlay = shellCloseOverlay;
shellCloseOverlay = function recovery26CloseOverlay(options = {}) {
  const isRecovery = Boolean(r26("#overlay .recovery26-manager, #overlay .recovery26-confirm"));
  const trigger = recovery26ReturnFocus;
  recovery26PreviousCloseOverlay(options);
  if (isRecovery && options.restoreFocus !== false && trigger?.isConnected) trigger.focus({ preventScroll: true });
};

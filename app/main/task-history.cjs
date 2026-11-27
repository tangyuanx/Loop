const { randomUUID } = require("node:crypto");

const IDLE_MERGE_MS = 20_000;
const MAX_MERGE_MS = 5 * 60_000;
const PAGE_SIZE = 40;
const textFields = new Set(["title", "description", "hypothesis", "conclusion", "notes", "note", "body"]);
const recordedFields = new Set([
  ...textFields, "status", "group", "priority", "deadlineAt", "placement", "tags", "knowledgeNoteIds", "downstreamNodeIds",
]);
const targetKinds = new Set(["task", "node", "note"]);
const eventKinds = new Set(["created", "imported", "deleted", "restored", "changed", "restored-version"]);
const tagKinds = ["today", "later", "blocked"];
const text = (value) => typeof value === "string" ? value : "";
const stringList = (value) => Array.isArray(value) ? value.filter(item => typeof item === "string") : [];

function normalizeHistoryValue(value) {
  if (typeof value === "string" || Number.isFinite(value)) return value;
  if (Array.isArray(value)) return stringList(value);
  if (!value || typeof value !== "object") return "";
  return Object.fromEntries(["id", "title", "parentId", "parentTitle", "order"]
    .filter(key => typeof value[key] === "string" || Number.isFinite(value[key]))
    .map(key => [key, value[key]]));
}

function normalizeTaskActivity(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  const result = [];
  for (const entry of value) {
    if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id)
      || typeof entry.taskId !== "string" || !entry.taskId || typeof entry.targetId !== "string" || !entry.targetId
      || !targetKinds.has(entry.targetKind) || !eventKinds.has(entry.kind) || !Number.isFinite(Date.parse(entry.at))) continue;
    const sourceChanges = Object.hasOwn(entry, "changes") ? entry.changes : [];
    const fields = new Set();
    if (!Array.isArray(sourceChanges) || sourceChanges.some(change => {
      if (!change || !recordedFields.has(change.field) || fields.has(change.field)
        || !Object.hasOwn(change, "before") || !Object.hasOwn(change, "after")) return true;
      fields.add(change.field);
      return false;
    }) || (!sourceChanges.length && ["changed", "restored-version"].includes(entry.kind))) continue;
    const changes = sourceChanges
      .map(({ field, before, after }) => ({ field, before: normalizeHistoryValue(before), after: normalizeHistoryValue(after) }));
    ids.add(entry.id);
    result.push({
      id: entry.id,
      taskId: entry.taskId,
      targetId: entry.targetId,
      targetKind: entry.targetKind,
      kind: entry.kind,
      at: new Date(entry.at).toISOString(),
      title: text(entry.title),
      ...(Number.isFinite(Date.parse(entry.startedAt)) ? { startedAt: new Date(entry.startedAt).toISOString() } : {}),
      ...(entry.taskIds?.length ? { taskIds: [...new Set(stringList(entry.taskIds))] } : {}),
      ...(changes.length ? { changes } : {}),
    });
  }
  return result;
}

function archiveIds(data) {
  const tasks = new Set();
  const nodes = new Set();
  const notes = new Set();
  const nodeKeys = (taskId, list) => {
    for (const node of Array.isArray(list) ? list : []) {
      if (!node?.id) continue;
      nodes.add(JSON.stringify([taskId, node.id]));
      nodeKeys(taskId, node.children);
    }
  };
  for (const entry of Array.isArray(data?.recentlyDeleted) ? data.recentlyDeleted : []) {
    if (entry?.kind === "task" || entry?.kind === "quick") tasks.add(entry.record?.id);
    if (entry?.kind === "node") nodeKeys(entry.ownerTaskId, [entry.record]);
    if (entry?.kind === "note") notes.add(entry.objectId);
    if (entry?.kind === "group" && entry.policy === "delete" && Array.isArray(entry.members)) {
      for (const member of entry.members) tasks.add(member?.record?.id);
    }
  }
  return { tasks, nodes, notes };
}

function workspaceTargets(data) {
  const tasks = new Map();
  const nodes = new Map();
  const notes = new Map();
  const siblingGroups = new Map();
  const noteOwners = new Map();
  const groups = new Map((Array.isArray(data?.taskGroups) ? data.taskGroups : []).map(group => [group?.id, text(group?.title)]));
  const statuses = new Map((Array.isArray(data?.nodeStates) ? data.nodeStates : []).map(status => [status?.id, text(status?.name)]));
  const documents = (Array.isArray(data?.knowledgeDocuments) ? data.knowledgeDocuments : []).filter(note => {
    const title = text(note?.title);
    return text(note?.id) && !note.knowledgeNote?.isDeleted && (text(note.notes).trim() || note.knowledgeNote?.filePath
      || title && title !== "未命名" && title !== "未命名笔记");
  });
  const documentIds = new Set(documents.map(note => note.id));
  const visit = (taskId, children, parent) => {
    const siblings = (Array.isArray(children) ? children : []).filter(node => text(node?.id));
    const siblingsKey = JSON.stringify([taskId, parent?.id || ""]);
    if (siblings.length) siblingGroups.set(siblingsKey, siblings.map(node => node.id));
    siblings.forEach((node, index) => {
      const key = JSON.stringify([taskId, node.id]);
      const statusId = text(node.status) || "todo";
      nodes.set(key, {
        taskId, targetId: node.id, targetKind: "node", title: text(node.title), siblingsKey,
        fields: {
          title: text(node.title), status: { id: statusId, title: statuses.get(statusId) || "" },
          placement: { parentId: parent?.id || "", parentTitle: text(parent?.title), order: index + 1 },
          note: text(node.note), hypothesis: text(node.hypothesis), conclusion: text(node.conclusion),
          downstreamNodeIds: stringList(node.downstreamNodeIds),
        },
      });
      visit(taskId, node.children, node);
    });
  };
  for (const task of Array.isArray(data?.tasks) ? data.tasks : []) {
    const taskId = text(task?.id);
    if (!taskId) continue;
    const groupId = typeof task.groupId === "string" ? task.groupId : "group_inbox";
    const knowledgeNoteIds = stringList(task.knowledgeNoteIds).filter(id => id !== taskId && documentIds.has(id));
    tasks.set(taskId, {
      taskId, targetId: taskId, targetKind: "task", title: text(task.title),
      fields: {
        title: text(task.title), status: task.status === "done" ? "done" : "active",
        group: { id: groupId, title: groups.get(groupId) || "" },
        priority: text(task.priority) || "medium", deadlineAt: text(task.deadlineAt),
        description: text(task.description), hypothesis: text(task.hypothesis), conclusion: text(task.conclusion),
        notes: text(task.notes || (typeof task.knowledgeNote === "string" ? task.knowledgeNote : "")),
        tags: tagKinds.filter(tag => Array.isArray(task.tags) ? task.tags.includes(tag) : task.tags?.[tag]),
        knowledgeNoteIds,
      },
    });
    for (const id of knowledgeNoteIds) {
      if (!noteOwners.has(id)) noteOwners.set(id, []);
      noteOwners.get(id).push(taskId);
    }
    visit(taskId, task.nodes, null);
  }
  for (const note of documents) {
    const id = note.id;
    const taskIds = noteOwners.get(id) || [];
    const title = text(note.title || note.knowledgeNote?.title);
    notes.set(id, {
      taskId: taskIds[0] || "", taskIds, targetId: id, targetKind: "note", title,
      fields: { title, body: text(note.notes) },
    });
  }
  return { tasks, nodes, notes, siblingGroups };
}

function sharedSiblingPositions(source, other) {
  const result = new Map();
  for (const [group, ids] of source.siblingGroups) {
    const shared = new Set(other.siblingGroups.get(group) || []);
    result.set(group, new Map(ids.filter(id => shared.has(id)).map((id, index) => [id, index])));
  }
  return result;
}

function diffFields(before, after, oldPositions, newPositions) {
  const changes = [];
  for (const [field, next] of Object.entries(after.fields)) {
    const previous = before.fields[field];
    if (previous === next) continue;
    if (field === "group" && previous.id === next.id) continue;
    if (field === "status" && typeof next === "object" && previous.id === next.id) continue;
    if (field === "placement" && previous.parentId === next.parentId
      && oldPositions.get(before.siblingsKey)?.get(after.targetId) === newPositions.get(after.siblingsKey)?.get(after.targetId)) continue;
    if (typeof next === "object" && JSON.stringify(previous) === JSON.stringify(next)) continue;
    changes.push({ field, before: previous, after: next });
  }
  return changes;
}

function record(event, entries) {
  const previous = entries.at(-1);
  const previousTime = Date.parse(previous?.at);
  const startedAt = previous?.startedAt || previous?.at;
  const time = Date.parse(event.at);
  if (event.kind === "changed" && previous?.kind === "changed"
    && event.taskId === previous.taskId && event.targetKind === previous.targetKind && event.targetId === previous.targetId
    && event.taskIds?.join("\0") === previous.taskIds?.join("\0")
    && time >= previousTime && time - previousTime <= IDLE_MERGE_MS && time - Date.parse(startedAt) <= MAX_MERGE_MS
    && event.changes.length === previous.changes?.length
    && event.changes.every(({ field, before }, index) => textFields.has(field) && field === previous.changes[index].field
      && before === previous.changes[index].after)) {
    const changes = event.changes.map(({ field, after }, index) => ({ field, before: previous.changes[index].before, after }))
      .filter(change => change.before !== change.after);
    if (changes.length) entries[entries.length - 1] = { ...event, id: previous.id, startedAt, changes };
    else entries.pop();
    return;
  }
  entries.push(event);
}

function recordTaskActivity(previous, next, { now = new Date(), source = "save", restoredTarget } = {}) {
  const existing = Array.isArray(previous?.taskActivity) ? previous.taskActivity : [];
  const entries = existing.slice();
  const before = workspaceTargets(previous);
  const after = workspaceTargets(next);
  const archived = archiveIds(previous);
  const oldPositions = sharedSiblingPositions(before, after);
  const newPositions = sharedSiblingPositions(after, before);
  const at = now.toISOString();
  const add = (target, kind, changes) => {
    const { taskId, taskIds, targetKind, targetId, title } = target;
    if (!taskId) return;
    record({ id: randomUUID(), taskId, targetKind, targetId, title, kind, at,
      ...(taskIds?.length > 1 ? { taskIds } : {}), ...(changes?.length ? { changes } : {}) }, entries);
  };
  for (const type of ["tasks", "nodes", "notes"]) {
    for (const [key, target] of before[type]) {
      if (after[type].has(key) || type === "nodes" && !after.tasks.has(target.taskId)) continue;
      const fields = type === "notes" ? ["body"] : type === "nodes" ? ["note", "conclusion"] : ["conclusion"];
      const versions = fields.filter(field => target.fields[field]).map(field => ({ field, before: target.fields[field], after: "" }));
      add(target, "deleted", versions);
    }
    for (const [key, target] of after[type]) {
      const prior = before[type].get(key);
      if (!prior) {
        if (type !== "nodes" || before.tasks.has(target.taskId)) {
          const restored = archived[type].has(key);
          add(target, restored ? "restored" : source === "import" && type === "tasks" ? "imported" : "created");
        }
        continue;
      }
      const changes = diffFields(prior, target, oldPositions, newPositions);
      if (!changes.length) continue;
      const restored = restoredTarget?.targetKind === target.targetKind && restoredTarget.targetId === target.targetId
        && restoredTarget.taskId === target.taskId;
      const previousOwners = prior.taskIds || [];
      const taskIds = type === "notes" ? [...new Set([...target.taskIds, ...previousOwners])] : null;
      add(taskIds?.length ? { ...target, taskId: taskIds[0], taskIds } : target, restored ? "restored-version" : "changed", changes);
    }
  }
  if (entries.length || existing.length) return { ...next, taskActivity: entries };
  if (!Object.hasOwn(next || {}, "taskActivity")) return next;
  const { taskActivity, ...workspace } = next;
  return workspace;
}

function readTaskActivity(data, taskId, beforeId) {
  if (typeof taskId !== "string" || !Array.isArray(data?.taskActivity)) return { events: [], beforeId: null };
  const entries = data.taskActivity;
  const cursor = typeof beforeId === "string" ? entries.findIndex(entry => entry.id === beforeId) : -1;
  if (beforeId && cursor < 0) return { events: [], beforeId: null };
  const events = [];
  for (let index = cursor >= 0 ? cursor - 1 : entries.length - 1; index >= 0; index -= 1) {
    const event = entries[index];
    if (event.taskId !== taskId && !event.taskIds?.includes(taskId)) continue;
    if (events.length === PAGE_SIZE) return { events, beforeId: events.at(-1).id };
    events.push(event);
  }
  return { events, beforeId: null };
}

function restoreTaskActivityValue(data, { taskId, eventId, field, side }, now = new Date()) {
  const event = data?.taskActivity?.find(item => item.id === eventId && item.taskId === taskId);
  const restorable = event?.targetKind === "task" ? ["description", "hypothesis", "conclusion"].includes(field)
    : event?.targetKind === "node" && ["note", "conclusion"].includes(field);
  const change = event?.changes?.find(item => item.field === field);
  const value = (side === "before" || side === "after" && event?.kind !== "deleted") && change?.[side];
  const task = data?.tasks?.find(item => item.id === taskId);
  const findNode = (nodes, id) => {
    for (const node of nodes || []) {
      if (node.id === id) return node;
      const child = findNode(node.children, id);
      if (child) return child;
    }
    return null;
  };
  const target = event?.targetKind === "node" ? findNode(task?.nodes, event.targetId) : task;
  if (!restorable || typeof value !== "string" || !task || !target) return null;
  const updatedAt = now.toISOString();
  const receipt = { taskId, field, value, updatedAt, targetId: event.targetId, targetKind: event.targetKind };
  if (target[field] === value) return { next: data, receipt: { ...receipt, updatedAt: target.updatedAt } };
  const replace = nodes => (nodes || []).map(node => {
    if (node === target) return { ...node, [field]: value, updatedAt };
    if (!node.children?.length) return node;
    const children = replace(node.children);
    return children.some((child, index) => child !== node.children[index]) ? { ...node, children } : node;
  });
  const updatedTask = event.targetKind === "node"
    ? { ...task, nodes: replace(task.nodes), updatedAt }
    : { ...task, [field]: value, updatedAt, ...(field === "hypothesis" ? { hypothesisUpdatedAt: updatedAt } : {}) };
  return { next: { ...data, tasks: data.tasks.map(item => item === task ? updatedTask : item) }, receipt };
}

module.exports = { normalizeTaskActivity, readTaskActivity, recordTaskActivity, restoreTaskActivityValue };

const { randomUUID } = require('node:crypto');
const knowledgeDocument = require('../renderer/src/knowledge-document.js');
const { normalizeDefinitions, customId } = require('../renderer/src/node-states.js');

const BUILTIN_STATES = [
  { id: 'todo', name: '未完成' },
  { id: 'done', name: '已完成' },
  { id: 'review', name: '待确认' },
];
const MAX_CUSTOM_STATES = 24;
const UNGROUPED = 'group_ungrouped';

function importError(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, ...detail });
}

function nameKey(value) {
  return value.trim().normalize('NFC').toLocaleLowerCase();
}

function reserveExistingIds(data) {
  const ids = new Set();
  function visitNodes(nodes) {
    for (const node of nodes ?? []) {
      ids.add(node.id);
      visitNodes(node.children);
    }
  }
  for (const task of data.tasks ?? []) {
    ids.add(task.id);
    ids.add(task.knowledgeNote?.noteId);
    visitNodes(task.nodes);
  }
  for (const document of data.knowledgeDocuments ?? []) {
    ids.add(document.id);
    ids.add(document.knowledgeNote?.noteId);
  }
  for (const entry of [...(data.taskGroups ?? []), ...(data.nodeStates ?? [])]) ids.add(entry.id);
  for (const entry of data.recentlyDeleted ?? []) {
    ids.add(entry.objectId);
    ids.add(entry.knowledgeNote?.noteId);
    ids.add(entry.record?.knowledgeNote?.noteId);
    visitNodes(entry.record?.nodes);
  }
  return ids;
}

function reserveId(ids, value) {
  if (typeof value !== 'string' || !value.trim() || ids.has(value)) return false;
  ids.add(value);
  return true;
}

function allocateId(prefix, ids, idFactory) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = idFactory(prefix);
    if (prefix === 'custom' && !customId(id)) continue;
    if (reserveId(ids, id)) return id;
  }
  throw importError('IMPORT_ID_UNAVAILABLE', '无法为导入内容分配新的标识，请重试。');
}

function importedStateName(name, occupiedNames) {
  if (!occupiedNames.has(nameKey(name))) return name;
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? '（导入）' : `（导入 ${index}）`;
    const base = name.slice(0, 24 - suffix.length).replace(/[\uD800-\uDBFF]$/u, '');
    const candidate = `${base}${suffix}`;
    if (!occupiedNames.has(nameKey(candidate))) return candidate;
  }
}

function mapNodeStates(data, pack, usedStatuses, statusMap, ids, idFactory) {
  const existing = normalizeDefinitions(data.nodeStates);
  const availableStatuses = [...BUILTIN_STATES, ...existing];
  const knownIds = new Set(availableStatuses.map(state => state.id));
  const occupiedNames = new Set(availableStatuses.map(state => nameKey(state.name)));
  const builtInIds = new Set(BUILTIN_STATES.map(state => state.id));
  const definitions = new Map((pack.nodeStates ?? []).map(state => [state.id, state]));
  const mapped = new Map();
  const nodeStates = existing.slice();
  const statusConflicts = [];

  for (const status of usedStatuses) {
    if (builtInIds.has(status)) {
      mapped.set(status, status);
      continue;
    }
    const definition = definitions.get(status);
    if (!definition) {
      throw importError('IMPORT_STATUS_MISSING', '任务包缺少节点状态定义。', { statusId: status });
    }
    const target = statusMap instanceof Map ? statusMap.get(status)
      : Object.hasOwn(statusMap ?? {}, status) ? statusMap[status] : undefined;
    if (target !== undefined) {
      if (!knownIds.has(target)) {
        throw importError('IMPORT_STATUS_UNAVAILABLE', '所选节点状态已变更，请重新选择。', { statusId: status, availableStatuses });
      }
      mapped.set(status, target);
      continue;
    }
    const name = definition.name.trim().slice(0, 24);
    const color = definition.color.toLowerCase();
    const matching = existing.find(state => nameKey(state.name) === nameKey(name) && state.color.toLowerCase() === color);
    if (matching) {
      mapped.set(status, matching.id);
      continue;
    }
    if (nodeStates.length >= MAX_CUSTOM_STATES) {
      statusConflicts.push({ id: status, name, color });
      continue;
    }
    const importName = importedStateName(name, occupiedNames);
    const id = allocateId('custom', ids, idFactory);
    occupiedNames.add(nameKey(importName));
    nodeStates.push({ id, name: importName, color });
    mapped.set(status, id);
  }
  if (statusConflicts.length) {
    throw importError('IMPORT_STATUS_CAPACITY', '自定义节点状态已达上限，请为剩余状态选择对应项。', { statusConflicts, availableStatuses });
  }
  return { nodeStates, mapped };
}

function projectNodes(nodes, taskId, parentId, nodeIds, statuses, stamp) {
  return nodes.map((node, index) => {
    const id = nodeIds.get(node.id);
    const updatedAt = node.updatedAt || stamp;
    return {
      id,
      taskId,
      parentId,
      type: parentId ? 'subtask' : 'step',
      order: index + 1,
      title: node.title,
      status: statuses.get(node.status),
      note: node.note ?? '',
      hypothesis: node.hypothesis ?? '',
      conclusion: node.conclusion ?? '',
      createdAt: updatedAt,
      updatedAt,
      collapsed: false,
      downstreamNodeIds: (node.downstreamNodeIds ?? []).map(targetId => nodeIds.get(targetId)).filter(Boolean),
      children: projectNodes(node.children ?? [], taskId, id, nodeIds, statuses, stamp),
    };
  });
}

function prepareImport(data, pack, options = {}, idFactory = prefix => `${prefix}_${randomUUID()}`) {
  const source = pack.task;
  const stamp = new Date().toISOString();
  const ids = reserveExistingIds(data);
  const taskId = options.taskId ?? allocateId('task', ids, idFactory);
  if (options.taskId !== undefined && !reserveId(ids, taskId)) {
    throw importError('IMPORT_TASK_ID_CONFLICT', '导入任务的标识已被占用，请重新预览。');
  }
  const groupId = options.groupId === UNGROUPED ? '' : options.groupId ?? '';
  if (groupId && !(data.taskGroups ?? []).some(group => group.id === groupId)) {
    throw importError('IMPORT_GROUP_UNAVAILABLE', '所选分组已不存在，请重新选择。');
  }
  const title = typeof options.title === 'string' ? options.title.trim() : source.title;
  if (!title) throw importError('IMPORT_TITLE_REQUIRED', '请输入任务名称。');

  const nodeIds = new Map();
  const usedStatuses = new Set();
  function reserveNodes(nodes) {
    for (const node of nodes) {
      nodeIds.set(node.id, allocateId('node', ids, idFactory));
      usedStatuses.add(node.status);
      reserveNodes(node.children ?? []);
    }
  }
  reserveNodes(source.nodes ?? []);
  const { nodeStates, mapped } = mapNodeStates(data, pack, usedStatuses, options.statusMap, ids, idFactory);
  const documents = [];
  const tabs = [];
  const documentIdMap = new Map();
  const highestOrder = (data.tasks ?? []).reduce((highest, task) => Math.max(highest, Number(task.order) || 0), 0);
  const task = {
    id: taskId,
    title,
    order: highestOrder + 1,
    groupId,
    priority: source.priority ?? 'medium',
    status: source.status,
    deadlineAt: source.deadlineAt ?? '',
    deadlineReminderMinutes: null,
    recurrence: { frequency: 'none', weekdays: [], time: '09:00', lastCompletedOccurrence: '' },
    tags: { today: false, later: false, blocked: false },
    description: source.description ?? '',
    hypothesis: source.hypothesis ?? '',
    conclusion: source.conclusion ?? '',
    createdAt: stamp,
    updatedAt: stamp,
    resolvedAt: source.status === 'done' ? stamp : '',
    nodes: projectNodes(source.nodes ?? [], taskId, null, nodeIds, mapped, stamp),
    notes: '',
    knowledgeNote: knowledgeDocument.createKnowledgeNoteMetadata({ noteId: taskId, taskId, title, createdAt: stamp }),
  };
  for (const note of pack.notes ?? []) {
    const asMain = note.main && Boolean(note.content.trim());
    const id = asMain ? taskId : allocateId('document', ids, idFactory);
    const metadata = knowledgeDocument.markDocumentEdited(knowledgeDocument.createKnowledgeNoteMetadata({
      noteId: id,
      taskId: id,
      title: note.title,
      createdAt: stamp,
    }));
    documentIdMap.set(note.id, id);
    tabs.push(id);
    if (asMain) {
      task.notes = note.content;
      task.knowledgeNote = metadata;
      continue;
    }
    documents.push({ id, title: note.title, notes: note.content, creatorTaskId: taskId, createdAt: stamp, updatedAt: stamp, knowledgeNote: metadata });
  }
  task.knowledgeLinks = tabs.filter(id => id !== taskId);
  task.knowledgeNoteIds = tabs.slice();
  task.activeKnowledgeId = tabs[0] ?? '';
  return { task, documents, nodeStates, tabs, documentIdMap };
}

module.exports = { prepareImport };

/**
 * Loop -- Data persistence layer
 *
 * Responsibilities:
 *   - Read/write task data as JSON to disk
 *   - Normalize data structure (with safe defaults)
 *   - Atomic writes via temp file + rename
 *   - Preserve unverified data and report recovery states
 *
 * The data file is stored in Electron's userData directory.
 * Data format versioning is handled via the version field.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { IMAGE_ASSETS_DIR, packImageText, syncDirectory, unpackImageText } = require("./image-store.cjs");
const { normalizeTaskActivity } = require("./task-history.cjs");
const knowledgeDocument = require("../renderer/src/knowledge-document.js");
const workNavigationModel = require("../renderer/src/work-navigation-model.js");
const nodeStates = require("../renderer/src/node-states.js");

const DATA_FILE = "task-data.json";
const WORKSPACE_FILE = "task-data.workspace";
const DATA_VERSION = 4;
const KNOWLEDGE_MIGRATION_VERSION = 2;
// Phase26 -- Recently Deleted.
//
// The archive is a first-class collection of `task-data.json` so that a delete
// and the archive entry that records it are written by the same atomic rename,
// and so that every existing path (portable export, verified backup, import,
// legacy recovery and the corrupt-file rescue) already carries it. The schema
// version travels with the collection, mirroring `knowledgeSchemaVersion`.
const RECENTLY_DELETED_SCHEMA_VERSION = 1;
const RECENTLY_DELETED_KINDS = new Set(["task", "quick", "group", "node", "note"]);
const RECENTLY_DELETED_GROUP_POLICIES = new Set(["keep", "delete"]);
const DEFAULT_GROUP = { id: "group_inbox", title: "默认", order: 1 };
const ALL_TASKS_GROUP_ID = "group_all";
const UNGROUPED_TASKS_GROUP_ID = "group_ungrouped";
const TASK_STATUSES = new Set(["active", "done"]);
const PRIORITIES = new Set(["high", "medium", "low"]);
const RECURRENCE_FREQUENCIES = new Set(["none", "daily", "weekly"]);
const DEADLINE_REMINDER_MINUTES = new Set([0, 5, 15, 30, 60, 120, 1440, 2880, 10080]);
const DEFAULT_DEADLINE_REMINDER_MINUTES = 60;
const TASK_FILTERS = new Set(["all", "today", "active", "done", "blocked", "later"]);
const PRIORITY_FILTERS = new Set(["all", "high", "medium", "low"]);
const CAPTURE_SOURCE_FILTERS = new Set(["all", "task", "quick"]);
const ZH_FONTS = new Set(["system", "noto", "yahei", "pingfang", "songti", "simsun", "fangsong", "heiti", "kaiti"]);
const EN_FONTS = new Set(["inter", "system", "segoe", "arial", "helvetica", "verdana", "trebuchet", "tahoma", "times", "georgia", "courier", "mono"]);
const FONT_SCALES = new Set(["current", "larger", "large", "largest"]);

function dataFilePath(userDataPath) {
  return path.join(userDataPath, DATA_FILE);
}

function dataError(code, message, cause) {
  return Object.assign(new Error(message, { cause }), { code });
}

async function readRawTaskData(userDataPath, fileSystem) {
  let raw;
  try {
    raw = await fileSystem.readFile(dataFilePath(userDataPath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      if (await workspaceMarkerExists(userDataPath, fileSystem)) throw missingDatabase();
      return null;
    }
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw dataError("CORRUPT_TASK_DATA", "任务数据文件已损坏，已保留原文件。", error);
  }
  validateTaskDataStructure(parsed);
  return parsed;
}

/** Read the task database without moving, rewriting, or creating any files. */
async function readTaskData(userDataPath, { fileSystem = fs, validateOnly = false } = {}) {
  const parsed = await readRawTaskData(userDataPath, fileSystem);
  if (!parsed) return null;
  const usable = Number(parsed.version) === DATA_VERSION
    ? await unpackImageText(userDataPath, parsed, { fileSystem, validateOnly })
    : parsed;
  return validateOnly ? parsed : normalizeTaskData(usable);
}

async function readOnDiskDataVersion(userDataPath) {
  return Number((await readRawTaskData(userDataPath, fs))?.version || 0);
}

function missingDatabase() {
  return dataError("MISSING_TASK_DATA", "任务数据文件缺失，已保留工作区以供恢复。");
}

async function workspaceMarkerExists(userDataPath, fileSystem) {
  try {
    await fileSystem.lstat(path.join(userDataPath, WORKSPACE_FILE));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function markWorkspace(userDataPath) {
  let marker;
  try {
    marker = await fs.open(path.join(userDataPath, WORKSPACE_FILE), "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
  try {
    await marker.writeFile("Loop workspace\n", "utf8");
    await marker.sync();
  } finally {
    await marker.close();
  }
  await syncDirectory(userDataPath);
  return true;
}

/** Check an existing profile before accepting edits or migrating older layouts. */
async function verifyTaskWorkspace(userDataPath) {
  const parsed = await readTaskData(userDataPath, { validateOnly: true });
  if (parsed) {
    await markWorkspace(userDataPath);
    return parsed;
  }
  const entries = await fs.readdir(userDataPath).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (entries.some((entry) => [IMAGE_ASSETS_DIR, "task-share-assets", "knowledge-note-recovery", "knowledge-note-recovery.json"].includes(entry)
    || /^task-data\.(?:corrupt|pre-migration)-.+\.json$/.test(entry))) {
    throw missingDatabase();
  }
  return null;
}

/** Write the next task database after publishing all referenced image bytes. */
async function writeTaskData(userDataPath, data) {
  validateTaskDataStructure(data);
  const previous = await readRawTaskData(userDataPath, fs);
  if (Number(previous?.version) === DATA_VERSION) await unpackImageText(userDataPath, previous, { validateOnly: true });
  const normalized = normalizeTaskData(data);
  normalized.version = DATA_VERSION;
  await fs.mkdir(userDataPath, { recursive: true });
  const { packed } = await packImageText(userDataPath, normalized);
  const filePath = dataFilePath(userDataPath);
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const content = `${JSON.stringify(packed, null, 2)}\n`;
  let handle = null;
  let initializedHere = false;
  try {
    handle = await fs.open(tempPath, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    initializedHere = await markWorkspace(userDataPath);
    await fs.rename(tempPath, filePath);
    await syncDirectory(userDataPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(tempPath, { force: true }).catch(() => {});
    if (!previous && initializedHere) {
      // A failed first save remains retryable when replacement did not occur.
      await fs.lstat(filePath).catch(async (statusError) => {
        if (statusError.code === "ENOENT") await fs.rm(path.join(userDataPath, WORKSPACE_FILE), { force: true }).catch(() => {});
      });
    }
    throw error;
  }
  return normalized;
}

function isNewerThanSupported(record) {
  if (!record) return false;
  return (Number(record.version) > DATA_VERSION)
    || (Number(record.knowledgeSchemaVersion) > KNOWLEDGE_MIGRATION_VERSION)
    || (Number(record.recentlyDeletedSchemaVersion) > RECENTLY_DELETED_SCHEMA_VERSION);
}

function validateTaskDataStructure(data) {
  if (isNewerThanSupported(data)) {
    throw dataError("UNSUPPORTED_DATA_VERSION", "任务数据版本高于当前应用支持范围，已保留原文件。");
  }
  const invalid = () => dataError("CORRUPT_TASK_DATA", "任务数据文件已损坏，数据结构校验失败，已保留原文件。");
  if (!isRecord(data) || !Array.isArray(data.tasks)) throw invalid();

  const recordArrays = [data.tasks];
  for (const key of ["knowledgeDocuments", "taskGroups", "recentlyDeleted", "taskActivity"]) {
    if (!Object.hasOwn(data, key)) continue;
    if (!Array.isArray(data[key])) throw invalid();
    recordArrays.push(data[key]);
  }
  while (recordArrays.length) {
    for (const record of recordArrays.pop()) {
      if (!isRecord(record)) throw invalid();
      for (const key of ["nodes", "children"]) {
        if (!Object.hasOwn(record, key)) continue;
        if (!Array.isArray(record[key])) throw invalid();
        recordArrays.push(record[key]);
      }
    }
  }
  const occupied = new Set(data.tasks.map((task) => normalizeIdentifier(task.id)).filter(Boolean));
  for (const note of data.knowledgeDocuments || []) {
    if (typeof note.id !== "string" || !note.id.trim() || occupied.has(note.id)) throw invalid();
    occupied.add(note.id);
  }
  const archiveIds = new Set();
  for (const entry of data.recentlyDeleted || []) {
    if (typeof entry.id !== "string" || !entry.id.trim() || archiveIds.has(entry.id) || !RECENTLY_DELETED_KINDS.has(entry.kind)) throw invalid();
    if (["task", "quick", "node"].includes(entry.kind) && !isRecord(entry.record)) throw invalid();
    archiveIds.add(entry.id);
  }
  if (data.taskActivity && normalizeTaskActivity(data.taskActivity).length !== data.taskActivity.length) throw invalid();
}

function normalizeTaskData(data) {
  const safeData = migrateKnowledgeTaskData(data);
  const tasks = normalizeTasks(safeData.tasks, safeData.knowledgeDocuments);
  const taskGroups = normalizeTaskGroups(safeData.taskGroups, tasks);
  const legacyFonts = migrateLegacyFont(safeData.font);
  const taskActivity = Array.isArray(safeData.taskActivity) ? normalizeTaskActivity(safeData.taskActivity) : null;
  const recentlyDeleted = normalizeRecentlyDeleted(safeData.recentlyDeleted);
  const hasSharedAssets = tasks.some(task => task.sharedAssets?.length) || safeData.knowledgeDocuments?.some?.(note => note.sharedAssets?.length)
    || safeData.recentlyDeleted?.some?.(entry => entry.record?.sharedAssets?.length);
  const needsCurrentVersion = Number(safeData.version) === DATA_VERSION || taskActivity?.length || recentlyDeleted.length > 500;
  return {
    version: needsCurrentVersion ? DATA_VERSION : hasSharedAssets ? 3 : 2,
    knowledgeSchemaVersion: KNOWLEDGE_MIGRATION_VERSION,
    recentlyDeletedSchemaVersion: RECENTLY_DELETED_SCHEMA_VERSION,
    recentlyDeleted,
    ...(taskActivity ? { taskActivity } : {}),
    tasks,
    nodeStates: nodeStates.normalizeDefinitions(safeData.nodeStates),
    knowledgeDocuments: knowledgeDocument.normalizeDocuments(safeData.knowledgeDocuments, tasks),
    knowledgeWorkspace: knowledgeDocument.normalizeWorkspace(safeData.knowledgeWorkspace, tasks, knowledgeDocument.normalizeDocuments(safeData.knowledgeDocuments, tasks)),
    taskGroups,
    activeGroupId: safeData.activeGroupId === ALL_TASKS_GROUP_ID || safeData.activeGroupId === UNGROUPED_TASKS_GROUP_ID || taskGroups.some((group) => group.id === safeData.activeGroupId)
      ? safeData.activeGroupId
      : taskGroups[0]?.id || UNGROUPED_TASKS_GROUP_ID,
    flowWidths: normalizeFlowWidths(safeData.flowWidths),
    // Mirrors app.js defaultSidebarWidth / sidebarWidthLimits: the preference now
    // drives the task-list column, whose compact baseline is 240px.
    sidebarWidth: clampNumber(safeData.sidebarWidth, 240, 230, 460),
    detailHeight: clampNumber(safeData.detailHeight, 58, 50, 82),
    attachments: normalizeAttachments(safeData.attachments),
    theme: safeData.theme === "dark" ? "dark" : "light",
    font: ["songti", "heiti", "system", "mono"].includes(safeData.font) ? safeData.font : "system",
    zhFont: ZH_FONTS.has(safeData.zhFont) ? safeData.zhFont : legacyFonts.zhFont,
    enFont: EN_FONTS.has(safeData.enFont) ? safeData.enFont : legacyFonts.enFont,
    fontScale: FONT_SCALES.has(safeData.fontScale) ? safeData.fontScale : "larger",
    taskFilter: TASK_FILTERS.has(safeData.taskFilter) ? safeData.taskFilter : "all",
    priorityFilter: PRIORITY_FILTERS.has(safeData.priorityFilter) ? safeData.priorityFilter : "all",
    captureSourceFilter: CAPTURE_SOURCE_FILTERS.has(safeData.captureSourceFilter) ? safeData.captureSourceFilter : "all",
    newTaskPriority: PRIORITIES.has(safeData.newTaskPriority) ? safeData.newTaskPriority : "medium",
    knowledgeWidth: ["default", "wide", "full"].includes(safeData.knowledgeWidth) ? safeData.knowledgeWidth : "default",
    markdownMode: ["edit", "source", "preview"].includes(safeData.markdownMode) ? safeData.markdownMode : "edit",
    uiPreferences: safeData.uiPreferences && typeof safeData.uiPreferences === "object" ? {
      continuous: safeData.uiPreferences.continuous !== false,
      follow: safeData.uiPreferences.follow !== false,
      workNavigationEnabled: safeData.uiPreferences.workNavigationEnabled === true,
      nodeConclusionHintSeen: safeData.uiPreferences.nodeConclusionHintSeen === true,
      knowledgeAutoSpacing: safeData.uiPreferences.knowledgeAutoSpacing === true,
    } : null,
    workNavigation: workNavigationModel.normalizeWorkNavigation(safeData.workNavigation, {
      groupIds: taskGroups.map((group) => group.id),
    }),
    installationId: normalizeInstallationId(safeData.installationId),
    updatedAt: normalizeDateValue(safeData.updatedAt, new Date().toISOString()),
  };
}

/**
 * Apply only migration-safe knowledge-note changes before normalizing the
 * complete task payload. This function is deliberately pure and idempotent:
 * reading legacy data never writes it back or removes the legacy body/assets.
 */
function migrateKnowledgeTaskData(data) {
  const safeData = isRecord(data) ? data : {};
  const tasks = Array.isArray(safeData.tasks)
    ? safeData.tasks.map((task) => {
        if (!isRecord(task)) return task;
        const hasLegacyString = typeof task.knowledgeNote === "string";
        const hasCurrentBody = typeof task.notes === "string" && task.notes.trim().length > 0;
        const legacyBody = hasLegacyString && (!hasCurrentBody || task.notes === undefined)
          ? task.knowledgeNote
          : task.notes;
        const migrated = { ...task, notes: normalizeText(legacyBody) };
        if (typeof task.knowledgeNote === "string") delete migrated.knowledgeNote;
        return migrated;
      })
    : safeData.tasks;
  return {
    ...safeData,
    knowledgeSchemaVersion: KNOWLEDGE_MIGRATION_VERSION,
    tasks,
  };
}

// Phase21 records one history line per changed brief-editing session. The field
// existed in the model before but was never persisted, so it is normalized here:
// [[time, text], ...] pairs, newest first, bounded.
const TASK_HISTORY_LIMIT = 60;

/**
 * Phase26 -- normalize one archived record.
 *
 * Snapshots are deliberately preserved rather than re-derived: a task snapshot
 * has to keep its own id, group, order and knowledge-note binding, because that
 * is exactly what a later restore writes back. Only the envelope is validated,
 * so an unknown future field inside a snapshot survives a round trip.
 */
function normalizeRecentlyDeletedEntry(entry, seenIds) {
  if (!isRecord(entry)) return null;
  const kind = RECENTLY_DELETED_KINDS.has(entry.kind) ? entry.kind : "";
  if (!kind) return null;
  const id = normalizeIdentifier(entry.id);
  if (!id || seenIds.has(id)) return null;
  seenIds.add(id);
  const normalized = {
    ...entry,
    id,
    kind,
    deletedAt: typeof entry.deletedAt === "string" ? entry.deletedAt : "",
    transactionId: normalizeIdentifier(entry.transactionId),
    objectId: normalizeIdentifier(entry.objectId),
  };
  if (kind === "task" || kind === "quick") {
    const record = isRecord(entry.record) ? entry.record : null;
    if (!record) return null;
    normalized.record = record;
    normalized.objectId = normalizeIdentifier(entry.objectId) || normalizeIdentifier(record.id);
    normalized.groupId = normalizeIdentifier(entry.groupId);
    normalized.groupTitle = normalizeText(entry.groupTitle);
    normalized.position = normalizeOrder(entry.position, 1);
    normalized.hadKnowledgeNoteBinding = Boolean(entry.hadKnowledgeNoteBinding);
  } else if (kind === "node") {
    const record = isRecord(entry.record) ? entry.record : null;
    if (!record) return null;
    normalized.record = record;
    normalized.ownerTaskId = normalizeIdentifier(entry.ownerTaskId);
    normalized.ownerTaskTitle = normalizeText(entry.ownerTaskTitle);
    normalized.parentNodeId = normalizeIdentifier(entry.parentNodeId);
    normalized.parentNodeTitle = normalizeText(entry.parentNodeTitle);
    normalized.position = normalizeOrder(entry.position, 1);
    normalized.nodeCount = normalizeOrder(entry.nodeCount, countNodes(record));
    normalized.objectId = normalizeIdentifier(entry.objectId) || normalizeIdentifier(record.id);
  } else if (kind === "group") {
    normalized.groupId = normalizeIdentifier(entry.groupId);
    normalized.title = normalizeText(entry.title);
    normalized.groupOrder = normalizeOrder(entry.groupOrder, 1);
    normalized.policy = RECENTLY_DELETED_GROUP_POLICIES.has(entry.policy) ? entry.policy : "keep";
    normalized.targetGroupId = normalizeIdentifier(entry.targetGroupId);
    normalized.wasGrowthSource = Boolean(entry.wasGrowthSource);
    normalized.groupReplacementId = normalizeIdentifier(entry.groupReplacementId);
    normalized.members = Array.isArray(entry.members)
      ? entry.members.filter(isRecord).map((member) => ({
        ...member,
        record: isRecord(member.record) ? member.record : null,
        position: normalizeOrder(member.position, 1),
      })).filter((member) => member.record)
      : [];
    normalized.migrated = Array.isArray(entry.migrated) ? entry.migrated.filter(isRecord).map((item) => ({
      taskId: normalizeIdentifier(item.taskId),
      direction: normalizeIdentifier(item.direction),
      revision: normalizeText(item.revision),
    })).filter((item) => item.taskId) : [];
    normalized.objectId = normalizeIdentifier(entry.objectId) || normalized.groupId;
  } else if (kind === "note") {
    normalized.ownerTaskId = normalizeIdentifier(entry.ownerTaskId);
    normalized.ownerTaskTitle = normalizeText(entry.ownerTaskTitle);
    normalized.groupId = normalizeIdentifier(entry.groupId);
    normalized.title = normalizeText(entry.title);
    normalized.body = normalizeText(entry.body);
    normalized.sourcePath = normalizeText(entry.sourcePath);
    normalized.knowledgeNote = isRecord(entry.knowledgeNote) ? entry.knowledgeNote : null;
    normalized.objectId = normalizeIdentifier(entry.objectId) || normalized.ownerTaskId;
  }
  return normalized;
}

function normalizeRecentlyDeleted(value) {
  const seenIds = new Set();
  return (Array.isArray(value) ? value : [])
    .map((entry) => normalizeRecentlyDeletedEntry(entry, seenIds))
    .filter(Boolean)
    .sort((a, b) => (Date.parse(b.deletedAt) || 0) - (Date.parse(a.deletedAt) || 0));
}

function normalizeTaskHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter((entry) => Array.isArray(entry) && entry.length >= 2)
    .map(([time, text]) => [normalizeText(time).slice(0, 40), normalizeText(text).slice(0, 200)])
    .filter(([time, text]) => time || text)
    .slice(0, TASK_HISTORY_LIMIT);
}

function normalizeTasks(tasks, documents = []) {
  const seenTaskIds = new Set();
  return (Array.isArray(tasks) ? tasks : [])
    .filter(isRecord)
    .map((task, index) => {
      const taskId = uniqueDataId(task.id, "task", seenTaskIds);
      const createdAt = normalizeDateValue(task.createdAt, new Date().toISOString());
      const updatedAt = normalizeDateValue(task.updatedAt, createdAt);
      const hypothesis = normalizeText(task.hypothesis);
      return {
        ...task,
        id: taskId,
        order: normalizeOrder(task.order, index + 1),
        todayTaskOrder: normalizeTodayWidgetOrder(task.todayTaskOrder),
        todayQuickCaptureOrder: normalizeTodayWidgetOrder(task.todayQuickCaptureOrder),
        groupId: Object.hasOwn(task, "groupId") ? normalizeIdentifier(task.groupId) : DEFAULT_GROUP.id,
        title: normalizeText(task.title),
        knowledgeLinks: knowledgeDocument.normalizeNoteLinks(task.knowledgeLinks),
        knowledgeNoteIds: knowledgeDocument.taskNoteIds({ ...task, id: taskId }, Array.isArray(documents) ? documents : []),
        activeKnowledgeId: normalizeIdentifier(task.activeKnowledgeId),
        knowledgeNote: knowledgeDocument.normalizeKnowledgeNote(task.knowledgeNote, {
          taskId,
          title: normalizeText(task.title),
          createdAt,
          updatedAt,
        }),
        description: normalizeText(task.description),
        status: TASK_STATUSES.has(task.status) ? task.status : "active",
        priority: PRIORITIES.has(task.priority) ? task.priority : "medium",
        tags: normalizeTaskTags(task.tags),
        recurrence: normalizeTaskRecurrence(task.recurrence),
        notes: normalizeText(task.notes),
        hypothesis,
        hypothesisUpdatedAt: normalizeOptionalDateValue(
          task.hypothesisUpdatedAt,
          hypothesis ? updatedAt : "",
        ),
        conclusion: normalizeText(task.conclusion),
        history: normalizeTaskHistory(task.history),
        navigationRecovery: workNavigationModel.normalizeRecovery(task.navigationRecovery),
        estimateMinutes: clampNumber(task.estimateMinutes, 0, 0, 720),
        origin: workNavigationModel.normalizeOrigin(task.origin),
        createdAt,
        updatedAt,
        deadlineAt: normalizeOptionalDateValue(task.deadlineAt),
        deadlineReminderMinutes: normalizeDeadlineReminderMinutes(task.deadlineReminderMinutes),
        resolvedAt: normalizeOptionalDateValue(task.resolvedAt),
        nodes: normalizeTaskNodes(task.nodes, taskId),
      };
    });
}

function normalizeTaskNodes(nodes, taskId = "", parentId = null, seenNodeIds = new Set()) {
  return Array.isArray(nodes)
    ? nodes
        .filter(isRecord)
        .map((node, index) => {
          const nodeId = uniqueDataId(node.id, "node", seenNodeIds);
          const createdAt = normalizeDateValue(node.createdAt, new Date().toISOString());
          return {
            ...node,
            id: nodeId,
            taskId,
            parentId,
            order: normalizeOrder(node.order, index + 1),
            type: parentId ? "subtask" : "step",
            title: normalizeText(node.title),
            status: nodeStates.normalizeStatus(node.status),
            note: normalizeText(node.note),
            hypothesis: normalizeText(node.hypothesis),
            conclusion: normalizeText(node.conclusion),
            createdAt,
            updatedAt: normalizeDateValue(node.updatedAt, createdAt),
            collapsed: Boolean(node.collapsed),
            downstreamNodeIds: Array.isArray(node.downstreamNodeIds) ? [...new Set(node.downstreamNodeIds.filter(id => typeof id === "string" && id.trim() && id !== nodeId))] : [],
            children: normalizeTaskNodes(node.children, taskId, nodeId, seenNodeIds),
          };
        })
    : [];
}

function normalizeTaskGroups(groups, tasks) {
  const seen = new Set();
  const normalized = (Array.isArray(groups) ? groups : [])
    .filter(isRecord)
    .map((group, index) => {
      const groupId = normalizeIdentifier(group.id);
      const title = normalizeText(group.title).trim();
      if (!groupId || !title || seen.has(groupId)) return null;
      seen.add(groupId);
      return { ...group, id: groupId, title, order: normalizeOrder(group.order, index + 1) };
    })
    .filter(Boolean);

  tasks.forEach((task) => {
    if (task.groupId && !seen.has(task.groupId)) {
      seen.add(task.groupId);
      normalized.push({
        id: task.groupId,
        title: task.groupId === DEFAULT_GROUP.id ? DEFAULT_GROUP.title : "未命名分组",
        order: normalized.length + 1,
      });
    }
  });
  return normalized
    .sort((a, b) => a.order - b.order)
    .map((group, index) => ({ ...group, order: index + 1 }));
}

function normalizeTaskTags(tags) {
  if (Array.isArray(tags)) {
    return {
      today: tags.includes("today"),
      later: tags.includes("later"),
      blocked: tags.includes("blocked"),
    };
  }
  const raw = isRecord(tags) ? tags : {};
  return {
    today: Boolean(raw.today),
    later: Boolean(raw.later),
    blocked: Boolean(raw.blocked),
  };
}

function normalizeTaskRecurrence(value) {
  const raw = isRecord(value) ? value : {};
  const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
  const legacyWeekday = Number(raw.weekday);
  const legacyWeekdays = Number.isInteger(legacyWeekday) && legacyWeekday >= 0 && legacyWeekday <= 6
    ? [legacyWeekday]
    : [];
  const weekdays = Array.isArray(raw.weekdays)
    ? weekdayOrder.filter((weekday) => raw.weekdays.some((entry) => Number(entry) === weekday))
    : legacyWeekdays;
  return {
    frequency: RECURRENCE_FREQUENCIES.has(raw.frequency) ? raw.frequency : "none",
    weekdays,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time || "") ? raw.time : "09:00",
    lastCompletedOccurrence: normalizeLocalDateKey(raw.lastCompletedOccurrence),
  };
}

function normalizeLocalDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? String(value) : "";
}

function normalizeFlowWidths(value) {
  const raw = isRecord(value) ? value : {};
  return {
    title: clampNumber(raw.title, 360, 190, 720),
    note: clampNumber(raw.note, 330, 180, 760),
  };
}

function normalizeAttachments(value) {
  const raw = isRecord(value) ? value : {};
  const images = isRecord(raw.images) ? raw.images : {};
  return {
    images: Object.fromEntries(
      Object.entries(images).filter(
        ([imageId, dataUrl]) =>
          Boolean(normalizeIdentifier(imageId)) &&
          typeof dataUrl === "string" &&
          dataUrl.startsWith("data:image/"),
      ),
    ),
  };
}

function migrateLegacyFont(value) {
  if (value === "songti") return { zhFont: "songti", enFont: "inter" };
  if (value === "heiti") return { zhFont: "heiti", enFont: "inter" };
  if (value === "mono") return { zhFont: "yahei", enFont: "mono" };
  if (value === "system" || value === "yahei") return { zhFont: "system", enFont: "inter" };
  return { zhFont: "heiti", enFont: "times" };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Count a node subtree; also used to size an archived node snapshot. */
function countNodes(node) {
  if (!isRecord(node)) return 0;
  return 1 + (Array.isArray(node.children) ? node.children.reduce((total, child) => total + countNodes(child), 0) : 0);
}

function normalizeText(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function normalizeIdentifier(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueDataId(value, prefix, seen) {
  let normalized = normalizeIdentifier(value);
  if (!normalized || seen.has(normalized)) normalized = `${prefix}_${crypto.randomUUID()}`;
  seen.add(normalized);
  return normalized;
}

function normalizeOrder(value, fallback) {
  const order = Number(value);
  return Number.isFinite(order) && order > 0 ? Math.round(order) : fallback;
}

function normalizeTodayWidgetOrder(value) {
  const order = Math.round(Number(value));
  return Number.isFinite(order) && order > 0 ? order : 0;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeDateValue(value, fallback) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function normalizeOptionalDateValue(value, fallback = "") {
  return value ? normalizeDateValue(value, fallback) : fallback;
}

function normalizeDeadlineReminderMinutes(value) {
  if (value === null || value === false || value === "none") return null;
  const minutes = Number(value);
  return DEADLINE_REMINDER_MINUTES.has(minutes) ? minutes : DEFAULT_DEADLINE_REMINDER_MINUTES;
}

function normalizeInstallationId(value) {
  const normalized = normalizeIdentifier(value).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : crypto.randomUUID();
}

module.exports = {
  DATA_FILE,
  DATA_VERSION,
  WORKSPACE_FILE,
  isNewerThanSupported,
  readOnDiskDataVersion,
  KNOWLEDGE_MIGRATION_VERSION,
  RECENTLY_DELETED_SCHEMA_VERSION,
  dataFilePath,
  migrateKnowledgeTaskData,
  normalizeRecentlyDeleted,
  normalizeTaskData,
  readTaskData,
  validateTaskDataStructure,
  verifyTaskWorkspace,
  writeTaskData,
};

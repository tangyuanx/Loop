// ============================================================
// Loop -- frontend application logic
// All state management, DOM rendering, event handling,
// Markdown processing, and Milkdown editor integration.
// ============================================================
const STORAGE_KEY = "task-flow-sheet-prototype-v2";
const FLOW_WIDTH_KEY = "task-flow-column-widths-v1";
const THEME_KEY = "task-track-theme";
const ZH_FONT_KEY = "task-track-zh-font";
const EN_FONT_KEY = "task-track-en-font";
const FONT_SCALE_KEY = "task-track-font-scale";
const TASK_FILTER_KEY = "task-track-task-filter";
const PRIORITY_FILTER_KEY = "task-track-priority-filter";
const CAPTURE_SOURCE_FILTER_KEY = "task-track-capture-source-filter";
const NEW_TASK_PRIORITY_KEY = "task-track-new-task-priority";
const TASK_GROUPS_KEY = "task-track-groups";
const ACTIVE_GROUP_KEY = "task-track-active-group";
const SIDEBAR_WIDTH_KEY = "task-track-sidebar-width";
const DETAIL_HEIGHT_KEY = "task-track-detail-height";
const ATTACHMENTS_KEY = "task-track-attachments";
const INSTALLATION_ID_KEY = "task-track-installation-id";
const KNOWLEDGE_RECOVERY_KEY = "task-track-knowledge-recovery-v1";
const WORK_NAVIGATION_KEY = "task-track-work-navigation-v1";
// Phase26 -- Recently Deleted. The archive travels inside task-data.json so a
// delete and its archive entry share one atomic write; in a browser it falls
// back to its own localStorage key, like every other collection here.
const RECENTLY_DELETED_KEY = "task-track-recently-deleted-v1";
const RECENTLY_DELETED_SCHEMA_VERSION = 1;
const KNOWLEDGE_RECOVERY_DEBOUNCE_MS = 800;
const KNOWLEDGE_RECOVERY_MAX_INTERVAL_MS = 5000;
const DATA_VERSION = 2;
const KNOWLEDGE_MIGRATION_VERSION = 1;
const RECENTLY_DELETED_LIMIT = 500;
/**
 * Calendar list column: remaining workspace height, internally scrolling tasks.
 *
 * shell.css is the frozen Demo baseline and index.html must keep the Demo's
 * exact stylesheet order (both are asserted by tests), so this correction is
 * injected here instead. It must run at load time, before the first paint, or
 * the column would flash at its content height.
 *
 * Without it the agenda column is sized to its content: 30 tasks measured
 * 4861px against an 820px window, so every entry below the fold was unreachable.
 */
(function installAgendaLayoutStyles() {
  const id = "loop-agenda-layout";
  // The renderer tests load this file in a VM without a full document.
  if (!document?.head || typeof document.getElementById !== "function") return;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
.calendar-layout{height:auto;max-height:none;min-height:0;flex:1 1 auto;align-items:start}
.agenda{display:flex;flex-direction:column;max-height:100%;min-height:0;overflow:hidden}
.agenda-items{flex:0 1 auto;min-height:0;overflow-y:auto;padding-right:4px;margin-bottom:12px}
.agenda>.button,.agenda>.agenda-empty{flex:0 0 auto}
`;
  document.head.appendChild(style);
})();

const desktopStorage = window.personalTaskTrack?.storage;
const desktopDataBackup = window.personalTaskTrack?.dataBackup;
const desktopKnowledgeRecovery = window.personalTaskTrack?.knowledgeRecovery;
const desktopKnowledgeFile = window.personalTaskTrack?.knowledgeFile;
const desktopExport = window.personalTaskTrack?.export;
const desktopBugReports = window.personalTaskTrack?.bugReports;
const desktopUpdates = window.personalTaskTrack?.updates;
const desktopTodayWidget = window.personalTaskTrack?.todayWidget;
const desktopDialogs = window.personalTaskTrack?.dialogs;
const desktopDeadlineReminders = window.personalTaskTrack?.deadlineReminders;
const desktopEnvironment = window.personalTaskTrack?.environment || {};
const desktopPlatform = window.personalTaskTrack?.platform || "";
const APP_VERSION = window.personalTaskTrack?.appVersion || "";
const knowledgeDocument = globalThis.KnowledgeDocument;
const knowledgeRecoveryModel = globalThis.KnowledgeRecovery;
const workNavigationModel = globalThis.LoopWorkNavigationModel;

const priorityLabels = {

// ============================================================
// LABELS & CONFIGURATIONS
// ============================================================
  high: "高",
  medium: "中",
  low: "低",
};

const taskFilterLabels = {
  all: "全部",
  today: "今天",
  active: "未完成",
  done: "已完成",
  blocked: "卡住",
  later: "稍后",
};

const taskDeadlineFilterLabels = {
  all: "全部截止",
  today: "今天截止",
  week: "本周截止",
  overdue: "已逾期",
};

const priorityFilterLabels = {
  all: "全部",
  high: "高",
  medium: "中",
  low: "低",
};

const captureSourceFilterLabels = {
  all: "全部",
  task: "任务",
  quick: "速记",
};

const repositoryPriorityFilterLabels = {
  all: "全部",
  high: "高",
  medium: "中",
  low: "低",
};

const repositoryPriorityLabels = {
  high: "高",
  medium: "中",
  low: "低",
};

const themeLabels = {
  light: "浅色",
  dark: "深色",
};

const bugCategoryLabels = {
  malfunction: "功能异常",
  crash: "软件崩溃",
  data: "数据异常",
  display: "界面显示",
  performance: "性能问题",
  suggestion: "功能建议",
  other: "其他",
};

const zhFontLabels = {
  system: "系统中文",
  noto: "Noto Sans CJK SC（内置）",
  yahei: "微软雅黑",
  pingfang: "苹方",
  songti: "宋体",
  simsun: "中易宋体",
  fangsong: "仿宋",
  heiti: "黑体",
  kaiti: "楷体",
};

const enFontLabels = {
  inter: "Inter（内置）",
  system: "System UI",
  segoe: "Segoe UI",
  arial: "Arial",
  helvetica: "Helvetica",
  verdana: "Verdana",
  trebuchet: "Trebuchet MS",
  tahoma: "Tahoma",
  times: "Times New Roman",
  georgia: "Georgia",
  courier: "Courier New",
  mono: "Monospace",
};

// Display text follows the Demo's ladder (紧凑 / 标准（推荐）/ 较大 / 特大).
// The stored keys stay current/larger/large/largest so existing user data and
// the desktop schema are untouched; the numeric steps live in shell.js.
const fontScaleLabels = {
  current: "紧凑",
  larger: "标准（推荐）",
  large: "较大",
  largest: "特大",
};

const defaultFlowWidths = {
  title: 360,
  note: 330,
};

const flowWidthLimits = {
  title: [190, 720],
  note: [180, 760],
};

const defaultTaskGroup = { id: "group_inbox", title: "默认", order: 1 };
const ALL_TASKS_GROUP_ID = "group_all";
const UNGROUPED_TASKS_GROUP_ID = "group_ungrouped";
// The Demo's task-list column is 270px (--list-width). The persisted sidebar
// width preference now drives that column; existing wider values are kept.
const defaultSidebarWidth = 270;
const sidebarWidthLimits = [230, 460];
const defaultDetailHeight = 58;
const detailHeightLimits = [50, 82];
const recurrenceFrequencies = new Set(["none", "daily", "weekly"]);
const recurrenceFrequencyLabels = {
  none: "不循环",
  daily: "每天",
  weekly: "每周",
};
const deadlineReminderMinuteValues = new Set([0, 5, 15, 30, 60, 120, 1440, 2880, 10080]);
const defaultDeadlineReminderMinutes = 60;
const deadlineReminderLabels = {
  none: "不提醒",
  0: "截止时",
  5: "提前 5 分钟",
  15: "提前 15 分钟",
  30: "提前 30 分钟",
  60: "提前 1 小时",
  120: "提前 2 小时",
  1440: "提前 1 天",
  2880: "提前 2 天",
  10080: "提前 1 周",
};
const recurrenceWeekdayOrder = [1, 2, 3, 4, 5, 6, 0];
const recurrenceWeekdayLabels = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  0: "周日",
};
const taskTagLabels = {
  today: "Today",
  later: "稍后",
  blocked: "卡住",
};
const editFieldLabels = {
  title: "标题",
  description: "背景与目标",
  hypothesis: "当前判断与进展",
  conclusion: "结果与总结",
  priority: "优先级",
  groupId: "分组",
};

const reviewPresetLabels = {
  week: "本周",
  month: "本月",
  year: "今年",
  custom: "自定义",
  all: "全部",
};

const reviewDateFieldLabels = {
  updated: "更新日期",
  created: "创建日期",
  resolved: "解决日期",
};

const taskStatusValues = new Set(["active", "done"]);
const nodeStatusValues = new Set(["todo", "done", "blocked", "later"]);
const appUpdateStatuses = new Set(["idle", "unsupported", "checking", "latest", "available", "downloading", "downloaded", "preparing", "installing", "error"]);

let state = {

// ============================================================
// STATE -- single source of truth
// ============================================================
  tasks: [],
  taskGroups: [{ ...defaultTaskGroup }],
  activeGroupId: ALL_TASKS_GROUP_ID,
  editingGroupId: "",
  activeTaskId: "",
  selectedNodeId: "",
  recordDraft: "",
  query: "",
  taskFilter: "active",
  taskDateFilter: "",
  taskDeadlineFilter: "all",
  priorityFilter: "all",
  captureSourceFilter: "all",
  newTaskPriority: "medium",
  uiPreferences: loadBrowserUiPreferences(),
  markdownMode: "edit",
  theme: "light",
  zhFont: "heiti",
  enFont: "times",
  fontScale: "large",
  settingsOpen: false,
  calendarOpen: false,
  reviewOpen: false,
  feedbackOpen: false,
  feedbackDraft: createEmptyFeedbackDraft(),
  feedbackErrors: {},
  feedbackSubmitting: false,
  feedbackResult: null,
  feedbackMessage: "",

// ============================================================
// RUNTIME VARIABLES
// ============================================================
  reviewPreset: "week",
  // Phase18: the Today route's own view — active list or today's completions.
  todayFilter: "active",
  // Phase20: the task brief is collapsed while a node record is open and can be
  // expanded from the toggle in a wide window.
  scale20SummaryOpen: false,
  reviewDateField: "updated",
  reviewStartDate: "",
  reviewEndDate: "",
  calendarMonth: "",
  calendarSelectedDate: "",
  taskPane: "flow",
  nodeDetailFullscreen: false,
  searchOpen: false,
  focusTaskTitleId: "",
  focusNodeTitleId: "",
  focusGroupTitleId: "",
  focusSearch: false,
  searchCursor: 0,
  revealTaskId: "",
  markdownSelection: null,
  restoreMarkdownFocus: false,
  flowWidths: { ...defaultFlowWidths },
  sidebarWidth: defaultSidebarWidth,
  detailHeight: defaultDetailHeight,
  attachments: { images: {} },
  // Phase26: archived deletions, newest first. Each entry is a snapshot plus
  // the stable ids needed to put the object back where it came from.
  recentlyDeleted: [],
  knowledgeAssets: {},
  knowledgeFileIssues: {},
  knowledgeRecovery: { version: 1, records: {} },
  workNavigation: workNavigationModel.defaultWorkNavigation(),
  installationId: "",
  conclusionPromptTaskId: "",
  flowPromptTaskId: "",
  knowledgeDraftPrompt: null,
  contextMenu: null,
  nodeDetailPosition: null,

// ============================================================
// SHELL UI STATE (see src/shell.js)
// ============================================================
  navCollapsed: false,
  shellDrafts: {},
  taskMenuOpen: false,
  nodeRecordPreview: false,
  knowledgeWidth: "default",
  helpTopicOpen: -1,
  createDraft: null,
  createError: "",
  createResumed: false,
  journeyReceipt: null,
  noteSummaryOpen: false,
  globalListReturn: null,
  deadlineDraft: null,
  recurrenceDraft: null,
};

let dataProtectionMessage = "";
let dataTransferInProgress = false;
let dataBackupOperation = { busy: false, message: "" };
let updatePreferenceInFlight = false;
let saveTimer = 0;
let nodeDetailSaveFeedbackTimer = 0;
let activeSettingsPage = "appearance";
let settingsMotion = "none";
let pendingPayload = null;
// Phase C: fingerprint of the payload already queued, and of the last payload
// the main process acknowledged. Navigation re-runs save() without any model
// change, and those calls must not queue another whole-database write.
let pendingPayloadFingerprint = "";
let pendingSaveSince = 0;
let lastWrittenPayloadFingerprint = "";
// Cheap fingerprint of the persistable state, used as save()'s fast path so an
// ordinary render does not serialize the task database just to find no change.
let lastWrittenPersistedRevision = "";
let pendingPersistedRevision = "";
let saveInFlight = false;
let saveInFlightPromise = null;
let localSaveOutcome = "ready";
let taskDragState = null;
let flowNodeDragState = null;
let suppressTaskClickUntil = 0;
let suppressFlowNodeClickUntil = 0;
let flowNodeLastTitleClick = null;
let recurrenceScheduleTimer = 0;
let recurringTodaySignature = "";
let recurrencePopoverTaskId = "";
let taskGroupSelectTaskId = "";
let repositoryGroupPickerOpen = false;
let repositoryFilterMenuOpen = false;
let repositoryPriorityFilterOpen = false;
let repositoryGroupQuery = "";
let repositoryGroupTriggerLastClickAt = 0;
let taskPriorityMenu = null;
let deadlinePopoverTaskId = "";
let deadlinePickerDate = "";
let deadlinePickerMonth = "";
const milkdownEditors = new Map();
/**
 * Editor keys whose create() promise is still outstanding. render() can run
 * again before a mount resolves, so this keeps a second pass from building a
 * duplicate editor for the same host.
 */
const pendingMilkdownMounts = new Map();
const nodeNoteDrafts = new Map();
const nodeNoteSaveTimers = new Map();
const knowledgeRecoveryTimers = new Map();
const knowledgeExternalSnapshots = new Map();
let knowledgeRecoveryWriteQueue = Promise.resolve();
const knowledgeRecoveryWriteErrors = new Map();
let cachedKnowledgePane = null;
const cachedKnowledgePanes = new Map();
let appSwitchFocusSnapshot = null;
let appEditingPointerDown = false;
// What the user last asked the updater to do; an error then retries the same
// thing instead of always offering a download.
let lastUpdateAction = "check";
let appUpdateState = normalizeAppUpdateState({
  status: desktopUpdates ? "idle" : "unsupported",
  supported: Boolean(desktopUpdates),
  unsupportedReason: desktopUpdates ? "" : "development",
  automaticChecks: true,
  currentVersion: APP_VERSION,
});
let unsubscribeAppUpdates = null;
let unsubscribeTodayWidgetState = null;
let unsubscribeTodayWidgetOpenTask = null;
let unsubscribeTodayWidgetCompletion = null;
let unsubscribeTodayWidgetCreateTask = null;
let unsubscribeTodayWidgetUpdateTitle = null;
let unsubscribeTodayWidgetPromote = null;
let unsubscribeTodayWidgetDeleteQuickCapture = null;
let unsubscribeTodayWidgetMoveItem = null;
let unsubscribeTodayWidgetReorder = null;
let unsubscribeDeadlineReminderTask = null;
let unsubscribeDeadlineReminderCalendar = null;
let unsubscribeKnowledgeFileChanges = null;
let todayWidgetWindowState = { visible: Boolean(desktopTodayWidget) };
let deadlineReminderSignature = "";


// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function now() {
  // Phase18: persisted stamps follow the perceived clock, so a review time keeps
  // completion, history and Today membership coherent.
  return loopNow().toISOString();
}

async function confirmDestructiveAction(message, operation) {
  if (desktopDialogs?.confirmDestructive) {
    try {
      const confirmed = await desktopDialogs.confirmDestructive({ message, operation });
      state.restoreMarkdownFocus = false;
      return confirmed === true;
    } catch (error) {
      console.error("Failed to open desktop confirmation dialog.", error);
    }
  }
  return globalThis.confirm(message);
}

function createEmptyFeedbackDraft() {
  return {
    title: "",
    category: "",
    description: "",
    reproductionSteps: "",
    contact: "",
    includeEnvironment: true,
    confirmed: false,
  };
}

function createInstallationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeInstallationId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : createInstallationId();
}

/**
 * Create a new task node (step or subtask).
 * @param {string} taskId - Parent task ID
 * @param {string|null} parentId - null for root-level steps, node ID for subtasks
 * @param {number} order - Display order within parent
 * @returns {object} New node object with default fields
 */
function makeNode(taskId, parentId, order) {
  return {
    id: id("node"),
    taskId,
    parentId,
    order,
    type: parentId ? "subtask" : "step",
    title: "",
    status: "todo",
    note: "",
    hypothesis: "",
    conclusion: "",
    createdAt: now(),
    updatedAt: now(),
    statusChangedAt: now(),
    completedAt: "",
    collapsed: false,
    children: [],
  };
}


// ============================================================
// DATA LOADING (localStorage / Electron IPC)
// ============================================================
/**
 * Load tasks from localStorage (browser-only fallback).
 * @returns {Array} Parsed task array or empty array
 */
function loadBrowserTasks() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeTasks(parsed) : [];
  } catch {
    return [];
  }
}

/** Load the Recently Deleted archive from localStorage (browser-only fallback). */
function loadBrowserRecentlyDeleted() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(RECENTLY_DELETED_KEY) || "null");
  } catch (_) {
    saved = null;
  }
  return normalizeRecentlyDeleted(saved);
}

function loadBrowserWorkNavigation(taskGroups = []) {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(WORK_NAVIGATION_KEY) || "null");
  } catch (_) {
    saved = null;
  }
  return workNavigationModel.normalizeWorkNavigation(saved, {
    groupIds: taskGroups.map((group) => group.id),
  });
}

// ------------------------------------------------------------
// Phase26 -- Recently Deleted archive normalization
//
// Mirrors storage.cjs so that the Electron path and the browser fallback agree
// on the shape, and so a payload the renderer sends is already in the form the
// main process will validate. Snapshots are kept as-is: a task snapshot has to
// retain its own id, group, order and knowledge-note binding, because that is
// exactly what a restore writes back.
// ------------------------------------------------------------

const RECENTLY_DELETED_KINDS = new Set(["task", "quick", "group", "node", "note"]);
const RECENTLY_DELETED_GROUP_POLICIES = new Set(["keep", "delete"]);

function normalizeRecentlyDeleted(value) {
  const seenIds = new Set();
  return (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .map((entry) => {
      const kind = RECENTLY_DELETED_KINDS.has(entry.kind) ? entry.kind : "";
      const id = normalizeIdentifier(entry.id);
      if (!kind || !id || seenIds.has(id)) return null;
      seenIds.add(id);
      const normalized = {
        ...entry,
        id,
        kind,
        deletedAt: normalizeDateValue(entry.deletedAt, now()),
        transactionId: normalizeIdentifier(entry.transactionId),
        objectId: normalizeIdentifier(entry.objectId),
      };
      if (kind === "task" || kind === "quick") {
        if (!isRecord(entry.record)) return null;
        normalized.record = entry.record;
        normalized.objectId = normalizeIdentifier(entry.objectId) || normalizeIdentifier(entry.record.id);
        normalized.groupId = normalizeIdentifier(entry.groupId);
        normalized.groupTitle = normalizeText(entry.groupTitle);
        normalized.position = normalizeRecentlyDeletedOrder(entry.position);
        normalized.hadKnowledgeNoteBinding = Boolean(entry.hadKnowledgeNoteBinding);
      } else if (kind === "node") {
        if (!isRecord(entry.record)) return null;
        normalized.record = entry.record;
        normalized.ownerTaskId = normalizeIdentifier(entry.ownerTaskId);
        normalized.ownerTaskTitle = normalizeText(entry.ownerTaskTitle);
        normalized.parentNodeId = normalizeIdentifier(entry.parentNodeId);
        normalized.parentNodeTitle = normalizeText(entry.parentNodeTitle);
        normalized.position = normalizeRecentlyDeletedOrder(entry.position);
        normalized.nodeCount = normalizeRecentlyDeletedOrder(entry.nodeCount);
        normalized.objectId = normalizeIdentifier(entry.objectId) || normalizeIdentifier(entry.record.id);
      } else if (kind === "group") {
        normalized.groupId = normalizeIdentifier(entry.groupId);
        normalized.title = normalizeText(entry.title);
        normalized.groupOrder = normalizeRecentlyDeletedOrder(entry.groupOrder);
        normalized.policy = RECENTLY_DELETED_GROUP_POLICIES.has(entry.policy) ? entry.policy : "keep";
        normalized.targetGroupId = normalizeIdentifier(entry.targetGroupId);
        normalized.wasGrowthSource = Boolean(entry.wasGrowthSource);
        normalized.groupReplacementId = normalizeIdentifier(entry.groupReplacementId);
        normalized.members = Array.isArray(entry.members)
          ? entry.members.filter(isRecord).filter((member) => isRecord(member.record)).map((member) => ({
            ...member,
            record: member.record,
            position: normalizeRecentlyDeletedOrder(member.position),
          }))
          : [];
        normalized.migrated = Array.isArray(entry.migrated)
          ? entry.migrated.filter(isRecord).map((item) => ({
            taskId: normalizeIdentifier(item.taskId),
            direction: normalizeIdentifier(item.direction),
            revision: normalizeText(item.revision),
          })).filter((item) => item.taskId)
          : [];
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
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt))
    .slice(0, RECENTLY_DELETED_LIMIT);
}

function normalizeRecentlyDeletedOrder(value) {
  const order = Math.round(Number(value));
  return Number.isFinite(order) && order > 0 ? order : 1;
}

function normalizeTasks(tasks) {
  const seenTaskIds = new Set();
  return (Array.isArray(tasks) ? tasks : [])
    .filter(isRecord)
    .map((task, index) => {
      const taskId = uniqueDataId(task.id, "task", seenTaskIds);
      const createdAt = normalizeDateValue(task.createdAt, now());
      const updatedAt = normalizeDateValue(task.updatedAt, createdAt);
      const hypothesis = normalizeText(task.hypothesis);
      const legacyKnowledgeBody = task.notes === undefined && typeof task.knowledgeNote === "string"
        ? task.knowledgeNote
        : task.notes;
      return {
        ...task,
        id: taskId,
        order: normalizeOrder(task.order, index + 1),
        todayTaskOrder: normalizeTodayWidgetOrder(task.todayTaskOrder),
        todayQuickCaptureOrder: normalizeTodayWidgetOrder(task.todayQuickCaptureOrder),
        // An explicit empty groupId means "未分组". Legacy records that did
        // not contain the field still migrate into the historical default
        // group, so existing installations keep their previous grouping.
        groupId: Object.hasOwn(task, "groupId") ? normalizeIdentifier(task.groupId) : defaultTaskGroup.id,
        title: normalizeText(task.title),
        knowledgeNote: knowledgeDocument.normalizeKnowledgeNote(task.knowledgeNote, {
          taskId,
          title: normalizeText(task.title),
          createdAt,
          updatedAt,
        }),
        description: normalizeText(task.description),
        status: taskStatusValues.has(task.status) ? task.status : "active",
        priority: normalizePriority(task.priority),
        tags: normalizeTaskTags(task.tags),
        recurrence: normalizeTaskRecurrence(task.recurrence),
        notes: normalizeText(legacyKnowledgeBody),
        hypothesis,
        hypothesisUpdatedAt: normalizeOptionalDateValue(
          task.hypothesisUpdatedAt,
          hypothesis ? updatedAt : "",
        ),
        conclusion: normalizeText(task.conclusion),
        navigationRecovery: workNavigationModel.normalizeRecovery(task.navigationRecovery),
        estimateMinutes: Math.max(0, Math.min(720, Math.round(Number(task.estimateMinutes) || 0))),
        origin: workNavigationModel.normalizeOrigin(task.origin),
        createdAt,
        updatedAt,
        deadlineAt: normalizeOptionalDateValue(task.deadlineAt),
        deadlineReminderMinutes: normalizeDeadlineReminderMinutes(task.deadlineReminderMinutes),
        resolvedAt: normalizeOptionalDateValue(task.resolvedAt),
        nodes: normalizeNodes(task.nodes, taskId),
      };
    });
}

function normalizeNodes(nodes, taskId = "", parentId = null, seenNodeIds = new Set()) {
  return Array.isArray(nodes)
    ? nodes
        .filter(isRecord)
        .map((node, index) => {
          const nodeId = uniqueDataId(node.id, "node", seenNodeIds);
          const createdAt = normalizeDateValue(node.createdAt, now());
          return {
            ...node,
            id: nodeId,
            taskId,
            parentId,
            order: normalizeOrder(node.order, index + 1),
            type: parentId ? "subtask" : "step",
            title: normalizeText(node.title),
            status: nodeStatusValues.has(node.status) ? node.status : "todo",
            note: normalizeText(node.note),
            hypothesis: normalizeText(node.hypothesis),
            conclusion: normalizeText(node.conclusion),
            createdAt,
            updatedAt: normalizeDateValue(node.updatedAt, createdAt),
            statusChangedAt: normalizeOptionalDateValue(
              node.statusChangedAt,
              node.updatedAt || createdAt,
            ),
            completedAt: normalizeOptionalDateValue(node.completedAt),
            collapsed: Boolean(node.collapsed),
            children: normalizeNodes(node.children, taskId, nodeId, seenNodeIds),
          };
        })
    : [];
}

function normalizeTaskTags(tags) {
  if (Array.isArray(tags)) {
    return {
      today: tags.includes("today"),
      later: tags.includes("later"),
      blocked: tags.includes("blocked"),
    };
  }
  const raw = tags && typeof tags === "object" ? tags : {};
  return {
    today: Boolean(raw.today),
    later: Boolean(raw.later),
    blocked: Boolean(raw.blocked),
  };
}

function normalizeTaskRecurrence(value) {
  const raw = isRecord(value) ? value : {};
  const legacyWeekday = Number(raw.weekday);
  const legacyWeekdays = Number.isInteger(legacyWeekday) && legacyWeekday >= 0 && legacyWeekday <= 6
    ? [legacyWeekday]
    : [];
  const weekdays = Array.isArray(raw.weekdays)
    ? recurrenceWeekdayOrder.filter((weekday) => raw.weekdays.some((value) => Number(value) === weekday))
    : legacyWeekdays;
  return {
    frequency: recurrenceFrequencies.has(raw.frequency) ? raw.frequency : "none",
    weekdays,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time || "") ? raw.time : "09:00",
    lastCompletedOccurrence: normalizeTaskDateFilter(raw.lastCompletedOccurrence),
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function isEditableTarget(target) {
  const element = target;
  return Boolean(element && (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.isContentEditable ||
    element.closest?.('[contenteditable="true"]')
  ));
}

function isKnowledgeSaveShortcut(event) {
  return (
    !event.isComposing &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.key.toLowerCase() === "s"
  );
}

function normalizeIdentifier(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueDataId(value, prefix, seen) {
  let normalized = normalizeIdentifier(value);
  if (!normalized || seen.has(normalized)) normalized = id(prefix);
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

function normalizeDateValue(value, fallback) {
  const date = safeDate(value);
  return date ? date.toISOString() : fallback;
}

function normalizeOptionalDateValue(value, fallback = "") {
  return value ? normalizeDateValue(value, fallback) : fallback;
}

function normalizeDeadlineReminderMinutes(value) {
  if (value === null || value === false || value === "none") return null;
  const minutes = Number(value);
  return deadlineReminderMinuteValues.has(minutes) ? minutes : defaultDeadlineReminderMinutes;
}

function normalizeAttachments(value) {
  const raw = value && typeof value === "object" ? value : {};
  const images = raw.images && typeof raw.images === "object" ? raw.images : {};
  return {
    images: Object.fromEntries(
      Object.entries(images).filter(([, dataUrl]) => typeof dataUrl === "string" && dataUrl.startsWith("data:image/")),
    ),
  };
}

function normalizeTaskGroups(groups, tasks = []) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const seen = new Set();
  const normalized = safeGroups
    .map((group, index) => {
      const raw = group && typeof group === "object" ? group : {};
      const title = String(raw.title || "").trim();
      const groupId = String(raw.id || "").trim();
      if (!groupId || !title || seen.has(groupId)) return null;
      seen.add(groupId);
      return {
        id: groupId,
        title,
        order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index + 1,
      };
    })
    .filter(Boolean);

  tasks.forEach((task) => {
    if (task.groupId && !seen.has(task.groupId)) {
      seen.add(task.groupId);
      normalized.push({
        id: task.groupId,
        title: task.groupId === defaultTaskGroup.id ? defaultTaskGroup.title : "未命名分组",
        order: normalized.length + 1,
      });
    }
  });

  return sort(normalized).map((group, index) => ({ ...group, order: index + 1 }));
}

function normalizeActiveGroupId(value, groups) {
  return value === ALL_TASKS_GROUP_ID || value === UNGROUPED_TASKS_GROUP_ID || groups.some((group) => group.id === value)
    ? value
    : groups[0]?.id || UNGROUPED_TASKS_GROUP_ID;
}

function loadBrowserFlowWidths() {
  const raw = localStorage.getItem(FLOW_WIDTH_KEY);
  if (!raw) return { ...defaultFlowWidths };
  try {
    const parsed = JSON.parse(raw);
    return Object.fromEntries(
      Object.keys(defaultFlowWidths).map((key) => [key, normalizeFlowWidth(key, parsed?.[key])]),
    );
  } catch {
    return { ...defaultFlowWidths };
  }
}

function normalizeLoadedFlowWidths(value) {
  const raw = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Object.keys(defaultFlowWidths).map((key) => [key, normalizeFlowWidth(key, raw[key])]));
}

function normalizeTheme(value) {
  return value === "dark" ? "dark" : "light";
}

function normalizeTaskFilter(value) {
  return Object.hasOwn(taskFilterLabels, value) ? value : "active";
}

function normalizeTaskDateFilter(value) {
  const text = String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? text : "";
}

function normalizePriorityFilter(value) {
  return Object.hasOwn(priorityFilterLabels, value) ? value : "all";
}

function normalizeCaptureSourceFilter(value) {
  return Object.hasOwn(captureSourceFilterLabels, value) ? value : "all";
}

function normalizePriority(value) {
  return Object.hasOwn(priorityLabels, value) ? value : "medium";
}

function normalizeZhFont(value) {
  return Object.hasOwn(zhFontLabels, value) ? value : "heiti";
}

function normalizeEnFont(value) {
  return Object.hasOwn(enFontLabels, value) ? value : "times";
}

function normalizeFontScale(value) {
  // A fresh install matches the Demo default (标准 = 1.08).
  return Object.hasOwn(fontScaleLabels, value) ? value : "larger";
}

function migrateLegacyFont(value) {
  if (value === "songti") return { zhFont: "songti", enFont: "inter" };
  if (value === "heiti") return { zhFont: "heiti", enFont: "inter" };
  if (value === "mono") return { zhFont: "yahei", enFont: "mono" };
  if (value === "system" || value === "yahei") return { zhFont: "system", enFont: "inter" };
  return { zhFont: "heiti", enFont: "times" };
}

function loadBrowserTheme() {
  return normalizeTheme(localStorage.getItem(THEME_KEY));
}

function loadBrowserTypography() {
  const legacy = migrateLegacyFont(localStorage.getItem("task-track-font"));
  return {
    zhFont: normalizeZhFont(localStorage.getItem(ZH_FONT_KEY) || legacy.zhFont),
    enFont: normalizeEnFont(localStorage.getItem(EN_FONT_KEY) || legacy.enFont),
    fontScale: normalizeFontScale(localStorage.getItem(FONT_SCALE_KEY)),
  };
}

function normalizeUiPreferences(value) {
  return { continuous: value?.continuous !== false, follow: value?.follow !== false, workNavigationEnabled: value?.workNavigationEnabled === true };
}

function loadBrowserUiPreferences() {
  let interaction = {};
  try { interaction = JSON.parse(localStorage.getItem("loop.interaction28")) || {}; } catch {}
  return normalizeUiPreferences({ ...interaction, workNavigationEnabled: localStorage.getItem("loop-work-rhythm-v1:enabled") === "1" });
}

globalThis.LoopUiPreferences = {
  snapshot: () => ({ ...state.uiPreferences }),
  update(patch) {
    state.uiPreferences = normalizeUiPreferences({ ...state.uiPreferences, ...patch });
    save();
  },
};

function loadBrowserPreferences() {
  return {
    taskFilter: normalizeTaskFilter(localStorage.getItem(TASK_FILTER_KEY)),
    priorityFilter: normalizePriorityFilter(localStorage.getItem(PRIORITY_FILTER_KEY)),
    captureSourceFilter: normalizeCaptureSourceFilter(localStorage.getItem(CAPTURE_SOURCE_FILTER_KEY)),
    newTaskPriority: normalizePriority(localStorage.getItem(NEW_TASK_PRIORITY_KEY)),
  };
}

function loadBrowserTaskGroups(tasks) {
  const raw = localStorage.getItem(TASK_GROUPS_KEY);
  try {
    return normalizeTaskGroups(raw ? JSON.parse(raw) : [], tasks);
  } catch {
    return normalizeTaskGroups([], tasks);
  }
}

function loadBrowserSidebarWidth() {
  return normalizeSidebarWidth(localStorage.getItem(SIDEBAR_WIDTH_KEY));
}

function loadBrowserDetailHeight() {
  return normalizeDetailHeight(localStorage.getItem(DETAIL_HEIGHT_KEY));
}

function loadBrowserAttachments() {
  const raw = localStorage.getItem(ATTACHMENTS_KEY);
  try {
    return normalizeAttachments(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeAttachments({});
  }
}

function loadBrowserInstallationId() {
  return normalizeInstallationId(localStorage.getItem(INSTALLATION_ID_KEY));
}

function loadBrowserKnowledgeRecovery() {
  const raw = localStorage.getItem(KNOWLEDGE_RECOVERY_KEY);
  try {
    return knowledgeRecoveryModel.normalizeRecoveryData(raw ? JSON.parse(raw) : {});
  } catch {
    return knowledgeRecoveryModel.normalizeRecoveryData({});
  }
}

async function loadKnowledgeRecovery() {
  if (desktopKnowledgeRecovery?.read) {
    try {
      return knowledgeRecoveryModel.normalizeRecoveryData(await desktopKnowledgeRecovery.read());
    } catch (error) {
      console.error("Failed to read knowledge note recovery data.", error);
    }
  }
  return loadBrowserKnowledgeRecovery();
}

function recoveryRecordForTask(task, content, assets = []) {
  const note = task?.knowledgeNote || {};
  return knowledgeRecoveryModel.normalizeRecoveryRecord({
    noteId: note.noteId || task?.id,
    content,
    updatedAt: now(),
    baseFileHash: note.lastSavedHash,
    assets,
  });
}

function restoreKnowledgeRecoveryAssets(record) {
  const assets = Array.isArray(record?.assets) ? record.assets : [];
  if (!assets.length) return;
  state.attachments = normalizeAttachments(state.attachments);
  assets.forEach((asset) => {
    const source = String(asset?.source || "").trim();
    const dataUrl = String(asset?.dataUrl || "").trim();
    if (!source || !dataUrl.startsWith("data:image/")) return;
    if (source.startsWith("task-image:")) {
      const imageId = source.slice("task-image:".length).trim();
      if (imageId) state.attachments.images[imageId] = dataUrl;
    }
  });
}

function collectManagedKnowledgeAssets(content) {
  const source = String(content || "");
  const assets = [];
  const seen = new Set();
  knowledgeDocument.imageReferences(source).forEach((match) => {
    const reference = match.url;
    let dataUrl = "";
    if (reference.startsWith("task-image:")) {
      const imageId = reference.slice("task-image:".length);
      dataUrl = state.attachments?.images?.[imageId] || "";
    } else if (reference.toLowerCase().startsWith("data:image/")) {
      dataUrl = reference;
    }
    if (!dataUrl || !dataUrl.toLowerCase().startsWith("data:image/") || seen.has(reference)) return;
    seen.add(reference);
    assets.push({ source: reference, dataUrl });
  });
  return assets;
}

async function stageKnowledgeAssetsForTask(task, content) {
  const assets = collectManagedKnowledgeAssets(content);
  if (!assets.length || !desktopKnowledgeFile?.stageAssets) return { success: true, assets };
  try {
    const result = await desktopKnowledgeFile.stageAssets({
      noteId: task?.knowledgeNote?.noteId || task?.id,
      assets,
    });
    if (result?.success === false) return result;
    return { ...result, success: true, assets: result?.assets?.length ? result.assets : assets };
  } catch (error) {
    return { success: false, code: "ASSET_STAGE_FAILED", message: error?.message || "恢复资源暂存失败", error };
  }
}

function rememberKnowledgeAssetFiles(assetFiles = [], noteId = "") {
  state.knowledgeAssetScopes ||= {};
  if (noteId) state.knowledgeAssetScopes[noteId] ||= {};
  if (!Array.isArray(assetFiles)) return;
  assetFiles.forEach((asset) => {
    const relativePath = String(asset?.relativePath || "").trim();
    const dataUrl = String(asset?.dataUrl || "").trim();
    if (relativePath && dataUrl.startsWith("data:image/")) {
      state.knowledgeAssets[relativePath] = dataUrl;
      if (noteId) state.knowledgeAssetScopes[noteId][relativePath] = dataUrl;
    }
  });
}

function rememberKnowledgeAssetDiagnostics(noteId, result) {
  if (!noteId) return;
  if (Array.isArray(result?.missingAssetFiles) && result.missingAssetFiles.length) {
    state.knowledgeFileIssues[noteId] = {
      code: "MISSING_ATTACHMENTS",
      message: `有 ${result.missingAssetFiles.length} 个 Markdown 附件不可用`,
    };
  } else if (state.knowledgeFileIssues[noteId]?.code === "MISSING_ATTACHMENTS") {
    delete state.knowledgeFileIssues[noteId];
  }
}

function hydrateKnowledgeEditorMarkdown(content) {
  return Object.entries(state.knowledgeAssets || {}).reduce((markdown, [relativePath, dataUrl]) => {
    if (!relativePath || !dataUrl?.startsWith?.("data:image/")) return markdown;
    return markdown.split(relativePath).join(dataUrl);
  }, String(content || ""));
}

function persistKnowledgeRecoveryRecord(record, { strict = false } = {}) {
  if (!record) return Promise.resolve();
  state.knowledgeRecovery.records[record.noteId] = record;
  const writePromise = knowledgeRecoveryWriteQueue.then(async () => {
      if (desktopKnowledgeRecovery?.write) {
        await desktopKnowledgeRecovery.write(record);
      } else {
        localStorage.setItem(KNOWLEDGE_RECOVERY_KEY, JSON.stringify(state.knowledgeRecovery));
      }
      knowledgeRecoveryWriteErrors.delete(record.noteId);
    });
  knowledgeRecoveryWriteQueue = writePromise.catch((error) => {
    knowledgeRecoveryWriteErrors.set(record.noteId, error);
    console.error("Failed to persist knowledge note recovery data.", error);
  });
  return strict ? writePromise : knowledgeRecoveryWriteQueue;
}

function flushKnowledgeRecovery(noteId, { strict = false } = {}) {
  const pending = knowledgeRecoveryTimers.get(noteId);
  if (!pending) return Promise.resolve();
  window.clearTimeout(pending.debounceTimer);
  window.clearTimeout(pending.maxTimer);
  knowledgeRecoveryTimers.delete(noteId);
  const task = state.tasks.find((item) => item.knowledgeNote?.noteId === noteId || item.id === noteId);
  if (!task) return Promise.resolve();
  return stageKnowledgeAssetsForTask(task, pending.content)
    .then((stagedAssets) => {
      if (stagedAssets?.success === false) {
        console.error("Failed to stage knowledge note assets for recovery.", stagedAssets.message || stagedAssets.code);
        if (strict) throw Object.assign(new Error("Knowledge recovery asset staging failed."), { code: stagedAssets.code || "RECOVERY_ASSET_STAGE_FAILED" });
        return null;
      }
      return persistKnowledgeRecoveryRecord(
        recoveryRecordForTask(task, pending.content, stagedAssets?.assets),
        { strict },
      );
    })
    .catch((error) => {
      console.error("Failed to stage knowledge note assets for recovery.", error);
      if (strict) throw error;
      return null;
    });
}

async function flushPendingKnowledgeRecoveries({ strict = false } = {}) {
  const noteIds = Array.from(knowledgeRecoveryTimers.keys());
  await Promise.all(noteIds.map((noteId) => flushKnowledgeRecovery(noteId, { strict })));
  await knowledgeRecoveryWriteQueue;
  if (strict && knowledgeRecoveryWriteErrors.size) {
    const failedNoteIds = Array.from(knowledgeRecoveryWriteErrors.keys());
    await Promise.all(failedNoteIds.map((noteId) => {
      const record = state.knowledgeRecovery.records[noteId];
      if (!record) throw Object.assign(new Error("Knowledge recovery retry record is missing."), { code: "RECOVERY_RETRY_MISSING" });
      return persistKnowledgeRecoveryRecord(record, { strict: true });
    }));
    await knowledgeRecoveryWriteQueue;
  }
  if (strict && knowledgeRecoveryWriteErrors.size) throw knowledgeRecoveryWriteErrors.values().next().value;
}

function scheduleKnowledgeRecovery(taskId, content, timing = {}) {
  const task = state.tasks.find((item) => item.id === taskId);
  const noteId = task?.knowledgeNote?.noteId || taskId;
  if (!task || !noteId) return;
  const debounceMs = Number.isFinite(timing.debounceMs) ? timing.debounceMs : KNOWLEDGE_RECOVERY_DEBOUNCE_MS;
  const maxIntervalMs = Number.isFinite(timing.maxIntervalMs) ? timing.maxIntervalMs : KNOWLEDGE_RECOVERY_MAX_INTERVAL_MS;
  const existing = knowledgeRecoveryTimers.get(noteId);
  if (existing) {
    existing.content = String(content ?? "");
    window.clearTimeout(existing.debounceTimer);
    existing.debounceTimer = window.setTimeout(() => {
      void flushKnowledgeRecovery(noteId);
    }, debounceMs);
    return;
  }

  const pending = {
    content: String(content ?? ""),
    debounceTimer: 0,
    maxTimer: 0,
  };
  pending.debounceTimer = window.setTimeout(() => {
    void flushKnowledgeRecovery(noteId);
  }, debounceMs);
  pending.maxTimer = window.setTimeout(() => {
    void flushKnowledgeRecovery(noteId);
  }, maxIntervalMs);
  knowledgeRecoveryTimers.set(noteId, pending);
}

function applyKnowledgeRecoveryDraft(task, record) {
  restoreKnowledgeRecoveryAssets(record);
  task.notes = record.content;
  task.knowledgeNote = knowledgeDocument.markDocumentEdited(task.knowledgeNote);
  task.knowledgeNote.updatedAt = record.updatedAt;
  task.updatedAt = record.updatedAt;
}

async function restoreKnowledgeRecoveryDrafts() {
  for (const record of Object.values(state.knowledgeRecovery.records || {})) {
    const task = state.tasks.find((item) => item.knowledgeNote?.noteId === record.noteId || item.id === record.noteId);
    if (!task || !knowledgeRecoveryModel.isRecoveryNewerThan(record, task.updatedAt)) continue;

    const filePath = task.knowledgeNote?.filePath;
    if (!filePath) {
      applyKnowledgeRecoveryDraft(task, record);
      continue;
    }

    if (!desktopKnowledgeFile?.read || !record.baseFileHash) continue;
    let currentFile;
    try {
      currentFile = await desktopKnowledgeFile.read({ filePath });
    } catch (error) {
      console.error("Failed to read bound knowledge note before recovery.", error);
      applyKnowledgeRecoveryDraft(task, record);
      state.knowledgeFileIssues[task.knowledgeNote.noteId] = { code: "FILE_READ_FAILED", message: "暂时无法核对磁盘文件，未保存草稿已恢复。" };
      continue;
    }
    if (!currentFile?.success) {
      applyKnowledgeRecoveryDraft(task, record);
      state.knowledgeFileIssues[task.knowledgeNote.noteId] = { code: currentFile?.code || "FILE_READ_FAILED", message: "文件读取失败，已恢复未保存草稿。" };
      continue;
    }
    if (currentFile.lastSavedHash !== record.baseFileHash) {
      applyKnowledgeRecoveryDraft(task, record);
      knowledgeExternalSnapshots.set(task.knowledgeNote.noteId, currentFile);
      task.knowledgeNote = knowledgeDocument.markDocumentExternalChanged(task.knowledgeNote);
      continue;
    }

    rememberKnowledgeAssetFiles(currentFile.assetFiles, task.knowledgeNote.noteId);
    applyKnowledgeRecoveryDraft(task, record);
  }
}

function discardPendingKnowledgeRecovery(noteId) {
  const pending = knowledgeRecoveryTimers.get(noteId);
  if (!pending) return;
  window.clearTimeout(pending.debounceTimer);
  window.clearTimeout(pending.maxTimer);
  knowledgeRecoveryTimers.delete(noteId);
}

async function clearKnowledgeRecoveryRecord(noteId) {
  if (!noteId) return;
  discardPendingKnowledgeRecovery(noteId);
  await knowledgeRecoveryWriteQueue;
  delete state.knowledgeRecovery.records[noteId];
  try {
    if (desktopKnowledgeRecovery?.delete) {
      await desktopKnowledgeRecovery.delete(noteId);
    } else {
      localStorage.setItem(KNOWLEDGE_RECOVERY_KEY, JSON.stringify(state.knowledgeRecovery));
    }
  } catch (error) {
    console.error("Failed to clear knowledge note recovery data.", error);
  }
}

function boundKnowledgeFilePaths(excludeTaskId = "") {
  return state.tasks
    .filter((task) => task.id !== excludeTaskId)
    .map((task) => task.knowledgeNote?.filePath)
    .filter(Boolean)
    .map((filePath) => knowledgeDocument.canonicalFilePath(filePath, desktopPlatform));
}

function syncKnowledgeFileWatcher(task) {
  const note = task?.knowledgeNote;
  if (!desktopKnowledgeFile?.watch || !note?.filePath) return Promise.resolve(null);
  return desktopKnowledgeFile.watch({
    noteId: note.noteId || task.id,
    filePath: note.filePath,
    lastSavedHash: note.lastSavedHash,
    lastSavedMtime: note.lastSavedMtime,
  });
}

async function verifyKnowledgeFileBeforeSave(task, { saveAs = false, allowExternalOverwrite = false } = {}) {
  const note = task?.knowledgeNote;
  if (saveAs || allowExternalOverwrite || !note?.filePath || !desktopKnowledgeFile?.read) return null;

  let currentFile;
  try {
    currentFile = await desktopKnowledgeFile.read({ filePath: note.filePath });
  } catch (error) {
    return { success: false, code: "FILE_READ_FAILED", message: error?.message || "无法读取当前知识笔记文件", error };
  }
  if (!currentFile?.success) return currentFile || { success: false, code: "FILE_READ_FAILED" };

  if (!note.lastSavedHash || currentFile.lastSavedHash !== note.lastSavedHash) {
    knowledgeExternalSnapshots.set(note.noteId, currentFile);
    task.knowledgeNote = knowledgeDocument.markDocumentExternalChanged(note);
    task.knowledgeNote.updatedAt = now();
    task.updatedAt = now();
    save();
    return {
      success: false,
      code: "EXTERNAL_CHANGE_REQUIRES_CONFIRMATION",
      message: "文件已被外部修改，请先重新加载、明确覆盖或另存为。",
    };
  }
  return null;
}

async function startKnowledgeFileWatchers() {
  if (!desktopKnowledgeFile?.watch) return;
  await Promise.all(state.tasks.filter((task) => task.knowledgeNote?.filePath).map((task) => syncKnowledgeFileWatcher(task)));
}

function knowledgeFileFailure(result, fallback = "文件不可用") {
  return result?.message || fallback;
}

async function reloadKnowledgeTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  const note = task?.knowledgeNote;
  if (!task || !note?.filePath || !desktopKnowledgeFile?.read) return { success: false, code: "READ_UNAVAILABLE" };
  if (note.dirty && !(await confirmDestructiveAction("将放弃当前未保存的修改，并读取磁盘上的最新内容。此操作不会删除笔记或文件。", "reload-knowledge"))) {
    return { canceled: true };
  }

  captureMountedMilkdownDrafts(); flushNodeNoteDraft(noteDraftKey(task.id, ""), { persist: true });
  const contentAtRead = task.notes;
  const conflictAtRead = knowledgeExternalSnapshots.get(note.noteId);
  let result;
  try {
    // Reload is an explicit request for the current disk version. Watcher
    // snapshots are only conflict evidence and may already be stale here.
    result = await desktopKnowledgeFile.read({ filePath: note.filePath });
  } catch (error) {
    result = {
      success: false,
      code: "FILE_READ_FAILED",
      errorCode: error?.code || "UNKNOWN",
      message: error?.message || "文件暂时不可用",
    };
  }
  if (!result?.success) {
    // A failed conflict resolution must not replace the editor content, clear
    // EXTERNAL_CHANGED, or discard Recovery. Surface the read issue separately.
    state.knowledgeFileIssues[note.noteId] = {
      code: result?.errorCode || result?.code || "UNKNOWN",
      message: result?.message || "文件暂时不可用",
    };
    render();
    return result || { success: false, code: "FILE_READ_FAILED" };
  }

  captureMountedMilkdownDrafts(); flushNodeNoteDraft(noteDraftKey(task.id, ""), { persist: true });
  if (!state.tasks.includes(task) || task.notes !== contentAtRead || task.knowledgeNote.noteId !== note.noteId || task.knowledgeNote.filePath !== note.filePath) {
    return { success: false, code: "DRAFT_CHANGED_DURING_READ", message: "读取期间笔记发生修改，已保留当前输入，请重试。" };
  }
  const previousNotes = task.notes;
  const previousKnowledgeNote = { ...task.knowledgeNote };
  const previousTaskUpdatedAt = task.updatedAt;
  discardMountedKnowledgeEditor(task.id);
  task.notes = result.content;
  task.knowledgeNote = knowledgeDocument.markDocumentSaved(previousKnowledgeNote, result);
  if (result.readOnly) task.knowledgeNote = knowledgeDocument.markDocumentReadOnly(task.knowledgeNote);
  task.knowledgeNote.updatedAt = now();
  task.updatedAt = now();
  save();
  if (!(await flushSave())) {
    task.notes = previousNotes;
    task.knowledgeNote = previousKnowledgeNote;
    task.updatedAt = previousTaskUpdatedAt;
    save();
    render();
    return {
      success: false,
      code: "TASK_DATA_SAVE_FAILED",
      message: "磁盘文件读取成功，但冲突状态未能安全持久化；当前编辑内容与 Recovery 已保留。",
    };
  }

  discardMountedKnowledgeEditor(task.id);
  rememberKnowledgeAssetFiles(result.assetFiles, task.knowledgeNote.noteId);
  rememberKnowledgeAssetDiagnostics(note.noteId, result);
  delete state.knowledgeFileIssues[note.noteId];
  try {
    await syncKnowledgeFileWatcher(task);
  } catch (error) {
    console.error("Failed to update knowledge file watcher baseline after reload.", error);
  }
  if (knowledgeExternalSnapshots.get(note.noteId) === conflictAtRead) knowledgeExternalSnapshots.delete(note.noteId);
  if (!task.knowledgeNote.dirty && task.knowledgeNote.documentState === "SAVED" && task.notes === result.content) {
    await clearKnowledgeRecoveryRecord(note.noteId);
  }
  return result;
}

async function relocateKnowledgeTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  const note = task?.knowledgeNote;
  if (!task || !desktopKnowledgeFile?.choose) return { success: false, code: "CHOOSE_UNAVAILABLE" };
  if (note.dirty && !(await confirmDestructiveAction("重新定位将使用新文件内容替换当前知识笔记，是否继续？"))) {
    return { canceled: true };
  }
  captureMountedMilkdownDrafts(); flushNodeNoteDraft(noteDraftKey(task.id, ""), { persist: true });
  const contentAtChoose = task.notes;
  const result = await desktopKnowledgeFile.choose({ boundPaths: boundKnowledgeFilePaths(task.id) });
  if (result?.canceled) return result;
  if (!result?.success) {
    showWorkspaceError(result?.code === "DUPLICATE_BINDING" ? "这篇知识笔记已绑定该文件路径，请选择其他文件。" : `重新定位失败：${knowledgeFileFailure(result)}`);
    return result || { success: false, code: "FILE_READ_FAILED" };
  }

  captureMountedMilkdownDrafts(); flushNodeNoteDraft(noteDraftKey(task.id, ""), { persist: true });
  if (!state.tasks.includes(task) || task.notes !== contentAtChoose) return { success: false, code: "DRAFT_CHANGED_DURING_READ", message: "选择文件期间笔记发生修改，已保留当前输入。" };
  discardMountedKnowledgeEditor(task.id);
  task.notes = result.content;
  rememberKnowledgeAssetFiles(result.assetFiles, task.knowledgeNote.noteId);
  rememberKnowledgeAssetDiagnostics(note.noteId, result);
  task.knowledgeNote = knowledgeDocument.markDocumentSaved(note, result);
  if (result.readOnly) task.knowledgeNote = knowledgeDocument.markDocumentReadOnly(task.knowledgeNote);
  task.knowledgeNote.updatedAt = now();
  task.updatedAt = now();
  knowledgeExternalSnapshots.delete(note.noteId);
  await clearKnowledgeRecoveryRecord(note.noteId);
  discardMountedKnowledgeEditor(task.id);
  save();
  await syncKnowledgeFileWatcher(task);
  return result;
}

async function removeKnowledgeBinding(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  const note = task?.knowledgeNote;
  if (!task || !note?.filePath) return { success: false, code: "NO_FILE_BINDING" };
  const confirmed = await confirmDestructiveAction("只从软件中移除这篇知识笔记的文件绑定？Markdown 文件和附件会保留在磁盘上。");
  if (!confirmed) return { canceled: true };
  if (desktopKnowledgeFile?.unwatch) {
    void desktopKnowledgeFile.unwatch({ noteId: note.noteId || task.id });
  }
  knowledgeExternalSnapshots.delete(note.noteId || task.id);
  task.knowledgeNote = {
    ...note,
    filePath: null,
    documentState: "DRAFT",
    dirty: false,
    lastSavedHash: null,
    lastSavedMtime: null,
    updatedAt: now(),
  };
  task.updatedAt = now();
  save();
  return { success: true };
}

async function discardUnfiledKnowledgeDraft(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.knowledgeNote?.filePath) return { success: false, code: "FILE_BOUND" };
  await clearKnowledgeRecoveryRecord(task.knowledgeNote?.noteId || task.id);
  task.notes = "";
  task.knowledgeNote = {
    ...task.knowledgeNote,
    filePath: null,
    documentState: "DRAFT",
    dirty: false,
    lastSavedHash: null,
    lastSavedMtime: null,
    updatedAt: now(),
  };
  task.updatedAt = now();
  save();
  return { success: true };
}

async function closeKnowledgeEditor(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return { success: false, code: "TASK_NOT_FOUND" };
  if (task.knowledgeNote?.documentState === "DRAFT" && String(task.notes || "").trim()) {
    state.knowledgeDraftPrompt = { taskId, mode: "close-editor" };
    render();
    return { success: false, code: "DRAFT_REQUIRES_DECISION" };
  }
  state.taskPane = "flow";
  return { success: true };
}

async function handleKnowledgeFileChange(event) {
  const noteId = String(event?.noteId || "").trim();
  const task = state.tasks.find((item) => item.knowledgeNote?.noteId === noteId || item.id === noteId);
  if (!task || !event?.filePath) return;
  captureMountedMilkdownDrafts();
  flushNodeNoteDraft(noteDraftKey(task.id, ""), { persist: false });
  const note = task.knowledgeNote;
  if (typeof knowledgeFileWriteBusy !== "undefined" && knowledgeFileWriteBusy.has(task.id)) {
    // Our queued write updates the watcher baseline in main before its receipt.
    // A later external version is still checked by the next CAS save/read.
    if (event.type === "external-changed") {
      if (typeof knowledgeDeferredFileEvents !== "undefined") knowledgeDeferredFileEvents.set(task.id, event);
      return;
    }
  }
  if (note.filePath && knowledgeDocument.canonicalFilePath(note.filePath, desktopPlatform) !== knowledgeDocument.canonicalFilePath(event.filePath, desktopPlatform)) return;

  if (event.type === "baseline") {
    rememberKnowledgeAssetDiagnostics(note.noteId, event);
    rememberKnowledgeAssetFiles(event.assetFiles, task.knowledgeNote.noteId);
    if (note.documentState === "SAVED") {
      task.knowledgeNote = knowledgeDocument.markDocumentSaved(note, event);
      save();
      // Self-write baselines must never detach a focused CodeMirror/IME host.
      // Attachments are refreshed as decorations, not by rebuilding the shell.
      milkdownEditors.get(noteDraftKey(task.id, ""))?.instance?.refresh?.();
      if (typeof knowledgeUpdateChrome === "function") knowledgeUpdateChrome(task);
    }
    return;
  }
  if (event.type === "read-only") {
    task.knowledgeNote = knowledgeDocument.markDocumentReadOnly(note);
    save();
    render();
    return;
  }
  if (event.type === "file-missing") {
    delete state.knowledgeFileIssues[note.noteId];
    task.knowledgeNote = knowledgeDocument.markDocumentFileMissing(note);
    save();
    render();
    return;
  }
  if (event.type === "file-unavailable") {
    state.knowledgeFileIssues[note.noteId] = {
      code: event.errorCode || "UNKNOWN",
      message: event.message || "文件暂时不可用",
    };
    render();
    return;
  }
  if (event.type !== "external-changed" || !event.success) return;

  knowledgeExternalSnapshots.set(note.noteId, event);
  if (note.documentState === "SAVED") {
    discardMountedKnowledgeEditor(task.id);
    task.notes = event.content;
    rememberKnowledgeAssetFiles(event.assetFiles, task.knowledgeNote.noteId);
    rememberKnowledgeAssetDiagnostics(note.noteId, event);
    task.knowledgeNote = knowledgeDocument.markDocumentSaved(note, event);
    task.knowledgeNote.updatedAt = now();
    task.updatedAt = now();
    knowledgeExternalSnapshots.delete(note.noteId);
    await clearKnowledgeRecoveryRecord(note.noteId);
    discardMountedKnowledgeEditor(task.id);
    save();
    await syncKnowledgeFileWatcher(task);
    render();
    return;
  }

  task.knowledgeNote = knowledgeDocument.markDocumentExternalChanged(note);
  task.knowledgeNote.updatedAt = now();
  task.updatedAt = now();
  save();
  render();
}

async function saveKnowledgeTask(taskId, { saveAs = false, allowExternalOverwrite = false } = {}) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return { canceled: true };
  if (!desktopKnowledgeFile?.save) {
    showWorkspaceError("当前环境不支持将知识笔记保存为本地文件，请在桌面应用中使用。");
    return { canceled: true, unsupported: true };
  }

  const note = task.knowledgeNote;
  if (note.documentState === "EXTERNAL_CHANGED" && !saveAs && !allowExternalOverwrite) {
    const result = {
      success: false,
      code: "EXTERNAL_CHANGE_REQUIRES_CONFIRMATION",
      message: "文件已被外部修改，请先重新加载、明确覆盖或另存为。",
    };
    showWorkspaceError(result.message);
    return result;
  }
  if (note.documentState === "FILE_MISSING" && !saveAs) {
    const result = {
      success: false,
      code: "FILE_MISSING_REQUIRES_RELOCATION",
      message: "原文件不存在，请重新定位文件或使用另存为。",
    };
    showWorkspaceError(result.message);
    return result;
  }

  captureMountedMilkdownDrafts();
  flushNodeNoteDraft(noteDraftKey(task.id, ""), { persist: true });
  const lifecycleBeforeSave = typeof knowledgeGenerations !== "undefined" ? knowledgeGenerations.get(task.id) || 0 : 0;
  const contentBeforeSave = task.notes;
  const sessionBeforeSave = { ...task.knowledgeNote };
  const conflictBeforeSave = knowledgeExternalSnapshots.get(note.noteId);
  const taskUpdatedAtBeforeSave = task.updatedAt;
  try {
    const fileCheck = await verifyKnowledgeFileBeforeSave(task, { saveAs, allowExternalOverwrite });
    if (fileCheck) {
      if (fileCheck.code === "EXTERNAL_CHANGE_REQUIRES_CONFIRMATION") {
        showWorkspaceError(fileCheck.message);
      } else {
        showWorkspaceError(`知识笔记保存前读取失败：${fileCheck.message || "未知文件错误"}`);
      }
      return fileCheck;
    }
    const contentToSave = task.notes;
    const stagedAssets = await stageKnowledgeAssetsForTask(task, contentToSave);
    if (stagedAssets?.success === false) {
      showWorkspaceError(`知识笔记图片暂存失败：${stagedAssets.message || "未知资源错误"}\n当前内容未清除，请重试。`);
      return stagedAssets;
    }
    const result = await desktopKnowledgeFile.save({
      noteId: note.noteId || task.id,
      filePath: saveAs ? "" : note.filePath,
      saveAs,
      title: task.title,
      content: contentToSave,
      assets: stagedAssets.assets,
      expectedLastSavedHash: saveAs ? null : sessionBeforeSave.lastSavedHash,
      allowExternalOverwrite,
      boundPaths: boundKnowledgeFilePaths(task.id),
    });
    if (result?.canceled) return result;
    if (!result?.success) {
      if (result?.code === "DUPLICATE_BINDING") {
        showWorkspaceError("这篇知识笔记已绑定该文件路径，请选择其他文件。");
      } else {
        showWorkspaceError(`知识笔记保存失败：${result?.message || "未知文件错误"}\n请重试；如仍失败，可使用“另存为”。`);
      }
      return result || { success: false };
    }

    if (!state.tasks.includes(task) || (typeof knowledgeGenerations !== "undefined" && (knowledgeGenerations.get(task.id) || 0) !== lifecycleBeforeSave) || task.knowledgeNote.noteId !== sessionBeforeSave.noteId ||
        (task.knowledgeNote.filePath !== sessionBeforeSave.filePath && task.knowledgeNote.lastSavedHash !== sessionBeforeSave.lastSavedHash)) {
      return { success: false, code: "NOTE_CHANGED_DURING_SAVE", message: "文件已写入，但笔记已移除或重新关联；当前笔记未被覆盖。", markdownSaved: true };
    }
    // Capture edits made while the file write was pending. Its receipt belongs
    // to contentToSave, while newer input must stay an unsaved draft.
    captureMountedMilkdownDrafts();
    flushNodeNoteDraft(noteDraftKey(task.id, ""), { persist: false });
    const hasNewerDraft = task.notes !== contentToSave;
    rememberKnowledgeAssetFiles(result.assetFiles, task.knowledgeNote.noteId);
    milkdownEditors.get(noteDraftKey(task.id, ""))?.instance?.acceptSavedAssetReferences?.(result.assetFiles);
    if (hasNewerDraft) {
      for (const asset of result.assetFiles || []) {
        if (asset.source && asset.relativePath) {
          for (const reference of knowledgeDocument.imageReferences(task.notes).filter((item) => item.url === asset.source).reverse()) {
            task.notes = task.notes.slice(0, reference.from) + asset.relativePath + task.notes.slice(reference.to);
          }
        }
      }
    } else {
      task.notes = result.content ?? contentToSave;
    }
    const source = document.querySelector("#knowledge-source");
    if (source && state.activeTaskId === task.id && source.value !== task.notes) {
      const start = source.selectionStart;
      const end = source.selectionEnd;
      source.value = task.notes;
      source.setSelectionRange(start, end);
    }
    rememberKnowledgeAssetFiles(result.assetFiles, task.knowledgeNote.noteId);
    task.knowledgeNote = knowledgeDocument.markDocumentSaved(task.knowledgeNote, result);
    if (hasNewerDraft) task.knowledgeNote = knowledgeDocument.markDocumentEdited(task.knowledgeNote);
    task.knowledgeNote.updatedAt = now();
    task.updatedAt = now();
    save();
    const taskDataSaved = await flushSave();
    if (!taskDataSaved) {
      // The disk receipt is valid even if task-data persistence failed. Keep
      // newer input and the accepted file hash so Retry does not invent a conflict.
      scheduleKnowledgeRecovery(task.id, task.notes);
      return {
        success: false,
        code: "TASK_DATA_SAVE_FAILED",
        message: "Markdown 已保存，但任务数据未能持久化；Recovery 草稿已保留，请重试。",
        markdownSaved: true,
      };
    }
    try {
      await syncKnowledgeFileWatcher(task);
    } catch (error) {
      console.error("Failed to update knowledge file watcher baseline after save.", error);
    }
    if (knowledgeExternalSnapshots.get(note.noteId) === conflictBeforeSave) knowledgeExternalSnapshots.delete(note.noteId);
    if (!task.knowledgeNote.dirty && task.knowledgeNote.documentState === "SAVED") await clearKnowledgeRecoveryRecord(task.knowledgeNote.noteId);
    return result;
  } catch (error) {
    console.error("Failed to save knowledge note.", error);
    showWorkspaceError(`知识笔记保存失败：${error?.message || "未知文件错误"}\n请重试；如仍失败，可使用“另存为”。`);
    return { success: false, code: "SAVE_FAILED", message: error?.message || "未知文件错误", error };
  }
}


// ============================================================
// DATA PERSISTENCE (save / flush / normalize)
// ============================================================
/**
 * Load all app data from Electron IPC storage, falling back to localStorage.
 * Normalizes all fields and returns a complete data object.
 * @returns {Promise<object>} { tasks, taskGroups, activeGroupId, flowWidths, ... }
 */
async function loadAppData() {
  if (desktopStorage?.read) {
    try {
      const stored = await desktopStorage.read();
      const tasks = stored && Array.isArray(stored.tasks) ? normalizeTasks(stored.tasks) : [];
      const taskGroups = normalizeTaskGroups(stored?.taskGroups, tasks);
      const activeGroupId = stored && Object.hasOwn(stored, "activeGroupId")
        ? normalizeActiveGroupId(stored.activeGroupId, taskGroups)
        : ALL_TASKS_GROUP_ID;
      const flowWidths = normalizeLoadedFlowWidths(stored?.flowWidths || {});
      const theme = normalizeTheme(stored?.theme);
      const legacy = migrateLegacyFont(stored?.font);
      const zhFont = normalizeZhFont(stored?.zhFont || legacy.zhFont);
      const enFont = normalizeEnFont(stored?.enFont || legacy.enFont);
      const fontScale = normalizeFontScale(stored?.fontScale);
      const taskFilter = normalizeTaskFilter(stored?.taskFilter);
      const priorityFilter = normalizePriorityFilter(stored?.priorityFilter);
      const captureSourceFilter = normalizeCaptureSourceFilter(stored?.captureSourceFilter);
      const newTaskPriority = normalizePriority(stored?.newTaskPriority);
      const uiPreferences = stored?.uiPreferences ? normalizeUiPreferences(stored.uiPreferences) : loadBrowserUiPreferences();
      const sidebarWidth = normalizeSidebarWidth(stored?.sidebarWidth);
      const detailHeight = normalizeDetailHeight(stored?.detailHeight);
      const attachments = normalizeAttachments(stored?.attachments);
      const installationId = normalizeInstallationId(stored?.installationId);
      const workNavigation = workNavigationModel.normalizeWorkNavigation(stored?.workNavigation, {
        groupIds: taskGroups.map((group) => group.id),
      });
      const recentlyDeleted = normalizeRecentlyDeleted(stored?.recentlyDeleted);
      return { tasks, taskGroups, activeGroupId, flowWidths, sidebarWidth, detailHeight, attachments, theme, zhFont, enFont, fontScale, taskFilter, priorityFilter, captureSourceFilter, newTaskPriority, uiPreferences, installationId, workNavigation, recentlyDeleted };
    } catch (error) {
      console.error("Failed to read local task data.", error);
      // Electron only forwards the message of an error thrown inside an
      // ipcMain.handle, so the main-process error code has to be recovered
      // from the message text as well.
      const failureText = `${error?.code || ""} ${error?.message || ""}`;
      if (error?.code === "UNSUPPORTED_DATA_VERSION" || failureText.includes("版本高于当前应用支持范围")) {
        dataProtectionMessage = "本地任务数据由更高版本的 Loop 写入。已进入保护模式并停止写入，请升级 Loop 后再打开，数据未被修改。";
        showWorkspaceError(dataProtectionMessage);
      } else if (error?.code === "CORRUPT_TASK_DATA" || failureText.includes("任务数据文件已损坏")) {
        showWorkspaceError("本地任务数据已损坏，应用已保留损坏文件备份。请先复制备份文件后再继续操作。");
      }
    }
  }

  const tasks = loadBrowserTasks();
  const taskGroups = loadBrowserTaskGroups(tasks);
  const typography = loadBrowserTypography();
  const preferences = loadBrowserPreferences();
  return {
    tasks,
    taskGroups,
    activeGroupId: localStorage.getItem(ACTIVE_GROUP_KEY)
      ? normalizeActiveGroupId(localStorage.getItem(ACTIVE_GROUP_KEY), taskGroups)
      : ALL_TASKS_GROUP_ID,
    flowWidths: loadBrowserFlowWidths(),
    sidebarWidth: loadBrowserSidebarWidth(),
    detailHeight: loadBrowserDetailHeight(),
    attachments: loadBrowserAttachments(),
    installationId: loadBrowserInstallationId(),
    workNavigation: loadBrowserWorkNavigation(taskGroups),
    recentlyDeleted: loadBrowserRecentlyDeleted(),
    uiPreferences: loadBrowserUiPreferences(),
    theme: loadBrowserTheme(),
    ...typography,
    ...preferences,
  };
}

function localSaveReceipt() {
  if (dataProtectionMessage) return { state: "protected", label: "只读保护 · 未写入" };
  if (dataTransferInProgress) return { state: "transferring", label: "数据处理中…" };
  if (saveInFlight) return { state: "saving", label: "正在保存到本机…" };
  if (localSaveOutcome === "failed") return { state: "failed", label: "本地保存失败 · 待重试" };
  if (pendingPayload) return { state: "pending", label: "等待保存到本机…" };
  return localSaveOutcome === "saved"
    ? { state: "saved", label: "已保存到本机" }
    : { state: "ready", label: "本地工作区" };
}

function renderLocalSaveReceipt() {
  const receipt = localSaveReceipt();
  return `<span data-local-save-status data-state="${receipt.state}" role="status" aria-live="polite" aria-atomic="true"><i class="dot"></i>${esc(receipt.label)}</span>`;
}

const WORKSPACE_FEEDBACK_MS = 10000;
let workspaceFeedback = null;
let workspaceFeedbackTimer = 0;

function clearWorkspaceFeedback(source = "") {
  if (source && workspaceFeedback?.source !== source) return;
  window.clearTimeout(workspaceFeedbackTimer);
  const previous = workspaceFeedback;
  workspaceFeedback = null;
  previous?.onDismiss?.();
  updateLocalSaveReceipt();
}

function showWorkspaceFeedback(message, actions = "", { source = "notice", onDismiss = null } = {}) {
  clearWorkspaceFeedback();
  const feedback = { message: String(message), actions, source, onDismiss, expiresAt: Date.now() + WORKSPACE_FEEDBACK_MS };
  workspaceFeedback = feedback;
  workspaceFeedbackTimer = window.setTimeout(() => {
    if (workspaceFeedback === feedback) clearWorkspaceFeedback();
  }, WORKSPACE_FEEDBACK_MS);
  updateLocalSaveReceipt();
}

function showWorkspaceError(message) {
  showWorkspaceFeedback(message, "", { source: "error" });
}

function renderWorkspaceStatus() {
  const local = localSaveReceipt();
  if (!workspaceFeedback || workspaceFeedback.expiresAt <= Date.now()
      || (["failed", "protected", "transferring"].includes(local.state)
        && workspaceFeedback.source !== "error")) return renderLocalSaveReceipt();
  const content = workspaceFeedback.source === "journey"
    ? renderShellJourneyReceipt()
    : `<span class="workspace-feedback-message" title="${escAttr(workspaceFeedback.message)}"><i class="dot"></i><span>${esc(workspaceFeedback.message)}</span></span>${workspaceFeedback.actions ? `<div class="workspace-feedback-actions">${workspaceFeedback.actions}</div>` : ""}`;
  if (!content) return renderLocalSaveReceipt();
  return `<div class="workspace-feedback" data-tone="${workspaceFeedback.source === "error" ? "error" : "notice"}" role="${workspaceFeedback.source === "error" ? "alert" : "status"}" aria-live="${workspaceFeedback.source === "error" ? "assertive" : "polite"}" aria-atomic="true">${content}<button class="workspace-feedback-dismiss" type="button" data-workspace-dismiss aria-label="关闭操作反馈">${shellIcon("close")}</button></div>`;
}

function updateLocalSaveReceipt() {
  if (state.taskPane === "notes" && typeof knowledgeUpdateChrome === "function") {
    const task = state.tasks.find(item => item.id === state.activeTaskId);
    if (task) knowledgeUpdateChrome(task);
  }
  const status = document.querySelector("[data-workspace-status]");
  if (status) {
    const markup = renderWorkspaceStatus();
    if (status.workspaceStatusMarkup !== markup) {
      if (status.innerHTML !== markup) status.innerHTML = markup;
      status.workspaceStatusMarkup = markup;
    }
    return;
  }
  const element = document.querySelector("[data-local-save-status]");
  if (!element) return;
  const receipt = localSaveReceipt();
  if (element.dataset.state === receipt.state) return;
  element.dataset.state = receipt.state;
  element.innerHTML = `<i class="dot"></i>${esc(receipt.label)}`;
}

/**
 * Save current state. In Electron environment, queues an async write.
 * In browser environment, writes directly to individual localStorage keys.
 */
function save() {
  if (dataProtectionMessage || dataTransferInProgress) { updateLocalSaveReceipt(); return; }
  const payload = {
    version: DATA_VERSION,
    knowledgeSchemaVersion: KNOWLEDGE_MIGRATION_VERSION,
    tasks: state.tasks,
    taskGroups: state.taskGroups,
    activeGroupId: state.activeGroupId,
    flowWidths: state.flowWidths,
    sidebarWidth: state.sidebarWidth,
    detailHeight: state.detailHeight,
    attachments: state.attachments,
    theme: state.theme,
    zhFont: state.zhFont,
    enFont: state.enFont,
    fontScale: state.fontScale,
    taskFilter: state.taskFilter,
    priorityFilter: state.priorityFilter,
    captureSourceFilter: state.captureSourceFilter,
    newTaskPriority: state.newTaskPriority,
    uiPreferences: normalizeUiPreferences(state.uiPreferences),
    installationId: state.installationId,
    workNavigation: state.workNavigation,
    recentlyDeletedSchemaVersion: RECENTLY_DELETED_SCHEMA_VERSION,
    recentlyDeleted: state.recentlyDeleted,
    updatedAt: now(),
  };

  if (!desktopStorage?.write) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
      localStorage.setItem(TASK_GROUPS_KEY, JSON.stringify(state.taskGroups));
      localStorage.setItem(ACTIVE_GROUP_KEY, state.activeGroupId);
      localStorage.setItem(FLOW_WIDTH_KEY, JSON.stringify(state.flowWidths));
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(state.sidebarWidth));
      localStorage.setItem(DETAIL_HEIGHT_KEY, String(state.detailHeight));
      localStorage.setItem(ATTACHMENTS_KEY, JSON.stringify(state.attachments));
      localStorage.setItem(THEME_KEY, state.theme);
      localStorage.setItem(ZH_FONT_KEY, state.zhFont);
      localStorage.setItem(EN_FONT_KEY, state.enFont);
      localStorage.setItem(FONT_SCALE_KEY, state.fontScale);
      localStorage.setItem(TASK_FILTER_KEY, state.taskFilter);
      localStorage.setItem(PRIORITY_FILTER_KEY, state.priorityFilter);
      localStorage.setItem(CAPTURE_SOURCE_FILTER_KEY, state.captureSourceFilter);
      localStorage.setItem(NEW_TASK_PRIORITY_KEY, state.newTaskPriority);
      localStorage.setItem("loop.interaction28", JSON.stringify({ continuous: state.uiPreferences.continuous, follow: state.uiPreferences.follow }));
      localStorage.setItem("loop-work-rhythm-v1:enabled", state.uiPreferences.workNavigationEnabled ? "1" : "0");
      localStorage.setItem(INSTALLATION_ID_KEY, state.installationId);
      localStorage.setItem(WORK_NAVIGATION_KEY, JSON.stringify(state.workNavigation));
      localStorage.setItem(RECENTLY_DELETED_KEY, JSON.stringify(state.recentlyDeleted));
      localSaveOutcome = "saved";
    } catch (error) {
      localSaveOutcome = "failed";
      throw error;
    } finally {
      updateLocalSaveReceipt();
    }
    return;
  }

  // Coalesce on the input path; the exact serialized comparison belongs in
  // the deferred flush. A length/timestamp signature is not an edit revision
  // (same-length notes or attachment changes can collide).
  if (!pendingPayload) pendingSaveSince = Date.now();
  pendingPayload = payload;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushScheduledSave, 80);
  updateLocalSaveReceipt();
}

function flushScheduledSave() {
  // Explicit flushSave() (quit, export, recovery) remains immediate. Only the
  // automatic flush yields to the already bounded native transition.
  if (window.loopPointerContinuity?.currentClick()?.claimed && Date.now() - pendingSaveSince < 400) {
    saveTimer = window.setTimeout(flushScheduledSave, 20); return;
  }
  void flushSave();
}

/**
 * Lightweight signature used to invalidate derived navigation/widget caches.
 *
 * This is not proof that persisted content is unchanged: notes with the same
 * length can share a signature. Persistence compares the complete payload.
 */
function persistedStateRevision() {
  const parts = [`n${state.tasks.length}`];
  for (const task of state.tasks) {
    parts.push(
      `${task.id}\u0001${task.order}\u0001${task.groupId}\u0001${task.status}\u0001${task.priority}\u0001`
      + `${task.title}\u0001${task.updatedAt}\u0001${task.createdAt}\u0001${task.deadlineAt}\u0001`
      + `${task.deadlineReminderMinutes}\u0001${task.resolvedAt}\u0001${task.captureSource || ""}\u0001`
      + `${task.estimateMinutes}\u0001${task.todayTaskOrder || 0}\u0001${task.todayQuickCaptureOrder || 0}\u0001`
      + `${task.description.length}\u0001${task.hypothesis.length}\u0001${task.conclusion.length}\u0001`
      + `${task.notes.length}\u0001${JSON.stringify(task.tags)}\u0001`,
    );
    for (const node of flatten(task.nodes)) {
      parts.push(
        `d${node.id}\u0001${node.title}\u0001${node.status}\u0001${node.order}\u0001`
        + `${node.updatedAt}\u0001${node.note.length}\u0001${node.collapsed ? 1 : 0}`,
      );
    }
  }
  parts.push(`g${state.taskGroups.length}`);
  for (const group of state.taskGroups) parts.push(`${group.id}\u0001${group.title}\u0001${group.order}`);
  parts.push(
    `s${state.activeGroupId}\u0001${state.flowWidths.title}\u0001${state.flowWidths.note}\u0001`
    + `${state.sidebarWidth}\u0001${state.detailHeight}\u0001${state.theme}\u0001${state.zhFont}\u0001`
    + `${state.enFont}\u0001${state.fontScale}\u0001${state.taskFilter}\u0001${state.priorityFilter}\u0001`
    + `${state.captureSourceFilter}\u0001${state.newTaskPriority}\u0001${state.installationId}\u0001`
    + `${JSON.stringify(state.workNavigation)}\u0001${state.recentlyDeleted.length}\u0001`
    + `${JSON.stringify(state.attachments).length}`,
  );
  return parts.join("\u0002");
}

/**
 * Fingerprint of everything a save would persist, excluding the write
 * timestamp. `updatedAt` records when the write happened, so including it would
 * make every payload unique and defeat the comparison.
 */
function payloadFingerprint(payload) {
  const { updatedAt: _updatedAt, ...persistable } = payload;
  return JSON.stringify(persistable);
}

function saveFlowWidths() {
  save();
}

/**
 * Flush pending save payload to Electron IPC storage.
 * Uses a save-in-flight flag to prevent concurrent writes.
 */
async function flushSave() {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  if (dataProtectionMessage || dataTransferInProgress) {
    pendingPayload = null;
    updateLocalSaveReceipt();
    return false;
  }
  if (!desktopStorage?.write) return true;
  if (saveInFlight) return saveInFlightPromise ? saveInFlightPromise.then(() => flushSave()) : false;
  if (!pendingPayload) return true;
  const payload = pendingPayload;
  pendingPayload = null;
  const payloadFingerprintValue = payloadFingerprint(payload);
  const payloadRevision = persistedStateRevision();
  if (payloadFingerprintValue === lastWrittenPayloadFingerprint) {
    localSaveOutcome = "saved";
    updateLocalSaveReceipt();
    return true;
  }
  saveInFlight = true;
  updateLocalSaveReceipt();
  saveInFlightPromise = (async () => {
    try {
      await desktopStorage.write(payload);
      lastWrittenPayloadFingerprint = payloadFingerprintValue;
      lastWrittenPersistedRevision = payloadRevision;
      pendingPersistedRevision = payloadRevision;
      localSaveOutcome = "saved";
      return true;
    } catch (error) {
      console.error("Failed to save local task data.", error);
      localSaveOutcome = "failed";
      if (!pendingPayload) {
        // Re-queueing the payload must leave the fingerprints consistent with
        // the bytes still on disk, or the retry could be mistaken for a no-op.
        pendingPayload = payload;
        pendingPersistedRevision = payloadRevision;
        pendingPayloadFingerprint = "";
      }
      if (typeof Recovery26Persisting === "undefined" || !Recovery26Persisting) {
        showWorkspaceError("本地任务数据保存失败，请检查磁盘空间或权限后重试。Recovery 草稿将继续保留。");
      }
      return false;
    }
  })();
  const success = await saveInFlightPromise;
  saveInFlight = false;
  saveInFlightPromise = null;
  updateLocalSaveReceipt();
  if (pendingPayload && success) return (await flushSave()) && success;
  return success;
}

function normalizeFlowWidth(key, value) {
  const [min, max] = flowWidthLimits[key];
  const width = Number(value);
  if (!Number.isFinite(width)) return defaultFlowWidths[key];
  return Math.max(min, Math.min(max, Math.round(width)));
}

function normalizeSidebarWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return defaultSidebarWidth;
  return Math.max(sidebarWidthLimits[0], Math.min(sidebarWidthLimits[1], Math.round(width)));
}

function normalizeDetailHeight(value) {
  const height = Number(value);
  if (!Number.isFinite(height)) return defaultDetailHeight;
  return Math.max(detailHeightLimits[0], Math.min(detailHeightLimits[1], Math.round(height)));
}

function flowWidthStyle() {
  return Object.entries(defaultFlowWidths)
    .flatMap(([key]) => {
      const width = normalizeFlowWidth(key, state.flowWidths[key]);
      return [`--flow-${key}-width:${width}px`, `--flow-${key}-track:${width}fr`];
    })
    .join(";");
}

function workbenchStyle() {
  const detailHeight = normalizeDetailHeight(state.detailHeight);
  return `--detail-pane-height:${detailHeight}%;--flow-pane-height:${100 - detailHeight}%`;
}

function taskRepositoryViewKey() {
  return JSON.stringify([
    state.activeGroupId,
    state.query.trim().toLowerCase(),
    state.taskFilter,
    state.taskDateFilter,
    state.taskDeadlineFilter,
    state.priorityFilter,
    state.captureSourceFilter,
  ]);
}

function processingFlowViewKey(task = activeTask()) {
  return JSON.stringify([task?.id || "", "flow"]);
}

function nodeDetailViewKey(taskId, nodeId) {
  return JSON.stringify([taskId || "", nodeId || ""]);
}

function knowledgeViewKey(task = activeTask()) {
  return JSON.stringify([task?.id || "", "notes"]);
}

// Delayed stabilization must yield to a newer render or physical input. View
// identity alone is insufficient when the user scrolls the same view again.
let renderViewportEpoch = 0;
for (const name of ["pointerdown", "wheel", "keydown", "beforeinput", "compositionstart", "touchmove", "resize"]) {
  window.addEventListener(name, () => { renderViewportEpoch++; }, true);
}
// Input blur does not mean the window lost focus; renders deliberately move
// focus between their controls, so only listen to the window's own blur.
window.addEventListener("blur", () => { renderViewportEpoch++; });

function captureScrollViewport(selector, datasetKey, nextViewKey) {
  const element = document.querySelector(selector);
  if (!element) return null;

  return {
    revision: renderViewportEpoch,
    top: Number(element.scrollTop) || 0,
    left: Number(element.scrollLeft) || 0,
    previousViewKey: element.dataset[datasetKey] || "",
    datasetKey,
    nextViewKey,
  };
}

/**
 * Scroll containers resolved for the current render.
 *
 * render() restores the same four containers up to five times per pass. The
 * root rewrite makes element references stale, so the cache is invalidated
 * right after the regions are placed, not at the start of render().
 */
let renderScrollContainers = null;

function clearRenderScrollCache() {
  renderScrollContainers = null;
}

function scrollContainer(selector) {
  if (!renderScrollContainers) renderScrollContainers = new Map();
  if (renderScrollContainers.has(selector)) return renderScrollContainers.get(selector);
  const element = document.querySelector(selector);
  renderScrollContainers.set(selector, element);
  return element;
}

function restoreScrollViewport(snapshot, selector) {
  if (!snapshot || snapshot.revision !== renderViewportEpoch || snapshot.previousViewKey !== snapshot.nextViewKey) return;

  const element = scrollContainer(selector);
  if (!element) return;
  if (snapshot.datasetKey && element.dataset[snapshot.datasetKey] !== snapshot.nextViewKey) return;

  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
  element.scrollTop = Math.min(snapshot.top, maxTop);
  element.scrollLeft = Math.min(snapshot.left, maxLeft);
}


// ============================================================
// RENDERING -- main render() and all DOM builders
// ============================================================
/** Per-region outcome of the most recent render, exposed for the harness. */
const regionReuse = new Map();
globalThis.__loopLastRegionReuse = regionReuse;

/**
 * The markup this code last generated for each retained region.
 *
 * The cache cannot be keyed by element: rewriting `#root` always builds a fresh
 * element for every region before this runs, so an identity check would never
 * hold and nothing would ever be reused. Comparing against the live DOM instead
 * would also always report a change, because post-render hooks add runtime
 * attributes (`data-action-bound`, row bindings) and the browser re-serializes
 * `<img>` as `<img />`. Storing the generated markup avoids both problems.
 */
const retainedRegionMarkup = new Map();
/**
 * The element rendered for each region last time. The root skeleton carries an
 * empty placeholder per region, so a region whose content is unchanged is put
 * back from here instead of being parsed a second time.
 */
const regionElements = new Map();

/**
 * Fingerprint a region's generated markup.
 *
 * A single pass is used on purpose: region markup reaches tens of kilobytes,
 * and normalizing it with repeated regex replaces cost more than the DOM work
 * the reuse saves on navigations that legitimately change the list.
 *
 * Normalization only has to be consistent between calls. Whitespace differences
 * caused by template-literal indentation therefore collapse to the same
 * fingerprint, because only newlines, tabs and repeated spaces are treated as
 * insignificant - and a real content change alters the length or the hash.
 */
function markupFingerprint(html) {
  const text = String(html ?? "");
  let hash = 2166136261;
  let lastWasSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    const isSpace = code === 32 || code === 9 || code === 10 || code === 13;
    if (isSpace) {
      if (lastWasSpace) continue;
      lastWasSpace = true;
      code = 32;
    } else {
      lastWasSpace = false;
    }
    hash ^= code;
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

/**
 * Keep a generated region only when its content changed.
 *
 * The rewritten root installs an identical copy of every unchanged region, so
 * this swaps the previously rendered element back in. Reusing the node keeps
 * its per-region state: list scroll position, and the idempotency bindings
 * recorded on each row.
 *
 * Reuse is rejected for empty markup, so a region that is no longer rendered
 * (the task list on a wide route) cannot fall back to a stale element.
 */
function retainRegion(name, markup) {
  const placeholder = document.querySelector(`#root [data-region="${name}"]`);
  if (!placeholder) return;
  const next = markup ?? "";
  const fingerprint = markupFingerprint(next);
  const cached = regionElements.get(name);
  // The root rewrite detaches the region that was rendered last time, so a
  // cached element is usable exactly when it is no longer in the document. The
  // fingerprint must also match, or the region's content really did change.
  if (next.trim() && cached && !cached.isConnected && retainedRegionMarkup.get(name) === fingerprint) {
    placeholder.replaceWith(cached);
    regionReuse.set(name, "reused");
    return;
  }
  if (!next.trim()) {
    // Empty markup (the task list on a wide route) must clear the slot rather
    // than fall back to a stale element.
    retainedRegionMarkup.delete(name);
    regionElements.delete(name);
    regionReuse.set(name, "updated");
    return;
  }
  const template = document.createElement("template");
  template.innerHTML = next;
  const replacement = template.content.firstElementChild;
  if (!replacement) {
    regionReuse.set(name, "updated");
    return;
  }
  retainedRegionMarkup.set(name, fingerprint);
  regionElements.set(name, replacement);
  placeholder.replaceWith(replacement);
  regionReuse.set(name, "updated");
}

function canRetainRegion(name, markup) {
  return Boolean(regionElements.get(name)?.isConnected && retainedRegionMarkup.get(name) === markupFingerprint(markup));
}

/**
 * Main render entry: reconstruct the entire DOM from state.
 * Sequence: capture drafts -> flush drafts -> save -> destroy editors
 *   -> set theme/font -> rebuild innerHTML -> bind -> mount editors
 * This is called after every state change.
 */
function render() {
  const viewportRevision = ++renderViewportEpoch;
  clearFilteredTasksCache();
  if (typeof shellBeforeRender === "function") shellBeforeRender();
  reconcileWorkNavigationRuntime();
  const task = activeTask();
  const previousGroupScrollLeft = document.querySelector("[data-sheet-tabs]");
  const groupScrollLeft = previousGroupScrollLeft ? Number(previousGroupScrollLeft.scrollLeft) || 0 : null;
  const repositoryViewport = captureScrollViewport(
    "[data-task-repository-scroll]",
    "taskRepositoryView",
    taskRepositoryViewKey(),
  );
  const flowViewport = captureScrollViewport(
    "[data-processing-flow-scroll]",
    "processingFlowView",
    processingFlowViewKey(task),
  );
  const nodeDetailViewport = captureScrollViewport(
    "[data-node-detail-scroll]",
    "nodeDetailView",
    nodeDetailViewKey(task?.id, state.selectedNodeId),
  );
  const knowledgeViewport = captureScrollViewport(
    "[data-knowledge-scroll]",
    "knowledgeView",
    knowledgeViewKey(task),
  );
  captureMountedMilkdownDrafts();
  flushNodeNoteDrafts({ persist: false });
  save();
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.zhFont = state.zhFont;
  document.documentElement.dataset.enFont = state.enFont;
  document.documentElement.dataset.fontScale = state.fontScale;
  applyLoopAppearance();
  if (task) state.activeTaskId = task.id;
  if (recurrencePopoverTaskId && recurrencePopoverTaskId !== task?.id) recurrencePopoverTaskId = "";
  if (taskGroupSelectTaskId && taskGroupSelectTaskId !== task?.id) taskGroupSelectTaskId = "";
  if (deadlinePopoverTaskId && deadlinePopoverTaskId !== task?.id) deadlinePopoverTaskId = "";
  const shellWide = shellIsWide();
  // Regions that a pane switch must not rebuild. The skeleton below carries an
  // empty placeholder for each of them, so their markup is parsed at most once
  // per render and an unchanged region is restored as the same DOM nodes - which
  // keeps its list scroll position and the bindings recorded on each row.
  const navigationMarkup = renderShellNavigation();
  const topbarMarkup = renderShellTopbar();
  const listMarkup = shellWide ? "" : renderShellTaskList(filteredTasks());
  let workspaceBody = state.calendarOpen ? renderShellCalendar() : state.reviewOpen ? renderShellReview() : state.settingsOpen ? renderShellSettings() : renderShellWorkspace(task);
  if (!workspaceBody.includes("data-workspace-status")) workspaceBody += renderShellWorkspaceFooter();
  const workspaceMarkup = `<section data-region="workspace" class="workspace ${shellWide ? "workspace-wide" : ""}${!shellWide && task && state.taskPane === "notes" && !shellTaskIsNote(task) ? " knowledge-workspace" : ""}" data-task-id="${escAttr(task?.id || "")}" aria-label="${shellWide ? "全屏页面" : "任务工作台"}">
    ${workspaceBody}
  </section>`;
  if (shellWide) retainedRegionMarkup.delete("workspace");
  const keepWorkspace = !shellWide && canRetainRegion("workspace", workspaceMarkup);
  const preservedEditors = new Set();
  if (keepWorkspace) {
    const workspace = regionElements.get("workspace");
    milkdownEditors.forEach((entry, key) => { if (workspace.contains(entry.host)) preservedEditors.add(key); });
  } else stashKnowledgePane();
  cachedKnowledgePanes.forEach((_pane, taskId) => preservedEditors.add(noteDraftKey(taskId, "")));
  destroyMilkdownEditors(preservedEditors);
  document.querySelector("#root").innerHTML = `
    <main class="app ${state.navCollapsed ? "nav-collapsed " : ""}${shellWide ? "app-wide" : ""}" style="--list-width:${normalizeSidebarWidth(state.sidebarWidth)}px">
      ${state.searchOpen ? `<div class="global-search-layer" data-global-search-layer aria-hidden="true"></div>` : ""}
      <div data-region="navigation"></div>
      <div data-region="topbar"></div>
      ${shellWide ? "" : '<div data-region="task-list"></div>'}
      <div data-region="workspace"></div>
      <div id="context-menu-root">${renderContextMenu()}</div>
      ${renderTaskPriorityPopover()}
      ${state.feedbackOpen ? renderBugReportPanel() : ""}
      <div id="overlay-slot"></div>
    </main>
    ${renderTodayWidgetRestore()}
    ${renderKnowledgeDraftPrompt()}
  `;
  retainRegion("navigation", navigationMarkup);
  retainRegion("topbar", topbarMarkup);
  retainRegion("task-list", listMarkup);
  retainRegion("workspace", workspaceMarkup);
  // A draft/status refresh may replace the note chrome while the tabs are in
  // flight. Preserve that unchanged operation independently of the workspace.
  if (regionReuse.get("workspace") !== "reused") {
    const tabs = document.querySelector(".workspace .tabs-bar");
    if (tabs) {
      tabs.dataset.region = "workspace-tabs";
      tabs.dataset.tabTaskId = task?.id || "";
      retainRegion("workspace-tabs", tabs.outerHTML);
    }
  }
  // The root was just rewritten, so any previously resolved container is stale.
  clearRenderScrollCache();
  restoreCachedKnowledgePane(task);
  bind();
  syncContextMenuRoot();
  if (typeof shellAfterRender === "function") shellAfterRender();
  if (typeof shellBindFlowKeyboard === "function") shellBindFlowKeyboard();
  if (typeof shellBindKnowledge === "function") shellBindKnowledge();
  if (typeof shellBindListResizer === "function") shellBindListResizer();
  if (typeof shellBindCreateDialog === "function") shellBindCreateDialog();
  if (typeof shellBindJourneyReceipt === "function") shellBindJourneyReceipt();
  // the work-navigation pill lives in the topbar and is rebuilt on every render
  globalThis.LoopWork?.syncPill?.();
  // Demo phase 17: a finished task's calendar agenda shows its conclusion.
  if (typeof shellApplyCalendarConclusions === "function") shellApplyCalendarConclusions();
  // the feedback dialog lives in #overlay, which render() never touches; keep it in sync
  if (typeof shellHelpFeedbackDialog === "function" && typeof shellOverlayIsOpen === "function" && shellOverlayIsOpen() && document.querySelector("#help14-form")) shellHelpFeedbackDialog();
  if (typeof shellBulkPrune === "function") shellBulkPrune();
  if (typeof shellBindOverlay === "function") shellBindOverlay();
  if (typeof shellBindBulk === "function") shellBindBulk();
  settingsMotion = "none";
  resizeTaskBriefTextareas();
  const restoreGroupScroll = () => {
    if (groupScrollLeft === null || viewportRevision !== renderViewportEpoch) return;
    const groupScroller = document.querySelector("[data-sheet-tabs]");
    if (groupScroller) groupScroller.scrollLeft = groupScrollLeft;
  };
  const restoreRenderViewports = () => {
    restoreScrollViewport(repositoryViewport, "[data-task-repository-scroll]");
    restoreScrollViewport(flowViewport, "[data-processing-flow-scroll]");
    restoreScrollViewport(nodeDetailViewport, "[data-node-detail-scroll]");
    restoreScrollViewport(knowledgeViewport, "[data-knowledge-scroll]");
  };
  // The repeated calls are load-bearing: the group and repository scroll tests
  // pin the rule that a view keeps its offset while a different group or filter
  // resets it. Their measured cost is ~0.075ms per render, so keeping the
  // original sequence is cheaper than re-deriving that rule.
  restoreGroupScroll();
  restoreRenderViewports();
  focusPendingElement();
  restoreGroupScroll();
  restoreRenderViewports();
  publishTodayWidgetSnapshot();
  publishDeadlineReminderSnapshot();
  window.requestAnimationFrame(() => {
    restoreGroupScroll();
    restoreRenderViewports();
    if (viewportRevision === renderViewportEpoch) restoreDeadlinePickerTimeScroll();
    mountMilkdownEditors();
    restoreRenderViewports();
    window.requestAnimationFrame(() => {
      restoreRenderViewports();
      revealPendingTask();
    });
  });
  document.dispatchEvent(new CustomEvent("loop-work-navigation:rendered"));
}

function renderCompletionNotice() {
  if (state.tasks.some((item) => item.id === state.conclusionPromptTaskId)) {
    return "请先填写结论，再标记完成";
  }
  if (state.tasks.some((item) => item.id === state.flowPromptTaskId)) {
    return "请先完成处理流中的所有节点，再标记任务完成";
  }
  return "";
}

function renderTodayWidgetRestore() {
  return desktopTodayWidget && !todayWidgetWindowState.visible
    ? `<button class="restore-widget is-visible" type="button" data-action="show-today-widget">重新显示今日窗口</button>`
    : "";
}

function renderKnowledgeDraftPrompt() {
  const taskId = state.knowledgeDraftPrompt?.taskId;
  const mode = state.knowledgeDraftPrompt?.mode || "delete-task";
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return "";
  const closingEditor = mode === "close-editor";
  return `
    <div class="knowledge-draft-backdrop" role="presentation">
      <section class="knowledge-draft-dialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-draft-title">
        <div class="knowledge-draft-heading">
          <span class="knowledge-draft-kicker">知识笔记</span>
          <h2 id="knowledge-draft-title">${closingEditor ? "关闭前如何处理这篇草稿？" : "这篇笔记尚未保存为本地文件"}</h2>
          <p>${closingEditor ? "保存会打开文件选择；保留会关闭编辑页但继续保护草稿。" : "你可以先保存文件，也可以保留草稿。删除草稿不会删除任何本地 Markdown 文件或附件。"}</p>
        </div>
        <div class="knowledge-draft-context">${esc(task.title || "未命名任务")}</div>
        <div class="knowledge-draft-actions">
          <button type="button" data-action="keep-knowledge-draft" data-task-id="${escAttr(task.id)}">保留为草稿</button>
          <button type="button" data-action="delete-knowledge-draft" data-task-id="${escAttr(task.id)}">删除草稿</button>
          <button class="primary" type="button" data-action="${closingEditor ? "save-knowledge-before-close" : "save-knowledge-before-delete"}" data-task-id="${escAttr(task.id)}">保存</button>
        </div>
      </section>
    </div>
  `;
}

function renderGlobalSearch() {
  return `
    <div class="app-global-search search-box search gooey-search is-open" data-gooey-search data-open="true" data-persistent-search="true">
      <button class="gooey-search-trigger" type="button" data-gooey-search-trigger aria-hidden="true" tabindex="-1">
        ${briefFieldIcon("search", "app-command-icon")}
      </button>
      <label class="gooey-search-field" for="search">
        ${briefFieldIcon("search", "app-command-icon")}
        <input id="search" type="search" value="${escAttr(state.query)}" placeholder="搜索" aria-label="搜索任务、节点或内容" autocomplete="off" enterkeyhint="search" tabindex="0" />
        <span class="search-shortcut" aria-hidden="true">⌘ K</span>
      </label>
    </div>
  `;
}

function globalSearchMatches() {
  const query = state.query.trim().toLowerCase();
  const byRecentActivity = (a, b) => {
    const aTime = Date.parse(a.updatedAt || a.createdAt || "") || 0;
    const bTime = Date.parse(b.updatedAt || b.createdAt || "") || 0;
    return bTime - aTime || a.order - b.order;
  };
  const tasks = [...state.tasks].sort(byRecentActivity);

  if (!query) {
    return {
      recent: tasks.filter((task) => task.captureSource !== "today-widget").slice(0, 6),
      tasks: [],
      nodes: [],
      notes: [],
    };
  }

  const taskMatches = [];
  const nodeMatches = [];
  const noteMatches = [];
  tasks.forEach((task) => {
    const taskText = `${task.title || ""} ${task.description || ""} ${task.hypothesis || ""} ${task.conclusion || ""}`.toLowerCase();
    if (taskText.includes(query)) {
      if (task.captureSource === "today-widget") noteMatches.push(task);
      else taskMatches.push(task);
    }
    flatten(task.nodes).forEach((node) => {
      if (`${node.title || ""} ${node.note || ""}`.toLowerCase().includes(query)) {
        nodeMatches.push({ task, node });
      }
    });
  });

  return {
    recent: [],
    tasks: taskMatches.slice(0, 6),
    nodes: nodeMatches.slice(0, 6),
    notes: noteMatches.slice(0, 4),
  };
}

function renderGlobalSearchTaskResult(task, kind = "task") {
  const completed = task.status === "done";
  return `
    <button class="global-search-result" type="button" data-action="open-global-search-task" data-task-id="${escAttr(task.id)}">
      <span class="global-search-result-icon ${completed ? "is-complete" : ""}" aria-hidden="true">
        ${briefFieldIcon(kind === "note" ? "file-text" : completed ? "check" : "circle", "global-search-result-svg")}
      </span>
      <span class="global-search-result-copy">
        <strong>${esc(task.title || (kind === "note" ? "未命名速记" : "未命名任务"))}</strong>
        <span>${esc(kind === "note" ? "今日速记" : taskSubtitle(task))}</span>
      </span>
      ${briefFieldIcon("chevron-right", "global-search-result-arrow")}
    </button>
  `;
}

function renderGlobalSearchNodeResult({ task, node }) {
  return `
    <button class="global-search-result" type="button" data-action="open-global-search-node" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(node.id)}">
      <span class="global-search-result-icon" aria-hidden="true">${briefFieldIcon("git-branch", "global-search-result-svg")}</span>
      <span class="global-search-result-copy">
        <strong>${esc(node.title || "未命名节点")}</strong>
        <span>${esc(task.title || "未命名任务")}</span>
      </span>
      ${briefFieldIcon("chevron-right", "global-search-result-arrow")}
    </button>
  `;
}

function renderGlobalSearchSection(label, items, renderItem) {
  if (!items.length) return "";
  return `
    <section class="global-search-result-section">
      <div class="global-search-result-heading"><span>${label}</span><b>${items.length}</b></div>
      <div class="global-search-result-list">${items.map(renderItem).join("")}</div>
    </section>
  `;
}

function renderGlobalSearchResults() {
  const matches = globalSearchMatches();
  const content = [
    renderGlobalSearchSection("最近任务", matches.recent, (task) => renderGlobalSearchTaskResult(task)),
    renderGlobalSearchSection("任务", matches.tasks, (task) => renderGlobalSearchTaskResult(task)),
    renderGlobalSearchSection("节点", matches.nodes, renderGlobalSearchNodeResult),
    renderGlobalSearchSection("速记", matches.notes, (task) => renderGlobalSearchTaskResult(task, "note")),
  ].join("");

  if (content) return content;
  return `
    <div class="global-search-empty">
      ${briefFieldIcon("search", "global-search-empty-icon")}
      <strong>${state.query.trim() ? "没有找到相关内容" : "还没有可搜索的任务"}</strong>
      <span>${state.query.trim() ? "换个关键词试试" : "创建任务后可以在这里定位"}</span>
    </div>
  `;
}

function renderGlobalSearchPanel() {
  return `
    <section class="global-search-panel" data-global-search-panel role="dialog" aria-modal="false" aria-label="全局搜索结果">
      <div class="global-search-results" data-global-search-results aria-live="polite">${renderGlobalSearchResults()}</div>
      <footer class="global-search-footer"><span>输入关键词筛选</span><span><kbd>Esc</kbd> 关闭</span></footer>
    </section>
  `;
}

function renderAppTopbar() {
  const todayActive = state.taskFilter === "today" && !state.calendarOpen && !state.reviewOpen;
  const tasksActive = state.taskFilter !== "today" && !state.calendarOpen && !state.reviewOpen;
  return `
    <header class="app-command-bar" aria-label="应用导航">
      <nav class="app-primary-navigation" aria-label="主要功能">
        <button class="app-nav-button ${todayActive ? "active" : ""}" type="button" data-setting-button="task-filter" data-value="today" aria-pressed="${todayActive}" title="今日">
          ${briefFieldIcon("home", "app-command-icon")}<span>今日</span>
        </button>
        <button class="app-nav-button ${tasksActive ? "active" : ""}" type="button" data-setting-button="task-filter" data-value="all" aria-pressed="${tasksActive}" title="任务">
          ${briefFieldIcon("check-square", "app-command-icon")}<span>任务</span>
        </button>
        <button class="app-nav-button ${state.calendarOpen ? "active" : ""}" type="button" data-action="toggle-calendar" aria-pressed="${state.calendarOpen}" title="日历">
          ${briefFieldIcon("calendar", "app-command-icon")}<span>日历</span>
        </button>
        <button class="app-nav-button ${state.reviewOpen ? "active" : ""}" type="button" data-action="toggle-review" aria-pressed="${state.reviewOpen}" title="回顾">
          ${briefFieldIcon("clock", "app-command-icon")}<span>回顾</span>
        </button>
        ${renderSidebarUpdateControl()}
      </nav>
      <div class="app-topbar-search ${state.searchOpen ? "is-open" : ""}" data-topbar-search>
        ${renderGlobalSearch()}
        ${state.searchOpen ? renderGlobalSearchPanel() : ""}
      </div>
      <div class="app-command-status">
        <div class="topbar-rhythm-slot" aria-live="polite"></div>
        <div class="app-command-utilities">
          <button class="app-command-utility settings-trigger settings-button ${state.settingsOpen ? "active" : ""}" type="button" data-action="toggle-settings" title="设置" aria-label="设置">
            ${briefFieldIcon("settings", "app-command-utility-icon")}
          </button>
          <button class="app-command-utility theme-toggle theme-button" type="button" role="switch" data-action="toggle-theme" title="${state.theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}" aria-label="${state.theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}" aria-checked="${state.theme === "dark"}">
            ${briefFieldIcon(state.theme === "dark" ? "moon" : "sun", "app-command-utility-icon")}
          </button>
        </div>
      </div>
    </header>
  `;
}

function renderSidebarFooter() {
  return "";
}

function renderSidebar() {
  const visibleCount = filteredTasks().length;
  const scopedTasks = taskListStatsTasks();
  const focusItems = todayFocusItems();
  const todayMode = state.taskFilter === "today" && !state.calendarOpen && !state.reviewOpen;
  const activeRepositoryFilterCount = Number(state.priorityFilter !== "all")
    + Number(state.captureSourceFilter !== "all")
    + Number(state.activeGroupId !== ALL_TASKS_GROUP_ID);
  return `
    <aside class="sidebar rail ${todayMode ? "sidebar-today-mode focus-rail" : "sidebar-tasks-mode"}" data-primary-view="${todayMode ? "today" : "tasks"}">
      <span class="sidebar-resizer" data-sidebar-resizer title="调整侧栏宽度"></span>
      ${todayMode ? renderTodayFocus(focusItems) : ""}

      ${todayMode ? "" : `<div class="task-list task-repository" data-context="task-list">
        <div class="repository-fixed-header">
          <div class="repository-heading-row">
            <div class="repository-library-heading">
              <span class="task-list-count">${visibleCount === scopedTasks.length ? `${visibleCount} 项` : `${visibleCount} / ${scopedTasks.length} 项`}</span>
            </div>
            <div class="repository-context-actions">
              <details class="repository-filter-menu" ${repositoryFilterMenuOpen ? "open" : ""}>
                <summary class="repository-filter-trigger ${activeRepositoryFilterCount ? "is-active" : ""}" aria-label="打开任务筛选" title="筛选任务">
                  ${briefFieldIcon("sliders", "repository-filter-icon")}
                </summary>
                <div class="repository-filter-popover">
                  <div class="repository-filter-heading">
                    <strong>筛选任务</strong>
                    <span>按条件缩小范围</span>
                  </div>
                  <section class="repository-filter-section repository-group-filter-section">
                    <span class="repository-filter-label">分组</span>
                    <div class="repository-group-slot" aria-label="分组">${renderRepositoryGroupPicker()}</div>
                  </section>
                  <section class="repository-filter-section">
                    <span class="repository-filter-label">优先级</span>
                    <details class="repository-priority-menu" ${repositoryPriorityFilterOpen ? "open" : ""}>
                      <summary class="repository-priority-trigger" aria-label="优先级筛选" title="按优先级筛选">
                        <span>${esc(repositoryPriorityFilterLabels[state.priorityFilter] || repositoryPriorityFilterLabels.all)}</span>
                        ${briefFieldIcon("chevron-down", "repository-filter-chevron")}
                      </summary>
                      <div class="repository-priority-options" role="listbox" aria-label="选择优先级">
                        ${Object.entries(repositoryPriorityFilterLabels).map(([value, label]) => `
                          <button class="repository-priority-option ${state.priorityFilter === value ? "selected" : ""}" type="button" role="option" aria-selected="${state.priorityFilter === value}" data-action="set-repository-priority-filter" data-value="${value}">
                            <span>${esc(label)}</span>${state.priorityFilter === value ? '<span aria-hidden="true">✓</span>' : ""}
                          </button>
                        `).join("")}
                      </div>
                    </details>
                  </section>
                  <section class="repository-filter-section">
                    <span class="repository-filter-label">记录类型</span>
                    ${renderRepositoryTypeToggles()}
                  </section>
                </div>
              </details>
              <button class="add-task-floating" type="button" data-action="add-task" title="新增任务" aria-label="新增任务">
                <svg class="add-task-floating-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
              </button>
            </div>
          </div>
          ${renderRepositorySegmentedFilter("completion-segmented task-status-filters", "任务状态筛选", [
            ["all", "全部"],
            ["active", "未完成"],
            ["done", "已完成"],
          ], state.taskFilter, "task-filter")}
        </div>
        <div class="repository-list-wrapper">
          <div class="repository-scroll-area" data-task-repository-scroll data-task-repository-view="${escAttr(taskRepositoryViewKey())}">
            <div class="task-repository-rows">${renderTaskRepositoryRows()}</div>
          </div>
        </div>
      </div>`}
      ${renderSidebarFooter(todayMode)}
    </aside>
  `;
}

function renderRepositorySegmentedFilter(className, label, options, selected, setting) {
  return `
    <div class="repository-segmented ${className}" role="group" aria-label="${escAttr(label)}">
      ${options.map(([value, text]) => `<button class="${selected === value ? "active" : ""}" type="button" data-setting-button="${setting}" data-value="${value}" data-active="${selected === value}" aria-pressed="${selected === value}">${text}</button>`).join("")}
  </div>
  `;
}

function renderTodayFocus(items) {
  return `
    <div class="focus-list" aria-label="今日待办">
      ${
        items.length
          ? items.map((item, index) => renderTodayFocusItem(item, index)).join("")
          : `<div class="focus-empty">今日暂无重点任务</div>`
      }
    </div>
  `;
}

function renderTodayFocusItem(item, index = 0) {
  const { task, node } = item;
  // Today focus represents a task, not the currently opened flow node. A task
  // must remain visibly selected even when its suggested next step is different.
  const selected = task.id === state.activeTaskId;
  return `
    <button class="focus-row ${selected ? "selected" : ""}" type="button" data-action="select-focus" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(node?.id || "")}">
      <b>${index + 1}</b>
      <span>${esc(task.title || "未命名任务")}</span>
      ${briefFieldIcon("chevron-right", "focus-row-chevron")}
    </button>
  `;
}

function repositoryTypeSelection() {
  return {
    includeTask: state.captureSourceFilter !== "quick",
    includeNote: state.captureSourceFilter !== "task",
  };
}

function repositoryGroupLabel() {
  if (state.activeGroupId === ALL_TASKS_GROUP_ID) return "全部记录";
  if (state.activeGroupId === UNGROUPED_TASKS_GROUP_ID) return "未分组";
  return state.taskGroups.find((group) => group.id === state.activeGroupId)?.title || "全部记录";
}

function repositoryGroupPickerOptions() {
  const query = repositoryGroupQuery.trim().toLowerCase();
  const groups = sort(state.taskGroups).filter((group) => !query || group.title.toLowerCase().includes(query));
  return { groups };
}

function renderRepositoryGroupOption(groupId, title) {
  const selected = state.activeGroupId === groupId;
  const personalGroup = state.taskGroups.some((group) => group.id === groupId);
  if (personalGroup && state.editingGroupId === groupId) {
    return `<div class="repository-group-option is-editing" role="option" aria-selected="${selected}" data-group-id="${escAttr(groupId)}" data-personal-group="true"><input class="repository-group-edit" data-group-title="${escAttr(groupId)}" value="${escAttr(title)}" aria-label="修改分组名称" /></div>`;
  }
  return `<button class="repository-group-option ${selected ? "selected" : ""}" type="button" role="option" aria-selected="${selected}" data-action="select-repository-group" data-group-id="${escAttr(groupId)}" ${personalGroup ? 'data-personal-group="true"' : ""}><span>${esc(title)}</span>${selected ? `<span class="repository-group-check" aria-hidden="true">✓</span>` : ""}</button>`;
}

function renderRepositoryGroupOptions() {
  const { groups } = repositoryGroupPickerOptions();
  const query = repositoryGroupQuery.trim().toLowerCase();
  const showAll = !query || "全部记录".includes(query);
  const showUngrouped = !query || "未分组".includes(query);
  const systemOptions = `${showAll ? renderRepositoryGroupOption(ALL_TASKS_GROUP_ID, "全部记录") : ""}${showUngrouped ? renderRepositoryGroupOption(UNGROUPED_TASKS_GROUP_ID, "未分组") : ""}`;
  const personalOptions = groups.map((group) => renderRepositoryGroupOption(group.id, group.title)).join("") || `<div class="repository-group-empty">没有匹配的个人分组</div>`;
  return `<div class="repository-group-section repository-group-system">${systemOptions || `<div class="repository-group-empty">没有匹配的记录范围</div>`}</div><div class="repository-group-divider" role="separator"></div><div class="repository-group-section repository-group-personal"><div class="repository-group-heading">个人分组</div>${personalOptions}</div>`;
}

function renderRepositoryTypeToggles() {
  const types = repositoryTypeSelection();
  return `
    <div class="repository-type-toggles" role="group" aria-label="任务类型">
      <button class="type-filter-button ${types.includeTask ? "is-checked" : ""}" type="button" data-action="toggle-repository-type" data-type="task" aria-pressed="${types.includeTask}"><span class="type-checkbox" aria-hidden="true">✓</span><span>任务</span></button>
      <button class="type-filter-button ${types.includeNote ? "is-checked" : ""}" type="button" data-action="toggle-repository-type" data-type="note" aria-pressed="${types.includeNote}"><span class="type-checkbox" aria-hidden="true">✓</span><span>速记</span></button>
    </div>
  `;
}

function renderRepositoryGroupPicker() {
  const open = repositoryGroupPickerOpen;
  const growthSource = normalizeCurrentWorkNavigation().config.growth.sourceGroupId;
  const activePersonalGroup = state.taskGroups.find((group) => group.id === state.activeGroupId) || null;
  const isGrowthSource = activePersonalGroup?.id === growthSource;
  return `
    <div class="repository-group-picker ${open ? "is-open" : ""}">
      <button class="repository-group-trigger" type="button" data-action="toggle-repository-group-picker" aria-expanded="${open}" aria-haspopup="listbox" title="选择分组；双击可修改当前分组名称"><span class="repository-group-value">${esc(repositoryGroupLabel())}</span>${briefFieldIcon("chevron-down", "repository-group-chevron")}</button>
      ${open ? `
        <div class="repository-group-popover" role="listbox" aria-label="选择分组">
          <label class="repository-group-search"><span aria-hidden="true">⌕</span><input type="search" value="${escAttr(repositoryGroupQuery)}" placeholder="搜索" aria-label="搜索分组" autocomplete="off" /></label>
          <div class="repository-group-options">
            ${renderRepositoryGroupOptions()}
          </div>
          <div class="repository-group-footer">
            <button type="button" data-action="add-group">＋ 新建分组</button>
            ${activePersonalGroup ? `<button class="repository-batch-add" type="button" data-action="batch-add-tasks" data-group-id="${escAttr(activePersonalGroup.id)}"><span>批量添加任务…</span>${isGrowthSource ? '<small>成长来源</small>' : ""}</button>` : ""}
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function renderRepositoryScopeBar() {
  return `
    <div class="repository-scope-bar">
      ${renderRepositoryTypeToggles()}
      ${renderRepositoryGroupPicker()}
    </div>
  `;
}

// Kept only for existing tests: the sidebar renders the group picker inside
// the collapsed repository filter popover (see renderSidebar) and never calls
// this scope bar, so production markup does not include it.
function renderGroupTabs() {
  return `
    <div class="sheet-bar group-nav" aria-label="分组">
      <button class="sheet-nav scroll-button" type="button" data-action="scroll-sheets" data-direction="-1" title="查看前面的分组" aria-label="查看前面的分组">‹</button>
      <span class="sheet-tab-all-wrap"><button class="sheet-tab sheet-tab-all ${state.activeGroupId === ALL_TASKS_GROUP_ID ? "active" : ""}" type="button" data-action="select-group" data-group-id="${ALL_TASKS_GROUP_ID}" title="查看全部分组中的任务">全部任务</button></span>
      <div class="sheet-tabs task-tabs" data-sheet-tabs>${sort(state.taskGroups).map((group) => `<span class="sheet-tab-wrap" draggable="true" data-group-id="${escAttr(group.id)}">${state.editingGroupId === group.id ? `<input class="sheet-edit" data-group-title="${escAttr(group.id)}" value="${escAttr(group.title)}" aria-label="分组名称" />` : `<button class="sheet-tab ${group.id === state.activeGroupId ? "active" : ""}" type="button" data-action="select-group" data-group-id="${escAttr(group.id)}" title="${escAttr(group.title)}">${esc(group.title)}</button>`}</span>`).join("")}</div>
      <button class="sheet-nav scroll-button" type="button" data-action="scroll-sheets" data-direction="1" title="查看后面的分组" aria-label="查看后面的分组">›</button>
      <button class="sheet-add add-group-button" type="button" data-action="add-group" title="新增分组" aria-label="新增分组">+</button>
    </div>
  `;
}

function renderTaskPriorityControl(task) {
  const priority = normalizePriority(task.priority);
  return `
    <button class="task-priority-control ${priority}" type="button" data-action="toggle-task-priority-menu" data-task-id="${escAttr(task.id)}" aria-haspopup="menu" aria-expanded="${taskPriorityMenu?.taskId === task.id}" title="修改优先级">
      <span class="task-priority-dot" aria-hidden="true"></span>
      <span>${repositoryPriorityLabels[priority]}</span>
      <svg class="task-priority-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="m3.5 4.75 2.5 2.5 2.5-2.5"></path></svg>
    </button>
  `;
}

function renderTaskPriorityPopover() {
  if (!taskPriorityMenu) return "";
  const task = state.tasks.find((item) => item.id === taskPriorityMenu.taskId);
  if (!task) return "";
  const priority = normalizePriority(task.priority);
  return `
    <div class="task-priority-layer" data-action="close-task-priority-menu">
      <div class="task-priority-popover" role="menu" aria-label="设置优先级" style="left:${taskPriorityMenu.x}px;top:${taskPriorityMenu.y}px">
        <span class="task-priority-popover-label">优先级</span>
        ${Object.entries(repositoryPriorityLabels).map(([value, label]) => `
          <button class="task-priority-option ${value} ${priority === value ? "selected" : ""}" type="button" role="menuitemradio" aria-checked="${priority === value}" data-action="set-task-priority" data-task-id="${escAttr(task.id)}" data-priority="${value}">
            <span class="task-priority-option-dot" aria-hidden="true"></span>
            <span>${label}</span>
            <span class="task-priority-option-check" aria-hidden="true">${priority === value ? "✓" : ""}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderTaskItem(task, displayOrder) {
  return `
    <div class="task-item task-row ${task.id === state.activeTaskId ? "selected active" : ""} ${task.status === "done" ? "done" : ""}" draggable="true" data-context="task" data-task-id="${escAttr(task.id)}" data-task-drag-target="${escAttr(task.id)}">
      <span class="task-sequence-action">
        <span class="task-sequence" aria-hidden="true">${displayOrder}</span>
        <button class="task-check repository-complete ${task.status === "done" ? "is-checked" : ""}" type="button" title="${task.status === "done" ? "标记为未完成" : "标记为完成"}" aria-label="${task.status === "done" ? "标记为未完成" : "标记为完成"}" aria-pressed="${task.status === "done"}" data-action="toggle-task-done" data-task-id="${escAttr(task.id)}"></button>
      </span>
      <span class="task-title-wrap row-title">
        <input class="task-title" placeholder="任务标题" aria-label="任务标题" data-edit-key="title" data-task-id="${escAttr(task.id)}" value="${escAttr(task.title)}" />
      </span>
      <span class="task-row-meta">
        ${renderTaskDeadlineBadge(task)}
        ${renderTaskPriorityControl(task)}
      </span>
    </div>
  `;
}

function renderTaskRepositoryRows() {
  return filteredTasks()
    .map((task, index) => renderTaskItem(task, index + 1))
    .join("");
}

function refreshTaskRepository() {
  const scopedTasks = taskListStatsTasks();
  const count = document.querySelector(".task-list-count");
  const rows = document.querySelector(".task-repository-rows");
  if (count) count.textContent = `${filteredTasks().length} / ${scopedTasks.length} 项`;
  if (!rows) return;
  rows.innerHTML = renderTaskRepositoryRows();
  bindTaskRepositoryRows(rows);
}

function setGooeySearchOpen(control, open, { focusInput = false, focusTrigger = false } = {}) {
  if (!control) return;
  const input = control.querySelector("#search");
  const trigger = control.querySelector("[data-gooey-search-trigger]");
  const persistent = control.dataset.persistentSearch === "true";
  const nextOpen = persistent || Boolean(open || state.query.trim());
  state.searchOpen = nextOpen;
  control.classList.toggle("is-open", nextOpen);
  control.dataset.open = String(nextOpen);
  trigger?.setAttribute("aria-expanded", String(nextOpen));
  if (input) input.tabIndex = persistent || nextOpen ? 0 : -1;

  if (focusInput && nextOpen && input) {
    window.requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      const cursor = Math.min(state.searchCursor || input.value.length, input.value.length);
      input.setSelectionRange(cursor, cursor);
    });
  } else if (focusTrigger && !nextOpen && trigger) {
    window.requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
  }
}

function bindGooeySearch() {
  const control = document.querySelector("[data-gooey-search]");
  const search = control?.querySelector("#search");
  const trigger = control?.querySelector("[data-gooey-search-trigger]");
  if (!control || !search) return;
  const persistent = control.dataset.persistentSearch === "true";

  search.addEventListener("focus", () => {
    if (!persistent || state.searchOpen) return;
    state.searchOpen = true;
    state.focusSearch = true;
    state.searchCursor = search.selectionStart ?? search.value.length;
    render();
  });

  let isComposing = false;
  const refreshSearch = () => {
    state.query = search.value;
    state.searchCursor = search.selectionStart ?? search.value.length;
    refreshGlobalSearchResults();
  };

  trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.searchCursor = search.value.length;
    setGooeySearchOpen(control, true, { focusInput: true });
  });

  search.addEventListener("click", (event) => event.stopPropagation());
  search.addEventListener("compositionstart", () => {
    isComposing = true;
  });
  search.addEventListener("compositionend", () => {
    isComposing = false;
    refreshSearch();
  });
  search.addEventListener("input", () => {
    if (!isComposing) refreshSearch();
  });
  search.addEventListener("search", () => {
    if (!isComposing) refreshSearch();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    event.stopPropagation();
    if (search.value) {
      search.value = "";
      state.query = "";
      state.searchCursor = 0;
      refreshGlobalSearchResults();
      return;
    }
    closeGlobalSearch();
  });

  control.addEventListener("focusout", () => {
    window.requestAnimationFrame(() => {
      if (persistent) return;
      if (control.contains(document.activeElement) || search.value.trim()) return;
      setGooeySearchOpen(control, false);
    });
  });
}

function bindGlobalSearchResultActions(scope) {
  scope?.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      void action(element.dataset, event);
    });
  });
}

function refreshGlobalSearchResults() {
  const results = document.querySelector("[data-global-search-results]");
  if (!results) return;
  results.innerHTML = renderGlobalSearchResults();
  bindGlobalSearchResultActions(results);
}

function closeGlobalSearch() {
  state.searchOpen = false;
  state.focusSearch = false;
  state.searchCursor = 0;
  state.query = "";
  render();
}

function taskSubtitle(task) {
  const nextNode = nextOpenNode(task.nodes);
  if (nextNode?.title?.trim()) return nextNode.title.trim();
  if (task.status === "done") return "已完成";
  const text = (task.description || task.hypothesis || task.conclusion || "").trim();
  return text || "等待补充处理流";
}

function renderTaskPage(task) {
  const topNodes = sort(task.nodes);
  const selectedNode = state.selectedNodeId ? findNode(task.nodes, state.selectedNodeId) : null;
  const summary = taskSummary(task);
  const needsConclusion = state.conclusionPromptTaskId === task.id && !task.conclusion.trim();
  return `
    <div class="task-page work-surface">
      <header class="page-header topbar">
        <div class="page-title-block title-block">
          <input class="page-title" aria-label="任务标题" data-edit-key="title" data-task-id="${escAttr(task.id)}" value="${escAttr(task.title)}" />
          <div class="page-properties meta-line">
            ${renderTaskActiveTagPills(task)}
            <span class="task-context-item task-context-badge priority ${task.priority}" data-slot="badge">${priorityLabels[task.priority]}优先</span>
            <span class="task-context-divider" aria-hidden="true"></span>
            <span class="task-context-item task-context-badge status ${task.status === "done" ? "resolved" : "attention"}" data-slot="badge">${task.status === "done" ? "已完成" : "处理中"}</span>
            <span class="task-context-progress">${summary.done}/${summary.total || 0} 节点</span>
            <span class="task-context-divider" aria-hidden="true"></span>
            ${renderTaskDeadlineControl(task)}
            ${renderTaskRecurrenceControls(task)}
            <span class="task-context-divider" aria-hidden="true"></span>
            ${renderTaskGroupSelect(task)}
          </div>
        </div>
        <div class="actions">
          <div class="topbar-rhythm-slot" aria-live="polite"></div>
          <button class="share-trigger icon-button" type="button" data-action="share-task" data-task-id="${escAttr(task.id)}" title="分享任务" aria-label="分享任务">
            分享
          </button>
        </div>
      </header>

      <section class="task-brief brief-strip" aria-label="任务简报">
        ${renderBriefField("背景", textareaHtml("description", task.description, task.id), false, "background")}
        ${renderBriefField("进展", textareaHtml("hypothesis", task.hypothesis, task.id), false, "hypothesis")}
        ${renderBriefField("结论", textareaHtml("conclusion", task.conclusion, task.id), needsConclusion, "conclusion")}
      </section>

      ${renderTaskPaneTabs(task)}

      <section class="task-workbench lower">
        ${state.taskPane === "flow" ? `<section class="task-workspace flow-workspace ${selectedNode ? "has-node-page" : ""}">
          <section class="flow-section flow-main" data-context="flow-root" data-task-id="${escAttr(task.id)}" data-processing-flow-scroll data-processing-flow-view="${escAttr(processingFlowViewKey(task))}">
          ${
            topNodes.length
              ? `<div class="flow-list flow-outline" style="--flow-visible-row-count:${visibleFlowRowCount(topNodes)}" data-context="flow-root" data-task-id="${escAttr(task.id)}">${topNodes.map((node, index) => renderFlowNode(task.id, node, 0, index, [], index === topNodes.length - 1)).join("")}</div>`
              : `<div class="flow-list flow-outline empty-flow" data-context="flow-root" data-task-id="${escAttr(task.id)}"></div>`
          }
          </section>
          ${selectedNode ? renderNodeDetailPage(task.id, selectedNode) : ""}
        </section>` : state.taskPane === "notes" ? renderTaskKnowledge(task) : renderTaskHistory(task)}
      </section>
    </div>
  `;
}

function renderTaskPaneTabs(task) {
  const tabs = [
    ["flow", "处理流"],
    ["notes", "知识笔记"],
    ["history", "历史处理"],
  ];
  return `
    <nav class="task-pane-tabs" aria-label="任务内容">
      ${tabs
        .map(
          ([pane, label]) => `<button class="task-pane-tab ${state.taskPane === pane ? "active" : ""}" type="button" data-action="switch-task-pane" data-pane="${pane}">${label}</button>`,
        )
        .join("")}
      ${state.taskPane === "flow" && flatten(task.nodes).some((node) => node.children.length) ? `<button class="task-pane-collapse" type="button" data-action="toggle-all-nodes" data-task-id="${escAttr(task.id)}">${flatten(task.nodes).some((node) => node.collapsed) ? "展开全部" : "收起全部"}</button>` : ""}
    </nav>
  `;
}

function renderTaskKnowledge(task) {
  // Presentation lives in src/knowledge.js; the editor, file binding, conflict
  // and recovery logic below are still the project's own.
  if (typeof renderShellKnowledge === "function") return renderShellKnowledge(task);
  const stats = markdownStats(task.notes);
  const note = task.knowledgeNote || {};
  const unavailable = state.knowledgeFileIssues[note.noteId];
  const stateDetails = {
    DRAFT: { label: "草稿", detail: "尚未保存到本地文件" },
    SAVED: { label: "已保存", detail: note.filePath || "本地文件" },
    DIRTY: { label: "已修改", detail: note.filePath || "尚未保存到本地文件" },
    EXTERNAL_CHANGED: { label: "⚠ 文件已被外部修改", detail: note.filePath || "请先选择处理方式" },
    FILE_MISSING: { label: "⚠ 本地文件不存在", detail: note.filePath || "请重新定位或另存为" },
    READ_ONLY: { label: "⚠ 当前文件不可写", detail: note.filePath || "请重试或另存为" },
  };
  const stateDetail = unavailable
    ? { label: "⚠ 文件暂时不可用", detail: unavailable.message }
    : stateDetails[note.documentState] || stateDetails.DRAFT;
  const stateClass = String(note.documentState || "DRAFT").toLowerCase();
  const conflictActions = note.documentState === "EXTERNAL_CHANGED"
    ? `<button type="button" data-action="reload-knowledge" data-task-id="${escAttr(task.id)}">重新加载</button>
       <button type="button" data-action="save-knowledge-overwrite" data-task-id="${escAttr(task.id)}">仍然覆盖</button>`
    : note.documentState === "FILE_MISSING"
      ? `<button type="button" data-action="relocate-knowledge" data-task-id="${escAttr(task.id)}">重新定位</button>`
      : note.documentState === "READ_ONLY"
        ? `<button type="button" data-action="retry-knowledge" data-task-id="${escAttr(task.id)}">重试</button>`
      : "";
  const removeBindingAction = note.filePath
    ? `<button type="button" data-action="remove-knowledge-binding" data-task-id="${escAttr(task.id)}">从软件中移除</button>`
    : "";
  const closeDraftAction = note.documentState === "DRAFT"
    ? `<button type="button" data-action="close-knowledge-editor" data-task-id="${escAttr(task.id)}">关闭笔记</button>`
    : "";
  return `
    <section class="task-knowledge-pane" data-task-id="${escAttr(task.id)}">
      <section class="markdown-panel milkdown-panel task-knowledge-editor-panel" data-task-id="${escAttr(task.id)}" data-editor-focus-target="task">
        <div class="knowledge-save-bar">
          <div class="knowledge-state-meta state-${stateClass}" data-knowledge-state="${escAttr(note.documentState || "DRAFT")}" aria-live="polite">
            <span class="knowledge-state-label">${esc(stateDetail.label)}</span>
            <span class="knowledge-file-label" title="${escAttr(stateDetail.detail)}">${esc(stateDetail.detail)}</span>
          </div>
          <div class="knowledge-save-actions">
            ${conflictActions}
            ${removeBindingAction}
            ${closeDraftAction}
            <button type="button" data-action="save-knowledge" data-task-id="${escAttr(task.id)}">保存</button>
            <button type="button" data-action="save-knowledge-as" data-task-id="${escAttr(task.id)}">另存为</button>
          </div>
        </div>
        <div class="milkdown-editor-host" data-editor-kind="task" data-task-id="${escAttr(task.id)}" data-knowledge-scroll data-knowledge-view="${escAttr(knowledgeViewKey(task))}">
          <div class="milkdown-loading">正在加载 Milkdown 编辑器...</div>
        </div>
        <div class="milkdown-status">
          <span class="markdown-stats" data-markdown-stats>${stats.lines} 行 · ${stats.characters} 字</span>
          <span>支持 Markdown、表格、代码块与图片</span>
        </div>
      </section>
    </section>
  `;
}

function renderTaskHistory(task) {
  const events = flatten(task.nodes)
    .filter((node) => node.updatedAt)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return `
    <section class="task-history-pane">
      <div class="task-history-list">
        ${
          events.length
            ? events
                .map(
                  (node) => `<article class="task-history-item"><time>${formatShort(node.updatedAt)}</time><span>${esc(node.title || "未命名节点")}</span><b>${nodeStatusText(node.status)}</b></article>`,
                )
                .join("")
            : `<div class="task-history-empty">暂无历史记录</div>`
        }
      </div>
    </section>
  `;
}

function visibleFlowRowCount(nodes) {
  return nodes.reduce(
    (count, node) => count + 1 + (node.collapsed ? 0 : visibleFlowRowCount(node.children || [])),
    0,
  );
}

function renderFlowSplitResizer() {
  const total = normalizeFlowWidth("title", state.flowWidths.title) + normalizeFlowWidth("note", state.flowWidths.note);
  const bounds = flowSplitBounds(total);
  const titleWidth = Math.max(bounds.min, Math.min(bounds.max, normalizeFlowWidth("title", state.flowWidths.title)));
  const percentage = Math.round((titleWidth / total) * 100);
  return `<span class="flow-split-layer"><span class="flow-split-resizer" role="separator" tabindex="0" aria-label="调整处理标题与记录宽度" aria-orientation="vertical" aria-valuemin="${Math.round((bounds.min / total) * 100)}" aria-valuemax="${Math.round((bounds.max / total) * 100)}" aria-valuenow="${percentage}" aria-valuetext="标题 ${percentage}% · 记录 ${100 - percentage}%" data-flow-split-resizer title="拖拽调整处理标题与记录宽度"></span></span>`;
}

function renderTaskTagButton(task, tag, label) {
  const active = normalizeTaskTags(task.tags)[tag];
  return `<button class="task-tag-toggle ${active ? "active" : ""}" type="button" data-action="toggle-task-tag" data-task-id="${escAttr(task.id)}" data-tag="${tag}">${label}</button>`;
}

function renderTaskTagRow(task) {
  return `
    <div class="task-tag-row">
      ${Object.entries(taskTagLabels).map(([tag, label]) => renderTaskTagButton(task, tag, label)).join("")}
    </div>
  `;
}

function renderTaskActiveTagPills(task) {
  return Object.entries(normalizeTaskTags(task.tags))
    .filter(([, active]) => active)
    .map(([tag]) => `<span class="task-context-item task-context-badge task-tag ${tag}" data-slot="badge">${taskTagLabels[tag]}</span>`)
    .join("");
}

function renderTaskDeadlineBadge(task, at = loopNow()) {
  const deadline = safeDate(task.deadlineAt);
  if (!deadline) return "";
  const status = taskDeadlineStatus(task, at);
  const label = status === "overdue"
    ? `逾期 ${taskDateFilterLabel(localDateKey(deadline))}`
    : localDateKey(deadline) === localDateKey(at)
      ? `今天 ${String(deadline.getHours()).padStart(2, "0")}:${String(deadline.getMinutes()).padStart(2, "0")}`
      : taskDateFilterLabel(localDateKey(deadline));
  return `<time class="task-deadline-badge ${status}" datetime="${escAttr(deadline.toISOString())}" title="截止：${escAttr(formatMinuteStamp(deadline))}">${esc(label)}</time>`;
}

function deadlineTriggerLabel(date) {
  const todayKey = loopTodayKey();
  const dateKey = localDateKey(date);
  const dateText = dateKey === todayKey
    ? "今天"
    : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
  return `${dateText} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function initializeDeadlinePicker(task) {
  const deadline = safeDate(task?.deadlineAt);
  const initial = deadline || loopNow();
  deadlinePickerDate = localDateKey(initial);
  deadlinePickerMonth = `${deadlinePickerDate.slice(0, 7)}-01`;
}

function deadlinePickerMonthDate() {
  return parseDateInput(deadlinePickerMonth) || parseDateInput(deadlinePickerDate) || loopNow();
}

function deadlineTimeValue(value) {
  const date = safeDate(value);
  if (!date) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function deadlineTimeSlots(deadline) {
  const slots = [];
  for (let hour = 8; hour <= 22; hour += 1) {
    slots.push(`${String(hour).padStart(2, "0")}:00`);
    if (hour < 22) slots.push(`${String(hour).padStart(2, "0")}:30`);
  }
  const current = deadlineTimeValue(deadline);
  if (current && localDateKey(deadline) === deadlinePickerDate && !slots.includes(current)) slots.push(current);
  return slots.sort();
}

function renderDeadlinePickerDay(date, month) {
  const dateKey = localDateKey(date);
  const classes = [
    "task-deadline-day",
    date.getMonth() !== month.getMonth() ? "outside" : "",
    dateKey === loopTodayKey() ? "today" : "",
    dateKey === deadlinePickerDate ? "selected" : "",
  ].filter(Boolean).join(" ");
  return `<button class="${classes}" type="button" data-action="select-deadline-date" data-task-id="${escAttr(deadlinePopoverTaskId)}" data-date="${dateKey}" aria-label="选择 ${dateKey}" aria-pressed="${dateKey === deadlinePickerDate}">${date.getDate()}</button>`;
}

function renderTaskDeadlinePopover(task) {
  const month = deadlinePickerMonthDate();
  const selectedDate = parseDateInput(deadlinePickerDate) || loopNow();
  const deadline = safeDate(task.deadlineAt);
  const selectedTime = deadline && localDateKey(deadline) === deadlinePickerDate ? deadlineTimeValue(deadline) : "";
  const reminderValue = task.deadlineReminderMinutes === null
    ? "none"
    : String(normalizeDeadlineReminderMinutes(task.deadlineReminderMinutes));
  const timeSlots = deadlineTimeSlots(deadline);
  return `
    <section class="task-deadline-popover" id="task-deadline-popover-${escAttr(task.id)}" role="dialog" aria-label="选择任务截止时间">
      <div class="task-deadline-calendar-pane">
        <header class="task-deadline-month-head">
          <strong>${esc(calendarMonthTitle(month))}</strong>
          <div>
            <button type="button" data-action="shift-deadline-picker-month" data-direction="-1" aria-label="上个月">${briefFieldIcon("chevron-left", "task-deadline-nav-icon")}</button>
            <button type="button" data-action="shift-deadline-picker-month" data-direction="1" aria-label="下个月">${briefFieldIcon("chevron-right", "task-deadline-nav-icon")}</button>
          </div>
        </header>
        <div class="task-deadline-weekdays" aria-hidden="true">${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<span>${day}</span>`).join("")}</div>
        <div class="task-deadline-grid">${calendarGridDates(month).map((date) => renderDeadlinePickerDay(date, month)).join("")}</div>
        <footer class="task-deadline-calendar-foot">
          <button type="button" data-action="deadline-picker-today">今天</button>
          ${deadline ? `<button type="button" data-action="clear-task-deadline" data-task-id="${escAttr(task.id)}">清除</button>` : ""}
        </footer>
      </div>
      <div class="task-deadline-time-pane">
        <header>
          <span>选择时间</span>
          <strong>${esc(new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(selectedDate))}</strong>
        </header>
        <div class="task-deadline-time-list" role="listbox" aria-label="截止时间段">
          ${timeSlots.map((time) => `<button class="task-deadline-time ${selectedTime === time ? "selected" : ""}" type="button" role="option" aria-selected="${selectedTime === time}" data-action="apply-deadline-time" data-task-id="${escAttr(task.id)}" data-time="${time}">${time}</button>`).join("")}
        </div>
      </div>
      <label class="task-deadline-reminder-control">
        <span class="task-deadline-reminder-copy">
          <svg class="task-deadline-reminder-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>
          <span><strong>系统提醒</strong><small>到达所选时间后发送一次通知</small></span>
        </span>
        <select data-deadline-reminder data-task-id="${escAttr(task.id)}" aria-label="选择截止前提醒时间">
          ${Object.entries(deadlineReminderLabels).map(([value, label]) => `<option value="${value}" ${value === reminderValue ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
    </section>
  `;
}

function applyTaskDeadlineTime(taskId, time) {
  const task = state.tasks.find((item) => item.id === taskId);
  const date = parseDateInput(deadlinePickerDate);
  const match = /^(\d{2}):(\d{2})$/.exec(time || "");
  if (!task || !date || !match) return;
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  task.deadlineAt = date.toISOString();
  task.updatedAt = now();
  save();
}

function restoreDeadlinePickerTimeScroll() {
  const list = document.querySelector(".task-deadline-time-list");
  const selected = list?.querySelector(".task-deadline-time.selected");
  if (!list || !selected) return;
  list.scrollTop = selected.offsetTop - (list.clientHeight - selected.clientHeight) / 2;
}

function renderTaskDeadlineControl(task) {
  const deadline = safeDate(task.deadlineAt);
  const status = taskDeadlineStatus(task);
  const open = deadlinePopoverTaskId === task.id;
  const suggestion = task.priority === "high" && !deadline
    ? `<span class="task-deadline-suggestion">高优任务建议设置截止时间</span>`
    : "";
  return `
    <div class="task-deadline-picker ${status} ${deadline ? "has-value" : "is-empty"}">
      <button class="task-deadline-trigger" type="button" data-action="toggle-deadline-picker" data-task-id="${escAttr(task.id)}" aria-expanded="${open}" aria-controls="task-deadline-popover-${escAttr(task.id)}" title="截止时间可选，不会使用任务创建时间自动推断">
        <svg class="task-deadline-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path></svg>
        <span>${esc(deadline ? deadlineTriggerLabel(deadline) : "设置截止时间")}</span>
        <svg class="task-deadline-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"></path></svg>
      </button>
      ${open ? renderTaskDeadlinePopover(task) : ""}
    </div>
    ${suggestion}
  `;
}

function renderTaskRecurrenceControls(task) {
  const recurrence = normalizeTaskRecurrence(task.recurrence);
  const open = recurrencePopoverTaskId === task.id;
  return `
    <div class="task-recurrence-controls ${recurrence.frequency === "none" ? "is-empty" : "is-active"}" aria-label="循环任务设置">
      <button
        class="task-recurrence-trigger"
        type="button"
        data-recurrence-toggle
        data-task-id="${escAttr(task.id)}"
        aria-expanded="${open}"
        aria-controls="task-recurrence-popover-${escAttr(task.id)}"
      >
        <svg class="task-recurrence-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"></path><path d="M4 17v-5h5"></path><path d="M6.1 9a7 7 0 0 1 11.5-2L20 9"></path><path d="m4 15 2.4 2A7 7 0 0 0 18 15"></path></svg>
        <span>${esc(recurrenceSummaryLabel(recurrence))}</span>
        <svg class="task-recurrence-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"></path></svg>
      </button>
      ${
        open
          ? `<section class="task-recurrence-popover" id="task-recurrence-popover-${escAttr(task.id)}" role="dialog" aria-label="循环设置">
              <header class="task-recurrence-popover-head">
                <strong>循环设置</strong>
              </header>
              <div class="task-recurrence-mode-time">
                <div class="task-recurrence-mode-switch" role="group" aria-label="循环周期">
                  ${Object.entries(recurrenceFrequencyLabels)
                    .map(([value, label]) => `<button
                      class="task-recurrence-mode ${recurrence.frequency === value ? "active" : ""}"
                      type="button"
                      data-recurrence-mode="${value}"
                      data-task-id="${escAttr(task.id)}"
                      aria-pressed="${recurrence.frequency === value}"
                    >${label}</button>`)
                    .join("")}
                </div>
                ${
                  recurrence.frequency !== "none"
                    ? `<label class="task-recurrence-time">
                        <input type="time" data-recurrence-field="time" data-task-id="${escAttr(task.id)}" value="${escAttr(recurrence.time)}" aria-label="循环时间" />
                      </label>`
                    : ""
                }
              </div>
              ${
                recurrence.frequency === "weekly"
                  ? `<div class="task-recurrence-weekday-list" role="group" aria-label="选择每周日期，可多选">
                      ${recurrenceWeekdayOrder
                        .map(
                          (value) => `<button
                            class="task-recurrence-weekday ${recurrence.weekdays.includes(value) ? "active" : ""}"
                            type="button"
                            data-recurrence-weekday="${value}"
                            data-task-id="${escAttr(task.id)}"
                            aria-pressed="${recurrence.weekdays.includes(value)}"
                            aria-label="${recurrenceWeekdayLabels[value]}"
                          >${recurrenceWeekdayLabels[value].replace("周", "")}</button>`,
                        )
                        .join("")}
                    </div>`
                  : ""
              }
            </section>`
          : ""
      }
    </div>
  `;
}

function briefFieldIcon(name, className = "brief-field-icon") {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><use href="src/assets/feather/feather-sprite.svg#${name}"></use></svg>`;
}

function renderBriefField(label, control, attention = false, variant = "") {
  return `
    <label class="brief-field brief-cell ${variant} ${attention ? "needs-attention" : ""}">
      <span class="brief-label">
        <span class="brief-label-title"><b>${label}</b></span>
      </span>
      ${control}
    </label>
  `;
}

function renderFlowNode(taskId, node, depth, rootIndex = 0, lineage = [], isLast = true) {
  const children = sort(node.children);
  const isSelected = state.selectedNodeId === node.id;
  const railContinuations = [...lineage, !isLast];
  const treeGuides = depth
    ? `<span class="flow-tree-guides" aria-hidden="true">${Array.from(
        { length: depth },
        (_, index) => `<span class="flow-tree-rail ${railContinuations[index] ? "continues" : ""}" style="--rail-index:${index}"></span>`,
      ).join("")}<span class="flow-tree-elbow"></span></span>`
    : "";
  const statusLabel = nodeStatusText(node.status);
  const statusBadgeLabel = nodeStatusBadgeText(node.status);
  const collapseControl = children.length
    ? `<button class="flow-collapse-toggle" type="button" data-action="toggle-node-collapse" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(node.id)}" aria-label="${node.collapsed ? "展开" : "折叠"}节点" aria-expanded="${!node.collapsed}">${briefFieldIcon(node.collapsed ? "chevron-right" : "chevron-down", "flow-row-icon")}</button>`
    : `<span class="flow-collapse-spacer" aria-hidden="true"></span>`;
  return `
    <article class="flow-outline-node ${node.status} ${isSelected ? "selected" : ""}" style="--tree-depth:${depth}" data-context="node" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(node.id)}" data-flow-depth="${depth}">
      <div class="flow-outline-row" data-flow-drag-source data-flow-drag-target data-flow-select data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(node.id)}" title="长按节点行后拖动；落在上下区域调整同级顺序，落在中间区域设为子级">
        <span class="flow-tree-zone">${treeGuides}</span>
        <button class="flow-node-marker flow-status-bullet status-${node.status}" type="button" data-action="cycle-node-status" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(node.id)}" aria-label="${escAttr(statusLabel)}：点击切换状态">${briefFieldIcon("disc", "flow-node-marker-icon")}</button>
        <button class="flow-status-badge status-${node.status}" type="button" data-action="cycle-node-status" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(node.id)}" aria-label="${escAttr(`${statusBadgeLabel}，点击切换状态`)}">${statusBadgeLabel}</button>
        ${nodeTitleInputHtml(node, taskId)}
        ${collapseControl}
        <button class="flow-node-more" type="button" data-action="open-node-detail" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(node.id)}" aria-label="打开节点详情">${briefFieldIcon("more-horizontal", "flow-row-icon")}</button>
      </div>
      ${
        children.length && !node.collapsed
          ? children
              .map((child, index) => renderFlowNode(taskId, child, depth + 1, rootIndex, [...lineage, !isLast], index === children.length - 1))
              .join("")
          : ""
      }
    </article>
  `;
}

function renderFlowHeader() {
  return `
    <div class="flow-row flow-line flow-header header">
      <span></span>
      ${renderFlowHeadCell("title", "处理")}
      ${renderFlowHeadCell("note", "记录")}
      ${renderFlowHeadCell("", "")}
      ${renderFlowHeadCell("", "")}
    </div>
  `;
}

function nodeNoteSummary(value) {
  const lines = String(value || "")
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/^[#>*\-\s\d.]+/, "").trim())
    .filter(Boolean);
  return {
    title: lines[0] || "记录待补充",
    detail: lines.slice(1).join(" ") || "点击打开记录浮窗",
  };
}

function renderFlowHeadCell(_key, label) {
  return `
    <span class="flow-head-cell">
      <span>${label}</span>
    </span>
  `;
}

function getNodePath(nodes, nodeId, path = []) {
  for (const node of nodes || []) {
    const nextPath = [...path, node];
    if (node.id === nodeId) return nextPath;
    const found = getNodePath(node.children, nodeId, nextPath);
    if (found) return found;
  }
  return [];
}

function renderNodeDetailPage(taskId, node) {
  if (!node) return "";
  const task = state.tasks.find((item) => item.id === taskId);
  const path = task ? getNodePath(task.nodes, node.id) : [];
  const orderedNodes = task ? orderedFlowNodes(task.nodes) : [];
  const nodeIndex = Math.max(0, orderedNodes.findIndex((item) => item.id === node.id));
  const previousNode = nodeIndex > 0 ? orderedNodes[nodeIndex - 1] : null;
  const nextNode = nodeIndex < orderedNodes.length - 1 ? orderedNodes[nodeIndex + 1] : null;
  const statusOptions = [
    ["todo", "待处理"],
    ["later", "进行中"],
    ["done", "已完成"],
    ["blocked", "已阻塞"],
  ];
  return `
    <aside class="node-detail-page" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(node.id)}" aria-label="节点详情页面">
      <header class="node-detail-header">
        <div class="node-detail-heading">
          ${inputHtml("title", node.title, taskId, "node-detail-title", node.id)}
        </div>
        <div class="node-detail-header-actions">
          <details class="node-detail-info">
            <summary class="node-detail-icon-button" aria-label="查看节点路径">${briefFieldIcon("info", "node-detail-action-icon")}</summary>
            <div class="node-detail-info-popover">
              <span>路径</span>
              <strong>${esc(path.map((item) => item.title || "未命名").join(" / ") || "—")}</strong>
            </div>
          </details>
          <details class="node-detail-status-menu">
            <summary class="node-detail-status-trigger status-${node.status}" aria-label="修改节点状态">${nodeDetailStatusText(node.status)}${briefFieldIcon("chevron-down", "node-detail-status-chevron")}</summary>
            <div class="node-detail-status-options" role="menu" aria-label="节点状态">
              ${statusOptions
                .map(
                  ([status, label]) => `<button class="node-detail-status-option ${node.status === status ? "selected" : ""}" type="button" role="menuitemradio" aria-checked="${node.status === status}" data-action="mark-node-status" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(node.id)}" data-status="${status}"><span>${label}</span>${node.status === status ? briefFieldIcon("check", "node-detail-status-check") : ""}</button>`,
                )
                .join("")}
            </div>
          </details>
          <button class="node-detail-icon-button" type="button" data-action="close-node-detail" aria-label="关闭节点详情">${briefFieldIcon("x", "node-detail-action-icon")}</button>
        </div>
      </header>
      <div class="node-detail-scroll" data-node-detail-scroll data-node-detail-view="${escAttr(nodeDetailViewKey(taskId, node.id))}">
        <section class="node-detail-record">
          <div class="node-detail-record-head">
            <label for="node-detail-record-${escAttr(node.id)}">详情</label>
            <span class="node-detail-save-state" data-node-detail-save-state><span aria-hidden="true"></span><b>已自动保存</b></span>
          </div>
          <textarea id="node-detail-record-${escAttr(node.id)}" class="record-modal-textarea node-inspector-note" data-record-input data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(node.id)}" placeholder="记录必要的处理过程、关键数据或下一步……">${esc(state.recordDraft)}</textarea>
        </section>
        <nav class="node-detail-pagination" aria-label="切换处理流节点">
          <button type="button" data-action="navigate-node-detail" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(previousNode?.id || "")}" ${previousNode ? "" : "disabled"}>${briefFieldIcon("arrow-left", "node-detail-nav-icon")}<span>上一节点</span></button>
          <span>${orderedNodes.length ? nodeIndex + 1 : 0} / ${orderedNodes.length}</span>
          <button type="button" data-action="navigate-node-detail" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(nextNode?.id || "")}" ${nextNode ? "" : "disabled"}><span>下一节点</span>${briefFieldIcon("arrow-right", "node-detail-nav-icon")}</button>
        </nav>
      </div>
    </aside>
  `;
}

function orderedFlowNodes(nodes) {
  return sort(nodes || []).flatMap((node) => [node, ...orderedFlowNodes(node.children)]);
}

function nodeDetailStatusText(status) {
  if (status === "done") return "已完成";
  if (status === "blocked") return "已阻塞";
  if (status === "later") return "进行中";
  return "待处理";
}

function nodeDetailPositionStyle() {
  if (state.nodeDetailFullscreen || !state.nodeDetailPosition) return "";
  const viewportPadding = 22;
  const popoverWidth = Math.min(620, Math.max(420, window.innerWidth * 0.42), window.innerWidth - viewportPadding * 2);
  const popoverHeight = Math.min(286, Math.max(236, window.innerHeight * 0.37), window.innerHeight - viewportPadding * 2);
  const x = Math.max(viewportPadding, Math.min(window.innerWidth - popoverWidth - viewportPadding, Number(state.nodeDetailPosition.x) || 0));
  const y = Math.max(viewportPadding, Math.min(window.innerHeight - popoverHeight - viewportPadding, Number(state.nodeDetailPosition.y) || 0));
  return `style="--detail-x:${x}px;--detail-y:${y}px"`;
}

function markdownStats(value) {
  const text = String(value || "");
  return {
    characters: text.trim().length,
    lines: text ? text.split(/\r\n|\r|\n/).length : 1,
  };
}

function renderEditorImagePreview(value) {
  const images = markdownImages(value);
  return `
    <div class="editor-image-strip ${images.length ? "" : "empty"}" aria-label="编辑器图片预览">
      ${images
        .map((image) => `<figure><img src="${image.src}" alt="${escAttr(image.alt || "图片")}" /><figcaption>${esc(image.alt || "图片")}</figcaption></figure>`)
        .join("")}
    </div>
  `;
}

function markdownImages(value) {
  return Array.from(String(value || "").matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g))
    .map((match) => ({ alt: match[1], src: resolveMarkdownImageUrl(match[2]) }))
    .filter((image) => image.src);
}

function renderEmptyPage() {
  const hasTasks = state.tasks.length > 0;
  return `
    <section class="task-page empty-page">
      <div class="empty-page-tools"><div class="topbar-rhythm-slot" aria-live="polite"></div></div>
      <h2>${hasTasks ? "没有符合筛选的任务" : "没有任务"}</h2>
      ${hasTasks ? "" : "<p>双击左侧任务列表的空白区域，即可创建新的处理流。</p>"}
    </section>
  `;
}

let taskContextMenuReturnFocus = null;

window.addEventListener("pointerdown", (event) => {
  if (state.contextMenu && event.button !== 2 && !event.target?.closest?.(".context-menu")) closeContextMenu();
}, true);
window.addEventListener("scroll", (event) => {
  if (state.contextMenu && !event.target?.closest?.(".context-menu")) closeContextMenu();
}, true);
window.addEventListener("resize", () => { if (state.contextMenu) closeContextMenu(); });
window.addEventListener("blur", () => { if (state.contextMenu) closeContextMenu(); });

function openTaskContextMenu(taskId, event, row) {
  if (!state.tasks.some((task) => task.id === taskId)) return;
  event.preventDefault();
  event.stopPropagation();
  const keyboard = event.type === "keydown";
  const rect = keyboard ? row.getBoundingClientRect() : null;
  taskContextMenuReturnFocus = row.querySelector(".task-select") || row;
  state.contextMenu = {
    kind: "task", taskId, nodeId: "",
    x: keyboard ? rect.left + 32 : event.clientX,
    y: keyboard ? rect.bottom : event.clientY,
  };
  // Mount only the floating menu: preserve the current task, inspector, editor
  // draft, and list scroll position when inspecting another row's actions.
  syncContextMenuRoot();
  if (keyboard) document.querySelector("#context-menu-root .context-menu button")?.focus({ preventScroll: true });
}

function closeContextMenu(restoreFocus = false) {
  const trigger = taskContextMenuReturnFocus;
  state.contextMenu = null;
  taskContextMenuReturnFocus = null;
  syncContextMenuRoot();
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}

function openNodeContextMenu(taskId, nodeId, event, row) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || !findNode(task.nodes, nodeId)) return;
  event.preventDefault();
  event.stopPropagation();
  const keyboard = event.type === "keydown";
  const rect = keyboard ? row.getBoundingClientRect() : null;
  taskContextMenuReturnFocus = row.querySelector(".node-title") || row;
  if (typeof shellCloseOverlay === "function") shellCloseOverlay({ restoreFocus: false });
  state.contextMenu = {
    kind: "node", taskId, nodeId,
    x: keyboard ? rect.left + 32 : event.clientX,
    y: keyboard ? rect.bottom : event.clientY,
  };
  // Right-click only mounts a menu; keep selection, record drafts and scroll.
  syncContextMenuRoot();
  if (keyboard) document.querySelector("#context-menu-root .context-menu button")?.focus({ preventScroll: true });
}

function renderContextMenu() {
  // Group management (打开/重命名/批量添加/删除分组) was removed from the product;
  // a leftover kind must not fall through to the node menu.
  if (state.contextMenu?.kind === "group") return "";
  if (!state.contextMenu) return "";
  const menu = state.contextMenu;
  if (menu.kind === "editor") {
    return `
      <div class="context-menu" style="left:${menu.x}px; top:${menu.y}px">
        <button data-action="insert-editor-snippet" data-kind="h2">插入标题</button>
        <button data-action="insert-editor-snippet" data-kind="bullet">插入无序列表</button>
        <button data-action="insert-editor-snippet" data-kind="ordered">插入有序列表</button>
        <button data-action="insert-editor-snippet" data-kind="quote">插入引用</button>
        <button data-action="insert-editor-snippet" data-kind="code">插入代码块</button>
        <button data-action="insert-editor-snippet" data-kind="table">插入表格</button>
        <button data-action="insert-editor-snippet" data-kind="image">插入图片</button>
      </div>
    `;
  }
  if (menu.kind === "task-list") {
    return `
      <div class="context-menu" role="menu" aria-label="任务列表操作" style="left:${menu.x}px; top:${menu.y}px">
        <button type="button" role="menuitem" data-action="add-task">${shellIcon("plus")}<span>新增任务</span></button>
      </div>
    `;
  }

  if (menu.kind === "task") {
    const task = state.tasks.find((item) => item.id === menu.taskId);
    if (!task) return "";
    const tags = normalizeTaskTags(task.tags);
    return `
      <div class="context-menu task-context-menu" role="menu" aria-label="${escAttr(task.title || "未命名任务")}的操作" style="left:${menu.x}px; top:${menu.y}px">
        <div class="context-menu-title">${esc(task.title || "未命名任务")}</div>
        <button type="button" role="menuitem" data-action="toggle-task-done" data-task-id="${escAttr(menu.taskId)}">${shellIcon(task.status === "done" ? "history" : "done")}<span>${task.status === "done" ? "标记为未完成" : "完成任务"}</span></button>
        <hr role="separator" />
        <button type="button" role="menuitemcheckbox" aria-checked="${tags.today}" data-action="toggle-task-tag" data-task-id="${escAttr(menu.taskId)}" data-tag="today">${shellIcon("home")}<span>${tags.today ? "取消手动加入今日" : "加入今日"}</span>${tags.today ? shellIcon("check", "context-menu-check") : ""}</button>
        <button type="button" role="menuitemcheckbox" aria-checked="${tags.later}" data-action="toggle-task-tag" data-task-id="${escAttr(menu.taskId)}" data-tag="later">${shellIcon("later")}<span>${tags.later ? "取消稍后" : "标记稍后"}</span>${tags.later ? shellIcon("check", "context-menu-check") : ""}</button>
        <button type="button" role="menuitemcheckbox" aria-checked="${tags.blocked}" data-action="toggle-task-tag" data-task-id="${escAttr(menu.taskId)}" data-tag="blocked">${shellIcon("blocked")}<span>${tags.blocked ? "取消卡住" : "标记卡住"}</span>${tags.blocked ? shellIcon("check", "context-menu-check") : ""}</button>
        <hr role="separator" />
        <button type="button" role="menuitem" class="danger" data-action="delete-task" data-task-id="${escAttr(menu.taskId)}">${shellIcon("close")}<span>删除任务…</span></button>
      </div>
    `;
  }

  if (menu.kind === "flow-root") {
    return `
      <div class="context-menu" role="menu" aria-label="处理流操作" style="left:${menu.x}px; top:${menu.y}px">
        <button type="button" role="menuitem" data-action="add-root-node" data-task-id="${escAttr(menu.taskId)}">${shellIcon("plus")}<span>新增节点</span></button>
      </div>
    `;
  }

  const task = state.tasks.find((item) => item.id === menu.taskId);
  const node = task && findNode(task.nodes, menu.nodeId);
  if (!node) return "";
  return `
    <div class="context-menu node-context-menu" role="menu" aria-label="${escAttr(node.title || "未命名节点")}的操作" style="left:${menu.x}px; top:${menu.y}px">
      <div class="context-menu-title">${esc(node.title || "未命名节点")}</div>
      <button type="button" role="menuitem" data-action="add-sibling-node" data-task-id="${escAttr(menu.taskId)}" data-node-id="${escAttr(menu.nodeId)}">${shellIcon("plus")}<span>添加兄弟节点</span></button>
      <button type="button" role="menuitem" data-action="add-child-node" data-task-id="${escAttr(menu.taskId)}" data-node-id="${escAttr(menu.nodeId)}">${shellIcon("indent")}<span>添加子节点</span></button>
      <hr role="separator" />
      <button type="button" role="menuitem" class="danger" data-action="delete-node" data-task-id="${escAttr(menu.taskId)}" data-node-id="${escAttr(menu.nodeId)}">${shellIcon("close")}<span>删除节点…</span></button>
    </div>
  `;
}

function syncContextMenuRoot() {
  const root = document.querySelector("#context-menu-root");
  if (!root) return;
  root.innerHTML = renderContextMenu();
  document.querySelectorAll(".task-item[data-task-id]").forEach((row) => {
    row.classList.toggle("context-menu-target", state.contextMenu?.kind === "task" && row.dataset.taskId === state.contextMenu.taskId);
  });
  const menu = root.querySelector?.(".context-menu");
  if (menu && state.contextMenu) {
    const rect = menu.getBoundingClientRect();
    const margin = 12;
    const bottom = window.innerHeight - 50;
    let x = state.contextMenu.x + 4;
    let y = state.contextMenu.y + 4;
    if (x + rect.width > window.innerWidth - margin) x = state.contextMenu.x - rect.width - 4;
    if (y + rect.height > bottom) y = state.contextMenu.y - rect.height - 4;
    menu.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))}px`;
    menu.style.top = `${Math.max(margin, Math.min(y, bottom - rect.height))}px`;
    root.onkeydown = (event) => {
      const buttons = [...menu.querySelectorAll("button")];
      if (!buttons.length) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeContextMenu(true);
        return;
      }
      if (event.key === "Tab") { closeContextMenu(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const current = buttons.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus({ preventScroll: true });
    };
  } else root.onkeydown = null;
  root.querySelectorAll("[data-action]").forEach((element) => {
    let activatedByPointer = false;
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      activatedByPointer = true;
      event.preventDefault();
      event.stopPropagation();
      void action({ ...element.dataset }, event);
    });
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      if (activatedByPointer) return;
      void action({ ...element.dataset }, event);
    });
  });
}


// ============================================================
// DATA QUERY HELPERS (filter, search, sort)
// ============================================================
/**
 * Get tasks matching current filters (search query + task filter + priority filter).
 * @returns {Array} Filtered task list
 */
/**
 * Cache for the current render's filtered task list.
 *
 * render() asks for it two to four times (list region, sidebar count, list
 * header), and each call walks every task and flattens its node tree. The key
 * covers the state the result depends on plus the current minute, so a caller
 * that passes an explicit `at` (as the review and deadline tests do) never gets
 * a list computed for a different time.
 */
let filteredTasksCache = null;

function clearFilteredTasksCache() {
  filteredTasksCache = null;
}

function filteredTasksCacheKey(at) {
  return `${state.query}\u0001${state.taskFilter}\u0001${state.todayFilter}\u0001`
    + `${state.taskDeadlineFilter}\u0001${state.taskDateFilter}\u0001${state.priorityFilter}\u0001`
    + `${state.captureSourceFilter}\u0001${state.activeGroupId}\u0001${state.tasks.length}\u0001`
    + `${Math.floor(at.getTime() / 60000)}`;
}

function filteredTasks({ includeQuery = true, at = loopNow() } = {}) {
  if (!includeQuery) return computeFilteredTasks({ includeQuery, at });
  const key = filteredTasksCacheKey(at);
  if (filteredTasksCache && filteredTasksCache.key === key) return filteredTasksCache.value;
  const value = computeFilteredTasks({ includeQuery, at });
  filteredTasksCache = { key, value };
  return value;
}

function computeFilteredTasks({ includeQuery = true, at = loopNow() } = {}) {
  const q = state.query.trim().toLowerCase();
  const deadlineScoped = state.taskDeadlineFilter !== "all" || Boolean(state.taskDateFilter);
  const repositoryTypes = repositoryTypeSelection();
  // Only the blocked/later filters need the node tree walked, and only the
  // blocked filter needs the tag set. Computing both for every task made the
  // common "all"/"active" filters pay for a scan they never used.
  const filterNeedsBlocked = state.taskFilter === "blocked";
  const filterNeedsLater = state.taskFilter === "later";
  const filterNeedsTags = filterNeedsBlocked || filterNeedsLater;
  return taskListScopeTasks()
    .filter((task) => {
      const tags = filterNeedsTags ? normalizeTaskTags(task.tags) : null;
      const hasBlocked = filterNeedsBlocked
        && flatten(task.nodes).some((node) => node.status === "blocked");
      const hasLater = filterNeedsLater
        && flatten(task.nodes).some((node) => node.status === "later");
      if (state.taskFilter === "today") {
        // The Today route switches between the active list and today's
        // completions; anything else keeps the phase17 scope.
        if (state.todayFilter === "done") return shellCompletedToday().includes(task);
        // The frozen Demo's Today scope is scheduled && !done: a finished task
        // leaves the active list and moves to today's completions.
        if (task.status === "done" || !isTaskScheduledForToday(task)) return false;
      }
      if (state.taskFilter === "active" && task.status === "done") return false;
      if (state.taskFilter === "done" && task.status !== "done") return false;
      if (state.taskFilter === "blocked" && !tags.blocked && !hasBlocked) return false;
      if (state.taskFilter === "later" && !tags.later && !hasLater) return false;
      if (!matchesTaskDeadlineFilter(task, at)) return false;
      if (state.priorityFilter !== "all" && task.priority !== state.priorityFilter) return false;
      const isNote = task.captureSource === "today-widget";
      if (isNote && !repositoryTypes.includeNote) return false;
      if (!isNote && !repositoryTypes.includeTask) return false;
      if (includeQuery && q) {
        const taskText = `${task.title} ${task.description} ${task.hypothesis} ${task.conclusion}`.toLowerCase();
        const nodeHit = flatten(task.nodes).some((node) => `${node.title} ${node.note}`.toLowerCase().includes(q));
        return taskText.includes(q) || nodeHit;
      }
      return true;
    })
    .sort(deadlineScoped ? compareTasksByDeadline : (a, b) => a.order - b.order);
}

function taskListScopeTasks() {
  return state.taskFilter === "today" || state.taskDeadlineFilter !== "all" || state.taskDateFilter
    ? state.tasks
    : tasksInActiveGroup();
}

function taskListStatsTasks() {
  if (state.taskDeadlineFilter !== "all" || state.taskDateFilter) {
    return state.tasks.filter((task) => matchesTaskDeadlineFilter(task));
  }
  if (state.taskFilter !== "today") return tasksInActiveGroup();
  if (state.todayFilter === "done") return shellCompletedToday();
  return state.tasks.filter((task) => isTaskScheduledForToday(task));
}

function taskDeadlineStatus(task, at = loopNow()) {
  const deadline = safeDate(task?.deadlineAt);
  if (!deadline) return "none";
  if (task.status === "done") return "done";
  if (deadline.getTime() < at.getTime()) return "overdue";
  if (localDateKey(deadline) === localDateKey(at)) return "today";
  return "upcoming";
}

function deadlineWeekRange(at = loopNow()) {
  const date = at instanceof Date ? at : new Date(at);
  const day = date.getDay() || 7;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day + 1);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start, end };
}

function matchesTaskDeadlineFilter(task, at = loopNow()) {
  const deadline = safeDate(task?.deadlineAt);
  if (state.taskDateFilter) return Boolean(deadline && localDateKey(deadline) === state.taskDateFilter);
  if (state.taskDeadlineFilter === "all") return true;
  if (!deadline) return false;
  if (state.taskDeadlineFilter === "today") return localDateKey(deadline) === localDateKey(at);
  if (state.taskDeadlineFilter === "overdue") return task.status !== "done" && deadline.getTime() < at.getTime();
  if (state.taskDeadlineFilter === "week") {
    const range = deadlineWeekRange(at);
    return deadline >= range.start && deadline < range.end;
  }
  return true;
}

function compareTasksByDeadline(a, b) {
  const aTime = safeDate(a.deadlineAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = safeDate(b.deadlineAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  return aTime - bTime || a.order - b.order;
}

function tasksInActiveGroup() {
  const groupId = normalizeActiveGroupId(state.activeGroupId, state.taskGroups);
  if (groupId === ALL_TASKS_GROUP_ID) return state.tasks;
  if (groupId === UNGROUPED_TASKS_GROUP_ID) return state.tasks.filter((task) => !task.groupId);
  return state.tasks.filter((task) => task.groupId === groupId);
}

function taskGroupOptions() {
  return Object.fromEntries(sort(state.taskGroups).map((group) => [group.id, group.title]));
}

function renderTaskGroupSelect(task) {
  const options = taskGroupOptions();
  const selectedId = normalizeActiveGroupId(task.groupId, state.taskGroups);
  const selectedLabel = options[selectedId] || "选择分组";
  const open = taskGroupSelectTaskId === task.id;
  const popoverId = `task-group-select-${task.id}`;
  return `
    <div class="task-context-group task-group-select ${open ? "is-open" : ""}" data-task-group-select>
      <button class="task-group-select-trigger" type="button" data-action="toggle-task-group-select" data-task-id="${escAttr(task.id)}" aria-expanded="${open}" aria-haspopup="listbox" aria-controls="${escAttr(popoverId)}">
        <span class="task-group-select-label">分组</span>
        <span class="task-group-select-value">${esc(selectedLabel)}</span>
        <svg class="task-group-select-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"></path></svg>
      </button>
      ${open ? `
        <div class="task-group-select-content" id="${escAttr(popoverId)}" role="listbox" aria-label="选择分组">
          ${Object.entries(options).map(([groupId, label]) => `
            <button class="task-group-select-option ${groupId === selectedId ? "selected" : ""}" type="button" role="option" aria-selected="${groupId === selectedId}" data-action="select-task-group" data-task-id="${escAttr(task.id)}" data-group-id="${escAttr(groupId)}">
              <span>${esc(label)}</span>
              ${groupId === selectedId ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>` : ""}
            </button>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function todayFocusItems() {
  const items = state.tasks
    .filter((task) => task.status !== "done")
    .filter((task) => task.captureSource !== "today-widget")
    .filter((task) => isTaskScheduledForToday(task))
    .map((task) => {
      const tags = normalizeTaskTags(task.tags);
      const nodes = flatten(task.nodes);
      const blockedNode = nodes.find((node) => node.status === "blocked");
      const openNode = nextOpenNode(task.nodes);
      const score =
        (task.priority === "high" ? 80 : task.priority === "medium" ? 35 : 15) +
        70 +
        (blockedNode || tags.blocked ? 55 : 0) +
        (openNode ? 8 : 0);
      const node = blockedNode || openNode || null;
      const kind = blockedNode || tags.blocked ? "blocked" : task.priority === "high" ? "high" : "normal";
      const badge = blockedNode || tags.blocked ? "卡住" : task.priority === "high" ? "高" : "Today";
      // The Demo renders the next-step line only when there is one, so an empty
      // string is meaningful here (it decides the row height). The "补充任务背景"
      // prompt belongs to the in-page placeholders, not to the widget row.
      const nextText = node?.title || (task.description.trim() ? task.description.trim() : "");
      return { task, node, kind, badge, nextText, score, updatedAt: latestTaskTime(task) };
    })
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt || a.task.order - b.task.order);
  return applyTodayWidgetOrder(items, "todayTaskOrder", (item) => item.task);
}

function applyTodayWidgetOrder(items, orderKey, taskFromItem = (item) => item) {
  if (!items.some((item) => normalizeTodayWidgetOrder(taskFromItem(item)?.[orderKey]) > 0)) return items;
  return [...items].sort((a, b) => {
    const aOrder = normalizeTodayWidgetOrder(taskFromItem(a)?.[orderKey]);
    const bOrder = normalizeTodayWidgetOrder(taskFromItem(b)?.[orderKey]);
    if (aOrder && bOrder) return aOrder - bOrder;
    if (aOrder) return -1;
    if (bOrder) return 1;
    return 0;
  });
}

function normalizeCurrentWorkNavigation() {
  state.workNavigation = workNavigationModel.normalizeWorkNavigation(state.workNavigation, {
    groupIds: state.taskGroups.map((group) => group.id),
  });
  return state.workNavigation;
}

function workNavigationCandidates() {
  const navigation = normalizeCurrentWorkNavigation();
  const todayItems = todayFocusItems();
  const work = workNavigationModel.resolveWorkCandidates({
    tasks: state.tasks,
    todayTaskIds: todayItems.map((item) => item.task.id),
    sourceGroupId: navigation.config.growth.sourceGroupId,
    blockedTaskIds: navigation.runtime.blockedTaskIds,
  });
  const growth = workNavigationModel.resolveGrowthCandidates(
    state.tasks,
    navigation.config.growth.sourceGroupId,
    navigation.runtime.blockedTaskIds,
  );
  return { todayItems, work, growth };
}

function reconcileWorkNavigationRuntime() {
  const navigation = normalizeCurrentWorkNavigation();
  const { work, growth } = workNavigationCandidates();
  const runtime = navigation.runtime;
  runtime.workQueueIds = workNavigationModel.reconcileQueueIds(work, runtime.workQueueIds);
  runtime.growthQueueIds = workNavigationModel.reconcileQueueIds(growth, runtime.growthQueueIds);
  const referencedWork = work.find((task) => task.id === runtime.activeWorkTaskId);
  if (referencedWork) runtime.workQueueIds = [referencedWork.id, ...runtime.workQueueIds.filter((taskId) => taskId !== referencedWork.id)];
  else runtime.activeWorkTaskId = runtime.workAdvancePaused ? "" : runtime.workQueueIds[0] || "";
  const referencedGrowth = growth.find((task) => task.id === runtime.activeGrowthTaskId);
  if (referencedGrowth) runtime.growthQueueIds = [referencedGrowth.id, ...runtime.growthQueueIds.filter((taskId) => taskId !== referencedGrowth.id)];
  else runtime.activeGrowthTaskId = runtime.growthAdvancePaused ? "" : runtime.growthQueueIds[0] || "";
  return navigation;
}

function workNavigationTaskSnapshot(task) {
  return {
    id: task.id,
    order: task.order,
    groupId: task.groupId || "",
    title: task.title || "",
    description: task.description || "",
    conclusion: task.conclusion || "",
    status: task.status,
    priority: task.priority,
    tags: normalizeTaskTags(task.tags),
    captureSource: task.captureSource || "",
    nodes: task.nodes,
    navigationRecovery: workNavigationModel.normalizeRecovery(task.navigationRecovery),
    estimateMinutes: task.estimateMinutes || 0,
    origin: workNavigationModel.normalizeOrigin(task.origin),
    updatedAt: task.updatedAt,
    deadlineAt: task.deadlineAt || "",
    resolvedAt: task.resolvedAt || "",
  };
}

function workNavigationSnapshot() {
  const navigation = reconcileWorkNavigationRuntime();
  const { todayItems, work, growth } = workNavigationCandidates();
  const taskById = new Map(state.tasks.map((task) => [task.id, task]));
  const orderedWork = navigation.runtime.workQueueIds.map((taskId) => taskById.get(taskId)).filter((task) => work.some((item) => item.id === task?.id));
  const orderedGrowth = navigation.runtime.growthQueueIds.map((taskId) => taskById.get(taskId)).filter((task) => growth.some((item) => item.id === task?.id));
  const referencedWork = orderedWork.find((task) => task.id === navigation.runtime.activeWorkTaskId) || null;
  const activeWork = referencedWork || (navigation.runtime.workAdvancePaused ? null : orderedWork[0] || null);
  const activeGrowth = orderedGrowth.find((task) => task.id === navigation.runtime.activeGrowthTaskId) || (navigation.runtime.growthAdvancePaused ? null : orderedGrowth[0] || null);
  const workIds = new Set(work.map((task) => task.id));
  return {
    version: APP_VERSION || "dev",
    navigation: JSON.parse(JSON.stringify(navigation)),
    tasks: state.tasks.map(workNavigationTaskSnapshot),
    groups: sort(state.taskGroups).map((group) => ({ id: group.id, title: group.title, order: group.order })),
    todayTaskIds: todayItems.map((item) => item.task.id),
    workTaskIds: orderedWork.map((task) => task.id),
    growthTaskIds: orderedGrowth.map((task) => task.id),
    activeWorkTaskId: activeWork?.id || "",
    activeGrowthTaskId: activeGrowth?.id || "",
    detachedWorkTask: Boolean(activeWork && !workIds.has(activeWork.id)),
    activeAppTaskId: state.activeTaskId || "",
  };
}

function setWorkNavigationRuntime(patch = {}) {
  const navigation = normalizeCurrentWorkNavigation();
  navigation.runtime = {
    ...navigation.runtime,
    ...patch,
    dateKey: workNavigationModel.localDateKey(loopNow()),
  };
  state.workNavigation = workNavigationModel.normalizeWorkNavigation(navigation, {
    groupIds: state.taskGroups.map((group) => group.id),
  });
}

function updateWorkNavigationConfig(nextConfig) {
  const navigation = normalizeCurrentWorkNavigation();
  navigation.config = nextConfig;
  if (nextConfig?.work?.autoAdvance) navigation.runtime.workAdvancePaused = false;
  if (nextConfig?.growth?.autoAdvance) navigation.runtime.growthAdvancePaused = false;
  state.workNavigation = workNavigationModel.normalizeWorkNavigation(navigation, {
    groupIds: state.taskGroups.map((group) => group.id),
  });
  reconcileWorkNavigationRuntime();
  save();
  render();
  return { success: true, navigation: state.workNavigation };
}

function openTaskFromNavigation(taskId, options = {}) {
  const task = state.tasks.find((item) => item.id === taskId && item.status !== "done");
  if (!task) return { success: false, code: "TASK_NOT_FOUND" };
  if (options.addToToday === true) {
    task.tags = normalizeTaskTags(task.tags);
    task.tags.today = true;
    task.updatedAt = now();
  }
  if (options.kind === "growth") {
    setWorkNavigationRuntime({ activeGrowthTaskId: task.id, growthAdvancePaused: false });
  } else {
    setWorkNavigationRuntime({ activeWorkTaskId: task.id, workAdvancePaused: false });
  }
  openTaskFromGlobalList(task.id);
  save();
  render();
  return { success: true, code: "OPENED", taskId: task.id };
}

function nextNavigationTask(kind) {
  const { work, growth } = workNavigationCandidates();
  const navigation = normalizeCurrentWorkNavigation();
  const candidates = kind === "growth" ? growth : work;
  const queueIds = kind === "growth" ? navigation.runtime.growthQueueIds : navigation.runtime.workQueueIds;
  const byId = new Map(candidates.map((task) => [task.id, task]));
  return queueIds.map((taskId) => byId.get(taskId)).find(Boolean) || candidates[0] || null;
}

function advanceNavigationAfterCompletion(taskId) {
  const navigation = normalizeCurrentWorkNavigation();
  let kind = "";
  if (navigation.runtime.activeGrowthTaskId === taskId) kind = "growth";
  if (navigation.runtime.activeWorkTaskId === taskId) kind = "work";
  if (!kind) return null;
  const autoAdvance = kind === "growth"
    ? navigation.config.growth.autoAdvance
    : navigation.config.work.autoAdvance;
  const next = autoAdvance ? nextNavigationTask(kind) : null;
  if (kind === "growth") {
    navigation.runtime.activeGrowthTaskId = next?.id || "";
    navigation.runtime.growthAdvancePaused = !autoAdvance;
  } else {
    navigation.runtime.activeWorkTaskId = next?.id || "";
    navigation.runtime.workAdvancePaused = !autoAdvance;
  }
  if (next) openTaskFromGlobalList(next.id);
  return { kind, nextTaskId: next?.id || "" };
}

function completeTaskFromNavigation(taskId, kind) {
  const navigation = normalizeCurrentWorkNavigation();
  const runtimeKey = kind === "growth" ? "activeGrowthTaskId" : "activeWorkTaskId";
  if (navigation.runtime[runtimeKey] && navigation.runtime[runtimeKey] !== taskId) {
    return { success: false, code: "STALE_TASK" };
  }
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.status === "done") return { success: false, code: "TASK_NOT_FOUND" };
  openTaskFromGlobalList(task.id);
  const completion = toggleTaskDone(task.id);
  if (task.status !== "done") {
    render();
    return { success: false, code: completion?.code || "CONCLUSION_REQUIRED", taskId: task.id };
  }
  const advanced = advanceNavigationAfterCompletion(task.id);
  save();
  render();
  return { success: true, code: "COMPLETED", taskId: task.id, nextTaskId: advanced?.nextTaskId || "" };
}

function blockTaskFromNavigation(taskId, kind) {
  const task = state.tasks.find((item) => item.id === taskId && item.status !== "done");
  if (!task) return { success: false, code: "TASK_NOT_FOUND" };
  const navigation = normalizeCurrentWorkNavigation();
  const queueKey = kind === "growth" ? "growthQueueIds" : "workQueueIds";
  const activeKey = kind === "growth" ? "activeGrowthTaskId" : "activeWorkTaskId";
  task.tags = normalizeTaskTags({ ...task.tags, blocked: true });
  task.updatedAt = now();
  navigation.runtime.blockedTaskIds = [...new Set([...navigation.runtime.blockedTaskIds, task.id])];
  navigation.runtime[queueKey] = navigation.runtime[queueKey].filter((id) => id !== task.id);
  navigation.runtime[activeKey] = navigation.runtime[queueKey][0] || "";
  if (navigation.runtime[activeKey]) openTaskFromGlobalList(navigation.runtime[activeKey]);
  save();
  render();
  return { success: true, code: "BLOCKED", taskId, nextTaskId: navigation.runtime[activeKey] };
}

function saveNavigationRecovery(taskId, value = {}) {
  const task = state.tasks.find((item) => item.id === taskId && item.status !== "done");
  if (!task) return { success: false, code: "TASK_NOT_FOUND" };
  task.navigationRecovery = workNavigationModel.normalizeRecovery({
    ...value,
    updatedAt: now(),
  });
  task.updatedAt = now();
  save();
  render();
  return { success: true, code: "SAVED", taskId };
}

function openGrowthGroup() {
  const sourceGroupId = normalizeCurrentWorkNavigation().config.growth.sourceGroupId;
  if (!state.taskGroups.some((group) => group.id === sourceGroupId)) {
    return { success: false, code: "GROUP_NOT_FOUND" };
  }
  selectGroup(sourceGroupId);
  state.activeTaskId = tasksInActiveGroup().find((task) => task.status !== "done")?.id || tasksInActiveGroup()[0]?.id || "";
  save();
  render();
  return { success: true, code: "OPENED", groupId: sourceGroupId };
}

function makeImportedTask(item, groupId, order) {
  const createdAt = now();
  const taskId = id("task");
  return {
    id: taskId,
    order,
    groupId,
    title: item.title,
    description: item.description,
    status: "active",
    priority: "medium",
    tags: normalizeTaskTags({}),
    recurrence: normalizeTaskRecurrence({}),
    hypothesis: "",
    hypothesisUpdatedAt: "",
    conclusion: "",
    navigationRecovery: workNavigationModel.normalizeRecovery(null),
    estimateMinutes: item.estimateMinutes,
    origin: workNavigationModel.normalizeOrigin(item.origin),
    deadlineAt: "",
    deadlineReminderMinutes: defaultDeadlineReminderMinutes,
    notes: "",
    knowledgeNote: knowledgeDocument.createKnowledgeNoteMetadata({
      noteId: id("note"), taskId, title: item.title, createdAt, updatedAt: createdAt,
    }),
    createdAt,
    updatedAt: createdAt,
    nodes: item.nodes.map((node, index) => ({
      ...makeNode(taskId, null, index + 1),
      title: node.title,
      order: node.order,
    })),
  };
}

function makeImportedLearningTask(item, groupId, planId, order) {
  return makeImportedTask({
    ...item,
    origin: { kind: "learning-plan", planId, itemId: item.itemId },
  }, groupId, order);
}

function importTaskBatch(value, options = {}) {
  const group = state.taskGroups.find((item) => item.id === options.groupId);
  if (!group) return { success: false, code: "GROUP_NOT_FOUND" };
  const preview = workNavigationModel.previewTaskBatchImport(value, state.tasks, {
    groupId: group.id,
    defaultEstimateMinutes: options.defaultEstimateMinutes,
  });
  if (!preview.valid) return { success: false, code: "INVALID_BATCH", errors: preview.errors };
  const selectedKeys = Array.isArray(options.selectedKeys) ? new Set(options.selectedKeys) : null;
  const estimateMinutesByKey = options.estimateMinutesByKey && typeof options.estimateMinutesByKey === "object"
    ? options.estimateMinutesByKey
    : {};
  const selected = preview.newTasks.filter((item) => !selectedKeys || selectedKeys.has(item.key));
  const groupOrders = state.tasks.filter((task) => task.groupId === group.id).map((task) => Number(task.order) || 0);
  let nextOrder = Math.max(0, ...groupOrders) + 1;
  const imported = selected.map((item) => makeImportedTask({
    ...item,
    estimateMinutes: Math.max(1, Math.min(720, Math.round(Number(estimateMinutesByKey[item.key]) || item.estimateMinutes || 60))),
  }, group.id, nextOrder++));
  state.tasks.push(...imported);
  reconcileWorkNavigationRuntime();
  save();
  render();
  return {
    success: true,
    code: "IMPORTED",
    groupId: group.id,
    importedCount: imported.length,
    existingCount: preview.existingTasks.length,
    excludedCount: preview.newTasks.length - imported.length,
  };
}

function importLearningPlan(value, options = {}) {
  const preview = workNavigationModel.previewLearningPlanImport(value, state.tasks);
  if (!preview.valid) return { success: false, code: "INVALID_PLAN", errors: preview.errors };
  let group = state.taskGroups.find((item) => item.id === options.groupId);
  if (!group) group = state.taskGroups.find((item) => item.title === preview.plan.targetGroup);
  if (!group) {
    group = { id: id("group"), title: preview.plan.targetGroup, order: state.taskGroups.length + 1 };
    state.taskGroups.push(group);
  }
  const groupOrders = state.tasks.filter((task) => task.groupId === group.id).map((task) => Number(task.order) || 0);
  let nextOrder = Math.max(0, ...groupOrders) + 1;
  const imported = preview.newTasks.map((item) => makeImportedLearningTask(item, group.id, preview.plan.id, nextOrder++));
  state.tasks.push(...imported);
  if (!normalizeCurrentWorkNavigation().config.growth.sourceGroupId) {
    state.workNavigation.config.growth.sourceGroupId = group.id;
  }
  reconcileWorkNavigationRuntime();
  save();
  render();
  return {
    success: true,
    code: "IMPORTED",
    groupId: group.id,
    importedCount: imported.length,
    existingCount: preview.existingTasks.length,
  };
}

globalThis.LoopWorkNavigationBridge = Object.freeze({
  snapshot: workNavigationSnapshot,
  setRuntime(patch) {
    setWorkNavigationRuntime(patch);
    save();
    render();
    return { success: true };
  },
  updateConfig: updateWorkNavigationConfig,
  openTask: openTaskFromNavigation,
  completeTask: completeTaskFromNavigation,
  blockTask: blockTaskFromNavigation,
  saveRecovery: saveNavigationRecovery,
  openGrowthGroup,
  importTaskBatch,
  importLearningPlan,
  openSettings() {
    activeSettingsPage = "advanced";
    state.settingsOpen = true;
    state.calendarOpen = false;
    state.reviewOpen = false;
    render();
    return { success: true };
  },
});

function recurrenceSummaryLabel(value) {
  const recurrence = normalizeTaskRecurrence(value);
  if (recurrence.frequency === "daily") return `每天 · ${recurrence.time}`;
  if (recurrence.frequency === "weekly") {
    const weekdays = recurrenceWeekdayOrder
      .filter((weekday) => recurrence.weekdays.includes(weekday))
      .map((weekday) => recurrenceWeekdayLabels[weekday].replace("周", ""));
    return weekdays.length ? `每周${weekdays.join("、")} · ${recurrence.time}` : "每周 · 请选择日期";
  }
  return "不循环";
}

function recurrenceUpcomingLabels(value, start = loopNow(), count = 3) {
  const recurrence = normalizeTaskRecurrence(value);
  if (recurrence.frequency === "none" || count < 1) return [];
  const [hours, minutes] = recurrence.time.split(":").map(Number);
  const cursor = new Date(start);
  cursor.setHours(hours, minutes, 0, 0);
  if (cursor <= start) cursor.setDate(cursor.getDate() + 1);
  const labels = [];
  for (let step = 0; step < 32 && labels.length < count; step += 1) {
    if (recurrence.frequency === "daily" || recurrence.weekdays.includes(cursor.getDay())) {
      labels.push(`${cursor.getMonth() + 1}月${cursor.getDate()}日 ${recurrenceWeekdayLabels[cursor.getDay()]} ${recurrence.time}`);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return labels;
}

function recurringOccurrenceKey(task, at = loopNow()) {
  const recurrence = normalizeTaskRecurrence(task.recurrence);
  if (recurrence.frequency === "none") return "";
  const date = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(date.getTime())) return "";
  const [hours, minutes] = recurrence.time.split(":").map(Number);
  if (date.getHours() * 60 + date.getMinutes() < hours * 60 + minutes) return "";
  if (recurrence.frequency === "weekly" && !recurrence.weekdays.includes(date.getDay())) return "";
  return localDateKey(date);
}

function isRecurringTaskDue(task, at = loopNow()) {
  const occurrence = recurringOccurrenceKey(task, at);
  return Boolean(occurrence && normalizeTaskRecurrence(task.recurrence).lastCompletedOccurrence !== occurrence);
}

function isTaskScheduledForToday(task, at = loopNow()) {
  const deadline = safeDate(task.deadlineAt);
  return normalizeTaskTags(task.tags).today || isRecurringTaskDue(task, at) || Boolean(deadline && localDateKey(deadline) === localDateKey(at));
}

/**
 * Phase18 (frozen Demo loop-time-phase18.js completeToday()): finished work that
 * belongs to the perceived day, either by its completion stamp or by the
 * occurrence a recurring task completed. It keeps today's completions reachable
 * after they leave the active Today list.
 */
function shellCompletedToday() {
  const today = loopTodayKey();
  return state.tasks.filter((task) => task.status === "done"
    && !shellTaskIsNote(task)
    && (localDateKey(task.resolvedAt) === today
      || normalizeTaskRecurrence(task.recurrence).lastCompletedOccurrence === today));
}

function recurringScheduleSignature(at = loopNow()) {
  return state.tasks
    .map((task) => `${task.id}:${recurringOccurrenceKey(task, at)}:${isRecurringTaskDue(task, at) ? "due" : "idle"}`)
    .join("|");
}

function syncRecurringTasks(at = loopNow()) {
  let statusChanged = false;
  state.tasks.forEach((task) => {
    const occurrence = recurringOccurrenceKey(task, at);
    const recurrence = normalizeTaskRecurrence(task.recurrence);
    if (!occurrence || recurrence.lastCompletedOccurrence === occurrence || task.status !== "done") return;
    task.status = "active";
    task.resolvedAt = "";
    task.updatedAt = at.toISOString();
    statusChanged = true;
  });
  const nextSignature = recurringScheduleSignature(at);
  const scheduleChanged = nextSignature !== recurringTodaySignature;
  recurringTodaySignature = nextSignature;
  if (statusChanged) save();
  return statusChanged || scheduleChanged;
}

function startRecurringSchedule() {
  window.clearInterval?.(recurrenceScheduleTimer);
  recurrenceScheduleTimer = window.setInterval?.(() => {
    if (syncRecurringTasks(loopNow())) render();
  }, 30000) || 0;
}

function isTaskTouchedToday(task) {
  return isToday(task.updatedAt) || flatten(task.nodes).some((node) => isToday(node.updatedAt));
}

function latestTaskTime(task) {
  const times = [Date.parse(task.updatedAt), ...flatten(task.nodes).map((node) => Date.parse(node.updatedAt))].filter(Number.isFinite);
  return times.length ? Math.max(...times) : 0;
}

function isToday(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = loopNow();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
}

function taskSummary(task) {
  const nodes = flatten(task.nodes);
  const done = nodes.filter((node) => node.status === "done").length;
  return {
    total: nodes.length,
    done,
    open: nodes.length - done,
  };
}

function nextOpenNode(nodes) {
  for (const node of sort(nodes)) {
    if (node.status !== "done") return node;
    const found = nextOpenNode(node.children);
    if (found) return found;
  }
  return null;
}


// ============================================================
// HTML HELPER FUNCTIONS (input, select, textarea builders)
// ============================================================
function inputHtml(key, value, taskId, className = "", nodeId = "") {
  return `<input class="${className}" aria-label="${escAttr(editFieldLabels[key] || key)}" data-edit-key="${key}" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(nodeId)}" value="${escAttr(value)}" />`;
}

function nodeTitleInputHtml(node, taskId) {
  return `<input class="flow-title-input" placeholder="填写节点标题" aria-label="节点标题" data-edit-key="title" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(node.id)}" value="${escAttr(node.title)}" />`;
}

function textareaHtml(key, value, taskId, nodeId = "") {
  return `<textarea aria-label="${escAttr(editFieldLabels[key] || key)}" data-edit-key="${key}" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(nodeId)}">${esc(value)}</textarea>`;
}

function selectHtml(key, value, options, taskId, nodeId = "") {
  return `
    <select aria-label="${escAttr(editFieldLabels[key] || key)}" data-edit-key="${key}" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(nodeId)}">
      ${Object.entries(options)
        .map(([optionValue, label]) => `<option value="${optionValue}" ${optionValue === value ? "selected" : ""}>${label}</option>`)
        .join("")}
    </select>
  `;
}

function newTaskPrioritySelect() {
  return `
    <select data-new-task-priority>
      ${Object.entries(priorityLabels)
        .map(([value, label]) => `<option value="${value}" ${value === state.newTaskPriority ? "selected" : ""}>${label}</option>`)
        .join("")}
    </select>
  `;
}

function filterSelectHtml(kind, value, options, title = "") {
  return `
    <select data-${kind} ${title ? `title="${escAttr(title)}"` : ""}>
      ${Object.entries(options)
        .map(([optionValue, label]) => `<option value="${optionValue}" ${optionValue === value ? "selected" : ""}>${label}</option>`)
        .join("")}
    </select>
  `;
}


// ============================================================
// SETTINGS PANEL
// ============================================================
function renderSettingsPanel() {
  const pages = {
    appearance: ["外观", "调整界面主题与字体。"],
    tasks: ["任务与浮窗", "管理任务的默认显示与今日浮窗。"],
    data: ["数据", "迁移、恢复或保存完整的本地数据。"],
    updates: ["软件更新", "检查新版本，并由你决定是否安装。"],
    advanced: ["高级功能", "管理需要主动开启的扩展能力。"],
    help: ["帮助与反馈", "报告问题或查看应用信息。"],
  };
  const page = Object.hasOwn(pages, activeSettingsPage) ? activeSettingsPage : "appearance";
  const row = (label, control, extraClass = "") => `
    <div class="settings-row ${extraClass}">
      <div class="settings-row-copy"><strong>${label}</strong></div>
      <div class="settings-row-control">${control}</div>
    </div>
  `;
  const selectRow = (label, key, value, options) => row(label, settingsSelectHtml(key, value, options), "settings-row-select");
  const pageBody = {
    appearance: `
      <h3 class="settings-section-label">界面</h3>
      <section class="settings-list">
        ${row("显示模式", settingsOptionGroup("theme", state.theme, themeLabels))}
        ${selectRow("界面字号", "font-scale", state.fontScale, fontScaleLabels)}
        ${selectRow("中文字体", "zh-font", state.zhFont, zhFontLabels)}
        ${selectRow("英文字体", "en-font", state.enFont, enFontLabels)}
      </section>
      <div class="settings-preview" aria-label="字体预览">
        <strong class="settings-preview-zh">任务流中文字体预览</strong>
        <span class="settings-preview-en">Task flow English 123</span>
      </div>
    `,
    tasks: `
      <h3 class="settings-section-label">任务视图</h3>
      <section class="settings-list">
        ${selectRow("任务范围", "task-filter", state.taskFilter, taskFilterLabels)}
        ${selectRow("优先级范围", "priority-filter", state.priorityFilter, priorityFilterLabels)}
        ${selectRow("新任务优先级", "new-task-priority", state.newTaskPriority, priorityLabels)}
        ${row("今日任务浮窗", `
          <button class="settings-switch" type="button" role="switch" aria-checked="${todayWidgetWindowState.visible === true}" data-action="toggle-today-widget-visibility" aria-label="显示今日任务浮窗" ${!desktopTodayWidget ? "disabled" : ""}></button>
        `)}
        ${row("鼠标穿透", `
          <button class="settings-switch" type="button" role="switch" aria-checked="${todayWidgetWindowState.clickThrough === true}" data-action="toggle-today-widget-click-through" aria-label="今日任务浮窗鼠标穿透" ${!desktopTodayWidget ? "disabled" : ""}></button>
        `)}
      </section>
      <p class="settings-page-note">浮窗关闭后可在这里重新开启。快捷键：⌘/Ctrl + Shift + T</p>
    `,
    data: `
      <h3 class="settings-section-label" id="data-backup-title">备份与恢复</h3>
      <section class="settings-list" aria-labelledby="data-backup-title">
        ${row("完整备份", `<button class="settings-inline-action primary" type="button" data-backup-action="export" ${!desktopDataBackup ? "disabled" : ""}>导出备份</button>`)}
        ${row("恢复备份文件", `<button class="settings-inline-action" type="button" data-backup-action="import-file" ${!desktopDataBackup ? "disabled" : ""}>选择文件</button>`)}
        ${row("从备份目录恢复", `<button class="settings-inline-action" type="button" data-backup-action="import-directory" ${!desktopDataBackup ? "disabled" : ""}>选择目录</button>`)}
      </section>
      <p class="settings-page-note" data-backup-status>导入前会自动备份当前数据；校验失败将回滚。</p>
    `,
    updates: `
      <h3 id="software-update-title">软件更新</h3>
      <section class="settings-list settings-update-list" aria-labelledby="software-update-title">
        <div class="settings-update-slot">${renderUpdateSettingsControls()}</div>
      </section>
    `,
    advanced: `
      <h3 class="settings-section-label">扩展能力</h3>
      <div class="settings-advanced-slot" data-settings-advanced-slot></div>
    `,
    help: `
      <h3 class="settings-section-label">支持</h3>
      <section class="settings-list">
        ${row("反馈问题", `<button class="settings-inline-action primary" type="button" data-action="open-feedback">打开反馈</button>`)}
        ${row("应用信息", `<span class="settings-current-value">Loop ${APP_VERSION ? `v${esc(APP_VERSION)}` : "开发预览"}</span>`)}
      </section>
    `,
  }[page];
  const navItems = [
    ["appearance", "外观"],
    ["tasks", "任务与浮窗"],
    ["data", "数据"],
    ["updates", "软件更新"],
    ["advanced", "高级功能"],
    ["help", "帮助与反馈"],
  ];
  return `
    <div class="settings-overlay ${settingsMotion === "open" ? "settings-overlay-opening" : ""}" role="presentation">
      <section class="settings-panel ${settingsMotion === "open" ? "settings-panel-opening" : ""} ${settingsMotion === "page" ? "settings-page-swap" : ""}" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="settings-head">
          <h2 id="settings-title">设置</h2>
          <button class="settings-close" type="button" data-action="close-settings" title="关闭" aria-label="关闭设置">×</button>
        </header>
        <div class="settings-layout">
          <nav class="settings-nav" aria-label="设置分类">
            ${navItems.map(([value, label]) => `<button class="${value === page ? "active" : ""} ${value === "help" ? "settings-nav-help" : ""}" type="button" data-settings-page="${value}" aria-current="${value === page ? "page" : "false"}">${label}</button>`).join("")}
          </nav>
          <div class="settings-body">
            <main class="settings-content" data-settings-content>
              <header class="settings-page-head">
                <h3>${pages[page][0]}</h3>
                <p>${pages[page][1]}</p>
              </header>
              ${pageBody}
            </main>
          </div>
        </div>
      </section>
    </div>
  `;
}

function normalizeAppUpdateState(value) {
  const raw = value && typeof value === "object" ? value : {};
  const status = appUpdateStatuses.has(raw.status) ? raw.status : "unsupported";
  const safeNumber = (number) => Number.isFinite(Number(number)) && Number(number) > 0 ? Number(number) : 0;
  return {
    status,
    supported: raw.supported === true,
    unsupportedReason: ["", "development", "mac-signing-required", "platform-unsupported"].includes(raw.unsupportedReason)
      ? raw.unsupportedReason
      : "platform-unsupported",
    automaticChecks: raw.automaticChecks !== false,
    currentVersion: String(raw.currentVersion || APP_VERSION || "").slice(0, 64),
    version: String(raw.version || "").slice(0, 64),
    releaseDate: String(raw.releaseDate || "").slice(0, 64),
    size: safeNumber(raw.size),
    percent: Math.max(0, Math.min(100, safeNumber(raw.percent))),
    transferred: safeNumber(raw.transferred),
    total: safeNumber(raw.total),
    bytesPerSecond: safeNumber(raw.bytesPerSecond),
    lastCheckedAt: String(raw.lastCheckedAt || "").slice(0, 64),
    errorCode: String(raw.errorCode || "").replace(/[^0-9A-Z_.-]/gi, "").slice(0, 64),
    retryAction: ["check", "download", "install"].includes(raw.retryAction) ? raw.retryAction : (raw.version ? "download" : "check"),
    preferenceError: String(raw.preferenceError || "").replace(/[^0-9A-Z_.-]/gi, "").slice(0, 64),
  };
}

function renderUpdateSettingsControls() {
  const update = appUpdateState;
  const busy = ["checking", "downloading", "preparing", "installing"].includes(update.status);
  const currentVersion = update.currentVersion || APP_VERSION;
  return `
    <div class="settings-update-controls" aria-busy="${busy}">
      <div class="settings-update-preference">
        <div>
          <strong>自动检查更新</strong>
          <span>${update.automaticChecks ? "应用启动后定期检查" : "仅在手动操作时检查"}</span>
        </div>
        <button
          class="settings-update-switch"
          type="button"
          role="switch"
          aria-checked="${update.automaticChecks}"
          aria-label="自动检查更新"
          data-update-automatic
          ${update.supported && !busy ? "" : "disabled"}
        ></button>
      </div>
      <div class="settings-update-action-row">
        <div>
          <strong>当前版本</strong>
          <span><b class="settings-update-version">${currentVersion ? `v${esc(currentVersion)}` : "开发预览"}</b>${update.supported ? ` · ${esc(updatePlatformLabel())}` : ""}</span>
        </div>
        <button class="settings-inline-action settings-update-check" type="button" data-update-action="check" ${!update.supported || busy ? "disabled" : ""}>
          ${update.status === "checking" ? "检查中…" : "检查更新"}
        </button>
      </div>
      <div class="settings-update-status" aria-live="polite">
        ${renderUpdateStatus(update)}
      </div>
    </div>
  `;
}

function renderUpdateStatus(update) {
  if (update.status === "idle") return "";
  if (update.status === "unsupported") {
    const macUnsigned = update.unsupportedReason === "mac-signing-required";
    const development = update.unsupportedReason === "development";
    return updateStatusSheet({
      icon: "i",
      title: macUnsigned ? "当前 macOS 版本暂未启用应用内更新" : development ? "安装版支持应用内更新" : "当前系统暂不支持应用内更新",
      detail: macUnsigned ? "完成应用签名与公证后即可启用。" : development ? "开发预览不会连接更新服务，请在安装版中使用。" : "你仍可以从 GitHub Release 获取新版本。",
    });
  }
  if (update.status === "checking") {
    return updateStatusSheet({ icon: "", title: "正在检查更新…", detail: "正在连接 GitHub Release。", spinning: true });
  }
  if (update.status === "latest") {
    return updateStatusSheet({ icon: "✓", title: "已是最新版本", detail: `刚刚检查 · 当前为 v${esc(update.currentVersion || APP_VERSION)}` });
  }
  if (update.status === "available") {
    const metadata = [formatUpdateSize(update.size), formatUpdateDate(update.releaseDate)].filter(Boolean).join(" · ");
    return updateStatusSheet({
      icon: "↑",
      tone: "available",
      title: `v${esc(update.version)} 可用`,
      detail: metadata || "新版本已发布",
      notes: ["确认后在应用内后台下载", "完成后自动安装并重新启动"],
      actions: `<button class="settings-update-button ghost" type="button" data-update-action="later">稍后</button><button class="settings-update-button primary" type="button" data-update-action="download">升级并重启</button>`,
    });
  }
  if (update.status === "downloading") {
    const percent = Math.round(update.percent);
    const detail = [
      `${percent}%`,
      update.bytesPerSecond ? `${formatUpdateSize(update.bytesPerSecond)}/s` : "",
      "完成后将自动重启",
    ].filter(Boolean).join(" · ");
    return updateStatusSheet({
      icon: "↓",
      title: `正在下载 v${esc(update.version)}`,
      detail,
      progress: percent,
    });
  }
  if (update.status === "downloaded") {
    const preparationFailed = update.errorCode === "INSTALL_PREPARATION_FAILED";
    return updateStatusSheet({
      icon: preparationFailed ? "!" : "✓",
      tone: preparationFailed ? "error" : "available",
      title: preparationFailed ? "升级前保存未完成" : `v${esc(update.version)} 已下载`,
      detail: preparationFailed ? "应用没有退出，你的内容仍保留。请排除磁盘或权限问题后重试。" : "升级包已就绪，由你确认后再安装并重启。",
      actions: `<button class="settings-update-button ghost" type="button" data-update-action="later">稍后</button><button class="settings-update-button primary" type="button" data-update-action="download">${preparationFailed ? "重试升级" : "升级并重启"}</button>`,
    });
  }
  if (update.status === "preparing") {
    return updateStatusSheet({ icon: "", title: "正在保存并准备升级…", detail: "正在安全写入任务与知识笔记草稿。", spinning: true });
  }
  if (update.status === "installing") {
    return updateStatusSheet({ icon: "", title: "正在完成升级…", detail: "应用即将自动重启，请稍候。", spinning: true, progress: 100 });
  }
  const error = updateErrorPresentation(update.errorCode);
  return updateStatusSheet({
    icon: "!",
    tone: "error",
    title: error.title,
    detail: error.detail,
    notes: error.code ? [`诊断代码：${error.code}`] : [],
    actions: `<a class="settings-update-button ghost" href="https://github.com/tangyuanx/Loop/releases/latest" target="_blank" rel="noreferrer">打开发布页</a><button class="settings-update-button" type="button" data-update-action="check">重试</button>`,
  });
}

function updateErrorPresentation(value) {
  const code = String(value || "UPDATE_FAILED").replace(/[^0-9A-Z_.-]/gi, "").slice(0, 64) || "UPDATE_FAILED";
  if (code === "UPDATE_METADATA_MISSING") {
    return {
      code,
      title: "Windows 更新包尚未发布完整",
      detail: "GitHub Release 缺少 Windows 更新元数据。请稍后重试，或打开发布页手动下载完整安装包。",
    };
  }
  if (["UPDATE_METADATA_INVALID", "UPDATE_RELEASE_NOT_FOUND"].includes(code)) {
    return {
      code,
      title: "暂时没有可用的更新信息",
      detail: "发布元数据不可用。当前版本仍可正常使用，请稍后重试。",
    };
  }
  if (["UPDATE_TIMEOUT", "UPDATE_NETWORK_UNAVAILABLE"].includes(code)) {
    return {
      code,
      title: "暂时无法连接更新服务",
      detail: "连接 GitHub 超时或网络不可用。请检查网络后重试。",
    };
  }
  if (code === "UPDATE_TLS_FAILED") {
    return {
      code,
      title: "更新服务安全连接失败",
      detail: "请检查系统时间、代理或安全软件的 HTTPS 证书设置后重试。",
    };
  }
  if (["UPDATE_RATE_LIMITED", "UPDATE_ACCESS_DENIED"].includes(code)) {
    return {
      code,
      title: "GitHub 暂时拒绝了更新请求",
      detail: "请求可能过于频繁或被网络代理拦截。请稍后重试。",
    };
  }
  if (code === "UPDATE_INTEGRITY_FAILED") {
    return {
      code,
      title: "更新包完整性校验失败",
      detail: "应用没有安装该文件。请稍后重试，或从发布页重新下载安装包。",
    };
  }
  return {
    code,
    title: "暂时无法检查或下载更新",
    detail: "当前版本仍可正常使用。你可以重试，或打开发布页查看最新版本。",
  };
}

function updateStatusSheet({ icon, title, detail, tone = "", spinning = false, notes = [], actions = "", progress = null }) {
  return `
    <div class="settings-update-sheet" ${tone ? `data-tone="${tone}"` : ""}>
      <div class="settings-update-sheet-top">
        <div class="settings-update-copy">
          <span class="settings-update-icon ${spinning ? "spinning" : ""}" aria-hidden="true">${icon}</span>
          <div>
            <strong>${title}</strong>
            <p>${detail}</p>
          </div>
        </div>
      </div>
      ${notes.length ? `<ul>${notes.map((note) => `<li>${note}</li>`).join("")}</ul>` : ""}
      ${actions ? `<div class="settings-update-actions">${actions}</div>` : ""}
      ${progress !== null ? `<div class="settings-update-progress" aria-hidden="true"><span style="width:${progress}%"></span></div>` : ""}
    </div>
  `;
}

function updatePlatformLabel() {
  if (window.personalTaskTrack?.platform === "win32") return "Windows x64";
  if (window.personalTaskTrack?.platform === "darwin") return "macOS";
  return "Desktop";
}

function formatUpdateSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatUpdateDate(value) {
  const date = safeDate(value);
  return date ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date) : "";
}

function renderSidebarUpdateControl(update = appUpdateState) {
  const pendingStatuses = ["available", "downloading", "downloaded", "preparing", "installing"];
  const hasPendingUpdate = Boolean(update.version) && pendingStatuses.includes(update.status);
  if (!hasPendingUpdate) {
    return `<span class="topbar-update-slot" data-sidebar-update-slot hidden></span>`;
  }

  const busy = ["downloading", "preparing", "installing"].includes(update.status);
  const label = update.status === "available"
    ? "更新"
    : update.status === "downloaded"
      ? "重启更新"
      : update.status === "downloading"
        ? `${Math.round(update.percent)}%`
        : update.status === "preparing"
          ? "准备中"
          : "安装中";
  const description = update.status === "available"
    ? `更新到 v${update.version}，完成后自动重启`
    : update.status === "downloaded"
      ? `重启并安装 v${update.version}`
      : `正在更新到 v${update.version}`;
  const icon = busy ? "loader" : "download-cloud";
  return `
    <button
      class="sidebar-update-action ${busy ? "is-busy" : ""}"
      type="button"
      data-sidebar-update-slot
      data-sidebar-update-action
      aria-label="${escAttr(description)}"
      title="${escAttr(description)}"
      ${busy ? 'aria-busy="true" disabled' : ""}
    >
      <svg class="sidebar-update-icon" aria-hidden="true"><use href="./src/assets/feather/feather-sprite.svg#${icon}"></use></svg>
      <span>${label}</span>
    </button>
  `;
}

function refreshSidebarUpdateControl() {
  const current = document.querySelector("[data-sidebar-update-slot]");
  if (!current) return;
  current.outerHTML = renderSidebarUpdateControl();
  bindSidebarUpdateControl();
}

function bindSidebarUpdateControl() {
  document.querySelector("[data-sidebar-update-action]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    // "available" downloads and then installs; "downloaded" installs; anything
    // else means there is nothing to fetch, so re-check and say so.
    void runUpdateAction(["available", "downloaded"].includes(appUpdateState.status) ? "download" : "check");
  });
}

function refreshUpdateSurfaces() {
  refreshSidebarUpdateControl();
  refreshUpdateSettings();
  // settings.js renders the 软件更新 page; re-render just its status card so a
  // click is reflected immediately (and progress ticks stay cheap).
  if (typeof globalThis.shellSettingsSyncUpdateCard === "function") {
    globalThis.shellSettingsSyncUpdateCard();
  }
  // The top-left chip and an open update popover show progress too.
  if (typeof globalThis.refreshShellBrandUpdate === "function") globalThis.refreshShellBrandUpdate();
  if (typeof globalThis.shellRefreshUpdatePanel === "function") globalThis.shellRefreshUpdatePanel();
}

/** True while the 软件更新 page is the one on screen. */
function updatesPageIsOpen() {
  return typeof activeSettingsPage === "string" && activeSettingsPage === "updates";
}

function refreshUpdateSettings() {
  const slot = document.querySelector(".settings-update-slot");
  if (!slot) return;
  slot.innerHTML = renderUpdateSettingsControls();
  bindUpdateSettingsControls();
}

function bindUpdateSettingsControls() {
  const toggle = document.querySelector("[data-update-automatic]");
  if (toggle && toggle.dataset.updateBound !== "1") {
    toggle.dataset.updateBound = "1";
    toggle.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!desktopUpdates?.setAutomaticChecks || updatePreferenceInFlight) return;
    updatePreferenceInFlight = true;
    const previous = appUpdateState.automaticChecks;
    appUpdateState = { ...appUpdateState, automaticChecks: !previous };
    refreshUpdateSurfaces();
    try {
      appUpdateState = normalizeAppUpdateState(await desktopUpdates.setAutomaticChecks(!previous));
    } catch {
      appUpdateState = { ...appUpdateState, automaticChecks: previous, preferenceError: "PREFERENCE_FAILED" };
    }
    updatePreferenceInFlight = false;
    refreshUpdateSurfaces();
  });
  }

  // [data-update-action] is handled by one delegated listener (see
  // bindUpdateActionDelegation) because the update surfaces re-render in place.
}

/**
 * [data-action] elements are bound one by one on every render, so anything the
 * renderer adds later (a live update chip, a refresh of a status card) would be
 * silently dead. This fallback dispatches those clicks; elements bound by the
 * render pass stop propagation, so nothing is handled twice.
 */
function bindActionDelegation() {
  if (bindActionDelegation.bound) return;
  bindActionDelegation.bound = true;
  document.addEventListener("click", (event) => {
    const element = event.target.closest?.("[data-action]");
    if (!element || element.dataset.actionBound === "1" || element.disabled === true) return;
    event.stopPropagation();
    element.dataset.actionBound = "1";
    void action(element.dataset, event);
  });
}

function bindUpdateActionDelegation() {
  if (bindUpdateActionDelegation.bound) return;
  bindUpdateActionDelegation.bound = true;
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-update-action]");
    if (!button) return;
    event.stopPropagation();
    const action = button.dataset.updateAction;
    if (action === "later") {
      button.closest(".settings-update-sheet")?.remove();
      return;
    }
    void runUpdateAction(action);
  });
}

async function flushAllDataForTransfer() {
  captureMountedMilkdownDrafts();
  flushNodeNoteDrafts({ persist: false });
  save();
  if (!(await flushSave())) throw Object.assign(new Error("Task data could not be saved."), { code: "TRANSFER_SAVE_FAILED" });
  await flushPendingKnowledgeRecoveries({ strict: true });
}

function bindDataBackupControls() {
  syncDataBackupControls();
  document.querySelectorAll("[data-backup-action]").forEach((button) => {
    if (button.dataset.backupBound === "1") return;
    button.dataset.backupBound = "1";
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!desktopDataBackup || dataBackupOperation.busy || dataTransferInProgress) return;
      const action = event.currentTarget.dataset.backupAction;
      dataBackupOperation = { busy: true, message: action === "export" ? "正在保存并生成完整备份…" : "正在保存当前数据并校验所选备份…" };
      syncDataBackupControls();
      try {
        await flushAllDataForTransfer();
        // An import replaces the whole data set in place, so stop accepting
        // further renderer writes until the app restarts.
        const isImport = action !== "export";
        if (isImport) dataTransferInProgress = true;
        let result;
        try {
          result = action === "export"
            ? await desktopDataBackup.export()
            : action === "import-directory"
              ? await desktopDataBackup.importDirectory()
              : await desktopDataBackup.importFile();
        } catch (error) {
          if (isImport && !/IMPORT_ROLLBACK_FAILED|自动回滚未能完成/.test(`${error?.code} ${error?.message}`)) dataTransferInProgress = false;
          throw error;
        }
        if (result?.canceled && isImport) dataTransferInProgress = false;
        if (result?.canceled) {
          dataBackupOperation.message = "操作已取消，当前数据未发生变化。";
          if (isImport) save();
        } else if (action === "export") {
          dataBackupOperation.message = `完整备份已保存：${result.destinationPath || "所选位置"}`;
        } else {
          dataBackupOperation.message = "数据已恢复并校验成功，Loop 正在重新启动…";
        }
      } catch (error) {
        console.error("Loop data backup operation failed.", error);
        const detail = String(error?.message || "").split("Error: ").pop().trim();
        const rollbackFailed = /IMPORT_ROLLBACK_FAILED|自动回滚未能完成/.test(`${error?.code} ${detail}`);
        if (rollbackFailed) {
          dataProtectionMessage = `恢复未完成，已暂停写入。${detail}`;
          dataTransferInProgress = true;
        }
        dataBackupOperation.message = rollbackFailed ? dataProtectionMessage
          : `操作未完成。${detail && /回滚|备份/.test(detail) ? detail : "请检查文件、磁盘空间或目录权限后重试，当前工作空间已保留。"}`;
      } finally {
        dataBackupOperation.busy = false;
        syncDataBackupControls();
        updateLocalSaveReceipt();
      }
    });
  });
}

function syncDataBackupControls() {
  document.querySelectorAll("[data-backup-action]").forEach(control => {
    control.disabled = !desktopDataBackup || dataBackupOperation.busy || dataTransferInProgress || Boolean(dataProtectionMessage);
  });
  const status = document.querySelector("[data-backup-status]");
  if (status) status.textContent = dataBackupOperation.message;
}

async function runUpdateAction(action) {
  if (!desktopUpdates) return;
  if (!appUpdateState.supported || ["checking", "downloading", "preparing", "installing"].includes(appUpdateState.status)) return;
  // A click must never look dead. Two things can make it look dead: asking for a
  // download while nothing is downloadable (the updater returns the unchanged
  // state), and waiting for the first push from the main process. So the action
  // is validated against the current state and the result is reflected here,
  // before anything is awaited.
  const status = appUpdateState.status;
  const retry = status === "error" ? appUpdateState.retryAction : "";
  const effective = action === "download" && !["available", "downloaded"].includes(status) && retry !== "download"
    ? "check"
    : action === "install" && status !== "downloaded" && retry !== "install"
      ? "check"
      : action;
  lastUpdateAction = effective;
  appUpdateState = effective === "check"
    ? { ...appUpdateState, status: "checking", errorCode: "" }
    : effective === "download"
      ? { ...appUpdateState, status: "downloading", percent: 0, errorCode: "" }
      : { ...appUpdateState, status: "preparing", errorCode: "" };
  refreshUpdateSurfaces();
  try {
    const result = effective === "check"
      ? await desktopUpdates.check()
      : effective === "download"
        ? await desktopUpdates.download()
        : await desktopUpdates.install();
    if (result && typeof result === "object") appUpdateState = normalizeAppUpdateState(result);
  } catch {
    appUpdateState = { ...appUpdateState, status: "error", errorCode: "UPDATE_ACTION_FAILED" };
  }
  refreshUpdateSurfaces();
}

async function initializeAppUpdates() {
  bindActionDelegation();
  bindUpdateActionDelegation();
  if (!desktopUpdates?.getState) return;
  try {
    appUpdateState = normalizeAppUpdateState(await desktopUpdates.getState());
  } catch {
    appUpdateState = normalizeAppUpdateState({ status: "error", supported: true, currentVersion: APP_VERSION, errorCode: "STATE_FAILED" });
  }
  if (!unsubscribeAppUpdates && desktopUpdates.onState) {
    unsubscribeAppUpdates = desktopUpdates.onState((nextState) => {
      appUpdateState = normalizeAppUpdateState(nextState);
      if (["downloaded", "error"].includes(appUpdateState.status)) {
        document.querySelector("[data-update-install-overlay]")?.remove();
      }
      refreshUpdateSurfaces();
    });
  }
}

function showUpdateInstallOverlay() {
  const existing = document.querySelector("[data-update-install-overlay]");
  if (existing) return existing;
  const overlay = document.createElement("div");
  overlay.className = "update-install-overlay";
  overlay.dataset.updateInstallOverlay = "";
  overlay.tabIndex = -1;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "update-install-overlay-title");
  overlay.innerHTML = `
    <div class="update-install-card">
      <span class="update-install-spinner" aria-hidden="true"></span>
      <div>
        <strong id="update-install-overlay-title">正在完成升级</strong>
        <p>正在安全保存当前内容，完成后应用会自动重启。</p>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.focus({ preventScroll: true });
  return overlay;
}

async function prepareForUpdateInstall() {
  captureMountedMilkdownDrafts();
  flushNodeNoteDrafts({ persist: false });
  save();
  const overlay = showUpdateInstallOverlay();
  let ready = false;
  try {
    const taskDataSaved = await flushSave();
    if (!taskDataSaved) return false;
    await flushPendingKnowledgeRecoveries({ strict: true });
    ready = true;
    return true;
  } catch (error) {
    console.error("Failed to persist local data before installing update.", error);
    return false;
  } finally {
    // Keep the blocking wait screen in place only when the installer is about
    // to close the app. On failure the current session remains fully usable.
    if (!ready) overlay?.remove();
  }
}

function renderBugReportPanel() {
  const draft = state.feedbackDraft;
  const errors = state.feedbackErrors;
  const fieldError = (key) => errors[key] ? `<span class="feedback-field-error" id="feedback-${key}-error">${esc(errors[key])}</span>` : "";
  return `
    <div class="feedback-overlay" data-feedback-backdrop>
      <section class="feedback-panel" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <header class="feedback-head">
          <div>
            <span>Help & Feedback</span>
            <h2 id="feedback-title">反馈问题</h2>
            <p>请只填写与问题有关的信息，不要粘贴密码、Token 或私人文件内容。</p>
          </div>
          <button class="settings-close" type="button" data-action="close-feedback" title="关闭" aria-label="关闭反馈表单" ${state.feedbackSubmitting ? "disabled" : ""}>×</button>
        </header>
        ${state.feedbackResult ? renderBugReportSuccess() : `
          <form class="feedback-form" data-feedback-form novalidate>
            <div class="feedback-grid">
              <label class="feedback-field feedback-field-wide">
                <span>问题标题 <b>必填</b></span>
                <input data-feedback-field="title" maxlength="100" value="${escAttr(draft.title)}" placeholder="用一句话说明遇到的问题" aria-describedby="feedback-title-hint ${errors.title ? "feedback-title-error" : ""}" />
                <small id="feedback-title-hint">3～100 字</small>
                ${fieldError("title")}
              </label>
              <label class="feedback-field">
                <span>问题类型 <b>必填</b></span>
                <select data-feedback-field="category">
                  <option value="">请选择</option>
                  ${Object.entries(bugCategoryLabels).map(([value, label]) => `<option value="${value}" ${draft.category === value ? "selected" : ""}>${label}</option>`).join("")}
                </select>
                ${fieldError("category")}
              </label>
              <label class="feedback-field feedback-field-wide">
                <span>问题描述 <b>必填</b></span>
                <textarea data-feedback-field="description" maxlength="5000" rows="6" placeholder="说明发生了什么、期望看到什么结果">${esc(draft.description)}</textarea>
                <small>至少 10 字，最多 5000 字</small>
                ${fieldError("description")}
              </label>
              <label class="feedback-field feedback-field-wide">
                <span>复现步骤 <em>选填</em></span>
                <textarea data-feedback-field="reproductionSteps" maxlength="5000" rows="4" placeholder="1. 打开…&#10;2. 点击…&#10;3. 出现…">${esc(draft.reproductionSteps)}</textarea>
                ${fieldError("reproductionSteps")}
              </label>
              <label class="feedback-field feedback-field-wide">
                <span>联系方式 <em>选填，仅用于问题沟通</em></span>
                <input data-feedback-field="contact" maxlength="200" value="${escAttr(draft.contact)}" placeholder="邮箱或其他联系方式" />
                ${fieldError("contact")}
              </label>
            </div>
            <div class="feedback-consent">
              <label>
                <input type="checkbox" data-feedback-field="includeEnvironment" ${draft.includeEnvironment ? "checked" : ""} />
                <span>附带基础环境信息</span>
              </label>
              <p>${esc(feedbackEnvironmentSummary())}</p>
              <p>不会上传任务数据库、任务标题或内容、笔记、本地文件、Cookie、密码、Token、完整用户目录路径、日志或附件。</p>
            </div>
            <label class="feedback-confirm ${errors.confirmed ? "has-error" : ""}">
              <input type="checkbox" data-feedback-field="confirmed" ${draft.confirmed ? "checked" : ""} />
              <span>我已检查反馈内容，并确认其中不含敏感信息。反馈会作为公开 GitHub Issue 提交。</span>
            </label>
            ${fieldError("confirmed")}
            ${state.feedbackMessage ? `<div class="feedback-message" role="alert">${esc(state.feedbackMessage)}</div>` : ""}
            <footer class="feedback-actions">
              <button type="button" data-action="close-feedback" ${state.feedbackSubmitting ? "disabled" : ""}>取消</button>
              <button class="primary" type="submit" ${state.feedbackSubmitting ? "disabled" : ""}>${state.feedbackSubmitting ? "正在提交…" : "提交反馈"}</button>
            </footer>
          </form>
        `}
      </section>
    </div>
  `;
}

function renderBugReportSuccess() {
  const result = state.feedbackResult;
  return `
    <div class="feedback-success" role="status" aria-live="polite">
      <span class="feedback-success-mark" aria-hidden="true">✓</span>
      <p>反馈提交成功</p>
      <strong>${esc(result.reportId)}</strong>
      ${result.issueNumber ? `<p>GitHub Issue：${result.issueUrl ? `<a href="${escAttr(result.issueUrl)}">#${result.issueNumber}</a>` : `#${result.issueNumber}`}</p>` : ""}
      <button type="button" data-action="close-feedback">完成</button>
    </div>
  `;
}

function feedbackEnvironmentSummary() {
  const osName = desktopEnvironment.os || "浏览器预览环境";
  const architecture = desktopEnvironment.architecture || "未知架构";
  return `将发送：软件版本 ${APP_VERSION || "dev"}、${osName}、${architecture}、当前模块、提交时间和随机安装标识。`;
}


// ============================================================
// DEADLINE CALENDAR
// ============================================================
function ensureCalendarState() {
  const todayKey = loopTodayKey();
  if (!normalizeTaskDateFilter(state.calendarSelectedDate)) state.calendarSelectedDate = todayKey;
  if (!normalizeTaskDateFilter(state.calendarMonth)) state.calendarMonth = `${state.calendarSelectedDate.slice(0, 7)}-01`;
}

function calendarMonthDate() {
  ensureCalendarState();
  return parseDateInput(state.calendarMonth) || loopNow();
}

function calendarGridDates(month = calendarMonthDate()) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

function calendarTasksForDate(dateKey) {
  const normalized = normalizeTaskDateFilter(dateKey);
  if (!normalized) return [];
  return state.tasks
    .filter((task) => localDateKey(task.deadlineAt) === normalized)
    .sort(compareTasksByDeadline);
}

function calendarMonthTitle(month = calendarMonthDate()) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(month);
}

function calendarAgendaTitle(dateKey) {
  const date = parseDateInput(dateKey);
  if (!date) return "选择日期";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(date);
}

function renderCalendarCell(date, month, at = loopNow()) {
  const dateKey = localDateKey(date);
  const tasks = calendarTasksForDate(dateKey);
  const pending = tasks.filter((task) => task.status !== "done");
  const overdue = pending.some((task) => safeDate(task.deadlineAt) < at);
  const classes = [
    "calendar-day",
    date.getMonth() !== month.getMonth() ? "outside" : "",
    dateKey === localDateKey(at) ? "today" : "",
    dateKey === state.calendarSelectedDate ? "selected" : "",
    overdue ? "has-overdue" : "",
  ].filter(Boolean).join(" ");
  return `
    <button class="${classes}" type="button" data-action="select-calendar-date" data-date="${dateKey}" aria-label="${dateKey}${tasks.length ? `，${tasks.length} 项任务截止` : "，无截止任务"}">
      <span>${date.getDate()}</span>
      ${tasks.length ? `<span class="calendar-task-count ${overdue ? "has-overdue" : ""}">${tasks.length} 项任务</span>` : ""}
    </button>
  `;
}

function renderCalendarAgendaTask(task) {
  const deadline = safeDate(task.deadlineAt);
  const status = taskDeadlineStatus(task);
  const group = state.taskGroups.find((item) => item.id === task.groupId);
  return `
    <button class="calendar-agenda-task ${status}" type="button" data-action="open-calendar-task" data-task-id="${escAttr(task.id)}">
      <span class="calendar-agenda-time">${deadline ? `${String(deadline.getHours()).padStart(2, "0")}:${String(deadline.getMinutes()).padStart(2, "0")}` : "--:--"}</span>
      <span><strong>${esc(task.title || "未命名任务")}</strong><small>${esc(group?.title || "未分组")} · ${task.status === "done" ? "已完成" : status === "overdue" ? "已逾期" : `${priorityLabels[task.priority]}优先`}</small></span>
    </button>
  `;
}

function renderCalendarPanel() {
  ensureCalendarState();
  const month = calendarMonthDate();
  const agendaTasks = calendarTasksForDate(state.calendarSelectedDate);
  return `
    <section class="calendar-page" aria-labelledby="calendar-title">
      <header class="calendar-page-head">
        <div class="calendar-page-title">
          <div class="calendar-month-navigation" aria-label="切换月份">
            <button type="button" data-action="shift-calendar-month" data-direction="-1" aria-label="上个月">${briefFieldIcon("chevron-left", "calendar-nav-icon")}</button>
            <span>${esc(calendarMonthTitle(month))}</span>
            <button type="button" data-action="shift-calendar-month" data-direction="1" aria-label="下个月">${briefFieldIcon("chevron-right", "calendar-nav-icon")}</button>
          </div>
          <h1 id="calendar-title">日历</h1>
        </div>
        <button class="calendar-today-button" type="button" data-action="calendar-today">回到今天</button>
      </header>
      <div class="calendar-page-body">
        <section class="calendar-month" aria-label="月历">
          <div class="calendar-weekdays" aria-hidden="true">${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<span>${day}</span>`).join("")}</div>
          <div class="calendar-grid">${calendarGridDates(month).map((date) => renderCalendarCell(date, month)).join("")}</div>
        </section>
        <aside class="calendar-agenda" aria-label="选中日期的截止任务">
          <header>
            <div><span>选中日期</span><strong>${esc(calendarAgendaTitle(state.calendarSelectedDate))}</strong></div>
            <button type="button" data-action="apply-calendar-date" ${agendaTasks.length ? "" : "disabled"}>在任务中查看</button>
          </header>
          <div class="calendar-agenda-list">
            ${agendaTasks.length ? agendaTasks.map(renderCalendarAgendaTask).join("") : `<div class="calendar-agenda-empty">这一天没有设置截止时间的任务。</div>`}
          </div>
        </aside>
      </div>
    </section>
  `;
}

// ============================================================
// REVIEW PANEL
// ============================================================
function renderReviewPanel() {
  const range = reviewRange();
  const items = reviewTasks(range);
  return `
    <div class="review-overlay" role="presentation">
      <section class="review-panel" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <header class="review-head">
          <div>
            <span>Task Review</span>
            <h2 id="review-title">任务回顾</h2>
          </div>
          <button class="settings-close" type="button" data-action="close-review" title="关闭">×</button>
        </header>
        <div class="review-controls">
          <div class="review-segment" aria-label="时间范围">
            ${Object.entries(reviewPresetLabels)
              .map(([preset, label]) => `<button class="${state.reviewPreset === preset ? "active" : ""}" type="button" data-action="set-review-preset" data-preset="${preset}">${label}</button>`)
              .join("")}
          </div>
          <label class="review-field">
            <span>按</span>
            ${selectReviewDateField()}
          </label>
          ${state.reviewPreset === "custom" ? renderReviewDateRangeFields() : ""}
        </div>
        <div class="review-summary">
          <strong>${items.length}</strong>
          <span>${range.label}</span>
        </div>
        <div class="review-list">
          ${
            items.length
              ? items.map((item) => renderReviewItem(item)).join("")
              : `<div class="review-empty">这个范围内没有匹配任务。</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderReviewDateRangeFields() {
  return `
    <div class="review-date-range" aria-label="自定义日期范围">
      <label>
        <span>从</span>
        <input type="date" data-review-date-bound="start" value="${escAttr(state.reviewStartDate)}" />
      </label>
      <label>
        <span>到</span>
        <input type="date" data-review-date-bound="end" value="${escAttr(state.reviewEndDate)}" />
      </label>
    </div>
  `;
}

function selectReviewDateField() {
  return `
    <select data-review-date-field>
      ${Object.entries(reviewDateFieldLabels)
        .map(([value, label]) => `<option value="${value}" ${state.reviewDateField === value ? "selected" : ""}>${label}</option>`)
        .join("")}
    </select>
  `;
}

function renderReviewItem({ task, date }) {
  const group = state.taskGroups.find((item) => item.id === task.groupId);
  const summary = taskSummary(task);
  return `
    <article class="review-item" role="button" tabindex="0" data-action="open-review-task" data-task-id="${escAttr(task.id)}">
      <div>
        <strong>${esc(task.title || "未命名任务")}</strong>
        <p>${esc((task.conclusion || task.hypothesis || task.description || "").trim() || "没有摘要")}</p>
      </div>
      <aside>
        <span>${esc(group?.title || "默认")}</span>
        <span>${reviewDateText(date)}</span>
        <span>${summary.done}/${summary.total || 0} 节点</span>
      </aside>
    </article>
  `;
}

function reviewTasks(range = reviewRange()) {
  if (range.error) return [];
  return state.tasks
    .map((task) => ({ task, date: taskReviewDate(task, state.reviewDateField) }))
    .filter((item) => item.date && isWithinRange(item.date, range))
    .sort((a, b) => b.date.getTime() - a.date.getTime() || a.task.order - b.task.order);
}

function taskReviewDate(task, field) {
  if (field === "created") return safeDate(task.createdAt);
  if (field === "resolved") return task.status === "done" ? safeDate(task.resolvedAt || task.updatedAt) : null;
  return safeDate(latestTaskTime(task) || task.updatedAt);
}

function reviewRange() {
  const nowDate = loopNow();
  if (state.reviewPreset === "all") return { start: null, end: null, label: "全部任务" };
  if (state.reviewPreset === "custom") return customReviewRange();
  if (state.reviewPreset === "year") {
    const start = new Date(nowDate.getFullYear(), 0, 1);
    const end = new Date(nowDate.getFullYear() + 1, 0, 1);
    return { start, end, label: `${nowDate.getFullYear()} 年` };
  }
  if (state.reviewPreset === "month") {
    const start = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
    const end = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1);
    return { start, end, label: `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}` };
  }
  const { start, end } = reviewWeekRange();
  return { start, end, label: "本周" };
}

function customReviewRange() {
  const start = parseDateInput(state.reviewStartDate);
  const rawEnd = parseDateInput(state.reviewEndDate);
  const end = rawEnd ? new Date(rawEnd.getFullYear(), rawEnd.getMonth(), rawEnd.getDate() + 1) : null;
  const startText = state.reviewStartDate || "开始";
  const endText = state.reviewEndDate || "结束";
  const error = !start || !rawEnd || start > rawEnd;
  return { start, end, error, label: `${startText} - ${endText}` };
}

function ensureReviewCustomDates() {
  if (state.reviewStartDate && state.reviewEndDate) return;
  const weeklyRange = reviewWeekRange();
  if (!state.reviewStartDate) state.reviewStartDate = dateInputValue(weeklyRange.start);
  if (!state.reviewEndDate) {
    const inclusiveEnd = new Date(weeklyRange.end.getFullYear(), weeklyRange.end.getMonth(), weeklyRange.end.getDate() - 1);
    state.reviewEndDate = dateInputValue(inclusiveEnd);
  }
}

function reviewWeekRange() {
  const nowDate = loopNow();
  const day = nowDate.getDay() || 7;
  const start = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - day + 1);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start, end };
}

function dateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isWithinRange(date, range) {
  if (!date) return false;
  if (range.start && date < range.start) return false;
  if (range.end && date >= range.end) return false;
  return true;
}

function parseDateInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function safeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function reviewDateText(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);
}

function settingsSelectHtml(key, value, options) {
  return `
    <select data-setting="${key}">
      ${Object.entries(options)
        .map(([optionValue, label]) => `<option value="${optionValue}" ${optionValue === value ? "selected" : ""}>${label}</option>`)
        .join("")}
    </select>
  `;
}

function settingsOptionGroup(key, value, options) {
  return `
    <div class="settings-options">
      ${Object.entries(options)
        .map(
          ([optionValue, label]) => `
            <button class="${optionValue === value ? "active" : ""}" type="button" data-setting-button="${key}" data-value="${optionValue}">
              <span>${label}</span>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}


// ============================================================
// DRAG & DROP (tasks, groups)
// ============================================================
const taskLongPressDelay = 320;
const taskLongPressMoveTolerance = 8;
const flowNodeLongPressDelay = 180;
const flowNodeLongPressMoveTolerance = 8;

function taskDropPlacement(targetItem, clientY) {
  const bounds = targetItem.getBoundingClientRect();
  return clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

function clearTaskDropIndicators() {
  document.querySelectorAll(".task-item.drag-over, .task-item.drag-over-before, .task-item.drag-over-after").forEach((item) => {
    item.classList.remove("drag-over", "drag-over-before", "drag-over-after");
    delete item.dataset.dropPlacement;
  });
}

function activateTaskPointerDrag() {
  if (!taskDragState || taskDragState.active) return;
  taskDragState.active = true;
  taskDragState.sourceItem.classList.add("dragging");
  taskDragState.sourceItem.setPointerCapture?.(taskDragState.pointerId);
  document.body.classList.add("task-reordering");
  document.activeElement?.blur?.();
}

function beginTaskPointerDrag(event, sourceItem, immediate = false) {
  if (event.button !== 0 || !sourceItem) return;
  if (taskDragState) finishTaskPointerDrag();
  taskDragState = {
    sourceId: sourceItem.dataset.taskId,
    sourceItem,
    targetId: "",
    targetPlacement: "before",
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    timer: 0,
  };
  if (immediate) {
    event.preventDefault();
    event.stopPropagation();
    activateTaskPointerDrag();
  } else {
    taskDragState.timer = window.setTimeout(activateTaskPointerDrag, taskLongPressDelay);
  }
  document.addEventListener("pointermove", updateTaskPointerDrag, { passive: false });
  document.addEventListener("pointerup", finishTaskPointerDrag, { once: true });
  document.addEventListener("pointercancel", finishTaskPointerDrag, { once: true });
}

function startTaskLongPress(event) {
  if (event.target.closest(".task-check, input, textarea, select, button, [contenteditable]")) return;
  beginTaskPointerDrag(event, event.currentTarget, false);
}

function updateTaskPointerDrag(event) {
  if (!taskDragState) return;
  if (!taskDragState.active) {
    const distance = Math.hypot(event.clientX - taskDragState.startX, event.clientY - taskDragState.startY);
    if (distance > taskLongPressMoveTolerance) finishTaskPointerDrag();
    return;
  }
  event.preventDefault();
  const targetItem = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-task-drag-target]");
  clearTaskDropIndicators();
  if (!targetItem || targetItem.dataset.taskId === taskDragState.sourceId) {
    taskDragState.targetId = "";
    return;
  }
  taskDragState.targetId = targetItem.dataset.taskId;
  taskDragState.targetPlacement = taskDropPlacement(targetItem, event.clientY);
  targetItem.classList.add("drag-over", `drag-over-${taskDragState.targetPlacement}`);
}

function finishTaskPointerDrag() {
  if (!taskDragState) return;
  const { sourceId, targetId, targetPlacement, active, timer } = taskDragState;
  if (timer) window.clearTimeout(timer);
  taskDragState.sourceItem?.classList.remove("dragging");
  document.body.classList.remove("task-reordering");
  document.removeEventListener("pointermove", updateTaskPointerDrag);
  document.removeEventListener("pointerup", finishTaskPointerDrag);
  document.removeEventListener("pointercancel", finishTaskPointerDrag);
  clearTaskDropIndicators();
  taskDragState = null;
  if (active) suppressTaskClickUntil = Date.now() + 500;
  if (active && targetId) {
    reorderTasks(sourceId, targetId, targetPlacement);
    render();
  }
}

function flowNodeDropPlacement(targetRow, clientY) {
  const bounds = targetRow.getBoundingClientRect();
  const ratio = bounds.height > 0 ? (clientY - bounds.top) / bounds.height : 0.5;
  // Favor the common operation (sibling reordering). The deliberately smaller
  // middle band is the only place that changes hierarchy.
  if (ratio < 0.36) return "before";
  if (ratio > 0.64) return "after";
  return "inside";
}

function flowNodeDropFeedback(targetRow, placement) {
  const targetDepth = Math.max(0, Number(targetRow?.closest?.(".flow-outline-node, .flow-item")?.dataset.flowDepth) || 0);
  const targetTitle = targetRow?.querySelector?.(".flow-title-input")?.value?.trim()
    || targetRow?.querySelector?.(".node-title")?.textContent?.trim() || "未命名节点";
  if (placement === "inside") return `成为「${targetTitle}」的子级 · 第 ${targetDepth + 2} 层`;
  return `同级排序，不改变层级 · 放到「${targetTitle}」${placement === "before" ? "之前" : "之后"} · 第 ${targetDepth + 1} 层`;
}

function ensureFlowNodeDropGuide() {
  let guide = document.querySelector("[data-flow-drop-guide]");
  if (guide) return guide;
  guide = document.createElement("div");
  guide.className = "flow-node-drop-guide";
  guide.dataset.flowDropGuide = "";
  guide.setAttribute("role", "status");
  guide.setAttribute("aria-live", "polite");
  document.body.appendChild(guide);
  return guide;
}

function updateFlowNodeDropGuide(label, placement, clientX, clientY) {
  const guide = ensureFlowNodeDropGuide();
  guide.textContent = label;
  guide.dataset.placement = placement;
  const maxLeft = Math.max(12, window.innerWidth - guide.offsetWidth - 12);
  const maxTop = Math.max(12, window.innerHeight - guide.offsetHeight - 12);
  guide.style.left = `${Math.min(maxLeft, Math.max(12, clientX + 16))}px`;
  guide.style.top = `${Math.min(maxTop, Math.max(12, clientY + 18))}px`;
}

function updateFlowNodeDropIndicator(targetRow, placement, event) {
  clearFlowNodeDropIndicators({ keepGuide: true });
  const targetNode = targetRow.closest(".flow-outline-node, .flow-item");
  if (!targetNode) return;
  targetNode.classList.add(`node-drag-over-${placement}`);
  if (targetRow.classList.contains("flow-row")) targetRow.dataset.drop = placement;
  targetNode.dataset.flowDropLabel = flowNodeDropFeedback(targetRow, placement);
  updateFlowNodeDropGuide(targetNode.dataset.flowDropLabel, placement, event.clientX, event.clientY);
}

function autoScrollFlowDuringDrag(event) {
  const viewport = flowNodeDragState?.sourceRow?.closest?.("[data-processing-flow-scroll], .flow-scroll") || document.querySelector("[data-processing-flow-scroll], .flow-scroll");
  if (!viewport) return;
  const bounds = viewport.getBoundingClientRect();
  const edge = 42;
  if (event.clientY < bounds.top + edge) viewport.scrollTop -= 12;
  else if (event.clientY > bounds.bottom - edge) viewport.scrollTop += 12;
}

function canMoveFlowNode(taskId, sourceId, targetId = "") {
  const task = state.tasks.find((item) => item.id === taskId);
  const source = task ? findNode(task.nodes, sourceId) : null;
  if (!task || !source) return false;
  if (!targetId) return true;
  if (sourceId === targetId) return false;
  return !findNode(source.children, targetId);
}

function clearFlowNodeDropIndicators({ keepGuide = false } = {}) {
  document.querySelectorAll(".flow-row[data-drop]").forEach((row) => { delete row.dataset.drop; });
  document
    .querySelectorAll(".node-drag-over-before, .node-drag-over-inside, .node-drag-over-after")
    .forEach((node) => {
      node.classList.remove("node-drag-over-before", "node-drag-over-inside", "node-drag-over-after");
      delete node.dataset.flowDropLabel;
    });
  document.querySelectorAll(".node-drag-over-root").forEach((list) => list.classList.remove("node-drag-over-root"));
  if (!keepGuide) document.querySelector("[data-flow-drop-guide]")?.remove();
}

function clearFlowNodeDragState() {
  const dragState = flowNodeDragState;
  if (dragState?.timer) window.clearTimeout(dragState.timer);
  dragState?.sourceRow?.classList.remove("node-drag-pressing", "node-dragging");
  if (dragState?.sourceRow?.hasPointerCapture?.(dragState.pointerId)) {
    dragState.sourceRow.releasePointerCapture(dragState.pointerId);
  }
  flowNodeDragState = null;
  document.body.classList.remove("flow-node-reordering");
  document.removeEventListener("pointermove", updateFlowNodePointerDrag);
  document.removeEventListener("pointerup", finishFlowNodePointerDrag);
  document.removeEventListener("pointercancel", cancelFlowNodePointerDrag);
  document.removeEventListener("keydown", cancelFlowNodeDragOnEscape, true);
  window.removeEventListener("blur", abandonFlowNodeDrag);
  clearFlowNodeDropIndicators();
}

function beginFlowNodePointerDrag(event) {
  const sourceRow = event.currentTarget;
  const control = event.target.closest("button, select, textarea, input, a, [contenteditable]");
  if (event.button !== 0 || (control && !control.matches(".node-title"))) return;
  if (shellOverlayIsOpen?.() || state.contextMenu || state.focusNodeTitleId) return;
  const taskId = sourceRow.dataset.taskId || "";
  const nodeId = sourceRow.dataset.nodeId || "";
  if (!canMoveFlowNode(taskId, nodeId)) return;
  if (flowNodeDragState) clearFlowNodeDragState();
  flowNodeDragState = {
    taskId,
    nodeId,
    sourceRow,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    active: false,
    timer: 0,
    targetId: "",
    placement: "",
    root: false,
  };
  sourceRow.classList.add("node-drag-pressing");
  flowNodeDragState.timer = window.setTimeout(() => activateFlowNodePointerDrag(), flowNodeLongPressDelay);
  document.addEventListener("pointermove", updateFlowNodePointerDrag, { passive: false });
  document.addEventListener("pointerup", finishFlowNodePointerDrag);
  document.addEventListener("pointercancel", cancelFlowNodePointerDrag);
  document.addEventListener("keydown", cancelFlowNodeDragOnEscape, true);
  window.addEventListener("blur", abandonFlowNodeDrag);
}

function activateFlowNodePointerDrag() {
  if (!flowNodeDragState || flowNodeDragState.active) return;
  if (!flowNodeDragState.sourceRow.isConnected) { clearFlowNodeDragState(); return; }
  flowNodeDragState.active = true;
  flowNodeDragState.timer = 0;
  flowNodeDragState.sourceRow.classList.remove("node-drag-pressing");
  flowNodeDragState.sourceRow.classList.add("node-dragging");
  flowNodeDragState.sourceRow.setPointerCapture?.(flowNodeDragState.pointerId);
  document.body.classList.add("flow-node-reordering");
  document.activeElement?.blur?.();
  state.contextMenu = null;
  syncContextMenuRoot();
  updateFlowNodeDropGuide(
    "上下区域：同级排序 · 中间区域：设为子级",
    "hint",
    flowNodeDragState.lastX,
    flowNodeDragState.lastY,
  );
}

function updateFlowNodePointerDrag(event) {
  if (!flowNodeDragState || event.pointerId !== flowNodeDragState.pointerId) return;
  flowNodeDragState.lastX = event.clientX;
  flowNodeDragState.lastY = event.clientY;
  if (!flowNodeDragState.active) {
    const distance = Math.hypot(event.clientX - flowNodeDragState.startX, event.clientY - flowNodeDragState.startY);
    if (distance > flowNodeLongPressMoveTolerance) clearFlowNodeDragState();
    return;
  }
  event.preventDefault();
  autoScrollFlowDuringDrag(event);
  const hovered = document.elementFromPoint(event.clientX, event.clientY);
  const targetRow = hovered?.closest?.("[data-flow-drag-target]");
  clearFlowNodeDropIndicators({ keepGuide: true });
  flowNodeDragState.targetId = "";
  flowNodeDragState.placement = "";
  flowNodeDragState.root = false;

  if (targetRow && targetRow.dataset.taskId === flowNodeDragState.taskId) {
    const targetId = targetRow.dataset.nodeId || "";
    if (!canMoveFlowNode(flowNodeDragState.taskId, flowNodeDragState.nodeId, targetId)) {
      updateFlowNodeDropGuide("不能移动到自身或自己的子节点中", "invalid", event.clientX, event.clientY);
      return;
    }
    const placement = flowNodeDropPlacement(targetRow, event.clientY);
    flowNodeDragState.targetId = targetId;
    flowNodeDragState.placement = placement;
    updateFlowNodeDropIndicator(targetRow, placement, event);
    return;
  }

  const viewport = flowNodeDragState.sourceRow.closest("[data-processing-flow-scroll], .flow-scroll");
  if (viewport && hovered && viewport.contains(hovered)) {
    flowNodeDragState.root = true;
    viewport.classList.add("node-drag-over-root");
    updateFlowNodeDropGuide("移到顶层末尾 · 第 1 层", "root", event.clientX, event.clientY);
  }
}

function finishFlowNodePointerDrag(event) {
  if (!flowNodeDragState || event.pointerId !== flowNodeDragState.pointerId) return;
  const { taskId, nodeId, targetId, placement, root, active } = flowNodeDragState;
  if (active) event.preventDefault();
  clearFlowNodeDragState();
  if (!active) return;
  suppressFlowNodeClickUntil = Date.now() + 450;
  const moved = targetId && placement
    ? moveFlowNode(taskId, nodeId, targetId, placement)
    : root && moveFlowNode(taskId, nodeId, "", "root");
  if (moved) render();
}

function cancelFlowNodePointerDrag(event) {
  if (!flowNodeDragState || event.pointerId !== flowNodeDragState.pointerId) return;
  if (flowNodeDragState.active) suppressFlowNodeClickUntil = Date.now() + 450;
  clearFlowNodeDragState();
}

function abandonFlowNodeDrag() {
  if (flowNodeDragState?.active) suppressFlowNodeClickUntil = Date.now() + 450;
  clearFlowNodeDragState();
}

function cancelFlowNodeDragOnEscape(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  abandonFlowNodeDrag();
}

function bindFlowNodeDragAndDrop() {
  document.querySelectorAll("[data-flow-drag-source]").forEach((sourceRow) => {
    if (!bindRenderElement(sourceRow, "flow-drag")) return;
    sourceRow.addEventListener("pointerdown", beginFlowNodePointerDrag);
  });
  if (document.__loopNodeTitleClicksBound) return;
  document.__loopNodeTitleClicksBound = true;
  // Opening details can resize the flow and replace the first click's title.
  // Keep the gesture on the document so the second click survives that redraw.
  document.addEventListener("click", (event) => {
    if (!event.detail) { flowNodeLastTitleClick = null; return; }
    let title = event.target.closest?.(".node-title");
    const previous = flowNodeLastTitleClick;
    const stamp = Date.now();
    const sameGesture = previous && stamp - previous.stamp <= 500
      && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 6;
    if (sameGesture && !shellOverlayIsOpen() && (!title
      || title.dataset.nodeId !== previous.nodeId || title.dataset.taskId !== previous.taskId)) {
      title = [...document.querySelectorAll(".node-title")].find((item) =>
        item.dataset.nodeId === previous.nodeId && item.dataset.taskId === previous.taskId);
    }
    if (!title) { flowNodeLastTitleClick = null; return; }
    if (Date.now() < suppressFlowNodeClickUntil) {
      event.preventDefault(); event.stopImmediatePropagation();
      flowNodeLastTitleClick = null; return;
    }
    const doubleClick = sameGesture && previous.taskId === title.dataset.taskId
      && previous.nodeId === title.dataset.nodeId;
    flowNodeLastTitleClick = { taskId: title.dataset.taskId, nodeId: title.dataset.nodeId,
      stamp, x: event.clientX, y: event.clientY };
    if (!doubleClick) return;
    event.preventDefault(); event.stopImmediatePropagation();
    flowNodeLastTitleClick = null;
    shellStartNodeTitleEdit(title);
  }, true);
}

const renderElementBindings = new WeakMap();
function bindRenderElement(element, binding) {
  if (!element) return false;
  const bindings = renderElementBindings.get(element) || new Set();
  if (bindings.has(binding)) return false;
  bindings.add(binding); renderElementBindings.set(element, bindings); return true;
}


// ============================================================
// EVENT BINDING -- bind() called after every render
// ============================================================
/**
 * Bind all DOM events after render.
 * Called once after every innerHTML rebuild.
 * Uses data-* attributes for event delegation:
 *   [data-action] for commands, [data-edit-key] for edits,
 *   [data-setting] for preferences, [data-context] for right-click.
 */
function bind() {
  return bindTaskRepositoryRows(document);
}

function bindTaskRepositoryRows(scope = document) {
  const repositoryFilterMenu = scope.querySelector?.(".repository-filter-menu");
  repositoryFilterMenu?.addEventListener("toggle", () => {
    repositoryFilterMenuOpen = repositoryFilterMenu.open;
    if (!repositoryFilterMenu.open) repositoryPriorityFilterOpen = false;
  });
  scope.querySelector?.(".repository-priority-menu")?.addEventListener("toggle", (event) => {
    repositoryPriorityFilterOpen = event.currentTarget.open;
  });

  scope.querySelectorAll(".task-item[data-task-id]").forEach((element) => {
    // Reusing a list region across renders means this runs again over live
    // nodes. Bound markers keep selection and drag handlers single-shot so a
    // reused row cannot accumulate duplicate listeners.
    if (element.dataset.rowSelectionBound === "1") return;
    element.dataset.rowSelectionBound = "1";
    element.addEventListener("pointerdown", (event) => {
      startTaskLongPress(event);
      const select = event.target.closest("select");
      if (event.button !== 0 || !select || !activateRepositoryTask(element.dataset.taskId)) return;
      syncRepositoryTaskSelection();

      // Do not rebuild the DOM while a native select menu is open. Its change
      // handler persists the value first; blur also covers dismissing the menu.
      let rendered = false;
      const renderSelection = () => {
        if (rendered) return;
        rendered = true;
        window.requestAnimationFrame(() => render());
      };
      select.addEventListener("change", renderSelection, { once: true });
      select.addEventListener("blur", renderSelection, { once: true });
    });
    element.addEventListener(
      "click",
      (event) => {
        if (Date.now() < suppressTaskClickUntil) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (!activateRepositoryTask(element.dataset.taskId)) return;
        syncRepositoryTaskSelection();

        // Controls inside a repository row keep their original behavior, but
        // selecting the row must happen first. Action buttons render after
        // their command runs; title inputs need focus restored after render.
        if (event.target.closest("[data-action]")) return;
        if (event.target.closest(".task-title")) state.focusTaskTitleId = element.dataset.taskId;
        window.requestAnimationFrame(() => render());
      },
      true,
    );
  });

  if (scope !== document) {
    scope.querySelectorAll(".task-item[data-task-id]").forEach((element) => {
      element.addEventListener("dragstart", (event) => {
        if (event.target.closest(".task-check, input, textarea, select, button, [contenteditable]")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", element.dataset.taskId);
        element.classList.add("dragging");
      });
      element.addEventListener("dragend", () => {
        element.classList.remove("dragging");
        clearTaskDropIndicators();
      });
      element.addEventListener("dragover", (event) => {
        const hasTaskDrag = Array.from(event.dataTransfer.types || []).includes("text/plain");
        if (!hasTaskDrag) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        clearTaskDropIndicators();
        const placement = taskDropPlacement(element, event.clientY);
        element.dataset.dropPlacement = placement;
        element.classList.add("drag-over", `drag-over-${placement}`);
      });
      element.addEventListener("dragleave", () => {
        element.classList.remove("drag-over", "drag-over-before", "drag-over-after");
        delete element.dataset.dropPlacement;
      });
      element.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const placement = element.dataset.dropPlacement || taskDropPlacement(element, event.clientY);
        clearTaskDropIndicators();
        reorderTasks(event.dataTransfer.getData("text/plain"), element.dataset.taskId, placement);
        render();
      });
      element.querySelectorAll("[data-action]").forEach((control) => {
        control.addEventListener("click", (event) => {
          event.stopPropagation();
          action(control.dataset, event);
        });
      });
      // Phase21 brief inputs own their lifecycle: this legacy binding also
      // re-rendered the repository on the change event that fires when the field
      // loses focus.
      element.querySelectorAll("[data-edit-key]:not(.brief21-input)").forEach((control) => {
        control.addEventListener("input", (event) => edit(event.target.dataset, event.target.value));
        control.addEventListener("change", (event) => {
          edit(event.target.dataset, event.target.value);
          refreshTaskRepository();
        });
        control.addEventListener("click", (event) => event.stopPropagation());
      });
      element.addEventListener("contextmenu", (event) => {
        openTaskContextMenu(element.dataset.taskId, event, element);
      });
      element.addEventListener("keydown", (event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) openTaskContextMenu(element.dataset.taskId, event, element);
      });
    });
    return;
  }

  document.querySelectorAll(".task-item[data-task-id]").forEach((element) => {
    if (element.dataset.rowDragBound === "1") return;
    element.dataset.rowDragBound = "1";
    element.addEventListener("dragstart", (event) => {
      if (event.target.closest(".task-check, input, textarea, select, button, [contenteditable]")) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", element.dataset.taskId);
      element.classList.add("dragging");
    });
    element.addEventListener("dragend", () => {
      element.classList.remove("dragging");
      clearTaskDropIndicators();
    });
  });

  document.querySelectorAll("[data-task-drag-target]").forEach((element) => {
    if (element.dataset.taskDropBound === "1") return;
    element.dataset.taskDropBound = "1";
    element.addEventListener("dragover", (event) => {
      const hasTaskDrag = Array.from(event.dataTransfer.types || []).includes("text/plain");
      if (!hasTaskDrag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      clearTaskDropIndicators();
      const placement = taskDropPlacement(element, event.clientY);
      element.dataset.dropPlacement = placement;
      element.classList.add("drag-over", `drag-over-${placement}`);
    });
    element.addEventListener("dragleave", () => {
      element.classList.remove("drag-over", "drag-over-before", "drag-over-after");
      delete element.dataset.dropPlacement;
    });
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const placement = element.dataset.dropPlacement || taskDropPlacement(element, event.clientY);
      clearTaskDropIndicators();
      reorderTasks(event.dataTransfer.getData("text/plain"), element.dataset.taskId, placement);
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((element) => {
    // Reused regions keep their nodes, so this loop revisits buttons that
    // already have the handler. Binding again would run the action twice, and a
    // toggling action (calendar, review, theme) would then cancel itself out -
    // the button would appear dead. Other handlers bind these elements too, so
    // "actionBound" cannot be the guard: use a key only this binder sets.
    if (element.dataset.actionClickBound === "1") return;
    element.dataset.actionClickBound = "1";
    element.dataset.actionBound = "1";
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      action(element.dataset, event);
    });
    if (element.getAttribute("role") === "button") {
      element.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        action(element.dataset, event);
      });
    }
  });

  document.querySelectorAll(".sheet-tab:not(.sheet-tab-all)").forEach((element) => {
    if (!bindRenderElement(element, 'base:.sheet-tab:not(.sheet-tab-all)')) return;
    element.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startRenameGroup(element.dataset.groupId);
      render();
    });
  });

  document.querySelectorAll("[data-group-title]").forEach((element) => {
    if (element.dataset.groupTitleBound === "1") return;
    element.dataset.groupTitleBound = "1";
    element.addEventListener("click", (event) => event.stopPropagation());
    element.addEventListener("input", (event) => renameGroup(event.target.dataset.groupTitle, event.target.value, false));
    element.addEventListener("blur", (event) => {
      renameGroup(event.target.dataset.groupTitle, event.target.value, true);
      if (event.relatedTarget?.closest?.(".task-title, .page-title")) return;
      render();
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        renameGroup(event.target.dataset.groupTitle, event.target.value, true);
        render();
      }
      if (event.key === "Escape") {
        state.editingGroupId = "";
        render();
      }
    });
  });

  document.querySelectorAll(".sheet-tab-wrap").forEach((element) => {
    if (!bindRenderElement(element, 'base:.sheet-tab-wrap')) return;
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const x = Math.min(event.clientX, window.innerWidth - 210);
      const y = Math.min(event.clientY, window.innerHeight - 245);
      state.contextMenu = {
        kind: "group",
        groupId: element.dataset.groupId,
        x,
        y,
      };
      syncContextMenuRoot();
    });
    element.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", element.dataset.groupId);
      element.classList.add("dragging");
    });
    element.addEventListener("dragend", () => element.classList.remove("dragging"));
    element.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      reorderGroups(event.dataTransfer.getData("text/plain"), element.dataset.groupId);
      render();
    });
  });

  const groupScroller = document.querySelector("[data-sheet-tabs]");
  groupScroller?.addEventListener(
    "wheel",
    (event) => {
      if (groupScroller.scrollWidth <= groupScroller.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      groupScroller.scrollLeft += delta;
    },
    { passive: false },
  );

  const repositoryGroupSearch = document.querySelector(".repository-group-search input");
  if (repositoryGroupSearch) {
    repositoryGroupSearch.addEventListener("input", (event) => {
      repositoryGroupQuery = event.target.value;
      const options = document.querySelector(".repository-group-options");
      if (options) {
        options.innerHTML = renderRepositoryGroupOptions();
      }
    });
    repositoryGroupSearch.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        repositoryGroupPickerOpen = false;
        repositoryGroupQuery = "";
        render();
      }
      if (event.key === "Enter") {
        const first = document.querySelector(".repository-group-option.is-highlighted") || document.querySelector(".repository-group-option");
        if (first) {
          event.preventDefault();
          action(first.dataset, event);
        }
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const options = [...document.querySelectorAll(".repository-group-option")];
        if (!options.length) return;
        const highlighted = options.findIndex((option) => option.classList.contains("is-highlighted"));
        const nextIndex = highlighted < 0 ? 0 : (highlighted + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options.forEach((option, index) => option.classList.toggle("is-highlighted", index === nextIndex));
      }
    });
  }


  // Phase21's brief inputs carry data-edit-key for compatibility with the code
  // that locates a field by key, but they own their editing lifecycle: the
  // legacy binding re-rendered on blur and swallowed the next click.
  document.querySelectorAll("[data-edit-key]:not(.brief21-input)").forEach((element) => {
    if (!bindRenderElement(element, 'base:[data-edit-key]:not(.brief21-input)')) return;
    element.addEventListener("input", (event) => {
      edit(event.target.dataset, event.target.value);
      if (event.target.closest(".task-brief")) resizeTaskBriefTextarea(event.target);
    });
    element.addEventListener("change", (event) => edit(event.target.dataset, event.target.value));
    element.addEventListener("change", (event) => {
      if (event.target.dataset.editKey === "groupId") render();
      if (event.target.dataset.editKey === "status") render();
    });
    element.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    element.addEventListener("blur", (event) => {
      if (!event.relatedTarget && !appEditingPointerDown && captureAppSwitchEditingFocus(event.target)) return;
      if (event.target.classList.contains("markdown-editor")) {
        storeMarkdownSelection(event.target, !event.relatedTarget);
        if (!event.relatedTarget) return;
      }
      if (event.relatedTarget?.closest?.("[data-action], .sheet-bar, .node-detail, .task-page")) return;
      render();
    });
  });

  document.querySelectorAll("[data-context]").forEach((element) => {
    if (!bindRenderElement(element, 'base:[data-context]')) return;
    if (element.dataset.context === "flow-root") return;
    element.addEventListener("contextmenu", (event) => {
      // Editable titles keep their native text menu; rows own their menus.
      if (element.dataset.context === "task-list" && event.target.closest(".task-item, input, textarea, select, button, [contenteditable]")) return;
      if (element.dataset.context === "task") {
        openTaskContextMenu(element.dataset.taskId, event, element);
        return;
      }
      if (element.dataset.context === "node") {
        openNodeContextMenu(element.dataset.taskId, element.dataset.nodeId, event, element);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      taskContextMenuReturnFocus = null;
      state.contextMenu = {
        kind: element.dataset.context,
        taskId: element.dataset.taskId,
        nodeId: element.dataset.nodeId || "",
        x: event.clientX,
        y: event.clientY,
      };
      syncContextMenuRoot();
    });
    if (element.dataset.context === "task") element.addEventListener("keydown", (event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) openTaskContextMenu(element.dataset.taskId, event, element);
    });
    if (element.dataset.context === "node") element.addEventListener("keydown", (event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) openNodeContextMenu(element.dataset.taskId, element.dataset.nodeId, event, element);
    });
  });

  document.querySelectorAll('[data-context="flow-root"]').forEach((element) => {
    if (!bindRenderElement(element, 'base:[data-context="flow-root"]')) return;
    element.addEventListener("contextmenu", (event) => {
      if (event.target.closest('[data-context="node"], input, textarea, select, button, [contenteditable]')) return;
      if (!state.tasks.some((task) => task.id === element.dataset.taskId)) return;
      event.preventDefault();
      event.stopPropagation();
      taskContextMenuReturnFocus = null;
      state.contextMenu = { kind: "flow-root", taskId: element.dataset.taskId, nodeId: "", x: event.clientX, y: event.clientY };
      // Opening the menu must preserve the selected node, draft and scroll.
      syncContextMenuRoot();
    });
  });

  const newTaskPriority = document.querySelector("[data-new-task-priority]");
  if (newTaskPriority) {
    newTaskPriority.addEventListener("change", (event) => {
      state.newTaskPriority = event.target.value;
    });
    newTaskPriority.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  }

  const newTaskTitle = document.querySelector("[data-new-task-title]");
  if (newTaskTitle) {
    newTaskTitle.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    newTaskTitle.addEventListener("blur", (event) => createTaskFromBlank(event.target.value));
    newTaskTitle.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const title = event.target.value;
        event.target.value = "";
        createTaskFromBlank(title);
      }
    });
  }

  const taskList = document.querySelector('.task-list[data-context="task-list"]');
  taskList?.addEventListener("dblclick", (event) => {
    if (event.target.closest(".task-row, .task-list-head, button, input, select")) return;
    event.preventDefault();
    addBlankTask();
    render();
  });

  const taskCreateHint = document.querySelector("[data-task-create-hint]");
  taskCreateHint?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    addBlankTask();
    render();
  });

  document.querySelectorAll("[data-setting]").forEach((element) => {
    if (!bindRenderElement(element, 'base:[data-setting]')) return;
    element.addEventListener("click", (event) => event.stopPropagation());
    element.addEventListener("change", (event) => {
      if (event.target.dataset.setting === "theme") state.theme = normalizeTheme(event.target.value);
      if (event.target.dataset.setting === "zh-font") state.zhFont = normalizeZhFont(event.target.value);
      if (event.target.dataset.setting === "en-font") state.enFont = normalizeEnFont(event.target.value);
      if (event.target.dataset.setting === "font-scale") state.fontScale = normalizeFontScale(event.target.value);
      if (event.target.dataset.setting === "task-filter") state.taskFilter = normalizeTaskFilter(event.target.value);
      if (event.target.dataset.setting === "priority-filter") state.priorityFilter = normalizePriorityFilter(event.target.value);
      if (event.target.dataset.setting === "capture-source-filter") state.captureSourceFilter = normalizeCaptureSourceFilter(event.target.value);
      if (event.target.dataset.setting === "new-task-priority") state.newTaskPriority = normalizePriority(event.target.value);
      save();
      render();
    });
  });

  document.querySelectorAll("[data-settings-page]").forEach((element) => {
    if (!bindRenderElement(element, 'base:[data-settings-page]')) return;
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const page = event.currentTarget.dataset.settingsPage;
      if (!["appearance", "tasks", "data", "updates", "advanced", "help"].includes(page) || page === activeSettingsPage) return;
      activeSettingsPage = page;
      settingsMotion = "page";
      render();
    });
  });

  document.querySelectorAll("[data-setting-button]").forEach((element) => {
    // Reused regions keep their nodes across renders, so this loop runs again
    // over buttons that already carry the handler. Without the guard each
    // navigation stacks another click listener, and one click then applies the
    // setting - and renders - several times.
    if (element.dataset.settingBound === "1") return;
    element.dataset.settingBound = "1";
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.currentTarget.closest(".app-navigation-rail")) {
        state.searchOpen = false;
        state.focusSearch = false;
        state.searchCursor = 0;
        state.query = "";
      }
      applySetting(event.currentTarget.dataset.settingButton, event.currentTarget.dataset.value);
      save();
      render();
    });
  });

  document.querySelectorAll("[data-deadline-reminder]").forEach((element) => {
    if (element.dataset.deadlineBound === "1") return;
    element.dataset.deadlineBound = "1";
    element.addEventListener("click", (event) => event.stopPropagation());
    element.addEventListener("change", (event) => {
      const task = state.tasks.find((item) => item.id === event.target.dataset.taskId);
      if (!task) return;
      task.deadlineReminderMinutes = event.target.value === "none"
        ? null
        : normalizeDeadlineReminderMinutes(event.target.value);
      task.updatedAt = now();
      save();
      render();
    });
  });

  document.querySelectorAll("[data-review-date-field]").forEach((element) => {
    element.addEventListener("click", (event) => event.stopPropagation());
    element.addEventListener("change", (event) => {
      state.reviewDateField = Object.hasOwn(reviewDateFieldLabels, event.target.value) ? event.target.value : "updated";
      render();
    });
  });

  document.querySelectorAll("[data-review-date-bound]").forEach((element) => {
    element.addEventListener("click", (event) => event.stopPropagation());
    element.addEventListener("change", (event) => {
      if (event.target.dataset.reviewDateBound === "start") state.reviewStartDate = event.target.value;
      if (event.target.dataset.reviewDateBound === "end") state.reviewEndDate = event.target.value;
      state.reviewPreset = "custom";
      render();
    });
  });

  const reviewPanel = document.querySelector(".review-panel");
  if (reviewPanel) {
    reviewPanel.addEventListener("click", (event) => event.stopPropagation());
  }

  const reviewOverlay = document.querySelector(".review-overlay");
  if (reviewOverlay) {
    reviewOverlay.addEventListener("click", () => {
      state.reviewOpen = false;
      render();
    });
  }

  const calendarPanel = document.querySelector(".calendar-panel");
  calendarPanel?.addEventListener("click", (event) => event.stopPropagation());

  const calendarOverlay = document.querySelector(".calendar-overlay");
  calendarOverlay?.addEventListener("click", () => {
    state.calendarOpen = false;
    render();
  });

  const settingsPanel = document.querySelector(".settings-panel");
  if (settingsPanel) {
    settingsPanel.addEventListener("click", (event) => event.stopPropagation());
  }

  const settingsOverlay = document.querySelector(".settings-overlay");
  if (settingsOverlay) {
    settingsOverlay.addEventListener("click", () => {
      state.settingsOpen = false;
      render();
    });
  }

  bindSidebarUpdateControl();
  bindUpdateSettingsControls();
  bindDataBackupControls();

  const feedbackPanel = document.querySelector(".feedback-panel");
  feedbackPanel?.addEventListener("click", (event) => event.stopPropagation());

  const feedbackBackdrop = document.querySelector("[data-feedback-backdrop]");
  feedbackBackdrop?.addEventListener("pointerdown", (event) => {
    if (event.target !== feedbackBackdrop || state.feedbackSubmitting) return;
    closeBugReport();
    render();
  });

  document.querySelectorAll("[data-feedback-field]").forEach((element) => {
    const updateDraft = (event) => {
      const key = event.target.dataset.feedbackField;
      state.feedbackDraft[key] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
      delete state.feedbackErrors[key];
      state.feedbackMessage = "";
    };
    element.addEventListener("input", updateDraft);
    element.addEventListener("change", updateDraft);
  });

  const feedbackForm = document.querySelector("[data-feedback-form]");
  feedbackForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitBugReport();
  });

  bindGooeySearch();

  const globalSearchLayer = document.querySelector("[data-global-search-layer]");
  globalSearchLayer?.addEventListener("pointerdown", (event) => {
    if (event.target !== globalSearchLayer) return;
    event.preventDefault();
    closeGlobalSearch();
  });

  const taskFilter = document.querySelector("[data-task-filter]");
  if (taskFilter) {
    taskFilter.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    taskFilter.addEventListener("change", (event) => {
      state.taskFilter = event.target.value;
      state.selectedNodeId = "";
      render();
    });
  }

  const priorityFilter = document.querySelector("[data-priority-filter]");
  if (priorityFilter) {
    priorityFilter.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    priorityFilter.addEventListener("change", (event) => {
      state.priorityFilter = event.target.value;
      state.selectedNodeId = "";
      render();
    });
  }

  const captureSourceFilter = document.querySelector("[data-capture-source-filter]");
  if (captureSourceFilter) {
    captureSourceFilter.addEventListener("click", (event) => event.stopPropagation());
    captureSourceFilter.addEventListener("change", (event) => {
      state.captureSourceFilter = normalizeCaptureSourceFilter(event.target.value);
      state.selectedNodeId = "";
      render();
    });
  }

  document.querySelectorAll("[data-recurrence-toggle]").forEach((control) => {
    if (!bindRenderElement(control, 'base:[data-recurrence-toggle]')) return;
    control.addEventListener("click", (event) => {
      event.stopPropagation();
      taskGroupSelectTaskId = "";
      deadlinePopoverTaskId = "";
      recurrencePopoverTaskId = recurrencePopoverTaskId === event.currentTarget.dataset.taskId ? "" : event.currentTarget.dataset.taskId;
      render();
    });
  });

  document.querySelectorAll("[data-recurrence-field]").forEach((control) => {
    if (!bindRenderElement(control, 'base:[data-recurrence-field]')) return;
    control.addEventListener("click", (event) => event.stopPropagation());
    control.addEventListener("change", (event) => {
      updateTaskRecurrence(event.currentTarget.dataset.taskId, event.currentTarget.dataset.recurrenceField, event.currentTarget.value);
      syncRecurringTasks(loopNow());
      render();
    });
  });

  document.querySelectorAll("[data-recurrence-mode]").forEach((control) => {
    if (!bindRenderElement(control, 'base:[data-recurrence-mode]')) return;
    control.addEventListener("click", (event) => {
      event.stopPropagation();
      updateTaskRecurrence(event.currentTarget.dataset.taskId, "frequency", event.currentTarget.dataset.recurrenceMode);
      syncRecurringTasks(loopNow());
      render();
    });
  });

  document.querySelectorAll("[data-recurrence-weekday]").forEach((control) => {
    if (!bindRenderElement(control, 'base:[data-recurrence-weekday]')) return;
    control.addEventListener("click", (event) => {
      event.stopPropagation();
      updateTaskRecurrence(event.currentTarget.dataset.taskId, "weekday", event.currentTarget.dataset.recurrenceWeekday);
      syncRecurringTasks(loopNow());
      render();
    });
  });

  bindFlowNodeDragAndDrop();

  document.querySelectorAll("[data-flow-split-resizer]").forEach((handle) => {
    if (!bindRenderElement(handle, 'base:[data-flow-split-resizer]')) return;
    handle.addEventListener("click", (event) => event.stopPropagation());
    handle.addEventListener("pointerdown", startFlowSplitResize);
    handle.addEventListener("keydown", handleFlowSplitKeydown);
  });

  document.querySelectorAll("[data-sidebar-resizer]").forEach((handle) => {
    if (!bindRenderElement(handle, 'base:[data-sidebar-resizer]')) return;
    handle.addEventListener("click", (event) => event.stopPropagation());
    handle.addEventListener("pointerdown", startSidebarResize);
  });

  document.querySelectorAll("[data-detail-resizer]").forEach((handle) => {
    if (!bindRenderElement(handle, 'base:[data-detail-resizer]')) return;
    handle.addEventListener("click", (event) => event.stopPropagation());
    handle.addEventListener("pointerdown", startDetailResize);
  });

  document.querySelectorAll(".flow-outline-row[data-flow-select]").forEach((row) => {
    if (!bindRenderElement(row, 'base:.flow-outline-row[data-flow-select]')) return;
    row.addEventListener("click", (event) => {
      if (Date.now() < suppressFlowNodeClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.target.closest("button, select, textarea")) return;
      row.querySelector(".flow-title-input")?.focus({ preventScroll: true });
    });
    row.addEventListener("dblclick", (event) => {
      if (Date.now() < suppressFlowNodeClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.target.closest("button, select, textarea")) return;
      event.preventDefault();
      selectNodeForInspector(row.dataset.taskId, row.dataset.nodeId);
      render();
    });
  });

  bindFlowTitleShortcuts();

  document.querySelectorAll(".markdown-editor").forEach((editor) => {
    if (!bindRenderElement(editor, 'base:.markdown-editor')) return;
    editor.addEventListener("paste", handleMarkdownPaste);
    editor.addEventListener("input", () => updateMarkdownEditorState(editor));
    editor.addEventListener("dragover", (event) => {
      if (hasDraggedImage(event)) {
        event.preventDefault();
        editor.closest(".markdown-panel")?.classList.add("dragging-image");
      }
    });
    editor.addEventListener("dragleave", () => {
      editor.closest(".markdown-panel")?.classList.remove("dragging-image");
    });
    editor.addEventListener("drop", handleMarkdownDrop);
    editor.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        handleMarkdownPasteShortcut(event);
      }
      if (event.key === "Tab") {
        event.preventDefault();
        insertEditorText(editor, "    ");
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        applyMarkdownTool("bold");
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
        event.preventDefault();
        applyMarkdownTool("italic");
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        applyMarkdownTool("link");
      }
    });
  });

  const recordInput = document.querySelector("[data-record-input]");
  if (recordInput && bindRenderElement(recordInput, "record-input")) {
    recordInput.addEventListener("input", (event) => {
      state.recordDraft = event.target.value;
      const taskId = event.target.dataset.taskId;
      const nodeId = event.target.dataset.nodeId;
      if (taskId && nodeId) {
        updateNodeNoteDraft(taskId, nodeId, state.recordDraft);
        const saveState = document.querySelector("[data-node-detail-save-state] b");
        if (saveState) saveState.textContent = "正在保存…";
        window.clearTimeout(nodeDetailSaveFeedbackTimer);
        nodeDetailSaveFeedbackTimer = window.setTimeout(() => {
          const currentInput = document.querySelector("[data-record-input]");
          const currentSaveState = document.querySelector("[data-node-detail-save-state] b");
          if (currentInput?.dataset.taskId === taskId && currentInput?.dataset.nodeId === nodeId && currentSaveState) {
            currentSaveState.textContent = "已自动保存";
          }
        }, 550);
      }
    });
    recordInput.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        const taskId = event.target.dataset.taskId;
        const nodeId = event.target.dataset.nodeId;
        if (taskId && nodeId) flushNodeNoteDraft(noteDraftKey(taskId, nodeId), { persist: true });
        const saveState = document.querySelector("[data-node-detail-save-state] b");
        if (saveState) saveState.textContent = "已自动保存";
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        exitNodeDetail();
        render();
      }
    });
  }

  const recordBackdrop = document.querySelector("[data-record-modal-backdrop]");
  if (bindRenderElement(recordBackdrop, "record-backdrop")) recordBackdrop.addEventListener("pointerdown", (event) => {
    if (event.target !== recordBackdrop) return;
    exitNodeDetail();
    render();
  });

  document.querySelectorAll("[data-editor-focus-target]").forEach((panel) => {
    if (!bindRenderElement(panel, 'base:[data-editor-focus-target]')) return;
    panel.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("button, input, select, textarea, a, .context-menu, .detail-actions, .ProseMirror, .markdown-editor")) return;
      window.requestAnimationFrame(() => focusKnowledgeEditor());
    });
    panel.addEventListener("contextmenu", (event) => {
      if (!panel.closest(".fullscreen-editor")) return;
      event.preventDefault();
      event.stopPropagation();
      const x = Math.min(event.clientX, window.innerWidth - 210);
      const y = Math.min(event.clientY, window.innerHeight - 245);
      state.contextMenu = {
        kind: "editor",
        taskId: panel.dataset.taskId,
        nodeId: panel.dataset.nodeId || "",
        x,
        y,
      };
      syncContextMenuRoot();
    });
  });

  const app = document.querySelector(".ops-app");
  if (app) {
    app.addEventListener("pointerdown", (event) => {
      let needsRender = false;
      document.querySelectorAll("details[open]").forEach((details) => {
        if (!details.contains(event.target)) details.removeAttribute("open");
      });
      const keepNodeDetail = event.target.closest(".node-detail, .node-detail-page, .flow-row:not(.flow-header), .context-menu, [data-action], [data-edit-key], button, input, textarea, select");
      const keepSettings = event.target.closest(".settings-overlay, .settings-trigger, .theme-toggle");
      const keepReview = event.target.closest(".review-overlay, .review-trigger");
      const keepContextMenu = event.target.closest(".context-menu");
      const keepRecurrence = event.target.closest(".task-recurrence-controls");
      const keepTaskGroup = event.target.closest(".task-group-select");
      const keepDeadline = event.target.closest(".task-deadline-picker");
      const keepRepositoryGroup = isRepositoryGroupInteraction(event.target);

      if (state.contextMenu && !keepContextMenu) {
        closeContextMenu();
      }

      if (state.settingsOpen && !keepSettings) {
        state.settingsOpen = false;
        needsRender = true;
      }

      if (state.reviewOpen && !keepReview) {
        state.reviewOpen = false;
        needsRender = true;
      }

      if (recurrencePopoverTaskId && !keepRecurrence) {
        recurrencePopoverTaskId = "";
        document.querySelector(".task-recurrence-popover")?.remove();
        document.querySelector("[data-recurrence-toggle]")?.setAttribute("aria-expanded", "false");
      }

      if (taskGroupSelectTaskId && !keepTaskGroup) {
        taskGroupSelectTaskId = "";
        document.querySelector(".task-group-select-content")?.remove();
        document.querySelector("[data-action='toggle-task-group-select']")?.setAttribute("aria-expanded", "false");
      }

      if (deadlinePopoverTaskId && !keepDeadline) {
        deadlinePopoverTaskId = "";
        document.querySelector(".task-deadline-popover")?.remove();
        document.querySelector("[data-action='toggle-deadline-picker']")?.setAttribute("aria-expanded", "false");
      }

      if (repositoryGroupPickerOpen && !keepRepositoryGroup) {
        repositoryGroupPickerOpen = false;
        repositoryGroupQuery = "";
        needsRender = true;
      }

      if (state.selectedNodeId && !keepNodeDetail && exitNodeDetail()) needsRender = true;

      if (needsRender) render();
    });
  }
}

function isRepositoryGroupInteraction(target) {
  // Group management was removed; only the picker itself still holds dismissal.
  return Boolean(target?.closest?.(".repository-group-picker"));
}

function activateRepositoryTask(taskId) {
  if (!taskId || !state.tasks.some((task) => task.id === taskId) || state.activeTaskId === taskId) return false;
  state.activeTaskId = taskId;
  state.selectedNodeId = "";
  state.recordDraft = "";
  state.nodeDetailFullscreen = false;
  state.nodeDetailPosition = null;
  return true;
}

function syncRepositoryTaskSelection() {
  document.querySelectorAll(".task-item[data-task-id]").forEach((element) => {
    const active = element.dataset.taskId === state.activeTaskId;
    element.classList.toggle("selected", active);
    element.classList.toggle("active", active);
  });
}

function resizeTaskBriefTextareas() {
  document.querySelectorAll(".task-brief textarea").forEach((element) => resizeTaskBriefTextarea(element));
}

function resizeTaskBriefTextarea(element) {
  const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight) || 20;
  const minHeight = lineHeight * 3;
  const maxHeight = lineHeight * 5;
  element.style.height = "0px";
  element.style.height = `${Math.min(maxHeight, Math.max(minHeight, element.scrollHeight))}px`;
  element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
}

function applySetting(key, value) {
  if (key === "theme") state.theme = normalizeTheme(value);
  if (key === "zh-font") state.zhFont = normalizeZhFont(value);
  if (key === "en-font") state.enFont = normalizeEnFont(value);
  if (key === "font-scale") state.fontScale = normalizeFontScale(value);
  if (key === "task-filter") {
    state.globalListReturn = null;
    state.taskFilter = normalizeTaskFilter(value);
    if (state.taskFilter === "today") state.todayFilter = "active";
    // 今日 / 任务仓库 must leave every full-width route, settings included.
    state.calendarOpen = false;
    state.reviewOpen = false;
    state.settingsOpen = false;
  }
  if (key === "priority-filter") state.priorityFilter = normalizePriorityFilter(value);
  if (key === "capture-source-filter") state.captureSourceFilter = normalizeCaptureSourceFilter(value);
  if (key === "new-task-priority") state.newTaskPriority = normalizePriority(value);
  if ((key === "task-filter" || key === "priority-filter" || key === "capture-source-filter") && !filteredTasks({ includeQuery: false }).some((task) => task.id === state.activeTaskId)) {
    state.activeTaskId = "";
  }
}

function closeBugReport() {
  if (state.feedbackSubmitting) return;
  state.feedbackOpen = false;
  state.feedbackErrors = {};
  state.feedbackMessage = "";
  state.feedbackResult = null;
}

function validateBugReportDraft(draft = state.feedbackDraft) {
  const errors = {};
  const titleLength = unicodeLength(draft.title.trim());
  const descriptionLength = unicodeLength(draft.description.trim());
  if (titleLength < 3 || titleLength > 100) errors.title = "问题标题需为 3～100 字";
  if (!Object.hasOwn(bugCategoryLabels, draft.category)) errors.category = "请选择问题类型";
  if (descriptionLength < 10 || descriptionLength > 5000) errors.description = "问题描述需为 10～5000 字";
  if (unicodeLength(draft.reproductionSteps.trim()) > 5000) errors.reproductionSteps = "复现步骤最多 5000 字";
  if (unicodeLength(draft.contact.trim()) > 200) errors.contact = "联系方式最多 200 字";
  if (!draft.confirmed) errors.confirmed = "请确认隐私提示后再提交";
  return errors;
}

function unicodeLength(value) {
  return Array.from(String(value || "")).length;
}

function currentPageName() {
  if (state.taskPane === "notes") return "Knowledge Notes";
  if (state.taskPane === "history") return "Task History";
  return "Task Flow";
}

function bugReportPayload() {
  const draft = state.feedbackDraft;
  const includeEnvironment = draft.includeEnvironment !== false;
  return {
    title: draft.title.trim(),
    category: bugCategoryLabels[draft.category],
    description: draft.description.trim(),
    reproductionSteps: draft.reproductionSteps.trim(),
    contact: draft.contact.trim(),
    includeEnvironment,
    environment: includeEnvironment
      ? {
          appVersion: APP_VERSION || "dev",
          os: String(desktopEnvironment.os || "Browser Preview"),
          architecture: String(desktopEnvironment.architecture || "unknown"),
          currentPage: currentPageName(),
          submittedAt: now(),
          installationId: state.installationId,
        }
      : undefined,
  };
}

async function submitBugReport() {
  if (state.feedbackSubmitting) return false;
  const errors = validateBugReportDraft();
  if (Object.keys(errors).length) {
    state.feedbackErrors = errors;
    state.feedbackMessage = "请完善标记的内容";
    render();
    return false;
  }

  state.feedbackSubmitting = true;
  state.feedbackErrors = {};
  state.feedbackMessage = "";
  state.feedbackResult = null;
  render();

  try {
    if (!desktopBugReports?.submit) throw new Error("SERVICE_NOT_AVAILABLE");
    const result = await desktopBugReports.submit(bugReportPayload());
    if (!result?.success) {
      state.feedbackMessage = String(result?.message || "反馈提交失败，请稍后重试").slice(0, 240);
      return false;
    }
    state.feedbackDraft = createEmptyFeedbackDraft();
    state.feedbackResult = result;
    return true;
  } catch {
    state.feedbackMessage = "网络不可用，请检查连接后重试";
    return false;
  } finally {
    state.feedbackSubmitting = false;
    render();
  }
}

function flowSplitBounds(total) {
  return {
    min: Math.max(flowWidthLimits.title[0], total - flowWidthLimits.note[1]),
    max: Math.min(flowWidthLimits.title[1], total - flowWidthLimits.note[0]),
  };
}

function setFlowSplitTitleWidth(titleWidth, flowList = document.querySelector(".flow-list")) {
  const total = normalizeFlowWidth("title", state.flowWidths.title) + normalizeFlowWidth("note", state.flowWidths.note);
  const bounds = flowSplitBounds(total);
  const nextTitle = Math.max(bounds.min, Math.min(bounds.max, Math.round(titleWidth)));
  const nextNote = total - nextTitle;
  state.flowWidths.title = nextTitle;
  state.flowWidths.note = nextNote;
  if (flowList) {
    flowList.style.setProperty("--flow-title-width", `${nextTitle}px`);
    flowList.style.setProperty("--flow-note-width", `${nextNote}px`);
    flowList.style.setProperty("--flow-title-track", `${nextTitle}fr`);
    flowList.style.setProperty("--flow-note-track", `${nextNote}fr`);
    const handle = flowList.querySelector("[data-flow-split-resizer]");
    const percentage = Math.round((nextTitle / total) * 100);
    handle?.setAttribute("aria-valuenow", String(percentage));
    handle?.setAttribute("aria-valuetext", `标题 ${percentage}% · 记录 ${100 - percentage}%`);
  }
  return nextTitle;
}

function flowSplitGeometry(flowList) {
  const row = flowList?.querySelector(".flow-line.flow-row:not(.header)");
  const titleCell = row?.querySelector(".flow-title-cell");
  const recordCell = row?.querySelector(".flow-record-input");
  if (!titleCell || !recordCell) return null;
  const titleRect = titleCell.getBoundingClientRect();
  const recordRect = recordCell.getBoundingClientRect();
  const left = titleRect.left;
  const right = recordRect.right;
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return null;
  return { left, right, boundary: titleRect.right, width: right - left };
}

function setFlowSplitFromClientX(clientX, flowList) {
  const geometry = flowSplitGeometry(flowList);
  if (!geometry) return null;
  const minimumTitle = Math.min(flowWidthLimits.title[0], Math.max(0, geometry.width - flowWidthLimits.note[0]));
  const minimumNote = Math.min(flowWidthLimits.note[0], Math.max(0, geometry.width - minimumTitle));
  const boundary = Math.max(
    geometry.left + minimumTitle,
    Math.min(geometry.right - minimumNote, clientX),
  );
  const total = normalizeFlowWidth("title", state.flowWidths.title) + normalizeFlowWidth("note", state.flowWidths.note);
  return setFlowSplitTitleWidth((total * (boundary - geometry.left)) / geometry.width, flowList);
}

function startFlowSplitResize(event) {
  event.preventDefault();
  event.stopPropagation();
  const flowList = event.currentTarget.closest(".flow-list");
  const geometry = flowSplitGeometry(flowList);
  if (!flowList || !geometry) return;
  const grabOffset = event.clientX - geometry.boundary;
  document.body.classList.add("resizing-flow-split");
  event.currentTarget.setPointerCapture?.(event.pointerId);

  function move(moveEvent) {
    setFlowSplitFromClientX(moveEvent.clientX - grabOffset, flowList);
  }

  function end() {
    document.body.classList.remove("resizing-flow-split");
    saveFlowWidths();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

function handleFlowSplitKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const total = normalizeFlowWidth("title", state.flowWidths.title) + normalizeFlowWidth("note", state.flowWidths.note);
  const bounds = flowSplitBounds(total);
  const current = normalizeFlowWidth("title", state.flowWidths.title);
  const next = event.key === "Home" ? bounds.min : event.key === "End" ? bounds.max : current + (event.key === "ArrowLeft" ? -12 : 12);
  setFlowSplitTitleWidth(next, event.currentTarget.closest(".flow-list"));
  saveFlowWidths();
}

function startSidebarResize(event) {
  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const startWidth = normalizeSidebarWidth(state.sidebarWidth);
  const app = document.querySelector(".ops-app");
  document.body.classList.add("resizing-sidebar");

  function move(moveEvent) {
    const nextWidth = normalizeSidebarWidth(startWidth + moveEvent.clientX - startX);
    state.sidebarWidth = nextWidth;
    if (app) app.style.setProperty("--sidebar-width", `${nextWidth}px`);
  }

  function end() {
    document.body.classList.remove("resizing-sidebar");
    save();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
}

function startDetailResize(event) {
  event.preventDefault();
  event.stopPropagation();

  const startY = event.clientY;
  const startHeight = normalizeDetailHeight(state.detailHeight);
  const workbench = event.target.closest(".task-workbench");
  const totalHeight = Math.max(1, workbench?.getBoundingClientRect().height || window.innerHeight);
  document.body.classList.add("resizing-detail");

  function move(moveEvent) {
    const delta = ((moveEvent.clientY - startY) / totalHeight) * 100;
    const nextHeight = normalizeDetailHeight(startHeight - delta);
    state.detailHeight = nextHeight;
    if (workbench) {
      workbench.style.setProperty("--detail-pane-height", `${nextHeight}%`);
      workbench.style.setProperty("--flow-pane-height", `${100 - nextHeight}%`);
    }
  }

  function end() {
    document.body.classList.remove("resizing-detail");
    save();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
}


// ============================================================
// NODE DETAIL LIFECYCLE
// ============================================================
function exitNodeDetail() {
  if (!state.selectedNodeId) return false;
  state.selectedNodeId = "";
  state.recordDraft = "";
  state.nodeDetailFullscreen = false;
  state.nodeDetailPosition = null;
  document.querySelector(".node-detail, .node-detail-page")?.remove();
  document.querySelectorAll(".flow-row.selected").forEach((row) => row.classList.remove("selected"));
  return true;
}

function saveSelectedNodeRecord() {
  const task = state.tasks.find((item) => item.id === state.activeTaskId);
  const node = task && state.selectedNodeId ? findNode(task.nodes, state.selectedNodeId) : null;
  if (task && node && node.note !== state.recordDraft) {
    node.note = state.recordDraft;
    node.updatedAt = now();
    task.updatedAt = now();
  }
  state.selectedNodeId = "";
  state.recordDraft = "";
  state.nodeDetailFullscreen = false;
  state.nodeDetailPosition = null;
}

function saveNodeInspectorRecord() {
  const task = state.tasks.find((item) => item.id === state.activeTaskId);
  const node = task && state.selectedNodeId ? findNode(task.nodes, state.selectedNodeId) : null;
  if (!task || !node || node.note === state.recordDraft) return;
  node.note = state.recordDraft;
  node.updatedAt = now();
  task.updatedAt = node.updatedAt;
}

function selectNodeForInspector(taskId, nodeId) {
  const task = state.tasks.find((item) => item.id === taskId);
  const node = task ? findNode(task.nodes, nodeId) : null;
  if (!node) return;
  state.activeTaskId = taskId;
  state.selectedNodeId = nodeId;
  state.recordDraft = node.note || "";
  state.nodeDetailFullscreen = false;
  state.nodeDetailPosition = null;
}

function bindFlowTitleShortcuts() {
  document.querySelectorAll(".flow-title-input").forEach((input) => {
    input.addEventListener("keydown", handleFlowTitleKeydown);
  });
}

function handleFlowTitleKeydown(event) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const input = event.currentTarget;
  const taskId = input.dataset.taskId;
  const nodeId = input.dataset.nodeId;
  if (!taskId || !nodeId) return;
  if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault();
    if (!input.value.trim()) return;
    addSiblingNode(taskId, nodeId);
    render();
    return;
  }
  if (event.key === "Tab" && !event.shiftKey) {
    event.preventDefault();
    if (!input.value.trim()) return;
    const task = state.tasks.find((item) => item.id === taskId);
    const node = task ? findNode(task.nodes, nodeId) : null;
    if (!node) return;
    node.collapsed = false;
    addNode(taskId, nodeId);
    render();
  }
}

function focusPendingElement() {
  if (state.focusSearch) {
    const input = document.querySelector("#search");
    state.focusSearch = false;
    if (input) {
      input.focus();
      const cursor = Math.min(state.searchCursor, input.value.length);
      input.setSelectionRange(cursor, cursor);
    }
    return;
  }

  if (state.focusTaskTitleId) {
    const input = document.querySelector(`.task-title[data-task-id="${escSelectorValue(state.focusTaskTitleId)}"]`);
    state.focusTaskTitleId = "";
    if (input) {
      input.focus({ preventScroll: true });
      input.select();
    }
    return;
  }

  if (state.focusNodeTitleId) {
    const draft = document.querySelector("[data-shell-node-draft]");
    if (draft) {
      draft.focus({ preventScroll: true });
      draft.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    const input = document.querySelector(`.flow-title-input[data-node-id="${escSelectorValue(state.focusNodeTitleId)}"]`);
    state.focusNodeTitleId = "";
    if (input) {
      input.focus({ preventScroll: true });
      input.select();
    }
  }

  if (state.focusGroupTitleId) {
    const input = document.querySelector(`[data-group-title="${escSelectorValue(state.focusGroupTitleId)}"]`);
    state.focusGroupTitleId = "";
    if (input) {
      input.focus({ preventScroll: true });
      input.select();
    }
  }

  const recordInput = document.querySelector("[data-record-input]");
  if (recordInput) {
    recordInput.focus({ preventScroll: true });
    const end = recordInput.value.length;
    recordInput.setSelectionRange(end, end);
    return;
  }

  restoreMarkdownSelection();
}

function revealPendingTask() {
  const taskId = state.revealTaskId;
  if (!taskId) return;
  const input = document.querySelector(`.task-title[data-task-id="${escSelectorValue(taskId)}"]`);
  const row = input?.closest?.(".task-item") || document.querySelector(`.task-item[data-task-id="${escSelectorValue(taskId)}"]`);
  if (!row) return;
  row.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  state.revealTaskId = "";
}

function captureAppSwitchEditingFocus(target = document.activeElement) {
  if (!target) return false;
  const isProseMirror = target.classList?.contains("ProseMirror");
  const isMarkdownEditor = target.classList?.contains("markdown-editor");
  const isNativeField = Boolean(target.dataset?.editKey) && typeof target.setSelectionRange === "function";
  if (!isProseMirror && !isMarkdownEditor && !isNativeField) return false;

  const host = target.closest?.(".milkdown-editor-host");
  const taskId = target.dataset?.taskId || host?.dataset?.taskId || "";
  const nodeId = target.dataset?.nodeId || host?.dataset?.nodeId || "";
  const instance = isProseMirror ? milkdownEditors.get(noteDraftKey(taskId, nodeId))?.instance : null;
  const marker = ["page-title", "task-title", "flow-title-input"].find((name) => target.classList?.contains(name)) || "";
  const restore = appSwitchFocusSnapshot?.restore === true;
  appSwitchFocusSnapshot = {
    restore,
    kind: isProseMirror ? "milkdown" : isMarkdownEditor ? "markdown" : "field",
    element: target,
    taskId,
    nodeId,
    editKey: target.dataset?.editKey || "",
    marker,
    start: typeof target.selectionStart === "number" ? target.selectionStart : 0,
    end: typeof target.selectionEnd === "number" ? target.selectionEnd : 0,
    scrollLeft: Number(target.scrollLeft) || 0,
    scrollTop: Number(target.scrollTop) || 0,
    milkdownSelection: instance?.getSelection?.() || null,
  };
  return true;
}

function resolveAppSwitchEditingElement(snapshot) {
  if (snapshot.element && document.body.contains(snapshot.element)) return snapshot.element;
  if (snapshot.kind === "milkdown" || snapshot.kind === "markdown") {
    const host = Array.from(document.querySelectorAll(".milkdown-editor-host")).find(
      (item) => item.dataset.taskId === snapshot.taskId && (item.dataset.nodeId || "") === snapshot.nodeId,
    );
    return host?.querySelector(snapshot.kind === "milkdown" ? ".ProseMirror" : ".markdown-editor") || null;
  }
  return (
    Array.from(document.querySelectorAll("[data-edit-key]")).find(
      (item) =>
        item.dataset.editKey === snapshot.editKey &&
        item.dataset.taskId === snapshot.taskId &&
        (item.dataset.nodeId || "") === snapshot.nodeId &&
        (!snapshot.marker || item.classList?.contains(snapshot.marker)),
    ) || null
  );
}

function restoreAppSwitchEditingFocus() {
  const snapshot = appSwitchFocusSnapshot;
  if (!snapshot?.restore) return false;
  const target = resolveAppSwitchEditingElement(snapshot);
  if (!target) return false;

  if (snapshot.kind === "milkdown") {
    const host = target.closest?.(".milkdown-editor-host");
    const instance = milkdownEditors.get(noteDraftKey(host?.dataset?.taskId || snapshot.taskId, host?.dataset?.nodeId || snapshot.nodeId))?.instance;
    if (snapshot.milkdownSelection && !instance?.restoreSelection) return false;
    if (snapshot.milkdownSelection) instance.restoreSelection(snapshot.milkdownSelection);
    else target.focus({ preventScroll: true });
  } else {
    target.focus({ preventScroll: true });
    const maximum = typeof target.value === "string" ? target.value.length : 0;
    target.setSelectionRange(Math.min(snapshot.start, maximum), Math.min(snapshot.end, maximum));
  }
  target.scrollLeft = snapshot.scrollLeft;
  target.scrollTop = snapshot.scrollTop;
  state.restoreMarkdownFocus = false;
  appSwitchFocusSnapshot = null;
  return true;
}


// ============================================================
// MARKDOWN EDITOR (Milkdown integration)
// ============================================================
function storeMarkdownSelection(editor = activeMarkdownEditor(), shouldRestore = false) {
  if (!editor) return;
  state.markdownSelection = {
    taskId: editor.dataset.taskId,
    nodeId: editor.dataset.nodeId,
    start: editor.selectionStart || 0,
    end: editor.selectionEnd || editor.selectionStart || 0,
  };
  if (shouldRestore) state.restoreMarkdownFocus = true;
}

function restoreMarkdownSelection() {
  const selection = state.markdownSelection;
  if (!state.restoreMarkdownFocus || !selection || state.markdownMode !== "edit" || state.selectedNodeId !== selection.nodeId) return;
  const editor = document.querySelector(`.markdown-editor[data-node-id="${escSelectorValue(selection.nodeId)}"]`);
  if (!editor) return;
  const start = Math.min(selection.start, editor.value.length);
  const end = Math.min(selection.end, editor.value.length);
  editor.focus();
  editor.setSelectionRange(start, end);
  state.restoreMarkdownFocus = false;
}

function destroyMilkdownEditors(preservedKeys = new Set()) {
  milkdownEditors.forEach((entry, key) => {
    if (preservedKeys.has(key)) return;
    entry?.instance?.destroy?.().catch?.(() => {});
    milkdownEditors.delete(key);
  });
  cachedKnowledgePanes.forEach((_pane, taskId) => {
    if (!preservedKeys.has(noteDraftKey(taskId, ""))) discardCachedKnowledgePane(taskId);
  });
}

function stashKnowledgePane() {
  const pane = document.querySelector(".task-knowledge-pane[data-task-id]");
  if (!pane) return;
  const taskId = pane.dataset.taskId;
  if (!taskId) return;
  const host = pane.querySelector(".milkdown-editor-host[data-task-id]");
  if (!host) return;
  cachedKnowledgePane = { taskId, host };
  cachedKnowledgePanes.delete(taskId);
  cachedKnowledgePanes.set(taskId, cachedKnowledgePane);
  while (cachedKnowledgePanes.size > 8) {
    const candidate = [...cachedKnowledgePanes.keys()].find((taskId) => !milkdownEditors.get(noteDraftKey(taskId, ""))?.instance?.uploads?.size);
    if (!candidate) break;
    discardCachedKnowledgePane(candidate);
  }
  host.remove();
}

function discardCachedKnowledgePane(taskId = cachedKnowledgePane?.taskId) {
  const pane = cachedKnowledgePanes.get(taskId);
  if (!pane) return;
  const key = noteDraftKey(taskId, "");
  milkdownEditors.get(key)?.instance?.destroy?.().catch?.(() => {});
  milkdownEditors.delete(key);
  pane.host?.remove();
  cachedKnowledgePanes.delete(taskId);
  if (cachedKnowledgePane?.taskId === taskId) cachedKnowledgePane = null;
}

function discardMountedKnowledgeEditor(taskId) {
  if (typeof knowledgeGenerations !== "undefined") knowledgeGenerations.set(String(taskId), (knowledgeGenerations.get(String(taskId)) || 0) + 1);
  const normalizedTaskId = String(taskId || "");
  if (!normalizedTaskId) return;
  const key = noteDraftKey(normalizedTaskId, "");
  window.clearTimeout(nodeNoteSaveTimers.get(key));
  nodeNoteSaveTimers.delete(key);
  nodeNoteDrafts.delete(key);
  const entry = milkdownEditors.get(key);
  entry?.host?.remove();
  entry?.instance?.destroy?.().catch?.(() => {});
  milkdownEditors.delete(key);
  const pending = pendingMilkdownMounts.get(key);
  if (pending) { pending.invalidated = true; pending.host.remove(); }
  discardCachedKnowledgePane(normalizedTaskId);
}

function restoreCachedKnowledgePane(task) {
  if (task) cachedKnowledgePane = cachedKnowledgePanes.get(task.id) || null;
  if (!cachedKnowledgePane || !task || state.taskPane !== "notes") return;
  if (cachedKnowledgePane.taskId !== task.id) return;
  const replacement = document.querySelector(".task-knowledge-pane[data-task-id]");
  if (!replacement) return;
  const host = replacement.querySelector(".milkdown-editor-host[data-task-id]");
  if (!host) return;
  host.replaceWith(cachedKnowledgePane.host);
  cachedKnowledgePane = null;
}

function captureMountedMilkdownDrafts() {
  milkdownEditors.forEach((entry) => {
    const { host, instance, taskId, nodeId } = entry || {};
    if (!host || !taskId || !instance?.getMarkdown) return;
    try {
      const markdown = instance.getMarkdown() ?? "";
      // The editor preserves source text until its document actually changes.
      // Compare with the pending draft too: undo before the debounce fires must
      // replace that draft rather than leave an abandoned edit queued to save.
      const task = state.tasks.find((item) => item.id === taskId);
      const node = task && nodeId ? findNode(task.nodes, nodeId) : null;
      const draft = nodeNoteDrafts.get(noteDraftKey(taskId, nodeId));
      if (task && (draft?.markdown ?? (node ? node.note : task.notes)) === markdown) return;
      updateNodeNoteDraft(taskId, nodeId, markdown, host);
    } catch {
      // Ignore transient editor teardown states; the last onChange draft is still used.
    }
  });
}

function noteDraftKey(taskId, nodeId) {
  return `${taskId}:${nodeId || "task-notes"}`;
}

function updateNodeNoteDraft(taskId, nodeId, markdown, host = null) {
  nodeNoteDrafts.set(noteDraftKey(taskId, nodeId), { taskId, nodeId, markdown });
  if (host) updateMarkdownStatsForMarkdown(host, markdown);
  if (!nodeId) {
    scheduleKnowledgeRecovery(taskId, markdown);
    const editedTask = state.tasks.find((item) => item.id === taskId);
    if (editedTask) editedTask.knowledgeNote = knowledgeDocument.markDocumentEdited(editedTask.knowledgeNote);
    if (typeof knowledgeDidEdit === "function") knowledgeDidEdit(taskId);
    const task = state.tasks.find((item) => item.id === taskId);
    if (task && typeof note23EvaluateDraft === "function") note23EvaluateDraft(task, markdown);
  }
  scheduleNodeNoteSave(taskId, nodeId);
}

function scheduleNodeNoteSave(taskId, nodeId) {
  const key = noteDraftKey(taskId, nodeId);
  window.clearTimeout(nodeNoteSaveTimers.get(key));
  nodeNoteSaveTimers.set(
    key,
    window.setTimeout(() => {
      nodeNoteSaveTimers.delete(key);
      flushNodeNoteDraft(key, { persist: true });
    }, 500),
  );
}

function flushNodeNoteDraft(key, { persist = true } = {}) {
  const draft = nodeNoteDrafts.get(key);
  if (!draft) return false;
  window.clearTimeout(nodeNoteSaveTimers.get(key));
  nodeNoteSaveTimers.delete(key);

  const task = state.tasks.find((item) => item.id === draft.taskId);
  const node = task && draft.nodeId ? findNode(task.nodes, draft.nodeId) : null;
  nodeNoteDrafts.delete(key);
  if (!task) return false;
  const currentMarkdown = node ? node.note : task.notes;
  if (currentMarkdown === draft.markdown) return false;

  if (node) {
    node.note = draft.markdown;
    node.updatedAt = now();
  } else {
    task.notes = draft.markdown;
    task.knowledgeNote = knowledgeDocument.markDocumentEdited(task.knowledgeNote);
  }
  task.updatedAt = now();
  if (!draft.nodeId) {
    if (typeof shellKnowledgeSyncStats === "function") shellKnowledgeSyncStats(task);
    if (typeof note23UpdateChrome === "function") note23UpdateChrome(task);
    if (state.activeTaskId === task.id && state.taskPane === "notes") {
      if (typeof note23RefreshOutline === "function") note23RefreshOutline(task);
    }
  }
  if (persist) save();
  return true;
}

function flushNodeNoteDrafts({ persist = true } = {}) {
  let changed = false;
  Array.from(nodeNoteDrafts.keys()).forEach((key) => {
    changed = flushNodeNoteDraft(key, { persist: false }) || changed;
  });
  if (changed && persist) save();
  return changed;
}

/**
 * Mount Milkdown editors on all .milkdown-editor-host elements.
 * Creates or reuses editor instances based on node content.
 */
function mountMilkdownEditors() {
  const hosts = Array.from(document.querySelectorAll(".milkdown-editor-host"));
  if (!hosts.length) return;
  if (!window.MilkdownTaskEditor?.create) {
    hosts.forEach((host) => mountFallbackMarkdownEditor(host));
    return;
  }

  hosts.forEach((host) => {
    const taskId = host.dataset.taskId;
    const nodeId = host.dataset.nodeId || "";
    const task = state.tasks.find((item) => item.id === taskId);
    const node = task && nodeId ? findNode(task.nodes, nodeId) : null;
    if (!task || (nodeId && !node)) return;
    const editorKey = noteDraftKey(taskId, nodeId);
    if (milkdownEditors.has(editorKey)) {
      const existing = milkdownEditors.get(editorKey).instance;
      if (!nodeId && existing.setMode) existing.setMode(shellKnowledgeMode());
      return;
    }
    // A render can run again before create() resolves. Without this registry
    // the second pass would build a second editor for the same host, leaking
    // the first one and losing its content.
    const pending = pendingMilkdownMounts.get(editorKey);
    if (pending) { pending.nextHost = host; return; }
    const mount = { host, nextHost: null };
    pendingMilkdownMounts.set(editorKey, mount);
    const rawMarkdown = nodeNoteDrafts.get(editorKey)?.markdown ?? (node ? node.note : task.notes) ?? "";
    const markdown = node ? rawMarkdown : hydrateKnowledgeEditorMarkdown(rawMarkdown);

    const editorFactory = !nodeId && window.LoopKnowledgeEditor ? window.LoopKnowledgeEditor : window.MilkdownTaskEditor;
    editorFactory.create({
      ...(!nodeId && window.LoopKnowledgeEditor ? knowledgeEditorOptions(task) : {}),
      root: host,
      markdown,
      sourceMarkdown: rawMarkdown,
      mode: nodeId ? "edit" : shellKnowledgeMode(),
      placeholder: node ? "记录处理过程" : "记录分析过程、知识点和可复用结论……",
      enableTableResizing: !nodeId,
      tableColumnWidths: nodeId ? [] : task.knowledgeNote?.tableColumnWidths,
      onChange: (markdown) => {
        updateNodeNoteDraft(taskId, nodeId, markdown, host);
      },
      onTableColumnWidthsChange: nodeId
        ? undefined
        : (tableColumnWidths) => {
            const latestTask = state.tasks.find((item) => item.id === taskId);
            if (!latestTask) return;
            latestTask.knowledgeNote = knowledgeDocument.updateTableColumnWidths(
              latestTask.knowledgeNote,
              tableColumnWidths,
            );
            save();
          },
    })
      .then((instance) => {
        if (mount.invalidated || (!document.body.contains(host) && cachedKnowledgePanes.get(taskId)?.host !== host)) {
          instance.destroy?.();
          return;
        }
        milkdownEditors.set(editorKey, { host, instance, taskId, nodeId });
        bindMilkdownSurfaceEvents(host);
        updateMarkdownStatsForMarkdown(host, node ? rawMarkdown : hydrateKnowledgeEditorMarkdown(rawMarkdown));
      })
      .catch((error) => {
        if (mount.invalidated || (!host.isConnected && cachedKnowledgePanes.get(taskId)?.host !== host)) return;
        console.error("Milkdown failed to mount", error);
        mountFallbackMarkdownEditor(host);
      })
      .finally(() => {
        if (pendingMilkdownMounts.get(editorKey) !== mount) return;
        pendingMilkdownMounts.delete(editorKey);
        // A second render can replace the host before an asynchronous create
        // finishes. The new host must not remain at "opening" indefinitely.
        if (mount.nextHost?.isConnected && !milkdownEditors.has(editorKey)) window.requestAnimationFrame(mountMilkdownEditors);
      });
  });
}

function mountFallbackMarkdownEditor(host) {
  const taskId = host.dataset.taskId;
  const nodeId = host.dataset.nodeId || "";
  const task = state.tasks.find((item) => item.id === taskId);
  const node = task && nodeId ? findNode(task.nodes, nodeId) : null;
  if (!task || (nodeId && !node)) return;
  const rawMarkdown = nodeNoteDrafts.get(noteDraftKey(taskId, nodeId))?.markdown ?? (node ? node.note : task.notes) ?? "";
  const markdown = node ? rawMarkdown : hydrateKnowledgeEditorMarkdown(rawMarkdown);
  const placeholder = node ? "记录处理过程" : "记录分析过程、知识点和可复用结论……";
  host.innerHTML = `<textarea class="markdown-editor codex-editor milkdown-fallback" data-task-id="${escAttr(taskId)}" data-node-id="${escAttr(nodeId)}" placeholder="${placeholder}">${esc(markdown)}</textarea>${renderEditorImagePreview(markdown)}`;
  host.querySelectorAll(".markdown-editor").forEach((editor) => {
    editor.addEventListener("input", (event) => {
      updateNodeNoteDraft(taskId, nodeId, event.target.value, host);
      updateMarkdownEditorState(event.target);
    });
    editor.addEventListener("paste", handleMarkdownPaste);
    editor.addEventListener("drop", handleMarkdownDrop);
    editor.addEventListener("blur", (event) => {
      if (!event.relatedTarget && !appEditingPointerDown) captureAppSwitchEditingFocus(event.target);
    });
  });
}

function bindMilkdownSurfaceEvents(host) {
  const editor = host.querySelector(".ProseMirror");
  if (!editor || editor.dataset.enhanced === "true") return;
  editor.dataset.enhanced = "true";
  editor.addEventListener("blur", (event) => {
    if (!event.relatedTarget && !appEditingPointerDown) captureAppSwitchEditingFocus(event.target);
  });
  editor.addEventListener("paste", handleMarkdownPaste);
  editor.addEventListener("drop", handleMarkdownDrop);
  editor.addEventListener("dragover", (event) => {
    if (hasDraggedImage(event)) {
      event.preventDefault();
      host.closest(".markdown-panel")?.classList.add("dragging-image");
    }
  });
  editor.addEventListener("dragleave", () => {
    host.closest(".markdown-panel")?.classList.remove("dragging-image");
  });
  editor.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
      handleMarkdownPasteShortcut(event);
    }
  });
  if (appSwitchFocusSnapshot?.restore) window.requestAnimationFrame(restoreAppSwitchEditingFocus);
}

function updateMarkdownStatsForMarkdown(host, markdown) {
  if (host?.dataset?.editorKind === "knowledge" && typeof knowledgeUpdateChrome === "function") {
    const task = state.tasks.find((item) => item.id === host.dataset.taskId);
    if (task) knowledgeUpdateChrome(task);
    return;
  }
  const stats = markdownStats(markdown);
  const scope = host.closest(".knowledge-pane") || host.closest(".markdown-panel") || host.parentElement;
  const statsElement = scope?.querySelector("[data-markdown-stats], [data-note-stats]");
  if (statsElement) statsElement.textContent = `${stats.characters} 字 · ${stats.lines} 行`;
}

function focusNodeDetailEditor(nodeId) {
  if (!nodeId) return false;
  const scope = document.querySelector(`.node-detail.fullscreen-editor[data-node-id="${escSelectorValue(nodeId)}"]`) || document.querySelector(`.node-detail[data-node-id="${escSelectorValue(nodeId)}"]`);
  const editor = scope?.querySelector(".ProseMirror, .markdown-editor");
  if (!editor) return false;
  editor.focus({ preventScroll: true });
  if (editor.classList.contains("markdown-editor")) {
    const end = editor.value?.length ?? 0;
    editor.setSelectionRange?.(end, end);
  }
  return true;
}

function editorSnippet(kind) {
  switch (kind) {
    case "h2":
      return "## 标题\n";
    case "bullet":
      return "- 列表项 1\n- 列表项 2\n";
    case "ordered":
      return "1. 列表项 1\n2. 列表项 2\n";
    case "quote":
      return "> 引用内容\n";
    case "code":
      return "```text\n在这里输入代码\n```\n";
    case "table":
      return "| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n";
    case "image":
      return "![图片描述](https://)\n";
    default:
      return "";
  }
}

function insertIntoActiveEditor(text) {
  if (state.taskPane === "notes" && shellKnowledgeEditorEntry()?.insertText) return shellKnowledgeEditorEntry().insertText(text);
  const active = document.activeElement;
  if (active?.classList?.contains("markdown-editor")) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? start;
    active.setRangeText(text, start, end, "end");
    active.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  const proseMirror = document.activeElement?.closest?.(".ProseMirror") || document.querySelector(".node-detail.fullscreen-editor .ProseMirror:focus, .node-detail.fullscreen-editor .ProseMirror");
  if (!proseMirror) return false;
  proseMirror.focus({ preventScroll: true });

  if (document.queryCommandSupported?.("insertText")) {
    const inserted = document.execCommand("insertText", false, text);
    if (inserted) return true;
  }

  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  proseMirror.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  return true;
}

function createMarkdownImageSnippet(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return "";
  const imageId = id("image");
  state.attachments = normalizeAttachments(state.attachments);
  state.attachments.images[imageId] = dataUrl;
  const alt = `粘贴图片 ${formatImageStamp(new Date())}`;
  save();
  return `\n![${alt}](task-image:${imageId})\n`;
}

function insertTextIntoEditor(editor, text) {
  if (!editor || !text) return false;
  if (editor.classList?.contains("markdown-editor")) {
    const start = editor.selectionStart ?? editor.value.length;
    const end = editor.selectionEnd ?? start;
    editor.setRangeText(text, start, end, "end");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  if (editor.classList?.contains("ProseMirror")) {
    editor.focus({ preventScroll: true });
    return insertIntoActiveEditor(text);
  }
  return false;
}

function insertMarkdownImage(editor, dataUrl) {
  if (editor?.classList?.contains("ProseMirror")) {
    const host = editor.closest(".milkdown-editor-host");
    const taskId = host?.dataset.taskId || "";
    const nodeId = host?.dataset.nodeId || "";
    const instance = milkdownEditors.get(noteDraftKey(taskId, nodeId))?.instance;
    if (instance?.insertImage) {
      editor.focus({ preventScroll: true });
      return Boolean(
        instance.insertImage({
          src: dataUrl,
          alt: `粘贴图片 ${formatImageStamp(new Date())}`,
        }),
      );
    }
  }
  const markdown = createMarkdownImageSnippet(dataUrl);
  if (!markdown) return false;
  return insertTextIntoEditor(editor, markdown);
}

function activeRichEditor() {
  const active = document.activeElement;
  if (active?.classList?.contains("markdown-editor") || active?.classList?.contains("ProseMirror")) return active;
  return document.querySelector(".task-knowledge-pane .ProseMirror:focus, .task-knowledge-pane .ProseMirror, .task-knowledge-pane .markdown-editor:focus, .task-knowledge-pane .markdown-editor");
}

function focusKnowledgeEditor() {
  if (shellKnowledgeEditorEntry()?.view) { shellKnowledgeEditorEntry().view.focus(); return true; }
  const editor = document.querySelector(".task-knowledge-pane .ProseMirror, .task-knowledge-pane .markdown-editor");
  if (!editor) return false;
  editor.focus({ preventScroll: true });
  if (editor.classList.contains("markdown-editor")) {
    const end = editor.value?.length ?? 0;
    editor.setSelectionRange?.(end, end);
  }
  return true;
}

async function pickEditorImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] || null;
        input.remove();
        resolve(file);
      },
      { once: true },
    );
    input.addEventListener(
      "cancel",
      () => {
        input.remove();
        resolve(null);
      },
      { once: true },
    );
    input.click();
  });
}


// ============================================================
// ACTION HANDLER -- central action() dispatcher
// ============================================================
/**
 * Central action dispatcher. Called when [data-action] elements are clicked.
 * Modifies state (never render() directly), then calls render().
 * @param {object} data - DOM dataset, includes { action, taskId, nodeId, ... }
 * @param {Event|null} event - Original DOM event, used for position calculations
 */
async function action(data, event = null) {
  if (["toggle-calendar", "toggle-review", "toggle-settings"].includes(data.action)) state.globalListReturn = null;
  // The three-column shell owns the Demo's action vocabulary; anything it
  // recognises is executed there and re-rendered, the legacy chain below
  // keeps handling the remaining project commands.
  if (typeof shellAction === "function" && await shellAction(data, event)) {
    if (data.action !== "close-dialog" || true) render();
    return;
  }
  state.contextMenu = null;
  syncContextMenuRoot();
  if (taskPriorityMenu && !["toggle-task-priority-menu", "set-task-priority"].includes(data.action)) taskPriorityMenu = null;
  if (state.searchOpen && data.action !== "toggle-global-search" && event?.currentTarget?.closest?.(".app-command-bar")) {
    state.searchOpen = false;
    state.focusSearch = false;
    state.searchCursor = 0;
    state.query = "";
  }
  if (data.action === "show-today-widget") {
    void desktopTodayWidget?.show();
    return;
  }
  if (data.action === "toggle-today-widget-visibility") {
    if (!desktopTodayWidget) return;
    if (todayWidgetWindowState.visible) await desktopTodayWidget.hide();
    else await desktopTodayWidget.show();
    todayWidgetWindowState = await desktopTodayWidget.getState();
  }
  if (data.action === "toggle-global-search") {
    if (state.searchOpen) {
      state.searchOpen = false;
      state.focusSearch = false;
      state.searchCursor = 0;
      state.query = "";
    } else {
      state.searchOpen = true;
      state.focusSearch = true;
      state.searchCursor = 0;
      state.query = "";
    }
  }
  if (data.action === "open-global-search-task") {
    openTaskFromGlobalList(data.taskId);
    state.searchOpen = false;
    state.focusSearch = false;
  }
  if (data.action === "open-global-search-node") {
    openTaskFromGlobalList(data.taskId, data.nodeId);
    state.taskPane = "flow";
    state.searchOpen = false;
    state.focusSearch = false;
  }
  if (data.action === "toggle-today-widget-click-through") {
    if (!desktopTodayWidget) return;
    await desktopTodayWidget.setPreferences({ clickThrough: todayWidgetWindowState.clickThrough !== true });
    return;
  }
  if (data.action === "markdown-tool") {
    applyMarkdownTool(data.tool);
    return;
  }
  if (data.action === "insert-editor-snippet") {
    focusKnowledgeEditor();
    if (data.kind === "image") {
      void pickEditorImageFile().then((file) => {
        const editor = activeRichEditor();
        if (!file || !editor) return;
        insertImageFile(editor, file);
      });
      return;
    }
    insertIntoActiveEditor(editorSnippet(data.kind));
    return;
  }
  if (["save-knowledge", "save-knowledge-as", "save-knowledge-overwrite", "reload-knowledge"].includes(data.action)) {
    await shellRunKnowledgeConflictAction(data, () => data.action === "reload-knowledge"
      ? reloadKnowledgeTask(data.taskId)
      : saveKnowledgeTask(data.taskId, {
        saveAs: data.action === "save-knowledge-as",
        allowExternalOverwrite: data.action === "save-knowledge-overwrite",
      }));
    return;
  }
  if (data.action === "relocate-knowledge") {
    const result = await relocateKnowledgeTask(data.taskId);
    if (!result?.canceled) render();
    return;
  }
  if (data.action === "retry-knowledge") {
    const result = await saveKnowledgeTask(data.taskId);
    if (!result?.canceled) render();
    return;
  }
  if (data.action === "remove-knowledge-binding") {
    // Phase26: the Demo's own 解除文件关联 dialog replaces the native confirm,
    // keeps the 12-second undo, and never touches the file on disk.
    if (typeof recovery26ReviewUnlinkNote === "function" && recovery26ReviewUnlinkNote(data.taskId)) return;
    const result = await removeKnowledgeBinding(data.taskId);
    if (!result?.canceled) render();
    return;
  }
  if (data.action === "close-knowledge-editor") {
    const result = await closeKnowledgeEditor(data.taskId);
    if (result?.success) render();
    return;
  }
  if (data.action === "keep-knowledge-draft") {
    const mode = state.knowledgeDraftPrompt?.mode;
    state.knowledgeDraftPrompt = null;
    if (mode === "close-editor") state.taskPane = "flow";
    render();
    return;
  }
  if (data.action === "delete-knowledge-draft") {
    const mode = state.knowledgeDraftPrompt?.mode;
    state.knowledgeDraftPrompt = null;
    if (mode === "close-editor") {
      // Phase26: clearing the in-app body is a deletion, so it is archived.
      if (typeof recovery26RemoveNote === "function") {
        const outcome = await recovery26Transaction(() => recovery26RemoveNote(data.taskId));
        if (outcome.ok) {
          state.taskPane = "flow";
          render();
          recovery26Receipt("1 项已移到最近删除", outcome.entries);
        } else {
          render();
          recovery26Receipt(outcome.message);
        }
      } else {
        await discardUnfiledKnowledgeDraft(data.taskId);
        state.taskPane = "flow";
        render();
      }
    } else if (typeof recovery26ReviewDeleteTask === "function") {
      recovery26ReviewDeleteTask(data.taskId);
      return;
    } else {
      await deleteTask(data.taskId, { skipDraftPrompt: true });
      render();
    }
    return;
  }
  if (data.action === "save-knowledge-before-delete") {
    const result = await saveKnowledgeTask(data.taskId);
    if (result?.success) {
      state.knowledgeDraftPrompt = null;
      await deleteTask(data.taskId, { skipDraftPrompt: true });
      render();
    } else if (!result?.canceled) {
      render();
    }
    return;
  }
  if (data.action === "save-knowledge-before-close") {
    const result = await saveKnowledgeTask(data.taskId);
    if (result?.success) {
      state.knowledgeDraftPrompt = null;
      state.taskPane = "flow";
      render();
    } else if (!result?.canceled) {
      render();
    }
    return;
  }
  if (data.action === "export-node-pdf") {
    captureMountedMilkdownDrafts();
    flushNodeNoteDraft(noteDraftKey(data.taskId, data.nodeId), { persist: true });
    exportNodePdf(data.taskId, data.nodeId);
    return;
  }
  if (data.action === "share-task") {
    void shareTask(data.taskId);
    return;
  }
  if (data.action === "scroll-sheets") {
    scrollSheets(Number(data.direction || 1));
    return;
  }
  if (data.action === "set-markdown-mode") state.markdownMode = data.mode === "preview" ? "preview" : "edit";
  if (data.action === "switch-task-pane") {
    state.taskPane = ["flow", "notes", "history"].includes(data.pane) ? data.pane : "flow";
    if (state.taskPane !== "flow") {
      state.selectedNodeId = "";
      state.recordDraft = "";
      state.nodeDetailFullscreen = false;
      state.nodeDetailPosition = null;
    }
  }
  if (data.action === "toggle-settings") {
    state.settingsOpen = !state.settingsOpen;
    if (state.settingsOpen) {
      settingsMotion = "open";
      state.calendarOpen = false;
      state.reviewOpen = false;
      state.feedbackOpen = false;
    }
  }
  if (data.action === "toggle-theme") state.theme = state.theme === "dark" ? "light" : "dark";
  if (data.action === "close-settings") state.settingsOpen = false;
  if (data.action === "toggle-task-group-select") {
    const task = state.tasks.find((item) => item.id === data.taskId);
    if (task) {
      taskGroupSelectTaskId = taskGroupSelectTaskId === task.id ? "" : task.id;
      recurrencePopoverTaskId = "";
      deadlinePopoverTaskId = "";
    }
  }
  if (data.action === "select-task-group") {
    const task = state.tasks.find((item) => item.id === data.taskId);
    const group = state.taskGroups.find((item) => item.id === data.groupId);
    if (task && group) {
      edit({ editKey: "groupId", taskId: task.id }, group.id);
      taskGroupSelectTaskId = "";
    }
  }
  if (data.action === "toggle-deadline-picker") {
    const task = state.tasks.find((item) => item.id === data.taskId);
    if (task) {
      const opening = deadlinePopoverTaskId !== task.id;
      deadlinePopoverTaskId = opening ? task.id : "";
      taskGroupSelectTaskId = "";
      recurrencePopoverTaskId = "";
      if (opening) initializeDeadlinePicker(task);
    }
  }
  if (data.action === "select-deadline-date") {
    const selected = normalizeTaskDateFilter(data.date);
    if (selected) {
      deadlinePickerDate = selected;
      deadlinePickerMonth = `${selected.slice(0, 7)}-01`;
    }
  }
  if (data.action === "shift-deadline-picker-month") {
    const month = deadlinePickerMonthDate();
    month.setMonth(month.getMonth() + Number(data.direction || 0));
    deadlinePickerMonth = localDateKey(new Date(month.getFullYear(), month.getMonth(), 1));
  }
  if (data.action === "deadline-picker-today") {
    deadlinePickerDate = localDateKey(new Date());
    deadlinePickerMonth = `${deadlinePickerDate.slice(0, 7)}-01`;
  }
  if (data.action === "apply-deadline-time") applyTaskDeadlineTime(data.taskId, data.time);
  if (data.action === "clear-task-deadline") {
    const task = state.tasks.find((item) => item.id === data.taskId);
    if (task) {
      task.deadlineAt = "";
      task.updatedAt = now();
      deadlinePopoverTaskId = "";
      save();
    }
  }
  if (data.action === "open-feedback") {
    state.settingsOpen = false;
    state.calendarOpen = false;
    state.reviewOpen = false;
    state.feedbackOpen = true;
    state.feedbackResult = null;
    state.feedbackMessage = "";
  }
  if (data.action === "close-feedback") closeBugReport();
  if (data.action === "toggle-calendar") {
    state.calendarOpen = !state.calendarOpen;
    if (state.calendarOpen) {
      ensureCalendarState();
      state.settingsOpen = false;
      state.reviewOpen = false;
      state.feedbackOpen = false;
    }
  }
  if (data.action === "close-calendar") state.calendarOpen = false;
  if (data.action === "open-review-from-calendar") {
    state.calendarOpen = false;
    state.reviewOpen = true;
  }
  if (data.action === "set-deadline-filter") {
    state.taskDeadlineFilter = Object.hasOwn(taskDeadlineFilterLabels, data.value) ? data.value : "all";
    state.taskDateFilter = "";
    state.selectedNodeId = "";
    state.calendarOpen = false;
  }
  if (data.action === "select-calendar-date") {
    const selected = normalizeTaskDateFilter(data.date);
    if (selected) {
      state.calendarSelectedDate = selected;
      state.calendarMonth = `${selected.slice(0, 7)}-01`;
    }
  }
  if (data.action === "apply-calendar-date") {
    rememberGlobalListReturn('[data-action="apply-calendar-date"]');
    state.activeGroupId = ALL_TASKS_GROUP_ID;
    state.taskFilter = "all";
    state.captureSourceFilter = "all";
    state.priorityFilter = "all";
    state.query = "";
    state.taskDateFilter = normalizeTaskDateFilter(state.calendarSelectedDate);
    state.taskDeadlineFilter = "all";
    state.selectedNodeId = "";
    state.calendarOpen = false;
    state.reviewOpen = false;
    state.taskPane = "flow";
    state.activeTaskId = calendarTasksForDate(state.taskDateFilter)[0]?.id || "";
  }
  if (data.action === "shift-calendar-month") {
    const month = calendarMonthDate();
    month.setMonth(month.getMonth() + Number(data.direction || 0));
    state.calendarMonth = localDateKey(new Date(month.getFullYear(), month.getMonth(), 1));
  }
  if (data.action === "calendar-today") {
    state.calendarSelectedDate = loopTodayKey();
    state.calendarMonth = `${state.calendarSelectedDate.slice(0, 7)}-01`;
  }
  if (data.action === "open-calendar-task") openTaskFromGlobalList(data.taskId);
  if (data.action === "toggle-review") {
    state.reviewOpen = !state.reviewOpen;
    if (state.reviewOpen) {
      state.settingsOpen = false;
      state.calendarOpen = false;
    }
  }
  if (data.action === "close-review") state.reviewOpen = false;
  if (data.action === "set-review-preset") {
    state.reviewPreset = Object.hasOwn(reviewPresetLabels, data.preset) ? data.preset : "week";
    if (state.reviewPreset === "custom") ensureReviewCustomDates();
  }
  if (data.action === "open-review-task") openTaskFromGlobalList(data.taskId);
  if (data.action === "return-global-page" && state.globalListReturn) {
    const { context, focusSelector } = state.globalListReturn;
    const { scroll, ...values } = context;
    Object.assign(state, values);
    state.globalListReturn = null;
    window.requestAnimationFrame(() => {
      for (const entry of scroll) document.querySelector(`.${entry.className.split(/\s+/).filter(Boolean).join(".")}`)?.scrollTo({ top: entry.top });
      document.querySelector(focusSelector)?.focus({ preventScroll: true });
    });
  }
  if (data.action === "reload-app") window.location.reload();
  if (data.action === "select-group") selectGroup(data.groupId);
  if (data.action === "toggle-repository-type") {
    const type = data.type === "note" ? "note" : "task";
    const current = repositoryTypeSelection();
    const next = { ...current, [type === "task" ? "includeTask" : "includeNote"]: !current[type === "task" ? "includeTask" : "includeNote"] };
    if (next.includeTask || next.includeNote) {
      state.captureSourceFilter = next.includeTask && next.includeNote ? "all" : next.includeNote ? "quick" : "task";
      state.selectedNodeId = "";
      if (!filteredTasks({ includeQuery: false }).some((task) => task.id === state.activeTaskId)) state.activeTaskId = "";
      save();
    }
  }
  if (data.action === "set-repository-priority-filter") {
    state.priorityFilter = normalizePriorityFilter(data.value);
    state.selectedNodeId = "";
    repositoryPriorityFilterOpen = false;
    if (!filteredTasks({ includeQuery: false }).some((task) => task.id === state.activeTaskId)) state.activeTaskId = "";
    save();
  }
  if (data.action === "toggle-repository-group-picker") {
    const clickedAt = Date.now();
    const isDoubleClick = clickedAt - repositoryGroupTriggerLastClickAt < 360;
    repositoryGroupTriggerLastClickAt = clickedAt;
    if (isDoubleClick && state.taskGroups.some((group) => group.id === state.activeGroupId)) {
      repositoryGroupPickerOpen = true;
      repositoryGroupQuery = "";
      startRenameGroup(state.activeGroupId);
    } else {
      repositoryGroupPickerOpen = !repositoryGroupPickerOpen;
      repositoryGroupQuery = repositoryGroupPickerOpen ? repositoryGroupQuery : "";
      if (repositoryGroupPickerOpen) window.requestAnimationFrame(() => document.querySelector(".repository-group-search input")?.focus({ preventScroll: true }));
    }
  }
  if (data.action === "select-repository-group") {
    selectGroup(data.groupId);
  }
  if (data.action === "add-group") addGroup();
  if (data.action === "batch-add-tasks" || data.action === "import-learning-plan") {
    const groupId = data.groupId;
    repositoryGroupPickerOpen = false;
    render();
    document.dispatchEvent(new CustomEvent("loop-task-batch:open", { detail: { groupId } }));
    return;
  }
  if (data.action === "select-focus") {
    openTaskFromGlobalList(data.taskId, "", { keepToday: true });
  }
  if (data.action === "select-task") {
    activateRepositoryTask(data.taskId);
  }
  if (data.action === "toggle-task-priority-menu") {
    const task = state.tasks.find((item) => item.id === data.taskId);
    if (!task) return;
    if (taskPriorityMenu?.taskId === task.id) {
      taskPriorityMenu = null;
    } else {
      const rect = event?.currentTarget?.getBoundingClientRect?.() || { left: 16, right: 88, top: 16, bottom: 44 };
      const menuWidth = 148;
      const menuHeight = 142;
      const viewportWidth = window.innerWidth || 1024;
      const viewportHeight = window.innerHeight || 768;
      taskPriorityMenu = {
        taskId: task.id,
        x: Math.max(10, Math.min(rect.right - menuWidth, viewportWidth - menuWidth - 10)),
        y: rect.bottom + menuHeight + 8 <= viewportHeight ? rect.bottom + 6 : Math.max(10, rect.top - menuHeight - 6),
      };
    }
    render();
    window.requestAnimationFrame(() => document.querySelector(".task-priority-option.selected")?.focus({ preventScroll: true }));
    return;
  }
  if (data.action === "set-task-priority") {
    const task = state.tasks.find((item) => item.id === data.taskId);
    if (task) {
      task.priority = normalizePriority(data.priority);
      task.updatedAt = now();
      save();
    }
    taskPriorityMenu = null;
  }
  if (data.action === "close-task-priority-menu") taskPriorityMenu = null;
  if (data.action === "add-task") {
    // Demo phase 16: 新建 opens a dialog instead of dropping a blank task.
    if (typeof shellOpenCreateDialog === "function") shellOpenCreateDialog();
    else addBlankTask();
  }
  if (data.action === "delete-task") {
    // Phase26: every record delete goes through the archive service, which
    // captures the current drafts, shows the impact dialog and only removes the
    // record once the archive entry is on disk.
    if (typeof recovery26ReviewDeleteTask === "function") {
      state.taskMenuOpen = false;
      state.contextMenu = null;
      recovery26ReviewDeleteTask(data.taskId);
      return;
    }
    if (!(await deleteTask(data.taskId))) return;
  }
  if (data.action === "select-node") {
    selectNodeForInspector(data.taskId, data.nodeId);
  }
  if (data.action === "toggle-task-done") {
    activateRepositoryTask(data.taskId);
    const wasDone = state.tasks.find((item) => item.id === data.taskId)?.status === "done";
    const completedTask = state.tasks.find((item) => item.id === data.taskId);
    const occurrence = completedTask?.recurrence?.lastCompletedOccurrence || "";
    const context = typeof shellCaptureJourneyContext === "function" ? shellCaptureJourneyContext() : null;
    toggleTaskDone(data.taskId);
    const isDone = state.tasks.find((item) => item.id === data.taskId)?.status === "done";
    if (!wasDone && isDone) {
      advanceNavigationAfterCompletion(data.taskId);
      if (typeof shellShowJourneyReceipt === "function") shellShowJourneyReceipt({ id: data.taskId, kind: "done", context, occurrence, date: loopTodayKey() });
    }
  }
  if (data.action === "toggle-task-tag") toggleTaskTag(data.taskId, data.tag);
  if (data.action === "add-node") addNode(data.taskId, data.parentId || null);
  if (data.action === "add-root-node") addNode(data.taskId, null);
  if (data.action === "add-child-node" || data.action === "add-sibling-node") {
    if (typeof shellCloseOverlay === "function") shellCloseOverlay({ restoreFocus: false });
    if (data.action === "add-child-node") addNode(data.taskId, data.nodeId);
    else addSiblingNode(data.taskId, data.nodeId);
  }
  if (data.action === "toggle-node-done") toggleNodeDone(data.taskId, data.nodeId);
  if (data.action === "toggle-node-collapse") toggleNodeCollapse(data.taskId, data.nodeId);
  if (data.action === "toggle-all-nodes") toggleAllNodes(data.taskId);
  if (data.action === "mark-node-status") markNodeStatus(data.taskId, data.nodeId, data.status);
  if (data.action === "cycle-node-status") cycleNodeStatus(data.taskId, data.nodeId);
  if (data.action === "open-node-detail") {
    selectNodeForInspector(data.taskId, data.nodeId);
    render();
    return;
  }
  if (data.action === "navigate-node-detail" && data.nodeId) {
    selectNodeForInspector(data.taskId, data.nodeId);
    render();
    return;
  }
  if (data.action === "delete-node") {
    if (typeof recovery26ReviewDeleteNode === "function") {
      state.contextMenu = null;
      recovery26ReviewDeleteNode(data.taskId, data.nodeId);
      return;
    }
    if (!(await deleteNode(data.taskId, data.nodeId))) return;
  }
  if (data.action === "toggle-node-detail-fullscreen") state.nodeDetailFullscreen = !state.nodeDetailFullscreen;
  if (data.action === "close-node-detail") {
    state.selectedNodeId = "";
    state.recordDraft = "";
    state.nodeDetailFullscreen = false;
    state.nodeDetailPosition = null;
  }
  if (data.action === "save-node-detail") {
    saveNodeInspectorRecord();
  }
  render();
}

/**
 * Share a task: copy its Markdown representation to clipboard.
 * @param {string} taskId - Task ID to share
 */
async function shareTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  captureMountedMilkdownDrafts();
  flushNodeNoteDrafts({ persist: true });
  const markdown = taskMarkdown(task);

  try {
    if (desktopExport?.taskDocument) {
      await desktopExport.taskDocument({
        taskTitle: task.title || "未命名任务",
        markdown,
        html: renderMarkdown(markdown),
      });
      return;
    }
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeDownloadName(task.title || "未命名任务")}.md`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Failed to export task document.", error);
    showWorkspaceError("导出失败，请稍后重试。");
  }
}

function taskMarkdown(task) {
  const summary = taskSummary(task);
  const tags = Object.entries(normalizeTaskTags(task.tags))
    .filter(([, active]) => active)
    .map(([tag]) => taskTagLabels[tag]);
  const groupTitle = state.taskGroups.find((group) => group.id === task.groupId)?.title || "默认";
  const lines = [
    `# ${task.title || "未命名任务"}`,
    "",
    `- 分组：${groupTitle}`,
    `- 优先级：${priorityLabels[task.priority] || "中"}`,
    `- 状态：${task.status === "done" ? "已完成" : "处理中"}`,
    `- 节点：${summary.done}/${summary.total || 0}`,
    ...(task.deadlineAt ? [`- 截止时间：${formatMinuteStamp(task.deadlineAt)}`] : []),
    ...(task.deadlineAt ? [`- 截止提醒：${deadlineReminderLabels[task.deadlineReminderMinutes === null ? "none" : normalizeDeadlineReminderMinutes(task.deadlineReminderMinutes)]}`] : []),
    `- 创建时间：${formatShort(task.createdAt)}`,
    `- 更新时间：${formatShort(task.updatedAt)}`,
    ...(tags.length ? [`- 标记：${tags.join("、")}`] : []),
    "",
    "## 背景",
    task.description.trim() || "暂无",
    "",
    "## 当前判断",
    task.hypothesis.trim() || "暂无",
    "",
    "## 结论",
    task.conclusion.trim() || "暂无",
    "",
    "## 知识笔记",
    (task.notes || "").trim() || "暂无",
    "",
    "## 处理流",
    "",
  ];
  const nodeLines = task.nodes.length ? sort(task.nodes).flatMap((node) => nodeMarkdownLines(node, 0)) : ["暂无节点"];
  return [...lines, ...nodeLines].join("\n");
}

function nodeMarkdownLines(node, depth) {
  const prefix = `${"  ".repeat(depth)}-`;
  const status = node.status === "done" ? "已完成" : nodeStatusText(node.status);
  const lines = [`${prefix} ${node.title || "未命名节点"}（${status}）`];
  if ((node.note || "").trim()) {
    lines.push("", `${"  ".repeat(depth + 1)}记录：`, indentMarkdown(node.note.trim(), depth + 1), "");
  }
  sort(node.children).forEach((child) => lines.push(...nodeMarkdownLines(child, depth + 1)));
  return lines;
}

function indentMarkdown(value, depth) {
  const prefix = "  ".repeat(depth);
  return String(value || "")
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function safeDownloadName(value) {
  return String(value || "task").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "task";
}

/**
 * Handle inline edits from [data-edit-key] elements.
 * Updates a specific state field and triggers save.
 * @param {object} data - DOM dataset with { editKey, taskId, nodeId }
 * @param {string} value - New value from the input element
 */
function edit(data, value) {
  const task = state.tasks.find((item) => item.id === data.taskId);
  if (!task) return;

  if (!data.nodeId) {
    if (data.editKey === "groupId") {
      task.groupId = normalizeActiveGroupId(value, state.taskGroups);
      state.activeGroupId = task.groupId;
    } else {
      task[data.editKey] = value;
    }
    if (data.editKey === "title") {
      task.knowledgeNote = knowledgeDocument.updateDocumentTitle(task.knowledgeNote, value);
    }
    if (data.editKey === "title") syncTaskTitleInputs(task.id, value);
    if (data.editKey === "hypothesis") task.hypothesisUpdatedAt = now();
    if (data.editKey === "conclusion" && value.trim()) clearConclusionNotice(task.id);
    task.updatedAt = now();
    save();
    return;
  }

  const node = findNode(task.nodes, data.nodeId);
  if (!node) return;
  if (data.editKey === "status") {
    markNodeStatus(data.taskId, data.nodeId, value);
    return;
  }
  node[data.editKey] = value;
  node.updatedAt = now();
  task.updatedAt = now();
  save();

  if (data.editKey === "title") {
    const title = document.querySelector(`.flow-title-input[data-node-id="${escSelectorValue(data.nodeId)}"]`);
    if (title) title.value = value || "";
  }
}

function syncTaskTitleInputs(taskId, value) {
  document.querySelectorAll('[data-edit-key="title"][data-task-id]').forEach((element) => {
    if (element === document.activeElement || element.dataset.taskId !== taskId || element.dataset.nodeId) return;
    element.value = value || "";
  });
}

function rememberGlobalListReturn(focusSelector) {
  if (!state.calendarOpen && !state.reviewOpen) return;
  state.globalListReturn = {
    route: state.calendarOpen ? "calendar" : "review",
    context: shellCaptureJourneyContext(),
    focusSelector,
  };
}

function openTaskFromGlobalList(taskId, nodeId = "", options = {}) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const fromPage = state.calendarOpen || state.reviewOpen;
  const fromSettings = state.settingsOpen;
  if (fromPage) {
    rememberGlobalListReturn(`[data-action="${state.calendarOpen ? "open-calendar-task" : "open-review-task"}"][data-task-id="${escSelectorValue(taskId)}"]`);
    state.captureSourceFilter = "all";
    state.taskPane = "flow";
    state.settingsOpen = false;
  } else state.globalListReturn = null;
  state.settingsOpen = false;
  state.captureSourceFilter = "all";
  if (fromSettings || nodeId) state.taskPane = "flow";
  const keepTodayView = options.keepToday === true && state.taskFilter === "today";
  state.activeGroupId = fromPage ? ALL_TASKS_GROUP_ID : task.groupId || UNGROUPED_TASKS_GROUP_ID;
  state.activeTaskId = task.id;
  state.selectedNodeId = nodeId;
  state.recordDraft = nodeId ? findNode(task.nodes, nodeId)?.note || "" : "";
  state.nodeDetailFullscreen = false;
  state.nodeDetailPosition = null;
  if (!keepTodayView) {
    state.taskFilter = "all";
    state.taskDateFilter = "";
    state.taskDeadlineFilter = "all";
    state.priorityFilter = "all";
  }
  state.query = "";
  state.reviewOpen = false;
  state.calendarOpen = false;
}

function createTaskFromBlank(title) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return;

  createTask(normalizedTitle);
}

function addBlankTask() {
  createTask("", false);
}


// ============================================================
// TASK & NODE CRUD (create, delete, reorder, etc.)
// ============================================================
/**
 * Create a new task with the given title.
 * @param {string} title - Task title
 * @param {boolean} shouldRender - Whether to re-render after creation
 * @returns {object} The newly created task
 */
function createTask(title, shouldRender = true) {
  const taskId = id("task");
  const createdAt = now();
  const task = {
    id: taskId,
    order: state.tasks.length + 1,
    todayTaskOrder: 0,
    todayQuickCaptureOrder: 0,
    groupId: state.activeGroupId === ALL_TASKS_GROUP_ID
      ? state.taskGroups[0]?.id || ""
      : state.activeGroupId === UNGROUPED_TASKS_GROUP_ID
        ? ""
        : normalizeActiveGroupId(state.activeGroupId, state.taskGroups),
    title,
    description: "",
    status: "active",
    priority: state.newTaskPriority,
    tags: normalizeTaskTags({}),
    recurrence: normalizeTaskRecurrence({}),
    hypothesis: "",
    hypothesisUpdatedAt: "",
    conclusion: "",
    navigationRecovery: workNavigationModel.normalizeRecovery(null),
    estimateMinutes: 0,
    origin: null,
    deadlineAt: "",
    deadlineReminderMinutes: defaultDeadlineReminderMinutes,
    notes: "",
    knowledgeNote: knowledgeDocument.createKnowledgeNoteMetadata({
      noteId: id("note"),
      taskId,
      title,
      createdAt,
      updatedAt: createdAt,
    }),
    createdAt,
    updatedAt: createdAt,
    nodes: [],
  };
  state.tasks.push(task);
  recurringTodaySignature = recurringScheduleSignature(new Date(createdAt));
  state.activeTaskId = task.id;
  state.selectedNodeId = "";
  state.taskFilter = "all";
  state.taskDateFilter = "";
  state.taskDeadlineFilter = "all";
  state.priorityFilter = "all";
  state.captureSourceFilter = "all";
  state.query = "";
  state.focusTaskTitleId = task.id;
  state.revealTaskId = task.id;
  save();
  if (shouldRender) render();
  return task;
}

function createQuickCapture(title, description = "", addToToday = false) {
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle) return null;
  const previousActiveTaskId = state.activeTaskId;
  const previousActiveGroupId = state.activeGroupId;
  const {
    taskFilter,
    taskDateFilter,
    taskDeadlineFilter,
    priorityFilter,
    captureSourceFilter,
    query,
    focusTaskTitleId,
    revealTaskId,
    selectedNodeId,
  } = state;
  const previousRepositoryState = {
    taskFilter,
    taskDateFilter,
    taskDeadlineFilter,
    priorityFilter,
    captureSourceFilter,
    query,
    focusTaskTitleId,
    revealTaskId,
    selectedNodeId,
  };
  const task = createTask(normalizedTitle, false);
  if (!task) return null;
  const asTodayTask = addToToday === true;
  task.groupId = "";
  task.priority = "low";
  // "加入今日任务" makes the record a Today task, not a quick note that merely
  // carries the today tag: the Today lane lists tasks, and a capture keeps its
  // quick identity only while it stays in the capture lane. This mirrors the
  // cross-lane move (moveTodayWidgetItem), which clears captureSource the same way.
  task.captureSource = asTodayTask ? "" : "today-widget";
  if (!asTodayTask) {
    const orderedCaptures = state.tasks.filter((item) => (
      item.id !== task.id &&
      item.captureSource === "today-widget" &&
      item.status !== "done" &&
      item.todayQuickCaptureOrder > 0
    ));
    if (orderedCaptures.length) {
      orderedCaptures.forEach((item) => { item.todayQuickCaptureOrder += 1; });
      task.todayQuickCaptureOrder = 1;
    }
  }
  task.description = String(description || "").trim();
  task.tags = normalizeTaskTags({ today: asTodayTask });
  task.updatedAt = now();
  state.activeGroupId = previousActiveGroupId;
  state.activeTaskId = previousActiveTaskId;
  Object.assign(state, previousRepositoryState);
  save();
  render();
  return task;
}

function updateTaskTitleFromWidget(taskId, title) {
  const task = state.tasks.find((item) => item.id === taskId);
  const normalizedTitle = String(title || "").trim();
  if (!task) return { success: false, code: "TASK_NOT_FOUND" };
  if (!normalizedTitle) return { success: false, code: "INVALID_TITLE" };
  task.title = normalizedTitle;
  task.knowledgeNote = knowledgeDocument.updateDocumentTitle(task.knowledgeNote, normalizedTitle);
  task.updatedAt = now();
  save();
  render();
  return { success: true, code: "UPDATED", taskId };
}

function promoteQuickCaptureFromWidget(taskId, groupId) {
  const task = state.tasks.find((item) => item.id === taskId && item.captureSource === "today-widget");
  const group = state.taskGroups.find((item) => item.id === groupId);
  if (!task) return { success: false, code: "TASK_NOT_FOUND" };
  if (!group) return { success: false, code: "GROUP_NOT_FOUND" };
  task.groupId = group.id;
  task.captureSource = "";
  task.todayQuickCaptureOrder = 0;
  task.updatedAt = now();
  save();
  render();
  return { success: true, code: "PROMOTED", taskId: task.id };
}

async function deleteQuickCaptureFromWidget(taskId) {
  const task = state.tasks.find((item) => item.id === taskId && item.captureSource === "today-widget");
  if (!task) return { success: false, code: "TASK_NOT_FOUND", taskId };
  // Phase26: the floating window's quick note is deleted with the same business
  // semantics as the main window — archived first, removed second, undoable from
  // 最近删除 in the main window.
  if (typeof recovery26DeleteQuickFromWidget === "function") return recovery26DeleteQuickFromWidget(taskId);
  const deleted = await deleteTask(taskId, { skipConfirm: true });
  if (!deleted) return { success: false, code: "DELETE_CANCELLED", taskId };
  render();
  return { success: true, code: "DELETED", taskId };
}

/**
 * Select a task group by ID, switching the active view.
 * @param {string} groupId - Target group ID
 */
function selectGroup(groupId) {
  state.globalListReturn = null;
  state.activeGroupId = normalizeActiveGroupId(groupId, state.taskGroups);
  state.activeTaskId = "";
  state.selectedNodeId = "";
  state.nodeDetailFullscreen = false;
  state.nodeDetailPosition = null;
  state.contextMenu = null;
  state.editingGroupId = "";
  state.focusGroupTitleId = "";
  state.query = "";
  repositoryGroupPickerOpen = false;
  repositoryPriorityFilterOpen = false;
  repositoryGroupQuery = "";
}

function addGroup() {
  const group = {
    id: id("group"),
    title: `分组 ${state.taskGroups.length + 1}`,
    order: state.taskGroups.length + 1,
  };
  state.taskGroups.push(group);
  state.activeGroupId = group.id;
  state.editingGroupId = group.id;
  state.focusGroupTitleId = group.id;
  state.activeTaskId = "";
  state.selectedNodeId = "";
  state.query = "";
  repositoryGroupPickerOpen = true;
  repositoryGroupQuery = "";
}

function startRenameGroup(groupId) {
  if (!state.taskGroups.some((group) => group.id === groupId)) return;
  state.editingGroupId = groupId;
  state.focusGroupTitleId = groupId;
  repositoryGroupPickerOpen = true;
  repositoryGroupQuery = "";
}

function renameGroup(groupId, value, commit = false) {
  const group = state.taskGroups.find((item) => item.id === groupId);
  if (!group) return;
  const title = String(value || "").trim();
  if (title) group.title = title;
  if (commit) state.editingGroupId = "";
  save();
}

/**
 * Delete a task group and either ungroup or delete the tasks it contains.
 * @param {string} groupId - Group ID to delete
 * @param {"ungroup"|"delete"} taskPolicy - How to handle tasks in the group
 * @param {{ skipConfirm?: boolean }} [options] - The phase24a impact panel already
 *   states the impact and takes an explicit decision, so the native prompt would
 *   be a second, redundant confirmation (same contract as deleteTask's).
 */
async function deleteGroup(groupId, taskPolicy = "ungroup", { skipConfirm = false } = {}) {
  const group = state.taskGroups.find((item) => item.id === groupId);
  if (!group) return false;
  const deleteTasks = taskPolicy === "delete";
  const prompt = deleteTasks
    ? `确定删除分组「${group.title}」以及其中的所有任务吗？此操作不可撤销。`
    : `确定删除分组「${group.title}」吗？其中的任务会保留并移至未分组。`;
  if (!skipConfirm && !(await confirmDestructiveAction(prompt))) return false;

  if (deleteTasks) {
    if (state.tasks.some((task) => task.groupId === groupId && task.id === state.activeTaskId)) {
      state.activeTaskId = "";
      state.selectedNodeId = "";
    }
    state.tasks = state.tasks.filter((task) => task.groupId !== groupId);
  } else {
    state.tasks.forEach((task) => {
      if (task.groupId === groupId) {
        task.groupId = "";
        task.updatedAt = now();
      }
    });
  }
  state.taskGroups = state.taskGroups.filter((item) => item.id !== groupId);
  state.taskGroups = normalizeTaskGroups(state.taskGroups, state.tasks);
  if (normalizeCurrentWorkNavigation().config.growth.sourceGroupId === groupId) {
    state.workNavigation.config.growth.sourceGroupId = "";
    state.workNavigation.runtime.activeGrowthTaskId = "";
  }
  if (state.activeGroupId === groupId) {
    state.activeGroupId = deleteTasks ? ALL_TASKS_GROUP_ID : UNGROUPED_TASKS_GROUP_ID;
    state.activeTaskId = tasksInActiveGroup()[0]?.id || "";
    state.selectedNodeId = "";
  }
  state.editingGroupId = "";
  state.focusGroupTitleId = "";
  save();
  return true;
}

/**
 * Reorder groups via drag-and-drop.
 * @param {string} sourceId - Dragged group ID
 * @param {string} targetId - Drop target group ID
 */
function reorderGroups(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const groups = sort(state.taskGroups);
  const sourceIndex = groups.findIndex((group) => group.id === sourceId);
  const targetIndex = groups.findIndex((group) => group.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [source] = groups.splice(sourceIndex, 1);
  groups.splice(targetIndex, 0, source);
  reorder(groups);
  state.taskGroups = groups;
  save();
}

/**
 * Reorder tasks via drag-and-drop within a group.
 * @param {string} sourceId - Dragged task ID
 * @param {string} targetId - Drop target task ID
 * @param {"before"|"after"} placement - Insert above or below the target task
 */
function reorderTasks(sourceId, targetId, placement = "before") {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const visibleTasks = filteredTasks();
  const sourceIndex = visibleTasks.findIndex((task) => task.id === sourceId);
  if (sourceIndex < 0 || !visibleTasks.some((task) => task.id === targetId)) return;

  const orderedVisible = [...visibleTasks];
  const [source] = orderedVisible.splice(sourceIndex, 1);
  const adjustedTargetIndex = orderedVisible.findIndex((task) => task.id === targetId);
  if (adjustedTargetIndex < 0) return;
  const insertionIndex = placement === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  orderedVisible.splice(insertionIndex, 0, source);

  const visibleIds = new Set(visibleTasks.map((task) => task.id));
  const orderedScope = sort(taskListScopeTasks());
  const visibleQueue = [...orderedVisible];
  const nextScope = orderedScope.map((task) => (visibleIds.has(task.id) ? visibleQueue.shift() : task));
  reorder(nextScope);
  state.activeTaskId = sourceId;
  save();
}

function scrollSheets(direction) {
  const tabs = document.querySelector("[data-sheet-tabs]");
  if (!tabs) return;
  tabs.scrollBy({ left: direction * Math.max(120, tabs.clientWidth * 0.72), behavior: "smooth" });
}

function activeMarkdownEditor() {
  const active = document.activeElement;
  if (active?.classList?.contains("markdown-editor")) return active;
  return document.querySelector(".markdown-editor");
}

function applyMarkdownTool(tool) {
  const editor = activeMarkdownEditor();
  if (!editor) return;
  editor.focus();
  const start = editor.selectionStart || 0;
  const end = editor.selectionEnd || 0;
  const selected = editor.value.slice(start, end);
  const fallback = selected || "文本";
  const lineStart = editor.value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const beforeLine = editor.value.slice(lineStart, start);
  let next = "";
  let cursorStart = start;
  let cursorEnd = end;

  if (tool === "heading") {
    next = `${beforeLine ? "\n" : ""}## ${fallback}`;
    cursorStart = start + next.length;
    cursorEnd = cursorStart;
  } else if (tool === "bold") {
    next = `**${fallback}**`;
    cursorStart = start + 2;
    cursorEnd = cursorStart + fallback.length;
  } else if (tool === "italic") {
    next = `*${fallback}*`;
    cursorStart = start + 1;
    cursorEnd = cursorStart + fallback.length;
  } else if (tool === "quote") {
    next = selected
      ? selected
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")
      : `${beforeLine ? "\n" : ""}> 引用`;
    cursorStart = start + next.length;
    cursorEnd = cursorStart;
  } else if (tool === "code") {
    next = selected.includes("\n") ? `\n\`\`\`\n${selected}\n\`\`\`\n` : `\`${fallback}\``;
    cursorStart = start + (selected.includes("\n") ? next.length : 1);
    cursorEnd = selected.includes("\n") ? cursorStart : cursorStart + fallback.length;
  } else if (tool === "list") {
    next = selected
      ? selected
          .split("\n")
          .map((line) => `- ${line}`)
          .join("\n")
      : `${beforeLine ? "\n" : ""}- 列表项`;
    cursorStart = start + next.length;
    cursorEnd = cursorStart;
  } else if (tool === "ordered") {
    next = selected
      ? selected
          .split("\n")
          .map((line, index) => `${index + 1}. ${line}`)
          .join("\n")
      : `${beforeLine ? "\n" : ""}1. 列表项`;
    cursorStart = start + next.length;
    cursorEnd = cursorStart;
  } else if (tool === "todo") {
    next = selected
      ? selected
          .split("\n")
          .map((line) => `- [ ] ${line}`)
          .join("\n")
      : `${beforeLine ? "\n" : ""}- [ ] 待办事项`;
    cursorStart = start + next.length;
    cursorEnd = cursorStart;
  } else if (tool === "link") {
    next = `[${fallback}](https://example.com)`;
    cursorStart = start + fallback.length + 3;
    cursorEnd = cursorStart + "https://example.com".length;
  } else if (tool === "image") {
    next = `![图片](https://example.com/image.png)`;
    cursorStart = start + 6;
    cursorEnd = cursorStart + "https://example.com/image.png".length;
  } else if (tool === "divider") {
    next = `${beforeLine ? "\n" : ""}---\n`;
    cursorStart = start + next.length;
    cursorEnd = cursorStart;
  }

  if (!next) return;
  replaceEditorSelection(editor, next, cursorStart, cursorEnd);
}

function replaceEditorSelection(editor, value, cursorStart, cursorEnd = cursorStart) {
  const start = editor.selectionStart || 0;
  const end = editor.selectionEnd || 0;
  editor.value = `${editor.value.slice(0, start)}${value}${editor.value.slice(end)}`;
  editor.selectionStart = cursorStart;
  editor.selectionEnd = cursorEnd;
  if (editor.classList.contains("markdown-editor")) {
    updateNodeNoteDraft(editor.dataset.taskId, editor.dataset.nodeId, editor.value, editor.closest(".milkdown-editor-host"));
  } else {
    edit(editor.dataset, editor.value);
  }
  if (editor.classList.contains("markdown-editor")) updateMarkdownEditorState(editor);
}

async function handleMarkdownPaste(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const files = Array.from(event.clipboardData?.files || []);
  const types = Array.from(event.clipboardData?.types || []);
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  const file = files.find((item) => item.type.startsWith("image/")) || imageItem?.getAsFile();
  if (!file) {
    const text = event.clipboardData?.getData("text/plain") || "";
    const mayContainImage = types.some((type) => /image|file|tiff|png/i.test(type));
    if (text && !mayContainImage) return;
    event.preventDefault();
    const dataUrl = await window.personalTaskTrack?.clipboard?.readImageDataUrl?.();
    if (!dataUrl) {
      if (text) insertTextIntoEditor(event.currentTarget, text);
      return;
    }
    insertMarkdownImage(event.currentTarget, dataUrl);
    return;
  }
  event.preventDefault();
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    insertMarkdownImage(event.currentTarget, reader.result);
  });
  reader.readAsDataURL(file);
}

function handleMarkdownDrop(event) {
  const editor = event.currentTarget;
  editor.closest(".markdown-panel")?.classList.remove("dragging-image");
  const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  event.preventDefault();
  files.forEach((file) => insertImageFile(editor, file));
}

function handleMarkdownPasteShortcut(event) {
  const editor = event.currentTarget;
  const dataUrl = window.personalTaskTrack?.clipboard?.readImageDataUrlSync?.();
  if (!dataUrl) return;
  event.preventDefault();
  insertMarkdownImage(editor, dataUrl);
}

function insertEditorText(editor, text) {
  const start = editor.selectionStart || 0;
  replaceEditorSelection(editor, text, start + text.length);
}

function insertImageFile(editor, file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => insertMarkdownImage(editor, reader.result));
  reader.readAsDataURL(file);
}

function hasDraggedImage(event) {
  const items = Array.from(event.dataTransfer?.items || []);
  const files = Array.from(event.dataTransfer?.files || []);
  return items.some((item) => item.type.startsWith("image/")) || files.some((file) => file.type.startsWith("image/"));
}

function updateMarkdownStats(editor) {
  const stats = markdownStats(editor.value);
  const statsElement = (editor.closest(".knowledge-pane") || editor.closest(".markdown-panel"))?.querySelector("[data-markdown-stats], [data-note-stats]");
  if (statsElement) statsElement.textContent = `${stats.lines} 行 · ${stats.characters} 字`;
}

function updateMarkdownEditorState(editor) {
  updateMarkdownStats(editor);
  const strip = editor.closest(".markdown-panel")?.querySelector(".editor-image-strip");
  if (!strip) return;
  const images = markdownImages(editor.value);
  strip.classList.toggle("empty", images.length === 0);
  strip.innerHTML = images
    .map((image) => `<figure><img src="${image.src}" alt="${escAttr(image.alt || "图片")}" /><figcaption>${esc(image.alt || "图片")}</figcaption></figure>`)
    .join("");
}

/**
 * Export a node detail view as PDF via Electron IPC.
 * Captures current Milkdown draft content before export.
 * @param {string} taskId - Task ID
 * @param {string} nodeId - Node ID to export
 */
async function exportNodePdf(taskId, nodeId) {
  const task = state.tasks.find((item) => item.id === taskId);
  const node = task ? findNode(task.nodes, nodeId) : null;
  if (!task || !node) return;
  if (!desktopExport?.nodeDetailPdf) {
    showWorkspaceError("当前环境不支持 PDF 导出。请在桌面应用中使用。");
    return;
  }

  try {
    await desktopExport.nodeDetailPdf({
      taskTitle: task.title || "未命名任务",
      nodeTitle: node.title || "未命名节点",
      status: nodeStatusText(node.status),
      updatedAt: formatShort(node.updatedAt || task.updatedAt || now()),
      html: renderMarkdown(node.note),
    });
  } catch (error) {
    console.error("Failed to export node detail PDF.", error);
    showWorkspaceError("PDF 导出失败，请稍后重试。");
  }
}

function toggleTaskTag(taskId, tag) {
  if (!Object.hasOwn(taskTagLabels, tag)) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  task.tags = normalizeTaskTags(task.tags);
  task.tags[tag] = !task.tags[tag];
  task.updatedAt = now();
}

function updateTaskRecurrence(taskId, field, value) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || !["frequency", "weekday", "time"].includes(field)) return;
  const previous = normalizeTaskRecurrence(task.recurrence);
  const next = { ...previous };
  if (field === "frequency") {
    next.frequency = recurrenceFrequencies.has(value) ? value : "none";
    if (next.frequency === "weekly" && previous.weekdays.length === 0) next.weekdays = [loopNow().getDay()];
    if (next.frequency === "none") next.lastCompletedOccurrence = "";
  }
  if (field === "weekday") {
    const weekday = Number(value);
    if (!recurrenceWeekdayOrder.includes(weekday)) return;
    next.weekdays = previous.weekdays.includes(weekday)
      ? previous.weekdays.filter((value) => value !== weekday)
      : recurrenceWeekdayOrder.filter((value) => previous.weekdays.includes(value) || value === weekday);
  }
  if (field === "time") next.time = value;
  task.recurrence = normalizeTaskRecurrence(next);
  task.updatedAt = now();
  save();
}

/**
 * Delete a task and all its nodes.
 * @param {string} taskId - Task ID to delete
 */
async function deleteTask(taskId, { skipDraftPrompt = false, skipConfirm = false } = {}) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return false;
  if (!skipDraftPrompt && task.knowledgeNote?.documentState === "DRAFT" && String(task.notes || "").trim()) {
    state.knowledgeDraftPrompt = { taskId };
    render();
    return false;
  }
  // skipConfirm: the Today widget already confirmed in the Demo's own dialog, so
  // the native prompt would be a second, redundant confirmation. The knowledge
  // draft prompt above still applies.
  if (!skipConfirm && !(await confirmDestructiveAction(`确定删除任务「${task.title || "未命名任务"}」及其所有节点？`))) return false;
  const index = state.tasks.findIndex((item) => item.id === taskId);
  if (desktopKnowledgeFile?.unwatch) {
    void desktopKnowledgeFile.unwatch({ noteId: task.knowledgeNote?.noteId || task.id });
  }
  state.tasks = state.tasks.filter((item) => item.id !== taskId);
  const navigation = normalizeCurrentWorkNavigation();
  if (navigation.runtime.activeWorkTaskId === taskId) navigation.runtime.activeWorkTaskId = "";
  if (navigation.runtime.activeGrowthTaskId === taskId) navigation.runtime.activeGrowthTaskId = "";
  reorder(state.tasks);
  if (state.activeTaskId === taskId) {
    const groupTasks = tasksInActiveGroup();
    state.activeTaskId = groupTasks[Math.max(0, index - 1)]?.id || groupTasks[0]?.id || "";
    state.selectedNodeId = "";
  }
  save();
  return true;
}

/**
 * Toggle task done/undone status, updating all nodes accordingly.
 * @param {string} taskId - Task ID to toggle
 */
function toggleTaskDone(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return { success: false, code: "TASK_NOT_FOUND" };
  if (task.status !== "done") {
    const blocker = taskCompletionBlocker(task);
    if (blocker) {
      // keep the inline prompt state (the list still marks the task), then add
      // the Demo phase 17 readiness panel that links to the exact record.
      showCompletionNotice(taskId, blocker);
      if (typeof shellCompletionReadiness === "function") shellCompletionReadiness(taskId, document.activeElement);
      // Phase19: that panel lives in this window, so a minimized window must
      // come back before the user can read it.
      void window.personalTaskTrack?.window?.revealMain?.().catch(() => {});
      return { success: false, code: blocker, taskId };
    }
  }
  const wasDone = task.status === "done";
  const occurrence = recurringOccurrenceKey(task);
  task.status = wasDone ? "active" : "done";
  task.recurrence = normalizeTaskRecurrence(task.recurrence);
  if (wasDone && occurrence && task.recurrence.lastCompletedOccurrence === occurrence) {
    task.recurrence.lastCompletedOccurrence = "";
  } else if (!wasDone && occurrence) {
    task.recurrence.lastCompletedOccurrence = occurrence;
  }
  if (task.status === "done") {
    task.resolvedAt = now();
    clearCompletionNotice(taskId);
  }
  task.updatedAt = now();
  return { success: true, code: task.status === "done" ? "COMPLETED" : "REOPENED", taskId };
}

function taskCompletionBlocker(task) {
  if (!task.conclusion.trim()) return "CONCLUSION_REQUIRED";
  if (flatten(task.nodes).some((node) => node.status !== "done")) return "FLOW_INCOMPLETE";
  return "";
}

function showCompletionNotice(taskId, code) {
  clearWorkspaceFeedback("completion");
  state.conclusionPromptTaskId = code === "CONCLUSION_REQUIRED" ? taskId : "";
  state.flowPromptTaskId = code === "FLOW_INCOMPLETE" ? taskId : "";
  showWorkspaceFeedback(renderCompletionNotice(), "", { source: "completion", onDismiss: () => clearCompletionNotice(taskId) });
}

function clearConclusionNotice(taskId) {
  if (state.conclusionPromptTaskId !== taskId) return;
  state.conclusionPromptTaskId = "";
  clearCompletionNoticeElement();
}

function clearCompletionNotice(taskId) {
  if (state.conclusionPromptTaskId === taskId) state.conclusionPromptTaskId = "";
  if (state.flowPromptTaskId === taskId) state.flowPromptTaskId = "";
  clearCompletionNoticeElement();
}

function clearCompletionNoticeElement() {
  clearWorkspaceFeedback("completion");
  document.querySelector(".task-brief label.needs-attention")?.classList.remove("needs-attention");
}

/**
 * Add a new node (step or subtask) to a task.
 * @param {string} taskId - Parent task ID
 * @param {string|null} parentId - null for root step, node ID for child
 */
function addNode(taskId, parentId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  let created = null;
  if (!parentId) {
    created = makeNode(taskId, null, task.nodes.length + 1);
    task.nodes.push(created);
  } else {
    const parent = findNode(task.nodes, parentId);
    if (!parent) return;
    parent.collapsed = false;
    created = makeNode(taskId, parentId, parent.children.length + 1);
    parent.children.push(created);
  }
  task.updatedAt = now();
  state.selectedNodeId = "";
  state.nodeDetailFullscreen = false;
  state.nodeDetailPosition = null;
  state.focusNodeTitleId = created.id;
}

function addSiblingNode(taskId, nodeId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const found = findNodeCollection(task.nodes, nodeId);
  if (!found) return;

  const created = makeNode(taskId, found.node.parentId || null, found.index + 2);
  found.items.splice(found.index + 1, 0, created);
  reorder(found.items);
  task.updatedAt = now();
  state.selectedNodeId = "";
  state.nodeDetailFullscreen = false;
  state.nodeDetailPosition = null;
  state.focusNodeTitleId = created.id;
}


// ============================================================
// NODE UTILITY FUNCTIONS (find, flatten, sort)
// ============================================================
function toggleNodeDone(taskId, nodeId) {
  const task = state.tasks.find((item) => item.id === taskId);
  const node = task ? findNode(task.nodes, nodeId) : null;
  if (!task || !node) return;
  if (node.status !== "todo" && node.status !== "done") return;
  const timestamp = now();
  node.status = node.status === "done" ? "todo" : "done";
  node.statusChangedAt = timestamp;
  node.updatedAt = timestamp;
  node.completedAt = node.status === "done" ? timestamp : "";
  task.updatedAt = timestamp;
}

function toggleNodeCollapse(taskId, nodeId) {
  const task = state.tasks.find((item) => item.id === taskId);
  const node = task ? findNode(task.nodes, nodeId) : null;
  if (!task || !node || !node.children.length) return;
  node.collapsed = !node.collapsed;
  task.updatedAt = now();
}

function toggleAllNodes(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const nodes = flatten(task.nodes).filter((node) => node.children.length);
  const shouldCollapse = !nodes.every((node) => node.collapsed);
  nodes.forEach((node) => {
    node.collapsed = shouldCollapse;
  });
  task.updatedAt = now();
}

function markNodeStatus(taskId, nodeId, status) {
  const task = state.tasks.find((item) => item.id === taskId);
  const node = task ? findNode(task.nodes, nodeId) : null;
  if (!task || !node || !nodeStatusValues.has(status)) return;
  if (node.status === status) return;
  const timestamp = now();
  node.status = status;
  node.statusChangedAt = timestamp;
  node.updatedAt = timestamp;
  node.completedAt = status === "done" ? timestamp : "";
  task.updatedAt = timestamp;
}

function cycleNodeStatus(taskId, nodeId) {
  const task = state.tasks.find((item) => item.id === taskId);
  const node = task ? findNode(task.nodes, nodeId) : null;
  if (!node) return;
  const statusCycle = ["todo", "later", "done", "blocked"];
  const currentIndex = statusCycle.indexOf(node.status);
  markNodeStatus(taskId, nodeId, statusCycle[(currentIndex + 1) % statusCycle.length]);
}

/**
 * Delete a node and its descendants from a task's node tree.
 * @param {string} taskId - Task containing the node
 * @param {string} nodeId - Node ID to delete
 */
async function deleteNode(taskId, nodeId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || !(await confirmDestructiveAction("确定删除这个节点及其子节点？"))) return false;
  const deletedNode = findNode(task.nodes, nodeId);
  const deletedIds = new Set(deletedNode ? flatten([deletedNode]).map((node) => node.id) : []);
  task.nodes = removeNode(task.nodes, nodeId);
  task.updatedAt = now();
  if (deletedIds.has(state.selectedNodeId)) {
    state.selectedNodeId = "";
    state.recordDraft = "";
    state.nodeDetailFullscreen = false;
    state.nodeDetailPosition = null;
  }
  return true;
}

function activeTask() {
  const scopedTasks = taskListScopeTasks();
  const selectedTask = scopedTasks.find((task) => task.id === state.activeTaskId);
  if (selectedTask) return selectedTask;
  const visibleTasks = filteredTasks({ includeQuery: false });
  return visibleTasks[0] || null;
}

/**
 * Recursively find a node by ID in a node tree.
 * @param {Array} nodes - Node array to search
 * @param {string} nodeId - Target node ID
 * @returns {object|null} Found node or null
 */
function findNode(nodes, nodeId) {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const found = findNode(node.children, nodeId);
    if (found) return found;
  }
  return null;
}

function findNodeCollection(nodes, nodeId) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.id === nodeId) return { items: nodes, index, node };
    const found = findNodeCollection(node.children, nodeId);
    if (found) return found;
  }
  return null;
}

function removeNode(nodes, nodeId) {
  return nodes.filter((node) => node.id !== nodeId).map((node) => ({ ...node, children: removeNode(node.children, nodeId) }));
}

/**
 * Move a node subtree to a sibling position, into another node, or to root.
 * @param {string} taskId - Task containing both source and target
 * @param {string} sourceId - Root of the subtree being moved
 * @param {string} targetId - Target node, empty for root append
 * @param {"before"|"inside"|"after"|"root"} placement - Destination relative to target
 * @returns {boolean} Whether a valid move was applied
 */
function moveFlowNode(taskId, sourceId, targetId = "", placement = "inside") {
  const task = state.tasks.find((item) => item.id === taskId);
  const allowedPlacements = new Set(["before", "inside", "after", "root"]);
  if (!task || !sourceId || !allowedPlacements.has(placement)) return false;

  const sourceCollection = findNodeCollection(task.nodes, sourceId);
  const sourceNode = sourceCollection?.node;
  if (!sourceCollection || !sourceNode) return false;
  if (placement !== "root" && (!targetId || !findNode(task.nodes, targetId))) return false;
  if (targetId && (targetId === sourceId || findNode(sourceNode.children, targetId))) return false;

  sourceCollection.items.sort((a, b) => a.order - b.order);
  const sourceIndex = sourceCollection.items.findIndex((node) => node.id === sourceId);
  if (sourceIndex < 0) return false;
  sourceCollection.items.splice(sourceIndex, 1);
  reorder(sourceCollection.items);

  let targetItems = task.nodes;
  let targetParentId = null;
  let insertionIndex = targetItems.length;
  let insideTarget = null;

  if (placement === "inside") {
    insideTarget = findNode(task.nodes, targetId);
    if (!insideTarget) return false;
    targetItems = insideTarget.children;
    targetParentId = insideTarget.id;
    targetItems.sort((a, b) => a.order - b.order);
    insertionIndex = targetItems.length;
  } else if (placement === "before" || placement === "after") {
    const targetCollection = findNodeCollection(task.nodes, targetId);
    if (!targetCollection) return false;
    targetItems = targetCollection.items;
    targetItems.sort((a, b) => a.order - b.order);
    const targetIndex = targetItems.findIndex((node) => node.id === targetId);
    if (targetIndex < 0) return false;
    targetParentId = targetCollection.node.parentId || null;
    insertionIndex = placement === "after" ? targetIndex + 1 : targetIndex;
  } else {
    targetItems.sort((a, b) => a.order - b.order);
    insertionIndex = targetItems.length;
  }

  const changedAt = now();
  sourceNode.parentId = targetParentId;
  sourceNode.type = targetParentId ? "subtask" : "step";
  sourceNode.updatedAt = changedAt;
  targetItems.splice(insertionIndex, 0, sourceNode);
  reorder(targetItems);
  if (insideTarget) insideTarget.collapsed = false;
  task.updatedAt = changedAt;
  return true;
}

/**
 * Flatten a nested node tree into a single array (pre-order traversal).
 * @param {Array} nodes - Nested node array
 * @returns {Array} Flat node array
 */
function flatten(nodes) {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

function sort(nodes) {
  return [...nodes].sort((a, b) => a.order - b.order);
}

function reorder(nodes) {
  nodes.forEach((node, index) => {
    node.order = index + 1;
  });
}

function nodeStatusText(status) {
  if (status === "done") return "已完成";
  if (status === "blocked") return "卡住";
  if (status === "later") return "稍后";
  return "未完成";
}

function nodeStatusBadgeText(status) {
  if (status === "done") return "done";
  if (status === "blocked") return "blocked";
  if (status === "later") return "doing";
  return "todo";
}


// ============================================================
// MARKDOWN RENDERING (plain text -> HTML)
// ============================================================
/**
 * Render Markdown text to HTML.
 * Supports: headings, paragraphs, lists (ul/ol), code blocks,
 * blockquotes, task lists, tables, horizontal rules, inline formatting.
 * @param {string} value - Raw Markdown text
 * @returns {string} HTML string
 */
function renderMarkdown(value) {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listType = "";
  let listItems = [];
  let inCode = false;
  let codeLines = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!listType) return;
    html.push(
      `<${listType}>${listItems
        .map((item) => `<li>${typeof item === "object" ? item.html : renderInlineMarkdown(item)}</li>`)
        .join("")}</${listType}>`,
    );
    listType = "";
    listItems = [];
  }

  function flushCode() {
    html.push(`<pre><code>${esc(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.includes("|") && lines[index + 1] && isMarkdownTableDivider(lines[index + 1])) {
      flushParagraph();
      flushList();
      const headers = splitMarkdownTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      html.push(renderMarkdownTable(headers, rows));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push("<hr />");
      continue;
    }

    const quote = line.match(/^\s*>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    const taskItem = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (taskItem) {
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push({
        html: `<span class="md-task"><input type="checkbox" disabled ${taskItem[1].toLowerCase() === "x" ? "checked" : ""} /><span>${renderInlineMarkdown(taskItem[2])}</span></span>`,
      });
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ordered || unordered) {
      const nextType = ordered ? "ol" : "ul";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((ordered || unordered)[1]);
      continue;
    }

    paragraph.push(trimmed);
  }

  if (inCode) flushCode();
  flushParagraph();
  flushList();

  return html.length ? html.join("") : `<p class="markdown-empty">还没有注释。</p>`;
}

/**
 * Render inline Markdown formatting (bold, italic, code, links, images, strikethrough).
 * @param {string} value - Inline text with Markdown syntax
 * @returns {string} HTML string
 */
function renderInlineMarkdown(value) {
  const codeSpans = [];
  const richTokens = [];
  let output = esc(value).replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@CODE_SPAN_${codeSpans.length}@@`;
    codeSpans.push(`<code>${code}</code>`);
    return token;
  });

  output = output.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const safeUrl = resolveMarkdownImageUrl(url);
    if (!safeUrl) return esc(`![${alt}](${url})`);
    const token = `@@RICH_${richTokens.length}@@`;
    richTokens.push(`<img src="${safeUrl}" alt="${escAttr(alt)}" loading="lazy" />`);
    return token;
  });

  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safeUrl = safeMarkdownUrl(url);
    if (!safeUrl) return esc(`[${label}](${url})`);
    const token = `@@RICH_${richTokens.length}@@`;
    richTokens.push(`<a href="${safeUrl}" target="_blank" rel="noreferrer">${label}</a>`);
    return token;
  });

  output = output.replace(/&lt;(https?:\/\/[^&]+)&gt;/g, (_, url) => {
    const safeUrl = safeMarkdownUrl(url);
    if (!safeUrl) return `&lt;${url}&gt;`;
    const token = `@@RICH_${richTokens.length}@@`;
    richTokens.push(`<a href="${safeUrl}" target="_blank" rel="noreferrer">${safeUrl}</a>`);
    return token;
  });

  output = output.replace(/(^|[\s(])((https?:\/\/|mailto:)[^\s<)]+)/g, (match, prefix, url) => {
    const safeUrl = safeMarkdownUrl(url);
    if (!safeUrl) return match;
    const token = `@@RICH_${richTokens.length}@@`;
    richTokens.push(`<a href="${safeUrl}" target="_blank" rel="noreferrer">${safeUrl}</a>`);
    return `${prefix}${token}`;
  });

  output = output
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");

  codeSpans.forEach((code, index) => {
    output = output.replace(`@@CODE_SPAN_${index}@@`, code);
  });
  richTokens.forEach((html, index) => {
    output = output.replace(`@@RICH_${index}@@`, html);
  });

  return output;
}

const ALLOWED_MARKDOWN_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Read the URL scheme the way a browser does. ASCII control characters and
 * spaces inside a scheme are ignored during URL parsing, so "java\tscript:"
 * still executes and a blacklist cannot catch it.
 */
function markdownLinkScheme(value) {
  const normalized = String(value || "").replace(/[\u0000-\u0020\u007f]+/g, "");
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
  return match ? `${match[1].toLowerCase()}:` : "";
}

function safeMarkdownUrl(value) {
  const cleaned = cleanMarkdownUrl(value);
  if (!cleaned) return "";
  const scheme = markdownLinkScheme(cleaned);
  if (scheme) {
    if (scheme === "data:") {
      return /^data:image\//i.test(cleaned.replace(/[\u0000-\u0020\u007f]+/g, "")) ? escAttr(cleaned) : "";
    }
    if (!ALLOWED_MARKDOWN_LINK_SCHEMES.has(scheme)) return "";
  } else if (cleaned.startsWith("//")) {
    // A protocol-relative link inherits the file:// page scheme.
    return "";
  }
  return escAttr(cleaned);
}

function resolveMarkdownImageUrl(value) {
  const cleaned = cleanMarkdownUrl(value);
  if (cleaned.startsWith("task-image:")) {
    const imageId = cleaned.slice("task-image:".length);
    const dataUrl = state.attachments?.images?.[imageId];
    return typeof dataUrl === "string" && dataUrl.startsWith("data:image/") ? escAttr(dataUrl) : "";
  }
  if (cleaned.startsWith("./attachments/") || cleaned.startsWith("attachments/")) {
    const relativePath = cleaned.startsWith("./") ? cleaned : `./${cleaned}`;
    const dataUrl = state.knowledgeAssets?.[relativePath];
    if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) return escAttr(dataUrl);
  }
  return safeMarkdownUrl(cleaned);
}

function cleanMarkdownUrl(value) {
  let cleaned = String(value || "").trim();
  const angled = cleaned.match(/^&lt;(.+)&gt;$/);
  if (angled) cleaned = angled[1];
  const titled = cleaned.search(/\s+(&quot;|&#039;|")/);
  if (titled > -1) cleaned = cleaned.slice(0, titled);
  return cleaned
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function isMarkdownTableDivider(line) {
  const trimmed = line.trim();
  return trimmed.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
}

function splitMarkdownTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderMarkdownTable(headers, rows) {
  return `
    <table>
      <thead><tr>${headers.map((header) => `<th>${renderInlineMarkdown(header)}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows
          .map((row) => `<tr>${headers.map((_, index) => `<td>${renderInlineMarkdown(row[index] || "")}</td>`).join("")}</tr>`)
          .join("")}
      </tbody>
    </table>
  `;
}


// ============================================================
// FORMAT HELPERS (date, text escaping)
// ============================================================
function formatShort(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayQuickCaptureItems() {
  return applyTodayWidgetOrder(state.tasks
    .filter((task) => task.captureSource === "today-widget")
    .sort((a, b) => {
      const aTime = Date.parse(a.updatedAt || a.createdAt);
      const bTime = Date.parse(b.updatedAt || b.createdAt);
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    }), "todayQuickCaptureOrder")
    .map((task) => ({
      taskId: task.id,
      title: task.title || "未命名速记",
      // the Demo shows the capture's own text under the title
      description: String(task.description || "").trim(),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      resolvedAt: task.resolvedAt || "",
      status: task.status,
    }));
}

function todayWidgetLaneTaskIds(lane) {
  if (lane === "task") return todayFocusItems().map((item) => item.task.id);
  if (lane === "quick") return todayQuickCaptureItems().filter((item) => item.status !== "done").map((item) => item.taskId);
  return [];
}

function moveTodayWidgetItem(taskId, sourceLane, targetLane, targetTaskId, position) {
  if (!["task", "quick"].includes(sourceLane) || !["task", "quick"].includes(targetLane)) {
    return { success: false, code: "INVALID_LANE", taskId };
  }
  if (!["before", "after"].includes(position)) return { success: false, code: "INVALID_POSITION", taskId };
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return { success: false, code: "TASK_NOT_FOUND", taskId };

  const sourceIds = todayWidgetLaneTaskIds(sourceLane);
  const targetIds = sourceLane === targetLane ? sourceIds : todayWidgetLaneTaskIds(targetLane);
  if (!sourceIds.includes(taskId)) return { success: false, code: "TASK_NOT_FOUND", taskId };

  const nextSourceIds = sourceIds.filter((id) => id !== taskId);
  const nextTargetIds = sourceLane === targetLane ? nextSourceIds : targetIds.filter((id) => id !== taskId);
  const anchorIndex = targetTaskId ? nextTargetIds.indexOf(targetTaskId) : -1;
  if (targetTaskId && anchorIndex < 0) return { success: false, code: "TASK_NOT_FOUND", taskId };
  const insertionIndex = anchorIndex < 0
    ? nextTargetIds.length
    : anchorIndex + (position === "after" ? 1 : 0);

  if (sourceLane !== targetLane) {
    task.captureSource = targetLane === "quick" ? "today-widget" : "";
    task.tags = normalizeTaskTags({
      ...task.tags,
      today: targetLane === "task",
    });
    if (targetLane === "quick") task.groupId = "";
  }

  const orderedTargetIds = [
    ...nextTargetIds.slice(0, insertionIndex),
    taskId,
    ...nextTargetIds.slice(insertionIndex),
  ];
  const taskLaneIds = sourceLane === targetLane
    ? orderedTargetIds
    : targetLane === "task" ? orderedTargetIds : nextSourceIds;
  const quickLaneIds = sourceLane === targetLane
    ? orderedTargetIds
    : targetLane === "quick" ? orderedTargetIds : nextSourceIds;

  state.tasks.forEach((item) => {
    item.todayTaskOrder = 0;
    item.todayQuickCaptureOrder = 0;
  });
  taskLaneIds.forEach((id, index) => {
    const item = state.tasks.find((entry) => entry.id === id);
    if (item) item.todayTaskOrder = index + 1;
  });
  quickLaneIds.forEach((id, index) => {
    const item = state.tasks.find((entry) => entry.id === id);
    if (item) item.todayQuickCaptureOrder = index + 1;
  });
  task.updatedAt = now();
  save();
  render();
  return { success: true, code: "MOVED", taskId };
}

function reorderTodayWidgetItem(taskId, lane, direction) {
  const orderKey = lane === "task"
    ? "todayTaskOrder"
    : lane === "quick"
      ? "todayQuickCaptureOrder"
      : "";
  if (!orderKey) return { success: false, code: "INVALID_LANE", taskId };
  const delta = Number(direction) < 0 ? -1 : Number(direction) > 0 ? 1 : 0;
  if (!delta) return { success: false, code: "INVALID_DIRECTION", taskId };
  const taskIds = lane === "task"
    ? todayFocusItems().map((item) => item.task.id)
    : todayQuickCaptureItems().filter((item) => item.status !== "done").map((item) => item.taskId);
  const index = taskIds.indexOf(taskId);
  const targetIndex = index + delta;
  if (index < 0) return { success: false, code: "TASK_NOT_FOUND", taskId };
  if (targetIndex < 0 || targetIndex >= taskIds.length) return { success: false, code: "BOUNDARY", taskId };
  [taskIds[index], taskIds[targetIndex]] = [taskIds[targetIndex], taskIds[index]];
  state.tasks.forEach((task) => { task[orderKey] = 0; });
  taskIds.forEach((id, orderIndex) => {
    const task = state.tasks.find((item) => item.id === id);
    if (task) task[orderKey] = orderIndex + 1;
  });
  save();
  render();
  return { success: true, code: "MOVED", taskId };
}

// True while the main window is the one the user is looking at. Minimised or
// background windows keep state.activeTaskId, but the widget must not echo it.
function mainWindowShowsSelection() {
  if (typeof document.hasFocus === "function" && !document.hasFocus()) return false;
  return document.visibilityState !== "hidden";
}

let cachedTodayWidgetAppearance = null;
let cachedTodayWidgetAppearanceKey = "";

/**
 * Read the appearance values the widget mirrors.
 *
 * `getComputedStyle` forces a style recalculation and measured 2.9-4.7ms on a
 * 200-task window, so the result is cached and only re-read when one of the
 * state values it is derived from changes.
 */
function todayWidgetAppearance() {
  const key = `${state.theme}\u0003${state.zhFont}\u0003${state.enFont}\u0003${state.fontScale}`;
  if (cachedTodayWidgetAppearance && cachedTodayWidgetAppearanceKey === key) {
    return cachedTodayWidgetAppearance;
  }
  const computed = window.getComputedStyle?.(document.documentElement);
  const rootFontSize = Number.parseFloat(computed?.fontSize);
  cachedTodayWidgetAppearance = {
    theme: state.theme,
    zhFont: state.zhFont,
    enFont: state.enFont,
    fontSize: Number.isFinite(rootFontSize) ? rootFontSize : 16.5,
    // the phase-12/13 widget layers size everything with --font-scale, so the
    // widget window has to receive the same multiplier the main window uses.
    fontScale: computed?.getPropertyValue("--font-scale")?.trim() || "1",
    // shell.js composes --sans from the font preferences ("TaskTrack English
    // Inter","TaskTrack Chinese System",...). The widget window loads the same
    // @font-face sheet, so passing the composed stack keeps both windows on
    // one font pipeline instead of duplicating the family tables.
    sans: computed?.getPropertyValue("--sans")?.trim() || "",
  };
  cachedTodayWidgetAppearanceKey = key;
  return cachedTodayWidgetAppearance;
}

/**
 * Cheap signature of the state that decides the widget's rows and appearance.
 *
 * The data half is a fingerprint of the persisted task data, which covers every
 * field the widget rows read. The payload fingerprint is deliberately not used:
 * it also covers UI-only fields such as the active group and filters, so
 * ordinary selection changes would defeat the gate and rebuild the row list on
 * every click.
 */
function todayWidgetSignature() {
  return [
    loopTodayKey(),
    persistedStateRevision(),
    mainWindowShowsSelection() ? state.activeTaskId || "" : "",
    state.theme,
    state.zhFont,
    state.enFont,
    state.fontScale,
  ].join("\u0003");
}

function todayWidgetSnapshot(appearance = todayWidgetAppearance()) {
  const quickCaptures = todayQuickCaptureItems().filter((item) => item.status !== "done");
  return {
    date: loopTodayKey(),
    // Phase18: "今日任务已完成" instead of "暂无今日任务" once today's work is done.
    completedToday: shellCompletedToday().length,
    appearance,
    // the Demo marks the row open in the main window with .current. The widget
    // is a separate always-on window, so a stale selection there would keep one
    // row highlighted while the main window is in the background: only publish
    // it while that window is actually in front.
    activeTaskId: mainWindowShowsSelection() ? state.activeTaskId || "" : "",
    items: todayFocusItems().map(({ task, kind, nextText }) => ({
      taskId: task.id,
      title: task.title || "未命名任务",
      nextText,
      kind,
    })),
    quickCaptures,
    quickCaptureTotal: quickCaptures.length,
    groups: sort(state.taskGroups).map((group) => ({ id: group.id, title: group.title })),
  };
}

let todayWidgetSnapshotSignature = "";

function publishTodayWidgetSnapshot() {
  if (!desktopTodayWidget) return;
  // Phase C: render() calls this on every state change, so gate the snapshot on
  // a cheap signature instead of recomputing and re-sending it each time. The
  // deadline reminder path already worked this way.
  const signature = todayWidgetSignature();
  if (signature === todayWidgetSnapshotSignature) return;
  todayWidgetSnapshotSignature = signature;
  desktopTodayWidget.publish(todayWidgetSnapshot());
}

function deadlineReminderSnapshot() {
  return state.tasks
    .filter((task) => safeDate(task.deadlineAt))
    .map((task) => ({
      id: task.id,
      title: task.title || "未命名任务",
      status: task.status,
      priority: task.priority,
      deadlineAt: task.deadlineAt,
      deadlineReminderMinutes: task.deadlineReminderMinutes,
    }));
}

function publishDeadlineReminderSnapshot() {
  if (!desktopDeadlineReminders?.sync) return;
  const snapshot = deadlineReminderSnapshot();
  const signature = JSON.stringify(snapshot);
  if (signature === deadlineReminderSignature) return;
  deadlineReminderSignature = signature;
  void desktopDeadlineReminders.sync(snapshot).catch((error) => {
    deadlineReminderSignature = "";
    console.error("Failed to synchronize task deadline reminders.", error);
  });
}

/** Phase19: capture what the user is editing before a reminder switches view. */
function shellPreserveDraftsForReturn() {
  if (typeof captureMountedMilkdownDrafts === "function") captureMountedMilkdownDrafts();
  if (typeof flushNodeNoteDrafts === "function") flushNodeNoteDrafts({ persist: false });
  if (typeof captureAppSwitchEditingFocus === "function") captureAppSwitchEditingFocus(document.activeElement);
}

function initializeDeadlineReminderBridge() {
  if (!desktopDeadlineReminders) return;
  if (typeof desktopBindReminderState === "function") desktopBindReminderState();
  unsubscribeDeadlineReminderTask?.();
  unsubscribeDeadlineReminderCalendar?.();
  unsubscribeDeadlineReminderTask = desktopDeadlineReminders.onOpenTask?.(({ taskId } = {}) => {
    if (!taskId) return;
    // Phase19: coming back from a reminder must not lose the open draft.
    shellPreserveDraftsForReturn();
    openTaskFromGlobalList(taskId);
    render();
  });
  unsubscribeDeadlineReminderCalendar = desktopDeadlineReminders.onOpenCalendar?.(() => {
    shellPreserveDraftsForReturn();
    ensureCalendarState();
    state.calendarOpen = true;
    state.settingsOpen = false;
    state.reviewOpen = false;
    render();
  });
}

function syncTodayWidgetRestoreButton() {
  const current = document.querySelector(".restore-widget");
  if (!desktopTodayWidget || todayWidgetWindowState.visible) {
    current?.remove();
    return;
  }
  if (current) return;
  const root = document.querySelector("#root");
  root?.insertAdjacentHTML("beforeend", renderTodayWidgetRestore());
  root?.querySelector(".restore-widget")?.addEventListener("click", () => void desktopTodayWidget.show());
}

async function initializeTodayWidgetBridge() {
  if (!desktopTodayWidget) return;
  unsubscribeTodayWidgetState?.();
  unsubscribeTodayWidgetOpenTask?.();
  unsubscribeTodayWidgetCompletion?.();
  unsubscribeTodayWidgetCreateTask?.();
  unsubscribeTodayWidgetUpdateTitle?.();
  unsubscribeTodayWidgetPromote?.();
  unsubscribeTodayWidgetDeleteQuickCapture?.();
  unsubscribeTodayWidgetMoveItem?.();
  unsubscribeTodayWidgetReorder?.();
  unsubscribeTodayWidgetState = desktopTodayWidget.onState((nextState) => {
    todayWidgetWindowState = nextState && typeof nextState === "object" ? nextState : { visible: false };
    syncTodayWidgetRestoreButton();
    if (state.settingsOpen) render();
  });
  unsubscribeTodayWidgetOpenTask = desktopTodayWidget.onOpenTask(({ taskId } = {}) => {
    if (!taskId) return;
    shellPreserveDraftsForReturn();
    openTaskFromGlobalList(taskId);
    render();
  });
  unsubscribeTodayWidgetCompletion = desktopTodayWidget.onCompleteRequest(({ requestId, taskId } = {}) => {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) {
      desktopTodayWidget.respondCompletion({ requestId, success: false, code: "TASK_NOT_FOUND" });
      return;
    }
    const wasDone = task.status === "done";
    let completion = null;
    if (task.captureSource === "today-widget" && task.status !== "done" && !task.conclusion.trim()) {
      task.status = "done";
      task.resolvedAt = now();
      task.updatedAt = now();
      save();
      completion = { success: true, code: "COMPLETED", taskId };
    } else {
      openTaskFromGlobalList(taskId);
      completion = toggleTaskDone(taskId);
    }
    const success = task.status === "done";
    if (!wasDone && success) advanceNavigationAfterCompletion(taskId);
    render();
    desktopTodayWidget.respondCompletion({
      requestId,
      success,
      code: success ? "COMPLETED" : completion?.code || "CONCLUSION_REQUIRED",
    });
  });
  unsubscribeTodayWidgetCreateTask = desktopTodayWidget.onCreateTaskRequest?.(({ requestId, title, description, addToToday } = {}) => {
    const task = createQuickCapture(title, description, addToToday === true);
    desktopTodayWidget.respondMutation?.({
      requestId,
      success: Boolean(task),
      code: task ? "CREATED" : "INVALID_TITLE",
      taskId: task?.id || "",
    });
  });
  unsubscribeTodayWidgetUpdateTitle = desktopTodayWidget.onUpdateTaskTitleRequest?.(({ requestId, taskId, title } = {}) => {
    desktopTodayWidget.respondMutation?.({ requestId, ...updateTaskTitleFromWidget(taskId, title) });
  });
  unsubscribeTodayWidgetPromote = desktopTodayWidget.onPromoteQuickCaptureRequest?.(({ requestId, taskId, groupId } = {}) => {
    desktopTodayWidget.respondMutation?.({ requestId, ...promoteQuickCaptureFromWidget(taskId, groupId) });
  });
  unsubscribeTodayWidgetDeleteQuickCapture = desktopTodayWidget.onDeleteQuickCaptureRequest?.(async ({ requestId, taskId } = {}) => {
    desktopTodayWidget.respondMutation?.({ requestId, ...(await deleteQuickCaptureFromWidget(taskId)) });
  });
  unsubscribeTodayWidgetMoveItem = desktopTodayWidget.onMoveItemRequest?.(({ requestId, taskId, sourceLane, targetLane, targetTaskId, position } = {}) => {
    desktopTodayWidget.respondMutation?.({
      requestId,
      ...moveTodayWidgetItem(taskId, sourceLane, targetLane, targetTaskId, position),
    });
  });
  unsubscribeTodayWidgetReorder = desktopTodayWidget.onReorderRequest?.(({ requestId, taskId, lane, direction } = {}) => {
    desktopTodayWidget.respondMutation?.({ requestId, ...reorderTodayWidgetItem(taskId, lane, direction) });
  });
  try {
    todayWidgetWindowState = await desktopTodayWidget.getState();
  } catch {
    todayWidgetWindowState = { visible: false };
  }
}

function taskDateFilterLabel(value) {
  const normalized = normalizeTaskDateFilter(value);
  return normalized ? `${normalized.slice(5, 7)}/${normalized.slice(8, 10)}` : "";
}

function formatMinuteStamp(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatImageStamp(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(value)
    .replace(/[\/:\s]/g, "-");
}

function esc(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escAttr(value) {
  return esc(value).replaceAll("\n", " ");
}

/**
 * Escape an identifier for use inside a quoted CSS attribute selector.
 * escAttr() produces HTML entities, which CSS selectors must not contain.
 */
function escSelectorValue(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}


// ============================================================
// APP BOOTSTRAP
// ============================================================
/**
 * Application entry point. Loads persisted data and starts the first render.
 * Called immediately at the end of the script.
 */
async function bootstrap() {
  const [data, recovery] = await Promise.all([
    loadAppData(),
    loadKnowledgeRecovery(),
    initializeAppUpdates(),
    initializeTodayWidgetBridge(),
    initializeDeadlineReminderBridge(),
  ]);
  state.tasks = data.tasks;
  state.taskGroups = data.taskGroups;
  state.activeGroupId = data.activeGroupId;
  state.flowWidths = data.flowWidths;
  state.sidebarWidth = data.sidebarWidth;
  state.detailHeight = data.detailHeight;
  state.attachments = data.attachments;
  state.theme = data.theme;
  state.zhFont = data.zhFont;
  state.enFont = data.enFont;
  state.fontScale = normalizeFontScale(data.fontScale);
  state.taskFilter = data.taskFilter;
  state.priorityFilter = data.priorityFilter;
  state.captureSourceFilter = normalizeCaptureSourceFilter(data.captureSourceFilter);
  state.newTaskPriority = data.newTaskPriority;
  state.uiPreferences = normalizeUiPreferences(data.uiPreferences);
  globalThis.LoopContinuity28?.restorePreferences?.(state.uiPreferences);
  globalThis.LoopWork?.restorePreferences?.(state.uiPreferences);
  state.knowledgeRecovery = recovery;
  state.installationId = normalizeInstallationId(data.installationId);
  state.workNavigation = workNavigationModel.normalizeWorkNavigation(data.workNavigation, {
    groupIds: state.taskGroups.map((group) => group.id),
  });
  state.recentlyDeleted = normalizeRecentlyDeleted(data.recentlyDeleted);
  await restoreKnowledgeRecoveryDrafts();
  state.activeTaskId = tasksInActiveGroup()[0]?.id || "";
  syncRecurringTasks(loopNow());
  render();
  await startKnowledgeFileWatchers();
  startRecurringSchedule();
}

window.addEventListener("blur", () => {
  if (!appEditingPointerDown) captureAppSwitchEditingFocus(document.activeElement);
  if (appSwitchFocusSnapshot) appSwitchFocusSnapshot.restore = true;
  storeMarkdownSelection(activeMarkdownEditor(), true);
  // The widget mirrors the selection with .current; leaving it set while this
  // window is in the background made the highlight look stuck.
  publishTodayWidgetSnapshot();
});

window.addEventListener("focus", () => {
  publishTodayWidgetSnapshot();
  if (restoreAppSwitchEditingFocus()) return;
  window.requestAnimationFrame(() => {
    if (!restoreAppSwitchEditingFocus() && state.restoreMarkdownFocus) restoreMarkdownSelection();
  });
});

window.addEventListener(
  "pointerdown",
  (event) => {
    if (appSwitchFocusSnapshot?.restore) {
      const interactive = event.target.closest?.("button, input, textarea, select, [contenteditable], a");
      const restoredTarget = resolveAppSwitchEditingElement(appSwitchFocusSnapshot);
      if (!interactive || interactive === restoredTarget || interactive.closest?.(".ProseMirror") === restoredTarget) return;
    }
    appEditingPointerDown = true;
    appSwitchFocusSnapshot = null;
    window.setTimeout(() => {
      appEditingPointerDown = false;
    }, 0);
  },
  true,
);

if (desktopKnowledgeFile?.onChange) {
  unsubscribeKnowledgeFileChanges = desktopKnowledgeFile.onChange((event) => {
    void handleKnowledgeFileChange(event);
  });
}

if (desktopKnowledgeRecovery?.onFlushAndQuit) {
  desktopKnowledgeRecovery.onFlushAndQuit(async () => {
    try {
      await flushPendingKnowledgeRecoveries();
    } catch (error) {
      console.error("Failed to flush knowledge note recovery before shutdown.", error);
    } finally {
      desktopKnowledgeRecovery.completeFlushAndQuit?.();
    }
  });
}

if (desktopUpdates?.onPrepareInstall) {
  desktopUpdates.onPrepareInstall(async () => {
    const ready = await prepareForUpdateInstall();
    desktopUpdates.completeInstallPreparation?.(ready);
  });
}

window.addEventListener("keydown", (event) => {
  if (event.isComposing) return;

  if (isKnowledgeSaveShortcut(event) && state.taskPane === "notes") {
    const task = activeTask();
    if (!task) return;

    event.preventDefault();

    void saveKnowledgeTask(task.id, {
      saveAs: event.shiftKey,
    }).then((result) => {
      if (!result?.canceled) render();
    });

    return;
  }

  if (event.key !== "Escape" && isEditableTarget(event.target)) return;
  if (event.key === "Escape") {
    if (state.searchOpen) {
      event.preventDefault();
      closeGlobalSearch();
      return;
    }
    if (state.contextMenu) {
      event.preventDefault();
      closeContextMenu(true);
      return;
    }
    if (state.selectedNodeId || state.settingsOpen || state.calendarOpen || state.reviewOpen || state.feedbackOpen || recurrencePopoverTaskId || taskGroupSelectTaskId || deadlinePopoverTaskId || repositoryGroupPickerOpen || repositoryFilterMenuOpen || taskPriorityMenu) {
      event.preventDefault();
      exitNodeDetail();
      state.settingsOpen = false;
      state.calendarOpen = false;
      state.reviewOpen = false;
      recurrencePopoverTaskId = "";
      taskGroupSelectTaskId = "";
      deadlinePopoverTaskId = "";
      repositoryGroupPickerOpen = false;
      repositoryFilterMenuOpen = false;
      repositoryPriorityFilterOpen = false;
      repositoryGroupQuery = "";
      taskPriorityMenu = null;
      closeBugReport();
      render();
      return;
    }
  }
  if (!(event.metaKey || event.ctrlKey)) return;
  if (event.key.toLowerCase() === "n" && !event.altKey && !event.shiftKey && !shellOverlayIsOpen()) {
    event.preventDefault();
    shellOpenCreateDialog();
    return;
  }
  if (event.key.toLowerCase() !== "k") return;
  const target = event.target;
  if (target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
  event.preventDefault();
  state.searchOpen = true;
  state.focusSearch = true;
  state.searchCursor = state.query.length;
  render();
});

bootstrap();

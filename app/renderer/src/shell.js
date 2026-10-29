// ============================================================
// Loop -- three-column application shell
//
// Ported from the frozen Demo baseline:
//   prototypes/baseline/loop-plane-phase15-frozen/loop-plane-phase1.html
//   prototypes/baseline/loop-plane-phase15-frozen/loop-flow-phase11.js
//   prototypes/baseline/loop-plane-phase15-frozen/loop-shell-refinement.js
//
// The markup and class names below are the visual contract. Keep them in
// sync with src/shell.css, src/refinement.css and src/flow.css, which are
// byte-identical copies of the Demo stylesheets. When a Demo rule and a
// project need collide, add the override to src/bridge.css instead of
// touching the copied files.
//
// This file only *renders*; every data-* attribute it emits reuses the
// vocabulary already handled by app.js (bindTaskRepositoryRows / action /
// edit), so behaviour stays with the existing command layer while the
// presentation is the Demo's.
// ============================================================

const SHELL_ICON_PATHS = {
  loop: "M17.5 6.5a7 7 0 1 0 1.7 8.1M17.5 6.5H13m4.5 0V2",
  home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8",
  tasks: "M9 6h12M9 12h12M9 18h12m-18-12 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2",
  calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2",
  history: "M3 4v5h5M3 9a9 9 0 1 1 1.7 9M12 7v5l3 2",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  plus: "M12 5v14M5 12h14",
  indent: "M5 4v8h14m-5-5 5 5-5 5",
  note23Outline: "M4 5h2m4 0h10M4 12h2m4 0h10M4 19h2m4 0h10",
  chevron: "m9 5 7 7-7 7",
  down: "m5 9 7 7 7-7",
  panel: "M3 4h18v16H3zM9 4v16",
  check: "m5 12 4 4L19 6",
  circle: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v6M12 7h.01",
  done: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0m-12 0 3 3 5-6",
  blocked: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M8 12h8",
  later: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M12 8v4l2 2",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  close: "m6 6 12 12M6 18 18 6",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  moon: "M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10",
  settings: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  folder: "M3 7h7l2 2h9v11H3zM3 7V4h7l2 3",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2",
  filter: "M4 6h16M7 12h10M10 18h4",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  flag: "M5 21V3m0 0h13l-3 4 3 4H5",
  note: "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5",
  edit: "m15 4 5 5M4 20l4-1L21 6l-4-4L4 15z",
  download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  minus: "M5 12h14",
  repeat: "M20 7v5h-5M4 17v-5h5M6 9a7 7 0 0 1 12-2l2 2M4 15l2 2a7 7 0 0 0 12-2",
  expandRecord: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  restoreRecord: "M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5",
};

const SHELL_NODE_STATUS_LABELS = { todo: "待处理", done: "已完成", blocked: "卡住", later: "稍后" };
const SHELL_WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function shellIcon(name, className = "") {
  const sprite = { taskList: "columns", share: "share-2" }[name];
  if (sprite) return `<svg${className ? ` class="${escAttr(className)}"` : ""} viewBox="0 0 24 24" aria-hidden="true"><use href="./src/assets/feather/feather-sprite.svg#${sprite}"></use></svg>`;
  const path = SHELL_ICON_PATHS[name] || SHELL_ICON_PATHS.circle;
  return `<svg${className ? ` class="${escAttr(className)}"` : ""} viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;
}

/** A 速记 (quick capture) is a task created from the desktop today widget. */
function shellTaskIsNote(task) {
  return task?.captureSource === "today-widget";
}

function shellGroupTitle(groupId) {
  if (groupId === UNGROUPED_TASKS_GROUP_ID) return "未分组";
  return state.taskGroups.find((group) => group.id === groupId)?.title || "未分组";
}

/** Demo route vocabulary: today | tasks | calendar | review | settings. */
function shellRoute() {
  if (state.settingsOpen) return "settings";
  if (state.reviewOpen) return "review";
  if (state.calendarOpen) return "calendar";
  if (state.taskFilter === "today") return "today";
  return "tasks";
}

function shellIsWide() {
  return ["calendar", "review", "settings"].includes(shellRoute());
}

function shellDateLabel(date = loopNow()) {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function shellTodayCount() {
  return state.tasks
    .filter((task) => task.status !== "done")
    .filter((task) => !shellTaskIsNote(task))
    .filter((task) => isTaskScheduledForToday(task))
    .length;
}

/** Mirrors tasksInActiveGroup(): ungrouped means "no groupId at all". */
function shellTasksInGroup(groupId) {
  if (groupId === ALL_TASKS_GROUP_ID) return state.tasks;
  if (groupId === UNGROUPED_TASKS_GROUP_ID) return state.tasks.filter((task) => !task.groupId);
  return state.tasks.filter((task) => task.groupId === groupId);
}

function shellGroupOpenCount(groupId) {
  return shellTasksInGroup(groupId).filter((task) => task.status !== "done").length;
}

// ------------------------------------------------------------
// Appearance
//
// The Demo drives typography through a numeric --font-scale multiplier and a
// --sans stack built from the built-in TaskTrack families
// (loop-settings-phase9-refinement.js:23). The project stores four named
// steps. They are kept as the user-facing ladder, anchored so that the
// project default "large" renders exactly like the Demo default (1.08).
// ------------------------------------------------------------

// The Demo offers 1 / 1.08 / 1.16 / 1.24 (紧凑 / 标准（推荐）/ 较大 / 特大).
// The four stored keys map onto those steps by rank, so the ladder is the
// Demo's and no stored value is lost. Existing "large" users move 1.12 -> 1.16.
const SHELL_FONT_SCALE_VALUES = { current: "1", larger: "1.08", large: "1.16", largest: "1.24" };

const SHELL_ZH_FAMILIES = {
  system: "System", noto: "Noto", yahei: "YaHei", pingfang: "PingFang", songti: "Songti",
  simsun: "SimSun", fangsong: "FangSong", heiti: "Heiti", kaiti: "KaiTi",
};

const SHELL_EN_FAMILIES = {
  system: "System", inter: "Inter", segoe: "Segoe", arial: "Arial", helvetica: "Helvetica",
  verdana: "Verdana", trebuchet: "Trebuchet", tahoma: "Tahoma", times: "Times",
  georgia: "Georgia", courier: "Courier", mono: "Mono",
};

function shellFontScaleValue(value) {
  return SHELL_FONT_SCALE_VALUES[normalizeFontScale(value)] || SHELL_FONT_SCALE_VALUES.large;
}

function applyLoopAppearance() {
  const root = document.documentElement;
  if (!root?.style?.setProperty) return;
  root.style.setProperty("--font-scale", shellFontScaleValue(state.fontScale));
  root.style.setProperty(
    "--sans",
    `"TaskTrack English ${SHELL_EN_FAMILIES[state.enFont] || "Times"}","TaskTrack Chinese ${SHELL_ZH_FAMILIES[state.zhFont] || "Heiti"}",-apple-system,BlinkMacSystemFont,sans-serif`,
  );
}

// ------------------------------------------------------------
// Navigation column
// ------------------------------------------------------------

function renderShellBrandUpdate() {
  const update = appUpdateState;
  const busy = ["downloading", "preparing", "installing"].includes(update.status);
  const labels = {
    idle: "软件更新",
    unsupported: "软件更新",
    checking: "正在检查更新",
    latest: "当前已是最新版本",
    available: "更新可用",
    downloading: `下载 ${Math.round(update.percent || 0)}%`,
    downloaded: "待安装",
    preparing: "准备更新",
    installing: "正在安装",
    error: "更新未完成",
  };
  const label = labels[update.status] || "软件更新";
  return `<button class="icon-button shell-update brand-update" type="button" data-action="open-update-panel" aria-label="软件更新：${escAttr(label)}" title="${escAttr(label)}" ${busy ? 'aria-busy="true" disabled' : ""}>${shellIcon("download")}</button>`;
}

/** Refresh the update control next to settings without replacing navigation. */
function refreshShellBrandUpdate() {
  const slot = document.querySelector("[data-brand-update-slot]");
  if (!slot) return;
  slot.innerHTML = renderShellBrandUpdate();
}

function shellNavButton(route, text, image) {
  const current = shellRoute();
  const active = current === route;
  const scoped = active && route === "tasks" && state.activeGroupId !== ALL_TASKS_GROUP_ID;
  const attributes = route === "tasks"
    ? 'data-setting-button="task-filter" data-value="all"'
    : route === "today"
      ? 'data-setting-button="task-filter" data-value="today"'
      : route === "calendar"
        ? 'data-action="toggle-calendar"'
        : route === "review"
          ? 'data-action="toggle-review"'
          : 'data-action="toggle-settings"';
  const count = route === "today" ? `<span class="count">${shellTodayCount()}</span>` : "";
  return `<button class="nav-button ${active ? (scoped ? "parent-active" : "active") : ""}" type="button" ${attributes} title="${escAttr(text)}" aria-label="${escAttr(text)}" aria-current="${active && !scoped ? "page" : "false"}">${shellIcon(image)}<span>${esc(text)}</span>${count}</button>`;
}

function renderShellGroupNavigation() {
  const editing = state.editingGroupId;
  const editingGroup = state.taskGroups.find((group) => group.id === editing);
  const draft = `
    <div class="nav-group-editor">
      <input id="group-title" aria-label="${editing ? "重命名分组" : "新建分组名称"}" maxlength="24" value="${escAttr(editingGroup?.title || "")}" />
      <button type="button" data-action="commit-group-edit" aria-label="保存分组">${shellIcon("check")}</button>
      <button type="button" data-action="cancel-group-edit" aria-label="取消分组编辑">${shellIcon("close")}</button>
    </div>`;
  const rows = sort(state.taskGroups).map((group) => {
    if (editing === group.id) return draft;
    const active = shellRoute() === "tasks" && state.activeGroupId === group.id;
    return `
      <div class="group-nav-row">
        <button class="nav-button ${active ? "active" : ""}" type="button" data-action="select-nav-group" data-group-id="${escAttr(group.id)}" title="${escAttr(group.title)}" aria-label="分组：${escAttr(group.title)}" aria-current="${active ? "page" : "false"}">
          ${state.navCollapsed ? shellIcon("folder") : '<i class="group-mark"></i>'}<span>${esc(group.title)}</span><span class="count">${shellGroupOpenCount(group.id)}</span>
        </button>
      </div>`;
  }).join("");
  const ungroupedActive = shellRoute() === "tasks" && state.activeGroupId === UNGROUPED_TASKS_GROUP_ID;
  const ungrouped = `
    <div class="group-nav-row">
      <button class="nav-button ${ungroupedActive ? "active" : ""}" type="button" data-action="select-nav-group" data-group-id="${UNGROUPED_TASKS_GROUP_ID}" title="未分组" aria-label="未分组" aria-current="${ungroupedActive ? "page" : "false"}">
        ${state.navCollapsed ? shellIcon("folder") : '<i class="group-mark"></i>'}<span>未分组</span><span class="count">${shellGroupOpenCount(UNGROUPED_TASKS_GROUP_ID)}</span>
      </button>
    </div>`;
  return `
    <div class="nav-groups">
      <div class="nav-section-heading">
        <span>任务分组</span>
        <button class="icon-button" type="button" data-action="add-group" aria-label="新建分组" title="新建分组">${shellIcon("plus")}</button>
      </div>
      ${rows}
      ${editing && !editingGroup ? draft : ""}
      ${ungrouped}
    </div>`;
}

function renderShellNavigation() {
  return `
    <aside class="navigation" id="primary-navigation" aria-label="主导航">
      <div class="brand">
        <span class="brand-mark"><img src="./src/assets/loop-icon.png" alt="Loop" /></span>
        <strong>Loop</strong>
        <button class="icon-button nav-toggle shell-pane-toggle" type="button" data-action="toggle-nav" aria-controls="primary-navigation" aria-expanded="${!state.navCollapsed}" aria-label="${state.navCollapsed ? "展开侧栏" : "收起侧栏"}" title="${state.navCollapsed ? "展开侧栏" : "收起侧栏"}">${shellIcon("panel")}</button>
      </div>
      ${shellNavButton("today", "今日", "home")}
      ${shellNavButton("tasks", "任务仓库", "tasks")}
      ${shellNavButton("calendar", "日历", "calendar")}
      ${shellNavButton("review", "回顾", "history")}
      ${renderShellGroupNavigation()}
      <div class="nav-bottom">
        <div class="nav-bottom-actions">${shellNavButton("settings", "设置", "settings")}<span class="brand-update-slot" data-brand-update-slot>${renderShellBrandUpdate()}</span></div>
        <div class="local-status"><i class="dot"></i>本地工作空间</div>
      </div>
    </aside>`;
}

// ------------------------------------------------------------
// Top bar
// ------------------------------------------------------------

function renderShellTopbar(task = shellActiveTask()) {
  const route = shellRoute();
  const routeNames = { today: "今日", tasks: "任务仓库", calendar: "日历", review: "回顾", settings: "设置" };
  const grouped = route === "tasks" && state.activeGroupId !== ALL_TASKS_GROUP_ID;
  const crumb = grouped ? shellGroupTitle(state.activeGroupId) : routeNames[route];
  const workspaceTask = !shellIsWide() ? task : null;
  const groupTitle = workspaceTask ? shellGroupTitle(workspaceTask.groupId) : crumb;
  return `
    <header class="topbar">
      <div class="shell-list-header" role="group" aria-label="任务列表显示">
        ${!shellIsWide() ? `<button class="icon-button shell-pane-toggle" type="button" data-action="toggle-task-list" aria-controls="task-list-panel" aria-expanded="${!state.taskListCollapsed}" aria-label="${state.taskListCollapsed ? "显示任务列表" : "隐藏任务列表"}" title="${state.taskListCollapsed ? "显示任务列表" : "隐藏任务列表"}">${shellIcon("taskList")}</button>` : ""}
      </div>
      <div class="breadcrumb">
        ${route === "tasks" && state.globalListReturn ? `<button class="text-button" type="button" data-action="return-global-page">返回${state.globalListReturn.route === "calendar" ? "日历" : "回顾"}</button>${shellIcon("chevron")}` : ""}
        ${workspaceTask ? `<span class="shell-task-path" aria-label="任务分组：${escAttr(groupTitle)}" title="${escAttr(groupTitle)}"><span class="shell-group-context">${shellIcon("folder")}<span>${esc(groupTitle)}</span></span></span>${shellIcon("chevron")}${renderShellTaskTitle(workspaceTask)}` : `<b>${esc(crumb)}</b>`}
      </div>
      <div class="shell-actions">
        <span class="preview-date">${esc(shellDateLabel())}，${SHELL_WEEKDAY_NAMES[loopNow().getDay()]}</span>
        ${workspaceTask ? renderShellTaskActions(workspaceTask) : ""}
      </div>
    </header>`;
}

// Visibility changes keep the list and workspace mounted. In particular, a
// knowledge editor must retain its View, Undo journal, selection and draft.
let shellTaskListViewport = null;

function shellSetTaskListCollapsed(collapsed) {
  const next = collapsed === true;
  if (next === state.taskListCollapsed) return;
  const list = document.querySelector("#task-results");
  if (next && list) shellTaskListViewport = { view: taskRepositoryViewKey(), top: list.scrollTop, left: list.scrollLeft };
  state.taskListCollapsed = next;
  try { localStorage.setItem(TASK_LIST_COLLAPSED_KEY, next ? "1" : "0"); } catch {}
  shellSyncTaskListVisibility();
}

function shellSyncTaskListVisibility() {
  const collapsed = state.taskListCollapsed === true;
  const pane = document.querySelector(".task-list-pane");
  const toggle = document.querySelector('[data-action="toggle-task-list"]');
  if (collapsed && pane?.contains(document.activeElement)) toggle?.focus({ preventScroll: true });
  document.querySelector(".app")?.classList.toggle("list-collapsed", collapsed);
  if (pane) pane.inert = collapsed;
  if (toggle) {
    const label = collapsed ? "显示任务列表" : "隐藏任务列表";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  }
  if (!collapsed && shellTaskListViewport) {
    const list = document.querySelector("#task-results");
    if (list && shellTaskListViewport.view === taskRepositoryViewKey()) {
      list.scrollTop = shellTaskListViewport.top;
      list.scrollLeft = shellTaskListViewport.left;
    }
    shellTaskListViewport = null;
  }
}

// ------------------------------------------------------------
// Task list column
// ------------------------------------------------------------

function shellListTitle() {
  if (shellRoute() === "today") {
    return state.captureSourceFilter === "quick" ? "今日速记" : "今日任务";
  }
  if (state.activeGroupId !== ALL_TASKS_GROUP_ID) return shellGroupTitle(state.activeGroupId);
  return "任务仓库";
}

/** Phase18: today's completions stay reachable from the list footer. */
function shellTodayCompletedFoot() {
  if (shellRoute() !== "today" || state.captureSourceFilter === "quick") return "";
  const count = shellCompletedToday().length;
  if (!count && state.todayFilter !== "done") return "";
  return `<button class="text-button time18-completed" type="button" data-action="${state.todayFilter === "done" ? "show-today-active" : "show-today-completed"}">${state.todayFilter === "done" ? "返回待办" : `已完成 ${count}`}</button>`;
}

function shellListFoot() {
  if (shellRoute() === "today") {
    return state.captureSourceFilter === "quick" ? "随手记录，稍后整理" : `今天，${shellDateLabel()}`;
  }
  if (state.activeGroupId === ALL_TASKS_GROUP_ID) return "全部分组与未分组";
  return shellGroupTitle(state.activeGroupId);
}

function renderShellTaskRow(task, displayOrder) {
  const selected = task.id === state.activeTaskId;
  const done = task.status === "done";
  const note = shellTaskIsNote(task);
  return `
    <li class="task-item ${selected ? "selected" : ""} ${done ? "done" : ""}" data-task-row="${escAttr(task.id)}" data-task-id="${escAttr(task.id)}" data-context="task" draggable="true" data-task-drag-target="${escAttr(task.id)}">
      <span class="task-sequence-action">
        <span class="task-sequence" aria-hidden="true">${note ? shellIcon("note") : String(displayOrder).padStart(2, "0")}</span>
        <button class="task-complete" type="button" data-action="toggle-task-done" data-task-id="${escAttr(task.id)}" aria-label="${done ? "恢复任务" : "完成任务"}：${escAttr(task.title)}" aria-pressed="${done}" title="${done ? "恢复任务" : "完成任务"}"><span class="task-check-ring">${shellIcon("check")}</span></button>
      </span>
      <button class="task-select" type="button" data-task-id="${escAttr(task.id)}" aria-pressed="${selected}" title="${escAttr(task.title)}">
        <span class="task-item-title">${esc(task.title || "未命名任务")}</span>
      </button>
    </li>`;
}

function shellActiveFilterLabels() {
  const labels = [];
  if (state.query.trim()) labels.push(`搜索「${state.query.trim()}」`);
  if (state.priorityFilter !== "all") labels.push(`${priorityFilterLabels[state.priorityFilter]}优先`);
  if (state.captureSourceFilter !== "all") labels.push(captureSourceFilterLabels[state.captureSourceFilter]);
  if (["blocked", "later"].includes(state.taskFilter)) labels.push(taskFilterLabels[state.taskFilter]);
  if (state.taskDeadlineFilter !== "all") labels.push(taskDeadlineFilterLabels[state.taskDeadlineFilter]);
  return labels;
}

function renderShellTaskRows(list) {
  if (shellBulk.active && list.length) return renderShellBulkRows(list);
  if (!list.length) {
    // Phase18: the Today route gets its own minimal copy instead of "暂无任务".
    const hasFilters = shellActiveFilterLabels().length > 0 || Boolean(state.taskDateFilter);
    if (shellRoute() === "today" && state.captureSourceFilter !== "quick" && !hasFilters) {
      return `<div class="empty time18-list-empty">${state.todayFilter === "done" ? "今天暂无完成任务" : "暂无待办"}</div>`;
    }
    const filtered = hasFilters;
    const noun = state.captureSourceFilter === "quick" ? "速记" : "任务";
    // Phase26: the Demo keeps a reachable recovery entrance in the empty list,
    // without adding a permanent navigation row that would change the height.
    const archive = typeof state !== "undefined" && Array.isArray(state.recentlyDeleted) ? state.recentlyDeleted.length : 0;
    const recovery = typeof recovery26Open === "function" && archive
      ? '<button class="text-button" type="button" data-recovery26="open">最近删除</button>'
      : "";
    return `<div class="empty"><p>${filtered ? `没有匹配的${noun}` : `暂无${noun}`}</p>${filtered ? '<button class="text-button" type="button" data-action="clear-list-filters">清除筛选</button>' : ""}${recovery}</div>`;
  }
  return `<ol class="task-rows" aria-label="任务列表">${list.map((task, index) => renderShellTaskRow(task, index + 1)).join("")}</ol>`;
}

function renderShellListFilter() {
  if (shellRoute() === "today") return "";
  const options = [["active", "未完成"], ["all", "全部"], ["done", "已完成"]];
  return `<div class="list-filter">${options.map(([value, text]) => `<button class="filter-tab ${state.taskFilter === value ? "active" : ""}" type="button" data-setting-button="task-filter" data-value="${value}" aria-pressed="${state.taskFilter === value}">${text}</button>`).join("")}</div>`;
}

function renderShellScopeChip() {
  const date = state.taskDateFilter;
  if (!date) return "";
  const parsed = safeDate(date);
  return `<div class="scope-chip">${shellIcon("calendar")}${parsed ? `${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日` : esc(date)} 截止<button class="icon-button" type="button" data-action="clear-list-date-filter" aria-label="清除截止日期筛选">${shellIcon("close")}</button></div>`;
}

function renderShellTaskList(list) {
  const note = state.captureSourceFilter === "quick";
  const filters = shellActiveFilterLabels();
  return `
    <aside id="task-list-panel" class="task-list-pane ${shellRoute() === "today" ? "today-clean " : ""}" aria-label="任务列表">
      <span class="list-resizer" data-action="resize-list-column" role="separator" tabindex="0" aria-orientation="vertical" aria-label="调整任务列表宽度" aria-valuemin="230" aria-valuemax="460" aria-valuenow="${normalizeSidebarWidth(state.sidebarWidth)}" title="拖动调整任务列表宽度"></span>
      <div class="list-search" role="search">
        ${shellIcon("search")}
        <input id="search" type="search" placeholder="搜索" aria-label="搜索${escAttr(shellListTitle())}中的任务、节点、速记" aria-controls="task-results" autocomplete="off" value="${escAttr(state.query)}" />
        ${!state.query ? `<kbd class="search-shortcut" aria-hidden="true">${desktopPlatform === "darwin" ? "⌘" : "Ctrl"} K</kbd>` : ""}
        <button class="search-clear" type="button" data-action="clear-search" aria-label="清空搜索" title="清空搜索" ${state.query ? "" : "hidden"}>${shellIcon("close")}</button>
      </div>
      <div class="list-heading">
        <h2 title="${escAttr(shellListTitle())}"><span class="list-title">${esc(shellListTitle())}</span><span class="count" role="status" aria-live="polite">${list.length}</span></h2>
        <div class="heading-list-actions">
          <button class="scope-filter ${filters.length ? "has-filters" : ""}" type="button" data-action="open-combined-filter" aria-label="筛选记录" aria-haspopup="dialog" title="${filters.length ? escAttr(filters.join(" · ")) : "筛选记录"}">筛选${filters.length ? `<span class="filter-count">${filters.length}</span>` : shellIcon("filter")}</button>
          <button class="icon-button" type="button" data-action="add-task" aria-label="新建${note ? "速记" : "任务"}" title="新建${note ? "速记" : "任务"}（${desktopPlatform === "darwin" ? "⌘" : "Ctrl"} + N）">${shellIcon("plus")}</button>
        </div>
      </div>
      ${renderShellListFilter()}
      ${filters.length ? `<div class="active-list-filters"><span title="${escAttr(filters.join(" · "))}">${esc(filters.join(" · "))}</span><button class="icon-button" type="button" data-action="clear-list-filters" aria-label="清除筛选" title="清除筛选">${shellIcon("close")}</button></div>` : ""}
      ${renderShellScopeChip()}
      <div id="task-results" class="tasks-scroll" data-context="task-list">${renderShellTaskRows(list)}</div>
      ${shellBulk.active
        ? `<footer class="list-foot bulk-dock" aria-label="批量操作">${shellBulkFooter()}</footer>`
        : `<footer class="list-foot ${shellTodayCompletedFoot() ? "time18-footer" : ""}"><span>${esc(shellListFoot())}</span>${shellTodayCompletedFoot()}${shellBulkFooter()}</footer>`}
    </aside>`;
}

/** Bind each retained search node once. IME drafts are applied on commit. */
function shellBindRepository() {
  const input = document.querySelector(".list-search #search");
  if (input && input.dataset.repositoryBound !== "1") {
    input.dataset.repositoryBound = "1";
    let composing = false;
    const update = () => {
      if (state.query === input.value) return;
      state.query = input.value;
      state.searchOpen = false;
      state.searchCursor = input.selectionStart ?? input.value.length;
      state.focusSearch = true;
      render();
    };
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; update(); });
    input.addEventListener("input", (event) => { if (!composing && !event.isComposing) update(); });
    input.addEventListener("search", () => { if (!composing) update(); });
    input.addEventListener("keydown", (event) => {
      if (composing || event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (input.value) { input.value = ""; update(); }
        else document.querySelector(".task-rows .task-select")?.focus();
      } else if (["ArrowDown", "Enter"].includes(event.key)) {
        event.preventDefault();
        document.querySelector(".task-rows .task-select")?.focus();
      }
    });
  }
  if (typeof document.addEventListener !== "function" || window.__loopRepositoryKeysBound) return;
  window.__loopRepositoryKeysBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.isComposing || shellOverlayIsOpen()) return;
    const row = event.target.closest?.(".task-rows .task-select");
    if (!row || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = [...document.querySelectorAll(".task-rows .task-select")];
    const index = rows.indexOf(row);
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
      : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    event.preventDefault();
    rows[next]?.focus({ preventScroll: true });
    rows[next]?.scrollIntoView({ block: "nearest" });
  });
}

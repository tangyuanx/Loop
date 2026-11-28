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
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  indent: "M5 4v8h14m-5-5 5 5-5 5",
  note23Outline: "M4 5h2m4 0h10M4 12h2m4 0h10M4 19h2m4 0h10",
  chevron: "m9 5 7 7-7 7",
  down: "m5 9 7 7 7-7",
  panel: "M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17V7A2.5 2.5 0 0 1 6 4.5zM9.5 4.5v15",
  taskDetails: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1M14 4v16M7 8h4M7 12h4",
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
  pause: "M9 5v14M15 5v14",
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
  share: "M4.5 13v5.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V13M16 7.5l-4-4-4 4M12 3.5V15",
  taskList: "M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17V7A2.5 2.5 0 0 1 6 4.5zM8.5 4.5v15M14.5 4.5v15",
  listMore: "M5 12h.01M12 12h.01M19 12h.01",
  grip: "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01",
  expandBranches: "m8 9 4-4 4 4m-8 6 4 4 4-4",
  collapseBranches: "m8 5 4 4 4-4m-8 14 4-4 4 4",
  bolt: "M13 3.5L5 13.5h6l-1 7 8-10h-6z",
  widget: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm4 4h6v4H7V9z",
  moon: "M20 14.5A7.5 7.5 0 0 1 9.5 4a7.5 7.5 0 1 0 10.5 10.5z",
  sun: "M12 3v2M12 19v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M3 12h2M19 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
};

const SHELL_NODE_STATUS_LABELS = { todo: "未完成", done: "已完成", review: "待确认" };
const SHELL_TASK_TAG_LABELS = { blocked: "卡住", later: "稍后" };
const SHELL_WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function shellIcon(name, className = "") {
  const sprite = { nodeTodo: "square", nodeDone: "check", flowPath: "git-branch", moreHorizontal: "more-horizontal" }[name];
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
  if (state.trashOpen) return "trash";
  if (state.settingsOpen) return "settings";
  if (state.reviewOpen) return "review";
  if (state.calendarOpen) return "calendar";
  if (state.taskFilter === "today") return "today";
  return "tasks";
}

function shellIsWide() {
  return ["calendar", "review", "settings", "trash"].includes(shellRoute());
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
  return shellTasksInGroup(groupId).filter((task) => task.status !== "done" && !shellTaskIsNote(task)).length;
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
  const english = `"TaskTrack English ${SHELL_EN_FAMILIES[state.enFont] || "Inter"}"`;
  const chinese = `"TaskTrack Chinese ${SHELL_ZH_FAMILIES[state.zhFont] || "Heiti"}"`;
  const heiti = state.zhFont === "heiti";
  const chineseStack = heiti ? `var(--windows-heiti, ${chinese})` : chinese;
  const stack = `${english},${chineseStack},-apple-system,BlinkMacSystemFont,sans-serif`;
  // The platform defaults follow the shared CSS even if the first render
  // precedes the deferred platform and display probe.
  root.style.setProperty("--sans", heiti && state.enFont === "times" ? `var(--windows-ui-sans, ${stack})` : stack);
}

// ------------------------------------------------------------
// Navigation column
// ------------------------------------------------------------

function renderShellBrandUpdate() {
  const update = appUpdateState;
  const detected = ["available", "downloading", "downloaded", "preparing", "installing"].includes(update.status)
    || (update.version && ["checking", "error"].includes(update.status));
  const busy = ["checking", "downloading", "preparing", "installing"].includes(update.status);
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
  return `<button class="icon-button shell-update brand-update" type="button" data-action="open-update-panel" aria-label="软件更新 · ${escAttr(label)}" title="${escAttr(label)}" ${detected ? 'data-update-available' : ""} ${busy ? 'aria-busy="true" disabled' : ""}>${shellIcon("download")}</button>`;
}

/** Refresh the update control next to settings without replacing navigation. */
function refreshShellBrandUpdate() {
  const slot = document.querySelector("[data-brand-update-slot]");
  if (!slot) return;
  slot.innerHTML = renderShellBrandUpdate();
}

function shellOverdueCount() {
  const nowMs = loopNow().getTime();
  return state.tasks
    .filter((task) => task.status !== "done" && !shellTaskIsNote(task))
    .filter((task) => {
      const deadline = safeDate(task.deadlineAt);
      return deadline && deadline.getTime() < nowMs;
    })
    .length;
}

function shellNavButton(route, text, image) {
  const current = shellRoute();
  const active = current === route;
  const scoped = active && route === "tasks" && state.activeGroupId !== ALL_TASKS_GROUP_ID;
  const attributes = route === "tasks"
    ? 'data-setting-button="task-filter" data-value="active"'
    : route === "today"
      ? 'data-setting-button="task-filter" data-value="today"'
      : route === "calendar"
        ? 'data-action="toggle-calendar"'
        : route === "review"
          ? 'data-action="toggle-review"'
          : 'data-action="toggle-settings"';
  const overdue = route === "calendar" ? shellOverdueCount() : 0;
  const count = route === "today"
    ? `<span class="count">${shellTodayCount()}</span>`
    : route === "tasks"
      ? `<span class="count">${shellGroupOpenCount(ALL_TASKS_GROUP_ID)}</span>`
      : route === "calendar" && overdue > 0
        ? `<span class="count overdue-badge">${overdue} 逾期</span>`
        : "";
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
          <i class="group-mark"></i><span>${esc(group.title)}</span><span class="count">${shellGroupOpenCount(group.id)}</span>
        </button>
      </div>`;
  }).join("");
  const ungroupedActive = shellRoute() === "tasks" && state.activeGroupId === UNGROUPED_TASKS_GROUP_ID;
  const ungrouped = `
    <div class="group-nav-row">
      <button class="nav-button ${ungroupedActive ? "active" : ""}" type="button" data-action="select-nav-group" data-group-id="${UNGROUPED_TASKS_GROUP_ID}" title="未分组" aria-label="未分组" aria-current="${ungroupedActive ? "page" : "false"}">
        <i class="group-mark"></i><span>未分组</span><span class="count">${shellGroupOpenCount(UNGROUPED_TASKS_GROUP_ID)}</span>
      </button>
    </div>`;
  const trashCount = Array.isArray(state.recentlyDeleted) ? state.recentlyDeleted.length : 0;
  const trashBtn = `<div class="nav-trash-slot"><button class="nav-button" type="button" data-recovery26="open" title="最近删除" aria-label="最近删除">${shellIcon("trash")}<span>最近删除</span><span class="count">${trashCount}</span></button></div>`;
  return `
    <div class="nav-groups" data-context="task-list">
      <div class="nav-section-heading">
        <span>分组</span>
        <button class="icon-button" type="button" data-action="add-group" aria-label="新建分组" title="新建分组">${shellIcon("plus")}</button>
      </div>
      ${rows}
      ${editing && !editingGroup ? draft : ""}
      ${ungrouped}
      ${trashBtn}
    </div>`;
}

function renderShellSidebarToggle(expanded) {
  const label = expanded ? "收起侧栏" : "展开侧栏";
  return `<button class="icon-button nav-toggle shell-pane-toggle" type="button" data-action="toggle-nav" aria-controls="primary-navigation" aria-expanded="${expanded}" aria-label="${label}" title="${label}"${expanded ? "" : " hidden"}>${shellIcon("panel")}</button>`;
}

function renderShellNavigation() {
  return `
    <aside class="navigation" id="primary-navigation" aria-label="主导航">
      <div class="brand">
        ${renderShellSidebarToggle(true)}
      </div>
      ${shellNavButton("today", "今日", "sun")}
      ${shellNavButton("tasks", "任务", "tasks")}
      ${shellNavButton("calendar", "日历", "calendar")}
      ${shellNavButton("review", "回顾", "history")}
      ${renderShellGroupNavigation()}
      <div class="nav-bottom">
        <div class="nav-bottom-actions">${shellNavButton("settings", "设置", "settings")}<span class="brand-update-slot" data-brand-update-slot>${renderShellBrandUpdate()}</span></div>
      </div>
    </aside>`;
}

// ------------------------------------------------------------
// Top bar
// ------------------------------------------------------------

function renderShellTaskListToggle(expanded) {
  const label = expanded ? "收起任务列表" : "展开任务列表";
  return `<button class="icon-button shell-pane-toggle shell-list-toggle" type="button" data-action="toggle-task-list" aria-controls="task-list-panel" aria-expanded="${expanded}" aria-label="${label}" title="${label}"${expanded ? "" : " hidden"}>${shellIcon("taskList")}</button>`;
}

function renderShellTopbar(task = shellActiveTask()) {
  const route = shellRoute();
  const routeNames = { today: "今日", tasks: "任务", calendar: "日历", review: "回顾", settings: "设置", trash: "最近删除" };
  const grouped = route === "tasks" && state.activeGroupId !== ALL_TASKS_GROUP_ID;
  const crumb = grouped ? shellGroupTitle(state.activeGroupId) : routeNames[route];
  const workspaceTask = !shellIsWide() ? task : null;
  const groupTitle = workspaceTask ? shellGroupTitle(workspaceTask.groupId) : crumb;
  return `
    <header class="topbar">
      ${!shellIsWide() ? '<div class="shell-list-header" aria-hidden="true"></div>' : ""}
      <div class="breadcrumb">
        ${renderShellSidebarToggle(false)}
        ${!shellIsWide() ? renderShellTaskListToggle(false) : ""}
        ${route === "tasks" && state.globalListReturn ? `<button class="text-button" type="button" data-action="return-global-page">返回${state.globalListReturn.route === "calendar" ? "日历" : "回顾"}</button>${shellIcon("chevron")}` : ""}
        ${workspaceTask ? `<span class="shell-task-path" aria-label="任务分组：${escAttr(groupTitle)}" title="${escAttr(groupTitle)}"><span class="shell-group-context">${shellIcon("folder")}<span>${esc(groupTitle)}</span></span></span><span class="topbar-focus-title">${shellIcon("chevron")}${renderShellTaskTitle(workspaceTask, "topbar")}</span>` : `<b>${esc(crumb)}</b>`}
      </div>
      <div class="shell-actions">
        <span class="preview-date">${esc(shellDateLabel().replaceAll(" ", ""))} ${SHELL_WEEKDAY_NAMES[loopNow().getDay()]}</span>
        <button class="icon-button topbar-util-btn" type="button" data-action="toggle-today-widget-visibility" aria-label="今日浮窗" title="今日浮窗">${shellIcon("widget")}</button>
        <button class="icon-button topbar-util-btn" type="button" data-action="toggle-theme" aria-label="${state.theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}" title="${state.theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}">${shellIcon(state.theme === "dark" ? "sun" : "moon")}</button>
        ${workspaceTask ? renderShellTaskActions(workspaceTask) : ""}
      </div>
    </header>`;
}

// Visibility changes keep the list and workspace mounted. In particular, a
// knowledge editor must retain its View, Undo journal, selection and draft.
let shellTaskListViewport = null;

function shellSetNavCollapsed(collapsed) {
  if (collapsed === state.navCollapsed) return;
  state.navCollapsed = collapsed;
  try { localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch {}
  shellSyncPaneVisibility();
}

function shellSetTaskListCollapsed(collapsed) {
  const next = collapsed === true;
  if (next === state.taskListCollapsed) return;
  const list = document.querySelector("#task-results");
  if (next && list) shellTaskListViewport = { view: taskRepositoryViewKey(), top: list.scrollTop, left: list.scrollLeft };
  state.taskListCollapsed = next;
  try { localStorage.setItem(TASK_LIST_COLLAPSED_KEY, next ? "1" : "0"); } catch {}
  shellSyncPaneVisibility();
}

function shellSyncPaneVisibility() {
  const sidebarClosed = state.navCollapsed === true;
  const listClosed = state.taskListCollapsed === true;
  const sidebar = document.querySelector(".navigation");
  const pane = document.querySelector(".task-list-pane");
  const closeNav = document.querySelector(".brand .nav-toggle");
  const restoreNavInList = pane?.querySelector(".nav-toggle");
  const restoreNavInWork = document.querySelector(".breadcrumb .nav-toggle");
  const collapseToggle = pane?.querySelector(".shell-list-toggle");
  const restoreToggle = document.querySelector(".breadcrumb .shell-list-toggle");
  const sidebarButtons = [closeNav, restoreNavInList, restoreNavInWork];
  const listButtons = [collapseToggle, restoreToggle];
  const sidebarButton = !sidebarClosed ? closeNav : (listClosed || !pane ? restoreNavInWork : restoreNavInList);
  const listButton = listClosed ? restoreToggle : collapseToggle;
  const active = document.activeElement;
  let focus;
  if (active && (sidebarButtons.includes(active) || (sidebarClosed && sidebar?.contains(active)))) focus = sidebarButton;
  else if (active && (listButtons.includes(active) || (listClosed && pane?.contains(active)))) focus = listButton;

  const app = document.querySelector(".app");
  app?.classList.toggle("sidebar-hidden", sidebarClosed);
  app?.classList.toggle("list-collapsed", listClosed);
  if (sidebar) sidebar.inert = sidebarClosed;
  if (pane) pane.inert = listClosed;
  for (const button of sidebarButtons) if (button) button.hidden = button !== sidebarButton;
  for (const button of listButtons) if (button) button.hidden = button !== listButton;
  if (focus && active !== focus) focus.focus({ preventScroll: true });
  if (!listClosed && shellTaskListViewport) {
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
  if (state.quickInboxOpen) return "速记";
  if (shellRoute() === "today") {
    return state.captureSourceFilter === "quick" ? "今日速记" : "今日";
  }
  if (state.activeGroupId !== ALL_TASKS_GROUP_ID) return shellGroupTitle(state.activeGroupId);
  return "任务";
}

function shellListFoot() {
  if (shellRoute() === "today") {
    return state.captureSourceFilter === "quick" ? "随手记录，稍后整理" : "";
  }
  return "";
}

function shellCompactDueLabel(task) {
  const deadline = safeDate(task.deadlineAt);
  if (!deadline) return null;
  const now = loopNow();
  const overdue = task.status !== "done" && deadline.getTime() < now.getTime();
  const todayKey = loopTodayKey();
  const tomorrowKey = localDateKey(new Date(now.getTime() + 86400000));
  const key = localDateKey(deadline);
  const time = typeof shellTimeLabel === "function" ? shellTimeLabel(deadline) : "";
  const mmdd = `${deadline.getMonth() + 1}/${String(deadline.getDate()).padStart(2, "0")}`;
  let text = key === todayKey
    ? `今天 ${time}`
    : key === tomorrowKey
      ? `明天 ${time}`
      : mmdd;
  if (overdue && key !== todayKey) text = mmdd;
  return { text, classes: overdue ? "overdue" : "" };
}

function shellCompactRecurLabel(recurrence) {
  return recurrenceCompactLabel(recurrence);
}

function shellTaskRowMeta(task) {
  if (shellTaskIsNote(task)) return "";
  const parts = [];
  if (task.status === "done") {
    if (task.resolvedAt) {
      const rd = safeDate(task.resolvedAt);
      const label = rd ? `${rd.getMonth() + 1}/${String(rd.getDate()).padStart(2, "0")} 完成` : `${shellDisplayDate(task.resolvedAt)} 完成`;
      parts.push(`<span class="task-meta-due">${esc(label)}</span>`);
    }
    if (task.conclusion) parts.push(`<span class="task-meta-concl">${esc(task.conclusion)}</span>`);
    return parts.length ? `<span class="task-row-sub">${parts.join("")}</span>` : "";
  }
  if (state.activeGroupId === ALL_TASKS_GROUP_ID || shellRoute() === "today") {
    parts.push(`<span class="task-meta-group">${esc(shellGroupTitle(task.groupId))}</span>`);
  }
  const due = shellCompactDueLabel(task);
  if (due) parts.push(`<span class="task-meta-due ${due.classes}">${esc(due.text)}</span>`);
  const recur = shellCompactRecurLabel(task.recurrence);
  if (recur) parts.push(`<span class="task-meta-recur">${shellIcon("repeat")}${esc(recur)}</span>`);
  const tags = normalizeTaskTags(task.tags);
  if (tags.blocked) parts.push('<span class="task-meta-tag is-blocked">卡住</span>');
  if (tags.later) parts.push('<span class="task-meta-tag is-later">稍后</span>');
  const nodes = typeof shellNodeList === "function" ? shellNodeList(task) : [];
  if (nodes.length) {
    const doneN = typeof shellCountDoneNodes === "function" ? shellCountDoneNodes(task) : 0;
    parts.push(`<span class="task-row-progress">${doneN}/${nodes.length}</span>`);
  }
  return parts.length ? `<span class="task-row-sub">${parts.join("")}</span>` : "";
}

function shellTaskRowSignals(task) {
  if (task.status === "done" || shellTaskIsNote(task)) return "";
  const p = normalizePriority(task.priority);
  const rank = p === "high" ? 3 : p === "medium" ? 2 : 1;
  return `<span class="task-pri-bars p${rank}" aria-hidden="true" title="优先级 ${p === "high" ? "高" : p === "medium" ? "中" : "低"}"><i></i><i></i><i></i></span>`;
}

function renderShellTaskRow(task, displayOrder) {
  const selected = task.id === state.activeTaskId;
  const done = task.status === "done";
  const note = shellTaskIsNote(task);
  return `
    <li class="task-item ${selected ? "selected" : ""} ${done ? "done" : ""} ${note ? "is-note" : ""}" data-task-row="${escAttr(task.id)}" data-task-id="${escAttr(task.id)}" data-context="task" draggable="true" data-task-drag-target="${escAttr(task.id)}">
      <span class="task-sequence-action">
        <span class="task-sequence" aria-hidden="true">${note ? shellIcon("note") : String(displayOrder).padStart(2, "0")}</span>
        <button class="task-complete" type="button" data-action="toggle-task-done" data-task-id="${escAttr(task.id)}" aria-label="${done ? "恢复任务" : "完成任务"}：${escAttr(task.title)}" aria-pressed="${done}" title="${done ? "恢复任务" : "完成任务"}"><span class="task-check-ring">${shellIcon("check")}</span></button>
      </span>
      <button class="task-select" type="button" data-task-id="${escAttr(task.id)}" aria-pressed="${selected}" title="${escAttr(task.title)}">
        <span class="task-select-main"><span class="task-item-title">${esc(task.title || "未命名任务")}</span>${shellTaskRowSignals(task)}</span>${shellTaskRowMeta(task)}
      </button>
    </li>`;
}

function shellActiveFilterLabels() {
  const labels = [];
  if (state.query.trim()) labels.push(`搜索「${state.query.trim()}」`);
  if (state.priorityFilter !== "all") labels.push(`${priorityFilterLabels[state.priorityFilter]}优先`);
  if (state.captureSourceFilter !== "all") labels.push(captureSourceFilterLabels[state.captureSourceFilter]);
  if (["blocked", "later"].includes(state.taskFilter)) labels.push(taskFilterLabels[state.taskFilter]);
  if (state.taskListTag) labels.push(SHELL_TASK_TAG_LABELS[state.taskListTag]);
  if (state.taskDeadlineFilter !== "all") labels.push(taskDeadlineFilterLabels[state.taskDeadlineFilter]);
  return labels;
}

function renderShellTaskRows(list) {
  if (shellBulk.active && list.length) return renderShellBulkRows(list);
  if (!list.length) {
    const filtered = shellActiveFilterLabels().length > 0 || Boolean(state.taskDateFilter);
    const today = shellRoute() === "today";
    const noun = state.captureSourceFilter === "quick" || state.quickInboxOpen ? "速记" : "任务";
    const message = filtered ? `没有匹配的${noun}` : today
      ? (state.todayFilter === "done" ? "今天暂无完成任务" : "暂无待办")
      : state.taskFilter === "done" ? `暂无已完成${noun}` : `这里还没有${noun}`;
    const recovery = typeof recovery26Open === "function" && state.recentlyDeleted?.length && (!today || filtered)
      ? '<button class="text-button" type="button" data-recovery26="open">最近删除</button>'
      : "";
    return `<div class="repository-empty"><p role="status">${message}</p>${filtered ? '<button class="text-button" type="button" data-action="clear-list-filters">清除筛选</button>' : `<button class="button" type="button" data-action="add-task">${shellIcon("plus")}新建${noun}</button>`}${recovery}</div>`;
  }
  return `<ol class="task-rows" aria-label="任务列表">${list.map((task, index) => renderShellTaskRow(task, index + 1)).join("")}</ol>`;
}

function renderShellListFilter() {
  const today = shellRoute() === "today";
  const current = today ? state.todayFilter : state.taskFilter;
  const options = [["active", "进行中"], ["all", "全部"], ["done", "已完成"]];
  const quickCount = state.tasks.filter(task => shellTaskIsNote(task) && task.status !== "done").length;
  return `<div class="list-filter">${options.map(([value, text]) => `<button class="filter-tab ${current === value ? "active" : ""}" type="button" ${today ? 'data-action="set-today-filter"' : 'data-setting-button="task-filter"'} data-value="${value}" aria-pressed="${current === value}">${text}</button>`).join("")}
    ${!today && quickCount ? shellQuickInboxButton(quickCount) : ""}
  </div>`;
}

function shellQuickInboxButton(count) {
  return `<button class="icon-button quick-inbox-button" type="button" data-action="toggle-quick-inbox" aria-label="速记 ${count}" title="速记" aria-pressed="${state.quickInboxOpen}">${shellIcon("bolt")}${count}</button>`;
}

function renderShellScopeChip() {
  const date = state.taskDateFilter;
  if (!date) return "";
  const parsed = safeDate(date);
  return `<div class="scope-chip">${shellIcon("calendar")}${parsed ? `${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日` : esc(date)} 截止<button class="icon-button" type="button" data-action="clear-list-date-filter" aria-label="清除截止日期筛选">${shellIcon("close")}</button></div>`;
}

function renderShellTaskList(list) {
  const note = state.captureSourceFilter === "quick" || state.quickInboxOpen;
  const filters = shellActiveFilterLabels();
  const searching = Boolean(state.searchOpen || state.query.trim());
  const footLabel = shellListFoot();
  return `
    <aside id="task-list-panel" class="task-list-pane ${shellRoute() === "today" ? "today-clean " : ""}" aria-label="任务列表">
      <span class="list-resizer" data-action="resize-list-column" role="separator" tabindex="0" aria-orientation="vertical" aria-label="调整任务列表宽度" aria-valuemin="230" aria-valuemax="460" aria-valuenow="${normalizeSidebarWidth(state.sidebarWidth)}" title="拖动调整任务列表宽度"></span>
      <div class="list-heading ${searching ? "is-searching" : ""}">
        ${renderShellSidebarToggle(false)}
        ${renderShellTaskListToggle(true)}
        <div class="list-heading-label">
          <h2 title="${escAttr(shellListTitle())}"><span class="list-title">${esc(shellListTitle())}</span><span class="count" role="status" aria-live="polite">${list.length}</span></h2>
        </div>
        <div class="list-search" role="search">
          ${shellIcon("search")}
          <input id="search" type="search" placeholder="搜索" aria-label="搜索${escAttr(shellListTitle())}中的任务、节点、速记" aria-controls="task-results" autocomplete="off" value="${escAttr(state.query)}" />
          <span class="list-search-end">
            <kbd class="search-shortcut" aria-hidden="true">${desktopPlatform === "darwin" ? "⌘" : "Ctrl"} K</kbd>
            <button class="search-clear" type="button" data-action="clear-search" aria-label="关闭搜索" title="关闭搜索（Esc）">${shellIcon("close")}</button>
          </span>
        </div>
        <div class="heading-list-actions">
          <button class="icon-button list-search-trigger" type="button" data-action="open-list-search" aria-label="搜索任务" title="搜索任务">${shellIcon("search")}</button>
          <button class="icon-button scope-filter ${filters.length ? "has-filters" : ""}" type="button" data-action="open-combined-filter" aria-label="筛选记录" aria-haspopup="dialog" title="${filters.length ? escAttr(`筛选记录：${filters.join(" · ")}`) : "筛选记录"}">${shellIcon("filter")}</button>
          <button class="icon-button" type="button" data-action="add-task" aria-label="新建${note ? "速记" : "任务"}" title="新建${note ? "速记" : "任务"}（${desktopPlatform === "darwin" ? "⌘" : "Ctrl"} + N）">${shellIcon("plus")}</button>
        </div>
      </div>
      ${renderShellListFilter()}
      ${filters.length ? `<div class="active-list-filters"><span title="${escAttr(filters.join(" · "))}">${esc(filters.join(" · "))}</span><button class="icon-button" type="button" data-action="clear-list-filters" aria-label="清除筛选" title="清除筛选">${shellIcon("close")}</button></div>` : ""}
      ${renderShellScopeChip()}
      <div id="task-results" class="tasks-scroll" data-context="task-list">${renderShellTaskRows(list)}</div>
      ${shellBulk.active
        ? `<footer class="list-foot bulk-dock" aria-label="批量操作">${shellBulkFooter()}</footer>`
        : `<footer class="list-foot">${footLabel ? `<span>${esc(footLabel)}</span>` : ""}${shellBulkFooter()}</footer>`}
    </aside>`;
}

/** Bind each retained search node once. IME drafts are applied on commit. */
function shellBindRepository() {
  const heading = document.querySelector(".task-list-pane .list-heading");
  const input = document.querySelector(".list-search #search");
  if (input && input.dataset.repositoryBound !== "1") {
    input.dataset.repositoryBound = "1";
    let composing = false;
    const closeIfEmpty = () => {
      if (!input.value.trim()) {
        state.searchOpen = false;
        heading?.classList.remove("is-searching");
      }
    };
    const update = () => {
      if (state.query === input.value) return;
      state.query = input.value;
      state.searchOpen = true;
      state.searchCursor = input.selectionStart ?? input.value.length;
      state.focusSearch = true;
      render();
    };
    input.addEventListener("focus", () => {
      state.searchOpen = true;
      heading?.classList.add("is-searching");
    });
    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (document.activeElement !== input && !input.value.trim()) closeIfEmpty();
      }, 120);
    });
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
        state.searchOpen = false;
        heading?.classList.remove("is-searching");
        document.querySelector(".task-rows .task-select")?.focus();
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

// ============================================================
// Loop -- shell interaction layer
//
// Implements the Demo's interactions on top of the production business
// functions. Everything here is presentation + delegation: no data model,
// storage or IPC contract is changed.
//
// Ported from prototypes/baseline/loop-plane-phase15-frozen/:
//   loop-plane-phase1.html  (overlay surfaces, status menu, node operations,
//                            title editor, combined filter, update panel)
//   loop-flow-phase11.js    (progress locator, path menu, reading mode)
// ============================================================

const SHELL_STATUS_HINTS = {
  todo: "等待继续推进",
  done: "本步骤已完成",
  blocked: "需要先解决阻碍",
  later: "留到之后处理",
};

// ------------------------------------------------------------
// Overlay plumbing (#overlay lives outside #root, like the Demo)
// ------------------------------------------------------------

function shellOverlay() {
  return document.querySelector("#overlay");
}

/**
 * Demo phase 16: every property panel shares one compact frame — a 340px
 * surface with a 取消 action next to 保存 and viewport clamping.
 */
function shellPanelFinish(form) {
  if (!form) return form;
  form.classList.add("entry16-panel");
  const footer = form.querySelector("footer");
  if (footer && !footer.querySelector('[data-action="close-dialog"]')) {
    footer.insertAdjacentHTML("afterbegin", '<button class="button" type="button" data-action="close-dialog">取消</button>');
  }
  const width = 340;
  form.style.width = `${width}px`;
  const left = Number.parseFloat(form.style.left);
  const top = Number.parseFloat(form.style.top);
  if (Number.isFinite(left)) form.style.left = `${Math.max(12, Math.min(left, innerWidth - width - 12))}px`;
  if (Number.isFinite(top)) form.style.top = `${Math.max(12, Math.min(top, innerHeight - 50 - form.offsetHeight))}px`;
  return form;
}

function shellSurfaceHeader(title) {
  return `<header class="dialog-head"><h2>${esc(title)}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="关闭">${shellIcon("close")}</button></header>`;
}

function shellMountSurface(markup, trigger, width = 320) {
  const overlay = shellOverlay();
  if (!overlay) return null;
  const rect = trigger?.getBoundingClientRect?.() || { left: 12, right: 340, bottom: 48 };
  const key = ["data-action", "data-edit-node-title", "data-node-operations", "data-flow-action"].find((name) => trigger?.hasAttribute?.(name));
  const selector = key ? `[${key}="${CSS.escape(trigger.getAttribute(key))}"]` : null;
  overlay.innerHTML = markup;
  const surface = overlay.querySelector(".surface-popover");
  if (!surface) return null;
  surface.style.width = `${width}px`;
  surface.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  surface.style.top = `${Math.max(12, Math.min(rect.bottom + 7, window.innerHeight - 50 - surface.offsetHeight))}px`;
  if (selector) surface.dataset.returnFocus = selector;
  trigger?.setAttribute?.("aria-expanded", "true");
  shellClampFloatingSurface(surface);
  (surface.querySelector("[autofocus]") || surface.querySelector("button, input, select"))?.focus({ preventScroll: true });
  return surface;
}

/** Keep fixed menus reachable when the desktop window shrinks around them. */
function shellClampFloatingSurface(surface) {
  if (!surface) return;
  const left = Number.parseFloat(surface.style.left), top = Number.parseFloat(surface.style.top);
  const width = surface.offsetWidth, availableHeight = Math.max(0, window.innerHeight - 24);
  if (surface.offsetHeight > availableHeight) {
    surface.style.maxHeight = `${availableHeight}px`;
    surface.style.overflowY = "auto";
  }
  if (Number.isFinite(left) && width > 0) surface.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`;
  if (Number.isFinite(top)) surface.style.top = `${Math.max(12, Math.min(top, window.innerHeight - surface.offsetHeight - 12))}px`;
}

function shellCloseOverlay({ restoreFocus = true } = {}) {
  if (shellOverlayDismissBlocked()) return;
  // Demo phase 16: dismissing keeps the creation draft for this session.
  if (document.querySelector("#create-form") && state.createDraft) shellCaptureCreateDraft();
  const overlay = shellOverlay();
  if (!overlay) return;
  const host = overlay.querySelector("[data-return-focus]");
  const selector = host?.dataset.returnFocus || "";
  overlay.innerHTML = "";
  if (!selector) return;
  const trigger = document.querySelector(selector);
  if (trigger?.hasAttribute("aria-haspopup") || trigger?.hasAttribute("aria-expanded")) trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) {
    trigger?.focus({ preventScroll: true });
    // The closing command can render immediately afterwards. Restore against
    // its live markup without taking focus from an explicitly opened editor.
    window.requestAnimationFrame(() => {
      if (document.activeElement === document.body || !document.activeElement?.isConnected) {
        document.querySelector(selector)?.focus({ preventScroll: true });
      }
    });
  }
}

function shellOverlayDismissBlocked() {
  return Boolean((state.feedbackSubmitting && document.querySelector("#help14-form"))
    || (typeof recovery26Busy !== "undefined" && recovery26Busy && document.querySelector("#overlay .recovery26-manager, #overlay .recovery26-confirm")));
}

/**
 * Overlay surfaces are created after render(), so their controls cannot be
 * bound per render. Delegate from #overlay instead: both the shared action
 * vocabulary and the batch-action vocabulary resolve here.
 */

// ============================================================
// 新建任务 / 速记对话框  (Demo phase 16)
//
// Structure, copy and interaction are ported from the frozen Demo's
// loop-task-phase16.js: a single dialog that leads with title/content,
// keeps group/priority/Today secondary and discloses deadline/reminder and
// recurrence on demand. The draft survives dismissal and is dropped only on
// an explicit 取消, matching the Demo's contract.
//
// The project has no store of its own for this draft, so it lives on
// state.createDraft; submission goes through the project's own createTask()
// and then applies the chosen properties.
// ============================================================

const SHELL_WEEKDAY_LABELS = { 0: "日", 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六" };

function shellCreateDraftFresh() {
  const route = shellRoute();
  return {
    kind: state.taskFilter === "today" || route === "today" ? "task" : "task",
    title: "",
    description: "",
    groupId: state.activeGroupId === ALL_TASKS_GROUP_ID ? "" : state.activeGroupId === UNGROUPED_TASKS_GROUP_ID ? "" : state.activeGroupId,
    priority: state.newTaskPriority,
    today: route === "today",
    deadline: "",
    deadlineTime: "18:00",
    reminder: "60",
    recurrence: { frequency: "none", time: "09:00", weekdays: [1, 2, 3, 4, 5], lastCompletedOccurrence: "" },
    dateOpen: false,
    cycleOpen: false,
  };
}

function shellCreateDate(offsetDays) {
  // Phase18: the panel's 今天 / 明天 presets follow the perceived clock.
  const date = loopNow();
  date.setDate(date.getDate() + offsetDays);
  return localDateKey(date);
}

function shellCreateChoice(value, label, attribute, active) {
  return `<button type="button" ${attribute}="${value}" class="${active ? "active" : ""}" aria-pressed="${active}">${label}</button>`;
}

function shellRenderCreateDialog(focusSelector) {
  const overlay = shellOverlay();
  if (!overlay) return;
  const draft = state.createDraft;
  const quick = draft.kind === "quick";
  const recurrence = draft.recurrence;
  const error = state.createError || "";
  const groups = [{ id: "", title: "未分组" }, ...sort(state.taskGroups).map((group) => ({ id: group.id, title: group.title }))];
  const deadlineLabel = draft.deadline ? `${draft.deadline} · ${draft.deadlineTime}` : "未设置";
  overlay.innerHTML = `<div class="dialog-backdrop" data-return-focus="[data-action='add-task']">
    <form class="dialog entry16-dialog" id="create-form" role="dialog" aria-modal="true" aria-labelledby="entry16-title" novalidate>
      <header class="dialog-head"><h2 id="entry16-title">新建${quick ? "速记" : "任务"}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="关闭">${shellIcon("close")}</button></header>
      <main class="entry16-body">
        <div class="entry16-types" role="group" aria-label="新建记录类型">${[["task", "任务"], ["quick", "速记"]].map(([value, label]) => shellCreateChoice(value, label, "data-composer-type", draft.kind === value)).join("")}</div>
        <div class="entry16-writing">
          <div>
            <label for="create-title">${quick ? "记录标题" : "任务标题"}</label>
            <input id="create-title" name="title" maxlength="160" autocomplete="off" value="${escAttr(draft.title)}" placeholder="${quick ? "先记下来，稍后整理" : "需要解决什么问题？"}" aria-required="true" aria-describedby="entry16-error" aria-invalid="${error === "请输入标题后再保存"}" />
            <p class="error" role="status" id="entry16-error">${error === "请输入标题后再保存" ? esc(error) : ""}</p>
          </div>
          <div>
            <label for="create-description">${quick ? "内容" : "背景"}<small>可选</small></label>
            <textarea id="create-description" name="description" placeholder="${quick ? "记录想法、线索或稍后要整理的内容" : "补充问题背景或需要达到的结果"}">${esc(draft.description)}</textarea>
          </div>
        </div>
        <div class="entry16-meta" ${quick ? 'style="grid-template-columns:1fr"' : ""}>
          <div><label for="create-group">分组</label><select id="create-group" name="group">${groups.map((group) => `<option value="${escAttr(group.id)}" ${group.id === draft.groupId ? "selected" : ""}>${esc(group.title)}</option>`).join("")}</select></div>
          ${quick ? "" : `<div><label id="entry16-priority-label">优先级</label><div class="entry16-priorities" role="group" aria-labelledby="entry16-priority-label">${[["high", "高"], ["medium", "中"], ["low", "低"]].map(([value, label]) => shellCreateChoice(value, shellIcon("flag") + label, "data-entry16-priority", draft.priority === value)).join("")}</div></div>`}
        </div>
        ${quick ? "" : `<label class="entry16-today"><input type="checkbox" name="today" ${draft.today ? "checked" : ""} />加入今日任务</label>
        <section class="entry16-options" aria-label="任务时间设置">
          <button type="button" class="entry16-disclosure" data-entry16="date" aria-expanded="${Boolean(draft.dateOpen)}" aria-controls="entry16-date">${shellIcon("calendar")}<span>截止与提醒</span><small>${esc(deadlineLabel)}</small>${shellIcon("chevron")}</button>
          ${draft.dateOpen ? `<div class="entry16-setting" id="entry16-date">
            <div class="entry16-date-grid">
              <div><label for="create-deadline">截止日期</label><input type="date" id="create-deadline" name="deadline" value="${escAttr(draft.deadline)}" /></div>
              <div><label for="create-time">时间</label><input type="time" id="create-time" name="deadlineTime" value="${escAttr(draft.deadlineTime)}" ${draft.deadline ? "" : "disabled"} /></div>
              <div><label for="create-reminder">系统提醒</label><select id="create-reminder" name="reminder" ${draft.deadline ? "" : "disabled"}>${Object.entries(deadlineReminderLabels).map(([value, label]) => `<option value="${value}" ${value === draft.reminder ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></div>
            </div>
            <p class="error" role="status">${error === "请补全有效的日期与时间" ? esc(error) : ""}</p>
            <div class="entry16-shortcuts">${[["", "今天"], [shellCreateDate(1), "明天"], [shellCreateDate(7), "一周后"], ["", "清除"]].map(([value, label], index) => `<button type="button" data-entry16-date="${index === 3 ? "" : value || shellCreateDate(0)}">${label}</button>`).join("")}</div>
          </div>` : ""}
          <button type="button" class="entry16-disclosure" data-entry16="cycle" aria-expanded="${Boolean(draft.cycleOpen)}" aria-controls="entry16-cycle">${shellIcon("repeat")}<span>循环任务</span><small>${esc(shellCreateRecurrenceLabel(recurrence))}</small>${shellIcon("chevron")}</button>
          ${draft.cycleOpen ? `<div class="entry16-setting" id="entry16-cycle">
            <div class="recurrence-modes" role="group" aria-label="循环周期">${[["none", "不循环"], ["daily", "每天"], ["weekly", "每周"]].map(([value, label]) => shellCreateChoice(value, label, "data-entry16-frequency", recurrence.frequency === value)).join("")}</div>
            ${recurrence.frequency === "none" ? "" : `<div class="entry16-cycle-fields">
              <div><label for="create-cycle-time">进入今日的时间</label><input type="time" id="create-cycle-time" name="cycleTime" value="${escAttr(recurrence.time)}" /></div>
              ${recurrence.frequency === "weekly" ? `<div><label id="entry16-week-label">重复日期</label><div class="recurrence-weekdays" role="group" aria-labelledby="entry16-week-label">${recurrenceWeekdayOrder.map((day) => shellCreateChoice(day, SHELL_WEEKDAY_LABELS[day], "data-entry16-weekday", recurrence.weekdays.includes(day))).join("")}</div></div>` : ""}
            </div>
            <p class="error" role="status">${error === "请为每周循环选择至少一天" ? esc(error) : ""}</p>
            <p class="schedule-hint">到期后进入今日；完成本次后，下个周期重新出现。</p>`}
          </div>` : ""}
        </section>`}
      </main>
      <footer>
        <span class="entry16-status">${state.createResumed ? "已恢复本页草稿" : "Esc 关闭 · ⌘ / Ctrl + Enter 保存"}</span>
        <button type="button" class="button" data-entry16="cancel">取消</button>
        <button type="submit" class="button primary">${quick ? "保存速记" : "创建任务"}</button>
      </footer>
    </form>
  </div>`;
  document.querySelector("#create-form")?.addEventListener("submit", shellSubmitCreateDialog);
  if (focusSelector) document.querySelector(focusSelector)?.focus({ preventScroll: true });
}

function shellCreateRecurrenceLabel(recurrence) {
  if (recurrence.frequency === "daily") return `每天 · ${recurrence.time}`;
  if (recurrence.frequency === "weekly") {
    const days = recurrenceWeekdayOrder.filter((day) => recurrence.weekdays.includes(day)).map((day) => SHELL_WEEKDAY_LABELS[day]).join("");
    return `每周${days} · ${recurrence.time}`;
  }
  return "不循环";
}

/** Read the form back into the draft without closing it. */
function shellCaptureCreateDraft() {
  const form = document.querySelector("#create-form");
  if (!form || !state.createDraft) return;
  const data = new FormData(form);
  const draft = state.createDraft;
  draft.title = String(data.get("title") || "");
  draft.description = String(data.get("description") || "");
  draft.groupId = String(data.get("group") || "");
  if (draft.kind === "task") {
    draft.today = data.get("today") === "on";
    if (data.has("deadline")) draft.deadline = String(data.get("deadline") || "");
    if (data.has("deadlineTime")) draft.deadlineTime = String(data.get("deadlineTime") || "18:00");
    if (data.has("reminder")) draft.reminder = String(data.get("reminder") || "none");
    if (data.has("cycleTime")) draft.recurrence.time = String(data.get("cycleTime") || "09:00");
  }
}

function shellOpenCreateDialog() {
  state.createResumed = Boolean(state.createDraft);
  state.createDraft = state.createDraft || shellCreateDraftFresh();
  state.createDraft.recurrence = state.createDraft.recurrence || shellCreateDraftFresh().recurrence;
  state.createError = "";
  shellRenderCreateDialog("#create-title");
}

function shellSubmitCreateDialog(event) {
  event.preventDefault();
  shellCaptureCreateDraft();
  const draft = state.createDraft;
  const quick = draft.kind === "quick";
  const title = draft.title.trim();
  if (!title) {
    state.createError = "请输入标题后再保存";
    shellRenderCreateDialog("#create-title");
    return;
  }
  if (!quick && draft.recurrence.frequency === "weekly" && !draft.recurrence.weekdays.length) {
    state.createError = "请为每周循环选择至少一天";
    draft.cycleOpen = true;
    shellRenderCreateDialog('[data-entry16-weekday="1"]');
    return;
  }
  const form = document.querySelector("#create-form");
  if (form && !form.checkValidity()) {
    state.createError = "请补全有效的日期与时间";
    shellRenderCreateDialog("#create-deadline");
    return;
  }
  const task = createTask(title, false);
  task.description = draft.description.trim();
  task.groupId = state.taskGroups.some((group) => group.id === draft.groupId) ? draft.groupId : "";
  task.priority = quick ? "low" : draft.priority;
  task.tags = normalizeTaskTags({ today: !quick && draft.today });
  task.recurrence = quick
    ? normalizeTaskRecurrence({})
    : normalizeTaskRecurrence({ ...draft.recurrence, lastCompletedOccurrence: "" });
  if (!quick && draft.deadline) {
    task.deadlineAt = `${draft.deadline}T${draft.deadlineTime || "18:00"}:00`;
    task.deadlineReminderMinutes = draft.reminder === "none" ? null : Number(draft.reminder);
  }
  if (quick) {
    task.captureSource = "today-widget";
    task.notes = draft.description.trim() || title;
    task.groupId = state.taskGroups.some((group) => group.id === draft.groupId) ? draft.groupId : "";
  }
  task.updatedAt = now();
  state.createDraft = null;
  state.createError = "";
  state.createResumed = false;
  shellCloseOverlay({ restoreFocus: false });
  state.activeTaskId = task.id;
  state.taskPane = "flow";
  state.selectedNodeId = "";
  if (state.taskFilter === "done") state.taskFilter = "active";
  save();
  // Demo phase 17: creation shows the same inline receipt as completion.
  shellShowJourneyReceipt({ id: task.id, kind: "created", context: null, occurrence: "", date: loopTodayKey() });
}


// ============================================================
// 任务操作链路  (Demo phase 17)
//
// Two pieces, ported from the frozen Demo's loop-journey-phase17.js:
//   1. .journey17-ready — the completion readiness panel. Completing a task
//      that still misses a conclusion or has unfinished nodes now offers direct
//      links to the exact record instead of only a transient notice.
//   2. .journey17-receipt — an inline create/complete receipt with contextual
//      actions and undo, rendered in the workspace footer for ten seconds.
//
// All data comes from the project's own model (taskCompletionBlocker,
// flatten, toggleTaskDone, state.taskPane / selectedNodeId / recordDraft).
// ============================================================

function shellJourneyReceipt() {
  return state.journeyReceipt || null;
}

function shellShowJourneyReceipt(receipt) {
  state.journeyReceipt = receipt;
  showWorkspaceFeedback("", "", { source: "journey", onDismiss: () => {
    if (state.journeyReceipt === receipt) state.journeyReceipt = null;
  } });
  render();
}

function shellClearJourneyReceipt() {
  state.journeyReceipt = null;
  clearWorkspaceFeedback("journey");
}

/** Capture enough context to come back after a detour through 日历 / 回顾. */
function shellCaptureJourneyContext() {
  return {
    taskFilter: state.taskFilter,
    activeGroupId: state.activeGroupId,
    activeTaskId: state.activeTaskId,
    selectedNodeId: state.selectedNodeId,
    taskPane: state.taskPane,
    query: state.query,
    priorityFilter: state.priorityFilter,
    captureSourceFilter: state.captureSourceFilter,
    taskDateFilter: state.taskDateFilter,
    taskDeadlineFilter: state.taskDeadlineFilter,
    calendarOpen: state.calendarOpen,
    calendarSelectedDate: state.calendarSelectedDate,
    calendarMonth: state.calendarMonth,
    reviewOpen: state.reviewOpen,
    reviewPreset: state.reviewPreset,
    reviewDateField: state.reviewDateField,
    reviewStartDate: state.reviewStartDate,
    reviewEndDate: state.reviewEndDate,
    scroll: [...document.querySelectorAll(".tasks-scroll, .workspace, .flow-scroll, .review-content")]
      .map((element) => ({ className: element.className, top: element.scrollTop })),
  };
}

function shellRestoreJourneyContext(context) {
  if (!context) return;
  const { scroll, ...values } = context;
  Object.assign(state, values);
  render();
  for (const entry of scroll) {
    document.querySelector(`.${entry.className.split(/\s+/).filter(Boolean).join(".")}`)?.scrollTo({ top: entry.top });
  }
}

function shellJourneyRevealTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  state.calendarOpen = false;
  state.reviewOpen = false;
  state.settingsOpen = false;
  state.activeTaskId = task.id;
  state.selectedNodeId = "";
  state.taskPane = "flow";
  render();
}

/** Demo phase 17: the readiness panel shown before a blocked completion. */
function shellCompletionReadiness(taskId, trigger) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const quick = task.captureSource === "today-widget";
  const remaining = flatten(task.nodes).filter((node) => node.status !== "done");
  const hasConclusion = quick || Boolean(task.conclusion.trim());
  const surface = shellMountSurface(
    `<section class="surface-popover entry16-panel journey17-ready" role="dialog" aria-modal="true" aria-labelledby="journey17-ready-title">
      ${shellSurfaceHeader("完成任务前").replace("<h2>", '<h2 id="journey17-ready-title">')}
      <p class="journey17-task-name">${esc(task.title || "未命名任务")}</p>
      <ul class="journey17-checks">
        <li class="${hasConclusion ? "ready" : ""}">${shellIcon(hasConclusion ? "check" : "circle")}
          <span><strong>处理结论</strong><small>${hasConclusion ? "已记录" : "还未记录结论"}</small></span>
          ${hasConclusion ? "" : `<button type="button" data-journey17="conclusion" data-record="${escAttr(task.id)}">补充结论${shellIcon("arrow")}</button>`}
        </li>
        <li class="${remaining.length ? "" : "ready"}">${shellIcon(remaining.length ? "circle" : "check")}
          <span><strong>处理流</strong><small>${remaining.length ? `${remaining.length} 个节点未完成` : flatten(task.nodes).length ? "所有节点已完成" : "暂无处理节点"}</small></span>
          ${remaining.length ? `<button type="button" data-journey17="node" data-record="${escAttr(task.id)}" data-next-node="${escAttr(remaining[0].id)}">定位节点${shellIcon("arrow")}</button>` : ""}
        </li>
      </ul>
      <p class="journey17-ready-hint">补齐后，再点击完成任务。</p>
    </section>`,
    trigger,
    360,
  );
  if (trigger?.hasAttribute("data-action")) {
    surface?.setAttribute("data-return-focus", `[data-action="toggle-task-done"][data-task-id="${task.id}"]`);
  }
  surface?.querySelector("[data-journey17]")?.focus({ preventScroll: true });
}

/** The inline receipt the workspace renders after a create or a completion. */
function renderShellJourneyReceipt() {
  const receipt = shellJourneyReceipt();
  if (!receipt) return "";
  const task = state.tasks.find((item) => item.id === receipt.id);
  if (!task) return "";
  // Phase18 (frozen Demo loop-journey-phase17.js syncReceipt): a receipt belongs
  // to the day it was shown on, and a completion receipt stops applying once the
  // task is active again — a recurrence may have reopened it on a new day.
  if (receipt.date && receipt.date !== loopTodayKey()) {
    state.journeyReceipt = null;
    return "";
  }
  if (receipt.kind === "done" && task.status !== "done") {
    state.journeyReceipt = null;
    return "";
  }
  const quick = task.captureSource === "today-widget";
  const completed = receipt.kind === "done";
  const actions = completed
    ? `<button type="button" data-journey17="result">查看结果</button><button type="button" data-journey17="review">查看回顾</button><button type="button" data-journey17="undo">撤销</button>`
    : `${!quick && isTaskScheduledForToday(task) ? '<button type="button" data-journey17="today">查看今日</button>' : ""}${task.deadlineAt ? '<button type="button" data-journey17="calendar">查看日历</button>' : ""}`;
  const detail = completed
    ? task.recurrence?.frequency !== "none"
      ? "本次已完成 · 下个周期会重新进入今日"
      : "结论与处理过程已保留"
    : quick
      ? "速记已保留"
      : `${shellGroupTitle(task.groupId)}${task.deadlineAt ? ` · ${shellDisplayDate(localDateKey(task.deadlineAt))} 截止` : ""}`;
  const message = `${completed ? "已完成" : "已创建"} · ${task.title || "未命名任务"}`;
  return `<span class="workspace-feedback-message" title="${escAttr(`${message} · ${detail}`)}">${shellIcon(completed ? "check" : "plus")}<span>${esc(message)}</span></span><div class="workspace-feedback-actions">${actions}</div>`;
}

/** Calendar agendas show a finished task's conclusion instead of its hypothesis. */
function shellApplyCalendarConclusions() {
  if (!state.calendarOpen) return;
  document.querySelectorAll(".agenda-item").forEach((row) => {
    const task = state.tasks.find((item) => item.id === row.querySelector("[data-action='open-calendar-task']")?.dataset.taskId);
    const summary = row.querySelector(".summary");
    if (task?.status === "done" && task.conclusion && summary) summary.textContent = task.conclusion;
  });
}

function shellJourneyAction(action, trigger) {
  const receipt = shellJourneyReceipt();
  if (action === "dismiss") {
    shellClearJourneyReceipt();
    render();
    return true;
  }
  const task = receipt ? state.tasks.find((item) => item.id === receipt.id) : null;
  if (!task) return true;
  if (action === "conclusion" || action === "node") {
    const target = state.tasks.find((item) => item.id === trigger?.dataset.record) || task;
    shellJourneyRevealTask(target.id);
    if (action === "conclusion") {
      state.taskPane = "flow";
      state.recordDraft = "";
      render();
      if (!(document.body.hasAttribute("data-brief21-enabled") && brief21BeginEdit(`${state.activeTaskId}:conclusion`))) {
        document.querySelector("[data-action='shell-edit-brief'][data-field='conclusion']")?.click();
      }
    } else {
      const nodeId = trigger?.dataset.nextNode;
      if (nodeId) {
        state.nodeRecordPreview = "";
        state.selectedNodeId = nodeId;
        render();
        const element = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
        element?.focus({ preventScroll: true });
        element?.scrollIntoView({ block: "nearest" });
      }
    }
    return true;
  }
  if (action === "result") {
    shellJourneyRevealTask(task.id);
    if (document.body.hasAttribute("data-brief21-enabled")) { brief21BeginEdit(`${state.activeTaskId}:conclusion`); return; }
    document.querySelector("[data-action='shell-edit-brief'][data-field='conclusion']")?.scrollIntoView({ block: "nearest" });
    return true;
  }
  if (action === "today") {
    state.calendarOpen = false;
    state.reviewOpen = false;
    state.settingsOpen = false;
    state.taskFilter = "today";
    state.activeTaskId = task.id;
    shellClearJourneyReceipt();
    render();
    return true;
  }
  if (action === "calendar") {
    shellClearJourneyReceipt();
    state.calendarOpen = true;
    state.reviewOpen = false;
    state.settingsOpen = false;
    state.calendarSelectedDate = localDateKey(task.deadlineAt);
    state.calendarMonth = `${localDateKey(task.deadlineAt).slice(0, 7)}-01`;
    render();
    return true;
  }
  if (action === "review") {
    shellClearJourneyReceipt();
    state.reviewOpen = true;
    state.calendarOpen = false;
    state.settingsOpen = false;
    state.reviewPreset = "week";
    state.reviewDateField = "resolved";
    render();
    return true;
  }
  if (action === "undo") {
    shellClearJourneyReceipt();
    if (task.status === "done") {
      toggleTaskDone(task.id);
      if (task.recurrence && receipt.occurrence !== undefined) task.recurrence.lastCompletedOccurrence = receipt.occurrence;
      shellRestoreJourneyContext(receipt.context);
      shellToast("已撤销完成，处理内容保留");
    } else {
      render();
      shellToast("任务已恢复");
    }
    return true;
  }
  return true;
}

function shellBindJourneyReceipt() {
  if (typeof document.addEventListener !== "function") return;
  if (document.__loopJourneyBound) return;
  document.__loopJourneyBound = true;
  document.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-workspace-dismiss]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearWorkspaceFeedback();
      return;
    }
    const button = event.target.closest?.("[data-journey17]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    shellJourneyAction(button.dataset.journey17, button);
  }, true);
}

function shellBindCreateDialog() {
  // the renderer test harness stubs `document` without event APIs
  if (typeof document.addEventListener !== "function") return;
  if (document.__loopCreateBound) return;
  document.__loopCreateBound = true;
  const isInside = (element) => Boolean(element?.closest?.("#create-form"));
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("button");
    if (!button || !isInside(button)) return;
    const draft = state.createDraft;
    if (!draft) return;
    shellCaptureCreateDraft();
    let focus;
    if (button.dataset.composerType) { draft.kind = button.dataset.composerType; focus = `[data-composer-type="${draft.kind}"]`; }
    else if (button.dataset.entry16Priority) { draft.priority = button.dataset.entry16Priority; focus = `[data-entry16-priority="${draft.priority}"]`; }
    else if (button.dataset.entry16 === "date") { draft.dateOpen = !draft.dateOpen; focus = '[data-entry16="date"]'; }
    else if (button.dataset.entry16 === "cycle") { draft.cycleOpen = !draft.cycleOpen; focus = '[data-entry16="cycle"]'; }
    else if (button.dataset.entry16 === "cancel") {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.createDraft = null;
      state.createError = "";
      state.createResumed = false;
      shellCloseOverlay({ restoreFocus: false });
      render();
      return;
    }
    else if (button.hasAttribute("data-entry16-date")) { draft.deadline = button.dataset.entry16Date; focus = '[data-entry16="date"]'; }
    else if (button.dataset.entry16Time) { draft.deadlineTime = button.dataset.entry16Time; focus = '[data-entry16-time="' + draft.deadlineTime + '"]'; }
    else if (button.dataset.entry16Frequency) { draft.recurrence.frequency = button.dataset.entry16Frequency; focus = `[data-entry16-frequency="${draft.recurrence.frequency}"]`; }
    else if (button.hasAttribute("data-entry16-weekday")) {
      const day = Number(button.dataset.entry16Weekday);
      const days = draft.recurrence.weekdays;
      draft.recurrence.weekdays = days.includes(day) ? days.filter((value) => value !== day) : [...days, day];
      focus = `[data-entry16-weekday="${day}"]`;
    }
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.createError = "";
    shellRenderCreateDialog(focus);
  }, true);
  document.addEventListener("input", (event) => {
    if (!isInside(event.target)) return;
    shellCaptureCreateDraft();
    if (!state.createError) return;
    state.createError = "";
    document.querySelectorAll("#create-form .error").forEach((element) => { element.textContent = ""; });
    document.querySelector("#create-title")?.setAttribute("aria-invalid", "false");
  });
  document.addEventListener("change", (event) => {
    if (!isInside(event.target)) return;
    shellCaptureCreateDraft();
    if (event.target.id === "create-deadline") shellRenderCreateDialog("#create-deadline");
  });
  document.addEventListener("keydown", (event) => {
    const form = document.querySelector("#create-form");
    if (!form) return;
    if (event.isComposing || event.keyCode === 229) { event.stopImmediatePropagation(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      form.requestSubmit();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...form.querySelectorAll("button:not(:disabled),input:not(:disabled),textarea,select:not(:disabled),a[href]")].filter((element) => element.getClientRects().length);
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    event.stopImmediatePropagation();
  }, true);
}

function shellBindOverlayDelegation() {
  const overlay = shellOverlay();
  if (!overlay || overlay.dataset.shellDelegated === "1") return;
  overlay.dataset.shellDelegated = "1";
  const updateFeedback = (event) => {
    const field = event.target.closest?.("#help14-form [data-feedback-field]");
    if (!field || state.feedbackSubmitting) return;
    const key = field.dataset.feedbackField;
    state.feedbackDraft[key] = field.type === "checkbox" ? field.checked : field.value;
    delete state.feedbackErrors[key];
    state.feedbackMessage = "";
    field.setAttribute("aria-invalid", "false");
    field.removeAttribute("aria-describedby");
    overlay.querySelector(`#help14-${CSS.escape(key)}-error`)?.remove();
    overlay.querySelector("[data-feedback-message]")?.remove();
    if (key === "includeEnvironment") {
      const caption = overlay.querySelector("[data-feedback-environment]");
      if (caption) caption.hidden = !field.checked;
    }
  };
  overlay.addEventListener("input", updateFeedback);
  overlay.addEventListener("change", updateFeedback);
  overlay.addEventListener("submit", (event) => {
    if (event.target.id !== "help14-form") return;
    event.preventDefault();
    void submitBugReport();
  });
  overlay.addEventListener("click", (event) => {
    const preset = event.target.closest?.("[data-entry16-time]");
    if (!preset) return;
    event.preventDefault();
    event.stopPropagation();
    shellAction({ action: "set-deadline-time", value: preset.dataset.entry16Time }, preset);
  });
  const run = async (target, event) => {
    const bulk = target.closest("[data-bulk-action], [data-bulk-id]");
    if (bulk && !bulk.disabled) {
      event.preventDefault();
      event.stopPropagation();
      if (bulk.dataset.bulkId) {
        shellBulkSelect(bulk.dataset.bulkId, event.shiftKey);
      } else {
        await shellBulkActionRun(bulk.dataset.bulkAction, bulk, event);
      }
      return true;
    }
    const action = target.closest("[data-action]");
    if (action && !action.disabled) {
      event.preventDefault();
      event.stopPropagation();
      action.dataset.actionBound = "1";   // the document-level fallback must not repeat this
      void (globalThis.action || action)(action.dataset, event);
      return true;
    }
    return false;
  };
  overlay.addEventListener("click", (event) => { void run(event.target, event); });
  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const control = event.target.closest("[role='button'], [role='menuitem'], [role='menuitemradio'], button");
    if (!control) return;
    void run(event.target, event);
  });
}

// ------------------------------------------------------------
// Title editor (task and node)
// ------------------------------------------------------------

function shellTitleEditor(trigger, nodeId) {
  const task = shellActiveTask();
  if (!task) return;
  const node = nodeId ? shellNodeList(task).find((item) => item.id === nodeId) : null;
  if (nodeId && !node) return;
  const title = node ? node.title : task.title;
  const label = node ? "节点标题" : shellTaskIsNote(task) ? "速记标题" : "任务标题";
  shellMountSurface(
    `<form class="surface-popover" id="title-form" role="dialog" aria-modal="true" aria-label="修改标题">${shellSurfaceHeader(label)}<label for="editable-title">标题</label><input name="title" id="editable-title" value="${escAttr(title)}" required maxlength="160" autofocus /><footer><button type="submit" class="button primary">保存</button></footer></form>`,
    trigger,
    340,
  );
  const input = document.querySelector("#editable-title");
  input?.select();
  const titleForm = shellPanelFinish(document.querySelector("#title-form"));
  titleForm?.querySelector("footer")?.insertAdjacentHTML("beforebegin", '<p class="error" id="entry16-title-error" role="status"></p>');
  input?.setAttribute("aria-describedby", "entry16-title-error");
  input?.addEventListener("input", () => {
    const box = document.querySelector("#entry16-title-error");
    if (box) box.textContent = "";
    input.setAttribute("aria-invalid", "false");
  });
  document.querySelector("#title-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = input.value.trim();
    if (!next) {
      const box = document.querySelector("#entry16-title-error");
      if (box) box.textContent = "请输入标题后再保存";
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    if (node) node.title = next;
    else task.title = next;
    task.updatedAt = now();
    shellCloseOverlay();
    render();
  });
}

// ------------------------------------------------------------
// Node status menu
// ------------------------------------------------------------

function shellStatusMenu(trigger, nodeId) {
  const task = shellActiveTask();
  const node = shellNodeList(task).find((item) => item.id === nodeId);
  if (!node) return;
  const rect = trigger.getBoundingClientRect();
  const isInspector = trigger.classList.contains("status-trigger");
  const selector = isInspector ? ".status-trigger" : ".node-status";
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - 213);
  const overlay = shellOverlay();
  overlay.innerHTML = `<div class="status-menu" role="menu" aria-label="选择节点状态" data-return-focus="${selector}[data-node-id='${CSS.escape(nodeId)}']" style="left:${left}px;top:${rect.bottom + 5}px">
    <p class="status-menu-title">选择状态</p>
    ${Object.entries(SHELL_NODE_STATUS_LABELS).map(([status, label]) => `<button class="status-option ${status}" type="button" role="menuitemradio" aria-checked="${node.status === status}" data-action="set-node-status" data-node-id="${escAttr(nodeId)}" data-status="${status}">${shellIcon(status === "todo" ? "circle" : status)}<span>${label}<small>${SHELL_STATUS_HINTS[status]}</small></span>${node.status === status ? shellIcon("check", "status-selected") : ""}</button>`).join("")}
  </div>`;
  const menu = overlay.querySelector(".status-menu");
  const height = menu.getBoundingClientRect().height;
  menu.style.top = `${rect.bottom + 5 + height < window.innerHeight ? rect.bottom + 5 : Math.max(8, rect.top - height - 5)}px`;
  trigger.setAttribute("aria-expanded", "true");
  menu.querySelector(".status-option[aria-checked='true']")?.focus({ preventScroll: true });
}

// ------------------------------------------------------------
// Node operations and deletion
// ------------------------------------------------------------

function shellNodeSiblings(task, nodeId) {
  const path = shellNodePath(task, nodeId);
  const parent = path.at(-2);
  const siblings = parent ? parent.children : task.nodes;
  return { path, parent, siblings, index: siblings.findIndex((item) => item.id === nodeId) };
}

function shellNodeOperations(trigger, nodeId) {
  const task = shellActiveTask();
  const { parent, siblings, index } = shellNodeSiblings(task, nodeId);
  const moves = [
    ["up", "上移", index === 0],
    ["down", "下移", index === siblings.length - 1],
    ["in", "缩进为子节点", index === 0],
    ["out", "提升为同级节点", !parent],
  ];
  shellMountSurface(
    `<div class="surface-popover" role="menu" aria-label="节点操作">${shellSurfaceHeader("节点操作")}
      <button class="button" type="button" role="menuitem" data-action="edit-node-title" data-node-id="${escAttr(nodeId)}">${shellIcon("edit")}修改标题</button>
      <button class="button" type="button" role="menuitem" data-action="add-sibling-node" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(nodeId)}">${shellIcon("plus")}添加兄弟节点</button>
      <button class="button" type="button" role="menuitem" data-action="add-child-node" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(nodeId)}">${shellIcon("indent")}添加子节点</button>
      <div class="menu-divider"></div>
      ${moves.map(([value, label, disabled]) => `<button class="button" type="button" role="menuitem" data-action="move-node" data-node-id="${escAttr(nodeId)}" data-direction="${value}" ${disabled ? "disabled" : ""}>${label}</button>`).join("")}
      <div class="menu-divider"></div>
      <button class="button danger-action" type="button" role="menuitem" data-action="open-node-delete" data-node-id="${escAttr(nodeId)}">${shellIcon("close")}删除节点…</button>
    </div>`,
    trigger,
    225,
  );
}

function shellNodeDelete(trigger, nodeId) {
  const task = shellActiveTask();
  const node = shellNodeList(task).find((item) => item.id === nodeId);
  if (!node) return;
  if (typeof recovery26ReviewDeleteNode === "function") {
    shellCloseOverlay({ restoreFocus: false });
    recovery26ReviewDeleteNode(task.id, nodeId);
    return;
  }
  const children = flatten(node.children || []).length;
  shellMountSurface(
    `<form class="surface-popover" id="delete-node-form" role="dialog" aria-modal="true" aria-label="确认删除">${shellSurfaceHeader("删除节点")}
      <p>删除「${esc(node.title)}」？</p>
      <p class="schedule-hint">${children ? `该节点及其 ${children} 个子节点、处理记录将一并删除。` : "该节点及其处理记录将一并删除。"}</p>
      <footer><button type="button" class="button" data-action="close-dialog">取消</button><button type="submit" class="button danger-action">确认删除</button></footer>
    </form>`,
    trigger,
    320,
  );
  document.querySelector("#delete-node-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    // Phase26 routes the node's whole-subtree removal through the unified
    // archive: the Demo's own impact dialog replaces this stage's panel, and the
    // subtree keeps its parent and sibling position for a later restore.
    if (typeof recovery26ReviewDeleteNode === "function") {
      shellCloseOverlay({ restoreFocus: false });
      recovery26ReviewDeleteNode(task.id, nodeId);
      return;
    }
    shellCloseOverlay({ restoreFocus: false });
    await deleteNode(task.id, nodeId);
    render();
  });
}

function shellPathMenu(trigger, nodeId) {
  const task = shellActiveTask();
  const path = shellNodePath(task, nodeId);
  shellMountSurface(
    `<section class="surface-popover flow-path-menu" role="menu" aria-label="完整节点路径">${shellSurfaceHeader("节点路径")}
      ${path.map((node, index) => `<button class="flow-result ${node.id === nodeId ? "current" : ""}" type="button" role="menuitem" data-action="open-node-detail" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(node.id)}"><small class="result-level">第 ${index + 1} 层</small><strong>${esc(node.title)}</strong></button>`).join("")}
    </section>`,
    trigger,
    340,
  );
}

// ------------------------------------------------------------
// Progress locator
// ------------------------------------------------------------

let shellLocatorQuery = "";

function shellLocatorResults() {
  const task = shellActiveTask();
  const query = shellLocatorQuery.trim().toLowerCase();
  const list = shellNodeList(task).filter((node) => shellFlowNodeVisible(node) && (!query || `${node.title} ${node.note}`.toLowerCase().includes(query)));
  if (!list.length) {
    return `<div class="flow-locator-empty"><span>没有匹配节点</span><button class="text-button" type="button" data-action="clear-locator">清空</button></div>`;
  }
  return list.map((node) => {
    const path = shellNodePath(task, node.id);
    const parent = path.at(-2);
    return `<button class="flow-result ${node.id === state.selectedNodeId ? "current" : ""}" type="button" data-action="open-node-detail" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(node.id)}"><strong>${esc(node.title)}</strong><small><span class="result-level">第 ${path.length} 层</span>${shellNodeStatusLabel(node.status)}${parent ? ` · ${esc(parent.title)}` : " · 顶层"}</small></button>`;
  }).join("");
}

function shellFlowLocator(trigger) {
  shellLocatorQuery = "";
  const surface = shellMountSurface(
    `<section class="surface-popover flow-locator" role="dialog" aria-modal="true" aria-label="定位处理流节点">${shellSurfaceHeader("定位节点")}
      <label class="sr-only" for="flow-locator-query">搜索当前任务的节点与记录</label>
      <input id="flow-locator-query" type="search" placeholder="搜索节点" autocomplete="off" autofocus />
      <div class="flow-locator-results" aria-live="polite">${shellLocatorResults()}</div>
    </section>`,
    trigger,
    360,
  );
  const input = surface?.querySelector("#flow-locator-query");
  input?.addEventListener("input", () => {
    shellLocatorQuery = input.value;
    const host = document.querySelector(".flow-locator-results");
    if (host) host.innerHTML = shellLocatorResults();
  });
}

function shellFocusNextPending() {
  const task = shellActiveTask();
  if (!task) return;
  const list = shellNodeList(task);
  const start = list.findIndex((node) => node.id === state.selectedNodeId);
  const next = list.slice(start + 1).find((node) => node.status === "todo" || node.status === "blocked")
    || list.find((node) => node.status === "todo" || node.status === "blocked");
  if (!next) return;
  selectNodeForInspector(task.id, next.id);
}

// ------------------------------------------------------------
// Combined filter / update panel
// ------------------------------------------------------------

function shellOption(value, label, selected) {
  return `<option value="${escAttr(value)}" ${String(selected) === String(value) ? "selected" : ""}>${esc(label)}</option>`;
}

function shellCombinedFilter(trigger) {
  const today = shellRoute() === "today";
  const kinds = [["all", "全部"], ["task", "任务"], ["quick", "速记"]];
  const statuses = today ? [["active", "未完成"], ["done", "已完成"]] : [["active", "未完成"], ["all", "全部"], ["done", "已完成"], ["blocked", "卡住"], ["later", "稍后"]];
  shellMountSurface(
    `<form class="surface-popover" id="combined-filter-form" role="dialog" aria-modal="true" aria-label="筛选记录">${shellSurfaceHeader("筛选")}
      <div class="filter-fields">
        <div><label for="record-kind">记录类型</label><select id="record-kind" name="kind">${kinds.map(([value, label]) => shellOption(value, label, state.captureSourceFilter)).join("")}</select></div>
        <div><label for="record-status">任务状态</label><select id="record-status" name="status">${statuses.map(([value, label]) => shellOption(value, label, today ? state.todayFilter : state.taskFilter)).join("")}</select></div>
        <div><label for="record-priority">优先级</label><select id="record-priority" name="priority">${Object.entries(SHELL_PRIORITY_FILTER_LABELS).map(([value, label]) => shellOption(value, label, state.priorityFilter)).join("")}</select></div>
        <div><label for="record-deadline">截止范围</label><select id="record-deadline" name="deadline">${Object.entries(SHELL_DEADLINE_SCOPE_LABELS).map(([value, label]) => shellOption(value, label, state.taskDeadlineFilter)).join("")}</select></div>
      </div>
      <footer><button type="button" class="text-button" data-action="clear-list-filters">清除筛选</button><button type="submit" class="button primary">应用</button></footer>
    </form>`,
    trigger,
    276,
  );
  document.querySelector("#combined-filter-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    state.captureSourceFilter = normalizeCaptureSourceFilter(String(data.get("kind")));
    if (today) state.todayFilter = data.get("status") === "done" ? "done" : "active";
    state.taskFilter = today ? "today" : normalizeTaskFilter(String(data.get("status")));
    state.priorityFilter = normalizePriorityFilter(String(data.get("priority")));
    state.taskDeadlineFilter = Object.hasOwn(SHELL_DEADLINE_SCOPE_LABELS, String(data.get("deadline"))) ? String(data.get("deadline")) : "all";
    state.taskDateFilter = "";
    shellCloseOverlay();
    if (!filteredTasks().some((task) => task.id === state.activeTaskId)) state.activeTaskId = "";
    save();
    render();
  });
}

function shellUpdatePanelBody() {
  const update = appUpdateState;
  const titles = {
    available: "新版本可用",
    downloading: "正在下载更新",
    downloaded: "下载完成，等待安装",
    preparing: "正在准备更新",
    installing: "正在安装更新",
    error: update.retryAction === "check" ? "检查更新失败" : "更新未完成",
    checking: "正在检查更新",
    latest: "当前已是最新版本",
    idle: "尚未检查更新",
  };
  const bodies = {
    available: "点击下载获取更新包，完成后由你选择安装。",
    downloading: `${Math.round(update.percent || 0)}% · 下载期间可继续处理任务。`,
    downloaded: update.errorCode ? "升级前保存未完成，应用没有退出。请检查磁盘空间或目录权限后重试。" : "你可以继续使用 Loop，准备好后点击“安装并重启”。",
    preparing: "正在安全写入任务与知识笔记草稿。",
    installing: "应用即将自动重启，请稍候。",
    error: updateErrorPresentation(update.errorCode).detail,
    checking: "正在连接 GitHub Release。",
  };
  const version = update.version ? ` · 新版本 v${update.version}` : "";
  const progress = ["downloading", "preparing", "installing"].includes(update.status)
    ? `<div class="update-progress" role="progressbar" aria-label="更新下载进度" aria-valuenow="${Math.round(update.percent || 0)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.max(4, Math.round(update.percent || 0))}%"></span></div>`
    : "";
  return `${shellSurfaceHeader("")}
      <h2>${esc(titles[update.status] || "软件更新")}</h2>
      <p>当前 v${esc(update.currentVersion || APP_VERSION || "")}${esc(version)}</p>
      <p>${esc(bodies[update.status] || "暂无可用更新。")}</p>
      ${progress}
      ${renderUpdateReleaseNotes(update)}
      <footer>
        <button type="button" class="text-button" data-action="close-dialog">稍后</button>
        ${["available", "error"].includes(update.status) ? `<button type="button" class="button primary" data-update-action="${update.status === "error" ? update.retryAction : "download"}">${update.status === "error" ? (update.retryAction === "check" ? "重新检查" : update.retryAction === "install" ? "重试安装" : "重试下载") : "下载更新"}</button>` : ""}
        ${update.status === "downloaded" ? '<button type="button" class="button primary" data-update-action="install">安装并重启</button>' : ""}
      </footer>`;
}

function shellUpdatePanel(trigger) {
  // shellMountSurface only mounts when the markup contains .surface-popover;
  // without it the click silently did nothing at all.
  shellMountSurface(`<section class="surface-popover utility-popover" aria-label="软件更新">${shellUpdatePanelBody()}</section>`, trigger, 310);
}

/** Keep an open 软件更新 popover in step with the state (progress, errors). */
function shellRefreshUpdatePanel() {
  const panel = document.querySelector('.utility-popover[aria-label="软件更新"]');
  if (!panel) return false;
  replaceUpdateSurfaceContent(panel, shellUpdatePanelBody());
  return true;
}

// ------------------------------------------------------------
// Task property overlays
//
// Ported from the Demo's showChoiceMenu / showDeadline / showRecurrence /
// showMoveRecord (loop-plane-phase1.html). The project stores the deadline as
// one ISO timestamp while the Demo keeps a display string plus a date and a
// time; the panel keeps the Demo's date+time presentation and writes the
// combined timestamp back through the existing field.
// ------------------------------------------------------------

function shellChoiceMenu(trigger, title, options, selected, dataKey, iconName = "flag") {
  const rect = trigger.getBoundingClientRect();
  const overlay = shellOverlay();
  overlay.innerHTML = `<div class="priority-popover" role="menu" aria-label="${escAttr(title)}" data-return-focus="[data-action='${escAttr(trigger.dataset.action)}']" style="left:${Math.max(12, Math.min(rect.left, window.innerWidth - 200))}px;top:${rect.bottom + 7}px">
    <p class="status-menu-title">${esc(title)}</p>
    ${Object.entries(options).map(([value, label]) => `<button type="button" role="menuitemradio" aria-checked="${selected === value}" data-action="set-task-priority" data-priority="${escAttr(value)}">${shellIcon(iconName)}<span>${esc(label)}</span>${selected === value ? shellIcon("check") : "<span></span>"}</button>`).join("")}
  </div>`;
  shellClampFloatingSurface(overlay.querySelector(".priority-popover"));
  trigger.setAttribute("aria-expanded", "true");
  overlay.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
}

function shellDeadlineDraft(task) {
  const deadline = safeDate(task.deadlineAt);
  const today = loopTodayKey();
  return {
    date: deadline ? localDateKey(deadline) : today,
    month: (deadline ? localDateKey(deadline) : today).slice(0, 7),
    time: deadline ? shellTimeLabel(deadline) : "18:00",
    reminder: String(normalizeDeadlineReminderMinutes(task.deadlineReminderMinutes) ?? "none"),
  };
}

function shellScheduleDays(draft) {
  const first = new Date(`${draft.month}-01T12:00:00`);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((((first.getDay() + 6) % 7) + daysInMonth) / 7);
  const today = loopTodayKey();
  return Array.from({ length: weeks * 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = localDateKey(date);
    const classes = [
      key.slice(0, 7) !== draft.month ? "outside" : "",
      key === draft.date ? "selected" : "",
      key === today ? "today" : "",
    ].filter(Boolean).join(" ");
    return `<button type="button" class="schedule-day ${classes}" data-action="shell-schedule-day" data-date="${key}" aria-label="选择 ${key}" aria-pressed="${key === draft.date}">${date.getDate()}</button>`;
  }).join("");
}

function shellDeadlinePanel(trigger) {
  const task = shellActiveTask();
  if (!task) return;
  shellDeadlineTrigger = trigger || null;
  state.deadlineDraft = shellDeadlineDraft(task);
  shellRenderDeadlinePanel(trigger);
}

// ------------------------------------------------------------
// Phase18 · review-only preview clock
//
// The frozen Demo put a 预览时间 control in its review bar to move `demoNow`
// so every time-based state could be inspected. The product keeps the same
// control, and only this control changes the perceived clock.
// ------------------------------------------------------------

function shellClockPresets() {
  const now = loopNow();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (date, hours, minutes = 0) => {
    const value = new Date(date);
    value.setHours(hours, minutes, 0, 0);
    return value;
  };
  const monday = new Date(day);
  monday.setDate(day.getDate() + ((8 - (day.getDay() || 7)) % 7 || 7));
  return [
    ["", "真实时间", at(day, now.getHours(), now.getMinutes())],
    ["today-1800", "今天 18:00", at(day, 18)],
    ["tomorrow-0900", "明天 09:00", at(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1), 9)],
    ["next-monday", "下周一 09:00", at(monday, 9)],
    ["next-month", "下月 1 日 09:00", at(new Date(day.getFullYear(), day.getMonth() + 1, 1), 9)],
    ["next-year", "明年 1 月 1 日 09:00", at(new Date(day.getFullYear() + 1, 0, 1), 9)],
  ];
}

function shellClockValueFor(preset) {
  const entry = shellClockPresets().find(([key]) => key === preset);
  return entry ? `${localDateKey(entry[2])}T${String(entry[2].getHours()).padStart(2, "0")}:${String(entry[2].getMinutes()).padStart(2, "0")}` : "";
}

function shellRenderClockPanel(trigger) {
  const now = loopNow();
  const date = localDateKey(now);
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const presets = shellClockPresets();
  shellMountSurface(
    `<form class="surface-popover entry16-panel time18-clock" id="time18-clock-form" role="dialog" aria-modal="true" aria-label="预览时间">${shellSurfaceHeader("预览时间")}
      <p class="schedule-hint">仅改变应用内的时间基准，不修改系统时间；本页的操作与记录会保留。</p>
      <div class="schedule-fields">
        <div><label for="time18-day">日期</label><input id="time18-day" name="day" type="date" value="${escAttr(date)}" min="2020-01-01" max="2035-12-31" required /></div>
        <div><label for="time18-hour">时间</label><input id="time18-hour" name="hour" type="time" value="${escAttr(time)}" required /></div>
      </div>
      <div class="time18-presets" role="group" aria-label="时间场景">${presets.map(([key, label, value]) => `<button type="button" data-action="time18-preset" data-preset="${key}" class="${key === "" && !loopClockIsPreview() ? "active" : ""}" aria-pressed="${key === "" && !loopClockIsPreview()}"><span>${label}</span><time>${localDateKey(value).slice(5)} ${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}</time></button>`).join("")}</div>
      <footer>
        <button type="button" class="text-button" data-action="time18-clear" ${loopClockIsPreview() ? "" : "disabled"}>恢复真实时间</button>
        <button type="button" class="button" data-action="close-dialog">取消</button>
        <button class="button primary" type="submit">应用时间</button>
      </footer>
    </form>`,
    trigger,
    360,
  );
  shellPanelFinish(document.querySelector("#time18-clock-form"));
  document.querySelector("#time18-clock-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const day = document.querySelector("#time18-day")?.value || "";
    const hour = document.querySelector("#time18-hour")?.value || "";
    if (day && hour) shellApplyPreviewClock(`${day}T${hour}`);
  });
}

/** Move the perceived clock; every time-based surface follows. */
function shellApplyPreviewClock(value) {
  const oldDay = loopTodayKey();
  if (value === "" || value === null) loopClearPreviewClock();
  else if (!loopSetPreviewClock(value)) return;
  if (state.calendarSelectedDate === oldDay) state.calendarSelectedDate = loopTodayKey();
  if (state.calendarMonth && state.calendarMonth.slice(0, 4) === oldDay.slice(0, 4)) state.calendarMonth = `${loopTodayKey().slice(0, 7)}-01`;
  syncRecurringTasks?.(loopNow());
  shellCloseOverlay({ restoreFocus: false });
  if (!filteredTasks().some((item) => item.id === state.activeTaskId)) state.activeTaskId = "";
  render();
  shellToast(loopClockIsPreview() ? `预览时间已切换 · ${loopStamp()}` : "已恢复真实时间");
}

function shellRenderDeadlinePanel(trigger) {
  const task = shellActiveTask();
  const draft = state.deadlineDraft;
  const month = new Date(`${draft.month}-01T12:00:00`);
  const today = loopTodayKey();
  const tomorrowDate = loopNow();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localDateKey(tomorrowDate);
  const selected = safeDate(`${draft.date}T${draft.time}`);
  const surface = shellMountSurface(
    `<form class="surface-popover" id="deadline-form" role="dialog" aria-modal="true" aria-label="设置截止时间">${shellSurfaceHeader("截止时间")}
      <div class="schedule-shortcuts">
        <button type="button" class="button" data-action="shell-schedule-day" data-date="${today}">今天</button>
        <button type="button" class="button" data-action="shell-schedule-day" data-date="${tomorrow}">明天</button>
      </div>
      <div class="schedule-month">
        <strong>${month.getFullYear()} 年 ${month.getMonth() + 1} 月</strong>
        <button type="button" class="icon-button" data-action="shell-schedule-month" data-direction="-1" aria-label="上个月"><svg viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(180deg)"><path d="${SHELL_ICON_PATHS.chevron}"></path></svg></button>
        <button type="button" class="icon-button" data-action="shell-schedule-month" data-direction="1" aria-label="下个月">${shellIcon("chevron")}</button>
      </div>
      <div class="schedule-weekdays" aria-hidden="true">${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<span>${day}</span>`).join("")}</div>
      <div class="schedule-days">${shellScheduleDays(draft)}</div>
      <div class="schedule-fields">
        <div><label for="deadline-time">截止时间</label><input type="time" id="deadline-time" name="time" value="${escAttr(draft.time)}" required /></div>
        <div><label for="deadline-reminder">系统提醒</label><select id="deadline-reminder" name="reminder">${Object.entries(deadlineReminderLabels).map(([value, label]) => shellOption(value, label, draft.reminder)).join("")}</select></div>
      </div>
      <p class="schedule-hint">${esc(shellDisplayDate(draft.date))} ${SHELL_WEEKDAY_NAMES[new Date(`${draft.date}T12:00:00`).getDay()]} · ${draft.date === today ? "会显示在今日任务中" : "截止日期不改变任务的分组"}</p>
      ${typeof desktopReminderStatusRow === "function" ? desktopReminderStatusRow() : ""}
      <footer>
        ${task.deadlineAt ? '<button class="text-button" type="button" data-action="shell-remove-deadline">清除截止时间</button>' : ""}
        <button type="submit" class="button primary">应用</button>
      </footer>
    </form>`,
    trigger,
    320,
  );
  shellPanelFinish(document.querySelector("#deadline-form"));
  document.querySelector("#deadline-form .schedule-fields")?.insertAdjacentHTML(
    "afterend",
    `<div class="entry16-time-presets" role="group" aria-label="常用截止时间">${["09:00", "12:00", "17:30", "18:00"].map((value) => `<button type="button" data-entry16-time="${value}">${value}</button>`).join("")}</div>`,
  );
  const timeInput = surface?.querySelector("#deadline-time");
  const reminderSelect = surface?.querySelector("#deadline-reminder");
  timeInput?.addEventListener("input", () => { state.deadlineDraft.time = timeInput.value; shellRefreshDeadlineHint(); });
  reminderSelect?.addEventListener("change", () => { state.deadlineDraft.reminder = reminderSelect.value; });
  // #deadline-form IS the mounted .surface-popover, so query it from the document.
  document.querySelector("#deadline-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const task = shellActiveTask();
    const wasScheduledToday = task ? isTaskScheduledForToday(task) : false;
    shellApplyDeadline(state.deadlineDraft.date, timeInput?.value || state.deadlineDraft.time, reminderSelect?.value ?? state.deadlineDraft.reminder);
    if (task) shellMembershipFeedback(task, wasScheduledToday);
  });
}

/**
 * Phase18 (frozen Demo loop-time-phase18.js membershipFeedback): a date or cycle
 * edit explains how the task's Today membership changed, and links to the record.
 */
function shellMembershipFeedback(task, wasScheduledToday) {
  if (!task) return;
  const scheduled = isTaskScheduledForToday(task);
  if (wasScheduledToday && !scheduled) shellToast("已移出今日，任务与处理记录保留", task);
  else if (shellRoute() === "today" && scheduled) shellToast(normalizeTaskTags(task.tags).today ? "已更新，手动加入的任务继续留在今日" : "已更新今日安排");
  else shellToast("已更新任务安排");
}

function shellRefreshDeadlineHint() {
  const hint = document.querySelector("#deadline-form .schedule-hint");
  const draft = state.deadlineDraft;
  if (!hint || !draft) return;
  const today = loopTodayKey();
  hint.textContent = `${shellDisplayDate(draft.date)} ${SHELL_WEEKDAY_NAMES[new Date(`${draft.date}T12:00:00`).getDay()]} · ${draft.date === today ? "会显示在今日任务中" : "截止日期不改变任务的分组"}`;
}

function shellApplyDeadline(date, time, reminder) {
  const task = shellActiveTask();
  if (!task) return;
  const stamp = safeDate(`${date}T${time || "18:00"}`);
  task.deadlineAt = stamp ? stamp.toISOString() : "";
  task.deadlineReminderMinutes = normalizeDeadlineReminderMinutes(reminder);
  task.updatedAt = now();
  shellCloseOverlay({ restoreFocus: false });
  save();
  render();
}

// ------------------------------------------------------------
// Recurrence
// ------------------------------------------------------------

function shellRecurrencePreview(recurrence) {
  const value = normalizeTaskRecurrence(recurrence);
  if (value.frequency === "none") return "";
  const items = recurrenceUpcomingLabels
    ? recurrenceUpcomingLabels(value, loopNow(), 3)
    : [];
  if (!items.length) return "";
  return `<div class="recurrence-preview"><strong>接下来</strong>${items.map((item) => `<p>${esc(item)}</p>`).join("")}</div>`;
}

/**
 * Phase18: the cycle panel states which occurrence is current — the task's own
 * occurrence key decides, and a completion dated today counts as done.
 */
function shellCycleState() {
  const task = shellActiveTask();
  if (!task) return "";
  const occurrence = recurringOccurrenceKey(task);
  const done = normalizeTaskRecurrence(task.recurrence).lastCompletedOccurrence === loopTodayKey();
  const label = done ? "本次已完成" : occurrence ? "本次待处理" : "尚未到本次时间";
  return `<p class="time18-cycle-state">${label}<span> · ${esc(shellDisplayDate(loopNow()))}</span></p>`;
}

function shellRenderRecurrencePanel(trigger) {
  const draft = state.recurrenceDraft;
  const surface = shellMountSurface(
    `<form class="surface-popover" id="recurrence-form" role="dialog" aria-modal="true" aria-label="设置循环任务">${shellSurfaceHeader("循环任务")}
      <div class="recurrence-modes" role="group" aria-label="循环周期">${[["none", "不循环"], ["daily", "每天"], ["weekly", "每周"]].map(([value, label]) => `<button type="button" class="${draft.frequency === value ? "active" : ""}" data-action="shell-recurrence-mode" data-mode="${value}" aria-pressed="${draft.frequency === value}">${label}</button>`).join("")}</div>
      ${draft.frequency !== "none" ? shellCycleState() : ""}
      ${draft.frequency !== "none" ? `
        <label for="recurrence-time">显示在今日的时间</label>
        <input id="recurrence-time" name="time" type="time" value="${escAttr(draft.time)}" required />
        ${draft.frequency === "weekly" ? `<div class="recurrence-weekdays" role="group" aria-label="选择循环日期，可多选">${recurrenceWeekdayOrder.map((day) => `<button type="button" class="${draft.weekdays.includes(day) ? "active" : ""}" data-action="shell-recurrence-day" data-day="${day}" aria-label="${escAttr(recurrenceWeekdayLabels[day])}" aria-pressed="${draft.weekdays.includes(day)}">${recurrenceWeekdayLabels[day].slice(1)}</button>`).join("")}</div>` : ""}
        <div class="recurrence-preview-host">${shellRecurrencePreview(draft)}</div>
        <p class="schedule-hint">到期后进入今日；完成本次后，下个周期重新出现。</p>`
      : '<p class="schedule-hint">保留为一次性任务。</p>'}
      <p class="error" id="recurrence-error" role="status"></p>
      <footer><button type="submit" class="button primary">保存</button></footer>
    </form>`,
    trigger,
    320,
  );
  surface?.querySelector("#recurrence-time")?.addEventListener("input", (event) => {
    state.recurrenceDraft.time = event.target.value;
    const host = document.querySelector(".recurrence-preview-host");
    if (host) host.innerHTML = shellRecurrencePreview(state.recurrenceDraft);
  });
    shellPanelFinish(document.querySelector("#recurrence-form"));
  document.querySelector("#recurrence-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const task = shellActiveTask();
    const wasScheduledToday = task ? isTaskScheduledForToday(task) : false;
    const draft2 = state.recurrenceDraft;
    if (draft2.frequency === "weekly" && !draft2.weekdays.length) {
      const error = document.querySelector("#recurrence-error");
      if (error) error.textContent = "请选择至少一天";
      return;
    }
    if (!task) return;
    draft2.time = document.querySelector("#recurrence-time")?.value || draft2.time;
    task.recurrence = normalizeTaskRecurrence({ ...draft2, lastCompletedOccurrence: draft2.lastCompletedOccurrence || "" });
    task.updatedAt = now();
    syncRecurringTasks?.(loopNow());
    shellCloseOverlay({ restoreFocus: false });
    save();
    render();
    shellMembershipFeedback(task, wasScheduledToday);
  });
}

function shellRecurrencePanel(trigger) {
  const task = shellActiveTask();
  if (!task) return;
  shellRecurrenceTrigger = trigger || null;
  const recurrence = normalizeTaskRecurrence(task.recurrence);
  state.recurrenceDraft = { ...recurrence, weekdays: [...recurrence.weekdays] };
  shellRenderRecurrencePanel(trigger);
}

// ------------------------------------------------------------
// Group picker
// ------------------------------------------------------------

let shellDeadlineTrigger = null;
let shellRecurrenceTrigger = null;

function shellGroupPanel(trigger) {
  const task = shellActiveTask();
  if (!task) return;
  const groups = sort(state.taskGroups);
  const overlay = shellOverlay();
  overlay.innerHTML = `<div class="dialog-backdrop" data-return-focus="[data-action='toggle-task-group-select']">
    <form class="dialog" id="move-group-form" aria-label="移动分组">
      <div class="dialog-head"><h2>移动分组</h2><button class="icon-button" type="button" data-action="close-dialog" aria-label="关闭">${shellIcon("close")}</button></div>
      <label for="move-group">分组</label>
      <select id="move-group" name="group">
        <option value="" ${task.groupId ? "" : "selected"}>未分组</option>
        ${groups.map((group) => `<option value="${escAttr(group.id)}" ${task.groupId === group.id ? "selected" : ""}>${esc(group.title)}</option>`).join("")}
      </select>
      <footer><button class="button" type="button" data-action="close-dialog">取消</button><button class="button primary" type="submit">移动</button></footer>
    </form>
  </div>`;
  document.querySelector("#move-group")?.focus();
  document.querySelector("#move-group-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    task.groupId = document.querySelector("#move-group")?.value ?? "";
    task.updatedAt = now();
    shellCloseOverlay({ restoreFocus: false });
    save();
    render();
  });
}

// ------------------------------------------------------------
// Drafts (brief fields)
// ------------------------------------------------------------

function shellStartBriefDraft(taskId, field) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const key = `${taskId}:${field}`;
  state.shellDrafts[key] = String(task[field] || "");
  render();
  document.querySelector(`[data-shell-draft="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

function shellFinishBriefDraft(key, commit) {
  const task = state.tasks.find((item) => item.id === key.split(":")[0]);
  const field = key.split(":")[1];
  if (!task) {
    delete state.shellDrafts[key];
    return;
  }
  if (commit) {
    const value = String(state.shellDrafts[key] ?? "");
    if (task[field] !== value) {
      task[field] = value;
      if (field === "hypothesis") task.hypothesisUpdatedAt = now();
      task.updatedAt = now();
      if (field === "conclusion" && value.trim()) clearConclusionNotice?.(task.id);
    }
  }
  delete state.shellDrafts[key];
  save();
  render();
}

function shellStartTaskMenu() {
  state.taskMenuOpen = true;
}

function shellCloseTaskMenu({ restoreFocus = false } = {}) {
  if (!state.taskMenuOpen) return;
  state.taskMenuOpen = false;
  document.querySelector("[data-task-menu]")?.remove();
  const trigger = document.querySelector('[data-action="open-task-menu"]');
  trigger?.setAttribute("aria-expanded", "false");
  if (restoreFocus) trigger?.focus({ preventScroll: true });
}

// ------------------------------------------------------------
// Dispatcher
// ------------------------------------------------------------

async function shellAction(data, event) {
  const trigger = event?.currentTarget || event?.target;
  const task = shellActiveTask();
  switch (data.action) {
    case "toggle-completed-nodes":
      shellHideCompletedNodes = !shellHideCompletedNodes;
      try { localStorage.setItem(SHELL_HIDE_COMPLETED_KEY, shellHideCompletedNodes ? "1" : "0"); } catch {}
      return true;
    case "toggle-nav":
      state.navCollapsed = !state.navCollapsed;
      return true;
    case "clear-search":
      state.query = "";
      state.searchOpen = false;
      state.focusSearch = true;
      return true;
    case "open-toast-record":
      shellJourneyRevealTask(data.taskId);
      return true;
    case "desk19-status":
      desktopReminderStatusPanel(trigger);
      return true;
    case "desk19-help":
      desktopReminderHelpPanel(trigger);
      return true;
    case "desk19-check":
      void desktopReminderCheck(trigger);
      return true;
    case "desk19-calendar":
      shellCloseOverlay({ restoreFocus: false });
      ensureCalendarState();
      state.calendarOpen = true;
      state.settingsOpen = false;
      state.reviewOpen = false;
      render();
      return true;
    case "desk19-preview-open":
      desktopReminderOpenEntry(data.index);
      return true;
    case "time18-clock":
      shellRenderClockPanel(trigger || shellDeadlineTrigger || document.body);
      return true;
    case "time18-preset": {
      const preset = data.preset || "";
      shellApplyPreviewClock(preset ? shellClockValueFor(preset) : "");
      return true;
    }
    case "time18-clear":
      shellApplyPreviewClock("");
      return true;
    case "show-today-completed":
      // Phase18: today's completions stay reachable after they leave the list.
      state.todayFilter = "done";
      state.activeTaskId = "";
      shellCloseOverlay({ restoreFocus: false });
      return true;
    case "show-today-active":
      state.todayFilter = "active";
      state.activeTaskId = "";
      shellCloseOverlay({ restoreFocus: false });
      return true;
    case "clear-list-filters":
      state.query = "";
      state.searchOpen = false;
      state.priorityFilter = "all";
      state.captureSourceFilter = "all";
      state.taskDeadlineFilter = "all";
      state.taskDateFilter = "";
      // Completion tabs and Today are the current scope. Only the optional
      // blocked/later predicates belong to the clearable filter summary.
      if (["blocked", "later"].includes(state.taskFilter)) state.taskFilter = "all";
      shellCloseOverlay({ restoreFocus: false });
      if (!filteredTasks().some((item) => item.id === state.activeTaskId)) state.activeTaskId = "";
      save();
      return true;
    case "clear-list-date-filter":
      state.taskDateFilter = "";
      if (!filteredTasks().some((item) => item.id === state.activeTaskId)) state.activeTaskId = "";
      return true;
    case "commit-group-edit": {
      const value = document.querySelector("#group-title")?.value ?? "";
      const groupId = state.editingGroupId;
      state.editingGroupId = "";
      state.focusGroupTitleId = "";
      if (groupId) renameGroup(groupId, value, true);
      return true;
    }
    case "cancel-group-edit":
      state.editingGroupId = "";
      state.focusGroupTitleId = "";
      return true;
    case "edit-task-title":
      shellTitleEditor(trigger, null);
      return true;
    case "edit-node-title":
      shellTitleEditor(trigger, data.nodeId);
      return true;
    case "open-node-status":
      shellStatusMenu(trigger, data.nodeId);
      return true;
    case "set-node-status": {
      if (!task) return true;
      const node = shellNodeList(task).find((item) => item.id === data.nodeId);
      if (!node) return true;
      markNodeStatus(task.id, data.nodeId, data.status);
      shellCloseOverlay({ restoreFocus: false });
      return true;
    }
    case "open-node-operations":
      shellNodeOperations(trigger, data.nodeId);
      return true;
    case "open-node-delete":
      shellNodeDelete(trigger, data.nodeId);
      return true;
    case "open-node-path":
      shellPathMenu(trigger, data.nodeId);
      return true;
    case "move-node": {
      if (!task) return true;
      const { parent, siblings, index } = shellNodeSiblings(task, data.nodeId);
      const direction = data.direction;
      if (direction === "up" && index > 0) {
        siblings.splice(index - 1, 0, siblings.splice(index, 1)[0]);
        reorder(siblings);
      } else if (direction === "down" && index < siblings.length - 1) {
        siblings.splice(index + 1, 0, siblings.splice(index, 1)[0]);
        reorder(siblings);
      } else if (direction === "in" && index > 0) {
        const target = siblings[index - 1];
        const [moved] = siblings.splice(index, 1);
        moved.parentId = target.id;
        target.collapsed = false;
        target.children = target.children || [];
        target.children.push(moved);
        reorder(siblings);
        reorder(target.children);
      } else if (direction === "out" && parent) {
        const grand = shellNodeSiblings(task, parent.id);
        const [moved] = siblings.splice(index, 1);
        moved.parentId = grand.parent ? grand.parent.id : null;
        grand.siblings.splice(grand.index + 1, 0, moved);
        reorder(grand.siblings);
      }
      task.updatedAt = now();
      shellCloseOverlay({ restoreFocus: false });
      return true;
    }
    case "open-flow-locator":
      shellFlowLocator(trigger);
      return true;
    case "clear-locator":
      shellLocatorQuery = "";
      {
        const host = document.querySelector(".flow-locator-results");
        if (host) host.innerHTML = shellLocatorResults();
        document.querySelector("#flow-locator-query")?.focus({ preventScroll: true });
      }
      return true;
    case "focus-next-pending":
      shellFocusNextPending();
      return true;
    case "toggle-node-reading":
      state.nodeDetailFullscreen = !state.nodeDetailFullscreen;
      return true;
    case "toggle-note-preview":
      state.nodeRecordPreview = !state.nodeRecordPreview;
      return true;
    case "open-task-menu":
      shellStartTaskMenu();
      return true;
    case "toggle-task-priority-menu": {
      if (!task) return true;
      shellChoiceMenu(trigger, "任务优先级", SHELL_PRIORITY_LABELS, normalizePriority(task.priority), "priority");
      return true;
    }
    case "toggle-deadline-picker":
      shellDeadlinePanel(trigger);
      return true;
    case "open-task-recurrence":
      shellRecurrencePanel(trigger);
      return true;
    case "toggle-task-group-select":
      shellGroupPanel(trigger);
      return true;
    case "shell-schedule-day":
      state.deadlineDraft.date = data.date;
      state.deadlineDraft.month = data.date.slice(0, 7);
      shellRenderDeadlinePanel(shellDeadlineTrigger);
      return true;
    case "shell-schedule-month": {
      const base = new Date(`${state.deadlineDraft.month}-01T12:00:00`);
      base.setMonth(base.getMonth() + Number(data.direction || 1));
      state.deadlineDraft.month = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
      shellRenderDeadlinePanel(shellDeadlineTrigger);
      return true;
    }
    case "shell-remove-deadline": {
      if (!task) return true;
      const wasScheduledToday = isTaskScheduledForToday(task);
      task.deadlineAt = "";
      task.deadlineReminderMinutes = null;
      task.updatedAt = now();
      shellCloseOverlay({ restoreFocus: false });
      save();
      render();
      shellMembershipFeedback(task, wasScheduledToday);
      return true;
    }
    case "shell-recurrence-mode":
      state.recurrenceDraft.frequency = ["none", "daily", "weekly"].includes(data.mode) ? data.mode : "none";
      if (state.recurrenceDraft.frequency === "weekly" && !state.recurrenceDraft.weekdays.length) state.recurrenceDraft.weekdays = [loopNow().getDay()];
      shellRenderRecurrencePanel(shellRecurrenceTrigger);
      return true;
    case "shell-recurrence-day": {
      const day = Number(data.day);
      const weekdays = new Set(state.recurrenceDraft.weekdays);
      if (weekdays.has(day)) weekdays.delete(day);
      else weekdays.add(day);
      state.recurrenceDraft.weekdays = recurrenceWeekdayOrder.filter((value) => weekdays.has(value));
      shellRenderRecurrencePanel(shellRecurrenceTrigger);
      return true;
    }
    case "toggle-note-summary":
      state.noteSummaryOpen = !state.noteSummaryOpen;
      return true;
    case "knowledge-mode":
      applySetting("knowledge-mode", data.mode);
      return true;
    case "knowledge-width-menu":
      shellNoteWidthMenu(trigger);
      return true;
    case "set-note-width":
      applySetting("knowledge-width", data.width);
      shellCloseOverlay({ restoreFocus: false });
      return true;
    case "knowledge-file-menu":
      shellKnowledgeFileMenu(trigger);
      return true;
    case "knowledge-file-info":
      shellKnowledgeFileInfo(knowledgeActiveDocument());
      return true;
    case "export-knowledge-note":
      shellKnowledgeExportNote(knowledgeFindDocument(data.taskId) || knowledgeActiveDocument());
      return true;
    case "knowledge-conflict":
      shellKnowledgeConflict(knowledgeActiveDocument());
      return true;
    case "note-format":
      if (data.format === "link") shellKnowledgeLink(trigger);
      else shellApplyNoteFormat(data.format);
      return true;
    case "note-heading":
      shellApplyNoteFormat("heading", Number(data.level) || 0);
      return true;
    case "set-deadline-time": {
      // Demo phase 16: half-hour/常用时间 presets above the field.
      const input = document.querySelector("#deadline-time");
      if (!input) return true;
      input.value = data.value;
      const draft = state.deadlineDraft;
      if (draft) draft.time = data.value;
      shellRefreshDeadlineHint();
      input.focus({ preventScroll: true });
      return true;
    }
    case "journey-action":
      return shellJourneyAction(data.value, trigger);
    case "select-nav-group": {
      // The Demo's group buttons navigate to 任务仓库 with that group. The
      // "today" filter scopes the list to every group's today tasks and would
      // otherwise ignore the selection, so leaving it is part of navigating.
      state.calendarOpen = false;
      state.reviewOpen = false;
      state.settingsOpen = false;
      if (state.taskFilter === "today") state.taskFilter = "all";
      selectGroup(data.groupId);
      save();
      return true;
    }
    case "open-knowledge-settings":
      state.settingsOpen = true;
      state.calendarOpen = false;
      state.reviewOpen = false;
      state.feedbackOpen = false;
      state.globalListReturn = null;
      activeSettingsPage = "knowledge";
      settingsMotion = "page";
      shellCloseOverlay({ restoreFocus: false });
      return true;
    case "set-settings-page":
      if (SHELL_SETTINGS_CATEGORIES.some(([page]) => page === data.page)) {
        activeSettingsPage = data.page;
        settingsMotion = "page";
      }
      return true;
    case "open-settings-choice":
      shellSettingsChoiceMenu(trigger, data.key);
      return true;
    case "set-settings-choice":
      // Changing a default inside Settings keeps the same page visible.
      const settingsWasOpen = state.settingsOpen;
      applySetting(data.key, data.value);
      if (settingsWasOpen) state.settingsOpen = true;
      save();
      shellCloseOverlay({ restoreFocus: false });
      return true;
    case "reset-appearance":
      state.theme = "light";
      state.fontScale = "large";
      state.zhFont = "system";
      state.enFont = "system";
      save();
      return true;
    case "toggle-today-widget-always-on-top": {
      if (!desktopTodayWidget) return true;
      const next = todayWidgetWindowState.alwaysOnTop !== true;
      todayWidgetWindowState = { ...todayWidgetWindowState, alwaysOnTop: next };
      await desktopTodayWidget.setPreferences({ alwaysOnTop: next });
      todayWidgetWindowState = await desktopTodayWidget.getState();
      return true;
    }
    case "open-help-feedback":
      state.feedbackErrors = {};
      state.feedbackMessage = "";
      state.feedbackResult = null;
      shellHelpFeedbackDialog();
      return true;
    case "close-help-feedback":
      if (state.feedbackSubmitting) return true;
      shellCloseOverlay();
      state.feedbackErrors = {};
      state.feedbackMessage = "";
      state.feedbackResult = null;
      return true;
    case "toggle-help-topic": {
      const index = Number(data.topic);
      state.helpTopicOpen = Number(state.helpTopicOpen) === index ? -1 : index;
      return true;
    }
    case "submit-feedback":
      await submitBugReport();
      // submitBugReport() renders the page; refresh the open dialog as well
      if (shellOverlay()?.firstElementChild) shellHelpFeedbackDialog();
      return true;
    case "reset-feedback":
      state.feedbackResult = null;
      state.feedbackErrors = {};
      state.feedbackMessage = "";
      state.feedbackDraft = createEmptyFeedbackDraft();
      return true;
    case "open-combined-filter":
      shellCombinedFilter(trigger);
      return true;
    case "open-update-panel":
      shellUpdatePanel(trigger);
      return true;
    case "run-update-download":
      shellCloseOverlay();
      await runUpdateAction("download");
      return true;
    case "run-update-install":
      shellCloseOverlay();
      await runUpdateAction("install");
      return true;
    case "shell-edit-brief":
      shellStartBriefDraft(data.taskId, data.field);
      return true;
    case "shell-save-draft":
      shellFinishBriefDraft(data.key, true);
      return true;
    case "shell-cancel-draft":
      shellFinishBriefDraft(data.key, false);
      return true;
    case "close-dialog":
      shellCloseOverlay();
      state.taskMenuOpen = false;
      state.contextMenu = null;
      return true;
    case "close-node":
    case "close-node-detail":
      state.selectedNodeId = "";
      state.recordDraft = "";
      state.nodeDetailFullscreen = false;
      state.nodeRecordPreview = false;
      state.nodeDetailPosition = null;
      shellCloseOverlay({ restoreFocus: false });
      return true;
    default:
      return false;
  }
}

// ------------------------------------------------------------
// Bindings that are not plain [data-action] clicks
// ------------------------------------------------------------

function shellStartNodeTitleEdit(title) {
  if (shellNodeRenameDraft) shellFinishNodeTitleEdit(true);
  const task = state.tasks.find((item) => item.id === title.dataset.taskId);
  const node = task && findNode(task.nodes, title.dataset.nodeId);
  if (!node || !title.isConnected) return;
  if (state.selectedNodeId) { flushNodeNoteDrafts({ persist: true }); exitNodeDetail(); }
  shellNodeRenameDraft = { taskId: task.id, nodeId: node.id, value: node.title };
  title.outerHTML = renderShellNodeTitle(task, node);
  retainedRegionMarkup.delete("workspace");
  shellBindInlineNodeTitles();
  const input = document.querySelector("[data-shell-node-rename]");
  input?.focus({ preventScroll: true });
  input?.select();
}

function shellFinishNodeTitleEdit(commit, { restoreFocus = false } = {}) {
  const draft = shellNodeRenameDraft;
  if (!draft) return;
  const input = document.querySelector("[data-shell-node-rename]");
  const task = state.tasks.find((item) => item.id === draft.taskId);
  const node = task && findNode(task.nodes, draft.nodeId);
  const next = (input?.value ?? draft.value).trim();
  shellNodeRenameDraft = null;
  if (node && commit && next && next !== node.title) {
    node.title = next;
    node.updatedAt = task.updatedAt = now();
    save();
  }
  if (input && node) {
    const row = input.closest(".flow-row");
    input.outerHTML = renderShellNodeTitle(task, node);
    const collapse = row.querySelector(".collapse");
    collapse?.setAttribute("aria-label", `${node.collapsed ? "展开" : "收起"} ${node.title}`);
    row.querySelector(".node-status")?.setAttribute("aria-label", `${node.title}：${shellNodeStatusLabel(node.status)}，选择状态`);
    row.querySelector(".node-add")?.setAttribute("aria-label", `给 ${node.title} 添加子节点`);
    bindTaskRepositoryRows(row);
    if (restoreFocus) row.querySelector(".node-title")?.focus({ preventScroll: true });
  }
  retainedRegionMarkup.delete("workspace");
}

function shellBindInlineNodeTitles() {
  document.querySelectorAll("[data-shell-node-rename]").forEach((input) => {
    if (!bindRenderElement(input, "inline-node-title")) return;
    input.addEventListener("input", () => {
      if (shellNodeRenameDraft?.nodeId === input.dataset.nodeId) shellNodeRenameDraft.value = input.value;
      input.removeAttribute("aria-invalid");
      input.removeAttribute("title");
    });
    input.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (!["Enter", "Escape"].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Enter" && !input.value.trim()) {
        input.setAttribute("aria-invalid", "true");
        input.title = "节点标题不能为空";
        return;
      }
      shellFinishNodeTitleEdit(event.key === "Enter", { restoreFocus: true });
    });
    input.addEventListener("blur", () => {
      if (input.isConnected && shellNodeRenameDraft?.nodeId === input.dataset.nodeId
        && !shellNodeRenameDraft.rendering) shellFinishNodeTitleEdit(true);
    });
  });
}

function shellBindNodeDraft() {
  if (typeof document.addEventListener === "function" && !document.__loopNodeDraftDismissBound) {
    document.__loopNodeDraftDismissBound = true;
    const dismissEmptyDraft = (event) => {
      const input = document.querySelector("[data-shell-node-draft]");
      if (!state.focusNodeTitleId || !input || input.value.trim()
        || event.target.closest?.("[data-shell-node-draft]")) return;
      // Keep the clicked control mounted so its action and focus still work.
      shellCancelNodeDraft({ renderView: false });
    };
    document.addEventListener("click", dismissEmptyDraft, true);
    document.addEventListener("contextmenu", dismissEmptyDraft, true);
  }
  document.querySelectorAll("[data-shell-node-draft]").forEach((input) => {
    const taskId = shellActiveTask()?.id;
    const nodeId = state.focusNodeTitleId;
    input.addEventListener("input", () => {
      const task = shellActiveTask();
      const node = shellNodeList(task).find((item) => item.id === state.focusNodeTitleId);
      if (node) node.title = input.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        event.preventDefault();
        shellCommitNodeDraft();
      } else if (event.key === "Escape") {
        event.preventDefault();
        shellCancelNodeDraft();
      }
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (document.activeElement === input) return;
        if (state.focusNodeTitleId !== nodeId || shellActiveTask()?.id !== taskId) return;
        // Outside clicks cancel blanks in place; blur continues to save titles.
        if (!shellNodeList(shellActiveTask()).find((item) => item.id === nodeId)?.title.trim()) return;
        shellCommitNodeDraft();
      }, 0);
    });
  });
}

function shellCommitNodeDraft() {
  const task = shellActiveTask();
  const node = shellNodeList(task).find((item) => item.id === state.focusNodeTitleId);
  if (node) {
    if (!node.title.trim()) node.title = "新节点";
    node.updatedAt = now();
  }
  task.updatedAt = now();
  state.focusNodeTitleId = "";
  save();
  render();
}

function shellCancelNodeDraft({ renderView = true } = {}) {
  const task = shellActiveTask();
  const nodeId = state.focusNodeTitleId;
  state.focusNodeTitleId = "";
  if (task && nodeId) {
    const { parent, siblings, index } = shellNodeSiblings(task, nodeId);
    if (index >= 0) { siblings.splice(index, 1); reorder(siblings); }
    if (!renderView) {
      const draft = document.querySelector("[data-shell-node-draft]")?.closest(".node-draft");
      const container = draft?.parentElement;
      draft?.remove();
      if (container?.matches(".flow-children") && !container.childElementCount) container.remove();
      if (parent && !parent.children.length) {
        const collapse = document.querySelector(`.collapse[data-node-id="${CSS.escape(parent.id)}"]`);
        if (collapse) { collapse.disabled = true; collapse.classList.add("empty"); }
      }
      const nodes = shellNodeList(task);
      const count = document.querySelector('[data-pane="flow"] .pane-count');
      if (count) count.textContent = String(nodes.length);
      const progress = document.querySelector(".flow-toolbar > span");
      if (progress) progress.textContent = `${shellCountDoneNodes(task)} / ${nodes.length} 已完成`;
      document.querySelector(".flow-tree")?.style.setProperty("--flow-depth", shellFlowDepth(task.nodes || []));
      const next = document.querySelector('[data-action="focus-next-pending"]');
      if (next) next.disabled = !nodes.some((node) => node.status === "todo" || node.status === "blocked");
      // The cached markup still contains the removed draft. A new empty draft
      // can otherwise match it and reuse a workspace with no input remaining.
      retainedRegionMarkup.delete("workspace");
      save();
      return;
    }
  }
  render();
}

function shellBindBriefDrafts() {
  document.querySelectorAll("[data-shell-draft]").forEach((field) => {
    field.addEventListener("input", () => {
      state.shellDrafts[field.dataset.shellDraft] = field.value;
    });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        shellFinishBriefDraft(field.dataset.shellDraft, false);
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        shellFinishBriefDraft(field.dataset.shellDraft, true);
      }
    });
  });
}

function shellBindNodeRecordWindow() {
  const handle = document.querySelector("[data-record-window-handle]");
  if (!handle || !bindRenderElement(handle, "record-window-drag")) return;
  let drag = null;
  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = handle.closest(".node-record-window").getBoundingClientRect();
    drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId) return;
    shellLayoutRecordWindow({ x: event.clientX - drag.dx, y: event.clientY - drag.dy });
  });
  const finish = event => {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", () => { drag = null; });
}

function shellBindNodeRecord() {
  shellBindNodeRecordWindow();
  const editor = document.querySelector("[data-shell-node-record]");
  if (!editor || !bindRenderElement(editor, "shell-node-record")) return;
  // Chromium drops its document-wide native undo stack when a retained region
  // is detached. Keep a bounded edit journal on this reused record control.
  const history = { undo: [], redo: [], type: "", at: 0, after: null };
  const snapshot = () => ({ value: editor.value, start: editor.selectionStart,
    end: editor.selectionEnd, direction: editor.selectionDirection });
  const push = (list, value) => {
    list.push(value);
    let size = list.reduce((sum, item) => sum + item.value.length, 0);
    while (list.length > 1 && (list.length > 40 || size > 1000000)) size -= list.shift().value.length;
  };
  const restore = (redo) => {
    const source = redo ? history.redo : history.undo, target = redo ? history.undo : history.redo;
    const next = source.pop();
    if (!next) return;
    push(target, snapshot());
    editor.value = next.value;
    editor.setSelectionRange(next.start, next.end, next.direction);
    history.at = 0;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };
  editor.addEventListener("beforeinput", (event) => {
    if (["historyUndo", "historyRedo"].includes(event.inputType)) {
      event.preventDefault(); restore(event.inputType === "historyRedo"); return;
    }
    const before = snapshot(), stamp = Date.now();
    const continuous = ["insertText", "insertCompositionText", "deleteContentBackward"].includes(event.inputType)
      && history.type === event.inputType && stamp - history.at < 750
      && history.after?.start === before.start && history.after?.end === before.end;
    if (!continuous) push(history.undo, before);
    history.redo.length = 0; history.type = event.inputType; history.at = stamp;
  });
  editor.addEventListener("input", () => {
    const task = shellActiveTask();
    const node = shellNodeList(task).find((item) => item.id === editor.dataset.shellNodeRecord);
    if (!node) return;
    updateNodeNoteDraft(task.id, node.id, editor.value);
    history.after = snapshot();
  });
  editor.addEventListener("blur", () => {
    history.at = 0;
    history.after = null;
    flushNodeNoteDrafts?.({ persist: true });
  });
  editor.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && !(event.ctrlKey && key === "y")) return;
    event.preventDefault();
    restore(key === "y" || event.shiftKey);
  });
}

const SHELL_OVERLAY_TRIGGERS = [
  "[data-action='open-combined-filter']", "[data-action='open-update-panel']",
  "[data-action='open-flow-locator']", "[data-action='open-node-status']",
  "[data-action='open-node-operations']", "[data-action='open-node-path']",
  "[data-action='open-node-delete']", "[data-action='edit-task-title']",
  "[data-action='edit-node-title']", "[data-action='open-task-menu']",
  ".status-trigger", ".node-status",
].join(",");

function shellOverlayIsOpen() {
  return Boolean(shellOverlay()?.firstElementChild);
}

/** Escape and outside-click dismiss, mirroring loop-popup-dismiss.js. */
function shellBindOverlayDismissal() {
  if (typeof document.addEventListener !== "function") return;
  if (window.__loopShellDismissBound) return;
  window.__loopShellDismissBound = true;
  window.addEventListener("resize", () => {
    document.querySelectorAll("#overlay .surface-popover, #overlay .priority-popover, #overlay .status-menu")
      .forEach(shellClampFloatingSurface);
  });
  let consumeOutsideClick = false;
  document.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Tab" && shellOverlayIsOpen()) {
      const dialog = shellOverlay().querySelector('[role="dialog"][aria-modal="true"]');
      if (dialog) {
        const items = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')]
          .filter(element => element.getClientRects().length && !element.closest('[inert], [hidden]'));
        const target = event.shiftKey ? items.at(-1) : items[0];
        if (!items.length || !dialog.contains(document.activeElement) || document.activeElement === (event.shiftKey ? items[0] : items.at(-1))) {
          event.preventDefault();
          (target || dialog.querySelector('[tabindex="-1"]') || dialog).focus({ preventScroll: true });
        }
        event.stopImmediatePropagation();
      }
      return;
    }
    if (event.key !== "Escape") return;
    if (!shellOverlayIsOpen()) {
      if (!state.taskMenuOpen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      shellCloseTaskMenu({ restoreFocus: true });
      return;
    }
    event.preventDefault();
    // The overlay owns this Escape: stopImmediatePropagation keeps the
    // multi-select shortcuts from also reacting to the same key press.
    event.stopImmediatePropagation();
    if (shellOverlayDismissBlocked()) return;
    shellCloseOverlay();
    state.taskMenuOpen = false;
    state.contextMenu = null;
    render();
  }, true);
  document.addEventListener("pointerdown", (event) => {
    consumeOutsideClick = false;
    // This menu is inline in the workspace, outside #overlay. Remove only its
    // DOM so the clicked input/control can keep focus and handle this pointer.
    if (state.taskMenuOpen && !event.target.closest?.('[data-task-menu], [data-action="open-task-menu"]')) {
      shellCloseTaskMenu();
    }
    if (!shellOverlayIsOpen()) return;
    const overlay = shellOverlay();
    const surface = overlay.querySelector(".dialog") || overlay.firstElementChild;
    if (surface?.contains(event.target)) return;
    // Contextual branches share this overlay but are positioned as siblings
    // to avoid clipping. Clicking a branch is still an inside interaction.
    if (event.target.closest?.("#overlay .wb-submenu")) return;
    if (event.target.closest(SHELL_OVERLAY_TRIGGERS)) return;
    consumeOutsideClick = event.button === 0;
    if (shellOverlayDismissBlocked()) { event.preventDefault(); return; }
    shellCloseOverlay({ restoreFocus: false });
    state.taskMenuOpen = false;
    state.contextMenu = null;
    render();
  }, true);
  document.addEventListener("click", (event) => {
    // The closing pointer click must not activate a control exposed underneath.
    if (!consumeOutsideClick || event.detail === 0) return;
    consumeOutsideClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

/**
 * Drag the task-list column edge (approved new structure).
 * .app carries the inline --list-width, so the drag writes there; the width is
 * clamped and persisted through the project's existing sidebarWidth preference.
 */
function shellBindListResizer() {
  const handle = document.querySelector("[data-action='resize-list-column']");
  if (!handle || handle.dataset.bound === "1") return;
  handle.dataset.bound = "1";
  const pane = handle.closest(".task-list-pane");
  const host = handle.closest(".app");
  const setWidth = (next) => {
    state.sidebarWidth = next;
    host?.style.setProperty("--list-width", `${next}px`);
    handle.setAttribute("aria-valuenow", String(next));
  };
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = pane.getBoundingClientRect().width;
    handle.setPointerCapture?.(event.pointerId);
    const onMove = (move) => setWidth(normalizeSidebarWidth(Math.round(startWidth + (move.clientX - startX))));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      save();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
  handle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    setWidth(normalizeSidebarWidth(state.sidebarWidth + (event.key === "ArrowRight" ? 16 : -16)));
    save();
  });
}

function shellBindOverlay() {
  shellBindOverlayDelegation();
  shellBindOverlayDismissal();
  shellBindNodeDraft();
  shellBindInlineNodeTitles();
  shellBindBriefDrafts();
  shellBindNodeRecord();
}

// ============================================================
// Loop -- task multi-select and batch management
//
// Ported from the frozen Demo's tenth stage
// (prototypes/baseline/loop-plane-phase15-frozen/loop-bulk-phase10.js +
// loop-bulk-phase10.css). Selection state is view-only; every mutation goes
// through the project's own functions so the data model is untouched.
// ============================================================

const shellBulk = { active: false, ids: new Set(), anchor: null, scope: "", undo: null };

function shellBulkScopeKey() {
  return JSON.stringify([
    state.taskFilter, state.todayFilter, state.activeGroupId, state.captureSourceFilter,
    state.priorityFilter, state.taskDeadlineFilter, state.taskDateFilter, state.query,
  ]);
}

function shellBulkSelected() {
  return state.tasks.filter((task) => shellBulk.ids.has(task.id));
}

function shellBulkTaskOnly() {
  return shellBulkSelected().filter((task) => !shellTaskIsNote(task));
}

function shellBulkStop() {
  shellBulk.active = false;
  shellBulk.ids.clear();
  shellBulk.anchor = null;
  shellBulk.undo = null;
  clearWorkspaceFeedback("bulk");
}

/** Drop selections that left the visible scope, and leave multi-select if the scope changed. */
function shellBulkPrune() {
  if (!shellBulk.active) return;
  if (shellBulk.scope !== shellBulkScopeKey()) {
    shellBulkStop();
    return;
  }
  const visible = new Set(filteredTasks().map((task) => task.id));
  shellBulk.ids.forEach((id) => { if (!visible.has(id)) shellBulk.ids.delete(id); });
}

function shellBulkFocus(id) {
  document.querySelector(`[data-bulk-id="${CSS.escape(String(id))}"]`)?.focus({ preventScroll: true });
}

function shellBulkAction(value, label, extra = "") {
  return `<button type="button" class="button" data-bulk-action="${value}" ${extra}>${label}</button>`;
}

function shellBulkReason(task) {
  if (task.status === "done") return "已完成";
  if (shellTaskIsNote(task)) return "";
  const blocker = taskCompletionBlocker(task);
  if (blocker === "CONCLUSION_REQUIRED") return "待补充结论";
  if (blocker === "FLOW_INCOMPLETE") {
    return `还有 ${shellNodeList(task).filter((node) => node.status !== "done").length} 个节点未完成`;
  }
  return "";
}

// ------------------------------------------------------------
// Rendering
// ------------------------------------------------------------

function renderShellBulkRows(list) {
  return `<ol class="task-rows" aria-label="任务列表">${list.map((task) => `
    <li class="task-item bulk-row ${task.id === state.activeTaskId ? "selected " : ""}${shellBulk.ids.has(task.id) ? "bulk-selected " : ""}${task.status === "done" ? "done" : ""}" data-task-row="${escAttr(task.id)}" data-task-id="${escAttr(task.id)}" data-context="task">
      <button type="button" class="bulk-check" role="checkbox" aria-checked="${shellBulk.ids.has(task.id)}" aria-label="选择：${escAttr(task.title)}" data-bulk-id="${escAttr(task.id)}"><span class="bulk-check-box">${shellIcon("check")}</span></button>
      <button class="task-select" type="button" data-task-id="${escAttr(task.id)}" aria-pressed="${task.id === state.activeTaskId}" title="查看：${escAttr(task.title || "未命名任务")}"><span class="task-item-title">${esc(task.title || "未命名任务")}</span></button>
    </li>`).join("")}</ol>`;
}

/** Content appended to the task list footer: the entry button or the batch dock. */
function shellBulkFooter() {
  if (!shellBulk.active) {
    return `<button class="text-button bulk-entry" type="button" data-bulk-action="start" ${filteredTasks().length ? "" : "disabled"}>${shellIcon("tasks")}多选</button>`;
  }
  const visible = filteredTasks();
  const count = shellBulk.ids.size;
  const all = visible.length > 0 && visible.length === count;
  return `<div class="bulk-dock-content">
    <div class="bulk-summary">
      <strong role="status" aria-live="polite">${count ? `已选 ${count} 项` : "选择需要处理的记录"}</strong>
      <button class="text-button" type="button" data-bulk-action="all">${all ? "取消全选" : "全选列表"}</button>
      <button class="icon-button" type="button" data-bulk-action="exit" aria-label="退出多选" title="退出多选（Esc）">${shellIcon("close")}</button>
    </div>
    <div class="bulk-actions">
      ${shellBulkAction("complete", `${shellIcon("check")}完成`, count ? "" : "disabled")}
      ${shellBulkAction("group", `${shellIcon("folder")}分组`, count ? 'aria-haspopup="dialog"' : "disabled")}
      <button class="button bulk-more" type="button" data-bulk-action="more" aria-label="更多批量操作" aria-haspopup="menu" ${count ? "" : "disabled"}>${shellIcon("more")}</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------
// Mutations
// ------------------------------------------------------------

function shellBulkShowResult(message, undo) {
  shellBulk.undo = undo;
  showWorkspaceFeedback(message, '<button class="text-button" type="button" data-bulk-action="undo">撤销</button>', { source: "bulk", onDismiss: () => {
    if (shellBulk.undo === undo) shellBulk.undo = null;
  } });
}

function shellBulkSnapshot(items, fields) {
  const keys = [...fields, "updatedAt", "resolvedAt"];
  return items.map((task) => ({ id: task.id, values: Object.fromEntries(keys.map((key) => [key, structuredClone(task[key])])) }));
}

function shellBulkApply(items, fields, patch, message) {
  if (!items.length) return;
  const snapshots = shellBulkSnapshot(items, fields);
  items.forEach((task) => {
    patch(task);
    task.updatedAt = now();
  });
  shellCloseOverlay({ restoreFocus: false });
  if (!filteredTasks().some((task) => task.id === state.activeTaskId)) state.activeTaskId = "";
  save();
  render();
  shellBulkShowResult(message, () => {
    snapshots.forEach((snapshot) => {
      const task = state.tasks.find((item) => item.id === snapshot.id);
      if (task) Object.assign(task, snapshot.values);
    });
    save();
    render();
  });
}

function shellBulkPopup(trigger, title, body, width = 300) {
  shellMountSurface(
    `<section class="surface-popover bulk-menu" role="menu" aria-label="${escAttr(title)}">${shellSurfaceHeader(title)}${body}</section>`,
    trigger,
    width,
  );
  const surface = document.querySelector(".surface-popover");
  if (surface) surface.dataset.returnFocus = `[data-bulk-action="${trigger.dataset.bulkAction}"]`;
}

function shellBulkTaskHint() {
  const notes = shellBulkSelected().length - shellBulkTaskOnly().length;
  return notes ? `<p class="schedule-hint">仅修改 ${shellBulkTaskOnly().length} 个任务，${notes} 条速记保持不变。</p>` : "";
}

function shellBulkMore(trigger) {
  const count = shellBulkTaskOnly().length;
  const hasActive = shellBulkSelected().some((task) => task.status !== "done");
  const hasDone = shellBulkSelected().some((task) => task.status === "done");
  const role = (enabled) => `role="menuitem" ${enabled ? "" : "disabled"}`;
  shellBulkPopup(trigger, "更多批量操作",
    shellBulkAction("today-add", `${shellIcon("home")}加入今日 <small>${count} 个任务</small>`, role(count))
    + shellBulkAction("today-remove", "移出今日", role(count))
    + '<div class="menu-divider"></div>'
    + shellBulkAction("deadline", `${shellIcon("calendar")}截止时间…`, role(count))
    + shellBulkAction("priority", `${shellIcon("flag")}优先级…`, role(count))
    + shellBulkAction("restore", "恢复未完成", role(hasDone))
    + '<div class="menu-divider"></div>'
    + shellBulkAction("delete", `删除 ${shellBulkSelected().length} 项…`, 'role="menuitem"')
    + (hasActive ? "" : '<p class="schedule-hint">所选记录均已完成。</p>'));
  document.querySelector('[data-bulk-action="delete"]')?.classList.add("danger-action");
}

function shellBulkChoices(trigger, kind) {
  const groups = sort(state.taskGroups).map((group) => ({ value: group.id, label: group.title }));
  groups.push({ value: "", label: "未分组" });
  const options = kind === "group"
    ? groups
    : Object.entries(SHELL_PRIORITY_LABELS).map(([value, label]) => ({ value, label }));
  shellBulkPopup(trigger, kind === "group" ? "移动至分组" : "任务优先级",
    options.map(({ value, label }) => shellBulkAction(`choose-${kind}`, esc(label), `role="menuitem" data-bulk-value="${escAttr(value)}"`)).join("")
    + (kind === "priority" ? shellBulkTaskHint() : "")
    + (kind === "group" ? '<p class="schedule-hint">今日安排、截止时间和处理流保留。</p>' : ""));
  if (kind === "priority") {
    const surface = document.querySelector(".surface-popover");
    if (surface) surface.dataset.returnFocus = '[data-bulk-action="more"]';
  }
}

function shellBulkDeadline(trigger) {
  const today = localDateKey(new Date());
  shellMountSurface(
    `<form class="surface-popover bulk-form" id="bulk-date-form" role="dialog" aria-modal="true" aria-label="批量设置截止时间">${shellSurfaceHeader(`截止时间 · ${shellBulkTaskOnly().length} 个任务`)}
      <div class="bulk-fields">
        <div><label for="bulk-date">日期</label><input id="bulk-date" name="date" type="date" value="${today}" required /></div>
        <div><label for="bulk-time">时间</label><input id="bulk-time" name="time" type="time" value="18:00" required /></div>
      </div>
      <p class="schedule-hint">保留每个任务原有的提醒设置。清除日期时同时清除提醒。</p>
      ${shellBulkTaskHint()}
      <footer><button type="button" class="text-button" data-bulk-action="clear-deadline">清除日期</button><button class="button primary" type="submit">应用</button></footer>
    </form>`,
    trigger,
    300,
  );
  const surface = document.querySelector(".surface-popover");
  if (surface) surface.dataset.returnFocus = '[data-bulk-action="more"]';
  document.querySelector("#bulk-date-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const stamp = safeDate(`${data.get("date")}T${data.get("time") || "18:00"}`);
    const list = shellBulkTaskOnly();
    shellBulkApply(list, ["deadlineAt"], (task) => { task.deadlineAt = stamp ? stamp.toISOString() : ""; }, `已更新 ${list.length} 个任务的截止时间`);
  });
}

function shellBulkReviewComplete() {
  const list = shellBulkSelected();
  const eligible = list.filter((task) => !shellBulkReason(task));
  const blocked = list.filter((task) => shellBulkReason(task));
  shellRenderBulkDialog(
    "complete",
    `完成所选记录`,
    `<p class="bulk-review-count">${eligible.length} 项可以完成${blocked.length ? `，${blocked.length} 项保持原状` : ""}</p>
     <ul class="bulk-review-list">${list.map((task) => {
       const reason = shellBulkReason(task);
       const text = shellTaskIsNote(task) && task.status !== "done" ? "速记可直接完成" : reason || "结论与处理流检查通过";
       return `<li><div><strong>${esc(task.title)}</strong><span>${esc(text)}</span></div>${task.status !== "done" && reason ? shellBulkAction("inspect", "查看", `data-bulk-value="${escAttr(task.id)}"`) : ""}</li>`;
     }).join("")}</ul>
     <footer><button class="button" type="button" data-action="close-dialog">取消</button>${shellBulkAction("confirm-complete", `完成 ${eligible.length} 项`, eligible.length ? "" : "disabled")}</footer>`,
    "complete",
  );
  document.querySelector('[data-bulk-action="confirm-complete"]')?.classList.add("primary");
}

function shellBulkReviewDelete() {
  const list = shellBulkSelected();
  shellRenderBulkDialog(
    "more",
    `删除 ${list.length} 项记录？`,
    `<p>所选记录的处理流、笔记和历史将一并移除。</p>
     <ul class="bulk-review-list">${list.map((task) => `<li><div><strong>${esc(task.title)}</strong><span>${esc(shellTaskIsNote(task) ? "速记" : `${shellTaskIsNote(task) ? "" : shellGroupTitle(task.groupId)} · ${shellNodeList(task).length} 个节点`)}</span></div></li>`).join("")}</ul>
     <footer><button class="button" type="button" data-action="close-dialog" autofocus>取消</button>${shellBulkAction("confirm-delete", `删除 ${list.length} 项`)}</footer>`,
    "more",
  );
  document.querySelector('[data-bulk-action="confirm-delete"]')?.classList.add("danger-action");
  document.querySelector("[autofocus]")?.focus();
}

function shellRenderBulkDialog(returnAction, title, body, focusAction) {
  const overlay = shellOverlay();
  overlay.innerHTML = `<div class="dialog-backdrop" data-return-focus="[data-bulk-action='${returnAction}']"><section class="dialog bulk-review" role="dialog" aria-modal="true" aria-label="${escAttr(title)}">${shellSurfaceHeader(title)}${body}</section></div>`;
  document.querySelector(`.bulk-review [data-action="close-dialog"]`)?.focus();
  void focusAction;
}

// ------------------------------------------------------------
// Dispatcher
// ------------------------------------------------------------

/** Phase26: batch delete goes through the same archive service as a single
 *  delete, using the real selected ids and the same impact dialog. */
async function shellBulkActionRun(action, element, event) {
  const list = shellBulkSelected();
  switch (action) {
    case "start":
      shellCloseOverlay({ restoreFocus: false });
      state.taskMenuOpen = false;
      shellBulk.active = true;
      shellBulk.scope = shellBulkScopeKey();
      render();
      shellBulkFocus(filteredTasks()[0]?.id);
      return true;
    case "exit":
      shellBulkStop();
      render();
      document.querySelector('[data-bulk-action="start"]')?.focus();
      return true;
    case "all": {
      const visible = filteredTasks();
      shellBulk.ids = shellBulk.ids.size === visible.length ? new Set() : new Set(visible.map((task) => task.id));
      render();
      return true;
    }
    case "more":
      shellBulkMore(element);
      return true;
    case "group":
    case "priority":
      shellBulkChoices(element, action);
      return true;
    case "choose-group":
      shellBulkApply(shellBulkTaskOnly(), ["groupId"], (task) => { task.groupId = element.dataset.bulkValue; }, `已将 ${shellBulkTaskOnly().length} 项移至「${element.dataset.bulkValue ? shellGroupTitle(element.dataset.bulkValue) : "未分组"}」`);
      return true;
    case "choose-priority": {
      const tasks = shellBulkTaskOnly();
      shellBulkApply(tasks, ["priority"], (task) => { task.priority = normalizePriority(element.dataset.bulkValue); }, `已更新 ${tasks.length} 个任务的优先级`);
      return true;
    }
    case "today-add":
    case "today-remove": {
      const tasks = shellBulkTaskOnly();
      const add = action === "today-add";
      shellBulkApply(tasks, ["tags"], (task) => {
        task.tags = normalizeTaskTags({ ...normalizeTaskTags(task.tags), today: add });
      }, add ? `已将 ${tasks.length} 个任务加入今日` : `已移除 ${tasks.length} 个任务的手动今日安排`);
      return true;
    }
    case "deadline":
      shellBulkDeadline(element);
      return true;
    case "clear-deadline": {
      const tasks = shellBulkTaskOnly();
      shellBulkApply(tasks, ["deadlineAt", "deadlineReminderMinutes"], (task) => {
        task.deadlineAt = "";
        task.deadlineReminderMinutes = null;
      }, `已清除 ${tasks.length} 个任务的截止时间`);
      return true;
    }
    case "complete":
      shellBulkReviewComplete();
      return true;
    case "confirm-complete": {
      const eligible = list.filter((task) => !shellBulkReason(task));
      shellBulkApply(eligible, ["status", "recurrence"], (task) => {
        const occurrence = recurringOccurrenceKey(task);
        task.status = "done";
        task.resolvedAt = now();
        if (occurrence) task.recurrence = { ...normalizeTaskRecurrence(task.recurrence), lastCompletedOccurrence: occurrence };
      }, `已完成 ${eligible.length} 项${list.length > eligible.length ? "，其余保持原状" : ""}`);
      return true;
    }
    case "restore": {
      const done = list.filter((task) => task.status === "done");
      shellBulkApply(done, ["status", "recurrence"], (task) => {
        const occurrence = recurringOccurrenceKey(task);
        task.status = "active";
        task.resolvedAt = "";
        task.recurrence = normalizeTaskRecurrence(task.recurrence);
        if (occurrence && task.recurrence.lastCompletedOccurrence === occurrence) task.recurrence.lastCompletedOccurrence = "";
      }, `已恢复 ${done.length} 项记录`);
      return true;
    }
    case "inspect": {
      shellCloseOverlay({ restoreFocus: false });
      state.activeTaskId = element.dataset.bulkValue;
      state.taskPane = "flow";
      state.selectedNodeId = "";
      render();
      document.querySelector(`[data-task-id="${CSS.escape(state.activeTaskId)}"]`)?.focus();
      return true;
    }
    case "delete":
      // Phase26: the unified archive confirmation replaces this stage's own
      // delete review; it uses the same real selected ids and the same
      // draft-capture-before-snapshot rule.
      if (typeof recovery26ReviewDeleteBulk === "function") {
        shellCloseOverlay({ restoreFocus: false });
        recovery26ReviewDeleteBulk(list.map((task) => task.id));
        return true;
      }
      shellBulkReviewDelete();
      return true;
    case "confirm-delete": {
      const removed = list.map((task) => ({ record: task, index: state.tasks.indexOf(task) }));
      captureMountedMilkdownDrafts?.();
      flushNodeNoteDrafts?.({ persist: false });
      state.tasks = state.tasks.filter((task) => !shellBulk.ids.has(task.id));
      shellBulk.ids.clear();
      shellCloseOverlay({ restoreFocus: false });
      if (!state.tasks.some((task) => task.id === state.activeTaskId)) state.activeTaskId = "";
      save();
      render();
      shellBulkShowResult(`已删除 ${removed.length} 项记录`, () => {
        removed.sort((a, b) => a.index - b.index).forEach(({ record, index }) => {
          if (!state.tasks.some((task) => task.id === record.id)) {
            state.tasks.splice(Math.min(index, state.tasks.length), 0, record);
          }
        });
      });
      return true;
    }
    case "undo": {
      const undo = shellBulk.undo;
      shellBulk.undo = null;
      clearWorkspaceFeedback("bulk");
      if (undo) undo();
      render();
      return true;
    }
    case "dismiss-result": {
      shellBulk.undo = null;
      clearWorkspaceFeedback("bulk");
      return true;
    }
    default:
      return false;
  }
}

function shellBulkSelect(id, range) {
  const list = filteredTasks().map((task) => task.id);
  const checked = !shellBulk.ids.has(id);
  if (range && list.includes(shellBulk.anchor)) {
    const from = list.indexOf(shellBulk.anchor);
    const to = list.indexOf(id);
    list.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((value) => { if (checked) shellBulk.ids.add(value); else shellBulk.ids.delete(value); });
  } else if (checked) {
    shellBulk.ids.add(id);
  } else {
    shellBulk.ids.delete(id);
  }
  shellBulk.anchor = id;
  render();
  shellBulkFocus(id);
}

function shellBindBulk() {
  if (typeof document.addEventListener !== "function") return;
  if (window.__loopBulkKeysBound) return;
  window.__loopBulkKeysBound = true;
  // One owner for retained rows and newly rendered receipts. The overlay has
  // its own delegate and stops propagation before this listener.
  document.addEventListener("click", async (event) => {
    const element = event.target.closest?.("[data-bulk-action],[data-bulk-id]");
    if (!element || element.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (element.dataset.bulkId) {
      shellBulkSelect(element.dataset.bulkId, event.shiftKey);
      return;
    }
    await shellBulkActionRun(element.dataset.bulkAction, element, event);
  });
  document.addEventListener("keydown", (event) => {
    if (!shellBulk.active || event.isComposing) return;
    if (shellOverlayIsOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      shellBulkStop();
      render();
      document.querySelector('[data-bulk-action="start"]')?.focus();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && event.target.closest?.(".task-rows, .list-foot")) {
      event.preventDefault();
      event.stopPropagation();
      shellBulk.ids = new Set(filteredTasks().map((task) => task.id));
      render();
    }
  }, true);
  document.addEventListener("focusin", (event) => {
    if (event.target.id === "search" && shellBulk.active) {
      shellBulkStop();
      render();
      document.querySelector("#search")?.focus();
    }
  });
}

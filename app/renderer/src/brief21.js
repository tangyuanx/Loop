// ------------------------------------------------------------
// Phase21 · 任务简报直接输入
//
// Ported from the frozen Demo's loop-brief-phase21.js. The Demo keeps edits in
// the page session only; the product writes them into the real task model and
// persists through the existing debounced save(), and turns one changed editing
// session into one history entry (task.history = [[time, text], ...]).
//
// The layer is gated by `body[data-brief21-enabled]`, which index.html sets, so
// the frozen brief21.css applies. Phase20's brief card/toggle steps aside for it.
// ------------------------------------------------------------

const BRIEF21_EXPANDED = new Map();   // taskId -> the user's own choice this session
const BRIEF21_SESSIONS = new Map();   // "taskId:field" -> the value the session started from
let brief21Rendering = false;

/** The one history entry a changed editing session leaves behind. */
const BRIEF21_HISTORY_LIMIT = 60;

function brief21TaskFor(key) {
  return state.tasks.find((task) => task.id === key.split(":")[0]);
}

function brief21FieldMeta(field) {
  return shellBriefFields({ id: "" }).find((entry) => entry.field === field);
}

function brief21IsBriefKey(key) {
  const task = brief21TaskFor(key);
  if (!task) return false;
  const field = key.split(":")[1];
  return shellBriefFields(task).some((entry) => entry.field === field);
}

function brief21Resize(el) {
  const top = el.scrollTop;
  el.style.height = "0px";
  el.style.height = `${Math.max(32, Math.min(160, el.scrollHeight))}px`;
  el.scrollTop = top;
}

function brief21ResizeAll() {
  document.querySelectorAll(".brief21-input").forEach(brief21Resize);
}

/**
 * The brief itself: labelled multi-line inputs whose text is the control, with
 * no card, border or background in any state (the frozen sheet owns the look).
 */
renderShellBrief = function brief21Brief(task) {
  return `<section class="brief" aria-label="任务简报">${shellBriefFields(task).map(({ field, label, placeholder, value }) => `
    <div class="brief-row">
      <label for="brief21-${escAttr(task.id)}-${field}">${label}</label>
      <textarea id="brief21-${escAttr(task.id)}-${field}" class="brief21-input" rows="1" wrap="soft"
        data-brief21-key="${escAttr(`${task.id}:${field}`)}" data-edit-key="${escAttr(`${task.id}:${field}`)}"
        aria-label="${label}" placeholder="${placeholder}">${esc(value)}</textarea>
    </div>`).join("")}</section>`;
};

/** Write the field into the real task (the product's own field semantics). */
function brief21Retain(el) {
  const key = el.dataset.brief21Key;
  const task = brief21TaskFor(key);
  if (!task) return;
  const field = key.split(":")[1];
  if (!BRIEF21_SESSIONS.has(key)) BRIEF21_SESSIONS.set(key, String(task[field] || ""));
  if (String(task[field] || "") !== el.value) {
    task[field] = el.value;
    if (field === "hypothesis") task.hypothesisUpdatedAt = now();
    task.updatedAt = now();
    if (field === "conclusion" && el.value.trim()) clearConclusionNotice?.(task.id);
    save();                     // debounced real persistence
  }
  delete state.shellDrafts[key]; // the explicit-save draft path no longer owns this field
  brief21Resize(el);
}

/** Close the session: one history entry when the value actually changed. */
function brief21Flush(key) {
  if (!BRIEF21_SESSIONS.has(key)) return;
  const before = BRIEF21_SESSIONS.get(key);
  BRIEF21_SESSIONS.delete(key);
  const task = brief21TaskFor(key);
  if (!task) return;
  const field = key.split(":")[1];
  if (before === String(task[field] || "")) return;
  const label = brief21FieldMeta(field)?.label || field;
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.unshift(["刚刚", `更新任务${label}`]);
  if (task.history.length > BRIEF21_HISTORY_LIMIT) task.history.length = BRIEF21_HISTORY_LIMIT;
  save();
}

/**
 * The flow pane's 任务简报 switch: one control for all three fields, whose state
 * is remembered per task for this session. A narrow node drawer shows the
 * read-only line instead, and reading mode hides both (frozen sheet).
 */
function brief21SetupFlowBrief() {
  const brief = document.querySelector(".workspace > .brief");
  document.querySelector(".scale20-brief-toggle")?.remove();
  if (!brief || state.taskPane !== "flow") {
    document.querySelector(".brief21-toggle")?.remove();
    return;
  }
  const drawer = Boolean(document.querySelector(".inspector.flow-drawer"));
  const expanded = !drawer && (BRIEF21_EXPANDED.get(state.activeTaskId) ?? true);
  brief.id = `brief21-task-${state.activeTaskId}`;
  brief.hidden = !expanded;
  let toggle = document.querySelector(".brief21-toggle");
  if (toggle && ((drawer && toggle.tagName !== "SPAN") || (!drawer && toggle.tagName !== "BUTTON"))) {
    toggle.remove();
    toggle = null;
  }
  if (!toggle) {
    toggle = document.createElement(drawer ? "span" : "button");
    toggle.className = "brief21-toggle";
    brief.before(toggle);
  }
  if (drawer) {
    toggle.textContent = "任务简报已收起";
    return;
  }
  toggle.id = "brief21-flow-toggle";
  toggle.type = "button";
  toggle.dataset.brief21Toggle = "";
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-controls", brief.id);
  toggle.title = expanded ? "收起背景、进展、结论" : "展开背景、进展、结论";
  toggle.innerHTML = `${shellIcon(expanded ? "down" : "chevron")}任务简报`;
}

/** 补充结论／查看结果: expand the brief, then put the caret in the field. */
function brief21BeginEdit(key) {
  if (!brief21IsBriefKey(key)) return false;
  let el = document.querySelector(`[data-brief21-key="${CSS.escape(key)}"]`);
  if (!el || el.closest(".brief")?.hidden) {
    BRIEF21_EXPANDED.set(key.split(":")[0], true);
    state.noteSummaryOpen = true;
    state.scale20SummaryOpen = true;
    render();
    el = document.querySelector(`[data-brief21-key="${CSS.escape(key)}"]`);
  }
  el?.focus({ preventScroll: true });
  el?.scrollIntoView({ block: "nearest" });
  return true;
}

const brief21PriorRender = render;
render = function brief21Render() {
  // A re-render must not disturb the caret while someone is typing.
  const active = document.activeElement;
  const editing = Boolean(active?.matches?.(".brief21-input"));
  const cursor = editing
    ? { key: active.dataset.brief21Key, start: active.selectionStart, end: active.selectionEnd,
        direction: active.selectionDirection, top: active.scrollTop, briefTop: active.closest(".brief")?.scrollTop ?? 0 }
    : null;
  if (editing) brief21Retain(active);
  const continuing = cursor?.key.split(":")[0] === state.activeTaskId && state.taskPane !== "notes"
    && !state.settingsOpen && !state.calendarOpen && !state.reviewOpen ? cursor?.key : null;
  [...BRIEF21_SESSIONS.keys()].filter(key => key !== continuing).forEach(brief21Flush);
  brief21Rendering = true;
  try { brief21PriorRender(); } finally { brief21Rendering = false; }
  brief21SetupFlowBrief();
  brief21ResizeAll();
  if (cursor) {
    const el = document.querySelector(`[data-brief21-key="${CSS.escape(cursor.key)}"]`);
    if (el && el.getClientRects().length && state.activeTaskId === cursor.key.split(":")[0]) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(cursor.start, cursor.end, cursor.direction);
      el.scrollTop = cursor.top;
      const brief = el.closest(".brief");
      if (brief) brief.scrollTop = cursor.briefTop;
    }
  }
};

window.addEventListener("focusin", (event) => {
  const el = event.target;
  if (!el.matches?.(".brief21-input")) return;
  const key = el.dataset.brief21Key;
  if (!BRIEF21_SESSIONS.has(key)) BRIEF21_SESSIONS.set(key, String(brief21TaskFor(key)?.[key.split(":")[1]] || ""));
});

// The explicit-save draft listeners belong to the old editors, so this input
// keeps them out of its way.
window.addEventListener("input", (event) => {
  const el = event.target;
  if (!el.matches?.(".brief21-input")) return;
  brief21Retain(el);
  event.stopImmediatePropagation();
}, true);

window.addEventListener("focusout", (event) => {
  const el = event.target;
  if (!el.matches?.(".brief21-input")) return;
  if (brief21Rendering) return;
  brief21Retain(el);
  brief21Flush(el.dataset.brief21Key);
});

window.addEventListener("keydown", (event) => {
  const el = event.target;
  if (!el.matches?.(".brief21-input")) return;
  if (event.isComposing || event.keyCode === 229) {
    event.stopImmediatePropagation();   // never let a commit shortcut cut composition
    return;
  }
  if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key === "Enter")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    brief21Retain(el);
    brief21Flush(el.dataset.brief21Key);
    el.blur();
  }
}, true);

window.addEventListener("click", (event) => {
  const toggle = event.target.closest?.("button[data-brief21-toggle]");
  if (!toggle) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  BRIEF21_EXPANDED.set(state.activeTaskId, toggle.getAttribute("aria-expanded") !== "true");
  render();
  document.querySelector("#brief21-flow-toggle")?.focus({ preventScroll: true });
}, true);

window.addEventListener("resize", () => {
  brief21SetupFlowBrief();
  brief21ResizeAll();
});

document.fonts?.ready.then(brief21ResizeAll);

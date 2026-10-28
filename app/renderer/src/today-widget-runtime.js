// ============================================================
// Loop -- Today widget renderer.
//
// The markup, class names, icons, geometry and interaction states below are
// ported from the frozen Demo baseline
// (prototypes/demos/loop-widget-phase13.js + loop-shell-refinement.js);
// only the data source and the side effects are wired to the desktop app
// (window.personalTaskTrack.todayWidget). Production lifecycle and accessibility
// continue here; the frozen Demo remains a historical reference.
// ============================================================
(() => {
  const bridge = window.personalTaskTrack?.todayWidget;
  if (!bridge) return;

  document.body.classList.add("widget-runtime");

  // ---------- icons: `paths` copied verbatim from the frozen Demo ----------
  const paths = {
    circle: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    blocked: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M8 12h8",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    more: "M12 5h.01M12 12h.01M12 19h.01",
    close: "m6 6 12 12M6 18 18 6",
    note: "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5",
    minus: "M5 12h14",
    // from the frozen Demo's final path map: four corners outward = expand
    expandRecord: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
    plus: "M12 5v14M5 12h14",
    down: "m5 9 7 7 7-7",
    up: "m5 15 7-7 7 7",
    edit: "m15 4 5 5M4 20l4-1L21 6l-4-4L4 15z",
    folder: "M3 7h7l2 2h9v11H3zM3 7V4h7l2 3",
    chevron: "m9 5 7 7-7 7",
    today: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8",
    settings: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.circle}"/></svg>`;
  const gripIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 3h.01M5 8h.01M5 13h.01M10 3h.01M10 8h.01M10 13h.01" stroke-linecap="round"/></svg>';

  const host = document.querySelector("#widget-host");
  const toastHost = document.querySelector("#toast");
  const root = document.documentElement;

  let prefs = {
    position: "top-right", compact: false, opacity: 100, alwaysOnTop: true,
    clickThrough: false, launchWithApp: true, autoHeight: true, height: 0, customBounds: null,
  };
  let snapshot = { date: "", activeTaskId: "", completedToday: 0, appearance: {}, items: [], quickCaptures: [], groups: [] };
  let lane = "task";
  let editId = "";
  let editDraft = "";
  let feedback = "";
  let feedbackType = "";
  let gesture = null;
  let suppressClickUntil = 0;
  let scrollFrame = 0;
  const scrollByType = { task: 0, quick: 0 };
  let surfaceKind = "";
  let queuedSnapshot = null;
  let completingTaskId = "";
  let toastTimer = 0;
  let fitFrame = 0;
  let draftSaveTimer = 0;
  let lastPublishedDraft = "";
  let editingReleaseTimer = 0;
  let pointerHeld = false;
  let pendingBlurRender = false;
  let recentTitleClick = null;
  let editTimer = 0;
  let switchingToEdit = false;
  let submitting = false;
  let renaming = false;
  let composing = false;
  let pendingRenameDraft = null;
  let restoringCapture = null;
  const DRAFT_KEY = "loop-widget-input-drafts";
  function readDrafts() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") || {}; } catch { return {}; }
  }
  function cacheDrafts(patch) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...readDrafts(), ...patch })); } catch { /* Native preferences still carry the capture draft. */ }
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message, persistent = false) {
    window.clearTimeout(toastTimer);
    toastHost.innerHTML = `<div class="toast">${esc(message)}</div>`;
    if (!persistent) toastTimer = window.setTimeout(() => { toastHost.innerHTML = ""; }, 2500);
  }

  // ---------- data projections (the Demo's listItems/state) ----------
  function isQuickLane() { return lane === "quick"; }
  function laneTaskItems() { return snapshot.items; }
  function laneQuickItems() { return snapshot.quickCaptures.filter((item) => item.status !== "done"); }
  function listItems() { return isQuickLane() ? laneQuickItems() : laneTaskItems(); }
  function laneCounts() { return [laneTaskItems().length, laneQuickItems().length]; }
  function findItem(id) {
    return snapshot.items.find((item) => String(item.taskId) === String(id))
      || snapshot.quickCaptures.find((item) => String(item.taskId) === String(id))
      || null;
  }
  function findQuickItem(id) {
    return snapshot.quickCaptures.find((item) => String(item.taskId) === String(id)) || null;
  }
  function formatDate(key) {
    const parts = String(key || "").split("-");
    if (parts.length !== 3) return "";
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!Number.isFinite(month) || !Number.isFinite(day)) return "";
    return `${month} 月 ${day} 日`;
  }

  // ---------- markup (ported 1:1 from loop-widget-phase13.js) ----------
  function titleButton(t) {
    return '<button class="widget-title" data-widget12="edit" data-widget-id="' + esc(t.taskId) + '" title="单击改名 · 双击打开主窗口" aria-label="编辑' + (isQuickLane() ? "速记" : "任务") + "：" + esc(t.title) + '"><strong>' + esc(t.title) + "</strong></button>";
  }

  // One lane is rendered at a time, so the lane decides whether a record is a
  // quick note (the Demo asks the task itself; the snapshot is already split).
  function row(t) {
    const quick = isQuickLane();
    const next = quick ? t.description : t.nextText;
    // snapshot.items[].kind is "blocked" | "high" | "normal" (app.js todayFocusItems)
    const blocked = !quick && t.kind === "blocked";
    return '<li class="widget-row ' + (String(t.taskId) === String(snapshot.activeTaskId) ? "current" : "") + '" data-widget-row="' + esc(t.taskId) + '">'
      + '<button class="widget13-grip" data-widget-drag="' + esc(t.taskId) + '" aria-label="调整顺序：' + esc(t.title) + '" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="拖动排序 · Alt+↑ / ↓">' + gripIcon + "</button>"
      + '<button class="widget-check ' + (quick ? "quick-check" : "") + '" data-complete-task="' + esc(t.taskId) + '" aria-label="完成' + (quick ? "速记" : "任务") + "：" + esc(t.title) + '" title="完成' + (quick ? "速记" : "任务") + '">'
      + (quick ? '<span class="note-icon">' + icon("note") + '</span><span class="completion-icon">' + icon("circle") + "</span>" : icon("circle"))
      + "</button>"
      + '<div class="widget-row-copy">'
      + (String(editId) === String(t.taskId)
        ? '<input class="widget-title-input" id="widget-title-input" data-widget-id="' + esc(t.taskId) + '" aria-label="修改记录标题" maxlength="240" value="' + esc(editDraft) + '">'
        : titleButton(t))
      + (next ? "<small>" + (blocked ? icon("blocked") : "") + "<span>" + esc(next) + "</span></small>" : "")
      + "</div>"
      + '<button class="widget-open" data-widget-open="' + esc(t.taskId) + '" aria-label="在主窗口打开：' + esc(t.title) + '" title="在主窗口打开">' + icon("arrow") + "</button>"
      + '<button class="widget13-more" data-widget12="row-menu" data-widget-id="' + esc(t.taskId) + '" aria-haspopup="menu" aria-label="记录操作：' + esc(t.title) + '" title="更多操作">' + icon("more") + "</button>"
      + "</li>";
  }

  function renderTodayWidget() {
    if (!bridge) return "";
    const items = listItems();
    const counts = laneCounts();
    const header = '<header class="widget-header" tabindex="0" aria-label="移动浮窗" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight" title="拖动移动 · 聚焦后方向键微调">'
      + '<img class="widget-logo" src="./src/assets/loop-icon.png" alt="Loop" draggable="false"><strong>今日</strong>'
      + (prefs.compact
        ? '<span class="widget-count">' + counts[0] + " 项</span>"
        : '<span class="widget-date">' + esc(formatDate(snapshot.date)) + "</span>")
      + '<button class="icon-button" data-action="compact-widget" aria-label="' + (prefs.compact ? "展开浮窗" : "收起浮窗") + '">' + icon(prefs.compact ? "expandRecord" : "minus") + "</button>"
      + '<button class="icon-button" data-action="widget-preferences" aria-label="浮窗设置" aria-haspopup="dialog" aria-expanded="' + String(surfaceKind === "settings") + '">' + icon("settings") + "</button>"
      + '<button class="icon-button" data-action="toggle-widget" aria-label="关闭今日浮窗">' + icon("close") + "</button></header>";
    const tabs = '<nav class="widget-tabs" aria-label="浮窗记录类型">'
      + [["task", "今日任务", counts[0]], ["quick", "速记", counts[1]]].map(([value, label, count]) =>
        '<button data-widget-type="' + value + '" class="' + (lane === value ? "active" : "") + '" aria-pressed="' + (lane === value) + '">' + label + "<small>" + count + "</small></button>").join("")
      + "</nav>";
    const body = '<div class="widget-body"><ol class="widget-rows">' + items.map(row).join("") + "</ol>"
      + (!items.length
        ? '<p class="widget-empty">' + (lane === "task" && snapshot.completedToday ? "今日任务已完成" : "暂无" + (lane === "task" ? "今日任务" : "速记")) + "</p>"
        : "")
      + "</div>";
    const capture = '<section class="widget-compose" aria-label="添加速记"><div class="widget-capture">'
      + '<textarea id="widget-capture" rows="1" maxlength="4000" aria-label="快速记录内容" title="Enter 保存速记；Shift+Enter 换行；Command / Ctrl+Enter 加入今日" placeholder="记一条速记…">' + esc(captureDraft()) + "</textarea>"
      + '<button data-widget12="submit" aria-label="保存速记" title="保存速记" ' + (captureDraft().trim() ? "" : "disabled") + ">" + icon("arrow") + "</button>"
      + '</div><div class="widget-compose-foot">'
      + '<span id="widget-feedback" class="widget-input-status ' + feedbackType + '" role="status" aria-live="polite">' + esc(feedback || "Enter 保存 · Shift+Enter 换行") + "</span>"
      + '<span class="widget-shortcut" title="Command / Ctrl+Enter 保存并加入今日">' + (/Mac/.test(navigator.platform) ? "⌘" : "Ctrl") + " ↵ 今日</span>"
      + "</div></section>";
    const resize = (edge) => '<div class="widget13-resize ' + edge + '" data-widget-resize="' + edge + '" role="separator" tabindex="0" aria-orientation="horizontal" aria-valuemin="180" aria-valuemax="720" aria-label="从' + (edge === "top" ? "顶部" : "底部") + '调整浮窗高度" title="拖动调整高度 · ↑ / ↓ 微调"></div>';
    return '<aside class="today-widget widget12 widget13 ' + (prefs.compact ? "compact" : "") + '" data-widget-lane="' + lane + '" data-position="' + esc(prefs.position) + '" aria-label="今日任务浮窗">'
      + header
      + (prefs.compact ? "" : tabs + body + (lane === "quick" ? capture : "") + resize("top") + resize("bottom"))
      + "</aside>"
      + (surfaceKind === "delete" ? '<div class="dialog-backdrop" data-surface-barrier></div>' : "");
  }

  // ---------- draft ----------
  function captureDraft() { return snapshot.captureDraft || ""; }
  function applyCaptureDraft(value) {
    const next = String(value || "");
    const input = host.querySelector("#widget-capture");
    if (!input) { snapshot.captureDraft = next; cacheDrafts({ capture: next }); return; }
    const current = input.value;
    if (next === current) { snapshot.captureDraft = next; return; }
    // The main process echoes the last published draft on every state broadcast
    // (dragging, resizing, opacity ...). Those echoes must never replace newer
    // text the user is still typing.
    if (next === lastPublishedDraft) { snapshot.captureDraft = current; return; }
    if (current !== lastPublishedDraft) { snapshot.captureDraft = current; return; }
    input.value = next;
    snapshot.captureDraft = next;
    cacheDrafts({ capture: next });
    resizeCapture();
  }
  function publishCaptureDraft(value) {
    lastPublishedDraft = String(value || "");
    cacheDrafts({ capture: lastPublishedDraft });
    void bridge.setPreferences({ quickCaptureDraft: lastPublishedDraft });
  }
  function persistCaptureDraft() {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(flushCaptureDraft, 260);
  }
  function flushCaptureDraft() {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = 0;
    const input = host.querySelector("#widget-capture");
    publishCaptureDraft((input ? input.value : snapshot.captureDraft).slice(0, 4000));
  }

  // The window's content box is the panel plus the ring that carries its shadow.
  // Report region changes so the ring stays click-through: hovering the widget's
  // edge must not be swallowed by this window.
  let ringInside = true;
  function trackRing(event) {
    if (gesture || pointerHeld) return;
    const panel = host.querySelector(".today-widget");
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (inside === ringInside) return;
    ringInside = inside;
    void bridge.setRingRegion?.({ inside });
  }

  function setTextEditing(enabled) {
    window.clearTimeout(editingReleaseTimer);
    editingReleaseTimer = 0;
    if (enabled) { void bridge.setEditing?.(true); return; }
    // Native IME candidate panels can transiently affect window focus while the
    // DOM input remains active; only restore topmost after focus really left.
    editingReleaseTimer = window.setTimeout(() => {
      editingReleaseTimer = 0;
      const active = document.activeElement;
      if (active && (active.id === "widget-capture" || active.id === "widget-title-input")) return;
      void bridge.setEditing?.(false);
    }, 320);
  }

  function resizeCapture() {
    const input = host.querySelector("#widget-capture");
    if (!input) return;
    input.style.height = "42px";
    input.style.height = Math.min(82, Math.max(42, input.scrollHeight)) + "px";
  }

  // ---------- appearance + window framing ----------
  function applyAppearance() {
    const appearance = snapshot.appearance && typeof snapshot.appearance === "object" ? snapshot.appearance : {};
    root.dataset.theme = appearance.theme === "dark" ? "dark" : "light";
    root.dataset.zhFont = appearance.zhFont || "heiti";
    root.dataset.enFont = appearance.enFont || "times";
    root.style.setProperty("--sans", appearance.sans || '"TaskTrack English Times","TaskTrack Chinese Heiti",-apple-system,BlinkMacSystemFont,sans-serif');
    root.style.setProperty("--font-scale", String(appearance.fontScale || "1"));
    root.style.setProperty("--widget-opacity", String(Math.max(70, Math.min(100, Number(prefs.opacity) || 100)) / 100));
    const panel = host.querySelector(".today-widget");
    if (panel) {
      panel.classList.toggle("widget13-sized", !prefs.compact && !prefs.autoHeight);
      panel.style.height = !prefs.compact && !prefs.autoHeight ? prefs.height + "px" : "";
    }
  }

  // The window is sized to the panel plus the ring that carries the Demo's
  // shadow, so the renderer is the single source of truth for the content box.
  function fit() {
    if (fitFrame) return;
    fitFrame = window.requestAnimationFrame(() => {
      fitFrame = 0;
      const panel = host.querySelector(".today-widget");
      if (!panel) return;
      // The window width follows the mode (expanded 360 / compact 254); only the
      // content height is measured, because the panel is width:100% of the window.
      void bridge.fit?.({ height: Math.round(panel.offsetHeight) });
    });
  }

  function applyWindowState(value) {
    const next = value && typeof value === "object" ? value : {};
    const position = ["top-left", "top-right", "bottom-left", "bottom-right", "custom"].includes(next.position) ? next.position : "top-right";
    prefs = {
      position,
      compact: next.compact === true,
      opacity: Number.isFinite(Number(next.opacity)) ? Number(next.opacity) : 100,
      alwaysOnTop: next.alwaysOnTop !== false,
      clickThrough: next.clickThrough === true,
      launchWithApp: next.launchWithApp !== false,
      autoHeight: next.autoHeight !== false,
      height: Number.isFinite(Number(next.height)) ? Number(next.height) : 0,
      customBounds: next.customBounds || null,
    };
  }

  // ---------- render ----------
  function render() {
    const active = document.activeElement;
    const action = active?.dataset?.widget12;
    const inputId = active?.id;
    const selection = inputId === "widget-capture" || inputId === "widget-title-input" ? [active.selectionStart, active.selectionEnd] : null;
    const oldWidget = host.querySelector(".widget13");
    if (oldWidget) scrollByType[oldWidget.dataset.widgetLane === "quick" ? "quick" : "task"] = oldWidget.querySelector(".widget-body")?.scrollTop || 0;
    if (inputId === "widget-capture") {
      // Keep the in-memory draft in step with what is on screen. Persistence is
      // owned by the composer's own debounced handler: publishing here would
      // make every state echo rebuild the composer (and break an IME session).
      snapshot.captureDraft = active.value;
    }
    if (editId && host.querySelector("#widget-title-input")) editDraft = host.querySelector("#widget-title-input").value;
    if (editId && !findItem(editId)) editId = "";
    pendingBlurRender = false;
    // Keep the live composer attached. A main-window snapshot must not break
    // IME, native undo, selection, or a draft even while this window is blurred.
    const currentWidget = host.querySelector(".today-widget");
    const composer = currentWidget?.querySelector(".widget-compose");
    if (composer && lane === "quick" && !prefs.compact) {
      const template = document.createElement("template");
      template.innerHTML = renderTodayWidget();
      const nextWidget = template.content.querySelector(".today-widget");
      currentWidget.className = nextWidget.className;
      currentWidget.dataset.position = prefs.position;
      for (const selector of [".widget-header", ".widget-tabs", ".widget-body"]) {
        currentWidget.querySelector(selector)?.replaceWith(nextWidget.querySelector(selector));
      }
      host.querySelector("[data-surface-barrier]")?.remove();
      const barrier = template.content.querySelector("[data-surface-barrier]");
      if (barrier) host.append(barrier);
      syncSubmitState();
      const status = host.querySelector("#widget-feedback");
      if (status) { status.textContent = feedback || "Enter 保存 · Shift+Enter 换行"; status.className = "widget-input-status " + feedbackType; }
    } else host.innerHTML = renderTodayWidget();
    applyAppearance();
    resizeCapture();
    syncSubmitState();
    fit();
    const focus = inputId === "widget-capture" || inputId === "widget-title-input"
      ? host.querySelector("#" + inputId)
      : action ? host.querySelector('[data-widget12="' + action + '"]') : null;
    if (focus && !focus.disabled && !surfaceKind && document.hasFocus() && document.activeElement !== focus) {
      focus.focus({ preventScroll: true });
      if (selection && focus.setSelectionRange) focus.setSelectionRange(selection[0], selection[1]);
    }
    const body = host.querySelector(".widget-body");
    if (body) body.scrollTop = scrollByType[lane === "quick" ? "quick" : "task"];
  }

  // ---------- inline rename ----------
  async function finishRename(save = true, draw = true) {
    const input = host.querySelector("#widget-title-input");
    if (!editId || renaming || composing) return;
    const id = editId;
    const item = findItem(id);
    const title = String((input ? input.value : editDraft) || "").trim();
    if (save && !title) { showToast("标题不能为空，请修改后重试", true); input?.focus(); return; }
    if (save && item && title !== item.title) {
      renaming = true;
      if (input) input.readOnly = true;
      let result;
      try { result = await bridge.updateTaskTitle({ taskId: String(id), title }); }
      catch { result = { success: false }; }
      renaming = false;
      if (!result?.success) {
        if (input) input.readOnly = false;
        showToast("标题保存失败，修改仍在，可重试", true);
        input?.focus({ preventScroll: true });
        return;
      }
      showToast("已同步修改");
    }
    editId = "";
    cacheDrafts({ rename: null });
    if (queuedSnapshot) { const next = queuedSnapshot; queuedSnapshot = null; applySnapshot(next); }
    if (draw) {
      render();
      host.querySelector('[data-widget12="edit"][data-widget-id="' + CSS.escape(String(id)) + '"]')?.focus({ preventScroll: true });
    }
  }

  async function edit(item) {
    if (!item) return;
    switchingToEdit = true;
    try {
      await finishRename(true, false);
      if (editId || renaming) return;
      editId = item.taskId;
      editDraft = item.title;
      render();
      const input = host.querySelector("#widget-title-input");
      input?.focus({ preventScroll: true });
      input?.select();
    } finally {
      switchingToEdit = false;
    }
  }

  function openRecord(id) {
    finishRename(true, false);
    void bridge.openMain(String(id));
  }

  async function submit(forceToday = false) {
    if (!bridge || prefs.compact || !isQuickLane() || submitting || composing) return;
    const input = host.querySelector("#widget-capture");
    const text = input ? input.value : captureDraft();
    const lines = String(text).replaceAll("\r", "").split("\n");
    const title = String(lines.shift() || "").trim();
    if (!title || title.length > 240) {
      feedback = !title ? "请输入第一行标题" : "标题最多 240 字，可将详情放在下一行";
      feedbackType = "error";
      render();
      host.querySelector("#widget-capture")?.focus({ preventScroll: true });
      return;
    }
    const description = lines.join("\n").trim();
    finishRename(true, false);
    submitting = true;
    feedback = "正在保存…"; feedbackType = "";
    syncSubmitState();
    host.querySelector("#widget-capture")?.setAttribute("readonly", "");
    const status = host.querySelector("#widget-feedback");
    if (status) status.textContent = feedback;
    let result;
    try { result = await bridge.createTask({ title, description, addToToday: forceToday === true }); }
    catch { result = { success: false }; }
    submitting = false;
    host.querySelector("#widget-capture")?.removeAttribute("readonly");
    if (!result?.success) {
      feedback = result?.code === "INVALID_TITLE" ? "请输入第一行标题" : "速记保存失败，请稍后重试";
      feedbackType = "error";
      render();
      return;
    }
    snapshot.captureDraft = "";
    publishCaptureDraft("");
    const cleared = host.querySelector("#widget-capture");
    if (cleared) cleared.value = "";
    feedback = forceToday ? "已加入今日任务" : "已保存到速记";
    feedbackType = "saved";
    render();
    host.querySelector("#widget-capture")?.focus({ preventScroll: true });
  }

  // ---------- ordering / transfer ----------
  async function moveItem(id, targetLane, anchor = null, position = "after") {
    const item = findItem(id);
    if (!item) return false;
    const sourceLane = isQuickLane() ? lane : (laneQuickItems().some((entry) => String(entry.taskId) === String(id)) ? "quick" : "task");
    const result = await bridge.moveItem({
      taskId: String(id),
      sourceLane,
      targetLane,
      targetTaskId: anchor ? String(anchor) : "",
      position,
    });
    if (!result?.success && result?.code !== "BOUNDARY") {
      showToast("顺序调整失败，请稍后重试");
      return false;
    }
    return true;
  }

  async function stepItem(id, delta) {
    const items = listItems();
    const index = items.findIndex((item) => String(item.taskId) === String(id));
    if (index < 0) return;
    if (!items[index + delta]) { showToast(delta < 0 ? "已经是第一项" : "已经是最后一项"); return; }
    const result = await bridge.reorderItem({ taskId: String(id), lane: isQuickLane() ? "quick" : "task", direction: delta });
    if (!result?.success) { showToast("顺序调整失败，请稍后重试"); return; }
    render();
    host.querySelector('[data-widget-drag="' + CSS.escape(String(id)) + '"]')?.focus({ preventScroll: true });
    showToast("顺序已同步");
  }

  async function transfer(id, targetLane) {
    finishRename(true, false);
    if (!await moveItem(id, targetLane)) return;
    suppressClickUntil = 0;
    render();
    showToast(targetLane === "task" ? "已加入今日任务，原内容保留" : "已移到速记，原内容保留");
  }

  // ---------- surfaces (settings / row menu / promote / delete) ----------
  function anchorOf(element) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  }
  function panelRect() {
    const panel = host.querySelector(".today-widget");
    if (!panel) return null;
    const rect = panel.getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  }
  function openSurface(kind, taskId, trigger) {
    void bridge.openSurface({
      kind,
      taskId: taskId ? String(taskId) : "",
      anchor: anchorOf(trigger),
      panel: panelRect(),
    });
  }

  // ---------- gestures (ported from loop-widget-phase13.js) ----------
  function frameLimits() { return { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 }; }

  function clearDrop() {
    host.querySelectorAll(".widget13-drop-before,.widget13-drop-after,.widget13-tab-drop").forEach((el) => el.classList.remove("widget13-drop-before", "widget13-drop-after", "widget13-tab-drop"));
  }

  function dropTarget(x, y) {
    const hit = document.elementFromPoint(x, y);
    const tab = hit?.closest("[data-widget-type]");
    if (tab) return { lane: tab.dataset.widgetType, id: null, position: "after", el: tab };
    const rowEl = hit?.closest("[data-widget-row]");
    if (rowEl) {
      if (String(rowEl.dataset.widgetRow) === String(gesture.id)) return null;
      const rect = rowEl.getBoundingClientRect();
      return { lane: gesture.lane, id: rowEl.dataset.widgetRow, position: y < rect.top + rect.height / 2 ? "before" : "after", el: rowEl };
    }
    const body = hit?.closest(".widget-body");
    return body ? { lane: gesture.lane, id: null, position: "after", el: null } : null;
  }

  function updateDrop() {
    clearDrop();
    gesture.drop = dropTarget(gesture.x, gesture.y);
    const drop = gesture.drop;
    if (drop?.el) drop.el.classList.add(drop.el.hasAttribute("data-widget-type") ? "widget13-tab-drop" : drop.position === "before" ? "widget13-drop-before" : "widget13-drop-after");
  }

  function autoScroll() {
    if (!gesture || gesture.kind !== "row" || !gesture.moved) return;
    const body = host.querySelector(".widget-body");
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const inside = gesture.x >= rect.left && gesture.x <= rect.right && gesture.y >= rect.top - 20 && gesture.y <= rect.bottom + 20;
    if (inside) {
      const direction = gesture.y < rect.top + 24 ? -1 : gesture.y > rect.bottom - 24 ? 1 : 0;
      if (direction) { body.scrollTop += direction * 7; updateDrop(); }
    }
    scrollFrame = window.requestAnimationFrame(autoScroll);
  }

  function endGesture(cancel = false) {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    window.cancelAnimationFrame(scrollFrame);
    clearDrop();
    host.querySelector(".widget13")?.classList.remove("widget13-moving", "widget13-resizing", "widget13-sorting");
    host.querySelector('[data-widget-row="' + CSS.escape(String(g.id)) + '"]')?.classList.remove("widget13-drag-source");
    document.body.classList.remove("widget13-gesture");
    if (g.el?.hasPointerCapture?.(g.pointerId)) g.el.releasePointerCapture(g.pointerId);
    if (g.moved) suppressClickUntil = performance.now() + 400;
    if (!cancel && g.kind === "row" && g.moved && g.drop) {
      void moveItem(g.id, g.drop.lane, g.drop.id, g.drop.position).then((ok) => {
        if (!ok) return;
        render();
        showToast(g.drop.lane === g.lane ? "顺序已同步" : g.drop.lane === "task" ? "已加入今日任务，原内容保留" : "已移到速记，原内容保留");
      });
    }
  }

  function updateResize(edge, delta, start) {
    const limits = frameLimits();
    const bottom = start.top + start.height;
    const maxHeight = Math.min(720, edge === "top" ? bottom - limits.top : limits.bottom - start.top);
    const height = Math.max(180, Math.min(maxHeight, start.height + (edge === "top" ? -delta : delta)));
    sendResize(height, edge);
  }

  let resizeFrame = 0;
  let pendingResizeHeight = 0;
  function sendResize(height, edge) {
    pendingResizeHeight = height;
    if (resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      void bridge.resize({ height: pendingResizeHeight, edge });
    });
  }

  // ---------- capture submit button state ----------
  function syncSubmitState() {
    const input = host.querySelector("#widget-capture");
    const button = host.querySelector('[data-widget12="submit"]');
    if (button && input) button.disabled = submitting || !input.value.trim();
    if (input) input.readOnly = submitting;
    host.querySelector(".widget-capture")?.setAttribute("aria-busy", String(submitting));
  }

  // ---------- events ----------
  window.addEventListener("pointerdown", (event) => {
    pointerHeld = true;
    if (event.button !== 0) return;
    // Menus are non-modal: the same pointer gesture dismisses the native panel
    // and operates the chosen widget control. Only deletion keeps a barrier.
    if (surfaceKind) {
      if (surfaceKind === "delete") {
        event.preventDefault();
        event.stopImmediatePropagation();
        void bridge.closeSurface({ reason: "outside" });
        return;
      }
      void bridge.closeSurface({ reason: "outside" });
    }
    const handle = event.target.closest("[data-widget-drag]");
    const resize = event.target.closest("[data-widget-resize]");
    const header = event.target.closest(".widget-header");
    if (!handle && !resize && (!header || event.target.closest("button,input,textarea"))) return;
    finishRename(true, false);
    const widget = host.querySelector(".widget13");
    if (!widget) return;
    const rect = widget.getBoundingClientRect();
    const el = handle || resize || header;
    gesture = {
      kind: handle ? "row" : resize ? "resize" : "move",
      id: handle ? handle.dataset.widgetDrag : null,
      lane: isQuickLane() ? "quick" : "task",
      edge: resize?.dataset.widgetResize,
      el,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      start: { left: rect.left, top: rect.top, height: rect.height },
      moved: false,
      drop: null,
    };
    el.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, true);

  window.addEventListener("mousemove", trackRing, true);
  // Failsafe: a focused window must always be interactive, even if the pointer
  // is still reported as being on the shadow ring.
  window.addEventListener("focus", () => {
    if (ringInside) return;
    ringInside = true;
    void bridge.setRingRegion?.({ inside: true });
  });

  window.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const g = gesture;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < 6) return;
    if (g.kind === "move") return; // native window drag owns this gesture
    event.preventDefault();
    g.x = event.clientX;
    g.y = event.clientY;
    if (!g.moved) {
      g.moved = true;
      document.body.classList.add("widget13-gesture");
      const widget = host.querySelector(".widget13");
      widget?.classList.add(g.kind === "row" ? "widget13-sorting" : "widget13-resizing");
      if (g.kind === "row") {
        host.querySelector('[data-widget-row="' + CSS.escape(String(g.id)) + '"]')?.classList.add("widget13-drag-source");
        autoScroll();
      }
    }
    if (g.kind === "row") updateDrop();
    else updateResize(g.edge, dy, g.start);
  }, true);

  window.addEventListener("pointerup", (event) => {
    pointerHeld = false;
    if (pendingBlurRender) window.setTimeout(() => { if (pendingBlurRender) render(); }, 0);
    if (gesture?.pointerId === event.pointerId) endGesture();
  }, true);

  window.addEventListener("pointercancel", () => { pointerHeld = false; endGesture(true); });
  window.addEventListener("blur", () => { endGesture(true); flushCaptureDraft(); });
  window.addEventListener("beforeunload", () => {
    flushCaptureDraft();
    if (editId) cacheDrafts({ rename: { id: editId, value: host.querySelector("#widget-title-input")?.value || editDraft, lane } });
  });
  document.addEventListener("compositionstart", () => { composing = true; });
  document.addEventListener("compositionend", () => { composing = false; });
  window.addEventListener("resize", () => { endGesture(true); applyAppearance(); fit(); });

  window.addEventListener("contextmenu", (event) => {
    const rowEl = event.target.closest(".widget13 [data-widget-row]");
    if (!rowEl || event.target.closest("input,textarea")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    endGesture(true);
    const trigger = rowEl.querySelector('[data-widget12="row-menu"]');
    openSurface("row-menu", rowEl.dataset.widgetRow, trigger || rowEl);
  }, true);

  function cancelPendingEdit() { window.clearTimeout(editTimer); recentTitleClick = null; }

  window.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil && event.target.closest(".widget13")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const titleTarget = event.target.closest('[data-widget12="edit"],#widget-title-input');
    if (event.detail > 0 && titleTarget && recentTitleClick?.id === String(titleTarget.dataset.widgetId) && performance.now() - recentTitleClick.time <= 500) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const id = recentTitleClick.id;
      cancelPendingEdit();
      openRecord(id);
      return;
    }
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.widgetOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openRecord(button.dataset.widgetOpen);
      return;
    }
    // The lane tabs carry data-widget-type only (no action), so they are handled
    // before the action lookup, exactly like the Demo's click handler.
    if (button.dataset.widgetType) {
      cancelPendingEdit();
      finishRename(true, false);
      const next = button.dataset.widgetType === "quick" ? "quick" : "task";
      if (next !== lane) { lane = next; render(); }
      return;
    }
    const action = button.dataset.action || button.dataset.widget12;
    if (!action) return;
    if (button.dataset.action === "compact-widget" || button.dataset.action === "toggle-widget") {
      cancelPendingEdit();
      finishRename(true, false);
    }
    if (button.dataset.action === "compact-widget") {
      void bridge.setPreferences({ compact: !prefs.compact });
      return;
    }
    if (button.dataset.action === "toggle-widget") { void bridge.hide(); return; }
    if (button.dataset.action === "widget-preferences") {
      event.preventDefault();
      event.stopImmediatePropagation();
      openSurface("settings", "", button);
      return;
    }
    if (action === "row-menu") {
      event.preventDefault();
      event.stopImmediatePropagation();
      openSurface("row-menu", button.dataset.widgetId, button);
      return;
    }
    if (action === "submit") { event.preventDefault(); event.stopImmediatePropagation(); void submit(false); return; }
    if (action === "edit") {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelPendingEdit();
      const id = button.dataset.widgetId;
      if (event.detail === 0) edit(findItem(id));
      else {
        recentTitleClick = { id: String(id), time: performance.now() };
        editTimer = window.setTimeout(() => {
          if (recentTitleClick?.id === String(id) && host.querySelector('[data-widget12="edit"][data-widget-id="' + CSS.escape(String(id)) + '"]')) edit(findItem(id));
        }, 230);
      }
      return;
    }
    if (action === "complete") { event.preventDefault(); event.stopImmediatePropagation(); void completeTask(button.dataset.completeTask); return; }
    if (action === "open-record") { event.preventDefault(); event.stopImmediatePropagation(); openRecord(button.dataset.widgetId); return; }
    if (action === "rename-record") { event.preventDefault(); event.stopImmediatePropagation(); edit(findItem(button.dataset.widgetId)); return; }
    if (action === "move-up" || action === "move-down") { event.preventDefault(); event.stopImmediatePropagation(); void stepItem(button.dataset.widgetId, action === "move-up" ? -1 : 1); return; }
    if (action === "to-today" || action === "to-quick") { event.preventDefault(); event.stopImmediatePropagation(); void transfer(button.dataset.widgetId, action === "to-today" ? "task" : "quick"); return; }
    if (action === "promote") { event.preventDefault(); event.stopImmediatePropagation(); openSurface("promote", button.dataset.widgetId, button); return; }
    if (action === "delete-quick") { event.preventDefault(); event.stopImmediatePropagation(); openSurface("delete", button.dataset.widgetId, button); return; }
    if (action === "promote-group") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const item = findQuickItem(button.dataset.widgetId);
      if (!item) return;
      void bridge.promoteQuickCapture({ taskId: String(button.dataset.widgetId), groupId: String(button.dataset.groupValue || "") }).then((result) => {
        if (result?.success) { void bridge.closeSurface({ reason: "action" }); showToast("已升级为任务"); }
        else showToast("升级失败，请稍后重试");
      });
      return;
    }
    if (action === "confirm-delete") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void bridge.deleteQuickCapture({ taskId: String(button.dataset.widgetId) }).then((result) => {
        if (result?.code === "DELETE_CANCELLED") return;
        if (result?.success) { void bridge.closeSurface({ reason: "action" }); showToast("速记已删除"); }
        else showToast("速记删除失败，请稍后重试");
      });
      return;
    }
    if (action === "place") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void bridge.setPreferences({ position: button.dataset.value });
      return;
    }
    if (action === "hide") { event.preventDefault(); event.stopImmediatePropagation(); void bridge.hide(); return; }
    if (action === "reset-frame") { event.preventDefault(); event.stopImmediatePropagation(); void bridge.setPreferences({ position: "bottom-right", resetFrame: true }); return; }
  }, true);

  window.addEventListener("dblclick", (event) => {
    const button = event.target.closest('[data-widget12="edit"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelPendingEdit();
    openRecord(button.dataset.widgetId);
  }, true);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && gesture) { event.preventDefault(); event.stopImmediatePropagation(); endGesture(true); return; }
    if (event.key === "Escape" && surfaceKind) { void bridge.closeSurface({ reason: "escape" }); return; }
    const handle = event.target.closest("[data-widget-drag]");
    const resize = event.target.closest("[data-widget-resize]");
    if (handle && event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void stepItem(handle.dataset.widgetDrag, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && event.target.closest(".widget13 [data-widget-row]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const rowEl = event.target.closest("[data-widget-row]");
      openSurface("row-menu", rowEl.dataset.widgetRow, rowEl.querySelector('[data-widget12="row-menu"]') || rowEl);
      return;
    }
    if (resize && ["ArrowUp", "ArrowDown", "Home"].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const edge = resize.dataset.widgetResize;
      const widget = host.querySelector(".widget13");
      const rect = widget.getBoundingClientRect();
      if (event.key === "Home") void bridge.resize({ height: 0, edge, reset: true });
      else updateResize(edge, (event.key === "ArrowUp" ? -1 : 1) * (event.shiftKey ? 40 : 10), { top: rect.top, height: rect.height });
      host.querySelector('[data-widget-resize="' + edge + '"]')?.focus({ preventScroll: true });
      return;
    }
    if (event.target.matches(".widget13 .widget-header") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const step = event.shiftKey ? 40 : 10;
      void bridge.nudge({
        dx: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
        dy: event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
      });
      return;
    }
    if (event.target.id === "widget-capture") {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void submit(event.metaKey || event.ctrlKey);
      }
    } else if (event.target.id === "widget-title-input") {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        finishRename(event.key === "Enter");
      }
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target.id === "widget-capture") {
      snapshot.captureDraft = event.target.value;
      cacheDrafts({ capture: event.target.value });
      feedback = "";
      feedbackType = "";
      resizeCapture();
      persistCaptureDraft();
      syncSubmitState();
      const status = host.querySelector("#widget-feedback");
      if (status) { status.textContent = "Enter 保存 · Shift+Enter 换行"; status.className = "widget-input-status"; }
      fit();
    }
    if (event.target.id === "widget-title-input") {
      editDraft = event.target.value;
      cacheDrafts({ rename: { id: editId, value: editDraft, lane } });
    }
  });

  document.addEventListener("focusout", async (event) => {
    if (event.target.id !== "widget-title-input" || !editId) return;
    if (!document.hasFocus() || composing || renaming) return;
    await finishRename(true, false);
    if (editId) return;
    if (pointerHeld) pendingBlurRender = true;
    else render();
  });

  window.addEventListener("focusin", (event) => {
    if (!switchingToEdit && !event.target.closest('[data-widget12="edit"],#widget-title-input')) cancelPendingEdit();
  });

  window.addEventListener("pointerdown", (event) => {
    if (!event.target.closest('[data-widget12="edit"],#widget-title-input')) cancelPendingEdit();
  }, true);

  host.addEventListener("focusin", () => setTextEditing(document.activeElement?.id === "widget-capture" || document.activeElement?.id === "widget-title-input"));

  async function completeTask(taskId) {
    if (completingTaskId) return;
    const item = findItem(taskId);
    if (!item) return;
    completingTaskId = String(taskId);
    const rowEl = host.querySelector('[data-widget-row="' + CSS.escape(String(taskId)) + '"]');
    rowEl?.classList.add("is-completing");
    const result = await bridge.completeTask(String(taskId));
    completingTaskId = "";
    if (result?.success) {
      showToast(`已完成「${item.title}」· 将同步到主窗口`);
      return;
    }
    rowEl?.classList.remove("is-completing");
    if (result?.code === "CONCLUSION_REQUIRED") showToast("请先补充结论，已在主窗口打开该任务");
    else if (result?.code === "FLOW_INCOMPLETE") showToast("请先完成全部处理流节点，已在主窗口打开该任务");
    else showToast("任务状态未更新，请稍后重试");
    if (queuedSnapshot) { snapshot = queuedSnapshot; queuedSnapshot = null; }
    render();
  }

  document.addEventListener("click", (event) => {
    const check = event.target.closest("[data-complete-task]");
    if (!check) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void completeTask(check.dataset.completeTask);
  }, true);

  // ---------- bridge wiring ----------
  function applySnapshot(value) {
    const next = value && typeof value === "object" ? value : {};
    const draft = Object.prototype.hasOwnProperty.call(next, "captureDraft") ? next.captureDraft : snapshot.captureDraft;
    snapshot = {
      date: String(next.date || ""),
      activeTaskId: String(next.activeTaskId || ""),
      completedToday: Number(next.completedToday) || 0,
      appearance: next.appearance && typeof next.appearance === "object" ? next.appearance : {},
      items: Array.isArray(next.items) ? next.items : [],
      quickCaptures: Array.isArray(next.quickCaptures) ? next.quickCaptures : [],
      groups: Array.isArray(next.groups) ? next.groups : [],
      captureDraft: String(draft == null ? "" : draft),
    };
    applyAppearance();
    applyCaptureDraft(snapshot.captureDraft);
    // The widget can boot before the main renderer publishes its first rows.
    // Restore the name once its real record arrives, rather than discarding it
    // against the transient empty startup snapshot.
    if (pendingRenameDraft && findItem(pendingRenameDraft.id)) {
      editId = String(pendingRenameDraft.id);
      editDraft = String(pendingRenameDraft.value || "").slice(0, 240);
      lane = pendingRenameDraft.lane === "quick" ? "quick" : "task";
      pendingRenameDraft = null;
    }
    render();
  }

  bridge.onSnapshot?.((value) => {
    if (completingTaskId || editId) {
      queuedSnapshot = value;
      if (value?.appearance) { snapshot.appearance = value.appearance; applyAppearance(); }
      return;
    }
    applySnapshot(value);
  });

  function visualSignature() {
    return [prefs.compact].join("|");
  }

  bridge.onState?.((value) => {
    const before = visualSignature();
    applyWindowState(value);
    if (value && Object.prototype.hasOwnProperty.call(value, "quickCaptureDraft")) {
      const draft = String(value.quickCaptureDraft || "");
      if (restoringCapture === null || draft === restoringCapture) {
        restoringCapture = null;
        applyCaptureDraft(draft);
      }
    }
    // A state broadcast also carries echoes of what this window just published
    // (draft, size, position). Only a real appearance change may rebuild the
    // DOM: rebuilding while the user types would drop the caret and break IME.
    if (before !== visualSignature() || !host.querySelector(".today-widget")) render();
    else { applyAppearance(); fit(); }
  });

  bridge.onSurface?.((value) => {
    const kind = value && value.open === true ? String(value.kind || "") : "";
    if (kind === surfaceKind) return;
    surfaceKind = kind;
    // A delayed close notification may arrive after the next rename began.
    // Updating the surface state must not detach or blur that newer editor.
    host.querySelector('[data-action="widget-preferences"]')?.setAttribute("aria-expanded", String(kind === "settings"));
    host.querySelector("[data-surface-barrier]")?.remove();
    if (kind === "delete") host.insertAdjacentHTML("beforeend", '<div class="dialog-backdrop" data-surface-barrier></div>');
    if (!kind && value?.returnFocus && !editId && document.hasFocus()) {
      const selector = String(value.returnFocus || "");
      const target = selector ? host.querySelector(selector) : null;
      target?.focus({ preventScroll: true });
    }
  });

  bridge.onToast?.((value) => {
    const message = value && typeof value.message === "string" ? value.message : "";
    if (message) showToast(message);
  });

  bridge.onBeginRename?.((value) => {
    const taskId = value?.taskId;
    if (!taskId) return;
    const item = findItem(taskId);
    if (item) edit(item);
  });

  bridge.onFocusReturn?.((value) => {
    if (editId) return;
    const selector = String(value?.selector || "");
    const target = selector ? host.querySelector(selector) : null;
    (target || host.querySelector(".widget13"))?.focus?.({ preventScroll: true });
  });

  // ---------- boot ----------
  void bridge.getState().then((state) => {
    applyWindowState(state);
    if (state && Object.prototype.hasOwnProperty.call(state, "quickCaptureDraft")) snapshot.captureDraft = String(state.quickCaptureDraft || "");
    const initial = state?.snapshot && typeof state.snapshot === "object" ? state.snapshot : {};
    lane = state?.snapshot?.lane === "quick" ? "quick" : "task";
    const drafts = readDrafts();
    if (typeof drafts.capture === "string") {
      snapshot.captureDraft = drafts.capture.slice(0, 4000);
      if (snapshot.captureDraft !== String(state?.quickCaptureDraft || "")) {
        restoringCapture = snapshot.captureDraft;
        publishCaptureDraft(snapshot.captureDraft);
      }
    }
    pendingRenameDraft = drafts.rename || null;
    applySnapshot(initial);
  });
})();

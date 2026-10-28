// ============================================================
// Loop -- popover surface renderer (widget settings / row menu / promote /
// delete confirmation).
//
// Markup is ported 1:1 from the frozen Demo baseline:
//   settings   prototypes/demos/loop-widget-phase13.js showWidgetPreferences()
//   row menu   prototypes/demos/loop-widget-phase13.js showRowMenu()
//   promote    prototypes/demos/loop-widget-phase13.js showPromote()
//   delete     prototypes/demos/loop-widget-phase13.js showDeleteQuick()
// Only the data source and the side effects are wired to the app.
// ============================================================
(() => {
  const bridge = window.personalTaskTrack?.widgetSurface;
  if (!bridge) return;

  const paths = {
    circle: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    close: "m6 6 12 12M6 18 18 6",
    note: "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5",
    down: "m5 9 7 7 7-7",
    up: "m5 15 7-7 7 7",
    edit: "m15 4 5 5M4 20l4-1L21 6l-4-4L4 15z",
    folder: "M3 7h7l2 2h9v11H3zM3 7V4h7l2 3",
    chevron: "m9 5 7 7-7 7",
    today: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8",
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.circle}"/></svg>`;
  const host = document.querySelector("#surface-host");
  const root = document.documentElement;

  let payload = null;
  let fitFrame = 0;
  let ringInside = true;
  let busy = false;
  let message = "";
  let renderedKind = "";
  let settingsLayout = "";

  function esc(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function closeButton() {
    return '<button type="button" class="icon-button" data-action="close-dialog" aria-label="关闭">' + icon("close") + "</button>";
  }

  function settingsMarkup() {
    const settings = payload.settings || {};
    const placements = [["top-left", "左上"], ["top-right", "右上"], ["bottom-left", "左下"], ["bottom-right", "右下"]];
    const toggle = (key, label, checked) => '<label class="widget12-setting-row" for="widget12-' + key + '"><span>' + label + '</span><input id="widget12-' + key + '" type="checkbox" data-widget12-preference="' + key + '" ' + (checked ? "checked" : "") + "></label>";
    return '<section class="surface-popover widget12-settings" role="dialog" aria-label="浮窗设置">'
      + '<header class="dialog-head"><h2>浮窗设置</h2>' + closeButton() + "</header>"
      + '<div class="widget12-settings-body">'
      + '<p class="widget12-settings-label">窗口位置' + (settings.position === "custom" ? '<span class="widget13-custom">自定义</span>' : "") + "</p>"
      + '<div class="widget12-positions" role="group" aria-label="窗口位置">'
      + placements.map(([value, label]) => '<button data-widget12="place" data-value="' + value + '" aria-label="' + label + '角" aria-pressed="' + String(settings.position === value) + '">' + label + "</button>").join("")
      + "</div>"
      + toggle("widgetPinned", "始终置顶", settings.alwaysOnTop !== false)
      + toggle("widgetThrough", "鼠标穿透", settings.clickThrough === true)
      + (settings.clickThrough === true ? '<p class="widget12-settings-hint">点击会穿透浮窗，操作后面的窗口。</p>' : "")
      + '<p class="widget12-settings-hint">⌘ / Ctrl + Shift + T 恢复浮窗操作</p>'
      + toggle("widgetLaunch", "随应用启动", settings.launchWithApp !== false)
      + '<label class="widget12-setting-row" for="widget12-opacity"><span>窗口透明度</span><output id="widget12-opacity-value" for="widget12-opacity">' + Math.round(Number(settings.opacity) || 100) + "%</output></label>"
      + '<input id="widget12-opacity" class="widget12-opacity" type="range" min="70" max="100" step="1" value="' + Math.round(Number(settings.opacity) || 100) + '" aria-label="窗口透明度">'
      + (settings.customFrame ? '<button class="text-button widget13-reset" type="button" data-widget12="reset-frame">恢复默认尺寸与位置</button>' : "")
      + '<button class="text-button widget12-hide" type="button" data-widget12="hide">隐藏今日窗口</button>'
      + "</div></section>";
  }

  function rowMenuMarkup() {
    const task = payload.task || {};
    const menu = (action, text, glyph, disabled, hint) => '<button role="menuitem" data-widget12="' + action + '" data-widget-id="' + esc(task.id) + '" ' + (disabled ? "disabled" : "") + ">" + icon(glyph) + "<span>" + text + "</span>" + (hint ? "<small>" + hint + "</small>" : "") + "</button>";
    const rule = '<div class="widget13-menu-rule" role="separator"></div>';
    return '<div class="surface-popover widget13-menu" role="menu" aria-label="' + (task.isQuick ? "速记操作" : "今日任务操作") + '">'
      + menu("open-record", "在主窗口打开", "arrow")
      + menu("rename-record", "重命名", "edit")
      + rule
      + menu("move-up", "上移", "up", Number(task.index) <= 0, "Alt ↑")
      + menu("move-down", "下移", "down", Number(task.index) >= Number(task.count) - 1, "Alt ↓")
      + rule
      + (task.isQuick
        ? menu("to-today", "加入今日任务", "today") + menu("promote", "升级为任务…", "folder") + rule + menu("delete-quick", "删除速记…", "close")
        : menu("to-quick", "移到速记", "note"))
      + "</div>";
  }

  function promoteMarkup() {
    const task = payload.task || {};
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    return '<section class="surface-popover widget13-promote" role="dialog" aria-label="升级速记为任务">'
      + '<header class="dialog-head"><h2>升级为任务</h2>' + closeButton() + "</header>"
      + '<p class="widget13-menu-caption">归入分组</p>'
      + '<div role="menu" aria-label="选择任务分组">'
      + groups.map((group) => '<button role="menuitem" data-widget12="promote-group" data-widget-id="' + esc(task.id) + '" data-group-value="' + esc(group.id) + '">' + icon("folder") + "<span>" + esc(group.title) + "</span>" + icon("chevron") + "</button>").join("")
      + "</div>"
      + (!groups.length ? '<p class="widget13-menu-caption">请先在主窗口创建分组</p>' : "")
      + "</section>";
  }

  function deleteMarkup() {
    const task = payload.task || {};
    return '<section class="dialog" role="dialog" aria-modal="true" aria-label="删除速记确认">'
      + '<header class="dialog-head"><h2>删除速记？</h2>' + closeButton() + "</header>"
      + '<p class="widget13-delete-title">' + esc(task.title) + "</p>"
      + '<p class="schedule-hint">速记将移到最近删除，可在主窗口恢复。磁盘中的笔记文件保留。</p>'
      + '<footer><button class="button" type="button" data-action="close-dialog" autofocus>取消</button>'
      + '<button class="button danger-action" type="button" data-widget12="confirm-delete" data-widget-id="' + esc(task.id) + '">删除速记</button></footer>'
      + "</section>";
  }

  function markup() {
    if (!payload) return "";
    if (payload.kind === "settings") return settingsMarkup();
    if (payload.kind === "row-menu") return rowMenuMarkup();
    if (payload.kind === "promote") return promoteMarkup();
    if (payload.kind === "delete") return deleteMarkup();
    return "";
  }

  function applyAppearance() {
    const appearance = payload?.appearance && typeof payload.appearance === "object" ? payload.appearance : {};
    root.dataset.theme = appearance.theme === "dark" ? "dark" : "light";
    root.dataset.zhFont = appearance.zhFont || "heiti";
    root.dataset.enFont = appearance.enFont || "times";
    root.style.setProperty("--sans", appearance.sans || '"TaskTrack English Times","TaskTrack Chinese Heiti",-apple-system,BlinkMacSystemFont,sans-serif');
    root.style.setProperty("--font-scale", String(appearance.fontScale || "1"));
  }

  function fit() {
    if (fitFrame) return;
    fitFrame = window.requestAnimationFrame(() => {
      fitFrame = 0;
      const surface = host.firstElementChild;
      if (!surface) return;
      void bridge.fit({ width: Math.ceil(surface.offsetWidth), height: Math.ceil(surface.offsetHeight) });
    });
  }

  // mountSurface() gives each surface a fixed inline width (286 / 224 / 244).
  const SURFACE_WIDTHS = { settings: 286, "row-menu": 224, promote: 244 };

  function render() {
    applyAppearance();
    if (busy) return;
    // Settings broadcasts can arrive for every range step. Keep the actual
    // slider and focused checkbox attached instead of interrupting the gesture.
    const layout = payload?.kind === "settings" ? [payload.settings?.clickThrough, payload.settings?.customFrame, payload.settings?.position === "custom"].join("|") : "";
    if (payload?.kind === "settings" && renderedKind === "settings" && settingsLayout === layout && host.querySelector(".widget12-settings")) {
      const settings = payload.settings || {};
      for (const [key, value] of Object.entries({ widgetPinned: settings.alwaysOnTop !== false, widgetThrough: settings.clickThrough === true, widgetLaunch: settings.launchWithApp !== false })) {
        const input = host.querySelector('[data-widget12-preference="' + key + '"]');
        if (input) input.checked = value;
      }
      host.querySelectorAll('[data-widget12="place"]').forEach(button => button.setAttribute("aria-pressed", String(button.dataset.value === settings.position)));
      const range = host.querySelector("#widget12-opacity");
      if (range && document.activeElement !== range) range.value = settings.opacity;
      const output = host.querySelector("#widget12-opacity-value");
      if (output) output.textContent = (range?.value || settings.opacity) + "%";
      fit();
      return;
    }
    const active = document.activeElement;
    const identity = renderedKind === payload?.kind ? { id: active?.id, action: active?.dataset.widget12, group: active?.dataset.groupValue } : null;
    host.innerHTML = markup();
    renderedKind = payload?.kind || "";
    settingsLayout = layout;
    const surface = host.firstElementChild;
    if (surface) surface.insertAdjacentHTML("beforeend", '<p class="widget-surface-feedback" role="status" aria-live="polite"></p>');
    const width = payload ? SURFACE_WIDTHS[payload.kind] : 0;
    if (surface && width) surface.style.width = width + "px";
    fit();
    const restored = identity?.id ? document.getElementById(identity.id) : identity?.action
      ? [...host.querySelectorAll("button")].find(button => button.dataset.widget12 === identity.action && button.dataset.groupValue === identity.group) : null;
    const focus = restored || host.querySelector("[autofocus]") || host.querySelector("button:not(:disabled), input, select");
    focus?.focus({ preventScroll: true });
  }

  function setBusy(value) {
    busy = value;
    const surface = host.firstElementChild;
    surface?.setAttribute("aria-busy", String(value));
    host.querySelectorAll("button, input, select").forEach(control => {
      if (value) { control.dataset.wasDisabled = String(control.disabled); control.disabled = true; }
      else { control.disabled = control.dataset.wasDisabled === "true"; delete control.dataset.wasDisabled; }
    });
    const feedback = host.querySelector(".widget-surface-feedback");
    if (feedback) feedback.textContent = value ? "正在保存，请稍候…" : message;
    fit();
  }

  async function act(value) {
    if (busy) return;
    const submittedPayload = payload;
    const mutation = ["move-up", "move-down", "to-today", "to-quick", "promote-group", "confirm-delete"].includes(value.action);
    if (mutation) { message = ""; setBusy(true); }
    let result;
    try { result = await bridge.act(value); }
    catch { result = { success: false }; }
    if (mutation) {
      if (!result?.success) message = result?.code === "TASK_NOT_FOUND" ? "这条记录已变更，请关闭后重新打开。" : "未能保存，请重试；原内容仍保留。";
      setBusy(false);
      if (payload !== submittedPayload) render();
    }
  }

  host.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    if (button.dataset.action === "close-dialog") { void bridge.close({ reason: "close" }); return; }
    const action = button.dataset.widget12;
    if (!action) return;
    const taskId = button.dataset.widgetId || "";
    if (action === "place") { void bridge.act({ action: "place", value: button.dataset.value }); return; }
    if (action === "hide") { void bridge.act({ action: "hide" }); return; }
    if (action === "reset-frame") { void bridge.act({ action: "reset-frame" }); return; }
    void act({ action, taskId, groupId: button.dataset.groupValue || "" });
  });

  host.addEventListener("change", (event) => {
    const key = event.target.dataset.widget12Preference;
    if (!key) return;
    void bridge.act({ action: "preference", key, value: event.target.checked === true });
    event.target.focus({ preventScroll: true });
  });

  host.addEventListener("input", (event) => {
    if (event.target.id !== "widget12-opacity") return;
    const value = Math.max(70, Math.min(100, Number(event.target.value) || 100));
    const output = host.querySelector("#widget12-opacity-value");
    if (output) output.textContent = value + "%";
    void bridge.act({ action: "opacity", value });
  });

  // Keep the transparent shadow ring click-through so it cannot swallow hover or
  // clicks meant for the widget (or the app) behind the panel.
  window.addEventListener("mousemove", (event) => {
    const surface = host.firstElementChild;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (inside === ringInside) return;
    ringInside = inside;
    void bridge.setRingRegion?.({ inside });
  }, true);

  window.addEventListener("focus", () => {
    if (ringInside) return;
    ringInside = true;
    void bridge.setRingRegion?.({ inside: true });
  });

  window.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); if (!busy) void bridge.close({ reason: "escape" }); return; }
    const controls = [...host.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(control => control.getClientRects().length);
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement);
    if (event.key === "Tab") {
      if (index < 0 || (!event.shiftKey && index === controls.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0].focus();
      }
    } else if (payload?.kind === "row-menu" && ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
      controls[next].focus();
    }
  });

  // Native blur (including the opening grace period and in-flight writes) is
  // owned by the main controller. A second renderer close races chained panels.

  bridge.onPayload?.((value) => {
    payload = value && typeof value === "object" ? value : null;
    render();
  });

  void bridge.getPayload().then((value) => {
    payload = value && typeof value === "object" ? value : null;
    render();
  });
})();

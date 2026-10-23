const { contextBridge, ipcRenderer } = require("electron");

const WORK_RHYTHM_PASSWORD = "20000911";

function verifyWorkRhythmPassword(value) {
  return String(value || "") === WORK_RHYTHM_PASSWORD;
}

contextBridge.exposeInMainWorld("personalTaskTrack", {
  platform: process.platform,
  appVersion: ipcRenderer.sendSync("app:version"),
  environment: ipcRenderer.sendSync("app:environment"),
  storage: {
    read: () => ipcRenderer.invoke("task-data:read"),
    write: (data) => ipcRenderer.invoke("task-data:write", data),
  },
  dataBackup: {
    export: () => ipcRenderer.invoke("data-backup:export"),
    importFile: () => ipcRenderer.invoke("data-backup:import", { selectionType: "file" }),
    importDirectory: () => ipcRenderer.invoke("data-backup:import", { selectionType: "directory" }),
  },
  knowledgeRecovery: {
    read: () => ipcRenderer.invoke("knowledge-recovery:read"),
    write: (record) => ipcRenderer.invoke("knowledge-recovery:write", record),
    delete: (noteId) => ipcRenderer.invoke("knowledge-recovery:delete", noteId),
    onFlushAndQuit: (callback) => subscribe("knowledge-recovery:flush-and-quit", callback),
    completeFlushAndQuit: () => ipcRenderer.send("knowledge-recovery:flush-complete"),
  },
  knowledgeFile: {
    save: (payload) => ipcRenderer.invoke("knowledge-document:save", payload),
    stageAssets: (payload) => ipcRenderer.invoke("knowledge-document:stage-assets", payload),
    read: (payload) => ipcRenderer.invoke("knowledge-document:read", payload),
    choose: (payload) => ipcRenderer.invoke("knowledge-document:choose", payload),
    watch: (payload) => ipcRenderer.invoke("knowledge-document:watch", payload),
    unwatch: (payload) => ipcRenderer.invoke("knowledge-document:unwatch", payload),
    updateBaseline: (payload) => ipcRenderer.invoke("knowledge-document:update-baseline", payload),
    onChange: (callback) => subscribe("knowledge-file:changed", callback),
  },
  clipboard: {
    readImageDataUrl: () => ipcRenderer.invoke("clipboard:read-image-data-url"),
    readImageDataUrlSync: () => ipcRenderer.sendSync("clipboard:read-image-data-url-sync"),
  },
  export: {
    nodeDetailPdf: (payload) => ipcRenderer.invoke("node-detail:export-pdf", payload),
    // documentKind="note": frozen, enhanced static body from the renderer;
    // main owns the offline template/fonts and validates resources before PDF.
    // Shared document export: optional documentKind="note" and md/html/pdf
    // format select an unbound copy; no knowledge-file save/rebind is invoked.
    taskDocument: (payload) => ipcRenderer.invoke("task:export-document", payload),
  },
  bugReports: {
    submit: (payload) => ipcRenderer.invoke("bug-report:submit", payload),
  },
  dialogs: {
    confirmDestructive: (options) => ipcRenderer.invoke("app:confirm-destructive", options),
  },
  window: {
    // Phase19: a minimized window has to come back before an in-app readiness
    // panel can be read.
    revealMain: () => ipcRenderer.invoke("app:reveal-main"),
  },
  // Phase25 integrated title bar. The window controls stay native (macOS traffic
  // lights / Windows-Linux controls overlay), so this bridge only reports real
  // window state and paints the overlay with the app's own theme colours.
  windowControls: {
    getState: () => ipcRenderer.invoke("window-controls:get-state"),
    setChromeColors: (colors) => ipcRenderer.invoke("window-controls:set-chrome-colors", colors),
    onState: (callback) => subscribe("window-controls:state", callback),
  },
  deadlineReminders: {
    sync: (tasks) => ipcRenderer.invoke("deadline-reminders:sync", tasks),
    getState: () => ipcRenderer.invoke("deadline-reminders:get-state"),
    // Phase19: the only path that asks for a scan, and the live state feed.
    check: () => ipcRenderer.invoke("deadline-reminders:check"),
    onState: (callback) => subscribe("deadline-reminders:state", callback),
    onOpenTask: (callback) => subscribe("deadline-reminders:open-task", callback),
    onOpenCalendar: (callback) => subscribe("deadline-reminders:open-calendar", callback),
  },
  workRhythm: {
    verifyPassword: async (password) => verifyWorkRhythmPassword(password),
  },
  updates: {
    getState: () => ipcRenderer.invoke("app-update:get-state"),
    setAutomaticChecks: (enabled) => ipcRenderer.invoke("app-update:set-automatic-checks", enabled === true),
    check: () => ipcRenderer.invoke("app-update:check"),
    download: () => ipcRenderer.invoke("app-update:download"),
    install: () => ipcRenderer.invoke("app-update:install"),
    onPrepareInstall: (callback) => subscribe("app-update:prepare-install", callback),
    completeInstallPreparation: (success) => ipcRenderer.send("app-update:prepare-install-complete", success === true),
    onState: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("app-update:state", listener);
      return () => ipcRenderer.removeListener("app-update:state", listener);
    },
  },
  todayWidget: {
    getState: () => ipcRenderer.invoke("today-widget:get-state"),
    show: () => ipcRenderer.invoke("today-widget:show"),
    hide: () => ipcRenderer.invoke("today-widget:hide"),
    setPreferences: (preferences) => ipcRenderer.invoke("today-widget:set-preferences", preferences),
    resize: (size) => ipcRenderer.invoke("today-widget:resize", size),
    openMain: (taskId = "") => ipcRenderer.invoke("today-widget:open-main", taskId),
    completeTask: (taskId) => ipcRenderer.invoke("today-widget:complete-task", taskId),
    createTask: (payload) => ipcRenderer.invoke("today-widget:create-task", payload),
    updateTaskTitle: (payload) => ipcRenderer.invoke("today-widget:update-task-title", payload),
    promoteQuickCapture: (payload) => ipcRenderer.invoke("today-widget:promote-quick-capture", payload),
    deleteQuickCapture: (payload) => ipcRenderer.invoke("today-widget:delete-quick-capture", payload),
    moveItem: (payload) => ipcRenderer.invoke("today-widget:move-item", payload),
    reorderItem: (payload) => ipcRenderer.invoke("today-widget:reorder-item", payload),
    setEditing: (enabled) => ipcRenderer.invoke("today-widget:set-editing", enabled === true),
    publish: (snapshot) => ipcRenderer.send("today-widget:publish", snapshot),
    respondCompletion: (result) => ipcRenderer.send("today-widget:complete-result", result),
    onSnapshot: (callback) => subscribe("today-widget:snapshot", callback),
    onState: (callback) => subscribe("today-widget:state", callback),
    onOpenTask: (callback) => subscribe("today-widget:open-task", callback),
    onCompleteRequest: (callback) => subscribe("today-widget:complete-request", callback),
    onCreateTaskRequest: (callback) => subscribe("today-widget:create-task", callback),
    onUpdateTaskTitleRequest: (callback) => subscribe("today-widget:update-task-title", callback),
    onPromoteQuickCaptureRequest: (callback) => subscribe("today-widget:promote-quick-capture", callback),
    onDeleteQuickCaptureRequest: (callback) => subscribe("today-widget:delete-quick-capture", callback),
    onMoveItemRequest: (callback) => subscribe("today-widget:move-item", callback),
    onReorderRequest: (callback) => subscribe("today-widget:reorder-item", callback),
    respondMutation: (result) => ipcRenderer.send("today-widget:mutation-result", result),
    // The window is sized from the rendered panel plus the ring that carries the
    // Demo's own drop shadow, so the renderer reports its content box.
    fit: (size) => ipcRenderer.invoke("today-widget:fit", size),
    nudge: (delta) => ipcRenderer.invoke("today-widget:nudge", delta),
    openSurface: (payload) => ipcRenderer.invoke("today-widget:open-surface", payload),
    closeSurface: (payload) => ipcRenderer.invoke("today-widget:close-surface", payload),
    // The transparent ring that carries the panel's shadow must not swallow
    // input aimed at whatever is behind it.
    setRingRegion: (payload) => ipcRenderer.invoke("today-widget:ring", payload),
    onSurface: (callback) => subscribe("today-widget:surface", callback),
    onBeginRename: (callback) => subscribe("today-widget:begin-rename", callback),
    onToast: (callback) => subscribe("today-widget:toast", callback),
  },
  // Popover surfaces (settings / row menu / promote / delete) live in their own
  // frameless window so they can extend past the widget window, exactly where
  // the Demo places them relative to the panel.
  widgetSurface: {
    getPayload: () => ipcRenderer.invoke("widget-surface:get"),
    fit: (size) => ipcRenderer.invoke("widget-surface:fit", size),
    act: (payload) => ipcRenderer.invoke("widget-surface:act", payload),
    close: (payload) => ipcRenderer.invoke("widget-surface:close", payload),
    setRingRegion: (payload) => ipcRenderer.invoke("today-widget:ring", payload),
    onPayload: (callback) => subscribe("widget-surface:payload", callback),
  },
});

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Phase28: capture is owned by the isolated preload. The page can request an
// already armed group transition, but cannot supply live cursor coordinates.
(() => {
  let activeClick = null, tracking = null, fallbackFrame = 0, trackingFrame = 0, enabled = false, serial = 0;
  const controls = 'button,[role="button"],[role="switch"],[role="menuitem"],[role="menuitemradio"],input[type="button"],input[type="submit"],summary';
  const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const within = (p, r) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;
  const unique = selector => { try { const matches = document.querySelectorAll(selector); return matches.length === 1 ? matches[0] : null; } catch { return null; } };
  function cancel() {
    activeClick = null; tracking = null;
    cancelAnimationFrame(fallbackFrame); cancelAnimationFrame(trackingFrame);
    ipcRenderer.send('pointer-continuity:cancel');
  }
  function selectorFor(el) {
    const scope = el.closest('[data-pointer-group]');
    const prefix = scope && scope !== el ? `[data-pointer-group="${CSS.escape(scope.dataset.pointerGroup)}"] ` : '';
    const selectors = [];
    if (el.id) selectors.push('#' + CSS.escape(el.id));
    const attrs = ['data-pointer-group', 'data-action', 'data-pane', 'data-task-id', 'data-node-id', 'data-group-id',
      'data-setting-button', 'data-key', 'data-value', 'data-direction', 'data-field', 'data-recovery26',
      'data-management24', 'data-notebook23', 'data-note23', 'data-manage24', 'data-continuity28', 'data-brief21-toggle', 'data-bulk-action'];
    const data = attrs.filter(name => el.hasAttribute(name)).map(name => `[${name}="${CSS.escape(el.getAttribute(name))}"]`).join('');
    if (data) selectors.push(el.tagName.toLowerCase() + data);
    // Stable classes disambiguate two controls with the same action on one row.
    const classes = [...el.classList].filter(value => !['active', 'selected', 'open', 'is-checked', 'todo', 'done', 'later', 'blocked'].includes(value));
    if (data && classes.length) selectors.push(el.tagName.toLowerCase() + classes.map(value => '.' + CSS.escape(value)).join('') + data);
    for (const selector of selectors) {
      if (unique(prefix + selector) === el) return prefix + selector;
    }
    return null;
  }
  function find(click, which) {
    const el = click[which + 'Element'];
    // Retention alone is insufficient: the parent can now represent another task.
    if (el?.isConnected && selectorFor(el) === click[which + 'Selector']) return el;
    return unique(click[which + 'Selector']);
  }
  function locate(click) {
    if (document.querySelector('.workspace')?.dataset.taskId !== click.task) return null;
    const button = find(click, 'button'), group = find(click, 'group');
    if (!button || !group || !group.contains(button) || button.disabled || button.getAttribute('aria-disabled') === 'true' || !group.getClientRects().length) return null;
    const overlays = [...document.querySelectorAll('#overlay > *,[aria-modal="true"],.knowledge-draft-backdrop,.task-priority-layer')].filter(el => el.getClientRects().length);
    if (overlays.some(el => !el.contains(button))) return null;
    const r = box(group), b = box(button), point = { x: r.x + click.offset.x, y: r.y + click.offset.y };
    if (!within(point, r) || !within(point, b)) return null;
    // Clipping, a popover, or another object on top also ends the transaction.
    const hit = document.elementFromPoint(point.x, point.y);
    if (!hit || !(button === hit || button.contains(hit))) return null;
    return { group, button, rect: r, buttonRect: b };
  }
  function running(el) {
    for (let parent = el; parent; parent = parent.parentElement) if (parent.getAnimations().some(a => a.playState === 'running' || a.playState === 'paused')) return true;
    return false;
  }
  async function follow(request) {
    const click = activeClick;
    if (!enabled || !click || click.claimed || request?.key !== click.key || Date.now() - click.time > 500 || !locate(click)) return { ok: false };
    click.claimed = true; cancelAnimationFrame(fallbackFrame);
    const token = { click, busy: false, stable: 0, last: null, started: performance.now() }; tracking = token;
    const result = await ipcRenderer.invoke('pointer-continuity:start', { key: click.key, rect: request.rect });
    if (tracking !== token) return { ok: false };
    if (!result.ok) { cancel(); return { ok: false }; }
    token.started = performance.now();
    const sample = () => {
      if (tracking !== token) return;
      trackingFrame = requestAnimationFrame(sample);
      if (token.busy) return; // Drop this display frame; never queue old samples.
      const target = locate(click);
      if (!target || performance.now() - token.started > 350) { cancel(); return; }
      const stable = token.last && Math.hypot(target.rect.x - token.last.x, target.rect.y - token.last.y) < .1;
      token.stable = stable && !running(target.group) ? token.stable + 1 : 0; token.last = target.rect;
      token.busy = true;
      ipcRenderer.invoke('pointer-continuity:frame', { key: click.key, rect: target.rect, buttonRect: target.buttonRect, time: Date.now() }).then(async response => {
        if (tracking !== token) return;
        token.busy = false;
        if (!response.ok) { cancel(); return; }
        if (token.stable >= 2) {
          tracking = null; activeClick = null; cancelAnimationFrame(trackingFrame);
          await ipcRenderer.invoke('pointer-continuity:finish', { key: click.key });
        }
      }).catch(() => { if (tracking === token) cancel(); });
    };
    trackingFrame = requestAnimationFrame(sample);
    return { ok: true };
  }
  contextBridge.exposeInMainWorld('loopPointerContinuity', {
    currentClick: () => activeClick && { key: activeClick.key, selector: activeClick.groupSelector,
      buttonSelector: activeClick.buttonSelector, rect: activeClick.rect, time: activeClick.time, claimed: activeClick.claimed === true },
    setEnabled(value) { enabled = value === true; if (!enabled) cancel(); },
    follow, cancel, status: () => ipcRenderer.invoke('pointer-continuity:status'),
  });
  window.addEventListener('pointerdown', event => {
    cancel();
    const button = event.target.closest?.(controls);
    if (!enabled || !event.isTrusted || event.button !== 0 || !button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    if (/^(add-|create-|new-|import-)/.test(button.dataset.action || '')) return;
    const group = button.closest('[data-pointer-group]') || button;
    const buttonSelector = selectorFor(button), groupSelector = selectorFor(group);
    if (!buttonSelector || !groupSelector) return;
    const r = box(group), b = box(button), point = { x: event.clientX, y: event.clientY };
    if (!within(point, r) || !within(point, b)) return;
    const time = Date.now(), key = `${++serial}:${groupSelector}:${buttonSelector}`;
    activeClick = { key, time, rect: r, offset: { x: point.x - r.x, y: point.y - r.y },
      task: document.querySelector('.workspace')?.dataset.taskId, buttonElement: button, groupElement: group, buttonSelector, groupSelector };
    ipcRenderer.send('pointer-continuity:arm', { key, rect: r, buttonRect: b, x: point.x, y: point.y, time });
  }, true);
  // Cover direct synchronous DOM updates too. Capture schedules before app
  // handlers run; the first rAF holds FLIP before painting the new position.
  window.addEventListener('click', event => {
    if (!event.isTrusted || !activeClick) return;
    const click = activeClick;
    const sample = () => {
      if (activeClick !== click || click.claimed) return;
      if (Date.now() - click.time > 100) { cancel(); return; }
      const target = locate(click); if (!target) { cancel(); return; }
      const r = target.rect, distance = Math.hypot(r.x - click.rect.x, r.y - click.rect.y);
      if (running(target.group)) { cancel(); return; }
      if (distance >= 12 && distance <= 300) {
        const animation = target.group.animate([{ transform: `translate(${click.rect.x-r.x}px,${click.rect.y-r.y}px)` }, { transform: 'translate(0,0)' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
        animation.pause(); animation.currentTime = 0;
        follow({ key: click.key, rect: r }).finally(() => { if (target.group.isConnected) animation.play(); else animation.cancel(); });
        return;
      }
      if (distance > 300) { cancel(); return; }
      // No synchronous displacement: abandon, rather than chasing later data.
      cancel();
    };
    fallbackFrame = requestAnimationFrame(sample);
  }, true);
  for (const name of ['wheel', 'keydown', 'compositionstart', 'beforeinput', 'resize', 'pointercancel', 'touchmove']) window.addEventListener(name, cancel, true);
  window.addEventListener('blur', event => { if (event.target === window) cancel(); });
})();

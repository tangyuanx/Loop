const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PREFERENCES_FILE = "today-widget-preferences.json";
const WIDGET_GAP = 16;
const WIDGET_MIN_HEIGHT = 180;
const WIDGET_MAX_HEIGHT = 720;
const WIDGET_POSITIONS = new Set(["top-left", "top-right", "bottom-left", "bottom-right", "custom"]);
const WIDGET_ZH_FONTS = new Set(["system", "noto", "yahei", "pingfang", "songti", "simsun", "fangsong", "heiti", "kaiti"]);
const WIDGET_EN_FONTS = new Set(["inter", "system", "segoe", "arial", "helvetica", "verdana", "trebuchet", "tahoma", "times", "georgia", "courier", "mono"]);
const CLICK_THROUGH_ACCELERATOR = "CommandOrControl+Shift+T";
// The Demo lays its panel out inside a page; the product hosts it in a frameless
// window whose content box is the panel plus the ring that carries the Demo's
// own drop shadow (`0 12px 40px #0003`). Same for the popover surfaces
// (`0 10px 36px #0003` / `0 16px 55px #0003`).
const WIDGET_PAD_X = 22;
const WIDGET_PAD_TOP = 22;
const WIDGET_PAD_BOTTOM = 36;
const SURFACE_PAD = 20;
const SURFACE_PAD_BOTTOM = 26;
// mountSurface()/showWidgetPreferences() widths from loop-widget-phase13.js.
// mountSurface() widths plus the Demo's own `.dialog{width:440px}`.
const SURFACE_WIDTHS = { settings: 286, "row-menu": 224, promote: 244, delete: 440 };
const SURFACE_KINDS = new Set(["settings", "row-menu", "promote", "delete"]);
// The Demo's panel widths (widget12.css `.widget12{width:360px}` and
// `.widget12.compact{width:254px}`). The renderer measures the panel height from
// its content; the width is a function of the mode, so deriving it from a panel
// that the window itself constrains would feed the window its own width back.
const WIDGET_WIDTHS = { expanded: 360, compact: 254 };
const SURFACE_FALLBACK_HEIGHTS = { settings: 430, "row-menu": 200, promote: 190, delete: 200 };
const DEFAULT_PREFERENCES = Object.freeze({
  position: "top-right",
  alwaysOnTop: true,
  launchWithApp: true,
  visible: true,
  compact: false,
  opacity: 100,
  // The phase-12/13 widget design needs room for the header (48) + tabs (35)
  // + three rows (49 each) + the quick-capture composer.
  height: 340,
  // The Demo sizes the panel from its own content (the list body is capped at
  // 296px and the window follows). A manual resize switches to `height`.
  autoHeight: true,
  // Which edge stays put when the content grows or shrinks.
  frameAnchor: { x: "right", y: "bottom" },
  customBounds: null,
  clickThrough: false,
  quickCaptureDraft: "",
});

function normalizeTodayWidgetPreferences(value) {
  const raw = value && typeof value === "object" ? value : {};
  const customBounds = normalizeCustomBounds(raw.customBounds);
  const position = WIDGET_POSITIONS.has(raw.position) && (raw.position !== "custom" || customBounds)
    ? raw.position
    : DEFAULT_PREFERENCES.position;
  return {
    position,
    alwaysOnTop: raw.alwaysOnTop !== false,
    launchWithApp: raw.launchWithApp !== false,
    visible: raw.visible !== false,
    compact: raw.compact === true,
    opacity: normalizeOpacity(raw.opacity),
    height: normalizeHeight(raw.height),
    autoHeight: raw.autoHeight !== false,
    frameAnchor: normalizeFrameAnchor(raw.frameAnchor),
    customBounds,
    clickThrough: raw.clickThrough === true,
    quickCaptureDraft: normalizeQuickCaptureDraft(raw.quickCaptureDraft),
  };
}

function normalizeQuickCaptureDraft(value) {
  return String(value || "").slice(0, 4000);
}

function normalizeOpacity(value) {
  const opacity = value == null || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(opacity) ? Math.max(70, Math.min(100, Math.round(opacity))) : DEFAULT_PREFERENCES.opacity;
}

function normalizeFrameAnchor(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    x: raw.x === "left" ? "left" : "right",
    y: raw.y === "top" ? "top" : "bottom",
  };
}

function normalizeHeight(value) {
  const height = value == null || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(height)
    ? Math.max(WIDGET_MIN_HEIGHT, Math.min(WIDGET_MAX_HEIGHT, Math.round(height)))
    : DEFAULT_PREFERENCES.height;
}

function normalizeCustomBounds(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function windowSizeForContent(content) {
  const raw = content && typeof content === "object" ? content : {};
  const width = Math.max(1, Math.round(Number(raw.width) || 360));
  const height = Math.max(1, Math.round(Number(raw.height) || DEFAULT_PREFERENCES.height));
  return { width: width + WIDGET_PAD_X * 2, height: height + WIDGET_PAD_TOP + WIDGET_PAD_BOTTOM };
}

function cornerWindowBounds(workArea, size, position, gap = WIDGET_GAP) {
  const safeArea = workArea && typeof workArea === "object" ? workArea : { x: 0, y: 0, width: 1280, height: 800 };
  const width = Math.max(1, Math.round(Number(size?.width) || 360));
  const height = Math.max(1, Math.round(Number(size?.height) || 260));
  const left = Math.round(Number(safeArea.x) || 0) + gap;
  const top = Math.round(Number(safeArea.y) || 0) + gap;
  const right = Math.round(Number(safeArea.x) || 0) + Math.round(Number(safeArea.width) || width) - width - gap;
  const bottom = Math.round(Number(safeArea.y) || 0) + Math.round(Number(safeArea.height) || height) - height - gap;
  return {
    x: position.endsWith("right") ? Math.max(left, right) : left,
    y: position.startsWith("bottom") ? Math.max(top, bottom) : top,
    width,
    height,
  };
}

function resizedWidgetBounds(bounds, workArea, requestedHeight, edge = "bottom") {
  const safeBounds = bounds && typeof bounds === "object" ? bounds : { x: 0, y: 0, width: 360, height: 340 };
  const safeArea = workArea && typeof workArea === "object" ? workArea : { x: 0, y: 0, width: 1280, height: 800 };
  const x = Math.round(Number(safeBounds.x) || 0);
  const y = Math.round(Number(safeBounds.y) || 0);
  const width = Math.max(296, Math.round(Number(safeBounds.width) || 360));
  const currentHeight = Math.max(49, Math.round(Number(safeBounds.height) || DEFAULT_PREFERENCES.height));
  const areaTop = Math.round(Number(safeArea.y) || 0);
  const areaHeight = Math.max(1, Math.round(Number(safeArea.height) || 800));
  const areaBottom = areaTop + areaHeight;
  const resizeFromTop = edge === "top";
  const availableHeight = resizeFromTop ? y + currentHeight - areaTop : areaBottom - y;
  const minimumHeight = Math.min(WIDGET_MIN_HEIGHT, areaHeight);
  const maximumHeight = Math.max(minimumHeight, Math.min(WIDGET_MAX_HEIGHT, availableHeight));
  const numericHeight = Number(requestedHeight);
  const desiredHeight = Number.isFinite(numericHeight) ? Math.round(numericHeight) : currentHeight;
  const height = Math.max(minimumHeight, Math.min(maximumHeight, desiredHeight));
  return {
    x,
    y: resizeFromTop ? y + currentHeight - height : y,
    width,
    height,
  };
}

function applyTodayWidgetTopmost(window, enabled, platform = process.platform, { relativeLevel = 1, raise = true } = {}) {
  if (!window || window.isDestroyed()) return;
  const topmost = enabled === true;
  if (platform === "darwin") {
    window.setVisibleOnAllWorkspaces(topmost, {
      visibleOnFullScreen: topmost,
      // Keep the host application a regular foreground app so macOS does not
      // remove its icon from the Dock while the widget joins fullscreen Spaces.
      skipTransformProcessType: true,
    });
    window.setHiddenInMissionControl(topmost);
  }
  const level = topmost ? (platform === "darwin" ? "screen-saver" : "floating") : "normal";
  window.setAlwaysOnTop(topmost, level, topmost && platform === "darwin" ? relativeLevel : 0);
  if (raise && topmost && window.isVisible()) window.moveTop();
}

async function readTodayWidgetPreferences(userDataPath) {
  try {
    const raw = await fs.readFile(path.join(userDataPath, PREFERENCES_FILE), "utf8");
    return normalizeTodayWidgetPreferences(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return { ...DEFAULT_PREFERENCES };
    throw error;
  }
}

async function writeTodayWidgetPreferences(userDataPath, value) {
  const preferences = normalizeTodayWidgetPreferences(value);
  await fs.mkdir(userDataPath, { recursive: true });
  const filePath = path.join(userDataPath, PREFERENCES_FILE);
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
  return preferences;
}

function createTodayWidgetController({ app, BrowserWindow, globalShortcut, ipcMain, screen, getMainWindow, ensureMainWindow }) {
  let preferences = { ...DEFAULT_PREFERENCES };
  let widgetWindow = null;
  let surfaceWindow = null;
  let surfacePayload = null;
  let surfaceAnchor = null;
  let surfaceContent = { width: 286, height: 425 };
  let surfacePanel = null;
  let openingSurface = false;
  // True while the pointer sits in the transparent shadow ring rather than on
  // the panel; the window then forwards mouse events to whatever is behind it.
  let widgetRingOutside = false;
  let surfaceRingOutside = false;
  let snapshot = { date: "", items: [] };
  // The window is the rendered panel plus the ring that carries the Demo's own
  // drop shadow; `currentContent` is the panel box the renderer measured.
  let currentContent = { width: 360, height: DEFAULT_PREFERENCES.height };
  let currentSize = windowSizeForContent(currentContent);
  let firstFitPending = true;
  let showFallbackTimer = null;
  let moveSaveTimer = null;
  let resizeSaveTimer = null;
  let suppressMoveUntil = 0;
  let editingText = false;
  let preferenceWrite = Promise.resolve();
  let surfaceBusy = false;
  let surfaceGeneration = 0;
  const pendingCompletions = new Map();
  const pendingMutations = new Map();

  function widgetState() {
    return {
      ...preferences,
      // The Demo offers "恢复默认尺寸与位置" once the panel has been framed by
      // the user; a corner-placed auto-height panel is still the default frame.
      customFrame: preferences.autoHeight === false || preferences.position === "custom",
      visible: Boolean(preferences.visible && widgetWindow && !widgetWindow.isDestroyed()),
    };
  }

  function broadcast(channel, payload) {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    });
  }

  function broadcastState() {
    broadcast("today-widget:state", widgetState());
  }

  function persistPreferences() {
    const value = { ...preferences };
    preferenceWrite = preferenceWrite.then(() => writeTodayWidgetPreferences(app.getPath("userData"), value)).catch((error) => {
      console.error("Failed to persist Today widget preferences.", error);
    });
    return preferenceWrite;
  }

  function activeDisplay() {
    if (widgetWindow && !widgetWindow.isDestroyed()) return screen.getDisplayMatching(widgetWindow.getBounds());
    return screen.getPrimaryDisplay();
  }

  function frameAnchorForPosition(position, area, bounds) {
    if (position === "custom" && bounds) {
      const areaCenterX = area.x + area.width / 2;
      const areaCenterY = area.y + area.height / 2;
      return {
        x: bounds.x + bounds.width / 2 > areaCenterX ? "right" : "left",
        y: bounds.y + bounds.height / 2 > areaCenterY ? "bottom" : "top",
      };
    }
    return {
      x: String(position || "").endsWith("right") ? "right" : "left",
      y: String(position || "").startsWith("bottom") ? "bottom" : "top",
    };
  }

  // Applies a renderer-measured content box: the window follows the panel, and
  // the edge the panel is docked to stays put (the Demo's resize behaves the
  // same way, growing away from the anchored edge).
  function applyContentSize(content, options = {}) {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const measured = !preferences.compact && !preferences.autoHeight ? preferences.height : Number(content?.height) || currentContent.height;
    const height = Math.max(40, Math.min(900, Math.round(measured)));
    // Width follows the mode, never the measurement: the panel is `width:100%`
    // of the window, so echoing its measured width back would freeze the window
    // at whatever width it currently has.
    const width = preferences.compact ? WIDGET_WIDTHS.compact : WIDGET_WIDTHS.expanded;
    if (width === currentContent.width && height === currentContent.height && !options.force) return;
    currentContent = { width, height };
    currentSize = windowSizeForContent(currentContent);
    const bounds = widgetWindow.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const anchor = preferences.position === "custom" ? normalizeFrameAnchor(preferences.frameAnchor) : frameAnchorForPosition(preferences.position, area, null);
    let x = bounds.x;
    let y = bounds.y;
    if (anchor.x === "right") x = bounds.x + bounds.width - currentSize.width;
    if (anchor.y === "bottom") y = bounds.y + bounds.height - currentSize.height;
    x = Math.max(area.x, Math.min(area.x + area.width - currentSize.width, x));
    y = Math.max(area.y, Math.min(area.y + area.height - currentSize.height, y));
    suppressMoveUntil = Date.now() + 350;
    widgetWindow.setBounds({ x, y, ...currentSize }, false);
    if (options.persist !== false && preferences.position === "custom") {
      preferences = { ...preferences, customBounds: { x, y } };
      void persistPreferences();
    }
  }

  function positionWidget() {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const display = activeDisplay();
    let bounds;
    if (preferences.position === "custom" && preferences.customBounds) {
      const area = screen.getDisplayNearestPoint(preferences.customBounds).workArea;
      bounds = {
        x: Math.max(area.x, Math.min(area.x + area.width - currentSize.width, preferences.customBounds.x)),
        y: Math.max(area.y, Math.min(area.y + area.height - currentSize.height, preferences.customBounds.y)),
        ...currentSize,
      };
    } else {
      bounds = cornerWindowBounds(display.workArea, currentSize, preferences.position);
    }
    suppressMoveUntil = Date.now() + 350;
    widgetWindow.setBounds(bounds, false);
  }

  function applyAlwaysOnTop() {
    // A topmost or NSPanel-level widget can cover native IME candidates. While
    // text is being edited, keep this focused window at the normal OS level;
    // the system input-method panel can then render above it.
    const hasSurface = Boolean(surfacePayload && surfaceWindow && !surfaceWindow.isDestroyed());
    applyTodayWidgetTopmost(widgetWindow, preferences.alwaysOnTop && !editingText, process.platform, { raise: !hasSurface });
    if (hasSurface) {
      applyTodayWidgetTopmost(surfaceWindow, preferences.alwaysOnTop, process.platform, { relativeLevel: 2 });
    }
  }

  function restoreAlwaysOnTopAfterAppDeactivation() {
    // macOS keeps the DOM input focused when the user switches applications.
    // Editing no longer needs the IME-safe normal window level once this app
    // is inactive, so release that temporary override before refreshing z-order.
    editingText = false;
    applyAlwaysOnTop();
  }

  function applyClickThrough() {
    if (!widgetWindow || widgetWindow.isDestroyed() || typeof widgetWindow.setIgnoreMouseEvents !== "function") return;
    widgetWindow.setIgnoreMouseEvents(preferences.clickThrough === true || widgetRingOutside === true, { forward: true });
  }

  function applySurfacePassthrough() {
    if (!surfaceWindow || surfaceWindow.isDestroyed() || typeof surfaceWindow.setIgnoreMouseEvents !== "function") return;
    surfaceWindow.setIgnoreMouseEvents(surfaceRingOutside === true, { forward: true });
  }

  // `inside === false` means the pointer is on the transparent ring (the 22/36px
  // frame that exists so the Demo's shadow is never clipped). Ignoring mouse
  // events there - with forwarding, so the pointer position keeps arriving -
  // lets hover and clicks reach the widget or the app behind it.
  function applyRingRegion(target, inside) {
    const outside = inside !== true;
    if (target === "surface") {
      if (surfaceRingOutside === outside) return { success: true };
      surfaceRingOutside = outside;
      applySurfacePassthrough();
      return { success: true, outside };
    }
    if (widgetRingOutside === outside) return { success: true };
    widgetRingOutside = outside;
    applyClickThrough();
    return { success: true, outside };
  }

  async function toggleClickThrough() {
    await updatePreferences({ clickThrough: !preferences.clickThrough });
  }

  function createWidgetWindow() {
    if (widgetWindow && !widgetWindow.isDestroyed()) return widgetWindow;
    widgetWindow = new BrowserWindow({
      width: currentSize.width,
      height: currentSize.height,
      minWidth: WIDGET_PAD_X * 2 + 160,
      minHeight: WIDGET_PAD_TOP + WIDGET_PAD_BOTTOM + 40,
      frame: false,
      acceptFirstMouse: true,
      transparent: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      type: process.platform === "darwin" ? "panel" : undefined,
      alwaysOnTop: preferences.alwaysOnTop,
      title: "今日任务",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    positionWidget();
    widgetWindow.loadFile(path.join(__dirname, "..", "renderer", "today-widget.html"));
    widgetWindow.once("ready-to-show", () => {
      // The window is sized from the rendered panel, so the first paint waits
      // for the renderer's first measurement instead of showing a 340px guess.
      if (preferences.visible) {
        firstFitPending = true;
        clearTimeout(showFallbackTimer);
        showFallbackTimer = setTimeout(revealWidgetWindow, 600);
      }
      applyAlwaysOnTop();
      widgetWindow.webContents.send("today-widget:snapshot", snapshot);
      widgetWindow.webContents.send("today-widget:state", widgetState());
      applyClickThrough();
      broadcastState();
    });
    widgetWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    widgetWindow.on("show", applyAlwaysOnTop);
    widgetWindow.on("focus", () => {
      applyAlwaysOnTop();
      applyClickThrough();
    });
    widgetWindow.on("move", () => {
      if (Date.now() < suppressMoveUntil || !widgetWindow || widgetWindow.isDestroyed()) return;
      const { x, y } = widgetWindow.getBounds();
      const area = screen.getDisplayMatching(widgetWindow.getBounds()).workArea;
      preferences = {
        ...preferences,
        position: "custom",
        customBounds: { x, y },
        frameAnchor: frameAnchorForPosition("custom", area, { x, y, width: currentSize.width, height: currentSize.height }),
      };
      clearTimeout(moveSaveTimer);
      moveSaveTimer = setTimeout(() => {
        void persistPreferences();
        broadcastState();
      }, 180);
    });
    widgetWindow.on("closed", () => {
      editingText = false;
      widgetWindow = null;
      broadcastState();
    });
    return widgetWindow;
  }

  function revealWidgetWindow() {
    clearTimeout(showFallbackTimer);
    showFallbackTimer = null;
    firstFitPending = false;
    widgetRingOutside = false;
    if (!widgetWindow || widgetWindow.isDestroyed() || !preferences.visible) return;
    widgetWindow.showInactive();
    applyAlwaysOnTop();
  }

  async function waitForMainWindow() {
    const window = getMainWindow() || ensureMainWindow();
    if (!window.webContents.isLoadingMainFrame()) return window;
    await new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
    return window;
  }

  async function showMainWindow(taskId = "") {
    const window = await waitForMainWindow();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents.send("today-widget:open-task", { taskId: normalizeTaskId(taskId) });
    return { success: true };
  }

  async function showWidget() {
    preferences = { ...preferences, visible: true };
    const window = createWidgetWindow();
    widgetRingOutside = false;
    positionWidget();
    if (firstFitPending) {
      clearTimeout(showFallbackTimer);
      showFallbackTimer = setTimeout(revealWidgetWindow, 600);
    } else {
      window.showInactive();
    }
    applyAlwaysOnTop();
    applyClickThrough();
    await persistPreferences();
    broadcastState();
    return widgetState();
  }

  async function hideWidget() {
    closeSurface("hide");
    preferences = { ...preferences, visible: false };
    widgetRingOutside = false;
    editingText = false;
    widgetWindow?.hide();
    await persistPreferences();
    broadcastState();
    return widgetState();
  }

  async function updatePreferences(patch) {
    const raw = patch && typeof patch === "object" ? patch : {};
    const resetFrame = raw.resetFrame === true;
    preferences = normalizeTodayWidgetPreferences({ ...preferences, ...raw });
    if (resetFrame) preferences = { ...preferences, autoHeight: true, customBounds: null, height: DEFAULT_PREFERENCES.height };
    if (raw.position && raw.position !== "custom") preferences.customBounds = null;
    applyAlwaysOnTop();
    applyClickThrough();
    if (Object.hasOwn(raw, "compact")) {
      currentContent = preferences.compact
        ? { width: WIDGET_WIDTHS.compact, height: 48 }
        : { width: WIDGET_WIDTHS.expanded, height: currentContent.height };
      currentSize = windowSizeForContent(currentContent);
    }
    if (raw.position || Object.hasOwn(raw, "compact") || resetFrame) positionWidget();
    await persistPreferences();
    broadcastState();
    if (surfacePayload?.kind === "settings") {
      const next = surfacePayloadFor("settings", "");
      if (JSON.stringify(next) !== JSON.stringify(surfacePayload)) { surfacePayload = next; sendSurfacePayload(); }
    }
    return widgetState();
  }

  async function resizeWidget(size) {
    if (!widgetWindow || widgetWindow.isDestroyed()) return widgetState();
    if (size?.reset === true) {
      // "恢复默认尺寸与位置": the renderer re-measures the panel and the window
      // follows the content again.
      preferences = { ...preferences, autoHeight: true, customBounds: null };
      broadcastState();
      await persistPreferences();
      return widgetState();
    }
    if (preferences.compact) {
      if (size?.transient !== true) return widgetState();
      currentContent = {
        width: Math.max(254, Math.min(480, Math.round(Number(size?.width) || 254))),
        height: Math.max(48, Math.min(420, Math.round(Number(size?.height) || 48))),
      };
      currentSize = windowSizeForContent(currentContent);
      positionWidget();
      return widgetState();
    }
    const bounds = widgetWindow.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const edge = size?.edge === "top" ? "top" : "bottom";
    const anchor = preferences.position === "custom"
      ? normalizeFrameAnchor(preferences.frameAnchor)
      : frameAnchorForPosition(preferences.position, workArea, null);
    const nextBounds = resizedWidgetBounds(bounds, workArea, size?.height, edge);
    currentSize = { width: nextBounds.width, height: nextBounds.height };
    currentContent = {
      width: currentSize.width - WIDGET_PAD_X * 2,
      height: currentSize.height - WIDGET_PAD_TOP - WIDGET_PAD_BOTTOM,
    };
    preferences = normalizeTodayWidgetPreferences({
      ...preferences,
      position: "custom",
      autoHeight: false,
      height: currentContent.height,
      customBounds: { x: nextBounds.x, y: nextBounds.y },
    });
    preferences = { ...preferences, frameAnchor: { x: anchor.x, y: edge === "top" ? "bottom" : "top" } };
    suppressMoveUntil = Date.now() + 350;
    widgetWindow.setBounds(nextBounds, false);
    broadcastState();
    clearTimeout(resizeSaveTimer);
    resizeSaveTimer = setTimeout(() => {
      void persistPreferences();
    }, 180);
    return widgetState();
  }

  function publishSnapshot(value) {
    snapshot = normalizeSnapshot(value);
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.send("today-widget:snapshot", snapshot);
    if (surfacePayload) {
      const { kind, task } = surfacePayload;
      const next = surfacePayloadFor(kind, task?.id);
      if (kind !== "settings" && next.task.index < 0 && !surfaceBusy) closeSurface("removed");
      else { surfacePayload = next; sendSurfacePayload(); }
    }
  }

  async function requestMainMutation(channel, payload) {
    const mainWindow = await waitForMainWindow();
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingMutations.delete(requestId);
        resolve({ success: false, code: "TIMEOUT" });
      }, 5000);
      pendingMutations.set(requestId, { resolve, timer });
      mainWindow.webContents.send(channel, { requestId, ...payload });
    });
  }

  function resolveMutation(event, value) {
    if (event.sender !== getMainWindow()?.webContents) return;
    const requestId = String(value?.requestId || "");
    const pending = pendingMutations.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingMutations.delete(requestId);
    pending.resolve({
      success: value?.success === true,
      code: ["CREATED", "UPDATED", "PROMOTED", "DELETED", "DELETE_CANCELLED", "DELETE_FAILED", "MOVED", "BOUNDARY", "INVALID_LANE", "INVALID_DIRECTION", "INVALID_POSITION", "TASK_NOT_FOUND", "GROUP_NOT_FOUND", "INVALID_TITLE", "TIMEOUT", "SAVE_FAILED"].includes(value?.code)
        ? value.code
        : "TASK_NOT_FOUND",
      taskId: normalizeTaskId(value?.taskId),
    });
  }

  async function requestCompletion(taskId) {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) return { success: false, code: "TASK_NOT_FOUND" };
    const mainWindow = await waitForMainWindow();
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingCompletions.delete(requestId);
        resolve({ success: false, code: "TIMEOUT" });
      }, 5000);
      pendingCompletions.set(requestId, { resolve, timer });
      mainWindow.webContents.send("today-widget:complete-request", { requestId, taskId: normalizedTaskId });
    }).then(async (result) => {
      if (["CONCLUSION_REQUIRED", "FLOW_INCOMPLETE"].includes(result?.code)) await showMainWindow(normalizedTaskId);
      return result;
    });
  }

  function resolveCompletion(event, value) {
    if (event.sender !== getMainWindow()?.webContents) return;
    const requestId = String(value?.requestId || "");
    const pending = pendingCompletions.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingCompletions.delete(requestId);
    pending.resolve({
      success: value?.success === true,
      code: ["COMPLETED", "CONCLUSION_REQUIRED", "FLOW_INCOMPLETE", "TASK_NOT_FOUND"].includes(value?.code) ? value.code : "TASK_NOT_FOUND",
    });
  }

  function isWidgetSender(event) {
    const sender = event?.sender;
    return Boolean(sender) && Boolean(widgetWindow) && !widgetWindow.isDestroyed() && sender === widgetWindow.webContents;
  }

  function isSurfaceSender(event) {
    const sender = event?.sender;
    return Boolean(sender) && Boolean(surfaceWindow) && !surfaceWindow.isDestroyed() && sender === surfaceWindow.webContents;
  }

  function isMainWindowSender(event) {
    const sender = event?.sender;
    const main = getMainWindow();
    return Boolean(sender) && Boolean(main) && !main.isDestroyed() && sender === main.webContents;
  }

  function rejectUnknownSender(channel) {
    return { success: false, code: "UNKNOWN_SENDER", channel };
  }

  function widgetPanelScreenRect() {
    const bounds = widgetWindow && !widgetWindow.isDestroyed() ? widgetWindow.getBounds() : { x: 0, y: 0, width: currentSize.width, height: currentSize.height };
    return {
      x: bounds.x + WIDGET_PAD_X,
      y: bounds.y + WIDGET_PAD_TOP,
      width: Math.max(1, bounds.width - WIDGET_PAD_X * 2),
      height: Math.max(1, bounds.height - WIDGET_PAD_TOP - WIDGET_PAD_BOTTOM),
    };
  }

  // The Demo places its popovers in viewport coordinates
  // (mountSurface() and loop-shell-refinement.js placePreferences()). This is
  // the same maths in screen coordinates, clamped to the display work area.
  function surfaceBounds(kind, size) {
    const area = activeDisplay().workArea;
    const panel = widgetPanelScreenRect();
    const declared = SURFACE_WIDTHS[kind];
    const innerWidth = Math.max(120, Math.round(Number(size?.width) || declared || 286));
    const requestedHeight = Math.max(60, Math.round(Number(size?.height) || SURFACE_FALLBACK_HEIGHTS[kind] || 200));
    const innerHeight = Math.min(requestedHeight, Math.max(80, area.height - 24 - SURFACE_PAD - SURFACE_PAD_BOTTOM));
    const minLeft = area.x + 12;
    const maxLeft = area.x + area.width - 12 - innerWidth;
    const minTop = area.y + 12;
    const maxTop = area.y + area.height - 12 - innerHeight;
    const anchor = surfaceAnchor || { x: panel.x + panel.width, y: panel.y, w: 0, h: 0 };
    let left;
    let top;
    if (kind === "settings") {
      const gap = 10;
      const rect = surfacePanel || { x: panel.x, y: panel.y, w: panel.width, h: panel.height };
      left = rect.x + rect.w - innerWidth;
      top = rect.y - innerHeight - gap;
      if (top < minTop) {
        if (rect.y + rect.h + gap + innerHeight <= area.y + area.height - 12) {
          top = rect.y + rect.h + gap;
        } else {
          left = rect.x - innerWidth - gap >= minLeft
            ? rect.x - innerWidth - gap
            : rect.x + rect.w + gap + innerWidth <= area.x + area.width - 12 ? rect.x + rect.w + gap : rect.x + rect.w - innerWidth;
          top = rect.y;
        }
      }
    } else if (kind === "delete") {
      left = area.x + (area.width - innerWidth) / 2;
      top = area.y + (area.height - innerHeight) / 2;
    } else {
      const gap = kind === "row-menu" ? 5 : 7;
      left = kind === "row-menu" ? anchor.x + anchor.w - innerWidth : anchor.x;
      top = anchor.y + anchor.h + gap;
    }
    left = Math.max(minLeft, Math.min(left, maxLeft));
    top = Math.max(minTop, Math.min(top, maxTop));
    return {
      x: Math.round(left - SURFACE_PAD),
      y: Math.round(top - SURFACE_PAD),
      width: Math.round(innerWidth + SURFACE_PAD * 2),
      height: Math.round(innerHeight + SURFACE_PAD + SURFACE_PAD_BOTTOM),
    };
  }

  function seedSurfaceContent(kind) {
    surfaceContent = {
      width: SURFACE_WIDTHS[kind] || surfaceContent.width,
      height: SURFACE_FALLBACK_HEIGHTS[kind] || surfaceContent.height,
    };
    return surfaceContent;
  }

  function surfacePayloadFor(kind, taskId) {
    const appearance = normalizeTodayWidgetAppearance(snapshot.appearance);
    if (kind === "settings") {
      return {
        kind,
        appearance,
        settings: {
          position: preferences.position,
          opacity: preferences.opacity,
          alwaysOnTop: preferences.alwaysOnTop,
          clickThrough: preferences.clickThrough,
          launchWithApp: preferences.launchWithApp,
          customFrame: preferences.autoHeight === false || preferences.position === "custom",
        },
      };
    }
    const quick = snapshot.quickCaptures.find((item) => item.taskId === taskId) || null;
    const list = quick ? snapshot.quickCaptures : snapshot.items;
    const index = list.findIndex((item) => item.taskId === taskId);
    const entry = list[index] || null;
    return {
      kind,
      appearance,
      task: {
        id: String(taskId || ""),
        title: String(entry?.title || ""),
        isQuick: Boolean(quick),
        index,
        count: list.length,
      },
      groups: kind === "promote" ? snapshot.groups : [],
    };
  }

  function surfaceReturnFocusSelector(kind, taskId) {
    if (kind === "settings") return '[data-action="widget-preferences"]';
    const id = String(taskId || "");
    return id ? '[data-widget12="row-menu"][data-widget-id="' + id + '"]' : "";
  }

  function widgetToast(message) {
    if (!widgetWindow || widgetWindow.isDestroyed() || !message) return;
    widgetWindow.webContents.send("today-widget:toast", { message: String(message) });
  }

  function notifyWidgetSurface(kind, extra) {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    widgetWindow.webContents.send("today-widget:surface", { open: Boolean(kind), kind: kind || "", ...extra });
  }

  function createSurfaceWindow() {
    if (surfaceWindow && !surfaceWindow.isDestroyed()) return surfaceWindow;
    surfaceWindow = new BrowserWindow({
      parent: widgetWindow,
      width: 320,
      height: 240,
      frame: false,
      acceptFirstMouse: true,
      transparent: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      // A panel shows over the app without activating it, so opening the widget
      // settings never raises the main window.
      type: process.platform === "darwin" ? "panel" : undefined,
      alwaysOnTop: preferences.alwaysOnTop,
      title: "浮窗面板",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    surfaceWindow.loadFile(path.join(__dirname, "..", "renderer", "widget-surface.html"));
    surfaceWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    surfaceWindow.on("show", () => {
      surfaceRingOutside = false;
      applySurfacePassthrough();
    });
    surfaceWindow.on("blur", () => {
      // Ignore only the synchronous opening transition. A timed grace period
      // also swallowed a user's first outside click immediately after opening.
      if (openingSurface || !surfacePayload || surfaceWindow.isFocused()) return;
      closeSurface("blur");
    });
    surfaceWindow.on("closed", () => {
      surfaceWindow = null;
      surfacePayload = null;
      surfaceRingOutside = false;
      notifyWidgetSurface("");
    });
    return surfaceWindow;
  }

  function sendSurfacePayload() {
    if (!surfaceWindow || surfaceWindow.isDestroyed() || !surfacePayload) return;
    surfaceWindow.webContents.send("widget-surface:payload", surfacePayload);
  }

  function openSurface(kind, taskId, anchor, panel) {
    if (surfaceBusy) return { success: false, code: "BUSY" };
    if (!SURFACE_KINDS.has(kind)) return { success: false, code: "INVALID_SURFACE" };
    if (!widgetWindow || widgetWindow.isDestroyed()) return { success: false, code: "NO_WIDGET" };
    const generation = ++surfaceGeneration;
    if (anchor && typeof anchor === "object") {
      const bounds = widgetWindow.getBounds();
      surfaceAnchor = {
        x: bounds.x + Number(anchor.x || 0),
        y: bounds.y + Number(anchor.y || 0),
        w: Number(anchor.w || 0),
        h: Number(anchor.h || 0),
      };
    }
    if (panel && typeof panel === "object") {
      const bounds = widgetWindow.getBounds();
      surfacePanel = {
        x: bounds.x + Number(panel.x || 0),
        y: bounds.y + Number(panel.y || 0),
        w: Number(panel.w || 0),
        h: Number(panel.h || 0),
      };
    }
    surfacePayload = surfacePayloadFor(kind, taskId);
    seedSurfaceContent(kind);
    const window = createSurfaceWindow();
    const bounds = surfaceBounds(kind, surfaceContent);
    window.setBounds(bounds, false);
    applyAlwaysOnTop();
    const reveal = () => {
      openingSurface = true;
      try { window.show(); window.focus(); applyAlwaysOnTop(); }
      finally { openingSurface = false; }
    };
    const before = window.webContents.isLoadingMainFrame() || !window.webContents.getURL();
    if (before) {
      window.webContents.once("did-finish-load", () => {
        if (generation !== surfaceGeneration || !surfacePayload) return;
        sendSurfacePayload();
        window.setBounds(surfaceBounds(kind, surfaceContent), false);
        reveal();
      });
    } else {
      sendSurfacePayload();
      reveal();
    }
    notifyWidgetSurface(kind, { taskId: String(taskId || "") });
    return { success: true };
  }

  function closeSurface(reason = "") {
    if (surfaceBusy) return { success: false, code: "BUSY" };
    const payload = surfacePayload;
    // Native blur and the widget's pointerdown may close the same panel. A
    // second close must never steal focus from the clicked destination.
    if (!payload) return { success: true };
    const generation = ++surfaceGeneration;
    if (!surfaceWindow || surfaceWindow.isDestroyed()) {
      surfacePayload = null;
      notifyWidgetSurface("", payload ? { returnFocus: surfaceReturnFocusSelector(payload.kind, payload.task?.id) } : undefined);
      return { success: true };
    }
    const restoreFocus = !["blur", "outside", "hide", "removed"].includes(reason);
    const returnFocus = restoreFocus ? surfaceReturnFocusSelector(payload.kind, payload.task?.id) : "";
    surfacePayload = null;
    surfaceWindow.hide();
    // Hiding the panel hands activation back to the widget window; the focus
    // target is only meaningful once that window is key again.
    if (restoreFocus && widgetWindow && !widgetWindow.isDestroyed() && preferences.visible) {
      widgetWindow.focus();
      setTimeout(() => { if (generation === surfaceGeneration) notifyWidgetSurface("", { returnFocus, reason }); }, 30);
    } else {
      notifyWidgetSurface("", { returnFocus, reason });
    }
    return { success: true };
  }

  async function handleSurfaceAction(payload) {
    const action = String(payload?.action || "");
    const taskId = normalizeTaskId(payload?.taskId);
    if (action === "preference") {
      const key = payload?.key;
      if (key === "widgetPinned") await updatePreferences({ alwaysOnTop: payload.value === true });
      else if (key === "widgetThrough") await updatePreferences({ clickThrough: payload.value === true });
      else if (key === "widgetLaunch") await updatePreferences({ launchWithApp: payload.value === true });
      if (surfacePayload) surfacePayload = surfacePayloadFor(surfacePayload.kind, surfacePayload.task?.id);
      sendSurfacePayload();
      return { success: true };
    }
    if (action === "place") {
      await updatePreferences({ position: WIDGET_POSITIONS.has(payload?.value) ? payload.value : "top-right" });
      if (surfacePayload) surfacePayload = surfacePayloadFor("settings", "");
      sendSurfacePayload();
      if (surfaceWindow && !surfaceWindow.isDestroyed()) surfaceWindow.setBounds(surfaceBounds("settings", surfaceContent), false);
      return { success: true };
    }
    if (action === "opacity") {
      await updatePreferences({ opacity: payload?.value });
      return { success: true };
    }
    if (action === "reset-frame") {
      await updatePreferences({ resetFrame: true });
      if (surfacePayload) surfacePayload = surfacePayloadFor("settings", "");
      sendSurfacePayload();
      return { success: true };
    }
    if (action === "hide") {
      closeSurface("hide");
      await hideWidget();
      return { success: true };
    }
    if (action === "promote" || action === "delete-quick") {
      const target = action === "promote" ? "promote" : "delete";
      const kind = surfacePayload?.task?.isQuick ? target : target;
      const nextId = taskId || surfacePayload?.task?.id || "";
      // Chained surfaces keep the Demo's trigger rect (mountSurface reuses the
      // same trigger for the promote panel and the confirm dialog).
      surfacePayload = surfacePayloadFor(kind, nextId);
      seedSurfaceContent(kind);
      if (surfaceWindow && !surfaceWindow.isDestroyed()) {
        surfaceWindow.setBounds(surfaceBounds(kind, surfaceContent), false);
      }
      sendSurfacePayload();
      notifyWidgetSurface(kind, { taskId: nextId });
      return { success: true };
    }
    const lane = surfacePayload?.task?.isQuick ? "quick" : "task";
    if (action === "open-record") {
      closeSurface("action");
      await showMainWindow(taskId);
      return { success: true };
    }
    if (action === "rename-record") {
      closeSurface("action");
      if (widgetWindow && !widgetWindow.isDestroyed() && taskId) widgetWindow.webContents.send("today-widget:begin-rename", { taskId });
      return { success: true };
    }
    if (action === "move-up" || action === "move-down") {
      const result = await requestMainMutation("today-widget:reorder-item", { taskId, lane, direction: action === "move-up" ? -1 : 1 });
      if (result?.success) { closeSurface("action"); widgetToast("顺序已同步"); }
      else if (result?.code === "BOUNDARY") widgetToast(action === "move-up" ? "已经是第一项" : "已经是最后一项");
      return result;
    }
    if (action === "to-today" || action === "to-quick") {
      const result = await requestMainMutation("today-widget:move-item", {
        taskId,
        sourceLane: lane,
        targetLane: action === "to-today" ? "task" : "quick",
        targetTaskId: "",
        position: "after",
      });
      if (result?.success) {
        closeSurface("action");
        widgetToast(action === "to-today" ? "已加入今日任务，原内容保留" : "已移到速记，原内容保留");
      }
      return result;
    }
    if (action === "promote-group") {
      const group = snapshot.groups.find((entry) => entry.id === normalizeTaskId(payload?.groupId));
      const result = await requestMainMutation("today-widget:promote-quick-capture", { taskId, groupId: normalizeTaskId(payload?.groupId) });
      if (result?.success) {
        closeSurface("action");
        widgetToast(group ? `已升级为任务并移入「${group.title}」` : "已升级为任务");
      }
      return result;
    }
    if (action === "confirm-delete") {
      const result = await requestMainMutation("today-widget:delete-quick-capture", { taskId });
      if (result?.success) {
        closeSurface("action");
        if (result?.success) widgetToast("速记已删除");
      }
      return result;
    }
    return { success: false, code: "UNKNOWN_ACTION" };
  }

  function registerIpc() {
    ipcMain.handle("today-widget:get-state", (event) => (isWidgetSender(event) || isMainWindowSender(event)
      ? { ...widgetState(), snapshot }
      : rejectUnknownSender("today-widget:get-state")));
    ipcMain.handle("today-widget:show", (event) => (isWidgetSender(event) || isMainWindowSender(event)
      ? showWidget()
      : rejectUnknownSender("today-widget:show")));
    ipcMain.handle("today-widget:hide", (event) => (isWidgetSender(event) || isMainWindowSender(event)
      ? hideWidget()
      : rejectUnknownSender("today-widget:hide")));
    ipcMain.handle("today-widget:set-preferences", (event, patch) => (isWidgetSender(event) || isMainWindowSender(event)
      ? updatePreferences(patch)
      : rejectUnknownSender("today-widget:set-preferences")));
    ipcMain.handle("today-widget:set-editing", (event, enabled) => {
      if (!isWidgetSender(event)) {
        return { success: false, editing: editingText };
      }
      editingText = enabled === true;
      applyAlwaysOnTop();
      return { success: true, editing: editingText };
    });
    ipcMain.handle("today-widget:resize", (event, size) => (isWidgetSender(event)
      ? resizeWidget(size)
      : rejectUnknownSender("today-widget:resize")));
    ipcMain.handle("today-widget:open-main", (event, taskId) => (isWidgetSender(event)
      ? showMainWindow(taskId)
      : rejectUnknownSender("today-widget:open-main")));
    ipcMain.handle("today-widget:complete-task", (event, taskId) => (isWidgetSender(event)
      ? requestCompletion(taskId)
      : rejectUnknownSender("today-widget:complete-task")));
    ipcMain.handle("today-widget:create-task", (event, payload) => {
      if (!isWidgetSender(event)) return rejectUnknownSender("today-widget:create-task");
      const raw = payload && typeof payload === "object" ? payload : {};
      const title = String(raw.title || "").trim().slice(0, 240);
      const description = String(raw.description || "").slice(0, 4000);
      if (!title) return { success: false, code: "INVALID_TITLE" };
      return requestMainMutation("today-widget:create-task", {
        title,
        description,
        addToToday: raw.addToToday === true,
      });
    });
    ipcMain.handle("today-widget:update-task-title", (event, payload) => {
      if (!isWidgetSender(event)) return rejectUnknownSender("today-widget:update-task-title");
      const raw = payload && typeof payload === "object" ? payload : {};
      const taskId = normalizeTaskId(raw.taskId);
      const title = String(raw.title || "").trim().slice(0, 240);
      if (!taskId) return { success: false, code: "TASK_NOT_FOUND" };
      if (!title) return { success: false, code: "INVALID_TITLE" };
      return requestMainMutation("today-widget:update-task-title", { taskId, title });
    });
    ipcMain.handle("today-widget:promote-quick-capture", (event, payload) => {
      if (!isWidgetSender(event)) return rejectUnknownSender("today-widget:promote-quick-capture");
      const raw = payload && typeof payload === "object" ? payload : {};
      const taskId = normalizeTaskId(raw.taskId);
      const groupId = normalizeTaskId(raw.groupId);
      if (!taskId) return { success: false, code: "TASK_NOT_FOUND" };
      if (!groupId) return { success: false, code: "GROUP_NOT_FOUND" };
      return requestMainMutation("today-widget:promote-quick-capture", { taskId, groupId });
    });
    ipcMain.handle("today-widget:delete-quick-capture", (event, payload) => {
      if (!isWidgetSender(event)) return rejectUnknownSender("today-widget:delete-quick-capture");
      const raw = payload && typeof payload === "object" ? payload : {};
      const taskId = normalizeTaskId(raw.taskId);
      if (!taskId) return { success: false, code: "TASK_NOT_FOUND" };
      return requestMainMutation("today-widget:delete-quick-capture", { taskId });
    });
    ipcMain.handle("today-widget:move-item", (event, payload) => {
      if (!isWidgetSender(event)) return rejectUnknownSender("today-widget:move-item");
      const raw = payload && typeof payload === "object" ? payload : {};
      const taskId = normalizeTaskId(raw.taskId);
      const sourceLane = raw.sourceLane === "task" || raw.sourceLane === "quick" ? raw.sourceLane : "";
      const targetLane = raw.targetLane === "task" || raw.targetLane === "quick" ? raw.targetLane : "";
      const targetTaskId = normalizeTaskId(raw.targetTaskId);
      const position = raw.position === "before" || raw.position === "after" ? raw.position : "";
      if (!taskId) return { success: false, code: "TASK_NOT_FOUND" };
      if (!sourceLane || !targetLane) return { success: false, code: "INVALID_LANE" };
      if (!position) return { success: false, code: "INVALID_POSITION" };
      return requestMainMutation("today-widget:move-item", {
        taskId,
        sourceLane,
        targetLane,
        targetTaskId,
        position,
      });
    });
    ipcMain.handle("today-widget:reorder-item", (event, payload) => {
      if (!isWidgetSender(event)) return rejectUnknownSender("today-widget:reorder-item");
      const raw = payload && typeof payload === "object" ? payload : {};
      const taskId = normalizeTaskId(raw.taskId);
      const lane = raw.lane === "task" || raw.lane === "quick" ? raw.lane : "";
      const direction = Number(raw.direction);
      if (!taskId) return { success: false, code: "TASK_NOT_FOUND" };
      if (!lane) return { success: false, code: "INVALID_LANE" };
      if (direction !== -1 && direction !== 1) return { success: false, code: "INVALID_DIRECTION" };
      return requestMainMutation("today-widget:reorder-item", { taskId, lane, direction });
    });
    ipcMain.handle("today-widget:fit", (event, size) => {
      if (!isWidgetSender(event)) return rejectUnknownSender("today-widget:fit");
      applyContentSize(size);
      if (firstFitPending) revealWidgetWindow();
      return { success: true, content: currentContent };
    });
    ipcMain.handle("today-widget:nudge", (event, delta) => {
      if (!isWidgetSender(event)) return rejectUnknownSender("today-widget:nudge");
      if (!widgetWindow || widgetWindow.isDestroyed()) return { success: false };
      const dx = Math.max(-80, Math.min(80, Math.round(Number(delta?.dx) || 0)));
      const dy = Math.max(-80, Math.min(80, Math.round(Number(delta?.dy) || 0)));
      const bounds = widgetWindow.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const x = Math.max(area.x, Math.min(area.x + area.width - bounds.width, bounds.x + dx));
      const y = Math.max(area.y, Math.min(area.y + area.height - bounds.height, bounds.y + dy));
      preferences = normalizeTodayWidgetPreferences({ ...preferences, position: "custom", customBounds: { x, y } });
      preferences = { ...preferences, frameAnchor: frameAnchorForPosition("custom", area, { x, y, width: bounds.width, height: bounds.height }) };
      suppressMoveUntil = Date.now() + 350;
      widgetWindow.setBounds({ ...bounds, x, y }, false);
      clearTimeout(moveSaveTimer);
      moveSaveTimer = setTimeout(() => {
        void persistPreferences();
        broadcastState();
      }, 180);
      return { success: true, bounds: { x, y } };
    });
    ipcMain.handle("today-widget:ring", (event, payload) => {
      const inside = payload?.inside === true;
      if (isWidgetSender(event)) return applyRingRegion("widget", inside);
      if (isSurfaceSender(event)) return applyRingRegion("surface", inside);
      return rejectUnknownSender("today-widget:ring");
    });
    ipcMain.handle("today-widget:open-surface", (event, payload) => {
      if (!isWidgetSender(event)) return rejectUnknownSender("today-widget:open-surface");
      const raw = payload && typeof payload === "object" ? payload : {};
      return openSurface(String(raw.kind || ""), normalizeTaskId(raw.taskId), raw.anchor, raw.panel);
    });
    ipcMain.handle("today-widget:close-surface", (event, payload) => {
      if (!isWidgetSender(event)) return rejectUnknownSender("today-widget:close-surface");
      return closeSurface(String(payload?.reason || ""));
    });
    ipcMain.handle("widget-surface:get", (event) => (isSurfaceSender(event) ? surfacePayload : rejectUnknownSender("widget-surface:get")));
    ipcMain.handle("widget-surface:fit", (event, size) => {
      if (!isSurfaceSender(event)) return rejectUnknownSender("widget-surface:fit");
      if (!surfaceWindow || surfaceWindow.isDestroyed() || !surfacePayload) return { success: false };
      surfaceContent = {
        width: Math.max(120, Math.round(Number(size?.width) || surfaceContent.width)),
        height: Math.max(60, Math.round(Number(size?.height) || surfaceContent.height)),
      };
      surfaceWindow.setBounds(surfaceBounds(surfacePayload.kind, surfaceContent), false);
      return { success: true };
    });
    ipcMain.handle("widget-surface:act", async (event, payload) => {
      if (!isSurfaceSender(event)) return rejectUnknownSender("widget-surface:act");
      if (surfaceBusy) return { success: false, code: "BUSY" };
      const mutation = ["move-up", "move-down", "to-today", "to-quick", "promote-group", "confirm-delete"].includes(payload?.action);
      if (!mutation) return handleSurfaceAction(payload);
      surfaceBusy = true;
      try {
        const result = await handleSurfaceAction(payload);
        surfaceBusy = false;
        if (result?.success) closeSurface("action");
        return result;
      } finally { surfaceBusy = false; }
    });
    ipcMain.handle("widget-surface:close", (event, payload) => {
      if (!isSurfaceSender(event)) return rejectUnknownSender("widget-surface:close");
      return closeSurface(String(payload?.reason || ""));
    });
    ipcMain.on("today-widget:publish", (event, value) => {
      if (isMainWindowSender(event)) publishSnapshot(value);
    });
    ipcMain.on("today-widget:complete-result", resolveCompletion);
    ipcMain.on("today-widget:mutation-result", resolveMutation);
  }

  async function start() {
    preferences = await readTodayWidgetPreferences(app.getPath("userData"));
    currentContent = preferences.compact
      ? { width: WIDGET_WIDTHS.compact, height: 48 }
      : { width: WIDGET_WIDTHS.expanded, height: preferences.autoHeight ? DEFAULT_PREFERENCES.height : preferences.height };
    currentSize = windowSizeForContent(currentContent);
    if (preferences.launchWithApp && preferences.visible) createWidgetWindow();
    if (globalShortcut?.register) {
      const registered = globalShortcut.register(CLICK_THROUGH_ACCELERATOR, () => {
        void toggleClickThrough();
      });
      if (!registered) console.warn(`Failed to register ${CLICK_THROUGH_ACCELERATOR} for Today widget.`);
    }
    screen.on("display-added", positionWidget);
    screen.on("display-removed", positionWidget);
    screen.on("display-metrics-changed", positionWidget);
    broadcastState();
  }

  function stop() {
    clearTimeout(moveSaveTimer);
    clearTimeout(resizeSaveTimer);
    screen.removeListener("display-added", positionWidget);
    screen.removeListener("display-removed", positionWidget);
    screen.removeListener("display-metrics-changed", positionWidget);
    globalShortcut?.unregister?.(CLICK_THROUGH_ACCELERATOR);
    pendingCompletions.forEach(({ resolve, timer }) => {
      clearTimeout(timer);
      resolve({ success: false, code: "APP_QUITTING" });
    });
    pendingCompletions.clear();
    pendingMutations.forEach(({ resolve, timer }) => {
      clearTimeout(timer);
      resolve({ success: false, code: "APP_QUITTING" });
    });
    pendingMutations.clear();
    clearTimeout(showFallbackTimer);
    if (surfaceWindow && !surfaceWindow.isDestroyed()) surfaceWindow.destroy();
    surfaceWindow = null;
    surfacePayload = null;
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.destroy();
    widgetWindow = null;
  }

  return { applyAlwaysOnTop, registerIpc, restoreAlwaysOnTopAfterAppDeactivation, start, stop };
}

function normalizeTaskId(value) {
  const taskId = String(value || "");
  return /^[A-Za-z0-9_-]{1,160}$/.test(taskId) ? taskId : "";
}

function normalizeSnapshot(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    date: String(raw.date || "").slice(0, 32),
    // Phase18: how much of today is already finished decides the widget's empty
    // copy ("今日任务已完成" instead of "暂无今日任务").
    completedToday: Math.max(0, Math.floor(Number(raw.completedToday) || 0)),
    // the Demo marks the row open in the main window with .current
    activeTaskId: normalizeTaskId(raw.activeTaskId),
    appearance: normalizeTodayWidgetAppearance(raw.appearance),
    items: (Array.isArray(raw.items) ? raw.items : []).map((item) => ({
      taskId: normalizeTaskId(item?.taskId),
      title: String(item?.title || "未命名任务").slice(0, 240),
      // An empty next step is meaningful: the Demo renders the line only when the
      // record actually has one, which is what decides the row height.
      nextText: String(item?.nextText || "").slice(0, 500),
      kind: ["normal", "high", "blocked"].includes(item?.kind) ? item.kind : "normal",
    })).filter((item) => item.taskId),
    quickCaptures: (Array.isArray(raw.quickCaptures) ? raw.quickCaptures : []).map((item) => ({
      taskId: normalizeTaskId(item?.taskId),
      title: String(item?.title || "未命名速记").slice(0, 240),
      description: String(item?.description || "").slice(0, 500),
      createdAt: String(item?.createdAt || "").slice(0, 40),
      updatedAt: String(item?.updatedAt || "").slice(0, 40),
      resolvedAt: String(item?.resolvedAt || "").slice(0, 40),
      status: item?.status === "done" ? "done" : "active",
    })).filter((item) => item.taskId),
    quickCaptureTotal: Math.max(0, Math.round(Number(raw.quickCaptureTotal) || 0)),
    groups: (Array.isArray(raw.groups) ? raw.groups : []).map((group) => ({
      id: normalizeTaskId(group?.id),
      title: String(group?.title || "未命名分组").trim().slice(0, 120),
    })).filter((group) => group.id && group.title),
  };
}

function normalizeTodayWidgetAppearance(value) {
  const raw = value && typeof value === "object" ? value : {};
  const fontSize = Number(raw.fontSize);
  // The phase-12/13 widget layers size themselves with --font-scale, the same
  // variable the main window uses; the renderer sends it and it must survive
  // this whitelist or the widget would render at 1.0 while the app renders at 1.08.
  const fontScale = Number(raw.fontScale);
  return {
    theme: raw.theme === "dark" ? "dark" : "light",
    zhFont: WIDGET_ZH_FONTS.has(raw.zhFont) ? raw.zhFont : "heiti",
    enFont: WIDGET_EN_FONTS.has(raw.enFont) ? raw.enFont : "times",
    fontSize: Number.isFinite(fontSize) ? Math.max(12, Math.min(24, fontSize)) : 16.5,
    fontScale: Number.isFinite(fontScale) ? Math.max(0.8, Math.min(1.6, fontScale)) : 1,
    // The main window composes the `--sans` stack from the font preferences
    // (shell.js applyShellAppearance). The widget window must resolve the same
    // families, so it receives the composed stack instead of duplicating the
    // family tables. Only CSS-safe characters survive this whitelist.
    sans: normalizeFontStack(raw.sans),
  };
}

function normalizeFontStack(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 400) return "";
  return /^[A-Za-z0-9\s,"'\-_.()]+$/.test(text) ? text : "";
}

module.exports = {
  DEFAULT_PREFERENCES,
  applyTodayWidgetTopmost,
  cornerWindowBounds,
  createTodayWidgetController,
  resizedWidgetBounds,
  normalizeTodayWidgetPreferences,
  normalizeTodayWidgetAppearance,
  normalizeFrameAnchor,
  normalizeSnapshot,
  windowSizeForContent,
  readTodayWidgetPreferences,
  writeTodayWidgetPreferences,
};

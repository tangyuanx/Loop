/**
 * Loop -- Electron main process
 *
 * Responsibilities:
 *   - Create and manage the BrowserWindow
 *   - Register IPC handlers (storage, clipboard, PDF export)
 *   - Handle external URL navigation
 *   - Manage application menu
 */

const { app, BrowserWindow, Menu, Notification, clipboard, dialog, globalShortcut, ipcMain, net, screen, shell } = require("electron");

// Match the bundled Chinese outlines with grayscale coverage on Windows.
// LCD color fringes make the dense CJK strokes look heavier than on macOS;
// the shared font and coverage policy must be validated together.
// Keep display DPI and GPU acceleration under native control.
if (process.platform === "win32") app.commandLine.appendSwitch("disable-lcd-text");

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { autoUpdater } = require("electron-updater");
const { BugReportClientError, createBugReportClient } = require("./bug-report-client.cjs");
const { dataFilePath, readTaskData, writeTaskData } = require("./storage.cjs");
const { assetSourcePaths, createKnowledgePathGate, deniedPathResult } = require("./knowledge-access.cjs");
const dataMaintenance = require("./data-maintenance.cjs");
const {
  chooseKnowledgeDocument,
  readKnowledgeDocument,
  saveKnowledgeDocument,
} = require("./knowledge-file.cjs");
const { createKnowledgeFileWatcher } = require("./knowledge-watcher.cjs");
const { stageKnowledgeAssets } = require("./knowledge-assets.cjs");
const { noteDocumentHtml, readyNoteDocument } = require("./knowledge-export.cjs");
const {
  deleteKnowledgeRecovery,
  readKnowledgeRecovery,
  writeKnowledgeRecovery,
} = require("./recovery.cjs");
const { createTodayWidgetController } = require("./today-widget.cjs");
const { createDeadlineReminderController } = require("./deadline-reminders.cjs");
const { createUpdateController } = require("./updater.cjs");
const { APP_DISPLAY_NAME, DESKTOP_APP_ID, configureDesktopIdentity } = require("./app-identity.cjs");
const { createPointerContinuity } = require("./pointer-continuity.cjs");
const {
  createPreInstallBackup,
  exportPortableBackup,
  importBackup,
  recoverLegacyUserData,
} = require("./data-continuity.cjs");

const desktopIdentity = configureDesktopIdentity(app);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});
/**
 * Create the main application window.
 * Sets up preload, CSP, and external link handling.
 */

const isMac = process.platform === "darwin";

/**
 * Phase25 -- integrated title bar.
 *
 * The application header is one 48px row that also owns the window controls, so
 * the platform's own controls are kept and only the separate title strip is
 * removed. `titleBarStyle: "hidden"` keeps the native frame capabilities (resize
 * edges, shadow/rounded corners, system menu, Snap and full screen); macOS keeps
 * its traffic lights at a calibrated position and Windows/Linux keep the
 * window-controls overlay at the header's height.
 */
const HEADER_HEIGHT = 48;
const WINDOW_HEADER_THEMES = {
  light: { color: "#ffffff", symbolColor: "#20242b" },
  dark: { color: "#17191d", symbolColor: "#e7e9ed" },
};
// Calibrated against the frozen Demo's Mac identity (probe/phase25/
// calibrate-traffic.cjs, measured on the real window image): macOS draws 14px
// controls at its own 23px centre spacing, so only the group origin is ours to
// choose. x=9 puts the close control's centre at 15.5px, exactly the Demo mock's
// centre, and y=17 puts it at 23.5px, the centre of the 47px content row. The
// remaining 2px size and 6px spacing of the last control are macOS's own drawing
// and cannot be changed from Electron (see the phase25 report).
const MAC_TRAFFIC_LIGHT_POSITION = { x: 9, y: 17 };
const WINDOW_STATE_EVENTS = [
  "maximize",
  "unmaximize",
  "enter-full-screen",
  "leave-full-screen",
  "focus",
  "blur",
  "minimize",
  "restore",
];
let updateController = null;
let todayWidgetController = null;
let deadlineReminderController = null;
let mainWindow = null;
let pointerContinuity = null;
let isQuitting = false;
let updateInstallPrepared = false;
let recoveryShutdownWaitingFor = null;
let recoveryShutdownTimer = null;
const RECOVERY_SHUTDOWN_TIMEOUT_MS = 2000;
let updateInstallPreparation = null;
const UPDATE_INSTALL_PREPARATION_TIMEOUT_MS = 10_000;
const knowledgeWatcher = createKnowledgeFileWatcher({
  onChange: (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("knowledge-file:changed", event);
  },
});

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: APP_DISPLAY_NAME,
    backgroundColor: "#ffffff",
    show: false,
    autoHideMenuBar: true,
    ...windowChromeOptions(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  pointerContinuity?.attach(window);
  // The renderer mirrors real window state (active / maximized / full screen)
  // instead of tracking its own clicks, so every platform event is forwarded.
  for (const eventName of WINDOW_STATE_EVENTS) window.on(eventName, () => publishWindowState(window));
/**
 * Open external URLs (http/https/mailto) in the system browser.
 * @param {string} url - URL to open
 */

  window.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  window.once("ready-to-show", () => window.show());
/**
 * Register all IPC handlers for storage, clipboard, and export.
 */

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });
  window.on("closed", () => {
    if (mainWindow !== window) return;
    mainWindow = null;
    knowledgeWatcher.closeAll();
    if (!isQuitting && !updateInstallPrepared) app.quit();
  });
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    app.quit();
  });
  return window;
}

/** Native window chrome for the Phase25 integrated header. */
function windowChromeOptions() {
  const options = { titleBarStyle: "hidden" };
  if (isMac) options.trafficLightPosition = { ...MAC_TRAFFIC_LIGHT_POSITION };
  else options.titleBarOverlay = { ...WINDOW_HEADER_THEMES.light, height: HEADER_HEIGHT };
  return options;
}

function windowStateOf(win) {
  return {
    focused: win.isFocused(),
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen(),
    minimized: win.isMinimized(),
  };
}

function publishWindowState(win) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send("window-controls:state", windowStateOf(win));
}

function normalizeHexColor(value) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : "";
}

/**
 * Phase25 window chrome bridge: read-only state plus the overlay colours.
 * The window controls themselves stay native, so this exposes no window action;
 * every request is bound to the main window's own webContents.
 */
function registerWindowChromeHandlers() {
  const senderWindow = (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && win === mainWindow && !win.isDestroyed() ? win : null;
  };
  ipcMain.handle("window-controls:get-state", (event) => {
    const win = senderWindow(event);
    return win ? windowStateOf(win) : null;
  });
  ipcMain.handle("window-controls:set-chrome-colors", (event, payload) => {
    const win = senderWindow(event);
    if (!win) return { success: false, code: "UNKNOWN_WINDOW" };
    if (isMac) return { success: false, code: "NO_NATIVE_OVERLAY" };
    const color = normalizeHexColor(payload?.background);
    const symbolColor = normalizeHexColor(payload?.symbol);
    const height = Number(payload?.height);
    if (!color || !symbolColor || !Number.isInteger(height) || height < 24 || height > 120) {
      return { success: false, code: "INVALID_CHROME" };
    }
    try {
      win.setTitleBarOverlay({ color, symbolColor, height });
    } catch (error) {
      return { success: false, code: "OVERLAY_UNAVAILABLE" };
    }
    return { success: true };
  });
}

function openExternalUrl(url) {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
}

function finishRecoveryShutdown() {
  if (recoveryShutdownTimer) clearTimeout(recoveryShutdownTimer);
  recoveryShutdownTimer = null;
  recoveryShutdownWaitingFor = null;
  isQuitting = true;
  app.quit();
}

function requestRecoveryShutdown(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  event.preventDefault();
  if (recoveryShutdownWaitingFor !== null) return true;
  recoveryShutdownWaitingFor = mainWindow.webContents.id;
  mainWindow.webContents.send("knowledge-recovery:flush-and-quit");
  recoveryShutdownTimer = setTimeout(finishRecoveryShutdown, RECOVERY_SHUTDOWN_TIMEOUT_MS);
  return true;
}

async function stopRuntimeForUpdateInstall() {
  knowledgeWatcher.closeAll();
  updateController?.stop();
  todayWidgetController?.stop();
  await deadlineReminderController?.stop();
}

async function finishUpdateInstallPreparation(success) {
  if (!updateInstallPreparation) return;
  if (updateInstallPreparation.finalizing) return;
  updateInstallPreparation.finalizing = true;
  const { resolve, timer } = updateInstallPreparation;
  clearTimeout(timer);
  if (!success) {
    updateInstallPreparation = null;
    resolve(false);
    return;
  }
  try {
    await createPreInstallBackup({
      appDataPath: app.getPath("appData"),
      userDataPath: app.getPath("userData"),
      installDirectory: path.dirname(process.execPath),
      currentVersion: app.getVersion(),
      targetVersion: updateController?.getState()?.version,
    });
    // Stop auxiliary windows, shortcuts, watchers, and timers before the
    // updater launches NSIS. This shortens the interval in which a Loop child
    // process can keep the previous installation directory locked.
    await stopRuntimeForUpdateInstall();
    // `quitAndInstall` closes windows before `before-quit`, so the renderer and
    // the verified byte-level backup are both complete before this flag is set.
    updateInstallPrepared = true;
    resolve(true);
  } catch (error) {
    console.error("Unable to create a verified pre-upgrade data backup.", error?.code || error);
    resolve(false);
  } finally {
    updateInstallPreparation = null;
  }
}

function requestUpdateInstallPreparation() {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(true);
  if (updateInstallPreparation) return updateInstallPreparation.promise;
  const senderId = mainWindow.webContents.id;
  let resolvePreparation;
  const promise = new Promise((resolve) => {
    resolvePreparation = resolve;
  });
  const timer = setTimeout(() => void finishUpdateInstallPreparation(false), UPDATE_INSTALL_PREPARATION_TIMEOUT_MS);
  updateInstallPreparation = { promise, resolve: resolvePreparation, senderId, timer, finalizing: false };
  mainWindow.webContents.send("app-update:prepare-install");
  return promise;
}

function registerStorageHandlers() {
  const knowledgeGate = createKnowledgePathGate({
    userDataPath: app.getPath("userData"),
    dataFilePath: dataFilePath(app.getPath("userData")),
  });
  ipcMain.on("app:version", (event) => {
    event.returnValue = app.getVersion();
  });
  ipcMain.on("app:environment", (event) => {
    event.returnValue = {
      os: `${platformName(process.platform)} ${os.release()}`,
      architecture: process.arch,
    };
  });
  ipcMain.handle("task-data:read", () => readTaskData(app.getPath("userData")));
/**
 * Export a task document as Markdown or PDF.
 * Shows a save dialog, renders PDF with a hidden BrowserWindow if needed.
 * @param {object} payload - { taskTitle, markdown?, html? }
 * @returns {Promise<{ canceled: boolean, filePath?: string }>}
 */
  ipcMain.handle("task-data:write", (_event, data) => {
    dataMaintenance.assertWritable();
    return writeTaskData(app.getPath("userData"), data);
  });
  ipcMain.handle("data-backup:export", async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
    const selection = await dialog.showSaveDialog(parent, {
      title: "导出 Loop 完整数据备份",
      defaultPath: path.join(app.getPath("documents"), `Loop-backup-${stamp}.loopbackup`),
      filters: [{ name: "Loop 完整备份", extensions: ["loopbackup"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const result = await exportPortableBackup({
      userDataPath: app.getPath("userData"),
      destinationPath: selection.filePath,
      appVersion: app.getVersion(),
    });
    return { canceled: false, ...result };
  });
  ipcMain.handle("data-backup:import", async (event, value) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const selectionType = value?.selectionType === "directory" ? "directory" : "file";
    const selection = await dialog.showOpenDialog(parent, selectionType === "directory" ? {
      title: "选择 Loop 备份目录",
      properties: ["openDirectory"],
    } : {
      title: "选择 Loop 完整备份文件",
      properties: ["openFile"],
      filters: [{ name: "Loop 完整备份", extensions: ["loopbackup"] }],
    });
    const selectedPath = selection.filePaths?.[0];
    if (selection.canceled || !selectedPath) return { canceled: true };
    const confirmation = await dialog.showMessageBox(parent, {
      type: "warning",
      buttons: ["取消", "备份当前数据并导入"],
      defaultId: 0,
      cancelId: 0,
      title: "确认恢复数据",
      message: "导入会将当前工作区替换为所选备份。",
      detail: "Loop 会先完整备份并校验当前数据；导入失败时会自动回滚。成功后应用将重新启动。",
      noLink: true,
    });
    if (confirmation.response !== 1) return { canceled: true };
    // From here on the managed data files are replaced in place. Block renderer
    // writes for the whole operation and keep them blocked until the relaunch,
    // so no late autosave can overwrite the restored database.
    dataMaintenance.begin("manual-import");
    let result;
    try {
      result = await importBackup({
        selectedPath,
        selectionType,
        appDataPath: app.getPath("appData"),
        userDataPath: app.getPath("userData"),
        installDirectory: process.platform === "win32" ? path.dirname(process.execPath) : "",
      });
    } catch (error) {
      // A failed rollback leaves a partial workspace. Keep every writer locked
      // until the user can recover the verified safety copy.
      if (error?.code !== "IMPORT_ROLLBACK_FAILED") dataMaintenance.end();
      throw error;
    }
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 350).unref?.();
    return { canceled: false, restartScheduled: true, ...result };
  });
  ipcMain.handle("knowledge-document:save", async (event, payload) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    // A save without a path, or an explicit "save as", is decided by a native
    // dialog. Every other write must name a path the user already bound.
    const usesDialog = !payload?.filePath || payload?.saveAs === true;
    if (!usesDialog && !(await knowledgeGate.isAllowed(payload.filePath))) {
      return deniedPathResult(payload?.filePath, "save");
    }
    const blockedAsset = assetSourcePaths(payload).find(
      (sourcePath) => !knowledgeGate.isRecoveryAssetPath(sourcePath),
    );
    if (blockedAsset) return deniedPathResult(blockedAsset, "asset");
    const result = await saveKnowledgeDocument(payload, { dialog, parent, platform: process.platform });
    if (result?.success && result.filePath) knowledgeGate.approve(result.filePath);
    if (result?.success && payload?.noteId) knowledgeWatcher.updateBaseline(payload.noteId, result);
    return result;
  });
  ipcMain.handle("knowledge-document:stage-assets", (_event, payload) => stageKnowledgeAssets(
    app.getPath("userData"),
    payload,
  ));
  ipcMain.handle("knowledge-document:read", async (_event, payload) => {
    if (!(await knowledgeGate.isAllowed(payload?.filePath))) return deniedPathResult(payload?.filePath, "read");
    return readKnowledgeDocument(payload?.filePath);
  });
  ipcMain.handle("knowledge-document:choose", async (event, payload) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = await chooseKnowledgeDocument({
      dialog,
      parent,
      boundPaths: payload?.boundPaths,
      platform: process.platform,
      purpose: payload?.purpose,
    });
    if (result?.success && result.filePath) knowledgeGate.approve(result.filePath);
    return result;
  });
  ipcMain.handle("knowledge-document:watch", async (_event, payload) => {
    if (!(await knowledgeGate.isAllowed(payload?.filePath))) {
      return {
        success: false,
        code: "PATH_NOT_ALLOWED",
        noteId: payload?.noteId,
        message: "该文件未绑定到任何任务的 Markdown 笔记，已阻止监听。",
      };
    }
    return knowledgeWatcher.watch(payload);
  });
  ipcMain.handle("knowledge-document:unwatch", (_event, payload) => knowledgeWatcher.unwatch(payload?.noteId));
  ipcMain.handle("knowledge-document:update-baseline", (_event, payload) => knowledgeWatcher.updateBaseline(payload?.noteId, payload));
  ipcMain.handle("knowledge-recovery:read", () => readKnowledgeRecovery(app.getPath("userData")));
  ipcMain.handle("knowledge-recovery:write", (_event, record) => {
    dataMaintenance.assertWritable();
    return writeKnowledgeRecovery(app.getPath("userData"), record);
  });
  ipcMain.handle("knowledge-recovery:delete", (_event, noteId) => {
    dataMaintenance.assertWritable();
    return deleteKnowledgeRecovery(app.getPath("userData"), noteId);
  });
  ipcMain.on("knowledge-recovery:flush-complete", (event) => {
    if (event.sender.id !== recoveryShutdownWaitingFor) return;
    finishRecoveryShutdown();
  });
  ipcMain.on("app-update:prepare-install-complete", (event, success) => {
    if (event.sender.id !== updateInstallPreparation?.senderId) return;
    void finishUpdateInstallPreparation(success === true);
  });
  ipcMain.handle("app:reveal-main", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { success: false };
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return { success: true };
  });

  ipcMain.handle("app:confirm-destructive", async (event, value) => {
    const reloadKnowledge = value?.operation === "reload-knowledge";
    const message = reloadKnowledge
      ? "将放弃当前未保存的修改，并读取磁盘上的最新内容。此操作不会删除笔记或文件。"
      : String(value?.message || "确定删除所选内容？").slice(0, 500);
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options = {
      type: "warning",
      buttons: ["取消", reloadKnowledge ? "放弃修改并重新加载" : "删除"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: reloadKnowledge ? "重新加载笔记" : "确认删除",
      message,
    };
    const result = parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    return result.response === 1;
  });
  ipcMain.handle("clipboard:read-image-data-url", () => {
    const image = clipboard.readImage();
    return image.isEmpty() ? "" : image.toDataURL();
  });
  ipcMain.on("clipboard:read-image-data-url-sync", (event) => {
    const image = clipboard.readImage();
    event.returnValue = image.isEmpty() ? "" : image.toDataURL();
  });
  ipcMain.handle("node-detail:export-pdf", async (_event, payload) => exportNodeDetailPdf(payload));
  ipcMain.handle("task:export-document", async (_event, payload) => exportTaskDocument(payload));
  ipcMain.handle("bug-report:submit", async (_event, payload) => {
    try {
      const baseUrl = process.env.BUG_REPORT_API_URL || (app.isPackaged ? "" : "http://127.0.0.1:3000");
      return await createBugReportClient({ baseUrl }).submit(payload);
    } catch (error) {
      const safeError = error instanceof BugReportClientError
        ? error
        : new BugReportClientError("REQUEST_FAILED", "反馈提交失败，请稍后重试");
      return { success: false, code: safeError.code, message: safeError.message };
    }
  });
}

function platformName(platform) {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return "Unknown OS";
}

async function exportTaskDocument(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const taskTitle = String(safePayload.taskTitle || "未命名任务").trim() || "未命名任务";
  const format = ["md", "html", "pdf"].includes(safePayload.format) ? safePayload.format : "";
  const formats = {
    md: { name: "Markdown", extensions: ["md"] },
    html: { name: "HTML", extensions: ["html"] },
    pdf: { name: "PDF", extensions: ["pdf"] },
  };
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: safePayload.documentKind === "note" ? "导出笔记" : "导出任务",
    defaultPath: `${sanitizeFileName(taskTitle)}.${format || "md"}`,
    filters: format ? [formats[format]] : [formats.md, formats.pdf],
  });
  if (canceled || !filePath) return { canceled: true };
  const exportPath = format && !filePath.toLowerCase().endsWith(`.${format}`) ? `${filePath}.${format}` : filePath;

/**
 * Export a single node detail as PDF.
 * Opens a hidden BrowserWindow, renders HTML, prints to PDF.
 * @param {object} payload - { nodeTitle, taskTitle, status, updatedAt, html }
 * @returns {Promise<{ canceled: boolean, filePath?: string }>}
 */
  if (format === "pdf" || (!format && exportPath.toLowerCase().endsWith(".pdf"))) {
    const window = new BrowserWindow({
      width: 900,
      height: 1200,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    try {
      const html = await (safePayload.documentKind === "note" ? noteDocumentHtml : taskDocumentPdfHtml)({
        taskTitle,
        bodyHtml: String(safePayload.html || ""),
      });
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      if (safePayload.documentKind === "note") {
        await window.webContents.executeJavaScript(`(${readyNoteDocument.toString()})()`);
      }
      const pdf = await window.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
        ...(safePayload.documentKind === "note" ? { preferCSSPageSize: true, margins: {top:0,bottom:0,left:0,right:0} } : { margins: { marginType: "custom", top: 0.48, bottom: 0.48, left: 0.52, right: 0.52 } }),
      });
      await fs.writeFile(exportPath, pdf);
      return { canceled: false, filePath: exportPath };
    } finally {
      window.destroy();
    }
  }

  if (format === "html") {
    const html = await (safePayload.documentKind === "note" ? noteDocumentHtml : taskDocumentPdfHtml)({ taskTitle, bodyHtml: String(safePayload.html || "") });
    if (safePayload.documentKind === "note") {
      const preview = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
      try {
        await preview.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        await preview.webContents.executeJavaScript(`(${readyNoteDocument.toString()})({print:false})`);
      } finally { preview.destroy(); }
    }
    await fs.writeFile(exportPath, html, "utf8");
    return { canceled: false, filePath: exportPath };
  }
  const markdownPath = exportPath.toLowerCase().endsWith(".md") ? exportPath : `${exportPath}.md`;
  await fs.writeFile(markdownPath, String(safePayload.markdown || ""), "utf8");
  return { canceled: false, filePath: markdownPath };
}

/**
 * Generate HTML template for node detail PDF.
 * @param {object} params - { taskTitle, nodeTitle, status, updatedAt, bodyHtml }
 * @returns {string} Complete HTML document
 */
async function exportNodeDetailPdf(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const nodeTitle = String(safePayload.nodeTitle || "未命名节点").trim() || "未命名节点";
  const taskTitle = String(safePayload.taskTitle || "未命名任务").trim() || "未命名任务";
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "导出节点详情",
    defaultPath: `${sanitizeFileName(nodeTitle)}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return { canceled: true };

  const window = new BrowserWindow({
    width: 900,
    height: 1200,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    const html = nodeDetailPdfHtml({
      taskTitle,
      nodeTitle,
      status: String(safePayload.status || ""),
      updatedAt: String(safePayload.updatedAt || ""),
      bodyHtml: String(safePayload.html || ""),
    });
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { marginType: "custom", top: 0.48, bottom: 0.48, left: 0.52, right: 0.52 },
    });
    await fs.writeFile(filePath, pdf);
    return { canceled: false, filePath };
  } finally {
    window.destroy();
  }
}

/**
 * Generate HTML template for task document PDF.
 * @param {object} params - { taskTitle, bodyHtml }
 * @returns {string} Complete HTML document
 */
function nodeDetailPdfHtml({ taskTitle, nodeTitle, status, updatedAt, bodyHtml }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" />
  <style>
    :root { color: #24221f; font-family: Inter, "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
    body { margin: 0; padding: 34px 38px; background: #ffffff; }
    header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #ddd8cf; }
    .kicker { margin: 0 0 7px; color: #83796c; font-size: 12px; letter-spacing: 0; }
    h1 { margin: 0; color: #171512; font-size: 25px; line-height: 1.25; }
    .meta { display: flex; gap: 12px; margin-top: 10px; color: #6f665b; font-size: 12px; }
    main { font-size: 14px; line-height: 1.7; }
    h1, h2, h3, h4, h5, h6 { color: #171512; page-break-after: avoid; }
    h2 { margin-top: 22px; font-size: 20px; }
    h3 { margin-top: 18px; font-size: 17px; }
    p, ul, ol, blockquote, pre, table, img { margin: 0 0 13px; }
    a { color: #b4232f; text-decoration: none; }
    blockquote { padding: 10px 13px; border-left: 3px solid #b4232f; color: #62594f; background: #faf7f2; }
    code { padding: 1px 5px; border: 1px solid #e4ded4; border-radius: 5px; background: #f7f4ee; font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.92em; }
    pre { overflow-wrap: anywhere; padding: 12px; border: 1px solid #e4ded4; border-radius: 8px; background: #f7f4ee; white-space: pre-wrap; }
    pre code { padding: 0; border: 0; background: transparent; }
    img { display: block; max-width: 100%; border: 1px solid #e4ded4; border-radius: 6px; page-break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 7px 8px; border: 1px solid #e4ded4; text-align: left; vertical-align: top; }
    th { background: #f8f5ef; }
    hr { border: 0; border-top: 1px solid #e4ded4; margin: 18px 0; }
    .md-task { display: inline-flex; gap: 8px; align-items: flex-start; }
    .markdown-empty { color: #83796c; }
  </style>
</head>
<body>
  <header>
    <p class="kicker">${escapeHtml(taskTitle)}</p>
    <h1>${escapeHtml(nodeTitle)}</h1>
    <div class="meta"><span>${escapeHtml(status)}</span><span>${escapeHtml(updatedAt)}</span></div>
  </header>
  <main>${bodyHtml}</main>
</body>
</html>`;
}

/**
 * Sanitize a filename by removing invalid characters.
 * @param {string} value - Raw filename
 * @returns {string} Safe filename (max 90 chars)
 */
function taskDocumentPdfHtml({ taskTitle, bodyHtml }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" />
  <style>
/**
 * Escape HTML special characters for safe rendering in PDF templates.
 * @param {string} value - Raw text
 * @returns {string} HTML-escaped text
 */
    :root { color: #17211c; font-family: Inter, "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
    body { margin: 0; padding: 36px 42px; background: #ffffff; }
    header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #d9e2dc; }
    .kicker { margin: 0 0 7px; color: #5f756b; font-size: 12px; letter-spacing: 0; }
    h1 { margin: 0; color: #10251d; font-size: 26px; line-height: 1.25; }
    main { font-size: 14.5px; line-height: 1.72; }
    h1, h2, h3, h4, h5, h6 { color: #10251d; page-break-after: avoid; }
    h2 { margin-top: 24px; font-size: 20px; border-bottom: 1px solid #edf2ef; padding-bottom: 5px; }
/**
 * Create the application menu (currently set to null, hiding the default menu bar).
 */
    h3 { margin-top: 18px; font-size: 17px; }
    p, ul, ol, blockquote, pre, table, img { margin: 0 0 13px; }
    a { color: #2f7d68; text-decoration: none; }
    blockquote { padding: 10px 13px; border-left: 3px solid #2f7d68; color: #52665d; background: #f5faf7; }
/**
 * Application ready handler: registers IPC, sets up menu, creates window.
 */
    code { padding: 1px 5px; border: 1px solid #dfe9e4; border-radius: 5px; background: #f6faf8; font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.92em; }
    pre { overflow-wrap: anywhere; padding: 12px; border: 1px solid #dfe9e4; border-radius: 8px; background: #f6faf8; white-space: pre-wrap; }
    pre code { padding: 0; border: 0; background: transparent; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 7px 8px; border: 1px solid #dfe9e4; text-align: left; vertical-align: top; }
    th { background: #f3f8f5; }
    .markdown-empty { color: #7d8e86; }
  </style>
</head>
<body>
  <header>
    <p class="kicker">Loop</p>
    <h1>${escapeHtml(taskTitle)}</h1>
  </header>
  <main>${bodyHtml}</main>
</body>
</html>`;
}

function sanitizeFileName(value) {
  return String(value || "node-detail")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "node-detail";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createMenu() {
  Menu.setApplicationMenu(null);
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  // Verification hook: `--phase26-lock-writes` holds the data-maintenance lock
  // for the whole session, exactly like a backup import does, so a probe can
  // prove that a refused write loses nothing. It is never passed by the app
  // itself, releases itself, and changes no product behaviour.
  if (process.argv.includes("--phase26-lock-writes")) {
    dataMaintenance.begin("phase26-lock-writes");
    setTimeout(() => dataMaintenance.end(), 30000).unref?.();
    console.log("[loop] task-data writes are locked for this session (verification hook)");
  }
  try {
    // A caller-provided profile is isolated on purpose: never pull the machine's
    // real task database into it (and never write backups next to it).
    if (!desktopIdentity.usesExplicitProfile) {
      await recoverLegacyUserData({
        appDataPath: app.getPath("appData"),
        canonicalUserDataPath: app.getPath("userData"),
        recoverRicherLegacy: process.argv.includes("--updated"),
      });
    }
  } catch (error) {
    console.error("Unable to complete legacy task-data recovery.", error?.code || error);
    dialog.showErrorBox(
      "Loop 数据保护已启动",
      "检测到旧版任务数据，但安全恢复校验未通过。为避免覆盖原数据，Loop 已停止启动；原始数据和备份均未删除。",
    );
    app.quit();
    return;
  }
  if (isMac) {
    app.setActivationPolicy("regular");
    await app.dock.show();
  }
  registerStorageHandlers();
  registerWindowChromeHandlers();
  pointerContinuity = createPointerContinuity({ app, ipcMain, screen, getMainWindow: () => mainWindow });
  pointerContinuity.register();
  await pointerContinuity.start();
  todayWidgetController = createTodayWidgetController({
    app,
    BrowserWindow,
    globalShortcut,
    ipcMain,
    screen,
    getMainWindow: () => mainWindow,
    ensureMainWindow: createWindow,
  });
  todayWidgetController.registerIpc();
  deadlineReminderController = createDeadlineReminderController({
    app,
    Notification,
    ipcMain,
    appId: desktopIdentity?.appId || DESKTOP_APP_ID,
    getMainWindow: () => mainWindow,
    ensureMainWindow: createWindow,
  });
  deadlineReminderController.registerIpc();
  updateController = createUpdateController({
    app,
    BrowserWindow,
    ipcMain,
    autoUpdater,
    fetchReleaseNotes: (url, options) => net.fetch(url, options),
    macUpdatesEnabled: false,
    installDirectory: process.platform === "win32" ? path.dirname(process.execPath) : "",
    prepareInstall: requestUpdateInstallPreparation,
  });
  autoUpdater.on("error", () => {
    updateInstallPrepared = false;
  });
  updateController.registerIpc();
  createMenu();
  createWindow();
  await Promise.all([updateController.start(), todayWidgetController.start(), deadlineReminderController.start()]);

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else mainWindow.show();
    todayWidgetController?.applyAlwaysOnTop();
  });
  if (isMac) {
    app.on("did-become-active", () => todayWidgetController?.applyAlwaysOnTop());
    app.on("did-resign-active", () => {
      todayWidgetController?.restoreAlwaysOnTopAfterAppDeactivation();
      const fullscreenTransitionRefresh = setTimeout(() => todayWidgetController?.applyAlwaysOnTop(), 1200);
      fullscreenTransitionRefresh.unref();
    });
  }
});

app.on("before-quit", (event) => {
  // Stop filesystem watchers as soon as shutdown begins. The window `closed`
  // event is a secondary cleanup path, not the lifecycle guarantee.
  knowledgeWatcher.closeAll();
  if (!isQuitting && !updateInstallPrepared && requestRecoveryShutdown(event)) return;
  isQuitting = true;
  pointerContinuity?.stop();
  updateController?.stop();
  todayWidgetController?.stop();
  void deadlineReminderController?.stop();
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

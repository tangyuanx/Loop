// Real main process, renderer, IPC and update controller. Only the release
// service, installer and platform eligibility are fixtures; no real update runs.
const { app } = require("electron");
const { EventEmitter } = require("node:events");
const updater = require("../../app/main/updater.cjs");
const createController = updater.createUpdateController;
const updates = new EventEmitter();
const fixture = global.__loopUpdaterTest = { checks: 0, downloads: 0, preparations: 0, installs: 0, releaseVersion: "0.1.251" };
const releases = Array.from({ length: 32 }, (_, index) => ({
  tag_name: `v0.1.${252 - index}`,
  published_at: "2026-10-29T02:00:00Z",
  body: index === 1 ? "## 修复\n- 修复知识笔记表格后点击与光标位置错位。\n- 保持现有笔记内容和编辑方式。"
    : `## 更新说明测试数据\n- 验证跨版本更新内容的折叠与阅读。\n- 这是版本 ${252 - index} 的独立说明。`,
}));
let checkedVersion;
updates.checkForUpdates = async () => {
  fixture.checks++;
  if (fixture.pauseCheck) {
    await new Promise((resolve) => { fixture.finishCheck = resolve; });
    fixture.pauseCheck = false;
  }
  if (fixture.failCheck) {
    fixture.failCheck = false;
    throw Object.assign(new Error("offline"), { code: "ENOTFOUND" });
  }
  checkedVersion = fixture.releaseVersion;
  updates.emit("update-available", { version: checkedVersion, releaseDate: releases[0].published_at, files: [{ size: 30_000_000 }] });
};
updates.downloadUpdate = () => {
  fixture.downloads++;
  fixture.downloadVersion = checkedVersion;
  updates.emit("download-progress", { percent: 37, transferred: 11_100_000, total: 30_000_000, bytesPerSecond: 1_000_000 });
  return new Promise((resolve) => {
    fixture.finishDownload = () => { updates.emit("update-downloaded", { version: checkedVersion }); resolve([]); };
  });
};
updates.quitAndInstall = () => { fixture.installs++; };
updater.createUpdateController = (options) => {
  fixture.controller = createController({
    ...options,
    startupDelayMs: 2 ** 31 - 1, // The test starts the automatic check after observing idle.
    app: { isPackaged: true, getVersion: () => "0.1.220", getPath: (...args) => app.getPath(...args) },
    platform: "win32", autoUpdater: updates,
    fetchReleaseNotes: async () => ({ ok: true, json: async () => releases }),
    prepareInstall: async () => { fixture.preparations++; return options.prepareInstall(); },
  });
  fixture.progress = (percent) => updates.emit("download-progress", { percent, total: 30_000_000 });
  return fixture.controller;
};
// Headless Linux environments may not support Unix-domain singleton sockets.
if (process.argv.includes("--ozone-platform=headless")) app.requestSingleInstanceLock = () => true;
require("../../app/main/main.cjs");

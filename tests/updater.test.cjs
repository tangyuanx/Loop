const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const { classifyUpdateError, createUpdateController } = require("../app/main/updater.cjs");
const { acknowledgeMacUpdate, createMacInstallerUpdater } = require("../app/main/mac-update.cjs");
const { normalizeReleaseNotes, notesFromUpdateInfo, fetchUpdateReleaseNotes } = require("../app/main/update-release-notes.cjs");

function createHarness({
  platform = "win32",
  isPackaged = true,
  prepareInstallResult = true,
  installThrows = false,
  checkError = null,
  installDirectory = "C:\\Users\\example\\AppData\\Local\\Programs\\Personal Task Track",
  fileSystem = fs,
  fetchReleaseNotes = null,
} = {}) {
  const updates = new EventEmitter();
  const handlers = new Map();
  const messages = [];
  const userData = path.join(os.tmpdir(), `personal-task-track-updater-${Date.now()}-${Math.random()}`);
  let checkCount = 0;
  let downloadCount = 0;
  let prepareInstallCount = 0;
  let installArgs = null;
  updates.checkForUpdates = async () => {
    checkCount += 1;
    updates.emit("checking-for-update");
    if (checkError) throw checkError;
    updates.emit("update-available", {
      version: "0.1.110",
      releaseDate: "2026-08-15T08:00:00.000Z",
      files: [{ size: 30_000_000 }],
    });
  };
  updates.downloadUpdate = async () => {
    downloadCount += 1;
    updates.emit("download-progress", {
      percent: 42.55,
      transferred: 12_000_000,
      total: 30_000_000,
      bytesPerSecond: 2_000_000,
    });
    updates.emit("update-downloaded", { version: "0.1.110" });
    return [];
  };
  updates.quitAndInstall = (...args) => {
    if (installThrows) throw Object.assign(new Error("installer spawn failed"), { code: "EACCES" });
    installArgs = args;
  };
  const controller = createUpdateController({
    app: {
      isPackaged,
      getVersion: () => "0.1.109",
      getPath: () => userData,
    },
    BrowserWindow: {
      getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (...args) => messages.push(args) } }],
    },
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    autoUpdater: updates,
    platform,
    installDirectory,
    fileSystem,
    fetchReleaseNotes,
    prepareInstall: async () => {
      prepareInstallCount += 1;
      return prepareInstallResult;
    },
  });
  return {
    controller,
    handlers,
    messages,
    updates,
    userData,
    checkCount: () => checkCount,
    downloadCount: () => downloadCount,
    prepareInstallCount: () => prepareInstallCount,
    installArgs: () => installArgs,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("Mac relaunch acknowledges a handoff only within its own temporary directory", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "loop-mac-startup-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const handoff = await fs.mkdtemp(path.join(root, "loop-mac-update-"));
  const receipt = path.join(handoff, ".loop-relaunch-ready");
  await acknowledgeMacUpdate([`--loop-update-ready=${receipt}`], root);
  assert.equal(await fs.readFile(receipt, "utf8"), "ready\n");
  await assert.rejects(acknowledgeMacUpdate([`--loop-update-ready=${receipt}`], root), { code: "EEXIST" });
  const other = path.join(root, "unrelated.txt");
  await acknowledgeMacUpdate([`--loop-update-ready=${other}`], root);
  await assert.rejects(fs.stat(other), { code: "ENOENT" });
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "loop-mac-update-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const outsideReceipt = path.join(outside, ".loop-relaunch-ready");
  await acknowledgeMacUpdate([`--loop-update-ready=${outsideReceipt}`], root);
  await assert.rejects(fs.stat(outsideReceipt), { code: "ENOENT" });
});

test("a failed download retries the download without losing the checked release", async (t) => {
  const h = createHarness();
  t.after(() => fs.rm(h.userData, { recursive: true, force: true }));
  await h.controller.start({ schedule: false });
  await h.controller.checkForUpdates();
  const download = h.updates.downloadUpdate;
  h.updates.downloadUpdate = async () => { throw Object.assign(new Error("offline"), { code: "ENOTFOUND" }); };
  await h.controller.downloadUpdate();
  assert.equal(h.controller.getState().status, "error");
  assert.equal(h.controller.getState().retryAction, "download");
  h.updates.downloadUpdate = download;
  await h.controller.downloadUpdate(); await settle();
  assert.equal(h.downloadCount(), 1);
  assert.equal(h.checkCount(), 1);
  assert.equal(h.controller.getState().status, "downloaded");
  assert.equal(h.prepareInstallCount(), 0);
});

test("an installer failure can retry the downloaded installer without downloading again", async (t) => {
  const h = createHarness({ installThrows: true });
  t.after(() => fs.rm(h.userData, { recursive: true, force: true }));
  await h.controller.checkForUpdates(); await h.controller.downloadUpdate();
  await h.controller.installUpdate();
  assert.equal(h.controller.getState().retryAction, "install");
  let installed = 0;
  h.updates.quitAndInstall = () => { installed++; };
  await h.controller.installUpdate();
  assert.equal(installed, 1);
  assert.equal(h.downloadCount(), 1);
  assert.equal(h.controller.getState().status, "installing");
});

test("failed update-preference persistence retains the saved value and current download state", async (t) => {
  let fail = false;
  const h = createHarness({ fileSystem: { ...fs, rename: async (...args) => {
    if (fail) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    return fs.rename(...args);
  } } });
  t.after(() => fs.rm(h.userData, { recursive: true, force: true }));
  await h.controller.setAutomaticChecks(false);
  h.updates.emit("download-progress", { percent: 23 });
  fail = true;
  await assert.rejects(h.controller.setAutomaticChecks(true), { code: "ENOSPC" });
  assert.equal(h.controller.getState().automaticChecks, false);
  assert.equal(h.controller.getState().status, "downloading");
  assert.equal(h.controller.getState().preferenceError, "ENOSPC");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(h.userData, "update-preferences.json"), "utf8")), { automaticChecks: false });
  fail = false; await h.controller.setAutomaticChecks(true); h.controller.stop();
  assert.equal(h.controller.getState().preferenceError, "");
});

test("concurrent update-preference changes commit in order and restart reads the final value", async (t) => {
  const h = createHarness();
  t.after(() => { h.controller.stop(); return fs.rm(h.userData, { recursive: true, force: true }); });
  await Promise.all([h.controller.setAutomaticChecks(false), h.controller.setAutomaticChecks(true), h.controller.setAutomaticChecks(false)]);
  assert.equal(h.controller.getState().automaticChecks, false);
  const other = createHarness({ fileSystem: { ...fs, readFile: () => fs.readFile(path.join(h.userData, "update-preferences.json"), "utf8") } });
  await other.controller.start({ schedule: false });
  assert.equal(other.controller.getState().automaticChecks, false);
});

test("Windows download waits for a separate explicit install action before saving and relaunching", async () => {
  const harness = createHarness();
  harness.controller.registerIpc();
  await harness.controller.start({ schedule: false });

  assert.equal(harness.controller.getState().status, "idle");
  await harness.controller.checkForUpdates();
  assert.equal(harness.controller.getState().status, "available");
  assert.equal(harness.controller.getState().version, "0.1.110");
  assert.equal(harness.checkCount(), 1);

  await harness.controller.downloadUpdate();
  await settle();
  assert.equal(harness.controller.getState().status, "downloaded");
  assert.equal(harness.prepareInstallCount(), 0);
  assert.equal(harness.installArgs(), null);
  await harness.handlers.get("app-update:download")();
  await harness.controller.checkForUpdates("automatic");
  assert.equal(harness.downloadCount(), 1);
  assert.equal(harness.prepareInstallCount(), 0);
  assert.equal(harness.controller.getState().status, "downloaded");
  await harness.handlers.get("app-update:install")();
  assert.equal(harness.controller.getState().status, "installing");
  assert.equal(harness.controller.getState().percent, 100);
  assert.equal(harness.downloadCount(), 1);
  assert.equal(harness.prepareInstallCount(), 1);
  assert.deepEqual(harness.installArgs(), [true, true]);
  assert.equal(harness.updates.autoDownload, false);
  assert.equal(harness.updates.autoInstallOnAppQuit, false);
  assert.equal(harness.updates.installDirectory, "C:\\Users\\example\\AppData\\Local\\Programs\\Personal Task Track");
  await fs.rm(harness.userData, { recursive: true, force: true });
});

test("an availability check or unapproved downloaded event never starts installation", async () => {
  const harness = createHarness();
  await harness.controller.start({ schedule: false });
  await harness.controller.checkForUpdates("automatic");
  harness.updates.emit("update-downloaded", { version: "0.1.110" });
  await settle();

  assert.equal(harness.controller.getState().status, "downloaded");
  assert.equal(harness.downloadCount(), 0);
  assert.equal(harness.prepareInstallCount(), 0);
  assert.equal(harness.installArgs(), null);
  await fs.rm(harness.userData, { recursive: true, force: true });
});

test("manual rechecks distinguish the same release, a higher release, and no available release", async () => {
  const h = createHarness();
  await h.controller.checkForUpdates("automatic");
  assert.equal(h.controller.getState().sameVersionOnRecheck, false);
  const same = await h.controller.checkForUpdates();
  assert.equal(same.status, "available");
  assert.equal(same.version, "0.1.110");
  assert.equal(same.sameVersionOnRecheck, true);
  assert.equal(h.checkCount(), 2);
  assert.equal((await h.controller.checkForUpdates("automatic")).sameVersionOnRecheck, false);

  h.updates.checkForUpdates = async () => h.updates.emit("update-available", {
    version: "0.1.111",
    releaseNotes: "New update notes",
    files: [{ size: 40_000_000 }],
  });
  const higher = await h.controller.checkForUpdates();
  assert.equal(higher.status, "available");
  assert.equal(higher.version, "0.1.111");
  assert.equal(higher.releaseNotes[0].notes, "New update notes");
  assert.equal(higher.size, 40_000_000);
  assert.equal(higher.sameVersionOnRecheck, false);

  h.updates.checkForUpdates = async () => h.updates.emit("update-not-available");
  const withdrawn = await h.controller.checkForUpdates();
  assert.equal(withdrawn.status, "latest");
  assert.equal(withdrawn.version, "");
  assert.deepEqual(withdrawn.releaseNotes, []);
  assert.equal(h.downloadCount(), 0);
});

test("automatic and manual checks cannot overlap, including after a provider emits availability", async () => {
  const h = createHarness();
  let calls = 0;
  let finishCheck;
  h.updates.checkForUpdates = () => {
    calls++;
    return new Promise((resolve) => { finishCheck = resolve; });
  };
  const automatic = h.controller.checkForUpdates("automatic");
  const manual = await h.controller.checkForUpdates();
  assert.equal(manual.status, "checking");
  assert.equal(manual.checkSource, "automatic");
  h.updates.emit("update-available", { version: "0.1.110" });
  await h.controller.checkForUpdates();
  assert.equal(calls, 1);
  finishCheck();
  await automatic;

  const recheck = h.controller.checkForUpdates();
  assert.equal(calls, 2);
  h.updates.emit("update-available", { version: "0.1.110" });
  finishCheck();
  assert.equal((await recheck).sameVersionOnRecheck, true);

  await h.controller.downloadUpdate();
  assert.equal((await h.controller.checkForUpdates()).status, "downloaded");
  assert.equal(calls, 2);
});

test("failed pre-install persistence keeps the app open and the downloaded update retryable", async () => {
  const harness = createHarness({ prepareInstallResult: false });
  await harness.controller.start({ schedule: false });
  await harness.controller.checkForUpdates();
  await harness.controller.downloadUpdate();
  await harness.controller.installUpdate();

  assert.equal(harness.controller.getState().status, "downloaded");
  assert.equal(harness.controller.getState().errorCode, "INSTALL_PREPARATION_FAILED");
  assert.equal(harness.prepareInstallCount(), 1);
  assert.equal(harness.installArgs(), null);
  await fs.rm(harness.userData, { recursive: true, force: true });
});

test("rapid repeated upgrade actions share one download and one install preparation", async () => {
  const harness = createHarness();
  await harness.controller.start({ schedule: false });
  await harness.controller.checkForUpdates();
  await Promise.all([
    harness.controller.downloadUpdate(),
    harness.controller.downloadUpdate(),
    harness.controller.downloadUpdate(),
  ]);
  await settle();

  assert.equal(harness.downloadCount(), 1);
  assert.equal(harness.prepareInstallCount(), 0);
  await Promise.all([harness.controller.installUpdate(), harness.controller.installUpdate(), harness.controller.installUpdate()]);
  assert.equal(harness.prepareInstallCount(), 1);
  assert.deepEqual(harness.installArgs(), [true, true]);
  await fs.rm(harness.userData, { recursive: true, force: true });
});

test("installer launch failure remains visible and does not report an installing state", async () => {
  const harness = createHarness({ installThrows: true });
  await harness.controller.start({ schedule: false });
  await harness.controller.checkForUpdates();
  await harness.controller.downloadUpdate();
  await harness.controller.installUpdate();

  assert.equal(harness.controller.getState().status, "error");
  assert.equal(harness.controller.getState().errorCode, "EACCES");
  assert.equal(harness.prepareInstallCount(), 1);
  assert.equal(harness.installArgs(), null);
  await fs.rm(harness.userData, { recursive: true, force: true });
});

test("automatic-check preference is persisted outside task data", async () => {
  const harness = createHarness();
  await harness.controller.start({ schedule: false });
  await harness.controller.setAutomaticChecks(false);
  const preference = JSON.parse(await fs.readFile(path.join(harness.userData, "update-preferences.json"), "utf8"));
  assert.deepEqual(preference, { automaticChecks: false });
  assert.equal(harness.controller.getState().automaticChecks, false);
  harness.controller.stop();
  await fs.rm(harness.userData, { recursive: true, force: true });
});

test("development and unsupported platforms do not contact the update feed", async () => {
  for (const options of [
    { platform: "win32", isPackaged: false },
    { platform: "darwin", isPackaged: false },
    { platform: "linux", isPackaged: true },
  ]) {
    const harness = createHarness(options);
    await harness.controller.start({ schedule: false });
    await harness.controller.checkForUpdates();
    assert.equal(harness.controller.getState().status, "unsupported");
    assert.equal(harness.checkCount(), 0);
    await fs.rm(harness.userData, { recursive: true, force: true });
  }
});

test("a Mac download action saves and backs up before handing off to Finder", async () => {
  const h = createHarness({ platform: "darwin" });
  await h.controller.start({ schedule: false });
  assert.equal(h.controller.getState().supported, true);
  await h.controller.checkForUpdates();
  assert.equal(h.prepareInstallCount(), 0);
  assert.equal(h.installArgs(), null);
  assert.equal((await h.controller.downloadUpdate()).status, "installing");
  assert.equal(h.prepareInstallCount(), 1);
  assert.deepEqual(h.installArgs(), []);
  const failure = createHarness({ platform: "darwin", prepareInstallResult: false });
  await failure.controller.checkForUpdates();
  assert.equal((await failure.controller.downloadUpdate()).errorCode, "INSTALL_PREPARATION_FAILED");
  assert.equal(failure.installArgs(), null);
});

test("Mac updater chooses a verified DMG for the hardware and refuses untrusted downloads", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "loop-mac-dmg-test-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const data = Buffer.from("example installer bytes");
  const latest = "https://api.github.com/repos/tangyuanx/Loop/releases/latest";
  const asset = (arch) => ({
    name: `Loop-0.2.66-${arch}.dmg`, state: "uploaded", size: data.length,
    browser_download_url: `https://github.com/tangyuanx/Loop/releases/download/v0.2.66/Loop-0.2.66-${arch}.dmg`,
    digest: `sha256:${crypto.createHash("sha256").update(data).digest("hex")}`,
  });
  const arm = asset("arm64");
  const cdn = "https://release-assets.githubusercontent.com/download/example";
  const release = { tag_name: "v0.2.66", assets: [asset("x64"), arm] };
  let redirect = cdn;
  let payload = data;
  const events = [];
  const updater = createMacInstallerUpdater({
    app: { runningUnderARM64Translation: true, getPath: () => temp, getVersion: () => "0.2.65", quit: () => events.push("quit") },
    fetch: async (url) => {
      assert.equal(url, latest);
      return Response.json(release);
    },
    request: ({ url }) => {
      assert.equal(url, arm.browser_download_url);
      const request = new EventEmitter();
      request.end = () => request.emit("redirect", 302, "GET", redirect);
      request.abort = () => request.emit("close");
      request.followRedirect = () => {
        assert.equal(redirect, cdn);
        const response = Readable.from([payload]);
        response.statusCode = 200;
        response.once("end", () => request.emit("close"));
        request.emit("response", response);
      };
      return request;
    },
    quarantine: async (file) => {
      assert.deepEqual(await fs.readFile(file), data);
      events.push("quarantine");
    },
    openAfterExit: async (file) => {
      assert.equal(path.basename(file), arm.name);
      events.push("handoff");
    },
  });
  updater.on("update-available", () => events.push("available"));
  updater.on("update-downloaded", () => events.push("downloaded"));
  await updater.checkForUpdates();
  redirect = "https://example.com/unexpected";
  await assert.rejects(updater.downloadUpdate(), { code: "UPDATE_INTEGRITY_FAILED" });
  redirect = cdn;
  payload = Buffer.alloc(data.length);
  await assert.rejects(updater.downloadUpdate(), { code: "UPDATE_INTEGRITY_FAILED" });
  assert.deepEqual(await fs.readdir(temp), []);
  payload = data;
  await updater.downloadUpdate();
  assert.deepEqual(events, ["available", "quarantine", "downloaded"]);
  await updater.quitAndInstall();
  assert.deepEqual(events.slice(-2), ["handoff", "quit"]);
});

test("update failures distinguish an incomplete Windows release from user network errors", async () => {
  const incompleteRelease = createHarness({
    checkError: Object.assign(
      new Error('Cannot find channel "latest.yml" update info: HttpError: 404 Not Found'),
      { code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" },
    ),
  });
  await incompleteRelease.controller.start({ schedule: false });
  await incompleteRelease.controller.checkForUpdates();
  assert.equal(incompleteRelease.controller.getState().status, "error");
  assert.equal(incompleteRelease.controller.getState().errorCode, "UPDATE_METADATA_MISSING");

  const offline = createHarness({
    checkError: Object.assign(new Error("getaddrinfo ENOTFOUND api.github.com"), { code: "ENOTFOUND" }),
  });
  await offline.controller.start({ schedule: false });
  await offline.controller.checkForUpdates();
  assert.equal(offline.controller.getState().errorCode, "UPDATE_NETWORK_UNAVAILABLE");

  assert.equal(classifyUpdateError(Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" })), "UPDATE_TIMEOUT");
  await Promise.all([
    fs.rm(incompleteRelease.userData, { recursive: true, force: true }),
    fs.rm(offline.userData, { recursive: true, force: true }),
  ]);
});

test("release notes use semantic order, deduplicate, and exclude installed, future, and prerelease versions", () => {
  const entries = [
    { version: "v0.1.9", notes: "installed" },
    { version: "0.1.10", notes: "ten" },
    { version: "0.1.12", notes: "twelve", releaseDate: "2026-10-29" },
    { version: "0.1.11", notes: "eleven" },
    { version: "0.1.12", notes: "duplicate" },
    { version: "0.1.13", notes: "future" },
    { version: "0.1.12-beta.1", notes: "beta" },
    { version: "not-a-version", notes: "invalid" },
  ];
  const notes = normalizeReleaseNotes(entries, "0.1.9", "0.1.12");
  assert.deepEqual(notes.map((item) => item.version), ["0.1.12", "0.1.11", "0.1.10"]);
  assert.equal(notes[0].notes, "twelve");
  assert.equal(notes[0].releaseDate, "2026-10-29T00:00:00.000Z");
  assert.equal(notesFromUpdateInfo({ version: "0.1.12", releaseNotes: "latest notes" }, "0.1.9")[0].notes, "latest notes");
  assert.equal(notesFromUpdateInfo({ version: "0.1.12", releaseNotes: [{ version: "0.1.11", note: "earlier" }] }, "0.1.9").length, 2);
});

test("history paginates across a large version gap and retains versions missing a description", async () => {
  const calls = [];
  const page1 = Array.from({ length: 100 }, (_, index) => ({ tag_name: `v0.1.${150 - index}`, body: `note ${150 - index}` }));
  const page2 = [
    { tag_name: "v0.1.50", body: null },
    { tag_name: "v0.1.49", body: "installed" },
    { tag_name: "v0.1.151", body: "future" },
    { tag_name: "v0.1.149", body: "draft", draft: true },
  ];
  const result = await fetchUpdateReleaseNotes({ currentVersion: "0.1.49", targetVersion: "0.1.150", fetch: async (url) => {
    calls.push(url);
    return { ok: true, json: async () => calls.length === 1 ? page1 : page2 };
  } });
  assert.match(calls[1], /page=2$/);
  assert.equal(result.releaseNotesStatus, "ready");
  assert.equal(result.releaseNotes.length, 101);
  assert.equal(result.releaseNotes.at(-1).version, "0.1.50");
  assert.equal(result.releaseNotes.at(-1).notes, "");
});

test("history failure and pagination limits report partial notes without blocking the installer", async () => {
  const fallback = [{ version: "0.1.110", notes: "feed note" }];
  for (const fetch of [async () => { throw new Error("offline"); }, async () => ({ ok: false, status: 429 })]) {
    const result = await fetchUpdateReleaseNotes({ fetch, currentVersion: "0.1.109", targetVersion: "0.1.110", fallback });
    assert.equal(result.releaseNotesStatus, "partial");
    assert.equal(result.releaseNotes[0].notes, "feed note");
  }
  const limited = await fetchUpdateReleaseNotes({ currentVersion: "0.1.1", targetVersion: "0.1.110", maxPages: 1,
    fetch: async () => ({ ok: true, json: async () => Array.from({ length: 100 }, () => ({ tag_name: "v0.1.110", body: "latest" })) }),
  });
  assert.equal(limited.releaseNotesStatus, "partial");
});

test("late history from an earlier check cannot overwrite a newer check or install waiting state", async (t) => {
  let resolveFirst;
  let calls = 0;
  const h = createHarness({ fetchReleaseNotes: () => {
    if (++calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
    return Promise.resolve({ ok: true, json: async () => [{ tag_name: "v0.1.110", body: "new history" }] });
  } });
  t.after(() => { h.controller.stop(); return fs.rm(h.userData, { recursive: true, force: true }); });
  await h.controller.checkForUpdates();
  assert.equal(h.controller.getState().releaseNotesStatus, "loading");
  await h.controller.checkForUpdates();
  await settle();
  await h.controller.downloadUpdate();
  resolveFirst({ ok: true, json: async () => [{ tag_name: "v0.1.110", body: "stale history" }] });
  await settle();
  assert.equal(h.controller.getState().releaseNotes[0].notes, "new history");
  assert.equal(h.controller.getState().status, "downloaded");
  assert.equal(h.prepareInstallCount(), 0);
  const snapshot = h.controller.getState();
  snapshot.releaseNotes[0].notes = "mutated outside the controller";
  assert.equal(h.controller.getState().releaseNotes[0].notes, "new history");
});

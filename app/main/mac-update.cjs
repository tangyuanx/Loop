const crypto = require("node:crypto");
const { execFile, spawn } = require("node:child_process");
const { EventEmitter, once } = require("node:events");
const { createWriteStream } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { promisify } = require("node:util");
const semver = require("semver");

const REPOSITORY = "tangyuanx/Loop";
const LATEST_RELEASE = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const DOWNLOAD_HOSTS = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const run = promisify(execFile);

function updateError(code) {
  return Object.assign(new Error(code), { code });
}

function releaseInstaller(release, currentVersion, arch) {
  const version = semver.valid(release?.tag_name);
  if (!version || !semver.valid(currentVersion) || release.tag_name !== `v${version}` || release.draft || release.prerelease || semver.prerelease(version)) {
    throw updateError("UPDATE_METADATA_INVALID");
  }
  if (!semver.gt(version, currentVersion)) return null;
  const name = `Loop-${version}-${arch}.dmg`;
  const asset = Array.isArray(release.assets) && release.assets.find(item => item?.name === name && item.state === "uploaded");
  const url = `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;
  if (!asset || asset.browser_download_url !== url || !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? "")) {
    throw updateError("UPDATE_MAC_ASSET_UNAVAILABLE");
  }
  return { name, url, size: asset.size, sha256: asset.digest.slice(7).toLowerCase(), version };
}

function requestInstaller(request, originalUrl) {
  const signal = AbortSignal.timeout(30 * 60_000);
  return new Promise((resolve, reject) => {
    // Electron net.fetch rejects manual redirects. ClientRequest lets us
    // inspect each destination before following the download.
    const download = request({ url: originalUrl, redirect: "manual" });
    let redirects = 0;
    const fail = (error) => {
      reject(error);
      download.abort();
    };
    const timeout = () => fail(signal.reason);
    signal.addEventListener("abort", timeout, { once: true });
    download.once("close", () => signal.removeEventListener("abort", timeout));
    download.on("redirect", (_status, _method, location) => {
      const url = URL.parse(location);
      if (++redirects > 5 || !url || url.protocol !== "https:" || url.username || url.password || url.port || !DOWNLOAD_HOSTS.has(url.hostname)) {
        fail(updateError("UPDATE_INTEGRITY_FAILED"));
        return;
      }
      download.followRedirect();
    });
    download.once("response", (response) => {
      if (response.statusCode !== 200) {
        fail(new Error(`Installer download HTTP ${response.statusCode}`));
        return;
      }
      resolve({ source: response, signal });
    });
    download.once("error", reject);
    download.end();
  });
}

async function quarantineInstaller(file) {
  const timestamp = Math.floor(Date.now() / 1000).toString(16);
  await run("/usr/bin/xattr", ["-w", "com.apple.quarantine", `0001;${timestamp};Loop;`, file]);
}

async function openInstallerAfterExit(file, {
  pid = process.pid, destination = "/Applications/Loop.app", profile = "",
} = {}) {
  // Finder must start the handoff after the old app has released its handles.
  // Keep the path and PID as positional arguments instead of embedding them.
  const mount = path.join(path.dirname(file), "installer");
  await fs.mkdir(mount, { recursive: true });
  const child = spawn("/bin/sh", ["-c", `
    attempts=0
    while /bin/kill -0 "$1" 2>/dev/null; do
      [ "$attempts" -lt 300 ] || exit 1
      /bin/sleep 0.2
      attempts=$((attempts + 1))
    done
    if ! /usr/bin/hdiutil attach -readonly -nobrowse -mountpoint "$3" "$2"; then
      /usr/bin/open "$2" || /usr/bin/open -R "$2"
      exit
    fi
    /usr/bin/open "$3" || /usr/bin/open -R "$2"

    source="$3/Loop.app"
    executable="$4/Contents/MacOS/Loop"
    attempts=0
    while [ -d "$source" ] && [ "$attempts" -lt 600 ]; do
      # Finder may create the bundle before it finishes copying. Compare the
      # entire app to the verified disk image before trying to launch it.
      if [ -x "$executable" ] &&
         /usr/bin/cmp -s "$source/Contents/Info.plist" "$4/Contents/Info.plist" &&
         /usr/bin/diff -qr "$source" "$4" >/dev/null 2>&1; then
        if /usr/bin/hdiutil detach "$3"; then
          /bin/rm -f "$2"
          /bin/rmdir "$3" "$(/usr/bin/dirname "$2")" 2>/dev/null
        fi
        if [ -n "$5" ]; then
          /usr/bin/open -n "$4" --args "--user-data-dir=$5" || /usr/bin/open -R "$4"
        else
          /usr/bin/open -n "$4" || /usr/bin/open -R "$4"
        fi
        exit
      fi
      /bin/sleep 1
      attempts=$((attempts + 1))
    done
  `, "loop-open-update", String(pid), file, mount, destination, profile], { detached: true, stdio: "ignore" });
  await once(child, "spawn");
  child.unref();
}

function createMacInstallerUpdater({ app, fetch, request, profile = "", quarantine = quarantineInstaller, openAfterExit = openInstallerAfterExit,
  architecture = app.runningUnderARM64Translation ? "arm64" : process.arch }) {
  const updater = new EventEmitter();
  let asset;
  let downloaded;

  updater.checkForUpdates = async () => {
    asset = null;
    const response = await fetch(LATEST_RELEASE, {
      headers: { Accept: "application/vnd.github+json" }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) throw updateError("UPDATE_RELEASE_NOT_FOUND");
    if (!response.ok) throw new Error(`Release check HTTP ${response.status}`);
    const release = await response.json();
    asset = releaseInstaller(release, app.getVersion(), architecture);
    if (!asset) {
      updater.emit("update-not-available");
      return;
    }
    updater.emit("update-available", {
      version: asset.version, releaseDate: release.published_at, releaseNotes: release.body, files: [{ size: asset.size }],
    });
  };

  updater.downloadUpdate = async () => {
    if (!asset) throw updateError("UPDATE_MAC_ASSET_UNAVAILABLE");
    const directory = await fs.mkdtemp(path.join(app.getPath("temp"), "loop-mac-update-"));
    const file = path.join(directory, asset.name);
    try {
      const { source, signal } = await requestInstaller(request, asset.url);
      const hash = crypto.createHash("sha256");
      const started = Date.now();
      let transferred = 0;
      let lastProgress = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          transferred += chunk.length;
          if (transferred > asset.size) return callback(updateError("UPDATE_INTEGRITY_FAILED"));
          hash.update(chunk);
          const now = Date.now();
          if (now - lastProgress >= 200 || transferred === asset.size) {
            updater.emit("download-progress", {
              percent: transferred * 100 / asset.size, transferred, total: asset.size,
              bytesPerSecond: transferred * 1000 / Math.max(now - started, 1),
            });
            lastProgress = now;
          }
          callback(null, chunk);
        },
      });
      await pipeline(source, meter, createWriteStream(file, { flags: "wx", mode: 0o600 }), { signal });
      if (transferred !== asset.size || hash.digest("hex") !== asset.sha256) throw updateError("UPDATE_INTEGRITY_FAILED");
      await quarantine(file);
      if (downloaded) await fs.rm(path.dirname(downloaded), { recursive: true, force: true }).catch(() => {});
      downloaded = file;
      updater.emit("update-downloaded", { version: asset.version });
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  };

  updater.quitAndInstall = async () => {
    if (!downloaded) throw updateError("UPDATE_MAC_INSTALLER_MISSING");
    const file = await fs.stat(downloaded).catch(() => null);
    if (!file?.isFile() || file.size !== asset?.size) throw updateError("UPDATE_MAC_INSTALLER_MISSING");
    await openAfterExit(downloaded, { profile });
    app.quit();
  };

  return updater;
}

module.exports = { createMacInstallerUpdater, openInstallerAfterExit };

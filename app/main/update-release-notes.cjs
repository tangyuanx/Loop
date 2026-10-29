const semver = require("semver");

const RELEASES_URL = "https://api.github.com/repos/tangyuanx/Loop/releases";
const MAX_NOTE_LENGTH = 12_000;

function releaseVersion(value) {
  return semver.valid(String(value || "").replace(/^v/, ""));
}

function normalizeReleaseNotes(entries, currentVersion, targetVersion) {
  const current = releaseVersion(currentVersion);
  const target = releaseVersion(targetVersion);
  if (!current || !target) return [];
  const versions = new Map();
  for (const entry of entries) {
    const version = releaseVersion(entry?.version);
    if (!version || !semver.gt(version, current) || !semver.lte(version, target)) continue;
    if (!semver.prerelease(target) && semver.prerelease(version)) continue;
    if (versions.has(version)) continue;
    const date = new Date(entry.releaseDate || "");
    versions.set(version, {
      version,
      releaseDate: Number.isFinite(date.getTime()) ? date.toISOString() : "",
      notes: String(entry.notes || "").slice(0, MAX_NOTE_LENGTH),
    });
  }
  return [...versions.values()].sort((a, b) => semver.rcompare(a.version, b.version));
}

function notesFromUpdateInfo(info, currentVersion) {
  const entries = Array.isArray(info?.releaseNotes)
    ? info.releaseNotes.map((item) => ({ version: item?.version, notes: item?.note }))
    : [{ version: info?.version, notes: info?.releaseNotes }];
  // The updater's Atom fallback contains HTML; keep a readable plain-text
  // fallback. The Releases API supplies the original Markdown when available.
  for (const entry of entries) {
    if (releaseVersion(entry.version) === releaseVersion(info?.version)) entry.releaseDate = info?.releaseDate;
    entry.notes = String(entry.notes || "")
      .replace(/<\/(?:p|h[1-6]|ul|ol|div)>|<br\s*\/?\s*>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, "")
      .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity]);
  }
  entries.push({ version: info?.version, notes: "", releaseDate: info?.releaseDate });
  return normalizeReleaseNotes(entries, currentVersion, info?.version);
}

// Release feeds can contain only a handful of recent entries. Paginate the
// published releases so skipped versions are included even across long gaps.
// Failure is non-fatal: checking/downloading the installer remains independent.
async function fetchUpdateReleaseNotes({ fetch, currentVersion, targetVersion, fallback = [], maxPages = 5, timeoutMs = 12_000 }) {
  const entries = [];
  const signal = AbortSignal.timeout(timeoutMs);
  let complete = false;
  try {
    for (let page = 1; page <= maxPages; page++) {
      const response = await fetch(`${RELEASES_URL}?per_page=100&page=${page}`, {
        headers: { Accept: "application/vnd.github+json" }, signal,
      });
      if (!response.ok) throw new Error(`Release notes HTTP ${response.status}`);
      const releases = await response.json();
      if (!Array.isArray(releases)) throw new Error("Invalid release history");
      for (const release of releases) {
        if (release.draft || (release.prerelease && !semver.prerelease(targetVersion))) continue;
        entries.push({ version: release.tag_name, releaseDate: release.published_at, notes: release.body });
      }
      if (releases.length < 100) { complete = true; break; }
    }
  } catch {
    // Keep any pages already fetched, and the updater's own feed as fallback.
  }
  const releaseNotes = normalizeReleaseNotes([...entries, ...fallback], currentVersion, targetVersion);
  const hasTarget = entries.some((entry) => releaseVersion(entry.version) === releaseVersion(targetVersion));
  return { releaseNotes, releaseNotesStatus: complete && hasTarget ? "ready" : "partial" };
}

module.exports = { normalizeReleaseNotes, notesFromUpdateInfo, fetchUpdateReleaseNotes };

const fs = require('node:fs');
const semver = require('semver');

const statusMarker = '<!-- loop-release-status -->';
const failedConclusions = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required']);

function managedDraft(release) {
  return release.draft === true && release.author?.login === 'github-actions[bot]' &&
    /^v\d+\.\d+\.\d+$/.test(release.tag_name) &&
    /^[a-f0-9]{40}$/.test(release.target_commitish) && Array.isArray(release.assets);
}

async function releaseRun(api, release) {
  const result = await api('actions/runs?head_sha=' + release.target_commitish + '&per_page=100');
  const runs = result.workflow_runs.filter(run => run.name === 'Release Desktop Apps' &&
    run.head_sha === release.target_commitish &&
    [release.tag_name, 'release/' + release.tag_name].includes(run.head_branch));
  if (runs.some(run => run.status !== 'completed')) return null;
  return runs.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0] || null;
}

async function maintainReleaseDrafts(api) {
  let latest;
  try { latest = await api('releases/latest'); }
  catch (error) { if (error.status !== 404) throw error; }
  const releases = [];
  for (let page = 1; ; page++) {
    if (page > 10) throw Error('Release pagination limit reached');
    const batch = await api('releases?per_page=100&page=' + page);
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const changes = [];
  const newest = releases.filter(release => !release.draft && !release.prerelease && semver.valid(release.tag_name))
    .sort((a, b) => semver.rcompare(a.tag_name, b.tag_name))[0];
  if (newest && (!latest || !semver.valid(latest.tag_name) || semver.gt(newest.tag_name, latest.tag_name))) {
    await api('releases/' + newest.id, 'PATCH', { tag_name: newest.tag_name, make_latest: 'true' });
    latest = newest;
    changes.push({ tag: newest.tag_name, action: 'restored latest version', run: newest.html_url });
  }
  for (const release of releases.filter(managedDraft)) {
    const run = await releaseRun(api, release);
    if (!run || !failedConclusions.has(run.conclusion)) continue;
    let current;
    try { current = await api('releases/' + release.id); }
    catch (error) { if (error.status === 404) continue; throw error; }
    if (!managedDraft(current) || current.tag_name !== release.tag_name ||
        current.target_commitish !== release.target_commitish) continue;
    const obsolete = latest && semver.valid(latest.tag_name) &&
      semver.lt(current.tag_name, latest.tag_name);
    if (obsolete && current.assets.length === 0) {
      // Recheck the run after reading the draft. A retry that starts before
      // this point keeps the draft available to its native build jobs.
      const freshRun = await releaseRun(api, current);
      if (!freshRun || !failedConclusions.has(freshRun.conclusion)) continue;
      try { await api('releases/' + current.id, 'DELETE'); }
      catch (error) { if (error.status !== 404) throw error; }
      changes.push({ tag: current.tag_name, action: 'removed empty failed draft', run: freshRun.html_url });
      continue;
    }
    const original = String(current.body || '').split(statusMarker)[0].trimEnd();
    const name = current.tag_name + '（发布失败，未公开）';
    const body = original + '\n\n' + statusMarker +
      '\n\n此版本发布未完成，尚未公开。对应任务结果为 ' + run.conclusion +
      '。可从[发布任务](' + run.html_url + ')检查原因并重试。\n';
    if (current.name !== name || current.body !== body) {
      await api('releases/' + current.id, 'PATCH', { tag_name: current.tag_name, target_commitish: current.target_commitish, draft: true, name, body });
      changes.push({ tag: current.tag_name, action: 'marked failed draft', run: run.html_url });
    }
  }
  return changes;
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw Error('Draft maintenance is restricted to GitHub Actions');
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !process.env.GH_TOKEN) throw Error('Missing repository or workflow token');
  const api = async (route, method = 'GET', body) => {
    const response = await fetch('https://api.github.com/repos/' + repo + '/' + route, {
      method,
      headers: {
        Authorization: 'Bearer ' + process.env.GH_TOKEN,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const error = Error('GitHub ' + method + ' ' + route + ': HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  };
  const changes = await maintainReleaseDrafts(api);
  console.log(JSON.stringify(changes));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = changes.map(change => '- ' + change.tag + ' · ' + change.action + ' · [发布任务](' + change.run + ')');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['## 发布草稿整理', '', ...lines, '', '版本标签与 Actions 日志保留。', ''].join('\n'));
  }
}

module.exports = { managedDraft, maintainReleaseDrafts, statusMarker };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

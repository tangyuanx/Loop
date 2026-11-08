// Recover only the final publication. Original source/native gates and their
// manifests stay authoritative; no tag, installer or update feed is rebuilt.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {findRelease, requiredNames, validateManifests, validateRemoteRelease, shouldMakeLatest, assertReleaseTag} = require('./release-draft.cjs');
const {managedDraft, statusMarker} = require('./maintain-release-drafts.cjs');

function orphanedCandidate(release, tag, sha) {
  if (!release.draft || release.prerelease || release.author?.login !== 'github-actions[bot]' ||
      !/^untagged-[a-f0-9]+$/.test(release.tag_name) || release.target_commitish !== sha ||
      release.name !== tag + '（发布失败，未公开）' || !String(release.body || '').includes(statusMarker)) return false;
  const names = [...requiredNames('macOS',tag.slice(1)), ...requiredNames('Windows',tag.slice(1))].sort();
  return Array.isArray(release.assets) && release.assets.length === names.length &&
    release.assets.every(a=>a.state==='uploaded'&&a.size>0&&/^sha256:[a-f0-9]{64}$/.test(a.digest||'')) &&
    JSON.stringify(release.assets.map(a=>a.name).sort()) === JSON.stringify(names);
}

async function verifiedPublication(api, repo, request) {
  const tag = String(request || '').replace(/^codex\/release-resume\//, '');
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw Error('Expected an existing stable release tag');
  let target = (await api('git/ref/tags/' + tag)).object;
  for (let depth = 0; target?.type === 'tag' && depth < 8; depth++) target = (await api('git/tags/' + target.sha)).object;
  if (target?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(target.sha)) throw Error('Invalid candidate tag target');
  const sha = target.sha;
  const runs = (await api('actions/runs?head_sha=' + sha + '&per_page=100')).workflow_runs.filter(run =>
    run.name === 'Release Desktop Apps' && run.path?.split('@')[0] === '.github/workflows/release.yml' &&
    run.event === 'push' && run.head_repository?.full_name === repo && run.head_sha === sha &&
    [tag, 'release/' + tag].includes(run.head_branch));
  if (runs.some(run => run.status !== 'completed')) throw Error('A candidate release run is still active');
  const run = runs.sort((a,b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
  if (!run || run.conclusion !== 'failure') throw Error('No failed final publication to resume');
  const jobs = (await api('actions/runs/' + run.id + '/jobs?filter=latest&per_page=100')).jobs;
  for (const name of ['Check source and prepare unpublished release', 'Release macOS', 'Release Windows']) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') throw Error('Required gate did not succeed: ' + name);
  }
  const publish = jobs.filter(job => job.name === 'Publish complete verified release');
  if (publish.length !== 1 || publish[0].status !== 'completed' || publish[0].conclusion !== 'failure') throw Error('Only a failed final publication can be resumed');
  const artifacts = (await api('actions/runs/' + run.id + '/artifacts?per_page=100')).artifacts;
  for (const name of ['release-manifest-macOS', 'release-manifest-Windows']) {
    const matches = artifacts.filter(artifact => artifact.name === name);
    if (matches.length !== 1 || matches[0].expired || matches[0].size_in_bytes <= 0) throw Error('Missing original verification manifest: ' + name);
  }
  let release = await findRelease(api, tag), orphanedTag = false;
  if (!release) {
    const matches=[];
    for(let page=1;page<=10;page++){
      const batch=await api('releases?per_page=100&page='+page);
      matches.push(...batch.filter(r=>orphanedCandidate(r,tag,sha)));
      if(batch.length<100)break;
      if(page===10)throw Error('Recovery draft pagination limit reached');
    }
    if(matches.length!==1)throw Error('No unique original unpublished draft');
    release=matches[0];orphanedTag=true;
  }
  if (!orphanedTag && (!managedDraft(release) || release.prerelease || release.target_commitish !== sha)) throw Error('Candidate is not the original unpublished managed draft');
  return {tag, sha, version: tag.slice(1), runId: run.id, releaseId: release.id, ...(orphanedTag?{orphanedTag:true}:{})};
}

async function publishVerified(api, candidate, manifests, checkoutSha, checkoutVersion) {
  if (checkoutSha !== candidate.sha || checkoutVersion !== candidate.version) throw Error('Candidate checkout does not match the original release');
  const assets = validateManifests(manifests, candidate.version, candidate.sha);
  const release = await api('releases/' + candidate.releaseId);
  if (candidate.orphanedTag ? !orphanedCandidate(release,candidate.tag,candidate.sha) : (!managedDraft(release) || release.target_commitish !== candidate.sha)) throw Error('Original draft identity changed');
  validateRemoteRelease(candidate.orphanedTag?{...release,tag_name:candidate.tag}:release, assets, candidate.tag);
  let latest;
  try { latest = await api('releases/latest'); } catch (error) { if (error.status !== 404) throw error; }
  // Existing tags are independently verified. target_commitish is a tag-
  // creation parameter; sending it here unnecessarily requests workflow-write
  // authorization for historical commits whose workflow differs from main.
  await assertReleaseTag(api,candidate.tag,candidate.sha);
  const result = await api('releases/' + release.id, 'PATCH', {
    tag_name: candidate.tag, draft: false, name: candidate.tag,
    body: String(release.body || '').split(statusMarker)[0].trimEnd(),
    make_latest: shouldMakeLatest(candidate.version, latest?.tag_name) ? 'true' : 'false',
  });
  if (result.draft) throw Error('Release is still unpublished');
  return result;
}

async function main(command) {
  if (process.env.GITHUB_ACTIONS !== 'true') throw Error('Publication recovery is restricted to GitHub Actions');
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !process.env.GH_TOKEN) throw Error('Missing repository or workflow token');
  const api = async (route, method = 'GET', body) => {
    const response = await fetch('https://api.github.com/repos/' + repo + '/' + route, {
      method, headers: {Authorization: 'Bearer ' + process.env.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache'},
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const detail=await response.json().catch(()=>({}));
      const error = Error('GitHub ' + method + ' ' + route + ': HTTP ' + response.status + (detail.message?' · '+detail.message:''));
      error.status = response.status; throw error;
    }
    return response.json();
  };
  const candidate = await verifiedPublication(api, repo, process.env.RELEASE_REQUEST);
  if (command === 'inspect') {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${candidate.tag}\nsha=${candidate.sha}\nrun_id=${candidate.runId}\n`);
    console.log('Verified original source and both native gates for ' + candidate.tag);
  } else if (command === 'publish') {
    const directory = path.resolve('release-candidate');
    const sha = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
    const version = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
    const manifests = ['macOS', 'Windows'].map(platform => JSON.parse(fs.readFileSync(path.join('release-manifests', platform + '.json'), 'utf8')));
    const published = await publishVerified(api, candidate, manifests, sha, version);
    console.log('Published original ' + candidate.tag + ': 12 verified assets; ' + published.html_url);
  } else throw Error('Expected inspect or publish');
}

module.exports = {verifiedPublication, publishVerified};
if (require.main === module) main(process.argv[2]).catch(error => {console.error(error.message);process.exitCode=1;});

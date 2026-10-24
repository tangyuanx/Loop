// Installers go straight from native runners to a draft. The final job only
// exchanges small manifests and checks GitHub's server-computed SHA-256 values.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {parseUpdateMetadata} = require('./verify-update-artifacts.cjs');

function requiredNames(platform, version) {
  if (platform === 'macOS') return ['latest-mac.yml', ...['x64', 'arm64'].flatMap(arch => ['dmg', 'zip'].flatMap(ext => {
    const name = `Loop-${version}-${arch}.${ext}`; return [name, name + '.blockmap'];
  }))];
  if (platform === 'Windows') return ['latest.yml', `Loop-${version}-x64-setup.exe`, `Loop-${version}-x64-setup.exe.blockmap`];
  throw Error('Unknown release platform: ' + platform);
}

function hashBytes(bytes, algorithm, encoding = 'hex') { return crypto.createHash(algorithm).update(bytes).digest(encoding); }
function describeFile(directory, name) {
  const file = path.join(directory, name), sha256 = crypto.createHash('sha256'), sha512 = crypto.createHash('sha512');
  const fd = fs.openSync(file, 'r'), buffer = Buffer.allocUnsafe(1024 * 1024);
  try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) { sha256.update(buffer.subarray(0, count)); sha512.update(buffer.subarray(0, count)); } }
  finally { fs.closeSync(fd); }
  return {name, size: fs.statSync(file).size, sha256: sha256.digest('hex'), sha512: sha512.digest('base64')};
}

function createManifest(directory, platform, version, sha) {
  const assets = requiredNames(platform, version).map(name => describeFile(directory, name));
  const metadata = Object.fromEntries(assets.filter(a => a.name.endsWith('.yml')).map(a => [a.name, fs.readFileSync(path.join(directory, a.name), 'utf8')]));
  const manifest = {schema: 1, platform, tag: 'v' + version, version, sha, assets, metadata};
  validateManifests([manifest], version, sha, [platform]);
  return manifest;
}

function validateManifests(manifests, version, sha, platforms = ['macOS', 'Windows']) {
  const expected = platforms.flatMap(platform => requiredNames(platform, version)), assets = new Map();
  if (manifests.length !== platforms.length || new Set(manifests.map(m => m.platform)).size !== platforms.length) throw Error('Missing or duplicate platform manifests');
  for (const manifest of manifests) {
    if (manifest.schema !== 1 || !platforms.includes(manifest.platform) || manifest.version !== version || manifest.tag !== 'v' + version || manifest.sha !== sha) throw Error('Release manifest version, commit or platform mismatch');
    const names = requiredNames(manifest.platform, version);
    if (manifest.assets.length !== names.length) throw Error('Incomplete platform asset set');
    for (const asset of manifest.assets) {
      if (!names.includes(asset.name) || assets.has(asset.name)) throw Error('Unexpected or duplicate release asset');
      if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^[a-f0-9]{64}$/.test(asset.sha256) || !/^[A-Za-z0-9+/]{86}==$/.test(asset.sha512)) throw Error('Invalid release asset digest or size');
      assets.set(asset.name, asset);
    }
    const feedName = manifest.platform === 'macOS' ? 'latest-mac.yml' : 'latest.yml';
    if (Object.keys(manifest.metadata).length !== 1 || typeof manifest.metadata[feedName] !== 'string' || Buffer.byteLength(manifest.metadata[feedName]) > 32768) throw Error('Missing or invalid update feed');
    const bytes = Buffer.from(manifest.metadata[feedName]), feedAsset = assets.get(feedName);
    if (bytes.length !== feedAsset.size || hashBytes(bytes, 'sha256') !== feedAsset.sha256 || hashBytes(bytes, 'sha512', 'base64') !== feedAsset.sha512) throw Error('Update feed content digest mismatch');
    const feed = parseUpdateMetadata(bytes.toString());
    if (feed.version !== version || !feed.files.length) throw Error('Update feed version or files mismatch');
    const targets = [...feed.files];
    if (feed.path && !targets.some(t => t.url === feed.path)) targets.push({url: feed.path, sha512: feed.sha512});
    for (const target of targets) {
      const asset = assets.get(target.url);
      if (!asset || !names.includes(target.url)) throw Error('Update feed references missing or cross-platform artifact');
      const digest = /^[a-f0-9]{128}$/i.test(target.sha512 || '') ? Buffer.from(target.sha512, 'hex').toString('base64') : target.sha512;
      if (asset.sha512 !== digest || (target.size && Number(target.size) !== asset.size)) throw Error('Update feed artifact digest or size mismatch');
    }
  }
  if (assets.size !== expected.length || expected.some(name => !assets.has(name))) throw Error('Incomplete cross-platform release');
  return assets;
}

function validateRemoteRelease(release, assets, tag) {
  if (release.tag_name !== tag || release.draft !== true) throw Error('Refusing to modify a published or mismatched release');
  if (release.assets.length !== assets.size) throw Error('Remote release asset set is incomplete or contains unexpected files');
  const seen = new Set();
  for (const remote of release.assets) {
    const local = assets.get(remote.name);
    if (!local || seen.has(remote.name) || remote.state !== 'uploaded' || remote.size !== local.size || remote.digest !== 'sha256:' + local.sha256) throw Error('Remote asset digest, size or state mismatch: ' + remote.name);
    seen.add(remote.name);
  }
}

async function findRelease(api, tag) {
  try { return await api('releases/tags/' + encodeURIComponent(tag)); }
  catch (error) { if (error.status !== 404) throw error; }
  // The tag endpoint only finds published releases. Authenticated release
  // listings include drafts; subsequent jobs use the numeric ID directly.
  for (let page = 1; page <= 10; page++) {
    const releases = await api(`releases?per_page=100&page=${page}`);
    const release = releases.find(r => r.tag_name === tag);
    if (release) return release;
    if (releases.length < 100) return null;
  }
  throw Error('Draft lookup pagination limit reached; refusing to create a duplicate');
}

async function run(command) {
  if (process.env.GITHUB_ACTIONS !== 'true') throw Error('Release mutation is restricted to GitHub Actions');
  const repo = process.env.GITHUB_REPOSITORY, sha = process.env.GITHUB_SHA, version = require('../package.json').version, tag = process.env.GITHUB_REF_NAME;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^[a-f0-9]{40}$/.test(sha || '') || tag !== 'v' + version || !process.env.GH_TOKEN) throw Error('Invalid release identity or missing workflow token');
  if (execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim() !== sha) throw Error('Checkout does not match the release commit');
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${route}`, {
      method, headers: {Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache'},
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) { const error = Error(`GitHub ${method} ${route}: HTTP ${response.status}`); error.status = response.status; throw error; }
    return response.json();
  };
  const getRelease = async () => {
    if (/^[1-9]\d*$/.test(process.env.RELEASE_ID || '')) return api('releases/' + process.env.RELEASE_ID);
    const release = await findRelease(api, tag);
    if (!release) throw Error('Release draft is missing');
    return release;
  };
  if (command === 'prepare') {
    let release = await findRelease(api, tag);
    if (!release) {
      const notes = path.join('docs', 'release-notes', tag + '.md');
      release = await api('releases', 'POST', {tag_name: tag, target_commitish: sha, name: tag, draft: true, prerelease: version.includes('-'),
        ...(fs.existsSync(notes) ? {body: fs.readFileSync(notes, 'utf8')} : {generate_release_notes: true})});
    }
    if (release.tag_name !== tag || !release.draft) throw Error('Release is already published; use a new version');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_id=${release.id}\n`);
    console.log(`Prepared draft ${tag}; it stays unpublished until all platform gates succeed.`);
  } else if (command === 'upload') {
    const platform = process.env.RELEASE_PLATFORM, directory = path.resolve('release');
    const manifest = createManifest(directory, platform, version, sha), release = await getRelease();
    if (!release.draft || release.tag_name !== tag) throw Error('Refusing to upload to a published release');
    execFileSync('gh', ['release', 'upload', tag, ...manifest.assets.map(a => path.join(directory, a.name)), '--repo', repo, '--clobber'], {stdio: 'inherit'});
    const uploaded = await getRelease();
    for (const asset of manifest.assets) {
      const remote = uploaded.assets.find(a => a.name === asset.name);
      if (!remote || remote.state !== 'uploaded' || remote.size !== asset.size || remote.digest !== 'sha256:' + asset.sha256) throw Error('Uploaded asset failed server digest verification: ' + asset.name);
    }
    fs.mkdirSync('release-manifests', {recursive: true});
    fs.writeFileSync(path.join('release-manifests', platform + '.json'), JSON.stringify(manifest, null, 2));
    console.log(`Verified ${manifest.assets.length} ${platform} assets in draft ${tag}.`);
  } else if (command === 'publish') {
    const manifests = ['macOS', 'Windows'].map(platform => JSON.parse(fs.readFileSync(path.join('release-manifests', platform + '.json'), 'utf8')));
    const assets = validateManifests(manifests, version, sha), release = await getRelease();
    validateRemoteRelease(release, assets, tag);
    const published = await api('releases/' + release.id, 'PATCH', {draft: false, make_latest: version.includes('-') ? 'false' : 'true'});
    if (published.draft) throw Error('Release is still a draft');
    console.log(`Published ${tag}: ${assets.size} verified assets; ${published.html_url}`);
  } else throw Error('Expected prepare, upload or publish');
}

module.exports = {requiredNames, createManifest, validateManifests, validateRemoteRelease, findRelease};
if (require.main === module) run(process.argv[2]).catch(error => {console.error(error.message); process.exitCode = 1;});

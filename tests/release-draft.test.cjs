const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {requiredNames, createManifest, validateManifests, validateRemoteRelease, findRelease, resolveReleaseTag, ensureReleaseTag} = require('../tools/release-draft.cjs');
const version = '0.1.239', sha = 'a'.repeat(40), tag = 'v' + version;

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-release-manifest-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const manifests = ['macOS', 'Windows'].map(platform => {
    const names = requiredNames(platform, version), directoryForPlatform = path.join(directory, platform);
    fs.mkdirSync(directoryForPlatform);
    for (const name of names) if (!name.endsWith('.yml')) fs.writeFileSync(path.join(directoryForPlatform, name), 'fixture:' + name);
    const binaries = names.filter(n => /\.(zip|dmg|exe)$/.test(n));
    const records = binaries.map(name => {
      const body = fs.readFileSync(path.join(directoryForPlatform, name));
      return {name, size:body.length, digest:crypto.createHash('sha512').update(body).digest('base64')};
    });
    const feed = ['version: ' + version, 'files:', ...records.flatMap(r => [`  - url: ${r.name}`, `    sha512: ${r.digest}`, `    size: ${r.size}`]), `path: ${records[0].name}`, `sha512: ${records[0].digest}`, ''].join('\n');
    fs.writeFileSync(path.join(directoryForPlatform, names.find(n => n.endsWith('.yml'))), feed);
    return createManifest(directoryForPlatform, platform, version, sha);
  });
  const assets = validateManifests(manifests, version, sha);
  const remote = {tag_name:tag, draft:true, assets:[...assets.values()].map(a => ({name:a.name, size:a.size, digest:'sha256:' + a.sha256, state:'uploaded'}))};
  return {manifests, assets, remote};
}

test('both platforms provide all 12 real-byte-verified draft assets', t => {
  const {assets, remote} = fixture(t); assert.equal(assets.size, 12); validateRemoteRelease(remote, assets, tag);
});
test('a missing or duplicated platform cannot publish', t => {
  const {manifests} = fixture(t);
  assert.throws(() => validateManifests([manifests[0]], version, sha), /platform/);
  assert.throws(() => validateManifests([manifests[0], manifests[0]], version, sha), /platform/);
});
test('a stale commit or version cannot supply the current release', t => {
  const {manifests} = fixture(t);
  for (const field of ['sha','version','tag']) {
    const changed = structuredClone(manifests); changed[0][field] = 'stale';
    assert.throws(() => validateManifests(changed, version, sha), /mismatch/);
  }
});
test('feed contents must match the bytes hashed by the native runner', t => {
  const {manifests} = fixture(t); manifests[0].metadata['latest-mac.yml'] += '# changed';
  assert.throws(() => validateManifests(manifests, version, sha), /content digest/);
});
test('feed SHA-512 and artifact SHA-512 must agree', t => {
  const {manifests} = fixture(t); manifests[0].assets.find(a => a.name.endsWith('.zip')).sha512 = Buffer.alloc(64).toString('base64');
  assert.throws(() => validateManifests(manifests, version, sha), /artifact digest/);
});
test('missing or substituted platform files cannot publish', t => {
  const {manifests} = fixture(t), missing = structuredClone(manifests); missing[0].assets.pop();
  assert.throws(() => validateManifests(missing, version, sha), /Incomplete/);
  const changed = structuredClone(manifests); changed[0].assets[1].name = '../unexpected.zip';
  assert.throws(() => validateManifests(changed, version, sha), /Unexpected/);
});
test('server digest, file size and completed upload are required for every asset', t => {
  const {assets, remote} = fixture(t);
  for (const [field,value] of [['digest',null], ['digest','sha256:' + '0'.repeat(64)], ['size',0], ['state','starter']]) {
    const changed = structuredClone(remote); changed.assets[0][field] = value;
    assert.throws(() => validateRemoteRelease(changed, assets, tag), /Remote asset/);
  }
  const missing = structuredClone(remote); missing.assets.pop(); assert.throws(() => validateRemoteRelease(missing, assets, tag), /incomplete/);
  const duplicate = structuredClone(remote); duplicate.assets[1] = duplicate.assets[0]; assert.throws(() => validateRemoteRelease(duplicate, assets, tag), /Remote asset/);
});
test('published releases and other tags are immutable to this flow', t => {
  const {assets, remote} = fixture(t);
  assert.throws(() => validateRemoteRelease({...remote,draft:false}, assets, tag), /published/);
  assert.throws(() => validateRemoteRelease({...remote,tag_name:'v0.1.238'}, assets, tag), /mismatched/);
});
test('release mutations are refused outside the Actions environment', () => {
  const env = {...process.env}; delete env.GITHUB_ACTIONS; delete env.GH_TOKEN;
  const result = spawnSync(process.execPath, [path.join(__dirname, '../tools/release-draft.cjs'), 'publish'], {env,encoding:'utf8'});
  assert.equal(result.status, 1); assert.match(result.stderr, /restricted to GitHub Actions/);
});
test('draft lookup falls back from the published tag endpoint to authenticated listings', async () => {
  const draft = {id:123,tag_name:tag,draft:true}, calls = [];
  const found = await findRelease(async route => {
    calls.push(route); if (route.startsWith('releases/tags/')) throw Object.assign(Error('not published'), {status:404});
    return [draft];
  }, tag);
  assert.equal(found, draft); assert.equal(calls.length, 2);
});
test('draft lookup distinguishes an absent release from access failures', async () => {
  assert.equal(await findRelease(async route => {if (route.startsWith('releases/tags/')) throw Object.assign(Error('missing'), {status:404}); return [];}, tag), null);
  await assert.rejects(findRelease(async () => {throw Object.assign(Error('denied'), {status:403});}, tag), /denied/);
});

test('only the exact version tag or release branch can enter the release pipeline', () => {
  assert.equal(resolveReleaseTag(tag, 'tag', version), tag);
  assert.equal(resolveReleaseTag('release/' + tag, 'branch', version), tag);
  for (const [ref, type] of [['main','branch'], [tag,'branch'], ['release/v0.1.238','branch'], ['v0.1.238','tag'], ['release/' + tag,'tag']]) {
    assert.throws(() => resolveReleaseTag(ref, type, version), /does not match/);
  }
});

test('release branches create and verify an absent tag exactly once', async () => {
  const calls = []; let created = false;
  await ensureReleaseTag(async (route, method, body) => {
    calls.push({route, method, body});
    if (method === 'POST') { created = true; return {}; }
    if (!created) throw Object.assign(Error('missing'), {status:404});
    return {object:{type:'commit',sha}};
  }, tag, sha);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1], {route:'git/refs', method:'POST', body:{ref:'refs/tags/' + tag,sha}});
});

test('release branches reuse matching tags but never move another commit or ignore access errors', async () => {
  const calls = [];
  await ensureReleaseTag(async (route, method) => { calls.push(method); return {object:{type:'commit',sha}}; }, tag, sha);
  assert.equal(calls.length, 1);
  await assert.rejects(ensureReleaseTag(async () => ({object:{type:'commit',sha:'b'.repeat(40)}}), tag, sha), /refusing to replace/);
  await assert.rejects(ensureReleaseTag(async () => {throw Object.assign(Error('denied'), {status:403});}, tag, sha), /denied/);
  await ensureReleaseTag(async route => ({object:{type:route.startsWith('git/tags/')?'commit':'tag',sha}}), tag, sha);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {requiredNames, createManifest, validateManifests, validateRemoteRelease, findRelease, resolveReleaseTag, ensureReleaseTag, shouldMakeLatest} = require('../tools/release-draft.cjs');
const {maintainReleaseDrafts, statusMarker} = require('../tools/maintain-release-drafts.cjs');
const {verifiedPublication, publishVerified} = require('../tools/resume-release-publication.cjs');
const version = '0.1.239', sha = 'a'.repeat(40), tag = 'v' + version;

function publicationFixture(t) {
  const original = fixture(t), repo = 'owner/repo', writes = [];
  const release = {...original.remote, id:9, author:{login:'github-actions[bot]'},target_commitish:sha,prerelease:false,body:'Original release notes\n'+statusMarker+'\nFailed publication'};
  const run = {id:13,name:'Release Desktop Apps',path:'.github/workflows/release.yml',event:'push',head_repository:{full_name:repo},head_sha:sha,head_branch:tag,status:'completed',conclusion:'failure',updated_at:'2026-11-08T00:00:00Z'};
  const jobs = ['Check source and prepare unpublished release','Release macOS','Release Windows','Publish complete verified release'].map(name=>({name,status:'completed',conclusion:name.startsWith('Publish')?'failure':'success'}));
  const artifacts = ['macOS','Windows'].map(platform=>({name:'release-manifest-'+platform,expired:false,size_in_bytes:1000}));
  const state = {release,run,jobs,artifacts,latest:'v0.1.238'};
  const api = async (route,method='GET',body)=>{
    if(method!=='GET'){writes.push({route,method,body});return {...release,...body,html_url:'https://github.com/owner/repo/releases/tag/'+tag};}
    if(route==='git/ref/tags/'+tag)return {object:{type:'commit',sha}};
    if(route.startsWith('actions/runs?'))return {workflow_runs:[run]};
    if(route.includes('/jobs?'))return {jobs};
    if(route.includes('/artifacts?'))return {artifacts};
    if(route.startsWith('releases?'))return [release];
    if(route==='releases/tags/'+tag)return release;
    if(route==='releases/9')return release;
    if(route==='releases/latest')return {tag_name:state.latest};
    throw Error('Unexpected API route: '+route);
  };
  return {...original,repo,state,api,writes};
}

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
test('publication recovery reuses the original verified candidate and cleans its failure label',async t=>{
  const f=publicationFixture(t),candidate=await verifiedPublication(f.api,f.repo,'codex/release-resume/'+tag);
  assert.deepEqual(candidate,{tag,sha,version,runId:13,releaseId:9});
  const result=await publishVerified(f.api,candidate,f.manifests,sha,version);
  assert.equal(result.draft,false);assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].body.name,tag);assert.equal(f.writes[0].body.body,'Original release notes');assert.equal(f.writes[0].body.make_latest,'true');
});
test('publication recovery refuses failed native gates and active retries',async t=>{
  const f=publicationFixture(t);f.state.jobs.find(j=>j.name==='Release Windows').conclusion='failure';
  await assert.rejects(verifiedPublication(f.api,f.repo,tag),/Required gate/);assert.deepEqual(f.writes,[]);
  f.state.jobs.find(j=>j.name==='Release Windows').conclusion='success';f.state.run.status='in_progress';
  await assert.rejects(verifiedPublication(f.api,f.repo,tag),/still active/);
});
test('publication recovery rejects foreign workflows, repositories and refs',async t=>{
  const f=publicationFixture(t);
  for(const [key,value] of [['path','other.yml'],['head_branch','main'],['event','pull_request']]){
    const saved=f.state.run[key];f.state.run[key]=value;await assert.rejects(verifiedPublication(f.api,f.repo,tag),/No failed/);f.state.run[key]=saved;
  }
  f.state.run.head_repository.full_name='foreign/repo';await assert.rejects(verifiedPublication(f.api,f.repo,tag),/No failed/);
  await assert.rejects(verifiedPublication(f.api,f.repo,'v1.2.3\nunsafe'),/stable release tag/);assert.deepEqual(f.writes,[]);
});
test('publication recovery requires original unexpired manifests and an unpublished bot draft',async t=>{
  const f=publicationFixture(t);f.state.artifacts[0].expired=true;await assert.rejects(verifiedPublication(f.api,f.repo,tag),/original verification manifest/);
  f.state.artifacts[0].expired=false;f.state.release.draft=false;await assert.rejects(verifiedPublication(f.api,f.repo,tag),/original unpublished/);
  f.state.release.draft=true;f.state.release.target_commitish='b'.repeat(40);await assert.rejects(verifiedPublication(f.api,f.repo,tag),/original unpublished/);assert.deepEqual(f.writes,[]);
});
test('publication recovery rejects substituted checkouts, manifests and server bytes',async t=>{
  const f=publicationFixture(t),candidate=await verifiedPublication(f.api,f.repo,tag);
  await assert.rejects(publishVerified(f.api,candidate,f.manifests,'b'.repeat(40),version),/checkout/);
  const changed=structuredClone(f.manifests);changed[0].sha='b'.repeat(40);await assert.rejects(publishVerified(f.api,candidate,changed,sha,version),/mismatch/);
  f.state.release.assets[0].digest='sha256:'+'0'.repeat(64);await assert.rejects(publishVerified(f.api,candidate,f.manifests,sha,version),/digest/);assert.deepEqual(f.writes,[]);
});
test('publication recovery keeps a newer Latest release',async t=>{
  const f=publicationFixture(t),candidate=await verifiedPublication(f.api,f.repo,tag);f.state.latest='v1.0.0';
  await publishVerified(f.api,candidate,f.manifests,sha,version);assert.equal(f.writes[0].body.make_latest,'false');
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

test('retrying an older release cannot take Latest from a newer published version', () => {
  assert.equal(shouldMakeLatest('0.2.8','v0.2.11'),false);
  assert.equal(shouldMakeLatest('0.2.12','v0.2.11'),true);
  assert.equal(shouldMakeLatest('0.2.11','v0.2.11'),true);
  assert.equal(shouldMakeLatest('0.2.12-beta.1','v0.2.11'),false);
  assert.equal(shouldMakeLatest('0.2.12',null),true);
  assert.throws(()=>shouldMakeLatest('0.2.12','unknown'),/Invalid/);
});

function draftMaintenance({tag='v0.2.8',assets=[],draft=true,author='github-actions[bot]',runStatus='completed',freshDraft=draft}={}) {
  const release={id:1,tag_name:tag,name:tag,draft,assets,author:{login:author},target_commitish:sha,body:'Original release notes'};
  const calls=[];
  const api=async(route,method='GET',body)=>{
    calls.push({route,method,body});
    if(method==='DELETE')return null;
    if(method==='PATCH'){Object.assign(release,body);return {...release};}
    if(route==='releases/latest')return {tag_name:'v0.2.11',draft:false};
    if(route.startsWith('releases?'))return [{...release}];
    if(route==='releases/1')return {...release,draft:freshDraft};
    if(route.startsWith('actions/runs?'))return {workflow_runs:[{
      name:'Release Desktop Apps',head_sha:sha,head_branch:tag,status:runStatus,
      conclusion:'failure',updated_at:'2026-11-07T15:07:00Z',html_url:'https://github.com/owner/repo/actions/runs/1',
    }]};
    throw Error('Unexpected request '+route);
  };
  return {release,calls,api};
}

test('maintenance only removes a superseded, empty, failed automation draft', async()=>{
  const fixture=draftMaintenance();
  const changes=await maintainReleaseDrafts(fixture.api);
  assert.equal(changes[0].action,'removed empty failed draft');
  assert.deepEqual(fixture.calls.filter(call=>call.method==='DELETE').map(call=>call.route),['releases/1']);
  assert.equal(fixture.calls.filter(call=>call.route.startsWith('actions/runs?')).length,2);
  assert.equal(fixture.calls.some(call=>call.route.startsWith('git/')),false);
});

test('published, manually authored and active release drafts are preserved',async()=>{
  for(const options of [{draft:false},{author:'maintainer'},{runStatus:'in_progress'},{freshDraft:false}]){
    const fixture=draftMaintenance(options);
    assert.deepEqual(await maintainReleaseDrafts(fixture.api),[]);
    assert.equal(fixture.calls.some(call=>call.method!=='GET'),false);
  }
});

test('failed current drafts and partial uploads are labeled for retry with their notes intact',async()=>{
  for(const options of [{tag:'v0.2.12'},{assets:[{name:'partial.zip'}]}]){
    const fixture=draftMaintenance(options);
    const changes=await maintainReleaseDrafts(fixture.api);
    assert.equal(changes[0].action,'marked failed draft');
    assert.match(fixture.release.name,/发布失败/);
    assert.ok(fixture.release.body.startsWith('Original release notes'));
    assert.ok(fixture.release.body.includes(statusMarker));
    assert.equal(fixture.calls.some(call=>call.method==='DELETE'),false);
    assert.deepEqual(await maintainReleaseDrafts(fixture.api),[]);
  }
});

test('a retry starting during maintenance keeps its empty draft',async()=>{
  const fixture=draftMaintenance();
  let reads=0;
  const api=async(route,...args)=>{
    const result=await fixture.api(route,...args);
    if(route.startsWith('actions/runs?')&&++reads===2)result.workflow_runs[0].status='in_progress';
    return result;
  };
  assert.deepEqual(await maintainReleaseDrafts(api),[]);
  assert.equal(fixture.calls.some(call=>call.method==='DELETE'),false);
});

test('maintenance refuses to treat access failures as missing release state',async()=>{
  await assert.rejects(maintainReleaseDrafts(async()=>{throw Object.assign(Error('denied'),{status:403});}),/denied/);
});

test('maintenance restores Latest after a historical workflow publishes an older version',async()=>{
  const releases=[
    {id:8,tag_name:'v0.2.8',draft:false,prerelease:false},
    {id:11,tag_name:'v0.2.11',draft:false,prerelease:false,html_url:'https://github.com/owner/repo/releases/tag/v0.2.11'},
    {id:12,tag_name:'v0.2.12-beta.1',draft:false,prerelease:true},
  ];
  const writes=[];
  const changes=await maintainReleaseDrafts(async(route,method='GET',body)=>{
    if(method==='PATCH'){writes.push({route,body});return {};}
    if(route==='releases/latest')return releases[0];
    if(route.startsWith('releases?'))return releases;
    throw Error('Unexpected request');
  });
  assert.deepEqual(writes,[{route:'releases/11',body:{make_latest:'true'}}]);
  assert.equal(changes[0].tag,'v0.2.11');
});

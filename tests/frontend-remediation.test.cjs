const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { productFingerprint, preflight, parseTarget } = require('../tools/frontend-remediation.cjs');

function fixture() {
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/frontend-remediation/state.json'), 'utf8'));
  state.workspaceRoot = '/tmp/loop-shared-test'; state.executionBranch = 'codex/frontend-remediation';
  state.baselineCommit = 'baseline'; state.baselineVersion = '0.1.245';
  state.activeStage = null;
  for (const stage of state.stages) { stage.status = 'ready_for_review'; stage.handoff = `docs/frontend-remediation/handoffs/STAGE-${String(stage.id).padStart(2, '0')}.md`; }
  const context = { root: state.workspaceRoot, branch: state.executionBranch, head: 'baseline', baseIncluded: true, originCommit: 'remote', remoteIncluded: true, version: '0.1.245', dirty: true, handoffExists: () => true, fingerprint: 'approved-source' };
  return { state, context };
}

test('later sessions may continue on the same dirty cumulative worktree without reset', () => {
  const { state, context } = fixture();
  const before = JSON.stringify(state);
  const result = preflight(state, context, 4);
  assert.equal(result.ok, true); assert.ok(result.warnings.some(w => w.includes('累计改动')));
  assert.equal(JSON.stringify(state), before, 'read-only checks never fabricate acceptance or ownership');
});

test('unfinished prerequisites, wrong branch, different workspace and another active phase stop continuation', () => {
  for (const change of [
    ({ state }) => { state.stages[1].status = 'in_progress'; },
    ({ context }) => { context.branch = 'main'; },
    ({ context }) => { context.root = '/tmp/different-worktree'; },
    ({ state }) => { state.activeStage = 2; },
    ({ context }) => { context.handoffExists = () => false; },
    ({ context }) => { context.baseIncluded = false; },
    ({ context }) => { context.version = '0.1.246'; },
  ]) { const data = fixture(); change(data); assert.equal(preflight(data.state, data.context, 4).ok, false); }
});

test('ready phases and passing checks do not imply final approval, while code drift invalidates recorded approval', () => {
  const { state, context } = fixture(); state.release.remoteIntegratedCommit = 'remote';
  assert.equal(preflight(state, context, 'release').ok, false);
  state.release.finalAcceptance = { approved: true, productFingerprint: 'approved-source', approvalQuote: '用户明确验收此累计候选', recordedAt: '2026-10-26' };
  assert.equal(preflight(state, context, 'release').ok, true);
  context.fingerprint = 'changed-source'; assert.equal(preflight(state, context, 'release').ok, false);
  context.fingerprint = 'approved-source'; context.originCommit = 'new-remote'; assert.equal(preflight(state, context, 'release').ok, false);
});

test('product fingerprint covers source and dependencies, permits only root version metadata and ignores handoff notes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-stage-kit-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'app')); fs.writeFileSync(path.join(root, 'app/main.js'), 'source-v1');
  const writePackage = (version, dependency = '1') => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version, dependencies: { runtime: dependency } }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version, dependencies: { runtime: dependency } }, 'node_modules/runtime': { version: dependency } } }));
  };
  writePackage('1.0.0'); const initial = productFingerprint(root).value;
  writePackage('1.0.1'); assert.equal(productFingerprint(root).value, initial);
  fs.mkdirSync(path.join(root, 'docs')); fs.writeFileSync(path.join(root, 'docs/state.json'), 'handoff only'); assert.equal(productFingerprint(root).value, initial);
  writePackage('1.0.1', '2'); assert.notEqual(productFingerprint(root).value, initial);
  writePackage('1.0.1'); fs.writeFileSync(path.join(root, 'app/main.js'), 'source-v2'); assert.notEqual(productFingerprint(root).value, initial);
  fs.symlinkSync('/tmp/outside-scope', path.join(root, 'app/external')); assert.throws(() => productFingerprint(root), /符号链接/);
});

test('stage selectors reject invalid and command-like input', () => {
  assert.equal(parseTarget('00'), 0); assert.equal(parseTarget('8'), 8); assert.equal(parseTarget('release'), 'release');
  for (const value of ['9', '-1', '../state.json', '0; git reset --hard', undefined]) assert.throws(() => parseTarget(value));
});

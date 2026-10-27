#!/usr/bin/env node
// Read-only companion to docs/frontend-remediation. Never mutates Git or state.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PACKET = 'docs/frontend-remediation';
const READY = new Set(['ready_for_review', 'accepted']);
const STATUSES = new Set(['not_started', 'in_progress', 'ready_for_review', 'accepted', 'blocked']);
const FINGERPRINT_DIRS = ['app', 'tools', 'tests', 'services/bug-report/src', '.github/workflows'];
const FINGERPRINT_FILES = ['package.json', 'package-lock.json', 'services/bug-report/package.json', 'services/bug-report/package-lock.json', 'build/installer.nsh'];

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return { ok: result.status === 0, text: (result.stdout || '').trim() };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function productFingerprint(root) {
  const files = [];
  function visit(relative) {
    const absolute = path.join(root, relative);
    let stat;
    try { stat = fs.lstatSync(absolute); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`产品指纹范围包含符号链接，请核对打包来源：${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (name.startsWith('._') || name === '.DS_Store' || name === 'node_modules') continue;
        visit(path.join(relative, name));
      }
    } else if (stat.isFile()) files.push(relative);
  }
  FINGERPRINT_DIRS.forEach(visit);
  FINGERPRINT_FILES.forEach(visit);
  const hash = crypto.createHash('sha256');
  for (const relative of [...new Set(files)].sort()) {
    let content = fs.readFileSync(path.join(root, relative));
    // Only root release versions are excluded. Dependency and script changes count.
    if (relative === 'package.json' || relative === 'package-lock.json') {
      const data = JSON.parse(content.toString('utf8'));
      delete data.version;
      if (relative === 'package-lock.json' && data.packages?.['']) delete data.packages[''].version;
      content = Buffer.from(JSON.stringify(canonical(data)));
    }
    hash.update(relative.split(path.sep).join('/') + '\0');
    hash.update(crypto.createHash('sha256').update(content).digest());
  }
  return { algorithm: 'sha256', value: hash.digest('hex'), fileCount: files.length,
    scope: [...FINGERPRINT_DIRS, ...FINGERPRINT_FILES], excluded: ['root package version fields', 'docs', '.planning', '.local-review', 'node_modules', 'release'] };
}

function validateState(state) {
  if (state.schemaVersion !== 1 || !Array.isArray(state.stages) || state.stages.length !== 9) throw new Error('state.json必须包含schemaVersion=1和阶段0–8。');
  for (let id = 0; id <= 8; id++) {
    const stage = state.stages[id];
    if (stage.id !== id || !STATUSES.has(stage.status) || stage.script !== `STAGE-${String(id).padStart(2, '0')}.md`) throw new Error(`阶段${id}状态或脚本名不合法。`);
  }
  if (state.activeStage !== null && (!Number.isInteger(state.activeStage) || state.activeStage < 0 || state.activeStage > 8)) throw new Error('activeStage必须为null或0–8。');
}

function preflight(state, context, target) {
  validateState(state);
  const errors = [], warnings = [];
  const release = target === 'release';
  if (!release && (!Number.isInteger(target) || target < 0 || target > 8)) throw new Error('阶段编号必须是0–8或release。');
  if (path.resolve(state.workspaceRoot) !== path.resolve(context.root)) errors.push('当前工具所在工作区与state.workspaceRoot不符；核对共享工作区，不另开副本继续。');
  if (!context.branch) errors.push('无法识别当前Git分支或处于detached HEAD。');
  if (state.activeStage !== null && (release || state.activeStage !== target)) errors.push(`阶段${state.activeStage}仍记录为活动状态；确认旧会话已停止后再交接。`);

  if (release || target > 0) {
    if (!state.executionBranch || !state.baselineCommit || !state.baselineVersion) errors.push('阶段0尚未登记整改分支、基线commit与版本。');
    if (state.executionBranch && context.branch !== state.executionBranch && !(release && context.branch === 'main')) errors.push(`当前分支${context.branch}不等于登记的整改分支${state.executionBranch}。`);
    if (state.baselineCommit && !context.baseIncluded) errors.push('当前HEAD不包含登记基线，不能覆盖累计成果后继续。');
    if (!release && state.baselineVersion && context.version !== state.baselineVersion) errors.push('阶段内版本号发生变化；核对来源，0–8阶段不单独升版本。');
  }
  const previous = release ? state.stages : state.stages.slice(0, target);
  for (const stage of previous) {
    if (!READY.has(stage.status)) errors.push(`阶段${stage.id}尚未达到ready_for_review/accepted（当前${stage.status}）。`);
    const expected = `${PACKET}/handoffs/STAGE-${String(stage.id).padStart(2, '0')}.md`;
    if (stage.handoff !== expected || !context.handoffExists(expected)) errors.push(`阶段${stage.id}缺少实际交接记录${expected}。`);
    if (stage.status === 'ready_for_review') warnings.push(`阶段${stage.id}仍待用户单独审阅；继续指令与最终验收需如实记录。`);
  }
  if (context.dirty) warnings.push('工作区有累计改动：这是串行流程的正常状态；保留并核对，不要reset/clean。');
  if (release) {
    const approval = state.release?.finalAcceptance;
    if (!approval || approval.approved !== true || !String(approval.approvalQuote || '').trim() || !String(approval.recordedAt || '').trim()) errors.push('缺少真实最终候选验收记录；JSON字段本身不能替代用户授权。');
    if (!approval?.productFingerprint || approval.productFingerprint !== context.fingerprint) errors.push('当前产品指纹不等于最终验收指纹。');
    if (!state.release?.remoteIntegratedCommit || state.release.remoteIntegratedCommit !== context.originCommit || !context.remoteIncluded) errors.push('当前HEAD/记录尚未包含当前origin/main；发布会话仍须先fetch确认最新远端。');
  }
  return { ok: errors.length === 0, errors, warnings };
}

function load(root) {
  const state = JSON.parse(fs.readFileSync(path.join(root, PACKET, 'state.json'), 'utf8'));
  validateState(state);
  const current = git(root, ['branch', '--show-current']);
  return { state, context: {
    root,
    branch: current.ok ? current.text : '',
    head: git(root, ['rev-parse', 'HEAD']).text,
    originCommit: git(root, ['rev-parse', '--verify', 'origin/main']).text,
    baseIncluded: Boolean(state.baselineCommit && git(root, ['merge-base', '--is-ancestor', state.baselineCommit, 'HEAD']).ok),
    remoteIncluded: git(root, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']).ok,
    version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    dirty: Boolean(git(root, ['status', '--porcelain=v1', '--untracked-files=no']).text),
    handoffExists: relative => fs.existsSync(path.join(root, relative)),
  } };
}

function parseTarget(value) {
  if (value === 'release') return value;
  if (!/^(?:0?[0-8])$/.test(String(value))) throw new Error('阶段编号必须是0–8或release。');
  return Number(value);
}

function cli(args, root = ROOT) {
  const command = args[0] || 'status';
  if (args.length > (['check', 'prompt'].includes(command) ? 2 : 1)) throw new Error('参数过多；支持status、check N、prompt N、fingerprint。');
  if (command === 'fingerprint') { console.log(JSON.stringify(productFingerprint(root), null, 2)); return 0; }
  const { state, context } = load(root);
  if (command === 'status') {
    console.log(`工作区：${root}\n当前分支：${context.branch}\nHEAD：${context.head}\n整改分支：${state.executionBranch || '阶段0待登记'}\n当前活动阶段：${state.activeStage ?? '无'}`);
    for (const stage of state.stages) console.log(`${stage.id}  ${stage.status.padEnd(17)} ${stage.title}`);
    console.log(`发布：${state.release.status}（状态不替代用户验收与发布指令）`);
    return 0;
  }
  if (command === 'prompt') {
    const target = parseTarget(args[1]);
    const filename = target === 'release' ? 'RELEASE.md' : state.stages[target].script;
    console.log(fs.readFileSync(path.join(root, PACKET, 'COMMON.md'), 'utf8') + '\n\n' + fs.readFileSync(path.join(root, PACKET, filename), 'utf8'));
    return 0;
  }
  if (command === 'check') {
    const target = parseTarget(args[1]);
    if (target === 'release') context.fingerprint = productFingerprint(root).value;
    const result = preflight(state, context, target);
    console.log(`工作区：${root}\n分支：${context.branch}\n阶段：${target}\n前置检查：${result.ok ? '通过' : '未满足'}`);
    result.warnings.forEach(message => console.log(`提示：${message}`));
    result.errors.forEach(message => console.log(`待处理：${message}`));
    if (result.ok) console.log('仅完成只读检查。请按对应会话脚本执行；本工具未修改状态或产品。');
    return result.ok ? 0 : 1;
  }
  throw new Error('未知命令；支持status、check N、prompt N、fingerprint。');
}

module.exports = { productFingerprint, validateState, preflight, parseTarget, cli };
if (require.main === module) {
  try { process.exitCode = cli(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

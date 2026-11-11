// Local review circuit breaker. No Electron dependency: checking a previously
// failed runtime must never launch another process or create another crash alert.
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const filename = workspace => path.join(workspace, '.local-review/electron-startup-paused.json');

async function assertElectronStartupAllowed(workspace = root) {
  try { await fs.access(filename(workspace)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const error = new Error('真实 Electron 启动已暂停：此前启动在 macOS 图形应用注册阶段中止。为避免重复“意外退出”弹窗，本次没有启动应用。请先处理启动环境，再明确重试。');
  error.code = 'LOOP_ELECTRON_STARTUP_PAUSED';
  throw error;
}

async function pauseElectronStartup(details, workspace = root) {
  const file = filename(workspace);
  await fs.mkdir(path.dirname(file), {recursive:true});
  await fs.writeFile(file, JSON.stringify({status:'paused',updatedAt:new Date().toISOString(),...details},null,2));
}

async function clearElectronStartupPause(workspace = root) {
  await fs.rm(filename(workspace), {force:true});
}

module.exports = {assertElectronStartupAllowed,pauseElectronStartup,clearElectronStartupPause};

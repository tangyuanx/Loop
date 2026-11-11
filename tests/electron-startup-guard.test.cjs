const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {assertElectronStartupAllowed,pauseElectronStartup,clearElectronStartupPause} = require('../tools/electron-startup-guard.cjs');

test('fresh workspaces do not inherit another local runtime failure', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'loop-startup-guard-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await assertElectronStartupAllowed(root);
});

test('persisted startup failure blocks further GUI attempts until explicitly cleared', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'loop-startup-guard-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await pauseElectronStartup({reason:'SIGABRT',signal:'SIGABRT'},root);
  await assert.rejects(assertElectronStartupAllowed(root),{code:'LOOP_ELECTRON_STARTUP_PAUSED'});
  // Repeated checks retain the pause; they never clear it or start a process.
  await assert.rejects(assertElectronStartupAllowed(root),{code:'LOOP_ELECTRON_STARTUP_PAUSED'});
  await clearElectronStartupPause(root);
  await assertElectronStartupAllowed(root);
});

test('damaged pause metadata still prevents accidental crash loops', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'loop-startup-guard-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'.local-review'));
  await fs.writeFile(path.join(root,'.local-review/electron-startup-paused.json'),'{interrupted');
  await assert.rejects(assertElectronStartupAllowed(root),{code:'LOOP_ELECTRON_STARTUP_PAUSED'});
});

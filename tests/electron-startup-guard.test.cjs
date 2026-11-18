const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {assertElectronEnvironmentAllowed,assertElectronStartupAllowed,pauseElectronStartup,clearElectronStartupPause} = require('../tools/electron-startup-guard.cjs');
const {createGuardedElectron} = require('../tools/guarded-electron.cjs');
const desktop = {platform:'darwin',env:{}};
const restricted = {platform:'darwin',env:{CODEX_SANDBOX:'seatbelt'}};

test('fresh workspaces do not inherit another local runtime failure', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'loop-startup-guard-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await assertElectronStartupAllowed(root,desktop);
});

test('persisted startup failure blocks further GUI attempts until explicitly cleared', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'loop-startup-guard-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await pauseElectronStartup({reason:'SIGABRT',signal:'SIGABRT'},root);
  await assert.rejects(assertElectronStartupAllowed(root,desktop),{code:'LOOP_ELECTRON_STARTUP_PAUSED'});
  // Repeated checks retain the pause; they never clear it or start a process.
  await assert.rejects(assertElectronStartupAllowed(root,desktop),{code:'LOOP_ELECTRON_STARTUP_PAUSED'});
  await clearElectronStartupPause(root);
  await assertElectronStartupAllowed(root,desktop);
  await assert.rejects(assertElectronStartupAllowed(root,restricted),{code:'LOOP_ELECTRON_SANDBOX_BLOCKED'},
    'clearing a pause in a different terminal does not lift this process sandbox');
});

test('damaged pause metadata still prevents accidental crash loops', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'loop-startup-guard-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'.local-review'));
  await fs.writeFile(path.join(root,'.local-review/electron-startup-paused.json'),'{interrupted');
  await assert.rejects(assertElectronStartupAllowed(root,desktop),{code:'LOOP_ELECTRON_STARTUP_PAUSED'});
});

test('macOS Seatbelt is rejected before any GUI runtime is loaded or launched', async () => {
  assert.throws(()=>assertElectronEnvironmentAllowed(restricted),{code:'LOOP_ELECTRON_SANDBOX_BLOCKED'});
  assert.doesNotThrow(()=>assertElectronEnvironmentAllowed(desktop));
  assert.doesNotThrow(()=>assertElectronEnvironmentAllowed({platform:'win32',env:restricted.env}));
  assert.doesNotThrow(()=>assertElectronEnvironmentAllowed({platform:'linux',env:restricted.env}));
  let launched=0,paused=0;
  const electron=createGuardedElectron({check:()=>assertElectronEnvironmentAllowed(restricted),
    launch:()=>{launched++;},pause:()=>{paused++;}});
  for(let i=0;i<3;i++) await assert.rejects(electron.launch({}),{code:'LOOP_ELECTRON_SANDBOX_BLOCKED'});
  assert.equal(launched,0); assert.equal(paused,0,'an environment restriction must not poison other execution contexts');
});

test('approved desktop launch preserves options and result; startup failure pauses future attempts', async () => {
  const options={args:['/isolated/app'],env:{LOOP_USER_DATA_DIR:'/isolated/profile'}};
  const result={window:'test'}, order=[];
  const electron=createGuardedElectron({check:()=>order.push('check'),launch:input=>{
    assert.equal(input,options); order.push('launch');return result;
  }});
  assert.equal(await electron.launch(options),result); assert.deepEqual(order,['check','launch']);
  const failure=Error('Process failed to launch!'); let pause;
  const broken=createGuardedElectron({check:()=>{},launch:()=>{throw failure;},pause:details=>{pause=details;}});
  await assert.rejects(broken.launch(options),error=>error===failure);
  assert.match(pause.error,/Process failed to launch/);
  pause=null;
  const unrelated=createGuardedElectron({check:()=>{},launch:()=>{throw Error('invalid argument');},pause:()=>{pause=true;}});
  await assert.rejects(unrelated.launch({}),/invalid argument/); assert.equal(pause,null);
});

test('npm and review retry entry points fail safely inside Seatbelt without starting Electron', {skip:process.platform!=='darwin'}, () => {
  const {spawnSync}=require('node:child_process');
  for (const args of [['tools/launch-electron.cjs','--version'],['tools/review-editing-stage1.cjs','--retry-desktop-startup']]) {
    const result=spawnSync(process.execPath,args,{cwd:path.resolve(__dirname,'..'),env:{...process.env,CODEX_SANDBOX:'seatbelt'},encoding:'utf8',timeout:10000});
    assert.equal(result.error,undefined); assert.equal(result.status,1); assert.equal(result.signal,null);
    assert.match(result.stderr,/Seatbelt/); assert.doesNotMatch(result.stderr,/Process failed to launch/);
  }
});

test('every Electron UI launcher uses the shared guarded entry', async () => {
  const root=path.resolve(__dirname,'..');
  for (const directory of ['tests','tools']) {
    for (const entry of await fs.readdir(path.join(root,directory))) {
      if(!entry.endsWith('.cjs')||entry.startsWith('._')||entry==='guarded-electron.cjs')continue;
      const source=await fs.readFile(path.join(root,directory,entry),'utf8');
      if(/(?:electron|_electron)\.launch\(/.test(source)) {
        assert.match(source,/require\(['"][^'"]*guarded-electron\.cjs['"]\)/,directory+'/'+entry);
        assert.doesNotMatch(source,/require\(['"]playwright-core['"]\)/,directory+'/'+entry);
      }
    }
  }
  const pkg=require('../package.json');
  assert.equal(pkg.scripts.dev,'node tools/launch-electron.cjs .');
  assert.equal(pkg.scripts.start,'node tools/launch-electron.cjs .');
});

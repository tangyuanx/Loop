// Run with approved desktop execution permissions, never by probing a sandbox.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {assertElectronEnvironmentAllowed} = require('../tools/electron-startup-guard.cjs');
const {launchRepository, task} = require('./electron-ui-helpers.cjs');

(async()=>{
  assertElectronEnvironmentAllowed();
  const reports = async () => process.platform === 'darwin'
    ? (await fs.readdir(path.join(os.homedir(),'Library/Logs/DiagnosticReports'))).filter(name=>/^Electron.*\.ips$/.test(name)) : [];
  const before = new Set(await reports()), runs=[];
  for(let i=0;i<2;i++) {
    const h=await launchRepository({activeTaskId:'startup',tasks:[task('startup',{title:'启动环境验证（隔离数据）'})]},'startup-check');
    try {
      const runtime=await h.app.evaluate(({app})=>({pid:process.pid,appPath:app.getAppPath(),userData:app.getPath('userData'),version:app.getVersion()}));
      assert.equal(runtime.appPath,path.resolve(__dirname,'..'));
      assert.equal(runtime.userData,h.profile);
      assert.equal(await h.page.evaluate(()=>shellActiveTask().title),'启动环境验证（隔离数据）');
      assert.deepEqual(h.errors,[]); runs.push(runtime);
    } finally {await h.close();}
  }
  // Give macOS a chance to finish writing an unexpected crash report.
  await new Promise(resolve=>setTimeout(resolve,1500));
  const newReports=(await reports()).filter(name=>!before.has(name));
  assert.deepEqual(newReports,[],'startup/normal close must not create new Electron crash reports');
  const result={runs,newCrashReports:newReports,passed:true};
  if(process.env.LOOP_REVIEW_OUTPUT){
    await fs.mkdir(process.env.LOOP_REVIEW_OUTPUT,{recursive:true});
    await fs.writeFile(path.join(process.env.LOOP_REVIEW_OUTPUT,'startup-result.json'),JSON.stringify(result,null,2));
  }
  console.log('PASS: two real Electron launches and normal exits, source/profile verified, no new Electron crash reports.');
})().catch(error=>{console.error(error);process.exitCode=1;});

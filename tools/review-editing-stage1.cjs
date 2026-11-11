// One terminal entry for the real stage-1 tests and an isolated review window.
// Does not change permissions, application code, release state or user data.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn,spawnSync} = require('node:child_process');
const {writeTaskData,readTaskData} = require('../app/main/storage.cjs');
const {assertElectronStartupAllowed,pauseElectronStartup,clearElectronStartupPause} = require('./electron-startup-guard.cjs');

const root=path.resolve(__dirname,'..');
const base=path.join(root,'.local-review/memo-20261111/stage1');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const suites=['editing-contract.ui.cjs','flow-save-finish.ui.cjs','flow-outline.ui.cjs','management-names.ui.cjs'];

async function prepare(run) {
  const profile=path.join(run,'review-profile'),stamp=new Date().toISOString();
  const task=(id,title,nodes=[])=>({id,title,nodes,status:'active',priority:'medium',
    description:'直接编辑此处：Enter保存，Shift+Enter换行，Esc取消本次编辑。',
    hypothesis:'这是独立的合成验收数据。可以安全地试用新增、改名、记录和结论。',
    conclusion:'当前仅供验收；没有把测试结果记为人工通过。',createdAt:stamp,updatedAt:stamp});
  await writeTaskData(profile,{version:2,knowledgeSchemaVersion:2,taskFilter:'all',activeGroupId:'group_all',
    activeTaskId:'review-editing',taskPane:'flow',tasks:[
      task('review-editing','简报与节点编辑',[{id:'review-node',title:'双击修改标题，右键添加结论',
        note:'旧记录原文保留在内联结论中。',conclusion:'双击此处编辑，Esc取消本次修改。',children:[
          {id:'review-child',title:'子节点：新增与取消检查',note:'保留原有父子关系。',children:[]},
        ]}]),
      task('review-empty','空处理流：连续新增节点检查'),
    ]});
  const disk=await fs.readFile(path.join(profile,'task-data.json'));
  const backup=path.join(run,'pre-launch-backup');await fs.mkdir(backup,{recursive:true});
  await fs.writeFile(path.join(backup,'task-data.json'),disk);
  if(hash(await fs.readFile(path.join(backup,'task-data.json')))!==hash(disk))throw Error('隔离数据备份校验失败');
  const data=await readTaskData(profile);
  if(data.tasks.length!==2||data.tasks[0].nodes[0].children[0].id!=='review-child')throw Error('隔离验收种子校验失败');
  return {profile,backup,sha256:hash(disk),syntheticDataOnly:true};
}

async function runTest(file,run,env) {
  const logfile=path.join(run,file+'.log');
  const handle=await fs.open(logfile,'w');
  console.log('\n正在运行 '+file);
  const child=spawn(process.execPath,[path.join(root,'tests',file)],{cwd:root,
    env:{...env,LOOP_REVIEW_OUTPUT:path.join(run,'visual',file.replace('.ui.cjs',''))},stdio:['ignore','pipe','pipe']});
  const output=[];
  child.stdout.on('data',bytes=>{output.push(bytes);process.stdout.write(bytes);});
  child.stderr.on('data',bytes=>{output.push(bytes);process.stderr.write(bytes);});
  try{
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
    await handle.writeFile(Buffer.concat(output));
    if(code.code!==0){
      const error=Error(file+'未通过；保留完整日志：'+logfile);
      error.failedSuite=file;
      error.runtimeStartupFailed=/Process failed to launch!|SIGABRT/.test(Buffer.concat(output).toString());
      throw error;
    }
  }finally{await handle.close();}
}

async function main() {
  // A known startup crash is not a reason to probe the same GUI again. Retry
  // only after the operator has deliberately selected a new startup attempt.
  if (!process.argv.includes('--prepare-only') && !process.argv.includes('--retry-desktop-startup')) {
    await assertElectronStartupAllowed(root);
  }
  await fs.mkdir(base,{recursive:true});
  const lock=path.join(base,'review-runner.lock');
  let lockHandle;
  try{lockHandle=await fs.open(lock,'wx');}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const pid=Number(await fs.readFile(lock,'utf8'));
    if(!Number.isInteger(pid)||pid<=0)throw Error('验收锁记录无效，请先核实旧候选；不会覆盖记录或关闭其他应用。');
    try{process.kill(pid,0);}
    catch(failure){
      if(failure.code!=='ESRCH')throw Error('无法确认旧验收进程状态，请先关闭旧候选后重试。');
      await fs.unlink(lock);lockHandle=await fs.open(lock,'wx');
    }
    if(!lockHandle)throw Error('上一次验收仍在运行，请先保存并退出旧候选。');
  }
  await lockHandle.writeFile(String(process.pid));
  const run=await fs.mkdtemp(path.join(base,'verification-'));
  const result={startedAt:new Date().toISOString(),root,run,status:'preparing',tests:[]};
  const report=()=>fs.writeFile(path.join(run,'result.json'),JSON.stringify(result,null,2));
  let app;
  try{
    result.data=await prepare(run);await report();
    if(process.argv.includes('--prepare-only')){
      result.status='prepared_only';await report();
      console.log('隔离数据和备份已校验；此模式没有启动Electron或运行UI测试。\n'+path.join(run,'result.json'));return;
    }
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const executablePath=require('electron');
    // Establish whether the runtime can initialize macOS GUI registration
    // before repeatedly launching four application tests.
    const probe=spawnSync(executablePath,['--version'],{env,encoding:'utf8',timeout:15000});
    result.electronProbe={status:probe.status,signal:probe.signal,stdout:probe.stdout,stderr:probe.stderr,error:probe.error?.message};
    if(probe.status!==0){
      await pauseElectronStartup({reason:'Electron runtime failed before Loop code',probe:result.electronProbe,run},root);
      throw Error('Electron本身无法启动（'+(probe.signal||probe.error?.code||probe.status)+'），尚未执行Loop代码。请在允许启动本地图形应用的终端/执行环境运行本命令。不会关闭系统保护或绕过当前沙箱。');
    }
    await clearElectronStartupPause(root);
    for(const file of suites){await runTest(file,run,env);result.tests.push({file,status:'passed'});await report();}
    result.status='ui_tests_passed';await report();
    const {_electron}=require('playwright-core');
    app=await _electron.launch({executablePath,args:[root],cwd:root,env:{...env,LOOP_USER_DATA_DIR:result.data.profile}});
    let page;
    const end=Date.now()+20000;
    while(!page&&Date.now()<end){
      page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));
      if(!page)await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!page)throw Error('隔离候选主窗口未就绪');
    const runtime=await app.evaluate(({app,BrowserWindow})=>{
      const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html'));
      return {appPath:app.getAppPath(),userData:app.getPath('userData'),pid:process.pid,version:app.getVersion(),windowId:window.id};
    });
    if(path.resolve(runtime.appPath)!==root||path.resolve(runtime.userData)!==result.data.profile)throw Error('候选来源或隔离数据目录不匹配');
    await page.waitForFunction(()=>typeof shellActiveTask==='function'&&shellActiveTask()?.id==='review-editing');
    await app.evaluate(({BrowserWindow},id)=>{
      const window=BrowserWindow.fromId(id);window.setSize(1280,850);
      window.setTitle('Loop · 阶段1 编辑交互验收（隔离数据）');window.show();window.focus();
    },runtime.windowId);
    await page.screenshot({path:path.join(run,'candidate.png')});
    result.runtime=runtime;result.status='candidate_open';result.humanAccepted=false;await report();
    await fs.writeFile(path.join(base,'current-review.json'),JSON.stringify({run,runtime},null,2));
    console.log('\n4项真实应用测试通过。隔离候选已打开，可直接试用。\n验收记录：'+path.join(run,'result.json')+'\n请保持本终端运行；退出候选后本命令结束。');
    await new Promise(resolve=>app.once('close',resolve));app=null;
    result.status='candidate_closed';await report();
  }catch(error){
    if(error.runtimeStartupFailed || /Process failed to launch!|主窗口未就绪/.test(error.message)) {
      await pauseElectronStartup({reason:'Desktop startup failed during real application validation',run,error:error.message},root);
    }
    if(error.failedSuite)result.tests.push({file:error.failedSuite,status:'failed'});
    result.status=error.runtimeStartupFailed||(result.electronProbe&&result.electronProbe.status!==0)?'blocked_startup':error.failedSuite?'test_failed':'review_failed';
    result.error=error.stack;await report();
    console.error('\n'+error.message+'\n诊断记录：'+path.join(run,'result.json'));process.exitCode=1;
  }finally{
    if(app)await app.close();
    await lockHandle.close();await fs.unlink(lock);
  }
}
main().catch(error=>{console.error(error.code==='LOOP_ELECTRON_STARTUP_PAUSED'?error.message:error);process.exitCode=1;});

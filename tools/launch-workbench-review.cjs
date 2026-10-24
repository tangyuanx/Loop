/* Launch the actual app with fresh synthetic acceptance data and a verified
   pre-launch backup. Never reads the user's normal Loop profile. */
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {_electron}=require('playwright-core');
const {writeTaskData}=require('../app/main/storage.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
const root=path.resolve(__dirname,'..'),base=path.resolve(root,'..','acceptance');
const stamp=new Date().toISOString(),label=stamp.replace(/[:.]/g,'-');
const run=path.join(base,label),profile=path.join(run,'user-data'),files=path.join(run,'files'),backup=path.join(run,'pre-launch-backup');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
(async()=>{
 await fs.mkdir(files,{recursive:true});
 const external=path.join(files,'外部文件同步验收.md');await fs.writeFile(external,'# 外部文件同步验收\n\n这是隔离验收目录中的 Markdown 文件。\n\n- [ ] 在这里输入并同步到文件\n- [ ] 查看保存回执与文件信息\n');
 const disk=await readKnowledgeDocument(external);
 const note=['---','tags: [工作台, 验收]','aliases: [工作台方案]','---','','# 验收记录','','这个实例使用独立的合成任务。可以直接编辑、保存、插入图片和表格，检验本轮呈现调整。','','## 页面与菜单','','- [ ] 展开任务详情，修改背景、进展或结论','- [ ] 选中文字，右键打开文本格式','- [ ] 切换编辑、源码、阅读模式','- [ ] 点击放大镜查找当前笔记','- [ ] 在更多菜单查看原有文件与导出操作','','## 关联笔记','','[[note:workbench-linked|关联笔记]] 保留原有双链跳转。大纲面板中仍能查看反向链接。','','## 表格与代码','','| 功能 | 入口 |','| --- | --- |','| 格式设置 | 正文右键 → 文本格式 |','| 表格行列 | 右键 → 插入 → 编辑表格行列 |','| 导出笔记 | 更多 → 导出笔记 |','','```js','const workspace = "让正文成为主角";','```','','> [!NOTE] 保存与恢复','> Loop 内笔记、外部文件同步和恢复草稿仍沿用现有实现。','','## 数学与图表','','$$','x^2 + y^2 = z^2','$$','','```mermaid','flowchart LR','  A[任务] --> B[处理] --> C[笔记]','```',''].join('\n');
 const task=(id,title,notes,extra={})=>({id,title,notes,nodes:[],groupId:'review',createdAt:stamp,updatedAt:stamp,...extra});
 await writeTaskData(profile,{version:2,knowledgeSchemaVersion:1,activeTaskId:'workbench-review',taskFilter:'all',taskGroups:[{id:'review',title:'工作台验收',order:0}],tasks:[
  task('workbench-review','右侧工作台呈现验收',note,{description:'检查右侧工作台的信息层级与知识笔记入口。',hypothesis:'已收拢常驻控件，完整功能通过上下文菜单与更多菜单保留。',tags:{today:true},nodes:[{id:'review-step',title:'检阅本轮呈现与交互',status:'todo',children:[]}],knowledgeNote:{noteId:'workbench-main',title:'验收记录',documentState:'DRAFT'}}),
  task('workbench-linked','关联笔记','# 关联笔记\n\n## 笔记链接\n\n返回 [[note:workbench-main|验收记录]]。\n\n- 保留链接补全、标题定位与嵌入能力。\n',{knowledgeNote:{noteId:'workbench-linked',title:'关联笔记',documentState:'DRAFT'}}),
  task('workbench-file','外部文件同步验收',disk.content,{knowledgeNote:{noteId:'workbench-external',title:'外部文件同步验收',documentState:'SAVED',dirty:false,...disk}})
 ]});
 await fs.mkdir(backup,{recursive:true});await fs.cp(profile,path.join(backup,'user-data'),{recursive:true});await fs.cp(files,path.join(backup,'files'),{recursive:true});
 const checks=[];
 for(const [source,target]of [[path.join(profile,'task-data.json'),path.join(backup,'user-data','task-data.json')],[external,path.join(backup,'files','外部文件同步验收.md')]]){
  const a=hash(await fs.readFile(source)),b=hash(await fs.readFile(target));if(a!==b)throw Error('Backup verification failed');checks.push({source,backup:target,sha256:a});
 }
 await fs.writeFile(path.join(run,'backup-verification.json'),JSON.stringify(checks,null,2));
 const env={...process.env,LOOP_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:require('electron'),args:[root],cwd:root,env});
 let page;for(let i=0;i<150;i++){page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}
 if(!page)throw Error('Main application window unavailable');await page.waitForFunction(()=>typeof knowledgeOpen==='function'&&state.tasks.some(t=>t.id==='workbench-review'));
 await page.evaluate(()=>knowledgeOpen(state.tasks.find(t=>t.id==='workbench-review')));await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);
 const runtime=await app.evaluate(({app,BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html'));window.setSize(1440,960);window.setTitle('Loop · 工作台呈现验收（隔离数据）');window.show();window.focus();return {version:app.getVersion(),appPath:app.getAppPath(),userData:app.getPath('userData')};});
 if(path.resolve(runtime.appPath)!==root||path.resolve(runtime.userData)!==profile)throw Error('Acceptance runtime/profile mismatch');
 await page.screenshot({path:path.join(run,'acceptance.png')});
 const result={runtime,run,backup,backupVerified:true,syntheticDataOnly:true,mockedIPC:false,debuggerAttached:true};
 await fs.writeFile(path.join(base,'current.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 await new Promise(resolve=>app.on('close',resolve));
})().catch(error=>{console.error(error);process.exitCode=1;});

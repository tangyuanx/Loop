const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {fileURLToPath,pathToFileURL}=require('node:url');
const core=require('../renderer/src/knowledge-core.js');
const {readKnowledgeDocument}=require('./knowledge-file.cjs');

function destinations(content){
  const text=String(content||''),excluded=core.excludedRanges(text),result=[];
  const start=/(?<!!)\[[^\]\n]*\]\(\s*/g;let match;
  while((match=start.exec(text))){
    if(excluded.some(([a,b])=>match.index>=a&&match.index<b))continue;
    let at=start.lastIndex,href='';
    if(text[at]==='<'){const end=text.indexOf('>',++at);if(end<0)continue;href=text.slice(at,end);}
    else{let depth=0;for(;at<text.length;at++){
      const c=text[at];if(c==='\\'&&/[()\\ ]/.test(text[at+1]||'')){href+=text[++at];continue;}
      if(c==='(')depth++;if(c===')'){if(!depth)break;depth--;}
      if(/\s/.test(c)&&!depth)break;href+=c;
    }}
    if(href)result.push(href);
  }
  return result;
}
function resolveResource(href,sourcePath='',platform=process.platform){
  const raw=String(href||'').trim();if(!raw||/[\u0000-\u001f\u007f]/.test(raw))throw new Error('链接地址无效');
  if(/^https?:\/\//i.test(raw)){const url=new URL(raw);return {kind:'web',url:url.href,key:url.href,title:url.hostname};}
  if(/^mailto:/i.test(raw))return {kind:'mail',url:raw,key:raw,title:raw};
  if(/^[a-z][a-z0-9+.-]*:/i.test(raw)&&!/^file:/i.test(raw)&&! /^[a-z]:[\\/]/i.test(raw))throw new Error('不支持此链接协议');
  const split=raw.indexOf('#'),encoded=split<0?raw:raw.slice(0,split),anchor=split<0?'':decodeURIComponent(raw.slice(split+1));
  const pathApi=platform==='win32'?path.win32:path;
  let filePath;
  if(/^file:/i.test(encoded))filePath=fileURLToPath(encoded,{windows:platform==='win32'});
  else filePath=decodeURIComponent(encoded);
  if(platform!=='win32'&&/^[a-z]:[\\/]/i.test(filePath))throw new Error('Windows 文件路径无法在当前系统打开');
  if(!pathApi.isAbsolute(filePath)){
    if(!sourcePath)throw new Error('请先保存当前笔记，再打开相对文件链接');
    filePath=pathApi.resolve(pathApi.dirname(sourcePath),filePath);
  }
  filePath=pathApi.normalize(filePath);const ext=pathApi.extname(filePath).toLowerCase();
  const textTypes=new Set(['.txt','.log','.csv','.tsv','.json','.yaml','.yml','.toml','.ini','.conf','.xml','.html','.htm','.css','.scss','.js','.jsx','.ts','.tsx','.mjs','.cjs','.c','.h','.cpp','.hpp','.cc','.rs','.go','.java','.kt','.swift','.py','.rb','.sh','.bash','.zsh','.ps1','.bat','.cmd','.sql','.vue','.svelte','.cmake','.make']);
  const kind=ext==='.md'||ext==='.markdown'?'markdown':ext==='.pdf'?'pdf':textTypes.has(ext)||!ext?'code':'unsupported';
  const externalTypes=new Set(['.pdf','.md','.markdown','.txt','.log','.csv','.tsv','.json','.yaml','.yml','.toml','.ini','.conf','.xml','.css','.scss','.c','.h','.cpp','.hpp','.cc','.rs','.go','.java','.kt','.swift','.sql','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.rtf','.png','.jpg','.jpeg','.gif','.webp']);
  return {kind,filePath,anchor,key:platform==='win32'?filePath.toLowerCase():filePath,title:pathApi.basename(filePath),canExternal:externalTypes.has(ext)};
}

function registerKnowledgeResources({ipcMain,BrowserWindow,WebContentsView,shell,getWindow,readData,gate}){
  const entries=new Map(),sessions=new WeakSet();
  const owner=event=>{const win=getWindow();if(!win||win.isDestroyed()||event.sender!==win.webContents)throw new Error('资源请求来源无效');return win;};
  const notify=item=>{const win=getWindow();if(win&&!win.isDestroyed())win.webContents.send('knowledge-resource:changed',{id:item.id,title:item.title,url:item.url,status:item.status,message:item.message});};
  const close=item=>{if(item?.view){const win=getWindow();if(win&&!win.isDestroyed())win.contentView.removeChildView(item.view);if(!item.view.webContents.isDestroyed())item.view.webContents.close();}entries.delete(item?.id);};
  const external=async item=>{
    if(item.kind==='web'||item.kind==='mail'){await shell.openExternal(item.url);return {success:true,external:true};}
    if(!item.canExternal)throw new Error('此类文件仅支持只读预览，不能作为程序或脚本运行');
    const error=await shell.openPath(item.filePath);if(error)throw new Error(error);return {success:true,external:true};
  };
  ipcMain.handle('knowledge-resource:open',async(event,payload)=>{
    try{
      const win=owner(event),href=String(payload?.href||'');let item=resolveResource(href);
      // Relative paths need their note's saved directory. The authoritative
      // persisted note also proves this exact destination is an actual link.
      if(item.kind!=='web'&&item.kind!=='mail')throw new Error('LOCAL');
      if(item.kind==='mail'||payload?.external)return await external(item);
      return await open(item,win);
    }catch(error){
      if(error.message!=='LOCAL'&&!/先保存当前笔记/.test(error.message))return {success:false,message:error.message};
      try{
        const win=owner(event),data=await readData(),origin=[...(data.tasks||[]),...(data.knowledgeDocuments||[])].find(note=>note.id===payload?.noteId);
        if(!origin)throw new Error('来源笔记不存在');
        const sourcePath=origin.knowledgeNote?.filePath||'',item=resolveResource(payload.href,sourcePath);
        if(!destinations(origin.notes).some(href=>{try{return resolveResource(href,sourcePath).key===item.key;}catch{return false;}}))throw new Error('此文件不是来源笔记中的有效链接');
        const stat=await fs.stat(item.filePath);if(!stat.isFile())throw new Error('目标不是文件');
        if(payload.external&&item.canExternal)return await external(item);
        if(item.kind==='markdown'){
          gate.approve(item.filePath);const result=await readKnowledgeDocument(item.filePath);if(!result.success)return result;
          return {...result,kind:'markdown',anchor:item.anchor,title:item.title,key:item.key};
        }
        if(item.kind==='code'){
          if(stat.size>4*1024*1024)throw new Error('文件超过4MB，请使用系统应用打开');
          const bytes=await fs.readFile(item.filePath);if(bytes.includes(0))throw new Error('该文件不是可预览的文本文件');
          item.content=bytes.toString('utf8');if(!Buffer.from(item.content,'utf8').equals(bytes))throw new Error('文件不是UTF-8文本，请使用系统应用打开');
        }
        return await open(item,win);
      }catch(failure){return {success:false,message:failure.code==='ENOENT'?'文件不存在，请检查链接路径':failure.code==='EACCES'?'没有权限读取该文件':failure.message};}
    }
  });
  async function open(resource,win){
    let item=[...entries.values()].find(entry=>entry.key===resource.key);
    if(item)return snapshot(item);
    if(entries.size>=32)throw new Error('已打开32个资源，请先关闭一些页签');
    item={...resource,id:'resource_'+crypto.randomUUID(),status:'ready'};entries.set(item.id,item);
    if(['web','pdf'].includes(item.kind)){
      const view=new WebContentsView({webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:'loop-resource-content',webSecurity:true}});item.view=view;item.status='loading';
      view.setVisible(false);win.contentView.addChildView(view);
      const contents=view.webContents,session=contents.session;
      if(!sessions.has(session)){sessions.add(session);session.setPermissionRequestHandler((_c,_p,done)=>done(false));session.setPermissionCheckHandler(()=>false);session.on('will-download',event=>event.preventDefault());}
      const allowed=url=>item.kind==='web'?/^https?:\/\//i.test(url):url.split('#')[0]===pathToFileURL(item.filePath).href;
      contents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
      contents.on('will-redirect',(event,url)=>{if(!allowed(url))event.preventDefault();});
      contents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url))win.webContents.send('knowledge-resource:new-link',{href:url,resourceId:item.id});return {action:'deny'};});
      contents.on('page-title-updated',(_event,title)=>{item.title=String(title||item.title).slice(0,160);notify(item);});
      contents.on('did-navigate',(_event,url)=>{item.url=url;notify(item);});
      contents.on('did-finish-load',()=>{item.status='ready';notify(item);});
      contents.on('did-fail-load',(_event,code,description,_url,isMain)=>{if(code===-3||!isMain)return;item.status='failed';item.message=description;view.setVisible(false);notify(item);});
      contents.on('render-process-gone',()=>{item.status='failed';item.message='预览已停止，请重新打开或使用系统应用';notify(item);});
      void contents.loadURL(item.kind==='web'?item.url:pathToFileURL(item.filePath).href+(item.anchor?'#'+encodeURIComponent(item.anchor):'')).catch(error=>{item.status='failed';item.message=error.message;notify(item);});
    }
    return snapshot(item);
  }
  function snapshot(item){return {success:true,id:item.id,key:item.key,kind:item.kind,title:item.title,url:item.url||item.filePath,content:item.content||'',status:item.status,canExternal:item.kind==='web'||item.canExternal};}
  ipcMain.handle('knowledge-resource:show',(event,payload)=>{
    const win=owner(event);for(const item of entries.values())item.view?.setVisible(false);
    const item=entries.get(payload?.id),r=payload?.bounds;if(!item?.view||item.status==='failed'||!r)return {success:true};
    const size=win.getContentBounds(),x=Math.max(0,Math.round(Number(r.x)||0)),y=Math.max(0,Math.round(Number(r.y)||0));
    const width=Math.max(0,Math.min(size.width-x,Math.round(Number(r.width)||0))),height=Math.max(0,Math.min(size.height-y,Math.round(Number(r.height)||0)));
    item.view.setBounds({x,y,width,height});item.view.setVisible(width>0&&height>0);return {success:true};
  });
  ipcMain.handle('knowledge-resource:external',async(event,payload)=>{try{owner(event);const item=entries.get(payload?.id);if(!item)throw new Error('页签已关闭');return await external(item);}catch(error){return {success:false,message:error.message};}});
  ipcMain.handle('knowledge-resource:close',(event,payload)=>{owner(event);close(entries.get(payload?.id));return {success:true};});
  return {closeAll(){for(const item of [...entries.values()])close(item);}};
}
module.exports={destinations,resolveResource,registerKnowledgeResources};

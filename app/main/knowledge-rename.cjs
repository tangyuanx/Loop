const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {validateNoteFileName} = require('../renderer/src/knowledge-core.js');
const {readKnowledgeDocument,serializeKnowledgeFileOperations} = require('./knowledge-file.cjs');

const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const fail=(code,message,extra={})=>({success:false,canceled:false,code,message,...extra});

// Node's rename() can replace an existing POSIX destination. Use an exclusive
// link/copy followed by unlink instead, retaining source bytes until confirmed.
// copyFile is needed on filesystems (including exFAT) without hard links.
async function moveExclusive(source,target,expectedHash,ops) {
  const original=await ops.lstat(source);
  if(original.isSymbolicLink()||!original.isFile())throw Object.assign(Error('仅支持普通 Markdown 文件改名'),{code:'UNSUPPORTED_FILE_TYPE'});
  let created;
  try{
    try{await ops.link(source,target);}
    catch(error){
      if(!['EXDEV','ENOTSUP','EOPNOTSUPP','EPERM','ENOSYS'].includes(error.code))throw error;
      await ops.copyFile(source,target,constants.COPYFILE_EXCL);
    }
    created=await ops.lstat(target);
    const targetHash=digest(await ops.readFile(target));
    const latest=await ops.lstat(source);
    if(!sameFile(original,latest)||targetHash!==expectedHash||digest(await ops.readFile(source))!==expectedHash){
      throw Object.assign(Error('文件在改名过程中被修改，已停止改名'),{code:'EXTERNAL_CHANGE_REQUIRES_CONFIRMATION'});
    }
    await ops.unlink(source);
  }catch(error){
    if(created){
      try{
        const current=await ops.lstat(target);
        if(!sameFile(current,created)||digest(await ops.readFile(target))!==expectedHash)throw Error('新路径已被其他操作修改，保留文件供恢复');
        await ops.unlink(target);
      }catch(cleanup){if(cleanup.code!=='ENOENT')error.retainedPath=target;}
    }
    throw error;
  }
}

async function renameKnowledgeDocument(payload={}, {fsOps={},platform=process.platform}={}) {
  const checked=validateNoteFileName(payload.name);
  if(!checked.success)return checked;
  const source=String(payload.filePath||'');
  if(!path.isAbsolute(source)||!source.toLowerCase().endsWith('.md'))return fail('INVALID_SOURCE_PATH','原笔记路径无效');
  if(!payload.expectedLastSavedHash)return fail('MISSING_BASELINE','请先重新加载笔记文件，再重命名');
  const target=path.join(path.dirname(source),checked.fileName),ops={...fs,...fsOps};
  return serializeKnowledgeFileOperations([source,target],async()=>{
    try{
      const stat=await ops.lstat(source);
      if(stat.isSymbolicLink()||!stat.isFile())return fail('UNSUPPORTED_FILE_TYPE','请在系统中处理符号链接或非普通文件的改名');
      if(digest(await ops.readFile(source))!==payload.expectedLastSavedHash)return fail('EXTERNAL_CHANGE_REQUIRES_CONFIRMATION','文件已被外部修改，请先重新加载或处理冲突');
      if(source===target)return {success:true,canceled:false,filePath:source,title:checked.title,unchanged:true,
        lastSavedHash:payload.expectedLastSavedHash,lastSavedMtime:stat.mtimeMs};
      let caseOnly=false;
      try{
        const dest=await ops.lstat(target);
        // A case-insensitive volume resolves the new spelling to the old file.
        // A separate hard link already bearing the requested name is a conflict.
        const entries=await ops.readdir(path.dirname(source));
        caseOnly=sameFile(stat,dest)&&path.basename(source).toLowerCase()===checked.fileName.toLowerCase()&&!entries.includes(checked.fileName);
        if(!caseOnly)return fail('FILE_ALREADY_EXISTS','同目录已存在该名称的文件，请换一个名称');
      }catch(error){if(error.code!=='ENOENT')throw error;}
      if(caseOnly){
        const temporary=path.join(path.dirname(source),'.loop-rename-'+crypto.randomUUID()+'.md');
        await moveExclusive(source,temporary,payload.expectedLastSavedHash,ops);
        try{await moveExclusive(temporary,target,payload.expectedLastSavedHash,ops);}
        catch(error){
          try{await moveExclusive(temporary,source,payload.expectedLastSavedHash,ops);}
          catch(rollback){return fail('RENAME_RECOVERY_REQUIRED','改名未完成，原文已保留，请从恢复路径找回文件',{recoveryPath:temporary,errorCode:error.code});}
          throw error;
        }
      }else await moveExclusive(source,target,payload.expectedLastSavedHash,ops);
      const saved=await readKnowledgeDocument(target,{fsOps:ops});
      // The move is already complete. Always report its real destination even
      // when a subsequent read fails; the renderer must retain the correct path.
      return {success:true,canceled:false,filePath:target,previousFilePath:source,title:checked.title,
        lastSavedHash:payload.expectedLastSavedHash,lastSavedMtime:saved.lastSavedMtime,
        warning:saved.success?null:'文件已改名，但重新读取失败，请检查文件状态'};
    }catch(error){
      const message=error.code==='EEXIST'?'同目录已存在该名称的文件，请换一个名称':
        ['EACCES','EPERM','EROFS'].includes(error.code)?'文件或目录不可写，改名未完成':
        error.code==='ENOENT'?'原文件不存在或已被移动，请重新定位文件':error.message;
      return fail(error.code==='EEXIST'?'FILE_ALREADY_EXISTS':error.code||'RENAME_FAILED',message,
        error.retainedPath?{retainedPath:error.retainedPath}:{});
    }
  },platform);
}
module.exports={renameKnowledgeDocument};

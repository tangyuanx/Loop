/* Shared, DOM-free Markdown identity and editing logic. No document conversion. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LoopKnowledgeCore = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  // CodeMirror uses one position for each line break. Keep the original byte
  // spelling separately, including mixed endings, for lossless persistence.
  function sourceFormat(raw) {
    const breaks=new Map();let removed=0,preferred='';
    const text=String(raw).replace(/\r\n|\r|\n/g,(ending,offset)=>{
      if(!preferred)preferred=ending;
      if(ending!==preferred)breaks.set(offset-removed,ending);
      removed+=ending.length-1;return '\n';
    });
    return {text,breaks,preferred:preferred||'\n'};
  }
  function serializeSource(text,format) {
    if(format.preferred==='\n'&&!format.breaks.size)return text;
    return text.replace(/\n/g,(_ending,offset)=>format.breaks.get(offset)||format.preferred);
  }
  function excludedRanges(text) {
    const ranges = [];
    let offset = 0, fence = null, listIndent = null;
    const front = text.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
    if (front) ranges.push([0, front[0].length]);
    for (const line of text.split('\n')) {
      const list = line.match(/^(\s*)(?:[-+*]|\d+[.)])\s+/);
      if (list) listIndent = list[0].length;
      else if (line.trim() && !/^\s/.test(line)) listIndent = null;
      const marker = line.match(/^\s{0,3}(?:>\s*)*(`{3,}|~{3,})(.*)$/);
      if (fence) {
        ranges.push([offset, offset + line.length]);
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      } else if (marker) {
        fence = marker[1]; ranges.push([offset, offset + line.length]);
      } else if (/^(?: {4}|\t)/.test(line) && !list && (listIndent === null || line.match(/^\s*/)[0].length >= listIndent + 4)) {
        // Indented code; nested list text is subsequently identified by the editor parser.
        ranges.push([offset, offset + line.length]);
      }
      offset += line.length + 1;
    }
    const blockRanges = ranges.slice().sort((a,b)=>a[0]-b[0]);
    let blockCursor = 0;
    const covered = pos => {
      while (blockCursor < blockRanges.length && blockRanges[blockCursor][1] <= pos) blockCursor++;
      return blockCursor < blockRanges.length && blockRanges[blockCursor][0] <= pos;
    };
    const tokens = /<!--|%%|`+/g;
    let m;
    while ((m = tokens.exec(text))) {
      if (covered(m.index) || escaped(text, m.index)) continue;
      const closer = m[0] === '<!--' ? '-->' : m[0];
      let end = text.indexOf(closer, tokens.lastIndex);
      if (m[0][0] === '`') {
        while (end >= 0 && (text[end-1] === '`' || text[end+closer.length] === '`')) end = text.indexOf(closer, end + closer.length);
        if (end < 0) continue; // An incomplete code span is ordinary editable text.
      }
      if (end < 0) end = text.length; else end += closer.length;
      ranges.push([m.index, end]); tokens.lastIndex = end;
    }
    return ranges.sort((a,b) => a[0]-b[0]);
  }
  function escaped(text, at) {
    let count = 0; while (at > 0 && text[--at] === '\\') count++;
    return count % 2 === 1;
  }
  function parseTarget(raw) {
    const pipe = raw.indexOf('|');
    const target = (pipe < 0 ? raw : raw.slice(0, pipe)).trim();
    const hash = target.indexOf('#');
    return { target: (hash < 0 ? target : target.slice(0,hash)).trim(),
      anchor: hash < 0 ? '' : target.slice(hash+1).trim(), label: pipe < 0 ? '' : raw.slice(pipe+1).trim() };
  }
  function links(text) {
    text = String(text ?? '');
    const excluded = excludedRanges(text), out = [];
    const regex = /(!?)\[\[([^\]\n]+)\]\]/g; let m, cursor = 0;
    while ((m = regex.exec(text))) {
      while (cursor < excluded.length && excluded[cursor][1] <= m.index) cursor++;
      if (escaped(text, m.index) || (excluded[cursor] && excluded[cursor][0] < regex.lastIndex)) continue;
      out.push({ ...parseTarget(m[2]), from: m.index, to: regex.lastIndex, embed: m[1] === '!', raw: m[0] });
    }
    return out;
  }
  function imageReferences(text) {
    text=String(text??'');const masks=excludedRanges(text),out=[];let at=0,cursor=0;
    while((at=text.indexOf('![',at))>=0){
      const start=at;at+=2;while(cursor<masks.length&&masks[cursor][1]<=start)cursor++;
      if(escaped(text,start)||(masks[cursor]&&masks[cursor][0]<=start))continue;
      let p=at,depth=1;
      for(;p<text.length&&depth;p++){if(escaped(text,p))continue;if(text[p]==='[')depth++;if(text[p]===']')depth--;}
      if(depth||text[p]!=='(')continue;
      p++;while(/\s/.test(text[p]||'')&&p<text.length)p++;
      const angle=text[p]==='<';if(angle)p++;
      const from=p;let nested=0;
      for(;p<text.length;p++){
        if(escaped(text,p))continue;
        const c=text[p];if(angle){if(c==='>')break;}else{
          if(c==='(')nested++;
          if(c===')'){if(nested)nested--;else break;}
          if(/\s/.test(c)&&!nested)break;
        }
      }
      if(p===from||p>=text.length)continue;
      const to=p,url=text.slice(from,to).replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,'$1');
      if(angle){if(text[p]!=='>')continue;p++;}
      const rest=text.slice(p).match(/^[ \t]*(?:(?:"(?:\\[^\n]|[^"\\\n])*"|'(?:\\[^\n]|[^'\\\n])*'|\((?:\\[^\n]|[^)\\\n])*\))[ \t]*)?\)/);
      if(!rest)continue;
      out.push({from,to,url,start,end:p+rest[0].length});at=p+rest[0].length;
    }
    return out;
  }
  function noteId(note) { return String(note?.knowledgeNote?.noteId || note?.id || ''); }
  function noteTitle(note) { return String(note?.knowledgeNote?.title || note?.title || '未命名笔记'); }
  function normalized(value) { return String(value).normalize('NFC').trim().replace(/\.md$/i, '').toLocaleLowerCase(); }
  function resolve(target, notes, current) {
    if (!target && current) return { status: 'resolved', note: current };
    const stable = target.startsWith('note:') ? target.slice(5) : null;
    const hits = notes.filter(note => stable !== null ? noteId(note) === stable :
      [noteTitle(note), note.title, ...(note.knowledgeNote?.aliases || [])].some(title => normalized(title) === normalized(target)));
    return hits.length === 1 ? { status: 'resolved', note: hits[0] } : { status: hits.length ? 'ambiguous' : 'missing', candidates: hits };
  }
  function stableLink(note, label = noteTitle(note), anchor = '', embed = false) {
    const safe = String(label).replace(/[\[\]|\r\n]/g, ' ');
    return `${embed ? '!' : ''}[[note:${noteId(note)}${anchor ? '#' + anchor : ''}|${safe}]]`;
  }
  // A note name is free text, but the file that stores it has to exist on every
  // platform Loop ships to. One rule set is shared by the rename dialog, the
  // main process and the tests so the UI never promises a name the disk refuses.
  const NOTE_NAME_ILLEGAL=/[<>:"/\\|?*\u0000-\u001f]/;
  const NOTE_NAME_RESERVED=/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  function noteFileBase(title) { return String(title??'').normalize('NFC').trim().replace(/\.md$/i,'').trim(); }
  function utf8Length(text) {
    if (typeof TextEncoder==='function') return new TextEncoder().encode(text).length;
    return typeof Buffer==='object'&&Buffer?Buffer.byteLength(text,'utf8'):text.length*3;
  }
  function validateNoteName(title,{extension='.md',maxBytes=200}={}) {
    const base=noteFileBase(title);
    if(!base) return {ok:false,code:'NAME_EMPTY',message:'请输入笔记名称'};
    if(NOTE_NAME_ILLEGAL.test(base)) return {ok:false,code:'NAME_INVALID_CHARS',message:'名称不能包含 \\ / : * ? " < > | 等字符'};
    if(/[. ]$/.test(base)) return {ok:false,code:'NAME_INVALID_CHARS',message:'名称不能以空格或句点结尾'};
    if(NOTE_NAME_RESERVED.test(base)) return {ok:false,code:'NAME_RESERVED',message:'这个名称被系统保留，请换一个名称'};
    const fileName=base+String(extension??'');
    if(utf8Length(fileName)>maxBytes) return {ok:false,code:'NAME_TOO_LONG',message:'名称过长，请缩短后再保存'};
    return {ok:true,base,fileName};
  }
  // Windows resolves names case-insensitively and macOS does too by default, so
  // "same file" comparisons in both the app and the tests share this rule.
  function caseInsensitivePaths(platform) { return platform==='win32'||platform==='darwin'; }
  function canonicalPath(value,platform='') {
    let normalized=String(value??'').trim().replaceAll('\\','/').replace(/\/+/g,'/');
    if(!normalized) return '';
    normalized=normalized.replace(/\/\.\//g,'/').replace(/\/+$/,'');
    return caseInsensitivePaths(platform)?normalized.toLowerCase():normalized;
  }
  // A relative Markdown destination as an absolute path, resolved against the
  // directory of the note that contains the link.
  function resolvePath(fromFilePath,relative) {
    const parts=String(fromFilePath??'').replaceAll('\\','/').split('/').slice(0,-1);
    for(const part of String(relative??'').replaceAll('\\','/').split('/')){
      if(!part||part==='.')continue;
      if(part==='..')parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  }
  function relativePathBetween(fromDirectory,targetPath,platform='') {
    const from=String(fromDirectory??'').replaceAll('\\','/').split('/').filter(part=>part&&part!=='.');
    const to=String(targetPath??'').replaceAll('\\','/').split('/').filter(part=>part&&part!=='.');
    const fold=caseInsensitivePaths(platform)?(value=>value.toLowerCase()):(value=>value);
    let shared=0;
    while(shared<from.length&&shared<to.length&&fold(from[shared])===fold(to[shared]))shared++;
    return [...Array(from.length-shared).fill('..'),...to.slice(shared)].join('/');
  }
  // Every relative link in `content` that points at `filePath`. Only this kind of
  // reference can break when a note file is renamed: stable links carry the note
  // identifier and title links keep the previous title as an alias.
  function linksToFile(content,{noteFilePath,filePath,platform=''}={}) {
    const target=canonicalPath(filePath,platform);
    if(!target||!noteFilePath) return [];
    return relativeLinks(content).filter(link=>canonicalPath(resolvePath(noteFilePath,link.dest),platform)===target);
  }
  function rewriteLinksToFile(content,{noteFilePath,filePath,nextPath,platform=''}={}) {
    const matches=linksToFile(content,{noteFilePath,filePath,platform});
    if(!matches.length) return {content:String(content??''),changed:0};
    const directory=String(noteFilePath??'').replaceAll('\\','/').split('/').slice(0,-1).join('/');
    const relative=relativePathBetween(directory,nextPath,platform);
    let output=String(content??'');
    // Right to left keeps every earlier offset valid.
    for(const link of matches.slice().reverse()){
      if(typeof link.destFrom!=='number') continue;
      const raw=String(link.rawDest??''),angle=raw.startsWith('<');
      const hashAt=raw.indexOf('#'),suffix=hashAt<0?(angle?'>':''):raw.slice(hashAt);
      const destination=`${link.dest.startsWith('./')?'./':''}${relative}`.replace(/\\/g,'/');
      const written=/%[0-9a-f]{2}/i.test(raw)?encodeURI(destination):destination;
      output=output.slice(0,link.destFrom)+(angle?`<${written}${suffix}`:`${written}${suffix}`)+output.slice(link.destTo);
    }
    return {content:output,changed:matches.length};
  }
  function unnumberedHeading(text) {
    if (/^(?:19|20)\d{2}[ \t]+/.test(text)) return text;
    return text.replace(/^\d+(?:\.\d+)*[.)、]?[ \t]+(?=\S)/, '');
  }
  function headingAnchorKey(text) {
    return normalized(unnumberedHeading(text).replace(/(?<!\w)_{1,2}(?=\S)|(?<=\S)_{1,2}(?!\w)|~~/g, '')
      .replace(/(?<=\p{Script=Han})(?=\p{Script=Latin})|(?<=\p{Script=Latin})(?=\p{Script=Han})/gu, ' ')
      .replace(/[ \t]+/g, ' '));
  }
  function headingIndex(headings, anchor) {
    const target = normalized(anchor);
    const exact = headings.findIndex(heading => normalized(heading.text) === target);
    if (exact >= 0) return exact;
    const key = headingAnchorKey(anchor);
    let match = -1;
    for (let i = 0; i < headings.length; i++) {
      if (headingAnchorKey(headings[i].text) !== key) continue;
      if (match >= 0) return -1;
      match = i;
    }
    return match;
  }
  function headings(text) {
    const excluded = excludedRanges(String(text)); let offset = 0, i = 0;
    const out = [];
    const lines=String(text).split('\n');
    for (const [lineIndex,line] of lines.entries()) {
      while (i < excluded.length && excluded[i][1] <= offset) i++;
      const m = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (!(excluded[i] && excluded[i][0] <= offset)) {
        if (m) out.push({level:m[1].length,text:m[2].replace(/[*`]/g,''),offset});
        else if (line.trim() && !/^\s*(?:[-+*](?:\s|$)|[#>`]|\d+[.)]\s)/.test(line) && /^ {0,3}(?:={3,}|-{3,})\s*$/.test(lines[lineIndex+1]||'')) out.push({level:lines[lineIndex+1].trim()[0]==='='?1:2,text:line.trim().replace(/[*`]/g,''),offset});
      }
      offset += line.length + 1;
    }
    return out;
  }
  function fragment(text, anchor) {
    if (!anchor) return String(text);
    if (anchor.startsWith('^')) {
      const block = anchor.slice(1); const lines = String(text).split('\n');
      const excluded = excludedRanges(String(text)); let off = 0;
      for (let i=0;i<lines.length;i++) {
        if (lines[i].trimEnd().endsWith(' ^'+block) || lines[i].trim() === '^'+block) {
          if (excluded.some(([a,b]) => off>=a && off<b)) { off+=lines[i].length+1; continue; }
          let start=i; while(start>0 && lines[start-1].trim()) start--;
          return lines.slice(start,i+1).join('\n').replace(new RegExp('\\s*\\^'+block.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$'),'');
        }
        off+=lines[i].length+1;
      }
      return null;
    }
    const hs = headings(text); const at = headingIndex(hs, anchor);
    if (at < 0) return null;
    const end = hs.slice(at+1).find(h => h.level <= hs[at].level)?.offset ?? text.length;
    return text.slice(hs[at].offset,end);
  }
  // Click navigation must resolve anchors with the same rules as embeds:
  // fenced code and comments never define a block id, and heading matching is
  // case/Unicode insensitive on both sides.
  function anchorOffset(text, anchor) {
    text=String(text??''); anchor=String(anchor??'').trim();
    if(!anchor) return 0;
    const lines=text.split('\n'), excluded=excludedRanges(text);
    const covered=offset=>excluded.some(([a,b])=>offset>=a&&offset<b);
    let offset=0;
    if(anchor.startsWith('^')) {
      const block=anchor.slice(1);
      for(const line of lines) {
        if((line.trimEnd().endsWith(' ^'+block)||line.trim()==='^'+block)&&!covered(offset)) return offset;
        offset+=line.length+1;
      }
      return null;
    }
    const hs = headings(text);
    return hs[headingIndex(hs, anchor)]?.offset ?? null;
  }
  // Relative Markdown links that can point at another note on disk. Used for
  // backlinks alongside wiki links; images, code and comments are excluded.
  function relativeLinks(text) {
    text=String(text??''); const masks=excludedRanges(text), out=[]; let cursor=0;
    const regex=/!?\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g; let m;
    while((m=regex.exec(text))) {
      const start=m.index;
      while(cursor<masks.length&&masks[cursor][1]<=start) cursor++;
      if(escaped(text,start)||(masks[cursor]&&masks[cursor][0]<=start)||m[0].startsWith('!')) continue;
      const raw=String(m[2]);
      let dest=raw.replace(/^<|>$/g,'').replace(/#.*$/,'');
      if(!dest||/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(dest)) continue;
      try{dest=decodeURIComponent(dest);}catch{}
      // Offsets of the raw destination keep link rewriting local: a caller can
      // replace exactly the written path without re-serialising the document.
      const destFrom=start+m[0].lastIndexOf(raw);
      out.push({dest, rawDest:raw, from:start, to:regex.lastIndex,
        destFrom, destTo:destFrom+raw.length});
    }
    return out;
  }
  function splitRow(line) {
    let raw = line.trim(); if (raw.startsWith('|')) raw=raw.slice(1); if (raw.endsWith('|') && !escaped(raw,raw.length-1)) raw=raw.slice(0,-1);
    const cells=[]; let start=0, tick=0;
    for(let i=0;i<raw.length;i++) {
      if(raw[i]==='`' && !escaped(raw,i)) tick = tick ? 0 : 1;
      if(raw[i]==='|' && !tick && !escaped(raw,i)) { cells.push(raw.slice(start,i).trim()); start=i+1; }
    }
    cells.push(raw.slice(start).trim()); return cells;
  }
  function tableAt(text, pos) {
    const lines=String(text).split('\n'); let n=0, off=0;
    while(n<lines.length-1 && off+lines[n].length < pos) off+=lines[n++].length+1;
    let start=n; while(start>0 && lines[start-1].includes('|') && lines[start-1].trim()) start--;
    if(!lines[start]?.includes('|') || !/^\s*\|?\s*:?-{3,}/.test(lines[start+1] || '')) return null;
    let end=start+2; while(end<lines.length && lines[end].includes('|') && lines[end].trim()) end++;
    if(n>=end) return null;
    const from=lines.slice(0,start).reduce((a,s)=>a+s.length+1,0);
    return {from,to:from+lines.slice(start,end).join('\n').length,row:n-start,rows:lines.slice(start,end).map(splitRow)};
  }
  function editTable(text,pos,operation,index=0,value='') {
    const table=tableAt(text,pos); if(!table) return null;
    let rows=table.rows.map(r=>r.slice()), count=rows[0].length;
    // Pad short rows to the header width but never truncate: a row may carry
    // extra fields the rendered table does not show, and an unrelated edit
    // (adding a row, editing one cell) must not rewrite them away.
    rows=rows.map(r=>{const next=r.slice();while(next.length<count)next.push('');return next;});
    const row=Math.max(0,Math.min(rows.length-1,table.row)); index=Math.max(0,Math.min(count-1,index));
    if(operation==='delete')return {from:table.from,to:table.to,insert:''};
    if(operation==='row-add'||operation==='row-before') rows.splice(Math.max(2,row+(operation==='row-add'?1:0)),0,Array(count).fill(''));
    else if(operation==='row-delete') { if(row<2) return null; rows.splice(row,1); }
    else if(operation==='column-add'||operation==='column-before') rows.forEach((r,i)=>r.splice(index+(operation==='column-add'?1:0),0,i===1?'---':''));
    else if(operation==='column-delete') { if(count<=1) return null; rows.forEach(r=>r.splice(index,1)); }
    else if(operation==='row-duplicate') {if(row<2)return null;rows.splice(row+1,0,rows[row].slice());}
    else if(operation==='row-clear') {if(row===1)return null;rows[row]=rows[row].map(()=>'');}
    else if(operation==='column-duplicate') rows.forEach(r=>r.splice(index+1,0,r[index]));
    else if(operation==='column-clear') rows.forEach((r,i)=>{if(i!==1)r[index]='';});
    else if(operation==='cell-clear') {if(row===1)return null;rows[row][index]='';}
    else if(operation==='row-move') {const target=Number(value);if(row<2||!Number.isInteger(target)||target<2||target>=rows.length||row===target)return null;rows.splice(target,0,rows.splice(row,1)[0]);}
    else if(operation==='column-move') {const target=Number(value);if(!Number.isInteger(target)||target<0||target>=count||target===index)return null;
      // Move inside the header width only; cells beyond it keep their place.
      rows.forEach(r=>{const cells=r.slice(0,count);cells.splice(target,0,cells.splice(index,1)[0]);r.splice(0,count,...cells);});}
    else if(operation==='cell') { if(row===1) return null; rows[row][index]=String(value).replace(/\n/g,'<br>').replace(/(?<!\\)\|/g,'\\|'); }
    else if(operation==='align') rows[1][index]=value==='center'?':---:':value==='right'?'---:':':---';
    else return null;
    return {from:table.from,to:table.to,insert:rows.map(r=>'| '+r.join(' | ')+' |').join('\n')};
  }
  function pasteTable(text,pos,column,clipboard) {
    const table=tableAt(text,pos);if(!table||table.row===1)return null;
    const grid=String(clipboard).replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n').map(line=>line.split('\t'));
    const rows=table.rows.map(row=>row.slice()),start=table.row;
    const count=Math.max(rows[0].length,column+Math.max(...grid.map(row=>row.length)));
    for(const row of rows)while(row.length<count)row.push(row===rows[1]?'---':'');
    for(let r=0;r<grid.length;r++){
      const target=start+r+(start===0&&r>0?1:0);
      while(rows.length<=target)rows.push(Array(count).fill(''));
      for(let c=0;c<grid[r].length;c++)rows[target][column+c]=grid[r][c].replace(/(?<!\\)\|/g,'\\|');
    }
    return {from:table.from,to:table.to,insert:rows.map(row=>'| '+row.join(' | ')+' |').join('\n')};
  }
  class SerialQueue {
    constructor() { this.queues=new Map(); }
    run(key,operation) {
      const next=(this.queues.get(key)||Promise.resolve()).catch(()=>{}).then(operation);
      this.queues.set(key,next);
      return next.finally(()=>{ if(this.queues.get(key)===next) this.queues.delete(key); });
    }
  }
  return {sourceFormat,serializeSource,excludedRanges,escaped,parseTarget,links,imageReferences,noteId,noteTitle,resolve,stableLink,noteFileBase,validateNoteName,canonicalPath,resolvePath,relativePathBetween,linksToFile,rewriteLinksToFile,headings,unnumberedHeading,headingAnchorKey,anchorOffset,fragment,relativeLinks,splitRow,tableAt,editTable,pasteTable,SerialQueue};
});

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
      breaks.set(offset-removed,ending);removed+=ending.length-1;
      if(!preferred)preferred=ending;return '\n';
    });
    return {text,breaks,preferred:preferred||'\n'};
  }
  function serializeSource(text,format) {
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
      const rest=text.slice(p).match(/^[ \t]*(?:(?:"[^"\n]*"|'[^'\n]*'|\([^\n)]*\))[ \t]*)?\)/);
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
  function headings(text) {
    const excluded = excludedRanges(String(text)); let offset = 0, i = 0;
    const out = [];
    const lines=String(text).split('\n');
    for (const [lineIndex,line] of lines.entries()) {
      while (i < excluded.length && excluded[i][1] <= offset) i++;
      const m = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (!(excluded[i] && excluded[i][0] <= offset)) {
        if (m) out.push({level:m[1].length,text:m[2].replace(/[*`]/g,''),offset});
        else if (line.trim() && !/^\s*(?:[-+*#>`]|\d+[.)]\s)/.test(line) && /^ {0,3}(?:={3,}|-{3,})\s*$/.test(lines[lineIndex+1]||'')) out.push({level:lines[lineIndex+1].trim()[0]==='='?1:2,text:line.trim().replace(/[*`]/g,''),offset});
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
    const hs = headings(text); const at = hs.findIndex(h => normalized(h.text) === normalized(anchor));
    if (at < 0) return null;
    const end = hs.slice(at+1).find(h => h.level <= hs[at].level)?.offset ?? text.length;
    return text.slice(hs[at].offset,end);
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
    rows=rows.map(r=>Array.from({length:count},(_,i)=>r[i] || ''));
    const row=Math.max(0,Math.min(rows.length-1,table.row)); index=Math.max(0,Math.min(count-1,index));
    if(operation==='row-add') rows.splice(Math.max(2,row+1),0,Array(count).fill(''));
    else if(operation==='row-delete') { if(row<2 || rows.length<=3) return null; rows.splice(row,1); }
    else if(operation==='column-add') rows.forEach((r,i)=>r.splice(index+1,0,i===1?'---':''));
    else if(operation==='column-delete') { if(count<=1) return null; rows.forEach(r=>r.splice(index,1)); }
    else if(operation==='cell') { if(row===1) return null; rows[row][index]=String(value).replace(/\n/g,'<br>').replace(/(?<!\\)\|/g,'\\|'); }
    else if(operation==='align') rows[1][index]=value==='center'?':---:':value==='right'?'---:':':---';
    else return null;
    return {from:table.from,to:table.to,insert:rows.map(r=>'| '+r.join(' | ')+' |').join('\n')};
  }
  class SerialQueue {
    constructor() { this.queues=new Map(); }
    run(key,operation) {
      const next=(this.queues.get(key)||Promise.resolve()).catch(()=>{}).then(operation);
      this.queues.set(key,next);
      return next.finally(()=>{ if(this.queues.get(key)===next) this.queues.delete(key); });
    }
  }
  return {sourceFormat,serializeSource,excludedRanges,escaped,parseTarget,links,imageReferences,noteId,noteTitle,resolve,stableLink,headings,fragment,splitRow,tableAt,editTable,SerialQueue};
});

import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import tasks from 'markdown-it-task-lists';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import 'katex/dist/katex.min.css';

const core = window.LoopKnowledgeCore;
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let graphId=0;
mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:'neutral',maxTextSize:100000,
  flowchart:{htmlLabels:false}});
export function safeURL(value, image=false) {
  const raw=String(value||'').trim();
  if(/[\u0000-\u0020\u007f]/.test(raw) || /^(?:javascript|vbscript|file):/i.test(raw)) return '';
  if(image && /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=]+$/i.test(raw)) return raw;
  if(image && /^data:image\/svg\+xml;base64,/i.test(raw)) {
    try {
      if(raw.length>3*1024*1024)return '';
      const decoded=new TextDecoder().decode(Uint8Array.from(atob(raw.split(',')[1]),c=>c.charCodeAt(0)));
      const clean=DOMPurify.sanitize(decoded,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['script','foreignObject','style','a','image','animate','set']});
      if(!clean.includes('<svg'))return '';
      return 'data:image/svg+xml;base64,'+btoa(Array.from(new TextEncoder().encode(clean),b=>String.fromCharCode(b)).join(''));
    } catch {return '';}
  }
  if(/^(?:https?:|mailto:|#)/i.test(raw)) return image && /^mailto:/i.test(raw) ? '' : raw;
  if(!/^[a-z][a-z\d+.-]*:/i.test(raw) && !raw.startsWith('//') && !raw.includes('\\')) return raw;
  return '';
}
export function createRenderer(options) {
  const md=new MarkdownIt({html:false,linkify:true,breaks:false,typographer:false,highlight(code,language) {
    try { return language && hljs.getLanguage(language) ? hljs.highlight(code,{language,ignoreIllegals:true}).value : ''; }
    catch { return ''; }
  }}).use(footnote).use(mark).use(tasks,{enabled:true}).use(texmath,{engine:katex,delimiters:'dollars',katexOptions:{throwOnError:false,trust:false,strict:'warn',maxExpand:1000,maxSize:20}});
  md.block.ruler.before('hr','frontmatter',(state,start,end,silent)=>{
    if(start!==0 || state.src.slice(state.bMarks[0],state.eMarks[0]).replace(/^\uFEFF/,'')!=='---') return false;
    let line=start+1;
    while(line<end && !/^(?:---|\.\.\.)\s*$/.test(state.src.slice(state.bMarks[line],state.eMarks[line]))) line++;
    if(line===end) return false;
    if(!silent) { const token=state.push('loop_frontmatter','',0); token.content=state.getLines(start+1,line,0,false); token.map=[start,line+1]; state.line=line+1; }
    return true;
  });
  const tokenRender = md.renderer.renderToken.bind(md.renderer);
  for (const type of ['heading_open','paragraph_open','list_item_open','fence','blockquote_open']) {
    if (type === 'fence') continue;
    md.renderer.rules[type] = (tokens,i,o,env,self) => {
      const token=tokens[i];
      if(token.map) token.attrSet('data-source-line',String(token.map[0]));
      if(type==='heading_open') {
        const inline=tokens[i+1];
        const label=(inline?.content||'').replace(/[*`]/g,'');
        const counts=env.headingCounts||(env.headingCounts=new Map());const count=counts.get(label)||0;counts.set(label,count+1);
        token.attrSet('id',label+(count?'-'+count:''));
      }
      return tokenRender(tokens,i,o);
    };
  }
  md.renderer.rules.loop_frontmatter=(tokens,i)=>`<details class="kn-frontmatter"><summary>属性 · YAML</summary><pre>${escape(tokens[i].content)}</pre></details>`;
  md.inline.ruler.before('link','loop_wiki',(state,silent)=>{
    const match=/^(!?)\[\[([^\]\n]+)\]\]/.exec(state.src.slice(state.pos));
    if(!match) return false;
    if(!silent) { const t=state.push('loop_wiki','',0); t.meta={...core.parseTarget(match[2]),embed:Boolean(match[1])}; }
    state.pos+=match[0].length; return true;
  });
  md.inline.ruler.before('emphasis','loop_comment',(state,silent)=>{
    if(!state.src.startsWith('%%',state.pos)) return false;
    const end=state.src.indexOf('%%',state.pos+2);
    if(end<0) return false;
    state.pos=end+2; return true;
  });
  md.core.ruler.after('github-task-lists','loop_callout',state=>{
    const offsets=[0]; for(let p=0;p<state.src.length;p++) if(state.src[p]==='\n') offsets.push(p+1);
    for(let i=0;i<state.tokens.length;i++) {
      const t=state.tokens[i];
      if(t.type==='inline' && t.map) {
        const marker=/\[[ xX]\]/.exec(state.src.slice(offsets[t.map[0]],offsets[t.map[0]+1]));
        if(marker) for(const child of t.children||[]) if(child.type==='html_inline' && child.content.includes('task-list-item-checkbox')) {
          child.content=child.content.replace('<input','<input data-task-pos="'+(offsets[t.map[0]]+marker.index+1)+'"');
        }
      }
      if(t.type!=='blockquote_open') continue;
      const inline=state.tokens[i+2];
      const m=inline?.type==='inline' && /^\[!([\w-]+)\]([+-])?(?:[ \t]+([^\n]*))?(?:\n|$)/.exec(inline.content);
      if(!m) continue;
      t.attrSet('class','kn-callout'+(m[2]==='-'?' is-collapsed':''));
      t.attrSet('data-callout',m[1].toLowerCase());
      inline.content=inline.content.slice(m[0].length);
      inline.children=md.parseInline(inline.content,state.env)[0].children;
      const title=new state.Token('html_inline','',0);
      title.content=`<button type="button" class="kn-callout-title" aria-expanded="${m[2]!=='-'}">${escape(m[3]||m[1].toUpperCase())}</button>`;
      inline.children.unshift(title);
    }
  });
  md.renderer.rules.loop_wiki=(tokens,i,_o,env)=>{
    const link=tokens[i].meta;
    const notes=options.getNotes(); const current=notes.find(n=>core.noteId(n)===env.noteId);
    const found=core.resolve(link.target,notes,current);
    const title=link.label || (found.note ? core.noteTitle(found.note) : link.target) || link.anchor;
    const attr=`data-note-target="${escape(link.target)}" data-note-anchor="${escape(link.anchor)}"`;
    const button=`<a href="#" class="kn-wiki ${found.status==='resolved'?'':'is-unresolved'}" ${attr} title="${escape(found.status==='missing'?'笔记不存在，点击创建':found.status==='ambiguous'?'有多个同名笔记，点击选择':title)}">${escape(title)}</a>`;
    if(!link.embed) return button;
    if(found.status!=='resolved') return `<div class="kn-embed">${button}<small> · ${found.status==='ambiguous'?'请选择同名笔记':'目标尚未创建'}</small></div>`;
    const targetId=core.noteId(found.note), stack=env.stack||[];
    if(stack.includes(targetId) || stack.length>=3) return `<div class="kn-embed">${button}<small> · 循环引用或嵌入层级达到上限</small></div>`;
    const body=core.fragment(options.getContent(found.note),link.anchor);
    if(body===null) return `<div class="kn-embed">${button}<small> · 标题或块不存在</small></div>`;
    return `<div class="kn-embed">${button}<div class="kn-embed-body">${render(body,{noteId:targetId,stack:[...stack,targetId],embedded:true})}</div></div>`;
  };
  const defaultImage=md.renderer.rules.image;
  md.renderer.rules.image=(tokens,i,o,env,self)=>{
    const src=tokens[i].attrGet('src');
    const resolved=options.resolveImage?.(env.noteId,src) || (/^(https?:|data:image\/)/i.test(src) ? safeURL(src,true) : '');
    const safeImage=safeURL(resolved,true);
    if(!safeImage) return `<span class="kn-image-missing">图片不可用：${escape(tokens[i].content)}</span>`;
    tokens[i].attrSet('src',safeImage); tokens[i].attrSet('loading','lazy');
    return defaultImage(tokens,i,o,env,self);
  };
  const defaultFence=md.renderer.rules.fence;
  md.renderer.rules.fence=(tokens,i,o,env,self)=>{
    const t=tokens[i], language=t.info.trim().split(/\s/)[0];
    if(language==='mermaid') return `<div class="kn-mermaid"><pre><code>${escape(t.content)}</code></pre></div>`;
    return `<div class="kn-code"><button type="button" class="kn-code-copy" aria-label="复制代码">复制</button>${defaultFence(tokens,i,o,env,self)}</div>`;
  };
  const defaultLink=md.renderer.rules.link_open || ((ts,i,o,_e,s)=>s.renderToken(ts,i,o));
  md.renderer.rules.link_open=(tokens,i,o,env,self)=>{
    const url=tokens[i].attrGet('href');
    tokens[i].attrSet('href',safeURL(url)||'#'); tokens[i].attrSet('rel','noopener noreferrer');
    if(url && !/^(?:https?:|mailto:|#)/i.test(url)) tokens[i].attrSet('data-relative-note',url);
    return defaultLink(tokens,i,o,env,self);
  };
  // task-image is a managed reference, resolved and validated by the image rule.
  const validate=md.validateLink.bind(md);
  md.validateLink=url=>/^task-image:[\w-]+$/.test(url) || /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,/i.test(url) || validate(url);
  function render(source,env={}) {
    try {
      let input=String(source ?? '');
      // Obsidian block comments are hidden, including multi-paragraph comments.
      const ranges=core.excludedRanges(input).filter(([a])=>input.startsWith('%%',a)||input.startsWith('<!--',a));
      for(const [a,b] of ranges.reverse()) input=input.slice(0,a)+input.slice(a,b).replace(/[^\n]/g,' ')+input.slice(b);
      const html=md.render(input,env);
      return DOMPurify.sanitize(html,{ADD_ATTR:['data-task-pos','data-note-target','data-note-anchor','data-relative-note','data-diagram','data-callout','data-source-line','aria-expanded'],FORBID_TAGS:['style','iframe','object','embed','script'],USE_PROFILES:{html:true,svg:true,svgFilters:true}});
    } catch(error) { return `<pre class="kn-render-failure">${escape(source)}</pre>`; }
  }
  async function enhance(root,onChange) {
    for(const node of root.querySelectorAll('.kn-mermaid:not([data-rendering])')) {
      node.dataset.rendering='true';
      try {
        const {svg}=await mermaid.render('loopDiagram'+(++graphId),node.querySelector('code')?.textContent || '');
        if(root.contains(node)) { node.innerHTML=DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true}}); onChange?.(); }
      } catch(error) {
        if(root.contains(node)) { const notice=document.createElement('small'); notice.textContent='图表语法有误，已保留源码'; node.prepend(notice); }
      }
    }
  }
  return {render,enhance,parse:source=>md.parse(source,{})};
}
export {escape};

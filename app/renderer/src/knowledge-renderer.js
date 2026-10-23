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
mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:'neutral',maxTextSize:100000,htmlLabels:false,
  secure:['secure','securityLevel','startOnLoad','maxTextSize','suppressErrorRendering','maxEdges','htmlLabels'],
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
    if(options.offlineExport && /^https?:/i.test(safeImage))return `<span class="kn-image-missing">网络图片未内嵌：${escape(tokens[i].content||src)}</span>`;
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
  async function enhance(root,onChange,{signal,timeoutMs=12000}={}) {
    const results=[];
    for(const node of root.querySelectorAll('.kn-mermaid:not([data-rendering])')) {
      if(signal?.aborted)throw new DOMException('导出已取消','AbortError');
      node.dataset.rendering='true';
      const diagramSource=node.querySelector('code')?.textContent || '';
      let timer;
      try {
        const {svg}=await Promise.race([
          mermaid.render('loopDiagram'+(++graphId),diagramSource,node),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('图表渲染超时')),timeoutMs);}),
        ]);
        if(signal?.aborted)throw new DOMException('导出已取消','AbortError');
        if(root.contains(node)) {
          if(/<foreignObject\b/i.test(svg))throw new Error('图表标签无法安全显示，请改用纯文本标签');
          node.innerHTML=DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true}});
          const graph=node.querySelector('svg'),box=graph?.viewBox?.baseVal;
          if(!graph || !box?.width || !box?.height)throw new Error('图表没有有效尺寸');
          graph.setAttribute('width',String(box.width));graph.setAttribute('height',String(box.height));
          graph.style.setProperty('--kn-diagram-width',box.width+'px');
          results.push({success:true,width:box.width,height:box.height});onChange?.();
        }
      } catch(error) {
        if(error.name==='AbortError')throw error;
        results.push({success:false,message:error.message?.includes('超时')?'图表渲染超时':error.message?.includes('纯文本标签')?error.message:'图表语法有误，已保留源码'});
        if(root.contains(node)) {node.innerHTML='<pre><code>'+escape(diagramSource)+'</code></pre>'; const notice=document.createElement('small'); notice.textContent=results.at(-1).message; node.prepend(notice); }
      } finally {clearTimeout(timer);}
    }
    return results;
  }
  async function exportStatic(source,env={}, {signal,timeoutMs=12000}={}) {
    const root=document.createElement('article');
    root.className='kn-rendered kn-export-surface';root.style.cssText='position:fixed;left:-20000px;top:0;width:720px;pointer-events:none;';
    root.setAttribute('aria-hidden','true');root.innerHTML=render(source,env);
    const issues=[];
    // Remote URLs remain links in Markdown, but never become offline dependencies.
    for(const img of root.querySelectorAll('img')) {
      if(!img.getAttribute('src')?.startsWith('data:image/')) {
        const missing=document.createElement('span');missing.className='kn-image-missing';
        missing.textContent='网络图片未内嵌：'+(img.alt||img.getAttribute('src')||'未命名图片');img.replaceWith(missing);
      } else {img.removeAttribute('loading');}
    }
    document.body.append(root);
    const abort=()=>root.remove();signal?.addEventListener('abort',abort,{once:true});
    try {
      const diagrams=await enhance(root,null,{signal,timeoutMs});
      issues.push(...diagrams.filter(r=>!r.success).map((r,i)=>`图表 ${i+1}：${r.message}`));
      for(const missing of root.querySelectorAll('.kn-image-missing,.kn-render-failure,.katex-error'))issues.push(missing.textContent.slice(0,180));
      for(const img of root.querySelectorAll('img')) {
        let timer;
        try {
          await Promise.race([img.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('图片加载超时')),timeoutMs);})]);
          if(!img.naturalWidth)throw new Error('图片无法解码');
        } catch(error) {
          const missing=document.createElement('span');missing.className='kn-image-missing';missing.textContent='图片不可用：'+(img.alt||'未命名图片');img.replaceWith(missing);issues.push(missing.textContent);
        } finally {clearTimeout(timer);}
      }
      if(signal?.aborted)throw new DOMException('导出已取消','AbortError');
      root.querySelectorAll('.kn-code-copy').forEach(el=>el.remove());
      root.querySelectorAll('.kn-callout').forEach(el=>el.classList.remove('is-collapsed'));
      root.querySelectorAll('details').forEach(el=>el.open=true);
      root.querySelectorAll('button').forEach(el=>{const title=document.createElement('strong');title.className=el.className;title.textContent=el.textContent;el.replaceWith(title);});
      root.querySelectorAll('input[type=checkbox]').forEach(el=>{const mark=document.createElement('span');mark.className='kn-static-checkbox';mark.textContent=el.checked?'☑ ':'☐ ';el.replaceWith(mark);});
      const html=DOMPurify.sanitize(root.innerHTML,{USE_PROFILES:{html:true,svg:true,svgFilters:true,mathMl:true},FORBID_TAGS:['script','iframe','object','embed','foreignObject','input','button','form']});
      return {html,issues:[...new Set(issues)],diagrams};
    } finally {signal?.removeEventListener('abort',abort);root.remove();}
  }
  return {render,enhance,exportStatic,parse:source=>md.parse(source,{})};
}
export {escape};

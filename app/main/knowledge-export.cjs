const fs = require('node:fs/promises');
const path = require('node:path');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function noteDocumentHtml({ taskTitle, bodyHtml }) {
  const css = await fs.readFile(path.join(__dirname, 'knowledge-export-assets.css'), 'utf8');
  if (!css.includes('data:font/woff2;base64,')) throw new Error('笔记导出字体资源缺失，请重新构建应用。');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; img-src data:; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escape(taskTitle)}</title><style>${css}
:root {color:#17211c;font-family:"PingFang SC","Microsoft YaHei",Arial,sans-serif;font-size:15px;line-height:1.8;}
* {box-sizing:border-box;}body {margin:0;padding:32px 36px;background:white;}
header {padding-bottom:16px;margin-bottom:24px;border-bottom:1px solid #d9e2dc;}
header h1 {font-size:26px;line-height:1.3;margin:0;}h1,h2,h3,h4,h5,h6 {line-height:1.5;break-after:avoid;}
p,ul,ol,pre,table,blockquote {margin:0 0 14px;}a {color:#2f7d68;}
pre {white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;background:#f5f8f6;border:1px solid #dfe9e4;border-radius:6px;}
code {font-family:"SFMono-Regular",Consolas,monospace;font-size:.9em;}pre code {white-space:inherit;}
table {border-collapse:collapse;font-size:.92em;max-width:100%;}th,td {padding:7px 10px;border:1px solid #dfe9e4;overflow-wrap:anywhere;}th {background:#f3f8f5;}
img {max-width:100%;height:auto;}blockquote {padding:10px 14px;border-left:3px solid #6a947c;background:#f5f8f6;}
.kn-callout-title {display:block;}.kn-embed {border:1px solid #dfe9e4;padding:12px;margin-bottom:14px;}
.kn-embed-body {max-height:none;overflow:visible;}.kn-frontmatter {margin-bottom:16px;}.kn-image-missing {color:#9c3830;}
.kn-mermaid {max-width:100%;overflow:auto;margin:16px 0;}.kn-mermaid>svg {display:block;width:var(--kn-diagram-width,auto);height:auto;max-width:none;}
.katex-display {overflow-x:auto;overflow-y:hidden;padding:4px 0;}.katex {line-height:1.2;}
.kn-mermaid,.katex-display,img {break-inside:avoid;}.kn-static-checkbox {white-space:pre;}
.hljs-keyword {color:#79509b;}.hljs-string {color:#467250;}.hljs-number {color:#995d20;}.hljs-comment {color:#647369;}
@page {size:A4;margin:14mm;}@media print {body {padding:0;}.kn-mermaid,.katex-display {overflow:visible;}}
</style></head><body><header><h1>${escape(taskTitle)}</h1></header><main>${String(bodyHtml || '')}</main></body></html>`;
}

// Executed in the script-free hidden document. Readiness is part of successful
// export, rather than assuming loadURL implies fonts/images/layout are ready.
async function readyNoteDocument({ timeoutMs = 12000, print = true } = {}) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('导出资源加载超时，请重试。')), timeoutMs); });
  try {await Promise.race([(async () => {
    if (document.querySelector('.katex')) {
      try { await document.fonts.load('16px KaTeX_Main'); } catch { throw new Error('公式字体加载失败，请重试。'); }
    }
    await document.fonts.ready;
    const failed = [...document.fonts].filter(f => f.status === 'error');
    if (failed.length) throw new Error('公式字体加载失败，请重试。');
    if (document.querySelector('.katex') && !document.fonts.check('16px KaTeX_Main')) throw new Error('公式字体不可用，请重新构建应用。');
    for (const img of document.images) {
      try { await img.decode(); } catch { throw new Error('图片加载失败，请重试。'); }
      if (!img.naturalWidth) throw new Error('图片加载失败，请重试。');
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!print) return;
    // A4 content box after 14mm margins, in Chromium's CSS pixels.
    const width = (210 - 28) * 96 / 25.4, height = (297 - 28) * 96 / 25.4;
    document.body.style.width = width + 'px';
    for (const el of document.querySelectorAll('.kn-mermaid>svg')) {
      const box = el.viewBox.baseVal;
      const scale = Math.min(1, width / box.width, height / box.height);
      if (scale < .65) throw new Error('图表超过单页可读尺寸，请拆分图表或导出 HTML 查看完整内容。');
      el.style.width = box.width * scale + 'px';
    }
    for (const el of document.querySelectorAll('table,.katex-display')) {
      if (el.scrollWidth > width + 2) throw new Error('公式或表格超出页面宽度，请调整内容或导出 HTML。');
    }
    for (const el of document.querySelectorAll('.katex-display,img')) {
      if (el.getBoundingClientRect().height > height) throw new Error('图片或公式超过单页高度，请调整内容或导出 HTML。');
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })(), timeout]);} finally {clearTimeout(timer);}
  return { fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family), images: document.images.length, diagrams: document.querySelectorAll('.kn-mermaid>svg').length };
}

module.exports = { noteDocumentHtml, readyNoteDocument };

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { noteDocumentHtml, readyNoteDocument } = require('../app/main/knowledge-export.cjs');

test('offline note template embeds only bundled fonts and escapes the title', async () => {
  const html = await noteDocumentHtml({ taskTitle: '<script>标题</script>', bodyHtml: '<p>正文</p>' });
  assert.match(html, /&lt;script&gt;标题&lt;\/script&gt;/);
  assert.match(html, /font-src data:/);
  assert.match(html, /img-src data:/);
  assert.match(html, /script-src 'none'/);
  const urls = [...html.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]);
  assert.ok(urls.length >= 20);
  assert.ok(urls.every(url => url.startsWith('data:font/woff2;base64,')));
  assert.ok(!html.includes('<script>'));
});

function ready(document, options = {}) {
  return vm.runInNewContext(`(${readyNoteDocument.toString()})(${JSON.stringify(options)})`, { document, setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn, 0) });
}
function documentWith(overrides = {}) {
  const fonts = Object.assign([{ family: 'KaTeX_Main', status: 'loaded' }], { ready: Promise.resolve(), load: async () => [], check: () => true });
  return { fonts, images: [], body: { style: {} }, querySelector: () => null, querySelectorAll: () => [], ...overrides };
}
test('readiness waits for fonts and each image before returning loaded resources', async () => {
  let decoded = false;
  const result = await ready(documentWith({ images: [{ naturalWidth: 20, decode: async () => { await new Promise(r => setTimeout(r, 10)); decoded = true; } }] }));
  assert.equal(decoded, true);
  assert.equal(result.images, 1);
  assert.equal(result.fonts[0], 'KaTeX_Main');
});
test('readiness rejects failed fonts, images, and hung resources', async () => {
  const fonts = Object.assign([{ family: 'KaTeX_Main', status: 'error' }], { ready: Promise.resolve(), check: () => false });
  await assert.rejects(ready(documentWith({ fonts })), /字体加载失败/);
  await assert.rejects(ready(documentWith({ images: [{ decode: async () => { throw Error('invalid image'); } }] })), /图片加载失败/);
  await assert.rejects(ready(documentWith({ fonts: { ready: new Promise(() => {}) } }), { timeoutMs: 5 }), /超时/);
});
test('print readiness rejects diagrams that cannot fit a readable page and overwide tables', async () => {
  const graph = { viewBox: { baseVal: { width: 3000, height: 100 } }, style: {} };
  await assert.rejects(ready(documentWith({ querySelectorAll: selector => selector === '.kn-mermaid>svg' ? [graph] : [] })), /单页可读尺寸/);
  await assert.rejects(ready(documentWith({ querySelectorAll: selector => selector === 'table,.katex-display' ? [{ scrollWidth: 2000 }] : [] })), /页面宽度/);
});

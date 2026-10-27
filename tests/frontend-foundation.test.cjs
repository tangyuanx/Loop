const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const renderer = path.join(root, 'app', 'renderer');
const read = (file) => fs.readFileSync(path.join(renderer, file), 'utf8');

test('stage1 foundation is the last shared stylesheet in every renderer entry', () => {
  for (const file of ['index.html', 'today-widget.html', 'widget-surface.html']) {
    const html = read(file);
    const links = [...html.matchAll(/<link[^>]+href="\.\/src\/([^"?]+)/g)].map((match) => match[1]);
    assert.equal(links.at(-1), 'foundation.css', `${file} must finish with foundation.css`);
    assert.match(html, /data-foundation-enabled/);
  }
});

test('stage1 foundation covers the shared input categories and neutral feedback contract', () => {
  const css = read('src/foundation.css');
  for (const marker of [
    '--input-line', '--input-hover', '--input-focus', '--focus-line', '--input-selection',
    '.list-search', '.widget-capture', '.brief21-input', '.manage24-title-input',
    '.record-editor', '#knowledge-source', '.kn-table-cell-editor', '.ProseMirror',
    '.cm-content', '.context-menu', '.control22-listbox', 'prefers-reduced-motion',
  ]) assert.ok(css.includes(marker), `foundation.css must own ${marker}`);
  assert.match(css, /\.list-search:focus-within[\s\S]*box-shadow: inset 0 -1px 0 var\(--focus-line\)/);
  assert.doesNotMatch(css, /:focus(?:-within|-visible)?[^{}]*\{[^}]*var\(--green\)/);
  assert.doesNotMatch(css, /!important/);
});

test('frozen feature sheets remain byte-identical while the bridge/foundation own the migration', () => {
  const pairs = [
    ['shell.css', 'prototypes/baseline/loop-plane-phase17-frozen/loop-plane-phase1.html', 'inline'],
    ['knowledge.css', 'prototypes/baseline/loop-plane-phase17-frozen/loop-knowledge-phase8.css'],
    ['brief21.css', 'prototypes/baseline/loop-plane-phase21-frozen/loop-brief-phase21.css'],
    ['controls22.css', 'prototypes/baseline/loop-plane-phase22-frozen/loop-controls-phase22.css'],
    ['widget12.css', 'prototypes/baseline/loop-plane-phase17-frozen/loop-widget-phase12-refinement.css'],
    ['widget13.css', 'prototypes/baseline/loop-plane-phase17-frozen/loop-widget-phase13.css'],
  ];
  for (const [target, source, kind] of pairs) {
    const actual = read(`src/${target}`);
    const raw = fs.readFileSync(path.join(root, source), 'utf8');
    const expected = kind === 'inline' ? raw.match(/<style>([\s\S]*?)<\/style>/)[1] : raw;
    assert.equal(actual, expected, `${target} remains a frozen source of truth`);
  }
});

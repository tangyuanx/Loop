const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function renderer(options = {}) {
  const handlers = new Map(), mediaHandlers = new Map(), frames = [], elements = new Map(), focus = [];
  let requested = { task: 'A', pane: 'flow', node: '' };
  const makeViewport = (top = 0, height = 1000) => ({ scrollTop: top, scrollLeft: 0, scrollHeight: height, clientHeight: 200, scrollWidth: 500, clientWidth: 400 });
  function baseRender() {
    elements.clear();
    elements.set('.workspace', { dataset: { taskId: requested.task } });
    elements.set('.pane-tab.active', { dataset: { pane: requested.pane } });
    if (requested.node) elements.set(options.inline ? '.node-inline-record' : '.inspector', { dataset: { nodeId: requested.node } });
    if (requested.pane === 'flow') elements.set('.flow-scroll', makeViewport(0, requested.height));
    if (requested.node) elements.set(options.inline ? '[data-shell-node-record]' : '.inspector-body', makeViewport());
    if (requested.pane === 'notes') { elements.set('.knowledge-body', makeViewport()); elements.set('#knowledge-source', makeViewport()); }
    if (requested.pane === 'history') elements.set('.article-pane', makeViewport());
    elements.set('.node-title[data-node-id="n1"]', { focus: options => focus.push(options) });
  }
  const media = { matches: false, addEventListener: (k, fn) => mediaHandlers.set(k, fn) };
  const storage = new Map();
  const win = { addEventListener: (k, fn) => handlers.set(k, fn) };
  const context = vm.createContext({ window: win, document: { querySelector: key => elements.get(key) || null,
    querySelectorAll: key => options.queryAll?.(key) || (key === '.node-title[data-node-id="n1"]' ? [elements.get(key)] : []) },
    render: baseRender, matchMedia: () => media, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, performance: { now: () => 10 }, CSS: { escape: value => value },
    shellSettingsRow: (_label, _desc, control) => control, shellSettingsToggle: (_label, _desc, _checked, attrs) => attrs });
  baseRender(); vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/renderer/src/continuity28.js'), 'utf8'), context);
  const flush = () => { let count = 0; while (frames.length && count++ < 100) frames.shift()(); };
  return { elements, focus, context, storage, media, handlers, flush, frame: () => frames.shift()?.(),
    go(task, pane, node = '', height = 1000) { requested = { task, pane, node, height }; context.render(); },
    get: selector => elements.get(selector) };
}
test('flow, notes/source and history keep separate per-task reading positions', () => {
  const r = renderer(); r.get('.flow-scroll').scrollTop = 320;
  r.go('A', 'notes'); r.flush(); assert.equal(r.get('.knowledge-body').scrollTop, 0);
  r.get('.knowledge-body').scrollTop = 210; r.get('#knowledge-source').scrollTop = 170;
  r.go('A', 'history'); r.flush(); r.get('.article-pane').scrollTop = 330;
  r.go('A', 'flow'); r.flush(); assert.equal(r.get('.flow-scroll').scrollTop, 320);
  r.go('A', 'notes'); r.flush(); assert.equal(r.get('.knowledge-body').scrollTop, 210); assert.equal(r.get('#knowledge-source').scrollTop, 170);
  r.go('A', 'history'); r.flush(); assert.equal(r.get('.article-pane').scrollTop, 330);
  r.go('B', 'history'); r.flush(); assert.equal(r.get('.article-pane').scrollTop, 0);
  r.go('A', 'history'); r.flush(); assert.equal(r.get('.article-pane').scrollTop, 330);
});
test('node selection shares the task flow position while records keep independent positions', () => {
  const r = renderer(); r.get('.flow-scroll').scrollTop = 300;
  r.go('A', 'flow', 'n1');
  assert.equal(r.get('.flow-scroll').scrollTop, 300, 'opening a node preserves the visible flow immediately');
  r.flush(); assert.equal(r.get('.flow-scroll').scrollTop, 300);
  r.get('.flow-scroll').scrollTop = 140; r.get('.inspector-body').scrollTop = 270;
  r.go('A', 'flow', 'n2'); r.flush();
  assert.equal(r.get('.flow-scroll').scrollTop, 140, 'switching nodes preserves the flow');
  assert.equal(r.get('.inspector-body').scrollTop, 0, 'new records start at the top');
  r.get('.inspector-body').scrollTop = 110;
  r.go('A', 'flow', 'n1'); r.flush();
  assert.equal(r.get('.flow-scroll').scrollTop, 140);
  assert.equal(r.get('.inspector-body').scrollTop, 270, 'record positions remain per-node');
  r.handlers.get('pointerdown')({ isTrusted: true, button: 0, target: { closest: () => ({ dataset: { action: 'close-node-detail' } }) } });
  r.go('A', 'flow'); r.flush(); assert.equal(r.get('.flow-scroll').scrollTop, 140); assert.equal(r.focus.at(-1).preventScroll, true);
  r.go('A', 'flow', 'n1'); r.flush(); assert.equal(r.get('.flow-scroll').scrollTop, 140); assert.equal(r.get('.inspector-body').scrollTop, 270);
  r.go('A', 'flow', 'n2'); r.flush(); assert.equal(r.get('.inspector-body').scrollTop, 110);
  r.go('B', 'flow', 'n2'); r.flush(); assert.equal(r.get('.flow-scroll').scrollTop, 0);
  r.go('A', 'flow', 'n2'); r.flush(); assert.equal(r.get('.flow-scroll').scrollTop, 140);
});
test('stale render callbacks cannot restore another task; offsets clamp to actual boundaries', () => {
  const r = renderer(); r.get('.flow-scroll').scrollTop = 700;
  r.go('A', 'notes'); r.go('B', 'flow'); r.flush(); assert.equal(r.get('.flow-scroll').scrollTop, 0);
  r.go('A', 'flow', '', 450); r.flush(); assert.equal(r.get('.flow-scroll').scrollTop, 250);
});
test('original mode and follow preferences persist independently of task data', () => {
  const r = renderer();
  r.handlers.get('click')({ target: { closest: () => ({ dataset: { continuity28: 'original' } }) }, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(r.context.window.LoopContinuity28.preferences().continuous, false);
  assert.equal(JSON.parse(r.storage.get('loop.interaction28')).continuous, false);
  r.media.matches = true;
  assert.equal(r.context.window.LoopContinuity28.preferences().reduced, true);
});

test('deferred viewport restoration yields immediately to new user input', () => {
  for (const event of ['wheel', 'keydown', 'pointerdown', 'beforeinput', 'touchmove']) {
    const r = renderer(); r.get('.flow-scroll').scrollTop = 320;
    r.go('A', 'notes');
    r.get('.knowledge-body').scrollTop = 90;
    r.handlers.get(event)?.({ key: 'ArrowDown', button: 0, target: { closest: () => null } });
    r.flush();
    assert.equal(r.get('.knowledge-body').scrollTop, 90, `${event} must invalidate scheduled restoration`);
  }
});

test('input between the two layout frames does not get undone by the second restoration', () => {
  const r = renderer(); r.go('A', 'notes'); r.frame();
  r.get('.knowledge-body').scrollTop = 180;
  r.handlers.get('wheel')?.({}); r.flush();
  assert.equal(r.get('.knowledge-body').scrollTop, 180);
});

test('navigation toggle keeps its own operation identity across Windows brand reparenting', () => {
  let inBrand = true;
  const button = { dataset: {}, matches: selector => selector === '.nav-toggle',
    closest: () => inBrand ? {dataset:{pointerGroup:'brand'}} : null };
  const r = renderer({ queryAll: selector => selector === 'button,summary,[role="button"],[role="switch"]' ? [button] : [] });
  const original = button.dataset.pointerGroup;
  assert.ok(original, 'the toggle is individually identified even inside the brand');
  assert.notEqual(original, 'brand');
  inBrand = false; r.go('A', 'flow'); r.flush();
  assert.equal(button.dataset.pointerGroup, original);
  inBrand = true; r.go('A', 'flow'); r.flush();
  assert.equal(button.dataset.pointerGroup, original);
});

test('inline node records preserve independent editor scroll positions without an inspector', () => {
  const r = renderer({ inline: true });
  r.go('A', 'flow', 'n1'); r.flush();
  r.get('[data-shell-node-record]').scrollTop = 180;
  r.go('A', 'flow', 'n2'); r.flush();
  assert.equal(r.get('[data-shell-node-record]').scrollTop, 0);
  r.get('[data-shell-node-record]').scrollTop = 60;
  r.go('A', 'flow', 'n1'); r.flush();
  assert.equal(r.get('[data-shell-node-record]').scrollTop, 180);
  r.go('A', 'flow', 'n2'); r.flush();
  assert.equal(r.get('[data-shell-node-record]').scrollTop, 60);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Only the DOM operations used by window25: the render model independently
// replaces/reuses navigation and topbar just like the production region cache.
class Node {
  constructor(className = '', attrs = {}) {
    this.className = className; this.attrs = new Map(Object.entries(attrs));
    this.children = []; this.parentElement = null; this.dataset = {};
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
    this.classList = { contains: value => this.className.split(/\s+/).includes(value) };
  }
  get isConnected() { return this.root || Boolean(this.parentElement?.isConnected); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
  setAttribute(key, value) { this.attrs.set(key, value); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  hasAttribute(key) { return this.attrs.has(key); }
  toggleAttribute(key, on) { if (on) this.attrs.set(key, ''); else this.attrs.delete(key); }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const match = selector.match(/^\[([^=]+)(?:="([^"]*)")?\]$/);
    return Boolean(match && this.hasAttribute(match[1]) && (match[2] === undefined || this.getAttribute(match[1]) === match[2]));
  }
  querySelectorAll(selector) {
    const found = [];
    for (const child of this.children) { if (child.matches(selector)) found.push(child); found.push(...child.querySelectorAll(selector)); }
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  contains(other) { return this === other || this.children.some(child => child.contains(other)); }
  remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  insertBefore(node, before) { node.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, node); node.parentElement = this; }
  append(node) { this.insertBefore(node, null); }
  prepend(node) { this.insertBefore(node, this.firstElementChild); }
  after(node) { this.parentElement.insertBefore(node, this.nextSibling); }
  focus() { let root = this; while (root.parentElement) root = root.parentElement; if (root.document) root.document.activeElement = this; }
}
function header(platform = 'darwin', delayedState = false) {
  const body = new Node('', { 'data-window25-enabled': '' }); body.root = true;
  const document = { body, activeElement: body, querySelector: selector => body.querySelector(selector), createElement: () => new Node() };
  body.document = document;
  const app = new Node('app'); body.append(app);
  const handlers = new Map();
  const overlay = { visible: true, rect: { x: 0, width: 1142 }, addEventListener: (event, callback) => handlers.set(event, callback), getTitlebarAreaRect() { return this.rect; } };
  let nav, bar, collapsed = false, replaceNav = true, replaceBar = true, focusEditor = false, onState, resolveInitial;
  const createNav = () => {
    const next = new Node('navigation'), brand = new Node('brand');
    brand.append(new Node('brand-mark')); brand.append(new Node('brand-name'));
    brand.append(new Node('icon-button nav-toggle', { 'data-action': 'toggle-nav' }));
    const slot = new Node('brand-update-slot', { 'data-brand-update-slot': '' });
    slot.append(new Node('brand-update', { 'data-action': 'open-update-panel' }));
    const footer = new Node('nav-bottom'); footer.append(slot);
    next.append(brand); next.append(footer); return next;
  };
  const createBar = () => { const next = new Node('topbar'); next.append(new Node('breadcrumb')); return next; };
  const controls = {
    getState: () => delayedState ? new Promise(resolve => { resolveInitial = resolve; }) : Promise.resolve({ focused: true }),
    onState: callback => { onState = callback; },
    setChromeColors: async () => ({ success: true }),
  };
  const context = vm.createContext({ document,
    window: { innerWidth: 1280, personalTaskTrack: { platform, windowControls: controls }, addEventListener: (event, callback) => handlers.set(event, callback) },
    navigator: { windowControlsOverlay: overlay }, getComputedStyle: () => ({ backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(32, 36, 43)' }),
    render() {
      if (replaceNav) nav = createNav(); if (replaceBar) bar = createBar();
      for (const child of [...app.children]) child.remove();
      app.className = collapsed ? 'app nav-collapsed' : 'app';
      app.append(nav); app.append(bar);
      document.activeElement = body;
      if (focusEditor) { const editor = new Node('editor'); app.append(editor); editor.focus(); }
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/renderer/src/window25.js'), 'utf8'), context);
  return { body, app, document, overlay, handlers, state: value => onState(value), initial: value => resolveInitial(value),
    render(options = {}) { replaceNav = options.nav === true; replaceBar = options.bar === true; focusEditor = options.focusEditor === true; if ('collapsed' in options) collapsed = options.collapsed; context.render(); },
    get: selector => body.querySelector(selector), all: selector => body.querySelectorAll(selector),
  };
}
function assertIdentity(h, platform, collapsed = false) {
  for (const selector of ['.brand', '.nav-toggle', '[data-brand-update-slot]', '.brand-update']) assert.equal(h.all(selector).length, 1, `${selector} exists exactly once`);
  const brand = h.get('.brand'), bar = h.get('.topbar'), toggle = h.get('.nav-toggle'), slot = h.get('[data-brand-update-slot]');
  assert.equal(brand.parentElement, bar);
  assert.equal(toggle.parentElement, brand, 'navigation toggle stays at the right of the brand');
  assert.equal(slot.parentElement, h.get('.nav-bottom'), 'update stays next to settings in the footer');
}
test('title identity survives independently replaced navigation and topbar regions on both platforms', async () => {
  for (const platform of ['darwin', 'win32']) {
    const h = header(platform); await Promise.resolve(); assertIdentity(h, platform);
    h.render({ nav: true }); assertIdentity(h, platform);
    h.render({ bar: true }); assertIdentity(h, platform);
    h.render(); assertIdentity(h, platform);
    h.render({ nav: true, bar: true }); assertIdentity(h, platform);
  }
});
test('Windows collapse and expand keep a single update slot and derive caption space from native geometry', async () => {
  const h = header('win32'); await Promise.resolve();
  for (let i = 0; i < 3; i++) {
    h.render({ nav: true, collapsed: true }); assertIdentity(h, 'win32', true);
    h.render({ nav: true, collapsed: false }); assertIdentity(h, 'win32', false);
  }
  assert.equal(h.get('.topbar').style['--window25-native-caption-width'], '138px');
  h.overlay.rect = { x: 0, width: 1180 }; h.handlers.get('geometrychange')();
  assert.equal(h.get('.topbar').style['--window25-native-caption-width'], '100px');
  h.overlay.visible = false; h.handlers.get('resize')();
  assert.equal(h.get('.topbar').style['--window25-native-caption-width'], '0px');
});
test('a late initial window-state reply cannot overwrite a newer native event', async () => {
  const h = header('darwin', true);
  h.state({ focused: false, maximized: true, fullScreen: true });
  h.initial({ focused: true, maximized: false, fullScreen: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.body.hasAttribute('data-window25-inactive'), true);
  assert.equal(h.body.hasAttribute('data-window25-maximized'), true);
  assert.equal(h.body.hasAttribute('data-window25-fullscreen'), true);
});

test('header refresh restores the same control focus without scrolling', async () => {
  const h = header('win32'); await Promise.resolve();
  h.get('.nav-toggle').focus();
  h.render({ nav: true, collapsed: true });
  assert.equal(h.document.activeElement, h.get('.nav-toggle'));
  h.get('.brand-update').focus();
  h.render({ bar: true });
  assert.equal(h.document.activeElement, h.get('.brand-update'));
  h.render({ nav: true, focusEditor: true });
  assert.equal(h.document.activeElement, h.get('.editor'), 'explicit editor focus wins over header restoration');
});

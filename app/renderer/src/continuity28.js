// Phase28 production integration. The incumbent render/editor/file lifecycle
// remains the owner; this layer restores context and coordinates group FLIP.
(() => {
  const bridge = window.loopPointerContinuity;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const storageKey = 'loop.interaction28';
  let preferences = { continuous: true, follow: true }, available = false, epoch = 0, viewportEpoch = 0, intent = null;
  try { const saved = JSON.parse(localStorage.getItem(storageKey)); if (saved) preferences = { continuous: saved.continuous !== false, follow: saved.follow !== false }; } catch {}
  const memory = new Map(), animations = new Set();
  const selectors = ['.flow-scroll', '.inspector-body', '[data-shell-node-record]', '.knowledge-body', '#knowledge-source', '.knowledge-pane .cm-scroller', '.article-pane'];
  const rect = el => el?.getClientRects().length ? el.getBoundingClientRect() : null;
  const one = selector => { try { const matches = document.querySelectorAll(selector); return matches.length === 1 ? matches[0] : null; } catch { return null; } };
  function context() {
    return { task: document.querySelector('.workspace')?.dataset.taskId || '', node: document.querySelector('.inspector')?.dataset.nodeId || '', pane: document.querySelector('.pane-tab.active')?.dataset.pane || '' };
  }
  function key(c, selector) {
    // The flow belongs to the task, regardless of the selected node. Only
    // the record viewport needs a separate reading position for each node.
    return JSON.stringify([c.task, selector, ['.inspector-body', '[data-shell-node-record]'].includes(selector) ? c.node : '']);
  }
  function remember(c) {
    if (!c.task) return;
    for (const selector of selectors) {
      const el = document.querySelector(selector); if (!el) continue;
      const k = key(c, selector); memory.delete(k); memory.set(k, { top: el.scrollTop, left: el.scrollLeft });
    }
    while (memory.size > 180) memory.delete(memory.keys().next().value);
  }
  function restore(c) {
    if (!c.task) return;
    for (const selector of selectors) {
      const el = document.querySelector(selector), saved = memory.get(key(c, selector)); if (!el) continue;
      el.scrollTop = Math.min(saved?.top || 0, Math.max(0, el.scrollHeight - el.clientHeight));
      el.scrollLeft = Math.min(saved?.left || 0, Math.max(0, el.scrollWidth - el.clientWidth));
    }
  }
  function cancelMotion() { epoch++; for (const a of animations) a.cancel(); animations.clear(); if (typeof shellCancelBranchMotion === 'function') shellCancelBranchMotion(); }
  function enabled() { return available && preferences.follow && preferences.continuous && !reduced.matches; }
  function applyPreferences() { bridge?.setEnabled(enabled()); }
  function setPreference(key, value) {
    preferences[key] = value === true;
    globalThis.LoopUiPreferences?.update({ [key]: value === true });
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch {}
    cancelMotion(); applyPreferences();
  }
  const groupSelectors = ['[data-pointer-group]', '[role="group"]', '[role="toolbar"]', '.tabs-bar', '.task-heading-actions',
    '.flow-row', '.flow-tools', '.nav-bottom', '.nav-groups', '.knowledge-toolbar', '.knowledge-format-toolbar',
    '.knowledge-file-actions', '.toolbar-right', '.brand', '.inspector-head', '.inspector-foot', '.setting-row', '.task-row'];
  function decorate() {
    // Object identities are structural IDs, never text, list indexes or mutable
    // state attributes. No geometry/style is changed by these annotations.
    const groups = document.querySelectorAll(groupSelectors.join(','));
    for (const el of groups) {
      if (el.hasAttribute('data-pointer-group')) continue;
      const workspace = el.closest('.workspace'), flow = el.closest('[data-flow-id]'), inspector = el.closest('.inspector');
      const row = el.closest('[data-task-id]:not(.workspace),[data-group-id]');
      const task = workspace?.dataset.taskId || row?.dataset.taskId || '';
      const node = flow?.dataset.flowId || inspector?.dataset.nodeId || '';
      const group = row?.dataset.groupId || '';
      const region = workspace ? 'workspace' : el.closest('.navigation') ? 'navigation' : el.closest('.task-list-pane') ? 'task-list' : el.closest('.topbar') ? 'topbar' : el.closest('#overlay') ? 'overlay' : 'global';
      const semantic = groupSelectors.find(selector => selector !== '[data-pointer-group]' && el.matches(selector));
      const discriminator = el.getAttribute('aria-label') || el.id || (el.matches('.setting-row') ? el.querySelector('[data-action],[data-key],[data-continuity28]')?.getAttribute('data-key') || el.querySelector('[data-action]')?.dataset.action || el.querySelector('[data-continuity28]')?.dataset.continuity28 : '');
      el.dataset.pointerGroup = JSON.stringify([region, task, node, group, semantic, discriminator || '']);
    }
    // Dynamically mounted toolbars and menus acquire identities before capture.
    // Isolated semantic buttons are their own groups, scoped to their object.
    document.querySelectorAll('button,summary,[role="button"],[role="switch"]').forEach(el => {
      // Windows moves this control out of the brand when collapsing the rail.
      // Its operation identity must survive that reparenting on both platforms.
      if (el.matches('.nav-toggle')) {
        el.dataset.pointerGroup = JSON.stringify(['topbar', 'navigation-toggle']);
        return;
      }
      if (el.closest('[data-pointer-group]')) return;
      const workspace = el.closest('.workspace');
      const attrs = ['id', 'data-action', 'data-pane', 'data-task-id', 'data-node-id', 'data-group-id', 'data-key', 'data-value', 'data-note23', 'data-manage24', 'data-recovery26', 'data-brief21-toggle'];
      const values = attrs.filter(name => el.hasAttribute(name)).map(name => [name, el.getAttribute(name)]);
      if (values.length) el.dataset.pointerGroup = JSON.stringify(['button', workspace?.dataset.taskId || '', el.closest('.inspector')?.dataset.nodeId || '', values]);
    });
  }
  function animate(el, frames, held, options = {}) {
    if (!el || reduced.matches || !preferences.continuous) return null;
    const a = el.animate(frames, { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)', ...options }); animations.add(a);
    if (held) { a.pause(); a.currentTime = 0; }
    a.finished.then(() => animations.delete(a)).catch(() => animations.delete(a));
    return a;
  }
  const priorRender = render;
  render = function continuity28Render() {
    const viewportRevision = ++viewportEpoch;
    const click = bridge?.currentClick(), old = context();
    if (!click) bridge?.cancel(); // Background/later redraws cannot reuse a press.
    const oldTabsElement = document.querySelector('.tabs-bar');
    const oldContentElement = document.querySelector('.tab-content');
    const oldBriefElement = document.querySelector('.workspace > .brief');
    const oldGroup = click && one(click.selector);
    const oldTabs = rect(oldTabsElement), oldContent = rect(document.querySelector('.tab-content'));
    const interaction = intent && performance.now() - intent.time < 500 ? intent : null;
    const anchorSelector = interaction?.action === 'toggle-node-collapse' && interaction.node ? `.collapse[data-node-id="${CSS.escape(interaction.node)}"]` : null;
    const anchor = anchorSelector && rect(one(anchorSelector));
    const branches = typeof shellCaptureBranches === 'function' ? shellCaptureBranches(preferences.continuous && !reduced.matches) : null;
    remember(old);
    if (!click?.claimed) { epoch++; for (const a of animations) a.cancel(); animations.clear(); }
    priorRender(); // Preserve all caches, drafts, recovery, save and file bindings.
    if (branches) shellAnimateBranches(branches, preferences.continuous && !reduced.matches);
    decorate();
    const next = context(), renderEpoch = epoch;
    let scrollAdjustment = 0;
    restore(next);
    const sameTask = old.task && old.task === next.task;
    if (sameTask && anchor) {
      const button = one(anchorSelector), scroll = document.querySelector('.flow-scroll');
      if (button && scroll) { const before = scroll.scrollTop; scroll.scrollTop += button.getBoundingClientRect().top - anchor.top; scrollAdjustment = scroll.scrollTop - before; }
    }
    if (sameTask && old.node && !next.node && next.pane === 'flow' && ['close-node-detail', 'escape'].includes(interaction?.action)) {
      one(`.node-title[data-node-id="${CSS.escape(old.node)}"]`)?.focus({ preventScroll: true });
    }
    const restoreLater = () => {
      if (viewportEpoch !== viewportRevision || epoch !== renderEpoch || JSON.stringify(context()) !== JSON.stringify(next)) return;
      restore(next);
      const scroll = document.querySelector('.flow-scroll'); if (scroll && scrollAdjustment) scroll.scrollTop += scrollAdjustment;
    };
    requestAnimationFrame(() => { restoreLater(); decorate(); requestAnimationFrame(restoreLater); });
    if (!preferences.continuous || reduced.matches) { intent = null; return; }
    if (click?.claimed) {
      // A status/draft refresh during this same transition is not a new press.
      // The retained operation keeps its animation and preload sampler. Object
      // replacement or a changed context still ends the original transaction.
      const group = one(click.selector);
      if (sameTask && old.pane === next.pane && old.node === next.node && group === oldGroup && group?.isConnected && oldTabsElement === document.querySelector('.tabs-bar')) {
        // The note chrome can change without changing the tabs. Carry the
        // content's existing animation phase to its replacement; otherwise it
        // jumps underneath the tabs and the preload hit test correctly stops.
        for (const a of [...animations]) {
          const target = a.effect?.target;
          if (target?.isConnected) continue;
          const replacement = target === oldContentElement ? document.querySelector('.tab-content')
            : target === oldBriefElement ? document.querySelector('.workspace > .brief') : null;
          if (replacement) {
            const carried = animate(replacement, a.effect.getKeyframes(), a.playState === 'paused', a.effect.getTiming());
            if (carried) { carried.currentTime = a.currentTime; if (a.playState === 'running') carried.startTime = a.startTime; }
          }
          a.cancel(); animations.delete(a);
        }
        intent = null; return;
      }
      cancelMotion(); bridge?.cancel(); intent = null; return;
    }
    const tabs = document.querySelector('.tabs-bar'), content = document.querySelector('.tab-content');
    const nextTabs = rect(tabs), nextContent = rect(content);
    let operation = null, target = null;
    if (click && enabled() && sameTask && Date.now() - click.time < 500) {
      const group = one(click.selector), button = one(click.buttonSelector), r = rect(group);
      const displacement = r ? Math.hypot(r.x - click.rect.x, r.y - click.rect.y) : 0;
      const modal = [...document.querySelectorAll('#overlay > *,[aria-modal="true"]')].some(el => el.getClientRects().length && !el.contains(button));
      if (group && button && group.contains(button) && !modal && displacement >= 12 && displacement <= 300) { operation = group; target = r; }
    }
    const moved = sameTask && oldTabs && nextTabs && Math.hypot(oldTabs.x - nextTabs.x, oldTabs.y - nextTabs.y) > 1;
    if (moved && (old.pane !== next.pane || click || interaction)) {
      animate(tabs, [{ transform: `translate(${oldTabs.x-nextTabs.x}px,${oldTabs.y-nextTabs.y}px)` }, { transform: 'translate(0,0)' }], !!operation);
      if (oldContent && nextContent) animate(content, [{ transform: `translate(${oldContent.x-nextContent.x}px,${oldContent.y-nextContent.y}px)` }, { transform: 'translate(0,0)' }], !!operation);
      const brief = document.querySelector('.workspace > .brief');
      if (brief && !brief.hidden) animate(brief, [{ opacity: 0 }, { opacity: 1 }], !!operation, { duration: 150, delay: 70 });
    }
    if (operation) {
      const carried = [...animations].some(a => a.effect?.target === operation || a.effect?.target?.contains(operation));
      if (!carried) animate(operation, [{ transform: `translate(${click.rect.x-target.x}px,${click.rect.y-target.y}px)` }, { transform: 'translate(0,0)' }], true);
      const play = () => { if (epoch === renderEpoch) animations.forEach(a => { if (a.playState === 'paused') a.play(); }); };
      bridge.follow({ key: click.key, rect: { x: target.x, y: target.y, width: target.width, height: target.height } }).then(play, play);
    }
    intent = null;
  };
  window.addEventListener('pointerdown', event => {
    viewportEpoch++;
    const button = event.target.closest?.('button');
    intent = event.button === 0 && button ? { action: button.dataset.action, node: button.dataset.nodeId, time: performance.now() } : null;
  }, true);
  window.addEventListener('keydown', event => { viewportEpoch++; intent = event.key === 'Escape' && !event.isComposing ? { action: 'escape', time: performance.now() } : null; }, true);
  // Layout stabilization belongs to this render only. A new scroll, caret edit
  // or scrollbar press must not be undone by either of its deferred frames.
  for (const name of ['wheel', 'beforeinput', 'compositionstart', 'touchmove']) window.addEventListener(name, () => { viewportEpoch++; }, true);
  window.addEventListener('click', event => {
    const control = event.target.closest?.('[data-continuity28]'); if (!control) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const value = control.dataset.continuity28;
    if (value === 'follow') setPreference('follow', !preferences.follow);
    else setPreference('continuous', value === 'continuous');
    render();
  }, true);
  for (const name of ['resize', 'blur']) window.addEventListener(name, () => { viewportEpoch++; intent = null; cancelMotion(); bridge?.cancel(); });
  reduced.addEventListener('change', () => { cancelMotion(); applyPreferences(); });
  window.LoopContinuity28 = {
    restorePreferences(value) {
      preferences = { continuous: value.continuous !== false, follow: value.follow !== false };
      cancelMotion(); applyPreferences();
    },
    settings() {
      return shellSettingsRow('切换方式', '在布局变化时保持操作位置的连续性。', `<div role="group" aria-label="切换方式"><button class="text-button" type="button" data-continuity28="continuous" aria-pressed="${preferences.continuous}">连续切换</button><button class="text-button" type="button" data-continuity28="original" aria-pressed="${!preferences.continuous}">原有切换</button></div>`) +
        shellSettingsToggle('操作组移动时跟随鼠标', available ? '仅跟随本次点击造成的位移，主动移动鼠标即可接管。' : '当前平台的原生鼠标接口不可用。', preferences.follow && available, `data-continuity28="follow" ${available ? '' : 'disabled'}`);
    },
    preferences: () => ({ ...preferences, available, reduced: reduced.matches }),
  };
  bridge?.status().then(status => { available = status.available === true; applyPreferences(); }).catch(() => { available = false; applyPreferences(); });
  decorate();
})();

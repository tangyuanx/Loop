// ------------------------------------------------------------
// Phase20 · 桌面规模与收纳
//
// Ported from the frozen Demo's loop-scale-phase20.js. The Demo runs this layer
// behind `?phase=20` and installs 120 synthetic tasks / 18 groups / a nine-level
// tree for review; the product keeps only the interface behaviour and reads the
// user's own data. The layer is gated by `body[data-scale20-enabled]`, which
// index.html sets, so the frozen scale.css applies.
//
// Covered here (Demo → product):
//   - list / nav / note scroll kept across renders (list only while the list
//     scope is unchanged, so switching filters still starts at the top)
//   - 定位当前 button, shown only while the selected row is out of view
//   - truncation surrogates with full-text titles (list title, breadcrumb,
//     list foot, group property)
//   - one horizontal scroll container per knowledge table (header and body stay
//     aligned) and the brief toggle that yields the workspace while reading
//   - menus clamped inside the viewport
// ------------------------------------------------------------

const SCALE20_LOCATE_ICON = "M12 3v3M12 18v3M3 12h3M18 12h3M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0";
let scale20LastScope = "";
let scale20LastRecord = "";

/** The list scope: changing any of these starts the list at the top again. */
function scale20ScopeSignature() {
  return JSON.stringify([
    state.taskFilter,
    state.todayFilter,
    state.activeGroupId,
    state.captureSourceFilter,
    state.priorityFilter,
    state.taskDeadlineFilter,
    state.taskDateFilter,
    state.query,
  ]);
}

function scale20LocateIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SCALE20_LOCATE_ICON}"></path></svg>`;
}

function scale20ListScroll() {
  return document.getElementById("task-results");
}

function scale20SelectedRow(list) {
  const row = list.querySelector(".task-item.selected");
  return row?.dataset.taskId === state.activeTaskId ? row : null;
}

/** 定位当前 is only offered while the selected row sits outside the viewport. */
function scale20UpdateLocate() {
  const list = scale20ListScroll();
  if (!list) return;
  const button = list.closest(".task-list-pane")?.querySelector(".scale20-locate");
  if (!button) return;
  const row = scale20SelectedRow(list);
  const rowRect = row?.getBoundingClientRect();
  const top = list.getBoundingClientRect().top + list.clientTop;
  button.hidden = !rowRect || !list.clientHeight ||
    (rowRect.top >= top - 1 && rowRect.bottom <= top + list.clientHeight + 1);
}

function scale20LocateCurrent({ keyboard }) {
  const list = scale20ListScroll();
  if (!list?.clientHeight) return;
  const row = scale20SelectedRow(list);
  if (!row) return;
  const listTop = list.getBoundingClientRect().top + list.clientTop;
  const rowRect = row.getBoundingClientRect();
  const top = list.scrollTop + rowRect.top - listTop + (rowRect.height - list.clientHeight) / 2;
  list.scrollTo({ top, behavior: "instant" });
  if (keyboard) row.querySelector(".task-select")?.focus({ preventScroll: true });
  scale20UpdateLocate();
}

/** Full text stays reachable through the title attribute after truncation. */
function scale20WrapTextNode(element, className) {
  if (!element) return;
  const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (!text) return;
  const label = document.createElement("span");
  label.className = className;
  label.textContent = text.textContent;
  element.replaceChild(label, text);
  // the Demo puts the full text on the truncating span itself
  label.title = label.textContent;
  element.title = label.textContent;
}

function scale20Decorate() {
  const heading = document.querySelector(".list-heading h2");
  if (heading && !heading.querySelector(".scale20-list-title")) scale20WrapTextNode(heading, "scale20-list-title");

  const crumb = document.querySelector(".breadcrumb>b");
  if (crumb) crumb.title = crumb.textContent;

  const footLabel = document.querySelector(".list-foot>span");
  if (footLabel) footLabel.title = footLabel.textContent;

  document.querySelectorAll(".task-properties .group-property").forEach((button) => {
    if (!button.querySelector(".scale20-group-name")) scale20WrapTextNode(button, "scale20-group-name");
  });

  const foot = document.querySelector(".list-foot:not(.bulk-dock)");
  if (foot && !foot.querySelector(".scale20-locate")) {
    foot.insertAdjacentHTML("afterbegin", `<button class="text-button scale20-locate" type="button" data-scale20="locate" title="定位当前任务" hidden>${scale20LocateIcon()}定位当前</button>`);
  }

  // One horizontal scroll container per table keeps the header and the body aligned.
  document.querySelectorAll(".knowledge-preview table").forEach((table) => {
    if (table.parentElement?.classList.contains("scale20-table-scroll")) return;
    const wrap = document.createElement("div");
    wrap.className = "scale20-table-scroll";
    table.before(wrap);
    wrap.append(table);
  });
}

/**
 * Opening a node record collapses the brief. A wide window gets a real toggle;
 * the narrow drawer shows a read-only note. Leaving the record restores the
 * brief — the Demo left it hidden in that case, which the phase spec forbids
 * ("恢复处理流后正确还原").
 */
function scale20SetupBrief() {
  // Phase21 replaces this step entirely (its own toggle and editing model).
  if (document.body.hasAttribute("data-brief21-enabled")) return;
  document.querySelector(".scale20-brief-toggle")?.remove();
  const brief = document.querySelector(".workspace>.brief");
  if (!brief) return;
  const nodeOpen = state.taskPane === "flow" && Boolean(state.selectedNodeId);
  if (!nodeOpen) {
    brief.hidden = false;
    return;
  }
  const drawer = Boolean(document.querySelector(".inspector.flow-drawer"));
  brief.hidden = drawer || state.scale20SummaryOpen !== true;
  brief.insertAdjacentHTML("beforebegin", drawer
    ? '<span class="scale20-brief-toggle">任务简报已收起</span>'
    : `<button class="scale20-brief-toggle" type="button" data-scale20="summary" aria-expanded="${state.scale20SummaryOpen === true}">${shellIcon("chevron")}任务简报</button>`);
}

/** Menus stay inside the viewport, including the last row of a long list. */
function scale20ClampMenus() {
  document.querySelectorAll('#overlay [role="menu"], #context-menu-root .context-menu, .context-menu, .popover[role="menu"]').forEach((menu) => {
    if (!menu.offsetWidth) return;
    // A menu may live in a positioned ancestor, so clamp by the rect it actually
    // occupies and shift it by the difference rather than by its own left/top.
    const rect = menu.getBoundingClientRect();
    const margin = 12;
    const bottomReserve = 50;
    let dx = 0;
    let dy = 0;
    if (rect.left < margin) dx = margin - rect.left;
    if (rect.right > window.innerWidth - margin) dx = Math.min(dx || Infinity, window.innerWidth - margin - rect.right);
    if (rect.top < margin) dy = margin - rect.top;
    if (rect.bottom > window.innerHeight - bottomReserve) dy = Math.min(dy || Infinity, window.innerHeight - bottomReserve - rect.bottom);
    if (!dx && !dy) return;
    const left = Number.parseFloat(menu.style.left);
    const top = Number.parseFloat(menu.style.top);
    menu.style.left = `${(Number.isFinite(left) ? left : 0) + dx}px`;
    menu.style.top = `${(Number.isFinite(top) ? top : 0) + dy}px`;
  });
}

function scale20AfterRender() {
  scale20Decorate();
  scale20SetupBrief();
  scale20ClampMenus();
  scale20UpdateLocate();
}

/**
 * The render wrapper mirrors the Demo: capture the three scroll positions, let
 * the project render, then restore them (the list only when the scope is the
 * same) and apply the phase20 decorations.
 */
const scale20PriorRender = render;
render = function scale20Render() {
  const list = scale20ListScroll();
  const nav = document.querySelector(".nav-groups");
  const note = document.querySelector(".knowledge-body");
  const listY = list ? list.scrollTop : 0;
  const navY = nav ? nav.scrollTop : 0;
  const noteY = note ? note.scrollTop : 0;
  const scope = scale20ScopeSignature();
  const record = state.activeTaskId;

  scale20PriorRender();

  const nextList = scale20ListScroll();
  const nextNav = document.querySelector(".nav-groups");
  const nextNote = document.querySelector(".knowledge-body");
  if (nextList) {
    if (scope === scale20LastScope) nextList.scrollTop = listY;
    nextList.addEventListener("scroll", scale20UpdateLocate, { passive: true });
  }
  if (nextNav) nextNav.scrollTop = navY;
  if (nextNote && record === scale20LastRecord) nextNote.scrollTop = noteY;

  scale20LastScope = scope;
  scale20LastRecord = record;
  scale20AfterRender();
};

// The context menu mounts through its own root without a render pass.
const scale20PriorSyncContextMenuRoot = syncContextMenuRoot;
syncContextMenuRoot = function scale20SyncContextMenuRoot() {
  scale20PriorSyncContextMenuRoot();
  scale20ClampMenus();
};

window.addEventListener("click", (event) => {
  const button = event.target.closest?.("button[data-scale20]");
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (button.dataset.scale20 === "locate") scale20LocateCurrent({ keyboard: event.detail === 0 });
  else if (button.dataset.scale20 === "summary") {
    state.scale20SummaryOpen = state.scale20SummaryOpen !== true;
    render();
    document.querySelector(".scale20-brief-toggle")?.focus({ preventScroll: true });
  }
}, true);

window.addEventListener("resize", () => {
  scale20UpdateLocate();
  scale20SetupBrief();
  scale20ClampMenus();
});

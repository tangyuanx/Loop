// ------------------------------------------------------------
// Phase22 · 输入与选择
//
// Ported from the frozen Demo's loop-controls-phase22.js. Native single selects
// keep their own element (name, value, options, validation, FormData) and gain a
// unified listbox for expansion; every other field shares one skin through the
// frozen controls22.css, gated by body[data-controls22-enabled].
//
// The Demo's page-specific caption/review hooks are scaffolding and stay out.
// Class names that differ between the Demo shell and this product are mapped in
// CONTROL22_INLINE (documented where they are used).
// ------------------------------------------------------------

const CONTROL22_INLINE = [".node-title-input", ".widget-title-input", ".task-title", ".page-title", ".flow-title-input"];
const CONTROL22_SKIP = [
  'input[type="hidden"]', 'input[type="checkbox"]', 'input[type="radio"]', 'input[type="range"]',
  'input[type="file"]', 'input[type="color"]', 'input[type="button"]', 'input[type="submit"]',
  'input[type="reset"]', 'input[type="image"]', ".brief21-input", "#knowledge-source", ".kn-find input",
].join(",");
const CONTROL22_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';

let control22Opened = null;
let control22ConsumeClick = false;
let control22Sequence = 0;
let control22Typed = "";
let control22TypedAt = 0;

function control22Supported(el) {
  return el instanceof HTMLSelectElement && !el.multiple && el.size <= 1 && !el.disabled;
}

function control22Enabled(option) {
  return !option.disabled && !option.closest("optgroup")?.disabled;
}

function control22Close() {
  if (!control22Opened) return;
  const { select, menu } = control22Opened;
  select.setAttribute("aria-expanded", "false");
  select.removeAttribute("aria-controls");
  select.removeAttribute("aria-activedescendant");
  menu.remove();
  control22Opened = null;
  control22Typed = "";
}

function control22Position() {
  if (!control22Opened) return;
  const { select, menu } = control22Opened;
  const rect = select.getBoundingClientRect();
  if (!select.isConnected || select.disabled || !rect.width || !rect.height) { control22Close(); return; }
  const width = Math.min(window.innerWidth - 24, Math.max(rect.width, 176));
  const below = window.innerHeight - rect.bottom - 12;
  const above = rect.top - 12;
  const up = below < Math.min(menu.scrollHeight, 180) && above > below;
  menu.style.width = `${width}px`;
  menu.style.maxHeight = `${Math.min(272, Math.max(64, up ? above - 6 : below - 6))}px`;
  menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  menu.style.top = `${up ? Math.max(12, rect.top - menu.offsetHeight - 6) : rect.bottom + 6}px`;
}

function control22Highlight(index) {
  if (!control22Opened) return;
  const { select, menu } = control22Opened;
  control22Opened.index = index;
  menu.querySelectorAll("[data-active]").forEach((el) => el.removeAttribute("data-active"));
  const item = menu.querySelector(`[data-index="${index}"]`);
  if (!item) return;
  item.setAttribute("data-active", "");
  select.setAttribute("aria-activedescendant", item.id);
  item.scrollIntoView({ block: "nearest" });
}

function control22Open(select) {
  control22Close();
  select.focus({ preventScroll: true });
  const menu = document.createElement("div");
  const id = `control22-menu-${++control22Sequence}`;
  menu.id = id;
  menu.className = "control22-listbox";
  menu.setAttribute("role", "listbox");
  const label = select.getAttribute("aria-label") || [...select.labels].map((el) => el.textContent.trim()).join(" ") || "选项";
  menu.setAttribute("aria-label", label);
  let group;
  [...select.options].forEach((option, index) => {
    const parent = option.closest("optgroup");
    if (parent && parent !== group) {
      const heading = document.createElement("div");
      heading.className = "control22-optgroup";
      heading.textContent = parent.label;
      menu.append(heading);
    }
    group = parent;
    const item = document.createElement("div");
    const text = document.createElement("span");
    item.className = "control22-option";
    item.id = `${id}-${index}`;
    item.dataset.index = index;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(option.selected));
    if (!control22Enabled(option)) item.setAttribute("aria-disabled", "true");
    text.textContent = option.label;
    item.append(text);
    if (option.selected) item.insertAdjacentHTML("beforeend", CONTROL22_CHECK);
    menu.append(item);
  });
  // Keep the list inside an enclosing modal's accessible subtree without
  // changing its viewport-based positioning or the native field path.
  (select.closest('[role="dialog"],.dialog,.surface-popover') || document.body).append(menu);
  control22Opened = { select, menu, index: select.selectedIndex };
  select.setAttribute("aria-expanded", "true");
  select.setAttribute("aria-controls", id);
  control22Position();
  control22Highlight(select.selectedIndex);
}

function control22Commit(index) {
  if (!control22Opened) return;
  const select = control22Opened.select;
  const option = select.options[index];
  if (!option || !control22Enabled(option)) return;
  const changed = select.selectedIndex !== index;
  select.selectedIndex = index;
  control22Close();
  if (changed) {
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (select.isConnected && (!changed || !select.matches(".note-heading-select"))) select.focus({ preventScroll: true });
}

function control22Stop(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/** Input fields share the skin; settings choice buttons keep their own surface. */
function control22Decorate() {
  document.querySelectorAll("input,textarea,select").forEach((el) => {
    if (el.matches(CONTROL22_SKIP) || el.closest(".list-search,.widget-capture")) return;
    el.classList.add("control22-field");
    if (CONTROL22_INLINE.some((selector) => el.matches(selector))) el.classList.add("control22-inline");
    if (el instanceof HTMLSelectElement && !el.multiple && el.size <= 1 && !el.hasAttribute("aria-expanded")) {
      el.setAttribute("aria-expanded", "false");
    }
  });
  if (control22Opened && (!control22Opened.select.isConnected || control22Opened.select.disabled)) control22Close();
}

window.addEventListener("pointerdown", (event) => {
  control22ConsumeClick = false;
  if (event.button !== 0) return;
  if (control22Opened) {
    if (control22Opened.menu.contains(event.target)) {
      if (event.target.closest(".control22-option")) control22Stop(event);
      else event.stopImmediatePropagation();
      return;
    }
    control22Close();
    control22ConsumeClick = true;
    control22Stop(event);
    return;
  }
  if (control22Supported(event.target)) {
    control22Open(event.target);
    control22ConsumeClick = true;
    control22Stop(event);
  }
}, true);

window.addEventListener("mousedown", (event) => {
  if (control22Opened?.menu.contains(event.target)) {
    if (event.target.closest(".control22-option")) control22Stop(event);
    else event.stopImmediatePropagation();
    return;
  }
  if (control22Opened || control22ConsumeClick || control22Supported(event.target)) control22Stop(event);
}, true);

window.addEventListener("click", (event) => {
  const item = event.target.closest(".control22-option");
  if (control22Opened && item && control22Opened.menu.contains(item)) {
    control22Stop(event);
    control22Commit(Number(item.dataset.index));
    return;
  }
  if (control22ConsumeClick) { control22ConsumeClick = false; control22Stop(event); return; }
  if (control22Supported(event.target)) {
    control22Stop(event);
    if (control22Opened?.select === event.target) control22Close();
    else control22Open(event.target);
  }
}, true);

window.addEventListener("pointermove", (event) => {
  const item = event.target.closest(".control22-option");
  if (control22Opened && item && control22Opened.menu.contains(item) && item.getAttribute("aria-disabled") !== "true") {
    control22Highlight(Number(item.dataset.index));
  }
}, true);

window.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (!control22Opened) {
    if (control22Supported(event.target) && [" ", "Enter", "ArrowDown", "ArrowUp"].includes(event.key)) {
      control22Stop(event);
      control22Open(event.target);
    }
    return;
  }
  if (event.key === "Tab") { control22Close(); return; }
  if (event.key === "Escape") {
    control22Stop(event);
    const select = control22Opened.select;
    control22Close();
    select.focus({ preventScroll: true });
    return;
  }
  if (event.key === "Enter" || event.key === " ") { control22Stop(event); control22Commit(control22Opened.index); return; }
  const options = [...control22Opened.select.options];
  const valid = options.map((option, index) => (control22Enabled(option) ? index : -1)).filter((index) => index >= 0);
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    control22Stop(event);
    const current = valid.indexOf(control22Opened.index);
    const next = event.key === "Home" ? valid[0]
      : event.key === "End" ? valid.at(-1)
        : valid[Math.max(0, Math.min(valid.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))];
    control22Highlight(next);
    return;
  }
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    control22Stop(event);
    const now = Date.now();
    control22Typed = now - control22TypedAt > 650 ? event.key : control22Typed + event.key;
    control22TypedAt = now;
    const match = valid.find((index) => options[index].label.toLocaleLowerCase().startsWith(control22Typed.toLocaleLowerCase()));
    if (match !== undefined) control22Highlight(match);
  }
}, true);

window.addEventListener("resize", control22Position);
document.addEventListener("scroll", (event) => {
  if (control22Opened && event.target !== control22Opened.menu && !control22Opened.menu.contains(event.target)) control22Close();
}, true);
document.addEventListener("focusin", (event) => {
  if (control22Opened && event.target !== control22Opened.select && !control22Opened.menu.contains(event.target)) control22Close();
}, true);
document.addEventListener("change", (event) => {
  if (control22Opened?.select === event.target) control22Close();
}, true);

control22Decorate();
new MutationObserver(control22Decorate).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });

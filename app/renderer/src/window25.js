// ============================================================
// Phase 25 · Mac / Windows 一体化标题栏
//
// Ported from the frozen Demo's loop-window-phase25.js, with the Demo's
// stylesheet loaded byte-identical as src/window25.css and gated by
// body[data-window25-enabled].
//
// The Demo draws its window controls in HTML because it is a browser preview.
// The product keeps the platform's own controls — macOS traffic lights placed by
// the window's trafficLightPosition, and the Windows/Linux window-controls
// overlay (titleBarOverlay) — so nothing here renders a second copy of a native
// control, and the Demo-only preview scaffolding (platform switch, inactive
// switch, minimize/closed scenes, state label, review bar) is not ported.
//
// What is ported is the Demo's layout contract, measured against the frozen
// candidate: one 48px row spanning the three columns; the identity moved out of
// the navigation column; the identity bound to the live --nav-width on Windows
// and fixed at 184px on Mac; the navigation toggle inside the identity when the
// rail is expanded and beside the 64px icon-only rail when collapsed; the update
// chip keeping its own relative positioning so its notification dot stays on the
// button; the breadcrumb insets; and the native control areas reserved at their
// measured size rather than a hard-coded 138px.
//
// Active / maximized / full-screen state is reported by the main process (real
// window events), never by a click-local flag.
// ============================================================

(() => {
  if (typeof document === "undefined" || !document.body) return;
  if (!document.body.hasAttribute("data-window25-enabled")) return;

  const bridge = window.personalTaskTrack;
  const controls = bridge?.windowControls;
  // darwin keeps the Demo's Mac arrangement (controls on the left). Every other
  // platform has its controls on the right, which is the Demo's Windows one.
  const platform = bridge?.platform === "darwin" ? "mac" : "windows";

  const WINDOW_STATES = ["focused", "maximized", "fullScreen", "minimized"];
  const WINDOW_STATE_ATTRIBUTES = {
    focused: "data-window25-inactive",
    maximized: "data-window25-maximized",
    fullScreen: "data-window25-fullscreen",
  };
  let windowState = { focused: true, maximized: false, fullScreen: false, minimized: false };
  let chromeSignature = "";
  let trafficSpace = null;
  let captionSpace = null;
  let windowStateRevision = 0;

  // The shell caches navigation and topbar independently. Return borrowed
  // identity nodes to their markup owner before either region is reused or
  // replaced; otherwise a new navigation can duplicate the retained brand,
  // or a new topbar can discard it while navigation reuses an empty slot.
  function restoreIdentityOwner() {
    const navigation = document.querySelector(".navigation");
    const brand = document.querySelector(".brand");
    if (!navigation || !brand) return;
    if (brand.parentElement !== navigation) navigation.prepend(brand);
  }

  /** The Demo's `.window25-traffic` box: 56px wide, 12px circles, 8px gaps. */
  function ensureTrafficSpace(brand) {
    if (!trafficSpace || !trafficSpace.isConnected) {
      trafficSpace = document.createElement("span");
      trafficSpace.className = "window25-native-traffic";
      trafficSpace.setAttribute("aria-hidden", "true");
    }
    if (trafficSpace.parentElement !== brand || brand.firstElementChild !== trafficSpace) {
      brand.prepend(trafficSpace);
    }
  }

  /**
   * Reserve the native caption area from the overlay's own geometry.
   * `navigator.windowControlsOverlay.getTitlebarAreaRect()` is the platform's
   * answer for the current scale factor, so no DPI-specific constant is stored.
   * No overlay (or a hidden one, e.g. a full-screen window) reserves nothing.
   */
  function captionReservedWidth() {
    const overlay = navigator.windowControlsOverlay;
    if (!overlay || overlay.visible === false) return 0;
    let rect = null;
    try {
      rect = overlay.getTitlebarAreaRect?.() || null;
    } catch (error) {
      rect = null;
    }
    if (!rect || !rect.width) return 0;
    const reserved = window.innerWidth - (rect.x + rect.width);
    return reserved > 0 ? Math.round(reserved) : 0;
  }

  function applyCaptionReservation(bar) {
    if (!bar) return;
    bar.style.setProperty("--window25-native-caption-width", `${captionReservedWidth()}px`);
  }

  /** The Demo's `.window25-caption` box, at the measured native width. */
  function ensureCaptionSpace(bar) {
    if (platform !== "windows") {
      if (captionSpace) captionSpace.remove();
      captionSpace = null;
      return;
    }
    if (!captionSpace || !captionSpace.isConnected) {
      captionSpace = document.createElement("span");
      captionSpace.className = "window25-native-caption";
      captionSpace.setAttribute("aria-hidden", "true");
    }
    if (bar.lastElementChild !== captionSpace) bar.append(captionSpace);
  }

  function renderWindowState() {
    const body = document.body;
    for (const key of WINDOW_STATES) {
      const attribute = WINDOW_STATE_ATTRIBUTES[key];
      if (!attribute) continue;
      body.toggleAttribute(attribute, windowState[key] === (key === "focused" ? false : true));
    }
  }

  function applyWindowState(next) {
    if (!next || typeof next !== "object") return;
    windowState = {
      focused: next.focused !== false,
      maximized: next.maximized === true,
      fullScreen: next.fullScreen === true,
      minimized: next.minimized === true,
    };
    renderWindowState();
  }

  function cssColorToHex(value) {
    const match = String(value || "").match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (!match) return "";
    return `#${[1, 2, 3].map((index) => Number(match[index]).toString(16).padStart(2, "0")).join("")}`;
  }

  /**
   * Keep the native overlay painted with the app's own canvas/text colours, read
   * from the rendered page: a theme change must never leave a mismatched strip.
   * Only the Windows/Linux overlay has colours to set.
   */
  function publishChromeColors() {
    if (platform !== "windows" || typeof controls?.setChromeColors !== "function") return;
    const computed = getComputedStyle(document.body);
    const background = cssColorToHex(computed.backgroundColor);
    const symbol = cssColorToHex(computed.color);
    if (!background || !symbol) return;
    const signature = `${background}/${symbol}`;
    if (signature === chromeSignature) return;
    chromeSignature = signature;
    Promise.resolve(controls.setChromeColors({ background, symbol, height: 48 }))
      .then((result) => {
        if (result && result.success === false) chromeSignature = "";
      })
      .catch(() => {
        chromeSignature = "";
      });
  }

  function decorate() {
    // The identity starts inside the navigation column; the Demo moves it into
    // the single 48px row and this port does the same.
    const bar = document.querySelector(".topbar");
    const brand = document.querySelector(".brand");
    if (!bar || !brand) return;
    document.body.dataset.window25 = platform;
    bar.setAttribute("aria-label", "Loop 一体化标题栏");
    bar.prepend(brand);
    if (platform === "mac") ensureTrafficSpace(brand);
    applyCaptionReservation(bar);
    ensureCaptionSpace(bar);
    renderWindowState();
    publishChromeColors();
  }

  function watchNativeGeometry() {
    const remeasure = () => {
      const bar = document.querySelector(".topbar");
      if (bar) applyCaptionReservation(bar);
    };
    window.addEventListener("resize", remeasure);
    try {
      navigator.windowControlsOverlay?.addEventListener?.("geometrychange", remeasure);
    } catch (error) {
      // The overlay geometry API is optional; the resize listener still runs.
    }
  }

  function watchWindowState() {
    if (typeof controls?.getState === "function") {
      controls.onState?.((next) => { windowStateRevision++; applyWindowState(next); });
      const revision = windowStateRevision;
      Promise.resolve(controls.getState()).then((next) => {
        if (windowStateRevision === revision) applyWindowState(next);
      }).catch(() => {});
      return;
    }
    // Without the desktop bridge the header still follows real DOM focus.
    window.addEventListener("focus", () => applyWindowState({ focused: true }));
    window.addEventListener("blur", () => applyWindowState({ focused: false }));
  }

  const window25BaseRender = render;
  render = function window25Render() {
    const focused = document.activeElement;
    const action = (focused?.closest?.(".topbar") || focused?.closest?.(".nav-bottom")) ? focused.getAttribute("data-action") : null;
    restoreIdentityOwner();
    window25BaseRender();
    decorate();
    // Root replacement detaches the focused header button. Restore its same
    // action only when the render has not explicitly focused an editor/dialog.
    if (action && (!document.activeElement?.isConnected || document.activeElement === document.body)) {
      const button = [...(document.querySelector(".topbar")?.querySelectorAll("[data-action]") || []),
        ...(document.querySelector(".nav-bottom")?.querySelectorAll("[data-action]") || [])]
        .find((element) => element.getAttribute("data-action") === action);
      if (!button?.disabled) button?.focus({ preventScroll: true });
    }
  };

  watchNativeGeometry();
  watchWindowState();
  render();
})();

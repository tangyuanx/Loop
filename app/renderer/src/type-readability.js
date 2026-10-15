// A whole CSS pixel is not a whole physical pixel at Windows 125%/150% DPI.
// Keep font-size rounding on the current display's physical grid. Each window
// observes its own screen, including when it moves to a monitor with other DPI.
(() => {
  let currentDpr = 0;
  let query;
  function updateTextPixel() {
    const value = Number(window.devicePixelRatio);
    const dpr = Number.isFinite(value) && value > 0 ? value : 1;
    if (dpr === currentDpr) return;
    currentDpr = dpr;
    document.documentElement.style.setProperty("--text-pixel", `${1 / dpr}px`);
    query?.removeEventListener("change", updateTextPixel);
    query = window.matchMedia(`(resolution: ${dpr}dppx)`);
    query.addEventListener("change", updateTextPixel);
  }
  updateTextPixel();
  window.addEventListener("resize", updateTextPixel);
})();

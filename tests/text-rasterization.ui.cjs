// Run on each native OS: headless Chromium cannot verify Windows LCD text policy.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-native-text-'));
  let instance;
  try {
    instance = await electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..')],
      env: { ...process.env, LOOP_USER_DATA_DIR: profile, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await instance.firstWindow();
    await page.waitForSelector('.nav-button');
    await page.waitForLoadState('load');
    await page.evaluate(() => document.fonts.ready);
    const native = await instance.evaluate(({ app, BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/index.html'));
      return { platform: process.platform, profile: app.getPath('userData'),
        lcdTextDisabled: app.commandLine.hasSwitch('disable-lcd-text'),
        forcedDpi: app.commandLine.hasSwitch('force-device-scale-factor'),
        zoom: win.webContents.getZoomFactor(), scale: screen.getDisplayMatching(win.getBounds()).scaleFactor };
    });
    assert.equal(native.profile, profile, 'The test must never use real task data');
    assert.equal(native.lcdTextDisabled, process.platform === 'win32', 'Use Mac-like grayscale coverage with shared CJK outlines on Windows');
    assert.equal(native.forcedDpi, false, 'Preserve per-display DPI handling');
    assert.equal(native.zoom, 1, 'Avoid bitmap enlargement of the app');
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    assert.ok(Math.abs(dpr - native.scale) < 0.001, 'Renderer follows the native display scale');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.nav-button' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert.ok(fonts.some(font => font.postScriptName === 'NotoSansCJKsc-Regular' && font.isCustomFont),
      'Default blackface must use the bundled outlines, including when YaHei is installed: ' + JSON.stringify(fonts));
    console.log('Native text rendering passed:', JSON.stringify(native));
  } finally {
    await instance?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

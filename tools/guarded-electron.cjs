// All real Electron UI suites use this entry before creating a GUI process.
const {assertElectronStartupAllowed, pauseElectronStartup} = require('./electron-startup-guard.cjs');

function createGuardedElectron({
  check = assertElectronStartupAllowed,
  launch = options => require('playwright-core')._electron.launch(options),
  pause = pauseElectronStartup,
} = {}) {
  return {async launch(options) {
    await check();
    try {
      return await launch(options);
    } catch (error) {
      if (/Process failed to launch|SIGABRT/.test(error.message)) {
        try { await pause({reason:'Electron UI startup failed', error:error.message}); }
        catch (failure) { error.startupPauseError = failure.message; }
      }
      throw error;
    }
  }};
}

module.exports = {_electron:createGuardedElectron(), createGuardedElectron};

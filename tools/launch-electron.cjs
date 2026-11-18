// Guard npm dev/start (including --version) before loading the GUI runtime.
const {spawn} = require('node:child_process');
const {assertElectronStartupAllowed, pauseElectronStartup} = require('./electron-startup-guard.cjs');

async function main() {
  await assertElectronStartupAllowed();
  const child = spawn(require('electron'), process.argv.slice(2), {stdio:'inherit', windowsHide:false});
  const forward = signal => child.kill(signal);
  const interrupt = () => forward('SIGINT');
  const terminate = () => forward('SIGTERM');
  process.on('SIGINT',interrupt); process.on('SIGTERM',terminate);
  try {
    const result = await new Promise((resolve,reject) => {
      child.once('error',reject);
      child.once('exit',(code,signal)=>resolve({code,signal}));
    });
    if (result.signal === 'SIGABRT') await pauseElectronStartup({reason:'Electron CLI startup aborted',...result});
    process.exitCode = result.code ?? 1;
  } finally {
    process.off('SIGINT',interrupt); process.off('SIGTERM',terminate);
  }
}

main().catch(error=>{console.error(error.message);process.exitCode=1;});

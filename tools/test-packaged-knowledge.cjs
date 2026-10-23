const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const executable = process.env.LOOP_APP_EXECUTABLE;
if (!executable || !path.isAbsolute(executable) || !fs.existsSync(executable)) {
  throw new Error('LOOP_APP_EXECUTABLE must identify the actual packaged Loop executable.');
}
let failed = false;
for (const name of ['knowledge-desktop.ui.cjs', 'knowledge-conflict.ui.cjs', 'knowledge-feedback.ui.cjs']) {
  console.log(`Packaged Loop regression: ${name}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'tests', name)], {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) failed = true;
}
// Collect every suite's evidence, while any failed suite still blocks release.
if (failed) process.exit(1);

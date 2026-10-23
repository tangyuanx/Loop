const esbuild = require('esbuild');
const fs = require('node:fs/promises');
(async () => {
  await esbuild.build({entryPoints:['app/renderer/src/knowledge-editor.entry.js'], bundle:true, minify:true,
    format:'iife', platform:'browser', target:['chrome120'], outfile:'app/renderer/src/vendor/knowledge-editor.js',
    loader:{'.woff':'file','.woff2':'file','.ttf':'file'}, assetNames:'knowledge-fonts/[name]-[hash]',
    define:{'process.env.NODE_ENV':'"production"'}});
  await fs.copyFile('node_modules/katex/LICENSE','app/renderer/src/vendor/knowledge-fonts/KATEX-LICENSE.txt');
})().catch(error=>{ console.error(error); process.exit(1); });

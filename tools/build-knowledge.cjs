const esbuild = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  await esbuild.build({entryPoints:['app/renderer/src/knowledge-editor.entry.js'], bundle:true, minify:true,
    // Keep generated multiline strings escaped, so rebuilt vendor code has no
    // incidental end-of-line spaces (without editing generated assets by hand).
    supported:{'template-literal':false},
    format:'iife', platform:'browser', target:['chrome120'], outfile:'app/renderer/src/vendor/knowledge-editor.js',
    loader:{'.woff':'file','.woff2':'file','.ttf':'file'}, assetNames:'knowledge-fonts/[name]-[hash]',
    define:{'process.env.NODE_ENV':'"production"'}});
  await fs.copyFile('node_modules/katex/LICENSE','app/renderer/src/vendor/knowledge-fonts/KATEX-LICENSE.txt');
  // Export gets only KaTeX's own rules, with locked, bundled WOFF2 fonts.
  // The main process reads this fixed resource; renderer payloads cannot pick files.
  const katexRoot=path.dirname(require.resolve('katex/package.json'));
  let css=await fs.readFile(path.join(katexRoot,'dist/katex.min.css'),'utf8');
  css=css.replace(/src:([^;}]+)/g,(whole,sources)=>{
    const woff2=sources.match(/url\(([^)]+\.woff2)\)\s*format\([^)]+\)/);
    return woff2?'src:'+woff2[0]:whole;
  });
  const fonts=[...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map(m=>m[1]))];
  for(const font of fonts){
    if(!/^fonts\/[\w-]+\.woff2$/.test(font))throw new Error('Unexpected export font resource: '+font);
    const data=await fs.readFile(path.join(katexRoot,'dist',font));
    css=css.split('url('+font+')').join('url(data:font/woff2;base64,'+data.toString('base64')+')');
  }
  await fs.writeFile('app/main/knowledge-export-assets.css',css);
  await fs.copyFile(path.join(katexRoot,'LICENSE'),'app/main/knowledge-export-KATEX-LICENSE.txt');
})().catch(error=>{ console.error(error); process.exit(1); });

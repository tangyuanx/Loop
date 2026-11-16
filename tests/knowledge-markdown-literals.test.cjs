const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const MarkdownIt=require('markdown-it'),mark=require('markdown-it-mark');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'loop-literal-unit-')),bundle=path.join(folder,'literals.cjs');
require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../app/renderer/src/knowledge-markdown-literals.js')],bundle:true,platform:'node',format:'cjs',outfile:bundle});
const {minimizeLiteralEscapes}=require(bundle);fs.rmSync(folder,{recursive:true,force:true});
const md=new MarkdownIt({html:false,breaks:true}).use(mark);
function generated(raw){const positions=[],offsets=[];let text='';for(const char of raw){offsets.push(text.length);if(/[*_.~]/.test(char)){positions.push(text.length);text+='\\';}text+=char;}offsets.push(text.length);return {text,offsets,positions};}

test('ordinary underscores, dots and punctuation do not gain redundant escapes; caret offsets follow removals',()=>{
 const raw='foo_bar file.name 中文_内容 and literal * end',input=generated(raw);
 const output=minimizeLiteralEscapes(input,input.positions);assert.equal(output.text,raw);
 assert.deepEqual(output.offsets,Array.from({length:raw.length+1},(_,i)=>i));
});
test('necessary literal meaning and block structure survive simplification',()=>{
 for(const raw of ['_literal_','*literal*','~~literal~~','1. ordinary paragraph','***','text _word_ and . name']){
  const input=generated(raw),output=minimizeLiteralEscapes(input,input.positions);
  assert.equal(md.render(output.text),md.render(input.text),raw);
 }
});
test('code and genuine path backslashes are untouched; long plain identifiers simplify as one batch',()=>{
 const text='`code\\_name` C:\\folder\\file';
 assert.equal(minimizeLiteralEscapes({text,offsets:[0,text.length]},[]).text,text);
 const raw=Array(500).fill('file_name.ext').join(' '),input=generated(raw);
 assert.equal(minimizeLiteralEscapes(input,input.positions).text,raw);
});

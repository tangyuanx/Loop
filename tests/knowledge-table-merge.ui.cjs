const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const { readKnowledgeDocument } = require('../app/main/knowledge-file.cjs');
const core = require('../app/renderer/src/knowledge-core.js');
const share = require('../app/renderer/src/task-share-markdown.js');

const plain = [
  '# 合并表格',
  '',
  '| H1 | H2 | H3 |',
  '| :--- | :---: | ---: |',
  '| **A** | <ul><li>B</li></ul> | Other |',
  '| <pre><code class="language-js">C&#124; x&#10;&#10;&lt;y&gt;</code></pre> | [D](https://example.com/) ![图](./assets/demo.png) | End |',
  '| Fifth | Sixth | Seventh |',
  '',
  '| 保留 | 普通表格 |',
  '| -------- | --- |',
  '| legacy | **bold** |',
  '',
].join('\r\n');
const untouched = plain.slice(plain.indexOf('| 保留'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=', 'base64');

async function main() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-merge-files-'));
  const file = path.join(folder, 'Merged.md');
  await fs.writeFile(file, plain);
  await fs.mkdir(path.join(folder, 'assets'));
  await fs.writeFile(path.join(folder, 'assets', 'demo.png'), png);
  let run;
  async function open() {
    const disk = await readKnowledgeDocument(file);
    assert.ok(disk.success);
    run = await launchRepository({ activeTaskId:'merged', taskPane:'notes', tasks:[task('merged', {
      title:'合并表格', notes:disk.content, knowledgeNote:{ ...disk, title:'合并表格', documentState:'SAVED', dirty:false },
    })] }, 'table-merge');
    await run.page.locator('[data-pane=notes]').click();
    await run.page.locator('.kn-table-widget').first().waitFor();
    return run.page;
  }
  try {
    let page = await open();
    const table = () => page.locator('.kn-table-widget').first();
    const bodyCell = (row, column) => table().locator('tbody tr').nth(row).locator('td').nth(column);
    const markdown = () => page.evaluate(() => knowledgeCurrentEntry().getMarkdown());
    async function menu(command, trigger='[data-table-action=tools]', value) {
      const button = table().locator(trigger);
      await table().hover();
      await button.click({button:trigger.includes('[data-table-handle=row]')?'right':'left'});
      await page.locator(`[data-table-command="${command}"]${value===undefined?'':`[data-value="${value}"]`}`).click();
    }
    async function select(a,b) {
      await a.click({position:{x:5,y:9}});
      await b.click({position:{x:5,y:9},modifiers:['Shift']});
    }
    async function save() {
      const result=await page.evaluate(() => saveKnowledgeTask(knowledgeActiveDocument().id));
      assert.notEqual(result,false);
      assert.equal(await fs.readFile(file,'utf8'),await markdown());
    }

    const header = table().locator('th');
    await select(header.nth(0),header.nth(1));
    await menu('merge-cells');
    await table().locator('th[colspan="2"]').waitFor();
    assert.match(await markdown(),/<th colspan="2">H1<br><br>H2<\/th>/);
    await menu('split-cell');
    await table().locator('table:not([data-loop-table])').waitFor();
    assert.match(await markdown(),/\| H1<br><br>H2 \|  \| H3 \|/);
    await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.view.focus();});
    await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');
    await table().locator('th[colspan="2"]').waitFor();
    await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');
    await page.waitForFunction(original=>knowledgeCurrentEntry().getMarkdown()===original,plain);

    await bodyCell(0,2).click();
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.activeElement===document.querySelector('.kn-table-widget'));
    await page.keyboard.press('Shift+ArrowDown');
    assert.equal(await table().locator('[data-table-range]').count(),2);
    await menu('merge-cells');
    await table().locator('td[rowspan="2"]:not([colspan])').waitFor();
    await select(bodyCell(0,0),bodyCell(1,1));
    assert.equal(await table().locator('[data-table-range]').count(),4);
    await menu('merge-cells');
    const rectangle = () => table().locator('td[rowspan="2"][colspan="2"]');
    await rectangle().waitFor();
    await page.waitForFunction(()=>!knowledgeCurrentEntry().activeTableCell||knowledgeCurrentEntry().activeTableCell.input.value.includes('A'));
    await page.evaluate(()=>knowledgeCurrentEntry().finishTableCell());
    assert.equal(await rectangle().locator('strong').innerText(),'A');
    assert.equal(await rectangle().locator('li').innerText(),'B');
    assert.equal(await rectangle().locator('pre code').textContent(),'C| x\n\n<y>');
    assert.equal(await rectangle().locator('a').innerText(),'D');
    await rectangle().locator('img').waitFor();
    await page.waitForFunction(()=>document.querySelector('.kn-table-widget td[rowspan][colspan] img')?.naturalWidth>0);
    assert.equal(await rectangle().evaluate(cell=>cell.innerText.match(/A[\s\S]*B[\s\S]*C[\s\S]*D/)!==null),true);
    assert.ok((await markdown()).endsWith(untouched));
    assert.deepEqual(core.imageReferences(await markdown()).map(ref=>ref.url),['./assets/demo.png']);
    const shared = share.scan(await markdown());
    assert.equal(shared.find(ref=>ref.image)?.destination,'./assets/demo.png');
    const rewritten = share.rewrite(await markdown(),shared,ref=>ref.image?{destination:'./assets/demo.png?q=x&y=z'}:undefined);
    assert.match(rewritten,/src="\.\/assets\/demo\.png\?q=x&amp;y=z"/);
    await save();
    if(process.env.LOOP_MERGE_TEST_EVIDENCE)await fs.cp(folder,process.env.LOOP_MERGE_TEST_EVIDENCE,{recursive:true});

    const previous = await markdown();
    await select(table().locator('th').first(),rectangle());
    await menu('merge-cells');
    assert.equal(await markdown(),previous);

    await run.close();run=null;
    page=await open();
    await rectangle().waitFor();
    assert.equal(await rectangle().locator('img').count(),1);
    await page.evaluate(()=>knowledgeCurrentEntry().setMode('preview'));
    await page.locator('.kn-reading td[rowspan="2"][colspan="2"]').waitFor();
    await page.evaluate(()=>knowledgeCurrentEntry().setMode('edit'));
    await table().locator('[data-table-handle=row][data-index="2"]').click();
    assert.equal(await page.locator('.kn-table-menu').count(),0);
    const coveredRow=await table().locator('tbody tr').nth(1).boundingBox(),mergedCell=await rectangle().boundingBox();
    await page.mouse.click(mergedCell.x+5,coveredRow.y+coveredRow.height/2,{button:'right'});
    assert.equal(await page.locator('.kn-table-menu').getAttribute('aria-label'),'第 2 行操作');
    await page.keyboard.press('Escape');
    await menu('row-add','[data-table-handle=row][data-index="1"]');
    await table().locator('td[rowspan="3"][colspan="2"]').waitFor();
    await menu('row-delete','[data-table-handle=row][data-index="2"]');
    await rectangle().waitFor();
    const beforeMove = await markdown();
    await menu('row-move','[data-table-handle=row][data-index="2"]',4);
    assert.equal(await markdown(),beforeMove);
    await page.evaluate(()=>knowledgeCurrentEntry().finishTableCell());
    await select(rectangle(),bodyCell(2,2));
    const copied = await table().evaluate(widget=>{
      const data=new DataTransfer();
      widget.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));
      return data.getData('text/plain');
    });
    assert.match(copied,/A[^\n]*\t\tOther/);
    assert.equal(copied.split('\n')[1],'\t\t');
    await rectangle().click({position:{x:5,y:9}});
    const beforePaste = await markdown();
    await page.evaluate(()=>{
      const {activeTableCell:active}=knowledgeCurrentEntry();
      const data=new DataTransfer();data.setData('text/plain','X\tY\n1\t2');
      (active.visual?.dom||active.input).dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    });
    assert.equal(await markdown(),beforePaste);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().activeTableCell?.column),2);
    await table().hover();
    const handle=table().locator('[data-column="0"].kn-table-resizer'),rect=await handle.boundingBox();
    assert.ok(rect&&rect.height>20);
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
    await page.mouse.down();
    await page.mouse.move(rect.x+rect.width/2+30,rect.y+rect.height/2,{steps:6});
    await page.mouse.up();
    const widths=await table().locator('col').evaluateAll(columns=>columns.map(column=>Number.parseFloat(column.style.width)));
    assert.equal(widths.length,3);
    assert.ok(widths.every(width=>width>=80));
    await rectangle().click({position:{x:5,y:9}});
    await menu('split-cell');
    await table().locator('td[rowspan="2"]').waitFor();
    assert.equal(await table().locator('td[colspan]').count(),0);
    assert.equal(await bodyCell(0,0).locator('strong').count(),1);
    assert.equal(await bodyCell(0,1).innerText(),'');
    assert.equal(await bodyCell(1,0).innerText(),'');
    assert.equal(await bodyCell(1,1).innerText(),'');
    await save();
    await select(bodyCell(0,0),bodyCell(2,2));
    await menu('merge-cells');
    const wholeBody=table().locator('td[rowspan="3"][colspan="3"]');
    await wholeBody.waitFor();
    await page.waitForFunction(()=>knowledgeCurrentEntry().activeTableCell?.row===1);
    await page.keyboard.press('Tab');
    await table().locator('tbody tr').nth(3).waitFor();
    assert.equal(await wholeBody.count(),1);
    assert.equal(await table().locator('tbody tr').nth(3).locator('td').count(),3);
    assert.deepEqual(run.errors,[]);
    console.log('Merged-table Electron UI, Markdown preservation, resources, undo, disk reopen and reading mode passed.');
  } finally {
    await run?.close();
    await fs.rm(folder,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

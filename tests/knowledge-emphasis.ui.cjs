const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const { readTaskData } = require('../app/main/storage.cjs');
const wb = require('./workbench-helpers.cjs');

const sample = '中文加粗倾斜 Mixed Latin';
const ending = '\n\n结尾正文\n';
const media = '\n![样本图](task-image:emphasis-image)\n\n| 项目 | 说明 |\n| --- | --- |\n| 表格 | 原有内容 |\n';
const original = sample + ending + media;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const figures = {
  bold: { edit: '.kn-strong:not(:has(.kn-strong))', reading: 'strong', token: '**', property: 'font-weight' },
  italic: { edit: '.kn-emphasis:not(:has(.kn-emphasis))', reading: 'em', token: '*', property: 'font-style' },
};

async function run() {
  const evidence = process.env.LOOP_EMPHASIS_QA_DIR
    ? path.resolve(process.env.LOOP_EMPHASIS_QA_DIR)
    : await fs.mkdtemp(path.join(os.tmpdir(), 'loop-98-emphasis-'));
  await fs.mkdir(evidence, { recursive: true });
  const file = path.join(evidence, '选区格式验收.md');
  const session = await launchRepository({ zhFont: 'pingfang', enFont: 'times', attachments: { images: { 'emphasis-image': png } },
    tasks: [task('emphasis', { notes: original })] }, '98-emphasis');
  const { app, page, errors, profile } = session;
  const report = [];
  const menu = page.locator('.wb-context-menu');
  const editor = page.locator('.knowledge-pane .cm-content');
  const select = async (text, reverse = false) => {
    await page.evaluate(({ text, reverse }) => {
      const entry = knowledgeCurrentEntry();
      const from = entry.getEditorText().indexOf(text);
      if (from < 0) throw new Error(`Missing sample: ${text}`);
      const to = from + text.length;
      entry.view.dispatch({ selection: { anchor: reverse ? to : from, head: reverse ? from : to } });
      entry.view.focus();
    }, { text, reverse });
  };
  const selection = () => page.evaluate(() => {
    const { state } = knowledgeCurrentEntry().view;
    const { from, to, anchor, head } = state.selection.main;
    return { text: state.sliceDoc(from, to), reverse: anchor > head };
  });
  const markdown = () => page.evaluate(() => knowledgeCurrentEntry().getMarkdown());
  const undo = () => page.keyboard.press('ControlOrMeta+z');
  const redo = () => page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
  const shortcut = async action => {
    await page.keyboard.press('Shift+F10');
    await menu.locator(`[data-wb-format="${action}"]`).click();
  };

  async function glyphs(locator, property, name, text = sample) {
    const { bounds, ...computed } = await locator.evaluate(async (element, { property, text }) => {
      await document.fonts.ready;
      const style = getComputedStyle(element);
      const { fontFamily, fontSize, fontWeight, fontStyle, fontSynthesis } = style;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent.includes(text)) node = walker.nextNode();
      if (!node) throw new Error(`Cannot measure glyphs for ${text}`);
      const from = node.textContent.indexOf(text);
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, from + text.length);
      const { x, y, width, height } = range.getBoundingClientRect();
      return { fontFamily, fontSize, fontWeight, fontStyle, fontSynthesis, value: style.getPropertyValue(property),
        bounds: { x, y, width, height } };
    }, { property, text });
    const clip = { x: Math.floor(bounds.x - 3), y: Math.floor(bounds.y - 1), width: Math.ceil(bounds.width + 8), height: Math.ceil(bounds.height + 4) };
    const styled = await page.screenshot({ clip, scale: 'css', path: path.join(evidence, `${name}-styled.png`) });
    await locator.evaluate((element, property) => element.style.setProperty(property, property === 'font-weight' ? '400' : 'normal'), property);
    let plain;
    try { plain = await page.screenshot({ clip, scale: 'css', path: path.join(evidence, `${name}-plain.png`) }); }
    finally { await locator.evaluate((element, property) => element.style.removeProperty(property), property); }
    const changed = await app.evaluate(({ nativeImage }, { a, b }) => {
      const bitmap = data => nativeImage.createFromBuffer(Buffer.from(data, 'base64')).toBitmap();
      const first = bitmap(a), second = bitmap(b);
      let pixels = 0;
      for (let i = 0; i < first.length; i += 4) {
        if (Math.abs(first[i] - second[i]) + Math.abs(first[i + 1] - second[i + 1]) + Math.abs(first[i + 2] - second[i + 2]) >= 24) pixels++;
      }
      return pixels;
    }, { a: styled.toString('base64'), b: plain.toString('base64') });
    report.push({ name, changed, ...computed });
    return changed;
  }

  try {
    await page.locator('[data-pane="notes"]').click();
    await page.waitForFunction(() => knowledgeCurrentEntry()?.view);
    await wb.mode(page, 'edit');
    for (const [action, format] of Object.entries(figures)) {
      await select(sample, action === 'italic');
      if (action === 'bold') {
        const firstLine = editor.locator('.cm-line').first();
        await firstLine.click({ button: 'right', position: { x: 25, y: 10 } });
        await menu.locator(`[data-wb-format="${action}"]`).click();
      } else await shortcut(action);
      assert.equal(await markdown(), format.token + sample + format.token + ending + media);
      assert.deepEqual(await selection(), { text: sample, reverse: action === 'italic' });
      await select('结尾正文');
      await page.evaluate(() => knowledgeCurrentEntry().view.contentDOM.blur());
      const formatted = editor.locator(format.edit).filter({ hasText: sample });
      await glyphs(formatted, format.property, `edit-${action}-chinese`, '中文加粗倾斜');
      await glyphs(formatted, format.property, `edit-${action}-latin`, 'Mixed Latin');
      await wb.mode(page, 'preview');
      await glyphs(page.locator(`.kn-rendered ${format.reading}`).filter({ hasText: sample }), format.property, `reading-${action}`);
      await wb.mode(page, 'edit');
      await select(sample, action === 'italic');
      await shortcut(action);
      assert.equal(await markdown(), original);
      assert.deepEqual(await selection(), { text: sample, reverse: action === 'italic' });
      await undo();
      assert.equal(await markdown(), format.token + sample + format.token + ending + media);
      await redo();
      assert.equal(await markdown(), original);
    }

    for (const [action, token] of [['strike', '~~'], ['inline', '`']]) {
      await select(sample);
      await shortcut(action);
      assert.equal(await markdown(), token + sample + token + ending + media);
      assert.deepEqual(await selection(), { text: sample, reverse: false });
      await shortcut(action);
      assert.equal(await markdown(), original);
    }

    await select(sample);
    await page.keyboard.press('Shift+F10');
    await menu.locator('[data-wb-action="link"]').click();
    const address = page.locator('#wb-link');
    await address.fill('https://example.com/notes');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      assert.equal(await address.evaluate(element => {
        const neutral = color => {
          const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return !rgb || rgb[2] <= Math.max(rgb[1], rgb[3]) + 8;
        };
        return [element, element.parentElement].every(node => {
          const css = getComputedStyle(node);
          return neutral(css.borderColor) && neutral(css.outlineColor) && [...css.boxShadow.matchAll(/rgba?\([^)]+\)/g)].every(([color]) => neutral(color));
        });
      }), true);
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = state.theme; });
    await page.locator('#wb-link-insert').click();
    assert.match(await markdown(), /\]\(https:\/\/example\.com\/notes\)/);
    await shortcut('unlink');
    assert.equal(await markdown(), original);

    const across = `${sample}\n\n结尾正文`;
    for (const [action, token] of [['bold', '**'], ['italic', '*'], ['strike', '~~']]) {
      await select(across, true);
      await page.keyboard.press('Shift+F10');
      assert.equal(await menu.locator('[data-wb-format="inline"], [data-wb-action="link"]').count(), 0);
      await menu.locator(`[data-wb-format="${action}"]`).click();
      const formatted = `${token}${sample}${token}\n\n${token}结尾正文${token}\n${media}`;
      assert.equal(await markdown(), formatted);
      assert.equal((await selection()).reverse, true);
      await undo();
      assert.equal(await markdown(), original);
      await redo();
      assert.equal(await markdown(), formatted);
      await undo();
    }

    await select(sample);
    await shortcut('bold');
    await shortcut('italic');
    assert.equal(await markdown(), `***${sample}***${ending}${media}`);
    const picture = page.locator('.knowledge-pane .kn-image-widget img');
    await picture.click({ button: 'right' });
    await page.getByText('复制图片', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.knowledge-pane [data-table-handle="column"]').first().click();
    await page.locator('.kn-table-menu').waitFor();
    await page.keyboard.press('Escape');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, file);
    assert.equal((await page.evaluate(() => saveKnowledgeTask('emphasis'))).success, true);
    const saved = await fs.readFile(file, 'utf8');
    assert.equal(saved, `***${sample}***${ending}${media.replace('task-image:emphasis-image', /\.\/attachments\/asset-[a-f\d]+\.png/.exec(saved)?.[0])}`);
    assert.equal((await readTaskData(profile)).tasks[0].notes, await markdown());
    await page.reload();
    await page.waitForFunction(() => knowledgeCurrentEntry()?.view);
    await wb.mode(page, 'preview');
    const combined = page.locator('.kn-rendered :is(strong em, em strong)').filter({ hasText: sample });
    for (const [zhFont, enFont, theme] of [['pingfang', 'times', 'light'], ['system', 'system', 'dark'], ['heiti', 'inter', 'light']]) {
      await page.evaluate(({ zhFont, enFont, theme }) => { Object.assign(state, { zhFont, enFont, theme }); render(); }, { zhFont, enFont, theme });
      await glyphs(combined, 'font-style', `${zhFont}-reopened-italic`, '中文加粗倾斜');
      await glyphs(combined, 'font-weight', `${zhFont}-reopened-bold`, '中文加粗倾斜');
      assert.equal(await page.locator('.list-search input').evaluate(input => getComputedStyle(input).fontSynthesis), 'none');
    }
    for (const result of report) assert.ok(result.changed >= 30, `${result.name}: ${result.changed} changed pixels, ${result.fontSynthesis} ${result.fontFamily}`);
    assert.deepEqual(errors, []);
    console.log(`PASS knowledge emphasis glyphs, mouse and keyboard menu, selection, history and save/reopen. Evidence: ${evidence}`);
  } finally {
    await fs.writeFile(path.join(evidence, 'glyphs.json'), JSON.stringify(report, null, 2));
    console.log(`Glyph evidence: ${evidence}`);
    await session.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });

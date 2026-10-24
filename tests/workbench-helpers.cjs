/* Navigate the production menu controls; editor/data assertions stay in suites. */
async function mode(page,value){
  await page.locator('[data-wb-action="mode"]').click();
  await page.locator(`[data-wb-mode="${value}"]`).click();
  await page.waitForFunction(value=>knowledgeCurrentEntry()?.mode===value,value);
}
async function more(page){await page.locator('[data-wb-action="more"]').click();}
async function context(page){await more(page);await page.locator('[data-wb-action="format"]').click();}
async function format(page,kind,value){
  await context(page);
  const group=['heading','bullet','ordered','task','quote'].includes(kind)?'paragraph':['code','table','rule'].includes(kind)?'insert':'text';
  await page.locator(`[data-wb-sub="${group}"]`).click();
  if(kind==='heading'&&Number(value)>0)await page.locator('[data-wb-sub="headings"]').click();
  await page.locator(`.wb-menu [data-wb-format="${kind}"]${value===undefined?'':`[data-wb-value="${value}"]`}`).click();
}
async function panels(page){await more(page);await page.locator('.wb-more-menu [data-kn-action="panels"]').click();}
async function width(page,value){await more(page);await page.locator('[data-action="knowledge-width-menu"]').click();await page.locator(`[data-action="set-note-width"][data-width="${value}"]`).click();}
module.exports={mode,more,context,format,panels,width};

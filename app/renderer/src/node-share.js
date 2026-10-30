/* Node sharing uses the task document exporter and the real task tree. */
function openNodeShare(taskId, nodeId, trigger) {
  const task = state.tasks.find(item => item.id === taskId);
  const node = task && findNode(task.nodes, nodeId);
  if (!node) return;
  captureMountedMilkdownDrafts();
  flushNodeNoteDrafts({ persist: true });
  const origin = trigger?.closest?.('[data-action]') || document.querySelector(`.node-title[data-node-id="${CSS.escape(nodeId)}"]`);
  const fromMenu = Boolean(origin?.closest('.node-context-menu'));
  const returnSelector = fromMenu || !origin?.dataset.action
    ? `.node-title[data-node-id="${CSS.escape(nodeId)}"]`
    : `[data-action="${CSS.escape(origin.dataset.action)}"][data-node-id="${CSS.escape(nodeId)}"]`;
  const levels = (label, id, zero) => `<label class="node-share-level" for="${id}"><span>${label}</span><select id="${id}"><option value="all">全部</option><option value="0">${zero}</option><option value="1">1 层</option><option value="2">2 层</option><option value="3">3 层</option></select></label>`;
  shellKnowledgeDialog('分享节点', `<div class="node-share-panel">
    <p class="node-share-title">${shellIcon('note')}<span>${esc(node.title || '未命名节点')}</span></p>
    <div class="node-share-layout">
      <div class="node-share-settings">
        <h3>分享范围</h3>
        <div class="node-share-levels">${levels('子节点深度', 'node-share-children', '不包含子节点')}${levels('下游关联层数', 'node-share-downstream', '不包含下游')}</div>
        <p class="node-share-hint">仅沿已保存的后续关联包含下游，各下游也按所选深度包含子节点。</p>
        <label class="node-share-check node-share-records"><input id="node-share-records" type="checkbox" checked><span>包含节点记录</span></label>
        <details class="node-share-relations"><summary><span>关联后续节点</span><span id="node-share-link-count"></span>${shellIcon('down')}</summary>
          <p class="node-share-hint">修改此节点的直接后续关联，保存后用于本次及之后的分享。</p>
          <div class="node-share-search-field">${shellIcon('search')}<input id="node-share-search" type="search" placeholder="搜索同任务中的节点" aria-label="搜索后续节点"></div>
          <div id="node-share-links" class="node-share-links"></div>
          <button class="button" type="button" id="node-share-save-links" disabled>保存关联</button><p id="node-share-link-status" role="status" aria-live="polite"></p>
        </details>
      </div>
      <section class="node-share-preview" aria-label="分享范围预览"><div class="node-share-preview-head"><h3>内容预览</h3><p id="node-share-count" role="status" aria-live="polite" aria-atomic="true"></p></div><ul id="node-share-preview"></ul></section>
    </div>
    <p id="node-share-error" class="error" role="alert"></p>
  </div>`, '<span class="node-share-format">Markdown / PDF</span><button class="button" type="button" data-action="close-dialog">取消</button><button class="button primary" type="button" id="node-share-export">导出…</button>', 720);
  const panel = document.querySelector('.node-share-panel');
  const dialog = panel.closest('.dialog');
  dialog.classList.add('node-share-dialog');
  dialog.parentElement.dataset.returnFocus = returnSelector;
  const get = id => dialog.querySelector(`#node-share-${id}`);
  const options = () => ({ childDepth: get('children').value, downstreamDepth: get('downstream').value });
  const current = () => state.tasks.find(item => item.id === taskId);
  let draftLinks = new Set(node.downstreamNodeIds || []);
  let savingLinks = false, linkSaveFailed = false;
  const savedLinks = () => new Set(findNode(current()?.nodes || [], nodeId)?.downstreamNodeIds || []);
  const dirty = () => { const saved = savedLinks(); return saved.size !== draftLinks.size || [...draftLinks].some(id => !saved.has(id)); };
  function refreshPreview() {
    const selection = LoopNodeShare.select(current()?.nodes || [], nodeId, options());
    get('count').textContent = `${selection.count} 个节点`;
    const append = (nodes, depth = 0) => nodes.map(item => `<li style="--share-depth:${Math.min(depth, 6)}">${shellIcon('note')}<span>${esc(item.title || '未命名节点')}</span></li>${append(item.children, depth + 1)}`).join('');
    get('preview').innerHTML = append(selection.nodes);
    get('link-count').textContent = `（${savedLinks().size}）`;
  }
  function refreshLinks() {
    const active = current(), query = get('search').value.trim().toLocaleLowerCase();
    const paths = new Map();
    function visit(nodes, parents = []) { for (const item of sort(nodes)) { const path = [...parents, item.title || '未命名节点']; paths.set(item.id, path.join(' / ')); visit(item.children, path); } }
    visit(active?.nodes || []);
    const allowed = LoopNodeShare.linkTargets(active?.nodes || [], nodeId);
    const candidates = [...LoopNodeShare.indexNodes(active?.nodes || []).values()].filter(item => item.id !== nodeId && (draftLinks.has(item.id) || allowed.has(item.id)) && paths.get(item.id).toLocaleLowerCase().includes(query));
    const missing = [...draftLinks].filter(id => !paths.has(id));
    get('links').innerHTML = candidates.map(item => `<label class="node-share-check"><input type="checkbox" value="${escAttr(item.id)}" ${draftLinks.has(item.id) ? 'checked' : ''}><span>${esc(paths.get(item.id))}</span></label>`).join('') + missing.map(id => `<label class="node-share-check"><input type="checkbox" value="${escAttr(id)}" checked><span>已移除的节点（取消勾选以解除关联）</span></label>`).join('') || '<p class="node-share-hint">没有可关联的节点</p>';
    get('save-links').disabled = savingLinks || (!dirty() && !linkSaveFailed);
  }
  get('children').onchange = refreshPreview;
  get('downstream').onchange = refreshPreview;
  get('search').oninput = refreshLinks;
  get('links').onchange = event => {
    if (event.target.checked) draftLinks.add(event.target.value); else draftLinks.delete(event.target.value);
    get('save-links').disabled = savingLinks || (!dirty() && !linkSaveFailed);
    get('link-status').textContent = dirty() ? '关联已更改，保存后生效。' : '';
    get('export').disabled = dirty() || savingLinks || linkSaveFailed;
  };
  get('save-links').onclick = async () => {
    if (savingLinks) return;
    if (dataProtectionMessage || dataTransferInProgress) { get('error').textContent = '当前数据处于保护状态，暂时无法保存关联。'; return; }
    const active = current(), source = active && findNode(active.nodes, nodeId);
    if (!source) { get('error').textContent = '节点已移除，请关闭后重试。'; return; }
    const allowed = LoopNodeShare.linkTargets(active.nodes, nodeId);
    const valid = [...draftLinks].filter(id => allowed.has(id));
    if (valid.length !== draftLinks.size) { get('error').textContent = '关联中存在循环或已移除节点，请重新选择。'; return; }
    source.downstreamNodeIds = valid;
    source.updatedAt = active.updatedAt = now();
    savingLinks = true; get('error').textContent = '';
    get('save-links').disabled = true; get('export').disabled = true;
    get('links').querySelectorAll('input').forEach(input => { input.disabled = true; });
    get('link-status').textContent = '正在保存关联…';
    refreshPreview();
    try {
      save();
      linkSaveFailed = !(await flushSave());
    } catch (error) { linkSaveFailed = true; console.error('Failed to save node relationships.', error); }
    finally {
      savingLinks = false;
      if (panel.isConnected) {
        get('link-status').textContent = linkSaveFailed ? '关联保存失败，当前选择已保留，请重试。' : '关联已保存到本机。';
        get('save-links').textContent = linkSaveFailed ? '重试保存关联' : '保存关联';
        refreshLinks(); get('export').disabled = dirty() || linkSaveFailed;
      }
    }
  };
  get('export').onclick = async () => {
    const button = get('export'); if (button.disabled || dirty()) return;
    button.disabled = true; button.textContent = '正在导出…';
    dialog.setAttribute('aria-busy', 'true'); get('error').textContent = '';
    try {
      captureMountedMilkdownDrafts(); flushNodeNoteDrafts({ persist: true });
      const active = current(), source = active && findNode(active.nodes, nodeId);
      if (!source) throw Error('节点已移除，请关闭后重试。');
      const selection = LoopNodeShare.select(active.nodes, nodeId, options());
      const markdown = nodeShareMarkdown(source, selection, get('records').checked);
      const result = await exportTaskMarkdown(source.title || '未命名节点', markdown);
      if (!result?.canceled && panel.isConnected) shellCloseOverlay();
    } catch (error) {
      if (panel.isConnected) get('error').textContent = '导出失败，请重试。';
      console.error('Failed to export shared nodes.', error);
    } finally {
      if (panel.isConnected) { button.disabled = dirty() || savingLinks || linkSaveFailed; button.textContent = '导出…'; dialog.removeAttribute('aria-busy'); }
    }
  };
  refreshPreview(); refreshLinks();
}

function nodeShareMarkdown(source, selection, records = true) {
  function withoutRecords(nodes) { return nodes.map(node => ({ ...node, note: '', children: withoutRecords(node.children) })); }
  const nodes = records ? selection.nodes : withoutRecords(selection.nodes);
  const index = LoopNodeShare.indexNodes(nodes);
  const links = [...index.values()].flatMap(node => (node.downstreamNodeIds || []).filter(id => index.has(id)).map(id => `- ${node.title || '未命名节点'} → ${index.get(id).title || '未命名节点'}`));
  return [`# ${source.title || '未命名节点'}`, '', `- 分享节点：${selection.count}`, '', ...nodes.flatMap(node => nodeMarkdownLines(node, 0)), ...(links.length ? ['', '## 后续关联', '', ...links] : [])].join('\n');
}

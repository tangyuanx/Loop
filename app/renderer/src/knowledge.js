// ============================================================
// Loop -- knowledge note pane
//
// Presentation ported from the frozen Demo's ninth stage
// (loop-knowledge-phase9-refinement.js + loop-knowledge-phase8.css, loaded as
// src/knowledge.css). The editor instance, file binding, conflict handling and
// crash recovery all remain the project's own implementations: this module
// only rebuilds the markup around them.
//
// demo state names map 1:1 onto task.knowledgeNote.documentState:
//   DRAFT / SAVED / DIRTY / EXTERNAL_CHANGED / FILE_MISSING / READ_ONLY
// ============================================================

(function installKnowledgeFooterNoticeStyles() {
  const id = "loop-knowledge-footer-notice";
  if (!document.head || typeof document.getElementById !== "function" || document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
.knowledge-feature-caution {flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; color: #ad6262; font-size: calc(10px * var(--font-scale,1)); font-weight: 400;}
:root[data-theme="dark"] .knowledge-feature-caution {color: #cc8c8c;}
`;
  document.head.appendChild(style);
})();

Object.assign(SHELL_ICON_PATHS, {
  knowledgeTable: "M3 3h18v18H3zM3 9h18M9 3v18",
  knowledgeCode: "m8 7-5 5 5 5m8-10 5 5-5 5m-2-14-4 18",
  knowledgeImage: "M3 3h18v18H3zM3 16l5-5 4 4 4-6 5 7M7 7h.01",
  knowledgeDiagram: "M3 9h5v6H3zM16 9h5v6h-5zM8 12h8m-3-3 3 3-3 3",
  noteBold: "M6 4h7a4 4 0 0 1 0 8H6zm0 8h8a4 4 0 0 1 0 8H6z",
  noteItalic: "M10 4h8M6 20h8M14 4l-4 16",
  noteStrike: "M17 6c-1-2-8-3-10 1-2 4 3 5 5 5m5 3c2 5-7 8-10 3M3 12h18",
  noteInline: "m8 7-5 5 5 5m8-10 5 5-5 5",
  noteBullet: "M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1",
  noteOrdered: "M10 6h11M10 12h11M10 18h11M3 4h2v5M3 11h3l-3 5h3M3 18h3v3H3",
  noteTask: "M3 4h6v6H3zM13 7h8M3 14h6v6H3zM13 17h8m-9-1 2 2 4-4",
  noteQuote: "M4 5h6v7H4zm10 0h6v7h-6zM10 12c0 4-2 6-5 7m15-7c0 4-2 6-5 7",
  noteLink: "m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  noteRule: "M3 12h18",
  noteUndo: "m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7",
  noteRedo: "m16 4 5 5-5 5M21 9H11a7 7 0 0 0-7 7",
  noteWidth: "M3 4h18v16H3zM8 8v8M16 8v8M10 12h4",
});

const SHELL_NOTE_WIDTH_NAMES = { default: "默认", wide: "较宽", full: "全宽" };
const SHELL_NOTE_WIDTH_DESCRIPTIONS = {
  default: "适合阅读与日常记录",
  wide: "适合代码与多列表格",
  full: "使用工作台的可用空间",
};
const SHELL_KNOWLEDGE_STATE_LABELS = {
  DRAFT: "草稿",
  SAVED: "已保存",
  DIRTY: "已修改",
  EXTERNAL_CHANGED: "文件有外部修改",
  FILE_MISSING: "文件已丢失",
  READ_ONLY: "文件不可写",
};
const SHELL_KNOWLEDGE_ATTENTION = ["EXTERNAL_CHANGED", "FILE_MISSING", "READ_ONLY"];

function shellKnowledgeState(task) {
  const note = task?.knowledgeNote || {};
  const unavailable = state.knowledgeFileIssues?.[note.noteId];
  const key = unavailable ? "UNAVAILABLE" : String(note.documentState || "DRAFT");
  return {
    note,
    key,
    unavailable,
    label: unavailable ? "文件暂时不可用" : SHELL_KNOWLEDGE_STATE_LABELS[key] || "草稿",
    attention: unavailable ? true : SHELL_KNOWLEDGE_ATTENTION.includes(key),
  };
}

function shellKnowledgeMode() {
  return ["edit", "source", "preview"].includes(state.markdownMode) ? state.markdownMode : "edit";
}

function shellNoteWidth() {
  return Object.hasOwn(SHELL_NOTE_WIDTH_NAMES, state.knowledgeWidth) ? state.knowledgeWidth : "default";
}

function shellKnowledgeFileName(note) {
  if (!note?.filePath) return { text: "尚未关联文件", title: "尚未关联本地文件" };
  return { text: String(note.filePath).split(/[\\/]/).pop(), title: note.filePath };
}

function shellKnowledgeRecoveryText(task) {
  const pending = knowledgeRecoveryTimers?.has?.(task?.knowledgeNote?.noteId);
  const connected = typeof desktopKnowledgeRecovery !== "undefined" && Boolean(desktopKnowledgeRecovery);
  return pending ? "本页草稿已保留" : connected ? "自动保存草稿到本机" : "文件状态仅在桌面应用中可用";
}

// ------------------------------------------------------------
// Pane
// ------------------------------------------------------------

function renderShellKnowledge(task) {
  const noteState = shellKnowledgeState(task);
  const mode = shellKnowledgeMode();
  const width = shellNoteWidth();
  const stats = markdownStats(task.notes);
  const file = shellKnowledgeFileName(noteState.note);
  return `
    <section class="knowledge-pane task-knowledge-pane" data-task-id="${escAttr(task.id)}" data-knowledge-state="${escAttr(noteState.key)}" aria-label="知识笔记">
      <header class="knowledge-header">
        <div class="knowledge-file-meta">
          <button type="button" class="kn-note-title" data-kn-action="rename" title="重命名笔记 · ${escAttr(noteState.label)} · ${escAttr(file.text)} · ${escAttr(file.title)}">${shellIcon("note")}<span>${esc(LoopKnowledgeCore.noteTitle(task))}</span></button>
        </div>
        <div class="knowledge-header-actions">
          <button class="text-button kn-switch-note" type="button" data-kn-action="switcher" aria-label="切换笔记" title="切换笔记（Ctrl/Cmd+O）">${shellIcon("note")}<span>切换笔记</span></button>
          <button class="icon-button" type="button" data-kn-action="panels" aria-label="大纲与关联笔记" title="大纲与关联笔记" aria-expanded="false" aria-controls="kn-side-panel">${shellIcon("note23Outline")}</button>
          <button class="icon-button" type="button" data-kn-action="find" aria-label="查找当前笔记" title="查找当前笔记（Ctrl/Cmd+F）" aria-expanded="false">${shellIcon("search")}</button>
          ${renderShellKnowledgeViewbar(mode)}
          <button class="icon-button" type="button" data-action="knowledge-file-menu" data-knowledge-action="file-menu" aria-label="笔记文件操作" aria-haspopup="menu">${shellIcon("more")}</button>
        </div>
      </header>
      ${renderShellKnowledgeNotice(task, noteState)}
      ${renderShellKnowledgeTools(mode)}
      <div class="knowledge-body" data-knowledge-scroll data-knowledge-view="${escAttr(knowledgeViewKey(task))}">
        <div class="knowledge-page width-${width} ${mode === "source" ? "source-page" : ""}">
          <div id="knowledge-rich-host" class="knowledge-rich-host milkdown-editor-host" data-editor-kind="knowledge" data-task-id="${escAttr(task.id)}" aria-label="笔记编辑器"><p class="knowledge-loading">正在打开笔记…</p></div>
        </div>
      </div>
      <footer class="knowledge-footer">
        <span class="kn-save-receipt" role="status" data-kn-receipt>正在读取保存状态…</span>
        <div class="knowledge-footer-meta">
          <span data-note-stats>${stats.characters} 字 · ${stats.lines} 行</span>
        </div>
        ${renderShellKnowledgeWidthButton()}
        <button class="button" type="button" data-note-save data-action="save-knowledge" data-task-id="${escAttr(task.id)}" title="保存笔记（Ctrl/Cmd+S）">${shellIcon("check")}保存</button>
      </footer>
    </section>`;
}

function renderShellKnowledgeViewbar(mode) {
  const modes = [["edit", "实时预览"], ["source", "源码"], ["preview", "阅读"]]
    .map(([value, label]) => `<button type="button" data-action="knowledge-mode" data-mode="${value}" aria-pressed="${value === mode}" class="${value === mode ? "active" : ""}">${label}</button>`)
    .join("");
  return `<div class="knowledge-viewbar">
    <div class="knowledge-modes" role="group" aria-label="笔记视图">${modes}</div>
  </div>`;
}

function renderShellKnowledgeWidthButton() {
  return `<button class="note-width-button" type="button" data-action="knowledge-width-menu" aria-label="笔记页宽：${escAttr(SHELL_NOTE_WIDTH_NAMES[shellNoteWidth()])}" title="调整笔记页宽" aria-haspopup="menu">${shellIcon("noteWidth")}<span>${esc(SHELL_NOTE_WIDTH_NAMES[shellNoteWidth()])}</span>${shellIcon("chevron")}</button>`;
}

function renderShellKnowledgeNotice(task, noteState) {
  const button = (action, label, extra = "") => `<button class="text-button" type="button" data-action="${action}" data-task-id="${escAttr(task.id)}" ${extra}>${label}</button>`;
  let text = "";
  let actions = "";
  let tone = "attention";
  if (noteState.key === "EXTERNAL_CHANGED") {
    text = "文件已在其他应用中修改，当前内容与草稿仍保留。";
    actions = button("knowledge-conflict", "处理冲突") + button("save-knowledge-as", "另存为");
  } else if (noteState.key === "FILE_MISSING") {
    text = "找不到关联文件，当前笔记内容仍保留。";
    actions = button("relocate-knowledge", "重新定位") + button("save-knowledge-as", "另存为");
  } else if (noteState.key === "READ_ONLY") {
    text = "当前文件不可写，可重试或另存为。";
    actions = button("retry-knowledge", "重试") + button("save-knowledge-as", "另存为");
  } else if (noteState.unavailable) {
    text = noteState.unavailable.message || "文件暂时不可用。";
    actions = button("retry-knowledge", "重试") + button("save-knowledge-as", "另存为");
  }
  if (!text) return "";
  return `<div class="knowledge-notice ${tone}" role="status"><span>${shellIcon("blocked")}${esc(text)}</span><div>${actions}</div></div>`;
}

function renderShellKnowledgeTools(mode) {
  if (mode === "preview") return '<div class="knowledge-tools knowledge-search-only"><div class="kn-find-mount"></div></div>';
  const format = (action, image, label) => `<button class="knowledge-tool" type="button" data-action="note-format" data-format="${action}" title="${escAttr(label)}" aria-label="${escAttr(label)}"${["bold", "italic", "strike", "inline"].includes(action) ? ' aria-pressed="false"' : ""}>${shellIcon(image)}</button>`;
  const group = (name, html) => `<div class="note-tool-group" role="group" aria-label="${escAttr(name)}">${html}</div>`;
  const heading = `<select class="note-heading-select" aria-label="段落格式"><option value="0">正文</option><option value="1">标题 1</option><option value="2">标题 2</option><option value="3">标题 3</option><option value="4">标题 4</option><option value="5">标题 5</option><option value="6">标题 6</option></select>`;
  const tools = group("文字格式", heading
      + format("bold", "noteBold", "粗体")
      + format("italic", "noteItalic", "斜体")
      + format("inline", "noteInline", "行内代码"))
    + group("段落与列表", format("bullet", "noteBullet", "无序列表")
      + format("task", "noteTask", "任务列表"))
    + group("插入内容", format("link", "noteLink", "链接")
      + `<button class="knowledge-tool kn-insert-button" type="button" data-kn-action="insert-menu" title="插入与更多格式" aria-haspopup="menu" aria-expanded="false">${shellIcon("plus")}<span>插入</span>${shellIcon("chevron")}</button>`)
    + group("编辑历史", format("undo", "noteUndo", "撤销（Ctrl/Cmd+Z）") + format("redo", "noteRedo", "重做（Ctrl/Cmd+Shift+Z）"));
  return `<div class="knowledge-tools"><div class="knowledge-insert-toolbar" role="toolbar" aria-label="笔记格式工具">${tools}</div><div class="kn-find-mount"></div></div>`;
}

// ------------------------------------------------------------
// Overlay surfaces
// ------------------------------------------------------------

function shellNoteWidthMenu(trigger) {
  shellMountSurface(
    `<div class="surface-popover note-width-menu" role="menu" aria-label="选择笔记页宽">${shellSurfaceHeader("笔记页宽")}
      ${Object.entries(SHELL_NOTE_WIDTH_NAMES).map(([value, label]) => `<button class="note-width-option" type="button" role="menuitemradio" aria-checked="${value === shellNoteWidth()}" data-action="set-note-width" data-width="${value}"><span class="note-width-sample sample-${value}" aria-hidden="true"><i></i><i></i><i></i></span><span class="note-width-copy"><strong>${label}</strong><small>${esc(SHELL_NOTE_WIDTH_DESCRIPTIONS[value])}</small></span><span class="note-width-check">${value === shellNoteWidth() ? shellIcon("check") : ""}</span></button>`).join("")}
    </div>`,
    trigger,
    244,
  );
  const menu = document.querySelector(".note-width-menu");
  if (menu) menu.dataset.returnFocus = '[data-action="knowledge-width-menu"]';
  menu?.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
  menu?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const items = [...menu.querySelectorAll("[data-width]")];
    const index = items.indexOf(document.activeElement);
    items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  }, true);
}

function shellKnowledgeFileMenu(trigger) {
  const task = shellActiveTask();
  if (!task) return;
  const bound = Boolean(task.knowledgeNote?.filePath);
  const savePresentation=typeof knowledgeSavePresentation==='function'?knowledgeSavePresentation(task):{menuLabel:'保存笔记',state:'saved'};
  // Phase26: a body that is not stored anywhere outside Loop can be removed into
  // 最近删除 from this same menu, exactly like the Demo's own file menu.
  const removable = String(task.notes || "").trim()
    ? '<div class="menu-divider"></div><button class="button danger-action" type="button" role="menuitem" data-recovery26="remove-note" data-task-id="' + escAttr(task.id) + '">' + shellIcon("close") + '移除软件内笔记…</button>'
    : "";
  shellMountSurface(
    `<div class="surface-popover" role="menu" aria-label="笔记文件操作"><div class="note23-menu-label">文件</div>
      <button class="button" type="button" role="menuitem" data-knowledge-save-label data-action="save-knowledge" data-task-id="${escAttr(task.id)}" ${savePresentation.state==='saving'?'disabled':''}>${esc(savePresentation.menuLabel)}</button>
      <button class="button" type="button" role="menuitem" data-action="relocate-knowledge" data-task-id="${escAttr(task.id)}">打开 Markdown 文件…</button>
      <button class="button" type="button" role="menuitem" data-action="save-knowledge-as" data-task-id="${escAttr(task.id)}">另存为…</button>
      <div class="menu-divider"></div>
      <div class="note23-menu-label">当前笔记</div>
      <button class="button" type="button" role="menuitem" data-action="knowledge-file-info" data-task-id="${escAttr(task.id)}">文件信息</button>
      ${bound ? `<button class="button" type="button" role="menuitem" data-action="remove-knowledge-binding" data-task-id="${escAttr(task.id)}">解除文件关联…</button>` : ""}
      <button class="button" type="button" role="menuitem" data-action="close-knowledge-editor" data-task-id="${escAttr(task.id)}">关闭笔记</button>
      <div class="menu-divider"></div>
      <div class="note23-menu-label">导出</div>
      <button class="button" type="button" role="menuitem" data-action="export-knowledge-note" data-task-id="${escAttr(task.id)}">导出笔记…</button>
      <button class="button" type="button" role="menuitem" data-action="share-task" data-task-id="${escAttr(task.id)}">分享／导出任务…</button>
      ${removable}</div>`,
    trigger,
    232,
  );
}

/** Export a snapshot of the current body; saving a copy never rebinds the note. */
function shellKnowledgeExportNote(task) {
  if (!task) return;
  captureMountedMilkdownDrafts();
  flushNodeNoteDrafts({ persist: true });
  const markdown = String(knowledgeText(task));
  // Freeze every dependency before any async rendering or file dialog.
  const notes = knowledgeNotes().map(note => ({ ...structuredClone(note), notes: String(knowledgeText(note)) }));
  const scopes = structuredClone(state.knowledgeAssetScopes || {});
  const images = structuredClone(state.attachments?.images || {});
  const noteId = task.knowledgeNote.noteId;
  const renderer = window.LoopKnowledgeEditor?.createRenderer({
    offlineExport: true,
    getNotes: () => notes, getContent: note => note.notes,
    resolveImage: (id, source) => {
      if (source.startsWith("task-image:")) return images[source.slice(11)] || "";
      try { return scopes[id]?.[source] || scopes[id]?.[decodeURIComponent(source)] || ""; } catch { return ""; }
    },
  });
  const title = typeof note23FileName === "function"
    ? note23FileName(task, { path: task.knowledgeNote?.filePath }).replace(/\.md$/i, "")
    : task.title || "未命名笔记";
  shellKnowledgeDialog("导出笔记",
    `<p class="knowledge-dialog-copy">导出打开此窗口时的笔记快照；不改变文件关联。</p><div class="export-format-row"><label for="knowledge-export-format">格式</label><select id="knowledge-export-format"><option value="md">Markdown</option><option value="html">HTML</option><option value="pdf">PDF（桌面应用）</option></select></div><p id="knowledge-export-status" role="status">正在生成导出预览…</p><article id="knowledge-export-preview" class="kn-rendered knowledge-export-preview"></article><div id="knowledge-export-issues" class="knowledge-export-issues" hidden><ul></ul><label><input type="checkbox" id="knowledge-export-incomplete">保留图表源码与缺失资源说明，继续导出</label></div><p class="knowledge-demo-boundary">HTML 与 PDF 内嵌公式字体、本地图片及静态图表，可离线阅读。Markdown 保留原文和图片引用。</p><p class="error" id="knowledge-export-error" role="alert" hidden></p><button class="button" id="knowledge-export-retry" hidden>重新生成预览</button>`,
    '<button class="button" data-action="close-dialog">取消</button><button class="button primary" id="knowledge-export-download">导出</button>', 680);
  const button = document.querySelector("#knowledge-export-download");
  const dialog = button.closest('[role="dialog"]');
  const formatSelect = dialog.querySelector("#knowledge-export-format");
  const error = dialog.querySelector("#knowledge-export-error");
  const status = dialog.querySelector("#knowledge-export-status");
  const issues = dialog.querySelector("#knowledge-export-issues");
  const allowIncomplete = dialog.querySelector("#knowledge-export-incomplete");
  const retry = dialog.querySelector("#knowledge-export-retry");
  let prepared = null, preparing = false, exporting = false, controller;
  const update = () => { button.disabled = exporting || (formatSelect.value !== "md" && (!prepared || preparing || (prepared.issues.length > 0 && !allowIncomplete.checked))); };
  const observer = new MutationObserver(() => { if (!button.isConnected) { controller?.abort(); observer.disconnect(); } });
  observer.observe(shellOverlay(), { childList: true, subtree: true });
  async function prepare() {
    controller?.abort(); controller = new AbortController();
    prepared = null; preparing = true; allowIncomplete.checked = false;
    error.hidden = true; retry.hidden = true; issues.hidden = true;
    status.textContent = "正在生成导出预览…"; update();
    try {
      if (!renderer) throw new Error("笔记渲染器尚未就绪，请关闭窗口后重试。");
      const result = await renderer.exportStatic(markdown, { noteId }, { signal: controller.signal });
      if (!button.isConnected) return;
      prepared = result;
      dialog.querySelector("#knowledge-export-preview").innerHTML = result.html;
      issues.hidden = result.issues.length === 0;
      issues.querySelector("ul").innerHTML = result.issues.map(issue => `<li>${esc(issue)}</li>`).join("");
      retry.hidden = result.issues.length === 0;
      status.textContent = result.issues.length ? "部分内容未能完整渲染，请检查后选择重试或继续。" : "预览已就绪，HTML 与 PDF 使用相同内容。";
    } catch (failure) {
      if (failure.name === "AbortError" || !button.isConnected) return;
      error.textContent = failure.message || "预览生成失败，请重试。"; error.hidden = false; retry.hidden = false;
      status.textContent = "预览未完成；仍可导出 Markdown 原文。";
    } finally { preparing = false; update(); }
  }
  retry.addEventListener("click", () => void prepare());
  allowIncomplete.addEventListener("change", update); formatSelect.addEventListener("change", update);
  void prepare();
  button?.addEventListener("click", async () => {
    if (button.disabled || exporting) return;
    const format = formatSelect.value;
    exporting = true; update();
    if (error) error.hidden = true;
    try {
      if (!desktopExport?.taskDocument) throw new Error("请在桌面应用中导出笔记。");
      const incomplete = format !== "md" && prepared.issues.length > 0;
      const result = await desktopExport.taskDocument({ taskTitle: title, documentKind: "note", format, markdown, html: prepared?.html || "" });
      if (result?.canceled) return;
      if (!result?.filePath) throw new Error("文件未导出，请重试。");
      if (button.isConnected) shellCloseOverlay();
      shellToast(incomplete ? "已导出，包含保留的源码或缺失资源说明" : "笔记已导出");
    } catch (failure) {
      if (error) { error.textContent = (failure?.message || "导出失败，请重试。").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""); error.hidden = false; }
    } finally {
      exporting = false; update();
    }
  });
}

function shellKnowledgeDialog(title, body, footer = "", width = 520) {
  const overlay = shellOverlay();
  overlay.innerHTML = `<div class="dialog-backdrop" data-return-focus="[data-action='knowledge-file-menu']">
    <section class="dialog knowledge-dialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-dialog-title" style="width:min(${width}px, calc(100vw - 48px))">
      <div class="dialog-head"><h2 id="knowledge-dialog-title">${esc(title)}</h2><button class="icon-button" type="button" data-action="close-dialog" aria-label="关闭">${shellIcon("close")}</button></div>
      ${body}
      ${footer ? `<footer>${footer}</footer>` : ""}
    </section>
  </div>`;
  const heading = document.querySelector("#knowledge-dialog-title");
  heading?.setAttribute("tabindex", "-1");
  heading?.focus();
}

function shellKnowledgeFileInfo(task) {
  const note = task.knowledgeNote || {};
  const rows = [
    ["文件路径", note.filePath || "尚未关联"],
    ["文档状态", SHELL_KNOWLEDGE_STATE_LABELS[note.documentState] || "草稿"],
    ["笔记标识", note.noteId || "—"],
    ["最近保存", note.updatedAt ? new Date(note.updatedAt).toLocaleString("zh-CN") : "—"],
    ["内容版本", note.lastSavedHash ? String(note.lastSavedHash).slice(0, 16) : "—"],
    ["表格列宽", Array.isArray(note.tableColumnWidths) && note.tableColumnWidths.length ? note.tableColumnWidths.join(" · ") : "默认"],
  ];
  shellKnowledgeDialog(
    "文件信息",
    `<div class="knowledge-file-info">${rows.map(([label, value]) => `<div class="knowledge-file-list"><span>${esc(label)}</span><span title="${escAttr(String(value))}">${esc(String(value))}</span></div>`).join("")}</div><p class="knowledge-dialog-copy">外部绑定的 Markdown 文件由 Loop 原子写入；附件图片保存在同一目录的 attachments 中，需要另行备份。</p>`,
    '<button class="button" type="button" data-action="close-dialog" autofocus>关闭</button>',
    520,
  );
  document.querySelector("#overlay [autofocus]")?.focus();
}

const shellKnowledgeConflictOperations = new Set();

async function shellRunKnowledgeConflictAction(data, operation) {
  const surface = shellOverlay()?.querySelector("[data-knowledge-conflict]");
  const task = state.tasks.find(item => item.id === data.taskId);
  const noteId = task?.knowledgeNote?.noteId;
  if (!surface || surface.dataset.taskId !== data.taskId || surface.dataset.noteId !== noteId) {
    const result = await operation();
    if (!result?.canceled) render();
    return result;
  }
  const status = surface.querySelector("[data-conflict-status]");
  const error = surface.querySelector("[data-conflict-error]");
  if (shellKnowledgeConflictOperations.has(noteId)) {
    error.textContent = "正在处理这篇笔记，请等待操作完成。";
    return { success: false, code: "CONFLICT_OPERATION_BUSY" };
  }
  shellKnowledgeConflictOperations.add(noteId);
  const buttons = [...surface.querySelectorAll("footer button[data-task-id]")];
  buttons.forEach(button => { button.disabled = true; });
  surface.setAttribute("aria-busy", "true");
  status.textContent = data.action === "reload-knowledge" ? "正在重新加载…" : "正在保存…";
  error.textContent = "";
  let result;
  try { result = await operation(); }
  catch (failure) { result = { success: false, message: failure?.message || "操作失败，请重试或另存为。" }; }
  finally {
    shellKnowledgeConflictOperations.delete(noteId);
    buttons.forEach(button => { button.disabled = false; });
    surface.removeAttribute("aria-busy");
    status.textContent = "";
  }
  // #overlay is independent of render(). A late receipt must never dismiss a
  // newer dialog, act on another note, or move focus away from that note.
  const ownsSurface = surface.isConnected && shellOverlay()?.querySelector("[data-knowledge-conflict]") === surface &&
    state.activeTaskId === task.id && state.taskPane === "notes" &&
    state.tasks.includes(task) && task.knowledgeNote.noteId === noteId;
  let closed = false;
  if (ownsSurface && result?.success === true && task.knowledgeNote.documentState !== "EXTERNAL_CHANGED") {
    shellCloseOverlay({ restoreFocus: false });
    closed = true;
  } else if (ownsSurface && !result?.canceled) {
    error.textContent = result?.success === true
      ? "文件再次发生变化，请核对最新内容并重新选择。"
      : result?.message || "操作未完成，当前草稿仍保留，请重试或另存为。";
    const previews = surface.querySelectorAll(".knowledge-version-grid pre");
    previews[0].textContent = String(task.notes || "").slice(0, 600);
    previews[1].textContent = String(knowledgeExternalSnapshots.get(noteId)?.content || "文件暂时不可用，请重试读取。").slice(0, 600);
  }
  if (!result?.canceled) render();
  if (closed && !shellOverlay()?.firstElementChild && state.activeTaskId === task.id && task.knowledgeNote.noteId === noteId) {
    const entry = typeof knowledgeCurrentEntry === "function" ? knowledgeCurrentEntry(task.id) : null;
    if (entry?.view?.dom?.isConnected && entry.mode !== "preview") entry.view.focus();
    else document.querySelector('[data-action="knowledge-file-menu"]')?.focus({ preventScroll: true });
  }
  return result;
}

function shellKnowledgeConflict(task) {
  const note = task.knowledgeNote || {};
  shellKnowledgeDialog(
    "文件与当前笔记有不同修改",
    `<p class="knowledge-dialog-copy">当前草稿仍保留。选择作用于整篇笔记。</p>
     <div class="knowledge-version-grid">
       <section><h3>当前编辑内容</h3><p>本页草稿</p><pre>${esc(String(task.notes || "").slice(0, 600))}</pre></section>
       <section><h3>磁盘上的文件</h3><p>${esc(note.filePath || "本地文件")}</p><pre>${esc(String(knowledgeExternalSnapshots.get(note.noteId)?.content || note.externalPreview || note.savedContent || "文件内容已变化，重新加载后可查看。").slice(0, 600))}</pre></section>
     </div>
     <p class="knowledge-dialog-copy" role="status" data-conflict-status></p>
     <p class="knowledge-dialog-copy" role="alert" data-conflict-error></p>`,
    `<button class="button" type="button" data-action="close-dialog" autofocus>取消</button>
     <button class="button" type="button" data-action="save-knowledge-as" data-task-id="${escAttr(task.id)}">另存为新文件</button>
     <button class="button" type="button" data-action="reload-knowledge" data-task-id="${escAttr(task.id)}">重新加载文件</button>
     <button class="button primary" type="button" data-action="save-knowledge-overwrite" data-task-id="${escAttr(task.id)}">仍然覆盖</button>`,
    560,
  );
  const surface = shellOverlay().querySelector(".knowledge-dialog");
  surface.dataset.knowledgeConflict = id("knowledge-conflict");
  surface.dataset.taskId = task.id;
  surface.dataset.noteId = note.noteId;
  document.querySelector("#overlay [autofocus]")?.focus();
}

// ------------------------------------------------------------
// Binding
// ------------------------------------------------------------

function shellKnowledgeSyncStats(task) {
  const pane = document.querySelector(".knowledge-pane[data-task-id]");
  if (!pane || pane.dataset.taskId !== String(task.id)) return;
  const stats = markdownStats(task.notes);
  const target = pane.querySelector("[data-note-stats]");
  if (target) target.textContent = `${stats.characters} 字 · ${stats.lines} 行`;
  const recovery = pane.querySelector("[data-note-recovery]");
  if (recovery) recovery.textContent = shellKnowledgeRecoveryText(task);
}

// ------------------------------------------------------------
// Formatting
//
// Ported from the Demo's formatKnowledge / formatKnowledgeSource /
// showKnowledgeLink (loop-knowledge-phase9-refinement.js:183-206). Two things
// matter here and were missing before:
//   1. the toolbar must not steal focus on mousedown, otherwise the editor
//      selection is gone before the command runs;
//   2. a command that cannot apply must say so instead of failing silently.
// ------------------------------------------------------------

function shellToast(message, record) {
  const link = record?.id
    ? `<button type="button" data-action="open-toast-record" data-task-id="${escAttr(record.id)}">查看任务${shellIcon("arrow")}</button>`
    : "";
  showWorkspaceFeedback(message, link);
}

function shellKnowledgeEditorEntry() {
  const entry = typeof milkdownEditors !== "undefined" ? milkdownEditors.get(noteDraftKey(state.activeTaskId, "")) : null;
  return entry?.instance || null;
}

function shellApplyNoteFormat(action, value) {
  if (window.LoopKnowledgeEditor && shellKnowledgeEditorEntry()?.view) return shellKnowledgeEditorEntry().format(action, value);
  if (shellKnowledgeMode() === "source") return shellFormatKnowledgeSource(action, value);
  const instance = shellKnowledgeEditorEntry();
  if (!instance?.format) return false;
  const applied = instance.format(action, value);
  if (!applied) shellToast("当前光标位置不能应用该格式，请选择正文段落。");
  shellRefreshNoteFormatState();
  return applied;
}

/** Markdown-mode formatter, ported from the Demo's formatKnowledgeSource. */
function shellFormatKnowledgeSource(action, value) {
  const input = document.querySelector("#knowledge-source");
  if (!input) return false;
  let start = input.selectionStart;
  let end = input.selectionEnd;
  const text = input.value.slice(start, end);
  let replacement = "";
  let selectFrom = 0;
  let selectTo = 0;
  const wraps = { bold: "**", italic: "*", strike: "~~", inline: "`" };
  if (wraps[action]) {
    const token = wraps[action];
    const body = text || "文字";
    const around = input.value.slice(start - token.length, start) === token
      && input.value.slice(end, end + token.length) === token
      && (action !== "italic" || (input.value[start - 2] !== "*" && input.value[end + 1] !== "*"));
    if (around) {
      start -= token.length;
      end += token.length;
      replacement = body;
      selectTo = body.length;
    } else {
      replacement = token + body + token;
      selectFrom = token.length;
      selectTo = selectFrom + body.length;
    }
  } else if (action === "link") {
    const body = text || value;
    replacement = `[${body}](${value})`;
    selectFrom = 1;
    selectTo = 1 + body.length;
  } else if (["heading", "bullet", "ordered", "task", "quote"].includes(action)) {
    start = input.value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const next = input.value.indexOf("\n", end);
    end = next < 0 ? input.value.length : next;
    replacement = input.value.slice(start, end).split("\n").map((line, index) => {
      const clean = line.replace(/^\s*(?:#{1,6}\s+|[-*]\s+(?:\[[ x]\]\s+)?|\d+\.\s+|>\s*)/, "");
      const prefix = action === "heading"
        ? "#".repeat(Number(value)) + (Number(value) ? " " : "")
        : action === "ordered" ? `${index + 1}. `
          : action === "task" ? "- [ ] "
            : action === "quote" ? "> " : "- ";
      return prefix + clean;
    }).join("\n");
    selectTo = replacement.length;
  } else {
    const blocks = {
      code: `\`\`\`text\n${text || "代码或命令"}\n\`\`\``,
      table: "| 项目 | 验证依据 |\n| --- | --- |\n| 待补充 | 待补充 |",
      rule: "---",
      image: value,
    };
    replacement = `\n\n${blocks[action] || ""}\n\n`;
    selectTo = replacement.length;
  }
  input.setRangeText(replacement, start, end, "end");
  input.focus();
  input.setSelectionRange(start + selectFrom, start + selectTo);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/** Link insertion asks for the URL first, like the Demo, and restores the selection. */
function shellKnowledgeLink(trigger) {
  const instance = shellKnowledgeEditorEntry();
  const source = document.querySelector("#knowledge-source");
  const selection = instance?.getSelection ? instance.getSelection() : null;
  const range = source ? { start: source.selectionStart, end: source.selectionEnd } : null;
  const surface = shellMountSurface(
    `<div class="surface-popover note-link-popover">${shellSurfaceHeader("添加链接")}
      <label for="note-link-url">链接地址</label>
      <input id="note-link-url" type="url" placeholder="https://" />
      <p class="knowledge-inline-error" id="note-link-error" role="alert"></p>
      <button class="button primary" type="button" id="note-link-apply">插入链接</button>
    </div>`,
    trigger,
    280,
  );
  const input = surface?.querySelector("#note-link-url");
  const error = surface?.querySelector("#note-link-error");
  input?.focus();
  const apply = () => {
    const url = input.value.trim();
    if (!/^(https?:\/\/|mailto:)/i.test(url) || /[\s<>[\]]/.test(url)) {
      error.textContent = "请输入有效的 https、http 或邮箱链接。";
      return;
    }
    shellCloseOverlay({ restoreFocus: false });
    if (selection && instance?.restoreSelection) instance.restoreSelection(selection);
    if (range && source) source.setSelectionRange(range.start, range.end);
    shellApplyNoteFormat("link", url);
  };
  surface?.querySelector("#note-link-apply")?.addEventListener("click", apply);
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    apply();
  });
}

function shellRefreshNoteFormatState() {
  const instance = shellKnowledgeEditorEntry();
  if (!instance?.getFormatState) return;
  const active = instance.getFormatState();
  document.querySelectorAll("[data-format]").forEach((button) => {
    const name = button.dataset.format;
    if (button.hasAttribute("aria-pressed")) button.setAttribute("aria-pressed", String(Boolean(active[name])));
    if (name === "undo" || name === "redo") button.disabled = !active[name];
  });
  const select = document.querySelector(".note-heading-select");
  if (select) select.value = active.heading || "0";
}

function shellBindKnowledge() {
  if (typeof document.addEventListener === "function" && !window.__loopKnowledgeKeysBound) {
    window.__loopKnowledgeKeysBound = true;
    // Without this the toolbar button steals focus and the editor selection is
    // already gone when the command runs (port of the Demo's line 226).
    document.addEventListener("mousedown", (event) => {
      if (event.target.closest?.(".knowledge-tool")) event.preventDefault();
    });
    document.addEventListener("keydown", (event) => {
      if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (state.taskPane !== "notes") return;
      if (shellOverlayIsOpen()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void saveKnowledgeTask(state.activeTaskId, { saveAs: event.shiftKey });
    }, true);
  }
  const source = document.querySelector("#knowledge-source");
  if (source && bindRenderElement(source, "knowledge-source")) {
    const task = state.tasks.find((item) => item.id === source.dataset.taskId);
    if (task) {
      source.addEventListener("input", () => {
        updateNodeNoteDraft(task.id, "", source.value);
        shellKnowledgeSyncStats({ ...task, notes: source.value });
      });
      source.addEventListener("keydown", (event) => {
        if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
        event.preventDefault();
        void saveKnowledgeTask(task.id, { saveAs: false });
      });
    }
  }
  const select = document.querySelector(".note-heading-select");
  if (bindRenderElement(select, "note-heading")) select.addEventListener("change", () => {
    shellApplyNoteFormat("heading", Number(select.value) || 0);
  });
  shellRefreshNoteFormatState();
}

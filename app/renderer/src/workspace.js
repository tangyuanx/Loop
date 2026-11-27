// ============================================================
// Loop -- task workspace (three-column layout, middle/right pane)
//
// Ported from the frozen Demo baseline:
//   prototypes/baseline/loop-plane-phase15-frozen/loop-plane-phase1.html
//   prototypes/baseline/loop-plane-phase15-frozen/loop-flow-phase11.js
//
// Data comes from the production model; only the presentation and the
// interaction vocabulary are the Demo's. Field mapping:
//   demo state.task/pane/node  -> state.activeTaskId / state.taskPane / state.selectedNodeId
//   demo task.done             -> task.status === "done"
//   demo task.group            -> shellGroupTitle(task.groupId)
//   demo task.progress         -> task.hypothesis
//   demo task.kind === quick   -> task.captureSource === "today-widget"
// ============================================================

const SHELL_PRIORITY_LABELS = { high: "高优先", medium: "中优先", low: "低优先" };
const SHELL_PRIORITY_FILTER_LABELS = { all: "全部优先级", high: "高优先", medium: "中优先", low: "低优先" };
const SHELL_DEADLINE_SCOPE_LABELS = { all: "全部截止", today: "今天截止", week: "本周截止", overdue: "逾期" };
let shellNodeRenameDraft = null;
let shellConclusionDraft = null;
let shellFlowSelectionOnly = false;
const shellExpandedConclusions = new Set();
const shellExpandedTitles = new Set();
let shellReviewOnly = false;
let shellConclusionObserver = null;
let shellConclusionObserved = null;
const SHELL_HIDE_COMPLETED_KEY = "loop-flow-hide-completed";
let shellHideCompletedNodes = false;
try { shellHideCompletedNodes = localStorage.getItem(SHELL_HIDE_COMPLETED_KEY) === "1"; } catch {}

function shellFlowNodeVisible(node) {
  return (!shellHideCompletedNodes || node.status !== "done") && (!shellReviewOnly || shellFlowHasReview(node));
}

function shellFlowHasReview(node) {
  return node.status === "review" || (node.children || []).some(shellFlowHasReview);
}

function shellFlowBranchVisible(node) {
  return shellFlowNodeVisible(node) || (node.children || []).some(shellFlowBranchVisible);
}

function shellActiveTask() {
  return state.tasks.find((task) => task.id === state.activeTaskId) || null;
}

function shellTaskDone(task) {
  return task?.status === "done";
}

function shellNodeList(task) {
  return flatten(task?.nodes || []);
}

function shellCountDoneNodes(task) {
  return shellNodeList(task).filter((node) => node.status === "done").length;
}

function shellDisplayDate(value) {
  const date = value instanceof Date ? value : safeDate(value);
  if (!date) return "";
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function shellTimeLabel(value) {
  const date = safeDate(value);
  if (!date) return "18:00";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function shellTodayReason(task) {
  if (normalizeTaskTags(task.tags).today) return "今日";
  const deadline = safeDate(task.deadlineAt);
  if (deadline && localDateKey(deadline) === loopTodayKey()) return "今日截止";
  if (isRecurringTaskDue(task)) return "今日循环";
  return "加入今日";
}

function shellDeadlineLabel(task) {
  const deadline = safeDate(task.deadlineAt);
  if (!deadline) return "设置截止时间";
  return `${shellDisplayDate(deadline)} ${shellTimeLabel(deadline)}`;
}

/**
 * Phase18 (frozen Demo loop-time-phase18.js): temporal information stays in the
 * existing property row — a neutral date, a restrained orange state when the
 * deadline is within the hour or already past, and never a task-row tag.
 */
function shellDeadlineProperty(task) {
  const deadline = safeDate(task.deadlineAt);
  if (!deadline) return { classes: "", text: "设置截止时间", title: "设置截止时间" };
  const done = shellTaskDone(task);
  const minutes = Math.round((deadline.getTime() - loopNow().getTime()) / 60000);
  const near = !done && minutes >= 0 && minutes <= 60;
  const late = !done && minutes < 0;
  const time = shellTimeLabel(deadline);
  const sameDay = localDateKey(deadline) === loopTodayKey();
  let text = `${sameDay ? "今天" : shellDisplayDate(deadline)} ${time}`;
  if (near) text = `${minutes ? `还剩 ${minutes} 分钟` : "即将截止"} · ${time}`;
  if (late) {
    const overdueMinutes = -minutes;
    const span = overdueMinutes < 60
      ? `${overdueMinutes} 分钟`
      : overdueMinutes < 1440
        ? `${Math.floor(overdueMinutes / 60)} 小时`
        : `${Math.floor(overdueMinutes / 1440)} 天`;
    text = `逾期 ${span} · ${sameDay ? time : shellDisplayDate(deadline)}`;
  }
  const reminder = task.deadlineReminderMinutes === null || task.deadlineReminderMinutes === undefined
    ? deadlineReminderLabels.none
    : deadlineReminderLabels[task.deadlineReminderMinutes] || `提前 ${task.deadlineReminderMinutes} 分钟提醒`;
  return {
    classes: [late ? "overdue" : "", near ? "time18-soon" : ""].filter(Boolean).join(" "),
    text,
    title: `${localDateKey(deadline)} ${time} · ${reminder}`,
  };
}

function shellRecurrenceLabel(recurrence) {
  const value = normalizeTaskRecurrence(recurrence);
  if (value.frequency === "none") return "不循环";
  const weekly = `每周${[1, 2, 3, 4, 5, 6, 0].filter((day) => value.weekdays.includes(day)).map((day) => SHELL_WEEKDAY_NAMES[day].slice(1)).join("、")}`;
  const base = value.frequency === "daily" ? "每天" : weekly;
  return `${base} · ${value.time || "09:00"}`;
}

// ------------------------------------------------------------
// Heading, properties, brief
// ------------------------------------------------------------

function renderShellTaskTitle(task) {
  const note = shellTaskIsNote(task);
  return `<h1 class="task-title"><button class="title-edit" type="button" data-action="edit-task-title" aria-label="编辑${note ? "速记" : "任务"}标题" title="${escAttr(task.title || "未命名任务")}"><span>${esc(task.title || "未命名任务")}</span>${shellIcon("edit")}</button></h1>`;
}

function renderShellTaskProperties(task, { all = false } = {}) {
  const showContext = all || shellRoute() !== "today";
  const tags = normalizeTaskTags(task.tags);
  const deadlineProperty = shellDeadlineProperty(task);
  return `<div class="task-properties">
    ${showContext ? `<button class="badge ${isTaskScheduledForToday(task) ? "green" : ""}" type="button" data-action="toggle-task-tag" data-tag="today" data-task-id="${escAttr(task.id)}" aria-pressed="${tags.today}">${esc(shellTodayReason(task))}</button>
    <button class="property" type="button" data-action="toggle-task-priority-menu" data-task-id="${escAttr(task.id)}" aria-label="修改任务优先级">${shellIcon("flag")}${SHELL_PRIORITY_LABELS[normalizePriority(task.priority)]}${shellIcon("down")}</button>` : ""}
    <button class="property ${deadlineProperty.classes}" type="button" data-action="toggle-deadline-picker" data-task-id="${escAttr(task.id)}" aria-haspopup="dialog" title="${escAttr(deadlineProperty.title)}">${shellIcon("calendar")}${esc(deadlineProperty.text)}${shellIcon("down")}</button>
    <button class="property" type="button" data-action="open-task-recurrence" aria-haspopup="dialog">${shellIcon("repeat")}${esc(shellRecurrenceLabel(task.recurrence))}${shellIcon("down")}</button>
  </div>`;
}

function shellBriefFields(task) {
  return [
    ["description", "背景", "补充背景"],
    ["hypothesis", "进展", "写下进展"],
    ["conclusion", "结论", "写下结论"],
  ].map(([field, label, placeholder]) => ({ field, label, placeholder, value: String(task[field] || "") }));
}

function renderShellBrief(task) {
  return `<section class="brief" aria-label="任务简报">${shellBriefFields(task).map(({ field, label, placeholder, value }) => {
    const key = `${task.id}:${field}`;
    const editing = Object.hasOwn(state.shellDrafts, key);
    return `<div class="brief-row">
      <label id="label-${field}" ${editing ? `for="draft-${field}"` : ""}>${label}</label>
      ${editing
        ? `<div class="brief-editing"><textarea class="brief-editor" id="draft-${field}" data-shell-draft="${escAttr(key)}" aria-labelledby="label-${field}" placeholder="${placeholder}">${esc(state.shellDrafts[key])}</textarea>${renderShellEditActions(key)}</div>`
        : `<button class="brief-value ${value ? "" : "muted"}" type="button" data-action="shell-edit-brief" data-field="${field}" data-task-id="${escAttr(task.id)}" aria-label="编辑${label}" title="点击编辑${label}">${esc(value || placeholder)}</button><button class="brief-edit" type="button" data-action="shell-edit-brief" data-field="${field}" data-task-id="${escAttr(task.id)}" aria-label="编辑${label}" title="编辑${label}">${shellIcon("edit")}</button>`}
    </div>`;
  }).join("")}</section>`;
}

function renderShellEditActions(key) {
  return `<div class="edit-actions"><button class="button" type="button" data-action="shell-cancel-draft" data-key="${escAttr(key)}">取消</button><button class="button primary" type="button" data-action="shell-save-draft" data-key="${escAttr(key)}">保存</button></div>`;
}

// ------------------------------------------------------------
// Tabs and flow
// ------------------------------------------------------------

function renderShellTabs(task, flowToolbar = "") {
  const nodes = shellNodeList(task);
  const total = nodes.length;
  const doneCount = shellCountDoneNodes(task);
  const noteCount = (state.knowledgeWorkspace.tabsByTask[task.id] || []).filter((id) => {
    const note = knowledgeFindDocument(id);
    return note && !note.knowledgeNote?.isDeleted;
  }).length;
  const historyCount = Array.isArray(task.history) ? task.history.length : 0;
  const panes = [
    ["flow", "处理流", total ? `${doneCount}/${total}` : "0"],
    ["notes", "知识笔记", noteCount ? String(noteCount) : ""],
    ["history", "处理历史", historyCount ? String(historyCount) : ""],
  ];
  return `<div class="tabs-bar">
    <nav class="pane-tabs" aria-label="任务内容">
      ${panes.map(([pane, label, count]) => `<button class="pane-tab ${state.taskPane === pane ? "active" : ""}" type="button" data-action="switch-task-pane" data-pane="${pane}" aria-pressed="${state.taskPane === pane}">${label}${count ? `<span class="pane-count">${count}</span>` : ""}</button>`).join("")}
    </nav>
    ${flowToolbar}
  </div>`;
}

function shellNodeStatusLabel(status) {
  return SHELL_NODE_STATUS_LABELS[status] || '未完成';
}

function shellNodeStatusStyle(status) {
  const custom = state.nodeStates.find(item => item.id === status);
  const color = custom?.color || (status === "done" ? "#378252" : "#747d88");
  return `style="--node-status-color:${escAttr(color)}"`;
}

function shellNodeStatusChip(status) {
  return `<span class="node-status-chip" ${shellNodeStatusStyle(status)}>${esc(shellNodeStatusLabel(status))}</span>`;
}

function shellNodeStatusButtonLabel(node) {
  return `${node.title}：${shellNodeStatusLabel(node.status)}，切换为${shellNodeStatusLabel(nextNodeStatus(node.status))}`;
}

// Keep the first levels distinct, then use shorter steps without changing the
// actual tree depth. Cap visual offset at depth 8 so very deep trees never crush text.
function shellFlowIndentStyle(depth) {
  const offset = level => `calc(${Math.min(level, 4)} * var(--flow-indent) + ${Math.min(Math.max(0, level - 4), 4)} * var(--flow-deep-indent))`;
  return `--node-depth:${depth};--node-offset:${offset(depth)};--node-parent-offset:${offset(Math.max(0, depth - 1))};--node-step:var(${depth > 4 ? '--flow-deep-indent' : '--flow-indent'})`;
}

function shellFormatNodePath(path) {
  const text = String(path || "");
  if (text.length <= 5) return text;
  const parts = text.split(".");
  if (parts.length <= 2) return text;
  return `…${parts.slice(-2).join(".")}`;
}

function renderShellNodeDraft(task, depth = 0) {
  const parentId = state.focusNodeTitleId ? shellParentIdOf(task, state.focusNodeTitleId) : null;
  return `<li class="flow-item node-draft" style="${shellFlowIndentStyle(depth)}"><div class="flow-row adding"><div class="flow-node-main"><span class="draft-spacer"></span><span class="node-status-slot"><span class="node-status todo" role="img" aria-label="未完成">${briefFieldIcon('circle')}</span></span><textarea class="node-title-input" id="node-title-draft" rows="1" aria-label="${parentId ? "子节点标题" : "节点标题"}" placeholder="输入节点标题" maxlength="160" autocomplete="off" data-shell-node-draft="1" data-node-id="${escAttr(state.focusNodeTitleId)}">${esc(shellNodeTitle(task,state.focusNodeTitleId))}</textarea></div></div></li>`;
}

function shellNodeTitle(task, nodeId) {
  return shellNodeList(task).find((node) => node.id === nodeId)?.title || "";
}

function shellParentIdOf(task, nodeId) {
  return shellNodeList(task).find((node) => node.id === nodeId)?.parentId || null;
}

function shellIsDraftNode(task, node) {
  return state.focusNodeTitleId === node.id;
}

function renderShellNodeTitle(task, node, selected = node.id === state.selectedNodeId) {
  if (shellNodeRenameDraft?.taskId === task.id && shellNodeRenameDraft.nodeId === node.id) {
    return `<textarea class="node-title-input node-title-rename" data-shell-node-rename="1" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(node.id)}" rows="1" aria-label="修改节点标题" maxlength="160" autocomplete="off">${esc(shellNodeRenameDraft.value)}</textarea>`;
  }
  return `<button class="node-title" type="button" data-action="select-flow-node" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(node.id)}" title="${escAttr(node.title)}" aria-pressed="${selected}">${esc(node.title)}</button>`;
}

function shellConclusionKey(taskId, nodeId) {
  return JSON.stringify([taskId, nodeId]);
}

function shellNodeConclusionValue(node) {
  const conclusion = String(node.conclusion || ""), note = String(node.note || "");
  if (!conclusion.trim()) return note;
  if (!note.trim() || conclusion.includes(note)) return conclusion;
  return note.includes(conclusion) ? note : `${conclusion}\n\n${note}`;
}

function shellToggleCompletedReading(taskId, nodeId, field) {
  const node = findNode(state.tasks.find(task => task.id === taskId)?.nodes || [], nodeId);
  if (node?.status !== "done") return;
  const expanded = field === "title" ? shellExpandedTitles : shellExpandedConclusions;
  const key = shellConclusionKey(taskId, nodeId);
  if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
  document.querySelector(`.flow-row[data-node-id="${CSS.escape(nodeId)}"]`)?.classList.toggle(`expanded-${field}`, expanded.has(key));
}

function renderShellNodeConclusion(task, node) {
  const attrs = `data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(node.id)}"`;
  const draft = shellConclusionDraft;
  if (draft?.taskId === task.id && draft.nodeId === node.id) {
    return `<div class="flow-conclusion editing" data-conclusion-node="${escAttr(node.id)}"><textarea class="node-conclusion-editor" data-shell-node-conclusion ${attrs} rows="1" placeholder="支持 Markdown（文字、代码块、表格等）" aria-label="节点结论：${escAttr(node.title)}">${esc(draft.value)}</textarea></div>`;
  }
  const value = shellNodeConclusionValue(node);
  const expanded = shellExpandedConclusions.has(shellConclusionKey(task.id, node.id));
  if (!value.trim()) return `<div class="flow-conclusion is-empty" data-conclusion-node="${escAttr(node.id)}"></div>`;
  const rendered = typeof renderMarkdown === "function" ? renderMarkdown(value, task) : esc(value);
  return `<div class="flow-conclusion ${expanded ? "expanded" : ""}" data-conclusion-node="${escAttr(node.id)}">
    <button class="node-conclusion-text" type="button" data-action="read-node-conclusion" ${attrs} aria-label="结论：${escAttr(node.title)}，双击编辑" title="${escAttr(value)}"><span class="node-conclusion-preview md-concl">${rendered}</span></button>
  </div>`;
}

function shellSyncConclusionLayout() {
  document.querySelectorAll(".flow-conclusion:not(.editing)").forEach(cell => {
    const preview = cell.querySelector(".node-conclusion-preview");
    const toggle = cell.querySelector(".conclusion-expand");
    if (preview && toggle) toggle.hidden = !cell.classList.contains("expanded") && preview.scrollHeight <= preview.clientHeight + 1;
  });
  const editor = document.querySelector("[data-shell-node-conclusion]");
  if (editor) {
    editor.style.overflowY = "hidden";
    editor.style.height = "auto";
    const height = editor.value ? editor.scrollHeight : parseFloat(getComputedStyle(editor).lineHeight) || 22;
    const style = getComputedStyle(editor);
    editor.style.height = `${Math.max(22, Math.ceil(height + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)))}px`;
  }
}

function renderShellFlowNode(task, node, depth = 0, path = "") {
  if (!shellFlowNodeVisible(node)) {
    // Keep the actual indentation and ancestry; a completed parent's collapse
    // state must never conceal unfinished descendants while its row is hidden.
    const nested = sort(node.children || []).map((child, idx) => renderShellFlowNode(task, child, depth + 1, path ? `${path}.${idx + 1}` : String(idx + 1))).join("");
    return nested ? `<li class="flow-item flow-hidden-parent" style="${shellFlowIndentStyle(depth)}"><ol class="flow-children">${nested}</ol></li>` : "";
  }
  if (shellIsDraftNode(task, node)) {
    const children = node.children || [];
    const inner = children.length && !node.collapsed ? `<ol class="flow-children">${children.map((child, idx) => renderShellFlowNode(task, child, depth + 1, path ? `${path}.${idx + 1}` : String(idx + 1))).join("")}</ol>` : "";
    return `${renderShellNodeDraft(task, depth)}${inner}`;
  }
  const children = sort(node.children || []).filter(shellFlowBranchVisible);
  const adding = false;
  const hasChildren = children.length > 0 || adding;
  const selected = node.id === state.selectedNodeId;
  const key = shellConclusionKey(task.id, node.id);
  const displayCollapsed = node.collapsed && !shellReviewOnly;
  const customState = state.nodeStates.find((item) => item.id === node.status);
  const statusClass = customState ? `${node.status} custom-status` : node.status;
  const statusStyle = customState ? ` style="--node-custom-color:${escAttr(customState.color)}"` : "";
  const statusTag = node.status === "review"
    ? '<span class="node-status-tag is-review" aria-hidden="true">待确认</span>'
    : customState
      ? `<span class="node-status-tag is-custom" style="--node-custom-color:${escAttr(customState.color)}" aria-hidden="true">${esc(customState.name)}</span>`
      : "";
  const collapsedSummary = displayCollapsed && hasChildren
    ? (() => {
        const sub = flatten(node.children || []);
        const subDone = sub.filter((item) => item.status === "done").length;
        return `<span class="node-collapsed-count" aria-hidden="true">${subDone}/${sub.length}</span>`;
      })()
    : "";
  const gutterText = shellFormatNodePath(path);
  const gutterCompact = gutterText !== path;
  const body = `<div class="flow-row ${statusClass} ${hasChildren ? "is-parent" : ""} ${selected ? "selected" : ""} ${shellExpandedTitles.has(key) ? "expanded-title" : ""} ${shellExpandedConclusions.has(key) ? "expanded-summary" : ""}" data-context="node" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(node.id)}" data-flow-drag-source data-flow-drag-target>
    <div class="flow-node-main">
      <span class="node-gutter${gutterCompact ? " is-compact" : ""}"${gutterCompact ? ` title="层级 ${escAttr(path)}"` : ""} aria-hidden="true">${esc(gutterText)}</span>
      <span class="flow-grip" title="拖动调整节点位置" aria-hidden="true">${shellIcon("grip")}</span>
      <button class="collapse ${hasChildren ? "" : "empty"}" type="button" data-action="toggle-node-collapse" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(node.id)}" aria-label="${displayCollapsed ? "展开" : "收起"} ${escAttr(node.title)}" aria-expanded="${!displayCollapsed}" ${hasChildren && !shellReviewOnly ? "" : "disabled"}>${shellIcon(displayCollapsed ? "chevron" : "down")}</button>
      <span class="node-status-slot"><button class="node-status ${statusClass}"${statusStyle} type="button" data-action="cycle-node-status" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(node.id)}" title="${escAttr(shellNodeStatusLabel(node.status))} · 点击切换为${escAttr(shellNodeStatusLabel(nextNodeStatus(node.status)))}" aria-label="${escAttr(shellNodeStatusButtonLabel(node))}"><span class="st-dot" aria-hidden="true">${node.status === "done" ? shellIcon("check") : ""}</span></button></span>
      ${renderShellNodeTitle(task, node, selected)}
      ${collapsedSummary}${statusTag}
      <div class="flow-row-actions">
        <button class="icon-button" type="button" data-action="edit-node-conclusion" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(node.id)}" aria-label="编辑结论" title="编辑结论">${shellIcon("note")}</button>
        <button class="icon-button" type="button" data-action="add-child-node" data-task-id="${escAttr(task.id)}" data-node-id="${escAttr(node.id)}" aria-label="新增下级节点" title="新增下级节点">${shellIcon("indent")}</button>
        <button class="icon-button" type="button" data-action="open-node-operations" data-node-id="${escAttr(node.id)}" aria-label="节点操作" title="节点操作" aria-haspopup="menu">${shellIcon("more")}</button>
      </div>
    </div>
    ${renderShellNodeConclusion(task, node)}
    </div>`;
  const keepChildren = !displayCollapsed || shellFlowClosing.has(node.id);
  const nested = hasChildren
    ? `<div class="flow-branch" data-branch-node="${escAttr(node.id)}" data-expanded="${!displayCollapsed}" ${displayCollapsed ? 'inert aria-hidden="true"' : ""}>${keepChildren ? `<ol class="flow-children">${children.map((child, idx) => renderShellFlowNode(task, child, depth + 1, path ? `${path}.${idx + 1}` : String(idx + 1))).join("")}</ol>` : ""}</div>`
    : "";
  return `<li class="flow-item" data-flow-id="${escAttr(node.id)}" data-flow-depth="${depth}" style="${shellFlowIndentStyle(depth)}">${body}${nested}</li>`;
}

function shellFlowDepth(nodes) {
  return Math.max(0, ...nodes.filter(shellFlowBranchVisible).map((node) =>
    node.children?.length && (!node.collapsed || shellReviewOnly || !shellFlowNodeVisible(node)) ? 1 + shellFlowDepth(node.children) : 0));
}

function renderShellFlow(task) {
  const list = shellNodeList(task);
  const filters = [shellReviewOnly && "仅待确认", shellHideCompletedNodes && "隐藏已完成"].filter(Boolean);
  const optionsLabel = filters.length ? `处理流选项（${filters.join("、")}）` : "处理流选项";
  // The first draft is a temporary node. Keep the empty entry mounted beneath
  // it so cancelling a blank draft in place can reveal the same entry again.
  const empty = !list.length || (list.length === 1 && list[0].id === state.focusNodeTitleId);
  const selected = list.find((node) => node.id === state.selectedNodeId);
  const roots = sort(task.nodes || []);
  const doneCount = shellCountDoneNodes(task);
  const ratio = list.length ? Math.round((doneCount / list.length) * 100) : 0;
  const addButton = `<button class="add-node" type="button" data-action="add-root-node" data-task-id="${escAttr(task.id)}"${empty ? ' aria-describedby="flow-start-hint"' : ""}>${shellIcon("plus")}${empty ? "添加第一个节点" : "添加节点"}</button>`;
  const maxDepth = shellFlowDepth(task.nodes || []);
  const branches = list.filter((node) => node.children?.length && node.id !== state.focusNodeTitleId);
  const toolbar = `<div class="flow-toolbar">
      <span class="flow-progress"><span class="flow-progress-meter" aria-hidden="true"><i style="width:${ratio}%"></i></span>${doneCount} / ${list.length} 已完成</span>
      <div class="flow-context-bar" hidden>
        ${shellIcon("flowPath", "flow-path-icon")}
        <nav class="flow-breadcrumb" aria-label="当前节点层级" data-flow-breadcrumb></nav>
      </div>
      <div class="flow-tools">
        <button class="icon-button" type="button" data-action="open-flow-locator" aria-label="定位处理流节点" title="定位节点" aria-haspopup="dialog">${shellIcon("search")}</button>
        <button class="icon-button flow-options-trigger" type="button" data-action="open-flow-options" aria-haspopup="dialog" aria-expanded="false" aria-label="${escAttr(optionsLabel)}" title="${escAttr(optionsLabel)}" ${filters.length ? 'data-filter-active' : ''}>${shellIcon("filter")}</button>
        <button class="icon-button" type="button" data-action="set-all-nodes-collapsed" data-value="false" aria-label="展开全部" title="展开全部" ${branches.some(node => node.collapsed) && !shellReviewOnly ? "" : "disabled"}>${shellIcon("expandBranches")}</button>
        <button class="icon-button" type="button" data-action="set-all-nodes-collapsed" data-value="true" aria-label="折叠全部" title="折叠全部" ${branches.some(node => !node.collapsed) && !shellReviewOnly ? "" : "disabled"}>${shellIcon("collapseBranches")}</button>
        <button class="icon-button flow-toolbar-add" type="button" data-action="add-root-node" data-task-id="${escAttr(task.id)}" aria-label="新增节点" title="新增节点">${shellIcon("plus")}<span>节点</span></button>
      </div>
    </div>`;
  const content = `<section class="flow-pane${empty ? " flow-empty" : ""}" aria-label="层级处理流">
    <div class="flow-scroll" data-context="flow-root" data-task-id="${escAttr(task.id)}" data-processing-flow-scroll data-processing-flow-view="${escAttr(processingFlowViewKey(task))}">
      <div class="flow-outline${maxDepth === 0 ? " flow-flat" : ""}" style="--flow-depth:${maxDepth};${shellFlowIndentStyle(maxDepth)};--flow-title-track:${state.flowWidths.title}fr;--flow-note-track:${state.flowWidths.note}fr">
      <ol class="flow-tree">
        ${roots.map((node, idx) => renderShellFlowNode(task, node, 0, String(idx + 1))).join("")}
      </ol>
      ${!empty && shellReviewOnly && !list.some(node => node.status === "review") ? '<p class="flow-filter-empty" role="status">没有待确认的节点</p>' : ""}
      ${empty ? `<div class="flow-start">${addButton}<p id="flow-start-hint">用节点把任务拆成具体步骤。</p></div>` : ""}
      ${!shellReviewOnly && shellHideCompletedNodes && list.length && list.every((node) => !shellFlowNodeVisible(node)) ? '<p class="flow-filter-empty" role="status">所有节点均已完成，已隐藏</p>' : ""}
      ${empty ? "" : addButton}
      </div>
    </div>
    </section>`;
  return { toolbar, content };
}

// ------------------------------------------------------------
// Node record window
// ------------------------------------------------------------

function shellNodePath(task, nodeId) {
  const walk = (nodes, trail) => {
    for (const node of nodes || []) {
      const next = [...trail, node];
      if (node.id === nodeId) return next;
      const hit = walk(node.children, next);
      if (hit.length) return hit;
    }
    return [];
  };
  return walk(task.nodes || [], []);
}

function renderShellRecord(note) {
  if (!String(note || "").trim()) return '<p class="record-empty">记录你的判断、验证方法和结果，方便下次继续。</p>';
  return String(note).split(/\n\s*\n/).map((part) => {
    const lines = part.split("\n");
    if (lines.length > 1 && lines[0].length <= 10) {
      const heading = lines.shift();
      return `<h3>${esc(heading)}</h3><p>${esc(lines.join("\n"))}</p>`;
    }
    return `<p>${esc(part)}</p>`;
  }).join("");
}

function renderShellNodeRecord(task, node) {
  const record = nodeNoteDrafts.get(noteDraftKey(task.id, node.id))?.markdown ?? node.note ?? "";
  const updatedAt = node.updatedAt || node.createdAt;
  const status = node.status;
  return `<section class="node-record-window" role="dialog" aria-modal="false" aria-labelledby="node-record-window-title" data-node-id="${escAttr(node.id)}">
    <header class="node-record-window-head" data-record-window-handle>
      <h2 id="node-record-window-title" title="${escAttr(node.title || "未命名节点")}">${esc(node.title || "未命名节点")}</h2>
      <button class="icon-button node-record-window-close" type="button" data-action="close-node-detail" aria-label="关闭节点记录" title="关闭">${briefFieldIcon("x")}</button>
    </header>
    <textarea class="record-editor" id="record-draft" data-shell-node-record="${escAttr(node.id)}" aria-label="处理记录：${escAttr(node.title)}">${esc(record)}</textarea>
    <footer class="node-record-window-foot">
      <div class="node-record-window-meta"><span class="node-record-window-status ${status}"><i aria-hidden="true"></i>${esc(shellNodeStatusLabel(status))}</span><span aria-hidden="true">·</span><time data-record-updated-at datetime="${escAttr(updatedAt || "")}">${esc(shellNodeRecordTime(updatedAt))}</time></div>
      <span data-record-count>${Array.from(record).length} 字</span>
    </footer>
    ${["n", "e", "s", "w", "ne", "nw", "sw"].map(edge => `<span class="node-record-window-resize" data-record-window-resize="${edge}" aria-hidden="true"></span>`).join("")}
    <button class="node-record-window-resize" data-record-window-resize="se" type="button" aria-label="调整浮窗大小" title="拖动调整大小，或使用方向键"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 12l6-6M10 12l2-2"/></svg></button>
  </section>`;
}

function shellNodeRecordTime(value) {
  if (!safeDate(value)) return "";
  return `${isToday(value) ? "今天" : shellDisplayDate(value)} ${shellTimeLabel(value)}`;
}

function shellSyncNodeRecordMeta(editor, updatedAt) {
  const panel = editor.closest(".node-record-window");
  const count = panel?.querySelector("[data-record-count]");
  if (count) count.textContent = `${Array.from(editor.value).length} 字`;
  const time = panel?.querySelector("[data-record-updated-at]");
  if (time && updatedAt) {
    time.dateTime = updatedAt;
    time.textContent = shellNodeRecordTime(updatedAt);
  }
}

// ------------------------------------------------------------
// Post-render flow behaviour
//
// Ported from loop-flow-phase11.js: expand the ancestors of a newly selected
// node before rendering, then restore the Demo's drawer/reading classes,
// keyboard focus and scroll position afterwards.
// ------------------------------------------------------------

let shellFlowFocus = null;
let shellLastFlowTaskId = null;
let shellLastFlowNodeId = null;
let shellRecordCursor = null;
const shellRecordEditors = new Map();
const shellRecordModels = new WeakMap();

// Grid transitions share continuity28's render boundary. Closed trees are
// pruned normally; only a small, outgoing branch lives for the 200ms exit.
const shellFlowClosing = new Set();
const shellBranchAnimations = new Set();
const SHELL_BRANCH_ANIMATION_LIMIT = 160;

function shellCancelBranchMotion() {
  for (const animation of shellBranchAnimations) {
    const branch = animation.effect?.target;
    animation.cancel();
    if (branch?.dataset.expanded === "false") branch.replaceChildren();
  }
  shellBranchAnimations.clear();
  shellFlowClosing.clear();
}

function shellCaptureBranches(animate) {
  const previous = new Map();
  const task = shellActiveTask();
  const sameTask = document.querySelector(".workspace")?.dataset.taskId === task?.id && state.taskPane === "flow";
  const nodes = new Map(sameTask ? shellNodeList(task).map(node => [node.id, node]) : []);
  for (const branch of document.querySelectorAll(".flow-branch")) {
    const id = branch.dataset.branchNode, node = nodes.get(id);
    if (!node) continue;
    const expanded = branch.dataset.expanded === "true";
    if (expanded === !node.collapsed && !branch.getAnimations().length) continue;
    const rows = branch.querySelectorAll(".flow-row").length;
    const fullHeight = branch.firstElementChild?.scrollHeight || 0;
    const fraction = fullHeight ? Math.min(1, branch.getBoundingClientRect().height / fullHeight) : 0;
    previous.set(id, { expanded, rows, fraction });
    if (node.collapsed && branch.contains(document.activeElement)) {
      document.querySelector(`.collapse[data-node-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    }
  }
  shellCancelBranchMotion();
  if (animate) for (const [id, before] of previous) {
    if (nodes.get(id)?.collapsed && before.rows > 0 && before.rows <= SHELL_BRANCH_ANIMATION_LIMIT) shellFlowClosing.add(id);
  }
  return previous;
}

function shellAnimateBranches(previous, animate) {
  shellFlowClosing.clear();
  if (!animate || !previous.size) return;
  for (const branch of document.querySelectorAll(".flow-branch")) {
    const before = previous.get(branch.dataset.branchNode);
    // A draft inside a reopening branch must have stable layout before the
    // first keystroke, including when Chromium inserts text through an IME.
    if (!before || branch.querySelector("[data-shell-node-draft]")) continue;
    const expanded = branch.dataset.expanded === "true";
    const rows = branch.querySelectorAll(".flow-row").length;
    if (Math.max(before.rows, rows) > SHELL_BRANCH_ANIMATION_LIMIT || !rows) continue;
    const animation = branch.animate({ gridTemplateRows: [`${before.fraction}fr`, expanded ? "1fr" : "0fr"] },
      { duration: 200, easing: "cubic-bezier(.215,.61,.355,1)" });
    shellBranchAnimations.add(animation);
    const clean = () => {
      if (!shellBranchAnimations.delete(animation)) return;
      if (branch.dataset.expanded === "false") branch.replaceChildren();
    };
    animation.finished.then(clean, clean);
  }
}

const SHELL_FOCUS_KEYS = ["data-node-id", "data-action", "data-bulk-action", "data-field", "data-flow-nav-id", "data-flow-nav-overflow"];
const SHELL_REPOSITORY_FOCUS_KEYS = [...SHELL_FOCUS_KEYS, "data-group-id", "data-task-id", "data-bulk-id", "data-value", "data-tag", "data-setting-button"];

function shellBeforeRender() {
  const task = shellActiveTask();
  if (state.focusNodeTitleId) {
    const owner = state.tasks.find(item => findNode(item.nodes, state.focusNodeTitleId));
    const draft = owner && findNode(owner.nodes, state.focusNodeTitleId);
    if (!draft) state.focusNodeTitleId = "";
    else if (owner.id !== task?.id || state.taskPane !== "flow") {
      if (!draft.title.trim() && !draft.children.length) owner.nodes = removeNode(owner.nodes, draft.id);
      else draft.title = draft.title.trim();
      state.focusNodeTitleId = "";
      save();
    }
  }
  if (shellConclusionDraft) {
    const draftNode = task?.id === shellConclusionDraft.taskId && findNode(task.nodes, shellConclusionDraft.nodeId);
    if (!draftNode || state.taskPane !== "flow" || !shellFlowNodeVisible(draftNode)) shellFinishNodeConclusionEdit(true);
    else {
      shellConclusionDraft.rendering = true;
      const editor = shellConclusionDraft.editor;
      shellConclusionDraft.cursor = editor && document.activeElement === editor
        ? { start: editor.selectionStart, end: editor.selectionEnd, direction: editor.selectionDirection, top: editor.scrollTop } : null;
    }
  }
  if (task && shellHideCompletedNodes && shellNodeList(task).some((node) => node.id === state.selectedNodeId && !shellFlowNodeVisible(node))) {
    flushNodeNoteDrafts?.({ persist: true });
    state.selectedNodeId = "";
    state.nodeDetailFullscreen = false;
  }
  if (shellNodeRenameDraft && (shellNodeRenameDraft.taskId !== task?.id || state.taskPane !== "flow")) {
    shellFinishNodeTitleEdit(true);
  }
  if (shellNodeRenameDraft) shellNodeRenameDraft.rendering = true;
  const changed = task?.id !== shellLastFlowTaskId || state.selectedNodeId !== shellLastFlowNodeId;
  if (task && state.selectedNodeId && changed) {
    shellNodePath(task, state.selectedNodeId).slice(0, -1).forEach((node) => { node.collapsed = false; });
  }
  shellFlowFocus = null;
  const active = document.activeElement;
  const mountedRecord = document.querySelector("[data-shell-node-record]");
  if (mountedRecord) {
    const key = `${mountedRecord.closest(".workspace")?.dataset.taskId}:${mountedRecord.dataset.shellNodeRecord}`;
    shellRecordEditors.delete(key);
    shellRecordEditors.set(key, { editor: mountedRecord, node: shellRecordModels.get(mountedRecord) });
    while (shellRecordEditors.size > 24) shellRecordEditors.delete(shellRecordEditors.keys().next().value);
  }
  shellRecordCursor = active?.matches?.("[data-shell-node-record]")
    ? { node: active.dataset.shellNodeRecord, task: active.closest(".workspace")?.dataset.taskId,
      start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection, top: active.scrollTop } : null;
  if (active && document.querySelector("#root")?.contains(active)) {
    const repository = Boolean(active.closest?.(".navigation, .task-list-pane"));
    const keys = repository ? SHELL_REPOSITORY_FOCUS_KEYS : [...SHELL_FOCUS_KEYS, "data-pane", "data-task-id", "data-key"];
    const identity = keys.filter((key) => active.hasAttribute(key))
      .map((key) => `[${key}="${CSS.escape(active.getAttribute(key))}"]`).join("");
    // Repeated actions (group navigation, status tabs, bulk checkboxes) need
    // their object/value identity as well as the shared action name.
    if (identity) shellFlowFocus = `${active.tagName.toLowerCase()}${repository && active.classList.contains("task-select") ? ".task-select" : ""}${!repository && active.classList.contains("node-title") ? ".node-title" : ""}${identity}`;
  }
}

function shellLayoutRecordWindow(position = state.nodeDetailPosition) {
  const panel = document.querySelector(".node-record-window");
  if (!panel?.offsetWidth || !panel.offsetHeight) return;
  const margin = 16;
  const size = state.nodeDetailSize;
  panel.style.width = size ? `${Math.min(size.width, innerWidth - margin * 2)}px` : "";
  panel.style.height = size ? `${Math.min(size.height, innerHeight - margin * 2)}px` : "";
  const workspace = document.querySelector(".workspace")?.getBoundingClientRect();
  const flow = document.querySelector(".flow-pane")?.getBoundingClientRect();
  const toolbar = document.querySelector(".flow-toolbar")?.getBoundingClientRect();
  panel.style.maxHeight = "";
  const fitsAbove = flow && flow.top >= panel.offsetHeight + margin + 12;
  const belowTop = toolbar ? toolbar.bottom + 12 : (flow ? flow.top + 54 : null);
  if (!size && !position && !fitsAbove && belowTop != null) {
    panel.style.maxHeight = `${Math.max(120, innerHeight - belowTop - margin)}px`;
  }
  const left = position?.x ?? (workspace ? workspace.right - panel.offsetWidth - 24 : (innerWidth - panel.offsetWidth) / 2);
  // Prefer the space above the flow when the full float fits there, so the
  // completed filter and node locator remain reachable without moving it.
  const defaultTop = flow
    ? (fitsAbove ? flow.top - panel.offsetHeight - 12 : belowTop)
    : (innerHeight - panel.offsetHeight) / 2;
  const top = position?.y ?? defaultTop;
  const x = Math.max(margin, Math.min(innerWidth - panel.offsetWidth - margin, left));
  const y = Math.max(margin, Math.min(innerHeight - panel.offsetHeight - margin, top));
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
  if (position) state.nodeDetailPosition = { x, y };
}

function shellResizeRecordWindow(rect, edge, dx, dy) {
  const margin = 16;
  const minWidth = Math.min(280, innerWidth - margin * 2);
  const minHeight = Math.min(200, innerHeight - margin * 2);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let { left, top, right, bottom } = rect;
  if (edge.includes("w")) left = clamp(left + dx, margin, right - minWidth);
  if (edge.includes("e")) right = clamp(right + dx, left + minWidth, innerWidth - margin);
  if (edge.includes("n")) top = clamp(top + dy, margin, bottom - minHeight);
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + minHeight, innerHeight - margin);
  state.nodeDetailSize = { width: right - left, height: bottom - top };
  shellLayoutRecordWindow({ x: left, y: top });
}
window.addEventListener("resize", () => shellLayoutRecordWindow());

function shellAfterRender() {
  shellSyncPaneVisibility();
  window.requestAnimationFrame(shellLayoutTaskMenu);
  const task = shellActiveTask();
  if (shellConclusionDraft) {
    const draft = shellConclusionDraft;
    const fresh = document.querySelector("[data-shell-node-conclusion]");
    if (fresh && draft.editor && fresh !== draft.editor) fresh.replaceWith(draft.editor);
    if (!fresh) shellFinishNodeConclusionEdit(true);
    else {
      if (draft.cursor) {
        draft.editor.focus({ preventScroll: true });
        draft.editor.setSelectionRange(draft.cursor.start, draft.cursor.end, draft.cursor.direction);
        draft.editor.scrollTop = draft.cursor.top;
      }
      draft.rendering = false;
    }
  }
  shellSyncConclusionLayout();
  const outline = document.querySelector(".flow-outline");
  if (outline !== shellConclusionObserved && typeof ResizeObserver === "function") {
    shellConclusionObserver?.disconnect();
    shellConclusionObserver ||= new ResizeObserver(shellSyncConclusionLayout);
    if (outline) shellConclusionObserver.observe(outline);
    shellConclusionObserved = outline;
  }
  const panel = document.querySelector(".node-record-window");
  shellLayoutRecordWindow();
  if (panel) {
    let fresh = panel.querySelector("[data-shell-node-record]");
    const cached = shellRecordEditors.get(`${task?.id}:${state.selectedNodeId}`);
    const model = task && findNode(task.nodes, state.selectedNodeId);
    if (fresh && shellRecordModels.has(fresh) && shellRecordModels.get(fresh) !== model) {
      // Unchanged markup may retain the whole workspace across an import.
      // Replace this control too, so its old bound journal cannot survive.
      const replacement = fresh.cloneNode(true);
      replacement.value = fresh.value;
      fresh.replaceWith(replacement);
      fresh = replacement;
    }
    const retained = cached?.node === model ? cached.editor : null;
    // A restored/imported model starts a fresh journal, even if IDs/text match.
    // Ordinary redraws and node switches keep the control's edit history.
    if (fresh && retained && fresh !== retained && fresh.value === retained.value) fresh.replaceWith(retained);
    const current = panel.querySelector("[data-shell-node-record]");
    if (current) shellRecordModels.set(current, model);
  }
  if (shellFlowFocus) {
    const target = document.querySelector(`${shellFlowFocus}:not([hidden])`);
    if (target && !target.disabled && !target.closest("[inert]") && target.getClientRects().length) target.focus({ preventScroll: true });
  }
  if (shellRecordCursor && shellRecordCursor.task === task?.id && shellRecordCursor.node === state.selectedNodeId) {
    const editor = panel?.querySelector("[data-shell-node-record]");
    if (editor) {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(shellRecordCursor.start, shellRecordCursor.end, shellRecordCursor.direction);
      editor.scrollTop = shellRecordCursor.top;
    }
  }
  const changed = task?.id !== shellLastFlowTaskId || state.selectedNodeId !== shellLastFlowNodeId;
  if (changed && task && state.selectedNodeId && state.taskPane === "flow" && typeof document.querySelector === "function") {
    document.querySelector(`.node-title[data-node-id="${CSS.escape(state.selectedNodeId)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  shellLastFlowTaskId = task?.id || null;
  shellLastFlowNodeId = state.selectedNodeId;
  if (shellNodeRenameDraft) shellNodeRenameDraft.rendering = false;
}

/** Arrow-key navigation inside the processing flow, mirroring the Demo. */
function shellBindFlowKeyboard() {
  if (typeof document.addEventListener !== "function") return;
  if (window.__loopFlowKeysBound) return;
  window.__loopFlowKeysBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (shellOverlayIsOpen?.()) return;
    const title = event.target.closest?.(".node-title");
    if (!title || event.ctrlKey || event.metaKey || event.altKey) return;
    const task = shellActiveTask();
    if (!task) return;
    const nodeId = title.dataset.nodeId;
    if (event.key === "F2") {
      event.preventDefault();
      shellStartNodeTitleEdit(title);
      return;
    }
    if (state.selectedNodeId === nodeId && !state.contextMenu && ["Enter", "Tab", " "].includes(event.key)) {
      const { index, parent } = shellNodeSiblings(task, nodeId);
      if (event.key === "Tab" && (event.shiftKey ? !parent : index <= 0)) return;
      event.preventDefault();
      if (event.repeat) return;
      if (event.key === "Enter") void action({ action: "add-sibling-node", taskId: task.id, nodeId });
      else if (event.key === " ") void action({ action: "cycle-node-status", taskId: task.id, nodeId });
      else void action({ action: "move-node", nodeId, direction: event.shiftKey ? "out" : "in" }).then(() => {
        document.querySelector(`.node-title[data-node-id="${CSS.escape(nodeId)}"]`)?.focus({ preventScroll: true });
      });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const path = shellNodePath(task, nodeId);
    const node = path.at(-1);
    const visible = [...document.querySelectorAll(".flow-scroll .node-title")].filter(el => !el.closest("[inert]") && el.getClientRects().length);
    const index = visible.indexOf(title);
    if (event.key === "ArrowDown") {
      visible[Math.min(index + 1, visible.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      visible[Math.max(index - 1, 0)]?.focus();
    } else if (event.key === "ArrowRight" && node?.children?.length) {
      if (node.collapsed) {
        node.collapsed = false;
        render();
      } else {
        title.closest(".flow-item")?.querySelector(".flow-branch .node-title")?.focus();
      }
    } else if (event.key === "ArrowLeft") {
      if (node?.children?.length && !node.collapsed) {
        node.collapsed = true;
        render();
      } else if (path.at(-2)) {
        document.querySelector(`.node-title[data-node-id="${CSS.escape(path.at(-2).id)}"]`)?.focus();
      }
    }
  }, true);
}

// ------------------------------------------------------------
// Workspace assembly
// ------------------------------------------------------------

function renderShellHistory(task) {
  const filters = [["all", "全部"], ["task", "任务"], ["node", "节点"], ["brief", "简报与结论"]];
  return `<section class="task-activity-pane" data-task-activity="${escAttr(task.id)}" aria-label="处理历史">
    <div class="task-activity-sidebar">
      <div class="segmented" aria-label="事件类型">${filters.map(([kind, label]) => `<button type="button" data-activity-filter="${kind}" class="${kind === "all" ? "active" : ""}" aria-pressed="${kind === "all"}">${label}</button>`).join("")}</div>
      <div data-task-activity-events></div>
      <p data-task-activity-status role="status"></p>
      <button class="button" type="button" data-task-activity-more hidden>加载更早记录</button>
    </div>
    <div class="task-activity-detail" data-activity-detail></div>
  </section>`;
}

function taskActivityCategory(event) {
  return event.legacy || event.changes?.some(item => ["description", "hypothesis", "conclusion"].includes(item.field))
    ? "brief" : event.targetKind;
}

const taskActivityFields = {
  title: "标题", status: "状态", group: "分组", priority: "优先级", deadlineAt: "截止时间",
  placement: "位置", description: "背景", hypothesis: "进展", conclusion: "结论", notes: "笔记",
  note: "记录", body: "正文", tags: "标签", knowledgeNoteIds: "所属笔记", downstreamNodeIds: "关联节点",
};
const taskActivityDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

function taskActivityValue(field, value, targetKind) {
  if (field === "placement") return `${value?.parentId ? value.parentTitle || "未命名父节点" : "顶层"} · 第 ${value?.order || 1} 项`;
  if (field === "group") return value?.id ? value.title || "分组" : "未分组";
  if (field === "status") {
    const id = value?.id || value;
    if (targetKind === "node") return value?.title || nodeStatusText(id);
    return id === "done" ? "已完成" : "进行中";
  }
  if (field === "priority") return { high: "高", medium: "中", low: "低" }[value] || "未设置";
  if (field === "deadlineAt" && Number.isFinite(Date.parse(value))) return taskActivityDate.format(new Date(value));
  if (field === "knowledgeNoteIds" || field === "downstreamNodeIds") return `${value?.length || 0} 项`;
  if (field === "tags" && Array.isArray(value)) return value.map(tag => ({today: "今日", later: "稍后", blocked: "阻塞"})[tag] || tag).join("、") || "空";
  return Array.isArray(value) ? value.join("、") || "空" : typeof value === "string" && value ? value : "空";
}

function taskActivityHeading(event) {
  if (event.legacy) return event.title;
  const { targetKind, changes = [] } = event;
  const targetLabel = { task: "任务", node: "节点", note: "笔记" }[targetKind] || "内容";
  let action = { created: "创建", imported: "导入", deleted: "删除", restored: "恢复", "restored-version": "恢复版本" }[event.kind];
  if (!action) {
    const fields = changes.map(item => item.field);
    if (fields.includes("status")) {
      const status = changes.find(item => item.field === "status");
      const before = status.before?.id || status.before;
      const after = status.after?.id || status.after;
      action = after === "done" ? "完成" : before === "done" ? "重新打开" : "变更状态";
    } else if (fields.includes("placement") || fields.includes("group")) action = "移动";
    else action = fields.length === 1 ? `更新${taskActivityFields[fields[0]] || "内容"}` : "更新";
  }
  return `${action} · ${targetLabel}「${event.title || "未命名"}」`;
}

function renderTaskActivityDetail(event, task, compareCurrent = false) {
  if (!event) return '<p class="task-activity-empty">选择一条记录查看变更</p>';
  const { targetKind, targetId, changes = [] } = event;
  const heading = taskActivityHeading(event);
  const target = targetKind === "task" ? task : targetKind === "node" ? findNode(task.nodes, targetId) : null;
  const restorableFields = targetKind === "task" ? ["description", "hypothesis", "conclusion"] : ["note", "conclusion"];
  const canRestore = Boolean(target && window.personalTaskTrack?.taskHistory?.restore);
  const canCompare = canRestore && changes.some(change => restorableFields.includes(change.field));
  const time = event.legacy ? event.at : taskActivityDate.format(new Date(event.at));
  return `<header><h3>${esc(heading)}</h3><time>${esc(time)}</time></header>
    ${canCompare ? `<button class="button" type="button" data-activity-compare aria-pressed="${compareCurrent}">${compareCurrent ? "查看原始变更" : "与当前版本对比"}</button>` : ""}
    ${changes.length ? changes.map(change => {
      const restorable = canRestore && restorableFields.includes(change.field);
      const current = restorable && compareCurrent;
      const version = (side, label, value, cssClass) => `<div class="task-activity-version ${cssClass}"><span>${label}</span>
        <pre>${taskActivityValue(change.field, value, targetKind).split("\n").map(line => `<span data-diff-mark="${cssClass === "version-before" ? "−" : "+"}">${esc(line) || " "}</span>`).join("")}</pre>
        ${restorable && side ? `<button class="button" type="button" data-task-activity-restore="${escAttr(event.id)}" data-field="${escAttr(change.field)}" data-side="${side}">恢复到此版本</button>` : ""}</div>`;
      return `<section class="task-activity-change">
        <h4 class="task-activity-field">${esc(taskActivityFields[change.field] || "内容")}</h4>
        ${current
          ? version("after", "历史版本", change.after, "version-before") + version("", "当前版本", target[change.field], "version-after")
          : version("before", event.kind === "deleted" ? "删除前" : "上一版本", change.before, "version-before")
            + (event.kind === "deleted" ? "" : version("after", "变更后", change.after, "version-after"))}
      </section>`;
    }).join("") : `<p class="task-activity-empty">${event.legacy ? "此记录只有编辑摘要" : "此事件没有文本变更"}</p>`}`;
}

function bindTaskActivityPane() {
  const pane = document.querySelector("[data-task-activity]");
  const bridge = window.personalTaskTrack?.taskHistory;
  if (!pane || pane.dataset.historyBound) return;
  const taskId = pane.dataset.taskActivity;
  const events = pane.querySelector("[data-task-activity-events]");
  const status = pane.querySelector("[data-task-activity-status]");
  const more = pane.querySelector("[data-task-activity-more]");
  if (!events || !status || !more) return;
  pane.dataset.historyBound = "true";
  let cursor = null;
  let loading = false;
  let restoring = false;
  let filter = "all";
  let selectedId = "";
  let compareCurrent = false;
  let loaded = [];
  const detail = pane.querySelector("[data-activity-detail]");
  const task = () => state.tasks.find(item => item.id === taskId);
  const legacy = (task()?.history || []).map(([at, title], i) => ({ id: `summary-${i}`, at, title, legacy: true }));
  function draw() {
    const record = task();
    if (!record) return;
    const visible = [...loaded, ...legacy].filter(event => filter === "all" || taskActivityCategory(event) === filter);
    const selected = visible.find(event => event.id === selectedId) || visible[0];
    selectedId = selected?.id || "";
    let previousDay;
    events.innerHTML = visible.map(event => {
      const date = event.legacy ? null : safeDate(event.at);
      const day = date ? shellDisplayDate(date).replaceAll(" ", "") : "简报编辑摘要";
      const heading = day !== previousDay ? `<h4 class="task-activity-day">${day}</h4>` : "";
      previousDay = day;
      return `${heading}<button class="task-activity-event" type="button" data-activity-event="${escAttr(event.id)}" data-kind="${escAttr(taskActivityCategory(event))}" aria-pressed="${selectedId === event.id}">
        <span>${esc(taskActivityHeading(event))}</span><time>${esc(date ? shellTimeLabel(date) : event.at)}</time></button>`;
    }).join("");
    detail.innerHTML = renderTaskActivityDetail(selected, record, compareCurrent);
  }

  async function load(reset = false) {
    if (loading || restoring || !bridge?.read) return;
    loading = true;
    more.disabled = true;
    status.textContent = "正在读取历史…";
    try {
      const saved = !reset || await flushSave();
      const result = await bridge.read(taskId, reset ? null : cursor);
      if (!pane.isConnected) return;
      const list = Array.isArray(result?.events) ? result.events : [];
      loaded = reset ? list : [...loaded, ...list];
      draw();
      cursor = result?.beforeId || null;
      status.textContent = !saved && !dataProtectionMessage ? "显示已保存的记录，当前修改尚未写入" : "";
      more.hidden = !cursor;
      more.textContent = "加载更早记录";
    } catch (error) {
      console.error("读取任务历史失败", error);
      status.textContent = "未能读取历史记录";
      more.textContent = "重试";
      more.hidden = false;
    } finally {
      loading = false;
      more.disabled = false;
    }
  }

  more.addEventListener("click", () => void load(!cursor));
  pane.addEventListener("click", async (event) => {
    const filterButton = event.target.closest("[data-activity-filter]");
    if (filterButton) {
      filter = filterButton.dataset.activityFilter;
      pane.querySelectorAll("[data-activity-filter]").forEach(button => {
        const active = button === filterButton;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      compareCurrent = false;
      draw();
      return;
    }
    const row = event.target.closest("[data-activity-event]");
    if (row) {
      selectedId = row.dataset.activityEvent;
      compareCurrent = false;
      draw();
      events.querySelector(`[data-activity-event="${CSS.escape(selectedId)}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (event.target.closest("[data-activity-compare]")) {
      compareCurrent = !compareCurrent;
      draw();
      detail.querySelector("[data-activity-compare]")?.focus({ preventScroll: true });
      return;
    }
    const button = event.target.closest?.("[data-task-activity-restore]");
    if (!button || loading || restoring || taskShareCommitBusy || dataTransferInProgress || dataProtectionMessage) return;
    restoring = true;
    button.disabled = true;
    try {
      const confirmed = await confirmDestructiveAction("用这个历史版本恢复当前内容？当前内容也会作为一个版本保留。", "restore-task-history");
      if (!confirmed || !pane.isConnected) return;
      captureMountedMilkdownDrafts();
      flushNodeNoteDrafts({ persist: false });
      save();
      if (!(await flushSave()) || taskShareCommitBusy || dataTransferInProgress || dataProtectionMessage) {
        status.textContent = "请先成功保存当前修改，再恢复历史版本";
        return;
      }
      let receipt;
      taskShareCommitBusy = true;
      try {
        receipt = await bridge.restore({ taskId, eventId: button.dataset.taskActivityRestore, field: button.dataset.field,
          side: button.dataset.side, revision: taskShareRevision });
        taskShareRevision = receipt.revision;
        const task = state.tasks.find(item => item.id === taskId);
        const target = receipt.targetKind === "node" ? findNode(task?.nodes || [], receipt.targetId) : task;
        if (target) {
          target[receipt.field] = receipt.value;
          target.updatedAt = receipt.updatedAt;
          if (target === task && receipt.field === "hypothesis") task.hypothesisUpdatedAt = receipt.updatedAt;
          task.updatedAt = receipt.updatedAt;
        }
      } finally {
        taskShareCommitBusy = false;
      }
      if (receipt) {
        render();
        restoring = false;
        if (pane.isConnected) await load(true);
      }
    } catch (error) {
      console.error("恢复任务历史版本失败", error);
      status.textContent = "未能恢复历史版本，请检查存储后重试";
    } finally {
      restoring = false;
      button.disabled = false;
    }
  });
  draw();
  void load(true);
}

document.addEventListener?.("loop-work-navigation:rendered", bindTaskActivityPane);

function renderShellTaskActions(task) {
  return `<div class="task-heading-actions" role="group" aria-label="任务操作区" data-task-id="${escAttr(task.id)}">
    <button class="button task-share-action" type="button" data-action="share-task" data-task-id="${escAttr(task.id)}" aria-label="分享／导出任务" title="分享／导出任务">${shellIcon("share")}<span>分享</span></button>
    <button class="icon-button task-menu-action" type="button" data-action="open-task-menu" aria-label="任务操作" title="任务操作" aria-haspopup="menu" aria-expanded="${state.taskMenuOpen === true}">${shellIcon("more")}</button>
  </div>`;
}

const shellTaskInfoCollapsed = new Set();
const shellTaskInfoChoices = new Set();

function shellFitTaskInfoToFlow() {
  const card = document.querySelector("[data-task-info]");
  const toolbar = document.querySelector(".flow-toolbar");
  if (!card || !toolbar || shellTaskInfoChoices.has(card.dataset.taskInfo) || shellTaskInfoCollapsed.has(card.dataset.taskInfo)) return;
  // An automatically opened card must not cover the processing controls.
  // An explicitly opened card remains under the user's control.
  if (card.getBoundingClientRect().bottom > toolbar.getBoundingClientRect().top - 8) {
    shellSetTaskInfoCollapsed(card.dataset.taskInfo, true);
  }
}

function renderShellTaskInfoIcon() {
  return '<svg class="task-info-symbol" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10.5v6"/><circle cx="12" cy="7.2" r=".9" fill="currentColor" stroke="none"/></svg>';
}

function renderShellTaskInfo(task) {
  const collapsed = shellTaskInfoCollapsed.has(task.id);
  const tags = normalizeTaskTags(task.tags);
  const deadline = shellDeadlineProperty(task);
  const groupTitle = state.taskGroups.find(group => group.id === task.groupId)?.title || '';
  const recurrence = normalizeTaskRecurrence(task.recurrence);
  const row = (label, icon, value, action, { className = "", attributes = "", title = "" } = {}) => `
    <button class="task-info-row ${className}" type="button" data-action="${action}" data-task-id="${escAttr(task.id)}" title="${escAttr(title || (value ? `${label}：${value}` : `设置${label}`))}" ${attributes}>
      <span class="task-info-label">${shellIcon(icon)}<span>${label}</span></span>
      <span class="task-info-value">${esc(value)}</span>${shellIcon("down", "task-info-chevron")}
    </button>`;
  return `<aside class="task-info-card" aria-label="任务详情" data-task-info="${escAttr(task.id)}">
    <header class="task-info-head"><span>任务详情</span><button class="icon-button" type="button" data-action="toggle-task-info" data-task-id="${escAttr(task.id)}" aria-expanded="${!collapsed}" aria-controls="task-info-body" aria-label="${collapsed ? "展开任务详情" : "收起任务详情"}" title="${collapsed ? "展开任务详情" : "收起任务详情"}">${collapsed ? renderShellTaskInfoIcon() : shellIcon("close")}</button></header>
    <div class="task-info-body" id="task-info-body" ${collapsed ? "hidden" : ""}>
      <div class="task-info-section" role="group" aria-label="任务属性">
        ${row('分组', 'folder', groupTitle, 'toggle-task-group-select', { className: 'task-info-group', attributes: `aria-haspopup="dialog" aria-label="${groupTitle ? `修改任务分组：${escAttr(groupTitle)}` : '设置任务分组'}"` })}
        ${row('优先级', 'flag', SHELL_PRIORITY_LABELS[normalizePriority(task.priority)], 'toggle-task-priority-menu', { attributes: 'aria-haspopup="menu" aria-label="修改任务优先级"' })}
      </div>
      <div class="task-info-section" role="group" aria-label="时间安排">
        ${row('截止时间', 'calendar', task.deadlineAt ? deadline.text : '', 'toggle-deadline-picker', { className: deadline.classes, attributes: 'aria-haspopup="dialog"', title: deadline.title })}
        ${row('循环', 'repeat', recurrence.frequency === 'none' ? '' : shellRecurrenceLabel(recurrence), 'open-task-recurrence', { attributes: 'aria-haspopup="dialog"' })}
      </div>
      <div class="task-info-section">
        <button class="task-info-row task-info-today" type="button" data-action="toggle-task-tag" data-tag="today" data-task-id="${escAttr(task.id)}" aria-pressed="${tags.today}" aria-label="${tags.today ? '取消手动加入今日' : '手动加入今日'}" title="只调整手动加入，不影响截止与循环安排">
          <span class="task-info-label">${shellIcon('home')}<span>今日</span></span><span class="task-info-value">${tags.today ? '已手动加入' : ''}</span>${shellIcon(tags.today ? 'check' : 'plus', 'task-info-chevron')}
        </button>
      </div>
    </div>
  </aside>`;
}

function shellSetTaskInfoCollapsed(taskId, collapsed) {
  if (collapsed) shellTaskInfoCollapsed.add(taskId);
  else shellTaskInfoCollapsed.delete(taskId);
  const card = document.querySelector("[data-task-info]");
  if (card?.dataset.taskInfo !== taskId) return;
  card.closest(".task-work-area")?.classList.toggle("task-info-collapsed", collapsed);
  card.querySelector(".task-info-body").hidden = collapsed;
  const button = card.querySelector('[data-action="toggle-task-info"]');
  const label = collapsed ? "展开任务详情" : "收起任务详情";
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = collapsed ? renderShellTaskInfoIcon() : shellIcon("close");
  if (!collapsed) brief21ResizeAll?.();
}

function renderShellWorkspaceHead(task) {
  const done = task.status === "done";
  const tags = normalizeTaskTags(task.tags);
  const deadline = shellDeadlineProperty(task);
  const recurrence = normalizeTaskRecurrence(task.recurrence);
  const pri = SHELL_PRIORITY_LABELS[normalizePriority(task.priority)];
  const dueDate = safeDate(task.deadlineAt);
  const dueText = dueDate ? `${dueDate.getMonth() + 1}/${dueDate.getDate()} ${shellTimeLabel(dueDate)} 截止` : "截止";
  return `<header class="ws-task-head">
    <div class="ws-title-row">
      <button class="ws-complete-check ${done ? "done" : ""}" type="button" data-action="toggle-task-done" data-task-id="${escAttr(task.id)}" aria-label="${done ? "恢复任务" : "完成任务"}" aria-pressed="${done}" title="${done ? "已完成，点击恢复" : "完成任务"}">${done ? shellIcon("check") : ""}</button>
      ${renderShellTaskTitle(task)}
    </div>
    <div class="ws-props-row" role="group" aria-label="任务属性">
      <button class="ws-prop" type="button" data-action="toggle-task-priority-menu" data-task-id="${escAttr(task.id)}" aria-haspopup="menu" title="修改优先级">${shellIcon("flag")}<span>优先级 ${esc(pri.replace("优先", ""))}</span></button>
      <button class="ws-prop ${deadline.classes}" type="button" data-action="toggle-deadline-picker" data-task-id="${escAttr(task.id)}" aria-haspopup="dialog" title="${escAttr(deadline.title)}">${shellIcon("clock")}<span>${esc(dueText)}</span></button>
      <button class="ws-prop ${tags.blocked ? "is-blocked" : ""}" type="button" data-action="open-task-tags" aria-haspopup="dialog" title="标记">${shellIcon(tags.blocked ? "blocked" : "flag")}<span>${tags.blocked ? "卡住" : tags.later ? "稍后" : "标记"}</span></button>
      <button class="ws-prop ${tags.today ? "is-today" : ""}" type="button" data-action="toggle-task-tag" data-tag="today" data-task-id="${escAttr(task.id)}" aria-pressed="${Boolean(tags.today)}" title="今日安排">${shellIcon("sun")}<span>${tags.today ? "在今日" : "今日"}</span></button>
      <button class="ws-prop" type="button" data-action="open-task-recurrence" data-task-id="${escAttr(task.id)}" aria-haspopup="dialog" title="设置循环">${shellIcon("repeat")}<span>${recurrence.frequency === "none" ? "循环" : esc(shellRecurrenceLabel(recurrence))}</span></button>
    </div>
  </header>`;
}

function renderShellWorkspace(task, visibleTaskCount) {
  if (!task) return renderShellEmptyWorkspace(visibleTaskCount);
  const pane = state.taskPane === "notes" ? "notes" : state.taskPane === "history" ? "history" : "flow";
  const flow = pane === "flow" ? renderShellFlow(task) : null;
  return `<section class="task-work-area ${shellTaskInfoCollapsed.has(task.id) ? "task-info-collapsed" : ""}">
      <div class="task-work-main">
        ${renderShellWorkspaceHead(task)}
        ${renderShellBrief(task)}
        ${renderShellTabs(task, flow?.toolbar)}
        <div class="tab-content">
          ${flow ? flow.content : pane === "notes" ? renderShellNotes(task) : renderShellHistory(task)}
        </div>
      </div>
      ${renderShellTaskInfo(task)}
    </section>
    ${pane === "notes" ? "" : renderShellWorkspaceFooter(pane === "flow" && !(task.nodes || []).length ? "" : pane)}`;
}

function renderShellWorkspaceFooter(pane = "") {
  const task=shellActiveTask();
  const shortcut=pane==='notes' && task && typeof knowledgeSavePresentation==='function'
    ? knowledgeSavePresentation(task).shortcut : '⌘ / Ctrl + S 保存笔记';
  return `<footer class="workspace-foot">
    <div data-workspace-status>${renderWorkspaceStatus()}</div>
    ${pane === "flow" ? `<span class="foot-shortcut"><span><kbd>↵</kbd> 同级</span><span><kbd>Tab</kbd> 下级</span><button type="button" data-action="open-command-palette"><kbd>${desktopPlatform === "darwin" ? "⌘K" : "Ctrl K"}</kbd> 命令</button></span>` : pane === "notes" ? `<span class="foot-shortcut">${shortcut}</span>` : ""}
  </footer>`;
}

function renderShellEmptyPrompt(icon, title, description, actions = "") {
  return `<div class="workspace-empty-prompt">
    <span class="workspace-empty-icon">${shellIcon(icon)}</span>
    <div class="workspace-empty-copy">
      <h2>${esc(title)}</h2>
      <p>${esc(description)}</p>
      ${actions ? `<div class="workspace-empty-actions">${actions}</div>` : ""}
    </div>
  </div>`;
}

function renderShellEmptyWorkspace(visibleTaskCount) {
  const filtered = shellActiveFilterLabels().length || state.taskDateFilter || state.taskFilter === "done";
  const today = shellRoute() === "today";
  const noun = state.captureSourceFilter === "quick" ? "速记" : "任务";
  let prompt;
  if (visibleTaskCount) {
    prompt = renderShellEmptyPrompt("tasks", `选择一项${noun}`, "在任务列表中选择一项记录，查看详情。");
  } else if (filtered) {
    prompt = renderShellEmptyPrompt("filter", `没有匹配的${noun}`, "清除筛选可以查看其他记录。",
      '<button class="button" type="button" data-action="clear-list-filters">清除筛选</button>');
  } else if (today && state.todayFilter === "done") {
    prompt = renderShellEmptyPrompt("check", "今天暂无完成任务", "查看今日待办，继续处理任务。",
      '<button class="button" type="button" data-action="show-today-active">查看待办</button>');
  } else if (today) {
    const completed = shellCompletedToday().length;
    prompt = completed
      ? renderShellEmptyPrompt("check", "今日任务已完成", `今天已完成 ${completed} 项任务。`,
        '<button class="button" type="button" data-action="show-today-completed">查看完成任务</button>')
      : renderShellEmptyPrompt("sun", "今天暂无待办", "新建一项今日任务，或从任务仓库加入今日。",
        `<button class="button" type="button" data-action="add-task">${shellIcon("plus")}新建今日任务</button>
         <button class="text-button" type="button" data-setting-button="task-filter" data-value="all">前往任务仓库${shellIcon("arrow")}</button>`);
  } else {
    prompt = renderShellEmptyPrompt("tasks", "开始一项新任务", "新建任务后，可以拆分步骤、记录进展。",
      `<button class="button" type="button" data-action="add-task">${shellIcon("plus")}新建任务</button>`);
  }
  return `<div class="workspace-empty">${prompt}</div>`;
}

// The knowledge pane still runs on the project's own renderer: the Demo's
// knowledge stylesheet is already loaded, so the visual port lands in the next
// stage without taking the Milkdown editor, file binding, conflict and
// recovery flows offline in the meantime.
function renderShellNotes(task) {
  return renderTaskKnowledge(task);
}

function renderShellTaskMenu(task) {
  const tags = normalizeTaskTags(task.tags);
  return `<div class="popover" data-task-menu role="menu" aria-label="任务操作">
    <button type="button" role="menuitem" data-action="toggle-task-tag" data-tag="today" data-task-id="${escAttr(task.id)}">${shellIcon("home")}${tags.today ? "移出今日" : "加入今日"}</button>
    <button type="button" role="menuitem" data-action="toggle-task-group-select" data-task-id="${escAttr(task.id)}">${shellIcon("folder")}移动至分组</button>
    ${["blocked", "later"].map((tag) => `<button type="button" data-action="toggle-task-tag" data-tag="${tag}" data-task-id="${escAttr(task.id)}" role="menuitemcheckbox" aria-checked="${Boolean(tags[tag])}">${shellIcon(tag)}${tags[tag] ? "取消" : "标记"}${SHELL_TASK_TAG_LABELS[tag]}</button>`).join("")}
    <div class="popover-separator"></div>
    <button type="button" role="menuitem" data-action="share-task" data-task-id="${escAttr(task.id)}">${shellIcon("note")}分享／导出任务…</button>
    <button type="button" role="menuitem" data-action="copy-task-summary">${shellIcon("note")}复制任务摘要</button>
    <button class="danger-action" type="button" role="menuitem" data-action="delete-task" data-task-id="${escAttr(task.id)}">${shellIcon("close")}删除任务…</button>
  </div>`;
}

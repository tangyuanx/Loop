// ============================================================
// Loop -- 工作与成长导航  (Demo phase 15)
//
// Presentation ported from the frozen Demo's loop-work-phase15.js +
// loop-work-phase15.css: the topbar pill, the advanced-settings block (unlock
// gate + schedule form), and the tabbed dialog (当前阶段 / 全天安排 / 任务队列)
// with the batch-import preview.
//
// All data, phase resolution, queue reconciliation, persistence, the unlock
// password and the import pipeline are the project's own, reached through
// globalThis.LoopWorkNavigationBridge and LoopWorkNavigationModel
// (the model is byte-identical to the Demo's loop-work-model.js).
// ============================================================

(() => {
  "use strict";
  const model = globalThis.LoopWorkNavigationModel;
  const bridge = globalThis.LoopWorkNavigationBridge;
  const gate = globalThis.personalTaskTrack?.workRhythm;
  if (!model || !bridge) return;

  const ENABLED_KEY = "loop-work-rhythm-v1:enabled";
  const WEEKDAYS = [[1, "一"], [2, "二"], [3, "三"], [4, "四"], [5, "五"], [6, "六"], [0, "日"]];
  const TIME_POINTS = [
    ["工作开始", "workStart"], ["上午结束", "morningEnd"], ["下午开始", "afternoonStart"],
    ["休息开始", "restStart"], ["休息结束", "restEnd"], ["学习过渡", "transitionStart"],
    ["学习开始", "learningStart"], ["学习结束", "learningEnd"],
  ];

  const ui = {
    enabled: globalThis.LoopUiPreferences?.snapshot?.().workNavigationEnabled ?? (localStorage.getItem(ENABLED_KEY) === "1"),
    gateOpen: false, gateError: "", tab: "current", kind: "work",
    panelOpen: false, settingsError: "", importDraft: null, actionError: "",
  };

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
  const snap = () => { try { return bridge.snapshot(); } catch (_) { return null; } };
  const now = () => loopNow();
  const taskById = (data, id) => data.tasks.find((task) => task.id === id) || null;
  const groupById = (data, id) => data.groups.find((group) => group.id === id) || null;
  const queueIds = (data, kind) => (kind === "growth" ? data.growthTaskIds : data.workTaskIds);
  const queueFor = (data, kind) => queueIds(data, kind).map((id) => taskById(data, id)).filter(Boolean);
  const toast = (message) => (typeof shellToast === "function" ? shellToast(message) : undefined);
  let panelSignature = "";
  const signature = (data) => `${Math.floor(now().getTime() / 60000)}:${JSON.stringify(data)}`;

  function closePanel({ restoreFocus = true } = {}) {
    ui.panelOpen = false;
    shellCloseOverlay({ restoreFocus });
    syncPill();
  }

  function phaseView(data) {
    const resolved = model.resolvePhase(now(), data.navigation);
    const kind = resolved.phase?.type === "growth" ? "growth" : "work";
    const paused = resolved.mode === "active" && ["break", "meeting"].includes(resolved.phase?.type);
    const list = queueFor(data, kind);
    return {
      state: resolved, kind, list, task: taskById(data, kind === "growth" ? data.activeGrowthTaskId : data.activeWorkTaskId), paused,
      canAct: resolved.mode === "active" && ["growth", "work"].includes(resolved.phase?.type),
    };
  }

  function pillHint(state) {
    if (state.mode === "weekend-ready") return "等待开始";
    if (state.mode === "ended") return "今日已结束";
    if (state.mode === "off-day") return "今日未安排";
    if (state.mode === "next" || state.mode === "gap") return `${state.remainingMinutes ?? 0} 分钟后开始`;
    return `${state.remainingMinutes ?? 0} 分钟`;
  }

  // ------------------------------------------------------------
  // Topbar pill
  // ------------------------------------------------------------
  function syncPill() {
    if (!ui.enabled) { document.querySelector(".work15-pill")?.remove(); return; }
    const data = snap(); if (!data) return;
    const view = phaseView(data);
    const mount = document.querySelector(".topbar .shell-actions");
    if (!mount) return;
    let pill = mount.querySelector(".work15-pill");
    if (!pill) {
      mount.insertAdjacentHTML("afterbegin", '<button class="work15-pill" type="button" data-work15="open" aria-label="工作与成长详情" aria-haspopup="dialog"><i aria-hidden="true"></i><strong></strong><span></span></button>');
      pill = mount.querySelector(".work15-pill");
    }
    const label = view.state.mode === "ended" ? "今日已结束" : view.state.mode === "off-day" ? "今日未安排" : view.state.phase?.label || "工作与成长";
    pill.querySelector("strong").textContent = label;
    pill.querySelector("span").textContent = `· ${pillHint(view.state)}`;
    pill.title = `${label} · ${pillHint(view.state)}`;
    pill.dataset.phaseType = view.state.mode === "active" ? view.state.phase?.type || "idle" : "idle";
    pill.setAttribute("aria-expanded", String(Boolean(document.querySelector(".work15-dialog"))));
    if (ui.panelOpen && document.querySelector(".work15-dialog")) {
      if (panelSignature !== signature(data)) openPanel();
    } else ui.panelOpen = false;
  }

  // ------------------------------------------------------------
  // Advanced settings block
  // ------------------------------------------------------------
  function settingsBody() {
    if (!ui.enabled) {
      const gateMarkup = ui.gateOpen
        ? `<form class="work15-gate" id="work15-unlock">
            <label for="work15-password">访问密码</label>
            <input type="password" id="work15-password" autocomplete="off" />
            <button class="button primary" type="submit">验证并开启</button>
            ${ui.gateError ? `<p class="work15-error" role="alert">${esc(ui.gateError)}</p>` : ""}
          </form>`
        : "";
      return `<h2>高级功能</h2><p>按需要启用附加能力，保持日常任务工作台简洁。</p>
        <div class="setting-row">
          <div><span class="setting-label">工作与成长导航</span><p>根据时间安排，衔接工作和学习任务。</p></div>
          <button class="prefs-switch" type="button" role="switch" aria-label="工作与成长导航" aria-checked="false" data-work15="toggle"></button>
        </div>
        ${gateMarkup}
        <p class="prefs-native-caption">开启后，顶部会显示当前阶段入口。</p>`;
    }
    const data = snap(); if (!data) return "";
    const view = phaseView(data);
    const config = data.navigation.config;
    const schedule = config.schedule;
    return `<h2>高级功能</h2><p>按需要启用附加能力，保持日常任务工作台简洁。</p>
      <div class="setting-row">
        <div><span class="setting-label">工作与成长导航</span><p>根据时间安排，衔接工作和学习任务。</p></div>
        <button class="prefs-switch" type="button" role="switch" aria-label="工作与成长导航" aria-checked="true" data-work15="toggle"></button>
      </div>
      <div class="setting-row">
        <div><span class="setting-label">当前阶段</span><p>${esc(view.state.phase?.label || "工作与成长")} · ${esc(pillHint(view.state))}</p></div>
        <button class="button" type="button" data-work15="open">查看导航</button>
      </div>
      <form class="work15-form" id="work15-config">
        <fieldset><legend>工作日</legend>
          <div class="work15-weekdays">${WEEKDAYS.map(([value, label]) => `<label><input type="checkbox" name="workday" value="${value}" ${config.workdays.includes(value) ? "checked" : ""} aria-label="星期${label}" /><span>${label}</span></label>`).join("")}</div>
        </fieldset>
        <fieldset><legend>每日时间</legend>
          <div class="work15-time-grid">${TIME_POINTS.map(([label, key]) => `<label>${label}<input type="time" name="${key}" value="${esc(schedule[key])}" required /></label>`).join("")}</div>
          <p>午休和深度工作由相邻时间自动填充；每日学习至少 60 分钟。</p>
        </fieldset>
        <fieldset><legend>周五例会</legend>
          <div class="work15-range">
            <input type="time" name="fridayMeetingStart" aria-label="例会开始" value="${esc(schedule.fridayMeetingStart)}" required />
            <span>至</span>
            <input type="time" name="fridayMeetingEnd" aria-label="例会结束" value="${esc(schedule.fridayMeetingEnd)}" required />
          </div>
        </fieldset>
        <fieldset><legend>学习来源</legend>
          <label class="work15-source">指定任务分组
            <select name="source">
              <option value="">请选择分组</option>
              ${data.groups.map((group) => `<option value="${esc(group.id)}" ${group.id === config.growth.sourceGroupId ? "selected" : ""}>${esc(group.title)}</option>`).join("")}
            </select>
          </label>
          <p>该分组的未完成任务按分组顺序进入学习队列，并从工作队列排除。</p>
        </fieldset>
        <footer>
          <button class="button" type="button" data-work15="reset">恢复默认时间</button>
          <button class="button primary" type="submit">保存导航设置</button>
        </footer>
        ${ui.settingsError ? `<p class="work15-error" role="alert">${esc(ui.settingsError)}</p>` : ""}
      </form>`;
  }

  // ------------------------------------------------------------
  // Dialog
  // ------------------------------------------------------------
  function dialog(title, body, footer = "") {
    const overlay = document.querySelector("#overlay");
    if (!overlay) return;
    const focused = overlay.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focused?.id ? `#${CSS.escape(focused.id)}` : focused?.dataset.work15
      ? `[data-work15="${focused.dataset.work15}"]${focused.dataset.taskId ? `[data-task-id="${CSS.escape(focused.dataset.taskId)}"]` : ""}${focused.dataset.tab ? `[data-tab="${focused.dataset.tab}"]` : ""}${focused.dataset.kind ? `[data-kind="${focused.dataset.kind}"]` : ""}`
      : focused?.dataset.work15Estimate ? `[data-work15-estimate="${CSS.escape(focused.dataset.work15Estimate)}"]` : null;
    const scrollTop = overlay.querySelector(".work15-body")?.scrollTop || 0;
    overlay.innerHTML = `<div class="dialog-backdrop" data-return-focus=".work15-pill">
      <section class="dialog work15-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="dialog-head"><h2>${esc(title)}</h2><button class="icon-button" type="button" data-work15="close" aria-label="关闭">${shellIcon("close")}</button></header>
        ${body}
        <footer>${footer || '<button class="button" type="button" data-work15="close">完成</button>'}</footer>
      </section>
    </div>`;
    requestAnimationFrame(() => {
      if (!overlay.querySelector(".work15-dialog")) return;
      overlay.querySelector(".work15-body")?.scrollTo({ top: scrollTop });
      (focusKey && overlay.querySelector(focusKey) || overlay.querySelector(".work15-tabbar .active") || overlay.querySelector('[data-work15="close"]'))?.focus({ preventScroll: true });
    });
  }

  function openPanel() {
    const data = snap(); if (!data) return;
    ui.panelOpen = true;
    panelSignature = signature(data);
    const view = phaseView(data);
    const tabs = [["current", "当前阶段"], ["schedule", "全天安排"], ["queue", "任务队列"]];
    const body = ui.tab === "current" ? currentBody(view) : ui.tab === "schedule" ? scheduleBody(view) : queueBody(view);
    const footer = ui.tab === "current" && view.canAct && view.task
      ? `${view.list.length > 1 ? `${btn("skip", "跳过一次")}${btn("defer", "移至末尾")}` : ""}${btn("block", "卡住")}${btn("complete", "完成并继续", true)}`
      : `${btn("import", "批量添加任务")}${btn("close", "完成")}`;
    dialog("工作与成长", `<div class="work15-tabbar">${tabs.map(([value, label]) => `<button type="button" data-work15="tab" data-tab="${value}" class="${ui.tab === value ? "active" : ""}" aria-pressed="${ui.tab === value}">${label}</button>`).join("")}<button class="text-button" type="button" data-work15="settings">导航设置</button></div><main class="work15-body">${body}${ui.actionError ? `<p class="work15-error" role="alert">${esc(ui.actionError)}</p>` : ""}</main>`, footer);
    syncPill();
  }

  const btn = (action, label, primary = false, extra = "") => `<button type="button" class="button${primary ? " primary" : ""}" data-work15="${action}" ${extra}>${label}</button>`;

  function currentBody(view) {
    const phase = view.state;
    const task = view.task;
    let title = task?.title || `${view.kind === "growth" ? "学习" : "工作"}队列暂无任务`;
    let support = task ? `下一步：${model.resolveNextAction(task)}` : "队列中没有可执行任务。";
    if (view.paused) {
      title = phase.phase?.type === "meeting" ? "参加周例会" : "暂时离开工作队列";
      support = `队列保持原顺序，${phase.phase?.end || "下一阶段"} 后自动继续。`;
    } else if (phase.mode === "weekend-ready") {
      title = "开始周末学习";
      support = `从「${groupById(snap(), snap()?.navigation.config.growth.sourceGroupId)?.title || "未配置"}」继续，计划 ${phase.remainingMinutes} 分钟。`;
    } else if (phase.mode === "ended") {
      title = "今天的时间安排已结束";
      support = "仍可从队列中手动打开任务。";
    } else if (phase.mode === "off-day") {
      title = "今天没有自动安排";
      support = "可以查看任务队列，或调整工作日。";
    } else if (phase.mode === "next" || phase.mode === "gap") {
      title = `下一阶段：${phase.phase?.label || "工作"}`;
      support = `${phase.phase?.start || "稍后"} 开始。`;
    } else if (view.kind === "growth" && !snap()?.navigation.config.growth.sourceGroupId) {
      title = "尚未配置学习来源";
      support = "在导航设置中选择一个任务分组。";
    } else if (view.canAct && !task && view.list.length) {
      title = "选择任务继续";
      support = "自动顺延已暂停，可到任务队列选择下一项。";
    }
    return `<div class="work15-current">
      <div class="work15-current-top"><span>${esc(phase.phase?.label || "今日安排")}${phase.manual ? " · 手动选择" : ""}</span><span>${esc(phase.phase?.start || "")}${phase.phase?.end ? ` – ${esc(phase.phase.end)}` : ""}</span></div>
      <h3>${esc(title)}</h3><p>${esc(support)}</p>
      ${view.canAct && task ? btn("task", "打开任务", false, `data-task-id="${esc(task.id)}"`) : ""}
      ${phase.mode === "weekend-ready" ? btn("start-weekend", "开始学习", true) : ""}
    </div>`;
  }

  function scheduleBody(view) {
    const data = snap(); if (!data) return "";
    const phases = model.phasesForDate(data.navigation, now());
    const total = phases.reduce((sum, phase) => sum + model.minutes(phase.end) - model.minutes(phase.start), 0) || 1;
    const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now().getDay()];
    return `<p class="work15-note">${model.localDateKey(now())} · ${weekday}${now().getDay() === 5 && phases.length ? " · 含固定例会" : ""} · 手动选择在下一个时间边界恢复自动导航。</p>
      <div class="work15-timeline" aria-hidden="true">${phases.map((phase) => `<i class="${esc(phase.type)}" style="flex:${Math.max(1, model.minutes(phase.end) - model.minutes(phase.start)) / total}"></i>`).join("")}</div>
      ${phases.map((phase) => `<button class="work15-phase ${view.state.mode === "active" && view.state.phase?.id === phase.id ? "active" : ""}" type="button" data-work15="phase" data-phase="${esc(phase.id)}" ${view.paused || !["work", "growth"].includes(phase.type) ? "disabled" : ""}><time>${esc(phase.start)}–${esc(phase.end)}</time><span>${esc(phase.label)}</span><small>${view.state.mode === "active" && view.state.phase?.id === phase.id ? "当前" : ["work", "growth"].includes(phase.type) ? "进入" : "自动"}</small></button>`).join("") || '<p class="work15-empty">今日未安排工作时段。</p>'}`;
  }

  function queueBody(view) {
    const data = snap(); if (!data) return "";
    const list = queueFor(data, ui.kind);
    const interactive = view.canAct && view.kind === ui.kind;
    const blockedIds = (data.navigation.runtime?.blockedTaskIds || []).filter((id) => {
      const task = taskById(data, id);
      return task && task.status !== "done" && (ui.kind === "growth" ? task.groupId === data.navigation.config.growth.sourceGroupId : task.groupId !== data.navigation.config.growth.sourceGroupId);
    });
    return `<div class="work15-queue-head">
        <div class="segmented">${[["work", "工作队列"], ["growth", "学习队列"]].map(([kind, label]) => `<button type="button" data-work15="kind" data-kind="${kind}" class="${kind === ui.kind ? "active" : ""}" aria-pressed="${kind === ui.kind}">${label} ${queueFor(data, kind).length}</button>`).join("")}</div>
        ${interactive && view.task && list.length ? `<div class="work15-queue-actions">${list.length > 1 ? `${btn("skip", "跳过一次")}${btn("defer", "移至末尾")}` : ""}${btn("block", "卡住")}</div>` : ""}
      </div>
      <p class="work15-note">${ui.kind === "growth" ? `来源：「${esc(groupById(data, data.navigation.config.growth.sourceGroupId)?.title || "未配置")}」分组顺序` : "逾期 → 今日临近截止 → 今日高优先级 → 其他任务"}${interactive ? "" : " · 当前阶段仅可查看"}</p>
      ${list.map((task, index) => `<div class="work15-task">
        <span class="work15-rank">${String(index + 1).padStart(2, "0")}</span>
        <div class="work15-task-copy"><button type="button" data-work15="task" data-task-id="${esc(task.id)}">${esc(task.title || "未命名任务")}</button><p>${esc(model.resolveNextAction(task))}</p></div>
        <select class="work15-duration" data-work15-estimate="${esc(task.id)}" aria-label="${esc(task.title)}的预计时长">${[...new Set([30, 45, 60, 90, task.estimateMinutes || 60])].sort((a, b) => a - b).map((n) => `<option value="${n}" ${n === (task.estimateMinutes || 60) ? "selected" : ""}>${n} 分钟</option>`).join("")}</select>
        ${interactive ? view.task?.id === task.id ? '<span class="work15-queue-current">当前</span>' : `<button class="text-button" type="button" data-work15="choose" data-task-id="${esc(task.id)}">现在开始</button>` : ""}
      </div>`).join("") || '<p class="work15-empty">队列中没有未完成任务。</p>'}
      ${blockedIds.length ? `<h3 class="prefs-subheading">已暂停</h3>${blockedIds.map((id) => `<div class="work15-task"><div class="work15-task-copy"><button type="button" data-work15="task" data-task-id="${esc(id)}">${esc(taskById(data, id)?.title || "未命名任务")}</button></div><button class="text-button" type="button" data-work15="recover" data-task-id="${esc(id)}">恢复到队列</button></div>`).join("")}` : ""}`;
  }

  // ------------------------------------------------------------
  // Batch import (preview overlay)
  // ------------------------------------------------------------
  function importOpen() {
    ui.panelOpen = false;
    const data = snap(); if (!data) return;
    if (!ui.importDraft) {
      ui.importDraft = {
        raw: "", group: data.navigation.config.growth.sourceGroupId || data.groups[0]?.id || "",
        minutes: 60, preview: null, selected: new Set(), estimates: {}, error: "",
      };
    }
    const draft = ui.importDraft;
    dialog("批量添加任务", `<main class="work15-body work15-import">
      <p class="work15-note">支持纯文本、JSON 任务列表与 Loop 学习计划。导入前可选择任务、调整时长并跳过重复项。</p>
      <div class="work15-import-fields">
        <label>添加到<select id="work15-import-group">${data.groups.map((group) => `<option value="${esc(group.id)}" ${group.id === draft.group ? "selected" : ""}>${esc(group.title)}</option>`).join("")}</select></label>
        <label>默认时长<select id="work15-import-minutes">${[30, 45, 60, 90].map((n) => `<option value="${n}" ${n === draft.minutes ? "selected" : ""}>${n} 分钟</option>`).join("")}</select></label>
      </div>
      <div class="work15-file"><label for="work15-import-file">任务列表</label><input type="file" id="work15-import-file" accept=".json,.txt,.md" aria-label="选择 JSON 或文本文件" /></div>
      <textarea id="work15-import-raw" aria-label="待导入任务内容" placeholder="每行一个任务，或粘贴 JSON 任务列表">${esc(draft.raw)}</textarea>
      ${draft.error ? `<p class="work15-error" role="alert">${esc(draft.error)}</p>` : ""}
    </main>`, `${btn("close", "取消")}${btn("preview", "预览任务", true)}`);
    requestAnimationFrame(() => document.querySelector("#work15-import-raw")?.focus({ preventScroll: true }));
  }

  function importPreview() {
    const draft = ui.importDraft;
    const preview = draft.preview;
    dialog("核对导入任务", `<main class="work15-body">
      <p class="work15-note">${preview.items.length} 项，${preview.existingTasks.length} 项重复</p>
      <ul class="work15-preview">${preview.items.map((item, index) => `<li>
        <input type="checkbox" id="work15-item-${index}" data-work15-check="${index}" ${draft.selected.has(item.key) ? "checked" : ""} ${item.duplicateReason ? "disabled" : ""} />
        <label for="work15-item-${index}">${esc(item.title)}${item.duplicateReason ? "<small>重复 · 跳过</small>" : ""}</label>
        <input type="number" min="1" max="720" required data-work15-minutes="${index}" aria-label="${esc(item.title)}的预计时长（分钟）" value="${draft.estimates[item.key] || item.estimateMinutes}" ${item.duplicateReason ? "disabled" : ""} />
      </li>`).join("")}</ul>
      <p class="work15-preview-summary" id="work15-preview-summary"></p>
    </main>`, `${btn("back-import", "返回编辑")}${btn("import-confirm", "添加所选任务", true)}`);
    summary();
  }

  function summary() {
    const draft = ui.importDraft;
    if (!draft?.preview) return;
    const list = draft.preview.items.filter((item) => draft.selected.has(item.key));
    const box = document.querySelector("#work15-preview-summary");
    if (!box) return;
    const invalid = [...document.querySelectorAll(".work15-preview input[type=number]")].some((input) => draft.selected.has(draft.preview.items[Number(input.dataset.work15Minutes)].key) && !input.validity.valid);
    const minutes = list.reduce((sum, item) => sum + Number(draft.estimates[item.key] || item.estimateMinutes), 0);
    box.innerHTML = `<span>已选择 ${list.length} 项</span><span${invalid ? ' class="work15-error"' : ""}>${invalid ? "时长需为 1–720 的整数分钟" : `预计 ${minutes} 分钟`}</span>`;
    const confirm = document.querySelector('[data-work15="import-confirm"]');
    if (confirm) confirm.disabled = !list.length || invalid;
  }

  function saveConfig(form) {
    const data = snap(); if (!data) return;
    const form_data = new FormData(form);
    const schedule = { ...data.navigation.config.schedule };
    Object.keys(schedule).forEach((key) => { schedule[key] = String(form_data.get(key) || ""); });
    const validation = model.validateSchedule(schedule);
    ui.settingsError = validation.valid ? "" : validation.errors[0].message;
    if (ui.settingsError) {
      const host = document.querySelector(".settings-document");
      if (host && typeof shellSettingsSyncControls === "function") shellSettingsSyncControls();
      return;
    }
    const result = bridge.updateConfig({
      ...data.navigation.config,
      schedule,
      workdays: form_data.getAll("workday").map(Number),
      work: { ...data.navigation.config.work, autoAdvance: true },
      growth: { ...data.navigation.config.growth, sourceGroupId: String(form_data.get("source") || ""), autoAdvance: true },
    });
    if (result && result.success === false) { ui.settingsError = result.message || "导航设置未保存"; return; }
    bridge.setRuntime({ manualPhaseId: "", manualPhaseExpiresAt: "" });
    toast("导航设置已保存");
  }

  // ------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------
  function reorder(action) {
    const data = snap(); if (!data) return;
    const view = phaseView(data);
    const kind = ui.tab === "queue" ? ui.kind : view.kind;
    if (!view.canAct || view.kind !== kind) return toast("当前阶段仅可查看队列");
    const ids = queueIds(data, kind).slice();
    const current = ids[0];
    if (!current) return toast("当前没有任务");
    if (action === "block") {
      const result = bridge.blockTask(current, kind);
      if (!result.success) return toast("任务状态已变化，请重新选择");
      toast(result.nextTaskId ? "已标记卡住，已顺移到下一项" : "已标记卡住");
      if (ui.panelOpen) openPanel();
      return undefined;
    }
    if (ids.length < 2) return undefined;
    const next = action === "skip" ? [ids[1], ids[0], ...ids.slice(2)] : [...ids.slice(1), ids[0]];
    bridge.setRuntime({
      [kind === "growth" ? "growthQueueIds" : "workQueueIds"]: next,
      [kind === "growth" ? "activeGrowthTaskId" : "activeWorkTaskId"]: next[0],
    });
    toast(action === "skip" ? "已跳过一次，稍后会回到队首任务" : "已移至队尾");
    if (ui.panelOpen) openPanel();
  }

  function complete() {
    const data = snap(); if (!data) return;
    const view = phaseView(data);
    if (!view.canAct) return;
    const taskId = view.kind === "growth" ? data.activeGrowthTaskId : data.activeWorkTaskId;
    if (!taskId) return toast("当前没有可完成的任务");
    const result = bridge.completeTask(taskId, view.kind);
    if (!result.success) {
      ui.actionError = result.code === "CONCLUSION_REQUIRED" ? "请先打开任务填写结论，再标记完成。"
        : result.code === "FLOW_INCOMPLETE" ? "任务中仍有未完成节点，请先打开任务处理。" : "任务状态已变化，请重新选择。";
      openPanel();
      return;
    }
    toast(result.nextTaskId ? "已完成，已顺移到下一项" : "已完成当前任务");
    closePanel({ restoreFocus: false });
  }

  function choose(button) {
    const data = snap(); if (!data) return;
    const kind = ui.kind;
    const view = phaseView(data);
    if (!view.canAct || view.kind !== kind) return;
    const ids = queueIds(data, kind).slice();
    const index = ids.indexOf(button.dataset.taskId);
    if (index < 0 || view.task?.id === ids[index]) return;
    bridge.setRuntime({ [kind === "growth" ? "growthQueueIds" : "workQueueIds"]: [ids[index], ...ids.slice(0, index), ...ids.slice(index + 1)], [kind === "growth" ? "activeGrowthTaskId" : "activeWorkTaskId"]: ids[index], [kind === "growth" ? "growthAdvancePaused" : "workAdvancePaused"]: false });
    if (ui.panelOpen) openPanel();
    toast("已切换当前任务");
  }

  async function unlock(form) {
    const input = form.querySelector("#work15-password");
    let ok = false;
    try { ok = await gate?.verifyPassword(input?.value || ""); } catch (_) { ok = false; }
    if (!ok) {
      ui.gateError = "密码不正确，请重试。";
      if (typeof shellSettingsSyncControls === "function") shellSettingsSyncControls();
      return;
    }
    ui.enabled = true;
    globalThis.LoopUiPreferences?.update({ workNavigationEnabled: true });
    ui.gateOpen = false;
    ui.gateError = "";
    localStorage.setItem(ENABLED_KEY, "1");
    if (typeof shellSettingsSyncControls === "function") shellSettingsSyncControls();
    syncPill();
    toast("工作与成长导航已开启");
  }

  // ------------------------------------------------------------
  // Bindings
  // ------------------------------------------------------------
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "work15-unlock" && event.target.id !== "work15-config") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.target.id === "work15-config") saveConfig(event.target);
    else void unlock(event.target);
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target.id === "work15-import-raw" && ui.importDraft) ui.importDraft.raw = event.target.value;
    if (event.target.dataset.work15Minutes !== undefined && ui.importDraft?.preview) {
      const item = ui.importDraft.preview.items[Number(event.target.dataset.work15Minutes)];
      if (event.target.validity.valid) ui.importDraft.estimates[item.key] = Number(event.target.value);
      summary();
    }
  });

  document.addEventListener("change", async (event) => {
    const target = event.target;
    if (target.dataset.work15Estimate) {
      bridge.updateEstimate(target.dataset.work15Estimate, Number(target.value));
      return;
    }
    if (!ui.importDraft) return;
    if (target.dataset.work15Check !== undefined && ui.importDraft.preview) {
      const item = ui.importDraft.preview.items[Number(target.dataset.work15Check)];
      if (target.checked) ui.importDraft.selected.add(item.key); else ui.importDraft.selected.delete(item.key);
      summary();
    }
    if (target.id === "work15-import-group") ui.importDraft.group = target.value;
    if (target.id === "work15-import-minutes") ui.importDraft.minutes = Number(target.value);
    if (target.id === "work15-import-file") {
      const file = target.files?.[0];
      if (file) {
        const draft = ui.importDraft;
        draft.raw = await file.text();
        const box = document.querySelector("#work15-import-raw");
        if (box && ui.importDraft === draft) box.value = draft.raw;
      }
    }
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-work15]");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = button.dataset.work15;
    ui.actionError = "";
    const data = snap();
    if (action === "toggle") {
      if (ui.enabled) {
        ui.enabled = false;
        globalThis.LoopUiPreferences?.update({ workNavigationEnabled: false });
        localStorage.setItem(ENABLED_KEY, "0");
        document.querySelector("#overlay").innerHTML = "";
        syncPill();
        if (typeof shellSettingsSyncControls === "function") shellSettingsSyncControls();
        toast("工作与成长导航已关闭");
      } else {
        ui.gateOpen = !ui.gateOpen;
        ui.gateError = "";
        if (typeof shellSettingsSyncControls === "function") shellSettingsSyncControls();
        requestAnimationFrame(() => document.querySelector("#work15-password")?.focus({ preventScroll: true }));
      }
      return;
    }
    if (!data) return;
    if (action === "open") { ui.tab = "current"; ui.kind = phaseView(data).kind; openPanel(); }
    else if (action === "close") closePanel();
    else if (action === "tab") { ui.tab = button.dataset.tab; openPanel(); }
    else if (action === "kind") { ui.kind = button.dataset.kind; openPanel(); }
    else if (action === "settings") {
      closePanel({ restoreFocus: false });
      bridge.openSettings();
    } else if (action === "task") {
      closePanel({ restoreFocus: false });
      bridge.openTask(button.dataset.taskId, { kind: ui.tab === "queue" ? ui.kind : phaseView(data).kind });
    } else if (action === "phase") {
      const phases = model.phasesForDate(data.navigation, now());
      const phase = phases.find((phase) => phase.id === button.dataset.phase);
      if (!phase || !["work", "growth"].includes(phase.type) || phaseView(data).paused) return;
      bridge.setRuntime({ manualPhaseId: phase.id, manualPhaseExpiresAt: model.nextBoundaryAt(now(), data.navigation) });
      ui.kind = phase.type === "growth" ? "growth" : "work";
      ui.tab = "current";
      openPanel();
    } else if (action === "choose") choose(button);
    else if (action === "start-weekend") { bridge.setRuntime({ weekendStartedAt: now().toISOString() }); openPanel(); }
    else if (["skip", "defer", "block"].includes(action)) reorder(action);
    else if (action === "complete") complete();
    else if (action === "recover") {
      const result = bridge.recoverTask(button.dataset.taskId);
      if (!result.success) ui.actionError = result.code === "BLOCKED_NODES" ? "任务中仍有卡住节点，请先打开任务处理。" : "任务状态已变化，无法恢复，请重新选择。";
      else toast("已恢复到队列");
      openPanel();
    }
    else if (action === "reset") {
      const form = document.querySelector("#work15-config");
      form?.querySelectorAll("input[type=time]").forEach((input) => { input.value = model.DEFAULT_SCHEDULE[input.name] || ""; });
      ui.settingsError = "";
    } else if (action === "import") importOpen();
    else if (action === "back-import") { ui.importDraft.preview = null; importOpen(); }
    else if (action === "preview") {
      const draft = ui.importDraft;
      draft.raw = document.querySelector("#work15-import-raw").value;
      draft.group = document.querySelector("#work15-import-group").value;
      draft.minutes = Number(document.querySelector("#work15-import-minutes").value);
      const group = groupById(data, draft.group);
      if (!group) { draft.error = "请先选择目标分组，再预览任务。"; importOpen(); return; }
      const preview = model.previewTaskBatchImport(draft.raw, data.tasks, { groupId: draft.group || "ungrouped", defaultEstimateMinutes: draft.minutes });
      if (!preview.valid) { draft.error = preview.errors[0]?.message || "任务列表无效"; importOpen(); return; }
      draft.preview = preview;
      draft.selected = new Set(preview.newTasks.map((item) => item.key));
      draft.estimates = {};
      draft.error = "";
      importPreview();
    } else if (action === "import-confirm") {
      const draft = ui.importDraft;
      const items = draft.preview.items.filter((item) => draft.selected.has(item.key));
      if (!items.length) return;
      const estimateMinutesByKey = {};
      items.forEach((item) => { estimateMinutesByKey[item.key] = draft.estimates[item.key] || item.estimateMinutes; });
      const result = bridge.importTaskBatch(draft.raw, {
        groupId: draft.group,
        defaultEstimateMinutes: draft.minutes,
        selectedKeys: items.map((item) => item.key),
        estimateMinutesByKey,
      });
      if (!result?.success) {
        draft.error = result?.code === "GROUP_NOT_FOUND" ? "目标分组已不存在，请重新选择。" : "任务导入失败，请检查内容后重试。";
        draft.preview = null;
        importOpen();
        return;
      }
      ui.importDraft = null;
      closePanel();
      toast(`已添加 ${result.importedCount} 个任务`);
    }
  }, true);

  document.addEventListener("loop:overlay-dismiss", () => { ui.panelOpen = false; });
  const overlay = document.querySelector("#overlay");
  if (overlay) new MutationObserver(() => {
    const opened = Boolean(overlay.querySelector(".work15-dialog"));
    if (!opened) ui.panelOpen = false;
    document.querySelector(".work15-pill")?.setAttribute("aria-expanded", String(opened));
  }).observe(overlay, { childList: true });

  globalThis.LoopWork = Object.freeze({ settingsBody, syncPill, openPanel, restorePreferences(value) { ui.enabled = value.workNavigationEnabled === true; } });
  syncPill();
  // Refresh the small temporal surface without redrawing the task/editor shell.
  window.setInterval(syncPill, 30000);
  // app.js already ran its first render before this script loaded; refresh the
  // settings page so the advanced block is present immediately.
  if (state.settingsOpen && activeSettingsPage === "advanced" && typeof render === "function") render();
})();

// ============================================================
// Loop -- settings pages
//
// Layout, row anatomy and control vocabulary come from the frozen Demo's
// ninth stage (loop-plane-phase1.html settingCategories/renderSettings and
// loop-settings-phase9-refinement.js row/select/toggle + .settings-layout.phase9).
// Every value, write path and side effect is the project's own:
// applySetting(), save(), the backup IPC, the updater and the work-rhythm API.
// ============================================================

const SHELL_SETTINGS_CATEGORIES = [
  ["appearance", "外观", "sun"],
  ["tasks", "任务与浮窗", "tasks"],
  ["knowledge", "知识笔记", "note"],
  ["data", "数据", "folder"],
  ["updates", "软件更新", "arrow"],
  ["advanced", "高级功能", "settings"],
  ["help", "帮助与反馈", "note"],
];

// Single source of truth: app.js owns the stored keys and their display text.
// Read lazily — settings.js loads before app.js, so the binding does not exist yet.
function shellFontScaleChoices() {
  return typeof fontScaleLabels === "object" ? fontScaleLabels : {};
}

function shellSettingsRow(label, description, control) {
  return `<div class="setting-row"><div><span class="setting-label">${esc(label)}</span><p>${esc(description)}</p></div>${control}</div>`;
}

function shellSettingsChoice(key, description, choices, value) {
  const label = choices[value] || Object.values(choices)[0] || "";
  return shellSettingsRow(
    SHELL_SETTINGS_CHOICE_LABELS[key] || key,
    description,
    `<button class="prefs-choice" type="button" data-action="open-settings-choice" data-key="${escAttr(key)}" aria-haspopup="menu" aria-expanded="false" aria-label="${escAttr(`${SHELL_SETTINGS_CHOICE_LABELS[key] || key}：${label}`)}"><span>${esc(label)}</span>${shellIcon("chevron")}</button>`,
  );
}

const SHELL_SETTINGS_CHOICE_LABELS = {
  "font-scale": "字号",
  "zh-font": "中文字体",
  "en-font": "英文字体",
  "task-filter": "默认任务范围",
  "priority-filter": "默认优先级筛选",
  "new-task-priority": "新任务优先级",
  "knowledge-width": "笔记页宽",
  "knowledge-mode": "笔记视图",
};

const SHELL_SETTINGS_CHOICE_DESCRIPTIONS = {
  "font-scale": "调整界面字号，保持任务和处理流的阅读节奏。",
  "zh-font": "内置字体可直接使用；其他字体需设备已安装。",
  "en-font": "用于英文、数字与中英文混排。",
  "task-filter": "打开今日、任务仓库与分组时使用。",
  "priority-filter": "进入任务视图时的默认筛选范围。",
  "new-task-priority": "新建任务时使用，创建后仍可单独调整。",
};

function shellSettingsChoiceOptions(key) {
  if (key === "font-scale") return shellFontScaleChoices();
  if (key === "zh-font") return zhFontLabels;
  if (key === "en-font") return enFontLabels;
  if (key === "task-filter") return taskFilterLabels;
  if (key === "priority-filter") return priorityFilterLabels;
  if (key === "new-task-priority") return priorityLabels;
  if (key === "knowledge-width") return SHELL_NOTE_WIDTH_NAMES;
  if (key === "knowledge-mode") return SHELL_NOTE_MODE_NAMES;
  return {};
}

function shellSettingsChoiceValue(key) {
  if (key === "font-scale") return state.fontScale;
  if (key === "zh-font") return state.zhFont;
  if (key === "en-font") return state.enFont;
  if (key === "task-filter") return state.taskFilter;
  if (key === "priority-filter") return state.priorityFilter;
  if (key === "new-task-priority") return state.newTaskPriority;
  if (key === "knowledge-width") return shellNoteWidth();
  if (key === "knowledge-mode") return shellKnowledgeMode();
  return "";
}

function shellSettingsToggle(label, description, checked, attributes) {
  return shellSettingsRow(label, description, `<button class="prefs-switch" type="button" role="switch" aria-label="${escAttr(label)}" aria-checked="${checked === true}" ${attributes}></button>`);
}

function shellSettingsAction(label, description, text, attributes) {
  return shellSettingsRow(label, description, `<button class="button" type="button" ${attributes}>${esc(text)}</button>`);
}

// ------------------------------------------------------------
// Page bodies
// ------------------------------------------------------------

function shellSettingsAppearance() {
  const dark = state.theme === "dark";
  const theme = `<div class="prefs-theme" role="group" aria-label="主题">${["light", "dark"].map((value) => `<button class="theme-option ${(dark ? "dark" : "light") === value ? "active" : ""}" type="button" data-setting-button="theme" data-value="${value}" aria-pressed="${(dark ? "dark" : "light") === value}"><span class="theme-mini ${value}" aria-hidden="true"><i></i><b></b><span></span></span><span>${shellIcon(value === "light" ? "sun" : "moon")}${value === "light" ? "浅色" : "深色"}</span></button>`).join("")}</div>`;
  return `<h2>外观</h2><p>选择舒适的阅读方式，调整会即时应用。</p>
    ${shellSettingsRow("主题", "适应你的工作环境。", theme)}
    ${shellSettingsChoice("font-scale", SHELL_SETTINGS_CHOICE_DESCRIPTIONS["font-scale"], shellSettingsChoiceOptions("font-scale"), state.fontScale)}
    ${shellSettingsChoice("zh-font", SHELL_SETTINGS_CHOICE_DESCRIPTIONS["zh-font"], shellSettingsChoiceOptions("zh-font"), state.zhFont)}
    ${shellSettingsChoice("en-font", SHELL_SETTINGS_CHOICE_DESCRIPTIONS["en-font"], shellSettingsChoiceOptions("en-font"), state.enFont)}
    ${window.LoopContinuity28?.settings() || ""}
    <div class="font-preview"><div><span>字体预览</span><span>中文 · English · 0123456789</span></div><b>PCIe MSI 中断路径排查</b><p>沿设备、驱动到内核中断域逐层确认。<br />Record each step, keep the context. 0123456789</p></div>
    <footer class="settings-footer"><span>不需要额外保存</span><button class="text-button" type="button" data-action="reset-appearance">恢复默认外观</button></footer>`;
}

function shellSettingsTasks() {
  return `<h2>任务与浮窗</h2><p>设置常用默认值，减少每次打开任务时的调整。</p>
    ${shellSettingsChoice("task-filter", SHELL_SETTINGS_CHOICE_DESCRIPTIONS["task-filter"], shellSettingsChoiceOptions("task-filter"), state.taskFilter)}
    ${shellSettingsChoice("priority-filter", SHELL_SETTINGS_CHOICE_DESCRIPTIONS["priority-filter"], shellSettingsChoiceOptions("priority-filter"), state.priorityFilter)}
    ${shellSettingsChoice("new-task-priority", SHELL_SETTINGS_CHOICE_DESCRIPTIONS["new-task-priority"], shellSettingsChoiceOptions("new-task-priority"), state.newTaskPriority)}
    <h3 class="prefs-subheading">今日浮窗</h3>
    ${shellSettingsToggle("显示今日浮窗", "在独立小窗口中查看今日任务与速记。", todayWidgetWindowState.visible === true, `data-action="toggle-today-widget-visibility" ${desktopTodayWidget ? "" : "disabled"}`)}
    ${shellSettingsToggle("始终置顶", "使用其他应用时，浮窗仍保持在最前面。", todayWidgetWindowState.alwaysOnTop === true, `data-action="toggle-today-widget-always-on-top" ${desktopTodayWidget ? "" : "disabled"}`)}
    ${shellSettingsToggle("鼠标穿透", "让点击穿过浮窗，操作后面的应用。", todayWidgetWindowState.clickThrough === true, `data-action="toggle-today-widget-click-through" ${desktopTodayWidget ? "" : "disabled"}`)}
    <h3 class="prefs-subheading">桌面提醒</h3>
    ${typeof desktopReminderSettingsRow === "function" ? desktopReminderSettingsRow() : ""}
    <p class="prefs-native-caption">快捷键 <kbd>⌘ / Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd> 可切换鼠标穿透。</p>`;
}

function shellSettingsKnowledge() {
  return `<h2>知识笔记</h2><p>以下设置对所有笔记生效，修改后自动保存。</p>
    ${shellSettingsChoice("knowledge-width", "默认适合阅读，较宽适合代码与表格。", shellSettingsChoiceOptions("knowledge-width"), shellNoteWidth())}
    ${shellSettingsChoice("knowledge-mode", "笔记内切换视图时，也会同步此设置。", shellSettingsChoiceOptions("knowledge-mode"), shellKnowledgeMode())}
    <p class="prefs-native-caption">笔记的字体与字号跟随「外观」设置。</p>`;
}

function shellSettingsData() {
  // Phase26: the Demo puts 最近删除 at the top of 数据; it operates on the
  // software's own objects, so it stays separate from the whole-workspace
  // backup/replace/restart flow below it.
  const deleted = typeof state !== "undefined" && Array.isArray(state.recentlyDeleted) ? state.recentlyDeleted.length : 0;
  const recoveryEntry = typeof recovery26Open === "function"
    ? `<div class="recovery26-data-entry"><div>最近删除<small>恢复任务、分组、节点与笔记${deleted ? ` · ${deleted} 项` : ""}</small></div><button class="button" type="button" data-recovery26="open">管理</button></div>`
    : "";
  return `<h2>数据</h2><p>备份整个工作空间，在需要时恢复。</p>
    ${recoveryEntry}
    ${shellSettingsAction("完整备份", "包含任务、分组、处理记录、笔记恢复内容及应用偏好。", "导出备份", `data-backup-action="export" ${desktopDataBackup ? "" : "disabled"}`)}
    <h3 class="prefs-subheading">恢复工作空间</h3>
    ${shellSettingsAction("从备份文件恢复", "选择 Loop 完整备份（.loopbackup）。", "选择文件", `data-backup-action="import-file" ${desktopDataBackup ? "" : "disabled"}`)}
    ${shellSettingsAction("从备份目录恢复", "支持 Loop 当前及历史版本的备份目录。", "选择目录", `data-backup-action="import-directory" ${desktopDataBackup ? "" : "disabled"}`)}
    <div class="prefs-inline-note">${shellIcon("history")}<span>恢复会替换当前工作空间。Loop 会先备份当前数据，失败时自动回滚；成功后重新启动。<br />外部绑定的 Markdown 文件需要另行备份。</span></div>
    <p class="prefs-transfer-status" data-backup-status role="status"></p>`;
}

function shellSettingsInfo(label, description, value) {
  return shellSettingsRow(label, description, `<span class="prefs-info-value">${esc(value)}</span>`);
}

/** The changing part of 软件更新, re-rendered in place on every state change. */
function shellSettingsUpdateCardBody() {
  const update = appUpdateState;
  const status = update.status;
  const checkedAt = update.lastCheckedAt ? new Date(update.lastCheckedAt) : null;
  const checkedLabel = checkedAt && !Number.isNaN(checkedAt.getTime())
    ? `刚刚检查 · ${checkedAt.getHours()}:${String(checkedAt.getMinutes()).padStart(2, "0")}`
    : "";
  const titles = {
    available: "有可用更新",
    downloading: `正在下载更新 · ${Math.round(update.percent || 0)}%`,
    downloaded: "更新已准备好",
    preparing: "正在保存并准备升级…",
    installing: "正在完成升级…",
    error: update.retryAction === "check" ? "检查更新失败" : "更新未完成",
    unsupported: "当前环境暂不支持应用内更新",
    latest: "当前已是最新版本",
    checking: "正在检查更新…",
    idle: "尚未检查更新",
  };
  const bodies = {
    available: "后台下载完成后，自动安装并重新启动。",
    downloading: "下载期间可继续处理任务；完成后应用会自动重启。",
    downloaded: update.errorCode ? "升级前保存未完成，应用没有退出。请检查磁盘空间或目录权限后重试。" : "请保存正在编辑的内容，然后重启完成安装。",
    preparing: "正在安全写入任务与知识笔记草稿。",
    installing: "应用即将自动重启，请稍候。",
    error: updateErrorPresentation(update.errorCode).detail,
    latest: checkedLabel,
    checking: "正在连接 GitHub Release。",
    idle: "应用启动后会定期检查，也可以手动检查。",
    unsupported: update.unsupportedReason === "development" ? "开发检阅不会连接更新服务。" : "请从发布页获取安装包。",
  };
  const busy = ["checking", "downloading", "preparing", "installing"].includes(status);
  const percent = Math.max(0, Math.min(100, Math.round(Number(update.percent) || 0)));
  const progress = status === "downloading"
    ? `<div class="prefs-update-progress" role="progressbar" aria-label="更新下载进度" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></div>`
    : "";
  // One entry point. What it does follows the state, so it is never a no-op:
  // checking while busy is disabled, otherwise it offers the only useful action.
  const actions = status === "available" ? '<button class="button primary" type="button" data-update-action="download">升级并重启</button>'
    : status === "downloaded" ? '<button class="button primary" type="button" data-update-action="install">重启并安装</button>'
      : status === "error" ? `<button class="button primary" type="button" data-update-action="${update.retryAction}">${update.retryAction === "check" ? "重新检查" : update.retryAction === "install" ? "重试安装" : "重试下载"}</button>`
        : `<button class="button" type="button" data-update-action="check" ${busy || !update.supported ? "disabled" : ""}>${status === "checking" ? "检查中…" : "检查更新"}</button>`;
  const currentVersion = String(update.currentVersion || APP_VERSION || "");
  const hasTarget = ["available", "downloading", "downloaded", "preparing", "installing"].includes(status)
    || (status === "error" && update.retryAction !== "check");
  const targetVersion = hasTarget && update.version && update.version !== currentVersion ? String(update.version) : "";
  const versions = `<div class="prefs-update-version"><span aria-label="${escAttr(`当前版本 v${currentVersion}`)}">v${esc(currentVersion)}</span>${targetVersion ? `<span class="prefs-version-arrow" aria-hidden="true">→</span><strong aria-label="${escAttr(`更新版本 v${targetVersion}`)}">v${esc(targetVersion)}</strong>` : ""}</div>`;
  return `<div class="prefs-update-heading"><div><h3>${esc(titles[status] || "软件更新")}</h3>${versions}</div><div class="prefs-update-actions">${actions}</div></div>
      ${bodies[status] ? `<p>${esc(bodies[status])}</p>` : ""}
      ${progress}`;
}

/** Cheap in-place sync used by app.js whenever appUpdateState changes. */
function shellSettingsSyncUpdateCard() {
  if (typeof activeSettingsPage === "string" && activeSettingsPage !== "updates") return;
  const node = document.querySelector("[data-shell-update-detail]");
  if (!node) return;
  node.innerHTML = shellSettingsUpdateCardBody();
  const toggle = document.querySelector("[data-update-automatic]");
  if (toggle) {
    toggle.setAttribute("aria-checked", String(appUpdateState.automaticChecks === true));
    toggle.disabled = !appUpdateState.supported || updatePreferenceInFlight;
    const caption = toggle.closest(".setting-row")?.querySelector("p");
    if (caption) caption.textContent = appUpdateState.preferenceError ? "设置未保存，请检查目录权限后重试。" : appUpdateState.automaticChecks ? "应用启动后定期检查。" : "仅在手动操作时检查。";
  }
}

function shellSettingsUpdates() {
  const update = appUpdateState;
  return `<h2>软件更新</h2><p>检查新版本，管理更新方式。</p>
    <section class="prefs-update-detail" data-shell-update-detail aria-live="polite">${shellSettingsUpdateCardBody()}</section>
    <div class="prefs-update-options">${shellSettingsToggle("自动检查更新", update.preferenceError ? "设置未保存，请检查目录权限后重试。" : update.automaticChecks ? "应用启动后定期检查。" : "仅在手动操作时检查。", update.automaticChecks === true, `data-update-automatic ${update.supported && !updatePreferenceInFlight ? "" : "disabled"}`)}</div>
    ${update.supported ? "" : '<p class="prefs-native-caption">开发模式或未签名的构建不连接更新服务。</p>'}`;
}

function shellSettingsAdvanced() {
  // work.js owns this page (Demo phase 15): unlock gate + schedule form.
  const body = typeof globalThis.LoopWork?.settingsBody === "function"
    ? globalThis.LoopWork.settingsBody()
    : `<h2>高级功能</h2><p>按需要启用附加能力，保持日常任务工作台简洁。</p>`;
  return `${body}<h3 class="prefs-subheading">时间预览</h3>
    ${shellSettingsAction("预览时间", loopClockIsPreview() ? `当前预览：${loopStamp()}。不修改系统时间。` : "临时切换界面中的日期与时间，不修改系统时间。", "设置预览", 'data-action="time18-clock" aria-haspopup="dialog" aria-expanded="false"')}
    ${loopClockIsPreview() ? '<button class="text-button" type="button" data-action="time18-clear">恢复真实时间</button>' : ""}`;
}

// ------------------------------------------------------------
// Help & feedback  (Demo phase 14)
//
// Structure, copy and control vocabulary are ported from the frozen Demo's
// loop-help-phase14.js: a help page (.help14-intro / .help14-topics) plus a
// feedback dialog (.help14-form) mounted in #overlay. Validation, consent and
// submission are the project's own (validateBugReportDraft / submitBugReport /
// bugReports.submit); only the presentation is from the Demo.
// ------------------------------------------------------------

const SHELL_HELP_TOPICS = [
  ["今日、仓库和分组有什么关系？", "任务仓库保存全部任务。分组负责归类；今日是需要今天处理的任务集合，加入今日不会改变原来的分组。今日浮窗只显示今日任务，速记单独展示。"],
  ["如何保留问题的解决过程？", "在处理流中逐层拆分节点，记录验证过程，并更新节点状态。任务进展与结论保留整体上下文；知识笔记适合整理可复用的内容。"],
  ["如何备份数据和笔记？", "在「数据」设置中导出完整备份。外部绑定的 Markdown 文件需要单独备份。恢复前，桌面应用会先备份并校验当前数据。"],
];

function shellSettingsHelp() {
  const open = Number(state.helpTopicOpen);
  return `<h2>帮助与反馈</h2><p>了解 Loop 的使用方式，记录遇到的问题与建议。</p>
    ${globalThis.LoopManual27?.entry() || ""}
    <section class="help14-intro">
      <div><span class="setting-label">问题与建议</span><p>描述遇到的情况，保留复现步骤与预期结果。</p></div>
      <button class="button" type="button" data-action="open-help-feedback">提交反馈</button>
    </section>
    <h3 class="prefs-subheading">使用说明</h3>
    <ul class="help14-topics">
      ${SHELL_HELP_TOPICS.map(([title, body], index) => `<li>
        <button type="button" data-action="toggle-help-topic" data-topic="${index}" aria-expanded="${index === open}">${esc(title)}${shellIcon(index === open ? "minus" : "plus")}</button>
        ${index === open ? `<p>${esc(body)}</p>` : ""}
      </li>`).join("")}
    </ul>
    <div class="setting-row"><div><span class="setting-label">关于 Loop</span><p>个人任务与处理过程管理</p></div><span class="muted">v${esc(APP_VERSION || "0.1.200")}</span></div>`;
}

function shellHelpFeedbackField(key, label, optional = false, textarea = false, rows = 3) {
  const draft = state.feedbackDraft;
  const error = state.feedbackErrors[key];
  const size = key === "title" ? 100 : key === "contact" ? 200 : 5000;
  const attrs = `id="help14-${key}" data-feedback-field="${key}" maxlength="${size}" aria-invalid="${Boolean(error)}"${error ? ` aria-describedby="help14-${key}-error"` : ""}`;
  const hint = optional ? "可选" : key === "title" ? "3–100 字" : key === "description" ? "10–5000 字" : "";
  const control = textarea
    ? `<textarea ${attrs} rows="${rows}">${esc(draft[key] || "")}</textarea>`
    : `<input ${attrs} value="${escAttr(draft[key] || "")}" autocomplete="off" />`;
  return `<div class="help14-field">
    <label for="help14-${key}">${esc(label)}${hint ? `<small>${hint}</small>` : ""}</label>
    ${control}
    ${error ? `<p id="help14-${key}-error" class="help14-error" role="alert">${esc(error)}</p>` : ""}
  </div>`;
}

function shellHelpFeedbackResult() {
  const result = state.feedbackResult || {};
  return `<div class="help14-result" role="status">
    ${shellIcon("check")}
    <h3>反馈提交成功</h3>
    ${result.reportId ? `<p>反馈编号 <strong>${esc(result.reportId)}</strong></p>` : ""}
    ${result.issueNumber ? `<p>GitHub Issue：${result.issueUrl ? `<a href="${escAttr(result.issueUrl)}" target="_blank" rel="noreferrer">#${esc(String(result.issueNumber))}</a>` : `#${esc(String(result.issueNumber))}`}</p>` : ""}
    <footer><button class="button primary" type="button" data-action="close-help-feedback">完成</button></footer>
  </div>`;
}

function shellHelpFeedbackDialog() {
  const overlay = shellOverlay();
  if (!overlay) return;
  const draft = state.feedbackDraft;
  const errors = state.feedbackErrors;
  const busy = state.feedbackSubmitting === true;
  const body = state.feedbackResult
    ? shellHelpFeedbackResult()
    : `<p class="help14-caption">说明发生了什么，以及你希望的结果。</p>
      ${shellHelpFeedbackField("title", "问题标题")}
      <div class="help14-field">
        <label for="help14-category">问题类型</label>
        <select id="help14-category" data-feedback-field="category" aria-invalid="${Boolean(errors.category)}">
          <option value="">请选择</option>
          ${Object.entries(bugCategoryLabels).map(([value, label]) => `<option value="${value}" ${draft.category === value ? "selected" : ""}>${esc(label)}</option>`).join("")}
        </select>
        ${errors.category ? `<p class="help14-error" role="alert">${esc(errors.category)}</p>` : ""}
      </div>
      ${shellHelpFeedbackField("description", "问题描述", false, true, 4)}
      ${shellHelpFeedbackField("reproductionSteps", "复现步骤", true, true, 3)}
      ${shellHelpFeedbackField("contact", "联系方式", true)}
      <div class="help14-privacy">
        <label><input type="checkbox" data-feedback-field="includeEnvironment" ${draft.includeEnvironment ? "checked" : ""} />附带基本环境信息</label>
        ${draft.includeEnvironment ? `<p>${esc(feedbackEnvironmentSummary())}</p>` : ""}
        <label><input type="checkbox" data-feedback-field="confirmed" ${draft.confirmed ? "checked" : ""} />我知道反馈将成为公开的 GitHub Issue，并已检查不含敏感信息。</label>
        ${errors.confirmed ? `<p class="help14-error" role="alert">${esc(errors.confirmed)}</p>` : ""}
      </div>
      ${state.feedbackMessage ? `<p class="help14-error" role="alert">${esc(state.feedbackMessage)}</p>` : ""}
      <footer>
        <small>${busy ? "正在提交…" : "提交后可继续处理任务"}</small>
        <button class="button" type="button" data-action="close-help-feedback">取消</button>
        <button class="button primary" type="button" data-action="submit-feedback" ${busy ? "disabled" : ""}>${busy ? "正在提交…" : state.feedbackMessage ? "重试提交" : "提交反馈"}</button>
      </footer>`;
  overlay.innerHTML = `<div class="dialog-backdrop" data-return-focus="[data-action='open-help-feedback']">
    <form class="dialog help14-form" id="help14-form" role="dialog" aria-modal="true" aria-label="问题与建议" novalidate>
      <div class="dialog-head"><h2>问题与建议</h2><button class="icon-button" type="button" data-action="close-help-feedback" aria-label="关闭">${shellIcon("close")}</button></div>
      ${body}
    </form>
  </div>`;
  if (busy) overlay.querySelectorAll("input,select,textarea").forEach((element) => { element.disabled = true; });
  if (!state.feedbackResult) {
    requestAnimationFrame(() => document.querySelector("#help14-title")?.focus({ preventScroll: true }));
  } else {
    requestAnimationFrame(() => document.querySelector("[data-action='close-help-feedback']")?.focus({ preventScroll: true }));
  }
}

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

function renderShellSettings() {
  const page = SHELL_SETTINGS_CATEGORIES.some(([value]) => value === activeSettingsPage) ? activeSettingsPage : "appearance";
  const body = page === "appearance" ? shellSettingsAppearance()
    : page === "tasks" ? shellSettingsTasks()
      : page === "knowledge" ? shellSettingsKnowledge()
      : page === "data" ? shellSettingsData()
        : page === "updates" ? shellSettingsUpdates()
          : page === "advanced" ? shellSettingsAdvanced()
            : shellSettingsHelp();
  return `${shellPageHeading("设置", "调整工作空间的外观与使用偏好。")}
    <div class="settings-layout phase9">
      <nav class="settings-nav" aria-label="设置分类">
        ${SHELL_SETTINGS_CATEGORIES.map(([value, label, image]) => `<button class="${page === value ? "active" : ""}" type="button" data-action="set-settings-page" data-page="${value}" aria-current="${page === value ? "page" : "false"}">${shellIcon(image)}${label}</button>`).join("")}
      </nav>
      <section class="settings-content"><div class="settings-document">${body}</div></section>
    </div>`;
}

// ------------------------------------------------------------
// Choice menu
// ------------------------------------------------------------

function shellSettingsChoiceMenu(trigger, key) {
  const options = shellSettingsChoiceOptions(key);
  const value = shellSettingsChoiceValue(key);
  const compact = ["task-filter", "priority-filter", "new-task-priority"].includes(key);
  const width = compact ? Math.max(120, trigger.getBoundingClientRect().width) : 258;
  shellMountSurface(
    `<div class="surface-popover prefs-menu" role="menu" aria-label="${escAttr(SHELL_SETTINGS_CHOICE_LABELS[key] || key)}">
      ${Object.entries(options).map(([optionValue, label]) => `<button type="button" role="menuitemradio" aria-checked="${String(value) === optionValue}" data-action="set-settings-choice" data-key="${escAttr(key)}" data-value="${escAttr(optionValue)}"><span>${esc(label)}</span>${String(value) === optionValue ? shellIcon("check") : "<span></span>"}</button>`).join("")}
    </div>`,
    trigger,
    width,
  );
  const menu = document.querySelector(".prefs-menu");
  if (menu) menu.dataset.returnFocus = `[data-action="open-settings-choice"][data-key="${CSS.escape(key)}"]`;
  menu?.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
  menu?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const items = [...menu.querySelectorAll('[role="menuitemradio"]')];
    const index = items.indexOf(document.activeElement);
    items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  }, true);
}

/** Re-render the page body in place so the menu anchor does not jump. */
function shellSettingsSyncControls() {
  const document = window.document;
  const body = document.querySelector(".settings-document");
  if (!body) return;
  const page = activeSettingsPage;
  body.innerHTML = page === "appearance" ? shellSettingsAppearance()
    : page === "tasks" ? shellSettingsTasks()
      : page === "knowledge" ? shellSettingsKnowledge()
      : page === "data" ? shellSettingsData()
        : page === "updates" ? shellSettingsUpdates()
          : page === "advanced" ? shellSettingsAdvanced()
            : shellSettingsHelp();
}

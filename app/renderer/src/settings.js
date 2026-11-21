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

const desktopRecentlyDeletedRetention = window.personalTaskTrack?.recentlyDeletedRetention;
const SHELL_RETENTION_CHOICES = { 0: "永久保留", 7: "7 天", 30: "30 天", 90: "90 天" };
let recentlyDeletedRetentionDays = null;
let recentlyDeletedRetentionBusy = false;
let recentlyDeletedRetentionMessage = "";

function syncRecentlyDeletedRetentionControls() {
  const choice = document.querySelector('.prefs-choice[data-key="recently-deleted-retention"]');
  if (!choice) return;
  const label = SHELL_RETENTION_CHOICES[recentlyDeletedRetentionDays ?? 0];
  choice.querySelector("span").textContent = label;
  choice.setAttribute("aria-label", `保留期：${label}`);
  choice.disabled = recentlyDeletedRetentionDays === null || recentlyDeletedRetentionBusy;
  document.querySelector("[data-retention-clean]").disabled = choice.disabled || recentlyDeletedRetentionDays === 0;
  const status = document.querySelector("[data-retention-status]");
  status.textContent = recentlyDeletedRetentionMessage;
  status.hidden = !recentlyDeletedRetentionMessage;
  const count = document.querySelector("[data-retention-count]");
  if (count) count.textContent = `${state.recentlyDeleted.length} 项可恢复`;
}

function applyRecentlyDeletedCleanup(removedIds) {
  if (!removedIds.length) return;
  const ids = new Set(removedIds);
  const keep = entry => !ids.has(entry.id);
  state.recentlyDeleted = state.recentlyDeleted.filter(keep);
  if (pendingPayload) pendingPayload.recentlyDeleted = pendingPayload.recentlyDeleted.filter(keep);
  for (const id of ids) recovery26Picked.delete(id);
  recovery26DrawList();
}

async function runRecentlyDeletedRetention(action, days) {
  if (!desktopRecentlyDeletedRetention || recentlyDeletedRetentionBusy || dataProtectionMessage ||
      dataTransferInProgress || taskShareCommitBusy || Recovery26Persisting || recovery26Busy) return false;
  if (action === "set" && days === recentlyDeletedRetentionDays) return true;
  if (action === "automatic" && shellOverlayIsOpen()) return false;
  recentlyDeletedRetentionBusy = true;
  if (action !== "automatic") recentlyDeletedRetentionMessage = action === "set" ? "正在检查保留期…" : "正在检查过期归档…";
  syncRecentlyDeletedRetentionControls();
  try {
    if (action !== "set") await flushPendingKnowledgeRecoveries({ strict: true });
    if (!await flushSave()) throw new Error("Task data save failed");
    const result = action === "set" ? await desktopRecentlyDeletedRetention.setDays(days)
      : await desktopRecentlyDeletedRetention[action]();
    if (result.canceled) {
      recentlyDeletedRetentionMessage = "";
      return true;
    }
    recentlyDeletedRetentionDays = result.days;
    if (action === "set") {
      recentlyDeletedRetentionMessage = result.days ? `已设置保留 ${result.days} 天。` : "已关闭自动清理。";
      recovery26UpdateFooter();
      return true;
    }
    applyRecentlyDeletedCleanup(result.removedIds);
    if (result.changed) recentlyDeletedRetentionMessage = "过期范围已变化，请重新预览。";
    else if (result.removedIds.length || result.assetBytes) {
      recentlyDeletedRetentionMessage = `已清理 ${result.removedIds.length} 项过期归档，减少本机用量 ${formatBackupBytes(result.recordBytes + result.assetBytes)}。`;
    } else if (action === "clean" || !recentlyDeletedRetentionMessage) {
      recentlyDeletedRetentionMessage = "当前没有需要清理的过期归档。";
    }
    if (result.assetError) {
      const archiveResult = result.removedIds.length ? recentlyDeletedRetentionMessage + " " : "";
      recentlyDeletedRetentionMessage = `${archiveResult}部分托管附件暂未清理，可稍后重试。`;
    }
    if (result.removedIds.length || result.assetBytes) refreshDataBackupOverview(true);
    return true;
  } catch (error) {
    console.error("Recently deleted retention failed.", error);
    recentlyDeletedRetentionMessage = action === "set" ? "保留期未能保存，请重试。"
      : "清理未完成，请检查本地保存状态、磁盘空间或权限后重试。";
    return true;
  } finally {
    recentlyDeletedRetentionBusy = false;
    syncRecentlyDeletedRetentionControls();
  }
}

async function startRecentlyDeletedRetention() {
  if (!desktopRecentlyDeletedRetention) return;
  try {
    const result = await desktopRecentlyDeletedRetention.status();
    recentlyDeletedRetentionDays = result.days;
  } catch (error) {
    console.error("Unable to read recently deleted retention.", error);
    recentlyDeletedRetentionMessage = "无法读取保留期设置，自动清理已暂停。";
    syncRecentlyDeletedRetentionControls();
    return;
  }
  syncRecentlyDeletedRetentionControls();
  const check = async () => {
    const ran = !recentlyDeletedRetentionDays || await runRecentlyDeletedRetention("automatic");
    window.setTimeout(check, ran ? 60 * 60 * 1000 : 30 * 1000);
  };
  window.setTimeout(check, 45 * 1000);
}

document.addEventListener("click", event => {
  if (event.target.closest?.("[data-retention-clean]")) void runRecentlyDeletedRetention("clean");
});

// Single source of truth: app.js owns the stored keys and their display text.
// Read lazily — settings.js loads before app.js, so the binding does not exist yet.
function shellFontScaleChoices() {
  return typeof fontScaleLabels === "object" ? fontScaleLabels : {};
}

function shellSettingsRow(label, description, control) {
  return `<div class="setting-row"><div><span class="setting-label">${esc(label)}</span>${description ? `<p>${esc(description)}</p>` : ""}</div>${control}</div>`;
}

function shellSettingsChoice(key, description, choices, value) {
  const label = choices[value] || Object.values(choices)[0] || "";
  return shellSettingsRow(
    SHELL_SETTINGS_CHOICE_LABELS[key] || key,
    description,
    `<button class="button prefs-choice" type="button" data-action="open-settings-choice" data-key="${escAttr(key)}" aria-haspopup="menu" aria-expanded="false" aria-label="${escAttr(`${SHELL_SETTINGS_CHOICE_LABELS[key] || key}：${label}`)}"><span>${esc(label)}</span>${shellIcon("chevron")}</button>`,
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
  "resource-open-mode": "链接打开方式",
  "recently-deleted-retention": "保留期",
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
  if (key === "resource-open-mode") return {internal:'Loop 内部页签',external:'系统默认应用／浏览器'};
  if (key === "recently-deleted-retention") return SHELL_RETENTION_CHOICES;
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
  if (key === "resource-open-mode") return state.knowledgeWorkspace.resourceOpenMode;
  if (key === "recently-deleted-retention") return recentlyDeletedRetentionDays ?? 0;
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

function shellSettingsGroup(id, title, rows) {
  return `<section class="prefs-group" aria-labelledby="prefs-${id}">
    <h3 id="prefs-${id}">${esc(title)}</h3>
    <div class="prefs-group-body">${rows}</div>
  </section>`;
}

function shellSettingsAppearance() {
  const dark = state.theme === "dark";
  const theme = `<div class="prefs-theme" role="group" aria-label="主题">${["light", "dark"].map((value) => `<button class="theme-option ${(dark ? "dark" : "light") === value ? "active" : ""}" type="button" data-setting-button="theme" data-value="${value}" aria-pressed="${(dark ? "dark" : "light") === value}"><span class="theme-mini ${value}" aria-hidden="true"><i></i><b></b><span></span></span><span>${shellIcon(value === "light" ? "sun" : "moon")}${value === "light" ? "浅色" : "深色"}</span></button>`).join("")}</div>`;
  const interaction = window.LoopContinuity28?.settings() || "";
  return `<h2>外观</h2><div class="prefs-group-stack">
    ${shellSettingsGroup("theme", "主题", theme)}
    ${shellSettingsGroup("typography", "字体与字号", `
      ${shellSettingsChoice("font-scale", "", shellSettingsChoiceOptions("font-scale"), state.fontScale)}
      ${shellSettingsChoice("zh-font", "自选字体需先在系统中安装。", shellSettingsChoiceOptions("zh-font"), state.zhFont)}
      ${shellSettingsChoice("en-font", "", shellSettingsChoiceOptions("en-font"), state.enFont)}
      <div class="font-preview"><b>字体预览</b><p>记录任务与笔记 · Task notes 0123456789</p></div>`)}
    ${interaction ? shellSettingsGroup("interaction", "界面切换", interaction) : ""}
    <footer class="settings-footer"><button class="button" type="button" data-action="reset-appearance">恢复默认外观</button></footer>
  </div>`;
}

function shellSettingsTasks() {
  const modifier = desktopPlatform === "darwin" ? "⌘" : "Ctrl";
  const reminders = typeof desktopReminderSettingsRow === "function" ? desktopReminderSettingsRow() : "";
  return `<h2>任务与浮窗</h2><div class="prefs-group-stack">
    ${shellSettingsGroup("task-lists", "任务列表", `
      ${shellSettingsChoice("task-filter", "", shellSettingsChoiceOptions("task-filter"), state.taskFilter)}
      ${shellSettingsChoice("priority-filter", "", shellSettingsChoiceOptions("priority-filter"), state.priorityFilter)}`)}
    ${shellSettingsGroup("task-creation", "新建任务",
      shellSettingsChoice("new-task-priority", "", shellSettingsChoiceOptions("new-task-priority"), state.newTaskPriority))}
    ${shellSettingsGroup("today-widget", "今日浮窗", `
      ${shellSettingsToggle("显示今日浮窗", "", todayWidgetWindowState.visible === true, `data-action="toggle-today-widget-visibility" ${desktopTodayWidget ? "" : "disabled"}`)}
      ${shellSettingsToggle("始终置顶", "", todayWidgetWindowState.alwaysOnTop === true, `data-action="toggle-today-widget-always-on-top" ${desktopTodayWidget ? "" : "disabled"}`)}
      ${shellSettingsToggle("鼠标穿透", `点击穿过浮窗 · ${modifier} + Shift + T`, todayWidgetWindowState.clickThrough === true, `data-action="toggle-today-widget-click-through" ${desktopTodayWidget ? "" : "disabled"}`)}`)}
    ${reminders ? shellSettingsGroup("reminders", "桌面提醒", reminders) : ""}
  </div>`;
}

function shellSettingsKnowledge() {
  return `<h2>知识笔记</h2><div class="prefs-group-stack">
    ${shellSettingsGroup("note-layout", "阅读与布局", `
      ${shellSettingsChoice("knowledge-mode", "", shellSettingsChoiceOptions("knowledge-mode"), shellKnowledgeMode())}
      ${shellSettingsChoice("knowledge-width", "", shellSettingsChoiceOptions("knowledge-width"), shellNoteWidth())}`)}
    ${shellSettingsGroup("note-editing", "编辑", shellSettingsToggle(
      "中英文自动加空格", "", state.uiPreferences.knowledgeAutoSpacing, 'data-action="toggle-knowledge-auto-spacing"'))}
    ${shellSettingsGroup("note-links", "链接", shellSettingsChoice(
      "resource-open-mode", "", shellSettingsChoiceOptions("resource-open-mode"), state.knowledgeWorkspace.resourceOpenMode))}
  </div>`;
}

function shellSettingsData() {
  const deleted = state.recentlyDeleted.length;
  const retention = desktopRecentlyDeletedRetention ? `
    ${shellSettingsChoice("recently-deleted-retention", "从删除时起计算，仅在本机生效。", SHELL_RETENTION_CHOICES, recentlyDeletedRetentionDays ?? 0)}
    ${shellSettingsAction("清理过期归档", "", "预览并清理…", 'data-retention-clean')}
    <p class="prefs-transfer-status" data-retention-status role="status" hidden></p>` : "";
  const recoveryEntry = typeof recovery26Open === "function"
    ? `<section class="data-settings-section data-settings-deleted" aria-labelledby="data-deleted-heading">
        <h3 id="data-deleted-heading">最近删除</h3>
        <div class="setting-row"><div><span class="setting-label">恢复单项内容</span><p data-retention-count>${deleted} 项可恢复</p></div>
          <button class="button" type="button" data-recovery26="open" aria-label="查看最近删除">查看</button></div>
        ${retention}
      </section>`
    : "";
  return `<h2>数据</h2><div class="data-settings">
    <section class="data-settings-summary" aria-labelledby="data-summary-heading">
      <h3 id="data-summary-heading">数据概况</h3>
      <p data-backup-usage>正在统计本机用量…</p>
      <p class="prefs-native-caption">外部笔记、应用和下载包另计。</p>
    </section>
    <section class="data-settings-section" aria-labelledby="data-export-heading">
      <h3 id="data-export-heading">备份与迁移</h3>
      ${shellSettingsRow("导出密码", "请妥善保管密码。", renderBackupPassword("export"))}
      ${shellSettingsAction("工作区备份", "包含任务、笔记和附件。", "导出备份", `data-backup-action="export" ${desktopDataBackup ? "" : "disabled"}`)}
      <div class="data-settings-automatic">
        <span class="setting-label">本机自动备份</span>
        <p data-backup-overview>正在读取备份状态…</p>
      </div>
      <p class="prefs-transfer-status" data-backup-status="export" role="status"></p>
    </section>
    ${recoveryEntry}
    <section class="data-settings-section data-settings-restore" aria-labelledby="data-restore-heading">
      <h3 id="data-restore-heading">恢复整个工作区</h3>
      <p class="data-settings-impact">替换当前工作区并重启，恢复前自动备份。</p>
      ${shellSettingsRow("解锁密码", "", renderBackupPassword("import"))}
      ${shellSettingsAction("备份文件", ".loopbackup 文件", "选择文件", `data-backup-action="import-file" ${desktopDataBackup ? "" : "disabled"}`)}
      ${shellSettingsAction("备份目录", "历史版本或升级备份。", "选择目录", `data-backup-action="import-directory" ${desktopDataBackup ? "" : "disabled"}`)}
      ${shellSettingsAction("最近本机备份", "", "恢复…", `data-backup-action="import-recent" ${desktopDataBackup ? "" : "disabled"}`)}
      <p class="prefs-transfer-status" data-backup-status="restore" role="status"></p>
    </section>
  </div>`;
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
    ? `上次检查 · ${checkedAt.getHours()}:${String(checkedAt.getMinutes()).padStart(2, "0")}`
    : "";
  const titles = {
    available: "有可用更新",
    downloading: `正在下载更新 · ${Math.round(update.percent || 0)}%`,
    downloaded: "下载完成，等待安装",
    preparing: "正在保存并准备升级…",
    installing: "正在完成升级…",
    error: update.retryAction === "check" ? "检查更新失败" : "更新未完成",
    unsupported: update.unsupportedReason === "development" ? "开发版不支持应用内更新" : "当前构建不支持应用内更新",
    latest: "当前已是最新版本",
    checking: "正在检查更新…",
    idle: "尚未检查更新",
  };
  const bodies = {
    downloaded: update.errorCode ? "升级前保存未完成。请检查磁盘空间或目录权限后重试。" : "",
    error: updateErrorPresentation(update.errorCode).detail,
    latest: checkedLabel,
    idle: checkedLabel,
    unsupported: update.unsupportedReason === "development" ? "" : "请从发布页获取安装包。",
  };
  const busy = ["checking", "downloading", "preparing", "installing"].includes(status);
  const percent = Math.max(0, Math.min(100, Math.round(Number(update.percent) || 0)));
  const progress = status === "downloading"
    ? `<div class="prefs-update-progress" role="progressbar" aria-label="更新下载进度" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></div>`
    : "";
  // One entry point. What it does follows the state, so it is never a no-op:
  // checking while busy is disabled, otherwise it offers the only useful action.
  const actions = status === "available" ? '<button class="button primary" type="button" data-update-action="download">下载更新</button>'
    : status === "downloaded" ? '<button class="button primary" type="button" data-update-action="install">安装并重启</button>'
      : status === "error" ? `<button class="button primary" type="button" data-update-action="${update.retryAction}">${update.retryAction === "check" ? "重新检查" : update.retryAction === "install" ? "重试安装" : "重试下载"}</button>`
        : `<button class="button" type="button" data-update-action="check" ${busy || !update.supported ? "disabled" : ""}>${status === "checking" ? "检查中…" : "检查更新"}</button>`;
  const currentVersion = String(update.currentVersion || APP_VERSION || "");
  const hasTarget = ["available", "downloading", "downloaded", "preparing", "installing"].includes(status)
    || (status === "error" && update.retryAction !== "check");
  const targetVersion = hasTarget && update.version && update.version !== currentVersion ? String(update.version) : "";
  const versions = `<div class="prefs-update-version"><span aria-label="${escAttr(`当前版本 v${currentVersion}`)}">v${esc(currentVersion)}</span>${targetVersion ? `<span class="prefs-version-arrow" aria-hidden="true">→</span><strong aria-label="${escAttr(`更新版本 v${targetVersion}`)}">v${esc(targetVersion)}</strong>` : ""}</div>`;
  return `<div class="prefs-update-heading"><div><span class="setting-label">${esc(titles[status] || "当前版本")}</span>${versions}</div><div class="prefs-update-actions">${actions}</div></div>
      ${bodies[status] ? `<p>${esc(bodies[status])}</p>` : ""}
      ${progress}${renderUpdateReleaseNotes(update)}`;
}

/** Cheap in-place sync used by app.js whenever appUpdateState changes. */
function shellSettingsSyncUpdateCard() {
  if (typeof activeSettingsPage === "string" && activeSettingsPage !== "updates") return;
  const node = document.querySelector("[data-shell-update-detail]");
  if (!node) return;
  replaceUpdateSurfaceContent(node, shellSettingsUpdateCardBody());
  const toggle = document.querySelector("[data-update-automatic]");
  if (toggle) {
    toggle.setAttribute("aria-checked", String(appUpdateState.automaticChecks === true));
    toggle.disabled = !appUpdateState.supported || updatePreferenceInFlight;
    const status = document.querySelector("[data-update-preference-status]");
    if (status) status.textContent = shellSettingsUpdatePreferenceMessage();
  }
}

function shellSettingsUpdatePreferenceMessage() {
  return appUpdateState.preferenceError ? "设置未保存，请检查目录权限后重试。" : "";
}

function shellSettingsUpdates() {
  const update = appUpdateState;
  const options = shellSettingsToggle("自动检查更新", "", update.automaticChecks === true,
    `data-update-automatic ${update.supported && !updatePreferenceInFlight ? "" : "disabled"}`);
  return `<h2>软件更新</h2><div class="prefs-group-stack">
    ${shellSettingsGroup("version", "版本与更新", `<div class="prefs-update-detail" data-shell-update-detail aria-live="polite">${shellSettingsUpdateCardBody()}</div>`)}
    ${shellSettingsGroup("update-preferences", "更新偏好", `${options}
      <p class="prefs-transfer-status" data-update-preference-status role="status">${esc(shellSettingsUpdatePreferenceMessage())}</p>`)}
  </div>`;
}

function shellSettingsAdvanced() {
  const navigation = globalThis.LoopWork?.settingsBody() || "";
  const previewActive = loopClockIsPreview();
  return `<h2>高级功能</h2><div class="prefs-group-stack">
    ${navigation ? shellSettingsGroup("work-navigation", "工作与成长", navigation) : ""}
    ${shellSettingsGroup("time-preview", "时间预览", `
      ${shellSettingsAction("界面时间", previewActive ? loopStamp() : "仅用于 Loop 内预览。", "设置预览", 'data-action="time18-clock" aria-haspopup="dialog" aria-expanded="false"')}
      ${previewActive ? shellSettingsAction("退出预览", "", "恢复真实时间", 'data-action="time18-clear"') : ""}`)}
  </div>`;
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
  ["如何备份数据和笔记？", "在「数据」设置中导出工作区备份，核对绑定笔记和资源的覆盖数量。可设置密码加密。恢复前，桌面应用会先保护当前数据。设备损坏时需要保存在独立位置的副本。"],
];

function shellSettingsHelp() {
  const open = Number(state.helpTopicOpen);
  const manual = globalThis.LoopManual27?.entry() || "";
  const topics = `<ul class="help14-topics">
    ${SHELL_HELP_TOPICS.map(([title, body], index) => `<li>
      <button type="button" data-action="toggle-help-topic" data-topic="${index}" aria-expanded="${index === open}">${esc(title)}${shellIcon(index === open ? "minus" : "plus")}</button>
      ${index === open ? `<p>${esc(body)}</p>` : ""}
    </li>`).join("")}
  </ul>`;
  return `<h2>帮助与反馈</h2><div class="prefs-group-stack">
    ${manual ? shellSettingsGroup("guide", "使用指南", manual) : ""}
    ${shellSettingsGroup("questions", "常见问题", topics)}
    ${shellSettingsGroup("feedback", "反馈与版本", `
      ${shellSettingsAction("问题与建议", "", "提交反馈", 'data-action="open-help-feedback"')}
      ${shellSettingsInfo("Loop 版本", "", `v${APP_VERSION}`)}`)}
  </div>`;
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
        <select id="help14-category" data-feedback-field="category" aria-invalid="${Boolean(errors.category)}"${errors.category ? ' aria-describedby="help14-category-error"' : ""}>
          <option value="">请选择</option>
          ${Object.entries(bugCategoryLabels).map(([value, label]) => `<option value="${value}" ${draft.category === value ? "selected" : ""}>${esc(label)}</option>`).join("")}
        </select>
        ${errors.category ? `<p id="help14-category-error" class="help14-error" role="alert">${esc(errors.category)}</p>` : ""}
      </div>
      ${shellHelpFeedbackField("description", "问题描述", false, true, 4)}
      ${shellHelpFeedbackField("reproductionSteps", "复现步骤", true, true, 3)}
      ${shellHelpFeedbackField("contact", "联系方式", true)}
      <div class="help14-privacy">
        <label><input type="checkbox" data-feedback-field="includeEnvironment" ${draft.includeEnvironment ? "checked" : ""} />附带基本环境信息</label>
        <p data-feedback-environment ${draft.includeEnvironment ? "" : "hidden"}>${esc(feedbackEnvironmentSummary())}</p>
        <label><input id="help14-confirmed" type="checkbox" data-feedback-field="confirmed" ${draft.confirmed ? "checked" : ""} aria-invalid="${Boolean(errors.confirmed)}"${errors.confirmed ? ' aria-describedby="help14-confirmed-error"' : ""} />我知道反馈将成为公开的 GitHub Issue，并已检查不含敏感信息。</label>
        ${errors.confirmed ? `<p id="help14-confirmed-error" class="help14-error" role="alert">${esc(errors.confirmed)}</p>` : ""}
      </div>
      <footer>
        ${state.feedbackMessage ? `<p class="help14-error" data-feedback-message role="alert">${esc(state.feedbackMessage)}</p>` : ""}
        <small data-feedback-progress tabindex="-1" role="status">${busy ? "正在提交，请稍候…" : "提交后可继续处理任务"}</small>
        <button class="button" type="button" data-action="close-help-feedback" ${busy ? "disabled" : ""}>取消</button>
        <button class="button primary" type="button" data-action="submit-feedback" ${busy ? "disabled" : ""}>${busy ? "正在提交…" : state.feedbackMessage ? "重试提交" : "提交反馈"}</button>
      </footer>`;
  const previous = document.activeElement;
  const previousId = previous?.closest?.("#help14-form") ? previous.id : "";
  const selection = previousId && typeof previous.selectionStart === "number" ? [previous.selectionStart, previous.selectionEnd] : null;
  overlay.innerHTML = `<div class="dialog-backdrop" data-return-focus="[data-action='open-help-feedback']">
    <form class="dialog help14-form" id="help14-form" role="dialog" aria-modal="true" aria-busy="${busy}" aria-label="问题与建议" novalidate>
      <div class="dialog-head"><h2>问题与建议</h2><button class="icon-button" type="button" data-action="close-help-feedback" aria-label="关闭" ${busy ? "disabled" : ""}>${shellIcon("close")}</button></div>
      ${body}
    </form>
  </div>`;
  if (busy) overlay.querySelectorAll("input,select,textarea").forEach((element) => { element.disabled = true; });
  requestAnimationFrame(() => {
    if (!document.querySelector("#help14-form")) return;
    const target = busy ? overlay.querySelector("[data-feedback-progress]") : state.feedbackResult
      ? overlay.querySelector("[data-action='close-help-feedback']")
      : overlay.querySelector('[aria-invalid="true"]') || (previousId && document.getElementById(previousId)) || document.querySelector("#help14-title");
    target?.focus({ preventScroll: true });
    if (selection && target?.id === previousId) target.setSelectionRange?.(...selection);
  });
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
  return `${shellPageHeading("设置", "")}
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
  const rect = trigger.getBoundingClientRect();
  const width = rect.width;
  shellMountSurface(
    `<div class="surface-popover prefs-menu" role="menu" aria-label="${escAttr(SHELL_SETTINGS_CHOICE_LABELS[key] || key)}">
      ${Object.entries(options).map(([optionValue, label]) => `<button type="button" role="menuitemradio" aria-checked="${String(value) === optionValue}" data-action="set-settings-choice" data-key="${escAttr(key)}" data-value="${escAttr(optionValue)}"><span>${esc(label)}</span>${String(value) === optionValue ? shellIcon("check") : "<span></span>"}</button>`).join("")}
    </div>`,
    trigger,
    width,
  );
  const menu = document.querySelector(".prefs-menu");
  if (menu) {
    menu.dataset.returnFocus = `[data-action="open-settings-choice"][data-key="${CSS.escape(key)}"]`;
    menu.style.width = "max-content";
    menu.style.minWidth = `${width}px`;
    menu.style.maxWidth = `${Math.max(0, window.innerWidth - 24)}px`;
    menu.style.left = `${rect.right - menu.offsetWidth}px`;
    menu.style.top = `${Math.min(rect.bottom + 7, window.innerHeight - menu.offsetHeight - 12)}px`;
    shellClampFloatingSurface(menu);
  }
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

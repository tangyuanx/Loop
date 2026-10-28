// ------------------------------------------------------------
// Phase19 · 桌面提醒
//
// Ported from the frozen Demo's loop-desktop-phase19.js. The Demo simulated the
// operating system (capability switches, window states, sample tasks); the
// product talks to the real reminder controller through
// window.personalTaskTrack.deadlineReminders and only renders what that reports:
// whether notifications are available, what was delivered, and the last failure.
// The scoped surfaces are the deadline reminder row, the reminder status panel,
// its 检查设置 help and the labelled notification content preview.
// ------------------------------------------------------------

const desktopReminderDefaultState = { supported: false, capability: "unknown", pending: 0, delivered: [], error: null, lastRunAt: "" };
let desktopReminderState = { ...desktopReminderDefaultState };
let desktopReminderMessage = "";
// The batch produced by the most recent check — the only thing the labelled
// content preview shows (the cumulative history lives in the status panel).
let desktopReminderPreviewEntries = [];
// Deliveries are made by the running scan, so a manual check must show what was
// delivered since the user last looked instead of claiming nothing is new.
let desktopReminderSeenAt = "";
let desktopReminderSubscribed = false;
let desktopReminderReadFailed = false;
let desktopReminderChecking = false;

function desktopReminderCapability() {
  if (desktopReminderUnavailable()) return "unsupported";
  if (desktopReminderReadFailed) return "unknown";
  // The main process probes the platform (Windows toast setting / macOS
  // ncprefs), so "blocked" is a reported fact, never an assumption.
  if (desktopReminderState.capability === "blocked") return "blocked";
  if (!desktopReminderState.supported) return "unsupported";
  if (desktopReminderState.error) return "failed";
  return "supported";
}

function desktopReminderUnavailable() {
  return !desktopDeadlineReminders?.getState;
}

function desktopReminderCopy(capability = desktopReminderCapability()) {
  if (capability === "unknown") return { label: "提醒状态暂时无法读取", hint: "请重新检查。当前尚未确认系统通知能力，截止安排与处理记录保留。" };
  if (capability === "blocked") {
    return { label: "系统通知关闭", hint: "截止安排与处理记录保留，可在系统设置中检查 Loop 的通知权限。" };
  }
  if (capability === "unsupported") {
    return { label: "当前环境不支持通知", hint: "当前环境无法发送系统通知，仍可在今日和日历查看任务。" };
  }
  if (capability === "failed") {
    return { label: "提醒未能发送", hint: "本次未记为已提醒；恢复后可重新检查。截止安排与处理记录保留。" };
  }
  return { label: "通知能力可用", hint: "是否实际显示仍取决于系统通知权限与专注模式。" };
}

async function desktopRefreshReminderState() {
  if (desktopReminderUnavailable()) {
    desktopReminderState = { ...desktopReminderDefaultState };
    return desktopReminderState;
  }
  try {
    const state = await desktopDeadlineReminders.getState();
    desktopReminderReadFailed = false;
    desktopReminderState = { ...desktopReminderDefaultState, ...(state && typeof state === "object" ? state : {}) };
  } catch (error) {
    console.error("Failed to read the deadline reminder state.", error);
    desktopReminderReadFailed = true;
  }
  desktopSyncReminderLabels();
  return desktopReminderState;
}

/** Live updates: a background delivery or failure refreshes the cached state. */
function desktopBindReminderState() {
  if (desktopReminderSubscribed || !desktopDeadlineReminders?.onState) return;
  desktopReminderSubscribed = true;
  desktopDeadlineReminders.onState((state) => {
    if (state && typeof state === "object") {
      desktopReminderReadFailed = false;
      desktopReminderState = { ...desktopReminderDefaultState, ...state };
      desktopSyncReminderLabels();
    }
  });
}

function desktopSyncReminderLabels() {
  const copy = desktopReminderCopy();
  document.querySelectorAll('[data-desktop-reminder-settings] .setting-label, .desk19-deadline-status>span').forEach(node => { node.textContent = copy.label; });
  document.querySelectorAll('[data-desktop-reminder-settings] .setting-row p').forEach(node => { node.textContent = copy.hint; });
}

/** The scoped row inside the deadline panel (Demo desk19-deadline-status). */
function desktopReminderStatusRow() {
  const copy = desktopReminderCopy();
  return `<div class="desk19-deadline-status">${shellIcon("bell")}<span>${esc(copy.label)}</span><button type="button" class="text-button" data-action="desk19-status">查看</button></div>`;
}

/** The settings 任务 page row. */
function desktopReminderSettingsRow() {
  // The demo labels the row with the capability itself (系统通知关闭 / 通知能力可用)
  // under the 桌面提醒 heading that settings.js already renders.
  const copy = desktopReminderCopy();
  const control = `<button class="button" type="button" data-action="desk19-status">查看状态</button>`;
  const row = typeof shellSettingsRow === "function"
    ? shellSettingsRow(copy.label, copy.hint, control)
    : `<div class="setting-row"><div><span class="setting-label">${esc(copy.label)}</span><p>${esc(copy.hint)}</p></div>${control}</div>`;
  return `<div data-desktop-reminder-settings>${row}</div>`;
}

function desktopReminderMount(markup, trigger, width = 370) {
  return shellMountSurface(markup, trigger?.isConnected ? trigger : document.body, width);
}

function desktopReminderStatusPanel(trigger) {
  const capability = desktopReminderCapability();
  const copy = desktopReminderCopy(capability);
  const retry = capability === "failed";
  desktopReminderMount(
    `<section class="surface-popover entry16-panel desk19-panel" role="dialog" aria-modal="true" aria-label="桌面提醒">${shellSurfaceHeader("桌面提醒")}
      <div class="desk19-status ${capability === "supported" ? "" : "warning"}">${shellIcon(capability === "supported" ? "bell" : "blocked")}<div><strong>${esc(copy.label)}</strong><p>${esc(copy.hint)}</p></div></div>
      <p class="schedule-hint">Loop 运行时检查截止提醒。关闭主窗口会退出软件并停止提醒。</p>
      <div class="desk19-status-actions">
        <button class="button" type="button" data-action="desk19-check" ${desktopReminderChecking ? "disabled" : ""}>${desktopReminderChecking ? "检查中…" : retry ? "重试提醒" : "检查提醒"}</button>
        <button class="button" type="button" data-action="desk19-calendar">查看日历</button>
        <button class="text-button" type="button" data-action="desk19-help">检查设置</button>
      </div>
      ${desktopReminderMessage ? `<p class="desk19-result" role="status">${esc(desktopReminderMessage)}</p>` : ""}
      ${desktopReminderState.lastRunAt ? `<p class="schedule-hint" style="margin-top:17px">上次检查：${esc(String(desktopReminderState.lastRunAt).replace("T", " ").slice(0, 16))}</p>` : ""}
    </section>`,
    trigger,
  );
}

/** What the platform actually reported, so a wrong reading is diagnosable. */
function desktopReminderPermissionDetail() {
  const permission = desktopReminderState.permission || {};
  if (!permission.source || permission.source === "none") return "";
  const labels = {
    "windows-toast": "Windows 通知设置",
    "macos-ncprefs": "macOS 通知记录",
    "platform-unsupported": "当前平台不提供通知设置",
  };
  const label = labels[permission.source] || permission.source;
  const detail = permission.detail && permission.detail !== "not-registered" ? ` · ${permission.detail}` : "";
  const stateText = permission.state === "blocked" ? "已关闭" : permission.state === "allowed" ? "已允许" : permission.detail === "not-registered" ? "未注册" : "未能确认";
  return `<p class="schedule-hint" style="margin-top:14px">读取自${esc(label)}：${esc(stateText)}${esc(detail)}</p>`;
}

function desktopReminderHelpPanel(trigger) {
  desktopReminderMount(
    `<section class="surface-popover entry16-panel desk19-panel" role="dialog" aria-modal="true" aria-label="检查通知设置">${shellSurfaceHeader("检查通知设置")}
      <div class="desk19-status"><div>
        <strong>检查系统通知权限</strong><p>在系统设置中确认 Loop 允许显示通知。</p>
        <strong style="margin-top:14px">检查专注模式</strong><p>专注模式可能静默或暂缓显示通知。</p>
        <strong style="margin-top:14px">保持 Loop 运行</strong><p>最小化主窗口后仍可提醒；关闭主窗口会退出软件。</p>
      </div></div>
      ${desktopReminderPermissionDetail()}
      <p class="schedule-hint">以上检查需在系统设置中完成，Loop 不会打开或更改系统设置。</p>
    </section>`,
    trigger,
  );
}

/** Labelled content preview of what the system notification showed. */
function desktopReminderPreviewPanel(trigger, entries) {
  const rows = entries.map((entry, index) => {
    const multiple = (entry.tasks?.length || 0) > 1;
    const time = String(entry.at || "").replace("T", " ").slice(11, 16);
    return `<button class="desk19-notification" type="button" data-action="desk19-preview-open" data-index="${index}">
      <header><img src="./src/assets/loop-icon.png" alt="" /><span>Loop</span><time>${esc(time)}</time></header>
      <strong>${esc(entry.title || "任务截止提醒")}</strong>
      <p>${esc(entry.body || "")}</p>
      <small>${multiple ? "打开日历" : "打开任务"}${shellIcon("arrow")}</small>
    </button>`;
  }).join("");
  desktopReminderMount(
    `<section class="surface-popover entry16-panel desk19-panel" role="dialog" aria-modal="true" aria-label="通知内容预览">${shellSurfaceHeader("通知内容预览")}
      <p class="schedule-hint">内容预览 · 实际通知外观由系统提供。</p>
      <div class="desk19-notifications">${rows}</div>
    </section>`,
    trigger,
  );
  const panel = document.querySelector(".desk19-panel");
  if (panel) {
    panel.style.left = `${Math.max(12, window.innerWidth - panel.offsetWidth - 22)}px`;
    panel.style.top = "70px";
  }
}

/** 检查提醒 / 重试提醒 — the only path that asks the main process to scan. */
async function desktopReminderCheck(trigger) {
  if (desktopReminderChecking) return;
  desktopReminderChecking = true;
  const returnSelector = document.querySelector(".desk19-panel")?.dataset.returnFocus || '[data-action="desk19-status"]';
  const anchor = () => document.querySelector(returnSelector) || trigger;
  desktopReminderMessage = "正在读取系统能力并检查截止提醒…";
  desktopReminderStatusPanel(anchor());
  try {
    await desktopRefreshReminderState();
    const capability = desktopReminderCapability();
    if (capability === "unknown") {
      desktopReminderMessage = "提醒状态读取失败，请重新检查；未将任何任务标记为已提醒。";
      return;
    }
    if (capability === "unsupported") {
      desktopReminderMessage = "当前环境无法发送系统通知，仍可在今日和日历查看任务。";
      return;
    }
    let response = null;
    try {
      response = await desktopDeadlineReminders.check();
    } catch (error) {
      console.error("Failed to check deadline reminders.", error);
      desktopReminderMessage = "本次检查未能完成，截止安排与处理记录保留。";
      return;
    }
    const outcome = response?.outcome || {};
    desktopReminderState = { ...desktopReminderDefaultState, ...(response?.state || {}) };
    desktopSyncReminderLabels();
    if (outcome.error) {
      desktopReminderMessage = "提醒未能发送；本次未记为已提醒，可重试。";
      return;
    }
    const delivered = Array.isArray(outcome.delivered) && outcome.delivered.length
      ? outcome.delivered
      : (desktopReminderState.delivered || []).filter((entry) => String(entry.at || "") > desktopReminderSeenAt);
    if (!delivered.length) {
      desktopReminderPreviewEntries = [];
      desktopReminderSeenAt = (desktopReminderState.delivered || []).reduce((latest, entry) => (String(entry.at || "") > latest ? String(entry.at) : latest), desktopReminderSeenAt);
      desktopReminderMessage = "暂无新的提醒；已提醒、已完成和不提醒的任务会跳过。";
      return;
    }
    desktopReminderPreviewEntries = delivered;
    desktopReminderSeenAt = delivered.reduce((latest, entry) => (String(entry.at || "") > latest ? String(entry.at) : latest), desktopReminderSeenAt);
    desktopReminderMessage = `已发送 ${delivered.length} 条提醒；再次检查不会重复。`;
    if (document.querySelector('.desk19-panel')) desktopReminderPreviewPanel(anchor(), delivered);
  } finally {
    desktopReminderChecking = false;
    if (document.querySelector('.desk19-panel [data-action="desk19-check"]')) desktopReminderStatusPanel(anchor());
  }
}

/** Opening a reminder: one task, or the calendar when it was merged. */
function desktopReminderOpenEntry(index) {
  const entry = desktopReminderPreviewEntries[Number(index)];
  if (!entry) return;
  shellCloseOverlay({ restoreFocus: false });
  if ((entry.tasks?.length || 0) > 1) {
    ensureCalendarState();
    state.calendarOpen = true;
    state.settingsOpen = false;
    state.reviewOpen = false;
    render();
    return;
  }
  const taskId = entry.tasks?.[0]?.id;
  if (!taskId) return;
  openTaskFromGlobalList(taskId);
  render();
}

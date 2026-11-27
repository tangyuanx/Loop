// ============================================================
// Loop -- full-width pages (calendar, review)
//
// Presentation ported from the frozen Demo's renderCalendar / renderReview /
// pageHeading (loop-plane-phase1.html). The data, filtering and navigation all
// come from the project:
//   state.calendarMonth         "YYYY-MM-01"      (Demo: "YYYY-MM")
//   state.calendarSelectedDate  "YYYY-MM-DD"      (Demo: state.calendarDate)
//   state.reviewPreset / reviewDateField / reviewStartDate / reviewEndDate
// ============================================================

const SHELL_REVIEW_FIELD_LABELS = { updated: "更新日期", created: "创建日期", resolved: "解决日期" };
const SHELL_REVIEW_PRESETS = [["week", "本周"], ["month", "本月"], ["year", "今年"], ["all", "全部"], ["custom", "自定义"]];

function shellPageHeading(title, description, actions = "") {
  return `<header class="page-heading"><div><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ""}</div>${actions ? `<div class="heading-actions">${actions}</div>` : ""}</header>`;
}

// ------------------------------------------------------------
// Calendar
// ------------------------------------------------------------

function shellCalendarMonth() {
  const parsed = parseDateInput(`${String(state.calendarMonth || "").slice(0, 7)}-01`);
  return parsed || loopNow();
}

function shellCalendarDateKey(date) {
  return localDateKey(date);
}

function renderShellCalendar() {
  ensureCalendarState();
  const month = shellCalendarMonth();
  const todayKey = loopTodayKey();
  const selectedKey = state.calendarSelectedDate || todayKey;
  const selected = safeDate(`${selectedKey}T12:00:00`) || loopNow();
  const agenda = calendarTasksForDate(selectedKey);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const focusKey = selectedKey.slice(0, 7) === localDateKey(first).slice(0, 7) ? selectedKey : localDateKey(first);

  const days = Array.from({ length: weeks * 7 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = shellCalendarDateKey(date);
    const items = calendarTasksForDate(key);
    const outside = date.getMonth() !== month.getMonth();
    const boundary = outside || date.getDate() === 1;
    const label = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日，${items.length ? `${items.length} 个任务截止` : "无截止任务"}`;
    const nowMs = loopNow().getTime();
    const previewChips = items.slice(0, 2).map((task) => {
      const done = task.status === "done";
      const dl = safeDate(task.deadlineAt);
      const overdue = !done && dl && dl.getTime() < nowMs;
      const tone = done ? "is-done" : overdue ? "is-overdue" : "is-open";
      return `<span class="cal-ev ${tone}" title="${escAttr(task.title || "未命名任务")}">${esc(task.title || "未命名任务")}</span>`;
    }).join("");
    const extraChip = items.length > 2 ? `<span class="cal-ev-more">+${items.length - 2}</span>` : "";
    return `<button class="calendar-day ${outside ? "outside " : ""}${key === todayKey ? "today " : ""}${key === selectedKey ? "selected" : ""}" type="button" data-action="select-calendar-date" data-date="${key}" tabindex="${key === focusKey ? "0" : "-1"}" aria-label="${escAttr(label)}" aria-pressed="${key === selectedKey}" ${key === todayKey ? 'aria-current="date"' : ""}>
      <span class="day-number ${boundary ? "month-boundary" : ""}">${boundary ? `${date.getMonth() + 1}月 ${date.getDate()}` : date.getDate()}</span>
      ${items.length ? `<span class="cal-day-events">${previewChips}${extraChip}</span><span class="day-count sr-only">${items.length} 个任务</span>` : ""}
    </button>`;
  }).join("");

  const agendaBody = agenda.length
    ? `<ol class="agenda-items">${agenda.map((task) => {
      const deadline = safeDate(task.deadlineAt);
      const done = task.status === "done";
      const group = state.taskGroups.find((item) => item.id === task.groupId);
      return `<li class="agenda-item">
        <button class="agenda-task" type="button" data-action="open-calendar-task" data-task-id="${escAttr(task.id)}">${esc(task.title || "未命名任务")}</button>
        <div class="agenda-meta">${shellIcon(done ? "done" : "circle")}${done ? "已完成" : "未完成"}<span>·</span><time>${esc(shellTimeLabel(deadline))}</time><span>·</span><span>${esc(group?.title || "未分组")}</span></div>
        ${normalizeTaskRecurrence(task.recurrence).frequency !== "none" ? `<p class="agenda-cycle">循环 · ${esc(recurrenceSummaryLabel(task.recurrence))}</p>` : ""}
        ${shellTemporalSummary(task.hypothesis || task.description || "尚未记录进展")}
      </li>`;
    }).join("")}</ol>
    <button class="button" type="button" data-action="apply-calendar-date">在任务中查看${shellIcon("arrow")}</button>`
    : '<p class="agenda-empty">当天暂无任务截止。<br>可选择其他日期查看。</p>';

  return `<div class="calendar-layout calendar-v2">
      <section class="calendar-main" aria-label="截止日期日历">
        <div class="month-controls">
          <h2>${month.getFullYear()} 年 ${month.getMonth() + 1} 月</h2>
          <button class="icon-button" type="button" data-action="shift-calendar-month" data-direction="-1" aria-label="上个月"><svg viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(180deg)"><path d="${SHELL_ICON_PATHS.chevron}"></path></svg></button>
          <button class="icon-button" type="button" data-action="shift-calendar-month" data-direction="1" aria-label="下个月">${shellIcon("chevron")}</button>
          <button class="button" type="button" data-action="calendar-today">回到今天</button>
        </div>
        <div class="calendar-weekdays" aria-hidden="true">${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<span>周${day}</span>`).join("")}</div>
        <div class="calendar-grid" style="--calendar-weeks:${weeks}">${days}</div>
        <div class="calendar-legend">任务显示在截止日 · 循环任务按当前截止日显示</div>
      </section>
      <aside class="agenda" aria-label="当天截止任务">
        <div class="agenda-head">
          <h2>${esc(shellDisplayDate(selectedKey))}</h2>
          <p>${SHELL_WEEKDAY_NAMES[selected.getDay()]}${selectedKey === todayKey ? " · 今天" : ""}${agenda.length ? ` · ${agenda.length} 个任务截止` : ""}</p>
        </div>
        ${agendaBody}
      </aside>
    </div>`;
}

// ------------------------------------------------------------
// Review
// ------------------------------------------------------------

function shellReviewItems() {
  const range = reviewRange();
  const items = reviewTasks(range);
  return { range, items };
}

function shellReviewRangeLabel(range) {
  if (state.reviewPreset === "all") return "全部时间";
  if (range.error) return "日期范围无效";
  if (!range.start || !range.end) return "选择日期范围";
  const inclusiveEnd = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate() - 1);
  // Keep calendar dates local; reparsing a YYYY-MM-DD key treats it as UTC.
  return `${shellDisplayDate(range.start)} — ${shellDisplayDate(inclusiveEnd)}`;
}

/** Same value the range filter used, so the column never disagrees with the range. */
function shellReviewDateText(date) {
  if (!date) return "—";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Node progress is a project feature the Demo's table does not show; it goes
 *  into the existing 状态 cell as a muted suffix rather than a new column. */
function shellReviewNodeProgress(task) {
  const total = shellNodeList(task).length;
  if (!total) return "";
  const done = shellCountDoneNodes(task);
  return `<span class="muted">${done}/${total} 节点</span>`;
}

function shellTemporalSummary(value) {
  const text = String(value).trim();
  if (text.length <= 180) return `<p class="summary">${esc(text)}</p>`;
  return `<details class="temporal-summary"><summary><span class="temporal-summary-preview">${esc(text.slice(0, 180))}…</span><span class="temporal-summary-label">完整摘要</span></summary><p class="summary">${esc(text)}</p></details>`;
}

function renderShellReviewSummary(items) {
  const tasksInScope = items.map(({ task }) => task);
  const doneTasks = tasksInScope.filter((t) => t.status === "done");
  const doneNodesCount = tasksInScope.reduce((acc, t) => acc + shellCountDoneNodes(t), 0);
  const conclCount = doneTasks.filter((t) => String(t.conclusion || "").trim()).length;
  const conclPct = doneTasks.length ? Math.round((conclCount / doneTasks.length) * 100) : 0;
  const blockedCount = tasksInScope.filter((t) => t.status !== "done" && normalizeTaskTags(t.tags).blocked).length;

  // 13-week (91-day) activity heatmap from real task/node timestamps
  const today = loopNow();
  const countsByDay = new Map();
  const bump = (iso) => {
    const d = safeDate(iso);
    if (!d) return;
    const k = localDateKey(d);
    countsByDay.set(k, (countsByDay.get(k) || 0) + 1);
  };
  for (const t of state.tasks) {
    if (t.resolvedAt) bump(t.resolvedAt);
    else if (t.updatedAt) bump(t.updatedAt);
    for (const n of shellNodeList(t)) {
      if (n.status === "done" && (n.updatedAt || n.createdAt)) bump(n.updatedAt || n.createdAt);
    }
  }
  const cells = [];
  for (let i = 90; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const k = localDateKey(d);
    const n = countsByDay.get(k) || 0;
    const lvl = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3;
    cells.push(`<i class="heat-cell l${lvl}" title="${k}：${n} 条活动"></i>`);
  }

  return `<div class="review-v2-overview">
    <div class="review-kpis">
      <div class="review-kpi"><b>${doneTasks.length}</b><span>个任务闭环</span></div>
      <div class="review-kpi"><b>${doneNodesCount}</b><span>个节点完成</span></div>
      <div class="review-kpi"><b>${conclCount}</b><span>条结论写下${doneTasks.length ? ` · ${conclPct}%` : ""}</span></div>
      <div class="review-kpi"><b>${blockedCount}</b><span>个任务仍卡住</span></div>
    </div>
    <div class="review-heat-block">
      <div class="review-heat-head"><b>节点活动</b><span>近 13 周 · 每格一天</span></div>
      <div class="review-heat-grid" aria-hidden="true">${cells.join("")}</div>
    </div>
  </div>`;
}

function renderShellReview() {
  const { range, items } = shellReviewItems();
  const invalid = Boolean(range.error);
  return `<div class="review-v2-head">
      <h1>回顾</h1>
      <span class="review-v2-range">${esc(shellReviewRangeLabel(range))}</span>
      <div class="review-controls-row">
      <div class="segmented" aria-label="回顾时间范围">
        ${SHELL_REVIEW_PRESETS.map(([value, label]) => `<button class="${state.reviewPreset === value ? "active" : ""}" type="button" data-action="set-review-preset" data-preset="${value}" aria-pressed="${state.reviewPreset === value}">${label}</button>`).join("")}
      </div>
      <label class="field-select">依据
        <select data-review-date-field aria-label="回顾日期依据">
          ${Object.entries(SHELL_REVIEW_FIELD_LABELS).map(([value, label]) => `<option value="${value}" ${state.reviewDateField === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      ${state.reviewPreset === "custom" ? `<div class="review-range">
        <label for="review-start">从</label>
        <input class="range-input" type="date" id="review-start" data-review-date-bound="start" aria-label="开始日期" aria-invalid="${invalid}" ${invalid ? 'aria-describedby="review-range-error"' : ""} value="${escAttr(state.reviewStartDate)}" />
        <label for="review-end">至</label>
        <input class="range-input" type="date" id="review-end" data-review-date-bound="end" aria-label="结束日期" aria-invalid="${invalid}" ${invalid ? 'aria-describedby="review-range-error"' : ""} value="${escAttr(state.reviewEndDate)}" />
        ${invalid ? '<p class="range-error" id="review-range-error" role="alert">请选择完整日期，结束日期不能早于开始日期。</p>' : ""}
      </div>` : ""}
      </div>
    </div>
    ${renderShellReviewSummary(items)}
    <section class="review-content">
      <div class="review-caption">
        <span><b>${esc(shellReviewRangeLabel(range))}</b> · ${SHELL_REVIEW_FIELD_LABELS[state.reviewDateField] || "更新日期"}</span>
        <span>${items.length} 个任务 · ${items.filter(({ task }) => task.status === "done").length} 已完成</span>
      </div>
      ${items.length
        ? `<table class="review-table">
            <caption class="temporal-table-caption">${esc(shellReviewRangeLabel(range))} · ${SHELL_REVIEW_FIELD_LABELS[state.reviewDateField] || "更新日期"}</caption>
            <thead><tr>
              <th class="review-title-col" scope="col">任务与处理摘要</th>
              <th class="review-group-col" scope="col">分组</th>
              <th class="review-state-col" scope="col">状态</th>
              <th class="review-date-col" scope="col">${SHELL_REVIEW_FIELD_LABELS[state.reviewDateField] || "更新日期"}</th>
            </tr></thead>
            <tbody>${items.map(({ task, date }) => {
              const group = state.taskGroups.find((item) => item.id === task.groupId);
              const done = task.status === "done";
              return `<tr>
                <td><button class="review-task-title" type="button" data-action="open-review-task" data-task-id="${escAttr(task.id)}">${esc(task.title || "未命名任务")}</button>${shellTemporalSummary(task.conclusion || task.hypothesis || task.description || "尚未记录处理过程")}</td>
                <td class="muted">${esc(group?.title || "未分组")}</td>
                <td><span class="badge ${done ? "green is-done" : task.tags?.blocked ? "orange is-blocked" : task.tags?.later ? "is-later" : "is-open"}">${done ? "已完成" : task.tags?.blocked ? "卡住" : task.tags?.later ? "暂缓" : "未完成"}</span>${shellReviewNodeProgress(task)}</td>
                <td class="date">${esc(shellReviewDateText(date))}</td>
              </tr>`;
            }).join("")}</tbody>
          </table>`
        : `<div class="empty"><p>${shellReviewRangeError() ? "调整日期范围后查看任务。" : "这个范围内还没有任务记录。"}</p><button class="button" type="button" data-action="set-review-preset" data-preset="all">查看全部时间</button></div>`}
    </section>`;
}

function shellReviewRangeError() {
  if (state.reviewPreset !== "custom") return false;
  return customReviewRange().error;
}

// A single keyboard stop for the calendar; native Tab still reaches the agenda.
document.addEventListener("keydown", (event) => {
  const day = event.target.closest?.('.calendar-day[data-action="select-calendar-date"]');
  if (!day || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
  const date = parseDateInput(day.dataset.date);
  if (!date) return;
  const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (Object.hasOwn(offsets, event.key)) date.setDate(date.getDate() + offsets[event.key]);
  else if (event.key === "Home") date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  else if (event.key === "End") date.setDate(date.getDate() + 6 - (date.getDay() + 6) % 7);
  else if (event.key === "PageUp" || event.key === "PageDown") {
    const originalDay = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + (event.key === "PageUp" ? -1 : 1));
    date.setDate(Math.min(originalDay, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  } else return;
  event.preventDefault();
  const key = localDateKey(date);
  void action({ action: "select-calendar-date", date: key }).then(() => {
    document.querySelector(`.calendar-day[data-date="${key}"]`)?.focus({ preventScroll: true });
  });
});

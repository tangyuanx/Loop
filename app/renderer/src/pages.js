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

const SHELL_REVIEW_PRESETS = [["week", "本周"], ["month", "本月"], ["quarter", "近 90 天"], ["custom", "自定义…"]];

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

function shellCalendarOccurrences(date, now = loopNow()) {
  const key = localDateKey(date);
  if (key < localDateKey(now)) return [];
  const evening = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59);
  return state.tasks.filter(task => !shellTaskIsNote(task) && localDateKey(task.deadlineAt) !== key
    && isRecurringTaskDue(task, evening));
}

function renderShellCalendar() {
  ensureCalendarState();
  const month = shellCalendarMonth();
  const todayKey = loopTodayKey();
  const selectedKey = state.calendarSelectedDate;
  const selected = parseDateInput(selectedKey) || loopNow();
  const week = state.calendarView === "week";
  const anchor = week ? selected : new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - (anchor.getDay() + 6) % 7);
  const weeks = week ? 1 : 6;
  const agenda = calendarTasksForDate(selectedKey);
  const now = loopNow();
  const cycles = shellCalendarOccurrences(selected, now);
  const days = Array.from({ length: weeks * 7 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = localDateKey(date);
    const dueItems = calendarTasksForDate(key);
    const occurrences = shellCalendarOccurrences(date, now);
    const items = [...dueItems.map(task => ({ task, occurrence: false })), ...occurrences.map(task => ({ task, occurrence: true }))];
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const previewChips = items.slice(0, 3).map(({ task, occurrence }) => {
      const tone = occurrence ? "is-open" : task.status === "done" ? "is-done" : Date.parse(task.deadlineAt) < +now ? "is-overdue" : "is-open";
      const repeat = occurrence || normalizeTaskRecurrence(task.recurrence).frequency !== "none";
      return `<span class="cal-ev ${tone}" title="${escAttr(task.title)}"><span>${esc(task.title)}</span>${repeat ? shellIcon("repeat") : ""}</span>`;
    }).join("");
    const label = `${key} · ${dueItems.length} 项截止${items.length > dueItems.length ? ` · ${items.length - dueItems.length} 项循环` : ""}`;
    return `<button class="calendar-day ${date.getMonth() !== month.getMonth() ? "outside" : ""} ${weekend ? "weekend" : ""} ${key === todayKey ? "today" : ""} ${key === selectedKey ? "selected" : ""}" type="button" data-action="select-calendar-date" data-date="${key}" tabindex="${key === selectedKey ? "0" : "-1"}" aria-label="${label}" aria-pressed="${key === selectedKey}" ${key === todayKey ? 'aria-current="date"' : ""}>
      <span class="day-number">${date.getDate()}</span>
      <span class="cal-day-events">${previewChips}${items.length > 3 ? `<span class="cal-ev-more">还有 ${items.length - 3} 项</span>` : ""}</span>
    </button>`;
  }).join("");

  const navigation = normalizeCurrentWorkNavigation();
  const phases = state.uiPreferences.workNavigationEnabled && navigation.config.workdays.includes(selected.getDay())
    ? workNavigationModel.phasesForDate(navigation, selected).filter(phase => phase.type !== "break") : [];
  const hourStart = 8, hourEnd = 21, rowHeight = 38;
  const from = hourStart * 60, to = hourEnd * 60;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const timeTop = minute => (minute - from) / 60 * rowHeight;
  const shownPhases = phases.filter(phase => workNavigationModel.minutes(phase.end) > from && workNavigationModel.minutes(phase.start) < to);
  return `<div class="month-controls calendar-header">
      <h2>${month.getFullYear()}年${month.getMonth() + 1}月</h2>
      <button class="icon-button" type="button" data-action="shift-calendar-month" data-direction="-1" aria-label="上一${week ? "周" : "个月"}" style="transform:rotate(180deg)">${shellIcon("chevron")}</button>
      <button class="icon-button" type="button" data-action="shift-calendar-month" data-direction="1" aria-label="下一${week ? "周" : "个月"}">${shellIcon("chevron")}</button>
      <button class="button" type="button" data-action="calendar-today" title="回到今天">今天</button>
      <div class="segmented calendar-view-picker" aria-label="日历视图">${[["month", "月"], ["week", "周"]].map(([value, text]) => `<button class="${value === state.calendarView ? "active" : ""}" type="button" data-action="set-calendar-view" data-value="${value}" aria-pressed="${value === state.calendarView}">${text}</button>`).join("")}</div>
    </div>
    <div class="calendar-layout calendar-v2">
      <section class="calendar-main" aria-label="截止日期日历">
        <div class="calendar-weekdays" aria-hidden="true">${["一", "二", "三", "四", "五", "六", "日"].map(day => `<span>周${day}</span>`).join("")}</div>
        <div class="calendar-grid" style="--calendar-weeks:${weeks}">${days}</div>
      </section>
      <aside class="agenda" aria-label="当天截止与日程">
        <div class="agenda-head"><h2>${shellDisplayDate(selected).replaceAll(" ", "")}${selectedKey === todayKey ? " · 今天" : ""}</h2>
          <p>${agenda.length} 项截止 · ${shownPhases.length} 段日程</p></div>
        <div class="agenda-scroll">
          <h3>截止</h3>
          ${agenda.length ? agenda.map(task => `<button class="agenda-item" type="button" data-action="open-calendar-task" data-task-id="${escAttr(task.id)}">
            <time>${esc(shellTimeLabel(task.deadlineAt))}</time><span>${esc(task.title)}<small>${esc(task.status === "done" && task.conclusion ? task.conclusion : shellGroupTitle(task.groupId))}</small></span>
          </button>`).join("") : '<p class="agenda-empty">当天没有截止的任务</p>'}
          ${cycles.length ? `<h3>循环</h3>${cycles.map(task => `<button class="agenda-item" type="button" data-action="open-calendar-task" data-task-id="${escAttr(task.id)}">
            <time>${esc(normalizeTaskRecurrence(task.recurrence).time)}</time><span>${esc(task.title)}<small>${esc(shellGroupTitle(task.groupId))}</small></span>
          </button>`).join("")}` : ""}
          <h3>日程</h3>
          <div class="agenda-timeline" aria-label="08:00 至 21:00">
            ${Array.from({ length: hourEnd - hourStart + 1 }, (_, index) => `<div class="agenda-hour"><span>${String(index + hourStart).padStart(2, "0")}:00</span></div>`).join("")}
            ${shownPhases.map(phase => {
              const top = timeTop(Math.max(from, workNavigationModel.minutes(phase.start)));
              const end = timeTop(Math.min(to, workNavigationModel.minutes(phase.end)));
              return `<div class="agenda-block" style="top:${top}px;height:${Math.max(1, end - top - 3)}px">${esc(phase.label)}<small>${esc(phase.start)} – ${esc(phase.end)}</small></div>`;
            }).join("")}
            ${selectedKey === todayKey && minutes >= from && minutes <= to ? `<div class="agenda-now" style="top:${timeTop(minutes)}px" title="${escAttr(shellTimeLabel(now))}"></div>` : ""}
          </div>
        </div>
      </aside>
    </div>`;
}

// ------------------------------------------------------------
// Review
// ------------------------------------------------------------

function shellReviewRangeLabel(range) {
  if (range.error) return "日期范围无效";
  if (!range.start || !range.end) return "全部时间";
  const end = new Date(range.end);
  end.setDate(end.getDate() - 1);
  const dateText = date => `${date.getMonth() + 1}/${date.getDate()}`;
  return `${dateText(range.start)} – ${dateText(end)}`;
}

function renderShellReviewSummary(doneTasks, openTasks, range) {
  const doneNodesCount = state.tasks.reduce((count, task) => count + shellNodeList(task).filter(node => {
    const date = safeDate(node.completedAt || node.statusChangedAt || node.updatedAt);
    return node.status === "done" && date && !range.error && isWithinRange(date, range);
  }).length, 0);
  const conclCount = doneTasks.filter((t) => String(t.conclusion || "").trim()).length;
  const conclPct = doneTasks.length ? Math.round((conclCount / doneTasks.length) * 100) : 0;
  const blockedCount = openTasks.filter(task => normalizeTaskTags(task.tags).blocked).length;

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
    for (const n of shellNodeList(t)) {
      if (n.status === "done") bump(n.completedAt || n.statusChangedAt || n.updatedAt);
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
      <div class="review-kpi"><b>${conclCount}</b><span>条结论写下${doneTasks.length ? ` · ${conclPct}% 有结论` : ""}</span></div>
      <div class="review-kpi"><b>${blockedCount}</b><span>个任务仍卡住</span></div>
    </div>
    <div class="review-heat-block">
      <div class="review-heat-head"><b>节点活动</b><span>近 13 周 · 每格一天</span></div>
      <div class="review-heat-grid" aria-hidden="true">${cells.join("")}</div><p class="review-heat-legend">颜色越深，当天完成的节点越多</p>
    </div>
  </div>`;
}

function renderShellReview() {
  const range = reviewRange();
  const invalid = shellReviewRangeError(range);
  const tasks = state.tasks.filter(task => !shellTaskIsNote(task));
  const done = invalid ? [] : tasks.filter(task => {
    const date = taskReviewDate(task, "resolved");
    return date && isWithinRange(date, range);
  }).sort((a, b) => +taskReviewDate(b, "resolved") - +taskReviewDate(a, "resolved"));
  const open = tasks.filter(task => task.status !== "done");
  const pending = open.map(task => {
    const review = shellNodeList(task).filter(node => node.status === "review").length;
    const why = [normalizeTaskTags(task.tags).blocked && "卡住", review && `${review} 个待确认`, !task.conclusion?.trim() && "缺结论"].filter(Boolean);
    return { task, why };
  }).filter(item => item.why.length);
  return `<div class="review-v2-head">
      <h1>回顾</h1>
      <span class="review-v2-range">${esc(shellReviewRangeLabel(range))}</span>
      <div class="review-controls-row">
      <div class="segmented" aria-label="回顾时间范围">
        ${SHELL_REVIEW_PRESETS.map(([value, label]) => `<button class="${state.reviewPreset === value ? "active" : ""}" type="button" data-action="set-review-preset" data-preset="${value}" aria-pressed="${state.reviewPreset === value}">${label}</button>`).join("")}
      </div>
      ${state.reviewPreset === "custom" ? `<div class="review-range">
        <label for="review-start">从</label>
        <input class="range-input" type="date" id="review-start" data-review-date-bound="start" aria-label="开始日期" aria-invalid="${invalid}" ${invalid ? 'aria-describedby="review-range-error"' : ""} value="${escAttr(state.reviewStartDate)}" />
        <label for="review-end">至</label>
        <input class="range-input" type="date" id="review-end" data-review-date-bound="end" aria-label="结束日期" aria-invalid="${invalid}" ${invalid ? 'aria-describedby="review-range-error"' : ""} value="${escAttr(state.reviewEndDate)}" />
        ${invalid ? '<p class="range-error" id="review-range-error" role="alert">请选择完整日期，结束日期不能早于开始日期。</p>' : ""}
      </div>` : ""}
      </div>
    </div>
    <section class="review-content review-loop">
      ${renderShellReviewSummary(done, open, range)}
      <h2>已闭环 <small>${done.length} 个 · 按完成时间</small></h2>
      ${done.length ? done.map(task => {
        const date = taskReviewDate(task, "resolved");
        return `<button class="review-closed" type="button" data-action="open-review-task" data-task-id="${escAttr(task.id)}">
          <time>${date.getMonth() + 1}/${date.getDate()}</time><span>${esc(task.title)}</span><small>${shellCountDoneNodes(task)} 节点 · ${esc(shellGroupTitle(task.groupId))}</small>
          ${task.conclusion?.trim() ? `<p><small>结论</small> ${esc(task.conclusion)}</p>` : ""}
        </button>`;
      }).join("") : '<p class="review-heat-legend">这个范围内还没有闭环任务</p>'}
      <h2>尚未闭环 <small>有阻塞、待确认或缺结论</small></h2>
      ${pending.map(({ task, why }) => `<button class="review-pending" type="button" data-action="open-review-task" data-task-id="${escAttr(task.id)}">
        ${shellTaskRowSignals(task)}<span>${esc(task.title)}</span><small>${esc(why.join(" · "))}</small>
      </button>`).join("")}
    </section>`;
}

function shellReviewRangeError(range = reviewRange()) {
  return Boolean(range.error);
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

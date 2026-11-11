(function attachLoopWorkNavigationModel(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LoopWorkNavigationModel = api;
})(typeof globalThis === "object" ? globalThis : this, function createLoopWorkNavigationModel() {
  "use strict";

  const SCHEMA_VERSION = 2;
  const PHASE_TYPES = new Set(["work", "growth", "break", "meeting"]);
  const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const DEFAULT_SCHEDULE = Object.freeze({
    workStart: "09:40",
    morningEnd: "11:50",
    afternoonStart: "13:40",
    restStart: "15:15",
    restEnd: "15:30",
    transitionStart: "17:00",
    learningStart: "17:10",
    learningEnd: "18:10",
    fridayMeetingStart: "15:00",
    fridayMeetingEnd: "16:00",
  });
  const DEFAULT_PHASES = Object.freeze([
    Object.freeze({ id: "morning-work", type: "work", label: "上午工作", start: "09:40", end: "11:50" }),
    Object.freeze({ id: "lunch", type: "break", label: "午间休息", start: "11:50", end: "13:40" }),
    Object.freeze({ id: "afternoon-work", type: "work", label: "下午工作", start: "13:40", end: "15:15" }),
    Object.freeze({ id: "rest", type: "break", label: "休息缓冲", start: "15:15", end: "15:30" }),
    Object.freeze({ id: "deep-work", type: "work", label: "深度工作", start: "15:30", end: "17:00" }),
    Object.freeze({ id: "transition", type: "break", label: "学习过渡", start: "17:00", end: "17:10" }),
    Object.freeze({ id: "growth", type: "growth", label: "个人成长", start: "17:10", end: "18:10" }),
  ]);

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function text(value, max = 5000) {
    return typeof value === "string" ? value.slice(0, max) : "";
  }

  function identifier(value, max = 160) {
    return text(value, max).trim();
  }

  function boolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function integer(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function normalizeTime(value, fallback = "") {
    const candidate = text(value, 5).trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate)) return fallback;
    return candidate;
  }

  function minutes(value) {
    const normalized = normalizeTime(value);
    if (!normalized) return -1;
    const [hours, mins] = normalized.split(":").map(Number);
    return hours * 60 + mins;
  }

  function localDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function normalizeWeekdays(value) {
    if (!Array.isArray(value)) return [1, 2, 3, 4, 5];
    const selected = new Set(value.map(Number).filter((day) => WEEKDAY_ORDER.includes(day)));
    return WEEKDAY_ORDER.filter((day) => selected.has(day));
  }

  function normalizePhase(raw, fallback) {
    const value = isRecord(raw) ? raw : {};
    return {
      id: fallback.id,
      type: PHASE_TYPES.has(value.type) ? value.type : fallback.type,
      label: identifier(value.label, 24) || fallback.label,
      start: normalizeTime(value.start, fallback.start),
      end: normalizeTime(value.end, fallback.end),
    };
  }

  function normalizeIdentifiers(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => identifier(item)).filter(Boolean))];
  }

  function normalizeSchedule(value) {
    const raw = isRecord(value) ? value : {};
    const schedule = Object.fromEntries(Object.entries(DEFAULT_SCHEDULE).map(([key, fallback]) => [
      key,
      normalizeTime(raw[key], fallback),
    ]));
    return validateSchedule(schedule).valid ? schedule : clone(DEFAULT_SCHEDULE);
  }

  function validateSchedule(value) {
    const schedule = isRecord(value) ? value : {};
    const errors = [];
    const required = Object.keys(DEFAULT_SCHEDULE);
    required.forEach((key) => {
      if (minutes(schedule[key]) < 0) errors.push({ field: key, message: "时间格式无效" });
    });
    if (errors.length) return { valid: false, errors };
    const normalOrder = ["workStart", "morningEnd", "afternoonStart", "restStart", "restEnd", "transitionStart", "learningStart", "learningEnd"];
    normalOrder.slice(1).forEach((key, index) => {
      if (minutes(schedule[key]) <= minutes(schedule[normalOrder[index]])) {
        errors.push({ field: key, message: "每日时间必须按顺序递增" });
      }
    });
    if (minutes(schedule.fridayMeetingStart) < minutes(schedule.afternoonStart)
      || minutes(schedule.fridayMeetingEnd) > minutes(schedule.transitionStart)
      || minutes(schedule.fridayMeetingEnd) <= minutes(schedule.fridayMeetingStart)) {
      errors.push({ field: "fridayMeetingStart", message: "周五例会必须位于下午工作时段内" });
    }
    if (minutes(schedule.learningEnd) - minutes(schedule.learningStart) < 60) {
      errors.push({ field: "learningEnd", message: "每日学习时间不能少于 60 分钟" });
    }
    return { valid: errors.length === 0, errors };
  }

  function phasesForDate(navigation, value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const schedule = normalizeSchedule(navigation?.config?.schedule);
    if (date.getDay() === 5) {
      return [
        { id: "morning-work", type: "work", label: "上午工作", start: schedule.workStart, end: schedule.morningEnd },
        { id: "lunch", type: "break", label: "午间休息", start: schedule.morningEnd, end: schedule.afternoonStart },
        { id: "afternoon-work", type: "work", label: "下午工作", start: schedule.afternoonStart, end: schedule.fridayMeetingStart },
        { id: "friday-meeting", type: "meeting", label: "周例会", start: schedule.fridayMeetingStart, end: schedule.fridayMeetingEnd },
        { id: "deep-work", type: "work", label: "会后工作", start: schedule.fridayMeetingEnd, end: schedule.transitionStart },
        { id: "transition", type: "break", label: "学习过渡", start: schedule.transitionStart, end: schedule.learningStart },
        { id: "growth", type: "growth", label: "个人成长", start: schedule.learningStart, end: schedule.learningEnd },
      ];
    }
    return [
      { id: "morning-work", type: "work", label: "上午工作", start: schedule.workStart, end: schedule.morningEnd },
      { id: "lunch", type: "break", label: "午间休息", start: schedule.morningEnd, end: schedule.afternoonStart },
      { id: "afternoon-work", type: "work", label: "下午工作", start: schedule.afternoonStart, end: schedule.restStart },
      { id: "rest", type: "break", label: "休息缓冲", start: schedule.restStart, end: schedule.restEnd },
      { id: "deep-work", type: "work", label: "深度工作", start: schedule.restEnd, end: schedule.transitionStart },
      { id: "transition", type: "break", label: "学习过渡", start: schedule.transitionStart, end: schedule.learningStart },
      { id: "growth", type: "growth", label: "个人成长", start: schedule.learningStart, end: schedule.learningEnd },
    ];
  }

  function validatePhaseSchedule(phases) {
    const errors = [];
    let previousEnd = -1;
    phases.forEach((phase, index) => {
      const start = minutes(phase.start);
      const end = minutes(phase.end);
      if (start < 0) errors.push({ field: `phases[${index}].start`, message: "开始时间格式无效" });
      if (end < 0) errors.push({ field: `phases[${index}].end`, message: "结束时间格式无效" });
      if (start >= 0 && end >= 0 && end <= start) {
        errors.push({ field: `phases[${index}].end`, message: "结束时间必须晚于开始时间" });
      }
      if (start >= 0 && previousEnd >= 0 && start < previousEnd) {
        errors.push({ field: `phases[${index}].start`, message: "时间段不能与上一阶段重叠" });
      }
      if (end >= 0) previousEnd = end;
    });
    return { valid: errors.length === 0, errors };
  }

  function normalizePhases(value) {
    const source = Array.isArray(value) ? value : [];
    const byId = new Map(source.filter(isRecord).map((phase) => [phase.id, phase]));
    const phases = DEFAULT_PHASES.map((fallback) => normalizePhase(byId.get(fallback.id), fallback));
    return validatePhaseSchedule(phases).valid ? phases : clone(DEFAULT_PHASES);
  }

  function normalizeRecovery(value) {
    const raw = isRecord(value) ? value : {};
    return {
      updatedAt: text(raw.updatedAt, 64),
      progress: text(raw.progress, 4000).trim(),
      nextAction: text(raw.nextAction, 1000).trim(),
      evidenceRef: text(raw.evidenceRef, 2000).trim(),
    };
  }

  function normalizeOrigin(value) {
    const raw = isRecord(value) ? value : {};
    const itemId = identifier(raw.itemId);
    if (raw.kind === "learning-plan") {
      const planId = identifier(raw.planId);
      return planId && itemId ? { kind: "learning-plan", planId, itemId } : null;
    }
    if (raw.kind === "task-batch") {
      const batchId = identifier(raw.batchId);
      return batchId && itemId ? { kind: "task-batch", batchId, itemId } : null;
    }
    return null;
  }

  function defaultWorkNavigation(now = new Date()) {
    return {
      schemaVersion: SCHEMA_VERSION,
      config: {
        workdays: [1, 2, 3, 4, 5],
        phases: clone(DEFAULT_PHASES),
        schedule: clone(DEFAULT_SCHEDULE),
        work: { autoAdvance: true },
        growth: {
          sourceGroupId: "",
          autoAdvance: true,
          weekendEnabled: true,
          weekendDurationMinutes: 60,
          weekendStartTime: "",
        },
      },
      runtime: {
        dateKey: localDateKey(now),
        activeWorkTaskId: "",
        activeGrowthTaskId: "",
        workQueueIds: [],
        growthQueueIds: [],
        blockedTaskIds: [],
        workAdvancePaused: false,
        growthAdvancePaused: false,
        manualPhaseId: "",
        manualPhaseExpiresAt: "",
        weekendStartedAt: "",
      },
    };
  }

  function normalizeWorkNavigation(value, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const defaults = defaultWorkNavigation(now);
    const raw = isRecord(value) ? value : {};
    const config = isRecord(raw.config) ? raw.config : {};
    const work = isRecord(config.work) ? config.work : {};
    const growth = isRecord(config.growth) ? config.growth : {};
    const runtime = isRecord(raw.runtime) ? raw.runtime : {};
    const groupIds = Array.isArray(options.groupIds) ? new Set(options.groupIds.map((groupId) => identifier(groupId))) : null;
    let sourceGroupId = identifier(growth.sourceGroupId);
    if (groupIds && sourceGroupId && !groupIds.has(sourceGroupId)) sourceGroupId = "";
    const normalized = {
      schemaVersion: SCHEMA_VERSION,
      config: {
        workdays: normalizeWeekdays(config.workdays),
        phases: clone(DEFAULT_PHASES),
        schedule: normalizeSchedule(config.schedule),
        work: { autoAdvance: boolean(work.autoAdvance, true) },
        growth: {
          sourceGroupId,
          autoAdvance: boolean(growth.autoAdvance, true),
          weekendEnabled: boolean(growth.weekendEnabled, true),
          weekendDurationMinutes: integer(growth.weekendDurationMinutes, 60, 60, 720),
          weekendStartTime: normalizeTime(growth.weekendStartTime, ""),
        },
      },
      runtime: {
        dateKey: text(runtime.dateKey, 10),
        activeWorkTaskId: identifier(runtime.activeWorkTaskId),
        activeGrowthTaskId: identifier(runtime.activeGrowthTaskId),
        workQueueIds: normalizeIdentifiers(runtime.workQueueIds),
        growthQueueIds: normalizeIdentifiers(runtime.growthQueueIds),
        blockedTaskIds: normalizeIdentifiers(runtime.blockedTaskIds),
        workAdvancePaused: boolean(runtime.workAdvancePaused, false),
        growthAdvancePaused: boolean(runtime.growthAdvancePaused, false),
        manualPhaseId: identifier(runtime.manualPhaseId),
        manualPhaseExpiresAt: text(runtime.manualPhaseExpiresAt, 64),
        weekendStartedAt: text(runtime.weekendStartedAt, 64),
      },
    };
    const today = localDateKey(now);
    if (normalized.runtime.dateKey !== today) {
      normalized.runtime.dateKey = today;
      normalized.runtime.activeWorkTaskId = "";
      normalized.runtime.activeGrowthTaskId = "";
      normalized.runtime.workQueueIds = [];
      normalized.runtime.growthQueueIds = [];
      normalized.runtime.blockedTaskIds = [];
      normalized.runtime.workAdvancePaused = false;
      normalized.runtime.growthAdvancePaused = false;
      normalized.runtime.manualPhaseId = "";
      normalized.runtime.manualPhaseExpiresAt = "";
      normalized.runtime.weekendStartedAt = "";
    }
    const manualExpiry = new Date(normalized.runtime.manualPhaseExpiresAt);
    if (!phasesForDate(normalized, now).some((phase) => phase.id === normalized.runtime.manualPhaseId)
      || Number.isNaN(manualExpiry.getTime())
      || manualExpiry <= now) {
      normalized.runtime.manualPhaseId = "";
      normalized.runtime.manualPhaseExpiresAt = "";
    }
    const weekendStart = new Date(normalized.runtime.weekendStartedAt);
    if (Number.isNaN(weekendStart.getTime()) || localDateKey(weekendStart) !== today) {
      normalized.runtime.weekendStartedAt = "";
    }
    return normalized;
  }

  function phaseStateBase(phase, mode, now, extra = {}) {
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    const start = phase ? minutes(phase.start) : -1;
    const end = phase ? minutes(phase.end) : -1;
    const remainingMinutes = mode === "active" && end >= 0
      ? Math.max(0, end - currentMinute)
      : mode === "next" || mode === "gap"
        ? Math.max(0, start - currentMinute)
        : 0;
    return { phase, mode, remainingMinutes, manual: false, weekend: false, ...extra };
  }

  function resolvePhase(value = new Date(), navigation = defaultWorkNavigation(value)) {
    const now = value instanceof Date ? value : new Date(value);
    const nav = normalizeWorkNavigation(navigation, { now });
    const phases = phasesForDate(nav, now);
    const manual = phases.find((phase) => phase.id === nav.runtime.manualPhaseId);
    if (manual) {
      const expiry = new Date(nav.runtime.manualPhaseExpiresAt);
      return {
        phase: manual,
        mode: "active",
        remainingMinutes: Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / 60000)),
        manual: true,
        weekend: false,
      };
    }

    const weekday = now.getDay();
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    if (nav.config.workdays.includes(weekday)) {
      const active = phases.find((phase) => currentMinute >= minutes(phase.start) && currentMinute < minutes(phase.end));
      if (active) return phaseStateBase(active, "active", now);
      const next = phases.find((phase) => currentMinute < minutes(phase.start));
      if (next) {
        const firstStart = minutes(phases[0]?.start);
        return phaseStateBase(next, currentMinute < firstStart ? "next" : "gap", now);
      }
      return phaseStateBase(phases.at(-1) || null, "ended", now);
    }

    if (nav.config.growth.weekendEnabled && (weekday === 0 || weekday === 6)) {
      const duration = nav.config.growth.weekendDurationMinutes;
      const growthPhase = {
        id: "weekend-growth",
        type: "growth",
        label: "个人成长",
        start: nav.config.growth.weekendStartTime,
        end: "",
      };
      let startedAt = nav.runtime.weekendStartedAt ? new Date(nav.runtime.weekendStartedAt) : null;
      if (!startedAt && nav.config.growth.weekendStartTime) {
        const startMinute = minutes(nav.config.growth.weekendStartTime);
        startedAt = new Date(now);
        startedAt.setHours(Math.floor(startMinute / 60), startMinute % 60, 0, 0);
      }
      if (!startedAt) {
        return { phase: growthPhase, mode: "weekend-ready", remainingMinutes: duration, manual: false, weekend: true };
      }
      const endAt = new Date(startedAt.getTime() + duration * 60000);
      if (now < startedAt) {
        return { phase: growthPhase, mode: "next", remainingMinutes: Math.ceil((startedAt - now) / 60000), manual: false, weekend: true };
      }
      if (now >= endAt) {
        return { phase: growthPhase, mode: "ended", remainingMinutes: 0, manual: false, weekend: true };
      }
      return { phase: growthPhase, mode: "active", remainingMinutes: Math.ceil((endAt - now) / 60000), manual: false, weekend: true };
    }

    return { phase: null, mode: "off-day", remainingMinutes: 0, manual: false, weekend: false };
  }

  function nextBoundaryAt(value, navigation) {
    const now = value instanceof Date ? value : new Date(value);
    const nav = normalizeWorkNavigation(navigation, { now });
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    const boundaries = phasesForDate(nav, now)
      .flatMap((phase) => [minutes(phase.start), minutes(phase.end)])
      .filter((minute) => minute > currentMinute)
      .sort((a, b) => a - b);
    const target = new Date(now);
    if (boundaries.length) {
      target.setHours(Math.floor(boundaries[0] / 60), boundaries[0] % 60, 0, 0);
    } else {
      target.setHours(23, 59, 59, 999);
    }
    return target.toISOString();
  }

  function taskIsBlocked(task) {
    if (!isRecord(task)) return false;
    if (task.tags?.blocked === true || (Array.isArray(task.tags) && task.tags.includes("blocked"))) return true;
    return flattenNodes(task.nodes, []).some((node) => node.status === "blocked");
  }

  function resolveWorkCandidates({ tasks = [], todayTaskIds = [], sourceGroupId = "", now = new Date(), blockedTaskIds = [] } = {}) {
    const at = now instanceof Date ? now : new Date(now);
    const today = new Set(todayTaskIds.map((taskId) => identifier(taskId)));
    const blocked = new Set(normalizeIdentifiers(blockedTaskIds));
    const priorityRank = { high: 0, medium: 1, low: 2 };
    const rank = (task) => {
      const deadline = new Date(task.deadlineAt || "");
      const deadlineTime = Number.isNaN(deadline.getTime()) ? Number.POSITIVE_INFINITY : deadline.getTime();
      if (deadlineTime < at.getTime()) return [0, deadlineTime];
      if (today.has(task.id) && deadlineTime < Number.POSITIVE_INFINITY) return [1, deadlineTime];
      if (today.has(task.id) && task.priority === "high") return [2, Number(task.order || 0)];
      if (today.has(task.id)) return [3, priorityRank[task.priority] ?? 3];
      return [4, priorityRank[task.priority] ?? 3];
    };
    return tasks
      .filter((task) => isRecord(task)
        && task.status !== "done"
        && (!sourceGroupId || task.groupId !== sourceGroupId)
        && !blocked.has(task.id)
        && !taskIsBlocked(task))
      .slice()
      .sort((a, b) => {
        const aRank = rank(a);
        const bRank = rank(b);
        return aRank[0] - bRank[0]
          || aRank[1] - bRank[1]
          || Number(a.order || 0) - Number(b.order || 0)
          || String(a.id).localeCompare(String(b.id));
      });
  }

  function resolveGrowthCandidates(tasks = [], sourceGroupId = "", blockedTaskIds = []) {
    if (!sourceGroupId) return [];
    const blocked = new Set(normalizeIdentifiers(blockedTaskIds));
    return tasks
      .filter((task) => isRecord(task)
        && task.status !== "done"
        && task.groupId === sourceGroupId
        && !blocked.has(task.id)
        && !taskIsBlocked(task))
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || String(a.id).localeCompare(String(b.id)));
  }

  function reconcileQueueIds(candidates = [], savedIds = []) {
    const candidateIds = candidates.map((task) => identifier(task?.id)).filter(Boolean);
    const available = new Set(candidateIds);
    const saved = normalizeIdentifiers(savedIds).filter((taskId) => available.has(taskId));
    const retained = new Set(saved);
    return [...saved, ...candidateIds.filter((taskId) => !retained.has(taskId))];
  }

  function resolveActiveTask(candidates = [], activeTaskId = "") {
    return candidates.find((task) => task.id === activeTaskId) || candidates[0] || null;
  }

  function flattenNodes(nodes, result = []) {
    (Array.isArray(nodes) ? nodes : []).forEach((node) => {
      if (!isRecord(node)) return;
      result.push(node);
      flattenNodes(node.children, result);
    });
    return result;
  }

  function firstDescriptionLine(value) {
    return text(value, 4000)
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:#{1,6}|[-*+] |\d+[.)]\s*)/, "").trim())
      .find(Boolean) || "";
  }

  function resolveNextAction(task) {
    if (!isRecord(task)) return "";
    const nodes = flattenNodes(task.nodes, []);
    const blocked = nodes.find((node) => node.status === "blocked" && identifier(node.title));
    if (blocked) return identifier(blocked.title, 1000);
    const open = nodes.find((node) => (node.status === "todo" || node.status === "review") && identifier(node.title));
    if (open) return identifier(open.title, 1000);
    const recovery = normalizeRecovery(task.navigationRecovery);
    if (recovery.nextAction) return recovery.nextAction;
    return firstDescriptionLine(task.description) || "补充下一动作";
  }

  function previousRecoveryTask(tasks = [], today = new Date()) {
    const todayKey = localDateKey(today);
    return tasks
      .filter((task) => task?.status !== "done")
      .map((task) => ({ task, recovery: normalizeRecovery(task.navigationRecovery) }))
      .filter(({ recovery }) => recovery.nextAction && localDateKey(recovery.updatedAt) && localDateKey(recovery.updatedAt) < todayKey)
      .sort((a, b) => new Date(b.recovery.updatedAt) - new Date(a.recovery.updatedAt))[0] || null;
  }

  function normalizePlanNode(value, taskIndex, nodeIndex, errors) {
    if (!isRecord(value)) {
      errors.push({ field: `tasks[${taskIndex}].nodes[${nodeIndex}]`, message: "节点必须是对象" });
      return null;
    }
    const title = identifier(value.title, 240);
    if (!title) errors.push({ field: `tasks[${taskIndex}].nodes[${nodeIndex}].title`, message: "节点标题不能为空" });
    return title ? { title, order: integer(value.order, nodeIndex + 1, 1, 10000) } : null;
  }

  function validateLearningPlan(value) {
    const errors = [];
    if (!isRecord(value)) return { valid: false, errors: [{ field: "$", message: "文件根节点必须是对象" }] };
    if (value.schemaVersion !== 1) errors.push({ field: "schemaVersion", message: "仅支持 schemaVersion 1" });
    if (value.type !== "loop-learning-plan") errors.push({ field: "type", message: "type 必须为 loop-learning-plan" });
    const plan = isRecord(value.plan) ? value.plan : {};
    const planId = identifier(plan.id);
    const planTitle = identifier(plan.title, 240);
    const targetGroup = identifier(plan.targetGroup, 240);
    if (!planId) errors.push({ field: "plan.id", message: "计划 ID 不能为空" });
    if (!planTitle) errors.push({ field: "plan.title", message: "计划标题不能为空" });
    if (!targetGroup) errors.push({ field: "plan.targetGroup", message: "目标分组不能为空" });
    if (!Array.isArray(value.tasks) || value.tasks.length === 0) {
      errors.push({ field: "tasks", message: "至少需要一项学习任务" });
    }
    if (Array.isArray(value.tasks) && value.tasks.length > 1000) {
      errors.push({ field: "tasks", message: "单次最多导入 1000 项任务" });
    }
    const itemIds = new Set();
    const normalizedTasks = (Array.isArray(value.tasks) ? value.tasks : []).map((raw, index) => {
      if (!isRecord(raw)) {
        errors.push({ field: `tasks[${index}]`, message: "任务必须是对象" });
        return null;
      }
      const itemId = identifier(raw.itemId);
      const title = identifier(raw.title, 240);
      const estimateMinutes = integer(raw.estimateMinutes, 0, 0, 720);
      if (!itemId) errors.push({ field: `tasks[${index}].itemId`, message: "itemId 不能为空" });
      if (itemIds.has(itemId)) errors.push({ field: `tasks[${index}].itemId`, message: "itemId 在计划内重复" });
      if (itemId) itemIds.add(itemId);
      if (!title) errors.push({ field: `tasks[${index}].title`, message: "标题不能为空" });
      if (estimateMinutes < 1) errors.push({ field: `tasks[${index}].estimateMinutes`, message: "预计分钟数必须大于 0" });
      const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
        .map((node, nodeIndex) => normalizePlanNode(node, index, nodeIndex, errors))
        .filter(Boolean);
      return itemId && title && estimateMinutes > 0 ? {
        itemId,
        order: integer(raw.order, index + 1, 1, 100000),
        title,
        estimateMinutes,
        description: text(raw.description, 20000).trim(),
        nodes,
      } : null;
    }).filter(Boolean);
    return {
      valid: errors.length === 0,
      errors,
      plan: errors.length ? null : {
        id: planId,
        title: planTitle,
        targetGroup,
        tasks: normalizedTasks.sort((a, b) => a.order - b.order),
      },
    };
  }

  function learningOriginKey(value) {
    const origin = normalizeOrigin(value);
    return origin ? `${origin.planId}\u0000${origin.itemId}` : "";
  }

  function previewLearningPlanImport(value, tasks = []) {
    const validation = validateLearningPlan(value);
    if (!validation.valid) return { ...validation, newTasks: [], existingTasks: [], totalMinutes: 0 };
    const existingKeys = new Set(tasks.map((task) => learningOriginKey(task.origin)).filter(Boolean));
    const newTasks = validation.plan.tasks.filter((task) => !existingKeys.has(`${validation.plan.id}\u0000${task.itemId}`));
    const existingTasks = validation.plan.tasks.filter((task) => existingKeys.has(`${validation.plan.id}\u0000${task.itemId}`));
    return {
      valid: true,
      errors: [],
      plan: validation.plan,
      newTasks,
      existingTasks,
      totalMinutes: newTasks.reduce((sum, task) => sum + task.estimateMinutes, 0),
    };
  }

  function normalizedTitleKey(value) {
    return identifier(value, 240).replace(/\s+/g, " ").toLocaleLowerCase();
  }

  function stableTextHash(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function normalizeTaskBatchItem(raw, index, errors) {
    if (!isRecord(raw)) {
      errors.push({ field: `tasks[${index}]`, message: "任务必须是对象" });
      return null;
    }
    const itemId = identifier(raw.itemId);
    const title = identifier(raw.title, 240);
    const hasEstimate = raw.estimateMinutes !== undefined && raw.estimateMinutes !== null && raw.estimateMinutes !== "";
    const rawEstimate = Number(raw.estimateMinutes);
    const validEstimate = !hasEstimate || (Number.isFinite(rawEstimate) && rawEstimate >= 1 && rawEstimate <= 720);
    const estimateMinutes = validEstimate && hasEstimate ? Math.round(rawEstimate) : 60;
    if (!itemId) errors.push({ field: `tasks[${index}].itemId`, message: "itemId 不能为空" });
    if (!title) errors.push({ field: `tasks[${index}].title`, message: "标题不能为空" });
    if (!validEstimate) errors.push({ field: `tasks[${index}].estimateMinutes`, message: "预计分钟数必须在 1–720 之间" });
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
      .map((node, nodeIndex) => normalizePlanNode(node, index, nodeIndex, errors))
      .filter(Boolean);
    return itemId && title ? {
      itemId,
      order: integer(raw.order, index + 1, 1, 100000),
      title,
      estimateMinutes,
      description: text(raw.description, 20000).trim(),
      nodes,
    } : null;
  }

  function validateTaskBatch(value) {
    const errors = [];
    if (!isRecord(value)) return { valid: false, errors: [{ field: "$", message: "文件根节点必须是对象" }] };
    if (value.schemaVersion !== 1) errors.push({ field: "schemaVersion", message: "仅支持 schemaVersion 1" });
    if (value.type !== "loop-task-batch") errors.push({ field: "type", message: "type 必须为 loop-task-batch" });
    const batch = isRecord(value.batch) ? value.batch : {};
    const batchId = identifier(batch.id);
    const batchTitle = identifier(batch.title, 240) || "批量任务";
    const targetGroup = identifier(batch.targetGroup, 240);
    if (!batchId) errors.push({ field: "batch.id", message: "批次 ID 不能为空" });
    if (!Array.isArray(value.tasks) || value.tasks.length === 0) errors.push({ field: "tasks", message: "至少需要一项任务" });
    if (Array.isArray(value.tasks) && value.tasks.length > 1000) errors.push({ field: "tasks", message: "单次最多导入 1000 项任务" });
    const itemIds = new Set();
    const normalizedTasks = (Array.isArray(value.tasks) ? value.tasks : []).map((raw, index) => {
      const item = normalizeTaskBatchItem(raw, index, errors);
      if (!item) return null;
      if (itemIds.has(item.itemId)) errors.push({ field: `tasks[${index}].itemId`, message: "itemId 在批次内重复" });
      itemIds.add(item.itemId);
      return item;
    }).filter(Boolean);
    return {
      valid: errors.length === 0,
      errors,
      batch: errors.length ? null : {
        id: batchId,
        title: batchTitle,
        targetGroup,
        tasks: normalizedTasks.sort((a, b) => a.order - b.order),
      },
    };
  }

  function stripTaskListPrefix(value) {
    return String(value)
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "")
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\s*\d+[.)、]\s*/, "")
      .trim();
  }

  function parseTaskBatchText(value, options = {}) {
    const defaultEstimateMinutes = integer(options.defaultEstimateMinutes, 60, 1, 720);
    const raw = text(value, 500000);
    const sourceLines = raw.split(/\r?\n/);
    const errors = [];
    const tasks = [];
    sourceLines.forEach((line, index) => {
      if (!line.trim() || /^\s*```/.test(line) || /^\s*#{1,6}\s+/.test(line)) return;
      const title = stripTaskListPrefix(line);
      if (!title) return;
      if (title.length > 240) {
        errors.push({ field: `lines[${index + 1}]`, message: `第 ${index + 1} 行超过 240 个字符` });
        return;
      }
      tasks.push({
        itemId: `line-${index + 1}`,
        order: tasks.length + 1,
        title,
        estimateMinutes: defaultEstimateMinutes,
        description: "",
        nodes: [],
      });
    });
    if (!tasks.length) errors.push({ field: "tasks", message: "至少需要一项任务" });
    if (tasks.length > 1000) errors.push({ field: "tasks", message: "单次最多导入 1000 项任务" });
    const signature = tasks.map((task) => normalizedTitleKey(task.title)).join("\n");
    return {
      valid: errors.length === 0,
      errors,
      batch: errors.length ? null : {
        id: `text-${stableTextHash(signature)}`,
        title: "批量任务",
        targetGroup: "",
        tasks,
      },
    };
  }

  function taskBatchOriginKey(value) {
    const origin = normalizeOrigin(value);
    if (!origin) return "";
    if (origin.kind === "learning-plan") return `learning-plan\u0000${origin.planId}\u0000${origin.itemId}`;
    return `task-batch\u0000${origin.batchId}\u0000${origin.itemId}`;
  }

  function previewTaskBatchImport(value, tasks = [], options = {}) {
    let validation;
    let sourceKind = "text";
    if (typeof value === "string") {
      const raw = value.trim();
      if (raw.startsWith("{")) {
        try {
          return previewTaskBatchImport(JSON.parse(raw), tasks, options);
        } catch (_) {
          return { valid: false, errors: [{ field: "$", message: "JSON 格式无效" }], items: [], newTasks: [], existingTasks: [], totalMinutes: 0 };
        }
      }
      validation = parseTaskBatchText(value, options);
    } else if (value?.type === "loop-learning-plan") {
      sourceKind = "learning-plan";
      const learning = validateLearningPlan(value);
      validation = learning.valid ? {
        valid: true,
        errors: [],
        batch: { id: learning.plan.id, title: learning.plan.title, targetGroup: learning.plan.targetGroup, tasks: learning.plan.tasks },
      } : learning;
    } else {
      sourceKind = "task-batch";
      validation = validateTaskBatch(value);
    }
    if (!validation.valid) return { ...validation, items: [], newTasks: [], existingTasks: [], totalMinutes: 0 };
    const groupId = identifier(options.groupId);
    const existingTitles = new Set(tasks
      .filter((task) => !groupId || identifier(task?.groupId) === groupId)
      .map((task) => normalizedTitleKey(task?.title))
      .filter(Boolean));
    const existingOrigins = new Set(tasks.map((task) => taskBatchOriginKey(task?.origin)).filter(Boolean));
    const seenTitles = new Set();
    const items = validation.batch.tasks.map((item, index) => {
      const titleKey = normalizedTitleKey(item.title);
      const origin = sourceKind === "learning-plan"
        ? { kind: "learning-plan", planId: validation.batch.id, itemId: item.itemId }
        : { kind: "task-batch", batchId: validation.batch.id, itemId: item.itemId };
      const originKey = taskBatchOriginKey(origin);
      let duplicateReason = "";
      if (existingOrigins.has(originKey)) duplicateReason = "origin";
      else if (existingTitles.has(titleKey)) duplicateReason = "title";
      else if (seenTitles.has(titleKey)) duplicateReason = "input";
      seenTitles.add(titleKey);
      return {
        ...item,
        key: `${sourceKind}:${validation.batch.id}:${item.itemId}:${index}`,
        origin,
        duplicateReason,
      };
    });
    const newTasks = items.filter((item) => !item.duplicateReason);
    const existingTasks = items.filter((item) => item.duplicateReason);
    return {
      valid: true,
      errors: [],
      sourceKind,
      batch: validation.batch,
      items,
      newTasks,
      existingTasks,
      totalMinutes: newTasks.reduce((sum, task) => sum + task.estimateMinutes, 0),
    };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    DEFAULT_SCHEDULE,
    DEFAULT_PHASES,
    defaultWorkNavigation,
    normalizeWorkNavigation,
    normalizeRecovery,
    normalizeOrigin,
    normalizeTime,
    validatePhaseSchedule,
    normalizeSchedule,
    validateSchedule,
    phasesForDate,
    localDateKey,
    minutes,
    resolvePhase,
    nextBoundaryAt,
    resolveWorkCandidates,
    resolveGrowthCandidates,
    reconcileQueueIds,
    resolveActiveTask,
    resolveNextAction,
    previousRecoveryTask,
    validateLearningPlan,
    previewLearningPlanImport,
    learningOriginKey,
    validateTaskBatch,
    parseTaskBatchText,
    previewTaskBatchImport,
    taskBatchOriginKey,
  });
});

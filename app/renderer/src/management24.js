// ============================================================
// Phase 24A · 任务与分组编辑
//
// Ported from the frozen Demo's loop-management-phase24.js + the v4 computed
// style contract in loop-management-phase24.css (loaded byte-identical as
// src/management24.css), gated by body[data-management24-enabled].
//
// The Demo is the interface and interaction specification: this layer produces
// the same markup, class names and geometry, and routes every mutation through
// the product's own commands (state + save() + the real task/group model)
// instead of the Demo's page-memory sample data.
//
// What the Demo deliberately has and this layer keeps:
//   · double-click in-place naming for the task row, the workspace title and the
//     navigation group; outside click saves, Enter saves, Esc reverts, and no
//     trailing save/cancel control or hint text is rendered;
//   · one in-place field skin (transparent, no box, 1px bottom rule, 0 radius)
//     while ordinary property fields keep the Phase22 weak-border 6px skin;
//   · no per-group management button in the navigation — the group menu and the
//     central organizer own every management path;
//   · a 200px group menu with a fixed 14px icon column, 34px rows and correct
//     up/down arrow rotation;
//   · the 360px properties panel with per-task drafts, the 330px move panel,
//     the 390px delete-impact panel and the 510px organizer.
//
// Project facts the Demo does not model are handled here: groups are addressed
// by their stable id (never by title), deleting a group goes through the real
// deleteGroup() and its growth-source handling, and a receipt is only shown
// after the real write succeeded.
// ============================================================

(() => {
  if (!document.body.hasAttribute("data-management24-enabled")) return;

  const MANAGE24_ICON = {
    edit: "edit", folder: "folder", organize: "more", up: "chevron", down: "chevron",
    remove: "close", home: "home", blocked: "blocked", later: "later", note: "note",
  };
  const MANAGE24_PRIORITIES = [["high", "高"], ["medium", "中"], ["low", "低"]];
  const MANAGE24_WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  // ---- state ---------------------------------------------------------------
  // propertyDrafts / titleDrafts are keyed by the stable task id, so A → B → A
  // restores each object's own draft and an explicit cancel or a successful save
  // clears only that object.
  const manage24TitleDrafts = new Map();
  const manage24PropertyDrafts = new Map();
  let manage24TitleSession = null;      // workspace title editor
  let manage24RowTitleSession = null;   // task-list row editor
  let manage24RetainedTaskId = "";      // task that left the source list after a move
  let manage24MoveDraft = null;
  let manage24PropertyDraft = null;
  let manage24OrganizerQuery = "";
  let manage24DeleteDraft = null;
  let manage24Undo = null;
  let manage24LastRowTitle = null;

  // ---- small helpers -------------------------------------------------------
  const manage24Esc = (value) => (typeof esc === "function" ? esc(value) : String(value ?? ""));
  const manage24Attr = (value) => (typeof escAttr === "function" ? escAttr(value) : String(value ?? ""));
  const manage24Node = (selector, scope = document) => scope.querySelector(selector);

  function manage24Icon(name) {
    return shellIcon(MANAGE24_ICON[name] || "circle");
  }

  function manage24Group(groupId) {
    return state.taskGroups.find((group) => group.id === groupId) || null;
  }

  function manage24Task(taskId) {
    return state.tasks.find((task) => task.id === taskId) || null;
  }

  function manage24SortedGroups() {
    return sort(state.taskGroups);
  }

  /** 未分组 is the built-in bucket: selectable, never renamable or deletable. */
  function manage24GroupChoices() {
    return [
      { id: UNGROUPED_TASKS_GROUP_ID, title: "未分组" },
      ...manage24SortedGroups().map((group) => ({ id: group.id, title: group.title })),
    ];
  }

  function manage24GroupTitle(groupId) {
    if (!groupId || groupId === UNGROUPED_TASKS_GROUP_ID) return "未分组";
    return manage24Group(groupId)?.title || "未分组";
  }

  function manage24GrowthSourceId() {
    try {
      return normalizeCurrentWorkNavigation().config.growth.sourceGroupId || "";
    } catch (error) {
      return "";
    }
  }

  function manage24TaskCounts(groupId) {
    const list = groupId === UNGROUPED_TASKS_GROUP_ID
      ? state.tasks.filter((task) => !task.groupId)
      : state.tasks.filter((task) => task.groupId === groupId);
    return {
      tasks: list.filter((task) => !shellTaskIsNote(task) && task.status !== "done").length,
      notes: list.filter(shellTaskIsNote).length,
    };
  }

  function manage24ImpactCounts(groupId) {
    const list = state.tasks.filter((task) => (task.groupId || "") === groupId);
    return {
      tasks: list.filter((task) => !shellTaskIsNote(task)).length,
      notes: list.filter(shellTaskIsNote).length,
      nodes: list.reduce((total, task) => total + flatten(task.nodes || []).length, 0),
    };
  }

  function manage24Focus(selector) {
    if (!selector) return;
    window.requestAnimationFrame(() => manage24Node(selector)?.focus?.({ preventScroll: true }));
  }

  // ---- overlay plumbing ----------------------------------------------------
  function manage24CloseSurface() {
    if (typeof shellCloseOverlay === "function") shellCloseOverlay({ restoreFocus: false });
  }

  /**
   * The Demo's mount(): close whatever is open, place the surface next to the
   * trigger (or at the pointer for a context menu) and keep it inside the
   * viewport. `width` is the panel's own width from the frozen sheet.
   */
  function manage24Mount(markup, { trigger = null, width = 0, point = null, returnFocus = "" } = {}) {
    manage24CloseSurface();
    const host = trigger
      || manage24Node('[data-action="open-task-menu"]')
      || manage24Node('[data-manage24="organize"]')
      || manage24Node('[data-action="add-group"]');
    const rect = host?.getBoundingClientRect?.() || { left: 12, bottom: 48, width: 40 };
    const surface = shellMountSurface(markup, host, width || 320);
    if (!surface) return null;
    if (point) {
      surface.style.left = `${Math.max(12, Math.min(point.x, window.innerWidth - surface.offsetWidth - 12))}px`;
      surface.style.top = `${Math.max(12, Math.min(point.y, window.innerHeight - surface.offsetHeight - 12))}px`;
    } else if (width) {
      surface.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      surface.style.top = `${Math.max(12, Math.min(rect.bottom + 7, window.innerHeight - 48 - surface.offsetHeight))}px`;
    }
    surface.style.maxHeight = `${Math.max(160, window.innerHeight - 24)}px`;
    if (returnFocus) surface.dataset.returnFocus = returnFocus;
    return surface;
  }

  function manage24Receipt(text, action = "", label = "") {
    const undo = manage24Undo;
    const actions = action ? `<button type="button" data-manage24="${manage24Attr(action)}">${manage24Esc(label)}</button>` : "";
    showWorkspaceFeedback(text, actions, { source: "management", onDismiss: () => {
      if (action === "undo-group" && manage24Undo === undo) manage24Undo = null;
    } });
  }

  /**
   * Write through the product's own storage and wait for the real result:
   * `flushSave()` resolves false when the IPC write failed, so a receipt is
   * only ever shown after the data actually reached disk.
   */
  async function manage24Persist() {
    save();
    if (typeof flushSave !== "function") return true;
    const ok = await flushSave();
    return ok !== false;
  }

  // ============================================================
  // 1. Group navigation: heading actions, no per-row management button
  // ============================================================

  renderShellGroupNavigation = function manage24GroupNavigation() {
    const editingId = state.editingGroupId;
    const editingGroup = manage24Group(editingId);
    const editingDraft = manage24TitleDrafts.get(editingId);
    const draft = `
      <div class="nav-group-editor" data-manage24-group-editor="${manage24Attr(editingId || "new")}">
        <input id="group-title" aria-label="${editingGroup ? "重命名分组" : "新建分组名称"}" maxlength="24" value="${manage24Attr(editingDraft !== undefined ? editingDraft : editingGroup?.title || "")}" />
      </div>
      ${state.groupError ? `<p class="group-error" id="manage24-group-error" role="status">${manage24Esc(state.groupError)}</p>` : ""}`;
    const rows = manage24SortedGroups().map((group) => {
      if (editingId === group.id) return draft;
      const active = shellRoute() === "tasks" && state.activeGroupId === group.id;
      return `
        <div class="group-nav-row">
          <button class="nav-button ${active ? "active" : ""}" type="button" data-action="select-nav-group" data-group-id="${manage24Attr(group.id)}" title="${manage24Attr(group.title)}" aria-label="分组：${manage24Attr(group.title)}" aria-haspopup="menu" aria-current="${active ? "page" : "false"}">
            ${state.navCollapsed ? shellIcon("folder") : '<i class="group-mark"></i>'}<span>${manage24Esc(group.title)}</span><span class="count">${shellGroupOpenCount(group.id)}</span>
          </button>
        </div>`;
    }).join("");
    const ungroupedActive = shellRoute() === "tasks" && state.activeGroupId === UNGROUPED_TASKS_GROUP_ID;
    const ungrouped = `
      <div class="group-nav-row">
        <button class="nav-button ${ungroupedActive ? "active" : ""}" type="button" data-action="select-nav-group" data-group-id="${manage24Attr(UNGROUPED_TASKS_GROUP_ID)}" title="未分组" aria-label="未分组" aria-current="${ungroupedActive ? "page" : "false"}">
          ${state.navCollapsed ? shellIcon("folder") : '<i class="group-mark"></i>'}<span>未分组</span><span class="count">${shellGroupOpenCount(UNGROUPED_TASKS_GROUP_ID)}</span>
        </button>
      </div>`;
    return `
      <div class="nav-groups">
        <div class="nav-section-heading">
          <span>任务分组</span>
          <span class="manage24-heading-actions"><button class="icon-button" type="button" data-manage24="organize" aria-label="整理分组" title="整理分组">${manage24Icon("organize")}</button><button class="icon-button" type="button" data-action="add-group" aria-label="新建分组" title="新建分组">${shellIcon("plus")}</button></span>
        </div>
        ${rows}
        ${editingId && !editingGroup ? draft : ""}
        ${ungrouped}
      </div>`;
  };

  // ============================================================
  // 2. In-place naming
  // ============================================================

  /** The Demo's `.manage24-row-title` editor: 26px, transparent, 1px bottom rule. */
  function manage24RowEditorMarkup() {
    return `<div class="manage24-row-title"><input id="manage24-row-title" class="manage24-row-title-input" maxlength="160" aria-label="任务名称" aria-describedby="manage24-row-error" value="${manage24Attr(manage24RowTitleSession.value)}"><span class="manage24-inline-error" id="manage24-row-error" role="status">${manage24Esc(manage24RowTitleSession.error || "")}</span></div>`;
  }

  const manage24BaseTaskRow = renderShellTaskRow;

  /** The real row, with the list position and the pressed state it currently has. */
  function manage24RowMarkup(task) {
    const list = filteredTasks();
    const index = list.findIndex((item) => item.id === task.id);
    return manage24BaseTaskRow(task, index >= 0 ? index + 1 : 1);
  }

  renderShellTaskRow = function manage24TaskRow(task, displayOrder) {
    const markup = manage24BaseTaskRow(task, displayOrder);
    if (manage24RowTitleSession?.id === task.id) {
      // Keep the sequence/complete control and its geometry while naming.
      return markup.replace(/<button class="task-select"[\s\S]*?<\/button>/, () => manage24RowEditorMarkup());
    }
    return markup;
  };

  function manage24DrawRowTitle() {
    if (!manage24RowTitleSession) return;
    if (!manage24Task(manage24RowTitleSession.id)) { manage24RowTitleSession = null; return; }
    let input = document.getElementById("manage24-row-title");
    if (!input) {
      const row = document.querySelector(`.task-select[data-task-id="${escSelectorValue(manage24RowTitleSession.id)}"]`);
      if (!row) return;
      row.outerHTML = manage24RowEditorMarkup();
      input = document.getElementById("manage24-row-title");
    }
    // render() may have already mounted the editor. Focus that live input,
    // without selecting it again when this helper runs twice in one action.
    if (input && document.activeElement !== input) {
      input.focus({ preventScroll: true });
      input.select();
    }
  }

  function manage24BeginRowTitle(taskId) {
    const task = manage24Task(taskId);
    if (!task) return;
    manage24CloseSurface();
    state.taskMenuOpen = false;
    state.contextMenu = null;
    if (manage24TitleSession && manage24EndTitle({ cancel: false, restore: false }) === false) return;
    manage24RowTitleSession = { id: task.id, value: task.title, error: "" };
    state.activeTaskId = task.id;
    render();
    manage24DrawRowTitle();
  }

  /**
   * Save, or restore the field on an invalid (empty) value. `fromBlur` repaints
   * only the edited row so the click that caused the blur is not consumed.
   */
  async function manage24EndRowTitle({ cancel = false, fromBlur = false } = {}) {
    if (!manage24RowTitleSession) return true;
    const session = manage24RowTitleSession;
    const task = manage24Task(session.id);
    const value = String(session.value || "").trim();
    if (!cancel && !value) {
      session.error = "请输入任务名称";
      const error = document.getElementById("manage24-row-error");
      if (error) error.textContent = session.error;
      document.getElementById("manage24-row-title")?.setAttribute("aria-invalid", "true");
      return false;
    }
    manage24RowTitleSession = null;
    const changed = !cancel && task && task.title !== value;
    if (changed) {
      task.title = value;
      task.updatedAt = now();
      if (!(await manage24Persist())) {
        manage24RowTitleSession = session;
        return false;
      }
    }
    if (fromBlur && task) {
      // Restore the title button while retaining the row's current state.
      const editor = document.querySelector(".manage24-row-title");
      const row = editor?.closest(".task-item[data-task-id]");
      if (row) row.outerHTML = manage24RowMarkup(task);
      if (state.activeTaskId === task.id) manage24RepaintTitleHeading(task);
      return true;
    }
    render();
    manage24Focus(`.task-select[data-task-id="${escSelectorValue(session.id)}"]`);
    return true;
  }

  // ---- workspace title -----------------------------------------------------

  function manage24TitleHeading(task) {
    return `<h1 class="task-title"><button class="title-edit" type="button" data-action="edit-task-title" aria-label="编辑${shellTaskIsNote(task) ? "速记" : "任务"}标题" title="${escAttr(task.title)}"><span>${manage24Esc(task.title)}</span>${shellIcon("edit")}</button></h1>`;
  }

  function manage24RepaintTitleHeading(task) {
    const heading = document.querySelector(".topbar .task-title");
    if (heading) heading.outerHTML = manage24TitleHeading(task);
  }

  function manage24ResizeTitle() {
    const el = document.getElementById("manage24-title");
    if (!el) return;
    if (el.tagName === "INPUT") return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function manage24TitleEditorMarkup(task) {
    return `<h1 class="task-title"${manage24TitleSession.width ? ` style="width:${manage24TitleSession.width}px"` : ""}><input id="manage24-title" class="manage24-title-input" type="text" maxlength="160" aria-label="${shellTaskIsNote(task) ? "速记" : "任务"}标题" aria-describedby="manage24-title-error" value="${escAttr(manage24TitleSession.value)}" /><p id="manage24-title-error" class="manage24-inline-error" role="status">${manage24Esc(manage24TitleSession.error || "")}</p></h1>`;
  }

  function manage24BeginTitle(task = shellActiveTask()) {
    if (!task) return;
    manage24CloseSurface();
    state.taskMenuOpen = false;
    if (state.contextMenu) {
      state.contextMenu = null;
      if (typeof syncContextMenuRoot === "function") syncContextMenuRoot();
    }
    const draft = manage24TitleDrafts.get(task.id);
    const heading = document.querySelector(".topbar .task-title");
    manage24TitleSession = { id: task.id, value: draft !== undefined ? draft : task.title, before: task.title, error: "", width: heading?.getBoundingClientRect().width };
    if (heading) heading.outerHTML = manage24TitleEditorMarkup(task);
    const input = document.getElementById("manage24-title");
    input?.focus({ preventScroll: true });
    input?.select();
    manage24ResizeTitle();
  }

  async function manage24EndTitle({ cancel = false, fromBlur = false } = {}) {
    if (!manage24TitleSession) return true;
    const session = manage24TitleSession;
    const task = manage24Task(session.id);
    const value = String(session.value || "").trim();
    if (!cancel && !value) {
      session.error = "请输入任务名称";
      manage24TitleDrafts.set(session.id, session.value);
      const error = document.getElementById("manage24-title-error");
      if (error) error.textContent = session.error;
      document.getElementById("manage24-title")?.setAttribute("aria-invalid", "true");
      return false;
    }
    manage24TitleSession = null;
    manage24TitleDrafts.delete(session.id);
    const changed = !cancel && task && value !== session.before;
    if (changed) {
      task.title = value;
      task.updatedAt = now();
      if (!(await manage24Persist())) {
        manage24TitleSession = session;
        return false;
      }
    }
    if (fromBlur && task) {
      if (changed) {
        const label = document.querySelector(`.task-select[data-task-id="${escSelectorValue(task.id)}"] .task-item-title`);
        if (label) label.textContent = task.title;
        document.querySelector(`.task-select[data-task-id="${escSelectorValue(task.id)}"]`)?.setAttribute("title", task.title);
      }
      // The heading was swapped for the editor while the session was open; put
      // the real control back without a full render (a render here would consume
      // the click that caused this blur).
      manage24RepaintTitleHeading(task);
    } else if (changed) {
      render();
    } else if (task) {
      manage24RepaintTitleHeading(task);
    }
    if (changed) manage24Receipt("标题已修改");
    return true;
  }

  const manage24BaseTaskTitle = renderShellTaskTitle;
  renderShellTaskTitle = function manage24TaskTitle(task) {
    if (manage24TitleSession?.id === task.id) return manage24TitleEditorMarkup(task);
    return manage24BaseTaskTitle(task);
  };

  // ---- navigation group ----------------------------------------------------

  function manage24StartGroupEdit(groupId) {
    if (!manage24Group(groupId)) return;
    // A collapsed rail must not squeeze the existing inline name editor.
    if (state.navCollapsed) {
      state.navCollapsed = false;
      try { localStorage.setItem(NAV_COLLAPSED_KEY, "0"); } catch {}
    }
    state.editingGroupId = groupId;
    state.focusGroupTitleId = "";
    manage24CloseSurface();
    render();
    const input = manage24GroupEditorInput();
    input?.focus({ preventScroll: true });
    input?.select();
  }

  async function manage24RenameGroup(groupId, title) {
    const group = manage24Group(groupId);
    if (!group || !title) return false;
    const before = group.title;
    group.title = title;
    if (!(await manage24Persist())) {
      group.title = before;
      render();
      return false;
    }
    render();
    manage24Focus(`[data-group-id="${escSelectorValue(groupId)}"]`);
    manage24Receipt("分组名称已修改");
    return true;
  }

  /** The navigation editor's own field (it does not carry data-group-title: that
   *  attribute is what app.js binds to its live-commit rename). */
  function manage24GroupEditorInput() {
    return document.getElementById("group-title");
  }

  async function manage24FinishGroupEdit(groupId, { cancel = false } = {}) {
    if (state.editingGroupId !== groupId) return true;
    const input = manage24GroupEditorInput();
    const group = manage24Group(groupId);
    // Prefer the session draft: the app's own blur binding re-renders the field,
    // so the live DOM can already be a fresh, empty input by the time this runs.
    const typed = String(manage24TitleDrafts.get(groupId) ?? "").trim();
    const live = String(input?.value ?? "").trim();
    const value = (!cancel && !live && typed) ? typed : (live || typed);
    if (cancel) {
      manage24TitleDrafts.delete(groupId);
      state.editingGroupId = "";
      state.groupError = "";
      render();
      manage24Focus(group ? `[data-group-id="${escSelectorValue(groupId)}"]` : '[data-action="add-group"]');
      return true;
    }
    if (!value) {
      // An empty new-group draft is discarded without creating a group.
      manage24TitleDrafts.set(groupId, "");
      if (!group) {
        manage24TitleDrafts.delete(groupId);
        state.editingGroupId = "";
        state.groupError = "";
        render();
        manage24Focus('[data-action="add-group"]');
        return false;
      }
      // An existing group can never be left nameless: keep the real title and
      // keep the editor open with the reason.
      state.groupError = "请输入分组名称";
      render();
      const next = manage24GroupEditorInput();
      next?.setAttribute("aria-invalid", "true");
      next?.focus({ preventScroll: true });
      return false;
    }
    manage24TitleDrafts.delete(groupId);
    state.editingGroupId = "";
    state.groupError = "";
    render();
    if (!group || group.title === value) {
      manage24Focus(group ? `[data-group-id="${escSelectorValue(groupId)}"]` : '[data-action="add-group"]');
      return true;
    }
    return await manage24RenameGroup(groupId, value);
  }

  // ============================================================
  // 3. Group context menu (200px)
  // ============================================================

  function manage24GroupMenuMarkup(groupId) {
    const groups = manage24SortedGroups();
    const index = groups.findIndex((group) => group.id === groupId);
    if (index < 0) return "";
    return `<section class="surface-popover manage24-group-menu" role="menu" aria-label="分组操作">
      <button type="button" role="menuitem" data-manage24="group-rename" data-group-id="${manage24Attr(groupId)}">${manage24Icon("edit")}重命名</button>
      <button type="button" role="menuitem" data-manage24="organize" data-group-id="${manage24Attr(groupId)}">${manage24Icon("folder")}整理分组</button>
      <div class="menu-divider"></div>
      <button type="button" role="menuitem" data-manage24="group-up" data-group-id="${manage24Attr(groupId)}" ${index <= 0 ? "disabled" : ""}>${manage24Icon("up")}上移</button>
      <button type="button" role="menuitem" data-manage24="group-down" data-group-id="${manage24Attr(groupId)}" ${index === groups.length - 1 ? "disabled" : ""}>${manage24Icon("down")}下移</button>
      <div class="menu-divider"></div>
      <button type="button" role="menuitem" class="danger-action" data-manage24="group-delete" data-group-id="${manage24Attr(groupId)}">${manage24Icon("remove")}删除分组…</button>
    </section>`;
  }

  function manage24ShowGroupMenu(groupId, trigger, point = null) {
    if (!manage24Group(groupId)) return;
    const surface = manage24Mount(manage24GroupMenuMarkup(groupId), {
      trigger, width: 200, point, returnFocus: `[data-group-id="${escSelectorValue(groupId)}"]`,
    });
    surface?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  }

  /** Boundary-safe reorder of the real ordered group list. */
  async function manage24MoveGroup(groupId, delta, { reopen = false } = {}) {
    const groups = manage24SortedGroups();
    const index = groups.findIndex((group) => group.id === groupId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= groups.length) return false;
    const [moved] = groups.splice(index, 1);
    groups.splice(target, 0, moved);
    groups.forEach((group, order) => { group.order = order + 1; });
    state.taskGroups = groups;
    if (!(await manage24Persist())) return false;
    render();
    if (reopen) {
      // Re-mount in place: the panel keeps its own trigger and scroll position.
      const organizer = document.querySelector(".manage24-organizer");
      manage24Organize(organizer?.querySelector(".dialog-head") ? manage24Node('[data-manage24="organize"]') : null, groupId);
    } else {
      manage24Focus(`[data-group-id="${escSelectorValue(groupId)}"]`);
    }
    return true;
  }

  // ============================================================
  // 4. Central organizer (510px)
  // ============================================================

  function manage24OrganizerRowMarkup(group, index, total) {
    const counts = manage24TaskCounts(group.id);
    const growth = manage24GrowthSourceId() === group.id;
    return `<div class="manage24-organizer-row">${shellIcon("folder")}<div class="manage24-group-copy"><button type="button" data-manage24="group-open" data-group-id="${manage24Attr(group.id)}" title="${manage24Attr(group.title)}">${manage24Esc(group.title)}</button><small>${counts.tasks} 个未完成任务 · ${counts.notes} 条速记${growth ? ' · <span class="manage24-source">成长来源</span>' : ""}</small></div><div class="manage24-row-actions"><button class="icon-button manage24-up" type="button" data-manage24="group-up" data-group-id="${manage24Attr(group.id)}" aria-label="上移${manage24Attr(group.title)}" ${index === 0 ? "disabled" : ""}>${manage24Icon("up")}</button><button class="icon-button manage24-down" type="button" data-manage24="group-down" data-group-id="${manage24Attr(group.id)}" aria-label="下移${manage24Attr(group.title)}" ${index === total - 1 ? "disabled" : ""}>${manage24Icon("down")}</button><button class="icon-button" type="button" data-manage24="group-rename" data-group-id="${manage24Attr(group.id)}" aria-label="重命名${manage24Attr(group.title)}">${manage24Icon("edit")}</button><button class="icon-button" type="button" data-manage24="group-delete" data-group-id="${manage24Attr(group.id)}" aria-label="删除${manage24Attr(group.title)}">${manage24Icon("remove")}</button></div></div>`;
  }

  function manage24DrawOrganizer() {
    const list = manage24Node(".manage24-group-list");
    if (!list) return;
    const groups = manage24SortedGroups();
    const query = manage24OrganizerQuery.trim().toLowerCase();
    const visible = groups.filter((group) => !query || group.title.toLowerCase().includes(query));
    list.innerHTML = visible.length
      ? visible.map((group) => manage24OrganizerRowMarkup(group, groups.indexOf(group), groups.length)).join("")
      : '<p class="manage24-no-results">没有匹配的分组</p>';
  }

  function manage24OrganizerMarkup() {
    return `<section class="surface-popover manage24-panel manage24-organizer" role="dialog" aria-modal="true" aria-label="整理分组">${shellSurfaceHeader("整理分组")}<input id="manage24-organizer-search" class="manage24-search" aria-label="搜索分组" placeholder="搜索分组" value="${manage24Attr(manage24OrganizerQuery)}"><div class="manage24-group-list"></div><p class="schedule-hint">调整导航中的分组顺序，不改变任务顺序。</p><footer><button type="button" class="button" data-manage24="new-from-organizer">新建分组</button><button type="button" class="button primary" data-action="close-dialog">完成</button></footer></section>`;
  }

  function manage24Organize(trigger, focusGroupId = "") {
    manage24Mount(manage24OrganizerMarkup(), {
      trigger: trigger || manage24Node('[data-manage24="organize"]'), width: 510, returnFocus: '[data-manage24="organize"]',
    });
    manage24DrawOrganizer();
    if (focusGroupId) manage24Node(`[data-manage24="group-open"][data-group-id="${escSelectorValue(focusGroupId)}"]`)?.focus({ preventScroll: true });
    else manage24Node("#manage24-organizer-search")?.focus({ preventScroll: true });
  }

  // ============================================================
  // 5. Task menu
  // ============================================================

  renderShellTaskMenu = function manage24TaskMenu(task) {
    const tags = normalizeTaskTags(task.tags);
    return `<div class="popover" data-task-menu role="menu" aria-label="任务操作">
      <button type="button" role="menuitem" data-recovery26="open">${manage24Icon("folder")}最近删除</button>
      <div class="menu-divider"></div>
      <button type="button" role="menuitem" data-manage24="properties" data-task-id="${manage24Attr(task.id)}">${manage24Icon("edit")}编辑属性</button>
      <button type="button" role="menuitem" data-action="toggle-task-group-select" data-task-id="${manage24Attr(task.id)}">${manage24Icon("folder")}移动到分组…</button>
      <div class="menu-divider"></div>
      <button type="button" role="menuitem" data-action="toggle-task-tag" data-tag="today" data-task-id="${manage24Attr(task.id)}">${manage24Icon("home")}${tags.today ? "取消手动加入今日" : "加入今日"}</button>
      <button type="button" role="menuitemcheckbox" aria-checked="${Boolean(tags.blocked)}" data-action="toggle-task-tag" data-tag="blocked" data-task-id="${manage24Attr(task.id)}">${manage24Icon("blocked")}${tags.blocked ? "取消卡住" : "标记卡住"}</button>
      <button type="button" role="menuitemcheckbox" aria-checked="${Boolean(tags.later)}" data-action="toggle-task-tag" data-tag="later" data-task-id="${manage24Attr(task.id)}">${manage24Icon("later")}${tags.later ? "取消稍后" : "标记稍后"}</button>
      <div class="menu-divider"></div>
      <button type="button" role="menuitem" data-action="share-task" data-task-id="${manage24Attr(task.id)}">${manage24Icon("note")}分享／导出任务…</button>
      <button type="button" role="menuitem" data-action="copy-task-summary" data-task-id="${manage24Attr(task.id)}">${manage24Icon("note")}复制任务摘要</button>
      <button class="danger-action" type="button" role="menuitem" data-action="delete-task" data-task-id="${manage24Attr(task.id)}">${manage24Icon("remove")}删除任务…</button>
    </div>`;
  };

  // ============================================================
  // 6. Properties panel (360px) with per-task drafts
  // ============================================================

  function manage24PropertyDraftFor(task) {
    const deadline = safeDate(task.deadlineAt);
    const recurrence = normalizeTaskRecurrence(task.recurrence);
    const tags = normalizeTaskTags(task.tags);
    return {
      id: task.id,
      title: task.title,
      groupId: task.groupId || UNGROUPED_TASKS_GROUP_ID,
      priority: normalizePriority(task.priority),
      today: Boolean(tags.today),
      blocked: Boolean(tags.blocked),
      later: Boolean(tags.later),
      estimate: task.estimateMinutes ? String(task.estimateMinutes) : "",
      date: deadline ? localDateKey(deadline) : "",
      time: deadline ? shellTimeLabel(deadline) : "18:00",
      reminder: task.deadlineReminderMinutes === null || task.deadlineReminderMinutes === undefined ? "none" : String(task.deadlineReminderMinutes),
      cycle: recurrence.frequency,
      cycleTime: recurrence.time || "09:00",
      weekdays: [...recurrence.weekdays],
      expanded: false,
    };
  }

  function manage24Option(value, label, current) {
    return `<option value="${manage24Attr(value)}" ${String(value) === String(current) ? "selected" : ""}>${manage24Esc(label)}</option>`;
  }

  function manage24CapturePanel() {
    const form = manage24Node("#manage24-property-form");
    if (!form || !manage24PropertyDraft) return;
    const data = new FormData(form);
    const draft = manage24PropertyDraft;
    draft.title = String(data.get("title") ?? draft.title);
    draft.groupId = String(data.get("groupId") ?? draft.groupId);
    draft.estimate = String(data.get("estimate") ?? "");
    draft.date = String(data.get("date") ?? "");
    draft.time = String(data.get("time") ?? "18:00");
    draft.reminder = String(data.get("reminder") ?? "none");
    draft.cycle = String(data.get("cycle") ?? "none");
    draft.cycleTime = String(data.get("cycleTime") ?? "09:00");
    draft.weekdays = data.getAll("weekday").map(Number);
    draft.today = data.has("today");
    draft.blocked = data.has("blocked");
    draft.later = data.has("later");
  }

  function manage24PropertyMarkup(draft, task) {
    const quick = shellTaskIsNote(task);
    const choices = manage24GroupChoices();
    const known = choices.some((choice) => choice.id === draft.groupId);
    return `<form class="surface-popover manage24-panel" id="manage24-property-form" role="dialog" aria-modal="true" aria-label="编辑${quick ? "速记" : "任务"}属性" novalidate>
      ${shellSurfaceHeader(quick ? "速记属性" : "任务属性")}
      <div class="manage24-body">
        <div class="manage24-fields">
          <div class="manage24-full"><label for="manage24-property-title">标题</label><input id="manage24-property-title" name="title" maxlength="160" value="${manage24Attr(draft.title)}" aria-describedby="manage24-property-error"></div>
          <div class="manage24-full"><label for="manage24-property-group">分组</label><select id="manage24-property-group" name="groupId">${known ? "" : manage24Option(draft.groupId, "分组已不存在", draft.groupId)}${choices.map((choice) => manage24Option(choice.id, choice.title, draft.groupId)).join("")}</select></div>
          ${quick ? "" : `<div class="manage24-full"><label id="manage24-priority-label">优先级</label><div class="manage24-choices" role="group" aria-labelledby="manage24-priority-label">${MANAGE24_PRIORITIES.map(([value, label]) => `<button type="button" class="manage24-choice" data-manage24-priority="${value}" aria-pressed="${draft.priority === value}">${label}</button>`).join("")}</div></div>`}
        </div>
        ${quick ? "" : `<div class="manage24-tags"><label><input type="checkbox" name="today" ${draft.today ? "checked" : ""}>手动加入今日</label><label><input type="checkbox" name="blocked" ${draft.blocked ? "checked" : ""}>卡住</label><label><input type="checkbox" name="later" ${draft.later ? "checked" : ""}>稍后</label></div>
        <button type="button" class="manage24-disclosure" data-manage24="time" aria-expanded="${draft.expanded}" aria-controls="manage24-time">${shellIcon("chevron")}时间与安排<small>${draft.date ? manage24Esc(shellDisplayDate(draft.date)) : "按需设置"}</small></button>
        <div class="manage24-time" id="manage24-time" ${draft.expanded ? "" : "hidden"}>
          <div class="manage24-fields">
            <div><label for="manage24-date">截止日期</label><input id="manage24-date" name="date" type="date" value="${manage24Attr(draft.date)}"></div>
            <div><label for="manage24-time-input">截止时间</label><input id="manage24-time-input" name="time" type="time" value="${manage24Attr(draft.time)}"></div>
            <div class="manage24-full"><label for="manage24-reminder">提醒</label><select id="manage24-reminder" name="reminder">${Object.entries(deadlineReminderLabels).map(([value, label]) => manage24Option(value, label, draft.reminder)).join("")}</select></div>
            <div><label for="manage24-cycle">循环</label><select id="manage24-cycle" name="cycle">${[["none", "不循环"], ["daily", "每天"], ["weekly", "每周"]].map(([value, label]) => manage24Option(value, label, draft.cycle)).join("")}</select></div>
            <div><label for="manage24-cycle-time">进入今日的时间</label><input id="manage24-cycle-time" name="cycleTime" type="time" value="${manage24Attr(draft.cycleTime)}"></div>
            <div class="manage24-full" id="manage24-weekdays" ${draft.cycle === "weekly" ? "" : "hidden"}><label>重复日期</label><div class="manage24-tags">${MANAGE24_WEEKDAY_ORDER.map((day) => `<label><input type="checkbox" name="weekday" value="${day}" ${draft.weekdays.includes(day) ? "checked" : ""}>${SHELL_WEEKDAY_NAMES[day].slice(1)}</label>`).join("")}</div></div>
            <div class="manage24-full"><label for="manage24-estimate">预计时长 · 可选</label><input type="number" id="manage24-estimate" name="estimate" min="1" max="720" value="${manage24Attr(draft.estimate)}" placeholder="分钟"></div>
          </div>
          <p class="schedule-hint">截止与循环可能使任务自动出现在今日；移动分组不会改变安排。</p>
        </div>`}
        <p class="manage24-error" id="manage24-property-error" role="status"></p>
      </div>
      <footer><button type="button" class="button" data-manage24="cancel-properties">取消</button><button type="submit" class="button primary">保存修改</button></footer>
    </form>`;
  }

  function manage24ShowProperties(trigger, task = shellActiveTask()) {
    if (!task) return;
    state.taskMenuOpen = false;
    state.contextMenu = null;
    manage24CapturePanel();
    if (manage24PropertyDraft?.id !== task.id) {
      manage24PropertyDraft = manage24PropertyDrafts.get(task.id) || manage24PropertyDraftFor(task);
    }
    manage24PropertyDrafts.set(task.id, manage24PropertyDraft);
    render();
    manage24Mount(manage24PropertyMarkup(manage24PropertyDraft, task), {
      trigger: trigger || manage24Node('[data-action="open-task-menu"]'), width: 360,
      returnFocus: '[data-action="open-task-menu"]',
    });
    manage24Node("#manage24-property-title")?.focus({ preventScroll: true });
  }

  async function manage24SaveProperties() {
    manage24CapturePanel();
    const draft = manage24PropertyDraft;
    if (!draft) return;
    const task = manage24Task(draft.id);
    if (!task) return;
    const choices = manage24GroupChoices();
    const estimate = String(draft.estimate || "").trim();
    let error = "";
    if (!String(draft.title || "").trim()) error = "请输入标题后再保存";
    else if (!choices.some((choice) => choice.id === draft.groupId)) error = "目标分组已不存在，请重新选择";
    else if (draft.cycle === "weekly" && !draft.weekdays.length) error = "每周循环至少选择一天";
    else if ((draft.date && !draft.time) || (draft.cycle !== "none" && !draft.cycleTime)) error = "请补全截止或循环的时间";
    else if (estimate && (!/^\d+$/.test(estimate) || Number(estimate) < 1 || Number(estimate) > 720)) error = "请检查预计时长（1–720 分钟）";
    if (error) {
      const host = manage24Node("#manage24-property-error");
      if (host) host.textContent = error;
      return;
    }
    const previousGroupId = task.groupId || UNGROUPED_TASKS_GROUP_ID;
    const targetGroupId = draft.groupId === UNGROUPED_TASKS_GROUP_ID ? "" : draft.groupId;
    task.title = String(draft.title).trim();
    task.groupId = targetGroupId;
    if (!shellTaskIsNote(task)) {
      task.priority = draft.priority;
      task.tags = { ...normalizeTaskTags(task.tags), today: draft.today, blocked: draft.blocked, later: draft.later };
      task.deadlineAt = draft.date ? `${draft.date}T${draft.time || "18:00"}:00` : "";
      task.deadlineReminderMinutes = draft.date && draft.reminder !== "none" ? Number(draft.reminder) : null;
      task.estimateMinutes = Number(estimate) || 0;
      task.recurrence = normalizeTaskRecurrence({
        ...task.recurrence,
        frequency: draft.cycle,
        time: draft.cycle !== "none" ? draft.cycleTime : "",
        weekdays: draft.weekdays,
        lastCompletedOccurrence: draft.cycle === "none" ? "" : task.recurrence?.lastCompletedOccurrence || "",
      });
    }
    task.updatedAt = now();
    if (!(await manage24Persist())) return;
    manage24CloseSurface();
    manage24PropertyDrafts.delete(task.id);
    manage24PropertyDraft = null;
    if (previousGroupId !== (task.groupId || UNGROUPED_TASKS_GROUP_ID)) manage24AfterMove(task);
    else {
      render();
      manage24Receipt("属性已修改");
    }
  }

  // ============================================================
  // 7. Move panel (330px) — keeps the source list and its context
  // ============================================================

  function manage24DestinationMarkup() {
    const draft = manage24MoveDraft;
    const query = draft.query.trim().toLowerCase();
    const list = manage24GroupChoices().filter((choice) => !query || choice.title.toLowerCase().includes(query));
    if (!list.length) return '<p class="manage24-no-results">没有匹配的分组</p>';
    return list.map((choice) => {
      const counts = manage24TaskCounts(choice.id);
      const checked = choice.id === draft.groupId;
      return `<button type="button" class="manage24-destination" role="radio" aria-checked="${checked}" data-manage24-target="${manage24Attr(choice.id)}">${shellIcon("folder")}<span>${manage24Esc(choice.title)}</span><small>${counts.tasks}</small>${checked ? shellIcon("check") : ""}</button>`;
    }).join("");
  }

  function manage24DrawDestinations() {
    const host = manage24Node(".manage24-destinations");
    if (host) host.innerHTML = manage24DestinationMarkup();
  }

  function manage24ShowMove(trigger, task = shellActiveTask()) {
    if (!task) return;
    const returnFocus = trigger?.matches?.(".shell-group-context")
      ? ".shell-group-context" : '[data-action="open-task-menu"]';
    state.taskMenuOpen = false;
    state.contextMenu = null;
    if (manage24MoveDraft?.id !== task.id) {
      manage24MoveDraft = { id: task.id, groupId: task.groupId || UNGROUPED_TASKS_GROUP_ID, query: "" };
    }
    render();
    manage24Mount(
      `<form class="surface-popover manage24-panel" id="manage24-move-form" role="dialog" aria-modal="true" aria-label="移动到分组">${shellSurfaceHeader("移动到分组")}<p class="manage24-move-note">${manage24Esc(task.title)}</p><input class="manage24-search" id="manage24-move-search" aria-label="搜索目标分组" placeholder="搜索分组" value="${manage24Attr(manage24MoveDraft.query)}"><div class="manage24-destinations" role="radiogroup" aria-label="目标分组"></div><p class="schedule-hint">只改变归属，今日安排与处理记录保持。</p><p class="manage24-error" role="status" id="manage24-move-error"></p><footer><button type="button" class="button" data-manage24="cancel-move">取消</button><button type="submit" class="button primary">移动</button></footer></form>`,
      { trigger: manage24Node(returnFocus) || trigger, width: 330, returnFocus },
    );
    manage24DrawDestinations();
    manage24Node("#manage24-move-search")?.focus({ preventScroll: true });
  }

  async function manage24SubmitMove() {
    const draft = manage24MoveDraft;
    if (!draft) return;
    const task = manage24Task(draft.id);
    if (!task) return;
    if (!manage24GroupChoices().some((choice) => choice.id === draft.groupId)) {
      const error = manage24Node("#manage24-move-error");
      if (error) error.textContent = "目标分组已不存在，请重新选择";
      return;
    }
    const targetGroupId = draft.groupId === UNGROUPED_TASKS_GROUP_ID ? "" : draft.groupId;
    const changed = (task.groupId || "") !== targetGroupId;
    if (changed) {
      task.groupId = targetGroupId;
      task.updatedAt = now();
      if (!(await manage24Persist())) return;
    }
    manage24CloseSurface();
    manage24MoveDraft = null;
    if (changed) manage24AfterMove(task);
    else manage24Receipt("任务已在此分组");
  }

  /** Keep the source list and filter; offer the target and the return entry. */
  function manage24AfterMove(task) {
    manage24RetainedTaskId = task.id;
    state.taskMenuOpen = false;
    render();
    manage24Receipt(`已移至「${manage24GroupTitle(task.groupId)}」，今日安排保留`, "view-moved", "查看");
  }

  // ============================================================
  // 8. Delete impact (390px) and its real undo
  // ============================================================

  function manage24DeleteMarkup(draft) {
    const group = manage24Group(draft.groupId);
    if (!group) return "";
    const impact = manage24ImpactCounts(draft.groupId);
    const dependent = manage24GrowthSourceId() === draft.groupId;
    const choices = manage24GroupChoices().filter((choice) => choice.id !== draft.groupId);
    return `<form class="surface-popover manage24-panel" id="manage24-delete-group" role="dialog" aria-modal="true" aria-label="删除分组">${shellSurfaceHeader("删除分组")}
      <div class="manage24-body">
        <p class="manage24-impact"><strong>${manage24Esc(group.title)}</strong><br>${impact.tasks} 个任务 · ${impact.notes} 条速记</p>
        <div class="manage24-keep-target" ${draft.remove ? "hidden" : ""}>
          <label for="manage24-keep-target">保留内容并移至</label>
          <select id="manage24-keep-target" name="keepTarget">${choices.map((choice) => manage24Option(choice.id, choice.title, draft.target)).join("")}</select>
          <p class="schedule-hint">今日安排、处理流与知识笔记保持。</p>
        </div>
        <div class="manage24-danger-choice">
          <label class="manage24-check"><input type="checkbox" id="manage24-remove-all" ${draft.remove ? "checked" : ""}>同时删除其中的内容</label>
          ${draft.remove ? `<p class="manage24-danger-details">将删除 ${impact.nodes} 个处理节点及相关记录、任务简报与笔记关联。外部 Markdown 和附件文件保留。</p><label class="manage24-check"><input type="checkbox" id="manage24-delete-confirm" ${draft.confirmed ? "checked" : ""}>我已了解以上影响</label>` : ""}
        </div>
        ${dependent ? `<div class="manage24-dependency"><p>此分组是成长任务的来源，请明确处理来源设置。</p><label for="manage24-growth-next">成长来源</label><select id="manage24-growth-next" name="growthNext"><option value="">请选择</option><option value="stop" ${draft.replacement === "stop" ? "selected" : ""}>停用当前来源</option>${manage24SortedGroups().filter((item) => item.id !== draft.groupId).map((item) => manage24Option(item.id, item.title, draft.replacement)).join("")}</select></div>` : ""}
        <p id="manage24-delete-error" class="manage24-error" role="status"></p>
      </div>
      <footer><button type="button" class="button" data-manage24="cancel-delete">取消</button><button type="submit" class="button ${draft.remove ? "danger-action" : "primary"}">${draft.remove ? "删除分组与内容" : "删除分组，保留内容"}</button></footer>
    </form>`;
  }

  function manage24ShowDeleteGroup(groupId, trigger) {
    if (!manage24Group(groupId)) return;
    state.contextMenu = null;
    if (manage24DeleteDraft?.groupId !== groupId) {
      manage24DeleteDraft = { groupId, target: UNGROUPED_TASKS_GROUP_ID, remove: false, replacement: "", confirmed: false };
    }
    manage24Mount(manage24DeleteMarkup(manage24DeleteDraft), {
      trigger: trigger || manage24Node(`[data-group-id="${escSelectorValue(groupId)}"]`), width: 390,
      returnFocus: `[data-group-id="${escSelectorValue(groupId)}"]`,
    });
  }

  function manage24ApplyGrowthSource(sourceGroupId) {
    try {
      const navigation = normalizeCurrentWorkNavigation();
      navigation.config.growth.sourceGroupId = sourceGroupId || "";
      if (!sourceGroupId) navigation.runtime.activeGrowthTaskId = "";
      state.workNavigation = navigation;
      save();
    } catch (error) { /* the navigation model is optional in this build */ }
  }

  /**
   * Delete through the real command, then remember exactly what changed so the
   * 12-second undo restores only what is still untouched.
   */
  async function manage24SubmitDelete() {
    const draft = manage24DeleteDraft;
    if (!draft) return;
    const group = manage24Group(draft.groupId);
    const errorHost = manage24Node("#manage24-delete-error");
    const fail = (message) => { if (errorHost) errorHost.textContent = message; };
    if (!group) { fail("分组已不存在"); return; }
    const dependent = manage24GrowthSourceId() === draft.groupId;
    if (dependent && !draft.replacement) { fail("请选择替换来源或停用当前来源"); return; }
    if (draft.remove && !draft.confirmed) { fail("请确认内容删除的影响"); return; }
    if (!draft.remove && !manage24GroupChoices().some((choice) => choice.id === draft.target)) { fail("请选择有效目标分组"); return; }

    const targetGroupId = draft.target === UNGROUPED_TASKS_GROUP_ID ? "" : draft.target;
    const undo = {
      group: { id: group.id, title: group.title, order: group.order },
      source: manage24GrowthSourceId(),
      afterSource: dependent ? (draft.replacement === "stop" ? "" : draft.replacement) : manage24GrowthSourceId(),
      remove: draft.remove,
      items: state.tasks
        .filter((task) => (task.groupId || "") === draft.groupId)
        .map((task) => ({ id: task.id, previousGroupId: task.groupId || "", afterGroupId: draft.remove ? null : targetGroupId })),
    };

    // The impact panel is the confirmation: one explicit decision, one dialog.
    //
    // Phase26: the delete itself is one archived transaction. The group record,
    // its retained members and its growth-source change are captured together,
    // and the panel's target decides where retained content lands.
    if (typeof recovery26DeleteGroup === "function") {
      const outcome = await recovery26Transaction(() => recovery26DeleteGroup(draft.groupId, {
        policy: draft.remove ? "delete" : "keep",
        targetGroupId,
        replacement: dependent ? (draft.replacement === "stop" ? "stop" : draft.replacement) : null,
      }));
      if (!outcome.ok) { fail(outcome.message || "分组未删除"); return; }
      manage24RetainedTaskId = "";
      manage24Undo = null;
      manage24CloseSurface();
      manage24DeleteDraft = null;
      render();
      recovery26AfterRemoval(outcome.entries, draft.remove
        ? "分组及内容已移到最近删除"
        : `分组已删除，内容移至「${manage24GroupTitle(targetGroupId)}」`);
      return;
    }

    const deleted = await deleteGroup(draft.groupId, draft.remove ? "delete" : "ungroup", { skipConfirm: true });
    if (!deleted) { fail("分组未删除"); return; }

    // deleteGroup() ungroups everything into 未分组; the panel's target decides
    // where the content lands, and every moved record keeps its own id.
    if (!draft.remove && targetGroupId) {
      undo.items.forEach((item) => {
        const task = manage24Task(item.id);
        if (!task || (task.groupId || "") !== "") return;
        task.groupId = targetGroupId;
        task.updatedAt = now();
      });
      save();
    }
    if (dependent) manage24ApplyGrowthSource(draft.replacement === "stop" ? "" : draft.replacement);
    if (state.activeGroupId === draft.groupId) {
      state.activeGroupId = draft.remove ? ALL_TASKS_GROUP_ID : (targetGroupId || UNGROUPED_TASKS_GROUP_ID);
    }
    manage24RetainedTaskId = "";
    manage24Undo = undo;
    manage24CloseSurface();
    manage24DeleteDraft = null;
    render();
    manage24Receipt(
      draft.remove ? "分组及内容已删除" : `分组已删除，内容移至「${manage24GroupTitle(targetGroupId)}」`,
      "undo-group", "撤销",
    );
  }

  function manage24UndoDelete() {
    const undo = manage24Undo;
    if (!undo) return;
    manage24Undo = null;
    const groups = state.taskGroups;
    if (!groups.some((group) => group.id === undo.group.id)) {
      groups.push({ ...undo.group });
      groups.sort((a, b) => (a.order || 0) - (b.order || 0));
      groups.forEach((group, index) => { group.order = index + 1; });
    }
    let skipped = 0;
    undo.items.forEach((item) => {
      const task = manage24Task(item.id);
      if (!task) { skipped += 1; return; }
      // Deleted content is recreated only when the record itself is gone; the
      // complete deletion/recovery lifecycle is a later phase.
      if (undo.remove) { skipped += 1; return; }
      if ((task.groupId || "") !== (item.afterGroupId || "")) { skipped += 1; return; }
      task.groupId = item.previousGroupId;
      task.updatedAt = now();
    });
    if (undo.source === undo.group.id && manage24GrowthSourceId() === undo.afterSource) {
      manage24ApplyGrowthSource(undo.source);
    }
    save();
    render();
    manage24Receipt(skipped ? `已恢复可恢复的内容，${skipped} 项后续修改保持` : "分组与内容已恢复");
  }

  // ============================================================
  // 9. Events
  // ============================================================

  /** Double-click naming: the task row, the workspace title and the nav group. */
  function manage24NameTarget(target) {
    if (typeof shellBulk !== "undefined" && shellBulk?.active) return null;
    const task = target.closest?.(".task-select[data-task-id]");
    if (task && task.closest(".task-item")) return { kind: "task", id: task.dataset.taskId };
    const group = target.closest?.(".nav-groups .group-nav-row [data-action='select-nav-group']");
    if (group?.dataset.groupId && group.dataset.groupId !== UNGROUPED_TASKS_GROUP_ID && manage24Group(group.dataset.groupId)) {
      return { kind: "group", id: group.dataset.groupId };
    }
    return null;
  }

  window.addEventListener("click", (event) => {
    const stamp = performance.now();
    const target = manage24NameTarget(event.target);
    if (target && event.detail > 0) {
      const previous = manage24LastRowTitle;
      const isDouble = event.detail === 2
        || (previous && previous.kind === target.kind && previous.id === target.id && stamp - previous.time < 500);
      manage24LastRowTitle = isDouble ? null : { kind: target.kind, id: target.id, time: stamp };
      if (isDouble) {
        // The two clicks of a double-click already selected the row; the second
        // one opens the in-place editor instead of selecting again.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (target.kind === "task") manage24BeginRowTitle(target.id);
        else manage24StartGroupEdit(target.id);
        return;
      }
    } else {
      manage24LastRowTitle = null;
    }
    // An outside click saves the open in-place editor but is never consumed, so
    // selecting another task or group happens in the same gesture.
    if (manage24RowTitleSession && !event.target.closest?.(".manage24-row-title")) {
      void manage24EndRowTitle({ cancel: false, fromBlur: true });
    }
    if (manage24TitleSession
      && !event.target.closest?.(".task-title")
      && !event.target.closest?.('[data-action="edit-task-title"]')) {
      void manage24EndTitle({ cancel: false, fromBlur: true });
    }
    if (state.editingGroupId && !event.target.closest?.(".nav-group-editor")) {
      void manage24FinishGroupEdit(state.editingGroupId, { cancel: false });
    }
  }, true);

  window.addEventListener("contextmenu", (event) => {
    const row = event.target.closest?.(".nav-groups .group-nav-row [data-action='select-nav-group']");
    const groupId = row?.dataset.groupId;
    if (!groupId || groupId === UNGROUPED_TASKS_GROUP_ID || !manage24Group(groupId)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    manage24LastRowTitle = null;
    // A right-click never changes the current list.
    if (manage24Node("#overlay")?.firstElementChild) { manage24CloseSurface(); return; }
    if (state.contextMenu) { state.contextMenu = null; render(); return; }
    manage24ShowGroupMenu(groupId, row, { x: event.clientX, y: event.clientY });
  }, true);

  window.addEventListener("focusout", (event) => {
    if (event.target.id === "manage24-row-title" && manage24RowTitleSession) {
      manage24EndRowTitle({ cancel: false, fromBlur: true });
    }
    if (event.target.id === "manage24-title" && manage24TitleSession) {
      manage24EndTitle({ cancel: false, fromBlur: true });
    }
    if (event.target.id === "group-title" && state.editingGroupId) {
      manage24FinishGroupEdit(state.editingGroupId, { cancel: false });
    }
  });

  window.addEventListener("input", (event) => {
    if (event.target.id === "manage24-row-title" && manage24RowTitleSession) {
      manage24RowTitleSession.value = event.target.value;
      manage24RowTitleSession.error = "";
      const error = document.getElementById("manage24-row-error");
      if (error) error.textContent = "";
      event.target.removeAttribute("aria-invalid");
    }
    if (event.target.id === "manage24-title" && manage24TitleSession) {
      manage24TitleSession.value = String(event.target.value || "").replace(/\n/g, "");
      manage24TitleSession.error = "";
      const error = document.getElementById("manage24-title-error");
      if (error) error.textContent = "";
      event.target.removeAttribute("aria-invalid");
      manage24ResizeTitle();
    }
    if (event.target.id === "group-title" && state.editingGroupId) {
      manage24TitleDrafts.set(state.editingGroupId, event.target.value);
      if (event.target.value.trim()) event.target.removeAttribute("aria-invalid");
    }
    if (event.target.closest?.("#manage24-property-form")) manage24CapturePanel();
    if (event.target.id === "manage24-move-search" && manage24MoveDraft) {
      manage24MoveDraft.query = event.target.value;
      manage24DrawDestinations();
    }
    if (event.target.id === "manage24-organizer-search") {
      manage24OrganizerQuery = event.target.value;
      manage24DrawOrganizer();
    }
  });

  window.addEventListener("change", (event) => {
    if (event.target.closest?.("#manage24-property-form")) {
      manage24CapturePanel();
      if (event.target.id === "manage24-cycle") {
        const weekdays = document.getElementById("manage24-weekdays");
        if (weekdays) weekdays.hidden = event.target.value !== "weekly";
      }
    }
    if (event.target.id === "manage24-keep-target" && manage24DeleteDraft) {
      manage24DeleteDraft.target = event.target.value;
    }
    if (event.target.id === "manage24-growth-next" && manage24DeleteDraft) {
      manage24DeleteDraft.replacement = event.target.value;
    }
    if (event.target.id === "manage24-delete-confirm" && manage24DeleteDraft) {
      manage24DeleteDraft.confirmed = event.target.checked;
    }
    if (event.target.id === "manage24-remove-all" && manage24DeleteDraft) {
      manage24DeleteDraft.remove = event.target.checked;
      manage24DeleteDraft.confirmed = false;
      manage24ShowDeleteGroup(manage24DeleteDraft.groupId);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;

    if (event.target.id === "manage24-row-title" && manage24RowTitleSession && ["Enter", "Escape"].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      manage24EndRowTitle({ cancel: event.key === "Escape" });
      return;
    }
    if (event.target.id === "manage24-title" && manage24TitleSession && ["Enter", "Escape"].includes(event.key) && !event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      manage24EndTitle({ cancel: event.key === "Escape" });
      if (!manage24TitleSession) manage24Focus(".title-edit");
      return;
    }
    if (event.target.id === "group-title" && state.editingGroupId && ["Enter", "Escape"].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      manage24FinishGroupEdit(state.editingGroupId, { cancel: event.key === "Escape" });
      return;
    }

    const groupRow = event.target.closest?.(".nav-groups .group-nav-row [data-action='select-nav-group']");
    const groupId = groupRow?.dataset.groupId;
    const editableGroup = Boolean(groupId && groupId !== UNGROUPED_TASKS_GROUP_ID && manage24Group(groupId));
    if (editableGroup && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      manage24ShowGroupMenu(groupId, groupRow);
      return;
    }
    if (event.key === "F2") {
      const taskRow = event.target.closest?.(".task-select[data-task-id]");
      if (taskRow) {
        event.preventDefault();
        event.stopImmediatePropagation();
        manage24BeginRowTitle(taskRow.dataset.taskId);
        return;
      }
      if (editableGroup) {
        event.preventDefault();
        event.stopImmediatePropagation();
        manage24StartGroupEdit(groupId);
        return;
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && manage24Node("#manage24-property-form")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      manage24Node("#manage24-property-form").requestSubmit();
    }
  }, true);

  window.addEventListener("click", (event) => {
    const priority = event.target.closest?.("[data-manage24-priority]");
    if (priority && manage24PropertyDraft) {
      event.preventDefault();
      event.stopImmediatePropagation();
      manage24PropertyDraft.priority = priority.dataset.manage24Priority;
      priority.closest(".manage24-choices")?.querySelectorAll("[data-manage24-priority]").forEach((choice) => {
        choice.setAttribute("aria-pressed", String(choice === priority));
      });
      return;
    }
    const destination = event.target.closest?.("[data-manage24-target]");
    if (destination && manage24MoveDraft) {
      event.preventDefault();
      event.stopImmediatePropagation();
      manage24MoveDraft.groupId = destination.dataset.manage24Target;
      manage24DrawDestinations();
      manage24Node(`[data-manage24-target="${escSelectorValue(manage24MoveDraft.groupId)}"]`)?.focus({ preventScroll: true });
    }
  }, true);

  // 移动到分组 uses the Demo's own surface (searchable destination list with
  // counts), not the incumbent group dialog: same command, Demo presentation.
  window.addEventListener("click", (event) => {
    const button = event.target.closest?.('[data-action="toggle-task-group-select"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    manage24ShowMove(button, manage24Task(button.dataset.taskId) || shellActiveTask());
  }, true);

  // The workspace title's own control: open the in-place editor instead of the
  // project's title dialog (capture phase, like every other management path).
  window.addEventListener("click", (event) => {
    const button = event.target.closest?.('[data-action="edit-task-title"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    manage24BeginTitle(shellActiveTask());
  }, true);

  /** The overlay's own controls: one vocabulary, one place. */
  window.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-manage24]");
    const action = button?.dataset.manage24;
    if (!action) return;

    if (action === "properties") {
      event.preventDefault();
      event.stopImmediatePropagation();
      manage24ShowProperties(button, manage24Task(button.dataset.taskId) || shellActiveTask());
      return;
    }
    if (action === "organize") {
      event.preventDefault();
      event.stopImmediatePropagation();
      manage24Organize(button, button.dataset.groupId || "");
      return;
    }
    const OUTSIDE_OVERLAY = ["undo-group", "view-moved", "return-list"];
    if (!button.closest("#overlay") && !OUTSIDE_OVERLAY.includes(action)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (action === "cancel-properties") {
      manage24CapturePanel();
      if (manage24PropertyDraft) manage24PropertyDrafts.delete(manage24PropertyDraft.id);
      manage24PropertyDraft = null;
      manage24CloseSurface();
      return;
    }
    if (action === "time") {
      manage24CapturePanel();
      if (!manage24PropertyDraft) return;
      manage24PropertyDraft.expanded = !manage24PropertyDraft.expanded;
      const time = document.getElementById("manage24-time");
      if (time) time.hidden = !manage24PropertyDraft.expanded;
      button.setAttribute("aria-expanded", String(manage24PropertyDraft.expanded));
      const surface = manage24Node("#overlay .surface-popover");
      if (surface) {
        surface.style.top = `${Math.max(12, Math.min(Number.parseFloat(surface.style.top) || 60, window.innerHeight - surface.offsetHeight - 48))}px`;
      }
      return;
    }
    if (action === "cancel-move") { manage24MoveDraft = null; manage24CloseSurface(); return; }
    if (action === "cancel-delete") { manage24DeleteDraft = null; manage24CloseSurface(); return; }
    if (action === "new-from-organizer") {
      manage24CloseSurface();
      addGroup();
      render();
      manage24Focus("#group-title");
      return;
    }
    if (action === "group-open") {
      const groupId = button.dataset.groupId;
      manage24CloseSurface();
      selectGroup(groupId);
      render();
      return;
    }
    if (action === "group-up" || action === "group-down") {
      const inside = Boolean(button.closest(".manage24-organizer"));
      const groupId = button.dataset.groupId;
      manage24MoveGroup(groupId, action === "group-up" ? -1 : 1, { reopen: inside });
      return;
    }
    if (action === "group-rename") {
      const groupId = button.dataset.groupId;
      manage24CloseSurface();
      manage24StartGroupEdit(groupId);
      return;
    }
    if (action === "group-delete") {
      manage24ShowDeleteGroup(button.dataset.groupId, button);
      return;
    }
    if (action === "view-moved") {
      const task = manage24Task(manage24RetainedTaskId);
      if (!task) return;
      manage24RetainedTaskId = "";
      state.activeGroupId = normalizeActiveGroupId(task.groupId || UNGROUPED_TASKS_GROUP_ID, state.taskGroups);
      state.activeTaskId = task.id;
      state.taskFilter = "all";
      state.query = "";
      state.priorityFilter = "all";
      state.captureSourceFilter = "all";
      state.taskDateFilter = "";
      state.taskDeadlineFilter = "all";
      render();
      manage24Focus(".title-edit");
      return;
    }
    if (action === "return-list") {
      manage24RetainedTaskId = "";
      render();
      return;
    }
    if (action === "undo-group") manage24UndoDelete();
  }, true);

  // Forms are rendered inside #overlay, so their submit is delegated here.
  document.addEventListener("submit", (event) => {
    if (event.target.id === "manage24-property-form") {
      event.preventDefault();
      void manage24SaveProperties();
    } else if (event.target.id === "manage24-move-form") {
      event.preventDefault();
      void manage24SubmitMove();
    } else if (event.target.id === "manage24-delete-group") {
      event.preventDefault();
      void manage24SubmitDelete();
    }
  }, true);

  // The task menu must release the click before an export dialog opens, or the
  // first close lands on the menu underneath it.
  window.addEventListener("click", (event) => {
    const action = event.target.closest?.("[data-action]")?.dataset.action;
    if (action === "share-task" && state.taskMenuOpen) {
      state.taskMenuOpen = false;
      render();
    }
  }, true);

  // ---- the move context strip ----
  function manage24SyncContextReceipt() {
    const existing = document.querySelector(".manage24-context-receipt");
    const task = manage24Task(manage24RetainedTaskId);
    const needed = task
      && !filteredTasks().some((item) => item.id === task.id)
      && ["tasks", "today"].includes(shellRoute());
    if (!needed) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    document.querySelector(".workspace")?.insertAdjacentHTML(
      "afterbegin",
      `<div class="manage24-context-receipt"><span>此任务已不在当前列表中</span><button type="button" data-manage24="view-moved">前往${manage24Esc(manage24GroupTitle(task.groupId))}</button><button type="button" data-manage24="return-list">返回列表</button></div>`,
    );
  }

  const manage24BaseRender = render;
  render = function manage24Render() {
    manage24BaseRender();
    manage24DrawRowTitle();
    manage24SyncContextReceipt();
  };

  // ---- boot ---------------------------------------------------------------
  render();
})();

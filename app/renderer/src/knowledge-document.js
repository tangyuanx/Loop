(function exposeKnowledgeDocument(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KnowledgeDocument = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  const DOCUMENT_STATES = Object.freeze([
    "DRAFT",
    "SAVED",
    "DIRTY",
    "EXTERNAL_CHANGED",
    "FILE_MISSING",
    "READ_ONLY",
  ]);
  const DOCUMENT_STATE_SET = new Set(DOCUMENT_STATES);

  function normalizeText(value) {
    return typeof value === "string" ? value : value == null ? "" : String(value);
  }

  function normalizeNullableText(value) {
    const text = normalizeText(value).trim();
    return text || null;
  }

  function normalizeNonNegativeNumber(value, fallback = null) {
    if (value === null || value === undefined || value === "") return fallback;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function normalizeTimestamp(value, fallback = "") {
    if (!value) return fallback;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
  }

  function normalizeHash(value) {
    const hash = normalizeText(value).trim();
    return hash || null;
  }

  function normalizePosition(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const result = {};
    keys.forEach((key) => {
      const number = normalizeNonNegativeNumber(value[key]);
      if (number !== null) result[key] = number;
    });
    return Object.keys(result).length ? result : null;
  }

  function normalizeTableColumnWidths(value) {
    if (!Array.isArray(value)) return [];
    const tables = value.slice(0, 64).map((table) => {
      if (!Array.isArray(table) || table.length < 2 || table.length > 32) return [];
      const widths = table.map((width) => Math.round(Number(width)));
      return widths.every((width) => Number.isFinite(width) && width >= 80 && width <= 1600) ? widths : [];
    });
    while (tables.length && tables[tables.length - 1].length === 0) tables.pop();
    return tables;
  }

  function normalizeDocumentState(value, fallback = "DRAFT") {
    return DOCUMENT_STATE_SET.has(value) ? value : fallback;
  }

  function canonicalFilePath(value, platform = "") {
    let normalized = normalizeText(value).trim().replaceAll("\\", "/").replace(/\/+/g, "/");
    if (!normalized) return "";
    normalized = normalized.replace(/\/\.\//g, "/").replace(/\/+$/g, "");
    return platform === "win32" ? normalized.toLowerCase() : normalized;
  }

  function inferDocumentState(raw, filePath) {
    if (!filePath) return "DRAFT";
    if (DOCUMENT_STATE_SET.has(raw.documentState)) return raw.documentState;
    return raw.dirty ? "DIRTY" : "SAVED";
  }

  function createKnowledgeNoteMetadata({
    noteId,
    taskId,
    title,
    createdAt = "",
    updatedAt = createdAt,
  } = {}) {
    return {
      noteId: normalizeText(noteId).trim() || normalizeText(taskId).trim(),
      taskId: normalizeText(taskId).trim(),
      title: normalizeText(title),
      aliases: [],
      isDeleted: false,
      filePath: null,
      documentState: "DRAFT",
      dirty: false,
      lastSavedHash: null,
      lastSavedMtime: null,
      encoding: "UTF-8",
      lineEnding: "LF",
      cursorPosition: null,
      scrollPosition: null,
      tableColumnWidths: [],
      createdAt: normalizeTimestamp(createdAt),
      updatedAt: normalizeTimestamp(updatedAt, normalizeTimestamp(createdAt)),
      lastOpenedAt: null,
    };
  }

  function normalizeKnowledgeNote(value, { taskId = "", title = "", createdAt = "", updatedAt = "" } = {}) {
    const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const normalizedTaskId = normalizeText(raw.taskId || taskId).trim();
    const filePath = normalizeNullableText(raw.filePath);
    const state = inferDocumentState(raw, filePath);
    const dirty = state === "SAVED" ? false : state === "DRAFT" ? Boolean(raw.dirty) : true;
    const fallback = createKnowledgeNoteMetadata({
      noteId: raw.noteId || normalizedTaskId,
      taskId: normalizedTaskId,
      title: raw.title ?? title,
      createdAt: raw.createdAt || createdAt,
      updatedAt: raw.updatedAt || updatedAt || createdAt,
    });

    return {
      ...fallback,
      noteId: normalizeText(raw.noteId || fallback.noteId).trim() || normalizedTaskId,
      taskId: normalizedTaskId,
      title: normalizeText(raw.title ?? title),
      aliases: Array.isArray(raw.aliases) ? [...new Set(raw.aliases.filter((v) => typeof v === "string" && v.trim()))] : [],
      isDeleted: raw.isDeleted === true,
      filePath,
      documentState: normalizeDocumentState(state),
      dirty,
      lastSavedHash: normalizeHash(raw.lastSavedHash),
      lastSavedMtime: normalizeNonNegativeNumber(raw.lastSavedMtime),
      encoding: normalizeText(raw.encoding).trim() || "UTF-8",
      lineEnding: raw.lineEnding === "CRLF" ? "CRLF" : "LF",
      cursorPosition: normalizePosition(raw.cursorPosition, ["start", "end"]),
      scrollPosition: normalizePosition(raw.scrollPosition, ["top", "left"]),
      tableColumnWidths: normalizeTableColumnWidths(raw.tableColumnWidths),
      createdAt: normalizeTimestamp(raw.createdAt, fallback.createdAt),
      updatedAt: normalizeTimestamp(raw.updatedAt, fallback.updatedAt),
      lastOpenedAt: normalizeTimestamp(raw.lastOpenedAt, "") || null,
    };
  }

  function createDocumentSession(options = {}) {
    return normalizeKnowledgeNote(
      createKnowledgeNoteMetadata(options),
      options,
    );
  }

  function updateDocumentTitle(session, title) {
    const next = normalizeKnowledgeNote(session);
    const previous = next.title;
    next.title = normalizeText(title);
    if (previous && previous !== next.title) next.aliases = [...new Set([...next.aliases, previous])];
    return next;
  }

  function updateTableColumnWidths(session, tableColumnWidths) {
    const next = normalizeKnowledgeNote(session);
    next.tableColumnWidths = normalizeTableColumnWidths(tableColumnWidths);
    return next;
  }

  function markDocumentEdited(session) {
    const next = normalizeKnowledgeNote(session);
    next.dirty = true;
    next.isDeleted = false;
    if (next.documentState === "SAVED") next.documentState = "DIRTY";
    return next;
  }

  function markDocumentSaved(session, {
    filePath,
    lastSavedHash,
    lastSavedMtime,
    encoding,
    lineEnding,
  } = {}) {
    const next = normalizeKnowledgeNote(session);
    const boundPath = normalizeNullableText(filePath) || next.filePath;
    if (!boundPath) return next;
    next.filePath = boundPath;
    next.documentState = "SAVED";
    next.dirty = false;
    if (lastSavedHash !== undefined) next.lastSavedHash = normalizeHash(lastSavedHash);
    if (lastSavedMtime !== undefined) next.lastSavedMtime = normalizeNonNegativeNumber(lastSavedMtime);
    if (encoding !== undefined) next.encoding = normalizeText(encoding).trim() || "UTF-8";
    if (lineEnding !== undefined) next.lineEnding = lineEnding === "CRLF" ? "CRLF" : "LF";
    return next;
  }

  function markDocumentExternalChanged(session) {
    const next = normalizeKnowledgeNote(session);
    next.documentState = "EXTERNAL_CHANGED";
    next.dirty = true;
    return next;
  }

  function markDocumentFileMissing(session) {
    const next = normalizeKnowledgeNote(session);
    next.documentState = "FILE_MISSING";
    next.dirty = true;
    return next;
  }

  function markDocumentReadOnly(session) {
    const next = normalizeKnowledgeNote(session);
    next.documentState = "READ_ONLY";
    next.dirty = true;
    return next;
  }

  return Object.freeze({
    DOCUMENT_STATES,
    imageReferences: typeof module === "object" && module.exports ? require("./knowledge-core.js").imageReferences : globalThis.LoopKnowledgeCore.imageReferences,
    canonicalFilePath,
    createDocumentSession,
    createKnowledgeNoteMetadata,
    markDocumentEdited,
    markDocumentExternalChanged,
    markDocumentFileMissing,
    markDocumentReadOnly,
    markDocumentSaved,
    normalizeDocumentState,
    normalizeKnowledgeNote,
    updateDocumentTitle,
    updateTableColumnWidths,
  });
});

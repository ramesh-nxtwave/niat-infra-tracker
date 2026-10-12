const STORAGE_KEY = 'niat_checklist_drafts_v1';
const memoryDrafts = new Map();
const listeners = new Set();
let nextGeneration = 1;
let currentOwner = 'anonymous';
let draftVersion = 0;

export const CHECKLIST_DRAFT_FIELDS = [
  'status',
  'remarks',
  'photoLink',
  'photoContentType',
  'universityTimeline',
  'targetDate',
  'itemStartDate',
  'itemEndDate',
  'actualDate',
  'capacity',
];

const API_TO_DRAFT_FIELD = {
  currentStatus: 'status',
  remarks: 'remarks',
  photoUrl: 'photoLink',
  photoContentType: 'photoContentType',
  universityTimeline: 'universityTimeline',
  targetTimeline: 'targetDate',
  itemStartDate: 'itemStartDate',
  itemEndDate: 'itemEndDate',
  actualCompletionDate: 'actualDate',
  capacity: 'capacity',
};

function storage() {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function load() {
  if (memoryDrafts.size > 0) return;
  let raw = null;
  try {
    raw = storage()?.getItem(`${STORAGE_KEY}:${currentOwner}`);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    Object.entries(parsed).forEach(([key, value]) => {
      if (value?.fields) memoryDrafts.set(key, value);
      Object.values(value?.fields || {}).forEach(field => {
        nextGeneration = Math.max(nextGeneration, Number(field.generation || 0) + 1);
      });
    });
  } catch {
    try {
      storage()?.removeItem(`${STORAGE_KEY}:${currentOwner}`);
    } catch {
      // Storage can be disabled or full; the in-memory draft remains usable.
    }
  }
}

function persist() {
  const serialized = Object.fromEntries(memoryDrafts);
  const target = storage();
  if (!target) return;
  try {
    if (memoryDrafts.size === 0) target.removeItem(`${STORAGE_KEY}:${currentOwner}`);
    else target.setItem(`${STORAGE_KEY}:${currentOwner}`, JSON.stringify(serialized));
  } catch {
    // Draft durability is best-effort. Never make a field uneditable because
    // sessionStorage is unavailable or its quota is exhausted.
  }
}

function notify() {
  draftVersion += 1;
  listeners.forEach(listener => listener());
}

function keyFor(universityId, statusId) {
  return `${String(universityId)}:${String(statusId)}`;
}

export function recordChecklistDraft(universityId, item, updates) {
  load();
  const fields = Object.fromEntries(
    Object.entries(updates || {}).filter(([field]) => CHECKLIST_DRAFT_FIELDS.includes(field)),
  );
  if (!item?.id || Object.keys(fields).length === 0) return null;

  const key = keyFor(universityId, item.id);
  const previous = memoryDrafts.get(key) || {
    universityId: String(universityId),
    statusId: String(item.id),
    label: item.name || String(item.id),
    fields: {},
  };
  const generation = nextGeneration++;
  const next = {
    ...previous,
    label: item.name || previous.label,
    failed: false,
    error: null,
    fields: { ...previous.fields },
  };
  Object.entries(fields).forEach(([field, value]) => {
    next.fields[field] = { value, generation };
  });
  memoryDrafts.set(key, next);
  persist();
  notify();
  return { generation, fields };
}

export function getChecklistDraft(universityId, statusId) {
  load();
  return memoryDrafts.get(keyFor(universityId, statusId)) || null;
}

export function mergeChecklistItemDraft(universityId, item) {
  const draft = getChecklistDraft(universityId, item?.id);
  if (!draft) return item;
  const updates = {};
  Object.entries(draft.fields).forEach(([field, state]) => {
    updates[field] = state.value;
  });
  return { ...item, ...updates };
}

export function mergeChecklistItemsWithDrafts(universityId, items = []) {
  return items.map(item => mergeChecklistItemDraft(universityId, item));
}

export function applyChecklistDraftsToUniversity(university) {
  if (!university?.id) return university;
  const universityId = university.id;
  const trackers = university.trackers || {};
  const classrooms = (university.classrooms || []).map(room => ({
    ...room,
    items: mergeChecklistItemsWithDrafts(universityId, room.items || []),
  }));
  return {
    ...university,
    trackers: {
      ...trackers,
      modelClassroom: trackers.modelClassroom
        ? { ...trackers.modelClassroom, items: mergeChecklistItemsWithDrafts(universityId, trackers.modelClassroom.items || []) }
        : trackers.modelClassroom,
      lab5: trackers.lab5
        ? { ...trackers.lab5, items: mergeChecklistItemsWithDrafts(universityId, trackers.lab5.items || []) }
        : trackers.lab5,
      staffRoom: trackers.staffRoom
        ? { ...trackers.staffRoom, items: mergeChecklistItemsWithDrafts(universityId, trackers.staffRoom.items || []) }
        : trackers.staffRoom,
      overallClassroom: trackers.overallClassroom
        ? { ...trackers.overallClassroom, classrooms }
        : trackers.overallClassroom,
    },
    classrooms,
  };
}

export function getChecklistDraftSubmission(universityId, statusId) {
  const draft = getChecklistDraft(universityId, statusId);
  if (!draft) return null;
  const data = {};
  const generations = {};
  Object.entries(draft.fields).forEach(([field, state]) => {
    data[field] = state.value;
    generations[field] = state.generation;
  });
  return {
    statusId: draft.statusId,
    label: draft.label,
    data,
    generations,
  };
}

export function getChecklistDraftSubmissions(universityId, statusIds) {
  const allowed = new Set((statusIds || []).map(String));
  load();
  return [...memoryDrafts.values()]
    .filter(draft => draft.universityId === String(universityId) && allowed.has(String(draft.statusId)))
    .map(draft => getChecklistDraftSubmission(universityId, draft.statusId));
}

export function checklistApiDataToDraftSnapshot(universityId, statusId, data) {
  const draft = getChecklistDraft(universityId, statusId);
  if (!draft) return null;
  const generations = {};
  Object.entries(data || {}).forEach(([apiField, value]) => {
    const field = API_TO_DRAFT_FIELD[apiField];
    const current = field && draft.fields[field];
    if (current && Object.is(current.value, value)) generations[field] = current.generation;
  });
  return Object.keys(generations).length > 0
    ? { statusId: String(statusId), generations }
    : null;
}

export function getChecklistDraftFieldsForApiData(data) {
  return [...new Set(
    Object.keys(data || {})
      .map(apiField => API_TO_DRAFT_FIELD[apiField])
      .filter(Boolean),
  )];
}

export function acknowledgeChecklistDraft(universityId, snapshot) {
  if (!snapshot) return;
  const key = keyFor(universityId, snapshot.statusId);
  const draft = getChecklistDraft(universityId, snapshot.statusId);
  if (!draft) return;
  const fields = { ...draft.fields };
  Object.entries(snapshot.generations || {}).forEach(([field, generation]) => {
    if (fields[field]?.generation === generation) delete fields[field];
  });
  if (Object.keys(fields).length === 0) memoryDrafts.delete(key);
  else memoryDrafts.set(key, { ...draft, failed: false, error: null, fields });
  persist();
  notify();
}

export function markChecklistDraftFailed(universityId, statusId, error) {
  const key = keyFor(universityId, statusId);
  const draft = getChecklistDraft(universityId, statusId);
  if (!draft) return;
  memoryDrafts.set(key, {
    ...draft,
    failed: true,
    error: error?.message || 'Failed to save',
    correlationId: error?.correlationId || null,
  });
  persist();
  notify();
}

export function getPendingChecklistDrafts(universityId, statusIds, fields) {
  const allowed = statusIds ? new Set(statusIds.map(String)) : null;
  const allowedFields = fields == null
    ? null
    : new Set(Array.isArray(fields) ? fields : [fields]);
  load();
  return [...memoryDrafts.values()].filter(draft =>
    draft.universityId === String(universityId)
    && (!allowed || allowed.has(String(draft.statusId)))
    && (!allowedFields || Object.keys(draft.fields || {}).some(field => allowedFields.has(field))),
  );
}

export function subscribeChecklistDrafts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChecklistDraftVersion() {
  return draftVersion;
}

export function getChecklistDraftOwner() {
  return currentOwner;
}

export function setChecklistDraftOwner(ownerId) {
  const nextOwner = ownerId ? String(ownerId) : 'anonymous';
  if (nextOwner === currentOwner) return;
  try {
    storage()?.removeItem(`${STORAGE_KEY}:${currentOwner}`);
  } catch {
    // Identity isolation must still work in memory if storage is unavailable.
  }
  memoryDrafts.clear();
  nextGeneration = 1;
  currentOwner = nextOwner;
  load();
  notify();
}

export function resetChecklistDraftStoreForTests() {
  memoryDrafts.clear();
  nextGeneration = 1;
  try {
    storage()?.removeItem(`${STORAGE_KEY}:${currentOwner}`);
  } catch {
    // Ignore storage restrictions in tests just as production typing does.
  }
  notify();
}
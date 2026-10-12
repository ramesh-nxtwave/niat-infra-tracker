// The model tracker is not an ordinary classroom registry row.  Keep a stable
// local selection key for the unified All Classrooms view without making model
// links depend on a room id that the API does not provide.
export const MODEL_CLASSROOM_ID = '__model_classroom__';

// Only status IDs from the loaded, authorized detail can identify a destination.
export function resolveChecklistDestination(university, search) {
  const params = new URLSearchParams(search);
  if (!params.has('item')) return { kind: 'none' };
  const ids = params.getAll('item');
  const itemId = ids[0];
  if (ids.length !== 1 || !itemId || itemId !== itemId.trim() ||
      itemId.length > 200 || /[\u0000-\u001f\u007f]/.test(itemId)) {
    return { kind: 'invalid', message: 'This checklist link is invalid. Open the item again from Reports.' };
  }
  const matches = [];
  const trackers = university?.trackers || {};
  for (const [tracker, tab] of [['modelClassroom', 'overall'], ['lab5', 'lab5'], ['staffRoom', 'staff']]) {
    for (const item of trackers[tracker]?.items || []) {
      if (String(item.id) === itemId) {
        matches.push({
          itemId,
          tab,
          classroomId: null,
          modelClassroom: tracker === 'modelClassroom',
        });
      }
    }
  }
  for (const classroom of trackers.overallClassroom?.classrooms || []) {
    for (const item of classroom.items || []) {
      if (String(item.id) === itemId) matches.push({ itemId, tab: 'overall', classroomId: classroom.id });
    }
  }
  // Older detail payloads can contain the authorized status in `spaces` while
  // classroom-to-space association is intentionally withheld from the
  // normalized registry (for example, when two rooms share a name).  Resolve
  // those links only when the registry has exactly one matching room; retaining
  // every candidate lets the caller show the existing ambiguity recovery UI.
  if (!matches.some(match => match.itemId === itemId && match.tab === 'overall')) {
    const canonicalName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    for (const space of university?.spaces || []) {
      if (space?.spaceType !== 'overall_classroom') continue;
      const hasItem = (space.checklistStatuses || []).some(status => String(status?.id) === itemId);
      if (!hasItem) continue;
      const roomName = canonicalName(space.name || space.roomNumber || space.room_id);
      const candidates = (university?.classrooms || []).filter(room =>
        canonicalName(room.roomId || room.room_id) === roomName,
      );
      candidates.forEach(room => matches.push({ itemId, tab: 'overall', classroomId: room.id }));
    }
  }
  if (matches.length === 1) return { kind: 'found', ...matches[0] };
  return {
    kind: 'missing',
    message: matches.length > 1
      ? 'This item could not be matched to a single checklist entry. Return to Reports and choose another source.'
      : 'This checklist item is no longer available in this university. It may have been removed. Refresh or return to Reports.',
  };
}

export function withDetailTimeout(promise, timeoutMs = 20000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Loading university details timed out. Please retry.')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}
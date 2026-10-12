/*
 * The bulk endpoint intentionally accepts a field-scoped snapshot.  Keep the
 * mapping here, next to the forms that create it, so adding a field to the
 * checklist does not accidentally turn an item copy into a whole-row write.
 */

export const WHOLE_CLASSROOM_COPY_FIELDS = Object.freeze([
  'status',
  'remarks',
  'universityTimeline',
  'targetDate',
  'itemStartDate',
  'itemEndDate',
  'actualDate',
  'capacity',
  'photoLink',
  'photoContentType',
]);

// Model Classroom is a source template, rather than a classroom whose
// readiness state should be propagated.  Keep this list deliberately narrow:
// status, capacity, start/completion dates, and any future checklist fields
// must not become model-copy fields by accident.
export const MODEL_CLASSROOM_COPY_FIELDS = Object.freeze([
  'photoLink',
  'remarks',
  'universityTimeline',
  'targetDate',
]);

export const MODEL_CLASSROOM_COPY_FIELD_LABELS = Object.freeze({
  photoLink: 'Photos',
  remarks: 'Remarks',
  universityTimeline: 'University Timeline',
  targetDate: 'Target Timeline',
});

const LOCAL_FIELD_ALIASES = {
  currentStatus: 'status',
  photoUrl: 'photoLink',
};

const API_FIELD_BY_LOCAL_FIELD = {
  status: 'currentStatus',
  remarks: 'remarks',
  photoLink: 'photoUrl',
  photoContentType: 'photoContentType',
  universityTimeline: 'universityTimeline',
  targetDate: 'targetTimeline',
  itemStartDate: 'itemStartDate',
  itemEndDate: 'itemEndDate',
  actualDate: 'actualCompletionDate',
  capacity: 'capacity',
};

export const COPY_FIELD_LABELS = {
  status: 'status',
  remarks: 'remarks',
  photoLink: 'photo evidence',
  photoContentType: 'photo type',
  universityTimeline: 'university timeline',
  targetDate: 'target date',
  itemStartDate: 'start date',
  itemEndDate: 'end date',
  actualDate: 'completion date',
  capacity: 'capacity',
};

/*
 * Bulk writes are deliberately all-or-nothing.  Keep the recovery language
 * tied to the server's stable error codes instead of the HTTP status or the
 * human-readable message.  In particular, a 503 can mean that the write was
 * rejected before the transaction started (safe to retry), while an
 * unclassified network/server failure may have an unknown outcome.
 */
export const BULK_APPLY_ASSOCIATION_ERROR_CODES = Object.freeze([
  'CHECKLIST_CLASSROOM_ASSOCIATION_INVALID',
  'CHECKLIST_CLASSROOM_ASSOCIATION_AMBIGUOUS',
]);

const BULK_APPLY_ASSOCIATION_ERROR_CODE_SET = new Set(BULK_APPLY_ASSOCIATION_ERROR_CODES);

export function isBulkApplyAssociationError(error) {
  return BULK_APPLY_ASSOCIATION_ERROR_CODE_SET.has(error?.code);
}

/**
 * Classify a failed copy without inferring classroom-association problems
 * from a generic error.  The dialogs use this object for both inline errors
 * and toasts, so a retry does not lose the selected source fields or rooms.
 */
export function getBulkApplyErrorGuidance(error) {
  const code = error?.code || null;

  if (code === 'CHECKLIST_SAVE_BUSY') {
    return {
      kind: 'busy',
      retryable: true,
      outcome: 'rolled-back',
      message: 'The checklist save is temporarily busy. No changes were saved; retry this copy. Your selections are still here.',
    };
  }
  if (code === 'CHECKLIST_SAVE_CONFLICT') {
    return {
      kind: 'concurrency',
      retryable: false,
      outcome: 'rolled-back',
      message: 'The checklist changed concurrently. No changes were saved; refresh or reopen the checklist, then retry this copy. Your selections are still here.',
    };
  }
  if (code === 'CHECKLIST_RELATED_RECORD_CHANGED') {
    return {
      kind: 'related-record',
      retryable: false,
      outcome: 'rolled-back',
      message: 'A related checklist record changed. No changes were saved; refresh or reopen the checklist, then retry this copy. Your selections are still here.',
    };
  }
  if (code === 'CHECKLIST_SOURCE_CHANGED') {
    return {
      kind: 'source-changed',
      retryable: false,
      outcome: 'rolled-back',
      message: 'The saved source changed before this copy. No changes were saved; reopen or refresh the source before retrying the copy.',
    };
  }
  if (code === 'CHECKLIST_BULK_TARGETS_MISSING' || code === 'CHECKLIST_BULK_TARGETS_REQUIRED') {
    return {
      kind: 'destination',
      retryable: false,
      outcome: 'rolled-back',
      message: 'A destination checklist row is missing or invalid. No changes were saved; refresh or reopen the destinations before retrying this copy.',
    };
  }
  if (code === 'CHECKLIST_BULK_RESULT_MISMATCH') {
    return {
      kind: 'response-mismatch',
      retryable: false,
      outcome: 'unconfirmed',
      message: 'The copy response did not identify exactly the selected destinations. Refresh the checklist before retrying so an uncertain save is not duplicated.',
    };
  }
  if (isBulkApplyAssociationError(error)) {
    return {
      kind: 'association',
      retryable: false,
      outcome: 'rolled-back',
      message: 'A classroom association is invalid or ambiguous. No changes were saved; ask an administrator to resolve the association, then reload before retrying.',
    };
  }
  if (code === 'CHECKLIST_BULK_TARGET_UNAUTHORIZED' || code === 'CHECKLIST_SOURCE_STATUS_UNAUTHORIZED') {
    return {
      kind: 'authorization',
      retryable: false,
      outcome: 'rolled-back',
      message: 'A selected checklist destination is not authorized for this university. No changes were saved; refresh the checklist and review the selected destinations.',
    };
  }
  if (code === 'CHECKLIST_BULK_DRAFT_CONFLICT' || error?.name === 'ChecklistBulkDraftConflict') {
    const labels = (error.conflictingItems || [])
      .map(item => item?.name || item?.id)
      .filter(Boolean);
    const subject = labels.length > 0
      ? ` for ${labels.join(', ')}`
      : '';
    return {
      kind: 'pending-draft',
      retryable: true,
      outcome: 'not-started',
      message: `A newer local checklist edit${subject} is still a pending local edit. No copy was started; wait for that save to finish, then retry this copy.`,
    };
  }

  return {
    kind: 'unknown',
    retryable: false,
    outcome: 'unconfirmed',
    message: 'The copy could not be confirmed. Refresh the checklist before retrying so an uncertain save is not duplicated.',
  };
}

/**
 * Make a single safe-to-display message for a dialog and its toast.  Server
 * error text is useful for destination-specific validation, but stable
 * recovery guidance remains the source of truth for whether a retry is safe.
 */
export function formatBulkApplyError(error, { action = 'Bulk copy' } = {}) {
  const guidance = getBulkApplyErrorGuidance(error);
  const includeServerMessage = error?.message
    && !['CHECKLIST_SAVE_BUSY', 'CHECKLIST_SAVE_CONFLICT', 'CHECKLIST_RELATED_RECORD_CHANGED'].includes(error.code)
    && error.name !== 'ChecklistBulkDraftConflict';
  const details = includeServerMessage && error.message !== guidance.message
    ? ` ${error.message}`
    : '';
  const reference = error?.correlationId ? ` Reference: ${error.correlationId}.` : '';
  return {
    ...guidance,
    text: `${action} failed:${details}${details ? '' : ' '}${guidance.message}${reference}`,
  };
}

export function normalizeCopyFields(fields) {
  const requested = fields == null
    ? WHOLE_CLASSROOM_COPY_FIELDS
    : (Array.isArray(fields) ? fields : [fields]);
  return [...new Set(requested
    .map(field => LOCAL_FIELD_ALIASES[field] || field)
    .filter(field => Object.hasOwn(API_FIELD_BY_LOCAL_FIELD, field)))];
}

function normalizeChecklistIdentity(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function getCanonicalChecklistItemKey(item) {
  if (!item) return null;
  const category = normalizeChecklistIdentity(item.category);
  const name = normalizeChecklistIdentity(item.name);
  return category && name ? `${category}::${name}` : null;
}

function getModelTargetMatches(room, sourceItem) {
  const sourceKey = getCanonicalChecklistItemKey(sourceItem);
  if (!sourceKey) return [];
  return (room?.items || []).filter(candidate =>
    getCanonicalChecklistItemKey(candidate) === sourceKey);
}

export function getBulkTargetItem(room, sourceItem, { sourceSpaceType } = {}) {
  if (!room || !sourceItem) return null;
  if (sourceSpaceType === 'model_classroom') {
    const matches = getModelTargetMatches(room, sourceItem);
    return matches.length === 1 ? matches[0] : null;
  }
  return (room.items || []).find(candidate =>
    String(candidate.checklistItemId) === String(sourceItem.checklistItemId));
}

/**
 * Return an actionable reason instead of allowing a missing association to
 * disappear from the request.  The API repeats these checks atomically; this
 * client check keeps the user from selecting an impossible destination.
 */
export function getBulkTargetIssue(room, sourceItem, { sourceSpaceType } = {}) {
  if (!room?.id) return 'This classroom has no stable identity.';
  if (room.associationError) return room.associationError;
  if (!room.spaceId) {
    return 'This classroom has no unique checklist association. Ask an administrator to resolve the match, then reload.';
  }
  const modelMatches = sourceSpaceType === 'model_classroom'
    ? getModelTargetMatches(room, sourceItem)
    : null;
  if (sourceSpaceType === 'model_classroom' && !getCanonicalChecklistItemKey(sourceItem)) {
    return 'The model source checklist item is missing a category or name, so its destination cannot be matched safely.';
  }
  if (sourceSpaceType === 'model_classroom' && modelMatches.length > 1) {
    return 'This classroom has multiple checklist items with the same category and name; the model destination is ambiguous.';
  }
  const targetItem = sourceSpaceType === 'model_classroom'
    ? modelMatches[0]
    : getBulkTargetItem(room, sourceItem);
  if (!targetItem?.id) {
    return 'This classroom does not have this checklist item yet. Reload after its checklist is initialized.';
  }
  if (targetItem.spaceId && String(targetItem.spaceId) !== String(room.spaceId)) {
    return 'This classroom checklist row does not belong to its selected classroom. Ask an administrator to resolve the match.';
  }
  return null;
}

export function getSourceIssue(sourceItem) {
  if (!sourceItem?.id) return 'The saved source checklist row is unavailable. Save the source item and try again.';
  if (!sourceItem?.checklistItemId) return 'The source checklist item identity is unavailable. Reload and try again.';
  return null;
}

function sourceValue(sourceItem, localField) {
  if (localField === 'photoLink') {
    return sourceItem.photoLink ?? sourceItem.photoUrl ?? '';
  }
  return sourceItem[localField];
}

/**
 * Build one explicit source-to-target update.  Destination ids are positional
 * by contract and are never inferred by room order or name.
 */
export function buildBulkUpdate(sourceItem, targetRooms, fields, {
  skipDone = false,
  skipBlankValues = false,
  sourceSpaceType,
  includePhotoMetadata = false,
} = {}) {
  const normalizedFields = normalizeCopyFields(fields);
  const targetItems = targetRooms.map(room => {
    const targetItem = getBulkTargetItem(room, sourceItem, { sourceSpaceType });
    if (!targetItem?.id) {
      throw new Error(
        getBulkTargetIssue(room, sourceItem, { sourceSpaceType })
          || 'The destination checklist item cannot be matched safely.',
      );
    }
    return targetItem;
  });
  const update = {
    checklistItemId: String(sourceItem.checklistItemId),
    sourceStatusId: String(sourceItem.id),
    classroomIds: targetRooms.map(room => String(room.id)),
    spaceIds: targetRooms.map(room => String(room.spaceId)),
    targetStatusIds: targetItems.map(targetItem => String(targetItem.id)),
    skipDone,
  };
  if (skipBlankValues) update.skipBlankValues = true;
  if (sourceSpaceType) update.sourceSpaceType = sourceSpaceType;
  if (normalizedFields.includes('photoLink')) {
    update.expectedSourcePhotoUrl = sourceValue(sourceItem, 'photoLink') || null;
  }

  normalizedFields.forEach(localField => {
    // A photo-less source has no saved evidence identity.  Omitting evidence
    // fields preserves target evidence and avoids turning null into an
    // arbitrary empty object path.
    if ((localField === 'photoLink' || localField === 'photoContentType')
      && !sourceValue(sourceItem, 'photoLink')) return;
    const apiField = API_FIELD_BY_LOCAL_FIELD[localField];
    let value = sourceValue(sourceItem, localField);
    if (value === undefined) {
      // Empty strings are intentional clears for ordinary checklist fields.
      // photoContentType is only emitted with a saved photo above.
      value = localField === 'photoContentType' ? null : '';
    }
    if (skipBlankValues && (value == null || (typeof value === 'string' && value.trim() === ''))) {
      // Model Classroom is a template. An empty source control means "do not
      // replace the destination value", not "clear the destination value".
      return;
    }
    update[apiField] = value;
  });
  if (
    includePhotoMetadata
    && normalizedFields.includes('photoLink')
    && sourceValue(sourceItem, 'photoLink')
    && sourceValue(sourceItem, 'photoContentType')
  ) {
    update.photoContentType = sourceValue(sourceItem, 'photoContentType');
  }
  return update;
}

export function describeCopyFields(fields, { labels: fieldLabels = COPY_FIELD_LABELS } = {}) {
  const names = normalizeCopyFields(fields)
    .map(field => fieldLabels[field] || field);
  if (names.length === 0) return 'no fields';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

export function getBulkResultSummary(result, expectedCount, expectedTargetStatusIds) {
  const results = Array.isArray(result?.results) ? result.results : [];
  const applied = results.filter(entry => entry?.outcome === 'applied').length;
  const unchanged = results.filter(entry => entry?.outcome === 'unchanged').length;
  const skipped = results.filter(entry => entry?.outcome === 'skipped').length;
  const expectedIds = expectedTargetStatusIds == null
    ? null
    : expectedTargetStatusIds.map(id => String(id));
  const returnedIds = results.map(entry => entry?.statusId == null ? null : String(entry.statusId));
  const expectedIdCounts = expectedIds
    ? expectedIds.reduce((counts, id) => counts.set(id, (counts.get(id) || 0) + 1), new Map())
    : null;
  const returnedIdCounts = expectedIds
    ? returnedIds.reduce((counts, id) => {
      if (id != null) counts.set(id, (counts.get(id) || 0) + 1);
      return counts;
    }, new Map())
    : null;
  const targetIdsMatch = expectedIds == null
    ? true
    : results.length > 0
      && expectedIds.length > 0
      && expectedIdCounts.size === expectedIds.length
      && returnedIds.every(id => id != null)
      && returnedIdCounts.size === expectedIdCounts.size
      && [...expectedIdCounts.entries()].every(([id, count]) => returnedIdCounts.get(id) === count);

  // Older API responses only had counters.  Keep the fallback bounded by the
  // requested target count so a malformed response cannot announce a false
  // success.
  const fallbackApplied = results.length === 0
    ? Math.min(Number(result?.applied) || 0, expectedCount)
    : applied;
  const fallbackSkipped = results.length === 0
    ? Math.min(Number(result?.skipped) || 0, Math.max(0, expectedCount - fallbackApplied))
    : skipped;
  const accountedFor = results.length === 0
    ? fallbackApplied + fallbackSkipped
    : applied + unchanged + skipped;
  const successful = fallbackApplied + unchanged;
  const complete = expectedCount > 0
    && accountedFor === expectedCount
    && fallbackSkipped === 0
    && targetIdsMatch;
  return {
    applied: fallbackApplied,
    unchanged,
    skipped: fallbackSkipped,
    successful,
    expected: expectedCount,
    complete,
    hasResults: results.length > 0,
    targetIdsMatch,
  };
}
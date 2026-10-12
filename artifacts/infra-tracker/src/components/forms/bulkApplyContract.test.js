import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBulkUpdate,
  formatBulkApplyError,
  getBulkResultSummary,
  getBulkApplyErrorGuidance,
  getBulkTargetIssue,
  MODEL_CLASSROOM_COPY_FIELDS,
} from './bulkApplyContract.js';

const source = {
  id: 'source-status',
  checklistItemId: 'item-generator',
  category: 'Electrical',
  name: 'Generator',
  status: 'In-Progress',
  remarks: 'latest saved source note',
  capacity: '10 KVA',
  photoLink: '/objects/source.jpg',
  photoContentType: 'image/jpeg',
  universityTimeline: '2026-09-01',
};

const destination = {
  id: 'classroom-b',
  room_id: 'Room B',
  spaceId: 'space-b',
  items: [{
    id: 'target-status',
    checklistItemId: 'item-generator',
    category: 'Electrical',
    name: 'Generator',
    status: 'Done',
    remarks: 'keep this target note',
    capacity: 'old capacity',
  }],
};

test('item copy sends explicit identity and only the requested field', () => {
  const payload = buildBulkUpdate(source, [destination], ['remarks']);
  assert.deepEqual(payload, {
    checklistItemId: 'item-generator',
    sourceStatusId: 'source-status',
    classroomIds: ['classroom-b'],
    spaceIds: ['space-b'],
    targetStatusIds: ['target-status'],
    skipDone: false,
    remarks: 'latest saved source note',
  });
  assert.equal(Object.hasOwn(payload, 'currentStatus'), false);
  assert.equal(Object.hasOwn(payload, 'photoUrl'), false);
  assert.equal(Object.hasOwn(payload, 'capacity'), false);
});

test('whole-classroom snapshot includes saved evidence metadata without unrelated fields', () => {
  const payload = buildBulkUpdate(source, [destination], [
    'status',
    'remarks',
    'photoLink',
    'photoContentType',
  ]);
  assert.equal(payload.currentStatus, 'In-Progress');
  assert.equal(payload.remarks, 'latest saved source note');
  assert.equal(payload.photoUrl, '/objects/source.jpg');
  assert.equal(payload.photoContentType, 'image/jpeg');
  assert.equal(Object.hasOwn(payload, 'lastUpdated'), false);
  assert.equal(Object.hasOwn(payload, 'photoHistory'), false);
});

test('ambiguous or missing associations fail closed before a request', () => {
  const ambiguous = {
    ...destination,
    spaceId: null,
    associationError: 'Classroom checklist association is missing or ambiguous.',
  };
  assert.match(getBulkTargetIssue(ambiguous, source), /missing or ambiguous/i);
  assert.match(
    getBulkTargetIssue({ ...destination, items: [] }, source),
    /does not have this checklist item/i,
  );
});

test('photo-less whole snapshots guard source evidence without clearing target evidence', () => {
  const payload = buildBulkUpdate({ ...source, photoLink: '', photoUrl: '' }, [destination]);
  assert.equal(payload.expectedSourcePhotoUrl, null);
  assert.equal(Object.hasOwn(payload, 'photoUrl'), false);
  assert.equal(Object.hasOwn(payload, 'photoContentType'), false);
});

test('model snapshots copy only selected template fields and preserve blank destinations', () => {
  const payload = buildBulkUpdate({
    ...source,
    status: 'Done',
    remarks: '',
    universityTimeline: '',
    targetDate: null,
    capacity: '999 KVA',
  }, [destination], MODEL_CLASSROOM_COPY_FIELDS, {
    skipBlankValues: true,
    sourceSpaceType: 'model_classroom',
    includePhotoMetadata: true,
  });
  assert.equal(payload.skipBlankValues, true);
  assert.equal(payload.sourceSpaceType, 'model_classroom');
  assert.equal(payload.photoUrl, '/objects/source.jpg');
  assert.equal(payload.photoContentType, 'image/jpeg');
  assert.equal(Object.hasOwn(payload, 'remarks'), false);
  assert.equal(Object.hasOwn(payload, 'universityTimeline'), false);
  assert.equal(Object.hasOwn(payload, 'targetTimeline'), false);
  assert.equal(Object.hasOwn(payload, 'currentStatus'), false);
  assert.equal(Object.hasOwn(payload, 'capacity'), false);
});

test('model snapshots retain nonblank timeline and remark values', () => {
  const payload = buildBulkUpdate({
    ...source,
    targetDate: '2026-10-15',
  }, [destination], MODEL_CLASSROOM_COPY_FIELDS, { skipBlankValues: true });
  assert.equal(payload.remarks, 'latest saved source note');
  assert.equal(payload.universityTimeline, '2026-09-01');
  assert.equal(payload.targetTimeline, '2026-10-15');
  assert.equal(Object.hasOwn(payload, 'currentStatus'), false);
});

test('model matching uses canonical category and name while ordinary copies keep exact ids', () => {
  const modelSource = {
    ...source,
    checklistItemId: 'model_classroom_0',
    category: '  Flooring ',
    name: 'Main  Flooring',
  };
  const modelDestination = {
    ...destination,
    items: [{
      id: 'overall-flooring-status',
      checklistItemId: 'overall_classroom_0',
      category: 'flooring',
      name: ' main flooring ',
    }],
  };

  assert.equal(
    getBulkTargetIssue(modelDestination, modelSource, { sourceSpaceType: 'model_classroom' }),
    null,
  );
  const modelPayload = buildBulkUpdate(
    modelSource,
    [modelDestination],
    MODEL_CLASSROOM_COPY_FIELDS,
    { sourceSpaceType: 'model_classroom', skipBlankValues: true },
  );
  assert.deepEqual(modelPayload.targetStatusIds, ['overall-flooring-status']);
  assert.equal(modelPayload.sourceSpaceType, 'model_classroom');

  assert.match(
    getBulkTargetIssue(modelDestination, modelSource),
    /does not have this checklist item/i,
  );
  assert.match(
    getBulkTargetIssue({
      ...modelDestination,
      items: [
        ...modelDestination.items,
        {
          id: 'overall-flooring-status-duplicate',
          checklistItemId: 'overall_classroom_1',
          category: 'FLOORING',
          name: 'Main Flooring',
        },
      ],
    }, modelSource, { sourceSpaceType: 'model_classroom' }),
    /ambiguous/i,
  );
});

test('result summary does not call zero or skipped destinations success', () => {
  assert.equal(getBulkResultSummary({ applied: 0, skipped: 0 }, 1).complete, false);
  const partial = getBulkResultSummary({
    applied: 1,
    skipped: 1,
    results: [
      { statusId: 'target-status', outcome: 'applied' },
      { statusId: 'target-status-2', outcome: 'skipped' },
    ],
  }, 2);
  assert.deepEqual(
    { successful: partial.successful, skipped: partial.skipped, complete: partial.complete },
    { successful: 1, skipped: 1, complete: false },
  );
  const unchanged = getBulkResultSummary({
    applied: 1,
    skipped: 0,
    results: [{ statusId: 'target-status', outcome: 'unchanged' }],
  }, 1);
  assert.equal(unchanged.successful, 1);
  assert.equal(unchanged.complete, true);
});

test('result summary requires the exact requested target status ids', () => {
  const expected = ['target-status', 'target-status-2'];
  const exact = getBulkResultSummary({
    results: [
      { statusId: 'target-status', outcome: 'applied' },
      { statusId: 'target-status-2', outcome: 'unchanged' },
    ],
  }, 2, expected);
  assert.equal(exact.targetIdsMatch, true);
  assert.equal(exact.complete, true);

  const duplicate = getBulkResultSummary({
    results: [
      { statusId: 'target-status', outcome: 'applied' },
      { statusId: 'target-status', outcome: 'unchanged' },
    ],
  }, 2, expected);
  assert.equal(duplicate.targetIdsMatch, false);
  assert.equal(duplicate.complete, false);

  const unexpected = getBulkResultSummary({
    results: [
      { statusId: 'target-status', outcome: 'applied' },
      { statusId: 'unexpected-status', outcome: 'unchanged' },
    ],
  }, 2, expected);
  assert.equal(unexpected.targetIdsMatch, false);
  assert.equal(unexpected.complete, false);

  const countersOnly = getBulkResultSummary({ applied: 2, skipped: 0 }, 2, expected);
  assert.equal(countersOnly.targetIdsMatch, false);
  assert.equal(countersOnly.complete, false);
});

test('busy copy errors give explicit retry guidance without classroom-association advice', () => {
  const guidance = getBulkApplyErrorGuidance({
    code: 'CHECKLIST_SAVE_BUSY',
    message: 'Checklist save is temporarily busy. No changes were saved; retry this save.',
    correlationId: 'corr-busy',
  });
  assert.equal(guidance.kind, 'busy');
  assert.equal(guidance.retryable, true);
  assert.match(guidance.message, /retry this copy/i);
  assert.match(guidance.message, /selections are still here/i);
  assert.doesNotMatch(guidance.message, /association/i);
  assert.doesNotMatch(
    formatBulkApplyError({
      code: 'CHECKLIST_SAVE_BUSY',
      message: 'Checklist save is temporarily busy.',
      correlationId: 'corr-busy',
    }).text,
    /verify classroom associations/i,
  );
});

test('association guidance is limited to association error codes', () => {
  const association = getBulkApplyErrorGuidance({
    code: 'CHECKLIST_CLASSROOM_ASSOCIATION_AMBIGUOUS',
  });
  const missingTarget = getBulkApplyErrorGuidance({
    code: 'CHECKLIST_BULK_TARGETS_MISSING',
  });
  assert.equal(association.kind, 'association');
  assert.match(association.message, /administrator.*association/i);
  assert.equal(missingTarget.kind, 'destination');
  assert.doesNotMatch(missingTarget.message, /administrator|association/i);
});

test('unknown copy failures warn that the outcome is unconfirmed instead of claiming rollback', () => {
  const guidance = getBulkApplyErrorGuidance(new Error('network disconnected'));
  assert.equal(guidance.outcome, 'unconfirmed');
  assert.equal(guidance.retryable, false);
  assert.match(guidance.message, /refresh.*before retrying/i);
  assert.doesNotMatch(guidance.message, /no changes were saved/i);
});

test('refresh-required copy failures are not directly retryable', () => {
  for (const code of [
    'CHECKLIST_SOURCE_CHANGED',
    'CHECKLIST_BULK_TARGETS_MISSING',
    'CHECKLIST_RELATED_RECORD_CHANGED',
    'CHECKLIST_SAVE_CONFLICT',
  ]) {
    const guidance = getBulkApplyErrorGuidance({ code });
    assert.equal(guidance.retryable, false, code);
    assert.match(guidance.message, /refresh|reopen/i, code);
  }
  assert.equal(getBulkApplyErrorGuidance({ code: 'CHECKLIST_SAVE_BUSY' }).retryable, true);
});
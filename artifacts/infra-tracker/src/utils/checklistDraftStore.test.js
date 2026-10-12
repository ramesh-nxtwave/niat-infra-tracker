import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  acknowledgeChecklistDraft,
  getChecklistDraft,
  getChecklistDraftFieldsForApiData,
  getPendingChecklistDrafts,
  getChecklistDraftSubmission,
  mergeChecklistItemDraft,
  recordChecklistDraft,
  resetChecklistDraftStoreForTests,
  setChecklistDraftOwner,
} from './checklistDraftStore';

const values = new Map();
globalThis.sessionStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
};

afterEach(() => {
  resetChecklistDraftStoreForTests();
  values.clear();
  setChecklistDraftOwner('anonymous');
});

test('keeps explicit blanks and ignores an acknowledgement for an older generation', () => {
  setChecklistDraftOwner('user-1');
  const item = { id: 'status-1', name: 'Generator', remarks: 'server note' };

  recordChecklistDraft('university-1', item, { remarks: '' });
  const older = getChecklistDraftSubmission('university-1', item.id);
  recordChecklistDraft('university-1', item, { remarks: 'newest draft' });
  acknowledgeChecklistDraft('university-1', older);

  assert.equal(mergeChecklistItemDraft('university-1', item).remarks, 'newest draft');
  assert.equal(getChecklistDraft('university-1', item.id).fields.remarks.value, 'newest draft');
});

test('clears outgoing user drafts when the authenticated identity changes', () => {
  setChecklistDraftOwner('user-1');
  recordChecklistDraft(
    'university-1',
    { id: 'status-1', name: 'Generator' },
    { remarks: 'user one draft' },
  );

  setChecklistDraftOwner('user-2');
  assert.equal(getChecklistDraft('university-1', 'status-1'), null);

  setChecklistDraftOwner('user-1');
  assert.equal(getChecklistDraft('university-1', 'status-1'), null);
});

test('storage failures never prevent recording an in-memory draft', () => {
  const original = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
    removeItem: () => { throw new Error('storage disabled'); },
  };
  try {
    assert.doesNotThrow(() => recordChecklistDraft(
      'university-1',
      { id: 'status-1', name: 'Generator' },
      { remarks: 'still editable' },
    ));
    assert.equal(getChecklistDraft('university-1', 'status-1').fields.remarks.value, 'still editable');
  } finally {
    globalThis.sessionStorage = original;
  }
});

test('pending draft checks can be scoped to the fields a copy will write', () => {
  setChecklistDraftOwner('user-1');
  const item = { id: 'status-1', name: 'Flooring' };
  recordChecklistDraft('university-1', item, {
    status: 'Done',
    remarks: 'current note',
  });

  assert.equal(
    getPendingChecklistDrafts('university-1', [item.id], ['remarks']).length,
    1,
  );
  assert.equal(
    getPendingChecklistDrafts('university-1', [item.id], ['photoLink']).length,
    0,
  );
  assert.deepEqual(
    getChecklistDraftFieldsForApiData({
      currentStatus: 'Done',
      remarks: 'current note',
      photoUrl: '/objects/flooring.jpg',
    }),
    ['status', 'remarks', 'photoLink'],
  );
});
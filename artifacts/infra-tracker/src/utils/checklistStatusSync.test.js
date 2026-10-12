import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveChecklistFieldAndRefresh,
  saveChecklistStatusAndRefresh,
} from './checklistStatusSync';

test('a saved checklist status refreshes the shared university percentage', async () => {
  const calls = [];
  const refreshed = await saveChecklistStatusAndRefresh({
    universityId: 'university-1',
    statusId: 'status-1',
    status: 'Done',
    patchChecklistStatus: async (universityId, statusId, payload) => {
      calls.push(['save', universityId, statusId, payload]);
    },
    loadUniversityDetail: async (universityId, force) => {
      calls.push(['refresh', universityId, force]);
    },
  });

  assert.equal(refreshed, true);
  assert.deepEqual(calls, [
    ['save', 'university-1', 'status-1', { currentStatus: 'Done', isBlocker: false }],
    ['refresh', 'university-1', true],
  ]);
});

test('a failed summary refresh does not report the already-saved status as failed', async () => {
  const refreshed = await saveChecklistStatusAndRefresh({
    universityId: 'university-1',
    statusId: 'status-1',
    status: 'Blocker',
    patchChecklistStatus: async () => {},
    loadUniversityDetail: async () => {
      throw new Error('temporary refresh failure');
    },
  });

  assert.equal(refreshed, false);
});

test('clearing a university timeline is persisted before refreshing the checklist', async () => {
  const calls = [];
  const refreshed = await saveChecklistFieldAndRefresh({
    universityId: 'university-1',
    statusId: 'status-1',
    data: { universityTimeline: '' },
    patchChecklistStatus: async (universityId, statusId, payload) => {
      calls.push(['save', universityId, statusId, payload]);
    },
    loadUniversityDetail: async (universityId, force) => {
      calls.push(['refresh', universityId, force]);
    },
  });

  assert.equal(refreshed, true);
  assert.deepEqual(calls, [
    ['save', 'university-1', 'status-1', { universityTimeline: '' }],
    ['refresh', 'university-1', true],
  ]);
});
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checklistSaveFailureError,
  runBoundedChecklistSaves,
  runBoundedChecklistSaveTask,
  runRegisteredBoundedChecklistSaves,
} from './boundedChecklistSave';
import {
  enqueueChecklistRemarkSave,
  resetChecklistRemarkSaveQueueForTests,
} from './checklistRemarkSaveQueue';

describe('runBoundedChecklistSaves', () => {
  it('never exceeds the requested concurrency and attempts every item', async () => {
    let active = 0;
    let peak = 0;
    const attempted = [];
    const items = Array.from({ length: 20 }, (_, index) => ({ id: `status-${index}` }));

    const result = await runBoundedChecklistSaves(items, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      attempted.push(item.id);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
    }, 3);

    assert(peak <= 3);
    assert.equal(attempted.length, items.length);
    assert.equal(result.succeeded.length, items.length);
    assert.deepEqual(result.failed, []);
  });

  it('collects individual failures without stopping the remaining saves', async () => {
    let calls = 0;
    const save = async (item) => {
      calls += 1;
      if (item.id === 'status-2' || item.id === 'status-4') {
        throw new Error(`failed ${item.id}`);
      }
    };
    const items = Array.from({ length: 5 }, (_, index) => ({ id: `status-${index + 1}` }));

    const result = await runBoundedChecklistSaves(items, save, 2);
    const error = checklistSaveFailureError(result.failed, items.length);

    assert.equal(calls, items.length);
    assert.equal(result.succeeded.length, 3);
    assert.deepEqual(result.failed.map(({ item }) => item.id), ['status-2', 'status-4']);
    assert.deepEqual(error.failedStatusIds, ['status-2', 'status-4']);
    assert.match(error.message, /2 of 5 checklist items failed to save/);
  });

  it('carries safe API correlation metadata into failed checklist feedback', () => {
    const failure = new Error('transaction busy');
    failure.correlationId = 'corr-checklist-1';
    const error = checklistSaveFailureError([
      { item: { id: 'status-1', name: 'Generator' }, error: failure },
    ], 1);

    assert.equal(error.correlationId, 'corr-checklist-1');
    assert.deepEqual(error.correlationIds, ['corr-checklist-1']);
    assert.deepEqual(error.failedItems, [{ id: 'status-1', name: 'Generator' }]);
  });

  it('registers every full-save snapshot before a newer autosave can overtake it', async () => {
    resetChecklistRemarkSaveQueueForTests();
    const persisted = [];
    let releaseFirst;
    const firstHeld = new Promise(resolve => { releaseFirst = resolve; });
    const items = [
      { id: 'first', remarks: 'first old snapshot' },
      { id: 'later', remarks: 'later old snapshot' },
    ];

    const fullSave = runRegisteredBoundedChecklistSaves(
      items,
      (item, execute) => enqueueChecklistRemarkSave(
        `university:${item.id}`,
        item.remarks,
        () => execute(async () => {
          if (item.id === 'first') await firstHeld;
          persisted.push(`${item.id}:${item.remarks}`);
        }),
        { coalesce: false },
      ),
      1,
    );
    await new Promise(resolve => setImmediate(resolve));

    const newerAutosave = enqueueChecklistRemarkSave(
      'university:later',
      'new user draft',
      async () => { persisted.push('later:new user draft'); },
    );
    releaseFirst();
    await Promise.all([fullSave, newerAutosave]);

    assert.deepEqual(persisted, [
      'first:first old snapshot',
      'later:later old snapshot',
      'later:new user draft',
    ]);
  });

  it('keeps a newer status change behind an already requested full-save snapshot', async () => {
    resetChecklistRemarkSaveQueueForTests();
    const persistedStatus = new Map();
    let releaseFirst;
    const firstHeld = new Promise(resolve => { releaseFirst = resolve; });
    const items = [
      { id: 'first', status: 'Yet to start' },
      { id: 'later', status: 'Yet to start' },
    ];

    const fullSave = runRegisteredBoundedChecklistSaves(
      items,
      (item, execute) => enqueueChecklistRemarkSave(
        `university:${item.id}`,
        undefined,
        () => execute(async () => {
          if (item.id === 'first') await firstHeld;
          persistedStatus.set(item.id, item.status);
        }),
        { coalesce: false },
      ),
      1,
    );
    await new Promise(resolve => setImmediate(resolve));

    const newerStatusSave = enqueueChecklistRemarkSave(
      'university:later',
      undefined,
      async () => { persistedStatus.set('later', 'Done'); },
      { coalesce: false },
    );
    releaseFirst();
    await Promise.all([fullSave, newerStatusSave]);

    assert.equal(persistedStatus.get('later'), 'Done');
  });

  it('admits only one autosave or manual write per university at a time', async () => {
    let activeForUniversity = 0;
    let peakForUniversity = 0;
    const tasks = Array.from({ length: 8 }, () =>
      runBoundedChecklistSaveTask(async () => {
        activeForUniversity += 1;
        peakForUniversity = Math.max(peakForUniversity, activeForUniversity);
        await new Promise(resolve => setTimeout(resolve, 2));
        activeForUniversity -= 1;
      }, 'university-1'));

    await Promise.all(tasks);
    assert.equal(peakForUniversity, 1);
  });
});
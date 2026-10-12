import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueChecklistRemarkSave,
  enqueueChecklistBatchSave,
  resetChecklistRemarkSaveQueueForTests,
} from './checklistRemarkSaveQueue.js';

test('serializes saves for one checklist item so the newest note is retained', async () => {
  resetChecklistRemarkSaveQueueForTests();
  const persisted = [];
  let releaseOlder;

  const older = enqueueChecklistRemarkSave('university:item', 'partial phrase', async () => {
    await new Promise(resolve => { releaseOlder = resolve; });
    persisted.push('partial phrase');
  });
  const newer = enqueueChecklistRemarkSave('university:item', 'complete phrase', async () => {
    persisted.push('complete phrase');
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(persisted, []);
  releaseOlder();
  await Promise.all([older, newer]);
  assert.deepEqual(persisted, ['partial phrase', 'complete phrase']);
});

test('continues with the newest save after an older save fails', async () => {
  resetChecklistRemarkSaveQueueForTests();
  const persisted = [];
  const older = enqueueChecklistRemarkSave('university:item', 'partial phrase', async () => {
    throw new Error('offline');
  });
  const newer = enqueueChecklistRemarkSave('university:item', 'current draft', async () => {
    persisted.push('current draft');
  });

  await assert.rejects(older, /offline/);
  await newer;
  assert.deepEqual(persisted, ['current draft']);
});

test('allows retrying the same draft after its prior request failed', async () => {
  resetChecklistRemarkSaveQueueForTests();
  let attempts = 0;
  const save = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('transaction busy');
  };

  await assert.rejects(
    enqueueChecklistRemarkSave('university:item', 'same current draft', save),
    /transaction busy/,
  );
  await enqueueChecklistRemarkSave('university:item', 'same current draft', save);
  assert.equal(attempts, 2);
});

test('coalesces debounce and blur saves for the same latest note', async () => {
  resetChecklistRemarkSaveQueueForTests();
  let calls = 0;
  const save = () => {
    calls += 1;
  };

  const debounce = enqueueChecklistRemarkSave('university:item', 'same draft', save);
  const blur = enqueueChecklistRemarkSave('university:item', 'same draft', save);

  assert.equal(debounce, blur);
  await blur;
  assert.equal(calls, 1);
});

test('allows a full-checklist save to follow an identical remark autosave', async () => {
  resetChecklistRemarkSaveQueueForTests();
  const calls = [];

  const autosave = enqueueChecklistRemarkSave(
    'university:item',
    'same draft',
    async () => { calls.push('autosave'); },
  );
  const fullSave = enqueueChecklistRemarkSave(
    'university:item',
    'same draft',
    async () => { calls.push('full save'); },
    { coalesce: false },
  );

  await Promise.all([autosave, fullSave]);
  assert.deepEqual(calls, ['autosave', 'full save']);
});

test('does not treat an old completed value as proof of the current server value', async () => {
  resetChecklistRemarkSaveQueueForTests();
  let serverRemark = '';

  await enqueueChecklistRemarkSave(
    'university:item',
    'note A',
    async () => { serverRemark = 'note A'; },
  );
  serverRemark = 'note B';
  await enqueueChecklistRemarkSave(
    'university:item',
    'note A',
    async () => { serverRemark = 'note A'; },
  );

  assert.equal(serverRemark, 'note A');
});

test('places a bulk target write behind pending item saves and later edits behind the bulk write', async () => {
  resetChecklistRemarkSaveQueueForTests();
  const order = [];
  let releasePending;
  const pending = enqueueChecklistRemarkSave('university:target', 'pending edit', async () => {
    await new Promise(resolve => { releasePending = resolve; });
    order.push('pending edit');
  });
  const bulk = enqueueChecklistBatchSave(['university:target'], async () => {
    order.push('bulk');
  });
  const newest = enqueueChecklistRemarkSave('university:target', 'newest edit', async () => {
    order.push('newest edit');
  });

  await new Promise(resolve => setImmediate(resolve));
  releasePending();
  await Promise.all([pending, bulk, newest]);
  assert.deepEqual(order, ['pending edit', 'bulk', 'newest edit']);
});
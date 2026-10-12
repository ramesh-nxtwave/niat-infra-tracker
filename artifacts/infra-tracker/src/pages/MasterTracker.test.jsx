import assert from 'node:assert/strict';
import test from 'node:test';
import { runMasterTrackerRefresh } from './MasterTracker';

test('Refresh requests fresh university data and stays loading until it finishes', async () => {
  let finishRefresh;
  const refreshRequest = new Promise(resolve => {
    finishRefresh = resolve;
  });
  const loadingStates = [];
  let requestCount = 0;

  const clickRefresh = runMasterTrackerRefresh(
    () => {
      requestCount += 1;
      return refreshRequest;
    },
    value => loadingStates.push(value),
  );

  assert.equal(requestCount, 1);
  assert.deepEqual(loadingStates, [true]);

  finishRefresh();
  await clickRefresh;

  assert.deepEqual(loadingStates, [true, false]);
});
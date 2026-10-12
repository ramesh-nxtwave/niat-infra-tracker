const queues = new Map();
const timers = new Map();

export function checklistRemarkSaveKey(universityId, statusId) {
  return `${universityId}:${statusId}`;
}

export function enqueueChecklistRemarkSave(key, remarks, save, { coalesce = true } = {}) {
  const queued = queues.get(key);
  if (coalesce && queued?.remarks === remarks) return queued.promise;

  const previous = queued?.promise || Promise.resolve();
  const current = previous.catch(() => undefined).then(save);
  const entry = { remarks, promise: current };
  queues.set(key, entry);
  current.finally(() => {
    if (queues.get(key) === entry) queues.delete(key);
  }).catch(() => undefined);
  return current;
}

export function enqueueChecklistBatchSave(keys, save) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (uniqueKeys.length === 0) return Promise.resolve().then(save);

  const previous = [...new Set(uniqueKeys
    .map(key => queues.get(key)?.promise)
    .filter(Boolean))];
  const current = Promise.all(previous.map(promise => promise.catch(() => undefined))).then(save);
  const entries = uniqueKeys.map(key => {
    const entry = { remarks: undefined, promise: current };
    queues.set(key, entry);
    return [key, entry];
  });
  current.finally(() => {
    entries.forEach(([key, entry]) => {
      if (queues.get(key) === entry) queues.delete(key);
    });
  }).catch(() => undefined);
  return current;
}

export function hasPendingChecklistSave(key) {
  return queues.has(key) || timers.has(key);
}

export function waitForChecklistSaveIdle(key, pollInterval = 25) {
  return new Promise(resolve => {
    const check = () => {
      if (!hasPendingChecklistSave(key)) {
        resolve();
        return;
      }
      setTimeout(check, pollInterval);
    };
    check();
  });
}

// Consumers that already have a complete item snapshot can wait for a live
// remark writer without creating another request.  This intentionally exposes
// only the current queue entry; completed values must never be used to
// suppress a future write.
export function getChecklistRemarkSaveState(key) {
  const queued = queues.get(key);
  if (!queued) return null;
  return { remarks: queued.remarks, promise: queued.promise };
}

export function scheduleChecklistRemarkSave(key, save, delay) {
  cancelChecklistRemarkSaveTimer(key);
  const timer = setTimeout(() => {
    if (timers.get(key) === timer) timers.delete(key);
    save();
  }, delay);
  timers.set(key, timer);
}

export function cancelChecklistRemarkSaveTimer(key) {
  const timer = timers.get(key);
  if (!timer) return false;
  clearTimeout(timer);
  timers.delete(key);
  return true;
}

export function resetChecklistRemarkSaveQueueForTests() {
  queues.clear();
  timers.forEach(clearTimeout);
  timers.clear();
}
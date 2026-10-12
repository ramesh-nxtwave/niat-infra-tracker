const GLOBAL_CHECKLIST_SAVE_CONCURRENCY = 4;
let globalActive = 0;
const activeScopes = new Set();
const globalWaiting = [];

function startWaitingChecklistSaves() {
  while (globalActive < GLOBAL_CHECKLIST_SAVE_CONCURRENCY) {
    const index = globalWaiting.findIndex(entry => !activeScopes.has(entry.scope));
    if (index < 0) return;
    const [entry] = globalWaiting.splice(index, 1);
    globalActive += 1;
    activeScopes.add(entry.scope);
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        globalActive -= 1;
        activeScopes.delete(entry.scope);
        startWaitingChecklistSaves();
      });
  }
}

export function runBoundedChecklistSaveTask(task, scope = 'global') {
  return new Promise((resolve, reject) => {
    globalWaiting.push({ task, scope: String(scope), resolve, reject });
    startWaitingChecklistSaves();
  });
}

export async function runBoundedChecklistSaves(items, saveItem, concurrency = 4) {
  if (!Array.isArray(items) || items.length === 0) {
    return { succeeded: [], failed: [] };
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const succeeded = [];
  const failed = [];
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];

      try {
        await saveItem(item);
        succeeded.push(item);
      } catch (error) {
        failed.push({ item, error });
      }
    }
  });

  await Promise.all(workers);
  return { succeeded, failed };
}

export async function runRegisteredBoundedChecklistSaves(
  items,
  registerSave,
  concurrency = 4,
) {
  if (!Array.isArray(items) || items.length === 0) {
    return { succeeded: [], failed: [] };
  }

  const limit = Math.max(1, concurrency);
  const waiting = [];
  let active = 0;
  const execute = task => new Promise((resolve, reject) => {
    const start = () => {
      active += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          waiting.shift()?.();
        });
    };
    if (active < limit) start();
    else waiting.push(start);
  });

  // Registration is intentionally synchronous for every item. This places the
  // full-save snapshot into each per-item queue before a later autosave can
  // overtake it; only the network execution is concurrency-limited.
  const attempts = items.map(item => {
    try {
      return Promise.resolve(registerSave(item, execute));
    } catch (error) {
      return Promise.reject(error);
    }
  });
  const settled = await Promise.allSettled(attempts);
  const succeeded = [];
  const failed = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') succeeded.push(items[index]);
    else failed.push({ item: items[index], error: result.reason });
  });
  return { succeeded, failed };
}

export function checklistSaveFailureError(failed, total) {
  const count = failed.length;
  const error = new Error(
    `${count} of ${total} checklist item${total === 1 ? '' : 's'} failed to save. Retry Save Checklist to try them again.`,
  );
  error.name = 'ChecklistSaveError';
  error.failedStatusIds = failed.map(({ item }) => item.id).filter(Boolean);
  error.failedItems = failed.map(({ item }) => ({
    id: item.id,
    name: item.name || item.label || item.id,
  }));
  error.failures = failed;
  error.correlationIds = [...new Set(failed
    .map(({ error: failure }) => failure?.correlationId)
    .filter(Boolean))];
  error.correlationId = error.correlationIds[0];
  return error;
}
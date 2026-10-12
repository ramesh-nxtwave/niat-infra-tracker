import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React, { useState } from 'react';
import { JSDOM } from 'jsdom';
import { resetChecklistRemarkSaveQueueForTests } from '../../utils/checklistRemarkSaveQueue';
import ChecklistRemarkField from './ChecklistRemarkField';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://infra.example.test',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});

const { act, cleanup, fireEvent, render, waitFor } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  resetChecklistRemarkSaveQueueForTests();
});

function FieldHarness({ patchChecklistStatus, showToast = () => undefined, onRemarkSaved = () => undefined }) {
  const [item, setItem] = useState({
    id: 'status-1',
    status: 'In-Progress',
    remarks: '',
  });
  const onUpdateItem = (_id, updates) => {
    setItem(current => ({ ...current, ...updates }));
  };

  return (
    <ChecklistRemarkField
      item={item}
      universityId="university-1"
      patchChecklistStatus={patchChecklistStatus}
      onUpdateItem={onUpdateItem}
      showToast={showToast}
      onRemarkSaved={onRemarkSaved}
    />
  );
}

test('an older save response cannot replace a newer visible draft', async () => {
  let releaseOlder;
  let releaseNewer;
  const requests = [];
  const patchChecklistStatus = async (_universityId, _statusId, { remarks }) => {
    requests.push(remarks);
    await new Promise(resolve => {
      if (remarks === 'partial phrase') releaseOlder = resolve;
      else releaseNewer = resolve;
    });
  };
  const view = render(<FieldHarness patchChecklistStatus={patchChecklistStatus} />);
  const textarea = view.getByLabelText('Audit Remarks / Field Notes');

  fireEvent.change(textarea, { target: { value: 'partial phrase' } });
  fireEvent.blur(textarea);
  await waitFor(() => assert.equal(typeof releaseOlder, 'function'));

  fireEvent.change(textarea, { target: { value: 'complete phrase' } });
  fireEvent.blur(textarea);
  releaseOlder();
  await waitFor(() => assert.equal(typeof releaseNewer, 'function'));

  assert.equal(textarea.value, 'complete phrase');
  releaseNewer();
  await waitFor(() => assert.deepEqual(requests, ['partial phrase', 'complete phrase']));
  assert.equal(textarea.value, 'complete phrase');
  assert.equal(view.queryByRole('alert'), null);
});

test('an older save response cannot open a bulk-copy confirmation for stale remarks', async () => {
  let releaseOlder;
  let releaseNewer;
  const confirmations = [];
  const patchChecklistStatus = async (_universityId, _statusId, { remarks }) => {
    await new Promise(resolve => {
      if (remarks === 'old note') releaseOlder = resolve;
      else releaseNewer = resolve;
    });
  };
  const view = render(
    <FieldHarness
      patchChecklistStatus={patchChecklistStatus}
      onRemarkSaved={remarks => confirmations.push(remarks)}
    />,
  );
  const textarea = view.getByLabelText('Audit Remarks / Field Notes');

  fireEvent.change(textarea, { target: { value: 'old note' } });
  fireEvent.blur(textarea);
  await waitFor(() => assert.equal(typeof releaseOlder, 'function'));
  fireEvent.change(textarea, { target: { value: 'latest note' } });
  fireEvent.blur(textarea);
  releaseOlder();
  await waitFor(() => assert.equal(typeof releaseNewer, 'function'));
  assert.deepEqual(confirmations, []);

  releaseNewer();
  await waitFor(() => assert.deepEqual(confirmations, ['latest note']));
});

test('a failed save leaves the current draft visible and reports it as unsaved', async () => {
  const toasts = [];
  const view = render(
    <FieldHarness
      patchChecklistStatus={async () => { throw new Error('offline'); }}
      showToast={(message, type) => toasts.push({ message, type })}
    />,
  );
  const textarea = view.getByLabelText('Audit Remarks / Field Notes');

  fireEvent.change(textarea, { target: { value: 'keep this draft' } });
  fireEvent.blur(textarea);

  await waitFor(() => assert.equal(toasts.length, 1));
  assert.equal(textarea.value, 'keep this draft');
  assert.equal(toasts[0].type, 'error');
  assert.match(toasts[0].message, /draft is still visible/i);
});

test('retrying the current remark clears the failure after a successful commit', async () => {
  let attempts = 0;
  const view = render(
    <FieldHarness
      patchChecklistStatus={async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('transaction busy');
          error.correlationId = 'corr-remark-1';
          throw error;
        }
      }}
    />,
  );
  const textarea = view.getByLabelText('Audit Remarks / Field Notes');
  fireEvent.change(textarea, { target: { value: 'retry this note' } });
  fireEvent.blur(textarea);
  await waitFor(() => assert.match(view.getByRole('alert').textContent, /corr-remark-1/));

  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Retry remark' }));
    await new Promise(resolve => setImmediate(resolve));
  });
  assert.equal(view.queryByRole('alert'), null);
  assert.equal(attempts, 2);
  assert.equal(textarea.value, 'retry this note');
});
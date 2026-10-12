import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { AuthProvider } from '../../context/AuthContext';
import { DataProvider } from '../../context/DataContext';
import { ToastProvider } from '../../context/ToastContext';
import ModelClassroomForm from './ModelClassroomForm';
import Lab5Form from './Lab5Form';
import StaffRoomForm from './StaffRoomForm';
import { resetChecklistDraftStoreForTests } from '../../utils/checklistDraftStore';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://infra.example.test',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});

const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetChecklistDraftStoreForTests();
});

const formData = {
  spaceId: 'space-1',
  remarks: '',
  items: [{
    id: 'status-1',
    checklistItemId: 'item-1',
    name: 'Generator',
    category: 'Electrical',
    sortOrder: 1,
    status: 'In-Progress',
    remarks: '',
    requiresCapacity: true,
    capacity: '10 KVA',
  }],
};

for (const [name, Form] of [
  ['Model Classroom', ModelClassroomForm],
  ['Lab', Lab5Form],
  ['Staff Room', StaffRoomForm],
]) {
  test(`${name} host prevents duplicate submits and labels failed items for retry`, async () => {
    let calls = 0;
    let statusCalls = 0;
    let release;
    let submittedStatus;
    globalThis.fetch = async () => {
      statusCalls += 1;
      return {
        status: 503,
        ok: false,
        json: async () => ({
          error: 'transaction busy',
          code: 'TX_BUSY',
          correlationId: `corr-${name}`,
        }),
      };
    };
    const failure = new Error('write failed');
    failure.failedItems = [{ id: 'status-1', name: 'Generator' }];
    const onSave = async payload => {
      calls += 1;
      submittedStatus = payload.items[0].status;
      await new Promise(resolve => { release = resolve; });
      return { ok: false, error: failure };
    };
    const view = render(
      <AuthProvider>
        <DataProvider>
          <ToastProvider>
            <Form data={formData} universityId="university-1" onSave={onSave} />
          </ToastProvider>
        </DataProvider>
      </AuthProvider>,
    );
    fireEvent.click(view.getByText('Electrical'));
    const status = view.container.querySelector('select');
    fireEvent.change(status, { target: { value: 'Done' } });
    await waitFor(() => assert.equal(statusCalls, 1));
    assert.equal(status.value, 'Done');

    const save = view.getByRole('button', { name: /Save Checklist/i });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => assert.equal(typeof release, 'function'));
    assert.equal(calls, 1);
    assert.equal(submittedStatus, 'Done');
    release();
    await waitFor(() => assert(
      view.getAllByRole('alert').some(alert => /Not saved: Generator/.test(alert.textContent)),
    ));
    assert(view.getByRole('button', { name: /Retry unsaved changes/i }));
  });
}

test('a Model Classroom item draft survives an unmount and remount', () => {
  const wrap = child => (
    <AuthProvider>
      <DataProvider>
        <ToastProvider>{child}</ToastProvider>
      </DataProvider>
    </AuthProvider>
  );
  const first = render(wrap(
    <ModelClassroomForm data={formData} universityId="university-1" onSave={async () => ({ ok: true })} />,
  ));
  fireEvent.click(first.getByText('Electrical'));
  fireEvent.change(first.getByPlaceholderText('e.g. 62.5 KVA'), {
    target: { value: '62.5 KVA' },
  });
  first.unmount();

  const second = render(wrap(
    <ModelClassroomForm data={formData} universityId="university-1" onSave={async () => ({ ok: true })} />,
  ));
  fireEvent.click(second.getByText('Electrical'));
  assert.equal(second.getByPlaceholderText('e.g. 62.5 KVA').value, '62.5 KVA');
});
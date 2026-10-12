import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React, { useState } from 'react';
import { JSDOM } from 'jsdom';
import { AuthProvider } from '../../context/AuthContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import { DataProvider } from '../../context/DataContext';
import { ToastProvider } from '../../context/ToastContext';
import OverallClassroomForm from './OverallClassroomForm';
import { resetChecklistDraftStoreForTests } from '../../utils/checklistDraftStore';
import { MODEL_CLASSROOM_ID } from '../../utils/checklistDestination';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://infra.example.test',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});

const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  resetChecklistDraftStoreForTests();
});

const serverData = {
  classrooms: [{
    id: 'classroom-1',
    room_id: 'Room 101',
    spaceId: 'space-1',
    items: [{
      id: 'status-1',
      checklistItemId: 'item-1',
      name: 'Generator',
      category: 'Electrical',
      status: 'In-Progress',
      itemStartDate: '2026-09-01',
      capacity: '10 KVA',
      requiresCapacity: true,
    }],
  }],
};

const queuedPromptData = {
  classrooms: [{
    id: 'classroom-1',
    room_id: 'Room 101',
    spaceId: 'space-1',
    items: [
      {
        id: 'status-1',
        checklistItemId: 'item-1',
        name: 'Generator',
        category: 'Electrical',
        status: 'In-Progress',
      },
      {
        id: 'status-2',
        checklistItemId: 'item-2',
        name: 'Switchboard',
        category: 'Electrical',
        status: 'In-Progress',
      },
    ],
  }],
};

const queuedPromptDestinations = [{
  id: 'classroom-2',
  room_id: 'Room 202',
  spaceId: 'space-2',
  items: [
    {
      id: 'target-status-1',
      checklistItemId: 'item-1',
      name: 'Generator',
      category: 'Electrical',
      status: 'Yet to start',
    },
    {
      id: 'target-status-2',
      checklistItemId: 'item-2',
      name: 'Switchboard',
      category: 'Electrical',
      status: 'Yet to start',
    },
  ],
}];

function FailedSaveHarness({ attempts }) {
  const [data, setData] = useState(serverData);
  const onSave = async (draft) => {
    const item = draft.classrooms[0].items[0];
    attempts.push({
      itemStartDate: item.itemStartDate,
      capacity: item.capacity,
    });
    setData({
      classrooms: [{
        ...serverData.classrooms[0],
        items: serverData.classrooms[0].items.map(serverItem => ({ ...serverItem })),
      }],
    });
    return false;
  };

  return <OverallClassroomForm data={data} universityId="university-1" onSave={onSave} />;
}

test('a failed classroom save preserves date and capacity drafts for retry', async () => {
  const attempts = [];
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <FailedSaveHarness attempts={attempts} />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );

  fireEvent.click(view.getByText('Electrical'));
  const startDate = view.container.querySelector('input[type="date"]');
  const capacity = view.getByPlaceholderText('e.g. 62.5 KVA');
  const saveButton = view.getByRole('button', { name: /Save Room 101 Checklist/i });

  fireEvent.change(startDate, { target: { value: '2026-09-15' } });
  fireEvent.change(capacity, { target: { value: '62.5 KVA' } });
  fireEvent.click(saveButton);

  await waitFor(() => assert.equal(attempts.length, 1));
  assert.equal(startDate.value, '2026-09-15');
  assert.equal(capacity.value, '62.5 KVA');
  assert.equal(view.queryByText('Classroom checklist saved successfully!'), null);
  assert.equal(view.queryByText('Apply to Other Classrooms'), null);

  await waitFor(() => assert.equal(saveButton.disabled, false));
  fireEvent.click(saveButton);
  await waitFor(() => assert.equal(attempts.length, 2));
  assert.deepEqual(attempts, [
    { itemStartDate: '2026-09-15', capacity: '62.5 KVA' },
    { itemStartDate: '2026-09-15', capacity: '62.5 KVA' },
  ]);
});

test('rapid committed changes queue item prompts with fresh scope state', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url === '/api/universities/university-1/status/status-1'
      || url === '/api/universities/university-1/status/status-2') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'university-1', spaces: [], classrooms: [] }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <AuthProvider>
        <DataProvider>
          <ToastProvider>
            <ConfirmProvider>
              <OverallClassroomForm
                data={{ classrooms: [...queuedPromptData.classrooms, ...queuedPromptDestinations] }}
                universityId="university-1"
                onSave={async () => ({ ok: true })}
              />
            </ConfirmProvider>
          </ToastProvider>
        </DataProvider>
      </AuthProvider>,
    );
    fireEvent.click(view.getByText('Electrical'));
    const statuses = view.container.querySelectorAll('select');
    fireEvent.change(statuses[0], { target: { value: 'Done' } });
    fireEvent.change(statuses[1], { target: { value: 'Blocker' } });

    const firstDialog = await view.findByRole('dialog');
    assert.match(firstDialog.textContent, /Generator/);
    fireEvent.click(view.getByText('Selected classrooms'));
    fireEvent.click(view.getByRole('button', { name: 'None' }));
    assert.ok(view.getByText('0 / 1 selected'));
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => assert.match(view.getByRole('dialog').textContent, /Switchboard/));
    fireEvent.click(view.getByText('Selected classrooms'));
    // A new queued prompt must not inherit the first prompt's cleared scope.
    assert.ok(view.getByText('1 / 1 selected'));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Only this classroom closes after the selected status is saved without starting a bulk copy', async () => {
  const previousFetch = globalThis.fetch;
  const statusPayloads = [];
  let bulkCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities/university-1/status/status-1') {
      statusPayloads.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1/status/bulk') {
      bulkCalls += 1;
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    }
    if (url === '/api/universities/university-1') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'university-1', spaces: [], classrooms: [] }),
      };
    }
    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${url}`);
  };

  try {
    const view = render(
      <AuthProvider>
        <DataProvider>
          <ToastProvider>
            <ConfirmProvider>
              <OverallClassroomForm
                data={{ classrooms: [...queuedPromptData.classrooms, ...queuedPromptDestinations] }}
                universityId="university-1"
                onSave={async () => ({ ok: true })}
              />
            </ConfirmProvider>
          </ToastProvider>
        </DataProvider>
      </AuthProvider>,
    );
    fireEvent.click(view.getByText('Electrical'));
    const status = view.container.querySelector('select');
    fireEvent.change(status, { target: { value: 'Blocker' } });

    await view.findByRole('dialog');
    assert.deepEqual(statusPayloads, [{
      currentStatus: 'Blocker',
      isBlocker: true,
    }]);
    assert.equal(status.value, 'Blocker');

    fireEvent.click(view.getByText('Only this classroom'));
    await waitFor(() => assert.equal(view.queryByRole('dialog'), null));
    assert.equal(bulkCalls, 0);
    assert.equal(status.value, 'Blocker');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a status prompt waits for a newer remark to finish saving', async () => {
  const previousFetch = globalThis.fetch;
  let releaseStatus;
  const savedPayloads = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities/university-1/status/status-1') {
      const payload = JSON.parse(options.body);
      savedPayloads.push(payload);
      if (payload.currentStatus) {
        await new Promise(resolve => { releaseStatus = resolve; });
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'university-1', spaces: [], classrooms: [] }),
      };
    }
    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${url}`);
  };

  try {
    const view = render(
      <AuthProvider>
        <DataProvider>
          <ToastProvider>
            <ConfirmProvider>
              <OverallClassroomForm
                data={{ classrooms: [...queuedPromptData.classrooms, ...queuedPromptDestinations] }}
                universityId="university-1"
                onSave={async () => ({ ok: true })}
              />
            </ConfirmProvider>
          </ToastProvider>
        </DataProvider>
      </AuthProvider>,
    );
    fireEvent.click(view.getByText('Electrical'));
    fireEvent.change(view.container.querySelector('select'), {
      target: { value: 'Blocker' },
    });
    await waitFor(() => assert.equal(typeof releaseStatus, 'function'));

    fireEvent.change(view.getAllByLabelText('Audit Remarks / Field Notes')[0], {
      target: { value: 'Final registrar approval remark' },
    });
    assert.equal(view.queryByRole('dialog'), null);

    releaseStatus();
    await waitFor(() => assert.ok(
      savedPayloads.some(payload => payload.remarks === 'Final registrar approval remark'),
    ));
    await view.findByRole('dialog');
    assert.deepEqual(savedPayloads, [
      { currentStatus: 'Blocker', isBlocker: true },
      { remarks: 'Final registrar approval remark' },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('remark autosave does not interrupt typing and prompts only after blur', async () => {
  const previousFetch = globalThis.fetch;
  const remarkPayloads = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities/university-1/status/status-1') {
      const payload = JSON.parse(options.body);
      remarkPayloads.push(payload);
      return { ok: true, status: 200, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${url}`);
  };

  try {
    const view = render(
      <AuthProvider>
        <DataProvider>
          <ToastProvider>
            <ConfirmProvider>
              <OverallClassroomForm
                data={{ classrooms: [...queuedPromptData.classrooms, ...queuedPromptDestinations] }}
                universityId="university-1"
                onSave={async () => ({ ok: true })}
              />
            </ConfirmProvider>
          </ToastProvider>
        </DataProvider>
      </AuthProvider>,
    );
    fireEvent.click(view.getByText('Electrical'));
    const remarks = view.getAllByLabelText('Audit Remarks / Field Notes')[0];
    fireEvent.focus(remarks);
    fireEvent.change(remarks, {
      target: { value: 'Do not interrupt this remark' },
    });

    await waitFor(() => assert.deepEqual(remarkPayloads, [{
      remarks: 'Do not interrupt this remark',
    }]));
    assert.equal(view.queryByRole('dialog'), null);

    fireEvent.blur(remarks);
    await view.findByRole('dialog');
    assert.deepEqual(remarkPayloads, [{
      remarks: 'Do not interrupt this remark',
    }]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('ordinary item copy ignores an unrelated staged upload', async () => {
  const previousFetch = globalThis.fetch;
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  let bulkCalls = 0;
  globalThis.URL.createObjectURL = () => 'blob:unrelated-ordinary';
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities/university-1/status/status-1') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1/status/bulk') {
      bulkCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            statusId: 'target-status-1',
            outcome: 'applied',
            row: { currentStatus: 'Done' },
          }],
        }),
      };
    }
    if (url === '/api/universities/university-1') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'university-1', spaces: [], classrooms: [] }),
      };
    }
    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${url}`);
  };

  try {
    const view = render(
      <AuthProvider>
        <DataProvider>
          <ToastProvider>
            <ConfirmProvider>
              <OverallClassroomForm
                data={{ classrooms: [...queuedPromptData.classrooms, ...queuedPromptDestinations] }}
                universityId="university-1"
                onSave={async () => ({ ok: true })}
              />
            </ConfirmProvider>
          </ToastProvider>
        </DataProvider>
      </AuthProvider>,
    );
    fireEvent.click(view.getByText('Electrical'));
    const fileInputs = view.container.querySelectorAll('input[type="file"]');
    fireEvent.change(fileInputs[1], {
      target: { files: [new window.File(['unrelated'], 'unrelated.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => assert.ok(view.getByText('unrelated.jpg')));

    fireEvent.change(view.container.querySelector('select'), { target: { value: 'Done' } });
    const dialog = await view.findByRole('dialog');
    fireEvent.click(view.getByText('Selected classrooms'));
    fireEvent.click(view.getByRole('button', { name: /Apply to 1 destination room/i }));
    await waitFor(() => assert.equal(bulkCalls, 1));
    assert.doesNotMatch(dialog.textContent, /pending upload/i);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.URL.createObjectURL = previousCreateObjectURL;
  }
});

test('ordinary item copy blocks a staged upload on the source item', async () => {
  const previousFetch = globalThis.fetch;
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  let bulkCalls = 0;
  globalThis.URL.createObjectURL = () => 'blob:source-ordinary';
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities/university-1/status/status-1') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1/status/bulk') {
      bulkCalls += 1;
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    }
    if (url === '/api/universities/university-1') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'university-1', spaces: [], classrooms: [] }),
      };
    }
    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${url}`);
  };

  try {
    const view = render(
      <AuthProvider>
        <DataProvider>
          <ToastProvider>
            <ConfirmProvider>
              <OverallClassroomForm
                data={{ classrooms: [...queuedPromptData.classrooms, ...queuedPromptDestinations] }}
                universityId="university-1"
                onSave={async () => ({ ok: true })}
              />
            </ConfirmProvider>
          </ToastProvider>
        </DataProvider>
      </AuthProvider>,
    );
    fireEvent.click(view.getByText('Electrical'));
    const fileInputs = view.container.querySelectorAll('input[type="file"]');
    fireEvent.change(fileInputs[0], {
      target: { files: [new window.File(['source'], 'source.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => assert.ok(view.getByText('source.jpg')));

    fireEvent.change(view.container.querySelector('select'), { target: { value: 'Done' } });
    await view.findByRole('dialog');
    fireEvent.click(view.getByText('Selected classrooms'));
    fireEvent.click(view.getByRole('button', { name: /Apply to 1 destination room/i }));
    await waitFor(() => assert.match(
      view.getByRole('alert').textContent,
      /this source item has a pending upload/i,
    ));
    assert.equal(bulkCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.URL.createObjectURL = previousCreateObjectURL;
  }
});

test('All Classrooms keeps a model choice with model readiness and metadata', async () => {
  const modelClassroom = {
    items: [{
      id: 'model-status',
      checklistItemId: 'model-item',
      name: 'Model desks',
      category: 'Furniture',
      status: 'Done',
    }],
    roomNumber: 'Model A-101',
    remarks: 'Keep the demonstration layout.',
  };
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm
              data={serverData}
              modelClassroom={modelClassroom}
              initialClassroomId={MODEL_CLASSROOM_ID}
              universityId="university-1"
              onSave={async () => ({ ok: true })}
              onModelSave={async () => ({ ok: true })}
            />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );

  const modelChoice = view.getByRole('button', { name: /Model Classroom 100%/i });
  assert.ok(modelChoice);
  assert.equal(view.container.querySelector('input[name="roomNumber"]').value, 'Model A-101');
  assert.equal(view.getByPlaceholderText('Overall notes for this space...').value, 'Keep the demonstration layout.');
  assert.ok(view.getByRole('heading', { name: 'Model Classroom Tracker' }));

  fireEvent.click(view.getByRole('button', { name: /Room 101/i }));
  assert.equal(view.queryByRole('heading', { name: 'Model Classroom Tracker' }), null);
  fireEvent.click(modelChoice);
  await waitFor(() => assert.ok(view.getByRole('heading', { name: 'Model Classroom Tracker' })));
});

test('target navigation waits for the exact room and delayed items, then applies only once', async () => {
  const target = Object.freeze({
    itemId: 'target-status',
    classroomId: 'classroom-target',
    navigationKey: 'room-navigation-1',
  });
  const revealed = [];
  const firstRoom = {
    id: 'classroom-first',
    room_id: 'First Room',
    spaceId: 'space-first',
    items: [{ id: 'first-status', name: 'First item', category: 'General', status: 'Done' }],
  };
  const targetRoomWithoutItems = {
    id: 'classroom-target',
    room_id: 'Target Room',
    spaceId: 'space-target',
    items: [],
  };
  const props = {
    universityId: 'university-1',
    onSave: async () => true,
    target,
    onTargetRevealed: key => revealed.push(key),
  };
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm {...props} data={{ classrooms: [firstRoom] }} />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );

  assert.equal(view.queryByText('First item'), null);
  assert.deepEqual(revealed, []);

  view.rerender(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm
              {...props}
              data={{ classrooms: [firstRoom, targetRoomWithoutItems] }}
            />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
   await waitFor(() => assert.ok(view.getByText('No checklist items have been configured for this room yet.')));

  const targetRoomWithItems = {
    ...targetRoomWithoutItems,
    items: [{ id: 'target-status', name: 'Delayed target', category: 'Delayed category', status: 'Blocker' }],
  };
  view.rerender(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm
              {...props}
              data={{ classrooms: [firstRoom, targetRoomWithItems] }}
            />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );

  const targetRow = await view.findByLabelText('Target checklist item: Delayed target');
  await waitFor(() => assert.equal(document.activeElement, targetRow));
  assert.deepEqual(revealed, ['room-navigation-1']);
  assert.equal(view.getByRole('button', { name: /Delayed category/ }).getAttribute('aria-expanded'), 'true');

  fireEvent.click(view.getByRole('button', { name: /First Room/ }));
  await waitFor(() => assert.ok(view.getByRole('button', { name: /General/ })));
  fireEvent.click(view.getByRole('button', { name: /General/ }));
  const firstDate = view.container.querySelector('input[type="date"]');
  fireEvent.change(firstDate, { target: { value: '2026-10-20' } });

  view.rerender(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm
              {...props}
              data={{
                classrooms: [
                  { ...firstRoom, items: firstRoom.items.map(item => ({ ...item, itemStartDate: '2025-01-01' })) },
                  targetRoomWithItems,
                ],
              }}
            />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );

  assert.equal(firstDate.value, '2026-10-20');
  assert.deepEqual(revealed, ['room-navigation-1']);
  assert.deepEqual(target, {
    itemId: 'target-status',
    classroomId: 'classroom-target',
    navigationKey: 'room-navigation-1',
  });
});

test('saving the active classroom never submits stale snapshots from another room', async () => {
  const submitted = [];
  const data = {
    classrooms: [
      serverData.classrooms[0],
      {
        ...serverData.classrooms[0],
        id: 'classroom-2',
        room_id: 'Room 202',
        spaceId: 'space-2',
        items: [{
          ...serverData.classrooms[0].items[0],
          id: 'status-2',
          remarks: 'stale other-room snapshot',
        }],
      },
    ],
  };
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm
              data={data}
              universityId="university-1"
              onSave={async draft => {
                submitted.push(draft);
                return { ok: true, committed: true, refreshed: true };
              }}
            />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );

  fireEvent.click(view.getByText('Electrical'));
  fireEvent.change(view.getByPlaceholderText('e.g. 62.5 KVA'), {
    target: { value: '25 KVA' },
  });
  fireEvent.click(view.getByRole('button', { name: /Save Room 101 Checklist/i }));

  await waitFor(() => assert.equal(submitted.length, 1));
  assert.equal(submitted[0].classrooms.length, 1);
  assert.equal(submitted[0].classrooms[0].id, 'classroom-1');
  assert.equal(JSON.stringify(submitted[0]).includes('stale other-room snapshot'), false);
});

test('switching rooms restores the active room draft instead of a server snapshot', async () => {
  const data = {
    classrooms: [
      serverData.classrooms[0],
      {
        ...serverData.classrooms[0],
        id: 'classroom-2',
        room_id: 'Room 202',
        spaceId: 'space-2',
        items: [{ ...serverData.classrooms[0].items[0], id: 'status-2' }],
      },
    ],
  };
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm data={data} universityId="university-1" onSave={async () => ({ ok: true })} />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
  fireEvent.click(view.getByText('Electrical'));
  fireEvent.change(view.getByPlaceholderText('e.g. 62.5 KVA'), {
    target: { value: 'room one draft' },
  });
  fireEvent.click(view.getByRole('button', { name: /Room 202/i }));
  fireEvent.click(view.getByRole('button', { name: /Room 101/i }));
  await waitFor(() => assert.equal(
    view.getByPlaceholderText('e.g. 62.5 KVA').value,
    'room one draft',
  ));
});

test('same active room refresh hydrates a saved remark when the record is reused', async () => {
  const data = {
    classrooms: [{
      id: 'ac-room',
      room_id: 'AC Installation',
      spaceId: 'ac-space',
      items: [{
        id: 'ac-status',
        checklistItemId: 'ac-item',
        name: 'AC Installation',
        category: 'Electrical',
        status: 'In-Progress',
        remarks: '',
      }],
    }],
  };
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm
              data={data}
              universityId="university-1"
              onSave={async () => ({ ok: true })}
            />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );

  fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
  const remarks = view.getByLabelText('Audit Remarks / Field Notes');
  assert.equal(remarks.value, '');

  data.classrooms[0].items[0] = {
    ...data.classrooms[0].items[0],
    remarks: 'AC saved note after reload',
  };
  view.rerender(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm
              data={data}
              universityId="university-1"
              onSave={async () => ({ ok: true })}
            />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );

  await waitFor(() => assert.equal(remarks.value, 'AC saved note after reload'));
});

test('switching between a blank and saved room keeps each room remark isolated', async () => {
  const data = {
    classrooms: [
      {
        id: 'room-blank',
        room_id: 'AC Installation blank',
        spaceId: 'space-blank',
        items: [{
          id: 'status-blank',
          checklistItemId: 'ac-item',
          name: 'AC Installation',
          category: 'Electrical',
          status: 'In-Progress',
          remarks: '',
        }],
      },
      {
        id: 'room-saved',
        room_id: 'AC Installation saved',
        spaceId: 'space-saved',
        items: [{
          id: 'status-saved',
          checklistItemId: 'ac-item',
          name: 'AC Installation',
          category: 'Electrical',
          status: 'In-Progress',
          remarks: 'Saved room note',
        }],
      },
    ],
  };
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm
              data={data}
              universityId="university-1"
              onSave={async () => ({ ok: true })}
            />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );

  fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
  assert.equal(view.getByLabelText('Audit Remarks / Field Notes').value, '');

  fireEvent.click(view.getByRole('button', { name: /AC Installation saved/ }));
  await waitFor(() => assert.equal(
    view.getByLabelText('Audit Remarks / Field Notes').value,
    'Saved room note',
  ));

  fireEvent.click(view.getByRole('button', { name: /AC Installation blank/ }));
  await waitFor(() => assert.equal(
    view.getByLabelText('Audit Remarks / Field Notes').value,
    '',
  ));
});

test('a refreshed active room replaces stale non-draft cached fields while preserving drafts', async () => {
  const initial = {
    ...serverData,
    classrooms: [{
      ...serverData.classrooms[0],
      items: [{
        ...serverData.classrooms[0].items[0],
        remarks: 'server before copy',
        capacity: '10 KVA',
      }],
    }],
  };
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm data={initial} universityId="university-1" onSave={async () => ({ ok: true })} />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
  fireEvent.click(view.getByText('Electrical'));
  const remarks = view.getByLabelText('Audit Remarks / Field Notes');
  const capacity = view.getByPlaceholderText('e.g. 62.5 KVA');

  fireEvent.change(remarks, { target: { value: 'newer local draft' } });
  view.rerender(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm
              data={{
                ...initial,
                classrooms: [{
                  ...initial.classrooms[0],
                  items: [{
                    ...initial.classrooms[0].items[0],
                    remarks: 'authoritative copied remark',
                    capacity: '25 KVA',
                  }],
                }],
              }}
              universityId="university-1"
              onSave={async () => ({ ok: true })}
            />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );

  await waitFor(() => assert.equal(capacity.value, '25 KVA'));
  assert.equal(remarks.value, 'newer local draft');
});

test('classroom save keeps newer source drafts blocked without opening whole-room copy', async () => {
  let releaseSave;
  let submittedCapacity;
  const data = {
    classrooms: [
      serverData.classrooms[0],
      {
        ...serverData.classrooms[0],
        id: 'classroom-2',
        room_id: 'Room 202',
        spaceId: 'space-2',
        items: [{ ...serverData.classrooms[0].items[0], id: 'status-2' }],
      },
    ],
  };
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm
              data={data}
              universityId="university-1"
              onSave={async payload => {
                submittedCapacity = payload.classrooms[0].items[0].capacity;
                await new Promise(resolve => { releaseSave = resolve; });
                return { ok: true };
              }}
            />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
  fireEvent.click(view.getByText('Electrical'));
  const capacity = view.getByPlaceholderText('e.g. 62.5 KVA');
  fireEvent.change(capacity, { target: { value: '10 KVA saved first' } });
  fireEvent.click(view.getByRole('button', { name: /Save Room 101 Checklist/i }));
  await waitFor(() => assert.equal(submittedCapacity, '10 KVA saved first'));

  fireEvent.change(capacity, { target: { value: 'newer pending capacity' } });
  releaseSave();
  await waitFor(() => assert.equal(
    view.queryByText('Apply to Other Classrooms'),
    null,
  ));
  assert.match(view.getByText(/newer edits remain unsaved/i).textContent, /newer edits remain unsaved/i);
  assert.doesNotMatch(view.getByText(/newer edits remain unsaved/i).textContent, /before copying/i);
});

test('Overall Classroom offers Partially Done and preserves it for retry after a failed write', async () => {
  let statusCalls = 0;
  let retriedStatus;
  globalThis.fetch = async () => {
    statusCalls += 1;
    return {
      status: 503,
      ok: false,
      json: async () => ({
        error: 'transaction busy',
        code: 'TX_BUSY',
        correlationId: 'corr-overall',
      }),
    };
  };
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm
              data={serverData}
              universityId="university-1"
              onSave={async payload => {
                retriedStatus = payload.classrooms[0].items[0].status;
                return { ok: false, error: new Error('still busy') };
              }}
            />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
  fireEvent.click(view.getByText('Electrical'));
  const status = view.container.querySelector('select');
  assert.ok([...status.options].some(option => option.value === 'Partially Done'));
  fireEvent.change(status, { target: { value: 'Partially Done' } });
  await waitFor(() => assert.equal(statusCalls, 1));
  assert.equal(status.value, 'Partially Done');
  assert.match(
    view.getByText(/Use Save Checklist to retry/).textContent,
    /Use Save Checklist to retry/,
  );
  assert.equal(view.queryByRole('button', { name: /Retry remark/i }), null);

  fireEvent.click(view.getByRole('button', { name: /Save Room 101 Checklist/i }));
  await waitFor(() => assert.equal(retriedStatus, 'Partially Done'));
  assert.equal(status.value, 'Partially Done');
});

function associationRoom(state) {
  return {
    id: 'classroom-unresolved',
    room_id: 'Room 101',
    associationState: state,
    associationError: `association ${state}`,
    spaceId: null,
    associationCandidates: [
      { id: 'space-existing', name: 'Room 101 checklist', checklistCount: 3, statusCount: 2 },
      { id: 'space-other', name: 'Room 202 checklist', checklistCount: 1, statusCount: 1 },
    ],
    items: [],
  };
}

function renderAssociationForm({ role = 'apm', room }) {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role }));
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return {
      ok: true, status: 200, json: async () => [],
    };
    if (url === '/api/universities/university-1' && (!options.method || options.method === 'GET')) {
      return {
        ok: true, status: 200, json: async () => ({ id: 'university-1', spaces: [], classrooms: [] }),
      };
    }
    if (url === '/api/auth/me') return {
      ok: true, status: 200, json: async () => ({ id: 'user-1', role }),
    };
    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${url}`);
  };
  return render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm
              data={{ classrooms: [room] }}
              universityId="university-1"
              onSave={async () => ({ ok: true })}
            />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

test('Overall Classroom distinguishes ambiguous associations from genuinely missing checklist rows', async () => {
  const ambiguous = renderAssociationForm({ room: associationRoom('ambiguous') });
  assert.match(ambiguous.getByText(/ambiguous checklist association/i).textContent, /ambiguous/i);
  assert.equal(ambiguous.queryByText(/no checklist items have been configured/i), null);
  ambiguous.unmount();

  const missing = renderAssociationForm({ room: associationRoom('missing') });
  assert.match(missing.getByText(/no checklist association/i).textContent, /no checklist association/i);
  assert.equal(missing.queryByText(/no checklist items have been configured/i), null);
});

test('admin can resolve an unresolved classroom using an existing checklist space', async () => {
  const requests = [];
  const room = associationRoom('ambiguous');
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role: 'admin' }));
  globalThis.fetch = async (url, options = {}) => {
    requests.push([url, options.method || 'GET', options.body]);
    if (url === '/api/universities') return { ok: true, status: 200, json: async () => [] };
    if (url === '/api/universities/university-1' && (!options.method || options.method === 'GET')) {
      return { ok: true, status: 200, json: async () => ({ id: 'university-1', spaces: [], classrooms: [] }) };
    }
    if (url === '/api/universities/university-1/classrooms/classroom-unresolved/association') {
      return { ok: true, status: 200, json: async () => ({ classroom: { ...room, spaceId: 'space-other' } }) };
    }
    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${url}`);
  };
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>
            <OverallClassroomForm data={{ classrooms: [room] }} universityId="university-1" onSave={async () => ({ ok: true })} />
          </ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
  const chooser = await view.findByLabelText('Checklist space');
  fireEvent.change(chooser, { target: { value: 'space-other' } });
  fireEvent.click(view.getByRole('button', { name: /resolve association/i }));
  await waitFor(() => assert.deepEqual(
    requests.find(request => request[0].includes('/association')),
    [
      '/api/universities/university-1/classrooms/classroom-unresolved/association',
      'PUT',
      JSON.stringify({ spaceId: 'space-other' }),
    ],
  ));
  assert.match(view.getByText(/room 202 checklist/i).textContent, /1 checklist items, 1 with status/i);
});

test('non-admin users receive guidance but cannot see classroom association resolver', () => {
  const view = renderAssociationForm({ role: 'apm', room: associationRoom('ambiguous') });
  assert.match(view.getByText(/ask an administrator to resolve/i).textContent, /administrator/i);
  assert.equal(view.queryByLabelText('Checklist space'), null);
  assert.equal(view.queryByRole('button', { name: /resolve association/i }), null);
});
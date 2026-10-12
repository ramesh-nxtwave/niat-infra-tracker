import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { AuthProvider } from '../../context/AuthContext';
import { DataProvider, useData } from '../../context/DataContext';
import { ToastProvider } from '../../context/ToastContext';
import ModelClassroomForm from './ModelClassroomForm';
import {
  recordChecklistDraft,
  resetChecklistDraftStoreForTests,
} from '../../utils/checklistDraftStore';

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
  sessionStorage.clear();
  resetChecklistDraftStoreForTests();
});

const source = {
  spaceId: 'model-space',
  remarks: '',
  items: [{
    id: 'model-status',
    checklistItemId: 'item-generator',
    name: 'Generator',
    category: 'Electrical',
    sortOrder: 1,
    status: 'Done',
    remarks: 'template note',
    photoLink: '/objects/model-generator.jpg',
    photoContentType: 'image/jpeg',
    universityTimeline: '2026-09-01',
    targetDate: '2026-10-01',
    capacity: '10 KVA',
    requiresCapacity: true,
  }],
};

const classrooms = [{
  id: 'classroom-a',
  room_id: 'Room A',
  spaceId: 'space-a',
  items: [{
    id: 'target-status',
    checklistItemId: 'item-generator',
    status: 'In-Progress',
    remarks: 'keep this note',
    photoLink: '/objects/target.jpg',
  }],
}];

const modelPromptClassrooms = [{
  id: 'classroom-a',
  room_id: 'Room A',
  spaceId: 'space-a',
  items: [{
    id: 'target-status',
    checklistItemId: 'item-generator',
    category: 'Electrical',
    name: 'Generator',
    status: 'In-Progress',
    remarks: 'keep this note',
    photoLink: '/objects/target.jpg',
  }],
}];

function Providers({ children }) {
  return (
    <AuthProvider>
      <DataProvider>
        <ToastProvider>{children}</ToastProvider>
      </DataProvider>
    </AuthProvider>
  );
}

function ModelSaveHarness({ data, classrooms, captured }) {
  const { patchChecklistStatus } = useData();
  const onSave = async payload => {
    captured.push(payload);
    const item = payload.items[0];
    await patchChecklistStatus('university-1', item.id, {
      targetTimeline: item.targetDate,
    });
    return { ok: true };
  };
  return (
    <ModelClassroomForm
      data={data}
      classrooms={classrooms}
      universityId="university-1"
      onSave={onSave}
    />
  );
}

function RefreshedTargetTimeline({ statusId }) {
  const { getUniversity } = useData();
  const university = getUniversity('university-1');
  const item = university?.classrooms
    ?.flatMap(room => room.items || [])
    .find(candidate => candidate.id === statusId);
  return <output aria-label="Refreshed Target Timeline">{item?.targetDate || ''}</output>;
}

test('model save does not automatically open a destination copy prompt', async () => {
  const view = render(
    <Providers>
      <ModelClassroomForm
        data={source}
        classrooms={classrooms}
        universityId="university-1"
        onSave={async () => ({ ok: true })}
      />
    </Providers>,
  );

  fireEvent.click(view.getByRole('button', { name: /Save Checklist/i }));
  await waitFor(() => assert.equal(
    view.queryByRole('heading', { name: /Copy Model Classroom/i }),
    null,
  ));
});

test('Yet to start evidence removal submits explicit empty media fields', async () => {
  const captured = [];
  const data = {
    ...source,
    items: [{
      ...source.items[0],
      status: 'Yet to start',
    }],
  };
  const view = render(
    <Providers>
      <ModelClassroomForm
        data={data}
        classrooms={[]}
        universityId="university-1"
        onSave={async payload => {
          captured.push(payload);
          return { ok: true };
        }}
      />
    </Providers>,
  );

  fireEvent.click(view.getByRole('button', { name: /Electrical 0\/1 Complete/ }));
  fireEvent.click(view.getByRole('button', { name: '✕' }));
  await waitFor(() => assert.ok(view.getByText('No media yet')));
  fireEvent.click(view.getByRole('button', { name: /Save Checklist/i }));
  await waitFor(() => assert.equal(captured.length, 1));
  assert.equal(captured[0].items[0].status, 'Yet to start');
  assert.equal(captured[0].items[0].photoLink, '');
  assert.equal(captured[0].items[0].photoContentType, null);
});

test('successful model remark save opens a field-scoped copy prompt', async () => {
  const previousFetch = globalThis.fetch;
  let bulkPayload;
  const statusPatches = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities/university-1/status/model-status') {
      statusPatches.push(JSON.parse(options.body || '{}'));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1/status/bulk') {
      bulkPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            statusId: 'target-status',
            outcome: 'applied',
            row: { currentStatus: 'In-Progress', remarks: 'model remark' },
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
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={source}
          classrooms={modelPromptClassrooms}
          universityId="university-1"
          onSave={async () => ({ ok: true })}
        />
      </Providers>,
    );

    fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
    const status = view.container.querySelector('select.status-select-premium');
    fireEvent.change(status, { target: { value: 'In-Progress' } });
    await waitFor(() => assert.equal(statusPatches.length, 1));
    const remarks = view.getByLabelText('Audit Remarks / Field Notes');
    fireEvent.change(remarks, { target: { value: 'model remark' } });
    fireEvent.blur(remarks);

    await waitFor(() => assert.ok(view.getByRole('heading', { name: /Copy Model Classroom/i })));
    const fields = view.getByRole('dialog').querySelectorAll('input[type="checkbox"]');
    assert.equal(fields[1].checked, false);
    assert.equal(fields[2].checked, true);
    assert.equal(fields[3].checked, false);
    assert.equal(fields[4].checked, false);

    fireEvent.click(view.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.ok(bulkPayload));
    assert.equal(bulkPayload.updates[0].remarks, 'model remark');
    assert.equal(Object.hasOwn(bulkPayload.updates[0], 'currentStatus'), false);
    assert.equal(Object.hasOwn(bulkPayload.updates[0], 'photoUrl'), false);
    assert.equal(Object.hasOwn(bulkPayload.updates[0], 'targetTimeline'), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a queued model copy prompt waits until the user leaves the remark field', async () => {
  const previousFetch = globalThis.fetch;
  let releaseStatus;
  const statusPending = new Promise(resolve => {
    releaseStatus = resolve;
  });
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities/university-1/status/model-status') {
      const payload = JSON.parse(options.body || '{}');
      if (Object.hasOwn(payload, 'status')) {
        await statusPending;
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={source}
          classrooms={modelPromptClassrooms}
          universityId="university-1"
          onSave={async () => ({ ok: true })}
        />
      </Providers>,
    );

    fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
    const status = view.container.querySelector('select.status-select-premium');
    fireEvent.change(status, { target: { value: 'In-Progress' } });
    const remarks = view.getByLabelText('Audit Remarks / Field Notes');
    fireEvent.focus(remarks);
    fireEvent.change(remarks, { target: { value: 'Finish writing before prompting' } });
    releaseStatus();

    await new Promise(resolve => setTimeout(resolve, 900));
    assert.equal(
      view.queryByRole('heading', { name: /Copy Model Classroom/i }),
      null,
    );

    fireEvent.blur(remarks);
    await waitFor(() => assert.ok(
      view.getByRole('heading', { name: /Copy Model Classroom/i }),
    ));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('model remark copy ignores an unrelated pending source field', async () => {
  const previousFetch = globalThis.fetch;
  let bulkPayload;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities/university-1/status/model-status') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1/status/bulk') {
      bulkPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            statusId: 'target-status',
            outcome: 'applied',
            row: { currentStatus: 'In-Progress', remarks: 'model remark' },
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
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={source}
          classrooms={modelPromptClassrooms}
          universityId="university-1"
          onSave={async () => ({ ok: true })}
        />
      </Providers>,
    );

    // A status draft is a real unsaved edit, but this prompt only writes the
    // independently committed remark. It must not be reported as a source
    // race or silently folded into the copy snapshot.
    recordChecklistDraft('university-1', source.items[0], { status: 'In-Progress' });
    fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
    const remarks = view.getByLabelText('Audit Remarks / Field Notes');
    fireEvent.change(remarks, { target: { value: 'model remark' } });
    fireEvent.blur(remarks);

    await waitFor(() => assert.ok(view.getByRole('heading', { name: /Copy Model Classroom/i })));
    fireEvent.click(view.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.ok(bulkPayload));
    assert.equal(bulkPayload.updates[0].remarks, 'model remark');
    assert.equal(Object.hasOwn(bulkPayload.updates[0], 'currentStatus'), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('model copy ignores an unrelated staged upload', async () => {
  const previousFetch = globalThis.fetch;
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  let bulkPayload;
  const modelData = {
    ...source,
    items: [
      source.items[0],
      {
        id: 'model-lights',
        checklistItemId: 'item-lights',
        name: 'Lights',
        category: 'Electrical',
        sortOrder: 2,
        status: 'Done',
      },
    ],
  };
  const destinationClassrooms = [{
    id: 'classroom-a',
    room_id: 'Room A',
    spaceId: 'space-a',
    items: [
      {
        id: 'target-generator',
        checklistItemId: 'item-generator',
        category: 'Electrical',
        name: 'Generator',
        status: 'In-Progress',
      },
      {
        id: 'target-lights',
        checklistItemId: 'item-lights',
        category: 'Electrical',
        name: 'Lights',
        status: 'In-Progress',
      },
    ],
  }];
  globalThis.URL.createObjectURL = () => 'blob:unrelated-staged';
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities/university-1/status/model-status') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1/status/bulk') {
      bulkPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { statusId: 'target-generator', outcome: 'applied', row: { remarks: 'model remark' } },
          ],
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
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={modelData}
          classrooms={destinationClassrooms}
          universityId="university-1"
          onSave={async () => ({ ok: true })}
        />
      </Providers>,
    );

    fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
    const fileInputs = view.container.querySelectorAll('input[type="file"]');
    fireEvent.change(fileInputs[1], {
      target: { files: [new window.File(['staged unrelated'], 'unrelated.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => assert.ok(view.getByText('unrelated.jpg')));

    const remarks = view.getAllByLabelText('Audit Remarks / Field Notes')[0];
    fireEvent.change(remarks, { target: { value: 'model remark' } });
    fireEvent.blur(remarks);
    await waitFor(() => assert.ok(view.getByRole('heading', { name: /Copy Model Classroom/i })));

    fireEvent.click(view.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.ok(bulkPayload));
    assert.equal(bulkPayload.updates[0].remarks, 'model remark');
    assert.equal(view.queryByText(/source upload is pending/i), null);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.URL.createObjectURL = previousCreateObjectURL;
  }
});

test('model copy blocks a staged upload on the source item', async () => {
  const previousFetch = globalThis.fetch;
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  let bulkCalls = 0;
  const modelData = {
    ...source,
    items: [
      source.items[0],
      {
        id: 'model-lights',
        checklistItemId: 'item-lights',
        name: 'Lights',
        category: 'Electrical',
        sortOrder: 2,
        status: 'Done',
      },
    ],
  };
  const destinationClassrooms = [{
    id: 'classroom-a',
    room_id: 'Room A',
    spaceId: 'space-a',
    items: [
      {
        id: 'target-generator',
        checklistItemId: 'item-generator',
        category: 'Electrical',
        name: 'Generator',
        status: 'In-Progress',
      },
      {
        id: 'target-lights',
        checklistItemId: 'item-lights',
        category: 'Electrical',
        name: 'Lights',
        status: 'In-Progress',
      },
    ],
  }];
  globalThis.URL.createObjectURL = () => 'blob:source-staged';
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities/university-1/status/model-status') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1/status/bulk') {
      bulkCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={modelData}
          classrooms={destinationClassrooms}
          universityId="university-1"
          onSave={async () => ({ ok: true })}
        />
      </Providers>,
    );

    fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
    const fileInputs = view.container.querySelectorAll('input[type="file"]');
    fireEvent.change(fileInputs[0], {
      target: { files: [new window.File(['staged source'], 'source.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => assert.ok(view.getByText('source.jpg')));

    const remarks = view.getAllByLabelText('Audit Remarks / Field Notes')[0];
    fireEvent.change(remarks, { target: { value: 'model remark' } });
    fireEvent.blur(remarks);
    await waitFor(() => assert.ok(view.getByRole('heading', { name: /Copy Model Classroom/i })));

    fireEvent.click(view.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.match(
      view.getByRole('alert').textContent,
      /source upload is pending/i,
    ));
    assert.equal(bulkCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.URL.createObjectURL = previousCreateObjectURL;
  }
});

test('failed model remark save does not open a copy prompt', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url === '/api/universities/university-1/status/model-status') {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'remark save failed' }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={source}
          classrooms={modelPromptClassrooms}
          universityId="university-1"
          onSave={async () => ({ ok: true })}
        />
      </Providers>,
    );

    fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
    const remarks = view.getByLabelText('Audit Remarks / Field Notes');
    fireEvent.change(remarks, { target: { value: 'failed model remark' } });
    fireEvent.blur(remarks);

    await waitFor(() => assert.ok(view.getByText(/Remark was not saved: remark save failed/i)));
    assert.equal(view.queryByRole('heading', { name: /Copy Model Classroom/i }), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('successful model photo upload opens a photo-only copy prompt', async () => {
  const previousFetch = globalThis.fetch;
  const previousImage = globalThis.Image;
  const previousXHR = globalThis.XMLHttpRequest;
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  let bulkPayload;

  class FakeImage {
    set src(_value) {
      queueMicrotask(() => this.onerror?.());
    }
  }
  class FakeXHR {
    constructor() {
      this.listeners = {};
      this.upload = { addEventListener: () => undefined };
      this.status = 200;
      this.statusText = 'OK';
    }

    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }

    open() {}

    setRequestHeader() {}

    send() {
      queueMicrotask(() => this.listeners.load?.());
    }
  }

  globalThis.Image = FakeImage;
  globalThis.XMLHttpRequest = FakeXHR;
  globalThis.URL.createObjectURL = () => 'blob:model-upload';
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/storage/uploads/request-url') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          uploadURL: 'https://uploads.example.test/model-upload',
          objectPath: '/objects/model-upload.jpg',
        }),
      };
    }
    if (url === '/api/universities/university-1/status/model-status') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1/status/bulk') {
      bulkPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            statusId: 'target-status',
            outcome: 'applied',
            row: { currentStatus: 'In-Progress', photoUrl: '/objects/model-upload.jpg' },
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
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={source}
          classrooms={modelPromptClassrooms}
          universityId="university-1"
          onSave={async () => ({ ok: true })}
        />
      </Providers>,
    );

    fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
    const fileInput = view.container.querySelector('input[type="file"]');
    fireEvent.change(fileInput, {
      target: { files: [new window.File(['model photo'], 'model.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => assert.ok(view.getByText('model.jpg')));
    fireEvent.click(view.getByRole('button', { name: /Upload 1 file/i }));

    await waitFor(() => assert.ok(view.getByRole('heading', { name: /Copy Model Classroom/i })));
    const fields = view.getByRole('dialog').querySelectorAll('input[type="checkbox"]');
    assert.equal(fields[1].checked, true);
    assert.equal(fields[2].checked, false);
    assert.equal(fields[3].checked, false);
    assert.equal(fields[4].checked, false);

    fireEvent.click(view.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.ok(bulkPayload));
    assert.equal(bulkPayload.updates[0].photoUrl, '/objects/model-upload.jpg');
    assert.equal(bulkPayload.updates[0].photoContentType, 'image/jpeg');
    assert.equal(Object.hasOwn(bulkPayload.updates[0], 'currentStatus'), false);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Image = previousImage;
    globalThis.XMLHttpRequest = previousXHR;
    globalThis.URL.createObjectURL = previousCreateObjectURL;
  }
});

test('a multi-file upload prompts for the final committed evidence only', async () => {
  const previousFetch = globalThis.fetch;
  const previousImage = globalThis.Image;
  const previousXHR = globalThis.XMLHttpRequest;
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  let bulkPayload;

  class FakeImage {
    set src(_value) {
      queueMicrotask(() => this.onerror?.());
    }
  }
  class FakeXHR {
    constructor() {
      this.listeners = {};
      this.upload = { addEventListener: () => undefined };
      this.status = 200;
      this.statusText = 'OK';
    }

    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }

    open() {}
    setRequestHeader() {}
    send() {
      queueMicrotask(() => this.listeners.load?.());
    }
  }

  globalThis.Image = FakeImage;
  globalThis.XMLHttpRequest = FakeXHR;
  globalThis.URL.createObjectURL = () => 'blob:multi-upload';
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/storage/uploads/request-url') {
      const name = JSON.parse(options.body).name;
      const suffix = name.includes('first') ? 'first' : 'second';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          uploadURL: `https://uploads.example.test/${suffix}`,
          objectPath: `/objects/${suffix}.jpg`,
        }),
      };
    }
    if (url === '/api/universities/university-1/status/model-status') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1/status/bulk') {
      bulkPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            statusId: 'target-status',
            outcome: 'applied',
            row: { photoUrl: '/objects/second.jpg' },
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
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={source}
          classrooms={modelPromptClassrooms}
          universityId="university-1"
          onSave={async () => ({ ok: true })}
        />
      </Providers>,
    );
    fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
    const fileInput = view.container.querySelector('input[type="file"]');
    fireEvent.change(fileInput, {
      target: {
        files: [
          new window.File(['first'], 'first.jpg', { type: 'image/jpeg' }),
          new window.File(['second'], 'second.jpg', { type: 'image/jpeg' }),
        ],
      },
    });
    await waitFor(() => assert.ok(view.getByText('first.jpg')));
    fireEvent.click(view.getByRole('button', { name: /Upload 2 files/i }));

    await waitFor(() => assert.ok(view.getByRole('heading', { name: /Copy Model Classroom/i })));
    fireEvent.click(view.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.ok(bulkPayload));
    assert.equal(bulkPayload.updates[0].photoUrl, '/objects/second.jpg');
    assert.equal(bulkPayload.updates[0].expectedSourcePhotoUrl, '/objects/second.jpg');
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Image = previousImage;
    globalThis.XMLHttpRequest = previousXHR;
    globalThis.URL.createObjectURL = previousCreateObjectURL;
  }
});

test('same-item remark and upload commits queue both field-scoped prompts', async () => {
  const previousFetch = globalThis.fetch;
  const previousImage = globalThis.Image;
  const previousXHR = globalThis.XMLHttpRequest;
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  let releaseRemark;
  let remarkBody;
  const bulkPayloads = [];

  class FakeImage {
    set src(_value) {
      queueMicrotask(() => this.onerror?.());
    }
  }
  class FakeXHR {
    constructor() {
      this.listeners = {};
      this.upload = { addEventListener: () => undefined };
      this.status = 200;
      this.statusText = 'OK';
    }

    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }

    open() {}
    setRequestHeader() {}
    send() {
      queueMicrotask(() => this.listeners.load?.());
    }
  }

  globalThis.Image = FakeImage;
  globalThis.XMLHttpRequest = FakeXHR;
  globalThis.URL.createObjectURL = () => 'blob:race-upload';
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/storage/uploads/request-url') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          uploadURL: 'https://uploads.example.test/race',
          objectPath: '/objects/race.jpg',
        }),
      };
    }
    if (url === '/api/universities/university-1/status/model-status') {
      const body = JSON.parse(options.body || '{}');
      if (body.remarks !== undefined && !remarkBody) {
        remarkBody = body;
        await new Promise(resolve => {
          releaseRemark = resolve;
        });
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1/status/bulk') {
      bulkPayloads.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            statusId: 'target-status',
            outcome: 'applied',
            row: { remarks: 'race note', photoUrl: '/objects/race.jpg' },
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
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={source}
          classrooms={modelPromptClassrooms}
          universityId="university-1"
          onSave={async () => ({ ok: true })}
        />
      </Providers>,
    );
    fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
    const remarks = view.getByLabelText('Audit Remarks / Field Notes');
    fireEvent.change(remarks, { target: { value: 'race note' } });
    fireEvent.blur(remarks);
    await waitFor(() => assert.equal(typeof releaseRemark, 'function'));

    const fileInput = view.container.querySelector('input[type="file"]');
    fireEvent.change(fileInput, {
      target: { files: [new window.File(['race'], 'race.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => assert.ok(view.getByText('race.jpg')));
    fireEvent.click(view.getByRole('button', { name: /Upload 1 file/i }));
    assert.equal(view.queryByRole('heading', { name: /Copy Model Classroom/i }), null);

    releaseRemark();
    await waitFor(() => assert.ok(view.getByRole('heading', { name: /Copy Model Classroom/i })));
    fireEvent.click(view.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.equal(bulkPayloads.length, 1));
    assert.equal(bulkPayloads[0].updates[0].remarks, 'race note');
    assert.equal(Object.hasOwn(bulkPayloads[0].updates[0], 'photoUrl'), false);

    await waitFor(() => assert.ok(view.getByRole('heading', { name: /Copy Model Classroom/i })));
    fireEvent.click(view.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.equal(bulkPayloads.length, 2));
    assert.equal(bulkPayloads[1].updates[0].photoUrl, '/objects/race.jpg');
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Image = previousImage;
    globalThis.XMLHttpRequest = previousXHR;
    globalThis.URL.createObjectURL = previousCreateObjectURL;
  }
});

test('failed model photo upload does not open a copy prompt', async () => {
  const previousFetch = globalThis.fetch;
  const previousImage = globalThis.Image;
  const previousXHR = globalThis.XMLHttpRequest;
  const previousCreateObjectURL = globalThis.URL.createObjectURL;

  class FakeImage {
    set src(_value) {
      queueMicrotask(() => this.onerror?.());
    }
  }
  globalThis.Image = FakeImage;
  globalThis.XMLHttpRequest = class FailedXHR {};
  globalThis.URL.createObjectURL = () => 'blob:failed-model-upload';
  globalThis.fetch = async url => {
    if (url === '/api/storage/uploads/request-url') {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'upload request failed' }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={source}
          classrooms={modelPromptClassrooms}
          universityId="university-1"
          onSave={async () => ({ ok: true })}
        />
      </Providers>,
    );

    fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
    const fileInput = view.container.querySelector('input[type="file"]');
    fireEvent.change(fileInput, {
      target: { files: [new window.File(['failed model photo'], 'failed.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => assert.ok(view.getByText('failed.jpg')));
    fireEvent.click(view.getByRole('button', { name: /Upload 1 file/i }));

    await waitFor(() => assert.match(view.getByText(/All uploads failed/i).textContent, /try again/i));
    assert.equal(view.queryByRole('heading', { name: /Copy Model Classroom/i }), null);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Image = previousImage;
    globalThis.XMLHttpRequest = previousXHR;
    globalThis.URL.createObjectURL = previousCreateObjectURL;
  }
});

test('model target timeline saves without opening an automatic copy prompt', async () => {
  const captured = [];
  const modelData = {
    ...source,
    items: [{
      ...source.items[0],
      checklistItemId: 'model_classroom_0',
      category: ' Flooring ',
      name: 'Main  Flooring',
      targetDate: '',
    }],
  };
  const destinationClassrooms = [{
    id: 'classroom-a',
    room_id: 'Room A',
    spaceId: 'space-a',
    items: [{
      id: 'overall-flooring-status',
      checklistItemId: 'overall_classroom_0',
      category: 'flooring',
      name: ' main flooring ',
      status: 'In-Progress',
      targetDate: '2026-11-01',
    }],
  }];
  const previousFetch = globalThis.fetch;
  let bulkPayload;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities/university-1/status/model-status') {
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    }
    if (url === '/api/universities/university-1/status/bulk') {
      bulkPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            statusId: 'overall-flooring-status',
            outcome: 'applied',
            row: {
              currentStatus: 'In-Progress',
              targetTimeline: '2026-12-15',
            },
          }],
        }),
      };
    }
    if (url === '/api/universities/university-1') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'university-1',
          spaces: [{
            id: 'space-a',
            spaceType: 'overall_classroom',
            name: 'Room A',
            checklistStatuses: [{
              id: 'overall-flooring-status',
              checklistItemId: 'overall_classroom_0',
              spaceId: 'space-a',
              currentStatus: 'In-Progress',
              targetTimeline: '2026-12-15',
              checklistItem: {
                name: 'Main Flooring',
                category: 'Flooring',
                sortOrder: 1,
              },
            }],
          }],
          classrooms: [{ id: 'classroom-a', roomId: 'Room A' }],
        }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelSaveHarness
          data={modelData}
          classrooms={destinationClassrooms}
          captured={captured}
        />
        <RefreshedTargetTimeline statusId="overall-flooring-status" />
      </Providers>,
    );

    fireEvent.click(view.getByRole('button', { name: /Electrical|Flooring/ }));
    const targetTimeline = view.getByLabelText('Target Timeline');
    assert.equal(targetTimeline.value, '');
    fireEvent.change(targetTimeline, { target: { value: '2026-12-15' } });
    assert.equal(targetTimeline.value, '2026-12-15');

    fireEvent.click(view.getByRole('button', { name: /Save Checklist/i }));
    await waitFor(() => assert.equal(captured.length, 1));
    assert.equal(captured[0].items[0].targetDate, '2026-12-15');
    assert.equal(view.queryByRole('heading', { name: /Copy Model Classroom/i }), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('explicit model copy still matches distinct checklist ids canonically', async () => {
  const modelData = {
    ...source,
    items: [{
      ...source.items[0],
      checklistItemId: 'model_classroom_0',
      category: ' Flooring ',
      name: 'Main  Flooring',
    }],
  };
  const distinctIdClassrooms = [{
    id: 'classroom-a',
    room_id: 'Room A',
    spaceId: 'space-a',
    items: [{
      id: 'overall-flooring-status',
      checklistItemId: 'overall_classroom_0',
      category: 'flooring',
      name: ' main flooring ',
      status: 'In-Progress',
    }],
  }];
  const previousFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities/university-1/status/model-status') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === '/api/universities/university-1/status/bulk') {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            statusId: 'overall-flooring-status',
            outcome: 'applied',
            row: { currentStatus: 'In-Progress' },
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
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={modelData}
          classrooms={distinctIdClassrooms}
          universityId="university-1"
          onSave={async () => ({ ok: true })}
        />
      </Providers>,
    );

    fireEvent.click(view.getByRole('button', { name: /Electrical|Flooring/ }));
    const remarks = view.getByLabelText('Audit Remarks / Field Notes');
    fireEvent.change(remarks, { target: { value: 'explicit model copy' } });
    fireEvent.blur(remarks);
    await waitFor(() => assert.ok(view.getByRole('heading', { name: /Copy Model Classroom/i })));
    assert.doesNotMatch(view.getByRole('dialog').textContent, /unavailable/i);

    fireEvent.click(view.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.ok(requestBody));
    assert.deepEqual(requestBody.updates[0].targetStatusIds, ['overall-flooring-status']);
    assert.equal(requestBody.updates[0].checklistItemId, 'model_classroom_0');
    assert.equal(requestBody.updates[0].sourceSpaceType, 'model_classroom');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('model save does not open a copy snapshot while a source draft remains pending', async () => {
  const view = render(
    <Providers>
      <ModelClassroomForm
        data={source}
        classrooms={classrooms}
        universityId="university-1"
        onSave={async () => ({ ok: true })}
      />
    </Providers>,
  );

  fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
  fireEvent.change(view.getByPlaceholderText('e.g. 62.5 KVA'), {
    target: { value: '12 KVA' },
  });
  fireEvent.click(view.getByRole('button', { name: /Save Checklist/i }));

  await waitFor(() => assert.match(
    view.getByRole('alert').textContent,
    /pending/i,
  ));
  assert.doesNotMatch(view.getByRole('alert').textContent, /before copying/i);
  assert.equal(view.queryByRole('heading', { name: /Copy Model Classroom/i }), null);
});

test('model save does not start a whole-model bulk copy', async () => {
  const retrySource = {
    ...source,
    items: [
      ...source.items,
      {
        id: 'model-status-lights',
        checklistItemId: 'item-lights',
        name: 'Lights',
        category: 'Electrical',
        sortOrder: 2,
        status: 'Done',
      },
    ],
  };
  const retryClassrooms = [
    {
      id: 'classroom-a',
      room_id: 'Room A',
      spaceId: 'space-a',
      items: [
        {
          id: 'target-status-generator-a',
          checklistItemId: 'item-generator',
          category: 'Electrical',
          name: 'Generator',
          status: 'In-Progress',
        },
        {
          id: 'target-status-lights-a',
          checklistItemId: 'item-lights',
          category: 'Electrical',
          name: 'Lights',
          status: 'In-Progress',
        },
      ],
    },
    {
      id: 'classroom-b',
      room_id: 'Room B',
      spaceId: 'space-b',
      items: [
        {
          id: 'target-status-generator-b',
          checklistItemId: 'item-generator',
          category: 'Electrical',
          name: 'Generator',
          status: 'In-Progress',
        },
        {
          id: 'target-status-lights-b',
          checklistItemId: 'item-lights',
          category: 'Electrical',
          name: 'Lights',
          status: 'In-Progress',
        },
      ],
    },
  ];
  const previousFetch = globalThis.fetch;
  let bulkCalls = 0;
  globalThis.fetch = async url => {
    if (url === '/api/universities/university-1/status/bulk') {
      bulkCalls += 1;
      return {
        ok: false,
        status: 503,
        json: async () => ({ code: 'CHECKLIST_SAVE_BUSY' }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={retrySource}
          classrooms={retryClassrooms}
          universityId="university-1"
          onSave={async () => ({ ok: true })}
        />
      </Providers>,
    );

    fireEvent.click(view.getByRole('button', { name: /Save Checklist/i }));
    await waitFor(() => assert.equal(
      view.queryByRole('heading', { name: /Copy Model Classroom/i }),
      null,
    ));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('staged source upload does not trigger a whole-model copy prompt on save', async () => {
  const saveCalls = [];
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  globalThis.URL.createObjectURL = () => 'blob:staged-model-upload';

  try {
    const view = render(
      <Providers>
        <ModelClassroomForm
          data={source}
          classrooms={classrooms}
          universityId="university-1"
          onSave={async payload => {
            saveCalls.push(payload);
            return { ok: true };
          }}
        />
      </Providers>,
    );

    fireEvent.click(view.getByRole('button', { name: /Electrical/ }));
    fireEvent.change(view.container.querySelector('input[type="file"]'), {
      target: {
        files: [new window.File(['staged upload'], 'staged.jpg', { type: 'image/jpeg' })],
      },
    });
    await waitFor(() => assert.ok(view.getByText('staged.jpg')));

    fireEvent.click(view.getByRole('button', { name: /Save Checklist/i }));
    await waitFor(() => {
      assert.equal(saveCalls.length, 1);
    });
    assert.equal(view.queryByRole('alert'), null);
    assert.equal(view.queryByRole('heading', { name: /Copy Model Classroom/i }), null);
  } finally {
    globalThis.URL.createObjectURL = previousCreateObjectURL;
  }
});

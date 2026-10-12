import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { ConfirmProvider } from '../context/ConfirmContext';
import { DataProvider } from '../context/DataContext';
import { ToastProvider } from '../context/ToastContext';
import { resetChecklistDraftStoreForTests } from '../utils/checklistDraftStore';
import UniversityDetail from './UniversityDetail';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});
window.scrollTo = () => {};
window.matchMedia = () => ({ matches: true });
HTMLElement.prototype.scrollIntoView = function () {};

const {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} = await import('@testing-library/react');

const UNIVERSITY_ID = 'university-amet-photo';
const SOURCE_SPACE_ID = 'space-model-classroom';
const ROOM_101_SPACE_ID = 'space-room-101';
const ROOM_102_SPACE_ID = 'space-room-102';
const ROOM_101_ID = 'classroom-room-101';
const ROOM_102_ID = 'classroom-room-102';
const SOURCE_STATUS_ID = 'status-model-electrical-panel';
const ROOM_101_STATUS_ID = 'status-room-101-electrical-panel';
const ROOM_102_STATUS_ID = 'status-room-102-electrical-panel';
const MODEL_CHECKLIST_ITEM_ID = 'checklist-model-electrical-panel-v4';
const ROOM_CHECKLIST_ITEM_ID = 'checklist-classroom-electrical-panel-v9';
const COPIED_PHOTO = '/objects/amet-model-electrical-panel.jpg';

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const clone = value => JSON.parse(JSON.stringify(value));

function statusRow({
  id,
  checklistItemId,
  spaceId,
  photoUrl = null,
  photoContentType = null,
}) {
  return {
    id,
    checklistItemId,
    spaceId,
    currentStatus: 'In-Progress',
    remarks: '',
    photoUrl,
    photoContentType,
    checklistItem: {
      id: checklistItemId,
      name: 'Electrical Distribution Panel',
      category: 'Electrical',
      sortOrder: 1,
    },
  };
}

function makeUniversity({ ambiguousRoom102 = false } = {}) {
  const room102Statuses = [
    statusRow({
      id: ROOM_102_STATUS_ID,
      checklistItemId: ROOM_CHECKLIST_ITEM_ID,
      spaceId: ROOM_102_SPACE_ID,
      photoUrl: '/objects/room102-existing-evidence.jpg',
      photoContentType: 'image/jpeg',
    }),
  ];
  if (ambiguousRoom102) {
    room102Statuses.push({
      ...statusRow({
        id: 'status-room-102-ambiguous-electrical-panel',
        checklistItemId: 'checklist-classroom-electrical-panel-v10',
        spaceId: ROOM_102_SPACE_ID,
      }),
    });
  }

  return {
    id: UNIVERSITY_ID,
    name: 'AMET Institute of Technology',
    zoneId: 2,
    location: 'Chennai',
    spaces: [
      {
        id: SOURCE_SPACE_ID,
        spaceType: 'model_classroom',
        name: 'Model Classroom',
        checklistStatuses: [statusRow({
          id: SOURCE_STATUS_ID,
          checklistItemId: MODEL_CHECKLIST_ITEM_ID,
          spaceId: SOURCE_SPACE_ID,
        })],
      },
      {
        id: ROOM_101_SPACE_ID,
        spaceType: 'overall_classroom',
        name: 'Room 101',
        checklistStatuses: [statusRow({
          id: ROOM_101_STATUS_ID,
          checklistItemId: ROOM_CHECKLIST_ITEM_ID,
          spaceId: ROOM_101_SPACE_ID,
        })],
      },
      {
        id: ROOM_102_SPACE_ID,
        spaceType: 'overall_classroom',
        name: 'Room 102',
        checklistStatuses: room102Statuses,
      },
    ],
    classrooms: [
      { id: ROOM_101_ID, roomId: 'Room 101' },
      { id: ROOM_102_ID, roomId: 'Room 102' },
    ],
  };
}

function installHostedApi({ bulkFailure = false, ambiguousRoom102 = false, uploadFailure = false, patchFailure = false } = {}) {
  const state = makeUniversity({ ambiguousRoom102 });
  const requests = [];
  const bulkBodies = [];
  let detailGets = 0;
  let uploadPatchCount = 0;

  localStorage.setItem('niat_user', JSON.stringify({ id: 'ops-reader', role: 'ops' }));
  globalThis.fetch = async (input, options = {}) => {
    const path = String(input);
    const method = options.method || 'GET';
    requests.push({ path, method });

    if (path === '/api/universities' && method === 'GET') {
      return response([{
        id: UNIVERSITY_ID,
        name: state.name,
        zoneId: state.zoneId,
        moduleReadiness: {
          model_classroom: 0,
          overall_classroom: 0,
        },
      }]);
    }

    if (path === `/api/universities/${UNIVERSITY_ID}` && method === 'GET') {
      detailGets += 1;
      return response(clone(state));
    }

    if (path === `/api/storage/uploads/request-url` && method === 'POST') {
      if (uploadFailure) return response({ error: 'Storage unavailable' }, 503);
      return response({
        uploadURL: 'https://uploads.example.test/amet-model-electrical-panel',
        objectPath: COPIED_PHOTO,
      });
    }

    if (path === `/api/universities/${UNIVERSITY_ID}/status/${SOURCE_STATUS_ID}`
      && method === 'PATCH') {
      uploadPatchCount += 1;
      if (patchFailure) return response({ error: 'Photo was not saved', code: 'CHECKLIST_SAVE_BUSY' }, 503);
      const body = JSON.parse(options.body);
      const source = state.spaces
        .flatMap(space => space.checklistStatuses)
        .find(status => status.id === SOURCE_STATUS_ID);
      Object.assign(source, {
        ...(Object.hasOwn(body, 'photoUrl') && { photoUrl: body.photoUrl }),
        ...(Object.hasOwn(body, 'photoContentType') && { photoContentType: body.photoContentType }),
        ...(Object.hasOwn(body, 'currentStatus') && { currentStatus: body.currentStatus }),
      });
      return response(clone(source));
    }

    if (path === `/api/universities/${UNIVERSITY_ID}/status/bulk` && method === 'POST') {
      const body = JSON.parse(options.body);
      bulkBodies.push(body);
      if (bulkFailure) {
        return response({
          error: 'checklist transaction busy',
          code: 'CHECKLIST_SAVE_BUSY',
          correlationId: 'copy-busy-amet-fixture',
        }, 503);
      }

      const update = body.updates[0];
      const targetStatusId = update.targetStatusIds[0];
      const target = state.spaces
        .flatMap(space => space.checklistStatuses)
        .find(status => status.id === targetStatusId);
      if (!target) return response({ error: 'destination missing' }, 404);

      Object.assign(target, {
        ...(Object.hasOwn(update, 'photoUrl') && { photoUrl: update.photoUrl }),
        ...(Object.hasOwn(update, 'photoContentType') && { photoContentType: update.photoContentType }),
      });
      return response({
        applied: 1,
        skipped: 0,
        results: [{
          statusId: target.id,
          outcome: 'applied',
          row: {
            id: target.id,
            currentStatus: target.currentStatus,
            remarks: target.remarks,
            photoUrl: target.photoUrl,
            photoContentType: target.photoContentType,
          },
        }],
      });
    }

    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  return {
    state,
    requests,
    bulkBodies,
    get detailGets() {
      return detailGets;
    },
    get uploadPatchCount() {
      return uploadPatchCount;
    },
  };
}

function mountUniversity(path = `/university/${UNIVERSITY_ID}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <DataProvider>
          <ToastProvider>
            <ConfirmProvider>
              <Routes>
                <Route path="/university/:id" element={<UniversityDetail />} />
              </Routes>
            </ConfirmProvider>
          </ToastProvider>
        </DataProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function openModelClassroom() {
  await waitFor(() => assert.ok(screen.getAllByRole('button', { name: 'All Classrooms', exact: true }).length));
  fireEvent.click(screen.getAllByRole('button', { name: 'All Classrooms', exact: true })[0]);
  const modelButton = await screen.findByRole('button', { name: /Model Classroom \d+%/i });
  fireEvent.click(modelButton);
  await waitFor(() => assert.ok(screen.getByRole('heading', { name: 'Model Classroom Tracker' })));
  expandElectricalChecklist();
}

function expandElectricalChecklist() {
  const categoryButton = screen.getByRole('button', { name: /Electrical/ });
  if (categoryButton.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(categoryButton);
  }
}

function installSuccessfulUploadBrowser() {
  const previous = {
    Image: globalThis.Image,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    createObjectURL: globalThis.URL.createObjectURL,
    revokeObjectURL: globalThis.URL.revokeObjectURL,
  };

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
  window.Image = FakeImage;
  window.XMLHttpRequest = FakeXHR;
  globalThis.URL.createObjectURL = () => 'blob:amet-model-photo';
  globalThis.URL.revokeObjectURL = () => {};

  return () => {
    if (previous.Image === undefined) delete globalThis.Image;
    else globalThis.Image = previous.Image;
    if (previous.XMLHttpRequest === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = previous.XMLHttpRequest;
    if (previous.createObjectURL === undefined) delete globalThis.URL.createObjectURL;
    else globalThis.URL.createObjectURL = previous.createObjectURL;
    if (previous.revokeObjectURL === undefined) delete globalThis.URL.revokeObjectURL;
    else globalThis.URL.revokeObjectURL = previous.revokeObjectURL;
    window.Image = globalThis.Image;
    window.XMLHttpRequest = globalThis.XMLHttpRequest;
  };
}

async function uploadModelPhotoAndOpenCopyPrompt() {
  const fileInput = document.querySelector(`#fi-${SOURCE_STATUS_ID}`);
  assert.ok(fileInput, 'the hosted model checklist should expose its file input');
  fireEvent.change(fileInput, {
    target: {
      files: [new window.File(['AMET model evidence'], 'amet-model-photo.jpg', { type: 'image/jpeg' })],
    },
  });
  await screen.findByText('amet-model-photo.jpg');
  fireEvent.click(screen.getByRole('button', { name: /Upload 1 file/i }));
  return screen.findByRole('heading', { name: /Copy Model Classroom/i });
}

async function prepareCopyPrompt(options = {}) {
  const api = installHostedApi(options);
  const restoreUploadBrowser = installSuccessfulUploadBrowser();
  const view = mountUniversity();
  await openModelClassroom();
  await uploadModelPhotoAndOpenCopyPrompt();
  return { api, restoreUploadBrowser, view };
}

async function applyOnlyToRoom102(view) {
  const dialog = screen.getByRole('dialog');
  assert.ok(dialog);
  assert.equal(
    document.body.contains(dialog)
      && dialog.parentElement?.parentElement === document.body,
    true,
    'the hosted copy dialog must be portaled directly under document.body',
  );
  assert.equal(dialog.closest('form'), null);
  assert.equal(dialog.closest('.fade-in'), null);

  const checkboxes = dialog.querySelectorAll('input[type="checkbox"]');
  // One source item, four model field choices, then Room 101 and Room 102.
  assert.equal(checkboxes.length, 7);
  assert.equal(checkboxes[1].checked, true, 'photo should be the only default model field');
  assert.equal(checkboxes[2].checked, false);
  assert.equal(checkboxes[3].checked, false);
  assert.equal(checkboxes[4].checked, false);
  fireEvent.click(checkboxes[5]); // Leave the already-evidenced Room 102 as the only target.

  assert.equal(screen.queryByText(/save again before copying/i), null);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog') === null, true));
}

async function assertRoomPhoto(roomName, photoPath) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(roomName) }));
  await waitFor(() => assert.ok(screen.getByRole('heading', { name: roomName })));
  expandElectricalChecklist();
  const evidence = screen.getByRole('img', { name: 'Evidence' });
  assert.match(evidence.getAttribute('src'), new RegExp(`${photoPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  resetChecklistDraftStoreForTests();
});

test('hosted UniversityDetail copies a saved model photo to Room 102 with distinct checklist identities', async () => {
  const { api, restoreUploadBrowser, view } = await prepareCopyPrompt();
  try {
    assert.equal(api.uploadPatchCount, 1);
    const detailGetsBeforeCopy = api.detailGets;
    await applyOnlyToRoom102(view);

    assert.equal(api.bulkBodies.length, 1);
    const update = api.bulkBodies[0].updates[0];
    assert.equal(update.sourceStatusId, SOURCE_STATUS_ID);
    assert.equal(update.checklistItemId, MODEL_CHECKLIST_ITEM_ID);
    assert.deepEqual(update.classroomIds, [ROOM_102_ID]);
    assert.deepEqual(update.targetStatusIds, [ROOM_102_STATUS_ID]);
    assert.equal(update.photoUrl, COPIED_PHOTO);
    assert.equal(update.photoContentType, 'image/jpeg');
    assert.equal(Object.hasOwn(update, 'currentStatus'), false);
    assert.ok(api.detailGets > detailGetsBeforeCopy, 'a successful copy should refresh the hosted detail response');

    await assertRoomPhoto('Room 102', COPIED_PHOTO);
    fireEvent.click(screen.getByRole('button', { name: /Model Classroom \d+%/i }));
    await waitFor(() => assert.ok(screen.getByRole('heading', { name: 'Model Classroom Tracker' })));
     expandElectricalChecklist();
    assert.match(
      screen.getByRole('img', { name: 'Evidence' }).getAttribute('src'),
      new RegExp(`${COPIED_PHOTO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    );
    assert.equal(screen.queryByText(/save again before copying/i), null);
  } finally {
    view.unmount();
    restoreUploadBrowser();
  }
});

test('hosted All Classrooms retains model and Room 102 evidence after navigation and direct remount', async () => {
  const { api, restoreUploadBrowser, view } = await prepareCopyPrompt();
  try {
    await applyOnlyToRoom102(view);
    await assertRoomPhoto('Room 102', COPIED_PHOTO);
    fireEvent.click(screen.getByRole('button', { name: /Model Classroom \d+%/i }));
    await waitFor(() => assert.ok(screen.getByRole('heading', { name: 'Model Classroom Tracker' })));
     expandElectricalChecklist();
    assert.match(
      screen.getByRole('img', { name: 'Evidence' }).getAttribute('src'),
      new RegExp(`${COPIED_PHOTO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    );

    const detailGetsBeforeRemount = api.detailGets;
    view.unmount();
    const remounted = mountUniversity();
    await waitFor(() => assert.ok(screen.getAllByRole('button', { name: 'All Classrooms', exact: true }).length));
    assert.ok(api.detailGets > detailGetsBeforeRemount, 'a direct remount should reload the hosted university detail');
    await openModelClassroom();
    assert.match(
      screen.getByRole('img', { name: 'Evidence' }).getAttribute('src'),
      new RegExp(`${COPIED_PHOTO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    );
    await assertRoomPhoto('Room 102', COPIED_PHOTO);
    remounted.unmount();
  } finally {
    restoreUploadBrowser();
  }
});

test('hosted model photo copy keeps the portal open and reports a failed copy without success', async () => {
  const { api, restoreUploadBrowser, view } = await prepareCopyPrompt({ bulkFailure: true });
  try {
    const dialog = screen.getByRole('dialog');
    const checkboxes = dialog.querySelectorAll('input[type="checkbox"]');
    fireEvent.click(checkboxes[5]);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.equal(api.bulkBodies.length, 1));
    await waitFor(() => assert.ok(
      screen.getAllByRole('alert').some(alert => /temporarily busy|retry this copy/i.test(alert.textContent)),
    ));
    assert.ok(screen.getByRole('dialog'), 'a failed copy must leave the real hosted dialog open for retry');
    assert.equal(screen.queryByText(/Copied Photos/i), null);
  } finally {
    view.unmount();
    restoreUploadBrowser();
  }
});

test('hosted model photo copy disables an ambiguous Room 102 instead of guessing its checklist row', async () => {
  const { api, restoreUploadBrowser, view } = await prepareCopyPrompt({ ambiguousRoom102: true });
  try {
    const dialog = screen.getByRole('dialog');
    assert.match(dialog.textContent, /Room 102/);
    assert.match(dialog.textContent, /multiple checklist items|unavailable/i);
    const room102Checkbox = [...dialog.querySelectorAll('input[type="checkbox"]')].at(-1);
    assert.equal(room102Checkbox.disabled, true);
    assert.equal(api.bulkBodies.length, 0);
  } finally {
    view.unmount();
    restoreUploadBrowser();
  }
});

for (const failure of ['uploadFailure', 'patchFailure']) {
  test(`hosted photo ${failure} leaves the file available to retry without claiming success`, async () => {
    const api = installHostedApi({ [failure]: true });
    const restoreUploadBrowser = installSuccessfulUploadBrowser();
    const view = mountUniversity();
    try {
      await openModelClassroom();
      const input = document.querySelector(`#fi-${SOURCE_STATUS_ID}`);
      fireEvent.change(input, { target: {
        files: [new window.File(['photo'], 'retry-photo.jpg', { type: 'image/jpeg' })],
      } });
      await screen.findByText('retry-photo.jpg');
      fireEvent.click(screen.getByRole('button', { name: /Upload 1 file/i }));
      await screen.findByText(/All uploads failed|Upload failed:/);
      assert.ok(screen.getByText('retry-photo.jpg'), 'the selected file remains for retry');
      assert.equal(screen.queryByRole('heading', { name: /Copy Model Classroom/i }), null);
      assert.equal(api.state.spaces[0].checklistStatuses[0].photoUrl, null);
      assert.equal(screen.queryByRole('img', { name: 'Evidence' }), null);
      assert.equal(api.uploadPatchCount, failure === 'patchFailure' ? 1 : 0);
    } finally {
      view.unmount();
      restoreUploadBrowser();
    }
  });
}
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React, { useEffect } from 'react';
import { JSDOM } from 'jsdom';
import { AuthProvider, useAuth } from './AuthContext';
import { DataProvider, useData } from './DataContext';
import { ToastProvider } from './ToastContext';
import BulkApplyModal from '../components/forms/BulkApplyModal';
import ItemBulkApplyModal from '../components/forms/ItemBulkApplyModal';
import {
  getChecklistDraft,
  recordChecklistDraft,
  resetChecklistDraftStoreForTests,
} from '../utils/checklistDraftStore';
import {
  checklistRemarkSaveKey,
  enqueueChecklistRemarkSave,
  resetChecklistRemarkSaveQueueForTests,
} from '../utils/checklistRemarkSaveQueue';

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

const { act, cleanup, fireEvent, render, waitFor } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetChecklistDraftStoreForTests();
  resetChecklistRemarkSaveQueueForTests();
});

function response(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function rawUniversity(remarks) {
  return {
    id: 'university-1',
    name: 'Race University',
    spaces: [{
      id: 'space-1',
      name: 'model_classroom',
      spaceType: 'model_classroom',
      checklistStatuses: [{
        id: 'status-1',
        checklistItemId: 'item-1',
        currentStatus: 'In-Progress',
        remarks,
        checklistItem: {
          name: 'Generator',
          category: 'Electrical',
          sortOrder: 1,
        },
      }],
    }],
    classrooms: [],
  };
}

function rawClassroomUniversity(roomARemark = 'Room A note', roomBRemark = 'Room B note') {
  const checklistItem = {
    name: 'Generator',
    category: 'Electrical',
    sortOrder: 1,
  };
  return {
    id: 'university-1',
    name: 'Classroom University',
    spaces: [
      {
        id: 'space-a',
        name: 'Room A',
        spaceType: 'overall_classroom',
        checklistStatuses: [{
          id: 'status-a',
          spaceId: 'space-a',
          checklistItemId: 'item-1',
          currentStatus: 'In-Progress',
          remarks: roomARemark,
          checklistItem,
        }],
      },
      {
        id: 'space-b',
        name: 'Room B',
        spaceType: 'overall_classroom',
        checklistStatuses: [{
          id: 'status-b',
          spaceId: 'space-b',
          checklistItemId: 'item-1',
          currentStatus: 'In-Progress',
          remarks: roomBRemark,
          checklistItem,
        }],
      },
    ],
    classrooms: [
      { id: 'room-a', roomId: 'Room A' },
      { id: 'room-b', roomId: 'Room B' },
    ],
  };
}

test('account changes start a fresh university list request and clear initial loading', async () => {
  localStorage.setItem('niat_user', JSON.stringify({
    id: 'user-1',
    email: 'first@example.test',
    role: 'apm',
  }));
  let listCalls = 0;
  let resolveOldRefresh;
  let resolveNewInitial;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/auth/login' && options.method === 'POST') {
      return response({
        token: 'new-user-token',
        user: { id: 'user-2', email: 'second@example.test', role: 'apm' },
      });
    }
    if (url === '/api/universities') {
      listCalls += 1;
      if (listCalls === 1) return response([rawUniversity('first user')]);
      if (listCalls === 2) {
        return new Promise(resolve => { resolveOldRefresh = () => resolve(response([rawUniversity('stale user')])); });
      }
      return new Promise(resolve => {
        resolveNewInitial = () => resolve(response([{
          ...rawUniversity('second user'),
          id: 'university-2',
          name: 'Second User University',
        }]));
      });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let dataApi;
  let authApi;
  function Probe() {
    dataApi = useData();
    authApi = useAuth();
    return null;
  }
  render(<AuthProvider><DataProvider><Probe /></DataProvider></AuthProvider>);
  await waitFor(() => assert.equal(dataApi?.loading, false));

  act(() => { dataApi.refreshUniversities(); });
  await waitFor(() => assert.equal(typeof resolveOldRefresh, 'function'));
  await act(async () => {
    const result = await authApi.login('second@example.test', 'password');
    assert.equal(result.success, true);
  });
  await waitFor(() => assert.equal(typeof resolveNewInitial, 'function'));
  assert.equal(dataApi.loading, true);
  resolveNewInitial();
  await waitFor(() => assert.equal(dataApi.loading, false));
  assert.deepEqual(dataApi.universities.map(university => university.id), ['university-2']);

  resolveOldRefresh();
  await act(async () => {});
  assert.deepEqual(dataApi.universities.map(university => university.id), ['university-2']);
  assert.equal(listCalls, 3);
});

test('provider keeps load identity stable, submits sparse blanks, and rejects stale fetch responses', async () => {
  localStorage.setItem('niat_user', JSON.stringify({
    id: 'user-1',
    email: 'user@example.test',
    role: 'apm',
  }));
  let serverRemark = 'server note';
  let delayedDetail = false;
  let failNextDetail = false;
  let releaseDelayed;
  const patches = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([rawUniversity(serverRemark)]);
    if (url === '/api/universities/university-1' && (!options.method || options.method === 'GET')) {
      if (failNextDetail) {
        failNextDetail = false;
        return response({
          error: 'refresh unavailable',
          code: 'REFRESH_UNAVAILABLE',
          correlationId: 'corr-refresh-1',
        }, 503);
      }
      const snapshot = rawUniversity(serverRemark);
      if (delayedDetail) {
        delayedDetail = false;
        await new Promise(resolve => { releaseDelayed = resolve; });
      }
      return response(snapshot);
    }
    if (url === '/api/universities/university-1/status/status-1' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      patches.push(body);
      if (Object.hasOwn(body, 'remarks')) serverRemark = body.remarks;
      return response({ ok: true });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let dataApi;
  const loadIdentities = new Set();
  function Probe() {
    const api = useData();
    dataApi = api;
    loadIdentities.add(api.loadUniversityDetail);
    useEffect(() => undefined);
    return null;
  }
  render(
    <AuthProvider>
      <DataProvider>
        <Probe />
      </DataProvider>
    </AuthProvider>,
  );
  await waitFor(() => assert.equal(dataApi?.loading, false));

  await act(async () => {
    await dataApi.loadUniversityDetail('university-1', true);
  });
  assert.equal(loadIdentities.size, 1);

  recordChecklistDraft(
    'university-1',
    { id: 'status-1', name: 'Generator', remarks: 'server note' },
    { remarks: '' },
  );
  let saveResult;
  await act(async () => {
    saveResult = await dataApi.updateUniversity('university-1', 'modelClassroom', {
      items: [{ id: 'status-1' }],
    });
  });
  assert.equal(saveResult.committed, true);
  assert.deepEqual(patches[0], { remarks: '' });

  delayedDetail = true;
  let staleLoad;
  await act(async () => {
    staleLoad = dataApi.loadUniversityDetail('university-1', true);
    await waitFor(() => assert.equal(typeof releaseDelayed, 'function'));
  });
  recordChecklistDraft(
    'university-1',
    { id: 'status-1', name: 'Generator', remarks: '' },
    { remarks: 'newest saved note' },
  );
  await act(async () => {
    await dataApi.patchChecklistStatus('university-1', 'status-1', {
      remarks: 'newest saved note',
    });
  });
  releaseDelayed();
  await act(async () => {
    await staleLoad;
  });

  assert.equal(
    dataApi.getUniversity('university-1').trackers.modelClassroom.items[0].remarks,
    'newest saved note',
  );
  assert.equal(loadIdentities.size, 1);

  recordChecklistDraft(
    'university-1',
    { id: 'status-1', name: 'Generator', remarks: 'newest saved note' },
    { capacity: '80 KVA' },
  );
  failNextDetail = true;
  let refreshFailureResult;
  await act(async () => {
    refreshFailureResult = await dataApi.updateUniversity('university-1', 'modelClassroom', {
      items: [{ id: 'status-1' }],
    });
  });
  assert.equal(refreshFailureResult.committed, true);
  assert.equal(refreshFailureResult.refreshed, false);
  assert.match(refreshFailureResult.refreshError.message, /refresh unavailable/);
  assert.equal(refreshFailureResult.refreshError.code, 'REFRESH_UNAVAILABLE');
  assert.equal(refreshFailureResult.refreshError.correlationId, 'corr-refresh-1');

  recordChecklistDraft(
    'university-1',
    { id: 'status-target', name: 'Target Generator' },
    { remarks: 'pending target edit' },
  );
  await assert.rejects(
    dataApi.patchChecklistBulk('university-1', [{
      checklistItemId: 'item-1',
      spaceIds: ['space-target'],
      currentStatus: 'Done',
      targetStatusIds: ['status-target'],
    }]),
    /Target Generator.*pending local edit/,
  );
});

test('manual Save reports an already-completed, pending, and remark-only save without duplicate writes', async () => {
  localStorage.setItem('niat_user', JSON.stringify({
    id: 'user-1',
    email: 'user@example.test',
    role: 'apm',
  }));
  let releasePending;
  let pendingPatch = false;
  const patches = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([rawUniversity('server note')]);
    if (url === '/api/universities/university-1' && (!options.method || options.method === 'GET')) {
      return response(rawUniversity('server note'));
    }
    if (url === '/api/universities/university-1/status/status-1' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      patches.push(body);
      if (pendingPatch) await new Promise(resolve => { releasePending = resolve; });
      return response({ ok: true });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let dataApi;
  function Probe() {
    dataApi = useData();
    return null;
  }
  render(
    <AuthProvider>
      <DataProvider>
        <Probe />
      </DataProvider>
    </AuthProvider>,
  );
  await waitFor(() => assert.equal(dataApi?.loading, false));
  await act(async () => { await dataApi.loadUniversityDetail('university-1', true); });
  const item = dataApi.getUniversity('university-1').trackers.modelClassroom.items[0];

  recordChecklistDraft('university-1', item, { remarks: 'autosaved note' });
  await act(async () => {
    await dataApi.patchChecklistStatus('university-1', item.id, { remarks: 'autosaved note' });
  });
  let result;
  await act(async () => {
    result = await dataApi.updateUniversity('university-1', 'modelClassroom', {
      items: [{ id: item.id, remarks: 'autosaved note' }],
    });
  });
  assert.equal(result.writeCount, 0);
  assert.equal(result.savedRemarks, true);
  assert.equal(result.remarkOnly, true);
  assert.equal(patches.length, 1);

  recordChecklistDraft('university-1', item, { remarks: 'manual note' });
  await act(async () => {
    result = await dataApi.updateUniversity('university-1', 'modelClassroom', {
      items: [{ id: item.id, remarks: 'manual note' }],
    });
  });
  assert.equal(result.writeCount, 1);
  assert.equal(result.remarkOnly, true);
  assert.equal(patches.length, 2);

  recordChecklistDraft('university-1', item, { remarks: 'mixed note', status: 'Done' });
  await act(async () => {
    result = await dataApi.updateUniversity('university-1', 'modelClassroom', {
      items: [{ id: item.id, remarks: 'mixed note', status: 'Done' }],
    });
  });
  assert.equal(result.writeCount, 1);
  assert.equal(result.remarkOnly, false);
  assert.equal(result.nonRemarkWriteCount, 1);
  assert.equal(patches.length, 3);

  await act(async () => {
    result = await dataApi.updateUniversity('university-1', 'modelClassroom', {
      items: [{ id: item.id, remarks: 'mixed note' }],
    });
  });
  assert.equal(result.writeCount, 0);
  assert.equal(result.savedRemarks, false);
  assert.equal(result.remarkOnly, false);

  pendingPatch = true;
  const pending = dataApi.patchChecklistStatus('university-1', item.id, { remarks: 'in-flight note' });
  await waitFor(() => assert.equal(typeof releasePending, 'function'));
  const manualWhilePending = dataApi.updateUniversity('university-1', 'modelClassroom', {
    items: [{ id: item.id, remarks: 'in-flight note' }],
  });
  releasePending();
  await act(async () => { result = await manualWhilePending; });
  assert.equal(result.writeCount, 0);
  assert.equal(result.savedRemarks, true);
  assert.equal(result.remarkOnly, true);
  assert.equal(patches.length, 4);
  await act(async () => { await pending; });
});

test('a failed remark save keeps the draft when the same record reloads', async () => {
  localStorage.setItem('niat_user', JSON.stringify({
    id: 'user-1',
    email: 'user@example.test',
    role: 'apm',
  }));
  let serverRemark = 'AC saved note';
  const raw = () => ({
    ...rawUniversity(serverRemark),
    spaces: [{
      ...rawUniversity(serverRemark).spaces[0],
      checklistStatuses: [{
        ...rawUniversity(serverRemark).spaces[0].checklistStatuses[0],
        checklistItem: {
          ...rawUniversity(serverRemark).spaces[0].checklistStatuses[0].checklistItem,
          name: 'AC Installation',
        },
      }],
    }],
  });
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([raw()]);
    if (url === '/api/universities/university-1' && (!options.method || options.method === 'GET')) {
      return response(raw());
    }
    if (url === '/api/universities/university-1/status/status-1' && options.method === 'PATCH') {
      return response({
        error: 'remark save failed',
        code: 'REMARK_SAVE_FAILED',
        correlationId: 'corr-ac-remark',
      }, 503);
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let dataApi;
  function Probe() {
    dataApi = useData();
    return null;
  }
  render(
    <AuthProvider>
      <DataProvider>
        <Probe />
      </DataProvider>
    </AuthProvider>,
  );
  await waitFor(() => assert.equal(dataApi?.loading, false));
  await act(async () => { await dataApi.loadUniversityDetail('university-1', true); });

  const item = dataApi.getUniversity('university-1').trackers.modelClassroom.items[0];
  recordChecklistDraft('university-1', item, { remarks: 'AC draft while offline' });
  await assert.rejects(
    dataApi.patchChecklistStatus('university-1', item.id, { remarks: 'AC draft while offline' }),
    error => error?.code === 'REMARK_SAVE_FAILED',
  );

  await act(async () => { await dataApi.loadUniversityDetail('university-1', true); });
  const reloaded = dataApi.getUniversity('university-1').trackers.modelClassroom.items[0];
  assert.equal(reloaded.remarks, 'AC draft while offline');
  assert.equal(getChecklistDraft('university-1', item.id).failed, true);
  assert.equal(serverRemark, 'AC saved note');
});

test('saved photo references survive detail reload in every checklist module; explicit removal never revives history', async () => {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'photo-user', role: 'admin' }));
  const paths = ['model_classroom', 'lab', 'staff_room', 'overall_classroom'];
  const raw = {
    id: 'university-1',
    name: 'Evidence University',
    spaces: paths.map((spaceType, index) => ({
      id: `space-${index}`,
      name: index === 3 ? 'Room A' : spaceType,
      spaceType,
      checklistStatuses: [{
        id: `status-${index}`,
        spaceId: `space-${index}`,
        checklistItemId: `item-${index}`,
        checklistItem: { name: 'Electrical panel', category: 'Electrical', sortOrder: 1 },
        currentStatus: 'In-Progress',
        remarks: 'Retain this note',
        photoUrl: `/objects/photo-${index}.jpg`,
        photoContentType: 'image/jpeg',
        photoHistory: [{ photoUrl: `/objects/photo-${index}.jpg`, contentType: 'image/jpeg' }],
      }],
    })),
    classrooms: [{ id: 'room-a', roomId: 'Room A', spaceId: 'space-3' }],
  };
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([{ id: raw.id, name: raw.name }]);
    if (url === '/api/universities/university-1') return response(JSON.parse(JSON.stringify(raw)));
    if (url === '/api/universities/university-1/status/status-3' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      assert.deepEqual(body, { photoUrl: '', photoContentType: null });
      raw.spaces[3].checklistStatuses[0].photoUrl = null;
      raw.spaces[3].checklistStatuses[0].photoContentType = null;
      return response(raw.spaces[3].checklistStatuses[0]);
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };
  let dataApi;
  function Probe() { dataApi = useData(); return null; }
  render(<AuthProvider><DataProvider><Probe /></DataProvider></AuthProvider>);
  await waitFor(() => assert.equal(dataApi?.loading, false));
  const getItems = () => {
    const trackers = dataApi.getUniversity('university-1').trackers;
    return [trackers.modelClassroom.items[0], trackers.lab5.items[0],
      trackers.staffRoom.items[0], trackers.overallClassroom.classrooms[0].items[0]];
  };
  await act(async () => { await dataApi.loadUniversityDetail('university-1', true); });
  for (let index = 0; index < 4; index += 1) {
    assert.equal(getItems()[index].photoLink, `/objects/photo-${index}.jpg`);
  }
  await act(async () => { await dataApi.loadUniversityDetail('university-1', true); });
  assert.equal(getItems()[3].photoLink, '/objects/photo-3.jpg');
  await act(async () => {
    await dataApi.patchChecklistStatus('university-1', 'status-3', { photoUrl: '', photoContentType: null });
    await dataApi.loadUniversityDetail('university-1', true);
  });
  assert.equal(getItems()[3].photoLink, '');
  assert.equal(getItems()[3].photoContentType, null);
  assert.equal(getItems()[3].photoHistory.length, 1);
  assert.equal(getItems()[3].remarks, 'Retain this note');
  assert.equal(getItems()[0].photoLink, '/objects/photo-0.jpg');
});

test('bulk admission preserves model markers, positional identities, selected blanks, and rejects unsupported markers', async () => {
  localStorage.setItem('niat_user', JSON.stringify({
    id: 'user-1',
    email: 'user@example.test',
    role: 'apm',
  }));
  const raw = rawClassroomUniversity();
  let posted;
  let bulkPosts = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([raw]);
    if (url === '/api/universities/university-1/status/bulk' && options.method === 'POST') {
      bulkPosts += 1;
      posted = JSON.parse(options.body);
      return response({
        applied: 1,
        skipped: 0,
        results: [{
          statusId: 'status-b',
          outcome: 'applied',
          row: {
            id: 'status-b',
            currentStatus: 'In-Progress',
            remarks: 'target remark',
            photoUrl: null,
            photoContentType: null,
          },
        }],
      });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let dataApi;
  function Probe() {
    dataApi = useData();
    return null;
  }
  render(
    <AuthProvider>
      <DataProvider>
        <Probe />
      </DataProvider>
    </AuthProvider>,
  );
  await waitFor(() => assert.equal(dataApi?.loading, false));
  assert.equal(
    dataApi.getUniversity('university-1').classrooms[0].items[0].checklistSemanticKey,
    'electrical\0generator',
  );

  const update = {
    checklistItemId: 'item-1',
    sourceStatusId: 'status-a',
    classroomIds: ['room-b'],
    spaceIds: ['space-b'],
    targetStatusIds: ['status-b'],
    remarks: '',
    universityTimeline: 'selected timeline',
    sourceSpaceType: 'model_classroom',
    skipBlankValues: true,
  };
  await act(async () => {
    await dataApi.patchChecklistBulk('university-1', [update]);
  });
  assert.deepEqual(posted, { updates: [update] });
  assert.equal(bulkPosts, 1);

  await assert.rejects(
    dataApi.patchChecklistBulk('university-1', [{
      ...update,
      sourceSpaceType: 'overall_classroom',
    }]),
    (error) => error?.code === 'CHECKLIST_SOURCE_SPACE_TYPE_INVALID',
  );
  assert.equal(bulkPosts, 1);
});

test('real provider and bulk modal reject a target whose autosave is still pending', async () => {
  localStorage.setItem('niat_user', JSON.stringify({
    id: 'user-1',
    email: 'user@example.test',
    role: 'apm',
  }));
  const raw = rawClassroomUniversity();
  let releaseTargetSave;
  let bulkPosts = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([raw]);
    if (url === '/api/universities/university-1/status/status-b' && options.method === 'PATCH') {
      await new Promise(resolve => { releaseTargetSave = resolve; });
      return response({
        error: 'target autosave rejected',
        correlationId: 'corr-target-save',
      }, 503);
    }
    if (url === '/api/universities/university-1/status/bulk' && options.method === 'POST') {
      bulkPosts += 1;
      return response({ applied: 1, skipped: 0 });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let dataApi;
  function Probe() {
    dataApi = useData();
    const university = dataApi.getUniversity('university-1');
    const sourceRoom = university?.classrooms?.find(room => room.id === 'room-a');
    if (!sourceRoom?.items?.length) return null;
    return (
      <BulkApplyModal
        universityId="university-1"
        savedItems={sourceRoom.items}
        classrooms={university.classrooms}
        currentClassroomId="room-a"
        onClose={() => undefined}
        onApplied={() => undefined}
      />
    );
  }
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <Probe />
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
  await waitFor(() => assert.ok(view.getByText('Apply to Other Classrooms')));

  recordChecklistDraft(
    'university-1',
    { id: 'status-b', name: 'Generator' },
    { remarks: 'pending Room B note' },
  );
  let targetSave;
  act(() => {
    targetSave = dataApi.patchChecklistStatus('university-1', 'status-b', {
      remarks: 'pending Room B note',
    }).catch(error => error);
  });
  await waitFor(() => assert.equal(typeof releaseTargetSave, 'function'));

  fireEvent.click(view.getByRole('button', { name: 'Apply' }));
  await waitFor(() => assert.match(
    view.getAllByText(/Bulk copy failed:/)[0].textContent,
    /Generator.*pending local edit/,
  ));
  assert.equal(bulkPosts, 0);

  releaseTargetSave();
  await act(async () => {
    const saveError = await targetSave;
    assert.equal(saveError.correlationId, 'corr-target-save');
  });
});

test('bulk source admission scopes draft conflicts to the fields being copied', async () => {
  localStorage.setItem('niat_user', JSON.stringify({
    id: 'user-1',
    email: 'user@example.test',
    role: 'apm',
  }));
  const raw = rawClassroomUniversity();
  let bulkPosts = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([raw]);
    if (url === '/api/universities/university-1/status/bulk' && options.method === 'POST') {
      bulkPosts += 1;
      return response({
        results: [{
          statusId: 'status-b',
          outcome: 'applied',
          row: { currentStatus: 'In-Progress', remarks: 'copied note' },
        }],
      });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let dataApi;
  function Probe() {
    dataApi = useData();
    return null;
  }
  render(
    <AuthProvider>
      <DataProvider>
        <Probe />
      </DataProvider>
    </AuthProvider>,
  );
  await waitFor(() => assert.equal(dataApi?.loading, false));

  const update = {
    checklistItemId: 'item-1',
    sourceStatusId: 'status-a',
    classroomIds: ['room-b'],
    spaceIds: ['space-b'],
    targetStatusIds: ['status-b'],
    remarks: 'copied note',
  };
  recordChecklistDraft('university-1', { id: 'status-a', name: 'Generator' }, {
    status: 'Done',
  });
  await act(async () => { await dataApi.patchChecklistBulk('university-1', [update]); });
  assert.equal(bulkPosts, 1, 'an unrelated source draft must not block a field-scoped copy');

  recordChecklistDraft('university-1', { id: 'status-a', name: 'Generator' }, {
    remarks: 'newer source note',
  });
  await assert.rejects(
    dataApi.patchChecklistBulk('university-1', [update]),
    error => error?.code === 'CHECKLIST_BULK_DRAFT_CONFLICT',
  );
  assert.equal(bulkPosts, 1, 'a newer draft for the copied source field must remain guarded');
});

test('bulk copy waits for an active source save and uses its acknowledged snapshot', async () => {
  localStorage.setItem('niat_user', JSON.stringify({
    id: 'user-1',
    email: 'user@example.test',
    role: 'apm',
  }));
  const raw = rawClassroomUniversity();
  let releaseSourceSave;
  let sourceRemark = 'saved source note';
  let bulkPosts = 0;
  let posted;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([raw]);
    if (url === '/api/universities/university-1' && (!options.method || options.method === 'GET')) {
      return response(rawClassroomUniversity(sourceRemark));
    }
    if (url === '/api/universities/university-1/status/status-a' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      sourceRemark = body.remarks;
      await new Promise(resolve => { releaseSourceSave = resolve; });
      return response({ ok: true });
    }
    if (url === '/api/universities/university-1/status/bulk' && options.method === 'POST') {
      bulkPosts += 1;
      posted = JSON.parse(options.body);
      return response({
        applied: 1,
        skipped: 0,
        results: [{
          statusId: 'status-b',
          outcome: 'applied',
          row: { currentStatus: 'In-Progress', remarks: sourceRemark },
        }],
      });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let dataApi;
  function Probe() {
    dataApi = useData();
    const university = dataApi.getUniversity('university-1');
    const sourceRoom = university?.classrooms?.find(room => room.id === 'room-a');
    if (!sourceRoom?.items?.length) return null;
    return (
      <BulkApplyModal
        universityId="university-1"
        savedItems={sourceRoom.items}
        classrooms={university.classrooms}
        currentClassroomId="room-a"
        onClose={() => undefined}
        onApplied={() => undefined}
      />
    );
  }
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <Probe />
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
  await waitFor(() => assert.ok(view.getByText('Apply to Other Classrooms')));

  recordChecklistDraft(
    'university-1',
    { id: 'status-a', name: 'Generator' },
    { remarks: 'saved source note' },
  );
  let sourceSave;
  act(() => {
    sourceSave = dataApi.patchChecklistStatus('university-1', 'status-a', {
      remarks: 'saved source note',
    });
  });
  await waitFor(() => assert.equal(typeof releaseSourceSave, 'function'));

  fireEvent.click(view.getByRole('button', { name: 'Apply' }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(bulkPosts, 0, 'bulk copy must wait for the active source writer');

  releaseSourceSave();
  await act(async () => { await sourceSave; });
  await waitFor(() => assert.equal(bulkPosts, 1));
  assert.equal(posted.updates[0].remarks, 'saved source note');
});

test('a slow sibling manual save cannot restore an older item after its newer autosave commits', async () => {
  localStorage.setItem('niat_user', JSON.stringify({
    id: 'user-1',
    email: 'user@example.test',
    role: 'apm',
  }));
  let serverARemark = 'server A';
  let serverBRemark = 'server B';
  let failRefresh = false;
  const patched = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') {
      return response([rawClassroomUniversity(serverARemark, serverBRemark)]);
    }
    if (url === '/api/universities/university-1' && (!options.method || options.method === 'GET')) {
      if (failRefresh) {
        return response({ error: 'refresh unavailable' }, 503);
      }
      return response(rawClassroomUniversity(serverARemark, serverBRemark));
    }
    const statusMatch = url.match(/^\/api\/universities\/university-1\/status\/(status-[ab])$/);
    if (statusMatch && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      patched.push([statusMatch[1], body.remarks]);
      if (statusMatch[1] === 'status-a') serverARemark = body.remarks;
      else serverBRemark = body.remarks;
      return response({ ok: true });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let dataApi;
  let setFormMounted;
  function Probe() {
    dataApi = useData();
    const [formMounted, setMounted] = React.useState(true);
    setFormMounted = setMounted;
    const roomA = dataApi.getUniversity('university-1')
      ?.classrooms?.find(room => room.id === 'room-a');
    return formMounted
      ? <output data-testid="room-a-remark">{roomA?.items?.[0]?.remarks || ''}</output>
      : null;
  }
  const view = render(
    <AuthProvider>
      <DataProvider>
        <Probe />
      </DataProvider>
    </AuthProvider>,
  );
  await waitFor(() => assert.equal(dataApi?.loading, false));

  let releaseSiblingQueue;
  const siblingBlocker = enqueueChecklistRemarkSave(
    checklistRemarkSaveKey('university-1', 'status-b'),
    'queued B',
    () => new Promise(resolve => { releaseSiblingQueue = resolve; }),
    { coalesce: false },
  );
  await waitFor(() => assert.equal(typeof releaseSiblingQueue, 'function'));

  recordChecklistDraft(
    'university-1',
    { id: 'status-a', name: 'Generator' },
    { remarks: 'older manual A' },
  );
  recordChecklistDraft(
    'university-1',
    { id: 'status-b', name: 'Generator' },
    { remarks: 'manual B' },
  );
  let manualSave;
  act(() => {
    manualSave = dataApi.updateUniversity('university-1', 'overallClassroom', {
      classrooms: [{
        items: [{ id: 'status-a' }, { id: 'status-b' }],
      }],
    });
  });
  await waitFor(() => assert.deepEqual(patched, [['status-a', 'older manual A']]));

  recordChecklistDraft(
    'university-1',
    { id: 'status-a', name: 'Generator' },
    { remarks: 'newest autosave A' },
  );
  await act(async () => {
    await dataApi.patchChecklistStatus('university-1', 'status-a', {
      remarks: 'newest autosave A',
    });
  });

  failRefresh = true;
  releaseSiblingQueue();
  await siblingBlocker;
  let outcome;
  await act(async () => {
    outcome = await manualSave;
  });
  assert.equal(outcome.committed, true);
  assert.equal(outcome.refreshed, false);
  assert.deepEqual(patched, [
    ['status-a', 'older manual A'],
    ['status-a', 'newest autosave A'],
    ['status-b', 'manual B'],
  ]);

  const remountedRoomA = dataApi.getUniversity('university-1')
    .classrooms.find(room => room.id === 'room-a');
  assert.equal(remountedRoomA.items[0].remarks, 'newest autosave A');
  act(() => setFormMounted(false));
  act(() => setFormMounted(true));
  assert.equal(view.getByTestId('room-a-remark').textContent, 'newest autosave A');
});

test('classroom normalization fails closed on duplicate registry names and non-classroom matches', async () => {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role: 'apm' }));
  const raw = rawClassroomUniversity();
  raw.classrooms.push({ id: 'duplicate-a', roomId: ' room a ' });
  raw.spaces[1].spaceType = 'lab';
  globalThis.fetch = async () => response([raw]);
  let api;
  function Probe() { api = useData(); return null; }
  render(<AuthProvider><DataProvider><Probe /></DataProvider></AuthProvider>);
  await waitFor(() => assert.equal(api?.loading, false));
  for (const room of api.getUniversity('university-1').classrooms) {
    assert.equal(room.spaceId, null);
    assert.deepEqual(room.items, []);
    assert.match(room.associationError, /administrator.*resolve/);
  }
});

test('explicit classroom spaceId wins over duplicate names and preserves its checklist statuses', async () => {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role: 'apm' }));
  const raw = {
    id: 'university-1',
    name: 'Explicit Association University',
    spaces: [
      {
        id: 'space-wrong',
        name: 'Room A',
        spaceType: 'overall_classroom',
        checklistStatuses: [{ id: 'wrong-status', currentStatus: 'Done', checklistItem: { name: 'Wrong', category: 'General' } }],
      },
      {
        id: 'space-right',
        name: 'Room A',
        spaceType: 'overall_classroom',
        checklistStatuses: [{ id: 'right-status', currentStatus: 'Blocker', checklistItem: { name: 'Generator', category: 'Electrical' } }],
      },
    ],
    classrooms: [{ id: 'room-a', roomId: 'Room A', spaceId: 'space-right' }],
  };
  globalThis.fetch = async () => response([raw]);
  let api;
  function Probe() { api = useData(); return null; }
  render(<AuthProvider><DataProvider><Probe /></DataProvider></AuthProvider>);
  await waitFor(() => assert.equal(api?.loading, false));
  const room = api.getUniversity('university-1').classrooms[0];
  assert.equal(room.associationState, 'resolved');
  assert.equal(room.spaceId, 'space-right');
  assert.equal(room.items[0].id, 'right-status');
  assert.equal(room.items[0].status, 'Blocker');
});

test('explicit null classroom spaceId fails closed on duplicate matches while exposing active candidates', async () => {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role: 'apm' }));
  const raw = {
    id: 'university-1',
    name: 'Unlinked University',
    spaces: [
      { id: 'space-a', name: 'Room A', spaceType: 'overall_classroom', checklistStatuses: [{ id: 'status-a' }] },
      { id: 'space-a-legacy', name: ' room a ', spaceType: 'overall_classroom', checklistStatuses: [{ id: 'status-a2' }] },
      { id: 'space-b', name: 'Room B', spaceType: 'overall_classroom', checklistStatuses: [{ id: 'status-b' }, { id: 'status-b2' }] },
    ],
    classrooms: [{ id: 'room-a', roomId: 'Room A', spaceId: null }],
  };
  globalThis.fetch = async () => response([raw]);
  let api;
  function Probe() { api = useData(); return null; }
  render(<AuthProvider><DataProvider><Probe /></DataProvider></AuthProvider>);
  await waitFor(() => assert.equal(api?.loading, false));
  const room = api.getUniversity('university-1').classrooms[0];
  assert.equal(room.associationState, 'ambiguous');
  assert.equal(room.spaceId, null);
  assert.deepEqual(room.items, []);
  assert.deepEqual(room.associationCandidates.map(candidate => [candidate.id, candidate.checklistCount]), [
    ['space-a', 1],
    ['space-a-legacy', 1],
    ['space-b', 2],
  ]);
});

test('current evidence wins over tied legacy history after reload', async () => {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role: 'apm' }));
  const raw = rawClassroomUniversity();
  Object.assign(raw.spaces[1].checklistStatuses[0], {
    photoUrl: '/objects/current.png', photoContentType: 'image/png',
    photoHistory: [
      { photoUrl: '/objects/legacy.jpg', contentType: 'image/jpeg', uploadedAt: '2026-09-12T00:00:00Z' },
      { photoUrl: '/objects/current.png', contentType: 'image/png', uploadedAt: '2026-09-12T00:00:00Z' },
    ],
  });
  globalThis.fetch = async url => response(url === '/api/universities' ? [raw] : raw);
  let api;
  function Probe() { api = useData(); return null; }
  render(<AuthProvider><DataProvider><Probe /></DataProvider></AuthProvider>);
  await waitFor(() => assert.equal(api?.loading, false));
  await act(async () => { await api.loadUniversityDetail('university-1', true); });
  const item = api.getUniversity('university-1').classrooms[1].items[0];
  assert.equal(item.photoLink, '/objects/current.png');
  assert.equal(item.photoContentType, 'image/png');
});

test('explicit evidence removal stays empty after Yet to start save and reload', async () => {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role: 'apm' }));
  let currentPhoto = '/objects/current.png';
  const patches = [];
  const raw = () => {
    const university = rawUniversity('server note');
    const status = university.spaces[0].checklistStatuses[0];
    status.currentStatus = 'Yet to start';
    status.photoUrl = currentPhoto;
    status.photoContentType = currentPhoto ? 'image/png' : null;
    status.photoHistory = [
      { id: 'photo-current', photoUrl: '/objects/current.png', contentType: 'image/png' },
      { id: 'photo-old', photoUrl: '/objects/old.png', contentType: 'image/png' },
    ];
    return university;
  };
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([raw()]);
    if (url === '/api/universities/university-1' && (!options.method || options.method === 'GET')) {
      return response(raw());
    }
    if (url === '/api/universities/university-1/status/status-1' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      patches.push(body);
      if (Object.hasOwn(body, 'photoUrl')) currentPhoto = body.photoUrl || null;
      return response({ ok: true });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let api;
  function Probe() {
    api = useData();
    return null;
  }
  render(<AuthProvider><DataProvider><Probe /></DataProvider></AuthProvider>);
  await waitFor(() => assert.equal(api?.loading, false));

  const item = api.getUniversity('university-1').trackers.modelClassroom.items[0];
  assert.equal(item.status, 'Yet to start');
  assert.equal(item.photoLink, '/objects/current.png');
  recordChecklistDraft('university-1', item, {
    photoLink: '',
    photoContentType: null,
  });

  let result;
  await act(async () => {
    result = await api.updateUniversity('university-1', 'modelClassroom', {
      items: [{ id: item.id }],
    });
  });
  assert.equal(result.committed, true);
  assert.deepEqual(patches, [{ photoUrl: '', photoContentType: null }]);

  const saved = api.getUniversity('university-1').trackers.modelClassroom.items[0];
  assert.equal(saved.photoLink, '');
  assert.equal(saved.photoContentType, null);
  assert.deepEqual(
    saved.photoHistory.map(entry => entry.photoUrl),
    ['/objects/current.png', '/objects/old.png'],
  );

  await act(async () => {
    await api.loadUniversityDetail('university-1', true);
  });
  const reloaded = api.getUniversity('university-1').trackers.modelClassroom.items[0];
  assert.equal(reloaded.photoLink, '');
  assert.equal(reloaded.photoContentType, null);
});

test('manual evidence removal waits for an in-flight remark and keeps the newer draft', async () => {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role: 'apm' }));
  let currentPhoto = '/objects/current.png';
  let serverRemark = 'server note';
  let releaseAutosave;
  const patches = [];
  const raw = () => {
    const university = rawUniversity(serverRemark);
    const status = university.spaces[0].checklistStatuses[0];
    status.currentStatus = 'Yet to start';
    status.photoUrl = currentPhoto;
    status.photoContentType = currentPhoto ? 'image/png' : null;
    status.photoHistory = [
      { id: 'photo-current', photoUrl: '/objects/current.png', contentType: 'image/png' },
      { id: 'photo-old', photoUrl: '/objects/old.png', contentType: 'image/png' },
    ];
    return university;
  };
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([raw()]);
    if (url === '/api/universities/university-1' && (!options.method || options.method === 'GET')) {
      return response(raw());
    }
    if (url === '/api/universities/university-1/status/status-1' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      patches.push(body);
      if (body.remarks === 'autosaved remark') {
        await new Promise(resolve => { releaseAutosave = resolve; });
      }
      if (Object.hasOwn(body, 'remarks')) serverRemark = body.remarks;
      if (Object.hasOwn(body, 'photoUrl')) currentPhoto = body.photoUrl || null;
      return response({ ok: true });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let api;
  function Probe() {
    api = useData();
    return null;
  }
  render(<AuthProvider><DataProvider><Probe /></DataProvider></AuthProvider>);
  await waitFor(() => assert.equal(api?.loading, false));

  const item = api.getUniversity('university-1').trackers.modelClassroom.items[0];
  recordChecklistDraft('university-1', item, { remarks: 'autosaved remark' });
  let autosave;
  act(() => {
    autosave = api.patchChecklistStatus('university-1', item.id, {
      remarks: 'autosaved remark',
    });
  });
  await waitFor(() => assert.equal(typeof releaseAutosave, 'function'));

  recordChecklistDraft('university-1', item, {
    remarks: 'manual remark',
    photoLink: '',
    photoContentType: null,
  });
  let manualSave;
  act(() => {
    manualSave = api.updateUniversity('university-1', 'modelClassroom', {
      items: [{ id: item.id }],
    });
  });
  releaseAutosave();
  await act(async () => {
    await autosave;
    await manualSave;
  });

  assert.deepEqual(patches, [
    { remarks: 'autosaved remark' },
    { remarks: 'manual remark', photoUrl: '', photoContentType: null },
  ]);
  const saved = api.getUniversity('university-1').trackers.modelClassroom.items[0];
  assert.equal(saved.remarks, 'manual remark');
  assert.equal(saved.photoLink, '');
  assert.equal(saved.photoContentType, null);
  assert.deepEqual(
    saved.photoHistory.map(entry => entry.photoUrl),
    ['/objects/current.png', '/objects/old.png'],
  );
});

test('bulk acknowledgements update destinations immediately and cannot overwrite newer queued remarks', async () => {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role: 'apm' }));
  const raw = rawClassroomUniversity();
  let releaseCopy;
  let api;
  let copiedRequest;
  const writes = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([raw]);
    if (url.endsWith('/status/bulk')) {
      copiedRequest = JSON.parse(options.body).updates[0];
      writes.push('copy');
      await new Promise(resolve => { releaseCopy = resolve; });
      return response({
        applied: 1, skipped: 0,
        results: [{
          statusId: 'status-b', outcome: 'applied',
          row: {
            id: 'status-b', currentStatus: 'In-Progress', remarks: 'copied note',
            photoUrl: '/objects/copied.png', photoContentType: 'image/png',
            photoHistory: [{ id: 'photo-new', photoUrl: '/objects/copied.png', contentType: 'image/png' }],
          },
        }],
      });
    }
    if (url.endsWith('/status/status-b')) {
      writes.push(JSON.parse(options.body).remarks);
      return response({ remarks: JSON.parse(options.body).remarks });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  function Probe() { api = useData(); return null; }
  render(<AuthProvider><DataProvider><Probe /></DataProvider></AuthProvider>);
  await waitFor(() => assert.equal(api?.loading, false));
  let copy;
  act(() => {
    copy = api.patchChecklistBulk('university-1', [{
      sourceStatusId: 'status-a', checklistItemId: 'item-1',
      classroomIds: ['room-b'], spaceIds: ['space-b'], targetStatusIds: ['status-b'],
      remarks: 'copied note', photoUrl: '/objects/copied.png', photoContentType: 'image/png',
    }]);
  });
  await waitFor(() => assert.equal(typeof releaseCopy, 'function'));
  assert.deepEqual(copiedRequest.targetStatusIds, ['status-b']);
  recordChecklistDraft('university-1', { id: 'status-b', name: 'Generator' }, { remarks: 'newer note' });
  let newer;
  act(() => { newer = api.patchChecklistStatus('university-1', 'status-b', { remarks: 'newer note' }); });
  await act(async () => { releaseCopy(); await Promise.all([copy, newer]); });
  const rooms = api.getUniversity('university-1').classrooms;
  assert.deepEqual(writes, ['copy', 'newer note']);
  assert.equal(rooms[1].items[0].remarks, 'newer note');
  assert.equal(rooms[1].items[0].photoLink, '/objects/copied.png');
  assert.equal(rooms[1].items[0].photoContentType, 'image/png');
  assert.equal(rooms[1].items[0].photoHistory.length, 1);
  assert.equal(rooms[0].items[0].remarks, 'Room A note');
});

test('whole-classroom copy keeps selections, blocks dismiss, and explicitly retries a busy write', async () => {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role: 'apm' }));
  const raw = rawClassroomUniversity();
  let releaseBusy;
  let bulkPosts = 0;
  let closes = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([raw]);
    if (url === '/api/universities/university-1' && (!options.method || options.method === 'GET')) {
      return response(raw);
    }
    if (url === '/api/universities/university-1/status/bulk' && options.method === 'POST') {
      bulkPosts += 1;
      if (bulkPosts === 1) {
        await new Promise(resolve => { releaseBusy = resolve; });
        return response({
          error: 'Checklist save is temporarily busy. No changes were saved; retry this save.',
          code: 'CHECKLIST_SAVE_BUSY',
          correlationId: 'corr-whole-busy',
        }, 503);
      }
      return response({
        applied: 1,
        skipped: 0,
        results: [{
          statusId: 'status-b',
          outcome: 'applied',
          row: {
            id: 'status-b',
            currentStatus: 'In-Progress',
            remarks: 'Room A note',
          },
        }],
      });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let dataApi;
  function Probe() {
    dataApi = useData();
    const university = dataApi.getUniversity('university-1');
    const sourceRoom = university?.classrooms?.find(room => room.id === 'room-a');
    if (!sourceRoom?.items?.length) return null;
    return (
      <BulkApplyModal
        universityId="university-1"
        savedItems={sourceRoom.items}
        classrooms={university.classrooms}
        currentClassroomId="room-a"
        onClose={() => { closes += 1; }}
      />
    );
  }
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <Probe />
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
  await waitFor(() => assert.ok(view.getByText('Apply to Other Classrooms')));

  fireEvent.click(view.getByRole('button', { name: 'Apply' }));
  await waitFor(() => assert.equal(typeof releaseBusy, 'function'));
  assert.equal(view.getByRole('button', { name: /Applying/ }).disabled, true);
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(view.getByRole('button', { name: 'Close' }));
  assert.equal(closes, 0);

  releaseBusy();
  await waitFor(() => assert.match(
    view.getByRole('alert').textContent,
    /temporarily busy.*retry this copy/i,
  ));
  assert.ok(view.getByRole('button', { name: 'Retry copy' }));
  const checked = [...view.getByRole('dialog').querySelectorAll('input[type="checkbox"]')]
    .filter(input => input.checked);
  assert.equal(checked.length, 3);

  fireEvent.click(view.getByRole('button', { name: 'Retry copy' }));
  await waitFor(() => assert.equal(bulkPosts, 2));
  await waitFor(() => assert.equal(closes, 1));
});

test('single-item copy keeps selected classrooms, blocks dismiss, and retries a busy write', async () => {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role: 'apm' }));
  const raw = rawClassroomUniversity();
  let releaseBusy;
  let bulkPosts = 0;
  let closes = 0;
  let retriedTargets;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([raw]);
    if (url === '/api/universities/university-1' && (!options.method || options.method === 'GET')) {
      return response(raw);
    }
    if (url === '/api/universities/university-1/status/bulk' && options.method === 'POST') {
      bulkPosts += 1;
      retriedTargets = JSON.parse(options.body).updates[0].targetStatusIds;
      if (bulkPosts === 1) {
        await new Promise(resolve => { releaseBusy = resolve; });
        return response({
          error: 'Checklist save is temporarily busy. No changes were saved; retry this save.',
          code: 'CHECKLIST_SAVE_BUSY',
          correlationId: 'corr-item-busy',
        }, 503);
      }
      return response({
        applied: 1,
        skipped: 0,
        results: [{
          statusId: 'status-b',
          outcome: 'applied',
          row: {
            id: 'status-b',
            currentStatus: 'In-Progress',
            remarks: 'Room A note',
          },
        }],
      });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let dataApi;
  function Probe() {
    dataApi = useData();
    const university = dataApi.getUniversity('university-1');
    const source = university?.classrooms?.find(room => room.id === 'room-a')?.items?.[0];
    if (!source) return null;
    return (
      <ItemBulkApplyModal
        item={source}
        universityId="university-1"
        classrooms={university.classrooms}
        currentClassroomId="room-a"
        currentClassroomName="Room A"
        copyFields={['remarks']}
        onClose={() => { closes += 1; }}
      />
    );
  }
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <Probe />
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
  await waitFor(() => assert.ok(view.getByText('Apply this update to other classrooms?')));
  fireEvent.click(view.getByText('Selected classrooms'));
  fireEvent.click(view.getByRole('button', { name: /Apply to 1 destination room/ }));
  await waitFor(() => assert.equal(typeof releaseBusy, 'function'));

  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(closes, 0);
  releaseBusy();
  await waitFor(() => assert.match(
    view.getByRole('alert').textContent,
    /temporarily busy.*retry this copy/i,
  ));
  assert.ok(view.getByRole('button', { name: 'Retry copy' }));

  fireEvent.click(view.getByRole('button', { name: 'Retry copy' }));
  await waitFor(() => assert.equal(bulkPosts, 2));
  assert.deepEqual(retriedTargets, ['status-b']);
  await waitFor(() => assert.equal(closes, 1));
});

test('a busy retry waits for a newer queued destination draft instead of overwriting it', async () => {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role: 'apm' }));
  const raw = rawClassroomUniversity();
  let releaseBusy;
  let releaseTarget;
  let bulkPosts = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([raw]);
    if (url === '/api/universities/university-1/status/status-b' && options.method === 'PATCH') {
      await new Promise(resolve => { releaseTarget = resolve; });
      return response({ ok: true });
    }
    if (url === '/api/universities/university-1/status/bulk' && options.method === 'POST') {
      bulkPosts += 1;
      await new Promise(resolve => { releaseBusy = resolve; });
      return response({
        error: 'Checklist save is temporarily busy. No changes were saved; retry this save.',
        code: 'CHECKLIST_SAVE_BUSY',
        correlationId: 'corr-retry-queued',
      }, 503);
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  let dataApi;
  function Probe() {
    dataApi = useData();
    const university = dataApi.getUniversity('university-1');
    const source = university?.classrooms?.find(room => room.id === 'room-a')?.items?.[0];
    if (!source) return null;
    return (
      <ItemBulkApplyModal
        item={source}
        universityId="university-1"
        classrooms={university.classrooms}
        currentClassroomId="room-a"
        currentClassroomName="Room A"
        copyFields={['remarks']}
        onClose={() => undefined}
      />
    );
  }
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <Probe />
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
  await waitFor(() => assert.ok(view.getByText('Apply this update to other classrooms?')));
  fireEvent.click(view.getByText('Selected classrooms'));
  fireEvent.click(view.getByRole('button', { name: /Apply to 1 destination room/ }));
  await waitFor(() => assert.equal(typeof releaseBusy, 'function'));

  recordChecklistDraft(
    'university-1',
    { id: 'status-b', name: 'Generator' },
    { remarks: 'newer queued destination draft' },
  );
  let newerSave;
  act(() => {
    newerSave = dataApi.patchChecklistStatus('university-1', 'status-b', {
      remarks: 'newer queued destination draft',
    });
  });
  releaseBusy();
  await waitFor(() => assert.match(
    view.getByRole('alert').textContent,
    /temporarily busy.*retry this copy/i,
  ));
  fireEvent.click(view.getByRole('button', { name: 'Retry copy' }));
  await waitFor(() => assert.match(
    view.getByRole('alert').textContent,
    /Generator.*pending local edit/i,
  ));
  assert.equal(bulkPosts, 1);

  await waitFor(() => assert.equal(typeof releaseTarget, 'function'));
  releaseTarget();
  await act(async () => { await newerSave; });
  assert.equal(bulkPosts, 1);
});

test('both copy dialogs reject bulk acknowledgements with duplicate or unexpected target ids', async () => {
  localStorage.setItem('niat_user', JSON.stringify({ id: 'user-1', role: 'apm' }));
  const raw = rawClassroomUniversity();
  let bulkPosts = 0;
  let closes = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/universities') return response([raw]);
    if (url === '/api/universities/university-1' && (!options.method || options.method === 'GET')) {
      return response(raw);
    }
    if (url === '/api/universities/university-1/status/bulk' && options.method === 'POST') {
      bulkPosts += 1;
      return response({
        applied: 1,
        skipped: 0,
        results: [{
          statusId: bulkPosts === 1 ? 'status-unexpected' : 'status-b',
          outcome: 'applied',
        }, ...(bulkPosts === 1 ? [] : [{
          statusId: 'status-b',
          outcome: 'unchanged',
        }])],
      });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  function Probe() {
    const dataApi = useData();
    const university = dataApi.getUniversity('university-1');
    const sourceRoom = university?.classrooms?.find(room => room.id === 'room-a');
    const source = sourceRoom?.items?.[0];
    if (!sourceRoom?.items?.length) return null;
    return (
      <>
        <BulkApplyModal
          universityId="university-1"
          savedItems={sourceRoom.items}
          classrooms={university.classrooms}
          currentClassroomId="room-a"
          onClose={() => { closes += 1; }}
        />
        <ItemBulkApplyModal
          item={source}
          universityId="university-1"
          classrooms={university.classrooms}
          currentClassroomId="room-a"
          currentClassroomName="Room A"
          copyFields={['remarks']}
          onClose={() => { closes += 1; }}
        />
      </>
    );
  }
  const view = render(
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <Probe />
        </ToastProvider>
      </DataProvider>
    </AuthProvider>,
  );
  await waitFor(() => assert.ok(view.getByText('Apply this update to other classrooms?')));
  fireEvent.click(view.getByText('Selected classrooms'));
  fireEvent.click(view.getByRole('button', { name: 'Apply' }));
  fireEvent.click(view.getByRole('button', { name: /Apply to 1 destination room/ }));
  await waitFor(() => assert.equal(bulkPosts, 2));
  await waitFor(() => assert.equal(
    view.getAllByRole('alert').filter(alert => /did not identify exactly/i.test(alert.textContent)).length,
    2,
  ));
  assert.equal(closes, 0);
});

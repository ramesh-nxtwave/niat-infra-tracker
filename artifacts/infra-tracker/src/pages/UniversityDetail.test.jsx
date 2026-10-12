import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { MemoryRouter, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { DataProvider } from '../context/DataContext';
import { ToastProvider } from '../context/ToastContext';
import { ConfirmProvider } from '../context/ConfirmContext';
import UniversityDetail, { checklistSaveToast } from './UniversityDetail';
import DailyReports from './DailyReports';
import App from '../App';
import { resolveChecklistDestination, withDetailTimeout } from '../utils/checklistDestination';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
});
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
window.scrollTo = () => {};
window.matchMedia = () => ({ matches: true });
HTMLElement.prototype.scrollIntoView = function () {};
const { render, cleanup, fireEvent, waitFor, act } = await import('@testing-library/react');
afterEach(() => { cleanup(); localStorage.clear(); });

const rawItem = id => ({
  id, currentStatus: 'In-Progress',
  checklistItem: { name: 'Same item name', category: 'Electrical', sortOrder: 1 },
});
const university = {
  id: 'u1', name: 'Test University', zoneId: 1,
  spaces: [
    { id: 'm', spaceType: 'model_classroom', name: 'Model Classroom', checklistStatuses: [rawItem('model-status')] },
    { id: 'l', spaceType: 'lab', name: '5.0 Lab', checklistStatuses: [rawItem('lab-status')] },
    { id: 's', spaceType: 'staff_room', name: 'Staff Room', checklistStatuses: [rawItem('staff-status')] },
    { id: 'r1', spaceType: 'overall_classroom', name: 'Room 101', checklistStatuses: [rawItem('room-one-status')] },
    { id: 'r2', spaceType: 'overall_classroom', name: 'Room 102', checklistStatuses: [rawItem('room-two-status')] },
  ],
  classrooms: [{ id: 'room1', roomId: 'Room 101' }, { id: 'room2', roomId: 'Room 102' }],
};
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
function installFetch(detail = async () => response(university)) {
  const requests = [];
  localStorage.setItem('niat_user', JSON.stringify({ id: 'reader', role: 'ops' }));
  globalThis.fetch = async (input, options = {}) => {
    const path = String(input);
    requests.push({ path, method: options.method || 'GET' });
    if (path === '/api/universities') return response([university]);
    if (path.includes('/daily-report')) return response({
      items: [{ id: 'lab-status', area: '5.0 Lab', category: 'Electrical', lineItem: 'Same item name', status: 'In-Progress', attachments: [] }],
      areaSummaries: [{ area: '5.0 Lab' }],
    });
    if (path.startsWith('/api/universities/')) return detail(path);
    throw new Error(`Unexpected request: ${path}`);
  };
  return requests;
}
function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    <output aria-label="URL">{location.pathname}{location.search}</output>
    <button onClick={() => navigate(-1)}>History Back</button>
    <button onClick={() => navigate(1)}>History Forward</button>
    <button onClick={() => navigate('/university/u2?item=staff-status')}>Other university</button>
  </>;
}
function mount(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><DataProvider><ToastProvider><ConfirmProvider>
        <Navigation />
        <Routes>
          <Route path="/university/:id" element={<UniversityDetail />} />
          <Route path="/reports" element={<DailyReports />} />
        </Routes>
      </ConfirmProvider></ToastProvider></DataProvider></AuthProvider>
    </MemoryRouter>,
  );
}

test('resolver accepts only one exact loaded status ID, never duplicate names or group IDs', () => {
  const detail = { trackers: {
    modelClassroom: { items: [{ id: 'a-b', name: 'Duplicate' }] },
    lab5: { items: [{ id: 'a', name: 'Duplicate' }] },
    overallClassroom: { classrooms: [{ id: 'room', items: [{ id: 'b', name: 'Duplicate' }] }] },
  } };
  assert.equal(resolveChecklistDestination(detail, '?item=a-b').tab, 'overall');
  assert.equal(resolveChecklistDestination(detail, '?item=a-b').modelClassroom, true);
  assert.equal(resolveChecklistDestination(detail, '?item=b').classroomId, 'room');
  for (const query of ['?item=', '?item=a&item=b', '?item=%20a', '?item=%00']) {
    assert.equal(resolveChecklistDestination(detail, query).kind, 'invalid');
  }
  assert.equal(resolveChecklistDestination(detail, '?item=Duplicate').kind, 'missing');
  detail.trackers.staffRoom = { items: [{ id: 'b' }] };
  assert.equal(resolveChecklistDestination(detail, '?item=b').kind, 'missing');
  assert.equal(resolveChecklistDestination(detail, '?focus=blockers').kind, 'none');
});

test('a stalled detail request has a bounded, recoverable timeout', async () => {
  await assert.rejects(withDetailTimeout(new Promise(() => {}), 5), /timed out.*retry/);
});

test('checklist save feedback distinguishes remarks, mixed writes, and genuine no-ops', () => {
  assert.equal(checklistSaveToast({
    refreshed: true, writeCount: 0, savedRemarks: true, remarkOnly: true,
  }), 'Saved remarks');
  assert.equal(checklistSaveToast({
    refreshed: true, writeCount: 1, savedRemarks: true, remarkOnly: true,
  }), 'Saved remarks');
  assert.equal(checklistSaveToast({
    refreshed: true, writeCount: 1, savedRemarks: true, remarkOnly: false,
  }), 'Data saved successfully!');
  assert.equal(checklistSaveToast({
    refreshed: true, writeCount: 0, savedRemarks: false, remarkOnly: false,
  }), 'No unsaved checklist changes.');
});

test('the model checklist is reachable from All Classrooms without a top-level model tab', async () => {
  installFetch();
  const view = mount('/university/u1');

  await waitFor(() => assert.ok(view.getAllByRole('button', { name: 'All Classrooms' }).length > 0));
  fireEvent.click(view.getAllByRole('button', { name: 'All Classrooms' })[0]);

  assert.equal(view.queryByRole('button', { name: 'Model Classroom', exact: true }), null);
  const modelChoice = await view.findByRole('button', { name: /Model Classroom \d+%/i });
  assert.ok(modelChoice);
  fireEvent.click(modelChoice);
  await waitFor(() => assert.ok(view.getByRole('heading', { name: 'Model Classroom Tracker' })));
});

test('the Summary model readiness card opens the unified model choice', async () => {
  installFetch();
  const view = mount('/university/u1');
  await waitFor(() => assert.ok(view.getAllByRole('button', { name: /Model Classroom/ }).length > 0));
  const modelCard = view.getAllByRole('button', { name: /Model Classroom/ })
    .find(button => /0%/.test(button.textContent));
  assert.ok(modelCard);
  fireEvent.click(modelCard);
  await waitFor(() => assert.ok(view.getByRole('heading', { name: 'Model Classroom Tracker' })));
  assert.ok(view.getByRole('button', { name: /Model Classroom \d+%/i }));
});

for (const [id, title] of [
  ['model-status', 'Model Classroom Tracker'],
  ['lab-status', '5.0 Lab Tracker'],
  ['staff-status', 'Staff Room Tracker'],
  ['room-two-status', 'All Classrooms'],
]) {
  test(`direct URL reveals ${id} after delayed authorized loading without mutations`, async () => {
    let finish;
    const requests = installFetch(() => new Promise(resolve => { finish = resolve; }));
    const view = mount(`/university/u1?item=${id}&focus=blockers`);
    await waitFor(() => assert.ok(finish));
    assert.ok(view.getByText('Loading university…'));
    assert.equal(view.container.querySelector('.checklist-item-target'), null);
    await act(async () => finish(response(university)));
    await waitFor(() => {
      const row = view.container.querySelector('.checklist-item-target');
      assert.ok(row);
      assert.equal(document.activeElement, row);
      assert.ok(row.querySelector(`#fi-${id}`));
    });
    assert.ok(view.getByRole('heading', { name: title }));
    if (id.startsWith('room')) assert.ok(view.getByRole('heading', { name: 'Room 102' }));
    assert.equal(view.getByRole('button', { name: /Electrical.*Complete/ }).getAttribute('aria-expanded'), 'true');
    assert.ok(requests.every(request => request.method === 'GET'));
  });
}

test('report link and Back/Forward restore all report filters and refocus the destination', async () => {
  const requests = installFetch();
  const reportUrl = '/reports?university=u1&area=5.0+Lab&category=Electrical&zone=1&universitySearch=Test';
  const view = mount(reportUrl);
  await waitFor(() => assert.ok(view.getByRole('link', { name: 'Open Same item name for 5.0 Lab' })));
  fireEvent.click(view.getByRole('link', { name: 'Open Same item name for 5.0 Lab' }));
  await waitFor(() => assert.ok(view.container.querySelector('.checklist-item-target')));
  fireEvent.click(view.getByRole('button', { name: 'History Back' }));
  await waitFor(() => assert.equal(view.getByLabelText('URL').textContent, reportUrl));
  assert.equal(view.getByLabelText('Filter report by area').value, '5.0 Lab');
  assert.equal(view.getByLabelText('Filter report by category').value, 'Electrical');
  fireEvent.click(view.getByRole('button', { name: 'History Forward' }));
  await waitFor(() => assert.equal(document.activeElement, view.container.querySelector('.checklist-item-target')));
  assert.ok(requests.every(request => request.method === 'GET'));
});

test('missing and invalid targets show recovery actions without highlighting another item', async () => {
  for (const query of ['?item=deleted', '?item=', '?item=model-status&item=lab-status']) {
    installFetch();
    const view = mount(`/university/u1${query}`);
    await waitFor(() => assert.ok(view.getByRole('alert')));
    assert.equal(view.container.querySelector('.checklist-item-target'), null);
    assert.ok(view.getByRole('link', { name: 'Browse university' }));
    cleanup();
  }
});

for (const status of [403, 404, 500]) {
  test(`detail ${status} is recoverable even when list data exists`, async () => {
    let failing = true;
    installFetch(async () => failing ? response({ error: 'Detail failed' }, status) : response(university));
    const view = mount('/university/u1?item=lab-status');
    await waitFor(() => assert.ok(view.getByRole('alert')));
    assert.equal(view.queryByText('Loading university…'), null);
    assert.equal(view.container.querySelector('.checklist-item-target'), null);
    failing = false;
    fireEvent.click(view.getByRole('button', { name: 'Retry Loading' }));
    await waitFor(() => assert.ok(view.container.querySelector('.checklist-item-target')));
  });
}

test('retry can resolve a formerly missing target', async () => {
  let available = false;
  installFetch(async () => response(available ? university : { ...university, spaces: [] }));
  const view = mount('/university/u1?item=lab-status');
  await waitFor(() => assert.ok(view.getByRole('alert')));
  available = true;
  fireEvent.click(view.getByRole('button', { name: 'Retry Loading' }));
  await waitFor(() => assert.ok(view.container.querySelector('.checklist-item-target')));
});

test('an old failed request cannot replace a new university destination', async () => {
  let finishOld;
  installFetch(path => path.endsWith('/u1')
    ? new Promise(resolve => { finishOld = resolve; })
    : Promise.resolve(response({ ...university, id: 'u2', name: 'Second University' })));
  const view = mount('/university/u1?item=lab-status');
  await waitFor(() => assert.ok(finishOld));
  fireEvent.click(view.getByRole('button', { name: 'Other university' }));
  await waitFor(() => assert.ok(view.getByRole('heading', { name: 'Staff Room Tracker' })));
  await act(async () => finishOld(response({ error: 'Old request failed' }, 403)));
  assert.ok(view.getByRole('heading', { name: 'Second University' }));
  assert.equal(view.queryByRole('alert'), null);
});

test('blocker link behavior remains when no explicit item target exists', async () => {
  installFetch(async () => response({
    ...university,
    spaces: university.spaces.map(space => space.id === 'm'
      ? { ...space, checklistStatuses: [{ ...rawItem('model-status'), isBlocker: true }] }
      : space),
  }));
  const view = mount('/university/u1?focus=blockers');
  await waitFor(() => assert.ok(view.getByRole('heading', { name: 'Model Classroom Tracker' })));
  assert.ok(view.getByRole('button', { name: /Model Classroom \d+%/i }));
  assert.equal(view.container.querySelector('.checklist-item-target'), null);
});

test('timeout then retry keeps newer detail when the old same-university request completes last', async () => {
  let finishOld;
  let count = 0;
  installFetch(() => ++count === 1
    ? new Promise(resolve => { finishOld = resolve; })
    : Promise.resolve(response(university)));
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms === 20000 ? 20 : ms, ...args);
  try {
    const view = mount('/university/u1?item=staff-status');
    await waitFor(() => assert.match(view.getByRole('alert').textContent, /timed out/));
    fireEvent.click(view.getByRole('button', { name: 'Retry Loading' }));
    await waitFor(() => assert.ok(view.container.querySelector('.checklist-item-target #fi-staff-status')));
    await act(async () => finishOld(response({ ...university, spaces: [] })));
    assert.ok(view.container.querySelector('.checklist-item-target #fi-staff-status'));
    assert.equal(view.queryByRole('alert'), null);
  } finally {
    globalThis.setTimeout = originalTimeout;
  }
});

test('room-name whitespace accepted by reports also resolves against loaded detail', async () => {
  installFetch(async () => response({
    ...university,
    classrooms: university.classrooms.map(room => ({ ...room, roomId: ` ${room.roomId} ` })),
  }));
  const view = mount('/university/u1?item=room-two-status');
  await waitFor(() => assert.ok(view.container.querySelector('.checklist-item-target #fi-room-two-status')));
});

test('ambiguous legacy classroom mappings fail recoverably rather than selecting an arbitrary room', async () => {
  installFetch(async () => response({
    ...university,
    classrooms: [...university.classrooms, { id: 'duplicate-room', roomId: 'Room 102' }],
  }));
  const view = mount('/university/u1?item=room-two-status');
  await waitFor(() => assert.match(view.getByRole('alert').textContent, /could not be matched to a single checklist entry/));
  assert.equal(view.container.querySelector('.checklist-item-target'), null);
  assert.ok(view.getByRole('link', { name: 'Browse university' }));
});

test('report navigation resolves through the real App route table and survives a direct remount', async () => {
  const requests = installFetch();
  const scrolls = [];
  window.scrollTo = options => { scrolls.push(options); window.scrollY = options.top; };
  window.scrollY = 650;
  const oldRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () { return { top: 750 - window.scrollY }; };
  try {
  window.history.replaceState({}, '', '/reports?university=u1');
  let view = render(<App />);
  await waitFor(() => assert.ok(view.getByRole('link', { name: 'Open Same item name for 5.0 Lab' })));
  fireEvent.click(view.getByRole('link', { name: 'Open Same item name for 5.0 Lab' }));
  await waitFor(() => assert.ok(view.container.querySelector('.checklist-item-target #fi-lab-status')));
  assert.equal(window.location.pathname, '/university/u1');
  assert.equal(window.location.search, '?item=lab-status');
  view.unmount();
  view = render(<App />);
  await waitFor(() => assert.ok(view.container.querySelector('.checklist-item-target #fi-lab-status')));
  assert.equal(window.location.pathname, '/university/u1');
  window.scrollY = 0;
  scrolls.length = 0;
  fireEvent.click(view.getByRole('button', { name: 'Back', exact: true }));
  await waitFor(() => assert.equal(scrolls.length, 1));
  assert.equal(window.location.pathname, '/reports');
  assert.equal(window.location.search, '?university=u1');
  assert.equal(window.scrollY, 650);
  assert.equal(document.activeElement, view.getByRole('link', { name: 'Open Same item name for 5.0 Lab' }));
  assert.ok(requests.every(request => request.method === 'GET'));
  } finally {
    HTMLElement.prototype.getBoundingClientRect = oldRect;
    window.scrollTo = () => {};
    window.scrollY = 0;
  }
});

test('real report source links open the exact AC status without copying historical remarks into editors', async () => {
  const modelStatusId = 'model-ac-status';
  const firstClassroomStatusId = 'room-a-ac-status';
  const secondClassroomStatusId = 'room-b-ac-status';
  const acStatus = (id, remarks) => ({
    id,
    currentStatus: 'In-Progress',
    remarks,
    checklistItem: { name: 'AC Installation', category: 'Electrical', sortOrder: 1 },
  });
  const detail = {
    ...university,
    zone_id: 1,
    spaces: [
      {
        id: 'model-space',
        spaceType: 'model_classroom',
        name: 'Model Classroom',
        checklistStatuses: [acStatus(modelStatusId, 'Model current saved note')],
      },
      {
        id: 'room-a-space',
        spaceType: 'overall_classroom',
        name: 'Room A',
        checklistStatuses: [acStatus(firstClassroomStatusId, '')],
      },
      {
        id: 'room-b-space',
        spaceType: 'overall_classroom',
        name: 'Room B',
        checklistStatuses: [acStatus(secondClassroomStatusId, 'Room B current saved note')],
      },
    ],
    classrooms: [
      { id: 'room-a', roomId: 'Room A' },
      { id: 'room-b', roomId: 'Room B' },
    ],
  };
  const report = {
    items: [
      {
        id: modelStatusId,
        area: 'Model Classroom',
        category: 'Electrical',
        lineItem: 'AC Installation',
        status: 'In-Progress',
        remark: 'Model historical report note',
        remarkIsHistorical: true,
        remarkDiffersFromCurrent: true,
        attachments: [],
      },
      {
        id: firstClassroomStatusId,
        area: 'All Classrooms',
        classroomName: 'Room A',
        category: 'Electrical',
        lineItem: 'AC Installation',
        status: 'In-Progress',
        remark: '',
        attachments: [],
      },
      {
        id: secondClassroomStatusId,
        area: 'All Classrooms',
        classroomName: 'Room B',
        category: 'Electrical',
        lineItem: 'AC Installation',
        status: 'In-Progress',
        remark: 'Room B historical report note',
        remarkIsHistorical: true,
        remarkDiffersFromCurrent: true,
        attachments: [],
      },
    ],
    areaSummaries: [
      { area: 'Model Classroom' },
      { area: 'All Classrooms' },
    ],
  };
  const requests = [];
  const detailResolvers = [];
  localStorage.setItem('niat_user', JSON.stringify({ id: 'reader', role: 'ops' }));
  globalThis.fetch = async (input, options = {}) => {
    const path = String(input);
    const method = options.method || 'GET';
    requests.push({ path, method });
    if (path === '/api/universities') return response([detail]);
    if (path.includes('/daily-report')) return response(report);
    if (path === '/api/universities/u1') {
      return new Promise(resolve => detailResolvers.push(resolve));
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  window.history.replaceState({}, '', '/reports?university=u1');
  const view = render(<App />);
  try {
    const modelLink = await view.findByRole('link', {
      name: 'Open saved remark for AC Installation in Model Classroom',
    });
    const roomBLink = view.getByRole('link', {
      name: 'Open saved remark for AC Installation in All Classrooms — Room B',
    });
    assert.equal(modelLink.getAttribute('href'), `/university/u1?item=${modelStatusId}`);
    assert.equal(roomBLink.getAttribute('href'), `/university/u1?item=${secondClassroomStatusId}`);
    assert.equal(view.queryByRole('link', {
      name: 'Open saved remark for AC Installation in All Classrooms — Room A',
    }), null);
    assert.equal(view.queryByText('No remark for this classroom'), null);
    assert.match(view.getByText('Model historical report note').closest('td').textContent,
      /Historical report remark\. Current saved remark differs/);

    fireEvent.click(modelLink);
    await waitFor(() => assert.equal(detailResolvers.length, 1));
    assert.equal(requests.some(request => request.method !== 'GET'), false);
    assert.ok(view.getByText('Loading university…'));
    await act(async () => detailResolvers.shift()(response(detail)));
    const modelEditor = await view.findByRole('textbox', { name: 'Audit Remarks / Field Notes' });
    assert.equal(modelEditor.id, `checklist-remark-${modelStatusId}`);
    assert.equal(modelEditor.value, 'Model current saved note');
    assert.notEqual(modelEditor.value, 'Model historical report note');
    assert.equal(requests.some(request => request.method !== 'GET'), false);

    fireEvent.click(view.getByRole('button', { name: 'Back', exact: true }));
    const roomBReportLink = await view.findByRole('link', {
      name: 'Open saved remark for AC Installation in All Classrooms — Room B',
    });
    fireEvent.click(roomBReportLink);
    await waitFor(() => assert.equal(detailResolvers.length, 1));
    assert.equal(requests.some(request => request.method !== 'GET'), false);
    await act(async () => detailResolvers.shift()(response(detail)));
    const roomBEditor = await view.findByRole('textbox', { name: 'Audit Remarks / Field Notes' });
    assert.equal(roomBEditor.id, `checklist-remark-${secondClassroomStatusId}`);
    assert.equal(roomBEditor.value, 'Room B current saved note');
    assert.notEqual(roomBEditor.value, 'Room B historical report note');
    assert.equal(requests.some(request => request.method !== 'GET'), false);
  } finally {
    view.unmount();
  }
});
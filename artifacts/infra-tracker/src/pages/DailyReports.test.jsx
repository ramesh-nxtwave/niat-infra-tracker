import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import DailyReportsPage, { compactClassroomItems, combineModelAndClassrooms, filterReportUniversities, reportAttachments, REPORT_AUTO_REFRESH_MIN_GAP_MS, UniversityReportSearch } from './DailyReports';
import { reportRemarkEntries } from '../utils/reportRemarks';

// Checklist-specific fixtures supply only report data; history has its own
// endpoint and integration coverage in DailyReports.updates.test.jsx.
function DailyReports({ authFetch, ...props }) {
  const fetchWithHistory = React.useCallback(
    (path, options) => path.endsWith('/updates') ? Promise.resolve([]) : authFetch(path, options),
    [authFetch],
  );
  return <DailyReportsPage {...props} authFetch={fetchWithHistory} />;
}

const item = (overrides) => ({
  id: overrides.id,
  area: 'All Classrooms',
  classroomName: overrides.classroomName,
  category: 'Furniture',
  lineItem: 'Student desks',
  status: 'Partially Done',
  timeline: null,
  remark: '',
  attachments: overrides.attachments || [],
});


function ReportRouteHarness(props) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Current report URL">{`${location.pathname}${location.search}`}</output>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
      <DailyReports {...props} />
    </>
  );
}

function ChecklistDestinationHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Current checklist URL">{`${location.pathname}${location.search}`}</output>
      <button onClick={() => navigate(-1)}>Return to report</button>
    </>
  );
}

function chooseReportUniversity(page, fireEvent, name) {
  const search = page.getByRole('combobox', { name: 'Search universities' });
  fireEvent.focus(search);
  fireEvent.click(search);
  fireEvent.click(page.getByRole('option', { name, exact: true }));
  return search;
}

test('automatic report refreshes use a nonzero burst guard', () => {
  assert.ok(REPORT_AUTO_REFRESH_MIN_GAP_MS >= 10_000);
});

test('Reports show completed and pending work by default, with Partially Done remaining pending', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { render } = await import('@testing-library/react');
  const report = {
    items: [
      { id: 'partial', area: '5.0 Lab', category: 'Electrical', lineItem: 'Partial wiring', status: 'Partially Done', attachments: [] },
      { id: 'complete', area: '5.0 Lab', category: 'Electrical', lineItem: 'Complete wiring', status: 'Done', attachments: [] },
    ],
    areaSummaries: [{ area: '5.0 Lab' }],
  };
  const page = render(
    <MemoryRouter initialEntries={['/reports?university=geeta&status=done']}>
      <DailyReports universities={[{ id: 'geeta', name: 'Geeta University' }]} authFetch={async () => report} />
    </MemoryRouter>,
  );
  try {
    await page.findByText('Partially Done');
    assert.ok(page.getByRole('link', { name: 'Open Partial wiring for 5.0 Lab' }));
    assert.ok(page.getByRole('link', { name: 'Open Complete wiring for 5.0 Lab' }));
    assert.ok(page.getByRole('heading', { name: 'Pending', exact: true }));
    const doneSection = page.getByRole('heading', { name: 'Done', exact: true }).closest('section');
    assert.ok(doneSection);
    assert.equal(doneSection.textContent.includes('Partial wiring'), false);
    assert.equal(page.queryByLabelText('Filter report by status'), null);
  } finally {
    page.unmount();
    dom.window.close();
  }
});

test('pending report tables use Location first, omit Category, and split room sections', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { render } = await import('@testing-library/react');
  const report = {
    items: [
      { id: 'model', area: 'Model Classroom', category: 'Furniture', lineItem: 'Model desks', status: 'Partially Done', attachments: [] },
      { id: 'room', area: 'All Classrooms', classroomName: 'Room 101', category: 'Furniture', lineItem: 'Model desks', status: 'Partially Done', attachments: [] },
      { id: 'staff', area: 'Staff Room', category: 'Electrical', lineItem: 'Staff wiring', status: 'In-Progress', attachments: [] },
      { id: 'lab', area: '5.0 Lab', category: 'Electrical', lineItem: 'Lab wiring', status: 'Yet to start', attachments: [] },
      { id: 'other', area: 'Storage', category: 'Furniture', lineItem: 'Storage shelving', status: 'Need to revamp', attachments: [] },
      {
        id: 'done',
        area: 'Staff Room',
        category: 'Electrical',
        lineItem: 'Completed wiring',
        status: 'Done',
        attachments: [{ id: 'done-proof', url: '/completed-wiring.jpg', contentType: 'image/jpeg' }],
      },
      { id: 'na', area: '5.0 Lab', category: 'Electrical', lineItem: 'Not applicable', status: 'N/A', attachments: [] },
    ],
    areaSummaries: [
      { area: 'Model Classroom' },
      { area: 'All Classrooms' },
      { area: 'Staff Room' },
      { area: '5.0 Lab' },
      { area: 'Storage' },
    ],
  };
  const page = render(
    <MemoryRouter initialEntries={['/reports?university=geeta']}>
      <DailyReports universities={[{ id: 'geeta', name: 'Geeta University' }]} authFetch={async () => report} />
    </MemoryRouter>,
  );
  try {
    await page.findByText('Model desks');
    assert.ok(page.getByRole('heading', { name: 'Pending', exact: true }));
    assert.ok(page.getByRole('heading', { name: 'Done', exact: true }));
    assert.ok(page.getByRole('heading', { name: 'CR (Classrooms)', exact: true }));
    assert.ok(page.getByRole('heading', { name: 'Staff Room', exact: true }));
    assert.ok(page.getByRole('heading', { name: 'Lab Room', exact: true }));
    assert.ok(page.getByRole('heading', { name: 'Storage', exact: true }));
    assert.ok(page.getAllByText('Completed wiring').length >= 1);
    assert.ok(page.getAllByText('Not applicable').length >= 1);
    assert.ok(page.getByRole('button', { name: 'Open 1 attachment for Completed wiring' }));
    assert.ok(page.getByRole('heading', { name: 'Attachment Appendix', exact: true }));
    const appendix = page.getByRole('heading', { name: 'Attachment Appendix', exact: true }).closest('section');
    assert.ok(appendix.querySelector('figcaption strong').textContent.includes('Completed wiring'));
    const pendingSection = page.getByRole('heading', { name: 'Pending', exact: true }).closest('section');
    const sections = [...pendingSection.querySelectorAll('.work-report-section .work-report-section-title h2')].map(h => h.textContent);
    assert.deepEqual(sections, [
      'CR (Classrooms)',
      'Lab Room',
      'Staff Room',
      'Storage'
    ], 'Sections should be ordered: Classrooms -> Lab -> Staff Room -> Other');
    for (const [label, area] of [['Model desks', 'classrooms'], ['Lab wiring', 'lab'], ['Staff wiring', 'staff']]) {
      const row = page.getByText(label).closest('tr');
      assert.ok(row.classList.contains(`daily-area-${area}`), `${label} uses its area colour`);
      assert.ok(row.closest('section').classList.contains(`work-report-area-${area}`),
        `${label} has a distinct section heading`);
    }

    const tables = [...page.container.querySelectorAll('table.daily-report-table')];
    const doneSection = page.getByRole('heading', { name: 'Done', exact: true }).closest('section');
    for (const row of doneSection.querySelectorAll('tbody tr')) {
      assert.ok(row.classList.contains('daily-report-completed'));
      assert.equal(/daily-area-/.test(row.className), false, 'Done and N/A never inherit pending area colours');
    }
    assert.equal(page.getByText('Staff wiring').closest('tr').classList.contains('daily-report-completed'), false);
    assert.ok(tables.length >= 4);
    tables.forEach(table => {
      const headers = [...table.querySelectorAll('thead th')].map(header => header.textContent);
      assert.equal(headers[0], 'Location');
      assert.equal(headers.includes('Category'), false);
    });
  } finally {
    page.unmount();
    dom.window.close();
  }
});

test('classroom compaction retains distinct attachments and room context', () => {
  const grouped = compactClassroomItems([
    item({ id: 'a', classroomName: 'Room 101', attachments: [{ id: 'p1', url: '/one.jpg', contentType: 'image/jpeg', area: 'All Classrooms', classroomName: 'Room 101' }] }),
    item({ id: 'b', classroomName: 'Room 102', attachments: [{ id: 'v1', url: '/two.mp4', contentType: 'video/mp4', area: 'All Classrooms', classroomName: 'Room 102' }] }),
  ]);

  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].classroomNames, ['Room 101', 'Room 102']);
  assert.deepEqual(grouped[0].attachments.map(value => value.classroomName), ['Room 101', 'Room 102']);
  assert.deepEqual(grouped[0].sources, [
    { id: 'a', label: 'All Classrooms — Room 101' },
    { id: 'b', label: 'All Classrooms — Room 102' },
  ]);
});

test('model and classroom combination keeps evidence from both sources', () => {
  const model = {
    ...item({ id: 'model', classroomName: null, attachments: [{ id: 'm1', url: '/model.jpg', contentType: 'image/jpeg', area: 'Model Classroom' }] }),
    area: 'Model Classroom',
  };
  const combined = combineModelAndClassrooms([
    model,
    item({ id: 'room', classroomName: 'Room 101', attachments: [{ id: 'r1', url: '/room.mp4', contentType: 'video/mp4', area: 'All Classrooms', classroomName: 'Room 101' }] }),
  ]);

  assert.equal(combined.length, 1);
  assert.deepEqual(combined[0].attachments.map(value => value.url), ['/model.jpg', '/room.mp4']);
  assert.deepEqual(combined[0].sources, [
    { id: 'model', label: 'Model Classroom' },
    { id: 'room', label: 'All Classrooms — Room 101' },
  ]);
  assert.equal(combined[0].id, 'model-room');
});

test('combined AC remarks retain every original owner, including blanks and non-first rooms', () => {
  const records = [
    { id: 'model', area: 'Model Classroom', remark: 'Model AC installed' },
    { id: 'room-a', area: 'All Classrooms', classroomName: 'Room A', remark: '' },
    { id: 'room-b', area: 'All Classrooms', classroomName: 'Room B', remark: 'Room B awaiting power' },
  ].map((record, index) => ({
    category: 'Electrical', lineItem: 'AC Installation', status: 'In-Progress',
    remarkDate: `2026-09-0${index + 1}`, ...record,
  }));
  const [combined] = combineModelAndClassrooms(records);
  assert.deepEqual(combined.remarkSources.map(source => [source.id, source.remark, source.remarkDate]), [
    ['model', 'Model AC installed', '2026-09-01'],
    ['room-a', '', '2026-09-02'],
    ['room-b', 'Room B awaiting power', '2026-09-03'],
  ]);
  assert.deepEqual(records.map(record => record.remark), ['Model AC installed', '', 'Room B awaiting power']);
});

test('grouped remark display omits empty rooms and keeps the available remark date', () => {
  const entries = reportRemarkEntries({
    remarkSources: [
      { id: 'room-a', label: 'All Classrooms — Room A', remark: '', remarkDate: '2026-09-01' },
      { id: 'room-b', label: 'All Classrooms — Room B', remark: 'Room B awaiting power', remarkDate: '2026-09-03' },
      { id: 'room-c', label: 'All Classrooms — Room C', remark: '', remarkDate: '2026-09-04' },
    ],
  });
  assert.deepEqual(entries.map(entry => [entry.text, entry.remarkDate]), [
    ['Room B awaiting power', '2026-09-03'],
  ]);
  assert.deepEqual(entries[0].labels, ['All Classrooms — Room B']);
});

test('grouped remark display deduplicates repeated notes and their dates', () => {
  const entries = reportRemarkEntries({
    remarkSources: [
      { id: 'room-a', label: 'All Classrooms — Room A', remark: 'Power pending', remarkDate: '2026-09-01' },
      { id: 'room-b', label: 'All Classrooms — Room B', remark: ' Power   pending ', remarkDate: '2026-09-03' },
    ],
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, 'Power pending');
  assert.equal(entries[0].remarkDate, '2026-09-03');
  assert.deepEqual(entries[0].labels, ['All Classrooms — Room A', 'All Classrooms — Room B']);
});

test('grouped remark display labels genuinely different notes', () => {
  const entries = reportRemarkEntries({
    remarkSources: [
      { id: 'room-a', label: 'All Classrooms — Room A', remark: 'Power pending', remarkDate: '2026-09-01' },
      { id: 'room-b', label: 'All Classrooms — Room B', remark: 'Awaiting vendor', remarkDate: '2026-09-03' },
    ],
  });
  assert.deepEqual(entries.map(entry => ({ text: entry.text, labels: entry.labels, date: entry.remarkDate })), [
    { text: 'Power pending', labels: ['All Classrooms — Room A'], date: '2026-09-01' },
    { text: 'Awaiting vendor', labels: ['All Classrooms — Room B'], date: '2026-09-03' },
  ]);
});

test('grouped remark display returns no entries when every room is empty', () => {
  assert.deepEqual(reportRemarkEntries({
    remarkSources: [
      { id: 'room-a', label: 'All Classrooms — Room A', remark: '', remarkDate: '2026-09-01' },
      { id: 'room-b', label: 'All Classrooms — Room B', remark: null, remarkDate: '2026-09-02' },
    ],
  }), []);
});

test('report remarks label their classroom and historical state beside exact source links', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { render } = await import('@testing-library/react');
  const records = [
    { id: 'model', area: 'Model Classroom', remark: 'Model AC installed' },
    { id: 'room-a', area: 'All Classrooms', classroomName: 'Room A', remark: '' },
    { id: 'room-b', area: 'All Classrooms', classroomName: 'Room B', remark: 'Old Room B note',
      remarkIsHistorical: true, remarkDiffersFromCurrent: true },
  ].map(record => ({
    category: 'Electrical', lineItem: 'AC Installation', status: 'In-Progress', attachments: [], ...record,
  }));
  const view = render(
    <MemoryRouter initialEntries={['/reports?university=geeta']}>
      <DailyReports universities={[{ id: 'geeta', name: 'Geeta University' }]}
        authFetch={async () => ({ items: records, areaSummaries: [] })} />
    </MemoryRouter>,
  );
  try {
    const note = await view.findByText('Old Room B note');
    const cell = note.closest('td');
    assert.match(cell.textContent, /All Classrooms — Room B/);
    assert.match(cell.textContent, /Historical report remark. Current saved remark differs/);
    assert.equal(view.queryByText('No remark for this classroom'), null);
    assert.equal(view.getByRole('link', {
      name: 'Open saved remark for AC Installation in All Classrooms — Room B',
    }).getAttribute('href'), '/university/geeta?item=room-b');
    assert.equal(view.getByRole('link', {
      name: 'Open saved remark for AC Installation in Model Classroom',
    }).getAttribute('href'), '/university/geeta?item=model');
    assert.equal(view.queryByRole('link', {
      name: 'Open saved remark for AC Installation in All Classrooms — Room A',
    }), null);
  } finally {
    view.unmount();
    dom.window.close();
  }
});

test('report line items link every table to original checklist statuses and preserve report history', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  const report = {
    items: [
      {
        id: 'pending/status 1',
        area: 'Staff Room',
        category: 'Electrical',
        lineItem: 'Pending wiring',
        status: 'In-Progress',
        attachments: [],
      },
      {
        id: 'done-status',
        area: '5.0 Lab',
        category: 'Electrical',
        lineItem: 'Done wiring',
        status: 'Partially Done',
        attachments: [],
      },
      {
        id: 'model-status',
        area: 'Model Classroom',
        category: 'Electrical',
        lineItem: 'Grouped wiring',
        status: 'Partially Done',
        attachments: [],
      },
      {
        id: 'room-status',
        area: 'All Classrooms',
        classroomName: 'Room 101',
        category: 'Electrical',
        lineItem: 'Grouped wiring',
        status: 'Partially Done',
        attachments: [],
      },
    ],
    areaSummaries: [
      { area: 'Staff Room' },
      { area: '5.0 Lab' },
      { area: 'Model Classroom' },
      { area: 'All Classrooms' },
    ],
  };
  const reportUrl = '/reports?view=daily&university=geeta&category=Electrical';
  let resolveReturnReport;
  let reportRequests = 0;
  let linkPageTop = 1000;
  const scrolls = [];
  Object.defineProperty(dom.window, 'scrollY', { configurable: true, writable: true, value: 900 });
  dom.window.scrollTo = options => {
    scrolls.push(options);
    dom.window.scrollY = options.top;
  };
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: linkPageTop - dom.window.scrollY };
  };
  const page = render(
    <MemoryRouter initialEntries={[reportUrl]}>
      <Routes>
        <Route path="/reports" element={
          <ReportRouteHarness
            universities={[{ id: 'geeta', name: 'Geeta University', zone_id: 1, apmName: 'APM One' }]}
            authFetch={() => ++reportRequests === 1
              ? Promise.resolve(report)
              : new Promise(resolve => { resolveReturnReport = resolve; })}
          />
        } />
        <Route path="/university/:id" element={<ChecklistDestinationHarness />} />
      </Routes>
    </MemoryRouter>,
  );

  const pendingLink = await page.findByRole('link', { name: 'Open Pending wiring for Staff Room' });
  const doneLink = page.getByRole('link', { name: 'Open Done wiring for 5.0 Lab' });
  assert.equal(pendingLink.getAttribute('href'), '/university/geeta?item=pending%2Fstatus%201');
  assert.equal(doneLink.getAttribute('href'), '/university/geeta?item=done-status');
  assert.ok(pendingLink.classList.contains('no-print'));
  assert.ok(doneLink.classList.contains('no-print'));

  const chooser = page.getByLabelText('Choose a source for Grouped wiring').closest('details');
  assert.ok(chooser);
  assert.ok(chooser.classList.contains('no-print'));
  fireEvent.click(chooser.querySelector('summary'));
  chooser.open = true;
  page.container.querySelector('.daily-table-wrap').scrollLeft = 80;
  assert.deepEqual(
    [...chooser.querySelectorAll('a')].map(link => [link.textContent, link.getAttribute('href')]),
    [
      ['Model Classroom', '/university/geeta?item=model-status'],
      ['All Classrooms — Room 101', '/university/geeta?item=room-status'],
    ],
  );

  fireEvent.click(pendingLink);
  await waitFor(() => assert.equal(
    page.getByLabelText('Current checklist URL').textContent,
    '/university/geeta?item=pending%2Fstatus%201',
  ));
  dom.window.scrollY = 0;
  // Simulate a taller report after its fresh load; preserve the source link's
  // viewport offset rather than blindly restoring the old document offset.
  linkPageTop = 1200;
  fireEvent.click(page.getByRole('button', { name: 'Return to report' }));
  await waitFor(() => assert.equal(page.getByLabelText('Current report URL').textContent, reportUrl));
  await waitFor(() => assert.equal(typeof resolveReturnReport, 'function'));
  assert.deepEqual(scrolls, [], 'wait for the report rows before restoring position');
  resolveReturnReport(report);
  await waitFor(() => assert.equal(scrolls.length, 1));
  assert.deepEqual(scrolls[0], { left: 0, top: 1100, behavior: 'instant' });
  assert.equal(dom.window.document.activeElement.getAttribute('href'), pendingLink.getAttribute('href'));
  assert.equal(page.getByLabelText('Choose a source for Grouped wiring').closest('details').open, true);
  assert.equal(page.container.querySelector('.daily-table-wrap').scrollLeft, 80);
  assert.equal(page.getByLabelText('Filter report by category').value, 'Electrical');

  // A grouped source returns to its expanded chooser as well.
  const groupedLink = page.getByRole('link', { name: 'Open Grouped wiring for All Classrooms — Room 101' });
  fireEvent.click(groupedLink);
  dom.window.scrollY = 0;
  fireEvent.click(page.getByRole('button', { name: 'Return to report' }));
  await waitFor(() => assert.equal(reportRequests, 3));
  resolveReturnReport(report);
  await waitFor(() => assert.equal(scrolls.length, 2));
  assert.equal(dom.window.document.activeElement.getAttribute('href'), groupedLink.getAttribute('href'));
  assert.equal(dom.window.scrollY, 1100);

  page.unmount();
  dom.window.close();
});

test('appendix data contains attachments only from the filtered visible items', () => {
  const visible = [item({ id: 'visible', classroomName: 'Room 101', attachments: [{ id: 'p1', url: '/visible.jpg', contentType: 'image/jpeg' }] })];
  const hidden = item({ id: 'hidden', classroomName: 'Room 102', attachments: [{ id: 'p2', url: '/hidden.jpg', contentType: 'image/jpeg' }] });

  assert.deepEqual(reportAttachments(visible).map(value => value.url), ['/visible.jpg']);
  assert.equal(reportAttachments([hidden]).length, 1);
  assert.equal(reportAttachments([item({ id: 'none', classroomName: 'Room 103' })]).length, 0);
});

test('report search finds a university by a case-insensitive partial name', () => {
  const universities = [
    { id: 'geeta', name: 'Geeta University', zone_id: 1, apmName: 'APM One' },
    { id: 'other', name: 'Other University', zone_id: 2, apmName: 'APM Two' },
  ];

  assert.deepEqual(
    filterReportUniversities(universities, { search: '  geeta  ' }).map(item => item.id),
    ['geeta'],
  );
});

test('report search selection works with pointer and keyboard input', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  const universities = [
    { id: 'geeta', name: 'Geeta University', zone_id: 1, apmName: 'APM One' },
    { id: 'other', name: 'Other University', zone_id: 1, apmName: 'APM One' },
  ];
  const selections = [];
  const { getByRole, rerender, unmount } = render(
    <UniversityReportSearch
      universities={universities}
      selectedUniversity=""
      value="geeta"
      onChange={() => {}}
      onSelect={item => selections.push(item.id)}
    />,
  );

  const input = getByRole('combobox', { name: 'Search universities' });
  fireEvent.focus(input);
  fireEvent.click(input);
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  const geetaOption = getByRole('option', { name: 'Geeta University' });
  assert.equal(geetaOption.textContent, 'Geeta University');
  fireEvent.click(geetaOption);
  assert.deepEqual(selections, ['geeta']);

  rerender(
    <UniversityReportSearch
      universities={universities}
      selectedUniversity=""
      value="university"
      onChange={() => {}}
      onSelect={item => selections.push(item.id)}
    />,
  );
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  assert.deepEqual(selections, ['geeta', 'other']);
  unmount();

  const reportRequests = [];
  const page = render(
    <MemoryRouter initialEntries={['/reports']}>
      <DailyReports
        universities={universities}
        authFetch={async path => {
          reportRequests.push(path);
          return {
            items: [{
              id: 'wiring',
              area: '5.0 Lab',
              category: 'Electrical',
              lineItem: 'Wiring',
              status: 'Partially Done',
              attachments: [],
            }],
            areaSummaries: [{ area: '5.0 Lab' }],
          };
        }}
      />
    </MemoryRouter>,
  );
  const pageSearch = page.getByRole('combobox', { name: 'Search universities' });
  fireEvent.change(pageSearch, { target: { value: 'geeta' } });
  fireEvent.focus(pageSearch);
  fireEvent.click(page.getByRole('listbox').querySelector('[role="option"]'));

  await waitFor(() => assert.equal(reportRequests.length, 1));
  assert.match(reportRequests[0], /^\/universities\/geeta\/daily-report\?date=\d{4}-\d{2}-\d{2}$/);
  await waitFor(() => assert.equal(page.getByText('Wiring').textContent, 'Wiring'));
  page.unmount();
  dom.window.close();
});

test('report search closes an empty result set with Escape', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render } = await import('@testing-library/react');
  const view = render(
    <UniversityReportSearch
      universities={[]}
      selectedUniversity=""
      value="missing"
      onChange={() => {}}
      onSelect={() => {}}
    />,
  );

  try {
    const search = view.getByRole('combobox', { name: 'Search universities' });
    fireEvent.focus(search);
    fireEvent.click(search);
    assert.equal(search.getAttribute('aria-expanded'), 'true');
    assert.ok(view.getByText('No universities found'));
    fireEvent.keyDown(search, { key: 'Escape' });
    assert.equal(search.getAttribute('aria-expanded'), 'false');
    assert.equal(view.queryByRole('listbox'), null);
  } finally {
    view.unmount();
    dom.window.close();
  }
});

test('report URL restores valid selections, rejects inaccessible IDs, and follows history', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  const universities = [
    { id: 'geeta', name: 'Geeta University', zone_id: 1, apmName: 'APM One' },
    { id: 'other', name: 'Other University', zone_id: 1, apmName: 'APM One' },
  ];
  const reportRequests = [];
  const page = render(
    <MemoryRouter initialEntries={['/reports?view=daily&university=geeta']}>
      <Routes>
        <Route path="/reports" element={
          <ReportRouteHarness
            universities={universities}
            authFetch={async path => {
              reportRequests.push(path);
              return { items: [], areaSummaries: [] };
            }}
          />
        } />
      </Routes>
    </MemoryRouter>,
  );

  assert.equal(page.getAllByRole('combobox', { name: 'Search universities' }).length, 1);
  assert.equal(page.queryByLabelText('Select university'), null);
  assert.equal(page.container.querySelector('.daily-report-select'), null);
  await waitFor(() => assert.equal(
    page.getByRole('combobox', { name: 'Search universities' }).value,
    'Geeta University',
  ));
  assert.equal(page.getByLabelText('Current report URL').textContent, '/reports?view=daily&university=geeta');
  chooseReportUniversity(page, fireEvent, 'Other University');
  await waitFor(() => assert.equal(
    page.getByLabelText('Current report URL').textContent,
    '/reports?view=daily&university=other',
  ));
  assert.equal(page.getByRole('combobox', { name: 'Search universities' }).value, 'Other University');
  fireEvent.click(page.getByRole('button', { name: 'Back' }));
  await waitFor(() => assert.equal(
    page.getByRole('combobox', { name: 'Search universities' }).value,
    'Geeta University',
  ));
  fireEvent.click(page.getByRole('button', { name: 'Forward' }));
  await waitFor(() => assert.equal(
    page.getByRole('combobox', { name: 'Search universities' }).value,
    'Other University',
  ));
  page.unmount();

  const inaccessible = render(
    <MemoryRouter initialEntries={['/reports?view=daily&university=hidden']}>
      <ReportRouteHarness universities={universities} authFetch={async () => ({ items: [], areaSummaries: [] })} />
    </MemoryRouter>,
  );
  await waitFor(() => assert.equal(inaccessible.getByLabelText('Current report URL').textContent, '/reports?view=daily'));
  assert.ok(inaccessible.getByText('Select a university to view completed and pending work.'));
  assert.equal(reportRequests.some(path => path.includes('/hidden/')), false);
  inaccessible.unmount();
  dom.window.close();
});

test('report URL removes legacy status filters and follows area/category history', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  const universities = [{ id: 'geeta', name: 'Geeta University', zone_id: 1, apmName: 'APM One' }];
  const report = {
    items: [
      { id: 'wiring', area: '5.0 Lab', category: 'Electrical', lineItem: 'Wiring', status: 'Done', attachments: [] },
      { id: 'chairs', area: 'Staff Room', category: 'Furniture', lineItem: 'Chairs', status: 'Yet to start', attachments: [] },
    ],
    areaSummaries: [{ area: '5.0 Lab' }, { area: 'Staff Room' }],
  };
  const page = render(
    <MemoryRouter initialEntries={['/reports?view=daily&university=geeta&status=done']}>
      <Routes>
        <Route path="/reports" element={
          <ReportRouteHarness universities={universities} authFetch={async () => report} />
        } />
      </Routes>
    </MemoryRouter>,
  );

  await waitFor(() => assert.equal(page.getByLabelText('Filter report by area').value, 'all'));
  assert.equal(page.getByLabelText('Filter report by category').value, 'all');
  assert.ok(page.getByText('Wiring'), 'a legacy status URL must not hide completed data');
  assert.ok(page.getByText('Chairs'));
  await waitFor(() => assert.equal(
    page.getByLabelText('Current report URL').textContent,
    '/reports?view=daily&university=geeta',
  ));

  fireEvent.change(page.getByLabelText('Filter report by area'), { target: { value: 'Staff Room' } });
  await waitFor(() => assert.equal(
    page.getByLabelText('Current report URL').textContent,
    '/reports?view=daily&university=geeta&area=Staff+Room',
  ));
  fireEvent.change(page.getByLabelText('Filter report by category'), { target: { value: 'Furniture' } });
  await waitFor(() => assert.match(page.getByLabelText('Current report URL').textContent, /category=Furniture/));

  fireEvent.click(page.getByRole('button', { name: 'Back' }));
  await waitFor(() => assert.equal(page.getByLabelText('Filter report by category').value, 'all'));
  fireEvent.click(page.getByRole('button', { name: 'Forward' }));
  await waitFor(() => assert.equal(page.getByLabelText('Filter report by category').value, 'Furniture'));
  page.unmount();

  const invalid = render(
    <MemoryRouter initialEntries={['/reports?university=geeta&area=Roof&category=Unknown&status=blocked']}>
      <ReportRouteHarness universities={universities} authFetch={async () => report} />
    </MemoryRouter>,
  );
  await waitFor(() => assert.equal(invalid.getByLabelText('Current report URL').textContent, '/reports?university=geeta'));
  assert.equal(invalid.getByLabelText('Filter report by area').value, 'all');
  assert.equal(invalid.getByLabelText('Filter report by category').value, 'all');
  assert.equal(invalid.queryByLabelText('Filter report by status'), null);
  invalid.unmount();
  dom.window.close();
});

test('zone and APM filters constrain search results independently of search text', () => {
  const universities = [
    { id: 'geeta', name: 'Geeta University', zone_id: 1, apmName: 'APM One' },
    { id: 'geeta-two', name: 'Geeta Institute', zone_id: 2, apmName: 'APM Two' },
  ];

  assert.deepEqual(
    filterReportUniversities(universities, { zone: '1', apm: 'APM One', search: 'geeta' }).map(item => item.id),
    ['geeta'],
  );
  assert.equal(filterReportUniversities(universities, { zone: '2', apm: 'APM One', search: 'geeta' }).length, 0);
  assert.deepEqual(
    filterReportUniversities([
      { id: 'critical', name: 'Critical', priority: 'LOW', isCritical: true },
      { id: 'medium', name: 'Medium', priority: 'P2' },
      { id: 'low', name: 'Low', priority: 'LOW' },
      { id: 'na', name: 'NA', priority: 'NA' },
    ], { priority: 'MEDIUM' }).map(item => item.id),
    ['medium'],
  );
});

test('shortlist URL restores zone and APM, preserves report filters, and follows history', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render, waitFor, within } = await import('@testing-library/react');
  const universities = [
    { id: 'one', name: 'University One', zone_id: 1, apmName: 'APM One' },
    { id: 'two', name: 'University Two', zone_id: 2, apmName: 'APM Two' },
    { id: 'three', name: 'University Three', zone_id: 2, apmName: 'APM Three' },
  ];
  const report = { items: [], areaSummaries: [{ area: '5.0 Lab' }] };
  const page = render(
    <MemoryRouter initialEntries={['/reports?view=daily&area=5.0+Lab&zone=2&apm=APM+Two&university=two']}>
      <Routes>
        <Route path="/reports" element={
          <ReportRouteHarness universities={universities} authFetch={async () => report} />
        } />
      </Routes>
    </MemoryRouter>,
  );

  assert.ok(page.getByText('Zone', { exact: true }));
  assert.ok(page.getByText('APM', { exact: true }));
  assert.equal(page.getByRole('combobox', { name: 'University category' }).value, 'all');
  assert.ok(page.getByText('University', { exact: true }));
  const actionGroup = page.getByRole('group', { name: 'Report actions' });
  assert.ok(actionGroup);
  assert.ok(within(actionGroup).getByRole('button', { name: /Refresh/ }));
  assert.ok(within(actionGroup).getByRole('button', { name: /Print/ }));
  assert.equal(page.getByLabelText('Zone').value, '2');
  assert.equal(page.getByLabelText('APM').value, 'APM Two');
  assert.equal(page.getByRole('combobox', { name: 'Search universities' }).value, 'University Two');
  assert.equal(page.getAllByRole('combobox', { name: 'Search universities' }).length, 1);
  assert.equal(page.queryByLabelText('Select university'), null);

  fireEvent.change(page.getByRole('combobox', { name: 'University category' }), {
    target: { value: 'LOW' },
  });
  await waitFor(() => assert.equal(
    page.getByLabelText('Current report URL').textContent,
    '/reports?view=daily&area=5.0+Lab&zone=2&apm=APM+Two&university=two&priority=LOW',
  ));
  assert.equal(page.getByRole('combobox', { name: 'Search universities' }).value, 'University Two');
  fireEvent.change(page.getByRole('combobox', { name: 'University category' }), {
    target: { value: 'all' },
  });
  await waitFor(() => assert.equal(
    page.getByLabelText('Current report URL').textContent,
    '/reports?view=daily&area=5.0+Lab&zone=2&apm=APM+Two&university=two',
  ));

  fireEvent.change(page.getByLabelText('APM'), { target: { value: 'APM Three' } });
  await waitFor(() => assert.equal(
    page.getByLabelText('Current report URL').textContent,
    '/reports?view=daily&area=5.0+Lab&zone=2&apm=APM+Three',
  ));
  assert.equal(page.getByRole('combobox', { name: 'Search universities' }).value, '');
  fireEvent.click(page.getByRole('button', { name: 'Back' }));
  await waitFor(() => assert.equal(page.getByLabelText('APM').value, 'APM Two'));
  assert.equal(page.getByRole('combobox', { name: 'Search universities' }).value, 'University Two');
  fireEvent.click(page.getByRole('button', { name: 'Forward' }));
  await waitFor(() => assert.equal(page.getByLabelText('APM').value, 'APM Three'));
  assert.equal(page.getByRole('combobox', { name: 'Search universities' }).value, '');

  fireEvent.change(page.getByLabelText('Zone'), { target: { value: '1' } });
  await waitFor(() => assert.equal(
    page.getByLabelText('Current report URL').textContent,
    '/reports?view=daily&area=5.0+Lab&zone=1',
  ));
  fireEvent.click(page.getByRole('button', { name: 'Back' }));
  await waitFor(() => assert.equal(page.getByLabelText('APM').value, 'APM Three'));
  fireEvent.click(page.getByRole('button', { name: 'Forward' }));
  await waitFor(() => assert.equal(page.getByLabelText('Zone').value, '1'));
  page.unmount();

  const invalid = render(
    <MemoryRouter initialEntries={['/reports?view=daily&area=5.0+Lab&zone=1&apm=APM+Two']}>
      <ReportRouteHarness universities={universities} authFetch={async () => report} />
    </MemoryRouter>,
  );
  await waitFor(() => assert.equal(
    invalid.getByLabelText('Current report URL').textContent,
    '/reports?view=daily&area=5.0+Lab',
  ));
  assert.equal(invalid.getByLabelText('Zone').value, 'all');
  assert.equal(invalid.getByLabelText('APM').value, 'all');
  assert.equal(invalid.getAllByRole('combobox', { name: 'Search universities' }).length, 1);
  assert.equal(invalid.getByRole('combobox', { name: 'Search universities' }).value, '');
  const invalidSearch = invalid.getByRole('combobox', { name: 'Search universities' });
  fireEvent.focus(invalidSearch);
  fireEvent.click(invalidSearch);
  assert.deepEqual(
    [...invalid.getByRole('listbox').querySelectorAll('[role="option"]')].map(option => option.textContent),
    ['University One', 'University Two', 'University Three'],
  );
  invalid.unmount();
  dom.window.close();
});

test('university search URL preserves other filters, clears cleanly, and follows history', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  const universities = [
    { id: 'one', name: 'North University', zone_id: 1, apmName: 'APM One' },
    { id: 'two', name: 'South Institute', zone_id: 1, apmName: 'APM One' },
  ];
  const page = render(
    <MemoryRouter initialEntries={['/reports?view=daily&area=5.0+Lab&zone=1&apm=APM+One&university=one&universitySearch=North']}>
      <Routes>
        <Route path="/reports" element={
          <ReportRouteHarness
            universities={universities}
            authFetch={async () => ({ items: [], areaSummaries: [{ area: '5.0 Lab' }] })}
          />
        } />
      </Routes>
    </MemoryRouter>,
  );
  const search = page.getByRole('combobox', { name: 'Search universities' });

  assert.equal(search.value, 'North University', 'a closed chooser shows the selected university name');
  fireEvent.focus(search);
  fireEvent.click(search);
  assert.equal(search.value, 'North');
  assert.deepEqual(
    [...page.getByRole('listbox').querySelectorAll('[role="option"]')].map(option => option.textContent),
    ['North University'],
  );

  fireEvent.change(search, { target: { value: 'South' } });
  await waitFor(() => assert.equal(
    page.getByLabelText('Current report URL').textContent,
    '/reports?view=daily&area=5.0+Lab&zone=1&apm=APM+One&university=one&universitySearch=South',
  ));
  assert.deepEqual(
    [...page.getByRole('listbox').querySelectorAll('[role="option"]')].map(option => option.textContent),
    ['South Institute'],
  );

  fireEvent.change(search, { target: { value: '' } });
  await waitFor(() => assert.equal(
    page.getByLabelText('Current report URL').textContent,
    '/reports?view=daily&area=5.0+Lab&zone=1&apm=APM+One&university=one',
  ));
  fireEvent.keyDown(search, { key: 'Escape' });
  assert.equal(search.value, 'North University', 'closing the chooser restores the selected name');
  fireEvent.click(page.getByRole('button', { name: 'Back' }));
  await waitFor(() => assert.equal(search.value, 'North University'));
  fireEvent.focus(search);
  assert.equal(search.value, 'South');
  fireEvent.keyDown(search, { key: 'Escape' });
  fireEvent.click(page.getByRole('button', { name: 'Back' }));
  await waitFor(() => assert.equal(search.value, 'North University'));
  fireEvent.click(page.getByRole('button', { name: 'Forward' }));
  await waitFor(() => assert.equal(search.value, 'North University'));
  fireEvent.focus(search);
  assert.equal(search.value, 'South');

  page.unmount();
  dom.window.close();
});

test('an older background report response cannot replace a newly selected university report', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  const pendingRequests = [];
  const universities = [
    { id: 'first', name: 'First University', zone_id: 1, apmName: 'APM One' },
    { id: 'second', name: 'Second University', zone_id: 1, apmName: 'APM One' },
  ];
  const reportFor = lineItem => ({
    items: [{
      id: lineItem,
      area: '5.0 Lab',
      category: 'Electrical',
      lineItem,
      status: 'Partially Done',
      attachments: [],
    }],
    areaSummaries: [{ area: '5.0 Lab' }],
  });
  const page = render(
    <MemoryRouter initialEntries={['/reports']}>
      <DailyReports
        universities={universities}
        authFetch={path => new Promise(resolve => pendingRequests.push({ path, resolve }))}
      />
    </MemoryRouter>,
  );

  chooseReportUniversity(page, fireEvent, 'First University');
  await waitFor(() => assert.equal(pendingRequests.length, 1));
  pendingRequests[0].resolve(reportFor('First report'));
  await waitFor(() => assert.ok(page.queryByText('First report')));

  fireEvent.click(page.getByRole('button', { name: /Refresh/ }));
  await waitFor(() => assert.equal(pendingRequests.length, 2));
  assert.match(pendingRequests[1].path, /\/universities\/first\/daily-report/);

  chooseReportUniversity(page, fireEvent, 'Second University');
  await waitFor(() => assert.equal(pendingRequests.length, 3));
  assert.match(pendingRequests[2].path, /\/universities\/second\/daily-report/);
  fireEvent.focus(window);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(pendingRequests.length, 3);
  assert.equal(page.queryByText('First report'), null);
  assert.ok(page.queryByText('Loading work status…'));

  pendingRequests[2].resolve(reportFor('Second report'));
  await waitFor(() => assert.ok(page.queryByText('Second report')));

  pendingRequests[1].resolve(reportFor('Stale first report'));
  await waitFor(() => {
    assert.ok(page.queryByText('Second report'));
    assert.equal(page.queryByText('Stale first report'), null);
    assert.equal(page.getByRole('button', { name: /Refresh/ }).disabled, false);
  });

  page.unmount();
  dom.window.close();
});

test('a background refresh coalesces with an equivalent initial load', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  const pendingRequests = [];
  const page = render(
    <MemoryRouter initialEntries={['/reports']}>
      <DailyReports
        universities={[{ id: 'first', name: 'First University', zone_id: 1, apmName: 'APM One' }]}
        authFetch={() => new Promise(resolve => pendingRequests.push(resolve))}
      />
    </MemoryRouter>,
  );

  chooseReportUniversity(page, fireEvent, 'First University');
  await waitFor(() => assert.equal(pendingRequests.length, 1));
  fireEvent.focus(window);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(pendingRequests.length, 1);
  pendingRequests[0]({
    items: [{ ...item({ id: 'new', classroomName: null }), lineItem: 'Newest report' }],
    areaSummaries: [{ area: 'All Classrooms' }],
  });

  await waitFor(() => {
    assert.ok(page.queryByText('Newest report'));
    assert.equal(page.queryByText('Loading work status…'), null);
    assert.equal(page.getByRole('button', { name: /Refresh/ }).disabled, false);
  });
  page.unmount();
  dom.window.close();
});

test('refreshing Daily Updates does not insert a visible row above the report filters', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  let updatesRequests = 0;
  let resolveUpdatesRefresh;
  const report = {
    reportDate: '2026-09-18',
    generatedAt: '2026-09-18T06:30:00.000Z',
    items: [{ ...item({ id: 'stable', classroomName: null }), lineItem: 'Stable report row' }],
    areaSummaries: [{ area: 'All Classrooms' }],
  };
  const page = render(
    <MemoryRouter initialEntries={['/reports?university=first']}>
      <DailyReportsPage
        universities={[{ id: 'first', name: 'First University', zone_id: 1, apmName: 'APM One' }]}
        authFetch={path => {
          if (path.endsWith('/updates')) {
            updatesRequests += 1;
            return updatesRequests === 1
              ? Promise.resolve([])
              : new Promise(resolve => { resolveUpdatesRefresh = resolve; });
          }
          return Promise.resolve(report);
        }}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(page.queryByText('Stable report row'));
    assert.equal(page.getByRole('button', { name: 'Print / Save PDF' }).disabled, false);
  });
  fireEvent.click(page.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => assert.equal(typeof resolveUpdatesRefresh, 'function'));

  assert.equal(page.container.querySelector('.daily-report-messages p'), null,
    'refresh readiness must not add visible height above the filters');
  assert.ok(page.getByText('Print and PDF will be available when Daily Updates finishes loading.'));
  resolveUpdatesRefresh([]);
  await waitFor(() => assert.equal(page.getByRole('button', { name: 'Print / Save PDF' }).disabled, false));

  page.unmount();
  dom.window.close();
});

test('clearing the university while a report loads restores the empty state', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  let resolveReport;
  let requestSignal;
  const page = render(
    <MemoryRouter initialEntries={['/reports']}>
      <DailyReports
        universities={[{ id: 'first', name: 'First University', zone_id: 1, apmName: 'APM One' }]}
        authFetch={(_url, options) => new Promise(resolve => {
          requestSignal = options.signal;
          resolveReport = resolve;
        })}
      />
    </MemoryRouter>,
  );
  chooseReportUniversity(page, fireEvent, 'First University');
  await waitFor(() => assert.equal(typeof resolveReport, 'function'));
  fireEvent.click(page.getByRole('button', { name: 'Clear selected university' }));
  assert.equal(requestSignal.aborted, true, 'clearing selection must cancel the network request');
  await waitFor(() => {
    assert.ok(page.queryByText('Select a university to view completed and pending work.'));
    assert.equal(page.queryByText('Loading work status…'), null);
  });
  resolveReport({
    items: [{ ...item({ id: 'stale', classroomName: null }), lineItem: 'Stale report' }],
    areaSummaries: [{ area: 'All Classrooms' }],
  });
  await waitFor(() => assert.equal(page.queryByText('Stale report'), null));

  page.unmount();
  dom.window.close();
});

test('clearing and reselecting a university starts a fresh report request', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  const pendingRequests = [];
  const page = render(
    <MemoryRouter initialEntries={['/reports']}>
      <DailyReports
        universities={[{ id: 'first', name: 'First University', zone_id: 1, apmName: 'APM One' }]}
        authFetch={() => new Promise(resolve => pendingRequests.push(resolve))}
      />
    </MemoryRouter>,
  );
  chooseReportUniversity(page, fireEvent, 'First University');
  await waitFor(() => assert.equal(pendingRequests.length, 1));
  fireEvent.click(page.getByRole('button', { name: 'Clear selected university' }));
  await waitFor(() => assert.ok(page.queryByText('Select a university to view completed and pending work.')));
  chooseReportUniversity(page, fireEvent, 'First University');
  await waitFor(() => assert.equal(pendingRequests.length, 2));

  pendingRequests[0]({
    items: [{ ...item({ id: 'stale', classroomName: null }), lineItem: 'Discarded report' }],
    areaSummaries: [{ area: 'All Classrooms' }],
  });
  pendingRequests[1]({
    items: [{ ...item({ id: 'fresh', classroomName: null }), lineItem: 'Fresh report' }],
    areaSummaries: [{ area: 'All Classrooms' }],
  });
  await waitFor(() => {
    assert.ok(page.queryByText('Fresh report'));
    assert.equal(page.queryByText('Discarded report'), null);
    assert.equal(page.queryByText('Loading work status…'), null);
  });

  page.unmount();
  dom.window.close();
});

test('search picker switches universities and clears only university state with pointer and keyboard', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  const universities = [
    { id: 'alard', name: 'Alard University', zone_id: 2, apmName: 'APM Two' },
    { id: 'another', name: 'Another University', zone_id: 2, apmName: 'APM Two' },
    { id: 'outside', name: 'Outside University', zone_id: 1, apmName: 'APM One' },
  ];
  const reportFor = id => ({
    items: [{ id, area: '5.0 Lab', category: 'Electrical', lineItem: `${id} report`, status: 'Partially Done', attachments: [] }],
    areaSummaries: [{ area: '5.0 Lab' }],
  });
  const page = render(
    <MemoryRouter initialEntries={['/reports?view=daily&zone=2&apm=APM+Two']}>
      <Routes>
        <Route path="/reports" element={
          <ReportRouteHarness
            universities={universities}
            authFetch={async path => reportFor(path.includes('/alard/') ? 'Alard' : 'Another')}
          />
        } />
      </Routes>
    </MemoryRouter>,
  );
  const search = page.getByRole('combobox', { name: 'Search universities' });

  fireEvent.focus(search);
  fireEvent.click(search);
  assert.equal(search.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(
    page.getAllByRole('option').filter(option => option.closest('[role="listbox"]')).map(option => option.textContent),
    ['Alard University', 'Another University'],
  );
  fireEvent.click([...page.getByRole('listbox').querySelectorAll('[role="option"]')]
    .find(option => option.textContent === 'Alard University'));
  await waitFor(() => assert.ok(page.queryByText('Alard report')));
  assert.equal(search.value, 'Alard University');
  assert.match(page.getByLabelText('Current report URL').textContent, /university=alard/);

  fireEvent.change(search, { target: { value: 'another' } });
  assert.equal(search.getAttribute('aria-expanded'), 'true');
  assert.equal([...page.getByRole('listbox').querySelectorAll('[role="option"]')]
    .find(option => option.textContent === 'Another University').getAttribute('aria-selected'), 'false');
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => assert.ok(page.queryByText('Another report')));
  assert.equal(page.queryByText('Alard report'), null);
  assert.equal(search.value, 'Another University');
  assert.match(page.getByLabelText('Current report URL').textContent, /university=another/);

  fireEvent.click(search);
  assert.equal(search.getAttribute('aria-expanded'), 'true');
  fireEvent.change(search, { target: { value: 'alard' } });
  fireEvent.click([...page.getByRole('listbox').querySelectorAll('[role="option"]')]
    .find(option => option.textContent === 'Alard University'));
  await waitFor(() => assert.ok(page.queryByText('Alard report')));
  assert.equal(page.queryByText('Another report'), null);
  assert.equal(search.value, 'Alard University');
  assert.match(page.getByLabelText('Current report URL').textContent, /university=alard/);

  const clear = page.getByRole('button', { name: 'Clear selected university' });
  clear.focus();
  fireEvent.keyDown(clear, { key: 'Enter' });
  fireEvent.click(clear);
  await waitFor(() => assert.equal(
    page.getByLabelText('Current report URL').textContent,
    '/reports?view=daily&zone=2&apm=APM+Two',
  ));
  assert.equal(search.value, '');
  assert.ok(page.queryByText('Select a university to view completed and pending work.'));
  assert.equal(page.queryByText('Alard report'), null);
  assert.equal(page.getByLabelText('Zone').value, '2');
  assert.equal(page.getByLabelText('APM').value, 'APM Two');

  page.unmount();
  dom.window.close();
});

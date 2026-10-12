import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';

test('Gmail preview identifies the sender and retries only the saved confirmation', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { render, fireEvent, waitFor } = await import('@testing-library/react');
  const { default: SendReportDialog } = await import('./SendReportDialog.jsx');
  const requests = [];
  const page = render(<SendReportDialog onClose={() => {}} universities={[]} authFetch={async (path, options) => {
    if (path.endsWith('/preview')) return {
      previewId: 'gmail-reviewed', expiresAt: new Date(Date.now() + 60000).toISOString(),
      generatedAt: new Date().toISOString(), recipients: ['recipient@example.com'],
      scope: { universityCount: 0 }, summary: { pendingItems: 0 }, universities: [],
      delivery: { mode: 'live', provider: 'gmail', senderEmail: 'sender@example.com',
        message: 'Live mode: confirmation submits the reviewed report to Gmail (sender@example.com).' },
    };
    requests.push(JSON.parse(options.body));
    throw Object.assign(new Error('Gmail outcome unknown; do not resend.'), { status: 409 });
  }} />);
  try {
    fireEvent.click(page.getByRole('button', { name: 'Generate Preview' }));
    await page.findByText(/Gmail \(sender@example.com\)/);
    fireEvent.click(page.getByRole('button', { name: 'Confirm & Send' }));
    await page.findByText(/Gmail sends with an unknown outcome will not be submitted again/);
    assert.equal(page.queryByRole('button', { name: 'Edit Settings' }), null);
    assert.equal(page.queryByRole('button', { name: 'Regenerate Preview' }), null);
    fireEvent.click(page.getByRole('button', { name: 'Retry Confirmation' }));
    await waitFor(() => assert.equal(requests.length, 2));
    assert.deepEqual(requests, [
      { previewId: 'gmail-reviewed', confirmed: true },
      { previewId: 'gmail-reviewed', confirmed: true },
    ]);
  } finally {
    page.unmount();
    dom.window.close();
  }
});

test('SendReportDialog setup: editable recipients, scope selection, explicit validations', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });

  const { render, fireEvent, waitFor } = await import('@testing-library/react');
  const SendReportDialog = (await import('./SendReportDialog')).default;

  const fakeUniversities = Array.from({ length: 4 }, (_, i) => ({
    id: `u-${i}`,
    name: `University ${i}`,
    isCritical: i % 2 === 0,
    counts: { pending: 1, blockers: 0 },
    pendingItems: []
  }));

  let lastPayload = null;
  const sendPayloads = [];
  let forceSendError = false;

  const mockFetch = async (url, options) => {
    if (url === '/reports/pending/preview') {
      lastPayload = JSON.parse(options.body);
      return {
        previewId: 'mock-id',
        generatedAt: '2026-05-15T10:00:00.000Z',
        expiresAt: new Date(Date.now() + 100000).toISOString(),
        scope: { universityCount: lastPayload.universityIds ? lastPayload.universityIds.length : 12 },
        summary: { pendingItems: 41 },
        recipients: lastPayload.recipients,
        delivery: {
          mode: 'demonstration',
          message: 'Safe test message'
        },
        universities: [
          {
            id: 'u-1',
            name: 'University 1',
            counts: { pending: 1, blockers: 0 },
            pendingItems: [
              {
                id: 'item-1',
                item: 'Broken Window',
                category: 'Civil',
                space: 'Main Block',
                status: 'Blocker',
                isBlocker: true,
                targetDate: '2026-05-20',
                targetDateSource: 'Latest Update',
                remarks: 'Needs urgent fixing'
              }
            ]
          }
        ],
        attachment: { filename: 'correct-file.csv' }
      };
    }
    
    if (url === '/reports/pending/send') {
      sendPayloads.push(JSON.parse(options.body));
      if (forceSendError) throw new Error('Network Issue');
      return {
        accepted: true,
        deliveryMode: 'demonstration',
        message: 'Report Request Accepted',
        auditRecorded: true,
        recipients: lastPayload.recipients
      };
    }
    return {};
  };

  const screen = render(<SendReportDialog 
    onClose={() => {}} 
    authFetch={mockFetch} 
    universities={fakeUniversities} 
    currentUniversityId="u-1" 
  />, { container: document.getElementById('root') });
  const { unmount } = screen;

  // 1. Initial State: Setup view
  assert.ok(document.body.textContent.includes('University Scope'), 'Shows scope setup');
  
  // Wait for initial renders
  await waitFor(() => {});
  const defaults = [
    'karthik@nxtwave.tech',
    'Varshith@nxtwave.tech',
    'satish.jada@nxtwave.co.in',
    'srinivas.vatturi@nxtwave.tech',
    'ramesh@nxtwave.co.in',
  ];
  assert.deepEqual(
    Array.from(screen.container.querySelectorAll('.send-report-email-list input')).map(input => input.value),
    defaults,
    'setup prefills the five manual recipients in order',
  );

  // Scope mode radio checks
  const allRadio = screen.getByRole('radio', { name: /All active universities/i });
  const selectedRadio = screen.getByRole('radio', { name: /Selected universities/i });
  assert.equal(allRadio.checked, false, 'Preselected ID means mode is selected');
  assert.equal(selectedRadio.checked, true, 'Preselected ID means mode is selected');

  const uni1Checkbox = screen.getAllByRole('checkbox').find(cb => cb.closest('label')?.textContent.includes('University 1'));
  assert.equal(uni1Checkbox.checked, true, 'University 1 is checked');

  // Edit existing email inline
  const editEmailInput = screen.getByDisplayValue('karthik@nxtwave.tech');
  fireEvent.change(editEmailInput, { target: { value: 'edited@nxtwave.tech' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove recipient 3' }));
  
  // Try to generate preview with dirty invalid newEmail
  const emailInput = screen.getByPlaceholderText('Add recipient email...');
  fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
  
  fireEvent.click(screen.getByRole('button', { name: /Generate Preview/i }));
  await waitFor(() => {
    assert.ok(document.body.textContent.includes('Please fix the invalid email in the new recipient field.'), 'Caught dirty invalid newEmail');
  });

  // Try to generate preview with dirty valid newEmail
  fireEvent.change(emailInput, { target: { value: 'custom@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: /Generate Preview/i }));
  
  await waitFor(() => {
    if (!document.body.textContent.includes('Safe test message')) throw new Error('Not loaded preview');
  });

  // Focused DOM assertion for new compact table
  assert.ok(document.body.textContent.includes('Broken Window'), 'Table shows item title');
  assert.ok(document.body.textContent.includes('Civil • Main Block'), 'Table shows category and location');
  assert.ok(document.body.textContent.includes('Needs urgent fixing'), 'Table shows remarks');

  // Verify preview payload
  const reviewedRecipients = [
    'edited@nxtwave.tech',
    defaults[1],
    defaults[3],
    defaults[4],
    'custom@example.com',
  ];
  assert.deepEqual(lastPayload.recipients, reviewedRecipients, 'Payload reflects edits, removals, and additions');
  assert.deepEqual(
    Array.from(Array.from(screen.container.querySelectorAll('.send-report-section'))
      .find(section => section.querySelector('h3')?.textContent === 'Recipients')
      .querySelectorAll('.send-report-recipient span'))
      .map(node => node.textContent),
    reviewedRecipients,
    'preview displays the chosen recipients',
  );
  assert.deepEqual(lastPayload.universityIds, ['u-1'], 'Payload includes specific universityId');

  // Edit Settings (unattempted)
  fireEvent.click(screen.getByRole('button', { name: /Edit Settings/i }));
  
  await waitFor(() => {
    assert.ok(document.body.textContent.includes('University Scope'), 'Returned to setup');
  });

  // Check validation for selected scope but empty array
  fireEvent.click(screen.getByRole('checkbox', { name: /University 1/i })); // uncheck the only selected
  
  fireEvent.click(screen.getByRole('button', { name: /Generate Preview/i }));
  await waitFor(() => {
    assert.ok(document.body.textContent.includes('Please select at least one university, or switch to All active universities'), 'Caught empty selected scope validation');
  });

  // Re-check a university to fix scope
  fireEvent.click(screen.getByRole('checkbox', { name: /University 3/i }));
  const allRadioElement = screen.getByRole('radio', { name: /All active universities/i });
  fireEvent.click(allRadioElement);
  await waitFor(() => {
    assert.equal(allRadioElement.checked, true, 'Switched to all active');
  });

  fireEvent.click(screen.getByRole('button', { name: /Generate Preview/i }));
  await waitFor(() => {
    if (!document.body.textContent.includes('Safe test message')) throw new Error('Not loaded preview');
  });
  assert.equal(lastPayload.universityIds, undefined, 'Payload omitted universityIds because All was selected');

  // Failed Send -> Retry (ensure edit is gone)
  forceSendError = true;
  fireEvent.click(screen.getByRole('button', { name: /Confirm & Send/i }));

  await waitFor(() => {
    if (!document.body.textContent.includes('Network Issue')) throw new Error('Not failed');
  });
  
  assert.equal(screen.queryByRole('button', { name: /Edit Settings/i }), null, 'Edit Settings button hidden after attempt');

  const retryBtn = screen.getByRole('button', { name: /Retry Send/i });
  forceSendError = false;
  fireEvent.click(retryBtn);

  await waitFor(() => {
    if (!document.body.textContent.includes('Report Request Accepted')) throw new Error('Not success');
  });
  assert.deepEqual(sendPayloads, [
    { previewId: 'mock-id', confirmed: true },
    { previewId: 'mock-id', confirmed: true },
  ], 'confirmation and retry identify the reviewed preview without sending a new recipient list');

  unmount();
});

test('SendReportDialog grouping: ordered Classrooms -> Lab -> Staff Room -> Other', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });

  const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
  const SendReportDialog = (await import('./SendReportDialog')).default;

  const fakeUniversities = [{ id: 'u-1', name: 'University 1', isCritical: false }];

  const mockFetch = async (url, options) => {
    if (url === '/reports/pending/preview') {
      return {
        previewId: 'mock-id-2',
        expiresAt: new Date(Date.now() + 100000).toISOString(),
        recipients: ['test@example.com'],
        universities: [
          {
            id: 'u-1',
            name: 'University 1',
            counts: { pending: 4 },
            pendingItems: [
              { id: 'i1', space: 'Staff Room', item: 'Staff item', status: 'Blocker' }, // Staff -> 3rd
              { id: 'i2', space: 'Kitchen', item: 'Kitchen item', status: 'Done' }, // Other -> 4th
              { id: 'i3', space: 'Model Classroom', item: 'Model CR item', status: 'Blocker' }, // CR -> 1st
              { id: 'i4', space: '5.0 Lab', item: 'Lab item', status: 'In-Progress' }, // Lab -> 2nd
            ]
          }
        ]
      };
    }
    return {};
  };

  const { unmount, container } = render(<SendReportDialog
    onClose={() => {}}
    authFetch={mockFetch}
    universities={fakeUniversities}
    currentUniversityId="u-1"
    user={{ role: 'admin' }}
  />, { container: dom.window.document.getElementById('root') });

  // Generate preview
  fireEvent.click(container.querySelector('button.button-primary'));

  await waitFor(() => {
    if (!container.textContent.includes('Staff item')) throw new Error('Not loaded preview');
  });

  const trs = container.querySelectorAll('table.daily-report-table tbody tr');

  // Look for our group headers. There are 4 groups.
  // Each group has a header TR, then the item TR(s).
  // Total TRs = 8 (4 headers, 4 items)
  const rows = Array.from(trs).map(tr => ({
    text: tr.textContent.trim(),
    classes: tr.className
  }));

  const headers = rows.filter(r => r.classes.includes('daily-area-group-start'));
  assert.equal(headers.length, 3, 'Each section after the first has a separation border');

  // Let's just check the order of texts
  const tableText = container.querySelector('table.daily-report-table').textContent;

   const crIndex = tableText.indexOf('Classrooms (1)');
  const labIndex = tableText.indexOf('Lab Room (1)');
  const staffIndex = tableText.indexOf('Staff Room (1)');
  const otherIndex = tableText.indexOf('Other Areas (1)');

   assert.ok(crIndex > -1, 'Classrooms header found');
  assert.ok(labIndex > -1, 'Lab header found');
  assert.ok(staffIndex > -1, 'Staff header found');
  assert.ok(otherIndex > -1, 'Other header found');

  assert.ok(crIndex < labIndex, 'CR before Lab');
  assert.ok(labIndex < staffIndex, 'Lab before Staff');
  assert.ok(staffIndex < otherIndex, 'Staff before Other');

  // Verify class names applied to the data rows
  const dataRows = rows.filter(r => r.classes.includes('daily-area-group') && !r.text.match(/\(\d+\)$/));

  assert.ok(dataRows.find(r => r.classes.includes('daily-area-classrooms') && r.text.includes('Model CR item')), 'CR item has correct class');
  assert.ok(dataRows.find(r => r.classes.includes('daily-area-lab') && r.text.includes('Lab item')), 'Lab item has correct class');
  assert.ok(dataRows.find(r => r.classes.includes('daily-area-staff') && r.text.includes('Staff item')), 'Staff item has correct class');
  assert.ok(dataRows.find(r => r.classes.includes('daily-area-other') && r.text.includes('Kitchen item')), 'Other item has correct class');

  unmount();
});

test('SendReportDialog section checkboxes default to all, validate none, and freeze selection in preview requests', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });

  const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
  const SendReportDialog = (await import('./SendReportDialog')).default;
  const requests = [];
  const mockFetch = async (url, options) => {
    if (url.endsWith('/preview')) {
      const payload = JSON.parse(options.body);
      requests.push(payload);
      return {
        previewId: `sections-${requests.length}`,
        expiresAt: new Date(Date.now() + 100000).toISOString(),
        recipients: payload.recipients,
        sections: payload.sections,
        scope: { universityCount: 0 },
        summary: { pendingItems: 0, blockers: 0, overdue: 0 },
        universities: [],
      };
    }
    return {};
  };

  const page = render(<SendReportDialog onClose={() => {}} authFetch={mockFetch} universities={[]} />, {
    container: dom.window.document.getElementById('root'),
  });
  try {
    const cr = page.getByRole('checkbox', { name: 'CR (Classrooms)' });
    const lab = page.getByRole('checkbox', { name: 'Lab Room' });
    const staff = page.getByRole('checkbox', { name: 'Staff Room' });
    const dailyRemarks = page.getByRole('checkbox', { name: 'Daily Remarks' });
    assert.equal(cr.checked, true);
    assert.equal(lab.checked, true);
    assert.equal(staff.checked, true);
    assert.equal(dailyRemarks.checked, true);

    fireEvent.click(cr);
    fireEvent.click(page.getByRole('button', { name: /Generate Preview/i }));
    await waitFor(() => assert.equal(requests.length, 1));
    assert.deepEqual(requests[0].sections, ['lab', 'staff', 'dailyRemarks']);
    assert.equal(requests[0].priority, 'ALL');

    fireEvent.click(page.getByRole('button', { name: /Edit Settings/i }));
    await waitFor(() => {
      page.getByText('Report Sections');
      assert.equal(page.queryByText('Report Scope'), null, 'editing settings invalidates the reviewed preview');
    });
    fireEvent.click(page.getByRole('checkbox', { name: 'Lab Room' }));
    fireEvent.click(page.getByRole('checkbox', { name: 'Staff Room' }));
    fireEvent.click(page.getByRole('checkbox', { name: 'Daily Remarks' }));
    await waitFor(() => assert.ok(page.getByRole('alert')));
    fireEvent.click(page.getByRole('button', { name: /Generate Preview/i }));
    await waitFor(() => assert.match(page.container.textContent, /Select at least one report section/));
    assert.equal(requests.length, 1, 'none selected never reaches preview API');
  } finally {
    page.unmount();
    dom.window.close();
  }
});

test('SendReportDialog preview shows section states, normalized statuses, and UTC dates', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });

  const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
  const SendReportDialog = (await import('./SendReportDialog')).default;
  const university = {
    id: 'uni-sections',
    name: 'Sections University',
    sectionDataStates: {
      classrooms: ' AVAILABLE ',
      lab: ' MISSING ',
      staff: ' AVAILABLE ',
    },
  };

  const preview = {
    previewId: 'sections-preview',
    generatedAt: '2026-05-15T23:45:06.000Z',
    expiresAt: new Date(Date.now() + 100000).toISOString(),
    recipients: ['test@example.com'],
    scope: { universityCount: 1 },
    summary: { pendingItems: 2 },
    universities: [{
      ...university,
      counts: { pending: 2, blockers: 0 },
      pendingItems: [
        {
          id: 'classroom-1',
          roomGroup: '  CLASSROOMS  ',
          space: 'All Classrooms',
          item: 'Classroom item',
          category: 'Network',
          status: '  partially   done ',
          targetDate: '2026-05-20',
          targetDateSource: 'target timeline',
          remarks: 'Reviewed',
        },
        {
          id: 'other-1',
          roomGroup: '  Unknown room group ',
          space: ' Kitchen ',
          item: 'Other item',
          category: 'Civil',
          status: ' mystery status ',
        },
      ],
    }],
  };

  const { container, unmount } = render(<SendReportDialog
    onClose={() => {}}
    authFetch={async url => url.endsWith('/preview') ? preview : {}}
    universities={[university]}
    currentUniversityId={university.id}
  />, { container: dom.window.document.getElementById('root') });

  try {
    fireEvent.click(container.querySelector('button.button-primary'));
    await waitFor(() => {
      if (!container.textContent.includes('Classroom item')) throw new Error('Not loaded preview');
    });

    const tableText = container.querySelector('table.daily-report-table').textContent;
    assert.ok(tableText.includes('Classrooms (1)'), 'Canonical roomGroup is grouped into Classrooms');
    assert.ok(tableText.includes('Lab Room (0)'), 'Missing Lab section remains visible');
    assert.ok(tableText.includes('Staff Room (0)'), 'Empty Staff section remains visible');
    assert.ok(tableText.includes('Other Areas (1)'), 'Unknown roomGroup remains in Other Areas');
    assert.ok(tableText.includes('Checklist data is missing; this section is not described as complete.'), 'Missing section is not described as complete');
    assert.ok(tableText.includes('No pending items reported.'), 'Available empty section is truthful');
    assert.ok(container.textContent.includes('Generated: 15 May 2026, 23:45:06 UTC'), 'Generation uses explicit UTC');
    assert.ok(tableText.includes('20 May 2026'), 'Target date uses an en-GB human date in UTC');

    const partialStatus = Array.from(container.querySelectorAll('.daily-status')).find(node => node.textContent === 'Partially Done');
    assert.ok(partialStatus, 'Status casing and whitespace are normalized');
    assert.equal(partialStatus.style.color, 'rgb(109, 40, 217)');
    assert.equal(partialStatus.style.backgroundColor, 'rgb(245, 243, 255)');
    assert.equal(container.querySelectorAll('.send-report-university-detail').length, 1, 'University identity is rendered once');
  } finally {
    unmount();
    dom.window.close();
  }
});

test('SendReportDialog legacy section data stays unknown instead of implying completeness', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });

  const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
  const SendReportDialog = (await import('./SendReportDialog')).default;
  const university = { id: 'legacy-uni', name: 'Legacy University' };
  const { container, unmount } = render(<SendReportDialog
    onClose={() => {}}
    authFetch={async url => url.endsWith('/preview') ? {
      previewId: 'legacy-preview',
      expiresAt: new Date(Date.now() + 100000).toISOString(),
      recipients: ['test@example.com'],
      scope: { universityCount: 1 },
      summary: { pendingItems: 0 },
      universities: [{ ...university, checklistDataState: 'available', pendingItems: [] }],
    } : {}}
    universities={[university]}
    currentUniversityId={university.id}
  />);

  try {
    fireEvent.click(container.querySelector('button.button-primary'));
    await waitFor(() => {
      if (!container.textContent.includes('completeness not established.')) throw new Error('Not loaded legacy preview');
    });
    assert.equal(
      container.textContent.includes('No pending items in reviewed data; completeness not established.'),
      true,
      'Legacy sections do not claim checklist completeness',
    );
  } finally {
    unmount();
    dom.window.close();
  }
});

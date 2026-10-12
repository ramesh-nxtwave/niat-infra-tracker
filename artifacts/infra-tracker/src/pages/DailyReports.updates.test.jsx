import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { MemoryRouter } from 'react-router-dom';
import DailyReports from './DailyReports';

test('Reports scopes history, rejects superseded responses and refreshes independently of checklist filters', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { render, fireEvent, waitFor, act, within } = await import('@testing-library/react');
  const pending = [];
  const report = {
    items: [
      { id: 'wire', lineItem: 'Wiring', area: '5.0 Lab', category: 'Electrical', status: 'In-Progress', attachments: [] },
      { id: 'complete', lineItem: 'Completed checklist', area: '5.0 Lab', category: 'Electrical', status: 'N/A', attachments: [] },
    ],
    areaSummaries: [{ area: '5.0 Lab' }, { area: 'Staff Room' }],
  };
  const page = render(
    <MemoryRouter initialEntries={['/reports?university=one']}>
      <DailyReports
        universities={[{ id: 'one', name: 'University One' }, { id: 'two', name: 'University Two' }]}
        authFetch={(path, options) => path.endsWith('/updates')
          ? new Promise((resolve, reject) => pending.push({ path, options, resolve, reject }))
          : Promise.resolve(report)}
      />
    </MemoryRouter>,
  );
  const update = (content) => [{ id: content, content, createdAt: '2026-09-10T12:00:00Z' }];
  try {
    await page.findByText('Wiring');
    assert.equal(pending.length, 1);
    const printButton = page.getByRole('button', { name: /Print \/ (?:Save )?PDF/ });
    assert.equal(printButton.disabled, true, 'printing waits for independently loaded history');
    await act(async () => pending[0].resolve(update('First university note')));
    await page.findByText('First university note');
    await waitFor(() => assert.equal(printButton.disabled, false));
    const actionGroup = page.getByRole('group', { name: 'Report actions' });
    assert.ok(within(actionGroup).getByRole('button', { name: /Refresh/ }));
    assert.ok(within(actionGroup).getByRole('button', { name: /Print/ }));
    fireEvent.change(page.getByLabelText('Filter report by area'), { target: { value: '5.0 Lab' } });
    fireEvent.change(page.getByLabelText('Filter report by category'), { target: { value: 'Electrical' } });
    assert.ok(page.getByText('First university note'));
    assert.equal(pending.length, 1, 'checklist filters do not refetch or filter university history');

    fireEvent.click(page.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => assert.equal(pending.length, 2));
    assert.equal(printButton.disabled, true, 'printing stays disabled until refreshed history arrives');
    assert.ok(page.getByText('Wiring'), 'the existing report remains mounted during refresh');
    assert.equal(page.container.querySelector('.daily-report-loading'), null,
      'refresh does not replace the report with an in-flow loading panel');
    const universitySearch = page.getByRole('combobox', { name: 'Search universities' });
    assert.equal(page.getAllByRole('combobox', { name: 'Search universities' }).length, 1);
    assert.equal(page.queryByLabelText('Select university'), null);
    assert.equal(universitySearch.value, 'University One');
    fireEvent.focus(universitySearch);
    fireEvent.click(page.getByRole('option', { name: 'University Two', exact: true }));
    assert.equal(page.queryByText('First university note'), null);
    await waitFor(() => assert.equal(pending.length, 3));
    assert.equal(pending[1].options.signal.aborted, true);
    await act(async () => pending[2].resolve(update('Second university note')));
    await page.findByText('Second university note');
    await act(async () => pending[1].resolve(update('Stale first university note')));
    assert.equal(page.queryByText('Stale first university note'), null);
    assert.ok(page.getByText('Second university note'));

    fireEvent.click(page.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => assert.equal(pending.length, 4));
    await act(async () => pending[3].resolve(update('Newly posted note')));
    await page.findByText('Newly posted note');
    assert.equal(page.queryByRole('button', { name: 'Post Update' }), null);
    assert.equal(page.queryByRole('button', { name: 'Edit' }), null);
    assert.equal(page.container.querySelector('textarea,input[type=file]'), null);
    assert.deepEqual(pending.map(request => request.path), [
      '/universities/one/updates', '/universities/one/updates', '/universities/two/updates', '/universities/two/updates',
    ]);
    fireEvent.click(page.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => assert.equal(pending.length, 5));
    const historyCard = page.getByText('Newly posted note').closest('article');
    await act(async () => pending[4].reject(new Error('History temporarily unavailable')));
    await page.findByText(/History temporarily unavailable/);
    assert.equal(page.getByText('Newly posted note').closest('article'), historyCard,
      'failed refresh does not unmount previously loaded history or media');
    assert.equal(printButton.disabled, true, 'retry is required before printing stale history');
    assert.ok(page.getByRole('heading', { name: 'Lab Room', exact: true }),
      'a failed history request leaves the pending checklist readable');
    assert.ok(page.getByRole('heading', { name: 'Done', exact: true }));
    assert.ok(page.getAllByText('Completed checklist').length >= 1);
    fireEvent.click(page.getByRole('button', { name: 'Retry daily updates' }));
    await waitFor(() => assert.equal(pending.length, 6));
    await act(async () => pending[5].resolve([]));
    await page.findByText('No daily updates yet.');
    await waitFor(() => assert.equal(printButton.disabled, false));
  } finally {
    page.unmount();
    dom.window.close();
  }
});
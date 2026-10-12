import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import ReportDailyUpdates, {
  formatUpdateDate,
  normalizeUpdateMedia,
  sortUpdatesNewestFirst,
} from './ReportDailyUpdates';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  return dom;
}

test('report updates render newest first with UTC date groups and full text', async () => {
  const dom = installDom();
  const { render, waitFor } = await import('@testing-library/react');
  const updates = [
    {
      id: 'older',
      createdAt: '2025-03-01T09:05:00.000Z',
      authorName: 'Older author',
      content: 'Older note',
    },
    {
      id: 'newer',
      createdAt: '2025-03-02T01:05:00.000Z',
      authorName: '',
      content: 'The complete multiline note\\nwith no read-more truncation.',
    },
    {
      id: 'same-day',
      createdAt: '2025-03-02T00:05:00.000Z',
      authorName: 'Field lead',
      content: 'Same UTC date',
    },
  ];
  const page = render(
    <ReportDailyUpdates
      universityId="university-one"
      authFetch={async path => {
        assert.equal(path, '/universities/university-one/updates');
        return updates;
      }}
      refreshKey={0}
    />,
  );

  try {
    await waitFor(() => assert.ok(page.getByText('The complete multiline note\\nwith no read-more truncation.')));
    const cards = [...page.container.querySelectorAll('.report-daily-updates-card')];
    assert.deepEqual(cards.map(card => card.textContent.includes('Older note')), [false, false, true]);
    assert.ok(page.getByText('Team'));
    assert.ok(page.getByText('University-wide history across all dates and checklist areas.'));
    assert.equal(page.getAllByText('2 updates').length, 1);
    assert.equal(page.getByText(formatUpdateDate('2025-03-02')).textContent, formatUpdateDate('2025-03-02'));
    const olderDatePill = page.container.querySelector('time[datetime="2025-03-01"]');
    assert.ok(olderDatePill);
    assert.equal(olderDatePill.textContent, formatUpdateDate('2025-03-01'));
  } finally {
    page.unmount();
    dom.window.close();
  }
});

test('report updates preserve visible notes while a refresh is pending', async () => {
  const dom = installDom();
  const { render, waitFor } = await import('@testing-library/react');
  let resolveRefresh;
  let requestCount = 0;
  const page = render(
    <ReportDailyUpdates
      universityId="university-one"
      refreshKey={0}
      authFetch={() => {
        requestCount += 1;
        if (requestCount === 1) return Promise.resolve([{
          id: 'first',
          createdAt: '2025-03-02T01:05:00.000Z',
          content: 'Visible before the background refresh',
        }]);
        return new Promise(resolve => { resolveRefresh = resolve; });
      }}
    />,
  );

  try {
    await waitFor(() => assert.ok(page.getByText('Visible before the background refresh')));
    const existingCard = page.container.querySelector('.report-daily-updates-card');
    page.rerender(
      <ReportDailyUpdates
        universityId="university-one"
        refreshKey={1}
        authFetch={() => {
          requestCount += 1;
          return new Promise(resolve => { resolveRefresh = resolve; });
        }}
      />,
    );
    await waitFor(() => {
      assert.ok(page.getByText('Visible before the background refresh'));
      assert.ok(page.getByText('Refreshing daily updates…'));
      assert.ok(page.getByText('Refreshing daily updates…').closest('.report-daily-updates-feedback'));
      assert.equal(page.container.querySelector('.report-daily-updates-refreshing'), null,
        'refresh feedback must not insert a new block above the existing updates');
      assert.equal(page.container.querySelector('.report-daily-updates-card'), existingCard,
        'background refresh must not remount cards and their media');
    });
    resolveRefresh([{
      id: 'second',
      createdAt: '2025-03-03T01:05:00.000Z',
      content: 'Updated background note',
    }]);
    await waitFor(() => assert.ok(page.getByText('Updated background note')));
  } finally {
    page.unmount();
    dom.window.close();
  }
});

test('invalid update responses show an explicit retry state and retry successfully', async () => {
  const dom = installDom();
  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  let calls = 0;
  const page = render(
    <ReportDailyUpdates
      universityId="university-one"
      authFetch={async () => {
        calls += 1;
        return calls === 1 ? { updates: [] } : [];
      }}
    />,
  );

  try {
    const alert = await page.findByRole('alert');
    assert.match(alert.textContent, /expected an array/);
    fireEvent.click(page.getByRole('button', { name: 'Retry daily updates' }));
    await waitFor(() => assert.equal(page.queryByRole('alert'), null));
    assert.ok(page.getByText('No daily updates yet.'));
    assert.equal(calls, 2);
  } finally {
    page.unmount();
    dom.window.close();
  }
});

test('update media normalization accepts legacy strings, JSON arrays, and actual arrays', () => {
  assert.deepEqual(normalizeUpdateMedia('/one.jpg'), ['/one.jpg']);
  assert.deepEqual(normalizeUpdateMedia('["/one.jpg","/clip.mp4?media=video"]'), ['/one.jpg', '/clip.mp4?media=video']);
  assert.deepEqual(normalizeUpdateMedia(['/one.jpg', { url: '/two.jpg' }]), ['/one.jpg', '/two.jpg']);
  assert.equal(formatUpdateDate('2025-03-02'), '02 Mar 2025');
  assert.deepEqual(sortUpdatesNewestFirst([
    { id: 'old', createdAt: '2025-03-01T00:00:00Z' },
    { id: 'new', createdAt: '2025-03-02T00:00:00Z' },
  ]).map(item => item.id), ['new', 'old']);
});

test('loaded empty history is retained through pending, failure and retry states', async () => {
  const dom = installDom();
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react');
  const pending = [];
  let calls = 0;
  const authFetch = () => ++calls === 1 ? Promise.resolve([]) :
    new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const page = render(<ReportDailyUpdates universityId="empty" refreshKey={0} authFetch={authFetch} />);
  try {
    await page.findByText('No daily updates yet.');
    const empty = page.container.querySelector('.report-daily-updates-empty');
    page.rerender(<ReportDailyUpdates universityId="empty" refreshKey={1} authFetch={authFetch} />);
    await waitFor(() => assert.equal(pending.length, 1));
    assert.equal(page.container.querySelector('.report-daily-updates-empty'), empty);
    assert.equal(page.queryByText('Loading daily updates…'), null);
    await act(async () => pending[0].reject(new Error('History unavailable')));
    await page.findByText(/History unavailable/);
    assert.equal(page.container.querySelector('.report-daily-updates-empty'), empty);
    fireEvent.click(page.getByRole('button', { name: 'Retry daily updates' }));
    await waitFor(() => assert.equal(pending.length, 2));
    assert.equal(page.container.querySelector('.report-daily-updates-empty'), empty);
    await act(async () => pending[1].resolve([]));
    assert.equal(page.container.querySelector('.report-daily-updates-empty'), empty);
  } finally {
    page.unmount();
    dom.window.close();
  }
});

test('offscreen media mounts only after its viewport gate and videos request no preload data', async () => {
  const dom = installDom();
  const observers = [];
  window.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(element) {
      this.element = element;
    }
    disconnect() {}
  };
  const { act, render, waitFor } = await import('@testing-library/react');
  const page = render(
    <ReportDailyUpdates
      universityId="university-one"
      authFetch={async () => [{
        id: 'with-media',
        createdAt: '2025-03-02T01:05:00.000Z',
        content: 'Media note',
        imageUrl: ['/photo.jpg', '/clip.mp4?media=video'],
      }]}
    />,
  );

  try {
    await waitFor(() => assert.equal(page.getAllByText('Load preview').length, 2));
    assert.equal(page.container.querySelectorAll('img, video').length, 0);
    assert.ok(page.container.querySelector('a[href="http://localhost/photo.jpg"]'));
    await act(() => observers[0].callback([{ isIntersecting: true }]));
    await act(() => observers[1].callback([{ isIntersecting: true }]));
    const video = page.container.querySelector('video');
    assert.ok(video);
    assert.equal(video.getAttribute('preload'), 'none');
  } finally {
    page.unmount();
    dom.window.close();
  }
});

test('superseded university requests abort and cannot replace active updates', async () => {
  const dom = installDom();
  const { render, waitFor } = await import('@testing-library/react');
  const pending = [];
  const page = render(
    <ReportDailyUpdates
      universityId="first"
      authFetch={(path, options) => new Promise(resolve => pending.push({ path, options, resolve }))}
    />,
  );

  try {
    await waitFor(() => assert.equal(pending.length, 1));
    page.rerender(
      <ReportDailyUpdates
        universityId="second"
        authFetch={(path, options) => new Promise(resolve => pending.push({ path, options, resolve }))}
      />,
    );
    await waitFor(() => assert.equal(pending.length, 2));
    assert.equal(pending[0].options.signal.aborted, true);
    pending[0].resolve([{ id: 'stale', content: 'Stale update', createdAt: '2025-03-02T00:00:00Z' }]);
    pending[1].resolve([{ id: 'fresh', content: 'Fresh update', createdAt: '2025-03-03T00:00:00Z' }]);
    await waitFor(() => assert.ok(page.getByText('Fresh update')));
    assert.equal(page.queryByText('Stale update'), null);
  } finally {
    page.unmount();
    dom.window.close();
  }
});
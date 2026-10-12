import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Two CSS pixels allow subpixel/font rounding, not a new line or shifted row.
const TOLERANCE = 2;
const user = { id: 'layout-reader', name: 'Layout Reader', role: 'admin' };
const universities = [
  { id: 'layout', name: 'Layout University', spaces: [] },
  { id: 'other', name: 'Other University', spaces: [] },
];
const makeReport = () => ({
  reportDate: '2026-10-07', generatedAt: '2026-10-07T01:00:00Z',
  items: Array.from({ length: 26 }, (_, i) => ({
    id: `row-${i}`, area: '5.0 Lab', category: 'Electrical',
    lineItem: `Layout item ${i}`, status: 'In-Progress',
    remark: `Saved note ${i}`, attachments: [],
  })),
  areaSummaries: [{ area: '5.0 Lab' }],
});
const makeHistory = () => Array.from({ length: 8 }, (_, i) => ({
  id: `note-${i}`, content: `Daily note ${i}`,
  createdAt: '2026-10-07T01:00:00Z', authorName: 'Field lead',
}));

async function setup(page, { empty = false, media = false } = {}) {
  const state = { report: makeReport(), history: empty ? [] : makeHistory(), pending: [],
    delayReport: false, delayHistory: false, failHistory: false, failReport: false };
  state.report.items[0].area = 'Model Classroom';
  state.report.items.push({ ...state.report.items[0], id: 'room-peer',
    area: 'All Classrooms', classroomName: 'Room A' });
  if (media) state.history[0].imageUrl = [
    { url: '/api/layout-photo', contentType: 'image/png' },
    { url: '/api/layout-video.mp4', contentType: 'video/mp4' },
  ];
  if (media) state.report.items[0].attachments = [
    { id: 'photo', url: '/api/layout-photo', contentType: 'image/png' },
    { id: 'video', url: '/api/layout-video.mp4', contentType: 'video/mp4' },
  ];
  await page.clock.install();
  await page.addInitScript(({ user }) => {
    localStorage.setItem('niat_token', 'layout-test-not-a-credential');
    localStorage.setItem('niat_user', JSON.stringify(user));
  }, { user });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    let fail = false;
    let delay = false;
    if (path.endsWith('/auth/me')) body = user;
    else if (path === '/api/universities') body = universities;
    else if (path.includes('/daily-report')) {
      body = structuredClone(state.report); delay = state.delayReport; fail = state.failReport;
    } else if (path.endsWith('/updates')) {
      body = structuredClone(state.history); delay = state.delayHistory; fail = state.failHistory;
    } else if (path.includes('/layout-')) return route.fallback();
    if (path.includes('/universities/other/')) {
      if (Array.isArray(body)) body = body.map(note => ({ ...note, content: `Other ${note.content}` }));
      else body.items = body.items.map(item => ({ ...item, lineItem: `Other ${item.lineItem}` }));
    }
    if (delay) await new Promise(resolve => state.pending.push(resolve));
    await route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: 'Temporary layout test outage' } : body });
  });
  await page.goto('/reports?university=layout');
  await expect(page.getByText('Layout item 25', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print / Save PDF', exact: true })).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  return state;
}

const landmarks = [
  '.daily-reports-header', '.daily-report-actions', '.daily-report-filters-panel',
  '.work-report-toolbar', '.daily-report-table', '.report-daily-updates-heading',
  '.report-daily-updates-groups, .report-daily-updates-empty',
];
async function positions(page) {
  return page.evaluate(selectors => selectors.map(selector => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Missing layout landmark ${selector}`);
    const rect = el.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  }), landmarks);
}
function stable(before, after) {
  before.forEach((rect, i) => Object.keys(rect).forEach(key =>
    expect(Math.abs(rect[key] - after[i][key]), `landmark ${i} ${key}`).toBeLessThanOrEqual(TOLERANCE)));
}
async function manual(page) {
  // Avoid Playwright auto-scrolling the header when measuring the reader below.
  await page.getByRole('button', { name: 'Refresh', exact: true }).evaluate(el => el.click());
  await page.clock.runFor(30);
}
async function release(state) {
  state.pending.splice(0).forEach(resolve => resolve());
}

async function setWidth(page, width) {
  if (width === 'wrap') {
    // One pixel above the actual action/title wrapping threshold (fonts loaded).
    width = await page.evaluate(() => {
      const header = document.querySelector('.daily-reports-header');
      const actions = document.querySelector('.daily-report-actions');
      const main = document.querySelector('.daily-reports-header-main');
      return Math.ceil(innerWidth - header.getBoundingClientRect().width +
        actions.getBoundingClientRect().width + parseFloat(getComputedStyle(main).flexBasis) +
        parseFloat(getComputedStyle(header).columnGap)) + 1;
    });
  }
  await page.setViewportSize({ width, height: 800 });
}

for (const width of [1280, 'wrap', 390]) {
  test(`unchanged refresh geometry and reading position at ${width}px`, async ({ page }) => {
    const state = await setup(page);
    await setWidth(page, width);
    const before = await positions(page);
    await page.getByText('Layout item 15', { exact: true }).evaluate(el => el.scrollIntoView({ block: 'center' }));
    const y = await page.evaluate(() => scrollY);
    state.delayReport = state.delayHistory = true;
    await manual(page);
    await expect.poll(() => state.pending.length).toBe(2);
    stable(before, await positions(page));
    expect(await page.evaluate(() => scrollY)).toBe(y);
    await release(state);
    await expect(page.getByRole('button', { name: 'Print / Save PDF', exact: true })).toBeEnabled();
    stable(before, await positions(page));
    expect(await page.evaluate(() => scrollY)).toBe(y);
    // Automatic refresh signals use the real page event handlers and interval.
    for (const signal of ['focus', 'visibility', 'interval']) {
      await page.clock.runFor(10_001);
      if (signal === 'focus') await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      if (signal === 'visibility') await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.clock.runFor(signal === 'interval' ? 30_001 : 30);
      await expect.poll(() => state.pending.length).toBe(2);
      stable(before, await positions(page));
      expect(await page.evaluate(() => scrollY)).toBe(y);
      await release(state);
      await expect(page.getByRole('button', { name: 'Print / Save PDF', exact: true })).toBeEnabled();
      stable(before, await positions(page));
      expect(await page.evaluate(() => scrollY)).toBe(y);
    }
  });

  test(`updated content retains reading anchor and table state at ${width}px`, async ({ page }) => {
    const state = await setup(page);
    await setWidth(page, width);
    await page.getByLabel('Filter report by category').selectOption('Electrical');
    await page.getByLabel('Choose a source for Layout item 0').evaluate(el => { el.closest('details').open = true; });
    const reader = page.getByText('Layout item 15', { exact: true });
    await reader.evaluate(el => {
      el.scrollIntoView({ block: 'center' });
      el.closest('.daily-table-wrap').scrollLeft = 140;
    });
    const tableScroll = await reader.evaluate(el => el.closest('.daily-table-wrap').scrollLeft);
    state.delayReport = state.delayHistory = true;
    state.report.items[0].remark = 'Much longer updated note above the reader.\n'.repeat(20);
    await manual(page);
    await expect.poll(() => state.pending.length).toBe(2);
    // User scrolls while pending; the new position, not request-start, is kept.
    await page.evaluate(() => {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 170 }));
      window.scrollBy(0, 170);
    });
    const top = await reader.evaluate(el => el.closest('tr').getBoundingClientRect().top);
    await release(state);
    await expect(page.getByText(/Much longer updated note/)).toBeVisible();
    expect(Math.abs(await reader.evaluate(el => el.closest('tr').getBoundingClientRect().top) - top)).toBeLessThanOrEqual(TOLERANCE);
    await expect(page.getByLabel('Filter report by category')).toHaveValue('Electrical');
    expect(await reader.evaluate(el => el.closest('.daily-table-wrap').scrollLeft)).toBe(tableScroll);
    await expect(page.locator('.daily-checklist-chooser')).toHaveAttribute('open', '');

    // History commits independently and can insert a new date group above us.
    const note = page.getByText('Daily note 4', { exact: true });
    await note.evaluate(el => el.scrollIntoView({ block: 'center' }));
    const noteTop = await note.evaluate(el => el.getBoundingClientRect().top);
    state.history.unshift({ id: 'new', content: 'Newly posted history', createdAt: '2026-10-08T01:00:00Z' });
    await manual(page);
    await expect.poll(() => state.pending.length).toBe(2);
    await release(state);
    await expect(page.getByText('Newly posted history')).toBeVisible();
    expect(Math.abs(await note.evaluate(el => el.getBoundingClientRect().top) - noteTop)).toBeLessThanOrEqual(TOLERANCE);
  });
}

test('history failure and retry keep history geometry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const state = await setup(page);
  const before = await positions(page);
  state.failHistory = true;
  await manual(page);
  await expect(page.getByRole('alert')).toContainText('Temporary layout test outage');
  await expect(page.getByRole('button', { name: 'Print / Save PDF', exact: true })).toBeDisabled();
  stable(before, await positions(page));
  state.failHistory = false;
  state.delayHistory = true;
  await page.getByRole('button', { name: 'Retry daily updates' }).click();
  stable(before, await positions(page));
  await release(state);
  await expect(page.getByRole('button', { name: 'Print / Save PDF', exact: true })).toBeEnabled();
});

for (const width of [1280, 'wrap', 390]) {
  test(`delayed portrait image and video previews reserve screen space at ${width}px`, async ({ page }) => {
    const waiting = [];
    const video = readFileSync(new URL('./fixtures/portrait.mp4', import.meta.url));
    // Install before setup's API handler; fallback reaches these media routes.
    await page.route('**/api/layout-*', async route => {
      if (route.request().method() === 'HEAD') {
        return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '' });
      }
      await new Promise(resolve => waiting.push(resolve));
      if (route.request().url().includes('video')) {
        await route.fulfill({ contentType: 'video/mp4', body: video });
      } else {
        await route.fulfill({ contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="240"><rect width="60" height="240" fill="blue"/></svg>' });
      }
    });
    await setup(page, { media: true });
    await setWidth(page, width);
    const before = await positions(page);
    const previewRects = () => page.locator('.report-daily-updates-media-preview').evaluateAll(elements =>
      elements.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
    const previewsBefore = await previewRects();
    await page.getByText('Daily note 0', { exact: true }).evaluate(el => el.scrollIntoView());
    await page.clock.runFor(50);
    await expect(page.locator('.report-daily-updates-media-preview img')).toHaveCount(1);
    await page.locator('.report-daily-updates-media-preview video').evaluate(el => el.load());
    await expect.poll(() => waiting.length).toBeGreaterThanOrEqual(2);
    expect(await previewRects()).toEqual(previewsBefore);
    const y = await page.evaluate(() => scrollY);
    waiting.splice(0).forEach(resolve => resolve());
    await expect.poll(() => page.locator('.report-daily-updates-media-preview img')
      .evaluate(el => el.naturalHeight)).toBe(240);
    await expect.poll(() => page.locator('.report-daily-updates-media-preview video')
      .evaluate(el => el.videoHeight)).toBe(128);
    stable(before, await positions(page));
    expect(await previewRects()).toEqual(previewsBefore);
    expect(await page.evaluate(() => scrollY)).toBe(y);
    expect(await page.locator('.report-daily-updates-media-preview img')
      .evaluate(el => getComputedStyle(el).objectFit)).toBe('contain');
    await expect(page.getByRole('link', { name: 'Open original', exact: true })).toHaveCount(2);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.report-daily-updates-media-preview').first()).toBeHidden();
    await expect(page.locator('.report-daily-updates-print-only').first()).toBeVisible();
  });
}

test('missing media retains preview geometry and original links', async ({ page }) => {
  const waiting = [];
  await page.route('**/api/layout-*', async route => {
    if (route.request().method() !== 'HEAD') await new Promise(resolve => waiting.push(resolve));
    await route.fulfill({ status: 404, body: 'Missing evidence' });
  });
  await setup(page, { media: true });
  const before = await positions(page);
  await page.getByText('Daily note 0', { exact: true }).evaluate(el => el.scrollIntoView());
  await page.clock.runFor(50);
  await expect(page.locator('.report-daily-updates-media-preview img')).toHaveCount(1);
  await page.locator('.report-daily-updates-media-preview video').evaluate(el => el.load());
  await expect.poll(() => waiting.length).toBeGreaterThanOrEqual(2);
  waiting.splice(0).forEach(resolve => resolve());
  await expect(page.getByText('Preview unavailable. Use Open original below.')).toHaveCount(2);
  stable(before, await positions(page));
  await expect(page.getByRole('link', { name: 'Open original', exact: true })).toHaveCount(2);
});

test('removed anchors and changing university never trigger stale corrections', async ({ page }) => {
  const state = await setup(page);
  await page.getByText('Daily note 3', { exact: true }).evaluate(el => el.scrollIntoView());
  const surviving = page.getByText('Daily note 4', { exact: true });
  const top = await surviving.evaluate(el => el.closest('article').getBoundingClientRect().top);
  state.history = state.history.filter(note => note.id !== 'note-3');
  await manual(page);
  await expect(page.getByText('Daily note 3', { exact: true })).toHaveCount(0);
  expect(Math.abs(await surviving.evaluate(el => el.closest('article').getBoundingClientRect().top) - top)).toBeLessThanOrEqual(TOLERANCE);
  state.delayReport = state.delayHistory = true;
  await manual(page);
  await expect.poll(() => state.pending.length).toBe(2);
  await page.getByRole('combobox', { name: 'Search universities' }).click();
  await page.getByRole('option', { name: 'Other University', exact: true }).click();
  await expect(page.getByText('Daily note 4', { exact: true })).toHaveCount(0);
  await expect.poll(() => state.pending.length).toBeGreaterThanOrEqual(4);
  // Resolve both generations; only the selected university may commit.
  await release(state);
  await expect(page.getByRole('button', { name: 'Print / Save PDF', exact: true })).toBeEnabled();
  await expect(page.getByText('Other Daily note 4', { exact: true })).toBeVisible();
  await expect(page.getByText('Daily note 4', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Search universities' })).toHaveValue('Other University');
});

test('previously loaded empty history stays empty during refresh and failure', async ({ page }) => {
  const state = await setup(page, { empty: true });
  const before = await positions(page);
  state.delayHistory = true;
  state.failHistory = true;
  await manual(page);
  await expect.poll(() => state.pending.length).toBe(1);
  await expect(page.getByText('No daily updates yet.')).toBeVisible();
  stable(before, await positions(page));
  await release(state);
  await expect(page.getByRole('alert')).toContainText('Temporary layout test outage');
  stable(before, await positions(page));
  state.failHistory = false;
  await page.getByRole('button', { name: 'Retry daily updates' }).click();
  await expect.poll(() => state.pending.length).toBe(1);
  stable(before, await positions(page));
  await release(state);
  await expect(page.getByRole('button', { name: 'Print / Save PDF', exact: true })).toBeEnabled();
  stable(before, await positions(page));
});

test('primary finishes after history and primary failures still gate printing without movement', async ({ page }) => {
  const state = await setup(page);
  const before = await positions(page);
  state.delayReport = true;
  await manual(page);
  await expect.poll(() => state.pending.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Print / Save PDF', exact: true })).toBeDisabled();
  stable(before, await positions(page));
  await release(state);
  await expect(page.getByRole('button', { name: 'Print / Save PDF', exact: true })).toBeEnabled();
  state.failReport = true;
  await manual(page);
  await expect.poll(() => state.pending.length).toBe(1);
  await release(state);
  await expect(page.getByRole('alert')).toContainText('Temporary layout test outage');
  await expect(page.getByRole('button', { name: 'Print / Save PDF', exact: true })).toBeDisabled();
  stable(before, await positions(page));
});

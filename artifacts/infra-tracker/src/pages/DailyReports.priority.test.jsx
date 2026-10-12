import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { MemoryRouter } from 'react-router-dom';
import DailyReports, { priorityFollowUps } from './DailyReports';

const issue = (id, overrides = {}) => ({
  id, area: 'All Classrooms', classroomName: `Room ${id}`,
  category: 'Electrical', lineItem: 'Bench Charging Points',
  status: 'In-Progress', remark: 'Waiting for wiring', timeline: '2026-09-01',
  attachments: [], ...overrides,
});
const model = issue('model', { area: 'Model Classroom', classroomName: 'Model room' });

test('priority grouping combines model and rooms, deduplicates overlap and preserves blocker precedence', () => {
  const room = issue('101');
  const attention = { blockers: [room, room], overdue: [model, room, issue('102')] };
  const before = JSON.stringify(attention);
  const result = priorityFollowUps(attention);
  assert.equal(result.length, 1);
  assert.equal(result[0].areaLabel, 'Model + All Classrooms (2)');
  assert.equal(result[0].isBlocker, true);
  assert.deepEqual(new Set(result[0].sources.map(source => source.id)), new Set(['model', '101', '102']));
  assert.equal(result[0].sources.length, 3);
  assert.equal(result[0].priorityDetails.length, 1);
  assert.deepEqual(result[0].classroomNames, ['Room 101', 'Room 102']);
  assert.equal(JSON.stringify(attention), before, 'source report data is unchanged');
});

test('priority grouping retains differing room notes and timelines, including missing values', () => {
  const result = priorityFollowUps({ overdue: [
    model, issue('101', { remark: 'Cable ordered', timeline: '2026-09-02' }),
    issue('102', { remark: 'Cable ordered', timeline: null }),
    issue('103', { remark: '', timeline: '2026-09-03' }),
  ] });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].priorityDetails.map(detail => [detail.labels, detail.remark, detail.timeline]), [
    [['Model Classroom — Model room'], 'Waiting for wiring', '2026-09-01'],
    [['All Classrooms — Room 101'], 'Cable ordered', '2026-09-02'],
    [['All Classrooms — Room 102'], 'Cable ordered', null],
    [['All Classrooms — Room 103'], '', '2026-09-03'],
  ]);
});

test('unrelated categories, line items, labs and staff rooms stay separate', () => {
  const result = priorityFollowUps({ overdue: [
    model, issue('category', { category: 'Furniture' }),
    issue('line', { lineItem: 'Lighting' }),
    issue('lab', { area: '5.0 Lab' }), issue('staff', { area: 'Staff Room' }),
  ] });
  assert.equal(result.length, 5);
  assert.ok(result.every(item => item.sources.length === 1));
});

test('grouping happens before the five-entry limit and blocker statuses sort first', () => {
  const result = priorityFollowUps({ overdue: [
    model, ...Array.from({ length: 8 }, (_, i) => issue(String(i))),
    ...Array.from({ length: 5 }, (_, i) => issue(`other-${i}`, { lineItem: `Other ${i}` })),
    issue('blocker', { area: 'Staff Room', status: 'Blocker' }),
    issue('done', { status: 'Done' }), issue('na', { status: 'N/A' }),
  ] });
  assert.equal(result.length, 5);
  assert.equal(result[0].id, 'blocker');
  assert.equal(result[0].isBlocker, true);
  assert.equal(result[1].sources.length, 9);
  assert.deepEqual(result.slice(2).map(item => item.lineItem), ['Other 0', 'Other 1', 'Other 2']);
});

test('visible and printed priorities share the grouped count, locations and distinct details', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { render, fireEvent, waitFor } = await import('@testing-library/react');
  const room = issue('101', { remark: 'Room cable ordered', timeline: '2026-09-02' });
  const report = {
    items: [model, room], areaSummaries: [],
    attention: { blockers: [model], overdue: [model, room] },
  };
  let printed;
  dom.window.print = () => {
    printed = document.querySelector('.manager-priority-section').cloneNode(true);
  };
  const page = render(
    <MemoryRouter initialEntries={['/reports?university=one']}>
      <DailyReports universities={[{ id: 'one', name: 'University One' }]}
        authFetch={async path => path.endsWith('/updates') ? [] : report} />
    </MemoryRouter>,
  );
  try {
    await page.findByText('Top 1 exceptions');
    const section = page.container.querySelector('.manager-priority-section');
    assert.equal(section.querySelectorAll('article').length, 1);
    assert.match(section.textContent, /Model \+ All Classrooms \(1\)/);
    assert.match(section.textContent, /Model Classroom — Model room/);
    assert.match(section.textContent, /All Classrooms — Room 101/);
    assert.match(section.textContent, /Room cable ordered/);
    assert.match(section.textContent, /Waiting for wiring/);
    assert.match(section.textContent, /01-Sep-2026/);
    assert.match(section.textContent, /02-Sep-2026/);
    assert.equal(section.querySelector('.manager-priority-type').textContent, 'Blocker');
    const printButton = page.getByRole('button', { name: /Print \/ (?:Save )?PDF/ });
    await waitFor(() => assert.equal(printButton.disabled, false));
    fireEvent.click(printButton);
    await waitFor(() => assert.ok(printed));
    assert.equal(printed.textContent, section.textContent);
    assert.equal(printed.querySelector('.no-print'), null);
  } finally {
    page.unmount();
    dom.window.close();
  }
});
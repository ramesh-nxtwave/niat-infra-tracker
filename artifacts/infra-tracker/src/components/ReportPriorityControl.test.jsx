import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import ReportPriorityControl, { reportUniversityPriority } from './ReportPriorityControl';

test('report university category saves one priority and recognizes legacy values', async () => {
  assert.equal(reportUniversityPriority({ priority: 'P2' }), 'MEDIUM');
  assert.equal(reportUniversityPriority({ priority: 'LOW', isCritical: true }), 'CRITICAL');

  const dom = new JSDOM('<html><body></body></html>', { url: 'https://example.test' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
  const calls = [];
  const messages = [];
  try {
    const view = render(
      <ReportPriorityControl
        role="admin"
        university={{ id: 'u1', name: 'Campus One', priority: 'MEDIUM', isCritical: false }}
        onUpdate={async (...args) => calls.push(args)}
        onMessage={(...args) => messages.push(args)}
      />,
    );
    assert.equal(view.getByRole('radio', { name: 'Medium Priority' }).checked, true);
    fireEvent.click(view.getByRole('radio', { name: 'Low Priority' }));
    await waitFor(() => assert.deepEqual(calls, [['u1', 'LOW']]));
    assert.match(messages.at(-1)[0], /categorized as Low Priority/);
    view.rerender(
      <ReportPriorityControl
        role="viewer"
        university={{ id: 'u1', name: 'Campus One', priority: 'LOW' }}
        onUpdate={async () => {}}
      />,
    );
    assert.equal(view.queryByRole('group'), null);
  } finally {
    cleanup();
    dom.window.close();
  }
});
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import ReportCriticalControl from './ReportCriticalControl';

test('Reports critical control saves, removes, reports failure, and is admin-only', async () => {
  const dom = new JSDOM('<html><body></body></html>', { url: 'https://example.test' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
  const calls = [];
  const removed = [];
  const props = {
    role: 'admin',
    university: { id: 'u1', name: 'Campus One', isCritical: false },
    onUpdate: async (...args) => { calls.push(args); },
    onRemoved: id => removed.push(id),
  };
  try {
    const view = render(<ReportCriticalControl {...props} />);
    fireEvent.click(view.getByRole('button', { name: 'Mark as critical' }));
    await waitFor(() => assert.match(view.getByRole('status').textContent, /marked as critical/));
    assert.deepEqual(calls, [['u1', true]]);
    view.rerender(<ReportCriticalControl {...props} university={{ ...props.university, isCritical: true }} />);
    fireEvent.click(view.getByRole('button', { name: 'Remove critical' }));
    await waitFor(() => assert.match(view.getByRole('status').textContent, /removed/));
    assert.deepEqual(calls[1], ['u1', false]);
    assert.deepEqual(removed, ['u1']);
    view.rerender(<ReportCriticalControl {...props} onUpdate={async () => { throw new Error('Please retry'); }} />);
    fireEvent.click(view.getByRole('button', { name: 'Mark as critical' }));
    await waitFor(() => assert.match(view.getByRole('alert').textContent, /Please retry/));
    view.rerender(<ReportCriticalControl {...props} university={undefined} />);
    assert.equal(view.getByRole('button').disabled, true);
    view.rerender(<ReportCriticalControl {...props} role="viewer" />);
    assert.equal(view.queryByRole('button'), null);
  } finally {
    cleanup();
    dom.window.close();
  }
});

test('Reports critical control exposes its busy action state while saving', async () => {
  const dom = new JSDOM('<html><body></body></html>', { url: 'https://example.test' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
  let resolveUpdate;
  try {
    const view = render(
      <ReportCriticalControl
        role="admin"
        university={{ id: 'u1', name: 'Campus One', isCritical: false }}
        onUpdate={() => new Promise(resolve => { resolveUpdate = resolve; })}
        onRemoved={() => {}}
      />,
    );
    const button = view.getByRole('button', { name: 'Mark as critical' });
    fireEvent.click(button);
    await waitFor(() => {
      assert.equal(view.getByRole('button', { name: 'Saving…' }).disabled, true);
    });
    assert.equal(view.queryByRole('status'), null, 'a pending save should not announce success');
    resolveUpdate();
    await waitFor(() => assert.match(view.getByRole('status').textContent, /marked as critical/));
    assert.equal(view.getByRole('button', { name: 'Mark as critical' }).disabled, false);
  } finally {
    cleanup();
    dom.window.close();
  }
});
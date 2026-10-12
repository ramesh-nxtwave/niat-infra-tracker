import assert from 'node:assert/strict';
import test from 'node:test';
import React, { useRef } from 'react';
import { JSDOM } from 'jsdom';
import useReportRefreshAnchor from './useReportRefreshAnchor';

test('refresh anchor uses surviving visible identities, rejects new scope and user input, and safely handles removal', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 500 });
  Object.defineProperty(window, 'scrollX', { configurable: true, writable: true, value: 20 });
  const scrolls = [];
  window.scrollTo = value => scrolls.push(value);
  let capture;
  let offset = 0;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: Number(this.dataset.top || 0) + offset, bottom: Number(this.dataset.top || 0) + offset + 50 };
  };
  function Harness({ scope = 'same', removed = [] }) {
    const root = useRef(null);
    capture = useReportRefreshAnchor(root, scope);
    return <div ref={root}>
      {['first', 'second'].filter(key => !removed.includes(key)).map((key, i) =>
        <p key={key} data-report-anchor={key} data-top={i * 100 + 10}>{key}</p>)}
    </div>;
  }
  const { render, act } = await import('@testing-library/react');
  const view = render(<Harness />);
  try {
    capture();
    offset = 80;
    view.rerender(<Harness />);
    assert.deepEqual(scrolls.pop(), { left: 20, top: 580, behavior: 'instant' });
    capture();
    view.rerender(<Harness scope="other" />);
    assert.deepEqual(scrolls, []);
    capture();
    await act(() => window.dispatchEvent(new dom.window.Event('wheel')));
    offset = 100;
    view.rerender(<Harness scope="other" />);
    assert.deepEqual(scrolls, [], 'deliberate input after capture cancels correction');
    capture();
    view.rerender(<Harness scope="other" removed={['first', 'second']} />);
    assert.deepEqual(scrolls, [], 'no surviving anchor must not manufacture a position');
  } finally {
    view.unmount();
    dom.window.close();
  }
});

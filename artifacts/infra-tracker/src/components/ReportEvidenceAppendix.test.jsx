import assert from 'node:assert/strict';
import test from 'node:test';
import React, { useRef } from 'react';
import { JSDOM } from 'jsdom';
import ReportEvidenceAppendix, { prepareReportImages } from './ReportEvidenceAppendix';
import useReportPrint from '../hooks/useReportPrint';

test('appendix does not mount offscreen media and videos request no preload data', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
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
  const { act, render } = await import('@testing-library/react');
  const page = render(
    <ReportEvidenceAppendix
      attachments={[
        { id: 'photo', reportItemId: 'one', url: '/photo.jpg', contentType: 'image/jpeg', lineItem: 'Desks' },
        { id: 'video', reportItemId: 'two', url: '/video.mp4', contentType: 'video/mp4', lineItem: 'Wiring' },
      ]}
      onOpen={() => {}}
    />,
  );

  assert.equal(page.container.querySelectorAll('img, video').length, 0);
  assert.equal(page.getAllByText('Load preview').length, 2);
  await act(() => observers[0].callback([{ isIntersecting: true }]));
  assert.equal(page.container.querySelectorAll('img').length, 1);
  assert.equal(page.container.querySelectorAll('video').length, 0);
  await act(() => observers[1].callback([{ isIntersecting: true }]));
  const video = page.container.querySelector('video');
  assert.ok(video);
  assert.equal(video.getAttribute('preload'), 'none');
  assert.equal(page.container.querySelectorAll('img').length, 1, 'there is no hidden print image copy');

  page.unmount();
  dom.window.close();
});

test('print image preparation reports progress and rejects a missing attachment', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const attachments = [
    { url: '/one.jpg', contentType: 'image/jpeg' },
    { url: '/clip.mp4', contentType: 'video/mp4' },
    { url: '/two.jpg', contentType: 'image/jpeg' },
  ];
  const progress = [];
  await prepareReportImages(attachments, value => progress.push(value), async () => {});
  assert.deepEqual(progress[0], { loaded: 0, total: 2 });
  assert.deepEqual(progress.at(-1), { loaded: 2, total: 2 });

  await assert.rejects(
    prepareReportImages(attachments, null, async url => {
      if (url.endsWith('/two.jpg')) throw new Error('Could not load attachment: /two.jpg');
    }),
    /Could not load attachment/,
  );
  dom.window.close();
});

test('report print waits for preparation, cancels on failure, and handles browser beforeprint', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  window.requestAnimationFrame = callback => {
    callback();
    return 1;
  };
  let resolvePreparation;
  let rejectPreparation;
  let mountedForPrint = 0;
  let prints = 0;
  window.print = () => { prints += 1; };
  const readinessRef = { current: true };
  const api = {
    printImageCount: 2,
    mountForPrint: () => { mountedForPrint += 1; },
    prepareForPrint: () => new Promise((resolve, reject) => {
      resolvePreparation = resolve;
      rejectPreparation = reject;
    }),
  };

  function Harness() {
    const appendixRef = useRef(api);
    const { printStatus, printReport } = useReportPrint(appendixRef, readinessRef);
    return (
      <>
        <button type="button" onClick={printReport}>Print report</button>
        <output>{printStatus.state === 'preparing' ? `${printStatus.loaded}/${printStatus.total}` : printStatus.message}</output>
      </>
    );
  }

  const { fireEvent, render, waitFor } = await import('@testing-library/react');
  const page = render(<Harness />);
  fireEvent.click(page.getByRole('button', { name: 'Print report' }));
  await waitFor(() => assert.equal(page.getByText('0/2').textContent, '0/2'));
  assert.equal(prints, 0);
  resolvePreparation();
  await waitFor(() => assert.equal(prints, 1));

  fireEvent.click(page.getByRole('button', { name: 'Print report' }));
  await waitFor(() => assert.equal(page.getByText('0/2').textContent, '0/2'));
  rejectPreparation(new Error('Could not load attachment: broken.jpg'));
  await waitFor(() => assert.match(page.container.querySelector('output').textContent, /Print was cancelled/));
  assert.equal(prints, 1);

  fireEvent.click(page.getByRole('button', { name: 'Print report' }));
  await waitFor(() => assert.equal(page.getByText('0/2').textContent, '0/2'));
  readinessRef.current = false;
  resolvePreparation();
  await waitFor(() => assert.match(page.container.querySelector('output').textContent, /Daily Updates changed/));
  assert.equal(prints, 1, 'history becoming unready during image preparation cancels print');
  fireEvent.click(page.getByRole('button', { name: 'Print report' }));
  await waitFor(() => assert.match(page.container.querySelector('output').textContent, /Daily Updates is not ready/));
  assert.equal(prints, 1);

  window.dispatchEvent(new window.Event('beforeprint'));
  assert.equal(mountedForPrint, 1);
  page.unmount();
  dom.window.close();
});
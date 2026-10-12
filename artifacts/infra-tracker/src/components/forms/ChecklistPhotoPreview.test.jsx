import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import ChecklistPhotoPreview from './ChecklistPhotoPreview';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://infra.example.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
});
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');

afterEach(cleanup);

test('a failed photo load reports the failure and retries the same saved reference', () => {
  let opens = 0;
  const path = '/objects/uploads/550e8400-e29b-41d4-a716-446655440000';
  render(<ChecklistPhotoPreview path={path} contentType="image/jpeg" onOpen={() => { opens += 1; }} />);
  fireEvent.error(screen.getByRole('img', { name: 'Evidence' }));
  assert.match(screen.getByRole('alert').textContent, /could not be loaded/);
  assert.equal(screen.queryByRole('img', { name: 'Evidence' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Retry photo' }));
  const image = screen.getByRole('img', { name: 'Evidence' });
  assert.match(image.src, /photoRetry=1$/);
  assert.match(image.src, /550e8400-e29b-41d4-a716-446655440000/);
  fireEvent.load(image);
  fireEvent.click(screen.getByRole('button', { name: 'Open photo' }));
  assert.equal(opens, 1);
});

test('a new photo does not inherit the failed state of the previous path', () => {
  const first = '/objects/first.jpg';
  const second = '/objects/second.jpg';
  const view = render(<ChecklistPhotoPreview key={first} path={first} onOpen={() => {}} />);
  fireEvent.error(screen.getByRole('img', { name: 'Evidence' }));
  view.rerender(<ChecklistPhotoPreview key={second} path={second} onOpen={() => {}} />);
  assert.equal(screen.queryByRole('alert'), null);
  assert.match(screen.getByRole('img', { name: 'Evidence' }).src, /second\.jpg$/);
});
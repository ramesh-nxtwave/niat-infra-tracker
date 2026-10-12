import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { AuthProvider } from '../../context/AuthContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import { DataProvider } from '../../context/DataContext';
import { ToastProvider } from '../../context/ToastContext';
import Lab5Form from './Lab5Form';
import ModelClassroomForm from './ModelClassroomForm';
import StaffRoomForm from './StaffRoomForm';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://infra.example.test',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});

const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react');

afterEach(cleanup);

function Providers({ children }) {
  return (
    <AuthProvider>
      <DataProvider>
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </DataProvider>
    </AuthProvider>
  );
}

function freezeDeep(value) {
  Object.freeze(value);
  Object.values(value).forEach(child => {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeDeep(child);
  });
  return value;
}

const forms = [
  ['model classroom', ModelClassroomForm],
  ['lab', Lab5Form],
  ['staff room', StaffRoomForm],
];

for (const [label, Form] of forms) {
  test(`${label} reveals and focuses its exact target once without resetting drafts`, async () => {
    const target = freezeDeep({
      itemId: 'target-item',
      classroomId: null,
      navigationKey: `${label}-navigation`,
    });
    const data = {
      remarks: '',
      items: [
        { id: 'other-item', name: 'Other item', category: 'First category', status: 'Yet to start', sortOrder: 1 },
        { id: 'target-item', name: 'Target item', category: 'Target category', status: 'In-Progress', sortOrder: 2 },
      ],
    };
    const revealed = [];
    const scrolls = [];
    window.matchMedia = () => ({ matches: true });
    HTMLElement.prototype.scrollIntoView = function (options) { scrolls.push({ row: this, options }); };
    const props = {
      data,
      universityId: 'university-1',
      onSave: () => undefined,
      target,
      onTargetRevealed: key => revealed.push(key),
    };
    const view = render(<Providers><Form {...props} /></Providers>);

    const row = await view.findByLabelText('Target checklist item: Target item');
    await waitFor(() => assert.equal(document.activeElement, row));
    assert.deepEqual(revealed, [target.navigationKey]);
    assert.equal(scrolls.length, 1);
    assert.equal(scrolls[0].row, row);
    assert.deepEqual(scrolls[0].options, { behavior: 'auto', block: 'start' });
    assert.equal(view.getByRole('button', { name: /Target category/ }).getAttribute('aria-expanded'), 'true');
    assert.equal(view.getByRole('button', { name: /First category/ }).getAttribute('aria-expanded'), 'false');

    const remarks = view.container.querySelector('textarea[name="remarks"]');
    fireEvent.change(remarks, { target: { value: 'unsaved local draft' } });
    fireEvent.click(view.getByRole('button', { name: /Target category/ }));
    remarks.focus();
    view.rerender(
      <Providers>
        <Form
          {...props}
          data={{ ...data, remarks: 'background server value', items: data.items.map(item => ({ ...item })) }}
        />
      </Providers>,
    );

    assert.equal(remarks.value, 'unsaved local draft');
    assert.equal(scrolls.length, 1);
    assert.deepEqual(revealed, [target.navigationKey]);
    assert.equal(document.activeElement, remarks);
    assert.equal(view.getByRole('button', { name: /Target category/ }).getAttribute('aria-expanded'), 'false');
    assert.deepEqual(target, {
      itemId: 'target-item',
      classroomId: null,
      navigationKey: `${label}-navigation`,
    });
  });

  test(`${label} honors an already revealed target without refocusing`, () => {
    const target = freezeDeep({
      itemId: 'target-item',
      classroomId: null,
      navigationKey: `${label}-revealed`,
      revealed: true,
    });
    const revealed = [];
    const view = render(
      <Providers>
        <Form
          data={{ items: [{ id: 'target-item', name: 'Target item', category: 'Closed category', status: 'Done' }] }}
          universityId="university-1"
          onSave={() => undefined}
          target={target}
          onTargetRevealed={key => revealed.push(key)}
        />
      </Providers>,
    );

    assert.equal(view.getByRole('button', { name: /Closed category/ }).getAttribute('aria-expanded'), 'true');
    assert.ok(view.getByLabelText('Target checklist item: Target item').classList.contains('checklist-item-target'));
    assert.deepEqual(revealed, []);
    assert.notEqual(document.activeElement?.getAttribute('aria-label'), 'Target checklist item: Target item');
  });
}
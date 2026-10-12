import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { DataProvider } from '../context/DataContext';
import { ToastProvider } from '../context/ToastContext';
import { ConfirmProvider } from '../context/ConfirmContext';
import UniversityList from './UniversityList';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://infra.example.test/universities',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});

const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function response(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function renderList() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <DataProvider>
          <ToastProvider>
            <ConfirmProvider>
              <UniversityList />
            </ConfirmProvider>
          </ToastProvider>
        </DataProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

test('critical filter combines with search and marking is persisted through the dedicated endpoint', async () => {
  localStorage.setItem('niat_user', JSON.stringify({
    id: 'admin-1',
    email: 'admin@example.test',
    role: 'admin',
  }));
  const universities = [
    { id: 'critical-1', name: 'Critical Campus', location: 'North', isCritical: true },
    { id: 'normal-1', name: 'Normal Campus', location: 'South', isCritical: false },
  ];
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push([url, options]);
    if (url === '/api/universities') return response(universities);
    if (url === '/api/users?limit=500') return response({ data: [] });
    if (url === '/api/universities/normal-1/critical' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      universities[1] = { ...universities[1], isCritical: body.isCritical };
      return response(universities[1]);
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  const view = renderList();
  await waitFor(() => assert.ok(view.getByText('Critical Campus')));
  assert.ok(view.getByRole('button', { name: 'Mark Normal Campus as critical' }));

  fireEvent.click(view.getByRole('checkbox', { name: 'Critical universities only' }));
  assert.ok(view.getByText('Critical Campus'));
  assert.equal(view.queryByText('Normal Campus'), null);

  fireEvent.change(view.getByPlaceholderText('Search universities...'), {
    target: { value: 'normal' },
  });
  assert.equal(view.queryByText('Critical Campus'), null);
  assert.match(view.getByText(/No universities found/).textContent, /No universities found/);

  fireEvent.change(view.getByPlaceholderText('Search universities...'), {
    target: { value: '' },
  });
  fireEvent.click(view.getByRole('checkbox', { name: 'Critical universities only' }));
  fireEvent.click(view.getByRole('button', { name: 'Mark Normal Campus as critical' }));

  await waitFor(() => assert.ok(view.getByText('Remove critical')));
  assert.deepEqual(
    requests
      .filter(([url]) => url === '/api/universities/normal-1/critical')
      .map(([, options]) => JSON.parse(options.body)),
    [{ isCritical: true }],
  );
  assert.equal(view.getAllByText('Critical').length, 2);
});
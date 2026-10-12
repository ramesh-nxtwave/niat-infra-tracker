import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import { CORE_NAV_ITEMS, PORTAL_ROLES } from './coreAccess.js';

const [role, route, scenario] = process.argv.slice(2);
const isAnonymous = role === 'anonymous';
const isLoginNavigationScenario = scenario === 'login-navigation';
const isExpiredSession = role === 'expired_session';
assert.ok(isAnonymous || isExpiredSession || PORTAL_ROLES.includes(role), `Unsupported test role: ${role}`);
assert.ok(route?.startsWith('/'), `Invalid test route: ${route}`);
assert.ok(!isLoginNavigationScenario || isAnonymous, 'Login navigation checks must start signed out');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

dom.window.matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { act, cleanup, fireEvent, render, waitFor, within } = await import('@testing-library/react');
const { default: App } = await import('../App.jsx');

const signedInUser = isAnonymous ? null : {
  id: `${role}-test-user`,
  name: `${role} test user`,
  role,
  zoneIds: role === 'zonal_manager' ? [1] : [],
};

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

let rejectExpiredSession;
const expiredSessionResponse = new Promise(resolve => {
  rejectExpiredSession = () => resolve({
    ok: false,
    status: 401,
    json: async () => ({ error: 'Session rejected' }),
  });
});

globalThis.fetch = async input => {
  const url = String(input);
  if (url.endsWith('/api/auth/me')) {
    if (isExpiredSession) return expiredSessionResponse;
    return jsonResponse(signedInUser);
  }
  if (url.endsWith('/api/auth/login')) {
    return jsonResponse({
      token: 'successful-login-token',
      user: {
        id: 'login-navigation-test-user',
        name: 'Login navigation test user',
        role: 'admin',
        zoneIds: [],
      },
    });
  }
  if (url.includes('/api/users')) return jsonResponse({ data: [], total: 0, page: 1, pages: 0 });
  return jsonResponse([]);
};

if (!isAnonymous) {
  localStorage.setItem('niat_token', 'test-token');
  localStorage.setItem('niat_user', JSON.stringify(signedInUser));
}
window.history.replaceState({}, '', route);

const routeMarkers = {
  '/universities': 'Manage and update tracking data for all locations.',
  '/overview': 'Executive Overview',
  '/master-tracker': 'Master Tracker',
  '/reports': 'Work Status Report',
  '/assistant': 'Command Center AI',
  '/evidence': 'Portfolio Evidence Board',
  '/access-management': 'Access Management',
};

const result = render(<App />, { container: document.getElementById('root') });

if (isExpiredSession) {
  assert.ok(result.getByText('Initializing Command Center...'));
  assert.equal(result.container.querySelector('nav'), null);
  assert.equal(result.queryByText(routeMarkers[route]), null);
  rejectExpiredSession();
}

await act(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
});
assert.equal(result.queryByText('Initializing Command Center...'), null);

if (isLoginNavigationScenario) {
  const requestedUrl = new URL(route, 'http://localhost');
  if (requestedUrl.pathname === '/login') {
    assert.equal(window.location.pathname, '/login');
    assert.equal(window.history.state?.usr?.from, undefined);
  } else {
    await waitFor(() => assert.equal(window.location.pathname, '/login'));
    assert.deepEqual(
      {
        pathname: window.history.state?.usr?.from?.pathname,
        search: window.history.state?.usr?.from?.search,
        hash: window.history.state?.usr?.from?.hash,
      },
      {
        pathname: requestedUrl.pathname,
        search: requestedUrl.search,
        hash: requestedUrl.hash,
      },
    );
  }

  fireEvent.change(result.getByLabelText('Email Address'), {
    target: { value: 'admin@example.com' },
  });
  fireEvent.change(result.getByLabelText('Password'), {
    target: { value: 'valid-password' },
  });
  fireEvent.click(result.getByRole('button', { name: 'Secure Login' }));

  const expectedUrl = requestedUrl.pathname === '/login'
    ? new URL('/universities', 'http://localhost')
    : requestedUrl;
  await waitFor(() => {
    assert.equal(window.location.pathname, expectedUrl.pathname);
    assert.equal(window.location.search, expectedUrl.search);
    assert.equal(window.location.hash, expectedUrl.hash);
  });

  cleanup();
  dom.window.close();
  console.log(`Login navigation passed: ${route} -> ${expectedUrl.pathname}${expectedUrl.search}${expectedUrl.hash}`);
  process.exit(0);
}

if (isAnonymous || isExpiredSession) {
  await waitFor(() => assert.equal(window.location.pathname, '/login'));
  assert.ok(result.getByRole('button', { name: 'Secure Login' }));
  assert.equal(result.container.querySelector('nav'), null);
  assert.equal(result.queryByText(routeMarkers[route]), null);
  assert.equal(window.history.state?.usr?.from?.pathname, route);
  if (isExpiredSession) {
    assert.equal(localStorage.getItem('niat_token'), null);
    assert.equal(localStorage.getItem('niat_user'), null);
  }

  cleanup();
  dom.window.close();
  console.log(`Portal access passed: ${role} redirected from ${route}`);
  process.exit(0);
}

const privilegedAccess = {
  admin: ['/evidence', '/access-management'],
  zonal_manager: ['/evidence'],
  apm: [],
  ops: [],
};

if (route === '/universities') {
  const nav = result.container.querySelector('nav');
  for (const item of CORE_NAV_ITEMS) {
    const link = within(nav).getByRole('link', { name: item.label });
    assert.equal(link.getAttribute('href'), item.to);
  }
  assert.equal(
    within(nav).queryByRole('link', { name: 'Evidence Board' }) !== null,
    privilegedAccess[role].includes('/evidence'),
  );
  assert.equal(
    within(nav).queryByRole('link', { name: 'Access Control' }) !== null,
    privilegedAccess[role].includes('/access-management'),
  );
}

const coreRouteMarkers = {
  '/universities': routeMarkers['/universities'],
  '/overview': routeMarkers['/overview'],
  '/master-tracker': routeMarkers['/master-tracker'],
  '/reports': routeMarkers['/reports'],
  '/assistant': routeMarkers['/assistant'],
};

if (coreRouteMarkers[route]) {
  await waitFor(() => assert.ok(result.queryAllByText(coreRouteMarkers[route]).length > 0));
  assert.equal(window.location.pathname, route);
} else {
  const privilegedRouteMarkers = routeMarkers;
  const allowed = privilegedAccess[role].includes(route);

  if (allowed) {
    await waitFor(() => assert.ok(result.getByText(privilegedRouteMarkers[route])));
    assert.equal(window.location.pathname, route);
  } else {
    await waitFor(() => assert.equal(window.location.pathname, '/universities'));
    assert.equal(result.queryByText(privilegedRouteMarkers[route]), null);
  }
}

cleanup();
dom.window.close();
console.log(`Portal access passed: ${role} at ${route}`);
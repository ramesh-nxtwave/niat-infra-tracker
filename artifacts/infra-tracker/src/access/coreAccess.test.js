import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CORE_NAV_ITEMS,
  PORTAL_ROLES,
  canAccessCoreRoute,
  privilegedNavItemsForRole,
} from './coreAccess.js';

const expectedCoreRoutes = ['/universities', '/overview', '/master-tracker', '/reports', '/assistant'];

for (const role of PORTAL_ROLES) {
  test(`${role} sees every core navigation destination`, () => {
    assert.deepEqual(CORE_NAV_ITEMS.map(item => item.to), expectedCoreRoutes);
  });

  test(`${role} can open every core route directly`, () => {
    for (const route of expectedCoreRoutes) {
      assert.equal(canAccessCoreRoute(role), true, `${role} should be allowed to open ${route}`);
    }
  });
}

test('Evidence Board remains restricted to admin and zonal manager', () => {
  assert.deepEqual(
    PORTAL_ROLES.filter(role =>
      privilegedNavItemsForRole(role).some(item => item.to === '/evidence'),
    ),
    ['admin', 'zonal_manager'],
  );
});

test('Access Control remains restricted to admin', () => {
  assert.deepEqual(
    PORTAL_ROLES.filter(role =>
      privilegedNavItemsForRole(role).some(item => item.to === '/access-management'),
    ),
    ['admin'],
  );
});

test('unknown roles are not granted core route access', () => {
  assert.equal(canAccessCoreRoute('unknown'), false);
});
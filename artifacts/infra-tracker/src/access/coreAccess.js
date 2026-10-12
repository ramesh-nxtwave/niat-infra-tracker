export const PORTAL_ROLES = ['admin', 'zonal_manager', 'apm', 'ops'];

export const CORE_NAV_ITEMS = [
  { to: '/universities', label: 'Universities' },
  { to: '/overview', label: 'Overview' },
  { to: '/master-tracker', label: 'Master Tracker' },
  { to: '/reports', label: 'Reports' },
  { to: '/assistant', label: 'AI Assistant' },
];

export const PRIVILEGED_NAV_ITEMS = [
  { to: '/evidence', label: 'Evidence Board', roles: ['admin', 'zonal_manager'] },
  { to: '/access-management', label: 'Access Control', roles: ['admin'] },
];

export const canAccessCoreRoute = (role) => PORTAL_ROLES.includes(role);

export const privilegedNavItemsForRole = (role) =>
  PRIVILEGED_NAV_ITEMS.filter(item => item.roles.includes(role));
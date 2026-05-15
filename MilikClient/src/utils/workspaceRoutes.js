export const WORKSPACE_IDS = {
  PROPERTY: 'property-management',
  CARWASH: 'carwash',
  PROPERTY_SALE: 'property-sale',
  SYSTEM_ADMIN: 'system-admin',
  COMPANY_SETUP: 'company-setup',
};

export const WORKSPACE_CONFIG = {
  [WORKSPACE_IDS.PROPERTY]: {
    id: WORKSPACE_IDS.PROPERTY,
    label: 'Property Management',
    defaultRoute: '/dashboard',
    defaultTab: {
      id: 'dashboard',
      title: 'Dashboard',
      route: '/dashboard',
      closable: false,
    },
  },
  [WORKSPACE_IDS.CARWASH]: {
    id: WORKSPACE_IDS.CARWASH,
    label: 'MILIK Car Wash',
    defaultRoute: '/carwash/dashboard',
    defaultTab: {
      id: 'carwash-dashboard',
      title: 'Dashboard',
      route: '/carwash/dashboard',
      closable: false,
    },
  },
  [WORKSPACE_IDS.PROPERTY_SALE]: {
    id: WORKSPACE_IDS.PROPERTY_SALE,
    label: 'Property Sales',
    defaultRoute: '/sale/dashboard',
    defaultTab: {
      id: 'sale-dashboard',
      title: 'Dashboard',
      route: '/sale/dashboard',
      closable: false,
    },
  },
  [WORKSPACE_IDS.SYSTEM_ADMIN]: {
    id: WORKSPACE_IDS.SYSTEM_ADMIN,
    label: 'System Admin',
    defaultRoute: '/system-setup/overview',
    defaultTab: {
      id: 'system-admin-home',
      title: 'Overview',
      route: '/system-setup/overview',
      closable: false,
    },
  },
  [WORKSPACE_IDS.COMPANY_SETUP]: {
    id: WORKSPACE_IDS.COMPANY_SETUP,
    label: 'Company Setup',
    defaultRoute: '/company-setup',
    defaultTab: {
      id: 'company-setup-home',
      title: 'Company Setup',
      route: '/company-setup',
      closable: false,
    },
  },
};

const SYSTEM_ADMIN_ROUTE_MATCHERS = [
  (pathname = '') => pathname === '/system-setup' || pathname.startsWith('/system-setup/'),
  (pathname = '') => pathname === '/add-company' || pathname.startsWith('/add-company/'),
  (pathname = '') => pathname === '/add-user' || pathname.startsWith('/add-user/'),
];

export const getWorkspaceFromRoute = (pathname = '') => {
  if (pathname === '/carwash' || pathname.startsWith('/carwash/')) {
    return WORKSPACE_IDS.CARWASH;
  }

  if (pathname === '/sale' || pathname.startsWith('/sale/')) {
    return WORKSPACE_IDS.PROPERTY_SALE;
  }

  if (SYSTEM_ADMIN_ROUTE_MATCHERS.some((matches) => matches(pathname))) {
    return WORKSPACE_IDS.SYSTEM_ADMIN;
  }

  if (
    pathname === '/company-setup' ||
    pathname.startsWith('/company-setup/') ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/')
  ) {
    return WORKSPACE_IDS.COMPANY_SETUP;
  }

  return WORKSPACE_IDS.PROPERTY;
};

export const isRouteInWorkspace = (route = '', workspaceId) =>
  getWorkspaceFromRoute(route) === workspaceId;

export const getWorkspaceConfig = (workspaceId) =>
  WORKSPACE_CONFIG[workspaceId] || WORKSPACE_CONFIG[WORKSPACE_IDS.PROPERTY];

export const getWorkspaceDefaultRoute = (workspaceId) =>
  getWorkspaceConfig(workspaceId).defaultRoute;

export const getWorkspaceDefaultTab = (workspaceId) => ({
  ...getWorkspaceConfig(workspaceId).defaultTab,
  timestamp: Date.now(),
});

export const getWorkspaceLabel = (workspaceId) =>
  getWorkspaceConfig(workspaceId).label;

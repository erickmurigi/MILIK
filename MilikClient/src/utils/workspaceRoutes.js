export const WORKSPACE_IDS = {
  PROPERTY:       'property-management',
  ACCOUNTS:       'financial-accounts',
  CARWASH:        'carwash',
  INVENTORY:      'inventory',
  PROPERTY_SALE:  'property-sale',
  HUMAN_RESOURCE: 'human-resource',
  SYSTEM_ADMIN:   'system-admin',
  COMPANY_SETUP:  'company-setup',
  COMMUNICATIONS: 'communications',
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
  [WORKSPACE_IDS.ACCOUNTS]: {
    id: WORKSPACE_IDS.ACCOUNTS,
    label: 'Financial Accounts',
    defaultRoute: '/accounts/dashboard',
    defaultTab: {
      id: 'acc-dashboard',
      title: 'Dashboard',
      route: '/accounts/dashboard',
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
  [WORKSPACE_IDS.INVENTORY]: {
    id: WORKSPACE_IDS.INVENTORY,
    label: 'Inventory & POS',
    defaultRoute: '/inventory/dashboard',
    defaultTab: {
      id: 'inventory-dashboard',
      title: 'Dashboard',
      route: '/inventory/dashboard',
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
  [WORKSPACE_IDS.HUMAN_RESOURCE]: {
    id: WORKSPACE_IDS.HUMAN_RESOURCE,
    label: 'Human Resource',
    defaultRoute: '/hr/dashboard',
    defaultTab: {
      id: 'hr-dashboard',
      title: 'Dashboard',
      route: '/hr/dashboard',
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
  [WORKSPACE_IDS.COMMUNICATIONS]: {
    id: WORKSPACE_IDS.COMMUNICATIONS,
    label: 'Communications',
    defaultRoute: '/communications/sms',
    defaultTab: {
      id: 'communications-home',
      title: 'SMS Manager',
      route: '/communications/sms',
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
  if (pathname === '/moduleDashboard' || pathname.startsWith('/moduleDashboard/')) {
    return null;
  }

  if (pathname === '/accounts' || pathname.startsWith('/accounts/')) {
    return WORKSPACE_IDS.ACCOUNTS;
  }

  // Accounting-owned /financial/* routes — map to Accounts workspace regardless of
  // whether the company also has PMS. PMS-specific sub-paths (landlord-statement) are
  // excluded and fall through to the PROPERTY default below.
  const ACCOUNTS_FINANCIAL_PREFIXES = [
    '/financial/chart-of-accounts',
    '/financial/journals',
    '/financial/payment-vouchers',
    '/financial/service-providers',
    '/financial/ledger-entries',
    '/financial/petty-cash',
    '/financial/expenses',
  ];
  if (ACCOUNTS_FINANCIAL_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return WORKSPACE_IDS.ACCOUNTS;
  }

  if (pathname === '/carwash' || pathname.startsWith('/carwash/')) {
    return WORKSPACE_IDS.CARWASH;
  }

  if (pathname === '/inventory' || pathname.startsWith('/inventory/') ||
      pathname === '/pos' || pathname.startsWith('/pos/')) {
    return WORKSPACE_IDS.INVENTORY;
  }

  if (pathname === '/sale' || pathname.startsWith('/sale/')) {
    return WORKSPACE_IDS.PROPERTY_SALE;
  }

  if (pathname === '/hr' || pathname.startsWith('/hr/')) {
    return WORKSPACE_IDS.HUMAN_RESOURCE;
  }

  if (pathname === '/communications' || pathname.startsWith('/communications/')) {
    return WORKSPACE_IDS.COMMUNICATIONS;
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

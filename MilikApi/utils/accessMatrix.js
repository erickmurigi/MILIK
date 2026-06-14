const DEFINITIONS = [
  // ─── Workspace & Setup ──────────────────────────────────────────────────────
  { resource: 'dashboard',        moduleKey: null,                  actions: ['view'] },
  { resource: 'companies',        moduleKey: null,                  actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'companySettings',  moduleKey: null,                  actions: ['view', 'update'] },
  { resource: 'users',            moduleKey: null,                  actions: ['view', 'create', 'update', 'delete', 'lock'] },

  // ─── Properties, Units & Tenants ─────────────────────────────────────────
  { resource: 'properties',       moduleKey: 'propertyManagement',  actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'units',            moduleKey: 'propertyManagement',  actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'tenants',          moduleKey: 'propertyManagement',  actions: ['view', 'create', 'update', 'terminate', 'delete'] },

  // ─── Leases & Agreements ─────────────────────────────────────────────────
  { resource: 'leases',           moduleKey: 'propertyManagement',  actions: ['view', 'create', 'update', 'terminate'] },
  { resource: 'deposits',         moduleKey: 'propertyManagement',  actions: ['view', 'create', 'refund'] },
  { resource: 'takeOnBalances',   moduleKey: 'propertyManagement',  actions: ['view', 'create'] },

  // ─── Invoicing, Receipting & Statements ──────────────────────────────────
  { resource: 'tenantInvoices',   moduleKey: 'propertyManagement',  actions: ['view', 'create', 'update', 'reverse', 'delete', 'export'] },
  { resource: 'receipts',         moduleKey: 'propertyManagement',  actions: ['view', 'create', 'import', 'reverse', 'delete', 'export'] },
  { resource: 'prepayments',      moduleKey: 'propertyManagement',  actions: ['view', 'create'] },
  { resource: 'statements',       moduleKey: 'propertyManagement',  actions: ['view', 'create', 'approve', 'update', 'send', 'reverse', 'delete', 'export'] },
  { resource: 'processedStatements', moduleKey: 'accounts',         actions: ['view', 'reverse', 'send', 'export'] },

  // ─── Accounting & General Ledger ─────────────────────────────────────────
  { resource: 'chartOfAccounts',     moduleKey: 'accounts',         actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'journals',            moduleKey: 'accounts',         actions: ['view', 'process', 'reverse'] },
  { resource: 'bankReconciliation',  moduleKey: 'accounts',         actions: ['view', 'process'] },
  { resource: 'paymentVouchers',     moduleKey: 'accounts',         actions: ['view', 'process', 'approve', 'reverse'] },
  { resource: 'expenses',            moduleKey: 'accounts',         actions: ['view', 'create', 'approve', 'update', 'delete'] },
  { resource: 'pettyCash',           moduleKey: 'accounts',         actions: ['view', 'create', 'approve'] },
  { resource: 'budgets',             moduleKey: 'accounts',         actions: ['view', 'create', 'approve'] },
  { resource: 'fixedAssets',         moduleKey: 'accounts',         actions: ['view', 'create', 'depreciate'] },
  { resource: 'creditorLedger',      moduleKey: 'accounts',         actions: ['view'] },
  { resource: 'financialReports',    moduleKey: 'accounts',         actions: ['view', 'export'] },
  { resource: 'landlordAdvancements',moduleKey: 'accounts',         actions: ['view', 'create'] },
  { resource: 'standingOrders',      moduleKey: 'accounts',         actions: ['view', 'create'] },
  { resource: 'landlordReceipts',    moduleKey: 'accounts',         actions: ['view', 'create', 'reverse'] },
  { resource: 'landlordPayments',    moduleKey: 'accounts',         actions: ['view', 'process', 'export'] },

  // ─── PM Reports ──────────────────────────────────────────────────────────
  { resource: 'pmReports',           moduleKey: 'propertyManagement', actions: ['view', 'export'] },
  { resource: 'agedAnalysis',        moduleKey: 'propertyManagement', actions: ['view', 'export'] },
  { resource: 'commissionReports',   moduleKey: 'propertyManagement', actions: ['view', 'export'] },
  { resource: 'taxReports',          moduleKey: 'propertyManagement', actions: ['view', 'export'] },

  // ─── Operations Tools ────────────────────────────────────────────────────
  { resource: 'landlords',        moduleKey: 'propertyManagement',  actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'commissions',      moduleKey: 'propertyManagement',  actions: ['view', 'create', 'process'] },
  { resource: 'maintenances',     moduleKey: 'propertyManagement',  actions: ['view', 'create', 'update', 'close', 'delete'] },
  { resource: 'inspections',      moduleKey: 'propertyManagement',  actions: ['view', 'create', 'update', 'close', 'delete'] },
  { resource: 'meterReadings',    moduleKey: 'propertyManagement',  actions: ['view', 'create'] },
  { resource: 'latePenalties',    moduleKey: 'propertyManagement',  actions: ['view', 'process'] },
  { resource: 'propertyExpenses', moduleKey: 'propertyManagement',  actions: ['view', 'create', 'update', 'delete'] },

  // ─── Property Sales ───────────────────────────────────────────────────────
  { resource: 'saleListings',     moduleKey: 'propertySale',        actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'saleBuyers',       moduleKey: 'propertySale',        actions: ['view', 'create', 'update'] },
  { resource: 'saleAgents',       moduleKey: 'propertySale',        actions: ['view', 'manage'] },
  { resource: 'saleOffers',       moduleKey: 'propertySale',        actions: ['view', 'create', 'approve'] },
  { resource: 'saleDeals',        moduleKey: 'propertySale',        actions: ['view', 'create', 'close'] },
  { resource: 'salePayments',     moduleKey: 'propertySale',        actions: ['view', 'record'] },
  { resource: 'saleCommissions',  moduleKey: 'propertySale',        actions: ['view', 'pay'] },
  { resource: 'saleReports',      moduleKey: 'propertySale',        actions: ['view', 'export'] },

  // ─── Human Resource ───────────────────────────────────────────────────────
  { resource: 'hrEmployees',      moduleKey: 'hr',                  actions: ['view', 'create', 'update', 'terminate'] },
  { resource: 'hrLeave',          moduleKey: 'hr',                  actions: ['view', 'create', 'approve', 'manage'] },
  { resource: 'hrPayroll',        moduleKey: 'hr',                  actions: ['view', 'run', 'approve', 'reverse'] },
  { resource: 'hrStatutory',      moduleKey: 'hr',                  actions: ['view', 'process'] },
  { resource: 'hrAppraisals',     moduleKey: 'hr',                  actions: ['view', 'create', 'complete'] },
  { resource: 'hrReports',        moduleKey: 'hr',                  actions: ['view', 'export'] },
  { resource: 'hrSetup',          moduleKey: 'hr',                  actions: ['view', 'manage'] },

  // ─── MILIK Car Wash ───────────────────────────────────────────────────────
  { resource: 'carwash-dashboard',   moduleKey: 'carwash',          actions: ['view'] },
  { resource: 'carwash-jobs',        moduleKey: 'carwash',          actions: ['view', 'create', 'update'] },
  { resource: 'carwash-payments',    moduleKey: 'carwash',          actions: ['view', 'record'] },
  { resource: 'carwash-deposits',    moduleKey: 'carwash',          actions: ['view', 'create', 'update'] },
  { resource: 'carwash-expenses',    moduleKey: 'carwash',          actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'carwash-services',    moduleKey: 'carwash',          actions: ['view', 'manage'] },
  { resource: 'carwash-staff',       moduleKey: 'carwash',          actions: ['view', 'manage'] },
  { resource: 'carwash-reports',     moduleKey: 'carwash',          actions: ['view'] },
  { resource: 'carwash-commissions', moduleKey: 'carwash',          actions: ['view', 'manage', 'pay'] },
  { resource: 'carwash-loyalty',     moduleKey: 'carwash',          actions: ['view', 'manage'] },
  { resource: 'carwash-branches',    moduleKey: 'carwash',          actions: ['view', 'manage'] },
  { resource: 'carwash-settings',    moduleKey: 'carwash',          actions: ['view', 'manage'] },
  { resource: 'carwash-financials',  moduleKey: 'carwash',          actions: ['view', 'reverse'] },

  // ─── Inventory ────────────────────────────────────────────────────────────
  { resource: 'inv-dashboard',       moduleKey: 'inventory',        actions: ['view'] },
  { resource: 'inv-locations',       moduleKey: 'inventory',        actions: ['view', 'manage'] },
  { resource: 'inv-categories',      moduleKey: 'inventory',        actions: ['view', 'manage'] },
  { resource: 'inv-products',        moduleKey: 'inventory',        actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'inv-suppliers',       moduleKey: 'inventory',        actions: ['view', 'manage'] },
  { resource: 'inv-purchase-orders', moduleKey: 'inventory',        actions: ['view', 'create', 'receive', 'cancel'] },
  { resource: 'inv-transfers',       moduleKey: 'inventory',        actions: ['view', 'create', 'dispatch', 'receive'] },
  { resource: 'inv-stock',           moduleKey: 'inventory',        actions: ['view', 'adjust', 'writeoff'] },
  { resource: 'inv-tills',           moduleKey: 'inventory',        actions: ['view', 'manage'] },
  { resource: 'inv-reports',         moduleKey: 'inventory',        actions: ['view', 'export'] },

  // ─── Point of Sale ────────────────────────────────────────────────────────
  { resource: 'pos-terminal',        moduleKey: 'inventory',        actions: ['view', 'sell', 'void'] },
  { resource: 'pos-sessions',        moduleKey: 'inventory',        actions: ['view', 'open', 'close'] },
  { resource: 'pos-sales',           moduleKey: 'inventory',        actions: ['view', 'export'] },
  { resource: 'pos-reports',         moduleKey: 'inventory',        actions: ['view'] },

  // ─── Communications ───────────────────────────────────────────────────────
  { resource: 'sms',                 moduleKey: null,               actions: ['view', 'send', 'manage'] },
  { resource: 'email',               moduleKey: null,               actions: ['view', 'send', 'manage'] },
];

const LEGACY_ALIASES = {
  dashboard: { view: ['view_dashboard'] },
  companySettings: {
    view: ['view_company_settings'],
    update: ['update_company_settings'],
  },
  users: {
    view: ['view_users'],
    create: ['create_user'],
    update: ['update_user'],
    delete: ['delete_user', 'update_user'],
    lock: ['lock_user'],
  },
  tenants: {
    view: ['view_tenants'],
    create: ['create_tenant'],
    update: ['update_tenant'],
    delete: ['delete_tenant'],
  },
  tenantInvoices: {
    view: ['view_invoices'],
    create: ['create_invoice', 'create_debit_note', 'create_credit_note'],
    update: ['update_invoice'],
    delete: ['delete_invoice'],
    process: ['create_debit_note', 'create_credit_note'],
    export: ['view_invoices'],
  },
  receipts: {
    view: ['view_receipts'],
    create: ['record_receipt'],
    process: ['record_receipt'],
    reverse: ['reverse_receipt'],
    delete: ['delete_receipt'],
    export: ['view_receipts'],
  },
  chartOfAccounts: { view: ['view_chart_of_accounts'] },
  financialReports: {
    view: ['view_reports'],
    export: ['view_reports'],
  },
  journals: {
    view: ['view_reports'],
    process: ['post_journal'],
    reverse: ['reverse_journal'],
  },
  statements: {
    view: ['view_statements'],
    create: ['create_statement'],
    approve: ['approve_statement'],
    export: ['view_statements'],
  },
  landlordPayments: {
    view: ['view_statements'],
    process: ['pay_landlord'],
    export: ['view_statements'],
  },
  'carwash-dashboard': { view: ['carwash.dashboard.view'] },
  'carwash-jobs': {
    view: ['carwash.jobs.view'],
    create: ['carwash.jobs.create'],
    update: ['carwash.jobs.update'],
  },
  'carwash-payments': {
    view: ['carwash.payments.view'],
    record: ['carwash.payments.record'],
  },
  'carwash-deposits': {
    view: ['carwash.deposits.view'],
    create: ['carwash.deposits.create'],
    update: ['carwash.deposits.update'],
  },
  'carwash-expenses': {
    view: ['carwash.expenses.view'],
    create: ['carwash.expenses.create'],
    update: ['carwash.expenses.update'],
  },
  'carwash-services': {
    view: ['carwash.services.view', 'carwash.services.manage'],
    manage: ['carwash.services.manage'],
  },
  'carwash-staff': {
    view: ['carwash.staff.view', 'carwash.staff.manage'],
    manage: ['carwash.staff.manage'],
  },
  'carwash-reports': { view: ['carwash.reports.view'] },
  'carwash-commissions': {
    view: ['carwash.commissions.view', 'carwash.commissions.manage', 'carwash.commissions.pay'],
    manage: ['carwash.commissions.manage'],
    pay: ['carwash.commissions.pay'],
  },
  'carwash-loyalty': {
    view: ['carwash.loyalty.view', 'carwash.loyalty.manage'],
    manage: ['carwash.loyalty.manage'],
  },
  'carwash-branches': {
    view: ['carwash.branches.view', 'carwash.branches.manage'],
    manage: ['carwash.branches.manage'],
  },
  'carwash-settings': {
    view: ['carwash.settings.view', 'carwash.settings.manage'],
    manage: ['carwash.settings.manage'],
  },
};

const normalizeBoolean = (value) => value === true;

export const ACCESS_MATRIX = DEFINITIONS;
export const LEGACY_PERMISSION_ALIASES = LEGACY_ALIASES;

export const buildEmptyPermissionMap = () =>
  DEFINITIONS.reduce((acc, definition) => {
    acc[definition.resource] = definition.actions.reduce((actionAcc, action) => {
      actionAcc[action] = false;
      return actionAcc;
    }, {});
    return acc;
  }, {});

export const sanitizePermissionMap = (rawPermissions = {}) => {
  const normalized = buildEmptyPermissionMap();
  if (!rawPermissions || typeof rawPermissions !== 'object') {
    return normalized;
  }

  for (const definition of DEFINITIONS) {
    const resourcePermissions = rawPermissions?.[definition.resource];
    for (const action of definition.actions) {
      const directNested = resourcePermissions && typeof resourcePermissions === 'object'
        ? resourcePermissions[action]
        : undefined;
      if (typeof directNested === 'boolean') {
        normalized[definition.resource][action] = directNested;
        continue;
      }

      const flatKeys = [
        `${definition.resource}.${action}`,
        `${definition.resource}:${action}`,
        `${definition.resource}_${action}`,
        `${action}_${definition.resource}`,
        `${action}:${definition.resource}`,
      ];
      const legacyKeys = LEGACY_ALIASES?.[definition.resource]?.[action] || [];
      const matchedKey = [...flatKeys, ...legacyKeys].find((key) => typeof rawPermissions?.[key] === 'boolean');
      if (matchedKey) {
        normalized[definition.resource][action] = normalizeBoolean(rawPermissions[matchedKey]);
      }
    }
  }

  return normalized;
};

export const flattenPermissionMap = (permissions = {}) => {
  const normalized = sanitizePermissionMap(permissions);
  return Object.entries(normalized).reduce((acc, [resource, actions]) => {
    acc[resource] = { ...actions };
    return acc;
  }, {});
};

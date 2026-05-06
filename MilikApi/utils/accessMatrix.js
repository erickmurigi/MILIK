const DEFINITIONS = [
  { resource: 'dashboard', moduleKey: 'propertyManagement', actions: ['view'] },
  { resource: 'companies', moduleKey: null, actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'companySettings', moduleKey: null, actions: ['view', 'update'] },
  { resource: 'users', moduleKey: null, actions: ['view', 'create', 'update', 'delete', 'lock'] },
  { resource: 'properties', moduleKey: 'propertyManagement', actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'units', moduleKey: 'propertyManagement', actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'tenants', moduleKey: 'propertyManagement', actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'tenantInvoices', moduleKey: 'propertyManagement', actions: ['view', 'create', 'update', 'delete', 'process', 'export'] },
  { resource: 'receipts', moduleKey: 'propertyManagement', actions: ['view', 'create', 'process', 'reverse', 'delete', 'export'] },
  { resource: 'landlords', moduleKey: 'propertyManagement', actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'statements', moduleKey: 'propertyManagement', actions: ['view', 'create', 'approve', 'export'] },
  { resource: 'processedStatements', moduleKey: 'accounts', actions: ['view', 'export'] },
  { resource: 'maintenances', moduleKey: 'propertyManagement', actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'inspections', moduleKey: 'propertyManagement', actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'meterReadings', moduleKey: 'propertyManagement', actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'latePenalties', moduleKey: 'propertyManagement', actions: ['view', 'create', 'process'] },
  { resource: 'paymentVouchers', moduleKey: 'accounts', actions: ['view', 'create', 'update', 'delete', 'process'] },
  { resource: 'expenses', moduleKey: 'accounts', actions: ['view', 'create', 'update', 'delete', 'process'] },
  { resource: 'chartOfAccounts', moduleKey: 'accounts', actions: ['view', 'create', 'update', 'delete'] },
  { resource: 'journals', moduleKey: 'accounts', actions: ['view', 'process', 'reverse'] },
  { resource: 'financialReports', moduleKey: 'accounts', actions: ['view', 'export'] },
  { resource: 'landlordPayments', moduleKey: 'accounts', actions: ['view', 'process', 'export'] },
  { resource: 'carwash-dashboard', moduleKey: 'carwash', actions: ['view'] },
  { resource: 'carwash-jobs', moduleKey: 'carwash', actions: ['view', 'create', 'update'] },
  { resource: 'carwash-services', moduleKey: 'carwash', actions: ['view', 'manage'] },
  { resource: 'carwash-payments', moduleKey: 'carwash', actions: ['view', 'record'] },
  { resource: 'carwash-deposits', moduleKey: 'carwash', actions: ['view', 'create', 'update'] },
  { resource: 'carwash-expenses', moduleKey: 'carwash', actions: ['view', 'create', 'update'] },
  { resource: 'carwash-staff', moduleKey: 'carwash', actions: ['view', 'manage'] },
  { resource: 'carwash-reports', moduleKey: 'carwash', actions: ['view'] },
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

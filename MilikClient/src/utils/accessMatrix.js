export const ACCESS_SECTIONS = [
  {
    id: 'workspace',
    label: 'Workspace & setup',
    permissions: [
      { resource: 'dashboard', action: 'view', label: 'View dashboard', moduleKey: 'propertyManagement' },
      { resource: 'companySettings', action: 'view', label: 'Open company setup & settings' },
      { resource: 'companySettings', action: 'update', label: 'Update company setup & settings' },
    ],
  },
  {
    id: 'users',
    label: 'Users & access',
    permissions: [
      { resource: 'users', action: 'view', label: 'View users' },
      { resource: 'users', action: 'create', label: 'Create users' },
      { resource: 'users', action: 'update', label: 'Update users' },
      { resource: 'users', action: 'lock', label: 'Lock or unlock users' },
      { resource: 'users', action: 'delete', label: 'Delete users' },
    ],
  },
  {
    id: 'property',
    label: 'Properties, units & tenants',
    permissions: [
      { resource: 'properties', action: 'view', label: 'View properties', moduleKey: 'propertyManagement' },
      { resource: 'properties', action: 'create', label: 'Create properties', moduleKey: 'propertyManagement' },
      { resource: 'properties', action: 'update', label: 'Update properties', moduleKey: 'propertyManagement' },
      { resource: 'units', action: 'view', label: 'View units & availability', moduleKey: 'propertyManagement' },
      { resource: 'units', action: 'create', label: 'Create units', moduleKey: 'propertyManagement' },
      { resource: 'units', action: 'update', label: 'Update units', moduleKey: 'propertyManagement' },
      { resource: 'tenants', action: 'view', label: 'View tenants', moduleKey: 'propertyManagement' },
      { resource: 'tenants', action: 'create', label: 'Create tenants', moduleKey: 'propertyManagement' },
      { resource: 'tenants', action: 'update', label: 'Update tenants', moduleKey: 'propertyManagement' },
      { resource: 'tenants', action: 'delete', label: 'Delete tenants', moduleKey: 'propertyManagement' },
    ],
  },
  {
    id: 'collections',
    label: 'Invoicing, receipting & statements',
    permissions: [
      { resource: 'tenantInvoices', action: 'view', label: 'View tenant invoices', moduleKey: 'propertyManagement' },
      { resource: 'tenantInvoices', action: 'create', label: 'Create tenant invoices / notes', moduleKey: 'propertyManagement' },
      { resource: 'tenantInvoices', action: 'update', label: 'Update tenant invoices', moduleKey: 'propertyManagement' },
      { resource: 'receipts', action: 'view', label: 'View receipts', moduleKey: 'propertyManagement' },
      { resource: 'receipts', action: 'create', label: 'Record receipts', moduleKey: 'propertyManagement' },
      { resource: 'receipts', action: 'reverse', label: 'Reverse receipts', moduleKey: 'propertyManagement' },
      { resource: 'statements', action: 'view', label: 'View landlord statements', moduleKey: 'propertyManagement' },
      { resource: 'statements', action: 'create', label: 'Create landlord statements', moduleKey: 'propertyManagement' },
      { resource: 'statements', action: 'approve', label: 'Approve landlord statements', moduleKey: 'propertyManagement' },
    ],
  },
  {
    id: 'accounts',
    label: 'Accounting & reports',
    permissions: [
      { resource: 'paymentVouchers', action: 'view', label: 'View payment vouchers', moduleKey: 'accounts' },
      { resource: 'paymentVouchers', action: 'process', label: 'Post payment vouchers', moduleKey: 'accounts' },
      { resource: 'expenses', action: 'view', label: 'View expenses & providers', moduleKey: 'accounts' },
      { resource: 'expenses', action: 'create', label: 'Create expenses & providers', moduleKey: 'accounts' },
      { resource: 'chartOfAccounts', action: 'view', label: 'View chart of accounts', moduleKey: 'accounts' },
      { resource: 'chartOfAccounts', action: 'create', label: 'Create chart of accounts entries', moduleKey: 'accounts' },
      { resource: 'chartOfAccounts', action: 'update', label: 'Update chart of accounts entries', moduleKey: 'accounts' },
      { resource: 'chartOfAccounts', action: 'delete', label: 'Delete chart of accounts entries', moduleKey: 'accounts' },
      { resource: 'expenses', action: 'update', label: 'Update expenses & providers', moduleKey: 'accounts' },
      { resource: 'expenses', action: 'delete', label: 'Delete expenses & providers', moduleKey: 'accounts' },
      { resource: 'pettyCash', action: 'view', label: 'View petty cash', moduleKey: 'accounts' },
      { resource: 'pettyCash', action: 'create', label: 'Record petty cash disbursements', moduleKey: 'accounts' },
      { resource: 'pettyCash', action: 'approve', label: 'Approve petty cash replenishments', moduleKey: 'accounts' },
      { resource: 'landlordAdvancements', action: 'view', label: 'View landlord advancements', moduleKey: 'accounts' },
      { resource: 'landlordAdvancements', action: 'create', label: 'Create / edit landlord advancements', moduleKey: 'accounts' },
      { resource: 'standingOrders', action: 'view', label: 'View standing orders', moduleKey: 'accounts' },
      { resource: 'standingOrders', action: 'create', label: 'Create / edit standing orders', moduleKey: 'accounts' },
      { resource: 'landlordReceipts', action: 'view', label: 'View landlord receipts', moduleKey: 'accounts' },
      { resource: 'landlordReceipts', action: 'create', label: 'Record / edit landlord receipts', moduleKey: 'accounts' },
      { resource: 'landlordReceipts', action: 'reverse', label: 'Reverse landlord receipts', moduleKey: 'accounts' },
      { resource: 'journals', action: 'process', label: 'Post journals', moduleKey: 'accounts' },
      { resource: 'journals', action: 'reverse', label: 'Reverse journals', moduleKey: 'accounts' },
      { resource: 'financialReports', action: 'view', label: 'View reports', moduleKey: 'accounts' },
      { resource: 'financialReports', action: 'export', label: 'Print / export reports', moduleKey: 'accounts' },
      { resource: 'landlordPayments', action: 'process', label: 'Pay landlords / post commission', moduleKey: 'accounts' },
      { resource: 'processedStatements', action: 'view', label: 'View processed statements', moduleKey: 'accounts' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations tools',
    permissions: [
      { resource: 'landlords', action: 'view', label: 'View landlords', moduleKey: 'propertyManagement' },
      { resource: 'landlords', action: 'create', label: 'Create landlords', moduleKey: 'propertyManagement' },
      { resource: 'landlords', action: 'update', label: 'Update landlords', moduleKey: 'propertyManagement' },
      { resource: 'landlords', action: 'delete', label: 'Delete / archive landlords', moduleKey: 'propertyManagement' },
      { resource: 'maintenances', action: 'view', label: 'View maintenance', moduleKey: 'propertyManagement' },
      { resource: 'maintenances', action: 'create', label: 'Create maintenance', moduleKey: 'propertyManagement' },
      { resource: 'inspections', action: 'view', label: 'View inspections', moduleKey: 'propertyManagement' },
      { resource: 'inspections', action: 'create', label: 'Create inspections', moduleKey: 'propertyManagement' },
      { resource: 'meterReadings', action: 'view', label: 'View meter readings', moduleKey: 'propertyManagement' },
      { resource: 'meterReadings', action: 'create', label: 'Create meter readings', moduleKey: 'propertyManagement' },
      { resource: 'latePenalties', action: 'view', label: 'View late penalties', moduleKey: 'propertyManagement' },
      { resource: 'latePenalties', action: 'process', label: 'Apply late penalties', moduleKey: 'propertyManagement' },
    ],
  },
  {
    id: 'carwash',
    label: 'MILIK Car Wash',
    permissions: [
      { resource: 'carwash-dashboard', action: 'view', label: 'Open Car Wash dashboard', moduleKey: 'carwash' },
      { resource: 'carwash-jobs', action: 'view', label: 'View wash jobs', moduleKey: 'carwash' },
      { resource: 'carwash-jobs', action: 'create', label: 'Create wash jobs', moduleKey: 'carwash' },
      { resource: 'carwash-jobs', action: 'update', label: 'Update wash jobs', moduleKey: 'carwash' },
      { resource: 'carwash-payments', action: 'view', label: 'View Car Wash payments', moduleKey: 'carwash' },
      { resource: 'carwash-payments', action: 'record', label: 'Record Car Wash payments', moduleKey: 'carwash' },
      { resource: 'carwash-deposits', action: 'view', label: 'View Car Wash deposits', moduleKey: 'carwash' },
      { resource: 'carwash-deposits', action: 'create', label: 'Record Car Wash deposits', moduleKey: 'carwash' },
      { resource: 'carwash-deposits', action: 'update', label: 'Confirm or cancel Car Wash deposits', moduleKey: 'carwash' },
      { resource: 'carwash-expenses', action: 'view', label: 'View Car Wash expenses', moduleKey: 'carwash' },
      { resource: 'carwash-expenses', action: 'create', label: 'Record Car Wash expenses', moduleKey: 'carwash' },
      { resource: 'carwash-expenses', action: 'update', label: 'Approve, pay or cancel Car Wash expenses', moduleKey: 'carwash' },
      { resource: 'carwash-services', action: 'view', label: 'View Car Wash services', moduleKey: 'carwash' },
      { resource: 'carwash-services', action: 'manage', label: 'Manage Car Wash services', moduleKey: 'carwash' },
      { resource: 'carwash-staff', action: 'view', label: 'View Car Wash staff', moduleKey: 'carwash' },
      { resource: 'carwash-staff', action: 'manage', label: 'Manage Car Wash staff', moduleKey: 'carwash' },
      { resource: 'carwash-reports', action: 'view', label: 'View Car Wash reports', moduleKey: 'carwash' },
    ],
  },
];

export const RESOURCE_PERMISSION_MAP = ACCESS_SECTIONS.reduce((acc, section) => {
  section.permissions.forEach((permission) => {
    if (!acc[permission.resource]) acc[permission.resource] = {};
    acc[permission.resource][permission.action] = permission;
  });
  return acc;
}, {});

export const buildEmptyPermissionMap = () =>
  ACCESS_SECTIONS.reduce((acc, section) => {
    section.permissions.forEach(({ resource, action }) => {
      if (!acc[resource]) acc[resource] = {};
      acc[resource][action] = false;
    });
    return acc;
  }, {});

export const LEGACY_PERMISSION_ALIASES = {
  dashboard: { view: ['view_dashboard'] },
  companySettings: { view: ['view_company_settings'], update: ['update_company_settings'] },
  users: { view: ['view_users'], create: ['create_user'], update: ['update_user'], delete: ['delete_user', 'update_user'], lock: ['lock_user'] },
  tenants: { view: ['view_tenants'], create: ['create_tenant'], update: ['update_tenant'], delete: ['delete_tenant'] },
  tenantInvoices: { view: ['view_invoices'], create: ['create_invoice', 'create_debit_note', 'create_credit_note'], update: ['update_invoice'], delete: ['delete_invoice'], process: ['create_debit_note', 'create_credit_note'], export: ['view_invoices'] },
  receipts: { view: ['view_receipts'], create: ['record_receipt'], process: ['record_receipt'], reverse: ['reverse_receipt'], delete: ['delete_receipt'], export: ['view_receipts'] },
  chartOfAccounts: { view: ['view_chart_of_accounts'] },
  financialReports: { view: ['view_reports'], export: ['view_reports'] },
  journals: { view: ['view_reports'], process: ['post_journal'], reverse: ['reverse_journal'] },
  statements: { view: ['view_statements'], create: ['create_statement'], approve: ['approve_statement'], export: ['view_statements'] },
  landlordPayments: { view: ['view_statements'], process: ['pay_landlord'], export: ['view_statements'] },
  'carwash-dashboard': { view: ['carwash.dashboard.view'] },
  'carwash-jobs': { view: ['carwash.jobs.view'], create: ['carwash.jobs.create'], update: ['carwash.jobs.update'] },
  'carwash-payments': { view: ['carwash.payments.view'], record: ['carwash.payments.record'] },
  'carwash-deposits': { view: ['carwash.deposits.view'], create: ['carwash.deposits.create'], update: ['carwash.deposits.update'] },
  'carwash-expenses': { view: ['carwash.expenses.view'], create: ['carwash.expenses.create'], update: ['carwash.expenses.update'] },
  'carwash-services': { view: ['carwash.services.view', 'carwash.services.manage'], manage: ['carwash.services.manage'] },
  'carwash-staff': { view: ['carwash.staff.view', 'carwash.staff.manage'], manage: ['carwash.staff.manage'] },
  'carwash-reports': { view: ['carwash.reports.view'] },
};

export const normalizePermissionMap = (rawPermissions = {}) => {
  const normalized = buildEmptyPermissionMap();
  if (!rawPermissions || typeof rawPermissions !== 'object') {
    return normalized;
  }

  Object.entries(normalized).forEach(([resource, actions]) => {
    Object.keys(actions).forEach((action) => {
      const nestedValue = rawPermissions?.[resource] && typeof rawPermissions[resource] === 'object'
        ? rawPermissions[resource][action]
        : undefined;
      if (typeof nestedValue === 'boolean') {
        normalized[resource][action] = nestedValue;
        return;
      }
      const flatKeys = [
        `${resource}.${action}`,
        `${resource}:${action}`,
        `${resource}_${action}`,
        `${action}_${resource}`,
        `${action}:${resource}`,
      ];
      const legacyKeys = LEGACY_PERMISSION_ALIASES?.[resource]?.[action] || [];
      const matchedKey = [...flatKeys, ...legacyKeys].find((key) => typeof rawPermissions?.[key] === 'boolean');
      if (matchedKey) normalized[resource][action] = rawPermissions[matchedKey] === true;
    });
  });

  return normalized;
};

export const setPermissionGroupValue = (permissionMap = {}, permissions = [], nextValue = true) => {
  const updated = normalizePermissionMap(permissionMap);
  permissions.forEach(({ resource, action }) => {
    if (!updated[resource]) updated[resource] = {};
    updated[resource][action] = nextValue;
  });
  return updated;
};

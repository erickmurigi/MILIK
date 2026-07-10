export const ACCESS_SECTIONS = [
  // ─── Workspace & Setup ──────────────────────────────────────────────────────
  {
    id: 'workspace',
    label: 'Workspace & Setup',
    permissions: [
      { resource: 'dashboard',       action: 'view',   label: 'View dashboard' },
      { resource: 'companySettings', action: 'view',   label: 'Open company setup & settings' },
      { resource: 'companySettings', action: 'update', label: 'Update company setup & settings' },
    ],
  },

  // ─── Users & Access ─────────────────────────────────────────────────────────
  {
    id: 'users',
    label: 'Users & Access',
    permissions: [
      { resource: 'users', action: 'view',   label: 'View users' },
      { resource: 'users', action: 'create', label: 'Create users' },
      { resource: 'users', action: 'update', label: 'Update user details & permissions' },
      { resource: 'users', action: 'lock',   label: 'Lock or unlock users' },
      { resource: 'users', action: 'delete', label: 'Deactivate or delete users' },
    ],
  },

  // ─── Properties, Units & Tenants ────────────────────────────────────────────
  {
    id: 'property',
    label: 'Properties, Units & Tenants',
    permissions: [
      { resource: 'properties', action: 'view',      label: 'View properties',                    moduleKey: 'propertyManagement' },
      { resource: 'properties', action: 'create',    label: 'Create properties',                  moduleKey: 'propertyManagement' },
      { resource: 'properties', action: 'update',    label: 'Update properties',                  moduleKey: 'propertyManagement' },
      { resource: 'properties', action: 'delete',    label: 'Delete / archive properties',        moduleKey: 'propertyManagement' },
      { resource: 'units',      action: 'view',      label: 'View units & availability',          moduleKey: 'propertyManagement' },
      { resource: 'units',      action: 'create',    label: 'Create units',                       moduleKey: 'propertyManagement' },
      { resource: 'units',      action: 'update',    label: 'Update units',                       moduleKey: 'propertyManagement' },
      { resource: 'units',      action: 'delete',    label: 'Delete / archive units',             moduleKey: 'propertyManagement' },
      { resource: 'tenants',    action: 'view',      label: 'View tenants',                       moduleKey: 'propertyManagement' },
      { resource: 'tenants',    action: 'create',    label: 'Create tenants',                     moduleKey: 'propertyManagement' },
      { resource: 'tenants',    action: 'update',    label: 'Update tenants',                     moduleKey: 'propertyManagement' },
      { resource: 'tenants',    action: 'terminate', label: 'Process tenant terminations / notices', moduleKey: 'propertyManagement' },
      { resource: 'tenants',    action: 'delete',    label: 'Delete tenant records',              moduleKey: 'propertyManagement' },
    ],
  },

  // ─── Leases & Agreements ────────────────────────────────────────────────────
  {
    id: 'leases',
    label: 'Leases & Agreements',
    permissions: [
      { resource: 'leases', action: 'view',      label: 'View lease agreements',             moduleKey: 'propertyManagement' },
      { resource: 'leases', action: 'create',    label: 'Create lease agreements',           moduleKey: 'propertyManagement' },
      { resource: 'leases', action: 'update',    label: 'Update / renew leases',             moduleKey: 'propertyManagement' },
      { resource: 'leases', action: 'terminate', label: 'Terminate leases',                  moduleKey: 'propertyManagement' },
      { resource: 'deposits',       action: 'view',   label: 'View tenant deposits',         moduleKey: 'propertyManagement' },
      { resource: 'deposits',       action: 'create', label: 'Record tenant deposits',       moduleKey: 'propertyManagement' },
      { resource: 'deposits',       action: 'refund', label: 'Refund / release deposits',    moduleKey: 'propertyManagement' },
      { resource: 'takeOnBalances', action: 'view',   label: 'View take-on balances',        moduleKey: 'propertyManagement' },
      { resource: 'takeOnBalances', action: 'create', label: 'Create / edit take-on entries',moduleKey: 'propertyManagement' },
    ],
  },

  // ─── Invoicing, Receipting & Statements ─────────────────────────────────────
  {
    id: 'collections',
    label: 'Invoicing, Receipting & Statements',
    permissions: [
      { resource: 'tenantInvoices', action: 'view',    label: 'View tenant invoices',                 moduleKey: 'propertyManagement' },
      { resource: 'tenantInvoices', action: 'create',  label: 'Create invoices / credit & debit notes',moduleKey: 'propertyManagement' },
      { resource: 'tenantInvoices', action: 'update',  label: 'Update tenant invoices',               moduleKey: 'propertyManagement' },
      { resource: 'tenantInvoices', action: 'reverse', label: 'Reverse / cancel invoices',            moduleKey: 'propertyManagement' },
      { resource: 'tenantInvoices', action: 'delete',  label: 'Delete invoice records',               moduleKey: 'propertyManagement' },
      { resource: 'tenantInvoices', action: 'export',  label: 'Print / export invoices',              moduleKey: 'propertyManagement' },
      { resource: 'receipts',       action: 'view',    label: 'View receipts',                        moduleKey: 'propertyManagement' },
      { resource: 'receipts',       action: 'create',  label: 'Record receipts',                      moduleKey: 'propertyManagement' },
      { resource: 'receipts',       action: 'import',  label: 'Import M-Pesa statements',             moduleKey: 'propertyManagement' },
      { resource: 'receipts',       action: 'reverse', label: 'Reverse receipts',                     moduleKey: 'propertyManagement' },
      { resource: 'receipts',       action: 'delete',  label: 'Delete receipt records',               moduleKey: 'propertyManagement' },
      { resource: 'prepayments',    action: 'view',    label: 'View tenant prepayments',              moduleKey: 'propertyManagement' },
      { resource: 'prepayments',    action: 'create',  label: 'Record / apply prepayments',           moduleKey: 'propertyManagement' },
      { resource: 'statements',     action: 'view',    label: 'View landlord statements',             moduleKey: 'propertyManagement' },
      { resource: 'statements',     action: 'create',  label: 'Create landlord statements',           moduleKey: 'propertyManagement' },
      { resource: 'statements',     action: 'approve', label: 'Approve landlord statements',          moduleKey: 'propertyManagement' },
      { resource: 'statements',     action: 'update',  label: 'Revise / edit landlord statements',    moduleKey: 'propertyManagement' },
      { resource: 'statements',     action: 'send',    label: 'Send statements to landlords',         moduleKey: 'propertyManagement' },
      { resource: 'statements',     action: 'export',  label: 'Print / export landlord statements',   moduleKey: 'propertyManagement' },
      { resource: 'statements',     action: 'reverse', label: 'Reverse / cancel landlord statements', moduleKey: 'propertyManagement' },
      { resource: 'statements',         action: 'delete',  label: 'Delete landlord statement records',             moduleKey: 'propertyManagement' },
      { resource: 'processedStatements', action: 'view',    label: 'View processed statements',                    moduleKey: 'propertyManagement' },
      { resource: 'processedStatements', action: 'reverse', label: 'Reverse processed statements',                 moduleKey: 'propertyManagement' },
      { resource: 'processedStatements', action: 'send',    label: 'Send processed statements to landlords',       moduleKey: 'propertyManagement' },
      { resource: 'processedStatements', action: 'export',  label: 'Print / export processed statements',          moduleKey: 'propertyManagement' },
      { resource: 'landlordPayments',    action: 'view',    label: 'View landlord payment history',                moduleKey: 'propertyManagement' },
      { resource: 'landlordPayments',    action: 'process', label: 'Pay landlords / post commission',              moduleKey: 'propertyManagement' },
      { resource: 'landlordPayments',    action: 'export',  label: 'Print / export landlord payment records',      moduleKey: 'propertyManagement' },
    ],
  },

  // ─── Accounting & General Ledger ────────────────────────────────────────────
  {
    id: 'accounts',
    label: 'Accounting & General Ledger',
    permissions: [
      { resource: 'chartOfAccounts',     action: 'view',       label: 'View chart of accounts',                  moduleKey: 'accounts' },
      { resource: 'chartOfAccounts',     action: 'create',     label: 'Create chart of accounts entries',        moduleKey: 'accounts' },
      { resource: 'chartOfAccounts',     action: 'update',     label: 'Update chart of accounts entries',        moduleKey: 'accounts' },
      { resource: 'chartOfAccounts',     action: 'delete',     label: 'Delete chart of accounts entries',        moduleKey: 'accounts' },
      { resource: 'journals',            action: 'process',    label: 'Post journal entries',                    moduleKey: 'accounts' },
      { resource: 'journals',            action: 'reverse',    label: 'Reverse journal entries',                 moduleKey: 'accounts' },
      { resource: 'bankReconciliation',  action: 'view',       label: 'View bank reconciliation',               moduleKey: 'accounts' },
      { resource: 'bankReconciliation',  action: 'process',    label: 'Post reconciliation entries',            moduleKey: 'accounts' },
      { resource: 'paymentVouchers',     action: 'view',       label: 'View payment vouchers',                   moduleKey: 'accounts' },
      { resource: 'paymentVouchers',     action: 'process',    label: 'Create / post payment vouchers',          moduleKey: 'accounts' },
      { resource: 'paymentVouchers',     action: 'approve',    label: 'Approve payment vouchers',               moduleKey: 'accounts' },
      { resource: 'paymentVouchers',     action: 'reverse',    label: 'Reverse / cancel payment vouchers',      moduleKey: 'accounts' },
      { resource: 'expenses',            action: 'view',       label: 'View expenses & service providers',       moduleKey: 'accounts' },
      { resource: 'expenses',            action: 'create',     label: 'Create expense requisitions',             moduleKey: 'accounts' },
      { resource: 'expenses',            action: 'approve',    label: 'Approve expense requisitions',           moduleKey: 'accounts' },
      { resource: 'expenses',            action: 'update',     label: 'Update expenses & providers',             moduleKey: 'accounts' },
      { resource: 'expenses',            action: 'delete',     label: 'Delete expense records',                  moduleKey: 'accounts' },
      { resource: 'pettyCash',           action: 'view',       label: 'View petty cash',                         moduleKey: 'accounts' },
      { resource: 'pettyCash',           action: 'create',     label: 'Record petty cash disbursements',         moduleKey: 'accounts' },
      { resource: 'pettyCash',           action: 'approve',    label: 'Approve petty cash replenishments',       moduleKey: 'accounts' },
      { resource: 'budgets',             action: 'view',       label: 'View budget plans',                       moduleKey: 'accounts' },
      { resource: 'budgets',             action: 'create',     label: 'Create / edit budget plans',              moduleKey: 'accounts' },
      { resource: 'budgets',             action: 'approve',    label: 'Approve budgets',                         moduleKey: 'accounts' },
      { resource: 'fixedAssets',         action: 'view',       label: 'View fixed asset register',              moduleKey: 'accounts' },
      { resource: 'fixedAssets',         action: 'create',     label: 'Add / update fixed assets',              moduleKey: 'accounts' },
      { resource: 'fixedAssets',         action: 'depreciate', label: 'Run depreciation',                       moduleKey: 'accounts' },
      { resource: 'creditorLedger',      action: 'view',       label: 'View creditors ledger',                  moduleKey: 'accounts' },
      { resource: 'financialReports',    action: 'view',       label: 'View financial reports',                  moduleKey: 'accounts' },
      { resource: 'financialReports',    action: 'export',     label: 'Print / export financial reports',        moduleKey: 'accounts' },
      { resource: 'landlordAdvancements',action: 'view',       label: 'View landlord advancements',             moduleKey: 'accounts' },
      { resource: 'landlordAdvancements',action: 'create',     label: 'Create / edit landlord advancements',    moduleKey: 'accounts' },
      { resource: 'standingOrders',      action: 'view',       label: 'View standing orders',                    moduleKey: 'accounts' },
      { resource: 'standingOrders',      action: 'create',     label: 'Create / edit standing orders',           moduleKey: 'accounts' },
      { resource: 'landlordReceipts',    action: 'view',       label: 'View landlord receipts',                  moduleKey: 'accounts' },
      { resource: 'landlordReceipts',    action: 'create',     label: 'Record / edit landlord receipts',         moduleKey: 'accounts' },
      { resource: 'landlordReceipts',    action: 'reverse',    label: 'Reverse landlord receipts',               moduleKey: 'accounts' },
    ],
  },

  // ─── Property Management Reports ────────────────────────────────────────────
  {
    id: 'pmReports',
    label: 'Property Management Reports',
    permissions: [
      { resource: 'pmReports',         action: 'view',   label: 'View rental collection report',    moduleKey: 'propertyManagement' },
      { resource: 'pmReports',         action: 'export', label: 'Print / export rental reports',    moduleKey: 'propertyManagement' },
      { resource: 'agedAnalysis',      action: 'view',   label: 'View arrears & aged analysis',     moduleKey: 'propertyManagement' },
      { resource: 'agedAnalysis',      action: 'export', label: 'Export aged analysis',             moduleKey: 'propertyManagement' },
      { resource: 'commissionReports', action: 'view',   label: 'View commission reports',          moduleKey: 'propertyManagement' },
      { resource: 'commissionReports', action: 'export', label: 'Export commission reports',        moduleKey: 'propertyManagement' },
      { resource: 'taxReports',        action: 'view',   label: 'View tax & VAT reports',           moduleKey: 'propertyManagement' },
      { resource: 'taxReports',        action: 'export', label: 'Export tax reports',               moduleKey: 'propertyManagement' },
    ],
  },

  // ─── Operations Tools ────────────────────────────────────────────────────────
  {
    id: 'operations',
    label: 'Operations Tools',
    permissions: [
      { resource: 'landlords',     action: 'view',    label: 'View landlords',                  moduleKey: 'propertyManagement' },
      { resource: 'landlords',     action: 'create',  label: 'Create landlords',                moduleKey: 'propertyManagement' },
      { resource: 'landlords',     action: 'update',  label: 'Update landlords',                moduleKey: 'propertyManagement' },
      { resource: 'landlords',     action: 'delete',  label: 'Delete / archive landlords',      moduleKey: 'propertyManagement' },
      { resource: 'commissions',   action: 'view',    label: 'View commission configurations',  moduleKey: 'propertyManagement' },
      { resource: 'commissions',   action: 'create',  label: 'Create / edit commission rules',  moduleKey: 'propertyManagement' },
      { resource: 'commissions',   action: 'process', label: 'Process & pay commissions',       moduleKey: 'propertyManagement' },
      { resource: 'maintenances',      action: 'view',    label: 'View maintenance requests',        moduleKey: 'propertyManagement' },
      { resource: 'maintenances',      action: 'create',  label: 'Create maintenance requests',      moduleKey: 'propertyManagement' },
      { resource: 'maintenances',      action: 'update',  label: 'Update maintenance requests',      moduleKey: 'propertyManagement' },
      { resource: 'maintenances',      action: 'close',   label: 'Close / resolve maintenance',      moduleKey: 'propertyManagement' },
      { resource: 'maintenances',      action: 'delete',  label: 'Delete maintenance requests',      moduleKey: 'propertyManagement' },
      { resource: 'inspections',       action: 'view',    label: 'View inspections',                 moduleKey: 'propertyManagement' },
      { resource: 'inspections',       action: 'create',  label: 'Create inspections',               moduleKey: 'propertyManagement' },
      { resource: 'inspections',       action: 'update',  label: 'Update inspections',               moduleKey: 'propertyManagement' },
      { resource: 'inspections',       action: 'close',   label: 'Complete / close inspections',     moduleKey: 'propertyManagement' },
      { resource: 'inspections',       action: 'delete',  label: 'Delete inspections',               moduleKey: 'propertyManagement' },
      { resource: 'meterReadings',     action: 'view',    label: 'View meter readings',              moduleKey: 'propertyManagement' },
      { resource: 'meterReadings',     action: 'create',  label: 'Create meter readings',            moduleKey: 'propertyManagement' },
      { resource: 'latePenalties',     action: 'view',    label: 'View late penalties',              moduleKey: 'propertyManagement' },
      { resource: 'latePenalties',     action: 'process', label: 'Apply late penalties',             moduleKey: 'propertyManagement' },
      { resource: 'propertyExpenses',  action: 'view',    label: 'View property expenses',           moduleKey: 'propertyManagement' },
      { resource: 'propertyExpenses',  action: 'create',  label: 'Record / edit property expenses',  moduleKey: 'propertyManagement' },
      { resource: 'propertyExpenses',  action: 'update',  label: 'Update property expense records',  moduleKey: 'propertyManagement' },
      { resource: 'propertyExpenses',  action: 'delete',  label: 'Delete property expense records',  moduleKey: 'propertyManagement' },
    ],
  },

  // ─── Property Sales ──────────────────────────────────────────────────────────
  {
    id: 'propertySale',
    label: 'Property Sales',
    permissions: [
      { resource: 'saleListings',    action: 'view',    label: 'View sale listings',             moduleKey: 'propertySale' },
      { resource: 'saleListings',    action: 'create',  label: 'Create sale listings',           moduleKey: 'propertySale' },
      { resource: 'saleListings',    action: 'update',  label: 'Update sale listings',           moduleKey: 'propertySale' },
      { resource: 'saleListings',    action: 'delete',  label: 'Delete / delist properties',     moduleKey: 'propertySale' },
      { resource: 'saleBuyers',      action: 'view',    label: 'View buyers',                    moduleKey: 'propertySale' },
      { resource: 'saleBuyers',      action: 'create',  label: 'Add buyers',                     moduleKey: 'propertySale' },
      { resource: 'saleBuyers',      action: 'update',  label: 'Update buyer details',           moduleKey: 'propertySale' },
      { resource: 'saleAgents',      action: 'view',    label: 'View sales agents',              moduleKey: 'propertySale' },
      { resource: 'saleAgents',      action: 'manage',  label: 'Add / update / remove agents',  moduleKey: 'propertySale' },
      { resource: 'saleOffers',      action: 'view',    label: 'View offers',                    moduleKey: 'propertySale' },
      { resource: 'saleOffers',      action: 'create',  label: 'Create offers',                  moduleKey: 'propertySale' },
      { resource: 'saleOffers',      action: 'approve', label: 'Approve / reject offers',        moduleKey: 'propertySale' },
      { resource: 'saleDeals',       action: 'view',    label: 'View deals',                     moduleKey: 'propertySale' },
      { resource: 'saleDeals',       action: 'create',  label: 'Create deals',                   moduleKey: 'propertySale' },
      { resource: 'saleDeals',       action: 'close',   label: 'Close deals',                    moduleKey: 'propertySale' },
      { resource: 'salePayments',    action: 'view',    label: 'View sale payments',             moduleKey: 'propertySale' },
      { resource: 'salePayments',    action: 'record',  label: 'Record sale payments',           moduleKey: 'propertySale' },
      { resource: 'saleCommissions', action: 'view',    label: 'View sale commissions',          moduleKey: 'propertySale' },
      { resource: 'saleCommissions', action: 'pay',     label: 'Pay sale commissions',           moduleKey: 'propertySale' },
      { resource: 'saleReports',     action: 'view',    label: 'View sale reports',              moduleKey: 'propertySale' },
      { resource: 'saleReports',     action: 'export',  label: 'Export sale reports',            moduleKey: 'propertySale' },
    ],
  },

  // ─── Human Resource ──────────────────────────────────────────────────────────
  {
    id: 'humanResource',
    label: 'Human Resource',
    permissions: [
      { resource: 'hrEmployees',  action: 'view',      label: 'View employees',                  moduleKey: 'hr' },
      { resource: 'hrEmployees',  action: 'create',    label: 'Add employees',                   moduleKey: 'hr' },
      { resource: 'hrEmployees',  action: 'update',    label: 'Update employee details',         moduleKey: 'hr' },
      { resource: 'hrEmployees',  action: 'terminate', label: 'Terminate / exit employees',      moduleKey: 'hr' },
      { resource: 'hrLeave',      action: 'view',      label: 'View leave applications',         moduleKey: 'hr' },
      { resource: 'hrLeave',      action: 'create',    label: 'Apply for leave',                 moduleKey: 'hr' },
      { resource: 'hrLeave',      action: 'approve',   label: 'Approve / reject leave',          moduleKey: 'hr' },
      { resource: 'hrLeave',      action: 'manage',    label: 'Manage leave types & balances',   moduleKey: 'hr' },
      { resource: 'hrPayroll',    action: 'view',      label: 'View payroll periods & payslips', moduleKey: 'hr' },
      { resource: 'hrPayroll',    action: 'run',       label: 'Run payroll',                     moduleKey: 'hr' },
      { resource: 'hrPayroll',    action: 'approve',   label: 'Approve payroll',                 moduleKey: 'hr' },
      { resource: 'hrPayroll',    action: 'reverse',   label: 'Reverse payroll entries',         moduleKey: 'hr' },
      { resource: 'hrStatutory',  action: 'view',      label: 'View statutory deductions',       moduleKey: 'hr' },
      { resource: 'hrStatutory',  action: 'process',   label: 'Process statutory deductions',    moduleKey: 'hr' },
      { resource: 'hrAppraisals', action: 'view',      label: 'View appraisals & KPIs',          moduleKey: 'hr' },
      { resource: 'hrAppraisals', action: 'create',    label: 'Create appraisal cycles & KPIs',  moduleKey: 'hr' },
      { resource: 'hrAppraisals', action: 'complete',  label: 'Score / complete appraisals',     moduleKey: 'hr' },
      { resource: 'hrReports',    action: 'view',      label: 'View HR reports',                 moduleKey: 'hr' },
      { resource: 'hrReports',    action: 'export',    label: 'Export HR reports (P9, payroll)', moduleKey: 'hr' },
      { resource: 'hrSetup',      action: 'view',      label: 'View HR setup',                   moduleKey: 'hr' },
      { resource: 'hrSetup',      action: 'manage',    label: 'Manage departments, designations, leave types', moduleKey: 'hr' },
    ],
  },

  // ─── MILIK Car Wash ──────────────────────────────────────────────────────────
  {
    id: 'carwash',
    label: 'MILIK Car Wash',
    permissions: [
      { resource: 'carwash-dashboard',   action: 'view',   label: 'Open Car Wash dashboard',              moduleKey: 'carwash' },
      { resource: 'carwash-jobs',        action: 'view',   label: 'View wash jobs',                       moduleKey: 'carwash' },
      { resource: 'carwash-jobs',        action: 'create', label: 'Create wash jobs',                     moduleKey: 'carwash' },
      { resource: 'carwash-jobs',        action: 'update', label: 'Update wash jobs',                     moduleKey: 'carwash' },
      { resource: 'carwash-payments',    action: 'view',   label: 'View Car Wash payments',               moduleKey: 'carwash' },
      { resource: 'carwash-payments',    action: 'record', label: 'Record Car Wash payments',             moduleKey: 'carwash' },
      { resource: 'carwash-deposits',    action: 'view',   label: 'View Car Wash deposits',               moduleKey: 'carwash' },
      { resource: 'carwash-deposits',    action: 'create', label: 'Record Car Wash deposits',             moduleKey: 'carwash' },
      { resource: 'carwash-deposits',    action: 'update', label: 'Confirm or cancel Car Wash deposits',  moduleKey: 'carwash' },
      { resource: 'carwash-expenses',    action: 'view',   label: 'View Car Wash expenses',               moduleKey: 'carwash' },
      { resource: 'carwash-expenses',    action: 'create', label: 'Record Car Wash expenses',             moduleKey: 'carwash' },
      { resource: 'carwash-expenses',    action: 'update', label: 'Approve, pay or cancel Car Wash expenses', moduleKey: 'carwash' },
      { resource: 'carwash-expenses',    action: 'delete', label: 'Delete draft Car Wash expenses',       moduleKey: 'carwash' },
      { resource: 'carwash-services',    action: 'view',   label: 'View Car Wash services',               moduleKey: 'carwash' },
      { resource: 'carwash-services',    action: 'manage', label: 'Manage Car Wash services',             moduleKey: 'carwash' },
      { resource: 'carwash-staff',       action: 'view',   label: 'View Car Wash staff',                  moduleKey: 'carwash' },
      { resource: 'carwash-staff',       action: 'manage', label: 'Manage Car Wash staff',               moduleKey: 'carwash' },
      { resource: 'carwash-reports',     action: 'view',   label: 'View Car Wash reports',               moduleKey: 'carwash' },
      { resource: 'carwash-commissions', action: 'view',   label: 'View staff commissions',              moduleKey: 'carwash' },
      { resource: 'carwash-commissions', action: 'manage', label: 'Manage commission rules',             moduleKey: 'carwash' },
      { resource: 'carwash-commissions', action: 'pay',    label: 'Pay staff commissions',               moduleKey: 'carwash' },
      { resource: 'carwash-loyalty',     action: 'view',   label: 'View loyalty program & customers',    moduleKey: 'carwash' },
      { resource: 'carwash-loyalty',     action: 'manage', label: 'Manage loyalty program & customers',  moduleKey: 'carwash' },
      { resource: 'carwash-branches',    action: 'view',   label: 'View branches',                       moduleKey: 'carwash' },
      { resource: 'carwash-branches',    action: 'manage', label: 'Manage branches',                     moduleKey: 'carwash' },
      { resource: 'carwash-settings',    action: 'view',   label: 'View operational settings',           moduleKey: 'carwash' },
      { resource: 'carwash-settings',    action: 'manage', label: 'Manage operational settings',         moduleKey: 'carwash' },
    ],
  },

  // ─── Inventory ───────────────────────────────────────────────────────────────
  {
    id: 'inventory',
    label: 'Inventory',
    permissions: [
      { resource: 'inv-dashboard',       action: 'view',     label: 'View inventory dashboard',            moduleKey: 'inventory' },
      { resource: 'inv-locations',       action: 'view',     label: 'View locations / branches',           moduleKey: 'inventory' },
      { resource: 'inv-locations',       action: 'manage',   label: 'Create & manage locations',           moduleKey: 'inventory' },
      { resource: 'inv-categories',      action: 'view',     label: 'View product categories',             moduleKey: 'inventory' },
      { resource: 'inv-categories',      action: 'manage',   label: 'Create & manage product categories',  moduleKey: 'inventory' },
      { resource: 'inv-products',        action: 'view',     label: 'View product catalog',                moduleKey: 'inventory' },
      { resource: 'inv-products',        action: 'create',   label: 'Create products',                     moduleKey: 'inventory' },
      { resource: 'inv-products',        action: 'update',   label: 'Update products',                     moduleKey: 'inventory' },
      { resource: 'inv-products',        action: 'delete',   label: 'Delete / deactivate products',        moduleKey: 'inventory' },
      { resource: 'inv-suppliers',       action: 'view',     label: 'View suppliers',                      moduleKey: 'inventory' },
      { resource: 'inv-suppliers',       action: 'manage',   label: 'Create & manage suppliers',           moduleKey: 'inventory' },
      { resource: 'inv-purchase-orders', action: 'view',     label: 'View purchase orders',                moduleKey: 'inventory' },
      { resource: 'inv-purchase-orders', action: 'create',   label: 'Create purchase orders',              moduleKey: 'inventory' },
      { resource: 'inv-purchase-orders', action: 'receive',  label: 'Receive goods against a PO',          moduleKey: 'inventory' },
      { resource: 'inv-purchase-orders', action: 'cancel',   label: 'Cancel purchase orders',              moduleKey: 'inventory' },
      { resource: 'inv-transfers',       action: 'view',     label: 'View stock transfers',                moduleKey: 'inventory' },
      { resource: 'inv-transfers',       action: 'create',   label: 'Create stock transfers',              moduleKey: 'inventory' },
      { resource: 'inv-transfers',       action: 'dispatch', label: 'Dispatch stock transfers',            moduleKey: 'inventory' },
      { resource: 'inv-transfers',       action: 'receive',  label: 'Receive stock transfers',             moduleKey: 'inventory' },
      { resource: 'inv-stock',           action: 'view',     label: 'View stock movements & ledger',       moduleKey: 'inventory' },
      { resource: 'inv-stock',           action: 'adjust',   label: 'Post manual stock adjustments',       moduleKey: 'inventory' },
      { resource: 'inv-stock',           action: 'writeoff', label: 'Write off damaged / expired stock',   moduleKey: 'inventory' },
      { resource: 'inv-tills',           action: 'view',     label: 'View tills / registers',              moduleKey: 'inventory' },
      { resource: 'inv-tills',           action: 'manage',   label: 'Create & manage tills',               moduleKey: 'inventory' },
      { resource: 'inv-reports',         action: 'view',     label: 'View inventory reports & valuation',  moduleKey: 'inventory' },
      { resource: 'inv-reports',         action: 'export',   label: 'Export inventory reports',            moduleKey: 'inventory' },
    ],
  },

  // ─── Point of Sale ───────────────────────────────────────────────────────────
  {
    id: 'pos',
    label: 'Point of Sale (POS)',
    permissions: [
      { resource: 'pos-terminal',  action: 'view',    label: 'Open the POS terminal',                moduleKey: 'inventory' },
      { resource: 'pos-terminal',  action: 'sell',    label: 'Record sales at POS',                  moduleKey: 'inventory' },
      { resource: 'pos-terminal',  action: 'void',    label: 'Void POS sales',                       moduleKey: 'inventory' },
      { resource: 'pos-sessions',  action: 'view',    label: 'View POS sessions',                    moduleKey: 'inventory' },
      { resource: 'pos-sessions',  action: 'open',    label: 'Open a POS session / shift',           moduleKey: 'inventory' },
      { resource: 'pos-sessions',  action: 'close',   label: 'Close a POS session / shift',          moduleKey: 'inventory' },
      { resource: 'pos-sales',     action: 'view',    label: 'View sales history',                   moduleKey: 'inventory' },
      { resource: 'pos-sales',     action: 'export',  label: 'Export sales reports',                 moduleKey: 'inventory' },
      { resource: 'pos-reports',   action: 'view',    label: 'View POS reports & daily summaries',   moduleKey: 'inventory' },
    ],
  },

  // ─── SMS & Email Communications ─────────────────────────────────────────────
  // No moduleKey — communications is cross-cutting and available to all companies
  {
    id: 'communications',
    label: 'SMS & Email Communications',
    permissions: [
      { resource: 'sms',   action: 'view',   label: 'View SMS logs & history' },
      { resource: 'sms',   action: 'send',   label: 'Send SMS messages' },
      { resource: 'sms',   action: 'manage', label: 'Manage SMS templates & settings' },
      { resource: 'email', action: 'view',   label: 'View email logs & history' },
      { resource: 'email', action: 'send',   label: 'Send email messages' },
      { resource: 'email', action: 'manage', label: 'Manage email templates & settings' },
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
  dashboard:         { view: ['view_dashboard'] },
  companySettings:   { view: ['view_company_settings'], update: ['update_company_settings'] },
  users:             { view: ['view_users'], create: ['create_user'], update: ['update_user'], delete: ['delete_user', 'update_user'], lock: ['lock_user'] },
  properties:        { view: ['view_properties'], create: ['create_property'], update: ['update_property'], delete: ['delete_property'] },
  units:             { view: ['view_units'], create: ['create_unit'], update: ['update_unit'], delete: ['delete_unit'] },
  tenants:           { view: ['view_tenants'], create: ['create_tenant'], update: ['update_tenant'], terminate: ['terminate_tenant'], delete: ['delete_tenant'] },
  leases:            { view: ['view_leases'], create: ['create_lease'], update: ['update_lease'], terminate: ['terminate_lease'] },
  deposits:          { view: ['view_deposits'], create: ['create_deposit'], refund: ['refund_deposit'] },
  takeOnBalances:    { view: ['view_take_on_balances'], create: ['create_take_on_balance'] },
  tenantInvoices:    { view: ['view_invoices'], create: ['create_invoice', 'create_debit_note', 'create_credit_note'], update: ['update_invoice'], reverse: ['reverse_invoice'], delete: ['delete_invoice'], export: ['view_invoices'] },
  receipts:          { view: ['view_receipts'], create: ['record_receipt'], import: ['import_mpesa'], reverse: ['reverse_receipt'], delete: ['delete_receipt'], export: ['view_receipts'] },
  prepayments:       { view: ['view_prepayments'], create: ['record_prepayment'] },
  statements:        { view: ['view_statements'], create: ['create_statement'], approve: ['approve_statement'], update: ['update_statement'], send: ['send_statement'], reverse: ['reverse_statement'], export: ['view_statements'], delete: ['delete_statement'] },
  chartOfAccounts:   { view: ['view_chart_of_accounts'], create: ['create_coa'], update: ['update_coa'], delete: ['delete_coa'] },
  journals:          { view: ['view_reports'], process: ['post_journal'], reverse: ['reverse_journal'] },
  bankReconciliation:{ view: ['view_bank_reconciliation'], process: ['process_bank_reconciliation'] },
  paymentVouchers:   { view: ['view_payment_vouchers'], process: ['post_payment_voucher'], approve: ['approve_payment_voucher'], reverse: ['reverse_payment_voucher'] },
  expenses:          { view: ['view_expenses'], create: ['create_expense'], approve: ['approve_expense'], update: ['update_expense'], delete: ['delete_expense'] },
  pettyCash:         { view: ['view_petty_cash'], create: ['record_petty_cash'], approve: ['approve_petty_cash'] },
  budgets:           { view: ['view_budgets'], create: ['create_budget'], approve: ['approve_budget'] },
  fixedAssets:       { view: ['view_fixed_assets'], create: ['create_fixed_asset'], depreciate: ['run_depreciation'] },
  creditorLedger:    { view: ['view_creditor_ledger'] },
  financialReports:  { view: ['view_reports'], export: ['view_reports'] },
  landlordAdvancements: { view: ['view_advancements'], create: ['create_advancement'] },
  standingOrders:    { view: ['view_standing_orders'], create: ['create_standing_order'] },
  landlordReceipts:  { view: ['view_landlord_receipts'], create: ['record_landlord_receipt'], reverse: ['reverse_landlord_receipt'] },
  landlordPayments:  { view: ['view_statements'], process: ['pay_landlord'], export: ['view_statements'] },
  processedStatements: { view: ['view_processed_statements'], reverse: ['reverse_processed_statement'], send: ['send_processed_statement'], export: ['view_processed_statements'] },
  pmReports:         { view: ['view_pm_reports'], export: ['export_pm_reports'] },
  agedAnalysis:      { view: ['view_aged_analysis'], export: ['export_aged_analysis'] },
  commissionReports: { view: ['view_commission_reports'], export: ['export_commission_reports'] },
  taxReports:        { view: ['view_tax_reports'], export: ['export_tax_reports'] },
  landlords:         { view: ['view_landlords'], create: ['create_landlord'], update: ['update_landlord'], delete: ['delete_landlord'] },
  commissions:       { view: ['view_commissions'], create: ['create_commission'], process: ['process_commission'] },
  maintenances:      { view: ['view_maintenance'], create: ['create_maintenance'], update: ['update_maintenance'], close: ['close_maintenance'], delete: ['delete_maintenance'] },
  inspections:       { view: ['view_inspections'], create: ['create_inspection'], update: ['update_inspection'], close: ['close_inspection'], delete: ['delete_inspection'] },
  propertyExpenses:  { view: ['view_property_expenses'], create: ['create_property_expense'], update: ['update_property_expense'], delete: ['delete_property_expense'] },
  meterReadings:     { view: ['view_meter_readings'], create: ['create_meter_reading'] },
  latePenalties:     { view: ['view_late_penalties'], process: ['apply_late_penalty'] },
  saleListings:      { view: ['view_sale_listings'], create: ['create_sale_listing'], update: ['update_sale_listing'], delete: ['delete_sale_listing'] },
  saleBuyers:        { view: ['view_sale_buyers'], create: ['create_sale_buyer'], update: ['update_sale_buyer'] },
  saleAgents:        { view: ['view_sale_agents'], manage: ['manage_sale_agents'] },
  saleOffers:        { view: ['view_sale_offers'], create: ['create_sale_offer'], approve: ['approve_sale_offer'] },
  saleDeals:         { view: ['view_sale_deals'], create: ['create_sale_deal'], close: ['close_sale_deal'] },
  salePayments:      { view: ['view_sale_payments'], record: ['record_sale_payment'] },
  saleCommissions:   { view: ['view_sale_commissions'], pay: ['pay_sale_commissions'] },
  saleReports:       { view: ['view_sale_reports'], export: ['export_sale_reports'] },
  hrEmployees:       { view: ['view_hr_employees'], create: ['create_hr_employee'], update: ['update_hr_employee'], terminate: ['terminate_hr_employee'] },
  hrLeave:           { view: ['view_hr_leave'], create: ['apply_hr_leave'], approve: ['approve_hr_leave'], manage: ['manage_hr_leave'] },
  hrPayroll:         { view: ['view_hr_payroll'], run: ['run_hr_payroll'], approve: ['approve_hr_payroll'], reverse: ['reverse_hr_payroll'] },
  hrStatutory:       { view: ['view_hr_statutory'], process: ['process_hr_statutory'] },
  hrAppraisals:      { view: ['view_hr_appraisals'], create: ['create_hr_appraisal'], complete: ['complete_hr_appraisal'] },
  hrReports:         { view: ['view_hr_reports'], export: ['export_hr_reports'] },
  hrSetup:           { view: ['view_hr_setup'], manage: ['manage_hr_setup'] },
  'carwash-dashboard':   { view: ['carwash.dashboard.view'] },
  'carwash-jobs':        { view: ['carwash.jobs.view'], create: ['carwash.jobs.create'], update: ['carwash.jobs.update'] },
  'carwash-payments':    { view: ['carwash.payments.view'], record: ['carwash.payments.record'] },
  'carwash-deposits':    { view: ['carwash.deposits.view'], create: ['carwash.deposits.create'], update: ['carwash.deposits.update'] },
  'carwash-expenses':    { view: ['carwash.expenses.view'], create: ['carwash.expenses.create'], update: ['carwash.expenses.update'], delete: ['carwash.expenses.delete'] },
  'carwash-services':    { view: ['carwash.services.view', 'carwash.services.manage'], manage: ['carwash.services.manage'] },
  'carwash-staff':       { view: ['carwash.staff.view', 'carwash.staff.manage'], manage: ['carwash.staff.manage'] },
  'carwash-reports':     { view: ['carwash.reports.view'] },
  'carwash-commissions': { view: ['carwash.commissions.view', 'carwash.commissions.manage', 'carwash.commissions.pay'], manage: ['carwash.commissions.manage'], pay: ['carwash.commissions.pay'] },
  'carwash-loyalty':     { view: ['carwash.loyalty.view', 'carwash.loyalty.manage'], manage: ['carwash.loyalty.manage'] },
  'carwash-branches':    { view: ['carwash.branches.view', 'carwash.branches.manage'], manage: ['carwash.branches.manage'] },
  'carwash-settings':    { view: ['carwash.settings.view', 'carwash.settings.manage'], manage: ['carwash.settings.manage'] },
  'inv-dashboard':       { view: ['inv.dashboard.view'] },
  'inv-locations':       { view: ['inv.locations.view'], manage: ['inv.locations.manage'] },
  'inv-categories':      { view: ['inv.categories.view'], manage: ['inv.categories.manage'] },
  'inv-products':        { view: ['inv.products.view'], create: ['inv.products.create'], update: ['inv.products.update'], delete: ['inv.products.delete'] },
  'inv-suppliers':       { view: ['inv.suppliers.view'], manage: ['inv.suppliers.manage'] },
  'inv-purchase-orders': { view: ['inv.po.view'], create: ['inv.po.create'], receive: ['inv.po.receive'], cancel: ['inv.po.cancel'] },
  'inv-transfers':       { view: ['inv.transfers.view'], create: ['inv.transfers.create'], dispatch: ['inv.transfers.dispatch'], receive: ['inv.transfers.receive'] },
  'inv-stock':           { view: ['inv.stock.view'], adjust: ['inv.stock.adjust'], writeoff: ['inv.stock.writeoff'] },
  'inv-reports':         { view: ['inv.reports.view'], export: ['inv.reports.export'] },
  'pos-terminal':        { view: ['pos.terminal.view'], sell: ['pos.terminal.sell'], void: ['pos.terminal.void'] },
  'pos-sessions':        { view: ['pos.sessions.view'], open: ['pos.sessions.open'], close: ['pos.sessions.close'] },
  'pos-sales':           { view: ['pos.sales.view'], export: ['pos.sales.export'] },
  'pos-reports':         { view: ['pos.reports.view'] },
  sms:                   { view: ['sms.view'], send: ['sms.send'], manage: ['sms.manage'] },
  email:                 { view: ['email.view'], send: ['email.send'], manage: ['email.manage'] },
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

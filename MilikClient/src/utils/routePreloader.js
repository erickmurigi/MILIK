// Route-to-chunk preload map.
// Each entry: [routePrefix, () => import(chunkPath)]
// On hover, call preloadRoute(path) to fetch the chunk before the user clicks.
// Vite deduplicates these with App.jsx's lazy() imports — no extra bundle cost.
const PRELOAD_ENTRIES = [
  // Core
  ['/dashboard',                          () => import('../pages/Dashboard/Dashboard')],
  ['/accounts/dashboard',                 () => import('../pages/Accounts/AccountsDashboard')],

  // Landlords
  ['/landlords',                          () => import('../pages/Landlord/Landlord')],
  ['/landlords/new',                      () => import('../components/Landlord/AddLandlord')],
  ['/landlord-payments',                  () => import('../pages/Landlord/LandlordPayments')],
  ['/landlord-payment-history',           () => import('../pages/Landlord/LandlordPaymentHistory')],
  ['/landlord/statements',                () => import('../pages/Landlord/LandlordCommissionsStatement')],
  ['/financial/landlord-statement',       () => import('../pages/Landlord/LandlordCommissionsStatement')],
  ['/landlord/processed-statements',      () => import('../pages/Landlord/ProcessedStatements')],
  ['/landlord/management-fee-invoices',   () => import('../pages/Landlord/ManagementFeeInvoices')],
  ['/landlords/standing-orders',          () => import('../pages/Landlord/LandlordStandingOrders')],
  ['/landlords/advancement',              () => import('../pages/Landlord/LandlordAdvancements')],
  ['/receipts/landlord',                  () => import('../pages/Landlord/LandlordReceipts')],

  // Properties & Units
  ['/properties',                         () => import('../pages/Properties/Properties')],
  ['/properties/zones',                   () => import('../pages/Properties/Zones')],
  ['/property-expenses',                  () => import('../pages/Properties/PropertyExpenses')],
  ['/properties/commission-settings',     () => import('../pages/Properties/PropertyCommissionSettings')],
  ['/properties/commissions-list',        () => import('../pages/Properties/CommissionsList')],
  ['/units',                              () => import('../pages/Units/Units')],
  ['/units/new',                          () => import('../components/Units/AddUnit')],
  ['/units/space-types',                  () => import('../pages/Lease/Lease')],

  // Tenants
  ['/tenants',                            () => import('../pages/Tenants/Tenants')],
  ['/tenants/terminated',                 () => import('../pages/Tenants/TerminatedTenants')],
  ['/tenant/',                            () => import('../pages/Tenants/AddTenant')],
  ['/tenant/new',                         () => import('../pages/Tenants/AddTenant')],
  ['/tenants/deposits',                   () => import('../pages/Tenants/TenantDeposits')],
  ['/tenants/take-on-balances',           () => import('../pages/Tenants/TakeOnBalances')],
  ['/agreements',                         () => import('../pages/Tenants/TenantAgreements')],
  ['/invoices/rental',                    () => import('../pages/Tenants/RentalInvoices')],
  ['/invoices/notes',                     () => import('../pages/Tenants/InvoiceNotes')],
  ['/invoices/lease-fee',                 () => import('../pages/Tenants/LeaseFeeInvoices')],
  ['/invoices/utility-bills',             () => import('../pages/Tenants/UtilityBills')],
  ['/receipts',                           () => import('../pages/Tenants/Receipts')],
  ['/receipts/new',                       () => import('../pages/Tenants/AddReceipt')],
  ['/receipts/batch',                     () => import('../pages/Tenants/BatchReceipts')],
  ['/receipts/prepayments',               () => import('../pages/Tenants/TenantPrepayments')],
  ['/receipts/mpesa-collections',         () => import('../pages/Tenants/PmsMpesaNotifications')],
  ['/receipts/coop-collections',          () => import('../pages/Tenants/CoopCollections')],

  // Operations
  ['/vacants',                            () => import('../pages/Vacants/Vacants')],
  ['/maintenances',                       () => import('../pages/Maintenances/Maintenances')],
  ['/inspections',                        () => import('../pages/Inspections/Inspections')],
  ['/meter-readings',                     () => import('../pages/Tools/MeterReadings')],
  ['/invoices/late-penalties',            () => import('../pages/Tools/LatePenalties')],

  // Financial
  ['/financial/payment-vouchers',         () => import('../pages/Financial/PaymentVouchers')],
  ['/financial/petty-cash',               () => import('../pages/Financial/PettyCash')],
  ['/financial/journals',                 () => import('../pages/Financial/JournalEntries')],
  ['/financial/chart-of-accounts',        () => import('../pages/Financial/ChartOfAccounts')],
  ['/expenses/requisition',               () => import('../pages/Financial/ExpenseRequisition')],

  // Reports (PMS)
  ['/reports/rental-collection',          () => import('../pages/Reports/RentalCollectionReport')],
  ['/reports/property-income-summary',    () => import('../pages/Reports/PropertyIncomeSummaryReport')],
  ['/reports/mri-tax-summary',            () => import('../pages/Reports/MRITaxSummaryReport')],
  ['/reports/paid-balance',               () => import('../pages/Reports/PaidBalanceReport')],
  ['/reports/aged-analysis',              () => import('../pages/Reports/AgedAnalysisReport')],
  ['/reports/rental-aged-analysis',       () => import('../pages/Reports/RentalAgedAnalysisReport')],
  ['/reports/commissions',                () => import('../pages/Reports/CommissionReports')],
  ['/reports/zone-vacancy',               () => import('../pages/Reports/ZoneVacancyReport')],

  // Accounts module
  ['/accounts/chart-of-accounts',         () => import('../pages/Financial/ChartOfAccounts')],
  ['/accounts/journals',                  () => import('../pages/Financial/JournalEntries')],
  ['/accounts/payment-vouchers',          () => import('../pages/Financial/PaymentVouchers')],
  ['/accounts/petty-cash',                () => import('../pages/Financial/PettyCash')],
  ['/accounts/expenses',                  () => import('../pages/Financial/ExpenseRequisition')],
  ['/accounts/service-providers',         () => import('../pages/Financial/ServiceProviders')],
  ['/accounts/trial-balance',             () => import('../pages/Reports/TrialBalanceReport')],
  ['/accounts/income-statement',          () => import('../pages/Reports/IncomeStatementReport')],
  ['/accounts/balance-sheet',             () => import('../pages/Reports/BalanceSheetReport')],
  ['/accounts/cash-flow',                 () => import('../pages/Reports/CashFlowReport')],
  ['/accounts/tax-reports',               () => import('../pages/Reports/TaxReports')],
  ['/accounts/arrears-aged-analysis',     () => import('../pages/Reports/ArrearsAgedAnalysis')],
  ['/accounts/payment-aged-analysis',     () => import('../pages/Reports/PaymentAgedAnalysis')],
  ['/accounts/liability-subledger',       () => import('../pages/Reports/LiabilitySubledger')],
  ['/accounts/bank-reconciliation',       () => import('../pages/Accounts/BankReconciliation')],
  ['/accounts/fixed-assets',              () => import('../pages/Accounts/FixedAssets')],
  ['/accounts/budget',                    () => import('../pages/Accounts/BudgetVsActual')],
  ['/accounts/creditor-ledger',           () => import('../pages/Accounts/CreditorLedger')],
  ['/accounts/gl-integrity',              () => import('../pages/Accounts/GLIntegrityReport')],
  ['/accounts/vat-remittance',            () => import('../pages/Financial/VatRemittance')],
  ['/accounts/wht-remittance',            () => import('../pages/Financial/WhtRemittance')],
  ['/accounts/accounting-periods',        () => import('../pages/Financial/AccountingPeriods')],
  ['/accounts/year-end-close',            () => import('../pages/Financial/YearEndClose')],
  ['/accounts/financial-ratios',          () => import('../pages/Reports/FinancialRatiosDashboard')],

  // Car Wash
  ['/carwash/dashboard',                  () => import('../pages/CarWash/CarWashDashboard')],
  ['/carwash/jobs',                       () => import('../pages/CarWash/CarWashJobs')],
  ['/carwash/jobs/new',                   () => import('../pages/CarWash/CarWashAddJob')],
  ['/carwash/washboard',                  () => import('../pages/CarWash/CarWashWashboard')],
  ['/carwash/accounts',                   () => import('../pages/CarWash/CarWashAccounts')],
  ['/carwash/services',                   () => import('../pages/CarWash/CarWashServices')],
  ['/carwash/payments',                   () => import('../pages/CarWash/CarWashPayments')],
  ['/carwash/deposits',                   () => import('../pages/CarWash/CarWashDeposits')],
  ['/carwash/expenses',                   () => import('../pages/CarWash/CarWashExpenses')],
  ['/carwash/staff',                      () => import('../pages/CarWash/CarWashStaff')],
  ['/carwash/reports',                    () => import('../pages/CarWash/CarWashReports')],
  ['/carwash/customers',                  () => import('../pages/CarWash/CarWashCustomers')],
  ['/carwash/loyalty',                    () => import('../pages/CarWash/CarWashLoyalty')],
  ['/carwash/mpesa-notifications',        () => import('../pages/CarWash/CarWashMpesaNotifications')],

  // HR
  ['/hr/dashboard',                       () => import('../pages/HR/HRDashboard')],
  ['/hr/employees',                       () => import('../pages/HR/Employees')],
  ['/hr/employees/new',                   () => import('../pages/HR/AddEmployee')],
  ['/hr/setup',                           () => import('../pages/HR/HRSetup')],
  ['/hr/leave',                           () => import('../pages/HR/LeaveApplications')],
  ['/hr/payroll',                         () => import('../pages/HR/PayrollPeriods')],
  ['/hr/statutory',                       () => import('../pages/HR/StatutoryDeductions')],
  ['/hr/appraisals',                      () => import('../pages/HR/Appraisals')],
  ['/hr/attendance',                      () => import('../pages/HR/HRAttendance')],

  // Property Sale
  ['/sale/dashboard',                     () => import('../pages/PropertySale/PropertySaleDashboard')],
  ['/sale/listings',                      () => import('../pages/PropertySale/SaleListings')],
  ['/sale/buyers',                        () => import('../pages/PropertySale/SaleBuyers')],
  ['/sale/agents',                        () => import('../pages/PropertySale/SaleAgents')],
  ['/sale/offers',                        () => import('../pages/PropertySale/SaleOffers')],
  ['/sale/deals',                         () => import('../pages/PropertySale/SaleDeals')],
  ['/sale/payments',                      () => import('../pages/PropertySale/SalePayments')],
  ['/sale/commissions',                   () => import('../pages/PropertySale/SaleCommissions')],
  ['/sale/reports',                       () => import('../pages/PropertySale/SaleReports')],
  ['/sale/crm/leads',                     () => import('../pages/PropertySale/SaleLeads')],
  ['/sale/crm/activities',                () => import('../pages/PropertySale/SaleActivities')],

  // Inventory & POS
  ['/inventory/dashboard',                () => import('../pages/Inventory/InventoryDashboard')],
  ['/inventory/products',                 () => import('../pages/Inventory/InvProducts')],
  ['/inventory/purchase-orders',          () => import('../pages/Inventory/InvPurchaseOrders')],
  ['/inventory/suppliers',                () => import('../pages/Inventory/InvSuppliers')],
  ['/inventory/transfers',                () => import('../pages/Inventory/InvStockTransfers')],
  ['/inventory/adjustments',              () => import('../pages/Inventory/InvStockAdjustments')],
  ['/pos/terminal',                       () => import('../pages/Inventory/POSTerminal')],
  ['/pos/sales',                          () => import('../pages/Inventory/POSSalesHistory')],
];

export function preloadRoute(path) {
  if (!path) return;
  let bestFactory = null;
  let bestLen = 0;
  for (const [prefix, factory] of PRELOAD_ENTRIES) {
    if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) {
      if (prefix.length > bestLen) {
        bestFactory = factory;
        bestLen = prefix.length;
      }
    }
  }
  if (bestFactory) {
    try { bestFactory(); } catch { /* ignore preload errors */ }
  }
}

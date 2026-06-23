const routeNames = {
  '/dashboard': 'Dashboard',
  '/moduleDashboard': 'Choose Module',
  '/system-setup': 'Companies',
  '/system-setup/companies': 'Companies',
  '/system-setup/users': 'Users',
  '/system-setup/rights': 'System Rights',
  '/system-setup/database': 'Database',
  '/system-setup/sessions': 'Sessions',
  '/system-setup/audit': 'Audit Log',
  '/company-setup': 'Company Setup',
  '/add-company': 'New Company',
  '/add-user': 'New User',
  '/properties': 'Properties',
  '/properties/new': 'New Property',
  '/properties/commission-settings': 'Commission Settings',
  '/properties/commissions-list': 'Commission List',
  '/tenants': 'Tenants',
  '/tenants/deposits': 'Tenant Deposits',
  '/tenants/terminated': 'Terminated Tenants',
  '/tenants/take-on-balances': 'Take-On Balances',
  '/agreements': 'Tenant Agreements',
  '/invoices/rental': 'Rental Invoices',
  '/invoices/new': 'New Invoice',
  '/invoices/notes': 'Credit & Debit Notes',
  '/receipts': 'Receipts',
  '/receipts/new': 'New Receipt',
  '/receipts/landlord': 'Landlord Receipts',
  '/receipts/mpesa-collections':  'M-Pesa Collections',
  '/receipts/prepayments': 'Prepayments',
  '/receipts/instant': 'Instant Receipts',
  '/maintenances': 'Maintenance',
  '/inspections': 'Inspections',
  '/landlords': 'Landlords',
  '/landlords/new': 'New Landlord',
  '/landlord-payments': 'Landlord Payments',
  '/landlord/statements': 'Landlord Statements',
  '/landlord/processed-statements': 'Processed Statements',
  '/financial/landlord-statement': 'Landlord Statement',
  '/units': 'Units',
  '/units/new': 'New Unit',
  '/units/space-types': 'Unit Types',
  '/vacants': 'Availability Status',
  '/financial/chart-of-accounts': 'Chart of Accounts',
  '/financial/payment-vouchers': 'Payment Vouchers',
  '/financial/service-providers': 'Service Providers',
  '/expenses/requisition': 'Expense Requisition',
  '/landlords/standing-orders': 'Landlord Standing Orders',
  '/financial/journals': 'Journals',
  '/reports/commissions': 'Commission Reports',
  '/reports/trial-balance': 'Trial Balance',
  '/reports/income-statement': 'Income Statement',
  '/reports/balance-sheet': 'Balance Sheet',
  '/reports/tax-reports': 'Tax Reports',
  '/accounts/dashboard': 'Dashboard',
  '/accounts/chart-of-accounts': 'Chart of Accounts',
  '/accounts/journals': 'Journal Entries',
  '/accounts/payment-vouchers': 'Payment Vouchers',
  '/accounts/petty-cash': 'Petty Cash',
  '/accounts/expenses': 'Expense Requisitions',
  '/accounts/service-providers': 'Service Providers',
  '/accounts/trial-balance': 'Trial Balance',
  '/accounts/income-statement': 'Income Statement',
  '/accounts/balance-sheet': 'Balance Sheet',
  '/accounts/tax-reports': 'Tax Reports',
  '/accounts/cash-flow': 'Cash Flow Statement',
  '/accounts/arrears-aged-analysis': 'Arrears Aged Analysis',
  '/accounts/payment-aged-analysis': 'Payment Aged Analysis',
  '/accounts/bank-reconciliation': 'Bank Reconciliation',
  '/accounts/fixed-assets': 'Asset Register',
  '/accounts/fixed-assets/depreciation': 'Depreciation',
  '/accounts/budget': 'Budget Plans',
  '/accounts/budget/analysis': 'Budget vs Actual',
  '/accounts/creditor-ledger': 'Creditors Ledger',
  '/meter-readings': 'Meter Readings',
  '/invoices/late-penalties': 'Late Penalties',
  '/settings': 'Operational Settings',
  '/communications/sms': 'SMS Manager',
  '/communications/email': 'Email Manager',
  '/carwash/dashboard': 'Dashboard',
  '/carwash/jobs': 'Jobs',
  '/carwash/jobs/new': 'New Job',
  '/carwash/accounts': 'Credit Accounts',
  '/carwash/services': 'Services',
  '/carwash/payments': 'Payments',
  '/carwash/deposits': 'Deposits',
  '/carwash/expenses': 'Expenses',
  '/carwash/financials': 'Financials',
  '/carwash/cashbooks': 'Cashbooks',
  '/carwash/chart-of-accounts': 'Chart of Accounts',
  '/carwash/staff': 'Staff',
  '/carwash/commissions': 'Commissions',
  '/carwash/commissions/payouts': 'Payouts',
  '/carwash/commissions/rules': 'Comm. Rules',
  '/carwash/commissions/savings': 'Staff Savings',
  '/carwash/loyalty': 'Loyalty',
  '/carwash/branches': 'Branches',
  '/carwash/reports': 'Reports',
  '/carwash/reports/services': 'Service Report',
  '/carwash/reports/staff': 'Staff Report',
  '/inventory/dashboard': 'Dashboard',
  '/inventory/locations': 'Locations',
  '/inventory/categories': 'Categories',
  '/inventory/products': 'Products',
  '/inventory/suppliers': 'Suppliers',
  '/inventory/purchase-orders': 'Purchase Orders',
  '/inventory/transfers': 'Transfers',
  '/inventory/stock-movements': 'Stock Movements',
  '/inventory/adjustments': 'Stock Adjustments',
  '/inventory/valuation': 'Stock Valuation',
  '/inventory/tills': 'Tills & Registers',
  '/pos/terminal': 'POS Terminal',
  '/pos/sales': 'Sales History',
  '/pos/sessions': 'Sessions',
  '/hr/dashboard': 'Dashboard',
  '/hr/employees': 'Employees',
  '/hr/employees/new': 'New Employee',
  '/hr/setup': 'Setup',
  '/hr/leave': 'Leave',
  '/hr/leave/types': 'Leave Types',
  '/hr/payroll': 'Payroll',
  '/hr/reports/headcount': 'Headcount Report',
  '/hr/reports/payroll': 'Payroll Summary',
  '/hr/reports/leave': 'Leave Summary',
  '/hr/reports/p9': 'P9 Form',
  '/hr/leave/balances': 'Leave Balances',
  '/hr/statutory': 'Statutory Deductions',
  '/hr/appraisals/kpis': 'KPI Library',
  '/hr/appraisals/cycles': 'Appraisal Cycles',
  '/hr/appraisals': 'Appraisals',
  '/hr/letters': 'HR Letters',
  '/sale/dashboard': 'Dashboard',
  '/sale/listings': 'Sale Listings',
  '/sale/buyers': 'Buyers',
  '/sale/agents': 'Sales Agents',
  '/sale/offers': 'Offers',
  '/sale/deals': 'Deals',
  '/sale/payments': 'Payments',
  '/sale/commissions': 'Commissions',
  '/sale/reports': 'Sales Reports',
  '/sale/financials': 'Financials',
  '/sale/chart-of-accounts': 'Chart of Accounts',
};

export const getPageTitle = (pathname) => {
  if (routeNames[pathname]) return routeNames[pathname];

  if (/^\/hr\/employees\/[^/]+\/edit$/.test(pathname)) return 'Edit Employee';
  if (/^\/hr\/employees\/[^/]+$/.test(pathname)) return 'Employee Profile';
  if (/^\/hr\/payroll\/[^/]+\/payslip\/[^/]+$/.test(pathname)) return 'Payslip';
  if (/^\/hr\/payroll\/[^/]+$/.test(pathname)) return 'Payroll Period';

  const parts = pathname.split('/').filter(Boolean);

  if (pathname.startsWith('/add-company/')) return 'Company Details';
  if (pathname.startsWith('/properties/edit/')) return 'Property Details';
  if (
    pathname === '/tenant/new' ||
    (pathname.startsWith('/tenant/') && pathname.endsWith('/edit'))
  ) return 'Tenant Details';
  if (
    pathname.startsWith('/units/') &&
    pathname !== '/units/new' &&
    parts.length === 2
  ) return 'Unit Details';
  if (
    /^\/(financial|accounts|carwash|hr|sale)\/chart-of-accounts\/.+\/activity$/.test(pathname)
  ) return 'Ledger Activity';

  if (parts.length > 0) {
    const last = parts[parts.length - 1];
    return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ');
  }

  return 'New Tab';
};

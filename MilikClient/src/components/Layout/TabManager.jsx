import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { FaTimes, FaHome, FaPlus, FaWindowClose } from 'react-icons/fa';
import { selectCurrentCompany } from '../../redux/selectors';
import {
  WORKSPACE_IDS,
  getWorkspaceDefaultRoute,
  getWorkspaceDefaultTab,
  getWorkspaceFromRoute,
} from '../../utils/workspaceRoutes';

let tabIdCounter = 0;
const generateUniqueTabId = (prefix = 'tab') => {
  tabIdCounter += 1;
  return `${prefix}-${Date.now()}-${tabIdCounter}`;
};

const TABS_STORAGE_KEY_PREFIX = 'milik-workspace-tabs';
const ACTIVE_STORAGE_KEY_PREFIX = 'milik-active-tabs-by-workspace';

const getTabsStorageKey = (companyKey) => `${TABS_STORAGE_KEY_PREFIX}-${companyKey}`;
const getActiveStorageKey = (companyKey) => `${ACTIVE_STORAGE_KEY_PREFIX}-${companyKey}`;

const buildInitialTabsByWorkspace = () => ({
  [WORKSPACE_IDS.PROPERTY]:       [getWorkspaceDefaultTab(WORKSPACE_IDS.PROPERTY)],
  [WORKSPACE_IDS.ACCOUNTS]:       [getWorkspaceDefaultTab(WORKSPACE_IDS.ACCOUNTS)],
  [WORKSPACE_IDS.CARWASH]:        [getWorkspaceDefaultTab(WORKSPACE_IDS.CARWASH)],
  [WORKSPACE_IDS.INVENTORY]:      [getWorkspaceDefaultTab(WORKSPACE_IDS.INVENTORY)],
  [WORKSPACE_IDS.HUMAN_RESOURCE]: [getWorkspaceDefaultTab(WORKSPACE_IDS.HUMAN_RESOURCE)],
  [WORKSPACE_IDS.PROPERTY_SALE]:  [getWorkspaceDefaultTab(WORKSPACE_IDS.PROPERTY_SALE)],
  [WORKSPACE_IDS.SYSTEM_ADMIN]:   [getWorkspaceDefaultTab(WORKSPACE_IDS.SYSTEM_ADMIN)],
  [WORKSPACE_IDS.COMPANY_SETUP]:  [getWorkspaceDefaultTab(WORKSPACE_IDS.COMPANY_SETUP)],
  [WORKSPACE_IDS.COMMUNICATIONS]: [getWorkspaceDefaultTab(WORKSPACE_IDS.COMMUNICATIONS)],
});

const buildInitialActiveTabs = () => ({
  [WORKSPACE_IDS.PROPERTY]:       'dashboard',
  [WORKSPACE_IDS.ACCOUNTS]:       'acc-dashboard',
  [WORKSPACE_IDS.CARWASH]:        'carwash-dashboard',
  [WORKSPACE_IDS.INVENTORY]:      'inventory-dashboard', 
  [WORKSPACE_IDS.HUMAN_RESOURCE]: 'hr-dashboard',
  [WORKSPACE_IDS.PROPERTY_SALE]:  'sale-dashboard',
  [WORKSPACE_IDS.SYSTEM_ADMIN]:   'system-admin-home',
  [WORKSPACE_IDS.COMPANY_SETUP]:  'company-setup-home',
  [WORKSPACE_IDS.COMMUNICATIONS]: 'communications-home',
});

const getPageTitle = (pathname) => {
  const routeNames = {
    '/dashboard': 'Dashboard',
    '/carwash/dashboard': 'Dashboard',
    '/carwash/jobs': 'Jobs',
    '/carwash/jobs/new': 'New Job',
    '/carwash/jobs/:id/edit': 'Edit Job',
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
    '/carwash/loyalty': 'Loyalty',
    '/carwash/branches': 'Branches',
    '/carwash/reports': 'Reports',
    '/carwash/reports/services': 'Service Report',
    '/carwash/reports/staff': 'Staff Report',
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
    '/receipts/mpesa-import': 'M-Pesa Import',
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
    '/accounts/arrears-aged-analysis':  'Arrears Aged Analysis',
    '/accounts/payment-aged-analysis':  'Payment Aged Analysis',
    '/accounts/bank-reconciliation':    'Bank Reconciliation',
    '/accounts/fixed-assets':              'Asset Register',
    '/accounts/fixed-assets/depreciation': 'Depreciation',
    '/accounts/budget':                    'Budget Plans',
    '/accounts/budget/analysis':           'Budget vs Actual',
    '/accounts/creditor-ledger':           'Creditors Ledger',
    '/meter-readings': 'Meter Readings',
    '/invoices/late-penalties': 'Late Penalties',
    '/settings': 'Operational Settings',
    '/communications/sms':   'SMS Manager',
    '/communications/email': 'Email Manager',
  };

  const inventoryRouteNames = {
    '/inventory/dashboard':      'Dashboard',
    '/inventory/locations':      'Locations',
    '/inventory/categories':     'Categories',
    '/inventory/products':       'Products',
    '/inventory/suppliers':      'Suppliers',
    '/inventory/purchase-orders':'Purchase Orders',
    '/inventory/transfers':      'Transfers',
    '/inventory/stock-movements':'Stock Movements',
    '/inventory/adjustments':   'Stock Adjustments',
    '/inventory/valuation':     'Stock Valuation',
    '/inventory/tills':          'Tills & Registers',
    '/pos/terminal':             'POS Terminal',
    '/pos/sales':                'Sales History',
    '/pos/sessions':             'Sessions',
  };
  if (inventoryRouteNames[pathname]) return inventoryRouteNames[pathname];

  const hrRouteNames = {
    '/hr/dashboard':          'Dashboard',
    '/hr/employees':          'Employees',
    '/hr/employees/new':      'New Employee',
    '/hr/setup':              'Setup',
    '/hr/leave':              'Leave',
    '/hr/leave/types':        'Leave Types',
    '/hr/payroll':            'Payroll',
    '/hr/reports/headcount':  'Headcount Report',
    '/hr/reports/payroll':    'Payroll Summary',
    '/hr/reports/leave':      'Leave Summary',
    '/hr/reports/p9':         'P9 Form',
    '/hr/leave/balances':     'Leave Balances',
    '/hr/statutory':          'Statutory Deductions',
    '/hr/appraisals/kpis':    'KPI Library',
    '/hr/appraisals/cycles':  'Appraisal Cycles',
    '/hr/appraisals':         'Appraisals',
  };
  if (hrRouteNames[pathname]) return hrRouteNames[pathname];
  if (/^\/hr\/employees\/[^/]+\/edit$/.test(pathname)) return 'Edit Employee';
  if (/^\/hr\/employees\/[^/]+$/.test(pathname)) return 'Employee Profile';
  if (/^\/hr\/payroll\/[^/]+\/payslip\/[^/]+$/.test(pathname)) return 'Payslip';
  if (/^\/hr\/payroll\/[^/]+$/.test(pathname)) return 'Payroll Period';

  const saleRouteNames = {
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
  if (saleRouteNames[pathname]) return saleRouteNames[pathname];

  if (routeNames[pathname]) return routeNames[pathname];

  const parts = pathname.split('/').filter(Boolean);
  if (pathname.startsWith('/add-company/')) return 'Company Details';
  if (pathname.startsWith('/properties/edit/')) return 'Property Details';
  if (pathname === '/tenant/new' || pathname.startsWith('/tenant/') && pathname.endsWith('/edit')) {
    return 'Tenant Details';
  }
  if (pathname.startsWith('/units/') && pathname !== '/units/new' && parts.length === 2) {
    return 'Unit Details';
  }
  if (
    (pathname.startsWith('/financial/chart-of-accounts/') ||
     pathname.startsWith('/accounts/chart-of-accounts/') ||
     pathname.startsWith('/carwash/chart-of-accounts/') ||
     pathname.startsWith('/hr/chart-of-accounts/') ||
     pathname.startsWith('/sale/chart-of-accounts/')) &&
    pathname.endsWith('/activity')
  ) {
    return 'Ledger Activity';
  }

  if (parts.length > 0) {
    const lastPart = parts[parts.length - 1];
    return lastPart.charAt(0).toUpperCase() + lastPart.slice(1).replace(/-/g, ' ');
  }

  return 'New Tab';
};

const readTabsByWorkspace = (companyKey) => {
  const saved = localStorage.getItem(getTabsStorageKey(companyKey));
  if (!saved) return buildInitialTabsByWorkspace();

  try {
    const parsed = JSON.parse(saved);
    return {
      ...buildInitialTabsByWorkspace(),
      ...parsed,
    };
  } catch (error) {
    console.error('Failed to parse saved workspace tabs:', error);
    return buildInitialTabsByWorkspace();
  }
};

const readActiveTabsByWorkspace = (companyKey) => {
  const saved = localStorage.getItem(getActiveStorageKey(companyKey));
  if (!saved) return buildInitialActiveTabs();

  try {
    return {
      ...buildInitialActiveTabs(),
      ...JSON.parse(saved),
    };
  } catch (error) {
    console.error('Failed to parse saved active workspace tabs:', error);
    return buildInitialActiveTabs();
  }
};

const TabManager = ({ darkMode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentCompanyKey = String(currentCompany?._id || 'default-company');
  const currentCompanyName = String(currentCompany?.companyName || currentCompany?.name || '').trim();
  const previousCompanyKeyRef = useRef(currentCompanyKey);

  const [tabsByWorkspace, setTabsByWorkspace] = useState(() => readTabsByWorkspace(currentCompanyKey));
  const [activeTabsByWorkspace, setActiveTabsByWorkspace] = useState(() =>
    readActiveTabsByWorkspace(currentCompanyKey)
  );

  useEffect(() => {
    localStorage.setItem(getTabsStorageKey(currentCompanyKey), JSON.stringify(tabsByWorkspace));
  }, [currentCompanyKey, tabsByWorkspace]);

  useEffect(() => {
    localStorage.setItem(
      getActiveStorageKey(currentCompanyKey),
      JSON.stringify(activeTabsByWorkspace)
    );
  }, [currentCompanyKey, activeTabsByWorkspace]);

  const currentWorkspace = useMemo(
    () => getWorkspaceFromRoute(location.pathname),
    [location.pathname]
  );

  useEffect(() => {
    const previousCompanyKey = previousCompanyKeyRef.current;

    if (previousCompanyKey !== currentCompanyKey) {
      const cleanTabs = buildInitialTabsByWorkspace();
      const cleanActiveTabs = buildInitialActiveTabs();

      setTabsByWorkspace(cleanTabs);
      setActiveTabsByWorkspace(cleanActiveTabs);

      localStorage.setItem(getTabsStorageKey(currentCompanyKey), JSON.stringify(cleanTabs));
      localStorage.setItem(getActiveStorageKey(currentCompanyKey), JSON.stringify(cleanActiveTabs));

      previousCompanyKeyRef.current = currentCompanyKey;

      if (location.pathname !== '/dashboard') {
        navigate('/dashboard', { replace: true });
      }

      return;
    }

    previousCompanyKeyRef.current = currentCompanyKey;
  }, [currentCompanyKey, location.pathname, navigate]);

  useEffect(() => {
    const currentPath = location.pathname;
    const requestedTitle = location.state?.tabTitle;
    const workspaceId = getWorkspaceFromRoute(currentPath);

    setTabsByWorkspace((prev) => {
      const workspaceTabs = prev[workspaceId] || [getWorkspaceDefaultTab(workspaceId)];
      const existingTab = workspaceTabs.find((tab) => tab.route === currentPath);

      if (existingTab) {
        const nextTabs =
          requestedTitle && existingTab.title !== requestedTitle
            ? workspaceTabs.map((tab) =>
                tab.id === existingTab.id ? { ...tab, title: requestedTitle } : tab
              )
            : workspaceTabs;

        setActiveTabsByWorkspace((activePrev) => ({
          ...activePrev,
          [workspaceId]: existingTab.id,
        }));

        if (nextTabs === workspaceTabs) return prev;
        return { ...prev, [workspaceId]: nextTabs };
      }

      const isWorkspaceDefaultRoute = currentPath === getWorkspaceDefaultRoute(workspaceId);
      const defaultTabId = getWorkspaceDefaultTab(workspaceId).id;

      if (isWorkspaceDefaultRoute && workspaceTabs.some((tab) => tab.id === defaultTabId)) {
        setActiveTabsByWorkspace((activePrev) => ({
          ...activePrev,
          [workspaceId]: defaultTabId,
        }));
        return prev;
      }

      const newTab = {
        id: generateUniqueTabId(workspaceId),
        title: requestedTitle || getPageTitle(currentPath),
        route: currentPath,
        closable: true,
        timestamp: Date.now(),
      };

      setActiveTabsByWorkspace((activePrev) => ({
        ...activePrev,
        [workspaceId]: newTab.id,
      }));

      return {
        ...prev,
        [workspaceId]: [...workspaceTabs, newTab],
      };
    });
  }, [location.pathname, location.state]);

  const workspaceTabs =
    tabsByWorkspace[currentWorkspace] || [getWorkspaceDefaultTab(currentWorkspace)];
  const activeTab = activeTabsByWorkspace[currentWorkspace] || workspaceTabs[0]?.id;
  const sortedTabs = [...workspaceTabs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const currentTabTitle = useMemo(() => {
    const directMatch = workspaceTabs.find((tab) => tab.route === location.pathname);
    if (directMatch?.title) return directMatch.title;

    const activeMatch = workspaceTabs.find((tab) => tab.id === activeTab);
    if (activeMatch?.title) return activeMatch.title;

    return getPageTitle(location.pathname);
  }, [activeTab, location.pathname, workspaceTabs]);

  useEffect(() => {
    const pageTitle = currentTabTitle || getPageTitle(location.pathname) || 'Milik';
    document.title = currentCompanyName
      ? `${pageTitle} | ${currentCompanyName} | Milik`
      : `${pageTitle} | Milik`;
  }, [currentCompanyName, currentTabTitle, location.pathname]);

  const switchTab = (tabId, route) => {
    setActiveTabsByWorkspace((prev) => ({
      ...prev,
      [currentWorkspace]: tabId,
    }));
    navigate(route);
  };

  const closeTab = (tabId, event) => {
    event?.stopPropagation?.();

    const tabToClose = workspaceTabs.find((tab) => tab.id === tabId);
    if (!tabToClose?.closable) return;

    const nextTabs = workspaceTabs.filter((tab) => tab.id !== tabId);
    const fallbackTabs =
      nextTabs.length > 0 ? nextTabs : [getWorkspaceDefaultTab(currentWorkspace)];
    const fallbackTab = fallbackTabs[fallbackTabs.length - 1];

    setTabsByWorkspace((prev) => ({
      ...prev,
      [currentWorkspace]: fallbackTabs,
    }));

    if (activeTab === tabId) {
      setActiveTabsByWorkspace((prev) => ({
        ...prev,
        [currentWorkspace]: fallbackTab.id,
      }));
      navigate(fallbackTab.route || getWorkspaceDefaultRoute(currentWorkspace));
    }
  };

  const closeAllTabs = () => {
    const defaultTab = getWorkspaceDefaultTab(currentWorkspace);
    setTabsByWorkspace((prev) => ({
      ...prev,
      [currentWorkspace]: [defaultTab],
    }));
    setActiveTabsByWorkspace((prev) => ({
      ...prev,
      [currentWorkspace]: defaultTab.id,
    }));
    navigate(defaultTab.route);
  };

  const addNewDashboardTab = () => {
    if (currentWorkspace !== WORKSPACE_IDS.PROPERTY) return;

    const newTab = {
      id: generateUniqueTabId('dashboard'),
      title: 'Dashboard',
      route: '/dashboard',
      closable: true,
      timestamp: Date.now(),
    };

    setTabsByWorkspace((prev) => ({
      ...prev,
      [WORKSPACE_IDS.PROPERTY]: [...(prev[WORKSPACE_IDS.PROPERTY] || []), newTab],
    }));
    setActiveTabsByWorkspace((prev) => ({
      ...prev,
      [WORKSPACE_IDS.PROPERTY]: newTab.id,
    }));
    navigate('/dashboard');
  };

  return (
    <div
      className={`flex items-center ${
        darkMode ? 'bg-gray-800' : 'bg-[#31694E]'
      } border-b ${
        darkMode ? 'border-gray-700' : 'border-[#1f4a35]'
      } overflow-x-auto shadow-lg`}
    >
      <div className="flex min-h-[30px] items-center px-1.5 py-0.5 space-x-1 min-w-max">
        {sortedTabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center px-2.5 py-1 rounded-t-md cursor-pointer transition-all duration-200 text-sm font-medium border-t border-l border-r ${
              activeTab === tab.id
                ? darkMode
                  ? 'bg-gray-900 text-white border-gray-600 shadow-lg'
                  : 'bg-[#E85C0D] text-white border-[#E85C0D] shadow-lg font-semibold hover:bg-[#d64c06]'
                : darkMode
                  ? 'bg-gray-700 text-gray-300 border-gray-700 hover:bg-gray-600 hover:text-white'
                  : 'bg-[#2a5a47] text-gray-200 border-[#2a5a47] hover:bg-[#337a57] hover:text-white'
            }`}
            onClick={() => switchTab(tab.id, tab.route)}
            title={tab.title}
          >
            {tab.route === '/dashboard' && <FaHome className="mr-1.5 h-3.5 w-3.5" />}
            <span className="text-xs truncate max-w-[160px] uppercase" style={{ textTransform: 'uppercase' }}>{tab.title}</span>
            {tab.closable && sortedTabs.length > 1 && (
              <button
                onClick={(e) => closeTab(tab.id, e)}
                className={`ml-1.5 p-0.5 rounded-full transition-colors duration-200 ${
                  activeTab === tab.id
                    ? 'hover:bg-red-600 hover:text-white text-white'
                    : 'hover:bg-red-500 hover:text-white text-gray-300'
                }`}
                title="Close tab"
              >
                <FaTimes className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        ))}

        {currentWorkspace === WORKSPACE_IDS.PROPERTY && (
          <button
            onClick={addNewDashboardTab}
            className={`ml-1.5 rounded-md px-2 py-1 transition-all duration-200 ${
              darkMode
                ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                : 'text-gray-300 hover:bg-[#2a5a47] hover:text-white'
            }`}
            title="Open new tab"
          >
            <FaPlus className="h-3.5 w-3.5" />
          </button>
        )}

        {sortedTabs.length > 1 && (
          <button
            onClick={closeAllTabs}
            className={`rounded-md px-2 py-1 transition-all duration-200 ${
              darkMode
                ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                : 'text-gray-300 hover:bg-red-600 hover:text-white'
            }`}
            title="Close all tabs"
          >
            <FaWindowClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

export default TabManager;

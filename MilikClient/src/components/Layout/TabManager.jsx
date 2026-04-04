import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { FaTimes, FaHome, FaPlus, FaWindowClose } from 'react-icons/fa';
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
  [WORKSPACE_IDS.PROPERTY]: [getWorkspaceDefaultTab(WORKSPACE_IDS.PROPERTY)],
  [WORKSPACE_IDS.SYSTEM_ADMIN]: [getWorkspaceDefaultTab(WORKSPACE_IDS.SYSTEM_ADMIN)],
  [WORKSPACE_IDS.COMPANY_SETUP]: [getWorkspaceDefaultTab(WORKSPACE_IDS.COMPANY_SETUP)],
});

const buildInitialActiveTabs = () => ({
  [WORKSPACE_IDS.PROPERTY]: 'dashboard',
  [WORKSPACE_IDS.SYSTEM_ADMIN]: 'system-admin-home',
  [WORKSPACE_IDS.COMPANY_SETUP]: 'company-setup-home',
});

const getPageTitle = (pathname) => {
  const routeNames = {
    '/dashboard': 'Dashboard',
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
    '/tenants': 'Tenants',
    '/receipts': 'Receipts',
    '/receipts/new': 'New Receipt',
    '/receipts/mpesa-import': 'M-Pesa Batch Import',
    '/receipts/prepayments': 'Tenant Prepayments',
    '/landlords': 'Landlords',
    '/landlords/standing-orders': 'Landlord Standing Orders',
    '/landlords/new': 'New Landlord',
    '/landlord-payments': 'Landlord Payments',
    '/landlord/statements': 'Landlord Statements',
    '/landlord/processed-statements': 'Processed Statements',
    '/financial/landlord-statement': 'Landlord Statement',
    '/units': 'Units',
    '/units/new': 'New Unit',
    '/units/space-types': 'Unit Types',
    '/financial/chart-of-accounts': 'Chart of Accounts',
    '/financial/payment-vouchers': 'Payment Vouchers',
    '/expenses/requisition': 'Expense Requisition',
    '/financial/journals': 'Journals',
    '/invoices/vat': 'Rental Invoice VAT',
    '/reports/commissions': 'Commission Reports',
    '/reports/rental-aged-analysis': 'Rental Aged Analysis',
    '/reports/trial-balance': 'Trial Balance',
    '/reports/income-statement': 'Income Statement',
    '/reports/balance-sheet': 'Balance Sheet',
    '/reports/tax-reports': 'Tax Reports',
    '/meter-readings': 'Meter Readings',
    '/invoices/late-penalties': 'Late Penalties',
    '/settings': 'Settings',
  };

  if (routeNames[pathname]) return routeNames[pathname];

  const parts = pathname.split('/').filter(Boolean);
  if (pathname.startsWith('/add-company/')) return 'Company Details';
  if (pathname.startsWith('/properties/edit/')) return 'Property Details';
  if (pathname.startsWith('/financial/chart-of-accounts/') && pathname.endsWith('/activity')) {
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
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentCompanyKey = String(currentCompany?._id || 'default-company');
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
      <div className="flex items-center px-2 py-1 space-x-1 min-w-max">
        {sortedTabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center px-3 py-1.5 rounded-t-lg cursor-pointer transition-all duration-200 text-sm font-medium border-t border-l border-r ${
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
            {tab.route === '/dashboard' && <FaHome className="mr-2 w-4 h-4" />}
            <span className="text-xs truncate max-w-[160px]">{tab.title}</span>
            {tab.closable && sortedTabs.length > 1 && (
              <button
                onClick={(e) => closeTab(tab.id, e)}
                className={`ml-2 p-1 rounded-full transition-colors duration-200 ${
                  activeTab === tab.id
                    ? 'hover:bg-red-600 hover:text-white text-white'
                    : 'hover:bg-red-500 hover:text-white text-gray-300'
                }`}
                title="Close tab"
              >
                <FaTimes className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}

        {currentWorkspace === WORKSPACE_IDS.PROPERTY && (
          <button
            onClick={addNewDashboardTab}
            className={`ml-2 px-2.5 py-1.5 rounded-lg transition-all duration-200 ${
              darkMode
                ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                : 'text-gray-300 hover:bg-[#2a5a47] hover:text-white'
            }`}
            title="Open new tab"
          >
            <FaPlus className="w-4 h-4" />
          </button>
        )}

        {sortedTabs.length > 1 && (
          <button
            onClick={closeAllTabs}
            className={`px-2.5 py-1.5 rounded-lg transition-all duration-200 ${
              darkMode
                ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                : 'text-gray-300 hover:bg-red-600 hover:text-white'
            }`}
            title="Close all tabs"
          >
            <FaWindowClose className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default TabManager;

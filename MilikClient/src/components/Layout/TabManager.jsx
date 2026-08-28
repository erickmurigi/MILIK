import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { FaTimes, FaHome, FaChevronLeft, FaChevronRight, FaWindowClose } from 'react-icons/fa';
import { selectCurrentCompany } from '../../redux/selectors';
import {
  WORKSPACE_IDS,
  getWorkspaceDefaultRoute,
  getWorkspaceDefaultTab,
  getWorkspaceFromRoute,
} from '../../utils/workspaceRoutes';
import { getPageTitle } from '../../utils/tabRouteNames';
import { clearTabCache } from '../../hooks/useTabState';

let tabIdCounter = 0;
const generateUniqueTabId = (prefix = 'tab') => {
  tabIdCounter += 1;
  return `${prefix}-${Date.now()}-${tabIdCounter}`;
};

const TABS_STORAGE_KEY_PREFIX   = 'milik-workspace-tabs';
const ACTIVE_STORAGE_KEY_PREFIX = 'milik-active-tabs-by-workspace';
const MAX_CLOSABLE_TABS = 15;
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

const getTabsStorageKey   = (k) => `${TABS_STORAGE_KEY_PREFIX}-${k}`;
const getActiveStorageKey = (k) => `${ACTIVE_STORAGE_KEY_PREFIX}-${k}`;

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

const pruneTabList = (tabs, now) =>
  Array.isArray(tabs)
    ? tabs.filter((t) => !t.closable || !t.lastAccessed || now - t.lastAccessed < STALE_MS)
    : [];

const readTabsByWorkspace = (companyKey) => {
  const saved = localStorage.getItem(getTabsStorageKey(companyKey));
  if (!saved) return buildInitialTabsByWorkspace();

  try {
    const parsed = JSON.parse(saved);
    const now    = Date.now();
    const base   = buildInitialTabsByWorkspace();

    for (const [wsId, tabs] of Object.entries(parsed)) {
      const pruned = pruneTabList(tabs, now);
      base[wsId]   = pruned.length > 0 ? pruned : [getWorkspaceDefaultTab(wsId)];
    }
    return base;
  } catch {
    return buildInitialTabsByWorkspace();
  }
};

const readActiveTabsByWorkspace = (companyKey) => {
  const saved = localStorage.getItem(getActiveStorageKey(companyKey));
  if (!saved) return buildInitialActiveTabs();

  try {
    return { ...buildInitialActiveTabs(), ...JSON.parse(saved) };
  } catch {
    return buildInitialActiveTabs();
  }
};

const TabManager = ({ darkMode }) => {
  const location           = useLocation();
  const navigate           = useNavigate();
  const currentCompany     = useSelector(selectCurrentCompany);
  const currentCompanyKey  = String(currentCompany?._id || 'default-company');
  const currentCompanyName = String(currentCompany?.companyName || currentCompany?.name || '').trim();
  const previousCompanyKeyRef = useRef(currentCompanyKey);
  const locationPathRef = useRef(location.pathname);

  const [tabsByWorkspace, setTabsByWorkspace] = useState(() => readTabsByWorkspace(currentCompanyKey));
  const [activeTabsByWorkspace, setActiveTabsByWorkspace] = useState(() =>
    readActiveTabsByWorkspace(currentCompanyKey)
  );

  // Ref so the route-sync effect can read current tabs without adding it as a dep
  const tabsByWorkspaceRef = useRef(tabsByWorkspace);
  useEffect(() => { tabsByWorkspaceRef.current = tabsByWorkspace; });

  const pendingRouteRef = useRef(null);
  const [isNavigating, setIsNavigating] = useState(false);

  const scrollRef  = useRef(null);
  const tabRefs    = useRef({});
  const [scrollState, setScrollState] = useState({ left: false, right: false });

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollState({
      left:  el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [checkScroll]);

  const scrollTabs = useCallback((dir) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -160 : 160, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    localStorage.setItem(getTabsStorageKey(currentCompanyKey), JSON.stringify(tabsByWorkspace));
  }, [currentCompanyKey, tabsByWorkspace]);

  useEffect(() => {
    localStorage.setItem(getActiveStorageKey(currentCompanyKey), JSON.stringify(activeTabsByWorkspace));
  }, [currentCompanyKey, activeTabsByWorkspace]);

  const currentWorkspace = useMemo(
    () => getWorkspaceFromRoute(location.pathname),
    [location.pathname]
  );

  useEffect(() => { locationPathRef.current = location.pathname; }, [location.pathname]);

  // Clear the pending-navigation indicator once the route actually commits.
  useEffect(() => {
    if (!pendingRouteRef.current) return;
    pendingRouteRef.current = null;
    setIsNavigating(false);
  }, [location.pathname]);

  // Reset tabs and navigate to module picker whenever the active company changes.
  useEffect(() => {
    if (previousCompanyKeyRef.current === currentCompanyKey) return;

    const cleanTabs       = buildInitialTabsByWorkspace();
    const cleanActiveTabs = buildInitialActiveTabs();

    setTabsByWorkspace(cleanTabs);
    setActiveTabsByWorkspace(cleanActiveTabs);
    localStorage.setItem(getTabsStorageKey(currentCompanyKey),   JSON.stringify(cleanTabs));
    localStorage.setItem(getActiveStorageKey(currentCompanyKey), JSON.stringify(cleanActiveTabs));

    previousCompanyKeyRef.current = currentCompanyKey;
    if (locationPathRef.current !== '/moduleDashboard') {
      navigate('/moduleDashboard', { replace: true });
    }
  }, [currentCompanyKey, navigate]);

  // Sync route navigation → tab state.
  // State updates are kept outside functional updaters so that side-effect-free
  // updaters are never called with embedded setState (StrictMode double-invoke safe).
  useEffect(() => {
    const currentPath    = location.pathname;
    const requestedTitle = location.state?.tabTitle;
    const workspaceId    = getWorkspaceFromRoute(currentPath);
    const now            = Date.now();
    const workspaceTabs  = tabsByWorkspaceRef.current[workspaceId] || [getWorkspaceDefaultTab(workspaceId)];
    const existingTab    = workspaceTabs.find((tab) => tab.route === currentPath);

    if (existingTab) {
      const updated = workspaceTabs.map((tab) =>
        tab.id === existingTab.id
          ? {
              ...tab,
              lastAccessed: now,
              ...(requestedTitle && tab.title !== requestedTitle ? { title: requestedTitle } : {}),
            }
          : tab
      );
      setTabsByWorkspace((prev) => ({ ...prev, [workspaceId]: updated }));
      setActiveTabsByWorkspace((a) => ({ ...a, [workspaceId]: existingTab.id }));
      return;
    }

    const isDefault    = currentPath === getWorkspaceDefaultRoute(workspaceId);
    const defaultTabId = getWorkspaceDefaultTab(workspaceId).id;

    if (isDefault && workspaceTabs.some((tab) => tab.id === defaultTabId)) {
      setActiveTabsByWorkspace((a) => ({ ...a, [workspaceId]: defaultTabId }));
      return;
    }

    const newTab = {
      id:           generateUniqueTabId(workspaceId),
      title:        requestedTitle || getPageTitle(currentPath),
      route:        currentPath,
      closable:     true,
      timestamp:    now,
      lastAccessed: now,
    };

    const withNew     = [...workspaceTabs, newTab];
    const nonClosable = withNew.filter((t) => !t.closable);
    const closable    = withNew
      .filter((t) => t.closable)
      .sort((a, b) => (b.lastAccessed || b.timestamp || 0) - (a.lastAccessed || a.timestamp || 0));
    const nextTabs = [...nonClosable, ...closable.slice(0, MAX_CLOSABLE_TABS)];

    setTabsByWorkspace((prev) => ({ ...prev, [workspaceId]: nextTabs }));
    setActiveTabsByWorkspace((a) => ({ ...a, [workspaceId]: newTab.id }));
  }, [location.pathname, location.state]);

  const workspaceTabs = tabsByWorkspace[currentWorkspace] || [getWorkspaceDefaultTab(currentWorkspace)];
  const activeTab     = activeTabsByWorkspace[currentWorkspace] || workspaceTabs[0]?.id;
  const sortedTabs    = useMemo(
    () => [...workspaceTabs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
    [workspaceTabs]
  );

  useEffect(() => { checkScroll(); }, [sortedTabs, checkScroll]);

  // Auto-scroll the active tab chip into view whenever the active tab changes.
  useEffect(() => {
    const el        = tabRefs.current[activeTab];
    const container = scrollRef.current;
    if (!el || !container) return;
    const tabLeft      = el.offsetLeft;
    const tabRight     = el.offsetLeft + el.offsetWidth;
    const containerLeft  = container.scrollLeft;
    const containerRight = container.scrollLeft + container.clientWidth;
    if (tabLeft < containerLeft) {
      container.scrollLeft = tabLeft - 8;
    } else if (tabRight > containerRight) {
      container.scrollLeft = tabRight - container.clientWidth + 8;
    }
    checkScroll();
  }, [activeTab, checkScroll]);

  const currentTabTitle = useMemo(() => {
    const direct = workspaceTabs.find((t) => t.route === location.pathname);
    if (direct?.title) return direct.title;
    const active = workspaceTabs.find((t) => t.id === activeTab);
    if (active?.title) return active.title;
    return getPageTitle(location.pathname);
  }, [activeTab, location.pathname, workspaceTabs]);

  useEffect(() => {
    const title = currentTabTitle || getPageTitle(location.pathname) || 'Milik';
    document.title = currentCompanyName
      ? `${title} | ${currentCompanyName} | Milik`
      : `${title} | Milik`;
  }, [currentCompanyName, currentTabTitle, location.pathname]);

  const switchTab = useCallback((tabId, route) => {
    if (route === location.pathname) return;
    const now = Date.now();
    pendingRouteRef.current = route;
    setIsNavigating(true);
    setTabsByWorkspace((prev) => ({
      ...prev,
      [currentWorkspace]: (prev[currentWorkspace] || []).map((t) =>
        t.id === tabId ? { ...t, lastAccessed: now } : t
      ),
    }));
    setActiveTabsByWorkspace((prev) => ({ ...prev, [currentWorkspace]: tabId }));
    navigate(route);
  }, [currentWorkspace, navigate, location.pathname]);

  const closeTab = useCallback((tabId, event) => {
    event?.stopPropagation?.();
    const closingTab = workspaceTabs.find((t) => t.id === tabId);
    if (!closingTab?.closable) return;
    if (closingTab.route) clearTabCache(closingTab.route);

    const nextTabs = workspaceTabs.filter((t) => t.id !== tabId);
    const fallback = nextTabs.length > 0 ? nextTabs : [getWorkspaceDefaultTab(currentWorkspace)];

    setTabsByWorkspace((prev) => ({ ...prev, [currentWorkspace]: fallback }));

    if (activeTab === tabId) {
      const idx     = sortedTabs.findIndex((t) => t.id === tabId);
      const nextTab = sortedTabs[idx - 1] || sortedTabs[idx + 1] || fallback[0];
      setActiveTabsByWorkspace((prev) => ({ ...prev, [currentWorkspace]: nextTab.id }));
      navigate(nextTab.route || getWorkspaceDefaultRoute(currentWorkspace));
    }
  }, [workspaceTabs, activeTab, sortedTabs, currentWorkspace, navigate]);

  const closeAllTabs = useCallback(() => {
    workspaceTabs.filter((t) => t.closable && t.route).forEach((t) => clearTabCache(t.route));
    const defaultTab = getWorkspaceDefaultTab(currentWorkspace);
    setTabsByWorkspace((prev) => ({ ...prev, [currentWorkspace]: [defaultTab] }));
    setActiveTabsByWorkspace((prev) => ({ ...prev, [currentWorkspace]: defaultTab.id }));
    navigate(defaultTab.route);
  }, [currentWorkspace, navigate, workspaceTabs]);

  const scrollBtnCls = darkMode
    ? 'flex-shrink-0 px-2 py-2 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors duration-150'
    : 'flex-shrink-0 px-2 py-2 text-gray-300 hover:text-white hover:bg-[#2a5a47] transition-colors duration-150';

  return (
    <div
      className={`relative flex items-center border-b shadow-lg overflow-hidden ${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-[#31694E] border-[#1f4a35]'
      }`}
    >
      {scrollState.left && (
        <button onClick={() => scrollTabs('left')} className={scrollBtnCls} title="Scroll left">
          <FaChevronLeft className="h-3 w-3" />
        </button>
      )}

      <div
        ref={scrollRef}
        onScroll={checkScroll}
        className="flex-1 overflow-x-auto"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <div className="flex min-h-[26px] items-center px-1.5 py-0.5 gap-0.5 min-w-max">
          {sortedTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <div
                key={tab.id}
                ref={(el) => { if (el) tabRefs.current[tab.id] = el; else delete tabRefs.current[tab.id]; }}
                onClick={() => switchTab(tab.id, tab.route)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(tab.id, tab.route); } }}
                tabIndex={0}
                role="tab"
                aria-selected={isActive}
                title={tab.title}
                className={`flex items-center px-2 py-0.5 rounded-t-md cursor-pointer transition-all duration-150 border-t border-l border-r select-none outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${
                  isActive
                    ? darkMode
                      ? 'bg-gray-900 text-white border-gray-600 font-semibold shadow-md'
                      : 'bg-[#E85C0D] text-white border-[#c94d09] font-semibold shadow-md'
                    : darkMode
                      ? 'bg-gray-700 text-gray-300 border-gray-700 font-medium hover:bg-gray-600 hover:text-white'
                      : 'bg-[#2a5a47] text-gray-200 border-[#2a5a47] font-medium hover:bg-[#337a57] hover:text-white'
                }`}
              >
                {tab.route === '/dashboard' && (
                  <FaHome className="mr-1 h-3 w-3 flex-shrink-0" />
                )}
                <span className="text-[11px] uppercase truncate max-w-[130px]">{tab.title}</span>
                {tab.closable && sortedTabs.length > 1 && (
                  <button
                    onClick={(e) => closeTab(tab.id, e)}
                    className={`ml-1 p-0.5 rounded-full flex-shrink-0 transition-colors duration-150 ${
                      isActive
                        ? 'text-white hover:bg-red-600'
                        : 'text-gray-300 hover:bg-red-500 hover:text-white'
                    }`}
                    title="Close tab"
                    type="button"
                  >
                    <FaTimes className="h-2 w-2" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {scrollState.right && (
        <button onClick={() => scrollTabs('right')} className={scrollBtnCls} title="Scroll right">
          <FaChevronRight className="h-3 w-3" />
        </button>
      )}

      {sortedTabs.length > 1 && (
        <button
          onClick={closeAllTabs}
          className={`${scrollBtnCls} hover:!bg-red-600 hover:!text-white`}
          title="Close all tabs"
          type="button"
        >
          <FaWindowClose className="h-3.5 w-3.5" />
        </button>
      )}

      {isNavigating && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-400 animate-pulse pointer-events-none" />
      )}
    </div>
  );
};

export default TabManager;

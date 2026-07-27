import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { FaHome, FaTimes, FaCog, FaBuilding, FaCar, FaHandshake, FaUsers, FaBook, FaBoxes, FaSms } from 'react-icons/fa';
import { selectCurrentCompany } from '../../redux/selectors';
import {
  WORKSPACE_IDS,
  getWorkspaceDefaultRoute,
  getWorkspaceFromRoute,
} from '../../utils/workspaceRoutes';
import { hasCompanyModule } from '../../utils/companyModules';
import { clearAllTabCache } from '../../hooks/useTabState';

const MODULES = {
  [WORKSPACE_IDS.PROPERTY]: {
    id: WORKSPACE_IDS.PROPERTY,
    moduleKey: 'propertyManagement',
    title: 'Property Management',
    route: '/dashboard',
    icon: <FaHome className="w-4 h-4" />,
    closable: true,
  },
  [WORKSPACE_IDS.ACCOUNTS]: {
    id: WORKSPACE_IDS.ACCOUNTS,
    moduleKey: 'accounts',
    title: 'Financial Accounts',
    route: '/accounts/dashboard',
    icon: <FaBook className="w-4 h-4" />,
    closable: true,
  },
  [WORKSPACE_IDS.PROPERTY_SALE]: {
    id: WORKSPACE_IDS.PROPERTY_SALE,
    moduleKey: 'propertySale',
    title: 'Property Sales',
    route: '/sale/dashboard',
    icon: <FaHandshake className="w-4 h-4" />,
    closable: true,
  },
  [WORKSPACE_IDS.INVENTORY]: {
    id: WORKSPACE_IDS.INVENTORY,
    moduleKey: 'inventory',
    title: 'Inventory & POS',
    route: '/inventory/dashboard',
    icon: <FaBoxes className="w-4 h-4" />,
    closable: true,
  },
  [WORKSPACE_IDS.CARWASH]: {
    id: WORKSPACE_IDS.CARWASH,
    moduleKey: 'carwash',
    title: 'MILIK Car Wash',
    route: '/carwash/dashboard',
    icon: <FaCar className="w-4 h-4" />,
    closable: true,
  },
  [WORKSPACE_IDS.HUMAN_RESOURCE]: {
    id: WORKSPACE_IDS.HUMAN_RESOURCE,
    moduleKey: 'hr',
    title: 'Human Resource',
    route: '/hr/dashboard',
    icon: <FaUsers className="w-4 h-4" />,
    closable: true,
  },
  [WORKSPACE_IDS.SYSTEM_ADMIN]: {
    id: WORKSPACE_IDS.SYSTEM_ADMIN,
    title: 'System Admin',
    route: '/system-setup/overview',
    icon: <FaCog className="w-4 h-4" />,
    closable: true,
  },
  [WORKSPACE_IDS.COMPANY_SETUP]: {
    id: WORKSPACE_IDS.COMPANY_SETUP,
    title: 'Company Setup',
    route: '/company-setup',
    icon: <FaBuilding className="w-4 h-4" />,
    closable: true,
  },
  [WORKSPACE_IDS.COMMUNICATIONS]: {
    id: WORKSPACE_IDS.COMMUNICATIONS,
    title: 'Communications',
    route: '/communications/sms',
    icon: <FaSms className="w-4 h-4" />,
    closable: true,
  },
};

const MODULES_STORAGE_KEY_PREFIX = 'milik-open-modules';
const ACTIVE_MODULE_STORAGE_KEY_PREFIX = 'milik-active-module';

const getModulesStorageKey = (companyKey) => `${MODULES_STORAGE_KEY_PREFIX}-${companyKey}`;
const getActiveModuleStorageKey = (companyKey) =>
  `${ACTIVE_MODULE_STORAGE_KEY_PREFIX}-${companyKey}`;

const isCompanyWorkspaceAllowed = (company, workspaceId) => {
  const moduleKey = MODULES[workspaceId]?.moduleKey;
  if (!moduleKey) return true;
  if (!company?._id) return workspaceId === WORKSPACE_IDS.PROPERTY;
  return hasCompanyModule(company, moduleKey);
};

const sanitizeOpenModules = (modules = [], company) =>
  (Array.isArray(modules) ? modules : []).filter(
    (workspaceId, index, list) =>
      MODULES[workspaceId] &&
      list.indexOf(workspaceId) === index &&
      isCompanyWorkspaceAllowed(company, workspaceId)
  );

const readOpenModules = (companyKey, company) => {
  const saved = localStorage.getItem(getModulesStorageKey(companyKey));
  if (!saved) return [];

  try {
    return sanitizeOpenModules(JSON.parse(saved), company);
  } catch {
    return [];
  }
};

const readActiveModule = (companyKey, company, openModules = []) => {
  const saved = localStorage.getItem(getActiveModuleStorageKey(companyKey));
  if (saved && openModules.includes(saved) && isCompanyWorkspaceAllowed(company, saved)) return saved;
  return openModules[0] || null;
};

const ModuleTabManager = ({ darkMode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentCompanyKey = String(currentCompany?._id || 'default-company');
  const previousCompanyKeyRef = useRef(currentCompanyKey);

  const currentModule = useMemo(() => getWorkspaceFromRoute(location.pathname), [location.pathname]);

  const [openModules, setOpenModules] = useState(() => readOpenModules(currentCompanyKey, currentCompany));
  const [activeModule, setActiveModule] = useState(() =>
    readActiveModule(currentCompanyKey, currentCompany, readOpenModules(currentCompanyKey, currentCompany))
  );

  useEffect(() => {
    localStorage.setItem(getModulesStorageKey(currentCompanyKey), JSON.stringify(openModules));
    localStorage.setItem(getActiveModuleStorageKey(currentCompanyKey), activeModule);
  }, [currentCompanyKey, openModules, activeModule]);

  useEffect(() => {
    if (previousCompanyKeyRef.current === currentCompanyKey) return;

    clearAllTabCache();
    setOpenModules([]);
    setActiveModule(null);

    localStorage.setItem(getModulesStorageKey(currentCompanyKey), JSON.stringify([]));
    localStorage.removeItem(getActiveModuleStorageKey(currentCompanyKey));

    previousCompanyKeyRef.current = currentCompanyKey;
  }, [currentCompanyKey]);

  useEffect(() => {
    if (!currentModule) return;
    if (!isCompanyWorkspaceAllowed(currentCompany, currentModule)) return;

    setOpenModules((prev) => {
      const clean = sanitizeOpenModules(prev, currentCompany);
      return clean.includes(currentModule) ? clean : [...clean, currentModule];
    });
    setActiveModule(currentModule);
  }, [currentCompany, currentModule, location.pathname, navigate]);

  const switchModule = (moduleId) => {
    const config = MODULES[moduleId];
    if (!config) return;
    if (!isCompanyWorkspaceAllowed(currentCompany, moduleId)) return;

    setActiveModule(moduleId);
    navigate(config.route || getWorkspaceDefaultRoute(moduleId));
  };

  const closeModule = (moduleId) => {
    if (!MODULES[moduleId]?.closable) return;
    clearAllTabCache();

    const nextModules = openModules.filter((id) => id !== moduleId);
    setOpenModules(nextModules);

    if (moduleId === activeModule) {
      if (nextModules.length > 0) {
        switchModule(nextModules[0]);
      } else {
        setActiveModule(null);
        navigate('/moduleDashboard');
      }
    }
  };

  const visibleModules = useMemo(
    () => sanitizeOpenModules(openModules, currentCompany).map((id) => MODULES[id]).filter(Boolean),
    [currentCompany, openModules]
  );

  if (visibleModules.length === 0) return null;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 border-t shadow-lg ${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-[#1a472a] border-[#0d3320]'
      } flex items-center px-3 py-1 gap-1.5 overflow-x-auto`}
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {visibleModules.map((module) => {
        const isActive = activeModule === module.id;
        return (
          <div
            key={module.id}
            onClick={() => switchModule(module.id)}
            title={module.title}
            className={`flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer whitespace-nowrap transition-all duration-150 text-sm font-medium border-t-2 ${
              isActive
                ? darkMode
                  ? 'bg-gray-700 text-white border-orange-400 shadow-md'
                  : 'bg-[#2d5a4a] text-white border-[#E85C0D] shadow-md'
                : darkMode
                  ? 'bg-gray-900 text-gray-400 border-transparent hover:bg-gray-800 hover:text-gray-200'
                  : 'bg-[#163d26] text-gray-400 border-transparent hover:bg-[#2d5a4a] hover:text-gray-200'
            }`}
          >
            <span className={`flex-shrink-0 ${isActive ? 'text-current' : 'opacity-60'}`}>
              {module.icon}
            </span>
            <span className="text-xs uppercase truncate max-w-[130px]">{module.title}</span>
            {module.closable && (
              <button
                onClick={(e) => { e.stopPropagation(); closeModule(module.id); }}
                className="ml-0.5 p-0.5 rounded-full flex-shrink-0 text-gray-500 hover:bg-red-600 hover:text-white transition-colors duration-150"
                title="Close module"
              >
                <FaTimes className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ModuleTabManager;

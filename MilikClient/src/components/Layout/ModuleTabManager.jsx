import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { FaHome, FaTimes, FaCog, FaBuilding, FaCar, FaHandshake, FaUsers, FaBook, FaBoxes } from 'react-icons/fa';
import {
  WORKSPACE_IDS,
  getWorkspaceDefaultRoute,
  getWorkspaceFromRoute,
} from '../../utils/workspaceRoutes';
import { hasCompanyModule } from '../../utils/companyModules';

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
  const currentCompany = useSelector((state) => state.company?.currentCompany);
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
    const previousCompanyKey = previousCompanyKeyRef.current;

    if (previousCompanyKey !== currentCompanyKey) {
      setOpenModules([]);
      setActiveModule(null);

      localStorage.setItem(getModulesStorageKey(currentCompanyKey), JSON.stringify([]));
      localStorage.removeItem(getActiveModuleStorageKey(currentCompanyKey));

      previousCompanyKeyRef.current = currentCompanyKey;
      return;
    }

    previousCompanyKeyRef.current = currentCompanyKey;
  }, [currentCompany, currentCompanyKey, location.pathname, navigate]);

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
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-[#1a472a] border-gray-400'
      } flex items-center px-3 py-1.5 gap-2 overflow-x-auto`}
    >
      {visibleModules.map((module) => (
        <div
          key={module.id}
          className={`flex items-center gap-2 px-2.5 py-1 rounded cursor-pointer whitespace-nowrap transition text-sm font-medium ${
            activeModule === module.id
              ? darkMode
                ? 'bg-gray-700 text-white'
                : 'bg-[#0f766e] text-white'
              : darkMode
              ? 'bg-gray-900 text-gray-400 hover:bg-gray-800'
              : 'bg-[#2d5a4a] text-gray-200 hover:bg-[#3a6d58]'
          }`}
          onClick={() => switchModule(module.id)}
        >
          <span className="flex-shrink-0 text-xs">{module.icon}</span>
          <span className="max-w-[150px] truncate uppercase" style={{ textTransform: 'uppercase' }}>{module.title}</span>
          {module.closable && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                closeModule(module.id);
              }}
              className={`ml-1 p-0.5 rounded hover:bg-red-600 ${
                darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-300 hover:text-white'
              }`}
              title="Close module"
            >
              <FaTimes className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default ModuleTabManager;

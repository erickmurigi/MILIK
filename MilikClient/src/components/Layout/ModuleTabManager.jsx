import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { FaHome, FaTimes, FaCog, FaBuilding } from 'react-icons/fa';
import {
  WORKSPACE_IDS,
  getWorkspaceDefaultRoute,
  getWorkspaceFromRoute,
} from '../../utils/workspaceRoutes';

const MODULES = {
  [WORKSPACE_IDS.PROPERTY]: {
    id: WORKSPACE_IDS.PROPERTY,
    title: 'Property Management',
    route: '/dashboard',
    icon: <FaHome className="w-4 h-4" />,
    closable: false,
  },
  [WORKSPACE_IDS.SYSTEM_ADMIN]: {
    id: WORKSPACE_IDS.SYSTEM_ADMIN,
    title: 'System Admin',
    route: '/system-setup/companies',
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

const readOpenModules = (companyKey) => {
  const saved = localStorage.getItem(getModulesStorageKey(companyKey));
  if (!saved) return [WORKSPACE_IDS.PROPERTY];

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) && parsed.length ? parsed : [WORKSPACE_IDS.PROPERTY];
  } catch (error) {
    console.error('Failed to parse saved open modules:', error);
    return [WORKSPACE_IDS.PROPERTY];
  }
};

const readActiveModule = (companyKey) => {
  return localStorage.getItem(getActiveModuleStorageKey(companyKey)) || WORKSPACE_IDS.PROPERTY;
};

const ModuleTabManager = ({ darkMode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentCompanyKey = String(currentCompany?._id || 'default-company');
  const previousCompanyKeyRef = useRef(currentCompanyKey);

  const currentModule = useMemo(() => getWorkspaceFromRoute(location.pathname), [location.pathname]);

  const [openModules, setOpenModules] = useState(() => readOpenModules(currentCompanyKey));
  const [activeModule, setActiveModule] = useState(() => readActiveModule(currentCompanyKey));

  useEffect(() => {
    localStorage.setItem(getModulesStorageKey(currentCompanyKey), JSON.stringify(openModules));
    localStorage.setItem(getActiveModuleStorageKey(currentCompanyKey), activeModule);
  }, [currentCompanyKey, openModules, activeModule]);

  useEffect(() => {
    const previousCompanyKey = previousCompanyKeyRef.current;

    if (previousCompanyKey !== currentCompanyKey) {
      const cleanModules = [WORKSPACE_IDS.PROPERTY];
      const cleanActiveModule = WORKSPACE_IDS.PROPERTY;

      setOpenModules(cleanModules);
      setActiveModule(cleanActiveModule);

      localStorage.setItem(getModulesStorageKey(currentCompanyKey), JSON.stringify(cleanModules));
      localStorage.setItem(getActiveModuleStorageKey(currentCompanyKey), cleanActiveModule);

      previousCompanyKeyRef.current = currentCompanyKey;

      if (location.pathname !== '/dashboard') {
        navigate('/dashboard', { replace: true });
      }

      return;
    }

    previousCompanyKeyRef.current = currentCompanyKey;
  }, [currentCompanyKey, location.pathname, navigate]);

  useEffect(() => {
    setOpenModules((prev) => (prev.includes(currentModule) ? prev : [...prev, currentModule]));
    setActiveModule(currentModule);
  }, [currentModule]);

  const switchModule = (moduleId) => {
    const config = MODULES[moduleId];
    if (!config) return;

    setActiveModule(moduleId);
    navigate(config.route || getWorkspaceDefaultRoute(moduleId));
  };

  const closeModule = (moduleId) => {
    if (!MODULES[moduleId]?.closable) return;

    const nextModules = openModules.filter((id) => id !== moduleId);
    setOpenModules(nextModules);

    if (moduleId === activeModule) {
      const nextModule = nextModules[0] || WORKSPACE_IDS.PROPERTY;
      switchModule(nextModule);
    }
  };

  const visibleModules = useMemo(
    () => openModules.map((id) => MODULES[id]).filter(Boolean),
    [openModules]
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
          <span className="max-w-[150px] truncate">{module.title}</span>
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
// pages/ModulesDashboard/ModulesDashboard.jsx
import React, { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { selectCurrentUser, selectCurrentCompany } from "../../redux/selectors";
import {
  FaAddressBook,
  FaArrowRight,
  FaBuilding,
  FaCar,
  FaChartLine,
  FaCity,
  FaLock,
  FaUsers,
  FaWarehouse,
} from "react-icons/fa";
import {
  getCompanyOperatingModeLabel,
  hasCompanyModule,
  isSelfManagingLandlordCompany,
} from "../../utils/companyModules";
import StartMenu from "../../components/StartMenu/StartMenu";
import { useTermPresetLabel, useTerm } from "../../hooks/useTerm";

// Accounting is shared by every other module, so it is the one orange tile and always comes last
const SHARED_MODULE_ID = "accounts";

const moduleRegistry = [
  {
    id: "milik",
    moduleKey: "propertyManagement",
    title: "Property Management",
    subtitle: "Leases, Billing & Collections",
    route: "/dashboard",
    icon: FaCity,
  },
  {
    id: "inventory",
    moduleKey: "inventory",
    title: "Inventory",
    subtitle: "Stock & Warehousing",
    route: "/inventory/dashboard",
    icon: FaWarehouse,
  },
  {
    id: "propertySale",
    moduleKey: "propertySale",
    title: "Property Sales",
    subtitle: "Listings & Deals",
    route: "/sale/dashboard",
    icon: FaBuilding,
  },
  {
    id: "carwash",
    moduleKey: "carwash",
    title: "Car Wash",
    subtitle: "Wash Jobs & Staff",
    route: "/carwash/dashboard",
    icon: FaCar,
  },
  {
    id: "hr",
    moduleKey: "hr",
    title: "Human Resource",
    subtitle: "People & Payroll",
    route: "/hr/dashboard",
    icon: FaUsers,
  },
  {
    id: "clients",
    moduleKey: "clients",
    title: "Contract Management",
    subtitle: "Clients, Contracts & Billing",
    route: "/clients/dashboard",
    icon: FaAddressBook,
  },
  {
    id: SHARED_MODULE_ID,
    moduleKey: "accounts",
    title: "Accounting",
    subtitle: "Finance & Reporting",
    route: "/accounts/dashboard",
    icon: FaChartLine,
  },
];

const ModulesDashboard = () => {
  const navigate = useNavigate();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const isFetchingCompany = useSelector((state) => state.company?.isFetching || false);

  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);
  const operatingModeLabel = getCompanyOperatingModeLabel(activeCompanyContext?.companyMode);
  const presetLabel = useTermPresetLabel();
  const companySubtitle = presetLabel || operatingModeLabel;
  const termLandlord = useTerm("landlord");
  const saleModuleName = useTerm("saleModule");

  useEffect(() => {
    const name = String(activeCompanyContext?.companyName || activeCompanyContext?.name || "").trim();
    document.title = name ? `Apps | ${name} | Milik` : "Apps | Milik";
  }, [activeCompanyContext]);

  const visibleModules = useMemo(() => {
    if (!activeCompanyContext) return [];
    return moduleRegistry
      .map((m) => {
        if (m.id === "propertySale") return { ...m, title: saleModuleName };
        if (m.id !== "milik") return m;
        return {
          ...m,
          subtitle: isLandlordMode ? `${termLandlord} Workspace` : m.subtitle,
        };
      })
      .filter((m) => hasCompanyModule(activeCompanyContext, m.moduleKey))
      .sort((a, b) => Number(a.id === SHARED_MODULE_ID) - Number(b.id === SHARED_MODULE_ID));
  }, [activeCompanyContext, isLandlordMode, termLandlord, saleModuleName]);

  const handleOpen = useCallback((m) => {
    const recent = JSON.parse(localStorage.getItem("recentModules") || "[]");
    localStorage.setItem("recentModules", JSON.stringify([m.id, ...recent.filter((id) => id !== m.id)].slice(0, 5)));
    navigate(m.route);
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex h-[52px] flex-shrink-0 items-stretch gap-3 bg-[#0B3B2E] text-white">
        <div className="flex items-center gap-3">
          <StartMenu variant="corner" />
          <img
            src={activeCompanyContext?.logo || "/MIIK CUBES.png"}
            alt={activeCompanyContext?.companyName || "Milik"}
            className="h-8 w-8 flex-shrink-0 bg-white object-contain p-0.5"
          />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-black uppercase tracking-wide">{activeCompanyContext?.companyName || "Milik"}</span>
            {companySubtitle && <span className="truncate text-[11px] font-bold uppercase tracking-wider text-emerald-200">{companySubtitle}</span>}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {isFetchingCompany && visibleModules.length === 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border border-slate-200 bg-white" aria-hidden="true">
                <div className="h-14 animate-pulse bg-slate-200" />
                <div className="space-y-2 px-3 py-3">
                  <div className="h-2.5 w-3/4 animate-pulse bg-slate-200" />
                  <div className="h-2 w-1/2 animate-pulse bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleModules.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visibleModules.map((m) => {
              const Icon = m.icon;
              const isShared = m.id === SHARED_MODULE_ID;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleOpen(m)}
                  aria-label={`${m.title} — ${m.subtitle}`}
                  className="group flex flex-col overflow-hidden border border-slate-200 bg-white text-left transition hover:border-[#0B3B2E] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8C00]"
                >
                  <div className={`flex h-14 items-center justify-center ${isShared ? "bg-[#FF8C00]" : "bg-[#0B3B2E]"}`}>
                    <Icon className="text-2xl text-white" />
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black uppercase tracking-wide text-slate-900">{m.title}</div>
                      <div className="truncate text-xs font-semibold text-slate-600">{m.subtitle}</div>
                    </div>
                    <FaArrowRight className="flex-shrink-0 text-[10px] text-[#FF8C00] opacity-0 transition group-hover:opacity-100" />
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center bg-slate-100 text-slate-400">
              <FaLock />
            </div>
            <p className="text-sm font-bold text-slate-700">No modules available</p>
            <p className="mt-1 text-sm text-slate-600">No business modules are assigned to this company.</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default React.memo(ModulesDashboard);

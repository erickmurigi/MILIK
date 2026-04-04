import React, { useMemo, useRef, useState } from "react";
import { Toaster } from "react-hot-toast";
import { useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  FaFileInvoice, FaReceipt, FaCoins, FaBook, FaChartBar,
  FaCreditCard, FaExchangeAlt, FaMoneyBillWave, FaHandHolding,
  FaCalendarAlt, FaWallet, FaUniversity, FaCog,
  FaExclamationTriangle, FaCalculator, FaPhone,
  FaFile, FaSave, FaFileExport, FaPrint, FaSignOutAlt,
  FaHome, FaPlus, FaInfo, FaSquare, FaCheck, FaCheckCircle,
  FaUser, FaUsers, FaAddressCard, FaTag, FaClipboard,
  FaHandshake, FaChartLine, FaChartPie, FaFileAlt, FaBalanceScale,
  FaToolbox, FaDatabase, FaWrench, FaHeadset, FaInfoCircle, FaList,
  FaBuilding, FaKey
} from "react-icons/fa";
import "./dashboard.css";
import TabManager from "../../components/Layout/TabManager";
import ModuleTabManager from "../../components/Layout/ModuleTabManager";
import Navbar from "../../components/Dashboard/Navbar";
import StartMenu from "../../components/StartMenu/StartMenu";
import {
  WORKSPACE_IDS,
  getWorkspaceFromRoute,
  getWorkspaceLabel,
} from "../../utils/workspaceRoutes";

const DashboardLayout = ({ children, lockContentScroll = false }) => {
  const [darkMode, setDarkMode] = useState(false);
  const location = useLocation();
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const isCompanySwitching = useSelector((state) => state.company?.isSwitching);
  const [renderTimestamp] = useState(() => Date.now());
  const currentWorkspace = useMemo(() => getWorkspaceFromRoute(location.pathname), [location.pathname]);
  const workspaceLabel = useMemo(() => getWorkspaceLabel(currentWorkspace), [currentWorkspace]);

  const demoBanner = useMemo(() => {
    if (!currentUser?.isDemoUser) return null;

    const expiryDate = currentUser?.demoExpiresAt
      ? new Date(currentUser.demoExpiresAt)
      : null;
    const expiryTimestamp = expiryDate?.getTime?.() || null;
    const hasExpired = Number.isFinite(expiryTimestamp) ? expiryTimestamp <= renderTimestamp : false;
    const daysLeft = expiryDate && !hasExpired
      ? Math.max(
          1,
          Math.ceil((expiryDate.getTime() - renderTimestamp) / (24 * 60 * 60 * 1000))
        )
      : 0;

    return {
      expiryDate,
      daysLeft,
      hasExpired,
    };
  }, [currentUser, renderTimestamp]);

  return (
    <div
      className={`${
        lockContentScroll ? "h-screen overflow-hidden" : "min-h-screen"
      } ${darkMode ? "dark bg-gray-900" : "bg-white"}`}
    >
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: darkMode ? "#374151" : "#FFFFFF",
            color: darkMode ? "#FFFFFF" : "#374151",
            border: `1px solid ${darkMode ? "#4B5563" : "#E5E7EB"}`,
          },
        }}
      />

      <div
        className={`fixed top-0 left-0 right-0 z-50 ${
          darkMode ? "bg-gray-800" : "bg-white"
        } border-b ${darkMode ? "border-gray-700" : "border-gray-200"}`}
      >
        <TopToolbar
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          currentWorkspace={currentWorkspace}
          workspaceLabel={workspaceLabel}
        />
      </div>

      <div className="fixed top-[88px] left-0 right-0 z-40">
        <TabManager darkMode={darkMode} />
      </div>

      <div
        className={`flex flex-1 pt-36 bg-white ${
          lockContentScroll
            ? "h-full min-h-0 overflow-hidden pb-9"
            : "min-h-screen pb-20"
        }`}
      >
        <main
          className={`flex-1 pt-4 overflow-x-hidden bg-white ${
            lockContentScroll
              ? "overflow-y-hidden min-h-0 h-full"
              : "overflow-y-auto min-h-[calc(100vh-9rem)]"
          }`}
        >
          <div
            className={`max-w-full ${
              lockContentScroll ? "h-full min-h-0" : "min-h-[calc(100vh-9rem)]"
            }`}
          >
            {demoBanner && (
              <div className="mx-4 mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="font-extrabold uppercase tracking-[0.18em] text-amber-700">
                      Demo Mode
                    </p>
                    <p className="mt-1 font-semibold text-slate-800">
                      {demoBanner.hasExpired
                        ? "Your demo period has ended. Contact MILIK for activation."
                        : "You are exploring Milik with sample data in a read-only workspace."}
                    </p>
                    <p className="mt-1 text-slate-600">
                      {demoBanner.hasExpired
                        ? "Further demo access now requires activation from the MILIK team."
                        : `Creating, editing, deleting and posting live transactions is disabled until subscription. Access window remaining: ${demoBanner.daysLeft} day${
                            demoBanner.daysLeft === 1 ? "" : "s"
                          }.`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <a
                      href={`mailto:miliksystem@gmail.com?subject=${demoBanner.hasExpired ? "Milik%20Activation%20Request" : "Milik%20Demo%20Upgrade%20Request"}`}
                      className="inline-flex items-center justify-center rounded-full bg-[#0B3B2E] px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:bg-[#0A3127]"
                    >
                      {demoBanner.hasExpired ? "Contact MILIK for activation" : "Subscribe / Book setup"}
                    </a>
                    {demoBanner.expiryDate && !demoBanner.hasExpired && (
                      <div className="inline-flex items-center justify-center rounded-full border border-amber-300 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-800">
                        Ends {demoBanner.expiryDate.toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {isCompanySwitching && (
              <div className="mx-4 mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm shadow-sm">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-extrabold uppercase tracking-[0.18em] text-emerald-700">
                      Switching Company
                    </p>
                    <p className="mt-1 font-semibold text-slate-800">
                      Loading the new workspace and clearing previous company data.
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">
                    <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
                    Please wait
                  </div>
                </div>
              </div>
            )}

            {isCompanySwitching ? (
              <div className="mx-4 rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center shadow-sm">
                <p className="text-sm font-semibold text-slate-700">
                  Preparing the selected company workspace...
                </p>
              </div>
            ) : (
              React.Children.map(children, (child) => {
                if (!React.isValidElement(child)) return child;
                if (typeof child.type === "string") return child;
                return React.cloneElement(child, { darkMode });
              })
            )}
          </div>
        </main>
      </div>

      <ModuleTabManager darkMode={darkMode} />
    </div>
  );
};

const TopToolbar = ({
  darkMode,
  setDarkMode,
  currentWorkspace,
  workspaceLabel,
}) => {
  const [activeMenu, setActiveMenu] = useState(null);
  const [hoveredFinancialItem, setHoveredFinancialItem] = useState(null);
  const hoverCloseTimerRef = useRef(null);
  const navigate = useNavigate();

  const clearHoverCloseTimer = () => {
    if (hoverCloseTimerRef.current) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const openHoveredFinancialItem = (menuId) => {
    clearHoverCloseTimer();
    setHoveredFinancialItem(menuId);
  };

  const closeHoveredFinancialItem = () => {
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setHoveredFinancialItem(null);
      hoverCloseTimerRef.current = null;
    }, 120);
  };

  const isSystemAdminWorkspace = currentWorkspace === WORKSPACE_IDS.SYSTEM_ADMIN;
  const isCompanySetupWorkspace = currentWorkspace === WORKSPACE_IDS.COMPANY_SETUP;

  const routeConfig = useMemo(() => {
    if (isSystemAdminWorkspace) {
      return {
        "new-company": "/add-company",
        "new-user": "/add-user",
        companies: "/system-setup/companies",
        users: "/system-setup/users",
        rights: "/system-setup/rights",
        database: "/system-setup/database",
        sessions: "/system-setup/sessions",
        audit: "/system-setup/audit",
        "company-setup-workspace": "/company-setup",
        "property-workspace": "/dashboard",
      };
    }

    if (isCompanySetupWorkspace) {
      return {
        "company-setup-home": "/company-setup",
        "system-admin-workspace": "/system-setup/companies",
        "property-workspace": "/dashboard",
        settings: "/settings",
      };
    }

    return {
      "landlord-list": "/landlords",
      "add-landlord": "/landlords/new",
      "properties-list": "/properties",
      "add-property": "/properties/new",
      "property-commission-settings": "/properties/commission-settings",
      "commissions-list": "/properties/commissions-list",
      "units-spaces": "/units",
      availability: "/vacants",
      "units-list": "/units",
      "add-unit": "/units/new",
      "space-types": "/units/space-types",
      "tenants-list": "/tenants",
      "add-tenant": "/tenant/new",
      "tenant-agreements": "/agreements",
      "tenant-deposits": "/tenants/deposits",
      "tenant-take-on-balances": "/tenants/take-on-balances",
      "tenant-financing": "/tenants/financing",
      "tenant-journals": "/tenants/journals",
      "payment-vouchers": "/financial/payment-vouchers",
      journals: "/financial/journals",
      "service-providers": "/financial/service-providers",
      "ledger-entries": "/financial/ledger-entries",
      "rental-invoices-list": "/invoices/rental",
      "new-invoice": "/invoices/new",
      "credit-notes": "/invoices/notes?type=credit",
      "debit-notes": "/invoices/notes?type=debit",
      "late-penalties": "/invoices/late-penalties",
      "rental-invoices-vat": "/invoices/vat",
      "withholding-vat": "/invoices/withholding-vat",
      "withholding-tax": "/invoices/withholding-tax",
      "rental-aged-analysis": "/reports/rental-aged-analysis",
      "landlord-invoices": "/invoices/landlord",
      "rental-receipts": "/receipts",
      "mpesa-import": "/receipts/mpesa-import",
      "tenant-prepayments": "/receipts/prepayments",
      "instant-receipts": "/receipts/instant",
      "landlord-receipt": "/receipts/landlord",
      "expense-requisition": "/expenses/requisition",
      "payment-vouchers-list": "/expenses/payment-vouchers",
      "landlord-standing-orders": "/landlords/standing-orders",
      "landlord-advancement": "/landlords/advancement",
      "commission-landlord-statement": "/financial/landlord-statement",
      "processed-statements": "/landlord/processed-statements",
      "landlord-statements": "/landlord/statements",
      "chart-of-accounts": "/financial/chart-of-accounts",
      "rental-collection": "/reports/rental-collection",
      "paid-balance": "/reports/paid-balance",
      "aged-analysis": "/reports/aged-analysis",
      "commission-reports": "/reports/commissions",
      "trial-balance": "/reports/trial-balance",
      "income-statement": "/reports/income-statement",
      "balance-sheet": "/reports/balance-sheet",
      "tax-reports": "/reports/tax-reports",
      settings: "/settings",
      users: "/users",
      backup: "/tools/backup",
      "import-export": "/tools/import-export",
      "meter-readings": "/meter-readings",
      maintenance: "/maintenances",
      inspections: "/inspections",
      documentation: "/help/documentation",
      support: "/help/support",
      about: "/help/about",
    };
  }, [isCompanySetupWorkspace, isSystemAdminWorkspace]);

  const mainMenuItems = useMemo(() => {
    if (isSystemAdminWorkspace) {
      return [
        {
          id: "management",
          label: "Management",
          icon: FaCog,
          submenu: [
            { id: "companies", label: "Companies", icon: FaHome },
            { id: "users", label: "Users", icon: FaUsers },
            { id: "rights", label: "System Rights", icon: FaKey },
            { type: "separator" },
            { id: "database", label: "Database", icon: FaDatabase },
            { id: "sessions", label: "Sessions", icon: FaCalendarAlt },
            { id: "audit", label: "Audit Log", icon: FaClipboard },
          ],
        },
        {
          id: "workspace",
          label: "Workspace",
          icon: FaBuilding,
          submenu: [
            { id: "company-setup-workspace", label: "Company Setup", icon: FaBuilding },
            { id: "property-workspace", label: "Property Management", icon: FaHome },
          ],
        },
      ];
    }

    if (isCompanySetupWorkspace) {
      return [
        {
          id: "company",
          label: "Company",
          icon: FaBuilding,
          submenu: [
            { id: "company-setup-home", label: "Company Setup", icon: FaBuilding },
            { id: "settings", label: "Settings", icon: FaCog },
          ],
        },
        {
          id: "workspace",
          label: "Workspace",
          icon: FaCog,
          submenu: [
            { id: "system-admin-workspace", label: "System Admin", icon: FaCog },
            { id: "property-workspace", label: "Property Management", icon: FaHome },
          ],
        },
      ];
    }

    return [
      {
        id: "landlord",
        label: "Landlords",
        icon: FaUser,
        submenu: [
          { id: "landlord-list", label: "Landlord Listing", icon: FaUser },
          { id: "add-landlord", label: "Add New Landlord", icon: FaPlus },
          { id: "landlord-details", label: "Landlord Details", icon: FaAddressCard },
        ],
      },
      {
        id: "properties",
        label: "Properties",
        icon: FaHome,
        submenu: [
          { id: "properties-list", label: "Properties Listing", icon: FaHome },
          { id: "add-property", label: "Add New Property", icon: FaPlus },
          { type: "separator" },
          { id: "property-commission-settings", label: "Commission Settings", icon: FaCog },
          { id: "commissions-list", label: "Commission List", icon: FaList },
          { type: "separator" },
          { id: "units-spaces", label: "Units/Spaces Management", icon: FaSquare },
          { id: "availability", label: "Availability Status", icon: FaCheck },
        ],
      },
      {
        id: "units",
        label: "Units",
        icon: FaSquare,
        submenu: [
          { id: "units-list", label: "Units Listing", icon: FaSquare },
          { id: "add-unit", label: "Add New Unit", icon: FaPlus },
          { id: "space-types", label: "Unit Types", icon: FaTag },
        ],
      },
      {
        id: "tenants",
        label: "Tenants",
        icon: FaUsers,
        submenu: [
          { id: "tenants-list", label: "Tenants Listing", icon: FaUsers },
          { id: "add-tenant", label: "New Tenant", icon: FaPlus },
          { type: "separator" },
          { id: "tenant-deposits", label: "Tenants Deposits", icon: FaCoins },
          { id: "tenant-agreements", label: "Tenant Agreements", icon: FaClipboard },
          { id: "tenant-take-on-balances", label: "Take-On Balances", icon: FaMoneyBillWave },
          { id: "tenant-financing", label: "Tenants Financing", icon: FaReceipt },
          { id: "tenant-journals", label: "Tenants Journals", icon: FaClipboard },
        ],
      },
      {
        id: "financial",
        label: "Financial",
        icon: FaMoneyBillWave,
        submenu: [
          { id: "rental-invoicing", label: "Rental Invoicing", hasSubmenu: true, icon: FaFileInvoice, category: "invoicing", categoryColor: "#4F46E5" },
          { id: "rental-receipting", label: "Rental Receipting", hasSubmenu: true, icon: FaReceipt, category: "receipting", categoryColor: "#10B981" },
          { type: "separator" },
          { id: "payment-vouchers", label: "Payment Vouchers", icon: FaCreditCard, category: "expenses", categoryColor: "#FF8C00" },
          { id: "expenses", label: "Expenses", hasSubmenu: true, icon: FaMoneyBillWave, category: "expenses", categoryColor: "#FF8C00" },
          { id: "landlord-payments", label: "Landlord Payments", hasSubmenu: true, icon: FaHandHolding, category: "landlord", categoryColor: "#8B5CF6" },
          { id: "service-providers", label: "Service Providers", icon: FaCog, category: "landlord", categoryColor: "#8B5CF6" },
          { type: "separator" },
          { id: "chart-of-accounts", label: "Chart of Accounts", icon: FaBook, category: "ledger", categoryColor: "#0B3B2E" },
          { id: "journals", label: "Journals", icon: FaBook, category: "ledger", categoryColor: "#0B3B2E" },
          { id: "ledger-entries", label: "Ledger Entries", icon: FaBook, category: "ledger", categoryColor: "#0B3B2E" },
        ],
      },
      {
        id: "reports",
        label: "Reports",
        icon: FaChartBar,
        submenu: [
          { id: "rental-collection", label: "Rental Collection Report", icon: FaChartBar },
          { id: "paid-balance", label: "Paid & Balance Report", icon: FaChartLine },
          { id: "aged-analysis", label: "Aged Analysis", icon: FaChartPie },
          { type: "separator" },
          { id: "commission-reports", label: "Commission Reports", icon: FaMoneyBillWave },
          { id: "trial-balance", label: "Trial Balance", icon: FaBook },
          { id: "income-statement", label: "Income Statement", icon: FaFileAlt },
          { id: "balance-sheet", label: "Balance Sheet", icon: FaBalanceScale },
          { id: "tax-reports", label: "Tax Reports", icon: FaCalculator },
        ],
      },
      {
        id: "tools",
        label: "Tools",
        icon: FaToolbox,
        submenu: [
          { id: "settings", label: "Settings", icon: FaCog },
          { id: "users", label: "Users", icon: FaUsers },
          { id: "backup", label: "Backup/Restore", icon: FaDatabase },
          { id: "import-export", label: "Import/Export", icon: FaExchangeAlt },
          { type: "separator" },
          { id: "meter-readings", label: "Meter Readings", icon: FaCog },
          { id: "maintenance", label: "Maintenance Management", icon: FaWrench },
          { id: "inspections", label: "Inspections", icon: FaClipboard },
        ],
      },
      {
        id: "help",
        label: "Help",
        icon: FaInfoCircle,
        submenu: [
          { id: "documentation", label: "Documentation", icon: FaBook },
          { id: "support", label: "Support", icon: FaHeadset },
          { id: "about", label: "About", icon: FaInfoCircle },
        ],
      },
    ];
  }, [isCompanySetupWorkspace, isSystemAdminWorkspace]);

  const nestedSubmenus = useMemo(() => {
    if (isSystemAdminWorkspace || isCompanySetupWorkspace) {
      return {};
    }

    return {
      "rental-invoicing": [
        { id: "rental-invoices-list", label: "Rental Invoices", icon: FaFileInvoice },
        { id: "new-invoice", label: "Create New Invoice", icon: FaFileInvoice },
        { id: "credit-notes", label: "Credit Notes", icon: FaFileInvoice },
        { id: "debit-notes", label: "Debit Notes", icon: FaFileInvoice },
        { id: "late-penalties", label: "Late Penalties - Invoices", icon: FaExclamationTriangle },
        { type: "separator" },
        { id: "rental-invoices-vat", label: "Rental Invoices V.A.T", icon: FaFileInvoice },
        { id: "withholding-vat", label: "Withholding V.A.T", icon: FaCalculator },
        { id: "withholding-tax", label: "Withholding Tax", icon: FaCalculator },
        { id: "rental-aged-analysis", label: "Rental Aged Analysis", icon: FaChartBar },
        { id: "landlord-invoices", label: "Landlord Invoices", icon: FaFileInvoice },
      ],
      "rental-receipting": [
        { id: "rental-receipts", label: "Rental Receipts", icon: FaReceipt },
        { id: "mpesa-import", label: "M-Pesa Batch Import", icon: FaPhone },
        { id: "tenant-prepayments", label: "Tenants Prepayments", icon: FaCoins },
        { id: "instant-receipts", label: "Instant Receipts", icon: FaReceipt },
        { id: "landlord-receipt", label: "Landlord Receipt", icon: FaReceipt },
      ],
      expenses: [
        { id: "expense-requisition", label: "Expense Requisition", icon: FaFileInvoice },
        { id: "payment-vouchers-list", label: "Payment Vouchers", icon: FaMoneyBillWave },
      ],
      "landlord-payments": [
        { id: "landlord-standing-orders", label: "Landlord Standing Orders", icon: FaCalendarAlt },
        { id: "landlord-advancement", label: "Landlord Advancement", icon: FaMoneyBillWave },
        { id: "commission-landlord-statement", label: "Commissions & LL Statement", icon: FaFileAlt },
        { id: "processed-statements", label: "Processed Statements (Legacy)", icon: FaCheckCircle },
      ],
    };
  }, [isCompanySetupWorkspace, isSystemAdminWorkspace]);

  const handleMenuItemClick = (menuId) => {
    const route = routeConfig[menuId];
    if (route) {
      navigate(route);
      setActiveMenu(null);
      clearHoverCloseTimer();
                    setHoveredFinancialItem(null);
    }
  };

  const menuColorMap = {
    properties: { color: "#3B82F6", label: "Properties", icon: FaHome },
    landlord: { color: "#F59E0B", label: "Landlords", icon: FaUser },
    units: { color: "#8B5CF6", label: "Units & Spaces", icon: FaSquare },
    tenants: { color: "#EC4899", label: "Tenants", icon: FaUsers },
    reports: { color: "#10B981", label: "Reports & Analytics", icon: FaChartBar },
    tools: { color: "#06B6D4", label: "Tools & Settings", icon: FaToolbox },
    help: { color: "#8B5CF6", label: "Help & Support", icon: FaInfoCircle },
    "rental-invoicing": { color: "#4F46E5", label: "Rental Invoicing", icon: FaFileInvoice },
    "rental-receipting": { color: "#10B981", label: "Rental Receipting", icon: FaReceipt },
    expenses: { color: "#FF8C00", label: "Expenses", icon: FaMoneyBillWave },
    "landlord-payments": { color: "#8B5CF6", label: "Landlord Payments", icon: FaHandHolding },
  };

  const ProfessionalDropdown = ({ menuId, items }) => {
    const menuInfo = menuColorMap[menuId] || {
      color: "#0B3B2E",
      label: menuId.toUpperCase(),
      icon: FaCog,
    };
    const MenuIcon = menuInfo.icon;

    return (
      <div
        className={`absolute left-full top-0 w-96 shadow-2xl z-50 rounded-lg overflow-hidden border pointer-events-auto ${
          darkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-100"
        }`}
        style={{ marginLeft: "0px" }}
        onMouseEnter={() => openHoveredFinancialItem(menuId)}
        onMouseLeave={closeHoveredFinancialItem}
      >
        <div
          style={{ backgroundColor: menuInfo.color }}
          className="px-5 py-4 text-white flex items-center space-x-3"
        >
          <MenuIcon size={22} className="flex-shrink-0" />
          <div>
            <h3 className="text-sm font-bold leading-tight">{menuInfo.label}</h3>
            <p className="text-xs opacity-90">Quick Access</p>
          </div>
        </div>

        <div className={`${darkMode ? "bg-gray-800" : "bg-white"} max-h-96 overflow-y-auto`}>
          {items.map((item, idx) => (
            <React.Fragment key={item.id || `sep-${idx}`}>
              {item.type === "separator" ? (
                <div className={`h-px ${darkMode ? "bg-gray-700" : "bg-gray-200"} mx-3 my-2`} />
              ) : (
                <button
                  onClick={() => {
                    handleMenuItemClick(item.id);
                    clearHoverCloseTimer();
                    setHoveredFinancialItem(null);
                  }}
                  className={`w-full text-left px-5 py-3 text-sm font-medium flex items-center space-x-3 transition-all duration-150 border-l-4 ${
                    darkMode
                      ? "text-gray-200 hover:bg-gray-700 hover:text-white border-l-transparent"
                      : "text-gray-700 hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent border-l-transparent"
                  }`}
                >
                  {item.icon && (
                    <span
                      className="flex-shrink-0 transition-transform duration-150"
                      style={{ color: "#FF8C00" }}
                    >
                      <item.icon size={16} />
                    </span>
                  )}
                  <div className="flex-1">
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <span className={`ml-2 text-xs ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
                        {item.shortcut}
                      </span>
                    )}
                  </div>
                  <span className="text-xs opacity-50 transition-opacity" style={{ color: menuInfo.color }}>
                    →
                  </span>
                </button>
              )}
            </React.Fragment>
          ))}
        </div>

        <div style={{ backgroundColor: menuInfo.color }} className="h-1.5" />
      </div>
    );
  };

  const FinancialDropdown = ({ categoryId, items }) => {
    const category = menuColorMap[categoryId] || {
      color: "#0B3B2E",
      label: "Financial",
      icon: FaBook,
    };

    return (
      <div
        className={`absolute left-full top-0 w-96 shadow-2xl z-50 rounded-lg overflow-hidden border pointer-events-auto ${
          darkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-100"
        }`}
        style={{ marginLeft: "0px" }}
        onMouseEnter={() => openHoveredFinancialItem(categoryId)}
        onMouseLeave={closeHoveredFinancialItem}
      >
        <div
          style={{ backgroundColor: category.color }}
          className="px-5 py-4 text-white flex items-center space-x-3"
        >
          <category.icon size={22} className="flex-shrink-0" />
          <div>
            <h3 className="text-sm font-bold leading-tight">{category.label}</h3>
            <p className="text-xs opacity-90">Financial Operations</p>
          </div>
        </div>

        <div className={`${darkMode ? "bg-gray-800" : "bg-white"} max-h-96 overflow-y-auto`}>
          {items.map((item, idx) => (
            <React.Fragment key={item.id || `sep-${idx}`}>
              {item.type === "separator" ? (
                <div className={`h-px ${darkMode ? "bg-gray-700" : "bg-gray-200"} mx-3 my-2`} />
              ) : (
                <button
                  onClick={() => {
                    handleMenuItemClick(item.id);
                    clearHoverCloseTimer();
                    setHoveredFinancialItem(null);
                  }}
                  className={`w-full text-left px-5 py-3 text-sm font-medium flex items-center space-x-3 transition-all duration-150 border-l-4 ${
                    darkMode
                      ? "text-gray-200 hover:bg-gray-700 hover:text-white border-l-transparent"
                      : "text-gray-700 hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent border-l-transparent"
                  }`}
                >
                  {item.icon && (
                    <span
                      className="flex-shrink-0 transition-transform duration-150"
                      style={{ color: category.color }}
                    >
                      <item.icon size={16} />
                    </span>
                  )}
                  <span>{item.label}</span>
                  <span className="text-xs opacity-50 transition-opacity" style={{ color: category.color }}>
                    →
                  </span>
                </button>
              )}
            </React.Fragment>
          ))}
        </div>

        <div style={{ backgroundColor: category.color }} className="h-1.5" />
      </div>
    );
  };

  const renderMenuItem = (item, index) => {
    if (item.type === "separator") {
      return (
        <div
          key={`sep-${index}`}
          className={`h-px ${darkMode ? "bg-gray-700" : "bg-gray-200"} my-1`}
        />
      );
    }

    if (item.hasSubmenu) {
      return (
        <div
          key={item.id}
          className="relative"
          onMouseEnter={() => openHoveredFinancialItem(item.id)}
          onMouseLeave={closeHoveredFinancialItem}
        >
          <button
            className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-all duration-200 ${
              darkMode
                ? "text-gray-300 hover:bg-gray-700 hover:text-white"
                : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            <div className="flex items-center space-x-3">
              {item.icon && (
                <span
                  style={{
                    color: activeMenu === "financial"
                      ? (item.categoryColor || "#666")
                      : "#FF8C00",
                  }}
                  className="transition-transform duration-200"
                >
                  <item.icon size={16} />
                </span>
              )}
              <span>{item.label}</span>
            </div>
            <span className="text-xs">▶</span>
          </button>

          {hoveredFinancialItem === item.id && nestedSubmenus[item.id] && (
            <div
              className="absolute left-full top-0 w-2 h-full pointer-events-auto"
              onMouseEnter={() => openHoveredFinancialItem(item.id)}
              onMouseLeave={closeHoveredFinancialItem}
            />
          )}

          {nestedSubmenus[item.id] && hoveredFinancialItem === item.id && (
            activeMenu === "financial" ? (
              <FinancialDropdown categoryId={item.id} items={nestedSubmenus[item.id]} />
            ) : (
              <ProfessionalDropdown menuId={item.id} items={nestedSubmenus[item.id]} />
            )
          )}
        </div>
      );
    }

    return (
      <button
        key={item.id}
        onClick={() => handleMenuItemClick(item.id)}
        className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-all duration-200 ${
          darkMode
            ? "text-gray-300 hover:bg-gray-700 hover:text-white"
            : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
        }`}
      >
        <div className="flex items-center space-x-3">
          {item.icon && (
            <span
              style={{
                color: activeMenu === "financial"
                  ? (item.categoryColor || "#666")
                  : "#FF8C00",
              }}
              className="transition-transform duration-200"
            >
              <item.icon size={16} />
            </span>
          )}
          <span>{item.label}</span>
        </div>
        {item.shortcut && (
          <span className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
            {item.shortcut}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="relative bg-[#a5c9b7]">
      <Navbar darkMode={darkMode} setDarkMode={setDarkMode} workspaceLabel={workspaceLabel} />
      <StartMenu darkMode={darkMode} />

      <div className={`flex items-center ${darkMode ? "bg-gray-800" : "bg-[#0A400C]"}`}>
        <div className="px-2 py-1 border-r border-white/10 flex items-center justify-center">
          <img
            src="/logo.png"
            alt="Milik Logo"
            className="h-8 w-auto object-contain"
          />
        </div>

        {mainMenuItems.map((item) => (
          <div key={item.id} className="relative group">
            <button
              onClick={() => {
                setActiveMenu(activeMenu === item.id ? null : item.id);
              }}
              className={`px-4 py-2 text-sm font-bold text-white transition-colors ${
                activeMenu === item.id
                  ? darkMode
                    ? "bg-gray-700 text-white"
                    : "bg-emerald-700 text-white"
                  : darkMode
                    ? "text-gray-300 hover:bg-gray-700 hover:text-white"
                    : "text-gray-100 hover:bg-emerald-700 hover:text-white"
              }`}
            >
              {item.label}
            </button>

            {activeMenu === item.id && item.submenu && (
              <div
                className={`absolute left-0 top-full mt-0 w-64 shadow-lg z-50 border ${
                  darkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                }`}
              >
                {item.submenu.map((subItem, index) => (
                  <React.Fragment key={subItem.id || `submenu-${item.id}-${index}`}>
                    {renderMenuItem(subItem, index)}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="flex-1" />

        <div className="flex items-center space-x-1 px-4 py-1 text-xs">
          <button
            onClick={() => navigate("/tenants/new")}
            className={`p-2 rounded ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="New Tenant"
          >
            + Tenant
          </button>
          <button
            onClick={() => navigate("/invoices/new")}
            className={`p-2 rounded ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="New Invoice"
          >
            + Invoice
          </button>
          <button
            onClick={() => navigate("/receipts")}
            className={`p-2 rounded ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="Receive Payment"
          >
            + Payment
          </button>
          <div className={`h-6 w-px ${darkMode ? "bg-gray-600" : "bg-gray-300"} mx-2`} />
          <button
            onClick={() => window.location.reload()}
            className={`p-2 rounded ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="Refresh"
          >
            ↻
          </button>
          <button
            onClick={() => navigate("/settings")}
            className={`p-2 rounded ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </div>

      {activeMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setActiveMenu(null)}
        />
      )}
    </div>
  );
};

export default DashboardLayout;
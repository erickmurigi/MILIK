import React, { useMemo, useRef, useState } from "react";
import { Toaster } from "react-hot-toast";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
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
  FaBuilding, FaKey, FaUserSlash, FaRedoAlt
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
import { isSelfManagingLandlordCompany } from "../../utils/companyModules";
import { hasCompanyPermission } from "../../utils/permissions";

const MENU_PERMISSION_MAP = {
  "properties-list": { resource: "properties", action: "view", moduleKey: "propertyManagement" },
  "add-property": { resource: "properties", action: "create", moduleKey: "propertyManagement" },
  "property-commission-settings": { resource: "properties", action: "update", moduleKey: "propertyManagement" },
  "commissions-list": { resource: "properties", action: "view", moduleKey: "propertyManagement" },
  availability: { resource: "units", action: "view", moduleKey: "propertyManagement" },
  "units-spaces": { resource: "units", action: "view", moduleKey: "propertyManagement" },
  "units-list": { resource: "units", action: "view", moduleKey: "propertyManagement" },
  "add-unit": { resource: "units", action: "create", moduleKey: "propertyManagement" },
  "space-types": { resource: "units", action: "view", moduleKey: "propertyManagement" },
  "tenants-list": { resource: "tenants", action: "view", moduleKey: "propertyManagement" },
  "add-tenant": { resource: "tenants", action: "create", moduleKey: "propertyManagement" },
  "tenant-deposits": { resource: "tenants", action: "view", moduleKey: "propertyManagement" },
  "terminated-tenants": { resource: "tenants", action: "view", moduleKey: "propertyManagement" },
  "tenant-take-on-balances": { resource: "tenants", action: "view", moduleKey: "propertyManagement" },
  "rental-invoices-list": { resource: "tenantInvoices", action: "view", moduleKey: "propertyManagement" },
  "new-invoice": { resource: "tenantInvoices", action: "create", moduleKey: "propertyManagement" },
  "credit-debit-notes": { resource: "tenantInvoices", action: "update", moduleKey: "propertyManagement" },
  "late-penalties": { resource: "latePenalties", action: "view", moduleKey: "propertyManagement" },
  "rental-receipts": { resource: "receipts", action: "view", moduleKey: "propertyManagement" },
  "mpesa-import": { resource: "receipts", action: "create", moduleKey: "propertyManagement" },
  "tenant-prepayments": { resource: "receipts", action: "view", moduleKey: "propertyManagement" },
  "instant-receipts": { resource: "receipts", action: "create", moduleKey: "propertyManagement" },
  "landlord-receipt": { resource: "receipts", action: "view", moduleKey: "propertyManagement" },
  "payment-vouchers": { resource: "paymentVouchers", action: "view", moduleKey: "accounts" },
  expenses: { resource: "expenses", action: "view", moduleKey: "accounts" },
  "service-providers": { resource: "expenses", action: "view", moduleKey: "accounts" },
  "landlord-payments": { resource: "landlordPayments", action: "view", moduleKey: "accounts" },
  "chart-of-accounts": { resource: "chartOfAccounts", action: "view", moduleKey: "accounts" },
  journals: { resource: "journals", action: "view", moduleKey: "accounts" },
  "landlord-statements": { resource: "statements", action: "view", moduleKey: "propertyManagement" },
  "processed-statements": { resource: "processedStatements", action: "view", moduleKey: "accounts" },
  "rental-collection": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "paid-balance": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "aged-analysis": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "commission-reports": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "trial-balance": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "income-statement": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "balance-sheet": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "tax-reports": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  settings: { resource: "companySettings", action: "view" },
  "meter-readings": { resource: "meterReadings", action: "view", moduleKey: "propertyManagement" },
  maintenance: { resource: "maintenances", action: "view", moduleKey: "propertyManagement" },
  inspections: { resource: "inspections", action: "view", moduleKey: "propertyManagement" },
};

const filterMenuByPermissions = (items = [], currentUser = {}, activeCompany = null) =>
  items
    .map((item) => {
      if (!Array.isArray(item?.submenu)) return item;
      const submenu = item.submenu.filter((entry) => {
        if (!entry || entry.type === "separator" || !entry.id) return true;
        const rule = MENU_PERMISSION_MAP[entry.id];
        if (!rule) return true;
        return hasCompanyPermission(currentUser, activeCompany, rule.resource, rule.action, rule.moduleKey);
      });
      const cleaned = submenu.filter((entry, index) => {
        if (entry?.type !== "separator") return true;
        const prev = submenu[index - 1];
        const next = submenu[index + 1];
        return prev && prev.type !== "separator" && next && next.type !== "separator";
      });
      return cleaned.length ? { ...item, submenu: cleaned } : null;
    })
    .filter(Boolean);

const DashboardLayout = ({ children, lockContentScroll = false }) => {
  const [darkMode, setDarkMode] = useState(false);
  const location = useLocation();
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const isCompanySwitching = useSelector((state) => state.company?.isSwitching);
  const [renderTimestamp] = useState(() => Date.now());
  const currentWorkspace = useMemo(() => getWorkspaceFromRoute(location.pathname), [location.pathname]);
  const workspaceLabel = useMemo(() => getWorkspaceLabel(currentWorkspace), [currentWorkspace]);
  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode = useMemo(
    () => isSelfManagingLandlordCompany(activeCompanyContext),
    [activeCompanyContext]
  );

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
        lockContentScroll ? "h-screen overflow-hidden flex flex-col" : "min-h-screen"
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
      <ToastContainer
        position="top-right"
        autoClose={4000}
        newestOnTop
        closeOnClick
        pauseOnHover
        draggable
        theme={darkMode ? "dark" : "light"}
      />

      <div
        className={`sticky top-0 left-0 right-0 z-50 flex-shrink-0 ${
          darkMode ? "bg-gray-800" : "bg-white"
        } border-b ${darkMode ? "border-gray-700" : "border-gray-200"}`}
      >
        <TopToolbar
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          currentWorkspace={currentWorkspace}
          workspaceLabel={workspaceLabel}
          isLandlordMode={isLandlordMode}
          currentUser={currentUser}
          activeCompanyContext={activeCompanyContext}
        />
        <div className={`${darkMode ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-white"} border-t`}>
          <div className="max-w-full overflow-x-auto overflow-y-hidden whitespace-nowrap">
            <TabManager darkMode={darkMode} />
          </div>
        </div>
      </div>

      <div
        className={`flex bg-white min-h-0 ${
          lockContentScroll
            ? "flex-1 overflow-hidden"
            : "flex-1 min-h-screen overflow-x-hidden pb-16"
        }`}
      >
        <main
          className={`flex-1 min-h-0 overflow-hidden bg-white ${
            lockContentScroll
              ? "h-full"
              : "min-h-[calc(100vh-6rem)]"
          }`}
        >
          <div
            className={`max-w-full ${
              lockContentScroll ? "h-full min-h-0" : "min-h-[calc(100vh-6rem)]"
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
  isLandlordMode,
  currentUser,
  activeCompanyContext,
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
        overview: "/system-setup/overview",
        "new-company": "/add-company",
        "new-user": "/add-user",
        companies: "/system-setup/companies",
        users: "/system-setup/users",
        trials: "/system-setup/trials",
        audit: "/system-setup/audit",
        "company-setup-workspace": "/company-setup",
        "property-workspace": "/dashboard",
      };
    }

    if (isCompanySetupWorkspace) {
      return {
        "company-setup-home": "/company-setup",
        "system-admin-workspace": "/system-setup/overview",
        "property-workspace": "/dashboard",
        settings: "/settings",
        activities: "/company-setup?tab=activities",
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
      "terminated-tenants": "/tenants/terminated",
      "add-tenant": "/tenant/new",
      "tenant-agreements": "/agreements",
      "tenant-deposits": "/tenants/deposits",
      "tenant-take-on-balances": "/tenants/take-on-balances",
      "tenant-financing": "/tenants/financing",
      "tenant-journals": "/tenants/journals",
      "payment-vouchers": "/financial/payment-vouchers",
      "petty-cash": "/financial/petty-cash",
      journals: "/financial/journals",
      "service-providers": "/financial/service-providers",
      "ledger-entries": "/financial/ledger-entries",
      "rental-invoices-list": "/invoices/rental",
      "new-invoice": "/invoices/new",
      "credit-notes": "/invoices/notes",
      "debit-notes": "/invoices/notes",
      "credit-debit-notes": "/invoices/notes",
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
      "expenses-service-providers": "/financial/service-providers",
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
  }, [activeCompanyContext, currentUser, isCompanySetupWorkspace, isLandlordMode, isSystemAdminWorkspace]);

  const mainMenuItems = useMemo(() => {
    if (isSystemAdminWorkspace) {
      return [
        {
          id: "control-centre",
          label: "Control Centre",
          icon: FaCog,
          submenu: [
            { id: "overview", label: "Overview", icon: FaChartBar },
            { id: "companies", label: "Companies", icon: FaBuilding },
            { id: "users", label: "Users & Access", icon: FaUsers },
            { id: "trials", label: "Trials & Demo", icon: FaDatabase },
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
            { id: "activities", label: "Activities", icon: FaClipboard },
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

    const landlordModeHiddenMainMenuIds = isLandlordMode ? new Set(["landlord"]) : new Set();

    const items = [
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
          { id: "terminated-tenants", label: "Terminated Tenants", icon: FaUserSlash },
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
        label: "Financial Accounts",
        icon: FaMoneyBillWave,
        submenu: [
          { id: "rental-invoicing", label: "Rental Invoicing", hasSubmenu: true, icon: FaFileInvoice, category: "invoicing", categoryColor: "#4F46E5" },
          { id: "rental-receipting", label: "Rental Receipting", hasSubmenu: true, icon: FaReceipt, category: "receipting", categoryColor: "#10B981" },
          { type: "separator" },
          { id: "payment-vouchers", label: "Payment Vouchers", icon: FaCreditCard, category: "expenses", categoryColor: "#FF8C00" },
          { id: "petty-cash", label: "Petty Cash", icon: FaWallet, category: "expenses", categoryColor: "#FF8C00" },
          { id: "expenses", label: "Expenses", hasSubmenu: true, icon: FaMoneyBillWave, category: "expenses", categoryColor: "#FF8C00" },
          { id: "landlord-payments", label: "Landlord Payments", hasSubmenu: true, icon: FaHandHolding, category: "landlord", categoryColor: "#8B5CF6" },
          { type: "separator" },
          { id: "chart-of-accounts", label: "Chart of Accounts", icon: FaBook, category: "ledger", categoryColor: "#0B3B2E" },
          { id: "journals", label: "Journals", icon: FaBook, category: "ledger", categoryColor: "#0B3B2E" },
        ],
      },
      {
        id: "reports",
        label: "Financial Reports",
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
    ]
      .filter((item) => !landlordModeHiddenMainMenuIds.has(item.id))
      .map((item) => {
        if (!isLandlordMode) return item;

        if (item.id === "properties") {
          return {
            ...item,
            label: "My Properties",
            submenu: item.submenu
              .filter((subItem) => !["property-commission-settings", "commissions-list"].includes(subItem.id))
              .map((subItem) => {
                if (subItem.id === "properties-list") return { ...subItem, label: "My Properties" };
                if (subItem.id === "add-property") return { ...subItem, label: "Add Property" };
                if (subItem.id === "units-spaces") return { ...subItem, label: "Units / Spaces" };
                if (subItem.id === "availability") return { ...subItem, label: "Occupancy & Availability" };
                return subItem;
              }),
          };
        }

        if (item.id === "financial") {
          return {
            ...item,
            label: "Finance",
            submenu: item.submenu
              .filter((subItem) => subItem.id !== "landlord-payments")
              .map((subItem) => {
                if (subItem.id === "payment-vouchers") return { ...subItem, label: "Outgoing Payments" };
                if (subItem.id === "expenses") return { ...subItem, label: "Expenses & Suppliers" };
                return subItem;
              }),
          };
        }

        if (item.id === "reports") {
          return {
            ...item,
            label: "Portfolio Reports",
            submenu: item.submenu
              .filter((subItem) => subItem.id !== "commission-reports")
              .map((subItem) => {
                if (subItem.id === "paid-balance") return { ...subItem, label: "Collections & Balances" };
                if (subItem.id === "aged-analysis") return { ...subItem, label: "Arrears Analysis" };
                return subItem;
              }),
          };
        }

        if (item.id === "tools") {
          return {
            ...item,
            label: "Operations",
          };
        }

        return item;
      });

    return filterMenuByPermissions(items, currentUser, activeCompanyContext);
  }, [activeCompanyContext, currentUser, isCompanySetupWorkspace, isLandlordMode, isSystemAdminWorkspace]);

  const nestedSubmenus = useMemo(() => {
    if (isSystemAdminWorkspace || isCompanySetupWorkspace) {
      return {};
    }

    const submenus = {
      "rental-invoicing": [
        { id: "rental-invoices-list", label: "Rental Invoices", icon: FaFileInvoice },
        { id: "new-invoice", label: "Create New Invoice", icon: FaFileInvoice },
        { id: "credit-debit-notes", label: "Credit & Debit Notes", icon: FaFileInvoice },
        { id: "late-penalties", label: "Late Penalties - Invoices", icon: FaExclamationTriangle },
        { type: "separator" },
        { id: "rental-invoices-vat", label: "Rental Invoices V.A.T", icon: FaFileInvoice },
        { id: "rental-aged-analysis", label: "Rental Aged Analysis", icon: FaChartBar },
      ],
      "rental-receipting": [
        { id: "rental-receipts", label: "Rental Receipts", icon: FaReceipt },
        { id: "mpesa-import", label: "M-Pesa Batch Import", icon: FaPhone },
        { id: "tenant-prepayments", label: "Tenants Prepayments", icon: FaCoins },
        { id: "instant-receipts", label: "Instant Receipts", icon: FaReceipt },
        { id: "landlord-receipt", label: "Landlord Receipts", icon: FaReceipt },
      ],
      expenses: [
        { id: "expense-requisition", label: "Expense Requisition", icon: FaFileInvoice },
        { id: "expenses-service-providers", label: "Service Providers", icon: FaCog },
      ],
      "landlord-payments": [
        { id: "landlord-standing-orders", label: "Landlord Standing Orders", icon: FaCalendarAlt },
        { id: "landlord-advancement", label: "Landlord Advancement", icon: FaMoneyBillWave },
        { id: "commission-landlord-statement", label: "Commissions & LL Statement", icon: FaFileAlt },
        { id: "processed-statements", label: "Processed Statements (Legacy)", icon: FaCheckCircle },
      ],
    };

    if (isLandlordMode) {
      submenus["rental-invoicing"] = submenus["rental-invoicing"].map((item) => {
        if (item.id === "new-invoice") return { ...item, label: "Create Tenant Invoice" };
        if (item.id === "rental-aged-analysis") return { ...item, label: "Tenant Arrears Analysis" };
        return item;
      });
      submenus["rental-receipting"] = submenus["rental-receipting"]
        .filter((item) => item.id !== "landlord-receipt")
        .map((item) => {
          if (item.id === "tenant-prepayments") return { ...item, label: "Prepayments & Credits" };
          return item;
        });
      submenus.expenses = submenus.expenses.map((item) => {
        if (item.id === "expense-requisition") return { ...item, label: "Expense Requests" };
        if (item.id === "expenses-service-providers") return { ...item, label: "Suppliers" };
        return item;
      });
      delete submenus["landlord-payments"];
    }

    Object.keys(submenus).forEach((key) => {
      const filtered = submenus[key].filter((entry) => {
        if (!entry || entry.type === "separator" || !entry.id) return true;
        const rule = MENU_PERMISSION_MAP[entry.id];
        if (!rule) return true;
        return hasCompanyPermission(currentUser, activeCompanyContext, rule.resource, rule.action, rule.moduleKey);
      });
      submenus[key] = filtered.filter((entry, index) => {
        if (entry?.type !== "separator") return true;
        const prev = filtered[index - 1];
        const next = filtered[index + 1];
        return prev && prev.type !== "separator" && next && next.type !== "separator";
      });
    });

    return submenus;
  }, [activeCompanyContext, currentUser, isCompanySetupWorkspace, isLandlordMode, isSystemAdminWorkspace]);

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
        className={`absolute left-full top-0 w-96 shadow-2xl z-[120] rounded-lg overflow-visible border pointer-events-auto ${
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
                    &gt;
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
      label: "Financial Accounts",
      icon: FaBook,
    };

    return (
      <div
        className={`absolute left-full top-0 w-96 shadow-2xl z-[120] rounded-lg overflow-visible border pointer-events-auto ${
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
                    &gt;
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
          className="relative overflow-visible"
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
            <span className="text-xs">&gt;</span>
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

      <div className={`relative z-50 flex min-h-[26px] items-center overflow-visible ${darkMode ? "bg-gray-800" : "bg-[#0A400C]"}`}>
        <StartMenu darkMode={darkMode} variant="header" />

        {mainMenuItems.map((item) => (
          <div key={item.id} className="relative group">
            <button
              onClick={() => {
                setActiveMenu(activeMenu === item.id ? null : item.id);
              }}
              className={`whitespace-nowrap px-2 py-1 text-[11px] font-bold text-white transition-colors sm:px-2.5 sm:text-xs ${
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
                className={`absolute left-0 top-full mt-0 max-h-[70vh] w-64 overflow-visible shadow-lg z-[90] border ${
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

        <div className="flex items-center space-x-1 px-1.5 py-0 text-[11px]">
          <button
            onClick={() => navigate("/tenant/new")}
            className={`rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="New Tenant"
          >
            + Tenant
          </button>
          <button
            onClick={() => navigate("/invoices/new")}
            className={`rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="New Invoice"
          >
            + Invoice
          </button>
          <button
            onClick={() => navigate("/receipts")}
            className={`rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="Receive Payment"
          >
            + Payment
          </button>
          <div className={`h-5 w-px ${darkMode ? "bg-gray-600" : "bg-gray-300"} mx-1`} />
          <button
            onClick={() => window.location.reload()}
            className={`rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="Refresh"
          >
            <FaRedoAlt aria-hidden="true" />
          </button>
          <button
            onClick={() => navigate("/settings")}
            className={`rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="Settings"
          >
            <FaCog aria-hidden="true" />
          </button>
        </div>
      </div>

      {activeMenu && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setActiveMenu(null)}
        />
      )}
    </div>
  );
};

export default DashboardLayout;

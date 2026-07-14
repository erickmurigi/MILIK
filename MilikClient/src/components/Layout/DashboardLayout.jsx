import React, { useCallback, useMemo, useRef, useState } from "react";
import { Toaster } from "react-hot-toast";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { selectCurrentUser, selectCurrentCompany } from "../../redux/selectors";
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
  FaBuilding, FaKey, FaUserSlash, FaRedoAlt, FaCar, FaUserPlus, FaUserCheck,
  FaLayerGroup, FaStar, FaCodeBranch,
  FaBoxes, FaWarehouse, FaCashRegister, FaEnvelope, FaSms, FaUserClock, FaUserFriends,
  FaArchive, FaShieldAlt,
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
import { GL_ACCESS_MODULES, hasCompanyModule, isSelfManagingLandlordCompany } from "../../utils/companyModules";
import { hasCompanyPermission } from "../../utils/permissions";

const MENU_PERMISSION_MAP = {
  "properties-list": { resource: "properties", action: "view", moduleKey: "propertyManagement" },
  "add-property": { resource: "properties", action: "create", moduleKey: "propertyManagement" },
  "property-commission-settings": { resource: "commissions", action: "view", moduleKey: "propertyManagement" },
  "commissions-list": { resource: "commissions", action: "view", moduleKey: "propertyManagement" },
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
  "mpesa-collections":   { resource: "receipts", action: "view",   moduleKey: "propertyManagement" },
  "coop-collections":    { resource: "receipts", action: "view",   moduleKey: "propertyManagement" },
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
  "statement-allocations": { resource: "statements", action: "view", moduleKey: "propertyManagement" },
  "processed-statements": { resource: "processedStatements", action: "view", moduleKey: "accounts" },
  "rental-collection": { resource: "financialReports", action: "view", moduleKey: ["accounts", "propertyManagement"] },
  "paid-balance": { resource: "financialReports", action: "view", moduleKey: ["accounts", "propertyManagement"] },
  "aged-analysis": { resource: "financialReports", action: "view", moduleKey: ["accounts", "propertyManagement"] },
  "commission-reports": { resource: "commissionReports", action: "view", moduleKey: "propertyManagement" },
  "commission-landlord-statement": { resource: "statements", action: "view", moduleKey: "propertyManagement" },
  "landlord-standing-orders": { resource: "standingOrders", action: "view", moduleKey: "accounts" },
  "landlord-advancement": { resource: "landlordAdvancements", action: "view", moduleKey: "accounts" },
  "property-income-summary": { resource: "financialReports", action: "view", moduleKey: ["accounts", "propertyManagement"] },
  "mri-tax-summary": { resource: "financialReports", action: "view", moduleKey: ["accounts", "propertyManagement"] },
  "property-expenses": { resource: "propertyExpenses", action: "view", moduleKey: "propertyManagement" },
  "trial-balance": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "income-statement": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "balance-sheet": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "liability-subledger": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "tax-reports": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  settings: { resource: "companySettings", action: "view" },
  "meter-readings": { resource: "meterReadings", action: "view", moduleKey: "propertyManagement" },
  maintenance: { resource: "maintenances", action: "view", moduleKey: "propertyManagement" },
  inspections: { resource: "inspections", action: "view", moduleKey: "propertyManagement" },
  "carwash-dashboard": { resource: "carwash-dashboard", action: "view", moduleKey: "carwash" },
  "carwash-jobs": { resource: "carwash-jobs", action: "view", moduleKey: "carwash" },
  "carwash-washboard": { resource: "carwash-jobs", action: "view", moduleKey: "carwash" },
  "carwash-services": { resource: "carwash-services", action: "view", moduleKey: "carwash" },
  "carwash-payments": { resource: "carwash-payments", action: "view", moduleKey: "carwash" },
  "carwash-deposits": { resource: "carwash-deposits", action: "view", moduleKey: "carwash" },
  "carwash-expenses": { resource: "carwash-expenses", action: "view", moduleKey: "carwash" },
  "carwash-staff": { resource: "carwash-staff", action: "view", moduleKey: "carwash" },
  "carwash-reports": { resource: "carwash-reports", action: "view", moduleKey: "carwash" },
  "carwash-service-report":  { resource: "carwash-reports", action: "view", moduleKey: "carwash" },
  "carwash-staff-report":    { resource: "carwash-reports", action: "view", moduleKey: "carwash" },
  "carwash-expense-report":  { resource: "carwash-reports", action: "view", moduleKey: "carwash" },
  "carwash-commissions":        { resource: "carwash-commissions", action: "view", moduleKey: "carwash" },
  "carwash-commission-payouts": { resource: "carwash-commissions", action: "view", moduleKey: "carwash" },
  "carwash-commission-rules":   { resource: "carwash-commissions", action: "view", moduleKey: "carwash" },
  "carwash-staff-savings":      { resource: "carwash-commissions", action: "view", moduleKey: "carwash" },
  "carwash-staff-damages":      { resource: "carwash-commissions", action: "view", moduleKey: "carwash" },
  "carwash-all-customers":        { resource: "carwash-loyalty",   action: "view", moduleKey: "carwash" },
  "carwash-loyalty":              { resource: "carwash-loyalty",   action: "view", moduleKey: "carwash" },
  "carwash-credit-balances":      { resource: "carwash-loyalty",   action: "view", moduleKey: "carwash" },
  "carwash-accounts":             { resource: "carwash-payments",  action: "view", moduleKey: "carwash" },
  "carwash-mpesa-notifications":  { resource: "carwash-payments",  action: "view", moduleKey: "carwash" },
  "carwash-branches":             { resource: "carwash-branches",  action: "view", moduleKey: "carwash" },
  "carwash-settings":             { resource: "carwash-settings",  action: "view", moduleKey: "carwash" },
  "carwash-cashbooks": { resource: "chartOfAccounts", action: "view", moduleKey: "carwash" },
  "carwash-chart-of-accounts": { resource: "chartOfAccounts", action: "view", moduleKey: "carwash" },
  "inv-dashboard":       { resource: "inv-dashboard",       action: "view", moduleKey: "inventory" },
  "inv-products":        { resource: "inv-products",        action: "view", moduleKey: "inventory" },
  "inv-stock-movements": { resource: "inv-stock",           action: "view", moduleKey: "inventory" },
  "inv-transfers":       { resource: "inv-transfers",       action: "view", moduleKey: "inventory" },
  "inv-purchase-orders": { resource: "inv-purchase-orders", action: "view", moduleKey: "inventory" },
  "inv-locations":       { resource: "inv-locations",       action: "view", moduleKey: "inventory" },
  "inv-categories":      { resource: "inv-categories",      action: "view", moduleKey: "inventory" },
  "inv-suppliers":       { resource: "inv-suppliers",       action: "view", moduleKey: "inventory" },
  "inv-tills":           { resource: "inv-tills",           action: "view", moduleKey: "inventory" },
  "pos-terminal":        { resource: "pos-terminal",        action: "view",   moduleKey: "inventory" },
  "pos-sales":           { resource: "pos-sales",           action: "view",   moduleKey: "inventory" },
  "pos-sessions":        { resource: "pos-sessions",        action: "view",   moduleKey: "inventory" },
  "inv-adjustments":     { resource: "inv-stock",           action: "adjust", moduleKey: "inventory" },
  "inv-valuation":       { resource: "inv-reports",         action: "view",   moduleKey: "inventory" },
  "acc-chart-of-accounts": { resource: "chartOfAccounts", action: "view", moduleKey: "accounts" },
  "acc-journals":          { resource: "journals",        action: "view", moduleKey: "accounts" },
  "acc-payment-vouchers":  { resource: "paymentVouchers", action: "view", moduleKey: "accounts" },
  "acc-expenses":          { resource: "expenses",        action: "view", moduleKey: "accounts" },
  "acc-service-providers": { resource: "expenses",        action: "view", moduleKey: "accounts" },
  "acc-trial-balance":        { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-income-statement":     { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-balance-sheet":        { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-liability-subledger":  { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-tax-reports":          { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-vat-remittance":       { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-wht-remittance":       { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-cash-flow":            { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-arrears-analysis":     { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-payment-analysis":     { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-bank-reconciliation":       { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-fixed-assets":              { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-fixed-assets-depreciation": { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-budget":                    { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-budget-analysis":           { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-creditor-ledger":           { resource: "expenses",         action: "view", moduleKey: "accounts" },
  "acc-accounting-periods":        { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-gl-integrity":              { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-year-end-close":            { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-financial-ratios":          { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "acc-period-management":         { resource: "financialReports", action: "view", moduleKey: "accounts" },
  "comm-sms-manager":     { resource: "sms",   action: "view"   },
  "comm-sms-templates":   { resource: "sms",   action: "manage" },
  "comm-email-manager":   { resource: "email", action: "view"   },
  "comm-email-templates": { resource: "email", action: "manage" },
  "sale-dashboard":       { resource: "sale-dashboard",       action: "view", moduleKey: "propertySale" },
  "sale-listings":        { resource: "sale-listings",        action: "view", moduleKey: "propertySale" },
  "sale-buyers":          { resource: "sale-buyers",          action: "view", moduleKey: "propertySale" },
  "sale-agents":          { resource: "sale-agents",          action: "view", moduleKey: "propertySale" },
  "sale-offers":          { resource: "sale-offers",          action: "view", moduleKey: "propertySale" },
  "sale-deals":           { resource: "sale-deals",           action: "view", moduleKey: "propertySale" },
  "sale-payments":        { resource: "sale-payments",        action: "view", moduleKey: "propertySale" },
  "sale-commissions":     { resource: "sale-commissions",     action: "view", moduleKey: "propertySale" },
  "sale-reports":         { resource: "sale-reports",         action: "view", moduleKey: "propertySale" },
  "sale-crm-leads":       { resource: "saleLeads",            action: "view", moduleKey: "propertySale" },
  "sale-crm-activities":  { resource: "saleActivities",       action: "view", moduleKey: "propertySale" },
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
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  // Only show the "Switching Company" banner when the company has NOT yet been
  // optimistically set — i.e. currentCompany still differs from the target.
  const isCompanySwitching = useSelector((state) => {
    if (!state.company?.isSwitching) return false;
    const targetId = state.company?.switchTargetCompanyId;
    const currentId = state.company?.currentCompany?._id;
    // If already showing the target company (optimistic update applied), stay silent.
    return !targetId || String(currentId) !== String(targetId);
  });
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
        lockContentScroll ? "h-screen overflow-hidden flex flex-col" : "min-h-screen overflow-x-hidden"
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
            ? "flex-1 min-h-0 overflow-hidden pb-8"
            : "flex-1 min-h-screen overflow-x-hidden pb-8"
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

const HELP_MODULES = [
  { label: "Property Management", icon: FaBuilding,  path: "/properties" },
  { label: "Accounting",          icon: FaBook,       path: "/accounts" },
  { label: "Human Resources",     icon: FaUsers,      path: "/hr/overview" },
  { label: "Car Wash",            icon: FaCar,        path: "/carwash" },
  { label: "Property Sales",      icon: FaKey,        path: "/sale/dashboard" },
];

const HELP_RESOURCES = [
  { label: "Getting Started",   icon: FaChartLine },
  { label: "User Guide",        icon: FaFileAlt },
  { label: "What's New",        icon: FaStar },
  { label: "Documentation",     icon: FaBook },
];

const HelpMegaPanel = ({ darkMode, onClose, navigate }) => {
  const panelBase = darkMode
    ? "bg-gray-900 border-gray-700 text-gray-100"
    : "bg-white border-gray-200 text-gray-800";
  const sectionHead = darkMode ? "text-gray-400" : "text-gray-400";
  const divider = darkMode ? "border-gray-700" : "border-gray-100";
  const rowHover = darkMode ? "hover:bg-gray-800" : "hover:bg-emerald-50";
  const iconWrap = darkMode ? "bg-gray-800 text-emerald-400" : "bg-emerald-50 text-[#1f4a35]";
  const contactBg = darkMode ? "bg-gray-800" : "bg-[#f7fbf9]";
  const tagStyle = darkMode ? "bg-emerald-900/40 text-emerald-300" : "bg-emerald-100 text-[#1f4a35]";

  return (
    <div
      className={`absolute right-0 top-full z-[120] mt-0 w-[540px] rounded-b-xl border shadow-2xl ${panelBase}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className={`flex items-center justify-between border-b px-5 py-3 ${divider}`}>
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#31694E]">Milik PMS</p>
          <p className={`text-[10px] font-medium ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
            Property Management System — Help &amp; Resources
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest ${tagStyle}`}>
          v2.0
        </span>
      </div>

      <div className="grid grid-cols-2 gap-0">
        {/* Left: Modules */}
        <div className={`border-r px-4 py-3 ${divider}`}>
          <p className={`mb-2 text-[9px] font-extrabold uppercase tracking-[0.2em] ${sectionHead}`}>Modules</p>
          {HELP_MODULES.map(({ label, icon: Icon, path }) => (
            <button
              key={label}
              onClick={() => { navigate(path); onClose(); }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${rowHover}`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${iconWrap}`}>
                <Icon className="text-[11px]" />
              </span>
              <span className="text-[11px] font-semibold">{label}</span>
            </button>
          ))}
        </div>

        {/* Right: Resources */}
        <div className="px-4 py-3">
          <p className={`mb-2 text-[9px] font-extrabold uppercase tracking-[0.2em] ${sectionHead}`}>Resources</p>
          {HELP_RESOURCES.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${rowHover}`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${iconWrap}`}>
                <Icon className="text-[11px]" />
              </span>
              <span className="text-[11px] font-semibold">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Contact footer */}
      <div className={`rounded-b-xl border-t px-5 py-3 ${divider} ${contactBg}`}>
        <p className={`mb-1.5 text-[9px] font-extrabold uppercase tracking-[0.2em] ${sectionHead}`}>Contact &amp; Support</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <a
            href="tel:0141455841"
            className={`inline-flex items-center gap-1.5 text-[11px] font-bold transition-colors ${darkMode ? "text-emerald-400 hover:text-emerald-300" : "text-[#1f4a35] hover:text-[#31694E]"}`}
          >
            <FaPhone className="text-[10px]" />
            0141 455 841
          </a>
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
            <FaHeadset className="text-[10px]" />
            Mon–Fri, 8 am–6 pm EAT
          </span>
        </div>
        <p className={`mt-1 text-[10px] ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
          For urgent issues outside office hours, email <span className="font-semibold">support@milik.co.ke</span>
        </p>
      </div>
    </div>
  );
};

const MENU_COLOR_MAP = {
  properties: { color: "#3B82F6", label: "Properties", icon: FaHome },
  landlord: { color: "#F59E0B", label: "Landlords", icon: FaUser },
  units: { color: "#8B5CF6", label: "Units & Spaces", icon: FaSquare },
  tenants: { color: "#EC4899", label: "Tenants", icon: FaUsers },
  reports: { color: "#10B981", label: "Reports & Analytics", icon: FaChartBar },
  tools: { color: "#06B6D4", label: "Tools & Settings", icon: FaToolbox },
  help: { color: "#8B5CF6", label: "Help & Support", icon: FaInfoCircle },
  "rental-invoicing": { color: "#4F46E5", label: "Rental Invoicing", icon: FaFileInvoice },
  "rental-receipting": { color: "#10B981", label: "Rental Receipting", icon: FaReceipt },
  "landlord-payments": { color: "#8B5CF6", label: "Landlord Payments", icon: FaHandHolding },
  "carwash-operations":         { color: "#0B3B2E", label: "Operations",  icon: FaCar },
  "carwash-finance":            { color: "#0B3B2E", label: "Finance",     icon: FaMoneyBillWave },
  "carwash-commissions-group":  { color: "#0B3B2E", label: "Commissions", icon: FaHandshake },
  "carwash-reporting":          { color: "#0B3B2E", label: "Reports",     icon: FaChartBar },
  "carwash-setup":              { color: "#0B3B2E", label: "Setup",       icon: FaCog },
  "sale-operations": { color: "#027333", label: "Operations", icon: FaHandshake },
  "sale-clients":    { color: "#027333", label: "Clients & Agents", icon: FaUsers },
  "sale-finance":    { color: "#027333", label: "Finance & Reports", icon: FaMoneyBillWave },
  "hr-people":      { color: "#0B3B2E", label: "Employees",  icon: FaUsers },
  "hr-leave":       { color: "#0891b2", label: "Leave",       icon: FaCalendarAlt },
  "hr-payroll":     { color: "#7c3aed", label: "Payroll",     icon: FaMoneyBillWave },
  "hr-reports":     { color: "#059669", label: "Reports",     icon: FaChartBar },
  "hr-appraisals":  { color: "#b45309", label: "Appraisals",  icon: FaChartLine },
  "hr-attendance":  { color: "#0891b2", label: "Attendance",  icon: FaUserClock },
  "hr-config":      { color: "#FF8C00", label: "Setup",       icon: FaCog },
  "inv-pos":            { color: "#0B3B2E", label: "Point of Sale",    icon: FaCashRegister },
  "inv-catalog":        { color: "#1a5c3a", label: "Products",          icon: FaBoxes },
  "inv-stock-ops":      { color: "#0B3B2E", label: "Stock",             icon: FaExchangeAlt },
  "inv-purchasing":     { color: "#374151", label: "Purchasing",        icon: FaFileInvoice },
  "inv-tills-sessions": { color: "#0B3B2E", label: "Tills & Sessions",  icon: FaCashRegister },
  "inv-setup":          { color: "#4B5563", label: "Setup",             icon: FaCog },
  "acc-ledger":     { color: "#0B3B2E", label: "General Ledger",        icon: FaBook },
  "acc-payables":   { color: "#b45309", label: "Payables & Expenses",   icon: FaCreditCard },
  "acc-statements": { color: "#0f766e", label: "Financial Reports",     icon: FaFileAlt },
  "comm-sms":       { color: "#0d9488", label: "SMS Messaging",         icon: FaSms },
  "comm-email":     { color: "#1d4ed8", label: "Email Messaging",       icon: FaEnvelope },
};

const ProfessionalDropdown = ({ menuId, items, darkMode, onMenuEnter, onMenuLeave, onItemClick }) => {
  const menuInfo = MENU_COLOR_MAP[menuId] || { color: "#0B3B2E", label: menuId.toUpperCase(), icon: FaCog };
  const MenuIcon = menuInfo.icon;
  return (
    <div
      className={`absolute left-full top-0 w-96 shadow-2xl z-[120] rounded-lg overflow-visible border pointer-events-auto ${
        darkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-100"
      }`}
      style={{ marginLeft: "0px" }}
      onMouseEnter={() => onMenuEnter(menuId)}
      onMouseLeave={onMenuLeave}
    >
      <div style={{ backgroundColor: menuInfo.color }} className="px-5 py-4 text-white flex items-center space-x-3">
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
                onClick={() => onItemClick(item.id)}
                className={`w-full text-left px-5 py-3 text-sm font-medium flex items-center space-x-3 transition-all duration-150 border-l-4 ${
                  darkMode
                    ? "text-gray-200 hover:bg-gray-700 hover:text-white border-l-transparent"
                    : "text-gray-700 hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent border-l-transparent"
                }`}
              >
                {item.icon && (
                  <span className="flex-shrink-0 transition-transform duration-150" style={{ color: "#FF8C00" }}>
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
                <span className="text-xs opacity-50 transition-opacity" style={{ color: menuInfo.color }}>&gt;</span>
              </button>
            )}
          </React.Fragment>
        ))}
      </div>
      <div style={{ backgroundColor: menuInfo.color }} className="h-1.5" />
    </div>
  );
};

const FinancialDropdown = ({ categoryId, items, darkMode, onMenuEnter, onMenuLeave, onItemClick }) => {
  const category = MENU_COLOR_MAP[categoryId] || { color: "#0B3B2E", label: "Financial Accounts", icon: FaBook };
  return (
    <div
      className={`absolute left-full top-0 w-96 shadow-2xl z-[120] rounded-lg overflow-visible border pointer-events-auto ${
        darkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-100"
      }`}
      style={{ marginLeft: "0px" }}
      onMouseEnter={() => onMenuEnter(categoryId)}
      onMouseLeave={onMenuLeave}
    >
      <div style={{ backgroundColor: category.color }} className="px-5 py-4 text-white flex items-center space-x-3">
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
                onClick={() => onItemClick(item.id)}
                className={`w-full text-left px-5 py-3 text-sm font-medium flex items-center space-x-3 transition-all duration-150 border-l-4 ${
                  darkMode
                    ? "text-gray-200 hover:bg-gray-700 hover:text-white border-l-transparent"
                    : "text-gray-700 hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent border-l-transparent"
                }`}
              >
                {item.icon && (
                  <span className="flex-shrink-0 transition-transform duration-150" style={{ color: category.color }}>
                    <item.icon size={16} />
                  </span>
                )}
                <span>{item.label}</span>
                <span className="text-xs opacity-50 transition-opacity" style={{ color: category.color }}>&gt;</span>
              </button>
            )}
          </React.Fragment>
        ))}
      </div>
      <div style={{ backgroundColor: category.color }} className="h-1.5" />
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

  const clearHoverCloseTimer = useCallback(() => {
    if (hoverCloseTimerRef.current) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);

  const openHoveredFinancialItem = useCallback((menuId) => {
    clearHoverCloseTimer();
    setHoveredFinancialItem(menuId);
  }, [clearHoverCloseTimer]);

  const closeHoveredFinancialItem = useCallback(() => {
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setHoveredFinancialItem(null);
      hoverCloseTimerRef.current = null;
    }, 120);
  }, [clearHoverCloseTimer]);

  const isSystemAdminWorkspace    = currentWorkspace === WORKSPACE_IDS.SYSTEM_ADMIN;
  const isCompanySetupWorkspace   = currentWorkspace === WORKSPACE_IDS.COMPANY_SETUP;

  // For neutral pages (e.g. /my-account), derive menu from the company's enabled modules
  // so a Car Wash-only company doesn't see the PMS navbar.
  const effectiveMenuWorkspace = useMemo(() => {
    if (currentWorkspace !== WORKSPACE_IDS.NEUTRAL) return currentWorkspace;
    if (hasCompanyModule(activeCompanyContext, 'carwash'))            return WORKSPACE_IDS.CARWASH;
    if (hasCompanyModule(activeCompanyContext, 'propertyManagement')) return WORKSPACE_IDS.PROPERTY;
    if (hasCompanyModule(activeCompanyContext, 'inventory'))          return WORKSPACE_IDS.INVENTORY;
    if (hasCompanyModule(activeCompanyContext, 'propertySale'))       return WORKSPACE_IDS.PROPERTY_SALE;
    if (hasCompanyModule(activeCompanyContext, 'humanResource'))      return WORKSPACE_IDS.HUMAN_RESOURCE;
    if (hasCompanyModule(activeCompanyContext, 'accounts'))           return WORKSPACE_IDS.ACCOUNTS;
    return WORKSPACE_IDS.PROPERTY;
  }, [currentWorkspace, activeCompanyContext]);

  const isAccountsWorkspace       = effectiveMenuWorkspace === WORKSPACE_IDS.ACCOUNTS;
  const isCarWashWorkspace        = effectiveMenuWorkspace === WORKSPACE_IDS.CARWASH;
  const isInventoryWorkspace      = effectiveMenuWorkspace === WORKSPACE_IDS.INVENTORY;
  const isPropertySaleWorkspace   = effectiveMenuWorkspace === WORKSPACE_IDS.PROPERTY_SALE;
  const isHumanResourceWorkspace  = effectiveMenuWorkspace === WORKSPACE_IDS.HUMAN_RESOURCE;
  const isCommunicationsWorkspace = effectiveMenuWorkspace === WORKSPACE_IDS.COMMUNICATIONS;

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

    if (isCarWashWorkspace) {
      return {
        "property-workspace": "/dashboard",
        "carwash-dashboard": "/carwash/dashboard",
        "carwash-jobs": "/carwash/jobs",
        "carwash-washboard": "/carwash/washboard",
        "carwash-services": "/carwash/services",
        "carwash-payments": "/carwash/payments",
        "carwash-mpesa-notifications": "/carwash/mpesa-notifications",
        "carwash-deposits": "/carwash/deposits",
        "carwash-expenses": "/carwash/expenses",
        "carwash-staff": "/carwash/staff",
        "carwash-reports": "/carwash/reports",
        "carwash-service-report":  "/carwash/reports/services",
        "carwash-staff-report":    "/carwash/reports/staff",
        "carwash-expense-report":  "/carwash/reports/expenses",
        "carwash-commissions":        "/carwash/commissions",
        "carwash-commission-payouts": "/carwash/commissions/payouts",
        "carwash-commission-rules":   "/carwash/commissions/rules",
        "carwash-staff-savings":      "/carwash/commissions/savings",
        "carwash-staff-damages":      "/carwash/commissions/damages",
        "carwash-all-customers": "/carwash/customers",
        "carwash-loyalty": "/carwash/loyalty",
        "carwash-credit-balances": "/carwash/customers/credit-balances",
        "carwash-accounts": "/carwash/accounts",
        "carwash-branches": "/carwash/branches",
        "carwash-settings": "/carwash/settings",
        "carwash-cashbooks": "/carwash/cashbooks",
        "carwash-chart-of-accounts": "/carwash/chart-of-accounts",
        documentation: "/help/documentation",
        support: "/help/support",
        about: "/help/about",
      };
    }

    if (isInventoryWorkspace) {
      return {
        "inv-dashboard":       "/inventory/dashboard",
        "inv-products":        "/inventory/products",
        "inv-stock-movements": "/inventory/stock-movements",
        "inv-transfers":       "/inventory/transfers",
        "inv-purchase-orders": "/inventory/purchase-orders",
        "inv-locations":       "/inventory/locations",
        "inv-categories":      "/inventory/categories",
        "inv-suppliers":       "/inventory/suppliers",
        "inv-tills":           "/inventory/tills",
        "inv-adjustments":     "/inventory/adjustments",
        "inv-valuation":       "/inventory/valuation",
        "pos-terminal":        "/pos/terminal",
        "pos-sales":           "/pos/sales",
        "pos-sessions":        "/pos/sessions",
        documentation: "/help/documentation",
        support: "/help/support",
        about: "/help/about",
      };
    }

    if (isPropertySaleWorkspace) {
      return {
        "sale-dashboard":      "/sale/dashboard",
        "sale-listings":       "/sale/listings",
        "sale-buyers":         "/sale/buyers",
        "sale-agents":         "/sale/agents",
        "sale-offers":         "/sale/offers",
        "sale-deals":          "/sale/deals",
        "sale-payments":       "/sale/payments",
        "sale-commissions":    "/sale/commissions",
        "sale-reports":        "/sale/reports",
        "sale-crm-leads":      "/sale/crm/leads",
        "sale-crm-activities": "/sale/crm/activities",
        documentation: "/help/documentation",
        support: "/help/support",
        about: "/help/about",
      };
    }

    if (isHumanResourceWorkspace) {
      return {
        // Employees — Phase 1 (live)
        "hr-dashboard":             "/hr/dashboard",
        "hr-employees":             "/hr/employees",
        "hr-add-employee":          "/hr/employees/new",
        // Leave — Phase 2 (live)
        "hr-leave-applications":    "/hr/leave",
        "hr-leave-approvals":       "/hr/leave",
        "hr-leave-types":           "/hr/leave/types",
        "hr-leave-balances":        "/hr/leave/balances",
        // Payroll — Phase 3 (live)
        "hr-run-payroll":           "/hr/payroll",
        "hr-payroll-history":       "/hr/payroll",
        "hr-payslips":              "/hr/payroll",
        "hr-payroll-register":      "/hr/payroll/register",
        "hr-statutory":             "/hr/statutory",
        // Reports — Phase 4 (live)
        "hr-report-headcount":      "/hr/reports/headcount",
        "hr-report-p9":             "/hr/reports/p9",
        "hr-report-payroll":        "/hr/reports/payroll",
        "hr-report-leave":          "/hr/reports/leave",
        "hr-remittance":            "/hr/reports/remittance",
        "hr-report-attendance":     "/hr/reports/attendance",
        // Appraisals — Phase 5 (live)
        "hr-appraisal-cycles":      "/hr/appraisals/cycles",
        "hr-appraisals":            "/hr/appraisals",
        "hr-kpis":                  "/hr/appraisals/kpis",
        // Attendance (live)
        "hr-attendance":            "/hr/attendance",
        // Documents (live)
        "hr-letters":               "/hr/letters",
        // Setup — Phase 1 + 2 (live)
        "hr-setup":                 "/hr/setup",
        "hr-setup-leave-types":     "/hr/leave/types",
        // Help
        documentation: "/help/documentation",
        support:       "/help/support",
        about:         "/help/about",
      };
    }

    if (isCommunicationsWorkspace) {
      return {
        "comm-sms-manager":     "/communications/sms",
        "comm-sms-templates":   "/communications/sms/templates",
        "comm-email-manager":   "/communications/email",
        "comm-email-templates": "/communications/email/templates",
      };
    }

    if (isAccountsWorkspace) {
      return {
        "acc-dashboard":         "/accounts/dashboard",
        "acc-chart-of-accounts": "/accounts/chart-of-accounts",
        "acc-journals":          "/accounts/journals",
        "acc-payment-vouchers":  "/accounts/payment-vouchers",
        "acc-petty-cash":        "/accounts/petty-cash",
        "acc-expenses":          "/accounts/expenses",
        "acc-service-providers": "/accounts/service-providers",
        "acc-trial-balance":     "/accounts/trial-balance",
        "acc-income-statement":  "/accounts/income-statement",
        "acc-balance-sheet":          "/accounts/balance-sheet",
        "acc-liability-subledger":    "/accounts/liability-subledger",
        "acc-tax-reports":       "/accounts/tax-reports",
        "acc-vat-remittance":    "/accounts/vat-remittance",
        "acc-wht-remittance":    "/accounts/wht-remittance",
        "acc-cash-flow":         "/accounts/cash-flow",
        "acc-arrears-analysis":     "/accounts/arrears-aged-analysis",
        "acc-payment-analysis":     "/accounts/payment-aged-analysis",
        "acc-bank-reconciliation":       "/accounts/bank-reconciliation",
        "acc-fixed-assets":              "/accounts/fixed-assets",
        "acc-fixed-assets-depreciation": "/accounts/fixed-assets/depreciation",
        "acc-budget":                    "/accounts/budget",
        "acc-budget-analysis":           "/accounts/budget/analysis",
        "acc-creditor-ledger":           "/accounts/creditor-ledger",
        "acc-accounting-periods":        "/accounts/accounting-periods",
        "acc-gl-integrity":              "/accounts/gl-integrity",
        "acc-year-end-close":            "/accounts/year-end-close",
        "acc-financial-ratios":          "/accounts/financial-ratios",
        documentation: "/help/documentation",
        support:       "/help/support",
        about:         "/help/about",
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
      "mpesa-collections":  "/receipts/mpesa-collections",
      "coop-collections":   "/receipts/coop-collections",
      "tenant-prepayments": "/receipts/prepayments",
      "instant-receipts": "/receipts/instant",
      "landlord-receipt": "/receipts/landlord",
      "landlord-standing-orders": "/landlords/standing-orders",
      "landlord-advancement": "/landlords/advancement",
      "commission-landlord-statement": "/financial/landlord-statement",
      "processed-statements": "/landlord/processed-statements",
      "landlord-statements": "/landlord/statements",
      "statement-allocations": "/landlord/statement-allocations",
      "rental-collection": "/reports/rental-collection",
      "paid-balance": "/reports/paid-balance",
      "aged-analysis": "/reports/aged-analysis",
      "commission-reports": "/reports/commissions",
      "property-income-summary": "/reports/property-income-summary",
      "mri-tax-summary": "/reports/mri-tax-summary",
      "income-statement": "/reports/income-statement",
      "property-expenses": "/property-expenses",
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
  }, [activeCompanyContext, currentUser, isAccountsWorkspace, isCarWashWorkspace, isCommunicationsWorkspace, isCompanySetupWorkspace, isHumanResourceWorkspace, isLandlordMode, isPropertySaleWorkspace, isSystemAdminWorkspace]);

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

    if (isPropertySaleWorkspace) {
      const saleItems = [
        {
          id: "sale-operations",
          label: "Operations",
          icon: FaHandshake,
          submenu: [
            { id: "sale-dashboard", label: "Dashboard", icon: FaChartBar },
            { id: "sale-listings", label: "Sale Listings", icon: FaBuilding },
            { id: "sale-offers", label: "Offers", icon: FaTag },
            { id: "sale-deals", label: "Deals / Transactions", icon: FaHandshake },
          ],
        },
        {
          id: "sale-clients",
          label: "Clients",
          icon: FaUsers,
          submenu: [
            { id: "sale-buyers", label: "Buyers / Clients", icon: FaUsers },
            { id: "sale-agents", label: "Sales Agents", icon: FaUser },
          ],
        },
        {
          id: "sale-finance",
          label: "Finance",
          icon: FaMoneyBillWave,
          submenu: [
            { id: "sale-payments",    label: "Payments",      icon: FaMoneyBillWave },
            { id: "sale-commissions", label: "Commissions",   icon: FaChartLine },
            { id: "sale-reports",     label: "Sales Reports", icon: FaFileAlt },
          ],
        },
        {
          id: "sale-crm",
          label: "CRM",
          icon: FaUserClock,
          submenu: [
            { id: "sale-crm-leads",      label: "Leads Pipeline", icon: FaUserFriends },
            { id: "sale-crm-activities", label: "Activity Log",   icon: FaClipboard },
          ],
        },
      ];

      return filterMenuByPermissions(saleItems, currentUser, activeCompanyContext);
    }

    if (isHumanResourceWorkspace) {
      return [
        {
          id: "hr-people",
          label: "Employees",
          icon: FaUsers,
          submenu: [
            { id: "hr-dashboard",    label: "HR Dashboard",  icon: FaChartBar },
            { id: "hr-employees",    label: "All Employees", icon: FaUsers },
            { id: "hr-add-employee", label: "Add Employee",  icon: FaUserPlus },
          ],
        },
        {
          id: "hr-leave",
          label: "Leave",
          icon: FaCalendarAlt,
          submenu: [
            { id: "hr-leave-applications", label: "Leave Applications", icon: FaFileAlt },
            { id: "hr-leave-approvals",    label: "Leave Approvals",    icon: FaUserCheck },
            { type: "separator" },
            { id: "hr-leave-types",        label: "Leave Types",        icon: FaTag },
            { id: "hr-leave-balances",     label: "Leave Balances",     icon: FaChartBar },
          ],
        },
        {
          id: "hr-payroll",
          label: "Payroll",
          icon: FaMoneyBillWave,
          submenu: [
            { id: "hr-run-payroll",       label: "Run Payroll",           icon: FaMoneyBillWave },
            { id: "hr-payroll-history",   label: "Payroll History",       icon: FaBook },
            { id: "hr-payslips",          label: "Payslips",              icon: FaFileAlt },
            { id: "hr-payroll-register",  label: "Payroll Register",      icon: FaClipboard },
            { type: "separator" },
            { id: "hr-statutory",         label: "Statutory Deductions",  icon: FaCalculator },
          ],
        },
        {
          id: "hr-reports",
          label: "Reports",
          icon: FaChartBar,
          submenu: [
            { id: "hr-report-headcount", label: "Headcount Report",       icon: FaUsers },
            { id: "hr-report-payroll",   label: "Payroll Summary",        icon: FaMoneyBillWave },
            { id: "hr-report-leave",       label: "Leave Summary",          icon: FaCalendarAlt },
            { id: "hr-report-attendance",  label: "Attendance Report",      icon: FaUserClock },
            { type: "separator" },
            { id: "hr-remittance",       label: "Statutory Remittance",   icon: FaCalculator },
            { id: "hr-report-p9",        label: "P9 Form (Annual)",       icon: FaFileAlt },
          ],
        },
        {
          id: "hr-appraisals",
          label: "Appraisals",
          icon: FaChartLine,
          submenu: [
            { id: "hr-appraisal-cycles", label: "Appraisal Cycles",     icon: FaCalendarAlt },
            { id: "hr-appraisals",       label: "Employee Appraisals",  icon: FaClipboard },
            { type: "separator" },
            { id: "hr-kpis",             label: "KPI Library",          icon: FaTag },
          ],
        },
        {
          id: "hr-attendance",
          label: "Attendance",
          icon: FaUserClock,
          submenu: [
            { id: "hr-attendance", label: "Attendance Records", icon: FaUserClock },
          ],
        },
        {
          id: "hr-documents",
          label: "Documents",
          icon: FaFileAlt,
          submenu: [
            { id: "hr-letters", label: "HR Letters", icon: FaFileAlt },
          ],
        },
        {
          id: "hr-config",
          label: "Setup",
          icon: FaCog,
          submenu: [
            { id: "hr-setup",             label: "Departments & Designations", icon: FaBuilding },
            { id: "hr-setup-leave-types", label: "Leave Types",                icon: FaTag },
          ],
        },
        {
          id: "help",
          label: "Help",
          icon: FaInfoCircle,
          submenu: [
            { id: "documentation", label: "Documentation", icon: FaBook },
            { id: "support",       label: "Support",       icon: FaHeadset },
            { id: "about",         label: "About",         icon: FaInfoCircle },
          ],
        },
      ];
    }

    if (isCommunicationsWorkspace) {
      const commItems = [
        {
          id: "comm-sms",
          label: "SMS",
          icon: FaSms,
          submenu: [
            { id: "comm-sms-manager",   label: "SMS Manager",   icon: FaSms },
            { id: "comm-sms-templates", label: "SMS Templates", icon: FaFileAlt },
          ],
        },
        {
          id: "comm-email",
          label: "Email",
          icon: FaEnvelope,
          submenu: [
            { id: "comm-email-manager",   label: "Email Manager",   icon: FaEnvelope },
            { id: "comm-email-templates", label: "Email Templates", icon: FaFileAlt },
          ],
        },
      ];
      return filterMenuByPermissions(commItems, currentUser, activeCompanyContext);
    }

    if (isAccountsWorkspace) {
      const accountsItems = [
        {
          id: "acc-ledger",
          label: "General Ledger",
          icon: FaBook,
          submenu: [
            { id: "acc-dashboard",          label: "Accounts Overview",   icon: FaChartLine },
            { id: "acc-chart-of-accounts",  label: "Chart of Accounts",   icon: FaLayerGroup },
            { id: "acc-journals",           label: "Journal Entries",     icon: FaBook },
            { id: "acc-bank-reconciliation", label: "Bank Reconciliation", icon: FaUniversity },
          ],
        },
        {
          id: "acc-fixed-assets-group",
          label: "Fixed Assets",
          icon: FaToolbox,
          submenu: [
            { id: "acc-fixed-assets",              label: "Asset Register",  icon: FaList },
            { id: "acc-fixed-assets-depreciation", label: "Depreciation",    icon: FaCalculator },
          ],
        },
        {
          id: "acc-budget-group",
          label: "Budgets",
          icon: FaChartPie,
          submenu: [
            { id: "acc-budget",          label: "Budget Plans",      icon: FaFileAlt },
            { id: "acc-budget-analysis", label: "Budget vs Actual",  icon: FaChartPie },
          ],
        },
        {
          id: "acc-payables",
          label: "Payables",
          icon: FaCreditCard,
          submenu: [
            { id: "acc-payment-vouchers",  label: "Payment Vouchers",     icon: FaCreditCard },
            { id: "acc-petty-cash",        label: "Petty Cash",           icon: FaWallet },
            { type: "separator" },
            { id: "acc-expenses",          label: "Expense Requisitions", icon: FaFileInvoice },
            { id: "acc-service-providers", label: "Service Providers",    icon: FaCog },
            { id: "acc-creditor-ledger",   label: "Creditors Ledger",     icon: FaBook },
          ],
        },
        {
          id: "acc-statements",
          label: "Reports",
          icon: FaFileAlt,
          submenu: [
            { id: "acc-trial-balance",    label: "Trial Balance",          icon: FaBook },
            { id: "acc-income-statement", label: "Income Statement (P&L)", icon: FaFileAlt },
            { id: "acc-balance-sheet",       label: "Balance Sheet",          icon: FaBalanceScale },
            { id: "acc-liability-subledger", label: "Liability Sub-Ledger",   icon: FaLayerGroup },
            { id: "acc-cash-flow",           label: "Cash Flow Statement",    icon: FaExchangeAlt },
            { id: "acc-financial-ratios", label: "Financial Ratios",       icon: FaChartPie },
            ...(hasCompanyModule(activeCompanyContext, "propertyManagement")
              ? [{ id: "acc-arrears-analysis", label: "Arrears Aged Analysis", icon: FaChartBar }]
              : []),
            { id: "acc-payment-analysis", label: "Payment Aged Analysis",  icon: FaChartBar },
            { id: "acc-tax-reports",      label: "Tax Reports",            icon: FaCalculator },
            { id: "acc-vat-remittance",   label: "VAT Remittance",         icon: FaReceipt },
            { id: "acc-wht-remittance",   label: "WHT Remittance",         icon: FaReceipt },
          ],
        },
        {
          id: "acc-period-management",
          label: "Period Management",
          icon: FaCalendarAlt,
          submenu: [
            { id: "acc-accounting-periods", label: "Accounting Periods",  icon: FaCalendarAlt },
            { id: "acc-year-end-close",     label: "Year-End Close",      icon: FaArchive },
            { id: "acc-gl-integrity",       label: "GL Health Centre",    icon: FaShieldAlt },
          ],
        },
        {
          id: "help",
          label: "Help",
          icon: FaInfoCircle,
          submenu: [
            { id: "documentation", label: "Documentation", icon: FaBook },
            { id: "support",       label: "Support",       icon: FaHeadset },
            { id: "about",         label: "About",         icon: FaInfoCircle },
          ],
        },
      ];
      return filterMenuByPermissions(accountsItems, currentUser, activeCompanyContext);
    }

    if (isCarWashWorkspace) {
      const carWashItems = [
        {
          id: "carwash-operations",
          label: "Operations",
          icon: FaCar,
          submenu: [
            { id: "carwash-dashboard", label: "Dashboard",   icon: FaChartBar },
            { id: "carwash-jobs",      label: "Jobs",        icon: FaCar },
            { id: "carwash-washboard", label: "Washboard",   icon: FaList },
          ],
        },
        {
          id: "carwash-customers",
          label: "Customers",
          icon: FaUsers,
          submenu: [
            { id: "carwash-all-customers",   label: "All Customers",      icon: FaUsers },
            { id: "carwash-accounts",        label: "Credit Accounts",    icon: FaFileInvoice },
            { id: "carwash-credit-balances", label: "Credit Balances",    icon: FaWallet },
            { id: "carwash-loyalty",         label: "Loyalty Program",    icon: FaStar },
          ],
        },
        {
          id: "carwash-finance",
          label: "Finance",
          icon: FaMoneyBillWave,
          submenu: [
            { id: "carwash-payments", label: "Payments", icon: FaMoneyBillWave },
            { id: "carwash-mpesa-notifications", label: "M-Pesa Notifications", icon: FaPhone },
            { id: "carwash-deposits", label: "Deposits", icon: FaCoins },
            { id: "carwash-expenses", label: "Expenses", icon: FaFileInvoice },
          ],
        },
        {
          id: "carwash-accounting",
          label: "Accounting",
          icon: FaLayerGroup,
          submenu: [
            { id: "carwash-cashbooks",           label: "Cashbooks",          icon: FaCoins },
            { id: "carwash-chart-of-accounts",  label: "Chart of Accounts",  icon: FaLayerGroup },
          ],
        },
        {
          id: "carwash-commissions-group",
          label: "Commissions",
          icon: FaHandshake,
          submenu: [
            { id: "carwash-commissions",        label: "Commission Ledger", icon: FaChartLine },
            { id: "carwash-commission-payouts", label: "Payouts",           icon: FaMoneyBillWave },
            { id: "carwash-commission-rules",   label: "Rules",             icon: FaCog },
            { id: "carwash-staff-savings",      label: "Staff Savings",     icon: FaCoins },
            { id: "carwash-staff-damages",      label: "Staff Damages",     icon: FaExclamationTriangle },
          ],
        },
        {
          id: "carwash-reporting",
          label: "Reports",
          icon: FaChartBar,
          submenu: [
            { id: "carwash-reports",        label: "Daily / Weekly / Monthly", icon: FaChartLine },
            { id: "carwash-service-report", label: "Service Report",           icon: FaChartBar },
            { id: "carwash-staff-report",   label: "Staff Report",             icon: FaUsers },
            { id: "carwash-expense-report", label: "Expenses Report",          icon: FaFileInvoice },
          ],
        },
        {
          id: "carwash-setup",
          label: "Setup",
          icon: FaCog,
          submenu: [
            { id: "carwash-services", label: "Services",             icon: FaCog },
            { id: "carwash-staff",    label: "Staff",                icon: FaUsers },
            { id: "carwash-branches", label: "Branches",             icon: FaCodeBranch },
            { id: "carwash-settings", label: "Operational Settings", icon: FaCog },
          ],
        },
      ];

      return filterMenuByPermissions(carWashItems, currentUser, activeCompanyContext);
    }

    if (isInventoryWorkspace) {
      const inventoryItems = [
        {
          id: "inv-pos",
          label: "Point of Sale",
          icon: FaCashRegister,
          submenu: [
            { id: "pos-terminal", label: "POS Terminal",  icon: FaCashRegister },
            { id: "pos-sales",    label: "Sales History", icon: FaFileInvoice },
          ],
        },
        {
          id: "inv-catalog",
          label: "Products",
          icon: FaBoxes,
          submenu: [
            { id: "inv-products",   label: "Product Catalogue", icon: FaBoxes },
            { id: "inv-categories", label: "Categories",        icon: FaTag },
          ],
        },
        {
          id: "inv-stock-ops",
          label: "Stock",
          icon: FaExchangeAlt,
          submenu: [
            { id: "inv-dashboard",       label: "Stock Overview",    icon: FaChartBar },
            { type: "separator" },
            { id: "inv-stock-movements", label: "Movements Ledger",  icon: FaList },
            { id: "inv-adjustments",     label: "Adjustments",       icon: FaClipboard },
            { id: "inv-transfers",       label: "Stock Transfers",   icon: FaExchangeAlt },
            { type: "separator" },
            { id: "inv-valuation",       label: "Stock Valuation",   icon: FaChartPie },
          ],
        },
        {
          id: "inv-purchasing",
          label: "Purchasing",
          icon: FaFileInvoice,
          submenu: [
            { id: "inv-purchase-orders", label: "Purchase Orders", icon: FaFileInvoice },
            { id: "inv-suppliers",       label: "Suppliers",       icon: FaUsers },
          ],
        },
        {
          id: "inv-tills-sessions",
          label: "Tills & Sessions",
          icon: FaCashRegister,
          submenu: [
            { id: "inv-tills",    label: "Tills / Registers", icon: FaCashRegister },
            { type: "separator" },
            { id: "pos-sessions", label: "Sessions",          icon: FaList },
          ],
        },
        {
          id: "inv-setup",
          label: "Setup",
          icon: FaCog,
          submenu: [
            { id: "inv-locations", label: "Locations / Branches", icon: FaWarehouse },
          ],
        },
      ];
      return filterMenuByPermissions(inventoryItems, currentUser, activeCompanyContext);
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
        label: "Billing",
        icon: FaFileInvoice,
        submenu: [
          { id: "rental-invoicing", label: "Rental Invoicing", hasSubmenu: true, icon: FaFileInvoice, category: "invoicing", categoryColor: "#4F46E5" },
          { id: "rental-receipting", label: "Rental Receipting", hasSubmenu: true, icon: FaReceipt, category: "receipting", categoryColor: "#10B981" },
          { type: "separator" },
          { id: "landlord-payments", label: "Landlord Payments", hasSubmenu: true, icon: FaHandHolding, category: "landlord", categoryColor: "#8B5CF6" },
        ],
      },
      {
        id: "reports",
        label: "Reports",
        icon: FaChartBar,
        submenu: [
          { id: "rental-collection", label: "Rental Collection Report", icon: FaChartBar },
          { id: "property-income-summary", label: "Property Income Summary", icon: FaChartLine },
          { id: "mri-tax-summary", label: "MRI Tax Summary", icon: FaCalculator },
          { id: "paid-balance", label: "Paid & Balance Report", icon: FaChartLine },
          { id: "aged-analysis", label: "Aged Analysis", icon: FaChartPie },
          { type: "separator" },
          { id: "commission-reports", label: "Commission Reports", icon: FaMoneyBillWave },
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
        if (!isLandlordMode) {
          if (item.id === "reports") {
            return {
              ...item,
              submenu: item.submenu.filter((subItem) => subItem.id !== "mri-tax-summary"),
            };
          }
          return item;
        }

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
            label: "Income & Expenses",
            submenu: [
              ...item.submenu
                .filter((subItem) => subItem.id !== "landlord-payments")
                .map((subItem) => {
                  if (subItem.id === "rental-invoicing") return { ...subItem, label: "Tenant Invoicing" };
                  if (subItem.id === "rental-receipting") return { ...subItem, label: "Rent Collections" };
                  return subItem;
                }),
              { id: "property-expenses", label: "Property Expenses", icon: FaMoneyBillWave },
            ],
          };
        }

        if (item.id === "reports") {
          return {
            ...item,
            label: "Portfolio Reports",
            submenu: item.submenu
              .filter((subItem) => !["commission-reports"].includes(subItem.id))
              .map((subItem) => {
                if (subItem.id === "rental-collection") return { ...subItem, label: "Rent Collection Report" };
                if (subItem.id === "property-income-summary") return { ...subItem, label: "Income & Expense Summary" };
                if (subItem.id === "mri-tax-summary") return { ...subItem, label: "Rental Income Tax (MRI)" };
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
  }, [activeCompanyContext, currentUser, isAccountsWorkspace, isCarWashWorkspace, isCommunicationsWorkspace, isCompanySetupWorkspace, isHumanResourceWorkspace, isLandlordMode, isPropertySaleWorkspace, isSystemAdminWorkspace]);

  const nestedSubmenus = useMemo(() => {
    if (isSystemAdminWorkspace || isCompanySetupWorkspace || isAccountsWorkspace || isCarWashWorkspace || isPropertySaleWorkspace || isHumanResourceWorkspace || isCommunicationsWorkspace) {
      return {};
    }

    const submenus = {
      "rental-invoicing": [
        { id: "rental-invoices-list", label: "Rental Invoices", icon: FaFileInvoice },
        { id: "new-invoice", label: "Create New Invoice", icon: FaFileInvoice },
        { id: "credit-debit-notes", label: "Credit & Debit Notes", icon: FaFileInvoice },
        { id: "late-penalties", label: "Late Penalties - Invoices", icon: FaExclamationTriangle },
        { id: "meter-readings", label: "Meter Readings", icon: FaDatabase },
        { type: "separator" },
        { id: "rental-invoices-vat", label: "Rental Invoices V.A.T", icon: FaFileInvoice },
        { id: "rental-aged-analysis", label: "Rental Aged Analysis", icon: FaChartBar },
      ],
      "rental-receipting": [
        { id: "rental-receipts", label: "Rental Receipts", icon: FaReceipt },
        { id: "mpesa-collections", label: "M-Pesa Collections",  icon: FaPhone },
        { id: "coop-collections",  label: "Co-op Collections",   icon: FaPhone },
        { id: "tenant-prepayments", label: "Tenants Prepayments", icon: FaCoins },
        { id: "instant-receipts", label: "Instant Receipts", icon: FaReceipt },
        { id: "landlord-receipt", label: "Landlord Receipts", icon: FaReceipt },
      ],
      "landlord-payments": [
        { id: "commission-landlord-statement", label: "Commissions & LL Statement", icon: FaFileAlt },
        { id: "landlord-standing-orders", label: "Landlord Standing Orders", icon: FaCalendarAlt },
        { id: "landlord-advancement", label: "Landlord Advancement", icon: FaMoneyBillWave },
        { id: "processed-statements", label: "Processed Statements (Legacy)", icon: FaCheckCircle },
        ...(currentUser?.isSystemAdmin || currentUser?.superAdminAccess
          ? [{ id: "statement-allocations", label: "Statement Allocations", icon: FaExchangeAlt }]
          : []),
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
      delete submenus["landlord-payments"];
      // property-expenses links directly — no nested submenu needed
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
  }, [activeCompanyContext, currentUser, isAccountsWorkspace, isCarWashWorkspace, isCommunicationsWorkspace, isCompanySetupWorkspace, isHumanResourceWorkspace, isLandlordMode, isPropertySaleWorkspace, isSystemAdminWorkspace]);

  const handleMenuItemClick = useCallback((menuId) => {
    const route = routeConfig[menuId];
    if (!route) return;
    if (route.startsWith("coming-soon:")) {
      const feature = route.replace("coming-soon:", "");
      toast.info(`${feature} is coming soon.`, { autoClose: 2500 });
      setActiveMenu(null);
      clearHoverCloseTimer();
      setHoveredFinancialItem(null);
      return;
    }
    navigate(route);
    setActiveMenu(null);
    clearHoverCloseTimer();
    setHoveredFinancialItem(null);
  }, [routeConfig, navigate, clearHoverCloseTimer]);

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
              <FinancialDropdown
                categoryId={item.id}
                items={nestedSubmenus[item.id]}
                darkMode={darkMode}
                onMenuEnter={openHoveredFinancialItem}
                onMenuLeave={closeHoveredFinancialItem}
                onItemClick={handleMenuItemClick}
              />
            ) : (
              <ProfessionalDropdown
                menuId={item.id}
                items={nestedSubmenus[item.id]}
                darkMode={darkMode}
                onMenuEnter={openHoveredFinancialItem}
                onMenuLeave={closeHoveredFinancialItem}
                onItemClick={handleMenuItemClick}
              />
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

      <div className={`relative z-50 flex min-h-[22px] items-center overflow-visible ${darkMode ? "bg-gray-800" : "bg-[#0A400C]"}`}>
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
              item.id === "help" ? (
                <HelpMegaPanel
                  darkMode={darkMode}
                  navigate={navigate}
                  onClose={() => setActiveMenu(null)}
                />
              ) : (
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
              )
            )}
          </div>
        ))}

        <div className="flex-1" />

        {isHumanResourceWorkspace && (
        <div className="flex items-center space-x-1 px-1.5 py-0 text-[11px]">
          <button
            onClick={() => navigate("/hr/employees/new")}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="Add Employee"
          >
            <FaUserPlus className="xl:hidden shrink-0" aria-hidden="true" />
            <span className="hidden xl:inline">+ Employee</span>
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
            onClick={() => navigate("/hr/setup")}
            className={`rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="HR Setup"
          >
            <FaCog aria-hidden="true" />
          </button>
        </div>
        )}
        {isAccountsWorkspace && (
        <div className="flex items-center space-x-1 px-1.5 py-0 text-[11px]">
          <button
            onClick={() => navigate("/accounts/journals")}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="New Journal Entry"
          >
            <FaBook className="xl:hidden shrink-0" aria-hidden="true" />
            <span className="hidden xl:inline">+ Journal</span>
          </button>
          <button
            onClick={() => navigate("/accounts/payment-vouchers/new")}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="New Voucher"
          >
            <FaFileInvoice className="xl:hidden shrink-0" aria-hidden="true" />
            <span className="hidden xl:inline">+ Voucher</span>
          </button>
          <div className={`h-5 w-px ${darkMode ? "bg-gray-600" : "bg-gray-300"} mx-1`} />
          <button
            onClick={() => window.location.reload()}
            className={`rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="Refresh"
          >
            <FaRedoAlt aria-hidden="true" />
          </button>
        </div>
        )}
        {!isAccountsWorkspace && !isCarWashWorkspace && !isPropertySaleWorkspace && !isHumanResourceWorkspace && !isCommunicationsWorkspace && !isInventoryWorkspace && !isCompanySetupWorkspace && !isSystemAdminWorkspace && (
        <div className="flex items-center space-x-1 px-1.5 py-0 text-[11px]">
          <button
            onClick={() => navigate("/tenant/new")}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="New Tenant"
          >
            <FaUserPlus className="xl:hidden shrink-0" aria-hidden="true" />
            <span className="hidden xl:inline">+ Tenant</span>
          </button>
          <button
            onClick={() => navigate("/invoices/new")}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="New Invoice"
          >
            <FaFileInvoice className="xl:hidden shrink-0" aria-hidden="true" />
            <span className="hidden xl:inline">+ Invoice</span>
          </button>
          <button
            onClick={() => navigate("/receipts")}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-500 text-gray-200"}`}
            title="Receive Payment"
          >
            <FaReceipt className="xl:hidden shrink-0" aria-hidden="true" />
            <span className="hidden xl:inline">+ Payment</span>
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
        )}
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

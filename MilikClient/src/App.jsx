import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import ScrollToTop from "./components/common/ScrollToTop";
import { useDispatch, useSelector } from "react-redux";
import { clearCurrentCompany, getCompanySuccess, setCurrentCompany } from "./redux/companiesRedux";
import { initializeAuth } from "./redux/authSlice";
import { getAccessibleCompanies } from "./redux/apiCalls";
import useInactivityLogout from "./hooks/useInactivityLogout";
import { clearClientSessionStorage } from "./utils/sessionCleanup";
import { hasSessionTimedOut } from "./utils/sessionTimeout";
import "./App.css";
import { checkUserModuleAccess, hasCompanyPermission } from "./utils/permissions";
import { GL_ACCESS_MODULES, hasAnyCompanyModule, hasCompanyModule, isPropertyManagerCompany, isSelfManagingLandlordCompany } from "./utils/companyModules";
import { ConfirmProvider } from "./context/ConfirmContext";
import { ESSContextProvider } from "./context/ESSContext";

// ─── Page loader shown while lazy chunks are downloading ─────────────────────
const PageLoader = () => (
  <div className="flex h-screen items-center justify-center bg-slate-50">
    <div className="flex flex-col items-center gap-3">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[#027333]" />
      <span className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Loading</span>
    </div>
  </div>
);

// ─── Lazy page imports ────────────────────────────────────────────────────────
// Public / auth
const NotFound          = lazy(() => import("./pages/NotFound/NotFound"));
const Home              = lazy(() => import("./pages/Home/Home"));
const RentalListings    = lazy(() => import("./pages/Listings/RentalListings"));
const DemoAccessEntry   = lazy(() => import("./pages/Home/DemoAccessEntry"));

// Module landing pages (public, SEO-indexed)
const PropertyPage      = lazy(() => import("./pages/Modules/PropertyPage"));
const CarWashPage       = lazy(() => import("./pages/Modules/CarWashPage"));
const HRPage            = lazy(() => import("./pages/Modules/HRPage"));
const InventoryPage     = lazy(() => import("./pages/Modules/InventoryPage"));
const PropertySalesPage = lazy(() => import("./pages/Modules/PropertySalesPage"));
const Login             = lazy(() => import("./pages/Login/Login"));
const SetupAdmin        = lazy(() => import("./pages/Login/SetupAdmin"));
const FirstTimePassword = lazy(() => import("./pages/Login/FirstTimePassword"));

// ESS Portal
const ESSLogin      = lazy(() => import("./pages/ESS/ESSLogin"));
const ESSLayout     = lazy(() => import("./pages/ESS/ESSLayout"));
const ESSDashboard  = lazy(() => import("./pages/ESS/ESSDashboard"));
const ESSPayslips   = lazy(() => import("./pages/ESS/ESSPayslips"));
const ESSLeave      = lazy(() => import("./pages/ESS/ESSLeave"));
const ESSAttendance = lazy(() => import("./pages/ESS/ESSAttendance"));
const ESSLetters    = lazy(() => import("./pages/ESS/ESSLetters"));
const ESSProfile      = lazy(() => import("./pages/ESS/ESSProfile"));
const ESSAppraisals   = lazy(() => import("./pages/ESS/ESSAppraisals"));

// Core
const ModulesDashboard  = lazy(() => import("./pages/moduleDashboard/ModulesDashboard"));
const Dashboard         = lazy(() => import("./pages/Dashboard/Dashboard"));
const MyAccount         = lazy(() => import("./pages/Account/MyAccount"));
const SmsManager        = lazy(() => import("./pages/Communications/SmsManager"));
const EmailManager      = lazy(() => import("./pages/Communications/EmailManager"));
const CompanySetupPage  = lazy(() => import("./pages/companySetup/CompanySetupPage"));
const SystemSetupPage   = lazy(() => import("./pages/SystemSetup/SystemSetup"));
const AddCompanyWizard  = lazy(() => import("./pages/SystemSetup/AddCompanyWizard"));
const AddUserPage       = lazy(() => import("./pages/SystemSetup/AddUsers"));
const CompanyUsers      = lazy(() => import("./pages/Users/CompanyUsers"));
const CompanySettings   = lazy(() => import("./pages/SystemSetup/CompanySettings"));

// Landlords
const Landlords                      = lazy(() => import("./pages/Landlord/Landlord"));
const AddLandlord                    = lazy(() => import("./components/Landlord/AddLandlord"));
const LandlordPayments               = lazy(() => import("./pages/Landlord/LandlordPayments"));
const LandlordPaymentHistory         = lazy(() => import("./pages/Landlord/LandlordPaymentHistory"));
const LandlordReceipts               = lazy(() => import("./pages/Landlord/LandlordReceipts"));
const LandlordCommissionsStatement   = lazy(() => import("./pages/Landlord/LandlordCommissionsStatement"));
const LandlordStandingOrders         = lazy(() => import("./pages/Landlord/LandlordStandingOrders"));
const LandlordAdvancements           = lazy(() => import("./pages/Landlord/LandlordAdvancements"));
const ProcessedStatements            = lazy(() => import("./pages/Landlord/ProcessedStatements"));
const LandlordStatementAllocations   = lazy(() => import("./pages/Admin/LandlordStatementAllocations"));

// Properties & Units
const Properties                  = lazy(() => import("./pages/Properties/Properties"));
const PropertyCommissionSettings  = lazy(() => import("./pages/Properties/PropertyCommissionSettings"));
const CommissionsList             = lazy(() => import("./pages/Properties/CommissionsList"));
const PropertyExpenses            = lazy(() => import("./pages/Properties/PropertyExpenses"));
const Units                       = lazy(() => import("./pages/Units/Units"));
const AddUnit                     = lazy(() => import("./components/Units/AddUnit"));
const AddProperty                 = lazy(() => import("./components/Properties/AddProperties"));
const EditProperty                = lazy(() => import("./components/Properties/EditProperties"));
const PropertyDetail              = lazy(() => import("./components/Properties/PropertyDetail"));

// Tenants
const Tenants             = lazy(() => import("./pages/Tenants/Tenants"));
const TerminatedTenants   = lazy(() => import("./pages/Tenants/TerminatedTenants"));
const AddTenant           = lazy(() => import("./pages/Tenants/AddTenant"));
const TenantStatement     = lazy(() => import("./pages/Tenants/TenantStatement"));
const RentalInvoices      = lazy(() => import("./pages/Tenants/RentalInvoices"));
const Receipts            = lazy(() => import("./pages/Tenants/Receipts"));
const InvoiceNotes        = lazy(() => import("./pages/Tenants/InvoiceNotes"));
const AddReceipt          = lazy(() => import("./pages/Tenants/AddReceipt"));
const TenantDeposits      = lazy(() => import("./pages/Tenants/TenantDeposits"));
const TenantPrepayments   = lazy(() => import("./pages/Tenants/TenantPrepayments"));
const InstantReceipts     = lazy(() => import("./pages/Tenants/InstantReceipts"));
const TakeOnBalances      = lazy(() => import("./pages/Tenants/TakeOnBalances"));
const TenantAgreements    = lazy(() => import("./pages/Tenants/TenantAgreements"));
const PmsMpesaNotifications   = lazy(() => import("./pages/Tenants/PmsMpesaNotifications"));

// Lease / Vacants / Ops
const UnitTypesPage  = lazy(() => import("./pages/Lease/Lease"));
const Vacants        = lazy(() => import("./pages/Vacants/Vacants"));
const Maintenances   = lazy(() => import("./pages/Maintenances/Maintenances"));
const Inspections    = lazy(() => import("./pages/Inspections/Inspections"));
const MeterReadings  = lazy(() => import("./pages/Tools/MeterReadings"));
const LatePenalties  = lazy(() => import("./pages/Tools/LatePenalties"));

// Financial Accounts module
const AccountsDashboard     = lazy(() => import("./pages/Accounts/AccountsDashboard"));

// Financial
const PaymentVouchers       = lazy(() => import("./pages/Financial/PaymentVouchers"));
const PettyCash             = lazy(() => import("./pages/Financial/PettyCash"));
const ServiceProviders      = lazy(() => import("./pages/Financial/ServiceProviders"));
const ExpenseRequisition    = lazy(() => import("./pages/Financial/ExpenseRequisition"));
const ChartOfAccounts       = lazy(() => import("./pages/Financial/ChartOfAccounts"));
const LedgerAccountActivity = lazy(() => import("./pages/Financial/LedgerAccountActivity"));
const JournalEntries        = lazy(() => import("./pages/Financial/JournalEntries"));

// Reports
const RentalCollectionReport      = lazy(() => import("./pages/Reports/RentalCollectionReport"));
const PropertyIncomeSummaryReport = lazy(() => import("./pages/Reports/PropertyIncomeSummaryReport"));
const MRITaxSummaryReport         = lazy(() => import("./pages/Reports/MRITaxSummaryReport"));
const RentalInvoiceVATReport      = lazy(() => import("./pages/Reports/RentalInvoiceVATReport"));
const RentalAgedAnalysisReport    = lazy(() => import("./pages/Reports/RentalAgedAnalysisReport"));
const PaidBalanceReport           = lazy(() => import("./pages/Reports/PaidBalanceReport"));
const AgedAnalysisReport          = lazy(() => import("./pages/Reports/AgedAnalysisReport"));
const CommissionReports           = lazy(() => import("./pages/Reports/CommissionReports"));
const TrialBalanceReport          = lazy(() => import("./pages/Reports/TrialBalanceReport"));
const IncomeStatementReport       = lazy(() => import("./pages/Reports/IncomeStatementReport"));
const BalanceSheetReport          = lazy(() => import("./pages/Reports/BalanceSheetReport"));
const TaxReports                  = lazy(() => import("./pages/Reports/TaxReports"));
const CashFlowReport              = lazy(() => import("./pages/Reports/CashFlowReport"));
const ArrearsAgedAnalysis         = lazy(() => import("./pages/Reports/ArrearsAgedAnalysis"));
const PaymentAgedAnalysis         = lazy(() => import("./pages/Reports/PaymentAgedAnalysis"));
const BankReconciliation          = lazy(() => import("./pages/Accounts/BankReconciliation"));
const FixedAssets                 = lazy(() => import("./pages/Accounts/FixedAssets"));
const FixedAssetsDepreciation     = lazy(() => import("./pages/Accounts/FixedAssetsDepreciation"));
const BudgetVsActual              = lazy(() => import("./pages/Accounts/BudgetVsActual"));
const CreditorLedger              = lazy(() => import("./pages/Accounts/CreditorLedger"));
const GLIntegrityReport           = lazy(() => import("./pages/Accounts/GLIntegrityReport"));
const AccountingPeriods           = lazy(() => import("./pages/Financial/AccountingPeriods"));
const YearEndClose                = lazy(() => import("./pages/Financial/YearEndClose"));
const VatRemittance               = lazy(() => import("./pages/Financial/VatRemittance"));
const WhtRemittance               = lazy(() => import("./pages/Financial/WhtRemittance"));
const FinancialRatiosDashboard    = lazy(() => import("./pages/Reports/FinancialRatiosDashboard"));

// Help
const SupportDocumentation = lazy(() => import("./pages/Help/SupportDocumentation"));
const AboutMilik           = lazy(() => import("./pages/Help/AboutMilik"));

// Car Wash module
const CarWashDashboard      = lazy(() => import("./pages/CarWash/CarWashDashboard"));
const CarWashJobs           = lazy(() => import("./pages/CarWash/CarWashJobs"));
const CarWashWashboard      = lazy(() => import("./pages/CarWash/CarWashWashboard"));
const CarWashAddJob         = lazy(() => import("./pages/CarWash/CarWashAddJob"));
const CarWashAccounts       = lazy(() => import("./pages/CarWash/CarWashAccounts"));
const CarWashCustomers       = lazy(() => import("./pages/CarWash/CarWashCustomers"));
const CarWashOpeningBalances  = lazy(() => import("./pages/CarWash/CarWashOpeningBalances"));
const CarWashCreditBalances   = lazy(() => import("./pages/CarWash/CarWashCreditBalances"));
const CarWashServices       = lazy(() => import("./pages/CarWash/CarWashServices"));
const CarWashPayments       = lazy(() => import("./pages/CarWash/CarWashPayments"));
const CarWashDeposits       = lazy(() => import("./pages/CarWash/CarWashDeposits"));
const CarWashExpenses       = lazy(() => import("./pages/CarWash/CarWashExpenses"));
const CarWashCashbooks      = lazy(() => import("./pages/CarWash/CarWashCashbooks"));
const CarWashStaff          = lazy(() => import("./pages/CarWash/CarWashStaff"));
const CarWashReports        = lazy(() => import("./pages/CarWash/CarWashReports"));
const CarWashServiceReport  = lazy(() => import("./pages/CarWash/CarWashServiceReport"));
const CarWashStaffReport    = lazy(() => import("./pages/CarWash/CarWashStaffReport"));
const CarWashExpensesReport = lazy(() => import("./pages/CarWash/CarWashExpensesReport"));
const CarWashCommissions         = lazy(() => import("./pages/CarWash/CarWashCommissions"));
const CarWashCommissionPayouts   = lazy(() => import("./pages/CarWash/CarWashCommissionPayouts"));
const CarWashCommissionRules     = lazy(() => import("./pages/CarWash/CarWashCommissionRules"));
const CarWashStaffSavings        = lazy(() => import("./pages/CarWash/CarWashStaffSavings"));
const CarWashStaffDamages        = lazy(() => import("./pages/CarWash/CarWashStaffDamages"));
const CarWashLoyalty             = lazy(() => import("./pages/CarWash/CarWashLoyalty"));
const CarWashBranches       = lazy(() => import("./pages/CarWash/CarWashBranches"));
const CarWashSettings            = lazy(() => import("./pages/CarWash/CarWashSettings"));
const CarWashMpesaNotifications  = lazy(() => import("./pages/CarWash/CarWashMpesaNotifications"));
const CarWashQueueDisplay        = lazy(() => import("./pages/CarWash/CarWashQueueDisplay"));

// Inventory & POS module
const InventoryDashboard    = lazy(() => import("./pages/Inventory/InventoryDashboard"));
const InvLocations          = lazy(() => import("./pages/Inventory/InvLocations"));
const InvCategories         = lazy(() => import("./pages/Inventory/InvCategories"));
const InvProducts           = lazy(() => import("./pages/Inventory/InvProducts"));
const InvSuppliers          = lazy(() => import("./pages/Inventory/InvSuppliers"));
const InvPurchaseOrders     = lazy(() => import("./pages/Inventory/InvPurchaseOrders"));
const InvStockTransfers     = lazy(() => import("./pages/Inventory/InvStockTransfers"));
const InvStockMovements     = lazy(() => import("./pages/Inventory/InvStockMovements"));
const InvStockAdjustments  = lazy(() => import("./pages/Inventory/InvStockAdjustments"));
const InvStockValuation    = lazy(() => import("./pages/Inventory/InvStockValuation"));
const InvLowStock          = lazy(() => import("./pages/Inventory/InvLowStock"));
const InvTills              = lazy(() => import("./pages/Inventory/InvTills"));
const POSTerminal           = lazy(() => import("./pages/Inventory/POSTerminal"));
const POSSalesHistory       = lazy(() => import("./pages/Inventory/POSSalesHistory"));
const POSSessions           = lazy(() => import("./pages/Inventory/POSSessions"));

// HR module
const HRFinancials       = lazy(() => import("./pages/HR/HRFinancials"));
const HRDashboard        = lazy(() => import("./pages/HR/HRDashboard"));
const HREmployees        = lazy(() => import("./pages/HR/Employees"));
const HRAddEmployee      = lazy(() => import("./pages/HR/AddEmployee"));
const HREmployeeProfile  = lazy(() => import("./pages/HR/EmployeeProfile"));
const HRSetup            = lazy(() => import("./pages/HR/HRSetup"));
const HRLeaveApplications  = lazy(() => import("./pages/HR/LeaveApplications"));
const HRLeaveTypes         = lazy(() => import("./pages/HR/LeaveTypes"));
const HRPayrollPeriods      = lazy(() => import("./pages/HR/PayrollPeriods"));
const HRPayrollPeriodDetail = lazy(() => import("./pages/HR/PayrollPeriodDetail"));
const HRPayslip             = lazy(() => import("./pages/HR/Payslip"));
const HRReportHeadcount     = lazy(() => import("./pages/HR/HRReportHeadcount"));
const HRReportPayroll       = lazy(() => import("./pages/HR/HRReportPayroll"));
const HRReportLeave         = lazy(() => import("./pages/HR/HRReportLeave"));
const HRReportP9            = lazy(() => import("./pages/HR/HRReportP9"));
const HRLeaveBalances       = lazy(() => import("./pages/HR/LeaveBalances"));
const HRStatutoryDeductions = lazy(() => import("./pages/HR/StatutoryDeductions"));
const HRKpiLibrary          = lazy(() => import("./pages/HR/KpiLibrary"));
const HRAppraisalCycles     = lazy(() => import("./pages/HR/AppraisalCycles"));
const HRAppraisals          = lazy(() => import("./pages/HR/Appraisals"));
const HRPayrollRegister     = lazy(() => import("./pages/HR/HRPayrollRegister"));
const HRRemittance          = lazy(() => import("./pages/HR/HRRemittance"));
const HRLetters             = lazy(() => import("./pages/HR/HRLetters"));
const HRAttendance          = lazy(() => import("./pages/HR/HRAttendance"));
const HRReportAttendance    = lazy(() => import("./pages/HR/HRReportAttendance"));

// Property Sale module
const PropertySaleDashboard = lazy(() => import("./pages/PropertySale/PropertySaleDashboard"));
const SaleListings          = lazy(() => import("./pages/PropertySale/SaleListings"));
const SaleBuyers            = lazy(() => import("./pages/PropertySale/SaleBuyers"));
const SaleAgents            = lazy(() => import("./pages/PropertySale/SaleAgents"));
const SaleOffers            = lazy(() => import("./pages/PropertySale/SaleOffers"));
const SaleDeals             = lazy(() => import("./pages/PropertySale/SaleDeals"));
const SalePayments          = lazy(() => import("./pages/PropertySale/SalePayments"));
const SaleCommissions       = lazy(() => import("./pages/PropertySale/SaleCommissions"));
const SaleReports           = lazy(() => import("./pages/PropertySale/SaleReports"));
const SaleMonthlyDetail     = lazy(() => import("./pages/PropertySale/SaleMonthlyDetail"));
const SaleFinancials        = lazy(() => import("./pages/PropertySale/SaleFinancials"));
const SaleLeads             = lazy(() => import("./pages/PropertySale/SaleLeads"));
const SaleActivities        = lazy(() => import("./pages/PropertySale/SaleActivities"));

// ─── Constants ────────────────────────────────────────────────────────────────
const DEMO_EXPIRED_NOTICE_KEY = "milik_demo_expired_notice";
const DEMO_EXPIRED_MESSAGE = "Your demo period has ended. Contact MILIK for activation.";
const EXTRA_SESSION_KEYS = ["milik_active_company_id", "milik_demo_mode", "milik_demo_company_id"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getStoredUser = () => {
  try {
    const raw = localStorage.getItem("milik_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const decodeTokenPayload = (token) => {
  try {
    if (!token || typeof token !== "string") return null;
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
};

const isTokenExpired = (token) => {
  const payload = decodeTokenPayload(token);
  if (!payload?.exp) return false;
  return Date.now() >= Number(payload.exp) * 1000;
};

const clearExpiredStoredSession = (isDemoUser = false) => {
  clearClientSessionStorage();
  EXTRA_SESSION_KEYS.forEach((key) => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  });
  if (isDemoUser) {
    try { sessionStorage.setItem(DEMO_EXPIRED_NOTICE_KEY, DEMO_EXPIRED_MESSAGE); } catch { /* ignore */ }
  }
};

const getStoredAuthSession = () => {
  const token = localStorage.getItem("milik_token");
  if (!token) return { token: null, user: null };

  const user = getStoredUser();
  if (hasSessionTimedOut()) {
    clearExpiredStoredSession(Boolean(user?.isDemoUser));
    return { token: null, user: null };
  }
  if (isTokenExpired(token)) {
    const payload = decodeTokenPayload(token);
    clearExpiredStoredSession(Boolean(user?.isDemoUser || payload?.isDemoUser));
    return { token: null, user: null };
  }
  return { token, user };
};

const getResolvedAuthUser = (currentUser, storedSession = getStoredAuthSession()) =>
  currentUser || storedSession.user;

const hasDemoExpiredNotice = () => {
  try { return Boolean(sessionStorage.getItem(DEMO_EXPIRED_NOTICE_KEY)); } catch { return false; }
};

const getSignedOutRedirectPath = () =>
  hasDemoExpiredNotice() ? "/?demoExpired=1" : "/login";

// ─── Route guards ─────────────────────────────────────────────────────────────
// Single unified guard that replaces ProtectedRoute, CompanyModuleRoute,
// PermissionRoute, and CompanyModeRoute. Reads Redux state once per render.
//
// Props:
//   moduleKey   – company module key (string | string[]).
//                 Gates on: (a) module enabled for the company AND
//                           (b) user has at least view-only module-level access.
//   resource    – granular permission resource. When supplied, hasCompanyPermission
//                 runs the full check (module-level + granular + adminAccess).
//   action      – permission action (default "view").
//   companyMode – { allowLandlord?, allowManager?, allowOther?, fallback? }
//                 Replicates CompanyModeRoute behaviour inline.
//   fallback    – redirect when denied (default "/moduleDashboard").
//   allowMustChangePassword – set true only for /first-time-password itself.
function Guard({
  children,
  moduleKey   = null,
  resource    = null,
  action      = "view",
  companyMode = null,
  fallback    = "/moduleDashboard",
  allowMustChangePassword = false,
}) {
  const { currentUser }    = useSelector((state) => state.auth);
  const { currentCompany } = useSelector((state) => state.company);
  const storedSession = getStoredAuthSession();
  const resolvedUser  = getResolvedAuthUser(currentUser, storedSession);

  // 1. Authentication
  if (!resolvedUser && !storedSession.token) {
    return <Navigate to={getSignedOutRedirectPath()} replace />;
  }

  // 2. Force password change
  if (
    !allowMustChangePassword &&
    resolvedUser?.mustChangePassword &&
    !resolvedUser?.isSystemAdmin &&
    !resolvedUser?.superAdminAccess
  ) {
    return <Navigate to="/first-time-password" replace />;
  }

  // Super/sys admins bypass all module and permission checks
  if (resolvedUser?.isSystemAdmin || resolvedUser?.superAdminAccess) return children;

  const activeCompany = currentCompany || resolvedUser?.company || null;

  // 3. Company operating-mode gate (replaces CompanyModeRoute)
  if (companyMode) {
    const isLandlord = isSelfManagingLandlordCompany(activeCompany);
    const isManager  = isPropertyManagerCompany(activeCompany);
    const isOther    = !isLandlord && !isManager;
    const modeFallback = companyMode.fallback ?? "/dashboard";
    if (
      (isLandlord && companyMode.allowLandlord === false) ||
      (isManager  && companyMode.allowManager  === false) ||
      (isOther    && companyMode.allowOther    === false)
    ) {
      return <Navigate to={modeFallback} replace />;
    }
  }

  // 4. Company subscription check — is this module enabled for the company?
  if (moduleKey) {
    const enabled = Array.isArray(moduleKey)
      ? hasAnyCompanyModule(activeCompany, moduleKey)
      : hasCompanyModule(activeCompany, moduleKey);
    if (!enabled) return <Navigate to={fallback} replace />;
  }

  // 5. User-level access
  //    • With resource → hasCompanyPermission handles adminAccess + module-level +
  //      granular permissions in one call.
  //    • Without resource but with moduleKey → checkUserModuleAccess enforces
  //      moduleAccess != 'none', which is the check that was missing on dashboard
  //      routes and all HR / Property Sale routes.
  if (resource) {
    if (!hasCompanyPermission(resolvedUser, activeCompany, resource, action, moduleKey)) {
      return <Navigate to={fallback} replace />;
    }
  } else if (moduleKey) {
    const key = Array.isArray(moduleKey) ? moduleKey[0] : moduleKey;
    if (!checkUserModuleAccess(resolvedUser, activeCompany, key)) {
      return <Navigate to={fallback} replace />;
    }
  }

  return children;
}

function ESSProtectedRoute({ children }) {
  const token = localStorage.getItem('ess_token');
  if (!token) return <Navigate to="/ess/login" replace />;
  return children;
}

function SuperAdminRoute({ children }) {
  const { currentUser } = useSelector((state) => state.auth);
  const storedSession = getStoredAuthSession();
  const resolvedUser = getResolvedAuthUser(currentUser, storedSession);
  const isAuthenticated = Boolean(resolvedUser || storedSession.token);
  const canAccess = Boolean(resolvedUser?.isSystemAdmin || resolvedUser?.superAdminAccess);

  if (!isAuthenticated) return <Navigate to={getSignedOutRedirectPath()} replace />;
  return canAccess ? children : <Navigate to="/moduleDashboard" replace />;
}

function resolveDefaultAuthenticatedRoute(currentUser) {
  if (currentUser?.mustChangePassword && !currentUser?.isSystemAdmin && !currentUser?.superAdminAccess) {
    return "/first-time-password";
  }
  return currentUser?.isDemoUser ? "/dashboard" : "/moduleDashboard";
}

function PublicOnlyRoute({ children }) {
  const { currentUser } = useSelector((state) => state.auth);
  const storedSession = getStoredAuthSession();
  const resolvedUser = getResolvedAuthUser(currentUser, storedSession);
  const isAuthenticated = Boolean(resolvedUser || storedSession.token);

  if (!isAuthenticated) return children;
  return <Navigate to={resolveDefaultAuthenticatedRoute(resolvedUser)} replace />;
}

const PUBLIC_TITLE_PATHS = new Set(["/", "/login", "/property-management", "/car-wash", "/human-resources", "/inventory-pos", "/property-sales"]);

function AppDocumentTitleGuard() {
  const location = useLocation();

  useEffect(() => {
    // Only reset to "MILIK" for authenticated app routes.
    // Public pages (landing, login, module pages) manage their own titles.
    if (!PUBLIC_TITLE_PATHS.has(location.pathname)) {
      document.title = "MILIK";
    }
  }, [location.pathname]);

  return null;
}

function PublicEntryRoute() {
  const { currentUser } = useSelector((state) => state.auth);
  const storedSession = getStoredAuthSession();
  const resolvedUser = getResolvedAuthUser(currentUser, storedSession);
  const isAuthenticated = Boolean(resolvedUser || storedSession.token);

  if (isAuthenticated) return <Navigate to={resolveDefaultAuthenticatedRoute(resolvedUser)} replace />;
  return <Home />;
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const dispatch = useDispatch();
  const { currentUser } = useSelector((state) => state.auth);
  const { currentCompany, isSwitching: isCompanySwitching } = useSelector((state) => state.company);

  useInactivityLogout();

  useEffect(() => {
    if (currentUser) return;
    const { token, user: storedUser } = getStoredAuthSession();
    if (!token || !storedUser) return;
    dispatch(initializeAuth({ user: storedUser, token }));
  }, [currentUser, dispatch]);

  useEffect(() => {
    let cancelled = false;

    const syncActiveCompany = async () => {
      if (isCompanySwitching) return;

      const resolvedUser = getResolvedAuthUser(currentUser, getStoredAuthSession());
      if (!resolvedUser) return;

      const isSystemAdmin = Boolean(resolvedUser?.isSystemAdmin || resolvedUser?.superAdminAccess);
      const currentCompanyId = String(currentCompany?._id || "");
      const userCompany = resolvedUser?.company?._id ? resolvedUser.company : null;
      const userCompanyId = String(userCompany?._id || "");
      const preferredCompanyId = String(
        (resolvedUser?.isDemoUser
          ? localStorage.getItem("milik_demo_company_id") || localStorage.getItem("milik_active_company_id")
          : localStorage.getItem("milik_active_company_id")) || ""
      );

      const applyCompany = (company) => {
        if (!company?._id || cancelled) return;
        dispatch(setCurrentCompany(company));
        dispatch(getCompanySuccess(company));
        localStorage.setItem("milik_active_company_id", company._id);
        if (resolvedUser?.isDemoUser) {
          localStorage.setItem("milik_demo_mode", "true");
          localStorage.setItem("milik_demo_company_id", company._id);
        }
      };

      if (!isSystemAdmin && userCompanyId && (!preferredCompanyId || preferredCompanyId === userCompanyId)) {
        if (currentCompanyId !== userCompanyId) applyCompany(userCompany);
        else localStorage.setItem("milik_active_company_id", userCompanyId);
        return;
      }

      if (!isSystemAdmin && !preferredCompanyId && !userCompanyId) {
        if (currentCompanyId) {
          dispatch(clearCurrentCompany());
          localStorage.removeItem("milik_active_company_id");
        }
        return;
      }

      if (preferredCompanyId && currentCompanyId === preferredCompanyId) {
        localStorage.setItem("milik_active_company_id", preferredCompanyId);
        return;
      }

      try {
        const companies = await getAccessibleCompanies();
        if (cancelled) return;
        const availableCompanies = Array.isArray(companies) ? companies : [];
        const resolvedCompany =
          availableCompanies.find((c) => String(c?._id || "") === preferredCompanyId) ||
          availableCompanies.find((c) => String(c?._id || "") === userCompanyId) ||
          userCompany ||
          availableCompanies[0] ||
          null;
        if (resolvedCompany?._id) { applyCompany(resolvedCompany); return; }
      } catch (error) {
        console.error("Failed to rehydrate active company context:", error);
      }

      if (userCompanyId) { applyCompany(userCompany); return; }
      if (currentCompanyId) {
        dispatch(clearCurrentCompany());
        localStorage.removeItem("milik_active_company_id");
      }
    };

    syncActiveCompany();
    return () => { cancelled = true; };
  }, [currentUser, currentCompany?._id, dispatch, isCompanySwitching]);

  useEffect(() => {
    if (!currentCompany?._id) return;
    const resolvedUser = getResolvedAuthUser(currentUser, getStoredAuthSession());
    if (resolvedUser?.isDemoUser) {
      localStorage.setItem("milik_demo_mode", "true");
      localStorage.setItem("milik_demo_company_id", currentCompany._id);
      return;
    }
    localStorage.setItem("milik_active_company_id", currentCompany._id);
    localStorage.removeItem("milik_demo_mode");
    localStorage.removeItem("milik_demo_company_id");
  }, [currentCompany, currentUser]);

  return (
    <ESSContextProvider>
    <ConfirmProvider>
      <BrowserRouter>
        <ScrollToTop />
        <AppDocumentTitleGuard />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* ── Public display screens (no auth) ─────────────────────── */}
            <Route path="/display/carwash/:businessId" element={<CarWashQueueDisplay />} />
            <Route path="/listings/:businessId" element={<RentalListings />} />

            {/* ── Public ────────────────────────────────────────────────── */}
            <Route path="/" element={<PublicEntryRoute />} />
            <Route path="/home" element={<Navigate to="/" replace />} />
            <Route path="/property-management" element={<PropertyPage />} />
            <Route path="/car-wash" element={<CarWashPage />} />
            <Route path="/human-resources" element={<HRPage />} />
            <Route path="/inventory-pos" element={<InventoryPage />} />
            <Route path="/property-sales" element={<PropertySalesPage />} />
            <Route path="/trial-access" element={<PublicOnlyRoute><DemoAccessEntry /></PublicOnlyRoute>} />
            <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
            <Route path="/setup-admin" element={<SetupAdmin />} />
            <Route path="/first-time-password" element={<Guard allowMustChangePassword><FirstTimePassword /></Guard>} />

            {/* ── Core dashboards ───────────────────────────────────────── */}
            <Route path="/moduleDashboard" element={<Guard><ModulesDashboard /></Guard>} />
            <Route path="/dashboard"       element={<Guard moduleKey="propertyManagement"><Dashboard /></Guard>} />
            <Route path="/my-account"      element={<Guard><MyAccount /></Guard>} />
            <Route path="/communications/sms"   element={<Guard resource="communications"><SmsManager /></Guard>} />
            <Route path="/communications/email" element={<Guard resource="communications"><EmailManager /></Guard>} />

            {/* ── Financial Accounts module ─────────────────────────────── */}
            <Route path="/accounts" element={<Navigate to="/accounts/dashboard" replace />} />
            <Route path="/accounts/dashboard"                              element={<Guard moduleKey="accounts"><AccountsDashboard /></Guard>} />
            <Route path="/accounts/chart-of-accounts"                      element={<Guard moduleKey="accounts" resource="chartOfAccounts"><ChartOfAccounts /></Guard>} />
            <Route path="/accounts/chart-of-accounts/:accountId/activity"  element={<Guard moduleKey="accounts" resource="chartOfAccounts"><LedgerAccountActivity /></Guard>} />
            <Route path="/accounts/journals"                               element={<Guard moduleKey="accounts" resource="journals"><JournalEntries /></Guard>} />
            <Route path="/accounts/payment-vouchers"                       element={<Guard moduleKey="accounts" resource="paymentVouchers"><PaymentVouchers /></Guard>} />
            <Route path="/accounts/petty-cash"                             element={<Guard moduleKey="accounts" resource="pettyCash"><PettyCash /></Guard>} />
            <Route path="/accounts/expenses"                               element={<Guard moduleKey="accounts" resource="expenses"><ExpenseRequisition /></Guard>} />
            <Route path="/accounts/service-providers"                      element={<Guard moduleKey="accounts" resource="expenses"><ServiceProviders /></Guard>} />
            <Route path="/accounts/trial-balance"                          element={<Guard moduleKey="accounts" resource="financialReports"><TrialBalanceReport /></Guard>} />
            <Route path="/accounts/income-statement"                       element={<Guard moduleKey="accounts" resource="financialReports"><IncomeStatementReport /></Guard>} />
            <Route path="/accounts/balance-sheet"                          element={<Guard moduleKey="accounts" resource="financialReports"><BalanceSheetReport /></Guard>} />
            <Route path="/accounts/tax-reports"                            element={<Guard moduleKey="accounts" resource="financialReports"><TaxReports /></Guard>} />
            <Route path="/accounts/cash-flow"                              element={<Guard moduleKey="accounts" resource="financialReports"><CashFlowReport /></Guard>} />
            <Route path="/accounts/arrears-aged-analysis"                  element={<Guard moduleKey="accounts" resource="financialReports"><ArrearsAgedAnalysis /></Guard>} />
            <Route path="/accounts/payment-aged-analysis"                  element={<Guard moduleKey="accounts" resource="financialReports"><PaymentAgedAnalysis /></Guard>} />
            <Route path="/accounts/bank-reconciliation"                    element={<Guard moduleKey="accounts" resource="bankReconciliation"><BankReconciliation /></Guard>} />
            <Route path="/accounts/fixed-assets"                           element={<Guard moduleKey="accounts" resource="fixedAssets"><FixedAssets /></Guard>} />
            <Route path="/accounts/fixed-assets/depreciation"              element={<Guard moduleKey="accounts" resource="fixedAssets" action="depreciate"><FixedAssetsDepreciation /></Guard>} />
            <Route path="/accounts/budget"                                 element={<Guard moduleKey="accounts" resource="budgets"><BudgetVsActual /></Guard>} />
            <Route path="/accounts/budget/analysis"                        element={<Guard moduleKey="accounts" resource="budgets"><BudgetVsActual /></Guard>} />
            <Route path="/accounts/creditor-ledger"                        element={<Guard moduleKey="accounts" resource="creditorLedger"><CreditorLedger /></Guard>} />
            <Route path="/accounts/gl-integrity"                           element={<Guard moduleKey="accounts" resource="financialReports"><GLIntegrityReport /></Guard>} />
            <Route path="/accounts/vat-remittance"                         element={<Guard moduleKey="accounts" resource="financialReports"><VatRemittance /></Guard>} />
            <Route path="/accounts/wht-remittance"                         element={<Guard moduleKey="accounts" resource="financialReports"><WhtRemittance /></Guard>} />
            <Route path="/accounts/accounting-periods"                     element={<Guard moduleKey="accounts"><AccountingPeriods /></Guard>} />
            <Route path="/accounts/year-end-close"                         element={<Guard moduleKey="accounts"><YearEndClose /></Guard>} />
            <Route path="/accounts/financial-ratios"                       element={<Guard moduleKey="accounts"><FinancialRatiosDashboard /></Guard>} />

            {/* ── Car Wash module ───────────────────────────────────────── */}
            {/* Dashboard falls back to /carwash/jobs so users without dashboard access don't get ejected from the module */}
            <Route path="/carwash/dashboard"                  element={<Guard moduleKey="carwash" resource="carwash-dashboard" fallback="/carwash/jobs"><CarWashDashboard /></Guard>} />
            <Route path="/carwash/jobs"                       element={<Guard moduleKey="carwash" resource="carwash-jobs"><CarWashJobs /></Guard>} />
            <Route path="/carwash/washboard"                  element={<Guard moduleKey="carwash" resource="carwash-jobs"><CarWashWashboard /></Guard>} />
            <Route path="/carwash/jobs/new"                   element={<Guard moduleKey="carwash" resource="carwash-jobs" action="create"><CarWashAddJob /></Guard>} />
            <Route path="/carwash/jobs/:id/edit"              element={<Guard moduleKey="carwash" resource="carwash-jobs" action="update"><CarWashAddJob /></Guard>} />
            <Route path="/carwash/customers"                    element={<Guard moduleKey="carwash" resource="carwash-loyalty"><CarWashCustomers /></Guard>} />
            <Route path="/carwash/customers/opening-balances"  element={<Guard moduleKey="carwash" resource="carwash-loyalty"><CarWashOpeningBalances /></Guard>} />
            <Route path="/carwash/customers/credit-balances"   element={<Guard moduleKey="carwash" resource="carwash-loyalty"><CarWashCreditBalances /></Guard>} />
            <Route path="/carwash/accounts"                   element={<Guard moduleKey="carwash" resource="carwash-payments"><CarWashAccounts /></Guard>} />
            <Route path="/carwash/services"                   element={<Guard moduleKey="carwash" resource="carwash-services"><CarWashServices /></Guard>} />
            <Route path="/carwash/payments"                   element={<Guard moduleKey="carwash" resource="carwash-payments"><CarWashPayments /></Guard>} />
            <Route path="/carwash/deposits"                   element={<Guard moduleKey="carwash" resource="carwash-deposits"><CarWashDeposits /></Guard>} />
            <Route path="/carwash/expenses"                   element={<Guard moduleKey="carwash" resource="carwash-expenses"><CarWashExpenses /></Guard>} />
            <Route path="/carwash/cashbooks"                  element={<Guard moduleKey={GL_ACCESS_MODULES} resource="chartOfAccounts"><CarWashCashbooks /></Guard>} />
            <Route path="/carwash/chart-of-accounts"          element={<Guard moduleKey={GL_ACCESS_MODULES} resource="chartOfAccounts"><ChartOfAccounts /></Guard>} />
            <Route path="/carwash/chart-of-accounts/:accountId/activity" element={<Guard moduleKey="carwash" resource="chartOfAccounts"><LedgerAccountActivity /></Guard>} />
            <Route path="/carwash/staff"                      element={<Guard moduleKey="carwash" resource="carwash-staff"><CarWashStaff /></Guard>} />
            <Route path="/carwash/reports"                    element={<Guard moduleKey="carwash" resource="carwash-reports"><CarWashReports /></Guard>} />
            <Route path="/carwash/reports/services"           element={<Guard moduleKey="carwash" resource="carwash-reports"><CarWashServiceReport /></Guard>} />
            <Route path="/carwash/reports/staff"              element={<Guard moduleKey="carwash" resource="carwash-reports"><CarWashStaffReport /></Guard>} />
            <Route path="/carwash/reports/expenses"           element={<Guard moduleKey="carwash" resource="carwash-reports"><CarWashExpensesReport /></Guard>} />
            <Route path="/carwash/commissions"                element={<Guard moduleKey="carwash" resource="carwash-commissions"><CarWashCommissions /></Guard>} />
            <Route path="/carwash/commissions/payouts"        element={<Guard moduleKey="carwash" resource="carwash-commissions"><CarWashCommissionPayouts /></Guard>} />
            <Route path="/carwash/commissions/rules"          element={<Guard moduleKey="carwash" resource="carwash-commissions"><CarWashCommissionRules /></Guard>} />
            <Route path="/carwash/commissions/savings"        element={<Guard moduleKey="carwash" resource="carwash-commissions"><CarWashStaffSavings /></Guard>} />
            <Route path="/carwash/commissions/damages"        element={<Guard moduleKey="carwash" resource="carwash-commissions"><CarWashStaffDamages /></Guard>} />
            <Route path="/carwash/loyalty"                    element={<Guard moduleKey="carwash" resource="carwash-loyalty"><CarWashLoyalty /></Guard>} />
            <Route path="/carwash/branches"                   element={<Guard moduleKey="carwash" resource="carwash-branches"><CarWashBranches /></Guard>} />
            <Route path="/carwash/settings"                   element={<Guard moduleKey="carwash" resource="carwash-settings"><CarWashSettings /></Guard>} />
            <Route path="/carwash/mpesa-notifications"        element={<Guard moduleKey="carwash" resource="carwash-payments"><CarWashMpesaNotifications /></Guard>} />

            {/* ── Inventory & POS module ────────────────────────────────── */}
            <Route path="/inventory/dashboard"       element={<Guard moduleKey="inventory" resource="inv-dashboard"><InventoryDashboard /></Guard>} />
            <Route path="/inventory/locations"       element={<Guard moduleKey="inventory" resource="inv-locations"><InvLocations /></Guard>} />
            <Route path="/inventory/categories"      element={<Guard moduleKey="inventory" resource="inv-categories"><InvCategories /></Guard>} />
            <Route path="/inventory/products"        element={<Guard moduleKey="inventory" resource="inv-products"><InvProducts /></Guard>} />
            <Route path="/inventory/suppliers"       element={<Guard moduleKey="inventory" resource="inv-suppliers"><InvSuppliers /></Guard>} />
            <Route path="/inventory/purchase-orders" element={<Guard moduleKey="inventory" resource="inv-purchase-orders"><InvPurchaseOrders /></Guard>} />
            <Route path="/inventory/transfers"       element={<Guard moduleKey="inventory" resource="inv-transfers"><InvStockTransfers /></Guard>} />
            <Route path="/inventory/stock-movements" element={<Guard moduleKey="inventory" resource="inv-stock"><InvStockMovements /></Guard>} />
            <Route path="/inventory/adjustments"     element={<Guard moduleKey="inventory" resource="inv-stock"><InvStockAdjustments /></Guard>} />
            <Route path="/inventory/valuation"       element={<Guard moduleKey="inventory" resource="inv-reports"><InvStockValuation /></Guard>} />
            <Route path="/inventory/low-stock"       element={<Guard moduleKey="inventory" resource="inv-reports"><InvLowStock /></Guard>} />
            <Route path="/inventory/tills"           element={<Guard moduleKey="inventory" resource="inv-tills"><InvTills /></Guard>} />
            <Route path="/pos/terminal"              element={<Guard moduleKey="inventory" resource="pos-terminal"><POSTerminal /></Guard>} />
            <Route path="/pos/sales"                 element={<Guard moduleKey="inventory" resource="pos-sales"><POSSalesHistory /></Guard>} />
            <Route path="/pos/sessions"              element={<Guard moduleKey="inventory" resource="pos-sessions"><POSSessions /></Guard>} />

            {/* ── HR module ─────────────────────────────────────────────── */}
            <Route path="/hr/dashboard"                        element={<Guard moduleKey="hr"><HRDashboard /></Guard>} />
            <Route path="/hr/employees"                        element={<Guard moduleKey="hr" resource="hrEmployees"><HREmployees /></Guard>} />
            <Route path="/hr/employees/new"                    element={<Guard moduleKey="hr" resource="hrEmployees" action="create"><HRAddEmployee /></Guard>} />
            <Route path="/hr/employees/:id"                    element={<Guard moduleKey="hr" resource="hrEmployees"><HREmployeeProfile /></Guard>} />
            <Route path="/hr/employees/:id/edit"               element={<Guard moduleKey="hr" resource="hrEmployees" action="update"><HRAddEmployee /></Guard>} />
            <Route path="/hr/setup"                            element={<Guard moduleKey="hr" resource="hrSetup"><HRSetup /></Guard>} />
            <Route path="/hr/leave"                            element={<Guard moduleKey="hr" resource="hrLeave"><HRLeaveApplications /></Guard>} />
            <Route path="/hr/leave/types"                      element={<Guard moduleKey="hr" resource="hrLeave"><HRLeaveTypes /></Guard>} />
            <Route path="/hr/leave/balances"                   element={<Guard moduleKey="hr" resource="hrLeave"><HRLeaveBalances /></Guard>} />
            <Route path="/hr/payroll"                          element={<Guard moduleKey="hr" resource="hrPayroll"><HRPayrollPeriods /></Guard>} />
            <Route path="/hr/payroll/register"                 element={<Guard moduleKey="hr" resource="hrPayroll"><HRPayrollRegister /></Guard>} />
            <Route path="/hr/payroll/:periodId"                element={<Guard moduleKey="hr" resource="hrPayroll"><HRPayrollPeriodDetail /></Guard>} />
            <Route path="/hr/payroll/:periodId/payslip/:payslipId" element={<Guard moduleKey="hr" resource="hrPayroll"><HRPayslip /></Guard>} />
            <Route path="/hr/statutory"                        element={<Guard moduleKey="hr" resource="hrStatutory"><HRStatutoryDeductions /></Guard>} />
            <Route path="/hr/appraisals"                       element={<Guard moduleKey="hr" resource="hrAppraisals"><HRAppraisals /></Guard>} />
            <Route path="/hr/appraisals/kpis"                  element={<Guard moduleKey="hr" resource="hrAppraisals"><HRKpiLibrary /></Guard>} />
            <Route path="/hr/appraisals/cycles"                element={<Guard moduleKey="hr" resource="hrAppraisals"><HRAppraisalCycles /></Guard>} />
            <Route path="/hr/reports/headcount"                element={<Guard moduleKey="hr" resource="hrReports"><HRReportHeadcount /></Guard>} />
            <Route path="/hr/reports/payroll"                  element={<Guard moduleKey="hr" resource="hrReports"><HRReportPayroll /></Guard>} />
            <Route path="/hr/reports/leave"                    element={<Guard moduleKey="hr" resource="hrReports"><HRReportLeave /></Guard>} />
            <Route path="/hr/reports/p9"                       element={<Guard moduleKey="hr" resource="hrReports"><HRReportP9 /></Guard>} />
            <Route path="/hr/reports/attendance"               element={<Guard moduleKey="hr" resource="hrReports"><HRReportAttendance /></Guard>} />
            <Route path="/hr/reports/remittance"               element={<Guard moduleKey="hr" resource="hrReports"><HRRemittance /></Guard>} />
            <Route path="/hr/letters"                          element={<Guard moduleKey="hr" resource="hrEmployees"><HRLetters /></Guard>} />
            <Route path="/hr/attendance"                       element={<Guard moduleKey="hr" resource="hrEmployees"><HRAttendance /></Guard>} />
            <Route path="/hr/financials"                       element={<Guard moduleKey={GL_ACCESS_MODULES} resource="chartOfAccounts"><HRFinancials /></Guard>} />
            <Route path="/hr/chart-of-accounts"                element={<Guard moduleKey={GL_ACCESS_MODULES} resource="chartOfAccounts"><ChartOfAccounts /></Guard>} />
            <Route path="/hr/chart-of-accounts/:accountId/activity" element={<Guard moduleKey="hr" resource="chartOfAccounts"><LedgerAccountActivity /></Guard>} />

            {/* ── Property Sale module ──────────────────────────────────── */}
            <Route path="/sale/dashboard"                    element={<Guard moduleKey="propertySale"><PropertySaleDashboard /></Guard>} />
            <Route path="/sale/listings"                     element={<Guard moduleKey="propertySale" resource="saleListings"><SaleListings /></Guard>} />
            <Route path="/sale/buyers"                       element={<Guard moduleKey="propertySale" resource="saleBuyers"><SaleBuyers /></Guard>} />
            <Route path="/sale/agents"                       element={<Guard moduleKey="propertySale" resource="saleAgents"><SaleAgents /></Guard>} />
            <Route path="/sale/offers"                       element={<Guard moduleKey="propertySale" resource="saleOffers"><SaleOffers /></Guard>} />
            <Route path="/sale/deals"                        element={<Guard moduleKey="propertySale" resource="saleDeals"><SaleDeals /></Guard>} />
            <Route path="/sale/payments"                     element={<Guard moduleKey="propertySale" resource="salePayments"><SalePayments /></Guard>} />
            <Route path="/sale/commissions"                  element={<Guard moduleKey="propertySale" resource="saleCommissions"><SaleCommissions /></Guard>} />
            <Route path="/sale/reports"                      element={<Guard moduleKey="propertySale" resource="saleReports"><SaleReports /></Guard>} />
            <Route path="/sale/reports/monthly/:year/:month" element={<Guard moduleKey="propertySale" resource="saleReports"><SaleMonthlyDetail /></Guard>} />
            <Route path="/sale/financials"                   element={<Guard moduleKey={GL_ACCESS_MODULES} resource="chartOfAccounts"><SaleFinancials /></Guard>} />
            <Route path="/sale/crm/leads"                    element={<Guard moduleKey="propertySale" resource="saleLeads"><SaleLeads /></Guard>} />
            <Route path="/sale/crm/activities"               element={<Guard moduleKey="propertySale" resource="saleActivities"><SaleActivities /></Guard>} />
            <Route path="/sale/chart-of-accounts"            element={<Guard moduleKey={GL_ACCESS_MODULES} resource="chartOfAccounts"><ChartOfAccounts /></Guard>} />
            <Route path="/sale/chart-of-accounts/:accountId/activity" element={<Guard moduleKey="propertySale" resource="chartOfAccounts"><LedgerAccountActivity /></Guard>} />

            {/* ── System setup ──────────────────────────────────────────── */}
            <Route path="/system-setup"          element={<SuperAdminRoute><Navigate to="/system-setup/overview" replace /></SuperAdminRoute>} />
            <Route path="/system-setup/overview" element={<SuperAdminRoute><SystemSetupPage /></SuperAdminRoute>} />
            <Route path="/system-setup/companies"element={<SuperAdminRoute><SystemSetupPage /></SuperAdminRoute>} />
            <Route path="/system-setup/users"    element={<SuperAdminRoute><SystemSetupPage /></SuperAdminRoute>} />
            <Route path="/system-setup/trials"   element={<SuperAdminRoute><SystemSetupPage /></SuperAdminRoute>} />
            <Route path="/system-setup/audit"    element={<SuperAdminRoute><SystemSetupPage /></SuperAdminRoute>} />
            <Route path="/system-setup/rights"   element={<SuperAdminRoute><Navigate to="/system-setup/users" replace /></SuperAdminRoute>} />
            <Route path="/system-setup/database" element={<SuperAdminRoute><Navigate to="/system-setup/overview" replace /></SuperAdminRoute>} />
            <Route path="/system-setup/sessions" element={<SuperAdminRoute><Navigate to="/system-setup/trials" replace /></SuperAdminRoute>} />
            <Route path="/add-company"           element={<SuperAdminRoute><AddCompanyWizard /></SuperAdminRoute>} />
            <Route path="/add-company/:id"       element={<SuperAdminRoute><AddCompanyWizard /></SuperAdminRoute>} />
            <Route path="/add-user"              element={<SuperAdminRoute><AddUserPage /></SuperAdminRoute>} />
            <Route path="/add-user/:id"          element={<SuperAdminRoute><AddUserPage /></SuperAdminRoute>} />

            {/* ── Company Users (Tools > Users) ─────────────────────── */}
            <Route path="/users"          element={<Guard resource="users"><CompanyUsers /></Guard>} />
            <Route path="/users/new"      element={<Guard resource="users" action="create"><AddUserPage /></Guard>} />
            <Route path="/users/:id/edit" element={<Guard resource="users" action="update"><AddUserPage /></Guard>} />

            {/* ── Landlords ─────────────────────────────────────────────── */}
            <Route path="/landlords"                    element={<Guard companyMode={{ allowLandlord: false }} resource="landlords" moduleKey="propertyManagement"><Landlords /></Guard>} />
            <Route path="/landlords/new"                element={<Guard companyMode={{ allowLandlord: false }} resource="landlords" action="create" moduleKey="propertyManagement"><AddLandlord /></Guard>} />
            <Route path="/landlord-payments"            element={<Guard companyMode={{ allowLandlord: false }} resource="landlordPayments" moduleKey="accounts"><LandlordPayments /></Guard>} />
            <Route path="/landlord-payment-history"     element={<Guard companyMode={{ allowLandlord: false }} resource="landlordPayments" moduleKey="accounts"><LandlordPaymentHistory /></Guard>} />
            <Route path="/financial/landlord-statement" element={<Guard companyMode={{ allowLandlord: false }} resource="statements" moduleKey="propertyManagement"><LandlordCommissionsStatement /></Guard>} />
            <Route path="/invoices/landlord"            element={<Navigate to="/landlord/statements" replace />} />
            <Route path="/landlord/processed-statements"element={<Guard companyMode={{ allowLandlord: false }} resource="processedStatements" moduleKey="accounts"><ProcessedStatements /></Guard>} />
            <Route path="/landlord/statements"          element={<Guard companyMode={{ allowLandlord: false }} resource="statements" moduleKey="propertyManagement"><LandlordCommissionsStatement /></Guard>} />
            <Route path="/landlords/standing-orders"    element={<Guard companyMode={{ allowLandlord: false }} resource="standingOrders" moduleKey="accounts"><LandlordStandingOrders /></Guard>} />
            <Route path="/landlords/advancement"        element={<Guard companyMode={{ allowLandlord: false }} resource="landlordAdvancements" moduleKey="accounts"><LandlordAdvancements /></Guard>} />
            <Route path="/landlord/statement-allocations" element={<SuperAdminRoute><LandlordStatementAllocations /></SuperAdminRoute>} />

            {/* ── Properties & Units ────────────────────────────────────── */}
            <Route path="/properties"                     element={<Guard resource="properties" moduleKey="propertyManagement"><Properties /></Guard>} />
            <Route path="/properties/new"                 element={<Guard resource="properties" action="create" moduleKey="propertyManagement"><AddProperty /></Guard>} />
            <Route path="/properties/:id"                 element={<Guard resource="properties" moduleKey="propertyManagement"><PropertyDetail /></Guard>} />
            <Route path="/properties/edit/:id"            element={<Guard resource="properties" action="update" moduleKey="propertyManagement"><EditProperty /></Guard>} />
            <Route path="/properties/commission-settings" element={<Guard companyMode={{ allowLandlord: false }} resource="commissions" moduleKey="propertyManagement"><PropertyCommissionSettings /></Guard>} />
            <Route path="/properties/commissions-list"    element={<Guard companyMode={{ allowLandlord: false }} resource="commissions" moduleKey="propertyManagement"><CommissionsList /></Guard>} />
            <Route path="/property-expenses"              element={<Guard resource="propertyExpenses" moduleKey="propertyManagement"><PropertyExpenses /></Guard>} />
            <Route path="/units"                          element={<Guard resource="units" moduleKey="propertyManagement"><Units /></Guard>} />
            <Route path="/units/new"                      element={<Guard resource="units" action="create" moduleKey="propertyManagement"><AddUnit /></Guard>} />
            <Route path="/units/:id"                      element={<Guard resource="units" action="update" moduleKey="propertyManagement"><AddUnit /></Guard>} />
            <Route path="/units/space-types"              element={<Guard resource="units" moduleKey="propertyManagement"><UnitTypesPage /></Guard>} />

            {/* ── Tenants ───────────────────────────────────────────────── */}
            <Route path="/agreements"           element={<Guard resource="tenants" moduleKey="propertyManagement"><TenantAgreements /></Guard>} />
            <Route path="/tenants"              element={<Guard resource="tenants" moduleKey="propertyManagement"><Tenants /></Guard>} />
            <Route path="/tenants/terminated"   element={<Guard resource="tenants" moduleKey="propertyManagement"><TerminatedTenants /></Guard>} />
            <Route path="/tenant/new"           element={<Guard resource="tenants" action="create" moduleKey="propertyManagement"><AddTenant /></Guard>} />
            <Route path="/tenant/:id/statement" element={<Guard resource="tenants" moduleKey="propertyManagement"><TenantStatement /></Guard>} />
            <Route path="/tenant/:id/edit"      element={<Guard resource="tenants" action="update" moduleKey="propertyManagement"><AddTenant /></Guard>} />
            <Route path="/tenants/deposits"         element={<Guard resource="deposits" moduleKey="propertyManagement"><TenantDeposits /></Guard>} />
            <Route path="/tenants/take-on-balances" element={<Guard resource="takeOnBalances" moduleKey="propertyManagement"><TakeOnBalances /></Guard>} />
            <Route path="/tenants/financing"        element={<Navigate to="/tenants/take-on-balances" replace />} />
            <Route path="/tenants/journals"         element={<Navigate to="/financial/journals" replace />} />
            <Route path="/invoices/rental"          element={<Guard resource="tenantInvoices" moduleKey="propertyManagement"><RentalInvoices /></Guard>} />
            <Route path="/invoices/new"             element={<Guard resource="tenantInvoices" moduleKey="propertyManagement"><RentalInvoices initialOpenSingleBooking /></Guard>} />
            <Route path="/invoices/rental/:id"      element={<Guard resource="tenantInvoices" moduleKey="propertyManagement"><RentalInvoices /></Guard>} />
            <Route path="/invoices/notes"           element={<Guard resource="tenantInvoices" moduleKey="propertyManagement"><InvoiceNotes /></Guard>} />
            <Route path="/invoices/vat"             element={<Guard resource="tenantInvoices" moduleKey="propertyManagement"><RentalInvoiceVATReport /></Guard>} />
            <Route path="/invoices/withholding-vat" element={<Navigate to="/reports/tax-reports" replace />} />
            <Route path="/invoices/withholding-tax" element={<Navigate to="/reports/tax-reports" replace />} />
            <Route path="/receipts"                 element={<Guard resource="receipts" moduleKey="propertyManagement"><Receipts /></Guard>} />
            <Route path="/receipts/new"             element={<Guard resource="receipts" action="create" moduleKey="propertyManagement"><AddReceipt /></Guard>} />
            <Route path="/receipts/prepayments"     element={<Guard resource="prepayments" moduleKey="propertyManagement"><TenantPrepayments /></Guard>} />
            <Route path="/receipts/mpesa-collections"   element={<Guard resource="receipts" action="view"   moduleKey="propertyManagement"><PmsMpesaNotifications /></Guard>} />
            <Route path="/receipts/instant"         element={<Guard resource="receipts" moduleKey="propertyManagement"><InstantReceipts /></Guard>} />
            <Route path="/receipts/landlord"        element={<Guard companyMode={{ allowLandlord: false }} resource="landlordReceipts" moduleKey="accounts"><LandlordReceipts /></Guard>} />
            <Route path="/receipts/:id"             element={<Guard resource="receipts" moduleKey="propertyManagement"><Receipts /></Guard>} />

            {/* ── Financial ─────────────────────────────────────────────── */}
            <Route path="/financial/payment-vouchers"              element={<Guard resource="paymentVouchers" moduleKey="accounts"><PaymentVouchers /></Guard>} />
            <Route path="/financial/petty-cash"                    element={<Guard resource="pettyCash" moduleKey="accounts"><PettyCash /></Guard>} />
            <Route path="/financial/service-providers"             element={<Guard resource="expenses" moduleKey="accounts"><ServiceProviders /></Guard>} />
            <Route path="/expenses/requisition"                    element={<Guard resource="expenses" moduleKey="accounts"><ExpenseRequisition /></Guard>} />
            <Route path="/expenses/payment-vouchers"               element={<Guard resource="paymentVouchers" moduleKey="accounts"><PaymentVouchers /></Guard>} />
            <Route path="/financial/journals"                      element={<Guard resource="journals" moduleKey={GL_ACCESS_MODULES}><JournalEntries /></Guard>} />
            <Route path="/financial/chart-of-accounts"             element={<Guard resource="chartOfAccounts" moduleKey={GL_ACCESS_MODULES}><ChartOfAccounts /></Guard>} />
            <Route path="/financial/chart-of-accounts/:accountId/activity" element={<Guard resource="chartOfAccounts" moduleKey={GL_ACCESS_MODULES}><LedgerAccountActivity /></Guard>} />
            <Route path="/financial/ledger-entries"                element={<Navigate to="/financial/chart-of-accounts" replace />} />

            {/* ── Operations ────────────────────────────────────────────── */}
            <Route path="/vacants"                element={<Guard resource="units" moduleKey="propertyManagement"><Vacants /></Guard>} />
            <Route path="/maintenances"           element={<Guard resource="maintenances" moduleKey="propertyManagement"><Maintenances /></Guard>} />
            <Route path="/inspections"            element={<Guard resource="inspections" moduleKey="propertyManagement"><Inspections /></Guard>} />
            <Route path="/meter-readings"         element={<Guard resource="meterReadings" moduleKey="propertyManagement"><MeterReadings /></Guard>} />
            <Route path="/invoices/late-penalties"element={<Guard resource="latePenalties" moduleKey="propertyManagement"><LatePenalties /></Guard>} />
            <Route path="/tools/import-export"    element={<Navigate to="/reports/export" replace />} />
            <Route path="/tools/backup"           element={<Navigate to="/settings" replace />} />

            {/* ── Reports ───────────────────────────────────────────────── */}
            <Route path="/reports/rental-collection"       element={<Guard resource="pmReports" moduleKey="propertyManagement"><RentalCollectionReport /></Guard>} />
            <Route path="/reports/export"                  element={<Guard resource="pmReports" moduleKey="propertyManagement"><RentalCollectionReport /></Guard>} />
            <Route path="/reports/property-income-summary" element={<Guard resource="pmReports" moduleKey="propertyManagement"><PropertyIncomeSummaryReport /></Guard>} />
            <Route path="/reports/mri-tax-summary"         element={<Guard resource="pmReports" moduleKey="propertyManagement"><MRITaxSummaryReport /></Guard>} />
            <Route path="/reports/paid-balance"            element={<Guard resource="pmReports" moduleKey="propertyManagement"><PaidBalanceReport /></Guard>} />
            <Route path="/reports/aged-analysis"           element={<Guard resource="agedAnalysis" moduleKey="propertyManagement"><AgedAnalysisReport /></Guard>} />
            <Route path="/reports/rental-aged-analysis"    element={<Guard resource="agedAnalysis" moduleKey="propertyManagement"><RentalAgedAnalysisReport /></Guard>} />
            <Route path="/reports/commissions"             element={<Guard companyMode={{ allowLandlord: false }} resource="commissionReports" moduleKey="propertyManagement"><CommissionReports /></Guard>} />
            <Route path="/reports/trial-balance"           element={<Guard resource="financialReports" moduleKey="accounts"><TrialBalanceReport /></Guard>} />
            <Route path="/reports/income-statement"        element={<Guard resource="financialReports" moduleKey="accounts"><IncomeStatementReport /></Guard>} />
            <Route path="/reports/balance-sheet"           element={<Guard resource="financialReports" moduleKey="accounts"><BalanceSheetReport /></Guard>} />
            <Route path="/reports/tax-reports"             element={<Guard resource="financialReports" moduleKey="accounts"><TaxReports /></Guard>} />

            {/* ── Company & settings ────────────────────────────────────── */}
            <Route path="/company-setup" element={<Guard resource="companySettings" action="update"><CompanySetupPage /></Guard>} />
            <Route path="/settings"      element={<Guard resource="companySettings"><CompanySettings /></Guard>} />

            {/* ── Help ──────────────────────────────────────────────────── */}
            <Route path="/help/documentation" element={<Guard><SupportDocumentation /></Guard>} />
            <Route path="/help/support"       element={<Guard><SupportDocumentation /></Guard>} />
            <Route path="/help/about"         element={<Guard><AboutMilik /></Guard>} />

            {/* ── ESS Portal ───────────────────────────────────────────── */}
            <Route path="/ess/login" element={<ESSLogin />} />
            <Route path="/ess" element={<ESSProtectedRoute><ESSLayout /></ESSProtectedRoute>}>
              <Route index element={<Navigate to="/ess/dashboard" replace />} />
              <Route path="dashboard"  element={<ESSDashboard />} />
              <Route path="payslips"   element={<ESSPayslips />} />
              <Route path="leave"      element={<ESSLeave />} />
              <Route path="attendance" element={<ESSAttendance />} />
              <Route path="letters"     element={<ESSLetters />} />
              <Route path="appraisals" element={<ESSAppraisals />} />
              <Route path="profile"    element={<ESSProfile />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ConfirmProvider>
    </ESSContextProvider>
  );
}

export default App;

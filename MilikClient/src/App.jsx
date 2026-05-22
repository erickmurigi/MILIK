import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { clearCurrentCompany, getCompanySuccess, setCurrentCompany } from "./redux/companiesRedux";
import { initializeAuth } from "./redux/authSlice";
import { getAccessibleCompanies } from "./redux/apiCalls";
import useInactivityLogout from "./hooks/useInactivityLogout";
import { clearClientSessionStorage } from "./utils/sessionCleanup";
import { hasSessionTimedOut } from "./utils/sessionTimeout";
import "./App.css";
import { hasCompanyPermission } from "./utils/permissions";
import { GL_ACCESS_MODULES, hasAnyCompanyModule, hasCompanyModule, isPropertyManagerCompany, isSelfManagingLandlordCompany } from "./utils/companyModules";
import { ConfirmProvider } from "./context/ConfirmContext";

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
const DemoAccessEntry   = lazy(() => import("./pages/Home/DemoAccessEntry"));
const Login             = lazy(() => import("./pages/Login/Login"));
const SetupAdmin        = lazy(() => import("./pages/Login/SetupAdmin"));
const FirstTimePassword = lazy(() => import("./pages/Login/FirstTimePassword"));

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

// Properties & Units
const Properties                  = lazy(() => import("./pages/Properties/Properties"));
const PropertyCommissionSettings  = lazy(() => import("./pages/Properties/PropertyCommissionSettings"));
const CommissionsList             = lazy(() => import("./pages/Properties/CommissionsList"));
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
const MpesaBatchImport    = lazy(() => import("./pages/Tenants/MpesaBatchImport"));

// Lease / Vacants / Ops
const UnitTypesPage  = lazy(() => import("./pages/Lease/Lease"));
const Vacants        = lazy(() => import("./pages/Vacants/Vacants"));
const Maintenances   = lazy(() => import("./pages/Maintenances/Maintenances"));
const Inspections    = lazy(() => import("./pages/Inspections/Inspections"));
const MeterReadings  = lazy(() => import("./pages/Tools/MeterReadings"));
const LatePenalties  = lazy(() => import("./pages/Tools/LatePenalties"));

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

// Help
const SupportDocumentation = lazy(() => import("./pages/Help/SupportDocumentation"));
const AboutMilik           = lazy(() => import("./pages/Help/AboutMilik"));

// Car Wash module
const CarWashDashboard      = lazy(() => import("./pages/CarWash/CarWashDashboard"));
const CarWashJobs           = lazy(() => import("./pages/CarWash/CarWashJobs"));
const CarWashServices       = lazy(() => import("./pages/CarWash/CarWashServices"));
const CarWashPayments       = lazy(() => import("./pages/CarWash/CarWashPayments"));
const CarWashDeposits       = lazy(() => import("./pages/CarWash/CarWashDeposits"));
const CarWashExpenses       = lazy(() => import("./pages/CarWash/CarWashExpenses"));
const CarWashCashbooks      = lazy(() => import("./pages/CarWash/CarWashCashbooks"));
const CarWashStaff          = lazy(() => import("./pages/CarWash/CarWashStaff"));
const CarWashReports        = lazy(() => import("./pages/CarWash/CarWashReports"));
const CarWashServiceReport  = lazy(() => import("./pages/CarWash/CarWashServiceReport"));
const CarWashStaffReport    = lazy(() => import("./pages/CarWash/CarWashStaffReport"));
const CarWashCommissions    = lazy(() => import("./pages/CarWash/CarWashCommissions"));
const CarWashLoyalty        = lazy(() => import("./pages/CarWash/CarWashLoyalty"));
const CarWashFinancials     = lazy(() => import("./pages/CarWash/CarWashFinancials"));
const CarWashBranches       = lazy(() => import("./pages/CarWash/CarWashBranches"));

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
function ProtectedRoute({ children, allowMustChangePassword = false }) {
  const { currentUser } = useSelector((state) => state.auth);
  const storedSession = getStoredAuthSession();
  const resolvedUser = getResolvedAuthUser(currentUser, storedSession);
  const isAuthenticated = Boolean(resolvedUser || storedSession.token);

  if (!isAuthenticated) return <Navigate to={getSignedOutRedirectPath()} replace />;
  if (
    !allowMustChangePassword &&
    resolvedUser?.mustChangePassword &&
    !resolvedUser?.isSystemAdmin &&
    !resolvedUser?.superAdminAccess
  ) {
    return <Navigate to="/first-time-password" replace />;
  }
  return children;
}

function PermissionRoute({ children, resource, action = "view", moduleKey = null, fallback = "/moduleDashboard" }) {
  const { currentUser } = useSelector((state) => state.auth);
  const { currentCompany } = useSelector((state) => state.company);
  const storedSession = getStoredAuthSession();
  const resolvedUser = getResolvedAuthUser(currentUser, storedSession);
  const isAuthenticated = Boolean(resolvedUser || storedSession.token);

  if (!isAuthenticated) return <Navigate to={getSignedOutRedirectPath()} replace />;
  const activeCompany = currentCompany || resolvedUser?.company || null;
  if (Array.isArray(moduleKey)) {
    if (!hasAnyCompanyModule(activeCompany, moduleKey)) return <Navigate to={fallback} replace />;
  } else if (moduleKey && !hasCompanyModule(activeCompany, moduleKey)) {
    return <Navigate to={fallback} replace />;
  }
  const allowed = hasCompanyPermission(resolvedUser || {}, activeCompany, resource, action, moduleKey);
  return allowed ? children : <Navigate to={fallback} replace />;
}

function CompanyModeRoute({
  children,
  allowLandlordMode = true,
  allowPropertyManagerMode = true,
  allowOtherMode = allowLandlordMode && allowPropertyManagerMode,
  fallback = "/dashboard",
}) {
  const { currentUser } = useSelector((state) => state.auth);
  const { currentCompany } = useSelector((state) => state.company);
  const storedSession = getStoredAuthSession();
  const resolvedUser = getResolvedAuthUser(currentUser, storedSession);
  const isAuthenticated = Boolean(resolvedUser || storedSession.token);

  if (!isAuthenticated) return <Navigate to={getSignedOutRedirectPath()} replace />;

  const activeCompany = currentCompany || resolvedUser?.company || null;
  const landlordMode = isSelfManagingLandlordCompany(activeCompany);
  const propertyManagerMode = isPropertyManagerCompany(activeCompany);
  const otherMode = !landlordMode && !propertyManagerMode;

  if (
    (landlordMode && !allowLandlordMode) ||
    (propertyManagerMode && !allowPropertyManagerMode) ||
    (otherMode && !allowOtherMode)
  ) {
    return <Navigate to={fallback} replace />;
  }
  return children;
}

function CompanyModuleRoute({ children, moduleKey, fallback = "/moduleDashboard" }) {
  const { currentUser } = useSelector((state) => state.auth);
  const { currentCompany } = useSelector((state) => state.company);
  const storedSession = getStoredAuthSession();
  const resolvedUser = getResolvedAuthUser(currentUser, storedSession);
  const isAuthenticated = Boolean(resolvedUser || storedSession.token);

  if (!isAuthenticated) return <Navigate to={getSignedOutRedirectPath()} replace />;
  const activeCompany = currentCompany || resolvedUser?.company || null;
  if (!hasCompanyModule(activeCompany, moduleKey)) return <Navigate to={fallback} replace />;
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

function AppDocumentTitleGuard() {
  const location = useLocation();

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const forceTitle = () => { if (document.title !== "MILIK") document.title = "MILIK"; };
    forceTitle();
    const observer = new MutationObserver(() => {
      if (document.title !== "MILIK") document.title = "MILIK";
    });
    if (document.head) observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [location.pathname, location.search, location.hash]);

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
    <ConfirmProvider>
      <BrowserRouter>
        <AppDocumentTitleGuard />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* ── Public ────────────────────────────────────────────────── */}
            <Route path="/" element={<PublicEntryRoute />} />
            <Route path="/home" element={<Navigate to="/" replace />} />
            <Route path="/trial-access" element={<PublicOnlyRoute><DemoAccessEntry /></PublicOnlyRoute>} />
            <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
            <Route path="/setup-admin" element={<SetupAdmin />} />
            <Route path="/first-time-password" element={<ProtectedRoute allowMustChangePassword><FirstTimePassword /></ProtectedRoute>} />

            {/* ── Core dashboards ───────────────────────────────────────── */}
            <Route path="/moduleDashboard" element={<ProtectedRoute><ModulesDashboard /></ProtectedRoute>} />
            <Route path="/dashboard" element={<CompanyModuleRoute moduleKey="propertyManagement"><ProtectedRoute><Dashboard /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/my-account"            element={<ProtectedRoute><MyAccount /></ProtectedRoute>} />
            <Route path="/communications/sms"   element={<ProtectedRoute><SmsManager /></ProtectedRoute>} />
            <Route path="/communications/email" element={<ProtectedRoute><EmailManager /></ProtectedRoute>} />

            {/* ── Car Wash module ───────────────────────────────────────── */}
            <Route path="/carwash/dashboard"         element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-dashboard" moduleKey="carwash"><CarWashDashboard /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/jobs"              element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-jobs" moduleKey="carwash"><CarWashJobs /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/services"          element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-services" moduleKey="carwash"><CarWashServices /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/payments"          element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-payments" moduleKey="carwash"><CarWashPayments /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/deposits"          element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-deposits" moduleKey="carwash"><CarWashDeposits /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/expenses"          element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-expenses" moduleKey="carwash"><CarWashExpenses /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/cashbooks"         element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="chartOfAccounts" moduleKey={GL_ACCESS_MODULES}><CarWashCashbooks /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/chart-of-accounts" element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="chartOfAccounts" moduleKey={GL_ACCESS_MODULES}><ChartOfAccounts /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/financials"        element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="chartOfAccounts" moduleKey={GL_ACCESS_MODULES}><CarWashFinancials /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/staff"             element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-staff" moduleKey="carwash"><CarWashStaff /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/reports"                element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-reports" moduleKey="carwash"><CarWashReports /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/reports/services"       element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-reports" moduleKey="carwash"><CarWashServiceReport /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/reports/staff"          element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-reports" moduleKey="carwash"><CarWashStaffReport /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/commissions"            element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-commissions" moduleKey="carwash"><CarWashCommissions /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/loyalty"           element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-loyalty" moduleKey="carwash"><CarWashLoyalty /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/carwash/branches"          element={<CompanyModuleRoute moduleKey="carwash"><PermissionRoute resource="carwash-branches" moduleKey="carwash"><CarWashBranches /></PermissionRoute></CompanyModuleRoute>} />

            {/* ── HR module ─────────────────────────────────────────────── */}
            <Route path="/hr/dashboard"           element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRDashboard /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/employees"           element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HREmployees /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/employees/new"       element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRAddEmployee /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/employees/:id"       element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HREmployeeProfile /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/employees/:id/edit"  element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRAddEmployee /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/setup"               element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRSetup /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/leave"               element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRLeaveApplications /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/leave/types"         element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRLeaveTypes /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/payroll"             element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRPayrollPeriods /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/payroll/:periodId"   element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRPayrollPeriodDetail /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/payroll/:periodId/payslip/:payslipId" element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRPayslip /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/reports/headcount" element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRReportHeadcount /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/reports/payroll"   element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRReportPayroll /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/reports/leave"     element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRReportLeave /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/reports/p9"        element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRReportP9 /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/leave/balances"    element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRLeaveBalances /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/statutory"         element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRStatutoryDeductions /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/appraisals/kpis"   element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRKpiLibrary /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/appraisals/cycles" element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRAppraisalCycles /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/appraisals"        element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><HRAppraisals /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/financials"        element={<CompanyModuleRoute moduleKey="hr"><PermissionRoute resource="chartOfAccounts" moduleKey={GL_ACCESS_MODULES}><HRFinancials /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/hr/chart-of-accounts" element={<CompanyModuleRoute moduleKey="hr"><PermissionRoute resource="chartOfAccounts" moduleKey={GL_ACCESS_MODULES}><ChartOfAccounts /></PermissionRoute></CompanyModuleRoute>} />

            {/* ── Property Sale module ──────────────────────────────────── */}
            <Route path="/sale/dashboard"                      element={<CompanyModuleRoute moduleKey="propertySale"><PropertySaleDashboard /></CompanyModuleRoute>} />
            <Route path="/sale/listings"                       element={<CompanyModuleRoute moduleKey="propertySale"><SaleListings /></CompanyModuleRoute>} />
            <Route path="/sale/buyers"                         element={<CompanyModuleRoute moduleKey="propertySale"><SaleBuyers /></CompanyModuleRoute>} />
            <Route path="/sale/agents"                         element={<CompanyModuleRoute moduleKey="propertySale"><SaleAgents /></CompanyModuleRoute>} />
            <Route path="/sale/offers"                         element={<CompanyModuleRoute moduleKey="propertySale"><SaleOffers /></CompanyModuleRoute>} />
            <Route path="/sale/deals"                          element={<CompanyModuleRoute moduleKey="propertySale"><SaleDeals /></CompanyModuleRoute>} />
            <Route path="/sale/payments"                       element={<CompanyModuleRoute moduleKey="propertySale"><SalePayments /></CompanyModuleRoute>} />
            <Route path="/sale/commissions"                    element={<CompanyModuleRoute moduleKey="propertySale"><SaleCommissions /></CompanyModuleRoute>} />
            <Route path="/sale/reports"                        element={<CompanyModuleRoute moduleKey="propertySale"><SaleReports /></CompanyModuleRoute>} />
            <Route path="/sale/reports/monthly/:year/:month"   element={<CompanyModuleRoute moduleKey="propertySale"><SaleMonthlyDetail /></CompanyModuleRoute>} />
            <Route path="/sale/financials"                       element={<CompanyModuleRoute moduleKey="propertySale"><PermissionRoute resource="chartOfAccounts" moduleKey={GL_ACCESS_MODULES}><SaleFinancials /></PermissionRoute></CompanyModuleRoute>} />
            <Route path="/sale/chart-of-accounts"              element={<CompanyModuleRoute moduleKey="propertySale"><PermissionRoute resource="chartOfAccounts" moduleKey={GL_ACCESS_MODULES}><ChartOfAccounts /></PermissionRoute></CompanyModuleRoute>} />

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

            {/* ── Landlords ─────────────────────────────────────────────── */}
            <Route path="/landlords"                    element={<CompanyModeRoute allowLandlordMode={false}><PermissionRoute resource="landlords" moduleKey="propertyManagement"><Landlords /></PermissionRoute></CompanyModeRoute>} />
            <Route path="/landlords/new"                element={<CompanyModeRoute allowLandlordMode={false}><ProtectedRoute><AddLandlord /></ProtectedRoute></CompanyModeRoute>} />
            <Route path="/landlord-payments"            element={<CompanyModeRoute allowLandlordMode={false}><ProtectedRoute><LandlordPayments /></ProtectedRoute></CompanyModeRoute>} />
            <Route path="/landlord-payment-history"     element={<CompanyModeRoute allowLandlordMode={false}><ProtectedRoute><LandlordPaymentHistory /></ProtectedRoute></CompanyModeRoute>} />
            <Route path="/financial/landlord-statement" element={<CompanyModeRoute allowLandlordMode={false}><ProtectedRoute><LandlordCommissionsStatement /></ProtectedRoute></CompanyModeRoute>} />
            <Route path="/invoices/landlord"            element={<ProtectedRoute><Navigate to="/landlord/statements" replace /></ProtectedRoute>} />
            <Route path="/landlord/processed-statements"element={<CompanyModeRoute allowLandlordMode={false}><PermissionRoute resource="processedStatements" moduleKey="accounts"><ProcessedStatements /></PermissionRoute></CompanyModeRoute>} />
            <Route path="/landlord/statements"          element={<CompanyModeRoute allowLandlordMode={false}><PermissionRoute resource="statements" moduleKey="propertyManagement"><LandlordCommissionsStatement /></PermissionRoute></CompanyModeRoute>} />
            <Route path="/landlords/standing-orders"    element={<CompanyModeRoute allowLandlordMode={false}><ProtectedRoute><LandlordStandingOrders /></ProtectedRoute></CompanyModeRoute>} />
            <Route path="/landlords/advancement"        element={<CompanyModeRoute allowLandlordMode={false}><ProtectedRoute><LandlordAdvancements /></ProtectedRoute></CompanyModeRoute>} />

            {/* ── Properties & Units ────────────────────────────────────── */}
            <Route path="/properties"                    element={<PermissionRoute resource="properties" moduleKey="propertyManagement"><Properties /></PermissionRoute>} />
            <Route path="/properties/new"                element={<ProtectedRoute><AddProperty /></ProtectedRoute>} />
            <Route path="/properties/:id"                element={<ProtectedRoute><PropertyDetail /></ProtectedRoute>} />
            <Route path="/properties/edit/:id"           element={<ProtectedRoute><EditProperty /></ProtectedRoute>} />
            <Route path="/properties/commission-settings"element={<CompanyModeRoute allowLandlordMode={false}><ProtectedRoute><PropertyCommissionSettings /></ProtectedRoute></CompanyModeRoute>} />
            <Route path="/properties/commissions-list"   element={<CompanyModeRoute allowLandlordMode={false}><ProtectedRoute><CommissionsList /></ProtectedRoute></CompanyModeRoute>} />
            <Route path="/units"                         element={<PermissionRoute resource="units" moduleKey="propertyManagement"><Units /></PermissionRoute>} />
            <Route path="/units/new"                     element={<ProtectedRoute><AddUnit /></ProtectedRoute>} />
            <Route path="/units/:id"                     element={<ProtectedRoute><AddUnit /></ProtectedRoute>} />
            <Route path="/units/space-types"             element={<PermissionRoute resource="units" moduleKey="propertyManagement"><UnitTypesPage /></PermissionRoute>} />

            {/* ── Tenants ───────────────────────────────────────────────── */}
            <Route path="/agreements"              element={<PermissionRoute resource="tenants" moduleKey="propertyManagement"><TenantAgreements /></PermissionRoute>} />
            <Route path="/tenants"                 element={<PermissionRoute resource="tenants" moduleKey="propertyManagement"><Tenants /></PermissionRoute>} />
            <Route path="/tenants/terminated"      element={<PermissionRoute resource="tenants" moduleKey="propertyManagement"><TerminatedTenants /></PermissionRoute>} />
            <Route path="/tenant/new"              element={<ProtectedRoute><AddTenant /></ProtectedRoute>} />
            <Route path="/tenant/:id/statement"    element={<ProtectedRoute><TenantStatement /></ProtectedRoute>} />
            <Route path="/tenant/:id/edit"         element={<ProtectedRoute><AddTenant /></ProtectedRoute>} />
            <Route path="/tenants/deposits"        element={<PermissionRoute resource="tenants" moduleKey="propertyManagement"><TenantDeposits /></PermissionRoute>} />
            <Route path="/tenants/take-on-balances"element={<PermissionRoute resource="tenants" moduleKey="propertyManagement"><TakeOnBalances /></PermissionRoute>} />
            <Route path="/tenants/financing"       element={<ProtectedRoute><Navigate to="/tenants/take-on-balances" replace /></ProtectedRoute>} />
            <Route path="/tenants/journals"        element={<ProtectedRoute><Navigate to="/financial/journals" replace /></ProtectedRoute>} />
            <Route path="/invoices/rental"         element={<PermissionRoute resource="tenantInvoices" moduleKey="propertyManagement"><RentalInvoices /></PermissionRoute>} />
            <Route path="/invoices/new"            element={<PermissionRoute resource="tenantInvoices" moduleKey="propertyManagement"><RentalInvoices initialOpenSingleBooking /></PermissionRoute>} />
            <Route path="/invoices/rental/:id"     element={<ProtectedRoute><RentalInvoices /></ProtectedRoute>} />
            <Route path="/invoices/notes"          element={<PermissionRoute resource="tenantInvoices" moduleKey="propertyManagement"><InvoiceNotes /></PermissionRoute>} />
            <Route path="/invoices/vat"            element={<PermissionRoute resource="tenantInvoices" moduleKey="propertyManagement"><RentalInvoiceVATReport /></PermissionRoute>} />
            <Route path="/invoices/withholding-vat"element={<ProtectedRoute><Navigate to="/reports/tax-reports" replace /></ProtectedRoute>} />
            <Route path="/invoices/withholding-tax"element={<ProtectedRoute><Navigate to="/reports/tax-reports" replace /></ProtectedRoute>} />
            <Route path="/receipts"                element={<PermissionRoute resource="receipts" moduleKey="propertyManagement"><Receipts /></PermissionRoute>} />
            <Route path="/receipts/new"            element={<PermissionRoute resource="receipts" action="create" moduleKey="propertyManagement"><AddReceipt /></PermissionRoute>} />
            <Route path="/receipts/prepayments"    element={<PermissionRoute resource="receipts" moduleKey="propertyManagement"><TenantPrepayments /></PermissionRoute>} />
            <Route path="/receipts/mpesa-import"   element={<PermissionRoute resource="receipts" moduleKey="propertyManagement"><MpesaBatchImport /></PermissionRoute>} />
            <Route path="/receipts/instant"        element={<PermissionRoute resource="receipts" moduleKey="propertyManagement"><InstantReceipts /></PermissionRoute>} />
            <Route path="/receipts/landlord"       element={<CompanyModeRoute allowLandlordMode={false}><PermissionRoute resource="receipts" moduleKey="propertyManagement"><LandlordReceipts /></PermissionRoute></CompanyModeRoute>} />
            <Route path="/receipts/:id"            element={<ProtectedRoute><Receipts /></ProtectedRoute>} />

            {/* ── Financial ─────────────────────────────────────────────── */}
            <Route path="/financial/payment-vouchers"              element={<PermissionRoute resource="paymentVouchers" moduleKey="accounts"><PaymentVouchers /></PermissionRoute>} />
            <Route path="/financial/petty-cash"                    element={<PermissionRoute resource="paymentVouchers" moduleKey="accounts"><PettyCash /></PermissionRoute>} />
            <Route path="/financial/service-providers"             element={<PermissionRoute resource="expenses" moduleKey="accounts"><ServiceProviders /></PermissionRoute>} />
            <Route path="/expenses/requisition"                    element={<ProtectedRoute><ExpenseRequisition /></ProtectedRoute>} />
            <Route path="/financial/journals"                      element={<PermissionRoute resource="journals" moduleKey={GL_ACCESS_MODULES}><JournalEntries /></PermissionRoute>} />
            <Route path="/financial/chart-of-accounts"             element={<PermissionRoute resource="chartOfAccounts" moduleKey={GL_ACCESS_MODULES}><ChartOfAccounts /></PermissionRoute>} />
            <Route path="/financial/chart-of-accounts/:accountId/activity" element={<ProtectedRoute><LedgerAccountActivity /></ProtectedRoute>} />
            <Route path="/carwash/chart-of-accounts/:accountId/activity"  element={<CompanyModuleRoute moduleKey="carwash"><ProtectedRoute><LedgerAccountActivity /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/hr/chart-of-accounts/:accountId/activity"       element={<CompanyModuleRoute moduleKey="hr"><ProtectedRoute><LedgerAccountActivity /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/sale/chart-of-accounts/:accountId/activity"     element={<CompanyModuleRoute moduleKey="propertySale"><ProtectedRoute><LedgerAccountActivity /></ProtectedRoute></CompanyModuleRoute>} />
            <Route path="/financial/ledger-entries"                element={<ProtectedRoute><Navigate to="/financial/chart-of-accounts" replace /></ProtectedRoute>} />
            <Route path="/expenses/payment-vouchers"               element={<ProtectedRoute><PaymentVouchers /></ProtectedRoute>} />

            {/* ── Operations ────────────────────────────────────────────── */}
            <Route path="/vacants"             element={<ProtectedRoute><Vacants /></ProtectedRoute>} />
            <Route path="/maintenances"        element={<PermissionRoute resource="maintenances" moduleKey="propertyManagement"><Maintenances /></PermissionRoute>} />
            <Route path="/inspections"         element={<PermissionRoute resource="inspections" moduleKey="propertyManagement"><Inspections /></PermissionRoute>} />
            <Route path="/meter-readings"      element={<PermissionRoute resource="meterReadings" moduleKey="propertyManagement"><MeterReadings /></PermissionRoute>} />
            <Route path="/invoices/late-penalties" element={<PermissionRoute resource="latePenalties" moduleKey="propertyManagement"><LatePenalties /></PermissionRoute>} />
            <Route path="/tools/import-export" element={<ProtectedRoute><Navigate to="/reports/export" replace /></ProtectedRoute>} />
            <Route path="/tools/backup"        element={<ProtectedRoute><Navigate to="/settings" replace /></ProtectedRoute>} />

            {/* ── Reports ───────────────────────────────────────────────── */}
            <Route path="/reports/rental-collection"      element={<ProtectedRoute><RentalCollectionReport /></ProtectedRoute>} />
            <Route path="/reports/export"                 element={<ProtectedRoute><RentalCollectionReport /></ProtectedRoute>} />
            <Route path="/reports/property-income-summary"element={<PermissionRoute resource="financialReports" moduleKey="accounts"><PropertyIncomeSummaryReport /></PermissionRoute>} />
            <Route path="/reports/mri-tax-summary"        element={<PermissionRoute resource="financialReports" moduleKey="accounts"><MRITaxSummaryReport /></PermissionRoute>} />
            <Route path="/reports/paid-balance"           element={<ProtectedRoute><PaidBalanceReport /></ProtectedRoute>} />
            <Route path="/reports/aged-analysis"          element={<ProtectedRoute><AgedAnalysisReport /></ProtectedRoute>} />
            <Route path="/reports/rental-aged-analysis"   element={<ProtectedRoute><RentalAgedAnalysisReport /></ProtectedRoute>} />
            <Route path="/reports/commissions"            element={<CompanyModeRoute allowLandlordMode={false}><ProtectedRoute><CommissionReports /></ProtectedRoute></CompanyModeRoute>} />
            <Route path="/reports/trial-balance"          element={<PermissionRoute resource="financialReports" moduleKey="accounts"><TrialBalanceReport /></PermissionRoute>} />
            <Route path="/reports/income-statement"       element={<PermissionRoute resource="financialReports" moduleKey="accounts"><IncomeStatementReport /></PermissionRoute>} />
            <Route path="/reports/balance-sheet"          element={<PermissionRoute resource="financialReports" moduleKey="accounts"><BalanceSheetReport /></PermissionRoute>} />
            <Route path="/reports/tax-reports"            element={<PermissionRoute resource="financialReports" moduleKey="accounts"><TaxReports /></PermissionRoute>} />

            {/* ── Company & settings ────────────────────────────────────── */}
            <Route path="/company-setup" element={<PermissionRoute resource="companySettings" action="update"><CompanySetupPage /></PermissionRoute>} />
            <Route path="/settings"      element={<PermissionRoute resource="companySettings" action="view"><CompanySettings /></PermissionRoute>} />

            {/* ── Help ──────────────────────────────────────────────────── */}
            <Route path="/help/documentation" element={<ProtectedRoute><SupportDocumentation /></ProtectedRoute>} />
            <Route path="/help/support"       element={<ProtectedRoute><SupportDocumentation /></ProtectedRoute>} />
            <Route path="/help/about"         element={<ProtectedRoute><AboutMilik /></ProtectedRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ConfirmProvider>
  );
}

export default App;

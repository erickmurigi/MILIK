// App.js
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { clearCurrentCompany, getCompanySuccess, setCurrentCompany } from "./redux/companiesRedux";
import { initializeAuth } from "./redux/authSlice";
import { getAccessibleCompanies } from "./redux/apiCalls";
import useInactivityLogout from "./hooks/useInactivityLogout";
import { clearClientSessionStorage } from "./utils/sessionCleanup";
import "./App.css";
import { hasCompanyPermission } from "./utils/permissions";

import Home from "./pages/Home/Home";
import Login from "./pages/Login/Login";
import SetupAdmin from "./pages/Login/SetupAdmin";
import FirstTimePassword from "./pages/Login/FirstTimePassword";
import Dashboard from "./pages/Dashboard/Dashboard";
import Landlords from "./pages/Landlord/Landlord";
import AddLandlord from "./components/Landlord/AddLandlord";
import LandlordPayments from "./pages/Landlord/LandlordPayments";
import LandlordCommissionsStatement from "./pages/Landlord/LandlordCommissionsStatement";
import ProcessedStatements from "./pages/Landlord/ProcessedStatements";
import Properties from "./pages/Properties/Properties";
import PropertyCommissionSettings from "./pages/Properties/PropertyCommissionSettings";
import CommissionsList from "./pages/Properties/CommissionsList";
import Units from "./pages/Units/Units";
import AddUnit from "./components/Units/AddUnit";
import Tenants from "./pages/Tenants/Tenants";
import AddTenant from "./pages/Tenants/AddTenant";
import TenantStatement from "./pages/Tenants/TenantStatement";
import RentalInvoices from "./pages/Tenants/RentalInvoices";
import Receipts from "./pages/Tenants/Receipts";
import InvoiceNotes from "./pages/Tenants/InvoiceNotes";
import AddReceipt from "./pages/Tenants/AddReceipt";
import TenantDeposits from "./pages/Tenants/TenantDeposits";
import TakeOnBalances from "./pages/Tenants/TakeOnBalances";
import UnitTypesPage from "./pages/Lease/Lease";
import Vacants from "./pages/Vacants/Vacants";
import Maintenances from "./pages/Maintenances/Maintenances";
import Inspections from "./pages/Inspections/Inspections";
import AddProperty from "./components/Properties/AddProperties";
import ModulesDashboard from "./pages/moduleDashboard/ModulesDashboard";
import EditProperty from "./components/Properties/EditProperties";
import PropertyDetail from "./components/Properties/PropertyDetail";
import CompanySetupPage from "./pages/companySetup/CompanySetupPage";
import SystemSetupPage from "./pages/SystemSetup/SystemSetup";
import AddCompanyWizard from "./pages/SystemSetup/AddCompanyWizard";
import AddUserPage from "./pages/SystemSetup/AddUsers";
import CompanySettings from "./pages/SystemSetup/CompanySettings";
import PaymentVouchers from "./pages/Financial/PaymentVouchers";
import ChartOfAccounts from "./pages/Financial/ChartOfAccounts";
import LedgerAccountActivity from "./pages/Financial/LedgerAccountActivity";
import RentalCollectionReport from "./pages/Reports/RentalCollectionReport";
import PaidBalanceReport from "./pages/Reports/PaidBalanceReport";
import AgedAnalysisReport from "./pages/Reports/AgedAnalysisReport";
import CommissionReports from "./pages/Reports/CommissionReports";
import TrialBalanceReport from "./pages/Reports/TrialBalanceReport";
import IncomeStatementReport from "./pages/Reports/IncomeStatementReport";
import BalanceSheetReport from "./pages/Reports/BalanceSheetReport";
import TaxReports from "./pages/Reports/TaxReports";
import JournalEntries from "./pages/Financial/JournalEntries";
import MeterReadings from "./pages/Tools/MeterReadings";
import LatePenalties from "./pages/Tools/LatePenalties";
import SupportDocumentation from "./pages/Help/SupportDocumentation";
import AboutMilik from "./pages/Help/AboutMilik";

const DEMO_EXPIRED_NOTICE_KEY = "milik_demo_expired_notice";
const DEMO_EXPIRED_MESSAGE = "Your demo period has ended. Contact MILIK for activation.";
const EXTRA_SESSION_KEYS = ["milik_active_company_id", "milik_demo_mode", "milik_demo_company_id"];

const getStoredUser = () => {
  try {
    const raw = localStorage.getItem("milik_user");
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
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
  } catch (_error) {
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
    try {
      localStorage.removeItem(key);
    } catch (_error) {
      // Ignore storage cleanup issues during forced logout.
    }
  });

  if (isDemoUser) {
    try {
      sessionStorage.setItem(DEMO_EXPIRED_NOTICE_KEY, DEMO_EXPIRED_MESSAGE);
    } catch (_error) {
      // Ignore storage write issues and continue cleanup.
    }
  }
};

const getStoredAuthSession = () => {
  const token = localStorage.getItem("milik_token");
  if (!token) {
    return { token: null, user: null };
  }

  const user = getStoredUser();
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
  try {
    return Boolean(sessionStorage.getItem(DEMO_EXPIRED_NOTICE_KEY));
  } catch (_error) {
    return false;
  }
};

const getSignedOutRedirectPath = () =>
  hasDemoExpiredNotice() ? "/home?demoExpired=1" : "/login";

function ProtectedRoute({ children, allowMustChangePassword = false }) {
  const { currentUser } = useSelector((state) => state.auth);
  const storedSession = getStoredAuthSession();
  const resolvedUser = getResolvedAuthUser(currentUser, storedSession);
  const token = storedSession.token;
  const isAuthenticated = Boolean(resolvedUser || token);

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



function PermissionRoute({ children, resource, action = "view", moduleKey = null, fallback = "/dashboard" }) {
  const { currentUser } = useSelector((state) => state.auth);
  const { currentCompany } = useSelector((state) => state.company);
  const storedSession = getStoredAuthSession();
  const resolvedUser = getResolvedAuthUser(currentUser, storedSession);
  const token = storedSession.token;
  const isAuthenticated = Boolean(resolvedUser || token);

  if (!isAuthenticated) return <Navigate to={getSignedOutRedirectPath()} replace />;
  const allowed = hasCompanyPermission(resolvedUser || {}, currentCompany || resolvedUser?.company, resource, action, moduleKey);
  return allowed ? children : <Navigate to={fallback} replace />;
}


function SuperAdminRoute({ children }) {
  const { currentUser } = useSelector((state) => state.auth);
  const storedSession = getStoredAuthSession();
  const resolvedUser = getResolvedAuthUser(currentUser, storedSession);
  const token = storedSession.token;
  const isAuthenticated = Boolean(resolvedUser || token);
  const canAccess = Boolean(resolvedUser?.isSystemAdmin || resolvedUser?.superAdminAccess);

  if (!isAuthenticated) return <Navigate to={getSignedOutRedirectPath()} replace />;
  return canAccess ? children : <Navigate to="/dashboard" replace />;
}


function resolveDefaultAuthenticatedRoute(currentUser) {
  if (
    currentUser?.mustChangePassword &&
    !currentUser?.isSystemAdmin &&
    !currentUser?.superAdminAccess
  ) {
    return "/first-time-password";
  }

  return "/dashboard";
}

function PublicOnlyRoute({ children }) {
  const { currentUser } = useSelector((state) => state.auth);
  const storedSession = getStoredAuthSession();
  const resolvedUser = getResolvedAuthUser(currentUser, storedSession);
  const token = storedSession.token;
  const isAuthenticated = Boolean(resolvedUser || token);

  if (!isAuthenticated) return children;
  return <Navigate to={resolveDefaultAuthenticatedRoute(resolvedUser)} replace />;
}


function PublicEntryRoute() {
  const { currentUser } = useSelector((state) => state.auth);
  const storedSession = getStoredAuthSession();
  const resolvedUser = getResolvedAuthUser(currentUser, storedSession);
  const token = storedSession.token;
  const isAuthenticated = Boolean(resolvedUser || token);

  return (
    <Navigate
      to={isAuthenticated ? resolveDefaultAuthenticatedRoute(resolvedUser) : "/home"}
      replace
    />
  );
}


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

    if (storedUser?.company?._id) {
      dispatch(setCurrentCompany(storedUser.company));
      localStorage.setItem("milik_active_company_id", storedUser.company._id);
    }
  }, [currentUser, dispatch]);

  useEffect(() => {
    const resolvedUser = getResolvedAuthUser(currentUser, getStoredAuthSession());
    const userCompanyId = resolvedUser?.company?._id;
    const activeCompanyId = currentCompany?._id;

    if (userCompanyId && userCompanyId !== activeCompanyId) {
      dispatch(setCurrentCompany(resolvedUser.company));
      localStorage.setItem("milik_active_company_id", userCompanyId);
      return;
    }

    if (!resolvedUser?.isSystemAdmin && !resolvedUser?.superAdminAccess && !userCompanyId && activeCompanyId) {
      dispatch(clearCurrentCompany());
      localStorage.removeItem("milik_active_company_id");
    }
  }, [currentUser, currentCompany?._id, dispatch]);

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

  useEffect(() => {
    let cancelled = false;

    const initializeSystemAdminCompany = async () => {
      const resolvedUser = getResolvedAuthUser(currentUser, getStoredAuthSession());
      if (!resolvedUser?.isSystemAdmin && !resolvedUser?.superAdminAccess) return;
      if (isCompanySwitching) return;
      if (currentCompany?._id) {
        localStorage.setItem("milik_active_company_id", currentCompany._id);
        return;
      }

      try {
        const companies = await getAccessibleCompanies();
        const availableCompanies = Array.isArray(companies) ? companies : [];

        if (cancelled || availableCompanies.length === 0) return;

        const preferredCompanyId = localStorage.getItem("milik_active_company_id");
        const preferredCompany =
          availableCompanies.find((company) => String(company._id) === String(preferredCompanyId)) ||
          availableCompanies[0];

        if (preferredCompany?._id) {
          dispatch(setCurrentCompany(preferredCompany));
          dispatch(getCompanySuccess(preferredCompany));
          localStorage.setItem("milik_active_company_id", preferredCompany._id);
        }
      } catch (error) {
        console.error("Failed to initialize active company for system admin:", error);
      }
    };

    initializeSystemAdminCompany();
    return () => {
      cancelled = true;
    };
  }, [currentUser, currentCompany?._id, dispatch, isCompanySwitching]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicEntryRoute />} />
        <Route path="/home" element={<PublicOnlyRoute><Home /></PublicOnlyRoute>} />
        <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
        <Route path="/setup-admin" element={<SetupAdmin />} />
        <Route path="/first-time-password" element={<ProtectedRoute allowMustChangePassword={true}><FirstTimePassword /></ProtectedRoute>} />

        <Route path="/moduleDashboard" element={<ProtectedRoute><ModulesDashboard /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/system-setup" element={<SuperAdminRoute><Navigate to="/system-setup/companies" replace /></SuperAdminRoute>} />
        <Route path="/system-setup/companies" element={<SuperAdminRoute><SystemSetupPage /></SuperAdminRoute>} />
        <Route path="/system-setup/users" element={<SuperAdminRoute><SystemSetupPage /></SuperAdminRoute>} />
        <Route path="/system-setup/rights" element={<SuperAdminRoute><SystemSetupPage /></SuperAdminRoute>} />
        <Route path="/system-setup/database" element={<SuperAdminRoute><SystemSetupPage /></SuperAdminRoute>} />
        <Route path="/system-setup/sessions" element={<SuperAdminRoute><SystemSetupPage /></SuperAdminRoute>} />
        <Route path="/system-setup/audit" element={<SuperAdminRoute><SystemSetupPage /></SuperAdminRoute>} />
        <Route path="/landlords" element={<PermissionRoute resource="landlords" moduleKey="propertyManagement"><Landlords /></PermissionRoute>} />
        <Route path="/landlords/new" element={<ProtectedRoute><AddLandlord /></ProtectedRoute>} />
        <Route path="/landlord-payments" element={<ProtectedRoute><LandlordPayments /></ProtectedRoute>} />
        <Route path="/financial/landlord-statement" element={<ProtectedRoute><LandlordCommissionsStatement /></ProtectedRoute>} />
        <Route path="/landlord/processed-statements" element={<PermissionRoute resource="processedStatements" moduleKey="accounts"><ProcessedStatements /></PermissionRoute>} />
        <Route path="/landlord/statements" element={<PermissionRoute resource="statements" moduleKey="propertyManagement"><LandlordCommissionsStatement /></PermissionRoute>} />
        <Route path="/properties" element={<PermissionRoute resource="properties" moduleKey="propertyManagement"><Properties /></PermissionRoute>} />
        <Route path="/units" element={<PermissionRoute resource="units" moduleKey="propertyManagement"><Units /></PermissionRoute>} />
        <Route path="/units/new" element={<ProtectedRoute><AddUnit /></ProtectedRoute>} />
        <Route path="/units/:id" element={<ProtectedRoute><AddUnit /></ProtectedRoute>} />
        <Route path="/units/space-types" element={<PermissionRoute resource="units" moduleKey="propertyManagement"><UnitTypesPage /></PermissionRoute>} />
        <Route path="/tenants" element={<PermissionRoute resource="tenants" moduleKey="propertyManagement"><Tenants /></PermissionRoute>} />
        <Route path="/tenant/new" element={<ProtectedRoute><AddTenant /></ProtectedRoute>} />
        <Route path="/tenant/:id/statement" element={<ProtectedRoute><TenantStatement /></ProtectedRoute>} />
        <Route path="/tenant/:id/edit" element={<ProtectedRoute><AddTenant /></ProtectedRoute>} />
        <Route path="/tenants/deposits" element={<PermissionRoute resource="tenants" moduleKey="propertyManagement"><TenantDeposits /></PermissionRoute>} />
        <Route path="/tenants/take-on-balances" element={<PermissionRoute resource="tenants" moduleKey="propertyManagement"><TakeOnBalances /></PermissionRoute>} />
        <Route path="/invoices/rental" element={<PermissionRoute resource="tenantInvoices" moduleKey="propertyManagement"><RentalInvoices /></PermissionRoute>} />
        <Route path="/invoices/rental/:id" element={<ProtectedRoute><RentalInvoices /></ProtectedRoute>} />
        <Route path="/invoices/notes" element={<PermissionRoute resource="tenantInvoices" moduleKey="propertyManagement"><InvoiceNotes /></PermissionRoute>} />
        <Route path="/receipts" element={<PermissionRoute resource="receipts" moduleKey="propertyManagement"><Receipts /></PermissionRoute>} />
        <Route path="/receipts/new" element={<PermissionRoute resource="receipts" action="create" moduleKey="propertyManagement"><AddReceipt /></PermissionRoute>} />
        <Route path="/receipts/:id" element={<ProtectedRoute><Receipts /></ProtectedRoute>} />
        <Route path="/financial/payment-vouchers" element={<PermissionRoute resource="paymentVouchers" moduleKey="accounts"><PaymentVouchers /></PermissionRoute>} />
        <Route path="/financial/journals" element={<PermissionRoute resource="journals" moduleKey="accounts"><JournalEntries /></PermissionRoute>} />
        <Route path="/financial/chart-of-accounts" element={<PermissionRoute resource="chartOfAccounts" moduleKey="accounts"><ChartOfAccounts /></PermissionRoute>} />
        <Route path="/financial/chart-of-accounts/:accountId/activity" element={<ProtectedRoute><LedgerAccountActivity /></ProtectedRoute>} />
        <Route path="/expenses/payment-vouchers" element={<ProtectedRoute><PaymentVouchers /></ProtectedRoute>} />
        <Route path="/vacants" element={<ProtectedRoute><Vacants /></ProtectedRoute>} />
        <Route path="/maintenances" element={<ProtectedRoute><Maintenances /></ProtectedRoute>} />
        <Route path="/inspections" element={<ProtectedRoute><Inspections /></ProtectedRoute>} />
        <Route path="/add-company" element={<SuperAdminRoute><AddCompanyWizard /></SuperAdminRoute>} />
        <Route path="/add-company/:id" element={<SuperAdminRoute><AddCompanyWizard /></SuperAdminRoute>} />
        <Route path="/properties/new" element={<ProtectedRoute><AddProperty /></ProtectedRoute>} />
        <Route path="/properties/:id" element={<ProtectedRoute><PropertyDetail /></ProtectedRoute>} />
        <Route path="/properties/edit/:id" element={<ProtectedRoute><EditProperty /></ProtectedRoute>} />
        <Route path="/properties/commission-settings" element={<ProtectedRoute><PropertyCommissionSettings /></ProtectedRoute>} />
        <Route path="/properties/commissions-list" element={<ProtectedRoute><CommissionsList /></ProtectedRoute>} />
        <Route path="/add-user" element={<SuperAdminRoute><AddUserPage /></SuperAdminRoute>} />
        <Route path="/company-setup" element={<PermissionRoute resource="companySettings" action="update"><CompanySetupPage /></PermissionRoute>} />
        <Route path="/settings" element={<PermissionRoute resource="companySettings" action="view"><CompanySettings /></PermissionRoute>} />
        <Route path="/reports/rental-collection" element={<ProtectedRoute><RentalCollectionReport /></ProtectedRoute>} />
        <Route path="/reports/export" element={<ProtectedRoute><RentalCollectionReport /></ProtectedRoute>} />
        <Route path="/reports/paid-balance" element={<ProtectedRoute><PaidBalanceReport /></ProtectedRoute>} />
        <Route path="/reports/aged-analysis" element={<ProtectedRoute><AgedAnalysisReport /></ProtectedRoute>} />
        <Route path="/reports/rental-aged-analysis" element={<ProtectedRoute><AgedAnalysisReport /></ProtectedRoute>} />
        <Route path="/reports/commissions" element={<ProtectedRoute><CommissionReports /></ProtectedRoute>} />
        <Route path="/reports/trial-balance" element={<PermissionRoute resource="financialReports" moduleKey="accounts"><TrialBalanceReport /></PermissionRoute>} />
        <Route path="/reports/income-statement" element={<PermissionRoute resource="financialReports" moduleKey="accounts"><IncomeStatementReport /></PermissionRoute>} />
        <Route path="/reports/balance-sheet" element={<PermissionRoute resource="financialReports" moduleKey="accounts"><BalanceSheetReport /></PermissionRoute>} />
        <Route path="/reports/tax-reports" element={<PermissionRoute resource="financialReports" moduleKey="accounts"><TaxReports /></PermissionRoute>} />
        <Route path="/help/documentation" element={<ProtectedRoute><SupportDocumentation /></ProtectedRoute>} />
        <Route path="/help/support" element={<ProtectedRoute><SupportDocumentation /></ProtectedRoute>} />
        <Route path="/help/about" element={<ProtectedRoute><AboutMilik /></ProtectedRoute>} />
        <Route path="/meter-readings" element={<PermissionRoute resource="meterReadings" moduleKey="propertyManagement"><MeterReadings /></PermissionRoute>} />
        <Route path="/invoices/late-penalties" element={<PermissionRoute resource="latePenalties" moduleKey="propertyManagement"><LatePenalties /></PermissionRoute>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App; 
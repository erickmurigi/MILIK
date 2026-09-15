import { adminRequests } from "../../utils/requestMethods";
import { clearClientSessionStorage } from "../../utils/sessionCleanup";
import { clearAllTabCache } from "../../hooks/useTabState";
import { extractList, resolveCompanyFromPayload } from "./shared";

import {
  loginStart,
  loginSuccess,
  loginFailure,
  logoutStart,
  logoutSuccess,
  logoutFailure,
  getCurrentUserStart,
  getCurrentUserSuccess,
  getCurrentUserFailure,
} from "../authSlice";

import {
  setCurrentCompany,
  clearCompanyState,
  startCompanySwitch,
  finishCompanySwitch,
  failCompanySwitch,
  getCompanySuccess,
} from "../companiesRedux";
import { resetCompanyScopedState } from "../companyContextActions";

const resetPersistedWorkspaceCache = () => {
  const transientKeys = [
    "app-tabs",
    "active-tab",
  ];
  transientKeys.forEach((key) => {
    try { localStorage.removeItem(key); } catch (_e) {}
  });
};

const clearPreLoginSessionArtifacts = () => {
  [
    "milik_token",
    "milik_user",
    "milik_active_company_id",
    "app-tabs",
    "active-tab",
  ].forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch (_error) {
      // no-op
    }
  });
};

const ACCESSIBLE_COMPANIES_CACHE_TTL = 60 * 1000;
let accessibleCompaniesCache = {
  data: null,
  loadedAt: 0,
  promise: null,
};

export const invalidateAccessibleCompaniesCache = () => {
  accessibleCompaniesCache = {
    data: null,
    loadedAt: 0,
    promise: null,
  };
};

// Switch company context
export const switchCompany = (companyId) => async (dispatch) => {
  dispatch(startCompanySwitch(companyId));
  // Clear old company-scoped Redux slices immediately so no stale data
  // lingers in the store while the API call is in flight.
  dispatch(resetCompanyScopedState());

  try {
    const res = await adminRequests.post("/auth/switch-company", { companyId });
    const data = res?.data || {};
    const token = data?.token;
    const user = data?.user || data?.data?.user || null;
    const company =
      resolveCompanyFromPayload(data) ||
      user?.company ||
      data?.company ||
      null;

    invalidateAccessibleCompaniesCache();
    resetPersistedWorkspaceCache();

    if (user) {
      dispatch(loginSuccess({ user, token: token || localStorage.getItem("milik_token") }));
    }

    if (company?._id) {
      dispatch(getCompanySuccess(company));
      localStorage.setItem("milik_active_company_id", company._id);
    } else if (typeof companyId === "string" && companyId) {
      localStorage.setItem("milik_active_company_id", companyId);
      try {
        const companyRes = await adminRequests.get(`/companies/${companyId}`);
        const resolvedCompany = companyRes?.data?.company || companyRes?.data || null;
        if (resolvedCompany?._id) {
          dispatch(getCompanySuccess(resolvedCompany));
        }
      } catch (_companyErr) {
        // Keep token/user switch successful even if company re-fetch fails.
      }
    }

    dispatch(finishCompanySwitch());
    return data;
  } catch (err) {
    dispatch(failCompanySwitch());
    throw err;
  }
};

// Accessible companies for current logged-in user (for Start Menu switch company)
export const getAccessibleCompanies = async ({ forceRefresh = false } = {}) => {
  const cacheIsFresh =
    !forceRefresh &&
    Array.isArray(accessibleCompaniesCache.data) &&
    Date.now() - accessibleCompaniesCache.loadedAt < ACCESSIBLE_COMPANIES_CACHE_TTL;

  if (cacheIsFresh) {
    return accessibleCompaniesCache.data;
  }

  if (!forceRefresh && accessibleCompaniesCache.promise) {
    return accessibleCompaniesCache.promise;
  }

  accessibleCompaniesCache.promise = adminRequests
    .get("/auth/accessible-companies")
    .then((res) => {
      const companies = extractList(res.data);
      accessibleCompaniesCache = {
        data: companies,
        loadedAt: Date.now(),
        promise: null,
      };
      return companies;
    })
    .catch((error) => {
      accessibleCompaniesCache = {
        data: null,
        loadedAt: 0,
        promise: null,
      };
      throw error;
    });

  return accessibleCompaniesCache.promise;
};

// Silent JWT token refresh — returns response data on success, null on failure
export const refreshAccessToken = async () => {
  try {
    const res = await adminRequests.post('/auth/refresh');
    return res.data;
  } catch (error) {
    // Distinguish a definitive rejection (refresh token invalid/revoked — 401/403,
    // e.g. blacklisted after logout-elsewhere or a password change) from a transient
    // failure (network blip, 429 rate-limit, 5xx) — only the former should force a
    // logout; retrying/limping along on the latter avoids compounding a rate-limit
    // lockout with an extra redirect cycle.
    const status = error?.response?.status;
    return { token: null, definitivelyInvalid: status === 401 || status === 403 };
  }
};

export const loginUser = (email, password) => async (dispatch) => {
  dispatch(loginStart());
  try {
    clearPreLoginSessionArtifacts();

    const res = await adminRequests.post('/auth/login', {
      email,
      password
    });

    const { user, token, company } = res.data;
    const resolvedCompany = company?._id ? company : user?.company?._id ? user.company : null;

    invalidateAccessibleCompaniesCache();
    dispatch(clearCompanyState());
    await resetPersistedWorkspaceCache();

    dispatch(loginSuccess({ user, token }));

    if (resolvedCompany?._id) {
      dispatch(setCurrentCompany(resolvedCompany));
      dispatch(getCompanySuccess(resolvedCompany));
      localStorage.setItem('milik_active_company_id', resolvedCompany._id);
    } else {
      localStorage.removeItem('milik_active_company_id');
    }

    return { user, token, company: resolvedCompany };
  } catch (err) {
    dispatch(loginFailure());
    throw err;
  }
};

export const logoutUser = () => async (dispatch) => {
  dispatch(logoutStart());
  try {
    // Call logout endpoint
    await adminRequests.post('/auth/logout');

    invalidateAccessibleCompaniesCache();
    dispatch(clearCompanyState());
    clearClientSessionStorage();
    clearAllTabCache();

    dispatch(logoutSuccess());
    return true;
  } catch (err) {
    dispatch(logoutFailure());
    throw err;
  }
};

export const getCurrentUser = () => async (dispatch) => {
  dispatch(getCurrentUserStart());
  try {
    const res = await adminRequests.get('/auth/me');
    dispatch(getCurrentUserSuccess(res.data.user));
    return res.data.user;
  } catch (err) {
    dispatch(getCurrentUserFailure());
    throw err;
  }
};

export const registerUser = (userData) => async (dispatch) => {
  try {
    const res = await adminRequests.post('/auth', userData);
    return res.data.user;
  } catch (err) {
    throw err;
  }
};

export const createSuperAdmin = (adminData) => async (dispatch) => {
  dispatch(loginStart());
  try {
    const res = await adminRequests.post('/auth/super-admin', adminData);
    const { user, token } = res.data;

    invalidateAccessibleCompaniesCache();
    dispatch(loginSuccess({ user, token }));
    return { user, token };
  } catch (err) {
    dispatch(loginFailure());
    throw err;
  }
};

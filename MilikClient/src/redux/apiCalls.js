/* eslint-disable no-undef */
import {adminRequests} from "../utils/requestMethods"
import { clearClientSessionStorage } from "../utils/sessionCleanup";



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
} from "../redux/authSlice";

import {
  getLandlordsStart,
  getLandlordsSuccess,
  getLandlordsFailure,
  createLandlordStart,
  createLandlordSuccess,
  createLandlordFailure,
  updateLandlordStart,
  updateLandlordSuccess,
  updateLandlordFailure,
  deleteLandlordStart,
  deleteLandlordSuccess,
  deleteLandlordFailure
} from "../redux/landlordRedux";

import {
  getStatementsStart,
  getStatementsSuccess,
  getStatementsFailure,
  getStatementStart,
  getStatementSuccess,
  getStatementFailure,
  createDraftStart,
  createDraftSuccess,
  createDraftFailure,
  approveStart,
  approveSuccess,
  approveFailure,
  sendStart,
  sendSuccess,
  sendFailure,
  createRevisionStart,
  createRevisionSuccess,
  createRevisionFailure,
  deleteDraftStart,
  deleteDraftSuccess,
  deleteDraftFailure,
  validateAuditStart,
  validateAuditSuccess,
  validateAuditFailure,
} from "../redux/statementsRedux";



import {
  getUtilitiesStart,
  getUtilitiesSuccess,
  getUtilitiesFailure,
  createUtilityStart,
  createUtilitySuccess,
  createUtilityFailure,
  updateUtilityStart,
  updateUtilitySuccess,
  updateUtilityFailure,
  deleteUtilityStart,
  deleteUtilitySuccess,
  deleteUtilityFailure
} from "../redux/utilityRedux";

import {
  getUnitsStart,
  getUnitsSuccess,
  getUnitsFailure,
  createUnitStart,
  createUnitSuccess,
  createUnitFailure,
  updateUnitStart,
  updateUnitSuccess,
  updateUnitFailure,
  deleteUnitStart,
  deleteUnitSuccess,
  deleteUnitFailure,
  updateUnitStatusStart,
  updateUnitStatusSuccess,
  updateUnitStatusFailure
} from "../redux/unitRedux";

import {
  getTenantsStart,
  getTenantsSuccess,
  getTenantsFailure,
  createTenantStart,
  createTenantSuccess,
  createTenantFailure,
  updateTenantStart,
  updateTenantSuccess,
  updateTenantFailure,
  deleteTenantStart,
  deleteTenantSuccess,
  deleteTenantFailure,
  updateTenantStatusStart,
  updateTenantStatusSuccess,
  updateTenantStatusFailure
} from "../redux/tenantsRedux";

import {
  getRentPaymentsStart,
  getRentPaymentsSuccess,
  getRentPaymentsFailure,
  createRentPaymentStart,
  createRentPaymentSuccess,
  createRentPaymentFailure,
  updateRentPaymentStart,
  updateRentPaymentSuccess,
  updateRentPaymentFailure,
  deleteRentPaymentStart,
  deleteRentPaymentSuccess,
  deleteRentPaymentFailure,
  confirmRentPaymentStart,
  confirmRentPaymentSuccess,
  confirmRentPaymentFailure,
  unconfirmRentPaymentStart,
  unconfirmRentPaymentSuccess,
  unconfirmRentPaymentFailure
} from "../redux/rentPaymentRedux";

import {
  getMaintenancesStart,
  getMaintenancesSuccess,
  getMaintenancesFailure,
  createMaintenanceStart,
  createMaintenanceSuccess,
  createMaintenanceFailure,
  updateMaintenanceStart,
  updateMaintenanceSuccess,
  updateMaintenanceFailure,
  deleteMaintenanceStart,
  deleteMaintenanceSuccess,
  deleteMaintenanceFailure,
  updateMaintenanceStatusStart,
  updateMaintenanceStatusSuccess,
  updateMaintenanceStatusFailure
} from "../redux/maintenanceRedux";

import {
  getLeasesStart,
  getLeasesSuccess,
  getLeasesFailure,
  createLeaseStart,
  createLeaseSuccess,
  createLeaseFailure,
  updateLeaseStart,
  updateLeaseSuccess,
  updateLeaseFailure,
  deleteLeaseStart,
  deleteLeaseSuccess,
  deleteLeaseFailure,
  signLeaseStart,
  signLeaseSuccess,
  signLeaseFailure,
  renewLeaseStart,
  renewLeaseSuccess,
  renewLeaseFailure
} from "../redux/leasesRedux";

import {
  getExpensePropertiesStart,
  getExpensePropertiesSuccess,
  getExpensePropertiesFailure,
  createExpensePropertyStart,
  createExpensePropertySuccess,
  createExpensePropertyFailure,
  updateExpensePropertyStart,
  updateExpensePropertySuccess,
  updateExpensePropertyFailure,
  deleteExpensePropertyStart,
  deleteExpensePropertySuccess,
  deleteExpensePropertyFailure
} from "../redux/expensePropertyRedux";

import {
  getNotificationsStart,
  getNotificationsSuccess,
  getNotificationsFailure,
  createNotificationStart,
  createNotificationSuccess,
  createNotificationFailure,
  updateNotificationStart,
  updateNotificationSuccess,
  updateNotificationFailure,
  deleteNotificationStart,
  deleteNotificationSuccess,
  deleteNotificationFailure,
  markNotificationAsReadStart,
  markNotificationAsReadSuccess,
  markNotificationAsReadFailure,
  markAllNotificationsAsReadStart,
  markAllNotificationsAsReadSuccess,
  markAllNotificationsAsReadFailure
} from "../redux/notificationPropertyRedux";

import {
  getSettingsStart,
  getSettingsSuccess,
  getSettingsFailure,
  addUtilityStart,
  addUtilitySuccess,
  addUtilityFailure,
  updateUtilityStart as updateUtilitySettingStart,
  updateUtilitySuccess as updateUtilitySettingSuccess,
  updateUtilityFailure as updateUtilitySettingFailure,
  deleteUtilityStart as deleteUtilitySettingStart,
  deleteUtilitySuccess as deleteUtilitySettingSuccess,
  deleteUtilityFailure as deleteUtilitySettingFailure,
  addPeriodStart,
  addPeriodSuccess,
  addPeriodFailure,
  updatePeriodStart,
  updatePeriodSuccess,
  updatePeriodFailure,
  deletePeriodStart,
  deletePeriodSuccess,
  deletePeriodFailure,
  addCommissionStart,
  addCommissionSuccess,
  addCommissionFailure,
  updateCommissionStart,
  updateCommissionSuccess,
  updateCommissionFailure,
  deleteCommissionStart,
  deleteCommissionSuccess,
  deleteCommissionFailure,
  addExpenseStart,
  addExpenseSuccess,
  addExpenseFailure,
  updateExpenseStart,
  updateExpenseSuccess,
  updateExpenseFailure,
  deleteExpenseStart,
  deleteExpenseSuccess,
  deleteExpenseFailure,
} from "../redux/companySettingsRedux";

import {
  createPrinterFailure,
  createPrinterStart,
  createPrinterSuccess,
  deletePrinterFailure,
  deletePrinterStart,
  deletePrinterSuccess,
  getPrintersFailure,
  getPrintersStart,
  getPrintersSuccess
} from "./printerRedux";

// Create payment voucher (generic, for compatibility)
export const createPaymentVoucher = async (voucherData) => {
  // Use the same endpoint as createLandlordPayment
  const res = await adminRequests.post("/payment-vouchers", voucherData);
  return res.data;
};

//requests actions
import {
  getRequestsFailure,
  getRequestsStart,
  getRequestsSuccess,
  createRequestStart,
  createRequestFailure,
  createRequestSuccess,
  deleteRequestStart,
  deleteRequestSuccess,
  deleteRequestFailure
} from "./requestServiceRedux"

import {
  getCompaniesStart,
  getCompaniesSuccess,
  getCompaniesFailure,
  getCompanyStart,
  getCompanySuccess,
  getCompanyFailure,
  createCompanyStart,
  createCompanySuccess,
  createCompanyFailure,
  updateCompanyStart,
  updateCompanySuccess,
  updateCompanyFailure,
  deleteCompanyStart,
  deleteCompanySuccess,
  deleteCompanyFailure,
  setCurrentCompany,
  clearCompanyState,
  startCompanySwitch,
  finishCompanySwitch,
  failCompanySwitch,
} from "./companiesRedux";
import { resetCompanyScopedState } from "./companyContextActions";

import {
  getUsersStart,
  getUsersSuccess,
  getUsersFailure,
  getUserStart,
  getUserSuccess,
  getUserFailure,
  createUserStart,
  createUserSuccess,
  createUserFailure,
  updateUserStart,
  updateUserSuccess,
  updateUserFailure,
  deleteUserStart,
  deleteUserSuccess,
  deleteUserFailure,
  toggleUserLockStart,
  toggleUserLockSuccess,
  toggleUserLockFailure,
} from "./userRedux";

// Helper to transform user data (if needed)
const transformUserData = (data) => {
  // No transformation needed for now
  return data;
};

// Ensure list reducers always receive an array regardless of API response wrapper.
const extractList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.companies)) return payload.companies;
  if (Array.isArray(payload?.users)) return payload.users;
  return [];
};


const resetPersistedWorkspaceCache = async () => {
  const transientKeys = [
    "app-tabs",
    "active-tab",
    "milik_demo_mode",
    "milik_demo_company_id",
  ];

  transientKeys.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch (_error) {
      // no-op
    }
  });
};

const getStoredUser = () => {
  try {
    const raw = localStorage.getItem("milik_user");
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

const resolveCompanyFromPayload = (payload = {}) => {
  if (payload?.company?._id) return payload.company;
  if (payload?.user?.company?._id) return payload.user.company;
  if (payload?.currentCompany?._id) return payload.currentCompany;
  return null;
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
  dispatch(getCompanyStart());

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
    await resetPersistedWorkspaceCache();
    localStorage.removeItem("milik_demo_mode");
    localStorage.removeItem("milik_demo_company_id");

    dispatch(resetCompanyScopedState());

    if (user) {
      dispatch(loginSuccess({ user, token: token || localStorage.getItem("milik_token") }));
    }

    if (company?._id) {
      dispatch(setCurrentCompany(company));
      dispatch(getCompanySuccess(company));
      localStorage.setItem("milik_active_company_id", company._id);
    } else if (typeof companyId === "string" && companyId) {
      localStorage.setItem("milik_active_company_id", companyId);
      try {
        const companyRes = await adminRequests.get(`/companies/${companyId}`);
        const resolvedCompany = companyRes?.data?.company || companyRes?.data || null;
        if (resolvedCompany?._id) {
          dispatch(setCurrentCompany(resolvedCompany));
          dispatch(getCompanySuccess(resolvedCompany));
        }
      } catch (_companyErr) {
        // Keep token/user switch successful even if company re-fetch fails.
      }
    }

    dispatch(finishCompanySwitch());
    return data;
  } catch (err) {
    dispatch(getCompanyFailure());
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

const resolveCompanyId = (query = {}, getState) => {
  if (query?.company) return query.company;

  const state = typeof getState === "function" ? getState() : {};
  const companyFromState = state?.company?.currentCompany?._id;
  if (companyFromState) return companyFromState;

  const authUser = state?.auth?.currentUser || state?.auth?.user;
  if (authUser?.company?._id) return authUser.company._id;
  if (typeof authUser?.company === "string") return authUser.company;

  const storedUser = getStoredUser();
  if (storedUser?.company?._id) return storedUser.company._id;
  if (typeof storedUser?.company === "string") return storedUser.company;

  return null;
};

const resolveLandlordIdFromProperty = (propertyId, getState) => {
  if (!propertyId) return null;
  const state = typeof getState === "function" ? getState() : {};
  const properties = Array.isArray(state?.property?.properties) ? state.property.properties : [];
  const property = properties.find((item) => String(item?._id) === String(propertyId));
  if (!property) return null;

  const landlords = Array.isArray(property?.landlords) ? property.landlords : [];
  const primary = landlords.find((item) => item?.isPrimary && item?.landlordId);
  const fallback = landlords.find((item) => item?.landlordId);
  return primary?.landlordId || fallback?.landlordId || null;
};

// Get all users for a company
export const getUsers = (companyId, queryParams = {}) => async (dispatch) => {
  dispatch(getUsersStart());
  try {
    const params = { ...queryParams, companyId };
    const res = await adminRequests.get('/users', { params });
    // Handle paginated response: { users, totalPages, ... }
    if (res.data && Array.isArray(res.data.users)) {
      dispatch(getUsersSuccess(res.data.users));
    } else if (Array.isArray(res.data)) {
      dispatch(getUsersSuccess(res.data));
    } else {
      dispatch(getUsersSuccess([]));
    }
    return res.data;
  } catch (err) {
    dispatch(getUsersFailure());
    throw err;
  }
};

// Get single user
export const getUser = (id) => async (dispatch) => {
  dispatch(getUserStart());
  try {
    const res = await adminRequests.get(`/users/${id}`);
    const payload = res?.data?.user || res?.data;
    dispatch(getUserSuccess(payload));
    return payload;
  } catch (err) {
    dispatch(getUserFailure());
    throw err;
  }
};

// Create new user
export const createUser = (userData) => async (dispatch) => {
  dispatch(createUserStart());
  try {
    const payload = transformUserData(userData);
    const res = await adminRequests.post('/users', payload);
    const payloadData = res?.data?.user || res?.data;
    dispatch(createUserSuccess(payloadData));
    return res?.data || payloadData;
  } catch (err) {
    dispatch(createUserFailure());
    throw err;
  }
};

// Update user
export const updateUser = (id, userData) => async (dispatch) => {
  dispatch(updateUserStart());
  try {
    if (userData.password === "") delete userData.password;
    const payload = transformUserData(userData);
    const res = await adminRequests.put(`/users/${id}`, payload);
    const payloadData = res?.data?.user || res?.data;
    dispatch(updateUserSuccess({ id, user: payloadData }));
    return payloadData;
  } catch (err) {
    dispatch(updateUserFailure());
    throw err;
  }
};

// Delete user
export const deleteUser = (id) => async (dispatch) => {
  dispatch(deleteUserStart());
  try {
    await adminRequests.delete(`/users/${id}`);
    dispatch(deleteUserSuccess(id));
  } catch (err) {
    dispatch(deleteUserFailure());
    throw err;
  }
};

// Toggle lock status
export const toggleUserLock = (id) => async (dispatch) => {
  dispatch(toggleUserLockStart());
  try {
    const res = await adminRequests.patch(`/users/${id}/toggle-lock`);
    dispatch(toggleUserLockSuccess({ id, locked: res.data.locked }));
    return res.data;
  } catch (err) {
    dispatch(toggleUserLockFailure());
    throw err;
  }
};


// ========== LANDLORDS SECTION ==========

// Get all landlords
export const getLandlords = (query = {}) => async (dispatch, getState) => {
  dispatch(getLandlordsStart());
  try {
    const params = new URLSearchParams();

    if (query.search) params.append('search', query.search);
    if (query.status) params.append('status', query.status);

    const companyId = resolveCompanyId(query, getState);
    if (companyId) {
      params.append('company', companyId);
    }

    const queryString = params.toString();
    const res = await adminRequests.get(`/landlords${queryString ? `?${queryString}` : ""}`);

    let landlords = [];
    if (Array.isArray(res.data)) {
      landlords = res.data;
    } else if (Array.isArray(res.data?.data)) {
      landlords = res.data.data;
    } else if (res.data?.success && !Array.isArray(res.data?.data)) {
      landlords = [];
    }

    dispatch(getLandlordsSuccess(landlords));
    return landlords;
  } catch (err) {
    dispatch(getLandlordsFailure());
    throw err;
  }
};

// Get single landlord
export const getLandlord = (id) => async (dispatch) => {
  dispatch(getLandlordsStart());
  try {
    const res = await adminRequests.get(`/landlords/${id}`);
    const landlord = res.data.data || res.data;
    dispatch(getLandlordsSuccess([landlord]));
    return landlord;
  } catch (err) {
    dispatch(getLandlordsFailure());
    throw err;
  }
};

// Create landlord
export const createLandlord = (landlordData) => async (dispatch) => {
  dispatch(createLandlordStart());
  try {
    const res = await adminRequests.post('/landlords', landlordData);
    const savedLandlord = res.data.data || res.data;
    dispatch(createLandlordSuccess(savedLandlord));
    return savedLandlord;
  } catch (err) {
    console.error('Create landlord error:', err);
    dispatch(createLandlordFailure());
    const message = err?.response?.data?.message || 'Failed to create landlord';
    throw new Error(message);
  }
};

// Update landlord
export const updateLandlord = (id, landlordData) => async (dispatch) => {
  dispatch(updateLandlordStart());
  try {
    const res = await adminRequests.put(`/landlords/${id}`, landlordData);
    const updatedLandlord = res.data.data || res.data;
    dispatch(updateLandlordSuccess(updatedLandlord));
    return updatedLandlord;
  } catch (err) {
    console.error('Update landlord error:', err);
    dispatch(updateLandlordFailure());
    throw err;
  }
};

// Delete landlord
export const deleteLandlord = (id) => async (dispatch) => {
  dispatch(deleteLandlordStart());
  try {
    await adminRequests.delete(`/landlords/${id}`);
    dispatch(deleteLandlordSuccess(id));
  } catch (err) {
    console.error('Delete landlord error:', err);
    dispatch(deleteLandlordFailure());
    throw err;
  }
};


//Printers section
// Getting all printers
export const getPrinters = async (dispatch, businessId) => {
  dispatch(getPrintersStart());
  try {
    const res = await adminRequests.get(`/printers?businessId=${businessId}`);
    dispatch(getPrintersSuccess(res.data));
  } catch (err) {
    dispatch(getPrintersFailure());
  }
};

// Creating a printer
export const createPrinter = async (printerData, dispatch) => {
  dispatch(createPrinterStart());
  try {
    const res = await adminRequests.post("/printers", printerData);
    dispatch(createPrinterSuccess(res.data));
  } catch (err) {
    dispatch(createPrinterFailure());
  }
};

// Deleting a printer
export const deletePrinter = async (id, dispatch) => {
  dispatch(deletePrinterStart());
  try {
    await adminRequests.delete(`/printers/${id}`);
    dispatch(deletePrinterSuccess(id));
  } catch (err) {
    dispatch(deletePrinterFailure());
  }
};




//deleting a product
export const deleteRequest = async (id,dispatch) => {
  dispatch(deleteRequestStart())
  try{
    await adminRequests.delete(`/requests/${id}`)
    dispatch(deleteRequestSuccess(id))
  }catch(err){
    dispatch(deleteRequestFailure())
  }
}




//creating a Request
export const createRequest = async (request, dispatch) => {
  dispatch(createRequestStart());
  try {
    const res = await adminRequests.post(`/requests`, request);
    dispatch(createRequestSuccess(res.data));
    return res.data;  
  } catch (err) {
    dispatch(createRequestFailure());
    throw err;  
  }
};


//getting all requests
export const getRequests = async (dispatch) => {
  dispatch(getRequestsStart())
  try{
    const res = await adminRequests.get("/requests/")
    dispatch(getRequestsSuccess(res.data))
  }catch(err){
    dispatch(getRequestsFailure())
  }
}

// Helper to transform wizard data to backend format
const transformCompanyData = (data) => {
  const transformed = { ...data };

  if (data.modules) {
    const moduleBooleans = {};
    for (const [key, value] of Object.entries(data.modules)) {
      moduleBooleans[key] = value.enabled || false;
    }
    transformed.modules = moduleBooleans;
  }

  return transformed;
};

// GET all companies (with pagination & search)
export const getCompanies = (queryParams = {}) => async (dispatch) => {
  dispatch(getCompaniesStart());
  try {
    const res = await adminRequests.get('/companies', { params: queryParams });
    const companies = Array.isArray(res.data?.companies)
      ? res.data.companies
      : Array.isArray(res.data)
        ? res.data
        : [];
    dispatch(getCompaniesSuccess(companies));
    return res.data;
  } catch (err) {
    dispatch(getCompaniesFailure());
    throw err;
  }
};

// GET single company by ID
export const getCompany = (id) => async (dispatch) => {
  dispatch(getCompanyStart());
  try {
    const res = await adminRequests.get(`/companies/${id}`);
    dispatch(getCompanySuccess(res.data?.company || res.data));
    return res.data;
  } catch (err) {
    dispatch(getCompanyFailure());
    throw err;
  }
};

// CREATE new company
export const createCompany = (companyData) => async (dispatch) => {
  dispatch(createCompanyStart());
  try {
    const payload = transformCompanyData(companyData);
    const res = await adminRequests.post('/companies', payload);
    dispatch(createCompanySuccess(res.data?.company || res.data));
    return res.data;
  } catch (err) {
    dispatch(createCompanyFailure());
    throw err;
  }
};

// UPDATE company by ID
export const updateCompany = (id, companyData) => async (dispatch) => {
  dispatch(updateCompanyStart());
  try {
    const payload = transformCompanyData(companyData);
    const res = await adminRequests.put(`/companies/${id}`, payload);
    dispatch(updateCompanySuccess({ id, company: res.data?.company || res.data }));
    return res.data;
  } catch (err) {
    dispatch(updateCompanyFailure());
    throw err;
  }
};

// DELETE company by ID
export const deleteCompany = (id) => async (dispatch) => {
  dispatch(deleteCompanyStart());
  try {
    await adminRequests.delete(`/companies/${id}`);
    dispatch(deleteCompanySuccess(id));
  } catch (err) {
    dispatch(deleteCompanyFailure());
    throw err;
  }
};





// Get all utilities
export const getUtilities = async (dispatch, business) => {
  dispatch(getUtilitiesStart());
  try {
    const res = await adminRequests.get(`/utilities?business=${business}`);
    dispatch(getUtilitiesSuccess(res.data));
  } catch (err) {
    dispatch(getUtilitiesFailure());
  }
};

// Get single utility
export const getUtility = async (dispatch, id) => {
  dispatch(getUtilitiesStart());
  try {
    const res = await adminRequests.get(`/utilities/${id}`);
    dispatch(getUtilitiesSuccess([res.data]));
  } catch (err) {
    dispatch(getUtilitiesFailure());
  }
};

// Create utility
export const createUtility = async (dispatch, utilityData) => {
  dispatch(createUtilityStart());
  try {
    const res = await adminRequests.post("/utilities", utilityData);
    dispatch(createUtilitySuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createUtilityFailure());
    throw err;
  }
};

// Update utility
export const updateUtility = async (dispatch, id, utilityData) => {
  dispatch(updateUtilityStart());
  try {
    const res = await adminRequests.put(`/utilities/${id}`, utilityData);
    dispatch(updateUtilitySuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateUtilityFailure());
    throw err;
  }
};

// Delete utility
export const deleteUtility = async (dispatch, id) => {
  dispatch(deleteUtilityStart());
  try {
    await adminRequests.delete(`/utilities/${id}`);
    dispatch(deleteUtilitySuccess(id));
    return true;
  } catch (err) {
    dispatch(deleteUtilityFailure());
    throw err;
  }
};


// Get all units
export const getUnits = async (dispatch, business, property = null, status = null) => {
  dispatch(getUnitsStart());
  try {
    let url = `/units?business=${business}`;
    if (property) url += `&property=${property}`;
    if (status) url += `&status=${status}`;
    
    const res = await adminRequests.get(url);
    dispatch(getUnitsSuccess(res.data));
  } catch (err) {
    dispatch(getUnitsFailure());
  }
};

// Get single unit
export const getUnit = async (dispatch, id) => {
  dispatch(getUnitsStart());
  try {
    const res = await adminRequests.get(`/units/${id}`);
    dispatch(getUnitsSuccess([res.data]));
  } catch (err) {
    dispatch(getUnitsFailure());
  }
};

// Create unit
export const createUnit = async (dispatch, unitData) => {
  dispatch(createUnitStart());
  try {
    const res = await adminRequests.post("/units", unitData);
    dispatch(createUnitSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createUnitFailure());
    throw err;
  }
};

// Update unit
export const updateUnit = async (dispatch, id, unitData) => {
  dispatch(updateUnitStart());
  try {
    const res = await adminRequests.put(`/units/${id}`, unitData);
    dispatch(updateUnitSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateUnitFailure());
    throw err;
  }
};

// Delete unit
export const deleteUnit = async (dispatch, id) => {
  dispatch(deleteUnitStart());
  try {
    await adminRequests.delete(`/units/${id}`);
    dispatch(deleteUnitSuccess(id));
    return true;
  } catch (err) {
    dispatch(deleteUnitFailure());
    throw err;
  }
};

// Update unit status
export const updateUnitStatus = async (dispatch, id, statusData) => {
  dispatch(updateUnitStatusStart());
  try {
    const res = await adminRequests.put(`/units/status/${id}`, statusData);
    dispatch(updateUnitStatusSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateUnitStatusFailure());
    throw err;
  }
};

// Get available units
export const getAvailableUnits = async (business, property = null) => {
  try {
    let url = `/units/find/available?business=${business}`;
    if (property) url += `&property=${property}`;
    
    const res = await adminRequests.get(url);
    return res.data;
  } catch (err) {
    throw err;
  }
};


// Get all tenants
export const getTenants = async (dispatch, business, status = null, unit = null) => {
  dispatch(getTenantsStart());
  try {
    let url = `/tenants?business=${business}`;
    if (status) url += `&status=${status}`;
    if (unit) url += `&unit=${unit}`;
    
    const res = await adminRequests.get(url);
    dispatch(getTenantsSuccess(res.data));
  } catch (err) {
    dispatch(getTenantsFailure());
  }
};

// Get single tenant
export const getTenant = async (dispatch, id) => {
  dispatch(getTenantsStart());
  try {
    const res = await adminRequests.get(`/tenants/${id}`);
    dispatch(getTenantsSuccess([res.data]));
  } catch (err) {
    dispatch(getTenantsFailure());
  }
};

// Create tenant
export const createTenant = async (dispatch, tenantData) => {
  dispatch(createTenantStart());
  try {
    const res = await adminRequests.post("/tenants", tenantData);
    dispatch(createTenantSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createTenantFailure());
    throw err;
  }
};

// Update tenant
export const updateTenant = async (dispatch, id, tenantData) => {
  dispatch(updateTenantStart());
  try {
    const res = await adminRequests.put(`/tenants/${id}`, tenantData);
    dispatch(updateTenantSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateTenantFailure());
    throw err;
  }
};

// Delete tenant
export const deleteTenant = async (dispatch, id) => {
  dispatch(deleteTenantStart());
  try {
    await adminRequests.delete(`/tenants/${id}`);
    dispatch(deleteTenantSuccess(id));
    return true;
  } catch (err) {
    dispatch(deleteTenantFailure());
    throw err;
  }
};

// Update tenant status
export const updateTenantStatus = async (dispatch, id, statusData) => {
  dispatch(updateTenantStatusStart());
  try {
    const res = await adminRequests.put(`/tenants/status/${id}`, statusData);
    dispatch(updateTenantStatusSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateTenantStatusFailure());
    throw err;
  }
};

// Get tenant payments
export const getTenantPayments = async (id) => {
  try {
    const res = await adminRequests.get(`/tenants/payments/${id}`);
    return res.data;
  } catch (err) {
    throw err;
  }
};

// Get tenant balance
export const getTenantBalance = async (id) => {
  try {
    const res = await adminRequests.get(`/tenants/balance/${id}`);
    return res.data;
  } catch (err) {
    throw err;
  }
};


// Get all rent payments
export const getRentPayments = async (dispatch, business, tenant = null, unit = null, month = null, year = null, paymentType = null) => {
  dispatch(getRentPaymentsStart());
  try {
    let url = `/rent-payments?business=${business}`;
    if (tenant) url += `&tenant=${tenant}`;
    if (unit) url += `&unit=${unit}`;
    if (month) url += `&month=${month}`;
    if (year) url += `&year=${year}`;
    if (paymentType) url += `&paymentType=${paymentType}`;
    
    const res = await adminRequests.get(url);
    dispatch(getRentPaymentsSuccess(extractList(res.data)));
  } catch (err) {
    dispatch(getRentPaymentsFailure());
  }
};

// Get single rent payment
export const getRentPayment = async (dispatch, id) => {
  dispatch(getRentPaymentsStart());
  try {
    const res = await adminRequests.get(`/rent-payments/${id}`);
    dispatch(getRentPaymentsSuccess([res.data]));
  } catch (err) {
    dispatch(getRentPaymentsFailure());
  }
};

// Create rent payment
export const createRentPayment = async (dispatch, paymentData) => {
  dispatch(createRentPaymentStart());
  try {
    const res = await adminRequests.post("/rent-payments", paymentData);
    dispatch(createRentPaymentSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createRentPaymentFailure());
    throw err;
  }
};

export const getReceiptAllocationOptions = async (id) => {
  const res = await adminRequests.get(`/rent-payments/${id}/allocation-options`);
  return res?.data?.data || res?.data || {};
};

export const updateReceiptAllocations = async (dispatch, id, payload = {}) => {
  dispatch(updateRentPaymentStart());
  try {
    const res = await adminRequests.put(`/rent-payments/${id}/allocations`, payload);
    const updated = res?.data?.data || res?.data;
    if (updated?._id) {
      dispatch(updateRentPaymentSuccess(updated));
    } else {
      dispatch(updateRentPaymentFailure());
    }
    return updated;
  } catch (err) {
    dispatch(updateRentPaymentFailure());
    throw err;
  }
};

// Update rent payment
export const updateRentPayment = async (dispatch, id, paymentData) => {
  dispatch(updateRentPaymentStart());
  try {
    const res = await adminRequests.put(`/rent-payments/${id}`, paymentData);
    dispatch(updateRentPaymentSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateRentPaymentFailure());
    throw err;
  }
};

// Delete rent payment
export const deleteRentPayment = async (dispatch, id) => {
  dispatch(deleteRentPaymentStart());
  try {
    await adminRequests.delete(`/rent-payments/${id}`);
    dispatch(deleteRentPaymentSuccess(id));
    return true;
  } catch (err) {
    dispatch(deleteRentPaymentFailure());
    throw err;
  }
};

// Confirm rent payment
export const confirmRentPayment = async (dispatch, id, confirmData) => {
  dispatch(confirmRentPaymentStart());
  try {
    const res = await adminRequests.put(`/rent-payments/confirm/${id}`, confirmData);
    dispatch(confirmRentPaymentSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(confirmRentPaymentFailure());
    throw err;
  }
};

// Unconfirm rent payment - allows unconfirming to enable deletion
export const unconfirmRentPayment = async (dispatch, id) => {
  dispatch(unconfirmRentPaymentStart());
  try {
    const res = await adminRequests.put(`/rent-payments/unconfirm/${id}`, {});
    dispatch(unconfirmRentPaymentSuccess(res.data.data || res.data));
    return res.data;
  } catch (err) {
    dispatch(unconfirmRentPaymentFailure());
    throw err;
  }
};

// Reverse rent payment (audit-safe; creates reversal entry instead of deleting)
export const reverseRentPayment = async (dispatch, id, reverseData = {}) => {
  dispatch(updateRentPaymentStart());
  try {
    const res = await adminRequests.put(`/rent-payments/reverse/${id}`, reverseData);
    const updatedOriginal = res?.data?.data?.original;
    if (updatedOriginal) {
      dispatch(updateRentPaymentSuccess(updatedOriginal));
    } else {
      dispatch(updateRentPaymentFailure());
    }
    return res.data;
  } catch (err) {
    dispatch(updateRentPaymentFailure());
    throw err;
  }
};

// Cancel reversal and restore receipt allocation effect
export const cancelReversalRentPayment = async (dispatch, id, cancelData = {}) => {
  dispatch(updateRentPaymentStart());
  try {
    const res = await adminRequests.put(`/rent-payments/reverse/cancel/${id}`, cancelData);
    const updatedOriginal = res?.data?.data?.original;
    if (updatedOriginal) {
      dispatch(updateRentPaymentSuccess(updatedOriginal));
    } else {
      dispatch(updateRentPaymentFailure());
    }
    return res.data;
  } catch (err) {
    dispatch(updateRentPaymentFailure());
    throw err;
  }
};

// Get payment summary
export const getPaymentSummary = async (business, month = null, year = null) => {
  try {
    let url = `/rent-payments/get/summary?business=${business}`;
    if (month) url += `&month=${month}`;
    if (year) url += `&year=${year}`;
    
    const res = await adminRequests.get(url);
    return res.data;
  } catch (err) {
    throw err;
  }
};


// ========== LANDLORD PAYMENTS SECTION ========== 
// Update payment voucher status
export const updatePaymentVoucherStatus = async (id, statusData = {}, context = {}) => {
  const payload = { ...(statusData || {}) };
  if (context.business) payload.business = context.business;
  if (context.company) payload.company = context.company;
  const res = await adminRequests.put(`/payment-vouchers/${id}/status`, payload);
  return res.data;
};

// Get all landlord payment vouchers for a company
export const getLandlordPayments = async (companyId) => {
  const params = new URLSearchParams();
  if (companyId) params.append("business", companyId);
  if (companyId) params.append("company", companyId);
  const query = params.toString();
  const res = await adminRequests.get(`/payment-vouchers${query ? `?${query}` : ""}`);
  return extractList(res.data);
};

export const getPaymentVouchers = async (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.category && filters.category !== "all") params.append("category", filters.category);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.propertyId && filters.propertyId !== "all") params.append("property", filters.propertyId);
  if (filters.landlordId && filters.landlordId !== "all") params.append("landlord", filters.landlordId);
  if (filters.search) params.append("search", filters.search);

  const query = params.toString();
  const res = await adminRequests.get(`/payment-vouchers${query ? `?${query}` : ""}`);
  return extractList(res.data);
};

// Create a landlord payment voucher
export const createLandlordPayment = async (paymentData) => {
  const res = await adminRequests.post("/payment-vouchers", paymentData);
  return res.data;
};

// Delete a landlord payment voucher
export const deletePaymentVoucher = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);

  const query = params.toString();
  const res = await adminRequests.delete(`/payment-vouchers/${id}${query ? `?${query}` : ""}`);
  return res.data;
};


// Get all maintenances
export const getMaintenances = async (dispatch, business, status = null, priority = null, unit = null, tenant = null) => {
  dispatch(getMaintenancesStart());
  try {
    let url = `/maintenances?business=${business}`;
    if (status) url += `&status=${status}`;
    if (priority) url += `&priority=${priority}`;
    if (unit) url += `&unit=${unit}`;
    if (tenant) url += `&tenant=${tenant}`;
    
    const res = await adminRequests.get(url);
    dispatch(getMaintenancesSuccess(extractList(res.data)));
  } catch (err) {
    dispatch(getMaintenancesFailure());
  }
};

// Get single maintenance
export const getMaintenance = async (dispatch, id) => {
  dispatch(getMaintenancesStart());
  try {
    const res = await adminRequests.get(`/maintenances/${id}`);
    dispatch(getMaintenancesSuccess([res.data]));
  } catch (err) {
    dispatch(getMaintenancesFailure());
  }
};

// Create maintenance
export const createMaintenance = async (dispatch, maintenanceData) => {
  dispatch(createMaintenanceStart());
  try {
    const res = await adminRequests.post("/maintenances", maintenanceData);
    dispatch(createMaintenanceSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createMaintenanceFailure());
    throw err;
  }
};

// Update maintenance
export const updateMaintenance = async (dispatch, id, maintenanceData) => {
  dispatch(updateMaintenanceStart());
  try {
    const res = await adminRequests.put(`/maintenances/${id}`, maintenanceData);
    dispatch(updateMaintenanceSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateMaintenanceFailure());
    throw err;
  }
};

// Delete maintenance
export const deleteMaintenance = async (dispatch, id) => {
  dispatch(deleteMaintenanceStart());
  try {
    await adminRequests.delete(`/maintenances/${id}`);
    dispatch(deleteMaintenanceSuccess(id));
    return true;
  } catch (err) {
    dispatch(deleteMaintenanceFailure());
    throw err;
  }
};

// Update maintenance status
export const updateMaintenanceStatus = async (dispatch, id, statusData) => {
  dispatch(updateMaintenanceStatusStart());
  try {
    const res = await adminRequests.put(`/maintenances/status/${id}`, statusData);
    dispatch(updateMaintenanceStatusSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateMaintenanceStatusFailure());
    throw err;
  }
};

// Get maintenance stats
export const getMaintenanceStats = async (business) => {
  try {
    const res = await adminRequests.get(`/maintenances/get/stats?business=${business}`);
    return res.data;
  } catch (err) {
    throw err;
  }
};


// Get all leases
export const getLeases = async (dispatch, business, status = null, tenant = null, unit = null) => {
  dispatch(getLeasesStart());
  try {
    let url = `/leases?business=${business}`;
    if (status) url += `&status=${status}`;
    if (tenant) url += `&tenant=${tenant}`;
    if (unit) url += `&unit=${unit}`;
    
    const res = await adminRequests.get(url);
    dispatch(getLeasesSuccess(extractList(res.data)));
    return res.data;
  } catch (err) {
    dispatch(getLeasesFailure());
    throw err; // Re-throw so caller can handle the error
  }
};

// Get single lease
export const getLease = async (dispatch, id) => {
  dispatch(getLeasesStart());
  try {
    const res = await adminRequests.get(`/leases/${id}`);
    dispatch(getLeasesSuccess([res.data]));
  } catch (err) {
    dispatch(getLeasesFailure());
  }
};

// Create lease
export const createLease = async (dispatch, leaseData) => {
  dispatch(createLeaseStart());
  try {
    const res = await adminRequests.post("/leases", leaseData);
    dispatch(createLeaseSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createLeaseFailure());
    throw err;
  }
};

// Update lease
export const updateLease = async (dispatch, id, leaseData) => {
  dispatch(updateLeaseStart());
  try {
    const res = await adminRequests.put(`/leases/${id}`, leaseData);
    dispatch(updateLeaseSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateLeaseFailure());
    throw err;
  }
};

// Delete lease
export const deleteLease = async (dispatch, id) => {
  dispatch(deleteLeaseStart());
  try {
    await adminRequests.delete(`/leases/${id}`);
    dispatch(deleteLeaseSuccess(id));
    return true;
  } catch (err) {
    dispatch(deleteLeaseFailure());
    throw err;
  }
};

// Sign lease
export const signLease = async (dispatch, id, signData) => {
  dispatch(signLeaseStart());
  try {
    const res = await adminRequests.put(`/leases/sign/${id}`, signData);
    dispatch(signLeaseSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(signLeaseFailure());
    throw err;
  }
};

// Get expiring leases
export const getExpiringLeases = async (business, days = 30) => {
  try {
    const res = await adminRequests.get(`/leases/find/expiring?business=${business}&days=${days}`);
    return res.data;
  } catch (err) {
    throw err;
  }
};

// Renew lease
export const renewLease = async (dispatch, id, renewData) => {
  dispatch(renewLeaseStart());
  try {
    const res = await adminRequests.put(`/leases/renew/${id}`, renewData);
    dispatch(renewLeaseSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(renewLeaseFailure());
    throw err;
  }
};


// Get all expense properties
export const getExpenseProperties = async (dispatch, business, category = null, property = null, unit = null, startDate = null, endDate = null) => {
  dispatch(getExpensePropertiesStart());
  try {
    let url = `/propertyexpenses?business=${business}`;
    if (category) url += `&category=${category}`;
    if (property) url += `&property=${property}`;
    if (unit) url += `&unit=${unit}`;
    if (startDate) url += `&startDate=${startDate}`;
    if (endDate) url += `&endDate=${endDate}`;
    
    const res = await adminRequests.get(url);
    dispatch(getExpensePropertiesSuccess(extractList(res.data)));
  } catch (err) {
    dispatch(getExpensePropertiesFailure());
  }
};

// Get single expense property
export const getExpenseProperty = async (dispatch, id) => {
  dispatch(getExpensePropertiesStart());
  try {
    const res = await adminRequests.get(`/propertyexpenses/${id}`);
    dispatch(getExpensePropertiesSuccess([res.data]));
  } catch (err) {
    dispatch(getExpensePropertiesFailure());
  }
};

// Create expense property
export const createExpenseProperty = async (dispatch, expenseData) => {
  dispatch(createExpensePropertyStart());
  try {
    const res = await adminRequests.post("/propertyexpenses", expenseData);
    dispatch(createExpensePropertySuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createExpensePropertyFailure());
    throw err;
  }
};

// Update expense property
export const updateExpenseProperty = async (dispatch, id, expenseData) => {
  dispatch(updateExpensePropertyStart());
  try {
    const res = await adminRequests.put(`/propertyexpenses/${id}`, expenseData);
    dispatch(updateExpensePropertySuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateExpensePropertyFailure());
    throw err;
  }
};

// Delete expense property
export const deleteExpenseProperty = async (dispatch, id) => {
  dispatch(deleteExpensePropertyStart());
  try {
    await adminRequests.delete(`/propertyexpenses/${id}`);
    dispatch(deleteExpensePropertySuccess(id));
    return true;
  } catch (err) {
    dispatch(deleteExpensePropertyFailure());
    throw err;
  }
};

// Get expense summary
export const getExpenseSummary = async (business, startDate = null, endDate = null) => {
  try {
    let url = `/propertyexpenses/get/summary?business=${business}`;
    if (startDate) url += `&startDate=${startDate}`;
    if (endDate) url += `&endDate=${endDate}`;
    
    const res = await adminRequests.get(url);
    return res.data;
  } catch (err) {
    throw err;
  }
};

// Get property expenses
export const getPropertyExpenses = async (propertyId, business = null, startDate = null, endDate = null) => {
  try {
    let url = `/propertyexpenses/property/${propertyId}`;
    const params = new URLSearchParams();

    if (business) params.append("business", business);
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);

    const query = params.toString();
    if (query) url += `?${query}`;

    const res = await adminRequests.get(url);
    return res.data;
  } catch (err) {
    throw err;
  }
};


// Get all notifications
export const getNotifications = async (dispatch, business, recipient = null, isRead = null, type = null) => {
  dispatch(getNotificationsStart());
  try {
    let url = `/notifications?business=${business}`;
    if (recipient) url += `&recipient=${recipient}`;
    if (isRead !== undefined) url += `&isRead=${isRead}`;
    if (type) url += `&type=${type}`;
    
    const res = await adminRequests.get(url);
    dispatch(getNotificationsSuccess(extractList(res.data)));
  } catch (err) {
    dispatch(getNotificationsFailure());
  }
};

// Get single notification
export const getNotification = async (dispatch, id) => {
  dispatch(getNotificationsStart());
  try {
    const res = await adminRequests.get(`/notifications/${id}`);
    dispatch(getNotificationsSuccess([res.data]));
  } catch (err) {
    dispatch(getNotificationsFailure());
  }
};

// Create notification
export const createNotification = async (dispatch, notificationData) => {
  dispatch(createNotificationStart());
  try {
    const res = await adminRequests.post("/notifications", notificationData);
    dispatch(createNotificationSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createNotificationFailure());
    throw err;
  }
};

// Update notification
export const updateNotification = async (dispatch, id, notificationData) => {
  dispatch(updateNotificationStart());
  try {
    const res = await adminRequests.put(`/notifications/${id}`, notificationData);
    dispatch(updateNotificationSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateNotificationFailure());
    throw err;
  }
};

// Delete notification
export const deleteNotification = async (dispatch, id) => {
  dispatch(deleteNotificationStart());
  try {
    await adminRequests.delete(`/notifications/${id}`);
    dispatch(deleteNotificationSuccess(id));
    return true;
  } catch (err) {
    dispatch(deleteNotificationFailure());
    throw err;
  }
};

// Mark notification as read
export const markNotificationAsRead = async (dispatch, id) => {
  dispatch(markNotificationAsReadStart());
  try {
    const res = await adminRequests.put(`/notifications/read/${id}`);
    dispatch(markNotificationAsReadSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(markNotificationAsReadFailure());
    throw err;
  }
};

// Mark all notifications as read
export const markAllNotificationsAsRead = async (dispatch, recipient) => {
  dispatch(markAllNotificationsAsReadStart());
  try {
    await adminRequests.put("/notifications/read-all", { recipient });
    dispatch(markAllNotificationsAsReadSuccess());
    return true;
  } catch (err) {
    dispatch(markAllNotificationsAsReadFailure());
    throw err;
  }
};

// ========== METER READINGS SECTION ==========

export const getMeterReadings = async (filters = {}) => {
  const params = new URLSearchParams();

  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.property && filters.property !== "all") params.append("property", filters.property);
  if (filters.unit && filters.unit !== "all") params.append("unit", filters.unit);
  if (filters.tenant && filters.tenant !== "all") params.append("tenant", filters.tenant);
  if (filters.utility && filters.utility !== "all") params.append("utility", filters.utility);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.periodMonth) params.append("periodMonth", filters.periodMonth);
  if (filters.periodYear) params.append("periodYear", filters.periodYear);
  if (filters.search) params.append("search", filters.search);

  const query = params.toString();
  const res = await adminRequests.get(`/meter-readings${query ? `?${query}` : ""}`);
  return extractList(res.data);
};

export const createMeterReading = async (payload) => {
  const res = await adminRequests.post("/meter-readings", payload);
  return res.data;
};

export const updateMeterReading = async (id, payload) => {
  const res = await adminRequests.put(`/meter-readings/${id}`, payload);
  return res.data;
};

export const deleteMeterReading = async (id) => {
  const res = await adminRequests.delete(`/meter-readings/${id}`);
  return res.data;
};

export const voidMeterReading = async (id, payload = {}) => {
  const res = await adminRequests.patch(`/meter-readings/${id}/void`, payload);
  return res.data;
};

export const billMeterReading = async (id, payload = {}) => {
  const res = await adminRequests.post(`/meter-readings/${id}/bill`, payload);
  return res.data;
};

// ========== LATE PENALTIES SECTION ==========

export const getLatePenaltyPostingAccounts = async (business) => {
  const params = new URLSearchParams();
  if (business) params.append("business", business);
  const query = params.toString();
  const res = await adminRequests.get(`/late-penalties/posting-accounts${query ? `?${query}` : ""}`);
  const rows = extractList(res.data);
  return {
    accounts: rows.length ? rows : Array.isArray(res.data?.accounts) ? res.data.accounts : [],
  };
};

export const getLatePenaltyRules = async (business) => {
  const params = new URLSearchParams();
  if (business) params.append("business", business);
  const res = await adminRequests.get(`/late-penalties/rules${params.toString() ? `?${params.toString()}` : ""}`);
  return res.data;
};

export const createLatePenaltyRule = async (payload) => {
  const res = await adminRequests.post("/late-penalties/rules", payload);
  return res.data;
};

export const updateLatePenaltyRule = async (id, payload) => {
  const res = await adminRequests.put(`/late-penalties/rules/${id}`, payload);
  return res.data;
};

export const previewLatePenalties = async (payload) => {
  const res = await adminRequests.post("/late-penalties/preview", payload);
  return res.data;
};

export const processLatePenalties = async (payload) => {
  const res = await adminRequests.post("/late-penalties/process", payload);
  return res.data;
};

export const getLatePenaltyBatches = async (business) => {
  const params = new URLSearchParams();
  if (business) params.append("business", business);
  const res = await adminRequests.get(`/late-penalties/batches${params.toString() ? `?${params.toString()}` : ""}`);
  return res.data;
};

export const getLatePenaltyBatch = async (id, business = null) => {
  const params = new URLSearchParams();
  if (business) params.append("business", business);
  const query = params.toString();
  const res = await adminRequests.get(`/late-penalties/batches/${id}${query ? `?${query}` : ""}`);
  return res.data;
};

// ========== STATEMENT API CALLS (Immutable Ledger-based Statements) ==========

// Get statements with filters
export const getStatements = (filters = {}) => async (dispatch) => {
  dispatch(getStatementsStart());
  try {
    if (!filters.landlordId && !filters.propertyId) {
      dispatch(getStatementsSuccess([]));
      return [];
    }

    const queryParams = new URLSearchParams();
    if (filters.landlordId) queryParams.append('landlordId', filters.landlordId);
    if (filters.propertyId) queryParams.append('propertyId', filters.propertyId);
    if (filters.status) queryParams.append('status', filters.status);
    if (filters.periodStart) queryParams.append('periodStart', filters.periodStart);
    if (filters.periodEnd) queryParams.append('periodEnd', filters.periodEnd);
    
    const res = await adminRequests.get(`/statements?${queryParams.toString()}`);
    const statements = res.data?.data?.statements || [];
    dispatch(getStatementsSuccess(statements));
    return statements;
  } catch (err) {
    dispatch(getStatementsFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Get single statement with lines
export const getStatement = (statementId) => async (dispatch) => {
  dispatch(getStatementStart());
  try {
    const res = await adminRequests.get(`/statements/${statementId}?populateRefs=true&includeLines=true`);
    const payload = {
      statement: res.data?.data?.statement || null,
      lines: res.data?.data?.lines || [],
    };
    dispatch(getStatementSuccess(payload));
    return payload;
  } catch (err) {
    dispatch(getStatementFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Create draft statement
export const createDraftStatement = (payload) => async (dispatch, getState) => {
  dispatch(createDraftStart());
  try {
    const resolvedPayload = {
      ...payload,
      businessId: payload?.businessId || resolveCompanyId(payload, getState),
      landlordId: payload?.landlordId || resolveLandlordIdFromProperty(payload?.propertyId, getState),
    };

    const res = await adminRequests.post("/statements/draft", resolvedPayload);
    const statement = res.data?.data?.statement;
    dispatch(createDraftSuccess(statement));
    return statement;
  } catch (err) {
    dispatch(createDraftFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Approve statement (makes it immutable)
export const approveStatement = (statementId, approvalNotes = '') => async (dispatch) => {
  dispatch(approveStart());
  try {
    const res = await adminRequests.post(`/statements/${statementId}/approve`, { approvalNotes });
    const statement = res.data?.data?.statement;
    dispatch(approveSuccess(statement));
    return statement;
  } catch (err) {
    dispatch(approveFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Send statement (mark as sent)
export const sendStatement = (statementId) => async (dispatch) => {
  dispatch(sendStart());
  try {
    const res = await adminRequests.post(`/statements/${statementId}/send`);
    const statement = res.data?.data?.statement;
    dispatch(sendSuccess(statement));
    return statement;
  } catch (err) {
    dispatch(sendFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Create revision of existing statement
export const createStatementRevision = (statementId, revisionReason) => async (dispatch) => {
  dispatch(createRevisionStart());
  try {
    const res = await adminRequests.post(`/statements/${statementId}/revise`, { revisionReason });
    const payload = {
      newStatement: res.data?.data?.newStatement,
      originalStatement: res.data?.data?.originalStatement,
    };
    dispatch(createRevisionSuccess(payload));
    return payload;
  } catch (err) {
    dispatch(createRevisionFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Delete draft statement
export const deleteDraftStatement = (statementId) => async (dispatch) => {
  dispatch(deleteDraftStart());
  try {
    await adminRequests.delete(`/statements/${statementId}`);
    dispatch(deleteDraftSuccess(statementId));
    return true;
  } catch (err) {
    dispatch(deleteDraftFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Validate statement audit
export const validateStatementAudit = (statementId) => async (dispatch) => {
  dispatch(validateAuditStart());
  try {
    const res = await adminRequests.get(`/statements/${statementId}/validate`);
    const auditData = res.data?.data || {};
    dispatch(validateAuditSuccess(auditData));
    return auditData;
  } catch (err) {
    dispatch(validateAuditFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Download statement PDF
export const downloadStatementPdf = async (statementId) => {
  try {
    const res = await adminRequests.get(`/statements/${statementId}/pdf`, {
      responseType: 'blob'
    });
    
    // Create blob URL and trigger download
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `statement-${statementId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    
    return true;
  } catch (err) {
    throw err;
  }
};

// Get notification stats
export const getNotificationStats = async (recipient) => {
  try {
    const res = await adminRequests.get(`/notifications/get/stats?recipient=${recipient}`);
    return res.data;
  } catch (err) {
    throw err;
  }
};

export const getDashboardSummary = async (business) => {
  try {
    const res = await adminRequests.get(`/dashboard/summary?business=${business}`);
    return res.data;
  } catch (err) {
    throw err;
  }
};

export const getUnitUtilities = async (unitId) => {
  try {
    const res = await adminRequests.get(`/units/${unitId}/utilities`);
    return res.data;
  } catch (err) {
    throw err;
  }
};

export const addUtilityToUnit = async (dispatch, unitId, utilityData) => {
  dispatch(addUtilityToUnitStart());
  try {
    const res = await adminRequests.post(`/units/${unitId}/utilities`, utilityData);
    dispatch(addUtilityToUnitSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(addUtilityToUnitFailure());
    throw err;
  }
};

export const removeUtilityFromUnit = async (dispatch, unitId, utilityId) => {
  dispatch(removeUtilityFromUnitStart());
  try {
    await adminRequests.delete(`/units/${unitId}/utilities/${utilityId}`);
    dispatch(removeUtilityFromUnitSuccess(utilityId));
    return true;
  } catch (err) {
    dispatch(removeUtilityFromUnitFailure());
    throw err;
  }
};

export const getTenantTotalDue = async (tenantId) => {
  try {
    const res = await adminRequests.get(`/tenants/${tenantId}/total-due`);
    return res.data;
  } catch (err) {
    throw err;
  }
};

// ========== AUTH API CALLS ==========

export const loginUser = (email, password) => async (dispatch) => {
  dispatch(loginStart());
  try {
    const res = await adminRequests.post('/auth/login', {
      email,
      password
    });

    const { user, token } = res.data;

    invalidateAccessibleCompaniesCache();
    dispatch(clearCompanyState());
    await resetPersistedWorkspaceCache();
    localStorage.removeItem('milik_demo_mode');
    localStorage.removeItem('milik_demo_company_id');

    dispatch(loginSuccess({ user, token }));

    if (user && user.company?._id) {
      dispatch(setCurrentCompany(user.company));
      dispatch(getCompanySuccess(user.company));
      localStorage.setItem('milik_active_company_id', user.company._id);
    } else if (!user?.isDemoUser) {
      localStorage.removeItem('milik_active_company_id');
    }

    return { user, token };
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

// Get tenant invoices
export const getTenantInvoices = async ({ tenantId = null, business = null, status = null, category = null } = {}) => {
  const params = new URLSearchParams();

  if (tenantId) params.append("tenant", tenantId);
  if (business) params.append("business", business);
  if (status) params.append("status", status);
  if (category) params.append("category", category);

  const query = params.toString();
  const res = await adminRequests.get(`/tenant-invoices${query ? `?${query}` : ""}`);
  return extractList(res.data);
};

// Get chart of accounts
export const getChartOfAccounts = async (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/chart-of-accounts${query ? `?${query}` : ""}`);
  return extractList(res.data);
};

// Create tenant invoice
export const getCreditableTenantInvoices = async ({ business = null, tenantId = null } = {}) => {
  const params = new URLSearchParams();
  if (business) params.append("business", business);
  if (tenantId) params.append("tenant", tenantId);
  const query = params.toString();
  const res = await adminRequests.get(`/tenant-invoices/creditable${query ? `?${query}` : ""}`);
  return extractList(res.data);
};

export const getTenantInvoiceNotes = async ({ tenantId = null, business = null } = {}) => {
  const params = new URLSearchParams();
  if (tenantId) params.append("tenant", tenantId);
  if (business) params.append("business", business);
  const query = params.toString();
  const res = await adminRequests.get(`/tenant-invoices/notes${query ? `?${query}` : ""}`);
  return extractList(res.data);
};

export const getTenantInvoiceNoteChargeTypes = async () => {
  const res = await adminRequests.get("/tenant-invoices/note-charge-types");
  return extractList(res.data?.chargeTypes || res.data);
};

export const createTenantInvoiceNote = async (noteData) => {
  const res = await adminRequests.post("/tenant-invoices/notes", noteData);
  return res.data;
};

export const createTenantInvoice = async (invoiceData) => {
  const res = await adminRequests.post("/tenant-invoices", invoiceData);
  return res.data;
};

export const createTenantInvoicesBatch = async ({ business = null, items = [] } = {}) => {
  const res = await adminRequests.post("/tenant-invoices/batch", { business, items });
  return res.data;
};

// Cancel tenant invoice
export const cancelTenantInvoice = async (invoiceId) => {
  const res = await adminRequests.delete(`/tenant-invoices/${invoiceId}`);
  return res.data;
};


// Delete tenant invoice
export const deleteTenantInvoice = async (invoiceId) => {
  const res = await adminRequests.delete(`/tenant-invoices/${invoiceId}`);
  return res.data;
};

// ========== JOURNAL ENTRIES SECTION ==========

export const getJournalEntries = async (filters = {}) => {
  const params = new URLSearchParams();

  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.journalType && filters.journalType !== "all") params.append("journalType", filters.journalType);
  if (filters.propertyId && filters.propertyId !== "all") params.append("property", filters.propertyId);
  if (filters.landlordId && filters.landlordId !== "all") params.append("landlord", filters.landlordId);
  if (filters.search) params.append("search", filters.search);

  const query = params.toString();
  const res = await adminRequests.get(`/journals${query ? `?${query}` : ""}`);
  return extractList(res.data);
};

export const createJournalEntry = async (journalData) => {
  const res = await adminRequests.post("/journals", journalData);
  return res.data;
};

export const updateJournalEntry = async (id, journalData) => {
  const res = await adminRequests.put(`/journals/${id}`, journalData);
  return res.data;
};

export const postJournalEntry = async (id, payload = {}) => {
  const res = await adminRequests.post(`/journals/${id}/post`, payload);
  return res.data;
};

export const reverseJournalEntry = async (id, payload = {}) => {
  const res = await adminRequests.post(`/journals/${id}/reverse`, payload);
  return res.data;
};

export const deleteJournalEntry = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);

  const query = params.toString();
  const res = await adminRequests.delete(`/journals/${id}${query ? `?${query}` : ""}`);
  return res.data;
};

// Financial Reports
export const getTrialBalanceReport = async (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/trial-balance${query ? `?${query}` : ""}`);
  return res.data;
};

export const getIncomeStatementReport = async (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/income-statement${query ? `?${query}` : ""}`);
  return res.data;
};

export const getBalanceSheetReport = async (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/balance-sheet${query ? `?${query}` : ""}`);
  return res.data;
};
// Communications
export const getCommunicationTemplates = async ({ business, contextType }) => {
  const params = new URLSearchParams();
  if (business) params.append('business', business);
  if (contextType) params.append('contextType', contextType);
  const query = params.toString();
  const res = await adminRequests.get(`/communications/templates${query ? `?${query}` : ''}`);
  return res.data;
};

export const previewCommunicationMessage = async (payload) => {
  const res = await adminRequests.post('/communications/preview', payload);
  return res.data;
};

export const sendCommunicationMessage = async (payload) => {
  const res = await adminRequests.post('/communications/send', payload);
  return res.data;
};


export const listMpesaCollections = async ({ business, status = "", source = "", shortCode = "", search = "" } = {}) => {
  const params = {};
  if (business) params.business = business;
  if (status) params.status = status;
  if (source) params.source = source;
  if (shortCode) params.shortCode = shortCode;
  if (search) params.search = search;
  const res = await adminRequests.get("/mpesa-collections", { params });
  return res?.data?.data || [];
};

export const importMpesaBatch = async ({ business, rawText, shortCode = "" } = {}) => {
  const res = await adminRequests.post("/mpesa-collections/import-batch", { business, rawText, shortCode });
  return res?.data?.data || res?.data || {};
};


export const listExpenseRequisitions = async (params = {}) => {
  const res = await adminRequests.get("/expense-requisitions", { params });
  return res?.data?.data || [];
};

export const createExpenseRequisition = async (payload = {}) => {
  const res = await adminRequests.post("/expense-requisitions", payload);
  return res?.data?.data || res?.data || {};
};

export const updateExpenseRequisition = async (id, payload = {}) => {
  const res = await adminRequests.put(`/expense-requisitions/${id}`, payload);
  return res?.data?.data || res?.data || {};
};

export const deleteExpenseRequisition = async (id, params = {}) => {
  const res = await adminRequests.delete(`/expense-requisitions/${id}`, { params });
  return res?.data || {};
};

export const listLandlordStandingOrders = async (params = {}) => {
  const res = await adminRequests.get("/landlord-standing-orders", { params });
  return res?.data?.data || [];
};

export const createLandlordStandingOrder = async (payload = {}) => {
  const res = await adminRequests.post("/landlord-standing-orders", payload);
  return res?.data?.data || res?.data || {};
};

export const updateLandlordStandingOrder = async (id, payload = {}) => {
  const res = await adminRequests.put(`/landlord-standing-orders/${id}`, payload);
  return res?.data?.data || res?.data || {};
};

export const deleteLandlordStandingOrder = async (id, params = {}) => {
  const res = await adminRequests.delete(`/landlord-standing-orders/${id}`, { params });
  return res?.data || {};
};

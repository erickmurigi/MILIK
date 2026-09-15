import { adminRequests } from "../../utils/requestMethods";

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
} from "../companiesRedux";

// Helper to transform wizard data to backend format
const transformCompanyData = (data) => {
  const transformed = { ...data };

  if (data.modules) {
    const moduleBooleans = {};
    for (const [key, value] of Object.entries(data.modules)) {
      moduleBooleans[key] = typeof value === "boolean" ? value : Boolean(value?.enabled);
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
    const res = await adminRequests.delete(`/companies/${id}`);
    if (res.data?.archived) {
      // Company has active data — backend archived it instead of deleting
      dispatch(updateCompanySuccess({ id, company: res.data.company }));
    } else {
      dispatch(deleteCompanySuccess(id));
    }
    return res.data;
  } catch (err) {
    dispatch(deleteCompanyFailure());
    throw err;
  }
};

// TOGGLE company lock
export const toggleCompanyLock = (id) => async (dispatch) => {
  try {
    const res = await adminRequests.patch(`/companies/${id}/toggle-lock`);
    // Use updateCompanySuccess so all restored fields (isActive, accountStatus) propagate
    dispatch(updateCompanySuccess({ id, company: res.data }));
    return res.data;
  } catch (err) {
    throw err;
  }
};

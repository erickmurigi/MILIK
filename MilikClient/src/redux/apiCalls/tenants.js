import { adminRequests } from "../../utils/requestMethods";

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
} from "../tenantsRedux";

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

export const getTenantTotalDue = async (tenantId) => {
  try {
    const res = await adminRequests.get(`/tenants/${tenantId}/total-due`);
    return res.data;
  } catch (err) {
    throw err;
  }
};

export const getTenantStatementBundle = async (tenantId) => {
  const res = await adminRequests.get(`/tenants/${tenantId}/statement-bundle`);
  return res.data;
};

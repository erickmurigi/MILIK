import { adminRequests } from "../utils/requestMethods";

const extractApiError = (err) => {
  const message =
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    "Petty cash request failed";
  const clean = new Error(message);
  clean.statusCode = err?.response?.status || 500;
  return clean;
};

const buildParams = (obj = {}) => {
  const params = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") params.append(k, v);
  });
  return params.toString();
};

// ─── Accounts ────────────────────────────────────────────────────────────────

export const getPettyCashAccounts = async (params = {}) => {
  try {
    const qs = buildParams(params);
    const res = await adminRequests.get(`/petty-cash/accounts${qs ? `?${qs}` : ""}`);
    return Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    throw extractApiError(err);
  }
};

export const createPettyCashAccount = async (payload = {}) => {
  try {
    const res = await adminRequests.post("/petty-cash/accounts", payload);
    return res.data?.data || res.data;
  } catch (err) {
    throw extractApiError(err);
  }
};

export const updatePettyCashAccount = async (id, payload = {}) => {
  try {
    const res = await adminRequests.put(`/petty-cash/accounts/${id}`, payload);
    return res.data?.data || res.data;
  } catch (err) {
    throw extractApiError(err);
  }
};

// ─── Disbursements ────────────────────────────────────────────────────────────

export const getPettyCashDisbursements = async (params = {}) => {
  try {
    const qs = buildParams(params);
    const res = await adminRequests.get(`/petty-cash/disbursements${qs ? `?${qs}` : ""}`);
    const d = res.data;
    if (d?.total !== undefined) return { data: Array.isArray(d.data) ? d.data : [], total: d.total, page: d.page ?? 1, pages: d.pages ?? 1 };
    return { data: Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [], total: 0, page: 1, pages: 1 };
  } catch (err) {
    throw extractApiError(err);
  }
};

export const createPettyCashDisbursement = async (payload = {}) => {
  try {
    const res = await adminRequests.post("/petty-cash/disbursements", payload);
    return res.data;
  } catch (err) {
    throw extractApiError(err);
  }
};

export const voidPettyCashDisbursement = async (id, payload = {}) => {
  try {
    const res = await adminRequests.put(`/petty-cash/disbursements/${id}/void`, payload);
    return res.data;
  } catch (err) {
    throw extractApiError(err);
  }
};

// ─── Replenishments ───────────────────────────────────────────────────────────

export const getPettyCashReplenishments = async (params = {}) => {
  try {
    const qs = buildParams(params);
    const res = await adminRequests.get(`/petty-cash/replenishments${qs ? `?${qs}` : ""}`);
    const d = res.data;
    if (d?.total !== undefined) return { data: Array.isArray(d.data) ? d.data : [], total: d.total, page: d.page ?? 1, pages: d.pages ?? 1 };
    return { data: Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [], total: 0, page: 1, pages: 1 };
  } catch (err) {
    throw extractApiError(err);
  }
};

export const requestPettyCashReplenishment = async (payload = {}) => {
  try {
    const res = await adminRequests.post("/petty-cash/replenishments", payload);
    return res.data;
  } catch (err) {
    throw extractApiError(err);
  }
};

export const approvePettyCashReplenishment = async (id, payload = {}) => {
  try {
    const res = await adminRequests.put(`/petty-cash/replenishments/${id}/approve`, payload);
    return res.data;
  } catch (err) {
    throw extractApiError(err);
  }
};

export const postPettyCashReplenishment = async (id, payload = {}) => {
  try {
    const res = await adminRequests.put(`/petty-cash/replenishments/${id}/post`, payload);
    return res.data;
  } catch (err) {
    throw extractApiError(err);
  }
};

export const rejectPettyCashReplenishment = async (id, payload = {}) => {
  try {
    const res = await adminRequests.put(`/petty-cash/replenishments/${id}/reject`, payload);
    return res.data;
  } catch (err) {
    throw extractApiError(err);
  }
};

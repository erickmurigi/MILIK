import { adminRequests } from "../../utils/requestMethods";

// ─── ACCOUNTING PERIODS ───────────────────────────────────────────────────────
export const getAccountingPeriods = async (params = {}) => {
  const res = await adminRequests.get("/accounting-periods", { params });
  return res.data;
};

export const createAccountingPeriod = async (payload = {}) => {
  const res = await adminRequests.post("/accounting-periods", payload);
  return res.data;
};

export const updateAccountingPeriod = async (id, payload = {}) => {
  const res = await adminRequests.put(`/accounting-periods/${id}`, payload);
  return res.data;
};

export const closeAccountingPeriod = async (id) => {
  const res = await adminRequests.post(`/accounting-periods/${id}/close`);
  return res.data;
};

export const reopenAccountingPeriod = async (id) => {
  const res = await adminRequests.post(`/accounting-periods/${id}/reopen`);
  return res.data;
};

export const lockAccountingPeriod = async (id) => {
  const res = await adminRequests.post(`/accounting-periods/${id}/lock`);
  return res.data;
};

export const getAccountingPeriodStats = async (id) => {
  const res = await adminRequests.get(`/accounting-periods/${id}/stats`);
  return res.data;
};

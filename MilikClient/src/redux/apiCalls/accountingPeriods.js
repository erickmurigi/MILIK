import { adminRequests } from "../../utils/requestMethods";

// ─── ACCOUNTING PERIODS ───────────────────────────────────────────────────────
// { fiscalYears: [{ key, label, periods: [...] }], gaps, suggestions, currentFiscalYear }
export const getAccountingPeriods = async (params = {}) => {
  const res = await adminRequests.get("/accounting-periods", { params });
  return res.data;
};

export const createAccountingPeriod = async (payload = {}) => {
  const res = await adminRequests.post("/accounting-periods", payload);
  return res.data;
};

export const generateAccountingYear = async (fiscalYearStart) => {
  const res = await adminRequests.post("/accounting-periods/generate-year", { fiscalYearStart });
  return res.data;
};

export const updateAccountingPeriod = async (id, payload = {}) => {
  const res = await adminRequests.put(`/accounting-periods/${id}`, payload);
  return res.data;
};

export const deleteAccountingPeriod = async (id) => {
  const res = await adminRequests.delete(`/accounting-periods/${id}`);
  return res.data;
};

export const getAccountingPeriodChecklist = async (id) => {
  const res = await adminRequests.get(`/accounting-periods/${id}/checklist`);
  return res.data;
};

export const closeAccountingPeriod = async (id) => {
  const res = await adminRequests.post(`/accounting-periods/${id}/close`);
  return res.data;
};

export const reopenAccountingPeriod = async (id, reason = "") => {
  const res = await adminRequests.post(`/accounting-periods/${id}/reopen`, { reason });
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

export const getYearCloseChecklist = async (fiscalYearStart) => {
  const res = await adminRequests.get("/accounting-periods/year-close/checklist", { params: { fiscalYearStart } });
  return res.data;
};

export const closeAccountingYear = async (fiscalYearStart) => {
  const res = await adminRequests.post("/accounting-periods/year-close", { fiscalYearStart });
  return res.data;
};

// A closed period: lets the signed-in user post into it for `minutes` without reopening it.
export const openPostingWindow = async (id, { minutes, reason }) => {
  const res = await adminRequests.post(`/accounting-periods/${id}/reopen-window`, { minutes, reason });
  return res.data;
};

export const endPostingWindow = async (id) => {
  const res = await adminRequests.delete(`/accounting-periods/${id}/reopen-window`);
  return res.data;
};

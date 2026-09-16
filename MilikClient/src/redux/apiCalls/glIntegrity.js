import { adminRequests } from "../../utils/requestMethods";

// ─── GL INTEGRITY & HEALTH CENTRE ────────────────────────────────────────────
export const runGLIntegrityReport = async (params = {}) => {
  const res = await adminRequests.get("/ledger/diagnostics/integrity-report", { params });
  return res.data;
};
export const getGLHealthHistory = async (params = {}) => {
  const res = await adminRequests.get("/ledger/health-history", { params });
  return res.data;
};
export const repairBalanceGroup = async (groupId, data) => {
  const res = await adminRequests.post(`/ledger/repair/balance-group/${groupId}`, data);
  return res.data;
};
export const repairClearAbnormalBalance = async (data) => {
  const res = await adminRequests.post("/ledger/repair/clear-abnormal-balance", data);
  return res.data;
};
export const reverseGlCorrectionEntry = async (groupId, data) => {
  const res = await adminRequests.post(`/ledger/repair/reverse-correction/${groupId}`, data);
  return res.data;
};
export const apiVoidReversedCorrections = async (data) => {
  const res = await adminRequests.post("/ledger/repair/void-reversed-corrections", data);
  return res.data;
};
export const apiVoidOrphanedJournalGroup = async (groupId, data) => {
  const res = await adminRequests.post(`/ledger/repair/void-orphaned-group/${groupId}`, data);
  return res.data;
};
export const getActiveGlCorrections = async (params) => {
  const res = await adminRequests.get("/ledger/repair/active-corrections", { params });
  return res.data;
};
export const getGlGroupEntries = async (groupId, params) => {
  const res = await adminRequests.get(`/ledger/repair/group-entries/${groupId}`, { params });
  return res.data;
};
export const repairRecomputeBalances = async (data) => {
  const res = await adminRequests.post("/ledger/repair/recompute-balances", data);
  return res.data;
};
export const repairRepostInvoices = async (data) => {
  const res = await adminRequests.post("/ledger/repair/repost-invoices", data);
  return res.data;
};

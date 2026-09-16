import { adminRequests } from "../../utils/requestMethods";
import { buildQuery } from "./shared";

// ─── Bank Reconciliation ──────────────────────────────────────────────────────
export const getBankReconciliationAccounts = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/bank-reconciliation/accounts${q ? `?${q}` : ""}`);
  return res.data;
};
export const getReconciliationEntries = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/bank-reconciliation/entries${q ? `?${q}` : ""}`);
  return res.data;
};
export const getReconciliations = async (params = {}) => {
  if (params.id) {
    const res = await adminRequests.get(`/bank-reconciliation/${params.id}`);
    return res.data;
  }
  const q = buildQuery(params);
  const res = await adminRequests.get(`/bank-reconciliation${q ? `?${q}` : ""}`);
  return res.data;
};
export const createReconciliation = async (data) => {
  const res = await adminRequests.post("/bank-reconciliation", data);
  return res.data;
};
export const saveReconciliation = async (id, data) => {
  const res = await adminRequests.put(`/bank-reconciliation/${id}`, data);
  return res.data;
};
export const finalizeReconciliation = async (id, data) => {
  const res = await adminRequests.post(`/bank-reconciliation/${id}/finalize`, data);
  return res.data;
};
export const deleteReconciliation = async (id, params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.delete(`/bank-reconciliation/${id}${q ? `?${q}` : ""}`);
  return res.data;
};

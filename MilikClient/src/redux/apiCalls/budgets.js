import { adminRequests } from "../../utils/requestMethods";
import { buildQuery } from "./shared";

// ─── Budgets ──────────────────────────────────────────────────────────────────
export const getBudgets = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/budgets${q ? `?${q}` : ""}`);
  return res.data;
};
export const getBudget = async (id, params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/budgets/${id}${q ? `?${q}` : ""}`);
  return res.data;
};
export const createBudget = async (data) => {
  const res = await adminRequests.post("/budgets", data);
  return res.data;
};
export const updateBudget = async (id, data) => {
  const res = await adminRequests.put(`/budgets/${id}`, data);
  return res.data;
};
export const deleteBudget = async (id, params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.delete(`/budgets/${id}${q ? `?${q}` : ""}`);
  return res.data;
};

import { adminRequests } from "../../utils/requestMethods";
import { extractList, buildQuery } from "./shared";

// ─── Creditor Ledger ──────────────────────────────────────────────────────────
export const getCreditorsSummary = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/service-providers/creditors/summary${q ? `?${q}` : ""}`);
  return extractList(res.data);
};
export const getCreditorStatement = async (id, params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/service-providers/creditors/${id}/statement${q ? `?${q}` : ""}`);
  return res.data;
};

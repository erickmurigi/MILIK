import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

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

export const deleteLatePenaltyBatch = async (id, business = null) => {
  const params = new URLSearchParams();
  if (business) params.append("business", business);
  const query = params.toString();
  const res = await adminRequests.delete(`/late-penalties/batches/${id}${query ? `?${query}` : ""}`);
  return res.data;
};

export const reverseLatePenalty = async (payload = {}) => {
  const res = await adminRequests.post("/late-penalties/reverse", payload);
  return res.data;
};

export const deleteLatePenalty = async (id, payload = {}) => {
  const params = new URLSearchParams();
  if (payload?.business) params.append("business", payload.business);
  const query = params.toString();
  const res = await adminRequests.delete(`/late-penalties/${id}${query ? `?${query}` : ""}`, { data: payload });
  return res.data;
};

export const deleteLatePenaltiesBatch = async (payload = {}) => {
  const res = await adminRequests.post("/late-penalties/delete-batch", payload);
  return res.data;
};

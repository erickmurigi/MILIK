import { adminRequests } from "../../utils/requestMethods";
import { buildQuery } from "./shared";

// ─── Fixed Assets ─────────────────────────────────────────────────────────────
export const getFixedAssets = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/fixed-assets${q ? `?${q}` : ""}`);
  return res.data;
};
export const getFixedAsset = async (id, params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/fixed-assets/${id}${q ? `?${q}` : ""}`);
  return res.data;
};
export const createFixedAsset = async (data) => {
  const res = await adminRequests.post("/fixed-assets", data);
  return res.data;
};
export const updateFixedAsset = async (id, data) => {
  const res = await adminRequests.put(`/fixed-assets/${id}`, data);
  return res.data;
};
export const disposeFixedAsset = async (id, data) => {
  const res = await adminRequests.post(`/fixed-assets/${id}/dispose`, data);
  return res.data;
};
export const previewDepreciation = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/fixed-assets/depreciation/preview${q ? `?${q}` : ""}`);
  return res.data;
};
export const runDepreciation = async (data) => {
  const res = await adminRequests.post("/fixed-assets/depreciation/run", data);
  return res.data;
};

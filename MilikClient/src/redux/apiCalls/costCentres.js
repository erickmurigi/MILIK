import { adminRequests } from "../../utils/requestMethods";
import { extractList, buildQuery } from "./shared";

export const getCostCentres = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/cost-centres${q ? `?${q}` : ""}`);
  return extractList(res.data);
};

export const createCostCentre = async (payload) => {
  const res = await adminRequests.post("/cost-centres", payload);
  return res.data?.data;
};

export const updateCostCentre = async (id, payload) => {
  const res = await adminRequests.put(`/cost-centres/${id}`, payload);
  return res.data?.data;
};

export const deleteCostCentre = async (id) => {
  const res = await adminRequests.delete(`/cost-centres/${id}`);
  return res.data;
};

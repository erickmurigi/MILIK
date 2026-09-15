import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

export const getLandlordAdvancements = async (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.landlordId && filters.landlordId !== "all") params.append("landlord", filters.landlordId);
  if (filters.propertyId && filters.propertyId !== "all") params.append("property", filters.propertyId);
  if (filters.advanceType && filters.advanceType !== "all") params.append("advanceType", filters.advanceType);
  if (filters.search) params.append("search", filters.search);
  if (filters.page) params.append("page", filters.page);
  if (filters.limit) params.append("limit", filters.limit);
  const res = await adminRequests.get(`/landlord-advancements${params.toString() ? `?${params.toString()}` : ""}`);
  return { data: extractList(res.data), total: res.data?.total ?? 0, page: res.data?.page ?? 1, pages: res.data?.pages ?? 1 };
};

export const createLandlordAdvancement = async (payload) => {
  const res = await adminRequests.post("/landlord-advancements", payload);
  return res.data;
};

export const updateLandlordAdvancement = async (id, payload) => {
  const res = await adminRequests.put(`/landlord-advancements/${id}`, payload);
  return res.data;
};

export const updateLandlordAdvancementStatus = async (id, payload) => {
  const res = await adminRequests.put(`/landlord-advancements/${id}/status`, payload);
  return res.data;
};

export const processLandlordAdvancementRecovery = async (id, payload) => {
  const res = await adminRequests.post(`/landlord-advancements/${id}/recover`, payload);
  return res.data;
};

export const cancelLandlordAdvancementRecovery = async (id, recoveryId, payload = {}) => {
  const res = await adminRequests.post(`/landlord-advancements/${id}/recoveries/${recoveryId}/cancel`, payload);
  return res.data;
};

export const deleteLandlordAdvancement = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);
  const res = await adminRequests.delete(`/landlord-advancements/${id}${params.toString() ? `?${params.toString()}` : ""}`);
  return res.data;
};

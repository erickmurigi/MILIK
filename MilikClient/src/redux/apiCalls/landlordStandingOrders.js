import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

export const getLandlordStandingOrders = async (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.landlordId && filters.landlordId !== "all") params.append("landlord", filters.landlordId);
  if (filters.propertyId && filters.propertyId !== "all") params.append("property", filters.propertyId);
  if (filters.search) params.append("search", filters.search);
  if (filters.page) params.append("page", filters.page);
  if (filters.limit) params.append("limit", filters.limit);
  const res = await adminRequests.get(`/landlord-standing-orders${params.toString() ? `?${params.toString()}` : ""}`);
  return { data: extractList(res.data), total: res.data?.total ?? 0, page: res.data?.page ?? 1, pages: res.data?.pages ?? 1 };
};

export const createLandlordStandingOrder = async (payload) => {
  const res = await adminRequests.post("/landlord-standing-orders", payload);
  return res.data;
};

export const updateLandlordStandingOrder = async (id, payload) => {
  const res = await adminRequests.put(`/landlord-standing-orders/${id}`, payload);
  return res.data;
};

export const updateLandlordStandingOrderStatus = async (id, payload) => {
  const res = await adminRequests.put(`/landlord-standing-orders/${id}/status`, payload);
  return res.data;
};

export const runLandlordStandingOrder = async (id, payload) => {
  const res = await adminRequests.post(`/landlord-standing-orders/${id}/run`, payload);
  return res.data;
};

export const runLandlordStandingOrdersBatch = async (items, context = {}) => {
  const res = await adminRequests.post("/landlord-standing-orders/batch-run", {
    items,
    business: context.business,
    company: context.company,
  });
  return res.data;
};

export const reverseLandlordStandingOrderRun = async (id, runId, payload) => {
  const res = await adminRequests.post(`/landlord-standing-orders/${id}/runs/${runId}/reverse`, payload);
  return res.data;
};

export const deleteLandlordStandingOrder = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);
  const res = await adminRequests.delete(`/landlord-standing-orders/${id}${params.toString() ? `?${params.toString()}` : ""}`);
  return res.data;
};

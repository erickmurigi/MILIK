import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

export const getExpenseRequisitions = async (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.propertyId && filters.propertyId !== "all") params.append("property", filters.propertyId);
  if (filters.serviceProviderId && filters.serviceProviderId !== "all") params.append("serviceProvider", filters.serviceProviderId);
  if (filters.search) params.append("search", filters.search);
  const res = await adminRequests.get(`/expense-requisitions${params.toString() ? `?${params.toString()}` : ""}`);
  return extractList(res.data);
};

export const createExpenseRequisition = async (payload) => {
  const res = await adminRequests.post("/expense-requisitions", payload);
  return res.data;
};

export const updateExpenseRequisition = async (id, payload) => {
  const res = await adminRequests.put(`/expense-requisitions/${id}`, payload);
  return res.data;
};

export const updateExpenseRequisitionStatus = async (id, payload) => {
  const res = await adminRequests.put(`/expense-requisitions/${id}/status`, payload);
  return res.data;
};

export const batchDeleteExpenseRequisitions = async (ids, context = {}) => {
  const res = await adminRequests.post("/expense-requisitions/batch-delete", {
    ids,
    business: context.business,
    company: context.company,
  });
  return res.data;
};

export const deleteExpenseRequisition = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);
  const res = await adminRequests.delete(`/expense-requisitions/${id}${params.toString() ? `?${params.toString()}` : ""}`);
  return res.data;
};

export const getServiceProviders = async (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (typeof filters.active === 'boolean') params.append("active", String(filters.active));
  if (filters.search) params.append("search", filters.search);
  if (filters.name) params.append("name", filters.name);
  if (filters.category) params.append("category", filters.category);
  if (filters.page) params.append("page", filters.page);
  if (filters.limit) params.append("limit", filters.limit);
  const res = await adminRequests.get(`/service-providers${params.toString() ? `?${params.toString()}` : ""}`);
  return {
    data: extractList(res.data),
    total: res.data?.total ?? 0,
    page: res.data?.page ?? 1,
    pages: res.data?.pages ?? 1,
  };
};

export const createServiceProvider = async (payload) => {
  const res = await adminRequests.post("/service-providers", payload);
  return res.data;
};

export const updateServiceProvider = async (id, payload) => {
  const res = await adminRequests.put(`/service-providers/${id}`, payload);
  return res.data;
};

export const deleteServiceProvider = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);
  const res = await adminRequests.delete(`/service-providers/${id}${params.toString() ? `?${params.toString()}` : ""}`);
  return res.data;
};

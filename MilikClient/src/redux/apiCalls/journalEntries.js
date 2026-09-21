import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

export const getJournalEntries = async (filters = {}) => {
  const params = new URLSearchParams();

  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.journalType && filters.journalType !== "all") params.append("journalType", filters.journalType);
  if (filters.propertyId && filters.propertyId !== "all") params.append("property", filters.propertyId);
  if (filters.landlordId && filters.landlordId !== "all") params.append("landlord", filters.landlordId);
  if (filters.sourceModule && filters.sourceModule !== "all") params.append("sourceModule", filters.sourceModule);
  if (filters.excludeSourceModules) params.append("excludeSourceModules", filters.excludeSourceModules);
  if (filters.startDate) params.append("startDate", filters.startDate);
  if (filters.endDate) params.append("endDate", filters.endDate);
  if (filters.search) params.append("search", filters.search);
  if (filters.page) params.append("page", filters.page);
  if (filters.limit) params.append("limit", filters.limit);

  const query = params.toString();
  const res = await adminRequests.get(`/journals${query ? `?${query}` : ""}`);
  return {
    data: extractList(res.data),
    total: res.data?.total ?? 0,
    page: res.data?.page ?? 1,
    pages: res.data?.pages ?? 1,
  };
};

export const getJournalEntry = async (id) => {
  const res = await adminRequests.get(`/journals/${id}`);
  return res.data;
};

export const createJournalEntry = async (journalData) => {
  const res = await adminRequests.post("/journals", journalData);
  return res.data;
};

export const updateJournalEntry = async (id, journalData) => {
  const res = await adminRequests.put(`/journals/${id}`, journalData);
  return res.data;
};

export const postJournalEntry = async (id, payload = {}) => {
  const res = await adminRequests.post(`/journals/${id}/post`, payload);
  return res.data;
};

export const reverseJournalEntry = async (id, payload = {}) => {
  const res = await adminRequests.post(`/journals/${id}/reverse`, payload);
  return res.data;
};

export const deleteJournalEntry = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);

  const query = params.toString();
  const res = await adminRequests.delete(`/journals/${id}${query ? `?${query}` : ""}`);
  return res.data;
};

// ─── JOURNAL APPROVAL ─────────────────────────────────────────────────────────
export const submitJournalForReview = async (id) => {
  const res = await adminRequests.post(`/journals/${id}/submit`);
  return res.data;
};

export const reviewJournalEntry = async (id) => {
  const res = await adminRequests.post(`/journals/${id}/review`);
  return res.data;
};

export const approveJournalEntry = async (id) => {
  const res = await adminRequests.post(`/journals/${id}/approve`);
  return res.data;
};

export const rejectJournalEntry = async (id, payload = {}) => {
  const res = await adminRequests.post(`/journals/${id}/reject`, payload);
  return res.data;
};

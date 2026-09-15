import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

export const getMeterReadings = async (filters = {}) => {
  const params = new URLSearchParams();

  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.property && filters.property !== "all") params.append("property", filters.property);
  if (filters.unit && filters.unit !== "all") params.append("unit", filters.unit);
  if (filters.tenant && filters.tenant !== "all") params.append("tenant", filters.tenant);
  if (filters.utility && filters.utility !== "all") params.append("utilityType", filters.utility);
  if (filters.utilityType && filters.utilityType !== "all") params.append("utilityType", filters.utilityType);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.billingPeriod) params.append("billingPeriod", filters.billingPeriod);
  if (filters.periodMonth && filters.periodYear) params.append("billingPeriod", `${filters.periodYear}-${String(filters.periodMonth).padStart(2, "0")}`);
  if (filters.search) params.append("search", filters.search);

  const query = params.toString();
  const res = await adminRequests.get(`/meter-readings${query ? `?${query}` : ""}`);
  return extractList(res.data);
};

export const createMeterReading = async (payload) => {
  const res = await adminRequests.post("/meter-readings", payload);
  return res.data;
};

export const updateMeterReading = async (id, payload) => {
  const res = await adminRequests.put(`/meter-readings/${id}`, payload);
  return res.data;
};

export const deleteMeterReading = async (id) => {
  const res = await adminRequests.delete(`/meter-readings/${id}`);
  return res.data;
};

export const voidMeterReading = async (id, payload = {}) => {
  const res = await adminRequests.patch(`/meter-readings/${id}/void`, payload);
  return res.data;
};

export const billMeterReading = async (id, payload = {}) => {
  const res = await adminRequests.post(`/meter-readings/${id}/bill`, payload);
  return res.data;
};

export const createMeterReadingsBatch = async (payload) => {
  const res = await adminRequests.post("/meter-readings/batch", payload);
  return res.data;
};

export const billMeterReadingsBatch = async (readingIds) => {
  const res = await adminRequests.post("/meter-readings/batch-bill", { readingIds });
  return res.data;
};

export const deleteMeterReadingsBatch = async (readingIds) => {
  const res = await adminRequests.post("/meter-readings/batch-delete", { readingIds });
  return res.data;
};

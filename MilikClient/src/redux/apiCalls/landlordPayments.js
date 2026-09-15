import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

// Create payment voucher (generic, for compatibility)
export const createPaymentVoucher = async (voucherData) => {
  // Use the same endpoint as createLandlordPayment
  const res = await adminRequests.post("/payment-vouchers", voucherData);
  return res.data;
};

export const getLandlordReceipts = async (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });
  const query = search.toString();
  const res = await adminRequests.get(`/landlord-receipts${query ? `?${query}` : ""}`);
  return {
    data: extractList(res.data),
    total: res.data?.total ?? 0,
    page: res.data?.page ?? 1,
    pages: res.data?.pages ?? 1,
  };
};

export const getLandlordReceipt = async (id, params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });
  const query = search.toString();
  const res = await adminRequests.get(`/landlord-receipts/${id}${query ? `?${query}` : ""}`);
  return res?.data?.data || res?.data;
};

export const createLandlordReceipt = async (payload = {}) => {
  const res = await adminRequests.post(`/landlord-receipts`, payload);
  return res?.data?.data || res?.data;
};

export const updateLandlordReceipt = async (id, payload = {}) => {
  const res = await adminRequests.put(`/landlord-receipts/${id}`, payload);
  return res?.data?.data || res?.data;
};

export const postLandlordReceipt = async (id, payload = {}) => {
  const res = await adminRequests.put(`/landlord-receipts/post/${id}`, payload);
  return res?.data?.data || res?.data;
};

export const reverseLandlordReceipt = async (id, payload = {}) => {
  const res = await adminRequests.put(`/landlord-receipts/reverse/${id}`, payload);
  return res?.data?.data || res?.data;
};

export const deleteLandlordReceipt = async (id, params = {}) => {
  const res = await adminRequests.delete(`/landlord-receipts/${id}`, { params });
  return res?.data?.data || res?.data;
};

// Update payment voucher status
export const updatePaymentVoucherStatus = async (id, statusData = {}, context = {}) => {
  const payload = { ...(statusData || {}) };
  if (context.business) payload.business = context.business;
  if (context.company) payload.company = context.company;
  const res = await adminRequests.put(`/payment-vouchers/${id}/status`, payload);
  return res.data;
};

// Get all landlord payment vouchers for a company.
// Backend caps each page at 200 (parsePagination maxLimit) — loop pages so callers
// that rely on this being the FULL set (financial totals, payment history) don't
// silently see only the first 50-200 records for businesses with more history than that.
export const getLandlordPayments = async (companyId) => {
  const params = new URLSearchParams();
  if (companyId) params.append("business", companyId);
  if (companyId) params.append("company", companyId);
  params.append("limit", "200");

  let page = 1;
  let pages = 1;
  const all = [];
  do {
    params.set("page", String(page));
    const res = await adminRequests.get(`/landlord-payments?${params.toString()}`);
    all.push(...extractList(res.data));
    pages = Number(res.data?.pages) || 1;
    page += 1;
  } while (page <= pages);

  return all;
};

export const getPaymentVouchers = async (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.category && filters.category !== "all") params.append("category", filters.category);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.propertyId && filters.propertyId !== "all") params.append("property", filters.propertyId);
  if (filters.landlordId && filters.landlordId !== "all") params.append("landlord", filters.landlordId);
  if (filters.search) params.append("search", filters.search);
  if (filters.page) params.append("page", filters.page);
  if (filters.limit) params.append("limit", filters.limit);

  const query = params.toString();
  const res = await adminRequests.get(`/payment-vouchers${query ? `?${query}` : ""}`);
  return {
    data: extractList(res.data),
    total: res.data?.total ?? 0,
    page: res.data?.page ?? 1,
    pages: res.data?.pages ?? 1,
  };
};

// Create a landlord payment voucher
export const createLandlordPayment = async (paymentData) => {
  const res = await adminRequests.post("/landlord-payments", paymentData);
  return res.data;
};

// Delete a landlord payment voucher
export const deletePaymentVoucher = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);

  const query = params.toString();
  const res = await adminRequests.delete(`/payment-vouchers/${id}${query ? `?${query}` : ""}`);
  return res.data;
};

export const updatePaymentVoucher = async (id, payload = {}, context = {}) => {
  const body = { ...(payload || {}) };
  if (context.business) body.business = context.business;
  if (context.company) body.company = context.company;
  const res = await adminRequests.put(`/payment-vouchers/${id}`, body);
  return res.data;
};

export const reverseLandlordPayment = async (paymentId, payload = {}) => {
  const res = await adminRequests.post(`/landlord-payments/${paymentId}/reverse`, payload);
  return res.data;
};

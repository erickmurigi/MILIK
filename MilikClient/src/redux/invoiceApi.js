import { adminRequests } from "../utils/requestMethods";

// Create tenant invoice
export const getCreditableTenantInvoices = async ({ business = null, tenantId = null } = {}) => {
  const params = new URLSearchParams();
  if (business) params.append("business", business);
  if (tenantId) params.append("tenant", tenantId);
  const query = params.toString();
  const res = await adminRequests.get(`/tenant-invoices/creditable${query ? `?${query}` : ""}`);
  return Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : [];
};

export const getTenantInvoiceNotes = async ({ tenantId = null, business = null } = {}) => {
  const params = new URLSearchParams();
  if (tenantId) params.append("tenant", tenantId);
  if (business) params.append("business", business);
  const query = params.toString();
  const res = await adminRequests.get(`/tenant-invoices/notes${query ? `?${query}` : ""}`);
  return Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : [];
};

export const getTenantInvoiceNoteChargeTypes = async () => {
  const res = await adminRequests.get("/tenant-invoices/note-charge-types");
  return Array.isArray(res.data?.chargeTypes) ? res.data.chargeTypes : Array.isArray(res.data) ? res.data : [];
};

export const createTenantInvoiceNote = async (noteData) => {
  const res = await adminRequests.post("/tenant-invoices/notes", noteData);
  return res.data;
};

export const deleteTenantInvoiceNote = async (noteId, payload = {}) => {
  const res = await adminRequests.delete(`/tenant-invoices/notes/${noteId}`, { data: payload });
  return res.data;
};

export const createTenantInvoice = async (invoiceData) => {
  const res = await adminRequests.post("/tenant-invoices", invoiceData);
  return res.data;
};

export const createTenantInvoicesBatch = async ({ business = null, items = [] } = {}) => {
  const res = await adminRequests.post("/tenant-invoices/batch", { business, items });
  return res.data;
};

// Get tenant invoices
export const getTenantInvoices = async ({ tenantId, business, status, category } = {}) => {
  const params = new URLSearchParams();

  if (tenantId) params.append("tenant", tenantId);
  if (business) params.append("business", business);
  if (status) params.append("status", status);
  if (category) params.append("category", category);

  const query = params.toString();
  const res = await adminRequests.get(`/tenant-invoices${query ? `?${query}` : ""}`);
  return res.data;
};

// Delete tenant invoice
export const deleteTenantInvoice = async (invoiceId) => {
  const res = await adminRequests.delete(`/tenant-invoices/${invoiceId}`);
  return res.data;
};

export const getTakeOnBalances = async ({ business = null, tenantId = null } = {}) => {
  const params = new URLSearchParams();
  if (business) params.append("business", business);
  if (tenantId) params.append("tenant", tenantId);
  const query = params.toString();
  const res = await adminRequests.get(`/tenant-invoices/take-on-balances${query ? `?${query}` : ""}`);
  return Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
};

export const updateTakeOnBalance = async (invoiceId, payload) => {
  const res = await adminRequests.put(`/tenant-invoices/${invoiceId}/take-on-balance`, payload);
  return res.data;
};

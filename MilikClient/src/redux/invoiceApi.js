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

export const reverseTenantInvoiceNote = async (noteId, payload = {}) => {
  const res = await adminRequests.post(`/tenant-invoices/notes/${noteId}/reverse`, payload);
  return res.data;
};

export const deleteTenantInvoiceNote = async (noteId, payload = {}) => {
  return reverseTenantInvoiceNote(noteId, payload);
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
export const getTenantInvoices = async ({
  tenantId,
  business,
  status,
  category,
  includeSnapshots = false,
  paginate = false,
  page,
  limit,
  invoiceNumber,
  invoiceNo,
  tenantName,
  propertyId,
  unitId,
  fromDate,
  toDate,
} = {}) => {
  const params = new URLSearchParams();

  if (tenantId) params.append("tenant", tenantId);
  if (business) params.append("business", business);
  if (status) params.append("status", status);
  if (category) params.append("category", category);
  if (includeSnapshots) params.append("includeSnapshots", "1");
  if (paginate) params.append("paginate", "1");
  if (page) params.append("page", String(page));
  if (limit) params.append("limit", String(limit));
  if (invoiceNumber) params.append("invoiceNumber", invoiceNumber);
  if (invoiceNo) params.append("invoiceNo", invoiceNo);
  if (tenantName) params.append("tenantName", tenantName);
  if (propertyId) params.append("propertyId", propertyId);
  if (unitId) params.append("unitId", unitId);
  if (fromDate) params.append("fromDate", fromDate);
  if (toDate) params.append("toDate", toDate);

  const query = params.toString();
  const res = await adminRequests.get(`/tenant-invoices${query ? `?${query}` : ""}`);
  const payload = res.data;

  if (paginate) {
    const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const pagination = payload?.pagination && typeof payload.pagination === "object" ? payload.pagination : {
      page: Number(page || 1),
      limit: Number(limit || items.length || 1),
      totalItems: items.length,
      totalPages: 1,
    };
    const summary = payload?.summary && typeof payload.summary === "object" ? payload.summary : {};

    return {
      data: items,
      pagination,
      summary,
    };
  }

  return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
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

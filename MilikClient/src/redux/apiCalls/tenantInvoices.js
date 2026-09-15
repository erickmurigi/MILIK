import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

// Download invoice PDF
export const downloadInvoicePdf = async (invoiceId, { preview = false, filename } = {}) => {
  const res = await adminRequests.get(`/tenant-invoices/${invoiceId}/pdf${preview ? "?preview=true" : ""}`, {
    responseType: "blob",
  });
  const blob = new Blob([res.data], { type: "application/pdf" });
  const url = window.URL.createObjectURL(blob);
  if (preview) {
    window.open(url, "_blank");
    setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
  } else {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || `Invoice-${invoiceId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
  return true;
};

export const getTenantInvoices = async ({ tenantId = null, business = null, status = null, category = null, includeSnapshots = false } = {}) => {
  const params = new URLSearchParams();

  if (tenantId) params.append("tenant", tenantId);
  if (business) params.append("business", business);
  if (status) params.append("status", status);
  if (category) params.append("category", category);
  if (includeSnapshots) params.append("includeSnapshots", "1");

  const query = params.toString();
  const res = await adminRequests.get(`/tenant-invoices${query ? `?${query}` : ""}`);
  return extractList(res.data);
};

// Create tenant invoice
export const getCreditableTenantInvoices = async ({ business = null, tenantId = null } = {}) => {
  const params = new URLSearchParams();
  if (business) params.append("business", business);
  if (tenantId) params.append("tenant", tenantId);
  const query = params.toString();
  const res = await adminRequests.get(`/tenant-invoices/creditable${query ? `?${query}` : ""}`);
  return extractList(res.data);
};

export const getTenantInvoiceNotes = async ({ tenantId = null, business = null } = {}) => {
  const params = new URLSearchParams();
  if (tenantId) params.append("tenant", tenantId);
  if (business) params.append("business", business);
  const query = params.toString();
  const res = await adminRequests.get(`/tenant-invoices/notes${query ? `?${query}` : ""}`);
  return extractList(res.data);
};

export const getTenantInvoiceNoteChargeTypes = async () => {
  const res = await adminRequests.get("/tenant-invoices/note-charge-types");
  return extractList(res.data?.chargeTypes || res.data);
};

export const createTenantInvoiceNote = async (noteData) => {
  const res = await adminRequests.post("/tenant-invoices/notes", noteData);
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

// Delete / cancel tenant invoice (soft-reversal — backend treats DELETE as reverse)
export const deleteTenantInvoice = async (invoiceId) => {
  const res = await adminRequests.delete(`/tenant-invoices/${invoiceId}`);
  return res.data;
};

export const deleteTenantInvoicesBatch = async (ids) => {
  const res = await adminRequests.post("/tenant-invoices/batch-delete", { ids });
  return res.data;
};

export const cancelTenantInvoice = deleteTenantInvoice;

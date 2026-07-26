import { adminRequests } from '../utils/requestMethods';

const BASE = '/api';

export const clientsApi = {
  // ─── Clients CRUD ────────────────────────────────────────────────────────────
  list: (params = {}) => adminRequests.get(`${BASE}/clients`, { params }),
  get: (id) => adminRequests.get(`${BASE}/clients/${id}`),
  getSummary: (id) => adminRequests.get(`${BASE}/clients/${id}/summary`),
  create: (data) => adminRequests.post(`${BASE}/clients`, data),
  update: (id, data) => adminRequests.put(`${BASE}/clients/${id}`, data),
  remove: (id) => adminRequests.delete(`${BASE}/clients/${id}`),

  // ─── Contracts ───────────────────────────────────────────────────────────────
  listContracts: (params = {}) => adminRequests.get(`${BASE}/clients/contracts`, { params }),
  getContract: (id) => adminRequests.get(`${BASE}/clients/contracts/${id}`),
  createContract: (data) => adminRequests.post(`${BASE}/clients/contracts`, data),
  updateContract: (id, data) => adminRequests.put(`${BASE}/clients/contracts/${id}`, data),
  activateContract: (id) => adminRequests.patch(`${BASE}/clients/contracts/${id}/activate`),
  renewContract: (id, data) => adminRequests.post(`${BASE}/clients/contracts/${id}/renew`, data),
  terminateContract: (id, data) => adminRequests.post(`${BASE}/clients/contracts/${id}/terminate`, data),
  updateRenewalStage: (id, data) => adminRequests.patch(`${BASE}/clients/contracts/${id}/renewal-stage`, data),

  // ─── Invoices ────────────────────────────────────────────────────────────────
  listInvoices: (params = {}) => adminRequests.get(`${BASE}/clients/invoices`, { params }),
  getInvoice: (id) => adminRequests.get(`${BASE}/clients/invoices/${id}`),
  createInvoice: (data) => adminRequests.post(`${BASE}/clients/invoices`, data),
  updateInvoice: (id, data) => adminRequests.put(`${BASE}/clients/invoices/${id}`, data),
  markPaid: (id, data) => adminRequests.patch(`${BASE}/clients/invoices/${id}/mark-paid`, data),
  sendInvoice: (id) => adminRequests.post(`${BASE}/clients/invoices/${id}/send`),
  cancelInvoice: (id) => adminRequests.delete(`${BASE}/clients/invoices/${id}`),

  // ─── Interactions ────────────────────────────────────────────────────────────
  listInteractions: (params = {}) => adminRequests.get(`${BASE}/clients/interactions`, { params }),
  createInteraction: (data) => adminRequests.post(`${BASE}/clients/interactions`, data),
  deleteInteraction: (id) => adminRequests.delete(`${BASE}/clients/interactions/${id}`),
};

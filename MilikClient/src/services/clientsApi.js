import { adminRequests } from '../utils/requestMethods';

export const clientsApi = {
  // ─── Clients CRUD ────────────────────────────────────────────────────────────
  list: (params = {}) => adminRequests.get('/clients', { params }),
  get: (id) => adminRequests.get(`/clients/${id}`),
  getSummary: (id) => adminRequests.get(`/clients/${id}/summary`),
  getStatement: (id) => adminRequests.get(`/clients/${id}/statement`),
  sendSms: (id, data) => adminRequests.post(`/clients/${id}/send-sms`, data),
  create: (data) => adminRequests.post('/clients', data),
  update: (id, data) => adminRequests.put(`/clients/${id}`, data),
  remove: (id) => adminRequests.delete(`/clients/${id}`),

  // ─── Contracts ───────────────────────────────────────────────────────────────
  listContracts: (params = {}) => adminRequests.get('/clients/contracts', { params }),
  getContract: (id) => adminRequests.get(`/clients/contracts/${id}`),
  createContract: (data) => adminRequests.post('/clients/contracts', data),
  updateContract: (id, data) => adminRequests.put(`/clients/contracts/${id}`, data),
  activateContract: (id) => adminRequests.patch(`/clients/contracts/${id}/activate`),
  renewContract: (id, data) => adminRequests.post(`/clients/contracts/${id}/renew`, data),
  terminateContract: (id, data) => adminRequests.post(`/clients/contracts/${id}/terminate`, data),
  updateRenewalStage: (id, data) => adminRequests.patch(`/clients/contracts/${id}/renewal-stage`, data),

  // ─── Invoices ────────────────────────────────────────────────────────────────
  listInvoices: (params = {}) => adminRequests.get('/clients/invoices', { params }),
  getInvoice: (id) => adminRequests.get(`/clients/invoices/${id}`),
  createInvoice: (data) => adminRequests.post('/clients/invoices', data),
  updateInvoice: (id, data) => adminRequests.put(`/clients/invoices/${id}`, data),
  listPayments: (invoiceId, params = {}) => adminRequests.get(`/clients/invoices/${invoiceId}/payments`, { params }),
  recordPayment: (invoiceId, data) => adminRequests.post(`/clients/invoices/${invoiceId}/payments`, data),
  reversePayment: (invoiceId, paymentId, data = {}) =>
    adminRequests.post(`/clients/invoices/${invoiceId}/payments/${paymentId}/reverse`, data),
  sendInvoice: (id) => adminRequests.post(`/clients/invoices/${id}/send`),
  cancelInvoice: (id, data = {}) => adminRequests.delete(`/clients/invoices/${id}`, { data }),

  // ─── Interactions ────────────────────────────────────────────────────────────
  listInteractions: (params = {}) => adminRequests.get('/clients/interactions', { params }),
  createInteraction: (data) => adminRequests.post('/clients/interactions', data),
  deleteInteraction: (id) => adminRequests.delete(`/clients/interactions/${id}`),
};

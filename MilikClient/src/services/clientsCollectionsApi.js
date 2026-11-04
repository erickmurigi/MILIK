// Client receipts, collections (dunning / promises / disputes / credit control),
// reports and eTIMS endpoints of the Contract Management module. The older
// CRUD/contracts/invoices calls stay in services/clientsApi.js.
import { adminRequests } from '../utils/requestMethods';

const get = (url, params = {}) => adminRequests.get(url, { params });

export const clientsCollectionsApi = {
  // ─── Client master extras ──────────────────────────────────────────────────
  duplicates: (params) => get('/clients/duplicates', params),
  summary: (id) => get(`/clients/${id}/summary`),
  statement: (id, params = {}) => get(`/clients/${id}/statement`, params),

  // One PDF/image → { url, name, uploadedAt } (client documents, signed contracts, WHT certificates)
  uploadDocument: (file) => {
    const body = new FormData();
    body.append('file', file);
    return adminRequests.post('/clients/uploads', body, { headers: { 'Content-Type': 'multipart/form-data' } });
  },

  // ─── Receipts ──────────────────────────────────────────────────────────────
  listReceipts: (params) => get('/clients/receipts', params),
  getReceipt: (id) => get(`/clients/receipts/${id}`),
  allocationSuggestions: (clientId, amount) =>
    get('/clients/receipts/allocation-suggestions', { clientId, ...(amount !== undefined && amount !== null && amount !== '' ? { amount } : {}) }),
  createReceipt: (data) => adminRequests.post('/clients/receipts', data),
  applyCredit: (data) => adminRequests.post('/clients/receipts/apply-credit', data),
  applyReceiptCredit: (id, data) => adminRequests.post(`/clients/receipts/${id}/apply`, data),
  reverseAllocation: (id, allocationId, reason) =>
    adminRequests.post(`/clients/receipts/${id}/allocations/${allocationId}/reverse`, { reason }),
  refund: (id, data) => adminRequests.post(`/clients/receipts/${id}/refund`, data),
  listRefunds: (params) => get('/clients/receipts/refunds', params),
  reverseRefund: (refundId, reason) => adminRequests.post(`/clients/receipts/refunds/${refundId}/reverse`, { reason }),
  emailReceipt: (id) => adminRequests.post(`/clients/receipts/${id}/send-email`),
  reverseReceipt: (id, reason) => adminRequests.post(`/clients/receipts/${id}/reverse`, { reason }),
  chequeStatus: (id, data) => adminRequests.post(`/clients/receipts/${id}/cheque-status`, data),
  listWhtCertificates: (params) => get('/clients/receipts/wht-certificates', params),
  updateWhtCertificate: (certId, data) => adminRequests.patch(`/clients/receipts/wht-certificates/${certId}`, data),
  listUnmatchedMpesa: (params) => get('/clients/receipts/mpesa/unmatched', params),
  matchMpesa: (collectionId, data) => adminRequests.post(`/clients/receipts/mpesa/${collectionId}/match`, data),

  // ─── Collections ───────────────────────────────────────────────────────────
  getCollectionSettings: () => get('/clients/collections/settings'),
  updateCollectionSettings: (data) => adminRequests.put('/clients/collections/settings', data),
  previewDunning: () => get('/clients/collections/dunning/preview'),
  runDunning: () => adminRequests.post('/clients/collections/dunning/run'),
  dunningLog: (params) => get('/clients/collections/dunning/log', params),
  getInvoiceFlag: (invoiceId) => get(`/clients/collections/invoices/${invoiceId}/flag`),
  listDisputes: (params) => get('/clients/collections/disputes', params),
  setDispute: (invoiceId, data) => adminRequests.post(`/clients/collections/invoices/${invoiceId}/dispute`, data),
  listPromises: (params) => get('/clients/collections/promises', params),
  createPromise: (data) => adminRequests.post('/clients/collections/promises', data),
  updatePromise: (id, data) => adminRequests.patch(`/clients/collections/promises/${id}`, data),
  creditCheck: (clientId, amount) => get(`/clients/collections/credit-check/${clientId}`, amount ? { amount } : {}),
  setCreditHold: (clientId, data) => adminRequests.patch(`/clients/collections/credit-hold/${clientId}`, data),
  lateInterestPreview: (params) => get('/clients/collections/late-interest/preview', params),

  // ─── Reports ───────────────────────────────────────────────────────────────
  report: (name, params) => get(`/clients/reports/${name}`, params),

  // ─── eTIMS ─────────────────────────────────────────────────────────────────
  getEtimsSettings: () => get('/clients/etims/settings'),
  updateEtimsSettings: (data) => adminRequests.put('/clients/etims/settings', data),
  testEtims: () => adminRequests.post('/clients/etims/test-connection'),
  etimsSubmissions: (params) => get('/clients/etims/submissions', params),
  submitInvoiceEtims: (id, force = false) => adminRequests.post(`/clients/etims/invoices/${id}/submit`, { force }),
  submitCreditNoteEtims: (id, force = false) => adminRequests.post(`/clients/etims/credit-notes/${id}/submit`, { force }),

  // ─── Lookups ───────────────────────────────────────────────────────────────
  companyUsers: (companyId) => get('/users', { companyId, limit: 500 }),
};

// Unwraps `{ success, data }` envelopes.
export const unwrap = (res) => res?.data?.data ?? res?.data;
export const apiError = (err, fallback = 'Something went wrong') =>
  err?.response?.data?.message || err?.message || fallback;

export default clientsCollectionsApi;

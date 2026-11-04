// Contract billing endpoints of the Contract Management (clients) module: contracts lifecycle,
// billing schedule, billing runs, invoices, credit/debit notes, quotes, revenue recognition and
// billing settings. Older client CRUD calls live in services/clientsApi.js; receipts/collections
// in services/clientsCollectionsApi.js.
import { adminRequests } from '../utils/requestMethods';
import { printPdfBlob } from '../utils/printKit';

const get = (url, params = {}) => adminRequests.get(url, { params });
const post = (url, data = {}) => adminRequests.post(url, data);

/** Response body → payload (`data.data` when the controller wraps it, else the body). */
export const unwrapData = (res) => res?.data?.data ?? res?.data;
/** Backend error message for toasts. */
export const apiError = (err, fallback = 'Something went wrong') =>
  err?.response?.data?.message || err?.message || fallback;

// Fetches a server PDF and either prints it in place or downloads it.
const pdf = async (url, { preview = false, filename = 'document.pdf' } = {}) => {
  const res = await adminRequests.get(url, { responseType: 'blob', params: preview ? { preview: 'true' } : {} });
  const blob = new Blob([res.data], { type: 'application/pdf' });
  if (preview) {
    await printPdfBlob(blob);
    return true;
  }
  const href = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(href);
  return true;
};

export const contractsApi = {
  list: (params) => get('/clients/contracts', params),
  get: (id) => get(`/clients/contracts/${id}`),
  create: (data) => post('/clients/contracts', data),
  update: (id, data) => adminRequests.put(`/clients/contracts/${id}`, data),
  submit: (id) => post(`/clients/contracts/${id}/submit`),
  approve: (id) => post(`/clients/contracts/${id}/approve`),
  reject: (id, reason) => post(`/clients/contracts/${id}/reject`, { reason }),
  activate: (id) => adminRequests.patch(`/clients/contracts/${id}/activate`),
  suspend: (id, data) => post(`/clients/contracts/${id}/suspend`, data),
  resume: (id, data = {}) => post(`/clients/contracts/${id}/resume`, data),
  terminate: (id, data) => post(`/clients/contracts/${id}/terminate`, data),
  cancel: (id, reason) => post(`/clients/contracts/${id}/cancel`, { reason }),
  renew: (id, data) => post(`/clients/contracts/${id}/renew`, data),
  renewalStage: (id, data) => adminRequests.patch(`/clients/contracts/${id}/renewal-stage`, data),
  amend: (id, data) => post(`/clients/contracts/${id}/amend`, data),
  versions: (id) => get(`/clients/contracts/${id}/versions`),
  approveVersion: (id, versionId) => post(`/clients/contracts/${id}/versions/${versionId}/approve`),
  rejectVersion: (id, versionId, reason) => post(`/clients/contracts/${id}/versions/${versionId}/reject`, { reason }),
  schedule: (id, { refresh = false } = {}) => get(`/clients/contracts/${id}/schedule`, refresh ? { refresh: 'true' } : {}),
  scheduleAction: (id, rowId, action, reason = '') => post(`/clients/contracts/${id}/schedule/${rowId}/${action}`, { reason }),
  runEscalations: (data = {}) => post('/clients/contracts/escalations/run', data),
  pdf: (id, opts = {}) => pdf(`/clients/contracts/${id}/pdf`, { filename: `Contract-${opts.number || id}.pdf`, ...opts }),
  signedCopy: (id, data) => post(`/clients/contracts/${id}/signed-copy`, data),
  addDocument: (id, data) => post(`/clients/contracts/${id}/documents`, data),
  removeDocument: (id, documentId) => adminRequests.delete(`/clients/contracts/${id}/documents/${documentId}`),
};

export const invoicesApi = {
  list: (params) => get('/clients/invoices', params),
  get: (id) => get(`/clients/invoices/${id}`),
  create: (data) => post('/clients/invoices', data),
  update: (id, data) => adminRequests.put(`/clients/invoices/${id}`, data),
  post: (id) => post(`/clients/invoices/${id}/post`),
  send: (id) => post(`/clients/invoices/${id}/send`),
  cancel: (id, reason) => adminRequests.delete(`/clients/invoices/${id}`, { data: { reason } }),
  creditNote: (id, data) => post(`/clients/invoices/${id}/credit-notes`, data),
  debitNote: (id, data) => post(`/clients/invoices/${id}/debit-notes`, data),
  pdf: (id, opts = {}) => pdf(`/clients/invoices/${id}/pdf`, { filename: `Invoice-${opts.number || id}.pdf`, ...opts }),
  submitEtims: (id) => post(`/clients/etims/invoices/${id}/submit`),
  // Company-wide AR/billing KPIs (receivables, overdue, billed in range) for list header chips.
  kpis: (params) => get('/clients/reports/dashboard', params),
};

export const notesApi = {
  list: (params) => get('/clients/notes', params),
  get: (id) => get(`/clients/notes/${id}`),
  reverse: (id, reason) => post(`/clients/notes/${id}/reverse`, { reason }),
  lateInterest: (data) => post('/clients/notes/late-interest', data),
  pdf: (id, opts = {}) => pdf(`/clients/notes/${id}/pdf`, { filename: `Note-${opts.number || id}.pdf`, ...opts }),
};

export const billingApi = {
  preview: (params) => get('/clients/billing/preview', params),
  run: (data) => post('/clients/billing/run', data),
  runs: (params) => get('/clients/billing/runs', params),
  getRun: (id) => get(`/clients/billing/runs/${id}`),
  getSettings: () => get('/clients/billing/settings'),
  updateSettings: (data) => adminRequests.put('/clients/billing/settings', data),
};

export const revenueApi = {
  schedules: (params) => get('/clients/revenue/schedules', params),
  milestone: (id, data) => post(`/clients/revenue/schedules/${id}/milestone`, data),
  preview: (params) => get('/clients/revenue/recognition/preview', params),
  run: (data) => post('/clients/revenue/recognition/run', data),
  deferredBalance: (params) => get('/clients/revenue/reports/deferred-balance', params),
  waterfall: (params) => get('/clients/revenue/reports/waterfall', params),
  billedVsRecognised: (params) => get('/clients/revenue/reports/billed-vs-recognised', params),
};

export const quotesApi = {
  list: (params) => get('/clients/quotes', params),
  get: (id) => get(`/clients/quotes/${id}`),
  create: (data) => post('/clients/quotes', data),
  update: (id, data) => adminRequests.put(`/clients/quotes/${id}`, data),
  send: (id) => post(`/clients/quotes/${id}/send`),
  accept: (id) => post(`/clients/quotes/${id}/accept`),
  decline: (id, reason) => post(`/clients/quotes/${id}/decline`, { reason }),
  toContract: (id, data) => post(`/clients/quotes/${id}/convert-to-contract`, data),
  toInvoice: (id, data = {}) => post(`/clients/quotes/${id}/convert-to-invoice`, data),
  pdf: (id, opts = {}) => pdf(`/clients/quotes/${id}/pdf`, { filename: `Quote-${opts.number || id}.pdf`, ...opts }),
};

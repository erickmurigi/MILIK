/* eslint-disable no-undef */
import {adminRequests} from "../utils/requestMethods"
// Track C item 3: this file is mid-decomposition into redux/apiCalls/*.js
// domain files, re-exported via the barrel at the bottom. Functions not yet
// moved still live here and share the same cache/helper primitives via
// ./apiCalls/shared.js (the one place `store` is imported across the split)
// rather than redefining them locally.

// Domain files already split out of this God-file (Track C item 3). Barrel
// re-export so none of the 80+ importers of "redux/apiCalls" need to change —
// they all use the extensionless module path with named imports.
export * from "./apiCalls/auth";
export * from "./apiCalls/users";
export * from "./apiCalls/companies";
export * from "./apiCalls/printers";
export * from "./apiCalls/serviceRequests";
export * from "./apiCalls/landlords";
export * from "./apiCalls/utilities";
export * from "./apiCalls/units";
export * from "./apiCalls/tenants";
export * from "./apiCalls/leases";
export * from "./apiCalls/expenseProperties";
export * from "./apiCalls/maintenance";
export * from "./apiCalls/notifications";
export * from "./apiCalls/meterReadings";
export * from "./apiCalls/latePenalties";
export * from "./apiCalls/rentPayments";
export * from "./apiCalls/tenantInvoices";
export * from "./apiCalls/chartOfAccounts";
export * from "./apiCalls/landlordPayments";
export * from "./apiCalls/expenseRequisitions";
export * from "./apiCalls/creditors";
export * from "./apiCalls/landlordStandingOrders";
export * from "./apiCalls/landlordAdvancements";
export * from "./apiCalls/statements";
export * from "./apiCalls/dashboard";
export * from "./apiCalls/journalEntries";
export * from "./apiCalls/financialReports";
export * from "./apiCalls/propertyLedger";
export * from "./apiCalls/bankReconciliation";
export * from "./apiCalls/budgets";
export * from "./apiCalls/fixedAssets";
export * from "./apiCalls/accountingPeriods";
export * from "./apiCalls/glIntegrity";


// Create payment voucher (generic, for compatibility)
export const getRentalCollectionReport = async (params = {}, signal) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/rental-collection${query ? `?${query}` : ""}`, { timeout: 120_000, signal });
  return res.data;
};

export const getTenantPaidBalanceReport = async (params = {}, signal) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/tenant-paid-balance${query ? `?${query}` : ""}`, { timeout: 120_000, signal });
  return res.data;
};

export const getRentalAgedAnalysisReport = async (params = {}, signal) => {
  const res = await adminRequests.get("/financial-reports/rental-aged-analysis", { params, signal, timeout: 120_000 });
  return res.data;
};

export const getTenantSummaryReport = async (params = {}, signal) => {
  const res = await adminRequests.get("/financial-reports/tenant-summary", { params, signal, timeout: 60_000 });
  return res.data;
};
export const getVatReturnSummary = async (params = {}) => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")
  ).toString();
  const res = await adminRequests.get(`/vat-remittance/summary${query ? `?${query}` : ""}`);
  return res.data;
};

export const getVatRemittanceHistory = async (params = {}) => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")
  ).toString();
  const res = await adminRequests.get(`/vat-remittance${query ? `?${query}` : ""}`);
  return res.data;
};

export const remitVat = async (data) => {
  const res = await adminRequests.post("/vat-remittance/remit", data);
  return res.data;
};

export const voidVatRemittance = async (id, data) => {
  const res = await adminRequests.patch(`/vat-remittance/${id}/void`, data);
  return res.data;
};

export const getWhtReturnSummary = async (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")).toString();
  const res = await adminRequests.get(`/wht-remittance/summary${query ? `?${query}` : ""}`);
  return res.data;
};

export const getWhtRemittanceHistory = async (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")).toString();
  const res = await adminRequests.get(`/wht-remittance${query ? `?${query}` : ""}`);
  return res.data;
};

export const remitWht = async (data) => {
  const res = await adminRequests.post("/wht-remittance/remit", data);
  return res.data;
};

export const voidWhtRemittance = async (id, data) => {
  const res = await adminRequests.patch(`/wht-remittance/${id}/void`, data);
  return res.data;
};

export const getMRITaxSummaryReport = async (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/mri-tax-summary${query ? `?${query}` : ""}`, { timeout: 120_000 });
  return res.data;
};

export const getPropertyIncomeSummaryReport = async (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/property-income-summary${query ? `?${query}` : ""}`, { timeout: 120_000 });
  return res.data;
};

// Communications
export const getCommunicationTemplates = async ({ business, contextType }) => {
  const params = new URLSearchParams();
  if (business) params.append('business', business);
  if (contextType) params.append('contextType', contextType);
  const query = params.toString();
  const res = await adminRequests.get(`/communications/templates${query ? `?${query}` : ''}`);
  return res.data;
};

export const previewCommunicationMessage = async (payload) => {
  const res = await adminRequests.post('/communications/preview', payload);
  return res.data;
};

export const sendCommunicationMessage = async (payload) => {
  const res = await adminRequests.post('/communications/send', payload);
  return res.data;
};

export const getSmsLogs = async (business, { limit = 30, channel, contextType, status } = {}) => {
  const params = new URLSearchParams({ business, limit });
  if (channel) params.set('channel', channel);
  if (contextType) params.set('contextType', contextType);
  if (status) params.set('status', status);
  const res = await adminRequests.get(`/communications/sms-logs?${params}`);
  return res.data;
};

export const sendTestSms = async (payload) => {
  const res = await adminRequests.post('/communications/test-sms', payload);
  return res.data;
};

export const listMpesaCollections = async (params = {}) => {
  const res = await adminRequests.get("/mpesa-collections", { params });
  return res.data;
};

export const deleteMpesaCollection = async (id, params = {}) => {
  const res = await adminRequests.delete(`/mpesa-collections/${id}`, { params });
  return res.data;
};

export const importMpesaBatch = async (payload = {}) => {
  const res = await adminRequests.post("/mpesa-collections/import-batch", payload);
  return res.data;
};

/* eslint-disable no-undef */
import {adminRequests} from "../utils/requestMethods"
// Track C item 3: this file is mid-decomposition into redux/apiCalls/*.js
// domain files, re-exported via the barrel at the bottom. Functions not yet
// moved still live here and share the same cache/helper primitives via
// ./apiCalls/shared.js (the one place `store` is imported across the split)
// rather than redefining them locally.
import { extractList } from "./apiCalls/shared";

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


// Create payment voucher (generic, for compatibility)
export const getJournalEntries = async (filters = {}) => {
  const params = new URLSearchParams();

  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.journalType && filters.journalType !== "all") params.append("journalType", filters.journalType);
  if (filters.propertyId && filters.propertyId !== "all") params.append("property", filters.propertyId);
  if (filters.landlordId && filters.landlordId !== "all") params.append("landlord", filters.landlordId);
  if (filters.sourceModule && filters.sourceModule !== "all") params.append("sourceModule", filters.sourceModule);
  if (filters.excludeSourceModules) params.append("excludeSourceModules", filters.excludeSourceModules);
  if (filters.startDate) params.append("startDate", filters.startDate);
  if (filters.endDate) params.append("endDate", filters.endDate);
  if (filters.search) params.append("search", filters.search);
  if (filters.page) params.append("page", filters.page);
  if (filters.limit) params.append("limit", filters.limit);

  const query = params.toString();
  const res = await adminRequests.get(`/journals${query ? `?${query}` : ""}`);
  return {
    data: extractList(res.data),
    total: res.data?.total ?? 0,
    page: res.data?.page ?? 1,
    pages: res.data?.pages ?? 1,
  };
};

export const createJournalEntry = async (journalData) => {
  const res = await adminRequests.post("/journals", journalData);
  return res.data;
};

export const updateJournalEntry = async (id, journalData) => {
  const res = await adminRequests.put(`/journals/${id}`, journalData);
  return res.data;
};

export const postJournalEntry = async (id, payload = {}) => {
  const res = await adminRequests.post(`/journals/${id}/post`, payload);
  return res.data;
};

export const reverseJournalEntry = async (id, payload = {}) => {
  const res = await adminRequests.post(`/journals/${id}/reverse`, payload);
  return res.data;
};

export const deleteJournalEntry = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);

  const query = params.toString();
  const res = await adminRequests.delete(`/journals/${id}${query ? `?${query}` : ""}`);
  return res.data;
};

// Financial Reports
export const getTrialBalanceReport = async (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/trial-balance${query ? `?${query}` : ""}`, { timeout: 120_000 });
  return res.data;
};

export const getIncomeStatementReport = async (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/income-statement${query ? `?${query}` : ""}`, { timeout: 120_000 });
  return res.data;
};

export const getBalanceSheetReport = async (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/balance-sheet${query ? `?${query}` : ""}`, { timeout: 120_000 });
  return res.data;
};

// ── Property Ledger ────────────────────────────────────────────────────────────
const buildPropertyLedgerQuery = (params) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") s.append(k, v); });
  return s.toString();
};

export const getPropertyLedgerTrialBalance = async (propertyId, params = {}) => {
  const q = buildPropertyLedgerQuery(params);
  const res = await adminRequests.get(`/property-ledger/${propertyId}/trial-balance${q ? `?${q}` : ""}`, { timeout: 60_000 });
  return res.data;
};

export const getPropertyLedgerIncomeStatement = async (propertyId, params = {}) => {
  const q = buildPropertyLedgerQuery(params);
  const res = await adminRequests.get(`/property-ledger/${propertyId}/income-statement${q ? `?${q}` : ""}`, { timeout: 60_000 });
  return res.data;
};

export const getPropertyLedgerBalanceSheet = async (propertyId, params = {}) => {
  const q = buildPropertyLedgerQuery(params);
  const res = await adminRequests.get(`/property-ledger/${propertyId}/balance-sheet${q ? `?${q}` : ""}`, { timeout: 60_000 });
  return res.data;
};

export const getPropertyLedgerJournals = async (propertyId, params = {}) => {
  const q = buildPropertyLedgerQuery(params);
  const res = await adminRequests.get(`/property-ledger/${propertyId}/journals${q ? `?${q}` : ""}`, { timeout: 60_000 });
  return res.data;
};

export const getPropertyInvoices = async (propertyId, params = {}) => {
  const s = new URLSearchParams();
  s.append("property", propertyId);
  Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") s.append(k, v); });
  const res = await adminRequests.get(`/tenant-invoices?${s.toString()}`);
  return { data: extractList(res.data), total: res.data?.total ?? 0, page: res.data?.page ?? 1, pages: res.data?.pages ?? 1 };
};

export const getPropertyReceipts = async (propertyId, params = {}) => {
  const s = new URLSearchParams();
  s.append("property", propertyId);
  Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") s.append(k, v); });
  const res = await adminRequests.get(`/rent-payments?${s.toString()}`);
  return { data: extractList(res.data), ...(res.data?.pagination || { totalItems: 0, totalPages: 1, page: 1 }) };
};

export const getPropertyStatements = async (propertyId, params = {}) => {
  const s = new URLSearchParams();
  s.append("propertyId", propertyId);
  Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") s.append(k, v); });
  const res = await adminRequests.get(`/statements?${s.toString()}`);
  return res.data?.data?.statements || extractList(res.data) || [];
};

export const getCashFlowReport = async (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") search.append(key, value);
  });
  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/cash-flow${query ? `?${query}` : ""}`, { timeout: 120_000 });
  return res.data;
};

export const getCashMonthlySummary = async (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") search.append(key, value);
  });
  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/cash-monthly-summary${query ? `?${query}` : ""}`, { timeout: 30_000 });
  return res.data;
};

export const getIncomeMonthlySummary = async (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") search.append(key, value);
  });
  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/income-monthly-summary${query ? `?${query}` : ""}`, { timeout: 30_000 });
  return res.data;
};

export const getARAgingReport = async (params = {}, signal) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") search.append(key, value);
  });
  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/ar-aging${query ? `?${query}` : ""}`, { timeout: 120_000, signal });
  return res.data;
};

export const getAPAgingReport = async (params = {}, signal) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") search.append(key, value);
  });
  const query = search.toString();
  const res = await adminRequests.get(`/financial-reports/ap-aging${query ? `?${query}` : ""}`, { timeout: 120_000, signal });
  return res.data;
};

// ─── Bank Reconciliation ──────────────────────────────────────────────────────
const buildQuery = (params) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") s.append(k, v); });
  return s.toString();
};

export const getBankReconciliationAccounts = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/bank-reconciliation/accounts${q ? `?${q}` : ""}`);
  return res.data;
};
export const getReconciliationEntries = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/bank-reconciliation/entries${q ? `?${q}` : ""}`);
  return res.data;
};
export const getReconciliations = async (params = {}) => {
  if (params.id) {
    const res = await adminRequests.get(`/bank-reconciliation/${params.id}`);
    return res.data;
  }
  const q = buildQuery(params);
  const res = await adminRequests.get(`/bank-reconciliation${q ? `?${q}` : ""}`);
  return res.data;
};
export const createReconciliation = async (data) => {
  const res = await adminRequests.post("/bank-reconciliation", data);
  return res.data;
};
export const saveReconciliation = async (id, data) => {
  const res = await adminRequests.put(`/bank-reconciliation/${id}`, data);
  return res.data;
};
export const finalizeReconciliation = async (id, data) => {
  const res = await adminRequests.post(`/bank-reconciliation/${id}/finalize`, data);
  return res.data;
};
export const deleteReconciliation = async (id, params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.delete(`/bank-reconciliation/${id}${q ? `?${q}` : ""}`);
  return res.data;
};

// ─── Budgets ──────────────────────────────────────────────────────────────────
export const getBudgets = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/budgets${q ? `?${q}` : ""}`);
  return res.data;
};
export const getBudget = async (id, params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/budgets/${id}${q ? `?${q}` : ""}`);
  return res.data;
};
export const createBudget = async (data) => {
  const res = await adminRequests.post("/budgets", data);
  return res.data;
};
export const updateBudget = async (id, data) => {
  const res = await adminRequests.put(`/budgets/${id}`, data);
  return res.data;
};
export const deleteBudget = async (id, params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.delete(`/budgets/${id}${q ? `?${q}` : ""}`);
  return res.data;
};

// ─── Fixed Assets ─────────────────────────────────────────────────────────────
export const getFixedAssets = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/fixed-assets${q ? `?${q}` : ""}`);
  return res.data;
};
export const getFixedAsset = async (id, params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/fixed-assets/${id}${q ? `?${q}` : ""}`);
  return res.data;
};
export const createFixedAsset = async (data) => {
  const res = await adminRequests.post("/fixed-assets", data);
  return res.data;
};
export const updateFixedAsset = async (id, data) => {
  const res = await adminRequests.put(`/fixed-assets/${id}`, data);
  return res.data;
};
export const disposeFixedAsset = async (id, data) => {
  const res = await adminRequests.post(`/fixed-assets/${id}/dispose`, data);
  return res.data;
};
export const previewDepreciation = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/fixed-assets/depreciation/preview${q ? `?${q}` : ""}`);
  return res.data;
};
export const runDepreciation = async (data) => {
  const res = await adminRequests.post("/fixed-assets/depreciation/run", data);
  return res.data;
};

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
// ─── ACCOUNTING PERIODS ───────────────────────────────────────────────────────
export const getAccountingPeriods = async (params = {}) => {
  const res = await adminRequests.get("/accounting-periods", { params });
  return res.data;
};

export const createAccountingPeriod = async (payload = {}) => {
  const res = await adminRequests.post("/accounting-periods", payload);
  return res.data;
};

export const updateAccountingPeriod = async (id, payload = {}) => {
  const res = await adminRequests.put(`/accounting-periods/${id}`, payload);
  return res.data;
};

export const closeAccountingPeriod = async (id) => {
  const res = await adminRequests.post(`/accounting-periods/${id}/close`);
  return res.data;
};

export const reopenAccountingPeriod = async (id) => {
  const res = await adminRequests.post(`/accounting-periods/${id}/reopen`);
  return res.data;
};

export const lockAccountingPeriod = async (id) => {
  const res = await adminRequests.post(`/accounting-periods/${id}/lock`);
  return res.data;
};

export const getAccountingPeriodStats = async (id) => {
  const res = await adminRequests.get(`/accounting-periods/${id}/stats`);
  return res.data;
};

// ─── JOURNAL APPROVAL ─────────────────────────────────────────────────────────
export const submitJournalForReview = async (id) => {
  const res = await adminRequests.post(`/journals/${id}/submit`);
  return res.data;
};

export const reviewJournalEntry = async (id) => {
  const res = await adminRequests.post(`/journals/${id}/review`);
  return res.data;
};

export const approveJournalEntry = async (id) => {
  const res = await adminRequests.post(`/journals/${id}/approve`);
  return res.data;
};

export const rejectJournalEntry = async (id, payload = {}) => {
  const res = await adminRequests.post(`/journals/${id}/reject`, payload);
  return res.data;
};

// ─── GL INTEGRITY & HEALTH CENTRE ────────────────────────────────────────────
export const runGLIntegrityReport = async (params = {}) => {
  const res = await adminRequests.get("/ledger/diagnostics/integrity-report", { params });
  return res.data;
};
export const getGLHealthHistory = async (params = {}) => {
  const res = await adminRequests.get("/ledger/health-history", { params });
  return res.data;
};
export const repairBalanceGroup = async (groupId, data) => {
  const res = await adminRequests.post(`/ledger/repair/balance-group/${groupId}`, data);
  return res.data;
};
export const repairClearAbnormalBalance = async (data) => {
  const res = await adminRequests.post("/ledger/repair/clear-abnormal-balance", data);
  return res.data;
};
export const reverseGlCorrectionEntry = async (groupId, data) => {
  const res = await adminRequests.post(`/ledger/repair/reverse-correction/${groupId}`, data);
  return res.data;
};
export const apiVoidReversedCorrections = async (data) => {
  const res = await adminRequests.post("/ledger/repair/void-reversed-corrections", data);
  return res.data;
};
export const apiVoidOrphanedJournalGroup = async (groupId, data) => {
  const res = await adminRequests.post(`/ledger/repair/void-orphaned-group/${groupId}`, data);
  return res.data;
};
export const getActiveGlCorrections = async (params) => {
  const res = await adminRequests.get("/ledger/repair/active-corrections", { params });
  return res.data;
};
export const getGlGroupEntries = async (groupId, params) => {
  const res = await adminRequests.get(`/ledger/repair/group-entries/${groupId}`, { params });
  return res.data;
};
export const repairRecomputeBalances = async (data) => {
  const res = await adminRequests.post("/ledger/repair/recompute-balances", data);
  return res.data;
};
export const repairRepostInvoices = async (data) => {
  const res = await adminRequests.post("/ledger/repair/repost-invoices", data);
  return res.data;
};

// ─── TRIAL BALANCE EXCEPTIONS ─────────────────────────────────────────────────
export const getTrialBalanceExceptions = async (params = {}) => {
  const res = await adminRequests.get("/financial-reports/trial-balance-exceptions", { params });
  return res.data;
};

// ─── FINANCIAL RATIOS ─────────────────────────────────────────────────────────
export const getFinancialRatios = async (params = {}) => {
  const res = await adminRequests.get("/financial-reports/financial-ratios", { params });
  return res.data;
};

// ─── LIABILITY SUB-LEDGER ─────────────────────────────────────────────────────
export const getLiabilitySubledger = async (params = {}) => {
  const res = await adminRequests.get("/financial-reports/liability-subledger", { params });
  return res.data;
};

// ─── YEAR-END CLOSE ───────────────────────────────────────────────────────────
export const performYearEndClose = async (payload = {}) => {
  const res = await adminRequests.post("/financial-reports/year-end-close", payload);
  return res.data;
};

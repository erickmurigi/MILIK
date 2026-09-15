/* eslint-disable no-undef */
import {adminRequests} from "../utils/requestMethods"
// Track C item 3: this file is mid-decomposition into redux/apiCalls/*.js
// domain files, re-exported via the barrel at the bottom. Functions not yet
// moved still live here and share the same cache/helper primitives via
// ./apiCalls/shared.js (the one place `store` is imported across the split)
// rather than redefining them locally.
import { extractList, resolveCompanyId, resolveLandlordIdFromProperty } from "./apiCalls/shared";

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

import {
  getStatementsStart,
  getStatementsSuccess,
  getStatementsFailure,
  getStatementStart,
  getStatementSuccess,
  getStatementFailure,
  createDraftStart,
  createDraftSuccess,
  createDraftFailure,
  approveStart,
  approveSuccess,
  approveFailure,
  sendStart,
  sendSuccess,
  sendFailure,
  createRevisionStart,
  createRevisionSuccess,
  createRevisionFailure,
  deleteDraftStart,
  deleteDraftSuccess,
  deleteDraftFailure,
  validateAuditStart,
  validateAuditSuccess,
  validateAuditFailure,
} from "../redux/statementsRedux";



// Create payment voucher (generic, for compatibility)
export const createPaymentVoucher = async (voucherData) => {
  // Use the same endpoint as createLandlordPayment
  const res = await adminRequests.post("/payment-vouchers", voucherData);
  return res.data;
};

// ========== LANDLORDS SECTION ==========

// Get all landlords
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

// ========== LANDLORD PAYMENTS SECTION ========== 
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

export const getExpenseRequisitions = async (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.propertyId && filters.propertyId !== "all") params.append("property", filters.propertyId);
  if (filters.serviceProviderId && filters.serviceProviderId !== "all") params.append("serviceProvider", filters.serviceProviderId);
  if (filters.search) params.append("search", filters.search);
  const res = await adminRequests.get(`/expense-requisitions${params.toString() ? `?${params.toString()}` : ""}`);
  return extractList(res.data);
};

export const createExpenseRequisition = async (payload) => {
  const res = await adminRequests.post("/expense-requisitions", payload);
  return res.data;
};

export const updateExpenseRequisition = async (id, payload) => {
  const res = await adminRequests.put(`/expense-requisitions/${id}`, payload);
  return res.data;
};

export const updateExpenseRequisitionStatus = async (id, payload) => {
  const res = await adminRequests.put(`/expense-requisitions/${id}/status`, payload);
  return res.data;
};

export const batchDeleteExpenseRequisitions = async (ids, context = {}) => {
  const res = await adminRequests.post("/expense-requisitions/batch-delete", {
    ids,
    business: context.business,
    company: context.company,
  });
  return res.data;
};

export const deleteExpenseRequisition = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);
  const res = await adminRequests.delete(`/expense-requisitions/${id}${params.toString() ? `?${params.toString()}` : ""}`);
  return res.data;
};

export const getServiceProviders = async (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (typeof filters.active === 'boolean') params.append("active", String(filters.active));
  if (filters.search) params.append("search", filters.search);
  if (filters.page) params.append("page", filters.page);
  if (filters.limit) params.append("limit", filters.limit);
  const res = await adminRequests.get(`/service-providers${params.toString() ? `?${params.toString()}` : ""}`);
  return {
    data: extractList(res.data),
    total: res.data?.total ?? 0,
    page: res.data?.page ?? 1,
    pages: res.data?.pages ?? 1,
  };
};

export const createServiceProvider = async (payload) => {
  const res = await adminRequests.post("/service-providers", payload);
  return res.data;
};

export const updateServiceProvider = async (id, payload) => {
  const res = await adminRequests.put(`/service-providers/${id}`, payload);
  return res.data;
};

export const deleteServiceProvider = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);
  const res = await adminRequests.delete(`/service-providers/${id}${params.toString() ? `?${params.toString()}` : ""}`);
  return res.data;
};

// ─── Creditor Ledger ──────────────────────────────────────────────────────────
export const getCreditorsSummary = async (params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/service-providers/creditors/summary${q ? `?${q}` : ""}`);
  return extractList(res.data);
};
export const getCreditorStatement = async (id, params = {}) => {
  const q = buildQuery(params);
  const res = await adminRequests.get(`/service-providers/creditors/${id}/statement${q ? `?${q}` : ""}`);
  return res.data;
};

export const getLandlordStandingOrders = async (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.landlordId && filters.landlordId !== "all") params.append("landlord", filters.landlordId);
  if (filters.propertyId && filters.propertyId !== "all") params.append("property", filters.propertyId);
  if (filters.search) params.append("search", filters.search);
  if (filters.page) params.append("page", filters.page);
  if (filters.limit) params.append("limit", filters.limit);
  const res = await adminRequests.get(`/landlord-standing-orders${params.toString() ? `?${params.toString()}` : ""}`);
  return { data: extractList(res.data), total: res.data?.total ?? 0, page: res.data?.page ?? 1, pages: res.data?.pages ?? 1 };
};

export const createLandlordStandingOrder = async (payload) => {
  const res = await adminRequests.post("/landlord-standing-orders", payload);
  return res.data;
};

export const updateLandlordStandingOrder = async (id, payload) => {
  const res = await adminRequests.put(`/landlord-standing-orders/${id}`, payload);
  return res.data;
};

export const updateLandlordStandingOrderStatus = async (id, payload) => {
  const res = await adminRequests.put(`/landlord-standing-orders/${id}/status`, payload);
  return res.data;
};

export const runLandlordStandingOrder = async (id, payload) => {
  const res = await adminRequests.post(`/landlord-standing-orders/${id}/run`, payload);
  return res.data;
};

export const runLandlordStandingOrdersBatch = async (items, context = {}) => {
  const res = await adminRequests.post("/landlord-standing-orders/batch-run", {
    items,
    business: context.business,
    company: context.company,
  });
  return res.data;
};

export const reverseLandlordStandingOrderRun = async (id, runId, payload) => {
  const res = await adminRequests.post(`/landlord-standing-orders/${id}/runs/${runId}/reverse`, payload);
  return res.data;
};

export const deleteLandlordStandingOrder = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);
  const res = await adminRequests.delete(`/landlord-standing-orders/${id}${params.toString() ? `?${params.toString()}` : ""}`);
  return res.data;
};

export const getLandlordAdvancements = async (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.business) params.append("business", filters.business);
  if (filters.company) params.append("company", filters.company);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  if (filters.landlordId && filters.landlordId !== "all") params.append("landlord", filters.landlordId);
  if (filters.propertyId && filters.propertyId !== "all") params.append("property", filters.propertyId);
  if (filters.advanceType && filters.advanceType !== "all") params.append("advanceType", filters.advanceType);
  if (filters.search) params.append("search", filters.search);
  if (filters.page) params.append("page", filters.page);
  if (filters.limit) params.append("limit", filters.limit);
  const res = await adminRequests.get(`/landlord-advancements${params.toString() ? `?${params.toString()}` : ""}`);
  return { data: extractList(res.data), total: res.data?.total ?? 0, page: res.data?.page ?? 1, pages: res.data?.pages ?? 1 };
};

export const createLandlordAdvancement = async (payload) => {
  const res = await adminRequests.post("/landlord-advancements", payload);
  return res.data;
};

export const updateLandlordAdvancement = async (id, payload) => {
  const res = await adminRequests.put(`/landlord-advancements/${id}`, payload);
  return res.data;
};

export const updateLandlordAdvancementStatus = async (id, payload) => {
  const res = await adminRequests.put(`/landlord-advancements/${id}/status`, payload);
  return res.data;
};

export const processLandlordAdvancementRecovery = async (id, payload) => {
  const res = await adminRequests.post(`/landlord-advancements/${id}/recover`, payload);
  return res.data;
};

export const cancelLandlordAdvancementRecovery = async (id, recoveryId, payload = {}) => {
  const res = await adminRequests.post(`/landlord-advancements/${id}/recoveries/${recoveryId}/cancel`, payload);
  return res.data;
};

export const deleteLandlordAdvancement = async (id, context = {}) => {
  const params = new URLSearchParams();
  if (context.business) params.append("business", context.business);
  if (context.company) params.append("company", context.company);
  const res = await adminRequests.delete(`/landlord-advancements/${id}${params.toString() ? `?${params.toString()}` : ""}`);
  return res.data;
};




// Get all maintenances
export const getStatements = (filters = {}) => async (dispatch) => {
  dispatch(getStatementsStart());
  try {
    if (!filters.landlordId && !filters.propertyId) {
      dispatch(getStatementsSuccess([]));
      return [];
    }

    const queryParams = new URLSearchParams();
    if (filters.landlordId) queryParams.append('landlordId', filters.landlordId);
    if (filters.propertyId) queryParams.append('propertyId', filters.propertyId);
    if (filters.status) queryParams.append('status', filters.status);
    if (filters.periodStart) queryParams.append('periodStart', filters.periodStart);
    if (filters.periodEnd) queryParams.append('periodEnd', filters.periodEnd);
    
    const res = await adminRequests.get(`/statements?${queryParams.toString()}`);
    const statements = res.data?.data?.statements || [];
    dispatch(getStatementsSuccess(statements));
    return statements;
  } catch (err) {
    dispatch(getStatementsFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Get single statement with lines
export const getStatement = (statementId) => async (dispatch) => {
  dispatch(getStatementStart());
  try {
    const res = await adminRequests.get(`/statements/${statementId}?populateRefs=true&includeLines=true`);
    const payload = {
      statement: res.data?.data?.statement || null,
      lines: res.data?.data?.lines || [],
    };
    dispatch(getStatementSuccess(payload));
    return payload;
  } catch (err) {
    dispatch(getStatementFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Create draft statement
export const createDraftStatement = (payload) => async (dispatch, getState) => {
  dispatch(createDraftStart());
  try {
    const { _signal, ...rest } = payload || {};
    const resolvedPayload = {
      ...rest,
      businessId: rest?.businessId || resolveCompanyId(rest, getState),
      landlordId: rest?.landlordId || resolveLandlordIdFromProperty(rest?.propertyId, getState),
    };

    const res = await adminRequests.post("/statements/draft", resolvedPayload, {
      ...(_signal ? { signal: _signal } : {}),
    });
    const statement = res.data?.data?.statement;
    const lines = res.data?.data?.lines || [];
    dispatch(createDraftSuccess(statement));
    return { statement, lines };
  } catch (err) {
    dispatch(createDraftFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Approve statement (makes it immutable)
export const approveStatement = (statementId, approvalNotes = '') => async (dispatch) => {
  dispatch(approveStart());
  try {
    const res = await adminRequests.post(`/statements/${statementId}/approve`, { approvalNotes });
    const statement = res.data?.data?.statement;
    dispatch(approveSuccess(statement));
    return statement;
  } catch (err) {
    dispatch(approveFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Send statement (mark as sent)
export const sendStatement = (statementId) => async (dispatch) => {
  dispatch(sendStart());
  try {
    const res = await adminRequests.post(`/statements/${statementId}/send`);
    const statement = res.data?.data?.statement;
    dispatch(sendSuccess(statement));
    return statement;
  } catch (err) {
    dispatch(sendFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Create revision of existing statement
export const createStatementRevision = (statementId, revisionReason) => async (dispatch) => {
  dispatch(createRevisionStart());
  try {
    const res = await adminRequests.post(`/statements/${statementId}/revise`, { revisionReason });
    const payload = {
      newStatement: res.data?.data?.newStatement,
      originalStatement: res.data?.data?.originalStatement,
    };
    dispatch(createRevisionSuccess(payload));
    return payload;
  } catch (err) {
    dispatch(createRevisionFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Delete draft statement
export const deleteDraftStatement = (statementId) => async (dispatch) => {
  dispatch(deleteDraftStart());
  try {
    await adminRequests.delete(`/statements/${statementId}`);
    dispatch(deleteDraftSuccess(statementId));
    return true;
  } catch (err) {
    dispatch(deleteDraftFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Validate statement audit
export const validateStatementAudit = (statementId) => async (dispatch) => {
  dispatch(validateAuditStart());
  try {
    const res = await adminRequests.get(`/statements/${statementId}/validate`);
    const auditData = res.data?.data || {};
    dispatch(validateAuditSuccess(auditData));
    return auditData;
  } catch (err) {
    dispatch(validateAuditFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Download statement PDF
export const downloadStatementPdf = async (statementId) => {
  try {
    const res = await adminRequests.get(`/statements/${statementId}/pdf`, {
      responseType: 'blob'
    });
    
    // Create blob URL and trigger download
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `statement-${statementId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    
    return true;
  } catch (err) {
    throw err;
  }
};

// Get notification stats
export const getDashboardSummary = async (business) => {
  try {
    const res = await adminRequests.get(`/dashboard/summary?business=${business}`);
    return res.data;
  } catch (err) {
    throw err;
  }
};

// ========== JOURNAL ENTRIES SECTION ==========

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
export const reverseLandlordPayment = async (paymentId, payload = {}) => {
  const res = await adminRequests.post(`/landlord-payments/${paymentId}/reverse`, payload);
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

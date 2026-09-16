import { adminRequests } from "../../utils/requestMethods";

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

import { adminRequests } from "../../utils/requestMethods";

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

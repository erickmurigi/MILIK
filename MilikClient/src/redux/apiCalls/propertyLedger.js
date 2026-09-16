import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

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

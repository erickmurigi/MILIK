import { adminRequests } from "../utils/requestMethods";

const unwrap = (response) => response?.data?.data ?? response?.data;

export const carWashApi = {
  getDailySummary: async (date) => unwrap(await adminRequests.get("/carwash/reports/daily-summary", { params: { date } })),
  getWeeklySummary: async (date) => unwrap(await adminRequests.get("/carwash/reports/weekly-summary", { params: { date } })),
  getMonthlySummary: async (month) => unwrap(await adminRequests.get("/carwash/reports/monthly-summary", { params: { month } })),
  listJobs: async (params = {}) => unwrap(await adminRequests.get("/carwash/jobs", { params })),
  createJob: async (payload) => unwrap(await adminRequests.post("/carwash/jobs", payload)),
  updateJob: async (id, payload) => unwrap(await adminRequests.put(`/carwash/jobs/${id}`, payload)),
  updateJobStatus: async (id, status) => unwrap(await adminRequests.patch(`/carwash/jobs/${id}/status`, { status })),
  deleteJob: async (id) => unwrap(await adminRequests.delete(`/carwash/jobs/${id}`)),
  deleteJobs: async (ids) => unwrap(await adminRequests.post("/carwash/jobs/bulk-delete", { ids })),
  listServices: async (params = {}) => unwrap(await adminRequests.get("/carwash/services", { params })),
  createService: async (payload) => unwrap(await adminRequests.post("/carwash/services", payload)),
  updateService: async (id, payload) => unwrap(await adminRequests.put(`/carwash/services/${id}`, payload)),
  deleteService: async (id) => unwrap(await adminRequests.delete(`/carwash/services/${id}`)),
  listPayments: async (params = {}) => unwrap(await adminRequests.get("/carwash/payments", { params })),
  recordPayment: async (payload) => unwrap(await adminRequests.post("/carwash/payments", payload)),
  updatePaymentReconciliation: async (id, payload) => unwrap(await adminRequests.patch(`/carwash/payments/${id}/reconciliation`, payload)),
  listDeposits: async (params = {}) => unwrap(await adminRequests.get("/carwash/deposits", { params })),
  createDeposit: async (payload) => unwrap(await adminRequests.post("/carwash/deposits", payload)),
  updateDepositStatus: async (id, payload) => unwrap(await adminRequests.patch(`/carwash/deposits/${id}/status`, payload)),
  listExpenses: async (params = {}) => unwrap(await adminRequests.get("/carwash/expenses", { params })),
  createExpense: async (payload) => unwrap(await adminRequests.post("/carwash/expenses", payload)),
  updateExpenseStatus: async (id, payload) => unwrap(await adminRequests.patch(`/carwash/expenses/${id}/status`, payload)),
  listChartOfAccounts: async (params = {}) => unwrap(await adminRequests.get("/chart-of-accounts", { params })),
  createChartAccount: async (payload) => unwrap(await adminRequests.post("/chart-of-accounts", payload)),
  updateChartAccount: async (id, payload) => unwrap(await adminRequests.put(`/chart-of-accounts/${id}`, payload)),
  deleteChartAccount: async (id, payload = {}) => unwrap(await adminRequests.delete(`/chart-of-accounts/${id}`, { data: payload })),
  getChartAccountActivity: async (id, params = {}) => unwrap(await adminRequests.get(`/chart-of-accounts/${id}/activity`, { params })),
  listStaff: async (params = {}) => unwrap(await adminRequests.get("/carwash/staff", { params })),
  createStaff: async (payload) => unwrap(await adminRequests.post("/carwash/staff", payload)),
  updateStaff: async (id, payload) => unwrap(await adminRequests.put(`/carwash/staff/${id}`, payload)),
  deleteStaff: async (id) => unwrap(await adminRequests.delete(`/carwash/staff/${id}`)),
  listCommissionRules: async (params = {}) => unwrap(await adminRequests.get("/carwash/commissions/rules", { params })),
  createCommissionRule: async (payload) => unwrap(await adminRequests.post("/carwash/commissions/rules", payload)),
  updateCommissionRule: async (id, payload) => unwrap(await adminRequests.put(`/carwash/commissions/rules/${id}`, payload)),
  listCommissions: async (params = {}) => unwrap(await adminRequests.get("/carwash/commissions", { params })),
  listCommissionPayouts: async (params = {}) => unwrap(await adminRequests.get("/carwash/commissions/payouts", { params })),
  createCommissionPayout: async (payload) => unwrap(await adminRequests.post("/carwash/commissions/payouts", payload)),
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const formatMoney = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

export const normalizeListPayload = (payload, key) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

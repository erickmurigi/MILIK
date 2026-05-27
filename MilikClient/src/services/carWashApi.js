import { adminRequests } from "../utils/requestMethods";

const unwrap = (response) => response?.data?.data ?? response?.data;

export const getActiveBranchId = () => {
  try {
    const user = JSON.parse(localStorage.getItem("milik_user") || "null");
    const activeCompanyId = localStorage.getItem("milik_active_company_id") || "";
    if (!user || !activeCompanyId) return "";
    const assignments = Array.isArray(user.companyAssignments) ? user.companyAssignments : [];
    const assignment = assignments.find((a) => String(a?.company?._id || a?.company || "") === activeCompanyId);
    return assignment?.carwashBranch || "";
  } catch {
    return "";
  }
};

const bp = (params = {}) => params;
const bb = (body = {}) => body;

export const carWashApi = {
  getDailySummary: async (date) => unwrap(await adminRequests.get("/carwash/reports/daily-summary", { params: bp({ date }) })),
  getWeeklySummary: async (date) => unwrap(await adminRequests.get("/carwash/reports/weekly-summary", { params: bp({ date }) })),
  getMonthlySummary: async (month) => unwrap(await adminRequests.get("/carwash/reports/monthly-summary", { params: bp({ month }) })),
  getServiceReport: async (params = {}) => unwrap(await adminRequests.get("/carwash/reports/service-report", { params: bp(params) })),
  getStaffReport: async (params = {}) => unwrap(await adminRequests.get("/carwash/reports/staff-report", { params: bp(params) })),
  listLedgerEntries: async (params = {}) => unwrap(await adminRequests.get("/carwash/reports/ledger", { params: bp(params) })),
  listJobs: async (params = {}) => unwrap(await adminRequests.get("/carwash/jobs", { params: bp(params) })),
  createJob: async (payload) => unwrap(await adminRequests.post("/carwash/jobs", bb(payload))),
  updateJob: async (id, payload) => unwrap(await adminRequests.put(`/carwash/jobs/${id}`, payload)),
  updateJobStatus: async (id, status) => unwrap(await adminRequests.patch(`/carwash/jobs/${id}/status`, { status })),
  deleteJob: async (id) => unwrap(await adminRequests.delete(`/carwash/jobs/${id}`)),
  deleteJobs: async (ids) => unwrap(await adminRequests.post("/carwash/jobs/bulk-delete", { ids })),
  listServices: async (params = {}) => unwrap(await adminRequests.get("/carwash/services", { params })),
  listServiceCategories: async () => unwrap(await adminRequests.get("/carwash/services/categories")),
  createService: async (payload) => unwrap(await adminRequests.post("/carwash/services", payload)),
  updateService: async (id, payload) => unwrap(await adminRequests.put(`/carwash/services/${id}`, payload)),
  deleteService: async (id) => unwrap(await adminRequests.delete(`/carwash/services/${id}`)),
  listPayments: async (params = {}) => unwrap(await adminRequests.get("/carwash/payments", { params: bp(params) })),
  recordPayment: async (payload) => unwrap(await adminRequests.post("/carwash/payments", bb(payload))),
  updatePaymentReconciliation: async (id, payload) => unwrap(await adminRequests.patch(`/carwash/payments/${id}/reconciliation`, payload)),
  listDeposits: async (params = {}) => unwrap(await adminRequests.get("/carwash/deposits", { params: bp(params) })),
  createDeposit: async (payload) => unwrap(await adminRequests.post("/carwash/deposits", bb(payload))),
  updateDepositStatus: async (id, payload) => unwrap(await adminRequests.patch(`/carwash/deposits/${id}/status`, payload)),
  listExpenses: async (params = {}) => unwrap(await adminRequests.get("/carwash/expenses", { params: bp(params) })),
  createExpense: async (payload) => unwrap(await adminRequests.post("/carwash/expenses", bb(payload))),
  updateExpenseStatus: async (id, payload) => unwrap(await adminRequests.patch(`/carwash/expenses/${id}/status`, payload)),
  listChartOfAccounts: async (params = {}) => unwrap(await adminRequests.get("/chart-of-accounts", { params })),
  createChartAccount: async (payload) => unwrap(await adminRequests.post("/chart-of-accounts", payload)),
  updateChartAccount: async (id, payload) => unwrap(await adminRequests.put(`/chart-of-accounts/${id}`, payload)),
  deleteChartAccount: async (id, payload = {}) => unwrap(await adminRequests.delete(`/chart-of-accounts/${id}`, { data: payload })),
  getChartAccountActivity: async (id, params = {}) => unwrap(await adminRequests.get(`/chart-of-accounts/${id}/activity`, { params })),
  listStaff: async (params = {}) => unwrap(await adminRequests.get("/carwash/staff", { params: bp(params) })),
  createStaff: async (payload) => unwrap(await adminRequests.post("/carwash/staff", bb(payload))),
  updateStaff: async (id, payload) => unwrap(await adminRequests.put(`/carwash/staff/${id}`, payload)),
  deleteStaff: async (id) => unwrap(await adminRequests.delete(`/carwash/staff/${id}`)),
  listBranches: async (params = {}) => unwrap(await adminRequests.get("/carwash/branches", { params })),
  createBranch: async (payload) => unwrap(await adminRequests.post("/carwash/branches", payload)),
  updateBranch: async (id, payload) => unwrap(await adminRequests.put(`/carwash/branches/${id}`, payload)),
  deleteBranch: async (id) => unwrap(await adminRequests.delete(`/carwash/branches/${id}`)),
  listCommissionRules: async (params = {}) => unwrap(await adminRequests.get("/carwash/commissions/rules", { params })),
  createCommissionRule: async (payload) => unwrap(await adminRequests.post("/carwash/commissions/rules", payload)),
  updateCommissionRule: async (id, payload) => unwrap(await adminRequests.put(`/carwash/commissions/rules/${id}`, payload)),
  listCommissions: async (params = {}) => unwrap(await adminRequests.get("/carwash/commissions", { params })),
  listCommissionPayouts: async (params = {}) => unwrap(await adminRequests.get("/carwash/commissions/payouts", { params })),
  createCommissionPayout: async (payload) => unwrap(await adminRequests.post("/carwash/commissions/payouts", bb(payload))),
  // Loyalty
  getLoyaltyProgram: async () => unwrap(await adminRequests.get("/carwash/loyalty/program")),
  saveLoyaltyProgram: async (payload) => unwrap(await adminRequests.post("/carwash/loyalty/program", payload)),
  lookupPlate: async (plate) => unwrap(await adminRequests.get(`/carwash/loyalty/plate/${encodeURIComponent(plate)}`)),
  listLoyaltyCustomers: async (params = {}) => unwrap(await adminRequests.get("/carwash/loyalty/customers", { params })),
  registerLoyaltyCustomer: async (payload) => unwrap(await adminRequests.post("/carwash/loyalty/customers", payload)),
  updateLoyaltyCustomer: async (id, payload) => unwrap(await adminRequests.put(`/carwash/loyalty/customers/${id}`, payload)),
  getCustomerCard: async (customerId) => unwrap(await adminRequests.get(`/carwash/loyalty/customers/${customerId}/card`)),
  redeemLoyaltyReward: async (jobId) => unwrap(await adminRequests.patch(`/carwash/loyalty/jobs/${jobId}/redeem`)),
  sendJobSms: async (jobId, payload) => unwrap(await adminRequests.post(`/carwash/jobs/${jobId}/sms`, payload)),
  sendCustomerSms: async (customerId, payload) => unwrap(await adminRequests.post(`/carwash/loyalty/customers/${customerId}/sms`, payload)),
  sendPaymentSms: async (paymentId, payload) => unwrap(await adminRequests.post(`/carwash/payments/${paymentId}/sms`, payload)),
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

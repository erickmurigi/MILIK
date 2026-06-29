import { adminRequests } from "../utils/requestMethods";

const unwrap = (response) => response?.data?.data ?? response?.data;

export const VEHICLE_TYPES = [
  "Sedan / Saloon",
  "Hatchback",
  "SUV",
  "Mini SUV / Crossover",
  "Van / Minivan",
  "Pickup / 4x4",
  "Motorbike / Bike",
  "Tuk-tuk",
  "Bus / Matatu",
];

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
  backfillPaymentLedger: async () => unwrap(await adminRequests.post("/carwash/reports/ledger/backfill")),
  repairLedger: async () => unwrap(await adminRequests.post("/carwash/reports/ledger/repair")),
  listJobs: async (params = {}) => unwrap(await adminRequests.get("/carwash/jobs", { params: bp(params) })),
  getJob: async (id) => unwrap(await adminRequests.get(`/carwash/jobs/${id}`)),
  downloadJobPdf: async (id) => (await adminRequests.get(`/carwash/jobs/${id}/pdf`, { responseType: "arraybuffer" })).data,
  createJob: async (payload) => unwrap(await adminRequests.post("/carwash/jobs", bb(payload))),
  updateJob: async (id, payload) => unwrap(await adminRequests.put(`/carwash/jobs/${id}`, payload)),
  updateJobStatus: async (id, status) => unwrap(await adminRequests.patch(`/carwash/jobs/${id}/status`, { status })),
  markPayLater:   async (id)         => unwrap(await adminRequests.patch(`/carwash/jobs/${id}/paylater`)),
  deleteJob: async (id) => unwrap(await adminRequests.delete(`/carwash/jobs/${id}`)),
  deleteJobs: async (ids) => unwrap(await adminRequests.post("/carwash/jobs/bulk-delete", { ids })),
  listServices: async (params = {}) => unwrap(await adminRequests.get("/carwash/services", { params })),
  listServiceCategories: async () => unwrap(await adminRequests.get("/carwash/services/categories")),
  createService: async (payload) => unwrap(await adminRequests.post("/carwash/services", payload)),
  updateService: async (id, payload) => unwrap(await adminRequests.put(`/carwash/services/${id}`, payload)),
  deleteService: async (id) => unwrap(await adminRequests.delete(`/carwash/services/${id}`)),
  listPayments: async (params = {}) => unwrap(await adminRequests.get("/carwash/payments", { params: bp(params) })),
  recordPayment: async (payload) => unwrap(await adminRequests.post("/carwash/payments", bb(payload))),
  deletePayment: async (id) => unwrap(await adminRequests.delete(`/carwash/payments/${id}`)),
  initiateStkPush: async (payload) => unwrap(await adminRequests.post("/carwash/payments/stk-push", payload)),
  listMpesaNotifications: async (params = {}) => unwrap(await adminRequests.get("/carwash/mpesa/notifications", { params: bp(params) })),
  reassignMpesaNotification: async (id, jobId) => unwrap(await adminRequests.patch(`/carwash/mpesa/notifications/${id}/reassign`, { jobId })),
  listUnpaidJobs: async () => unwrap(await adminRequests.get("/carwash/mpesa/unpaid-jobs")),
  allocateMpesaPayment: async (id, payload) => unwrap(await adminRequests.post(`/carwash/mpesa/notifications/${id}/allocate`, payload)),
  uploadMpesaStatement: async (formData) => unwrap(await adminRequests.post("/carwash/mpesa/bulk-upload", formData)),
  markMpesaNotificationReversed: async (id, payload) => unwrap(await adminRequests.patch(`/carwash/mpesa/notifications/${id}/reverse`, payload)),
  registerMpesaUrls: async (shortCode) => unwrap(await adminRequests.post("/carwash/mpesa/register-urls", { shortCode })),
  updatePaymentReconciliation: async (id, payload) => unwrap(await adminRequests.patch(`/carwash/payments/${id}/reconciliation`, payload)),
  listDeposits: async (params = {}) => unwrap(await adminRequests.get("/carwash/deposits", { params: bp(params) })),
  createDeposit: async (payload) => unwrap(await adminRequests.post("/carwash/deposits", bb(payload))),
  updateDepositStatus: async (id, payload) => unwrap(await adminRequests.patch(`/carwash/deposits/${id}/status`, payload)),
  listExpenses: async (params = {}) => unwrap(await adminRequests.get("/carwash/expenses", { params: bp(params) })),
  createExpense: async (payload) => unwrap(await adminRequests.post("/carwash/expenses", bb(payload))),
  updateExpense: async (id, payload) => unwrap(await adminRequests.put(`/carwash/expenses/${id}`, bb(payload))),
  updateExpenseStatus: async (id, payload) => unwrap(await adminRequests.patch(`/carwash/expenses/${id}/status`, payload)),
  deleteExpense: async (id) => unwrap(await adminRequests.delete(`/carwash/expenses/${id}`)),
  getExpenseCategories: async () => unwrap(await adminRequests.get("/carwash/expenses/categories")),
  updateExpenseCategories: async (categories) => unwrap(await adminRequests.put("/carwash/expenses/categories", { categories })),
  getExpensesReport: async (params = {}) => unwrap(await adminRequests.get("/carwash/expenses/report", { params: bp(params) })),
  listChartOfAccounts: async (params = {}) => unwrap(await adminRequests.get("/chart-of-accounts", { params })),
  listCashbooks: async () => unwrap(await adminRequests.get("/chart-of-accounts", { params: { type: "asset", moduleScope: "carwash", search: "Cashbooks" } })),
  getCarWashSettings: async () => unwrap(await adminRequests.get("/carwash/settings")),
  updateCarWashSettings: async (payload) => unwrap(await adminRequests.put("/carwash/settings", payload)),
  uploadQueueBgImage: async (file) => {
    const form = new FormData();
    form.append("image", file);
    return unwrap(await adminRequests.post("/carwash/settings/queue-bg-image", form, { headers: { "Content-Type": "multipart/form-data" } }));
  },
  backfillBranches: async () => unwrap(await adminRequests.post("/carwash/settings/backfill-branches")),
  createChartAccount: async (payload) => unwrap(await adminRequests.post("/chart-of-accounts", payload)),
  updateChartAccount: async (id, payload) => unwrap(await adminRequests.put(`/chart-of-accounts/${id}`, payload)),
  deleteChartAccount: async (id, payload = {}) => unwrap(await adminRequests.delete(`/chart-of-accounts/${id}`, { data: payload })),
  getChartAccountActivity: async (id, params = {}) => unwrap(await adminRequests.get(`/chart-of-accounts/${id}/activity`, { params })),
  listStaff: async (params = {}) => unwrap(await adminRequests.get("/carwash/staff", { params: bp(params) })),
  createStaff: async (payload) => unwrap(await adminRequests.post("/carwash/staff", bb(payload))),
  updateStaff: async (id, payload) => unwrap(await adminRequests.put(`/carwash/staff/${id}`, payload)),
  deleteStaff: async (id) => unwrap(await adminRequests.delete(`/carwash/staff/${id}`)),
  listBranches: async (params = {}) => unwrap(await adminRequests.get("/carwash/branches", { params })),
  getActiveBranch: async () => unwrap(await adminRequests.get("/carwash/branches/active")),
  getBranch: async (id) => unwrap(await adminRequests.get(`/carwash/branches/${id}`)),
  createBranch: async (payload) => unwrap(await adminRequests.post("/carwash/branches", payload)),
  updateBranch: async (id, payload) => unwrap(await adminRequests.put(`/carwash/branches/${id}`, payload)),
  deleteBranch: async (id) => unwrap(await adminRequests.delete(`/carwash/branches/${id}`)),
  listCommissionRules: async (params = {}) => unwrap(await adminRequests.get("/carwash/commissions/rules", { params })),
  createCommissionRule: async (payload) => unwrap(await adminRequests.post("/carwash/commissions/rules", payload)),
  updateCommissionRule: async (id, payload) => unwrap(await adminRequests.put(`/carwash/commissions/rules/${id}`, payload)),
  listCommissions: async (params = {}) => unwrap(await adminRequests.get("/carwash/commissions", { params })),
  reverseCommission: async (id, notes = "") => unwrap(await adminRequests.post(`/carwash/commissions/${id}/reverse`, { notes })),
  listCommissionPayouts: async (params = {}) => unwrap(await adminRequests.get("/carwash/commissions/payouts", { params })),
  createCommissionPayout: async (payload) => unwrap(await adminRequests.post("/carwash/commissions/payouts", bb(payload))),
  reverseCommissionPayout: async (id, notes = "") => unwrap(await adminRequests.post(`/carwash/commissions/payouts/${id}/reverse`, { notes })),
  reverseSavingsPayout: async (id, notes = "") => unwrap(await adminRequests.post(`/carwash/commissions/savings/payouts/${id}/reverse`, { notes })),
  listSavings: async (params = {}) => unwrap(await adminRequests.get("/carwash/commissions/savings", { params: bp(params) })),
  listSavingsBalances: async () => unwrap(await adminRequests.get("/carwash/commissions/savings/balances")),
  listDamages: async (params = {}) => unwrap(await adminRequests.get("/carwash/commissions/damages", { params: bp(params) })),
  listDamagesBalances: async () => unwrap(await adminRequests.get("/carwash/commissions/damages/balances")),
  createDamage: async (payload) => unwrap(await adminRequests.post("/carwash/commissions/damages", bb(payload))),
  waiveDamage: async (id, notes = "") => unwrap(await adminRequests.post(`/carwash/commissions/damages/${id}/waive`, { notes })),
  deleteDamage: async (id) => unwrap(await adminRequests.delete(`/carwash/commissions/damages/${id}`)),
  createSavingsPayout: async (payload) => unwrap(await adminRequests.post("/carwash/commissions/savings/payouts", bb(payload))),
  initializeSavings:    async (startDate) => unwrap(await adminRequests.post("/carwash/commissions/savings/initialize", bb(startDate ? { startDate } : {}))),
  cleanupLegacySavings: async () => unwrap(await adminRequests.delete("/carwash/commissions/savings/legacy")),
  resetSavings:         async () => unwrap(await adminRequests.delete("/carwash/commissions/savings/reset")),
  getStaffWallet: async (staffId) => unwrap(await adminRequests.get(`/carwash/commissions/staff/${staffId}/wallet`)),
  // Loyalty
  getLoyaltyProgram: async () => unwrap(await adminRequests.get("/carwash/loyalty/program")),
  saveLoyaltyProgram: async (payload) => unwrap(await adminRequests.post("/carwash/loyalty/program", payload)),
  migratePerCustomerCards: async () => unwrap(await adminRequests.post("/carwash/loyalty/admin/migrate-per-customer")),
  lookupPlate: async (plate) => unwrap(await adminRequests.get(`/carwash/loyalty/plate/${encodeURIComponent(plate)}`)),
  listLoyaltyCustomers: async (params = {}) => unwrap(await adminRequests.get("/carwash/loyalty/customers", { params })),
  listCustomersEnriched: async (params = {}) => (await adminRequests.get("/carwash/loyalty/customers/enriched", { params: { ...params, _t: Date.now() } }))?.data,
  backfillCustomersAndStamps: async () => unwrap(await adminRequests.post("/carwash/loyalty/admin/backfill")),
  registerLoyaltyCustomer: async (payload) => unwrap(await adminRequests.post("/carwash/loyalty/customers", payload)),
  updateLoyaltyCustomer: async (id, payload) => unwrap(await adminRequests.put(`/carwash/loyalty/customers/${id}`, payload)),
  getCustomerCard: async (customerId) => unwrap(await adminRequests.get(`/carwash/loyalty/customers/${customerId}/card`)),
  redeemLoyaltyReward: async (jobId) => unwrap(await adminRequests.patch(`/carwash/loyalty/jobs/${jobId}/redeem`)),
  sendJobSms: async (jobId, payload) => unwrap(await adminRequests.post(`/carwash/jobs/${jobId}/sms`, payload)),
  uploadJobPhotos: async (jobId, files) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("photos", f));
    return unwrap(await adminRequests.post(`/carwash/jobs/${jobId}/photos`, fd, { headers: { "Content-Type": "multipart/form-data" } }));
  },
  deleteJobPhoto: async (jobId, url) => unwrap(await adminRequests.delete(`/carwash/jobs/${jobId}/photos`, { params: { url } })),
  getCustomerStatement: async (customerId) => unwrap(await adminRequests.get(`/carwash/loyalty/customers/${customerId}/statement`)),
  sendCustomerSms: async (customerId, payload) => unwrap(await adminRequests.post(`/carwash/loyalty/customers/${customerId}/sms`, payload)),
  sendPaymentSms: async (paymentId, payload) => unwrap(await adminRequests.post(`/carwash/payments/${paymentId}/sms`, payload)),

  // ─── Customer credits (overpayment / prepayment balances) ───────────────
  getCreditByPlate: async (plate) => unwrap(await adminRequests.get(`/carwash/credits/plate/${encodeURIComponent(plate)}`)),
  listCustomerCredits: async (params = {}) => unwrap(await adminRequests.get('/carwash/credits', { params })),
  applyCredit: async (id, jobId) => unwrap(await adminRequests.post(`/carwash/credits/${id}/apply`, { jobId })),
  writeOffCredit: async (id) => unwrap(await adminRequests.post(`/carwash/credits/${id}/write-off`)),
  writeOffCredits: async (ids) => unwrap(await adminRequests.post('/carwash/credits/write-off', { ids })),
  undoWriteOff: async (id) => unwrap(await adminRequests.post(`/carwash/credits/${id}/undo-write-off`)),
  refundCredit: async (id, payload) => unwrap(await adminRequests.post(`/carwash/credits/${id}/refund`, payload)),

  // ─── Credit accounts ─────────────────────────────────────────────────────
  seedAccounts: async () => unwrap(await adminRequests.post("/carwash/accounts/setup/seed-accounts")),
  listCreditAccounts: async (params = {}) => unwrap(await adminRequests.get("/carwash/accounts", { params })),
  createCreditAccount: async (payload) => unwrap(await adminRequests.post("/carwash/accounts", payload)),
  getCreditAccount: async (id) => unwrap(await adminRequests.get(`/carwash/accounts/${id}`)),
  updateCreditAccount: async (id, payload) => unwrap(await adminRequests.put(`/carwash/accounts/${id}`, payload)),
  lookupAccountByPlate: async (plate) => unwrap(await adminRequests.get(`/carwash/accounts/lookup/plate/${encodeURIComponent(plate)}`)),
  recordAccountPayment: async (id, payload) => unwrap(await adminRequests.post(`/carwash/accounts/${id}/pay`, payload)),
  recordAccountTopup: async (id, payload) => unwrap(await adminRequests.post(`/carwash/accounts/${id}/topup`, payload)),
  listAccountTopups: async (id) => unwrap(await adminRequests.get(`/carwash/accounts/${id}/topups`)),
  voidTopup: async (accountId, topupId, reason = "") => unwrap(await adminRequests.post(`/carwash/accounts/${accountId}/topups/${topupId}/void`, { reason })),
  voidTopupDirect: async (topupId, reason = "") => unwrap(await adminRequests.post(`/carwash/accounts/topups/${topupId}/void`, { reason })),
  generateStatement: async (id, payload = {}) => unwrap(await adminRequests.post(`/carwash/accounts/${id}/statements`, payload)),
  listStatements: async (id, params = {}) => unwrap(await adminRequests.get(`/carwash/accounts/${id}/statements`, { params })),
  getStatement: async (id, statementId) => unwrap(await adminRequests.get(`/carwash/accounts/${id}/statements/${statementId}`)),
  sendStatementSms: async (id, statementId, payload) => unwrap(await adminRequests.post(`/carwash/accounts/${id}/statements/${statementId}/sms`, payload)),
  sendStatementEmail: async (id, statementId, payload) => unwrap(await adminRequests.post(`/carwash/accounts/${id}/statements/${statementId}/email`, payload)),
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

// Converts a stored relative photo path (/uploads/carwash/carpets/x.jpg)
// to a full URL using the configured API server origin.
const _apiOrigin = (() => {
  const raw = String(import.meta.env.VITE_API_URL || "").trim();
  return raw ? raw.replace(/\/api\/?$/, "") : "";
})();
export const photoUrl = (relativePath) =>
  relativePath ? `${_apiOrigin}${relativePath}` : "";

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

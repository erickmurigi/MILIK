import Company from "../models/Company.js";
import { createError } from "./error.js";
import { serializeCompanyForClient } from "./companyModules.js";
import { hasCompanyActionPermission } from "./permissionControl.js";

const RULES = [
  { prefix: "/api/users", resource: "users", moduleKey: null },
  { prefix: "/api/companies", resource: "companies", moduleKey: null },
  { prefix: "/api/company-settings", resource: "companySettings", moduleKey: null },
  { prefix: "/api/chart-of-accounts", resource: "chartOfAccounts", moduleKey: "accounts" },
  { prefix: "/api/journals", resource: "journals", moduleKey: "accounts" },
  { prefix: "/api/financial-reports", resource: "financialReports", moduleKey: "accounts" },
  { prefix: "/api/payment-vouchers", resource: "paymentVouchers", moduleKey: "accounts" },
  { prefix: "/api/expense-requisitions", resource: "expenses", moduleKey: "accounts" },
  { prefix: "/api/landlord-standing-orders", resource: "landlordPayments", moduleKey: "accounts" },
  { prefix: "/api/landlord-advancements", resource: "landlordPayments", moduleKey: "accounts" },
  { prefix: "/api/service-providers", resource: "expenses", moduleKey: "accounts" },
  { prefix: "/api/ledger", resource: "ledger", moduleKey: "accounts" },
  { prefix: "/api/landlord-payments", resource: "landlordPayments", moduleKey: "accounts" },
  { prefix: "/api/processed-statements", resource: "processedStatements", moduleKey: "accounts" },
  { prefix: "/api/statements", resource: "statements", moduleKey: "propertyManagement" },
  { prefix: "/api/properties", resource: "properties", moduleKey: "propertyManagement" },
  { prefix: "/api/units", resource: "units", moduleKey: "propertyManagement" },
  { prefix: "/api/tenants", resource: "tenants", moduleKey: "propertyManagement" },
  { prefix: "/api/tenant-invoices", resource: "tenantInvoices", moduleKey: "propertyManagement" },
  { prefix: "/api/rent-payments", resource: "receipts", moduleKey: "propertyManagement" },
  { prefix: "/api/landlord-receipts", resource: "receipts", moduleKey: "propertyManagement" },
  { prefix: "/api/landlords", resource: "landlords", moduleKey: "propertyManagement" },
  { prefix: "/api/leases", resource: "leases", moduleKey: "propertyManagement" },
  { prefix: "/api/maintenances", resource: "maintenances", moduleKey: "propertyManagement" },
  { prefix: "/api/inspections", resource: "inspections", moduleKey: "propertyManagement" },
  { prefix: "/api/propertyexpenses", resource: "expenses", moduleKey: "accounts" },
  { prefix: "/api/utilities", resource: "utilities", moduleKey: "propertyManagement" },
  { prefix: "/api/meter-readings", resource: "meterReadings", moduleKey: "propertyManagement" },
  { prefix: "/api/late-penalties", resource: "latePenalties", moduleKey: "propertyManagement" },
  { prefix: "/api/notifications", resource: "notifications", moduleKey: "propertyManagement" },
  { prefix: "/api/clients/contracts",    resource: "clientContracts",    moduleKey: "clients" },
  { prefix: "/api/clients/invoices",     resource: "clientInvoices",     moduleKey: "clients" },
  { prefix: "/api/clients/interactions", resource: "clientInteractions", moduleKey: "clients" },
  { prefix: "/api/clients",             resource: "clients",             moduleKey: "clients" },
  { prefix: "/api/printers", resource: "printers", moduleKey: null },
  // HR — resource keys mirror the frontend's own route guards exactly
  // (App.jsx Guard moduleKey="hr" resource="...") so a permission granted/denied
  // in Company Settings behaves identically on both sides. /api/hr/ess is
  // deliberately NOT listed here — see the exclusion in enforceRoutePermissions
  // below, since ESS employee sessions use a completely different auth model.
  { prefix: "/api/hr/employees",           resource: "hrEmployees",  moduleKey: "hr" },
  { prefix: "/api/hr/letters",             resource: "hrEmployees",  moduleKey: "hr" },
  { prefix: "/api/hr/attendance",          resource: "hrEmployees",  moduleKey: "hr" },
  { prefix: "/api/hr/emails",              resource: "hrEmployees",  moduleKey: "hr" },
  { prefix: "/api/hr/leave-types",         resource: "hrLeave",      moduleKey: "hr" },
  { prefix: "/api/hr/leave-applications",  resource: "hrLeave",      moduleKey: "hr" },
  { prefix: "/api/hr/leave-balances",      resource: "hrLeave",      moduleKey: "hr" },
  { prefix: "/api/hr/payroll",             resource: "hrPayroll",    moduleKey: "hr" },
  { prefix: "/api/hr/pay-components",      resource: "hrPayroll",    moduleKey: "hr" },
  { prefix: "/api/hr/statutory-config",    resource: "hrStatutory",  moduleKey: "hr" },
  { prefix: "/api/hr/appraisal-cycles",    resource: "hrAppraisals", moduleKey: "hr" },
  { prefix: "/api/hr/appraisals",          resource: "hrAppraisals", moduleKey: "hr" },
  { prefix: "/api/hr/kpis",                resource: "hrAppraisals", moduleKey: "hr" },
  { prefix: "/api/hr/reports",             resource: "hrReports",    moduleKey: "hr" },
  { prefix: "/api/hr/departments",         resource: "hrSetup",      moduleKey: "hr" },
  { prefix: "/api/hr/designations",        resource: "hrSetup",      moduleKey: "hr" },
  { prefix: "/api/hr/signatories",         resource: "hrSetup",      moduleKey: "hr" },
  { prefix: "/api/hr/letter-templates",    resource: "hrSetup",      moduleKey: "hr" },
];

const PUBLIC_PREFIXES = ["/api/auth/login", "/api/auth/super-admin", "/api/trial"];

const resolveAction = (method = "GET", path = "") => {
  const lowerPath = String(path || "").toLowerCase();
  if (lowerPath.includes("/pdf")) return "export";
  if (lowerPath.includes("/approve")) return "approve";
  if (lowerPath.includes("/send")) return "send";
  if (lowerPath.includes("/reverse")) return "reverse";
  if (lowerPath.includes("/unconfirm")) return "reverse";
  if (lowerPath.includes("/confirm")) return "process";
  if (lowerPath.includes("/process")) return "process";
  if (lowerPath.includes("/post") || lowerPath.includes("post-commission")) return "process";
  // "/pay" and "/bill" are substrings of plain read paths too ("/payments",
  // "/billing", "/payroll", "/payslips" all contain "/pay") — a GET against one
  // of those was being upgraded from "view" to "process", requiring a
  // stronger permission just to read (found via /api/clients/invoices/:id/payments,
  // and reproduces today on the pre-existing GET /api/tenants/payments/:id too).
  // Restricting these two to non-GET keeps the intended behavior (POST .../pay
  // still resolves to "process") without misclassifying reads.
  if (method !== "GET" && lowerPath.includes("/pay")) return "process";
  if (method !== "GET" && lowerPath.includes("/bill")) return "process";
  if (lowerPath.includes("/toggle-lock")) return "update";
  if (lowerPath.includes("/reclassify")) return "update";
  if (lowerPath.includes("/revise")) return "update";
  if (lowerPath.includes("/validate")) return "view";
  if (lowerPath.includes("/bulk-import")) return "create";

  if (method === "GET") return lowerPath.includes("/summary") || lowerPath.includes("/stats") ? "view" : "view";
  if (method === "POST") return "create";
  if (method === "PUT" || method === "PATCH") return "update";
  if (method === "DELETE") return "delete";
  return "view";
};

const loadCompanyForRequest = async (user) => {
  const companyId = user?.company?._id || user?.company;
  if (!companyId) return null;
  const company = await Company.findById(companyId).lean();
  return company ? serializeCompanyForClient(company, user) : null;
};

export const enforceRoutePermissions = async (req, _res, next) => {
  try {
    if (!req.path?.startsWith("/api/")) return next();
    if (PUBLIC_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return next();
    // ESS (Employee Self Service) sessions are authenticated via a completely
    // separate token shape (role: "hrEmployee", no company/isSystemAdmin — see
    // verifyESS in modules/hr/routes/essPortal.js) — not the staff permission
    // model this table enforces. Their own routes already gate access.
    if (req.path.startsWith("/api/hr/ess") || req.user?.role === "hrEmployee") return next();
    if (!req.user) return next();
    if (req.user?.isSystemAdmin || req.user?.superAdminAccess) return next();

    const rule = RULES.find((item) => req.path.startsWith(item.prefix));
    if (!rule) return next();

    const company = await loadCompanyForRequest(req.user);
    const action = resolveAction(req.method, req.path);
    const allowed = hasCompanyActionPermission({
      user: req.user,
      company,
      moduleKey: rule.moduleKey,
      resource: rule.resource,
      action,
    });

    if (!allowed) {
      return next(createError(403, `Permission denied for ${rule.resource}.${action}`));
    }

    next();
  } catch (error) {
    next(error);
  }
};

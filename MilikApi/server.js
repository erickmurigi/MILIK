import chartOfAccountsRoutes from "./routes/chartOfAccounts.js";
import { Server } from "socket.io";
import { setIO } from "./utils/socketManager.js";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import getRedisClient from "./utils/redisClient.js";
import mongoose from "mongoose";
import dns from "node:dns";
import jwt from "jsonwebtoken";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";
import printerRoute from "./routes/printers.js";
import landlordRoutes from "./routes/propertyRoutes/landlords.js";
import unitRoutes from "./routes/propertyRoutes/units.js";
import tenantRoutes from "./routes/propertyRoutes/tenants.js";
import rentPaymentRoutes from "./routes/propertyRoutes/rentPayments.js";
import maintenanceRoutes from "./routes/propertyRoutes/maintenance.js";
import inspectionRoutes from "./routes/propertyRoutes/inspections.js";
import leaseRoutes from "./routes/propertyRoutes/leases.js";
import expensePropertyRoutes from "./routes/propertyRoutes/expensesProperties.js";
import ledgerDiagnosticsRoutes from "./routes/propertyRoutes/ledgerDiagnostics.js";
import landlordPaymentRoutes from "./routes/propertyRoutes/landlordPayments.js";
import statementRoutes from "./routes/propertyRoutes/statements.js";
import processedStatementsRoutes from "./routes/propertyRoutes/processedStatements.js";
import notificationRoutes from "./routes/propertyRoutes/notifications.js";
import utilityRoutes from "./routes/propertyRoutes/utilities.js";
import meterReadingRoutes from "./routes/propertyRoutes/meterReadings.js";
import latePenaltyRoutes from "./routes/propertyRoutes/latePenalties.js";
import communicationRoutes from "./routes/propertyRoutes/communications.js";
import DashboardRoutes from "./controllers/propertyController/dashboard.js";
import propertyRoutes from "./routes/propertyRoutes/properties.js";
import zoneRoutes from "./routes/propertyRoutes/zones.js";
import tenantInvoicesRoutes from "./routes/propertyRoutes/tenantInvoices.js";
import paymentVoucherRoutes from "./routes/propertyRoutes/paymentVouchers.js";
import http from "http";
import cors from "cors";
import compression from "compression";
import companyRoutes from "./routes/companies.js";
import trialRoutes from "./routes/trial.js";
import companySettingsRoutes from "./routes/companySettings.js";
import journalEntriesRoutes from "./routes/propertyRoutes/journalEntries.js";
import financialReportsRoutes from "./routes/propertyRoutes/financialReports.js";
import propertyLedgerRoutes from "./routes/propertyRoutes/propertyLedger.js";
import vatRemittanceRoutes from "./routes/propertyRoutes/taxRemittance.js";
import whtRemittanceRoutes from "./routes/propertyRoutes/whtRemittance.js";
import accountingPeriodsRoutes from "./routes/propertyRoutes/accountingPeriods.js";
import bankReconciliationRoutes from "./routes/propertyRoutes/bankReconciliation.js";
import fixedAssetsRoutes from "./routes/propertyRoutes/fixedAssets.js";
import budgetRoutes from "./routes/propertyRoutes/budgets.js";
import mpesaCollectionsRoutes from "./routes/propertyRoutes/mpesaCollections.js";
import pmsPublicCallbacksRoutes from "./routes/propertyRoutes/pmsPublicCallbacks.js";
import coopB2BRoutes          from "./routes/propertyRoutes/coopB2B.js";
import coopCollectionsRoutes  from "./routes/propertyRoutes/coopCollections.js";
import expenseRequisitionRoutes from "./routes/propertyRoutes/expenseRequisitions.js";
import serviceProvidersRoutes from "./routes/propertyRoutes/serviceProviders.js";
import landlordStandingOrdersRoutes from "./routes/propertyRoutes/landlordStandingOrders.js";
import landlordAdvancementsRoutes from "./routes/propertyRoutes/landlordAdvancements.js";
import landlordReceiptsRoutes from "./routes/propertyRoutes/landlordReceipts.js";
import pettyCashRoutes from "./routes/propertyRoutes/pettyCash.js";
import auditLogRoutes from "./routes/auditLogs.js";
import statementAllocationsRoutes from "./routes/adminRoutes/statementAllocations.js";
import invLocationRoutes      from "./modules/inventory/routes/locations.js";
import invCategoryRoutes      from "./modules/inventory/routes/categories.js";
import invProductRoutes       from "./modules/inventory/routes/products.js";
import invSupplierRoutes      from "./modules/inventory/routes/suppliers.js";
import invStockMovementRoutes from "./modules/inventory/routes/stockMovements.js";
import invStockTransferRoutes from "./modules/inventory/routes/stockTransfers.js";
import invPurchaseOrderRoutes from "./modules/inventory/routes/purchaseOrders.js";
import posSessionRoutes       from "./modules/inventory/routes/posSessions.js";
import posSaleRoutes          from "./modules/inventory/routes/posSales.js";
import invTillRoutes          from "./modules/inventory/routes/tills.js";
import posTillMovementRoutes  from "./modules/inventory/routes/tillMovements.js";
import invTaxGroupRoutes      from "./modules/inventory/routes/taxGroups.js";
import invUnitRoutes          from "./modules/inventory/routes/units.js";
import invPaymentMethodRoutes from "./modules/inventory/routes/paymentMethods.js";
import invPOSSettingsRoutes      from "./modules/inventory/routes/posSettings.js";
import invSupplierPaymentRoutes  from "./modules/inventory/routes/supplierPayments.js";
import carWashServiceRoutes from "./modules/carwash/routes/services.js";
import carWashJobRoutes from "./modules/carwash/routes/jobs.js";
import carWashPaymentRoutes from "./modules/carwash/routes/payments.js";
import carWashDepositRoutes from "./modules/carwash/routes/deposits.js";
import carWashExpenseRoutes from "./modules/carwash/routes/expenses.js";
import carWashStaffRoutes from "./modules/carwash/routes/staff.js";
import carWashReportRoutes from "./modules/carwash/routes/reports.js";
import carWashCommissionRoutes from "./modules/carwash/routes/commissions.js";
import carWashLoyaltyRoutes from "./modules/carwash/routes/loyalty.js";
import carWashMpesaRoutes from "./modules/carwash/routes/mpesa.js";
import carWashPayCallbackRoutes from "./modules/carwash/routes/mpesaPublicCallbacks.js";
import carWashBranchRoutes from "./modules/carwash/routes/branches.js";
import carWashCreditAccountRoutes from "./modules/carwash/routes/creditAccounts.js";
import carWashSettingsRoutes from "./modules/carwash/routes/settings.js";
import carWashDisplayRoutes from "./modules/carwash/routes/display.js";
import carWashCreditsRoutes from "./modules/carwash/routes/credits.js";
import { processDueBilling } from "./modules/carwash/controllers/creditAccountsController.js";
import { processAutoRentInvoices } from "./services/autoRentInvoicingService.js";
import { processRenewalReminders } from "./modules/clients/services/renewalReminderService.js";
import hrDepartmentRoutes from "./modules/hr/routes/departments.js";
import hrDesignationRoutes from "./modules/hr/routes/designations.js";
import hrEmployeeRoutes from "./modules/hr/routes/employees.js";
import hrLeaveTypeRoutes from "./modules/hr/routes/leaveTypes.js";
import hrLeaveApplicationRoutes from "./modules/hr/routes/leaveApplications.js";
import hrPayrollRoutes from "./modules/hr/routes/payroll.js";
import hrReportRoutes from "./modules/hr/routes/reports.js";
import hrLeaveBalanceRoutes from "./modules/hr/routes/leaveBalances.js";
import hrStatutoryRoutes from "./modules/hr/routes/statutory.js";
import hrKpiRoutes from "./modules/hr/routes/kpis.js";
import hrAppraisalCycleRoutes from "./modules/hr/routes/appraisalCycles.js";
import hrAppraisalRoutes from "./modules/hr/routes/appraisals.js";
import hrLetterRoutes         from "./modules/hr/routes/letters.js";
import hrSignatoryRoutes      from "./modules/hr/routes/signatories.js";
import hrLetterTemplateRoutes from "./modules/hr/routes/letterTemplates.js";
import hrPayComponentRoutes   from "./modules/hr/routes/payComponents.js";
import hrEmailRoutes          from "./modules/hr/routes/hrEmails.js";
import hrAttendanceRoutes      from "./modules/hr/routes/attendance.js";
import hrEssAuthRoutes        from "./modules/hr/routes/essAuth.js";
import hrEssPortalRoutes      from "./modules/hr/routes/essPortal.js";
import saleListingRoutes from "./modules/propertySale/routes/listings.js";
import saleBuyerRoutes from "./modules/propertySale/routes/buyers.js";
import saleAgentRoutes from "./modules/propertySale/routes/agents.js";
import saleOfferRoutes from "./modules/propertySale/routes/offers.js";
import saleDealRoutes from "./modules/propertySale/routes/deals.js";
import salePaymentRoutes from "./modules/propertySale/routes/payments.js";
import saleCommissionRoutes from "./modules/propertySale/routes/commissions.js";
import saleReportRoutes     from "./modules/propertySale/routes/reports.js";
import saleLeadRoutes       from "./modules/propertySale/routes/leads.js";
import saleActivityRoutes   from "./modules/propertySale/routes/activities.js";
import saleScheduleRoutes   from "./modules/propertySale/routes/schedule.js";
import clientRoutes         from "./modules/clients/routes/clients.js";
import clientContractRoutes from "./modules/clients/routes/contracts.js";
import clientInvoiceRoutes  from "./modules/clients/routes/invoices.js";
import clientInteractionRoutes from "./modules/clients/routes/interactions.js";
import publicListingsRoute  from "./routes/publicListings.js";
import rentalListingLeadsRoute from "./routes/rentalListingLeads.js";
import cookieParser from "cookie-parser";
import mongoSanitize from "mongo-sanitize";
import hpp from "hpp";
import {
  canAccessCompanyId,
  enforceRequestedCompanyScope,
  tryAttachUserFromToken,
  verifyToken,
} from "./controllers/verifyToken.js";
import { enforceRoutePermissions } from "./utils/routePermissionGuard.js";
import { warmBlacklistCache, isBlacklistedAsync } from "./utils/tokenBlacklist.js";
import { extractAuthTokenFromCookieHeader } from "./utils/authCookie.js";
import { syncCriticalIndexes } from "./utils/indexMaintenance.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_ROOT = path.join(__dirname, "uploads");
fs.mkdirSync(path.join(UPLOADS_ROOT, "leases"), { recursive: true });

const app = express();
const server = http.createServer(app);
const isProduction = process.env.NODE_ENV === "production";
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "1mb";

mongoose.set("strictQuery", true);
app.disable("x-powered-by");
app.set("trust proxy", resolveTrustProxySetting());
app.set("etag", "strong");

const cacheShortLived = (req, res, next) => {
  if (req.method === "GET") {
    res.set("Cache-Control", "private, no-cache");
  }
  next();
};

if (!process.env.MONGO_URL) {
  console.error("Missing MONGO_URL in environment variables.");
  process.exit(1);
}

const PUBLIC_DNS_RESOLVERS = ["1.1.1.1", "8.8.8.8"];
const DEFAULT_DEV_ALLOWED_ORIGINS = ["http://localhost:5173"];

function parseEnvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;

  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;

  return fallback;
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    return new URL(raw).origin;
  } catch (_error) {
    return "";
  }
}

function resolveAllowedOrigins() {
  const configuredOrigins = [
    ...parseEnvList(process.env.ALLOWED_ORIGINS),
    env("FRONTEND_URL"),
    env("CLIENT_URL"),
    env("CLIENT_BASE_URL"),
    env("APP_BASE_URL"),
    env("PUBLIC_BASE_URL"),
  ]
    .map(normalizeOrigin)
    .filter(Boolean);

  const defaults = isProduction ? [] : DEFAULT_DEV_ALLOWED_ORIGINS;
  return [...new Set([...defaults, ...configuredOrigins])];
}

function usesSrvMongoUrl(url) {
  return typeof url === "string" && url.startsWith("mongodb+srv://");
}

function isMongoSrvDnsError(error) {
  if (!error) return false;

  const message = `${error.message || ""} ${error.cause?.message || ""}`;

  return (
    error.code === "ECONNREFUSED" &&
    (error.syscall === "querySrv" || /querySrv/i.test(message) || /_mongodb\._tcp/i.test(message))
  );
}

function configureMongoDnsResolvers() {
  if (!usesSrvMongoUrl(process.env.MONGO_URL)) return;

  try {
    if (typeof dns.setDefaultResultOrder === "function") {
      dns.setDefaultResultOrder("ipv4first");
    }
  } catch (error) {
    console.warn("Unable to set DNS default result order:", error.message);
  }

  const envResolvers = parseEnvList(process.env.MONGO_DNS_SERVERS);
  if (!envResolvers.length) {
    // Use system DNS — don't override. ipv4first (above) is sufficient in most environments.
    console.log("MongoDB DNS: using system resolvers (ipv4first)");
    return;
  }

  try {
    dns.setServers(envResolvers);
    console.log("MongoDB SRV DNS resolvers:", dns.getServers().join(", "));
  } catch (error) {
    console.warn("Unable to override DNS servers for MongoDB SRV lookups:", error.message);
  }
}

configureMongoDnsResolvers();

const allowedOrigins = resolveAllowedOrigins();
const allowLocalhostOrigins = !isProduction || normalizeBoolean(env("ALLOW_LOCALHOST_ORIGINS"), false);

function isAllowedLocalhostOrigin(origin) {
  return /^http:\/\/localhost:\d+$/.test(origin);
}

function isAllowedOrigin(origin) {
  // Null origin = same-origin browser request or server-to-server call.
  // In production allow it only when not a credentialed cross-site request;
  // browsers always send Origin for cross-site requests, so null here is safe.
  if (!origin) return !isProduction;
  if (allowedOrigins.includes(origin)) return true;
  if (allowLocalhostOrigins && isAllowedLocalhostOrigin(origin)) return true;
  return false;
}

function resolveTrustProxySetting() {
  const raw = env("TRUST_PROXY");
  if (!raw) {
    return isProduction ? 1 : false;
  }

  const normalized = raw.toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return 1;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

function getJWTSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
}

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
app.use(hpp());
app.use((req, _res, next) => {
  req.body = mongoSanitize(req.body);
  req.params = mongoSanitize(req.params);
  req.query = mongoSanitize(req.query);
  next();
});
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error(
          `The CORS policy for this site does not allow access from the specified Origin: ${origin}`
        ),
        false
      );
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
    maxAge: 86400,
  })
);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error(`Socket.IO CORS blocked origin: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  },
});

io.use(async (socket, next) => {
  try {
    // Prefer explicit auth.token (future clients), fall back to the HttpOnly cookie
    // that browsers send automatically with WebSocket upgrade requests.
    const token =
      socket.handshake?.auth?.token ||
      extractAuthTokenFromCookieHeader(socket.handshake?.headers?.cookie || "");
    if (!token) return next(new Error("Authentication required for websocket connection"));
    const payload = jwt.verify(token, getJWTSecret(), { issuer: "milik-api", audience: "milik-client", algorithms: ["HS256"] });
    if (await isBlacklistedAsync(token)) return next(new Error("Session has been revoked"));
    socket.data.user = payload;
    return next();
  } catch (_error) {
    return next(new Error("Invalid websocket token"));
  }
});

io.on("connection", (socket) => {
  const user = socket.data?.user || {};
  const companyId = user?.company ? String(user.company) : null;
  const userId = user?.id ? String(user.id) : null;

  if (!isProduction) {
    console.log("User connected:", socket.id);
  }

  if (companyId) {
    socket.join(`company-${companyId}`);
  }

  if (userId) {
    socket.join(`user-${userId}`);
  }

  socket.on("joinCompany", (data) => {
    const requestedCompanyId = data?.companyId ? String(data.companyId) : null;
    const requestedUserId = data?.userId ? String(data.userId) : null;

    if (requestedCompanyId && canAccessCompanyId(user, requestedCompanyId)) {
      socket.join(`company-${requestedCompanyId}`);
    }

    if (requestedUserId && requestedUserId === userId) {
      socket.join(`user-${requestedUserId}`);
    }
  });

  socket.on("disconnect", () => {
    if (!isProduction) {
      console.log("User disconnected:", socket.id);
    }
  });
});

setIO(io);

app.use(compression());
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(morgan(isProduction ? "combined" : "common"));

const buildStore = (prefix) => {
  const redis = getRedisClient();
  if (!redis) return undefined;
  return new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: `rl:${prefix}:`,
  });
};


const trialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore("trial"),
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore("general"),
});

// Dedicated limiter for company creation — tighter than the general limiter
// because each company creation triggers heavy seeding (CoA, workspace init).
const companyCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many company creation requests from this IP, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore("company_create"),
});

const publicListingsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore("pub_listings"),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, message: "Too many login attempts, please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore("auth"),
  skipSuccessfulRequests: true,
});

app.use(generalLimiter);
app.use(cookieParser());

app.get("/health", (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  const payload = {
    success: mongoReady,
    status: mongoReady ? "ok" : "degraded",
    message: mongoReady ? "MILIK API is running" : "MILIK API is running with degraded database connectivity",
    timestamp: new Date().toISOString(),
  };

  if (!isProduction) {
    payload.environment = process.env.NODE_ENV || "development";
    payload.version = "1.0.0";
    payload.mongoState = mongoose.connection.readyState;
    payload.allowedOrigins = allowedOrigins;
  }

  res.status(mongoReady ? 200 : 503).json(payload);
});

app.get("/api", (req, res) => {
  res.status(200).json({
    success: true,
    name: "MILIK Property Management API",
    version: "1.0.0",
    description: "RESTful API for property, tenant, and landlord management",
    endpoints: {
      auth: "/api/auth",
      users: "/api/users",
      companies: "/api/companies",
      properties: "/api/properties",
      units: "/api/units",
      tenants: "/api/tenants",
      landlords: "/api/landlords",
      leases: "/api/leases",
      rentPayments: "/api/rent-payments",
      landlordReceipts: "/api/landlord-receipts",
      mpesaCollections: "/api/mpesa-collections",
      maintenance: "/api/maintenances",
      inspections: "/api/inspections",
      expenses: "/api/propertyexpenses",
      utilities: "/api/utilities",
      meterReadings: "/api/meter-readings",
      paymentVouchers: "/api/payment-vouchers",
      notifications: "/api/notifications",
      dashboard: "/api/dashboard",
      rentalLeads: "/api/rental-leads",
      tenantInvoices: "/api/tenant-invoices",
      communications: "/api/communications",
      carwashServices: "/api/carwash/services",
      carwashJobs: "/api/carwash/jobs",
      carwashPayments: "/api/carwash/payments",
      carwashExpenses: "/api/carwash/expenses",
      carwashStaff: "/api/carwash/staff",
      carwashReports: "/api/carwash/reports/daily-summary",
      documentation: "https://github.com/erickmurigi/MilikApi/blob/main/README.md",
    },
  });
});

// Authenticated file serving — requires a valid, non-revoked session.
app.use("/uploads", verifyToken, express.static(UPLOADS_ROOT));

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/trial", trialLimiter, trialRoutes);
app.use("/api/public/listings", publicListingsLimiter, publicListingsRoute);
app.use("/api/rental-leads", rentalListingLeadsRoute);
app.use("/api/coop-b2b",       coopB2BRoutes);
app.use("/api/pms/pay",        pmsPublicCallbacksRoutes);
app.use("/api", tryAttachUserFromToken, enforceRequestedCompanyScope, enforceRoutePermissions);
app.use("/api/chart-of-accounts", chartOfAccountsRoutes);
app.use("/api/users", userRoutes);
app.use("/api/printers", printerRoute);
app.use("/api/landlords", cacheShortLived, landlordRoutes);
app.use("/api/properties", cacheShortLived, propertyRoutes);
app.use("/api/zones",      cacheShortLived, zoneRoutes);
app.use("/api/utilities", utilityRoutes);
app.use("/api/meter-readings", meterReadingRoutes);
app.use("/api/late-penalties", latePenaltyRoutes);
app.use("/api/units", cacheShortLived, unitRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/rent-payments", rentPaymentRoutes);
app.use("/api/mpesa-collections", mpesaCollectionsRoutes);
app.use("/api/coop-collections",  coopCollectionsRoutes);
app.use("/api/expense-requisitions", expenseRequisitionRoutes);
app.use("/api/service-providers", serviceProvidersRoutes);
app.use("/api/landlord-receipts", landlordReceiptsRoutes);
app.use("/api/landlord-standing-orders", landlordStandingOrdersRoutes);
app.use("/api/landlord-advancements", landlordAdvancementsRoutes);
app.use("/api/maintenances", maintenanceRoutes);
app.use("/api/inspections", inspectionRoutes);
app.use("/api/leases", leaseRoutes);
app.use("/api/propertyexpenses", expensePropertyRoutes);
app.use("/api/payment-vouchers", paymentVoucherRoutes);
app.use("/api/ledger", ledgerDiagnosticsRoutes);
app.use("/api/landlord-payments", landlordPaymentRoutes);
app.use("/api/statements", statementRoutes);
app.use("/api/processed-statements", processedStatementsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/tenant-invoices", tenantInvoicesRoutes);
app.use("/api/communications", communicationRoutes);
app.use("/api/dashboard", DashboardRoutes);
app.post("/api/companies", companyCreationLimiter);
app.use("/api/companies", companyRoutes);
app.use("/api/company-settings", cacheShortLived, companySettingsRoutes);
app.use("/api/journals", journalEntriesRoutes);
app.use("/api/financial-reports", financialReportsRoutes);
app.use("/api/property-ledger",   propertyLedgerRoutes);
app.use("/api/vat-remittance", vatRemittanceRoutes);
app.use("/api/wht-remittance", whtRemittanceRoutes);
app.use("/api/accounting-periods", accountingPeriodsRoutes);
app.use("/api/bank-reconciliation", bankReconciliationRoutes);
app.use("/api/fixed-assets", fixedAssetsRoutes);
app.use("/api/budgets", budgetRoutes);
app.use("/api/petty-cash", pettyCashRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/admin/statement-allocations", statementAllocationsRoutes);
app.use("/api/carwash/services", carWashServiceRoutes);
app.use("/api/carwash/jobs", carWashJobRoutes);
app.use("/api/carwash/payments", carWashPaymentRoutes);
app.use("/api/carwash/deposits", carWashDepositRoutes);
app.use("/api/carwash/expenses", carWashExpenseRoutes);
app.use("/api/carwash/staff", carWashStaffRoutes);
app.use("/api/carwash/reports", carWashReportRoutes);
app.use("/api/carwash/commissions", carWashCommissionRoutes);
app.use("/api/carwash/loyalty", carWashLoyaltyRoutes);
app.use("/api/carwash/mpesa", carWashMpesaRoutes);
app.use("/api/carwash/pay", carWashPayCallbackRoutes);
app.use("/api/carwash/branches", carWashBranchRoutes);
app.use("/api/carwash/accounts", carWashCreditAccountRoutes);
app.use("/api/carwash/settings", carWashSettingsRoutes);
app.use("/api/carwash/display", carWashDisplayRoutes);
app.use("/api/carwash/credits", carWashCreditsRoutes);
app.use("/api/hr/departments", hrDepartmentRoutes);
app.use("/api/hr/designations", hrDesignationRoutes);
app.use("/api/hr/employees", hrEmployeeRoutes);
app.use("/api/hr/leave-types", hrLeaveTypeRoutes);
app.use("/api/hr/leave-applications", hrLeaveApplicationRoutes);
app.use("/api/hr/payroll", hrPayrollRoutes);
app.use("/api/hr/reports", hrReportRoutes);
app.use("/api/hr/leave-balances", hrLeaveBalanceRoutes);
app.use("/api/hr/statutory-config", hrStatutoryRoutes);
app.use("/api/hr/kpis", hrKpiRoutes);
app.use("/api/hr/appraisal-cycles", hrAppraisalCycleRoutes);
app.use("/api/hr/appraisals", hrAppraisalRoutes);
app.use("/api/hr/letters",           hrLetterRoutes);
app.use("/api/hr/signatories",       hrSignatoryRoutes);
app.use("/api/hr/letter-templates",  hrLetterTemplateRoutes);
app.use("/api/hr/pay-components",    hrPayComponentRoutes);
app.use("/api/hr/emails",            hrEmailRoutes);
app.use("/api/hr/attendance",        hrAttendanceRoutes);
app.use("/api/hr/ess/auth",          hrEssAuthRoutes);
app.use("/api/hr/ess",               hrEssPortalRoutes);
app.use("/api/sale/listings", saleListingRoutes);
app.use("/api/sale/buyers", saleBuyerRoutes);
app.use("/api/sale/agents", saleAgentRoutes);
app.use("/api/sale/offers", saleOfferRoutes);
app.use("/api/sale/deals", saleDealRoutes);
app.use("/api/sale/payments", salePaymentRoutes);
app.use("/api/sale/commissions",  saleCommissionRoutes);
app.use("/api/sale/reports",      saleReportRoutes);
app.use("/api/sale/leads",        saleLeadRoutes);
app.use("/api/sale/activities",   saleActivityRoutes);
app.use("/api/sale/schedule",     saleScheduleRoutes);
app.use("/api/inventory/locations",       invLocationRoutes);
app.use("/api/inventory/categories",      invCategoryRoutes);
app.use("/api/inventory/products",        invProductRoutes);
app.use("/api/inventory/suppliers",       invSupplierRoutes);
app.use("/api/inventory/stock-movements", invStockMovementRoutes);
app.use("/api/inventory/transfers",       invStockTransferRoutes);
app.use("/api/inventory/purchase-orders", invPurchaseOrderRoutes);
app.use("/api/pos/sessions",              posSessionRoutes);
app.use("/api/pos/sales",                 posSaleRoutes);
app.use("/api/inventory/tills",           invTillRoutes);
app.use("/api/pos/till-movements",        posTillMovementRoutes);
app.use("/api/inventory/tax-groups",      invTaxGroupRoutes);
app.use("/api/inventory/units",           invUnitRoutes);
app.use("/api/inventory/payment-methods", invPaymentMethodRoutes);
app.use("/api/inventory/pos-settings",     invPOSSettingsRoutes);
app.use("/api/inventory/supplier-payments", invSupplierPaymentRoutes);
// Client Management — sub-resource routes must be registered BEFORE the parent
// so that /api/clients/contracts is not caught by the /:id handler in clientRoutes
app.use("/api/clients/contracts",         clientContractRoutes);
app.use("/api/clients/invoices",          clientInvoiceRoutes);
app.use("/api/clients/interactions",      clientInteractionRoutes);
app.use("/api/clients",                   clientRoutes);

app.get("/privacy-policy", (req, res) => {
  res.sendFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "public", "privacy-policy.html"));
});

app.use((err, req, res, next) => {
  const errorStatus = err.status || err.statusCode || 500;
  const errorMessage = err.message || "Something went wrong!";
  const clientMessage = errorStatus >= 500 && isProduction ? "Internal server error" : errorMessage;

  if (errorStatus >= 500) {
    console.error("Unhandled server error:", err);
  }

  return res.status(errorStatus).json({
    success: false,
    status: errorStatus,
    message: clientMessage,
    stack: !isProduction ? err.stack : undefined,
  });
});

async function connect() {
  const connectionCandidates = [
    { label: "MONGO_URL", value: process.env.MONGO_URL },
    { label: "MONGO_URL_DIRECT", value: process.env.MONGO_URL_DIRECT },
  ].filter((entry) => entry.value);

  let lastError = null;

  for (const candidate of connectionCandidates) {
    try {
      await mongoose.connect(candidate.value, {
        maxPoolSize: 50,
        minPoolSize: 10,
        socketTimeoutMS: 45000,
        serverSelectionTimeoutMS: 10000,
        heartbeatFrequencyMS: 30000,
      });

      console.log(`Connected to MongoDB using ${candidate.label}`);
      warmBlacklistCache().catch(() => {});
      return;
    } catch (error) {
      lastError = error;

      if (candidate.label === "MONGO_URL" && process.env.MONGO_URL_DIRECT) {
        console.warn(
          `MongoDB connection via ${candidate.label} failed. Falling back to MONGO_URL_DIRECT...`
        );
        continue;
      }

      console.error(`Error connecting to MongoDB using ${candidate.label}:`, error);
    }
  }

  if (isMongoSrvDnsError(lastError)) {
    console.error(
      [
        "MongoDB Atlas SRV lookup failed before authentication.",
        "Cause: the current DNS resolver refused or failed the _mongodb._tcp SRV lookup.",
        `Active Node DNS servers: ${dns.getServers().join(", ")}`,
        "Fix: keep the mongodb+srv URI and use working DNS resolvers, or add MONGO_URL_DIRECT as a standard mongodb:// URI.",
      ].join(" ")
    );
  }

  throw lastError;
}

mongoose.connection.on("connected", () => {
  console.log("Mongoose connection established");
});

mongoose.connection.on("error", (err) => {
  console.error("Mongoose connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("Mongoose disconnected");
});

const PORT = process.env.PORT || 8800;

async function startServer() {
  try {
    await connect();

    try {
      const indexMaintenance = await syncCriticalIndexes();
      if (indexMaintenance?.dropped?.length) {
        console.log("Index maintenance dropped stale indexes:", indexMaintenance.dropped.join(", "));
      }
      console.log("Index maintenance synced models:", (indexMaintenance?.synced || []).join(", "));
    } catch (indexError) {
      console.error("Index maintenance warning:", indexError);
    }

    // ── One-time migration: clear applicableServices restrictions ──────────
    // The UI never exposed this field, so any non-empty value silently blocks
    // stamps for services not in the list. Clear it so all services qualify.
    try {
      const { default: CWLoyaltyProgram } = await import('./modules/carwash/models/CarWashLoyaltyProgram.js');
      const migResult = await CWLoyaltyProgram.updateMany(
        { 'applicableServices.0': { $exists: true } },
        { $set: { applicableServices: [] } }
      );
      if (migResult.modifiedCount > 0) {
        console.log(`[CW Loyalty] Cleared service restrictions from ${migResult.modifiedCount} program(s) — all services now eligible for stamps`);
      }
    } catch (migErr) {
      console.error('[CW Loyalty] Migration warning (non-fatal):', migErr?.message || migErr);
    }

    // ── Fix: unset phone:null on CarWashCustomers so the new partial index works ─
    try {
      const { default: CarWashCustomer } = await import('./modules/carwash/models/CarWashCustomer.js');
      const r = await CarWashCustomer.updateMany({ phone: null }, { $unset: { phone: 1 } });
      if (r.modifiedCount > 0) console.log(`[CW Customer] Unset phone:null on ${r.modifiedCount} customer(s) — partial phone index now correct`);
    } catch (e) {
      console.error('[CW Customer] phone cleanup warning (non-fatal):', e?.message || e);
    }

    // Cron jobs must only run on one worker. PM2 sets NODE_APP_INSTANCE per worker (0, 1, 2…).
    // Without this guard all workers fire simultaneously → duplicate invoices/emails.
    const isPrimaryWorker = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === "0";

    if (isPrimaryWorker) {
    // ── Monthly billing cron ────────────────────────────────────────────────
    // Runs at 08:00 EAT daily. Generates and SMS-sends statements for any
    // monthly account whose billingDay matches today. Idempotent — skips if a
    // statement for the current month already exists for that account.
    try {
      const cron = await import("node-cron");
      cron.default.schedule("0 8 * * *", async () => {
        console.log("[CW Billing Cron] Running auto-billing check for", new Date().toISOString().slice(0, 10));
        try {
          const results = await processDueBilling(null);
          if (results.length) console.log(`[CW Billing Cron] Generated ${results.length} statement(s)`);
        } catch (err) {
          console.error("[CW Billing Cron] Error:", err?.message || err);
        }
      }, { timezone: "Africa/Nairobi" });
      console.log("[CW Billing Cron] Scheduled — daily at 08:00 EAT");
    } catch (cronErr) {
      console.error("[CW Billing Cron] Failed to schedule:", cronErr?.message || cronErr);
    }

    // ── Auto rent invoicing cron ─────────────────────────────────────────────
    // Runs at 08:00 EAT daily. Creates rent invoices for companies with
    // autoInvoicing.enabled = true whose trigger day matches today.
    try {
      const cron = await import("node-cron");
      cron.default.schedule("0 8 * * *", async () => {
        console.log("[AutoInvoicing Cron] Running for", new Date().toISOString().slice(0, 10));
        try {
          const results = await processAutoRentInvoices();
          if (results.length) {
            const total = results.reduce((s, r) => s + r.created, 0);
            console.log(`[AutoInvoicing Cron] Created ${total} invoice(s) across ${results.length} company(s)`);
          }
        } catch (err) {
          console.error("[AutoInvoicing Cron] Error:", err?.message || err);
        }
      }, { timezone: "Africa/Nairobi" });
      console.log("[AutoInvoicing Cron] Scheduled — daily at 08:00 EAT");
    } catch (cronErr) {
      console.error("[AutoInvoicing Cron] Failed to schedule:", cronErr?.message || cronErr);
    }

    // ── Overdue invoice + pending_renewal contract cron ───────────────────────
    // Runs at 08:15 EAT daily.
    // Marks sent/partial client invoices as overdue when past their due date.
    // Marks active contracts expiring within 60 days as pending_renewal.
    try {
      const cron = await import("node-cron");
      const ClientInvoiceMod  = await import("./modules/clients/models/ClientInvoice.js");
      const ClientContractMod = await import("./modules/clients/models/ClientContract.js");
      const ClientInvoiceModel  = ClientInvoiceMod.default;
      const ClientContractModel = ClientContractMod.default;
      cron.default.schedule("15 8 * * *", async () => {
        const now = new Date();
        try {
          const ri = await ClientInvoiceModel.updateMany(
            { status: { $in: ["sent", "partial"] }, dueDate: { $lt: now } },
            { $set: { status: "overdue" } }
          );
          if (ri.modifiedCount) console.log(`[Overdue Cron] Marked ${ri.modifiedCount} invoice(s) as overdue`);
        } catch (err) {
          console.error("[Overdue Cron] Invoice error:", err?.message || err);
        }
        try {
          const cutoff = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
          const rc = await ClientContractModel.updateMany(
            { status: "active", openEnded: { $ne: true }, endDate: { $gt: now, $lte: cutoff } },
            { $set: { status: "pending_renewal" } }
          );
          if (rc.modifiedCount) console.log(`[PendingRenewal Cron] Set ${rc.modifiedCount} contract(s) to pending_renewal`);
        } catch (err) {
          console.error("[PendingRenewal Cron] Contract error:", err?.message || err);
        }
      }, { timezone: "Africa/Nairobi" });
      console.log("[Overdue/PendingRenewal Cron] Scheduled — daily at 08:15 EAT");
    } catch (cronErr) {
      console.error("[Overdue/PendingRenewal Cron] Failed to schedule:", cronErr?.message || cronErr);
    }

    // ── Contract renewal reminder cron ────────────────────────────────────────
    // Runs at 08:30 EAT daily. Sends email reminders at 90/60/30/7 days before expiry.
    try {
      const cron = await import("node-cron");
      cron.default.schedule("30 8 * * *", async () => {
        try {
          const sent = await processRenewalReminders();
          if (sent) console.log(`[RenewalReminder Cron] Sent ${sent} renewal reminder email(s)`);
        } catch (err) {
          console.error("[RenewalReminder Cron] Error:", err?.message || err);
        }
      }, { timezone: "Africa/Nairobi" });
      console.log("[RenewalReminder Cron] Scheduled — daily at 08:30 EAT");
    } catch (cronErr) {
      console.error("[RenewalReminder Cron] Failed to schedule:", cronErr?.message || cronErr);
    }
    } // end isPrimaryWorker

    // Socket.IO Redis adapter — required for cross-worker events in PM2 cluster mode.
    // emitToCompany/emitToUser would otherwise only reach clients on the same worker.
    if (process.env.REDIS_URL) {
      try {
        const { createAdapter } = await import("@socket.io/redis-adapter");
        const { default: Redis } = await import("ioredis");
        // lazyConnect + explicit connect() ensures both clients are fully
        // connected before createAdapter() calls subscribe() on subClient.
        const pubClient = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
        const subClient = pubClient.duplicate();
        await Promise.all([pubClient.connect(), subClient.connect()]);
        io.adapter(createAdapter(pubClient, subClient));
        console.log("[Socket.IO] Redis adapter active — cross-worker events enabled");
      } catch (adapterErr) {
        console.error("[Socket.IO] Redis adapter setup failed — events will be worker-local:", adapterErr.message);
      }
    }

    server.listen(PORT, () => {
      console.log(`Backend server is running on port ${PORT}`);
      console.log(`Trust proxy setting: ${JSON.stringify(app.get("trust proxy"))}`);
      console.log(
        `CORS origins: ${allowedOrigins.length ? allowedOrigins.join(", ") : "No explicit production origins configured"}`
      );
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Promise Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

// Graceful shutdown — allows in-flight requests to complete before process exits.
// Required for zero-downtime restarts under PM2, Docker, and Kubernetes (SIGTERM).
const gracefulShutdown = (signal) => {
  console.log(`[Shutdown] ${signal} received — closing server gracefully…`);
  server.close(() => {
    console.log("[Shutdown] HTTP server closed. Closing MongoDB connection…");
    mongoose.connection.close(false).then(() => {
      console.log("[Shutdown] MongoDB connection closed. Exiting.");
      process.exit(0);
    }).catch(() => process.exit(0));
  });
  // Force exit after 15 s if draining takes too long
  setTimeout(() => {
    console.error("[Shutdown] Drain timeout — forcing exit.");
    process.exit(1);
  }, 15_000).unref();
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

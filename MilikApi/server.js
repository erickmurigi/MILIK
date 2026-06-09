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
import bankReconciliationRoutes from "./routes/propertyRoutes/bankReconciliation.js";
import fixedAssetsRoutes from "./routes/propertyRoutes/fixedAssets.js";
import budgetRoutes from "./routes/propertyRoutes/budgets.js";
import mpesaCollectionsRoutes from "./routes/propertyRoutes/mpesaCollections.js";
import expenseRequisitionRoutes from "./routes/propertyRoutes/expenseRequisitions.js";
import serviceProvidersRoutes from "./routes/propertyRoutes/serviceProviders.js";
import landlordStandingOrdersRoutes from "./routes/propertyRoutes/landlordStandingOrders.js";
import landlordAdvancementsRoutes from "./routes/propertyRoutes/landlordAdvancements.js";
import landlordReceiptsRoutes from "./routes/propertyRoutes/landlordReceipts.js";
import pettyCashRoutes from "./routes/propertyRoutes/pettyCash.js";
import auditLogRoutes from "./routes/auditLogs.js";
import invLocationRoutes      from "./modules/inventory/routes/locations.js";
import invCategoryRoutes      from "./modules/inventory/routes/categories.js";
import invProductRoutes       from "./modules/inventory/routes/products.js";
import invSupplierRoutes      from "./modules/inventory/routes/suppliers.js";
import invStockMovementRoutes from "./modules/inventory/routes/stockMovements.js";
import invStockTransferRoutes from "./modules/inventory/routes/stockTransfers.js";
import invPurchaseOrderRoutes from "./modules/inventory/routes/purchaseOrders.js";
import posSessionRoutes       from "./modules/inventory/routes/posSessions.js";
import posSaleRoutes          from "./modules/inventory/routes/posSales.js";
import invTillRoutes         from "./modules/inventory/routes/tills.js";
import posTillMovementRoutes from "./modules/inventory/routes/tillMovements.js";
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
import { processDueBilling } from "./modules/carwash/controllers/creditAccountsController.js";
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
import hrLetterRoutes from "./modules/hr/routes/letters.js";
import saleListingRoutes from "./modules/propertySale/routes/listings.js";
import saleBuyerRoutes from "./modules/propertySale/routes/buyers.js";
import saleAgentRoutes from "./modules/propertySale/routes/agents.js";
import saleOfferRoutes from "./modules/propertySale/routes/offers.js";
import saleDealRoutes from "./modules/propertySale/routes/deals.js";
import salePaymentRoutes from "./modules/propertySale/routes/payments.js";
import saleCommissionRoutes from "./modules/propertySale/routes/commissions.js";
import saleReportRoutes from "./modules/propertySale/routes/reports.js";
import mongoSanitize from "mongo-sanitize";
import hpp from "hpp";
import { blockDemoWrites } from "./utils/demoAccess.js";
import {
  canAccessCompanyId,
  enforceRequestedCompanyScope,
  tryAttachUserFromToken,
} from "./controllers/verifyToken.js";
import { enforceRoutePermissions } from "./utils/routePermissionGuard.js";
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

  const envResolvers = parseEnvList(process.env.MONGO_DNS_SERVERS);
  const resolvers = envResolvers.length ? envResolvers : PUBLIC_DNS_RESOLVERS;

  try {
    if (typeof dns.setDefaultResultOrder === "function") {
      dns.setDefaultResultOrder("ipv4first");
    }
  } catch (error) {
    console.warn("Unable to set DNS default result order:", error.message);
  }

  try {
    dns.setServers(resolvers);
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
app.use(blockDemoWrites);

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

io.use((socket, next) => {
  try {
    const token = socket.handshake?.auth?.token;
    if (!token) {
      return next(new Error("Authentication required for websocket connection"));
    }

    const payload = jwt.verify(token, getJWTSecret());
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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: "Too many login attempts, please try again after 15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore("auth"),
});

const trialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many demo requests, please try again later",
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

app.use(generalLimiter);

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

app.use("/uploads", express.static(UPLOADS_ROOT));

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/super-admin", authLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/trial", trialLimiter, trialRoutes);
app.use("/api", tryAttachUserFromToken, enforceRequestedCompanyScope, enforceRoutePermissions);
app.use("/api/chart-of-accounts", chartOfAccountsRoutes);
app.use("/api/users", userRoutes);
app.use("/api/printers", printerRoute);
app.use("/api/landlords", cacheShortLived, landlordRoutes);
app.use("/api/properties", cacheShortLived, propertyRoutes);
app.use("/api/utilities", utilityRoutes);
app.use("/api/meter-readings", meterReadingRoutes);
app.use("/api/late-penalties", latePenaltyRoutes);
app.use("/api/units", cacheShortLived, unitRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/rent-payments", rentPaymentRoutes);
app.use("/api/mpesa-collections", mpesaCollectionsRoutes);
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
app.use("/api/bank-reconciliation", bankReconciliationRoutes);
app.use("/api/fixed-assets", fixedAssetsRoutes);
app.use("/api/budgets", budgetRoutes);
app.use("/api/petty-cash", pettyCashRoutes);
app.use("/api/audit-logs", auditLogRoutes);
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
app.use("/api/hr/letters", hrLetterRoutes);
app.use("/api/sale/listings", saleListingRoutes);
app.use("/api/sale/buyers", saleBuyerRoutes);
app.use("/api/sale/agents", saleAgentRoutes);
app.use("/api/sale/offers", saleOfferRoutes);
app.use("/api/sale/deals", saleDealRoutes);
app.use("/api/sale/payments", salePaymentRoutes);
app.use("/api/sale/commissions", saleCommissionRoutes);
app.use("/api/sale/reports", saleReportRoutes);
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
      // Run auto-billing check for monthly car wash accounts on startup (fire-and-forget)
      processDueBilling(null).then((r) => { if (r.length) console.log(`[CW Billing] Auto-generated ${r.length} statement(s)`); }).catch(() => {});
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

    // ── Startup: back-fill any daily savings missed while server was down ───
    // Safe to run on every restart — the unique index skips already-posted dates.
    try {
      const { default: Company }           = await import('./models/Company.js');
      const { default: CarWashStaffSaving } = await import('./modules/carwash/models/CarWashStaffSaving.js');
      const { processDailySavings }         = await import('./modules/carwash/services/savingsService.js');

      const businesses = await Company.find({ 'modules.carwash': true }).select('_id').lean();
      let totalBackfilled = 0;

      for (const biz of businesses) {
        const last = await CarWashStaffSaving.findOne(
          { business: biz._id, type: 'daily' },
          { savingsDate: 1 },
          { sort: { savingsDate: -1 } }
        ).lean();

        if (!last?.savingsDate) continue; // no history yet — cron starts fresh tonight

        const lastDate = new Date(last.savingsDate);
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        console.log(`[CW Savings Catchup] biz …${String(biz._id).slice(-6)}: lastSavingsDate=${lastDate.toISOString().slice(0,10)} today=${today.toISOString().slice(0,10)}`);

        const cur = new Date(lastDate);
        cur.setUTCDate(cur.getUTCDate() + 1); // start from the day after the last posted date

        while (cur <= today) {
          const result = await processDailySavings(String(biz._id), new Date(cur));
          console.log(`[CW Savings Catchup] ${cur.toISOString().slice(0, 10)}: posted=${result.posted} skipped=${result.skipped}`);
          if (result.posted > 0) totalBackfilled += result.posted;
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }

      console.log(totalBackfilled > 0
        ? `[CW Savings Catchup] Backfilled ${totalBackfilled} missing records`
        : '[CW Savings Catchup] No missed days — savings up to date');
    } catch (catchupErr) {
      console.error('[CW Savings Catchup] Warning (non-fatal):', catchupErr?.message || catchupErr);
    }

    // ── Daily staff savings cron ────────────────────────────────────────────
    // Runs every day at 20:59 EAT (timezone: Africa/Nairobi).
    // Posts Ksh X standing-order savings for every active Car Wash staff member.
    try {
      const cron = await import("node-cron");
      const { runDailySavingsCron } = await import("./modules/carwash/services/savingsService.js");
      cron.default.schedule("59 23 * * *", async () => {
        console.log("[CW Savings Cron] Running daily savings for", new Date().toISOString().slice(0, 10));
        try {
          await runDailySavingsCron(new Date());
        } catch (err) {
          console.error("[CW Savings Cron] Error:", err?.message || err);
        }
      }, { timezone: "Africa/Nairobi" });
      console.log("[CW Savings Cron] Scheduled — daily at 23:59 EAT");
    } catch (cronErr) {
      console.error("[CW Savings Cron] Failed to schedule:", cronErr?.message || cronErr);
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

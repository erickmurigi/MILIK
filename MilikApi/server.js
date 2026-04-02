import chartOfAccountsRoutes from "./routes/chartOfAccounts.js";
import { Server } from "socket.io";
import { setIO } from "./utils/socketManager.js";
import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
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
import companyRoutes from "./routes/companies.js";
import trialRoutes from "./routes/trial.js";
import companySettingsRoutes from "./routes/companySettings.js";
import journalEntriesRoutes from "./routes/propertyRoutes/journalEntries.js";
import financialReportsRoutes from "./routes/propertyRoutes/financialReports.js";
import { blockDemoWrites } from "./utils/demoAccess.js";
import {
  canAccessCompanyId,
  enforceRequestedCompanyScope,
  tryAttachUserFromToken,
} from "./controllers/verifyToken.js";
import { enforceRoutePermissions } from "./utils/routePermissionGuard.js";
import { syncCriticalIndexes } from "./utils/indexMaintenance.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const isProduction = process.env.NODE_ENV === "production";
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "1mb";

mongoose.set("strictQuery", true);
app.disable("x-powered-by");
app.set("trust proxy", resolveTrustProxySetting());

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
  if (!origin) return true;
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

app.use(helmet());
app.use(morgan(isProduction ? "combined" : "common"));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: "Too many login attempts, please try again after 15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
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
      maintenance: "/api/maintenances",
      expenses: "/api/propertyexpenses",
      utilities: "/api/utilities",
      meterReadings: "/api/meter-readings",
      paymentVouchers: "/api/payment-vouchers",
      notifications: "/api/notifications",
      dashboard: "/api/dashboard",
      tenantInvoices: "/api/tenant-invoices",
      communications: "/api/communications",
      documentation: "https://github.com/erickmurigi/MilikApi/blob/main/README.md",
    },
  });
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/super-admin", authLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/trial", trialLimiter, trialRoutes);
app.use("/api", tryAttachUserFromToken, enforceRequestedCompanyScope, enforceRoutePermissions);
app.use("/api/chart-of-accounts", chartOfAccountsRoutes);
app.use("/api/users", userRoutes);
app.use("/api/printers", printerRoute);
app.use("/api/landlords", landlordRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/utilities", utilityRoutes);
app.use("/api/meter-readings", meterReadingRoutes);
app.use("/api/late-penalties", latePenaltyRoutes);
app.use("/api/units", unitRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/rent-payments", rentPaymentRoutes);
app.use("/api/maintenances", maintenanceRoutes);
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
app.use("/api/companies", companyRoutes);
app.use("/api/company-settings", companySettingsRoutes);
app.use("/api/journals", journalEntriesRoutes);
app.use("/api/financial-reports", financialReportsRoutes);

app.use((err, req, res, next) => {
  const errorStatus = err.status || 500;
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
        serverSelectionTimeoutMS: 10000,
      });

      console.log(`Connected to MongoDB using ${candidate.label}`);
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

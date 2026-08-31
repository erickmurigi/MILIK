import jwt from "jsonwebtoken";
import Company from "../models/Company.js";
import { createError } from "../utils/error.js";
import { hasModuleAccess, serializeCompanyForClient } from "../utils/companyModules.js";
import { getAccessibleCompanyIds, hasCompanyActionPermission, isSystemAdminUser } from "../utils/permissionControl.js";
import { extractAuthCookieToken } from "../utils/authCookie.js";
import { isBlacklisted, isBlacklistedAsync } from "../utils/tokenBlacklist.js";

// In-process cache: companyId → { company, cachedAt }
// Avoids a MongoDB round-trip on every authenticated request.
// 60-second TTL; max 500 entries (companies change rarely).
const _companyCache = new Map();
const COMPANY_CACHE_TTL_MS = 60_000;
const COMPANY_CACHE_MAX    = 500;

const getCachedCompany = async (companyId) => {
  const hit = _companyCache.get(companyId);
  if (hit && Date.now() - hit.cachedAt < COMPANY_CACHE_TTL_MS) return hit.company;
  const company = await Company.findById(companyId).lean();
  if (company) {
    if (_companyCache.size >= COMPANY_CACHE_MAX) {
      _companyCache.delete(_companyCache.keys().next().value);
    }
    _companyCache.set(companyId, { company, cachedAt: Date.now() });
  } else {
    _companyCache.delete(companyId);
  }
  return company;
};

export const invalidateCompanyCache = (companyId) => {
  if (companyId) _companyCache.delete(String(companyId));
};

const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
};

const JWT_VERIFY_OPTIONS = { issuer: "milik-api", audience: "milik-client", algorithms: ["HS256"] };

export const normalizeCompanyId = (company) => {
  if (!company) return null;
  if (typeof company === "string") return company;
  if (company?._id) return String(company._id);
  return String(company);
};

export const canAccessCompanyId = (user, companyId) => {
  if (!companyId) return false;
  if (isSystemAdminUser(user)) return true;
  return getAccessibleCompanyIds(user).includes(String(companyId));
};

const COMPANY_SCOPE_KEYS = new Set([
  "business",
  "businessId",
  "company",
  "companyId",
  "primaryCompany",
  "accessibleCompanies",
  "companyAssignments",
]);

const collectCompanyIdsFromValue = (value, collector) => {
  if (!value) return;

  if (Array.isArray(value)) {
    value.forEach((item) => collectCompanyIdsFromValue(item, collector));
    return;
  }

  if (typeof value === "object") {
    if (value?._id) collector.add(String(value._id));
    if (value?.company) collectCompanyIdsFromValue(value.company, collector);

    Object.entries(value).forEach(([key, nestedValue]) => {
      if (COMPANY_SCOPE_KEYS.has(key)) {
        collectCompanyIdsFromValue(nestedValue, collector);
      }
    });
    return;
  }

  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).trim();
    if (normalized) collector.add(normalized);
  }
};

const getRequestedCompanyIds = (req) => {
  const requested = new Set();
  [req.params, req.query, req.body].forEach((source) => collectCompanyIdsFromValue(source, requested));
  return [...requested].filter(Boolean);
};

const getActiveCompanyIdFromRequest = (req) => {
  const explicit =
    req.headers?.["x-active-company-id"] ||
    req.headers?.["x-company-id"] ||
    req.body?.business ||
    req.body?.businessId ||
    req.body?.company ||
    req.body?.companyId ||
    req.query?.business ||
    req.query?.businessId ||
    req.query?.company ||
    req.query?.companyId ||
    null;

  const explicitId = normalizeCompanyId(explicit);
  if (explicitId && canAccessCompanyId(req.user, explicitId)) return explicitId;

  return normalizeCompanyId(req.user?.company);
};

const attachResolvedCompany = async (req) => {
  if (req.companyContext) return req.companyContext;

  const companyId = getActiveCompanyIdFromRequest(req);
  if (!companyId) {
    req.companyContext = null;
    return null;
  }

  const company = await getCachedCompany(companyId);
  req.companyContext = company ? serializeCompanyForClient(company, req.user) : null;
  req.userCompany = companyId;
  return req.companyContext;
};

const extractBearerToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }

  return extractAuthCookieToken(req.cookies);
};

export const tryAttachUserFromToken = async (req, _res, next) => {
  if (req.user) return next();
  const token = extractBearerToken(req);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, getJWTSecret(), JWT_VERIFY_OPTIONS);
    const revoked = await isBlacklistedAsync(token);
    // Cache result on req so verifyToken doesn't repeat the DB check for the same token.
    req._checkedToken = token;
    req._tokenRevoked = revoked;
    if (!revoked) req.user = decoded;
  } catch (_error) {
    // leave req.user unset; verifyUser will handle hard auth failures later
  }
  next();
};

export const verifyToken = (req, res, next) => {
  const token = extractBearerToken(req);

  if (!token) {
    return next(createError(401, "You are not authenticated!"));
  }

  jwt.verify(token, getJWTSecret(), JWT_VERIFY_OPTIONS, async (err, user) => {
    if (err) return next(createError(403, "Token is not valid!"));
    try {
      // Reuse the result from tryAttachUserFromToken if it already checked this exact token.
      const revoked = (req._checkedToken === token && req._tokenRevoked !== undefined)
        ? req._tokenRevoked
        : await isBlacklistedAsync(token);
      if (revoked) return next(createError(401, "Session has been revoked. Please log in again."));
    } catch (_e) {
      return next(createError(500, "Authentication check failed"));
    }
    req.user = user;
    next();
  });
};

export const verifyUser = (req, res, next) => {
  verifyToken(req, res, next);
};

export const verifyAdmin = (req, res, next) => {
  verifyToken(req, res, (err) => {
    if (err) return next(err);

    if (!req.user?.adminAccess && !isSystemAdminUser(req.user)) {
      return next(createError(403, "Admin access required"));
    }

    next();
  });
};

// Requires setup or admin access — for company configuration endpoints
export const verifySetupAccess = (req, res, next) => {
  verifyToken(req, res, (err) => {
    if (err) return next(err);

    if (!req.user?.setupAccess && !req.user?.adminAccess && !isSystemAdminUser(req.user)) {
      return next(createError(403, "Setup or admin access required"));
    }

    next();
  });
};

export const verifySuperAdmin = (req, res, next) => {
  verifyToken(req, res, (err) => {
    if (err) return next(err);

    if (!isSystemAdminUser(req.user)) {
      return next(createError(403, "Super Admin access required"));
    }

    next();
  });
};

export const verifyCompanyScope = (req, res, next) => {
  verifyToken(req, res, (err) => {
    if (err) return next(err);

    if (isSystemAdminUser(req.user)) {
      return next();
    }

    if (!req.user?.company) {
      return next(createError(403, "No company associated with user"));
    }

    req.userCompany = normalizeCompanyId(req.user.company);
    next();
  });
};

// Modules that grant access to the shared accounting layer (Chart of Accounts + Journal Entries).
// Any company with at least one of these modules enabled can read GL data.
// Only the "accounts" module grants write/admin access to the COA.
export const GL_ACCESS_MODULES = ["accounts", "propertyManagement", "hr", "carwash"];

export const requireCompanyModule = (moduleKeyOrKeys, options = {}) => {
  // Accept a string or array. Array = OR semantics: company must have at least one.
  const moduleKeys = Array.isArray(moduleKeyOrKeys) ? moduleKeyOrKeys : [moduleKeyOrKeys];

  return async (req, res, next) => {
    try {
      if (isSystemAdminUser(req.user)) {
        return next();
      }

      if (!getActiveCompanyIdFromRequest(req)) {
        return next(createError(403, "No company associated with user"));
      }

      const company = await attachResolvedCompany(req);
      if (!company) {
        return next(createError(404, "Company not found"));
      }

      const hasAccess = moduleKeys.some((key) => hasModuleAccess(req.user, company, key, options));
      if (!hasAccess) {
        const label = moduleKeys.length === 1 ? moduleKeys[0] : `one of [${moduleKeys.join(", ")}]`;
        return next(createError(403, `${label} module is not enabled for this company or user`));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export const requireCompanyPermission = (resource, action = "view", moduleKey = null) => {
  return async (req, _res, next) => {
    try {
      if (isSystemAdminUser(req.user)) return next();
      const company = await attachResolvedCompany(req);
      const allowed = hasCompanyActionPermission({
        user: req.user,
        company,
        moduleKey,
        resource,
        action,
      });
      if (!allowed) {
        return next(createError(403, `Permission denied for ${resource}.${action}`));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const loadCompanyContext = async (req, res, next) => {
  try {
    await attachResolvedCompany(req);
    next();
  } catch (error) {
    next(error);
  }
};

export const enforceRequestedCompanyScope = (req, _res, next) => {
  try {
    if (!req.user || isSystemAdminUser(req.user)) {
      return next();
    }

    const activeCompanyId = normalizeCompanyId(req.user?.company);
    if (!activeCompanyId) {
      return next(createError(403, "No active company selected for this request"));
    }

    const requestedCompanyIds = getRequestedCompanyIds(req);
    const invalidCompanyId = requestedCompanyIds.find(
      (companyId) => String(companyId) !== String(activeCompanyId)
    );

    if (invalidCompanyId) {
      return next(createError(403, "Cross-company requests are not allowed in the current session"));
    }

    req.userCompany = activeCompanyId;
    next();
  } catch (error) {
    next(error);
  }
};

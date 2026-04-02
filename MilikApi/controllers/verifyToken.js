import jwt from "jsonwebtoken";
import Company from "../models/Company.js";
import { createError } from "../utils/error.js";
import { hasModuleAccess, serializeCompanyForClient } from "../utils/companyModules.js";
import { getAccessibleCompanyIds, hasCompanyActionPermission } from "../utils/permissionControl.js";
import { extractAuthCookieToken } from "../utils/authCookie.js";

const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
};

export const normalizeCompanyId = (company) => {
  if (!company) return null;
  if (typeof company === "string") return company;
  if (company?._id) return String(company._id);
  return String(company);
};

export const canAccessCompanyId = (user, companyId) => {
  if (!companyId) return false;
  if (user?.isSystemAdmin || user?.superAdminAccess) return true;
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

const attachResolvedCompany = async (req) => {
  if (req.companyContext) return req.companyContext;

  const companyId = normalizeCompanyId(req.user?.company);
  if (!companyId) {
    req.companyContext = null;
    return null;
  }

  const company = await Company.findById(companyId).lean();
  req.companyContext = company ? serializeCompanyForClient(company, req.user) : null;
  return req.companyContext;
};

const extractBearerToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }

  return extractAuthCookieToken(req.cookies);
};

export const tryAttachUserFromToken = (req, _res, next) => {
  if (req.user) return next();
  const token = extractBearerToken(req);
  if (!token) return next();

  try {
    req.user = jwt.verify(token, getJWTSecret());
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

  jwt.verify(token, getJWTSecret(), (err, user) => {
    if (err) return next(createError(403, "Token is not valid!"));
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

    if (!req.user?.adminAccess && !req.user?.superAdminAccess) {
      return next(createError(403, "Admin access required"));
    }

    next();
  });
};

export const verifySuperAdmin = (req, res, next) => {
  verifyToken(req, res, (err) => {
    if (err) return next(err);

    if (!req.user?.superAdminAccess) {
      return next(createError(403, "Super Admin access required"));
    }

    next();
  });
};

export const verifyCompanyScope = (req, res, next) => {
  verifyToken(req, res, (err) => {
    if (err) return next(err);

    if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
      return next();
    }

    if (!req.user?.company) {
      return next(createError(403, "No company associated with user"));
    }

    req.userCompany = normalizeCompanyId(req.user.company);
    next();
  });
};

export const requireCompanyModule = (moduleKey, options = {}) => {
  return async (req, res, next) => {
    try {
      if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
        return next();
      }

      if (!req.user?.company) {
        return next(createError(403, "No company associated with user"));
      }

      const company = await attachResolvedCompany(req);
      if (!company) {
        return next(createError(404, "Company not found"));
      }

      if (!hasModuleAccess(req.user, company, moduleKey, options)) {
        return next(createError(403, `${moduleKey} module is not enabled for this company or user`));
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
      if (req.user?.isSystemAdmin || req.user?.superAdminAccess) return next();
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
    if (!req.user || req.user?.isSystemAdmin || req.user?.superAdminAccess) {
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

import jwt from "jsonwebtoken";
import { extractAuthTokenFromCookieHeader } from "./authCookie.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Exact path set — prefix matching is intentionally avoided to prevent
// overly broad exemptions (e.g. a future /api/trial-accounts would not exempt).
const EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/trial",
  "/api/trial/access",
]);

const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required");
  return secret;
};

const extractToken = (req) => {
  // Primary: Authorization Bearer header (used by the SPA).
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const t = authHeader.split(" ")[1];
    if (t) return t;
  }
  // Fallback: HTTP-only auth cookie (used by server-side / direct API calls).
  return extractAuthTokenFromCookieHeader(req.headers.cookie || "");
};

export const blockDemoWrites = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  // Strip query string before path comparison.
  const rawPath = (req.originalUrl || req.url || "").split("?")[0];
  if (EXEMPT_PATHS.has(rawPath)) return next();

  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = jwt.verify(token, getJWTSecret());
    if (payload?.isDemoUser) {
      return res.status(403).json({
        success: false,
        message: "Demo mode is read-only. Subscribe to activate your own live workspace.",
      });
    }
  } catch {
    // Invalid / expired token — let downstream auth middleware handle it.
  }

  return next();
};

export default blockDemoWrites;

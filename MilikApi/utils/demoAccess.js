import jwt from "jsonwebtoken";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT_PREFIXES = ["/api/trial"];
const EXEMPT_EXACT_PATHS = new Set(["/api/auth/logout"]);

const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
};

export const blockDemoWrites = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const path = req.originalUrl || req.url || "";
  if (EXEMPT_EXACT_PATHS.has(path) || EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return next();

  const token = authHeader.split(" ")[1];
  if (!token) return next();

  try {
    const payload = jwt.verify(token, getJWTSecret());
    if (payload?.isDemoUser) {
      return res.status(403).json({
        success: false,
        message: "Demo mode is read-only. Subscribe to activate your own live workspace.",
      });
    }
  } catch (error) {
    // Let downstream auth middleware handle invalid tokens.
  }

  return next();
};

export default blockDemoWrites;

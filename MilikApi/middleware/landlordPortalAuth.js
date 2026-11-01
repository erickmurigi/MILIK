import jwt from "jsonwebtoken";

const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required");
  return secret;
};

export const LANDLORD_PORTAL_JWT_OPTIONS = {
  issuer: "milik-api",
  audience: "milik-client",
};

export const signLandlordPortalToken = (landlord, company) =>
  jwt.sign(
    { landlordId: String(landlord._id), companyId: String(company._id), role: "landlordPortal" },
    getJWTSecret(),
    { ...LANDLORD_PORTAL_JWT_OPTIONS, expiresIn: "12h" }
  );

// Mirrors modules/hr/routes/essPortal.js's verifyESS — a landlord is not a company User,
// so this deliberately does not go through controllers/verifyToken.js's staff-shaped chain.
export const verifyLandlordPortalToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  try {
    const decoded = jwt.verify(authHeader.slice(7), getJWTSecret(), LANDLORD_PORTAL_JWT_OPTIONS);
    if (decoded.role !== "landlordPortal") {
      return res.status(403).json({ message: "Forbidden" });
    }
    req.landlordPortal = {
      landlordId: decoded.landlordId,
      companyId: decoded.companyId,
    };
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired session. Please log in again." });
  }
};

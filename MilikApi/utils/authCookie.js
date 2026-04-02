const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || "milik_auth").trim() || "milik_auth";
const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
};

export const getAuthCookieName = () => AUTH_COOKIE_NAME;

export const buildAuthCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const secure = parseBoolean(process.env.AUTH_COOKIE_SECURE, isProduction);
  const sameSite = String(process.env.AUTH_COOKIE_SAME_SITE || (secure ? "none" : "lax"))
    .trim()
    .toLowerCase();
  const domain = String(process.env.AUTH_COOKIE_DOMAIN || "").trim();

  const options = {
    httpOnly: true,
    secure,
    sameSite: ["strict", "lax", "none"].includes(sameSite) ? sameSite : "lax",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  };

  if (domain) options.domain = domain;
  return options;
};

export const attachAuthCookie = (res, token) => {
  if (!res || !token) return;
  res.cookie(getAuthCookieName(), token, buildAuthCookieOptions());
};

export const clearAuthCookie = (res) => {
  if (!res) return;
  res.clearCookie(getAuthCookieName(), {
    ...buildAuthCookieOptions(),
    maxAge: undefined,
    expires: new Date(0),
  });
};

export const extractAuthCookieToken = (cookies = {}) => {
  if (!cookies || typeof cookies !== "object") return null;
  const token = cookies[getAuthCookieName()];
  return token ? String(token) : null;
};

export const extractAuthTokenFromCookieHeader = (cookieHeader = "") => {
  if (!cookieHeader || typeof cookieHeader !== "string") return null;
  const target = `${getAuthCookieName()}=`;
  const parts = cookieHeader.split(';');

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (part.startsWith(target)) {
      return decodeURIComponent(part.slice(target.length));
    }
  }

  return null;
};

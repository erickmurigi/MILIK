function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function parseEnvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isProductionEnvironment() {
  return env("NODE_ENV").toLowerCase() === "production";
}

function normalizeUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return url.toString().replace(/\/$/, "");
  } catch (_error) {
    return "";
  }
}

function normalizeOrigin(value = "") {
  const normalized = normalizeUrl(value);
  if (!normalized) return "";

  try {
    return new URL(normalized).origin;
  } catch (_error) {
    return "";
  }
}

function resolveFrontendBaseUrl() {
  const directCandidates = [
    env("APP_BASE_URL"),
    env("CLIENT_BASE_URL"),
    env("PUBLIC_BASE_URL"),
    env("CLIENT_URL"),
    env("FRONTEND_URL"),
  ]
    .map(normalizeUrl)
    .filter(Boolean);

  if (directCandidates.length) {
    return directCandidates[0];
  }

  const originFromAllowedOrigins = parseEnvList(env("ALLOWED_ORIGINS"))
    .map(normalizeOrigin)
    .find((origin) => origin && !/^http:\/\/localhost:\d+$/i.test(origin));

  if (originFromAllowedOrigins) {
    return originFromAllowedOrigins;
  }

  const localhostFallback = "http://localhost:5173";

  if (isProductionEnvironment()) {
    console.warn(
      "Missing APP_BASE_URL / CLIENT_BASE_URL / PUBLIC_BASE_URL / CLIENT_URL / FRONTEND_URL in production. Falling back to localhost links; set a public frontend URL before sending onboarding or demo emails."
    );
  }

  return localhostFallback;
}

export function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function sanitizeBaseUrl(value, fallbackPath) {
  const normalized = normalizeUrl(value || resolveFrontendBaseUrl());
  if (/\/(login|home)$/i.test(normalized)) return normalized;
  return `${normalized}${fallbackPath}`;
}

export function buildAppLoginUrl() {
  return sanitizeBaseUrl(resolveFrontendBaseUrl(), "/login");
}

export function buildPublicHomeUrl() {
  return sanitizeBaseUrl(resolveFrontendBaseUrl(), "/home");
}

export function buildTemporaryPassword(email = "") {
  const localPart = String(email || "")
    .split("@")[0]
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  const random = String(Math.floor(100 + Math.random() * 900));
  const base = localPart || "milikuser";
  const candidate = `${base}${random}`;
  if (candidate.length >= 8) return candidate;
  return `milik${random}${base}`.slice(0, 16);
}

import crypto from "crypto";
import nodemailer from "nodemailer";

export function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function resolveEmailConfigSecret() {
  return env("EMAIL_CONFIG_SECRET") || env("JWT_SECRET");
}

function getEmailConfigKey() {
  const secret = resolveEmailConfigSecret();
  if (!secret) {
    throw new Error("EMAIL_CONFIG_SECRET or JWT_SECRET environment variable is required");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptStoredSecret(value = "") {
  const raw = String(value || "");
  if (!raw) return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEmailConfigKey(), iv);
  const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptStoredSecret(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("enc:")) return raw;

  const payload = raw.slice(4);
  const [ivB64, tagB64, encryptedB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !encryptedB64) {
    throw new Error("Stored secret format is invalid");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEmailConfigKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function hasSmtpConfig() {
  return Boolean(env("SMTP_HOST") && env("SMTP_PORT") && env("SMTP_USER") && env("SMTP_PASS"));
}

export function buildSmtpTransporter() {
  return nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT") || 465),
    secure: env("SMTP_SECURE", "true") === "true",
    auth: {
      user: env("SMTP_USER"),
      pass: env("SMTP_PASS"),
    },
  });
}

export function buildCompanySmtpTransporter(profile = {}) {
  const host = String(profile?.smtpHost || "").trim();
  const port = Number(profile?.smtpPort || 0);
  const encryption = String(profile?.encryption || "ssl").trim().toLowerCase();
  const username = String(profile?.username || "").trim();
  const password = decryptStoredSecret(profile?.passwordEncrypted || profile?.password || "");

  if (!host || !port || !username || !password) {
    throw new Error("SMTP profile is incomplete");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: encryption === "ssl",
    requireTLS: encryption === "tls",
    auth: {
      user: username,
      pass: password,
    },
  });
}

export function resolveMailSender(...preferredEnvNames) {
  const envNames = [
    ...preferredEnvNames,
    "ONBOARDING_FROM_EMAIL",
    "TRIAL_FROM_EMAIL",
    "SMTP_FROM_EMAIL",
    "SMTP_USER",
  ];

  for (const envName of envNames) {
    const value = env(envName);
    if (value) return value;
  }

  return "";
}

export function resolveCompanyMailSender(profile = {}) {
  const senderEmail = String(profile?.senderEmail || "").trim();
  const senderName = String(profile?.senderName || "").trim();
  if (!senderEmail) return "";
  return senderName ? `${senderName} <${senderEmail}>` : senderEmail;
}

export function buildCompanyInternalCopyRecipients(profile = {}) {
  const mode = String(profile?.internalCopyMode || "none").trim().toLowerCase();
  const email = String(profile?.internalCopyEmail || "").trim();

  if (!email || mode === "none") {
    return {};
  }

  if (mode === "cc") {
    return { cc: email };
  }

  return { bcc: email };
}

export function resolvePrimaryNotificationRecipient() {
  return env("TRIAL_NOTIFICATION_EMAIL") || env("ONBOARDING_NOTIFICATION_EMAIL") || env("SMTP_USER");
}

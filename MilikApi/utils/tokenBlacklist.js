import TokenBlacklist from "../models/TokenBlacklist.js";

// In-memory cache for fast synchronous reads within the same process.
// Populated on startup from MongoDB, and updated on every addToBlacklist call.
const cache = new Map();         // token -> expiresAtMs (positive = blacklisted)
const negativeCache = new Map(); // token -> expiresAtMs (confirmed clean within this window)
const NEGATIVE_CACHE_TTL_MS = 60_000;

const cleanup = () => {
  const now = Date.now();
  for (const [token, expiresAt] of cache) {
    if (expiresAt <= now) cache.delete(token);
  }
  for (const [token, expiresAt] of negativeCache) {
    if (expiresAt <= now) negativeCache.delete(token);
  }
};

const cleanupTimer = setInterval(cleanup, 5 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

// Warm the in-memory cache from MongoDB on startup (non-blocking, best-effort).
export const warmBlacklistCache = async () => {
  try {
    const docs = await TokenBlacklist.find({ expiresAt: { $gt: new Date() } })
      .select("token expiresAt")
      .lean();
    for (const doc of docs) {
      cache.set(doc.token, new Date(doc.expiresAt).getTime());
    }
  } catch (_err) {
    // Non-fatal — the DB check in isBlacklisted covers the gap.
  }
};

export const addToBlacklist = async (token, expiresAtMs) => {
  if (!token || expiresAtMs <= Date.now()) return;
  cache.set(token, expiresAtMs);
  try {
    await TokenBlacklist.updateOne(
      { token },
      { $set: { expiresAt: new Date(expiresAtMs) } },
      { upsert: true }
    );
  } catch (_err) {
    // DB write failed — the in-memory entry still guards this process; log but don't throw.
    console.warn("[tokenBlacklist] Failed to persist revoked token to DB:", _err?.message);
  }
};

// Synchronous hot-path check (in-memory cache only).
export const isBlacklisted = (token) => {
  if (!token) return false;
  const expiresAt = cache.get(token);
  return expiresAt !== undefined && expiresAt > Date.now();
};

// Async DB check — cross-worker accurate. Caches both positive and negative results.
export const isBlacklistedAsync = async (token) => {
  if (!token) return false;
  if (isBlacklisted(token)) return true;
  // Negative cache: skip DB if this token was recently confirmed clean.
  const neg = negativeCache.get(token);
  if (neg && neg > Date.now()) return false;
  try {
    const doc = await TokenBlacklist.findOne({ token, expiresAt: { $gt: new Date() } })
      .select("_id expiresAt")
      .lean();
    if (doc) {
      cache.set(token, new Date(doc.expiresAt).getTime());
      return true;
    }
    negativeCache.set(token, Date.now() + NEGATIVE_CACHE_TTL_MS);
    return false;
  } catch (_err) {
    return false;
  }
};

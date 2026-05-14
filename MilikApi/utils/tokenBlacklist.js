const blacklisted = new Map(); // token -> expiresAtMs

const cleanup = () => {
  const now = Date.now();
  for (const [token, expiresAt] of blacklisted) {
    if (expiresAt <= now) blacklisted.delete(token);
  }
};

// Purge expired entries every 5 minutes; unref so it doesn't block process exit
const cleanupTimer = setInterval(cleanup, 5 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

export const addToBlacklist = (token, expiresAtMs) => {
  if (token && expiresAtMs > Date.now()) {
    blacklisted.set(token, expiresAtMs);
  }
};

export const isBlacklisted = (token) => blacklisted.has(token);

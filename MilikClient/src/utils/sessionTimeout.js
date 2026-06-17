export const SESSION_LAST_ACTIVITY_KEY = "milik_last_activity_at";
export const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

export const getLastActivityAt = () => {
  try {
    const value = Number(localStorage.getItem(SESSION_LAST_ACTIVITY_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch (_error) {
    return null;
  }
};

export const markSessionActivity = (timestamp = Date.now()) => {
  try {
    localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(timestamp));
  } catch (_error) {
    // Ignore storage failures; the in-memory timer will still run for this tab.
  }
};

export const hasSessionTimedOut = (timestamp = Date.now()) => {
  const lastActivityAt = getLastActivityAt();
  return Boolean(lastActivityAt && timestamp - lastActivityAt >= INACTIVITY_TIMEOUT_MS);
};

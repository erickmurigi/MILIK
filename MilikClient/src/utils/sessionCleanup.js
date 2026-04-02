import { disconnectSocket } from "./socketService";

const SESSION_KEYS = [
  "milik_token",
  "milik_user",
  "token",
  "dXNlcg==",
  "app-tabs",
  "active-tab",
  "milik-open-modules",
  "milik-active-module",
  "persist:root",
];

const SESSION_KEY_PREFIXES = [
  "milik-workspace-tabs-",
  "milik-active-tabs-by-workspace-",
  "milik-open-modules-",
  "milik-active-module-",
];

export const clearClientSessionStorage = () => {
  disconnectSocket();

  try {
    const keysToRemove = new Set(SESSION_KEYS);

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (SESSION_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        keysToRemove.add(key);
      }
    }

    keysToRemove.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.warn(`Failed to remove storage key: ${key}`, error);
      }
    });
  } catch (error) {
    console.warn("Failed to clear localStorage session keys", error);
  }

  try {
    sessionStorage.clear();
  } catch (error) {
    console.warn("Failed to clear sessionStorage", error);
  }
};

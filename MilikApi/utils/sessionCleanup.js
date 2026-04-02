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
  "milik_active_company_id",
  "milik_demo_mode",
  "milik_demo_company_id",
  "persist:root",
];

export const clearClientSessionStorage = () => {
  disconnectSocket();

  SESSION_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`Failed to remove storage key: ${key}`, error);
    }
  });

  try {
    sessionStorage.clear();
  } catch (error) {
    console.warn("Failed to clear sessionStorage", error);
  }
};

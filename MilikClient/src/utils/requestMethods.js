import axios from "axios";
import { clearClientSessionStorage } from "./sessionCleanup";

const STORAGE_KEY = import.meta.env.VITE_STORAGE_KEY || "MilikPropertyManagement2026";
const DEMO_EXPIRED_NOTICE_KEY = "milik_demo_expired_notice";
const DEMO_EXPIRED_MESSAGE = "Your demo period has ended. Contact MILIK for activation.";
const EXTRA_SESSION_KEYS = ["milik_active_company_id", "milik_demo_mode", "milik_demo_company_id"];

// Use environment variable for API URL
const rawApiBaseUrl = String(import.meta.env.VITE_API_URL || "/api").trim();
const BASE_URL = rawApiBaseUrl.endsWith("/") ? rawApiBaseUrl : `${rawApiBaseUrl}/`;

const getStoredUser = () => {
  try {
    const raw = localStorage.getItem("milik_user");
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
};

const clearAuthArtifacts = () => {
  clearClientSessionStorage();

  EXTRA_SESSION_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`Failed to remove storage key: ${key}`, error);
    }
  });
};

const redirectToDemoExpiredHome = () => {
  try {
    sessionStorage.setItem(DEMO_EXPIRED_NOTICE_KEY, DEMO_EXPIRED_MESSAGE);
  } catch (_error) {
    // Ignore storage write failures and still redirect.
  }

  window.location.href = "/home?demoExpired=1";
};

/**
 * Centralized Axios client for MILIK API requests
 * Automatically attaches JWT token from localStorage (Redux persisted auth)
 */
export const adminRequests = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000, // 30 second timeout
});

// Request interceptor - attach auth token from Redux persisted state
adminRequests.interceptors.request.use(
  (config) => {
    // Get token from localStorage (synced by Redux auth on login/logout)
    const token = localStorage.getItem("milik_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle common errors
adminRequests.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // Server responded with error status
      switch (error.response.status) {
        case 401:
        case 403: {
          const responseMessage = String(
            error.response?.data?.message || error.response?.data?.error || error.message || ""
          );
          const isAuthFailure =
            error.response.status === 401 ||
            /token is not valid|not authenticated/i.test(responseMessage);

          if (isAuthFailure && error.config?.url && !error.config.url.includes("/auth/login")) {
            const storedUser = getStoredUser();
            clearAuthArtifacts();

            if (storedUser?.isDemoUser) {
              redirectToDemoExpiredHome();
            } else {
              window.location.href = "/login";
            }
          } else if (error.response.status === 403) {
            console.error(
              "Access forbidden:",
              error.response?.data?.error || error.response?.data?.message || error.message
            );
          }
          break;
        }
        case 404:
          console.error(
            "Resource not found:",
            error.response?.data?.error || error.response?.data?.message || error.message
          );
          break;
        case 500:
          console.error(
            "Server error:",
            error.response?.data?.error || error.response?.data?.message || error.message
          );
          break;
        default:
          console.error("API Error:", error.response.data);
      }
    } else if (error.request) {
      // Request made but no response received
      console.error("Network error - no response received");
    } else {
      // Something else happened
      console.error("Request error:", error.message);
    }

    return Promise.reject(error);
  }
);

export { STORAGE_KEY };

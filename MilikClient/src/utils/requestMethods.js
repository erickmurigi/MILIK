import axios from "axios";
import { clearClientSessionStorage } from "./sessionCleanup";
import { markSessionActivity } from "./sessionTimeout";

const STORAGE_KEY = import.meta.env.VITE_STORAGE_KEY || "MilikPropertyManagement2026";
const EXTRA_SESSION_KEYS = ["milik_active_company_id"];

// Use environment variable for API URL
const rawApiBaseUrl = String(import.meta.env.VITE_API_URL || "/api").trim();
const BASE_URL = rawApiBaseUrl.endsWith("/") ? rawApiBaseUrl : `${rawApiBaseUrl}/`;

const shouldSkipAuthHeader = (url = "") => {
  const requestUrl = String(url || "");
  return /(^|\/)auth\/login(?:\?|$)/.test(requestUrl);
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
    if (shouldSkipAuthHeader(config.url)) {
      if (config.headers) {
        delete config.headers.Authorization;
        delete config.headers.authorization;
      }
      return config;
    }

    // Get token from localStorage (synced by Redux auth on login/logout)
    const token = localStorage.getItem("milik_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    const activeCompanyId = localStorage.getItem("milik_active_company_id");
    if (activeCompanyId) {
      config.headers["x-active-company-id"] = activeCompanyId;
      config.headers["x-company-id"] = activeCompanyId;
    }

    // Let axios set Content-Type automatically for FormData (multipart/form-data with boundary)
    if (config.data instanceof FormData) {
      delete config.headers["Content-Type"];
    }

    // Extend session on user-initiated requests. Skips GETs (background polls shouldn't
    // keep an abandoned session alive).
    if (token && String(config.method || '').toUpperCase() !== 'GET') {
      markSessionActivity();
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

          const authSelfUrl = error.config?.url || "";
          const isAuthSelfEndpoint =
            authSelfUrl.includes("/auth/login") ||
            authSelfUrl.includes("/auth/refresh");
          if (isAuthFailure && !isAuthSelfEndpoint) {
            clearAuthArtifacts();
            window.location.href = "/login";
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
          console.error("API Error:", JSON.stringify(error.response.data, null, 2));
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

import axios from 'axios';

const rawApiBaseUrl = String(import.meta.env.VITE_API_URL || '/api').trim();
const BASE_URL = rawApiBaseUrl.endsWith('/') ? rawApiBaseUrl : `${rawApiBaseUrl}/`;

export const LANDLORD_PORTAL_TOKEN_KEY = 'landlord_portal_token';

export const landlordPortalRequests = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

landlordPortalRequests.interceptors.request.use((config) => {
  const token = localStorage.getItem(LANDLORD_PORTAL_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

landlordPortalRequests.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(LANDLORD_PORTAL_TOKEN_KEY);
      localStorage.removeItem('landlord_portal_landlord');
      localStorage.removeItem('landlord_portal_company');
      if (!window.location.pathname.startsWith('/landlord-portal/login')) {
        window.location.href = '/landlord-portal/login';
      }
    }
    return Promise.reject(error);
  }
);

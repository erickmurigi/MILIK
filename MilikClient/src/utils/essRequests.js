import axios from 'axios';

const rawApiBaseUrl = String(import.meta.env.VITE_API_URL || '/api').trim();
const BASE_URL = rawApiBaseUrl.endsWith('/') ? rawApiBaseUrl : `${rawApiBaseUrl}/`;

export const ESS_TOKEN_KEY = 'ess_token';

export const essRequests = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

essRequests.interceptors.request.use((config) => {
  const token = localStorage.getItem(ESS_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

essRequests.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(ESS_TOKEN_KEY);
      localStorage.removeItem('ess_employee');
      localStorage.removeItem('ess_company');
      if (!window.location.pathname.startsWith('/ess/login')) {
        window.location.href = '/ess/login';
      }
    }
    return Promise.reject(error);
  }
);

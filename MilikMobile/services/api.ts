import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, STORAGE_KEYS } from '../constants';
import { store } from '../redux/store';
import { clearCredentials, setToken } from '../redux/slices/authSlice';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT on every request
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Global auth-failure handler — clear storage and let the app redirect to login.
// verifyUser (MilikApi/controllers/verifyToken.js) returns 401 when no token was sent
// at all, but 403 "Token is not valid!" when the token IS present but expired/malformed/
// signed with a stale secret — a 403 was never handled here, so once a token expired the
// app kept re-sending the same dead token on every request forever, showing the same
// "invalid token" error on every module with no way out short of a manual logout. Other
// legitimate 403s (permission denied, module not enabled, etc.) must NOT force a logout,
// so this matches the specific auth-failure messages rather than the status code alone.
const AUTH_FAILURE_MESSAGES = new Set([
  'Token is not valid!',
  'Session has been revoked. Please log in again.',
  'You are not authenticated!',
]);

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err?.response?.status;
    const message = err?.response?.data?.message;
    const isAuthFailure = status === 401 || (status === 403 && AUTH_FAILURE_MESSAGES.has(message));
    if (isAuthFailure) {
      try {
        await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
        await AsyncStorage.removeItem(STORAGE_KEYS.USER);
        await AsyncStorage.removeItem(STORAGE_KEYS.COMPANY);
      } catch (_) {}
      // Clearing storage alone only takes effect on the next app launch — the (app)
      // route guard redirects to login off Redux's live auth.token, so that has to be
      // cleared too for the user to land on the login screen immediately instead of
      // staying stuck on the broken screen until they manually force-close the app.
      store.dispatch(clearCredentials());
    }
    return Promise.reject(err);
  }
);

// Silent token refresh — the only thing standing between a user and getting logged out
// just because 7 days passed. /auth/refresh (MilikApi/controllers/authController.js) only
// rotates the token once it's within 2 days of expiring, and only on a token that hasn't
// expired YET (jwt.verify throws on an already-expired one, same as any other request) —
// so this has to run proactively, before expiry, not reactively after a 403. It's safe to
// call anytime a token exists: outside that 2-day window the backend just hands the same
// token back unchanged. Call this on launch and whenever the app returns to the foreground
// so an active user's session effectively never expires on its own — only an explicit
// logout, or a genuinely revoked/tampered token, should ever sign them out.
export const refreshAuthToken = async (): Promise<void> => {
  try {
    const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (!token) return;
    const { data } = await api.post('/auth/refresh');
    if (data?.success && data?.token && data.token !== token) {
      await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
      store.dispatch(setToken(data.token));
    }
  } catch (_) {
    // Transient network failure, or a genuinely dead token — either way, do nothing here.
    // A dead token will surface properly through the response interceptor above on the
    // next real API call; refresh failing on its own is never a reason to log someone out.
  }
};

export default api;

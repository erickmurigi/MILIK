import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, STORAGE_KEYS } from '../constants';
import { store } from '../redux/store';
import { clearLandlordPortalCredentials } from '../redux/slices/landlordPortalAuthSlice';

// A fully separate axios instance + interceptors from services/api.ts's staff client —
// a landlord-portal auth failure must only ever clear the landlord-portal session, never
// the staff one (and vice versa), since both can be logged in on the same device.
const landlordPortalApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

landlordPortalApi.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem(STORAGE_KEYS.LANDLORD_PORTAL_TOKEN);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

landlordPortalApi.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err?.response?.status;
    if (status === 401 || status === 403) {
      try {
        await AsyncStorage.removeItem(STORAGE_KEYS.LANDLORD_PORTAL_TOKEN);
        await AsyncStorage.removeItem(STORAGE_KEYS.LANDLORD_PORTAL_LANDLORD);
        await AsyncStorage.removeItem(STORAGE_KEYS.LANDLORD_PORTAL_COMPANY);
      } catch (_) {}
      store.dispatch(clearLandlordPortalCredentials());
    }
    return Promise.reject(err);
  }
);

export default landlordPortalApi;

// Internal helpers shared across the apiCalls/* domain files. Nothing here is
// re-exported by the redux/apiCalls.js barrel — domain files import directly
// from this module. Keeping it dependency-light (only ../store) is deliberate:
// it's the one place the store singleton is imported, so any future
// circular-import risk has a single, auditable entry point.
import { store } from "../store";

// Legacy (non-createAsyncThunk) list-fetch helpers take `dispatch` as a plain
// argument rather than being dispatched themselves, so they read the store
// singleton directly to check freshness before refetching.
export const LIST_CACHE_TTL_MS = 5000;
export const isListCacheFresh = (loadedFor, loadedAt, businessKey) =>
  Boolean(businessKey) && loadedFor === businessKey && Date.now() - loadedAt < LIST_CACHE_TTL_MS;

export { store };

// Ensure list reducers always receive an array regardless of API response wrapper.
export const extractList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.notifications)) return payload.notifications;
  if (Array.isArray(payload?.companies)) return payload.companies;
  if (Array.isArray(payload?.users)) return payload.users;
  return [];
};

export const getStoredUser = () => {
  try {
    const raw = localStorage.getItem("milik_user");
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

export const resolveCompanyFromPayload = (payload = {}) => {
  if (payload?.company?._id) return payload.company;
  if (payload?.user?.company?._id) return payload.user.company;
  if (payload?.currentCompany?._id) return payload.currentCompany;
  return null;
};

export const resolveCompanyId = (query = {}, getState) => {
  if (query?.company) return query.company;

  const state = typeof getState === "function" ? getState() : {};
  const companyFromState = state?.company?.currentCompany?._id;
  if (companyFromState) return companyFromState;

  const authUser = state?.auth?.currentUser || state?.auth?.user;
  if (authUser?.company?._id) return authUser.company._id;
  if (typeof authUser?.company === "string") return authUser.company;

  const storedUser = getStoredUser();
  if (storedUser?.company?._id) return storedUser.company._id;
  if (typeof storedUser?.company === "string") return storedUser.company;

  return null;
};

export const resolveLandlordIdFromProperty = (propertyId, getState) => {
  if (!propertyId) return null;
  const state = typeof getState === "function" ? getState() : {};
  const properties = Array.isArray(state?.property?.properties) ? state.property.properties : [];
  const property = properties.find((item) => String(item?._id) === String(propertyId));
  if (!property) return null;

  const landlords = Array.isArray(property?.landlords) ? property.landlords : [];
  const primary = landlords.find((item) => item?.isPrimary && item?.landlordId);
  const fallback = landlords.find((item) => item?.landlordId);
  return primary?.landlordId || fallback?.landlordId || null;
};

// Generic URLSearchParams builder used across several report/list endpoints.
// (Previously duplicated byte-for-byte as both `buildQuery` and
// `buildPropertyLedgerQuery` in the old apiCalls.js — unified here.)
export const buildQuery = (params) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== "") s.append(k, v);
  });
  return s.toString();
};

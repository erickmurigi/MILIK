/**
 * Memoized Redux selectors.
 *
 * Two things this file fixes:
 *   1. `useSelector(state => state.x?.items || [])` creates a brand-new [] on every
 *      render when items is null/undefined, so React-Redux always sees a new reference
 *      and triggers a re-render even when nothing changed.
 *      createSelector caches the last result and only recomputes when the input slice
 *      actually changes, returning the same reference otherwise.
 *
 *   2. Derived state (filter/map) inside useSelector runs on every store update even
 *      when the underlying slice is unchanged.
 *      createSelector makes those derivations only re-run when their specific input
 *      slice changes.
 *
 * Import from here instead of writing inline selectors in components.
 */
import { createSelector } from "@reduxjs/toolkit";

// ─── Stable empty defaults (single references, never recreated) ────────────
const EMPTY_ARRAY = [];

// ─── Auth ──────────────────────────────────────────────────────────────────
export const selectCurrentUser  = (state) => state.auth?.currentUser  ?? null;
export const selectIsLoggedIn   = (state) => Boolean(state.auth?.isLoggedIn);
export const selectAuthToken    = (state) => state.auth?.token        ?? null;

// ─── Company ───────────────────────────────────────────────────────────────
export const selectCurrentCompany = (state) => state.company?.currentCompany ?? null;
export const selectCurrentCompanyId = createSelector(
  selectCurrentCompany,
  (company) => company?._id ?? null
);

// ─── Properties ────────────────────────────────────────────────────────────
const selectPropertySlice = (state) => state.property?.properties;

export const selectAllProperties = createSelector(
  selectPropertySlice,
  (properties) => (Array.isArray(properties) ? properties : EMPTY_ARRAY)
);

export const selectActiveProperties = createSelector(
  selectAllProperties,
  (properties) =>
    properties.filter(
      (p) => String(p?.status || "").toLowerCase() !== "archived"
    )
);

// ─── Landlords ─────────────────────────────────────────────────────────────
const selectLandlordSlice = (state) => state.landlord?.landlords;

export const selectAllLandlords = createSelector(
  selectLandlordSlice,
  (landlords) => (Array.isArray(landlords) ? landlords : EMPTY_ARRAY)
);

export const selectActiveLandlords = createSelector(
  selectAllLandlords,
  (landlords) =>
    landlords.filter(
      (l) => String(l?.status || "").toLowerCase() !== "archived"
    )
);

// ─── Tenants ───────────────────────────────────────────────────────────────
const selectTenantSlice = (state) => state.tenant?.tenants;

const INACTIVE_TENANT_STATUSES = new Set([
  "terminated", "evicted", "moved_out", "inactive",
]);

export const selectAllTenants = createSelector(
  selectTenantSlice,
  (tenants) => (Array.isArray(tenants) ? tenants : EMPTY_ARRAY)
);

export const selectActiveTenants = createSelector(
  selectAllTenants,
  (tenants) =>
    tenants.filter(
      (t) => !INACTIVE_TENANT_STATUSES.has(String(t?.status || "").toLowerCase())
    )
);

// ─── Units ─────────────────────────────────────────────────────────────────
const selectUnitSlice = (state) => state.unit?.units;

export const selectAllUnits = createSelector(
  selectUnitSlice,
  (units) => (Array.isArray(units) ? units : EMPTY_ARRAY)
);

export const selectVacantUnits = createSelector(
  selectAllUnits,
  (units) =>
    units.filter((u) => String(u?.status || "").toLowerCase() === "vacant")
);

// ─── Rent Payments ─────────────────────────────────────────────────────────
const selectRentPaymentSlice = (state) => state.rentPayment?.rentPayments;

const normalizePaymentList = (value) => {
  if (Array.isArray(value))       return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.rentPayments)) return value.rentPayments;
  return EMPTY_ARRAY;
};

export const selectAllRentPayments = createSelector(
  selectRentPaymentSlice,
  normalizePaymentList
);

// ─── Maintenance ───────────────────────────────────────────────────────────
const selectMaintenanceSlice = (state) => state.maintenance?.maintenances;

export const selectAllMaintenances = createSelector(
  selectMaintenanceSlice,
  (maintenances) => (Array.isArray(maintenances) ? maintenances : EMPTY_ARRAY)
);

// ─── Leases ────────────────────────────────────────────────────────────────
const selectLeaseSlice = (state) => state.lease?.leases;

export const selectAllLeases = createSelector(
  selectLeaseSlice,
  (leases) => (Array.isArray(leases) ? leases : EMPTY_ARRAY)
);

// ─── Notifications ─────────────────────────────────────────────────────────
const selectNotificationSlice = (state) => state.notification?.notifications;

export const selectAllNotifications = createSelector(
  selectNotificationSlice,
  (notifications) =>
    Array.isArray(notifications) ? notifications : EMPTY_ARRAY
);

export const selectUnreadNotifications = createSelector(
  selectAllNotifications,
  (notifications) => notifications.filter((n) => !n.isRead)
);

export const selectUnreadCount = createSelector(
  selectUnreadNotifications,
  (unread) => unread.length
);

// Shared cache-check hook — returns whether each core entity collection is already
// loaded for the current business within the staleness window, so pages can skip
// redundant dispatches on re-visit.
//
// A collection is considered "fresh" when:
//   1. loadedFor matches the current business ID, AND
//   2. loadedAt is within STALE_MS milliseconds of now.
//
// Usage in any page:
//   const {
//     propertiesLoaded, unitsLoaded, tenantsLoaded, rentPaymentsLoaded,
//     leasesLoaded, utilitiesLoaded
//   } = useEntityCache(currentCompany?._id);
//
//   useEffect(() => {
//     if (!propertiesLoaded)   dispatch(getProperties({ business: businessId }));
//     if (!unitsLoaded)        dispatch(getUnits({ business: businessId }));
//     if (!tenantsLoaded)      dispatch(getTenants({ business: businessId }));
//     if (!rentPaymentsLoaded) getRentPayments(dispatch, businessId);
//     // leasesLoaded is fresh after a company-wide getLeases call (no tenant/unit filter).
//     // Tenant-scoped lease fetches (TenantStatement) always run regardless.
//     if (!leasesLoaded)       getLeases(dispatch, businessId);
//     if (!utilitiesLoaded)    getUtilities(dispatch, businessId);
//   }, [businessId]);

import { useSelector } from 'react-redux';

// Collections fetched within this window are treated as fresh (skip re-fetch).
const STALE_MS = 30_000;

const isFresh = (loadedFor, loadedAt, bid) =>
  !!bid && loadedFor === bid && Date.now() - (loadedAt || 0) < STALE_MS;

export const useEntityCache = (businessId) => {
  const bid = String(businessId || '');

  const propertiesLoaded = useSelector((s) =>
    isFresh(s.property?.loadedFor, s.property?.loadedAt, bid)
  );
  const unitsLoaded = useSelector((s) =>
    isFresh(s.unit?.loadedFor, s.unit?.loadedAt, bid)
  );
  const tenantsLoaded = useSelector((s) =>
    isFresh(s.tenant?.loadedFor, s.tenant?.loadedAt, bid)
  );
  const rentPaymentsLoaded = useSelector((s) =>
    isFresh(s.rentPayment?.loadedFor, s.rentPayment?.loadedAt, bid)
  );
  // leasesLoaded is only true when a company-wide lease list (no tenant/unit filter)
  // was fetched within the stale window. Tenant-scoped fetches intentionally do NOT
  // set this flag to avoid polluting the global cache with a partial list.
  const leasesLoaded = useSelector((s) =>
    isFresh(s.lease?.loadedFor, s.lease?.loadedAt, bid)
  );
  const utilitiesLoaded = useSelector((s) =>
    isFresh(s.utility?.loadedFor, s.utility?.loadedAt, bid)
  );

  return {
    propertiesLoaded,
    unitsLoaded,
    tenantsLoaded,
    rentPaymentsLoaded,
    leasesLoaded,
    utilitiesLoaded,
  };
};

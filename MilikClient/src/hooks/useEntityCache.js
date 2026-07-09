// Shared cache-check hook — returns whether each core entity collection is already
// loaded for the current business, so pages can skip redundant dispatches on re-visit.
//
// Usage in any page:
//   const { propertiesLoaded, unitsLoaded, tenantsLoaded } = useEntityCache(currentCompany?._id);
//   useEffect(() => {
//     if (!propertiesLoaded) dispatch(getProperties({ business: businessId }));
//     if (!unitsLoaded)      dispatch(getUnits({ business: businessId }));
//     if (!tenantsLoaded)    dispatch(getTenants({ business: businessId }));
//   }, [businessId]);

import { useSelector } from 'react-redux';

export const useEntityCache = (businessId) => {
  const bid = String(businessId || '');
  const propertiesLoaded = useSelector((s) => !!bid && s.property?.loadedFor === bid);
  const unitsLoaded      = useSelector((s) => !!bid && s.unit?.loadedFor      === bid);
  const tenantsLoaded    = useSelector((s) => !!bid && s.tenant?.loadedFor    === bid);
  return { propertiesLoaded, unitsLoaded, tenantsLoaded };
};

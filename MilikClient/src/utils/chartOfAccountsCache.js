// Shared in-memory cache for the unfiltered "full chart of accounts for this business" fetch —
// the shape every page in the Financial module pulls and then filters client-side (by type,
// isPosting, isActive, etc.). Chart of Accounts rarely changes, but before this cache every one
// of Budget/Petty Cash/Petty Cash Accounts/Payment Vouchers/Journal Entries/Fixed Assets/Bank
// Reconciliation independently re-fetched the entire chart on every mount, including when just
// navigating back and forth between two of these pages in the same minute.
//
// Mirrors hooks/useEntityCache's staleness window (2 min) and philosophy: cross-page REFERENCE
// data only, never a page's own editable rows. Not redux-backed (unlike useEntityCache) because
// these pages call getChartOfAccounts directly rather than dispatching a redux action — a plain
// module-level Map is the simplest fit, same pattern as hooks/useTabState's own cache.
import { getChartOfAccounts } from "../redux/apiCalls";

const STALE_MS = 2 * 60_000;
const _cache = new Map(); // businessId -> { data, loadedAt }

export const getCachedChartOfAccounts = async (businessId, { force = false } = {}) => {
  if (!businessId) return [];
  const bid = String(businessId);
  const cached = _cache.get(bid);
  if (!force && cached && Date.now() - cached.loadedAt < STALE_MS) {
    return cached.data;
  }
  const res = await getChartOfAccounts({ business: bid });
  const data = Array.isArray(res) ? res : res?.data || [];
  _cache.set(bid, { data, loadedAt: Date.now() });
  return data;
};

export const invalidateChartOfAccountsCache = (businessId) => {
  if (businessId) _cache.delete(String(businessId));
  else _cache.clear();
};

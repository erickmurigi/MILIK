import { useCallback, useEffect, useRef, useState } from 'react';
import { apiError } from '../utils/pmsFormat';

export type Page<T> = { items: T[]; hasMore: boolean };

/** Debounce a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Paged / infinite list with stale-response protection.
 * `fetchPage` may change every render; the list reloads only when `resetKey` changes
 * (put the serialised filters + debounced search in it).
 */
export function usePagedList<T extends { _id: string }>(
  fetchPage: (page: number) => Promise<Page<T>>,
  resetKey: string,
) {
  const [items,       setItems]       = useState<T[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const fetchRef   = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const pageRef    = useRef(1);
  const hasMoreRef = useRef(false);
  const genRef     = useRef(0);       // bumps on every (re)load so late responses are dropped
  const moreBusy   = useRef(false);

  const reload = useCallback(async (mode: 'initial' | 'refresh') => {
    const gen = ++genRef.current;
    moreBusy.current = false;
    setLoadingMore(false);
    if (mode === 'refresh') setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const r = await fetchRef.current(1);
      if (gen !== genRef.current) return;
      pageRef.current = 1;
      hasMoreRef.current = r.hasMore;
      setItems(r.items);
    } catch (e) {
      if (gen !== genRef.current) return;
      setError(apiError(e, 'Could not load data. Pull down to retry.'));
      if (mode === 'initial') setItems([]);
    } finally {
      if (gen === genRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => { reload('initial'); }, [resetKey, reload]);

  const loadMore = useCallback(async () => {
    if (moreBusy.current || !hasMoreRef.current) return;
    moreBusy.current = true;
    const gen = genRef.current;
    setLoadingMore(true);
    try {
      const r = await fetchRef.current(pageRef.current + 1);
      if (gen !== genRef.current) return;
      pageRef.current += 1;
      hasMoreRef.current = r.hasMore;
      setItems(prev => {
        const seen = new Set(prev.map(x => x._id));
        return [...prev, ...r.items.filter(x => !seen.has(x._id))];
      });
    } catch {
      // keep what we have; the next scroll to the end retries
    } finally {
      if (gen === genRef.current) { moreBusy.current = false; setLoadingMore(false); }
    }
  }, []);

  const refresh = useCallback(() => reload('refresh'), [reload]);
  const retry   = useCallback(() => reload('initial'), [reload]);

  return { items, loading, refreshing, loadingMore, error, refresh, retry, loadMore };
}

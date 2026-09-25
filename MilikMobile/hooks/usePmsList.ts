import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import api from '../services/api';
import { apiError } from '../utils/pmsFormat';

/** Debounce a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

type Parsed<T, X> = { rows: T[]; pages?: number; total?: number; extra?: X };

type Options<T, X> = {
  path: string;
  /** Query params (without page/limit). A change in content resets the list to page 1. */
  params: Record<string, string | number | boolean | undefined>;
  limit?: number;
  /** Adapt the server payload (shapes differ per endpoint). */
  parse: (data: any) => Parsed<T, X>;
};

/**
 * Paginated list with race-safe loading, pull-to-refresh, infinite scroll and error state.
 * Only the newest request may touch state, so quick filter/search changes never show stale rows.
 */
export function usePmsList<T extends { _id: string }, X = undefined>({ path, params, limit = 50, parse }: Options<T, X>) {
  const [items, setItems] = useState<T[]>([]);
  const [extra, setExtra] = useState<X | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageRef = useRef(1);
  const hasMoreRef = useRef(false);
  const busyMoreRef = useRef(false);
  const reqRef = useRef(0);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const paramsKey = JSON.stringify(params);

  const fetchPage = useCallback(
    async (pg: number, mode: 'initial' | 'refresh' | 'more' | 'silent') => {
      const id = ++reqRef.current;
      if (mode === 'initial') setLoading(true);
      else if (mode === 'refresh') setRefreshing(true);
      else if (mode === 'more') { busyMoreRef.current = true; setLoadingMore(true); }

      try {
        const clean: Record<string, string | number | boolean> = {};
        Object.entries(JSON.parse(paramsKey) as Record<string, unknown>).forEach(([k, v]) => {
          if (v !== undefined && v !== null && v !== '') clean[k] = v as string | number | boolean;
        });
        const { data } = await api.get(path, { params: { ...clean, page: pg, limit } });
        if (id !== reqRef.current) return;

        const p = parseRef.current(data);
        const rows = Array.isArray(p.rows) ? p.rows : [];
        setItems((prev) => {
          if (pg === 1) return rows;
          const seen = new Set(prev.map((r) => r._id));
          return [...prev, ...rows.filter((r) => !seen.has(r._id))];
        });
        if (pg === 1 || p.extra !== undefined) setExtra(p.extra);
        setTotal(p.total ?? rows.length);
        hasMoreRef.current = p.pages ? pg < p.pages : rows.length === limit;
        pageRef.current = pg;
        setError(null);
      } catch (err) {
        if (id !== reqRef.current) return;
        setError(apiError(err, 'Could not load data.'));
      } finally {
        if (id === reqRef.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
          busyMoreRef.current = false;
        }
      }
    },
    [path, paramsKey, limit],
  );

  useEffect(() => { fetchPage(1, 'initial'); }, [fetchPage]);

  return {
    items, setItems, extra, total, loading, refreshing, loadingMore, error,
    /** Re-fetch page 1 without the full-screen loader (after a mutation). */
    reload: useCallback(() => fetchPage(1, 'silent'), [fetchPage]),
    /** Full retry with loader (error state button). */
    retry: useCallback(() => fetchPage(1, 'initial'), [fetchPage]),
    refresh: useCallback(() => fetchPage(1, 'refresh'), [fetchPage]),
    loadMore: useCallback(() => {
      if (hasMoreRef.current && !busyMoreRef.current) fetchPage(pageRef.current + 1, 'more');
    }, [fetchPage]),
  };
}

/** Run `fn` every time the screen regains focus (e.g. after returning from a create form), skipping the first mount. */
export function useReloadOnFocus(fn: () => void) {
  const first = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useFocusEffect(
    useCallback(() => {
      if (first.current) { first.current = false; return; }
      fnRef.current();
    }, []),
  );
}

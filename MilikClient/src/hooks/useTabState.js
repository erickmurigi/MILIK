import { useState, useCallback } from "react";

// Survives component unmounts — cleared when a tab is closed or on logout
const _cache = new Map();

export const clearTabCache = (routePrefix) => {
  for (const key of _cache.keys()) {
    if (key.startsWith(routePrefix + ":")) _cache.delete(key);
  }
};

export const clearAllTabCache = () => _cache.clear();

/**
 * Drop-in useState replacement that persists state across tab switches.
 * cacheKey must be globally unique: "/route/path:stateName"
 */
export function useTabState(cacheKey, defaultValue) {
  const [state, setState] = useState(() => {
    if (_cache.has(cacheKey)) return _cache.get(cacheKey);
    return typeof defaultValue === "function" ? defaultValue() : defaultValue;
  });

  const setTabState = useCallback(
    (val) => {
      setState((prev) => {
        const next = typeof val === "function" ? val(prev) : val;
        _cache.set(cacheKey, next);
        return next;
      });
    },
    [cacheKey]
  );

  return [state, setTabState];
}

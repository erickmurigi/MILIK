import { useEffect, useRef } from "react";
import { getTabCache, setTabCache } from "./useTabState";

/**
 * Saves and restores the scroll position of a container ref across tab switches.
 * Uses the raw cache (no React state) so scrolling never causes a re-render.
 * routePrefix must match the prefix used in useTabState for this page.
 */
export function useScrollRestore(routePrefix, containerRef) {
  const cacheKey = routePrefix + ":scrollTop";
  const savedRef = useRef(false);

  // Restore scroll after the content has rendered
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cached = getTabCache(cacheKey);
    if (cached) el.scrollTop = cached;
    savedRef.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist scroll position on scroll (throttled via rAF)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafId = null;
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        setTabCache(cacheKey, el.scrollTop);
        rafId = null;
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [cacheKey, containerRef]);
}

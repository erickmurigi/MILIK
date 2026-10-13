import { useCallback, useEffect, useMemo, useState } from "react";

const safeJsonParse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const resolveInitialValue = (initialValue) =>
  typeof initialValue === "function" ? initialValue() : initialValue;

const canUseSessionStorage = () =>
  typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";

export const buildScopedDraftKey = ({ page, companyId, userId = "user", extra = "default" }) => {
  if (!page || !companyId) return "";
  return ["milik", "draft", page, companyId, userId || "user", extra || "default"]
    .map((part) => String(part || "").replace(/\s+/g, "_").replace(/:+/g, "_"))
    .join(":");
};

export default function useScopedSessionDraft(key, initialValue, options = {}) {
  const { enabled = true } = options;
  const [hydrated, setHydrated] = useState(false);
  // Only the mount-time initialValue is ever used — useState's lazy initializer already
  // runs exactly once, so capturing it in a ref first (then reading ref.current during
  // render) added nothing but an unsafe ref-read-during-render.
  const [state, setState] = useState(() => resolveInitialValue(initialValue));

  useEffect(() => {
    // Synchronizing with sessionStorage (an external system) is exactly the documented
    // exception to this rule — the read can't happen during render, and 6 consumer pages
    // rely on the hydrated flag flipping only after it resolves.
    const fallback = resolveInitialValue(initialValue);
    if (!enabled || !key || !canUseSessionStorage()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(fallback);
      setHydrated(true);
      return;
    }

    const saved = window.sessionStorage.getItem(key);
    setState(safeJsonParse(saved, fallback));
    setHydrated(true);
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled || !key || !hydrated || !canUseSessionStorage()) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Ignore quota/security errors so production forms do not crash.
    }
  }, [enabled, hydrated, key, state]);

  const clearDraft = useCallback(() => {
    if (!key || !canUseSessionStorage()) return;
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Ignore storage errors.
    }
  }, [key]);

  return useMemo(() => [state, setState, clearDraft, hydrated], [state, clearDraft, hydrated]);
}

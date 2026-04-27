import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const safeJsonParse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
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
  const initialRef = useRef(initialValue);
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState(() => resolveInitialValue(initialRef.current));

  useEffect(() => {
    const fallback = resolveInitialValue(initialRef.current);
    if (!enabled || !key || !canUseSessionStorage()) {
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
    } catch (error) {
      // Ignore quota/security errors so production forms do not crash.
    }
  }, [enabled, hydrated, key, state]);

  const clearDraft = useCallback(() => {
    if (!key || !canUseSessionStorage()) return;
    try {
      window.sessionStorage.removeItem(key);
    } catch (error) {
      // Ignore storage errors.
    }
  }, [key]);

  return useMemo(() => [state, setState, clearDraft, hydrated], [state, clearDraft, hydrated]);
}

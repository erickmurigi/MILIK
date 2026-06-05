import { useCallback } from "react";

const PREFIX = "milik-form-draft:";

export const readDraft  = (key) => { try { const s = localStorage.getItem(PREFIX + key); return s ? JSON.parse(s) : null; } catch { return null; } };
export const writeDraft = (key, data) => { try { localStorage.setItem(PREFIX + key, JSON.stringify(data)); } catch { /* storage unavailable */ } };
export const clearDraft = (key) => { localStorage.removeItem(PREFIX + key); };

export const useFormDraft = (key) => {
  const read  = useCallback(() => readDraft(key), [key]);
  const write = useCallback((data) => writeDraft(key, data), [key]);
  const clear = useCallback(() => clearDraft(key), [key]);
  return { read, write, clear };
};

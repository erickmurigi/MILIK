import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

// Small helpers shared by the project list, the project page and its modals. Kept free of JSX so it can export hooks
// and constants. Listing/unit constants live in utils/saleListingConstants.js and the form options in
// hooks/useSaleFormOptions.js because the Listings and Units pages use them too.

export const PROJECT_STATUS_MAP = {
  active:   "border-emerald-200 bg-emerald-50 text-emerald-700",
  archived: "border-slate-200 bg-slate-50 text-slate-500",
};

// Solid swatches for legends and progress segments (same hue family as the status badge classes)
export const STATUS_SWATCH = {
  available:      "bg-emerald-400",
  reserved:       "bg-amber-400",
  under_contract: "bg-[#0B3B2E]",
  sold:           "bg-slate-700",
  withdrawn:      "bg-rose-300",
};

export const errorMessage = (err, fallback) => err?.response?.data?.message || fallback;

export const fmtPct = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : `${Number(n).toFixed(1).replace(/\.0$/, "")}%`);

// Refreshes everything a project change can touch
export const useProjectInvalidate = (biz, id) => {
  const queryClient = useQueryClient();
  return useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["sale-projects", biz] }),
    id ? queryClient.invalidateQueries({ queryKey: ["sale-project", biz, id] }) : null,
    id ? queryClient.invalidateQueries({ queryKey: ["sale-project-units", biz, id] }) : null,
    queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-listings-ref", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] }),
  ]), [queryClient, biz, id]);
};

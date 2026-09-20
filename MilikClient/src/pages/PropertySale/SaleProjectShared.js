import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { saleApi } from "../../services/propertySaleApi";

// Shared by the project list, the project page and its modals. Kept free of JSX so it can export hooks and constants.

export const UNIT_STATUSES = ["available", "reserved", "under_contract", "sold", "withdrawn"];

export const STATUS_LABEL = {
  available: "Available",
  reserved: "Reserved",
  under_contract: "Under contract",
  sold: "Sold",
  withdrawn: "Withdrawn",
};

// Same classes as LISTING_STATUS_MAP in SaleListings.jsx so a status looks identical across the sales pages
export const LISTING_STATUS_MAP = {
  available:      "border-emerald-200 bg-emerald-50 text-emerald-700",
  reserved:       "border-amber-200 bg-amber-50 text-amber-700",
  under_contract: "border-[#B7C9C0] bg-[#F1F6F3] text-[#0B3B2E]",
  sold:           "border-slate-600 bg-slate-800 text-white",
  withdrawn:      "border-rose-200 bg-rose-50 text-rose-700",
};

export const PROJECT_STATUS_MAP = {
  active:   "border-emerald-200 bg-emerald-50 text-emerald-700",
  archived: "border-slate-200 bg-slate-50 text-slate-500",
};

// Solid swatches for legends and progress segments (same hue family as the badge classes above)
export const STATUS_SWATCH = {
  available:      "bg-emerald-400",
  reserved:       "bg-amber-400",
  under_contract: "bg-[#0B3B2E]",
  sold:           "bg-slate-700",
  withdrawn:      "bg-rose-300",
};

export const SIZE_UNIT_OPTIONS = ["sqm", "sqft", "acres", "hectares"].map((u) => ({ value: u, label: u }));
export const FALLBACK_PROPERTY_TYPES = ["plot", "house", "apartment", "commercial", "land", "other"];

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

// Property type + agent choices for the unit forms (same query keys as the Listings page, so they share its cache)
export const useSaleFormOptions = (biz) => {
  const { data: saleSettings } = useQuery({
    queryKey: ["sale-settings", biz],
    queryFn: () => saleApi.getSettings(),
    enabled: !!biz,
    staleTime: 10 * 60_000,
  });
  const { data: agentsData } = useQuery({
    queryKey: ["sale-agents-ref", biz, "active"],
    queryFn: () => saleApi.listAgents({ business: biz, status: "active", limit: 200 }),
    enabled: !!biz,
    staleTime: 5 * 60_000,
  });

  const propertyTypeOptions = useMemo(() => {
    const active = (saleSettings?.propertyTypes ?? []).filter((t) => t.isActive !== false);
    return active.length
      ? active.map((t) => ({ value: t.name.toLowerCase(), label: t.name }))
      : FALLBACK_PROPERTY_TYPES.map((t) => ({ value: t, label: t }));
  }, [saleSettings]);

  const agentFormOptions = useMemo(
    () => (agentsData?.data ?? []).map((a) => ({ value: a._id, label: `${a.fullName} (${a.agentNumber})` })),
    [agentsData],
  );

  return { propertyTypeOptions, agentFormOptions };
};

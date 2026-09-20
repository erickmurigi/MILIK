import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { saleApi } from "../services/propertySaleApi";
import { FALLBACK_PROPERTY_TYPES } from "../utils/saleListingConstants";

/**
 * Sale settings plus the choices the listing / unit / project forms and filters need: property types (from Sale
 * Settings, with a built-in fallback) and active agents. One place for the queries and option lists, so every sales
 * page shares the same cache entries ("sale-settings", "sale-agents-ref") and never builds them twice.
 */
export default function useSaleFormOptions(biz) {
  const { data: saleSettings, isPending: settingsPending } = useQuery({
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

  // Extra fields / hidden standard fields per property type, keyed by the type value stored on listings (lowercased name).
  // Inactive types are included so listings that still use them keep their fields.
  const propertyTypeDefs = useMemo(
    () => Object.fromEntries((saleSettings?.propertyTypes ?? []).map((t) => [String(t.name).toLowerCase(), { fields: t.fields || [], hiddenFields: t.hiddenFields || [] }])),
    [saleSettings]
  );

  const agents = useMemo(() => agentsData?.data ?? [], [agentsData]);
  const agentFormOptions = useMemo(() => agents.map((a) => ({ value: a._id, label: `${a.fullName} (${a.agentNumber})` })), [agents]);
  const agentFilterOptions = useMemo(() => agents.map((a) => ({ value: a._id, label: a.fullName })), [agents]);

  return { saleSettings, settingsPending, propertyTypeOptions, propertyTypeDefs, agentFormOptions, agentFilterOptions };
}

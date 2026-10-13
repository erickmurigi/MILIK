import React from "react";

/** A single bordered metric readout — the shared building block for every
 * coded (non-screenshot) UI visual across the marketing site. `big` makes
 * it the visual anchor of its group; `accent` uses the brand orange instead
 * of green, matching Milik's own "this is money" tile convention. */
export default function MetricTile({ label, value, big = false, accent = false, className = "" }) {
  return (
    <div
      className={`border p-3 ${accent ? "border-[#FF8C00] bg-[#FF8C00] text-white" : "border-slate-200 bg-white text-slate-900"} ${className}`}
    >
      <p className={`text-[9px] font-bold uppercase tracking-[0.16em] ${accent ? "text-white/80" : "text-slate-500"}`}>{label}</p>
      <p className={`mt-1 font-extrabold ${big ? "text-2xl" : "text-lg"}`}>{value}</p>
    </div>
  );
}

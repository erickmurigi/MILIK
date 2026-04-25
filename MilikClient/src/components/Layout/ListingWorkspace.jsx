
import React from "react";

export const listingFieldClassName =
  "px-3 py-1.5 text-xs border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] focus:border-[#0B3B2E] bg-white text-gray-800 placeholder-gray-500";

export const listingTintedFieldClassName =
  "px-3 py-1.5 text-xs border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] focus:border-[#0B3B2E] bg-[#DDEFE1] text-gray-800 hover:bg-white transition-colors";

export const listingSearchFieldClassName =
  "w-full pl-9 pr-3 py-1.5 text-xs border border-gray-300 rounded-md bg-white shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] focus:border-[#0B3B2E]";

export const ListingWorkspace = ({ children, className = "" }) => (
  <div className={`flex flex-col h-full min-h-0 overflow-hidden bg-white ${className}`.trim()}>
    {children}
  </div>
);

export const ListingToolbar = ({ children }) => (
  <div className="flex-shrink-0 sticky top-0 z-30 bg-white px-2 pt-2">
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {children}
    </div>
  </div>
);

export const ListingFilterRow = ({ children, className = "" }) => (
  <div className={`flex flex-wrap items-center gap-2 px-2 py-2 ${className}`.trim()}>{children}</div>
);

export const ListingActionRow = ({ children, className = "" }) => (
  <div className={`flex flex-wrap items-start justify-between gap-3 border-t border-gray-200 bg-gray-50 px-2 py-2 ${className}`.trim()}>{children}</div>
);

export const ListingActionGroup = ({ children, className = "", align = "start" }) => (
  <div
    className={`flex flex-wrap items-center gap-2 ${align === "end" ? "justify-end" : "justify-start"} ${className}`.trim()}
  >
    {children}
  </div>
);

export const ListingSelectionPill = ({ children, tone = "default", className = "" }) => {
  const toneClassName =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-slate-200 bg-white text-slate-700";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-bold ${toneClassName} ${className}`.trim()}>
      {children}
    </span>
  );
};

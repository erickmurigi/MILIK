export const LISTING_UI = {
  toolbarCard: "bg-white border border-slate-200 rounded-lg shadow-sm p-2",
  toolbarCardComfort: "bg-white border border-slate-200 rounded-lg shadow-sm p-4",
  filterRow: "flex flex-wrap items-center gap-2",
  filterGrid: "grid grid-cols-1 md:grid-cols-6 gap-2",
  actionRow: "mt-2 flex flex-wrap items-center gap-2",
  filterSelect: "px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-[#DDEFE1] text-gray-800 hover:bg-white transition-colors",
  filterInput: "px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] bg-white",
  filterInputTinted: "px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-[#addbb2] text-gray-800 placeholder-gray-600",
  searchButton: "flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm bg-[#FF8C00] hover:bg-[#e67e00]",
  resetButton: "flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm bg-[#0B3B2E] hover:bg-[#0A3127]",
  utilityButton: "px-4 py-1 text-xs border border-gray-300 rounded-lg flex items-center gap-2 hover:bg-gray-50 transition-colors shadow-sm",
};

export const toListingCaps = (value) => {
  if (value === null || value === undefined) return value;
  const text = String(value);
  return text ? text.toUpperCase() : text;
};

export const normalizeUppercaseInput = (value) => String(value ?? "").toUpperCase();

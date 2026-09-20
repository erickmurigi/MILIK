// Constants shared by the sales pages that show listings and units (Listings, Units, Projects).

export const UNIT_STATUSES = ["available", "reserved", "under_contract", "sold", "withdrawn"];

export const STATUS_LABEL = {
  available: "Available",
  reserved: "Reserved",
  under_contract: "Under contract",
  sold: "Sold",
  withdrawn: "Withdrawn",
};

// Badge classes for a listing / unit status, so a status looks identical on every sales page
export const LISTING_STATUS_MAP = {
  available:      "border-emerald-200 bg-emerald-50 text-emerald-700",
  reserved:       "border-amber-200 bg-amber-50 text-amber-700",
  under_contract: "border-[#B7C9C0] bg-[#F1F6F3] text-[#0B3B2E]",
  sold:           "border-slate-600 bg-slate-800 text-white",
  withdrawn:      "border-rose-200 bg-rose-50 text-rose-700",
};

export const SIZE_UNIT_OPTIONS = ["sqm", "sqft", "acres", "hectares"].map((u) => ({ value: u, label: u }));
export const FALLBACK_PROPERTY_TYPES = ["plot", "house", "apartment", "commercial", "land", "other"];

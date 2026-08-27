// Shared invoice status constants and formatting used across all invoice list pages.

export const INV_STATUS_BADGE = {
  "Paid":             "border border-green-200 bg-green-50 text-green-700",
  "Partially Paid":   "border border-amber-200 bg-amber-50 text-amber-700",
  "Unpaid":           "border border-red-200 bg-red-50 text-red-700",
  "Reversed":         "border border-slate-200 bg-slate-100 text-slate-600",
  "Cancelled":        "border border-slate-200 bg-slate-100 text-slate-600",
  "Voided":           "border border-slate-200 bg-slate-100 text-slate-600",
  "Credit Applied":   "border border-blue-200 bg-blue-50 text-blue-700",
};

export const INV_STATUS_BADGE_DEFAULT = "border border-slate-200 bg-slate-100 text-slate-500";

// Format a monetary value to 2 decimal places (en-KE locale, no symbol).
export const fmtAmountKE = (v) =>
  Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

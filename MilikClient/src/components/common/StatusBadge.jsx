/**
 * Universal status badge / pill used across all list pages.
 *
 * Props:
 *   status   {string}  — the status value (matched case-insensitively)
 *   map      {object}  — optional override color map; falls back to DEFAULT_MAP
 *
 * Usage:
 *   <StatusBadge status={row.status} />
 *   <StatusBadge status={row.status} map={MY_CUSTOM_MAP} />
 */

export const DEFAULT_STATUS_MAP = {
  // positive
  active:             "border-emerald-200 bg-emerald-50 text-emerald-700",
  confirmed:          "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed:          "border-emerald-200 bg-emerald-50 text-emerald-700",
  received:           "border-emerald-200 bg-emerald-50 text-emerald-700",
  posted:             "border-emerald-200 bg-emerald-50 text-emerald-700",
  approved:           "border-emerald-200 bg-emerald-50 text-emerald-700",
  paid:               "border-emerald-200 bg-emerald-50 text-emerald-700",
  settled:            "border-emerald-200 bg-emerald-50 text-emerald-700",
  // informational / in-progress
  sent:               "border-blue-200 bg-blue-50 text-blue-700",
  processing:         "border-blue-200 bg-blue-50 text-blue-700",
  // warning / partial
  pending:            "border-amber-200 bg-amber-50 text-amber-700",
  partial:            "border-amber-200 bg-amber-50 text-amber-700",
  partially_received: "border-amber-200 bg-amber-50 text-amber-700",
  partially_paid:     "border-amber-200 bg-amber-50 text-amber-700",
  overdue:            "border-orange-200 bg-orange-50 text-orange-700",
  // neutral
  draft:              "border-slate-200 bg-slate-50 text-slate-600",
  inactive:           "border-slate-200 bg-slate-50 text-slate-500",
  // negative
  cancelled:          "border-red-200 bg-red-50 text-red-700",
  voided:             "border-red-200 bg-red-50 text-red-700",
  failed:             "border-red-200 bg-red-50 text-red-700",
  rejected:           "border-red-200 bg-red-50 text-red-700",
  expired:            "border-red-200 bg-red-50 text-red-700",
};

const StatusBadge = ({ status, map }) => {
  const colorMap = map || DEFAULT_STATUS_MAP;
  const key = String(status || "").toLowerCase();
  const classes = colorMap[key] || "border-slate-200 bg-slate-50 text-slate-500";
  return (
    <span className={`inline-flex border px-2 py-0.5 text-[9px] font-bold uppercase ${classes}`}>
      {String(status || "").replace(/_/g, " ")}
    </span>
  );
};

export default StatusBadge;

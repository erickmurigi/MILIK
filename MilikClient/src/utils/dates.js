/**
 * "01 Aug 2026"  — standard display date across the app
 */
export const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
};

/**
 * "01 Aug 2026, 14:32"  — with time
 */
export const fmtDateTime = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-KE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

/**
 * "01/08/2026"  — compact slash format for tight spaces / exports
 */
export const fmtDateShort = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB"); // dd/mm/yyyy
};

/**
 * Today's date as an ISO "YYYY-MM-DD" string (useful for date input defaults).
 */
export const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Current month as "YYYY-MM" (useful for month picker defaults).
 */
export const thisMonthISO = () => new Date().toISOString().slice(0, 7);

// Shared formatting / error helpers for the PMS screens.
// Formatting is done by hand (no Intl) so output is identical on every device.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 1234.5 -> "1,234.50" (always 2 dp, thousands separators). */
export const fmtMoney = (n: unknown): string => {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  const [int, dec] = Math.abs(safe).toFixed(2).split('.');
  return `${safe < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
};

/** 1234.5 -> "KES 1,234.50" */
export const fmtKES = (n: unknown): string => `KES ${fmtMoney(n)}`;

/** Plain number with thousands separators and up to `dp` decimals (meter readings, units...). */
export const fmtNumber = (n: unknown, dp = 2): string => {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  const fixed = Number(safe.toFixed(dp)).toString();
  const [int, dec] = fixed.split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec ? `.${dec}` : '');
};

const toDate = (d: unknown): Date | null => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(String(d));
  return Number.isNaN(date.getTime()) ? null : date;
};

/** "05 Sep 2026" — em dash when the value is missing/invalid. */
export const fmtDate = (d: unknown): string => {
  const date = toDate(d);
  if (!date) return '—';
  return `${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
};

/** "05 Sep 2026, 14:30" */
export const fmtDateTime = (d: unknown): string => {
  const date = toDate(d);
  if (!date) return '—';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${fmtDate(date)}, ${hh}:${mm}`;
};

/** Today's date as YYYY-MM-DD in the device's local time zone (toISOString would give the UTC day). */
export const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Best human-readable message for a failed axios call. */
export const apiError = (err: unknown, fallback: string): string => {
  const e = err as { response?: { status?: number; data?: { message?: string; error?: string } } } | undefined;
  const msg = e?.response?.data?.message || e?.response?.data?.error;
  if (msg && typeof msg === 'string') return msg;
  const status = e?.response?.status;
  if (status === 403) return "You don't have permission to do this. Ask your administrator for access.";
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (!e?.response) return 'Cannot reach the server. Check your connection and try again.';
  return fallback;
};

/** Strip everything except digits and one decimal point (for numeric TextInputs). */
export const cleanDecimal = (text: string): string => {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  return firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
};

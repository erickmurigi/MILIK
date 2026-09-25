// Shared constants + helpers for the Car Wash screens (dashboard, jobs, job detail, new job, M-Pesa).
// Money / date formatting lives in ./pmsFormat.

import { apiError, todayISO } from './pmsFormat';

export const CW  = '#1E3A8A';   // Car Wash navy
export const CWL = '#EEF2FF';
export const ACC = '#C8511A';

// ─── Jobs ──────────────────────────────────────────────────────────────────────

export type JobStatus = 'waiting' | 'washing' | 'drying' | 'ready' | 'done' | 'paid' | 'cancelled';

/** Workflow the crew moves a job through. "paid" is not a step: it follows the payment (see server updateJobStatus). */
export const JOB_FLOW: JobStatus[] = ['waiting', 'washing', 'drying', 'ready', 'done'];

export const JOB_STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  waiting:   { bg: '#FEF3C7', color: '#D97706', label: 'Waiting'   },
  washing:   { bg: '#DBEAFE', color: '#1D4ED8', label: 'Washing'   },
  drying:    { bg: '#EDE9FE', color: '#7C3AED', label: 'Drying'    },
  ready:     { bg: '#CCFBF1', color: '#0F766E', label: 'Ready'     },
  done:      { bg: '#E0E7FF', color: '#4338CA', label: 'Done'      },
  paid:      { bg: '#D1FAE5', color: '#065F46', label: 'Paid'      },
  cancelled: { bg: '#F1F5F9', color: '#64748B', label: 'Cancelled' },
};

/** Same wording as the web: carpets are "processing" / "collected". */
export const jobStatusLabel = (status: string, jobType?: string): string => {
  if (jobType === 'carpet') {
    if (status === 'washing') return 'Processing';
    if (status === 'done')    return 'Collected';
  }
  return JOB_STATUS_STYLE[status]?.label ?? status;
};

export const PAY_STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  unpaid:  { bg: '#FEF3C7', color: '#B45309', label: 'Unpaid'  },
  partial: { bg: '#FFEDD5', color: '#C2410C', label: 'Partial' },
  paid:    { bg: '#D1FAE5', color: '#065F46', label: 'Paid'    },
};

export const PAY_METHODS = ['cash', 'mpesa', 'bank', 'card', 'other'] as const;
export type PayMethod = typeof PAY_METHODS[number];
export const PAY_METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', mpesa: 'M-Pesa', bank: 'Bank', card: 'Card', other: 'Other', prepaid: 'Prepaid',
};
export const PAY_METHOD_ICON: Record<PayMethod, string> = {
  cash: 'cash-outline', mpesa: 'phone-portrait-outline', bank: 'business-outline',
  card: 'card-outline', other: 'ellipsis-horizontal-outline',
};

/** What the customer owes for a job: price less the discount (the server's netJobPrice). */
export const jobNet = (job: { price?: number; discountAmount?: number } | null | undefined): number =>
  Math.max(0, Number(job?.price || 0) - Number(job?.discountAmount || 0));

export const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ─── Plates / phones ───────────────────────────────────────────────────────────

/** "kca 123-a" -> "KCA123A" (the same rule the server applies to every plate). */
export const normalizePlate = (v: string): string => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Kenyan phone -> 2547XXXXXXXX (what the STK push endpoint accepts), or null when it is not a valid number. */
export const toMsisdn = (raw: string): string | null => {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  const n = digits.startsWith('0') ? `254${digits.slice(1)}` : digits;
  return /^254\d{9}$/.test(n) ? n : null;
};

// ─── Dates ─────────────────────────────────────────────────────────────────────

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** YYYY-MM-DD shifted by n days, in local time. */
export const stepDate = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/** Monday..Sunday of the current week (local), as YYYY-MM-DD. */
export const weekBounds = (): { from: string; to: string } => {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: ymd(monday), to: ymd(sunday) };
};

/** First of this month .. today (local). */
export const monthBounds = (): { from: string; to: string } => {
  const now = new Date();
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayISO() };
};

export type Range = 'today' | 'week' | 'month' | 'all';

/** Date-range chip -> query params for /carwash/jobs and /carwash/mpesa/notifications. */
export const rangeParams = (r: Range): { date?: string; dateFrom?: string; dateTo?: string } => {
  if (r === 'today') return { date: todayISO() };
  if (r === 'week')  { const b = weekBounds();  return { dateFrom: b.from, dateTo: b.to }; }
  if (r === 'month') { const b = monthBounds(); return { dateFrom: b.from, dateTo: b.to }; }
  return {};
};

export const RANGE_CHIPS: { key: Range; label: string }[] = [
  { key: 'today', label: 'Today'      },
  { key: 'week',  label: 'This week'  },
  { key: 'month', label: 'This month' },
  { key: 'all',   label: 'All dates'  },
];

/** "25 Sep, 14:30" — compact time stamp for list rows. */
export const fmtTime = (d: unknown): string => {
  const date = d ? new Date(String(d)) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

// ─── API payloads ──────────────────────────────────────────────────────────────

/** The Car Wash list endpoints answer { success, data: { <key>, pagination }, <key>, pagination }. */
export const listOf = <T,>(payload: any, key: string): T[] => {
  const a = payload?.data?.[key] ?? payload?.[key] ?? payload?.data;
  return Array.isArray(a) ? (a as T[]) : [];
};

export const paginationOf = (payload: any): { pages?: number; total?: number } => {
  const p = payload?.data?.pagination ?? payload?.pagination;
  return { pages: p?.pages, total: p?.total };
};

// ─── Errors ────────────────────────────────────────────────────────────────────

/**
 * Message for a failed Car Wash call. The server answers 403 "Permission denied for carwash-payments.record";
 * turn that into something a cashier can act on. Everything else falls back to the shared apiError wording.
 */
export const cwMessage = (msg: string | null | undefined): string => {
  const text = String(msg || '');
  const what = /^permission denied for ([\w.-]+)/i.exec(text)?.[1];
  return what ? `You don't have permission to do this (${what}). Ask your administrator for access.` : text;
};

export const cwError = (err: unknown, fallback: string): string => cwMessage(apiError(err, fallback));

// ─── Cashbooks ─────────────────────────────────────────────────────────────────

export type Cashbook = { _id: string; code?: string; name?: string; subGroup?: string };

/**
 * Cashbook to pre-select for a payment method. Uses the configured default (branch first, then company),
 * and otherwise guesses from the account name exactly like the web does.
 */
export const preferredCashbook = (
  cashbooks: Cashbook[],
  method: string,
  defaults: Record<string, string>,
): string => {
  if (defaults[method] && cashbooks.some(c => c._id === defaults[method])) return defaults[method];
  const hay = (c: Cashbook) => `${c.name || ''} ${c.code || ''}`.toLowerCase();
  if (method === 'mpesa') return cashbooks.find(c => /m-?pesa|mpesa/.test(hay(c)))?._id || '';
  if (method === 'bank' || method === 'card') return cashbooks.find(c => /bank/.test(hay(c)))?._id || '';
  if (method === 'cash') return cashbooks.find(c => /cash|hand|safe/.test(hay(c)))?._id || '';
  return cashbooks[0]?._id || '';
};

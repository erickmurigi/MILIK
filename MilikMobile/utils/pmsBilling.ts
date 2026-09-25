// Invoice / receipt helpers shared by the tenant billing screens (invoices, receipts, tenants).
// Basic money / date formatting lives in ./pmsFormat.

import { todayISO } from './pmsFormat';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "05 Sep" for dense tables. */
export const fmtDayMonth = (d?: string | Date | null): string => {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return `${String(dt.getDate()).padStart(2, '0')} ${MONTHS[dt.getMonth()]}`;
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type Period = '1M' | '3M' | '6M' | '1Y' | 'All';

/** Period chip -> local YYYY-MM-DD range (toISOString() would shift the day for UTC+3 users). */
export const periodRange = (p: Period): { from?: string; to?: string } => {
  if (p === 'All') return {};
  const today = new Date();
  let from: Date;
  if (p === '1M') from = new Date(today.getFullYear(), today.getMonth(), 1);
  else if (p === '3M') from = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  else if (p === '6M') from = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  else from = new Date(today.getFullYear(), 0, 1);
  return { from: ymd(from), to: todayISO() };
};

type InvoiceLike = {
  status?: string;
  computedStatus?: string;
  outstanding?: number;
  appliedAmount?: number;
};

/**
 * Invoice status the way the web shows it: the receipt-driven computed status wins over the stored one.
 * Returns one of pending | partially_paid | paid | cancelled | reversed.
 */
export const invoiceStatusOf = (inv: InvoiceLike): string => {
  const raw = String(inv.computedStatus || inv.status || '').toLowerCase();
  if (raw === 'cancelled' || raw === 'reversed') return raw;
  if (inv.outstanding != null) {
    if (Number(inv.outstanding) <= 0.009) return 'paid';
    if (Number(inv.appliedAmount || 0) > 0.009) return 'partially_paid';
    return 'pending';
  }
  return raw === 'paid' || raw === 'partially_paid' ? raw : 'pending';
};

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  pending:        'Unpaid',
  partially_paid: 'Partial',
  paid:           'Paid',
  cancelled:      'Cancelled',
  reversed:       'Reversed',
};

export const INVOICE_CATEGORY_LABEL: Record<string, string> = {
  RENT_CHARGE:         'Rent',
  UTILITY_CHARGE:      'Utility',
  DEPOSIT_CHARGE:      'Deposit',
  LATE_PENALTY_CHARGE: 'Late Penalty',
  PENALTY_CHARGE:      'Late Penalty',
  OTHER_CHARGE:        'Other Charge',
  DEBIT_NOTE:          'Debit Note',
  TAKE_ON_DEBIT:       'Take-on Balance',
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  mobile_money:  'M-Pesa / Mobile Money',
  cash:          'Cash',
  bank_transfer: 'Bank Transfer',
  check:         'Cheque',
  credit_card:   'Card',
};

/** Extract the list from either a bare array or a { data | items } envelope. */
export const rowsOf = <T,>(payload: unknown): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  const p = payload as { data?: unknown; items?: unknown } | null | undefined;
  if (Array.isArray(p?.items)) return p!.items as T[];
  if (Array.isArray(p?.data)) return p!.data as T[];
  return [];
};

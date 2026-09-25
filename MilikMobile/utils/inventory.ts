// Shared constants, types and request builders for the Inventory / POS screens
// (app/(app)/inventory/**). Money / date formatting lives in ./pmsFormat, list hooks in ../hooks/usePmsList.
// The request builders are also imported by the API contract tests (MilikApi/modules/inventory/mobileContract.test.js),
// so what the screens send is exactly what the tests replay against the real controllers.

import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import { apiError } from './pmsFormat';
import { cwMessage } from './carwash';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export const INV  = '#92400E';   // Inventory brown
export const INVL = '#FEF3C7';
export const INVBG = '#FFFBEB';

/** Message for a failed Inventory call, with "Permission denied for x.y" made readable. */
export const invError = (err: unknown, fallback: string): string => cwMessage(apiError(err, fallback));

/** Name of a populated ref ({ name }), '' for a bare id / null. */
export const nameOf = (ref: unknown): string =>
  ref && typeof ref === 'object' && typeof (ref as { name?: unknown }).name === 'string' ? (ref as { name: string }).name : '';

/**
 * Display name of a populated user. The API populates "name username surname otherNames" but the User model only stores
 * surname / otherNames, so `name` is normally absent.
 */
export const userName = (u: unknown): string => {
  if (!u || typeof u !== 'object') return '';
  const x = u as { name?: string; surname?: string; otherNames?: string; username?: string };
  return (x.name || [x.otherNames, x.surname].filter(Boolean).join(' ') || x.username || '').trim();
};

// ─── Numbers ───────────────────────────────────────────────────────────────────

/** Quantity without trailing zeros, at most 3 dp: 12 -> "12", 2.5 -> "2.5", 1234.5 -> "1,234.5". */
export const fmtQty = (n: unknown): string => {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  const [int, dec] = Number(safe.toFixed(3)).toString().split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec ? `.${dec}` : '');
};

/** Text box -> positive number (0 when empty / invalid). */
export const toNum = (text: string): number => {
  const v = Number(String(text ?? '').trim());
  return Number.isFinite(v) ? v : 0;
};

export const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ─── Dates ─────────────────────────────────────────────────────────────────────

/**
 * The server buckets `?date=` by ITS clock (UTC), so a Kenyan sale at 01:00 lands on the previous day. The list / summary
 * endpoints also take from / to: `from` is inclusive and `to` (a start of day) is extended by one day, so sending the
 * device's local midnight for both selects exactly the local calendar day.
 */
export const dayParams = (day: string): { from: string; to: string } => {
  const [y, m, d] = day.split('-').map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0).toISOString();
  return { from: start, to: start };
};

/** "YYYY-MM-DD" shifted by n days (local calendar arithmetic, no UTC shift). */
export const shiftDay = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// ─── Products ──────────────────────────────────────────────────────────────────

type UserRef = { name?: string; username?: string; surname?: string; otherNames?: string };

export type Product = {
  _id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  category?: { _id?: string; name?: string } | string | null;
  unitOfMeasure?: string;
  costPrice?: number;
  sellingPrice?: number;
  vatRate?: number;
  reorderLevel?: number;
  trackStock?: boolean;
  serialized?: boolean;
  description?: string;
  active?: boolean;
  /** total on hand across every location (?withStock=true) */
  stockBalance?: number;
  stockByLocation?: { location: string; locationName: string; balance: number }[];
};

/** Same rule as the server's low-stock report: tracked, a reorder level is set, and on-hand has reached it. */
export const isLowStock = (p: Pick<Product, 'trackStock' | 'reorderLevel' | 'stockBalance'>): boolean =>
  !!p.trackStock && Number(p.reorderLevel) > 0 && Number(p.stockBalance ?? 0) <= Number(p.reorderLevel);

/** Selling price is stored without VAT (the POS adds vatRate on top). */
export const priceInclVat = (p: Pick<Product, 'sellingPrice' | 'vatRate'>): number =>
  round2(Number(p.sellingPrice || 0) * (1 + Number(p.vatRate || 0) / 100));

/** Gross margin % on the ex-VAT selling price; null when there is no selling price. */
export const marginPct = (p: Pick<Product, 'sellingPrice' | 'costPrice'>): number | null => {
  const sell = Number(p.sellingPrice || 0);
  if (sell <= 0) return null;
  return ((sell - Number(p.costPrice || 0)) / sell) * 100;
};

export type LowStockRow = { product: Product; balance: number; reorderLevel: number; deficit: number };

// ─── Stock movements ───────────────────────────────────────────────────────────

export type MovementType =
  'purchase' | 'sale' | 'return' | 'transfer_out' | 'transfer_in' | 'adjustment' | 'writeoff' | 'opening';

export type StockMovement = {
  _id: string;
  type: MovementType | string;
  qty: number;                       // signed: + in, - out
  unitCost?: number;
  totalCost?: number;
  reference?: string;
  notes?: string;
  batch?: string;
  createdAt: string;
  product?: { _id?: string; name?: string; sku?: string; unitOfMeasure?: string } | null;
  location?: { _id?: string; name?: string } | null;
  createdBy?: UserRef | null;
};

export const MOVEMENT_STYLE: Record<string, { bg: string; color: string; label: string; icon: IconName }> = {
  purchase:     { bg: '#D1FAE5', color: '#065F46', label: 'Purchase',     icon: 'arrow-down-circle-outline' },
  sale:         { bg: '#DBEAFE', color: '#1D4ED8', label: 'Sale',         icon: 'arrow-up-circle-outline'   },
  return:       { bg: '#E0F2FE', color: '#0369A1', label: 'Return',       icon: 'return-down-back-outline'  },
  transfer_out: { bg: '#FFEDD5', color: '#C2410C', label: 'Transfer out', icon: 'arrow-forward-circle-outline' },
  transfer_in:  { bg: '#CCFBF1', color: '#0F766E', label: 'Transfer in',  icon: 'arrow-back-circle-outline' },
  adjustment:   { bg: '#EDE9FE', color: '#7C3AED', label: 'Adjustment',   icon: 'swap-horizontal-outline'   },
  writeoff:     { bg: '#FEE2E2', color: '#B91C1C', label: 'Write-off',    icon: 'trash-outline'             },
  opening:      { bg: '#F1F5F9', color: '#475569', label: 'Opening',      icon: 'albums-outline'            },
};

/** Filter chips. "Transfer" is both directions (the API takes a comma list). */
export const MOVEMENT_FILTERS: { key: string; label: string }[] = [
  { key: '',                          label: 'All'        },
  { key: 'purchase',                  label: 'Purchase'   },
  { key: 'sale',                      label: 'Sale'       },
  { key: 'adjustment',                label: 'Adjustment' },
  { key: 'writeoff',                  label: 'Write-off'  },
  { key: 'return',                    label: 'Return'     },
  { key: 'transfer_out,transfer_in',  label: 'Transfer'   },
  { key: 'opening',                   label: 'Opening'    },
];

/** Manual entry types the server accepts on POST /inventory/stock-movements. */
export const MANUAL_TYPES = ['adjustment', 'writeoff'] as const;
export type ManualType = typeof MANUAL_TYPES[number];

export const MANUAL_TYPE_HELP: Record<ManualType, string> = {
  adjustment: 'Count correction: the physical count differs from the system balance.',
  writeoff:   'Damaged, expired or lost stock: always reduces the balance.',
};

/**
 * Body for POST /inventory/stock-movements. The user types a positive quantity and picks a direction; the server wants a
 * signed qty (a write-off is always an outflow). `notes` is the audit-trail reason.
 */
export const stockEntryBody = (f: {
  location: string; product: string; type: ManualType; direction: 'in' | 'out'; qty: number; notes: string;
}) => ({
  location: f.location,
  product: f.product,
  type: f.type,
  qty: f.type === 'writeoff' || f.direction === 'out' ? -Math.abs(f.qty) : Math.abs(f.qty),
  notes: f.notes.trim(),
});

// ─── Purchase orders ───────────────────────────────────────────────────────────

export type POStatus = 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';

export const PO_STATUS: Record<string, { bg: string; color: string; label: string }> = {
  draft:              { bg: '#F1F5F9', color: '#64748B', label: 'Draft'           },
  sent:               { bg: '#DBEAFE', color: '#1D4ED8', label: 'Sent'            },
  partially_received: { bg: '#FEF3C7', color: '#D97706', label: 'Partial receipt' },
  received:           { bg: '#D1FAE5', color: '#065F46', label: 'Received'        },
  cancelled:          { bg: '#FEE2E2', color: '#DC2626', label: 'Cancelled'       },
};

export const PO_FILTERS: { key: string; label: string }[] = [
  { key: '',                   label: 'All'       },
  { key: 'draft',              label: 'Draft'     },
  { key: 'sent',               label: 'Sent'      },
  { key: 'partially_received', label: 'Partial'   },
  { key: 'received',           label: 'Received'  },
  { key: 'cancelled',          label: 'Cancelled' },
];

export type POLine = {
  _id: string;
  product?: { _id?: string; name?: string; sku?: string; unitOfMeasure?: string; costPrice?: number } | null;
  qtyOrdered: number;
  qtyReceived: number;
  unitCost: number;
  totalCost: number;
};

export type PoReceipt = {
  _id: string;
  grnRef?: string;
  receivedAt?: string;
  status?: 'active' | 'cancelled';
  cancelReason?: string;
  glStatus?: string;
  lines?: { _id?: string; product?: { name?: string } | null; qty: number; unitCost: number }[];
};

export type PurchaseOrder = {
  _id: string;
  poNumber: string;
  status: POStatus | string;
  supplier?: { _id?: string; name?: string; phone?: string; email?: string } | null;
  location?: { _id?: string; name?: string } | null;
  lines?: POLine[];
  receipts?: PoReceipt[];
  orderDate?: string;
  expectedDate?: string | null;
  receivedAt?: string | null;
  totalAmount: number;
  notes?: string;
  createdBy?: UserRef | null;
};

// what web + server allow: receive in draft / sent / partial; send a draft; cancel a draft or sent order
export const canReceivePO = (status: string) => ['draft', 'sent', 'partially_received'].includes(status);
export const canSendPO    = (status: string) => status === 'draft';
export const canCancelPO  = (status: string) => ['draft', 'sent'].includes(status);

export const outstanding = (l: Pick<POLine, 'qtyOrdered' | 'qtyReceived'>): number =>
  Math.max(0, Number(l.qtyOrdered || 0) - Number(l.qtyReceived || 0));

/** Body for POST /inventory/purchase-orders/:id/receive-goods. Lines with nothing to receive are dropped. */
export const receiveBody = (
  rows: { lineId: string; qty: number; unitCost: number }[],
  grnRef?: string,
) => ({
  ...(grnRef && grnRef.trim() ? { grnRef: grnRef.trim() } : {}),
  lines: rows.filter(r => r.qty > 0).map(r => ({ lineId: r.lineId, qtyReceived: r.qty, unitCost: r.unitCost })),
});

/** Body for PUT /inventory/purchase-orders/:id that marks a draft as sent (the server only merges the fields it is given). */
export const markSentBody = () => ({ status: 'sent' as const });

// ─── POS sales ─────────────────────────────────────────────────────────────────

export type SaleLine = {
  _id?: string; productName?: string; sku?: string; qty: number; unitPrice: number; discount?: number;
  vatRate?: number; vatAmount?: number; lineTotal?: number;
};

export type PosSale = {
  _id: string;
  receiptNumber?: string;
  status: 'completed' | 'voided' | string;
  lines?: SaleLine[];
  payments?: { method: string; amount: number; ref?: string }[];
  subtotal?: number;
  totalDiscount?: number;
  totalVat?: number;
  grandTotal: number;
  amountTendered?: number;
  change?: number;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  location?: { name?: string } | null;
  cashier?: UserRef | null;
  voidedBy?: UserRef | null;
  voidedAt?: string | null;
  voidReason?: string;
  createdAt: string;
};

export type SalesSummary = {
  count: number; subtotal: number; totalDiscount: number; totalVat: number; grandTotal: number;
  byPaymentMethod: Record<string, number>;
};

export const SALE_FILTERS: { key: string; label: string }[] = [
  { key: 'completed', label: 'Completed' },
  { key: 'voided',    label: 'Voided'    },
  { key: '',          label: 'All'       },
];

export const PAY_LABEL: Record<string, string> = { cash: 'Cash', mpesa: 'M-Pesa', card: 'Card', credit: 'Credit' };
export const payLabel = (m: string): string =>
  PAY_LABEL[m] ?? (String(m || '—').charAt(0).toUpperCase() + String(m || '').slice(1));

export const saleCustomer = (s: Pick<PosSale, 'customerName' | 'customerPhone'>): string =>
  s.customerName || s.customerPhone || 'Walk-in';

/** Body for POST /pos/sales/:id/void - the server rejects an empty reason. */
export const voidBody = (reason: string) => ({ voidReason: reason.trim() });

/** Missing keys from a summary answer become zeros so the tiles never show NaN. */
export const normalizeSummary = (d: any): SalesSummary => ({
  count: Number(d?.count) || 0,
  subtotal: Number(d?.subtotal) || 0,
  totalDiscount: Number(d?.totalDiscount) || 0,
  totalVat: Number(d?.totalVat) || 0,
  grandTotal: Number(d?.grandTotal) || 0,
  byPaymentMethod: d?.byPaymentMethod && typeof d.byPaymentMethod === 'object' ? d.byPaymentMethod : {},
});

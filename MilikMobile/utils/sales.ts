// Shared constants + helpers for the Property Sales screens (dashboard, leads, deals, listings).
// Money / date formatting lives in ./pmsFormat; the list hooks in ../hooks/usePmsList.

import { apiError } from './pmsFormat';
import { cwMessage } from './carwash';

export const SC  = '#7C2D12';   // Sales brown
export const SCL = '#FEF3C7';
export const SBG = '#FFF7ED';

/** Message for a failed Sales call: the server's own message, with "Permission denied for sale-deals.view" made readable. */
export const saleError = (err: unknown, fallback: string): string => cwMessage(apiError(err, fallback));

/** The sale list endpoints answer { data, total, page, pages }. */
export const pageOf = <T,>(payload: any): { rows: T[]; pages?: number; total?: number } => {
  const rows = Array.isArray(payload) ? payload : payload?.data;
  return {
    rows:  Array.isArray(rows) ? (rows as T[]) : [],
    pages: typeof payload?.pages === 'number' ? payload.pages : undefined,
    total: typeof payload?.total === 'number' ? payload.total : undefined,
  };
};

/** Same rule the server and the web use to turn a Sale Settings name into a stored value ("Site Visited" -> "site_visited"). */
export const nameToValue = (name: string): string => String(name || '').toLowerCase().replace(/\s+/g, '_');

/** "walk_in" -> "Walk In" */
export const humanize = (v: unknown): string =>
  String(v ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** Name of a populated ref (agents / buyers / listings come back as objects; a bare id has no name). */
export const refName = (ref: unknown, ...keys: string[]): string => {
  if (!ref || typeof ref !== 'object') return '';
  for (const k of keys) {
    const v = (ref as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
};

// ─── Terminology (companies can rename Deal / Buyer / Listing ...; same keys + defaults as the web's useTerm) ───

export const TERM_DEFAULTS = {
  saleModule: 'Property Sales',
  saleListing: 'Listing',  saleListings: 'Listings',
  saleProject: 'Project',  saleProjects: 'Projects',
  saleUnit: 'Unit',        saleUnits: 'Units',
  saleBuyer: 'Buyer',      saleBuyers: 'Buyers',
  saleLead: 'Lead',        saleLeads: 'Leads',
  saleOffer: 'Offer',      saleOffers: 'Offers',
  saleDeal: 'Deal',        saleDeals: 'Deals',
  saleAgent: 'Agent',      saleAgents: 'Agents',
} as const;

export type SaleTerms = Record<keyof typeof TERM_DEFAULTS, string>;

const PLURAL_OF: Record<string, keyof typeof TERM_DEFAULTS> = {
  saleListings: 'saleListing', saleProjects: 'saleProject', saleUnits: 'saleUnit', saleBuyers: 'saleBuyer',
  saleLeads: 'saleLead', saleOffers: 'saleOffer', saleDeals: 'saleDeal', saleAgents: 'saleAgent',
};

/** A renamed singular ("Vehicle") gives the regular plural ("Vehicles") when the plural itself was not renamed. */
export const resolveTerms = (terminology?: Record<string, unknown> | null): SaleTerms => {
  const custom = (k: string) => {
    const v = terminology?.[k];
    return typeof v === 'string' && v.trim() ? v.trim() : '';
  };
  const out = {} as SaleTerms;
  (Object.keys(TERM_DEFAULTS) as (keyof typeof TERM_DEFAULTS)[]).forEach(k => {
    const singular = PLURAL_OF[k];
    out[k] = custom(k) || (singular && custom(singular) ? `${custom(singular)}s` : TERM_DEFAULTS[k]);
  });
  return out;
};

// ─── Leads ─────────────────────────────────────────────────────────────────────

/** Built-in pipeline; a company's own stages (Sale Settings) replace it. */
export const DEFAULT_LEAD_STAGES = [
  'new', 'contacted', 'qualified', 'site_visited', 'proposal_sent', 'negotiating', 'converted', 'lost',
];
export const DEFAULT_LEAD_SOURCES = ['walk_in', 'referral', 'online', 'social_media', 'agent', 'cold_call', 'other'];

const LEAD_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  new:           { bg: '#DBEAFE', color: '#1D4ED8' },
  contacted:     { bg: '#E0F2FE', color: '#0369A1' },
  qualified:     { bg: '#EDE9FE', color: '#7C3AED' },
  site_visited:  { bg: '#E0E7FF', color: '#4338CA' },
  proposal_sent: { bg: '#FEF3C7', color: '#D97706' },
  negotiating:   { bg: '#FFEDD5', color: '#EA580C' },
  converted:     { bg: '#D1FAE5', color: '#065F46' },
  lost:          { bg: '#FEE2E2', color: '#DC2626' },
};
/** Custom pipeline stages have no fixed colour. */
export const leadStatusStyle = (status: string) => LEAD_STATUS_STYLE[status] ?? { bg: '#F1F5F9', color: '#475569' };

export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'site_visit', 'whatsapp', 'note', 'follow_up'] as const;
export const ACTIVITY_OUTCOMES = ['positive', 'neutral', 'negative', 'no_answer', 'not_applicable'] as const;

/** A follow-up date in the past on a lead that is still open. */
export const followUpOverdue = (date?: string | null, status?: string): boolean =>
  !!date && !['converted', 'lost'].includes(status || '') && new Date(date).getTime() < Date.now();

// ─── Deals ─────────────────────────────────────────────────────────────────────

export const DEAL_STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  active:    { bg: '#FEF3C7', color: '#92400E', label: 'Active'    },
  closed:    { bg: '#D1FAE5', color: '#065F46', label: 'Closed'    },
  cancelled: { bg: '#F1F5F9', color: '#64748B', label: 'Cancelled' },
};

export const PAYMENT_TYPES   = ['deposit', 'installment', 'final_payment', 'other'] as const;
export const PAYMENT_METHODS = ['cash', 'mpesa', 'bank_transfer', 'cheque', 'other'] as const;
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', mpesa: 'M-Pesa', bank_transfer: 'Bank Transfer', cheque: 'Cheque', other: 'Other',
};

/** Money still owed on a deal (never negative). */
export const dealBalance = (d: { agreedPrice?: number; totalPaid?: number; balance?: number } | null | undefined): number =>
  Math.max(0, Number(d?.balance ?? (Number(d?.agreedPrice || 0) - Number(d?.totalPaid || 0))));

/** Share of the agreed price collected, 0..100. */
export const dealPct = (d: { agreedPrice?: number; totalPaid?: number } | null | undefined): number => {
  const price = Number(d?.agreedPrice || 0);
  return price > 0 ? Math.max(0, Math.min(100, (Number(d?.totalPaid || 0) / price) * 100)) : 0;
};

// ─── Listings ──────────────────────────────────────────────────────────────────

export const LISTING_STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  available:      { bg: '#D1FAE5', color: '#065F46', label: 'Available'      },
  reserved:       { bg: '#FEF3C7', color: '#D97706', label: 'Reserved'       },
  under_contract: { bg: '#DBEAFE', color: '#1D4ED8', label: 'Under Contract' },
  sold:           { bg: '#F1F5F9', color: '#64748B', label: 'Sold'           },
  withdrawn:      { bg: '#FEE2E2', color: '#DC2626', label: 'Withdrawn'      },
};

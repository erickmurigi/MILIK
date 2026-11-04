// Non-component helpers for the contract billing pages: option lists, client-side line maths
// (mirrors MilikApi/modules/clients/services/clientLineMath.js so totals match the server),
// module-level reference caches (billing settings + tax codes, income accounts, properties).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { billingApi, contractsApi, unwrapData } from '../../../services/clientsBillingApi';
import { clientsApi } from '../../../services/clientsApi';
import { adminRequests } from '../../../utils/requestMethods';
import { getCachedChartOfAccounts } from '../../../utils/chartOfAccountsCache';

// ─── Option lists ────────────────────────────────────────────────────────────
export const CONTRACT_TYPE_OPTIONS = [
  { value: 'retainer', label: 'Retainer' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'fixed_term', label: 'Fixed term' },
  { value: 'project', label: 'Project' },
  { value: 'time_and_materials', label: 'Time & materials' },
  { value: 'one_off', label: 'One-off' },
];
export const CONTRACT_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'pending_renewal', label: 'Pending renewal' },
  { value: 'renewed', label: 'Renewed' },
  { value: 'expired', label: 'Expired' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'cancelled', label: 'Cancelled' },
];
export const FREQUENCY_OPTIONS = [
  { value: 'one_off', label: 'One-off' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-annual' },
  { value: 'annual', label: 'Annual' },
];
export const FREQUENCY_MONTHS = { one_off: 0, monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 };
export const TIMING_OPTIONS = [
  { value: 'advance', label: 'Advance' },
  { value: 'arrears', label: 'Arrears' },
];
export const RECOGNITION_OPTIONS = [
  { value: 'on_invoice', label: 'On invoice' },
  { value: 'straight_line', label: 'Straight-line' },
  { value: 'milestone', label: 'Milestone' },
];
export const TAX_MODE_OPTIONS = [
  { value: 'exclusive', label: 'Tax exclusive' },
  { value: 'inclusive', label: 'Tax inclusive' },
];
export const PRORATION_OPTIONS = [
  { value: 'none', label: 'No proration' },
  { value: 'daily', label: 'Daily proration' },
];
export const INTEREST_BASIS_OPTIONS = [
  { value: 'monthly', label: '% per month' },
  { value: 'annual', label: '% per annum' },
];
export const RENEWAL_STAGES = [
  { value: 'due', label: 'Due' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'renewed', label: 'Renewed' },
  { value: 'lost', label: 'Lost' },
];
export const INVOICE_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'posted', label: 'Posted' },
  { value: 'sent', label: 'Sent' },
  { value: 'partially_paid', label: 'Partially paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'credited', label: 'Credited' },
  { value: 'cancelled', label: 'Cancelled' },
];
export const QUOTE_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'expired', label: 'Expired' },
];
export const CURRENCY_OPTIONS = ['KES', 'USD', 'EUR', 'GBP', 'UGX', 'TZS'].map((c) => ({ value: c, label: c }));
export const optionLabel = (options, value) => options.find((o) => o.value === value)?.label || String(value || '').replace(/_/g, ' ');

// Status → pill classes. Colour only where it carries meaning.
const OK = 'border-emerald-200 bg-emerald-50 text-emerald-700';
const INFO = 'border-blue-200 bg-blue-50 text-blue-700';
const WARN = 'border-amber-200 bg-amber-50 text-amber-700';
const BAD = 'border-red-200 bg-red-50 text-red-700';
const MUTED = 'border-slate-200 bg-slate-50 text-slate-500';
export const BILLING_TONES = {
  active: OK, paid: OK, posted: OK, applied: OK, invoiced: OK, completed: OK, accepted: OK, renewed: INFO,
  sent: INFO, scheduled: INFO, pending_renewal: WARN, pending_approval: WARN, partial: WARN, partially_paid: WARN,
  held: WARN, suspended: WARN, warn: WARN, invoicing: WARN, completed_with_errors: WARN, superseded: MUTED,
  overdue: BAD, terminated: BAD, rejected: BAD, failed: BAD, block: BAD, declined: BAD, reversed: BAD,
  draft: MUTED, cancelled: MUTED, skipped: MUTED, expired: MUTED, credited: MUTED, ok: OK,
};

// ─── Formatting ──────────────────────────────────────────────────────────────
const _num = new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (v) => _num.format(Number(v || 0));
export const cur = (v, currency = 'KES') => `${currency || 'KES'} ${money(v)}`;
export const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
export const isoDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
};
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const addDaysIso = (iso, days) => {
  const d = new Date(`${iso || todayIso()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};
export const addMonthsIso = (iso, months) => {
  const d = new Date(`${iso || todayIso()}T00:00:00Z`);
  const day = d.getUTCDate();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Number(months || 0), 1));
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next.toISOString().slice(0, 10);
};
export const monthIso = (offset = 0) => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() + offset, 1)).toISOString().slice(0, 7);
};
export const fmtMonth = (key) => {
  if (!key) return '—';
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};
export const userName = (u) => (u && typeof u === 'object' ? [u.surname, u.otherNames].filter(Boolean).join(' ') || u.email || '' : '');
export const daysUntil = (d) => (d ? Math.ceil((new Date(d) - new Date()) / 86_400_000) : null);
export const idOf = (v) => (v && typeof v === 'object' ? v._id : v) || '';

// ─── Line maths (mirror of clientLineMath.calculateLineAmounts) ──────────────
export const lineAmounts = ({ quantity = 1, unitPrice = 0, discountPercent = 0, taxRate = 0, taxType = 'none', taxMode = 'exclusive' }) => {
  const qty = Math.max(0, Number(quantity || 0));
  const price = Math.max(0, Number(unitPrice || 0));
  const pct = Math.min(100, Math.max(0, Number(discountPercent || 0)));
  const rate = String(taxType || '').toLowerCase() === 'vat' ? Math.max(0, Number(taxRate || 0)) : 0;
  const gross = round2(qty * price);
  const discount = round2((gross * pct) / 100);
  const line = round2(gross - discount);
  if (rate <= 0 || line <= 0) return { gross, discount, net: line, tax: 0, total: line };
  if (taxMode === 'inclusive') {
    const net = round2(line / (1 + rate / 100));
    return { gross, discount, net, tax: round2(line - net), total: line };
  }
  const tax = round2((line * rate) / 100);
  return { gross, discount, net: line, tax, total: round2(line + tax) };
};

/** Resolve a line's tax snapshot from the billing-settings tax codes. */
export const taxOf = (taxCodes, key) => {
  const code = taxCodes.find((c) => c.key === key);
  return code ? { taxType: String(code.type || 'none').toLowerCase(), taxRate: Number(code.rate || 0) } : { taxType: 'none', taxRate: 0 };
};

export const summarizeLines = (lines, taxCodes, taxMode) => lines.reduce((acc, l) => {
  const a = lineAmounts({ ...l, ...taxOf(taxCodes, l.taxCodeKey), taxMode });
  acc.gross = round2(acc.gross + a.gross);
  acc.discount = round2(acc.discount + a.discount);
  acc.net = round2(acc.net + a.net);
  acc.tax = round2(acc.tax + a.tax);
  acc.total = round2(acc.total + a.total);
  return acc;
}, { gross: 0, discount: 0, net: 0, tax: 0, total: 0 });

// Months between two dates inclusive, fractional remainder — same as the server's monthsBetweenInclusive.
export const monthsBetween = (fromIso, toIso) => {
  if (!fromIso || !toIso) return 0;
  const endExcl = addDaysIso(toIso, 1);
  if (endExcl <= fromIso) return 0;
  let months = 0;
  let cursor = fromIso;
  while (months < 1200) {
    const next = addMonthsIso(fromIso, months + 1);
    if (next > endExcl) break;
    months += 1;
    cursor = next;
  }
  const nextFull = addMonthsIso(fromIso, months + 1);
  const ms = (s) => new Date(`${s}T00:00:00Z`).getTime();
  const remainder = (ms(endExcl) - ms(cursor)) / (ms(nextFull) - ms(cursor));
  return round2(months + (remainder > 0 ? remainder : 0));
};

/** MRR / ACV / TCV, all net of tax — mirror of clientLineMath.computeContractMetrics. */
export const contractMetrics = ({ lines, taxCodes, taxMode, startDate, endDate, openEnded, minimumTermMonths }) => {
  const term = !openEnded && startDate && endDate ? monthsBetween(startDate, endDate) : Math.max(Number(minimumTermMonths || 0), 12);
  let mrr = 0;
  let tcv = 0;
  for (const l of lines) {
    const { net } = lineAmounts({ ...l, ...taxOf(taxCodes, l.taxCodeKey), taxMode });
    const months = FREQUENCY_MONTHS[l.billingFrequency] || 0;
    if (!months) { tcv += net; continue; }
    const monthly = net / months;
    mrr += monthly;
    const ls = l.startDate && startDate ? (l.startDate > startDate ? l.startDate : startDate) : (l.startDate || startDate);
    const ce = !openEnded && endDate ? endDate : null;
    const le = l.endDate && ce ? (l.endDate < ce ? l.endDate : ce) : (l.endDate || ce);
    tcv += monthly * (ls && le ? monthsBetween(ls, le) : term);
  }
  const acv = term >= 12 ? (tcv * 12) / term : tcv;
  return { mrr: round2(mrr), tcv: round2(tcv), acv: round2(acv), term };
};

let _lineSeq = 0;
export const newLineKey = () => `new-${Date.now().toString(36)}-${(_lineSeq += 1)}`;

// ─── Reference caches (module-level: survive tab unmount/remount) ────────────
const STALE_MS = 2 * 60_000;
const refCache = new Map();
const cached = (key, loader, force = false) => {
  const hit = refCache.get(key);
  if (!force && hit?.data && Date.now() - hit.at < STALE_MS) return Promise.resolve(hit.data);
  if (!force && hit?.promise) return hit.promise;
  const promise = loader()
    .then((data) => { refCache.set(key, { data, at: Date.now() }); return data; })
    .catch((err) => { refCache.delete(key); throw err; });
  refCache.set(key, { ...(hit || {}), promise });
  return promise;
};
export const invalidateBillingSettings = () => refCache.delete('billing-settings');

/** Billing settings + tax codes (the source for every tax-code picker). */
export const useBillingSettings = () => {
  const [state, setState] = useState(() => refCache.get('billing-settings')?.data || null);
  useEffect(() => {
    let alive = true;
    cached('billing-settings', async () => unwrapData(await billingApi.getSettings()))
      .then((d) => { if (alive) setState(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const taxCodes = useMemo(() => state?.taxCodes || [], [state]);
  const taxOptions = useMemo(
    () => taxCodes.map((c) => ({ value: c.key, label: c.type === 'vat' ? `${c.name} (${Number(c.rate || 0)}%)` : c.name })),
    [taxCodes],
  );
  return { settings: state?.settings || null, taxCodes, taxOptions, defaultTaxCodeKey: state?.defaultTaxCodeKey || 'vat_standard', loaded: Boolean(state) };
};

/** Posting income accounts for the optional per-line income account. */
export const useIncomeAccounts = (businessId) => {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    getCachedChartOfAccounts(businessId)
      .then((all) => { if (alive) setRows((all || []).filter((a) => a.type === 'income' && a.isPosting !== false && !a.isHeader)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [businessId]);
  return useMemo(() => rows.map((a) => ({ value: a._id, label: `${a.code ? `${a.code} · ` : ''}${a.name}` })), [rows]);
};

const listOf = (res, key) => res?.data?.[key] || res?.data?.data?.[key] || (Array.isArray(res?.data?.data) ? res.data.data : []);

/** All clients for pickers/filters — one request per business per 2 min. */
export const useBillingClients = (businessId) => {
  const key = `clients:${businessId}`;
  const [clients, setClients] = useState(() => refCache.get(key)?.data || []);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    cached(key, async () => listOf(await clientsApi.list({ limit: 200 }), 'clients'), tick > 0)
      .then((rows) => { if (alive) setClients(rows); })
      .catch(() => {});
    return () => { alive = false; };
  }, [businessId, key, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const options = useMemo(
    () => clients.map((c) => ({ value: c._id, label: `${c.name}${c.clientCode ? ` · ${c.clientCode}` : ''}`, description: c.taxPin || c.email || '' })),
    [clients],
  );
  return { clients, options, refresh };
};
export const invalidateBillingClients = (businessId) => refCache.delete(`clients:${businessId}`);

/** Company users (contract owner picker/filter). */
export const useBillingUsers = (businessId) => {
  const key = `users:${businessId}`;
  const [users, setUsers] = useState(() => refCache.get(key)?.data || []);
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    cached(key, async () => listOf(await adminRequests.get('/users', { params: { companyId: businessId, limit: 500 } }), 'users'))
      .then((rows) => { if (alive) setUsers(rows); })
      .catch(() => {});
    return () => { alive = false; };
  }, [businessId, key]);
  return useMemo(() => users.map((u) => ({ value: u._id, label: userName(u) || u.email || 'User' })), [users]);
};

/** Contracts for a client (all clients when clientId is ''/undefined; disabled when null). */
export const useClientContracts = (clientId, { liveOnly = false } = {}) => {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (clientId === null) return undefined; // disabled
    let alive = true;
    const params = { limit: 200 };
    if (clientId) params.clientId = clientId;
    contractsApi.list(params)
      .then((res) => { if (alive) setRows(listOf(res, 'contracts')); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [clientId]);
  return useMemo(() => rows
    .filter((c) => !liveOnly || ['active', 'pending_renewal', 'suspended'].includes(c.status))
    .filter((c) => !['cancelled'].includes(c.status))
    .map((c) => ({ value: c._id, label: `${c.contractNumber}${c.client?.name && !clientId ? ` · ${c.client.name}` : ''}`, description: c.description || c.status })), [rows, clientId, liveOnly]);
};

// ─── Server-paginated list with a module-level cache ─────────────────────────
// Revisiting a tab shows the last rows instantly and refreshes in the background (MilikTable's
// loading guard `isFetching && rows.length === 0` keeps visible rows on screen).
const listCache = new Map(); // `${scope}:${JSON.stringify(params)}` -> { rows, pagination, extra }
export const PAGE_SIZES = [25, 50, 100, 200];

const EMPTY_LIST = { rows: [], pagination: { total: 0, page: 1, pages: 1 } };
export const useServerList = (scope, fetcher, params, pick) => {
  const cacheKey = `${scope}:${JSON.stringify(params)}`;
  const [tick, setTick] = useState(0);
  const [result, setResult] = useState(null); // { key, data, error }
  const reqKey = `${cacheKey}#${tick}`;

  useEffect(() => {
    let alive = true;
    fetcher(params)
      .then((res) => {
        if (!alive) return;
        const data = pick(res);
        listCache.set(cacheKey, data);
        setResult({ key: reqKey, data, error: '' });
      })
      .catch((err) => { if (alive) setResult({ key: reqKey, data: null, error: err?.response?.data?.message || err?.message || 'Failed to load' }); });
    return () => { alive = false; };
    // params/fetcher/pick are captured by reqKey
  }, [reqKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const fresh = result?.key === reqKey ? result : null;
  const data = fresh?.data || listCache.get(cacheKey) || EMPTY_LIST;
  return { ...data, isFetching: !fresh, error: fresh?.error || '', reload };
};
/** Drop cached pages for a scope after a mutation elsewhere (e.g. a new invoice). */
export const invalidateList = (scope) => {
  for (const k of listCache.keys()) if (k.startsWith(`${scope}:`)) listCache.delete(k);
};

const OPEN_INVOICE = ['posted', 'sent', 'partial', 'partially_paid', 'overdue'];
export const isOpenInvoice = (inv) => OPEN_INVOICE.includes(inv?.status);
/** Status to show for an invoice: derived overdue wins; legacy "partial" reads as partially paid. */
export const invoiceDisplayStatus = (inv) => (inv.isOverdue && OPEN_INVOICE.includes(inv.status) ? 'overdue' : inv.status === 'partial' ? 'partially_paid' : inv.status);

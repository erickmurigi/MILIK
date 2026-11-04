// Non-component helpers shared by the Contract Management (clients) pages:
// formatting, option lists, module-level caches, print/export.
import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';
import { hasCompanyPermission } from '../../utils/permissions';
import { getCachedChartOfAccounts } from '../../utils/chartOfAccountsCache';
import { isCashbookAccount } from '../../utils/cashbookUtils';
import { printTabularList, printDocument, openPrintWindow } from '../../utils/printKit';
import { clientsApi } from '../../services/clientsApi';
import { store } from '../../redux/store';
import { clientsCollectionsApi, unwrap } from '../../services/clientsCollectionsApi';

// ─── Formatting ──────────────────────────────────────────────────────────────
const _num = new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (v) => _num.format(Number(v || 0));
export const kes = (v) => `KES ${money(v)}`;
export const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;
export const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
export const humanize = (s) => String(s || '').replace(/_/g, ' ');
export const userName = (u) => (u ? [u.surname, u.otherNames].filter(Boolean).join(' ') || u.email || '' : '');

// KRA PIN: letter, 9 digits, letter. Individuals start with A, others P.
export const KRA_PIN_RE = /^[A-Z]\d{9}[A-Z]$/;
export const pinHint = (pin, clientType) => {
  const v = String(pin || '').trim().toUpperCase();
  if (!v) return { error: '', warning: '' };
  if (!KRA_PIN_RE.test(v)) return { error: 'Format: letter, 9 digits, letter (e.g. P051234567X)', warning: '' };
  if (clientType === 'individual' && v[0] !== 'A') return { error: '', warning: 'Individual PINs usually start with "A"' };
  if (clientType && clientType !== 'individual' && v[0] !== 'P') return { error: '', warning: 'Non-individual PINs usually start with "P"' };
  return { error: '', warning: '' };
};

// ─── Option lists ────────────────────────────────────────────────────────────
export const CLIENT_TYPE_OPTIONS = [
  { value: 'company', label: 'Company' },
  { value: 'individual', label: 'Individual' },
  { value: 'government', label: 'Government' },
  { value: 'ngo', label: 'NGO' },
];
export const CLIENT_STATUS_OPTIONS = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'churned', label: 'Churned' },
  { value: 'blacklisted', label: 'Blacklisted' },
];
export const RECEIPT_METHOD_OPTIONS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'mobile_money', label: 'M-Pesa / mobile money' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];
export const REFUND_METHOD_OPTIONS = RECEIPT_METHOD_OPTIONS.filter((o) => o.value !== 'card');
export const methodLabel = (m) => RECEIPT_METHOD_OPTIONS.find((o) => o.value === m)?.label || humanize(m) || '—';
export const CURRENCY_OPTIONS = ['KES', 'USD', 'EUR', 'GBP', 'UGX', 'TZS'].map((c) => ({ value: c, label: c }));

// Status → pill classes (status colours only where they carry meaning).
export const STATUS_TONES = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  posted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  received: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  submitted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  sent: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  kept: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  cleared: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  prospect: 'border-blue-200 bg-blue-50 text-blue-700',
  open: 'border-blue-200 bg-blue-50 text-blue-700',
  processing: 'border-blue-200 bg-blue-50 text-blue-700',
  on_hold: 'border-amber-200 bg-amber-50 text-amber-700',
  inactive: 'border-amber-200 bg-amber-50 text-amber-700',
  expected: 'border-amber-200 bg-amber-50 text-amber-700',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  skipped: 'border-slate-200 bg-slate-50 text-slate-500',
  cancelled: 'border-slate-200 bg-slate-50 text-slate-500',
  churned: 'border-red-200 bg-red-50 text-red-700',
  blacklisted: 'border-red-200 bg-red-50 text-red-700',
  reversed: 'border-red-200 bg-red-50 text-red-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
  broken: 'border-red-200 bg-red-50 text-red-700',
  bounced: 'border-red-200 bg-red-50 text-red-700',
  block: 'border-red-200 bg-red-50 text-red-700',
};

// ─── Session / permissions ───────────────────────────────────────────────────
export const useClientsAccess = () => {
  const user = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  return useMemo(() => ({
    company,
    businessId: company?._id || '',
    canCreate: hasCompanyPermission(user, company, 'clients', 'create'),
    canEdit: hasCompanyPermission(user, company, 'clients', 'edit'),
    canDelete: hasCompanyPermission(user, company, 'clients', 'delete'),
  }), [user, company]);
};

// ─── Module-level caches (survive tab unmount/remount) ───────────────────────
const STALE_MS = 30_000;
/** A tiny keyed cache for a page's own list: fresh for 30s, `force` bypasses. */
export const createListCache = () => {
  const map = new Map();
  return {
    get: (key) => {
      const hit = map.get(key);
      return hit && Date.now() - hit.at < STALE_MS ? hit.data : null;
    },
    peek: (key) => map.get(key)?.data ?? null,
    set: (key, data) => map.set(key, { data, at: Date.now() }),
    clear: () => map.clear(),
  };
};

const REF_STALE_MS = 2 * 60_000;
const refCache = new Map(); // `${kind}:${businessId}` -> { data, at, promise }
const cachedRef = (kind, businessId, loader, { force = false } = {}) => {
  const key = `${kind}:${businessId}`;
  const hit = refCache.get(key);
  if (!force && hit?.data && Date.now() - hit.at < REF_STALE_MS) return Promise.resolve(hit.data);
  if (!force && hit?.promise) return hit.promise;
  const promise = loader()
    .then((data) => { refCache.set(key, { data, at: Date.now() }); return data; })
    .catch((err) => { refCache.delete(key); throw err; });
  refCache.set(key, { ...(hit || {}), promise });
  return promise;
};
export const invalidateClientLookup = (businessId) => refCache.delete(`clients:${businessId}`);

/** All clients (id, name, code, PIN, tax behaviour) for pickers — one request per business per 2 min. */
export const useClientLookup = (businessId) => {
  const [clients, setClients] = useState(() => refCache.get(`clients:${businessId}`)?.data || []);
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    cachedRef('clients', businessId, async () => {
      const res = await clientsApi.list({ limit: 200 });
      return res.data?.clients || unwrap(res)?.clients || [];
    }).then((rows) => { if (alive) setClients(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [businessId]);
  const options = useMemo(
    () => clients.map((c) => ({ value: c._id, label: `${c.name}${c.clientCode ? ` · ${c.clientCode}` : ''}`, description: c.tradingName || c.taxPin || '' })),
    [clients],
  );
  return { clients, options };
};

/** Posting asset accounts that look like cashbooks (cash/bank/M-Pesa). */
export const useCashbooks = (businessId) => {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    getCachedChartOfAccounts(businessId)
      .then((all) => { if (alive) setRows((all || []).filter(isCashbookAccount)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [businessId]);
  const options = useMemo(() => rows.map((a) => ({ value: a._id, label: `${a.code ? `${a.code} · ` : ''}${a.name}` })), [rows]);
  return { cashbooks: rows, options };
};

/** Company users for the account-manager pickers/filters. */
export const useCompanyUsers = (businessId) => {
  const [users, setUsers] = useState(() => refCache.get(`users:${businessId}`)?.data || []);
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    cachedRef('users', businessId, async () => {
      const res = await clientsCollectionsApi.companyUsers(businessId);
      return res.data?.users || unwrap(res)?.users || [];
    }).then((rows) => { if (alive) setUsers(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [businessId]);
  const options = useMemo(() => users.map((u) => ({ value: u._id, label: userName(u) || u.email || 'User' })), [users]);
  return { users, options };
};

// ─── Print / export ──────────────────────────────────────────────────────────
export const POPUP_BLOCKED = 'Pop-up blocked — allow pop-ups for this site to print';

/** Print a house-standard list/report (A4 landscape). `columns` = [{label, align, value(row)}]. */
const activeCompany = () => selectCurrentCompany(store.getState()) || {};
export const printReport = (spec) => {
  if (!printTabularList({ company: activeCompany(), ...spec })) toast.error(POPUP_BLOCKED);
};

/** Open the print window inside the click, then fetch, then print (avoids pop-up blocking). */
export const printAfterFetch = async (fetcher, buildSpec) => {
  const win = openPrintWindow();
  if (!win) { toast.error(POPUP_BLOCKED); return; }
  try {
    win.document.write('<p style="font-family:Arial;padding:24px;color:#475569">Preparing…</p>');
    const spec = buildSpec(await fetcher());
    (spec.document ? printDocument : printTabularList)({ company: activeCompany(), ...spec, win });
  } catch (err) {
    win.close();
    toast.error(err?.response?.data?.message || 'Could not prepare the printout');
  }
};

/** Rows → .xlsx with the same column spec the printout uses. */
export const exportExcel = async (columns, rows, filename) => {
  try {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([
      columns.map((c) => c.label),
      ...rows.map((r) => columns.map((c) => {
        const v = c.raw ? c.raw(r) : c.value ? c.value(r) : r[c.key];
        return v ?? '';
      })),
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Export');
    XLSX.writeFile(book, `${filename}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch {
    toast.error('Could not export the file');
  }
};

/** Client receipt as a customer-facing document (printKit printDocument). */
export const receiptDocSpec = (receipt, company) => {
  const client = receipt.client || {};
  const wit = Number(receipt.whtIncomeTax?.amount || 0);
  const wvat = Number(receipt.whtVat?.amount || 0);
  const allocs = (receipt.allocations || []).filter((a) => a.status !== 'reversed');
  return {
    document: true,
    company,
    docType: 'Receipt',
    docNumber: receipt.receiptNumber,
    status: receipt.status === 'reversed' ? { label: 'Reversed', tone: 'danger' } : { label: 'Posted', tone: 'success' },
    watermark: receipt.status === 'reversed' ? 'VOID' : '',
    meta: [
      ['Date', new Date(receipt.receiptDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })],
      ['Method', methodLabel(receipt.method)],
      ...(receipt.reference ? [['Reference', receipt.reference]] : []),
      ...(receipt.chequeNumber ? [['Cheque no', receipt.chequeNumber]] : []),
    ],
    parties: [{ heading: 'Received from', name: client.name || '', lines: [client.clientCode, client.taxPin ? `PIN ${client.taxPin}` : '', client.email, client.phone] }],
    table: {
      columns: [
        { label: 'Invoice', value: (a) => a.invoiceNumber },
        { label: 'Applied', value: (a) => (a.kind === 'credit_application' ? 'Credit applied' : 'This receipt') },
        { label: 'Amount', align: 'right', value: (a) => money(a.amount) },
      ],
      rows: allocs,
      empty: 'Held as client credit',
    },
    totals: [
      { label: 'Cash received', value: kes(receipt.amount) },
      ...(wit ? [{ label: `Income tax withheld${receipt.whtIncomeTax?.certificateNo ? ` (${receipt.whtIncomeTax.certificateNo})` : ''}`, value: kes(wit) }] : []),
      ...(wvat ? [{ label: `VAT withheld${receipt.whtVat?.certificateNo ? ` (${receipt.whtVat.certificateNo})` : ''}`, value: kes(wvat) }] : []),
      { label: 'Total settled', value: kes(Number(receipt.amount || 0) + wit + wvat), hero: true },
      ...(Number(receipt.unappliedAmount || 0) > 0 ? [{ label: 'Held as credit', value: kes(receipt.unappliedAmount) }] : []),
    ],
    amountWords: { amount: Number(receipt.amount || 0) },
    notes: receipt.notes ? [{ heading: 'Notes', text: receipt.notes }] : [],
    signatures: [{ label: 'Received by' }],
  };
};

// ─── Form classes (AddLandlord.jsx standard) ─────────────────────────────────
export const labelClass = 'mb-1 block text-xs font-bold text-slate-900';
export const inputClass = 'h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20 disabled:bg-slate-50 disabled:text-slate-500';
export const tableInputClass = 'h-7 w-full border bg-white px-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20';
export const textareaClass = 'w-full border bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20';
export const footerBtn = 'h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
export const footerPrimary = 'inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60';
export const iconBtn = 'p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30';
export const iconBtnDanger = 'p-1 text-red-600 hover:bg-red-50 hover:text-red-800 disabled:opacity-30';
export const cell = 'px-3 py-1.5 border-r border-gray-100 normal-case';
export const cellLast = 'px-3 py-1.5 normal-case';
export const numCell = 'px-3 py-1.5 border-r border-gray-100 text-right tabular-nums';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '../../context/ConfirmContext';
import { formatMoney } from '../../utils/money';
import { useTabState } from '../../hooks/useTabState';
import { useEntityCache } from '../../hooks/useEntityCache';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  FaPlus, FaSync, FaEdit, FaTrash, FaDownload,
  FaSearch, FaTimes, FaReceipt, FaMoneyBillWave, FaCalendarAlt,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { selectCurrentUser, selectCurrentCompany, selectAllProperties, selectAllUnits, selectAllExpenseProperties } from '../../redux/selectors';
import { hasCompanyPermission } from '../../utils/permissions';
import { isCashbookAccount } from '../../utils/cashbookUtils';
import { getProperties } from '../../redux/propertyRedux';
import { getUnits } from '../../redux/unitRedux';
import {
  getExpenseProperties,
  createExpenseProperty,
  updateExpenseProperty,
  deleteExpenseProperty,
  getChartOfAccounts,
} from '../../redux/apiCalls';
import AppSelect from '../../components/common/AppSelect';
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import ListToolbar from '../../components/common/ListToolbar';
import { useTerm } from '../../hooks/useTerm';

// ─── constants ────────────────────────────────────────────────────────────────
const CATEGORIES = ['maintenance', 'repair', 'utility', 'tax', 'insurance', 'supplies', 'other'];
const PAYMENT_METHODS = ['cash', 'mobile_money', 'bank_transfer', 'check', 'credit_card'];

const CATEGORY_COLORS = {
  maintenance: 'bg-orange-100 text-orange-700',
  repair: 'bg-red-100 text-red-700',
  utility: 'bg-blue-100 text-blue-700',
  tax: 'bg-purple-100 text-purple-700',
  insurance: 'bg-teal-100 text-teal-700',
  supplies: 'bg-yellow-100 text-yellow-700',
  other: 'bg-gray-100 text-gray-700',
};

const humanize = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: humanize(c) }));
const PAYMENT_METHOD_OPTIONS = PAYMENT_METHODS.map((m) => ({ value: m, label: humanize(m) }));
const CATEGORY_DOT = {
  maintenance: 'bg-orange-400', repair: 'bg-red-400', utility: 'bg-blue-400',
  tax: 'bg-purple-400', insurance: 'bg-teal-400', supplies: 'bg-yellow-400', other: 'bg-slate-400',
};
const toInput = (d) => { try { return new Date(d).toISOString().split('T')[0]; } catch { return ''; } };
const today = () => toInput(new Date());
const normalizeId = (v) => (typeof v === 'string' ? v : v?._id || v?.id || '');

const defaultStart = toInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1));


const EMPTY_FORM = {
  property: '', unit: '', category: 'maintenance', amount: '',
  description: '', date: today(), receiptNumber: '', paidBy: '', paymentMethod: 'cash',
  cashbook: '',
};

// ─── ExpenseModal ─────────────────────────────────────────────────────────────
const ExpenseModal = ({ open, editing, properties, units, businessId, onClose, onSave }) => {
  const termProperty  = useTerm('property');
  const termProperties = useTerm('properties');
  const termUnit      = useTerm('unit');
  const termReceipt   = useTerm('receipt');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [cashbookOptions, setCashbookOptions] = useState([]);
  const firstRef = useRef(null);

  useEffect(() => {
    if (!open || !businessId) return;
    getChartOfAccounts({ business: businessId, type: 'asset' }).then((rows) => {
      const books = (rows || []).filter(isCashbookAccount);
      setCashbookOptions(books);
      if (!editing && books.length > 0) {
        const preferred = books.find((b) => b.name === 'Main Cashbook') || books[0];
        setForm((f) => ({ ...f, cashbook: f.cashbook || preferred.name }));
      }
    }).catch(() => {});
  }, [open, businessId, editing]);

  useEffect(() => {
    if (!open) return;
    setForm(editing
      ? {
          property: normalizeId(editing.property) || '',
          unit: normalizeId(editing.unit) || '',
          category: editing.category || 'maintenance',
          amount: String(editing.amount || ''),
          description: editing.description || '',
          date: toInput(editing.date) || today(),
          receiptNumber: editing.receiptNumber || '',
          paidBy: editing.paidBy || '',
          paymentMethod: editing.paymentMethod || 'cash',
          cashbook: editing.cashbook || '',
        }
      : { ...EMPTY_FORM, date: today() }
    );
    setTimeout(() => firstRef.current?.focus(), 60);
  }, [open, editing]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const propertyOptions = useMemo(
    () => properties.map((p) => ({ value: p._id, label: p.propertyName || p.name })),
    [properties]
  );

  const filteredUnits = useMemo(
    () => form.property ? units.filter((u) => normalizeId(u.property) === form.property) : units,
    [units, form.property]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.category || !form.amount || !form.description || !form.date) {
      toast.error('Category, amount, description and date are required.');
      return;
    }
    if (Number(form.amount) <= 0) { toast.error('Amount must be greater than zero.'); return; }
    if (!form.cashbook) { toast.error('Please select the cashbook this expense was paid from.'); return; }
    setSaving(true);
    try {
      await onSave({ ...form, amount: Number(form.amount) });
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to save expense.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const cashbookSelectOptions = cashbookOptions.map((b) => ({
    value: b.name,
    label: b.code ? `${b.code} · ${b.name}` : b.name,
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl">
          <h2 className="text-sm font-black">
            {editing ? 'Edit Expense' : `Record ${termProperty} Expense`}
          </h2>
          <button onClick={onClose} className="rounded-full border border-white/30 p-1.5 hover:bg-white/10 transition">
            <FaTimes size={12} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[78vh] overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">{termProperty}</label>
              <AppSelect
                value={form.property || null}
                onChange={(v) => setForm((f) => ({ ...f, property: v ?? '', unit: '' }))}
                options={propertyOptions}
                placeholder={`— All ${termProperties.toLowerCase()} —`}
                searchable
                clearable
                size="md"
              />
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">{termUnit} <span className="font-normal text-gray-400">(optional)</span></label>
              <AppSelect
                value={form.unit || null}
                onChange={(v) => setForm((f) => ({ ...f, unit: v ?? '' }))}
                options={filteredUnits.map((u) => ({ value: u._id, label: u.unitNumber || u.name }))}
                placeholder={`— No specific ${termUnit.toLowerCase()} —`}
                searchable
                clearable
                size="md"
              />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Category <span className="text-red-500">*</span></label>
              <AppSelect
                value={form.category || null}
                onChange={(v) => setForm((f) => ({ ...f, category: v ?? '' }))}
                options={CATEGORY_OPTIONS}
                size="md"
              />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Amount (KES) <span className="text-red-500">*</span></label>
              <input type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} required placeholder="0.00"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
            </div>

            <div className="col-span-2">
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Description <span className="text-red-500">*</span></label>
              <input type="text" value={form.description} onChange={set('description')} required placeholder="What was this expense for?"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Date <span className="text-red-500">*</span></label>
              <input type="date" value={form.date} onChange={set('date')} required
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Payment Method</label>
              <AppSelect
                value={form.paymentMethod || null}
                onChange={(v) => setForm((f) => ({ ...f, paymentMethod: v ?? '' }))}
                options={PAYMENT_METHOD_OPTIONS}
                size="md"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">
                Cashbook <span className="text-red-500">*</span>
              </label>
              <AppSelect
                value={form.cashbook || null}
                onChange={(v) => setForm((f) => ({ ...f, cashbook: v ?? '' }))}
                options={cashbookSelectOptions}
                placeholder="Select cashbook paid from…"
                searchable
                clearable
                size="md"
                emptyMessage="No cashbooks found — check Chart of Accounts"
              />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">{termReceipt} / Ref No.</label>
              <input type="text" value={form.receiptNumber} onChange={set('receiptNumber')} placeholder="Optional"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Paid By</label>
              <input type="text" value={form.paidBy} onChange={set('paidBy')} placeholder="Name or account"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} disabled={saving}
              className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="rounded-lg bg-[#0B3B2E] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#0A3127] transition disabled:opacity-50">
              {saving ? 'Saving…' : editing ? 'Update Expense' : 'Record Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────
const PropertyExpenses = () => {
  const termProperty   = useTerm('property');
  const termProperties = useTerm('properties');
  const termUnit       = useTerm('unit');
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const currentUser    = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const properties     = useSelector(selectAllProperties);
  const units          = useSelector(selectAllUnits);
  const expenses       = useSelector(selectAllExpenseProperties);
  const loading        = useSelector((s) => s.expenseProperty?.isFetching);

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company || '';
  const { propertiesLoaded, unitsLoaded } = useEntityCache(businessId);
  const currency   = currentCompany?.baseCurrency || 'KES';

  const { canCreateExpense, canUpdateExpense, canDeleteExpense } = useMemo(() => ({
    canCreateExpense: hasCompanyPermission(currentUser || {}, currentCompany, 'propertyExpenses', 'create', 'propertyManagement'),
    canUpdateExpense: hasCompanyPermission(currentUser || {}, currentCompany, 'propertyExpenses', 'update', 'propertyManagement'),
    canDeleteExpense: hasCompanyPermission(currentUser || {}, currentCompany, 'propertyExpenses', 'delete', 'propertyManagement'),
  }), [currentUser, currentCompany]);

  // ─── filters ──────────────────────────────────────────────────────────────
  const [filters, setFilters] = useTabState("/property-expenses:filters", () => ({ startDate: defaultStart, endDate: today(), propertyId: '', category: '', search: '' }));
  const [page, setPage] = useTabState("/property-expenses:page", 1);
  const [pageSize, setPageSize] = useState(20);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const setFilter = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };

  useEffect(() => {
    if (!businessId) return;
    if (!propertiesLoaded) dispatch(getProperties({ business: businessId }));
    if (!unitsLoaded) dispatch(getUnits({ business: businessId, limit: 1000 }));
  }, [businessId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    if (!businessId) return;
    getExpenseProperties(dispatch, businessId, filters.category || null, filters.propertyId || null, null, filters.startDate || null, filters.endDate || null);
  }, [dispatch, businessId, filters.startDate, filters.endDate, filters.propertyId, filters.category]);

  useEffect(() => { load(); }, [load]);

  // ─── derived data ──────────────────────────────────────────────────────────
  const propertyMap     = useMemo(() => new Map(properties.map((p) => [String(p._id), p.propertyName || p.name || 'Unknown'])), [properties]);
  const unitMap         = useMemo(() => new Map(units.map((u) => [String(u._id), u.unitNumber || u.name || '—'])), [units]);
  const propertyOptions = useMemo(() => properties.map((p) => ({ value: p._id, label: p.propertyName || p.name })), [properties]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return expenses.filter((exp) => {
      if (!q) return true;
      const propName = propertyMap.get(normalizeId(exp.property)) || '';
      return (
        exp.description?.toLowerCase().includes(q) ||
        exp.category?.toLowerCase().includes(q) ||
        propName.toLowerCase().includes(q) ||
        exp.receiptNumber?.toLowerCase().includes(q) ||
        exp.paidBy?.toLowerCase().includes(q)
      );
    });
  }, [expenses, filters.search, propertyMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = filtered.slice((page - 1) * pageSize, page * pageSize);

  // ─── summary ──────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const catMap = new Map(CATEGORIES.map((c) => [c, { total: 0, count: 0 }]));
    let total = 0;
    for (const e of filtered) {
      const amt = Number(e.amount || 0);
      total += amt;
      const entry = catMap.get(e.category);
      if (entry) { entry.total += amt; entry.count += 1; }
    }
    const byCat = [];
    for (const [cat, { total: t, count }] of catMap) {
      if (t > 0) byCat.push({ cat, total: t, count });
    }
    byCat.sort((a, b) => b.total - a.total);
    return { total, count: filtered.length, byCat };
  }, [filtered]);

  // ─── CRUD ─────────────────────────────────────────────────────────────────
  const handleSave = async (data) => {
    const payload = { ...data, business: businessId };
    if (editing) {
      await updateExpenseProperty(dispatch, editing._id, payload);
      toast.success('Expense updated.');
    } else {
      await createExpenseProperty(dispatch, payload);
      toast.success('Expense recorded.');
    }
    load();
  };

  const handleDelete = async (exp) => {
    if (!await confirm({ message: `Delete expense "${exp.description}" (${formatMoney(exp.amount)})? This cannot be undone.`, confirmText: "Delete", isDangerous: true })) return;
    setDeleting(exp._id);
    try {
      await deleteExpenseProperty(dispatch, exp._id);
      toast.success('Expense deleted.');
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete expense.');
    } finally {
      setDeleting(null);
    }
  };

  // ─── CSV export ───────────────────────────────────────────────────────────
  const handleExport = () => {
    const header = ['Date', termProperty, termUnit, 'Category', 'Description', 'Amount', 'Payment Method', 'Cashbook', 'Receipt No.', 'Paid By'];
    const rows = filtered.map((e) => [
      toInput(e.date),
      propertyMap.get(normalizeId(e.property)) || '',
      unitMap.get(normalizeId(e.unit)) || '',
      humanize(e.category),
      e.description,
      Number(e.amount || 0).toFixed(2),
      humanize(e.paymentMethod),
      e.cashbook || '',
      e.receiptNumber || '',
      e.paidBy || '',
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `property-expenses-${filters.startDate}-to-${filters.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout lockContentScroll>
      <ExpenseModal
        open={modalOpen}
        editing={editing}
        properties={properties}
        units={units}
        businessId={businessId}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSave={handleSave}
      />

      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* ─── Summary chips ──────────────────────────────────────────────── */}
        <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <div className="inline-flex items-center gap-2 border border-slate-200 bg-slate-50 px-3 py-1.5">
            <FaMoneyBillWave size={9} className="text-slate-500 shrink-0" />
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Total</span>
            <span className="text-sm font-black text-[#0B3B2E]">{formatMoney(summary.total)}</span>
          </div>
          {summary.byCat.slice(0, 4).map(({ cat, total, count }) => (
            <div key={cat} className="inline-flex items-center gap-2 border border-slate-200 bg-white px-3 py-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY_DOT[cat] || 'bg-slate-400'}`} />
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{humanize(cat)}</span>
              <span className="text-xs font-black text-slate-700">{formatMoney(total)}</span>
              <span className="text-[10px] text-slate-400">{count}</span>
            </div>
          ))}
          <span className="ml-auto text-[10px] font-semibold text-slate-400">
            {summary.count} expense{summary.count !== 1 ? 's' : ''} in period
          </span>
        </div>

        {/* ─── Filter bar ─────────────────────────────────────────────────── */}
        <ListToolbar>
          <ListToolbar.Input type="date" value={filters.startDate} onChange={setFilter('startDate')} />
          <span className="shrink-0 text-[9px] text-slate-400">—</span>
          <ListToolbar.Input type="date" value={filters.endDate} onChange={setFilter('endDate')} />
          <ListToolbar.Divider />
          <AppSelect
            value={filters.propertyId || null}
            onChange={(v) => { setFilters((f) => ({ ...f, propertyId: v ?? '' })); setPage(1); }}
            options={propertyOptions}
            placeholder={`All ${termProperties.toLowerCase()}`}
            searchable clearable compact
          />
          <AppSelect
            value={filters.category || null}
            onChange={(v) => { setFilters((f) => ({ ...f, category: v ?? '' })); setPage(1); }}
            options={CATEGORY_OPTIONS}
            placeholder="All categories"
            clearable compact
          />
          <div className="relative shrink-0">
            <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
            <ListToolbar.Input type="text" value={filters.search} onChange={setFilter('search')} placeholder="Search description, property…" width="w-36" className="pl-5" />
          </div>
          <ListToolbar.Divider />
          <ListToolbar.Button icon={FaSync} variant="outline" onClick={load} title="Refresh">Refresh</ListToolbar.Button>
          <ListToolbar.Button icon={FaDownload} variant="outline" onClick={handleExport}>Export</ListToolbar.Button>
          {canCreateExpense && (
            <ListToolbar.Button icon={FaPlus} onClick={() => { setEditing(null); setModalOpen(true); }}>
              Record Expense
            </ListToolbar.Button>
          )}
        </ListToolbar>

        {/* ─── Table ──────────────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white m-2 rounded-lg shadow-sm">
          <MilikTable
            columns={[
              { label: 'Date' },
              { label: `${termProperty} / ${termUnit}` },
              { label: 'Category' },
              { label: 'Description' },
              { label: 'Amount' },
              { label: 'Payment' },
              { label: 'Cashbook' },
              { label: 'Ref / By' },
            ]}
            rows={paginated}
            rowKey="_id"
            loading={loading && expenses.length === 0}
            minWidth="900px"
            empty={
              <div className="flex flex-col items-center gap-3 py-4">
                <FaReceipt size={28} className="text-slate-200" />
                <p className="text-xs font-semibold text-slate-400">No expenses found for this period</p>
                {canCreateExpense && (
                  <button onClick={() => { setEditing(null); setModalOpen(true); }}
                    className="mt-1 inline-flex items-center gap-1.5 rounded bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0A3127]">
                    <FaPlus size={10} /> Record your first expense
                  </button>
                )}
              </div>
            }
            renderFooter={() => (
              <>
                <td colSpan={4} className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e]">
                  Total ({filtered.length} expense{filtered.length !== 1 ? 's' : ''})
                </td>
                <td className="px-3 py-2 font-extrabold text-[#0B3B2E]" colSpan={4}>
                  {formatMoney(summary.total)}
                </td>
              </>
            )}
            renderRow={(exp) => {
              const propName = propertyMap.get(normalizeId(exp.property)) || '—';
              const unitNum  = unitMap.get(normalizeId(exp.unit)) || null;
              return (
                <>
                  <td className="whitespace-nowrap px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-700">
                    <div className="flex items-center gap-1.5">
                      <FaCalendarAlt size={9} className="text-slate-400 shrink-0" />
                      {toInput(exp.date)}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100">
                    <div className="font-semibold text-slate-800 truncate max-w-[160px]">{propName}</div>
                    {unitNum && <div className="text-[10px] text-slate-500">{termUnit} {unitNum}</div>}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${CATEGORY_COLORS[exp.category] || CATEGORY_COLORS.other}`}>
                      {humanize(exp.category)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 max-w-[220px]">
                    <div className="truncate font-medium text-slate-700" title={exp.description}>{exp.description}</div>
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-slate-900 whitespace-nowrap">
                    {formatMoney(exp.amount)}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">{humanize(exp.paymentMethod)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500 whitespace-nowrap">{exp.cashbook || '—'}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">
                    {exp.receiptNumber && <div className="font-medium text-slate-600">{exp.receiptNumber}</div>}
                    {exp.paidBy && <div className="text-[10px] text-slate-400">{exp.paidBy}</div>}
                  </td>
                </>
              );
            }}
            renderActions={(exp) => (
              <div className="flex items-center gap-1">
                {canUpdateExpense && (
                  <button onClick={() => { setEditing(exp); setModalOpen(true); }}
                    className="rounded p-1.5 text-[#0B3B2E] hover:bg-[#ECF6F1]" title="Edit">
                    <FaEdit size={11} />
                  </button>
                )}
                {canDeleteExpense && (
                  <button onClick={() => handleDelete(exp)} disabled={deleting === exp._id}
                    className="rounded p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-40" title="Delete">
                    <FaTrash size={11} />
                  </button>
                )}
              </div>
            )}
          />

          {/* Pagination */}
          <PaginationBar
            page={page}
            pages={totalPages}
            total={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
            loading={loading}
            label="expenses"
          />
        </div>

      </div>
    </DashboardLayout>
  );
};

export default PropertyExpenses;

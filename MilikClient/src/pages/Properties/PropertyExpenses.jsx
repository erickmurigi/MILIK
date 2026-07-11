import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useEntityCache } from '../../hooks/useEntityCache';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  FaPlus, FaFilter, FaSync, FaEdit, FaTrash, FaDownload,
  FaBuilding, FaSearch, FaTimes, FaReceipt, FaMoneyBillWave,
  FaChartPie, FaCalendarAlt,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { selectCurrentUser, selectCurrentCompany, selectAllProperties, selectAllUnits, selectAllExpenseProperties } from '../../redux/selectors';
import { hasCompanyPermission } from '../../utils/permissions';
import { getProperties } from '../../redux/propertyRedux';
import { getUnits } from '../../redux/unitRedux';
import {
  getExpenseProperties,
  createExpenseProperty,
  updateExpenseProperty,
  deleteExpenseProperty,
} from '../../redux/apiCalls';

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
const formatMoney = (v, currency = 'KES') => `${currency} ${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toInput = (d) => { try { return new Date(d).toISOString().split('T')[0]; } catch { return ''; } };
const today = () => toInput(new Date());
const normalizeId = (v) => (typeof v === 'string' ? v : v?._id || v?.id || '');

const EMPTY_FORM = {
  property: '', unit: '', category: 'maintenance', amount: '',
  description: '', date: today(), receiptNumber: '', paidBy: '', paymentMethod: 'cash',
};

// ─── ExpenseModal ─────────────────────────────────────────────────────────────
const ExpenseModal = ({ open, editing, properties, units, onClose, onSave }) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const firstRef = useRef(null);

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
        }
      : { ...EMPTY_FORM, date: today() }
    );
    setTimeout(() => firstRef.current?.focus(), 60);
  }, [open, editing]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-sm font-extrabold uppercase tracking-tight text-[#1f4a35]">
            {editing ? 'Edit Expense' : 'Record Property Expense'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition">
            <FaTimes size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Property</label>
              <select ref={firstRef} value={form.property} onChange={(e) => setForm((f) => ({ ...f, property: e.target.value, unit: '' }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#31694E] focus:outline-none focus:ring-1 focus:ring-[#31694E]">
                <option value="">— All properties —</option>
                {properties.map((p) => <option key={p._id} value={p._id}>{p.propertyName || p.name}</option>)}
              </select>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Unit <span className="font-normal text-gray-400">(optional)</span></label>
              <select value={form.unit} onChange={set('unit')}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#31694E] focus:outline-none focus:ring-1 focus:ring-[#31694E]">
                <option value="">— No specific unit —</option>
                {filteredUnits.map((u) => <option key={u._id} value={u._id}>{u.unitNumber || u.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Category <span className="text-red-500">*</span></label>
              <select value={form.category} onChange={set('category')} required
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#31694E] focus:outline-none focus:ring-1 focus:ring-[#31694E]">
                {CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Amount (KES) <span className="text-red-500">*</span></label>
              <input type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} required placeholder="0.00"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#31694E] focus:outline-none focus:ring-1 focus:ring-[#31694E]" />
            </div>

            <div className="col-span-2">
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Description <span className="text-red-500">*</span></label>
              <input type="text" value={form.description} onChange={set('description')} required placeholder="What was this expense for?"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#31694E] focus:outline-none focus:ring-1 focus:ring-[#31694E]" />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Date <span className="text-red-500">*</span></label>
              <input type="date" value={form.date} onChange={set('date')} required
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#31694E] focus:outline-none focus:ring-1 focus:ring-[#31694E]" />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Payment Method</label>
              <select value={form.paymentMethod} onChange={set('paymentMethod')}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#31694E] focus:outline-none focus:ring-1 focus:ring-[#31694E]">
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Receipt / Ref No.</label>
              <input type="text" value={form.receiptNumber} onChange={set('receiptNumber')} placeholder="Optional"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#31694E] focus:outline-none focus:ring-1 focus:ring-[#31694E]" />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e] mb-1">Paid By</label>
              <input type="text" value={form.paidBy} onChange={set('paidBy')} placeholder="Name or account"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#31694E] focus:outline-none focus:ring-1 focus:ring-[#31694E]" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} disabled={saving}
              className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="rounded-lg bg-[#31694E] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#1f4a35] transition disabled:opacity-50">
              {saving ? 'Saving…' : editing ? 'Update Expense' : 'Record Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

const PropertyExpenses = () => {
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

  const canCreateExpense = hasCompanyPermission(currentUser || {}, currentCompany, 'propertyExpenses', 'create', 'propertyManagement');
  const canUpdateExpense = hasCompanyPermission(currentUser || {}, currentCompany, 'propertyExpenses', 'update', 'propertyManagement');
  const canDeleteExpense = hasCompanyPermission(currentUser || {}, currentCompany, 'propertyExpenses', 'delete', 'propertyManagement');

  // ─── filters ──────────────────────────────────────────────────────────────
  const defaultStart = toInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [filters, setFilters] = useTabState("/property-expenses:filters", () => ({ startDate: defaultStart, endDate: today(), propertyId: '', category: '', search: '' }));
  const [page, setPage] = useTabState("/property-expenses:page", 1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const setFilter = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };

  useEffect(() => {
    if (!businessId) return;
    if (!propertiesLoaded) dispatch(getProperties({ business: businessId }));
    if (!unitsLoaded) dispatch(getUnits({ business: businessId }));
  }, [businessId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    if (!businessId) return;
    getExpenseProperties(dispatch, businessId, filters.category || null, filters.propertyId || null, null, filters.startDate || null, filters.endDate || null);
  }, [dispatch, businessId, filters.startDate, filters.endDate, filters.propertyId, filters.category]);

  useEffect(() => { load(); }, [load]);

  // ─── derived data ──────────────────────────────────────────────────────────
  const propertyMap = useMemo(() => new Map(properties.map((p) => [String(p._id), p.propertyName || p.name || 'Unknown'])), [properties]);
  const unitMap     = useMemo(() => new Map(units.map((u) => [String(u._id), u.unitNumber || u.name || '—'])), [units]);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ─── summary ──────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const total = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);
    const byCat = CATEGORIES.map((cat) => ({
      cat,
      total: filtered.filter((e) => e.category === cat).reduce((s, e) => s + Number(e.amount || 0), 0),
      count: filtered.filter((e) => e.category === cat).length,
    })).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
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
    if (!window.confirm(`Delete expense "${exp.description}" (${formatMoney(exp.amount, currency)})? This cannot be undone.`)) return;
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
    const header = ['Date', 'Property', 'Unit', 'Category', 'Description', 'Amount', 'Payment Method', 'Receipt No.', 'Paid By'];
    const rows = filtered.map((e) => [
      toInput(e.date),
      propertyMap.get(normalizeId(e.property)) || '',
      unitMap.get(normalizeId(e.unit)) || '',
      humanize(e.category),
      e.description,
      Number(e.amount || 0).toFixed(2),
      humanize(e.paymentMethod),
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
    <DashboardLayout>
      <ExpenseModal
        open={modalOpen}
        editing={editing}
        properties={properties}
        units={units}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSave={handleSave}
      />

      <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
        {/* ─── Header ─────────────────────────────────────────────────────── */}
        <div className="border-b border-gray-200 bg-white px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-base font-extrabold uppercase tracking-tight text-[#1f4a35]">Property Expenses</h1>
              <p className="mt-0.5 text-xs font-medium text-gray-500">
                Track maintenance, repair, utility, tax, insurance and other property costs
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleExport} title="Export CSV"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 transition">
                <FaDownload size={11} /> Export
              </button>
              <button onClick={load}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 transition">
                <FaSync size={11} className={loading ? 'animate-spin' : ''} />
              </button>
              {canCreateExpense && (
                <button onClick={() => { setEditing(null); setModalOpen(true); }}
                  className="flex items-center gap-1.5 rounded-lg bg-[#31694E] px-4 py-2 text-xs font-extrabold text-white hover:bg-[#1f4a35] transition shadow-sm">
                  <FaPlus size={11} /> Record Expense
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* ─── Summary cards ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-[#dce9e1] bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e]">
                <FaMoneyBillWave size={11} /> Total Expenses
              </div>
              <div className="mt-2 text-lg font-extrabold text-[#1f4a35]">{formatMoney(summary.total, currency)}</div>
              <div className="mt-0.5 text-[10px] text-gray-400">{summary.count} record{summary.count !== 1 ? 's' : ''} in period</div>
            </div>

            {summary.byCat.slice(0, 3).map(({ cat, total, count }) => (
              <div key={cat} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-gray-500">
                  <FaChartPie size={11} /> {humanize(cat)}
                </div>
                <div className="mt-2 text-base font-extrabold text-slate-800">{formatMoney(total, currency)}</div>
                <div className="mt-0.5 text-[10px] text-gray-400">{count} transaction{count !== 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>

          {/* ─── Filters ──────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e]">
              <FaFilter size={10} /> Filters
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">From</label>
              <input type="date" value={filters.startDate} onChange={setFilter('startDate')}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:border-[#31694E] focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">To</label>
              <input type="date" value={filters.endDate} onChange={setFilter('endDate')}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:border-[#31694E] focus:outline-none" />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">Property</label>
              <select value={filters.propertyId} onChange={setFilter('propertyId')}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:border-[#31694E] focus:outline-none">
                <option value="">All properties</option>
                {properties.map((p) => <option key={p._id} value={p._id}>{p.propertyName || p.name}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">Category</label>
              <select value={filters.category} onChange={setFilter('category')}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:border-[#31694E] focus:outline-none">
                <option value="">All categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
              <label className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">Search</label>
              <div className="relative">
                <FaSearch size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={filters.search} onChange={setFilter('search')} placeholder="Description, property, receipt…"
                  className="w-full rounded-lg border border-gray-200 py-1.5 pl-7 pr-3 text-xs focus:border-[#31694E] focus:outline-none" />
              </div>
            </div>
          </div>

          {/* ─── Table ────────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            {loading && expenses.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-xs text-gray-400">Loading expenses…</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <FaReceipt size={28} className="text-gray-200" />
                <p className="text-xs font-semibold text-gray-400">No expenses found for this period</p>
                {canCreateExpense && (
                  <button onClick={() => { setEditing(null); setModalOpen(true); }}
                    className="mt-1 flex items-center gap-1.5 rounded-lg bg-[#31694E] px-4 py-2 text-xs font-extrabold text-white hover:bg-[#1f4a35] transition">
                    <FaPlus size={10} /> Record your first expense
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-[#0B3B2E] text-white">
                        {['Date', 'Property / Unit', 'Category', 'Description', 'Amount', 'Payment', 'Ref / By', ''].map((h, i, arr) => (
                          <th key={h} className={`px-3 py-1 text-left font-bold ${i < arr.length - 1 ? "border-r border-white/10" : ""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((exp, idx) => {
                        const propName = propertyMap.get(normalizeId(exp.property)) || '—';
                        const unitNum  = unitMap.get(normalizeId(exp.unit)) || null;
                        return (
                          <tr key={exp._id} className={`border-b border-gray-100 transition-colors hover:bg-blue-50/40 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}>
                            <td className="whitespace-nowrap px-3 py-1 border-r border-gray-100 font-semibold text-gray-700">
                              <div className="flex items-center gap-1.5">
                                <FaCalendarAlt size={9} className="text-gray-400 shrink-0" />
                                {toInput(exp.date)}
                              </div>
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100">
                              <div className="flex items-center gap-1.5">
                                <FaBuilding size={9} className="text-gray-400 shrink-0" />
                                <div>
                                  <div className="font-semibold text-slate-800 truncate max-w-[140px]">{propName}</div>
                                  {unitNum && <div className="text-gray-400">Unit {unitNum}</div>}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${CATEGORY_COLORS[exp.category] || CATEGORY_COLORS.other}`}>
                                {humanize(exp.category)}
                              </span>
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100 max-w-[200px]">
                              <div className="truncate font-medium text-slate-700" title={exp.description}>{exp.description}</div>
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100 font-bold text-slate-900 whitespace-nowrap">
                              {formatMoney(exp.amount, currency)}
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100 text-gray-500">{humanize(exp.paymentMethod)}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-gray-500">
                              {exp.receiptNumber && <div className="font-medium text-gray-600">{exp.receiptNumber}</div>}
                              {exp.paidBy && <div className="text-[10px]">{exp.paidBy}</div>}
                            </td>
                            <td className="px-3 py-1">
                              <div className="flex items-center gap-1">
                                {canUpdateExpense && (
                                  <button onClick={() => { setEditing(exp); setModalOpen(true); }}
                                    className="rounded p-1.5 text-[#31694E] hover:bg-[#ECF6F1] transition" title="Edit">
                                    <FaEdit size={11} />
                                  </button>
                                )}
                                {canDeleteExpense && (
                                  <button onClick={() => handleDelete(exp)} disabled={deleting === exp._id}
                                    className="rounded p-1.5 text-red-500 hover:bg-red-50 transition disabled:opacity-40" title="Delete">
                                    <FaTrash size={11} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-100 bg-slate-50">
                        <td colSpan={4} className="px-3 py-2.5 text-[10px] font-extrabold uppercase tracking-widest text-[#4a6b5e]">
                          Total ({filtered.length} expense{filtered.length !== 1 ? 's' : ''})
                        </td>
                        <td className="px-3 py-2.5 font-extrabold text-[#1f4a35]" colSpan={4}>
                          {formatMoney(summary.total, currency)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
                    <span className="text-[10px] font-semibold text-gray-400">
                      Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                    </span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                        className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">
                        ‹ Prev
                      </button>
                      <span className="px-2 text-xs font-semibold text-gray-500">{page} / {totalPages}</span>
                      <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                        className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">
                        Next ›
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PropertyExpenses;

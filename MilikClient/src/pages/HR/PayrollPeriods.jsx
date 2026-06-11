import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  FaMoneyBillWave, FaPlus, FaRedoAlt, FaPlay, FaCheck,
  FaTrash, FaEye, FaTimes, FaFilter,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const STATUS_STYLE = {
  Draft:      'border-slate-200 bg-slate-50 text-slate-600',
  Processing: 'border-amber-200 bg-amber-50 text-amber-700',
  Approved:   'border-blue-200 bg-blue-50 text-blue-700',
  Paid:       'border-emerald-200 bg-emerald-50 text-emerald-700',
  Closed:     'border-rose-200 bg-rose-50 text-rose-600',
  Reversed:   'border-rose-300 bg-rose-50 text-rose-700',
};

const fmtKES = (n) =>
  n != null ? `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : '—';

const currentYear  = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;
const YEARS = Array.from({ length: 7 }, (_, i) => currentYear - 3 + i);

const LIMIT = 20;

function NewPeriodForm({ onSave, onCancel, saving }) {
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear]   = useState(currentYear);
  const [notes, setNotes] = useState('');

  const inputCls = 'h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
      <div className="text-xs font-black text-slate-700 uppercase tracking-widest">New Payroll Period</div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Month *</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={inputCls}>
            {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Year *</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputCls}>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Optional" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
          <FaTimes size={9} /> Cancel
        </button>
        <button onClick={() => onSave({ month, year, notes })} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23] disabled:opacity-50">
          <FaCheck size={9} /> {saving ? 'Creating…' : 'Create Period'}
        </button>
      </div>
    </div>
  );
}

function Pagination({ page, totalPages, total, onPage }) {
  return (
    <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-200 bg-white px-4 py-2">
      <span className="text-[11px] text-slate-500">{total} period{total !== 1 ? 's' : ''}</span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onPage(1)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">«</button>
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">Prev</button>
        <span className="px-2 text-[11px] font-semibold text-slate-600">{page} / {Math.max(1, totalPages)}</span>
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">Next</button>
        <button disabled={page >= totalPages} onClick={() => onPage(totalPages)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">»</button>
      </div>
    </div>
  );
}

export default function PayrollPeriods() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving]       = useState(false);
  const [running, setRunning]     = useState(null);
  const [showNew, setShowNew]     = useState(false);
  const [confirm, setConfirm]     = useState({ isOpen: false });
  const [page, setPage]           = useState(1);
  const [yearFilter, setYearFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [yearFilter, statusFilter]);

  const { data: periodsData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['hr-payroll-periods', page, yearFilter, statusFilter],
    queryFn: async () => {
      const params = { page, limit: LIMIT };
      if (yearFilter)   params.year   = yearFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await adminRequests.get('/hr/payroll/periods', { params });
      return res.data;
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error('Failed to load payroll periods'); }, [error]);

  const periods    = periodsData?.periods    ?? [];
  const total      = periodsData?.total      ?? 0;
  const totalPages = periodsData?.totalPages ?? 1;

  const createPeriod = async (form) => {
    setSaving(true);
    try {
      await adminRequests.post('/hr/payroll/periods', form);
      toast.success('Payroll period created');
      setShowNew(false);
      queryClient.invalidateQueries({ queryKey: ['hr-payroll-periods'] });
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to create period');
    } finally {
      setSaving(false);
    }
  };

  const runPayroll = async (period) => {
    setRunning(period._id);
    try {
      const res = await adminRequests.post(`/hr/payroll/periods/${period._id}/run`);
      toast.success(res.data.message || 'Payroll run complete');
      queryClient.invalidateQueries({ queryKey: ['hr-payroll-periods'] });
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to run payroll');
    } finally {
      setRunning(null);
    }
  };

  const deletePeriod = (period) => {
    setConfirm({
      isOpen: true, title: 'Delete Payroll Period',
      message: `Delete "${period.label}" payroll period? All payslips will also be deleted.`,
      isDangerous: true, confirmText: 'Delete',
      onConfirm: async () => {
        try {
          await adminRequests.delete(`/hr/payroll/periods/${period._id}`);
          toast.success('Period deleted');
          queryClient.invalidateQueries({ queryKey: ['hr-payroll-periods'] });
        } catch (e) {
          toast.error(e?.response?.data?.message || 'Cannot delete');
        } finally {
          setConfirm((p) => ({ ...p, isOpen: false }));
        }
      },
    });
  };

  const hasFilters = yearFilter || statusFilter;

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Payroll</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Payroll Periods</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={refetch} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} />
              </button>
              <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF8C00] px-3 py-1.5 text-xs font-black text-white hover:bg-[#e67e00]">
                <FaPlus size={10} /> New Period
              </button>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/95 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <FaFilter size={9} className="text-slate-400" />
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="h-8 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-semibold text-slate-700 focus:outline-none"
            >
              <option value="">All years</option>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-semibold text-slate-700 focus:outline-none"
            >
              <option value="">All statuses</option>
              <option>Draft</option>
              <option>Processing</option>
              <option>Approved</option>
              <option>Paid</option>
              <option>Closed</option>
              <option>Reversed</option>
            </select>
            {hasFilters && (
              <button
                onClick={() => { setYearFilter(''); setStatusFilter(''); }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-500 hover:bg-slate-100"
              >
                <FaTimes size={8} /> Clear
              </button>
            )}
            <span className="ml-auto text-[11px] font-semibold text-slate-500">{total} result{total !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {showNew && (
            <div className="p-4">
              <NewPeriodForm onSave={createPeriod} onCancel={() => setShowNew(false)} saving={saving} />
            </div>
          )}

          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-slate-400">Loading...</div>
          ) : periods.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-300">
              <FaMoneyBillWave size={28} />
              <p className="text-sm font-semibold text-slate-400">
                {hasFilters ? 'No periods match the current filters' : 'No payroll periods yet'}
              </p>
              {!hasFilters && <p className="text-xs text-slate-400">Click "New Period" to create one</p>}
            </div>
          ) : (
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Period</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Employees</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Total Gross</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Total Deductions</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Net Pay</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Status</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period, idx) => (
                  <tr
                    key={period._id}
                    className={`border-t border-slate-100 hover:bg-slate-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-black text-slate-900">{period.label}</div>
                      {period.notes && <div className="text-[10px] text-slate-400">{period.notes}</div>}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-700">
                      {period.employeeCount ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-700">
                      {period.totalGross > 0 ? fmtKES(period.totalGross) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-rose-600">
                      {period.totalDeductions > 0 ? fmtKES(period.totalDeductions) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-black text-emerald-700">
                      {period.totalNet > 0 ? fmtKES(period.totalNet) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${STATUS_STYLE[period.status] || STATUS_STYLE.Draft}`}>
                        {period.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => navigate(`/hr/payroll/${period._id}`)}
                          className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700 hover:bg-indigo-100"
                        >
                          <FaEye size={9} /> View
                        </button>
                        {['Draft', 'Processing'].includes(period.status) && (
                          <button
                            onClick={() => runPayroll(period)}
                            disabled={!!running}
                            className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            <FaPlay size={8} /> {running === period._id ? 'Running…' : 'Run'}
                          </button>
                        )}
                        {period.status === 'Draft' && (
                          <button
                            onClick={() => deletePeriod(period)}
                            className="inline-flex items-center gap-1 rounded border border-rose-100 bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-500 hover:bg-rose-100"
                          >
                            <FaTrash size={8} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination — always visible */}
        <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />
      </div>

      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))} />
    </DashboardLayout>
  );
}

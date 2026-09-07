import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectCurrentUser } from '../../redux/selectors';
import { useTabState } from "../../hooks/useTabState";
import {
  FaPlus, FaRedoAlt, FaPlay, FaCheck,
  FaTrash, FaEye, FaTimes, FaFilter,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from "../../components/PaginationBar";
import MilikTable from '../../components/common/MilikTable';

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

const DEFAULT_LIMIT = 20;

const MONTH_OPTIONS          = MONTHS.slice(1).map((m, i) => ({ value: i + 1, label: m }));
const YEAR_OPTIONS           = YEARS.map((y) => ({ value: y, label: String(y) }));
const PAYROLL_STATUS_OPTIONS = ["Draft", "Processing", "Approved", "Paid", "Closed", "Reversed"].map((s) => ({ value: s, label: s }));

function NewPeriodForm({ onSave, onCancel, saving }) {
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear]   = useState(currentYear);
  const [notes, setNotes] = useState('');

  const inputCls = 'h-7 w-full rounded border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';

  return (
    <div className="border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
      <div className="text-xs font-black text-slate-700 uppercase tracking-widest">New Payroll Period</div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <AppSelect label="Month" required value={month} onChange={(v) => setMonth(Number(v ?? month))} options={MONTH_OPTIONS} size="md" />
        </div>
        <div>
          <AppSelect label="Year" required value={year} onChange={(v) => setYear(Number(v ?? year))} options={YEAR_OPTIONS} size="md" />
        </div>
        <div>
          <label className="mb-0.5 block text-xs font-semibold text-slate-700">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Optional" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
          <FaTimes size={9} /> Cancel
        </button>
        <button onClick={() => onSave({ month, year, notes })} disabled={saving} className="inline-flex h-7 items-center gap-1 rounded bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0a2e23] disabled:opacity-50">
          <FaCheck size={9} /> {saving ? 'Creating…' : 'Create Period'}
        </button>
      </div>
    </div>
  );
}

export default function PayrollPeriods() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useSelector(selectCurrentUser);
  const canManagePayroll = Boolean(currentUser?.adminAccess || currentUser?.isSystemAdmin || currentUser?.superAdminAccess);
  const [saving, setSaving]       = useState(false);
  const [running, setRunning]     = useState(null);
  const [showNew, setShowNew]     = useState(false);
  const [confirm, setConfirm]     = useState({ isOpen: false });
  const [page,     setPage]     = useTabState('/hr/payroll:page', 1);
  const [pageSize, setPageSize] = useTabState('/hr/payroll:pageSize', DEFAULT_LIMIT);
  const [yearFilter, setYearFilter] = useTabState('/hr/payroll:yearFilter', '');
  const [statusFilter, setStatusFilter] = useTabState('/hr/payroll:statusFilter', '');

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [yearFilter, statusFilter]);

  const { data: periodsData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['hr-payroll-periods', page, pageSize, yearFilter, statusFilter],
    queryFn: async () => {
      const params = { page, limit: pageSize };
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
              <button onClick={refetch} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} />
              </button>
              <button onClick={() => setShowNew(true)} className="inline-flex h-7 items-center gap-1.5 rounded bg-[#FF8C00] px-3 text-xs font-black text-white hover:bg-[#e67e00]">
                <FaPlus size={10} /> New Period
              </button>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/95 px-2 py-1.5">
          <div className="filter-bar flex items-center gap-1.5 overflow-x-auto">
            <FaFilter size={9} className="shrink-0 text-slate-400" />
            <AppSelect value={yearFilter} onChange={(v) => setYearFilter(v ?? "")} options={YEAR_OPTIONS} placeholder="All years" clearable size="sm" />
            <AppSelect value={statusFilter} onChange={(v) => setStatusFilter(v ?? "")} options={PAYROLL_STATUS_OPTIONS} placeholder="All statuses" clearable size="sm" />
            {hasFilters && (
              <button
                onClick={() => { setYearFilter(''); setStatusFilter(''); }}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-[10px] font-bold text-slate-500 hover:bg-slate-100"
              >
                <FaTimes size={8} /> Clear
              </button>
            )}
            <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />
            <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] font-semibold text-slate-400">{total} result{total !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {showNew && (
            <div className="p-4">
              <NewPeriodForm onSave={createPeriod} onCancel={() => setShowNew(false)} saving={saving} />
            </div>
          )}

          <MilikTable
            columns={[
              { label: 'Period' },
              { label: 'Employees', align: 'right' },
              { label: 'Total Gross', align: 'right' },
              { label: 'Total Deductions', align: 'right' },
              { label: 'Net Pay', align: 'right' },
              { label: 'Status' },
            ]}
            rows={periods}
            loading={loading}
            empty={hasFilters ? 'No periods match the current filters' : 'No payroll periods yet'}
            renderRow={(period) => (
              <>
                <td className="px-3 py-1 border-r border-gray-100">
                  <div className="font-black text-slate-900">{period.label}</div>
                  {period.notes && <div className="text-[10px] text-slate-400">{period.notes}</div>}
                </td>
                <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-700">
                  {period.employeeCount ?? <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-700">
                  {period.totalGross > 0 ? fmtKES(period.totalGross) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-rose-600">
                  {period.totalDeductions > 0 ? fmtKES(period.totalDeductions) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-emerald-700">
                  {period.totalNet > 0 ? fmtKES(period.totalNet) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-1 border-r border-gray-100">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_STYLE[period.status] || STATUS_STYLE.Draft}`}>
                    {period.status}
                  </span>
                </td>
              </>
            )}
            renderActions={(period) => (
              <div className="flex justify-end gap-1">
                <button
                  onClick={() => navigate(`/hr/payroll/${period._id}`)}
                  className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-700 hover:bg-indigo-100"
                >
                  <FaEye size={9} /> View
                </button>
                {canManagePayroll && ['Draft', 'Processing'].includes(period.status) && (
                  <button
                    onClick={() => runPayroll(period)}
                    disabled={!!running}
                    className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <FaPlay size={8} /> {running === period._id ? 'Running…' : 'Run'}
                  </button>
                )}
                {canManagePayroll && period.status === 'Draft' && (
                  <button
                    onClick={() => deletePeriod(period)}
                    className="inline-flex items-center gap-1 rounded border border-rose-100 bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-500 hover:bg-rose-100"
                  >
                    <FaTrash size={8} />
                  </button>
                )}
              </div>
            )}
          />
        </div>

        {/* Pagination — always visible */}
        <PaginationBar
          page={page}
          pages={totalPages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          loading={loading}
          label="payroll periods"
        />
      </div>

      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))} />
    </DashboardLayout>
  );
}

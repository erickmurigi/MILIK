import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FaMoneyBillWave, FaPlus, FaRedoAlt, FaPlay, FaCheck,
  FaTrash, FaEye, FaTimes,
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
};

const fmtKES = (n) =>
  n != null ? `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : '—';

const currentYear  = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

function NewPeriodForm({ onSave, onCancel, saving }) {
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear]   = useState(currentYear);
  const [notes, setNotes] = useState('');

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
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
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
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

export default function PayrollPeriods() {
  const navigate = useNavigate();
  const [periods, setPeriods]   = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [running, setRunning]   = useState(null); // periodId being run
  const [showNew, setShowNew]   = useState(false);
  const [confirm, setConfirm]   = useState({ isOpen: false });
  const [page, setPage]         = useState(1);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequests.get('/hr/payroll/periods', { params: { page, limit: LIMIT } });
      setPeriods(res.data.periods || []);
      setTotal(res.data.total || 0);
    } catch {
      toast.error('Failed to load payroll periods');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const createPeriod = async (form) => {
    setSaving(true);
    try {
      await adminRequests.post('/hr/payroll/periods', form);
      toast.success('Payroll period created');
      setShowNew(false);
      load();
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
      load();
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
          load();
        } catch (e) {
          toast.error(e?.response?.data?.message || 'Cannot delete');
        } finally {
          setConfirm((p) => ({ ...p, isOpen: false }));
        }
      },
    });
  };

  const totalPages = Math.ceil(total / LIMIT);

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
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} />
              </button>
              <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF8C00] px-3 py-1.5 text-xs font-black text-white hover:bg-[#e67e00]">
                <FaPlus size={10} /> New Period
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            {showNew && <NewPeriodForm onSave={createPeriod} onCancel={() => setShowNew(false)} saving={saving} />}

            {loading ? (
              <div className="flex h-32 items-center justify-center text-sm text-slate-400">Loading...</div>
            ) : periods.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-300">
                <FaMoneyBillWave size={28} />
                <p className="text-sm font-semibold text-slate-400">No payroll periods yet</p>
                <p className="text-xs text-slate-400">Click "New Period" to create one</p>
              </div>
            ) : (
              <>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="min-w-full text-xs">
                    <thead>
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
                        <tr key={period._id} className={`border-t border-slate-100 hover:bg-slate-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                          <td className="px-4 py-3">
                            <div className="font-black text-slate-900">{period.label}</div>
                            {period.notes && <div className="text-[10px] text-slate-400">{period.notes}</div>}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-700">
                            {period.employeeCount || <span className="text-slate-300">—</span>}
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
                              <button onClick={() => navigate(`/hr/payroll/${period._id}`)} className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700 hover:bg-indigo-100">
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
                                <button onClick={() => deletePeriod(period)} className="inline-flex items-center gap-1 rounded border border-rose-100 bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-500 hover:bg-rose-100">
                                  <FaTrash size={8} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{total} period{total !== 1 ? 's' : ''}</span>
                    <div className="flex gap-1">
                      <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">Prev</button>
                      <span className="px-2 font-semibold">{page} / {totalPages}</span>
                      <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))} />
    </DashboardLayout>
  );
}

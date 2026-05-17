import React, { useCallback, useEffect, useState } from 'react';
import { FaCalendarCheck, FaRedoAlt, FaPrint, FaFilter, FaUsers } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - 5 + i);

const utilColor = (pct) => {
  if (pct >= 90) return 'bg-rose-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
};
const utilText = (pct) => {
  if (pct >= 90) return 'text-rose-700';
  if (pct >= 70) return 'text-amber-700';
  return 'text-emerald-700';
};

export default function LeaveBalances() {
  const [year, setYear]           = useState(currentYear);
  const [departments, setDepts]   = useState([]);
  const [leaveTypes, setLtypes]   = useState([]);
  const [departmentId, setDeptId] = useState('');
  const [leaveTypeId, setLtId]    = useState('');
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    Promise.all([
      adminRequests.get('/hr/departments'),
      adminRequests.get('/hr/leave-types'),
    ]).then(([d, l]) => {
      setDepts(d.data || []);
      setLtypes((l.data || []).filter((t) => t.daysPerYear > 0));
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { year };
      if (departmentId) params.departmentId = departmentId;
      if (leaveTypeId)  params.leaveTypeId  = leaveTypeId;
      const res = await adminRequests.get('/hr/leave-balances', { params });
      setRows(res.data || []);
    } catch {
      toast.error('Failed to load leave balances');
    } finally {
      setLoading(false);
    }
  }, [year, departmentId, leaveTypeId]);

  useEffect(() => { load(); }, [load]);

  const handlePrint = () => window.print();

  const inputCls = 'h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';

  // Summary stats
  const totalUsed      = rows.reduce((s, r) => s + r.used, 0);
  const totalRemaining = rows.reduce((s, r) => s + r.remaining, 0);
  const totalEntitled  = rows.reduce((s, r) => s + r.entitlement, 0);
  const avgUtil        = totalEntitled > 0 ? Math.round((totalUsed / totalEntitled) * 100) : 0;

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm print-hide">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Leave</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Leave Balances</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} />
              </button>
              {rows.length > 0 && (
                <button onClick={handlePrint} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23]">
                  <FaPrint size={10} /> Print
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/95 px-4 py-2.5 print-hide">
          <div className="flex flex-wrap items-center gap-2">
            <FaFilter size={10} className="text-slate-400" />
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputCls}>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={departmentId} onChange={(e) => setDeptId(e.target.value)} className={inputCls}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </select>
            <select value={leaveTypeId} onChange={(e) => setLtId(e.target.value)} className={inputCls}>
              <option value="">All leave types</option>
              {leaveTypes.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
            {rows.length > 0 && (
              <span className="ml-auto text-[11px] font-semibold text-slate-500">
                {rows.length} balance{rows.length !== 1 ? 's' : ''} · {[...new Set(rows.map((r) => r.employeeId.toString()))].length} employees
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading leave balances…</div>
          ) : rows.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
              <FaCalendarCheck size={28} />
              <p className="text-sm font-semibold">No leave balances found</p>
              <p className="text-xs">Add active leave types with days-per-year to see balances</p>
            </div>
          ) : (
            <div className="employee-print-area space-y-4">

              <PrintLetterhead
                variant="print"
                docLabel="Human Resource · Leave Balances"
                docTitle={`Leave Balances — ${year}`}
                docMeta={departmentId ? departments.find((d) => d._id === departmentId)?.name : 'All Departments'}
              />

              {/* Summary cards */}
              <div className="print-card grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: 'Total Entitlement', value: `${totalEntitled} days`, color: 'border-slate-200' },
                  { label: 'Days Used',          value: `${totalUsed} days`,    color: 'border-rose-100' },
                  { label: 'Days Remaining',     value: `${totalRemaining} days`, color: 'border-emerald-200' },
                  { label: 'Avg Utilisation',    value: `${avgUtil}%`,           color: 'border-amber-200' },
                ].map(({ label, value, color }) => (
                  <div key={label} className={`rounded-lg border ${color} bg-white px-3 py-2.5 shadow-sm`}>
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                    <div className="text-lg font-black text-slate-900 mt-0.5">{value}</div>
                  </div>
                ))}
              </div>

              {/* Table */}
              <div className="print-card overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-[#0B3B2E] text-white">
                      <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Employee</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Department</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Leave Type</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Entitlement</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Used</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Pending</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Remaining</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest print-hide">Utilisation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const pct = r.entitlement > 0 ? Math.round((r.used / r.entitlement) * 100) : 0;
                      return (
                        <tr key={`${r.employeeId}_${r.leaveTypeId}`} className={`border-t border-slate-100 hover:bg-slate-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                          <td className="px-4 py-2.5">
                            <div className="font-black text-slate-900">{r.employeeName}</div>
                            <div className="text-[10px] text-slate-400">{r.employeeNumber}</div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">{r.department}</td>
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-slate-900">{r.leaveTypeName}</div>
                            <span className={`text-[9px] font-black ${r.isPaid ? 'text-emerald-600' : 'text-rose-500'}`}>
                              {r.isPaid ? 'Paid' : 'Unpaid'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{r.entitlement}</td>
                          <td className={`px-3 py-2.5 text-right font-black ${r.used > 0 ? utilText(pct) : 'text-slate-400'}`}>{r.used}</td>
                          <td className="px-3 py-2.5 text-right text-amber-600">{r.pending || '—'}</td>
                          <td className={`px-3 py-2.5 text-right font-black ${r.remaining === 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{r.remaining}</td>
                          <td className="px-3 py-2.5 print-hide">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-slate-100">
                                <div className={`h-1.5 rounded-full ${utilColor(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
                              </div>
                              <span className={`text-[10px] font-black w-8 text-right ${utilText(pct)}`}>{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

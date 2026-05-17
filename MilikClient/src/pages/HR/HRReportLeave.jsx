import React, { useCallback, useEffect, useState } from 'react';
import { FaCalendarAlt, FaRedoAlt, FaPrint, FaFilter, FaTag, FaUsers } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const currentYear = new Date().getFullYear();

function isoDate(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : '';
}

export default function HRReportLeave() {
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [filters, setFilters] = useState({
    startDate: `${currentYear}-01-01`,
    endDate: `${currentYear}-12-31`,
    leaveTypeId: '',
  });
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    adminRequests.get('/hr/leave-types').then((r) => setLeaveTypes(r.data || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.startDate)   params.startDate   = filters.startDate;
      if (filters.endDate)     params.endDate     = filters.endDate;
      if (filters.leaveTypeId) params.leaveTypeId = filters.leaveTypeId;
      const res = await adminRequests.get('/hr/reports/leave-summary', { params });
      setData(res.data);
    } catch {
      toast.error('Failed to load leave summary');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setFilters((p) => ({ ...p, [k]: e.target.value }));

  const inputCls = 'h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';

  const handlePrint = () => window.print();

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm print-hide">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Reports</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Leave Summary</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} />
              </button>
              {data && (
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
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">From</label>
              <input type="date" value={filters.startDate} onChange={set('startDate')} className={inputCls} />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">To</label>
              <input type="date" value={filters.endDate} onChange={set('endDate')} className={inputCls} />
            </div>
            <select value={filters.leaveTypeId} onChange={set('leaveTypeId')} className={inputCls}>
              <option value="">All leave types</option>
              {leaveTypes.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
            {data && (
              <span className="ml-auto text-[11px] font-semibold text-slate-500">
                {data.totals.count} application{data.totals.count !== 1 ? 's' : ''} · {data.totals.totalDays} day{data.totals.totalDays !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading…</div>
          ) : !data ? null : (
            <div className="employee-print-area space-y-4">

              <PrintLetterhead
                variant="print"
                docLabel="Human Resource · Leave Summary Report"
                docTitle="Leave Summary"
                docMeta={filters.startDate && filters.endDate ? `${filters.startDate} to ${filters.endDate}` : 'All dates'}
              />

              {/* Totals */}
              <div className="print-card grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Total Applications</div>
                  <div className="text-lg font-black text-slate-900 mt-0.5">{data.totals.count}</div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2.5 shadow-sm">
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Total Days Taken</div>
                  <div className="text-lg font-black text-emerald-700 mt-0.5">{data.totals.totalDays}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Leave Types Used</div>
                  <div className="text-lg font-black text-slate-900 mt-0.5">{data.byType.length}</div>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">

                {/* By Leave Type */}
                <div className="print-card rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="bg-emerald-700 px-4 py-2.5 flex items-center gap-2">
                    <FaTag size={11} className="text-emerald-200" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-white">By Leave Type</span>
                  </div>
                  {data.byType.length === 0 ? (
                    <div className="flex h-24 items-center justify-center text-sm text-slate-400">No data</div>
                  ) : (
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Leave Type</th>
                          <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Applications</th>
                          <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Days</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byType.map((t, i) => (
                          <tr key={i} className={`border-t border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                            <td className="px-4 py-2.5">
                              <div className="font-black text-slate-900">{t.name}</div>
                              <span className={`text-[9px] font-black ${t.isPaid ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {t.isPaid ? 'Paid' : 'Unpaid'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{t.count}</td>
                            <td className="px-3 py-2.5 text-right font-black text-slate-900">{t.totalDays}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* By Employee */}
                <div className="print-card rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="bg-[#FF8C00] px-4 py-2.5 flex items-center gap-2">
                    <FaUsers size={11} className="text-white" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-white">By Employee (Top 20)</span>
                  </div>
                  {data.byEmployee.length === 0 ? (
                    <div className="flex h-24 items-center justify-center text-sm text-slate-400">No data</div>
                  ) : (
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Employee</th>
                          <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Applications</th>
                          <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Days</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byEmployee.slice(0, 20).map((e, i) => (
                          <tr key={i} className={`border-t border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                            <td className="px-4 py-2.5">
                              <div className="font-black text-slate-900">{e.name}</div>
                              <div className="text-[10px] text-slate-400">{e.employeeNumber} · {e.department}</div>
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{e.count}</td>
                            <td className="px-3 py-2.5 text-right font-black text-emerald-700">{e.totalDays}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

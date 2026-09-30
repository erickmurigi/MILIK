import React, { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { useTabState } from "../../hooks/useTabState";
import { FaCalendarCheck, FaRedoAlt, FaPrint, FaFilter, FaUsers } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import { selectCurrentCompany } from '../../redux/selectors';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';
import { printTabularList } from '../../utils/printKit';
import AppSelect from "../../components/common/AppSelect";

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
  const [year, setYear]           = useTabState('/hr/leave/balances:year', currentYear);
  const [departmentId, setDeptId] = useTabState('/hr/leave/balances:departmentId', '');
  const [leaveTypeId, setLtId]    = useTabState('/hr/leave/balances:leaveTypeId', '');

  const { data: departments = [] } = useQuery({
    queryKey: ['hr-departments-ref'],
    queryFn: () => adminRequests.get('/hr/departments').then((r) => r.data || []),
    staleTime: 5 * 60_000,
  });

  const { data: allLeaveTypes = [] } = useQuery({
    queryKey: ['hr-leave-types-ref'],
    queryFn: () => adminRequests.get('/hr/leave-types').then((r) => r.data || []),
    staleTime: 5 * 60_000,
  });
  const leaveTypes = useMemo(() => allLeaveTypes.filter((t) => t.daysPerYear > 0), [allLeaveTypes]);

  const { data: rows = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['hr-leave-balances', year, departmentId, leaveTypeId],
    queryFn: async () => {
      const params = { year };
      if (departmentId) params.departmentId = departmentId;
      if (leaveTypeId)  params.leaveTypeId  = leaveTypeId;
      const res = await adminRequests.get('/hr/leave-balances', { params });
      return res.data || [];
    },
  });

  React.useEffect(() => { if (error) toast.error('Failed to load leave balances'); }, [error]);

  // Summary stats — must be declared before handlePrint to avoid TDZ in its deps array
  const totalUsed      = useMemo(() => rows.reduce((s, r) => s + r.used, 0),        [rows]);
  const totalRemaining = useMemo(() => rows.reduce((s, r) => s + r.remaining, 0),   [rows]);
  const totalEntitled  = useMemo(() => rows.reduce((s, r) => s + r.entitlement, 0), [rows]);
  const avgUtil        = useMemo(
    () => totalEntitled > 0 ? Math.round((totalUsed / totalEntitled) * 100) : 0,
    [totalEntitled, totalUsed]
  );
  const uniqueEmployeeCount = useMemo(
    () => new Set(rows.map((r) => r.employeeId.toString())).size,
    [rows]
  );

  const company = useSelector(selectCurrentCompany) || {};

  const handlePrint = useCallback(() => {
    if (!rows.length) return;
    const deptName = departmentId ? departments.find((d) => d._id === departmentId)?.name : 'All Departments';
    const pctOf = (r) => (r.entitlement > 0 ? Math.round((r.used / r.entitlement) * 100) : 0);
    const printed = printTabularList({
      title: `Leave Balances — ${year}`,
      subtitle: `Human Resource · ${deptName || 'All Departments'}`,
      company,
      summaryItems: [
        ['Entitlement', `${totalEntitled} days`], ['Days Used', `${totalUsed} days`],
        ['Remaining', `${totalRemaining} days`], ['Avg Utilisation', `${avgUtil}%`],
      ],
      columns: [
        { label: 'Employee', bold: true, value: (r) => `${r.employeeName} (${r.employeeNumber})` },
        { label: 'Department', value: (r) => r.department || '—' },
        { label: 'Leave Type', value: (r) => `${r.leaveTypeName} ${r.isPaid ? '(Paid)' : '(Unpaid)'}` },
        { label: 'Entitlement', align: 'right', key: 'entitlement' },
        { label: 'Used', align: 'right', bold: true, key: 'used', tone: (r) => (pctOf(r) >= 90 ? 'neg' : pctOf(r) >= 70 ? '' : 'pos') },
        { label: 'Pending', align: 'right', value: (r) => r.pending || '—' },
        { label: 'Remaining', align: 'right', bold: true, key: 'remaining', tone: (r) => (r.remaining === 0 ? 'neg' : 'pos') },
        { label: 'Util%', align: 'right', value: (r) => `${pctOf(r)}%` },
      ],
      rows,
    });
    if (!printed) toast.error('Pop-up blocked — allow pop-ups for this site to print');
  }, [rows, year, departmentId, departments, totalEntitled, totalUsed, totalRemaining, avgUtil, company]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-3 py-2 print-hide">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Leave</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Leave Balances</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={refetch} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} />
              </button>
              {rows.length > 0 && (
                <button onClick={handlePrint} className="inline-flex h-7 items-center gap-1.5 rounded bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0A3127]">
                  <FaPrint size={10} /> Print
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-2 py-1.5 print-hide">
          <div className="filter-bar flex items-center gap-1.5 overflow-x-auto">
            <FaFilter size={10} className="shrink-0 text-slate-400" />
            <div className="shrink-0"><AppSelect value={year} onChange={(v) => setYear(Number(v ?? currentYear))} options={YEARS.map((y) => ({ value: y, label: String(y) }))} size="sm" /></div>
            <div className="shrink-0"><AppSelect value={departmentId} onChange={(v) => setDeptId(v ?? "")} options={departments.map((d) => ({ value: d._id, label: d.name }))} placeholder="All departments" clearable searchable size="sm" /></div>
            <div className="shrink-0"><AppSelect value={leaveTypeId} onChange={(v) => setLtId(v ?? "")} options={leaveTypes.map((t) => ({ value: t._id, label: t.name }))} placeholder="All leave types" clearable size="sm" /></div>
            {rows.length > 0 && (
              <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] font-semibold text-slate-400">
                {rows.length} balance{rows.length !== 1 ? 's' : ''} · {uniqueEmployeeCount} employees
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
                  <div key={label} className={`border ${color} bg-white px-3 py-2.5`}>
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                    <div className="text-lg font-black text-slate-900 mt-0.5">{value}</div>
                  </div>
                ))}
              </div>

              {/* Table */}
              <div className="print-card overflow-hidden border border-slate-200 bg-white">
                <table className="min-w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-[#0B3B2E] text-white">
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Employee</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Department</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Leave Type</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">Entitlement</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">Used</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">Pending</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">Remaining</th>
                      <th className="px-3 py-1 text-left font-bold print-hide">Utilisation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const pct = r.entitlement > 0 ? Math.round((r.used / r.entitlement) * 100) : 0;
                      return (
                        <tr key={`${r.employeeId}_${r.leaveTypeId}`} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <div className="font-black text-slate-900">{r.employeeName}</div>
                            <div className="text-[10px] text-slate-400">{r.employeeNumber}</div>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{r.department}</td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <div className="font-semibold text-slate-900">{r.leaveTypeName}</div>
                            <span className={`text-[9px] font-black ${r.isPaid ? 'text-emerald-600' : 'text-rose-500'}`}>
                              {r.isPaid ? 'Paid' : 'Unpaid'}
                            </span>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-700">{r.entitlement}</td>
                          <td className={`px-3 py-1 border-r border-gray-100 text-right font-black ${r.used > 0 ? utilText(pct) : 'text-slate-400'}`}>{r.used}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right text-amber-600">{r.pending || '—'}</td>
                          <td className={`px-3 py-1 border-r border-gray-100 text-right font-black ${r.remaining === 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{r.remaining}</td>
                          <td className="px-3 py-1 print-hide">
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

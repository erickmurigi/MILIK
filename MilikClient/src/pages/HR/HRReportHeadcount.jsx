import React, { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  FaUsers, FaUserCheck, FaUserClock, FaUserTimes, FaBuilding,
  FaRedoAlt, FaPrint, FaUserPlus, FaCalendarAlt,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import { selectCurrentCompany } from '../../redux/selectors';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';
import { fmtDate } from '../../utils/dates';
import { printTabularList } from '../../utils/printKit';

const STATUS_COLORS = {
  Active:     'text-emerald-700 bg-emerald-50 border-emerald-200',
  Probation:  'text-amber-700 bg-amber-50 border-amber-200',
  Suspended:  'text-orange-700 bg-orange-50 border-orange-200',
  Terminated: 'text-rose-700 bg-rose-50 border-rose-200',
};

const TYPE_COLORS = {
  Permanent: 'bg-emerald-100 text-emerald-800',
  Contract:  'bg-blue-100 text-blue-800',
  Casual:    'bg-amber-100 text-amber-800',
  Intern:    'bg-violet-100 text-violet-800',
};

function SummaryCard({ icon: Icon, label, value, color = 'border-slate-200' }) {
  return (
    <div className={`border ${color} bg-white px-3 py-2.5 shadow-sm`}>
      <div className="flex items-center gap-2">
        <Icon className="text-sm text-slate-400 shrink-0" />
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</div>
          <div className="text-lg font-black leading-tight text-slate-900">{value ?? '—'}</div>
        </div>
      </div>
    </div>
  );
}

export default function HRReportHeadcount() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequests.get('/hr/reports/headcount');
      setData(res.data);
    } catch {
      toast.error('Failed to load headcount report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const company = useSelector(selectCurrentCompany) || {};

  const handlePrint = useCallback(() => {
    if (!data) return;
    const s = data.summary || {};
    const pct = (n) => (s.total ? Math.round((n / s.total) * 100) : 0);
    const printed = printTabularList({
      title: 'Employee Headcount',
      subtitle: 'Human Resource · Reports',
      company,
      orientation: 'portrait',
      summaryItems: [['Total', s.total || 0], ['Active', s.active || 0], ['Probation', s.probation || 0], ['Terminated', s.terminated || 0]],
      sections: [
        {
          heading: 'By Department',
          columns: [
            { label: 'Department', key: 'name', bold: true },
            { label: 'Total', align: 'right', key: 'total' },
            { label: 'Active', align: 'right', key: 'active', tone: () => 'pos' },
            { label: 'Probation', align: 'right', value: (d) => d.probation || 0 },
            { label: 'Terminated', align: 'right', value: (d) => d.terminated || 0, tone: (d) => (d.terminated ? 'neg' : '') },
          ],
          rows: data.byDepartment || [],
        },
        {
          heading: 'By Employment Type',
          columns: [
            { label: 'Type', value: (t) => t.type || '—' },
            { label: 'Total', align: 'right', key: 'total' },
            { label: 'Active', align: 'right', key: 'active', tone: () => 'pos' },
            { label: '%', align: 'right', value: (t) => `${pct(t.total)}%` },
          ],
          rows: data.byType || [],
        },
        ...((data.recentJoiners || []).length ? [{
          heading: 'Recent Joiners (Last 90 Days)',
          columns: [
            { label: 'Employee', value: (e) => `${e.surname} ${e.otherNames} (${e.employeeNumber})`, bold: true },
            { label: 'Department', value: (e) => e.department?.name || '—' },
            { label: 'Designation', value: (e) => e.designation?.name || '—' },
            { label: 'Type', value: (e) => e.employmentType || '—' },
            { label: 'Date Joined', align: 'right', value: (e) => fmtDate(e.dateJoined) },
          ],
          rows: data.recentJoiners,
        }] : []),
      ],
    });
    if (!printed) toast.error('Pop-up blocked — allow pop-ups for this site to print');
  }, [data, company]);

  const maxDept = Math.max(1, ...(data?.byDepartment || []).map((d) => d.total));

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm print-hide">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Reports</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Headcount Report</h1>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={load} className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} />
              </button>
              <button onClick={handlePrint} className="flex h-7 items-center gap-1.5 rounded bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0a2e23]">
                <FaPrint size={10} /> Print Report
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading report…</div>
          ) : (
            <div className="employee-print-area space-y-4">

              <PrintLetterhead
                variant="print"
                docLabel="Human Resource · Headcount Report"
                docTitle="Employee Headcount"
              />

              {/* Summary cards */}
              <div className="print-card grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SummaryCard icon={FaUsers}     label="Total Employees" value={data?.summary?.total}      color="border-slate-300" />
                <SummaryCard icon={FaUserCheck} label="Active"          value={data?.summary?.active}     color="border-emerald-300" />
                <SummaryCard icon={FaUserClock} label="On Probation"    value={data?.summary?.probation}  color="border-amber-300" />
                <SummaryCard icon={FaUserTimes} label="Terminated"      value={data?.summary?.terminated} color="border-rose-200" />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">

                {/* By Department */}
                <div className="print-card border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="bg-[#0B3B2E] px-4 py-2.5 flex items-center gap-2">
                    <FaBuilding size={11} className="text-emerald-300" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-white">By Department</span>
                  </div>
                  <table className="min-w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-[#0B3B2E] text-white">
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Department</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Total</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Active</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Probation</th>
                        <th className="px-3 py-1 text-right font-bold">Terminated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.byDepartment || []).map((d, i) => (
                        <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <div className="font-black text-slate-900">{d.name}</div>
                            <div className="mt-0.5 h-1 w-full rounded-full bg-slate-100">
                              <div className="h-1 rounded-full bg-emerald-500" style={{ width: `${Math.round((d.total / maxDept) * 100)}%` }} />
                            </div>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-slate-900">{d.total}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-emerald-700">{d.active}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-amber-600">{d.probation}</td>
                          <td className="px-3 py-1 text-right font-semibold text-rose-500">{d.terminated}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* By Employment Type */}
                <div className="print-card border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="bg-[#FF8C00] px-4 py-2.5 flex items-center gap-2">
                    <FaUsers size={11} className="text-white" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-white">By Employment Type</span>
                  </div>
                  <table className="min-w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-[#0B3B2E] text-white">
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Type</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Total</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Active</th>
                        <th className="px-3 py-1 text-right font-bold">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.byType || []).map((t, i) => (
                        <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${TYPE_COLORS[t.type] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>{t.type || '—'}</span>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-slate-900">{t.total}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-emerald-700">{t.active}</td>
                          <td className="px-3 py-1 text-right text-slate-500">
                            {data?.summary?.total ? `${Math.round((t.total / data.summary.total) * 100)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent Joiners */}
              {(data?.recentJoiners || []).length > 0 && (
                <div className="print-card border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="bg-slate-700 px-4 py-2.5 flex items-center gap-2">
                    <FaUserPlus size={11} className="text-slate-200" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-white">Recent Joiners (Last 90 Days)</span>
                    <span className="ml-auto rounded-full bg-slate-500 px-1.5 py-0.5 text-[10px] font-black text-white">{data.recentJoiners.length}</span>
                  </div>
                  <table className="min-w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-[#0B3B2E] text-white">
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Employee</th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Department</th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Designation</th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Type</th>
                        <th className="px-3 py-1 text-right font-bold">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentJoiners.map((emp, i) => (
                        <tr key={emp._id} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <div className="font-black text-slate-900">{emp.surname} {emp.otherNames}</div>
                            <div className="text-[10px] text-slate-400">{emp.employeeNumber}</div>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{emp.department?.name || '—'}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{emp.designation?.name || '—'}</td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${TYPE_COLORS[emp.employmentType] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>{emp.employmentType}</span>
                          </td>
                          <td className="px-3 py-1 text-right text-slate-600 flex items-center justify-end gap-1">
                            <FaCalendarAlt size={9} className="text-slate-400" /> {fmtDate(emp.dateJoined)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

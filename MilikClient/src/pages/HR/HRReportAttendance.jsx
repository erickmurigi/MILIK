import React, { useCallback, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useSelector } from 'react-redux';
import { useQuery } from '@tanstack/react-query';
import { FaSearch, FaRedoAlt, FaPrint, FaChartBar } from 'react-icons/fa';
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { selectCurrentCompany } from '../../redux/selectors';
import { adminRequests } from '../../utils/requestMethods';
import { printTabularList } from '../../utils/printKit';
import { toast } from 'react-toastify';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const thisYear  = new Date().getFullYear();
const thisMonth = new Date().getMonth() + 1;
const yearOpts  = Array.from({ length: 4 }, (_, i) => thisYear - i);
const F = 'h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';

const fmtHr = (h) => `${h.toFixed(1)}h`;
const pctColor = (p) => p >= 90 ? 'text-emerald-700' : p >= 70 ? 'text-amber-600' : 'text-rose-600';
const pctBg    = (p) => p >= 90 ? 'bg-emerald-500' : p >= 70 ? 'bg-amber-400'    : 'bg-rose-500';

function MiniBar({ pct }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${pctBg(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`w-8 text-right text-[10px] font-black tabular-nums ${pctColor(pct)}`}>{pct}%</span>
    </div>
  );
}

export default function HRReportAttendance() {
  const company    = useSelector(selectCurrentCompany) || {};
  const [month,    setMonth]    = useTabState('/hr/reports/attendance:month', String(thisMonth));
  const [year,     setYear]     = useTabState('/hr/reports/attendance:year', String(thisYear));
  const [search,   setSearch]   = useTabState('/hr/reports/attendance:search', '');
  const [committed, setCommitted] = useState({ month: String(thisMonth), year: String(thisYear) });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['hr-report-attendance', committed],
    queryFn: () => adminRequests.get('/hr/reports/attendance', {
      params: { month: committed.month, year: committed.year },
    }).then((r) => r.data),
    enabled: Boolean(committed.month && committed.year),
  });

  const rows        = data?.data || [];
  const workingDays = data?.totalWorkingDays || 0;
  const monthLabel  = data?.monthLabel || `${MONTHS[Number(month)]} ${year}`;

  const filtered = search
    ? rows.filter((r) => {
        const name = `${r.employee?.surname} ${r.employee?.otherNames} ${r.employee?.employeeNumber}`.toLowerCase();
        return name.includes(search.toLowerCase());
      })
    : rows;

  const totalPresent  = rows.reduce((s, r) => s + r.daysPresent,  0);
  const totalAbsent   = rows.reduce((s, r) => s + r.daysAbsent,   0);
  const totalHours    = rows.reduce((s, r) => s + r.totalHours,   0);
  const avgAttPct     = rows.length ? Math.round(rows.reduce((s, r) => s + r.attendancePct, 0) / rows.length) : 0;

  const handlePrint = useCallback(() => {
    if (!rows.length) return;
    const printed = printTabularList({
      title: `Attendance Report — ${monthLabel}`,
      subtitle: `Human Resource · ${workingDays} working days · ${filtered.length} employees`,
      company,
      orientation: 'portrait',
      summaryItems: [
        ['Working Days', workingDays],
        ['Avg Attendance', `${avgAttPct}%`],
        ['Total Hours Worked', `${totalHours.toFixed(0)}h`],
        ['Absence Days (total)', totalAbsent],
      ],
      columns: [
        { label: 'Employee', bold: true, value: (r) => `${r.employee?.surname || ''} ${r.employee?.otherNames || ''} (${r.employee?.employeeNumber || ''} · ${r.employee?.department?.name || '—'})`.trim() },
        { label: 'Working Days', align: 'right', value: () => workingDays },
        { label: 'Present', align: 'right', bold: true, value: (r) => r.daysPresent, tone: (r) => (r.daysPresent === 0 ? 'neg' : '') },
        { label: 'Absent', align: 'right', value: (r) => r.daysAbsent, tone: (r) => (r.daysAbsent > 0 ? 'neg' : '') },
        { label: 'Total Hours', align: 'right', value: (r) => r.totalHours.toFixed(1) },
        { label: 'Avg Hours/Day', align: 'right', value: (r) => r.avgHours.toFixed(1) },
        { label: 'Attendance %', align: 'right', bold: true, value: (r) => `${r.attendancePct}%`, tone: (r) => (r.attendancePct >= 90 ? 'pos' : r.attendancePct < 70 ? 'neg' : '') },
      ],
      rows: filtered,
      totalsRow: false,
    });
    if (!printed) toast.error('Pop-up blocked — allow pop-ups for this site to print');
  }, [rows.length, filtered, company, monthLabel, workingDays, avgAttPct, totalHours, totalAbsent]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="flex-none sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
          <div className="filter-bar flex items-center gap-1 overflow-x-auto px-2 py-1.5">
            <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-emerald-700">Attendance Report</span>
            <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />
            <AppSelect
              value={month}
              onChange={(v) => setMonth(v ?? String(thisMonth))}
              options={MONTHS.slice(1).map((m, i) => ({ value: String(i + 1), label: m }))}
              size="sm"
            />
            <AppSelect
              value={year}
              onChange={(v) => setYear(v ?? String(thisYear))}
              options={yearOpts.map((y) => ({ value: String(y), label: String(y) }))}
              size="sm"
            />
            <button
              onClick={() => setCommitted({ month, year })}
              className="flex h-7 shrink-0 items-center gap-1 rounded bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]"
            >
              <FaChartBar size={9} /> Generate
            </button>
            {rows.length > 0 && (
              <div className="relative shrink-0">
                <FaSearch size={9} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by name…" className={`${F} w-36 pl-7`} />
              </div>
            )}
            {data && rows.length > 0 && (
              <>
                <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />
                <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">Working days {workingDays}</span>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold ${avgAttPct >= 90 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : avgAttPct >= 70 ? 'border-amber-200 bg-amber-50 text-amber-600' : 'border-rose-200 bg-rose-50 text-rose-600'}`}>Avg attendance {avgAttPct}%</span>
                <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">Present days {totalPresent}</span>
                <span className="shrink-0 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-600">Absent days {totalAbsent}</span>
                <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">Hours {totalHours.toFixed(0)}h</span>
              </>
            )}
            <span className="shrink-0 text-[10px] text-slate-400">{filtered.length} employee{filtered.length !== 1 ? 's' : ''}</span>
            {rows.length > 0 && (
              <button onClick={handlePrint} className="ml-auto flex h-7 shrink-0 items-center gap-1 rounded border border-slate-200 px-2.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                <FaPrint size={9} /> Print
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-xs text-slate-400">Generating report…</div>
          ) : !data ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-slate-400">
              <FaChartBar size={22} className="text-slate-300" />
              <span className="text-xs">Select a month and year, then click Generate</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-slate-400">No attendance records for this period</div>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                <tr>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Employee</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Working Days</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Present</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Absent</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Total Hours</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Avg / Day</th>
                  <th className="px-3 py-1 text-left font-bold">Attendance</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => (
                  <tr key={String(r.employee?._id || idx)} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                    <td className="px-3 py-1 border-r border-gray-100">
                      <div className="font-semibold text-slate-900">{r.employee?.surname} {r.employee?.otherNames}</div>
                      <div className="text-[10px] text-slate-400">{r.employee?.employeeNumber} · {r.employee?.department?.name || '—'}</div>
                    </td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-500">{workingDays}</td>
                    <td className={`px-3 py-1 border-r border-gray-100 text-right font-bold ${r.daysPresent === 0 ? 'text-rose-500' : 'text-emerald-700'}`}>{r.daysPresent}</td>
                    <td className={`px-3 py-1 border-r border-gray-100 text-right font-bold ${r.daysAbsent > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{r.daysAbsent}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-slate-700">{fmtHr(r.totalHours)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-slate-600">{fmtHr(r.avgHours)}</td>
                    <td className="px-3 py-1">
                      <MiniBar pct={r.attendancePct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

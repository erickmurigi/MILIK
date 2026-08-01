import React, { useCallback, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useSelector } from 'react-redux';
import { useQuery } from '@tanstack/react-query';
import { FaSearch, FaRedoAlt, FaPrint, FaChartBar } from 'react-icons/fa';
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { selectCurrentCompany } from '../../redux/selectors';
import { adminRequests } from '../../utils/requestMethods';

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
    const { companyName = '', logo = '', roadStreet = '', town = '' } = company;
    const addr = [roadStreet, town].filter(Boolean).join(', ');

    const tbody = filtered.map((r, i) => `
      <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
        <td class="bold">${r.employee?.surname || ''} ${r.employee?.otherNames || ''}<br>
          <span class="sub">${r.employee?.employeeNumber || ''} · ${r.employee?.department?.name || '—'}</span></td>
        <td class="r">${workingDays}</td>
        <td class="r bold ${r.daysPresent === 0 ? 'red' : ''}">${r.daysPresent}</td>
        <td class="r ${r.daysAbsent > 0 ? 'red' : ''}">${r.daysAbsent}</td>
        <td class="r">${r.totalHours.toFixed(1)}</td>
        <td class="r">${r.avgHours.toFixed(1)}</td>
        <td class="r bold ${pctColor(r.attendancePct).replace('text-', '')}">${r.attendancePct}%</td>
      </tr>`).join('');

    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Attendance Report — ${monthLabel}</title>
<style>
  @page{size:A4;margin:12mm 14mm;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,sans-serif;font-size:9pt;color:#1a1a1a;background:#fff;}
  .lh{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:8px;border-bottom:2.5px solid #027333;margin-bottom:10px;}
  .lh-logo{height:38px;width:auto;border-radius:3px;}
  .lh-co{font-size:14pt;font-weight:900;color:#0f172a;}
  .lh-addr{font-size:7pt;color:#64748b;margin-top:2px;}
  .doc-bar{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.5px solid #0f172a;padding-bottom:5px;margin-bottom:10px;}
  .doc-label{font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:#64748b;}
  .doc-title{font-size:13pt;font-weight:900;color:#0f172a;}
  .kpis{display:flex;gap:10px;margin-bottom:10px;}
  .kpi{flex:1;border:1px solid #e2e8f0;border-radius:4px;padding:6px 10px;}
  .kl{font-size:6.5pt;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;}
  .kv{font-size:13pt;font-weight:900;}
  table{width:100%;border-collapse:collapse;}
  thead tr{background:#1B3D2F;color:#fff;}
  th{padding:5px 6px;text-align:left;font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.1em;}
  th.r{text-align:right;}
  td{padding:4px 6px;font-size:8.5pt;border-bottom:1px solid #f1f5f9;}
  tr.even td{background:#fff;} tr.odd td{background:#f8fafc;}
  td.bold{font-weight:700;} td.r{text-align:right;font-family:monospace;}
  td.red{color:#dc2626;} td.emerald-700{color:#047857;} td.amber-600{color:#d97706;}
  .sub{font-size:7pt;color:#94a3b8;font-weight:400;}
  .footer{margin-top:8px;font-size:7pt;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:5px;}
</style></head><body>
<div class="lh">
  <div>${logo ? `<img src="${logo}" class="lh-logo"><br>` : ''}
    <div class="lh-co">${companyName}</div>${addr ? `<div class="lh-addr">${addr}</div>` : ''}
  </div>
</div>
<div class="doc-bar">
  <div>
    <div class="doc-label">Human Resource · Attendance Report</div>
    <div class="doc-title">${monthLabel}</div>
  </div>
  <div style="font-size:8pt;color:#64748b">${workingDays} working days · ${filtered.length} employees · Printed ${new Date().toLocaleDateString('en-KE')}</div>
</div>
<div class="kpis">
  <div class="kpi"><div class="kl">Working Days</div><div class="kv">${workingDays}</div></div>
  <div class="kpi"><div class="kl">Avg Attendance</div><div class="kv" style="color:#047857">${avgAttPct}%</div></div>
  <div class="kpi"><div class="kl">Total Hours Worked</div><div class="kv">${totalHours.toFixed(0)}h</div></div>
  <div class="kpi"><div class="kl">Absence Days (total)</div><div class="kv" style="color:#dc2626">${totalAbsent}</div></div>
</div>
<table>
  <thead><tr>
    <th>Employee</th>
    <th class="r">Working Days</th>
    <th class="r">Present</th>
    <th class="r">Absent</th>
    <th class="r">Total Hours</th>
    <th class="r">Avg Hours/Day</th>
    <th class="r">Attendance %</th>
  </tr></thead>
  <tbody>${tbody}</tbody>
</table>
<div class="footer">Computer-generated attendance report. ${companyName}</div>
</body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [filtered, company, monthLabel, workingDays, avgAttPct, totalHours, totalAbsent]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden">

        {/* Header */}
        <div className="flex flex-none items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Reports</div>
            <h1 className="text-sm font-black leading-tight text-slate-900">Attendance Report</h1>
          </div>
          <div className="flex items-center gap-2">
            {rows.length > 0 && (
              <button onClick={handlePrint} className="flex h-7 items-center gap-1 rounded border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50">
                <FaPrint size={9} /> Print
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
          <AppSelect
            value={month}
            onChange={(v) => setMonth(v ?? String(thisMonth))}
            options={MONTHS.slice(1).map((m, i) => ({ value: String(i + 1), label: m }))}
            size="md"
          />
          <AppSelect
            value={year}
            onChange={(v) => setYear(v ?? String(thisYear))}
            options={yearOpts.map((y) => ({ value: String(y), label: String(y) }))}
            size="md"
          />
          <button
            onClick={() => setCommitted({ month, year })}
            className="flex h-7 items-center gap-1 rounded bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0a2e23]"
          >
            <FaChartBar size={9} /> Generate
          </button>
          {rows.length > 0 && (
            <div className="relative">
              <FaSearch size={9} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by name…" className={`${F} w-40 pl-7`} />
            </div>
          )}
          <span className="ml-auto text-[11px] text-slate-400">{filtered.length} employee{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* KPI strip */}
        {data && rows.length > 0 && (
          <div className="flex flex-none gap-6 border-b border-slate-100 bg-white px-4 py-2">
            <div>
              <div className="text-[10px] text-slate-400">Working days</div>
              <div className="text-sm font-black text-slate-900">{workingDays}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">Avg attendance</div>
              <div className={`text-sm font-black ${pctColor(avgAttPct)}`}>{avgAttPct}%</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">Total presence days</div>
              <div className="text-sm font-black text-emerald-700">{totalPresent}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">Total absence days</div>
              <div className="text-sm font-black text-rose-600">{totalAbsent}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">Total hours worked</div>
              <div className="text-sm font-black text-slate-900">{totalHours.toFixed(0)}h</div>
            </div>
          </div>
        )}

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

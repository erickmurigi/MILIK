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
    const { companyName = '', logo = '', roadStreet = '', town = '', phoneNo = '', email: coEmail = '', taxPIN = '' } = company;
    const addr = [roadStreet, town].filter(Boolean).join(', ');
    const deptName = departmentId ? departments.find((d) => d._id === departmentId)?.name : 'All Departments';

    const tbody = rows.map((r, i) => {
      const pct = r.entitlement > 0 ? Math.round((r.used / r.entitlement) * 100) : 0;
      const color = pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : '#059669';
      return `<tr class="${i%2===0?'even':'odd'}">
        <td class="bold">${r.employeeName}<br><span class="sub">${r.employeeNumber}</span></td>
        <td>${r.department||'—'}</td>
        <td>${r.leaveTypeName} <span style="font-size:7.5pt;color:${r.isPaid?'#059669':'#dc2626'}">${r.isPaid?'(Paid)':'(Unpaid)'}</span></td>
        <td class="r">${r.entitlement}</td>
        <td class="r" style="color:${color};font-weight:700">${r.used}</td>
        <td class="r" style="color:#d97706">${r.pending||'—'}</td>
        <td class="r" style="color:${r.remaining===0?'#dc2626':'#059669'};font-weight:700">${r.remaining}</td>
        <td class="r">${pct}%</td>
      </tr>`;
    }).join('');

    const win = window.open('', '_blank', 'width=1000,height=1120');
    if (!win) { toast.error('Allow pop-ups to print'); return; }
    win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Leave Balances — ${year}</title>
<style>
  @page{size:A4 landscape;margin:12mm 14mm;}
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#1a1a1a;}
  .lh{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:8px;border-bottom:2.5px solid #027333;margin-bottom:12px;}
  .lh-logo{height:40px;width:auto;border-radius:3px;}
  .lh-company{font-size:15pt;font-weight:900;color:#0f172a;}
  .lh-addr{font-size:7.5pt;color:#64748b;margin-top:2px;}
  .lh-meta{text-align:right;font-size:7.5pt;color:#64748b;line-height:1.7;}
  .doc-bar{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.5px solid #0f172a;padding-bottom:5px;margin-bottom:10px;}
  .doc-label{font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:#64748b;}
  .doc-title{font-size:13pt;font-weight:900;color:#0f172a;margin-top:2px;}
  .doc-sub{font-size:8pt;color:#64748b;}
  .summary{display:flex;gap:12px;margin-bottom:10px;}
  .scard{flex:1;border:1px solid #e2e8f0;border-radius:4px;padding:6px 10px;}
  .sc-label{font-size:6.5pt;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;}
  .sc-value{font-size:14pt;font-weight:900;margin-top:1px;}
  table{width:100%;border-collapse:collapse;}
  thead tr{background:#1B3D2F;color:#fff;}
  th{padding:5px 6px;text-align:left;font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.1em;}
  th.r{text-align:right;}
  td{padding:4px 6px;font-size:8.5pt;border-bottom:1px solid #f1f5f9;vertical-align:top;}
  tr.even td{background:#fff;} tr.odd td{background:#f8fafc;}
  td.bold{font-weight:700;color:#0f172a;}
  td.r{text-align:right;font-family:monospace;}
  .sub{font-size:7pt;color:#94a3b8;font-weight:400;}
  .footer{margin-top:10px;display:flex;justify-content:space-between;font-size:7pt;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:5px;}
  @media print{html,body{background:#fff;}}
</style></head><body>
<div class="lh">
  <div>${logo?`<img src="${logo}" class="lh-logo" alt="${companyName}"><br>`:''}
    <div class="lh-company">${companyName}</div>${addr?`<div class="lh-addr">${addr}</div>`:''}
  </div>
  <div class="lh-meta">${coEmail?coEmail+'<br>':''}${phoneNo?phoneNo+'<br>':''}${taxPIN?'KRA PIN: '+taxPIN:''}</div>
</div>
<div class="doc-bar">
  <div>
    <div class="doc-label">Human Resource · Leave Balances</div>
    <div class="doc-title">Leave Balances — ${year}</div>
    <div class="doc-sub">${deptName||'All Departments'}</div>
  </div>
  <div class="doc-sub">Printed: ${new Date().toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'})}</div>
</div>
<div class="summary">
  <div class="scard"><div class="sc-label">Entitlement</div><div class="sc-value">${totalEntitled} days</div></div>
  <div class="scard"><div class="sc-label">Days Used</div><div class="sc-value" style="color:#dc2626">${totalUsed} days</div></div>
  <div class="scard"><div class="sc-label">Remaining</div><div class="sc-value" style="color:#059669">${totalRemaining} days</div></div>
  <div class="scard"><div class="sc-label">Avg Utilisation</div><div class="sc-value" style="color:#d97706">${avgUtil}%</div></div>
</div>
<table>
  <thead><tr>
    <th>Employee</th><th>Department</th><th>Leave Type</th>
    <th class="r">Entitlement</th><th class="r">Used</th><th class="r">Pending</th><th class="r">Remaining</th><th class="r">Util%</th>
  </tr></thead>
  <tbody>${tbody}</tbody>
</table>
<div class="footer"><span>Computer-generated leave balance report.</span><span>${companyName}</span></div>
</body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [rows, year, departmentId, departments, totalEntitled, totalUsed, totalRemaining, avgUtil, company]);

  const inputCls = 'h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';

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
              <button onClick={refetch} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
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
            <AppSelect value={year} onChange={(v) => setYear(Number(v ?? currentYear))} options={YEARS.map((y) => ({ value: y, label: String(y) }))} size="sm" />
            <AppSelect value={departmentId} onChange={(v) => setDeptId(v ?? "")} options={departments.map((d) => ({ value: d._id, label: d.name }))} placeholder="All departments" clearable searchable size="sm" />
            <AppSelect value={leaveTypeId} onChange={(v) => setLtId(v ?? "")} options={leaveTypes.map((t) => ({ value: t._id, label: t.name }))} placeholder="All leave types" clearable size="sm" />
            {rows.length > 0 && (
              <span className="ml-auto text-[11px] font-semibold text-slate-500">
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
                  <div key={label} className={`rounded-lg border ${color} bg-white px-3 py-2.5 shadow-sm`}>
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                    <div className="text-lg font-black text-slate-900 mt-0.5">{value}</div>
                  </div>
                ))}
              </div>

              {/* Table */}
              <div className="print-card overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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

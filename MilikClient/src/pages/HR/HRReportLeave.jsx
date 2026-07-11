import React, { useCallback, useEffect, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useSelector } from 'react-redux';
import { FaCalendarAlt, FaRedoAlt, FaPrint, FaFilter, FaTag, FaUsers } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import { selectCurrentCompany } from '../../redux/selectors';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const currentYear = new Date().getFullYear();

function isoDate(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : '';
}

export default function HRReportLeave() {
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [filters, setFilters] = useTabState('/hr/reports/leave:filters', { startDate: `${currentYear}-01-01`, endDate: `${currentYear}-12-31`, leaveTypeId: '' });
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

  const company = useSelector(selectCurrentCompany) || {};

  const handlePrint = useCallback(() => {
    if (!data) return;
    const { companyName = '', logo = '', roadStreet = '', town = '', phoneNo = '', email: coEmail = '', taxPIN = '' } = company;
    const addr = [roadStreet, town].filter(Boolean).join(', ');
    const dateRange = filters.startDate && filters.endDate ? `${filters.startDate} to ${filters.endDate}` : 'All dates';

    const typeRows = (data.byType || []).map((t, i) => `<tr class="${i%2===0?'even':'odd'}"><td class="bold">${t.name} <span style="font-size:7.5pt;color:${t.isPaid?'#059669':'#dc2626'}">${t.isPaid?'(Paid)':'(Unpaid)'}</span></td><td class="r">${t.count}</td><td class="r bold">${t.totalDays}</td></tr>`).join('');
    const empRows = (data.byEmployee || []).slice(0, 30).map((e, i) => `<tr class="${i%2===0?'even':'odd'}"><td class="bold">${e.name}<br><span class="sub">${e.employeeNumber} · ${e.department||'—'}</span></td><td class="r">${e.count}</td><td class="r bold green">${e.totalDays}</td></tr>`).join('');

    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) { toast.error('Allow pop-ups to print'); return; }
    win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Leave Summary</title>
<style>
  @page{size:A4;margin:14mm 16mm;}
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
  .summary{display:flex;gap:10px;margin-bottom:12px;}
  .scard{flex:1;border:1px solid #e2e8f0;border-radius:4px;padding:6px 10px;}
  .sc-label{font-size:6.5pt;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;}
  .sc-value{font-size:16pt;font-weight:900;margin-top:1px;}
  .cols{display:flex;gap:14px;}
  .col{flex:1;}
  .sec-head{background:#1B3D2F;color:#fff;padding:5px 8px;font-size:7.5pt;font-weight:900;text-transform:uppercase;letter-spacing:.15em;margin-bottom:0;}
  table{width:100%;border-collapse:collapse;}
  th{padding:5px 6px;text-align:left;font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.1em;background:#f8fafc;border-bottom:2px solid #e2e8f0;}
  th.r{text-align:right;}
  td{padding:4px 6px;font-size:8.5pt;border-bottom:1px solid #f1f5f9;vertical-align:top;}
  tr.even td{background:#fff;} tr.odd td{background:#f8fafc;}
  td.bold{font-weight:700;color:#0f172a;}
  td.r{text-align:right;font-family:monospace;}
  td.green{color:#059669;}
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
  <div><div class="doc-label">Human Resource · Leave Summary Report</div><div class="doc-title">Leave Summary</div><div class="doc-sub">${dateRange}</div></div>
  <div class="doc-sub">Printed: ${new Date().toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'})}</div>
</div>
<div class="summary">
  <div class="scard"><div class="sc-label">Applications</div><div class="sc-value">${data.totals.count}</div></div>
  <div class="scard"><div class="sc-label">Days Taken</div><div class="sc-value" style="color:#059669">${data.totals.totalDays}</div></div>
  <div class="scard"><div class="sc-label">Leave Types</div><div class="sc-value">${data.byType.length}</div></div>
</div>
<div class="cols">
  <div class="col">
    <div class="sec-head">By Leave Type</div>
    <table><thead><tr><th>Leave Type</th><th class="r">Apps</th><th class="r">Days</th></tr></thead>
    <tbody>${typeRows||'<tr><td colspan="3" style="text-align:center;color:#94a3b8">No data</td></tr>'}</tbody></table>
  </div>
  <div class="col">
    <div class="sec-head">By Employee (Top 30)</div>
    <table><thead><tr><th>Employee</th><th class="r">Apps</th><th class="r">Days</th></tr></thead>
    <tbody>${empRows||'<tr><td colspan="3" style="text-align:center;color:#94a3b8">No data</td></tr>'}</tbody></table>
  </div>
</div>
<div class="footer"><span>Computer-generated leave summary report.</span><span>${companyName}</span></div>
</body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [data, filters, company]);

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
                    <table className="min-w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-[#0B3B2E] text-white">
                          <th className="px-3 py-1 text-left font-bold border-r border-white/10">Leave Type</th>
                          <th className="px-3 py-1 text-right font-bold border-r border-white/10">Applications</th>
                          <th className="px-3 py-1 text-right font-bold">Days</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byType.map((t, i) => (
                          <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                            <td className="px-3 py-1 border-r border-gray-100">
                              <div className="font-black text-slate-900">{t.name}</div>
                              <span className={`text-[9px] font-black ${t.isPaid ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {t.isPaid ? 'Paid' : 'Unpaid'}
                              </span>
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-700">{t.count}</td>
                            <td className="px-3 py-1 text-right font-black text-slate-900">{t.totalDays}</td>
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
                    <table className="min-w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-[#0B3B2E] text-white">
                          <th className="px-3 py-1 text-left font-bold border-r border-white/10">Employee</th>
                          <th className="px-3 py-1 text-right font-bold border-r border-white/10">Applications</th>
                          <th className="px-3 py-1 text-right font-bold">Days</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byEmployee.slice(0, 20).map((e, i) => (
                          <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                            <td className="px-3 py-1 border-r border-gray-100">
                              <div className="font-black text-slate-900">{e.name}</div>
                              <div className="text-[10px] text-slate-400">{e.employeeNumber} · {e.department}</div>
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-700">{e.count}</td>
                            <td className="px-3 py-1 text-right font-black text-emerald-700">{e.totalDays}</td>
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

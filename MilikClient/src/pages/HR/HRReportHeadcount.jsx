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

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

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
    <div className={`rounded-lg border ${color} bg-white px-3 py-2.5 shadow-sm`}>
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
    const { companyName = '', logo = '', roadStreet = '', town = '', phoneNo = '', email: coEmail = '', taxPIN = '' } = company;
    const addr = [roadStreet, town].filter(Boolean).join(', ');
    const s = data.summary || {};

    const deptRows = (data.byDepartment || []).map((d, i) => `<tr class="${i%2===0?'even':'odd'}"><td class="bold">${d.name}</td><td class="r">${d.total}</td><td class="r green">${d.active}</td><td class="r amber">${d.probation||0}</td><td class="r red">${d.terminated||0}</td></tr>`).join('');
    const typeRows = (data.byType || []).map((t, i) => `<tr class="${i%2===0?'even':'odd'}"><td>${t.type||'—'}</td><td class="r">${t.total}</td><td class="r green">${t.active}</td><td class="r">${s.total?Math.round((t.total/s.total)*100):0}%</td></tr>`).join('');
    const joinRows = (data.recentJoiners || []).map((e, i) => `<tr class="${i%2===0?'even':'odd'}"><td class="bold">${e.surname} ${e.otherNames}<br><span class="sub">${e.employeeNumber}</span></td><td>${e.department?.name||'—'}</td><td>${e.designation?.name||'—'}</td><td>${e.employmentType||'—'}</td><td class="r">${fmtDate(e.dateJoined)}</td></tr>`).join('');

    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) { toast.error('Allow pop-ups to print'); return; }
    win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Headcount Report</title>
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
  .section{margin-bottom:14px;}
  .sec-head{background:#1B3D2F;color:#fff;padding:5px 8px;font-size:7.5pt;font-weight:900;text-transform:uppercase;letter-spacing:.15em;border-radius:4px 4px 0 0;}
  table{width:100%;border-collapse:collapse;}
  th{padding:5px 6px;text-align:left;font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.1em;background:#f8fafc;border-bottom:2px solid #e2e8f0;}
  th.r{text-align:right;}
  td{padding:4px 6px;font-size:8.5pt;border-bottom:1px solid #f1f5f9;vertical-align:top;}
  tr.even td{background:#fff;} tr.odd td{background:#f8fafc;}
  td.bold{font-weight:700;color:#0f172a;}
  td.r{text-align:right;font-family:monospace;}
  td.green{color:#059669;} td.red{color:#dc2626;} td.amber{color:#d97706;}
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
  <div><div class="doc-label">Human Resource · Reports</div><div class="doc-title">Employee Headcount</div></div>
  <div class="doc-sub">Printed: ${new Date().toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'})}</div>
</div>
<div class="summary">
  <div class="scard"><div class="sc-label">Total</div><div class="sc-value">${s.total||0}</div></div>
  <div class="scard"><div class="sc-label">Active</div><div class="sc-value" style="color:#059669">${s.active||0}</div></div>
  <div class="scard"><div class="sc-label">Probation</div><div class="sc-value" style="color:#d97706">${s.probation||0}</div></div>
  <div class="scard"><div class="sc-label">Terminated</div><div class="sc-value" style="color:#dc2626">${s.terminated||0}</div></div>
</div>
<div style="display:flex;gap:14px;margin-bottom:14px;">
  <div style="flex:1.2;">
    <div class="sec-head">By Department</div>
    <table><thead><tr><th>Department</th><th class="r">Total</th><th class="r">Active</th><th class="r">Probation</th><th class="r">Terminated</th></tr></thead>
    <tbody>${deptRows}</tbody></table>
  </div>
  <div style="flex:0.8;">
    <div class="sec-head">By Employment Type</div>
    <table><thead><tr><th>Type</th><th class="r">Total</th><th class="r">Active</th><th class="r">%</th></tr></thead>
    <tbody>${typeRows}</tbody></table>
  </div>
</div>
${joinRows?`<div class="sec-head">Recent Joiners (Last 90 Days)</div>
<table><thead><tr><th>Employee</th><th>Department</th><th>Designation</th><th>Type</th><th class="r">Date Joined</th></tr></thead>
<tbody>${joinRows}</tbody></table>`:''}
<div class="footer"><span>Computer-generated headcount report.</span><span>${companyName}</span></div>
</body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [data, company]);

  const maxDept = Math.max(1, ...(data?.byDepartment || []).map((d) => d.total));

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm print-hide">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Reports</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Headcount Report</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} />
              </button>
              <button onClick={handlePrint} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23]">
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
                <div className="print-card rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
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
                <div className="print-card rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
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
                <div className="print-card rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
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

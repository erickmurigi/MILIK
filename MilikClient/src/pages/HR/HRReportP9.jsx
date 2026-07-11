import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useSelector } from 'react-redux';
import { FaFileAlt, FaRedoAlt, FaPrint, FaSearch } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import { selectCurrentCompany } from '../../redux/selectors';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const fmtKES = (n) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - 5 + i);

const STATUS_STYLE = {
  Draft:      'text-slate-400',
  Processing: 'text-amber-500',
  Approved:   'text-blue-600',
  Paid:       'text-emerald-600',
  Closed:     'text-rose-500',
};

export default function HRReportP9() {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [year, setYear]   = useState(currentYear);
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useTabState('/hr/reports/p9:search', '');

  useEffect(() => {
    adminRequests.get('/hr/reports/employees-list')
      .then((r) => setEmployees(r.data || []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const res = await adminRequests.get('/hr/reports/p9', { params: { employeeId, year } });
      setData(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to load P9 data');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [employeeId, year]);

  useEffect(() => { load(); }, [load]);

  const company = useSelector(selectCurrentCompany) || {};

  const handlePrint = useCallback(() => {
    if (!data || !months.length) return;
    const { companyName = '', logo = '', roadStreet = '', town = '', phoneNo = '', email: coEmail = '', taxPIN = '' } = company;
    const addr = [roadStreet, town].filter(Boolean).join(', ');

    const tbody = months.map((m) => `<tr>
      <td class="bold">${m.label}</td>
      <td class="r">${fmtKES(m.grossSalary)}</td>
      <td class="r green">(${fmtKES(m.personalRelief)})</td>
      <td class="r red bold">${fmtKES(m.paye)}</td>
      <td class="r red">${fmtKES(m.nhif)}</td>
      <td class="r red">${fmtKES(m.nssf)}</td>
      <td class="r red">${fmtKES(m.ahl)}</td>
      <td class="r green bold">${fmtKES(m.netSalary)}</td>
      <td style="font-size:7.5pt;font-weight:700;color:#64748b;text-align:center">${m.status}</td>
    </tr>`).join('');

    const win = window.open('', '_blank', 'width=1000,height=1200');
    if (!win) { toast.error('Allow pop-ups to print'); return; }
    win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>P9 — ${emp?.surname} ${emp?.otherNames} — ${data.year}</title>
<style>
  @page{size:A4 landscape;margin:14mm 16mm;}
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
  .emp-strip{display:flex;gap:18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:9px 14px;margin-bottom:12px;}
  .ef{flex:1;}.ef-l{font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;margin-bottom:1px;}
  .ef-v{font-size:10pt;font-weight:900;color:#0f172a;}
  table{width:100%;border-collapse:collapse;margin-bottom:10px;}
  thead tr{background:#1B3D2F;color:#fff;}
  th{padding:5px 6px;text-align:left;font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.1em;white-space:nowrap;}
  th.r{text-align:right;}
  td{padding:4px 6px;font-size:8.5pt;border-bottom:1px solid #f1f5f9;vertical-align:top;}
  tr:nth-child(even) td{background:#f8fafc;}
  td.bold{font-weight:700;color:#0f172a;}
  td.r{text-align:right;font-family:monospace;}
  td.red{color:#dc2626;} td.green{color:#059669;}
  tfoot tr td{font-weight:900;border-top:2px solid #e2e8f0;padding-top:5px;}
  .boxes{display:flex;gap:10px;margin-bottom:10px;}
  .box{flex:1;border:1px solid #e2e8f0;border-radius:4px;padding:8px 12px;}
  .box-l{font-size:6.5pt;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;}
  .box-v{font-size:14pt;font-weight:900;margin-top:2px;}
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
    <div class="doc-label">Human Resource · P9 Tax Deduction Card · Kenya Revenue Authority</div>
    <div class="doc-title">Tax Year ${data.year} — ${emp?.surname} ${emp?.otherNames}</div>
  </div>
  <div class="doc-sub">Printed: ${new Date().toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'})}</div>
</div>
<div class="emp-strip">
  <div class="ef"><div class="ef-l">Employee Name</div><div class="ef-v">${emp?.surname} ${emp?.otherNames}</div></div>
  <div class="ef"><div class="ef-l">Employee No.</div><div class="ef-v" style="font-family:monospace">${emp?.employeeNumber||'—'}</div></div>
  <div class="ef"><div class="ef-l">KRA PIN</div><div class="ef-v" style="font-family:monospace">${emp?.kraPin||'—'}</div></div>
  <div class="ef"><div class="ef-l">Department</div><div class="ef-v">${emp?.department?.name||'—'}</div></div>
  <div class="ef"><div class="ef-l">Designation</div><div class="ef-v">${emp?.designation?.name||'—'}</div></div>
</div>
<table>
  <thead><tr>
    <th>Month</th><th class="r">Gross</th><th class="r">Personal Relief</th>
    <th class="r">PAYE</th><th class="r">SHA</th><th class="r">NSSF</th><th class="r">AHL</th>
    <th class="r">Net Pay</th><th style="text-align:center">Status</th>
  </tr></thead>
  <tbody>${tbody}</tbody>
  <tfoot><tr>
    <td>Annual Total</td>
    <td class="r">${fmtKES(totals.grossSalary)}</td>
    <td class="r green">(${fmtKES(totals.personalRelief)})</td>
    <td class="r red">${fmtKES(totals.paye)}</td>
    <td class="r red">${fmtKES(totals.nhif)}</td>
    <td class="r red">${fmtKES(totals.nssf)}</td>
    <td class="r red">${fmtKES(totals.ahl)}</td>
    <td class="r green">${fmtKES(totals.netSalary)}</td>
    <td></td>
  </tr></tfoot>
</table>
<div class="boxes">
  <div class="box"><div class="box-l">Annual Gross Income</div><div class="box-v">${fmtKES(totals.grossSalary)}</div></div>
  <div class="box" style="border-color:#fecaca;background:#fff5f5"><div class="box-l" style="color:#f87171">Total PAYE Deducted</div><div class="box-v" style="color:#dc2626">${fmtKES(totals.paye)}</div></div>
  <div class="box" style="border-color:#a7f3d0;background:#f0fdf4"><div class="box-l" style="color:#34d399">Total Net Pay</div><div class="box-v" style="color:#059669">${fmtKES(totals.netSalary)}</div></div>
</div>
<div class="footer"><span>Computer-generated P9 certificate — does not require a signature.</span><span>${companyName}</span></div>
</body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [data, emp, months, totals, company]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      `${e.surname} ${e.otherNames}`.toLowerCase().includes(q)
      || (e.employeeNumber || '').toLowerCase().includes(q)
    );
  }, [employees, search]);

  const emp = data?.employee;
  const months = data?.months || [];
  const totals = data?.totals || {};

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm print-hide">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Reports</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">P9 Form — Annual Tax Certificate</h1>
            </div>
            <div className="flex items-center gap-2">
              {data && months.length > 0 && (
                <button onClick={handlePrint} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23]">
                  <FaPrint size={10} /> Print P9
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 flex overflow-hidden">

          {/* Sidebar: Employee picker */}
          <div className="print-hide flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
            <div className="flex-shrink-0 border-b border-slate-100 p-3 space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Select Employee</div>
              <div className="relative">
                <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="h-7 w-full rounded border border-slate-200 bg-slate-50 pl-7 pr-3 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                />
              </div>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
              >
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
              {filtered.map((e) => (
                <button
                  key={e._id}
                  onClick={() => setEmployeeId(e._id)}
                  className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 transition-colors ${employeeId === e._id ? 'bg-emerald-50 border-l-2 border-emerald-600' : ''}`}
                >
                  <div className="text-xs font-black text-slate-900 truncate">{e.surname} {e.otherNames}</div>
                  <div className="text-[10px] text-slate-400">{e.employeeNumber}</div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="flex h-24 items-center justify-center text-xs text-slate-400">No employees</div>
              )}
            </div>
          </div>

          {/* Main content */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {!employeeId ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-300">
                <FaFileAlt size={40} />
                <p className="text-sm font-black">Select an employee</p>
                <p className="text-xs text-slate-400">Then choose a year to generate their P9 form</p>
              </div>
            ) : loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading P9 data…</div>
            ) : !data || months.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
                <FaFileAlt size={24} />
                <p className="text-sm font-semibold">No payroll data for {year}</p>
                <p className="text-xs">This employee has no processed payslips for {year}</p>
              </div>
            ) : (
              <div className="employee-print-area">
                <PrintLetterhead
                  variant="document"
                  docLabel="Human Resource · P9 Tax Certificate"
                  docTitle={`Tax Year ${data.year} — ${emp?.surname} ${emp?.otherNames}`}
                  printedDate={false}
                />

                {/* P9 Document */}
                <div className="mx-auto max-w-3xl">
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden print-card">

                    {/* Document header */}
                    <div className="bg-[#0B3B2E] px-8 py-5 text-white">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">P9 Tax Deduction Card</div>
                          <div className="text-2xl font-black mt-0.5">Tax Year {data.year}</div>
                          <div className="text-xs text-emerald-200 mt-1">Kenya Revenue Authority — Annual Return</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Employee No.</div>
                          <div className="text-xl font-black">{emp?.employeeNumber}</div>
                          {emp?.kraPin && (
                            <div className="text-xs font-mono text-emerald-200 mt-1">KRA: {emp.kraPin}</div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Employee details */}
                    <div className="border-b border-slate-100 bg-slate-50 px-8 py-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Employee Name</div>
                          <div className="text-sm font-black text-slate-900">{emp?.surname} {emp?.otherNames}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Department</div>
                          <div className="text-sm font-semibold text-slate-700">{emp?.department?.name || '—'}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Designation</div>
                          <div className="text-sm font-semibold text-slate-700">{emp?.designation?.name || '—'}</div>
                        </div>
                      </div>
                    </div>

                    {/* Monthly breakdown */}
                    <div className="px-8 py-5">
                      <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Monthly Tax Deductions — {data.year}</div>
                      <table className="w-full text-[11px] border-collapse">
                        <thead>
                          <tr className="bg-[#0B3B2E] text-white">
                            <th className="py-1 px-2 text-left font-bold border-r border-white/10">Month</th>
                            <th className="py-1 px-2 text-right font-bold border-r border-white/10">Gross</th>
                            <th className="py-1 px-2 text-right font-bold border-r border-white/10">Personal Relief</th>
                            <th className="py-1 px-2 text-right font-bold border-r border-white/10">PAYE</th>
                            <th className="py-1 px-2 text-right font-bold border-r border-white/10">SHA</th>
                            <th className="py-1 px-2 text-right font-bold border-r border-white/10">NSSF</th>
                            <th className="py-1 px-2 text-right font-bold border-r border-white/10">AHL</th>
                            <th className="py-1 px-2 text-right font-bold border-r border-white/10">Net Pay</th>
                            <th className="py-1 px-2 text-center font-bold">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {months.map((m, i) => (
                            <tr key={m.month} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                              <td className="py-1 px-2 font-black text-slate-900 border-r border-gray-100">{m.label}</td>
                              <td className="py-1 px-2 text-right text-slate-700 border-r border-gray-100">{fmtKES(m.grossSalary)}</td>
                              <td className="py-1 px-2 text-right text-emerald-600 border-r border-gray-100">({fmtKES(m.personalRelief)})</td>
                              <td className="py-1 px-2 text-right font-semibold text-rose-600 border-r border-gray-100">{fmtKES(m.paye)}</td>
                              <td className="py-1 px-2 text-right text-rose-500 border-r border-gray-100">{fmtKES(m.nhif)}</td>
                              <td className="py-1 px-2 text-right text-rose-500 border-r border-gray-100">{fmtKES(m.nssf)}</td>
                              <td className="py-1 px-2 text-right text-rose-500 border-r border-gray-100">{fmtKES(m.ahl)}</td>
                              <td className="py-1 px-2 text-right font-black text-emerald-700 border-r border-gray-100">{fmtKES(m.netSalary)}</td>
                              <td className="py-1 px-2 text-center text-[10px] font-black">
                                <span className={STATUS_STYLE[m.status] || 'text-slate-400'}>{m.status}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-300 bg-slate-50">
                            <td className="py-1.5 px-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Annual Total</td>
                            <td className="py-1.5 px-2 text-right font-black text-slate-900">{fmtKES(totals.grossSalary)}</td>
                            <td className="py-1.5 px-2 text-right font-black text-emerald-600">({fmtKES(totals.personalRelief)})</td>
                            <td className="py-1.5 px-2 text-right font-black text-rose-700">{fmtKES(totals.paye)}</td>
                            <td className="py-1.5 px-2 text-right font-black text-rose-600">{fmtKES(totals.nhif)}</td>
                            <td className="py-1.5 px-2 text-right font-black text-rose-600">{fmtKES(totals.nssf)}</td>
                            <td className="py-1.5 px-2 text-right font-black text-rose-600">{fmtKES(totals.ahl)}</td>
                            <td className="py-1.5 px-2 text-right font-black text-emerald-700">{fmtKES(totals.netSalary)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Annual summary boxes */}
                    <div className="border-t border-slate-100 bg-slate-50 px-8 py-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Annual Gross Income</div>
                          <div className="text-base font-black text-slate-900 mt-0.5">{fmtKES(totals.grossSalary)}</div>
                        </div>
                        <div className="rounded-lg border border-rose-100 bg-rose-50 p-3">
                          <div className="text-[9px] font-black uppercase tracking-widest text-rose-400">Total PAYE Deducted</div>
                          <div className="text-base font-black text-rose-700 mt-0.5">{fmtKES(totals.paye)}</div>
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                          <div className="text-[9px] font-black uppercase tracking-widest text-emerald-500">Total Net Pay</div>
                          <div className="text-base font-black text-emerald-700 mt-0.5">{fmtKES(totals.netSalary)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="px-8 py-3 bg-slate-50 border-t border-slate-100">
                      <div className="flex items-center justify-between text-[9px] text-slate-400">
                        <span>This is a computer-generated P9 certificate and does not require a signature.</span>
                        <span>Generated: {new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

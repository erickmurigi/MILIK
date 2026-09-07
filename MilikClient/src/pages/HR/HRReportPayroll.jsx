import React, { useCallback, useEffect, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useSelector } from 'react-redux';
import { FaMoneyBillWave, FaRedoAlt, FaPrint, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import { selectCurrentCompany } from '../../redux/selectors';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const fmtKES = (n) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

const STATUS_STYLE = {
  Draft:      'border-slate-200 bg-slate-50 text-slate-500',
  Processing: 'border-amber-200 bg-amber-50 text-amber-700',
  Approved:   'border-blue-200 bg-blue-50 text-blue-700',
  Paid:       'border-emerald-200 bg-emerald-50 text-emerald-700',
  Closed:     'border-rose-200 bg-rose-50 text-rose-600',
};

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - 5 + i);

export default function HRReportPayroll() {
  const [year, setYear]     = useTabState("/hr/reports/payroll:year", currentYear);
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequests.get('/hr/reports/payroll-summary', { params: { year } });
      setData(res.data);
    } catch {
      toast.error('Failed to load payroll summary');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const company = useSelector(selectCurrentCompany) || {};

  const handlePrint = useCallback(() => {
    if (!months.length) return;
    const { companyName = '', logo = '', roadStreet = '', town = '', phoneNo = '', email: coEmail = '', taxPIN = '' } = company;
    const addr = [roadStreet, town].filter(Boolean).join(', ');

    const tbody = months.map((m, i) => `<tr class="${i%2===0?'even':'odd'}">
      <td class="bold">${m.label}</td>
      <td class="r">${m.employeeCount}</td>
      <td class="r bold">${fmtKES(m.totalGross)}</td>
      <td class="r red">${fmtKES(m.totalPAYE)}</td>
      <td class="r red">${fmtKES(m.totalNHIF)}</td>
      <td class="r red">${fmtKES(m.totalNSSF)}</td>
      <td class="r red">${fmtKES(m.totalAHL)}</td>
      <td class="r green bold">${fmtKES(m.totalNet)}</td>
      <td style="font-size:7.5pt;font-weight:700;color:#64748b">${m.status}</td>
    </tr>`).join('');

    const win = window.open('', '_blank', 'width=1050,height=1200');
    if (!win) { toast.error('Allow pop-ups to print'); return; }
    win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Payroll Summary — ${year}</title>
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
  .summary{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;}
  .scard{flex:1;min-width:80px;border:1px solid #e2e8f0;border-radius:4px;padding:5px 8px;}
  .sc-label{font-size:6pt;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;}
  .sc-value{font-size:11pt;font-weight:900;margin-top:1px;}
  table{width:100%;border-collapse:collapse;}
  thead tr{background:#1B3D2F;color:#fff;}
  th{padding:5px 6px;text-align:left;font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.1em;white-space:nowrap;}
  th.r{text-align:right;}
  td{padding:4px 6px;font-size:8.5pt;border-bottom:1px solid #f1f5f9;vertical-align:top;}
  tr.even td{background:#fff;} tr.odd td{background:#f8fafc;}
  td.bold{font-weight:700;color:#0f172a;}
  td.r{text-align:right;font-family:monospace;}
  td.red{color:#dc2626;} td.green{color:#059669;}
  tfoot tr td{font-weight:900;border-top:2px solid #e2e8f0;padding-top:5px;}
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
  <div><div class="doc-label">Human Resource · Payroll Summary</div><div class="doc-title">Payroll Summary — ${year}</div></div>
  <div class="doc-sub">Printed: ${new Date().toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'})}</div>
</div>
<div class="summary">
  <div class="scard"><div class="sc-label">Total Gross</div><div class="sc-value">${fmtKES(t.gross)}</div></div>
  <div class="scard"><div class="sc-label">PAYE</div><div class="sc-value" style="color:#dc2626">${fmtKES(t.paye)}</div></div>
  <div class="scard"><div class="sc-label">SHA</div><div class="sc-value" style="color:#dc2626">${fmtKES(t.nhif)}</div></div>
  <div class="scard"><div class="sc-label">NSSF</div><div class="sc-value" style="color:#dc2626">${fmtKES(t.nssf)}</div></div>
  <div class="scard"><div class="sc-label">AHL</div><div class="sc-value" style="color:#dc2626">${fmtKES(t.ahl)}</div></div>
  <div class="scard"><div class="sc-label">Total Deductions</div><div class="sc-value" style="color:#dc2626">${fmtKES(t.deductions)}</div></div>
  <div class="scard"><div class="sc-label">Net Pay</div><div class="sc-value" style="color:#059669">${fmtKES(t.net)}</div></div>
</div>
<table>
  <thead><tr>
    <th>Month</th><th class="r">Employees</th><th class="r">Gross</th>
    <th class="r">PAYE</th><th class="r">SHA</th><th class="r">NSSF</th><th class="r">AHL</th>
    <th class="r">Net Pay</th><th>Status</th>
  </tr></thead>
  <tbody>${tbody}</tbody>
  <tfoot><tr>
    <td>Totals</td><td class="r">—</td>
    <td class="r">${fmtKES(t.gross)}</td>
    <td class="r red">${fmtKES(t.paye)}</td>
    <td class="r red">${fmtKES(t.nhif)}</td>
    <td class="r red">${fmtKES(t.nssf)}</td>
    <td class="r red">${fmtKES(t.ahl)}</td>
    <td class="r green">${fmtKES(t.net)}</td>
    <td></td>
  </tr></tfoot>
</table>
<div class="footer"><span>Computer-generated payroll summary.</span><span>${companyName}</span></div>
</body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [months, t, year, company]);

  const t = data?.totals || {};
  const months = data?.months || [];

  const maxGross = Math.max(1, ...months.map((m) => m.totalGross));

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Toolbar */}
        <div className="flex-none sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm print-hide">
          <div className="filter-bar flex items-center gap-1 overflow-x-auto px-2 py-1.5">
            <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-emerald-700">Payroll Summary</span>
            <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />
            {/* Year nav */}
            <div className="flex h-7 shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-1.5">
              <button onClick={() => setYear((y) => y - 1)} disabled={year <= currentYear - 5} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                <FaChevronLeft size={9} />
              </button>
              <span className="min-w-[3rem] text-center text-xs font-black text-slate-900">{year}</span>
              <button onClick={() => setYear((y) => y + 1)} disabled={year >= currentYear} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                <FaChevronRight size={9} />
              </button>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <button onClick={load} className="flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} />
              </button>
              {months.length > 0 && (
                <button onClick={handlePrint} className="flex h-7 items-center gap-1 rounded bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0a2e23]">
                  <FaPrint size={10} /> Print
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading…</div>
          ) : months.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
              <FaMoneyBillWave size={28} />
              <p className="text-sm font-semibold">No approved payroll periods for {year}</p>
              <p className="text-xs">Only approved, paid, or closed periods are included</p>
            </div>
          ) : (
            <div className="employee-print-area space-y-4">

              <PrintLetterhead
                variant="print"
                docLabel="Human Resource · Payroll Summary"
                docTitle={`Payroll Summary — ${year}`}
              />

              {/* Summary + statutory combined row */}
              <div className="print-card grid grid-cols-4 gap-2 lg:grid-cols-8">
                {[
                  { label: 'Total Gross',    value: fmtKES(t.gross),      color: 'text-slate-900',   border: 'border-slate-200' },
                  { label: 'Total PAYE',     value: fmtKES(t.paye),       color: 'text-rose-600',    border: 'border-rose-100' },
                  { label: 'Total SHA',      value: fmtKES(t.nhif),       color: 'text-rose-500',    border: 'border-slate-200' },
                  { label: 'Total NSSF',     value: fmtKES(t.nssf),       color: 'text-rose-500',    border: 'border-slate-200' },
                  { label: 'Total AHL',      value: fmtKES(t.ahl),        color: 'text-rose-500',    border: 'border-slate-200' },
                  { label: 'Deductions',     value: fmtKES(t.deductions), color: 'text-rose-700',    border: 'border-rose-100' },
                  { label: 'Net Pay',        value: fmtKES(t.net),        color: 'text-emerald-700', border: 'border-emerald-200' },
                  { label: 'Months',         value: months.length,        color: 'text-slate-900',   border: 'border-slate-200' },
                ].map(({ label, value, color, border }) => (
                  <div key={label} className={`border ${border} bg-white px-3 py-2 shadow-sm`}>
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                    <div className={`text-sm font-black leading-tight mt-0.5 ${color}`}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Monthly bar chart (screen only) */}
              {months.length > 0 && (
                <div className="print-hide border border-slate-200 bg-white px-4 pt-3 pb-2 shadow-sm">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Monthly Gross Pay</div>
                  <div className="flex items-end gap-1.5" style={{ height: '72px' }}>
                    {months.map((m) => (
                      <div key={m.month} className="flex flex-1 flex-col items-center gap-0.5">
                        <div className="text-[8px] font-black text-slate-400 leading-none">
                          {m.totalGross > 0 ? `${Math.round(m.totalGross / 1000)}K` : ''}
                        </div>
                        <div
                          className="w-full rounded-t bg-emerald-500 transition-all"
                          style={{ height: `${Math.max(3, Math.round((m.totalGross / maxGross) * 52))}px` }}
                        />
                        <div className="text-[9px] text-slate-500 font-semibold leading-none">{m.label.slice(0, 3)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Monthly detail table */}
              <div className="print-card overflow-hidden border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-[#0B3B2E] text-white">
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Month</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">Employees</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">Gross</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">PAYE</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">SHA</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">NSSF</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">AHL</th>
                      <th className="px-3 py-1 text-right font-bold border-r border-white/10">Net Pay</th>
                      <th className="px-3 py-1 text-left font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((m, i) => (
                      <tr key={m.month} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                        <td className="px-3 py-1 border-r border-gray-100 font-black text-slate-900">{m.label}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-700">{m.employeeCount}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-900">{fmtKES(m.totalGross)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right text-rose-600">{fmtKES(m.totalPAYE)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right text-rose-600">{fmtKES(m.totalNHIF)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right text-rose-600">{fmtKES(m.totalNSSF)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right text-rose-600">{fmtKES(m.totalAHL)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-emerald-700">{fmtKES(m.totalNet)}</td>
                        <td className="px-3 py-1">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_STYLE[m.status] || STATUS_STYLE.Draft}`}>{m.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50">
                      <td className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">TOTALS</td>
                      <td className="px-3 py-1.5 text-right font-black text-slate-700">—</td>
                      <td className="px-3 py-1.5 text-right font-black text-slate-900">{fmtKES(t.gross)}</td>
                      <td className="px-3 py-1.5 text-right font-black text-rose-700">{fmtKES(t.paye)}</td>
                      <td className="px-3 py-1.5 text-right font-black text-rose-700">{fmtKES(t.nhif)}</td>
                      <td className="px-3 py-1.5 text-right font-black text-rose-700">{fmtKES(t.nssf)}</td>
                      <td className="px-3 py-1.5 text-right font-black text-rose-700">{fmtKES(t.ahl)}</td>
                      <td className="px-3 py-1.5 text-right font-black text-emerald-700">{fmtKES(t.net)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

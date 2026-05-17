import React, { useCallback, useEffect, useState } from 'react';
import { FaMoneyBillWave, FaRedoAlt, FaPrint, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
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
  const [year, setYear]     = useState(currentYear);
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

  const handlePrint = () => {
    const style = document.createElement('style');
    style.id = 'payroll-summary-print-landscape';
    style.textContent = '@page { size: A4 landscape; margin: 10mm 12mm; }';
    document.head.appendChild(style);
    window.print();
    setTimeout(() => document.getElementById('payroll-summary-print-landscape')?.remove(), 1500);
  };

  const t = data?.totals || {};
  const months = data?.months || [];

  const maxGross = Math.max(1, ...months.map((m) => m.totalGross));

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm print-hide">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Reports</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Payroll Summary</h1>
            </div>
            <div className="flex items-center gap-2">
              {/* Year nav */}
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1">
                <button onClick={() => setYear((y) => y - 1)} disabled={year <= currentYear - 5} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                  <FaChevronLeft size={9} />
                </button>
                <span className="min-w-[3rem] text-center text-xs font-black text-slate-900">{year}</span>
                <button onClick={() => setYear((y) => y + 1)} disabled={year >= currentYear} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                  <FaChevronRight size={9} />
                </button>
              </div>
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} />
              </button>
              {months.length > 0 && (
                <button onClick={handlePrint} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23]">
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
                  <div key={label} className={`rounded-lg border ${border} bg-white px-3 py-2 shadow-sm`}>
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                    <div className={`text-sm font-black leading-tight mt-0.5 ${color}`}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Monthly bar chart (screen only) */}
              {months.length > 0 && (
                <div className="print-hide rounded-lg border border-slate-200 bg-white px-4 pt-3 pb-2 shadow-sm">
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
              <div className="print-card overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-[#0B3B2E] text-white">
                      <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Month</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Employees</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Gross</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">PAYE</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">SHA</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">NSSF</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">AHL</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Net Pay</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((m, i) => (
                      <tr key={m.month} className={`border-t border-slate-100 hover:bg-slate-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                        <td className="px-4 py-2.5 font-black text-slate-900">{m.label}</td>
                        <td className="px-3 py-2.5 text-right text-slate-700">{m.employeeCount}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-slate-900">{fmtKES(m.totalGross)}</td>
                        <td className="px-3 py-2.5 text-right text-rose-600">{fmtKES(m.totalPAYE)}</td>
                        <td className="px-3 py-2.5 text-right text-rose-600">{fmtKES(m.totalNHIF)}</td>
                        <td className="px-3 py-2.5 text-right text-rose-600">{fmtKES(m.totalNSSF)}</td>
                        <td className="px-3 py-2.5 text-right text-rose-600">{fmtKES(m.totalAHL)}</td>
                        <td className="px-3 py-2.5 text-right font-black text-emerald-700">{fmtKES(m.totalNet)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${STATUS_STYLE[m.status] || STATUS_STYLE.Draft}`}>{m.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50">
                      <td className="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500">TOTALS</td>
                      <td className="px-3 py-2.5 text-right text-[11px] font-black text-slate-700">—</td>
                      <td className="px-3 py-2.5 text-right text-[11px] font-black text-slate-900">{fmtKES(t.gross)}</td>
                      <td className="px-3 py-2.5 text-right text-[11px] font-black text-rose-700">{fmtKES(t.paye)}</td>
                      <td className="px-3 py-2.5 text-right text-[11px] font-black text-rose-700">{fmtKES(t.nhif)}</td>
                      <td className="px-3 py-2.5 text-right text-[11px] font-black text-rose-700">{fmtKES(t.nssf)}</td>
                      <td className="px-3 py-2.5 text-right text-[11px] font-black text-rose-700">{fmtKES(t.ahl)}</td>
                      <td className="px-3 py-2.5 text-right text-[11px] font-black text-emerald-700">{fmtKES(t.net)}</td>
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

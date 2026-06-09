import React, { useCallback, useEffect, useState } from 'react';
import { FaArrowLeft, FaPrint, FaRedoAlt, FaFileAlt } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const fmtKES = (n) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

const REPORT_TYPES = [
  { key: 'paye', label: 'PAYE (KRA)',        color: 'emerald', desc: 'Monthly PAYE tax deduction schedule for KRA iTax filing' },
  { key: 'nhif', label: 'SHA / NHIF',         color: 'blue',    desc: 'Social Health Authority contributions per employee' },
  { key: 'nssf', label: 'NSSF',              color: 'purple',  desc: 'National Social Security Fund — employee + employer contributions' },
  { key: 'ahl',  label: 'Affd. Housing Levy', color: 'amber',   desc: 'Affordable Housing Levy — employee + employer (1.5% each)' },
  { key: 'bank', label: 'Bank Payment List',  color: 'slate',   desc: 'Net salary payment list for bank bulk upload / M-Pesa bulk' },
];

const COLOR = {
  emerald: { tab: 'border-emerald-600 text-emerald-700 bg-emerald-50', header: 'bg-emerald-700', accent: 'text-emerald-700', total: 'text-emerald-800' },
  blue:    { tab: 'border-blue-600 text-blue-700 bg-blue-50',         header: 'bg-blue-700',    accent: 'text-blue-700',    total: 'text-blue-800' },
  purple:  { tab: 'border-purple-600 text-purple-700 bg-purple-50',   header: 'bg-purple-700',  accent: 'text-purple-700',  total: 'text-purple-800' },
  amber:   { tab: 'border-amber-600 text-amber-700 bg-amber-50',      header: 'bg-amber-700',   accent: 'text-amber-700',   total: 'text-amber-800' },
  slate:   { tab: 'border-slate-600 text-slate-700 bg-slate-50',      header: 'bg-[#0B3B2E]',   accent: 'text-slate-700',   total: 'text-slate-800' },
};

export default function HRRemittance() {
  const navigate   = useNavigate();
  const [periods, setPeriods]     = useState([]);
  const [periodId, setPeriodId]   = useState('');
  const [reportType, setReportType] = useState('paye');
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    adminRequests.get('/hr/reports/periods')
      .then((r) => {
        const list = (r.data || []).filter((p) => p.status !== 'Draft');
        setPeriods(list);
        if (list.length) setPeriodId(String(list[0]._id));
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!periodId) return;
    setLoading(true);
    setData(null);
    try {
      const res = await adminRequests.get(`/hr/reports/remittance/${reportType}`, { params: { periodId } });
      setData(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to load remittance data');
    } finally {
      setLoading(false);
    }
  }, [periodId, reportType]);

  useEffect(() => { load(); }, [load]);

  const period = data?.period;
  const rows   = data?.rows   || [];
  const totals = data?.totals || {};
  const rt     = REPORT_TYPES.find((r) => r.key === reportType) || REPORT_TYPES[0];
  const c      = COLOR[rt.color];

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm print-hide">
          <div className="flex items-center justify-between gap-3 flex-wrap gap-y-2">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/hr/reports/payroll')} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B3B2E] hover:underline">
                <FaArrowLeft size={10} /> Back
              </button>
              <div className="h-4 w-px bg-slate-300" />
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Compliance</div>
                <h1 className="text-sm font-black text-slate-900 leading-tight">Statutory Remittance Reports</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
              >
                {periods.map((p) => (
                  <option key={p._id} value={p._id}>{p.label}</option>
                ))}
              </select>
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={9} />
              </button>
              {data && rows.length > 0 && (
                <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23]">
                  <FaPrint size={9} /> Print
                </button>
              )}
            </div>
          </div>

          {/* Report type tabs */}
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
            {REPORT_TYPES.map((rt2) => (
              <button
                key={rt2.key}
                onClick={() => setReportType(rt2.key)}
                className={`shrink-0 rounded-lg border-b-2 px-3 py-1.5 text-[11px] font-black transition-colors ${
                  reportType === rt2.key ? COLOR[rt2.color].tab : 'border-transparent text-slate-500 hover:bg-slate-50'
                }`}
              >
                {rt2.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {!periodId ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-300">
              <FaFileAlt size={32} />
              <p className="text-sm font-black">No approved payroll periods found</p>
            </div>
          ) : loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading {rt.label} data…</div>
          ) : !data || rows.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
              <FaFileAlt size={24} />
              <p className="text-sm font-semibold">No data for this period</p>
            </div>
          ) : (
            <div className="employee-print-area">
              <PrintLetterhead
                variant="document"
                docLabel={`Human Resource · ${rt.label} Remittance`}
                docTitle={`${rt.label} — ${period?.label || ''}`}
                docMeta={`${rows.length} employee${rows.length !== 1 ? 's' : ''} · For submission to relevant authority`}
              />

              <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden print-card">
                {/* Document header */}
                <div className={`${c.header} px-6 py-4 text-white`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.3em] opacity-70">{rt.label} Remittance Schedule</div>
                      <div className="text-xl font-black mt-0.5">{period?.label}</div>
                      <div className="text-xs opacity-70 mt-0.5">{rt.desc}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-black uppercase tracking-widest opacity-70">Employees</div>
                      <div className="text-2xl font-black">{rows.length}</div>
                    </div>
                  </div>
                </div>

                {/* Table per report type */}
                <div className="overflow-x-auto">
                  {reportType === 'paye' && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b-2 border-slate-200 bg-slate-50">
                          {[['No.','pl-4 text-left'],['Employee Name','text-left'],['KRA PIN','text-left'],['Gross Salary','text-right'],['PAYE Deducted','text-right pr-4 text-rose-600']].map(([h,cls]) => (
                            <th key={h} className={`py-2.5 px-2 text-[9px] font-black uppercase tracking-widest text-slate-500 ${cls}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {rows.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="py-2 pl-4 pr-2 font-mono text-[10px] text-slate-400">{r.employeeNumber}</td>
                            <td className="py-2 px-2 font-black text-slate-900">{r.name}</td>
                            <td className="py-2 px-2 font-mono text-slate-600">{r.kraPin || '—'}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-slate-700">{fmtKES(r.grossSalary)}</td>
                            <td className="py-2 pl-2 pr-4 text-right tabular-nums font-black text-rose-600">{fmtKES(r.paye)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="py-2.5 pl-4 pr-2 text-[10px] font-black uppercase tracking-widest text-slate-500" colSpan={3}>Total</td>
                          <td className="py-2.5 px-2 text-right font-black tabular-nums text-slate-900">{fmtKES(totals.grossSalary)}</td>
                          <td className="py-2.5 pl-2 pr-4 text-right font-black tabular-nums text-rose-700">{fmtKES(totals.paye)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {reportType === 'nhif' && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b-2 border-slate-200 bg-slate-50">
                          {[['No.','pl-4 text-left'],['Employee Name','text-left'],['SHA / NHIF No.','text-left'],['Gross Salary','text-right'],['SHA Contribution','text-right pr-4 text-blue-600']].map(([h,cls]) => (
                            <th key={h} className={`py-2.5 px-2 text-[9px] font-black uppercase tracking-widest text-slate-500 ${cls}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {rows.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="py-2 pl-4 pr-2 font-mono text-[10px] text-slate-400">{r.employeeNumber}</td>
                            <td className="py-2 px-2 font-black text-slate-900">{r.name}</td>
                            <td className="py-2 px-2 font-mono text-slate-600">{r.nhifNo || '—'}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-slate-700">{fmtKES(r.grossSalary)}</td>
                            <td className="py-2 pl-2 pr-4 text-right tabular-nums font-black text-blue-600">{fmtKES(r.employeeContribution)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="py-2.5 pl-4 pr-2 text-[10px] font-black uppercase tracking-widest text-slate-500" colSpan={3}>Total</td>
                          <td className="py-2.5 px-2 text-right font-black tabular-nums text-slate-900">{fmtKES(totals.grossSalary)}</td>
                          <td className="py-2.5 pl-2 pr-4 text-right font-black tabular-nums text-blue-700">{fmtKES(totals.employeeContribution)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {reportType === 'nssf' && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b-2 border-slate-200 bg-slate-50">
                          {[['No.','pl-4 text-left'],['Employee Name','text-left'],['NSSF No.','text-left'],['Gross','text-right'],['Employee','text-right text-purple-600'],['Employer','text-right text-purple-600'],['Total','text-right pr-4 text-purple-700 font-black']].map(([h,cls]) => (
                            <th key={h} className={`py-2.5 px-2 text-[9px] font-black uppercase tracking-widest text-slate-500 ${cls}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {rows.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="py-2 pl-4 pr-2 font-mono text-[10px] text-slate-400">{r.employeeNumber}</td>
                            <td className="py-2 px-2 font-black text-slate-900">{r.name}</td>
                            <td className="py-2 px-2 font-mono text-slate-600">{r.nssfNo || '—'}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-slate-700">{fmtKES(r.grossSalary)}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-purple-600">{fmtKES(r.employeeContribution)}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-purple-600">{fmtKES(r.employerContribution)}</td>
                            <td className="py-2 pl-2 pr-4 text-right tabular-nums font-black text-purple-700">{fmtKES(r.totalContribution)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="py-2.5 pl-4 pr-2 text-[10px] font-black uppercase tracking-widest text-slate-500" colSpan={3}>Total</td>
                          <td className="py-2.5 px-2 text-right font-black tabular-nums text-slate-900">{fmtKES(totals.grossSalary)}</td>
                          <td className="py-2.5 px-2 text-right font-black tabular-nums text-purple-600">{fmtKES(totals.employeeContribution)}</td>
                          <td className="py-2.5 px-2 text-right font-black tabular-nums text-purple-600">{fmtKES(totals.employerContribution)}</td>
                          <td className="py-2.5 pl-2 pr-4 text-right font-black tabular-nums text-purple-800">{fmtKES(totals.totalContribution)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {reportType === 'ahl' && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b-2 border-slate-200 bg-slate-50">
                          {[['No.','pl-4 text-left'],['Employee Name','text-left'],['KRA PIN','text-left'],['Gross','text-right'],['Employee Levy','text-right text-amber-600'],['Employer Levy','text-right text-amber-600'],['Total Levy','text-right pr-4 text-amber-700 font-black']].map(([h,cls]) => (
                            <th key={h} className={`py-2.5 px-2 text-[9px] font-black uppercase tracking-widest text-slate-500 ${cls}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {rows.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="py-2 pl-4 pr-2 font-mono text-[10px] text-slate-400">{r.employeeNumber}</td>
                            <td className="py-2 px-2 font-black text-slate-900">{r.name}</td>
                            <td className="py-2 px-2 font-mono text-slate-600">{r.kraPin || '—'}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-slate-700">{fmtKES(r.grossSalary)}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-amber-600">{fmtKES(r.employeeLevy)}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-amber-600">{fmtKES(r.employerLevy)}</td>
                            <td className="py-2 pl-2 pr-4 text-right tabular-nums font-black text-amber-700">{fmtKES(r.totalLevy)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="py-2.5 pl-4 pr-2 text-[10px] font-black uppercase tracking-widest text-slate-500" colSpan={3}>Total</td>
                          <td className="py-2.5 px-2 text-right font-black tabular-nums text-slate-900">{fmtKES(totals.grossSalary)}</td>
                          <td className="py-2.5 px-2 text-right font-black tabular-nums text-amber-600">{fmtKES(totals.employeeLevy)}</td>
                          <td className="py-2.5 px-2 text-right font-black tabular-nums text-amber-600">{fmtKES(totals.employerLevy)}</td>
                          <td className="py-2.5 pl-2 pr-4 text-right font-black tabular-nums text-amber-800">{fmtKES(totals.totalLevy)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {reportType === 'bank' && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b-2 border-slate-200 bg-slate-50">
                          {[['No.','pl-4 text-left'],['Employee Name','text-left'],['Method','text-left'],['Bank / Provider','text-left'],['Account / Number','text-left'],['Branch','text-left'],['Net Pay','text-right pr-4 text-emerald-700 font-black']].map(([h,cls]) => (
                            <th key={h} className={`py-2.5 px-2 text-[9px] font-black uppercase tracking-widest text-slate-500 ${cls}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {rows.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="py-2 pl-4 pr-2 font-mono text-[10px] text-slate-400">{r.employeeNumber}</td>
                            <td className="py-2 px-2 font-black text-slate-900">{r.name}</td>
                            <td className="py-2 px-2 text-slate-600">{r.paymentMethod || '—'}</td>
                            <td className="py-2 px-2 text-slate-600">{r.bankName || r.mpesaNumber ? 'M-Pesa' : '—'}</td>
                            <td className="py-2 px-2 font-mono text-slate-700">{r.bankAccountNumber || r.mpesaNumber || '—'}</td>
                            <td className="py-2 px-2 text-slate-500">{r.bankBranch || '—'}</td>
                            <td className="py-2 pl-2 pr-4 text-right tabular-nums font-black text-emerald-700">{fmtKES(r.netSalary)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="py-2.5 pl-4 pr-2 text-[10px] font-black uppercase tracking-widest text-slate-500" colSpan={6}>Total Net Pay</td>
                          <td className="py-2.5 pl-2 pr-4 text-right font-black tabular-nums text-emerald-800">{fmtKES(totals.netSalary)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>

                <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[9px] text-slate-400">
                  <span>Computer-generated statutory remittance schedule — verify before submission.</span>
                  <span>Printed: {new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

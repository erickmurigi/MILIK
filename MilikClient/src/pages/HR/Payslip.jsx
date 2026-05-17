import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaArrowLeft, FaPrint, FaRedoAlt } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const fmtKES = (n) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const fmtPeriod = (p) =>
  p ? `${MONTH_NAMES[p.month] || ''} ${p.year}` : '—';

const EarningRow = ({ label, amount, bold }) => (
  <tr>
    <td className={`py-1.5 pr-4 ${bold ? 'font-black text-slate-900' : 'font-semibold text-slate-700'}`}>{label}</td>
    <td className={`py-1.5 text-right tabular-nums ${bold ? 'font-black text-slate-900' : 'text-slate-700'}`}>{fmtKES(amount)}</td>
  </tr>
);

const DeductionRow = ({ label, amount, bold }) => (
  <tr>
    <td className={`py-1.5 pr-4 ${bold ? 'font-black text-slate-900' : 'font-semibold text-slate-700'}`}>{label}</td>
    <td className={`py-1.5 text-right tabular-nums ${bold ? 'font-black text-rose-700' : 'text-rose-600'}`}>{fmtKES(amount)}</td>
  </tr>
);

export default function Payslip() {
  const { periodId, payslipId } = useParams();
  const navigate = useNavigate();
  const [payslip, setPayslip] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequests.get(`/hr/payroll/payslips/${payslipId}`);
      setPayslip(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to load payslip');
    } finally {
      setLoading(false);
    }
  }, [payslipId]);

  useEffect(() => { load(); }, [load]);

  const ps = payslip;
  const period = ps?.payrollPeriod;
  const snap = ps?.snapshot || {};

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header (screen only) */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm print-hide">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(`/hr/payroll/${periodId}`)} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B3B2E] hover:underline">
                <FaArrowLeft size={10} /> Back
              </button>
              <div className="h-4 w-px bg-slate-300" />
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Payslip</div>
                <h1 className="text-sm font-black text-slate-900 leading-tight">{snap.name || 'Loading…'} — {fmtPeriod(period)}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={9} />
              </button>
              <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23]">
                <FaPrint size={9} /> Print Payslip
              </button>
            </div>
          </div>
        </div>

        {/* Payslip content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading payslip…</div>
          ) : !ps ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Payslip not found.</div>
          ) : (
            <div className="employee-print-area">
              <div className="mx-auto max-w-2xl">
              {/* Company letterhead — always part of the document */}
              <PrintLetterhead
                variant="document"
                docLabel="Human Resource · Pay Slip"
                docTitle={`${snap.name || ''} — ${fmtPeriod(period)}`}
                printedDate={false}
              />

              {/* Payslip document */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden print-card">

                {/* Document header */}
                <div className="bg-[#0B3B2E] px-8 py-5 text-white">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">Pay Slip</div>
                      <div className="text-2xl font-black mt-0.5">{fmtPeriod(period)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Employee No.</div>
                      <div className="text-xl font-black">{snap.employeeNumber}</div>
                      <div className="mt-1 text-[10px] font-semibold text-emerald-200 capitalize">
                        {period?.status}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Employee identity strip */}
                <div className="border-b border-slate-100 bg-slate-50 px-8 py-4">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Employee Name</div>
                      <div className="text-sm font-black text-slate-900">{snap.name}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Department</div>
                      <div className="text-sm font-semibold text-slate-700">{snap.department || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Designation</div>
                      <div className="text-sm font-semibold text-slate-700">{snap.designation || '—'}</div>
                    </div>
                    {snap.kraPin && (
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">KRA PIN</div>
                        <div className="text-xs font-mono font-semibold text-slate-700">{snap.kraPin}</div>
                      </div>
                    )}
                    {snap.nhifNo && (
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">SHA No.</div>
                        <div className="text-xs font-mono font-semibold text-slate-700">{snap.nhifNo}</div>
                      </div>
                    )}
                    {snap.nssfNo && (
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">NSSF No.</div>
                        <div className="text-xs font-mono font-semibold text-slate-700">{snap.nssfNo}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Earnings & Deductions */}
                <div className="grid grid-cols-2 divide-x divide-slate-100 px-0">

                  {/* Earnings */}
                  <div className="px-8 py-5">
                    <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-emerald-700">Earnings</div>
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-slate-50">
                        <EarningRow label="Basic Salary" amount={ps.basicSalary} />
                        {(ps.allowances || []).map((a, i) => (
                          <EarningRow key={i} label={a.name} amount={a.amount} />
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-200">
                          <td className="pt-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Gross Salary</td>
                          <td className="pt-2 text-right font-black text-slate-900 tabular-nums">{fmtKES(ps.grossSalary)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Deductions */}
                  <div className="px-8 py-5">
                    <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-rose-600">Deductions</div>
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-slate-50">
                        <DeductionRow label="PAYE (Tax)"             amount={ps.paye} />
                        <DeductionRow label="SHA / NHIF"             amount={ps.nhif} />
                        <DeductionRow label="NSSF"                   amount={ps.nssf} />
                        <DeductionRow label="Housing Levy (AHL)"     amount={ps.ahl} />
                        {(ps.otherDeductions || []).map((d, i) => (
                          <DeductionRow key={i} label={d.name} amount={d.amount} />
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-200">
                          <td className="pt-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Total Deductions</td>
                          <td className="pt-2 text-right font-black text-rose-700 tabular-nums">{fmtKES(ps.totalDeductions)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Net Pay banner */}
                <div className="border-t-2 border-slate-200 bg-[#0B3B2E] px-8 py-4">
                  <div className="flex items-center justify-between text-white">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">Net Pay</div>
                      <div className="text-3xl font-black mt-0.5">{fmtKES(ps.netSalary)}</div>
                    </div>
                    {snap.paymentMethod && (
                      <div className="text-right text-emerald-200 text-xs space-y-0.5">
                        <div className="font-black text-white">{snap.paymentMethod}</div>
                        {snap.bankName && <div>{snap.bankName}</div>}
                        {snap.bankAccountNumber && <div className="font-mono">{snap.bankAccountNumber}</div>}
                        {snap.mpesaNumber && <div className="font-mono">{snap.mpesaNumber}</div>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="px-8 py-3 bg-slate-50 border-t border-slate-100">
                  <div className="flex items-center justify-between text-[9px] text-slate-400">
                    <span>This is a computer-generated payslip and requires no signature.</span>
                    <span>Generated: {new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                  </div>
                </div>
              </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

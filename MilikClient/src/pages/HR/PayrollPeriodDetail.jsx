import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FaArrowLeft, FaRedoAlt, FaPlay, FaCheck, FaHandHolding,
  FaMoneyBillWave, FaUsers, FaFileAlt, FaPrint,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const STATUS_STYLE = {
  Draft:      'border-slate-200 bg-slate-50 text-slate-600',
  Processing: 'border-amber-200 bg-amber-50 text-amber-700',
  Approved:   'border-blue-200 bg-blue-50 text-blue-700',
  Paid:       'border-emerald-200 bg-emerald-50 text-emerald-700',
  Closed:     'border-rose-200 bg-rose-50 text-rose-600',
};

const fmtKES = (n) =>
  n != null ? `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : '—';

function StatCard({ label, value, sub, color = 'text-slate-900', border = 'border-slate-200' }) {
  return (
    <div className={`rounded-xl border ${border} bg-white p-4 shadow-sm`}>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`text-xl font-black leading-tight mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function PayrollPeriodDetail() {
  const { periodId } = useParams();
  const navigate = useNavigate();
  const [period, setPeriod]   = useState(null);
  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [confirm, setConfirm] = useState({ isOpen: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequests.get(`/hr/payroll/periods/${periodId}/payslips`);
      setPeriod(res.data.period);
      setPayslips(res.data.payslips || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to load payroll data');
    } finally {
      setLoading(false);
    }
  }, [periodId]);

  useEffect(() => { load(); }, [load]);

  const runPayroll = async () => {
    setRunning(true);
    try {
      const res = await adminRequests.post(`/hr/payroll/periods/${periodId}/run`);
      toast.success(res.data.message || 'Payroll run complete');
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to run payroll');
    } finally {
      setRunning(false);
    }
  };

  const approve = () => {
    setConfirm({
      isOpen: true, title: 'Approve Payroll',
      message: `Approve payroll for ${period?.label}? This will lock all payslips.`,
      isDangerous: false, confirmText: 'Approve',
      onConfirm: async () => {
        try {
          await adminRequests.patch(`/hr/payroll/periods/${periodId}/approve`);
          toast.success('Payroll approved');
          load();
        } catch (e) {
          toast.error(e?.response?.data?.message || 'Failed to approve');
        } finally {
          setConfirm((p) => ({ ...p, isOpen: false }));
        }
      },
    });
  };

  const markPaid = () => {
    setConfirm({
      isOpen: true, title: 'Mark as Paid',
      message: `Mark ${period?.label} payroll as paid?`,
      isDangerous: false, confirmText: 'Mark Paid',
      onConfirm: async () => {
        try {
          await adminRequests.patch(`/hr/payroll/periods/${periodId}/mark-paid`);
          toast.success('Payroll marked as paid');
          load();
        } catch (e) {
          toast.error(e?.response?.data?.message || 'Failed to mark as paid');
        } finally {
          setConfirm((p) => ({ ...p, isOpen: false }));
        }
      },
    });
  };

  const isDraft    = period?.status === 'Draft' || period?.status === 'Processing';
  const isApproved = period?.status === 'Approved';

  const handlePrint = () => {
    const style = document.createElement('style');
    style.id = 'payroll-print-landscape';
    style.textContent = '@page { size: A4 landscape; margin: 10mm 12mm; }';
    document.head.appendChild(style);
    window.print();
    setTimeout(() => document.getElementById('payroll-print-landscape')?.remove(), 1500);
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/hr/payroll')} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B3B2E] hover:underline">
                <FaArrowLeft size={10} /> Back
              </button>
              <div className="h-4 w-px bg-slate-300" />
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Payroll</div>
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-black text-slate-900 leading-tight">{period?.label || 'Loading…'}</h1>
                  {period && <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${STATUS_STYLE[period.status] || STATUS_STYLE.Draft}`}>{period.status}</span>}
                </div>
              </div>
            </div>
            {period && (
              <div className="flex items-center gap-2">
                <button onClick={load} className="print-hide inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <FaRedoAlt size={9} />
                </button>
                {payslips.length > 0 && (
                  <button onClick={handlePrint} className="print-hide inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                    <FaPrint size={9} /> Print Register
                  </button>
                )}
                {isDraft && (
                  <button onClick={runPayroll} disabled={running} className="print-hide inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23] disabled:opacity-50">
                    <FaPlay size={9} /> {running ? 'Running…' : period.employeeCount > 0 ? 'Re-run Payroll' : 'Run Payroll'}
                  </button>
                )}
                {period.status === 'Draft' && period.employeeCount > 0 && (
                  <button onClick={approve} className="print-hide inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-black text-white hover:bg-blue-700">
                    <FaCheck size={9} /> Approve
                  </button>
                )}
                {isApproved && (
                  <button onClick={markPaid} className="print-hide inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700">
                    <FaHandHolding size={9} /> Mark Paid
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading…</div>
          ) : !period ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Period not found.</div>
          ) : (
            <div className="employee-print-area space-y-4">

              <PrintLetterhead
                variant="print"
                docLabel="Human Resource · Payroll Register"
                docTitle={period?.label}
                docMeta={`Status: ${period?.status} · ${payslips.length} employee${payslips.length !== 1 ? 's' : ''}`}
              />

              {/* Summary cards */}
              <div className="print-card grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Employees" value={period.employeeCount} border="border-slate-200" />
                <StatCard label="Total Gross" value={fmtKES(period.totalGross)} color="text-slate-900" />
                <StatCard label="Total Deductions" value={fmtKES(period.totalDeductions)} color="text-rose-600" border="border-rose-100" />
                <StatCard label="Net Pay" value={fmtKES(period.totalNet)} color="text-emerald-700" border="border-emerald-200" />
              </div>

              {/* Statutory breakdown */}
              {period.totalGross > 0 && (
                <div className="print-card grid grid-cols-4 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">PAYE</div>
                    <div className="text-sm font-black text-rose-600">{fmtKES(period.totalPAYE)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">SHA / NHIF</div>
                    <div className="text-sm font-black text-rose-600">{fmtKES(period.totalNHIF)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">NSSF</div>
                    <div className="text-sm font-black text-rose-600">{fmtKES(period.totalNSSF)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Housing Levy</div>
                    <div className="text-sm font-black text-rose-600">{fmtKES(period.totalAHL)}</div>
                  </div>
                </div>
              )}

              {/* Payslips table */}
              {payslips.length === 0 ? (
                <div className="print-hide flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white text-slate-400">
                  <FaUsers size={24} />
                  <p className="text-sm font-semibold">No payslips generated yet</p>
                  <p className="text-xs">Click "Run Payroll" to calculate payslips for all active employees</p>
                </div>
              ) : (
                <div className="print-card overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="bg-[#0B3B2E] text-white">
                        <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Employee</th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Basic</th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Gross</th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">PAYE</th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">SHA</th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">NSSF</th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">AHL</th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Net Pay</th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Status</th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Payslip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payslips.map((ps, idx) => (
                        <tr key={ps._id} className={`border-t border-slate-100 hover:bg-slate-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                          <td className="px-4 py-2.5">
                            <div className="font-black text-slate-900">{ps.snapshot.name}</div>
                            <div className="text-[10px] text-slate-400">{ps.snapshot.employeeNumber} · {ps.snapshot.department || '—'}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-700">{fmtKES(ps.basicSalary)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-slate-900">{fmtKES(ps.grossSalary)}</td>
                          <td className="px-3 py-2.5 text-right text-rose-600">{fmtKES(ps.paye)}</td>
                          <td className="px-3 py-2.5 text-right text-rose-600">{fmtKES(ps.nhif)}</td>
                          <td className="px-3 py-2.5 text-right text-rose-600">{fmtKES(ps.nssf)}</td>
                          <td className="px-3 py-2.5 text-right text-rose-600">{fmtKES(ps.ahl)}</td>
                          <td className="px-3 py-2.5 text-right font-black text-emerald-700">{fmtKES(ps.netSalary)}</td>
                          <td className="px-3 py-2.5">
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${STATUS_STYLE[ps.status] || STATUS_STYLE.Draft}`}>
                              {ps.status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right print-hide">
                            <button
                              onClick={() => navigate(`/hr/payroll/${periodId}/payslip/${ps._id}`)}
                              className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700 hover:bg-indigo-100"
                            >
                              <FaFileAlt size={8} /> View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-50">
                        <td className="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500">TOTALS</td>
                        <td className="px-3 py-2.5 text-right text-[11px] font-black text-slate-700">{fmtKES(period.totalBasic)}</td>
                        <td className="px-3 py-2.5 text-right text-[11px] font-black text-slate-900">{fmtKES(period.totalGross)}</td>
                        <td className="px-3 py-2.5 text-right text-[11px] font-black text-rose-700">{fmtKES(period.totalPAYE)}</td>
                        <td className="px-3 py-2.5 text-right text-[11px] font-black text-rose-700">{fmtKES(period.totalNHIF)}</td>
                        <td className="px-3 py-2.5 text-right text-[11px] font-black text-rose-700">{fmtKES(period.totalNSSF)}</td>
                        <td className="px-3 py-2.5 text-right text-[11px] font-black text-rose-700">{fmtKES(period.totalAHL)}</td>
                        <td className="px-3 py-2.5 text-right text-[11px] font-black text-emerald-700">{fmtKES(period.totalNet)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))} />
    </DashboardLayout>
  );
}

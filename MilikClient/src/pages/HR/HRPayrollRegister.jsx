import React, { useCallback, useEffect, useState } from 'react';
import { FaArrowLeft, FaPrint, FaRedoAlt, FaFileAlt } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const fmtKES = (n) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

const STATUS_STYLE = {
  Draft:    'text-slate-400',
  Approved: 'text-blue-600',
  Paid:     'text-emerald-600',
};

export default function HRPayrollRegister() {
  const navigate = useNavigate();
  const [periods, setPeriods]   = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    adminRequests.get('/hr/reports/periods')
      .then((r) => {
        const list = r.data || [];
        setPeriods(list);
        if (list.length) setPeriodId(String(list[0]._id));
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!periodId) return;
    setLoading(true);
    try {
      const res = await adminRequests.get('/hr/reports/payroll-register', { params: { periodId } });
      setData(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to load payroll register');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [periodId]);

  useEffect(() => { load(); }, [load]);

  const period = data?.period;
  const rows   = data?.rows || [];
  const totals = data?.totals || {};

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm print-hide">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/hr/payroll')} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B3B2E] hover:underline">
                <FaArrowLeft size={10} /> Back
              </button>
              <div className="h-4 w-px bg-slate-300" />
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Payroll</div>
                <h1 className="text-sm font-black text-slate-900 leading-tight">Payroll Register</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] print-hide"
              >
                {periods.map((p) => (
                  <option key={p._id} value={p._id}>{p.label}</option>
                ))}
              </select>
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 print-hide">
                <FaRedoAlt size={9} />
              </button>
              {data && rows.length > 0 && (
                <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23] print-hide">
                  <FaPrint size={9} /> Print Register
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {!periodId ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-300">
              <FaFileAlt size={32} />
              <p className="text-sm font-black">No payroll periods found</p>
            </div>
          ) : loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading payroll register…</div>
          ) : !data || rows.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
              <FaFileAlt size={24} />
              <p className="text-sm font-semibold">No payslips found for this period</p>
            </div>
          ) : (
            <div className="employee-print-area">
              <PrintLetterhead
                variant="document"
                docLabel="Human Resource · Payroll Register"
                docTitle={period?.label || ''}
                docMeta={`${rows.length} employee${rows.length !== 1 ? 's' : ''} · Status: ${period?.status || ''}`}
              />

              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-5 print-hide">
                {[
                  { label: 'Employees',       value: rows.length,               cls: 'text-slate-900' },
                  { label: 'Total Gross',      value: fmtKES(totals.grossSalary),  cls: 'text-slate-900' },
                  { label: 'Total Deductions', value: fmtKES(totals.totalDeductions), cls: 'text-rose-600' },
                  { label: 'Total Net Pay',    value: fmtKES(totals.netSalary),    cls: 'text-emerald-700' },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{c.label}</div>
                    <div className={`text-sm font-black mt-0.5 ${c.cls}`}>{c.value}</div>
                  </div>
                ))}
              </div>

              {/* Register table */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden print-card">
                <div className="bg-[#0B3B2E] px-6 py-4 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">Payroll Register</div>
                      <div className="text-xl font-black mt-0.5">{period?.label}</div>
                    </div>
                    <div className="text-right text-emerald-200 text-xs">
                      <div className="font-black text-white text-sm">{rows.length} Employees</div>
                      <div className={STATUS_STYLE[period?.status] || 'text-emerald-200'}>{period?.status}</div>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b-2 border-slate-200 bg-slate-50">
                        {[
                          ['No.',          'text-left  pl-4'],
                          ['Employee',     'text-left'],
                          ['Dept',         'text-left'],
                          ['Basic',        'text-right'],
                          ['Allowances',   'text-right'],
                          ['Gross',        'text-right font-black text-slate-700'],
                          ['PAYE',         'text-right text-rose-600'],
                          ['SHA',          'text-right text-rose-500'],
                          ['NSSF',         'text-right text-rose-500'],
                          ['AHL',          'text-right text-rose-500'],
                          ['Other Deduct', 'text-right text-rose-500'],
                          ['Total Deduct', 'text-right text-rose-700 font-black'],
                          ['Net Pay',      'text-right text-emerald-700 font-black pr-4'],
                        ].map(([h, cls]) => (
                          <th key={h} className={`py-2.5 px-2 text-[9px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap ${cls}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {rows.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="py-2 pl-4 pr-2 font-mono text-[10px] text-slate-400 whitespace-nowrap">{r.employeeNumber}</td>
                          <td className="py-2 px-2 whitespace-nowrap">
                            <div className="font-black text-slate-900">{r.name}</div>
                            <div className="text-[9px] text-slate-400">{r.designation}</div>
                          </td>
                          <td className="py-2 px-2 text-slate-600 whitespace-nowrap">{r.department}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-slate-700">{fmtKES(r.basicSalary)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-slate-600">{fmtKES(r.allowancesTotal)}</td>
                          <td className="py-2 px-2 text-right tabular-nums font-black text-slate-900">{fmtKES(r.grossSalary)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-rose-600">{fmtKES(r.paye)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-rose-500">{fmtKES(r.nhif)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-rose-500">{fmtKES(r.nssf)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-rose-500">{fmtKES(r.ahl)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-rose-500">{fmtKES(r.otherDeductionsTotal)}</td>
                          <td className="py-2 px-2 text-right tabular-nums font-black text-rose-700">{fmtKES(r.totalDeductions)}</td>
                          <td className="py-2 pl-2 pr-4 text-right tabular-nums font-black text-emerald-700">{fmtKES(r.netSalary)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-50">
                        <td className="py-2.5 pl-4 pr-2 text-[10px] font-black uppercase tracking-widest text-slate-500" colSpan={3}>Totals</td>
                        <td className="py-2.5 px-2 text-right font-black tabular-nums text-slate-900">{fmtKES(totals.basicSalary)}</td>
                        <td className="py-2.5 px-2 text-right font-black tabular-nums text-slate-700">{fmtKES(totals.allowancesTotal)}</td>
                        <td className="py-2.5 px-2 text-right font-black tabular-nums text-slate-900">{fmtKES(totals.grossSalary)}</td>
                        <td className="py-2.5 px-2 text-right font-black tabular-nums text-rose-700">{fmtKES(totals.paye)}</td>
                        <td className="py-2.5 px-2 text-right font-black tabular-nums text-rose-600">{fmtKES(totals.nhif)}</td>
                        <td className="py-2.5 px-2 text-right font-black tabular-nums text-rose-600">{fmtKES(totals.nssf)}</td>
                        <td className="py-2.5 px-2 text-right font-black tabular-nums text-rose-600">{fmtKES(totals.ahl)}</td>
                        <td className="py-2.5 px-2 text-right font-black tabular-nums text-rose-600">{fmtKES(totals.otherDeductionsTotal)}</td>
                        <td className="py-2.5 px-2 text-right font-black tabular-nums text-rose-800">{fmtKES(totals.totalDeductions)}</td>
                        <td className="py-2.5 pl-2 pr-4 text-right font-black tabular-nums text-emerald-800">{fmtKES(totals.netSalary)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[9px] text-slate-400">
                  <span>This is a computer-generated payroll register.</span>
                  <span>Printed: {new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
              </div>

              {/* Payment summary by method — print only */}
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white shadow overflow-hidden print-card">
                <div className="border-b border-slate-100 px-6 py-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Net Pay Summary by Payment Method</div>
                </div>
                <div className="px-6 py-4">
                  {(() => {
                    const byMethod = rows.reduce((acc, r) => {
                      const key = r.paymentMethod || 'Unspecified';
                      acc[key] = (acc[key] || 0) + r.netSalary;
                      return acc;
                    }, {});
                    return (
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-slate-50">
                          {Object.entries(byMethod).map(([method, total]) => (
                            <tr key={method}>
                              <td className="py-2 font-semibold text-slate-700">{method}</td>
                              <td className="py-2 text-right font-black text-slate-900 tabular-nums">{fmtKES(total)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-200">
                            <td className="pt-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Total Net Pay</td>
                            <td className="pt-2 text-right font-black text-emerald-700 tabular-nums">{fmtKES(totals.netSalary)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

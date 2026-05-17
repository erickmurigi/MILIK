import React, { useCallback, useEffect, useState } from 'react';
import { FaFileAlt, FaRedoAlt, FaPrint, FaSearch } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
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
  const [search, setSearch] = useState('');

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

  const handlePrint = () => window.print();

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase();
    return !q || `${e.surname} ${e.otherNames}`.toLowerCase().includes(q) || (e.employeeNumber || '').toLowerCase().includes(q);
  });

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
                  className="h-7 w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-3 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
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
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b-2 border-slate-200">
                            <th className="pb-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Month</th>
                            <th className="pb-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Gross</th>
                            <th className="pb-2 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Personal Relief</th>
                            <th className="pb-2 text-right text-[10px] font-black uppercase tracking-widest text-rose-500">PAYE</th>
                            <th className="pb-2 text-right text-[10px] font-black uppercase tracking-widest text-rose-400">SHA</th>
                            <th className="pb-2 text-right text-[10px] font-black uppercase tracking-widest text-rose-400">NSSF</th>
                            <th className="pb-2 text-right text-[10px] font-black uppercase tracking-widest text-rose-400">AHL</th>
                            <th className="pb-2 text-right text-[10px] font-black uppercase tracking-widest text-emerald-600">Net Pay</th>
                            <th className="pb-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {months.map((m) => (
                            <tr key={m.month} className="hover:bg-slate-50">
                              <td className="py-2 font-black text-slate-900">{m.label}</td>
                              <td className="py-2 text-right text-slate-700">{fmtKES(m.grossSalary)}</td>
                              <td className="py-2 text-right text-emerald-600">({fmtKES(m.personalRelief)})</td>
                              <td className="py-2 text-right font-semibold text-rose-600">{fmtKES(m.paye)}</td>
                              <td className="py-2 text-right text-rose-500">{fmtKES(m.nhif)}</td>
                              <td className="py-2 text-right text-rose-500">{fmtKES(m.nssf)}</td>
                              <td className="py-2 text-right text-rose-500">{fmtKES(m.ahl)}</td>
                              <td className="py-2 text-right font-black text-emerald-700">{fmtKES(m.netSalary)}</td>
                              <td className="py-2 text-center text-[9px] font-black">
                                <span className={STATUS_STYLE[m.status] || 'text-slate-400'}>{m.status}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-300">
                            <td className="pt-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500">Annual Total</td>
                            <td className="pt-2.5 text-right font-black text-slate-900">{fmtKES(totals.grossSalary)}</td>
                            <td className="pt-2.5 text-right font-black text-emerald-600">({fmtKES(totals.personalRelief)})</td>
                            <td className="pt-2.5 text-right font-black text-rose-700">{fmtKES(totals.paye)}</td>
                            <td className="pt-2.5 text-right font-black text-rose-600">{fmtKES(totals.nhif)}</td>
                            <td className="pt-2.5 text-right font-black text-rose-600">{fmtKES(totals.nssf)}</td>
                            <td className="pt-2.5 text-right font-black text-rose-600">{fmtKES(totals.ahl)}</td>
                            <td className="pt-2.5 text-right font-black text-emerald-700">{fmtKES(totals.netSalary)}</td>
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

import React, { useCallback, useEffect, useState } from 'react';
import { FaArrowLeft, FaPrint, FaRedoAlt, FaFileAlt, FaEnvelope } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import EmailSendModal from '../../components/HR/EmailSendModal';
import { selectCurrentCompany } from '../../redux/selectors';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';
import { printTabularList } from '../../utils/printKit';

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
  const [showEmail, setShowEmail] = useState(false);

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

  const company = useSelector(selectCurrentCompany) || {};

  const printRemittance = useCallback(() => {
    if (!rows.length) return;
    const k = fmtKES;
    const base = [
      { label: 'Emp No.', key: 'employeeNumber' },
      { label: 'Employee Name', key: 'name', bold: true },
    ];
    const num = (label, fn, tone, bold) => ({ label, align: 'right', value: fn, tone: tone ? () => tone : undefined, bold });
    let columns; let totalsRow;
    if (reportType === 'paye') {
      columns = [...base, { label: 'KRA PIN', value: (r) => r.kraPin || '—' }, num('Gross Salary', (r) => k(r.grossSalary)), num('PAYE Deducted', (r) => k(r.paye), 'neg', true)];
      totalsRow = ['Total', '', '', k(totals.grossSalary), k(totals.paye)];
    } else if (reportType === 'nhif') {
      columns = [...base, { label: 'SHA / NHIF No.', value: (r) => r.nhifNo || '—' }, num('Gross Salary', (r) => k(r.grossSalary)), num('SHA Contribution', (r) => k(r.employeeContribution), null, true)];
      totalsRow = ['Total', '', '', k(totals.grossSalary), k(totals.employeeContribution)];
    } else if (reportType === 'nssf') {
      columns = [...base, { label: 'NSSF No.', value: (r) => r.nssfNo || '—' }, num('Gross', (r) => k(r.grossSalary)), num('Employee', (r) => k(r.employeeContribution)), num('Employer', (r) => k(r.employerContribution)), num('Total', (r) => k(r.totalContribution), null, true)];
      totalsRow = ['Total', '', '', k(totals.grossSalary), k(totals.employeeContribution), k(totals.employerContribution), k(totals.totalContribution)];
    } else if (reportType === 'ahl') {
      columns = [...base, { label: 'KRA PIN', value: (r) => r.kraPin || '—' }, num('Gross', (r) => k(r.grossSalary)), num('Emp Levy', (r) => k(r.employeeLevy)), num('Empr Levy', (r) => k(r.employerLevy)), num('Total Levy', (r) => k(r.totalLevy), null, true)];
      totalsRow = ['Total', '', '', k(totals.grossSalary), k(totals.employeeLevy), k(totals.employerLevy), k(totals.totalLevy)];
    } else {
      columns = [
        ...base,
        { label: 'Method', value: (r) => r.paymentMethod || '—' },
        { label: 'Bank / Provider', value: (r) => r.bankName || (r.mpesaNumber ? 'M-Pesa' : '—') },
        { label: 'Account / Number', value: (r) => r.bankAccountNumber || r.mpesaNumber || '—' },
        { label: 'Branch', value: (r) => r.bankBranch || '—' },
        num('Net Pay', (r) => k(r.netSalary), 'pos', true),
      ];
      totalsRow = ['Total Net Pay', '', '', '', '', '', k(totals.netSalary)];
    }
    const printed = printTabularList({
      title: `${rt.label} — ${period?.label || ''}`,
      subtitle: `Human Resource · ${rt.label} Remittance · ${rt.desc}`,
      company,
      summaryItems: [['Period', period?.label || '—'], ['Employees', rows.length]],
      columns,
      rows,
      totalsRow,
      notes: ['Computer-generated statutory remittance — verify before submission.'],
    });
    if (!printed) toast.error('Pop-up blocked — allow pop-ups for this site to print');
  }, [rows, totals, period, rt, reportType, company]);

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
              <AppSelect
                value={periodId}
                onChange={(v) => setPeriodId(v ?? '')}
                options={periods.map((p) => ({ value: p._id, label: p.label }))}
                placeholder="Select period…"
                searchable
                size="sm"
              />
              <button onClick={load} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={9} />
              </button>
              {data && rows.length > 0 && (
                <>
                  <button onClick={() => setShowEmail(true)} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    <FaEnvelope size={9} /> Email
                  </button>
                  <button onClick={printRemittance} className="inline-flex h-7 items-center gap-1.5 rounded bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0a2e23]">
                    <FaPrint size={9} /> Print
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Report type tabs */}
          <div className="mt-2 flex items-center gap-1 overflow-x-auto">
            {REPORT_TYPES.map((rt2) => (
              <button
                key={rt2.key}
                onClick={() => setReportType(rt2.key)}
                className={`h-[20px] shrink-0 inline-flex items-center px-1.5 text-[9px] font-bold whitespace-nowrap ${
                  reportType === rt2.key
                    ? 'bg-[#0B3B2E] text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
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
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-[#0B3B2E] text-white">
                          {[['No.','pl-4 text-left'],['Employee Name','text-left'],['KRA PIN','text-left'],['Gross Salary','text-right'],['PAYE Deducted','text-right pr-4 text-rose-600']].map(([h,cls]) => (
                            <th key={h} className={`py-1 px-2 font-bold border-r border-white/10 whitespace-nowrap ${cls.includes('text-left') ? 'text-left' : 'text-right'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                            <td className="py-1 px-2 font-mono text-[10px] text-slate-400 border-r border-gray-100">{r.employeeNumber}</td>
                            <td className="py-1 px-2 font-black text-slate-900 border-r border-gray-100">{r.name}</td>
                            <td className="py-1 px-2 font-mono text-slate-600 border-r border-gray-100">{r.kraPin || '—'}</td>
                            <td className="py-1 px-2 text-right tabular-nums text-slate-700 border-r border-gray-100">{fmtKES(r.grossSalary)}</td>
                            <td className="py-1 px-2 text-right tabular-nums font-black text-rose-600">{fmtKES(r.paye)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="py-1.5 px-2 text-[10px] font-black uppercase tracking-widest text-slate-500" colSpan={3}>Total</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-slate-900">{fmtKES(totals.grossSalary)}</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-rose-700">{fmtKES(totals.paye)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {reportType === 'nhif' && (
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-[#0B3B2E] text-white">
                          {[['No.','pl-4 text-left'],['Employee Name','text-left'],['SHA / NHIF No.','text-left'],['Gross Salary','text-right'],['SHA Contribution','text-right pr-4 text-blue-600']].map(([h,cls]) => (
                            <th key={h} className={`py-1 px-2 font-bold border-r border-white/10 whitespace-nowrap ${cls.includes('text-left') ? 'text-left' : 'text-right'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                            <td className="py-1 px-2 font-mono text-[10px] text-slate-400 border-r border-gray-100">{r.employeeNumber}</td>
                            <td className="py-1 px-2 font-black text-slate-900 border-r border-gray-100">{r.name}</td>
                            <td className="py-1 px-2 font-mono text-slate-600 border-r border-gray-100">{r.nhifNo || '—'}</td>
                            <td className="py-1 px-2 text-right tabular-nums text-slate-700 border-r border-gray-100">{fmtKES(r.grossSalary)}</td>
                            <td className="py-1 px-2 text-right tabular-nums font-black text-blue-600">{fmtKES(r.employeeContribution)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="py-1.5 px-2 text-[10px] font-black uppercase tracking-widest text-slate-500" colSpan={3}>Total</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-slate-900">{fmtKES(totals.grossSalary)}</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-blue-700">{fmtKES(totals.employeeContribution)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {reportType === 'nssf' && (
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-[#0B3B2E] text-white">
                          {[['No.','pl-4 text-left'],['Employee Name','text-left'],['NSSF No.','text-left'],['Gross','text-right'],['Employee','text-right text-purple-600'],['Employer','text-right text-purple-600'],['Total','text-right pr-4 text-purple-700 font-black']].map(([h,cls]) => (
                            <th key={h} className={`py-1 px-2 font-bold border-r border-white/10 whitespace-nowrap ${cls.includes('text-left') ? 'text-left' : 'text-right'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                            <td className="py-1 px-2 font-mono text-[10px] text-slate-400 border-r border-gray-100">{r.employeeNumber}</td>
                            <td className="py-1 px-2 font-black text-slate-900 border-r border-gray-100">{r.name}</td>
                            <td className="py-1 px-2 font-mono text-slate-600 border-r border-gray-100">{r.nssfNo || '—'}</td>
                            <td className="py-1 px-2 text-right tabular-nums text-slate-700 border-r border-gray-100">{fmtKES(r.grossSalary)}</td>
                            <td className="py-1 px-2 text-right tabular-nums text-purple-600 border-r border-gray-100">{fmtKES(r.employeeContribution)}</td>
                            <td className="py-1 px-2 text-right tabular-nums text-purple-600 border-r border-gray-100">{fmtKES(r.employerContribution)}</td>
                            <td className="py-1 px-2 text-right tabular-nums font-black text-purple-700">{fmtKES(r.totalContribution)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="py-1.5 px-2 text-[10px] font-black uppercase tracking-widest text-slate-500" colSpan={3}>Total</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-slate-900">{fmtKES(totals.grossSalary)}</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-purple-600">{fmtKES(totals.employeeContribution)}</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-purple-600">{fmtKES(totals.employerContribution)}</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-purple-800">{fmtKES(totals.totalContribution)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {reportType === 'ahl' && (
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-[#0B3B2E] text-white">
                          {[['No.','pl-4 text-left'],['Employee Name','text-left'],['KRA PIN','text-left'],['Gross','text-right'],['Employee Levy','text-right text-amber-600'],['Employer Levy','text-right text-amber-600'],['Total Levy','text-right pr-4 text-amber-700 font-black']].map(([h,cls]) => (
                            <th key={h} className={`py-1 px-2 font-bold border-r border-white/10 whitespace-nowrap ${cls.includes('text-left') ? 'text-left' : 'text-right'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                            <td className="py-1 px-2 font-mono text-[10px] text-slate-400 border-r border-gray-100">{r.employeeNumber}</td>
                            <td className="py-1 px-2 font-black text-slate-900 border-r border-gray-100">{r.name}</td>
                            <td className="py-1 px-2 font-mono text-slate-600 border-r border-gray-100">{r.kraPin || '—'}</td>
                            <td className="py-1 px-2 text-right tabular-nums text-slate-700 border-r border-gray-100">{fmtKES(r.grossSalary)}</td>
                            <td className="py-1 px-2 text-right tabular-nums text-amber-600 border-r border-gray-100">{fmtKES(r.employeeLevy)}</td>
                            <td className="py-1 px-2 text-right tabular-nums text-amber-600 border-r border-gray-100">{fmtKES(r.employerLevy)}</td>
                            <td className="py-1 px-2 text-right tabular-nums font-black text-amber-700">{fmtKES(r.totalLevy)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="py-1.5 px-2 text-[10px] font-black uppercase tracking-widest text-slate-500" colSpan={3}>Total</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-slate-900">{fmtKES(totals.grossSalary)}</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-amber-600">{fmtKES(totals.employeeLevy)}</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-amber-600">{fmtKES(totals.employerLevy)}</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-amber-800">{fmtKES(totals.totalLevy)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {reportType === 'bank' && (
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-[#0B3B2E] text-white">
                          {[['No.','pl-4 text-left'],['Employee Name','text-left'],['Method','text-left'],['Bank / Provider','text-left'],['Account / Number','text-left'],['Branch','text-left'],['Net Pay','text-right pr-4 text-emerald-700 font-black']].map(([h,cls]) => (
                            <th key={h} className={`py-1 px-2 font-bold border-r border-white/10 whitespace-nowrap ${cls.includes('text-left') ? 'text-left' : 'text-right'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                            <td className="py-1 px-2 font-mono text-[10px] text-slate-400 border-r border-gray-100">{r.employeeNumber}</td>
                            <td className="py-1 px-2 font-black text-slate-900 border-r border-gray-100">{r.name}</td>
                            <td className="py-1 px-2 text-slate-600 border-r border-gray-100">{r.paymentMethod || '—'}</td>
                            <td className="py-1 px-2 text-slate-600 border-r border-gray-100">{r.bankName || (r.mpesaNumber ? 'M-Pesa' : '—')}</td>
                            <td className="py-1 px-2 font-mono text-slate-700 border-r border-gray-100">{r.bankAccountNumber || r.mpesaNumber || '—'}</td>
                            <td className="py-1 px-2 text-slate-500 border-r border-gray-100">{r.bankBranch || '—'}</td>
                            <td className="py-1 px-2 text-right tabular-nums font-black text-emerald-700">{fmtKES(r.netSalary)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="py-1.5 px-2 text-[10px] font-black uppercase tracking-widest text-slate-500" colSpan={6}>Total Net Pay</td>
                          <td className="py-1.5 px-2 text-right font-black tabular-nums text-emerald-800">{fmtKES(totals.netSalary)}</td>
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
      {showEmail && (
        <EmailSendModal
          title={`Email ${rt?.label || 'Remittance'} Report`}
          defaultEmail=""
          onSend={async (email) => {
            try {
              const res = await adminRequests.post('/hr/emails/payroll-register', { periodId, email });
              toast.success(`Report emailed to ${res.data.to}`);
              return res.data;
            } catch (e) {
              toast.error(e?.response?.data?.message || 'Failed to send email');
              throw e;
            }
          }}
          onClose={() => setShowEmail(false)}
        />
      )}
    </DashboardLayout>
  );
}

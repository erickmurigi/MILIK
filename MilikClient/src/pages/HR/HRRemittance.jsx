import React, { useCallback, useEffect, useState } from 'react';
import { FaArrowLeft, FaPrint, FaRedoAlt, FaFileAlt, FaEnvelope } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import EmailSendModal from '../../components/HR/EmailSendModal';
import { selectCurrentCompany } from '../../redux/selectors';
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
    const { companyName = '', logo = '', roadStreet = '', town = '', phoneNo = '', email: coEmail = '', taxPIN = '' } = company;
    const addr = [roadStreet, town].filter(Boolean).join(', ');

    let thead = '', tbody = '', tfoot = '';

    if (reportType === 'paye') {
      thead = `<tr><th>Emp No.</th><th>Employee Name</th><th>KRA PIN</th><th class="r">Gross Salary</th><th class="r red">PAYE Deducted</th></tr>`;
      tbody = rows.map((r) => `<tr><td class="mono">${r.employeeNumber}</td><td class="bold">${r.name}</td><td class="mono">${r.kraPin||'—'}</td><td class="r">${fmtKES(r.grossSalary)}</td><td class="r red bold">${fmtKES(r.paye)}</td></tr>`).join('');
      tfoot = `<tr class="tot"><td colspan="3">Total</td><td class="r">${fmtKES(totals.grossSalary)}</td><td class="r red">${fmtKES(totals.paye)}</td></tr>`;
    } else if (reportType === 'nhif') {
      thead = `<tr><th>Emp No.</th><th>Employee Name</th><th>SHA / NHIF No.</th><th class="r">Gross Salary</th><th class="r blue">SHA Contribution</th></tr>`;
      tbody = rows.map((r) => `<tr><td class="mono">${r.employeeNumber}</td><td class="bold">${r.name}</td><td class="mono">${r.nhifNo||'—'}</td><td class="r">${fmtKES(r.grossSalary)}</td><td class="r blue bold">${fmtKES(r.employeeContribution)}</td></tr>`).join('');
      tfoot = `<tr class="tot"><td colspan="3">Total</td><td class="r">${fmtKES(totals.grossSalary)}</td><td class="r blue">${fmtKES(totals.employeeContribution)}</td></tr>`;
    } else if (reportType === 'nssf') {
      thead = `<tr><th>Emp No.</th><th>Employee Name</th><th>NSSF No.</th><th class="r">Gross</th><th class="r purple">Employee</th><th class="r purple">Employer</th><th class="r purple">Total</th></tr>`;
      tbody = rows.map((r) => `<tr><td class="mono">${r.employeeNumber}</td><td class="bold">${r.name}</td><td class="mono">${r.nssfNo||'—'}</td><td class="r">${fmtKES(r.grossSalary)}</td><td class="r purple">${fmtKES(r.employeeContribution)}</td><td class="r purple">${fmtKES(r.employerContribution)}</td><td class="r purple bold">${fmtKES(r.totalContribution)}</td></tr>`).join('');
      tfoot = `<tr class="tot"><td colspan="3">Total</td><td class="r">${fmtKES(totals.grossSalary)}</td><td class="r purple">${fmtKES(totals.employeeContribution)}</td><td class="r purple">${fmtKES(totals.employerContribution)}</td><td class="r purple">${fmtKES(totals.totalContribution)}</td></tr>`;
    } else if (reportType === 'ahl') {
      thead = `<tr><th>Emp No.</th><th>Employee Name</th><th>KRA PIN</th><th class="r">Gross</th><th class="r amber">Emp Levy</th><th class="r amber">Empr Levy</th><th class="r amber">Total Levy</th></tr>`;
      tbody = rows.map((r) => `<tr><td class="mono">${r.employeeNumber}</td><td class="bold">${r.name}</td><td class="mono">${r.kraPin||'—'}</td><td class="r">${fmtKES(r.grossSalary)}</td><td class="r amber">${fmtKES(r.employeeLevy)}</td><td class="r amber">${fmtKES(r.employerLevy)}</td><td class="r amber bold">${fmtKES(r.totalLevy)}</td></tr>`).join('');
      tfoot = `<tr class="tot"><td colspan="3">Total</td><td class="r">${fmtKES(totals.grossSalary)}</td><td class="r amber">${fmtKES(totals.employeeLevy)}</td><td class="r amber">${fmtKES(totals.employerLevy)}</td><td class="r amber">${fmtKES(totals.totalLevy)}</td></tr>`;
    } else {
      thead = `<tr><th>Emp No.</th><th>Employee Name</th><th>Method</th><th>Bank / Provider</th><th>Account / Number</th><th>Branch</th><th class="r green">Net Pay</th></tr>`;
      tbody = rows.map((r) => `<tr><td class="mono">${r.employeeNumber}</td><td class="bold">${r.name}</td><td>${r.paymentMethod||'—'}</td><td>${r.bankName||(r.mpesaNumber?'M-Pesa':'—')}</td><td class="mono">${r.bankAccountNumber||r.mpesaNumber||'—'}</td><td>${r.bankBranch||'—'}</td><td class="r green bold">${fmtKES(r.netSalary)}</td></tr>`).join('');
      tfoot = `<tr class="tot"><td colspan="6">Total Net Pay</td><td class="r green">${fmtKES(totals.netSalary)}</td></tr>`;
    }

    const win = window.open('', '_blank', 'width=1000,height=1120');
    if (!win) { toast.error('Allow pop-ups to print'); return; }
    win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${rt.label} Remittance — ${period?.label||''}</title>
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
  table{width:100%;border-collapse:collapse;}
  thead tr{background:#1B3D2F;color:#fff;}
  th{padding:5px 6px;text-align:left;font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.12em;white-space:nowrap;}
  td{padding:4px 6px;font-size:8.5pt;border-bottom:1px solid #f1f5f9;vertical-align:middle;}
  tr:nth-child(even) td{background:#f8fafc;}
  td.mono{font-family:monospace;font-size:8pt;}
  td.bold{font-weight:700;color:#0f172a;}
  td.r{text-align:right;font-family:monospace;}
  td.red{color:#dc2626;} td.blue{color:#2563eb;} td.purple{color:#7c3aed;} td.amber{color:#d97706;} td.green{color:#059669;}
  tr.tot td{font-weight:900;border-top:2px solid #e2e8f0;padding-top:6px;font-size:8.5pt;color:#0f172a;}
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
    <div class="doc-label">Human Resource · ${rt.label} Remittance</div>
    <div class="doc-title">${rt.label} — ${period?.label||''}</div>
    <div class="doc-sub">${rt.desc}</div>
  </div>
  <div class="doc-sub">Printed: ${new Date().toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'})} &nbsp;·&nbsp; ${rows.length} employees</div>
</div>
<table><thead>${thead}</thead><tbody>${tbody}</tbody><tfoot>${tfoot}</tfoot></table>
<div class="footer"><span>Computer-generated statutory remittance — verify before submission.</span><span>${companyName}</span></div>
</body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
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
                <>
                  <button onClick={() => setShowEmail(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    <FaEnvelope size={9} /> Email
                  </button>
                  <button onClick={printRemittance} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23]">
                    <FaPrint size={9} /> Print
                  </button>
                </>
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

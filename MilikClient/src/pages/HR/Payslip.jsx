import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { FaArrowLeft, FaPrint, FaRedoAlt, FaEnvelope } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import EmailSendModal from '../../components/HR/EmailSendModal';
import { selectCurrentCompany } from '../../redux/selectors';
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

  const [showEmail, setShowEmail] = useState(false);
  const company = useSelector(selectCurrentCompany) || {};

  const ps     = payslip;
  const period = ps?.payrollPeriod;
  const snap   = useMemo(() => ps?.snapshot ?? {}, [ps]);

  const printPayslip = useCallback(() => {
    if (!ps) return;
    const empName   = snap.name || 'Employee';
    const empNo     = snap.employeeNumber || '';
    const { companyName = '', logo = '', roadStreet = '', town = '', phoneNo = '', email: coEmail = '', taxPIN = '' } = company;
    const addr      = [roadStreet, town].filter(Boolean).join(', ');

    const earnRows = [
      `<tr><td class="label">Basic Salary</td><td class="amount">${fmtKES(ps.basicSalary)}</td></tr>`,
      ...(ps.allowances || []).map((a) => `<tr><td class="label">${a.name}</td><td class="amount">${fmtKES(a.amount)}</td></tr>`),
    ].join('');

    const dedRows = [
      ps.paye ? `<tr><td class="label">PAYE (Tax)</td><td class="amount red">${fmtKES(ps.paye)}</td></tr>` : '',
      ps.nhif ? `<tr><td class="label">SHA / NHIF</td><td class="amount red">${fmtKES(ps.nhif)}</td></tr>` : '',
      ps.nssf ? `<tr><td class="label">NSSF</td><td class="amount red">${fmtKES(ps.nssf)}</td></tr>` : '',
      ps.ahl  ? `<tr><td class="label">Housing Levy (AHL)</td><td class="amount red">${fmtKES(ps.ahl)}</td></tr>` : '',
      ...(ps.otherDeductions || []).map((d) => `<tr><td class="label">${d.name}</td><td class="amount red">${fmtKES(d.amount)}</td></tr>`),
    ].join('');

    const win = window.open('', '_blank', 'width=840,height=1120');
    if (!win) { toast.error('Allow pop-ups to print'); return; }

    win.document.write(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Pay Slip — ${empName}</title>
<style>
  @page { size:A4; margin:16mm 20mm 20mm; }
  *,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
  html,body { background:#fff; font-family:Arial,Helvetica,sans-serif; font-size:10.5pt; color:#1a1a1a; }

  /* ── Letterhead ── */
  .lh { display:flex; align-items:flex-start; justify-content:space-between; padding-bottom:10px; border-bottom:2.5px solid #027333; margin-bottom:18px; }
  .lh-logo { height:44px; width:auto; border-radius:3px; display:block; margin-bottom:6px; }
  .lh-company { font-size:17pt; font-weight:900; color:#0f172a; line-height:1.1; }
  .lh-addr { font-size:8pt; color:#64748b; margin-top:3px; }
  .lh-meta { text-align:right; font-size:8pt; color:#64748b; line-height:1.6; }

  /* ── Doc title bar ── */
  .doc-bar { display:flex; align-items:flex-end; justify-content:space-between; border-bottom:2px solid #0f172a; padding-bottom:6px; margin-bottom:14px; }
  .doc-label { font-size:8pt; font-weight:700; text-transform:uppercase; letter-spacing:0.18em; color:#64748b; }
  .doc-title { font-size:14pt; font-weight:900; color:#0f172a; margin-top:2px; }
  .doc-date { font-size:8pt; color:#94a3b8; }

  /* ── Employee strip ── */
  .emp-strip { display:flex; gap:24px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; padding:10px 14px; margin-bottom:14px; }
  .emp-field { flex:1; }
  .ef-label { font-size:7.5pt; font-weight:700; text-transform:uppercase; letter-spacing:0.12em; color:#94a3b8; margin-bottom:1px; }
  .ef-value { font-size:10.5pt; font-weight:900; color:#0f172a; }

  /* ── Earnings / Deductions columns ── */
  .columns { display:flex; gap:0; border:1px solid #e2e8f0; border-radius:4px; overflow:hidden; margin-bottom:0; }
  .col { flex:1; padding:12px 14px; }
  .col + .col { border-left:1px solid #e2e8f0; }
  .col-head { font-size:8pt; font-weight:900; text-transform:uppercase; letter-spacing:0.15em; margin-bottom:8px; }
  .col-head.green { color:#059669; }
  .col-head.red   { color:#dc2626; }
  table.items { width:100%; border-collapse:collapse; }
  td.label  { padding:3px 0; font-size:9.5pt; color:#334155; }
  td.amount { padding:3px 0; text-align:right; font-family:monospace; font-size:9.5pt; color:#0f172a; }
  td.amount.red { color:#dc2626; }
  tr.total td { border-top:1.5px solid #e2e8f0; padding-top:5px; font-weight:900; font-size:9pt; text-transform:uppercase; letter-spacing:0.1em; color:#64748b; }
  tr.total td.amount { color:#0f172a; font-size:10pt; }
  tr.total td.amount.red { color:#dc2626; }

  /* ── Net Pay banner ── */
  .net-bar { background:#1B3D2F; color:#fff; padding:14px 18px; border-radius:0 0 4px 4px; display:flex; align-items:center; justify-content:space-between; margin-top:-1px; }
  .net-label { font-size:8pt; font-weight:700; text-transform:uppercase; letter-spacing:0.2em; color:#6ee7b7; }
  .net-amount { font-size:22pt; font-weight:900; font-family:monospace; }
  .net-pay-info { text-align:right; font-size:8.5pt; color:#a7f3d0; line-height:1.6; }
  .net-pay-info strong { color:#fff; }

  /* ── Footer ── */
  .footer { margin-top:16px; padding-top:7px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; font-size:7.5pt; color:#94a3b8; }

  @media print { html,body { background:#fff; } }
</style></head><body>

<!-- Letterhead -->
<div class="lh">
  <div>
    ${logo ? `<img src="${logo}" class="lh-logo" alt="${companyName}">` : ''}
    <div class="lh-company">${companyName}</div>
    ${addr ? `<div class="lh-addr">${addr}</div>` : ''}
  </div>
  <div class="lh-meta">
    ${coEmail  ? coEmail + '<br>' : ''}
    ${phoneNo  ? phoneNo + '<br>' : ''}
    ${taxPIN   ? 'KRA PIN: ' + taxPIN : ''}
  </div>
</div>

<!-- Doc title -->
<div class="doc-bar">
  <div>
    <div class="doc-label">Human Resource · Pay Slip</div>
    <div class="doc-title">${fmtPeriod(period)}</div>
  </div>
  <div class="doc-date">Printed: ${new Date().toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'})}</div>
</div>

<!-- Employee -->
<div class="emp-strip">
  <div class="emp-field"><div class="ef-label">Employee Name</div><div class="ef-value">${empName}</div></div>
  <div class="emp-field"><div class="ef-label">Employee No.</div><div class="ef-value" style="font-family:monospace">${empNo}</div></div>
  <div class="emp-field"><div class="ef-label">Department</div><div class="ef-value">${snap.department || '—'}</div></div>
  <div class="emp-field"><div class="ef-label">Designation</div><div class="ef-value">${snap.designation || '—'}</div></div>
  ${snap.kraPin ? `<div class="emp-field"><div class="ef-label">KRA PIN</div><div class="ef-value" style="font-family:monospace">${snap.kraPin}</div></div>` : ''}
</div>

<!-- Columns -->
<div class="columns">
  <div class="col">
    <div class="col-head green">Earnings</div>
    <table class="items">
      <tbody>${earnRows}</tbody>
      <tfoot>
        <tr class="total">
          <td class="label">Gross Salary</td>
          <td class="amount">${fmtKES(ps.grossSalary)}</td>
        </tr>
      </tfoot>
    </table>
  </div>
  <div class="col">
    <div class="col-head red">Deductions</div>
    <table class="items">
      <tbody>${dedRows}</tbody>
      <tfoot>
        <tr class="total">
          <td class="label">Total Deductions</td>
          <td class="amount red">${fmtKES(ps.totalDeductions)}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</div>

<!-- Net Pay -->
<div class="net-bar">
  <div>
    <div class="net-label">Net Pay</div>
    <div class="net-amount">${fmtKES(ps.netSalary)}</div>
  </div>
  ${snap.paymentMethod ? `<div class="net-pay-info">
    <strong>${snap.paymentMethod}</strong>
    ${snap.bankName          ? '<br>' + snap.bankName : ''}
    ${snap.bankAccountNumber ? '<br><span style="font-family:monospace">' + snap.bankAccountNumber + '</span>' : ''}
    ${snap.mpesaNumber       ? '<br><span style="font-family:monospace">' + snap.mpesaNumber + '</span>' : ''}
  </div>` : ''}
</div>

<!-- Footer -->
<div class="footer">
  <span>This is a computer-generated payslip and requires no signature.</span>
  <span>${empName} · ${empNo}</span>
</div>

</body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [ps, snap, period, company]);

  const sendEmail = useCallback(async (email) => {
    try {
      const res = await adminRequests.post(`/hr/emails/payslip/${payslipId}`, { email });
      toast.success(`Payslip emailed to ${res.data.to}`);
      return res.data;
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to send email');
      throw e;
    }
  }, [payslipId]);

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
              <button
                onClick={() => setShowEmail(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                <FaEnvelope size={9} /> Email
              </button>
              <button onClick={printPayslip} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23]">
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
                        {ps.paye > 0 && <DeductionRow label="PAYE (Tax)"         amount={ps.paye} />}
                        {ps.nhif > 0 && <DeductionRow label="SHA / NHIF"         amount={ps.nhif} />}
                        {ps.nssf > 0 && <DeductionRow label="NSSF"               amount={ps.nssf} />}
                        {ps.ahl  > 0 && <DeductionRow label="Housing Levy (AHL)" amount={ps.ahl}  />}
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
      {showEmail && (
        <EmailSendModal
          title="Email Payslip"
          defaultEmail={ps?.employee?.email || ''}
          onSend={sendEmail}
          onClose={() => setShowEmail(false)}
        />
      )}
    </DashboardLayout>
  );
}

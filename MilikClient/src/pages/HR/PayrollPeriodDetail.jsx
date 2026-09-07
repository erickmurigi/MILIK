import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  FaArrowLeft, FaRedoAlt, FaPlay, FaCheck, FaHandHolding,
  FaMoneyBillWave, FaUsers, FaFileAlt, FaPrint, FaUndo,
  FaSlidersH, FaPlus, FaTrash,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const STATUS_STYLE = {
  Draft:      'border-slate-200 bg-slate-50 text-slate-600',
  Processing: 'border-amber-200 bg-amber-50 text-amber-700',
  Approved:   'border-blue-200 bg-blue-50 text-blue-700',
  Paid:       'border-emerald-200 bg-emerald-50 text-emerald-700',
  Closed:     'border-rose-200 bg-rose-50 text-rose-600',
  Reversed:   'border-rose-300 bg-rose-50 text-rose-700',
};

const fmtKES = (n) =>
  n != null ? `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : '—';

function StatCard({ label, value, sub, color = 'text-slate-900', border = 'border-slate-200' }) {
  return (
    <div className={`border ${border} bg-white px-3 py-2`}>
      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
      <div className={`text-lg font-black leading-tight mt-0.5 ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

const fmtNum = (n) => Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });
const EMPTY_LINE = { name: '', amount: '' };

function AdjustModal({ payslip, onClose, onSaved }) {
  const [allowances,  setAllowances]  = useState(payslip.adjustmentAllowances?.length ? payslip.adjustmentAllowances.map((r) => ({ ...r, amount: String(r.amount) })) : []);
  const [deductions,  setDeductions]  = useState(payslip.adjustmentDeductions?.length ? payslip.adjustmentDeductions.map((r) => ({ ...r, amount: String(r.amount) })) : []);
  const [note,        setNote]        = useState(payslip.adjustmentNote || '');
  const [saving,      setSaving]      = useState(false);

  const setLine = (arr, setArr, idx, field, val) =>
    setArr(arr.map((r, i) => i === idx ? { ...r, [field]: val } : r));

  const removeLine = (arr, setArr, idx) => setArr(arr.filter((_, i) => i !== idx));

  const effGross = (payslip.grossSalary || 0)
    + allowances.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const adjDedTotal = deductions.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const estimatedNet = Math.max(0, effGross - (payslip.paye || 0) - (payslip.nhif || 0) - (payslip.nssf || 0) - (payslip.ahl || 0)
    - (payslip.otherDeductions || []).reduce((s, d) => s + d.amount, 0) - adjDedTotal);

  const handleSave = async () => {
    for (const r of allowances) {
      if (!r.name.trim()) { return; }
      if (isNaN(Number(r.amount)) || Number(r.amount) < 0) { return; }
    }
    for (const r of deductions) {
      if (!r.name.trim()) { return; }
      if (isNaN(Number(r.amount)) || Number(r.amount) < 0) { return; }
    }
    setSaving(true);
    try {
      await adminRequests.patch(`/hr/payroll/payslips/${payslip._id}/adjust`, {
        adjustmentAllowances: allowances.map((r) => ({ name: r.name.trim(), amount: Number(r.amount) || 0 })),
        adjustmentDeductions: deductions.map((r) => ({ name: r.name.trim(), amount: Number(r.amount) || 0 })),
        adjustmentNote: note,
      });
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save adjustments');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'h-7 rounded border border-slate-200 px-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';

  const LineTable = ({ rows, setRows, label, color }) => (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className={`text-[10px] font-black uppercase tracking-widest ${color}`}>{label}</span>
        <button onClick={() => setRows([...rows, { ...EMPTY_LINE }])} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50">
          <FaPlus size={8} /> Add
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-2 text-center text-[10px] text-slate-400">No {label.toLowerCase()} added</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={r.name} onChange={(e) => setLine(rows, setRows, i, 'name', e.target.value)}
                placeholder="Description" className={`${inputCls} flex-1`} />
              <input type="number" min="0" value={r.amount} onChange={(e) => setLine(rows, setRows, i, 'amount', e.target.value)}
                placeholder="0" className={`${inputCls} w-28 text-right font-mono`} />
              <button onClick={() => removeLine(rows, setRows, i)} className="text-slate-300 hover:text-rose-500"><FaTrash size={10} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Payslip Adjustment</div>
            <h2 className="text-sm font-black text-slate-900">{payslip.snapshot?.name}</h2>
            <p className="text-[10px] text-slate-400">{payslip.snapshot?.employeeNumber} · Base gross: {fmtKES(payslip.grossSalary)}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">✕</button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <LineTable rows={allowances} setRows={setAllowances} label="Extra Allowances / Bonuses" color="text-emerald-700" />
          <LineTable rows={deductions} setRows={setDeductions} label="Extra Deductions / Penalties" color="text-rose-600" />

          <div className="mb-3">
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Adjustment Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Performance bonus for Q2" className={`${inputCls} w-full`} />
          </div>

          {/* Preview */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Estimated Net Pay After Adjustment</div>
            <div className="flex justify-between">
              <span className="text-slate-600">Effective Gross</span>
              <span className="font-mono font-semibold text-slate-800">KES {fmtNum(effGross)}</span>
            </div>
            <div className="flex justify-between text-rose-600">
              <span>Total Deductions (incl. statutory)</span>
              <span className="font-mono">≈ KES {fmtNum(effGross - estimatedNet)}</span>
            </div>
            <div className="mt-1.5 flex justify-between border-t border-slate-200 pt-1.5 font-black text-emerald-700">
              <span>Estimated Net Pay</span>
              <span className="font-mono">KES {fmtNum(estimatedNet)}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button onClick={onClose} className="h-7 rounded border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="h-7 rounded bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0a2e23] disabled:opacity-60">
            {saving ? 'Saving…' : 'Save Adjustment'}
          </button>
        </div>
      </div>
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
  const [reverseDialog, setReverseDialog] = useState({ isOpen: false, reason: '', busy: false });
  const [adjustTarget, setAdjustTarget] = useState(null);

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

  const doReverse = async () => {
    setReverseDialog((d) => ({ ...d, busy: true }));
    try {
      await adminRequests.patch(`/hr/payroll/periods/${periodId}/reverse`, { reason: reverseDialog.reason });
      toast.success('Payroll period reversed');
      setReverseDialog({ isOpen: false, reason: '', busy: false });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to reverse payroll');
      setReverseDialog((d) => ({ ...d, busy: false }));
    }
  };

  const isDraft    = period?.status === 'Draft' || period?.status === 'Processing';
  const isApproved = period?.status === 'Approved';
  const canReverse = (isApproved || period?.status === 'Paid') && period?.status !== 'Reversed';

  const company     = useSelector(selectCurrentCompany) || {};
  const currentUser = useSelector(selectCurrentUser);
  const canManagePayroll = Boolean(currentUser?.adminAccess || currentUser?.isSystemAdmin || currentUser?.superAdminAccess);

  const handlePrint = useCallback(() => {
    if (!payslips.length || !period) return;
    const { companyName = '', logo = '', roadStreet = '', town = '', phoneNo = '', email: coEmail = '', taxPIN = '' } = company;
    const addr = [roadStreet, town].filter(Boolean).join(', ');

    const tbody = payslips.map((ps, i) => `<tr class="${i%2===0?'even':'odd'}">
      <td class="bold">${ps.snapshot.name}<br><span class="sub">${ps.snapshot.employeeNumber} · ${ps.snapshot.department||'—'}</span></td>
      <td class="r">${fmtKES(ps.basicSalary)}</td>
      <td class="r bold">${fmtKES(ps.grossSalary)}</td>
      <td class="r red">${fmtKES(ps.paye)}</td>
      <td class="r red">${fmtKES(ps.nhif)}</td>
      <td class="r red">${fmtKES(ps.nssf)}</td>
      <td class="r red">${fmtKES(ps.ahl)}</td>
      <td class="r green bold">${fmtKES(ps.netSalary)}</td>
      <td class="status">${ps.status}</td>
    </tr>`).join('');

    const win = window.open('', '_blank', 'width=1050,height=1200');
    if (!win) { toast.error('Allow pop-ups to print'); return; }
    win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Payroll Register — ${period.label}</title>
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
  .summary{display:flex;gap:12px;margin-bottom:10px;}
  .scard{flex:1;border:1px solid #e2e8f0;border-radius:4px;padding:6px 10px;}
  .sc-label{font-size:6.5pt;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;}
  .sc-value{font-size:13pt;font-weight:900;margin-top:1px;}
  table{width:100%;border-collapse:collapse;}
  thead tr{background:#1B3D2F;color:#fff;}
  th{padding:5px 6px;text-align:left;font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.1em;white-space:nowrap;}
  th.r{text-align:right;}
  td{padding:4px 6px;font-size:8.5pt;border-bottom:1px solid #f1f5f9;vertical-align:top;}
  tr.even td{background:#fff;} tr.odd td{background:#f8fafc;}
  td.bold{font-weight:700;color:#0f172a;}
  td.r{text-align:right;font-family:monospace;}
  td.red{color:#dc2626;} td.green{color:#059669;}
  td.status{font-size:7.5pt;font-weight:700;color:#64748b;}
  .sub{font-size:7pt;color:#94a3b8;font-weight:400;}
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
  <div>
    <div class="doc-label">Human Resource · Payroll Period</div>
    <div class="doc-title">${period.label} &nbsp;<span style="font-size:9pt;color:#64748b">${period.status}</span></div>
  </div>
  <div class="doc-sub">Printed: ${new Date().toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'})} &nbsp;·&nbsp; ${payslips.length} employees</div>
</div>
<div class="summary">
  <div class="scard"><div class="sc-label">Gross Pay</div><div class="sc-value">${fmtKES(period.totalGross)}</div></div>
  <div class="scard"><div class="sc-label">PAYE</div><div class="sc-value" style="color:#dc2626">${fmtKES(period.totalPAYE)}</div></div>
  <div class="scard"><div class="sc-label">SHA</div><div class="sc-value" style="color:#dc2626">${fmtKES(period.totalNHIF)}</div></div>
  <div class="scard"><div class="sc-label">NSSF</div><div class="sc-value" style="color:#dc2626">${fmtKES(period.totalNSSF)}</div></div>
  <div class="scard"><div class="sc-label">Housing Levy</div><div class="sc-value" style="color:#dc2626">${fmtKES(period.totalAHL)}</div></div>
  <div class="scard"><div class="sc-label">Net Pay</div><div class="sc-value" style="color:#059669">${fmtKES(period.totalNet)}</div></div>
</div>
<table>
  <thead><tr>
    <th>Employee</th><th class="r">Basic</th><th class="r">Gross</th>
    <th class="r">PAYE</th><th class="r">SHA</th><th class="r">NSSF</th><th class="r">AHL</th>
    <th class="r">Net Pay</th><th>Status</th>
  </tr></thead>
  <tbody>${tbody}</tbody>
  <tfoot><tr>
    <td>Totals</td>
    <td class="r">${fmtKES(period.totalBasic)}</td>
    <td class="r">${fmtKES(period.totalGross)}</td>
    <td class="r red">${fmtKES(period.totalPAYE)}</td>
    <td class="r red">${fmtKES(period.totalNHIF)}</td>
    <td class="r red">${fmtKES(period.totalNSSF)}</td>
    <td class="r red">${fmtKES(period.totalAHL)}</td>
    <td class="r green">${fmtKES(period.totalNet)}</td>
    <td></td>
  </tr></tfoot>
</table>
<div class="footer"><span>Computer-generated payroll register.</span><span>${companyName}</span></div>
</body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [payslips, period, company]);

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
                <button onClick={load} className="print-hide inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <FaRedoAlt size={9} />
                </button>
                {payslips.length > 0 && (
                  <button onClick={handlePrint} className="print-hide inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                    <FaPrint size={9} /> Print Register
                  </button>
                )}
                {canManagePayroll && isDraft && (
                  <button onClick={runPayroll} disabled={running} className="print-hide inline-flex h-7 items-center gap-1.5 rounded bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0a2e23] disabled:opacity-50">
                    <FaPlay size={9} /> {running ? 'Running…' : period.employeeCount > 0 ? 'Re-run Payroll' : 'Run Payroll'}
                  </button>
                )}
                {canManagePayroll && period.status === 'Draft' && period.employeeCount > 0 && (
                  <button onClick={approve} className="print-hide inline-flex h-7 items-center gap-1.5 rounded bg-blue-600 px-3 text-xs font-black text-white hover:bg-blue-700">
                    <FaCheck size={9} /> Approve
                  </button>
                )}
                {canManagePayroll && isApproved && (
                  <button onClick={markPaid} className="print-hide inline-flex h-7 items-center gap-1.5 rounded bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700">
                    <FaHandHolding size={9} /> Mark Paid
                  </button>
                )}
                {canReverse && canManagePayroll && (
                  <button
                    onClick={() => setReverseDialog({ isOpen: true, reason: '', busy: false })}
                    className="print-hide inline-flex h-7 items-center gap-1.5 rounded border border-rose-300 bg-rose-50 px-3 text-xs font-black text-rose-700 hover:bg-rose-100"
                  >
                    <FaUndo size={9} /> Reverse
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
                  <div className="border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">PAYE</div>
                    <div className="text-sm font-black text-rose-600">{fmtKES(period.totalPAYE)}</div>
                  </div>
                  <div className="border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">SHA / NHIF</div>
                    <div className="text-sm font-black text-rose-600">{fmtKES(period.totalNHIF)}</div>
                  </div>
                  <div className="border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">NSSF</div>
                    <div className="text-sm font-black text-rose-600">{fmtKES(period.totalNSSF)}</div>
                  </div>
                  <div className="border border-slate-200 bg-white px-3 py-2">
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
                  <table className="min-w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-[#0B3B2E] text-white">
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Employee</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Basic</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Gross</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">PAYE</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">SHA</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">NSSF</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">AHL</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Net Pay</th>
                        <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
                        <th className="px-3 py-1 text-right font-bold border-r border-white/10">Payslip</th>
                        {isDraft && <th className="px-3 py-1 print-hide" />}
                      </tr>
                    </thead>
                    <tbody>
                      {payslips.map((ps, idx) => (
                        <tr key={ps._id} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <div className="font-black text-slate-900">{ps.snapshot.name}</div>
                            <div className="text-[10px] text-slate-400">{ps.snapshot.employeeNumber} · {ps.snapshot.department || '—'}</div>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-700">{fmtKES(ps.basicSalary)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-900">{fmtKES(ps.grossSalary)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right text-rose-600">{fmtKES(ps.paye)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right text-rose-600">{fmtKES(ps.nhif)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right text-rose-600">{fmtKES(ps.nssf)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right text-rose-600">{fmtKES(ps.ahl)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-emerald-700">{fmtKES(ps.netSalary)}</td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_STYLE[ps.status] || STATUS_STYLE.Draft}`}>
                              {ps.status}
                            </span>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right print-hide">
                            <button
                              onClick={() => navigate(`/hr/payroll/${periodId}/payslip/${ps._id}`)}
                              className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700 hover:bg-indigo-100"
                            >
                              <FaFileAlt size={8} /> View
                            </button>
                          </td>
                          {isDraft && (
                            <td className="px-2 py-1 print-hide">
                              <button
                                onClick={() => setAdjustTarget(ps)}
                                title="Add bonus / manual adjustment"
                                className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-black hover:bg-amber-50 ${ps.adjustmentAllowances?.length || ps.adjustmentDeductions?.length ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-400 hover:border-amber-300 hover:text-amber-600'}`}
                              >
                                <FaSlidersH size={8} /> {ps.adjustmentAllowances?.length || ps.adjustmentDeductions?.length ? 'Adjusted' : 'Adjust'}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-50">
                        <td className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">TOTALS</td>
                        <td className="px-3 py-1.5 text-right font-black text-slate-700">{fmtKES(period.totalBasic)}</td>
                        <td className="px-3 py-1.5 text-right font-black text-slate-900">{fmtKES(period.totalGross)}</td>
                        <td className="px-3 py-1.5 text-right font-black text-rose-700">{fmtKES(period.totalPAYE)}</td>
                        <td className="px-3 py-1.5 text-right font-black text-rose-700">{fmtKES(period.totalNHIF)}</td>
                        <td className="px-3 py-1.5 text-right font-black text-rose-700">{fmtKES(period.totalNSSF)}</td>
                        <td className="px-3 py-1.5 text-right font-black text-rose-700">{fmtKES(period.totalAHL)}</td>
                        <td className="px-3 py-1.5 text-right font-black text-emerald-700">{fmtKES(period.totalNet)}</td>
                        <td colSpan={isDraft ? 3 : 2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {adjustTarget && (
        <AdjustModal
          payslip={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onSaved={() => { setAdjustTarget(null); load(); toast.success('Payslip adjusted'); }}
        />
      )}

      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))} />

      {reverseDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-rose-200 overflow-hidden">
            <div className="flex items-start gap-3 border-b border-rose-100 bg-rose-50 px-5 py-4">
              <FaUndo className="mt-0.5 shrink-0 text-rose-600" size={16} />
              <div>
                <div className="text-sm font-black text-rose-800">Reverse Payroll</div>
                <div className="text-xs text-rose-600 mt-0.5">
                  This will reverse all GL entries and mark all payslips as Reversed. This cannot be undone.
                </div>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="text-xs font-black uppercase tracking-widest text-slate-500">
                {period?.label}
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Reason (optional)</label>
                <textarea
                  rows={3}
                  autoFocus
                  value={reverseDialog.reason}
                  onChange={(e) => setReverseDialog((d) => ({ ...d, reason: e.target.value }))}
                  placeholder="State the reason for reversal…"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-rose-400 resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                onClick={() => setReverseDialog({ isOpen: false, reason: '', busy: false })}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={doReverse}
                disabled={reverseDialog.busy}
                className="px-4 py-2 text-xs font-black text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                {reverseDialog.busy ? 'Reversing…' : 'Confirm Reverse'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

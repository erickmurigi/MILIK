import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  FaArrowLeft, FaEdit, FaUserTimes, FaUserCheck, FaUser, FaBriefcase,
  FaMoneyBillWave, FaHeartbeat, FaPhone, FaEnvelope, FaMapMarkerAlt,
  FaIdCard, FaBuilding, FaTag, FaCalendarAlt, FaUniversity,
  FaMobileAlt, FaRedoAlt, FaPrint, FaCamera, FaTimesCircle,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { selectCurrentCompany } from '../../redux/selectors';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';


const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const fmtCurrency = (n) =>
  n != null && n !== '' && n !== 0
    ? `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
    : '—';

const initials = (s = '', o = '') => `${s.charAt(0)}${o.charAt(0)}`.toUpperCase() || 'EM';

const STATUS_STYLE = {
  Active:     { badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',   avatar: 'bg-emerald-600' },
  Probation:  { badge: 'border-amber-200 bg-amber-50 text-amber-700',         avatar: 'bg-amber-500' },
  Suspended:  { badge: 'border-orange-200 bg-orange-50 text-orange-700',      avatar: 'bg-orange-500' },
  Terminated: { badge: 'border-rose-200 bg-rose-50 text-rose-700',            avatar: 'bg-rose-500' },
};

const TYPE_STYLE = {
  Permanent: 'bg-emerald-100 text-emerald-700',
  Contract:  'bg-blue-100 text-blue-700',
  Casual:    'bg-amber-100 text-amber-700',
  Intern:    'bg-violet-100 text-violet-700',
};

const SectionHeader = ({ icon: Icon, label, color = 'text-emerald-700' }) => (
  <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
    <Icon size={11} className={color} />
    <span className="text-[11px] font-black uppercase tracking-widest text-slate-600">{label}</span>
  </div>
);

const Field = ({ label, value, icon: Icon, mono }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
    <span className={`flex items-center gap-1.5 text-xs font-semibold text-slate-800 ${mono ? 'font-mono' : ''}`}>
      {Icon && <Icon size={10} className="shrink-0 text-slate-400" />}
      {value || <span className="text-slate-300">—</span>}
    </span>
  </div>
);

export default function EmployeeProfile() {
  const navigate  = useNavigate();
  const { id }    = useParams();
  const [emp, setEmp]               = useState(null);
  const [loading, setLoading]       = useState(true);
  const [confirm, setConfirm]       = useState({ isOpen: false });
  const [uploading, setUploading]   = useState(false);
  const fileInputRef                = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequests.get(`/hr/employees/${id}`);
      setEmp(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to load employee');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleTerminate = () => {
    setConfirm({
      isOpen: true,
      title: 'Terminate Employee',
      message: `Terminate ${emp.surname} ${emp.otherNames}? This marks them as terminated in the system.`,
      isDangerous: true,
      confirmText: 'Terminate',
      onConfirm: async () => {
        try {
          await adminRequests.patch(`/hr/employees/${id}/terminate`, { terminationDate: new Date() });
          toast.success('Employee terminated');
          load();
        } catch (e) {
          toast.error(e?.response?.data?.message || 'Failed to terminate');
        } finally {
          setConfirm((p) => ({ ...p, isOpen: false }));
        }
      },
    });
  };

  const handleReinstate = async () => {
    try {
      await adminRequests.patch(`/hr/employees/${id}/reinstate`);
      toast.success('Employee reinstated');
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to reinstate');
    }
  };

  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      // Do NOT set Content-Type — axios sets it automatically with the multipart boundary
      await adminRequests.post(`/hr/employees/${id}/photo`, formData);
      toast.success('Photo updated');
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoRemove = () => {
    setConfirm({
      isOpen: true,
      title: 'Remove Photo',
      message: 'Remove the profile photo for this employee?',
      isDangerous: false,
      confirmText: 'Remove',
      onConfirm: async () => {
        try {
          await adminRequests.delete(`/hr/employees/${id}/photo`);
          toast.success('Photo removed');
          load();
        } catch (e) {
          toast.error(e?.response?.data?.message || 'Failed to remove photo');
        } finally {
          setConfirm((p) => ({ ...p, isOpen: false }));
        }
      },
    });
  };

  const company = useSelector(selectCurrentCompany) || {};

  const printProfile = useCallback(() => {
    if (!emp) return;
    const { companyName = '', logo = '', roadStreet = '', town = '', phoneNo = '', email: coEmail = '', taxPIN = '' } = company;
    const addr = [roadStreet, town].filter(Boolean).join(', ');
    const basic = Number(emp.basicSalary) || 0;
    const gross = basic + (emp.salaryComponents || []).filter((c) => c.type === 'Allowance').reduce((s, c) => s + (c.isPercentage ? (basic * Number(c.amount)) / 100 : Number(c.amount)), 0);
    const fmtC = (n) => n > 0 ? `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : '—';
    const f = (v) => v || '—';

    const componentRows = (emp.salaryComponents || []).map((c) => {
      const amt = c.isPercentage ? (basic * Number(c.amount)) / 100 : Number(c.amount);
      return `<tr><td>${c.name}</td><td>${c.type}</td><td style="text-align:right;color:${c.type==='Deduction'?'#dc2626':'#059669'}">${c.isPercentage?c.amount+'% · ':''}${c.type==='Deduction'?'−':'+'}${fmtC(amt)}</td></tr>`;
    }).join('');

    const win = window.open('', '_blank', 'width=840,height=1200');
    if (!win) { toast.error('Allow pop-ups to print'); return; }
    win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Employee Profile — ${emp.surname} ${emp.otherNames}</title>
<style>
  @page{size:A4;margin:14mm 16mm;}
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#1a1a1a;}
  .lh{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:8px;border-bottom:2.5px solid #027333;margin-bottom:12px;}
  .lh-logo{height:38px;width:auto;border-radius:3px;}
  .lh-company{font-size:14pt;font-weight:900;color:#0f172a;}
  .lh-addr{font-size:7pt;color:#64748b;margin-top:2px;}
  .lh-meta{text-align:right;font-size:7pt;color:#64748b;line-height:1.7;}
  .doc-bar{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.5px solid #0f172a;padding-bottom:5px;margin-bottom:10px;}
  .doc-label{font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:#64748b;}
  .doc-title{font-size:13pt;font-weight:900;color:#0f172a;margin-top:1px;}
  .emp-hero{display:flex;align-items:flex-start;gap:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:10px 14px;margin-bottom:12px;}
  .emp-avatar{width:64px;height:64px;border-radius:6px;object-fit:cover;flex-shrink:0;background:#e2e8f0;}
  .emp-name{font-size:14pt;font-weight:900;color:#0f172a;line-height:1.1;}
  .emp-num{font-family:monospace;font-size:9pt;color:#64748b;margin-top:2px;}
  .badge{display:inline-block;border-radius:20px;padding:1px 7px;font-size:7.5pt;font-weight:900;margin-top:4px;margin-right:4px;}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}
  .card{border:1px solid #e2e8f0;border-radius:4px;padding:10px 12px;}
  .card-head{font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.15em;color:#64748b;border-bottom:1px solid #f1f5f9;padding-bottom:4px;margin-bottom:7px;}
  .fields{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;}
  .fl{font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;}
  .fv{font-size:8.5pt;font-weight:700;color:#1a1a1a;margin-top:1px;}
  .fv.mono{font-family:monospace;}
  table.comp{width:100%;border-collapse:collapse;margin-top:6px;}
  table.comp th{text-align:left;font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;padding:3px 0;border-bottom:1px solid #f1f5f9;}
  table.comp td{padding:3px 0;font-size:8.5pt;border-bottom:1px solid #f8fafc;}
  tfoot.gross td{font-weight:900;border-top:1.5px solid #e2e8f0;padding-top:5px;font-size:9pt;}
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
  <div><div class="doc-label">Human Resource · Employee Record</div><div class="doc-title">${emp.surname} ${emp.otherNames}</div></div>
  <div style="font-size:8pt;color:#64748b">Printed: ${new Date().toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'})}</div>
</div>
<div class="emp-hero">
  ${emp.profilePicture?`<img src="${emp.profilePicture}" class="emp-avatar" alt="${emp.surname}">`:
    `<div class="emp-avatar" style="display:flex;align-items:center;justify-content:center;font-size:22pt;font-weight:900;color:#fff;background:#1B3D2F">${(emp.surname?.charAt(0)||'')}${(emp.otherNames?.charAt(0)||'')}</div>`}
  <div>
    <div class="emp-name">${emp.surname} ${emp.otherNames}</div>
    <div class="emp-num">${emp.employeeNumber||'—'}</div>
    <span class="badge" style="border:1px solid #bbf7d0;color:#059669;background:#f0fdf4">${emp.status||'Active'}</span>
    <span class="badge" style="background:#dbeafe;color:#2563eb">${emp.employmentType||'—'}</span>
    ${emp.designation?.name?`<span class="badge" style="background:#f8fafc;color:#475569;border:1px solid #e2e8f0">${emp.designation.name}</span>`:''}
    ${emp.department?.name?`<span class="badge" style="background:#fff7ed;color:#c2410c;border:1px solid #fed7aa">${emp.department.name}</span>`:''}
  </div>
</div>
<div class="grid2">
  <div class="card">
    <div class="card-head">Personal Information</div>
    <div class="fields">
      <div><div class="fl">Gender</div><div class="fv">${f(emp.gender)}</div></div>
      <div><div class="fl">Date of Birth</div><div class="fv">${fmtDate(emp.dateOfBirth)}</div></div>
      <div><div class="fl">National ID</div><div class="fv mono">${f(emp.nationalId)}</div></div>
      <div><div class="fl">KRA PIN</div><div class="fv mono">${f(emp.kraPin)}</div></div>
      <div><div class="fl">NHIF / SHA No.</div><div class="fv mono">${f(emp.nhifNo)}</div></div>
      <div><div class="fl">NSSF No.</div><div class="fv mono">${f(emp.nssfNo)}</div></div>
      ${emp.helbNo?`<div><div class="fl">HELB No.</div><div class="fv mono">${emp.helbNo}</div></div>`:''}
    </div>
  </div>
  <div class="card">
    <div class="card-head">Contact Details</div>
    <div class="fields">
      <div><div class="fl">Phone</div><div class="fv">${f(emp.phoneNumber)}</div></div>
      <div><div class="fl">Email</div><div class="fv">${f(emp.email)}</div></div>
      <div><div class="fl">Physical Address</div><div class="fv">${f(emp.physicalAddress)}</div></div>
      <div><div class="fl">Postal Address</div><div class="fv">${f(emp.postalAddress)}</div></div>
    </div>
    ${emp.nextOfKinName||emp.nextOfKinPhone?`
    <div style="border-top:1px solid #f1f5f9;margin-top:7px;padding-top:7px;">
      <div class="card-head" style="margin-bottom:6px;border-bottom:none">Emergency Contact</div>
      <div class="fields">
        <div><div class="fl">Name</div><div class="fv">${f(emp.nextOfKinName)}</div></div>
        <div><div class="fl">Relationship</div><div class="fv">${f(emp.nextOfKinRelationship)}</div></div>
        <div><div class="fl">Phone</div><div class="fv">${f(emp.nextOfKinPhone)}</div></div>
      </div>
    </div>`:''}
  </div>
  <div class="card">
    <div class="card-head">Employment Details</div>
    <div class="fields">
      <div><div class="fl">Department</div><div class="fv">${f(emp.department?.name)}</div></div>
      <div><div class="fl">Designation</div><div class="fv">${f(emp.designation?.name)}</div></div>
      <div><div class="fl">Type</div><div class="fv">${f(emp.employmentType)}</div></div>
      <div><div class="fl">Date Joined</div><div class="fv">${fmtDate(emp.dateJoined)}</div></div>
      ${emp.probationEndDate?`<div><div class="fl">Probation Ends</div><div class="fv">${fmtDate(emp.probationEndDate)}</div></div>`:''}
      ${emp.contractEndDate?`<div><div class="fl">Contract End</div><div class="fv">${fmtDate(emp.contractEndDate)}</div></div>`:''}
      ${emp.reportsTo?`<div><div class="fl">Reports To</div><div class="fv">${emp.reportsTo.surname} ${emp.reportsTo.otherNames}</div></div>`:''}
      ${emp.status==='Terminated'?`<div><div class="fl">Terminated</div><div class="fv">${fmtDate(emp.terminationDate)}</div></div>`:''}
    </div>
  </div>
  <div class="card">
    <div class="card-head">Compensation</div>
    <div class="fields">
      <div><div class="fl">Basic Salary</div><div class="fv">${fmtC(emp.basicSalary)}</div></div>
      <div><div class="fl">Gross Salary</div><div class="fv">${fmtC(gross)}</div></div>
      <div><div class="fl">Payment Method</div><div class="fv">${f(emp.paymentMethod)}</div></div>
      ${emp.bankName?`<div><div class="fl">Bank</div><div class="fv">${emp.bankName}</div></div>`:''}
      ${emp.bankAccountNumber?`<div><div class="fl">Account No.</div><div class="fv mono">${emp.bankAccountNumber}</div></div>`:''}
      ${emp.mpesaNumber?`<div><div class="fl">M-Pesa</div><div class="fv mono">${emp.mpesaNumber}</div></div>`:''}
    </div>
    ${componentRows?`<table class="comp">
      <thead><tr><th>Component</th><th>Type</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${componentRows}</tbody>
      <tfoot class="gross"><tr><td colspan="2">Gross Salary</td><td style="text-align:right">${fmtC(gross)}</td></tr></tfoot>
    </table>`:''}
  </div>
</div>
<div class="footer"><span>Confidential — Human Resource · Employee Record.</span><span>${companyName}</span></div>
</body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [emp, company]);

  const status    = emp?.status || 'Active';
  const style     = STATUS_STYLE[status] || STATUS_STYLE.Active;
  const typeStyle = TYPE_STYLE[emp?.employmentType] || 'bg-slate-100 text-slate-600';

  const grossSalary = (() => {
    if (!emp) return 0;
    const basic = Number(emp.basicSalary) || 0;
    const allowances = (emp.salaryComponents || [])
      .filter((c) => c.type === 'Allowance')
      .reduce((sum, c) => {
        const amt = c.isPercentage ? (basic * Number(c.amount)) / 100 : Number(c.amount);
        return sum + (amt || 0);
      }, 0);
    return basic + allowances;
  })();

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/hr/employees')} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B3B2E] hover:underline">
                <FaArrowLeft size={10} /> Back
              </button>
              <div className="h-4 w-px bg-slate-300" />
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource</div>
                <h1 className="text-sm font-black text-slate-900 leading-tight">Employee Profile</h1>
              </div>
            </div>

            {emp && (
              <div className="flex items-center gap-2">
                <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <FaRedoAlt size={9} />
                </button>
                <button onClick={printProfile} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <FaPrint size={9} /> Print
                </button>
                <button onClick={() => navigate(`/hr/employees/${id}/edit`)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                  <FaEdit size={9} /> Edit
                </button>
                {emp.status !== 'Terminated' ? (
                  <button onClick={handleTerminate} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700 hover:bg-rose-100">
                    <FaUserTimes size={9} /> Terminate
                  </button>
                ) : (
                  <button onClick={handleReinstate} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700 hover:bg-emerald-100">
                    <FaUserCheck size={9} /> Reinstate
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading profile...</div>
          ) : !emp ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Employee not found.</div>
          ) : (
            <div className="employee-print-area">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={handlePhotoSelect}
              />

              <PrintLetterhead
                variant="print"
                docLabel="Human Resource · Employee Record"
                docTitle={`${emp.surname} ${emp.otherNames}`}
                docMeta={`${emp.employeeNumber} · ${emp.status} · ${emp.employmentType}`}
              />

              <div className="flex gap-4 items-start">

                {/* ── Left sidebar: Photo + identity ── */}
                <div className="w-52 shrink-0 flex flex-col gap-3">

                  {/* Photo card */}
                  <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    {/* Photo area */}
                    <div className="group relative w-full aspect-square bg-slate-100">
                      {emp.profilePicture ? (
                        <img
                          src={emp.profilePicture}
                          alt={`${emp.surname} ${emp.otherNames}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className={`flex h-full w-full items-center justify-center text-5xl font-black text-white ${style.avatar}`}>
                          {initials(emp.surname, emp.otherNames)}
                        </div>
                      )}

                      {/* Hover overlay */}
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-1 bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <FaCamera size={22} />
                        <span className="text-[11px] font-black">{uploading ? 'Uploading…' : emp.profilePicture ? 'Change Photo' : 'Upload Photo'}</span>
                      </div>

                      {/* Remove badge */}
                      {emp.profilePicture && (
                        <button
                          onClick={handlePhotoRemove}
                          className="absolute right-2 top-2 hidden rounded-full bg-white/90 p-0.5 text-rose-500 shadow-md group-hover:flex"
                          title="Remove photo"
                        >
                          <FaTimesCircle size={16} />
                        </button>
                      )}
                    </div>

                    {/* Name + identity below photo */}
                    <div className="px-3 py-3 space-y-2">
                      <div>
                        <div className="text-sm font-black text-slate-900 leading-tight">{emp.surname} {emp.otherNames}</div>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">{emp.employeeNumber}</div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${style.badge}`}>{status}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${typeStyle}`}>{emp.employmentType}</span>
                      </div>
                      {emp.designation?.name && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-500">
                          <FaTag size={9} className="text-slate-400" />
                          <span className="font-semibold">{emp.designation.name}</span>
                        </div>
                      )}
                      {emp.department?.name && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-500">
                          <FaBuilding size={9} className="text-slate-400" />
                          <span>{emp.department.name}</span>
                        </div>
                      )}

                      {/* Upload / Change button — hidden in print */}
                      <button
                        onClick={() => !uploading && fileInputRef.current?.click()}
                        disabled={uploading}
                        className="print-hide mt-1 w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-center text-[10px] font-black uppercase tracking-wide text-slate-400 hover:border-[#0B3B2E] hover:text-[#0B3B2E] disabled:cursor-wait transition-colors"
                      >
                        <FaCamera className="inline mr-1" size={9} />
                        {uploading ? 'Uploading…' : emp.profilePicture ? 'Change Photo' : 'Add Photo'}
                      </button>
                    </div>
                  </div>

                  {/* Quick stats card */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2.5">
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Date Joined</div>
                      <div className="text-xs font-black text-slate-800">{fmtDate(emp.dateJoined)}</div>
                    </div>
                    {emp.basicSalary > 0 && (
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Basic Salary</div>
                        <div className="text-xs font-black text-slate-800">{fmtCurrency(emp.basicSalary)}</div>
                      </div>
                    )}
                    {emp.reportsTo && (
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Reports To</div>
                        <div className="text-xs font-semibold text-slate-700">{emp.reportsTo.surname} {emp.reportsTo.otherNames}</div>
                      </div>
                    )}
                    {emp.phoneNumber && (
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                        <FaPhone size={9} className="text-slate-400" /> {emp.phoneNumber}
                      </div>
                    )}
                    {emp.email && (
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-600 break-all">
                        <FaEnvelope size={9} className="text-slate-400 shrink-0" /> {emp.email}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Right: info cards ── */}
                <div className="flex-1 min-w-0 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">

                    {/* Personal */}
                    <div className="print-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <SectionHeader icon={FaUser} label="Personal Information" />
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Gender"        value={emp.gender} />
                        <Field label="Date of Birth" value={fmtDate(emp.dateOfBirth)} icon={FaCalendarAlt} />
                        <Field label="National ID"   value={emp.nationalId}  icon={FaIdCard} mono />
                        <Field label="KRA PIN"       value={emp.kraPin}      icon={FaIdCard} mono />
                        <Field label="NHIF No."      value={emp.nhifNo}      mono />
                        <Field label="NSSF No."      value={emp.nssfNo}      mono />
                        {emp.helbNo && <Field label="HELB No." value={emp.helbNo} mono />}
                      </div>
                    </div>

                    {/* Contact + Emergency */}
                    <div className="print-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <SectionHeader icon={FaPhone} label="Contact Details" color="text-blue-600" />
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Phone"            value={emp.phoneNumber}     icon={FaPhone} />
                        <Field label="Email"            value={emp.email}           icon={FaEnvelope} />
                        <Field label="Physical Address" value={emp.physicalAddress} icon={FaMapMarkerAlt} />
                        <Field label="Postal Address"   value={emp.postalAddress}   icon={FaMapMarkerAlt} />
                      </div>

                      {(emp.nextOfKinName || emp.nextOfKinPhone) && (
                        <>
                          <div className="my-3 border-t border-slate-100" />
                          <SectionHeader icon={FaHeartbeat} label="Emergency Contact" color="text-rose-500" />
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Full Name"    value={emp.nextOfKinName} />
                            <Field label="Relationship" value={emp.nextOfKinRelationship} />
                            <Field label="Phone"        value={emp.nextOfKinPhone} icon={FaPhone} />
                          </div>
                        </>
                      )}
                    </div>

                    {/* Employment */}
                    <div className="print-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <SectionHeader icon={FaBriefcase} label="Employment Details" color="text-indigo-600" />
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Department"      value={emp.department?.name}  icon={FaBuilding} />
                        <Field label="Designation"     value={emp.designation?.name} icon={FaTag} />
                        <Field label="Employment Type" value={emp.employmentType} />
                        <Field label="Date Joined"     value={fmtDate(emp.dateJoined)} icon={FaCalendarAlt} />
                        {emp.probationEndDate   && <Field label="Probation Ends"  value={fmtDate(emp.probationEndDate)} icon={FaCalendarAlt} />}
                        {emp.contractStartDate  && <Field label="Contract Start"  value={fmtDate(emp.contractStartDate)} icon={FaCalendarAlt} />}
                        {emp.contractEndDate    && <Field label="Contract End"    value={fmtDate(emp.contractEndDate)} icon={FaCalendarAlt} />}
                        {emp.reportsTo && <Field label="Reports To" value={`${emp.reportsTo.surname} ${emp.reportsTo.otherNames}`} icon={FaUser} />}
                        {status === 'Terminated' && (
                          <>
                            <Field label="Termination Date" value={fmtDate(emp.terminationDate)} icon={FaCalendarAlt} />
                            {emp.terminationReason && <Field label="Reason" value={emp.terminationReason} />}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Compensation */}
                    <div className="print-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <SectionHeader icon={FaMoneyBillWave} label="Compensation" color="text-[#FF8C00]" />
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Basic Salary"   value={fmtCurrency(emp.basicSalary)} />
                        <Field label="Gross Salary"   value={fmtCurrency(grossSalary)} />
                        <Field label="Payment Method" value={emp.paymentMethod} />
                        {emp.paymentMethod === 'Bank Transfer' && (
                          <>
                            <Field label="Bank"        value={emp.bankName}          icon={FaUniversity} />
                            <Field label="Account No." value={emp.bankAccountNumber} mono />
                            <Field label="Branch"      value={emp.bankBranch} />
                          </>
                        )}
                        {emp.paymentMethod === 'M-Pesa' && (
                          <Field label="M-Pesa No." value={emp.mpesaNumber} icon={FaMobileAlt} />
                        )}
                      </div>

                      {emp.salaryComponents?.length > 0 && (
                        <div className="mt-3">
                          <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Allowances & Deductions</div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-slate-100">
                                <th className="pb-1 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Component</th>
                                <th className="pb-1 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Type</th>
                                <th className="pb-1 text-right text-[10px] font-black uppercase tracking-widest text-slate-400">Amount</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {emp.salaryComponents.map((c, i) => {
                                const basic = Number(emp.basicSalary) || 0;
                                const amt = c.isPercentage ? (basic * Number(c.amount)) / 100 : Number(c.amount);
                                return (
                                  <tr key={i}>
                                    <td className="py-1.5 font-semibold text-slate-700">{c.name}</td>
                                    <td className="py-1.5">
                                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${c.type === 'Allowance' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                        {c.type}
                                      </span>
                                    </td>
                                    <td className="py-1.5 text-right font-semibold">
                                      {c.isPercentage && <span className="text-slate-400">{c.amount}% · </span>}
                                      <span className={c.type === 'Deduction' ? 'text-rose-600' : 'text-emerald-700'}>
                                        {c.type === 'Deduction' ? '−' : '+'}{fmtCurrency(amt)}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 border-slate-200">
                                <td colSpan={2} className="pt-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Gross Salary</td>
                                <td className="pt-2 text-right text-sm font-black text-slate-900">{fmtCurrency(grossSalary)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>

                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
      </div>

      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))} />
    </DashboardLayout>
  );
}

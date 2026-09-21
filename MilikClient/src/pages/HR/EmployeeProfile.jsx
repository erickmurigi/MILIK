import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { fmtDate } from '../../utils/dates';
import { openPrintWindow, letterheadHtml, footerHtml, wrapPage, pageBoxCss, escapeHtml, formatMoney, getCompanyDetails, BRAND } from '../../utils/printKit';

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
    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</span>
    <span className={`flex items-center gap-1.5 text-[13px] font-semibold text-slate-800 ${mono ? 'font-mono' : ''}`}>
      {Icon && <Icon size={10} className="shrink-0 text-slate-400" />}
      {value || <span className="font-normal italic text-slate-300">—</span>}
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

  const [essForm,      setEssForm]    = useState({ password: '', enabled: false, sendInvite: true });
  const [essSaving,    setEssSaving]  = useState(false);
  const [essInviting,  setEssInviting] = useState(false);
  const [essMsg,       setEssMsg]     = useState(null); // { type: 'ok'|'err', text }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequests.get(`/hr/employees/${id}`);
      setEmp(res.data);
      setEssForm((p) => ({ ...p, enabled: !!res.data.essEnabled }));
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to load employee');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const saveEssAccess = useCallback(async () => {
    setEssSaving(true);
    setEssMsg(null);
    try {
      const payload = { enabled: essForm.enabled, sendInvite: essForm.sendInvite };
      if (essForm.password) payload.password = essForm.password;
      const { data } = await adminRequests.patch(`/hr/employees/${id}/ess-access`, payload);
      setEssForm((p) => ({ ...p, password: '' }));
      setEmp((p) => ({ ...p, essEnabled: essForm.enabled, essPassword: data.hasPassword ? '***' : '' }));
      if (data.emailSent) {
        setEssMsg({ type: 'ok', text: `ESS access saved and invite email sent to ${emp?.email}` });
      } else if (data.noEmail) {
        setEssMsg({ type: 'ok', text: 'ESS access saved. No email sent — employee has no email address on file.' });
      } else if (data.emailError) {
        setEssMsg({ type: 'err', text: `ESS saved but email failed: ${data.emailError}` });
      } else {
        setEssMsg({ type: 'ok', text: 'ESS access updated' });
      }
    } catch (e) {
      setEssMsg({ type: 'err', text: e?.response?.data?.message || 'Failed to update ESS access' });
    } finally { setEssSaving(false); }
  }, [id, essForm, emp?.email]);

  const sendEssInvite = useCallback(async () => {
    if (!essForm.password) {
      setEssMsg({ type: 'err', text: 'Enter a temporary password to include in the invite email' });
      return;
    }
    setEssInviting(true);
    setEssMsg(null);
    try {
      const toEmail = emp?.email || '';
      const payload = { password: essForm.password };
      if (!toEmail) {
        const override = window.prompt('Employee has no email on file. Enter an email address to send to:');
        if (!override) { setEssInviting(false); return; }
        payload.email = override.trim();
      }
      const { data } = await adminRequests.post(`/hr/employees/${id}/ess-invite`, payload);
      setEssForm((p) => ({ ...p, password: '' }));
      setEssMsg({ type: 'ok', text: `Invite sent to ${data.to}` });
    } catch (e) {
      const d = e?.response?.data;
      if (d?.noEmail) {
        const override = window.prompt('No email on file. Enter an address to send to:');
        if (override) {
          setEssInviting(false);
          try {
            const { data } = await adminRequests.post(`/hr/employees/${id}/ess-invite`, {
              password: essForm.password, email: override.trim(),
            });
            setEssForm((p) => ({ ...p, password: '' }));
            setEssMsg({ type: 'ok', text: `Invite sent to ${data.to}` });
          } catch (e2) {
            setEssMsg({ type: 'err', text: e2?.response?.data?.message || 'Failed to send invite' });
          }
          return;
        }
      }
      setEssMsg({ type: 'err', text: d?.message || 'Failed to send invite' });
    } finally { setEssInviting(false); }
  }, [id, essForm.password, emp?.email]);

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

  const grossSalary = useMemo(() => {
    if (!emp) return 0;
    const basic = Number(emp.basicSalary) || 0;
    return basic + (emp.salaryComponents || [])
      .filter((c) => c.type === 'Allowance')
      .reduce((sum, c) => {
        const amt = c.isPercentage ? (basic * Number(c.amount)) / 100 : Number(c.amount);
        return sum + (amt || 0);
      }, 0);
  }, [emp]);

  const company = useSelector(selectCurrentCompany) || {};

  const printProfile = useCallback(() => {
    if (!emp) return;
    const win = openPrintWindow(null, 'width=980,height=1100');
    if (!win) { toast.error('Pop-up blocked — allow pop-ups for this site to print'); return; }
    const co = getCompanyDetails(company);
    const basic = Number(emp.basicSalary) || 0;
    const fmtC = (n) => (n > 0 ? `KES ${formatMoney(n)}` : '—');
    const e = escapeHtml;
    const fullName = `${emp.surname} ${emp.otherNames}`;
    const fld = (label, value, mono) => `<div><div class="fl">${e(label)}</div><div class="fv${mono ? ' mono' : ''}">${e(value || '—')}</div></div>`;
    const opt = (label, value, mono) => (value ? fld(label, value, mono) : '');

    const componentRows = (emp.salaryComponents || []).map((c) => {
      const amt = c.isPercentage ? (basic * Number(c.amount)) / 100 : Number(c.amount);
      const ded = c.type === 'Deduction';
      return `<tr><td>${e(c.name)}</td><td>${e(c.type)}</td><td style="text-align:right;color:${ded ? '#b91c1c' : '#15803d'}">${c.isPercentage ? `${e(c.amount)}% · ` : ''}${ded ? '−' : '+'}${e(fmtC(amt))}</td></tr>`;
    }).join('');

    const pic = /^(https?:\/\/|data:image\/)/i.test(emp.profilePicture || '') ? emp.profilePicture : '';
    const css = `
      .emp-hero { display: flex; align-items: flex-start; gap: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px 14px; margin-bottom: 12px; }
      .emp-avatar { width: 64px; height: 64px; border-radius: 6px; object-fit: cover; flex: none; background: ${BRAND.green}; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800; }
      .emp-name { font-size: 16px; font-weight: 800; line-height: 1.15; }
      .emp-num { font-family: Consolas, monospace; font-size: 10.5px; color: ${BRAND.muted}; margin-top: 2px; }
      .badge { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 9px; font-weight: 800; margin: 5px 4px 0 0; background: #e2e8f0; color: #334155; }
      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
      .pcard { border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px 12px; page-break-inside: avoid; }
      .card-head { font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .16em; color: ${BRAND.gold}; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; margin-bottom: 7px; }
      .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
      .fl { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #94a3b8; }
      .fv { font-size: 11px; font-weight: 700; margin-top: 1px; word-break: break-word; }
      .fv.mono { font-family: Consolas, monospace; }
      table.comp { width: 100%; border-collapse: collapse; margin-top: 8px; }
      table.comp th { text-align: left; font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: #94a3b8; padding: 3px 0; border-bottom: 1px solid #e2e8f0; }
      table.comp td { padding: 3px 0; font-size: 10.5px; border-bottom: 1px solid #f1f5f9; }
      table.comp tfoot td { font-weight: 800; border-top: 1.5px solid #cfe3d9; border-bottom: 0; padding-top: 5px; color: ${BRAND.green}; }`;
    const body = `
      ${letterheadHtml(company, { kicker: 'Human Resource · Employee Record', title: fullName })}
      <div class="emp-hero">
        ${pic ? `<img src="${e(pic)}" class="emp-avatar" alt="" />` : `<div class="emp-avatar">${e(`${emp.surname?.charAt(0) || ''}${emp.otherNames?.charAt(0) || ''}`)}</div>`}
        <div>
          <div class="emp-name">${e(fullName)}</div>
          <div class="emp-num">${e(emp.employeeNumber || '—')}</div>
          <span class="badge" style="background:#dcfce7;color:#166534">${e(emp.status || 'Active')}</span>
          <span class="badge" style="background:#dbeafe;color:#1e40af">${e(emp.employmentType || '—')}</span>
          ${emp.designation?.name ? `<span class="badge">${e(emp.designation.name)}</span>` : ''}
          ${emp.department?.name ? `<span class="badge" style="background:#ffedd5;color:#9a3412">${e(emp.department.name)}</span>` : ''}
        </div>
      </div>
      <div class="grid2">
        <div class="pcard">
          <div class="card-head">Personal Information</div>
          <div class="fields">
            ${fld('Gender', emp.gender)}${fld('Date of Birth', fmtDate(emp.dateOfBirth))}${fld('National ID', emp.nationalId, true)}
            ${fld('KRA PIN', emp.kraPin, true)}${fld('NHIF / SHA No.', emp.nhifNo, true)}${fld('NSSF No.', emp.nssfNo, true)}${opt('HELB No.', emp.helbNo, true)}
          </div>
        </div>
        <div class="pcard">
          <div class="card-head">Contact Details</div>
          <div class="fields">
            ${fld('Phone', emp.phoneNumber)}${fld('Email', emp.email)}${fld('Physical Address', emp.physicalAddress)}${fld('Postal Address', emp.postalAddress)}
          </div>
          ${emp.nextOfKinName || emp.nextOfKinPhone ? `
          <div style="border-top:1px solid #f1f5f9;margin-top:8px;padding-top:8px;">
            <div class="card-head" style="border-bottom:0;margin-bottom:5px">Emergency Contact</div>
            <div class="fields">${fld('Name', emp.nextOfKinName)}${fld('Relationship', emp.nextOfKinRelationship)}${fld('Phone', emp.nextOfKinPhone)}</div>
          </div>` : ''}
        </div>
        <div class="pcard">
          <div class="card-head">Employment Details</div>
          <div class="fields">
            ${fld('Department', emp.department?.name)}${fld('Designation', emp.designation?.name)}${fld('Type', emp.employmentType)}${fld('Date Joined', fmtDate(emp.dateJoined))}
            ${emp.probationEndDate ? fld('Probation Ends', fmtDate(emp.probationEndDate)) : ''}
            ${emp.contractEndDate ? fld('Contract End', fmtDate(emp.contractEndDate)) : ''}
            ${emp.reportsTo ? fld('Reports To', `${emp.reportsTo.surname} ${emp.reportsTo.otherNames}`) : ''}
            ${emp.status === 'Terminated' ? fld('Terminated', fmtDate(emp.terminationDate)) : ''}
          </div>
        </div>
        <div class="pcard">
          <div class="card-head">Compensation</div>
          <div class="fields">
            ${fld('Basic Salary', fmtC(emp.basicSalary))}${fld('Gross Salary', fmtC(grossSalary))}${fld('Payment Method', emp.paymentMethod)}
            ${opt('Bank', emp.bankName)}${opt('Account No.', emp.bankAccountNumber, true)}${opt('M-Pesa', emp.mpesaNumber, true)}
          </div>
          ${componentRows ? `<table class="comp">
            <thead><tr><th>Component</th><th>Type</th><th style="text-align:right">Amount</th></tr></thead>
            <tbody>${componentRows}</tbody>
            <tfoot><tr><td colspan="2">Gross Salary</td><td style="text-align:right">${e(fmtC(grossSalary))}</td></tr></tfoot>
          </table>` : ''}
        </div>
      </div>
      ${footerHtml(company, { left: `${co.name} · Employee Record`, right: 'Confidential — Human Resource' })}`;
    win.document.open();
    win.document.write(wrapPage({ title: `Employee Profile — ${fullName}`, css, body, pageCss: pageBoxCss({ size: 'A4', left: co.name }) }));
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 450);
  }, [emp, company, grossSalary]);

  const status    = emp?.status || 'Active';
  const style     = STATUS_STYLE[status] || STATUS_STYLE.Active;
  const typeStyle = TYPE_STYLE[emp?.employmentType] || 'bg-slate-100 text-slate-600';

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-3 py-1.5 shadow-sm">
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
              <div className="flex items-center gap-1.5">
                <button onClick={load} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <FaRedoAlt size={9} />
                </button>
                <button onClick={printProfile} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <FaPrint size={9} /> Print
                </button>
                <button onClick={() => navigate(`/hr/employees/${id}/edit`)} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                  <FaEdit size={9} /> Edit
                </button>
                {emp.status !== 'Terminated' ? (
                  <button onClick={handleTerminate} className="inline-flex h-7 items-center gap-1.5 rounded border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-700 hover:bg-rose-100">
                    <FaUserTimes size={9} /> Terminate
                  </button>
                ) : (
                  <button onClick={handleReinstate} className="inline-flex h-7 items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-700 hover:bg-emerald-100">
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
                          <table className="w-full text-[11px] border-collapse">
                            <thead>
                              <tr className="bg-[#0B3B2E] text-white">
                                <th className="py-1 px-2 text-left font-bold border-r border-white/10">Component</th>
                                <th className="py-1 px-2 text-left font-bold border-r border-white/10">Type</th>
                                <th className="py-1 px-2 text-right font-bold">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {emp.salaryComponents.map((c, i) => {
                                const basic = Number(emp.basicSalary) || 0;
                                const amt = c.isPercentage ? (basic * Number(c.amount)) / 100 : Number(c.amount);
                                return (
                                  <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}>
                                    <td className="py-1 px-2 border-r border-gray-100 font-semibold text-slate-700">{c.name}</td>
                                    <td className="py-1 px-2 border-r border-gray-100">
                                      <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-black ${c.type === 'Allowance' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                                        {c.type}
                                      </span>
                                    </td>
                                    <td className="py-1 px-2 text-right font-semibold">
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

                {/* ESS Access */}
                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Employee Self-Service Access</span>
                    {emp.essEnabled && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-700">Active</span>
                    )}
                  </div>
                  <p className="mb-3 text-xs text-slate-500">
                    Enable ESS so this employee can log into the portal to view payslips, apply for leave, check in/out, and see letters.
                    {emp.email ? ` An invite email will be sent to ${emp.email}.` : ' Add an email address to this employee to send invite emails.'}
                  </p>

                  {essMsg && (
                    <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-medium ${essMsg.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                      {essMsg.text}
                    </div>
                  )}

                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={essForm.enabled}
                        onChange={(e) => setEssForm((p) => ({ ...p, enabled: e.target.checked }))}
                        className="h-4 w-4 rounded accent-green-700"
                      />
                      <span className="text-xs font-semibold text-slate-700">ESS Enabled</span>
                    </label>

                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {emp.essPassword ? 'New Password (leave blank to keep)' : 'Set Initial Password'}
                      </span>
                      <input
                        type="password"
                        placeholder="Min 6 characters"
                        value={essForm.password}
                        onChange={(e) => setEssForm((p) => ({ ...p, password: e.target.value }))}
                        className="w-48 rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-[#0B3B2E]"
                      />
                    </div>

                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={essForm.sendInvite}
                        onChange={(e) => setEssForm((p) => ({ ...p, sendInvite: e.target.checked }))}
                        className="h-3.5 w-3.5 rounded accent-green-700"
                      />
                      <span className="text-[11px] font-medium text-slate-600">Send invite email</span>
                    </label>

                    <button
                      onClick={saveEssAccess}
                      disabled={essSaving}
                      className="rounded-lg bg-[#027333] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#0c5d2b] disabled:opacity-60"
                    >
                      {essSaving ? 'Saving…' : 'Save'}
                    </button>

                    {emp.essEnabled && (
                      <button
                        onClick={sendEssInvite}
                        disabled={essInviting || !essForm.password}
                        title={!essForm.password ? 'Enter a password above to include in the invite' : 'Resend invite email with a new password'}
                        className="rounded-lg border border-[#027333] px-4 py-1.5 text-xs font-bold text-[#027333] hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {essInviting ? 'Sending…' : 'Resend Invite'}
                      </button>
                    )}
                  </div>

                  {emp.essEnabled && (
                    <div className="mt-3 flex flex-wrap gap-4 rounded-lg bg-slate-50 px-3 py-2 text-[10px] text-slate-500">
                      <span>Portal: <strong className="text-slate-700">/ess/login</strong></span>
                      <span>Company Code: <strong className="font-mono text-slate-700">{company?.companyCode || '—'}</strong></span>
                      <span>Employee No.: <strong className="font-mono text-slate-700">{emp.employeeNumber}</strong></span>
                    </div>
                  )}
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

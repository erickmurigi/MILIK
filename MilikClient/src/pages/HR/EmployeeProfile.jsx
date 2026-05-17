import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FaArrowLeft, FaEdit, FaUserTimes, FaUserCheck, FaUser, FaBriefcase,
  FaMoneyBillWave, FaHeartbeat, FaPhone, FaEnvelope, FaMapMarkerAlt,
  FaIdCard, FaBuilding, FaTag, FaCalendarAlt, FaUniversity,
  FaMobileAlt, FaRedoAlt, FaPrint, FaCamera, FaTimesCircle,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import PrintLetterhead from '../../components/HR/PrintLetterhead';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
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
                <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
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

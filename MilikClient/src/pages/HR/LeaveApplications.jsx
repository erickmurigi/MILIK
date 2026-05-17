import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FaPlus, FaRedoAlt, FaFilter, FaSearch, FaCheck, FaTimes, FaBan,
  FaCalendarAlt, FaUser, FaTag, FaEye,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const STATUS_BADGE = {
  Pending:   'border-amber-200 bg-amber-50 text-amber-700',
  Approved:  'border-emerald-200 bg-emerald-50 text-emerald-700',
  Rejected:  'border-rose-200 bg-rose-50 text-rose-700',
  Cancelled: 'border-slate-200 bg-slate-50 text-slate-500',
  Draft:     'border-indigo-200 bg-indigo-50 text-indigo-600',
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const Pagination = ({ page, totalPages, total, onPage }) => (
  <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-200 bg-white px-4 py-2">
    <span className="text-[11px] text-slate-500">{total} application{total !== 1 ? 's' : ''}</span>
    <div className="flex items-center gap-1">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">Prev</button>
      <span className="px-2 text-[11px] font-semibold text-slate-600">{page} / {totalPages}</span>
      <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">Next</button>
    </div>
  </div>
);

// ── Apply Leave Modal ─────────────────────────────────────────────────────────
function ApplyLeaveModal({ onClose, onSaved }) {
  const [employees, setEmployees]   = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [form, setForm] = useState({ employee: '', leaveType: '', startDate: '', endDate: '', reason: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      adminRequests.get('/hr/employees', { params: { limit: 200 } }),
      adminRequests.get('/hr/leave-types'),
    ]).then(([e, l]) => {
      setEmployees(e.data?.employees || []);
      setLeaveTypes(l.data || []);
    }).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!form.employee)   { toast.error('Select an employee'); return; }
    if (!form.leaveType)  { toast.error('Select a leave type'); return; }
    if (!form.startDate)  { toast.error('Start date is required'); return; }
    if (!form.endDate)    { toast.error('End date is required'); return; }

    setSaving(true);
    try {
      await adminRequests.post('/hr/leave-applications', form);
      toast.success('Leave application submitted');
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to submit application');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'h-8 w-full rounded-lg border border-slate-200 px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Leave Management</div>
            <h2 className="text-sm font-black text-slate-900">Apply for Leave</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><FaTimes size={12} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 p-5">
          <div>
            <label className="mb-0.5 block text-[10px] font-black uppercase tracking-widest text-slate-500">Employee *</label>
            <select value={form.employee} onChange={set('employee')} className={inputCls}>
              <option value="">Select employee</option>
              {employees.map((e) => (
                <option key={e._id} value={e._id}>{e.surname} {e.otherNames} ({e.employeeNumber})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] font-black uppercase tracking-widest text-slate-500">Leave Type *</label>
            <select value={form.leaveType} onChange={set('leaveType')} className={inputCls}>
              <option value="">Select leave type</option>
              {leaveTypes.map((l) => (
                <option key={l._id} value={l._id}>{l.name} ({l.daysPerYear} days/yr)</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-0.5 block text-[10px] font-black uppercase tracking-widest text-slate-500">Start Date *</label>
              <input type="date" value={form.startDate} onChange={set('startDate')} className={inputCls} />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-black uppercase tracking-widest text-slate-500">End Date *</label>
              <input type="date" value={form.endDate} onChange={set('endDate')} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] font-black uppercase tracking-widest text-slate-500">Reason</label>
            <textarea value={form.reason} onChange={set('reason')} rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] resize-none"
              placeholder="Optional reason for leave..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-60">
              {saving ? 'Submitting…' : 'Submit Application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LeaveApplications() {
  const navigate = useNavigate();
  const [applications, setApplications] = useState([]);
  const [leaveTypes, setLeaveTypes]     = useState([]);
  const [total, setTotal]       = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter]     = useState('all');
  const [showApply, setShowApply] = useState(false);
  const [confirm, setConfirm]   = useState({ isOpen: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 25 };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter   !== 'all') params.leaveType = typeFilter;
      const res = await adminRequests.get('/hr/leave-applications', { params });
      setApplications(res.data.applications || []);
      setTotal(res.data.total || 0);
      setTotalPages(res.data.totalPages || 1);
    } catch { toast.error('Failed to load leave applications'); }
    finally  { setLoading(false); }
  }, [page, statusFilter, typeFilter]);

  useEffect(() => {
    adminRequests.get('/hr/leave-types').then((r) => setLeaveTypes(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => { setPage(1); }, [statusFilter, typeFilter]);
  useEffect(() => { load(); }, [load]);

  const handleApprove = (app) => {
    setConfirm({
      isOpen: true,
      title: 'Approve Leave',
      message: `Approve ${app.employee?.surname} ${app.employee?.otherNames}'s ${app.leaveType?.name} (${app.days} day${app.days !== 1 ? 's' : ''})?`,
      isDangerous: false,
      confirmText: 'Approve',
      onConfirm: async () => {
        try {
          await adminRequests.patch(`/hr/leave-applications/${app._id}/approve`);
          toast.success('Leave approved');
          load();
        } catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
        finally     { setConfirm((p) => ({ ...p, isOpen: false })); }
      },
    });
  };

  const handleReject = (app) => {
    setConfirm({
      isOpen: true,
      title: 'Reject Leave',
      message: `Reject ${app.employee?.surname} ${app.employee?.otherNames}'s leave application?`,
      isDangerous: true,
      confirmText: 'Reject',
      onConfirm: async () => {
        try {
          await adminRequests.patch(`/hr/leave-applications/${app._id}/reject`);
          toast.success('Leave rejected');
          load();
        } catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
        finally     { setConfirm((p) => ({ ...p, isOpen: false })); }
      },
    });
  };

  const handleCancel = (app) => {
    setConfirm({
      isOpen: true,
      title: 'Cancel Application',
      message: `Cancel this leave application for ${app.employee?.surname} ${app.employee?.otherNames}?`,
      isDangerous: true,
      confirmText: 'Cancel Leave',
      onConfirm: async () => {
        try {
          await adminRequests.patch(`/hr/leave-applications/${app._id}/cancel`);
          toast.success('Application cancelled');
          load();
        } catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
        finally     { setConfirm((p) => ({ ...p, isOpen: false })); }
      },
    });
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Leave</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Leave Applications</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} /> Refresh
              </button>
              <button onClick={() => setShowApply(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF8C00] px-3 py-1.5 text-xs font-black text-white hover:bg-[#e67e00]">
                <FaPlus size={10} /> Apply Leave
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/95 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-semibold text-slate-700 focus:outline-none">
              <option value="all">All statuses</option>
              <option>Pending</option><option>Approved</option>
              <option>Rejected</option><option>Cancelled</option>
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-8 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-semibold text-slate-700 focus:outline-none">
              <option value="all">All leave types</option>
              {leaveTypes.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
            <span className="ml-auto text-[11px] font-semibold text-slate-500">{total} result{total !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading...</div>
          ) : applications.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
              <FaFilter size={22} />
              <p className="text-sm font-semibold">No applications match the current filters</p>
            </div>
          ) : (
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Employee</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Leave Type</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Period</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest">Days</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Status</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app, idx) => (
                  <tr key={app._id} className={`border-t border-slate-100 hover:bg-slate-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-black text-slate-900">{app.employee?.surname} {app.employee?.otherNames}</div>
                      <div className="text-[10px] text-slate-400">{app.employee?.employeeNumber}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                        <FaTag size={9} className="text-slate-400" />{app.leaveType?.name}
                      </div>
                      {app.leaveType?.isPaid === false && (
                        <span className="text-[10px] text-rose-500 font-semibold">Unpaid</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      <div className="flex items-center gap-1"><FaCalendarAlt size={9} className="text-slate-400" />{fmtDate(app.startDate)}</div>
                      <div className="text-[10px] text-slate-400">to {fmtDate(app.endDate)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-700">{app.days}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_BADGE[app.status] || 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                        {app.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        {app.status === 'Pending' && (
                          <>
                            <button onClick={() => handleApprove(app)} className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-100">
                              <FaCheck size={8} /> Approve
                            </button>
                            <button onClick={() => handleReject(app)} className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700 hover:bg-rose-100">
                              <FaTimes size={8} /> Reject
                            </button>
                          </>
                        )}
                        {['Pending', 'Approved'].includes(app.status) && (
                          <button onClick={() => handleCancel(app)} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-600 hover:bg-slate-100">
                            <FaBan size={8} /> Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />
      </div>

      {showApply && <ApplyLeaveModal onClose={() => setShowApply(false)} onSaved={() => { setShowApply(false); load(); }} />}
      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))} />
    </DashboardLayout>
  );
}

import React, { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTabState } from "../../hooks/useTabState";
import {
  FaPlus, FaRedoAlt, FaSearch, FaTimes, FaEdit, FaTrash, FaClock,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import AppSelect from '../../components/common/AppSelect';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDur  = (min) => {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const monthOpts = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const thisYear  = new Date().getFullYear();
const yearOpts  = Array.from({ length: 4 }, (_, i) => thisYear - i);

const F = 'rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20';

// ── Record Form Modal ─────────────────────────────────────────────────────────
function RecordModal({ record, employees, onClose, onSaved }) {
  const isEdit = Boolean(record?._id);
  const toTimeInput = (d) => d ? new Date(d).toISOString().slice(0, 16) : '';

  const [form, setForm] = useState({
    employee: record?.employee?._id || record?.employee || '',
    date:     record?.date || new Date().toISOString().slice(0, 10),
    checkIn:  toTimeInput(record?.checkIn),
    checkOut: toTimeInput(record?.checkOut),
    note:     record?.note || '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isEdit && !form.employee) { toast.error('Select an employee'); return; }
    if (!form.date)    { toast.error('Date is required'); return; }
    if (!form.checkIn) { toast.error('Check-in time is required'); return; }
    if (form.checkOut && form.checkOut <= form.checkIn) {
      toast.error('Check-out must be after check-in'); return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await adminRequests.patch(`/hr/attendance/${record._id}`, {
          checkIn:  form.checkIn,
          checkOut: form.checkOut || null,
          note:     form.note,
        });
        toast.success('Record updated');
      } else {
        await adminRequests.post('/hr/attendance', {
          employee: form.employee,
          date:     form.date,
          checkIn:  form.checkIn,
          checkOut: form.checkOut || null,
          note:     form.note,
        });
        toast.success('Attendance record added');
      }
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700">HR Attendance</div>
            <h2 className="text-sm font-black text-slate-900">{isEdit ? 'Edit Record' : 'Add Manual Record'}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><FaTimes size={12} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3 p-5">
          {!isEdit && (
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">Employee <span className="text-red-500">*</span></label>
              <AppSelect
                value={form.employee}
                onChange={(v) => setForm((p) => ({ ...p, employee: v ?? '' }))}
                options={employees.map((e) => ({ value: e._id, label: `${e.surname} ${e.otherNames} (${e.employeeNumber})` }))}
                placeholder="Select employee…"
                searchable
                size="sm"
              />
            </div>
          )}
          {!isEdit && (
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">Date *</label>
              <input type="date" value={form.date} onChange={set('date')} className={`${F} w-full`} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">Check-in *</label>
              <input type="datetime-local" value={form.checkIn} onChange={set('checkIn')} className={`${F} w-full`} />
            </div>
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">Check-out</label>
              <input type="datetime-local" value={form.checkOut} onChange={set('checkOut')} className={`${F} w-full`} />
            </div>
          </div>
          <div>
            <label className="mb-0.5 block text-xs font-semibold text-slate-700">Note</label>
            <input type="text" value={form.note} onChange={set('note')} placeholder="e.g. WFH, Site visit" className={`${F} w-full`} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
              {saving ? 'Saving…' : isEdit ? 'Update' : 'Add Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;

export default function HRAttendance() {
  const queryClient = useQueryClient();
  const [empFilter,   setEmpFilter]   = useTabState('/hr/attendance:empFilter', '');
  const [monthFilter, setMonthFilter] = useTabState('/hr/attendance:monthFilter', String(new Date().getMonth() + 1));
  const [yearFilter,  setYearFilter]  = useTabState('/hr/attendance:yearFilter', String(thisYear));
  const [search,      setSearch]      = useTabState('/hr/attendance:search', '');
  const [page,        setPage]        = useTabState('/hr/attendance:page', 1);
  const [modal,       setModal]       = useState(null); // null | 'add' | record object
  const [delTarget,   setDelTarget]   = useState(null);

  const { data: employees = [] } = useQuery({
    queryKey: ['hr-employees-ref'],
    queryFn: () => adminRequests.get('/hr/employees', { params: { limit: 300 } }).then((r) => r.data?.employees || []),
    staleTime: 60_000,
  });

  const params = {
    page,
    limit: PAGE_SIZE,
    ...(empFilter && { employee: empFilter }),
    ...(monthFilter && yearFilter && { month: monthFilter, year: yearFilter }),
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['hr-attendance', params],
    queryFn: () => adminRequests.get('/hr/attendance', { params }).then((r) => r.data),
  });

  const records    = data?.records    || [];
  const total      = data?.total      || 0;
  const totalPages = data?.totalPages || 1;

  const filteredRecords = search
    ? records.filter((r) => {
        const name = `${r.employee?.surname} ${r.employee?.otherNames} ${r.employee?.employeeNumber}`.toLowerCase();
        return name.includes(search.toLowerCase());
      })
    : records;

  const handleSaved = useCallback(() => {
    setModal(null);
    queryClient.invalidateQueries({ queryKey: ['hr-attendance'] });
  }, [queryClient]);

  const doDelete = async () => {
    try {
      await adminRequests.delete(`/hr/attendance/${delTarget._id}`);
      toast.success('Record deleted');
      setDelTarget(null);
      queryClient.invalidateQueries({ queryKey: ['hr-attendance'] });
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Delete failed');
    }
  };

  const present = records.filter((r) => r.checkOut).length;
  const absent  = records.filter((r) => !r.checkOut).length;
  const avgDur  = records.filter((r) => r.duration).reduce((s, r) => s + r.duration, 0) /
                  (records.filter((r) => r.duration).length || 1);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden">

        {/* Header */}
        <div className="flex flex-none items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
          <div>
            <h1 className="text-[11px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">Attendance</h1>
            <p className="text-[10px] text-slate-400 leading-tight">View and manage employee check-in/out records</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={refetch} className="flex h-7 items-center gap-1 rounded border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50">
              <FaRedoAlt size={9} /> Refresh
            </button>
            <button onClick={() => setModal('add')} className="flex h-7 items-center gap-1 rounded bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0a3127]">
              <FaPlus size={9} /> Add Record
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
          <select className={`${F} w-52 appearance-none`} value={empFilter} onChange={(e) => { setEmpFilter(e.target.value); setPage(1); }}>
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e._id} value={e._id}>{e.surname} {e.otherNames}</option>
            ))}
          </select>
          <select className={`${F} w-28 appearance-none`} value={monthFilter} onChange={(e) => { setMonthFilter(e.target.value); setPage(1); }}>
            <option value="">All months</option>
            {monthOpts.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
          </select>
          <select className={`${F} w-24 appearance-none`} value={yearFilter} onChange={(e) => { setYearFilter(e.target.value); setPage(1); }}>
            {yearOpts.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          <div className="relative">
            <FaSearch size={10} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name…"
              className={`${F} w-40 pl-7`} />
          </div>
          <span className="ml-auto text-[11px] text-slate-400">{total} record{total !== 1 ? 's' : ''}</span>
        </div>

        {/* KPI strip */}
        {records.length > 0 && (
          <div className="flex flex-none gap-4 border-b border-slate-100 bg-white px-4 py-2">
            <div className="text-center">
              <div className="text-xs font-black text-slate-900">{records.length}</div>
              <div className="text-[10px] text-slate-400">Shown</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-black text-emerald-700">{present}</div>
              <div className="text-[10px] text-slate-400">Checked out</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-black text-amber-600">{absent}</div>
              <div className="text-[10px] text-slate-400">Still in</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-black text-slate-700">{fmtDur(Math.round(avgDur))}</div>
              <div className="text-[10px] text-slate-400">Avg duration</div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-xs text-slate-400">Loading…</div>
          ) : filteredRecords.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-1 text-slate-400">
              <FaClock size={20} className="text-slate-300" />
              <span className="text-xs">No attendance records found</span>
            </div>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Employee</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Date</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Check-in</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Check-out</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Duration</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Note</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Source</th>
                  <th className="px-3 py-1 w-10" />
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((r, idx) => (
                  <tr key={r._id} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                    <td className="px-3 py-1 border-r border-gray-100">
                      <div className="font-semibold text-slate-800">{r.employee?.surname} {r.employee?.otherNames}</div>
                      <div className="text-[10px] text-slate-400">{r.employee?.employeeNumber}</div>
                    </td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{fmtDate(r.checkIn)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-700">{fmtTime(r.checkIn)}</td>
                    <td className="px-3 py-1 border-r border-gray-100">
                      {r.checkOut
                        ? <span className="font-mono text-slate-700">{fmtTime(r.checkOut)}</span>
                        : <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">Still in</span>
                      }
                    </td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{fmtDur(r.duration)}</td>
                    <td className="max-w-[140px] truncate px-3 py-1 border-r border-gray-100 text-slate-500">{r.note || '—'}</td>
                    <td className="px-3 py-1 border-r border-gray-100">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${r.source === 'ess' ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {r.source}
                      </span>
                    </td>
                    <td className="px-3 py-1">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setModal(r)} className="rounded p-1 text-slate-400 hover:text-[#0B3B2E]" title="Edit">
                          <FaEdit size={11} />
                        </button>
                        <button onClick={() => setDelTarget(r)} className="rounded p-1 text-slate-400 hover:text-rose-600" title="Delete">
                          <FaTrash size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-none items-center justify-between border-t border-slate-200 bg-white px-4 py-2">
            <span className="text-[11px] text-slate-500">{total} records</span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">Prev</button>
              <span className="px-2 text-[11px] font-semibold text-slate-600">{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <RecordModal
          record={modal === 'add' ? null : modal}
          employees={employees}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      <MilikConfirmDialog
        isOpen={Boolean(delTarget)}
        title="Delete Attendance Record"
        message={`Delete the record for ${delTarget?.employee?.surname} ${delTarget?.employee?.otherNames} on ${fmtDate(delTarget?.checkIn)}? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous
        onConfirm={doDelete}
        onCancel={() => setDelTarget(null)}
      />
    </DashboardLayout>
  );
}

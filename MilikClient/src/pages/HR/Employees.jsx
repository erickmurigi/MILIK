import React, { useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  FaSearch, FaUserPlus, FaEdit, FaRedoAlt, FaUserTimes,
  FaUserCheck, FaEye, FaFilter,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const STATUS_BADGE = {
  Active:     'border-emerald-200 bg-emerald-50 text-emerald-700',
  Probation:  'border-amber-200 bg-amber-50 text-amber-700',
  Suspended:  'border-orange-200 bg-orange-50 text-orange-700',
  Terminated: 'border-rose-200 bg-rose-50 text-rose-700',
};

const TYPE_BADGE = {
  Permanent: 'bg-emerald-100 text-emerald-700',
  Contract:  'bg-blue-100 text-blue-700',
  Casual:    'bg-amber-100 text-amber-700',
  Intern:    'bg-violet-100 text-violet-700',
};

const initials = (s = '', o = '') => `${s.charAt(0)}${o.charAt(0)}`.toUpperCase() || 'EM';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const Pagination = ({ page, totalPages, total, onPage }) => (
  <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-200 bg-white px-4 py-2">
    <span className="text-[11px] text-slate-500">{total} employee{total !== 1 ? 's' : ''}</span>
    <div className="flex items-center gap-1">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">Prev</button>
      <span className="px-2 text-[11px] font-semibold text-slate-600">{page} / {totalPages}</span>
      <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold disabled:opacity-40 hover:bg-slate-50">Next</button>
    </div>
  </div>
);

export default function Employees() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState({ isOpen: false });

  const { data: empData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['hr-employees', page, search, deptFilter, statusFilter, typeFilter],
    queryFn: async () => {
      const params = { page, limit: 25 };
      if (search) params.search = search;
      if (deptFilter !== 'all') params.department = deptFilter;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter !== 'all') params.employmentType = typeFilter;
      const res = await adminRequests.get('/hr/employees', { params });
      return res.data;
    },
    placeholderData: (prev) => prev,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['hr-departments-ref'],
    queryFn: () => adminRequests.get('/hr/departments').then((r) => r.data || []),
    staleTime: 5 * 60_000,
  });

  useEffect(() => { if (error) toast.error('Failed to load employees'); }, [error]);
  useEffect(() => { setPage(1); }, [search, deptFilter, statusFilter, typeFilter]);

  const employees = empData?.employees ?? [];
  const total = empData?.total ?? 0;
  const totalPages = empData?.totalPages ?? 1;

  const handleTerminate = (emp) => {
    setConfirm({
      isOpen: true,
      title: 'Terminate Employee',
      message: `Terminate ${emp.surname} ${emp.otherNames}? This marks them as terminated in the system.`,
      isDangerous: true,
      confirmText: 'Terminate',
      onConfirm: async () => {
        try {
          await adminRequests.patch(`/hr/employees/${emp._id}/terminate`, { terminationDate: new Date() });
          toast.success('Employee terminated');
          queryClient.invalidateQueries({ queryKey: ['hr-employees'] });
        } catch (e) {
          toast.error(e?.response?.data?.message || 'Failed to terminate');
        } finally {
          setConfirm((p) => ({ ...p, isOpen: false }));
        }
      },
    });
  };

  const handleReinstate = async (emp) => {
    try {
      await adminRequests.patch(`/hr/employees/${emp._id}/reinstate`);
      toast.success('Employee reinstated');
      queryClient.invalidateQueries({ queryKey: ['hr-employees'] });
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to reinstate');
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Employees</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={refetch} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} /> Refresh
              </button>
              <button onClick={() => navigate('/hr/employees/new')} className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF8C00] px-3 py-1.5 text-xs font-black text-white hover:bg-[#e67e00]">
                <FaUserPlus size={10} /> Add Employee
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/95 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, email, ID number..."
                className="h-8 w-full rounded-lg border border-slate-200 bg-[#DDEFE1] pl-8 pr-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
              />
            </div>
            <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="h-8 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-semibold text-slate-700 focus:outline-none">
              <option value="all">All departments</option>
              {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-semibold text-slate-700 focus:outline-none">
              <option value="all">All statuses</option>
              <option>Active</option><option>Probation</option>
              <option>Suspended</option><option>Terminated</option>
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-8 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-semibold text-slate-700 focus:outline-none">
              <option value="all">All types</option>
              <option>Permanent</option><option>Contract</option>
              <option>Casual</option><option>Intern</option>
            </select>
            <span className="ml-auto text-[11px] font-semibold text-slate-500">{total} result{total !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading employees...</div>
          ) : employees.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
              <FaFilter size={24} />
              <p className="text-sm font-semibold">No employees match the current filters</p>
            </div>
          ) : (
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Employee</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Department</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Designation</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Type</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Date Joined</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Status</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, idx) => (
                  <tr key={emp._id} className={`border-t border-slate-100 hover:bg-slate-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        {emp.profilePicture ? (
                          <img
                            src={emp.profilePicture}
                            alt={initials(emp.surname, emp.otherNames)}
                            className="h-8 w-8 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-[10px] font-black text-emerald-800">
                            {initials(emp.surname, emp.otherNames)}
                          </div>
                        )}
                        <div>
                          <div className="font-black text-slate-900">{emp.surname} {emp.otherNames}</div>
                          <div className="text-[10px] text-slate-400">{emp.employeeNumber} {emp.phoneNumber ? `· ${emp.phoneNumber}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-700">{emp.department?.name || <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2.5 text-slate-600">{emp.designation?.name || <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${TYPE_BADGE[emp.employmentType] || 'bg-slate-100 text-slate-600'}`}>
                        {emp.employmentType}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{fmtDate(emp.dateJoined)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_BADGE[emp.status] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                        {emp.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button onClick={() => navigate(`/hr/employees/${emp._id}`)} className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700 hover:bg-indigo-100">
                          <FaEye size={9} /> View
                        </button>
                        <button onClick={() => navigate(`/hr/employees/${emp._id}/edit`)} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-700 hover:bg-slate-100">
                          <FaEdit size={9} /> Edit
                        </button>
                        {emp.status !== 'Terminated' ? (
                          <button onClick={() => handleTerminate(emp)} className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700 hover:bg-rose-100">
                            <FaUserTimes size={9} /> Terminate
                          </button>
                        ) : (
                          <button onClick={() => handleReinstate(emp)} className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-100">
                            <FaUserCheck size={9} /> Reinstate
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

      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))} />
    </DashboardLayout>
  );
}

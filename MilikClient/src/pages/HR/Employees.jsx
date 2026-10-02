import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTabState } from "../../hooks/useTabState";
import useDebounce from '../../hooks/useDebounce';
import {
  FaSearch, FaUserPlus, FaEdit, FaRedoAlt, FaUserTimes,
  FaUserCheck, FaEye, FaPrint,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { selectCurrentCompany } from '../../redux/selectors';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';
import AppSelect from "../../components/common/AppSelect";
import ListToolbar from "../../components/common/ListToolbar";
import { fmtDate } from '../../utils/dates';
import { printTabularList } from '../../utils/printKit';

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

const STATUS_OPTIONS = ["Active", "Probation", "Suspended", "Terminated"].map((s) => ({ value: s, label: s }));
const TYPE_OPTIONS   = ["Permanent", "Contract", "Casual", "Intern"].map((t) => ({ value: t, label: t }));

import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';

export default function Employees() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useTabState('/hr/employees:search', '');
  const [deptFilter, setDeptFilter] = useTabState('/hr/employees:deptFilter', '');
  const [statusFilter, setStatusFilter] = useTabState('/hr/employees:statusFilter', '');
  const [typeFilter, setTypeFilter] = useTabState('/hr/employees:typeFilter', '');
  const [page, setPage] = useTabState('/hr/employees:page', 1);
  const [pageSize, setPageSize] = useState(25);
  const [confirm, setConfirm] = useState({ isOpen: false });
  const debouncedSearch = useDebounce(search, 350);

  const { data: empData, isLoading: loading, error, refetch } = useQuery({
    queryKey: ['hr-employees', page, pageSize, debouncedSearch, deptFilter, statusFilter, typeFilter],
    queryFn: async () => {
      const params = { page, limit: pageSize };
      if (debouncedSearch) params.search = debouncedSearch;
      if (deptFilter) params.department = deptFilter;
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.employmentType = typeFilter;
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
  useEffect(() => { setPage(1); }, [debouncedSearch, deptFilter, statusFilter, typeFilter]);

  const employees = empData?.employees ?? [];
  const total = empData?.total ?? 0;
  const totalPages = empData?.totalPages ?? 1;

  const departmentOptions = useMemo(
    () => departments.map((d) => ({ value: d._id, label: d.name })),
    [departments]
  );

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

  const company = useSelector(selectCurrentCompany) || {};

  const printAllEmployees = useCallback(async () => {
    // Open the window inside the click so the pop-up is not blocked by the fetch below.
    const win = window.open('', '_blank', 'width=1200,height=800');
    if (!win) { toast.error('Pop-up blocked — allow pop-ups for this site to print'); return; }
    const toastId = toast.loading('Preparing employee list…');
    try {
      const params = {};
      if (search) params.search = search;
      if (deptFilter  !== 'all') params.department     = deptFilter;
      if (statusFilter !== 'all') params.status         = statusFilter;
      if (typeFilter   !== 'all') params.employmentType = typeFilter;

      const res = await adminRequests.get('/hr/employees/directory', { params });
      const emps = res.data?.employees || [];
      toast.dismiss(toastId);

      const filterDesc = [
        statusFilter !== 'all' ? `Status: ${statusFilter}` : '',
        typeFilter   !== 'all' ? `Type: ${typeFilter}` : '',
        search ? `Search: "${search}"` : '',
      ].filter(Boolean).join(' · ') || 'All Employees';

      const STATUS_TONE = { Active: 'pos', Terminated: 'neg', Suspended: 'neg' };

      printTabularList({
        win,
        title: 'Employee List',
        subtitle: `Human Resource · Staff Directory · ${filterDesc}`,
        company,
        summaryItems: [['Employees', emps.length]],
        columns: [
          { label: '#', width: '28px', value: (e, i) => i + 1, tone: () => 'muted' },
          { label: 'Employee Name', bold: true, value: (e) => `${e.surname} ${e.otherNames}` },
          { label: 'Emp. No.', value: (e) => e.employeeNumber || '—' },
          { label: 'Department', value: (e) => e.department?.name || '—' },
          { label: 'Designation', value: (e) => e.designation?.name || '—' },
          { label: 'Type', value: (e) => e.employmentType || '—' },
          { label: 'Date Joined', value: (e) => fmtDate(e.dateJoined) },
          { label: 'Status', bold: true, key: 'status', tone: (e) => STATUS_TONE[e.status] || '' },
        ],
        rows: emps,
        totalsRow: [`Total: ${emps.length} employee${emps.length !== 1 ? 's' : ''}`, ...Array(7).fill('')],
      });
    } catch {
      win.close();
      toast.dismiss(toastId);
      toast.error('Failed to load employees for printing');
    }
  }, [search, deptFilter, statusFilter, typeFilter, company]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-3 py-1.5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Employees</h1>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={refetch} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} /> Refresh
              </button>
              <button onClick={printAllEmployees} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                <FaPrint size={10} /> Print List
              </button>
              <button onClick={() => navigate('/hr/employees/new')} className="inline-flex h-7 items-center gap-1.5 rounded bg-[#FF8C00] px-3 text-xs font-black text-white hover:bg-[#e67e00]">
                <FaUserPlus size={10} /> Add Employee
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <ListToolbar>
          <div className="relative shrink-0">
            <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
            <ListToolbar.Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, email, ID number..."
              width="w-56"
              className="pl-5"
            />
          </div>
          <ListToolbar.Divider />
          <AppSelect value={deptFilter} onChange={(v) => setDeptFilter(v ?? '')} options={departmentOptions} placeholder="All departments" clearable searchable compact />
          <AppSelect value={statusFilter} onChange={(v) => setStatusFilter(v ?? '')} options={STATUS_OPTIONS} placeholder="All statuses" clearable compact />
          <AppSelect value={typeFilter} onChange={(v) => setTypeFilter(v ?? '')} options={TYPE_OPTIONS} placeholder="All types" clearable compact />
          <span className="ml-auto shrink-0 whitespace-nowrap pl-2 text-[9px] font-semibold text-slate-400">{total} result{total !== 1 ? 's' : ''}</span>
        </ListToolbar>

        {/* Table */}
        <MilikTable
          columns={[
            { label: 'Employee' },
            { label: 'Department' },
            { label: 'Designation' },
            { label: 'Type' },
            { label: 'Date Joined' },
            { label: 'Status' },
          ]}
          rows={employees}
          loading={loading}
          empty="No employees match the current filters."
          minWidth="700px"
          renderRow={(emp) => (
            <>
              <td className="px-3 py-1 border-r border-gray-100">
                <div className="flex items-center gap-2">
                  {emp.profilePicture ? (
                    <img
                      src={emp.profilePicture}
                      alt={initials(emp.surname, emp.otherNames)}
                      className="h-7 w-7 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-emerald-100 text-[10px] font-black text-emerald-800">
                      {initials(emp.surname, emp.otherNames)}
                    </div>
                  )}
                  <div>
                    <div className="font-black text-slate-900">{emp.surname} {emp.otherNames}</div>
                    <div className="text-[10px] text-slate-400">{emp.employeeNumber} {emp.phoneNumber ? `· ${emp.phoneNumber}` : ''}</div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-700">{emp.department?.name || <span className="text-slate-300">—</span>}</td>
              <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{emp.designation?.name || <span className="text-slate-300">—</span>}</td>
              <td className="px-3 py-1 border-r border-gray-100">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${TYPE_BADGE[emp.employmentType] || 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                  {emp.employmentType}
                </span>
              </td>
              <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{fmtDate(emp.dateJoined)}</td>
              <td className="px-3 py-1 border-r border-gray-100">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_BADGE[emp.status] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                  {emp.status}
                </span>
              </td>
            </>
          )}
          renderActions={(emp) => (
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
          )}
        />

        <PaginationBar
          page={page}
          pages={totalPages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          loading={loading}
          label="employees"
        />
      </div>

      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))} />
    </DashboardLayout>
  );
}

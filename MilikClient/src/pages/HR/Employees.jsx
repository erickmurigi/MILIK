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
import { fmtDate } from '../../utils/dates';

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

      const { companyName = '', logo = '', roadStreet = '', town = '', phoneNo = '', email: coEmail = '', taxPIN = '' } = company;
      const addr = [roadStreet, town].filter(Boolean).join(', ');

      const filterDesc = [
        statusFilter !== 'all' ? `Status: ${statusFilter}` : '',
        typeFilter   !== 'all' ? `Type: ${typeFilter}` : '',
        search ? `Search: "${search}"` : '',
      ].filter(Boolean).join(' · ') || 'All Employees';

      const STATUS_COLOR = {
        Active:     '#059669',
        Probation:  '#d97706',
        Suspended:  '#ea580c',
        Terminated: '#dc2626',
      };

      const rows = emps.map((e, i) => `
        <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
          <td class="num">${i + 1}</td>
          <td class="name">${e.surname} ${e.otherNames}</td>
          <td class="mono">${e.employeeNumber || '—'}</td>
          <td>${e.department?.name || '—'}</td>
          <td>${e.designation?.name || '—'}</td>
          <td>${e.employmentType || '—'}</td>
          <td>${fmtDate(e.dateJoined)}</td>
          <td><span class="badge" style="color:${STATUS_COLOR[e.status] || '#64748b'}">${e.status}</span></td>
        </tr>`).join('');

      const win = window.open('', '_blank', 'width=1050,height=1200');
      if (!win) { toast.error('Allow pop-ups to print'); return; }

      win.document.write(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Employee Directory</title>
<style>
  @page { size:A4 landscape; margin:12mm 14mm; }
  *,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
  html,body { background:#fff; font-family:Arial,Helvetica,sans-serif; font-size:9pt; color:#1a1a1a; }

  .lh { display:flex; align-items:flex-start; justify-content:space-between; padding-bottom:8px; border-bottom:2.5px solid #027333; margin-bottom:12px; }
  .lh-logo { height:40px; width:auto; border-radius:3px; }
  .lh-company { font-size:15pt; font-weight:900; color:#0f172a; }
  .lh-addr { font-size:7.5pt; color:#64748b; margin-top:2px; }
  .lh-meta { text-align:right; font-size:7.5pt; color:#64748b; line-height:1.6; }

  .doc-bar { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:1.5px solid #0f172a; padding-bottom:5px; margin-bottom:10px; }
  .doc-label { font-size:7pt; font-weight:700; text-transform:uppercase; letter-spacing:0.18em; color:#64748b; }
  .doc-title { font-size:13pt; font-weight:900; color:#0f172a; margin-top:2px; }
  .doc-sub { font-size:8pt; color:#64748b; }

  table { width:100%; border-collapse:collapse; }
  thead tr { background:#1B3D2F; color:#fff; }
  th { padding:5px 6px; text-align:left; font-size:7pt; font-weight:900; text-transform:uppercase; letter-spacing:0.14em; white-space:nowrap; }
  th.num { width:28px; text-align:center; }
  td { padding:4px 6px; font-size:8.5pt; border-bottom:1px solid #f1f5f9; vertical-align:middle; }
  td.num { text-align:center; color:#94a3b8; font-size:7.5pt; }
  td.mono { font-family:monospace; font-size:8pt; }
  td.name { font-weight:700; color:#0f172a; }
  tr.even { background:#fff; }
  tr.odd  { background:#f8fafc; }
  .badge { font-weight:900; font-size:7.5pt; }

  tfoot td { padding:6px; font-size:8pt; font-weight:900; color:#64748b; border-top:2px solid #e2e8f0; }

  .footer { margin-top:10px; display:flex; justify-content:space-between; font-size:7pt; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:5px; }
  @media print { html,body { background:#fff; } }
</style></head><body>

<div class="lh">
  <div>
    ${logo ? `<img src="${logo}" class="lh-logo" alt="${companyName}">` : ''}
    <div class="lh-company">${companyName}</div>
    ${addr ? `<div class="lh-addr">${addr}</div>` : ''}
  </div>
  <div class="lh-meta">
    ${coEmail ? coEmail + '<br>' : ''}${phoneNo ? phoneNo + '<br>' : ''}${taxPIN ? 'KRA PIN: ' + taxPIN : ''}
  </div>
</div>

<div class="doc-bar">
  <div>
    <div class="doc-label">Human Resource · Staff Directory</div>
    <div class="doc-title">Employee List</div>
    <div class="doc-sub">${filterDesc}</div>
  </div>
  <div class="doc-sub">Printed: ${new Date().toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'})} &nbsp;·&nbsp; ${emps.length} employee${emps.length !== 1 ? 's' : ''}</div>
</div>

<table>
  <thead>
    <tr>
      <th class="num">#</th>
      <th>Employee Name</th>
      <th>Emp. No.</th>
      <th>Department</th>
      <th>Designation</th>
      <th>Type</th>
      <th>Date Joined</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr>
      <td colspan="8">Total: ${emps.length} employee${emps.length !== 1 ? 's' : ''} &nbsp;·&nbsp; ${filterDesc} &nbsp;·&nbsp; Generated by ${companyName}</td>
    </tr>
  </tfoot>
</table>

<div class="footer">
  <span>This is a computer-generated staff directory.</span>
  <span>${companyName}</span>
</div>

</body></html>`);
      win.document.close();
      win.onload = () => { win.focus(); win.print(); };
    } catch (e) {
      toast.dismiss(toastId);
      toast.error('Failed to load employees for printing');
    }
  }, [search, deptFilter, statusFilter, typeFilter, company]);

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
              <button onClick={printAllEmployees} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                <FaPrint size={10} /> Print List
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
                className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
              />
            </div>
            <AppSelect value={deptFilter} onChange={(v) => setDeptFilter(v ?? '')} options={departmentOptions} placeholder="All departments" clearable searchable size="sm" />
            <AppSelect value={statusFilter} onChange={(v) => setStatusFilter(v ?? '')} options={STATUS_OPTIONS} placeholder="All statuses" clearable size="sm" />
            <AppSelect value={typeFilter} onChange={(v) => setTypeFilter(v ?? '')} options={TYPE_OPTIONS} placeholder="All types" clearable size="sm" />
            <span className="ml-auto text-[11px] font-semibold text-slate-500">{total} result{total !== 1 ? 's' : ''}</span>
          </div>
        </div>

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

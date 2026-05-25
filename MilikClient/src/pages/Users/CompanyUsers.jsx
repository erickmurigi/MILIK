import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  FaBan,
  FaCheckCircle,
  FaEllipsisV,
  FaLock,
  FaPlus,
  FaSearch,
  FaShieldAlt,
  FaUnlock,
  FaUserEdit,
  FaUsers,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { getUsers } from '../../redux/apiCalls';
import { adminRequests } from '../../utils/requestMethods';

const STATUS_FILTERS = ['All', 'Active', 'Locked', 'Inactive'];

const userStatusInfo = (user) => {
  if (user?.locked) return { label: 'Locked', color: 'bg-amber-100 text-amber-800' };
  if (user?.isActive === false) return { label: 'Inactive', color: 'bg-red-100 text-red-700' };
  return { label: 'Active', color: 'bg-emerald-100 text-emerald-700' };
};

const moduleAccessSummary = (user) => {
  const modules = [];
  const assignments = Array.isArray(user?.companyAssignments) ? user.companyAssignments : [];
  const seen = new Set();
  assignments.forEach((a) => {
    Object.entries(a?.moduleAccess || {}).forEach(([key, val]) => {
      if ((val === 'View only' || val === 'Full access') && !seen.has(key)) {
        seen.add(key);
        modules.push(key);
      }
    });
  });
  return modules;
};

const MODULE_SHORT = {
  propertyMgmt: 'Prop Mgmt',
  accounts: 'Accounts',
  humanResource: 'HR',
  propertySale: 'Sale',
  carwash: 'Car Wash',
  inventory: 'Inventory',
  procurement: 'Procurement',
};

export default function CompanyUsers({ darkMode }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const currentUser = useSelector((s) => s.auth?.currentUser);
  const users = useSelector((s) => s.user?.users || []);
  const isFetching = useSelector((s) => s.user?.isFetching);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [actionMenuId, setActionMenuId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const companyId = useMemo(() => {
    return currentCompany?._id || (typeof currentUser?.company === 'string' ? currentUser.company : currentUser?.company?._id);
  }, [currentCompany, currentUser]);

  const load = useCallback(() => {
    if (!companyId) return;
    dispatch(getUsers(companyId, { status: statusFilter === 'All' ? 'all' : statusFilter.toLowerCase() }));
  }, [companyId, dispatch, statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const close = () => setActionMenuId(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const name = `${u.surname || ''} ${u.otherNames || ''}`.toLowerCase();
      return name.includes(q) || (u.email || '').toLowerCase().includes(q) || (u.phoneNumber || '').toLowerCase().includes(q);
    });
  }, [users, search]);

  const handleToggleLock = async (user) => {
    const action = user.locked ? 'unlock' : 'lock';
    setTogglingId(user._id);
    setActionMenuId(null);
    try {
      await adminRequests.put(`/users/${user._id}`, { locked: !user.locked });
      toast.success(`User ${action}ed`);
      load();
    } catch {
      toast.error(`Failed to ${action} user`);
    } finally {
      setTogglingId(null);
    }
  };

  const handleToggleActive = async (user) => {
    const activate = user.isActive === false;
    setTogglingId(user._id);
    setActionMenuId(null);
    try {
      await adminRequests.put(`/users/${user._id}`, { isActive: activate });
      toast.success(activate ? 'User activated' : 'User deactivated');
      load();
    } catch {
      toast.error('Failed to update user status');
    } finally {
      setTogglingId(null);
    }
  };

  const base = darkMode ? 'bg-gray-900 text-gray-100' : 'bg-slate-50 text-gray-900';
  const card = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const inputCls = darkMode
    ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
    : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400';
  const headCls = darkMode ? 'bg-gray-750 text-gray-400 border-gray-700' : 'bg-slate-50 text-gray-500 border-gray-200';
  const rowCls = darkMode ? 'border-gray-700 hover:bg-gray-750' : 'border-gray-100 hover:bg-slate-50';

  return (
    <DashboardLayout lockContentScroll>
      <div className={`flex h-full min-h-0 flex-col overflow-hidden ${base}`}>

        {/* Header */}
        <div className={`flex-shrink-0 border-b px-4 py-2.5 shadow-sm ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <FaUsers className="text-[#1f4a35] text-sm" />
              <h1 className="text-sm font-black text-slate-900 dark:text-white">Users &amp; Access</h1>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-slate-100 text-slate-600'}`}>
                {filtered.length}
              </span>
            </div>
            <button
              onClick={() => navigate('/users/new', { state: { returnTo: '/users' } })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1f4a35] px-3 py-1.5 text-xs font-black text-white shadow-sm hover:bg-[#163728] transition-colors"
            >
              <FaPlus className="text-[10px]" /> Add User
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className={`flex-shrink-0 border-b px-4 py-2 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
          <div className="flex flex-wrap items-center gap-3">
            <div className={`flex items-center gap-2 rounded-lg border px-3 h-8 flex-1 max-w-xs ${inputCls}`}>
              <FaSearch className="shrink-0 text-[11px] text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, phone..."
                className="flex-1 bg-transparent text-xs outline-none"
              />
            </div>
            <div className="flex items-center gap-1">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${
                    statusFilter === f
                      ? 'bg-[#1f4a35] text-white'
                      : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-slate-100'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {isFetching ? (
            <div className="flex h-32 items-center justify-center text-xs text-gray-400">Loading users...</div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-xs text-gray-400">
              <FaUsers className="text-2xl opacity-30" />
              <span>{search ? 'No users match your search.' : 'No users found. Add your first user.'}</span>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className={`border-b text-left text-[10px] font-extrabold uppercase tracking-[0.14em] ${headCls}`}>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5 hidden sm:table-cell">Email</th>
                  <th className="px-4 py-2.5 hidden md:table-cell">Phone</th>
                  <th className="px-4 py-2.5 hidden lg:table-cell">Profile</th>
                  <th className="px-4 py-2.5 hidden lg:table-cell">Modules</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => {
                  const status = userStatusInfo(user);
                  const modules = moduleAccessSummary(user);
                  const fullName = `${user.surname || ''} ${user.otherNames || ''}`.trim();
                  const initials = `${(user.surname || '')[0] || ''}${(user.otherNames || '')[0] || ''}`.toUpperCase();
                  const isMe = user._id === currentUser?._id;
                  const busy = togglingId === user._id;

                  return (
                    <tr key={user._id} className={`border-b transition-colors ${rowCls} ${busy ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1f4a35] text-[10px] font-black text-white">
                            {initials || '?'}
                          </span>
                          <div>
                            <div className={`font-bold ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                              {fullName || '—'}
                              {isMe && <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-extrabold text-blue-700">You</span>}
                            </div>
                            <div className="text-[10px] text-gray-400 sm:hidden">{user.email || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell">
                        <span className={darkMode ? 'text-gray-300' : 'text-slate-700'}>{user.email || '—'}</span>
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <span className={darkMode ? 'text-gray-300' : 'text-slate-700'}>{user.phoneNumber || '—'}</span>
                      </td>
                      <td className="px-4 py-2.5 hidden lg:table-cell">
                        <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${darkMode ? 'border-gray-600 text-gray-300' : 'border-gray-200 text-slate-600'}`}>
                          {user.profile || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {modules.length === 0 ? (
                            <span className="text-[10px] text-gray-400">None</span>
                          ) : (
                            modules.slice(0, 3).map((m) => (
                              <span key={m} className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-slate-100 text-slate-600'}`}>
                                {MODULE_SHORT[m] || m}
                              </span>
                            ))
                          )}
                          {modules.length > 3 && (
                            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-slate-100 text-slate-500">+{modules.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${status.color}`}>
                          {status.label === 'Active' && <FaCheckCircle className="text-[9px]" />}
                          {status.label === 'Locked' && <FaLock className="text-[9px]" />}
                          {status.label === 'Inactive' && <FaBan className="text-[9px]" />}
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => navigate(`/users/${user._id}/edit`, { state: { returnTo: '/users' } })}
                            title="Edit user"
                            className={`rounded p-1.5 transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-slate-100 text-slate-500'}`}
                          >
                            <FaUserEdit className="text-[11px]" />
                          </button>
                          <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setActionMenuId(actionMenuId === user._id ? null : user._id)}
                              title="More actions"
                              className={`rounded p-1.5 transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-slate-100 text-slate-500'}`}
                            >
                              <FaEllipsisV className="text-[11px]" />
                            </button>
                            {actionMenuId === user._id && (
                              <div className={`absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border shadow-lg ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                                <button
                                  onClick={() => handleToggleLock(user)}
                                  disabled={busy}
                                  className={`flex w-full items-center gap-2 px-3 py-2 text-[11px] font-semibold transition-colors ${darkMode ? 'text-gray-200 hover:bg-gray-700' : 'text-slate-700 hover:bg-slate-50'}`}
                                >
                                  {user.locked ? <FaUnlock className="text-amber-500" /> : <FaLock className="text-amber-500" />}
                                  {user.locked ? 'Unlock user' : 'Lock user'}
                                </button>
                                {!isMe && (
                                  <button
                                    onClick={() => handleToggleActive(user)}
                                    disabled={busy}
                                    className={`flex w-full items-center gap-2 px-3 py-2 text-[11px] font-semibold transition-colors ${darkMode ? 'text-gray-200 hover:bg-gray-700' : 'text-slate-700 hover:bg-slate-50'}`}
                                  >
                                    {user.isActive === false ? (
                                      <><FaCheckCircle className="text-emerald-500" /> Activate user</>
                                    ) : (
                                      <><FaBan className="text-red-500" /> Deactivate user</>
                                    )}
                                  </button>
                                )}
                                <div className={`border-t mx-2 ${darkMode ? 'border-gray-700' : 'border-gray-100'}`} />
                                <button
                                  onClick={() => { navigate(`/users/${user._id}/edit`, { state: { returnTo: '/users' } }); setActionMenuId(null); }}
                                  className={`flex w-full items-center gap-2 px-3 py-2 text-[11px] font-semibold transition-colors ${darkMode ? 'text-gray-200 hover:bg-gray-700' : 'text-slate-700 hover:bg-slate-50'}`}
                                >
                                  <FaShieldAlt className="text-[#1f4a35]" /> Edit permissions
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </DashboardLayout>
  );
}

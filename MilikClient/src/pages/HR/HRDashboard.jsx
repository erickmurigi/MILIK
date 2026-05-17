import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FaUsers, FaUserCheck, FaUserClock, FaUserTimes, FaBuilding,
  FaRedoAlt, FaUserPlus, FaCog, FaChartBar,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const TYPE_COLORS = {
  Permanent: 'bg-emerald-100 text-emerald-800',
  Contract:  'bg-blue-100 text-blue-800',
  Casual:    'bg-amber-100 text-amber-800',
  Intern:    'bg-violet-100 text-violet-800',
};

const STATUS_COLORS = {
  Active:     'bg-emerald-100 text-emerald-700',
  Probation:  'bg-amber-100 text-amber-700',
  Suspended:  'bg-orange-100 text-orange-700',
  Terminated: 'bg-rose-100 text-rose-700',
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const initials = (s = '', o = '') => `${s.charAt(0)}${o.charAt(0)}`.toUpperCase() || 'EM';
const daysAgo = (d) => {
  const diff = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${diff}d ago`;
};

const StatCard = ({ icon: Icon, label, value, sub, color }) => (
  <div className={`flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm ${color || 'border-slate-200'}`}>
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${color ? color.replace('border-', 'bg-').replace('-400', '-100') : 'bg-slate-100'}`}>
      <Icon className={`text-base ${color ? color.replace('border-', 'text-').replace('-400', '-600') : 'text-slate-600'}`} />
    </div>
    <div className="min-w-0">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div>
      <div className="text-2xl font-black leading-tight text-slate-900">{value ?? '—'}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  </div>
);

export default function HRDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequests.get('/hr/employees/stats');
      setStats(res.data);
    } catch {
      toast.error('Failed to load HR summary');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const maxDept = Math.max(1, ...(stats?.byDepartment || []).map((d) => d.count));

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Dashboard</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} /> Refresh
              </button>
              <button onClick={() => navigate('/hr/setup')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaCog size={10} /> Setup
              </button>
              <button onClick={() => navigate('/hr/employees/new')} className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF8C00] px-3 py-1.5 text-xs font-black text-white hover:bg-[#e67e00]">
                <FaUserPlus size={10} /> Add Employee
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading HR summary...</div>
          ) : (
            <div className="space-y-4">

              {/* Stat Cards */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={FaUsers} label="Total Employees" value={stats?.total} color="border-slate-300" />
                <StatCard icon={FaUserCheck} label="Active" value={stats?.active} color="border-emerald-400" />
                <StatCard icon={FaUserClock} label="Probation" value={stats?.probation} color="border-amber-400" />
                <StatCard icon={FaUserTimes} label="Terminated YTD" value={stats?.terminatedYTD} color="border-rose-300" />
              </div>

              <div className="grid gap-4 lg:grid-cols-3">

                {/* By Department */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <FaBuilding className="text-emerald-700 text-xs" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">By Department</span>
                  </div>
                  {(stats?.byDepartment || []).length === 0 ? (
                    <p className="text-xs text-slate-400">No data yet</p>
                  ) : (
                    <div className="space-y-2">
                      {stats.byDepartment.map((d, i) => (
                        <div key={i}>
                          <div className="mb-0.5 flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-700 truncate">{d.name}</span>
                            <span className="ml-2 shrink-0 font-black text-slate-900">{d.count}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-100">
                            <div
                              className="h-1.5 rounded-full bg-emerald-500 transition-all"
                              style={{ width: `${Math.round((d.count / maxDept) * 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* By Employment Type */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <FaChartBar className="text-emerald-700 text-xs" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">By Employment Type</span>
                  </div>
                  {Object.keys(stats?.byType || {}).length === 0 ? (
                    <p className="text-xs text-slate-400">No data yet</p>
                  ) : (
                    <div className="space-y-2">
                      {['Permanent', 'Contract', 'Casual', 'Intern'].map((type) => (
                        (stats.byType[type] ?? 0) > 0 && (
                          <div key={type} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${TYPE_COLORS[type]}`}>{type}</span>
                            <span className="text-sm font-black text-slate-900">{stats.byType[type]}</span>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Joiners */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <FaUserPlus className="text-emerald-700 text-xs" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">Recent Joiners</span>
                  </div>
                  {(stats?.recentJoiners || []).length === 0 ? (
                    <p className="text-xs text-slate-400">No recent joiners</p>
                  ) : (
                    <div className="space-y-2">
                      {stats.recentJoiners.map((emp) => (
                        <div
                          key={emp._id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50"
                          onClick={() => navigate(`/hr/employees/${emp._id}`)}
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-[10px] font-black text-emerald-700">
                            {initials(emp.surname, emp.otherNames)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-black text-slate-900">{emp.surname} {emp.otherNames}</div>
                            <div className="text-[10px] text-slate-400">{emp.department?.name || 'No dept'} · {daysAgo(emp.dateJoined)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-500">Quick Actions</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'All Employees', route: '/hr/employees', icon: FaUsers },
                    { label: 'Add Employee', route: '/hr/employees/new', icon: FaUserPlus },
                    { label: 'Departments & Designations', route: '/hr/setup', icon: FaCog },
                  ].map(({ label, route, icon: Icon }) => (
                    <button
                      key={route}
                      onClick={() => navigate(route)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                    >
                      <Icon size={11} /> {label}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

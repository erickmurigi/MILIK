import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FaUsers, FaUserCheck, FaUserClock, FaUserTimes, FaBuilding,
  FaRedoAlt, FaUserPlus, FaCog, FaChartBar, FaMoneyBillWave,
  FaBell, FaCalendarAlt, FaFileAlt, FaChartPie, FaExclamationTriangle,
  FaCheckCircle, FaRegCalendarAlt, FaArrowRight, FaMars, FaVenus,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const fmtKES = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : '—';
const initials = (s = '', o = '') => `${s.charAt(0)}${o.charAt(0)}`.toUpperCase() || 'EM';
const daysAgo = (d) => {
  const diff = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 30) return `${diff}d ago`;
  if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
  return `${Math.floor(diff / 365)}yr ago`;
};
const daysLeft = (d) => Math.max(0, Math.ceil((new Date(d) - Date.now()) / 86400000));

const TYPE_COLORS = {
  Permanent: 'bg-emerald-100 text-emerald-800',
  Contract:  'bg-blue-100 text-blue-800',
  Casual:    'bg-amber-100 text-amber-800',
  Intern:    'bg-violet-100 text-violet-800',
};

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, accent, onClick }) {
  return (
    <button onClick={onClick} className={`group flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm text-left w-full transition-all hover:shadow-md ${accent?.border || 'border-slate-200'} ${onClick ? 'cursor-pointer' : 'cursor-default'}`}>
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${accent?.bg || 'bg-slate-100'}`}>
        <Icon className={`text-base ${accent?.icon || 'text-slate-600'}`}/>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div>
        <div className="text-2xl font-black leading-tight text-slate-900">{value ?? '—'}</div>
        {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
      </div>
      {onClick && <FaArrowRight size={9} className="text-slate-300 group-hover:text-slate-500 shrink-0"/>}
    </button>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, color = 'text-emerald-700', action }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon size={11} className={color}/>
        <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">{title}</span>
      </div>
      {action}
    </div>
  );
}

export default function HRDashboard() {
  const navigate = useNavigate();
  const [stats, setStats]   = useState(null);
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

  const maxDept = useMemo(
    () => Math.max(1, ...(stats?.byDepartment || []).map((d) => d.count)),
    [stats]
  );

  const alerts = useMemo(() => {
    if (!stats) return [];
    const items = [];
    if (stats.pendingLeave > 0)
      items.push({ type: 'leave',   color: 'bg-amber-50 border-amber-200 text-amber-800', dot: 'bg-amber-400', label: `${stats.pendingLeave} leave application${stats.pendingLeave > 1 ? 's' : ''} awaiting approval`, route: '/hr/leave' });
    if (stats.suspended > 0)
      items.push({ type: 'suspend', color: 'bg-orange-50 border-orange-200 text-orange-800', dot: 'bg-orange-400', label: `${stats.suspended} employee${stats.suspended > 1 ? 's' : ''} currently suspended`, route: '/hr/employees' });
    if ((stats.probationEndingSoon || []).length > 0)
      items.push({ type: 'prob',   color: 'bg-blue-50 border-blue-200 text-blue-800', dot: 'bg-blue-400', label: `${stats.probationEndingSoon.length} employee${stats.probationEndingSoon.length > 1 ? 's' : ''} ending probation within 30 days`, route: '/hr/employees' });
    if (stats.onLeaveToday > 0)
      items.push({ type: 'out',    color: 'bg-indigo-50 border-indigo-200 text-indigo-800', dot: 'bg-indigo-400', label: `${stats.onLeaveToday} employee${stats.onLeaveToday > 1 ? 's' : ''} on approved leave today`, route: '/hr/leave' });
    return items;
  }, [stats]);

  const { genderM, genderF, genderTotal } = useMemo(() => {
    const m = stats?.byGender?.Male   || stats?.byGender?.M || 0;
    const f = stats?.byGender?.Female || stats?.byGender?.F || 0;
    return { genderM: m, genderF: f, genderTotal: Math.max(1, m + f) };
  }, [stats]);

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
                <FaRedoAlt size={10}/> Refresh
              </button>
              <button onClick={() => navigate('/hr/setup')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaCog size={10}/> Setup
              </button>
              <button onClick={() => navigate('/hr/employees/new')} className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF8C00] px-3 py-1.5 text-xs font-black text-white hover:bg-[#e67e00]">
                <FaUserPlus size={10}/> Add Employee
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <div className="text-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent mx-auto mb-2"/>
                <p className="text-xs text-slate-400">Loading HR summary…</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 max-w-7xl mx-auto">

              {/* ── Row 1: KPI cards ─────────────────────────────────────── */}
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <KpiCard icon={FaUsers}     label="Total Employees" value={stats?.total}         sub={`${stats?.active || 0} active`} accent={{ border: 'border-slate-300', bg: 'bg-slate-100', icon: 'text-slate-600' }} onClick={() => navigate('/hr/employees')}/>
                <KpiCard icon={FaUserCheck} label="Active Staff"    value={stats?.active}        sub={stats?.probation > 0 ? `${stats.probation} on probation` : 'All confirmed'} accent={{ border: 'border-emerald-300', bg: 'bg-emerald-100', icon: 'text-emerald-700' }} onClick={() => navigate('/hr/employees')}/>
                <KpiCard icon={FaUserClock} label="On Leave Today"  value={stats?.onLeaveToday ?? 0}  sub={`${stats?.pendingLeave || 0} pending approval`} accent={{ border: 'border-blue-300', bg: 'bg-blue-100', icon: 'text-blue-600' }} onClick={() => navigate('/hr/leave')}/>
                <KpiCard icon={FaUserTimes} label="Terminated YTD"  value={stats?.terminatedYTD} sub="This calendar year" accent={{ border: 'border-rose-300', bg: 'bg-rose-100', icon: 'text-rose-600' }}/>
              </div>

              {/* ── Row 2: Payroll + Alerts + Leave ─────────────────────── */}
              <div className="grid gap-4 lg:grid-cols-3">

                {/* Payroll summary */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <SectionHeader icon={FaMoneyBillWave} title="Payroll Overview" action={
                    <button onClick={() => navigate('/hr/payroll')} className="text-[10px] font-black text-emerald-700 hover:underline">View →</button>
                  }/>
                  {stats?.payrollSummary ? (
                    <div className="space-y-2">
                      <div className="rounded-lg bg-slate-50 p-3 text-center">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{stats.payrollSummary.periodName}</div>
                        <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black ${stats.payrollSummary.status === 'Draft' ? 'bg-amber-100 text-amber-700' : stats.payrollSummary.status === 'Processed' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {stats.payrollSummary.status}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="rounded-lg border border-slate-100 p-2.5 text-center">
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Gross Pay</div>
                          <div className="text-sm font-black text-slate-900 mt-0.5">{fmtKES(stats.payrollSummary.grossTotal)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-100 p-2.5 text-center">
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Net Pay</div>
                          <div className="text-sm font-black text-emerald-700 mt-0.5">{fmtKES(stats.payrollSummary.netTotal)}</div>
                        </div>
                      </div>
                      <div className="text-center text-[10px] text-slate-400">{stats.payrollSummary.count} payslips generated</div>
                    </div>
                  ) : (
                    <div className="flex h-28 flex-col items-center justify-center gap-2 text-slate-300">
                      <FaMoneyBillWave size={20}/>
                      <p className="text-xs font-black">No payroll period yet</p>
                      <button onClick={() => navigate('/hr/payroll')} className="text-[10px] font-black text-emerald-700 hover:underline">Create First Period →</button>
                    </div>
                  )}
                </div>

                {/* Action required */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <SectionHeader icon={FaBell} title="Requires Attention"
                    color={alerts.length > 0 ? 'text-amber-500' : 'text-emerald-600'}
                    action={alerts.length > 0 ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black text-white">{alerts.length}</span> : null}
                  />
                  {alerts.length === 0 ? (
                    <div className="flex h-28 flex-col items-center justify-center gap-2">
                      <FaCheckCircle size={22} className="text-emerald-400"/>
                      <p className="text-xs font-black text-emerald-700">All clear — nothing pending</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {alerts.map((a, i) => (
                        <button key={i} onClick={() => navigate(a.route)} className={`w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left hover:opacity-80 transition-opacity ${a.color}`}>
                          <span className={`h-2 w-2 shrink-0 rounded-full ${a.dot}`}/>
                          <span className="text-[11px] font-semibold">{a.label}</span>
                          <FaArrowRight size={8} className="ml-auto shrink-0"/>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Probation ending soon */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <SectionHeader icon={FaCalendarAlt} title="Probation Ending Soon" color="text-blue-600"/>
                  {(stats?.probationEndingSoon || []).length === 0 ? (
                    <div className="flex h-28 flex-col items-center justify-center gap-2 text-slate-300">
                      <FaRegCalendarAlt size={20}/>
                      <p className="text-xs font-black">No probations ending soon</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {stats.probationEndingSoon.map((emp) => {
                        const days = daysLeft(emp.probationEndDate);
                        return (
                          <div key={emp._id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-[9px] font-black text-blue-700">
                              {initials(emp.surname, emp.otherNames)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[11px] font-black text-slate-900">{emp.surname} {emp.otherNames}</div>
                              <div className="text-[10px] text-slate-400">{emp.department?.name || '—'}</div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${days <= 7 ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                              {days}d left
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Row 3: Dept + Type + Gender + Recent ────────────────── */}
              <div className="grid gap-4 lg:grid-cols-4">

                {/* By Department */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <SectionHeader icon={FaBuilding} title="By Department"/>
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
                            <div className="h-1.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.round((d.count / maxDept) * 100)}%` }}/>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* By Employment Type */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <SectionHeader icon={FaChartBar} title="Employment Type"/>
                  {Object.keys(stats?.byType || {}).length === 0 ? (
                    <p className="text-xs text-slate-400">No data yet</p>
                  ) : (
                    <div className="space-y-1.5">
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

                {/* Gender breakdown */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <SectionHeader icon={FaChartPie} title="Gender Breakdown"/>
                  {genderTotal === 1 && genderM === 0 && genderF === 0 ? (
                    <p className="text-xs text-slate-400">No gender data</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-center gap-4 pt-1">
                        <div className="text-center">
                          <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-blue-100"><FaMars size={18} className="text-blue-600"/></div>
                          <div className="text-lg font-black text-slate-900 mt-1">{genderM}</div>
                          <div className="text-[10px] text-slate-400">Male</div>
                        </div>
                        <div className="h-10 w-px bg-slate-200"/>
                        <div className="text-center">
                          <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-pink-100"><FaVenus size={18} className="text-pink-600"/></div>
                          <div className="text-lg font-black text-slate-900 mt-1">{genderF}</div>
                          <div className="text-[10px] text-slate-400">Female</div>
                        </div>
                      </div>
                      <div className="h-2 w-full rounded-full overflow-hidden flex">
                        <div className="h-full bg-blue-400 transition-all" style={{ width: `${Math.round((genderM / genderTotal) * 100)}%` }}/>
                        <div className="h-full bg-pink-400 flex-1"/>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>{Math.round((genderM / genderTotal) * 100)}% Male</span>
                        <span>{Math.round((genderF / genderTotal) * 100)}% Female</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Recent Joiners */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <SectionHeader icon={FaUserPlus} title="Recent Joiners" action={
                    <button onClick={() => navigate('/hr/employees')} className="text-[10px] font-black text-emerald-700 hover:underline">All →</button>
                  }/>
                  {(stats?.recentJoiners || []).length === 0 ? (
                    <p className="text-xs text-slate-400">No recent joiners</p>
                  ) : (
                    <div className="space-y-1.5">
                      {stats.recentJoiners.map((emp) => (
                        <button key={emp._id} onClick={() => navigate(`/hr/employees/${emp._id}`)} className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2 hover:bg-slate-50 text-left">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-[9px] font-black text-emerald-700">
                            {initials(emp.surname, emp.otherNames)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11px] font-black text-slate-900">{emp.surname} {emp.otherNames}</div>
                            <div className="text-[10px] text-slate-400">{emp.department?.name || 'No dept'} · {daysAgo(emp.dateJoined)}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Row 4: Quick Actions ─────────────────────────────────── */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-500">Quick Actions</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'All Employees',       route: '/hr/employees',           icon: FaUsers },
                    { label: 'Add Employee',         route: '/hr/employees/new',       icon: FaUserPlus },
                    { label: 'Leave Approvals',      route: '/hr/leave',               icon: FaCalendarAlt },
                    { label: 'Payroll',              route: '/hr/payroll',             icon: FaMoneyBillWave },
                    { label: 'Payroll Register',     route: '/hr/payroll/register',    icon: FaChartBar },
                    { label: 'Remittance Reports',   route: '/hr/reports/remittance',  icon: FaFileAlt },
                    { label: 'HR Letters',           route: '/hr/letters',             icon: FaFileAlt },
                    { label: 'Setup',                route: '/hr/setup',               icon: FaCog },
                  ].map(({ label, route, icon: Icon }) => (
                    <button key={route} onClick={() => navigate(route)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 transition-colors">
                      <Icon size={10}/> {label}
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

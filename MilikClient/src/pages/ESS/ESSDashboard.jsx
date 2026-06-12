import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { essRequests } from '../../utils/essRequests';
import { useESS } from '../../context/ESSContext';
import './ESS.css';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—';

export default function ESSDashboard() {
  const navigate = useNavigate();
  const { employee } = useESS();

  const [stats,     setStats]     = useState(null);
  const [balances,  setBalances]  = useState([]);
  const [payslip,   setPayslip]   = useState(null);
  const [today,     setToday]     = useState(null);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [balRes, psRes, todayRes] = await Promise.all([
        essRequests.get('hr/ess/my/leave-balances'),
        essRequests.get('hr/ess/my/payslips?limit=1'),
        essRequests.get('hr/ess/my/attendance/today'),
      ]);
      setBalances(balRes.data.balances || []);
      setPayslip(psRes.data.payslips?.[0] || null);
      setToday(todayRes.data.record || null);
    } catch { /* errors handled by interceptor */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="ess-loading">Loading...</div>;

  return (
    <div>
      <h1 className="ess-page-title">
        Welcome back, {employee?.otherNames || employee?.surname}
      </h1>

      {/* Quick stats */}
      <div className="ess-stats-grid">
        <div className="ess-stat-card">
          <div className="ess-stat-label">Latest Payslip</div>
          <div className="ess-stat-value" style={{ fontSize: '1rem', marginTop: '0.25rem' }}>
            {payslip?.payrollPeriod?.label || '—'}
          </div>
          <div className="ess-stat-sub">
            {payslip ? `Net: KES ${Number(payslip.netSalary || 0).toLocaleString()}` : 'No payslips yet'}
          </div>
        </div>

        <div className="ess-stat-card">
          <div className="ess-stat-label">Today&apos;s Attendance</div>
          <div className="ess-stat-value" style={{ fontSize: '1rem', marginTop: '0.25rem' }}>
            {today ? (today.checkOut ? 'Checked Out' : 'Checked In') : 'Not checked in'}
          </div>
          <div className="ess-stat-sub">
            {today ? `In: ${fmtTime(today.checkIn)}${today.checkOut ? ` · Out: ${fmtTime(today.checkOut)}` : ''}` : '—'}
          </div>
        </div>

        <div className="ess-stat-card">
          <div className="ess-stat-label">Leave Remaining</div>
          <div className="ess-stat-value">
            {balances.length > 0 ? balances.reduce((s, b) => s + b.remaining, 0) : '—'}
          </div>
          <div className="ess-stat-sub">
            {balances.length > 0 ? 'days across all types' : 'No leave types configured'}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        {/* Leave balances */}
        <div className="ess-card">
          <div className="ess-card-header">
            <h2>Leave Balances ({new Date().getFullYear()})</h2>
            <button className="ess-btn ess-btn-outline" onClick={() => navigate('/ess/leave')}>
              Apply
            </button>
          </div>
          <div className="ess-table-wrap">
            {balances.length === 0
              ? <div className="ess-empty">No leave types configured</div>
              : (
                <table className="ess-table">
                  <thead>
                    <tr>
                      <th>Leave Type</th>
                      <th>Entitled</th>
                      <th>Used</th>
                      <th>Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((b) => (
                      <tr key={b.leaveType._id}>
                        <td>{b.leaveType.name}</td>
                        <td>{b.entitlement}</td>
                        <td>{b.used}</td>
                        <td><strong style={{ color: b.remaining > 0 ? '#15803d' : '#dc2626' }}>{b.remaining}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        </div>

        {/* Quick actions */}
        <div className="ess-card">
          <div className="ess-card-header">
            <h2>Quick Actions</h2>
          </div>
          <div className="ess-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <button className="ess-btn ess-btn-primary" style={{ justifyContent: 'flex-start' }}
              onClick={() => navigate('/ess/attendance')}>
              Clock In / Out
            </button>
            <button className="ess-btn ess-btn-outline" style={{ justifyContent: 'flex-start' }}
              onClick={() => navigate('/ess/leave')}>
              Apply for Leave
            </button>
            <button className="ess-btn ess-btn-outline" style={{ justifyContent: 'flex-start' }}
              onClick={() => navigate('/ess/payslips')}>
              View Payslips
            </button>
            <button className="ess-btn ess-btn-outline" style={{ justifyContent: 'flex-start' }}
              onClick={() => navigate('/ess/letters')}>
              My Letters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

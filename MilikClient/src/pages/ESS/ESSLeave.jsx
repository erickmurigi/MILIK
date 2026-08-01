import { useState, useEffect, useCallback, useMemo } from 'react';
import { essRequests } from '../../utils/essRequests';
import { useTabState } from '../../hooks/useTabState';
import AppSelect from '../../components/common/AppSelect';
import './ESS.css';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_BADGE = {
  Pending:   'ess-badge-yellow',
  Approved:  'ess-badge-green',
  Rejected:  'ess-badge-red',
  Cancelled: 'ess-badge-gray',
};

const today = new Date().toISOString().slice(0, 10);

export default function ESSLeave() {
  const [applications, setApplications] = useState([]);
  const [balances,     setBalances]     = useState([]);
  const [leaveTypes,   setLeaveTypes]   = useState([]);
  const [total,        setTotal]        = useState(0);
  const [totalPages,   setTotalPages]   = useState(1);
  const [page,         setPage]         = useTabState("/ess/leave:page", 1);
  const [loading,      setLoading]      = useState(true);
  const [showForm,     setShowForm]     = useState(false);
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');

  const [form, setForm] = useState({
    leaveType: '',
    startDate: '',
    endDate:   '',
    reason:    '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appsRes, balRes, ltRes] = await Promise.all([
        essRequests.get(`hr/ess/my/leave-applications?page=${page}&limit=15`),
        essRequests.get('hr/ess/my/leave-balances'),
        essRequests.get('hr/ess/my/leave-types'),
      ]);
      setApplications(appsRes.data.applications || []);
      setTotal(appsRes.data.total || 0);
      setTotalPages(appsRes.data.totalPages || 1);
      setBalances(balRes.data.balances || []);
      setLeaveTypes(ltRes.data.types || []);
    } catch {} finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const workingDays = useMemo(() => {
    if (!form.startDate || !form.endDate) return 0;
    const start = new Date(form.startDate);
    const end   = new Date(form.endDate);
    if (end < start) return 0;
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const d = cur.getDay();
      if (d !== 0 && d !== 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count || 1;
  }, [form.startDate, form.endDate]);

  const selectedBalance = useMemo(
    () => balances.find((b) => b.leaveType._id === form.leaveType),
    [balances, form.leaveType]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!form.leaveType || !form.startDate || !form.endDate) {
      setError('Leave type, start date, and end date are required');
      return;
    }
    if (form.endDate < form.startDate) {
      setError('End date must be on or after start date');
      return;
    }
    setSubmitting(true);
    try {
      await essRequests.post('hr/ess/my/leave-applications', {
        leaveType: form.leaveType,
        startDate: form.startDate,
        endDate:   form.endDate,
        reason:    form.reason,
      });
      setSuccess('Leave application submitted successfully');
      setShowForm(false);
      setForm({ leaveType: '', startDate: '', endDate: '', reason: '' });
      setPage(1);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit application');
    } finally { setSubmitting(false); }
  };

  const handleCancel = useCallback(async (id) => {
    if (!window.confirm('Cancel this leave application?')) return;
    try {
      await essRequests.patch(`hr/ess/my/leave-applications/${id}/cancel`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to cancel');
    }
  }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <h1 className="ess-page-title" style={{ margin: 0 }}>Leave</h1>
        <button className="ess-btn ess-btn-primary" onClick={() => { setShowForm(true); setError(''); setSuccess(''); }}>
          Apply for Leave
        </button>
      </div>

      {success && <div className="ess-alert ess-alert-success">{success}</div>}

      {/* Leave Balances */}
      <div className="ess-card" style={{ marginBottom: '1.25rem' }}>
        <div className="ess-card-header"><h2>Leave Balances ({new Date().getFullYear()})</h2></div>
        <div className="ess-table-wrap">
          {balances.length === 0
            ? <div className="ess-empty">No leave types configured</div>
            : (
              <table className="ess-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Entitled</th>
                    <th>Used</th>
                    <th>Pending</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.leaveType._id}>
                      <td>{b.leaveType.name}</td>
                      <td>{b.entitlement}</td>
                      <td>{b.used}</td>
                      <td>{b.pending}</td>
                      <td>
                        <strong style={{ color: b.remaining > 0 ? '#15803d' : '#dc2626' }}>
                          {b.remaining}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>
      </div>

      {/* Applications list */}
      <div className="ess-card">
        <div className="ess-card-header">
          <h2>My Applications ({total})</h2>
        </div>
        <div className="ess-table-wrap">
          {loading
            ? <div className="ess-loading">Loading...</div>
            : applications.length === 0
              ? <div className="ess-empty">No leave applications found</div>
              : (
                <table className="ess-table">
                  <thead>
                    <tr>
                      <th>Leave Type</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Days</th>
                      <th>Status</th>
                      <th>Applied</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((app) => (
                      <tr key={app._id}>
                        <td>{app.leaveType?.name || '—'}</td>
                        <td>{fmtDate(app.startDate)}</td>
                        <td>{fmtDate(app.endDate)}</td>
                        <td>{app.days}</td>
                        <td>
                          <span className={`ess-badge ${STATUS_BADGE[app.status] || 'ess-badge-gray'}`}>
                            {app.status}
                          </span>
                        </td>
                        <td>{fmtDate(app.createdAt)}</td>
                        <td>
                          {app.status === 'Pending' && (
                            <button className="ess-btn ess-btn-danger" onClick={() => handleCancel(app._id)}>
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          }
        </div>
        {totalPages > 1 && (
          <div className="ess-pagination">
            <button onClick={() => setPage((p) => p - 1)} disabled={page === 1}>Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page === totalPages}>Next</button>
          </div>
        )}
      </div>

      {/* Apply leave modal */}
      {showForm && (
        <div className="ess-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="ess-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ess-modal-header">
              <h3>Apply for Leave</h3>
              <button className="ess-modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="ess-modal-body">
                {error && <div className="ess-alert ess-alert-error">{error}</div>}

                <div className="ess-form">
                  <div className="ess-form-group">
                    <AppSelect label="Leave Type" value={form.leaveType} onChange={(v) => setForm((p) => ({ ...p, leaveType: v ?? '' }))} options={leaveTypes.map((lt) => ({ value: lt._id, label: lt.name }))} placeholder="Select leave type" size="md" />
                  </div>

                  {selectedBalance && (
                    <div style={{ fontSize: '0.8rem', color: '#6b7280', background: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
                      Balance: <strong>{selectedBalance.remaining}</strong> days remaining
                      {selectedBalance.leaveType.requiresApproval && (
                        <span style={{ marginLeft: 8, color: '#854d0e' }}>· Requires approval</span>
                      )}
                    </div>
                  )}

                  <div className="ess-form-row">
                    <div className="ess-form-group">
                      <label>Start Date</label>
                      <input type="date" value={form.startDate} onChange={set('startDate')} min={today} />
                    </div>
                    <div className="ess-form-group">
                      <label>End Date</label>
                      <input type="date" value={form.endDate} onChange={set('endDate')} min={form.startDate || today} />
                    </div>
                  </div>

                  {workingDays > 0 && (
                    <div style={{ fontSize: '0.8rem', color: '#374151' }}>
                      Working days: <strong>{workingDays}</strong>
                    </div>
                  )}

                  <div className="ess-form-group">
                    <label>Reason (optional)</label>
                    <textarea
                      rows={3}
                      value={form.reason}
                      onChange={set('reason')}
                      placeholder="Briefly describe the reason for leave"
                    />
                  </div>
                </div>
              </div>
              <div className="ess-modal-footer">
                <button type="button" className="ess-btn ess-btn-outline" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="ess-btn ess-btn-primary" disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Submit Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

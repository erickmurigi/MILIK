import { useState, useEffect, useCallback, useMemo } from 'react';
import { essRequests } from '../../utils/essRequests';
import './ESS.css';

const fmtTime  = (d) => d ? new Date(d).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-KE', { weekday: 'short', day: '2-digit', month: 'short' }) : '—';
const fmtDuration = (mins) => {
  if (!mins) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export default function ESSAttendance() {
  const now = new Date();
  const [month,    setMonth]    = useState(now.getMonth() + 1);
  const [year,     setYear]     = useState(now.getFullYear());
  const [records,  setRecords]  = useState([]);
  const [total,    setTotal]    = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page,     setPage]     = useState(1);
  const [today,    setToday]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [checking, setChecking] = useState(false);
  const [clock,    setClock]    = useState(new Date());
  const [note,     setNote]     = useState('');

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadToday = useCallback(async () => {
    try {
      const { data } = await essRequests.get('hr/ess/my/attendance/today');
      setToday(data.record || null);
    } catch {}
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await essRequests.get(
        `hr/ess/my/attendance?month=${month}&year=${year}&page=${page}&limit=31`
      );
      setRecords(data.records || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch {} finally { setLoading(false); }
  }, [month, year, page]);

  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => { setPage(1); }, [month, year]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleCheckIn = useCallback(async () => {
    setChecking(true);
    try {
      await essRequests.post('hr/ess/my/attendance/check-in', { note });
      setNote('');
      await loadToday();
      loadHistory();
    } catch (err) {
      alert(err.response?.data?.message || 'Check-in failed');
    } finally { setChecking(false); }
  }, [note, loadToday, loadHistory]);

  const handleCheckOut = useCallback(async () => {
    if (!today) return;
    setChecking(true);
    try {
      await essRequests.patch(`hr/ess/my/attendance/${today._id}/check-out`, { note });
      setNote('');
      await loadToday();
      loadHistory();
    } catch (err) {
      alert(err.response?.data?.message || 'Check-out failed');
    } finally { setChecking(false); }
  }, [today, note, loadToday, loadHistory]);

  const checkedIn  = !!today && !today.checkOut;
  const checkedOut = !!today?.checkOut;

  const months = useMemo(() => [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ], []);

  const totalHours = useMemo(() => {
    const mins = records.filter((r) => r.duration).reduce((s, r) => s + r.duration, 0);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }, [records]);

  return (
    <div>
      <h1 className="ess-page-title">Attendance</h1>

      {/* Clock-in panel */}
      <div className="ess-checkin-panel">
        <div className="ess-checkin-time">
          {clock.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
        <div className="ess-checkin-date">
          {clock.toLocaleDateString('en-KE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
        </div>
        <div className="ess-checkin-status">
          {checkedOut ? `Checked out at ${fmtTime(today.checkOut)}` :
           checkedIn  ? `Checked in at ${fmtTime(today.checkIn)}` :
           'Not checked in today'}
        </div>
        {!checkedOut && (
          <input
            type="text"
            placeholder="Optional note (e.g. WFH, Site visit)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, padding: '0.5rem 1rem', color: '#fff', width: '100%', maxWidth: 320, outline: 'none', fontSize: '0.85rem' }}
          />
        )}
        {!checkedOut && (
          <button
            className={`ess-checkin-btn${checkedIn ? ' checkout' : ''}`}
            onClick={checkedIn ? handleCheckOut : handleCheckIn}
            disabled={checking}
          >
            {checking ? 'Processing...' : checkedIn ? 'Check Out' : 'Check In'}
          </button>
        )}
        {checkedOut && today?.duration && (
          <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>
            Total time: {fmtDuration(today.duration)}
          </div>
        )}
      </div>

      {/* History */}
      <div className="ess-card">
        <div className="ess-card-header">
          <h2>Attendance History</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              style={{ padding: '0.3rem 0.5rem', border: '1.5px solid #d1d5db', borderRadius: 6, fontSize: '0.8rem' }}
            >
              {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={{ padding: '0.3rem 0.5rem', border: '1.5px solid #d1d5db', borderRadius: 6, fontSize: '0.8rem' }}
            >
              {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {records.length > 0 && (
          <div style={{ padding: '0.625rem 1.25rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.8rem', color: '#6b7280' }}>
            {records.length} days · Total: <strong>{totalHours}</strong>
          </div>
        )}

        <div className="ess-table-wrap">
          {loading
            ? <div className="ess-loading">Loading...</div>
            : records.length === 0
              ? <div className="ess-empty">No attendance records for {months[month - 1]} {year}</div>
              : (
                <table className="ess-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Check In</th>
                      <th>Check Out</th>
                      <th>Duration</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r._id}>
                        <td>{fmtDate(r.checkIn)}</td>
                        <td>{fmtTime(r.checkIn)}</td>
                        <td>{r.checkOut ? fmtTime(r.checkOut) : <span className="ess-badge ess-badge-yellow">Open</span>}</td>
                        <td>{fmtDuration(r.duration)}</td>
                        <td style={{ color: '#6b7280' }}>{r.note || '—'}</td>
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
    </div>
  );
}

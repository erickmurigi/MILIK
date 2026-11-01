import { useState, useEffect, useCallback } from 'react';
import { landlordPortalRequests } from '../../utils/landlordPortalRequests';
import { useTabState } from '../../hooks/useTabState';
import './LandlordPortal.css';

const fmtC = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
const fmtD = (d) => (d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const STATUS_BADGE = {
  approved: 'lp-badge-blue',
  sent:     'lp-badge-green',
  revised:  'lp-badge-yellow',
};

function LiveSnapshot() {
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState('');
  const [period,     setPeriod]     = useState('this_month');
  const [snapshot,   setSnapshot]   = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    landlordPortalRequests.get('landlord-portal/properties')
      .then(({ data }) => {
        const list = data?.data || [];
        setProperties(list);
        if (list.length) setPropertyId((prev) => prev || list[0]._id);
      })
      .catch(() => {});
  }, []);

  const loadSnapshot = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(false);
    try {
      // Unlike the other portal endpoints, this one runs the full statement-generation
      // engine live (no pre-computed/cached rows to read) — genuinely slower than the
      // axios instance's default 30s timeout for a property with a lot of history.
      const { data } = await landlordPortalRequests.get(`landlord-portal/live-statement?propertyId=${propertyId}&period=${period}`, { timeout: 60000 });
      setSnapshot(data.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [propertyId, period]);

  useEffect(() => { loadSnapshot(); }, [loadSnapshot]);

  const downloadLivePdf = useCallback(async () => {
    if (!propertyId) return;
    setDownloadingPdf(true);
    try {
      // Same live-computation cost as above, plus a real Puppeteer render on top — a cold
      // browser launch after a backend restart alone can push this past the default 30s.
      const res = await landlordPortalRequests.get(
        `landlord-portal/live-statement/pdf?propertyId=${propertyId}&period=${period}`,
        { responseType: 'blob', timeout: 90000 }
      );
      const url = URL.createObjectURL(res.data);
      const a = Object.assign(document.createElement('a'), { href: url, download: `Live_Statement_${period}.pdf` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.alert('Could not generate the live statement PDF. Please try again.');
    } finally {
      setDownloadingPdf(false);
    }
  }, [propertyId, period]);

  if (!properties.length) return null;

  return (
    <div className="lp-card" style={{ marginBottom: '1.25rem' }}>
      <div className="lp-card-header">
        <h2>Live Snapshot</h2>
        <span className="lp-badge lp-badge-yellow">Unapproved — subject to change</span>
      </div>
      <div className="lp-card-body">
        <div className="lp-form-row">
          {properties.length > 1 && (
            <div className="lp-form-group">
              <label>Property</label>
              <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                {properties.map((p) => (
                  <option key={p._id} value={p._id}>{p.propertyCode ? `${p.propertyCode} – ${p.propertyName}` : p.propertyName}</option>
                ))}
              </select>
            </div>
          )}
          <div className="lp-form-group">
            <label>Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="this_month">This Month (to date)</option>
              <option value="last_month">Last Month</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="lp-loading">Loading…</div>
        ) : error ? (
          <div className="lp-empty">Could not load the live snapshot. Please try again.</div>
        ) : snapshot ? (
          <div className="lp-stats-grid" style={{ marginTop: '1rem' }}>
            <div className="lp-stat-card">
              <div className="lp-stat-label">Opening Balance</div>
              <div className="lp-stat-value">{fmtC(snapshot.openingBalance)}</div>
            </div>
            <div className="lp-stat-card">
              <div className="lp-stat-label">Net for Period</div>
              <div className="lp-stat-value">{fmtC(snapshot.periodNet)}</div>
            </div>
            <div className="lp-stat-card">
              <div className="lp-stat-label">Closing Balance</div>
              <div className="lp-stat-value">{fmtC(snapshot.closingBalance)}</div>
              <div className="lp-stat-sub">{fmtD(snapshot.periodStart)} – {fmtD(snapshot.periodEnd)}</div>
            </div>
          </div>
        ) : null}

        {snapshot && !loading && !error && (
          <button
            className="lp-btn lp-btn-outline"
            style={{ marginTop: '1rem' }}
            onClick={downloadLivePdf}
            disabled={downloadingPdf}
          >
            {downloadingPdf ? 'Preparing…' : 'Download Live Statement (PDF)'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function LandlordPortalStatements() {
  const [statements, setStatements] = useState([]);
  const [total,      setTotal]      = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page,       setPage]       = useTabState('/landlord-portal/statements:page', 1);
  const [loading,    setLoading]    = useState(true);
  const [downloadingId, setDownloadingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await landlordPortalRequests.get(`landlord-portal/statements?page=${page}&limit=12`);
      setStatements(data.data?.statements || []);
      setTotal(data.data?.pagination?.total || 0);
      setTotalPages(data.data?.pagination?.totalPages || 1);
    } catch {} finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const downloadPdf = useCallback(async (statement) => {
    setDownloadingId(statement._id);
    try {
      const res = await landlordPortalRequests.get(`landlord-portal/statements/${statement._id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = Object.assign(document.createElement('a'), { href: url, download: `Statement_${statement.statementNumber || statement._id}.pdf` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.alert('Could not download this statement. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  }, []);

  return (
    <div>
      <h1 className="lp-page-title">My Statements</h1>

      <LiveSnapshot />

      <div className="lp-card">
        <div className="lp-card-header">
          <h2>Statement History ({total} records)</h2>
        </div>
        <div className="lp-table-wrap">
          {loading
            ? <div className="lp-loading">Loading...</div>
            : statements.length === 0
              ? <div className="lp-empty">No statements found</div>
              : (
                <table className="lp-table">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Property</th>
                      <th>Opening Balance</th>
                      <th>Net for Period</th>
                      <th>Closing Balance</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {statements.map((s) => (
                      <tr key={s._id}>
                        <td>{fmtD(s.periodStart)} – {fmtD(s.periodEnd)}</td>
                        <td>{s.property?.propertyCode ? `${s.property.propertyCode} – ${s.property.propertyName}` : '—'}</td>
                        <td>{fmtC(s.openingBalance)}</td>
                        <td><strong>{fmtC(s.periodNet)}</strong></td>
                        <td>{fmtC(s.closingBalance)}</td>
                        <td>
                          <span className={`lp-badge ${STATUS_BADGE[s.status] || 'lp-badge-gray'}`}>
                            {s.status}
                          </span>
                        </td>
                        <td>
                          <button
                            className="lp-btn lp-btn-outline"
                            onClick={() => downloadPdf(s)}
                            disabled={downloadingId === s._id}
                          >
                            {downloadingId === s._id ? 'Preparing…' : 'Download PDF'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          }
        </div>
        {totalPages > 1 && (
          <div className="lp-pagination">
            <button onClick={() => setPage((p) => p - 1)} disabled={page === 1}>Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page === totalPages}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}

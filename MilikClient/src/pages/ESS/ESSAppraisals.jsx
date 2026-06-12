import { useState, useEffect, useCallback } from 'react';
import { essRequests } from '../../utils/essRequests';
import './ESS.css';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_BADGE = {
  Pending:    { cls: 'ess-badge ess-badge-yellow', label: 'Pending' },
  InProgress: { cls: 'ess-badge ess-badge-yellow', label: 'In Progress' },
  Submitted:  { cls: 'ess-badge ess-badge-green',  label: 'Submitted' },
};

function ScoreBar({ score, maxScore }) {
  const pct = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  const color = pct >= 80 ? '#027333' : pct >= 60 ? '#d97706' : '#dc2626';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#e5e7eb', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '0.72rem', fontWeight: 600, color, minWidth: 28, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
    </div>
  );
}

function AppraisalModal({ appraisal, onClose }) {
  const overallPct = appraisal.overallScore ?? 0;
  const color = overallPct >= 80 ? '#027333' : overallPct >= 60 ? '#d97706' : '#dc2626';
  const badge = STATUS_BADGE[appraisal.status] || { cls: 'ess-badge', label: appraisal.status };

  return (
    <div className="ess-modal-overlay" onClick={onClose}>
      <div className="ess-modal" style={{ maxWidth: 600, maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="ess-modal-header">
          <div>
            <h3 style={{ margin: 0 }}>{appraisal.cycle?.name || 'Appraisal'}</h3>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>
              {appraisal.cycle?.year} · {appraisal.cycle?.periodType}
              {appraisal.cycle?.startDate && ` · ${fmtDate(appraisal.cycle.startDate)} – ${fmtDate(appraisal.cycle.endDate)}`}
            </div>
          </div>
          <button className="ess-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="ess-modal-body">
          {/* Overall score */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', padding: '0.875rem 1rem', background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }}>
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af' }}>Overall Score</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 900, color, lineHeight: 1.1 }}>{overallPct.toFixed(1)}%</div>
            </div>
            <span className={badge.cls}>{badge.label}</span>
          </div>

          {/* KPI ratings */}
          {appraisal.ratings?.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b7280', marginBottom: 8 }}>KPI Scores</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {appraisal.ratings.map((r, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center', padding: '0.5rem 0.75rem', background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                    <div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151' }}>{r.kpi?.name || r.name || `KPI ${i + 1}`}</div>
                      {r.kpi?.category && <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{r.kpi.category}</div>}
                    </div>
                    <div style={{ minWidth: 100 }}>
                      <ScoreBar score={r.score || 0} maxScore={r.maxScore || 10} />
                    </div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {r.score ?? 0} / {r.maxScore ?? 10}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reviewer notes */}
          {appraisal.reviewerNotes && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b7280', marginBottom: 4 }}>Reviewer Notes</div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#374151', lineHeight: 1.5, padding: '0.5rem 0.75rem', background: '#f9fafb', borderRadius: 8 }}>{appraisal.reviewerNotes}</p>
            </div>
          )}

          {/* Employee comments */}
          {appraisal.employeeComments && (
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b7280', marginBottom: 4 }}>Your Comments</div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#374151', lineHeight: 1.5, padding: '0.5rem 0.75rem', background: '#f0f9f2', borderRadius: 8, border: '1px solid #b9e3c3' }}>{appraisal.employeeComments}</p>
            </div>
          )}
        </div>

        <div className="ess-modal-footer">
          <button className="ess-btn ess-btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function ESSAppraisals() {
  const [appraisals, setAppraisals] = useState([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState(null);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const { data } = await essRequests.get('hr/ess/my/appraisals', { params: { page: p, limit: 10 } });
      setAppraisals(data.appraisals || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
      setPage(p);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(1); }, [load]);

  return (
    <div>
      <h1 className="ess-page-title">My Appraisals</h1>

      {loading ? (
        <div className="ess-loading">Loading…</div>
      ) : appraisals.length === 0 ? (
        <div className="ess-card">
          <div className="ess-card-body">
            <div className="ess-empty">No appraisal records found</div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {appraisals.map((a) => {
              const pct   = a.overallScore ?? 0;
              const color = pct >= 80 ? '#027333' : pct >= 60 ? '#d97706' : '#dc2626';
              const badge = STATUS_BADGE[a.status] || { cls: 'ess-badge', label: a.status };
              return (
                <div
                  key={a._id}
                  className="ess-card"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected(a)}
                >
                  <div className="ess-card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#111827' }}>{a.cycle?.name || 'Appraisal'}</span>
                        <span className={badge.cls}>{badge.label}</span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>
                        {a.cycle?.year} · {a.cycle?.periodType}
                        {a.submittedAt && ` · Submitted ${fmtDate(a.submittedAt)}`}
                      </div>
                      {a.ratings?.length > 0 && (
                        <div style={{ marginTop: 8, maxWidth: 280 }}>
                          <ScoreBar score={pct} maxScore={100} />
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 900, color, lineHeight: 1 }}>{pct.toFixed(1)}%</div>
                      <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: 2 }}>{a.ratings?.length || 0} KPIs</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: '1rem' }}>
              <button className="ess-btn ess-btn-outline" disabled={page <= 1} onClick={() => load(page - 1)} style={{ padding: '0.3rem 0.9rem', fontSize: '0.78rem' }}>Prev</button>
              <span style={{ display: 'flex', alignItems: 'center', fontSize: '0.8rem', color: '#6b7280' }}>{page} / {totalPages}</span>
              <button className="ess-btn ess-btn-outline" disabled={page >= totalPages} onClick={() => load(page + 1)} style={{ padding: '0.3rem 0.9rem', fontSize: '0.78rem' }}>Next</button>
            </div>
          )}
        </>
      )}

      {selected && <AppraisalModal appraisal={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

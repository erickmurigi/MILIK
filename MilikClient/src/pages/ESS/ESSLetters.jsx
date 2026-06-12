import { useState, useEffect, useCallback } from 'react';
import { essRequests } from '../../utils/essRequests';
import './ESS.css';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function ESSLetters() {
  const [letters,    setLetters]    = useState([]);
  const [total,      setTotal]      = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await essRequests.get(`hr/ess/my/letters?page=${page}&limit=15`);
      setLetters(data.letters || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch {} finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const openLetter = useCallback(async (letter) => {
    if (letter.body) { setSelected(letter); return; }
    try {
      const { data } = await essRequests.get(`hr/ess/my/letters/${letter._id}`);
      setSelected(data);
    } catch {}
  }, []);

  const printLetter = useCallback(() => {
    if (!selected?.body) return;
    const w = window.open('', '_blank', 'width=800,height=900');
    w.document.write(`<!DOCTYPE html><html><head>
      <title>${selected.subject}</title>
      <style>
        @media print { body { margin: 0; } }
        body { font-family: Arial, sans-serif; }
      </style>
    </head><body>${selected.body}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 400);
  }, [selected]);

  return (
    <div>
      <h1 className="ess-page-title">My Letters</h1>

      <div className="ess-card">
        <div className="ess-card-header">
          <h2>Issued Letters ({total})</h2>
        </div>
        <div className="ess-table-wrap">
          {loading
            ? <div className="ess-loading">Loading...</div>
            : letters.length === 0
              ? <div className="ess-empty">No letters issued to you yet</div>
              : (
                <table className="ess-table">
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Type</th>
                      <th>Date Issued</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {letters.map((l) => (
                      <tr key={l._id}>
                        <td>{l.subject}</td>
                        <td style={{ textTransform: 'capitalize' }}>
                          {l.letterType?.replace(/_/g, ' ') || '—'}
                        </td>
                        <td>{fmtDate(l.issuedDate)}</td>
                        <td>
                          <button className="ess-btn ess-btn-outline" onClick={() => openLetter(l)}>
                            View
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
          <div className="ess-pagination">
            <button onClick={() => setPage((p) => p - 1)} disabled={page === 1}>Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page === totalPages}>Next</button>
          </div>
        )}
      </div>

      {/* Letter viewer modal */}
      {selected && (
        <div className="ess-modal-overlay" onClick={() => setSelected(null)}>
          <div
            className="ess-modal"
            style={{ maxWidth: 700 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ess-modal-header">
              <h3>{selected.subject}</h3>
              <button className="ess-modal-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="ess-modal-body">
              {selected.body
                ? <div dangerouslySetInnerHTML={{ __html: selected.body }} style={{ fontSize: '0.85rem' }} />
                : <div className="ess-empty">Letter content not available</div>
              }
            </div>
            <div className="ess-modal-footer">
              <button className="ess-btn ess-btn-outline" onClick={() => setSelected(null)}>Close</button>
              {selected.body && (
                <button className="ess-btn ess-btn-primary" onClick={printLetter}>Print</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { landlordPortalRequests } from '../../utils/landlordPortalRequests';
import './LandlordPortal.css';

const fmtC = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

const STATUS_BADGE = {
  vacant:         'lp-badge-yellow',
  occupied:       'lp-badge-green',
  owner_occupied: 'lp-badge-blue',
  maintenance:    'lp-badge-red',
  reserved:       'lp-badge-gray',
  archived:       'lp-badge-gray',
};

export default function LandlordPortalUnits() {
  const [units,   setUnits]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await landlordPortalRequests.get('landlord-portal/units');
      setUnits(data.data || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <h1 className="lp-page-title">My Units</h1>

      <div className="lp-card">
        <div className="lp-card-header">
          <h2>Units ({units.length})</h2>
        </div>
        <div className="lp-table-wrap">
          {loading
            ? <div className="lp-loading">Loading...</div>
            : units.length === 0
              ? <div className="lp-empty">No units found</div>
              : (
                <table className="lp-table">
                  <thead>
                    <tr>
                      <th>Property</th>
                      <th>Unit</th>
                      <th>Rent</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((u) => (
                      <tr key={u._id}>
                        <td>{u.property?.propertyCode ? `${u.property.propertyCode} – ${u.property.propertyName}` : '—'}</td>
                        <td>{u.unitNumber}</td>
                        <td>{fmtC(u.rent)}</td>
                        <td>
                          <span className={`lp-badge ${STATUS_BADGE[u.status] || 'lp-badge-gray'}`}>
                            {String(u.status || '').replace('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          }
        </div>
      </div>
    </div>
  );
}

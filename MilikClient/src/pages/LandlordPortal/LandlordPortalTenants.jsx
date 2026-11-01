import { useState, useEffect, useCallback } from 'react';
import { landlordPortalRequests } from '../../utils/landlordPortalRequests';
import './LandlordPortal.css';

const STATUS_BADGE = {
  active:     'lp-badge-green',
  inactive:   'lp-badge-gray',
  terminated: 'lp-badge-red',
  evicted:    'lp-badge-red',
  overdue:    'lp-badge-yellow',
};

export default function LandlordPortalTenants() {
  const [tenants, setTenants] = useState([]);
  const [loading,  setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await landlordPortalRequests.get('landlord-portal/tenants');
      setTenants(data.data || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <h1 className="lp-page-title">My Tenants</h1>

      <div className="lp-card">
        <div className="lp-card-header">
          <h2>Tenants ({tenants.length})</h2>
        </div>
        <div className="lp-table-wrap">
          {loading
            ? <div className="lp-loading">Loading...</div>
            : tenants.length === 0
              ? <div className="lp-empty">No tenants found</div>
              : (
                <table className="lp-table">
                  <thead>
                    <tr>
                      <th>Tenant</th>
                      <th>Unit</th>
                      <th>Contact</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map((t) => (
                      <tr key={t._id}>
                        <td>{t.name}</td>
                        <td>{t.unit?.unitNumber || '—'}</td>
                        <td>{t.phone || t.email || '—'}</td>
                        <td>
                          <span className={`lp-badge ${STATUS_BADGE[t.status] || 'lp-badge-gray'}`}>
                            {t.status}
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

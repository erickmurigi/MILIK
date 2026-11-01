import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { landlordPortalRequests } from '../../utils/landlordPortalRequests';
import { useLandlordPortal } from '../../context/LandlordPortalContext';
import './LandlordPortal.css';

export default function LandlordPortalLogin() {
  const navigate = useNavigate();
  const { login } = useLandlordPortal();

  const [form, setForm] = useState({ companyCode: '', landlordCode: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.companyCode.trim() || !form.landlordCode.trim() || !form.password) {
      setError('All fields are required');
      return;
    }
    setLoading(true);
    try {
      const { data } = await landlordPortalRequests.post('landlord-portal/auth/login', {
        companyCode:  form.companyCode.trim().toUpperCase(),
        landlordCode: form.landlordCode.trim(),
        password:     form.password,
      });
      login({ token: data.token, landlord: data.landlord, company: data.company });
      navigate('/landlord-portal/statements', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lp-login-page">
      <div className="lp-login-card">
        <div className="lp-login-header">
          <div className="lp-login-logo">M</div>
          <h1>Landlord Portal</h1>
          <p>Sign in to view your statements, units, and tenants</p>
        </div>

        <form onSubmit={handleSubmit} className="lp-login-form">
          {error && <div className="lp-form-error">{error}</div>}

          <div className="lp-field">
            <label>Company Code</label>
            <input
              type="text"
              placeholder="e.g. MILIK"
              value={form.companyCode}
              onChange={set('companyCode')}
              autoComplete="organization"
              autoFocus
            />
          </div>

          <div className="lp-field">
            <label>Landlord Code</label>
            <input
              type="text"
              placeholder="e.g. LL001"
              value={form.landlordCode}
              onChange={set('landlordCode')}
              autoComplete="username"
            />
          </div>

          <div className="lp-field">
            <label>Password</label>
            <input
              type="password"
              placeholder="Enter your password"
              value={form.password}
              onChange={set('password')}
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="lp-login-btn" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="lp-login-help">
          Forgot your password, or never received one? Contact your property manager.
        </p>
      </div>
    </div>
  );
}

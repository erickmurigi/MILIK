import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { essRequests } from '../../utils/essRequests';
import { useESS } from '../../context/ESSContext';
import './ESS.css';

export default function ESSLogin() {
  const navigate = useNavigate();
  const { login } = useESS();

  const [form, setForm] = useState({ companyCode: '', employeeNumber: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.companyCode.trim() || !form.employeeNumber.trim() || !form.password) {
      setError('All fields are required');
      return;
    }
    setLoading(true);
    try {
      const { data } = await essRequests.post('hr/ess/auth/login', {
        companyCode:    form.companyCode.trim().toUpperCase(),
        employeeNumber: form.employeeNumber.trim().toUpperCase(),
        password:       form.password,
      });
      login({ token: data.token, employee: data.employee, company: data.company });
      navigate('/ess/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ess-login-page">
      <div className="ess-login-card">
        <div className="ess-login-header">
          <div className="ess-login-logo">M</div>
          <h1>Employee Portal</h1>
          <p>Sign in to access your payslips, leave, and more</p>
        </div>

        <form onSubmit={handleSubmit} className="ess-login-form">
          {error && <div className="ess-form-error">{error}</div>}

          <div className="ess-field">
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

          <div className="ess-field">
            <label>Employee Number</label>
            <input
              type="text"
              placeholder="e.g. EMP001"
              value={form.employeeNumber}
              onChange={set('employeeNumber')}
              autoComplete="username"
            />
          </div>

          <div className="ess-field">
            <label>Password</label>
            <input
              type="password"
              placeholder="Enter your password"
              value={form.password}
              onChange={set('password')}
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="ess-login-btn" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="ess-login-help">
          Forgot your password? Contact your HR administrator.
        </p>
      </div>
    </div>
  );
}

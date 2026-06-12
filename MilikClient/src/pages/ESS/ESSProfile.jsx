import { useState, useEffect, useCallback } from 'react';
import { essRequests } from '../../utils/essRequests';
import { useESS } from '../../context/ESSContext';
import './ESS.css';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

function Row({ label, value }) {
  return (
    <tr>
      <td style={{ color: '#6b7280', fontSize: '0.8rem', padding: '0.45rem 0', width: '40%' }}>{label}</td>
      <td style={{ fontWeight: 500, fontSize: '0.875rem', padding: '0.45rem 0' }}>{value || '—'}</td>
    </tr>
  );
}

export default function ESSProfile() {
  const { updateEmployee } = useESS();
  const [emp,      setEmp]      = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [showPwdForm, setShowPwdForm] = useState(false);
  const [pwdForm,  setPwdForm]  = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwdError, setPwdError] = useState('');
  const [pwdOk,    setPwdOk]    = useState('');
  const [saving,   setSaving]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await essRequests.get('hr/ess/me');
      setEmp(data);
      updateEmployee({
        surname:        data.surname,
        otherNames:     data.otherNames,
        profilePicture: data.profilePicture,
      });
    } catch {} finally { setLoading(false); }
  }, [updateEmployee]);

  useEffect(() => { load(); }, [load]);

  const setPwd = (f) => (e) => setPwdForm((p) => ({ ...p, [f]: e.target.value }));

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwdError('');
    setPwdOk('');
    if (!pwdForm.currentPassword || !pwdForm.newPassword || !pwdForm.confirm) {
      setPwdError('All fields are required');
      return;
    }
    if (pwdForm.newPassword !== pwdForm.confirm) {
      setPwdError('New passwords do not match');
      return;
    }
    if (pwdForm.newPassword.length < 6) {
      setPwdError('New password must be at least 6 characters');
      return;
    }
    setSaving(true);
    try {
      await essRequests.post('hr/ess/auth/change-password', {
        currentPassword: pwdForm.currentPassword,
        newPassword:     pwdForm.newPassword,
      });
      setPwdOk('Password changed successfully');
      setPwdForm({ currentPassword: '', newPassword: '', confirm: '' });
      setShowPwdForm(false);
    } catch (err) {
      setPwdError(err.response?.data?.message || 'Failed to change password');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="ess-loading">Loading...</div>;
  if (!emp)    return <div className="ess-empty">Could not load profile</div>;

  return (
    <div>
      <h1 className="ess-page-title">My Profile</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        {/* Personal info */}
        <div className="ess-card">
          <div className="ess-card-header">
            <h2>Personal Information</h2>
          </div>
          <div className="ess-card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
              {emp.profilePicture
                ? <img src={emp.profilePicture} alt="profile" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e2e8f0' }} />
                : <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#027333', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', fontWeight: 700 }}>
                    {emp.surname?.[0]}{emp.otherNames?.[0]}
                  </div>
              }
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>{emp.surname} {emp.otherNames}</div>
                <div style={{ color: '#6b7280', fontSize: '0.82rem' }}>{emp.employeeNumber}</div>
                <span className={`ess-badge ${emp.status === 'Active' ? 'ess-badge-green' : 'ess-badge-yellow'}`} style={{ marginTop: 4 }}>
                  {emp.status}
                </span>
              </div>
            </div>
            <table style={{ width: '100%' }}>
              <tbody>
                <Row label="Gender"        value={emp.gender} />
                <Row label="Date of Birth" value={fmtDate(emp.dateOfBirth)} />
                <Row label="National ID"   value={emp.nationalId} />
                <Row label="Phone"         value={emp.phoneNumber} />
                <Row label="Email"         value={emp.email} />
                <Row label="Address"       value={emp.physicalAddress} />
              </tbody>
            </table>
          </div>
        </div>

        {/* Employment info */}
        <div className="ess-card">
          <div className="ess-card-header">
            <h2>Employment Details</h2>
          </div>
          <div className="ess-card-body">
            <table style={{ width: '100%' }}>
              <tbody>
                <Row label="Department"       value={emp.department?.name} />
                <Row label="Designation"      value={emp.designation?.name} />
                <Row label="Employment Type"  value={emp.employmentType} />
                <Row label="Date Joined"      value={fmtDate(emp.dateJoined)} />
                <Row label="Reports To"       value={emp.reportsTo ? `${emp.reportsTo.surname} ${emp.reportsTo.otherNames}` : null} />
                {emp.contractEndDate && <Row label="Contract Ends" value={fmtDate(emp.contractEndDate)} />}
                {emp.probationEndDate && <Row label="Probation Ends" value={fmtDate(emp.probationEndDate)} />}
              </tbody>
            </table>
          </div>
        </div>

        {/* Statutory info */}
        <div className="ess-card">
          <div className="ess-card-header">
            <h2>Statutory Numbers</h2>
          </div>
          <div className="ess-card-body">
            <table style={{ width: '100%' }}>
              <tbody>
                <Row label="KRA PIN"  value={emp.kraPin} />
                <Row label="NHIF No." value={emp.nhifNo} />
                <Row label="NSSF No." value={emp.nssfNo} />
                <Row label="HELB No." value={emp.helbNo} />
              </tbody>
            </table>
          </div>
        </div>

        {/* Emergency contact + account security */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="ess-card">
            <div className="ess-card-header"><h2>Emergency Contact</h2></div>
            <div className="ess-card-body">
              <table style={{ width: '100%' }}>
                <tbody>
                  <Row label="Name"         value={emp.nextOfKinName} />
                  <Row label="Relationship" value={emp.nextOfKinRelationship} />
                  <Row label="Phone"        value={emp.nextOfKinPhone} />
                </tbody>
              </table>
            </div>
          </div>

          <div className="ess-card">
            <div className="ess-card-header">
              <h2>Account Security</h2>
              <button className="ess-btn ess-btn-outline" onClick={() => { setShowPwdForm(true); setPwdError(''); setPwdOk(''); }}>
                Change Password
              </button>
            </div>
            <div className="ess-card-body">
              {pwdOk && <div className="ess-alert ess-alert-success">{pwdOk}</div>}
              <p style={{ color: '#6b7280', fontSize: '0.82rem', margin: 0 }}>
                Use a strong password that you don&apos;t use anywhere else.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Change password modal */}
      {showPwdForm && (
        <div className="ess-modal-overlay" onClick={() => setShowPwdForm(false)}>
          <div className="ess-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ess-modal-header">
              <h3>Change Password</h3>
              <button className="ess-modal-close" onClick={() => setShowPwdForm(false)}>✕</button>
            </div>
            <form onSubmit={handleChangePassword}>
              <div className="ess-modal-body">
                {pwdError && <div className="ess-alert ess-alert-error">{pwdError}</div>}
                <div className="ess-form">
                  <div className="ess-form-group">
                    <label>Current Password</label>
                    <input type="password" value={pwdForm.currentPassword} onChange={setPwd('currentPassword')} autoComplete="current-password" />
                  </div>
                  <div className="ess-form-group">
                    <label>New Password</label>
                    <input type="password" value={pwdForm.newPassword} onChange={setPwd('newPassword')} autoComplete="new-password" />
                  </div>
                  <div className="ess-form-group">
                    <label>Confirm New Password</label>
                    <input type="password" value={pwdForm.confirm} onChange={setPwd('confirm')} autoComplete="new-password" />
                  </div>
                </div>
              </div>
              <div className="ess-modal-footer">
                <button type="button" className="ess-btn ess-btn-outline" onClick={() => setShowPwdForm(false)}>Cancel</button>
                <button type="submit" className="ess-btn ess-btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

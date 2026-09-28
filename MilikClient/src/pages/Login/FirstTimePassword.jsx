import React, { useMemo, useState } from "react";
import { FaCheck, FaEye, FaEyeSlash, FaKey, FaLock } from "react-icons/fa";
import Spinner from "../../components/common/Spinner";
import { useDispatch, useSelector } from "react-redux";
import { selectCurrentUser } from "../../redux/selectors";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { getCurrentUserSuccess, loginSuccess } from "../../redux/authSlice";
import { setCurrentCompany } from "../../redux/companiesRedux";
import { adminRequests } from "../../utils/requestMethods";

const APP_LOGIN_HINT = import.meta.env.VITE_APP_LOGIN_HINT || "Use the temporary password sent from MILIK, then choose a new one now.";

// A short, honest read on a password — not a security score, just enough to nudge someone away from "password1".
const STRENGTH_LEVELS = ["Too short", "Weak", "Fair", "Good", "Strong"];
const scorePassword = (value) => {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 4);
};
const STRENGTH_BAR = ["bg-red-500", "bg-red-500", "bg-amber-500", "bg-lime-500", "bg-emerald-600"];

function FirstTimePassword() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentUser = useSelector(selectCurrentUser);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState({ currentPassword: false, newPassword: false, confirmPassword: false });
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (error) setError("");
  };

  const toggleVisibility = (field) => setShow((prev) => ({ ...prev, [field]: !prev[field] }));

  const strength = useMemo(() => scorePassword(form.newPassword), [form.newPassword]);
  const confirmMatches = form.confirmPassword.length > 0 && form.confirmPassword === form.newPassword;
  const confirmMismatches = form.confirmPassword.length > 0 && !confirmMatches;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
      setError("Complete all password fields.");
      return;
    }
    if (form.newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (form.currentPassword === form.newPassword) {
      setError("New password must be different from the temporary password.");
      return;
    }

    setLoading(true);
    try {
      const res = await adminRequests.post('/auth/change-password-first-login', form);
      const { user, token } = res.data;
      dispatch(loginSuccess({ user, token }));
      dispatch(getCurrentUserSuccess(user));
      if (user?.company?._id) {
        dispatch(setCurrentCompany(user.company));
        localStorage.setItem('milik_active_company_id', user.company._id);
      }
      toast.success('Password updated successfully.');
      navigate('/moduleDashboard', { replace: true });
    } catch (err) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Failed to update password';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const renderField = (name, label, placeholder, { autoComplete, hint, watchCaps } = {}) => (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-bold text-[#0B3B2E]">{label}</label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
          <FaLock className="text-slate-400" />
        </div>
        <input
          id={name}
          name={name}
          type={show[name] ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={form[name]}
          onChange={handleChange}
          onKeyUp={watchCaps ? (e) => setCapsLock(e.getModifierState?.('CapsLock') === true) : undefined}
          onBlur={watchCaps ? () => setCapsLock(false) : undefined}
          disabled={loading}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-12 text-[15px] font-semibold text-[#0B3B2E] outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-[#0B3B2E] focus:ring-4 focus:ring-[#0B3B2E]/10"
        />
        <button
          type="button"
          onClick={() => toggleVisibility(name)}
          aria-label={show[name] ? 'Hide password' : 'Show password'}
          disabled={loading}
          className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-[#0B3B2E]"
        >
          {show[name] ? <FaEyeSlash /> : <FaEye />}
        </button>
      </div>
      {hint}
      {watchCaps && capsLock && <p className="mt-1 text-xs font-bold text-amber-600">Caps Lock is on</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">

      {/* ── Brand panel (large screens) ── */}
      <aside className="relative hidden items-center justify-center overflow-hidden bg-gradient-to-br from-[#0B3B2E] via-[#0A3127] to-[#06231b] lg:flex">
        {/* The two overlapping squares of the Milik mark, large and faint, centred behind the logo */}
        <svg aria-hidden="true" viewBox="0 0 400 400" className="pointer-events-none absolute inset-0 m-auto aspect-square h-auto w-[78%] max-w-[460px] select-none" fill="none" strokeWidth="10">
          <rect x="35" y="35" width="220" height="220" stroke="#FF8C00" strokeOpacity="0.24" />
          <rect x="145" y="145" width="220" height="220" stroke="#ffffff" strokeOpacity="0.13" />
        </svg>

        <div className="relative rounded-2xl bg-white px-7 py-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)]">
          <img src="/milik-logo-trim.png" alt="Milik System — One Platform. Every Business." className="h-11 w-auto xl:h-14" />
        </div>

        <p className="absolute bottom-6 left-0 right-0 text-center text-xs text-emerald-100/50">© {new Date().getFullYear()} Milik System</p>
      </aside>

      {/* ── Set password ── */}
      <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#f3f7f5] px-5 py-10 sm:px-10 lg:min-h-0">
        {/* one outlined square (the mark), top right, to sharpen the two soft clouds */}
        <svg aria-hidden="true" viewBox="0 0 200 200" className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 select-none sm:h-44 sm:w-44" fill="none">
          <rect x="30" y="30" width="150" height="150" stroke="#0B3B2E" strokeWidth="6" />
          <rect x="-10" y="70" width="150" height="150" stroke="#0B3B2E" strokeOpacity="0.22" strokeWidth="6" />
        </svg>
        {/* soft clouds of colour: orange at the top left, green at the bottom right */}
        <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-32 h-[26rem] w-[26rem] rounded-full bg-[#FF8C00]/20 blur-3xl sm:h-[34rem] sm:w-[34rem]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -right-32 h-[26rem] w-[26rem] rounded-full bg-[#0B3B2E]/20 blur-3xl sm:h-[34rem] sm:w-[34rem]" />

        <div className="relative w-full max-w-[26rem] rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_20px_50px_-20px_rgba(11,59,46,0.25)] sm:p-9">

          <div className="mb-7 lg:hidden">
            <img src="/milik-logo-trim.png" alt="Milik System" className="mx-auto h-11 w-auto sm:h-12" />
          </div>

          <div className="inline-flex items-center gap-2 rounded-full bg-[#0B3B2E]/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-[#0B3B2E]">
            <FaKey className="text-[#FF8C00]" /> First login required action
          </div>
          <h2 className="mt-3 text-3xl font-extrabold text-[#0B3B2E]">Set your own password</h2>
          <p className="mt-1.5 text-sm font-medium text-slate-500">{APP_LOGIN_HINT}</p>
          {currentUser?.email && (
            <p className="mt-3 text-sm font-bold text-slate-800">
              Signed in as <span className="text-[#0B3B2E]">{currentUser.email}</span>
            </p>
          )}

          {error && (
            <div role="alert" className="mt-6 flex items-start gap-2.5 border-l-4 border-red-500 bg-red-50 px-4 py-3">
              <span aria-hidden="true">⚠️</span>
              <p className="text-sm font-semibold text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-7 space-y-5" noValidate>
            {renderField('currentPassword', 'Temporary password', 'Enter the temporary password from your email', { autoComplete: 'current-password', watchCaps: true })}

            <div>
              {renderField('newPassword', 'New password', 'Create a new password', { autoComplete: 'new-password' })}
              {form.newPassword && (
                <div className="mt-2">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <span key={i} className={`h-1.5 flex-1 rounded-full ${i < strength ? STRENGTH_BAR[strength] : 'bg-slate-200'}`} />
                    ))}
                  </div>
                  <p className={`mt-1 text-xs font-bold ${strength <= 1 ? 'text-red-600' : strength === 2 ? 'text-amber-600' : 'text-emerald-700'}`}>
                    {STRENGTH_LEVELS[strength]}
                    <span className="ml-1 font-medium text-slate-400">— use 8+ characters, mixing letters, numbers and a symbol</span>
                  </p>
                </div>
              )}
            </div>

            <div>
              {renderField('confirmPassword', 'Confirm new password', 'Repeat your new password', { autoComplete: 'new-password' })}
              {confirmMatches && (
                <p className="mt-1 flex items-center gap-1 text-xs font-bold text-emerald-700"><FaCheck size={10} /> Passwords match</p>
              )}
              {confirmMismatches && (
                <p className="mt-1 text-xs font-bold text-red-600">Passwords do not match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0B3B2E] px-4 py-3.5 text-[15px] font-extrabold tracking-wide text-white shadow-md transition hover:bg-[#0A3127] hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-[#0B3B2E]/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Spinner size="sm" />
                  Updating…
                </>
              ) : (
                'Save password and continue'
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

export default FirstTimePassword;

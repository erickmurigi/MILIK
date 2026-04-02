
import React, { useState } from "react";
import { FaEye, FaEyeSlash, FaKey, FaLock, FaSpinner } from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { getCurrentUserSuccess, loginSuccess } from "../../redux/authSlice";
import { setCurrentCompany } from "../../redux/companiesRedux";
import { adminRequests } from "../../utils/requestMethods";

const APP_LOGIN_HINT = import.meta.env.VITE_APP_LOGIN_HINT || "Use the temporary password sent from MILIK, then choose a new one now.";

function FirstTimePassword() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { currentUser } = useSelector((state) => state.auth);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState({ currentPassword: false, newPassword: false, confirmPassword: false });
  const [error, setError] = useState("");

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (error) setError("");
  };

  const toggleVisibility = (field) => setShow((prev) => ({ ...prev, [field]: !prev[field] }));

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
      navigate(user?.isDemoUser ? '/dashboard' : '/moduleDashboard', { replace: true });
    } catch (err) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Failed to update password';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const renderField = (name, label, placeholder) => (
    <div>
      <label htmlFor={name} className="mb-2 block text-sm font-extrabold tracking-wide text-[#0B3B2E]">{label}</label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <FaLock className="text-[#0B3B2E]" />
        </div>
        <input
          id={name}
          name={name}
          type={show[name] ? 'text' : 'password'}
          value={form[name]}
          onChange={handleChange}
          disabled={loading}
          placeholder={placeholder}
          className="w-full rounded-xl border-2 border-[#b9d3c7] bg-white py-3 pl-10 pr-12 font-bold text-[#0B3B2E] outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/20"
        />
        <button type="button" onClick={() => toggleVisibility(name)} disabled={loading} className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#0B3B2E] hover:text-[#FF8C00]">
          {show[name] ? <FaEyeSlash /> : <FaEye />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#eef5f1] via-[#e7f1eb] to-[#f4efe7] p-4">
      <img src="/logo.png" alt="Milik watermark" className="pointer-events-none absolute inset-0 m-auto w-[70vw] max-w-[760px] select-none opacity-[0.13]" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[#0B3B2E]/20 bg-white/95 shadow-2xl backdrop-blur-sm">
        <div className="bg-gradient-to-r from-[#0B3B2E] to-[#0A3127] p-8 text-center text-white">
          <div className="mb-2 flex items-center justify-center gap-3">
            <img src="/logo.png" alt="Milik logo" className="h-12 w-12 object-contain drop-shadow-md md:h-14 md:w-14" />
            <h1 className="text-4xl font-extrabold tracking-wide">Milik</h1>
          </div>
          <p className="text-sm font-semibold text-[#DDEFE1]">Secure your workspace before you continue</p>
        </div>

        <div className="space-y-6 p-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#0B3B2E]/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-[#0B3B2E]">
              <FaKey className="text-[#FF8C00]" /> First login required action
            </div>
            <h2 className="mt-4 text-2xl font-extrabold text-[#0B3B2E]">Set your own password</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{APP_LOGIN_HINT}</p>
            {currentUser?.email && <p className="mt-3 text-sm font-bold text-slate-800">Username: {currentUser.email}</p>}
          </div>

          {error && <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            {renderField('currentPassword', 'Temporary password', 'Enter the temporary password from your email')}
            {renderField('newPassword', 'New password', 'Create a new password')}
            {renderField('confirmPassword', 'Confirm new password', 'Repeat your new password')}
            <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0B3B2E] to-[#0A3127] px-4 py-3 font-extrabold tracking-wide text-white transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? <><FaSpinner className="animate-spin" /> Updating...</> : 'Save Password and Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default FirstTimePassword;

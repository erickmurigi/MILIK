import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FaUserCircle,
  FaKey,
  FaHistory,
  FaBuilding,
  FaSave,
  FaSpinner,
  FaEye,
  FaEyeSlash,
  FaCheck,
  FaShieldAlt,
  FaSyncAlt,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";
import { getCurrentUserSuccess } from "../../redux/authSlice";
import { getCompanyOperatingModeLabel } from "../../utils/companyModules";

const TABS = [
  { key: "profile",   label: "PROFILE",   icon: <FaUserCircle /> },
  { key: "security",  label: "SECURITY",  icon: <FaKey /> },
];

const VALID_TABS = new Set(TABS.map(t => t.key));

const Field = ({ label, children }) => (
  <div className="space-y-1.5">
    <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</label>
    {children}
  </div>
);

const TextInput = ({ value, onChange, placeholder, readOnly = false, type = "text", suffix }) => (
  <div className="relative">
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={readOnly}
      className={[
        "w-full rounded-xl border px-4 py-3 text-sm outline-none transition",
        readOnly
          ? "border-slate-200 bg-slate-50 text-slate-500 cursor-default"
          : "border-slate-200 bg-white text-slate-900 focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/20",
        suffix ? "pr-12" : "",
      ].join(" ")}
    />
    {suffix && (
      <div className="absolute inset-y-0 right-0 flex items-center pr-4">{suffix}</div>
    )}
  </div>
);

const initialsFromName = (surname = "", otherNames = "") =>
  [surname, otherNames].filter(Boolean).map(p => p.charAt(0).toUpperCase()).join("").slice(0, 2) || "U";

const MyAccount = () => {
  const dispatch  = useDispatch();
  const navigate  = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { currentUser } = useSelector(s => s.auth || {});
  const { currentCompany } = useSelector(s => s.company || {});

  const activeTab = VALID_TABS.has(searchParams.get("tab")) ? searchParams.get("tab") : "profile";
  const switchTab = (key) => setSearchParams({ tab: key }, { replace: true });

  // ── Profile state ─────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({
    surname: currentUser?.surname || "",
    otherNames: currentUser?.otherNames || "",
    phone: currentUser?.phone || currentUser?.phoneNo || "",
  });
  const [profileDirty, setProfileDirty] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    setProfile({
      surname:    currentUser?.surname    || "",
      otherNames: currentUser?.otherNames || "",
      phone:      currentUser?.phone || currentUser?.phoneNo || "",
    });
    setProfileDirty(false);
  }, [currentUser?._id]);

  const setProfileField = (field) => (e) => {
    setProfile(p => ({ ...p, [field]: e.target.value }));
    setProfileDirty(true);
  };

  const handleSaveProfile = async () => {
    if (!currentUser?._id) return;
    if (!profile.surname.trim() || !profile.otherNames.trim()) {
      toast.error("First name and surname are required.");
      return;
    }
    setSavingProfile(true);
    try {
      const res = await adminRequests.put(`/users/${currentUser._id}`, {
        surname:    profile.surname.trim(),
        otherNames: profile.otherNames.trim(),
        phone:      profile.phone.trim(),
      });
      const updated = res?.data?.user || res?.data;
      if (updated) dispatch(getCurrentUserSuccess(updated));
      setProfileDirty(false);
      toast.success("Profile updated.");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Security state ────────────────────────────────────────────────────────
  const [pw, setPw] = useState({ newPass: "", confirm: "" });
  const [showPw, setShowPw] = useState({ newPass: false, confirm: false });
  const [savingPw, setSavingPw] = useState(false);

  const handleSavePassword = async () => {
    if (!pw.newPass || !pw.confirm) { toast.error("Both password fields are required."); return; }
    if (pw.newPass.length < 6)       { toast.error("Password must be at least 6 characters."); return; }
    if (pw.newPass !== pw.confirm)   { toast.error("Passwords do not match."); return; }
    setSavingPw(true);
    try {
      await adminRequests.put(`/users/${currentUser._id}`, { password: pw.newPass });
      setPw({ newPass: "", confirm: "" });
      toast.success("Password updated.");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update password.");
    } finally {
      setSavingPw(false);
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const displayName = [currentUser?.surname, currentUser?.otherNames].filter(Boolean).join(" ") || "Milik User";
  const email       = currentUser?.email || "—";
  const roleLabel   = currentUser?.profile || currentUser?.role || "User";
  const companyName = currentCompany?.companyName || currentUser?.company?.companyName || "—";
  const companyMode = getCompanyOperatingModeLabel(currentCompany?.companyMode || currentUser?.company?.companyMode);
  const initials    = initialsFromName(currentUser?.surname, currentUser?.otherNames);

  // ── Tab renderers ─────────────────────────────────────────────────────────
  const renderProfile = () => (
    <div className="space-y-3">
      {/* Avatar + identity */}
      <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0B3B2E] to-[#1a5c44] text-lg font-black text-white shadow-inner">
          {currentUser?.avatar
            ? <img src={currentUser.avatar} alt="avatar" className="h-full w-full rounded-2xl object-cover" />
            : initials
          }
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-extrabold text-slate-900 truncate">{displayName}</p>
          <p className="text-xs text-slate-500 truncate">{email}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-700">
              {roleLabel}
            </span>
            {companyName !== "—" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                <FaBuilding size={8} /> {companyName}
              </span>
            )}
            {currentUser?.isSystemAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-bold text-violet-700">
                <FaShieldAlt size={8} /> System Admin
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Editable fields */}
      <div className="rounded-xl border border-slate-200 bg-white/70 backdrop-blur-xl shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-xs font-extrabold text-slate-900">Personal Information</div>
          <div className="mt-0.5 text-[11px] text-slate-600">Update your name and contact details below.</div>
        </div>
        <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2">
          <Field label="Surname">
            <TextInput value={profile.surname} onChange={setProfileField("surname")} placeholder="Your surname" />
          </Field>
          <Field label="Other Names">
            <TextInput value={profile.otherNames} onChange={setProfileField("otherNames")} placeholder="First / other names" />
          </Field>
          <Field label="Email Address">
            <TextInput value={email} readOnly placeholder="Email" />
          </Field>
          <Field label="Phone Number">
            <TextInput value={profile.phone} onChange={setProfileField("phone")} placeholder="+254 7XX XXX XXX" />
          </Field>
        </div>
        <div className="flex items-center justify-end border-t border-slate-100 bg-slate-50/50 px-4 py-3">
          <button
            type="button"
            onClick={handleSaveProfile}
            disabled={!profileDirty || savingProfile}
            className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-5 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savingProfile ? <FaSpinner className="animate-spin" size={11} /> : <FaSave size={11} />}
            {savingProfile ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Company context (read-only) */}
      <div className="rounded-xl border border-slate-200 bg-white/70 backdrop-blur-xl shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-xs font-extrabold text-slate-900">Company Context</div>
          <div className="mt-0.5 text-[11px] text-slate-600">Read-only. Manage company details in Company Setup.</div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-3">
          {[
            { label: "Company", value: companyName },
            { label: "Operating Mode", value: companyMode || "—" },
            { label: "Role", value: roleLabel },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-800">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderSecurity = () => (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white/70 backdrop-blur-xl shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-xs font-extrabold text-slate-900">Change Password</div>
          <div className="mt-0.5 text-[11px] text-slate-600">
            Choose a strong password of at least 6 characters. Your current session stays active after changing.
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2">
          {[
            { key: "newPass",  label: "New Password" },
            { key: "confirm",  label: "Confirm New Password" },
          ].map(({ key, label }) => (
            <Field key={key} label={label}>
              <TextInput
                type={showPw[key] ? "text" : "password"}
                value={pw[key]}
                onChange={e => setPw(p => ({ ...p, [key]: e.target.value }))}
                placeholder="••••••••"
                suffix={
                  <button type="button" onClick={() => setShowPw(p => ({ ...p, [key]: !p[key] }))} className="text-slate-400 hover:text-slate-600">
                    {showPw[key] ? <FaEyeSlash size={13} /> : <FaEye size={13} />}
                  </button>
                }
              />
            </Field>
          ))}
        </div>

        {pw.newPass && pw.confirm && (
          <div className={`mx-4 mb-4 flex items-center gap-1.5 text-[10px] font-bold ${pw.newPass === pw.confirm ? "text-emerald-600" : "text-rose-600"}`}>
            {pw.newPass === pw.confirm ? <FaCheck size={9} /> : "✕"}
            {pw.newPass === pw.confirm ? "Passwords match" : "Passwords do not match"}
          </div>
        )}

        <div className="flex items-center justify-end border-t border-slate-100 bg-slate-50/50 px-4 py-3">
          <button
            type="button"
            onClick={handleSavePassword}
            disabled={!pw.newPass || !pw.confirm || savingPw}
            className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-5 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savingPw ? <FaSpinner className="animate-spin" size={11} /> : <FaKey size={11} />}
            {savingPw ? "Saving…" : "Update Password"}
          </button>
        </div>
      </div>

      {/* Session info */}
      <div className="rounded-xl border border-slate-200 bg-white/70 backdrop-blur-xl shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-xs font-extrabold text-slate-900">Account Security</div>
        </div>
        <div className="divide-y divide-slate-100">
          {[
            { label: "Email", value: email },
            { label: "Username / ID", value: currentUser?.username || currentUser?._id || "—" },
            { label: "Account Status", value: currentUser?.isActive === false ? "Inactive" : "Active" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">{label}</span>
              <span className="font-semibold text-slate-800">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderTab = () => {
    switch (activeTab) {
      case "profile":  return renderProfile();
      case "security": return renderSecurity();
      default:         return renderProfile();
    }
  };

  return (
    <DashboardLayout>
      <div className="w-full px-4 py-3 2xl:px-6">

        {/* Page header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xl font-extrabold text-slate-900">My Account</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-600">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{displayName}</span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{roleLabel}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/company-setup")}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
            >
              <FaBuilding size={12} /> Company Setup
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            onClick={() => switchTab("profile")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Profile</div>
            <div className="mt-0.5 text-xs font-extrabold text-slate-900">{displayName}</div>
          </button>
          <button
            onClick={() => switchTab("security")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Security</div>
            <div className="mt-0.5 text-xs font-extrabold text-slate-900">Password & access</div>
          </button>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Company</div>
            <div className="mt-0.5 text-xs font-extrabold text-slate-900 truncate">{companyName}</div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="mt-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
          <div className="flex gap-2 overflow-x-auto">
            {TABS.map((tab) => {
              const isActive = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  onClick={() => switchTab(tab.key)}
                  className={[
                    "flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-extrabold transition",
                    isActive
                      ? "border-transparent bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white"
                      : "border-slate-200 bg-white/70 text-slate-800 hover:bg-white",
                  ].join(" ")}
                >
                  <span className="text-sm">{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        <div className="mt-2">{renderTab()}</div>
      </div>
    </DashboardLayout>
  );
};

export default MyAccount;

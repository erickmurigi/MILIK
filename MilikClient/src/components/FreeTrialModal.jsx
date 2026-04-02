import React, { useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaArrowRight,
  FaBuilding,
  FaCheckCircle,
  FaClock,
  FaHome,
  FaLock,
  FaPhoneAlt,
  FaTimes,
  FaUserTie,
} from "react-icons/fa";
import { loginSuccess } from "../redux/authSlice";
import { getCompanySuccess } from "../redux/companiesRedux";

const initialForm = {
  name: "",
  email: "",
  phone: "",
  company: "",
  role: "property_manager",
  portfolioSize: "",
  city: "",
  country: "Kenya",
  notes: "",
};

const API_BASE = String(import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const DEMO_EXPIRED_MESSAGE = "Your demo period has ended. Contact MILIK for activation.";

const roleCards = {
  property_manager: {
    title: "Property Manager",
    subtitle: "Instant demo access",
    icon: FaBuilding,
    badge: "3-day read-only workspace",
  },
  landlord: {
    title: "Landlord",
    subtitle: "Request guided preview",
    icon: FaHome,
    badge: "Statement-quality walkthrough",
  },
};

const portfolioOptions = [
  "1 - 20 units",
  "21 - 100 units",
  "101 - 300 units",
  "300+ units",
];

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-4 focus:ring-[#0B3B2E]/10";

function getRoleCopy(role) {
  if (role === "landlord") {
    return {
      helperText:
        "Request a guided preview focused on statement quality, visibility, and the owner-facing reporting experience your property manager can deliver.",
      submitLabel: "Request landlord preview",
      highlightTitle: "What happens next",
      highlights: [
        "We receive your request immediately.",
        "Your preview is kept separate from live company workspaces.",
        "We can tailor the follow-up around statements and reporting.",
      ],
    };
  }

  return {
    helperText:
      "Fill a short form once and enter the dedicated demo workspace immediately. The environment is read-only, safe to explore, and your email access link can be used again while the demo stays active.",
    submitLabel: "Enter demo workspace",
    highlightTitle: "Inside the workspace",
    highlights: [
      "Properties, units, tenants and receipting already prepared.",
      "Owner reporting, Trial Balance and Income Statement ready to inspect.",
      "Your session stays separate from live companies and production data.",
    ],
  };
}

const FreeTrialModal = ({ isOpen, onClose, initialRole = "property_manager" }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [demoExpiredMessage, setDemoExpiredMessage] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [showMoreFields, setShowMoreFields] = useState(false);

  const roleCopy = useMemo(() => getRoleCopy(form.role), [form.role]);

  useEffect(() => {
    if (!isOpen) return;

    setForm({ ...initialForm, role: initialRole || "property_manager" });
    setLoading(false);
    setSuccessMessage("");
    setDemoExpiredMessage("");
    setError("");
    setFieldErrors({});
    setShowMoreFields(false);
  }, [isOpen, initialRole]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event) => {
      if (event.key === "Escape" && !loading) {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, loading, onClose]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));

    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: "" }));
    }

    if (error) setError("");
  };

  const handleRoleChange = (role) => {
    setForm((prev) => ({ ...prev, role }));
    setError("");
    setSuccessMessage("");
    setDemoExpiredMessage("");
  };

  const handleOverlayClose = () => {
    if (!loading) {
      onClose?.();
    }
  };

  const validateForm = () => {
    const nextErrors = {};

    if (!form.name.trim()) nextErrors.name = "Full name is required";
    if (!form.email.trim()) {
      nextErrors.email = "Email is required";
    } else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      nextErrors.email = "Enter a valid email address";
    }

    if (!form.phone.trim()) nextErrors.phone = "Phone number is required";
    if (form.role === "property_manager" && !form.company.trim()) {
      nextErrors.company = "Company name is required for demo access";
    }

    return nextErrors;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      return;
    }

    setLoading(true);
    setError("");
    setSuccessMessage("");
    setDemoExpiredMessage("");
    setFieldErrors({});

    try {
      const response = await fetch(`${API_BASE.replace(/\/$/, "")}/trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          company: form.company.trim(),
          city: form.city.trim(),
          notes: form.notes.trim(),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Unable to complete your request right now.");
      }

      if (data.demoAvailable && data.token && data.user) {
        dispatch(loginSuccess({ token: data.token, user: data.user }));

        if (data.user?.company?._id) {
          dispatch(getCompanySuccess(data.user.company));
          localStorage.setItem("milik_active_company_id", data.user.company._id);
        }

        toast.success(
          data?.resumedDemo
            ? "Welcome back. Resuming your remaining demo time."
            : "Welcome to the Milik demo workspace. Your access link has also been sent to your email."
        );
        onClose?.();
        navigate(data.redirectTo || "/dashboard");
        return;
      }

      if (data?.demoExpired) {
        const expiredMessage = data?.message || DEMO_EXPIRED_MESSAGE;
        setDemoExpiredMessage(expiredMessage);
        toast.info(expiredMessage);
        return;
      }

      setSuccessMessage(
        data?.message ||
          "Your request has been received successfully. We will follow up with the next guided preview steps."
      );
      toast.success("Request received successfully.");
    } catch (submitError) {
      const message = submitError?.message || "Network error. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 py-4 backdrop-blur-sm md:px-6"
      onClick={handleOverlayClose}
    >
      <div
        className="relative w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/70 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.24)]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          className="absolute right-4 top-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/90 text-slate-600 shadow-sm transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleOverlayClose}
          disabled={loading}
        >
          <FaTimes />
        </button>

        <div className="grid max-h-[92vh] gap-0 overflow-y-auto lg:grid-cols-[1fr_1.05fr] lg:overflow-hidden">
          <div className="relative overflow-hidden bg-[linear-gradient(180deg,#0B3B2E_0%,#0E4C3D_100%)] px-7 py-8 text-white md:px-9 md:py-10">
            <div className="absolute -right-12 top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -left-10 bottom-6 h-40 w-40 rounded-full bg-[#FF8C00]/20 blur-3xl" />

            <div className="relative">
              <div className="inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur">
                <img src="/logo.png" alt="Milik" className="h-8 w-8 object-contain" />
                <span>Milik Demo Access</span>
              </div>

              <h2 className="mt-6 max-w-md text-3xl font-extrabold leading-tight md:text-[2.1rem]">
                A cleaner first impression for serious property operations.
              </h2>
              <p className="mt-4 max-w-lg text-sm leading-7 text-white/85 md:text-base">
                See what Milik feels like before onboarding live data. The demo is intentionally separated from real companies and kept safe for guided exploration.
              </p>

              <div className="mt-8 grid gap-3">
                <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                  <div className="flex items-center gap-3">
                    <FaClock className="text-[#F8C471]" />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/65">Access window</p>
                      <p className="mt-1 text-lg font-bold">3-day guided workspace</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                  <div className="flex items-center gap-3">
                    <FaLock className="text-[#F8C471]" />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/65">Environment</p>
                      <p className="mt-1 text-lg font-bold">Dedicated demo company, not live production</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur">
                <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#F8C471]">{roleCopy.highlightTitle}</p>
                <div className="mt-4 space-y-3 text-sm text-white/90">
                  {roleCopy.highlights.map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <FaCheckCircle className="mt-0.5 text-[#F8C471]" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[linear-gradient(180deg,#ffffff_0%,#f8fbf9_100%)] px-6 py-7 md:px-8 md:py-8">
            <div className="mb-6">
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Start here</p>
              <h3 className="mt-2 text-2xl font-extrabold text-slate-900 md:text-[2rem]">Short form. Clear next step.</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{roleCopy.helperText}</p>
              {form.role === "property_manager" ? (
                <p className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold leading-6 text-slate-600 shadow-sm">
                  Already requested demo access before? Use the email access link sent to you while your 3-day workspace is still active.
                </p>
              ) : null}
            </div>

            {demoExpiredMessage ? (
              <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950 shadow-sm">
                <div className="flex items-start gap-3">
                  <FaClock className="mt-0.5 text-amber-600" />
                  <div>
                    <p className="text-base font-bold">Demo access ended</p>
                    <p className="mt-2 leading-6">{demoExpiredMessage}</p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <a
                        href="mailto:miliksystem@gmail.com?subject=Milik%20Activation%20Request"
                        className="inline-flex items-center gap-2 rounded-full bg-[#0B3B2E] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#0A3127]"
                      >
                        Contact MILIK
                        <FaArrowRight />
                      </a>
                      <button
                        type="button"
                        onClick={handleOverlayClose}
                        className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-5 py-2.5 text-sm font-bold text-amber-900 transition hover:bg-amber-100"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : successMessage ? (
              <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-900 shadow-sm">
                <div className="flex items-start gap-3">
                  <FaCheckCircle className="mt-0.5 text-emerald-600" />
                  <div>
                    <p className="text-base font-bold">Request received</p>
                    <p className="mt-2 leading-6">{successMessage}</p>
                    <button
                      type="button"
                      onClick={handleOverlayClose}
                      className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#0B3B2E] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#0A3127]"
                    >
                      Close
                      <FaArrowRight />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <span className="mb-3 block text-sm font-semibold text-slate-700">I am joining as</span>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(roleCards).map(([roleKey, roleValue]) => {
                      const Icon = roleValue.icon;
                      const active = form.role === roleKey;
                      return (
                        <button
                          key={roleKey}
                          type="button"
                          onClick={() => handleRoleChange(roleKey)}
                          className={`rounded-[24px] border px-4 py-4 text-left transition-all duration-200 ${
                            active
                              ? "border-[#0B3B2E] bg-[#0B3B2E]/5 shadow-sm ring-4 ring-[#0B3B2E]/10"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ${
                                active ? "bg-[#0B3B2E] text-white" : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              <Icon />
                            </span>
                            <div>
                              <p className="text-sm font-bold text-slate-900">{roleValue.title}</p>
                              <p className="mt-1 text-xs leading-5 text-slate-500">{roleValue.subtitle}</p>
                              <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#FF8C00]">
                                {roleValue.badge}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Full name</span>
                    <input
                      name="name"
                      value={form.name}
                      onChange={handleChange}
                      placeholder="Your full name"
                      className={`${inputClass} ${fieldErrors.name ? "border-red-300 bg-red-50" : ""}`}
                    />
                    {fieldErrors.name ? <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.name}</p> : null}
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Work email</span>
                    <input
                      name="email"
                      value={form.email}
                      onChange={handleChange}
                      type="email"
                      placeholder="name@company.com"
                      className={`${inputClass} ${fieldErrors.email ? "border-red-300 bg-red-50" : ""}`}
                    />
                    {fieldErrors.email ? <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.email}</p> : null}
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Phone number</span>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
                        <FaPhoneAlt />
                      </span>
                      <input
                        name="phone"
                        value={form.phone}
                        onChange={handleChange}
                        placeholder="07xx xxx xxx"
                        className={`${inputClass} pl-11 ${fieldErrors.phone ? "border-red-300 bg-red-50" : ""}`}
                      />
                    </div>
                    {fieldErrors.phone ? <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.phone}</p> : null}
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      {form.role === "landlord" ? "Property / portfolio name" : "Company / brand"}
                    </span>
                    <input
                      name="company"
                      value={form.company}
                      onChange={handleChange}
                      placeholder={form.role === "landlord" ? "Example: Kilimani Apartments" : "Your company name"}
                      className={`${inputClass} ${fieldErrors.company ? "border-red-300 bg-red-50" : ""}`}
                    />
                    {fieldErrors.company ? <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.company}</p> : null}
                  </label>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white/80 p-4 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setShowMoreFields((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div>
                      <p className="text-sm font-bold text-slate-900">Add a little more context</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Optional, but useful when you want a more tailored follow-up.
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                      {showMoreFields ? "Hide" : "Optional"}
                    </span>
                  </button>

                  {showMoreFields ? (
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-700">Portfolio size</span>
                          <select
                            name="portfolioSize"
                            value={form.portfolioSize}
                            onChange={handleChange}
                            className={inputClass}
                          >
                            <option value="">Select size</option>
                            {portfolioOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-700">City</span>
                          <input
                            name="city"
                            value={form.city}
                            onChange={handleChange}
                            placeholder="Nairobi"
                            className={inputClass}
                          />
                        </label>
                      </div>

                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-slate-700">What would you like to see first?</span>
                        <textarea
                          name="notes"
                          value={form.notes}
                          onChange={handleChange}
                          rows={3}
                          placeholder="Example: landlord statements, receipting, accounting reports, company setup, or trial balance."
                          className={inputClass}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>

                {error ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0B3B2E] px-5 py-4 text-sm font-bold text-white shadow-lg shadow-[#0B3B2E]/20 transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={loading}
                >
                  {loading ? "Preparing your access..." : roleCopy.submitLabel}
                  {loading ? null : <FaArrowRight />}
                </button>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-medium text-slate-500">
                  <span className="inline-flex items-center gap-2">
                    <FaLock /> Your details stay private.
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <FaUserTie /> Built for serious property operations.
                  </span>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FreeTrialModal;

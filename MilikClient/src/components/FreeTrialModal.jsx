import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaArrowLeft,
  FaArrowRight,
  FaBuilding,
  FaCar,
  FaCheckCircle,
  FaClock,
  FaHandshake,
  FaLock,
  FaPhoneAlt,
  FaTimes,
  FaUsers,
  FaWarehouse,
} from "react-icons/fa";
import { loginSuccess } from "../redux/authSlice";
import { getCompanySuccess } from "../redux/companiesRedux";

const API_BASE = String(import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const DEMO_EXPIRED_MESSAGE = "Your demo period has ended. Contact MILIK for activation.";

const MODULES = [
  {
    key: "property_management",
    icon: FaBuilding,
    label: "Property Management",
    desc: "Tenant billing, M-PESA rent collection, landlord statements and financial reports.",
    color: "text-[#0B3B2E]",
    bg: "bg-[#0B3B2E]/10",
    activeBorder: "border-[#0B3B2E]",
    activeRing: "ring-[#0B3B2E]/15",
    activeBg: "bg-[#0B3B2E]/5",
  },
  {
    key: "car_wash",
    icon: FaCar,
    label: "Car Wash",
    desc: "Job tracking, vehicle plates, customer loyalty program and staff commissions.",
    color: "text-sky-700",
    bg: "bg-sky-50",
    activeBorder: "border-sky-500",
    activeRing: "ring-sky-500/15",
    activeBg: "bg-sky-50",
  },
  {
    key: "human_resources",
    icon: FaUsers,
    label: "Human Resources",
    desc: "Employee records, payroll, leave management and KPI appraisals.",
    color: "text-violet-700",
    bg: "bg-violet-50",
    activeBorder: "border-violet-500",
    activeRing: "ring-violet-500/15",
    activeBg: "bg-violet-50",
  },
  {
    key: "inventory_pos",
    icon: FaWarehouse,
    label: "Inventory & POS",
    desc: "Stock management, purchase orders, POS sessions and till reconciliation.",
    color: "text-orange-700",
    bg: "bg-orange-50",
    activeBorder: "border-orange-500",
    activeRing: "ring-orange-500/15",
    activeBg: "bg-orange-50",
  },
  {
    key: "property_sales",
    icon: FaHandshake,
    label: "Property Sales",
    desc: "Listings, buyer management, deal pipeline and agent commissions.",
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    activeBorder: "border-emerald-500",
    activeRing: "ring-emerald-500/15",
    activeBg: "bg-emerald-50",
  },
];

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-4 focus:ring-[#0B3B2E]/10";

const initialForm = { name: "", email: "", phone: "", company: "" };

const FreeTrialModal = ({ isOpen, onClose }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [selectedModules, setSelectedModules] = useState(new Set());
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [demoExpiredMessage, setDemoExpiredMessage] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setSelectedModules(new Set());
    setForm(initialForm);
    setLoading(false);
    setError("");
    setFieldErrors({});
    setDemoExpiredMessage("");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape" && !loading) onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen, loading, onClose]);

  const toggleModule = (key) => {
    setSelectedModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
    if (fieldErrors[name]) setFieldErrors((p) => ({ ...p, [name]: "" }));
    if (error) setError("");
  };

  const validateForm = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = "Full name is required";
    if (!form.email.trim()) errs.email = "Email is required";
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = "Enter a valid email address";
    if (!form.phone.trim()) errs.phone = "Phone number is required";
    if (!form.company.trim()) errs.company = "Company or business name is required";
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validateForm();
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          company: form.company.trim(),
          role: "property_manager",
          modules: [...selectedModules],
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Unable to complete your request right now.");
      }

      if (data.demoAvailable && data.token && data.user) {
        dispatch(loginSuccess({ token: data.token, user: data.user }));
        if (data.user?.company?._id) {
          dispatch(getCompanySuccess(data.user.company));
          localStorage.setItem("milik_active_company_id", data.user.company._id);
        }
        toast.success(
          data.resumedDemo
            ? "Welcome back. Resuming your remaining demo time."
            : "Welcome to Milik. Your workspace is ready."
        );
        onClose?.();
        navigate(data.redirectTo || "/dashboard");
        return;
      }

      if (data?.demoExpired) {
        setDemoExpiredMessage(data?.message || DEMO_EXPIRED_MESSAGE);
        return;
      }

      toast.success("Request received. We'll be in touch shortly.");
      onClose?.();
    } catch (err) {
      setError(err?.message || "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const canProceed = selectedModules.size > 0;
  const selectedList = MODULES.filter((m) => selectedModules.has(m.key));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 py-4 backdrop-blur-sm md:px-6"
      onClick={() => { if (!loading) onClose?.(); }}
    >
      <div
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/70 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.24)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          className="absolute right-4 top-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          onClick={() => { if (!loading) onClose?.(); }}
          disabled={loading}
        >
          <FaTimes />
        </button>

        <div className="grid w-full overflow-y-auto lg:grid-cols-[1fr_1.1fr] lg:overflow-hidden">

          {/* ── Left brand panel ── */}
          <div className="relative overflow-hidden bg-[linear-gradient(180deg,#0B3B2E_0%,#0E4C3D_100%)] px-7 py-8 text-white md:px-9 md:py-10">
            <div className="absolute -right-12 top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -left-10 bottom-6 h-40 w-40 rounded-full bg-[#FF8C00]/20 blur-3xl" />

            <div className="relative">
              <div className="inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur">
                <img src="/logo.png" alt="Milik" className="h-8 w-8 object-contain" />
                <span>Milik Demo Access</span>
              </div>

              {step === 1 ? (
                <>
                  <h2 className="mt-6 text-3xl font-extrabold leading-tight md:text-[2rem]">
                    Pick your modules. Open your workspace.
                  </h2>
                  <p className="mt-4 text-sm leading-7 text-white/85">
                    Select any combination of modules — each one includes a full accounting backbone with Chart of Accounts, Trial Balance and financial reports at no extra cost.
                  </p>
                  <div className="mt-8 space-y-3">
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3.5 backdrop-blur">
                      <FaClock className="flex-shrink-0 text-[#F8C471]" />
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/60">Access window</p>
                        <p className="mt-0.5 text-sm font-bold">14-day guided workspace</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3.5 backdrop-blur">
                      <FaLock className="flex-shrink-0 text-[#F8C471]" />
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/60">Environment</p>
                        <p className="mt-0.5 text-sm font-bold">Dedicated demo company, not production</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3.5 backdrop-blur">
                      <FaCheckCircle className="flex-shrink-0 text-[#F8C471]" />
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/60">Accounting</p>
                        <p className="mt-0.5 text-sm font-bold">Full accounting layer included with every module</p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="mt-6 text-3xl font-extrabold leading-tight md:text-[2rem]">
                    {selectedList.length === 1
                      ? `${selectedList[0].label} demo`
                      : `${selectedList.length} modules selected`}
                  </h2>
                  <p className="mt-4 text-sm leading-7 text-white/85">
                    Your demo workspace will be ready the moment you submit. An access link is also sent to your email so you can return later.
                  </p>
                  <div className="mt-6 space-y-2">
                    {selectedList.map((m) => (
                      <div key={m.key} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                        <FaCheckCircle className="flex-shrink-0 text-[#F8C471]" />
                        <span className="text-sm font-semibold">{m.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 space-y-3">
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3.5 backdrop-blur">
                      <FaClock className="flex-shrink-0 text-[#F8C471]" />
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/60">Access window</p>
                        <p className="mt-0.5 text-sm font-bold">14-day guided workspace</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3.5 backdrop-blur">
                      <FaLock className="flex-shrink-0 text-[#F8C471]" />
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/60">Environment</p>
                        <p className="mt-0.5 text-sm font-bold">Dedicated demo company, not production</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Right panel ── */}
          <div className="bg-[linear-gradient(180deg,#ffffff_0%,#f8fbf9_100%)] px-6 py-8 md:px-8 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">

            {/* Step indicator */}
            <div className="mb-6 flex items-center gap-2">
              <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-extrabold transition-colors ${step >= 1 ? "bg-[#0B3B2E] text-white" : "bg-slate-200 text-slate-500"}`}>1</div>
              <div className={`h-px flex-1 transition-colors ${step >= 2 ? "bg-[#0B3B2E]" : "bg-slate-200"}`} />
              <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-extrabold transition-colors ${step >= 2 ? "bg-[#0B3B2E] text-white" : "bg-slate-200 text-slate-500"}`}>2</div>
            </div>

            {/* ── Expired state ── */}
            {demoExpiredMessage ? (
              <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950 shadow-sm">
                <div className="flex items-start gap-3">
                  <FaClock className="mt-0.5 flex-shrink-0 text-amber-600" />
                  <div>
                    <p className="text-base font-bold">Demo access ended</p>
                    <p className="mt-2 leading-6">{demoExpiredMessage}</p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <a
                        href="mailto:miliksystem@gmail.com?subject=Milik%20Activation%20Request"
                        className="inline-flex items-center gap-2 rounded-full bg-[#0B3B2E] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#0A3127]"
                      >
                        Contact MILIK <FaArrowRight />
                      </a>
                      <button
                        type="button"
                        onClick={() => { if (!loading) onClose?.(); }}
                        className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-5 py-2.5 text-sm font-bold text-amber-900 transition hover:bg-amber-100"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </div>

            /* ── Step 1: Module picker ── */
            ) : step === 1 ? (
              <>
                <div className="mb-5">
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Step 1 of 2</p>
                  <h3 className="mt-2 text-2xl font-extrabold text-slate-900">Which modules does your business need?</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-500">Select all that apply — you can activate more after onboarding.</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {MODULES.map((mod) => {
                    const active = selectedModules.has(mod.key);
                    const Icon = mod.icon;
                    return (
                      <button
                        key={mod.key}
                        type="button"
                        onClick={() => toggleModule(mod.key)}
                        className={`rounded-[22px] border p-4 text-left transition-all duration-150 ${
                          active
                            ? `${mod.activeBorder} ${mod.activeBg} ring-4 ${mod.activeRing}`
                            : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className={`inline-flex rounded-xl p-2.5 text-xl ${mod.bg} ${mod.color}`}>
                            <Icon />
                          </div>
                          {active ? (
                            <FaCheckCircle className={`mt-0.5 flex-shrink-0 text-lg ${mod.color}`} />
                          ) : (
                            <span className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 rounded-full border-2 border-slate-300" />
                          )}
                        </div>
                        <p className="mt-3 text-sm font-extrabold text-slate-900">{mod.label}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{mod.desc}</p>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => { if (canProceed) setStep(2); }}
                  disabled={!canProceed}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0B3B2E] px-5 py-4 text-sm font-bold text-white shadow-lg shadow-[#0B3B2E]/20 transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {canProceed
                    ? `Continue — ${selectedModules.size} module${selectedModules.size !== 1 ? "s" : ""} selected`
                    : "Select at least one module"}
                  {canProceed && <FaArrowRight />}
                </button>
              </>

            /* ── Step 2: Short form ── */
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-[#0B3B2E]"
                >
                  <FaArrowLeft className="text-xs" /> Back to modules
                </button>

                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Step 2 of 2</p>
                  <h3 className="mt-2 text-2xl font-extrabold text-slate-900">Just a few details to open your workspace.</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-500">Takes less than a minute. Your demo workspace opens immediately.</p>
                </div>

                <div className="rounded-[26px] border border-slate-200 bg-white/90 p-5 shadow-sm space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">Full name</span>
                      <input
                        name="name"
                        value={form.name}
                        onChange={handleChange}
                        placeholder="Your full name"
                        className={`${inputClass} ${fieldErrors.name ? "border-red-300 bg-red-50" : ""}`}
                      />
                      {fieldErrors.name && <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.name}</p>}
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
                      {fieldErrors.email && <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.email}</p>}
                    </label>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
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
                      {fieldErrors.phone && <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.phone}</p>}
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">Company / business</span>
                      <input
                        name="company"
                        value={form.company}
                        onChange={handleChange}
                        placeholder="Your company name"
                        className={`${inputClass} ${fieldErrors.company ? "border-red-300 bg-red-50" : ""}`}
                      />
                      {fieldErrors.company && <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.company}</p>}
                    </label>
                  </div>
                </div>

                {error && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0B3B2E] px-5 py-4 text-sm font-bold text-white shadow-lg shadow-[#0B3B2E]/20 transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Opening your workspace..." : "Open demo workspace"}
                  {!loading && <FaArrowRight />}
                </button>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-medium text-slate-500">
                  <span className="inline-flex items-center gap-2"><FaLock /> Your details stay private.</span>
                  <span>Workspace ready in seconds.</span>
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

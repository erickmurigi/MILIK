import React, { useEffect, useState } from "react";
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

const API_BASE = String(import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

const MODULES = [
  {
    key: "property_management",
    icon: FaBuilding,
    label: "Property Management",
    desc: "Tenant billing, M-PESA rent collection, landlord statements and financial reports.",
  },
  {
    key: "car_wash",
    icon: FaCar,
    label: "Car Wash",
    desc: "Job tracking, vehicle plates, customer loyalty program and staff commissions.",
  },
  {
    key: "human_resources",
    icon: FaUsers,
    label: "Human Resources",
    desc: "Employee records, payroll, leave management and KPI appraisals.",
  },
  {
    key: "inventory_pos",
    icon: FaWarehouse,
    label: "Inventory & POS",
    desc: "Stock management, purchase orders, POS sessions and till reconciliation.",
  },
  {
    key: "property_sales",
    icon: FaHandshake,
    label: "Property Sales",
    desc: "Listings, buyer management, deal pipeline and agent commissions.",
  },
];

const inputClass =
  "w-full border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/15";

const initialForm = { name: "", email: "", phone: "", company: "" };

const FreeTrialModal = ({ isOpen, onClose, initialModules = [] }) => {
  const [step, setStep] = useState(1);
  const [selectedModules, setSelectedModules] = useState(new Set());
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setSelectedModules(new Set(initialModules));
    setForm(initialForm);
    setLoading(false);
    setError("");
    setFieldErrors({});
    setSubmitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      setSubmitted(true);
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 py-4"
      onClick={() => { if (!loading) onClose?.(); }}
    >
      <div
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl overflow-hidden border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center border border-slate-300 bg-white text-slate-500 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E] disabled:opacity-50"
          onClick={() => { if (!loading) onClose?.(); }}
          disabled={loading}
        >
          <FaTimes />
        </button>

        <div className="grid w-full overflow-y-auto lg:grid-cols-[1fr_1.1fr] lg:overflow-hidden">

          {/* ── Left brand panel ── */}
          <div className="bg-[#0B3B2E] px-7 py-8 text-white md:px-9 md:py-10">
            <div className="inline-flex items-center gap-3 border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold">
              <img src="/milik-icon-white.png" alt="" className="h-6 w-6 object-contain" />
              <span>Request a Free Demo</span>
            </div>

            {step === 1 ? (
              <>
                <h2 className="mt-6 text-2xl font-extrabold leading-tight md:text-[1.75rem]">
                  Pick your modules. Open your workspace.
                </h2>
                <p className="mt-4 text-sm leading-7 text-white/80">
                  Select any combination of modules — each one includes a full accounting backbone with Chart of Accounts, Trial Balance and financial reports at no extra cost.
                </p>
              </>
            ) : (
              <>
                <h2 className="mt-6 text-2xl font-extrabold leading-tight md:text-[1.75rem]">
                  {selectedList.length === 1
                    ? `${selectedList[0].label} demo`
                    : `${selectedList.length} modules selected`}
                </h2>
                <p className="mt-4 text-sm leading-7 text-white/80">
                  Share your details and our team will reach out personally to walk you through the system and get you set up.
                </p>
                <div className="mt-6 space-y-2">
                  {selectedList.map((m) => (
                    <div key={m.key} className="flex items-center gap-3 border border-white/15 bg-white/5 px-4 py-3">
                      <FaCheckCircle className="flex-shrink-0 text-[#FF8C00]" />
                      <span className="text-sm font-semibold">{m.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="mt-8 space-y-3">
              <div className="flex items-center gap-3 border border-white/15 bg-white/5 px-4 py-3.5">
                <FaClock className="flex-shrink-0 text-[#FF8C00]" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">Access window</p>
                  <p className="mt-0.5 text-sm font-bold">We'll get you started within 24 hours</p>
                </div>
              </div>
              <div className="flex items-center gap-3 border border-white/15 bg-white/5 px-4 py-3.5">
                <FaLock className="flex-shrink-0 text-[#FF8C00]" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">Environment</p>
                  <p className="mt-0.5 text-sm font-bold">We'll set up your workspace personally</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right panel ── */}
          <div className="bg-white px-6 py-8 md:px-8 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">

            {/* Step indicator */}
            <div className="mb-6 flex items-center gap-2">
              <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center text-xs font-extrabold ${step >= 1 ? "bg-[#0B3B2E] text-white" : "bg-slate-200 text-slate-500"}`}>1</div>
              <div className={`h-px flex-1 ${step >= 2 ? "bg-[#0B3B2E]" : "bg-slate-200"}`} />
              <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center text-xs font-extrabold ${step >= 2 ? "bg-[#0B3B2E] text-white" : "bg-slate-200 text-slate-500"}`}>2</div>
            </div>

            {/* ── Step 1: Module picker ── */}
            {step === 1 ? (
              <>
                <div className="mb-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#FF8C00]">Step 1 of 2</p>
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
                        className={`border p-4 text-left transition-colors ${
                          active ? "border-[#0B3B2E] bg-[#0B3B2E]/5" : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="inline-flex border border-slate-200 bg-slate-50 p-2.5 text-lg text-[#0B3B2E]">
                            <Icon />
                          </div>
                          <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center border-2 ${active ? "border-[#0B3B2E] bg-[#0B3B2E]" : "border-slate-300"}`}>
                            {active && <FaCheckCircle className="text-[11px] text-white" />}
                          </span>
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
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 border border-[#0B3B2E] bg-[#0B3B2E] px-5 py-4 text-sm font-bold text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
                >
                  {canProceed
                    ? `Continue — ${selectedModules.size} module${selectedModules.size !== 1 ? "s" : ""} selected`
                    : "Select at least one module"}
                  {canProceed && <FaArrowRight />}
                </button>
              </>

            /* ── Step 2: Short form ── */
            ) : submitted ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="inline-flex h-16 w-16 items-center justify-center border border-[#0B3B2E] bg-[#0B3B2E]/10 text-[#0B3B2E]">
                  <FaCheckCircle className="text-3xl" />
                </div>
                <p className="mt-5 text-xs font-extrabold uppercase tracking-[0.24em] text-[#FF8C00]">Request received</p>
                <h3 className="mt-2 text-2xl font-extrabold text-slate-900">We'll be in touch!</h3>
                <p className="mt-3 text-sm leading-7 text-slate-500">
                  Thank you for your interest in Milik. Our team will review your request and reach out via email or phone shortly.
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-6 inline-flex items-center gap-2 border border-[#0B3B2E] bg-[#0B3B2E] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#0A3127]"
                >
                  Close
                </button>
              </div>
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
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#FF8C00]">Step 2 of 2</p>
                  <h3 className="mt-2 text-2xl font-extrabold text-slate-900">Just a few details and we'll be in touch.</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-500">Takes less than a minute. We'll reach out via email or phone.</p>
                </div>

                <div className="border border-slate-200 bg-white p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">Full name</span>
                      <input
                        name="name"
                        value={form.name}
                        onChange={handleChange}
                        placeholder="Your full name"
                        className={`${inputClass} ${fieldErrors.name ? "border-red-400 bg-red-50" : ""}`}
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
                        className={`${inputClass} ${fieldErrors.email ? "border-red-400 bg-red-50" : ""}`}
                      />
                      {fieldErrors.email && <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.email}</p>}
                    </label>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
                          className={`${inputClass} pl-11 ${fieldErrors.phone ? "border-red-400 bg-red-50" : ""}`}
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
                        className={`${inputClass} ${fieldErrors.company ? "border-red-400 bg-red-50" : ""}`}
                      />
                      {fieldErrors.company && <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.company}</p>}
                    </label>
                  </div>
                </div>

                {error && (
                  <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex w-full items-center justify-center gap-2 border border-[#0B3B2E] bg-[#0B3B2E] px-5 py-4 text-sm font-bold text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Sending your request..." : "Request access"}
                  {!loading && <FaArrowRight />}
                </button>

                <div className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-500">
                  <span className="inline-flex items-center gap-2"><FaLock /> Your details stay private.</span>
                  <span>We'll respond within 24 hours.</span>
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

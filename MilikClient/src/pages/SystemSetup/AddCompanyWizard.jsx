import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  FaArrowLeft,
  FaBuilding,
  FaCalculator,
  FaCar,
  FaCalendarAlt,
  FaCheckCircle,
  FaBoxes,
  FaEnvelope,
  FaImage,
  FaMapMarkerAlt,
  FaPhone,
  FaSave,
  FaShieldAlt,
  FaSpinner,
  FaStore,
  FaUsers,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { createCompany, getCompany, updateCompany } from "../../redux/apiCalls";
import {
  applyCompanyModeBaseModules,
  COMPANY_OPERATING_MODES,
  getCompanyOperatingModeLabel,
  normalizeCompanyModules,
  normalizeCompanyOperatingMode,
} from "../../utils/companyModules";

// ─── Constants ───────────────────────────────────────────────────────────────

const LOGO_MAX_BYTES = 1 * 1024 * 1024; // 1 MB before base64 encoding

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MODULE_OPTIONS = [
  {
    key: "propertyManagement",
    label: "Property Management",
    description: "Properties, units, landlords, tenants and leases.",
    icon: FaBuilding,
    core: false,
  },
  {
    key: "billing",
    label: "Billing",
    description: "Tenant invoicing, receipting and rent collection.",
    icon: FaEnvelope,
    core: false,
  },
  {
    key: "accounts",
    label: "Accounting",
    description: "General ledger, journals, vouchers and financial reports.",
    icon: FaCalculator,
    core: false,
  },
  {
    key: "hr",
    label: "Human Resource",
    description: "Staff records, payroll and leave management.",
    icon: FaUsers,
    core: false,
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Stock tracking, requisitions and inventory valuation.",
    icon: FaBoxes,
    core: false,
  },
  {
    key: "pos",
    label: "POS",
    description: "Point-of-sale sales and retail outlet management.",
    icon: FaStore,
    core: false,
  },
  {
    key: "securityServices",
    label: "Security Services",
    description: "Guard deployment, incident reporting and shift scheduling.",
    icon: FaShieldAlt,
    core: false,
  },
  {
    key: "carwash",
    label: "MILIK Car Wash",
    description: "Wash jobs, services, payments, staff and daily car wash operations.",
    icon: FaCar,
    core: false,
  },
];

const COMPANY_MODE_OPTIONS = [
  {
    key: COMPANY_OPERATING_MODES.PROPERTY_MANAGER,
    label: "Property Manager",
    description: "Manages properties on behalf of landlords. Full landlord statement and commission flows enabled.",
  },
  {
    key: COMPANY_OPERATING_MODES.SELF_MANAGING_LANDLORD,
    label: "Self-Managing Landlord",
    description: "Landlord manages their own properties directly. Simplified workflow without commission structures.",
  },
  {
    key: COMPANY_OPERATING_MODES.OTHER,
    label: "Other",
    description: "General business workspace for companies that do not use property management workflows.",
  },
];

const ALL_MODULE_KEYS = [
  "propertyManagement", "accounts", "billing", "inventory",
  "telcoDealership", "procurement", "hr", "facilityManagement",
  "hotelManagement", "propertySale", "frontOffice", "dms",
  "academics", "projectManagement", "assetValuation", "pos", "securityServices",
  "carwash",
];

const buildInitialModules = () =>
  ALL_MODULE_KEYS.reduce((acc, key) => { acc[key] = false; return acc; }, {});

const CURRENT_YEAR = new Date().getFullYear();
const FISCAL_YEARS = Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - 2 + i);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const INITIAL_STATE = {
  companyName: "",
  registrationNo: "",
  taxPIN: "",
  taxExemptCode: "",
  postalAddress: "",
  country: "Kenya",
  town: "",
  roadStreet: "",
  baseCurrency: "KES",
  taxRegime: "VAT",
  fiscalStartMonth: "January",
  fiscalStartYear: CURRENT_YEAR,
  operationPeriodType: "Monthly",
  email: "",
  phoneNo: "",
  slogan: "",
  logo: "",
  companyMode: COMPANY_OPERATING_MODES.OTHER,
  modules: applyCompanyModeBaseModules(buildInitialModules(), COMPANY_OPERATING_MODES.OTHER),
};

const mapCompanyToForm = (company = {}) => ({
  companyName: company.companyName || "",
  registrationNo: company.registrationNo || "",
  taxPIN: company.taxPIN || "",
  taxExemptCode: company.taxExemptCode || "",
  postalAddress: company.postalAddress || "",
  country: company.country || "Kenya",
  town: company.town || "",
  roadStreet: company.roadStreet || "",
  baseCurrency: company.baseCurrency || "KES",
  taxRegime: company.taxRegime || "VAT",
  fiscalStartMonth: company.fiscalStartMonth || "January",
  fiscalStartYear: company.fiscalStartYear || CURRENT_YEAR,
  operationPeriodType: company.operationPeriodType || "Monthly",
  email: company.email || "",
  phoneNo: company.phoneNo || "",
  slogan: company.slogan || "",
  logo: company.logo || "",
  companyMode: normalizeCompanyOperatingMode(company.companyMode),
  modules: applyCompanyModeBaseModules(
    { ...buildInitialModules(), ...normalizeCompanyModules(company) },
    normalizeCompanyOperatingMode(company.companyMode)
  ),
});

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const isValidEmailFormat = (value = "") =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value).trim());

const getApiErrorMessage = (error, fallback = "Failed to save company") => {
  const data = error?.response?.data || {};
  const firstFieldError = Array.isArray(data.errors) && data.errors.length
    ? data.errors.find((item) => item?.message)?.message
    : "";
  return firstFieldError || data.message || data.error || error?.message || fallback;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const SectionHeader = ({ icon: Icon, color, title }) => (
  <div className="mb-4 flex items-center gap-2.5">
    <div className={`rounded-lg p-2 ${color}`}><Icon className="text-sm" /></div>
    <h2 className="text-sm font-bold text-slate-900">{title}</h2>
  </div>
);

const Field = ({ label, required, children, span2 }) => (
  <label className={`block text-xs font-semibold text-slate-700 ${span2 ? "md:col-span-2" : ""}`}>
    <span className="mb-1 block">{label}{required && <span className="ml-0.5 text-red-500">*</span>}</span>
    {children}
  </label>
);

const inputCls = "mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10";
const selectCls = "mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10 bg-white";

// ─── Component ────────────────────────────────────────────────────────────────

const AddCompanyWizard = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const fileInputRef = useRef(null);
  const isEditMode = Boolean(id);

  const [formData, setFormData] = useState(INITIAL_STATE);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEditMode);
  const [errors, setErrors] = useState({});

  const pageTitle = isEditMode ? "Edit Company" : "Register Company";

  const selectedModulesCount = useMemo(
    () => MODULE_OPTIONS.filter((m) => formData.modules?.[m.key]).length,
    [formData.modules]
  );

  // ── Load existing company ──
  useEffect(() => {
    if (!isEditMode) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setErrors({});
      try {
        const response = await dispatch(getCompany(id));
        const company = response?.company || response;
        if (active && company?._id) setFormData(mapCompanyToForm(company));
      } catch (err) {
        const msg = err?.response?.data?.message || err?.message || "Failed to load company";
        if (active) toast.error(msg);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [dispatch, id, isEditMode]);

  // ── Keep tab title in sync ──
  useEffect(() => {
    if (location.state?.tabTitle !== pageTitle) {
      navigate(location.pathname, {
        replace: true,
        state: { ...(location.state || {}), tabTitle: pageTitle },
      });
    }
  }, [location.pathname, location.state, navigate, pageTitle]);

  // ── Field helpers ──
  const setField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
  };

  const setCompanyMode = (value) => {
    const mode = normalizeCompanyOperatingMode(value);
    setFormData((prev) => ({
      ...prev,
      companyMode: mode,
      modules: applyCompanyModeBaseModules(prev.modules, mode),
    }));
  };

  const toggleModule = (key) => {
    setFormData((prev) => ({
      ...prev,
      modules: { ...prev.modules, [key]: !prev.modules[key] },
    }));
  };

  // ── Validation ──
  const validate = () => {
    const e = {};
    const name = String(formData.companyName || "").trim();
    if (name.length < 3) e.companyName = "Company name must be at least 3 characters";
    if (!String(formData.postalAddress || "").trim()) e.postalAddress = "Postal address is required";
    if (formData.email && !isValidEmailFormat(formData.email)) e.email = "Enter a valid email address";
    if (formData.phoneNo) {
      const digits = formData.phoneNo.replace(/\D/g, "");
      if (digits.length < 7) e.phoneNo = "Phone number must have at least 7 digits";
    }
    const year = Number(formData.fiscalStartYear);
    if (!year || year < 2000 || year > 2100) e.fiscalStartYear = "Fiscal year must be between 2000 and 2100";
    if (selectedModulesCount === 0) e.modules = "Select at least one module";
    return e;
  };

  // ── Logo upload ──
  const handleLogoSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file for the company logo");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("Logo must be under 1 MB. Resize the image and try again.");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setField("logo", dataUrl);
    } catch {
      toast.error("Failed to read the selected logo file");
    }
  };

  // ── Submit ──
  const handleSubmit = async (event) => {
    event.preventDefault();
    const fieldErrors = validate();
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      toast.error(Object.values(fieldErrors)[0]);
      return;
    }
    setErrors({});
    setSaving(true);

    try {
      const payload = {
        ...formData,
        companyMode: normalizeCompanyOperatingMode(formData.companyMode),
        modules: applyCompanyModeBaseModules(formData.modules, formData.companyMode),
        fiscalStartYear: Number(formData.fiscalStartYear),
      };
      const action = isEditMode ? updateCompany(id, payload) : createCompany(payload);
      const response = await dispatch(action);
      const savedCompany = response?.company || response;

      if (!isEditMode && savedCompany?._id) {
        localStorage.setItem("milik_active_company_id", savedCompany._id);
        await dispatch(getCompany(savedCompany._id));
      }

      toast.success(isEditMode ? "Company updated successfully" : "Company registered successfully");

      if (!isEditMode && savedCompany?._id) {
        navigate("/company-setup", {
          replace: true,
          state: { tabTitle: "Company Setup", fromAddCompany: true, createdCompanyId: savedCompany._id },
        });
        return;
      }
      navigate("/system-setup/companies", { replace: true, state: { tabTitle: "Companies" } });
    } catch (err) {
      const apiErrors = err?.response?.data?.errors;
      const firstMsg = getApiErrorMessage(err);
      if (Array.isArray(apiErrors) && apiErrors.length) {
        const mapped = {};
        apiErrors.forEach(({ field, message }) => { if (field) mapped[field] = message; });
        setErrors(mapped);
      }
      toast.error(firstMsg);
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="w-full px-4 py-5">

        {/* Header */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => navigate("/system-setup/companies", { state: { tabTitle: "Companies" } })}
              className="mb-1 inline-flex items-center gap-1.5 text-xs font-bold text-[#0B3B2E] hover:underline"
            >
              <FaArrowLeft /> Back to companies
            </button>
            <h1 className="text-base font-bold text-slate-900">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Modules</div>
              <div className="text-sm font-bold text-slate-800">{selectedModulesCount} selected</div>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Mode</div>
              <div className="text-xs font-semibold text-slate-700">{getCompanyOperatingModeLabel(formData.companyMode)}</div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm">
            <FaSpinner className="animate-spin text-2xl text-[#0B3B2E]" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>

            {/* ── Row 1: Profile left | Logo + Mode right ──────────── */}
            <div className="grid gap-5 xl:grid-cols-[1fr_360px]">

              {/* Company profile */}
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <SectionHeader icon={FaBuilding} color="bg-emerald-50 text-emerald-700" title="Company profile" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Company name" required span2>
                    <input
                      value={formData.companyName}
                      onChange={(e) => setField("companyName", e.target.value)}
                      className={`${inputCls} ${errors.companyName ? "border-red-400" : ""}`}
                      placeholder="Acme Property Management Ltd"
                      maxLength={120}
                    />
                    {errors.companyName && <p className="mt-1 text-[11px] text-red-500">{errors.companyName}</p>}
                  </Field>

                  <Field label="Slogan">
                    <input
                      value={formData.slogan}
                      onChange={(e) => setField("slogan", e.target.value)}
                      className={inputCls}
                      placeholder="Professional operations."
                      maxLength={120}
                    />
                  </Field>

                  <Field label="Registration No.">
                    <input
                      value={formData.registrationNo}
                      onChange={(e) => setField("registrationNo", e.target.value)}
                      className={inputCls}
                      placeholder="CPR/2026/001"
                      maxLength={50}
                    />
                  </Field>

                  <Field label="Tax PIN (KRA)">
                    <input
                      value={formData.taxPIN}
                      onChange={(e) => setField("taxPIN", e.target.value)}
                      className={inputCls}
                      placeholder="A123456789X"
                      maxLength={20}
                    />
                  </Field>

                  <Field label="Tax Exempt Code">
                    <input
                      value={formData.taxExemptCode}
                      onChange={(e) => setField("taxExemptCode", e.target.value)}
                      className={inputCls}
                      placeholder="Optional"
                      maxLength={30}
                    />
                  </Field>

                  <Field label="Email">
                    <div className="relative mt-0.5">
                      <FaEnvelope className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setField("email", e.target.value)}
                        className={`w-full rounded-lg border py-2 pl-8 pr-3 text-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10 ${errors.email ? "border-red-400" : "border-slate-200"}`}
                        placeholder="info@company.com"
                      />
                    </div>
                    {errors.email && <p className="mt-1 text-[11px] text-red-500">{errors.email}</p>}
                  </Field>

                  <Field label="Phone number">
                    <div className="relative mt-0.5">
                      <FaPhone className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                      <input
                        type="tel"
                        value={formData.phoneNo}
                        onChange={(e) => setField("phoneNo", e.target.value)}
                        className={`w-full rounded-lg border py-2 pl-8 pr-3 text-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10 ${errors.phoneNo ? "border-red-400" : "border-slate-200"}`}
                        placeholder="+254 712 345 678"
                      />
                    </div>
                    {errors.phoneNo && <p className="mt-1 text-[11px] text-red-500">{errors.phoneNo}</p>}
                  </Field>
                </div>
              </section>

              {/* Logo + Operating model stacked */}
              <div className="flex flex-col gap-5">
                {/* Logo */}
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <SectionHeader icon={FaImage} color="bg-slate-100 text-slate-600" title="Company logo" />
                  <p className="mb-3 text-xs text-slate-500">PNG or JPG, max 1 MB. Shown on invoices and reports.</p>
                  <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoSelect} />
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                      {formData.logo
                        ? <img src={formData.logo} alt="Logo preview" className="h-full w-full object-contain" />
                        : <FaImage className="text-xl text-slate-300" />
                      }
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                        {formData.logo ? "Change logo" : "Upload logo"}
                      </button>
                      {formData.logo && (
                        <button type="button" onClick={() => setField("logo", "")} className="text-left text-xs text-rose-500 hover:underline">Remove</button>
                      )}
                    </div>
                  </div>
                </section>

                {/* Operating model */}
                <section className="flex-1 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <SectionHeader icon={FaUsers} color="bg-amber-50 text-amber-600" title="Operating model" />
                  <div className="space-y-2">
                    {COMPANY_MODE_OPTIONS.map((option) => {
                      const selected = formData.companyMode === option.key;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setCompanyMode(option.key)}
                          className={`w-full rounded-lg border p-3 text-left transition ${selected ? "border-[#0B3B2E] bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-xs font-bold text-slate-900">{option.label}</div>
                              <div className="mt-0.5 text-[11px] leading-4 text-slate-500">{option.description}</div>
                            </div>
                            <div className={`mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${selected ? "bg-[#0B3B2E] text-white" : "bg-slate-100 text-slate-500"}`}>
                              {selected ? "✓" : "·"}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>

            {/* ── Row 2: Location left | Fiscal + Modules right ────── */}
            <div className="grid gap-5 xl:grid-cols-[1fr_360px]">

              {/* Location & statutory */}
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <SectionHeader icon={FaMapMarkerAlt} color="bg-orange-50 text-orange-600" title="Location & statutory" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Postal address" required span2>
                    <input
                      value={formData.postalAddress}
                      onChange={(e) => setField("postalAddress", e.target.value)}
                      className={`${inputCls} ${errors.postalAddress ? "border-red-400" : ""}`}
                      placeholder="P.O. Box 12345 – 00100 Nairobi"
                      maxLength={120}
                    />
                    {errors.postalAddress && <p className="mt-1 text-[11px] text-red-500">{errors.postalAddress}</p>}
                  </Field>

                  <Field label="Country">
                    <input value={formData.country} onChange={(e) => setField("country", e.target.value)} className={inputCls} placeholder="Kenya" maxLength={60} />
                  </Field>

                  <Field label="Town / City">
                    <input value={formData.town} onChange={(e) => setField("town", e.target.value)} className={inputCls} placeholder="Nairobi" maxLength={60} />
                  </Field>

                  <Field label="Road / Street">
                    <input value={formData.roadStreet} onChange={(e) => setField("roadStreet", e.target.value)} className={inputCls} placeholder="Westlands Road" maxLength={80} />
                  </Field>

                  <Field label="Base currency">
                    <select value={formData.baseCurrency} onChange={(e) => setField("baseCurrency", e.target.value)} className={selectCls}>
                      <option value="KES">KES — Kenyan Shilling</option>
                      <option value="UGX">UGX — Ugandan Shilling</option>
                      <option value="TZS">TZS — Tanzanian Shilling</option>
                      <option value="USD">USD — US Dollar</option>
                      <option value="EUR">EUR — Euro</option>
                      <option value="GBP">GBP — British Pound</option>
                    </select>
                  </Field>

                  <Field label="Tax regime">
                    <select value={formData.taxRegime} onChange={(e) => setField("taxRegime", e.target.value)} className={selectCls}>
                      <option value="VAT">VAT</option>
                      <option value="GST">GST</option>
                      <option value="Sales Tax">Sales Tax</option>
                      <option value="No Tax">No Tax</option>
                    </select>
                  </Field>
                </div>
              </section>

              {/* Fiscal calendar + Module assignment stacked */}
              <div className="flex flex-col gap-5">
                {/* Fiscal calendar */}
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <SectionHeader icon={FaCalendarAlt} color="bg-violet-50 text-violet-600" title="Fiscal calendar" />
                  <div className="grid gap-3">
                    <Field label="Fiscal start month" required>
                      <select value={formData.fiscalStartMonth} onChange={(e) => setField("fiscalStartMonth", e.target.value)} className={selectCls}>
                        {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </Field>
                    <Field label="Fiscal start year" required>
                      <select value={formData.fiscalStartYear} onChange={(e) => setField("fiscalStartYear", Number(e.target.value))} className={`${selectCls} ${errors.fiscalStartYear ? "border-red-400" : ""}`}>
                        {FISCAL_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                      </select>
                      {errors.fiscalStartYear && <p className="mt-1 text-[11px] text-red-500">{errors.fiscalStartYear}</p>}
                    </Field>
                    <Field label="Billing cycle" required>
                      <select value={formData.operationPeriodType} onChange={(e) => setField("operationPeriodType", e.target.value)} className={selectCls}>
                        <option value="Monthly">Monthly</option>
                        <option value="Quarterly">Quarterly</option>
                        <option value="Annual">Annual</option>
                        <option value="Weekly">Weekly</option>
                      </select>
                    </Field>
                  </div>
                </section>

                {/* Module assignment */}
                <section className="flex-1 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <SectionHeader icon={FaCheckCircle} color="bg-emerald-50 text-emerald-700" title="Modules" />
                  {errors.modules && <p className="mb-2 text-[11px] text-red-500">{errors.modules}</p>}
                  <div className="space-y-1.5">
                    {MODULE_OPTIONS.map((module) => {
                      const Icon = module.icon;
                      const enabled = Boolean(formData.modules[module.key]);
                      const locked = module.core;
                      return (
                        <button
                          key={module.key}
                          type="button"
                          onClick={() => toggleModule(module.key)}
                          className={`w-full rounded-lg border px-3 py-2 text-left transition ${enabled ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-300"} ${locked ? "cursor-default" : ""}`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className={`flex-shrink-0 rounded-md p-1.5 ${enabled ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                              <Icon className="text-[10px]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-slate-900">{module.label}</span>
                                {locked && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">Core</span>}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] text-slate-500">{module.description}</div>
                            </div>
                            <div className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${enabled ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                              {enabled ? "On" : "Off"}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>

            {/* ── Submit bar ───────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-5 py-3 shadow-sm">
              <p className="text-xs text-slate-500">
                {isEditMode
                  ? "Changes take effect immediately after saving."
                  : "A chart of accounts and workspace will be initialised automatically after registration."}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/system-setup/companies", { state: { tabTitle: "Companies" } })}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-5 py-2 text-xs font-bold text-white hover:bg-[#0d4a38] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? <FaSpinner className="animate-spin" /> : <FaSave />}
                  {saving ? "Saving..." : isEditMode ? "Save changes" : "Register company"}
                </button>
              </div>
            </div>

          </form>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AddCompanyWizard;

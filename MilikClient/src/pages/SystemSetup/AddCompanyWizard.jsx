import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  FaArrowLeft,
  FaBuilding,
  FaCheckCircle,
  FaEnvelope,
  FaImage,
  FaPhone,
  FaPlus,
  FaSave,
  FaShieldAlt,
  FaStore,
  FaBoxes,
  FaUsers,
  FaCalculator,
  FaSpinner,
  FaMapMarkerAlt,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { createCompany, getCompany, updateCompany } from "../../redux/apiCalls";
import { normalizeCompanyModules } from "../../utils/companyModules";

const MODULE_OPTIONS = [
  {
    key: "accounts",
    label: "Accounting",
    description: "General ledger, journals, reports, and financial controls.",
    icon: FaCalculator,
  },
  {
    key: "hr",
    label: "Human Resource",
    description: "Employees, staffing workflows, and people administration.",
    icon: FaUsers,
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Items, stores, stock movement, and supply visibility.",
    icon: FaBoxes,
  },
  {
    key: "pos",
    label: "POS",
    description: "Point of sale operations for walk-in transactions and tills.",
    icon: FaStore,
  },
  {
    key: "securityServices",
    label: "Security Services",
    description: "Guarding and security service operations for managed clients.",
    icon: FaShieldAlt,
  },
];

const ALL_MODULE_KEYS = [
  "propertyManagement",
  "accounts",
  "billing",
  "inventory",
  "telcoDealership",
  "procurement",
  "hr",
  "facilityManagement",
  "hotelManagement",
  "propertySale",
  "frontOffice",
  "dms",
  "academics",
  "projectManagement",
  "assetValuation",
  "pos",
  "securityServices",
];

const buildInitialModules = () =>
  ALL_MODULE_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {});

const INITIAL_STATE = {
  companyName: "",
  registrationNo: "",
  taxPIN: "",
  taxExemptCode: "",
  postalAddress: "",
  country: "Kenya",
  town: "",
  roadStreet: "",
  latitude: "",
  longitude: "",
  baseCurrency: "KES",
  taxRegime: "VAT",
  fiscalStartMonth: "January",
  fiscalStartYear: new Date().getFullYear(),
  operationPeriodType: "Monthly",
  email: "",
  phoneNo: "",
  slogan: "",
  logo: "",
  modules: buildInitialModules(),
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
  latitude: company.latitude || "",
  longitude: company.longitude || "",
  baseCurrency: company.baseCurrency || "KES",
  taxRegime: company.taxRegime || "VAT",
  fiscalStartMonth: company.fiscalStartMonth || "January",
  fiscalStartYear: company.fiscalStartYear || new Date().getFullYear(),
  operationPeriodType: company.operationPeriodType || "Monthly",
  email: company.email || "",
  phoneNo: company.phoneNo || "",
  slogan: company.slogan || "",
  logo: company.logo || "",
  modules: {
    ...buildInitialModules(),
    ...normalizeCompanyModules(company),
  },
});

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

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
  const [error, setError] = useState("");

  const pageTitle = isEditMode ? "Company Details" : "New Company";
  const pageSubtitle = isEditMode
    ? "Review and update the selected company without losing the current setup."
    : "Create a new company with a polished MILIK onboarding flow and company-aware module selection.";

  const selectedModulesCount = useMemo(
    () => MODULE_OPTIONS.filter((option) => formData.modules?.[option.key]).length,
    [formData.modules]
  );

  useEffect(() => {
    if (!isEditMode) return;

    let active = true;
    const loadCompany = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await dispatch(getCompany(id));
        const company = response?.company || response;
        if (active && company?._id) {
          setFormData(mapCompanyToForm(company));
        }
      } catch (err) {
        const message = err?.response?.data?.message || err?.message || "Failed to load company details";
        if (active) {
          setError(message);
          toast.error(message);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadCompany();
    return () => {
      active = false;
    };
  }, [dispatch, id, isEditMode]);

  useEffect(() => {
    if (location.state?.tabTitle !== pageTitle) {
      navigate(location.pathname, {
        replace: true,
        state: { ...(location.state || {}), tabTitle: pageTitle },
      });
    }
  }, [location.pathname, location.state, navigate, pageTitle]);

  const setField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const toggleModule = (key) => {
    setFormData((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [key]: !prev.modules[key],
      },
    }));
  };

  const handleLogoSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file for the company logo.");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setField("logo", dataUrl);
    } catch (err) {
      toast.error("Failed to read the selected logo file.");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const action = isEditMode ? updateCompany(id, formData) : createCompany(formData);
      const response = await dispatch(action);
      const savedCompany = response?.company || response;

      if (!isEditMode && savedCompany?._id) {
        localStorage.setItem("milik_active_company_id", savedCompany._id);
      }

      toast.success(isEditMode ? "Company updated successfully" : "Company created successfully");
      navigate("/system-setup/companies", {
        replace: true,
        state: { tabTitle: "Companies" },
      });
    } catch (err) {
      const apiErrors = err?.response?.data?.errors;
      const message = Array.isArray(apiErrors) && apiErrors.length
        ? apiErrors.map((item) => `${item.field}: ${item.message}`).join(" | ")
        : err?.response?.data?.message || err?.message || "Failed to save company";
      setError(message);
      toast.error(err?.response?.data?.message || "Failed to save company");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-[1280px] px-4 py-5">
        <div className="mb-5 overflow-hidden rounded-[28px] border border-emerald-100 bg-gradient-to-r from-[#0A400C] via-[#165E2C] to-[#E85C0D] shadow-xl">
          <div className="grid gap-6 px-6 py-7 text-white md:grid-cols-[1.4fr_0.8fr] md:px-8">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-white/90">
                <FaBuilding /> Milik System Admin
              </div>
              <h1 className="text-2xl font-black md:text-3xl">{pageTitle}</h1>
              <p className="mt-2 max-w-2xl text-sm text-white/85">{pageSubtitle}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 self-start">
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-200">Module set</div>
                <div className="mt-2 text-2xl font-black">{selectedModulesCount}</div>
                <div className="text-xs text-white/80">Selected for this company</div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-200">Logo</div>
                <div className="mt-2 text-2xl font-black">{formData.logo ? "Yes" : "No"}</div>
                <div className="text-xs text-white/80">Branding ready</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate("/system-setup/companies", { state: { tabTitle: "Companies" } })}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700"
          >
            <FaArrowLeft /> Back to companies
          </button>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {isEditMode ? "Editing selected company" : "Fresh company onboarding"}
          </div>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <FaSpinner className="mx-auto animate-spin text-3xl text-emerald-700" />
            <p className="mt-3 text-sm text-slate-600">Loading company details...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-6">
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><FaBuilding /></div>
                    <div>
                      <h2 className="text-lg font-black text-slate-900">Company profile</h2>
                      <p className="text-sm text-slate-500">Core identity, registration, and business contact details.</p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                      Company Name <span className="text-red-500">*</span>
                      <input value={formData.companyName} onChange={(e) => setField("companyName", e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" placeholder="Milik Security Services Ltd" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Registration No.
                      <input value={formData.registrationNo} onChange={(e) => setField("registrationNo", e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" placeholder="CPR/2026/001" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Tax PIN
                      <input value={formData.taxPIN} onChange={(e) => setField("taxPIN", e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" placeholder="A123456789X" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Email
                      <div className="relative mt-1">
                        <FaEnvelope className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={formData.email} onChange={(e) => setField("email", e.target.value)} className="w-full rounded-2xl border border-slate-200 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" placeholder="info@company.com" />
                      </div>
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Phone Number
                      <div className="relative mt-1">
                        <FaPhone className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={formData.phoneNo} onChange={(e) => setField("phoneNo", e.target.value)} className="w-full rounded-2xl border border-slate-200 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" placeholder="0712 345 678" />
                      </div>
                    </label>
                    <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                      Slogan
                      <input value={formData.slogan} onChange={(e) => setField("slogan", e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" placeholder="Professional operations. Total control." />
                    </label>
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-orange-50 p-3 text-orange-600"><FaMapMarkerAlt /></div>
                    <div>
                      <h2 className="text-lg font-black text-slate-900">Location and statutory setup</h2>
                      <p className="text-sm text-slate-500">Address, tax, and operating defaults for this company.</p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                      Postal Address <span className="text-red-500">*</span>
                      <input value={formData.postalAddress} onChange={(e) => setField("postalAddress", e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100" placeholder="P.O. Box 12345 - 00100 Nairobi" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Country
                      <input value={formData.country} onChange={(e) => setField("country", e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Town / City
                      <input value={formData.town} onChange={(e) => setField("town", e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100" placeholder="Nairobi" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Road / Street
                      <input value={formData.roadStreet} onChange={(e) => setField("roadStreet", e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100" placeholder="Westlands Road" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Tax Exempt Code
                      <input value={formData.taxExemptCode} onChange={(e) => setField("taxExemptCode", e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100" placeholder="Optional" />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Base Currency
                      <select value={formData.baseCurrency} onChange={(e) => setField("baseCurrency", e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100">
                        <option value="KES">KES - Kenyan Shilling</option>
                        <option value="USD">USD - US Dollar</option>
                        <option value="EUR">EUR - Euro</option>
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Tax Regime
                      <select value={formData.taxRegime} onChange={(e) => setField("taxRegime", e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100">
                        <option value="VAT">VAT</option>
                        <option value="GST">GST</option>
                        <option value="Sales Tax">Sales Tax</option>
                        <option value="No Tax">No Tax</option>
                      </select>
                    </label>
                  </div>
                </section>
              </div>

              <div className="space-y-6">
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-slate-100 p-3 text-slate-700"><FaImage /></div>
                    <div>
                      <h2 className="text-lg font-black text-slate-900">Company logo</h2>
                      <p className="text-sm text-slate-500">Browse a local image. This will later be used on documents across the system.</p>
                    </div>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} />
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                    {formData.logo ? (
                      <img src={formData.logo} alt="Company logo preview" className="mx-auto mb-4 h-24 w-24 rounded-2xl border border-slate-200 bg-white object-cover shadow-sm" />
                    ) : (
                      <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-2xl bg-white text-3xl text-slate-300 shadow-sm">
                        <FaImage />
                      </div>
                    )}
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-2xl bg-[#E85C0D] px-4 py-2 text-sm font-black text-white transition hover:bg-[#cf4f08]">
                      <FaPlus /> Browse logo
                    </button>
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><FaCheckCircle /></div>
                    <div>
                      <h2 className="text-lg font-black text-slate-900">Modules for this company</h2>
                      <p className="text-sm text-slate-500">Only show the module set you want this company to operate with.</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {MODULE_OPTIONS.map((module) => {
                      const Icon = module.icon;
                      const enabled = Boolean(formData.modules[module.key]);
                      return (
                        <button
                          key={module.key}
                          type="button"
                          onClick={() => toggleModule(module.key)}
                          className={`w-full rounded-2xl border p-4 text-left transition ${enabled ? "border-emerald-300 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3">
                              <div className={`rounded-2xl p-3 ${enabled ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}><Icon /></div>
                              <div>
                                <div className="text-sm font-black text-slate-900">{module.label}</div>
                                <div className="mt-1 text-xs text-slate-500">{module.description}</div>
                              </div>
                            </div>
                            <div className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${enabled ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>
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

            <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-black text-slate-900">Ready to save</div>
                <div className="text-xs text-slate-500">Company name and postal address are required. Email and phone are optional but recommended.</div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => navigate("/system-setup/companies", { state: { tabTitle: "Companies" } })}
                  className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#0A400C] px-5 py-3 text-sm font-black text-white transition hover:bg-[#0d5611] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving ? <FaSpinner className="animate-spin" /> : <FaSave />}
                  {saving ? "Saving..." : isEditMode ? "Save changes" : "Create company"}
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

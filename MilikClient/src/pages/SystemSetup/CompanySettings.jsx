import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";
import { toast } from "react-toastify";
import {
  FaArchive,
  FaCheck,
  FaClock,
  FaCog,
  FaEdit,
  FaExclamationCircle,
  FaLightbulb,
  FaMoneyBillWave,
  FaPlus,
  FaReceipt,
  FaSave,
  FaSpinner,
  FaTimes,
  FaArrowRight,
  FaPowerOff,
} from "react-icons/fa";

const MILIK_GREEN = "#0B3B2E";
const MILIK_ORANGE = "#FF8C00";

const TAB_CONFIG = {
  utilities: {
    label: "Utility Types",
    icon: FaLightbulb,
    endpoint: "utilities",
    empty: "No utility types saved yet.",
    subtitle:
      "Maintain reusable utility and service charge labels for future tenant, unit and meter-reading flows.",
  },
  periods: {
    label: "Billing Periods",
    icon: FaClock,
    endpoint: "periods",
    empty: "No billing periods saved yet.",
    subtitle:
      "Maintain reusable billing cycle defaults for future schedules and operational setup. Historical postings stay untouched.",
  },
  commissions: {
    label: "Commissions",
    icon: FaMoneyBillWave,
    endpoint: "commissions",
    empty: "No commission defaults saved yet.",
    subtitle:
      "Company-level commission defaults are future-facing policy references. Property-level commission setup remains the source of truth per property.",
  },
  expenses: {
    label: "Expense Items",
    icon: FaReceipt,
    endpoint: "expenses",
    empty: "No reusable expense items saved yet.",
    subtitle:
      "Maintain reusable deduction and expense labels for future voucher and operational workflows.",
  },
  tax: {
    label: "Tax Configuration",
    icon: FaCog,
  },
  accounting: {
    label: "Accounting Defaults",
    icon: FaCheck,
  },
};

const emptyForms = {
  utilities: { name: "", description: "", category: "utility", isActive: true },
  periods: { name: "", durationInMonths: 1, durationInDays: 30, isActive: true },
  commissions: { name: "", percentage: "", applicableTo: "rent", description: "", isActive: true },
  expenses: { name: "", description: "", code: "", category: "other", defaultAmount: 0, isActive: true },
};

const toClientTaxCodeId = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value?.toString) return value.toString();
  return fallback;
};

const sanitizeTaxKey = (value, fallback = "") =>
  String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");

const normalizeTaxConfiguration = (settings = {}) => ({
  taxSettings: {
    enabled: Boolean(settings?.taxSettings?.enabled),
    defaultTaxMode: settings?.taxSettings?.defaultTaxMode || "exclusive",
    defaultTaxCodeKey: settings?.taxSettings?.defaultTaxCodeKey || "vat_standard",
    defaultVatRate: Number(settings?.taxSettings?.defaultVatRate || 16),
    roundingPrecision: Number(settings?.taxSettings?.roundingPrecision ?? 2),
    outputVatAccountCode: settings?.taxSettings?.outputVatAccountCode || "2140",
    invoiceTaxableByDefault: Boolean(settings?.taxSettings?.invoiceTaxableByDefault),
    invoiceTaxabilityByCategory: {
      rent: Boolean(settings?.taxSettings?.invoiceTaxabilityByCategory?.rent),
      utility: Boolean(settings?.taxSettings?.invoiceTaxabilityByCategory?.utility),
      penalty: Boolean(settings?.taxSettings?.invoiceTaxabilityByCategory?.penalty),
      deposit: Boolean(settings?.taxSettings?.invoiceTaxabilityByCategory?.deposit),
    },
  },
  taxCodes:
    Array.isArray(settings?.taxCodes) && settings.taxCodes.length > 0
      ? settings.taxCodes.map((code, index) => ({
          _id: toClientTaxCodeId(code?._id, `tax-code-${index + 1}`),
          key: sanitizeTaxKey(code?.key || code?.name, `tax_code_${index + 1}`),
          name: code?.name || `Tax Code ${index + 1}`,
          type: code?.type || "vat",
          rate: Number(code?.rate || 0),
          isDefault: Boolean(code?.isDefault),
          isActive: code?.isActive !== false,
          description: code?.description || "",
        }))
      : [
          {
            _id: "tax-no-tax",
            key: "no_tax",
            name: "No Tax",
            type: "none",
            rate: 0,
            isDefault: false,
            isActive: true,
            description: "Non-taxable item",
          },
          {
            _id: "tax-vat-standard",
            key: "vat_standard",
            name: "VAT Standard",
            type: "vat",
            rate: 16,
            isDefault: true,
            isActive: true,
            description: "Standard output VAT",
          },
        ],
});

const buildTaxSavePayload = (taxConfig = {}) => ({
  taxSettings: {
    enabled: Boolean(taxConfig?.taxSettings?.enabled),
    defaultTaxMode: String(taxConfig?.taxSettings?.defaultTaxMode || "exclusive").toLowerCase() === "inclusive" ? "inclusive" : "exclusive",
    defaultTaxCodeKey: sanitizeTaxKey(taxConfig?.taxSettings?.defaultTaxCodeKey, "vat_standard"),
    defaultVatRate: Number(taxConfig?.taxSettings?.defaultVatRate || 0),
    roundingPrecision: Number(taxConfig?.taxSettings?.roundingPrecision ?? 2),
    outputVatAccountCode: String(taxConfig?.taxSettings?.outputVatAccountCode || "").trim(),
    invoiceTaxableByDefault: Boolean(taxConfig?.taxSettings?.invoiceTaxableByDefault),
    invoiceTaxabilityByCategory: {
      rent: Boolean(taxConfig?.taxSettings?.invoiceTaxabilityByCategory?.rent),
      utility: Boolean(taxConfig?.taxSettings?.invoiceTaxabilityByCategory?.utility),
      penalty: Boolean(taxConfig?.taxSettings?.invoiceTaxabilityByCategory?.penalty),
      deposit: Boolean(taxConfig?.taxSettings?.invoiceTaxabilityByCategory?.deposit),
    },
  },
  taxCodes: (Array.isArray(taxConfig?.taxCodes) ? taxConfig.taxCodes : []).map((code, index) => {
    const rawId = toClientTaxCodeId(code?._id, "");
    const payload = {
      key: sanitizeTaxKey(code?.key || code?.name, `tax_code_${index + 1}`),
      name: String(code?.name || `Tax Code ${index + 1}`).trim(),
      type: String(code?.type || "vat").trim().toLowerCase(),
      rate: Number(code?.rate || 0),
      isDefault: Boolean(code?.isDefault),
      isActive: code?.isActive !== false,
      description: String(code?.description || "").trim(),
    };

    if (/^[a-f\d]{24}$/i.test(rawId)) {
      payload._id = rawId;
    }

    return payload;
  }),
});

const normalizeAccountingDefaults = (settings = {}) => ({
  tenantReceivableAccount: settings?.accountingDefaults?.tenantReceivableAccount || "",
  rentIncomeAccount: settings?.accountingDefaults?.rentIncomeAccount || "",
  utilityRechargeIncomeAccount: settings?.accountingDefaults?.utilityRechargeIncomeAccount || "",
  penaltyIncomeAccount: settings?.accountingDefaults?.penaltyIncomeAccount || "",
  depositLiabilityAccount: settings?.accountingDefaults?.depositLiabilityAccount || "",
  managementCommissionIncomeAccount:
    settings?.accountingDefaults?.managementCommissionIncomeAccount || "",
  leaseAgreementFeeIncomeAccount:
    settings?.accountingDefaults?.leaseAgreementFeeIncomeAccount || "",
});

const ACCOUNTING_DEFAULT_FIELDS = [
  {
    key: "tenantReceivableAccount",
    label: "Tenant Receivable Account",
    description: "Default receivable account for future tenant invoices and receipt clearing.",
    type: "asset",
  },
  {
    key: "rentIncomeAccount",
    label: "Rent Income Account",
    description: "Default income account for future rent charge invoicing when no more specific account is supplied.",
    type: "income",
  },
  {
    key: "utilityRechargeIncomeAccount",
    label: "Utility Recharge Income Account",
    description: "Default income account for future utility recharge invoicing.",
    type: "income",
  },
  {
    key: "penaltyIncomeAccount",
    label: "Penalty Income Account",
    description: "Default income account for future late-penalty or similar charge posting.",
    type: "income",
  },
  {
    key: "depositLiabilityAccount",
    label: "Deposit Liability Account",
    description: "Default liability account used for manager-held tenant deposit charging and receipt allocation.",
    type: "liability",
  },
  {
    key: "managementCommissionIncomeAccount",
    label: "Management Commission Income Account",
    description: "Default commission income account used when processed statements or landlord payments post commission entries.",
    type: "income",
  },
  {
    key: "leaseAgreementFeeIncomeAccount",
    label: "Lease / Agreement Fee Income Account",
    description: "Default income account used when charging one-time tenant onboarding or lease/agreement fees.",
    type: "income",
  },
];

const extractErrorMessage = (error) =>
  error?.response?.data?.message || error?.message || "Failed to process company settings request";

const Card = ({ title, subtitle, action, children }) => (
  <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-start md:justify-between">
      <div>
        <div className="text-sm font-extrabold text-slate-900">{title}</div>
        {subtitle ? <div className="mt-1 text-xs leading-5 text-slate-600">{subtitle}</div> : null}
      </div>
      {action}
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const StatusBadge = ({ active }) => (
  <span
    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${
      active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"
    }`}
  >
    <span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`} />
    {active ? "Active" : "Archived"}
  </span>
);

const Input = ({ className = "", ...props }) => (
  <input
    {...props}
    className={`w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100 ${className}`}
  />
);

const Select = ({ className = "", ...props }) => (
  <select
    {...props}
    className={`w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100 ${className}`}
  />
);

const ActionButton = ({ children, onClick, variant = "default", disabled = false }) => {
  const classes = {
    default: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    primary: "border-transparent bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white hover:opacity-95",
    subtle: "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
    danger: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${classes[variant]}`}
    >
      {children}
    </button>
  );
};

const ToggleRow = ({ checked, onChange, title, description }) => (
  <label
    className={`flex items-start gap-3 rounded-2xl border px-4 py-3 transition ${
      checked ? "border-emerald-200 bg-emerald-50/80" : "border-slate-200 bg-white"
    } cursor-pointer hover:border-slate-300`}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
    />
    <div>
      <div className="text-sm font-bold text-slate-900">{title}</div>
      <div className="mt-1 text-xs leading-5 text-slate-600">{description}</div>
    </div>
  </label>
);

const SettingRow = ({ title, meta, status, children }) => (
  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-extrabold text-slate-900">{title}</div>
          {status}
        </div>
        {meta ? <div className="mt-2 text-xs leading-5 text-slate-600">{meta}</div> : null}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  </div>
);

const Modal = ({ open, title, subtitle, children, onClose, footer }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/20 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <div className="text-lg font-extrabold text-slate-900">{title}</div>
            {subtitle ? <div className="mt-1 text-sm text-slate-600">{subtitle}</div> : null}
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50">
            Close
          </button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="border-t border-slate-200 bg-slate-50 px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
};

const CompanySettings = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentCompany } = useSelector((state) => state.company || {});

  const [settings, setSettings] = useState(null);
  const [taxConfig, setTaxConfig] = useState(normalizeTaxConfiguration());
  const [accountingDefaults, setAccountingDefaults] = useState(normalizeAccountingDefaults());
  const [chartAccounts, setChartAccounts] = useState([]);
  const [loadedChartAccountCompanyId, setLoadedChartAccountCompanyId] = useState("");
  const activeTab = Object.prototype.hasOwnProperty.call(TAB_CONFIG, searchParams.get("tab")) ? searchParams.get("tab") : "utilities";
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingTax, setSavingTax] = useState(false);
  const [savingAccounting, setSavingAccounting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalTab, setModalTab] = useState("utilities");
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState(emptyForms.utilities);

  useEffect(() => {
    if (!Object.prototype.hasOwnProperty.call(TAB_CONFIG, searchParams.get("tab"))) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("tab", "utilities");
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const switchTab = (tabKey) => {
    if (!Object.prototype.hasOwnProperty.call(TAB_CONFIG, tabKey)) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", tabKey);
    setSearchParams(nextParams);
  };

  const loadSettings = async ({ silent = false } = {}) => {
    if (!currentCompany?._id) {
      setSettings(null);
      setTaxConfig(normalizeTaxConfiguration());
      setAccountingDefaults(normalizeAccountingDefaults());
      return;
    }

    if (!silent) setLoading(true);
    try {
      const response = await adminRequests.get(`/company-settings/${currentCompany._id}`);
      setSettings(response.data);
      setTaxConfig(normalizeTaxConfiguration(response.data || {}));
      setAccountingDefaults(normalizeAccountingDefaults(response.data || {}));
    } catch (error) {
      toast.error(extractErrorMessage(error));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadChartAccounts = async () => {
    if (!currentCompany?._id) {
      setChartAccounts([]);
      setLoadedChartAccountCompanyId("");
      return;
    }

    const companyId = String(currentCompany._id);
    if (loadedChartAccountCompanyId === companyId) {
      return;
    }

    setLoadingAccounts(true);
    try {
      const query = new URLSearchParams({ business: currentCompany._id }).toString();
      const response = await adminRequests.get(`/chart-of-accounts?${query}`);
      const rows = Array.isArray(response?.data) ? response.data : [];
      setChartAccounts(rows.filter((account) => account?.isPosting !== false && account?.isHeader !== true));
      setLoadedChartAccountCompanyId(companyId);
    } catch (error) {
      setChartAccounts([]);
      setLoadedChartAccountCompanyId("");
      toast.error(extractErrorMessage(error));
    } finally {
      setLoadingAccounts(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, [currentCompany?._id]);

  useEffect(() => {
    if (activeTab !== "accounting") return;
    loadChartAccounts();
  }, [activeTab, currentCompany?._id, loadedChartAccountCompanyId]);

  const activeCounts = useMemo(
    () => ({
      utilities: (settings?.utilityTypes || []).filter((item) => item?.isActive !== false).length,
      periods: (settings?.billingPeriods || []).filter((item) => item?.isActive !== false).length,
      commissions: (settings?.commissions || []).filter((item) => item?.isActive !== false).length,
      expenses: (settings?.expenseItems || []).filter((item) => item?.isActive !== false).length,
    }),
    [settings]
  );

  const chartAccountOptionsByType = useMemo(() => {
    return chartAccounts.reduce((acc, account) => {
      const type = String(account?.type || "").trim().toLowerCase();
      if (!type) return acc;
      if (!acc[type]) acc[type] = [];
      acc[type].push(account);
      return acc;
    }, {});
  }, [chartAccounts]);

  const setAccountingDefaultField = (field, value) => {
    setAccountingDefaults((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const openCreateModal = (tabKey) => {
    setModalTab(tabKey);
    setEditingItem(null);
    setFormData({ ...emptyForms[tabKey] });
    setShowModal(true);
  };

  const openEditModal = (tabKey, item) => {
    setModalTab(tabKey);
    setEditingItem(item);
    setFormData({ ...item });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData({ ...emptyForms[modalTab] });
  };

  const collectionMap = {
    utilities: settings?.utilityTypes || [],
    periods: settings?.billingPeriods || [],
    commissions: settings?.commissions || [],
    expenses: settings?.expenseItems || [],
  };

  const visibleItems = useMemo(() => {
    const items = collectionMap[activeTab] || [];
    return showInactive ? items : items.filter((item) => item?.isActive !== false);
  }, [activeTab, collectionMap, showInactive]);

  const saveItem = async () => {
    if (!currentCompany?._id) return;

    const endpoint = TAB_CONFIG[modalTab]?.endpoint;
    if (!endpoint) return;

    if (!String(formData?.name || "").trim()) {
      toast.error("Name is required before saving.");
      return;
    }

    if (modalTab === "periods" && Number(formData?.durationInMonths || 0) <= 0) {
      toast.error("Duration in months must be greater than zero.");
      return;
    }

    if (modalTab === "commissions") {
      const percentage = Number(formData?.percentage);
      if (!Number.isFinite(percentage)) {
        toast.error("Enter a valid commission percentage.");
        return;
      }
    }

    setSaving(true);
    try {
      const payload = { ...formData };
      if (modalTab === "periods") {
        payload.durationInMonths = Number(payload.durationInMonths || 0);
        payload.durationInDays = Number(payload.durationInDays || payload.durationInMonths * 30 || 0);
      }
      if (modalTab === "commissions") {
        payload.percentage = Number(payload.percentage || 0);
      }
      if (modalTab === "expenses") {
        payload.defaultAmount = Number(payload.defaultAmount || 0);
      }

      if (editingItem?._id) {
        await adminRequests.put(`/company-settings/${currentCompany._id}/${endpoint}/${editingItem._id}`, payload);
      } else {
        await adminRequests.post(`/company-settings/${currentCompany._id}/${endpoint}`, payload);
      }

      toast.success(editingItem?._id ? "Setting updated successfully" : "Setting added successfully");
      closeModal();
      await loadSettings({ silent: true });
    } catch (error) {
      toast.error(extractErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleItemStatus = async (tabKey, item, nextActive) => {
    if (!currentCompany?._id || !item?._id) return;
    const endpoint = TAB_CONFIG[tabKey]?.endpoint;
    if (!endpoint) return;

    try {
      await adminRequests.put(`/company-settings/${currentCompany._id}/${endpoint}/${item._id}`, {
        ...item,
        isActive: nextActive,
      });
      toast.success(nextActive ? "Setting reactivated successfully" : "Setting disabled successfully");
      await loadSettings({ silent: true });
    } catch (error) {
      toast.error(extractErrorMessage(error));
    }
  };

  const archiveItem = async (tabKey, item) => {
    if (!currentCompany?._id || !item?._id) return;
    const endpoint = TAB_CONFIG[tabKey]?.endpoint;
    if (!endpoint) return;

    const confirmed = window.confirm(
      `Archive ${item?.name || "this setting"}? It will stay in history but stop being available for future use.`
    );
    if (!confirmed) return;

    try {
      const response = await adminRequests.delete(`/company-settings/${currentCompany._id}/${endpoint}/${item._id}`);
      toast.success(response?.data?.message || "Setting archived successfully");
      await loadSettings({ silent: true });
    } catch (error) {
      toast.error(extractErrorMessage(error));
    }
  };

  const handleTaxSettingChange = (key, value) => {
    setTaxConfig((prev) => ({
      ...prev,
      taxSettings: {
        ...prev.taxSettings,
        [key]: value,
      },
    }));
  };

  const handleTaxCategoryChange = (category, value) => {
    setTaxConfig((prev) => ({
      ...prev,
      taxSettings: {
        ...prev.taxSettings,
        invoiceTaxabilityByCategory: {
          ...prev.taxSettings.invoiceTaxabilityByCategory,
          [category]: value,
        },
      },
    }));
  };

  const handleTaxCodeChange = (index, key, value) => {
    setTaxConfig((prev) => ({
      ...prev,
      taxCodes: prev.taxCodes.map((code, codeIndex) =>
        codeIndex === index
          ? {
              ...code,
              [key]: key === "rate" ? Number(value || 0) : key === "isDefault" || key === "isActive" ? value : value,
            }
          : key === "isDefault" && value === true
          ? { ...code, isDefault: false }
          : code
      ),
    }));
  };

  const handleAddTaxCode = () => {
    setTaxConfig((prev) => ({
      ...prev,
      taxCodes: [
        ...prev.taxCodes,
        {
          _id: `tax-code-${Date.now()}`,
          key: `tax_code_${prev.taxCodes.length + 1}`,
          name: `Tax Code ${prev.taxCodes.length + 1}`,
          type: "vat",
          rate: Number(prev.taxSettings.defaultVatRate || 16),
          isDefault: false,
          isActive: true,
          description: "",
        },
      ],
    }));
  };

  const handleRemoveTaxCode = (index) => {
    setTaxConfig((prev) => ({
      ...prev,
      taxCodes: prev.taxCodes.filter((_, codeIndex) => codeIndex !== index),
    }));
  };

  const saveTaxConfiguration = async () => {
    if (!currentCompany?._id) return;

    const payload = buildTaxSavePayload(taxConfig);

    setSavingTax(true);
    try {
      const response = await adminRequests.put(`/company-settings/${currentCompany._id}/tax-configuration`, payload);
      const refreshedSettings = response?.data?.settings || response?.data || null;
      if (refreshedSettings) {
        setSettings(refreshedSettings);
        setTaxConfig(normalizeTaxConfiguration(refreshedSettings));
      } else {
        await loadSettings({ silent: true });
      }
      toast.success("Tax configuration saved successfully. New rules apply going forward only.");
    } catch (error) {
      toast.error(extractErrorMessage(error));
    } finally {
      setSavingTax(false);
    }
  };

  const saveAccountingDefaults = async () => {
    if (!currentCompany?._id) return;

    setSavingAccounting(true);
    try {
      await adminRequests.put(`/company-settings/${currentCompany._id}/accounting-defaults`, {
        accountingDefaults,
      });
      toast.success("Accounting defaults saved successfully. New posting flows will use these defaults going forward.");
      await loadSettings({ silent: true });
    } catch (error) {
      toast.error(extractErrorMessage(error));
    } finally {
      setSavingAccounting(false);
    }
  };

  const renderMeta = (tabKey, item) => {
    if (tabKey === "utilities") {
      return [item?.description, item?.category ? `Category: ${String(item.category).replace(/_/g, " ")}` : null]
        .filter(Boolean)
        .join(" • ");
    }

    if (tabKey === "periods") {
      return `Duration: ${Number(item?.durationInMonths || 0)} month(s) • ${Number(item?.durationInDays || 0)} day(s)`;
    }

    if (tabKey === "commissions") {
      return [
        `Rate: ${Number(item?.percentage || 0)}%`,
        `Applies to: ${String(item?.applicableTo || "rent").replace(/_/g, " ")}`,
        item?.description,
      ]
        .filter(Boolean)
        .join(" • ");
    }

    if (tabKey === "expenses") {
      return [
        item?.code ? `Code: ${item.code}` : null,
        `Category: ${String(item?.category || "other").replace(/_/g, " ")}`,
        `Default amount: ${Number(item?.defaultAmount || 0).toLocaleString()}`,
        item?.description,
      ]
        .filter(Boolean)
        .join(" • ");
    }

    return "";
  };

  const renderCollectionTab = (tabKey) => {
    const tab = TAB_CONFIG[tabKey];
    const list = collectionMap[tabKey] || [];
    const active = list.filter((item) => item?.isActive !== false).length;
    const archived = list.length - active;

    return (
      <div className="space-y-4">
        <Card
          title={tab.label}
          subtitle={tab.subtitle}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Show archived
              </label>
              <ActionButton variant="primary" onClick={() => openCreateModal(tabKey)}>
                <FaPlus /> Add {tab.label.slice(0, -1)}
              </ActionButton>
            </div>
          }
        >
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{active} active</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{archived} archived</span>
          </div>

          {visibleItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">
              {tab.empty}
            </div>
          ) : (
            <div className="space-y-3">
              {visibleItems.map((item) => (
                <SettingRow
                  key={item._id}
                  title={item?.name || tab.label.slice(0, -1)}
                  meta={renderMeta(tabKey, item)}
                  status={<StatusBadge active={item?.isActive !== false} />}
                >
                  <ActionButton onClick={() => openEditModal(tabKey, item)}>
                    <FaEdit /> Edit
                  </ActionButton>
                  <ActionButton onClick={() => toggleItemStatus(tabKey, item, item?.isActive === false)}>
                    <FaPowerOff /> {item?.isActive === false ? "Reactivate" : "Disable"}
                  </ActionButton>
                  {item?.isActive !== false ? (
                    <ActionButton variant="danger" onClick={() => archiveItem(tabKey, item)}>
                      <FaArchive /> Archive
                    </ActionButton>
                  ) : null}
                </SettingRow>
              ))}
            </div>
          )}
        </Card>
      </div>
    );
  };

  const renderTaxTab = () => (
    <div className="space-y-4">
      <Card
        title="Tax Configuration"
        subtitle="These are company-wide future-facing defaults for invoices and commission tax handling. Saving here does not restate posted invoices or processed statements."
        action={
          <ActionButton variant="primary" onClick={saveTaxConfiguration} disabled={savingTax}>
            {savingTax ? <FaSpinner className="animate-spin" /> : <FaSave />} Save Tax Configuration
          </ActionButton>
        }
      >
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          Use this screen to define future default tax behavior. Historical financial truth remains intact.
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <ToggleRow
            checked={taxConfig.taxSettings.enabled}
            onChange={(e) => handleTaxSettingChange("enabled", e.target.checked)}
            title="Enable tax engine"
            description="Turns on structured VAT / tax handling for future invoice and statement calculations."
          />
          <ToggleRow
            checked={taxConfig.taxSettings.invoiceTaxableByDefault}
            onChange={(e) => handleTaxSettingChange("invoiceTaxableByDefault", e.target.checked)}
            title="Invoices taxable by default"
            description="Used as the fallback taxability rule when category-specific rules are not stricter."
          />
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Default Tax Mode</label>
            <Select value={taxConfig.taxSettings.defaultTaxMode} onChange={(e) => handleTaxSettingChange("defaultTaxMode", e.target.value)}>
              <option value="exclusive">Exclusive</option>
              <option value="inclusive">Inclusive</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Default VAT Rate (%)</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={taxConfig.taxSettings.defaultVatRate}
              onChange={(e) => handleTaxSettingChange("defaultVatRate", Number(e.target.value || 0))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Default Tax Code</label>
            <Select
              value={taxConfig.taxSettings.defaultTaxCodeKey}
              onChange={(e) => handleTaxSettingChange("defaultTaxCodeKey", e.target.value)}
            >
              {taxConfig.taxCodes.map((code) => (
                <option key={code._id || code.key} value={code.key}>
                  {code.name} ({code.key})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Output VAT Account Code</label>
            <Input
              value={taxConfig.taxSettings.outputVatAccountCode}
              onChange={(e) => handleTaxSettingChange("outputVatAccountCode", e.target.value)}
              placeholder="2140"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Rounding Precision</label>
            <Select
              value={taxConfig.taxSettings.roundingPrecision}
              onChange={(e) => handleTaxSettingChange("roundingPrecision", Number(e.target.value || 2))}
            >
              {[0, 1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value} decimal place{value === 1 ? "" : "s"}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["rent", "Rent invoices"],
            ["utility", "Utility invoices"],
            ["penalty", "Penalty invoices"],
            ["deposit", "Deposit invoices"],
          ].map(([key, label]) => (
            <ToggleRow
              key={key}
              checked={taxConfig.taxSettings.invoiceTaxabilityByCategory[key]}
              onChange={(e) => handleTaxCategoryChange(key, e.target.checked)}
              title={label}
              description={`Future default taxability for ${label.toLowerCase()}.`}
            />
          ))}
        </div>
      </Card>

      <Card
        title="Tax Codes"
        subtitle="Maintain reusable tax codes. Keep one default active code for future transactions."
        action={
          <ActionButton variant="subtle" onClick={handleAddTaxCode}>
            <FaPlus /> Add Tax Code
          </ActionButton>
        }
      >
        <div className="space-y-4">
          {taxConfig.taxCodes.map((code, index) => (
            <div key={code._id || index} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Key</label>
                  <Input value={code.key} onChange={(e) => handleTaxCodeChange(index, "key", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Name</label>
                  <Input value={code.name} onChange={(e) => handleTaxCodeChange(index, "name", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Type</label>
                  <Select value={code.type} onChange={(e) => handleTaxCodeChange(index, "type", e.target.value)}>
                    <option value="vat">VAT</option>
                    <option value="zero_rated">Zero Rated</option>
                    <option value="exempt">Exempt</option>
                    <option value="none">None</option>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Rate (%)</label>
                  <Input type="number" min="0" step="0.01" value={code.rate} onChange={(e) => handleTaxCodeChange(index, "rate", e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">Description</label>
                  <Input value={code.description} onChange={(e) => handleTaxCodeChange(index, "description", e.target.value)} />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(code.isDefault)}
                      onChange={(e) => handleTaxCodeChange(index, "isDefault", e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Default tax code
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={code.isActive !== false}
                      onChange={(e) => handleTaxCodeChange(index, "isActive", e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Active
                  </label>
                </div>
                <ActionButton variant="danger" onClick={() => handleRemoveTaxCode(index)} disabled={taxConfig.taxCodes.length <= 1}>
                  <FaTimes /> Remove
                </ActionButton>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );

  const renderAccountingTab = () => (
    <div className="space-y-4">
      <Card
        title="Accounting Defaults"
        subtitle="Select company-level default posting accounts for future operational flows. Leaving a field blank keeps the built-in MILIK fallback behavior. Historical entries remain untouched."
        action={
          <ActionButton variant="primary" onClick={saveAccountingDefaults} disabled={savingAccounting || loadingAccounts}>
            {savingAccounting ? <FaSpinner className="animate-spin" /> : <FaSave />} Save Accounting Defaults
          </ActionButton>
        }
      >
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          Choose real Chart of Accounts rows instead of typing free-form codes. These defaults only guide future posting where no more specific account has been selected.
        </div>

        {loadingAccounts ? (
          <div className="mt-4 flex items-center gap-3 text-sm text-slate-600">
            <FaSpinner className="animate-spin" /> Loading Chart of Accounts...
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {ACCOUNTING_DEFAULT_FIELDS.map((field) => {
              const options = chartAccountOptionsByType[field.type] || [];
              const selectedAccount = options.find((account) => String(account?._id || "") === String(accountingDefaults[field.key] || ""));

              return (
                <div key={field.key} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="text-sm font-extrabold text-slate-900">{field.label}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-600">{field.description}</div>

                  <div className="mt-3">
                    <Select
                      value={accountingDefaults[field.key] || ""}
                      onChange={(e) => setAccountingDefaultField(field.key, e.target.value)}
                    >
                      <option value="">Use automatic fallback</option>
                      {options.map((account) => (
                        <option key={account._id} value={account._id}>
                          {account.code ? `${account.code} — ` : ""}
                          {account.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Allowed type: {field.type}</div>
                    <ActionButton variant="subtle" onClick={() => setAccountingDefaultField(field.key, "")}>Clear</ActionButton>
                  </div>

                  <div className="mt-2 text-xs leading-5 text-slate-600">
                    {selectedAccount
                      ? `Selected: ${selectedAccount.code ? `${selectedAccount.code} • ` : ""}${selectedAccount.name}`
                      : "No explicit company default selected."}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );

  const renderModalBody = () => {
    const tabKey = modalTab;

    if (tabKey === "utilities") {
      return (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Name *</label>
            <Input value={formData.name || ""} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} placeholder="Electricity" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Description</label>
            <Input value={formData.description || ""} onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))} placeholder="Optional description" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Category</label>
            <Select value={formData.category || "utility"} onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}>
              <option value="utility">Utility</option>
              <option value="service_charge">Service charge</option>
              <option value="maintenance">Maintenance</option>
            </Select>
          </div>
        </div>
      );
    }

    if (tabKey === "periods") {
      return (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Name *</label>
            <Input value={formData.name || ""} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} placeholder="Monthly" />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Duration in Months *</label>
              <Input type="number" min="1" value={formData.durationInMonths || 1} onChange={(e) => setFormData((prev) => ({ ...prev, durationInMonths: Number(e.target.value || 0) }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Duration in Days</label>
              <Input type="number" min="0" value={formData.durationInDays || 0} onChange={(e) => setFormData((prev) => ({ ...prev, durationInDays: Number(e.target.value || 0) }))} />
            </div>
          </div>
        </div>
      );
    }

    if (tabKey === "commissions") {
      return (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Name *</label>
            <Input value={formData.name || ""} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} placeholder="Default" />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Percentage (%) *</label>
              <Input type="number" min="0" step="0.01" value={formData.percentage || ""} onChange={(e) => setFormData((prev) => ({ ...prev, percentage: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Applies To</label>
              <Select value={formData.applicableTo || "rent"} onChange={(e) => setFormData((prev) => ({ ...prev, applicableTo: e.target.value }))}>
                <option value="rent">Rent</option>
                <option value="utilities">Utilities</option>
                <option value="all">All</option>
              </Select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Description</label>
            <Input value={formData.description || ""} onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))} placeholder="Optional guidance" />
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-700">Name *</label>
          <Input value={formData.name || ""} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} placeholder="Maintenance" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Code</label>
            <Input value={formData.code || ""} onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value }))} placeholder="Optional code" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Category</label>
            <Select value={formData.category || "other"} onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}>
              <option value="maintenance">Maintenance</option>
              <option value="utilities">Utilities</option>
              <option value="staffing">Staffing</option>
              <option value="supplies">Supplies</option>
              <option value="other">Other</option>
            </Select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-700">Default Amount</label>
          <Input type="number" min="0" step="0.01" value={formData.defaultAmount || 0} onChange={(e) => setFormData((prev) => ({ ...prev, defaultAmount: e.target.value }))} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-700">Description</label>
          <Input value={formData.description || ""} onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))} placeholder="Optional guidance" />
        </div>
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1200px] px-4 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <FaCog className="text-2xl" style={{ color: MILIK_GREEN }} />
              <div className="text-2xl font-extrabold text-slate-900">Operational Settings</div>
            </div>
            <div className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Use this workspace for reusable operational defaults. These settings are designed to guide future activity and should not rewrite posted accounting history.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton variant="subtle" onClick={() => navigate("/company-setup")}>
              Open Company Setup <FaArrowRight />
            </ActionButton>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
          <div className="flex items-start gap-3">
            <FaExclamationCircle className="mt-0.5 text-base text-amber-600" />
            <div>
              <div className="font-extrabold">Future-facing defaults only</div>
              <div className="mt-1 text-xs leading-5 text-amber-800">
                Disabling or archiving an item keeps historical invoices, receipts, statements and ledgers intact. Use Company Setup for company identity, integrations, modules and structural configuration.
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/40 bg-white/50 p-2 backdrop-blur-xl">
          <div className="flex gap-2 overflow-x-auto">
            {Object.entries(TAB_CONFIG).map(([key, tab]) => {
              const Icon = tab.icon;
              const isActive = key === activeTab;
              return (
                <button
                  key={key}
                  onClick={() => switchTab(key)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-extrabold transition ${
                    isActive
                      ? "border-transparent bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white"
                      : "border-slate-200 bg-white/70 text-slate-800 hover:bg-white"
                  }`}
                >
                  <Icon className="text-sm" />
                  {tab.label}
                  {!(["tax", "accounting"].includes(key)) ? (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"}`}>
                      {activeCounts[key] ?? 0}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          {loading ? (
            <Card title="Loading settings" subtitle="Fetching the current company operational defaults.">
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <FaSpinner className="animate-spin" /> Loading...
              </div>
            </Card>
          ) : activeTab === "accounting" ? (
            renderAccountingTab()
          ) : activeTab === "tax" ? (
            renderTaxTab()
          ) : (
            renderCollectionTab(activeTab)
          )}
        </div>
      </div>

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editingItem?._id ? `Edit ${TAB_CONFIG[modalTab].label.slice(0, -1)}` : `Add ${TAB_CONFIG[modalTab].label.slice(0, -1)}`}
        subtitle="These settings guide future defaults and remain safe for historical accounting records."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <ActionButton onClick={closeModal}>
              <FaTimes /> Cancel
            </ActionButton>
            <ActionButton variant="primary" onClick={saveItem} disabled={saving}>
              {saving ? <FaSpinner className="animate-spin" /> : <FaSave />}
              {saving ? "Saving..." : editingItem?._id ? "Update" : "Save"}
            </ActionButton>
          </div>
        }
      >
        {renderModalBody()}
      </Modal>
    </DashboardLayout>
  );
};

export default CompanySettings;

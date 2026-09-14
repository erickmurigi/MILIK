import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { selectCompanySettings, fetchCompanySettings, getSettingsSuccess } from "../../redux/companySettingsRedux";
import { TERM_DEFAULTS } from "../../hooks/useTerm";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";
import { useConfirm } from "../../context/ConfirmContext";
import { adminRequests } from "../../utils/requestMethods";
import { createLatePenaltyRule, getChartOfAccounts, getLatePenaltyRules, updateLatePenaltyRule } from "../../redux/apiCalls";
import { inputClass, labelClass } from "../../utils/formStyles";
import { hasCompanyModule } from "../../utils/companyModules";
import { toast } from "react-toastify";
import { inventoryApi } from "../../services/inventoryApi";
import { carWashApi, normalizeListPayload } from "../../services/carWashApi";
import {
  FaArchive,
  FaCheck,
  FaClock,
  FaCog,
  FaEdit,
  FaExclamationCircle,
  FaLightbulb,
  FaPlus,
  FaReceipt,
  FaSave,
  FaTimes,
  FaArrowRight,
  FaPowerOff,
  FaCalendarAlt,
  FaPlay,
  FaBalanceScale,
  FaMoneyBillWave,
  FaPiggyBank,
  FaSms,
  FaTag,
  FaTools,
  FaTv,
  FaToggleOn,
  FaToggleOff,
  FaChevronDown,
  FaChevronUp,
  FaImage,
  FaTrash,
} from "react-icons/fa";
import Spinner from "../../components/common/Spinner";

const MILIK_GREEN = "#0B3B2E";
const CW_METHODS = ["cash", "mpesa", "bank", "card", "other"];
const CW_METHOD_LABELS = { cash: "Cash", mpesa: "M-Pesa (manual)", bank: "Bank Transfer", card: "Card / POS", other: "Other" };

// requiredModules: OR semantics — tab visible if company has ANY of the listed modules.
// Omit or set null to always show the tab.
const TAB_CONFIG = {
  utilities: {
    label: "Utility Types",
    icon: FaLightbulb,
    endpoint: "utilities",
    empty: "No utility types saved yet.",
    subtitle:
      "Maintain reusable utility and service charge labels for future tenant, unit and meter-reading flows.",
    requiredModules: ["propertyManagement"],
  },
  periods: {
    label: "Billing Periods",
    icon: FaClock,
    endpoint: "periods",
    empty: "No billing periods saved yet.",
    subtitle:
      "Maintain reusable billing cycle defaults for future schedules and operational setup. Historical postings stay untouched.",
    requiredModules: ["propertyManagement"],
  },
  expenses: {
    label: "Expense Items",
    icon: FaReceipt,
    endpoint: "expenses",
    empty: "No reusable expense items saved yet.",
    subtitle:
      "Maintain reusable deduction and expense labels for future voucher and operational workflows.",
    // No requiredModules — visible to all companies
  },
  deposits: {
    label: "Deposit Types",
    icon: FaArchive,
    endpoint: "deposits",
    empty: "No deposit types saved yet.",
    subtitle:
      "Maintain reusable tenant deposit invoice types for future security, utility and custom deposit charges.",
    requiredModules: ["propertyManagement"],
  },
  unitTypes: {
    label: "Unit Types",
    icon: FaCog,
    endpoint: "unit-types",
    empty: "No unit types configured yet.",
    subtitle: "Manage unit type labels used when creating and filtering units across the system.",
    requiredModules: ["propertyManagement"],
  },
  maintenanceCategories: {
    label: "Maintenance Categories",
    icon: FaCog,
    endpoint: "maintenance-categories",
    empty: "No maintenance categories configured yet.",
    subtitle: "Manage categories used when logging and tracking maintenance requests.",
    requiredModules: ["propertyManagement"],
  },
  tax: {
    label: "Tax Configuration",
    icon: FaCog,
    requiredModules: ["propertyManagement"],
  },
  accounting: {
    label: "Accounting Defaults",
    icon: FaCheck,
    requiredModules: ["propertyManagement", "hr", "inventory"],
  },
  autoInvoicing: {
    label: "Auto Invoicing",
    icon: FaCalendarAlt,
    requiredModules: ["propertyManagement"],
  },
  incomeRules: {
    label: "Income Rules",
    icon: FaBalanceScale,
    requiredModules: ["propertyManagement"],
  },
  penaltyRules: {
    label: "Late Payment Rules",
    icon: FaClock,
    requiredModules: ["propertyManagement"],
  },
  saleStages: {
    label: "Pipeline Stages",
    icon: FaCog,
    requiredModules: ["propertySale"],
  },
  saleSources: {
    label: "Lead Sources",
    icon: FaCog,
    requiredModules: ["propertySale"],
  },
  salePropertyTypes: {
    label: "Property Types",
    icon: FaCog,
    requiredModules: ["propertySale"],
  },
  saleCommDefaults: {
    label: "Commission Defaults",
    icon: FaCog,
    requiredModules: ["propertySale"],
  },
  invPOSSettings: {
    label: "POS & Receipt",
    icon: FaReceipt,
    requiredModules: ["inventory"],
  },
  cwOperations: {
    label: "Operations",
    icon: FaTv,
    requiredModules: ["carwash"],
  },
  cwSMS: {
    label: "SMS Templates",
    icon: FaSms,
    requiredModules: ["carwash"],
  },
  terminology: {
    label: "Terminology",
    icon: FaTag,
    custom: true,
  },
};

const SIDEBAR_GROUPS = [
  { label: "Property Setup",           items: ["unitTypes", "deposits", "periods"] },
  { label: "Utilities & Maintenance",  items: ["utilities", "maintenanceCategories"] },
  { label: "Financial & Accounting",   items: ["tax", "accounting", "incomeRules", "expenses"] },
  { label: "Billing Rules",            items: ["penaltyRules", "autoInvoicing"] },
  { label: "Property Sales",           items: ["saleStages", "saleSources", "salePropertyTypes", "saleCommDefaults"] },
  { label: "Inventory & POS",          items: ["invPOSSettings"] },
  { label: "Car Wash",                 items: ["cwOperations", "cwSMS"] },
  { label: "System",                   items: ["terminology"] },
];

const emptyForms = {
  utilities: { name: "", description: "", category: "utility", isActive: true },
  periods: { name: "", durationInMonths: 1, durationInDays: 30, isActive: true },
  expenses: { name: "", description: "", code: "", category: "other", defaultAmount: 0, isActive: true },
  deposits: { name: "", description: "", code: "", defaultAmount: 0, refundable: true, isActive: true },
  unitTypes: { name: "", description: "", category: "residential", isActive: true },
  maintenanceCategories: { name: "", description: "", priority: "medium", isActive: true },
  saleStages:        { name: "" },
  saleSources:       { name: "" },
  salePropertyTypes: { name: "" },
};

const SALE_TAB_ENDPOINTS = {
  saleStages:        "pipeline-stages",
  saleSources:       "lead-sources",
  salePropertyTypes: "property-types",
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
  mriRate: Number(settings?.mriRate ?? 0.075),
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
  mriRate: Number(taxConfig?.mriRate ?? 0.075),
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

const normalizeInvAccountingDefaults = (settings = {}) => ({
  inventoryAssetAccount: settings?.inventoryAccountingDefaults?.inventoryAssetAccount || "",
  cogsAccount: settings?.inventoryAccountingDefaults?.cogsAccount || "",
  salesRevenueAccount: settings?.inventoryAccountingDefaults?.salesRevenueAccount || "",
  stockAdjustmentAccount: settings?.inventoryAccountingDefaults?.stockAdjustmentAccount || "",
  purchaseClearingAccount: settings?.inventoryAccountingDefaults?.purchaseClearingAccount || "",
});

const normalizeHrAccountingDefaults = (settings = {}) => ({
  salaryExpenseAccount: settings?.hrAccountingDefaults?.salaryExpenseAccount || "",
  netPayableAccount: settings?.hrAccountingDefaults?.netPayableAccount || "",
  payePayableAccount: settings?.hrAccountingDefaults?.payePayableAccount || "",
  nhifPayableAccount: settings?.hrAccountingDefaults?.nhifPayableAccount || "",
  nssfPayableAccount: settings?.hrAccountingDefaults?.nssfPayableAccount || "",
  ahlPayableAccount: settings?.hrAccountingDefaults?.ahlPayableAccount || "",
  otherDeductionsPayableAccount: settings?.hrAccountingDefaults?.otherDeductionsPayableAccount || "",
  employerNhifExpenseAccount: settings?.hrAccountingDefaults?.employerNhifExpenseAccount || "",
  employerNssfExpenseAccount: settings?.hrAccountingDefaults?.employerNssfExpenseAccount || "",
  employerAhlExpenseAccount: settings?.hrAccountingDefaults?.employerAhlExpenseAccount || "",
});

const HR_ACCOUNTING_DEFAULT_FIELDS = [
  {
    key: "salaryExpenseAccount",
    label: "Salaries & Wages Expense",
    description: "Gross payroll expense account. Debited on payslip approval.",
    type: "expense",
  },
  {
    key: "netPayableAccount",
    label: "Net Salaries Payable",
    description: "Liability account for net pay owed to employees after all deductions.",
    type: "liability",
  },
  {
    key: "payePayableAccount",
    label: "PAYE Tax Payable",
    description: "Liability account for employee PAYE withheld and payable to KRA.",
    type: "liability",
  },
  {
    key: "nhifPayableAccount",
    label: "NHIF / SHA Contributions Payable",
    description: "Liability account for employee NHIF/SHA deductions payable.",
    type: "liability",
  },
  {
    key: "nssfPayableAccount",
    label: "NSSF Contributions Payable",
    description: "Liability account for employee NSSF deductions payable.",
    type: "liability",
  },
  {
    key: "ahlPayableAccount",
    label: "AHL Levy Payable",
    description: "Liability account for Affordable Housing Levy withheld from employees.",
    type: "liability",
  },
  {
    key: "otherDeductionsPayableAccount",
    label: "Other Deductions Payable",
    description: "Liability account for HELB, SACCO, loan repayments and other payroll deductions.",
    type: "liability",
  },
  {
    key: "employerNhifExpenseAccount",
    label: "Employer NHIF/SHA Expense",
    description: "Expense account for employer-side NHIF/SHA contributions.",
    type: "expense",
  },
  {
    key: "employerNssfExpenseAccount",
    label: "Employer NSSF Expense",
    description: "Expense account for employer-side NSSF contributions.",
    type: "expense",
  },
  {
    key: "employerAhlExpenseAccount",
    label: "Employer AHL Expense",
    description: "Expense account for employer-side Affordable Housing Levy.",
    type: "expense",
  },
];

const INV_ACCOUNTING_DEFAULT_FIELDS = [
  {
    key: "inventoryAssetAccount",
    label: "Inventory Asset (Stock on Hand)",
    description: "Asset account credited when stock is purchased and debited on COGS entries. Represents the current value of inventory held.",
    type: "asset",
  },
  {
    key: "cogsAccount",
    label: "Cost of Goods Sold (COGS)",
    description: "Expense account debited when inventory items are sold or consumed. Offsets the inventory asset account on sales.",
    type: "expense",
  },
  {
    key: "salesRevenueAccount",
    label: "Sales Revenue / POS Revenue",
    description: "Income account credited when inventory sales or POS transactions are posted.",
    type: "income",
  },
  {
    key: "stockAdjustmentAccount",
    label: "Stock Adjustments & Write-offs",
    description: "Expense account used for inventory adjustments, write-downs and write-offs that do not correspond to a sale.",
    type: "expense",
  },
  {
    key: "purchaseClearingAccount",
    label: "Purchase Clearing / Accounts Payable",
    description: "Liability account credited when goods are received on credit from suppliers and cleared when supplier invoices are settled.",
    type: "liability",
  },
];

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

const INV_POS_DEFAULTS = {
  receiptHeader: "", receiptFooter: "Thank you for your business!",
  showVATBreakdown: true, showCashierName: true, showReceiptNumber: true,
  autoReceiptPrint: false, currency: "KES", currencySymbol: "Ksh",
  vatPIN: "", kraETIMSEnabled: false, decimalPlaces: 2,
};

const COLLECTION_COLUMNS = {
  utilities: ["Name", "Category", "Description", "Status", "Actions"],
  periods: ["Name", "Months", "Days", "Status", "Actions"],
  expenses: ["Name", "Code", "Category", "Default Amount", "Status", "Actions"],
  deposits: ["Name", "Code", "Default Amount", "Refundable", "Description", "Status", "Actions"],
  unitTypes: ["Name", "Category", "Description", "Status", "Actions"],
  maintenanceCategories: ["Name", "Priority", "Description", "Status", "Actions"],
  saleStages:        ["#", "Stage Name", "Status", "Actions"],
  saleSources:       ["Source Name", "Status", "Actions"],
  salePropertyTypes: ["Type Name", "Status", "Actions"],
};

const DEFAULT_UNIT_TYPES_SEED = [
  { name: "Studio",     category: "residential", isActive: true },
  { name: "1 Bedroom",  category: "residential", isActive: true },
  { name: "2 Bedroom",  category: "residential", isActive: true },
  { name: "3 Bedroom",  category: "residential", isActive: true },
  { name: "4 Bedroom",  category: "residential", isActive: true },
  { name: "Commercial", category: "commercial",  isActive: true },
];

const BILLING_DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => {
  const d = i + 1;
  return { value: d, label: d === 1 ? "1st (Start of month)" : `${d}${d === 2 ? "nd" : d === 3 ? "rd" : "th"}` };
});

const LATE_PENALTY_BENEFICIARY_OPTIONS = [
  { value: "manager", label: "Property Manager — keeps late fees as collection incentive" },
  { value: "landlord", label: "Landlord — late penalties flow to the landlord statement" },
];

const MANUAL_RECEIPT_CONFIRMATION_OPTIONS = [
  { value: "on_review", label: "On review — save as draft, someone else confirms once the money is verified" },
  { value: "on_save", label: "On save — receipt posts to the ledger immediately, no separate confirm step" },
];

const TAX_MODE_OPTIONS = [
  { value: "exclusive", label: "Exclusive" },
  { value: "inclusive", label: "Inclusive" },
];

const ROUNDING_PRECISION_OPTIONS = [0, 1, 2, 3, 4].map((value) => ({
  value,
  label: `${value} decimal place${value === 1 ? "" : "s"}`,
}));

const TAX_CODE_TYPE_OPTIONS = [
  { value: "vat", label: "VAT" },
  { value: "zero_rated", label: "Zero Rated" },
  { value: "exempt", label: "Exempt" },
  { value: "none", label: "None" },
];

const NOTIFY_CHANNEL_OPTIONS = [
  { value: "sms", label: "SMS only" },
  { value: "email", label: "Email only" },
  { value: "both", label: "SMS + Email" },
];

const PENALIZE_ITEM_OPTIONS = [
  { value: "rent_only", label: "Rent only" },
  { value: "current_period_rent_only", label: "Current period rent only" },
  { value: "current_period_bill_balance_only", label: "Current period bill balance only" },
  { value: "all_arrears", label: "All arrears" },
  { value: "outstanding_invoice_balance", label: "Outstanding invoice balance" },
];

const CALCULATION_TYPE_OPTIONS = [
  { value: "flat_amount", label: "Flat amount" },
  { value: "percentage_overdue_balance", label: "Percentage of overdue balance" },
  { value: "daily_fixed_amount", label: "Daily fixed amount" },
  { value: "daily_percentage", label: "Daily percentage" },
];

const REPEAT_FREQUENCY_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "monthly", label: "Monthly" },
];

const CW_DAMAGE_MODE_OPTIONS = [
  { value: "full", label: "Full — deduct entire remaining balance at next payout" },
  { value: "percent", label: "Installment % — deduct a percentage of original damage each payout" },
  { value: "fixed", label: "Fixed amount — deduct a fixed Ksh amount each payout" },
];

const SALE_COMMISSION_TYPE_OPTIONS = [
  { value: "percentage", label: "Percentage of sale price" },
  { value: "flat", label: "Flat Amount (KES)" },
];

const defaultPenaltyRuleForm = {
  ruleName: "", effectiveFrom: new Date().toISOString().slice(0, 10),
  active: true, postingAccount: "", graceDays: 0, minimumOverdueDays: 1,
  penalizeItem: "outstanding_invoice_balance",
  calculationType: "percentage_overdue_balance",
  rateOrAmount: 5, minimumBalance: 0, maximumBalance: 0,
  maximumPenaltyCap: 0, applyAutomatically: false,
  repeatFrequency: "manual", notes: "",
};

const mapPenaltyRuleToForm = (rule) => ({
  ruleName: rule?.ruleName || "",
  effectiveFrom: rule?.effectiveFrom ? new Date(rule.effectiveFrom).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  active: rule?.active !== false,
  postingAccount: rule?.postingAccount?._id || rule?.postingAccount || "",
  graceDays: Number(rule?.graceDays || 0),
  minimumOverdueDays: Number(rule?.minimumOverdueDays || 0),
  penalizeItem: rule?.penalizeItem || "outstanding_invoice_balance",
  calculationType: rule?.calculationType || "percentage_overdue_balance",
  rateOrAmount: Number(rule?.rateOrAmount || 0),
  minimumBalance: Number(rule?.minimumBalance || 0),
  maximumBalance: Number(rule?.maximumBalance || 0),
  maximumPenaltyCap: Number(rule?.maximumPenaltyCap || 0),
  applyAutomatically: false,
  repeatFrequency: rule?.repeatFrequency || "manual",
  notes: rule?.notes || "",
});

const Card = ({ title, subtitle, action, children }) => (
  <div className="border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-between gap-3 bg-[#0B3B2E] px-3 py-2">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-white">{title}</div>
        {subtitle ? <div className="mt-0.5 text-[10px] text-[#B7C9C0]">{subtitle}</div> : null}
      </div>
      {action}
    </div>
    <div className="p-4">{children}</div>
  </div>
);


const Input = ({ className = "", ...props }) => (
  <input
    {...props}
    className={`w-full border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-800 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 ${className}`}
  />
);


const ActionButton = ({ children, onClick, variant = "default", disabled = false }) => {
  const classes = {
    default: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    primary: "border-transparent bg-[#FF8C00] text-white hover:bg-[#E67E00]",
    subtle: "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
    danger: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 border px-3 py-2 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${classes[variant]}`}
    >
      {children}
    </button>
  );
};

const ToggleRow = ({ checked, onChange, title, description }) => (
  <label
    className={`flex items-start gap-3 border px-3 py-2.5 transition ${
      checked ? "border-[#0B3B2E]/30 bg-[#EDF5F1]" : "border-slate-200 bg-white"
    } cursor-pointer hover:border-slate-300`}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
    />
    <div>
      <div className="text-[12px] font-bold text-slate-900">{title}</div>
      <div className="mt-0.5 text-[11px] leading-4 text-slate-600">{description}</div>
    </div>
  </label>
);

const SettingRow = ({ title, meta, status, children }) => (
  <div className="border border-slate-200 bg-slate-50 p-3">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[12px] font-extrabold text-slate-900">{title}</div>
          {status}
        </div>
        {meta ? <div className="mt-1.5 text-[11px] leading-4 text-slate-600">{meta}</div> : null}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  </div>
);


const TERM_PRESETS = {
  pms: {
    label: "Property Management",
    description: "Default PMS labels",
    values: {},
  },
  water: {
    label: "Water Vending",
    description: "Customers, Meters, Zones",
    values: {
      tenant: "Customer", tenants: "Customers",
      unit: "Meter", units: "Meters",
      property: "Zone", properties: "Zones",
      landlord: "Owner", landlords: "Owners",
      rent: "Water Charge", lease: "Contract",
      utility: "Consumption", utilities: "Consumptions",
    },
  },
  internet: {
    label: "Internet / ISP",
    description: "Subscribers, Connections, Sites",
    values: {
      tenant: "Subscriber", tenants: "Subscribers",
      unit: "Connection", units: "Connections",
      meter: "Router", meters: "Routers",
      property: "Site", properties: "Sites",
      landlord: "Owner", landlords: "Owners",
      rent: "Subscription Fee", lease: "Service Agreement",
      utility: "Add-on", utilities: "Add-ons",
      invoice: "Invoice", invoices: "Invoices",
      receipt: "Receipt", receipts: "Receipts",
    },
  },
  storage: {
    label: "Self-Storage",
    description: "Clients, Units, Facilities",
    values: {
      tenant: "Client", tenants: "Clients",
      unit: "Storage Unit", units: "Storage Units",
      meter: "Space", meters: "Spaces",
      property: "Facility", properties: "Facilities",
      landlord: "Owner", landlords: "Owners",
      rent: "Storage Fee", lease: "Rental Agreement",
      utility: "Service", utilities: "Services",
      invoice: "Invoice", invoices: "Invoices",
      receipt: "Receipt", receipts: "Receipts",
    },
  },
};

const TERM_GROUPS = [
  {
    label: "People",
    keys: ["tenant", "tenants"],
    hint: "What do you call the people who pay for your services?",
  },
  {
    label: "Spaces / Resources",
    keys: ["unit", "units", "meter", "meters"],
    hint: "What are the individual billable items or spaces called?",
  },
  {
    label: "Organisation",
    keys: ["property", "properties", "landlord", "landlords"],
    hint: "What are the owning entities and their groupings called?",
  },
  {
    label: "Commercial",
    keys: ["rent", "lease"],
    hint: "What do you call the recurring charge and the agreement?",
  },
  {
    label: "Financial",
    keys: ["invoice", "invoices", "receipt", "receipts", "utility", "utilities"],
    hint: "Financial document and charge terminology.",
  },
];

const TerminologyPanel = ({ currentCompany }) => {
  const dispatch = useDispatch();
  const companySettings = useSelector(selectCompanySettings);
  const savedTerminology = companySettings?.terminology ?? {};

  const readSaved = useCallback((src) => {
    const next = {};
    Object.keys(TERM_DEFAULTS).forEach((k) => {
      next[k] = src instanceof Map ? (src.get(k) || "") : (src[k] || "");
    });
    return next;
  }, []);

  const [form, setForm] = useState(() => readSaved(savedTerminology));
  const [saving, setSaving] = useState(false);
  const [activePreset, setActivePreset] = useState(null);

  useEffect(() => {
    setForm(readSaved(companySettings?.terminology ?? {}));
  }, [companySettings, readSaved]);

  const applyPreset = (presetKey) => {
    const preset = TERM_PRESETS[presetKey];
    if (!preset) return;
    setForm(() => {
      const next = {};
      Object.keys(TERM_DEFAULTS).forEach((k) => {
        next[k] = preset.values[k] ?? "";
      });
      return next;
    });
    setActivePreset(presetKey);
  };

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setActivePreset(null);
  };

  const handleReset = () => {
    setForm(readSaved(companySettings?.terminology ?? {}));
    setActivePreset(null);
  };

  const handleSave = async () => {
    if (!currentCompany?._id) return;
    setSaving(true);
    try {
      const payload = {};
      Object.keys(form).forEach((k) => { if (form[k].trim()) payload[k] = form[k].trim(); });
      const result = await adminRequests.patch(`/company-settings/${currentCompany._id}/terminology`, { terminology: payload });
      // Update Redux directly from the response — the fetchCompanySettings guard would return
      // stale cached data if settings are already in store, so we update the terminology field directly.
      const freshTerminology = result?.data?.terminology ?? {};
      if (companySettings) {
        dispatch(getSettingsSuccess({ ...companySettings, terminology: freshTerminology }));
      } else {
        dispatch(fetchCompanySettings(currentCompany._id));
      }
      toast.success("Terminology saved.");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save terminology.");
    } finally {
      setSaving(false);
    }
  };

  const isDirty = Object.keys(TERM_DEFAULTS).some((k) => {
    const saved = savedTerminology instanceof Map ? (savedTerminology.get(k) || "") : (savedTerminology[k] || "");
    return form[k] !== saved;
  });

  return (
    <div className="max-w-3xl space-y-6">
      {/* Presets */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Quick Presets</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(TERM_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              className={`inline-flex flex-col items-start rounded border px-3 py-2 text-left transition-colors duration-150 ${
                activePreset === key
                  ? "border-[#0B3B2E] bg-[#0B3B2E] text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
              }`}
            >
              <span className="text-[11px] font-semibold">{preset.label}</span>
              <span className={`text-[10px] ${activePreset === key ? "text-slate-300" : "text-slate-400"}`}>
                {preset.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Groups */}
      {TERM_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="mb-2 flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{group.label}</p>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <p className="mb-3 text-[11px] text-slate-400">{group.hint}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.keys.map((key) => {
              const custom = form[key];
              const defaultVal = TERM_DEFAULTS[key];
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {defaultVal}
                    </label>
                    {custom && (
                      <span className="text-[10px] text-[#0B3B2E] font-medium">→ {custom}</span>
                    )}
                  </div>
                  <input
                    type="text"
                    className={inputClass}
                    value={custom}
                    placeholder={`Default: ${defaultVal}`}
                    maxLength={40}
                    onChange={(e) => handleChange(key, e.target.value)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={handleReset}
          disabled={!isDirty}
          className="text-[11px] text-slate-500 underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 hover:text-slate-700"
        >
          Discard changes
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="inline-flex items-center gap-2 border border-transparent px-4 py-2 text-[11px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: MILIK_GREEN }}
        >
          <FaSave size={11} />
          {saving ? "Saving..." : "Save Terminology"}
        </button>
      </div>
    </div>
  );
};

const CompanySettings = () => {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentCompany = useSelector(selectCurrentCompany);
  const reduxCompanySettings = useSelector(selectCompanySettings);

  // ── Module flags ──────────────────────────────────────────────────────────
  const hasPM   = hasCompanyModule(currentCompany, "propertyManagement");
  const hasHR   = hasCompanyModule(currentCompany, "hr");
  const hasSale = hasCompanyModule(currentCompany, "propertySale");
  const hasInv  = hasCompanyModule(currentCompany, "inventory");

  const visibleTabEntries = useMemo(() =>
    Object.entries(TAB_CONFIG).filter(([, cfg]) => {
      if (!cfg.requiredModules) return true;
      return cfg.requiredModules.some((mod) => hasCompanyModule(currentCompany, mod));
    }),
    [currentCompany]
  );

  const visibleTabKeys = useMemo(
    () => new Set(visibleTabEntries.map(([k]) => k)),
    [visibleTabEntries]
  );

  const firstVisibleTab = visibleTabEntries[0]?.[0] || "expenses";

  const hasCW  = hasCompanyModule(currentCompany, "carwash");

  const [settings, setSettings] = useState(null);
  const [saleSettings, setSaleSettings] = useState(null);
  const [saleCommForm, setSaleCommForm] = useState({ rate: 3, commissionType: "percentage", whtRate: 5 });
  const [savingSaleComm, setSavingSaleComm] = useState(false);

  const [invPOSForm, setInvPOSForm] = useState(INV_POS_DEFAULTS);
  const [loadingInvPOS, setLoadingInvPOS] = useState(false);
  const [savingInvPOS, setSavingInvPOS] = useState(false);
  const [dirtyInvPOS, setDirtyInvPOS] = useState(false);

  const [cwCashbooks, setCwCashbooks] = useState([]);
  const [cwDefaults, setCwDefaults] = useState(CW_METHODS.reduce((a, m) => { a[m] = ""; return a; }, {}));
  const [cwSavingsEnabled, setCwSavingsEnabled] = useState(true);
  const [cwSavingsAmount, setCwSavingsAmount] = useState(100);
  const [cwQueueDisplayName, setCwQueueDisplayName] = useState("");
  const [cwQueueBgImage, setCwQueueBgImage] = useState("");
  const [cwBgUploading, setCwBgUploading] = useState(false);
  const [cwDiscountMinJobPrice, setCwDiscountMinJobPrice] = useState("");
  const [cwDiscountMaxPercent, setCwDiscountMaxPercent] = useState("");
  const [cwDmgMode, setCwDmgMode] = useState("full");
  const [cwDmgValue, setCwDmgValue] = useState("");
  const [cwSmsTemplates, setCwSmsTemplates] = useState([]);
  const [cwExpandedSms, setCwExpandedSms] = useState(null);
  const [loadingCW, setLoadingCW] = useState(false);
  const [savingCW, setSavingCW] = useState(false);
  const [dirtyCW, setDirtyCW] = useState(false);
  const [taxConfig, setTaxConfig] = useState(normalizeTaxConfiguration());
  const [accountingDefaults, setAccountingDefaults] = useState(normalizeAccountingDefaults());
  const [hrAccountingDefaults, setHrAccountingDefaults] = useState(normalizeHrAccountingDefaults());
  const [invAccountingDefaults, setInvAccountingDefaults] = useState(normalizeInvAccountingDefaults());
  const [savingHrAccounting, setSavingHrAccounting] = useState(false);
  const [savingInvAccounting, setSavingInvAccounting] = useState(false);
  const [autoInvoicing, setAutoInvoicing] = useState({
    enabled: false,
    billingDay: 1,
    daysInAdvance: 0,
    notifyTenants: false,
    notifyChannel: "none",
    lastRunAt: null,
    lastRunSummary: null,
    runHistory: [],
  });
  const [savingAutoInvoicing, setSavingAutoInvoicing] = useState(false);
  const [triggeringAutoInvoicing, setTriggeringAutoInvoicing] = useState(false);
  const [incomeRules, setIncomeRules] = useState({ latePenaltyBeneficiary: "manager", manualReceiptConfirmation: "on_review" });
  const [savingIncomeRules, setSavingIncomeRules] = useState(false);
  const [chartAccounts, setChartAccounts] = useState([]);
  // Track which company's chart of accounts is loaded via a ref so the guard
  // does NOT recreate loadChartAccounts on every successful load.
  const loadedChartAccountCompanyIdRef = React.useRef("");
  const requestedTab = searchParams.get("tab");
  const activeTab = (requestedTab && visibleTabKeys.has(requestedTab)) ? requestedTab : firstVisibleTab;
  const [showInactive, setShowInactive] = useTabState("/settings:showInactive", false);
  const [loading, setLoading] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingTax, setSavingTax] = useState(false);
  const [savingAccounting, setSavingAccounting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalTab, setModalTab] = useState("utilities");
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState(emptyForms.utilities);
  const [penaltyRules, setPenaltyRules] = useState([]);
  const [penaltyAccounts, setPenaltyAccounts] = useState([]);
  const [penaltyRuleForm, setPenaltyRuleForm] = useState(defaultPenaltyRuleForm);
  const [editingPenaltyRuleId, setEditingPenaltyRuleId] = useState("");
  const [showPenaltyRuleModal, setShowPenaltyRuleModal] = useState(false);
  const [savingPenaltyRule, setSavingPenaltyRule] = useState(false);

  useEffect(() => {
    if (!visibleTabKeys.size) return;
    const requested = searchParams.get("tab");
    if (!requested || !visibleTabKeys.has(requested)) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("tab", firstVisibleTab);
      setSearchParams(nextParams, { replace: true });
    }
  }, [visibleTabKeys, firstVisibleTab, searchParams, setSearchParams]);

  const switchTab = useCallback((tabKey) => {
    if (!Object.prototype.hasOwnProperty.call(TAB_CONFIG, tabKey)) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", tabKey);
    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);

  const loadSettings = useCallback(async ({ silent = false } = {}) => {
    if (!currentCompany?._id) {
      setSettings(null);
      setTaxConfig(normalizeTaxConfiguration());
      setAccountingDefaults(normalizeAccountingDefaults());
      setHrAccountingDefaults(normalizeHrAccountingDefaults());
      setInvAccountingDefaults(normalizeInvAccountingDefaults());
      return;
    }

    if (!silent) setLoading(true);
    try {
      const response = await adminRequests.get(`/company-settings/${currentCompany._id}`);
      setSettings(response.data);
      setTaxConfig(normalizeTaxConfiguration(response.data || {}));
      setAccountingDefaults(normalizeAccountingDefaults(response.data || {}));
      setHrAccountingDefaults(normalizeHrAccountingDefaults(response.data || {}));
      setInvAccountingDefaults(normalizeInvAccountingDefaults(response.data || {}));
      const ai = response.data?.autoInvoicing || {};
      setAutoInvoicing({
        enabled: Boolean(ai.enabled),
        billingDay: Number(ai.billingDay || 1),
        daysInAdvance: Number(ai.daysInAdvance || 0),
        notifyTenants: Boolean(ai.notifyTenants),
        notifyChannel: ai.notifyChannel || "none",
        lastRunAt: ai.lastRunAt || null,
        lastRunSummary: ai.lastRunSummary || null,
        runHistory: Array.isArray(ai.runHistory) ? ai.runHistory : [],
      });
      const ir = response.data?.incomeRules || {};
      setIncomeRules({
        latePenaltyBeneficiary: ir.latePenaltyBeneficiary || "manager",
        manualReceiptConfirmation: ir.manualReceiptConfirmation || "on_review",
      });
    } catch (error) {
      toast.error(extractErrorMessage(error));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [currentCompany?._id]);

  const loadChartAccounts = useCallback(async () => {
    if (!currentCompany?._id) {
      setChartAccounts([]);
      loadedChartAccountCompanyIdRef.current = "";
      return;
    }

    const companyId = String(currentCompany._id);
    if (loadedChartAccountCompanyIdRef.current === companyId) {
      return;
    }

    setLoadingAccounts(true);
    try {
      const query = new URLSearchParams({ business: currentCompany._id }).toString();
      const response = await adminRequests.get(`/chart-of-accounts?${query}`);
      const rows = Array.isArray(response?.data) ? response.data : [];
      setChartAccounts(rows.filter((account) => account?.isPosting !== false && account?.isHeader !== true));
      loadedChartAccountCompanyIdRef.current = companyId;
    } catch (error) {
      setChartAccounts([]);
      loadedChartAccountCompanyIdRef.current = "";
      toast.error(extractErrorMessage(error));
    } finally {
      setLoadingAccounts(false);
    }
  }, [currentCompany?._id]);

  const loadSaleSettings = useCallback(async () => {
    if (!hasSale || !currentCompany?._id) return;
    try {
      const res = await adminRequests.get("/sale/settings");
      const s = res.data?.settings;
      setSaleSettings(s || null);
      if (s?.commissionDefaults) {
        setSaleCommForm({
          rate:           s.commissionDefaults.rate           ?? 3,
          commissionType: s.commissionDefaults.commissionType ?? "percentage",
          whtRate:        s.commissionDefaults.whtRate        ?? 5,
        });
      }
    } catch { /* noop */ }
  }, [hasSale, currentCompany?._id]);

  const loadInvPOSSettings = useCallback(async () => {
    if (!hasInv || !currentCompany?._id) return;
    setLoadingInvPOS(true);
    try {
      const d = await inventoryApi.getPOSSettings();
      if (d) {
        setInvPOSForm({
          receiptHeader:     d.receiptHeader     ?? "",
          receiptFooter:     d.receiptFooter     ?? "Thank you for your business!",
          showVATBreakdown:  d.showVATBreakdown  ?? true,
          showCashierName:   d.showCashierName   ?? true,
          showReceiptNumber: d.showReceiptNumber ?? true,
          autoReceiptPrint:  d.autoReceiptPrint  ?? false,
          currency:          d.currency          ?? "KES",
          currencySymbol:    d.currencySymbol    ?? "Ksh",
          vatPIN:            d.vatPIN            ?? "",
          kraETIMSEnabled:   d.kraETIMSEnabled   ?? false,
          decimalPlaces:     d.decimalPlaces     ?? 2,
        });
        setDirtyInvPOS(false);
      }
    } catch { /* noop */ }
    finally { setLoadingInvPOS(false); }
  }, [hasInv, currentCompany?._id]);

  const loadCWSettings = useCallback(async () => {
    if (!hasCW || !currentCompany?._id) return;
    setLoadingCW(true);
    try {
      const [cbRes, s] = await Promise.all([
        carWashApi.listCashbooks(),
        carWashApi.getCarWashSettings(),
      ]);
      setCwCashbooks(normalizeListPayload(cbRes, "accounts"));
      const saved = s?.defaultCashbooks || {};
      setCwDefaults(CW_METHODS.reduce((a, m) => { a[m] = saved[m]?._id || saved[m] || ""; return a; }, {}));
      setCwSavingsEnabled(s?.savingsEnabled !== false);
      setCwSavingsAmount(Number(s?.savingsDeductionPerJob ?? 100));
      setCwSmsTemplates(Array.isArray(s?.smsTemplates) ? s.smsTemplates : []);
      setCwQueueDisplayName(s?.queueDisplayName || "");
      setCwQueueBgImage(s?.queueBgImage || "");
      setCwDiscountMinJobPrice(String(s?.discountMinJobPrice ?? 0));
      setCwDiscountMaxPercent(String(s?.discountMaxPercent  ?? 0));
      setCwDmgMode(s?.damageDeductionMode || "full");
      setCwDmgValue(s?.damageDeductionValue != null ? String(s.damageDeductionValue) : "");
      setDirtyCW(false);
    } catch { toast.error("Failed to load Car Wash settings"); }
    finally { setLoadingCW(false); }
  }, [hasCW, currentCompany?._id]);

  const saveCWSettings = async () => {
    setSavingCW(true);
    try {
      await carWashApi.updateCarWashSettings({
        defaultCashbooks: cwDefaults,
        savingsEnabled: cwSavingsEnabled,
        savingsDeductionPerJob: Number(cwSavingsAmount),
        smsTemplates: cwSmsTemplates.map(({ key, enabled, messageBody }) => ({ key, enabled, messageBody })),
        queueDisplayName: cwQueueDisplayName,
        queueBgImage: cwQueueBgImage,
        discountMinJobPrice: Number(cwDiscountMinJobPrice) || 0,
        discountMaxPercent:  Number(cwDiscountMaxPercent)  || 0,
        damageDeductionMode:  cwDmgMode,
        damageDeductionValue: cwDmgMode !== "full" ? Number(cwDmgValue) || null : null,
      });
      toast.success("Car Wash settings saved.");
      setDirtyCW(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save Car Wash settings");
    } finally { setSavingCW(false); }
  };

  const saveInvPOSSettings = async () => {
    setSavingInvPOS(true);
    try {
      await inventoryApi.updatePOSSettings({ ...invPOSForm, decimalPlaces: Number(invPOSForm.decimalPlaces) });
      toast.success("POS settings saved.");
      setDirtyInvPOS(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save POS settings");
    } finally { setSavingInvPOS(false); }
  };

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    loadSaleSettings();
  }, [loadSaleSettings]);

  useEffect(() => { loadInvPOSSettings(); }, [loadInvPOSSettings]);
  useEffect(() => { loadCWSettings(); }, [loadCWSettings]);

  const loadPenaltyRules = useCallback(async () => {
    if (!currentCompany?._id) return;
    try {
      const res = await getLatePenaltyRules(currentCompany._id);
      setPenaltyRules(Array.isArray(res?.rules) ? res.rules : []);
    } catch { setPenaltyRules([]); }
  }, [currentCompany?._id]);

  const loadPenaltyAccounts = useCallback(async () => {
    if (!currentCompany?._id) return;
    try {
      const res = await getChartOfAccounts({ business: currentCompany._id, type: "income" });
      setPenaltyAccounts(Array.isArray(res) ? res : []);
    } catch { setPenaltyAccounts([]); }
  }, [currentCompany?._id]);

  useEffect(() => {
    if (activeTab === "accounting" || activeTab === "hrAccounting") {
      loadChartAccounts();
    }
    if (activeTab === "penaltyRules") {
      loadPenaltyRules();
      loadPenaltyAccounts();
    }
  }, [loadChartAccounts, loadPenaltyRules, loadPenaltyAccounts, activeTab]);

  const activeCounts = useMemo(
    () => ({
      utilities: (settings?.utilityTypes || []).filter((item) => item?.isActive !== false).length,
      periods: (settings?.billingPeriods || []).filter((item) => item?.isActive !== false).length,
      expenses: (settings?.expenseItems || []).filter((item) => item?.isActive !== false).length,
      deposits: (settings?.depositTypes || []).filter((item) => item?.isActive !== false).length,
      unitTypes: (settings?.unitTypes || []).filter((item) => item?.isActive !== false).length,
      maintenanceCategories: (settings?.maintenanceCategories || []).filter((item) => item?.isActive !== false).length,
      saleStages:        (saleSettings?.pipelineStages || []).filter((i) => i.isActive !== false).length,
      saleSources:       (saleSettings?.leadSources    || []).filter((i) => i.isActive !== false).length,
      salePropertyTypes: (saleSettings?.propertyTypes  || []).filter((i) => i.isActive !== false).length,
    }),
    [settings, saleSettings]
  );

  // Groups chart accounts by type. Each bucket stores both the raw account (for
  // the "Selected:" display) and a pre-mapped { value, label } option array so
  // the inline .map() in renderAccountingDefaultsGrid doesn't recreate arrays on
  // every render.
  const chartAccountOptionsByType = useMemo(() => {
    const raw = chartAccounts.reduce((acc, account) => {
      const type = String(account?.type || "").trim().toLowerCase();
      if (!type) return acc;
      if (!acc[type]) acc[type] = [];
      acc[type].push(account);
      return acc;
    }, {});
    // Pre-compute the option arrays so JSX props are stable across renders
    const mapped = {};
    for (const [type, accounts] of Object.entries(raw)) {
      mapped[type] = {
        accounts,
        options: accounts.map((a) => ({
          value: a._id,
          label: a.code ? `${a.code} — ${a.name}` : a.name,
        })),
      };
    }
    return mapped;
  }, [chartAccounts]);

  const penaltyAccountOptions = useMemo(
    () => penaltyAccounts.map((a) => ({ value: a._id, label: `${a.code ? a.code + " · " : ""}${a.name}` })),
    [penaltyAccounts]
  );

  const cwCashbookOptions = useMemo(
    () => cwCashbooks.map((cb) => ({ value: cb._id, label: `${cb.code} – ${cb.name}` })),
    [cwCashbooks]
  );

  const setAccountingDefaultField = useCallback((field, value) => {
    setAccountingDefaults((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setHrAccountingDefaultField = useCallback((field, value) => {
    setHrAccountingDefaults((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setInvAccountingDefaultField = useCallback((field, value) => {
    setInvAccountingDefaults((prev) => ({ ...prev, [field]: value }));
  }, []);

  const openCreateModal = useCallback((tabKey) => {
    setModalTab(tabKey);
    setEditingItem(null);
    setFormData({ ...emptyForms[tabKey] });
    setShowModal(true);
  }, []);

  const openEditModal = useCallback((tabKey, item) => {
    setModalTab(tabKey);
    setEditingItem(item);
    setFormData({ ...item });
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingItem(null);
    setFormData({ ...emptyForms[modalTab] });
  }, [modalTab]);

  const collectionMap = useMemo(() => ({
    utilities: settings?.utilityTypes || [],
    periods: settings?.billingPeriods || [],
    expenses: settings?.expenseItems || [],
    deposits: settings?.depositTypes || [],
    unitTypes: settings?.unitTypes || [],
    maintenanceCategories: settings?.maintenanceCategories || [],
    saleStages:        [...(saleSettings?.pipelineStages || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    saleSources:       saleSettings?.leadSources    || [],
    salePropertyTypes: saleSettings?.propertyTypes  || [],
  }), [settings, saleSettings]);

  const visibleItems = useMemo(() => {
    const items = collectionMap[activeTab] || [];
    return showInactive ? items : items.filter((item) => item?.isActive !== false);
  }, [activeTab, collectionMap, showInactive]);

  const saveItem = async () => {
    if (!currentCompany?._id) return;

    if (SALE_TAB_ENDPOINTS[modalTab]) {
      const endpoint = SALE_TAB_ENDPOINTS[modalTab];
      const name = String(formData?.name || "").trim();
      if (!name) { toast.error("Name is required before saving."); return; }
      setSaving(true);
      try {
        if (editingItem?._id) {
          await adminRequests.put(`/sale/settings/${endpoint}/${editingItem._id}`, { name });
        } else {
          await adminRequests.post(`/sale/settings/${endpoint}`, { name });
        }
        toast.success(editingItem?._id ? "Setting updated successfully" : "Setting added successfully");
        closeModal();
        await loadSaleSettings();
      } catch (err) { toast.error(extractErrorMessage(err)); }
      finally { setSaving(false); }
      return;
    }

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

    setSaving(true);
    try {
      const payload = { ...formData };
      if (modalTab === "periods") {
        payload.durationInMonths = Number(payload.durationInMonths || 0);
        payload.durationInDays = Number(payload.durationInDays || payload.durationInMonths * 30 || 0);
      }
      if (modalTab === "expenses") {
        payload.defaultAmount = Number(payload.defaultAmount || 0);
      }
      if (modalTab === "deposits") {
        payload.defaultAmount = Number(payload.defaultAmount || 0);
        payload.refundable = payload.refundable !== false;
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

    if (SALE_TAB_ENDPOINTS[tabKey]) {
      const endpoint = SALE_TAB_ENDPOINTS[tabKey];
      try {
        await adminRequests.put(`/sale/settings/${endpoint}/${item._id}`, { isActive: nextActive });
        toast.success(nextActive ? "Setting reactivated successfully" : "Setting disabled successfully");
        await loadSaleSettings();
      } catch (err) { toast.error(extractErrorMessage(err)); }
      return;
    }

    const endpoint = TAB_CONFIG[tabKey]?.endpoint;
    if (!endpoint) return;
    try {
      await adminRequests.put(`/company-settings/${currentCompany._id}/${endpoint}/${item._id}`, { ...item, isActive: nextActive });
      toast.success(nextActive ? "Setting reactivated successfully" : "Setting disabled successfully");
      await loadSettings({ silent: true });
    } catch (error) {
      toast.error(extractErrorMessage(error));
    }
  };

  const archiveItem = async (tabKey, item) => {
    if (!currentCompany?._id || !item?._id) return;

    const confirmed = await confirm({
      title: "Archive Setting",
      message: `Archive ${item?.name || "this setting"}? It will stay in history but stop being available for future use.`,
      confirmText: "Archive",
    });
    if (!confirmed) return;

    if (SALE_TAB_ENDPOINTS[tabKey]) {
      const endpoint = SALE_TAB_ENDPOINTS[tabKey];
      try {
        await adminRequests.delete(`/sale/settings/${endpoint}/${item._id}`);
        toast.success("Setting archived successfully");
        await loadSaleSettings();
      } catch (err) { toast.error(extractErrorMessage(err)); }
      return;
    }

    const endpoint = TAB_CONFIG[tabKey]?.endpoint;
    if (!endpoint) return;
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

  const saveHrAccountingDefaults = async () => {
    if (!currentCompany?._id) return;

    setSavingHrAccounting(true);
    try {
      await adminRequests.put(`/company-settings/${currentCompany._id}/hr-accounting-defaults`, {
        hrAccountingDefaults,
      });
      toast.success("HR accounting defaults saved. New payroll posting flows will use these accounts.");
      await loadSettings({ silent: true });
    } catch (error) {
      toast.error(extractErrorMessage(error));
    } finally {
      setSavingHrAccounting(false);
    }
  };

  const saveInvAccountingDefaults = async () => {
    if (!currentCompany?._id) return;

    setSavingInvAccounting(true);
    try {
      await adminRequests.put(`/company-settings/${currentCompany._id}/inventory-accounting-defaults`, {
        inventoryAccountingDefaults: invAccountingDefaults,
      });
      toast.success("Inventory accounting defaults saved. New inventory and POS posting flows will use these accounts.");
      await loadSettings({ silent: true });
    } catch (error) {
      toast.error(extractErrorMessage(error));
    } finally {
      setSavingInvAccounting(false);
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

    if (tabKey === "deposits") {
      return [
        item?.code ? `Code: ${item.code}` : null,
        `Default amount: ${Number(item?.defaultAmount || 0).toLocaleString()}`,
        item?.refundable === false ? "Non-refundable" : "Refundable",
        item?.description,
      ]
        .filter(Boolean)
        .join(" - ");
    }

    if (tabKey === "unitTypes") {
      return [item?.description, item?.category ? `Category: ${String(item.category).replace(/_/g, " ")}` : null].filter(Boolean).join(" • ");
    }

    if (tabKey === "maintenanceCategories") {
      return [item?.description, `Priority: ${item?.priority || "medium"}`].filter(Boolean).join(" • ");
    }

    return "";
  };

  const renderCollectionRow = (tabKey, item, idx = 0) => {
    const isActive = item?.isActive !== false;
    return (
      <tr key={item._id} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
        {tabKey === "saleStages" && (
          <td className="w-8 px-3 py-1.5 border-r border-gray-100 text-center text-slate-400 font-bold">{(item.order ?? idx) + 1}</td>
        )}
        <td className="px-3 py-1.5 border-r border-gray-100 font-medium text-slate-900">{item.name || "—"}</td>
        {tabKey === "utilities" && (
          <>
            <td className="px-3 py-1.5 border-r border-gray-100 capitalize text-slate-600">{String(item.category || "").replace(/_/g, " ") || "—"}</td>
            <td className="max-w-[200px] truncate px-3 py-1.5 border-r border-gray-100 text-slate-500">{item.description || "—"}</td>
          </>
        )}
        {tabKey === "periods" && (
          <>
            <td className="px-3 py-1.5 border-r border-gray-100 text-center text-slate-600">{item.durationInMonths ?? "—"}</td>
            <td className="px-3 py-1.5 border-r border-gray-100 text-center text-slate-600">{item.durationInDays ?? "—"}</td>
          </>
        )}
        {tabKey === "expenses" && (
          <>
            <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{item.code || "—"}</td>
            <td className="px-3 py-1.5 border-r border-gray-100 capitalize text-slate-600">{String(item.category || "").replace(/_/g, " ") || "—"}</td>
            <td className="px-3 py-1.5 border-r border-gray-100 text-right text-slate-600">{Number(item.defaultAmount || 0).toLocaleString()}</td>
          </>
        )}
        {tabKey === "deposits" && (
          <>
            <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{item.code || "—"}</td>
            <td className="px-3 py-1.5 border-r border-gray-100 text-right text-slate-600">{Number(item.defaultAmount || 0).toLocaleString()}</td>
            <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{item.refundable === false ? "No" : "Yes"}</td>
            <td className="max-w-[180px] truncate px-3 py-1.5 border-r border-gray-100 text-slate-500">{item.description || "—"}</td>
          </>
        )}
        {tabKey === "unitTypes" && (
          <>
            <td className="px-3 py-1.5 border-r border-gray-100 capitalize text-slate-600">{String(item.category || "").replace(/_/g, " ") || "—"}</td>
            <td className="max-w-[200px] truncate px-3 py-1.5 border-r border-gray-100 text-slate-500">{item.description || "—"}</td>
          </>
        )}
        {tabKey === "maintenanceCategories" && (
          <>
            <td className="px-3 py-1.5 border-r border-gray-100 capitalize text-slate-600">{item.priority || "medium"}</td>
            <td className="max-w-[200px] truncate px-3 py-1.5 border-r border-gray-100 text-slate-500">{item.description || "—"}</td>
          </>
        )}
        <td className="px-3 py-1.5 border-r border-gray-100">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black ${isActive ? "border-emerald-200 bg-emerald-100 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
            {isActive ? "Active" : "Archived"}
          </span>
        </td>
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-1">
            <button onClick={() => openEditModal(tabKey, item)} className="rounded px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100">Edit</button>
            <button
              onClick={() => toggleItemStatus(tabKey, item, !isActive)}
              className={`rounded px-2 py-1 text-[10px] font-bold ${isActive ? "text-amber-600 hover:bg-amber-50" : "text-emerald-600 hover:bg-emerald-50"}`}
            >
              {isActive ? "Disable" : "Reactivate"}
            </button>
            {isActive && (
              <button onClick={() => archiveItem(tabKey, item)} className="rounded px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-50">Archive</button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const [loadingDefaults, setLoadingDefaults] = React.useState(false);

  const handleLoadDefaultUnitTypes = async () => {
    if (!currentCompany?._id || loadingDefaults) return;
    setLoadingDefaults(true);
    try {
      // Fire all seed requests in parallel instead of sequentially to avoid N+1 latency
      await Promise.all(
        DEFAULT_UNIT_TYPES_SEED.map((ut) =>
          adminRequests.post(`/company-settings/${currentCompany._id}/unit-types`, ut)
        )
      );
      toast.success("Default unit types loaded.");
      await loadSettings({ silent: true });
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setLoadingDefaults(false);
    }
  };

  const renderCollectionTab = (tabKey) => {
    const tab = TAB_CONFIG[tabKey];
    const list = collectionMap[tabKey] || [];
    const active = list.filter((item) => item?.isActive !== false).length;
    const archived = list.length - active;

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">{active} active · {archived} archived</span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-3.5 w-3.5" />
              Show archived
            </label>
          </div>
          <div className="flex items-center gap-2">
            {tabKey === "unitTypes" && list.length === 0 && (
              <button
                onClick={handleLoadDefaultUnitTypes}
                disabled={loadingDefaults}
                className="inline-flex items-center gap-1.5 border border-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#EDF5F1] disabled:opacity-50"
              >
                {loadingDefaults ? <Spinner size="sm" /> : null}
                Load Defaults
              </button>
            )}
            {SALE_TAB_ENDPOINTS[tabKey] && list.length === 0 && (
              <button
                onClick={async () => {
                  setLoadingDefaults(true);
                  try {
                    await adminRequests.post(`/sale/settings/load-defaults/${SALE_TAB_ENDPOINTS[tabKey]}`);
                    toast.success("Defaults loaded.");
                    await loadSaleSettings();
                  } catch (err) { toast.error(extractErrorMessage(err)); }
                  finally { setLoadingDefaults(false); }
                }}
                disabled={loadingDefaults}
                className="inline-flex items-center gap-1.5 border border-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#EDF5F1] disabled:opacity-50"
              >
                {loadingDefaults ? <Spinner size="sm" /> : null}
                Load Defaults
              </button>
            )}
            <button onClick={() => openCreateModal(tabKey)} className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3127]">
              <FaPlus className="text-[10px]" /> Add {tab.label.replace(/ies$/, "y").replace(/s$/, "")}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {visibleItems.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-500">{tab.empty || `No ${tab.label.toLowerCase()} configured yet.`}</div>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  {(COLLECTION_COLUMNS[tabKey] || []).map((h, i, arr) => (
                    <th key={h} className={`px-3 py-1.5 text-left font-bold ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item, i) => renderCollectionRow(tabKey, item, i))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  const saveIncomeRules = async () => {
    if (!currentCompany?._id) return;
    setSavingIncomeRules(true);
    try {
      const result = await adminRequests.put(`/company-settings/${currentCompany._id}/income-rules`, incomeRules);
      // Update Redux directly from the response — the fetchCompanySettings guard would return
      // stale cached data if settings are already in store, so we update the incomeRules field directly.
      const freshIncomeRules = result?.data?.incomeRules ?? incomeRules;
      if (reduxCompanySettings) {
        dispatch(getSettingsSuccess({ ...reduxCompanySettings, incomeRules: freshIncomeRules }));
      }
      toast.success("Income rules saved.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSavingIncomeRules(false);
    }
  };

  const renderIncomeRulesTab = () => (
    <div className="space-y-4">
      <Card
        title="Landlord Statement — Income Rules"
        subtitle="Control which charge types flow to the landlord's statement and which are retained as property manager income. These rules apply when generating landlord statements."
        action={
          <ActionButton variant="primary" onClick={saveIncomeRules} disabled={savingIncomeRules}>
            {savingIncomeRules ? <Spinner size="sm" /> : <FaSave />} Save Rules
          </ActionButton>
        }
      >
        <div className="space-y-6">
          {/* Fixed rules info */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Fixed rules (not configurable)</p>
            <div className="space-y-2">
              {[
                { label: "Rent", goes: "Landlord", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
                { label: "Utilities (water, electricity, garbage, etc.)", goes: "Landlord", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
                { label: "Service Charge", goes: "Landlord", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
                { label: "Security / Utility Deposits", goes: "Landlord (deposit section)", color: "text-blue-700 bg-blue-50 border-blue-200" },
                { label: "Lease Fee (placement fee)", goes: "Property Manager", color: "text-rose-700 bg-rose-50 border-rose-200" },
                { label: "Management Commission", goes: "Property Manager", color: "text-rose-700 bg-rose-50 border-rose-200" },
                { label: "Other Charge (generic)", goes: "Property Manager", color: "text-rose-700 bg-rose-50 border-rose-200" },
              ].map(({ label, goes, color }) => (
                <div key={label} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-slate-700">{label}</span>
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${color}`}>{goes}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Configurable: Late Penalties */}
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Configurable</p>
            <AppSelect
              label="Late Penalty Income"
              hint="Who receives late payment penalties charged to tenants?"
              value={incomeRules.latePenaltyBeneficiary}
              onChange={(v) => setIncomeRules((p) => ({ ...p, latePenaltyBeneficiary: v }))}
              options={LATE_PENALTY_BENEFICIARY_OPTIONS}
              getLabel={(o) => o.label}
              getValue={(o) => o.value}
            />
          </div>

          {/* Configurable: Manual Receipt Confirmation */}
          <div>
            <AppSelect
              label="Manual Receipt Confirmation"
              hint="Applies to receipts entered by hand (New Receipt / Add Receipt). Automated feeds like M-Pesa are unaffected."
              value={incomeRules.manualReceiptConfirmation}
              onChange={(v) => setIncomeRules((p) => ({ ...p, manualReceiptConfirmation: v }))}
              options={MANUAL_RECEIPT_CONFIRMATION_OPTIONS}
              getLabel={(o) => o.label}
              getValue={(o) => o.value}
            />
          </div>
        </div>
      </Card>
    </div>
  );

  const saveAutoInvoicing = async () => {
    if (!currentCompany?._id) return;
    setSavingAutoInvoicing(true);
    try {
      const res = await adminRequests.put(`/company-settings/${currentCompany._id}/auto-invoicing`, {
        enabled: autoInvoicing.enabled,
        billingDay: autoInvoicing.billingDay,
        daysInAdvance: autoInvoicing.daysInAdvance,
        notifyTenants: autoInvoicing.notifyTenants,
        notifyChannel: autoInvoicing.notifyChannel,
      });
      const ai = res?.data?.autoInvoicing || {};
      setAutoInvoicing((prev) => ({
        ...prev,
        ...ai,
        runHistory: Array.isArray(ai.runHistory) ? ai.runHistory : prev.runHistory,
      }));
      toast.success("Auto invoicing settings saved.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSavingAutoInvoicing(false);
    }
  };

  const triggerAutoInvoicing = async () => {
    if (!currentCompany?._id) return;
    setTriggeringAutoInvoicing(true);
    try {
      const res = await adminRequests.post(`/company-settings/${currentCompany._id}/auto-invoicing/trigger`);
      toast.success(res?.data?.message || "Auto invoicing run complete.");
      await loadSettings({ silent: true });
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setTriggeringAutoInvoicing(false);
    }
  };

  const autoInvoicingNextTrigger = useMemo(() => {
    if (!autoInvoicing.enabled) return null;
    const bd = Math.max(1, Math.min(28, Number(autoInvoicing.billingDay) || 1));
    const adv = Math.max(0, Math.min(14, Number(autoInvoicing.daysInAdvance) || 0));
    const triggerDay = bd - adv;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    let candidate;
    if (triggerDay >= 1) {
      candidate = new Date(year, month, triggerDay);
      if (candidate <= now) candidate = new Date(year, month + 1, triggerDay);
    } else {
      const prevLastDay = new Date(year, month, 0).getDate();
      candidate = new Date(year, month - 1, prevLastDay + triggerDay);
      if (candidate <= now) {
        const nextPrevLastDay = new Date(year, month + 1, 0).getDate();
        candidate = new Date(year, month, nextPrevLastDay + triggerDay);
      }
    }
    return candidate;
  }, [autoInvoicing.enabled, autoInvoicing.billingDay, autoInvoicing.daysInAdvance]);

  const renderAutoInvoicingTab = () => (
    <div className="space-y-4">
      {/* Status summary strip */}
      <div className="flex flex-wrap items-center gap-2 border border-slate-200 bg-slate-50 px-3 py-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${autoInvoicing.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${autoInvoicing.enabled ? "bg-emerald-500" : "bg-slate-400"}`} />
          {autoInvoicing.enabled ? "Enabled" : "Disabled"}
        </span>
        {autoInvoicing.enabled && autoInvoicingNextTrigger && (
          <span className="text-[11px] text-slate-600">
            Next run: <strong className="text-slate-800">
              {autoInvoicingNextTrigger.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
            </strong>
            {" "}(billing day {autoInvoicing.billingDay}{autoInvoicing.daysInAdvance > 0 ? `, ${autoInvoicing.daysInAdvance}d advance` : ""})
          </span>
        )}
        {autoInvoicing.notifyTenants && autoInvoicing.notifyChannel !== "none" && (
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
            Notify: {autoInvoicing.notifyChannel === "both" ? "SMS + Email" : String(autoInvoicing.notifyChannel).toUpperCase()}
          </span>
        )}
        {autoInvoicing.runHistory?.length > 0 && (
          <span className="ml-auto text-[11px] text-slate-400">{autoInvoicing.runHistory.length} run{autoInvoicing.runHistory.length !== 1 ? "s" : ""} recorded</span>
        )}
      </div>

      <Card
        title="Automatic Rent Invoicing"
        subtitle="Configure when rent invoices are automatically generated each month for active tenants. Invoices are created with an idempotency key — running twice in a month is safe."
        action={
          <ActionButton variant="primary" onClick={saveAutoInvoicing} disabled={savingAutoInvoicing}>
            {savingAutoInvoicing ? <Spinner size="sm" /> : <FaSave />} Save Settings
          </ActionButton>
        }
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <ToggleRow
            checked={autoInvoicing.enabled}
            onChange={(e) => setAutoInvoicing((p) => ({ ...p, enabled: e.target.checked }))}
            title="Enable automatic invoicing"
            description="When enabled, rent invoices are generated daily at 08:00 EAT on the configured trigger day."
          />
          <ToggleRow
            checked={autoInvoicing.notifyTenants}
            onChange={(e) => setAutoInvoicing((p) => ({ ...p, notifyTenants: e.target.checked }))}
            title="Notify tenants on invoice creation"
            description="Send a notification to tenants when their monthly rent invoice is auto-generated."
          />

          <div>
            <AppSelect
              label="Billing Day"
              hint="1–28, day of month rent is due"
              value={autoInvoicing.billingDay}
              onChange={(v) => setAutoInvoicing((p) => ({ ...p, billingDay: Number(v ?? 1) }))}
              options={BILLING_DAY_OPTIONS}
              size="md"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Invoices for billing day {autoInvoicing.billingDay} will be generated{" "}
              {autoInvoicing.daysInAdvance > 0
                ? `${autoInvoicing.daysInAdvance} day(s) in advance (on the ${Math.max(1, autoInvoicing.billingDay - autoInvoicing.daysInAdvance)}${autoInvoicing.billingDay - autoInvoicing.daysInAdvance === 1 ? "st" : autoInvoicing.billingDay - autoInvoicing.daysInAdvance === 2 ? "nd" : autoInvoicing.billingDay - autoInvoicing.daysInAdvance === 3 ? "rd" : "th"})`
                : "on the billing day itself"}.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">
              Days in Advance <span className="font-normal text-slate-500">(0 = same day, max 14)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={14}
                step={1}
                value={autoInvoicing.daysInAdvance}
                onChange={(e) => setAutoInvoicing((p) => ({ ...p, daysInAdvance: Number(e.target.value) }))}
                className="h-2 w-full cursor-pointer accent-emerald-700"
              />
              <span className="w-8 text-center text-sm font-bold text-slate-700">{autoInvoicing.daysInAdvance}</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Generate invoices this many days before the billing day so tenants have advance notice.
            </p>
          </div>

          {autoInvoicing.notifyTenants && (
            <AppSelect
              label="Notification Channel"
              hint="Requires configured SMS / email profile"
              value={autoInvoicing.notifyChannel}
              onChange={(v) => setAutoInvoicing((p) => ({ ...p, notifyChannel: v ?? "none" }))}
              options={NOTIFY_CHANNEL_OPTIONS}
              size="md"
            />
          )}
        </div>

        <div className="mt-4 border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] leading-5 text-slate-600">
          <strong className="text-slate-800">How it works:</strong> Daily at 08:00 EAT the system checks all active leases.
          Monthly leases are invoiced every month; quarterly/semi-annual/annual leases only in their billing cycle months (calculated from lease start date).
          Each lease uses its own <strong>Payment Due Day</strong> for the invoice due date.
          To exclude a single lease from auto-invoicing, disable the <strong>Auto Invoice</strong> toggle on that lease — no need to change settings here.
        </div>
      </Card>

      <Card title="Manual Trigger & Run History" subtitle="Run the auto invoicing process right now for this company. Safe to run multiple times — duplicate invoices are skipped automatically.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-600">
            {autoInvoicing.lastRunAt ? (
              <>
                <span className="font-semibold">Last run:</span>{" "}
                {new Date(autoInvoicing.lastRunAt).toLocaleString("en-GB", {
                  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                })}{" "}
                {autoInvoicing.lastRunSummary && (
                  <span className="text-slate-500">— {autoInvoicing.lastRunSummary}</span>
                )}
              </>
            ) : (
              <span className="text-slate-400 italic">No runs recorded yet.</span>
            )}
          </div>
          <ActionButton variant="primary" onClick={triggerAutoInvoicing} disabled={triggeringAutoInvoicing}>
            {triggeringAutoInvoicing ? <Spinner size="sm" /> : <FaPlay />}
            {triggeringAutoInvoicing ? "Running..." : "Run Now"}
          </ActionButton>
        </div>

        {autoInvoicing.runHistory?.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Recent Runs (last {autoInvoicing.runHistory.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-[#0B3B2E] text-white">
                    <th className="border-r border-white/10 px-3 py-1.5 text-left font-bold">Run At</th>
                    <th className="border-r border-white/10 px-3 py-1.5 text-center font-bold">Created</th>
                    <th className="border-r border-white/10 px-3 py-1.5 text-center font-bold">Skipped</th>
                    <th className="border-r border-white/10 px-3 py-1.5 text-center font-bold">Errors</th>
                    <th className="px-3 py-1.5 text-left font-bold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {autoInvoicing.runHistory.map((run, i) => (
                    <tr
                      key={i}
                      className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}
                    >
                      <td className="border-r border-slate-100 px-3 py-1.5 text-slate-700">
                        {run.runAt
                          ? new Date(run.runAt).toLocaleString("en-GB", {
                              day: "2-digit", month: "short", year: "numeric",
                              hour: "2-digit", minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="border-r border-slate-100 px-3 py-1.5 text-center font-bold text-emerald-700">
                        {run.created ?? 0}
                      </td>
                      <td className="border-r border-slate-100 px-3 py-1.5 text-center text-slate-500">
                        {run.skipped ?? 0}
                      </td>
                      <td className={`border-r border-slate-100 px-3 py-1.5 text-center font-bold ${Number(run.errors) > 0 ? "text-rose-600" : "text-slate-400"}`}>
                        {run.errors ?? 0}
                      </td>
                      <td className="px-3 py-1.5 capitalize text-slate-500">
                        {run.triggeredBy || "cron"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );

  const renderTaxTab = () => (
    <div className="space-y-4">
      <Card
        title="Tax Configuration"
        subtitle="These are company-wide future-facing defaults for invoices and commission tax handling. Saving here does not restate posted invoices or processed statements."
        action={
          <ActionButton variant="primary" onClick={saveTaxConfiguration} disabled={savingTax}>
            {savingTax ? <Spinner size="sm" /> : <FaSave />} Save Tax Configuration
          </ActionButton>
        }
      >
        <div className="border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-800">
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
          <AppSelect
            label="Default Tax Mode"
            value={taxConfig.taxSettings.defaultTaxMode}
            onChange={(v) => handleTaxSettingChange("defaultTaxMode", v ?? "exclusive")}
            options={TAX_MODE_OPTIONS}
            size="md"
          />
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
          <AppSelect
            label="Default Tax Code"
            value={taxConfig.taxSettings.defaultTaxCodeKey}
            onChange={(v) => handleTaxSettingChange("defaultTaxCodeKey", v ?? "")}
            options={taxConfig.taxCodes.map((code) => ({
              value: code.key,
              label: `${code.name} (${code.key})`,
            }))}
            size="md"
          />
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Output VAT Account Code</label>
            <Input
              value={taxConfig.taxSettings.outputVatAccountCode}
              onChange={(e) => handleTaxSettingChange("outputVatAccountCode", e.target.value)}
              placeholder="2140"
            />
          </div>
          <AppSelect
            label="Rounding Precision"
            value={taxConfig.taxSettings.roundingPrecision}
            onChange={(v) => handleTaxSettingChange("roundingPrecision", Number(v ?? 2))}
            options={ROUNDING_PRECISION_OPTIONS}
            size="md"
          />
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

        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="mb-3 text-xs font-bold text-slate-700">KRA Statutory Tax Rates</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Monthly Rental Income (MRI) Tax Rate (%)
              </label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={Number(((taxConfig.mriRate ?? 0.075) * 100).toFixed(4)).toString()}
                onChange={(e) => setTaxConfig((prev) => ({ ...prev, mriRate: Number(e.target.value || 0) / 100 }))}
                placeholder="7.5"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Applied to gross residential rent on the MRI Tax Summary Report. KRA rate effective Jan 2024: 7.5%. Update here when KRA revises it.
              </p>
            </div>
          </div>
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
            <div key={code._id || index} className="border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Key</label>
                  <Input value={code.key} onChange={(e) => handleTaxCodeChange(index, "key", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Name</label>
                  <Input value={code.name} onChange={(e) => handleTaxCodeChange(index, "name", e.target.value)} />
                </div>
                <AppSelect
                  label="Type"
                  value={code.type}
                  onChange={(v) => handleTaxCodeChange(index, "type", v ?? "vat")}
                  options={TAX_CODE_TYPE_OPTIONS}
                  size="md"
                />
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
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-[#0B3B2E]/20"
                    />
                    Default tax code
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={code.isActive !== false}
                      onChange={(e) => handleTaxCodeChange(index, "isActive", e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-[#0B3B2E]/20"
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

  const renderAccountingDefaultsGrid = (fields, defaults, setField) => (
    <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
      {fields.map((field) => {
        const bucket = chartAccountOptionsByType[field.type];
        const options = bucket?.options || [];
        const selectedAccount = (bucket?.accounts || []).find((account) => String(account?._id || "") === String(defaults[field.key] || ""));

        return (
          <div key={field.key} className="border border-slate-200 bg-slate-50 p-3">
            <div className="text-sm font-extrabold text-slate-900">{field.label}</div>
            <div className="mt-1 text-xs leading-5 text-slate-600">{field.description}</div>

            <div className="mt-3">
              <AppSelect
                value={defaults[field.key] || ""}
                onChange={(v) => setField(field.key, v ?? "")}
                options={options}
                placeholder="Use automatic fallback"
                clearable
                searchable
                size="md"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Allowed type: {field.type}</div>
              <ActionButton variant="subtle" onClick={() => setField(field.key, "")}>Clear</ActionButton>
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
  );

  const renderAccountingTab = () => (
    <div className="space-y-6">
      {hasPM && (
        <Card
          title="Property Management Accounting Defaults"
          subtitle="Default posting accounts for rent, utilities, deposits and commissions. Leaving a field blank keeps the built-in MILIK fallback behavior. Historical entries remain untouched."
          action={
            <ActionButton variant="primary" onClick={saveAccountingDefaults} disabled={savingAccounting || loadingAccounts}>
              {savingAccounting ? <Spinner size="sm" /> : <FaSave />} Save PMS Defaults
            </ActionButton>
          }
        >
          <div className="border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-800">
            Choose real Chart of Accounts rows. These defaults only guide future posting where no more specific account has been selected.
          </div>

          {loadingAccounts ? (
            <div className="mt-4 flex items-center gap-3 text-sm text-slate-600">
              <Spinner size="sm" /> Loading Chart of Accounts...
            </div>
          ) : (
            renderAccountingDefaultsGrid(ACCOUNTING_DEFAULT_FIELDS, accountingDefaults, setAccountingDefaultField)
          )}
        </Card>
      )}

      {hasHR && (
        <Card
          title="HR & Payroll Accounting Defaults"
          subtitle="Default posting accounts for payroll journals. When a payslip is approved these accounts determine where gross pay, statutory deductions and employer contributions are posted."
          action={
            <ActionButton variant="primary" onClick={saveHrAccountingDefaults} disabled={savingHrAccounting || loadingAccounts}>
              {savingHrAccounting ? <Spinner size="sm" /> : <FaSave />} Save HR Defaults
            </ActionButton>
          }
        >
          <div className="border border-blue-200 bg-blue-50 px-3 py-2.5 text-[11px] leading-5 text-blue-800">
            These accounts are used when the HR module posts payroll journals. PAYE, NHIF/SHA, NSSF, AHL and net pay each post to their respective liability accounts. Gross salary expense is debited to the salary expense account.
          </div>

          {loadingAccounts ? (
            <div className="mt-4 flex items-center gap-3 text-sm text-slate-600">
              <Spinner size="sm" /> Loading Chart of Accounts...
            </div>
          ) : (
            renderAccountingDefaultsGrid(HR_ACCOUNTING_DEFAULT_FIELDS, hrAccountingDefaults, setHrAccountingDefaultField)
          )}
        </Card>
      )}

      {hasInv && (
        <Card
          title="Inventory & POS Accounting Defaults"
          subtitle="Default posting accounts for inventory movements, sales revenue, COGS, and purchase clearing. These accounts drive journal entries when stock is bought, sold, or adjusted."
          action={
            <ActionButton variant="primary" onClick={saveInvAccountingDefaults} disabled={savingInvAccounting || loadingAccounts}>
              {savingInvAccounting ? <Spinner size="sm" /> : <FaSave />} Save Inventory Defaults
            </ActionButton>
          }
        >
          <div className="border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[11px] leading-5 text-emerald-800">
            These accounts are used when inventory and POS transactions post journal entries. Inventory Asset is debited on purchase and credited on sale (offset by COGS). Sales Revenue is credited on every POS sale.
          </div>

          {loadingAccounts ? (
            <div className="mt-4 flex items-center gap-3 text-sm text-slate-600">
              <Spinner size="sm" /> Loading Chart of Accounts...
            </div>
          ) : (
            renderAccountingDefaultsGrid(INV_ACCOUNTING_DEFAULT_FIELDS, invAccountingDefaults, setInvAccountingDefaultField)
          )}
        </Card>
      )}

      {!hasPM && !hasHR && !hasInv && (
        <div className="flex h-40 items-center justify-center border border-slate-200 bg-white text-[12px] text-slate-400">
          No accounting defaults are configured for your active modules.
        </div>
      )}
    </div>
  );

  const handleSavePenaltyRule = async () => {
    if (!currentCompany?._id) return;
    if (!String(penaltyRuleForm.ruleName || "").trim()) { toast.error("Rule name is required."); return; }
    if (!penaltyRuleForm.postingAccount) { toast.error("Posting account is required."); return; }
    try {
      setSavingPenaltyRule(true);
      if (editingPenaltyRuleId) {
        const res = await updateLatePenaltyRule(editingPenaltyRuleId, { business: currentCompany._id, ...penaltyRuleForm });
        toast.success(res?.message || "Rule updated.");
      } else {
        const res = await createLatePenaltyRule({ business: currentCompany._id, ...penaltyRuleForm });
        toast.success(res?.message || "Rule created.");
      }
      await loadPenaltyRules();
      setShowPenaltyRuleModal(false);
    } catch (err) { toast.error(extractErrorMessage(err)); }
    finally { setSavingPenaltyRule(false); }
  };

  const renderSaleCommDefaultsTab = () => (
    <div className="space-y-4">
      <Card
        title="Commission Defaults"
        subtitle="Pre-fill values when registering a new agent. Each agent can override these individually."
        action={
          <ActionButton variant="primary" onClick={async () => {
            setSavingSaleComm(true);
            try {
              await adminRequests.put("/sale/settings/commission-defaults", saleCommForm);
              toast.success("Commission defaults saved.");
              await loadSaleSettings();
            } catch (err) { toast.error(extractErrorMessage(err)); }
            finally { setSavingSaleComm(false); }
          }} disabled={savingSaleComm}>
            {savingSaleComm ? <Spinner size="sm" /> : <FaSave />} Save Defaults
          </ActionButton>
        }
      >
        <p className="mb-4 text-[11px] leading-5 text-slate-500">These defaults pre-fill when creating a new agent. Each agent can be overridden individually.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Default Commission Rate (%)</label>
            <Input type="number" min="0" step="0.1" value={saleCommForm.rate}
              onChange={(e) => setSaleCommForm((p) => ({ ...p, rate: Number(e.target.value || 0) }))} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Default Commission Type</label>
            <AppSelect value={saleCommForm.commissionType}
              onChange={(v) => setSaleCommForm((p) => ({ ...p, commissionType: v ?? "percentage" }))}
              options={SALE_COMMISSION_TYPE_OPTIONS}
              size="md" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Default WHT Rate (%)</label>
            <Input type="number" min="0" max="100" step="0.1" value={saleCommForm.whtRate}
              onChange={(e) => setSaleCommForm((p) => ({ ...p, whtRate: Number(e.target.value || 0) }))} />
            <p className="mt-1 text-[10px] text-slate-400">Withholding tax deducted from commission payouts (Kenya statutory rate: 5%).</p>
          </div>
        </div>
      </Card>
    </div>
  );

  const setInvPOS = (key) => (val) => { setInvPOSForm((f) => ({ ...f, [key]: val })); setDirtyInvPOS(true); };
  const setInvPOSVal = (key) => (e) => setInvPOS(key)(e.target.type === "checkbox" ? e.target.checked : e.target.value);

  const renderInvPOSTab = () => (
    <div className="space-y-4">
      {dirtyInvPOS && (
        <div className="flex items-center justify-between gap-3 border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="text-[11px] font-semibold text-amber-700">You have unsaved changes</span>
          <button onClick={saveInvPOSSettings} disabled={savingInvPOS}
            className="inline-flex items-center gap-1.5 bg-[#FF8C00] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#E67E00] disabled:opacity-60">
            {savingInvPOS ? <Spinner size="sm" /> : <FaSave />} Save Changes
          </button>
        </div>
      )}

      {loadingInvPOS ? (
        <div className="flex h-32 items-center justify-center text-sm text-slate-400">Loading…</div>
      ) : (
        <>
          <Card title="Currency & Formatting"
            action={
              <ActionButton variant="primary" onClick={saveInvPOSSettings} disabled={savingInvPOS}>
                {savingInvPOS ? <Spinner size="sm" /> : <FaSave />} Save
              </ActionButton>
            }
          >
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Currency Code</label>
                <Input value={invPOSForm.currency} onChange={setInvPOSVal("currency")} placeholder="KES" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Currency Symbol</label>
                <Input value={invPOSForm.currencySymbol} onChange={setInvPOSVal("currencySymbol")} placeholder="Ksh" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Decimal Places</label>
                <select className="w-full border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-800 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  value={invPOSForm.decimalPlaces} onChange={setInvPOSVal("decimalPlaces")}>
                  <option value={0}>0</option>
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                </select>
              </div>
            </div>
          </Card>

          <Card title="Receipt Printing">
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Receipt Header</label>
                <textarea rows={3} className="w-full resize-none border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-800 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  value={invPOSForm.receiptHeader} onChange={setInvPOSVal("receiptHeader")}
                  placeholder="Business name, address, phone — appears at top of receipt" />
                <p className="mt-0.5 text-[10px] text-slate-400">Leave blank to use company name from settings.</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Receipt Footer</label>
                <textarea rows={2} className="w-full resize-none border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-800 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  value={invPOSForm.receiptFooter} onChange={setInvPOSVal("receiptFooter")}
                  placeholder="e.g. Thank you for your business!" />
              </div>
              <div className="space-y-3 pt-1">
                {[
                  ["showVATBreakdown", "Show VAT breakdown on receipt", "Displays tax subtotals per rate line"],
                  ["showCashierName", "Show cashier name on receipt", null],
                  ["showReceiptNumber", "Show receipt number on receipt", null],
                  ["autoReceiptPrint", "Auto-print receipt after sale", "Sends to default printer automatically"],
                ].map(([key, label, hint]) => (
                  <ToggleRow key={key} checked={invPOSForm[key]}
                    onChange={(e) => { setInvPOSForm((f) => ({ ...f, [key]: e.target.checked })); setDirtyInvPOS(true); }}
                    title={label} description={hint || ""} />
                ))}
              </div>
            </div>
          </Card>

          <Card title="Tax / Fiscal Compliance">
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">VAT Registration PIN</label>
                <Input value={invPOSForm.vatPIN} onChange={setInvPOSVal("vatPIN")} placeholder="e.g. P051234567B" />
                <p className="mt-0.5 text-[10px] text-slate-400">Printed on receipts and invoices as required by KRA.</p>
              </div>
              <ToggleRow checked={invPOSForm.kraETIMSEnabled}
                onChange={(e) => { setInvPOSForm((f) => ({ ...f, kraETIMSEnabled: e.target.checked })); setDirtyInvPOS(true); }}
                title="Enable KRA eTIMS integration"
                description="Electronic Tax Invoice Management System — required for VAT-registered businesses in Kenya" />
              {invPOSForm.kraETIMSEnabled && (
                <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  eTIMS integration requires additional configuration. Contact your system administrator.
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );

  const setCwField = (setter) => (val) => { setter(val); setDirtyCW(true); };

  const renderCWOperationsTab = () => (
    <div className="space-y-4">
      {dirtyCW && (
        <div className="flex items-center justify-between gap-3 border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="text-[11px] font-semibold text-amber-700">You have unsaved changes</span>
          <button onClick={saveCWSettings} disabled={savingCW}
            className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-60">
            {savingCW ? <Spinner size="sm" /> : <FaSave />} Save Changes
          </button>
        </div>
      )}

      {loadingCW ? (
        <div className="flex h-32 items-center justify-center text-sm text-slate-400">Loading…</div>
      ) : (
        <>
          <Card title="Queue Display" subtitle="Name shown on the customer-facing TV screen."
            action={<ActionButton variant="primary" onClick={saveCWSettings} disabled={savingCW}>{savingCW ? <Spinner size="sm" /> : <FaSave />} Save</ActionButton>}
          >
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Display name (max 60 chars)</label>
                <Input value={cwQueueDisplayName} maxLength={60}
                  onChange={(e) => { setCwQueueDisplayName(e.target.value.slice(0, 60)); setDirtyCW(true); }}
                  placeholder="e.g. ABC CAR WASH" />
                <p className="mt-0.5 text-[10px] text-slate-400">{cwQueueDisplayName.length}/60 · Shown as heading on the queue display screen.</p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Queue screen background image</label>
                {cwQueueBgImage ? (
                  <div className="relative mt-1 h-28 w-full overflow-hidden border border-slate-200 bg-slate-900">
                    <img src={`${(import.meta.env.VITE_API_URL || "").replace(/\/api\/?$/, "")}${cwQueueBgImage}`}
                      alt="Queue background" className="h-full w-full object-cover"
                      onError={(e) => { e.currentTarget.style.opacity = "0.3"; }} />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom,rgba(0,0,0,0.55),rgba(0,0,0,0.42) 50%,rgba(0,0,0,0.58))" }} />
                    <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                      <label className="cursor-pointer border border-white/30 bg-black/50 px-2 py-1 text-[9px] font-bold text-white hover:bg-white/20 transition">
                        <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" className="hidden" disabled={cwBgUploading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0]; if (!file) return;
                            setCwBgUploading(true);
                            try { const r = await carWashApi.uploadQueueBgImage(file); setCwQueueBgImage(r.url); setDirtyCW(true); toast.success("Background uploaded"); }
                            catch (err) { toast.error(err?.response?.data?.message || "Upload failed"); }
                            finally { setCwBgUploading(false); e.target.value = ""; }
                          }} />
                        {cwBgUploading ? "Uploading…" : "Replace"}
                      </label>
                      <button type="button" onClick={() => { setCwQueueBgImage(""); setDirtyCW(true); }}
                        className="border border-red-400/40 bg-red-600/60 px-2 py-1 text-[9px] font-bold text-white hover:bg-red-600/80 transition">
                        <FaTrash size={8} className="inline" /> Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className={`mt-1 flex h-24 w-full cursor-pointer flex-col items-center justify-center gap-1.5 border-2 border-dashed transition ${cwBgUploading ? "border-blue-400 bg-blue-50/60" : "border-slate-300 bg-slate-50 hover:border-[#0B3B2E]/50"}`}>
                    <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" className="hidden" disabled={cwBgUploading}
                      onChange={async (e) => {
                        const file = e.target.files?.[0]; if (!file) return;
                        setCwBgUploading(true);
                        try { const r = await carWashApi.uploadQueueBgImage(file); setCwQueueBgImage(r.url); setDirtyCW(true); toast.success("Background uploaded"); }
                        catch (err) { toast.error(err?.response?.data?.message || "Upload failed"); }
                        finally { setCwBgUploading(false); e.target.value = ""; }
                      }} />
                    {cwBgUploading ? <><div className="h-4 w-4 animate-spin border-2 border-blue-400 border-t-transparent rounded-full" /><span className="text-[11px] text-blue-600">Uploading…</span></> : <><FaImage size={18} className="text-slate-300" /><span className="text-[11px] text-slate-500">Click to upload (JPG · PNG · WebP)</span></>}
                  </label>
                )}
              </div>
            </div>
          </Card>

          <Card title="Discount Policy" subtitle="Controls when and how much discount staff can apply on a job.">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Minimum job price for discount (KES)</label>
                <Input type="number" min="0" step="1" value={cwDiscountMinJobPrice}
                  onChange={(e) => { setCwDiscountMinJobPrice(e.target.value); setDirtyCW(true); }} placeholder="0" />
                <p className="mt-0.5 text-[10px] text-slate-400">Set to 0 to always allow discounts.</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Maximum discount allowed (%)</label>
                <Input type="number" min="0" max="100" step="1" value={cwDiscountMaxPercent}
                  onChange={(e) => { setCwDiscountMaxPercent(e.target.value); setDirtyCW(true); }} placeholder="0" />
                <p className="mt-0.5 text-[10px] text-slate-400">Staff can reduce it but not exceed this cap. Set to 0 for no cap.</p>
              </div>
            </div>
          </Card>

          <Card title="Default Cashbooks by Payment Method" subtitle="Auto-selected when recording a payment.">
            <div className="grid gap-4 sm:grid-cols-2">
              {CW_METHODS.map((method) => (
                <AppSelect key={method} label={CW_METHOD_LABELS[method]}
                  value={cwDefaults[method]}
                  onChange={(v) => { setCwDefaults((p) => ({ ...p, [method]: v ?? "" })); setDirtyCW(true); }}
                  options={cwCashbookOptions}
                  placeholder="— No default —" clearable searchable size="md" />
              ))}
            </div>
          </Card>

          <Card title="Damage Recovery" subtitle="Default mode for recovering staff damages through commission payouts.">
            <div className="space-y-4">
              <AppSelect label="Default recovery mode" value={cwDmgMode}
                onChange={(v) => { setCwDmgMode(v ?? "full"); setCwDmgValue(""); setDirtyCW(true); }}
                options={CW_DAMAGE_MODE_OPTIONS} size="md" />
              {cwDmgMode === "percent" && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Default deduction rate (%)</label>
                  <Input type="number" min="1" max="100" step="1" value={cwDmgValue}
                    onChange={(e) => { setCwDmgValue(e.target.value); setDirtyCW(true); }} placeholder="e.g. 10" />
                </div>
              )}
              {cwDmgMode === "fixed" && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Default deduction amount (Ksh)</label>
                  <Input type="number" min="1" step="1" value={cwDmgValue}
                    onChange={(e) => { setCwDmgValue(e.target.value); setDirtyCW(true); }} placeholder="e.g. 50" />
                </div>
              )}
              {cwDmgMode === "full" && <p className="text-[10px] text-slate-400">Entire outstanding balance deducted at next commission payout.</p>}
            </div>
          </Card>

          <Card title="Staff Savings Scheme" subtitle="Fixed deduction from each commission payout, held in savings.">
            <div className="space-y-4">
              <div className="flex items-center justify-between border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-xs font-bold text-slate-800">Savings scheme</p>
                  <p className="text-[10px] text-slate-400">{cwSavingsEnabled ? "Active — deductions run on each payout" : "Disabled — no deductions will be made"}</p>
                </div>
                <button type="button" onClick={() => { setCwSavingsEnabled((v) => !v); setDirtyCW(true); }}>
                  {cwSavingsEnabled ? <FaToggleOn size={28} className="text-emerald-500" /> : <FaToggleOff size={28} className="text-slate-300" />}
                </button>
              </div>
              {cwSavingsEnabled && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Deduction per day (Ksh)</label>
                  <Input type="number" min="0" step="10" value={cwSavingsAmount}
                    onChange={(e) => { setCwSavingsAmount(e.target.value); setDirtyCW(true); }} />
                  <p className="mt-0.5 text-[10px] text-slate-400">Posted once per staff member per calendar day.</p>
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );

  const renderCWSMSTab = () => (
    <div className="space-y-4">
      {dirtyCW && (
        <div className="flex items-center justify-between gap-3 border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="text-[11px] font-semibold text-amber-700">You have unsaved changes</span>
          <button onClick={saveCWSettings} disabled={savingCW}
            className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-60">
            {savingCW ? <Spinner size="sm" /> : <FaSave />} Save Changes
          </button>
        </div>
      )}
      <Card title="Automatic SMS Templates"
        subtitle="Customise messages for each event. Toggle off to disable an SMS entirely."
        action={<ActionButton variant="primary" onClick={saveCWSettings} disabled={savingCW}>{savingCW ? <Spinner size="sm" /> : <FaSave />} Save</ActionButton>}
      >
        {loadingCW ? (
          <div className="flex h-28 items-center justify-center text-slate-400 text-sm">Loading…</div>
        ) : cwSmsTemplates.length === 0 ? (
          <div className="flex h-28 items-center justify-center text-slate-400 text-sm">No SMS templates configured for this company.</div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200">
            {cwSmsTemplates.map((tpl) => {
              const isOpen = cwExpandedSms === tpl.key;
              const charCount = (tpl.messageBody || "").length;
              const smsCount = Math.ceil(charCount / 160) || 1;
              return (
                <div key={tpl.key} className={!tpl.enabled ? "bg-slate-50/60" : "bg-white"}>
                  <button type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition"
                    onClick={() => setCwExpandedSms(isOpen ? null : tpl.key)}>
                    <div className="flex min-w-0 items-center gap-3">
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); setCwSmsTemplates((p) => p.map((t) => t.key === tpl.key ? { ...t, enabled: !t.enabled } : t)); setDirtyCW(true); }}>
                        {tpl.enabled ? <FaToggleOn size={22} className="text-emerald-500" /> : <FaToggleOff size={22} className="text-slate-300" />}
                      </button>
                      <div className="min-w-0">
                        <p className={`truncate text-xs font-bold ${tpl.enabled ? "text-slate-800" : "text-slate-400"}`}>{tpl.name}</p>
                        {tpl.description && <p className="truncate text-[10px] text-slate-400">{tpl.description}</p>}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {!isOpen && charCount > 0 && <span className="hidden text-[10px] tabular-nums text-slate-400 sm:block">{charCount}c</span>}
                      <span className={`text-[9px] font-black uppercase tracking-wide px-2 py-0.5 border ${tpl.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-400"}`}>
                        {tpl.enabled ? "ON" : "OFF"}
                      </span>
                      {isOpen ? <FaChevronUp size={9} className="text-slate-400" /> : <FaChevronDown size={9} className="text-slate-400" />}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-4 space-y-3">
                      {(tpl.placeholders || []).length > 0 && (
                        <div>
                          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Placeholders — click to insert</p>
                          <div className="flex flex-wrap gap-1.5">
                            {tpl.placeholders.map((p) => (
                              <button key={p.token} type="button" title={p.hint}
                                onClick={() => { setCwSmsTemplates((prev) => prev.map((t) => t.key !== tpl.key ? t : { ...t, messageBody: (t.messageBody || "") + p.token })); setDirtyCW(true); }}
                                className="border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-[#0B3B2E] hover:border-[#0B3B2E] hover:bg-[#EDF5F1] transition">
                                {p.token}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Message body</label>
                          <div className="flex items-center gap-2 text-[10px] tabular-nums">
                            <span className={charCount > 320 ? "font-bold text-red-500" : "text-slate-400"}>{charCount} chars</span>
                            <span className={`border px-1.5 py-0.5 font-bold ${smsCount > 1 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                              {smsCount} SMS
                            </span>
                          </div>
                        </div>
                        <textarea rows={4}
                          className="w-full border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20 resize-y"
                          value={tpl.messageBody || ""}
                          onChange={(e) => { setCwSmsTemplates((prev) => prev.map((t) => t.key !== tpl.key ? t : { ...t, messageBody: e.target.value })); setDirtyCW(true); }}
                          placeholder="Enter message text…" />
                        {smsCount > 1 && <p className="mt-1 text-[10px] text-amber-600">Messages over 160 characters are sent as {smsCount} SMS parts and may incur extra cost.</p>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );

  const renderPenaltyRulesTab = () => {
    const active = penaltyRules.filter(r => r.active !== false).length;
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2">
          <span className="text-xs text-slate-500">{active} active · {penaltyRules.length - active} inactive</span>
          <button onClick={() => { setEditingPenaltyRuleId(""); setPenaltyRuleForm(defaultPenaltyRuleForm); setShowPenaltyRuleModal(true); }}
            className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3127]">
            <FaPlus className="text-[10px]" /> Add Rule
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {penaltyRules.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-500">No late payment rules configured yet.</div>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  {["Rule Name","Calc Type","Rate","Grace Days","Frequency","Posting Account","Status","Actions"].map((h,i,arr) => (
                    <th key={h} className={`px-3 py-1 text-left font-bold ${i < arr.length-1 ? 'border-r border-white/10' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {penaltyRules.map((rule, idx) => {
                  const isActive = rule.active !== false;
                  return (
                    <tr key={rule._id} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                      <td className="px-3 py-1 border-r border-gray-100 font-medium text-slate-900">{rule.ruleName || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-600 capitalize">{String(rule.calculationType || "").replace(/_/g," ")}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{rule.rateOrAmount ?? "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-center text-slate-600">{rule.graceDays ?? 0}</td>
                      <td className="px-3 py-1 border-r border-gray-100 capitalize text-slate-600">{rule.repeatFrequency || "manual"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{rule.postingAccount?.name || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${isActive ? "border-emerald-200 bg-emerald-100 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                          {isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-1">
                        <div className="flex items-center gap-1">
                          <button onClick={() => { setEditingPenaltyRuleId(rule._id); setPenaltyRuleForm(mapPenaltyRuleToForm(rule)); setShowPenaltyRuleModal(true); }}
                            className="rounded px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100">Edit</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

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
          <AppSelect
            label="Category"
            value={formData.category || "utility"}
            onChange={(v) => setFormData((prev) => ({ ...prev, category: v ?? "utility" }))}
            options={[
              { value: "utility", label: "Utility" },
              { value: "service_charge", label: "Service charge" },
              { value: "maintenance", label: "Maintenance" },
            ]}
            size="md"
          />
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

    if (tabKey === "deposits") {
      return (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Name *</label>
            <Input value={formData.name || ""} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} placeholder="Security Deposit" />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Code</label>
              <Input value={formData.code || ""} onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))} placeholder="SECURITY" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Default Amount</label>
              <Input type="number" min="0" step="0.01" value={formData.defaultAmount || 0} onChange={(e) => setFormData((prev) => ({ ...prev, defaultAmount: e.target.value }))} />
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={formData.refundable !== false}
              onChange={(e) => setFormData((prev) => ({ ...prev, refundable: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300"
            />
            Refundable deposit
          </label>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Description</label>
            <Input value={formData.description || ""} onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))} placeholder="Optional guidance" />
          </div>
        </div>
      );
    }

    if (tabKey === "unitTypes") {
      return (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Name *</label>
            <Input value={formData.name || ""} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} placeholder="Studio" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Description</label>
            <Input value={formData.description || ""} onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))} placeholder="Optional description" />
          </div>
          <AppSelect
            label="Category"
            value={formData.category || "residential"}
            onChange={(v) => setFormData((prev) => ({ ...prev, category: v ?? "residential" }))}
            options={[
              { value: "residential", label: "Residential" },
              { value: "commercial", label: "Commercial" },
              { value: "mixed", label: "Mixed" },
            ]}
            size="md"
          />
        </div>
      );
    }

    if (tabKey === "maintenanceCategories") {
      return (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Name *</label>
            <Input value={formData.name || ""} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} placeholder="Plumbing" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Description</label>
            <Input value={formData.description || ""} onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))} placeholder="Optional description" />
          </div>
          <AppSelect
            label="Priority"
            value={formData.priority || "medium"}
            onChange={(v) => setFormData((prev) => ({ ...prev, priority: v ?? "medium" }))}
            options={[
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "critical", label: "Critical" },
            ]}
            size="md"
          />
        </div>
      );
    }

    if (tabKey === "saleStages") {
      return (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Stage Name *</label>
            <Input value={formData.name || ""} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Qualified" />
          </div>
        </div>
      );
    }

    if (tabKey === "saleSources") {
      return (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Source Name *</label>
            <Input value={formData.name || ""} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Walk In" />
          </div>
        </div>
      );
    }

    if (tabKey === "salePropertyTypes") {
      return (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Property Type *</label>
            <Input value={formData.name || ""} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Apartment" />
          </div>
        </div>
      );
    }

    // expenses and any other future tabs
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
          <AppSelect
            label="Category"
            value={formData.category || "other"}
            onChange={(v) => setFormData((prev) => ({ ...prev, category: v ?? "other" }))}
            options={[
              { value: "maintenance", label: "Maintenance" },
              { value: "utilities", label: "Utilities" },
              { value: "staffing", label: "Staffing" },
              { value: "supplies", label: "Supplies" },
              { value: "other", label: "Other" },
            ]}
            size="md"
          />
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
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">

          {/* Header */}
          <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FaCog className="text-sm text-[#B7C9C0]" />
                <div>
                  <h1 className="text-[12px] font-bold uppercase tracking-wide text-white">Operational Settings</h1>
                  <p className="mt-0.5 text-[10px] text-[#B7C9C0]">Reusable defaults — changes here do not affect posted financial history.</p>
                </div>
              </div>
              <button
                onClick={() => navigate("/company-setup")}
                className="inline-flex h-7 items-center gap-1.5 border border-[#2A5C4A] px-3 text-[11px] font-bold text-white hover:bg-[#0A3127]"
              >
                Company Setup <FaArrowRight size={10} />
              </button>
            </div>
          </div>

          {/* Body: sidebar + content */}
          <div className="flex min-h-0 flex-1 overflow-hidden">

            {/* Left sidebar nav */}
            <div className="w-48 flex-shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50">
              {SIDEBAR_GROUPS.map((group) => {
                const visibleItems = group.items.filter((k) => visibleTabKeys.has(k));
                if (visibleItems.length === 0) return null;
                return (
                  <div key={group.label} className="py-2">
                    <p className="px-3 pb-1 pt-0.5 text-[9px] font-black uppercase tracking-widest text-slate-400">{group.label}</p>
                    {visibleItems.map((key) => {
                      const tab = TAB_CONFIG[key];
                      const Icon = tab.icon;
                      const isActive = key === activeTab;
                      return (
                        <button
                          key={key}
                          onClick={() => switchTab(key)}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-bold transition ${
                            isActive
                              ? "bg-[#0B3B2E] text-white"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
                          }`}
                        >
                          <Icon size={10} className="shrink-0" />
                          <span className="flex-1 truncate">{tab.label}</span>
                          {!["tax", "accounting", "autoInvoicing", "incomeRules", "penaltyRules", "saleCommDefaults", "invPOSSettings", "cwOperations", "cwSMS"].includes(key) && (
                            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${isActive ? "bg-white/20 text-white" : "bg-slate-200 text-slate-500"}`}>
                              {activeCounts[key] ?? 0}
                            </span>
                          )}
                          {key === "autoInvoicing" && (
                            <span className={`px-1.5 py-0.5 text-[9px] font-bold ${autoInvoicing.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                              {autoInvoicing.enabled ? "ON" : "OFF"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Content area */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {loading ? (
                <div className="flex h-40 items-center justify-center gap-2 text-sm text-slate-500">
                  <Spinner size="sm" /> Loading...
                </div>
              ) : activeTab === "accounting" ? (
                <div className="flex-1 overflow-auto px-4 py-4">{renderAccountingTab()}</div>
              ) : activeTab === "tax" ? (
                <div className="flex-1 overflow-auto px-4 py-4">{renderTaxTab()}</div>
              ) : activeTab === "autoInvoicing" ? (
                <div className="flex-1 overflow-auto px-4 py-4">{renderAutoInvoicingTab()}</div>
              ) : activeTab === "incomeRules" ? (
                <div className="flex-1 overflow-auto px-4 py-4">{renderIncomeRulesTab()}</div>
              ) : activeTab === "penaltyRules" ? (
                renderPenaltyRulesTab()
              ) : activeTab === "saleCommDefaults" ? (
                <div className="flex-1 overflow-auto px-4 py-4">{renderSaleCommDefaultsTab()}</div>
              ) : activeTab === "invPOSSettings" ? (
                <div className="flex-1 overflow-auto px-4 py-4">{renderInvPOSTab()}</div>
              ) : activeTab === "cwOperations" ? (
                <div className="flex-1 overflow-auto px-4 py-4">{renderCWOperationsTab()}</div>
              ) : activeTab === "cwSMS" ? (
                <div className="flex-1 overflow-auto px-4 py-4">{renderCWSMSTab()}</div>
              ) : activeTab === "terminology" ? (
                <div className="flex-1 overflow-auto px-4 py-4">
                  <TerminologyPanel currentCompany={currentCompany} />
                </div>
              ) : (
                renderCollectionTab(activeTab)
              )}
            </div>

          </div>

        </div>
      </div>

      {showModal && (
        <Modal
          onClose={closeModal}
          title={editingItem?._id ? `Edit ${TAB_CONFIG[modalTab]?.singularLabel || TAB_CONFIG[modalTab].label.replace(/ies$/, "y").replace(/s$/, "")}` : `Add ${TAB_CONFIG[modalTab]?.singularLabel || TAB_CONFIG[modalTab].label.replace(/ies$/, "y").replace(/s$/, "")}`}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <ActionButton onClick={closeModal}>
                <FaTimes /> Cancel
              </ActionButton>
              <ActionButton variant="primary" onClick={saveItem} disabled={saving}>
                {saving ? <Spinner size="sm" /> : <FaSave />}
                {saving ? "Saving..." : editingItem?._id ? "Update" : "Save"}
              </ActionButton>
            </div>
          }
        >
          {renderModalBody()}
        </Modal>
      )}

      {showPenaltyRuleModal ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-black uppercase tracking-wide">
                {editingPenaltyRuleId ? "Edit late penalty rule" : "Add late penalty rule"}
              </h2>
              <button
                onClick={() => !savingPenaltyRule && setShowPenaltyRuleModal(false)}
                className="text-white/70 transition-colors hover:text-white"
                type="button"
              >
                <FaTimes />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 py-4">
              <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-2 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">Grace days</p>
                  <p className="mt-1">Days allowed after due date before penalty counting begins.</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">Minimum overdue days</p>
                  <p className="mt-1">Extra threshold after grace. The row must still reach this number to qualify.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">Posting account</p>
                  <p className="mt-1">This is the income ledger the late penalty invoice will credit.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <label className={labelClass}>Rule name</label>
                    <input
                      className={inputClass}
                      value={penaltyRuleForm.ruleName}
                      onChange={(e) => setPenaltyRuleForm((prev) => ({ ...prev, ruleName: e.target.value }))}
                      placeholder="Example: Standard monthly arrears penalty"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Effective from</label>
                      <input
                        type="date"
                        className={inputClass}
                        value={penaltyRuleForm.effectiveFrom}
                        onChange={(e) => setPenaltyRuleForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Posting account</label>
                      <AppSelect
                        value={penaltyRuleForm.postingAccount}
                        onChange={(v) => setPenaltyRuleForm((prev) => ({ ...prev, postingAccount: v ?? "" }))}
                        options={penaltyAccountOptions}
                        placeholder="Select account"
                        searchable
                        clearable
                        size="md"
                        className="w-full"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Grace days</label>
                      <input
                        type="number"
                        min="0"
                        className={inputClass}
                        value={penaltyRuleForm.graceDays}
                        onChange={(e) => setPenaltyRuleForm((prev) => ({ ...prev, graceDays: Number(e.target.value || 0) }))}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Min overdue days</label>
                      <input
                        type="number"
                        min="0"
                        className={inputClass}
                        value={penaltyRuleForm.minimumOverdueDays}
                        onChange={(e) => setPenaltyRuleForm((prev) => ({ ...prev, minimumOverdueDays: Number(e.target.value || 0) }))}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Penalize item</label>
                    <AppSelect
                      value={penaltyRuleForm.penalizeItem}
                      onChange={(v) => setPenaltyRuleForm((prev) => ({ ...prev, penalizeItem: v ?? "outstanding_invoice_balance" }))}
                      options={PENALIZE_ITEM_OPTIONS}
                      size="md"
                      className="w-full"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Calculation type</label>
                      <AppSelect
                        value={penaltyRuleForm.calculationType}
                        onChange={(v) => setPenaltyRuleForm((prev) => ({ ...prev, calculationType: v ?? "percentage_overdue_balance" }))}
                        options={CALCULATION_TYPE_OPTIONS}
                        size="md"
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Rate / amount</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputClass}
                        value={penaltyRuleForm.rateOrAmount}
                        onChange={(e) => setPenaltyRuleForm((prev) => ({ ...prev, rateOrAmount: Number(e.target.value || 0) }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelClass}>Min balance</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputClass}
                        value={penaltyRuleForm.minimumBalance}
                        onChange={(e) => setPenaltyRuleForm((prev) => ({ ...prev, minimumBalance: Number(e.target.value || 0) }))}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Max balance</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputClass}
                        value={penaltyRuleForm.maximumBalance}
                        onChange={(e) => setPenaltyRuleForm((prev) => ({ ...prev, maximumBalance: Number(e.target.value || 0) }))}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Penalty cap</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputClass}
                        value={penaltyRuleForm.maximumPenaltyCap}
                        onChange={(e) => setPenaltyRuleForm((prev) => ({ ...prev, maximumPenaltyCap: Number(e.target.value || 0) }))}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Repeat frequency</label>
                    <AppSelect
                      value={penaltyRuleForm.repeatFrequency}
                      onChange={(v) => setPenaltyRuleForm((prev) => ({ ...prev, repeatFrequency: v ?? "manual" }))}
                      options={REPEAT_FREQUENCY_OPTIONS}
                      size="md"
                      className="w-full"
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <label className={labelClass}>Notes</label>
                    <textarea
                      rows={8}
                      className={`${inputClass} min-h-[180px]`}
                      value={penaltyRuleForm.notes}
                      onChange={(e) => setPenaltyRuleForm((prev) => ({ ...prev, notes: e.target.value }))}
                      placeholder="Optional internal guidance for the team."
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setShowPenaltyRuleModal(false)}
                className="inline-flex items-center gap-2 border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <FaTimes /> Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePenaltyRule}
                disabled={savingPenaltyRule}
                className="inline-flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FaSave /> {savingPenaltyRule ? "Saving..." : editingPenaltyRuleId ? "Update Rule" : "Save Rule"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
};

export default CompanySettings;

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllProperties,
  selectAllTenants,
  selectAllUnits,
  selectAllLeases,
  selectTenantPagination,
} from "../../redux/selectors";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaPlus,
  FaCheck,
  FaSearch,
  FaChevronDown,
  FaChevronLeft,
  FaChevronRight,
  FaExpandAlt,
  FaCompressAlt,
  FaFileExport,
  FaRedoAlt,
  FaEdit,
  FaEllipsisV,
  FaFileInvoiceDollar,
  FaUserEdit,
  FaBolt,
  FaChartLine,
  FaMoneyBillWave,
  FaTrash,
  FaSpinner,
  FaDownload,
  FaPrint,
  FaSms,
  FaExchangeAlt,
  FaUserSlash,
  FaTimes,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getTenants, deleteTenant, updateTenant } from "../../redux/tenantsRedux";
import { getUnits } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import TenantsImportModal from "../../components/Modals/TenantsImportModal";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import {
  downloadTenantsTemplate,
  exportTenantsToExcel,
} from "../../utils/excelTemplates";
import { adminRequests } from "../../utils/requestMethods";
import { printTabularList } from "../../utils/printList";
import {
  createPaymentVoucher,
  createRentPayment,
  createTenantInvoice,
  createTenantInvoiceNote,
  getChartOfAccounts,
  getCreditableTenantInvoices,
  getLeases,
  getTenantInvoices,
} from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";
import { LISTING_UI, normalizeUppercaseInput, toListingCaps } from "../../utils/listingPageUtils";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const DEFAULT_PAGE_SIZE = 50;
const fmtKES = (n) => Number(n || 0).toLocaleString("en-KE");

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const isActiveInvoice = (invoice) => {
  const status = String(invoice?.status || "").toLowerCase();
  return status !== "cancelled" && status !== "reversed";
};

const roundMoney = (value) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
};

const normalizeDepositHolder = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["landlord", "owner", "self_managed_landlord"].includes(normalized)) return "Landlord";
  return "Management Company";
};

const isCashbookLikeAccount = (account = {}) => {
  const haystack = `${account?.name || ""} ${account?.accountName || ""} ${account?.group || ""} ${account?.subGroup || ""}`.toLowerCase();
  const type = String(account?.type || account?.accountType || "").toLowerCase();
  return type === "asset" && /cash|bank|m-?pesa|mobile|wallet|petty|till|collection/.test(haystack);
};

const pickDepositLiabilityAccount = (accounts = []) => {
  return (Array.isArray(accounts) ? accounts : []).find((account) => {
    const haystack = `${account?.name || ""} ${account?.accountName || ""} ${account?.group || ""} ${account?.subGroup || ""}`.toLowerCase();
    const type = String(account?.type || account?.accountType || "").toLowerCase();
    return type === "liability" && /deposit/.test(haystack);
  }) || null;
};



const getTenantUnitLabel = (tenant = {}) => {
  const primary = tenant?.unit?.unitNumber || tenant?.unit?.unitName || tenant?.unit?.name || tenant?.unitNumber || "";
  const additional = Array.isArray(tenant?.additionalUnits)
    ? tenant.additionalUnits
        .map((unit) => unit?.unitNumber || unit?.unitName || unit?.name || "")
        .filter(Boolean)
    : [];
  const labels = [primary, ...additional].filter(Boolean);
  return labels.length ? labels.join(", ") : "-";
};

const computeOperationalStatus = ({ tenant }) => {
  const currentStatus = String(tenant?.status || "active").toLowerCase();

  if (["terminated", "moved_out"].includes(currentStatus)) {
    return "terminated";
  }

  if (["inactive", "evicted"].includes(currentStatus)) {
    return currentStatus;
  }

  return "active";
};

const EXPIRY_WARNING_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const getDaysUntil = (value) => {
  if (!value) return null;
  const targetDate = new Date(value);
  if (Number.isNaN(targetDate.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);

  return Math.ceil((targetDate.getTime() - today.getTime()) / ONE_DAY_MS);
};

const formatWarningDate = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString();
};

const buildExpiryWarning = ({ tenant = {}, lease = null } = {}) => {
  const messages = [];
  const normalizedLeaseType = String(lease?.leaseType || tenant?.leaseType || "").toLowerCase();
  const normalizedLeaseStatus = String(lease?.status || "active").toLowerCase();

  const leaseEndDate = lease?.endDate || null;
  const leaseDaysRemaining = getDaysUntil(leaseEndDate);
  const hasLeaseWarning =
    normalizedLeaseType === "fixed" &&
    normalizedLeaseStatus === "active" &&
    leaseDaysRemaining !== null &&
    leaseDaysRemaining <= EXPIRY_WARNING_DAYS;

  if (hasLeaseWarning) {
    if (leaseDaysRemaining < 0) {
      messages.push(`Lease expired ${Math.abs(leaseDaysRemaining)} day${Math.abs(leaseDaysRemaining) === 1 ? "" : "s"} ago (${formatWarningDate(leaseEndDate)})`);
    } else {
      messages.push(`Lease expires in ${leaseDaysRemaining} day${leaseDaysRemaining === 1 ? "" : "s"} (${formatWarningDate(leaseEndDate)})`);
    }
  }

  const billingEndDate = tenant?.moveOutDate || null;
  const billingDaysRemaining = getDaysUntil(billingEndDate);
  const hasBillingWarning =
    billingDaysRemaining !== null &&
    billingDaysRemaining <= EXPIRY_WARNING_DAYS;

  if (hasBillingWarning) {
    if (billingDaysRemaining < 0) {
      messages.push(`Billing schedule expired ${Math.abs(billingDaysRemaining)} day${Math.abs(billingDaysRemaining) === 1 ? "" : "s"} ago (${formatWarningDate(billingEndDate)})`);
    } else {
      messages.push(`Billing schedule ends in ${billingDaysRemaining} day${billingDaysRemaining === 1 ? "" : "s"} (${formatWarningDate(billingEndDate)})`);
    }
  }

  return {
    hasWarning: messages.length > 0,
    isLeaseWarning: hasLeaseWarning,
    isBillingWarning: hasBillingWarning,
    leaseDaysRemaining,
    billingDaysRemaining,
    summary: messages.join(" • "),
  };
};

// ─── Utility helpers (mirrors AddTenant.jsx) ──────────────────────────────────
const normalizeUtilityEntry = (util = {}) => {
  let utilityLabel = "Unknown Utility";
  let utilityValue = "";
  if (util.utility && typeof util.utility === "object" && !Array.isArray(util.utility)) {
    utilityValue = util.utility._id || util.utility.name || util.utility.utilityName || "";
    utilityLabel = util.utility.name || util.utility.utilityName || "Unknown Utility";
  } else if (typeof util.utility === "string" && util.utility.trim() !== "") {
    utilityValue = util.utility.trim();
    utilityLabel = util.utilityLabel || util.utility.trim();
  } else if (typeof util.utilityLabel === "string" && util.utilityLabel.trim() !== "") {
    utilityLabel = util.utilityLabel.trim();
  }
  return { utility: utilityValue, utilityLabel, isIncluded: !!util.isIncluded, unitCharge: Number(util.unitCharge || 0) };
};

const buildUtilitySignature = (item = {}) =>
  [String(item.utility || "").trim().toLowerCase(), String(item.utilityLabel || "").trim().toLowerCase(),
    Number(item.unitCharge || 0).toFixed(2), item.isIncluded ? "1" : "0"].join("|");

const mergeUtilityEntries = (utilities = []) => {
  const merged = new Map();
  (Array.isArray(utilities) ? utilities : []).forEach((entry) => {
    const n = normalizeUtilityEntry(entry);
    const v = String(n.utility || n.utilityLabel || "").trim();
    const l = String(n.utilityLabel || v || "").trim();
    if (!v && !l) return;
    const sig = [v.toLowerCase(), l.toLowerCase(), n.isIncluded ? "1" : "0"].join("|");
    const cur = merged.get(sig) || { utility: v || l, utilityLabel: l || v, unitCharge: 0, isIncluded: n.isIncluded };
    cur.unitCharge = Number(cur.unitCharge || 0) + Number(n.unitCharge || 0);
    if (!cur.utility && v) cur.utility = v;
    if (!cur.utilityLabel && l) cur.utilityLabel = l;
    merged.set(sig, cur);
  });
  return Array.from(merged.values()).map((item) => ({
    utility: item.utility || item.utilityLabel || "",
    utilityLabel: item.utilityLabel || item.utility || "",
    unitCharge: Number(item.unitCharge || 0),
    isIncluded: !!item.isIncluded,
  }));
};

const buildUtilitiesPayload = ({ inheritedUtilities = [], customUtilities = [] } = {}) =>
  mergeUtilityEntries([
    ...(Array.isArray(inheritedUtilities) ? inheritedUtilities : []),
    ...(Array.isArray(customUtilities) ? customUtilities : []).map((item) => ({
      utility: String(item?.utility || item?.utilityLabel || "").trim(),
      utilityLabel: String(item?.utilityLabel || item?.utility || "").trim(),
      unitCharge: Number(item?.unitCharge || 0),
      isIncluded: !!item?.isIncluded,
    })),
  ]);

const STANDARD_UTILITY_OPTIONS = ["Water", "Garbage", "Electricity", "Service Charge", "Security", "Others"];

// Derives additional utilities for a tenant (those not inherited from its units)
const deriveAdditionalUtilities = (tenant, tenantUnitUtils) => {
  const tenantUtils = (tenant?.utilities || []).map(normalizeUtilityEntry);
  const counts = tenantUnitUtils.reduce((map, item) => {
    const sig = buildUtilitySignature(item);
    map.set(sig, (map.get(sig) || 0) + 1);
    return map;
  }, new Map());
  const additional = [];
  tenantUtils.forEach((item) => {
    const sig = buildUtilitySignature(item);
    const count = counts.get(sig) || 0;
    if (count > 0) counts.set(sig, count - 1);
    else additional.push({ utility: item.utility || item.utilityLabel, utilityLabel: item.utilityLabel || item.utility, unitCharge: String(item.unitCharge || ""), isIncluded: item.isIncluded });
  });
  return additional;
};

const getTenantUnitUtils = (tenant, allUnits) => {
  const unitIds = [normalizeId(tenant?.unit?._id || tenant?.unit), ...(Array.isArray(tenant?.additionalUnits) ? tenant.additionalUnits : []).map((u) => normalizeId(u?._id || u))].filter(Boolean);
  const recs = (Array.isArray(allUnits) ? allUnits : []).filter((u) => unitIds.includes(normalizeId(u?._id)));
  return mergeUtilityEntries(recs.flatMap((u) => (u?.utilities || []).map(normalizeUtilityEntry)));
};

// ─── Add Utility Modal ────────────────────────────────────────────────────────
function AddUtilityModal({ tenants, allUnits, company, dispatch, onClose, onSaved }) {
  const isMulti = tenants.length > 1;
  const singleTenant = isMulti ? null : tenants[0];

  const [utilityOptions, setUtilityOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Single-tenant: inherited unit utilities shown read-only
  const singleUnitUtils = useMemo(() =>
    singleTenant ? getTenantUnitUtils(singleTenant, allUnits) : [],
  [singleTenant, allUnits]);

  // Single-tenant: start with their existing additional rows + one empty; multi: just one empty
  const [rows, setRows] = useState(() => {
    if (!isMulti && singleTenant) {
      const existing = deriveAdditionalUtilities(singleTenant, singleUnitUtils);
      return [...existing, { utility: "", utilityLabel: "", unitCharge: "", isIncluded: false }];
    }
    return [{ utility: "", utilityLabel: "", unitCharge: "", isIncluded: false }];
  });

  useEffect(() => {
    if (!company?._id) return;
    adminRequests.get(`/company-settings/${company._id}`)
      .then((res) => {
        const names = Array.from(new Set(
          (res?.data?.utilityTypes || []).filter((item) => item?.isActive !== false && item?.name).map((item) => String(item.name))
        ));
        setUtilityOptions(names);
      })
      .catch(() => setUtilityOptions([]));
  }, [company?._id]);

  const allOptions = useMemo(() => Array.from(new Set([...utilityOptions, ...STANDARD_UTILITY_OPTIONS])), [utilityOptions]);

  const addRow = () => setRows((prev) => [...prev, { utility: "", utilityLabel: "", unitCharge: "", isIncluded: false }]);
  const removeRow = (i) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const updateRow = (i, field, value) => setRows((prev) => {
    const next = [...prev];
    next[i] = { ...next[i], [field]: value };
    if (field === "utility") next[i].utilityLabel = value;
    return next;
  });

  const handleSave = async () => {
    setError("");
    const invalid = rows.find((r) => String(r.unitCharge || "").trim() && !String(r.utility || "").trim());
    if (invalid) { setError("Each utility must have a type selected."); return; }
    const validRows = rows.filter((r) => String(r.utility || "").trim());
    if (validRows.length === 0) { setError("Add at least one utility before saving."); return; }

    setSaving(true);
    let savedCount = 0;
    let failed = 0;
    try {
      for (const tenant of tenants) {
        const unitUtils = getTenantUnitUtils(tenant, allUnits);
        const existingAdditional = deriveAdditionalUtilities(tenant, unitUtils);
        const merged = buildUtilitiesPayload({ inheritedUtilities: unitUtils, customUtilities: [...existingAdditional, ...validRows] });
        try {
          await dispatch(updateTenant({ id: String(tenant._id), tenantData: { utilities: merged } })).unwrap();
          savedCount++;
        } catch {
          failed++;
        }
      }
      if (failed === 0) {
        toast.success(tenants.length === 1 ? "Utilities updated successfully" : `Utilities updated for ${savedCount} tenant${savedCount !== 1 ? "s" : ""}`);
        onSaved();
        onClose();
      } else {
        toast.warning(`Updated ${savedCount} tenant${savedCount !== 1 ? "s" : ""}, ${failed} failed`);
        if (savedCount > 0) { onSaved(); onClose(); }
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between bg-[#0B3B2E] px-5 py-4">
          <div className="flex items-center gap-2.5 text-white">
            <FaBolt size={14} />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">
                {isMulti ? `Adding Utilities — ${tenants.length} Tenants` : "Utilities"}
              </p>
              <h3 className="text-sm font-black leading-tight">
                {isMulti
                  ? tenants.map((t) => t.name || t.tenantCode || "Tenant").join(", ")
                  : <>
                      {singleTenant?.name || "Tenant"}
                      {singleTenant?.tenantCode ? <span className="ml-2 font-normal text-white/60">({singleTenant.tenantCode})</span> : null}
                    </>}
              </h3>
            </div>
          </div>
          <button onClick={onClose} disabled={saving}
            className="flex h-7 w-7 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white transition">
            <FaTimes size={13} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Single-tenant: show inherited unit utilities read-only */}
          {!isMulti && singleUnitUtils.length > 0 && (
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Unit Utilities (Inherited)</p>
              <div className="flex flex-wrap gap-1.5">
                {singleUnitUtils.map((u, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {u.utilityLabel || u.utility}
                    {u.isIncluded
                      ? <span className="ml-1 text-emerald-600">incl.</span>
                      : u.unitCharge > 0 ? <span className="ml-1 text-slate-400">Ksh {fmtKES(u.unitCharge)}</span> : null}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Multi-tenant: show selected tenant chips */}
          {isMulti && (
            <div className="border-b border-slate-100 bg-amber-50 px-5 py-3">
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-amber-600">
                These utilities will be added to all {tenants.length} selected tenants
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tenants.map((t) => (
                  <span key={String(t._id)} className="inline-flex items-center rounded border border-amber-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    {t.name || t.tenantCode}
                    {t.tenantCode && t.name ? <span className="ml-1 text-slate-400">({t.tenantCode})</span> : null}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Utility rows */}
          <div className="space-y-3 px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wide text-slate-700">
                  {isMulti ? "Utilities to Add" : "Additional Utilities"}
                </p>
                <p className="text-[10px] text-slate-400">
                  {isMulti ? "Will be merged into each tenant's existing utilities" : "Utilities beyond the unit's defaults"}
                </p>
              </div>
              <button type="button" onClick={addRow}
                className="flex h-7 items-center gap-1.5 rounded bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700">
                <FaPlus size={9} /> Add Utility
              </button>
            </div>

            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm font-medium text-indigo-400">No utilities added yet</p>
            ) : (
              <div className="space-y-2">
                {rows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_120px_auto_auto] items-end gap-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Utility Type</label>
                      <select
                        value={row.utility}
                        onChange={(e) => updateRow(idx, "utility", e.target.value)}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
                      >
                        <option value="">Select type…</option>
                        {allOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Charge (Ksh)</label>
                      <input
                        type="number" min="0" step="0.01" placeholder="0.00"
                        value={row.unitCharge}
                        onChange={(e) => updateRow(idx, "unitCharge", e.target.value)}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
                      />
                    </div>
                    <div className="flex h-8 items-center gap-1.5 pb-0.5">
                      <input
                        type="checkbox" id={`util-incl-${idx}`}
                        checked={!!row.isIncluded}
                        onChange={(e) => updateRow(idx, "isIncluded", e.target.checked)}
                        className="rounded border-slate-300 text-[#0B3B2E]"
                      />
                      <label htmlFor={`util-incl-${idx}`} className="whitespace-nowrap text-[10px] font-semibold text-slate-600">Incl. in rent</label>
                    </div>
                    <button type="button" onClick={() => removeRow(idx)}
                      className="flex h-8 w-8 items-center justify-center rounded border border-red-200 bg-red-50 text-red-600 hover:bg-red-100">
                      <FaTrash size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="text-xs font-medium text-red-600">{error}</p>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button onClick={onClose} disabled={saving}
            className="h-8 rounded border border-slate-300 px-4 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex h-8 items-center gap-1.5 rounded bg-[#0B3B2E] px-5 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-60">
            {saving
              ? <><FaSpinner size={10} className="animate-spin" /> Saving…</>
              : isMulti ? `Save to ${tenants.length} Tenants` : "Save Utilities"}
          </button>
        </div>
      </div>
    </div>
  );
}

const Tenants = ({ listingMode = "active" }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Redux state
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const tenantsData = useSelector(selectAllTenants);
  const units = useSelector(selectAllUnits);
  const properties = useSelector(selectAllProperties);
  const leases = useSelector(selectAllLeases);

  const tenantPagination = useSelector(selectTenantPagination);
  const isFetchingTenants = useSelector((state) => state.tenant?.isFetching ?? false);

  const canViewTenants = hasCompanyPermission(currentUser || {}, currentCompany, "tenants", "view", "propertyManagement");
  const canCreateTenant = hasCompanyPermission(currentUser || {}, currentCompany, "tenants", "create", "propertyManagement");
  const canUpdateTenant = hasCompanyPermission(currentUser || {}, currentCompany, "tenants", "update", "propertyManagement");
  const canDeleteTenant = hasCompanyPermission(currentUser || {}, currentCompany, "tenants", "delete", "propertyManagement");

  const isTerminatedView = listingMode === "terminated";
  const tenantStatusQuery = isTerminatedView ? "terminated" : undefined;
  const defaultStatusFilter = isTerminatedView ? "terminated" : "active";

  // ===== UI STATE =====
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedTenants, setExpandedTenants] = useState([]);
  const [selectedTenants, setSelectedTenants] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const actionMenuRef = useRef(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCommunicationModal, setShowCommunicationModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showAddUtilityModal, setShowAddUtilityModal] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
const [transferForm, setTransferForm] = useState({ tenantId: "", newUnit: "", effectiveDate: "", reason: "", filterProperty: "", filterSearch: "", depositTopUp: 0, depositTopUpDueDate: "", reduceDeposit: false });
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [isTerminating, setIsTerminating] = useState(false);
  const [terminationForm, setTerminationForm] = useState({ tenantId: "", effectiveDate: "", reason: "" });
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreForm, setRestoreForm] = useState({ tenantId: "", notes: "" });
  const [invoiceRefreshTick, setInvoiceRefreshTick] = useState(0);
  // Loaded per-tenant when deposit settlement modal opens
  const [tenantInvoices, setTenantInvoices] = useState([]);

  const [showDepositSettlementModal, setShowDepositSettlementModal] = useState(false);
  const [depositSettlementTenantId, setDepositSettlementTenantId] = useState("");
  const [depositSettlementAction, setDepositSettlementAction] = useState("apply");
  const [depositSettlementForm, setDepositSettlementForm] = useState({
    retainAmount: "",
    refundAmount: "",
    reason: "",
    cashbookAccountId: "",
  });
  const [depositSettlementContext, setDepositSettlementContext] = useState({
    creditableInvoices: [],
    chartAccounts: [],
    loading: false,
  });
  const [isProcessingDepositSettlement, setIsProcessingDepositSettlement] = useState(false);

  // ===== FILTERS =====
  const [draftFilters, setDraftFilters] = useState({
    property: "any",
    status: defaultStatusFilter,
    balanceScope: "any",
    search: "",
    tenantName: "",
    tenantCode: "",
  });
  const [appliedFilters, setAppliedFilters] = useState({
    property: "any",
    status: defaultStatusFilter,
    balanceScope: "any",
    search: "",
    tenantName: "",
    tenantCode: "",
  });

  // ===== EFFECTS =====
  const propertyIdByName = useMemo(() => {
    const m = new Map();
    for (const p of properties) {
      const name = p.propertyName || p.name;
      if (name) m.set(name, String(p._id));
    }
    return m;
  }, [properties]);

  // Ref keeps the Map current without making buildTenantParams re-create on every
  // properties refetch (which would trigger a redundant getTenants dispatch).
  const propertyIdByNameRef = useRef(propertyIdByName);
  propertyIdByNameRef.current = propertyIdByName;

  const buildTenantParams = useCallback((overridePage) => {
    const page = overridePage ?? currentPage;
    return {
      business: currentCompany?._id,
      page,
      limit: pageSize,
      ...(tenantStatusQuery ? { status: tenantStatusQuery } : appliedFilters.status !== "any" ? { status: appliedFilters.status } : {}),
      ...(appliedFilters.search ? { search: appliedFilters.search } : {}),
      ...(appliedFilters.tenantName ? { tenantName: appliedFilters.tenantName } : {}),
      ...(appliedFilters.tenantCode ? { tenantCode: appliedFilters.tenantCode } : {}),
      ...(appliedFilters.property !== "any" && propertyIdByNameRef.current.get(appliedFilters.property)
        ? { property: propertyIdByNameRef.current.get(appliedFilters.property) }
        : {}),
    };
  }, [currentCompany?._id, currentPage, pageSize, tenantStatusQuery, appliedFilters]);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getUnits({ business: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));
    getLeases(dispatch, currentCompany._id, "active").catch((error) => {
      console.error("Failed to load leases:", error);
    });
  }, [dispatch, currentCompany?._id]);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getTenants(buildTenantParams()));
  }, [dispatch, buildTenantParams, currentCompany?._id]);

  useEffect(() => {
    setSelectAll(false);
  }, [currentPage]);

  const lastPassiveRefreshRef = useRef(0);

  useEffect(() => {
    // invoicesUpdated is an explicit in-app signal — always refresh immediately
    const handleInvoiceChange = () => {
      setInvoiceRefreshTick((prev) => prev + 1);
    };

    // storage/focus/visibilitychange can all fire in quick succession on a single
    // tab switch (e.g. both focus and visibilitychange fire together). Debounce
    // to at most once per 5 seconds to avoid redundant fetches.
    const handlePassiveChange = () => {
      const now = Date.now();
      if (now - lastPassiveRefreshRef.current < 5000) return;
      lastPassiveRefreshRef.current = now;
      setInvoiceRefreshTick((prev) => prev + 1);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") handlePassiveChange();
    };

    window.addEventListener("invoicesUpdated", handleInvoiceChange);
    window.addEventListener("storage", handlePassiveChange);
    window.addEventListener("focus", handlePassiveChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("invoicesUpdated", handleInvoiceChange);
      window.removeEventListener("storage", handlePassiveChange);
      window.removeEventListener("focus", handlePassiveChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!actionMenuRef.current) return;
      if (!actionMenuRef.current.contains(e.target)) setActionMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const refreshTenants = useCallback(() => {
    if (!currentCompany?._id) return;
    dispatch(getTenants(buildTenantParams()));
  }, [currentCompany?._id, dispatch, buildTenantParams]);

  useEffect(() => {
    if (invoiceRefreshTick > 0) refreshTenants();
  }, [invoiceRefreshTick, refreshTenants]);

  // ===== TRANSFORM TENANT DATA =====
  const resolveTenantPropertyName = (tenant, unitsFromStore = [], propertiesFromStore = []) => {
    const directPropertyName =
      tenant?.unit?.property?.propertyName ||
      tenant?.property?.propertyName ||
      tenant?.propertyName;
    if (directPropertyName) return directPropertyName;

    const tenantUnitId = tenant?.unit?._id || tenant?.unit;
    const matchedUnit = unitsFromStore.find(
      (unit) => normalizeId(unit?._id) === normalizeId(tenantUnitId)
    );
    const propertyIdFromUnit = matchedUnit?.property?._id || matchedUnit?.property;

    const propertyIdFromTenant = tenant?.property?._id || tenant?.property;
    const resolvedPropertyId = propertyIdFromUnit || propertyIdFromTenant;
    const matchedProperty = propertiesFromStore.find(
      (property) => normalizeId(property?._id) === normalizeId(resolvedPropertyId)
    );

    return (
      matchedUnit?.property?.propertyName ||
      matchedProperty?.propertyName ||
      matchedProperty?.name ||
      "-"
    );
  };


  const { leaseByTenantId, leaseCountByTenant } = useMemo(() => {
    const byId = new Map();
    const countById = new Map();
    for (const lease of (Array.isArray(leases) ? leases : [])) {
      const tenantId = normalizeId(lease?.tenant?._id || lease?.tenant);
      if (!tenantId) continue;

      countById.set(tenantId, (countById.get(tenantId) || 0) + 1);

      const current = byId.get(tenantId);
      if (!current) {
        byId.set(tenantId, lease);
      } else {
        const currentScore = String(current?.status || "").toLowerCase() === "active" ? 1 : 0;
        const nextScore    = String(lease?.status    || "").toLowerCase() === "active" ? 1 : 0;
        if (nextScore > currentScore) {
          byId.set(tenantId, lease);
        } else {
          const currentEnd = new Date(current?.endDate || 0).getTime();
          const nextEnd    = new Date(lease?.endDate   || 0).getTime();
          if (nextEnd > currentEnd) byId.set(tenantId, lease);
        }
      }
    }
    return { leaseByTenantId: byId, leaseCountByTenant: countById };
  }, [leases]);

  // Transfer modal — expensive computations gated on modal being open
  const transferBase = useMemo(() => {
    if (!showTransferModal || !transferForm.tenantId) return null;
    const rawTenant = (Array.isArray(tenantsData) ? tenantsData : []).find((t) => normalizeId(t._id) === transferForm.tenantId) || null;
    const currentDeposit = Number(rawTenant?.depositAmount || 0);
    const currentRent = Number(rawTenant?.rent || 0);
    const currentUnitId = normalizeId(rawTenant?.unit?._id || rawTenant?.unit);
    const currentUnitDoc = (Array.isArray(units) ? units : []).find((u) => normalizeId(u._id) === currentUnitId) || null;
    const currentPropertyName = currentUnitDoc?.property?.propertyName || rawTenant?.unit?.property?.propertyName || "-";
    const occupiedUnitIds = new Set([
      currentUnitId,
      ...((Array.isArray(rawTenant?.additionalUnits) ? rawTenant.additionalUnits : []).map((u) => normalizeId(u?._id || u))),
    ].filter(Boolean));
    const allVacantUnits = (Array.isArray(units) ? units : []).filter((u) => {
      const id = normalizeId(u?._id);
      if (!id || occupiedUnitIds.has(id)) return false;
      return String(u?.status || "").toLowerCase() === "vacant" && u?.isVacant !== false;
    });
    const uniqueProperties = Array.from(
      new Map(allVacantUnits.map((u) => {
        const id = normalizeId(u?.property?._id || u?.property);
        return [id, { id, name: u?.property?.propertyName || "Unknown" }];
      })).values()
    ).sort((a, b) => a.name.localeCompare(b.name));
    return { rawTenant, currentDeposit, currentRent, currentPropertyName, allVacantUnits, uniqueProperties };
  }, [showTransferModal, transferForm.tenantId, tenantsData, units]);

  // Filtered units and destination — re-runs only when filter fields or selected unit change
  const transferFiltered = useMemo(() => {
    if (!transferBase) return { filteredUnits: [], destUnit: null, depositDiff: 0, rentDiff: 0, destPropertyName: "-", destDeposit: 0, destRent: 0 };
    const { allVacantUnits, currentDeposit, currentRent } = transferBase;
    const filteredUnits = allVacantUnits.filter((u) => {
      const propId = normalizeId(u?.property?._id || u?.property);
      if (transferForm.filterProperty && propId !== transferForm.filterProperty) return false;
      if (transferForm.filterSearch && !String(u?.unitNumber || "").toLowerCase().includes(transferForm.filterSearch.toLowerCase())) return false;
      return true;
    });
    const destUnit = allVacantUnits.find((u) => normalizeId(u._id) === transferForm.newUnit) || null;
    const destDeposit = Number(destUnit?.deposit || 0);
    const destRent = Number(destUnit?.rent || 0);
    return { filteredUnits, destUnit, destDeposit, destRent, destPropertyName: destUnit?.property?.propertyName || "-", depositDiff: destDeposit - currentDeposit, rentDiff: destRent - currentRent };
  }, [transferBase, transferForm.filterProperty, transferForm.filterSearch, transferForm.newUnit]);


  const transformedTenants = useMemo(() => {
    return (Array.isArray(tenantsData) ? tenantsData : []).map((tenant) => {
      const tenantId = normalizeId(tenant._id);
      const tenantLease = leaseByTenantId.get(tenantId) || null;
      const resolvedStartDate = tenantLease?.startDate || tenant.moveInDate;
      const resolvedEndDate = tenantLease?.endDate || tenant.moveOutDate;
      const expiryWarning = buildExpiryWarning({ tenant, lease: tenantLease });
      const balance = Number(tenant?.balance || 0);
      const tenantOperationalStatus = computeOperationalStatus({ tenant });
      const leaseCount = leaseCountByTenant.get(tenantId) || 0;
      const invoiceCount = tenant?.invoiceCount ?? 0;
      const invoiceNoteCount = tenant?.invoiceNoteCount ?? 0;
      const paymentCount = tenant?.paymentCount ?? 0;
      const hasBalance = Math.abs(Number(balance || 0)) > 0.009;
      const canTerminate = tenantOperationalStatus === "active";
      const canTransfer = tenantOperationalStatus === "active";
      const canRestore = tenantOperationalStatus === "terminated";
      const canDelete = !hasBalance && leaseCount === 0 && invoiceCount === 0 && invoiceNoteCount === 0 && paymentCount === 0;
      const deleteBlockedReason = hasBalance
        ? "This tenant still has an outstanding balance."
        : leaseCount > 0 || invoiceCount > 0 || invoiceNoteCount > 0 || paymentCount > 0
        ? "This tenant already has historical records and should remain protected."
        : "";

      return {
        id: tenant._id,
        tenantCode: tenant.tenantCode || "-",
        tenantName: tenant.name || "-",
        unitNumber: getTenantUnitLabel(tenant),
        propertyName: resolveTenantPropertyName(tenant, units, properties),
        startDate: resolvedStartDate
          ? new Date(resolvedStartDate).toLocaleDateString()
          : "-",
        endDate: resolvedEndDate
          ? new Date(resolvedEndDate).toLocaleDateString()
          : "-",
        rent: tenant.rent
          ? `Ksh ${Number(tenant.rent).toLocaleString()}`
          : tenant.unit?.rent
          ? `Ksh ${Number(tenant.unit.rent).toLocaleString()}`
          : tenantLease?.rentAmount
          ? `Ksh ${Number(tenantLease.rentAmount).toLocaleString()}`
          : "-",
        balance,
        hasBalance,
        status: tenantOperationalStatus,
        terminationDate: tenant.terminationDate ? new Date(tenant.terminationDate).toLocaleDateString() : "-",
        moveOutDate: tenant.moveOutDate ? new Date(tenant.moveOutDate).toLocaleDateString() : "-",
        terminationReason: tenant.terminationReason || "",
        depositHeld: Number(tenant.depositReceipted ?? 0),
        depositHeldBy: tenant.depositHeldBy || tenant.unit?.property?.depositHeldBy || "Management Company",
        settlementStatus:
          Number(balance || 0) > 0.009
            ? "OWES_BALANCE"
            : Number(balance || 0) < -0.009
            ? "REFUND_DUE"
            : Number(tenant.depositReceipted ?? 0) > 0 && String(tenant.depositRefundStatus || "").toLowerCase() === "pending"
            ? "PENDING_SETTLEMENT"
            : "SETTLED",
        phone: tenant.phone || "-",
        email: tenant.email || "-",
        expiryWarning,
        canDelete,
        canTerminate,
        canTransfer,
        canRestore,
        deleteBlockedReason,
      };
    });
  }, [tenantsData, units, properties, leaseByTenantId, leaseCountByTenant]);

  // ===== FILTER TENANTS =====
  // search/status/tenantName/tenantCode/property are now server-side; only balanceScope remains client-side
  const filteredTenants = useMemo(() => {
    return transformedTenants.filter((t) => {
      if (appliedFilters.balanceScope === "with_balance" && !t.hasBalance) return false;
      return true;
    });
  }, [transformedTenants, appliedFilters.balanceScope]);

  const sortedFilteredTenants = useMemo(() => {
    const sorted = [...filteredTenants];
    sorted.sort((a, b) => {
      const propA = String(a.propertyName || "").toLowerCase();
      const propB = String(b.propertyName || "").toLowerCase();
      if (propA !== propB) return propA.localeCompare(propB);
      return String(a.tenantName || "").localeCompare(String(b.tenantName || ""));
    });
    return sorted;
  }, [filteredTenants]);

  // ===== PAGINATION =====
  const totalPages = Math.max(1, Math.ceil((tenantPagination.total || sortedFilteredTenants.length) / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  // Tenants from server are already the current page; local sort/filter on the page subset
  const currentTenants = sortedFilteredTenants.slice(0, endIndex - startIndex);

  const propertyTenantCounts = useMemo(() => {
    const map = {};
    for (const t of currentTenants) map[t.propertyName] = (map[t.propertyName] || 0) + 1;
    return map;
  }, [currentTenants]);

  const selectedPrimaryTenant = useMemo(
    () => transformedTenants.find((tenant) => tenant.id === selectedTenants[0]) || null,
    [transformedTenants, selectedTenants]
  );

  const selectedPrimaryTenantSource = useMemo(
    () => (Array.isArray(tenantsData) ? tenantsData : []).find((tenant) => normalizeId(tenant?._id) === normalizeId(selectedTenants[0])) || null,
    [tenantsData, selectedTenants]
  );

  const depositSettlementTenant = useMemo(
    () => transformedTenants.find((tenant) => normalizeId(tenant.id) === normalizeId(depositSettlementTenantId)) || null,
    [transformedTenants, depositSettlementTenantId]
  );

  const depositSettlementTenantSource = useMemo(
    () => (Array.isArray(tenantsData) ? tenantsData : []).find((tenant) => normalizeId(tenant?._id) === normalizeId(depositSettlementTenantId)) || null,
    [tenantsData, depositSettlementTenantId]
  );

  const selectedTenantRows = useMemo(
    () => transformedTenants.filter((tenant) => selectedTenants.includes(tenant.id)),
    [transformedTenants, selectedTenants]
  );
  const selectedDeletableTenants = useMemo(
    () => selectedTenantRows.filter((tenant) => tenant.canDelete),
    [selectedTenantRows]
  );

  const depositSettlementDerived = useMemo(() => {
    const tenant = depositSettlementTenant;
    const depositHeld = roundMoney(tenant?.depositHeld || 0);
    const outstandingBalance = roundMoney(Math.max(0, Number(tenant?.balance || 0)));
    const depositHolder = normalizeDepositHolder(tenant?.depositHeldBy || depositSettlementTenantSource?.depositHeldBy || depositSettlementTenantSource?.unit?.property?.depositHeldBy || "");
    const baseApplyAmount = roundMoney(Math.min(depositHeld, outstandingBalance));
    const remainingAfterApply = roundMoney(Math.max(0, depositHeld - baseApplyAmount));
    const requestedRetainAmount = roundMoney(depositSettlementForm.retainAmount || 0);
    const safeRetainAmount = roundMoney(Math.min(Math.max(requestedRetainAmount, 0), remainingAfterApply));
    const requestedRefundAmount = roundMoney(depositSettlementForm.refundAmount || remainingAfterApply || 0);
    const safeRefundAmount = roundMoney(Math.min(Math.max(requestedRefundAmount, 0), remainingAfterApply));
    const finalBalance = roundMoney(
      depositSettlementAction === "retain"
        ? Math.max(0, outstandingBalance - baseApplyAmount)
        : Math.max(0, outstandingBalance - baseApplyAmount)
    );

    return {
      depositHeld,
      outstandingBalance,
      depositHolder,
      baseApplyAmount,
      remainingAfterApply,
      safeRetainAmount,
      safeRefundAmount,
      finalBalance,
      canRefund: depositHolder === "Management Company",
    };
  }, [depositSettlementAction, depositSettlementForm.retainAmount, depositSettlementForm.refundAmount, depositSettlementTenant, depositSettlementTenantSource]);

  const depositLiabilityAccount = useMemo(
    () => pickDepositLiabilityAccount(depositSettlementContext.chartAccounts),
    [depositSettlementContext.chartAccounts]
  );

  const cashbookAccounts = useMemo(
    () => (Array.isArray(depositSettlementContext.chartAccounts) ? depositSettlementContext.chartAccounts : []).filter((account) => isCashbookLikeAccount(account)),
    [depositSettlementContext.chartAccounts]
  );

  const buildAllocationRows = useCallback((invoices = [], requestedAmount = 0) => {
    let remaining = roundMoney(requestedAmount);
    const rows = [];

    for (const invoice of Array.isArray(invoices) ? invoices : []) {
      if (remaining <= 0.009) break;
      const available = roundMoney(invoice?.remainingCreditableAmount ?? invoice?.remainingBalance ?? invoice?.balance ?? 0);
      if (available <= 0.009) continue;
      const appliedAmount = roundMoney(Math.min(available, remaining));
      if (appliedAmount <= 0.009) continue;
      rows.push({
        invoice: invoice?._id,
        appliedAmount,
        amount: appliedAmount,
        invoiceNumber: invoice?.invoiceNumber || "",
        category: invoice?.category || "",
      });
      remaining = roundMoney(remaining - appliedAmount);
    }

    return rows;
  }, []);

  const refreshTenantSettlementData = useCallback(async () => {
    if (!currentCompany?._id) return;
    dispatch(getTenants(buildTenantParams()));
  }, [currentCompany?._id, dispatch, buildTenantParams]);

  const openDepositSettlementModal = useCallback(async (tenantId) => {
    if (!tenantId) return;
    const tenantRow = transformedTenants.find((tenant) => normalizeId(tenant.id) === normalizeId(tenantId));
    setDepositSettlementTenantId(tenantId);
    setDepositSettlementAction(Number(tenantRow?.balance || 0) > 0.009 ? "apply" : "refund");
    setDepositSettlementForm({
      retainAmount: "",
      refundAmount: roundMoney(Math.max(0, Number(tenantRow?.depositHeld || 0) - Math.max(0, Number(tenantRow?.balance || 0)))).toString(),
      reason: "",
      cashbookAccountId: "",
    });
    setShowDepositSettlementModal(true);
    setDepositSettlementContext({ creditableInvoices: [], chartAccounts: [], loading: true });

    try {
      const [creditableInvoices, chartAccounts, allTenantInvoices] = await Promise.all([
        getCreditableTenantInvoices({ business: currentCompany?._id, tenantId }),
        getChartOfAccounts({ business: currentCompany?._id }),
        getTenantInvoices({ business: currentCompany?._id, tenantId }),
      ]);
      setTenantInvoices(Array.isArray(allTenantInvoices) ? allTenantInvoices : []);
      const cashbookAccount = (Array.isArray(chartAccounts) ? chartAccounts : []).find((account) => isCashbookLikeAccount(account));
      setDepositSettlementContext({
        creditableInvoices: Array.isArray(creditableInvoices) ? creditableInvoices : [],
        chartAccounts: Array.isArray(chartAccounts) ? chartAccounts : [],
        loading: false,
      });
      setDepositSettlementForm((prev) => ({
        ...prev,
        cashbookAccountId: prev.cashbookAccountId || normalizeId(cashbookAccount?._id),
      }));
    } catch (error) {
      console.error("Failed to load deposit settlement context:", error);
      setDepositSettlementContext({ creditableInvoices: [], chartAccounts: [], loading: false });
      toast.error(error?.response?.data?.message || error?.response?.data?.error || "Failed to load deposit settlement details.");
    }
  }, [currentCompany?._id, transformedTenants]);

  const closeDepositSettlementModal = useCallback(() => {
    if (isProcessingDepositSettlement) return;
    setShowDepositSettlementModal(false);
    setDepositSettlementTenantId("");
    setDepositSettlementAction("apply");
    setDepositSettlementForm({ retainAmount: "", refundAmount: "", reason: "", cashbookAccountId: "" });
    setDepositSettlementContext({ creditableInvoices: [], chartAccounts: [], loading: false });
  }, [isProcessingDepositSettlement]);

  const updateTenantDepositSnapshot = useCallback(async ({ tenantId, remainingDeposit = 0, refundStatus = null, refundAmount = null, refundReference = "" }) => {
    if (!tenantId) return;
    const payload = {
      depositAmount: roundMoney(Math.max(0, remainingDeposit)),
    };
    if (refundStatus) payload.depositRefundStatus = refundStatus;
    if (refundAmount !== null) payload.depositRefundAmount = roundMoney(refundAmount);
    payload.depositRefundReference = refundReference || "";
    await dispatch(updateTenant({ id: tenantId, tenantData: payload })).unwrap();
  }, [dispatch]);

  const postManagerDepositCreditNotes = useCallback(async ({ tenantId, reason = "", allocations = [] }) => {
    if (!depositLiabilityAccount?._id) {
      throw new Error("Deposit liability account could not be resolved from Chart of Accounts.");
    }
    const notes = [];
    for (const row of allocations) {
      const sourceInvoice = tenantInvoices.find((invoice) => normalizeId(invoice?._id) === normalizeId(row?.invoice)) || row;
      const created = await createTenantInvoiceNote({
        tenant: tenantId,
        sourceInvoice: row.invoice,
        noteType: "CREDIT_NOTE",
        amount: row.appliedAmount,
        category: sourceInvoice?.category,
        chartAccountId: depositLiabilityAccount._id,
        description: reason || `Deposit applied to ${sourceInvoice?.invoiceNumber || "tenant balance"}`,
        metadata: {
          depositSettlement: true,
          depositSettlementType: "apply",
          sourceInvoiceNumber: sourceInvoice?.invoiceNumber || "",
        },
      });
      notes.push(created);
    }
    return notes;
  }, [depositLiabilityAccount?._id, tenantInvoices]);

  const postLandlordHeldDepositReceipt = useCallback(async ({ tenantId, tenantSource, amount, allocations = [], reason = "" }) => {
    if (!tenantSource?._id || !tenantSource?.unit?._id) {
      throw new Error("Tenant unit context is required before posting a landlord-held deposit settlement receipt.");
    }
    return createRentPayment(dispatch, {
      business: currentCompany?._id,
      tenant: tenantSource._id,
      unit: tenantSource.unit._id,
      amount: roundMoney(amount),
      paymentDate: new Date().toISOString().slice(0, 10),
      paidDirectToLandlord: true,
      paymentMethod: "direct_to_landlord",
      paymentType: "deposit",
      allocationMode: "manual",
      allocations: allocations.map((row) => ({ invoice: row.invoice, appliedAmount: roundMoney(row.appliedAmount) })),
      isConfirmed: true,
      reference: `DEPOSIT-SETTLEMENT-${String(tenantId).slice(-6)}`,
      description: reason || "Landlord-held deposit settlement",
      notes: reason || "Landlord-held deposit settlement",
      metadata: {
        depositSettlement: true,
        depositHeldBy: "Landlord",
      },
    });
  }, [currentCompany?._id, dispatch]);

  const processDepositSettlement = useCallback(async () => {
    if (!depositSettlementTenant || !depositSettlementTenantSource) {
      toast.error("Choose a terminated tenant first.");
      return;
    }

    const { depositHeld, outstandingBalance, baseApplyAmount, remainingAfterApply, safeRetainAmount, safeRefundAmount, canRefund, depositHolder } = depositSettlementDerived;

    if (depositSettlementContext.loading) {
      toast.info("Deposit settlement context is still loading.");
      return;
    }

    if (depositSettlementAction === "refund" && !canRefund) {
      toast.warning("Landlord-held deposits cannot be refunded from the manager workspace.");
      return;
    }

    if (["apply", "retain"].includes(depositSettlementAction) && outstandingBalance > 0.009 && !depositLiabilityAccount && depositHolder === "Management Company") {
      toast.error("Deposit liability account not found. Confirm Chart of Accounts first.");
      return;
    }

    setIsProcessingDepositSettlement(true);
    try {
      const allocations = buildAllocationRows(depositSettlementContext.creditableInvoices, baseApplyAmount);
      const appliedAmount = roundMoney(allocations.reduce((sum, row) => sum + Number(row?.appliedAmount || 0), 0));
      let remainingDeposit = roundMoney(depositHeld);
      const settlementRefs = [];

      if (appliedAmount > 0.009) {
        if (depositHolder === "Management Company") {
          const notes = await postManagerDepositCreditNotes({
            tenantId: depositSettlementTenant.id,
            reason: depositSettlementForm.reason || "Deposit applied to tenant arrears",
            allocations,
          });
          settlementRefs.push(...notes.map((row) => row?.noteNumber || row?._id).filter(Boolean));
        } else {
          const receipt = await postLandlordHeldDepositReceipt({
            tenantId: depositSettlementTenant.id,
            tenantSource: depositSettlementTenantSource,
            amount: appliedAmount,
            allocations,
            reason: depositSettlementForm.reason || "Landlord-held deposit applied to arrears",
          });
          settlementRefs.push(receipt?.receiptNumber || receipt?._id || "");
        }
        remainingDeposit = roundMoney(remainingDeposit - appliedAmount);
      }

      if (depositSettlementAction === "retain") {
        if (safeRetainAmount <= 0.009) {
          throw new Error("Enter a valid retain amount.");
        }
        const retainInvoice = await createTenantInvoice({
          business: currentCompany?._id,
          tenant: depositSettlementTenant.id,
          unit: depositSettlementTenantSource?.unit?._id || depositSettlementTenantSource?.unit,
          property: depositSettlementTenantSource?.unit?.property?._id || depositSettlementTenantSource?.unit?.property || depositSettlementTenantSource?.property?._id || depositSettlementTenantSource?.property,
          category: "DEPOSIT_CHARGE",
          amount: safeRetainAmount,
          invoiceDate: new Date().toISOString().slice(0, 10),
          dueDate: new Date().toISOString().slice(0, 10),
          description: depositSettlementForm.reason || "Deposit retention / move-out charge",
          metadata: {
            depositSettlement: true,
            depositSettlementType: "retain",
            depositHeldBy: depositHolder,
          },
        });
        const retainInvoiceId = retainInvoice?._id || retainInvoice?.data?._id;
        const retainInvoiceNumber = retainInvoice?.invoiceNumber || retainInvoice?.data?.invoiceNumber || "";
        if (!retainInvoiceId) {
          throw new Error("Retention invoice was created without a resolvable invoice id.");
        }

        if (depositHolder === "Management Company") {
          const retainNote = await createTenantInvoiceNote({
            tenant: depositSettlementTenant.id,
            sourceInvoice: retainInvoiceId,
            noteType: "CREDIT_NOTE",
            amount: safeRetainAmount,
            category: "DEPOSIT_CHARGE",
            chartAccountId: depositLiabilityAccount?._id,
            description: depositSettlementForm.reason || "Deposit retained against move-out charges",
            metadata: {
              depositSettlement: true,
              depositSettlementType: "retain",
            },
          });
          settlementRefs.push(retainInvoiceNumber || retainInvoiceId, retainNote?.noteNumber || retainNote?._id || "");
        } else {
          const retainReceipt = await postLandlordHeldDepositReceipt({
            tenantId: depositSettlementTenant.id,
            tenantSource: depositSettlementTenantSource,
            amount: safeRetainAmount,
            allocations: [{ invoice: retainInvoiceId, appliedAmount: safeRetainAmount }],
            reason: depositSettlementForm.reason || "Landlord-held deposit retained against move-out charges",
          });
          settlementRefs.push(retainInvoiceNumber || retainInvoiceId, retainReceipt?.receiptNumber || retainReceipt?._id || "");
        }
        remainingDeposit = roundMoney(remainingDeposit - safeRetainAmount);
      }

      if (depositSettlementAction === "refund") {
        if (safeRefundAmount <= 0.009) {
          throw new Error("There is no refundable deposit amount remaining.");
        }
        if (!depositSettlementForm.cashbookAccountId) {
          throw new Error("Choose the cash or bank account used for the refund.");
        }
        const voucher = await createPaymentVoucher({
          business: currentCompany?._id,
          category: "deposit_refund",
          property: depositSettlementTenantSource?.unit?.property?._id || depositSettlementTenantSource?.unit?.property || depositSettlementTenantSource?.property?._id || depositSettlementTenantSource?.property,
          liabilityAccount: depositLiabilityAccount?._id,
          settlementAccount: depositSettlementForm.cashbookAccountId,
          amount: safeRefundAmount,
          dueDate: new Date().toISOString().slice(0, 10),
          paidDate: new Date().toISOString().slice(0, 10),
          status: "paid",
          reference: `TENANT-DEPOSIT-REFUND-${String(depositSettlementTenant.id).slice(-6)}`,
          narration: depositSettlementForm.reason || `Deposit refund for ${depositSettlementTenant.tenantName}`,
        });
        settlementRefs.push(voucher?.voucherNo || voucher?._id || "");
        remainingDeposit = roundMoney(remainingDeposit - safeRefundAmount);
      }

      const nextRefundStatus = remainingDeposit > 0.009 ? "pending" : depositSettlementAction === "refund" ? "paid" : "not_applicable";
      const recordedRefundAmount = depositSettlementAction === "refund" ? safeRefundAmount : remainingDeposit;
      await updateTenantDepositSnapshot({
        tenantId: depositSettlementTenant.id,
        remainingDeposit,
        refundStatus: nextRefundStatus,
        refundAmount: recordedRefundAmount,
        refundReference: settlementRefs.filter(Boolean).join(", "),
      });

      await refreshTenantSettlementData();
      toast.success(
        depositSettlementAction === "retain"
          ? "Deposit retention posted successfully."
          : depositSettlementAction === "refund"
          ? "Deposit refund posted successfully."
          : "Deposit applied successfully."
      );
      closeDepositSettlementModal();
    } catch (error) {
      console.error("Deposit settlement failed:", error);
      toast.error(error?.response?.data?.message || error?.response?.data?.error || error?.message || "Deposit settlement failed.");
    } finally {
      setIsProcessingDepositSettlement(false);
    }
  }, [
    buildAllocationRows,
    closeDepositSettlementModal,
    currentCompany?._id,
    depositLiabilityAccount,
    depositSettlementAction,
    depositSettlementContext.creditableInvoices,
    depositSettlementContext.loading,
    depositSettlementDerived,
    depositSettlementForm.cashbookAccountId,
    depositSettlementForm.reason,
    depositSettlementTenant,
    depositSettlementTenantSource,
    postLandlordHeldDepositReceipt,
    postManagerDepositCreditNotes,
    refreshTenantSettlementData,
    updateTenantDepositSnapshot,
  ]);

  // ===== SELECTION HANDLERS =====
  const handleSelectTenant = (tenantId) => {
    setSelectedTenants((prev) =>
      prev.includes(tenantId)
        ? prev.filter((id) => id !== tenantId)
        : [...prev, tenantId]
    );
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedTenants([]);
      setSelectAll(false);
    } else {
      setSelectedTenants(currentTenants.map((t) => t.id));
      setSelectAll(true);
    }
  };

  const handleCheckboxClick = (e) => {
    e.stopPropagation();
  };

  // ===== EXPAND/COLLAPSE =====
  const toggleTenantExpand = (tenantId) => {
    setExpandedTenants((prev) =>
      prev.includes(tenantId)
        ? prev.filter((id) => id !== tenantId)
        : [...prev, tenantId]
    );
  };

  const expandAllTenants = () => {
    setExpandedTenants(sortedFilteredTenants.map((t) => t.id));
  };

  const collapseAllTenants = () => {
    setExpandedTenants([]);
  };

  // ===== ACTION MENU HANDLERS =====
  const handleViewStatement = () => {
    if (!canViewTenants) {
      toast.warning("You do not have permission to view tenant statements");
      return;
    }
    if (selectedTenants.length === 0) {
      toast.warning("Please select at least one tenant");
      return;
    }
    const selectedTenant = transformedTenants.find((t) => t.id === selectedTenants[0]);
    const firstName = (selectedTenant?.tenantName || "Tenant").split(" ")[0];
    const tabTitle = `${firstName}-${selectedTenant?.tenantCode || "TT0000"}`;

    if (selectedTenants.length === 1) {
      navigate(`/tenant/${selectedTenants[0]}/statement`, { state: { tabTitle } });
    } else {
      toast.info("Multiple tenants selected. Opening first tenant's statement.");
      navigate(`/tenant/${selectedTenants[0]}/statement`, { state: { tabTitle } });
    }
    setActionMenuOpen(false);
  };

  const handleEditTenant = () => {
    if (!canUpdateTenant) {
      toast.warning("You do not have permission to edit tenants");
      return;
    }
    if (selectedTenants.length === 0) {
      toast.warning("Please select a tenant to edit");
      return;
    }
    if (selectedTenants.length > 1) {
      toast.warning("Please select only one tenant to edit");
      return;
    }
    navigate(`/tenant/${selectedTenants[0]}/edit`);
    setActionMenuOpen(false);
  };

  const handleViewReceipts = () => {
    if (!canViewTenants) {
      toast.warning("You do not have permission to view tenant receipts");
      return;
    }
    if (selectedTenants.length === 0) {
      toast.warning("Please select at least one tenant");
      return;
    }
    navigate(`/receipts/${selectedTenants[0]}`);
    setActionMenuOpen(false);
  };


  const handleOpenAgreement = () => {
    if (!canViewTenants) {
      toast.warning("You do not have permission to view tenant agreements");
      return;
    }
    if (selectedTenants.length === 0) {
      toast.warning("Please select one tenant to open the agreement workspace");
      return;
    }
    if (selectedTenants.length > 1) {
      toast.warning("Please select only one tenant to open the agreement workspace");
      return;
    }

    navigate(`/agreements?tenant=${encodeURIComponent(selectedTenants[0])}`);
    setActionMenuOpen(false);
  };

  const handleAddUtility = () => {
    if (!canUpdateTenant) {
      toast.warning("You do not have permission to update tenant utilities");
      return;
    }
    if (selectedTenants.length === 0) {
      toast.warning("Please select at least one tenant to add a utility for");
      return;
    }
    setShowAddUtilityModal(true);
    setActionMenuOpen(false);
  };


const handleTransferUnit = useCallback(() => {
  if (!canUpdateTenant) { toast.warning("You do not have permission to transfer tenant units"); return; }
  if (selectedTenants.length === 0) { toast.warning("Please select one tenant to transfer"); return; }
  if (selectedTenants.length > 1) { toast.warning("Please select only one tenant to transfer"); return; }
  if (!selectedPrimaryTenant?.canTransfer) { toast.warning("Only active tenants can be transferred to another unit."); return; }
  const due = new Date(); due.setDate(due.getDate() + 7);
  setTransferForm({
    tenantId: selectedTenants[0], newUnit: "", effectiveDate: new Date().toISOString().slice(0, 10),
    reason: "", filterProperty: "", filterSearch: "", depositTopUp: 0,
    depositTopUpDueDate: due.toISOString().slice(0, 10), reduceDeposit: false,
  });
  setShowTransferModal(true);
  setActionMenuOpen(false);
}, [canUpdateTenant, selectedTenants, selectedPrimaryTenant]);

const confirmTransferUnit = useCallback(async () => {
  if (!canUpdateTenant) { toast.warning("You do not have permission to transfer tenant units"); return; }
  if (!transferForm.tenantId || !transferForm.newUnit) { toast.error("Choose the destination unit before transferring"); return; }
  const topUp = Number(transferForm.depositTopUp || 0);
  setIsTransferring(true);
  try {
    await adminRequests.post(`/tenants/${transferForm.tenantId}/transfer-unit`, {
      business: currentCompany?._id,
      newUnit: transferForm.newUnit,
      effectiveDate: transferForm.effectiveDate,
      reason: transferForm.reason,
      ...(topUp > 0 && { depositTopUpAmount: topUp }),
      ...(transferForm.reduceDeposit && { reduceDepositToNewUnit: true }),
    });

    if (topUp > 0) {
      const newUnitDoc = transferFiltered.destUnit;
      const propertyId = newUnitDoc?.property?._id || newUnitDoc?.property;
      try {
        await createTenantInvoice({
          business: currentCompany?._id,
          tenant: transferForm.tenantId,
          unit: transferForm.newUnit,
          property: propertyId,
          category: "DEPOSIT_CHARGE",
          amount: topUp,
          invoiceDate: transferForm.effectiveDate,
          dueDate: transferForm.depositTopUpDueDate || transferForm.effectiveDate,
          description: `Deposit top-up — unit transfer to ${newUnitDoc?.unitNumber || "new unit"}`,
          metadata: { unitTransfer: true, transferEffectiveDate: transferForm.effectiveDate },
        });
        toast.success("Tenant transferred and deposit top-up invoice created");
      } catch {
        toast.success("Tenant transferred successfully");
        toast.warning("Deposit top-up invoice could not be created automatically — please create it manually");
      }
    } else if (transferForm.reduceDeposit && transferFiltered.depositDiff < 0) {
      toast.success("Tenant transferred and deposit record reduced to match new unit");
    } else {
      toast.success("Tenant unit transferred successfully");
    }

    setShowTransferModal(false);
    await dispatch(getTenants(buildTenantParams()));
    await dispatch(getUnits({ business: currentCompany._id }));
  } catch (error) {
    toast.error(error?.response?.data?.message || error?.response?.data?.error || error?.message || "Failed to transfer tenant unit");
  } finally {
    setIsTransferring(false);
  }
}, [canUpdateTenant, transferForm, transferFiltered, currentCompany, dispatch, buildTenantParams]);

  const handleReviewRent = () => {
    if (!canUpdateTenant) {
      toast.warning("You do not have permission to review tenant rent");
      return;
    }
    if (selectedTenants.length === 0) {
      toast.warning("Please select one tenant to review rent for");
      return;
    }
    if (selectedTenants.length > 1) {
      toast.warning("Please select only one tenant to review rent for");
      return;
    }

    const selectedTenant = transformedTenants.find((tenant) => tenant.id === selectedTenants[0]);
    const firstName = (selectedTenant?.tenantName || "Tenant").split(" ")[0];
    const tabTitle = `${firstName}-${selectedTenant?.tenantCode || "TT0000"}`;

    navigate(`/tenant/${selectedTenants[0]}/statement`, {
      state: {
        tabTitle,
        initialTab: "reviews",
        openReviewForm: true,
      },
    });
    setActionMenuOpen(false);
  };

  const handleOpenTerminateTenant = () => {
    if (!canUpdateTenant) {
      toast.warning("You do not have permission to terminate tenants");
      return;
    }
    if (selectedTenants.length === 0) {
      toast.warning("Please select one tenant to terminate");
      return;
    }
    if (selectedTenants.length > 1) {
      toast.warning("Please select only one tenant to terminate");
      return;
    }
    if (!selectedPrimaryTenant?.canTerminate) {
      toast.warning("Only active tenants can be terminated from this list.");
      return;
    }

    setTerminationForm({
      tenantId: selectedTenants[0],
      effectiveDate: new Date().toISOString().slice(0, 10),
      reason: "",
    });
    setShowTerminateModal(true);
    setActionMenuOpen(false);
  };

  const confirmTerminateTenant = async () => {
    if (!canUpdateTenant) {
      toast.warning("You do not have permission to terminate tenants");
      return;
    }
    if (!terminationForm.tenantId || !terminationForm.effectiveDate) {
      toast.error("Termination date is required");
      return;
    }

    setIsTerminating(true);
    try {
      const response = await adminRequests.put(`/tenants/status/${terminationForm.tenantId}`, {
        business: currentCompany?._id,
        status: "terminated",
        terminationDate: terminationForm.effectiveDate,
        moveOutDate: terminationForm.effectiveDate,
        terminationReason: terminationForm.reason,
      });

      toast.success(response?.data?.message || "Tenant terminated successfully");
      setShowTerminateModal(false);
      setTerminationForm({ tenantId: "", effectiveDate: "", reason: "" });
      setSelectedTenants([]);
      setSelectAll(false);

      await dispatch(getTenants(buildTenantParams()));
      await dispatch(getUnits({ business: currentCompany._id }));
    } catch (error) {
      toast.error(
        error?.response?.data?.message ||
          error?.response?.data?.error ||
          error?.message ||
          "Failed to terminate tenant"
      );
    } finally {
      setIsTerminating(false);
    }
  };

  const handleOpenRestoreTenant = () => {
    if (!canUpdateTenant) { toast.warning("You do not have permission to update tenants"); return; }
    if (selectedTenants.length !== 1) { toast.warning("Select exactly one tenant to restore"); return; }
    if (!selectedPrimaryTenant?.canRestore) { toast.warning("Only terminated tenants can be restored"); return; }
    setRestoreForm({ tenantId: selectedTenants[0], notes: "" });
    setShowRestoreModal(true);
    setActionMenuOpen(false);
  };

    const confirmRestoreTenant = async () => {
    if (!canUpdateTenant) { toast.warning("You do not have permission to update tenants"); return; }
    if (!restoreForm.tenantId) { toast.error("No tenant selected"); return; }
    setIsRestoring(true);
    try {
      const response = await adminRequests.put(`/tenants/status/${restoreForm.tenantId}`, {
        business: currentCompany?._id,
        status: "active",
      });
      toast.success(response?.data?.message || "Tenant restored successfully");
      setShowRestoreModal(false);
      setRestoreForm({ tenantId: "", notes: "" });
      setSelectedTenants([]);
      setSelectAll(false);
      await dispatch(getTenants(buildTenantParams()));
      await dispatch(getUnits({ business: currentCompany._id }));
      await getLeases(dispatch, currentCompany._id, "active").catch(() => {});
    } catch (error) {
      toast.error(
        error?.response?.data?.message ||
          error?.response?.data?.error ||
          error?.message ||
          "Failed to restore tenant"
      );
    } finally {
      setIsRestoring(false);
    }
  };

  const handleMoveOutInspection = useCallback((tenantId) => {
    const rawTenant = (Array.isArray(tenantsData) ? tenantsData : []).find(
      (t) => normalizeId(t._id) === normalizeId(tenantId)
    );
    const unitId = normalizeId(rawTenant?.unit?._id || rawTenant?.unit) || "";
    const propertyId = normalizeId(rawTenant?.unit?.property?._id || rawTenant?.unit?.property) || "";
    const draftKey = currentCompany?._id && (currentUser?._id || currentUser?.id)
      ? `milik:draft:insp-modal:${currentCompany._id}:${currentUser?._id || currentUser?.id || "u"}`
      : null;
    if (draftKey) {
      try {
        window.sessionStorage.setItem(draftKey, JSON.stringify({
          form: {
            type: "move_out",
            status: "scheduled",
            tenant: normalizeId(tenantId) || "",
            unit: unitId,
            property: propertyId,
            inspectorName: "",
            scheduledDate: new Date().toISOString().slice(0, 10),
            completedDate: "",
            nextInspectionDate: "",
            score: "",
            issuesFound: "0",
            photosCount: "0",
            tenantPresent: false,
            recommendations: "",
            notes: "",
          },
        }));
      } catch {}
    }
    navigate("/inspections");
  }, [currentCompany, currentUser, tenantsData, navigate]);

  const handleResetFilters = () => {
    const resetState = {
      property: "any",
      status: defaultStatusFilter,
      balanceScope: "any",
      search: "",
      tenantName: "",
      tenantCode: "",
    };
    setDraftFilters(resetState);
    setAppliedFilters(resetState);
    setCurrentPage(1);
  };

  // ===== CRUD ACTIONS =====
  const handleDeleteSelectedTenants = async () => {
    if (!canDeleteTenant) {
      toast.warning("You do not have permission to delete tenants");
      return;
    }
    if (selectedTenants.length === 0) {
      toast.warning("Please select at least one tenant to delete");
      return;
    }
    if (selectedDeletableTenants.length === 0) {
      toast.warning("Selected tenants are protected because they are still active, have balances, or already have transaction history.");
      return;
    }
    setShowDeleteModal(true);
  };

  const confirmDeleteTenants = async () => {
    if (!canDeleteTenant) {
      toast.warning("You do not have permission to delete tenants");
      return;
    }
    setIsDeleting(true);
    let successCount = 0;
    let failCount = 0;
    const skippedCount = selectedTenantRows.length - selectedDeletableTenants.length;

    for (const tenant of selectedDeletableTenants) {
      try {
        await dispatch(deleteTenant(tenant.id)).unwrap();
        successCount++;
      } catch (error) {
        console.error(`Failed to delete tenant ${tenant.id}:`, error);
        failCount++;
      }
    }

    setIsDeleting(false);
    setShowDeleteModal(false);
    setSelectedTenants([]);
    setSelectAll(false);
    setActionMenuOpen(false);

    if (successCount > 0) {
      toast.success(`Successfully deleted ${successCount} tenant(s)`);
    }
    if (skippedCount > 0) {
      toast.info(`${skippedCount} tenant(s) were skipped because they have balances or transaction history that prevents deletion.`);
    }
    if (failCount > 0) {
      toast.error(`Failed to delete ${failCount} tenant(s)`);
    }

    if (currentCompany?._id) {
      dispatch(getTenants(buildTenantParams()));
    }
  };

  // ---------------------------
  // EXCEL IMPORT/EXPORT HANDLERS
  // ---------------------------
  const handleDownloadTemplate = () => {
    downloadTenantsTemplate(units || []);
    toast.info("Tenants import template downloaded!");
  };

  const handleBulkImport = async (validRecords) => {
    try {
      const response = await adminRequests.post("/tenants/bulk-import", {
        tenants: validRecords,
        business: currentCompany._id,
      }, { timeout: 0 });

      await Promise.all([
        dispatch(getTenants(buildTenantParams(1))),
        dispatch(getUnits({ business: currentCompany._id })),
      ]);
      setCurrentPage(1);

      return response.data;
    } catch (error) {
      console.error("Bulk import error:", error);
      throw new Error(error.response?.data?.message || "Failed to import tenants");
    }
  };

  const handlePrintList = () => {
    if (!filteredTenants.length) {
      toast.warning("No tenants to print");
      return;
    }

    const resolveTenantPrintTaxLabel = (row) => {
      const propertyName = resolveTenantPropertyName(row, units, properties);
      const matchedProperty = (Array.isArray(properties) ? properties : []).find((item) => {
        const candidateName = item?.propertyName || item?.name || "";
        return String(candidateName).trim().toLowerCase() === String(propertyName || "").trim().toLowerCase();
      });

      const vatRate = Number(matchedProperty?.vatRate || 0);
      const taxCodeKey = String(matchedProperty?.taxCodeKey || "").trim();
      const taxMode = String(matchedProperty?.taxMode || "company_default").trim().toLowerCase();

      if (vatRate > 0) {
        return `${vatRate}% ${taxMode === "inclusive" ? "Inclusive" : taxMode === "exclusive" ? "Exclusive" : "VAT"}`;
      }

      if (taxCodeKey) {
        return taxCodeKey.replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
      }

      return currentCompany?.taxRegime || "-";
    };

    printTabularList({
      title: "Tenants List",
      subtitle: "Current filtered tenants register",
      company: currentCompany || {},
      summary: `Records: ${filteredTenants.length} • Printed on ${new Date().toLocaleString()}`,
      columns: [
        { label: "Tenant Code", value: (row) => row?.tenantCode || row?.code || "-" },
        { label: "Tenant Name", value: (row) => row?.name || row?.tenantName || "-" },
        { label: "Property", value: (row) => resolveTenantPropertyName(row, units, properties) },
        { label: "Unit", value: (row) => row?.unit?.unitNumber || row?.unitNumber || "-" },
        { label: "VAT / Tax", value: (row) => resolveTenantPrintTaxLabel(row) },
        { label: "Rent", value: (row) => Number(row?.rent || row?.monthlyRent || 0).toLocaleString(), align: "right" },
        { label: "Balance", value: (row) => Number(row?.balance || 0).toLocaleString(), align: "right" },
        { label: "Status", value: (row) => computeOperationalStatus({ tenant: row }) },
      ],
      rows: filteredTenants,
    });
  };

  const handleExportToExcel = () => {
    if (!tenantsData || tenantsData.length === 0) {
      toast.warning("No tenants to export");
      return;
    }
    exportTenantsToExcel(tenantsData);
    toast.info("Tenants exported successfully!");
  };

  // ===== FILTER OPTIONS =====
  const uniqueProperties = useMemo(() => {
    const propertyNames = properties
      .map((p) => p.propertyName || p.name)
      .filter(Boolean);
    return ["any", ...Array.from(new Set(propertyNames)).sort()];
  }, [properties]);

  const statusOptions = isTerminatedView ? ["terminated", "any"] : ["active", "inactive", "any"];
  const balanceScopeOptions = ["any", "with_balance"];

  // ===== RENDER =====
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex flex-col h-full min-h-0 p-0 bg-gray-50 overflow-hidden">
        {/* Toolbar — single scrollable row */}
        <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-0">
            {/* Scrollable filters section */}
            <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5 min-w-0 flex-1">
              <select className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] appearance-none"
                value={draftFilters.property} onChange={(e) => setDraftFilters({ ...draftFilters, property: e.target.value })}>
                {uniqueProperties.map((prop) => (
                  <option key={prop} value={prop}>{prop === "any" ? "All Properties" : prop}</option>
                ))}
              </select>

              <select className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] appearance-none"
                value={draftFilters.status} onChange={(e) => setDraftFilters({ ...draftFilters, status: e.target.value })}>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>{s === "any" ? "All Status" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>

              <select className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] appearance-none"
                value={draftFilters.balanceScope} onChange={(e) => setDraftFilters({ ...draftFilters, balanceScope: e.target.value })}>
                {balanceScopeOptions.map((s) => (
                  <option key={s} value={s}>{s === "with_balance" ? "With Balance" : "All Balances"}</option>
                ))}
              </select>

              <div className="h-4 w-px shrink-0 bg-slate-200" />

              <input type="text" placeholder="Name" value={draftFilters.tenantName}
                onChange={(e) => setDraftFilters({ ...draftFilters, tenantName: normalizeUppercaseInput(e.target.value) })}
                className="h-7 w-28 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              <input type="text" placeholder="Code (TT####)" value={draftFilters.tenantCode}
                onChange={(e) => setDraftFilters({ ...draftFilters, tenantCode: normalizeUppercaseInput(e.target.value) })}
                className="h-7 w-28 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              <input type="text" placeholder={isTerminatedView ? "Search terminated…" : "Search tenants…"} value={draftFilters.search}
                onChange={(e) => setDraftFilters({ ...draftFilters, search: normalizeUppercaseInput(e.target.value) })}
                className="h-7 w-36 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />

              <div className="h-4 w-px shrink-0 bg-slate-200" />

              <button onClick={() => { setAppliedFilters(draftFilters); setCurrentPage(1); }} className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#0B3B2E] px-2.5 text-xs font-semibold text-white hover:bg-[#0A3127]">
                <FaSearch size={9} /> Search
              </button>
              <button onClick={handleResetFilters} className="h-7 shrink-0 flex items-center gap-1 rounded bg-gray-500 px-2.5 text-xs font-semibold text-white hover:bg-gray-600">
                <FaRedoAlt size={9} /> Reset
              </button>
              <button onClick={expandAllTenants} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 px-2 text-xs text-gray-600 hover:bg-gray-50" title="Expand all">
                <FaExpandAlt size={9} />
              </button>
              <button onClick={collapseAllTenants} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 px-2 text-xs text-gray-600 hover:bg-gray-50" title="Collapse all">
                <FaCompressAlt size={9} />
              </button>
              {canUpdateTenant && (
                <button onClick={handleEditTenant} disabled={selectedTenants.length !== 1}
                  className="h-7 shrink-0 flex items-center gap-1 rounded bg-blue-500 px-2.5 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed">
                  <FaEdit size={9} /> Edit
                </button>
              )}
              {selectedTenants.length > 0 && (
                <span className="shrink-0 text-[10px] font-bold text-slate-500 tabular-nums">{selectedTenants.length} selected</span>
              )}
            </div>

            {/* Action buttons — NOT inside overflow container so dropdowns are never clipped */}
            <div className="flex items-center gap-1.5 shrink-0 px-2 py-1.5 border-l border-slate-200">
              <div className="relative" ref={actionMenuRef}>
                <button onClick={() => setActionMenuOpen(!actionMenuOpen)}
                  className="h-7 flex items-center gap-1 rounded bg-[#0B3B2E] px-2.5 text-xs font-semibold text-white hover:bg-[#0A3127]">
                  <FaEllipsisV size={9} /> Actions
                </button>
                {actionMenuOpen && (
                  <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                    <div className="py-1">
                      <button onClick={handleViewStatement} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700">
                        <FaFileInvoiceDollar size={12} /> View Tenant Statement
                      </button>
                      {canUpdateTenant && (
                        <button onClick={handleEditTenant} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700">
                          <FaUserEdit size={12} /> Edit Tenant Details
                        </button>
                      )}
                      {canUpdateTenant && (
                        <button onClick={handleTransferUnit}
                          disabled={isTerminatedView || selectedTenants.length !== 1 || !selectedPrimaryTenant?.canTransfer}
                          className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${selectedTenants.length === 1 && selectedPrimaryTenant?.canTransfer ? "hover:bg-gray-100 text-gray-700" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}>
                          <FaExchangeAlt size={12} /> Transfer Tenant Unit
                        </button>
                      )}
                      <button onClick={handleViewReceipts} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700">
                        <FaMoneyBillWave size={12} /> View Tenant Receipts
                      </button>
                      <button onClick={handleOpenAgreement} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700">
                        <FaFileInvoiceDollar size={12} /> Open Tenant Agreement
                      </button>
                      {canUpdateTenant && (
                        <button onClick={handleAddUtility} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700">
                          <FaBolt size={12} /> Add Utility to Selected Tenant
                        </button>
                      )}
                      {canUpdateTenant && (
                        <button onClick={handleReviewRent} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700 border-t border-gray-200">
                          <FaChartLine size={12} /> Review Rent for Selected Tenant
                        </button>
                      )}
                      {canUpdateTenant && (
                        <button onClick={handleOpenTerminateTenant}
                          disabled={isTerminatedView || selectedTenants.length !== 1 || !selectedPrimaryTenant?.canTerminate}
                          className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 border-t border-gray-200 ${selectedTenants.length === 1 && selectedPrimaryTenant?.canTerminate ? "hover:bg-amber-50 text-amber-700" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}>
                          <FaUserSlash size={12} /> Terminate Tenant
                        </button>
                      )}
                      {canUpdateTenant && isTerminatedView && (
                        <button onClick={handleOpenRestoreTenant}
                          disabled={selectedTenants.length !== 1 || !selectedPrimaryTenant?.canRestore}
                          className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 border-t border-gray-200 ${selectedTenants.length === 1 && selectedPrimaryTenant?.canRestore ? "hover:bg-emerald-50 text-[#0B3B2E] font-semibold" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}>
                          <FaRedoAlt size={12} /> Restore Tenant
                        </button>
                      )}
                      <button onClick={() => { setActionMenuOpen(false); setShowCommunicationModal(true); }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-orange-50 flex items-center gap-2 text-orange-700 border-t border-gray-200">
                        <FaSms size={12} /> SMS Tenants
                      </button>
                      {canDeleteTenant && (
                        <button onClick={handleDeleteSelectedTenants} disabled={selectedDeletableTenants.length === 0}
                          className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 border-t border-gray-200 font-semibold ${selectedDeletableTenants.length > 0 ? "hover:bg-red-50 text-red-600" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}>
                          <FaTrash size={12} /> Delete Selected Tenant(s)
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {(isTerminatedView || canCreateTenant) && (
                <button onClick={() => isTerminatedView ? navigate("/invoices/new") : navigate("/tenant/new")}
                  className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#FF8C00] hover:bg-[#e67e00] px-2.5 text-xs font-semibold text-white">
                  <FaPlus size={9} /> {isTerminatedView ? "Final Billing" : "Add"}
                </button>
              )}
              <button onClick={handleDownloadTemplate} className="h-7 shrink-0 flex items-center gap-1 rounded bg-blue-500 px-2.5 text-xs font-semibold text-white hover:bg-blue-600">
                <FaDownload size={9} /> Template
              </button>
              {canCreateTenant && !isTerminatedView && (
                <button onClick={() => setShowImportModal(true)}
                  className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#FF8C00] hover:bg-[#e67e00] px-2.5 text-xs font-semibold text-white">
                  <FaFileExport size={9} className="rotate-180" /> Import
                </button>
              )}
<button onClick={handlePrintList} className="h-7 shrink-0 flex items-center gap-1 rounded bg-slate-700 px-2.5 text-xs font-semibold text-white hover:bg-slate-800">
                <FaPrint size={9} /> Print
              </button>
              <button onClick={handleExportToExcel} className="h-7 shrink-0 flex items-center gap-1 rounded bg-gray-600 px-2.5 text-xs font-semibold text-white hover:bg-gray-700">
                <FaFileExport size={9} /> Export
              </button>
            </div>
          </div>
        </div>

        {/* ===== TENANTS TABLE ===== */}
        <div className="flex-1 min-h-0 overflow-auto px-2">
          <table className="w-full border-collapse table-fixed">
            <thead className="sticky top-0 z-10 shadow-sm">
              <tr className={`${MILIK_GREEN} text-white text-[11px]`}>
                <th className="w-9 px-2 py-1.5 text-center border-r border-white/10">
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={handleSelectAll}
                    onClick={handleCheckboxClick}
                    className="rounded border-gray-300 text-orange-600 focus:ring-[#0B3B2E]/20 cursor-pointer"
                  />
                </th>
                <th className="w-7 px-1 py-1.5 border-r border-white/10" />
                <th className="w-[82px] px-3 py-1.5 text-left font-bold border-r border-white/10">Code</th>
                <th className="px-3 py-1.5 text-left font-bold border-r border-white/10">Tenant</th>
                <th className="w-[72px] px-3 py-1.5 text-left font-bold border-r border-white/10">Unit</th>
                {isTerminatedView ? (
                  <>
                    <th className="w-[108px] px-3 py-1.5 text-left font-bold border-r border-white/10">Terminated</th>
                    <th className="w-[100px] px-3 py-1.5 text-left font-bold border-r border-white/10">Move-out</th>
                    <th className="w-[110px] px-3 py-1.5 text-right font-bold border-r border-white/10">Final Balance</th>
                    <th className="w-[110px] px-3 py-1.5 text-right font-bold border-r border-white/10">Deposit Held</th>
                    <th className="w-[110px] px-3 py-1.5 text-center font-bold border-r border-white/10">Settlement</th>
                    <th className="w-[130px] px-3 py-1.5 text-left font-bold">Held By</th>
                  </>
                ) : (
                  <>
                    <th className="w-[188px] px-3 py-1.5 text-left font-bold border-r border-white/10">Lease Period</th>
                    <th className="w-[100px] px-3 py-1.5 text-right font-bold border-r border-white/10">Rent</th>
                    <th className="w-[112px] px-3 py-1.5 text-right font-bold border-r border-white/10">Balance</th>
                    <th className="w-[92px] px-3 py-1.5 text-center font-bold border-r border-white/10">Status</th>
                    <th className="w-[155px] px-3 py-1.5 text-left font-bold">Contact</th>
                  </>
                )}
              </tr>
            </thead>

            <tbody>
              {currentTenants.length > 0 ? (
                currentTenants.map((tenant, idx) => {
                  const isFirstOfProperty =
                    idx === 0 || currentTenants[idx - 1].propertyName !== tenant.propertyName;

                  return (
                    <React.Fragment key={tenant.id}>
                      {isFirstOfProperty && (
                        <tr>
                          <td colSpan={isTerminatedView ? 11 : 10} className="px-3 pt-2.5 pb-1 bg-white">
                            <div className="flex items-center gap-2.5">
                              <div className="h-4 w-1 rounded-full bg-[#FF8C00] shrink-0" />
                              <span className="text-[11px] font-black tracking-widest text-slate-800 uppercase leading-none">
                                {toListingCaps(tenant.propertyName)}
                              </span>
                              <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500 tabular-nums leading-none">
                                {propertyTenantCounts[tenant.propertyName] || 0}
                              </span>
                            </div>
                            <div className="mt-1.5 h-px bg-gradient-to-r from-[#FF8C00]/50 via-orange-200/60 to-transparent" />
                          </td>
                        </tr>
                      )}

                      <tr
                        className={`border-b text-[11px] cursor-pointer transition-colors ${
                          tenant.expiryWarning?.hasWarning ? "border-red-200" : "border-gray-100"
                        } ${
                          selectedTenants.includes(tenant.id)
                            ? "bg-emerald-50 shadow-[inset_3px_0_0_0_#0B3B2E]"
                            : tenant.expiryWarning?.hasWarning
                            ? "bg-red-50/60 hover:bg-red-100/60"
                            : idx % 2 === 0
                            ? "bg-white hover:bg-blue-50/40"
                            : "bg-slate-50/60 hover:bg-blue-50/40"
                        }`}
                        onClick={() => handleSelectTenant(tenant.id)}
                      >
                        <td className="w-8 px-2 py-1.5 text-center border-r border-gray-100" onClick={handleCheckboxClick}>
                          <input
                            type="checkbox"
                            checked={selectedTenants.includes(tenant.id)}
                            onChange={() => handleSelectTenant(tenant.id)}
                            onClick={handleCheckboxClick}
                            className="rounded border-gray-300 text-orange-600 focus:ring-[#0B3B2E]/20 cursor-pointer"
                          />
                        </td>
                        <td
                          className="w-6 px-1 py-1.5 text-center border-r border-gray-100 cursor-pointer text-slate-300 transition hover:text-slate-600"
                          onClick={(e) => { e.stopPropagation(); toggleTenantExpand(tenant.id); }}
                        >
                          {expandedTenants.includes(tenant.id) ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                          <span className="font-mono text-[10px] text-slate-500 tracking-wide truncate block">{toListingCaps(tenant.tenantCode)}</span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                          <div className="font-semibold text-slate-900 leading-tight truncate" title={toListingCaps(tenant.tenantName)}>{toListingCaps(tenant.tenantName)}</div>
                          {tenant.expiryWarning?.hasWarning && (
                            <div className="mt-0.5 text-[10px] font-semibold text-red-600 leading-tight truncate">{tenant.expiryWarning.summary}</div>
                          )}
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                          <span className="font-medium text-slate-700 truncate block">{toListingCaps(tenant.unitNumber)}</span>
                        </td>
                        {isTerminatedView ? (
                          <>
                            <td className="px-3 py-1.5 text-slate-700 border-r border-gray-100 overflow-hidden"><span className="truncate block">{tenant.terminationDate}</span></td>
                            <td className="px-3 py-1.5 text-slate-700 border-r border-gray-100 overflow-hidden"><span className="truncate block">{tenant.moveOutDate}</span></td>
                            <td className="px-3 py-1.5 text-right border-r border-gray-100 whitespace-nowrap">
                              {tenant.balance < -0.009 ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                  CR&nbsp;{Math.abs(tenant.balance).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                                </span>
                              ) : tenant.balance > 0.009 ? (
                                <span className="font-bold text-red-600">KES {tenant.balance.toLocaleString()}</span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right font-semibold text-slate-700 border-r border-gray-100 whitespace-nowrap">
                              Ksh {tenant.depositHeld.toLocaleString()}
                            </td>
                            <td className="px-3 py-1.5 text-center border-r border-gray-100">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                tenant.settlementStatus === "SETTLED" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : tenant.settlementStatus === "REFUND_DUE" ? "bg-blue-50 text-blue-700 border-blue-200"
                                : tenant.settlementStatus === "OWES_BALANCE" ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                              }`}>
                                {tenant.settlementStatus.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                              </span>
                            </td>
                            <td className="px-3 py-1 text-slate-700">{tenant.depositHeldBy}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-1 border-r border-gray-100 whitespace-nowrap">
                              <span className="text-slate-600">{tenant.startDate}</span>
                              <span className="text-slate-300 mx-1.5">→</span>
                              {tenant.endDate === "-"
                                ? <span className="text-slate-400 italic text-[10px]">open</span>
                                : <span className={tenant.expiryWarning?.hasWarning ? "font-semibold text-red-600" : "text-slate-600"}>{tenant.endDate}</span>
                              }
                            </td>
                            <td className="px-3 py-1.5 text-right font-semibold text-slate-700 border-r border-gray-100 whitespace-nowrap">
                              {tenant.rent}
                            </td>
                            <td className="px-3 py-1.5 text-right border-r border-gray-100 whitespace-nowrap">
                              {tenant.balance < -0.009 ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                  CR&nbsp;{Math.abs(tenant.balance).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                                </span>
                              ) : tenant.balance > 0.009 ? (
                                <span className="font-bold text-red-600">KES {tenant.balance.toLocaleString()}</span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-center border-r border-gray-100">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                tenant.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : tenant.status === "terminated" ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-slate-100 text-slate-600 border-slate-200"
                              }`}>
                                {tenant.status}
                              </span>
                              {tenant.expiryWarning?.hasWarning && (
                                <div className="mt-0.5">
                                  <span className="inline-flex items-center rounded-full bg-red-50 border border-red-200 px-1.5 py-0.5 text-[9px] font-bold text-red-600">⚠ Expiring</span>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-1 overflow-hidden">
                              {tenant.phone && tenant.phone !== "-" && (
                                <div className="text-[11px] font-medium text-slate-700 leading-tight truncate">{tenant.phone}</div>
                              )}
                              {tenant.email && tenant.email !== "-" ? (
                                <a
                                  href={`mailto:${tenant.email}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="block text-[10px] text-blue-500 hover:text-blue-700 hover:underline truncate leading-tight mt-0.5"
                                  title={tenant.email}
                                >
                                  {tenant.email}
                                </a>
                              ) : (
                                !tenant.phone || tenant.phone === "-" ? <span className="text-slate-300">—</span> : null
                              )}
                            </td>
                          </>
                        )}
                      </tr>

                      {expandedTenants.includes(tenant.id) && (
                        <tr className="bg-slate-50/80 border-b border-gray-100">
                          <td colSpan={isTerminatedView ? 11 : 10} className="px-3 py-2">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                              <div>
                                <h4 className="mb-2 border-b border-slate-200 pb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                  Tenant Details
                                </h4>
                                <div className="space-y-1 text-xs">
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Email:</span>
                                    <p className="text-gray-600 text-xs">{tenant.email}</p>
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Phone:</span>
                                    <p className="text-gray-600 text-xs">{tenant.phone}</p>
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Property:</span>
                                    <p className="text-gray-600 text-xs">{toListingCaps(tenant.propertyName)}</p>
                                  </div>
                                </div>
                              </div>

                              <div>
                                <h4 className="mb-2 border-b border-slate-200 pb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                  Billing Info
                                </h4>
                                <div className="space-y-1 text-xs">
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Monthly Rent:</span>
                                    <p className="text-gray-600 font-bold">{tenant.rent}</p>
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Balance:</span>
                                    {tenant.balance < -0.009 ? (
                                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                                        CR&nbsp;{Math.abs(tenant.balance).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                                      </span>
                                    ) : (
                                      <p className={`font-bold ${tenant.balance > 0 ? "text-red-600" : "text-gray-400"}`}>
                                        {tenant.balance > 0 ? `KES ${tenant.balance.toLocaleString()}` : "—"}
                                      </p>
                                    )}
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Status:</span>
                                    <p
                                      className={`text-xs font-bold ${
                                        tenant.status === "any"
                                          ? "text-green-700"
                                          : "text-gray-700"
                                      }`}
                                    >
                                      {tenant.status.toUpperCase()}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <div>
                                <h4 className="mb-2 border-b border-slate-200 pb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                  Lease Details
                                </h4>
                                <div className="space-y-1 text-xs">
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Unit:</span>
                                    <p className="text-gray-600 text-xs">{toListingCaps(tenant.unitNumber)}</p>
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Lease Start Date:</span>
                                    <p className="text-gray-600 font-bold text-xs">{tenant.startDate}</p>
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Lease End Date:</span>
                                    <p className={`${tenant.expiryWarning?.hasWarning ? "text-red-700" : "text-gray-600"} font-bold text-xs`}>{tenant.endDate}</p>
                                  </div>
                                  {tenant.expiryWarning?.hasWarning && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-2">
                                      <span className="font-bold text-red-700 block text-xs">Expiry Warning:</span>
                                      <p className="text-red-700 text-xs font-semibold">{tenant.expiryWarning.summary}</p>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div>
                                <h4 className="mb-2 border-b border-slate-200 pb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                  Actions
                                </h4>
                                <div className="flex flex-col gap-1">
                                  <button
                                    onClick={() => {
                                      const firstName = (tenant.tenantName || "Tenant").split(" ")[0];
                                      const tabTitle = `${firstName}-${tenant.tenantCode || "TT0000"}`;
                                      navigate(`/tenant/${tenant.id}/statement`, { state: { tabTitle } });
                                    }}
                                    className="rounded px-2 py-1 text-xs font-semibold text-white transition-colors bg-[#0B3B2E] hover:bg-[#0A3127]"
                                  >
                                    View Statement
                                  </button>
                                  {isTerminatedView && (
                                    <>
                                      <button
                                        onClick={() => navigate(`/invoices/rental/${tenant.id}`, { state: { openSingleBooking: true } })}
                                        className="rounded px-2 py-1 text-xs font-semibold text-white transition-colors bg-emerald-600 hover:bg-emerald-700"
                                      >
                                        Final Billing
                                      </button>
                                      <button
                                        onClick={() => openDepositSettlementModal(tenant.id)}
                                        className="rounded px-2 py-1 text-xs font-semibold text-white transition-colors bg-amber-600 hover:bg-amber-700"
                                      >
                                        Deposit Settlement
                                      </button>
                                      <button
                                        onClick={() => handleMoveOutInspection(tenant.id)}
                                        className="rounded px-2 py-1 text-xs font-semibold text-white transition-colors bg-slate-600 hover:bg-slate-700"
                                      >
                                        Move-out Inspection
                                      </button>
                                    </>
                                  )}
                                  {canDeleteTenant && (
                                  <button
                                  onClick={() => {
                                    setSelectedTenants([tenant.id]);
                                    setShowDeleteModal(true);
                                  }}
                                  disabled={!tenant.canDelete}
                                  title={tenant.canDelete ? "Delete unused tenant record" : tenant.deleteBlockedReason}
                                  className={`px-2 py-1 text-white font-bold rounded text-xs transition-colors ${tenant.canDelete ? "bg-red-600 hover:bg-red-700" : "bg-gray-400 cursor-not-allowed"}`}
                                  >
                                    🗑️ Delete
                                  </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={isTerminatedView ? 11 : 10} className="px-3 py-8 text-center text-gray-600 font-semibold text-xs">
                    {isFetchingTenants ? (
                      <div className="flex items-center justify-center gap-2 text-gray-400">
                        <FaSpinner className="animate-spin" size={14} />
                        <span>Loading tenants…</span>
                      </div>
                    ) : (
                      isTerminatedView ? "No terminated tenants found. Try adjusting filters." : "No tenants found. Try adjusting filters or create a new tenant."
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ===== COMPACT PAGINATION FOOTER ===== */}
        <div className="flex-shrink-0 sticky bottom-0 z-20 bg-white border-t border-gray-200 px-2 py-1 flex items-center justify-between">
          <div className="text-xs font-bold text-gray-600">
            Showing {currentTenants.length > 0 ? startIndex + 1 : 0} to{" "}
            {Math.min(endIndex, sortedFilteredTenants.length)} of {sortedFilteredTenants.length}{" "}
            {isTerminatedView ? "terminated tenants" : "tenants"}
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-slate-500 text-xs">Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                className="h-7 rounded border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 focus:border-[#0B3B2E] focus:outline-none transition"
              >
                {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <button
              onClick={() => setCurrentPage(safeCurrentPage - 1)}
              disabled={safeCurrentPage === 1}
              className="p-1 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-gray-700 text-xs"
            >
              <FaChevronLeft size={12} />
            </button>

            <div className="flex items-center gap-0.5">
              {[...Array(totalPages)].map((_, i) => {
                const page = i + 1;
                if (
                  page === 1 ||
                  page === totalPages ||
                  (page >= safeCurrentPage - 1 && page <= safeCurrentPage + 1)
                ) {
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${
                        safeCurrentPage === page
                          ? `${MILIK_ORANGE} text-white`
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      {page}
                    </button>
                  );
                } else if (
                  page === safeCurrentPage - 2 ||
                  page === safeCurrentPage + 2
                ) {
                  return (
                    <span key={page} className="px-1 text-gray-400 text-xs">
                      ...
                    </span>
                  );
                }
                return null;
              })}
            </div>

            <button
              onClick={() => setCurrentPage(safeCurrentPage + 1)}
              disabled={safeCurrentPage === totalPages}
              className="p-1 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-gray-700 text-xs"
            >
              <FaChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* ===== DELETE CONFIRMATION MODAL ===== */}


{showTransferModal && (() => {
  const { currentDeposit, currentRent, currentPropertyName, allVacantUnits, uniqueProperties } = transferBase || {};
  const { filteredUnits, destUnit, destDeposit, destRent, destPropertyName, depositDiff, rentDiff } = transferFiltered;
  const diffCls = (v) => v > 0 ? "text-red-600" : v < 0 ? "text-emerald-600" : "text-slate-500";
  const diffLabel = (v) => v === 0 ? "No change" : (v > 0 ? `+Ksh ${fmtKES(Math.abs(v))}` : `-Ksh ${fmtKES(Math.abs(v))}`);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between bg-[#0B3B2E] px-5 py-4">
          <div className="flex items-center gap-2.5 text-white">
            <FaExchangeAlt size={14} />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Internal Transfer</p>
              <h3 className="text-sm font-black leading-tight">Transfer Tenant to New Unit</h3>
            </div>
          </div>
          <button onClick={() => { if (!isTransferring) setShowTransferModal(false); }}
            className="flex h-7 w-7 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white transition">
            <FaTimes size={13} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Current tenant summary */}
          <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
            <div className="grid grid-cols-4 gap-3 text-xs">
              <div>
                <p className="font-bold uppercase tracking-wider text-slate-400">Tenant</p>
                <p className="mt-0.5 font-bold text-slate-900 truncate">{selectedPrimaryTenant?.tenantName || "-"}</p>
                <p className="text-slate-500">{selectedPrimaryTenant?.tenantCode || "-"}</p>
              </div>
              <div>
                <p className="font-bold uppercase tracking-wider text-slate-400">Current Unit</p>
                <p className="mt-0.5 font-bold text-slate-900">{selectedPrimaryTenant?.unitNumber || "-"}</p>
                <p className="text-slate-500 truncate">{currentPropertyName}</p>
              </div>
              <div>
                <p className="font-bold uppercase tracking-wider text-slate-400">Rent</p>
                <p className="mt-0.5 font-bold text-slate-900">Ksh {fmtKES(currentRent)}</p>
              </div>
              <div>
                <p className="font-bold uppercase tracking-wider text-slate-400">Deposit Held</p>
                <p className="mt-0.5 font-bold text-slate-900">Ksh {fmtKES(currentDeposit)}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4 px-5 py-4">
            {/* Unit search filters */}
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-700">Available Vacant Units ({allVacantUnits.length})</p>
              <div className="flex flex-wrap gap-2">
                <select
                  value={transferForm.filterProperty}
                  onChange={(e) => setTransferForm((p) => ({ ...p, filterProperty: e.target.value }))}
                  className="h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 appearance-none outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20">
                  <option value="">All properties</option>
                  {uniqueProperties.map((prop) => (
                    <option key={prop.id} value={prop.id}>{prop.name}</option>
                  ))}
                </select>
                <div className="relative">
                  <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={9} />
                  <input
                    type="text"
                    placeholder="Search unit no."
                    value={transferForm.filterSearch}
                    onChange={(e) => setTransferForm((p) => ({ ...p, filterSearch: e.target.value }))}
                    className="h-7 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs text-slate-700 outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
              </div>
            </div>

            {/* Units list */}
            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200">
              {filteredUnits.length === 0 ? (
                <div className="flex items-center justify-center py-6 text-xs text-slate-400">
                  {allVacantUnits.length === 0 ? "No vacant units available for transfer" : "No units match the current filters"}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Unit</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Property</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">Rent</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">Deposit</th>
                      <th className="px-3 py-2 text-center font-semibold text-slate-600">Select</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUnits.map((u) => {
                      const uId = normalizeId(u._id);
                      const isSelected = transferForm.newUnit === uId;
                      const uDeposit = Number(u.deposit || 0);
                      const uRent = Number(u.rent || 0);
                      return (
                        <tr key={uId}
                          onClick={() => setTransferForm((p) => ({
                            ...p,
                            newUnit: uId,
                            depositTopUp: Math.max(0, uDeposit - currentDeposit),
                            reduceDeposit: false,
                          }))}
                          className={`cursor-pointer border-t border-slate-100 transition ${isSelected ? "bg-[#0B3B2E]/5 font-semibold" : "hover:bg-slate-50"}`}>
                          <td className="px-3 py-2">
                            <span className={`font-bold ${isSelected ? "text-[#0B3B2E]" : "text-slate-900"}`}>{u.unitNumber}</span>
                          </td>
                          <td className="px-3 py-2 text-slate-600 max-w-[120px] truncate">{u.property?.propertyName || "-"}</td>
                          <td className="px-3 py-2 text-right text-slate-700">Ksh {fmtKES(uRent)}</td>
                          <td className="px-3 py-2 text-right text-slate-700">Ksh {fmtKES(uDeposit)}</td>
                          <td className="px-3 py-2 text-center">
                            {isSelected
                              ? <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#0B3B2E] text-white"><FaCheck size={8} /></span>
                              : <span className="inline-block h-5 w-5 rounded-full border-2 border-slate-300" />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Comparison + deposit when unit selected */}
            {destUnit && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current</p>
                    <p className="mt-1 text-xs font-bold text-slate-800">{selectedPrimaryTenant?.unitNumber || "-"}</p>
                    <p className="text-[11px] text-slate-500 truncate">{currentPropertyName}</p>
                    <div className="mt-1.5 flex gap-3 text-[11px] text-slate-600">
                      <span>Rent <span className="font-bold">Ksh {fmtKES(currentRent)}</span></span>
                      <span>Dep <span className="font-bold">Ksh {fmtKES(currentDeposit)}</span></span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#0B3B2E]/20 bg-[#0B3B2E]/5 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#0B3B2E]/60">New Unit</p>
                    <p className="mt-1 text-xs font-bold text-[#0B3B2E]">{destUnit.unitNumber}</p>
                    <p className="text-[11px] text-[#0B3B2E]/70 truncate">{destPropertyName}</p>
                    <div className="mt-1.5 flex gap-3 text-[11px]">
                      <span className={`font-semibold ${diffCls(rentDiff)}`}>
                        Rent Ksh {fmtKES(destRent)} {rentDiff !== 0 && <span>({diffLabel(rentDiff)})</span>}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px]">
                      <span className={`font-semibold ${diffCls(depositDiff)}`}>
                        Dep Ksh {fmtKES(destDeposit)} {depositDiff !== 0 && <span>({diffLabel(depositDiff)})</span>}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Deposit top-up section */}
                {depositDiff > 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white shrink-0"><span className="text-[9px] font-black">!</span></div>
                      <p className="text-xs font-semibold text-amber-900">Deposit top-up required — new unit needs Ksh {fmtKES(depositDiff)} more</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-0.5 block text-xs font-semibold text-slate-700">Top-up amount <span className="text-red-500">*</span></label>
                        <input
                          type="number"
                          min="0"
                          value={transferForm.depositTopUp}
                          onChange={(e) => setTransferForm((p) => ({ ...p, depositTopUp: Math.max(0, Number(e.target.value || 0)) }))}
                          className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                        <p className="mt-0.5 text-[10px] text-slate-400">Suggested: Ksh {fmtKES(depositDiff)}</p>
                      </div>
                      <div>
                        <label className="mb-0.5 block text-xs font-semibold text-slate-700">Invoice due date <span className="text-red-500">*</span></label>
                        <input
                          type="date"
                          value={transferForm.depositTopUpDueDate}
                          onChange={(e) => setTransferForm((p) => ({ ...p, depositTopUpDueDate: e.target.value }))}
                          className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-amber-700">
                      {Number(transferForm.depositTopUp) > 0
                        ? `A Ksh ${fmtKES(transferForm.depositTopUp)} DEPOSIT_CHARGE invoice will be created for this tenant after the transfer.`
                        : "Set the top-up amount above to auto-generate a deposit invoice, or leave at 0 to handle manually."}
                    </p>
                  </div>
                ) : depositDiff < 0 ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-2.5">
                    <p className="text-xs font-semibold text-emerald-800">
                      Surplus deposit — new unit requires <span className="font-black">Ksh {fmtKES(Math.abs(depositDiff))} less</span> than what's currently held.
                    </p>
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={!!transferForm.reduceDeposit}
                        onChange={(e) => setTransferForm((p) => ({ ...p, reduceDeposit: e.target.checked }))}
                        className="mt-0.5 rounded border-slate-300 text-[#0B3B2E]"
                      />
                      <span className="text-xs text-emerald-900">
                        <span className="font-bold">Reduce deposit record</span> from Ksh {fmtKES(currentDeposit)} → Ksh {fmtKES(destDeposit)} to match the new unit's requirement.
                        The Ksh {fmtKES(Math.abs(depositDiff))} surplus should be refunded to the tenant separately via a payment voucher.
                      </span>
                    </label>
                    {!transferForm.reduceDeposit && (
                      <p className="text-[11px] text-emerald-700">Leave unchecked to keep the existing deposit amount — useful when the landlord retains the full deposit.</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
                    Deposit amounts match — no top-up invoice required.
                  </div>
                )}
              </>
            )}

            {/* Transfer details */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">Effective date <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={transferForm.effectiveDate}
                  onChange={(e) => setTransferForm((p) => ({ ...p, effectiveDate: e.target.value }))}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">Reason</label>
                <input
                  type="text"
                  value={transferForm.reason}
                  onChange={(e) => setTransferForm((p) => ({ ...p, reason: e.target.value }))}
                  placeholder="Upgrade, relocation, preference match…"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <p className="text-[11px] text-slate-400">
            {filteredUnits.length} unit{filteredUnits.length !== 1 ? "s" : ""} available
            {transferForm.newUnit && destUnit ? ` · ${destUnit.unitNumber} selected` : ""}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { if (!isTransferring) setShowTransferModal(false); }}
              disabled={isTransferring}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              Cancel
            </button>
            <button
              onClick={confirmTransferUnit}
              disabled={isTransferring || !transferForm.newUnit}
              className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
              {isTransferring ? "Transferring…" : "Transfer Unit"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
})()}
      {showTerminateModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="bg-gradient-to-r from-amber-600 to-red-600 px-6 py-4">
              <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                <FaUserSlash size={18} />
                Terminate Tenant
              </h3>
            </div>
            <div className="space-y-5 px-6 py-5">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">This will remove the tenant from active occupancy and future active billing flows.</p>
                <p className="mt-1 text-xs text-amber-800">
                  Historical invoices, receipts, balances, and statements remain intact. The unit is released back to vacant inventory using the same effective date.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Tenant</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{selectedPrimaryTenant?.tenantName || "-"}</p>
                  <p className="mt-1 text-xs text-slate-600">{selectedPrimaryTenant?.tenantCode || "-"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Occupied Space</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{selectedPrimaryTenant?.unitNumber || "-"}</p>
                  <p className="mt-1 text-xs text-slate-600">{selectedPrimaryTenant?.propertyName || "-"}</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Effective move-out date</label>
                  <input
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={terminationForm.effectiveDate}
                    onChange={(e) => setTerminationForm((prev) => ({ ...prev, effectiveDate: e.target.value }))}
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">Future-dated termination is blocked so unit occupancy and billing remain consistent.</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Outstanding balance</label>
                  <div className="mt-1 flex h-[50px] items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-900">
                    Ksh {Number(selectedPrimaryTenant?.balance || 0).toLocaleString()}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">Outstanding balances remain collectible and visible after termination.</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Reason / notes</label>
                <textarea
                  rows={3}
                  value={terminationForm.reason}
                  onChange={(e) => setTerminationForm((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="Tenant moved out, lease ended, voluntary exit..."
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                onClick={() => {
                  if (isTerminating) return;
                  setShowTerminateModal(false);
                }}
                className="rounded-2xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700"
                disabled={isTerminating}
              >
                Cancel
              </button>
              <button
                onClick={confirmTerminateTenant}
                disabled={!canUpdateTenant || isTerminating}
                className="rounded-2xl bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isTerminating ? "Terminating..." : "Terminate Tenant"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showRestoreModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#0B3B2E] px-5 py-4">
              <div className="flex items-center gap-2.5 text-white">
                <FaRedoAlt size={15} />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Restore</p>
                  <h3 className="text-sm font-black leading-tight">Restore Tenant</h3>
                </div>
              </div>
              <button onClick={() => { if (!isRestoring) { setShowRestoreModal(false); } }}
                className="flex h-7 w-7 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white transition">
                <FaTimes size={13} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
                <p className="font-semibold">Re-activating this tenant will restore their occupancy and restart billing.</p>
                <p className="mt-0.5 text-emerald-700">The system will verify the unit is still vacant before completing the restoration.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Tenant</p>
                  <p className="mt-1 text-xs font-bold text-slate-900">{selectedPrimaryTenant?.tenantName || "-"}</p>
                  <p className="text-[11px] text-slate-500">{selectedPrimaryTenant?.tenantCode || "-"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Unit / Property</p>
                  <p className="mt-1 text-xs font-bold text-slate-900">{selectedPrimaryTenant?.unitNumber || "-"}</p>
                  <p className="text-[11px] text-slate-500">{selectedPrimaryTenant?.propertyName || "-"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Terminated On</p>
                  <p className="mt-1 text-xs font-bold text-slate-900">{selectedPrimaryTenant?.terminationDate || "-"}</p>
                  {selectedPrimaryTenant?.terminationReason ? (
                    <p className="mt-0.5 text-[11px] italic text-slate-500 line-clamp-2">{selectedPrimaryTenant.terminationReason}</p>
                  ) : null}
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Outstanding Balance</p>
                  <p className={`mt-1 text-xs font-black ${Math.abs(Number(selectedPrimaryTenant?.balance || 0)) > 0.009 ? "text-red-600" : "text-slate-900"}`}>
                    Ksh {Number(selectedPrimaryTenant?.balance || 0).toLocaleString()}
                  </p>
                  <p className="text-[11px] text-slate-500">Remains collectible after restore</p>
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <p className="font-semibold">Conditions that must be met:</p>
                <ul className="mt-1 space-y-0.5 list-disc list-inside text-amber-700">
                  <li>The unit must currently be vacant (not occupied by another tenant)</li>
                  <li>The unit must still be assigned to this tenant on record</li>
                </ul>
                <p className="mt-1.5 text-[11px] text-amber-600">If these conditions are not met, the system will reject the restoration with a clear reason.</p>
              </div>

              <div>
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">Restoration notes <span className="font-normal text-slate-400">(optional)</span></label>
                <textarea
                  rows={2}
                  value={restoreForm.notes}
                  onChange={(e) => setRestoreForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Reason for restoring this tenant..."
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                onClick={() => { if (!isRestoring) setShowRestoreModal(false); }}
                disabled={isRestoring}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                Cancel
              </button>
              <button
                onClick={confirmRestoreTenant}
                disabled={!canUpdateTenant || isRestoring}
                className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                {isRestoring ? "Restoring…" : "Restore Tenant"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDepositSettlementModal && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="bg-[#0B3B2E] px-6 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">Deposit Settlement</p>
                  <h3 className="mt-0.5 text-base font-bold text-white">Terminate Tenant Settlement Workspace</h3>
                  <p className="mt-0.5 text-xs text-white/70">Apply deposit, refund the balance, or retain charges without leaving the terminated tenants page.</p>
                </div>
                <button
                  onClick={closeDepositSettlementModal}
                  disabled={isProcessingDepositSettlement}
                  className="flex h-7 w-7 items-center justify-center rounded text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-60"
                >
                  <FaTimes size={13} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-4 xl:grid-cols-[1.3fr,0.95fr]">
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Tenant</p>
                      <p className="mt-1.5 text-sm font-bold text-slate-900">{depositSettlementTenant?.tenantName || "-"}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{depositSettlementTenant?.tenantCode || "-"}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Property / Unit</p>
                      <p className="mt-1.5 text-sm font-bold text-slate-900">{depositSettlementTenant?.propertyName || "-"}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{depositSettlementTenant?.unitNumber || "-"}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Termination Date</p>
                      <p className="mt-1.5 text-sm font-bold text-slate-900">{depositSettlementTenant?.terminationDate || "-"}</p>
                      <p className="mt-0.5 text-xs text-slate-500">Move-out {depositSettlementTenant?.moveOutDate || "-"}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Deposit Holder</p>
                      <p className="mt-1.5 text-sm font-bold text-slate-900">{depositSettlementDerived.depositHolder}</p>
                      <p className="mt-0.5 text-xs text-slate-500">Refund {depositSettlementDerived.canRefund ? "allowed" : "blocked"}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">Deposit Held</p>
                      <p className="mt-1.5 text-xl font-black text-amber-950">Ksh {depositSettlementDerived.depositHeld.toLocaleString()}</p>
                    </div>
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-700">Outstanding Balance</p>
                      <p className="mt-1.5 text-xl font-black text-red-900">Ksh {depositSettlementDerived.outstandingBalance.toLocaleString()}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Remaining After Apply</p>
                      <p className="mt-1.5 text-xl font-black text-emerald-900">Ksh {depositSettlementDerived.remainingAfterApply.toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Choose settlement action</p>
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      {[
                        { key: "apply", title: "Apply Deposit to Balance", caption: "Use the deposit to clear open arrears first." },
                        { key: "refund", title: "Refund Remaining Deposit", caption: depositSettlementDerived.canRefund ? "Post a manager-held refund to cash or bank." : "Blocked for landlord-held deposits." },
                        { key: "retain", title: "Retain Deposit (Charges)", caption: "Create a charge invoice, then clear it from deposit." },
                      ].map((option) => {
                        const disabled = option.key === "refund" && !depositSettlementDerived.canRefund;
                        const active = depositSettlementAction === option.key;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            disabled={disabled || isProcessingDepositSettlement}
                            onClick={() => setDepositSettlementAction(option.key)}
                            className={`rounded-lg border px-3 py-3 text-left transition ${
                              active
                                ? "border-[#0B3B2E] bg-[#0B3B2E] text-white shadow-md"
                                : disabled
                                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                : "border-slate-200 bg-slate-50 text-slate-900 hover:border-[#0B3B2E]/30 hover:bg-[#0B3B2E]/5"
                            }`}
                          >
                            <p className="text-xs font-bold">{option.title}</p>
                            <p className={`mt-1 text-[11px] ${active ? "text-white/75" : "text-slate-500"}`}>{option.caption}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Smart calculation</p>
                        <h4 className="mt-0.5 text-sm font-bold text-slate-900">Settlement preview</h4>
                      </div>
                      {depositSettlementContext.loading && <span className="text-xs text-slate-500">Loading...</span>}
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Apply To Arrears</p>
                        <p className="mt-1 text-base font-black text-slate-900">Ksh {depositSettlementDerived.baseApplyAmount.toLocaleString()}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Refund Amount</p>
                        <p className="mt-1 text-base font-black text-slate-900">Ksh {depositSettlementDerived.safeRefundAmount.toLocaleString()}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Retain Amount</p>
                        <p className="mt-1 text-base font-black text-slate-900">Ksh {depositSettlementDerived.safeRetainAmount.toLocaleString()}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Final Balance</p>
                        <p className="mt-1 text-base font-black text-slate-900">Ksh {depositSettlementDerived.finalBalance.toLocaleString()}</p>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">Refund amount</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={depositSettlementAction !== "refund" || !depositSettlementDerived.canRefund}
                          value={depositSettlementForm.refundAmount}
                          onChange={(e) => setDepositSettlementForm((prev) => ({ ...prev, refundAmount: e.target.value }))}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10 disabled:bg-slate-100"
                          placeholder="0.00"
                        />
                        <p className="mt-1 text-[10px] text-slate-500">Capped at the deposit left after arrears are applied.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">Retain amount</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={depositSettlementAction !== "retain"}
                          value={depositSettlementForm.retainAmount}
                          onChange={(e) => setDepositSettlementForm((prev) => ({ ...prev, retainAmount: e.target.value }))}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10 disabled:bg-slate-100"
                          placeholder="0.00"
                        />
                        <p className="mt-1 text-[10px] text-slate-500">Retained via a charge invoice and deposit settlement trail.</p>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">Cash / bank account for refund</label>
                        <select
                          value={depositSettlementForm.cashbookAccountId}
                          disabled={depositSettlementAction !== "refund" || !depositSettlementDerived.canRefund}
                          onChange={(e) => setDepositSettlementForm((prev) => ({ ...prev, cashbookAccountId: e.target.value }))}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10 disabled:bg-slate-100"
                        >
                          <option value="">Select cash or bank account</option>
                          {cashbookAccounts.map((account) => (
                            <option key={normalizeId(account?._id)} value={normalizeId(account?._id)}>
                              {account?.name || account?.accountName || "Unnamed account"}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">Reason / narration</label>
                        <textarea
                          rows={3}
                          value={depositSettlementForm.reason}
                          onChange={(e) => setDepositSettlementForm((prev) => ({ ...prev, reason: e.target.value }))}
                          placeholder="Move-out arrears cleared, damage retention, tenant refund reference..."
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Accounting preview</p>
                    <div className="mt-3 space-y-2 text-xs text-slate-700">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <p className="font-bold text-slate-900">Apply deposit</p>
                        <p className="mt-1">DR Deposit Liability</p>
                        <p>CR Tenant Receivable</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <p className="font-bold text-slate-900">Refund (manager-held only)</p>
                        <p className="mt-1">DR Deposit Liability</p>
                        <p>CR Cash / Bank</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <p className="font-bold text-slate-900">Retention</p>
                        <p className="mt-1">Create charge invoice first, then clear it from the deposit trail.</p>
                      </div>
                      {!depositSettlementDerived.canRefund && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900">
                          <p className="font-bold">Landlord-held deposit rule</p>
                          <p className="mt-1">This workspace will not post cash or bank refunds when the deposit is held by the landlord.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Open invoices for settlement</p>
                        <h4 className="mt-0.5 text-sm font-bold text-slate-900">Automatic deposit allocation</h4>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                        {depositSettlementContext.creditableInvoices.length} open
                      </span>
                    </div>
                    <div className="mt-3 max-h-[220px] overflow-y-auto rounded-lg border border-slate-200">
                      {depositSettlementContext.creditableInvoices.length > 0 ? (
                        <table className="min-w-full text-[11px] border-collapse">
                          <thead className="bg-[#0B3B2E] text-white">
                            <tr>
                              <th className="px-3 py-1 text-left font-bold border-r border-white/10">Invoice</th>
                              <th className="px-3 py-1 text-left font-bold border-r border-white/10">Category</th>
                              <th className="px-3 py-1 text-right font-bold">Open</th>
                            </tr>
                          </thead>
                          <tbody>
                            {depositSettlementContext.creditableInvoices.map((invoice, i) => (
                              <tr key={normalizeId(invoice?._id)} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}>
                                <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{invoice?.invoiceNumber || "-"}</td>
                                <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{String(invoice?.category || "-").replace(/_/g, " ")}</td>
                                <td className="px-3 py-1 text-right font-bold text-slate-900">Ksh {roundMoney(invoice?.remainingCreditableAmount ?? invoice?.remainingBalance ?? 0).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="px-4 py-6 text-center text-xs text-slate-500">No open posted invoices available for automatic crediting.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#0B3B2E]/15 bg-[#0B3B2E]/5 px-4 py-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#0B3B2E]">Final confirmation</p>
                    <div className="mt-3 space-y-1.5 text-xs text-slate-700">
                      <p><span className="font-bold text-slate-900">Action:</span> {depositSettlementAction.replace(/_/g, " ")}</p>
                      <p><span className="font-bold text-slate-900">Apply amount:</span> Ksh {depositSettlementDerived.baseApplyAmount.toLocaleString()}</p>
                      <p><span className="font-bold text-slate-900">Refund amount:</span> Ksh {depositSettlementDerived.safeRefundAmount.toLocaleString()}</p>
                      <p><span className="font-bold text-slate-900">Retain amount:</span> Ksh {depositSettlementDerived.safeRetainAmount.toLocaleString()}</p>
                      <p><span className="font-bold text-slate-900">Deposit left after settlement:</span> Ksh {roundMoney(
                        depositSettlementDerived.depositHeld - depositSettlementDerived.baseApplyAmount - (depositSettlementAction === "refund" ? depositSettlementDerived.safeRefundAmount : 0) - (depositSettlementAction === "retain" ? depositSettlementDerived.safeRetainAmount : 0)
                      ).toLocaleString()}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <button
                        onClick={closeDepositSettlementModal}
                        disabled={isProcessingDepositSettlement}
                        className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={processDepositSettlement}
                        disabled={isProcessingDepositSettlement || depositSettlementContext.loading}
                        className="rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white shadow-md transition hover:bg-[#0a2f25] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isProcessingDepositSettlement ? "Processing..." : "Confirm Settlement"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/0 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md transform transition-all">
            <div className="bg-gradient-to-r from-red-600 to-red-700 px-6 py-4 rounded-t-lg">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <FaTrash size={18} />
                Confirm Delete
              </h3>
            </div>

            <div className="p-6">
              <p className="text-gray-700 mb-4">
                Delete <strong>{selectedDeletableTenants.length}</strong> eligible tenant record(s).
              </p>
              <p className="text-sm text-red-600 font-semibold">
                ⚠️ Only unused tenant records will be deleted. Active or historical tenants stay protected.
              </p>

              {selectedDeletableTenants.length > 0 && (
                <div className="mt-4 p-3 bg-gray-50 rounded border border-gray-200">
                  <p className="text-xs text-gray-600 mb-2">Eligible tenants to be deleted:</p>
                  <ul className="text-xs text-gray-700 space-y-1 max-h-32 overflow-y-auto">
                    {selectedDeletableTenants.slice(0, 10).map((tenant) => (
                      <li key={tenant.id} className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                        <span className="font-semibold">{toListingCaps(tenant.tenantCode)}</span> - {toListingCaps(tenant.tenantName)}
                      </li>
                    ))}
                    {selectedDeletableTenants.length > 10 && (
                      <li className="text-gray-500 italic">
                        ...and {selectedDeletableTenants.length - 10} more
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {selectedTenantRows.length > selectedDeletableTenants.length && (
                <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  {selectedTenantRows.length - selectedDeletableTenants.length} selected tenant(s) will be skipped because they are still active, have balances, or already have history.
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 py-4 bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="flex-1 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-md font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteTenants}
                disabled={!canDeleteTenant || isDeleting || selectedDeletableTenants.length === 0}
                className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <FaSpinner className="animate-spin" size={14} />
                    Deleting...
                  </>
                ) : (
                  <>
                    <FaTrash size={14} />
                    Delete {selectedDeletableTenants.length} Tenant(s)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <CommunicationComposerModal
        open={showCommunicationModal}
        onClose={() => setShowCommunicationModal(false)}
        businessId={currentCompany?._id || ""}
        contextType="tenant_bulk"
        recordIds={selectedTenants}
        title="SMS Tenants"
        subtitle="Use tenant-relevant templates only and preview the resolved message first."
        allowedChannels={["sms"]}
        defaultChannel="sms"
      />

      {/* ===== TENANTS IMPORT MODAL ===== */}
      <TenantsImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleBulkImport}
      />

      {/* ===== ADD UTILITY MODAL ===== */}
      {showAddUtilityModal && selectedTenants.length > 0 && (() => {
        const rawTenants = (Array.isArray(tenantsData) ? tenantsData : []).filter((t) =>
          selectedTenants.includes(normalizeId(t._id))
        );
        if (rawTenants.length === 0) return null;
        return (
          <AddUtilityModal
            tenants={rawTenants}
            allUnits={units}
            company={currentCompany}
            dispatch={dispatch}
            onClose={() => setShowAddUtilityModal(false)}
            onSaved={() => dispatch(getTenants({ business: currentCompany?._id }))}
          />
        );
      })()}
    </DashboardLayout>
  );
};

export default Tenants;
import React, { useCallback, useState, useEffect, useMemo } from "react";
import { fmtDate } from "../../utils/dates";
import { useTerms } from "../../hooks/useTerm";
import StatementLedgerTab from "../../components/common/StatementLedgerTab";
import { useTabState } from "../../hooks/useTabState";
import { useEntityCache } from "../../hooks/useEntityCache";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { getTenantName, getUnitLabel } from "../../utils/tenantUtils";
import {
  formatStatementLongPeriod,
  cleanStatementPart,
  uniqueStatementParts,
  extractUtilityNamesFromInvoice,
  getInvoiceCategoryLabel,
  buildInvoiceNarration,
} from "../../utils/invoiceNarrationUtils";
import { safeId } from "../../utils/idUtils";
import { isActiveReceipt } from "../../utils/receiptUtils";
import {
  selectCurrentCompany,
  selectAllLeases,
  selectAllUnits,
  selectAllProperties,
} from "../../redux/selectors";
import { getUnits } from "../../redux/unitRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getLeasesSuccess } from "../../redux/leasesRedux";
import {
  getLeases,
  getUtilities,
  getTenantStatementBundle,
  createTenantInvoice,
  updateLease,
  updateLeaseReviews,
  sendCommunicationMessage,
} from "../../redux/apiCalls";
import { deleteTenantInvoicesBatch } from "../../redux/invoiceApi";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import Spinner from "../../components/common/Spinner";
import SingleBookingModal from "./SingleBookingModal";
import AppSelect from "../../components/common/AppSelect";
import { toast } from "react-toastify";
import { fetchCompanySettings, selectCompanySettings } from "../../redux/companySettingsRedux";
import { normalizeCompanyTaxConfig } from "./invoiceTaxUtils";
import {
  FaArrowLeft,
  FaDownload,
  FaPrint,
  FaChartLine,
  FaFileInvoiceDollar,
  FaCalendarAlt,
  FaUser,
  FaMoneyBillWave,
  FaChartBar,
  FaCog,
  FaPlus,
  FaEdit,
  FaTrash,
  FaCheck,
  FaTimes,
  FaLink,
  FaSms,
  FaArrowUp,
  FaArrowDown,
  FaLock,
  FaSearch,
  FaEnvelope,
  FaBan,
  FaSnowflake,
  FaSun,
  FaSync,
} from "react-icons/fa";

const MILIK_GREEN = "bg-[#165946]";
const DEFAULT_SCHEDULE_MONTHS = 12;

const computeNewRent = (current, type, value, direction = "increase") => {
  const v = Number(value) || 0;
  if (type === "fixed_rent") return Math.max(0, Math.round(v));
  const sign = direction === "decrease" ? -1 : 1;
  if (type === "percentage") return Math.max(0, Math.round(current * (1 + sign * v / 100)));
  return Math.max(0, Math.round(current + sign * v));
};

const computeNextDate = (dateStr, frequency) => {
  const d = new Date(dateStr);
  if (frequency === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (frequency === "biannual") d.setMonth(d.getMonth() + 6);
  else d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

const formatFrequency = (frequency) => {
  if (frequency === "biannual") return "Bi-Annual";
  if (frequency === "quarterly") return "Quarterly";
  if (frequency === "once") return "One-Off";
  return "Yearly";
};

const fmtMoney = (n) => `KES ${Number(n || 0).toLocaleString()}`;

const reviewInputCls = "h-8 w-full border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const reviewLabelCls = "mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500";

const formatPeriodLabel = (dateValue) => {
  const dt = new Date(dateValue);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};

const buildPeriodKey = (year, month) => `${year}-${String(Number(month) + 1).padStart(2, "0")}`;

const normalizeBillingPeriodKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

const BILLING_PERIOD_ALIASES = {
  monthly: "monthly",
  quarter: "quarterly",
  quarterly: "quarterly",
  annually: "annual",
  annual: "annual",
  yearly: "annual",
  semi_annual: "semi_annual",
  semiannual: "semi_annual",
  semi_annually: "semi_annual",
  biannual: "semi_annual",
  bi_annually: "semi_annual",
  bi_monthly: "bi_monthly",
  bimonthly: "bi_monthly",
};

const canonicalBillingPeriodKey = (value = "") => {
  const normalized = normalizeBillingPeriodKey(value);
  return BILLING_PERIOD_ALIASES[normalized] || normalized || "monthly";
};

const normalizeBillingPeriods = (settings = null) => {
  const source = Array.isArray(settings?.billingPeriods) ? settings.billingPeriods : [];
  const normalized = source
    .filter((item) => item?.isActive !== false)
    .map((item) => ({
      key: canonicalBillingPeriodKey(item?.key || item?.name || "monthly"),
      name: String(item?.name || "Billing Period").trim() || "Billing Period",
      durationInMonths: Math.max(1, Number(item?.durationInMonths || 1)),
    }))
    .filter((item, index, arr) => item.key && arr.findIndex((entry) => entry.key === item.key) === index);

  return normalized.length > 0 ? normalized : [{ key: "monthly", name: "Monthly", durationInMonths: 1 }];
};

const addMonthsPreservingDay = (dateValue, monthsToAdd = 1) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const originalDay = date.getDate();
  const next = new Date(date.getFullYear(), date.getMonth() + Number(monthsToAdd || 0), 1);
  const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(originalDay, maxDay));
  next.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
  return next;
};

const buildScheduleLabel = ({ startDate, endDate, billingPeriod }) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "-";
  if (Number(billingPeriod?.durationInMonths || 1) <= 1) {
    return start.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  return `${start.toLocaleDateString("en-US", { month: "short", year: "2-digit" })} - ${end.toLocaleDateString("en-US", { month: "short", year: "2-digit" })}`;
};

const buildSchedulePeriodKey = ({ startDate, billingPeriodKey = "monthly" }) => {
  const dt = new Date(startDate);
  if (Number.isNaN(dt.getTime())) return `monthly:${new Date().toISOString()}`;
  return `${canonicalBillingPeriodKey(billingPeriodKey)}:${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

const formatInputDate = (value) => {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDisplayDate = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
};

const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const buildCombinedInvoiceMetadata = ({ utilityAmount = 0, utilityLabel = "", periodLabel = "" } = {}) => ({
  billItemKey: "rent_utility:combined",
  billItemLabel: "Combined Rent + Utilities",
  invoicePriorityCategory: "rent",
  sourceTransactionType: "tenant_statement_combined",
  utilityBreakdown:
    Number(utilityAmount || 0) > 0
      ? [
          {
            label: String(utilityLabel || "Utility").trim() || "Utility",
            amount: Number(utilityAmount || 0),
            periodLabel,
          },
        ]
      : [],
});



const isReceiptReversed = (payment) => {
  const postingStatus = String(payment?.postingStatus || "").toLowerCase();
  return payment?.isReversed === true || Boolean(payment?.reversalOf) || postingStatus === "reversed";
};

const getReceiptAllocationRows = (payment) =>
  Array.isArray(payment?.allocations) ? payment.allocations : [];

const getReceiptAllocationLabel = (row = {}) => {
  const priority = String(row?.priorityGroup || "").toLowerCase();
  if (priority === "utility") {
    const utilityType = String(row?.utilityType || "").trim();
    return utilityType ? `Utility · ${utilityType}` : "Utility";
  }
  if (priority === "deposit") return "Deposit";
  if (priority === "late_penalty") return "Late Penalty";
  if (priority === "debit_note") return "Debit Note";
  if (priority === "rent") return "Rent";
  return row?.category || "Other";
};


// Builds a human-readable description for a credit/debit note statement row.
// Priority: specific utility name → category label → stored description → fallback.
const buildNoteDescription = (note, isCredit) => {
  const noteNum = note.noteNumber || note.invoiceNumber || "";
  const category = String(note.category || "").toUpperCase();
  const storedDesc = cleanStatementPart(note.description || "");
  const sourceRef = note.sourceInvoiceNumber ? ` (against ${note.sourceInvoiceNumber})` : "";

  if (category === "UTILITY_CHARGE") {
    const utilityNames = extractUtilityNamesFromInvoice(note);
    const utilityLabel = utilityNames.length > 0
      ? uniqueStatementParts(utilityNames.map((u) => u.charAt(0).toUpperCase() + u.slice(1).toLowerCase())).slice(0, 2).join(" & ")
      : "Utility";
    const typeWord = isCredit ? "Credit" : "Charge";
    return cleanStatementPart(`${utilityLabel} ${typeWord} – ${noteNum}${sourceRef}`);
  }

  if (category === "RENT_CHARGE") {
    return cleanStatementPart(`${isCredit ? "Rent Credit" : "Rent Charge"} – ${noteNum}${sourceRef}`);
  }

  if (category === "DEPOSIT_CHARGE") {
    return cleanStatementPart(`${isCredit ? "Deposit Refund" : "Deposit Charge"} – ${noteNum}${sourceRef}`);
  }

  if (category === "LATE_PENALTY_CHARGE") {
    return cleanStatementPart(`${isCredit ? "Penalty Credit" : "Late Penalty"} – ${noteNum}${sourceRef}`);
  }

  // OTHER_CHARGE: use stored description if it's not just the generic "Debit/Credit Note DNXXXXX"
  const isGenericDesc = /^(debit|credit)\s+note\s*/i.test(storedDesc);
  if (storedDesc && !isGenericDesc) {
    return cleanStatementPart(`${storedDesc}${noteNum ? ` – ${noteNum}` : ""}${sourceRef}`);
  }

  return cleanStatementPart(`${isCredit ? "Credit Note" : "Debit Note"} ${noteNum}${sourceRef}`);
};

const buildTenantStatementReceiptDescription = (payment = {}, invoiceMap = new Map()) => {
  const reference = cleanStatementPart(payment?.referenceNumber || "");
  const allocationRows = getReceiptAllocationRows(payment);
  const parts = [];

  allocationRows.forEach((row) => {
    const invoiceId = String(row?.invoice || row?.invoiceId || "");
    const invoice = invoiceMap.get(invoiceId) || null;
    const period = formatStatementLongPeriod(
      invoice?.invoiceDate || invoice?.createdAt || row?.invoiceDate || payment?.paymentDate || payment?.createdAt
    );
    const rawLabel = cleanStatementPart(getReceiptAllocationLabel(row));
    const label = rawLabel.replace(/\s*·\s*/g, " ");

    if (label && period) {
      parts.push(`${label} ${period}`);
    } else if (label) {
      parts.push(label);
    }
  });

  const uniqueParts = uniqueStatementParts(parts);
  const hasUnapplied = Number(payment?.allocationSummary?.unapplied || 0) > 0;
  if (hasUnapplied) {
    uniqueParts.push("Unapplied Credit");
  }

  const allocationText = uniqueParts.length > 0 ? ` – ${uniqueParts.join(" + ")}` : "";
  const referenceText = reference ? ` – Ref: ${reference}` : "";

  return cleanStatementPart(`Payment Received${allocationText}${referenceText}`) || "Payment Received";
};

const TenantStatement = () => {
  const { id: tenantId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const initialRequestedTab = String(location.state?.initialTab || "statement").trim().toLowerCase();
  const [activeTab, setActiveTab] = useTabState(
    `${location.pathname}:activeTab`,
    ["statement", "billing", "reviews"].includes(initialRequestedTab) ? initialRequestedTab : "statement"
  );
  // Lifted filter state — shared between the statement tab view and print/PDF.
  const [stmtFrom,       setStmtFrom]       = useState("2000-01-01");
  const [stmtTo,         setStmtTo]         = useState(formatInputDate(new Date()));
  const [stmtTypeFilter, setStmtTypeFilter] = useState("ALL");
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const [allocationTraceTarget, setAllocationTraceTarget] = useState(null);
  const [editingReviewId, setEditingReviewId] = useState(null);
  const [reviewRecords, setReviewRecords] = useState([]);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewForm, setReviewForm] = useState({
    reviewType: "escalation",
    type: "percentage",
    direction: "increase",
    value: 5,
    frequency: "yearly",
    effectiveDate: new Date().toISOString().split("T")[0],
    note: "",
  });
  const [pendingNoticeReview, setPendingNoticeReview] = useState(null);
  const [sendingNotice, setSendingNotice] = useState(false);
  const [sendingStatementSms, setSendingStatementSms] = useState(false);
  const [sendingStatementEmail, setSendingStatementEmail] = useState(false);
  const [selectedSchedules, setSelectedSchedules] = useState([]);
  const [showDeleteScheduleModal, setShowDeleteScheduleModal] = useState(false);
  const [showFreezeScheduleModal, setShowFreezeScheduleModal] = useState(false);
  const [showEditScheduleModal, setShowEditScheduleModal] = useState(false);
  const [localBillingScheduleAdjustments, setLocalBillingScheduleAdjustments] = useState([]);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [savingScheduleAction, setSavingScheduleAction] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    from: "",
    to: "",
    rent: "",
    utility: "",
  });
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [selectedSchedulePeriod, setSelectedSchedulePeriod] = useState(null);
  const [invoiceRefresh, setInvoiceRefresh] = useState(0);
  const [tenantInvoices, setTenantInvoices] = useState([]);
  const [tenantInvoiceNotes, setTenantInvoiceNotes] = useState([]);
  const [scheduleDefinedPeriod, setScheduleDefinedPeriod] = useState("custom");
  const [scheduleFilterFrom, setScheduleFilterFrom] = useState("");
  const [scheduleFilterTo, setScheduleFilterTo] = useState("");
  const [scheduleSearchText, setScheduleSearchText] = useState("");
  const [scheduleExtensionMonths, setScheduleExtensionMonths] = useState(0);
  const companyTaxConfig = useSelector(selectCompanySettings);

  const currentCompany = useSelector(selectCurrentCompany);
  const { tenant: termTenant, rent: termRent, landlord: termLandlord, unit: termUnit } = useTerms("tenant", "rent", "landlord", "unit");
  const { propertiesLoaded, unitsLoaded } = useEntityCache(currentCompany?._id);
  const [tenantData, setTenantData] = useState(null);
  const [tenantLoading, setTenantLoading] = useState(true);
  const leasesFromStore = useSelector(selectAllLeases);
  const [tenantPayments, setTenantPayments] = useState([]);
  const unitsFromStore = useSelector(selectAllUnits);
  const propertiesFromStore = useSelector(selectAllProperties);
  const normalizedTaxConfig = useMemo(
    () => normalizeCompanyTaxConfig(companyTaxConfig),
    [companyTaxConfig]
  );

  const tenant = tenantData;

  useEffect(() => {
    const requestedTab = String(location.state?.initialTab || "").trim().toLowerCase();
    const allowedTabs = ["statement", "billing", "reviews"];

    if (requestedTab && allowedTabs.includes(requestedTab)) {
      setActiveTab(requestedTab);
    }

    if (requestedTab === "reviews" && location.state?.openReviewForm) {
      setReviewFormOpen(true);
    }
  // location.state is a new object reference on every navigation — only key and tenantId are stable identifiers
  }, [tenantId, location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const tenantUnitRecord = useMemo(() => {
    const unitId = tenant?.unit?._id || tenant?.unit || null;
    return unitsFromStore.find((unit) => String(unit?._id || "") === String(unitId || "")) || null;
  }, [tenant, unitsFromStore]);

  const tenantDepositAmount = useMemo(() => {
    return Number(tenant?.depositAmount ?? tenantUnitRecord?.deposit ?? tenant?.unit?.deposit ?? 0);
  }, [tenant, tenantUnitRecord]);

  const tenantDepositHolder = useMemo(() => {
    if (tenant?.depositHeldBy) return tenant.depositHeldBy;
    const propertyHeldBy = tenantUnitRecord?.property?.depositHeldBy;
    return propertyHeldBy === "landlord" ? termLandlord : "Management Company";
  }, [tenant, tenantUnitRecord, termLandlord]);

  const activeDepositInvoices = useMemo(() => {
    return (tenantInvoices || []).filter((invoice) => {
      const invoiceTenantId = safeId(invoice?.tenant);
      const status = String(invoice?.status || "").toLowerCase();
      const category = String(invoice?.category || "").toUpperCase();
      return (
        invoiceTenantId === String(tenantId) &&
        category === "DEPOSIT_CHARGE" &&
        !["cancelled", "reversed"].includes(status)
      );
    });
  }, [tenantInvoices, tenantId]);

  const depositInvoiceSummary = activeDepositInvoices[0] || null;
  const hasActiveDepositInvoice = activeDepositInvoices.length > 0;

  const resolveTenantPropertyName = (targetTenant) => {
    if (!targetTenant) return "-";

    const directPropertyName =
      targetTenant?.unit?.property?.propertyName ||
      targetTenant?.property?.propertyName ||
      targetTenant?.propertyName;
    if (directPropertyName) return directPropertyName;

    const tenantUnitId = targetTenant?.unit?._id || targetTenant?.unit;
    const tenantUnitIdStr = tenantUnitId ? String(tenantUnitId) : "";
    const matchedUnit = unitsFromStore.find((unit) => String(unit?._id || "") === tenantUnitIdStr);
    const propertyIdFromUnit = matchedUnit?.property?._id || matchedUnit?.property;
    const propertyIdFromTenant = targetTenant?.property?._id || targetTenant?.property;
    const resolvedPropertyId = propertyIdFromUnit || propertyIdFromTenant;
    const resolvedPropertyIdStr = resolvedPropertyId ? String(resolvedPropertyId) : "";
    const matchedProperty = propertiesFromStore.find(
      (property) => String(property?._id || "") === resolvedPropertyIdStr
    );

    return (
      matchedUnit?.property?.propertyName ||
      matchedProperty?.propertyName ||
      matchedProperty?.name ||
      "-"
    );
  };

  const resolveTenantUnitNumber = (targetTenant) => {
    if (!targetTenant) return "-";

    const resolveLabel = (unitRef) => {
      if (!unitRef) return null;
      if (unitRef?.unitNumber) return unitRef.unitNumber;
      const id = String(unitRef?._id || unitRef || "");
      if (!id) return null;
      const matched = unitsFromStore.find((u) => String(u?._id || "") === id);
      return getUnitLabel(matched) || null;
    };

    const primaryLabel = resolveLabel(targetTenant?.unit);
    const additionalLabels = Array.isArray(targetTenant?.additionalUnits)
      ? targetTenant.additionalUnits.map(resolveLabel).filter(Boolean)
      : [];

    const labels = [primaryLabel, ...additionalLabels].filter(Boolean);
    return labels.length ? labels.join(", ") : "-";
  };

  const resolveTenantInvoiceContext = (targetTenant) => {
    if (!targetTenant?._id) {
      throw new Error("Tenant context is missing.");
    }

    const unitId = targetTenant?.unit?._id || targetTenant?.unit || null;
    const matchedUnit = unitsFromStore.find(
      (unit) => String(unit?._id || "") === String(unitId || "")
    );

    const propertyId =
      targetTenant?.property?._id ||
      targetTenant?.property ||
      matchedUnit?.property?._id ||
      matchedUnit?.property ||
      targetTenant?.unit?.property?._id ||
      targetTenant?.unit?.property ||
      null;

    const matchedProperty = propertiesFromStore.find(
      (property) => String(property?._id || "") === String(propertyId || "")
    );

    const landlordId =
      matchedProperty?.landlords?.[0]?.landlordId?._id ||
      matchedProperty?.landlords?.[0]?.landlordId ||
      matchedProperty?.landlords?.[0]?._id ||
      matchedProperty?.landlords?.[0] ||
      targetTenant?.landlord?._id ||
      targetTenant?.landlord ||
      null;

    if (!currentCompany?._id) {
      throw new Error("Business context is missing.");
    }

    if (!propertyId) {
      throw new Error("Property is missing on the selected tenant.");
    }

    if (!landlordId) {
      throw new Error("Landlord is missing on the selected property's record.");
    }

    if (!unitId) {
      throw new Error("Unit is missing on the selected tenant.");
    }

    return {
      business: currentCompany._id,
      property: propertyId,
      landlord: landlordId,
      unit: unitId,
    };
  };

  const tenantLease = useMemo(() => {
    const tenantKey = safeId(tenantId);
    const tenantUnitKey = safeId(tenant?.unit?._id || tenant?.unit);
    const tenantLeases = (Array.isArray(leasesFromStore) ? leasesFromStore : []).filter((lease) => {
      const leaseTenantKey = safeId(lease?.tenant);
      const leaseUnitKey = safeId(lease?.unit);
      return (tenantKey && leaseTenantKey === tenantKey) || (tenantUnitKey && leaseUnitKey === tenantUnitKey);
    });

    if (tenantLeases.length === 0) return null;

    const preferredStatuses = ["active", "pending_signature", "draft", "renewed", "expired", "terminated", "cancelled"];
    tenantLeases.sort((a, b) => {
      const statusRankA = preferredStatuses.indexOf(String(a?.status || "").toLowerCase());
      const statusRankB = preferredStatuses.indexOf(String(b?.status || "").toLowerCase());
      const normalizedRankA = statusRankA === -1 ? preferredStatuses.length : statusRankA;
      const normalizedRankB = statusRankB === -1 ? preferredStatuses.length : statusRankB;
      if (normalizedRankA !== normalizedRankB) return normalizedRankA - normalizedRankB;

      const startA = new Date(a?.startDate || a?.createdAt || 0).getTime();
      const startB = new Date(b?.startDate || b?.createdAt || 0).getTime();
      return startB - startA;
    });

    return tenantLeases[0] || null;
  }, [leasesFromStore, tenantId, tenant?.unit]);

  useEffect(() => {
    const rows = Array.isArray(tenantLease?.billingScheduleAdjustments)
      ? tenantLease.billingScheduleAdjustments
      : [];
    setLocalBillingScheduleAdjustments(rows);
  }, [tenantLease]);

  const billingScheduleAdjustmentsByPeriod = useMemo(() => {
    return (Array.isArray(localBillingScheduleAdjustments) ? localBillingScheduleAdjustments : []).reduce((acc, item) => {
      if (item?.periodKey) {
        acc[item.periodKey] = item;
      }
      return acc;
    }, {});
  }, [localBillingScheduleAdjustments]);

  useEffect(() => {
    const rows = Array.isArray(tenantLease?.rentReviewRecords) ? tenantLease.rentReviewRecords : [];
    setReviewRecords(rows);
  }, [tenantLease]);

  useEffect(() => {
    document.title = "MILIK";
  }, []);

  useEffect(() => {
    if (currentCompany?._id) dispatch(fetchCompanySettings(currentCompany._id));
  }, [currentCompany?._id, dispatch]);

  useEffect(() => {
    if (!currentCompany?._id) return;

    if (!unitsLoaded) dispatch(getUnits({ business: currentCompany._id }));
    if (!propertiesLoaded) dispatch(getProperties({ business: currentCompany._id }));
    getUtilities(dispatch, currentCompany._id);

    getTenantStatementBundle(tenantId)
      .then((data) => {
        setTenantData(data.tenant || null);
        setTenantLoading(false);
        if (Array.isArray(data.leases)) {
          dispatch(getLeasesSuccess(data.leases));
        }
        setTenantPayments(data.receipts?.items ?? []);
        setTenantInvoices(Array.isArray(data.invoices) ? data.invoices : []);
        setTenantInvoiceNotes(Array.isArray(data.invoiceNotes) ? data.invoiceNotes : []);
      })
      .catch(() => { setTenantLoading(false); });
  }, [dispatch, currentCompany?._id, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!currentCompany?._id || !tenantId || invoiceRefresh === 0) return;
    // On subsequent refreshes (after invoice mutations), re-fetch invoices only
    const loadInvoices = async () => {
      try {
        const bundle = await getTenantStatementBundle(tenantId);
        setTenantInvoices(Array.isArray(bundle.invoices) ? bundle.invoices : []);
        setTenantInvoiceNotes(Array.isArray(bundle.invoiceNotes) ? bundle.invoiceNotes : []);
      } catch {
        // silent — stale data is preferable to crashing
      }
    };
    loadInvoices();
  }, [currentCompany?._id, tenantId, invoiceRefresh]);

  const handleCreateInvoice = async (invoiceData) => {
    try {
      await createTenantInvoice(invoiceData);
      toast.success("Invoice created successfully");
      setInvoiceRefresh((v) => v + 1);
      setShowInvoiceModal(false);
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (err) {
      toast.error("Failed to create invoice: " + (err?.response?.data?.error || err.message));
    }
  };

  const handleCancelInvoice = async () => {
    toast.info("Invoice cancellation is not enabled in the current backend route yet.");
  };

  // Stable reference so child handlers that call this don't cause re-renders of memoized subtrees
  const getInvoicesForPeriod = useCallback((periodRow, categories = ["RENT_CHARGE", "UTILITY_CHARGE"]) => {
    const allowedCategories = Array.isArray(categories)
      ? categories.map((category) => String(category || "").toUpperCase())
      : [];

    return tenantInvoices.filter((invoice) => {
      const invoicePeriod = formatPeriodLabel(invoice?.invoiceDate || invoice?.createdAt);
      const status = String(invoice?.status || "").toLowerCase();
      const invoiceCategory = String(invoice?.category || "").toUpperCase();
      const metadataPeriodKey = String(invoice?.metadata?.periodKey || "").trim();
      const rowPeriodKey = String(periodRow?.periodKey || "").trim();

      return (
        !["cancelled", "reversed"].includes(status) &&
        (allowedCategories.length === 0 || allowedCategories.includes(invoiceCategory)) &&
        ((metadataPeriodKey && rowPeriodKey && metadataPeriodKey === rowPeriodKey) ||
          (!metadataPeriodKey && invoicePeriod === periodRow?.description))
      );
    });
  }, [tenantInvoices]);

  const validTenantInvoices = useMemo(() => {
    return tenantInvoices
      .filter((invoice) => {
        const invoiceTenantId = safeId(invoice?.tenant);
        const status = String(invoice?.status || "").toLowerCase();
        return invoiceTenantId === String(tenantId) && !["cancelled", "reversed"].includes(status);
      })
      .sort((a, b) => new Date(a.invoiceDate || a.createdAt) - new Date(b.invoiceDate || b.createdAt));
  }, [tenantInvoices, tenantId]);

  const activeTenantReceipts = useMemo(() => {
    return tenantPayments
      .filter((payment) => safeId(payment?.tenant) === String(tenantId) && isActiveReceipt(payment))
      .sort((a, b) => new Date(a.paymentDate || a.createdAt) - new Date(b.paymentDate || b.createdAt));
  }, [tenantPayments, tenantId]);

  const statementData = useMemo(() => {
    const transactions = [];
    let transactionId = 1;

    const invoiceMap = new Map(validTenantInvoices.map((invoice) => [safeId(invoice), invoice]));

    validTenantInvoices.forEach((invoice) => {
      // invoice.unit may be a populated object {_id, unitNumber, name} from the API
      // or a raw ObjectId string — handle both
      const unitLabel = invoice?.unit
        ? (typeof invoice.unit === "object"
            ? getUnitLabel(invoice.unit)
            : getUnitLabel(unitsFromStore.find((u) => String(u?._id || "") === String(invoice.unit))))
        : "";
      transactions.push({
        id: transactionId++,
        date: invoice.invoiceDate || invoice.createdAt,
        description: buildInvoiceNarration(invoice, unitLabel),
        type: "CHARGE",
        amount: Number(invoice.amount || 0),
        transactionCode: invoice.invoiceNumber || `INV-${transactionId}`,
        sourceKind: "invoice",
        sourceId: safeId(invoice),
      });
    });

    tenantInvoiceNotes
      .filter((note) => {
        const status = String(note?.status || "").toLowerCase();
        return (
          String(note?.tenant?._id || note?.tenant || "") === String(tenantId) &&
          !["cancelled", "reversed"].includes(status)
        );
      })
      .sort((a, b) => new Date(a.noteDate || a.invoiceDate || a.createdAt) - new Date(b.noteDate || b.invoiceDate || b.createdAt))
      .forEach((note) => {
        const isCredit = String(note?.noteType || note?.documentType || "").toUpperCase() === "CREDIT_NOTE";
        transactions.push({
          id: transactionId++,
          date: note.noteDate || note.invoiceDate || note.createdAt,
          description: buildNoteDescription(note, isCredit),
          type: isCredit ? "CREDIT_NOTE" : "DEBIT_NOTE",
          amount: isCredit ? -Math.abs(Number(note.amount || 0)) : Math.abs(Number(note.amount || 0)),
          transactionCode: note.noteNumber || note.invoiceNumber || `NT-${transactionId}`,
          sourceKind: "note",
          sourceId: safeId(note),
        });
      });

    activeTenantReceipts.forEach((payment) => {
      transactions.push({
        id: transactionId++,
        date: payment.paymentDate || payment.createdAt,
        description: buildTenantStatementReceiptDescription(payment, invoiceMap),
        type: "PAYMENT",
        amount: -(Number(payment.amount || 0)),
        transactionCode: payment.receiptNumber || payment.referenceNumber || `RCP-${transactionId}`,
        sourceKind: "receipt",
        sourceId: safeId(payment),
      });
    });

    transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

    let runningBalance = 0;
    transactions.forEach((t) => {
      runningBalance += t.amount;
      t.balance = runningBalance;
    });

    let totalCharges = 0, totalCreditNotes = 0, totalPayments = 0;
    transactions.forEach((t) => {
      const abs = Math.abs(Number(t.amount || 0));
      if (t.type === "CHARGE" || t.type === "DEBIT_NOTE") totalCharges += abs;
      if (t.type === "CREDIT_NOTE") { totalCreditNotes += abs; totalPayments += abs; }
      if (t.type === "PAYMENT") totalPayments += abs;
    });
    const { totalAllocatedReceipts, unappliedCredits } = activeTenantReceipts.reduce((acc, receipt) => {
      const summary = receipt?.allocationSummary || {};
      const allocated = Number(summary?.rent || 0) + Number(summary?.utility || 0) + Number(summary?.deposit || 0) + Number(summary?.latePenalty || 0) + Number(summary?.debitNote || 0);
      const absAllocated = Math.abs(allocated);
      acc.totalAllocatedReceipts += absAllocated;
      const direct = summary?.unapplied;
      const derived = Math.max(0, Math.abs(Number(receipt?.amount || 0)) - absAllocated);
      acc.unappliedCredits += Math.abs(Number((direct ?? derived) || 0));
      return acc;
    }, { totalAllocatedReceipts: 0, unappliedCredits: 0 });
    const operationalOutstanding = round2(totalCharges - totalCreditNotes - totalAllocatedReceipts);
    const netPosition = round2(operationalOutstanding - unappliedCredits);

    return {
      transactions,
      totalCharges,
      totalPayments,
      totalCreditNotes: round2(totalCreditNotes),
      totalAllocatedReceipts: round2(totalAllocatedReceipts),
      unappliedCredits: round2(unappliedCredits),
      currentBalance: netPosition,
      operationalOutstanding,
      netPosition,
    };
  }, [validTenantInvoices, tenantInvoiceNotes, activeTenantReceipts, tenantId, tenant, unitsFromStore]);

  const allocationReceiptRows = useMemo(() => {
    return activeTenantReceipts.map((receipt) => {
      const allocations = getReceiptAllocationRows(receipt).map((row) => ({
        receiptId: safeId(receipt),
        receiptNumber: receipt?.receiptNumber || receipt?.referenceNumber || "-",
        receiptDate: receipt?.paymentDate || receipt?.createdAt || null,
        invoiceId: String(row?.invoice || row?.invoiceId || ""),
        invoiceNumber: row?.invoiceNumber || "-",
        label: getReceiptAllocationLabel(row),
        appliedAmount: round2(Math.abs(Number(row?.appliedAmount || 0))),
        afterOutstanding: round2(Math.abs(Number(row?.afterOutstanding || 0))),
      }));
      const allocatedAmount = round2(allocations.reduce((sum, row) => sum + Number(row?.appliedAmount || 0), 0));
      const unappliedAmount = round2(Math.max(0, Math.abs(Number(
        receipt?.allocationSummary?.unapplied ?? Math.abs(Number(receipt?.amount || 0)) - allocatedAmount
      ))));
      return {
        receiptId: safeId(receipt),
        receiptNumber: receipt?.receiptNumber || receipt?.referenceNumber || "-",
        paymentDate: receipt?.paymentDate || receipt?.createdAt || null,
        paymentType: receipt?.paymentType || "rent",
        amount: round2(Math.abs(Number(receipt?.amount || 0))),
        allocatedAmount,
        unappliedAmount,
        statusLabel: receipt?.isConfirmed ? "Confirmed" : "Pending",
        allocations,
      };
    });
  }, [activeTenantReceipts]);

  const appliedByInvoice = useMemo(() => {
    const map = new Map();
    allocationReceiptRows.forEach((receipt) => {
      receipt.allocations.forEach((row) => {
        if (!row.invoiceId) return;
        const current = map.get(row.invoiceId) || [];
        current.push(row);
        map.set(row.invoiceId, current);
      });
    });
    return map;
  }, [allocationReceiptRows]);

  const allocationTraceData = useMemo(() => {
    const buildRow = (doc, numField) => {
      const id = safeId(doc);
      const receiptApplications = (appliedByInvoice.get(id) || []).sort(
        (a, b) => new Date(a.receiptDate || 0) - new Date(b.receiptDate || 0)
      );
      return {
        invoiceId: id,
        invoiceNumber: doc?.[numField] || doc?.invoiceNumber || "-",
        invoiceDate: doc?.invoiceDate || doc?.noteDate || doc?.createdAt || null,
        categoryLabel: getInvoiceCategoryLabel(doc),
        amount: round2(Math.abs(Number(doc?.amount || 0))),
        appliedAmount: round2(receiptApplications.reduce((s, r) => s + Number(r?.appliedAmount || 0), 0)),
        outstandingAmount: round2(Math.max(0, Math.abs(Number(doc?.balance || doc?.amount || 0)))),
        receiptApplications,
      };
    };

    const invoiceRows = validTenantInvoices.map((inv) => buildRow(inv, "invoiceNumber"));
    const noteRows = tenantInvoiceNotes
      .filter((n) => !["cancelled", "reversed"].includes(String(n?.status || "").toLowerCase()))
      .map((n) => buildRow(n, "noteNumber"));
    const allRows = [...invoiceRows, ...noteRows];

    return {
      receipts: allocationReceiptRows,
      invoices: allRows,
      receiptMap: new Map(allocationReceiptRows.map((item) => [item.receiptId, item])),
      invoiceMap: new Map(allRows.map((item) => [item.invoiceId, item])),
      receiptCount: allocationReceiptRows.length,
      unappliedReceipts: allocationReceiptRows.filter((item) => item.unappliedAmount > 0),
      partiallyAllocatedReceipts: allocationReceiptRows.filter((item) => item.allocatedAmount > 0 || item.unappliedAmount > 0),
    };
  }, [allocationReceiptRows, appliedByInvoice, validTenantInvoices, tenantInvoiceNotes]);

  const selectedAllocationTrace = useMemo(() => {
    if (allocationTraceTarget?.kind === "receipt") {
      return allocationTraceData.receiptMap.get(String(allocationTraceTarget?.id || "")) || null;
    }
    if (allocationTraceTarget?.kind === "invoice") {
      return allocationTraceData.invoiceMap.get(String(allocationTraceTarget?.id || "")) || null;
    }
    return null;
  }, [allocationTraceTarget, allocationTraceData]);

  // useCallback: stable reference prevents re-computing allocationTracePanelJsx on every render
  const openReceiptAllocationWorkspace = useCallback((receiptId = "") => {
    const query = receiptId ? `?receipt=${encodeURIComponent(receiptId)}&mode=allocate` : "";
    const receipt = receiptId
      ? activeTenantReceipts.find((item) => safeId(item) === String(receiptId)) ||
        tenantPayments.find((item) => safeId(item) === String(receiptId)) ||
        null
      : null;
    const receiptNumber = String(receipt?.receiptNumber || receipt?.referenceNumber || "").trim();
    const tabTitle = receiptNumber ? `Allocate ${receiptNumber}` : "Receipts";

    navigate(`/receipts/${tenantId}${query}`, {
      state: { ...(location.state || {}), tabTitle },
    });
  }, [activeTenantReceipts, tenantPayments, navigate, tenantId, location.state]);

  // useMemo: this panel builds ~200 lines of JSX from already-memoized trace data.
  // Previously rebuilt on every render; now only recomputed when trace data or selection changes.
  const allocationTracePanelJsx = useMemo(() => {
    const receiptCount = allocationTraceData.receiptCount || 0;
    const unappliedCount = allocationTraceData.unappliedReceipts.length || 0;
    const hasSelection = Boolean(selectedAllocationTrace && allocationTraceTarget?.kind);

    return (
      <div className="mt-1 grid max-h-[20vh] flex-shrink-0 gap-px overflow-auto border border-slate-200 bg-slate-200 xl:grid-cols-[0.95fr_1.35fr]">
        <div className="bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5">
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Receipt Application Tracing</p>
              <p className="text-[11px] font-bold text-slate-800">Operational settlement view</p>
            </div>
          </div>
          <div className="space-y-1.5 px-3 py-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="border border-slate-200 bg-slate-50 px-2 py-1">
                <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Receipts in trace</p>
                <p className="text-xs font-black text-slate-900">{receiptCount}</p>
              </div>
              <div className="border border-amber-200 bg-amber-50 px-2 py-1">
                <p className="text-[8px] font-bold uppercase tracking-wider text-amber-600">Unapplied balance</p>
                <p className="text-xs font-black text-amber-700">{unappliedCount}</p>
              </div>
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Quick trace</p>
              <div className="mt-1 space-y-1">
                {(allocationTraceData.partiallyAllocatedReceipts.length > 0
                  ? allocationTraceData.partiallyAllocatedReceipts
                  : allocationTraceData.receipts)
                  .slice(0, 6)
                  .map((receipt) => (
                    <button
                      key={receipt.receiptId}
                      type="button"
                      onClick={() => setAllocationTraceTarget({ kind: "receipt", id: receipt.receiptId })}
                      className={`flex w-full items-center justify-between border px-2 py-1 text-left transition ${
                        allocationTraceTarget?.kind === "receipt" && allocationTraceTarget?.id === receipt.receiptId
                          ? "border-orange-300 bg-orange-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div>
                        <p className="text-[11px] font-bold text-slate-900">{receipt.receiptNumber}</p>
                        <p className="text-[10px] text-slate-500">
                          {receipt.paymentDate ? new Date(receipt.paymentDate).toLocaleDateString() : "-"} · {receipt.paymentType}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] font-black text-slate-900">Ksh {receipt.amount.toLocaleString()}</p>
                        <p className="text-[10px] text-amber-700">Unapplied {receipt.unappliedAmount.toLocaleString()}</p>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5">
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Trace detail</p>
              <p className="text-[11px] font-bold text-slate-800">
                {allocationTraceTarget?.kind === "invoice"
                  ? "Invoice settlement trace"
                  : allocationTraceTarget?.kind === "receipt"
                  ? "Receipt application trace"
                  : "Choose a receipt or charge row"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openReceiptAllocationWorkspace(allocationTraceTarget?.kind === "receipt" ? allocationTraceTarget?.id : "")}
              className="inline-flex items-center gap-1 bg-[#0B3B2E] px-2 py-1 text-[10px] font-bold text-white hover:bg-[#0A3127]"
            >
              <FaLink size={10} />
              {allocationTraceTarget?.kind === "receipt" ? "Manage this receipt" : "Open receipts workspace"}
            </button>
          </div>
          <div className="px-3 py-1.5">
            {!hasSelection && (
              <div className="border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center">
                <p className="text-[11px] font-semibold text-slate-600">Select a receipt from the trace list or click Trace in the transaction table.</p>
                <p className="mt-1 text-[10px] text-slate-400">This page stays read-heavy. Allocation editing still happens safely from the Receipts page.</p>
              </div>
            )}

            {hasSelection && allocationTraceTarget?.kind === "receipt" && selectedAllocationTrace && (
              <div className="space-y-1.5">
                <div className="grid gap-1.5 md:grid-cols-3">
                  <div className="border border-slate-200 bg-slate-50 px-2 py-1">
                    <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Receipt</p>
                    <p className="text-[11px] font-black text-slate-900">{selectedAllocationTrace.receiptNumber}</p>
                    <p className="text-[10px] text-slate-500">{selectedAllocationTrace.paymentDate ? new Date(selectedAllocationTrace.paymentDate).toLocaleDateString() : "-"}</p>
                  </div>
                  <div className="border border-slate-200 bg-slate-50 px-2 py-1">
                    <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Allocated</p>
                    <p className="text-[11px] font-black text-green-700">Ksh {selectedAllocationTrace.allocatedAmount.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">Operational application</p>
                  </div>
                  <div className="border border-slate-200 bg-slate-50 px-2 py-1">
                    <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Unapplied</p>
                    <p className="text-[11px] font-black text-amber-700">Ksh {selectedAllocationTrace.unappliedAmount.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">{selectedAllocationTrace.unappliedAmount > 0 ? "Locked if already posted" : "Fully applied"}</p>
                  </div>
                </div>

                {selectedAllocationTrace.allocations.length === 0 ? (
                  <div className="border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-[10px] text-slate-500">
                    No invoice allocations recorded for this receipt yet.
                  </div>
                ) : (
                  <div className="overflow-hidden border border-slate-200">
                    <table className="w-full border-collapse text-[10px]">
                      <thead className="bg-[#0B3B2E] text-white">
                        <tr>
                          <th className="border-r border-white/10 px-2 py-1 text-left font-bold">Invoice</th>
                          <th className="border-r border-white/10 px-2 py-1 text-left font-bold">Charge</th>
                          <th className="border-r border-white/10 px-2 py-1 text-right font-bold">Applied</th>
                          <th className="px-2 py-1 text-right font-bold">Invoice Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedAllocationTrace.allocations.map((row, i) => {
                          const resolvedNum = row.invoiceNumber !== "-"
                            ? row.invoiceNumber
                            : (allocationTraceData.invoiceMap.get(row.invoiceId)?.invoiceNumber || null);
                          const hasInvoice = Boolean(resolvedNum);
                          return (
                            <tr key={`${selectedAllocationTrace.receiptId}-${row.invoiceId}-${row.label}`} className={`border-b border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}>
                              <td className="border-r border-slate-100 px-2 py-1 font-semibold text-slate-900">
                                {hasInvoice ? resolvedNum : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="border-r border-slate-100 px-2 py-1 text-slate-500">{row.label}</td>
                              <td className="border-r border-slate-100 px-2 py-1 text-right font-bold text-green-700">Ksh {row.appliedAmount.toLocaleString()}</td>
                              <td className="px-2 py-1 text-right text-slate-600">
                                {hasInvoice ? `Ksh ${row.afterOutstanding.toLocaleString()}` : <span className="text-slate-300">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {hasSelection && allocationTraceTarget?.kind === "invoice" && selectedAllocationTrace && (
              <div className="space-y-1.5">
                <div className="grid gap-1.5 md:grid-cols-3">
                  <div className="border border-slate-200 bg-slate-50 px-2 py-1">
                    <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Invoice</p>
                    <p className="text-[11px] font-black text-slate-900">{selectedAllocationTrace.invoiceNumber}</p>
                    <p className="text-[10px] text-slate-500">{selectedAllocationTrace.categoryLabel}</p>
                  </div>
                  <div className="border border-slate-200 bg-slate-50 px-2 py-1">
                    <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Applied by receipts</p>
                    <p className="text-[11px] font-black text-green-700">Ksh {selectedAllocationTrace.appliedAmount.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">Operational settlement to date</p>
                  </div>
                  <div className="border border-slate-200 bg-slate-50 px-2 py-1">
                    <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Outstanding</p>
                    <p className="text-[11px] font-black text-red-700">Ksh {selectedAllocationTrace.outstandingAmount.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">Current invoice balance</p>
                  </div>
                </div>

                {selectedAllocationTrace.receiptApplications.length === 0 ? (
                  <div className="border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-[10px] text-slate-500">
                    No receipt has been applied to this invoice yet.
                  </div>
                ) : (
                  <div className="overflow-hidden border border-slate-200">
                    <table className="w-full border-collapse text-[10px]">
                      <thead className="bg-[#0B3B2E] text-white">
                        <tr>
                          <th className="border-r border-white/10 px-2 py-1 text-left font-bold">Receipt</th>
                          <th className="border-r border-white/10 px-2 py-1 text-left font-bold">Date</th>
                          <th className="border-r border-white/10 px-2 py-1 text-left font-bold">Charge</th>
                          <th className="border-r border-white/10 px-2 py-1 text-right font-bold">Applied</th>
                          <th className="px-2 py-1 text-center font-bold">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedAllocationTrace.receiptApplications.map((row, i) => (
                          <tr key={`${selectedAllocationTrace.invoiceId}-${row.receiptId}-${row.appliedAmount}`} className={`border-b border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}>
                            <td className="border-r border-slate-100 px-2 py-1 font-semibold text-slate-900">{row.receiptNumber}</td>
                            <td className="border-r border-slate-100 px-2 py-1 text-slate-500">{row.receiptDate ? new Date(row.receiptDate).toLocaleDateString() : "-"}</td>
                            <td className="border-r border-slate-100 px-2 py-1 text-slate-500">{row.label}</td>
                            <td className="border-r border-slate-100 px-2 py-1 text-right font-bold text-green-700">Ksh {row.appliedAmount.toLocaleString()}</td>
                            <td className="px-2 py-1 text-center">
                              <button
                                type="button"
                                onClick={() => openReceiptAllocationWorkspace(row.receiptId)}
                                className="inline-flex items-center gap-1 border border-slate-300 px-1.5 py-0.5 text-[9px] font-bold text-slate-700 hover:bg-slate-100"
                              >
                                <FaLink size={8} />
                                Open
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocationTraceData, allocationTraceTarget, selectedAllocationTrace, openReceiptAllocationWorkspace, setAllocationTraceTarget]);

  const billingScheduleData = useMemo(() => {
    const baseRent = tenantLease?.rentAmount || tenant?.rent || 0;
    const companyBillingPeriods = normalizeBillingPeriods(companyTaxConfig);

    let tenantUtilities = [];
    let serviceCharge = 0;
    let tenantUtilityNames = [];

    if (tenant?.utilities && tenant.utilities.length > 0) {
      tenantUtilities = tenant.utilities;
    } else if (tenant?.unit?.utilities && tenant.unit.utilities.length > 0) {
      tenantUtilities = tenant.unit.utilities;
    } else if (tenantUnitRecord?.utilities?.length > 0) {
      tenantUtilities = tenantUnitRecord.utilities;
    }

    if (tenantUtilities.length > 0) {
      tenantUtilities.forEach((util) => {
        const charge = parseFloat(util.unitCharge) || 0;
        const utilityName = util.utilityLabel || util.utility || "Unknown";
        if (!tenantUtilityNames.includes(utilityName)) {
          tenantUtilityNames.push(utilityName);
        }
        if (!util.isIncluded) {
          serviceCharge += charge;
        }
      });
    }

    const scheduleData = [];
    const tenantName = getTenantName(tenant) || "N/A";
    const propertyName = resolveTenantPropertyName(tenant);

    let scheduleStartDate;
    let scheduleEndDate;

    // Open leases: show DEFAULT_SCHEDULE_MONTHS from today + any user-requested extension.
    const now = new Date();
    const openLeaseEnd = new Date(now);
    openLeaseEnd.setMonth(openLeaseEnd.getMonth() + DEFAULT_SCHEDULE_MONTHS + scheduleExtensionMonths);

    if (tenantLease) {
      scheduleStartDate = new Date(tenantLease.startDate);
      const leaseEnd = tenantLease.endDate ? new Date(tenantLease.endDate) : null;
      scheduleEndDate = (leaseEnd && leaseEnd > now) ? leaseEnd : openLeaseEnd;
    } else if (tenant) {
      scheduleStartDate = tenant.moveInDate ? new Date(tenant.moveInDate) : now;
      const moveOut = tenant.moveOutDate ? new Date(tenant.moveOutDate) : null;
      scheduleEndDate = (moveOut && moveOut > now) ? moveOut : openLeaseEnd;
    } else {
      scheduleStartDate = now;
      scheduleEndDate = openLeaseEnd;
    }

    const matchedUnit = tenantUnitRecord;
    const selectedBillingPeriodKey = canonicalBillingPeriodKey(
      tenantLease?.billingPeriodKey ||
        tenant?.billingPeriodKey ||
        tenant?.billingFrequency ||
        tenant?.unit?.billingPeriodKey ||
        tenant?.unit?.billingFrequency ||
        matchedUnit?.billingPeriodKey ||
        matchedUnit?.billingFrequency ||
        "monthly"
    );
    const selectedBillingPeriod =
      companyBillingPeriods.find((item) => item.key === selectedBillingPeriodKey) ||
      companyBillingPeriods.find((item) => item.key === "monthly") ||
      { key: "monthly", name: "Monthly", durationInMonths: 1 };
    const paymentDueDay = Math.max(1, Math.min(28, Number(tenantLease?.paymentDueDay || 5)));

    // Pre-group invoices by periodKey/description to avoid O(n_periods × n_invoices) inside the loop
    const SCHEDULE_CATEGORIES = new Set(["RENT_CHARGE", "UTILITY_CHARGE"]);
    const invoicesByPeriodKey = new Map();
    const invoicesByPeriodDesc = new Map();
    tenantInvoices.forEach(inv => {
      const status = String(inv?.status || "").toLowerCase();
      if (["cancelled", "reversed"].includes(status)) return;
      if (!SCHEDULE_CATEGORIES.has(String(inv?.category || "").toUpperCase())) return;
      const metaKey = String(inv?.metadata?.periodKey || "").trim();
      if (metaKey) {
        if (!invoicesByPeriodKey.has(metaKey)) invoicesByPeriodKey.set(metaKey, []);
        invoicesByPeriodKey.get(metaKey).push(inv);
      } else {
        const desc = formatPeriodLabel(inv?.invoiceDate || inv?.createdAt);
        if (!invoicesByPeriodDesc.has(desc)) invoicesByPeriodDesc.set(desc, []);
        invoicesByPeriodDesc.get(desc).push(inv);
      }
    });

    let currentDate = new Date(scheduleStartDate);
    currentDate.setHours(0, 0, 0, 0);

    while (currentDate < scheduleEndDate) {
      const nextDate = addMonthsPreservingDay(currentDate, selectedBillingPeriod.durationInMonths) || new Date(scheduleEndDate);
      const periodEnd = new Date(Math.min(nextDate.getTime() - 1, scheduleEndDate.getTime()));
      const periodKey = buildSchedulePeriodKey({ startDate: currentDate, billingPeriodKey: selectedBillingPeriod.key });
      const adjustment = billingScheduleAdjustmentsByPeriod[periodKey] || billingScheduleAdjustmentsByPeriod[buildPeriodKey(currentDate.getFullYear(), currentDate.getMonth())] || null;

      if (adjustment?.status === "deleted") {
        currentDate = nextDate;
        continue;
      }

      const resolvedFromDate = adjustment?.fromDate || currentDate;
      const resolvedToDate = adjustment?.toDate || periodEnd;
      const scheduleDesc = buildScheduleLabel({ startDate: resolvedFromDate, endDate: resolvedToDate, billingPeriod: selectedBillingPeriod });
      const periodInvoices = invoicesByPeriodKey.has(periodKey)
        ? invoicesByPeriodKey.get(periodKey)
        : (invoicesByPeriodDesc.get(scheduleDesc) || []);
      const createdInvoiceNumber = periodInvoices
        .map((item) => item.invoiceNumber)
        .filter(Boolean)
        .join(", ");
      const hasCreatedInvoice = periodInvoices.length > 0;

      const resolvedRent = Number(adjustment?.rentAmount ?? baseRent * selectedBillingPeriod.durationInMonths);
      const resolvedUtility = Number(adjustment?.utilityAmount ?? serviceCharge * selectedBillingPeriod.durationInMonths);
      const resolvedUtilityNames =
        Array.isArray(adjustment?.utilityNames) && adjustment.utilityNames.length > 0
          ? adjustment.utilityNames
          : tenantUtilityNames;
      const isFrozen = adjustment?.status === "frozen";
      const dueDate = new Date(resolvedFromDate);
      dueDate.setDate(Math.min(paymentDueDay, new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0).getDate()));
      dueDate.setHours(23, 59, 59, 999);

      scheduleData.push({
        from: formatDisplayDate(resolvedFromDate),
        to: formatDisplayDate(resolvedToDate),
        fromRaw: formatInputDate(resolvedFromDate),
        toRaw: formatInputDate(resolvedToDate),
        dueDateRaw: formatInputDate(dueDate),
        description: scheduleDesc,
        rent: resolvedRent,
        utility: resolvedUtility,
        utilityNames: resolvedUtilityNames.length > 0 ? resolvedUtilityNames : [],
        booked: hasCreatedInvoice ? "Yes" : "No",
        frozen: isFrozen ? "Yes" : "No",
        invoice: hasCreatedInvoice ? createdInvoiceNumber : "-",
        tenantName,
        propertyName,
        periodMonth: currentDate.getMonth(),
        periodYear: currentDate.getFullYear(),
        periodKey,
        billingPeriodKey: selectedBillingPeriod.key,
        billingPeriodLabel: selectedBillingPeriod.name,
        intervalMonths: selectedBillingPeriod.durationInMonths,
      });

      currentDate = nextDate;
    }

    return scheduleData;
  }, [tenantLease, tenant, tenantUnitRecord, tenantInvoices, billingScheduleAdjustmentsByPeriod, companyTaxConfig, scheduleExtensionMonths]);

  const billingScheduleByKey = useMemo(() => {
    return new Map((billingScheduleData || []).map((row) => [row.periodKey, row]));
  }, [billingScheduleData]);

  const depositBillingOption = useMemo(() => {
    const selectedRows = selectedSchedules
      .map((key) => billingScheduleByKey.get(key))
      .filter(Boolean)
      .sort((a, b) => {
        const aTime = new Date(a.periodYear, a.periodMonth, 1).getTime();
        const bTime = new Date(b.periodYear, b.periodMonth, 1).getTime();
        return aTime - bTime;
      });

    const selectedPeriodLabel = selectedRows[0]?.description || "";

    if (tenantDepositAmount <= 0) {
      return {
        amount: 0,
        holder: tenantDepositHolder,
        enabled: false,
        recommended: false,
        selectedPeriodLabel,
        reason: "This tenant has no deposit amount configured.",
      };
    }

    if (hasActiveDepositInvoice) {
      return {
        amount: tenantDepositAmount,
        holder: tenantDepositHolder,
        enabled: false,
        recommended: false,
        selectedPeriodLabel,
        reason: `Deposit has already been billed${depositInvoiceSummary?.invoiceNumber ? ` on invoice ${depositInvoiceSummary.invoiceNumber}` : ""}.`,
      };
    }

    if (selectedRows.length === 0) {
      return {
        amount: tenantDepositAmount,
        holder: tenantDepositHolder,
        enabled: false,
        recommended: false,
        selectedPeriodLabel,
        reason: "Select a billing period first to bill the deposit from the tenant statement.",
      };
    }

    return {
      amount: tenantDepositAmount,
      holder: tenantDepositHolder,
      enabled: true,
      recommended: selectedRows.length === 1,
      selectedPeriodLabel,
      reason: "",
    };
  }, [
    selectedSchedules,
    billingScheduleByKey,
    tenantDepositAmount,
    tenantDepositHolder,
    hasActiveDepositInvoice,
    depositInvoiceSummary,
  ]);

  const filteredBillingScheduleData = useMemo(() => {
    const normalizedSearch = String(scheduleSearchText || "").trim().toLowerCase();
    const filterFrom = scheduleFilterFrom ? new Date(`${scheduleFilterFrom}T00:00:00`) : null;
    const filterTo   = scheduleFilterTo   ? new Date(`${scheduleFilterTo}T23:59:59`)   : null;
    return (billingScheduleData || []).filter((row) => {
      const rowFrom = row?.fromRaw ? new Date(`${row.fromRaw}T00:00:00`) : null;
      const rowTo = row?.toRaw ? new Date(`${row.toRaw}T23:59:59`) : null;
      const fromOk = filterFrom ? (rowTo ? rowTo >= filterFrom : false) : true;
      const toOk   = filterTo   ? (rowFrom ? rowFrom <= filterTo : false) : true;
      const searchOk = !normalizedSearch
        ? true
        : [row.description, row.invoice, row.tenantName, row.propertyName, row.booked, row.frozen]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(normalizedSearch));
      return fromOk && toOk && searchOk;
    });
  }, [billingScheduleData, scheduleFilterFrom, scheduleFilterTo, scheduleSearchText]);

  const allFrozen = useMemo(
    () => selectedSchedules.length > 0 && selectedSchedules.every((key) => billingScheduleByKey.get(key)?.frozen === "Yes"),
    [selectedSchedules, billingScheduleByKey]
  );

  const hasOpenLease = useMemo(() => {
    const now = new Date();
    const leaseEnd = tenantLease?.endDate ? new Date(tenantLease.endDate) : null;
    const moveOut  = tenant?.moveOutDate  ? new Date(tenant.moveOutDate)  : null;
    return !((leaseEnd && leaseEnd > now) || (moveOut && moveOut > now));
  }, [tenantLease?.endDate, tenant?.moveOutDate]);

  const scheduleFooter = useMemo(() => {
    let totRent = 0, totUtil = 0, bookedCount = 0;
    for (const r of filteredBillingScheduleData) {
      totRent += r.rent || 0;
      totUtil += r.utility || 0;
      if (r.booked === "Yes") bookedCount++;
    }
    return { totRent, totUtil, totTotal: totRent + totUtil, bookedCount };
  }, [filteredBillingScheduleData]);

  // useMemo: icons are React elements — recreating them on every render creates new object references
  // that force any React.memo'd child that receives this array to re-render unnecessarily.
  const tabs = useMemo(
    () => [
      { id: "statement", label: `${termTenant} Statement`, icon: <FaFileInvoiceDollar /> },
      { id: "billing", label: "Billing Schedule", icon: <FaCalendarAlt /> },
      { id: "reviews", label: `${termRent} Reviews / Escalations`, icon: <FaChartBar /> },
    ],
    [termTenant, termRent]
  );

  const handlePrint = useCallback(() => {
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const tenantName = tenant?.tenantName || tenant?.name || 'Tenant';
    const unit = (() => {
      const all = [tenant?.unit, ...(Array.isArray(tenant?.additionalUnits) ? tenant.additionalUnits : [])]
        .map((u) => u?.unitNumber).filter(Boolean);
      return all.length ? all.join(", ") : "—";
    })();
    const property = tenant?.unit?.property?.propertyName || tenant?.property?.propertyName || '—';
    const allTxns = statementData?.transactions || [];
    const printStart = stmtFrom ? new Date(`${stmtFrom}T00:00:00`) : null;
    const printEnd = stmtTo ? new Date(`${stmtTo}T23:59:59`) : null;
    const printBbf = printStart
      ? allTxns.filter((t) => new Date(t.date) < printStart).reduce((sum, t) => sum + t.amount, 0)
      : 0;
    const hasPrintBbf = printStart !== null && allTxns.some((t) => new Date(t.date) < printStart);
    const txns = allTxns
      .filter((t) => {
        if (stmtTypeFilter !== 'ALL' && t.type !== stmtTypeFilter) return false;
        const d = new Date(t.date);
        const fromOk = printStart ? d >= printStart : true;
        const toOk = printEnd ? d <= printEnd : true;
        return fromOk && toOk;
      })
      .map((t) => ({ ...t, balance: t.balance + printBbf }));
    const printBcfBalance = txns.length > 0 ? txns[txns.length - 1].balance : hasPrintBbf ? printBbf : null;

    // Compute totals from the date-filtered txns only (not full statement history)
    let printCharges = 0, printPayments = 0;
    txns.forEach((t) => {
      const abs = Math.abs(Number(t.amount || 0));
      if (t.type === 'CHARGE' || t.type === 'DEBIT_NOTE') printCharges += abs;
      else if (t.type === 'PAYMENT' || t.type === 'CREDIT_NOTE') printPayments += abs;
    });
    const printOutstanding = Math.max(0, printCharges - printPayments);
    const printBalance = printBcfBalance ?? 0;

    const allPrintRows = [
      ...(hasPrintBbf ? [{ id: 'BBF', type: 'BBF', description: 'Balance Brought Forward', amount: printBbf, balance: printBbf }] : []),
      ...txns,
      ...(printBcfBalance !== null ? [{ id: 'BCF', type: 'BCF', description: 'Balance Carried Forward', amount: printBcfBalance, balance: printBcfBalance }] : []),
    ];
    const win = window.open('', '_blank', 'width=900,height=1100');
    if (!win) { window.print(); return; }
    win.document.write(`<!DOCTYPE html><html><head><title>Tenant Statement — ${tenantName}</title><style>
      @page{size:A4 portrait;margin:14mm}body{font-family:Arial,sans-serif;color:#0f172a;font-size:9px;margin:0}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0B3B2E;padding-bottom:8px;margin-bottom:10px}
      .co{font-size:13px;font-weight:900;color:#0B3B2E}.ttl{font-size:16px;font-weight:900;margin:2px 0}
      .sub{font-size:10px;color:#475569;margin-top:2px}.meta{text-align:right;color:#64748b;font-size:8.5px;line-height:1.6}
      .logo{max-height:44px;max-width:120px;object-fit:contain;margin-bottom:4px}
      .info{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
      .box{border:1px solid #dbe2ea;border-radius:6px;padding:7px 10px;font-size:8.5px;line-height:1.7}
      .box-label{font-size:8px;text-transform:uppercase;letter-spacing:.1em;color:#64748b;font-weight:800;margin-bottom:4px}
      table{width:100%;border-collapse:collapse;font-size:8.5px}
      thead th{background:#0B3B2E;color:#fff;padding:4px 8px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.1em}
      thead th.r{text-align:right}thead th.c{text-align:center}
      tbody td{border-bottom:1px solid #f1f5f9;padding:3.5px 8px}tbody td.r{text-align:right}tbody td.c{text-align:center}
      tbody tr:nth-child(even){background:#f8fafc}
      .totals{margin-top:10px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
      .t-card{border:1px solid #dbe2ea;border-radius:6px;background:#f8fafc;padding:6px 8px}
      .t-cl{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .t-cv{font-size:12px;font-weight:900;margin-top:3px}
      .chg{color:#dc2626}.pay{color:#047857}.amb{color:#b45309}
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">Tenant Statement</div><div class="sub">Period: ${stmtFrom || 'All'} to ${stmtTo || 'All'}</div></div>
    <div class="meta"><div>Generated: ${new Date().toLocaleString()}</div></div></div>
    <div class="info">
      <div class="box"><div class="box-label">Tenant</div><strong>${tenantName}</strong></div>
      <div class="box"><div class="box-label">Unit / Property</div><strong>${unit}</strong> · ${property}</div>
    </div>
    <table><thead><tr><th>Date</th><th>Description</th><th class="c">Type</th><th>Code</th><th class="r">Amount</th><th class="r">Balance</th></tr></thead>
    <tbody>${allPrintRows.map((t) => {
      const isBbcf = t.type === 'BBF' || t.type === 'BCF';
      const isDebit = ['CHARGE','DEBIT_NOTE'].includes(t.type);
      const balColor = t.balance > 0 ? '#b91c1c' : t.balance < 0 ? '#047857' : '#475569';
      const balLabel = `Ksh ${Math.abs(t.balance || 0).toLocaleString()}${t.balance < 0 ? ' CR' : t.balance > 0 ? ' DR' : ''}`;
      if (isBbcf) return `<tr style="background:#f0fdf4;border-top:2px solid #0B3B2E40;border-bottom:2px solid #0B3B2E40"><td style="color:#475569">—</td><td colspan="3" style="font-weight:900;font-size:8px;text-transform:uppercase;letter-spacing:.1em;color:#0B3B2E">${t.description}</td><td class="r"></td><td class="r" style="font-weight:900;color:${balColor}">${balLabel}</td></tr>`;
      return `<tr><td>${new Date(t.date).toLocaleDateString()}</td><td>${t.description || '—'}</td><td class="c"><span style="padding:1px 5px;border-radius:3px;font-size:7.5px;font-weight:800;background:${isDebit ? '#fee2e2' : '#d1fae5'};color:${isDebit ? '#b91c1c' : '#065f46'}">${t.type}</span></td><td>${t.transactionCode || '—'}</td><td class="r ${isDebit ? 'chg' : 'pay'}"><strong>${isDebit ? '+' : '-'}Ksh ${Math.abs(t.amount || 0).toLocaleString()}</strong></td><td class="r">Ksh ${(t.balance || 0).toLocaleString()}</td></tr>`;
    }).join('')}
    ${allPrintRows.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:20px;color:#94a3b8">No transactions for the selected filters.</td></tr>' : ''}
    </tbody></table>
    <div class="totals">
      <div class="t-card"><div class="t-cl">Charges</div><div class="t-cv chg">Ksh ${printCharges.toLocaleString()}</div></div>
      <div class="t-card"><div class="t-cl">Payments</div><div class="t-cv pay">Ksh ${printPayments.toLocaleString()}</div></div>
      <div class="t-card"><div class="t-cl">Outstanding</div><div class="t-cv amb">Ksh ${printOutstanding.toLocaleString()}</div></div>
      <div class="t-card"><div class="t-cl">Balance</div><div class="t-cv" style="color:${printBalance >= 0 ? '#047857' : '#dc2626'}">Ksh ${Math.abs(printBalance).toLocaleString()}</div></div>
    </div>
    </body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [currentCompany, tenant, statementData, stmtFrom, stmtTo, stmtTypeFilter]);

  const handleDownload = () => {
    handlePrint();
  };

  const handleSendStatementSms = async () => {
    if (!tenant?.phone) {
      toast.warning("This tenant has no phone number on record.");
      return;
    }
    const name = tenant?.tenantName || tenant?.name || "Tenant";
    const companyName = currentCompany?.companyName || "Management";
    const dateStr = new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
    const charges = statementData?.totalCharges || 0;
    const paid = statementData?.totalPayments || 0;
    const outstanding = Math.abs(statementData?.operationalOutstanding || 0);
    const customBody = `Dear ${name}, your rent statement as at ${dateStr}: Charges KES ${charges.toLocaleString()}, Paid KES ${paid.toLocaleString()}, Outstanding KES ${outstanding.toLocaleString()}. Contact ${companyName} for queries.`;

    setSendingStatementSms(true);
    try {
      await sendCommunicationMessage(dispatch, {
        contextType: "tenant_bulk",
        channel: "sms",
        templateKey: "tenant_notice_sms",
        recordIds: [tenantId],
        customBody,
      });
      toast.success("Statement summary sent via SMS");
    } catch {
      toast.error("Failed to send SMS — please try again");
    } finally {
      setSendingStatementSms(false);
    }
  };

  const handleSendStatementEmail = async () => {
    if (!tenant?.email) {
      toast.warning("This tenant has no email address on record.");
      return;
    }
    const name = tenant?.tenantName || tenant?.name || "Tenant";
    const companyName = currentCompany?.companyName || "Management";
    const unitNo = resolveTenantUnitNumber(tenant);
    const property = resolveTenantPropertyName(tenant);
    const dateStr = new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" });
    const charges = statementData?.totalCharges || 0;
    const paid = statementData?.totalPayments || 0;
    const outstanding = Math.abs(statementData?.operationalOutstanding || 0);
    const credits = statementData?.unappliedCredits || 0;
    const rent = tenantLease?.rentAmount || tenant?.rent || 0;

    // Include up to the last 15 visible transactions
    const recentTxns = (statementData?.transactions || []).slice(-15);
    const txnBlock = recentTxns.length > 0
      ? [
          `RECENT TRANSACTIONS`,
          `${"─".repeat(52)}`,
          ...recentTxns.map((t) => {
            const d = new Date(t.date).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
            const sign = ["CHARGE", "DEBIT_NOTE"].includes(t.type) ? "+" : "-";
            const desc = (t.description || "—").substring(0, 32).padEnd(33);
            return `${d}  ${desc}  ${sign}KES ${Math.abs(t.amount || 0).toLocaleString()}`;
          }),
        ]
      : [];

    const lines = [
      `Dear ${name},`,
      ``,
      `Please find below your rent account statement from ${companyName} as at ${dateStr}.`,
      ``,
      `Tenant : ${name}`,
      `Unit   : ${unitNo}  |  Property: ${property}`,
      ``,
      `ACCOUNT SUMMARY`,
      `${"─".repeat(52)}`,
      `Monthly ${termRent.padEnd(12)}: KES ${rent.toLocaleString()}`,
      `Total Charges    : KES ${charges.toLocaleString()}`,
      `Total Paid       : KES ${paid.toLocaleString()}`,
      `Outstanding      : KES ${outstanding.toLocaleString()}`,
      ...(credits > 0 ? [`Unapplied Credits: KES ${credits.toLocaleString()}`] : []),
      ``,
      ...txnBlock,
      ``,
      `For queries or to make payment, please contact us directly.`,
      ``,
      `Regards,`,
      companyName,
      currentCompany?.companyPhone || "",
      currentCompany?.companyEmail || "",
    ].filter((l) => l !== undefined);

    const customBody = lines.join("\n");

    setSendingStatementEmail(true);
    try {
      await sendCommunicationMessage(dispatch, {
        contextType: "tenant_bulk",
        channel: "email",
        templateKey: "tenant_notice_email",
        recordIds: [tenantId],
        customBody,
      });
      toast.success("Statement emailed to tenant successfully");
    } catch {
      toast.error("Failed to send email — please try again");
    } finally {
      setSendingStatementEmail(false);
    }
  };

  const renderStatement = () => (
    <StatementLedgerTab
      statementData={statementData}
      tenant={tenant}
      tenantLease={tenantLease}
      onOpenAllocationTrace={(target) => setAllocationTraceTarget(target)}
      onOpenReceiptWorkspace={(receiptId) => openReceiptAllocationWorkspace(receiptId ?? "")}
      allocationTracePanel={allocationTracePanelJsx}
      from={stmtFrom}
      to={stmtTo}
      typeFilter={stmtTypeFilter}
      onFromChange={setStmtFrom}
      onToChange={setStmtTo}
      onTypeFilterChange={setStmtTypeFilter}
    />
  );


  const persistRentReviewRecords = async (nextReviewRecords, nextScheduleAdjustments = localBillingScheduleAdjustments, successMessage = "Rent review changes saved") => {
    try {
      const targetLeaseId = safeId(tenantLease?._id);
      if (!targetLeaseId) {
        toast.error("No lease record found for this tenant. Save or restore the tenant agreement first.");
        return false;
      }
      setReviewRecords(nextReviewRecords);
      if (Array.isArray(nextScheduleAdjustments)) {
        setLocalBillingScheduleAdjustments(nextScheduleAdjustments);
      }
      await updateLeaseReviews(targetLeaseId, {
        rentReviewRecords: nextReviewRecords,
        billingScheduleAdjustments: Array.isArray(nextScheduleAdjustments)
          ? nextScheduleAdjustments
          : localBillingScheduleAdjustments,
      });
      if (currentCompany?._id) {
        await getLeases(dispatch, currentCompany._id, null, tenantId);
      }
      toast.success(successMessage);
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Rent review action failed");
      return false;
    }
  };

  const renderBillingSchedule = () => {
    const handleSelectSchedule = (scheduleKey) => {
      setSelectedSchedules((prev) =>
        prev.includes(scheduleKey) ? prev.filter((k) => k !== scheduleKey) : [...prev, scheduleKey]
      );
    };

    const handleSelectAll = () => {
      if (selectedSchedules.length === filteredBillingScheduleData.length && filteredBillingScheduleData.length > 0) {
        setSelectedSchedules([]);
      } else {
        setSelectedSchedules(filteredBillingScheduleData.map((row) => row.periodKey));
      }
    };

    const persistScheduleAdjustments = async (updater, successMessage) => {
      const currentAdjustments = Array.isArray(localBillingScheduleAdjustments)
        ? localBillingScheduleAdjustments
        : [];

      try {
        setSavingScheduleAction(true);

        let targetLeaseId = safeId(tenantLease?._id);
        if (!targetLeaseId && currentCompany?._id) {
          const refreshedLeases = await getLeases(dispatch, currentCompany._id, null, tenantId);
          const refreshedLeaseList = Array.isArray(refreshedLeases)
            ? refreshedLeases
            : Array.isArray(refreshedLeases?.data)
            ? refreshedLeases.data
            : [];
          const tenantKey = safeId(tenantId);
          const tenantUnitKey = safeId(tenant?.unit?._id || tenant?.unit);
          const matchedLease = refreshedLeaseList.find((lease) => {
            const leaseTenantKey = safeId(lease?.tenant);
            const leaseUnitKey = safeId(lease?.unit);
            return (tenantKey && leaseTenantKey === tenantKey) || (tenantUnitKey && leaseUnitKey === tenantUnitKey);
          });
          targetLeaseId = safeId(matchedLease?._id);
        }

        if (!targetLeaseId) {
          toast.error("No lease record was found for this tenant. Save or restore the tenant agreement first.");
          return false;
        }

        const nextAdjustments = updater([...currentAdjustments]);
        setLocalBillingScheduleAdjustments(nextAdjustments);

        await updateLease(dispatch, targetLeaseId, {
          billingScheduleAdjustments: nextAdjustments,
        });

        if (currentCompany?._id) {
          await getLeases(dispatch, currentCompany._id, null, tenantId);
        }
        toast.success(successMessage);
        return true;
      } catch (error) {
        setLocalBillingScheduleAdjustments(currentAdjustments);
        toast.error(error?.response?.data?.message || error?.message || "Schedule action failed");
        return false;
      } finally {
        setSavingScheduleAction(false);
      }
    };

    const handleCreateInvoices = () => {
      if (selectedSchedules.length === 0) {
        toast.warning("Please select at least one billing period");
        return;
      }
      const selectedRows = selectedSchedules.map((key) => billingScheduleByKey.get(key)).filter(Boolean);
      const eligibleRows = selectedRows.filter((row) => row.invoice === "-" && row.frozen !== "Yes");
      if (eligibleRows.length === 0) {
        toast.warning("No uninvoiced, unfrozen periods selected");
        return;
      }
      const firstRow = eligibleRows[0];
      setSelectedSchedulePeriod({ month: Number(firstRow.periodMonth), year: Number(firstRow.periodYear) });
      setShowInvoiceModal(true);
    };

    const handleCancelInvoices = async () => {
      if (selectedSchedules.length === 0) {
        toast.warning("Please select at least one billing period");
        return;
      }

      const selectedRows = selectedSchedules.map((key) => billingScheduleByKey.get(key)).filter(Boolean);
      const invoicedPeriods = selectedRows.filter((row) => row.invoice !== "-");

      if (invoicedPeriods.length === 0) {
        toast.warning("No invoiced periods selected");
        return;
      }

      const matchingInvoices = invoicedPeriods.flatMap((row) =>
        getInvoicesForPeriod(row, ["RENT_CHARGE", "UTILITY_CHARGE"])
      );
      const uniqueInvoices = Array.from(new Map(matchingInvoices.map((invoice) => [safeId(invoice), invoice])).values());


      if (uniqueInvoices.length === 0) {
        toast.warning("No matching invoices were found to cancel.");
        return;
      }

      const nonDeletable = uniqueInvoices.filter((invoice) =>
        ["paid", "partially_paid"].includes(String(invoice?.status || "").toLowerCase())
      );

      if (nonDeletable.length > 0) {
        toast.warning("Paid or partially paid invoices cannot be cancelled from this screen.");
        return;
      }

      try {
        setSavingScheduleAction(true);
        const response = await deleteTenantInvoicesBatch(uniqueInvoices.map((invoice) => invoice._id));
        const succeededCount = response?.succeededCount ?? response?.succeeded?.length ?? 0;
        const failedCount = response?.failedCount ?? response?.failed?.length ?? 0;

        if (succeededCount > 0 && failedCount === 0) {
          toast.success("Selected invoice booking(s) cancelled successfully.");
        } else if (succeededCount > 0 && failedCount > 0) {
          const reasons = (response?.failed || []).slice(0, 3).map((f) => f.reason).filter(Boolean).join("; ");
          toast.warn(`${succeededCount} cancelled, ${failedCount} could not be cancelled.${reasons ? ` ${reasons}` : ""}`);
        } else {
          const reasons = (response?.failed || []).slice(0, 3).map((f) => f.reason).filter(Boolean).join("; ");
          toast.error(reasons || "Failed to cancel selected invoice bookings");
        }

        setSelectedSchedules([]);
        setInvoiceRefresh((v) => v + 1);
        window.dispatchEvent(new Event("invoicesUpdated"));
      } catch (error) {
        toast.error(error?.response?.data?.error || error?.message || "Failed to cancel selected invoice bookings");
      } finally {
        setSavingScheduleAction(false);
      }
    };

    const handleEditSchedules = () => {
      if (selectedSchedules.length === 0) {
        toast.warning("Please select at least one billing period");
        return;
      }

      if (selectedSchedules.length > 1) {
        toast.warning("Edit works one billing period at a time. Please select one row.");
        return;
      }

      const row = billingScheduleByKey.get(selectedSchedules[0]);
      if (!row) return;

      setEditingSchedule(selectedSchedules[0]);
      setScheduleForm({
        from: row.fromRaw || "",
        to: row.toRaw || "",
        rent: String(row.rent ?? ""),
        utility: String(row.utility ?? ""),
      });
      setShowEditScheduleModal(true);
    };

    const handleDeleteSchedules = () => {
      if (selectedSchedules.length === 0) {
        toast.warning("Please select at least one billing period");
        return;
      }

      setShowDeleteScheduleModal(true);
    };

    const handleFreezeSchedules = () => {
      if (selectedSchedules.length === 0) {
        toast.warning("Please select at least one billing period");
        return;
      }

      setShowFreezeScheduleModal(true);
    };

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
        <div className="sticky top-0 z-20 flex-shrink-0 border-b border-slate-200 bg-white">
          {/* ── Deposit strip (single row) ── */}
          <div className="flex items-center gap-4 divide-x divide-slate-100 border-b border-slate-200 px-3 py-1">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Deposit</span>
              <span className="text-[11px] font-black text-[#0B3B2E]">KES {tenantDepositAmount.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 pl-4 shrink-0">
              <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Holder</span>
              <span className="text-[11px] font-black text-slate-700">{tenantDepositHolder}</span>
            </div>
            <div className="flex items-center gap-2 pl-4 shrink-0">
              <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Invoice</span>
              {hasActiveDepositInvoice ? (
                <span className="text-[11px] font-black text-emerald-700">
                  Billed{depositInvoiceSummary?.invoiceNumber ? ` · ${depositInvoiceSummary.invoiceNumber}` : ""}
                </span>
              ) : (
                <span className="text-[11px] font-black text-amber-600">Not yet billed</span>
              )}
            </div>
          </div>

          {/* ── Filter + Actions (single row) ── */}
          {(() => {
            const dis = "inline-flex items-center gap-1 h-6 px-2 text-[10px] font-bold border border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed shrink-0";
            const act = (color) => `inline-flex items-center gap-1 h-6 px-2 text-[10px] font-bold border ${color} text-white transition-colors shrink-0`;
            const hasSel = selectedSchedules.length > 0;
            const hasOneSel = selectedSchedules.length === 1;
            const off = !hasSel || savingScheduleAction;
            return (
              <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-100 px-2 py-1">
                {/* Filters */}
                <AppSelect
                  value={scheduleDefinedPeriod}
                  onChange={(v) => {
                    const value = v ?? "custom";
                    setScheduleDefinedPeriod(value);
                    const today = new Date();
                    if (value === "this_year") {
                      setScheduleFilterFrom(`${today.getFullYear()}-01-01`);
                      setScheduleFilterTo(`${today.getFullYear()}-12-31`);
                    } else if (value === "next_12_months") {
                      const from = new Date(today.getFullYear(), today.getMonth(), 1);
                      const to = new Date(today.getFullYear(), today.getMonth() + 12, 0);
                      setScheduleFilterFrom(formatInputDate(from));
                      setScheduleFilterTo(formatInputDate(to));
                    }
                  }}
                  options={[
                    { value: "this_year", label: "This Year" },
                    { value: "next_12_months", label: "Next 12 Months" },
                  ]}
                  placeholder="Period"
                  clearable
                  size="sm"
                />
                <input type="date" value={scheduleFilterFrom}
                  onChange={(e) => { setScheduleDefinedPeriod("custom"); setScheduleFilterFrom(e.target.value); }}
                  className="h-6 w-28 shrink-0 border border-slate-200 bg-white px-1.5 text-[10px] focus:outline-none focus:border-[#0B3B2E]"
                />
                <span className="shrink-0 text-[10px] text-slate-400">–</span>
                <input type="date" value={scheduleFilterTo}
                  onChange={(e) => { setScheduleDefinedPeriod("custom"); setScheduleFilterTo(e.target.value); }}
                  className="h-6 w-28 shrink-0 border border-slate-200 bg-white px-1.5 text-[10px] focus:outline-none focus:border-[#0B3B2E]"
                />
                <input type="text" value={scheduleSearchText}
                  onChange={(e) => setScheduleSearchText(e.target.value)}
                  placeholder="Search month, invoice no…"
                  className="h-6 w-40 shrink-0 border border-slate-200 bg-white px-1.5 text-[10px] focus:outline-none focus:border-[#0B3B2E]"
                />
                <button onClick={() => { setScheduleDefinedPeriod("custom"); setScheduleFilterFrom(""); setScheduleFilterTo(""); setScheduleSearchText(""); setSelectedSchedules([]); }}
                  className="h-6 shrink-0 border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                  Reset
                </button>
                <button onClick={async () => {
                    if (currentCompany?._id) {
                      const bundle = await getTenantStatementBundle(tenantId);
                      if (Array.isArray(bundle.leases)) dispatch(getLeasesSuccess(bundle.leases));
                      if (Array.isArray(bundle.invoices)) setTenantInvoices(bundle.invoices);
                      if (Array.isArray(bundle.invoiceNotes)) setTenantInvoiceNotes(bundle.invoiceNotes);
                      setInvoiceRefresh((v) => v + 1); setSelectedSchedules([]);
                      toast.success("Billing schedule refreshed.");
                    }
                  }}
                  className="h-6 shrink-0 flex items-center gap-1 border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                  <FaSync size={8} /> Refresh
                </button>

                {/* Divider */}
                <span className="shrink-0 h-4 w-px bg-slate-200 mx-0.5" />

                {/* Actions */}
                <button type="button" onClick={handleCreateInvoices} disabled={off} className={off ? dis : act("border-[#0B3B2E] bg-[#0B3B2E] hover:bg-[#0A3127]")}><FaFileInvoiceDollar size={9} /> Create Invoice</button>
                <button type="button" onClick={handleCancelInvoices} disabled={off} className={off ? dis : act("border-red-600 bg-red-600 hover:bg-red-700")}><FaBan size={9} /> Cancel</button>
                <button type="button" onClick={handleEditSchedules} disabled={!hasOneSel || savingScheduleAction} className={!hasOneSel || savingScheduleAction ? dis : act("border-amber-600 bg-amber-600 hover:bg-amber-700")}><FaCog size={9} /> Edit</button>
                <button type="button" onClick={handleDeleteSchedules} disabled={off} className={off ? dis : act("border-slate-600 bg-slate-600 hover:bg-slate-700")}><FaTrash size={9} /> Delete</button>
                <button type="button" onClick={handleFreezeSchedules} disabled={off} className={off ? dis : allFrozen ? act("border-sky-600 bg-sky-600 hover:bg-sky-700") : act("border-indigo-600 bg-indigo-600 hover:bg-indigo-700")}>
                  {allFrozen ? <FaSun size={9} /> : <FaSnowflake size={9} />} {allFrozen ? "Unfreeze" : "Freeze"}
                </button>

                {selectedSchedules.length > 0 && (
                  <span className="ml-auto shrink-0 border border-[#0B3B2E] bg-[#EDF5F1] px-2 py-0.5 text-[9px] font-black text-[#0B3B2E]">
                    {selectedSchedules.length} selected
                  </span>
                )}
              </div>
            );
          })()}
        </div>

        {showFreezeScheduleModal && selectedSchedules.length > 0 && (
              <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-2">
                <div className="bg-white shadow-xl border border-slate-200 w-full max-w-md">
                  <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      {allFrozen ? <FaSun className="text-sky-600" /> : <FaSnowflake className="text-indigo-600" />}
                      {allFrozen ? "Confirm Schedule Activation" : "Confirm Schedule Freeze"}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowFreezeScheduleModal(false)}
                      className="text-slate-500 hover:text-slate-700"
                    >
                      <FaTimes />
                    </button>
                  </div>
                  <div className="p-2">
                    <p className="text-sm text-slate-700 mb-4">
                      {allFrozen
                        ? "Are you sure you want to activate the selected frozen schedule(s)?"
                        : "Are you sure you want to freeze the selected schedule(s)?"}
                    </p>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowFreezeScheduleModal(false)}
                        className="px-3 py-1.5 text-xs border border-slate-300 font-semibold hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const selectedRows = selectedSchedules.map((key) => billingScheduleByKey.get(key)).filter(Boolean);
                          const bookedRows = selectedRows.filter((row) => row.booked === "Yes");
                          const rowsToChange = selectedRows.filter((row) => row.booked !== "Yes");
                          const activating = rowsToChange.length > 0 && rowsToChange.every((row) => row.frozen === "Yes");

                          if (rowsToChange.length === 0) {
                            toast.warning(activating ? "Booked schedule rows cannot be activated." : "Booked schedule rows cannot be frozen.");
                            return;
                          }

                          const ok = await persistScheduleAdjustments((currentAdjustments) => {
                            const byKey = new Map(currentAdjustments.map((item) => [item.periodKey, { ...item }]));
                            rowsToChange.forEach((row) => {
                              const existing = byKey.get(row.periodKey) || { periodKey: row.periodKey };
                              byKey.set(row.periodKey, {
                                ...existing,
                                fromDate: row.fromRaw,
                                toDate: row.toRaw,
                                rentAmount: Number(row.rent || 0),
                                utilityAmount: Number(row.utility || 0),
                                utilityNames: row.utilityNames || [],
                                status: activating ? "active" : "frozen",
                                updatedAt: new Date().toISOString(),
                              });
                            });
                            return Array.from(byKey.values());
                          }, activating
                            ? (bookedRows.length > 0 ? "Unbooked frozen schedule(s) activated. Booked rows were skipped." : "Schedule(s) activated successfully.")
                            : (bookedRows.length > 0 ? "Unbooked schedule(s) frozen. Booked rows were skipped." : "Schedule(s) frozen successfully."));

                          if (ok) {
                            setShowFreezeScheduleModal(false);
                            setSelectedSchedules([]);
                          }
                        }}
                        className="px-3 py-1.5 text-xs text-white font-semibold bg-blue-600 hover:bg-blue-700"
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showDeleteScheduleModal && selectedSchedules.length > 0 && (
              <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-2">
                <div className="bg-white shadow-xl border border-slate-200 w-full max-w-md">
                  <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <FaTrash className="text-red-600" />
                      Confirm Schedule Deletion
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowDeleteScheduleModal(false)}
                      className="text-slate-500 hover:text-slate-700"
                    >
                      <FaTimes />
                    </button>
                  </div>
                  <div className="p-2">
                    <p className="text-sm text-slate-700 mb-4">
                      Are you sure you want to delete the selected schedule(s)? This action cannot be undone.
                    </p>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDeleteScheduleModal(false)}
                        className="px-3 py-1.5 text-xs border border-slate-300 font-semibold hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          const selectedRows = selectedSchedules.map((key) => billingScheduleByKey.get(key)).filter(Boolean);
                          const bookedRows = selectedRows.filter((row) => row.booked === "Yes");
                          const rowsToDelete = selectedRows.filter((row) => row.booked !== "Yes");

                          if (rowsToDelete.length === 0) {
                            toast.warning("Booked schedule rows cannot be deleted.");
                            return;
                          }

                          const ok = await persistScheduleAdjustments((currentAdjustments) => {
                            const byKey = new Map(currentAdjustments.map((item) => [item.periodKey, { ...item }]));
                            rowsToDelete.forEach((row) => {
                              const existing = byKey.get(row.periodKey) || { periodKey: row.periodKey };
                              byKey.set(row.periodKey, {
                                ...existing,
                                status: "deleted",
                                updatedAt: new Date().toISOString(),
                              });
                            });
                            return Array.from(byKey.values());
                          }, bookedRows.length > 0 ? "Unbooked schedule(s) deleted. Booked rows were skipped." : "Schedule(s) deleted successfully.");

                          if (ok) {
                            setShowDeleteScheduleModal(false);
                            setSelectedSchedules([]);
                          }
                        }}
                        className="px-3 py-1.5 text-xs text-white font-semibold bg-red-600 hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showEditScheduleModal && editingSchedule !== null && (
              <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-2">
                <div className="bg-white shadow-xl border border-slate-200 w-full max-w-md">
                  <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <FaCog className="text-green-600" />
                      Edit Schedule
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowEditScheduleModal(false)}
                      className="text-slate-500 hover:text-slate-700"
                    >
                      <FaTimes />
                    </button>
                  </div>
                  <div className="p-2 space-y-3">
                    <label className="text-xs font-semibold text-slate-700">From Date</label>
                    <input
                      type="date"
                      value={scheduleForm.from}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, from: e.target.value }))}
                      className="mt-1 h-8 w-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-800 focus:outline-none focus:border-[#0B3B2E]"
                    />
                    <label className="text-xs font-semibold text-slate-700">To Date</label>
                    <input
                      type="date"
                      value={scheduleForm.to}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, to: e.target.value }))}
                      className="mt-1 h-8 w-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-800 focus:outline-none focus:border-[#0B3B2E]"
                    />
                    <label className="text-xs font-semibold text-slate-700">{termRent}</label>
                    <input
                      type="number"
                      value={scheduleForm.rent}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, rent: e.target.value }))}
                      className="mt-1 h-8 w-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-800 focus:outline-none focus:border-[#0B3B2E]"
                    />
                    <label className="text-xs font-semibold text-slate-700">Utility</label>
                    <input
                      type="number"
                      value={scheduleForm.utility}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, utility: e.target.value }))}
                      className="mt-1 h-8 w-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-800 focus:outline-none focus:border-[#0B3B2E]"
                    />
                  </div>
                  <div className="px-3 py-2 border-t border-slate-200 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowEditScheduleModal(false)}
                      className="px-3 py-1.5 text-xs border border-slate-300 font-semibold hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        const row = billingScheduleByKey.get(editingSchedule);
                        if (!row) {
                          setShowEditScheduleModal(false);
                          return;
                        }

                        if (row.booked === "Yes") {
                          toast.warning("Booked schedule rows cannot be edited from this screen.");
                          return;
                        }

                        const ok = await persistScheduleAdjustments((currentAdjustments) => {
                          const byKey = new Map(currentAdjustments.map((item) => [item.periodKey, { ...item }]));
                          const existing = byKey.get(row.periodKey) || { periodKey: row.periodKey };
                          byKey.set(row.periodKey, {
                            ...existing,
                            fromDate: scheduleForm.from || row.fromRaw,
                            toDate: scheduleForm.to || row.toRaw,
                            rentAmount: scheduleForm.rent === "" ? Number(row.rent || 0) : Number(scheduleForm.rent),
                            utilityAmount: scheduleForm.utility === "" ? Number(row.utility || 0) : Number(scheduleForm.utility),
                            utilityNames: row.utilityNames || [],
                            status: existing.status === "deleted" ? "active" : existing.status || "active",
                            updatedAt: new Date().toISOString(),
                          });
                          return Array.from(byKey.values());
                        }, "Schedule updated successfully.");

                        if (ok) {
                          setShowEditScheduleModal(false);
                          setEditingSchedule(null);
                          setSelectedSchedules([]);
                        }
                      }}
                      className={`px-3 py-1.5 text-xs text-white font-semibold ${MILIK_GREEN} hover:bg-[#0A3127]`}
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            )}


        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[1200px] text-[11px]">
            <thead className="sticky top-0 z-10 shadow-sm">
              <tr className="bg-[#0B3B2E] text-white">
                <th className="px-2.5 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={
                      selectedSchedules.length === filteredBillingScheduleData.length && filteredBillingScheduleData.length > 0
                    }
                    onChange={handleSelectAll}
                    className="cursor-pointer"
                  />
                </th>
                <th className="px-2.5 py-1.5 text-left font-semibold">From</th>
                <th className="px-2.5 py-1.5 text-left font-semibold">To</th>
                <th className="px-2.5 py-1.5 text-left font-semibold">Description</th>
                <th className="px-2.5 py-1.5 text-right font-semibold">{termRent} Amount</th>
                <th className="px-2.5 py-1.5 text-right font-semibold">S. Charge/Util.</th>
                <th className="px-2.5 py-1.5 text-right font-semibold">Total</th>
                <th className="px-3 py-2 text-center font-semibold">Frozen</th>
                <th className="px-3 py-2 text-center font-semibold">Booked</th>
                <th className="px-2.5 py-1.5 text-left font-semibold">Invoice #</th>
              </tr>
            </thead>
            <tbody>
              {filteredBillingScheduleData.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    {scheduleSearchText || scheduleFilterFrom || scheduleFilterTo
                      ? "No billing periods match the current filter."
                      : "No billing schedule generated yet. Check lease dates and rent amount."}
                  </td>
                </tr>
              )}
              {filteredBillingScheduleData.map((row, index) => {
                const total = row.rent + row.utility;
                const isSelected = selectedSchedules.includes(row.periodKey);

                return (
                  <tr
                    key={`${row.from}-${row.description}`}
                    className={`${
                      isSelected ? "bg-blue-50" : index % 2 === 0 ? "bg-white" : "bg-slate-50"
                    } border-b border-slate-200 hover:bg-emerald-50/40 cursor-pointer`}
                    onClick={() => handleSelectSchedule(row.periodKey)}
                  >
                    <td className="px-2.5 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectSchedule(row.periodKey)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-2.5 py-1 text-slate-800">{row.from}</td>
                    <td className="px-2.5 py-1 text-slate-800">{row.to}</td>
                    <td className="px-2.5 py-1 font-medium text-slate-900">{row.description}</td>
                    <td className="px-2.5 py-1 text-right text-slate-900">{row.rent.toLocaleString()}</td>
                    <td className="px-2.5 py-1 text-right text-slate-900">
                      <div>
                        <div className="font-bold">{row.utility ? row.utility.toLocaleString() : "-"}</div>
                        {row.utilityNames && row.utilityNames.length > 0 && (
                          <div className="text-[9px] text-slate-500 font-medium mt-0.5">
                            {row.utilityNames.join(", ")}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-2.5 py-1 text-right font-semibold text-slate-900">
                      {total.toLocaleString()}
                    </td>
                    <td className="px-2.5 py-1.5 text-center">
                      {row.frozen === "Yes" ? (
                        <span className="inline-flex items-center gap-1 border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-black text-indigo-700">
                          <FaSnowflake size={8} /> Frozen
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 border border-slate-100 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-center">
                      {row.booked === "Yes" ? (
                        <span className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-700">
                          <FaCheck size={8} /> Booked
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 border border-slate-100 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                          —
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 ${
                        row.booked === "Yes" ? "text-emerald-700 font-semibold" : "text-slate-500"
                      }`}
                    >
                      {row.invoice}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filteredBillingScheduleData.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[#0B3B2E] bg-[#EDF5F1]">
                  <td colSpan={4} className="px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#0B3B2E]">
                    {filteredBillingScheduleData.length} periods · {scheduleFooter.bookedCount} booked
                  </td>
                  <td className="px-2.5 py-1.5 text-right text-[11px] font-black text-[#0B3B2E]">{scheduleFooter.totRent.toLocaleString()}</td>
                  <td className="px-2.5 py-1.5 text-right text-[11px] font-black text-[#0B3B2E]">{scheduleFooter.totUtil > 0 ? scheduleFooter.totUtil.toLocaleString() : "—"}</td>
                  <td className="px-2.5 py-1.5 text-right text-[11px] font-black text-[#0B3B2E]">{scheduleFooter.totTotal.toLocaleString()}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {hasOpenLease && (
          <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
            <button
              type="button"
              onClick={() => setScheduleExtensionMonths((m) => m + DEFAULT_SCHEDULE_MONTHS)}
              className="flex items-center gap-1.5 border border-[#0B3B2E] px-3 py-1.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#EDF5F1] transition-colors"
            >
              <FaPlus size={9} />
              Extend {DEFAULT_SCHEDULE_MONTHS} months
              {scheduleExtensionMonths > 0 && (
                <span className="ml-1 border border-[#0B3B2E] bg-[#EDF5F1] px-1.5 text-[10px] font-black">
                  +{scheduleExtensionMonths}mo
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderRentReviewsAndEscalations = () => {
    const baseRent = tenantLease?.rentAmount || tenant?.rent || 0;
    const sortedRecords = [...reviewRecords].sort(
      (a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate)
    );
    const today = new Date(); today.setHours(0, 0, 0, 0);


    const appliedOnly = sortedRecords.filter((record) => record.status === "Applied");
    const currentEffectiveRent = appliedOnly.reduce((rent, record) => {
      return computeNewRent(rent, record.type, record.value, record.direction || "increase");
    }, baseRent);

    const pendingRecords = sortedRecords.filter((record) => record.status !== "Applied");
    const nextPendingRecord = pendingRecords.length > 0 ? pendingRecords[0] : null;
    const projectedRent = nextPendingRecord
      ? computeNewRent(currentEffectiveRent, nextPendingRecord.type, nextPendingRecord.value, nextPendingRecord.direction || "increase")
      : currentEffectiveRent;

    const computedRows = sortedRecords.reduce(
      (acc, record) => {
        const previousRent = acc.runningRent;
        const resultingRent = computeNewRent(previousRent, record.type, record.value, record.direction || "increase");
        acc.rows.push({ ...record, previousRent, resultingRent });
        if (record.status === "Applied") {
          acc.runningRent = resultingRent;
        }
        return acc;
      },
      { runningRent: baseRent, rows: [] }
    ).rows;

    const resetReviewForm = () => {
      setReviewForm({ reviewType: "escalation", type: "percentage", direction: "increase", value: 5, frequency: "yearly", effectiveDate: new Date().toISOString().split("T")[0], note: "" });
      setEditingReviewId(null);
      setReviewFormOpen(false);
      setPendingNoticeReview(null);
    };

    const handleSaveReview = async () => {
      if (!tenantLease?._id) {
        toast.error("An active lease is required before saving rent reviews.");
        return;
      }
      if (!reviewForm.effectiveDate) {
        toast.error("Effective date is required");
        return;
      }
      if (!reviewForm.value || Number(reviewForm.value) <= 0) {
        toast.error("Value must be greater than zero");
        return;
      }

      const timestamp = new Date().toISOString();
      const prevRent = Number(currentEffectiveRent || baseRent);
      const newResultingRent = computeNewRent(prevRent, reviewForm.type, reviewForm.value, reviewForm.direction || "increase");
      const newRecord = {
        id: `REV-${Date.now()}`,
        ...reviewForm,
        status: "Scheduled",
        previousRent: prevRent,
        resultingRent: newResultingRent,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const nextRecords = editingReviewId
        ? reviewRecords.map((record) =>
            record.id === editingReviewId
              ? {
                  ...record,
                  ...reviewForm,
                  updatedAt: timestamp,
                  previousRent: Number(record.previousRent || baseRent),
                  resultingRent: computeNewRent(Number(record.previousRent || baseRent), reviewForm.type, reviewForm.value, reviewForm.direction || "increase"),
                }
              : record
          )
        : [...reviewRecords, newRecord];

      setReviewSaving(true);
      const saved = await persistRentReviewRecords(nextRecords, localBillingScheduleAdjustments, editingReviewId ? "Review updated" : "Review scheduled");
      setReviewSaving(false);
      if (saved) {
        setReviewFormOpen(false);
        setEditingReviewId(null);
        setReviewForm({ reviewType: "escalation", type: "percentage", direction: "increase", value: 5, frequency: "yearly", effectiveDate: new Date().toISOString().split("T")[0], note: "" });
        if (!editingReviewId) setPendingNoticeReview(newRecord);
      }
    };

    const handleEditReview = (record) => {
      setEditingReviewId(record.id);
      setPendingNoticeReview(null);
      setReviewForm({
        reviewType: record.reviewType || "escalation",
        type: record.type,
        direction: record.direction || "increase",
        value: record.value,
        frequency: record.frequency,
        effectiveDate: record.effectiveDate,
        note: record.note || "",
      });
      setReviewFormOpen(true);
    };

    const handleDeleteReview = async (reviewId) => {
      const target = reviewRecords.find((record) => record.id === reviewId);
      if (String(target?.status || "") === "Applied") {
        toast.warning("Applied reviews are locked to preserve billing history.");
        return;
      }

      const nextRecords = reviewRecords.filter((record) => record.id !== reviewId);
      const saved = await persistRentReviewRecords(nextRecords, localBillingScheduleAdjustments, "Review deleted");
      if (saved && editingReviewId === reviewId) resetReviewForm();
    };

    const handleApplyReview = async (reviewId) => {
      const target = computedRows.find((record) => record.id === reviewId);
      if (!target) {
        toast.error("Review record not found");
        return;
      }
      if (String(target.status || "") === "Applied") {
        toast.info("This review has already been applied.");
        return;
      }

      const effectiveDate = new Date(target.effectiveDate);
      if (Number.isNaN(effectiveDate.getTime())) {
        toast.error("Review effective date is invalid.");
        return;
      }

      const nextRecords = reviewRecords.map((record) =>
        record.id === reviewId
          ? {
              ...record,
              status: "Applied",
              appliedAt: new Date().toISOString(),
              previousRent: Number(target.previousRent || baseRent),
              resultingRent: Number(target.resultingRent || baseRent),
              updatedAt: new Date().toISOString(),
            }
          : record
      );

      const nextAdjustments = [...(Array.isArray(localBillingScheduleAdjustments) ? localBillingScheduleAdjustments : [])];
      const adjustmentIndexByKey = new Map(nextAdjustments.map((item, index) => [String(item?.periodKey || ""), index]));

      (billingScheduleData || []).forEach((row) => {
        const rowPeriodStart = row?.fromRaw ? new Date(row.fromRaw) : null;
        if (!row?.periodKey || !rowPeriodStart || Number.isNaN(rowPeriodStart.getTime())) return;
        if (rowPeriodStart < effectiveDate) return;
        if (String(row?.booked || "").toLowerCase() === "yes") return;
        if (String(row?.frozen || "").toLowerCase() === "yes") return;

        const existingIndex = adjustmentIndexByKey.get(String(row.periodKey));
        const existing = existingIndex >= 0 ? nextAdjustments[existingIndex] : { periodKey: row.periodKey };
        const nextRow = {
          ...existing,
          periodKey: row.periodKey,
          fromDate: row.fromRaw,
          toDate: row.toRaw,
          rentAmount: Number(target.resultingRent || row.rent || 0),
          utilityAmount: Number(existing?.utilityAmount ?? row.utility ?? 0),
          utilityNames: Array.isArray(existing?.utilityNames) && existing.utilityNames.length > 0
            ? existing.utilityNames
            : Array.isArray(row?.utilityNames)
            ? row.utilityNames
            : [],
          status: String(existing?.status || "active") === "deleted" ? "active" : String(existing?.status || "active"),
          note: existing?.note || `Rent review applied effective ${row.from}`,
          updatedAt: new Date().toISOString(),
        };

        if (existingIndex >= 0) {
          nextAdjustments[existingIndex] = nextRow;
        } else {
          nextAdjustments.push(nextRow);
          adjustmentIndexByKey.set(String(row.periodKey), nextAdjustments.length - 1);
        }
      });

      // Auto-schedule next recurrence for recurring reviews
      let finalRecords = nextRecords;
      if (target.frequency && target.frequency !== "once") {
        const nextDate = computeNextDate(target.effectiveDate, target.frequency);
        const nextResultingRent = computeNewRent(target.resultingRent, target.type, target.value, target.direction || "increase");
        const alreadyExists = nextRecords.some((r) => r.effectiveDate === nextDate && r.type === target.type && r.value === target.value);
        if (!alreadyExists) {
          const ts = new Date().toISOString();
          finalRecords = [
            ...nextRecords,
            {
              id: `REV-${Date.now()}`,
              reviewType: target.reviewType || "escalation",
              type: target.type,
              direction: target.direction || "increase",
              value: target.value,
              frequency: target.frequency,
              effectiveDate: nextDate,
              note: `Auto-scheduled (${target.frequency}) from ${fmtDate(target.effectiveDate)}`,
              status: "Scheduled",
              previousRent: target.resultingRent,
              resultingRent: nextResultingRent,
              createdAt: ts,
              updatedAt: ts,
            },
          ];
        }
      }

      await persistRentReviewRecords(finalRecords, nextAdjustments,
        target.frequency && target.frequency !== "once"
          ? "Review applied — next recurrence scheduled"
          : "Review applied and future billing periods updated"
      );
    };

    const handleSendNotice = async (review) => {
      if (!tenant?.phone && !tenant?.email) {
        toast.warning("Tenant has no phone or email on record");
        return;
      }
      const dir = review.direction === "decrease" ? "reduced" : "increased";
      const changeLabel = review.type === "fixed_rent"
        ? `set to KES ${Number(review.resultingRent || 0).toLocaleString()}`
        : review.type === "percentage"
          ? `${dir} by ${Number(review.value)}%`
          : `${dir} by KES ${Number(review.value).toLocaleString()}`;
      const customBody = `Dear ${tenant?.name || "Tenant"}, your rent has been reviewed and will be ${changeLabel}. New rent: KES ${Number(review.resultingRent || 0).toLocaleString()} effective ${fmtDate(review.effectiveDate)}. For queries contact us.`;

      setSendingNotice(true);
      try {
        await sendCommunicationMessage({
          business: currentCompany?._id,
          contextType: "tenant_bulk",
          channel: "sms",
          templateKey: "tenant_notice_sms",
          recordIds: [tenantId],
          customBody,
        });
        toast.success("Rent review notice sent to tenant");
        setPendingNoticeReview(null);
      } catch {
        toast.error("Failed to send notice — please use SMS Tenants to send manually");
      } finally {
        setSendingNotice(false);
      }
    };


    const isEscalation = reviewForm.reviewType === "escalation";
    const accentBg = isEscalation ? "bg-blue-700" : "bg-amber-600";
    const accentBorder = isEscalation ? "border-blue-700" : "border-amber-500";
    const isFormDecrease = reviewForm.direction === "decrease";
    const isFormFixed = reviewForm.type === "fixed_rent";
    const previewRent = computeNewRent(currentEffectiveRent, reviewForm.type, reviewForm.value, reviewForm.direction || "increase");

    return (
      <div className="flex flex-col gap-3">

        {/* ── KPI strip ───────────────────────────────────────────────── */}
        {(() => {
          const overdueCount = pendingRecords.filter((r) => new Date(r.effectiveDate) < today).length;
          const kpis = [
            { label: "Base Rent",             value: fmtMoney(baseRent),            border: "border-slate-200",  bg: "bg-white",         text: "text-slate-900"  },
            { label: "Current Effective Rent", value: fmtMoney(currentEffectiveRent),border: "border-[#0B3B2E]", bg: "bg-[#EDF5F1]",     text: "text-[#0B3B2E]" },
            {
              label: overdueCount > 0 ? `Pending (${overdueCount} Overdue)` : "Pending Reviews",
              value: pendingRecords.length,
              border: overdueCount > 0 ? "border-red-300" : "border-blue-200",
              bg: overdueCount > 0 ? "bg-red-50" : "bg-blue-50",
              text: overdueCount > 0 ? "text-red-700" : "text-blue-800",
            },
            { label: "Projected Next Rent", value: fmtMoney(projectedRent), border: "border-orange-200", bg: "bg-orange-50", text: "text-orange-800" },
          ];
          return (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {kpis.map(({ label, value, border, bg, text }) => (
                <div key={label} className={`border px-4 py-3 shadow-sm ${border} ${bg}`}>
                  <div className={`text-[10px] font-black uppercase tracking-widest opacity-70 ${text}`}>{label}</div>
                  <div className={`mt-0.5 text-sm font-extrabold ${text}`}>{value}</div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── toolbar ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border border-slate-200 bg-white px-3 py-2 shadow-sm" style={{ borderLeftWidth: 3, borderLeftColor: "#0B3B2E" }}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">Rent Reviews & Escalations</span>
            <span className="hidden text-[10px] text-slate-400 sm:inline">— track and apply rent adjustments</span>
          </div>
          {!reviewFormOpen && (
            <button
              onClick={() => { setEditingReviewId(null); resetReviewForm(); setReviewFormOpen(true); }}
              className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] transition-colors"
            >
              <FaPlus size={9} /> Add Review
            </button>
          )}
        </div>

        {/* ── post-save notice banner ──────────────────────────────────── */}
        {pendingNoticeReview && !reviewFormOpen && (
          <div className="flex items-center justify-between gap-3 border border-emerald-300 bg-emerald-50 px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2.5">
              <FaCheck size={12} className="shrink-0 text-emerald-600" />
              <div>
                <p className="text-xs font-black text-emerald-800">Review scheduled for {fmtDate(pendingNoticeReview.effectiveDate)}</p>
                <p className="text-[10px] text-emerald-600">
                  New rent: <span className="font-black">{fmtMoney(pendingNoticeReview.resultingRent)}</span>
                  {pendingNoticeReview.frequency !== "once" && <span className="ml-2 italic">Next recurrence will be created on apply.</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleSendNotice(pendingNoticeReview)}
                disabled={sendingNotice}
                className="inline-flex items-center gap-1.5 bg-emerald-700 px-3 py-1.5 text-[10px] font-black text-white hover:bg-emerald-800 disabled:opacity-60 transition-colors"
              >
                <FaSms size={9} /> {sendingNotice ? "Sending…" : "Notify Tenant via SMS"}
              </button>
              <button onClick={() => setPendingNoticeReview(null)} className="text-emerald-500 hover:text-emerald-700 transition-colors">
                <FaTimes size={11} />
              </button>
            </div>
          </div>
        )}

        {/* ── form panel ──────────────────────────────────────────────── */}
        {reviewFormOpen && (
            <div className={`border ${accentBorder} bg-white shadow-sm`}>
              {/* Header */}
              <div className={`flex items-center justify-between border-b border-white/10 ${accentBg} px-4 py-2.5`}>
                <div className="flex items-center gap-2 text-white">
                  {isEscalation ? <FaChartLine size={11} /> : <FaSearch size={11} />}
                  <span className="text-xs font-black uppercase tracking-widest">
                    {editingReviewId
                      ? `Edit ${isEscalation ? "Escalation" : "Review"}`
                      : `New ${isEscalation ? "Escalation" : "Review"}`}
                  </span>
                </div>
                <button onClick={resetReviewForm} className="text-white/60 hover:text-white transition-colors">
                  <FaTimes size={11} />
                </button>
              </div>

              <div className="p-4">
                {/* ── Category toggle ── */}
                <div className="mb-4">
                  <p className={reviewLabelCls}>Category</p>
                  <div className="flex overflow-hidden border border-slate-200">
                    <button type="button"
                      onClick={() => setReviewForm((p) => ({ ...p, reviewType: "escalation", direction: "increase", type: p.type === "fixed_rent" ? "percentage" : p.type, frequency: p.frequency === "once" ? "yearly" : p.frequency }))}
                      className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-black transition-colors ${isEscalation ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-blue-50"}`}>
                      <div className="flex items-center gap-1"><FaChartLine size={9} /> Escalation</div>
                      <span className={`font-normal ${isEscalation ? "text-blue-200" : "text-slate-400"}`}>Predetermined — lease clause</span>
                    </button>
                    <button type="button"
                      onClick={() => setReviewForm((p) => ({ ...p, reviewType: "review", frequency: "once" }))}
                      className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-black transition-colors border-l border-slate-200 ${!isEscalation ? "bg-amber-500 text-white" : "bg-white text-slate-500 hover:bg-amber-50"}`}>
                      <div className="flex items-center gap-1"><FaSearch size={9} /> Review</div>
                      <span className={`font-normal ${!isEscalation ? "text-amber-100" : "text-slate-400"}`}>Discretionary — market assessed</span>
                    </button>
                  </div>
                  <p className={`mt-1 text-[10px] ${isEscalation ? "text-blue-600" : "text-amber-600"}`}>
                    {isEscalation
                      ? "Automatic increase on a fixed schedule. Recurs automatically when applied."
                      : "Negotiated adjustment — can increase, decrease, or set a new fixed rent."}
                  </p>
                </div>

                {/* ── Fields grid ── */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {/* Adjustment Type */}
                  <div>
                    <label className={reviewLabelCls}>Adjustment Type</label>
                    <AppSelect
                      value={reviewForm.type}
                      onChange={(v) => setReviewForm((p) => ({ ...p, type: v ?? "percentage", direction: v === "fixed_rent" ? "increase" : p.direction }))}
                      options={[
                        { value: "percentage", label: "Percentage (%)" },
                        { value: "amount", label: "By Amount (KES)" },
                        ...(!isEscalation ? [{ value: "fixed_rent", label: "Set Fixed Rent" }] : []),
                      ]}
                      size="md"
                    />
                  </div>

                  {/* Direction — only for reviews and non-fixed-rent types */}
                  {!isEscalation && !isFormFixed ? (
                    <div>
                      <label className={reviewLabelCls}>Direction</label>
                      <div className="flex h-8 overflow-hidden border border-slate-300">
                        <button type="button"
                          onClick={() => setReviewForm((p) => ({ ...p, direction: "increase" }))}
                          className={`flex flex-1 items-center justify-center gap-1 text-[10px] font-black transition-colors ${!isFormDecrease ? "bg-emerald-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                          <FaArrowUp size={8} /> Increase
                        </button>
                        <button type="button"
                          onClick={() => setReviewForm((p) => ({ ...p, direction: "decrease" }))}
                          className={`flex flex-1 items-center justify-center gap-1 text-[10px] font-black transition-colors border-l border-slate-300 ${isFormDecrease ? "bg-red-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                          <FaArrowDown size={8} /> Decrease
                        </button>
                      </div>
                    </div>
                  ) : isEscalation ? (
                    <div>
                      <label className={reviewLabelCls}>Direction</label>
                      <div className="flex h-8 items-center gap-1.5 border border-blue-200 bg-blue-50 px-2 text-[10px] font-black text-blue-700">
                        <FaArrowUp size={8} /> Always Increase
                      </div>
                    </div>
                  ) : null}

                  {/* Value */}
                  <div>
                    <label className={reviewLabelCls}>
                      {reviewForm.type === "percentage" ? "Rate (%)" : reviewForm.type === "fixed_rent" ? "New Rent (KES)" : "Amount (KES)"}
                    </label>
                    <input type="number" min="0.01" step="0.01"
                      value={reviewForm.value}
                      onChange={(e) => setReviewForm((p) => ({ ...p, value: Math.max(0, Number(e.target.value)) }))}
                      className={reviewInputCls}
                    />
                  </div>

                  {/* Frequency */}
                  <div>
                    <label className={reviewLabelCls}>Frequency</label>
                    <AppSelect
                      value={reviewForm.frequency}
                      onChange={(v) => setReviewForm((p) => ({ ...p, frequency: v ?? (isEscalation ? "yearly" : "once") }))}
                      options={isEscalation
                        ? [{ value: "yearly", label: "Yearly" }, { value: "biannual", label: "Bi-Annual" }, { value: "quarterly", label: "Quarterly" }]
                        : [{ value: "once", label: "One-Off" }, { value: "yearly", label: "Yearly" }, { value: "biannual", label: "Bi-Annual" }, { value: "quarterly", label: "Quarterly" }]
                      }
                      size="md"
                    />
                  </div>

                  {/* Effective Date */}
                  <div>
                    <label className={reviewLabelCls}>Effective Date</label>
                    <input type="date" value={reviewForm.effectiveDate}
                      onChange={(e) => setReviewForm((p) => ({ ...p, effectiveDate: e.target.value }))}
                      className={reviewInputCls} />
                  </div>

                  {/* Preview */}
                  <div>
                    <label className={reviewLabelCls}>New Rent</label>
                    <div className={`flex h-8 items-center border px-2 text-xs font-black ${isFormDecrease && !isFormFixed ? "border-red-300 bg-red-50 text-red-700" : isEscalation ? "border-blue-300 bg-blue-50 text-blue-700" : "border-[#0B3B2E] bg-[#EDF5F1] text-[#0B3B2E]"}`}>
                      {fmtMoney(previewRent)}
                    </div>
                  </div>

                  {/* Change */}
                  <div>
                    <label className={reviewLabelCls}>Change</label>
                    <div className={`flex h-8 items-center gap-1 border px-2 text-xs font-black ${isFormDecrease && !isFormFixed ? "border-red-200 bg-red-50 text-red-600" : "border-orange-200 bg-orange-50 text-orange-700"}`}>
                      {isFormFixed
                        ? <><FaLock size={8} /> Fixed</>
                        : isFormDecrease
                          ? <><FaArrowDown size={8} />{reviewForm.type === "percentage" ? `−${Number(reviewForm.value || 0)}%` : `−${fmtMoney(reviewForm.value || 0)}`}</>
                          : <><FaArrowUp size={8} />{reviewForm.type === "percentage" ? `+${Number(reviewForm.value || 0)}%` : `+${fmtMoney(reviewForm.value || 0)}`}</>}
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div className="mt-3">
                  <label className={reviewLabelCls}>Notes / Reason</label>
                  <input type="text" value={reviewForm.note}
                    onChange={(e) => setReviewForm((p) => ({ ...p, note: e.target.value }))}
                    placeholder={isEscalation ? "e.g. Annual CPI escalation — lease clause 8.2" : "e.g. Market review — negotiated down from current rate"}
                    className={reviewInputCls}
                  />
                </div>

                {/* Footer */}
                <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                  <button onClick={resetReviewForm}
                    className="inline-flex items-center gap-1.5 border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                    <FaTimes size={9} /> Cancel
                  </button>
                  <button onClick={handleSaveReview} disabled={reviewSaving}
                    className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-black text-white disabled:opacity-60 transition-colors ${isEscalation ? "bg-blue-700 hover:bg-blue-800" : "bg-amber-600 hover:bg-amber-700"}`}>
                    {reviewSaving ? "Saving…" : editingReviewId ? `Update ${isEscalation ? "Escalation" : "Review"}` : `Schedule ${isEscalation ? "Escalation" : "Review"}`}
                  </button>
                </div>
              </div>
            </div>
        )}

        {/* ── records table ────────────────────────────────────────────── */}
        <div className="border border-slate-200 bg-white shadow-sm">
          {computedRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-slate-400">
              <FaChartLine size={26} className="opacity-30" />
              <p className="text-xs font-semibold">No rent reviews or escalations recorded yet.</p>
              {!reviewFormOpen && (
                <button
                  onClick={() => { setEditingReviewId(null); resetReviewForm(); setReviewFormOpen(true); }}
                  className="mt-1 inline-flex items-center gap-1.5 border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-[#0B3B2E] hover:text-[#0B3B2E] transition-colors"
                >
                  <FaPlus size={9} /> Add First Review
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-[11px]">
                <thead>
                  <tr className="bg-[#0B3B2E] text-white">
                    {["Effective Date", "Category", "Type", "Direction", "Frequency", "Change", "Previous Rent", "New Rent", "Status", "Notes", "Actions"].map((h, i, arr) => (
                      <th key={h} className={`px-3 py-1.5 text-left font-bold whitespace-nowrap ${i < arr.length - 1 ? "border-r border-white/10" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {computedRows.map((record, idx) => {
                    const isApplied = record.status === "Applied";
                    const isDecrease = (record.direction || "increase") === "decrease";
                    const isFixedRent = record.type === "fixed_rent";
                    const isOverdue = !isApplied && new Date(record.effectiveDate) < today;
                    const isEscalationRecord = (record.reviewType || "escalation") === "escalation";
                    const rowBg = isApplied
                      ? "bg-emerald-50/30"
                      : isOverdue
                        ? "bg-red-50/60 hover:bg-red-50"
                        : idx % 2 === 0
                          ? "bg-white hover:bg-blue-50/40"
                          : "bg-slate-50/60 hover:bg-blue-50/40";
                    return (
                      <tr key={record.id} className={`border-b border-gray-100 transition-colors ${rowBg}`}>
                        <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-800 whitespace-nowrap">
                          {fmtDate(record.effectiveDate)}
                          {isOverdue && <span className="ml-1.5 text-[9px] font-black text-red-500 uppercase">overdue</span>}
                        </td>
                        <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap">
                          {isEscalationRecord
                            ? <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700"><FaChartLine size={7} /> Escalation</span>
                            : <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700"><FaSearch size={7} /> Review</span>}
                        </td>
                        <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${
                            isFixedRent   ? "border-purple-200 bg-purple-50 text-purple-700" :
                            record.type === "percentage" ? "border-blue-200 bg-blue-50 text-blue-700" :
                                            "border-violet-200 bg-violet-50 text-violet-700"
                          }`}>
                            {isFixedRent ? "Fixed Rent" : record.type === "percentage" ? "%" : "Amount"}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap">
                          {isFixedRent
                            ? <span className="inline-flex items-center gap-1 text-[10px] font-black text-purple-600"><FaLock size={8} /> Set</span>
                            : isDecrease
                              ? <span className="inline-flex items-center gap-1 text-[10px] font-black text-red-600"><FaArrowDown size={8} /> Decrease</span>
                              : <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-600"><FaArrowUp size={8} /> Increase</span>}
                        </td>
                        <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{formatFrequency(record.frequency)}</td>
                        <td className={`px-3 py-1.5 border-r border-gray-100 font-black whitespace-nowrap ${isDecrease && !isFixedRent ? "text-red-600" : "text-orange-700"}`}>
                          {isFixedRent
                            ? fmtMoney(record.value)
                            : isDecrease
                              ? (record.type === "percentage" ? `−${Number(record.value)}%` : `−${fmtMoney(record.value)}`)
                              : (record.type === "percentage" ? `+${Number(record.value)}%` : `+${fmtMoney(record.value)}`)}
                        </td>
                        <td className="px-3 py-1.5 border-r border-gray-100 font-mono text-slate-500 whitespace-nowrap">{fmtMoney(record.previousRent)}</td>
                        <td className={`px-3 py-1.5 border-r border-gray-100 font-mono font-black whitespace-nowrap ${isDecrease && !isFixedRent ? "text-red-700" : "text-[#0B3B2E]"}`}>
                          {fmtMoney(record.resultingRent)}
                        </td>
                        <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${
                            isApplied  ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
                            isOverdue  ? "border-red-300 bg-red-50 text-red-700" :
                                         "border-amber-200 bg-amber-50 text-amber-700"
                          }`}>
                            {isApplied ? "Applied" : isOverdue ? "Overdue" : "Scheduled"}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 border-r border-gray-100 max-w-[160px] truncate text-slate-500" title={record.note || ""}>{record.note || "—"}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {!isApplied && (
                              <button onClick={() => handleApplyReview(record.id)}
                                className={`inline-flex items-center gap-1 border px-2 py-1 text-[10px] font-black transition-colors ${isOverdue ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100" : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                                title="Apply to billing schedule">
                                <FaCheck size={8} /> Apply
                              </button>
                            )}
                            {!isApplied && (
                              <button onClick={() => handleEditReview(record)}
                                className="border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-600 hover:border-[#0B3B2E] hover:text-[#0B3B2E] transition-colors"
                                title="Edit">
                                <FaEdit size={9} />
                              </button>
                            )}
                            {isApplied && (
                              <button onClick={() => handleSendNotice(record)} disabled={sendingNotice}
                                className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-500 hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50 transition-colors"
                                title="Send rent notice to tenant">
                                <FaSms size={8} />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteReview(record.id)}
                              disabled={isApplied}
                              className={`border px-2 py-1 text-[10px] font-black transition-colors ${isApplied ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300" : "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"}`}
                              title={isApplied ? "Applied reviews are locked" : "Delete"}>
                              <FaTrash size={9} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  const handlePrintReceipt = (receipt) => {
    const printWindow = window.open("", "_blank");
    const receiptHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt #${receipt.receiptNumber}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 20px;
            background: white;
          }
          .receipt-container {
            max-width: 600px;
            margin: 0 auto;
            border: 2px solid #165946;
            padding: 30px;
            border-radius: 8px;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #165946;
            padding-bottom: 15px;
          }
          .company-name {
            font-size: 24px;
            font-weight: bold;
            color: #165946;
            margin-bottom: 5px;
          }
          .receipt-title {
            font-size: 18px;
            font-weight: bold;
            color: #333;
            margin-top: 15px;
          }
          .receipt-number {
            font-size: 14px;
            color: #666;
            margin-top: 10px;
          }
          .detail-row {
            display: flex;
            justify-content: space-between;
            margin: 8px 0;
            font-size: 14px;
          }
          .detail-label {
            font-weight: bold;
            color: #333;
          }
          .detail-value {
            color: #666;
          }
          .divider {
            border-top: 1px solid #ddd;
            margin: 15px 0;
          }
          .amount-section {
            margin: 20px 0;
            padding: 15px;
            background: #f5f5f5;
            border-radius: 4px;
          }
          .total-amount {
            display: flex;
            justify-content: space-between;
            font-size: 18px;
            font-weight: bold;
            color: #165946;
          }
          .footer {
            text-align: center;
            margin-top: 20px;
            font-size: 12px;
            color: #999;
          }
          @media print {
            body {
              background: white;
            }
          }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          <div class="header">
            <div class="company-name">${currentCompany?.companyName || "MILIK"}</div>
            <div class="receipt-title">RENT RECEIPT</div>
            <div class="receipt-number">Receipt #${receipt.receiptNumber}</div>
          </div>

          <div class="detail-row">
            <span class="detail-label">Tenant Name:</span>
            <span class="detail-value">${tenant?.name || "-"}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Reference:</span>
            <span class="detail-value">${receipt.referenceNumber || "-"}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Payment Date:</span>
            <span class="detail-value">${new Date(receipt.paymentDate).toLocaleDateString()}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Payment Method:</span>
            <span class="detail-value">${receipt.paymentMethod || "-"}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Payment Type:</span>
            <span class="detail-value">${receipt.paymentType || "-"}</span>
          </div>

          <div class="divider"></div>

          <div class="amount-section">
            <div class="total-amount">
              <span>Amount Received:</span>
              <span>Ksh ${(receipt.amount || 0).toLocaleString()}</span>
            </div>
          </div>

          <div class="divider"></div>

          <div class="detail-row">
            <span class="detail-label">Status:</span>
            <span class="detail-value">${receipt.isConfirmed ? "CONFIRMED" : "PENDING"}</span>
          </div>

          <div class="footer">
            <p>Thank you for your payment</p>
            <p>This is an electronically generated receipt</p>
          </div>
        </div>
        <script>
          window.onload = function() {
            window.print();
          }
        </script>
      </body>
      </html>
    `;
    printWindow.document.write(receiptHTML);
    printWindow.document.close();
  };

  const renderContent = () => {
    switch (activeTab) {
      case "statement":
        return renderStatement();
      case "billing":
        return renderBillingSchedule();
      case "reviews":
        return renderRentReviewsAndEscalations();
      default:
        return renderStatement();
    }
  };

  if (tenantLoading) {
    return (
      <DashboardLayout>
        <div className="flex h-full items-center justify-center">
          <Spinner size="lg" />
        </div>
      </DashboardLayout>
    );
  }

  if (!tenant) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Tenant Not Found</h1>
            <p className="text-gray-600 mb-4">The tenant you're looking for doesn't exist.</p>
            <button
              onClick={() => navigate("/tenants")}
              className={`${MILIK_GREEN} hover:bg-[#0A3127] text-white px-3 py-1.5 rounded font-semibold flex items-center gap-2 mx-auto`}
            >
              <FaArrowLeft />
              Back to Tenants
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        <div className="mx-auto flex h-full min-h-0 w-full flex-col overflow-hidden" style={{ maxWidth: "98%" }}>
          <div className="print-only-header" style={{ display: "none" }}>
            <div style={{ textAlign: "center", paddingBottom: "10px", marginBottom: "10px" }}>
              <h1
                style={{
                  fontSize: "26px",
                  fontWeight: "bold",
                  color: "#165946",
                  marginBottom: "12px",
                  letterSpacing: "1px",
                }}
              >
                {currentCompany?.companyName || currentCompany?.name || "System Admin"}
              </h1>
              {currentCompany?.companyEmail && (
                <p style={{ fontSize: "13px", color: "#4B5563", marginBottom: "3px" }}>
                  Email: {currentCompany.companyEmail}
                </p>
              )}
              {currentCompany?.companyPhone && (
                <p style={{ fontSize: "13px", color: "#4B5563", marginBottom: "3px" }}>
                  Phone: {currentCompany.companyPhone}
                </p>
              )}
              {currentCompany?.companyAddress && (
                <p style={{ fontSize: "13px", color: "#4B5563", marginBottom: "10px" }}>
                  Address: {currentCompany.companyAddress}
                </p>
              )}
              <div style={{ borderBottom: "3px solid #165946", margin: "10px auto", width: "100%" }}></div>
            </div>
            <h2
              style={{
                fontSize: "20px",
                fontWeight: "bold",
                color: "#1F2937",
                textAlign: "center",
                marginBottom: "15px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Tenant Statement
            </h2>
            <div
              style={{
                backgroundColor: "#F9FAFB",
                border: "2px solid #E5E7EB",
                borderRadius: "8px",
                padding: "15px",
                marginBottom: "20px",
              }}
            >
              <h3
                style={{
                  fontSize: "14px",
                  fontWeight: "bold",
                  color: "#165946",
                  marginBottom: "12px",
                  borderBottom: "1px solid #D1D5DB",
                  paddingBottom: "6px",
                }}
              >
                TENANT INFORMATION
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <p style={{ fontSize: "11px", fontWeight: "bold", color: "#6B7280", marginBottom: "3px" }}>
                    {termTenant} Name
                  </p>
                  <p style={{ fontSize: "13px", fontWeight: "600", color: "#1F2937" }}>
                    {tenant?.tenantName || tenant?.name || "-"}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "11px", fontWeight: "bold", color: "#6B7280", marginBottom: "3px" }}>
                    {termUnit} Number
                  </p>
                  <p style={{ fontSize: "13px", fontWeight: "600", color: "#1F2937" }}>
                    {resolveTenantUnitNumber(tenant)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "11px", fontWeight: "bold", color: "#6B7280", marginBottom: "3px" }}>
                    Property
                  </p>
                  <p style={{ fontSize: "13px", fontWeight: "600", color: "#1F2937" }}>
                    {resolveTenantPropertyName(tenant)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "11px", fontWeight: "bold", color: "#6B7280", marginBottom: "3px" }}>
                    Monthly {termRent}
                  </p>
                  <p style={{ fontSize: "13px", fontWeight: "600", color: "#1F2937" }}>
                    Ksh {(tenantLease?.rentAmount || tenant?.rent || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="sticky top-0 z-30 flex-shrink-0 overflow-hidden border border-slate-200 bg-white shadow-sm no-print">
            {/* ── Tenant meta bar ── */}
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-100 px-2 py-1 bg-[#0B3B2E]/[0.03]">
              <button onClick={() => navigate("/tenants")} className="h-6 shrink-0 flex items-center gap-1 border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                <FaArrowLeft size={9} /> Back
              </button>
              <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />
              {/* Tenant name */}
              <span className="shrink-0 border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-black text-orange-700">
                {tenant?.tenantName || tenant?.name || "Loading…"}
              </span>
              {/* Lease status */}
              {(() => {
                const status = String(tenantLease?.status || "").toLowerCase();
                const cfg = status === "active"
                  ? { cls: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "Active Lease" }
                  : status === "terminated" || status === "cancelled"
                  ? { cls: "border-red-200 bg-red-50 text-red-700", label: status === "terminated" ? "Terminated" : "Cancelled" }
                  : status === "expired"
                  ? { cls: "border-amber-200 bg-amber-50 text-amber-700", label: "Expired" }
                  : status
                  ? { cls: "border-slate-200 bg-slate-50 text-slate-600", label: status.charAt(0).toUpperCase() + status.slice(1) }
                  : null;
                return cfg ? <span className={`shrink-0 border px-2 py-0.5 text-[10px] font-black ${cfg.cls}`}>{cfg.label}</span> : null;
              })()}
              <span className="shrink-0 border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {termUnit} {resolveTenantUnitNumber(tenant)}
              </span>
              <span className="shrink-0 border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {resolveTenantPropertyName(tenant)}
              </span>
              {tenant?.phone && (
                <span className="shrink-0 border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {tenant.phone}
                </span>
              )}
              {(tenantLease?.startDate || tenant?.moveInDate) && (
                <span className="shrink-0 border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                  Since {new Date(tenantLease?.startDate || tenant.moveInDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              )}
              <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200 ml-auto" />
              {/* Always-visible actions */}
              <button onClick={() => navigate(`/receipts/${tenantId}`)} className="h-6 shrink-0 flex items-center gap-1 rounded bg-[#FF8C00] px-2 text-[9px] font-black text-white shadow-sm hover:bg-[#e67e00] active:scale-95 transition-all">
                <FaMoneyBillWave size={9} /> Receipts
              </button>
              <button onClick={handlePrint} className="h-6 shrink-0 flex items-center gap-1 rounded bg-[#0B3B2E] px-2 text-[9px] font-black text-white shadow-sm hover:bg-[#0d4a39] active:scale-95 transition-all">
                <FaPrint size={9} /> Print
              </button>
              <button onClick={handleDownload} className="h-6 shrink-0 flex items-center gap-1 rounded bg-slate-600 px-2 text-[9px] font-black text-white shadow-sm hover:bg-slate-700 active:scale-95 transition-all">
                <FaDownload size={9} /> PDF
              </button>
              <div className="mx-0.5 h-3.5 w-px shrink-0 bg-slate-200" />
              <button
                onClick={handleSendStatementSms}
                disabled={sendingStatementSms || !tenant?.phone}
                title={!tenant?.phone ? "No phone number on record" : "Send statement summary via SMS"}
                className="h-6 shrink-0 flex items-center gap-1 rounded bg-emerald-600 px-2 text-[9px] font-black text-white shadow-sm hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 transition-all"
              >
                <FaSms size={9} /> {sendingStatementSms ? "Sending…" : "SMS"}
              </button>
              <button
                onClick={handleSendStatementEmail}
                disabled={sendingStatementEmail || !tenant?.email}
                title={!tenant?.email ? "No email address on record" : "Email statement to tenant"}
                className="h-6 shrink-0 flex items-center gap-1 rounded bg-blue-600 px-2 text-[9px] font-black text-white shadow-sm hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 transition-all"
              >
                <FaEnvelope size={9} /> {sendingStatementEmail ? "Sending…" : "Email"}
              </button>
            </div>
            {/* ── Tab bar ── */}
            <div className="flex overflow-x-auto bg-slate-50 border-t border-slate-100">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 border-r border-slate-200 px-3 text-[10px] transition-colors ${
                    activeTab === tab.id
                      ? "border-b-[2px] border-b-[#0B3B2E] bg-white text-[#0B3B2E] font-black shadow-sm"
                      : "border-b-[2px] border-b-transparent font-semibold text-slate-400 hover:bg-white hover:text-slate-700"
                  }`}
                >
                  <span className={activeTab === tab.id ? "text-[#0B3B2E]" : "text-slate-400"}>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-hidden">{renderContent()}</div>
        </div>
      </div>

      <style>{`
        @media print {
          @page {
            margin: 0.75in;
            size: A4;
          }

          body {
            background: white !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .fixed {
            display: none !important;
          }

          .pt-36 {
            padding-top: 0 !important;
          }

          .pt-4 {
            padding-top: 0 !important;
          }

          .pb-20 {
            padding-bottom: 0 !important;
          }

          .print-only-header {
            display: block !important;
            page-break-after: avoid;
          }

          button {
            display: none !important;
          }

          input[type="checkbox"] {
            display: none !important;
          }

          .no-print {
            display: none !important;
          }

          .tabs-container {
            display: none !important;
          }

          .tabs-container .flex {
            display: none !important;
          }

          .filter-section {
            display: none !important;
          }

          .tab-content {
            display: none !important;
          }

          .statement-tab {
            display: block !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
            border: 0 !important;
            box-shadow: none !important;
          }

          .statement-tab > .transaction-scroll-area {
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            overflow: visible !important;
          }

          .statement-tab > .transaction-scroll-area table {
            width: 100% !important;
            font-size: 9px !important;
          }

          .statement-tab > .transaction-scroll-area thead tr {
            position: static !important;
            background: #0B3B2E !important;
            color: #fff !important;
          }

          .statement-tab > .transaction-scroll-area th,
          .statement-tab > .transaction-scroll-area td {
            padding: 4px 5px !important;
            border: 1px solid #D1D5DB !important;
          }

          .statement-tab > .transaction-scroll-area + div {
            display: block !important;
            border: 1px solid #E5E7EB !important;
            background: #fff !important;
            padding: 6px 8px !important;
            font-size: 9px !important;
          }

          .bg-gradient-to-br {
            background: white !important;
          }

          .shadow-sm, .shadow-md, .shadow-lg {
            box-shadow: none !important;
          }

          .print-tenant-info {
            background: white !important;
            border: 2px solid #E5E7EB !important;
            padding: 15px !important;
            margin-bottom: 20px !important;
            page-break-after: avoid;
          }

          .print-tenant-info p {
            font-size: 12px !important;
          }

          .transaction-table {
            height: auto !important;
            break-inside: avoid;
          }

          .transaction-table tbody {
            page-break-inside: avoid;
          }

          .transaction-table tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }

          .bg-blue-600, .bg-green-600, .bg-orange-600, .bg-red-600 {
            background-color: white !important;
            border: 1px solid #000 !important;
          }

          .text-gray-600, .text-gray-700 {
            color: #000 !important;
          }

          .bg-white {
            border: 1px solid #E5E7EB !important;
          }

          .bg-blue-50, .bg-orange-50, .bg-green-50 {
            background: white !important;
            border: 2px solid #165946 !important;
          }

          .print-footer {
            display: block !important;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #E5E7EB;
            text-align: center;
            font-size: 11px;
            color: #6B7280;
          }
        }
      `}</style>

      <SingleBookingModal
        isOpen={showInvoiceModal}
        onClose={() => { setShowInvoiceModal(false); setSelectedSchedulePeriod(null); }}
        onSuccess={() => {
          setShowInvoiceModal(false);
          setSelectedSchedulePeriod(null);
          setSelectedSchedules([]);
          setInvoiceRefresh((v) => v + 1);
        }}
        tenants={tenant ? [tenant] : []}
        activeProperties={propertiesFromStore}
        leases={leasesFromStore}
        companyBillingPeriods={companyTaxConfig?.billingPeriods || []}
        companyTaxConfig={normalizedTaxConfig}
        existingInvoices={tenantInvoices}
        lockedTenant={tenant}
        lockedMonth={selectedSchedulePeriod?.month}
        lockedYear={selectedSchedulePeriod?.year}
      />
    </DashboardLayout>
  );
};

export default TenantStatement;
import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaPlus,
  FaSearch,
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
  getRentPayments,
  getTenantInvoices,
  getTenantInvoiceNotes,
} from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";
import { LISTING_UI, normalizeUppercaseInput, toListingCaps } from "../../utils/listingPageUtils";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const ITEMS_PER_PAGE = 50;

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

const Tenants = ({ listingMode = "active" }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Redux state
  const { currentCompany } = useSelector((state) => state.company || {});
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null);
  const { tenants: tenantsData = [] } = useSelector(
    (state) => state.tenant || { tenants: [] }
  );
  const units = useSelector((state) => state.unit?.units || []);
  const properties = useSelector((state) => state.property?.properties || []);
  const { rentPayments = [] } = useSelector((state) => state.rentPayment || {});
  const { leases = [] } = useSelector((state) => state.lease || {});

  const canViewTenants = hasCompanyPermission(currentUser || {}, currentCompany, "tenants", "view", "propertyManagement");
  const canCreateTenant = hasCompanyPermission(currentUser || {}, currentCompany, "tenants", "create", "propertyManagement");
  const canUpdateTenant = hasCompanyPermission(currentUser || {}, currentCompany, "tenants", "update", "propertyManagement");
  const canDeleteTenant = hasCompanyPermission(currentUser || {}, currentCompany, "tenants", "delete", "propertyManagement");

  const isTerminatedView = listingMode === "terminated";
  const tenantStatusQuery = isTerminatedView ? "terminated" : undefined;
  const defaultStatusFilter = isTerminatedView ? "terminated" : "active";

  // ===== UI STATE =====
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
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferForm, setTransferForm] = useState({ tenantId: "", newUnit: "", effectiveDate: "", reason: "" });
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [isTerminating, setIsTerminating] = useState(false);
  const [terminationForm, setTerminationForm] = useState({ tenantId: "", effectiveDate: "", reason: "" });
  const [invoiceRefreshTick, setInvoiceRefreshTick] = useState(0);
  const [paymentsSnapshotReady, setPaymentsSnapshotReady] = useState(false);

  // Backend invoice cache
  const [tenantInvoices, setTenantInvoices] = useState([]);
  const [tenantInvoiceNotes, setTenantInvoiceNotes] = useState([]);

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
  useEffect(() => {
    if (currentCompany?._id) {
      dispatch(getTenants({ business: currentCompany._id, ...(tenantStatusQuery ? { status: tenantStatusQuery } : {}) }));
      dispatch(getUnits({ business: currentCompany._id }));
      dispatch(getProperties({ business: currentCompany._id }));
      getLeases(dispatch, currentCompany._id).catch((error) => {
        console.error("Failed to load leases:", error);
      });
    }
  }, [dispatch, currentCompany, tenantStatusQuery]);

  useEffect(() => {
    setSelectAll(false);
  }, [currentPage]);

  useEffect(() => {
    const handleInvoiceChange = () => {
      setInvoiceRefreshTick((prev) => prev + 1);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleInvoiceChange();
      }
    };

    window.addEventListener("invoicesUpdated", handleInvoiceChange);
    window.addEventListener("storage", handleInvoiceChange);
    window.addEventListener("focus", handleInvoiceChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("invoicesUpdated", handleInvoiceChange);
      window.removeEventListener("storage", handleInvoiceChange);
      window.removeEventListener("focus", handleInvoiceChange);
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

  const loadInvoices = useCallback(async () => {
    if (!currentCompany?._id) return;

    setPaymentsSnapshotReady(false);
    try {
      const [rows, notes] = await Promise.all([
        getTenantInvoices({ business: currentCompany._id }),
        getTenantInvoiceNotes({ business: currentCompany._id }),
        getRentPayments(dispatch, currentCompany._id),
      ]);
      setTenantInvoices(Array.isArray(rows) ? rows : []);
      setTenantInvoiceNotes(Array.isArray(notes) ? notes : []);
      setPaymentsSnapshotReady(true);
    } catch (error) {
      console.error("Failed to load tenant invoices:", error);
      setTenantInvoices([]);
      setTenantInvoiceNotes([]);
      setPaymentsSnapshotReady(false);
    }
  }, [currentCompany?._id, dispatch]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices, invoiceRefreshTick]);

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


  const leaseByTenantId = useMemo(() => {
    const map = new Map();

    (Array.isArray(leases) ? leases : []).forEach((lease) => {
      const tenantId = normalizeId(lease?.tenant?._id || lease?.tenant);
      if (!tenantId) return;

      const current = map.get(tenantId);
      if (!current) {
        map.set(tenantId, lease);
        return;
      }

      const currentStatusScore = String(current?.status || "").toLowerCase() === "active" ? 1 : 0;
      const nextStatusScore = String(lease?.status || "").toLowerCase() === "active" ? 1 : 0;
      if (nextStatusScore > currentStatusScore) {
        map.set(tenantId, lease);
        return;
      }

      const currentEnd = new Date(current?.endDate || 0).getTime();
      const nextEnd = new Date(lease?.endDate || 0).getTime();
      if (nextEnd > currentEnd) {
        map.set(tenantId, lease);
      }
    });

    return map;
  }, [leases]);

  const calculateTenantBalance = useCallback(
    (tenantId) => {
      const tenantIdStr = String(tenantId);

      const confirmedReceiptTotal = rentPayments
        .filter((payment) => {
          const paymentTenantId = normalizeId(payment?.tenant);
          return (
            paymentTenantId === tenantIdStr &&
            String(payment?.ledgerType || "").toLowerCase() === "receipts" &&
            payment?.isConfirmed === true &&
            payment?.isCancelled !== true &&
            payment?.isReversed !== true &&
            !payment?.reversalOf &&
            String(payment?.postingStatus || "").toLowerCase() !== "reversed" &&
            ["rent", "utility", "deposit", "late_fee", "other"].includes(
              String(payment?.paymentType || "").toLowerCase()
            )
          );
        })
        .reduce((sum, payment) => sum + Math.abs(Number(payment?.amount || 0)), 0);

      const activeInvoiceTotal = tenantInvoices
        .filter((invoice) => {
          const invoiceTenantId = normalizeId(invoice?.tenant);
          return invoiceTenantId === tenantIdStr && isActiveInvoice(invoice);
        })
        .reduce(
          (sum, invoice) =>
            sum + Number((invoice?.netAmount ?? invoice?.adjustedAmount ?? invoice?.amount) || 0),
          0
        );

      const activeNoteEffect = tenantInvoiceNotes
        .filter((note) => {
          const noteTenantId = normalizeId(note?.tenant);
          const status = String(note?.status || "").toLowerCase();
          return noteTenantId === tenantIdStr && !["cancelled", "reversed"].includes(status);
        })
        .reduce((sum, note) => {
          const amount = Math.abs(Number(note?.amount || 0));
          const noteType = String(note?.noteType || note?.documentType || "").toUpperCase();
          if (noteType === "CREDIT_NOTE") return sum - amount;
          if (noteType === "DEBIT_NOTE") return sum + amount;
          return sum;
        }, 0);

      const effectiveInvoiceTotal = tenantInvoices.some((invoice) => Number((invoice?.adjustedAmount ?? invoice?.netAmount ?? invoice?.amount) || 0) !== Number(invoice?.amount || 0))
        ? activeInvoiceTotal
        : activeInvoiceTotal + activeNoteEffect;

      return effectiveInvoiceTotal - confirmedReceiptTotal;
    },
    [rentPayments, tenantInvoices, tenantInvoiceNotes]
  );

  const transformedTenants = useMemo(() => {
    return (Array.isArray(tenantsData) ? tenantsData : []).map((tenant) => {
      const tenantId = normalizeId(tenant._id);
      const tenantLease = leaseByTenantId.get(tenantId) || null;
      const resolvedStartDate = tenantLease?.startDate || tenant.moveInDate;
      const resolvedEndDate = tenantLease?.endDate || tenant.moveOutDate;
      const expiryWarning = buildExpiryWarning({ tenant, lease: tenantLease });
      const balance = paymentsSnapshotReady ? calculateTenantBalance(tenant._id) : Number(tenant?.balance || 0);
      const tenantOperationalStatus = computeOperationalStatus({ tenant });
      const leaseCount = (Array.isArray(leases) ? leases : []).filter(
        (lease) => normalizeId(lease?.tenant?._id || lease?.tenant) === tenantId
      ).length;
      const invoiceCount = tenantInvoices.filter((invoice) => normalizeId(invoice?.tenant) === tenantId).length;
      const invoiceNoteCount = tenantInvoiceNotes.filter((note) => normalizeId(note?.tenant) === tenantId).length;
      const paymentCount = rentPayments.filter((payment) => normalizeId(payment?.tenant) === tenantId).length;
      const hasBalance = Math.abs(Number(balance || 0)) > 0.009;
      const canTerminate = tenantOperationalStatus === "active";
      const canTransfer = tenantOperationalStatus === "active";
      const canDelete = !canTerminate && !hasBalance && leaseCount === 0 && invoiceCount === 0 && invoiceNoteCount === 0 && paymentCount === 0;
      const deleteBlockedReason = canTerminate
        ? "This tenant is still active. Terminate the tenancy instead of deleting it."
        : hasBalance
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
        depositHeld: Number(tenant.depositAmount || 0),
        depositHeldBy: tenant.depositHeldBy || tenant.unit?.property?.depositHeldBy || "Management Company",
        settlementStatus:
          Number(balance || 0) > 0.009
            ? "OWES_BALANCE"
            : Number(balance || 0) < -0.009
            ? "REFUND_DUE"
            : Number(tenant.depositAmount || 0) > 0 && String(tenant.depositRefundStatus || "").toLowerCase() === "pending"
            ? "PENDING_SETTLEMENT"
            : "SETTLED",
        phone: tenant.phone || "-",
        email: tenant.email || "-",
        expiryWarning,
        canDelete,
        canTerminate,
        canTransfer,
        deleteBlockedReason,
      };
    });
  }, [tenantsData, units, properties, leaseByTenantId, calculateTenantBalance, paymentsSnapshotReady, leases, tenantInvoices, tenantInvoiceNotes, rentPayments]);

  // ===== FILTER TENANTS =====
  const filteredTenants = useMemo(() => {
    return transformedTenants.filter((t) => {
      if (isTerminatedView) {
        if (t.status !== "terminated") return false;
      } else if (t.status === "terminated") {
        return false;
      }

      if (
        appliedFilters.property !== "any" &&
        t.propertyName !== appliedFilters.property
      ) {
        return false;
      }

      if (
        appliedFilters.status !== "any" &&
        t.status !== appliedFilters.status
      ) {
        return false;
      }

      if (appliedFilters.balanceScope === "with_balance" && !t.hasBalance) {
        return false;
      }

      if (appliedFilters.search) {
        const searchLower = appliedFilters.search.toLowerCase();
        const matchesName = t.tenantName.toLowerCase().includes(searchLower);
        const matchesPhone = t.phone.toLowerCase().includes(searchLower);
        if (!matchesName && !matchesPhone) return false;
      }

      if (appliedFilters.tenantName) {
        const nameLower = appliedFilters.tenantName.toLowerCase();
        if (!t.tenantName.toLowerCase().includes(nameLower)) return false;
      }

      if (appliedFilters.tenantCode) {
        const codeLower = appliedFilters.tenantCode.toLowerCase();
        if (!t.tenantCode.toLowerCase().includes(codeLower)) return false;
      }

      return true;
    });
  }, [transformedTenants, appliedFilters, isTerminatedView]);

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
  const totalPages = Math.max(1, Math.ceil(sortedFilteredTenants.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentTenants = sortedFilteredTenants.slice(startIndex, endIndex);

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
    await Promise.all([
      dispatch(getTenants({ business: currentCompany._id, ...(tenantStatusQuery ? { status: tenantStatusQuery } : {}) })),
      loadInvoices(),
    ]);
  }, [currentCompany?._id, dispatch, tenantStatusQuery, loadInvoices]);

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
      const [creditableInvoices, chartAccounts] = await Promise.all([
        getCreditableTenantInvoices({ business: currentCompany?._id, tenantId }),
        getChartOfAccounts({ business: currentCompany?._id }),
      ]);
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
      toast.warning("Please select one tenant to add a utility for");
      return;
    }
    if (selectedTenants.length > 1) {
      toast.warning("Please select only one tenant to add a utility for");
      return;
    }

    const selectedTenant = transformedTenants.find((tenant) => tenant.id === selectedTenants[0]);
    const firstName = (selectedTenant?.tenantName || "Tenant").split(" ")[0];

    navigate(`/tenant/${selectedTenants[0]}/edit`, {
      state: {
        tabTitle: `${firstName}-Utilities`,
        focusSection: "additional-utilities",
        autoAddUtility: true,
      },
    });
    setActionMenuOpen(false);
  };


const handleTransferUnit = () => {
  if (!canUpdateTenant) {
    toast.warning("You do not have permission to transfer tenant units");
    return;
  }
  if (selectedTenants.length === 0) {
    toast.warning("Please select one tenant to transfer");
    return;
  }
  if (selectedTenants.length > 1) {
    toast.warning("Please select only one tenant to transfer");
    return;
  }
  if (!selectedPrimaryTenant?.canTransfer) {
    toast.warning("Only active tenants can be transferred to another unit.");
    return;
  }

  setTransferForm({
    tenantId: selectedTenants[0],
    newUnit: "",
    effectiveDate: new Date().toISOString().slice(0, 10),
    reason: "",
  });
  setShowTransferModal(true);
  setActionMenuOpen(false);
};

const confirmTransferUnit = async () => {
  if (!canUpdateTenant) {
    toast.warning("You do not have permission to transfer tenant units");
    return;
  }
  if (!transferForm.tenantId || !transferForm.newUnit) {
    toast.error("Choose the destination unit before transferring");
    return;
  }

  setIsTransferring(true);
  try {
    await adminRequests.post(`/tenants/${transferForm.tenantId}/transfer-unit`, {
      business: currentCompany?._id,
      newUnit: transferForm.newUnit,
      effectiveDate: transferForm.effectiveDate,
      reason: transferForm.reason,
    });
    toast.success("Tenant unit transferred successfully");
    setShowTransferModal(false);
    await dispatch(getTenants({ business: currentCompany._id, ...(tenantStatusQuery ? { status: tenantStatusQuery } : {}) }));
    await dispatch(getUnits({ business: currentCompany._id }));
    await loadInvoices();
  } catch (error) {
    toast.error(error?.response?.data?.message || error?.response?.data?.error || error?.message || "Failed to transfer tenant unit");
  } finally {
    setIsTransferring(false);
  }
};

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

      await dispatch(getTenants({ business: currentCompany._id, ...(tenantStatusQuery ? { status: tenantStatusQuery } : {}) }));
      await dispatch(getUnits({ business: currentCompany._id }));
      await loadInvoices();
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
      toast.info(`${skippedCount} tenant(s) were skipped because they are still protected by active occupancy, balances, or history.`);
    }
    if (failCount > 0) {
      toast.error(`Failed to delete ${failCount} tenant(s)`);
    }

    if (currentCompany?._id) {
      dispatch(getTenants({ business: currentCompany._id, ...(tenantStatusQuery ? { status: tenantStatusQuery } : {}) }));
      loadInvoices();
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
      });

      await dispatch(getTenants({ business: currentCompany._id, ...(tenantStatusQuery ? { status: tenantStatusQuery } : {}) }));
      await loadInvoices();

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
      <div className="flex flex-col h-full min-h-0 p-0 pb-10 bg-gray-50 overflow-hidden">
        {/* ===== FILTER BAR ===== */}
        <div className="flex-shrink-0 sticky top-0 z-30 bg-white border-b border-gray-200 px-2 pt-1">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <div>
              <select
                value={draftFilters.property}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, property: e.target.value })
                }
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-[#addbb2] text-gray-800 hover:bg-white transition-colors"
              >
                {uniqueProperties.map((prop) => (
                  <option key={prop} value={prop}>
                    {prop === "any" ? "All Properties" : prop}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={draftFilters.status}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, status: e.target.value })
                }
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-[#addbb2] text-gray-800 hover:bg-white transition-colors"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status === "any"
                      ? "All Status"
                      : status.charAt(0).toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={draftFilters.balanceScope}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, balanceScope: e.target.value })
                }
                className="px-3 py-1 text-xs border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-[#addbb2] text-gray-800 hover:bg-white transition-colors"
              >
                {balanceScopeOptions.map((scope) => (
                  <option key={scope} value={scope}>
                    {scope === "with_balance" ? "With Balance Only" : "All Balances"}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <input
                type="text"
                placeholder="Tenant Name"
                value={draftFilters.tenantName}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, tenantName: normalizeUppercaseInput(e.target.value) })
                }
                className={LISTING_UI.filterInputTinted}
              />
            </div>

            <div>
              <input
                type="text"
                placeholder="Tenant Code (TT####)"
                value={draftFilters.tenantCode}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, tenantCode: normalizeUppercaseInput(e.target.value) })
                }
                className={LISTING_UI.filterInputTinted}
              />
            </div>

            <div className="relative flex-1 min-w-[200px]">
              <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 text-xs" />
              <input
                type="text"
                placeholder={isTerminatedView ? "Search terminated tenants..." : "Search tenants..."}
                value={draftFilters.search}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, search: normalizeUppercaseInput(e.target.value) })
                }
                className="w-full pl-9 pr-3 py-1 text-xs border border-gray-300 rounded bg-white shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* ===== COMPACT ACTION BAR ===== */}
        <div className="flex-shrink-0 bg-gray-50 border-b border-gray-200 px-2 py-2 flex items-center justify-start">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={expandAllTenants}
              className="p-1.5 hover:bg-gray-200 rounded transition-colors text-gray-700 text-sm"
              title="Expand all"
            >
              <FaExpandAlt />
            </button>
            <button
              onClick={collapseAllTenants}
              className="p-1.5 hover:bg-gray-200 rounded transition-colors text-gray-700 text-sm"
              title="Collapse all"
            >
              <FaCompressAlt />
            </button>
            <span className="text-xs font-bold text-gray-700">
              {selectedTenants.length} selected
            </span>

            <button
              onClick={handleEditTenant}
              className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium flex items-center gap-1 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title={canUpdateTenant ? "Edit Selected Tenant" : "You do not have permission to edit tenants"}
              disabled={!canUpdateTenant || selectedTenants.length !== 1}
            >
              <FaEdit size={10} />
              <span>Edit</span>
            </button>

            <div className="relative" ref={actionMenuRef}>
              <button
                onClick={() => setActionMenuOpen(!actionMenuOpen)}
                className={`${MILIK_GREEN} hover:bg-[#0A3127] text-white px-3 py-1 rounded text-xs font-medium flex items-center gap-1 shadow-sm`}
                title="More Actions"
              >
                <FaEllipsisV size={10} />
                <span>Actions</span>
              </button>

              {actionMenuOpen && (
                <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                  <div className="py-1">
                    <button
                      onClick={handleViewStatement}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700"
                    >
                      <FaFileInvoiceDollar size={12} />
                      <span>View Tenant Statement</span>
                    </button>
                    {canUpdateTenant && (
                    <button
                      onClick={handleEditTenant}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700"
                    >
                      <FaUserEdit size={12} />
                      <span>Edit Tenant Details</span>
                    </button>
                    )}
                    {canUpdateTenant && (
                    <button
                      onClick={handleTransferUnit}
                      disabled={isTerminatedView || selectedTenants.length !== 1 || !selectedPrimaryTenant?.canTransfer}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${selectedTenants.length === 1 && selectedPrimaryTenant?.canTransfer ? "hover:bg-gray-100 text-gray-700" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}
                      title={!isTerminatedView && selectedTenants.length === 1 && selectedPrimaryTenant?.canTransfer ? "Transfer selected tenant unit" : isTerminatedView ? "Transfers are disabled on terminated tenants" : "Only one active tenant can be transferred at a time"}
                    >
                      <FaExchangeAlt size={12} />
                      <span>Transfer Tenant Unit</span>
                    </button>
                    )}
                    <button
                      onClick={handleViewReceipts}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700"
                    >
                      <FaMoneyBillWave size={12} />
                      <span>View Tenant Receipts</span>
                    </button>
                    <button
                      onClick={handleOpenAgreement}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700"
                    >
                      <FaFileInvoiceDollar size={12} />
                      <span>Open Tenant Agreement</span>
                    </button>
                    {canUpdateTenant && (
                    <button
                      onClick={handleAddUtility}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700"
                    >
                      <FaBolt size={12} />
                      <span>Add Utility to Selected Tenant</span>
                    </button>
                    )}
                    {canUpdateTenant && (
                    <button
                      onClick={handleReviewRent}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 text-gray-700 border-t border-gray-200"
                    >
                      <FaChartLine size={12} />
                      <span>Review Rent for Selected Tenant</span>
                    </button>
                    )}
                    {canUpdateTenant && (
                    <button
                      onClick={handleOpenTerminateTenant}
                      disabled={isTerminatedView || selectedTenants.length !== 1 || !selectedPrimaryTenant?.canTerminate}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 border-t border-gray-200 ${selectedTenants.length === 1 && selectedPrimaryTenant?.canTerminate ? "hover:bg-amber-50 text-amber-700" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}
                      title={!isTerminatedView && selectedTenants.length === 1 && selectedPrimaryTenant?.canTerminate ? "Terminate selected tenant" : isTerminatedView ? "Tenant is already terminated" : "Only one active tenant can be terminated at a time"}
                    >
                      <FaUserSlash size={12} />
                      <span>Terminate Tenant</span>
                    </button>
                    )}
                    <button
                      onClick={() => {
                        setActionMenuOpen(false);
                        setShowCommunicationModal(true);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-orange-50 flex items-center gap-2 text-orange-700 border-t border-gray-200"
                    >
                      <FaSms size={12} />
                      <span>SMS Tenants</span>
                    </button>
                    {canDeleteTenant && (
                    <button
                      onClick={handleDeleteSelectedTenants}
                      disabled={selectedDeletableTenants.length === 0}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 border-t border-gray-200 font-semibold ${selectedDeletableTenants.length > 0 ? "hover:bg-red-50 text-red-600" : "cursor-not-allowed bg-gray-50 text-gray-400"}`}
                      title={selectedDeletableTenants.length > 0 ? "Delete selected unused tenant records" : "Selected tenants are protected because they are active or already have history"}
                    >
                      <FaTrash size={12} />
                      <span>Delete Selected Tenant(s)</span>
                    </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => isTerminatedView ? navigate("/invoices/new") : navigate("/tenant/new")}
              disabled={!isTerminatedView && !canCreateTenant}
              title={isTerminatedView ? "Open single invoice booking for final billing" : canCreateTenant ? "Add tenant" : "You do not have permission to create tenants"}
              className={`px-3 py-1 text-xs ${canCreateTenant ? `${MILIK_ORANGE} text-white hover:bg-[#e67e00]` : "bg-gray-400 text-white cursor-not-allowed"} rounded font-medium flex items-center gap-1 transition-colors shadow-sm`}
            >
              <FaPlus className="text-xs" />
              <span>{isTerminatedView ? "Final Billing" : "Add"}</span>
            </button>

            <button
              onClick={() => setAppliedFilters(draftFilters)}
              className={`px-3 py-1 text-xs ${MILIK_GREEN} text-white rounded font-medium flex items-center gap-1 hover:bg-[#0A3127] transition-colors shadow-sm`}
            >
              <FaSearch className="text-xs" />
              <span>Search</span>
            </button>

            <button
              onClick={handleResetFilters}
              className="px-3 py-1 text-xs bg-gray-500 text-white rounded font-medium flex items-center gap-1 hover:bg-gray-600 transition-colors shadow-sm"
            >
              <FaRedoAlt className="text-xs" />
              <span>Reset</span>
            </button>

            <button
              onClick={handleDownloadTemplate}
              className="px-3 py-1 text-xs bg-blue-500 text-white rounded font-medium flex items-center gap-1 hover:bg-blue-600 transition-colors shadow-sm"
              title="Download import template"
            >
              <FaDownload className="text-xs" />
              <span>Template</span>
            </button>

            <button
              onClick={() => setShowImportModal(true)}
              disabled={isTerminatedView || !canCreateTenant}
              className={`px-3 py-1 text-xs ${canCreateTenant ? `${MILIK_ORANGE} text-white hover:bg-[#e67e00]` : "bg-gray-400 text-white cursor-not-allowed"} rounded font-medium flex items-center gap-1 transition-colors shadow-sm`}
              title={isTerminatedView ? "Import is disabled on the terminated tenants page" : canCreateTenant ? "Import tenants from Excel" : "You do not have permission to create tenants"}
            >
              <FaFileExport className="text-xs rotate-180" />
              <span>Import</span>
            </button>

            <button
              onClick={handlePrintList}
              className="px-3 py-1 text-xs bg-slate-700 text-white rounded font-medium flex items-center gap-1 hover:bg-slate-800 transition-colors shadow-sm"
              title="Print tenants list"
            >
              <FaPrint className="text-xs" />
              <span>Print List</span>
            </button>

            <button
              onClick={handleExportToExcel}
              className="px-3 py-1 text-xs bg-gray-600 text-white rounded font-medium flex items-center gap-1 hover:bg-gray-700 transition-colors shadow-sm"
              title="Export tenants to Excel"
            >
              <FaFileExport className="text-xs" />
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* ===== TENANTS TABLE ===== */}
        <div className="flex-1 min-h-0 overflow-auto px-2 py-1">
          <table className="w-full border-collapse">
            <thead>
              <tr className={`${MILIK_GREEN} text-white text-xs`}>
                <th className="px-2 py-1.5 text-center font-bold border-r border-gray-400 w-6">
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={handleSelectAll}
                    onClick={handleCheckboxClick}
                    className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                  />
                </th>
                <th className="px-2 py-1.5 text-center font-bold border-r border-gray-400 w-6">
                  ⬇️
                </th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[80px]">
                  Code
                </th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[150px]">
                  Tenant Name
                </th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[120px]">
                  Property
                </th>
                <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[80px]">
                  Unit
                </th>
                {isTerminatedView ? (
                  <>
                    <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[120px]">
                      Termination Date
                    </th>
                    <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[120px]">
                      Move-out Date
                    </th>
                    <th className="px-2 py-1.5 text-right font-bold border-r border-gray-400 min-w-[110px]">
                      Final Balance
                    </th>
                    <th className="px-2 py-1.5 text-right font-bold border-r border-gray-400 min-w-[110px]">
                      Deposit Held
                    </th>
                    <th className="px-2 py-1.5 text-center font-bold border-r border-gray-400 min-w-[120px]">
                      Settlement Status
                    </th>
                    <th className="px-2 py-1.5 text-left font-bold min-w-[140px]">
                      Deposit Holder
                    </th>
                  </>
                ) : (
                  <>
                    <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[120px]">
                      Lease Start Date
                    </th>
                    <th className="px-2 py-1.5 text-left font-bold border-r border-gray-400 min-w-[120px]">
                      Lease End Date
                    </th>
                    <th className="px-2 py-1.5 text-right font-bold border-r border-gray-400 min-w-[100px]">
                      Rent
                    </th>
                    <th className="px-2 py-1.5 text-right font-bold border-r border-gray-400 min-w-[110px]">
                      Balance
                    </th>
                    <th className="px-2 py-1.5 text-center font-bold border-r border-gray-400 min-w-[80px]">
                      Status
                    </th>
                    <th className="px-2 py-1.5 text-left font-bold min-w-[100px]">
                      Phone
                    </th>
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
                        <tr className="bg-transparent">
                          <td colSpan={12} className="px-2 pt-1.5 pb-1">
                            <h3 className="text-sm font-extrabold text-black tracking-normal uppercase">
                              {toListingCaps(tenant.propertyName)}
                            </h3>
                            <div className="mt-1 h-[2px] w-full bg-[#FF8C00]" />
                          </td>
                        </tr>
                      )}

                      <tr
                        className={`border-b cursor-pointer transition-colors text-xs ${
                          tenant.expiryWarning?.hasWarning ? "border-red-200" : "border-gray-200"
                        } ${
                          selectedTenants.includes(tenant.id)
                            ? "bg-orange-50 hover:bg-orange-100"
                            : tenant.expiryWarning?.hasWarning
                            ? "bg-red-50/70 hover:bg-red-100/80"
                            : "bg-white hover:bg-gray-50"
                        }`}
                        onClick={() => handleSelectTenant(tenant.id)}
                      >
                        <td
                          className="px-2 py-1 text-center border-r border-gray-200"
                          onClick={handleCheckboxClick}
                        >
                          <input
                            type="checkbox"
                            checked={selectedTenants.includes(tenant.id)}
                            onChange={() => handleSelectTenant(tenant.id)}
                            onClick={handleCheckboxClick}
                            className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                          />
                        </td>
                        <td
                          className="px-2 py-1 text-center border-r border-gray-200 cursor-pointer"
                          onClick={() => toggleTenantExpand(tenant.id)}
                        >
                          <span>
                            {expandedTenants.includes(tenant.id) ? "▼" : "▶"}
                          </span>
                        </td>
                        <td className="px-2 py-1 font-mono text-gray-600 border-r border-gray-200 text-xs">
                          {toListingCaps(tenant.tenantCode)}
                        </td>
                        <td className="px-2 py-1 border-r border-gray-200">
                          <div className="font-bold text-gray-900">{toListingCaps(tenant.tenantName)}</div>
                          {tenant.expiryWarning?.hasWarning && (
                            <div className="mt-0.5 text-[10px] font-semibold text-red-700">
                              {tenant.expiryWarning.summary}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1 font-bold text-gray-900 border-r border-gray-200">
                          {toListingCaps(tenant.propertyName)}
                        </td>
                        <td className="px-2 py-1 font-bold text-gray-900 border-r border-gray-200">
                          {toListingCaps(tenant.unitNumber)}
                        </td>
                        {isTerminatedView ? (
                          <>
                            <td className="px-2 py-1 font-bold text-gray-900 border-r border-gray-200">
                              {tenant.terminationDate}
                            </td>
                            <td className="px-2 py-1 font-bold text-gray-900 border-r border-gray-200">
                              {tenant.moveOutDate}
                            </td>
                            <td className="px-2 py-1 font-bold text-right border-r border-gray-200">
                              <span
                                className={`${
                                  tenant.balance > 0
                                    ? "text-red-600"
                                    : tenant.balance < 0
                                    ? "text-green-600"
                                    : "text-gray-600"
                                }`}
                              >
                                Ksh {tenant.balance.toLocaleString()}
                              </span>
                            </td>
                            <td className="px-2 py-1 font-bold text-right text-gray-900 border-r border-gray-200">
                              Ksh {tenant.depositHeld.toLocaleString()}
                            </td>
                            <td className="px-2 py-1 text-center border-r border-gray-200">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                                tenant.settlementStatus === "SETTLED"
                                  ? "bg-green-100 text-green-800"
                                  : tenant.settlementStatus === "REFUND_DUE"
                                  ? "bg-blue-100 text-blue-800"
                                  : tenant.settlementStatus === "OWES_BALANCE"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-800"
                              }`}>
                                {tenant.settlementStatus.replace(/_/g, " ")}
                              </span>
                            </td>
                            <td className="px-2 py-1 font-bold text-gray-900">
                              {tenant.depositHeldBy}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-2 py-1 font-bold text-gray-900 border-r border-gray-200">
                              {tenant.startDate}
                            </td>
                            <td className={`px-2 py-1 font-bold border-r border-gray-200 ${
                              tenant.expiryWarning?.hasWarning ? "text-red-700" : "text-gray-900"
                            }`}>
                              {tenant.endDate}
                            </td>
                            <td className="px-2 py-1 font-bold text-gray-900 text-right border-r border-gray-200">
                              {tenant.rent}
                            </td>
                            <td className="px-2 py-1 font-bold text-right border-r border-gray-200">
                              <span
                                className={`${
                                  tenant.balance > 0
                                    ? "text-red-600"
                                    : tenant.balance < 0
                                    ? "text-green-600"
                                    : "text-gray-600"
                                }`}
                              >
                                Ksh {tenant.balance.toLocaleString()}
                              </span>
                            </td>
                            <td className="px-2 py-1 text-center border-r border-gray-200">
                              <div className="flex flex-col items-center gap-1">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                                    tenant.status === "active"
                                      ? "bg-green-100 text-green-800"
                                      : tenant.status === "terminated"
                                      ? "bg-red-100 text-red-700"
                                      : "bg-gray-100 text-gray-800"
                                  }`}
                                >
                                  {tenant.status}
                                </span>
                                {tenant.expiryWarning?.hasWarning && (
                                  <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                                    Expiring Soon
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-1 font-bold text-gray-900">
                              {tenant.phone}
                            </td>
                          </>
                        )}
                      </tr>

                      {expandedTenants.includes(tenant.id) && (
                        <tr className="bg-gray-100 border-b border-gray-200">
                          <td colSpan="12" className="px-3 py-1.5">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                              <div>
                                <h4 className="font-bold text-gray-900 mb-2 text-xs border-b-2 border-orange-500 pb-1">
                                  👤 Tenant Details
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
                                <h4 className="font-bold text-gray-900 mb-2 text-xs border-b-2 border-green-500 pb-1">
                                  💰 Billing Info
                                </h4>
                                <div className="space-y-1 text-xs">
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Monthly Rent:</span>
                                    <p className="text-gray-600 font-bold">{tenant.rent}</p>
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-700 block text-xs">Balance:</span>
                                    <p
                                      className={`font-bold ${
                                        tenant.balance > 0
                                          ? "text-red-600"
                                          : tenant.balance < 0
                                          ? "text-green-600"
                                          : "text-gray-600"
                                      }`}
                                    >
                                      Ksh {tenant.balance.toLocaleString()}
                                    </p>
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
                                <h4 className="font-bold text-gray-900 mb-2 text-xs border-b-2 border-blue-500 pb-1">
                                  📋 Lease Details
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
                                <h4 className="font-bold text-gray-900 mb-2 text-xs border-b-2 border-purple-500 pb-1">
                                  ⚙️ Actions
                                </h4>
                                <div className="flex flex-col gap-1">
                                  <button
                                    onClick={() => {
                                      const firstName = (tenant.tenantName || "Tenant").split(" ")[0];
                                      const tabTitle = `${firstName}-${tenant.tenantCode || "TT0000"}`;
                                      navigate(`/tenant/${tenant.id}/statement`, { state: { tabTitle } });
                                    }}
                                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-xs transition-colors"
                                  >
                                    💳 View Statement
                                  </button>
                                  {isTerminatedView && (
                                    <>
                                      <button
                                        onClick={() => navigate(`/invoices/rental/${tenant.id}`, { state: { openSingleBooking: true } })}
                                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-xs transition-colors"
                                      >
                                        🧾 Final Billing
                                      </button>
                                      <button
                                        onClick={() => openDepositSettlementModal(tenant.id)}
                                        className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded text-xs transition-colors"
                                      >
                                        💰 Deposit Settlement
                                      </button>
                                      <button
                                        onClick={() => navigate(`/inspections`)}
                                        className="px-2 py-1 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded text-xs transition-colors"
                                      >
                                        🧪 Move-out Inspection
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
                  <td colSpan="12" className="px-3 py-4 text-center text-gray-600 font-semibold text-xs">
                    {isTerminatedView ? "No terminated tenants found. Try adjusting filters." : "No tenants found. Try adjusting filters or create a new tenant."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ===== COMPACT PAGINATION FOOTER ===== */}
        <div className="flex-shrink-0 sticky bottom-0 z-20 bg-white border-t border-gray-200 px-2 py-2 flex items-center justify-between">
          <div className="text-xs font-bold text-gray-600">
            Showing {currentTenants.length > 0 ? startIndex + 1 : 0} to{" "}
            {Math.min(endIndex, sortedFilteredTenants.length)} of {sortedFilteredTenants.length}{" "}
            {isTerminatedView ? "terminated tenants" : "tenants"}
          </div>

          <div className="flex items-center gap-1">
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
  const selectedTenantRecord = (Array.isArray(tenantsData) ? tenantsData : []).find((tenant) => tenant._id === transferForm.tenantId) || null;
  const occupiedUnitIds = new Set([
    normalizeId(selectedTenantRecord?.unit?._id || selectedTenantRecord?.unit),
    ...((Array.isArray(selectedTenantRecord?.additionalUnits) ? selectedTenantRecord.additionalUnits : []).map((unit) => normalizeId(unit?._id || unit))),
  ].filter(Boolean));
  const availableTransferUnits = (Array.isArray(units) ? units : []).filter((unit) => {
    const status = String(unit?.status || "").toLowerCase();
    const unitId = normalizeId(unit?._id);
    if (!unitId || occupiedUnitIds.has(unitId)) return false;
    return status === "vacant" && unit?.isVacant !== false;
  });

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="text-lg font-black text-slate-900">Transfer Tenant Unit</div>
          <div className="mt-1 text-sm text-slate-500">Move the tenant to a new primary unit while preserving tenant history and invoice records.</div>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700">Destination Unit</label>
            <select
              value={transferForm.newUnit}
              onChange={(e) => setTransferForm((prev) => ({ ...prev, newUnit: e.target.value }))}
              className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
            >
              <option value="">Select vacant unit</option>
              {availableTransferUnits.map((unit) => (
                <option key={unit._id} value={unit._id}>
                  {unit.unitNumber} - {(unit.property?.propertyName || unit.propertyName || "Property")}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold text-slate-700">Effective Date</label>
              <input
                type="date"
                value={transferForm.effectiveDate}
                onChange={(e) => setTransferForm((prev) => ({ ...prev, effectiveDate: e.target.value }))}
                className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700">Reason</label>
              <input
                type="text"
                value={transferForm.reason}
                onChange={(e) => setTransferForm((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="Upgrade, relocation, merger of spaces..."
                className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button onClick={() => setShowTransferModal(false)} className="rounded-2xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700">Cancel</button>
          <button onClick={confirmTransferUnit} disabled={isTransferring} className="rounded-2xl bg-[#0B3B2E] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">{isTransferring ? "Transferring..." : "Transfer Unit"}</button>
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
      {showDepositSettlementModal && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-[#0B3B2E] px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-white/80">Deposit Settlement</p>
                  <h3 className="mt-1 text-xl font-black text-white">Terminate Tenant Settlement Workspace</h3>
                  <p className="mt-1 text-sm text-white/90">Apply deposit, refund the balance, or retain charges without leaving the terminated tenants page.</p>
                </div>
                <button
                  onClick={closeDepositSettlementModal}
                  disabled={isProcessingDepositSettlement}
                  className="rounded-2xl border border-white/30 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-4 xl:grid-cols-[1.3fr,0.95fr]">
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Tenant</p>
                      <p className="mt-2 text-sm font-black text-slate-900">{depositSettlementTenant?.tenantName || "-"}</p>
                      <p className="mt-1 text-xs text-slate-600">{depositSettlementTenant?.tenantCode || "-"}</p>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Property / Unit</p>
                      <p className="mt-2 text-sm font-black text-slate-900">{depositSettlementTenant?.propertyName || "-"}</p>
                      <p className="mt-1 text-xs text-slate-600">{depositSettlementTenant?.unitNumber || "-"}</p>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Termination Date</p>
                      <p className="mt-2 text-sm font-black text-slate-900">{depositSettlementTenant?.terminationDate || "-"}</p>
                      <p className="mt-1 text-xs text-slate-600">Move-out {depositSettlementTenant?.moveOutDate || "-"}</p>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Deposit Holder</p>
                      <p className="mt-2 text-sm font-black text-slate-900">{depositSettlementDerived.depositHolder}</p>
                      <p className="mt-1 text-xs text-slate-600">Refund {depositSettlementDerived.canRefund ? "allowed" : "blocked"}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-700">Deposit Held</p>
                      <p className="mt-2 text-2xl font-black text-amber-950">Ksh {depositSettlementDerived.depositHeld.toLocaleString()}</p>
                    </div>
                    <div className="rounded-3xl border border-red-200 bg-red-50 px-4 py-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-red-700">Outstanding Balance</p>
                      <p className="mt-2 text-2xl font-black text-red-900">Ksh {depositSettlementDerived.outstandingBalance.toLocaleString()}</p>
                    </div>
                    <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">Remaining After Apply</p>
                      <p className="mt-2 text-2xl font-black text-emerald-900">Ksh {depositSettlementDerived.remainingAfterApply.toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Choose settlement action</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
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
                            className={`rounded-3xl border px-4 py-4 text-left transition ${
                              active
                                ? "border-[#0B3B2E] bg-[#0B3B2E] text-white shadow-lg"
                                : disabled
                                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                : "border-slate-200 bg-slate-50 text-slate-900 hover:border-amber-300 hover:bg-amber-50"
                            }`}
                          >
                            <p className="text-sm font-black">{option.title}</p>
                            <p className={`mt-2 text-xs ${active ? "text-white/80" : "text-slate-500"}`}>{option.caption}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Smart calculation</p>
                        <h4 className="mt-1 text-base font-black text-slate-900">Settlement preview</h4>
                      </div>
                      {depositSettlementContext.loading && <span className="text-xs font-semibold text-slate-500">Loading invoice and account context...</span>}
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Apply To Arrears</p>
                        <p className="mt-2 text-lg font-black text-slate-900">Ksh {depositSettlementDerived.baseApplyAmount.toLocaleString()}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Refund Amount</p>
                        <p className="mt-2 text-lg font-black text-slate-900">Ksh {depositSettlementDerived.safeRefundAmount.toLocaleString()}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Retain Amount</p>
                        <p className="mt-2 text-lg font-black text-slate-900">Ksh {depositSettlementDerived.safeRetainAmount.toLocaleString()}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Final Balance</p>
                        <p className="mt-2 text-lg font-black text-slate-900">Ksh {depositSettlementDerived.finalBalance.toLocaleString()}</p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">Refund amount</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={depositSettlementAction !== "refund" || !depositSettlementDerived.canRefund}
                          value={depositSettlementForm.refundAmount}
                          onChange={(e) => setDepositSettlementForm((prev) => ({ ...prev, refundAmount: e.target.value }))}
                          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm disabled:bg-slate-100"
                          placeholder="0.00"
                        />
                        <p className="mt-1 text-[11px] text-slate-500">Refund is capped at the deposit left after arrears have been applied.</p>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">Retain amount</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={depositSettlementAction !== "retain"}
                          value={depositSettlementForm.retainAmount}
                          onChange={(e) => setDepositSettlementForm((prev) => ({ ...prev, retainAmount: e.target.value }))}
                          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm disabled:bg-slate-100"
                          placeholder="0.00"
                        />
                        <p className="mt-1 text-[11px] text-slate-500">Retention is supported through a charge invoice and immediate deposit settlement trail.</p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">Cash / bank account for refund</label>
                        <select
                          value={depositSettlementForm.cashbookAccountId}
                          disabled={depositSettlementAction !== "refund" || !depositSettlementDerived.canRefund}
                          onChange={(e) => setDepositSettlementForm((prev) => ({ ...prev, cashbookAccountId: e.target.value }))}
                          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm disabled:bg-slate-100"
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
                        <label className="block text-sm font-semibold text-slate-700">Reason / narration</label>
                        <textarea
                          rows={3}
                          value={depositSettlementForm.reason}
                          onChange={(e) => setDepositSettlementForm((prev) => ({ ...prev, reason: e.target.value }))}
                          placeholder="Move-out arrears cleared, damage retention, tenant refund reference..."
                          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Accounting preview</p>
                    <div className="mt-4 space-y-3 text-sm text-slate-700">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="font-black text-slate-900">Apply deposit</p>
                        <p className="mt-1">DR Deposit Liability</p>
                        <p>CR Tenant Receivable</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="font-black text-slate-900">Refund (manager-held only)</p>
                        <p className="mt-1">DR Deposit Liability</p>
                        <p>CR Cash / Bank</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="font-black text-slate-900">Retention</p>
                        <p className="mt-1">Create charge invoice first, then clear it from the deposit trail.</p>
                      </div>
                      {!depositSettlementDerived.canRefund && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
                          <p className="font-black">Landlord-held deposit rule</p>
                          <p className="mt-1 text-xs">This workspace will not post cash or bank refunds when the deposit is held by the landlord.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Open invoices available for settlement</p>
                        <h4 className="mt-1 text-base font-black text-slate-900">Automatic deposit allocation</h4>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                        {depositSettlementContext.creditableInvoices.length} open
                      </span>
                    </div>
                    <div className="mt-4 max-h-[260px] overflow-y-auto rounded-2xl border border-slate-200">
                      {depositSettlementContext.creditableInvoices.length > 0 ? (
                        <table className="min-w-full divide-y divide-slate-200 text-xs">
                          <thead className="bg-slate-50 text-slate-600">
                            <tr>
                              <th className="px-3 py-1.5 text-left font-black uppercase tracking-[0.14em]">Invoice</th>
                              <th className="px-3 py-1.5 text-left font-black uppercase tracking-[0.14em]">Category</th>
                              <th className="px-3 py-1.5 text-right font-black uppercase tracking-[0.14em]">Open</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {depositSettlementContext.creditableInvoices.map((invoice) => (
                              <tr key={normalizeId(invoice?._id)}>
                                <td className="px-3 py-1.5 font-semibold text-slate-900">{invoice?.invoiceNumber || "-"}</td>
                                <td className="px-3 py-1.5 text-slate-600">{String(invoice?.category || "-").replace(/_/g, " ")}</td>
                                <td className="px-3 py-1.5 text-right font-black text-slate-900">Ksh {roundMoney(invoice?.remainingCreditableAmount ?? invoice?.remainingBalance ?? 0).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="px-4 py-8 text-center text-sm text-slate-500">No open posted invoices are currently available for automatic crediting.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-[#0B3B2E]/15 bg-[#0B3B2E]/5 px-5 py-5">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-[#0B3B2E]">Final confirmation</p>
                    <div className="mt-4 space-y-2 text-sm text-slate-700">
                      <p><span className="font-black text-slate-900">Action:</span> {depositSettlementAction.replace(/_/g, " ")}</p>
                      <p><span className="font-black text-slate-900">Apply amount:</span> Ksh {depositSettlementDerived.baseApplyAmount.toLocaleString()}</p>
                      <p><span className="font-black text-slate-900">Refund amount:</span> Ksh {depositSettlementDerived.safeRefundAmount.toLocaleString()}</p>
                      <p><span className="font-black text-slate-900">Retain amount:</span> Ksh {depositSettlementDerived.safeRetainAmount.toLocaleString()}</p>
                      <p><span className="font-black text-slate-900">Deposit left after settlement:</span> Ksh {roundMoney(
                        depositSettlementDerived.depositHeld - depositSettlementDerived.baseApplyAmount - (depositSettlementAction === "refund" ? depositSettlementDerived.safeRefundAmount : 0) - (depositSettlementAction === "retain" ? depositSettlementDerived.safeRetainAmount : 0)
                      ).toLocaleString()}</p>
                    </div>
                    <div className="mt-5 flex flex-wrap justify-end gap-3">
                      <button
                        onClick={closeDepositSettlementModal}
                        disabled={isProcessingDepositSettlement}
                        className="rounded-2xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={processDepositSettlement}
                        disabled={isProcessingDepositSettlement || depositSettlementContext.loading}
                        className="rounded-2xl bg-[#0B3B2E] px-5 py-2.5 text-sm font-black text-white shadow-lg transition hover:bg-[#0a2f25] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isProcessingDepositSettlement ? "Processing settlement..." : "Confirm Settlement"}
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
    </DashboardLayout>
  );
};

export default Tenants;
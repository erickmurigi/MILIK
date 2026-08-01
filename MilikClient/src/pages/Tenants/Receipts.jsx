import { LISTING_UI, normalizeUppercaseInput } from "../../utils/listingPageUtils";
import { buildTenantOption } from "../../utils/tenantUtils";
import { isSelfManagingLandlordCompany } from "../../utils/companyModules";
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useEntityCache } from "../../hooks/useEntityCache";
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllTenants,
  selectAllProperties,
} from "../../redux/selectors";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  FaArrowLeft,
  FaCheck,
  FaEdit,
  FaEye,
  FaFileInvoiceDollar,
  FaFileInvoice,
  FaMoneyBillWave,
  FaReceipt,
  FaPlus,
  FaPrint,
  FaRedoAlt,
  FaSearch,
  FaTimes,
  FaTrash,
  FaUndo,
  FaLink,
  FaMagic,
  FaSave,
  FaInfoCircle,
  FaMinusCircle,
  FaPlusCircle,
  FaSms,
  FaEnvelope,
  FaDownload,
  FaListAlt,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import JournalEntriesDrawer from "../../components/Accounting/JournalEntriesDrawer";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import {
  getTenants,
  confirmRentPayment,
  createRentPayment,
  deleteRentPayment,
  listRentPaymentsPage,
  reverseRentPayment,
  cancelRentPaymentReversal,
  updateRentPayment,
  unconfirmRentPayment,
  getTenantInvoices,
  getChartOfAccounts,
  getReceiptAllocationOptions,
  updateReceiptAllocations,
  downloadReceiptPdf,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { hasCompanyPermission } from "../../utils/permissions";
import { printTabularList } from "../../utils/printList";
import { isCashbookAccount } from "../../utils/cashbookUtils";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";
const ITEMS_PER_PAGE = 50;

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.tenants)) return value.tenants;
  if (Array.isArray(value?.rentPayments)) return value.rentPayments;
  if (Array.isArray(value?.invoices)) return value.invoices;
  if (Array.isArray(value?.accounts)) return value.accounts;
  return [];
};


const CASHBOOK_ACCOUNT_MAP = {
  "Main Cashbook": { code: "1100", name: "Cash on Hand - Main" },
  "Bank Cashbook": { code: "1110", name: "Bank Accounts - Operations" },
  "Petty Cash": { code: "1120", name: "Petty Cash" },
  "M-Pesa Collections": { code: "1130", name: "M-Pesa Collections" },
  "Agency Collections": { code: "1140", name: "Agency Collections Control" },
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

const toInputDate = (date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
};

const safeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return value._id ? String(value._id) : "";
  return String(value);
};

const getInvoiceChargeType = (invoice = {}) => {
  const category = String(invoice?.category || "").toUpperCase();
  const metadata = invoice?.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {};
  if (category === "RENT_CHARGE" && String(metadata?.billItemKey || "").trim().toLowerCase() === "rent_utility:combined") {
    return "combined";
  }
  if (category === "UTILITY_CHARGE") return "utility";
  if (category === "DEPOSIT_CHARGE") return "deposit";
  if (category === "LATE_PENALTY_CHARGE") return "late_fee";
  return "rent";
};

const formatMoney = (value) => `Ksh ${Math.abs(Number(value || 0)).toLocaleString()}`;

const getAllocationGroupLabel = (value = "") => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "late_penalty") return "Late Penalty";
  if (normalized === "debit_note") return "Debit Note";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Other";
};

const getInvoiceOptionLabel = (invoice = {}) => {
  const ref = invoice?.invoiceNumber || invoice?.description || "Invoice";
  const categoryLabel = getAllocationGroupLabel(invoice?.priorityGroup || getInvoiceChargeType(invoice));
  const utilitySuffix = invoice?.utilityType ? ` · ${invoice.utilityType}` : "";
  return `${ref} · ${categoryLabel}${utilitySuffix}`;
};

const getAllocationOptionAmount = (invoice = {}) => {
  const maxAllocatable = Number(invoice?.maxAllocatable || 0);
  const currentAllocation = Number(invoice?.currentAllocation || 0);
  const amount = Number(invoice?.amount || invoice?.netAmount || invoice?.adjustedAmount || 0);
  return maxAllocatable > 0 ? maxAllocatable : currentAllocation > 0 ? currentAllocation : amount;
};

const getAllocationOptionLabel = (invoice = {}) => {
  const ref = invoice?.invoiceNumber || invoice?.description || invoice?.invoiceId || "Invoice";
  const categoryLabel = getAllocationGroupLabel(invoice?.priorityGroup || invoice?.chargeType || getInvoiceChargeType(invoice));
  const utilitySuffix = invoice?.utilityType ? ` · ${invoice.utilityType}` : "";
  return `${ref} · ${categoryLabel}${utilitySuffix} · ${formatMoney(getAllocationOptionAmount(invoice))}`;
};

const buildAppliedAmountsByInvoice = (payments = [], tenantId = "") => {
  const appliedByInvoice = new Map();
  const tenantIdStr = String(tenantId || "");

  payments.forEach((payment) => {
    const paymentTenantId = safeId(payment?.tenant);
    if (tenantIdStr && paymentTenantId !== tenantIdStr) return;
    if (payment?.ledgerType !== "receipts") return;
    if (payment?.isConfirmed !== true) return;
    if (payment?.isCancelled === true || payment?.isReversed === true || payment?.reversalOf) return;
    if (String(payment?.postingStatus || "").toLowerCase() === "reversed") return;

    (Array.isArray(payment?.allocations) ? payment.allocations : []).forEach((allocation) => {
      const invoiceId = String(allocation?.invoice || allocation?.invoiceId || "");
      if (!invoiceId) return;
      const amount = Number(allocation?.appliedAmount || 0);
      if (!amount) return;
      appliedByInvoice.set(invoiceId, Number(appliedByInvoice.get(invoiceId) || 0) + amount);
    });
  });

  return appliedByInvoice;
};

const getTenantName = (payment, tenants) => {
  const directName =
    payment?.tenant?.name ||
    payment?.tenant?.tenantName ||
    [payment?.tenant?.firstName, payment?.tenant?.lastName].filter(Boolean).join(" ");
  if (directName) return directName;

  const tenantIdStr = safeId(payment?.tenant);
  const found = tenants.find((tenant) => safeId(tenant) === tenantIdStr);
  return found?.name || "N/A";
};

const getUnitName = (payment, tenants) => {
  const direct = payment?.unit?.unitNumber || payment?.unit?.name || payment?.unit?.unitName;
  if (direct) return direct;

  const tenantIdStr = safeId(payment?.tenant);
  const found = tenants.find((tenant) => safeId(tenant) === tenantIdStr);
  return found?.unit?.unitNumber || "N/A";
};

const getActorDisplayName = (user) => {
  if (!user) return "-";
  const surname = String(user?.surname || "").trim();
  const otherNames = String(user?.otherNames || "").trim();
  const email = String(user?.email || "").trim();
  const fullName = [surname, otherNames].filter(Boolean).join(" ").trim();
  return fullName || email || "-";
};

const getPropertyName = (payment, tenants) => {
  const directProperty = payment?.unit?.property?.propertyName || payment?.unit?.propertyName;
  if (directProperty) return directProperty;

  const tenantIdStr = safeId(payment?.tenant);
  const found = tenants.find((tenant) => safeId(tenant) === tenantIdStr);

  return (
    found?.unit?.property?.propertyName ||
    found?.property?.propertyName ||
    found?.propertyName ||
    "N/A"
  );
};

const getLedgerType = (payment) => {
  return payment?.ledgerType === "receipts" ? "receipts" : "unknown";
};

const getReceiptDisplayType = (payment) => {
  if (payment?.paidDirectToLandlord) return "Landlord Receipt";
  switch (String(payment?.paymentType || "").toLowerCase()) {
    case "rent":
      return "Tenant Receipt";
    case "utility":
      return "Utility Receipt";
    case "deposit":
      return "Deposit Receipt";
    case "late_fee":
      return "Late Fee Receipt";
    case "other":
      return "Other Receipt";
    default:
      return "Receipt";
  }
};

const getCashbookLabel = (payment) => {
  return payment?.paidDirectToLandlord ? "Direct to Landlord" : payment?.cashbook || "-";
};

const getCashbookAccount = (cashbook) => {
  return CASHBOOK_ACCOUNT_MAP[cashbook] || CASHBOOK_ACCOUNT_MAP["Main Cashbook"];
};

const buildJournalEntriesForReceipt = (receipt) => {
  const amount = Math.abs(Number(receipt?.amount || 0));
  const narration =
    receipt?.description || `Receipt ${receipt?.receiptNumber || receipt?.referenceNumber || ""}`;

  let creditAccount = { code: "1200", name: "Tenant Receivables" };

  if (receipt?.paymentType === "deposit") {
    creditAccount = { code: "2200", name: "Tenant Deposit Liability" };
  } else if (receipt?.paymentType === "late_fee") {
    creditAccount = { code: "4200", name: "Late Fee Income" };
  } else if (receipt?.paymentType === "other") {
    creditAccount = { code: "4300", name: "Other Income" };
  }

  const debitAccount = receipt?.paidDirectToLandlord
    ? { code: "2110", name: "Landlord Payables" }
    : getCashbookAccount(receipt?.cashbook || "Main Cashbook");

  return [
    {
      accountCode: debitAccount.code,
      accountName: debitAccount.name,
      debit: amount,
      credit: 0,
      narration,
    },
    {
      accountCode: creditAccount.code,
      accountName: creditAccount.name,
      debit: 0,
      credit: amount,
      narration,
    },
  ];
};

const Receipts = ({ viewMode = "tenant" }) => {
  const { id: tenantId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const isCompanyLandlordMode = isSelfManagingLandlordCompany(currentCompany);
  const entityCache = useEntityCache(currentCompany?._id);
  const entityCacheRef = useRef(entityCache);
  entityCacheRef.current = entityCache;
  const {
    canCreateReceipt,
    canProcessReceipt,
    canReverseReceipt,
    canDeleteReceipt,
    canExportReceipt,
    canUpdateReceipt,
  } = useMemo(() => ({
    canCreateReceipt: hasCompanyPermission(currentUser || {}, currentCompany, "receipts", "create", "propertyManagement"),
    canProcessReceipt: hasCompanyPermission(currentUser || {}, currentCompany, "receipts", "process", "propertyManagement"),
    canReverseReceipt: hasCompanyPermission(currentUser || {}, currentCompany, "receipts", "reverse", "propertyManagement"),
    canDeleteReceipt: hasCompanyPermission(currentUser || {}, currentCompany, "receipts", "delete", "propertyManagement"),
    canExportReceipt: hasCompanyPermission(currentUser || {}, currentCompany, "receipts", "export", "propertyManagement"),
    canUpdateReceipt: hasCompanyPermission(currentUser || {}, currentCompany, "receipts", "update", "propertyManagement"),
  }), [currentUser, currentCompany]);
  const isLandlordReceiptView = viewMode === "landlord";
  const isDefaultTenantView = !isLandlordReceiptView;
  const backPath = isLandlordReceiptView ? "/landlords" : "/tenants";
  const pageLabel = isLandlordReceiptView ? "Landlord Receipts" : "Rental Receipts";
  const pageCreateLabel = isLandlordReceiptView ? "New Landlord Receipt" : "New Receipt";
  const rawTenants = useSelector(selectAllTenants);
  const properties = useSelector(selectAllProperties);

  const tenants = useMemo(() => ensureArray(rawTenants), [rawTenants]);

  const [receipts, setReceipts] = useState([]);
  const [recPagination, setRecPagination] = useState({ totalItems: 0, totalPages: 1, page: 1, limit: ITEMS_PER_PAGE });

  const fromLedger = location.state?.fromPropertyLedger;
  const initialFilters = {
    search: "",
    tenantSearch: "",
    status: "active",
    paymentType: "all",
    tenant: tenantId || "all",
    property: fromLedger ? (location.state?.propertyName || "all") : "all",
    unit: "",
    ledger: "all",
    from: "",
    to: "",
  };

  const [appliedFilters, setAppliedFilters] = useTabState("/receipts:appliedFilters", initialFilters);
  const [draftFilters, setDraftFilters] = useState(appliedFilters);
  const setFilter = (key) => (e) => setDraftFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const [selectedIds, setSelectedIds] = useState([]);
  const [currentPage, setCurrentPage] = useTabState("/receipts:currentPage", 1);
  const [showForm, setShowForm] = useState(false);
  const [showSmsModal, setShowSmsModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showView, setShowView] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState(null);
  const [journalDrawerOpen, setJournalDrawerOpen] = useState(false);
  const [journalContext, setJournalContext] = useState({});
  const [journalLines, setJournalLines] = useState([]);
  const [tenantInvoices, setTenantInvoices] = useState([]);
  const [cashbookOptions, setCashbookOptions] = useState([]);
  const [formData, setFormData] = useState({
    tenantId: tenantId || "",
    amount: "",
    paymentType: "rent",
    paymentMethod: "mobile_money",
    cashbook: "Main Cashbook",
    paidDirectToLandlord: false,
    paymentDate: new Date().toISOString().split("T")[0],
    dueDate: new Date().toISOString().split("T")[0],
    referenceNumber: "",
    bankingDate: new Date().toISOString().split("T")[0],
    recordDate: new Date().toISOString().split("T")[0],
    description: "",
    isConfirmed: false,
  });

  const isSystemAdmin = Boolean(currentUser?.isSystemAdmin);
  const [allocationDrawerOpen, setAllocationDrawerOpen] = useState(false);
  const [allocationTarget, setAllocationTarget] = useState(null);
  const [allocationOptions, setAllocationOptions] = useState([]);
  const [allocationLines, setAllocationLines] = useState([]);
  const [allocationSearchTerms, setAllocationSearchTerms] = useState({});
  const [allocationDropdownOpen, setAllocationDropdownOpen] = useState({});
  const [allocationDropdownPos, setAllocationDropdownPos] = useState({});
  const [allocationAdminOverride, setAllocationAdminOverride] = useState(false);
  const [canAdminOverride, setCanAdminOverride] = useState(false);
  const [allocationReason, setAllocationReason] = useState("");
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [allocationSaving, setAllocationSaving] = useState(false);
  const [allocationRules, setAllocationRules] = useState({
    appendOnlyUnappliedForConfirmed: false,
    lockedUnappliedForConfirmed: false,
    lockedAllocatedTotal: 0,
    currentUnapplied: 0,
  });
  const [allocationPrepaymentTypes, setAllocationPrepaymentTypes] = useState([{ billItemKey: "rent", label: "Rent Prepayment" }]);
  const [prepaymentWorkspaceLines, setPrepaymentWorkspaceLines] = useState([]);
  const [formPayments, setFormPayments] = useState([]);
  const requestedReceiptId = useMemo(() => new URLSearchParams(location.search).get("receipt") || "", [location.search]);
  const [autoOpenedReceiptId, setAutoOpenedReceiptId] = useState("");
  const [prepaymentLines, setPrepaymentLines] = useState([]);
  const prepaymentLinesInitializedRef = useRef(false);
  const [reversalModal, setReversalModal] = useState({ open: false, isBatch: false, receipt: null, receipts: [], reason: "", loading: false });
  const [cancelReversalModal, setCancelReversalModal] = useState({ open: false, receipt: null, reason: "", loading: false });

  const loadInvoices = useCallback(async () => {
    if (!currentCompany?._id) return;
    try {
      const [invoiceRows, chartRows] = await Promise.all([
        getTenantInvoices({ business: currentCompany._id, status: "ACTIVE" }),
        getChartOfAccounts({ business: currentCompany._id, type: "asset" }),
      ]);

      const normalizedInvoices = ensureArray(invoiceRows);
      const normalizedChartRows = ensureArray(chartRows);

      setTenantInvoices(normalizedInvoices);
      setCashbookOptions(normalizedChartRows.filter(isCashbookAccount));
    } catch {
      setTenantInvoices([]);
      setCashbookOptions([]);
    }
  }, [currentCompany?._id]);

  const loadData = useCallback(async (page = 1, filters = {}) => {
    if (!currentCompany?._id) return;
    const params = { business: currentCompany._id, page, limit: ITEMS_PER_PAGE };
    if (filters.status && filters.status !== "all") params.status = filters.status;
    if (filters.paymentType && filters.paymentType !== "all") params.paymentType = filters.paymentType;
    if (filters.tenant && filters.tenant !== "all") params.tenant = filters.tenant;
    if (filters.property && filters.property !== "all") params.property = filters.property;
    if (filters.unit) params.unit = filters.unit;
    if (filters.search) params.search = filters.search;
    if (filters.tenantSearch) params.tenantSearch = filters.tenantSearch;
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    if (!isCompanyLandlordMode) {
      params.paidDirectToLandlord = isLandlordReceiptView;
    }
    const { propertiesLoaded, tenantsLoaded } = entityCacheRef.current;
    try {
      const [receiptResult] = await Promise.all([
        listRentPaymentsPage(params),
        ...(tenantsLoaded ? [] : [getTenants(dispatch, currentCompany._id)]),
        ...(propertiesLoaded ? [] : [dispatch(getProperties({ business: currentCompany._id }))]),
      ]);
      setReceipts(receiptResult.items);
      setRecPagination(receiptResult.pagination);
    } catch {
      toast.error("Failed to load receipts");
    }
  }, [currentCompany?._id, dispatch, isLandlordReceiptView, isCompanyLandlordMode]);

  const loadDataRef = useRef(loadData);
  useEffect(() => { loadDataRef.current = loadData; });

  const initialFiltersRef = useRef(initialFilters);

  useEffect(() => {
    if (!currentCompany?._id) return;
    loadDataRef.current(1, initialFiltersRef.current);
    loadInvoices();
  }, [currentCompany?._id, loadInvoices]);

  // Load payments for the selected tenant when the receipt form opens (for balance calc)
  useEffect(() => {
    if (!showForm || !formData.tenantId || !currentCompany?._id) { setFormPayments([]); return; }
    listRentPaymentsPage({
      business: currentCompany._id,
      tenant: formData.tenantId,
      status: "active",
      limit: 500,
      page: 1,
    }).then(({ items }) => setFormPayments(items ?? [])).catch(() => {});
  }, [showForm, formData.tenantId, currentCompany?._id]);

  const propertyOptions = useMemo(() => {
    const names = (properties || [])
      .map((p) => p?.propertyName)
      .filter(Boolean)
      .sort((a, b) => String(a).localeCompare(String(b)));
    return ["all", ...names];
  }, [properties]);

  // unitOptions removed — unit filter is now a text-search passed to the backend

  // Server handles all filtering — receipts is the current page
  const currentPageReceipts = receipts;
  const totalPages = Math.max(1, recPagination.totalPages);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = recPagination.totalItems === 0 ? 0 : (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;

  const visibleReceiptIds = useMemo(
    () => currentPageReceipts.map((receipt) => receipt._id),
    [currentPageReceipts]
  );

  const handlePageChange = useCallback((page) => {
    const target = Math.max(1, Math.min(totalPages, page));
    setCurrentPage(target);
    setSelectedIds([]);
    loadData(target, appliedFilters);
  }, [totalPages, loadData, appliedFilters]);

  const stats = useMemo(() => {
    const total = currentPageReceipts.reduce((sum, item) => sum + Math.abs(Number(item.amount) || 0), 0);
    const confirmedCount = currentPageReceipts.filter((item) => item.isConfirmed).length;
    const pendingCount = currentPageReceipts.length - confirmedCount;

    return {
      count: recPagination.totalItems,
      total,
      confirmedCount,
      pendingCount,
    };
  }, [currentPageReceipts, recPagination.totalItems]);

  const selectedTenant = useMemo(() => {
    return tenants.find((tenant) => safeId(tenant) === String(formData.tenantId));
  }, [formData.tenantId, tenants]);

  const isDirectToLandlord = Boolean(formData.paidDirectToLandlord);

  // Prepayment type options built from tenant's lease utilities + rent (always first)
  const prepaymentTypeOptions = useMemo(() => {
    const opts = [{ billItemKey: "rent", label: "Rent" }];
    (selectedTenant?.utilities || []).forEach((u) => {
      const label = String(u?.utilityLabel || u?.label || "").trim();
      if (!label) return;
      const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      opts.push({ billItemKey: `utility:${normalized}`, label });
    });
    return opts;
  }, [selectedTenant]);

  const getCreatedInvoicesForTenant = useCallback(
    (targetTenantId) => {
      if (!targetTenantId) return [];
      const tenantIdStr = String(targetTenantId);

      return tenantInvoices.filter((invoice) => {
        const invoiceTenantId = safeId(invoice?.tenant);
        return invoiceTenantId === tenantIdStr;
      });
    },
    [tenantInvoices]
  );

  const calculateTenantBalance = useCallback(
    (targetTenantId) => {
      if (!targetTenantId) return { totalOwed: 0, totalPaid: 0, balance: 0 };

      const tenantIdStr = String(targetTenantId);

      const tenantPayments = formPayments.filter((p) => {
        const paymentTenantId = safeId(p?.tenant);
        return (
          p?.ledgerType === "receipts" &&
          paymentTenantId === tenantIdStr &&
          p.isConfirmed === true &&
          p.isCancelled !== true &&
          p.isReversed !== true &&
          !p?.reversalOf &&
          String(p?.postingStatus || "").toLowerCase() !== "reversed"
        );
      });

      const totalPaid = tenantPayments.reduce((sum, p) => sum + Math.abs(Number(p.amount) || 0), 0);

      const invoices = getCreatedInvoicesForTenant(targetTenantId).filter(
        (inv) => !["cancelled", "reversed"].includes(String(inv?.status || "").toLowerCase())
      );

      const totalOwed = invoices.reduce(
        (sum, inv) => sum + (Number((inv.netAmount ?? inv.adjustedAmount ?? inv.amount) || 0)),
        0
      );
      const balance = totalOwed - totalPaid;

      return { totalOwed, totalPaid, balance };
    },
    [formPayments, getCreatedInvoicesForTenant]
  );

  const getOutstandingInvoices = useCallback(
    (targetTenantId) => {
      if (!targetTenantId) return [];

      const invoices = getCreatedInvoicesForTenant(targetTenantId)
        .filter(
          (inv) =>
            Number(inv.amount) > 0 &&
            !["cancelled", "reversed"].includes(String(inv?.status || "").toLowerCase())
        )
        .sort((a, b) => {
          const aTime = a.invoiceDate
            ? new Date(a.invoiceDate).getTime()
            : a.createdAt
            ? new Date(a.createdAt).getTime()
            : 0;
          const bTime = b.invoiceDate
            ? new Date(b.invoiceDate).getTime()
            : b.createdAt
            ? new Date(b.createdAt).getTime()
            : 0;
          return aTime - bTime;
        });

      const appliedByInvoice = buildAppliedAmountsByInvoice(formPayments, targetTenantId);

      return invoices
        .map((inv) => {
          const invAmount = Number((inv.netAmount ?? inv.adjustedAmount ?? inv.amount) || 0);
          const paid = Math.min(
            invAmount,
            Math.max(0, Number(appliedByInvoice.get(String(inv._id || "")) || 0))
          );
          const outstanding = Math.max(0, invAmount - paid);

          return {
            month:
              inv.period ||
              inv.invoiceNumber ||
              (inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : "Invoice"),
            chargeType: getInvoiceChargeType(inv),
            billedAmount: invAmount,
            paid,
            outstanding,
          };
        })
        .filter((inv) => inv.outstanding > 0 || inv.paid > 0);
    },
    [getCreatedInvoicesForTenant, formPayments]
  );

  // Excess = receipt amount beyond all open invoices → must be tagged as prepayment
  const totalOutstanding = useMemo(() => {
    if (!formData.tenantId) return 0;
    return getOutstandingInvoices(formData.tenantId).reduce((s, inv) => s + Number(inv.outstanding || 0), 0);
  }, [formData.tenantId, getOutstandingInvoices]);

  const excessAmount = useMemo(() => {
    const amt = Number(formData.amount) || 0;
    return Math.max(0, Math.round((amt - totalOutstanding) * 100) / 100);
  }, [formData.amount, totalOutstanding]);

  // When excess appears/changes, auto-seed prepayment lines; reset when excess disappears
  useEffect(() => {
    if (excessAmount <= 0) {
      setPrepaymentLines([]);
      prepaymentLinesInitializedRef.current = false;
      return;
    }
    if (!prepaymentLinesInitializedRef.current) {
      setPrepaymentLines([{ billItemKey: "rent", label: "Rent", amount: excessAmount }]);
      prepaymentLinesInitializedRef.current = true;
    }
  }, [excessAmount]);

  const resetForm = () => {
    setFormData({
      tenantId: tenantId || "",
      amount: "",
      paymentType: "rent",
      paymentMethod: "mobile_money",
      cashbook: "Main Cashbook",
      paidDirectToLandlord: false,
      paymentDate: new Date().toISOString().split("T")[0],
      dueDate: new Date().toISOString().split("T")[0],
      referenceNumber: "",
      bankingDate: new Date().toISOString().split("T")[0],
      recordDate: new Date().toISOString().split("T")[0],
      description: "",
      isConfirmed: false,
    });
    setActiveReceipt(null);
    setShowForm(false);
    setPrepaymentLines([]);
    prepaymentLinesInitializedRef.current = false;
  };

  const openCreateForm = () => {
    if (!canCreateReceipt) {
      toast.warning("You do not have permission to record receipts");
      return;
    }
    const params = new URLSearchParams();
    if (tenantId) params.set("tenant", tenantId);
    if (isLandlordReceiptView) params.set("mode", "landlord");
    const query = params.toString();
    navigate(`/receipts/new${query ? `?${query}` : ""}`);
  };

  const openEditForm = (receipt) => {
    const tenantRef = safeId(receipt?.tenant) || "";
    setActiveReceipt(receipt);
    setFormData({
      tenantId: tenantRef,
      amount: receipt.amount || "",
      paymentType: receipt.paymentType || "rent",
      paymentMethod: receipt.paymentMethod || "mobile_money",
      cashbook: receipt.cashbook || "Main Cashbook",
      paidDirectToLandlord: Boolean(receipt.paidDirectToLandlord),
      paymentDate:
        (receipt.paymentDate || "").split("T")[0] || new Date().toISOString().split("T")[0],
      dueDate:
        (receipt.dueDate || "").split("T")[0] || new Date().toISOString().split("T")[0],
      referenceNumber: receipt.referenceNumber || "",
      bankingDate:
        (receipt.bankingDate || receipt.paymentDate || "").split("T")[0] || new Date().toISOString().split("T")[0],
      recordDate:
        (receipt.recordDate || receipt.createdAt || "").split("T")[0] || new Date().toISOString().split("T")[0],
      description: receipt.description || "",
      isConfirmed: Boolean(receipt.isConfirmed),
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!(activeReceipt?._id ? canUpdateReceipt : canCreateReceipt)) {
      toast.warning(activeReceipt?._id ? "You do not have permission to update receipts" : "You do not have permission to record receipts");
      return;
    }
    if (!formData.tenantId) {
      toast.error("Tenant is required");
      return;
    }

    if (!formData.amount || Number(formData.amount) <= 0) {
      toast.error("Amount must be greater than zero");
      return;
    }

    if (!isDirectToLandlord && !formData.cashbook) {
      toast.error("Cashbook is required unless this receipt was paid directly to the landlord");
      return;
    }

    if (!String(formData.referenceNumber || "").trim()) {
      toast.error("Reference number is required");
      return;
    }

    const unitId = selectedTenant?.unit?._id || selectedTenant?.unit;
    if (!unitId) {
      toast.error("Selected tenant has no linked unit");
      return;
    }

    if (excessAmount > 0 && !activeReceipt?._id) {
      const prepayTotal = prepaymentLines.reduce((s, l) => s + Number(l.amount || 0), 0);
      const diff = Math.abs(Math.round((prepayTotal - excessAmount) * 100) / 100);
      if (diff > 0.01) {
        toast.error(`Prepayment lines must total exactly Ksh ${excessAmount.toLocaleString()}. Currently Ksh ${prepayTotal.toLocaleString()}.`);
        return;
      }
    }

    const paymentDateObj = new Date(formData.paymentDate);
    const payload = {
      tenant: formData.tenantId,
      unit: unitId,
      amount: Number(formData.amount),
      paymentType: formData.paymentType,
      paymentMethod: formData.paymentMethod,
      cashbook: isDirectToLandlord ? "" : formData.cashbook,
      paidDirectToLandlord: isDirectToLandlord,
      paymentDate: formData.paymentDate,
      dueDate: formData.dueDate,
      referenceNumber: String(formData.referenceNumber || "").trim(),
      bankingDate: formData.bankingDate || undefined,
      recordDate: formData.recordDate || undefined,
      description: formData.description,
      isConfirmed: formData.isConfirmed,
      month: paymentDateObj.getMonth() + 1,
      year: paymentDateObj.getFullYear(),
      ledgerType: "receipts",
      prepaymentLines: excessAmount > 0 && !activeReceipt?._id
        ? prepaymentLines.map((l) => ({ billItemKey: l.billItemKey, label: l.label, amount: Number(l.amount || 0) }))
        : [],
      business: currentCompany?._id,
    };

    try {
      if (activeReceipt?._id) {
        await updateRentPayment(dispatch, activeReceipt._id, payload);
        toast.success("Receipt updated successfully");
      } else {
        await createRentPayment(dispatch, payload);
        toast.success("Receipt created successfully");
      }
      resetForm();
      await loadData(safeCurrentPage, appliedFilters);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save receipt");
    }
  };

  const handleDeleteOne = async (receiptId, receipt = null) => {
    if (!canDeleteReceipt) {
      toast.warning("You do not have permission to delete receipts");
      return;
    }
    // Reversed receipts carry a full GL chain — warn before purging
    if (receipt?.isReversed) {
      const ok = window.confirm(
        `Receipt ${receipt.receiptNumber || receiptId} is reversed.\n\nDeleting it will permanently void both the original and reversal ledger entries. This cannot be undone.\n\nContinue?`
      );
      if (!ok) return;
    }
    try {
      await deleteRentPayment(dispatch, receiptId);
      toast.success("Receipt deleted");
      setSelectedIds((prev) => prev.filter((id) => id !== receiptId));
      await loadData(safeCurrentPage, appliedFilters);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete receipt");
    }
  };

  const handleDeleteSelected = async () => {
    if (!canDeleteReceipt) {
      toast.warning("You do not have permission to delete receipts");
      return;
    }
    if (selectedIds.length === 0) {
      toast.warning("Select receipt(s) to delete");
      return;
    }

    try {
      await Promise.all(selectedIds.map((receiptId) => deleteRentPayment(dispatch, receiptId)));
      toast.success(`${selectedIds.length} receipt(s) deleted`);
      setSelectedIds([]);
      await loadData(safeCurrentPage, appliedFilters);
    } catch {
      toast.error("Failed to delete selected receipts");
    }
  };

  const handleReverseOne = async (receipt) => {
    if (!canReverseReceipt) {
      toast.warning("You do not have permission to reverse receipts");
      return;
    }
    if (!receipt?.isConfirmed) {
      toast.warning("Only confirmed receipts can be reversed");
      return;
    }

    if (receipt?.isReversed) {
      toast.info("Receipt is already reversed");
      return;
    }

    setReversalModal({ open: true, isBatch: false, receipt, receipts: [], reason: "Customer correction", loading: false });
  };

  const handleCancelReversalOpen = (receipt) => {
    if (!canReverseReceipt) {
      toast.warning("You do not have permission to cancel reversals");
      return;
    }
    if (!receipt?.isReversed) {
      toast.warning("This receipt has not been reversed");
      return;
    }
    setCancelReversalModal({ open: true, receipt, reason: "", loading: false });
  };

  const handleCancelReversalConfirm = async () => {
    const { receipt, reason } = cancelReversalModal;
    if (!receipt?._id) return;
    setCancelReversalModal((prev) => ({ ...prev, loading: true }));
    try {
      const res = await cancelRentPaymentReversal(dispatch, receipt._id, { reason: reason.trim() || "Reversal cancelled by user" });
      toast.success(res?.message || "Reversal cancelled. Receipt restored successfully.");
      setCancelReversalModal({ open: false, receipt: null, reason: "", loading: false });
      await loadData(safeCurrentPage, appliedFilters);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to cancel reversal");
      setCancelReversalModal((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleReverseSelected = async () => {
    if (!canReverseReceipt) {
      toast.warning("You do not have permission to reverse receipts");
      return;
    }
    if (selectedIds.length === 0) {
      toast.warning("Select receipt(s) to reverse");
      return;
    }

    const selectedReceipts = receipts.filter((r) => selectedIds.includes(r._id));
    const eligible = selectedReceipts.filter((r) => r.isConfirmed && !r.isReversed);

    if (eligible.length === 0) {
      toast.warning("No eligible confirmed receipts selected for reversal");
      return;
    }

    setReversalModal({ open: true, isBatch: true, receipt: null, receipts: eligible, reason: "Batch correction", loading: false });
  };

  const handleReversalConfirm = async () => {
    const reason = (reversalModal.reason || "").trim() || (reversalModal.isBatch ? "Batch correction" : "Customer correction");
    setReversalModal((prev) => ({ ...prev, loading: true }));
    try {
      if (reversalModal.isBatch) {
        await Promise.all(reversalModal.receipts.map((r) => reverseRentPayment(dispatch, r._id, { reason })));
        toast.success(`${reversalModal.receipts.length} receipt(s) reversed successfully`);
        setSelectedIds([]);
      } else {
        await reverseRentPayment(dispatch, reversalModal.receipt._id, { reason });
        toast.success("Receipt reversed successfully");
      }
      setReversalModal({ open: false, isBatch: false, receipt: null, receipts: [], reason: "", loading: false });
      await loadData(safeCurrentPage, appliedFilters);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to reverse receipt");
      setReversalModal((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleCancelReversalOne = async () => {
    if (!canReverseReceipt) {
      toast.warning("You do not have permission to cancel receipt reversals");
      return;
    }
    toast.info("Cancellation of posted reversals is blocked. Create a correcting receipt instead.");
  };

  const applySearchFilters = () => {
    const newFilters = { ...draftFilters };
    setAppliedFilters(newFilters);
    setSelectedIds([]);
    setCurrentPage(1);
    loadData(1, newFilters);
  };

  const resetSearchFilters = () => {
    const reset = { ...initialFilters, tenant: tenantId || "all" };
    setDraftFilters(reset);
    setAppliedFilters(reset);
    setSelectedIds([]);
    setCurrentPage(1);
    loadData(1, reset);
  };

  const computeDateRange = (preset) => {
    const today = new Date();
    if (preset === "today") return { from: toInputDate(today), to: toInputDate(today) };
    if (preset === "yesterday") { const y = new Date(today); y.setDate(today.getDate() - 1); return { from: toInputDate(y), to: toInputDate(y) }; }
    if (preset === "thisWeek") { const d = today.getDay(); const m = new Date(today); m.setDate(today.getDate() - ((d + 6) % 7)); const s = new Date(m); s.setDate(m.getDate() + 6); return { from: toInputDate(m), to: toInputDate(s) }; }
    if (preset === "lastWeek") { const d = today.getDay(); const m = new Date(today); m.setDate(today.getDate() - ((d + 6) % 7) - 7); const s = new Date(m); s.setDate(m.getDate() + 6); return { from: toInputDate(m), to: toInputDate(s) }; }
    if (preset === "thisMonth") return { from: toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: toInputDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
    if (preset === "lastMonth") return { from: toInputDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: toInputDate(new Date(today.getFullYear(), today.getMonth(), 0)) };
    if (preset === "thisQuarter") { const q = Math.floor(today.getMonth() / 3); return { from: toInputDate(new Date(today.getFullYear(), q * 3, 1)), to: toInputDate(new Date(today.getFullYear(), q * 3 + 3, 0)) }; }
    if (preset === "lastQuarter") { const q = Math.floor(today.getMonth() / 3) - 1; const yr = q < 0 ? today.getFullYear() - 1 : today.getFullYear(); const qq = (q + 4) % 4; return { from: toInputDate(new Date(yr, qq * 3, 1)), to: toInputDate(new Date(yr, qq * 3 + 3, 0)) }; }
    if (preset === "thisYear") return { from: toInputDate(new Date(today.getFullYear(), 0, 1)), to: toInputDate(new Date(today.getFullYear(), 11, 31)) };
    if (preset === "lastYear") return { from: toInputDate(new Date(today.getFullYear() - 1, 0, 1)), to: toInputDate(new Date(today.getFullYear() - 1, 11, 31)) };
    return { from: "", to: "" };
  };

  const applyDatePreset = (preset) => {
    const { from, to } = computeDateRange(preset);
    setDraftFilters((prev) => ({ ...prev, from, to }));
  };

  const applyDatePresetAndSearch = (preset) => {
    const { from, to } = computeDateRange(preset);
    const newFilters = { ...appliedFilters, from, to };
    setAppliedFilters(newFilters);
    setDraftFilters((prev) => ({ ...prev, from, to }));
    setSelectedIds([]);
    setCurrentPage(1);
    loadData(1, newFilters);
  };

  const handleConfirmOne = async (receipt) => {
    if (!canProcessReceipt) {
      toast.warning("You do not have permission to confirm receipts");
      return;
    }
    if (receipt.isConfirmed) {
      toast.info("Receipt already confirmed");
      return;
    }

    try {
      await confirmRentPayment(dispatch, receipt._id, {
        confirmedBy: currentUser?._id || currentUser?.id || null,
      });
      toast.success("Receipt confirmed");
      await loadData(safeCurrentPage, appliedFilters);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to confirm receipt");
    }
  };

  const handleConfirmSelected = async () => {
    if (selectedIds.length === 0) {
      toast.warning("Select receipt(s) to confirm");
      return;
    }

    try {
      const toConfirm = selectedIds.filter((id) => {
        const receipt = receipts.find((item) => item._id === id);
        return receipt && !receipt.isConfirmed;
      });
      await Promise.all(
        toConfirm.map((receiptId) =>
          confirmRentPayment(dispatch, receiptId, { confirmedBy: currentUser?._id || currentUser?.id || null })
        )
      );
      toast.success("Selected receipts confirmed");
      setSelectedIds([]);
      await loadData(safeCurrentPage, appliedFilters);
    } catch {
      toast.error("Failed to confirm selected receipts");
    }
  };

  const handleUnconfirmOne = async (receipt) => {
    if (!canProcessReceipt) {
      toast.warning("You do not have permission to unconfirm receipts");
      return;
    }
    if (!receipt.isConfirmed) {
      toast.info("Receipt is not confirmed. Cannot unconfirm an unconfirmed receipt.");
      return;
    }

    try {
      await unconfirmRentPayment(dispatch, receipt._id);
      toast.success("Receipt unconfirmed.");
      await loadData(safeCurrentPage, appliedFilters);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to unconfirm receipt");
    }
  };

  const toggleSelection = (receiptId) => {
    setSelectedIds((prev) =>
      prev.includes(receiptId) ? prev.filter((id) => id !== receiptId) : [...prev, receiptId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === receipts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(receipts.map((item) => item._id));
    }
  };

  const openView = (receipt) => {
    setActiveReceipt(receipt);
    setShowView(true);
  };

  const openJournalDrawer = (receipt) => {
    const context = {
      transactionNumber: receipt?.receiptNumber || receipt?.referenceNumber || "-",
      date: formatDate(receipt?.paymentDate),
      tenant: getTenantName(receipt, tenants),
      property: getPropertyName(receipt, tenants),
      unit: getUnitName(receipt, tenants),
      cashbook: receipt?.cashbook || "Main Cashbook",
    };
    setJournalContext(context);
    setJournalLines(buildJournalEntriesForReceipt(receipt));
    setJournalDrawerOpen(true);
  };


  const handlePrintReceipt = (receipt) => {
    const tenantName = getTenantName(receipt, tenants);
    const unitName = getUnitName(receipt, tenants);
    const propertyName = getPropertyName(receipt, tenants);
    const companyName = currentCompany?.companyName || currentCompany?.name || "MILIK";
    const companyEmail = currentCompany?.email || currentCompany?.companyEmail || "";
    const companyPhone = currentCompany?.phoneNo || currentCompany?.phone || currentCompany?.phoneNumber || "";
    const companyAddress = currentCompany?.address || currentCompany?.location || currentCompany?.postalAddress || "";
    const companyTown = currentCompany?.town || currentCompany?.city || "";
    const companyLogo = currentCompany?.logo || "";

    const amount = Math.abs(Number(receipt?.amount || 0));
    const allocationSummary = receipt?.allocationSummary || {};
    const summaryRows = [
      { label: "Rent", value: Number(allocationSummary.rent || 0) },
      { label: "Utilities", value: Number(allocationSummary.utility || 0) },
      { label: "Deposit", value: Number(allocationSummary.deposit || 0) },
      { label: "Late penalty", value: Number(allocationSummary.latePenalty || 0) },
      { label: "Debit note", value: Number(allocationSummary.debitNote || 0) },
      { label: "Other", value: Number(allocationSummary.other || 0) },
      { label: "Unapplied / prepayment", value: Number(allocationSummary.unapplied || 0) },
    ].filter((row) => row.value > 0);

    const allocationRows = Array.isArray(receipt?.allocations) ? receipt.allocations : [];
    const allocationTable = allocationRows.length > 0
      ? allocationRows
          .map((row, index) => {
            const invoiceRef = row?.invoiceNumber || row?.invoiceRef || row?.description || row?.invoice || `Line ${index + 1}`;
            const category = getAllocationGroupLabel(row?.priorityGroup || row?.chargeType || row?.allocationGroup || "");
            return `
              <tr>
                <td>${escapeHtml(String(index + 1))}</td>
                <td>${escapeHtml(String(invoiceRef || "-"))}</td>
                <td>${escapeHtml(String(category || "-"))}</td>
                <td style="text-align:right;">KES ${Math.abs(Number(row?.appliedAmount || 0)).toLocaleString()}</td>
              </tr>
            `;
          })
          .join("")
      : `
          <tr>
            <td>1</td>
            <td colspan="2">Receipt captured without explicit allocation lines</td>
            <td style="text-align:right;">KES ${amount.toLocaleString()}</td>
          </tr>
        `;

    const breakdownHtml = summaryRows.length > 0
      ? summaryRows
          .map(
            (row) => `
              <div class="mini-row">
                <span>${escapeHtml(row.label)}</span>
                <strong>KES ${Math.abs(Number(row.value || 0)).toLocaleString()}</strong>
              </div>
            `
          )
          .join("")
      : `
          <div class="mini-row">
            <span>Total receipt amount</span>
            <strong>KES ${amount.toLocaleString()}</strong>
          </div>
        `;

    const preparedByName = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || 'Milik Admin';
    const preparedLabel = new Date().toLocaleString();
    const formatAmt = (n) => Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const statusColor = receipt.isConfirmed ? '#16a34a' : '#d97706';
    const statusBgColor = receipt.isConfirmed ? '#dcfce7' : '#fef3c7';
    const logoBlock = companyLogo
      ? `<img style="max-height:60px;max-width:150px;object-fit:contain;border-radius:6px;" src="${escapeHtml(companyLogo)}" alt="logo" />`
      : `<div style="width:56px;height:56px;border-radius:10px;background:#0B3B2E;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;">${escapeHtml(String(companyName || "M").slice(0,1).toUpperCase())}</div>`;

    const printWindow = window.open("", "_blank", "width=980,height=760");
    if (!printWindow) return;

    printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt ${escapeHtml(receipt.receiptNumber || receipt.referenceNumber || "")}</title>
  <style>
    @page { size: A4; margin: 14mm 16mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #0f172a; background: #fff; }
    .header { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; padding-bottom:16px; gap:16px; }
    .co-center { text-align:center; display:flex; flex-direction:column; align-items:center; gap:6px; }
    .co-center-name { font-size:18px; font-weight:900; color:#0f172a; letter-spacing:-0.01em; margin-top:6px; }
    .co-center-sub { font-size:10px; color:#64748b; line-height:1.6; }
    .rcpt-title { text-align:right; align-self:center; }
    .rcpt-label { font-size:38px; font-weight:900; color:#0f172a; letter-spacing:-0.03em; line-height:1; }
    .rcpt-number { font-size:14px; color:#64748b; margin-top:6px; }
    .divider { height:2px; background:linear-gradient(90deg,#3b82f6,#93c5fd); border-radius:2px; margin:16px 0 20px; }
    .body-grid { display:grid; grid-template-columns:1fr 1fr; gap:28px; margin-bottom:20px; }
    .sec-label { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:0.18em; color:#94a3b8; margin-bottom:12px; }
    .fk { font-size:10px; color:#94a3b8; font-weight:600; text-transform:uppercase; letter-spacing:0.1em; margin-top:8px; }
    .fv { font-size:13px; font-weight:700; color:#0f172a; }
    .fv.lg { font-size:16px; font-weight:800; }
    .status-badge { display:inline-block; padding:4px 14px; border-radius:6px; font-size:11px; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:18px; }
    table { width:100%; border-collapse:collapse; margin-bottom:16px; }
    thead tr { background:#1e293b; }
    th { padding:10px 14px; text-align:left; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#fff; }
    th.r { text-align:right; }
    tbody tr { border-bottom:1px solid #f1f5f9; }
    td { padding:11px 14px; font-size:13px; color:#0f172a; }
    td.r { text-align:right; font-weight:600; }
    .totals { width:280px; margin-left:auto; border-top:1px solid #e2e8f0; padding-top:10px; }
    .t-row { display:flex; justify-content:space-between; padding:7px 0; font-size:13px; border-bottom:1px solid #f8fafc; }
    .t-row .tl { color:#64748b; }
    .t-row .tv { font-weight:700; }
    .t-row.grand { border-top:2px solid #0f172a; border-bottom:none; padding-top:12px; margin-top:4px; }
    .t-row.grand .tl, .t-row.grand .tv { font-size:15px; font-weight:800; color:#0f172a; }
    .footer-note { margin-top:28px; padding-top:12px; border-top:1px solid #f1f5f9; font-size:11px; color:#94a3b8; }
    @media print {
      thead tr { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div></div>
    <div class="co-center">
      ${logoBlock}
      <div class="co-center-name">${escapeHtml(companyName)}</div>
      ${[companyAddress, companyTown, companyPhone, companyEmail].filter(Boolean).length ? `<div class="co-center-sub">${[companyAddress, companyTown, companyPhone, companyEmail].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
    </div>
    <div class="rcpt-title">
      <div class="rcpt-label">RECEIPT</div>
      <div class="rcpt-number"># ${escapeHtml(receipt.receiptNumber || receipt.referenceNumber || '-')}</div>
    </div>
  </div>

  <div class="divider"></div>

  <div class="body-grid">
    <div>
      <div class="sec-label">Received From</div>
      <div class="fk">Tenant</div>
      <div class="fv lg">${escapeHtml(tenantName)}</div>
      <div class="fk">Property</div>
      <div class="fv">${escapeHtml(propertyName)}</div>
      <div class="fk">Unit</div>
      <div class="fv">${escapeHtml(unitName)}</div>
    </div>
    <div>
      <div class="sec-label">Receipt Details</div>
      <div class="fk">Receipt Date</div>
      <div class="fv">${escapeHtml(formatDate(receipt.paymentDate))}</div>
      <div class="fk">Payment Method</div>
      <div class="fv">${escapeHtml(String(receipt.paymentMethod || '-').replaceAll('_', ' '))}</div>
      <div class="fk">Reference</div>
      <div class="fv">${escapeHtml(receipt.referenceNumber || '-')}</div>
      <div class="fk">Cashbook</div>
      <div class="fv">${escapeHtml(getCashbookLabel(receipt))}</div>
    </div>
  </div>

  <span class="status-badge" style="background:${statusBgColor};color:${statusColor};">${receipt.isConfirmed ? 'Confirmed' : 'Pending Confirmation'}</span>

  <table>
    <thead>
      <tr>
        <th style="width:40px;">#</th>
        <th>Reference</th>
        <th>Category</th>
        <th class="r">Applied Amount (KES)</th>
      </tr>
    </thead>
    <tbody>
      ${allocationTable}
    </tbody>
  </table>

  <div class="totals">
    ${summaryRows.map((row) => `<div class="t-row"><span class="tl">${escapeHtml(row.label)}</span><span class="tv">KES ${formatAmt(row.value)}</span></div>`).join('')}
    <div class="t-row grand"><span class="tl">Total Received</span><span class="tv">KES ${formatAmt(amount)}</span></div>
  </div>

  ${receipt?.description ? `<div style="margin-top:16px;padding:10px 14px;background:#f8fafc;border-left:3px solid #3b82f6;border-radius:4px;font-size:12px;color:#334155;line-height:1.6;">${escapeHtml(receipt.description)}</div>` : ''}

  <div class="footer-note">
    This is an official receipt confirming payment received by ${escapeHtml(companyName)}.<br/>
    Generated by ${escapeHtml(companyName)} · Milik Property Management System · ${escapeHtml(preparedLabel)} · Prepared by ${escapeHtml(preparedByName)}
  </div>
</body>
</html>`);
    printWindow.document.close();
    setTimeout(() => { printWindow.focus(); printWindow.print(); }, 450);
  };

  const syncActiveReceipt = useCallback((updatedReceipt) => {
    if (!updatedReceipt?._id) return;
    setActiveReceipt((prev) => (prev && prev._id === updatedReceipt._id ? updatedReceipt : prev));
  }, []);

  const closeAllocationDrawer = useCallback(() => {
    setAllocationDrawerOpen(false);
    setAllocationTarget(null);
    setAllocationOptions([]);
    setAllocationLines([]);
    setAllocationSearchTerms({});
    setAllocationDropdownOpen({});
    setAllocationDropdownPos({});
    setAllocationReason("");
    setAllocationRules({
      appendOnlyUnappliedForConfirmed: false,
      lockedUnappliedForConfirmed: false,
      lockedAllocatedTotal: 0,
      currentUnapplied: 0,
    });
    setAllocationPrepaymentTypes([{ billItemKey: "rent", label: "Rent Prepayment" }]);
    setPrepaymentWorkspaceLines([]);
    setAllocationAdminOverride(false);
    setCanAdminOverride(false);
    setAllocationLoading(false);
    setAllocationSaving(false);
  }, []);

  const openAllocationDrawer = useCallback(async (receipt, { adminOverride = false } = {}) => {
    if (!receipt?._id) return;
    setAllocationDrawerOpen(true);
    setAllocationTarget(receipt);
    setAllocationAdminOverride(adminOverride);
    setAllocationLoading(true);
    try {
      const workspace = await getReceiptAllocationOptions(receipt._id, { adminOverride });
      const options = Array.isArray(workspace?.invoiceOptions) ? workspace.invoiceOptions : [];
      const currentAllocations = Array.isArray(workspace?.currentAllocations) ? workspace.currentAllocations : [];
      setAllocationOptions(options);
      setAllocationPrepaymentTypes(
        Array.isArray(workspace?.prepaymentTypeOptions) && workspace.prepaymentTypeOptions.length > 0
          ? workspace.prepaymentTypeOptions
          : [{ billItemKey: "rent", label: "Rent Prepayment" }]
      );
      setCanAdminOverride(workspace?.canAdminOverride === true);
      setAllocationRules(workspace?.rules || {
        appendOnlyUnappliedForConfirmed: false,
        lockedUnappliedForConfirmed: false,
        lockedAllocatedTotal: 0,
        currentUnapplied: 0,
      });

      // Invoice allocation lines (rows with a real invoice)
      const invoiceRows = currentAllocations.filter((r) => r?.invoice || r?.invoiceId);
      setAllocationLines(
        invoiceRows.length > 0
          ? invoiceRows.map((row) => ({
              invoiceId: String(row?.invoice || row?.invoiceId || ""),
              appliedAmount: Number(row?.appliedAmount || 0),
              invoiceNumber: row?.invoiceNumber || "",
              priorityGroup: row?.priorityGroup || row?.category || "",
              utilityType: row?.utilityType || "",
              description: row?.description || "",
            }))
          : [{ invoiceId: "", appliedAmount: 0, invoiceNumber: "", priorityGroup: "", utilityType: "", description: "" }]
      );

      // Prepayment lines — seed from existing labeled prepayment rows on the receipt
      const existingPrepayRows = Array.isArray(workspace?.currentPrepaymentAllocations) ? workspace.currentPrepaymentAllocations : [];
      setPrepaymentWorkspaceLines(
        existingPrepayRows.length > 0
          ? existingPrepayRows.map((r) => ({
              billItemKey: r.billItemKey || "rent",
              label: r.prepaymentLabel || r.description || "Rent Prepayment",
              amount: Number(r.appliedAmount || 0),
            }))
          : []
      );

      setAllocationSearchTerms({});
      setAllocationDropdownOpen({});
      setAllocationReason("");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to open allocation workspace");
      closeAllocationDrawer();
    } finally {
      setAllocationLoading(false);
    }
  }, [closeAllocationDrawer]);

  const selectedAllocationOptionIds = useMemo(
    () => allocationLines.map((line) => String(line?.invoiceId || "")).filter(Boolean),
    [allocationLines]
  );

  useEffect(() => {
    if (!requestedReceiptId || allocationDrawerOpen || autoOpenedReceiptId === requestedReceiptId) return;
    const requestedReceipt = receipts.find((payment) => String(payment?._id || "") === requestedReceiptId);
    if (!requestedReceipt) return;
    setAutoOpenedReceiptId(requestedReceiptId);
    setActiveReceipt(requestedReceipt);
    openAllocationDrawer(requestedReceipt);
  }, [requestedReceiptId, allocationDrawerOpen, autoOpenedReceiptId, receipts, openAllocationDrawer]);

  const allocationOptionMap = useMemo(
    () => new Map((allocationOptions || []).map((option) => [String(option.invoiceId || ""), option])),
    [allocationOptions]
  );

  const getFilteredAllocationOptions = useCallback(
    (term = "", currentInvoiceId = "") => {
      const normalizedTerm = String(term || "").trim().toLowerCase();
      const currentId = String(currentInvoiceId || "");

      return (allocationOptions || []).filter((invoice) => {
        const invoiceId = String(invoice?.invoiceId || "");
        if (!invoiceId) return false;

        const takenElsewhere =
          selectedAllocationOptionIds.includes(invoiceId) && invoiceId !== currentId;
        if (takenElsewhere) return false;

        const maxAllocatable = Number(invoice?.maxAllocatable || 0);
        const currentAllocation = Number(invoice?.currentAllocation || 0);
        if (maxAllocatable <= 0 && currentAllocation <= 0) return false;

        if (!normalizedTerm) return true;

        const haystack = [
          invoice?.invoiceNumber,
          invoice?.description,
          invoice?.invoiceId,
          invoice?.priorityGroup,
          invoice?.chargeType,
          invoice?.category,
          invoice?.utilityType,
          invoice?.period,
          getAllocationGroupLabel(invoice?.priorityGroup || invoice?.chargeType || getInvoiceChargeType(invoice)),
          getInvoiceOptionLabel(invoice),
          getAllocationOptionLabel(invoice),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return normalizedTerm
          .split(/\s+/)
          .filter(Boolean)
          .every((token) => haystack.includes(token));
      });
    },
    [allocationOptions, selectedAllocationOptionIds]
  );

  const isAppendOnlyAllocationMode = allocationRules?.appendOnlyUnappliedForConfirmed === true;

  const allocationComputed = useMemo(() => {
    const rows = allocationLines
      .map((line, index) => {
        const option = allocationOptionMap.get(String(line?.invoiceId || ""));
        const amount = Number(line?.appliedAmount || 0);
        return {
          index,
          invoiceId: String(line?.invoiceId || ""),
          appliedAmount: Number.isFinite(amount) ? amount : 0,
          option: option || null,
          lockedFloor: Math.max(0, Number(option?.currentAllocation || 0)),
        };
      })
      .filter((row) => row.invoiceId && row.appliedAmount > 0);

    const totalAllocated = rows.reduce((sum, row) => sum + Number(row.appliedAmount || 0), 0);
    const receiptAmount = Math.abs(Number(allocationTarget?.amount || 0));
    const lockedBaseTotal = isAppendOnlyAllocationMode
      ? Number(allocationRules?.lockedAllocatedTotal || 0)
      : 0;
    const editableCap = isAppendOnlyAllocationMode
      ? Number(allocationRules?.currentUnapplied || 0)
      : allocationRules?.lockedUnappliedForConfirmed
      ? Number(allocationRules?.lockedAllocatedTotal || 0)
      : receiptAmount;
    const totalAdded = isAppendOnlyAllocationMode
      ? Math.max(0, totalAllocated - lockedBaseTotal)
      : totalAllocated;

    return {
      rows,
      receiptAmount,
      totalAllocated,
      lockedBaseTotal,
      totalAdded,
      editableCap,
      remaining: Math.max(0, editableCap - totalAdded),
    };
  }, [allocationLines, allocationOptionMap, allocationTarget, allocationRules, isAppendOnlyAllocationMode]);

  const addAllocationLine = useCallback(() => {
    setAllocationLines((prev) => [...prev, { invoiceId: "", appliedAmount: 0 }]);
  }, []);

  const removeAllocationLine = useCallback((index) => {
    setAllocationLines((prev) => {
      const currentLine = prev[index] || {};
      const currentOption = allocationOptionMap.get(String(currentLine?.invoiceId || ""));
      const lockedFloor = Math.max(0, Number(currentOption?.currentAllocation || 0));
      if (isAppendOnlyAllocationMode && lockedFloor > 0) {
        toast.error("Already applied lines on a confirmed receipt are locked. Only the remaining unapplied balance can be added from this workspace.");
        return prev;
      }
      const next = prev.filter((_, currentIndex) => currentIndex !== index);
      setAllocationSearchTerms((searchPrev) => {
        const cleaned = {};
        next.forEach((_, nextIndex) => {
          const previousIndex = nextIndex >= index ? nextIndex + 1 : nextIndex;
          if (searchPrev[previousIndex] !== undefined) cleaned[nextIndex] = searchPrev[previousIndex];
        });
        return cleaned;
      });
      setAllocationDropdownOpen((openPrev) => {
        const cleaned = {};
        next.forEach((_, nextIndex) => {
          const previousIndex = nextIndex >= index ? nextIndex + 1 : nextIndex;
          if (openPrev[previousIndex]) cleaned[nextIndex] = openPrev[previousIndex];
        });
        return cleaned;
      });
      return next.length > 0 ? next : [{ invoiceId: "", appliedAmount: 0 }];
    });
  }, [allocationOptionMap, isAppendOnlyAllocationMode]);

  const updateAllocationLine = useCallback((index, key, value) => {
    setAllocationLines((prev) =>
      prev.map((line, currentIndex) => {
        if (currentIndex !== index) return line;
        if (key === "invoiceId") {
          const currentOption = allocationOptionMap.get(String(line?.invoiceId || ""));
          const lockedFloor = Math.max(0, Number(currentOption?.currentAllocation || 0));
          if (isAppendOnlyAllocationMode && lockedFloor > 0) {
            return line;
          }
          const option = allocationOptionMap.get(String(value || ""));
          const suggestedAmount = option
            ? Math.min(Number(option.currentAllocation || 0) || Number(option.maxAllocatable || 0) || 0, Number(option.maxAllocatable || 0) || 0)
            : 0;
          return {
            ...line,
            invoiceId: String(value || ""),
            appliedAmount: option ? suggestedAmount : 0,
          };
        }
        const currentOption = allocationOptionMap.get(String(line?.invoiceId || ""));
        const lockedFloor = isAppendOnlyAllocationMode ? Math.max(0, Number(currentOption?.currentAllocation || 0)) : 0;
        const numericValue = Math.max(lockedFloor, Number(value || 0));
        return {
          ...line,
          [key]: Number.isFinite(numericValue) ? numericValue : lockedFloor,
        };
      })
    );
  }, [allocationOptionMap, isAppendOnlyAllocationMode]);

  const handleMoveToPrepayment = useCallback(() => {
    if (isAppendOnlyAllocationMode) {
      toast.error("This confirmed receipt is in append-only mode. Its existing allocations stay locked, and only the remaining unapplied balance can be applied to open bills.");
      return;
    }

    if (allocationRules?.lockedUnappliedForConfirmed && Number(allocationRules?.lockedAllocatedTotal || 0) > 0) {
      toast.error("This posted receipt cannot move its locked allocated amount into prepayment from this workspace.");
      return;
    }

    setAllocationLines([{ invoiceId: "", appliedAmount: 0 }]);
    setAllocationReason((prev) => prev || "Moved receipt allocation to prepayment / unapplied balance.");
    toast.info("Receipt is now staged as unapplied / prepayment. Click Save Allocation to confirm.");
  }, [allocationRules, isAppendOnlyAllocationMode]);

  const handleAutoAllocate = useCallback(() => {
    const ordered = [...allocationOptions].sort((a, b) => {
      const aDue = a?.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b?.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      const aInvoice = a?.invoiceDate ? new Date(a.invoiceDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bInvoice = b?.invoiceDate ? new Date(b.invoiceDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (aInvoice !== bInvoice) return aInvoice - bInvoice;
      return String(a?.invoiceNumber || "").localeCompare(String(b?.invoiceNumber || ""));
    });

    if (isAppendOnlyAllocationMode) {
      let remaining = Math.max(0, Number(allocationRules?.currentUnapplied || 0));
      const nextMap = new Map();

      ordered.forEach((option) => {
        const invoiceId = String(option?.invoiceId || "");
        if (!invoiceId) return;
        const currentAllocation = Math.max(0, Number(option?.currentAllocation || 0));
        if (currentAllocation > 0) {
          nextMap.set(invoiceId, {
            invoiceId,
            appliedAmount: currentAllocation,
          });
        }
      });

      ordered.forEach((option) => {
        if (remaining <= 0) return;
        const invoiceId = String(option?.invoiceId || "");
        if (!invoiceId) return;
        const currentAllocation = Math.max(0, Number(option?.currentAllocation || 0));
        const maxAllocatable = Math.max(0, Number(option?.maxAllocatable || 0));
        const availableExtra = Math.max(0, maxAllocatable - currentAllocation);
        if (availableExtra <= 0) return;
        const extraApplied = Math.min(availableExtra, remaining);
        if (extraApplied <= 0) return;
        nextMap.set(invoiceId, {
          invoiceId,
          appliedAmount: currentAllocation + extraApplied,
        });
        remaining -= extraApplied;
      });

      const nextLines = ordered
        .map((option) => nextMap.get(String(option?.invoiceId || "")))
        .filter((line) => line && Number(line.appliedAmount || 0) > 0);

      setAllocationLines(nextLines.length > 0 ? nextLines : [{ invoiceId: "", appliedAmount: 0 }]);
      return;
    }

    let remaining = Math.max(0, Math.abs(Number(allocationTarget?.amount || 0)));
    const nextLines = [];
    ordered.forEach((option) => {
      if (remaining <= 0) return;
      const maxAllocatable = Math.max(0, Number(option?.maxAllocatable || 0));
      if (maxAllocatable <= 0) return;
      const appliedAmount = Math.min(maxAllocatable, remaining);
      if (appliedAmount <= 0) return;
      nextLines.push({
        invoiceId: String(option.invoiceId || ""),
        appliedAmount,
      });
      remaining -= appliedAmount;
    });

    setAllocationLines(nextLines.length > 0 ? nextLines : [{ invoiceId: "", appliedAmount: 0 }]);
  }, [allocationOptions, allocationRules, allocationTarget, isAppendOnlyAllocationMode]);

  const handleSaveAllocations = useCallback(async () => {
    if (!allocationTarget?._id) return;

    const merged = new Map();
    allocationLines.forEach((line) => {
      const invoiceId = String(line?.invoiceId || "").trim();
      const amount = Math.max(0, Number(line?.appliedAmount || 0));
      if (!invoiceId || amount <= 0) return;
      merged.set(invoiceId, Number(merged.get(invoiceId) || 0) + amount);
    });

    const payloadRows = Array.from(merged.entries()).map(([invoiceId, appliedAmount]) => ({
      invoiceId,
      appliedAmount,
    }));

    if (payloadRows.length === 0 && Number(allocationRules?.lockedAllocatedTotal || 0) > 0) {
      toast.error("Allocate the locked receipt amount before saving.");
      return;
    }

    // Validate prepayment lines total equals remaining
    const r2 = (n) => Math.round(Number(n) * 100) / 100;
    const remaining = r2(Math.max(0, allocationComputed.editableCap - allocationComputed.totalAdded));
    const cleanedPrepayLines = prepaymentWorkspaceLines
      .filter((l) => l.billItemKey && Number(l.amount) > 0)
      .map((l) => ({ billItemKey: l.billItemKey, label: l.label, amount: r2(l.amount) }));
    const prepayTotal = r2(cleanedPrepayLines.reduce((s, l) => s + l.amount, 0));
    if (remaining > 0.005 && cleanedPrepayLines.length > 0 && Math.abs(prepayTotal - remaining) > 0.01) {
      toast.error(`Prepayment labels total KES ${prepayTotal.toLocaleString()} but remaining is KES ${remaining.toLocaleString()}. Adjust amounts to match.`);
      return;
    }

    setAllocationSaving(true);
    try {
      const updated = await updateReceiptAllocations(dispatch, allocationTarget._id, {
        allocations: payloadRows,
        prepaymentLines: cleanedPrepayLines,
        reason: allocationReason,
        ...(allocationAdminOverride ? { adminOverride: true } : {}),
      });
      toast.success("Receipt allocations updated");
      syncActiveReceipt(updated);
      setAllocationTarget(updated);
      await loadData(safeCurrentPage, appliedFilters);
      closeAllocationDrawer();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update receipt allocations");
    } finally {
      setAllocationSaving(false);
    }
  }, [allocationLines, allocationReason, allocationRules, allocationTarget, allocationComputed, prepaymentWorkspaceLines, closeAllocationDrawer, dispatch, loadData, syncActiveReceipt]);

  const handleDownloadReceiptPdf = async (receipt) => {
    if (!canExportReceipt) { toast.warning("You do not have permission to download receipts"); return; }
    if (!receipt?._id) return;
    try {
      await downloadReceiptPdf(receipt._id, {
        preview: false,
        filename: `Receipt-${receipt.receiptNumber || receipt.referenceNumber || receipt._id}.pdf`,
      });
    } catch {
      toast.error("Failed to download receipt PDF.");
    }
  };

  const handlePrintList = () => {
    if (!canExportReceipt) {
      toast.warning("You do not have permission to print receipt lists");
      return;
    }
    const totalAmt = receipts.reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    printTabularList({
      title: "Receipts Register",
      subtitle: `${receipts.length} record${receipts.length !== 1 ? "s" : ""} · Total KES ${totalAmt.toLocaleString()}`,
      company: currentCompany,
      columns: [
        { label: "#", key: "_idx", value: (_, i) => i + 1 },
        { label: "Receipt #", key: "receiptNumber" },
        { label: "Date", key: "paymentDate", value: (r) => formatDate(r.paymentDate) },
        { label: "Tenant", key: "_tenant", value: (r) => getTenantName(r, tenants) },
        { label: "Property", key: "_property", value: (r) => getPropertyName(r, tenants) },
        { label: "Unit", key: "_unit", value: (r) => getUnitName(r, tenants) },
        { label: "Reference", key: "referenceNumber" },
        { label: "Method", key: "paymentMethod", value: (r) => String(r.paymentMethod || "-").replaceAll("_", " ") },
        { label: "Amount (KES)", key: "amount", align: "right", value: (r) => Math.abs(Number(r.amount || 0)).toLocaleString() },
        { label: "Status", key: "_status", value: (r) => (r.isConfirmed ? "Confirmed" : "Pending") },
      ],
      rows: receipts,
    });
  };

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyHeight = document.body.style.height;
    const previousDocumentOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.body.style.height = "100vh";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.height = previousBodyHeight;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, []);

  useEffect(() => {
    const handleAllocationDropdownOutsideClick = () => {
      setAllocationDropdownOpen({});
    };

    window.addEventListener("click", handleAllocationDropdownOutsideClick);
    return () => window.removeEventListener("click", handleAllocationDropdownOutsideClick);
  }, []);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
          <div className="flex-none sticky top-0 z-30 mb-2 border-b border-slate-200 bg-white shadow-sm">
            <div className="filter-bar flex items-center gap-1 overflow-x-auto px-2 py-1.5">
              {fromLedger && (
                <button onClick={() => navigate(`/properties/${location.state.propertyId}/ledger`)} className="h-7 shrink-0 flex items-center gap-1 rounded px-2 text-xs font-semibold text-[#0B3B2E] hover:bg-[#EDF5F1]">
                  <FaArrowLeft size={11} /> {location.state.propertyName} Ledger
                </button>
              )}
              <span className="shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[9px] font-bold text-slate-700">{stats.count} Receipts</span>
              <span className="shrink-0 rounded border border-green-300 bg-green-50 px-1.5 py-0.5 text-[9px] font-bold text-green-700">Ksh {stats.total.toLocaleString()}</span>
              <span className="shrink-0 rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">{stats.confirmedCount} Conf.</span>
              <span className="shrink-0 rounded border border-orange-300 bg-orange-50 px-1.5 py-0.5 text-[9px] font-bold text-orange-700">{stats.pendingCount} Pend.</span>
              <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />
              <input value={draftFilters.tenantSearch} onChange={(e) => setDraftFilters((prev) => ({ ...prev, tenantSearch: normalizeUppercaseInput(e.target.value) }))} placeholder="Tenant" className="h-7 w-20 shrink-0 rounded border border-slate-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              <AppSelect
                value={draftFilters.property}
                onChange={(v) => setDraftFilters((prev) => ({ ...prev, property: v ?? "all", unit: "" }))}
                options={propertyOptions.filter((p) => p !== "all").map((p) => ({ value: p, label: p }))}
                placeholder="Property"
                searchable
                clearable
                size="sm"
              />
              <input
                value={draftFilters.unit}
                onChange={(e) => setDraftFilters((prev) => ({ ...prev, unit: e.target.value || "" }))}
                placeholder="Unit"
                className="h-7 w-16 shrink-0 rounded border border-slate-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
              />
              <AppSelect
                value={draftFilters.ledger}
                onChange={(v) => setDraftFilters((prev) => ({ ...prev, ledger: v ?? "all" }))}
                options={[{ value: "receipts", label: "Receipts" }, { value: "cashbook", label: "Cashbook" }]}
                placeholder="Ledger"
                clearable
                size="sm"
              />
              <AppSelect
                value={draftFilters.status}
                onChange={(v) => setDraftFilters((prev) => ({ ...prev, status: v ?? "active" }))}
                options={[
                  { value: "active", label: "Active" },
                  { value: "confirmed", label: "Confirmed" },
                  { value: "pending", label: "Pending" },
                  { value: "reversed", label: "Reversed" },
                  { value: "all", label: "All" },
                ]}
                size="sm"
              />
              <AppSelect
                value={draftFilters.paymentType}
                onChange={(v) => setDraftFilters((prev) => ({ ...prev, paymentType: v ?? "all" }))}
                options={[
                  { value: "rent", label: "Rent" },
                  { value: "deposit", label: "Deposit" },
                  { value: "utility", label: "Utility" },
                  { value: "late_fee", label: "Late Fee" },
                  { value: "other", label: "Other" },
                ]}
                placeholder="Type"
                clearable
                size="sm"
              />
              <input type="date" value={draftFilters.from} onChange={setFilter("from")} className="h-7 w-[7.5rem] shrink-0 rounded border border-slate-200 bg-white px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              <input type="date" value={draftFilters.to} onChange={setFilter("to")} className="h-7 w-[7.5rem] shrink-0 rounded border border-slate-200 bg-white px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />
              <AppSelect
                value=""
                onChange={(v) => { if (v) applyDatePresetAndSearch(v); }}
                options={[
                  { value: "today", label: "Today" },
                  { value: "yesterday", label: "Yesterday" },
                  { value: "thisWeek", label: "This Week" },
                  { value: "lastWeek", label: "Last Week" },
                  { value: "thisMonth", label: "This Month" },
                  { value: "lastMonth", label: "Last Month" },
                  { value: "thisQuarter", label: "This Quarter" },
                  { value: "lastQuarter", label: "Last Quarter" },
                  { value: "thisYear", label: "This Year" },
                  { value: "lastYear", label: "Last Year" },
                ]}
                placeholder="Period"
                size="sm"
              />
              <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />
              <button onClick={applySearchFilters} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2 text-xs font-semibold text-white ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaSearch size={10} /></button>
              <button onClick={resetSearchFilters} className="h-7 shrink-0 flex items-center gap-1 rounded bg-slate-500 px-2 text-xs font-semibold text-white hover:bg-slate-600"><FaRedoAlt size={10} /></button>
              <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />
              <AppSelect
                value=""
                disabled={selectedIds.length === 0}
                onChange={(v) => {
                  if (v === "confirm") handleConfirmSelected();
                  else if (v === "reverse") handleReverseSelected();
                  else if (v === "delete") handleDeleteSelected();
                }}
                options={[
                  ...(canProcessReceipt ? [{ value: "confirm", label: "Confirm selected" }] : []),
                  ...(canReverseReceipt ? [{ value: "reverse", label: "Reverse selected" }] : []),
                  ...(canDeleteReceipt ? [{ value: "delete", label: "Delete selected" }] : []),
                ]}
                placeholder="Actions"
                size="sm"
              />
              {canExportReceipt && <button onClick={handlePrintList} title="Print list" className="h-7 shrink-0 flex items-center rounded bg-indigo-600 px-2 text-xs text-white hover:bg-indigo-700"><FaPrint size={10} /></button>}
              <button onClick={() => setShowSmsModal(true)} disabled={selectedIds.length === 0} title={selectedIds.length > 0 ? `SMS ${selectedIds.length} receipt${selectedIds.length !== 1 ? "s" : ""}` : "Select receipts to SMS"} className="h-7 shrink-0 flex items-center rounded bg-teal-600 px-2 text-xs text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"><FaSms size={10} /></button>
              <button onClick={() => setShowEmailModal(true)} disabled={selectedIds.length === 0} title={selectedIds.length > 0 ? `Email ${selectedIds.length} receipt${selectedIds.length !== 1 ? "s" : ""}` : "Select receipts to email"} className="h-7 shrink-0 flex items-center rounded bg-blue-600 px-2 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><FaEnvelope size={10} /></button>
              {canCreateReceipt && !isLandlordReceiptView && (
                <button onClick={() => navigate("/receipts/batch")} title="Batch Receipt Entry" className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#0B3B2E] px-2 text-xs text-white hover:bg-[#0d4a38]">
                  <FaListAlt size={10} /> Batch
                </button>
              )}
              {canCreateReceipt && <button onClick={openCreateForm} title={pageCreateLabel} className={`h-7 shrink-0 flex items-center rounded px-2 text-xs text-white ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}><FaPlus size={10} /></button>}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              <table className="w-full min-w-[1200px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className={`${MILIK_GREEN} text-white`}>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">
                      <input
                        type="checkbox"
                        checked={currentPageReceipts.length > 0 && visibleReceiptIds.every((id) => selectedIds.includes(id))}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Receipt #</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Date</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Tenant</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Unit</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Cashbook</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Method</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Done By</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Reversed By</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Reference</th>
                    <th className="px-3 py-1 text-center font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.length === 0 ? (
                    <tr>
                      <td colSpan="14" className="px-3 py-10 text-center text-slate-500">
                        No receipts found.
                      </td>
                    </tr>
                  ) : (
                    currentPageReceipts.map((receipt, index) => {
                      const isSelected = selectedIds.includes(receipt._id);
                      return (
                        <tr
                          key={receipt._id}
                          className={`cursor-pointer border-b border-gray-100 transition-colors ${
                            isSelected
                              ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E] hover:bg-emerald-50"
                              : index % 2 === 0
                              ? "bg-white hover:bg-blue-50/40"
                              : "bg-slate-50/60 hover:bg-blue-50/40"
                          }`}
                          onClick={() => toggleSelection(receipt._id)}
                        >
                          <td className="px-3 py-1 text-center border-r border-gray-100">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelection(receipt._id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <button
                              type="button"
                              className="font-bold text-blue-700 hover:text-blue-900 hover:underline focus:outline-none"
                              onClick={(e) => { e.stopPropagation(); openView(receipt); }}
                            >
                              {receipt.receiptNumber || "-"}
                            </button>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{formatDate(receipt.paymentDate)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{getTenantName(receipt, tenants)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{getPropertyName(receipt, tenants)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{getUnitName(receipt, tenants)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{getCashbookLabel(receipt)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900 capitalize">{(receipt.paymentMethod || "-").replace("_", " ")}</td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-slate-900">
                            Ksh {Math.abs(Number(receipt.amount || 0)).toLocaleString()}
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                                receipt.isReversed
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : receipt.isConfirmed
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                              }`}>
                              {receipt.isReversed ? "Reversed" : receipt.isConfirmed ? "Confirmed" : "Pending"}
                            </span>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{getActorDisplayName(receipt.confirmedBy)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{getActorDisplayName(receipt.reversedBy)}</td>
                          <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{receipt.referenceNumber || "-"}</td>
                          <td className="px-3 py-1">
                            <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => openView(receipt)} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700" title="View">
                                <FaEye size={11} />
                              </button>
                              {!receipt.isReversed && (
                                <button onClick={() => openAllocationDrawer(receipt)} className="px-2 py-1 rounded bg-[#0B3B2E] hover:bg-[#07271e] text-white" title="Allocate to Invoices">
                                  <FaListAlt size={11} />
                                </button>
                              )}
                              {!receipt.isConfirmed && !receipt.isReversed && (
                                <button onClick={() => openEditForm(receipt)} className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white" title="Edit">
                                  <FaEdit size={11} />
                                </button>
                              )}
                              {!receipt.isConfirmed && (
                                <button onClick={() => handleConfirmOne(receipt)} className="px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white" title="Confirm">
                                  <FaCheck size={11} />
                                </button>
                              )}
                              {receipt.isConfirmed && !receipt.isReversed && (
                                <button onClick={() => handleUnconfirmOne(receipt)} className="px-2 py-1 rounded bg-orange-500 hover:bg-orange-600 text-white" title="Unconfirm">
                                  <FaTimes size={11} />
                                </button>
                              )}
                              {!receipt.reversalOf && (
                                <button onClick={() => handleDeleteOne(receipt._id, receipt)} className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white" title="Delete">
                                  <FaTrash size={11} />
                                </button>
                              )}
                              {receipt.isConfirmed && !receipt.isReversed && (
                                <button onClick={() => handleReverseOne(receipt)} className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white" title="Reverse">
                                  <FaUndo size={11} />
                                </button>
                              )}
                              {receipt.isReversed && canReverseReceipt && (
                                <button onClick={() => handleCancelReversalOpen(receipt)} className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-semibold leading-none" title="Cancel Reversal — restore this receipt">
                                  Undo Rev
                                </button>
                              )}
                              {canExportReceipt && (
                                <button onClick={() => handleDownloadReceiptPdf(receipt)} className="px-2 py-1 rounded bg-slate-600 hover:bg-slate-700 text-white" title="Download PDF">
                                  <FaDownload size={11} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-1 text-xs text-slate-700">
              <p>
                <span className="font-semibold">Showing:</span> {recPagination.totalItems === 0 ? 0 : startIndex + 1}
                {" - "}
                {Math.min(endIndex, recPagination.totalItems)} of {recPagination.totalItems} receipt(s)
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePageChange(safeCurrentPage - 1)}
                  disabled={safeCurrentPage === 1}
                  className="rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 font-semibold text-slate-700">
                  Page {safeCurrentPage} of {totalPages} · {ITEMS_PER_PAGE} per page
                </span>
                <button
                  type="button"
                  onClick={() => handlePageChange(safeCurrentPage + 1)}
                  disabled={safeCurrentPage === totalPages}
                  className="rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
                {activeReceipt ? "Edit Receipt" : "Create Receipt"}
              </h3>
              <button onClick={resetForm} className="text-white/70 transition-colors hover:text-white">
                <FaTimes />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 py-4">
              {formData.tenantId && (
                <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(() => {
                    const { totalOwed, totalPaid, balance } = calculateTenantBalance(formData.tenantId);
                    const receiptAmount = Number(formData.amount) || 0;
                    const newBalance = balance - receiptAmount;

                    return (
                      <>
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                          <p className="text-[10px] font-bold uppercase text-red-700 mb-1">Total Owed</p>
                          <p className="text-xl font-bold text-red-700">Ksh {totalOwed.toLocaleString()}</p>
                        </div>
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <p className="text-[10px] font-bold uppercase text-blue-700 mb-1">Current Balance</p>
                          <p className={`text-xl font-bold ${balance > 0 ? "text-blue-700" : "text-green-700"}`}>
                            Ksh {balance.toLocaleString()}
                          </p>
                        </div>
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                          <p className="text-[10px] font-bold uppercase text-green-700 mb-1">After Receipt</p>
                          <p className={`text-xl font-bold ${newBalance > 0 ? "text-red-700" : "text-green-700"}`}>
                            Ksh {newBalance.toLocaleString()}
                          </p>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {formData.tenantId && (
                <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <h4 className="text-xs font-bold text-slate-700 mb-3">📋 OUTSTANDING INVOICES</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {getOutstandingInvoices(formData.tenantId).length > 0 ? (
                      getOutstandingInvoices(formData.tenantId).map((invoice, idx) => (
                        <div key={idx} className="bg-white border border-slate-200 rounded p-2 text-xs">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-semibold text-slate-900">{invoice.month}</span>
                            <span
                              className={`px-2 py-1 rounded text-[10px] font-bold ${
                                invoice.outstanding > 0
                                  ? "bg-orange-100 text-orange-700"
                                  : "bg-green-100 text-green-700"
                              }`}
                            >
                              {invoice.outstanding === 0 ? "✓ PAID" : "⚠ DUE"}
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-600 mb-1 gap-2">
                            <span className="uppercase">{invoice.chargeType}: Ksh {invoice.billedAmount.toLocaleString()}</span>
                            <span>Paid: Ksh {invoice.paid.toLocaleString()}</span>
                          </div>
                          {invoice.outstanding > 0 && (
                            <div className="w-full bg-slate-200 rounded-full h-1.5">
                              <div
                                className="bg-orange-500 h-1.5 rounded-full transition-all"
                                style={{ width: `${Math.min(100, invoice.billedAmount > 0 ? (invoice.paid / invoice.billedAmount) * 100 : 0)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-slate-500 text-center py-4">No outstanding invoices</p>
                    )}
                  </div>
                </div>
              )}

              {formData.tenantId && formData.amount && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <h4 className="text-xs font-bold text-amber-800 mb-2">💡 BALANCE IMPACT</h4>
                  {(() => {
                    const { balance } = calculateTenantBalance(formData.tenantId);
                    const receiptAmount = Number(formData.amount) || 0;
                    const progressBase = Math.abs(balance);
                    const progress =
                      progressBase > 0
                        ? Math.max(0, Math.min(100, (Math.min(progressBase, receiptAmount) / progressBase) * 100))
                        : 0;

                    return (
                      <>
                        <p className="text-[10px] text-amber-800 mb-2">
                          This receipt of <strong>Ksh {receiptAmount.toLocaleString()}</strong> will reduce the balance by {progress.toFixed(1)}%
                        </p>
                        <div className="w-full bg-slate-300 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-amber-500 to-green-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(100, progress)}%` }}
                          />
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {excessAmount > 0 && !activeReceipt?._id && (
                <div className="mb-4 border border-[#0B3B2E]/30 bg-[#0B3B2E]/5 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] font-black uppercase tracking-wide text-[#0B3B2E]">
                      Prepayment Lines — Ksh {excessAmount.toLocaleString()} excess
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setPrepaymentLines((prev) => [
                          ...prev,
                          { billItemKey: "rent", label: "Rent", amount: 0 },
                        ])
                      }
                      className="text-[10px] font-black uppercase tracking-wide text-[#0B3B2E] hover:underline"
                    >
                      + Add Line
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {prepaymentLines.map((line, i) => {
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <AppSelect
                            value={line.billItemKey}
                            onChange={(v) => {
                              const opt = prepaymentTypeOptions.find((o) => o.billItemKey === (v ?? ""));
                              setPrepaymentLines((prev) =>
                                prev.map((l, idx) =>
                                  idx === i ? { ...l, billItemKey: v ?? "", label: opt?.label || v || "" } : l
                                )
                              );
                            }}
                            options={prepaymentTypeOptions.map((o) => ({ value: o.billItemKey, label: o.label }))}
                            size="sm"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.amount}
                            onChange={(e) =>
                              setPrepaymentLines((prev) =>
                                prev.map((l, idx) =>
                                  idx === i ? { ...l, amount: Number(e.target.value) || 0 } : l
                                )
                              )
                            }
                            className="w-28 border border-slate-300 px-2 py-1.5 text-xs"
                            placeholder="Amount"
                          />
                          {prepaymentLines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setPrepaymentLines((prev) => prev.filter((_, idx) => idx !== i))}
                              className="text-slate-400 hover:text-red-500 text-xs font-bold px-1"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {(() => {
                    const prepayTotal = prepaymentLines.reduce((s, l) => s + Number(l.amount || 0), 0);
                    const remaining = Math.round((excessAmount - prepayTotal) * 100) / 100;
                    const isBalanced = Math.abs(remaining) <= 0.01;
                    return (
                      <p className={`mt-2 text-[10px] font-black uppercase tracking-wide ${isBalanced ? "text-green-700" : "text-red-600"}`}>
                        {isBalanced
                          ? "✓ Fully tagged"
                          : remaining > 0
                          ? `Remaining: Ksh ${remaining.toLocaleString()} untagged`
                          : `Over by: Ksh ${Math.abs(remaining).toLocaleString()}`}
                      </p>
                    );
                  })()}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tenant *</label>
                  <AppSelect
                    value={formData.tenantId}
                    onChange={(v) => setFormData((prev) => ({ ...prev, tenantId: v ?? "" }))}
                    options={tenants
                      .filter((tenant) => {
                        if (String(tenant?._id || "") === String(formData.tenantId)) return true;
                        const s = String(tenant?.status || "active").trim().toLowerCase();
                        return !["terminated", "moved_out", "evicted", "inactive"].includes(s);
                      })
                      .map((tenant) => buildTenantOption(tenant))}
                    placeholder="Select tenant"
                    searchable
                    clearable
                    size="md"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Amount *</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.amount}
                    onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 border border-slate-300 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Payment Type *</label>
                  <AppSelect
                    value={formData.paymentType}
                    onChange={(v) => setFormData((prev) => ({ ...prev, paymentType: v ?? "rent" }))}
                    options={[
                      { value: "rent", label: "Rent" },
                      { value: "deposit", label: "Deposit" },
                      { value: "utility", label: "Utility" },
                      { value: "late_fee", label: "Late Fee" },
                      { value: "other", label: "Other" },
                    ]}
                    size="md"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Payment Method *</label>
                  <AppSelect
                    value={formData.paymentMethod}
                    onChange={(v) => setFormData((prev) => ({ ...prev, paymentMethod: v ?? "mobile_money" }))}
                    options={[
                      { value: "mobile_money", label: "Mobile Money" },
                      { value: "bank_transfer", label: "Bank Transfer" },
                      { value: "cash", label: "Cash" },
                      { value: "check", label: "Check" },
                      { value: "credit_card", label: "Credit Card" },
                    ]}
                    size="md"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                    {isDirectToLandlord ? "Cashbook" : "Cashbook *"}
                  </label>
                  {isDirectToLandlord ? (
                    <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Direct-to-landlord receipts do not hit MILIK-managed cashbooks.
                    </div>
                  ) : (
                    <AppSelect
                      value={formData.cashbook}
                      onChange={(v) => setFormData((prev) => ({ ...prev, cashbook: v ?? "" }))}
                      options={cashbookOptions.map((option) => ({ value: option.name, label: option.code ? `${option.code} · ${option.name}` : option.name }))}
                      size="md"
                    />
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Payment Date *</label>
                  <input
                    type="date"
                    value={formData.paymentDate}
                    onChange={(e) => setFormData((prev) => ({ ...prev, paymentDate: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 border border-slate-300 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Due Date *</label>
                  <input
                    type="date"
                    value={formData.dueDate}
                    onChange={(e) => setFormData((prev) => ({ ...prev, dueDate: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 border border-slate-300 text-sm"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Description</label>
                  <textarea
                    rows={2}
                    value={formData.description}
                    onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 border border-slate-300 text-sm"
                    placeholder="Optional note"
                  />
                </div>

                {!isCompanyLandlordMode && (
                <div className="md:col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="paidDirectToLandlord"
                    checked={formData.paidDirectToLandlord}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        paidDirectToLandlord: e.target.checked,
                        cashbook: e.target.checked ? "" : prev.cashbook,
                      }))
                    }
                  />
                  <label htmlFor="paidDirectToLandlord" className="text-xs font-semibold text-slate-700">
                    Direct to landlord receipt (do not post to MILIK cashbook)
                  </label>
                </div>
                )}

                <div className="md:col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isConfirmed"
                    checked={formData.isConfirmed}
                    onChange={(e) => setFormData((prev) => ({ ...prev, isConfirmed: e.target.checked }))}
                  />
                  <label htmlFor="isConfirmed" className="text-xs font-semibold text-slate-700">
                    Mark as confirmed
                  </label>
                </div>
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                onClick={resetForm}
                className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className={`px-4 py-2 text-xs text-white font-semibold ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
              >
                {activeReceipt ? "Update Receipt" : "Create Receipt"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showView && activeReceipt && (() => {
        const receiptAmount = Math.abs(Number(activeReceipt.amount || 0));
        const allocated = receiptAmount - Math.abs(Number(activeReceipt?.allocationSummary?.unapplied || 0));
        const settlePct = receiptAmount > 0 ? Math.min(100, (allocated / receiptAmount) * 100) : 0;
        const receiptJournalLines = buildJournalEntriesForReceipt(activeReceipt);
        const receiptAllocations = Array.isArray(activeReceipt?.allocations) ? activeReceipt.allocations : [];
        const allocationSummary = activeReceipt?.allocationSummary || {};
        const summaryBreakdown = [
          { label: "Rent", value: Number(allocationSummary.rent || 0) },
          { label: "Utilities", value: Number(allocationSummary.utility || 0) },
          { label: "Deposit", value: Number(allocationSummary.deposit || 0) },
          { label: "Late Penalty", value: Number(allocationSummary.latePenalty || 0) },
          { label: "Debit Note", value: Number(allocationSummary.debitNote || 0) },
          { label: "Other", value: Number(allocationSummary.other || 0) },
        ].filter((r) => r.value > 0);
        const statusBadgeClass = activeReceipt.isReversed
          ? "bg-red-100 text-red-700"
          : activeReceipt.isConfirmed
          ? "bg-green-100 text-green-700"
          : "bg-amber-100 text-amber-700";
        const statusLabel = activeReceipt.isReversed ? "Reversed" : activeReceipt.isConfirmed ? "Confirmed" : "Pending";
        return (
          <div className="fixed inset-0 z-[80]" onClick={() => setShowView(false)}>
            <button
              type="button"
              aria-label="Close receipt details"
              onClick={() => setShowView(false)}
              className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]"
            />
            <div className="absolute inset-y-0 right-0 flex w-full justify-end">
              <div
                className="relative flex h-full w-full max-w-[700px] flex-col bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                {/* HEADER */}
                <div className="shrink-0 bg-[#0B3B2E] px-6 py-5 text-white">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-black uppercase tracking-[0.35em] text-emerald-300/80">Rental Receipt</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                        <h2 className="font-mono text-[22px] font-black leading-none tracking-tight">
                          {activeReceipt.receiptNumber || activeReceipt.referenceNumber || "—"}
                        </h2>
                        <span className={`inline-flex shrink-0 rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-widest bg-white/90 ${statusBadgeClass}`}>
                          {statusLabel}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] font-semibold text-emerald-100/90">
                        {getReceiptDisplayType(activeReceipt)} · {(activeReceipt.paymentMethod || "").replace(/_/g, " ") || "—"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowView(false)}
                      className="shrink-0 rounded border border-white/20 bg-white/10 p-1.5 text-white hover:bg-white/20"
                      title="Close"
                    >
                      <FaTimes size={13} />
                    </button>
                  </div>
                  {/* Meta strip */}
                  <div className="mt-4 grid grid-cols-3 divide-x divide-white/10 rounded border border-white/10 bg-white/5 text-[11px]">
                    <div className="px-3 py-2">
                      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-300/60">Tenant</p>
                      <p className="mt-0.5 truncate font-semibold text-white">{getTenantName(activeReceipt, tenants)}</p>
                    </div>
                    <div className="px-3 py-2">
                      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-300/60">Unit</p>
                      <p className="mt-0.5 truncate font-semibold text-white">{getPropertyName(activeReceipt, tenants)} · {getUnitName(activeReceipt, tenants)}</p>
                    </div>
                    <div className="px-3 py-2">
                      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-300/60">Date</p>
                      <p className="mt-0.5 font-semibold text-white">{formatDate(activeReceipt.paymentDate) || "—"}</p>
                    </div>
                  </div>
                </div>

                {/* FINANCIAL SUMMARY */}
                <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Receipt Amount</p>
                      <p className="mt-1 font-mono text-[28px] font-black leading-none tracking-tight text-slate-900">
                        Ksh {receiptAmount.toLocaleString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-stretch divide-x divide-slate-200 rounded border border-slate-200 text-center text-[11px]">
                      <div className="px-4 py-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600">Allocated</p>
                        <p className="mt-1 font-mono font-black text-slate-900">{formatMoney(allocated)}</p>
                      </div>
                      <div className="px-4 py-2">
                        <p className={`text-[9px] font-black uppercase tracking-widest ${Number(allocationSummary.unapplied || 0) > 0 ? "text-amber-600" : "text-slate-400"}`}>
                          Unapplied
                        </p>
                        <p className={`mt-1 font-mono font-black ${Number(allocationSummary.unapplied || 0) > 0 ? "text-amber-700" : "text-slate-400"}`}>
                          {formatMoney(allocationSummary.unapplied || 0)}
                        </p>
                      </div>
                      <div className="px-4 py-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cashbook</p>
                        <p className="mt-1 font-mono font-black text-slate-700 text-[10px]">{getCashbookLabel(activeReceipt)}</p>
                      </div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Allocation Progress</p>
                      <p className="text-[9px] font-black text-slate-600">{settlePct.toFixed(0)}% allocated</p>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          settlePct >= 100 ? "bg-emerald-500" : settlePct > 0 ? "bg-amber-400" : "bg-slate-200"
                        }`}
                        style={{ width: `${settlePct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* ACTION BAR */}
                <div className="shrink-0 flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-6 py-2.5">
                  <button type="button" onClick={() => handlePrintReceipt(activeReceipt)}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50">
                    <FaPrint size={10} /> Print
                  </button>
                  <button type="button" onClick={() => { setShowView(false); openAllocationDrawer(activeReceipt); }} disabled={activeReceipt.isReversed}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">
                    <FaLink size={10} /> Manage Allocations
                  </button>
                  {!activeReceipt.isConfirmed && !activeReceipt.isReversed && (
                    <button type="button" onClick={() => { handleConfirmOne(activeReceipt); setShowView(false); }}
                      className="inline-flex items-center gap-1.5 rounded border border-green-200 bg-white px-3 py-1.5 text-[11px] font-bold text-green-700 transition hover:bg-green-50">
                      <FaCheck size={10} /> Confirm
                    </button>
                  )}
                  {activeReceipt.isConfirmed && !activeReceipt.isReversed && (
                    <button type="button" onClick={() => { handleUnconfirmOne(activeReceipt); setShowView(false); }}
                      className="inline-flex items-center gap-1.5 rounded border border-amber-200 bg-white px-3 py-1.5 text-[11px] font-bold text-amber-700 transition hover:bg-amber-50">
                      <FaTimes size={10} /> Unconfirm
                    </button>
                  )}
                  {activeReceipt.isReversed && (
                    <button type="button" onClick={() => { handleCancelReversalOne(activeReceipt); setShowView(false); }}
                      className="inline-flex items-center gap-1.5 rounded border border-teal-200 bg-white px-3 py-1.5 text-[11px] font-bold text-teal-700 transition hover:bg-teal-50">
                      <FaRedoAlt size={10} /> Cancel Reversal
                    </button>
                  )}
                  {canUpdateReceipt && (
                    <button type="button" onClick={() => { openEditForm(activeReceipt); setShowView(false); }}
                      className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-blue-700 transition hover:bg-blue-50">
                      <FaEdit size={10} /> Edit
                    </button>
                  )}
                  {canDeleteReceipt && (
                    <button type="button" onClick={() => { handleDeleteOne(activeReceipt._id); setShowView(false); }}
                      className="ml-auto inline-flex items-center gap-1.5 rounded border border-rose-200 bg-white px-3 py-1.5 text-[11px] font-bold text-rose-600 transition hover:bg-rose-50">
                      <FaTrash size={10} /> Delete
                    </button>
                  )}
                </div>

                {/* BODY */}
                <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-100">

                  {/* Allocation Breakdown by Type */}
                  <div className="bg-white">
                    <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-2">
                      <FaMoneyBillWave size={10} className="text-slate-400" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Allocation Breakdown</span>
                    </div>
                    {summaryBreakdown.length > 0 ? (
                      <table className="w-full text-[11px] border-collapse">
                        <thead className="bg-[#0B3B2E] text-white">
                          <tr>
                            <th className="px-4 py-1 text-left font-bold border-r border-white/10">Category</th>
                            <th className="px-4 py-1 text-right font-bold">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summaryBreakdown.map((row, i) => (
                            <tr key={row.label} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                              <td className="px-4 py-1.5 border-r border-gray-100 text-slate-700">{row.label}</td>
                              <td className="px-4 py-1.5 text-right font-mono font-semibold text-slate-900">{formatMoney(row.value)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-[#0B3B2E]/20 bg-[#0B3B2E]/5">
                            <td className="px-4 py-2 text-[11px] font-black uppercase tracking-wider text-[#0B3B2E]">Total Allocated</td>
                            <td className="px-4 py-2 text-right font-mono font-black text-[#0B3B2E]">{formatMoney(allocated)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    ) : (
                      <div className="px-6 py-8 text-center text-[11px] text-slate-400">No allocation breakdown available.</div>
                    )}
                  </div>

                  {/* Invoice Allocations */}
                  <div className="bg-white">
                    <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-2">
                      <div className="flex items-center gap-2">
                        <FaReceipt size={10} className="text-slate-400" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Invoice Allocations</span>
                      </div>
                      <span className="text-[9px] font-bold text-slate-400">{receiptAllocations.length} line(s)</span>
                    </div>
                    {receiptAllocations.length === 0 ? (
                      <div className="px-6 py-8 text-center text-[11px] text-slate-400">No allocation lines saved on this receipt yet.</div>
                    ) : (
                      <table className="w-full text-[11px] border-collapse">
                        <thead className="bg-[#0B3B2E] text-white">
                          <tr>
                            <th className="px-4 py-1 text-left font-bold border-r border-white/10">Invoice</th>
                            <th className="px-4 py-1 text-left font-bold border-r border-white/10">Category</th>
                            <th className="px-4 py-1 text-right font-bold border-r border-white/10">Applied</th>
                            <th className="px-4 py-1 text-right font-bold">Before</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receiptAllocations.map((row, index) => (
                            <tr key={`${row?.invoice || row?.invoiceId || index}`} className={`border-b border-gray-100 ${index % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                              <td className="px-4 py-1.5 border-r border-gray-100">
                                <p className="font-mono font-bold text-slate-900">{row?.invoiceNumber || `Invoice ${index + 1}`}</p>
                                {row?.description && <p className="text-[10px] text-slate-400">{row.description}</p>}
                              </td>
                              <td className="px-4 py-1.5 border-r border-gray-100 text-slate-500">
                                {getAllocationGroupLabel(row?.priorityGroup || row?.category)}{row?.utilityType ? ` · ${row.utilityType}` : ""}
                              </td>
                              <td className="px-4 py-1.5 border-r border-gray-100 text-right font-mono font-bold text-emerald-700">{formatMoney(row?.appliedAmount || 0)}</td>
                              <td className="px-4 py-1.5 text-right font-mono font-semibold text-slate-500">{formatMoney(row?.beforeOutstanding || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Journal Entries */}
                  <div className="bg-white">
                    <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-2">
                      <FaFileInvoice size={10} className="text-slate-400" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Journal Entries</span>
                    </div>
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-slate-900 text-white">
                          <th className="px-4 py-1 text-left font-bold border-r border-white/10">Account</th>
                          <th className="px-4 py-1 text-right font-bold border-r border-white/10">Debit</th>
                          <th className="px-4 py-1 text-right font-bold">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receiptJournalLines.map((line, i) => (
                          <tr key={`${line.accountCode}-${i}`} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                            <td className="px-4 py-1.5 border-r border-gray-100">
                              <p className="font-mono font-bold text-slate-800">{line.accountCode} · {line.accountName}</p>
                              <p className="mt-0.5 text-[10px] text-slate-400">{line.narration}</p>
                            </td>
                            <td className="px-4 py-1.5 border-r border-gray-100 text-right font-mono font-semibold text-slate-700">
                              {line.debit ? formatMoney(line.debit) : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-1.5 text-right font-mono font-semibold text-slate-700">
                              {line.credit ? formatMoney(line.credit) : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {activeReceipt.description && (
                      <div className="border-t border-slate-100 px-6 py-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Description</p>
                        <p className="mt-1 text-xs text-slate-600">{activeReceipt.description}</p>
                      </div>
                    )}
                  </div>

                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {allocationDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-[1500px] flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
                Receipt Allocation Workspace
                {(allocationTarget?.receiptNumber || allocationTarget?.referenceNumber) && (
                  <span className="font-mono font-semibold normal-case tracking-normal text-emerald-300">
                    · {allocationTarget.receiptNumber || allocationTarget.referenceNumber}
                  </span>
                )}
              </h3>
              <button onClick={closeAllocationDrawer} className="text-white/70 transition-colors hover:text-white">
                <FaTimes />
              </button>
            </div>

            {allocationLoading ? (
              <div className="flex min-h-[280px] items-center justify-center text-sm font-semibold text-slate-500">Loading allocation workspace...</div>
            ) : (
              <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden xl:grid-cols-[minmax(0,1.75fr)_minmax(340px,0.65fr)]">
                <div className="overflow-y-auto border-r border-slate-200 bg-white">
                  <div className="grid grid-cols-1 gap-3 border-b border-slate-200 p-4 md:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Receipt Amount</p>
                      <p className="mt-1 text-lg font-bold text-slate-900">{formatMoney(allocationComputed.receiptAmount)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">{isAppendOnlyAllocationMode ? "Available New Allocation" : "Editable Allocation"}</p>
                      <p className="mt-1 text-lg font-bold text-slate-900">{formatMoney(allocationComputed.editableCap)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">{isAppendOnlyAllocationMode ? "Remaining Unapplied" : "Remaining"}</p>
                      <p className={`mt-1 text-lg font-bold ${allocationComputed.remaining > 0.009 ? "text-amber-600" : "text-emerald-700"}`}>
                        {formatMoney(allocationComputed.remaining)}
                      </p>
                    </div>
                  </div>

                  {isAppendOnlyAllocationMode && (
                    <div className="mx-4 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                      <div className="flex items-start gap-3">
                        <FaInfoCircle className="mt-0.5 shrink-0" />
                        <div>
                          <p className="font-bold">This confirmed receipt is running in append-only prepayment mode.</p>
                          <p className="mt-1">
                            The already applied portion of <strong>{formatMoney(allocationRules?.lockedAllocatedTotal || 0)}</strong> stays locked. You can safely apply the remaining unapplied balance of <strong>{formatMoney(allocationRules?.currentUnapplied || 0)}</strong> to open bills without reversing the original receipt.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {allocationRules?.lockedUnappliedForConfirmed && !isAppendOnlyAllocationMode && !allocationAdminOverride && (
                    <div className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <FaInfoCircle className="mt-0.5 shrink-0" />
                          <div>
                            <p className="font-bold">This posted receipt is fully locked.</p>
                            <p className="mt-1">
                              It has no remaining unapplied balance to move. Reverse and recreate it if the posted meaning needs to change.
                            </p>
                          </div>
                        </div>
                        {canAdminOverride && (
                          <button
                            onClick={() => openAllocationDrawer(allocationTarget, { adminOverride: true })}
                            className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50"
                          >
                            Admin Override
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {allocationAdminOverride && (
                    <div className="mx-4 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
                      <span className="font-bold">⚠ Admin Override Active</span> — All lock restrictions bypassed. Changes will directly modify confirmed receipt allocations.
                    </div>
                  )}

                  <div className="p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Allocation Lines</h4>
                        <p className="text-xs text-slate-500">Target exact invoices, utilities, penalties, or deposit charges for this receipt. Confirmed receipts can add only from their remaining unapplied balance.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={handleAutoAllocate}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          <FaMagic /> Auto Allocate
                        </button>
                        <button
                          onClick={handleMoveToPrepayment}
                          className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
                        >
                          <FaInfoCircle /> Move To Prepayment
                        </button>
                        <button
                          onClick={addAllocationLine}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#0B3B2E] px-3 py-2 text-xs font-bold text-white hover:bg-[#0A3127]"
                        >
                          <FaPlusCircle /> Add Line
                        </button>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div className="max-h-[560px] overflow-auto">
                        <table className="w-full border-collapse text-[11px]">
                          <thead className="sticky top-0 z-10 bg-slate-100 text-[9px] uppercase tracking-[0.12em] text-slate-500 shadow-sm">
                            <tr>
                              <th className="border-b border-slate-200 px-2 py-1 text-left">Invoice / Bill</th>
                              <th className="w-28 border-b border-slate-200 px-2 py-1 text-left">Amount</th>
                              <th className="w-24 border-b border-slate-200 px-2 py-1 text-right">Available</th>
                              <th className="w-20 border-b border-slate-200 px-2 py-1 text-left">Class</th>
                              <th className="w-44 border-b border-slate-200 px-2 py-1 text-left">Period / Dates</th>
                              <th className="w-16 border-b border-slate-200 px-2 py-1 text-center">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allocationLines.map((line, index) => {
                              const lineInvoiceId = String(line?.invoiceId || "");
                              const option = allocationOptionMap.get(lineInvoiceId);
                              const maxForLine = Number(option?.maxAllocatable || 0);
                              const lockedFloor = Math.max(0, Number(option?.currentAllocation || 0));
                              const isLockedBaseLine = isAppendOnlyAllocationMode && lockedFloor > 0;
                              const isOrphanLine = !!lineInvoiceId && !option;
                              const isAnyLocked = isLockedBaseLine || isOrphanLine;
                              const lineRef = line?.invoiceNumber || (lineInvoiceId ? `#${lineInvoiceId.slice(-6)}` : "");
                              const linePriorityLabel = getAllocationGroupLabel(line?.priorityGroup || "");
                              const resolvedSelectedLabel = option
                                ? getAllocationOptionLabel(option)
                                : lineRef
                                ? `${lineRef}${linePriorityLabel ? ` · ${linePriorityLabel}` : ""}${line?.utilityType ? ` · ${line.utilityType}` : ""}`
                                : "";
                              return (
                                <tr key={`${lineInvoiceId || "line"}-${index}`} className={`border-b border-slate-100 ${isLockedBaseLine ? "bg-slate-50/70" : "bg-white hover:bg-slate-50/60"}`}>
                                  <td className="px-2 py-1 align-middle">
                                    <div onClick={(event) => event.stopPropagation()}>
                                      {(() => {
                                        const isDropdownOpen = allocationDropdownOpen[index] === true;
                                        const searchValue = allocationSearchTerms[index];
                                        const inputValue = isDropdownOpen && searchValue !== undefined ? searchValue : resolvedSelectedLabel;
                                        const filteredOptions = getFilteredAllocationOptions(searchValue || "", lineInvoiceId);

                                        return (
                                          <>
                                            <input
                                              type="text"
                                              value={isAnyLocked ? resolvedSelectedLabel : inputValue}
                                              onFocus={(event) => {
                                                event.stopPropagation();
                                                if (isAnyLocked) return;
                                                const rect = event.target.getBoundingClientRect();
                                                setAllocationDropdownPos((prev) => ({ ...prev, [index]: { top: rect.bottom + 2, left: rect.left, width: rect.width } }));
                                                setAllocationSearchTerms((prev) => ({
                                                  ...prev,
                                                  [index]: prev[index] !== undefined ? prev[index] : "",
                                                }));
                                                setAllocationDropdownOpen((prev) => ({
                                                  ...prev,
                                                  [index]: true,
                                                }));
                                              }}
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                if (isAnyLocked) return;
                                                const rect = event.target.getBoundingClientRect();
                                                setAllocationDropdownPos((prev) => ({ ...prev, [index]: { top: rect.bottom + 2, left: rect.left, width: rect.width } }));
                                                setAllocationDropdownOpen((prev) => ({
                                                  ...prev,
                                                  [index]: true,
                                                }));
                                              }}
                                              onChange={(event) => {
                                                if (isAnyLocked) return;
                                                const value = event.target.value;
                                                setAllocationSearchTerms((prev) => ({
                                                  ...prev,
                                                  [index]: value,
                                                }));
                                                setAllocationDropdownOpen((prev) => ({
                                                  ...prev,
                                                  [index]: true,
                                                }));
                                                if (lineInvoiceId) {
                                                  updateAllocationLine(index, "invoiceId", "");
                                                }
                                              }}
                                              onBlur={() => {
                                                window.setTimeout(() => {
                                                  setAllocationDropdownOpen((prev) => ({
                                                    ...prev,
                                                    [index]: false,
                                                  }));
                                                  setAllocationSearchTerms((prev) => {
                                                    if (!lineInvoiceId && String(prev[index] || "").trim()) return prev;
                                                    const next = { ...prev };
                                                    delete next[index];
                                                    return next;
                                                  });
                                                }, 140);
                                              }}
                                              disabled={isAnyLocked}
                                              placeholder="Search invoice, bill type, rent, deposit…"
                                              className="h-7 w-full border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-800 placeholder:font-normal placeholder:text-slate-400 focus:border-[#0B3B2E] focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                                            />

                                            {isDropdownOpen && !isAnyLocked && allocationDropdownPos[index] && (
                                              <div
                                                style={{ position: "fixed", top: allocationDropdownPos[index].top, left: allocationDropdownPos[index].left, width: allocationDropdownPos[index].width }}
                                                className="z-[99999] max-h-[340px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5"
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={(event) => event.stopPropagation()}
                                              >
                                                {filteredOptions.length > 0 ? (
                                                  filteredOptions.map((invoice) => {
                                                    const invoiceId = String(invoice?.invoiceId || "");
                                                    const ref = invoice?.invoiceNumber || invoice?.description || "Invoice";
                                                    const chargeLabel = getAllocationGroupLabel(invoice?.priorityGroup || invoice?.chargeType || getInvoiceChargeType(invoice));
                                                    const avail = getAllocationOptionAmount(invoice);
                                                    const isPaid = String(invoice?.status || "").toLowerCase() === "paid";
                                                    return (
                                                      <button
                                                        key={invoiceId}
                                                        type="button"
                                                        onClick={(event) => {
                                                          event.stopPropagation();
                                                          updateAllocationLine(index, "invoiceId", invoiceId);
                                                          setAllocationSearchTerms((prev) => {
                                                            const next = { ...prev };
                                                            delete next[index];
                                                            return next;
                                                          });
                                                          setAllocationDropdownOpen((prev) => ({
                                                            ...prev,
                                                            [index]: false,
                                                          }));
                                                        }}
                                                        className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-1.5 text-left last:border-0 hover:bg-[#0B3B2E]/[0.04] focus:bg-[#0B3B2E]/[0.04] focus:outline-none"
                                                      >
                                                        <div className="min-w-0 flex-1">
                                                          <div className="flex items-center gap-1.5">
                                                            <span className="text-[11px] font-bold text-slate-900">{ref}</span>
                                                            <span className="rounded bg-slate-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-slate-500">{chargeLabel}</span>
                                                            {invoice?.utilityType ? (
                                                              <span className="rounded bg-teal-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-teal-700">{invoice.utilityType}</span>
                                                            ) : null}
                                                          </div>
                                                          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                                                            {invoice?.period ? <span>{invoice.period}</span> : null}
                                                            {invoice?.dueDate ? <><span>·</span><span>Due {formatDate(invoice.dueDate)}</span></> : null}
                                                            {invoice?.status ? <><span>·</span><span className={isPaid ? "font-semibold text-emerald-600" : ""}>{String(invoice.status).replace(/_/g, " ")}</span></> : null}
                                                          </div>
                                                        </div>
                                                        <span className="shrink-0 text-[11px] font-black tabular-nums text-[#0B3B2E]">{formatMoney(avail)}</span>
                                                      </button>
                                                    );
                                                  })
                                                ) : (
                                                  <div className="px-3 py-2.5 text-[11px] text-slate-400">
                                                    No matching invoice, bill, deposit, or charge found.
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </>
                                        );
                                      })()}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1 align-middle">
                                    <input
                                      type="number"
                                      min={isLockedBaseLine ? lockedFloor : 0}
                                      step="0.01"
                                      value={line?.appliedAmount || ""}
                                      onChange={(e) => updateAllocationLine(index, "appliedAmount", e.target.value)}
                                      disabled={isAnyLocked}
                                      className="h-7 w-full border border-slate-300 bg-white px-2 text-[11px] tabular-nums text-slate-800 focus:border-[#0B3B2E] focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                                      placeholder="0.00"
                                    />
                                  </td>
                                  <td className="whitespace-nowrap px-2 py-1 text-right align-middle text-[11px] font-black tabular-nums text-slate-900">
                                    {option ? formatMoney(maxForLine) : <span className="text-slate-300">—</span>}
                                    {isAnyLocked ? <div className="mt-0.5 rounded bg-rose-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-rose-600 text-center">Locked</div> : null}
                                  </td>
                                  <td className="px-2 py-1 align-middle">
                                    {(option || line?.priorityGroup) ? (
                                      <div className="flex flex-col gap-0.5">
                                        <span className="rounded bg-slate-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-slate-600 inline-block w-fit">{getAllocationGroupLabel(option?.priorityGroup || line?.priorityGroup)}</span>
                                        {(option?.utilityType || line?.utilityType) ? <span className="rounded bg-teal-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-teal-700 inline-block w-fit">{option?.utilityType || line?.utilityType}</span> : null}
                                      </div>
                                    ) : (
                                      <span className="text-slate-300">—</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1 align-middle text-[10px] text-slate-500">
                                    {(option || option?.period) ? (
                                      <div className="space-y-0.5">
                                        {option?.period ? <div className="font-semibold text-slate-700">{option.period}</div> : null}
                                        {option?.dueDate ? <div>Due {formatDate(option.dueDate)}</div> : null}
                                        {option?.status ? (
                                          <span className={`rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${String(option.status).toLowerCase() === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                                            {String(option.status).replace(/_/g, " ")}
                                          </span>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <span className="text-slate-300">—</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1 text-center align-middle">
                                    <button
                                      onClick={() => removeAllocationLine(index)}
                                      disabled={isAnyLocked}
                                      title={isAnyLocked ? "Locked — cannot remove" : "Remove line"}
                                      className="inline-flex items-center justify-center gap-1 rounded border border-rose-200 bg-white px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      <FaMinusCircle size={9} /> {isAnyLocked ? "Locked" : "Remove"}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Prepayment label section — shown when there is remaining unallocated amount */}
                  {allocationComputed.remaining > 0.005 && (
                    <div className="border-t border-dashed border-amber-300 bg-amber-50/60 p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">Label Unallocated Balance <span className="ml-1 text-amber-700">({formatMoney(allocationComputed.remaining)} remaining)</span></h4>
                          <p className="text-xs text-slate-500">Tag the unallocated portion by charge type so it auto-applies to the correct future invoice (e.g. rent vs garbage).</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPrepaymentWorkspaceLines((prev) => [...prev, { billItemKey: "rent", label: "Rent Prepayment", amount: 0 }])}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-800"
                        >
                          <FaPlusCircle size={10} /> Add Label
                        </button>
                      </div>
                      {prepaymentWorkspaceLines.length === 0 ? (
                        <p className="text-xs text-amber-700 italic">No labels set — remaining will default to Rent Prepayment on save.</p>
                      ) : (
                        <div className="space-y-2">
                          {prepaymentWorkspaceLines.map((line, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <AppSelect
                                value={line.billItemKey}
                                onChange={(v) => {
                                  const opt = allocationPrepaymentTypes.find((o) => o.billItemKey === (v ?? ""));
                                  setPrepaymentWorkspaceLines((prev) => prev.map((l, i) => i !== idx ? l : { ...l, billItemKey: v ?? "", label: opt?.label || v || "" }));
                                }}
                                options={allocationPrepaymentTypes.map((o) => ({ value: o.billItemKey, label: o.label }))}
                                size="sm"
                              />
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={line.amount || ""}
                                onChange={(e) => setPrepaymentWorkspaceLines((prev) => prev.map((l, i) => i !== idx ? l : { ...l, amount: e.target.value }))}
                                placeholder="0.00"
                                className="h-7 w-32 border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => setPrepaymentWorkspaceLines((prev) => prev.filter((_, i) => i !== idx))}
                                className="inline-flex h-7 w-7 items-center justify-center rounded border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                              >
                                <FaMinusCircle size={10} />
                              </button>
                            </div>
                          ))}
                          <div className="mt-1 flex justify-between text-[10px] font-bold">
                            <span className="text-slate-500">Labels total</span>
                            <span className={`${Math.abs(prepaymentWorkspaceLines.reduce((s, l) => s + Number(l.amount || 0), 0) - allocationComputed.remaining) > 0.01 ? "text-rose-600" : "text-emerald-700"}`}>
                              {formatMoney(prepaymentWorkspaceLines.reduce((s, l) => s + Number(l.amount || 0), 0))} / {formatMoney(allocationComputed.remaining)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="overflow-y-auto bg-slate-50/80">
                  <div className="border-b border-slate-200 p-4">
                    <h4 className="text-sm font-bold text-slate-900">Allocation Summary</h4>
                    <p className="mt-1 text-xs text-slate-500">Review the operational impact before saving.</p>
                  </div>

                  <div className="space-y-4 p-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Allocated now</span>
                        <span className="font-bold text-slate-900">{formatMoney(allocationComputed.totalAllocated)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-slate-500">Remaining in scope</span>
                        <span className={`font-bold ${allocationComputed.remaining > 0.009 ? "text-amber-600" : "text-emerald-700"}`}>
                          {formatMoney(allocationComputed.remaining)}
                        </span>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-[#0B3B2E] transition-all"
                          style={{ width: `${Math.min(100, allocationComputed.editableCap > 0 ? (allocationComputed.totalAllocated / allocationComputed.editableCap) * 100 : 0)}%` }}
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <label className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Reason / Audit note</label>
                      <textarea
                        rows={4}
                        value={allocationReason}
                        onChange={(e) => setAllocationReason(e.target.value)}
                        className="mt-2 w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                        placeholder="Example: Reassign utility settlement to the correct invoice for landlord statement continuity."
                      />
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Lines preview</p>
                      <div className="mt-3 space-y-2">
                        {allocationComputed.rows.length > 0 ? allocationComputed.rows.map((row) => (
                          <div key={`${row.invoiceId}-${row.index}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">{row.option?.invoiceNumber || row.option?.description || row.invoiceId}</p>
                                <p className="text-[11px] text-slate-500">{getAllocationGroupLabel(row.option?.priorityGroup)}{row.option?.utilityType ? ` · ${row.option.utilityType}` : ""}</p>
                              </div>
                              <div className="text-right text-sm font-bold text-slate-900">{formatMoney(row.appliedAmount)}</div>
                            </div>
                          </div>
                        )) : (
                          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500">No allocation lines selected yet.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                onClick={closeAllocationDrawer}
                className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
              <button
                onClick={handleSaveAllocations}
                disabled={allocationLoading || allocationSaving}
                className="inline-flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FaSave /> {allocationSaving ? "Saving..." : "Save Allocations"}
              </button>
            </div>
          </div>
        </div>
      )}

      <JournalEntriesDrawer
        open={journalDrawerOpen}
        onClose={() => setJournalDrawerOpen(false)}
        title="Receipt Journal Entry"
        sourceType="receipt"
        context={journalContext}
        lines={journalLines}
      />

      <CommunicationComposerModal
        open={showSmsModal}
        onClose={() => setShowSmsModal(false)}
        businessId={currentCompany?._id || ""}
        contextType="receipt"
        recordIds={selectedIds}
        title={`SMS Receipt${selectedIds.length !== 1 ? "s" : ""} (${selectedIds.length})`}
        subtitle="Send an SMS notification to the tenants for the selected receipts."
        allowedChannels={["sms"]}
        defaultChannel="sms"
        onSent={() => setShowSmsModal(false)}
      />
      <CommunicationComposerModal
        open={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        businessId={currentCompany?._id || ""}
        contextType="receipt"
        recordIds={selectedIds}
        title={`Email Receipt${selectedIds.length !== 1 ? "s" : ""} (${selectedIds.length})`}
        subtitle="Send an email notification to the tenants for the selected receipts."
        allowedChannels={["email"]}
        defaultChannel="email"
        onSent={() => setShowEmailModal(false)}
      />

      {/* ── Reversal Reason Modal ── */}
      {reversalModal.open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            {/* Header */}
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
                <FaUndo className="text-xs" />
                <span>
                  {reversalModal.isBatch ? `Reverse ${reversalModal.receipts.length} Receipt${reversalModal.receipts.length !== 1 ? "s" : ""}` : "Reverse Receipt"}
                  {!reversalModal.isBatch && reversalModal.receipt?.receiptNumber && (
                    <span className="ml-1.5 font-mono text-xs font-normal normal-case tracking-normal text-white/60">{reversalModal.receipt.receiptNumber}</span>
                  )}
                </span>
              </h3>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <FaInfoCircle className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-800">
                  {reversalModal.isBatch
                    ? `This will reverse ${reversalModal.receipts.length} confirmed receipt(s) and post offsetting ledger entries. This action cannot be undone.`
                    : "This will reverse the receipt and post an offsetting ledger entry. This action cannot be undone."}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                  Reversal Reason
                </label>
                <textarea
                  rows={3}
                  autoFocus
                  className="w-full resize-none border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  placeholder="Enter reason for reversal…"
                  value={reversalModal.reason}
                  onChange={(e) => setReversalModal((prev) => ({ ...prev, reason: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReversalConfirm(); } }}
                  disabled={reversalModal.loading}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                onClick={() => setReversalModal({ open: false, isBatch: false, receipt: null, receipts: [], reason: "", loading: false })}
                disabled={reversalModal.loading}
                className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReversalConfirm}
                disabled={reversalModal.loading}
                className="bg-red-600 hover:bg-red-700 px-5 py-2 text-xs font-bold uppercase tracking-wide text-white transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {reversalModal.loading ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Reversing…
                  </>
                ) : (
                  <>
                    <FaUndo className="text-xs" />
                    Confirm Reversal
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel Reversal Modal ── */}
      {cancelReversalModal.open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
                <FaRedoAlt className="text-xs" />
                <span>
                  Cancel Reversal
                  {cancelReversalModal.receipt?.receiptNumber && (
                    <span className="ml-1.5 font-mono text-xs font-normal normal-case tracking-normal text-white/60">
                      {cancelReversalModal.receipt.receiptNumber}
                    </span>
                  )}
                </span>
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
                <FaInfoCircle className="text-emerald-600 mt-0.5 shrink-0" />
                <p className="text-sm text-emerald-800">
                  This will void the reversal entry and fully restore receipt{" "}
                  <span className="font-semibold">{cancelReversalModal.receipt?.receiptNumber}</span> to
                  its original confirmed state. All ledger entries will be corrected automatically.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                  Reason (optional)
                </label>
                <textarea
                  rows={3}
                  autoFocus
                  className="w-full resize-none border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  placeholder="e.g. Reversed by mistake…"
                  value={cancelReversalModal.reason}
                  onChange={(e) => setCancelReversalModal((prev) => ({ ...prev, reason: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCancelReversalConfirm(); } }}
                  disabled={cancelReversalModal.loading}
                />
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                onClick={() => setCancelReversalModal({ open: false, receipt: null, reason: "", loading: false })}
                disabled={cancelReversalModal.loading}
                className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Close
              </button>
              <button
                onClick={handleCancelReversalConfirm}
                disabled={cancelReversalModal.loading}
                className="bg-emerald-700 hover:bg-emerald-800 px-5 py-2 text-xs font-bold uppercase tracking-wide text-white transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {cancelReversalModal.loading ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Restoring…
                  </>
                ) : (
                  <>
                    <FaRedoAlt className="text-xs" />
                    Restore Receipt
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default Receipts;
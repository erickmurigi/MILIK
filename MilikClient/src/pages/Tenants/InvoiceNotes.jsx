import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fmtDate } from "../../utils/dates";
import { useDispatch, useSelector } from "react-redux";
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllTenants,
} from "../../redux/selectors";
import { useSearchParams } from "react-router-dom";
import { useTabState } from "../../hooks/useTabState";
import { LISTING_UI } from "../../utils/listingPageUtils";
import { buildTenantOption } from "../../utils/tenantUtils";
import {
  FaEnvelope,
  FaFileInvoice,
  FaPlus,
  FaRedoAlt,
  FaSave,
  FaSearch,
  FaSms,
  FaTimes,
  FaUndo,
  FaUpload,
} from "react-icons/fa";
import toast from "react-hot-toast";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import InvoiceNotesImportModal from "../../components/Modals/InvoiceNotesImportModal";
import { getTenants } from "../../redux/tenantsRedux";
import { getChartOfAccounts, getTenantInvoices } from "../../redux/apiCalls";
import {
  createTenantInvoiceNote,
  deleteTenantInvoiceNote,
  getCreditableTenantInvoices,
  getTenantInvoiceNoteChargeTypes,
  getTenantInvoiceNotes,
  bulkImportInvoiceNotes,
} from "../../redux/invoiceApi";
import { adminRequests } from "../../utils/requestMethods";
import useScopedSessionDraft, { buildScopedDraftKey } from "../../hooks/useScopedSessionDraft";
import AppSelect from "../../components/common/AppSelect";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_ORANGE = "bg-[#FF8C00]";

const todayInput = () => new Date().toISOString().split("T")[0];

const ITEMS_PER_PAGE = 50;

const normalizeList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.properties)) return payload.properties;
  if (Array.isArray(payload?.tenants)) return payload.tenants;
  if (Array.isArray(payload?.invoices)) return payload.invoices;
  return [];
};

const getTenantDisplayName = (tenant) => {
  if (!tenant) return "";
  return (
    tenant.name ||
    tenant.tenantName ||
    [tenant.firstName, tenant.lastName].filter(Boolean).join(" ") ||
    "Unnamed Tenant"
  );
};

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));


const isPostingAccount = (account) => account?.isHeader !== true && account?.isPosting !== false;
const isActiveInvoice = (invoice) => !["cancelled", "reversed"].includes(String(invoice?.status || "").toLowerCase());
const isPostedInvoice = (invoice) => String(invoice?.postingStatus || "").toLowerCase() === "posted";
const isActiveNote = (note) => !["cancelled", "reversed"].includes(String(note?.status || "").toLowerCase());
const ACTIVE_TENANT_STATUSES = new Set(["active", "overdue"]);
const TERMINATED_TENANT_STATUSES = new Set(["terminated", "moved_out", "evicted", "inactive"]);

const normalizeTenantStatus = (tenant) => String(tenant?.status || "active").trim().toLowerCase();
const tenantMatchesScope = (tenant, scope = "active") => {
  const normalized = normalizeTenantStatus(tenant);
  if (scope === "all") return true;
  if (scope === "terminated") return TERMINATED_TENANT_STATUSES.has(normalized);
  return ACTIVE_TENANT_STATUSES.has(normalized);
};

const getTenantStatusLabel = (tenant) => {
  const normalized = normalizeTenantStatus(tenant);
  if (TERMINATED_TENANT_STATUSES.has(normalized)) return "Terminated";
  if (normalized === "overdue") return "Overdue";
  return "Active";
};

const resolvePropertyId = (record) =>
  String(
    record?.property?._id ||
      record?.property ||
      record?.unit?.property?._id ||
      record?.unit?.property ||
      ""
  );

const resolvePropertyName = (record, propertyMap) => {
  const direct = record?.property?.propertyName || record?.propertyName || record?.unit?.property?.propertyName;
  if (direct) return direct;
  return propertyMap.get(resolvePropertyId(record))?.propertyName || "-";
};

const resolveTenantId = (record) => String(record?.tenant?._id || record?.tenant || "");

const resolveUnitName = (record, tenantMap) => {
  const direct =
    record?.unit?.unitNumber ||
    record?.unit?.unitName ||
    record?.unit?.name ||
    record?.unitName;
  if (direct) return direct;
  const tenant = tenantMap.get(resolveTenantId(record));
  return tenant?.unit?.unitNumber || tenant?.unit?.unitName || tenant?.unit?.name || tenant?.unitName || "-";
};

const getStatusChip = (status) => {
  const normalized = String(status || "draft").toLowerCase();
  if (normalized === "posted") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "reversed") return "border-amber-200 bg-amber-50 text-amber-700";
  if (normalized === "cancelled") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
};

const getNotePaymentState = (note = {}) => {
  const noteType = String(note?.noteType || note?.documentType || "").toUpperCase();
  const status = String(note?.status || "").toLowerCase();
  const paymentStatus = String(note?.paymentStatus || note?.metadata?.paymentStatus || "").toLowerCase();
  const amount = Number(note?.amount || 0);
  const paidAmount = Number(note?.amountPaid ?? note?.paidAmount ?? note?.metadata?.amountPaid ?? 0);
  const balance = Number(note?.balance ?? note?.balanceDue ?? note?.remainingBalance ?? note?.outstanding ?? note?.metadata?.balance ?? NaN);

  if (status === "reversed") return { label: "Reversed", className: "bg-slate-100 text-slate-700" };
  if (status === "cancelled") return { label: "Cancelled", className: "bg-rose-100 text-rose-700" };
  if (noteType === "CREDIT_NOTE") return { label: "Credit Applied", className: "bg-blue-100 text-blue-700" };
  if (paymentStatus === "paid" || status === "paid" || Number.isFinite(balance) && balance <= 0) {
    return { label: "Paid", className: "bg-green-100 text-green-700" };
  }
  if (["part_paid", "partially_paid", "partial"].includes(paymentStatus) || paidAmount > 0 && paidAmount < amount) {
    return { label: "Part Paid", className: "bg-amber-100 text-amber-700" };
  }
  return { label: "Unpaid", className: "bg-orange-100 text-orange-700" };
};

const normalizeInvoiceItemKey = (invoice) => {
  const metadata = invoice?.metadata || {};
  const category = String(invoice?.category || "").toUpperCase();
  const billItemKey = String(metadata?.billItemKey || "").trim();
  const utilityType = String(
    metadata?.utilityType || metadata?.meterUtilityType || metadata?.statementUtilityType || metadata?.utilityName || metadata?.utility || ""
  )
    .trim()
    .toLowerCase();

  return [category, billItemKey || utilityType].filter(Boolean).join("::");
};

const humanizeCategory = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const getInvoiceItemLabel = (invoice) => {
  const metadata = invoice?.metadata || {};
  return (
    metadata?.billItemLabel ||
    metadata?.billItemKey ||
    metadata?.utilityType ||
    metadata?.meterUtilityType ||
    metadata?.statementUtilityType ||
    metadata?.utilityName ||
    metadata?.utility ||
    humanizeCategory(invoice?.category || "Charge Item")
  );
};

const monthKey = (date) => {
  const dt = new Date(date);
  if (Number.isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};

const formatMonthLabel = (date) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(date);

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);

const resolveTenantLeaseStartDate = (tenant) =>
  tenant?.leaseStartDate ||
  tenant?.lease?.startDate ||
  tenant?.agreementStartDate ||
  tenant?.moveInDate ||
  tenant?.occupationDate ||
  tenant?.createdAt ||
  null;

const STANDALONE_CHARGE_ITEMS = [
  {
    key: "standalone-water",
    label: "Water",
    category: "UTILITY_CHARGE",
    metadata: { billItemKey: "utility:water", billItemLabel: "Water", utilityType: "Water", statementUtilityType: "Water" },
  },
  {
    key: "standalone-electricity",
    label: "Electricity",
    category: "UTILITY_CHARGE",
    metadata: { billItemKey: "utility:electricity", billItemLabel: "Electricity", utilityType: "Electricity", statementUtilityType: "Electricity" },
  },
  {
    key: "standalone-garbage",
    label: "Garbage",
    category: "UTILITY_CHARGE",
    metadata: { billItemKey: "utility:garbage", billItemLabel: "Garbage", utilityType: "Garbage", statementUtilityType: "Garbage" },
  },
  {
    key: "standalone-service-charge",
    label: "Service Charge",
    category: "OTHER_CHARGE",
    metadata: { billItemKey: "service_charge", billItemLabel: "Service Charge", includeInLandlordStatement: true },
  },
  {
    key: "standalone-late-payment",
    label: "Late Payment",
    category: "LATE_PENALTY_CHARGE",
    // includeInLandlordStatement is omitted here — the backend gates it via incomeRules.latePenaltyBeneficiary
    metadata: { billItemKey: "late_payment", billItemLabel: "Late Payment", standaloneDebitNote: true },
  },
  {
    key: "standalone-deposit",
    label: "Deposit",
    category: "DEPOSIT_CHARGE",
    metadata: { billItemKey: "deposit", billItemLabel: "Deposit" },
  },
  {
    key: "standalone-lease-fee",
    label: "Lease Fee",
    category: "OTHER_CHARGE",
    metadata: { billItemKey: "lease_fee", billItemLabel: "Lease Fee", includeInLandlordStatement: false },
  },
  {
    key: "standalone-other-charge",
    label: "Other Charge",
    category: "OTHER_CHARGE",
    metadata: { billItemKey: "other_charge", billItemLabel: "Other Charge", includeInLandlordStatement: false },
  },
];

const InvoiceNotes = () => {
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const tenants = useSelector(selectAllTenants);

  const requestedType = String(searchParams.get("type") || "").trim().toLowerCase();
  const initialNoteType = requestedType === "debit" ? "DEBIT_NOTE" : "CREDIT_NOTE";

  const invoiceNotesDraftKey = buildScopedDraftKey({
    page: "invoice-notes",
    companyId: currentCompany?._id,
    userId: currentUser?._id || currentUser?.id || currentUser?.email,
    extra: initialNoteType,
  });
  const [invoiceNotesDraft, setInvoiceNotesDraft, clearInvoiceNotesDraft] = useScopedSessionDraft(invoiceNotesDraftKey, {
    noteType: initialNoteType,
    filters: {
      propertyId: "",
      tenantId: "",
      tenantScope: "active",
      noteType: initialNoteType,
      search: "",
      status: "active",
    },
    showAddModal: false,
    propertyId: "",
    tenantId: "",
    sourceInvoiceId: "",
    invoiceItemSelection: "",
    chargeItemSearch: "",
    amount: "",
    category: "",
    description: "",
    noteDate: todayInput(),
    chartAccountId: "",
  });
  const [properties, setProperties] = useState([]);
  const noteType = invoiceNotesDraft.noteType || initialNoteType;
  const setNoteType = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, noteType: typeof value === "function" ? value(prev.noteType || initialNoteType) : value }));
  const [currentPage, setCurrentPage] = useTabState("/invoices/notes:currentPage", 1);
  const filters = invoiceNotesDraft.filters || { propertyId: "", tenantId: "", tenantScope: "active", noteType: initialNoteType, search: "", status: "active" };
  const setFilters = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, filters: typeof value === "function" ? value(prev.filters || filters) : value }));
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const showAddModal = Boolean(invoiceNotesDraft.showAddModal);
  const setShowAddModal = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, showAddModal: typeof value === "function" ? value(Boolean(prev.showAddModal)) : Boolean(value) }));
  const propertyId = invoiceNotesDraft.propertyId || "";
  const setPropertyId = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, propertyId: typeof value === "function" ? value(prev.propertyId || "") : value }));
  const tenantId = invoiceNotesDraft.tenantId || "";
  const setTenantId = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, tenantId: typeof value === "function" ? value(prev.tenantId || "") : value }));
  const tenantScope = invoiceNotesDraft.tenantScope || "active";
  const setTenantScope = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, tenantScope: typeof value === "function" ? value(prev.tenantScope || "active") : value, tenantId: "", sourceInvoiceId: "", invoiceItemSelection: "" }));
  const sourceInvoiceId = invoiceNotesDraft.sourceInvoiceId || "";
  const setSourceInvoiceId = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, sourceInvoiceId: typeof value === "function" ? value(prev.sourceInvoiceId || "") : value }));
  const invoiceItemSelection = invoiceNotesDraft.invoiceItemSelection || "";
  const setInvoiceItemSelection = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, invoiceItemSelection: typeof value === "function" ? value(prev.invoiceItemSelection || "") : value }));
  const chargeItemSearch = invoiceNotesDraft.chargeItemSearch || "";
  const setChargeItemSearch = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, chargeItemSearch: typeof value === "function" ? value(prev.chargeItemSearch || "") : value }));
  const amount = invoiceNotesDraft.amount || "";
  const setAmount = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, amount: typeof value === "function" ? value(prev.amount || "") : value }));
  const category = invoiceNotesDraft.category || "";
  const setCategory = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, category: typeof value === "function" ? value(prev.category || "") : value }));
  const description = invoiceNotesDraft.description || "";
  const setDescription = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, description: typeof value === "function" ? value(prev.description || "") : value }));
  const noteDate = invoiceNotesDraft.noteDate || todayInput();
  const setNoteDate = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, noteDate: typeof value === "function" ? value(prev.noteDate || todayInput()) : value }));
  const chartAccountId = invoiceNotesDraft.chartAccountId || "";
  const setChartAccountId = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, chartAccountId: typeof value === "function" ? value(prev.chartAccountId || "") : value }));
  const [openInvoices, setOpenInvoices] = useState([]);
  const [anchorInvoices, setAnchorInvoices] = useState([]);
  const [notes, setNotes] = useState([]);
  const [chargeTypes, setChargeTypes] = useState([]);
  const [postingAccounts, setPostingAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyNoteId, setBusyNoteId] = useState("");
  const [selectedNotes, setSelectedNotes] = useState([]);
  const [expandedNotes, setExpandedNotes] = useState(new Set());
  const [communicationModal, setCommunicationModal] = useState(null);
  const [reverseNoteModal, setReverseNoteModal] = useState({ open: false, note: null, reason: "", loading: false });
  const [showImportModal, setShowImportModal] = useState(false);

  const selectedNoteTenantIds = useMemo(() => {
    const objs = notes.filter((n) => selectedNotes.includes(String(n._id)));
    return [...new Set(objs.map((n) => String(n.tenant?._id || n.tenant || '')).filter(Boolean))];
  }, [notes, selectedNotes]);

  const propertyMap = useMemo(
    () => new Map((properties || []).map((item) => [String(item?._id || ""), item])),
    [properties]
  );

  const loadProperties = useCallback(async () => {
    if (!currentCompany?._id) return;
    try {
      const propertiesRes = await adminRequests.get(`/properties?business=${currentCompany._id}&limit=1000`);
      setProperties(normalizeList(propertiesRes.data));
    } catch (error) {
      console.error("Failed to load properties:", error);
    }
  }, [currentCompany?._id]);

  const loadData = useCallback(async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const [
        creditable,
        invoices,
        noteRows,
        types,
        accounts,
      ] = await Promise.all([
        getCreditableTenantInvoices({ business: currentCompany._id }),
        getTenantInvoices({ business: currentCompany._id }),
        getTenantInvoiceNotes({ business: currentCompany._id }),
        getTenantInvoiceNoteChargeTypes(),
        getChartOfAccounts({ business: currentCompany._id }),
        dispatch(getTenants({ business: currentCompany._id })),
      ]);

      setOpenInvoices((Array.isArray(creditable) ? creditable : []).filter(isActiveInvoice));
      setAnchorInvoices((Array.isArray(invoices) ? invoices : []).filter(isActiveInvoice));
      setNotes(Array.isArray(noteRows) ? noteRows : []);
      setChargeTypes(Array.isArray(types) ? types : []);
      setPostingAccounts((Array.isArray(accounts) ? accounts : []).filter(isPostingAccount));
    } catch (error) {
      console.error("Failed to load invoice notes workspace:", error);
      toast.error(error?.response?.data?.message || "Failed to load invoice notes workspace");
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id, dispatch]);

  useEffect(() => { loadProperties(); }, [loadProperties]);
  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const nextType = String(searchParams.get("type") || "").trim().toLowerCase() === "debit"
      ? "DEBIT_NOTE"
      : "CREDIT_NOTE";
    setNoteType(nextType);
    setFilters((prev) => ({ ...prev, noteType: nextType }));
  }, [searchParams]);

  const propertyScopedTenants = useMemo(() => {
    const scoped = !propertyId ? tenants : tenants.filter((tenant) => resolvePropertyId(tenant) === String(propertyId));
    return scoped.filter((tenant) => tenantMatchesScope(tenant, tenantScope));
  }, [tenants, propertyId, tenantScope]);

  const filterScopedTenants = useMemo(() => {
    const scoped = !filters.propertyId ? tenants : tenants.filter((tenant) => resolvePropertyId(tenant) === String(filters.propertyId));
    return scoped.filter((tenant) => tenantMatchesScope(tenant, filters.tenantScope || "active"));
  }, [tenants, filters.propertyId, filters.tenantScope]);

  const sourceInvoiceOptions = useMemo(() => {
    const sourceInvoicePool = noteType === "CREDIT_NOTE" ? openInvoices : anchorInvoices.filter(isPostedInvoice);
    return sourceInvoicePool
      .filter((invoice) => {
        if (!tenantId) return false;
        if (resolveTenantId(invoice) !== String(tenantId)) return false;
        if (propertyId && resolvePropertyId(invoice) !== String(propertyId)) return false;
        return true;
      })
      .sort((a, b) => {
        const bTime = new Date(b?.invoiceDate || b?.createdAt || 0).getTime();
        const aTime = new Date(a?.invoiceDate || a?.createdAt || 0).getTime();
        return bTime - aTime;
      });
  }, [noteType, openInvoices, anchorInvoices, tenantId, propertyId]);

  const selectedTenant = useMemo(
    () => (tenants || []).find((tenant) => String(tenant?._id || "") === String(tenantId)) || null,
    [tenants, tenantId]
  );

  const tenantMap = useMemo(
    () => new Map((tenants || []).map((tenant) => [String(tenant?._id || ""), tenant])),
    [tenants]
  );

  useEffect(() => {
    if (!tenantId) return;
    const stillSelectable = propertyScopedTenants.some((tenant) => String(tenant?._id || "") === String(tenantId));
    if (!stillSelectable) {
      setTenantId("");
      setSourceInvoiceId("");
      setInvoiceItemSelection("");
    }
  }, [propertyScopedTenants, tenantId]);

  const debitInvoiceItemOptions = useMemo(() => {
    if (!tenantId) return [];

    const rentInvoicesByMonth = new Map();
    sourceInvoiceOptions
      .filter((invoice) => String(invoice?.category || "").toUpperCase() === "RENT_CHARGE")
      .forEach((invoice) => {
        const key = monthKey(invoice?.bookingDate || invoice?.invoiceDate || invoice?.createdAt);
        if (!key || rentInvoicesByMonth.has(key)) return;
        rentInvoicesByMonth.set(key, invoice);
      });

    const today = new Date();
    const currentMonth = startOfMonth(today);
    const twelveMonthsBack = addMonths(currentMonth, -12);
    const leaseStartRaw = resolveTenantLeaseStartDate(selectedTenant);
    const leaseStartDate = leaseStartRaw ? startOfMonth(new Date(leaseStartRaw)) : null;
    const safeLeaseStartDate =
      leaseStartDate && !Number.isNaN(leaseStartDate.getTime()) ? leaseStartDate : twelveMonthsBack;
    const firstMonth = safeLeaseStartDate > twelveMonthsBack ? safeLeaseStartDate : twelveMonthsBack;

    const rentOptions = [];
    for (let cursor = new Date(firstMonth); cursor <= currentMonth; cursor = addMonths(cursor, 1)) {
      const key = monthKey(cursor);
      const existingInvoice = rentInvoicesByMonth.get(key);
      rentOptions.push({
        key: `rent-${key}`,
        label: `Rent - ${formatMonthLabel(cursor)} (${existingInvoice ? "Existing Invoice" : "No Invoice"})`,
        category: "RENT_CHARGE",
        anchorInvoiceId: existingInvoice?._id ? String(existingInvoice._id) : "",
        anchorInvoice: existingInvoice || null,
        metadata: {
          billItemKey: `rent:${key}`,
          billItemLabel: `Rent - ${formatMonthLabel(cursor)}`,
          rentPeriod: key,
          rentMonth: key,
          noteSourceMode: existingInvoice ? "invoice" : "standalone",
          standaloneDebitNote: !existingInvoice,
          includeInLandlordStatement: true,
          includeInCategoryTotals: true,
        },
      });
    }

    const otherOptions = STANDALONE_CHARGE_ITEMS.map((item) => ({
      ...item,
      anchorInvoiceId: "",
      anchorInvoice: null,
      metadata: {
        ...(item.metadata || {}),
        noteSourceMode: "standalone",
        standaloneDebitNote: true,
        // Respect per-item includeInLandlordStatement; only default to true when not explicitly set
        ...(typeof item.metadata?.includeInLandlordStatement !== "boolean" && { includeInLandlordStatement: true }),
        includeInCategoryTotals: true,
      },
    }));

    return [...rentOptions, ...otherOptions];
  }, [sourceInvoiceOptions, tenantId, selectedTenant]);

  const filteredDebitInvoiceItemOptions = useMemo(() => {
    const query = String(chargeItemSearch || "").trim().toLowerCase();
    if (!query) return debitInvoiceItemOptions;
    return debitInvoiceItemOptions.filter((item) =>
      [item.label, item.category, item.metadata?.billItemLabel, item.metadata?.utilityType]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [debitInvoiceItemOptions, chargeItemSearch]);

  const selectedInvoiceItem = useMemo(
    () => debitInvoiceItemOptions.find((item) => item.key === invoiceItemSelection) || null,
    [debitInvoiceItemOptions, invoiceItemSelection]
  );

  const selectedSourceInvoice = useMemo(() => {
    if (noteType === "DEBIT_NOTE") return selectedInvoiceItem?.anchorInvoice || null;
    return sourceInvoiceOptions.find((invoice) => String(invoice?._id || invoice?.sourceInvoiceId || "") === String(sourceInvoiceId)) || null;
  }, [noteType, selectedInvoiceItem, sourceInvoiceId, sourceInvoiceOptions]);

  useEffect(() => {
    if (noteType === "DEBIT_NOTE") {
      if (!selectedInvoiceItem) return;
      setSourceInvoiceId(String(selectedInvoiceItem.anchorInvoiceId || ""));
      setCategory(String(selectedInvoiceItem.category || ""));
      const sourceAccountId =
        selectedInvoiceItem?.anchorInvoice?.chartAccount?._id ||
        selectedInvoiceItem?.anchorInvoice?.chartAccount ||
        "";
      setChartAccountId(sourceAccountId ? String(sourceAccountId) : "");
      return;
    }

    if (!sourceInvoiceId) return;
    const exists = sourceInvoiceOptions.some(
      (invoice) => String(invoice?._id || invoice?.sourceInvoiceId || "") === String(sourceInvoiceId)
    );
    if (!exists) setSourceInvoiceId("");
  }, [noteType, selectedInvoiceItem, sourceInvoiceId, sourceInvoiceOptions]);

  useEffect(() => {
    if (!selectedSourceInvoice) return;
    setCategory(String(selectedSourceInvoice.category || ""));
    const sourceAccountId = selectedSourceInvoice?.chartAccount?._id || selectedSourceInvoice?.chartAccount || "";
    if (sourceAccountId) setChartAccountId(String(sourceAccountId));
  }, [selectedSourceInvoice]);

  useEffect(() => {
    setTenantId("");
    setSourceInvoiceId("");
    setInvoiceItemSelection("");
    setChargeItemSearch("");
    setAmount("");
    setDescription("");
  }, [propertyId, noteType]);

  useEffect(() => {
    setSourceInvoiceId("");
    setInvoiceItemSelection("");
    setChargeItemSearch("");
    setAmount("");
    setDescription("");
  }, [tenantId]);

  const filteredNotes = useMemo(() => {
    const query = String(filters.search || "").trim().toLowerCase();
    return notes.filter((note) => {
      if (filters.noteType && String(note.noteType || "").toUpperCase() !== String(filters.noteType)) return false;
      if (filters.propertyId && resolvePropertyId(note) !== String(filters.propertyId)) return false;
      if (filters.tenantId && resolveTenantId(note) !== String(filters.tenantId)) return false;
      if ((filters.tenantScope || "active") !== "all") {
        const noteTenant = note?.tenant && typeof note.tenant === "object" ? note.tenant : tenantMap.get(resolveTenantId(note));
        if (!tenantMatchesScope(noteTenant, filters.tenantScope || "active")) return false;
      }
      if (filters.status === "active" && !isActiveNote(note)) return false;
      if (filters.status === "reversed" && String(note?.status || "").toLowerCase() !== "reversed") return false;
      if (filters.status === "all") {
        // keep all
      }
      if (!query) return true;
      const haystack = [
        note?.noteNumber,
        note?.sourceInvoiceNumber,
        note?.category,
        note?.description,
        note?.tenant?.name,
        note?.tenantName,
        resolvePropertyName(note, propertyMap),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [notes, filters, propertyMap, tenantMap]);

  const totalPages = Math.max(1, Math.ceil(filteredNotes.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = filteredNotes.length === 0 ? 0 : (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedNotes = filteredNotes.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.search, filters.propertyId, filters.tenantId, filters.tenantScope, filters.noteType, filters.status, filteredNotes.length]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const toggleNoteSelect = (id) => {
    setSelectedNotes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const toggleSelectAllNotes = () => {
    const allIds = paginatedNotes.map((n) => String(n._id));
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedNotes.includes(id));
    setSelectedNotes(allSelected ? [] : allIds);
  };
  const toggleNoteExpand = (id) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const summaryCards = useMemo(() => {
    const activeNotes = filteredNotes.filter(isActiveNote);
    const reversedNotes = filteredNotes.filter(
      (item) => String(item?.status || "").toLowerCase() === "reversed"
    );
    const activeValue = activeNotes.reduce((sum, item) => sum + Number(item?.amount || 0), 0);
    const totalValue = filteredNotes.reduce((sum, item) => sum + Number(item?.amount || 0), 0);

    return {
      totalCount: filteredNotes.length,
      activeCount: activeNotes.length,
      reversedCount: reversedNotes.length,
      activeValue,
      totalValue,
    };
  }, [filteredNotes]);

  // ── Memoised option arrays (prevent re-allocation on every render) ──────────
  const propertySelectOptions = useMemo(
    () => properties.map((p) => ({ value: p._id, label: p.propertyName || p.propertyCode || "Unnamed Property" })),
    [properties]
  );

  const filterTenantOptions = useMemo(
    () => filterScopedTenants.map((t) => buildTenantOption(t)),
    [filterScopedTenants]
  );

  const modalTenantOptions = useMemo(
    () => propertyScopedTenants.map((tenant) => buildTenantOption(tenant)),
    [propertyScopedTenants]
  );

  const sourceInvoiceSelectOptions = useMemo(
    () => sourceInvoiceOptions.map((invoice) => ({
      value: String(invoice._id),
      label: `${invoice.invoiceNumber || "-"} | ${invoice.category || "-"} | ${formatCurrency(invoice.remainingCreditableAmount ?? 0)}`,
    })),
    [sourceInvoiceOptions]
  );

  const debitItemSelectOptions = useMemo(
    () => filteredDebitInvoiceItemOptions.map((item) => ({
      value: item.key,
      label: `${item.label} | ${humanizeCategory(item.category)} | ${item.anchorInvoice?.invoiceNumber || "Standalone"}`,
    })),
    [filteredDebitInvoiceItemOptions]
  );

  const chargeTypeOptions = useMemo(
    () => chargeTypes.map((item) => ({ value: item.value, label: item.label })),
    [chargeTypes]
  );

  const postingAccountOptions = useMemo(
    () => postingAccounts.map((account) => ({ value: account._id, label: `${account.code} - ${account.name}` })),
    [postingAccounts]
  );

  const resetModalForm = () => {
    setPropertyId("");
    setTenantScope("active");
    setTenantId("");
    setSourceInvoiceId("");
    setInvoiceItemSelection("");
    setChargeItemSearch("");
    setAmount("");
    setCategory("");
    setDescription("");
    setNoteDate(todayInput());
    setChartAccountId("");
  };

  const openAddModal = () => {
    resetModalForm();
    setShowAddModal(true);
  };

  const handleSave = async () => {
    if (!currentCompany?._id) return;

    const isCreditNote = noteType === "CREDIT_NOTE";
    const resolvedSourceInvoiceId = isCreditNote
      ? sourceInvoiceId
      : sourceInvoiceId || selectedInvoiceItem?.anchorInvoiceId || "";

    if (!propertyId || !tenantId || !amount || Number(amount) <= 0) {
      toast.error("Property, tenant and a positive amount are required.");
      return;
    }

    if (Number(amount) > 10_000_000) {
      toast.error("Amount exceeds KES 10,000,000 — please verify for any typos.");
      return;
    }

    if (!noteDate) {
      toast.error("Note date is required.");
      return;
    }

    if (new Date(noteDate) > new Date()) {
      toast.error("Note date cannot be in the future.");
      return;
    }

    if (isCreditNote && !resolvedSourceInvoiceId) {
      toast.error("A source invoice is required for credit notes.");
      return;
    }

    if (isCreditNote && selectedSourceInvoice) {
      const sourceAmount = Number(selectedSourceInvoice.amount || 0);
      if (sourceAmount > 0 && Number(amount) > sourceAmount) {
        toast.error(
          `Credit note amount (${formatCurrency(amount)}) exceeds the source invoice total (${formatCurrency(sourceAmount)}). Verify the amount.`
        );
        return;
      }
    }

    if (!isCreditNote && !selectedInvoiceItem) {
      toast.error("Select a charge item for the debit note.");
      return;
    }

    try {
      setSaving(true);
      await createTenantInvoiceNote({
        business: currentCompany._id,
        noteType,
        sourceInvoiceId: resolvedSourceInvoiceId || undefined,
        anchorSourceInvoiceId: !isCreditNote && resolvedSourceInvoiceId ? resolvedSourceInvoiceId : undefined,
        tenantId,
        propertyId,
        amount: Number(amount),
        noteDate,
        description,
        category: category || selectedSourceInvoice?.category,
        chartAccountId: chartAccountId || undefined,
        metadata: !isCreditNote && selectedInvoiceItem
          ? {
              ...(selectedInvoiceItem?.metadata || {}),
              billItemKey:
                selectedInvoiceItem?.metadata?.billItemKey ||
                selectedInvoiceItem?.anchorInvoice?.metadata?.billItemKey ||
                undefined,
              billItemLabel: selectedInvoiceItem?.metadata?.billItemLabel || selectedInvoiceItem?.label || undefined,
              utilityType:
                selectedInvoiceItem?.metadata?.utilityType ||
                selectedInvoiceItem?.anchorInvoice?.metadata?.utilityType ||
                selectedInvoiceItem?.anchorInvoice?.metadata?.meterUtilityType ||
                selectedInvoiceItem?.anchorInvoice?.metadata?.statementUtilityType ||
                undefined,
            }
          : undefined,
      });

      toast.success(`${noteType === "CREDIT_NOTE" ? "Credit" : "Debit"} note created successfully.`);
      setShowAddModal(false);
      resetModalForm();
      clearInvoiceNotesDraft();
      await loadData();
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || error.message || "Failed to create note");
    } finally {
      setSaving(false);
    }
  };

  const handleReverseNote = (note) => {
    const noteId = String(note?._id || "");
    if (!noteId) return;
    setReverseNoteModal({ open: true, note, reason: "", loading: false });
  };

  const handleReverseNoteConfirm = async () => {
    const { note, reason } = reverseNoteModal;
    const noteId = String(note?._id || "");
    setReverseNoteModal((prev) => ({ ...prev, loading: true }));
    try {
      setBusyNoteId(noteId);
      await deleteTenantInvoiceNote(noteId, { business: currentCompany?._id, reason });
      toast.success(`${String(note?.noteType || "").toUpperCase() === "CREDIT_NOTE" ? "Credit" : "Debit"} note reversed successfully.`);
      setReverseNoteModal({ open: false, note: null, reason: "", loading: false });
      await loadData();
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to reverse invoice note");
      setReverseNoteModal((prev) => ({ ...prev, loading: false }));
    } finally {
      setBusyNoteId("");
    }
  };

  const canReverseNote = (note) => isActiveNote(note);

  const noteCountLabel = `${filteredNotes.length} note${filteredNotes.length === 1 ? "" : "s"}`;

  const resetWorkspaceFilters = () => {
    setFilters({
      propertyId: "",
      tenantId: "",
      tenantScope: "active",
      noteType,
      search: "",
      status: "active",
    });
  };

  const handleSearchFilters = () => {
    setCurrentPage(1);
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="h-[calc(100dvh-152px)] max-h-[calc(100dvh-152px)] overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">

            <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
              <div className="filter-bar flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
                <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">Notes: {filteredNotes.length}</span>
                <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Active: {formatCurrency(summaryCards.activeValue)}</span>
                <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Total: {formatCurrency(summaryCards.totalValue)}</span>
                {selectedNotes.length > 0 && <span className="shrink-0 rounded border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">{selectedNotes.length} selected</span>}
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <button type="button" onClick={() => { setNoteType("CREDIT_NOTE"); setFilters((prev) => ({ ...prev, noteType: "CREDIT_NOTE" })); const p = new URLSearchParams(searchParams); p.set("type", "credit"); setSearchParams(p, { replace: true }); }} className={`h-7 shrink-0 rounded px-2.5 text-xs font-semibold ${filters.noteType === "CREDIT_NOTE" ? `${MILIK_GREEN} text-white` : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"}`}>Credit Notes</button>
                <button type="button" onClick={() => { setNoteType("DEBIT_NOTE"); setFilters((prev) => ({ ...prev, noteType: "DEBIT_NOTE" })); const p = new URLSearchParams(searchParams); p.set("type", "debit"); setSearchParams(p, { replace: true }); }} className={`h-7 shrink-0 rounded px-2.5 text-xs font-semibold ${filters.noteType === "DEBIT_NOTE" ? `${MILIK_GREEN} text-white` : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"}`}>Debit Notes</button>
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <input type="text" value={filters.search} onChange={setFilter("search")} placeholder="Search…" className="h-7 w-36 shrink-0 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <AppSelect
                  value={filters.propertyId}
                  onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? "", tenantId: "" }))}
                  options={propertySelectOptions}
                  placeholder="Property"
                  searchable
                  clearable
                  size="sm"
                />
                <AppSelect
                  value={filters.tenantScope || "active"}
                  onChange={(v) => setFilters((prev) => ({ ...prev, tenantScope: v ?? "active", tenantId: "" }))}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "terminated", label: "Terminated" },
                    { value: "all", label: "All Tenants" },
                  ]}
                  size="sm"
                />
                <AppSelect
                  value={filters.tenantId}
                  onChange={(v) => setFilters((prev) => ({ ...prev, tenantId: v ?? "" }))}
                  options={filterTenantOptions}
                  placeholder="Tenant"
                  searchable
                  clearable
                  size="sm"
                />
                <AppSelect
                  value={filters.status}
                  onChange={(v) => setFilters((prev) => ({ ...prev, status: v ?? "" }))}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "reversed", label: "Reversed" },
                    { value: "all", label: "All" },
                  ]}
                  size="sm"
                />
                <button type="button" onClick={handleSearchFilters} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white shadow-sm ${MILIK_ORANGE} hover:bg-[#e67e00]`}><FaSearch size={10} /></button>
                <button type="button" onClick={resetWorkspaceFilters} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white shadow-sm ${MILIK_GREEN} hover:bg-[#0A3127]`}><FaRedoAlt size={10} /></button>
                <button type="button" onClick={loadData} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white shadow-sm ${MILIK_GREEN} hover:bg-[#0A3127]`}><FaRedoAlt size={10} /></button>
                <button type="button" onClick={openAddModal} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white shadow-sm ${MILIK_ORANGE} hover:bg-[#e67e00]`}><FaPlus size={10} /> Add Note</button>
                <button type="button" onClick={() => setShowImportModal(true)} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white shadow-sm ${MILIK_GREEN} hover:bg-[#0A3127]`}><FaUpload size={10} /> Import</button>
                <button
                  type="button"
                  onClick={() => setCommunicationModal({ contextType: "tenant_bulk", recordIds: selectedNoteTenantIds, title: `Notify ${selectedNoteTenantIds.length} Tenant${selectedNoteTenantIds.length !== 1 ? "s" : ""}`, subtitle: "Send credit/debit note notification via SMS.", allowedChannels: ["sms", "email"], defaultChannel: "sms" })}
                  disabled={selectedNoteTenantIds.length === 0}
                  title={selectedNotes.length === 0 ? "Select notes to SMS tenants" : `SMS ${selectedNoteTenantIds.length} tenant${selectedNoteTenantIds.length !== 1 ? "s" : ""}`}
                  className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white shadow-sm ${selectedNoteTenantIds.length > 0 ? "bg-teal-600 hover:bg-teal-700" : "bg-gray-400 cursor-not-allowed"}`}
                ><FaSms size={10} /></button>
                <button
                  type="button"
                  onClick={() => setCommunicationModal({ contextType: "tenant_bulk", recordIds: selectedNoteTenantIds, title: `Email ${selectedNoteTenantIds.length} Tenant${selectedNoteTenantIds.length !== 1 ? "s" : ""}`, subtitle: "Send credit/debit note notification via email.", allowedChannels: ["email"], defaultChannel: "email" })}
                  disabled={selectedNoteTenantIds.length === 0}
                  title={selectedNotes.length === 0 ? "Select notes to email tenants" : `Email ${selectedNoteTenantIds.length} tenant${selectedNoteTenantIds.length !== 1 ? "s" : ""}`}
                  className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white shadow-sm ${selectedNoteTenantIds.length > 0 ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400 cursor-not-allowed"}`}
                ><FaEnvelope size={10} /></button>
              </div>
            </div>

            {/* ── TABLE ── */}
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              <table className="w-full min-w-[1320px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className={`${MILIK_GREEN} text-white`}>
                    <th className="px-3 py-2 text-left border-r border-white/10">
                      <input
                        type="checkbox"
                        checked={paginatedNotes.length > 0 && paginatedNotes.every((n) => selectedNotes.includes(String(n._id)))}
                        onChange={toggleSelectAllNotes}
                        className="accent-emerald-500"
                      />
                    </th>
                    <th className="w-6 px-1 py-2 border-r border-white/10" />
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Note #</th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Tenant</th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Property</th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Unit</th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Description</th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Type</th>
                    <th className="px-3 py-2 text-center font-bold border-r border-white/10">Note Date</th>
                    <th className="px-3 py-2 text-center font-bold border-r border-white/10">Source Invoice</th>
                    <th className="px-3 py-2 text-right font-bold border-r border-white/10">Amount</th>
                    <th className="px-3 py-2 text-center font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-2 text-center font-bold border-r border-white/10">Payment</th>
                    <th className="px-3 py-2 text-center font-bold border-r border-white/10">Created</th>
                    <th className="px-3 py-2 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNotes.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="px-4 py-8 text-center text-gray-500">
                        <FaFileInvoice className="mb-2 inline-block text-4xl text-gray-300" />
                        <p className="mt-1 text-sm font-semibold">No invoice notes found</p>
                        <p className="mt-1 text-xs text-gray-400">{loading ? "Loading..." : "Adjust filters or add a new note."}</p>
                      </td>
                    </tr>
                  ) : (
                    paginatedNotes.map((note, index) => {
                      const noteId = String(note._id);
                      const isNoteSelected = selectedNotes.includes(noteId);
                      const isNoteExpanded = expandedNotes.has(noteId);
                      const paymentState = getNotePaymentState(note);
                      return (
                        <React.Fragment key={noteId}>
                          <tr
                            className={`cursor-pointer border-b border-gray-100 transition-colors ${
                              isNoteSelected
                                ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E] hover:bg-emerald-50"
                                : index % 2 === 0
                                  ? "bg-white hover:bg-blue-50/40"
                                  : "bg-slate-50/60 hover:bg-blue-50/40"
                            }`}
                            onClick={() => toggleNoteSelect(noteId)}
                          >
                            <td className="px-3 py-1 border-r border-gray-100 text-slate-600">
                              <input
                                type="checkbox"
                                checked={isNoteSelected}
                                onChange={() => toggleNoteSelect(noteId)}
                                onClick={(event) => event.stopPropagation()}
                                className="accent-emerald-500"
                              />
                            </td>
                            <td
                              className="w-6 cursor-pointer px-1 py-1 border-r border-gray-100 text-center text-slate-400"
                              onClick={(event) => { event.stopPropagation(); toggleNoteExpand(noteId); }}
                            >
                              {isNoteExpanded ? "▼" : "▶"}
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100">
                              <p className="font-semibold text-blue-700">{note.noteNumber || note.invoiceNumber}</p>
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{note?.tenant?.name || note?.tenantName || "-"}</td>
                            <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{resolvePropertyName(note, propertyMap)}</td>
                            <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{resolveUnitName(note, tenantMap)}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-orange-700">{note.description || note.metadata?.billItemLabel || `${humanizeCategory(note.noteType || note.documentType)} - ${humanizeCategory(note.category || "Charge")}`}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-slate-700">
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{humanizeCategory(note.category || "-")}</span>
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100 text-center text-slate-700">{fmtDate(note.noteDate || note.invoiceDate || note.createdAt)}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-center text-slate-700">{note.sourceInvoiceNumber || note?.sourceInvoice?.invoiceNumber || "-"}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-slate-900">{formatCurrency(note.amount)}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-center">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${getStatusChip(note?.status)}`}>
                                {note?.status || "posted"}
                              </span>
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100 text-center">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${paymentState.className}`}>
                                {paymentState.label}
                              </span>
                            </td>
                            <td className="px-3 py-1 border-r border-gray-100 text-center text-slate-700">{fmtDate(note.createdAt || note.noteDate || note.invoiceDate)}</td>
                            <td className="px-3 py-1 text-right" onClick={(event) => event.stopPropagation()}>
                              {canReverseNote(note) ? (
                                <button
                                  type="button"
                                  onClick={() => handleReverseNote(note)}
                                  disabled={busyNoteId === noteId}
                                  className="rounded p-1 text-amber-600 hover:bg-amber-50 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-40"
                                  title={String(note?.noteType || "").toUpperCase() === "DEBIT_NOTE" ? "Reverse this debit note only if it is still unpaid" : "Reverse this credit note and restore the source invoice amount"}
                                >
                                  <FaUndo size={12} />
                                </button>
                              ) : (
                                <span
                                  className="inline-flex cursor-not-allowed rounded p-1 text-slate-300"
                                  title={
                                    String(note?.status || "").toLowerCase() === "reversed"
                                      ? "Already reversed"
                                      : "Cannot reverse a cancelled note"
                                  }
                                >
                                  <FaUndo size={12} />
                                </span>
                              )}
                            </td>
                          </tr>
                          {isNoteExpanded && (
                            <tr className="border-b border-gray-200 bg-gray-100">
                              <td colSpan={15} className="px-3 py-2">
                                <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-4">
                                  <div>
                                    <span className="font-black uppercase tracking-[0.12em] text-emerald-700">Note Details</span>
                                    <p className="mt-1 font-semibold text-slate-900">{note.noteNumber || note.invoiceNumber}</p>
                                    <p className="text-slate-600">{fmtDate(note.noteDate || note.invoiceDate || note.createdAt)}</p>
                                    <p className="text-slate-600">{humanizeCategory(note.noteType || note.documentType)}</p>
                                  </div>
                                  <div>
                                    <span className="font-black uppercase tracking-[0.12em] text-blue-700">Source Invoice</span>
                                    <p className="mt-1 font-semibold text-slate-900">{note.sourceInvoiceNumber || note?.sourceInvoice?.invoiceNumber || "-"}</p>
                                    <p className="text-slate-600">{humanizeCategory(note.category || "-")}</p>
                                    <p className="font-semibold text-[#0B3B2E]">{formatCurrency(note.amount)}</p>
                                  </div>
                                  <div>
                                    <span className="font-black uppercase tracking-[0.12em] text-amber-700">Tenant & Property</span>
                                    <p className="mt-1 font-semibold text-slate-900">{note?.tenant?.name || note?.tenantName || "-"}</p>
                                    <p className="text-slate-600">{resolvePropertyName(note, propertyMap)}</p>
                                    <p className="text-slate-600">{resolveUnitName(note, tenantMap)}</p>
                                  </div>
                                  <div>
                                    <span className="font-black uppercase tracking-[0.12em] text-violet-700">Description & Status</span>
                                    <p className="mt-1 text-slate-700">{note.description || note.metadata?.billItemLabel || `${humanizeCategory(note.noteType || note.documentType)} - ${humanizeCategory(note.category || "Charge")}`}</p>
                                    <p className="mt-1 flex flex-wrap gap-1">
                                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${getStatusChip(note?.status)}`}>
                                        {note?.status || "posted"}
                                      </span>
                                      <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-semibold ${paymentState.className}`}>
                                        {paymentState.label}
                                      </span>
                                    </p>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* ── FOOTER PAGINATION ── */}
            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
              <p>
                <span className="font-semibold">Showing:</span>{" "}
                {filteredNotes.length === 0 ? 0 : startIndex + 1}
                {" – "}
                {Math.min(endIndex, filteredNotes.length)} of {filteredNotes.length} note{filteredNotes.length === 1 ? "" : "s"}
                {filters.status !== "all" ? ` · Status: ${filters.status}` : ""}
              </p>
              <div className="flex items-center gap-3">
                <p>
                  <span className="font-semibold">Selected:</span> {selectedNotes.length}
                  {filteredNotes.length > 0 && (
                    <>
                      {" · "}
                      <span className="font-semibold">Total:</span> {formatCurrency(summaryCards.totalValue)}
                    </>
                  )}
                </p>
                <div className="h-4 w-px bg-slate-300" />
                <span className="text-slate-500">Per page: {ITEMS_PER_PAGE}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={safeCurrentPage === 1}
                    className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="rounded border border-slate-200 bg-white px-2.5 py-0.5 font-semibold text-slate-700">
                    Page {safeCurrentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={safeCurrentPage === totalPages}
                    className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAddModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
            <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between bg-[#0B3B2E] px-5 py-3 text-white">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100">Add invoice note</p>
                  <h3 className="text-sm font-black uppercase tracking-wide">{noteType === "CREDIT_NOTE" ? "Credit Note" : "Debit Note"}</h3>
                </div>
                <button onClick={() => !saving && setShowAddModal(false)} className="text-white/70 transition-colors hover:text-white">
                  <FaTimes />
                </button>
              </div>

              <div className="max-h-[calc(92vh-78px)] overflow-y-auto px-5 py-5">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="space-y-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <span>Note Type</span>
                    <AppSelect
                      value={noteType}
                      onChange={(v) => {
                        const nextValue = v ?? "CREDIT_NOTE";
                        setNoteType(nextValue);
                        const nextParams = new URLSearchParams(searchParams);
                        nextParams.set("type", nextValue === "DEBIT_NOTE" ? "debit" : "credit");
                        setSearchParams(nextParams, { replace: true });
                      }}
                      options={[
                        { value: "CREDIT_NOTE", label: "Credit Note" },
                        { value: "DEBIT_NOTE", label: "Debit Note" },
                      ]}
                      size="md"
                    />
                  </label>

                  <label className="space-y-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <span>Property</span>
                    <AppSelect
                      value={propertyId}
                      onChange={(v) => setPropertyId(v ?? "")}
                      options={propertySelectOptions}
                      placeholder="Select property"
                      searchable
                      size="md"
                    />
                  </label>

                  <label className="space-y-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <span>Date</span>
                    <input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                  </label>

                  <label className="space-y-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <span>Tenant</span>
                    <AppSelect
                      value={tenantScope}
                      onChange={(v) => setTenantScope(v ?? "active")}
                      options={[
                        { value: "active", label: "Active tenants" },
                        { value: "terminated", label: "Terminated tenants" },
                        { value: "all", label: "All tenants" },
                      ]}
                      disabled={!propertyId}
                      size="md"
                    />
                    <AppSelect
                      value={tenantId}
                      onChange={(v) => setTenantId(v ?? "")}
                      options={modalTenantOptions}
                      placeholder={propertyId ? "Select tenant" : "Select property first"}
                      searchable
                      disabled={!propertyId}
                      size="md"
                    />
                    {tenantScope === "terminated" ? (
                      <p className="text-[11px] font-semibold text-amber-700">You are selecting from terminated tenants for a deliberate final adjustment.</p>
                    ) : null}
                  </label>

                  {noteType === "CREDIT_NOTE" ? (
                    <label className="space-y-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-500 md:col-span-2">
                      <span>Source Invoice</span>
                      <AppSelect
                        value={sourceInvoiceId}
                        onChange={(v) => setSourceInvoiceId(v ?? "")}
                        options={sourceInvoiceSelectOptions}
                        placeholder={tenantId ? (sourceInvoiceOptions.length ? "Select source invoice" : "No matching open posted invoices") : "Select tenant first"}
                        searchable
                        disabled={!tenantId}
                        size="md"
                      />
                    </label>
                  ) : (
                    <label className="space-y-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-500 md:col-span-2">
                      <span>Charge Item</span>
                      <input
                        type="text"
                        value={chargeItemSearch}
                        onChange={(e) => setChargeItemSearch(e.target.value)}
                        disabled={!tenantId}
                        placeholder="Search rent month, utility, deposit, late payment..."
                        className="mb-2 w-full border border-slate-200 bg-white px-3 py-1.5 text-xs normal-case text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 disabled:bg-slate-50 disabled:cursor-not-allowed"
                      />
                      <AppSelect
                        value={invoiceItemSelection}
                        onChange={(v) => setInvoiceItemSelection(v ?? "")}
                        options={debitItemSelectOptions}
                        placeholder={tenantId ? (debitInvoiceItemOptions.length ? "Select charge item" : "No charge items available") : "Select tenant first"}
                        disabled={!tenantId}
                        searchable
                        size="md"
                      />
                    </label>
                  )}

                  {noteType === "CREDIT_NOTE" ? (
                    <label className="space-y-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                      <span>Charge Type</span>
                      <AppSelect
                        value={category}
                        onChange={(v) => setCategory(v ?? "")}
                        options={chargeTypeOptions}
                        placeholder="Select charge type"
                        searchable
                        size="md"
                      />
                    </label>
                  ) : (
                    <label className="space-y-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                      <span>Charge Category</span>
                      <input
                        type="text"
                        value={selectedInvoiceItem ? humanizeCategory(selectedInvoiceItem.category) : ""}
                        readOnly
                        className="w-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none"
                      />
                    </label>
                  )}

                  <label className="space-y-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <span>Amount</span>
                    <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                  </label>

                  <label className="space-y-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-500 xl:col-span-3">
                    <span>Posting Account (optional)</span>
                    <AppSelect
                      value={chartAccountId}
                      onChange={(v) => setChartAccountId(v ?? "")}
                      options={postingAccountOptions}
                      placeholder="Use existing charge mapping"
                      searchable
                      size="md"
                    />
                  </label>

                  <label className="space-y-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-500 xl:col-span-3">
                    <span>Description</span>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs normal-case text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                  </label>
                </div>

                {selectedSourceInvoice ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <p><span className="font-semibold">{noteType === "CREDIT_NOTE" ? "Source Invoice" : "Linked Invoice"}:</span> {selectedSourceInvoice.invoiceNumber}</p>
                    <p><span className="font-semibold">Property:</span> {resolvePropertyName(selectedSourceInvoice, propertyMap)}</p>
                    <p><span className="font-semibold">Original Amount:</span> {formatCurrency(selectedSourceInvoice.amount)}</p>
                    <p><span className="font-semibold">Net Amount:</span> {formatCurrency(selectedSourceInvoice.netAmount ?? selectedSourceInvoice.amount)}</p>
                    {noteType === "CREDIT_NOTE" ? (
                      <p><span className="font-semibold">Remaining Creditable:</span> {formatCurrency(selectedSourceInvoice.remainingCreditableAmount ?? 0)}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="border border-slate-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
                  <FaSave /> {saving ? "Saving..." : `Save ${noteType === "CREDIT_NOTE" ? "Credit" : "Debit"} Note`}
                </button>
              </div>
            </div>
          </div>
        ) : null}

      <CommunicationComposerModal
        open={Boolean(communicationModal)}
        onClose={() => setCommunicationModal(null)}
        businessId={currentCompany?._id || ""}
        contextType={communicationModal?.contextType || "tenant_bulk"}
        recordIds={communicationModal?.recordIds || []}
        title={communicationModal?.title || "Send Notification"}
        subtitle={communicationModal?.subtitle || "Preview and send credit/debit note notification."}
        allowedChannels={communicationModal?.allowedChannels || ["sms", "email"]}
        defaultChannel={communicationModal?.defaultChannel || "sms"}
      />

      {reverseNoteModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 backdrop-blur-[2px] px-4">
          <div className="bg-white shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="bg-[#0B3B2E] px-6 py-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center bg-white/15">
                <FaUndo className="text-white text-sm" />
              </div>
              <div>
                <h2 className="text-sm font-black uppercase tracking-wide text-white">
                  Reverse {String(reverseNoteModal.note?.noteType || "").toUpperCase() === "CREDIT_NOTE" ? "Credit" : "Debit"} Note
                </h2>
                <p className="text-white/60 text-xs mt-0.5">{reverseNoteModal.note?.noteNumber || ""}</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <FaRedoAlt className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-800">This will reverse the note and post offsetting ledger entries. This action cannot be undone.</p>
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">Reason (optional)</label>
                <textarea
                  rows={3}
                  autoFocus
                  className="w-full resize-none border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm normal-case text-slate-800 placeholder-slate-400 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  placeholder="Add an optional reason for the audit trail…"
                  value={reverseNoteModal.reason}
                  onChange={(e) => setReverseNoteModal((prev) => ({ ...prev, reason: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReverseNoteConfirm(); } }}
                  disabled={reverseNoteModal.loading}
                />
              </div>
            </div>
            <div className="px-6 pb-5 flex justify-end gap-3">
              <button onClick={() => setReverseNoteModal({ open: false, note: null, reason: "", loading: false })} disabled={reverseNoteModal.loading} className="border border-slate-300 bg-white px-4 py-2 text-sm font-medium uppercase tracking-wide text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={handleReverseNoteConfirm} disabled={reverseNoteModal.loading} className="bg-red-600 hover:bg-red-700 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-white transition-colors disabled:opacity-60 flex items-center gap-2">
                {reverseNoteModal.loading ? <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>Reversing…</> : <><FaUndo className="text-xs" />Confirm Reversal</>}
              </button>
            </div>
          </div>
        </div>
      )}

      <InvoiceNotesImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={async (notes) => {
          const result = await bulkImportInvoiceNotes({ notes });
          if ((result?.data?.successful?.length ?? 0) > 0) {
            await loadData();
          }
          return result;
        }}
      />
    </DashboardLayout>
  );
};

export default InvoiceNotes;

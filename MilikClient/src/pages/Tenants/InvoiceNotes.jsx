import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { LISTING_UI } from "../../utils/listingPageUtils";
import {
  FaFileInvoice,
  FaPlus,
  FaRedoAlt,
  FaSave,
  FaSearch,
  FaTimes,
  FaUndo,
} from "react-icons/fa";
import toast from "react-hot-toast";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenants } from "../../redux/tenantsRedux";
import { getChartOfAccounts, getTenantInvoices } from "../../redux/apiCalls";
import {
  createTenantInvoiceNote,
  deleteTenantInvoiceNote,
  getCreditableTenantInvoices,
  getTenantInvoiceNoteChargeTypes,
  getTenantInvoiceNotes,
} from "../../redux/invoiceApi";
import { adminRequests } from "../../utils/requestMethods";
import useScopedSessionDraft, { buildScopedDraftKey } from "../../hooks/useScopedSessionDraft";

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

const formatDate = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString();
};

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
    metadata: { billItemKey: "service_charge", billItemLabel: "Service Charge" },
  },
  {
    key: "standalone-late-payment",
    label: "Late Payment",
    category: "LATE_PENALTY_CHARGE",
    metadata: { billItemKey: "late_payment", billItemLabel: "Late Payment", standaloneDebitNote: true, includeInLandlordStatement: true },
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
    metadata: { billItemKey: "lease_fee", billItemLabel: "Lease Fee" },
  },
  {
    key: "standalone-other-charge",
    label: "Other Charge",
    category: "OTHER_CHARGE",
    metadata: { billItemKey: "other_charge", billItemLabel: "Other Charge" },
  },
];

const InvoiceNotes = () => {
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentCompany } = useSelector((state) => state.company || {});
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null);
  const tenants = useSelector((state) => state.tenant?.tenants || []);

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
  const [currentPage, setCurrentPage] = useState(1);
  const filters = invoiceNotesDraft.filters || { propertyId: "", tenantId: "", tenantScope: "active", noteType: initialNoteType, search: "", status: "active" };
  const setFilters = (value) => setInvoiceNotesDraft((prev) => ({ ...prev, filters: typeof value === "function" ? value(prev.filters || filters) : value }));
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

  const propertyMap = useMemo(
    () => new Map((properties || []).map((item) => [String(item?._id || ""), item])),
    [properties]
  );

  const loadData = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const [
        propertiesRes,
        creditable,
        invoices,
        noteRows,
        types,
        accounts,
      ] = await Promise.all([
        adminRequests.get(`/properties?business=${currentCompany._id}&limit=1000`),
        getCreditableTenantInvoices({ business: currentCompany._id }),
        getTenantInvoices({ business: currentCompany._id }),
        getTenantInvoiceNotes({ business: currentCompany._id }),
        getTenantInvoiceNoteChargeTypes(),
        getChartOfAccounts({ business: currentCompany._id }),
        dispatch(getTenants({ business: currentCompany._id })),
      ]);

      setProperties(normalizeList(propertiesRes.data));
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
  };

  useEffect(() => {
    loadData();
  }, [currentCompany?._id]);

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
        includeInLandlordStatement: true,
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

    if (isCreditNote && !resolvedSourceInvoiceId) {
      toast.error("A source invoice is required for credit notes.");
      return;
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

  const handleReverseNote = async (note) => {
    const noteId = String(note?._id || "");
    if (!noteId) return;
    const reason = window.prompt(`Reverse ${note.noteNumber || "this note"}? Add an optional reason for the audit trail.`) || "";
    try {
      setBusyNoteId(noteId);
      await deleteTenantInvoiceNote(noteId, { business: currentCompany?._id, reason });
      toast.success(`${String(note?.noteType || "").toUpperCase() === "CREDIT_NOTE" ? "Credit" : "Debit"} note reversed successfully.`);
      await loadData();
      window.dispatchEvent(new Event("invoicesUpdated"));
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to reverse invoice note");
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

            {/* ── STICKY HEADER ── */}
            <div className="sticky top-0 z-30 shrink-0 border-b border-gray-200 bg-gray-50/95 p-2 shadow-sm backdrop-blur">

              {/* Row 1 – summary chips */}
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  Total Notes: {filteredNotes.length}
                </span>
                <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Active: {formatCurrency(summaryCards.activeValue)}
                </span>
                <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                  Total Value: {formatCurrency(summaryCards.totalValue)}
                </span>
                {selectedNotes.length > 0 && (
                  <span className="inline-flex items-center rounded-md border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                    {selectedNotes.length} selected
                  </span>
                )}
              </div>

              {/* Row 2 – note type toggles */}
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setNoteType("CREDIT_NOTE"); setFilters((prev) => ({ ...prev, noteType: "CREDIT_NOTE" })); const p = new URLSearchParams(searchParams); p.set("type", "credit"); setSearchParams(p, { replace: true }); }}
                  className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${filters.noteType === "CREDIT_NOTE" ? `${MILIK_GREEN} text-white` : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"}`}
                >
                  Credit Notes
                </button>
                <button
                  type="button"
                  onClick={() => { setNoteType("DEBIT_NOTE"); setFilters((prev) => ({ ...prev, noteType: "DEBIT_NOTE" })); const p = new URLSearchParams(searchParams); p.set("type", "debit"); setSearchParams(p, { replace: true }); }}
                  className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${filters.noteType === "DEBIT_NOTE" ? `${MILIK_GREEN} text-white` : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"}`}
                >
                  Debit Notes
                </button>
              </div>

              {/* Row 3 – filters + action buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400" />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Search note, tenant, property..."
                    className="rounded border border-gray-300 py-1 pl-8 pr-3 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                  />
                </div>
                <select
                  value={filters.propertyId}
                  onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value, tenantId: "" }))}
                  className={LISTING_UI.filterSelect}
                >
                  <option value="">All properties</option>
                  {properties.map((p) => (
                    <option key={p._id} value={p._id}>{p.propertyName || p.propertyCode || "Unnamed Property"}</option>
                  ))}
                </select>
                <select
                  value={filters.tenantScope || "active"}
                  onChange={(e) => setFilters((prev) => ({ ...prev, tenantScope: e.target.value, tenantId: "" }))}
                  className={LISTING_UI.filterSelect}
                >
                  <option value="active">Active tenants</option>
                  <option value="terminated">Terminated tenants</option>
                  <option value="all">All tenants</option>
                </select>
                <select
                  value={filters.tenantId}
                  onChange={(e) => setFilters((prev) => ({ ...prev, tenantId: e.target.value }))}
                  className={LISTING_UI.filterSelect}
                >
                  <option value="">All tenants</option>
                  {filterScopedTenants.map((t) => (
                    <option key={t._id} value={t._id}>{getTenantDisplayName(t)} ({getTenantStatusLabel(t)})</option>
                  ))}
                </select>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                  className={LISTING_UI.filterSelect}
                >
                  <option value="active">Active only</option>
                  <option value="reversed">Reversed</option>
                  <option value="all">All statuses</option>
                </select>
                <button
                  type="button"
                  onClick={handleSearchFilters}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_ORANGE} hover:bg-[#e67e00]`}
                >
                  <FaSearch className="text-xs" /> Search
                </button>
                <button
                  type="button"
                  onClick={resetWorkspaceFilters}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_GREEN} hover:bg-[#0A3127]`}
                >
                  <FaRedoAlt className="text-xs" /> Reset
                </button>
                <button
                  type="button"
                  onClick={loadData}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_GREEN} hover:bg-[#0A3127]`}
                >
                  <FaRedoAlt className="text-xs" /> Refresh
                </button>
                <button
                  type="button"
                  onClick={openAddModal}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1 text-xs text-white shadow-sm ${MILIK_ORANGE} hover:bg-[#e67e00]`}
                >
                  <FaPlus className="text-xs" /> Add Note
                </button>
              </div>
            </div>

            {/* ── TABLE ── */}
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              <table className="w-full min-w-[1320px] text-xs">
                <thead>
                  <tr className={`${MILIK_GREEN} sticky top-0 z-10 text-white`}>
                    <th className="px-3 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={paginatedNotes.length > 0 && paginatedNotes.every((n) => selectedNotes.includes(String(n._id)))}
                        onChange={toggleSelectAllNotes}
                        className="accent-emerald-500"
                      />
                    </th>
                    <th className="w-6 px-1 py-2" />
                    <th className="px-3 py-2 text-left font-semibold">Note #</th>
                    <th className="px-3 py-2 text-left font-semibold">Tenant</th>
                    <th className="px-3 py-2 text-left font-semibold">Property</th>
                    <th className="px-3 py-2 text-left font-semibold">Unit</th>
                    <th className="px-3 py-2 text-left font-semibold">Description</th>
                    <th className="px-3 py-2 text-left font-semibold">Type</th>
                    <th className="px-3 py-2 text-center font-semibold">Note Date</th>
                    <th className="px-3 py-2 text-center font-semibold">Source Invoice</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 text-center font-semibold">Status</th>
                    <th className="px-3 py-2 text-center font-semibold">Payment</th>
                    <th className="px-3 py-2 text-center font-semibold">Created</th>
                    <th className="px-3 py-2 text-right font-semibold">Actions</th>
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
                            className={`cursor-pointer border-b border-slate-200 transition-colors ${
                              isNoteSelected
                                ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E] hover:bg-emerald-50"
                                : index % 2 === 0
                                  ? "bg-white hover:bg-blue-50/40"
                                  : "bg-slate-50 hover:bg-blue-50/40"
                            }`}
                            onClick={() => toggleNoteSelect(noteId)}
                          >
                            <td className="px-3 py-2 text-slate-600">
                              <input
                                type="checkbox"
                                checked={isNoteSelected}
                                onChange={() => toggleNoteSelect(noteId)}
                                onClick={(event) => event.stopPropagation()}
                                className="accent-emerald-500"
                              />
                            </td>
                            <td
                              className="w-6 cursor-pointer px-1 py-2 text-center text-slate-400"
                              onClick={(event) => { event.stopPropagation(); toggleNoteExpand(noteId); }}
                            >
                              {isNoteExpanded ? "▼" : "▶"}
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-semibold text-blue-700">{note.noteNumber || note.invoiceNumber}</p>
                            </td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{note?.tenant?.name || note?.tenantName || "-"}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{resolvePropertyName(note, propertyMap)}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{resolveUnitName(note, tenantMap)}</td>
                            <td className="px-3 py-2 text-orange-700">{note.description || `${humanizeCategory(note.noteType || note.documentType)} - ${humanizeCategory(note.category || "Charge")}`}</td>
                            <td className="px-3 py-2 text-slate-700">
                              <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{humanizeCategory(note.category || "-")}</span>
                            </td>
                            <td className="px-3 py-2 text-center text-slate-700">{formatDate(note.noteDate || note.invoiceDate || note.createdAt)}</td>
                            <td className="px-3 py-2 text-center text-slate-700">{note.sourceInvoiceNumber || note?.sourceInvoice?.invoiceNumber || "-"}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(note.amount)}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase ${getStatusChip(note?.status)}`}>
                                {note?.status || "posted"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-semibold ${paymentState.className}`}>
                                {paymentState.label}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center text-slate-700">{formatDate(note.createdAt || note.noteDate || note.invoiceDate)}</td>
                            <td className="px-3 py-2 text-right" onClick={(event) => event.stopPropagation()}>
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
                                <span className="text-[11px] text-slate-400">—</span>
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
                                    <p className="text-slate-600">{formatDate(note.noteDate || note.invoiceDate || note.createdAt)}</p>
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
                                    <p className="mt-1 text-slate-700">{note.description || `${humanizeCategory(note.noteType || note.documentType)} - ${humanizeCategory(note.category || "Charge")}`}</p>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
            <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-slate-500">Add invoice note</p>
                  <h3 className="mt-1 text-lg font-bold text-slate-900">{noteType === "CREDIT_NOTE" ? "Credit Note" : "Debit Note"}</h3>
                  <p className="mt-1 text-sm text-slate-500">Select property first, then tenant. Credit notes must point to a source invoice. Debit notes can adjust an existing invoice or create a standalone charge.</p>
                </div>
                <button onClick={() => !saving && setShowAddModal(false)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-white hover:text-slate-800">
                  <FaTimes />
                </button>
              </div>

              <div className="max-h-[calc(92vh-78px)] overflow-y-auto px-5 py-5">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="space-y-1.5 text-sm font-medium text-slate-700">
                    <span>Note Type</span>
                    <select
                      value={noteType}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setNoteType(nextValue);
                        const nextParams = new URLSearchParams(searchParams);
                        nextParams.set("type", nextValue === "DEBIT_NOTE" ? "debit" : "credit");
                        setSearchParams(nextParams, { replace: true });
                      }}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none"
                    >
                      <option value="CREDIT_NOTE">Credit Note</option>
                      <option value="DEBIT_NOTE">Debit Note</option>
                    </select>
                  </label>

                  <label className="space-y-1.5 text-sm font-medium text-slate-700">
                    <span>Property</span>
                    <select
                      value={propertyId}
                      onChange={(e) => setPropertyId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none"
                    >
                      <option value="">Select property</option>
                      {properties.map((property) => (
                        <option key={property._id} value={property._id}>{property.propertyName || property.propertyCode || "Unnamed Property"}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5 text-sm font-medium text-slate-700">
                    <span>Date</span>
                    <input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none" />
                  </label>

                  <label className="space-y-1.5 text-sm font-medium text-slate-700">
                    <span>Tenant</span>
                    <select value={tenantScope} onChange={(e) => setTenantScope(e.target.value)} disabled={!propertyId} className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none disabled:bg-slate-100">
                      <option value="active">Active tenants</option>
                      <option value="terminated">Terminated tenants</option>
                      <option value="all">All tenants</option>
                    </select>
                    <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} disabled={!propertyId} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none disabled:bg-slate-100">
                      <option value="">{propertyId ? "Select tenant" : "Select property first"}</option>
                      {propertyScopedTenants.map((tenant) => (
                        <option key={tenant._id} value={tenant._id}>{getTenantDisplayName(tenant)} ({getTenantStatusLabel(tenant)})</option>
                      ))}
                    </select>
                    {tenantScope === "terminated" ? (
                      <p className="text-[11px] font-semibold text-amber-700">You are selecting from terminated tenants for a deliberate final adjustment.</p>
                    ) : null}
                  </label>

                  {noteType === "CREDIT_NOTE" ? (
                    <label className="space-y-1.5 text-sm font-medium text-slate-700 md:col-span-2">
                      <span>Source Invoice</span>
                      <select value={sourceInvoiceId} onChange={(e) => setSourceInvoiceId(e.target.value)} disabled={!tenantId} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none disabled:bg-slate-100">
                        <option value="">{tenantId ? (sourceInvoiceOptions.length ? "Select source invoice" : "No matching open posted invoices") : "Select tenant first"}</option>
                        {sourceInvoiceOptions.map((invoice) => (
                          <option key={invoice._id} value={invoice._id}>
                            {(invoice.invoiceNumber || "-")} | {(invoice.category || "-")} | {formatCurrency(invoice.remainingCreditableAmount ?? 0)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="space-y-1.5 text-sm font-medium text-slate-700 md:col-span-2">
                      <span>Charge Item</span>
                      <input
                        type="text"
                        value={chargeItemSearch}
                        onChange={(e) => setChargeItemSearch(e.target.value)}
                        disabled={!tenantId}
                        placeholder="Search rent month, utility, deposit, late payment..."
                        className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none disabled:bg-slate-100"
                      />
                      <select value={invoiceItemSelection} onChange={(e) => setInvoiceItemSelection(e.target.value)} disabled={!tenantId} size={Math.min(8, Math.max(3, filteredDebitInvoiceItemOptions.length + 1))} className="max-h-56 w-full overflow-y-auto rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none disabled:bg-slate-100">
                        <option value="">{tenantId ? (debitInvoiceItemOptions.length ? "Select charge item" : "No charge items available") : "Select tenant first"}</option>
                        {filteredDebitInvoiceItemOptions.map((item) => (
                          <option key={item.key} value={item.key}>
                            {item.label} | {humanizeCategory(item.category)} | {item.anchorInvoice?.invoiceNumber || "Standalone"}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {noteType === "CREDIT_NOTE" ? (
                    <label className="space-y-1.5 text-sm font-medium text-slate-700">
                      <span>Charge Type</span>
                      <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none">
                        <option value="">Select charge type</option>
                        {chargeTypes.map((item) => (
                          <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="space-y-1.5 text-sm font-medium text-slate-700">
                      <span>Charge Category</span>
                      <input
                        type="text"
                        value={selectedInvoiceItem ? humanizeCategory(selectedInvoiceItem.category) : ""}
                        readOnly
                        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none"
                      />
                    </label>
                  )}

                  <label className="space-y-1.5 text-sm font-medium text-slate-700">
                    <span>Amount</span>
                    <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none" />
                  </label>

                  <label className="space-y-1.5 text-sm font-medium text-slate-700 xl:col-span-3">
                    <span>Posting Account (optional)</span>
                    <select value={chartAccountId} onChange={(e) => setChartAccountId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none">
                      <option value="">Use existing charge mapping</option>
                      {postingAccounts.map((account) => (
                        <option key={account._id} value={account._id}>{account.code} - {account.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5 text-sm font-medium text-slate-700 xl:col-span-3">
                    <span>Description</span>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none" />
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
                <button type="button" onClick={() => setShowAddModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
                  <FaSave /> {saving ? "Saving..." : `Save ${noteType === "CREDIT_NOTE" ? "Credit" : "Debit"} Note`}
                </button>
              </div>
            </div>
          </div>
        ) : null}
    </DashboardLayout>
  );
};

export default InvoiceNotes;

import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
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
const getStatusChip = (status) => {
  const normalized = String(status || "draft").toLowerCase();
  if (normalized === "posted") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "reversed") return "border-amber-200 bg-amber-50 text-amber-700";
  if (normalized === "cancelled") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
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

const InvoiceNotes = () => {
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentCompany } = useSelector((state) => state.company || {});
  const tenants = useSelector((state) => state.tenant?.tenants || []);

  const requestedType = String(searchParams.get("type") || "").trim().toLowerCase();
  const initialNoteType = requestedType === "debit" ? "DEBIT_NOTE" : "CREDIT_NOTE";

  const [properties, setProperties] = useState([]);
  const [noteType, setNoteType] = useState(initialNoteType);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({
    propertyId: "",
    tenantId: "",
    noteType: initialNoteType,
    search: "",
    status: "active",
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [sourceInvoiceId, setSourceInvoiceId] = useState("");
  const [invoiceItemSelection, setInvoiceItemSelection] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [noteDate, setNoteDate] = useState(todayInput());
  const [chartAccountId, setChartAccountId] = useState("");
  const [openInvoices, setOpenInvoices] = useState([]);
  const [anchorInvoices, setAnchorInvoices] = useState([]);
  const [notes, setNotes] = useState([]);
  const [chargeTypes, setChargeTypes] = useState([]);
  const [postingAccounts, setPostingAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyNoteId, setBusyNoteId] = useState("");

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
    if (!propertyId) return tenants;
    return tenants.filter((tenant) => resolvePropertyId(tenant) === String(propertyId));
  }, [tenants, propertyId]);

  const filterScopedTenants = useMemo(() => {
    if (!filters.propertyId) return tenants;
    return tenants.filter((tenant) => resolvePropertyId(tenant) === String(filters.propertyId));
  }, [tenants, filters.propertyId]);

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

  const debitInvoiceItemOptions = useMemo(() => {
    const optionMap = new Map();
    sourceInvoiceOptions.forEach((invoice) => {
      const key = normalizeInvoiceItemKey(invoice) || String(invoice?._id || "");
      if (!key || optionMap.has(key)) return;
      optionMap.set(key, {
        key,
        label: getInvoiceItemLabel(invoice),
        category: String(invoice?.category || ""),
        anchorInvoiceId: String(invoice?._id || ""),
        anchorInvoice: invoice,
      });
    });
    return Array.from(optionMap.values());
  }, [sourceInvoiceOptions]);

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
      if (sourceAccountId) setChartAccountId(String(sourceAccountId));
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
    setAmount("");
    setDescription("");
  }, [propertyId, noteType]);

  useEffect(() => {
    setSourceInvoiceId("");
    setInvoiceItemSelection("");
    setAmount("");
    setDescription("");
  }, [tenantId]);

  const filteredNotes = useMemo(() => {
    const query = String(filters.search || "").trim().toLowerCase();
    return notes.filter((note) => {
      if (filters.noteType && String(note.noteType || "").toUpperCase() !== String(filters.noteType)) return false;
      if (filters.propertyId && resolvePropertyId(note) !== String(filters.propertyId)) return false;
      if (filters.tenantId && resolveTenantId(note) !== String(filters.tenantId)) return false;
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
  }, [notes, filters, propertyMap]);

  const totalPages = Math.max(1, Math.ceil(filteredNotes.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = filteredNotes.length === 0 ? 0 : (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedNotes = filteredNotes.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.search, filters.propertyId, filters.tenantId, filters.noteType, filters.status, filteredNotes.length]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

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
    setTenantId("");
    setSourceInvoiceId("");
    setInvoiceItemSelection("");
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

    if (!isCreditNote && !invoiceItemSelection) {
      toast.error("Select an invoice item for the debit note.");
      return;
    }

    try {
      setSaving(true);
      await createTenantInvoiceNote({
        business: currentCompany._id,
        noteType,
        sourceInvoiceId: resolvedSourceInvoiceId || undefined,
        anchorSourceInvoiceId: !isCreditNote ? resolvedSourceInvoiceId || undefined : undefined,
        tenantId,
        propertyId,
        amount: Number(amount),
        noteDate,
        description,
        category: category || selectedSourceInvoice?.category,
        chartAccountId: chartAccountId || undefined,
        metadata: !isCreditNote && selectedInvoiceItem
          ? {
              billItemKey: selectedInvoiceItem?.anchorInvoice?.metadata?.billItemKey || undefined,
              billItemLabel: selectedInvoiceItem?.label || undefined,
              utilityType:
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
      noteType,
      search: "",
      status: "active",
    });
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        <div className="mx-auto flex w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex-shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="mb-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.24em] text-slate-500">
                  Tenant invoice notes
                </p>
                <h1 className="mt-0.5 text-lg font-bold tracking-tight text-slate-900">
                  Credit &amp; Debit Notes
                </h1>
                <p className="mt-0.5 text-xs text-slate-600">
                  Manage note adjustments with the same compact MILIK workspace style used across invoices and meter readings, while preserving source invoice controls and audited reversals.
                </p>
              </div>
              <div className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900">
                {currentCompany?.companyName || currentCompany?.name || "No company selected"}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <div className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5">
                <p className="text-[11px] font-semibold text-blue-600">Visible Notes</p>
                <p className="text-base font-bold leading-tight text-blue-900">{summaryCards.totalCount}</p>
              </div>
              <div className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
                <p className="text-[11px] font-semibold text-emerald-600">Active Notes</p>
                <p className="text-base font-bold leading-tight text-emerald-900">{summaryCards.activeCount}</p>
              </div>
              <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5">
                <p className="text-[11px] font-semibold text-amber-600">Reversed Notes</p>
                <p className="text-base font-bold leading-tight text-amber-900">{summaryCards.reversedCount}</p>
              </div>
              <div className="rounded border border-violet-200 bg-violet-50 px-2.5 py-1.5">
                <p className="text-[11px] font-semibold text-violet-600">Visible Note Value</p>
                <p className="text-base font-bold leading-tight text-violet-900">{formatCurrency(summaryCards.totalValue)}</p>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="sticky top-0 z-20 flex-shrink-0 border-b border-gray-200 bg-gray-50 px-3 py-2">
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setNoteType("CREDIT_NOTE");
                        setFilters((prev) => ({ ...prev, noteType: "CREDIT_NOTE" }));
                        const nextParams = new URLSearchParams(searchParams);
                        nextParams.set("type", "credit");
                        setSearchParams(nextParams, { replace: true });
                      }}
                      className={`inline-flex h-8 items-center rounded-lg border px-3 text-[11px] font-bold transition ${
                        filters.noteType === "CREDIT_NOTE"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Credit Notes
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNoteType("DEBIT_NOTE");
                        setFilters((prev) => ({ ...prev, noteType: "DEBIT_NOTE" }));
                        const nextParams = new URLSearchParams(searchParams);
                        nextParams.set("type", "debit");
                        setSearchParams(nextParams, { replace: true });
                      }}
                      className={`inline-flex h-8 items-center rounded-lg border px-3 text-[11px] font-bold transition ${
                        filters.noteType === "DEBIT_NOTE"
                          ? "border-orange-300 bg-orange-50 text-orange-700"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Debit Notes
                    </button>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                      {noteCountLabel}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                      Active Value {formatCurrency(summaryCards.activeValue)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={openAddModal}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0A3127]"
                    >
                      <FaPlus /> Add Note
                    </button>
                    <button
                      type="button"
                      onClick={loadData}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <FaRedoAlt /> Refresh
                    </button>
                    <button
                      type="button"
                      onClick={resetWorkspaceFilters}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <FaTimes /> Reset Filters
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                  <div className="relative xl:col-span-2">
                    <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={filters.search}
                      onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                      placeholder="Search note no, tenant, source invoice, property..."
                      className="h-8 w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-xs focus:border-[#0B3B2E] focus:outline-none"
                    />
                  </div>

                  <select
                    value={filters.propertyId}
                    onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value, tenantId: "" }))}
                    className="h-8 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none"
                  >
                    <option value="">All properties</option>
                    {properties.map((property) => (
                      <option key={property._id} value={property._id}>
                        {property.propertyName || property.propertyCode || "Unnamed Property"}
                      </option>
                    ))}
                  </select>

                  <select
                    value={filters.tenantId}
                    onChange={(e) => setFilters((prev) => ({ ...prev, tenantId: e.target.value }))}
                    className="h-8 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none"
                  >
                    <option value="">All tenants</option>
                    {filterScopedTenants.map((tenant) => (
                      <option key={tenant._id} value={tenant._id}>
                        {getTenantDisplayName(tenant)}
                      </option>
                    ))}
                  </select>

                  <select
                    value={filters.status}
                    onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                    className="h-8 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none"
                  >
                    <option value="active">Active only</option>
                    <option value="reversed">Reversed</option>
                    <option value="all">All statuses</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="sticky top-0 z-10 bg-[#0B3B2E] text-left text-[11px] font-bold uppercase tracking-[0.16em] text-white">
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3">Note</th>
                    <th className="px-3 py-3">Tenant</th>
                    <th className="px-3 py-3">Property</th>
                    <th className="px-3 py-3">Source Invoice</th>
                    <th className="px-3 py-3">Charge Type</th>
                    <th className="px-3 py-3 text-right">Amount</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredNotes.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-12 text-center text-sm text-slate-500">
                        {loading ? "Loading notes..." : "No invoice notes found."}
                      </td>
                    </tr>
                  ) : (
                    paginatedNotes.map((note, index) => (
                      <tr
                        key={note._id}
                        className={`align-top ${index % 2 === 0 ? "bg-white" : "bg-slate-50/70"} hover:bg-slate-50`}
                      >
                        <td className="px-3 py-3 text-xs text-slate-600">
                          {formatDate(note.noteDate || note.invoiceDate || note.createdAt)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                              <FaFileInvoice className="text-sm" />
                            </span>
                            <div>
                              <p className="font-semibold text-slate-900">{note.noteNumber || note.invoiceNumber}</p>
                              <p className="text-[11px] font-medium text-slate-500">{note.noteType || note.documentType}</p>
                              {note.description ? (
                                <p className="mt-1 max-w-[260px] truncate text-[11px] text-slate-500">{note.description}</p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-700">
                          {note?.tenant?.name || note?.tenantName || "-"}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-700">
                          {resolvePropertyName(note, propertyMap)}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-700">
                          {note.sourceInvoiceNumber || note?.sourceInvoice?.invoiceNumber || "-"}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-700">{note.category || "-"}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">
                          {formatCurrency(note.amount)}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase ${getStatusChip(note?.status)}`}>
                            {note?.status || "posted"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-end">
                            {canReverseNote(note) ? (
                              <button
                                type="button"
                                onClick={() => handleReverseNote(note)}
                                disabled={busyNoteId === String(note._id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-[11px] font-bold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                                title={String(note?.noteType || "").toUpperCase() === "DEBIT_NOTE" ? "Reverse this debit note only if it is still unpaid" : "Reverse this credit note and restore the source invoice amount"}
                              >
                                <FaUndo /> {busyNoteId === String(note._id) ? "Working..." : "Reverse"}
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">-</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
              <div className="font-semibold">
                Showing <span className="font-bold text-slate-900">{filteredNotes.length === 0 ? 0 : startIndex + 1}</span> to <span className="font-bold text-slate-900">{Math.min(endIndex, filteredNotes.length)}</span> of <span className="font-bold text-slate-900">{filteredNotes.length}</span> note{filteredNotes.length === 1 ? "" : "s"}
                {filters.status !== "all" ? (
                  <span>
                    {" "}· Status: <span className="font-bold text-slate-900">{filters.status}</span>
                  </span>
                ) : null}
                <span>
                  {" "}· Current type: <span className="font-bold text-slate-900">{filters.noteType === "CREDIT_NOTE" ? "Credit Notes" : "Debit Notes"}</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
                <button type="button" onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={safeCurrentPage === 1} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
                <span className="font-semibold text-slate-700">Page {safeCurrentPage} of {totalPages}</span>
                <button type="button" onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={safeCurrentPage === totalPages} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
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
                  <p className="mt-1 text-sm text-slate-500">Select property first, then tenant. Credit notes must point to a source invoice. Debit notes only require the invoice item being adjusted.</p>
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
                    <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} disabled={!propertyId} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none disabled:bg-slate-100">
                      <option value="">{propertyId ? "Select tenant" : "Select property first"}</option>
                      {propertyScopedTenants.map((tenant) => (
                        <option key={tenant._id} value={tenant._id}>{getTenantDisplayName(tenant)}</option>
                      ))}
                    </select>
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
                      <span>Invoice Item</span>
                      <select value={invoiceItemSelection} onChange={(e) => setInvoiceItemSelection(e.target.value)} disabled={!tenantId} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B3B2E] focus:outline-none disabled:bg-slate-100">
                        <option value="">{tenantId ? (debitInvoiceItemOptions.length ? "Select invoice item" : "No matching posted invoice items") : "Select tenant first"}</option>
                        {debitInvoiceItemOptions.map((item) => (
                          <option key={item.key} value={item.key}>
                            {item.label} | {humanizeCategory(item.category)} | {item.anchorInvoice?.invoiceNumber || "-"}
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
                      <span>Invoice Item Category</span>
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
                    <p><span className="font-semibold">{noteType === "CREDIT_NOTE" ? "Source Invoice" : "Anchor Invoice"}:</span> {selectedSourceInvoice.invoiceNumber}</p>
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
      </div>
    </DashboardLayout>
  );
};

export default InvoiceNotes;

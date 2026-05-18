import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { LISTING_UI, normalizeUppercaseInput, toListingCaps } from "../../utils/listingPageUtils";
import {
  FaCheck,
  FaChevronLeft,
  FaChevronRight,
  FaClock,
  FaCompressAlt,
  FaEdit,
  FaExpandAlt,
  FaFileSignature,
  FaFilePdf,
  FaPlus,
  FaRedoAlt,
  FaSearch,
  FaSyncAlt,
  FaTimes,
  FaTrash,
  FaFileContract,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { useConfirm } from "../../context/ConfirmContext";
import { getTenants } from "../../redux/tenantsRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getUnits } from "../../redux/unitRedux";
import {
  createLease,
  deleteLease,
  generateLeaseDocument,
  getLeases,
  renewLease,
  signLease,
  updateLease,
} from "../../redux/apiCalls";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const TERMINATED_STATUSES = new Set(["terminated", "moved_out", "evicted", "inactive"]);
const isActiveTenant = (tenant) =>
  !TERMINATED_STATUSES.has(String(tenant?.status || "active").trim().toLowerCase());
const ITEMS_PER_PAGE = 50;
const AGREEMENT_STATUS_OPTIONS = [
  "draft",
  "pending_signature",
  "active",
  "expired",
  "terminated",
  "renewed",
  "cancelled",
];

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const formatCurrency = (value) => {
  const numeric = Number(value || 0);
  return `Ksh ${numeric.toLocaleString("en-KE")}`;
};

const formatDateInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const formatDateLabel = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
};

const getDaysUntil = (value) => {
  if (!value) return null;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
};

const getStatusTone = (status) => {
  switch (String(status || "").toLowerCase()) {
    case "active":
      return "bg-emerald-100 text-emerald-800 border border-emerald-300";
    case "pending_signature":
      return "bg-blue-100 text-blue-800 border border-blue-300";
    case "draft":
      return "bg-slate-100 text-slate-700 border border-slate-300";
    case "expired":
      return "bg-amber-100 text-amber-800 border border-amber-300";
    case "terminated":
      return "bg-red-100 text-red-700 border border-red-300";
    case "renewed":
      return "bg-violet-100 text-violet-800 border border-violet-300";
    case "cancelled":
      return "bg-gray-200 text-gray-700 border border-gray-300";
    default:
      return "bg-slate-100 text-slate-700 border border-slate-300";
  }
};

const getStatusLabel = (status) =>
  String(status || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase()) || "Unknown";

const buildInitialForm = () => ({
  _id: "",
  agreementNumber: "",
  tenant: "",
  unit: "",
  startDate: "",
  endDate: "",
  rentAmount: "",
  depositAmount: "",
  paymentDueDay: 5,
  noticePeriodDays: 30,
  lateFee: "0",
  leaseType: "fixed",
  status: "active",
  terms: "",
  documentUrl: "",
});

const TenantAgreements = () => {
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const queryTenantId = new URLSearchParams(location.search).get("tenant") || "";

  const { currentCompany } = useSelector((state) => state.company || {});
  const leases = useSelector((state) => state.lease?.leases || []);
  const tenants = useSelector((state) => state.tenant?.tenants || []);
  const properties = useSelector((state) => state.property?.properties || []);
  const units = useSelector((state) => state.unit?.units || []);
  const isFetchingLeases = useSelector((state) => state.lease?.isFetching || false);

  const [filters, setFilters] = useState({
    status: "any",
    property: "any",
    search: "",
    expiringOnly: false,
  });
  const [draftFilters, setDraftFilters] = useState({
    status: "any",
    property: "any",
    search: "",
    expiringOnly: false,
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedAgreements, setExpandedAgreements] = useState(new Set());
  const [selectedAgreements, setSelectedAgreements] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(buildInitialForm());
  const [submitting, setSubmitting] = useState(false);
  const [generatingDocId, setGeneratingDocId] = useState(null);
  const [includeTerminatedTenants, setIncludeTerminatedTenants] = useState(false);

  const loadData = async () => {
    if (!currentCompany?._id) return;
    await Promise.all([
      getLeases(dispatch, currentCompany._id),
      dispatch(getTenants({ business: currentCompany._id })),
      dispatch(getProperties({ business: currentCompany._id })),
      dispatch(getUnits({ business: currentCompany._id })),
    ]);
  };

  useEffect(() => {
    loadData().catch((error) => {
      toast.error(error?.message || "Failed to load tenant agreements.");
    });
  }, [currentCompany?._id]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.status, filters.property, filters.search, filters.expiringOnly, queryTenantId]);

  const tenantsById = useMemo(() => {
    const map = new Map();
    (Array.isArray(tenants) ? tenants : []).forEach((tenant) => {
      map.set(normalizeId(tenant._id), tenant);
    });
    return map;
  }, [tenants]);

  const unitsById = useMemo(() => {
    const map = new Map();
    (Array.isArray(units) ? units : []).forEach((unit) => {
      map.set(normalizeId(unit._id), unit);
    });
    return map;
  }, [units]);

  const propertiesById = useMemo(() => {
    const map = new Map();
    (Array.isArray(properties) ? properties : []).forEach((property) => {
      map.set(normalizeId(property._id), property);
    });
    return map;
  }, [properties]);

  const resolvePropertyRecord = (propertyValue) => {
    if (!propertyValue) return null;
    if (typeof propertyValue === "object") {
      if (propertyValue.propertyName || propertyValue.name) return propertyValue;
      const resolvedId = normalizeId(propertyValue);
      return propertiesById.get(resolvedId) || null;
    }
    return propertiesById.get(normalizeId(propertyValue)) || null;
  };

  const agreementRows = useMemo(() => {
    return (Array.isArray(leases) ? leases : []).map((lease) => {
      const tenant = lease?.tenant || tenantsById.get(normalizeId(lease?.tenant)) || null;
      const unit = lease?.unit || unitsById.get(normalizeId(lease?.unit)) || null;
      const property = resolvePropertyRecord(lease?.unit?.property) || resolvePropertyRecord(unit?.property) || null;
      const daysToExpiry = getDaysUntil(lease?.endDate);
      const isExpiring = String(lease?.status || "").toLowerCase() === "active" && daysToExpiry !== null && daysToExpiry <= 30;

      return {
        raw: lease,
        id: normalizeId(lease?._id),
        agreementNumber: lease?.agreementNumber || `AGR-${normalizeId(lease?._id).slice(-6).toUpperCase()}`,
        tenantId: normalizeId(tenant?._id || lease?.tenant),
        tenantName: tenant?.name || "Unknown Tenant",
        tenantCode: tenant?.tenantCode || "",
        unitId: normalizeId(unit?._id || lease?.unit),
        unitLabel: unit?.unitNumber || unit?.unitName || unit?.name || "-",
        propertyId: normalizeId(property?._id || unit?.property || lease?.unit?.property),
        propertyName: property?.propertyName || property?.name || "Unknown Property",
        propertyCode: property?.propertyCode || "",
        leaseType: lease?.leaseType || tenant?.leaseType || "fixed",
        status: lease?.status || "active",
        startDate: lease?.startDate,
        endDate: lease?.endDate,
        rentAmount: Number(lease?.rentAmount || 0),
        depositAmount: Number(lease?.depositAmount || 0),
        paymentDueDay: Number(lease?.paymentDueDay || 5),
        lateFee: Number(lease?.lateFee || 0),
        noticePeriodDays: Number(lease?.noticePeriodDays || 30),
        terms: lease?.terms || "",
        signedByTenant: !!lease?.signedByTenant,
        signedByLandlord: !!lease?.signedByLandlord,
        signedDate: lease?.signedDate || null,
        daysToExpiry,
        isExpiring,
      };
    });
  }, [leases, propertiesById, tenantsById, unitsById]);

  const summary = useMemo(() => {
    return agreementRows.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.status === "active") acc.active += 1;
        if (row.status === "draft") acc.draft += 1;
        if (row.status === "pending_signature") acc.pending += 1;
        if (row.isExpiring) acc.expiring += 1;
        if (row.status === "terminated") acc.terminated += 1;
        return acc;
      },
      { total: 0, active: 0, draft: 0, pending: 0, expiring: 0, terminated: 0 }
    );
  }, [agreementRows]);

  const filteredRows = useMemo(() => {
    return agreementRows.filter((row) => {
      if (queryTenantId && row.tenantId !== queryTenantId) return false;
      if (filters.status !== "any" && row.status !== filters.status) return false;
      if (filters.property !== "any" && row.propertyName !== filters.property) return false;
      if (filters.expiringOnly && !row.isExpiring) return false;
      const query = String(filters.search || "").trim().toLowerCase();
      if (!query) return true;
      return [
        row.agreementNumber,
        row.tenantName,
        row.tenantCode,
        row.unitLabel,
        row.propertyName,
        row.status,
      ].some((item) => String(item || "").toLowerCase().includes(query));
    });
  }, [agreementRows, filters, queryTenantId]);

  const sortedFilteredRows = useMemo(() => {
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      const propertyCompare = String(a.propertyName || "").localeCompare(String(b.propertyName || ""), undefined, { sensitivity: "base" });
      if (propertyCompare !== 0) return propertyCompare;
      const tenantCompare = String(a.tenantName || "").localeCompare(String(b.tenantName || ""), undefined, { sensitivity: "base" });
      if (tenantCompare !== 0) return tenantCompare;
      return String(a.agreementNumber || "").localeCompare(String(b.agreementNumber || ""), undefined, { sensitivity: "base" });
    });
    return sorted;
  }, [filteredRows]);

  const totalPages = Math.max(1, Math.ceil(sortedFilteredRows.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const pagedRows = sortedFilteredRows.slice(startIndex, endIndex);

  const uniqueProperties = useMemo(() => {
    const names = agreementRows
      .map((row) => row.propertyName)
      .filter(Boolean);
    return ["any", ...Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))];
  }, [agreementRows]);

  const toggleAgreementSelect = (id) => {
    setSelectedAgreements((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const toggleSelectAllAgreements = () => {
    const allIds = pagedRows.map((r) => r.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedAgreements.includes(id));
    setSelectedAgreements(allSelected ? [] : allIds);
  };
  const toggleAgreementExpand = (id) => {
    setExpandedAgreements((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const expandAllAgreements = () => {
    setExpandedAgreements(new Set(sortedFilteredRows.map((row) => row.id)));
  };
  const collapseAllAgreements = () => {
    setExpandedAgreements(new Set());
  };
  const handleSearchFilters = () => {
    setFilters(draftFilters);
    setCurrentPage(1);
  };
  const handleResetFilters = () => {
    const resetFilters = { status: "any", property: "any", search: "", expiringOnly: false };
    setDraftFilters(resetFilters);
    setFilters(resetFilters);
    setCurrentPage(1);
  };

  const closeModal = () => {
    setModalOpen(false);
    setForm(buildInitialForm());
    setIncludeTerminatedTenants(false);
  };

  const openNewModal = (tenantId = queryTenantId || "") => {
    const tenant = tenantsById.get(tenantId) || null;
    const unitId = normalizeId(tenant?.unit);
    const selectedUnit = unitsById.get(unitId) || tenant?.unit || null;

    setForm({
      ...buildInitialForm(),
      tenant: tenantId || "",
      unit: unitId || "",
      startDate: formatDateInput(tenant?.moveInDate),
      endDate: formatDateInput(tenant?.moveOutDate),
      rentAmount: tenant?.rent !== undefined ? String(tenant.rent) : String(selectedUnit?.rent || ""),
      depositAmount: tenant?.depositAmount !== undefined ? String(tenant.depositAmount) : "0",
      leaseType: tenant?.leaseType || "fixed",
    });
    setModalOpen(true);
  };

  const openEditModal = (row) => {
    setForm({
      _id: row.id,
      agreementNumber: row.agreementNumber,
      tenant: row.tenantId,
      unit: row.unitId,
      startDate: formatDateInput(row.startDate),
      endDate: formatDateInput(row.endDate),
      rentAmount: String(row.rentAmount || 0),
      depositAmount: String(row.depositAmount || 0),
      paymentDueDay: row.paymentDueDay || 5,
      noticePeriodDays: row.noticePeriodDays || 30,
      lateFee: String(row.lateFee || 0),
      leaseType: row.leaseType || "fixed",
      status: row.status || "active",
      terms: row.terms || "",
      documentUrl: row.raw?.documentUrl || "",
    });
    setModalOpen(true);
  };

  const handleTenantChange = (tenantId) => {
    const tenant = tenantsById.get(tenantId) || null;
    const unitId = normalizeId(tenant?.unit);
    setForm((prev) => ({
      ...prev,
      tenant: tenantId,
      unit: unitId,
      startDate: prev.startDate || formatDateInput(tenant?.moveInDate),
      endDate: prev.endDate || formatDateInput(tenant?.moveOutDate),
      rentAmount: prev.rentAmount || (tenant?.rent !== undefined ? String(tenant.rent) : ""),
      depositAmount: prev.depositAmount || (tenant?.depositAmount !== undefined ? String(tenant.depositAmount) : "0"),
      leaseType: tenant?.leaseType || prev.leaseType || "fixed",
    }));
  };

  const validateForm = () => {
    if (!form.tenant) return "Tenant is required.";
    if (!form.unit) return "Unit is required.";
    if (!form.startDate) return "Agreement start date is required.";
    if (!form.endDate) return "Agreement end date is required.";
    const start = new Date(form.startDate);
    const end = new Date(form.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return "Agreement end date must be after the start date.";
    }
    if (Number(form.rentAmount || 0) < 0) return "Rent amount is invalid.";
    if (Number(form.depositAmount || 0) < 0) return "Deposit amount is invalid.";
    return null;
  };

  const handleSave = async (event) => {
    event.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const payload = {
      business: currentCompany?._id,
      agreementNumber: form._id ? undefined : form.agreementNumber || undefined,
      tenant: form.tenant,
      unit: form.unit,
      startDate: form.startDate,
      endDate: form.endDate,
      rentAmount: Number(form.rentAmount || 0),
      depositAmount: Number(form.depositAmount || 0),
      paymentDueDay: Number(form.paymentDueDay || 5),
      noticePeriodDays: Number(form.noticePeriodDays || 30),
      lateFee: Number(form.lateFee || 0),
      leaseType: form.leaseType,
      status: form.status,
      terms: form.terms,
      documentUrl: form.documentUrl,
    };

    setSubmitting(true);
    try {
      if (form._id) {
        await updateLease(dispatch, form._id, payload);
        toast.success("Tenant agreement updated successfully.");
      } else {
        await createLease(dispatch, payload);
        toast.success("Tenant agreement created successfully.");
      }
      closeModal();
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to save tenant agreement.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateDocument = async (row) => {
    setGeneratingDocId(row.id);
    try {
      const updated = await generateLeaseDocument(dispatch, row.id);
      toast.success("Lease document generated successfully.");
      if (updated?.documentUrl) {
        window.open(updated.documentUrl, "_blank", "noreferrer");
      }
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to generate lease document.");
    } finally {
      setGeneratingDocId(null);
    }
  };

  const handleSign = async (row, signedBy) => {
    try {
      await signLease(dispatch, row.id, { signedBy, business: currentCompany?._id });
      toast.success(`${signedBy === "tenant" ? "Tenant" : "Landlord"} signature recorded.`);
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to sign agreement.");
    }
  };

  const handleTerminate = async (row) => {
    const confirmed = await confirm({ title: "Terminate Agreement", message: `Terminate agreement ${row.agreementNumber}? This action cannot be undone.`, confirmText: "Terminate", isDangerous: true });
    if (!confirmed) return;

    try {
      await updateLease(dispatch, row.id, {
        business: currentCompany?._id,
        status: "terminated",
        terminatedAt: new Date().toISOString(),
        terminationReason: "Terminated from agreements workspace",
      });
      toast.success("Agreement terminated successfully.");
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to terminate agreement.");
    }
  };

  const handleRenew = async (row) => {
    const newEndDate = window.prompt("Enter the new agreement end date (YYYY-MM-DD)", formatDateInput(row.endDate));
    if (!newEndDate) return;

    try {
      await renewLease(dispatch, row.id, {
        business: currentCompany?._id,
        newStartDate: formatDateInput(new Date()),
        newEndDate,
        newRentAmount: row.rentAmount,
      });
      toast.success("Agreement renewed successfully.");
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to renew agreement.");
    }
  };

  const handleDelete = async (row) => {
    const confirmed = await confirm({ title: "Delete Agreement", message: `Delete agreement ${row.agreementNumber}?`, confirmText: "Delete", isDangerous: true });
    if (!confirmed) return;

    try {
      await deleteLease(dispatch, row.id);
      toast.success("Agreement deleted successfully.");
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to delete agreement.");
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50 p-0">
        <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
            <span className="shrink-0 text-[10px] font-bold text-gray-500">Total <span className="text-gray-900">{summary.total}</span></span>
            <span className="shrink-0 rounded border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700">Active: {summary.active}</span>
            <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Expiring: {summary.expiring}</span>
            <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">Pending: {summary.pending}</span>
            {selectedAgreements.length > 0 && <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">{selectedAgreements.length} selected</span>}
            <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
            <button onClick={expandAllAgreements} className="h-7 shrink-0 rounded p-1.5 text-gray-700 hover:bg-gray-200" title="Expand all"><FaExpandAlt size={11} /></button>
            <button onClick={collapseAllAgreements} className="h-7 shrink-0 rounded p-1.5 text-gray-700 hover:bg-gray-200" title="Collapse all"><FaCompressAlt size={11} /></button>
            <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
            <select value={draftFilters.property} onChange={(event) => setDraftFilters((prev) => ({ ...prev, property: event.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
              {uniqueProperties.map((propertyName) => (<option key={propertyName} value={propertyName}>{propertyName === "any" ? "Property" : toListingCaps(propertyName)}</option>))}
            </select>
            <select value={draftFilters.status} onChange={(event) => setDraftFilters((prev) => ({ ...prev, status: event.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
              <option value="any">Status</option>
              {AGREEMENT_STATUS_OPTIONS.map((status) => (<option key={status} value={status}>{getStatusLabel(status)}</option>))}
            </select>
            <label className="h-7 shrink-0 inline-flex items-center gap-1.5 rounded border border-gray-300 bg-[#DDEFE1] px-2 text-xs text-gray-800 hover:bg-white cursor-pointer">
              <input type="checkbox" checked={draftFilters.expiringOnly} onChange={(event) => setDraftFilters((prev) => ({ ...prev, expiringOnly: event.target.checked }))} className="rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
              Expiring 30d
            </label>
            <input type="text" value={draftFilters.search} onChange={(event) => setDraftFilters((prev) => ({ ...prev, search: normalizeUppercaseInput(event.target.value) }))} placeholder="Search…" className="h-7 w-40 shrink-0 rounded border border-gray-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
            <button onClick={handleSearchFilters} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-medium text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaSearch size={10} /></button>
            <button onClick={handleResetFilters} className="h-7 shrink-0 flex items-center gap-1 rounded bg-gray-500 px-2.5 text-xs font-medium text-white shadow-sm hover:bg-gray-600"><FaRedoAlt size={10} /></button>
            <button onClick={() => loadData()} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-medium text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaSyncAlt size={10} /></button>
            <button onClick={() => selectedAgreements.length === 1 && openEditModal(sortedFilteredRows.find((row) => row.id === selectedAgreements[0]))} disabled={selectedAgreements.length !== 1} className="h-7 shrink-0 flex items-center gap-1 rounded bg-blue-500 px-2.5 text-xs font-medium text-white shadow-sm hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"><FaEdit size={10} /></button>
            <button onClick={() => openNewModal()} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-medium text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}><FaPlus size={10} /> New Agreement</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
              <table className="w-full min-w-[1320px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className={`${MILIK_GREEN} text-xs text-white`}>
                    <th className="w-6 border-r border-gray-400 px-2 py-1.5 text-center font-bold">
                      <input
                        type="checkbox"
                        checked={pagedRows.length > 0 && pagedRows.every((r) => selectedAgreements.includes(r.id))}
                        onChange={toggleSelectAllAgreements}
                        onClick={(event) => event.stopPropagation()}
                        className="cursor-pointer rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                      />
                    </th>
                    <th className="w-6 border-r border-gray-400 px-2 py-1.5 text-center font-bold">+</th>
                    <th className="min-w-[130px] border-r border-gray-400 px-2 py-1.5 text-left font-bold">Agreement</th>
                    <th className="min-w-[150px] border-r border-gray-400 px-2 py-1.5 text-left font-bold">Tenant</th>
                    <th className="min-w-[150px] border-r border-gray-400 px-2 py-1.5 text-left font-bold">Property</th>
                    <th className="min-w-[90px] border-r border-gray-400 px-2 py-1.5 text-left font-bold">Unit</th>
                    <th className="min-w-[95px] border-r border-gray-400 px-2 py-1.5 text-center font-bold">Status</th>
                    <th className="min-w-[115px] border-r border-gray-400 px-2 py-1.5 text-left font-bold">Start</th>
                    <th className="min-w-[115px] border-r border-gray-400 px-2 py-1.5 text-left font-bold">End</th>
                    <th className="min-w-[100px] border-r border-gray-400 px-2 py-1.5 text-right font-bold">Rent</th>
                    <th className="min-w-[105px] border-r border-gray-400 px-2 py-1.5 text-right font-bold">Deposit</th>
                    <th className="min-w-[130px] border-r border-gray-400 px-2 py-1.5 text-left font-bold">Signatures</th>
                    <th className="min-w-[320px] px-2 py-1.5 text-left font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-3 py-4 text-center text-xs font-semibold text-gray-600">
                        {isFetchingLeases ? "Loading agreements..." : "No tenant agreements found for the selected filters."}
                      </td>
                    </tr>
                  ) : (
                    pagedRows.map((row, idx) => {
                      const normalizedStatus = String(row.status || "").toLowerCase();
                      const tenantPending = !row.signedByTenant;
                      const landlordPending = !row.signedByLandlord;
                      const canEdit = !["renewed", "terminated", "cancelled"].includes(normalizedStatus);
                      const canSign = !["renewed", "terminated", "cancelled", "expired"].includes(normalizedStatus);
                      const canRenew = ["active", "expired"].includes(normalizedStatus);
                      const canTerminate = ["draft", "pending_signature", "active", "expired"].includes(normalizedStatus);
                      const canDelete = ["draft", "cancelled"].includes(normalizedStatus) && tenantPending && landlordPending;
                      const hasDocument = Boolean(String(row.raw?.documentUrl || "").trim());

                      const isExpanded = expandedAgreements.has(row.id);
                      const isSelected = selectedAgreements.includes(row.id);
                      const isFirstOfProperty = idx === 0 || pagedRows[idx - 1].propertyName !== row.propertyName;

                      return (
                      <React.Fragment key={row.id}>
                        {isFirstOfProperty && (
                          <tr className="bg-transparent">
                            <td colSpan={13} className="px-2 pb-1 pt-1.5">
                              <h3 className="text-sm font-extrabold uppercase tracking-normal text-black">
                                {toListingCaps(row.propertyName)}
                              </h3>
                              <div className="mt-1 h-[2px] w-full bg-[#FF8C00]" />
                            </td>
                          </tr>
                        )}
                      <tr
                        onClick={() => toggleAgreementSelect(row.id)}
                        className={`cursor-pointer border-b text-xs transition-colors ${
                          row.isExpiring ? "border-red-200" : "border-gray-200"
                        } ${
                          isSelected
                            ? "bg-orange-50 hover:bg-orange-100"
                            : row.isExpiring
                              ? "bg-red-50/70 hover:bg-red-100/80"
                              : "bg-white hover:bg-gray-50"
                        }`}
                      >
                        <td className="border-r border-gray-200 px-2 py-1 text-center" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(event) => {
                              event.stopPropagation();
                              toggleAgreementSelect(row.id);
                            }}
                            onClick={(event) => event.stopPropagation()}
                            className="cursor-pointer rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                          />
                        </td>
                        <td
                          className="cursor-pointer border-r border-gray-200 px-2 py-1 text-center"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleAgreementExpand(row.id);
                            }}
                          >
                          <span>{isExpanded ? "v" : ">"}</span>
                        </td>
                        <td className="border-r border-gray-200 px-2 py-1 font-mono text-xs font-bold text-[#0B3B2E]">
                          <div>{toListingCaps(row.agreementNumber)}</div>
                          <div className="mt-0.5 font-sans font-normal text-gray-600">{getStatusLabel(row.leaseType)}</div>
                          {row.isExpiring && (
                            <div className="mt-1 text-[10px] font-semibold text-red-700">
                              Expires in {row.daysToExpiry} day{row.daysToExpiry === 1 ? "" : "s"}
                            </div>
                          )}
                        </td>
                        <td className="border-r border-gray-200 px-2 py-1">
                          <div className="font-bold text-gray-900">{toListingCaps(row.tenantName)}</div>
                          <div className="mt-0.5 text-xs text-gray-600">{toListingCaps(row.tenantCode || "No code")}</div>
                        </td>
                        <td className="border-r border-gray-200 px-2 py-1 font-bold text-gray-900">
                          <div className="font-semibold text-gray-900">{row.propertyCode ? `${row.propertyCode} • ${row.propertyName}` : row.propertyName}</div>
                          {hasDocument && (
                            <a
                              href={row.raw.documentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-700 hover:bg-slate-200"
                            >
                              Document Link
                            </a>
                          )}
                        </td>
                        <td className="border-r border-gray-200 px-2 py-1 font-bold text-gray-900">
                          {toListingCaps(row.unitLabel !== "-" ? row.unitLabel : "No unit linked")}
                        </td>
                        <td className="border-r border-gray-200 px-2 py-1 text-center">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${getStatusTone(row.status)}`}>
                            {getStatusLabel(row.status)}
                          </span>
                        </td>
                        <td className="border-r border-gray-200 px-2 py-1 font-bold text-gray-900">{formatDateLabel(row.startDate)}</td>
                        <td className={`border-r border-gray-200 px-2 py-1 font-bold ${row.isExpiring ? "text-red-700" : "text-gray-900"}`}>{formatDateLabel(row.endDate)}</td>
                        <td className="border-r border-gray-200 px-2 py-1 text-right font-bold text-gray-900">{formatCurrency(row.rentAmount)}</td>
                        <td className="border-r border-gray-200 px-2 py-1 text-right font-bold text-gray-900">{formatCurrency(row.depositAmount)}</td>
                        <td className="border-r border-gray-200 px-2 py-1">
                          <div className="space-y-1 text-xs">
                            <div className={row.signedByTenant ? "text-emerald-700 font-semibold" : "text-slate-500"}>
                              Tenant: {row.signedByTenant ? "Signed" : "Pending"}
                            </div>
                            <div className={row.signedByLandlord ? "text-emerald-700 font-semibold" : "text-slate-500"}>
                              Landlord: {row.signedByLandlord ? "Signed" : "Pending"}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-1" onClick={(event) => event.stopPropagation()}>
                          <div className="flex flex-wrap gap-1.5">
                            {canEdit && (
                              <button
                                onClick={(event) => { event.stopPropagation(); openEditModal(row); }}
                                className="rounded-lg border border-[#0B3B2E]/15 bg-[#0B3B2E]/5 px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E]/10"
                              >
                                <FaEdit className="inline mr-1" /> Edit
                              </button>
                            )}
                            <button
                              onClick={(event) => { event.stopPropagation(); handleGenerateDocument(row); }}
                              disabled={generatingDocId === row.id}
                              className={`rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-bold text-orange-700 transition hover:bg-orange-100 ${generatingDocId === row.id ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                              <FaFilePdf className="inline mr-1" />
                              {generatingDocId === row.id ? "Generating..." : hasDocument ? "Regenerate Doc" : "Generate Doc"}
                            </button>
                            {canSign && tenantPending && (
                              <button
                                onClick={(event) => { event.stopPropagation(); handleSign(row, "tenant"); }}
                                className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 transition hover:bg-blue-100"
                              >
                                <FaFileSignature className="inline mr-1" /> Tenant Sign
                              </button>
                            )}
                            {canSign && landlordPending && (
                              <button
                                onClick={(event) => { event.stopPropagation(); handleSign(row, "landlord"); }}
                                className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700 transition hover:bg-violet-100"
                              >
                                <FaCheck className="inline mr-1" /> Landlord Sign
                              </button>
                            )}
                            {canRenew && (
                              <button
                                onClick={(event) => { event.stopPropagation(); handleRenew(row); }}
                                className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 transition hover:bg-amber-100"
                              >
                                <FaClock className="inline mr-1" /> Renew
                              </button>
                            )}
                            {canTerminate && (
                              <button
                                onClick={(event) => { event.stopPropagation(); handleTerminate(row); }}
                                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 transition hover:bg-red-100"
                              >
                                <FaTimes className="inline mr-1" /> Terminate
                              </button>
                            )}
                            <button
                              onClick={(event) => { event.stopPropagation(); navigate(`/tenant/${row.tenantId}/statement`, { state: { tabTitle: `${row.tenantName} Statement` } }); }}
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                            >
                              <FaFileContract className="inline mr-1" /> Statement
                            </button>
                            {canDelete && (
                              <button
                                onClick={(event) => { event.stopPropagation(); handleDelete(row); }}
                                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-700 transition hover:bg-slate-100"
                              >
                                <FaTrash className="inline mr-1" /> Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                        {isExpanded && (
                          <tr className="border-b border-gray-200 bg-gray-100">
                            <td colSpan={13} className="px-3 py-1.5">
                              <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-4">
                                <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Lease period</span><p className="font-semibold text-slate-900">{formatDateLabel(row.startDate)} → {formatDateLabel(row.endDate)}</p></div>
                                <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Rent</span><p className="font-semibold text-slate-900">{formatCurrency(row.rentAmount)}</p></div>
                                <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Deposit</span><p className="font-semibold text-slate-900">{formatCurrency(row.depositAmount)}</p></div>
                                <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Signature status</span><p className="font-semibold text-slate-900">Tenant: {row.signedByTenant ? 'Signed' : 'Pending'} · Landlord: {row.signedByLandlord ? 'Signed' : 'Pending'}</p></div>
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

            <div className="sticky bottom-0 z-20 flex flex-shrink-0 items-center justify-between border-t border-gray-200 bg-white px-2 py-2">
              <div className="text-xs font-bold text-gray-600">
                Showing {pagedRows.length > 0 ? startIndex + 1 : 0} to {Math.min(endIndex, sortedFilteredRows.length)} of {sortedFilteredRows.length} agreements
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(safeCurrentPage - 1)}
                  disabled={safeCurrentPage === 1}
                  className="rounded p-1 text-xs text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaChevronLeft size={12} />
                </button>
                <div className="flex items-center gap-0.5">
                  {[...Array(totalPages)].map((_, i) => {
                    const page = i + 1;
                    if (page === 1 || page === totalPages || (page >= safeCurrentPage - 1 && page <= safeCurrentPage + 1)) {
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`rounded px-2 py-0.5 text-xs font-bold transition-colors ${
                            safeCurrentPage === page ? `${MILIK_ORANGE} text-white` : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          {page}
                        </button>
                      );
                    }
                    if (page === safeCurrentPage - 2 || page === safeCurrentPage + 2) {
                      return <span key={page} className="px-1 text-xs text-gray-400">...</span>;
                    }
                    return null;
                  })}
                </div>
                <button
                  onClick={() => setCurrentPage(safeCurrentPage + 1)}
                  disabled={safeCurrentPage === totalPages}
                  className="rounded p-1 text-xs text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaChevronRight size={12} />
                </button>
              </div>
            </div>

        {modalOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-black text-gray-900">{form._id ? "Edit Tenant Agreement" : "New Tenant Agreement"}</h2>
                  <p className="mt-1 text-[11px] text-gray-600">Capture rent terms, deposit, due day, and renewal details in one place.</p>
                </div>
                <button onClick={closeModal} className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                  <FaTimes />
                </button>
              </div>

              <form onSubmit={handleSave} className="px-5 py-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">Tenant</label>
                    <select
                      value={form.tenant}
                      onChange={(event) => handleTenantChange(event.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    >
                      <option value="">Select tenant</option>
                      {(Array.isArray(tenants) ? tenants : [])
                        .filter((tenant) => includeTerminatedTenants || isActiveTenant(tenant))
                        .map((tenant) => (
                          <option key={tenant._id} value={tenant._id}>{tenant.name} {tenant.tenantCode ? `(${tenant.tenantCode})` : ""}</option>
                        ))}
                    </select>
                    <label className="mt-1.5 inline-flex cursor-pointer items-center gap-2 text-[11px] text-slate-600">
                      <input
                        type="checkbox"
                        checked={includeTerminatedTenants}
                        onChange={(e) => setIncludeTerminatedTenants(e.target.checked)}
                      />
                      Include terminated tenants
                    </label>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">Unit</label>
                    <select
                      value={form.unit}
                      onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    >
                      <option value="">Select unit</option>
                      {(Array.isArray(units) ? units : []).map((unit) => (
                        <option key={unit._id} value={unit._id}>{unit.unitNumber || unit.unitName || unit.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">Status</label>
                    <select
                      value={form.status}
                      onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    >
                      {AGREEMENT_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{getStatusLabel(status)}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">Start Date</label>
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">End Date</label>
                    <input
                      type="date"
                      value={form.endDate}
                      onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">Lease Type</label>
                    <select
                      value={form.leaseType}
                      onChange={(event) => setForm((prev) => ({ ...prev, leaseType: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    >
                      <option value="fixed">Fixed Term</option>
                      <option value="at_will">At Will</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">Monthly Rent</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.rentAmount}
                      onChange={(event) => setForm((prev) => ({ ...prev, rentAmount: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">Deposit Amount</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.depositAmount}
                      onChange={(event) => setForm((prev) => ({ ...prev, depositAmount: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">Payment Due Day</label>
                    <input
                      type="number"
                      min="1"
                      max="28"
                      value={form.paymentDueDay}
                      onChange={(event) => setForm((prev) => ({ ...prev, paymentDueDay: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">Notice Period (Days)</label>
                    <input
                      type="number"
                      min="0"
                      value={form.noticePeriodDays}
                      onChange={(event) => setForm((prev) => ({ ...prev, noticePeriodDays: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">Late Fee</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.lateFee}
                      onChange={(event) => setForm((prev) => ({ ...prev, lateFee: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">Document URL</label>
                    <input
                      type="text"
                      value={form.documentUrl}
                      onChange={(event) => setForm((prev) => ({ ...prev, documentUrl: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                      placeholder="Optional link to signed PDF"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-600">Terms / Notes</label>
                  <textarea
                    rows={4}
                    value={form.terms}
                    onChange={(event) => setForm((prev) => ({ ...prev, terms: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    placeholder="Capture notice terms, utility arrangement, renewal notes, or special clauses."
                  />
                </div>

                <div className="mt-5 flex items-center justify-end gap-2 border-t border-gray-200 pt-4">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-lg border border-gray-300 px-1.5 py-1 text-[11px] font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className={`rounded-lg px-1.5 py-1 text-[11px] font-semibold text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER} ${submitting ? "opacity-70 cursor-not-allowed" : ""}`}
                  >
                    {submitting ? "Saving..." : form._id ? "Update Agreement" : "Create Agreement"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default TenantAgreements;

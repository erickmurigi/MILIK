import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import PaginationBar from '../../components/PaginationBar';
import { useEntityCache } from "../../hooks/useEntityCache";
import AppSelect from "../../components/common/AppSelect";
import {
  selectCurrentCompany,
  selectAllLeases,
  selectAllTenants,
  selectAllProperties,
  selectAllUnits,
} from "../../redux/selectors";
import { useLocation, useNavigate } from "react-router-dom";
import { LISTING_UI, normalizeUppercaseInput, toListingCaps } from "../../utils/listingPageUtils";
import {
  FaCheck,
  FaChevronDown,
  FaChevronLeft,
  FaChevronRight,
  FaClock,
  FaCompressAlt,
  FaEdit,
  FaEllipsisV,
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
  FaWrench,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { useConfirm } from "../../context/ConfirmContext";
import { adminRequests } from "../../utils/requestMethods";
import { getTenants } from "../../redux/tenantsRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getUnits } from "../../redux/unitRedux";
import { useTabState } from "../../hooks/useTabState";
import {
  createLease,
  deleteLease,
  generateLeaseDocument,
  getLeases,
  renewLease,
  signLease,
  updateLease,
} from "../../redux/apiCalls";
import MilikTable from "../../components/common/MilikTable";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const TERMINATED_STATUSES = new Set(["terminated", "moved_out", "evicted", "inactive"]);
const isActiveTenant = (tenant) =>
  !TERMINATED_STATUSES.has(String(tenant?.status || "active").trim().toLowerCase());
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
  const [pageSize, setPageSize] = useState(50);
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const queryTenantId = useMemo(() => new URLSearchParams(location.search).get("tenant") || "", [location.search]);

  const currentCompany = useSelector(selectCurrentCompany);
  const leases = useSelector(selectAllLeases);
  const tenants = useSelector(selectAllTenants);
  const entityCache = useEntityCache(currentCompany?._id);
  const entityCacheRef = useRef(entityCache);
  entityCacheRef.current = entityCache;
  const properties = useSelector(selectAllProperties);
  const units = useSelector(selectAllUnits);
  const isFetchingLeases = useSelector((state) => state.lease?.isFetching || false);

  const [filters, setFilters] = useTabState("/agreements:filters", {
    status: "any",
    property: "any",
    search: "",
    expiringOnly: false,
  });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [currentPage, setCurrentPage] = useTabState("/agreements:currentPage", 1);
  const [expandedAgreements, setExpandedAgreements] = useState(new Set());
  const [selectedAgreements, setSelectedAgreements] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(buildInitialForm());
  const [submitting, setSubmitting] = useState(false);
  const [generatingDocId, setGeneratingDocId] = useState(null);
  const [includeTerminatedTenants, setIncludeTerminatedTenants] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [renewModal, setRenewModal] = useState({ open: false, row: null, newEndDate: "", loading: false });
  const [backfilling, setBackfilling] = useState(false);
  useEffect(() => {
    if (!openDropdownId) return;
    const close = () => setOpenDropdownId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openDropdownId]);

  const loadData = useCallback(async () => {
    if (!currentCompany?._id) return;
    const { propertiesLoaded, unitsLoaded, tenantsLoaded } = entityCacheRef.current;
    await Promise.all([
      getLeases(dispatch, currentCompany._id),
      ...(tenantsLoaded ? [] : [dispatch(getTenants({ business: currentCompany._id }))]),
      ...(propertiesLoaded ? [] : [dispatch(getProperties({ business: currentCompany._id }))]),
      ...(unitsLoaded ? [] : [dispatch(getUnits({ business: currentCompany._id }))]),
    ]);
  }, [currentCompany?._id, dispatch]);

  useEffect(() => {
    loadData().catch((error) => {
      toast.error(error?.message || "Failed to load tenant agreements.");
    });
  }, [loadData]);

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

  const tenantSelectOptions = useMemo(
    () => (Array.isArray(tenants) ? tenants : []).filter((t) => includeTerminatedTenants || isActiveTenant(t)).map((t) => ({
      value: t._id,
      label: `${t.name}${t.tenantCode ? ` (${t.tenantCode})` : ""}`,
    })),
    [tenants, includeTerminatedTenants]
  );

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

  const missingCount = useMemo(() => {
    const tenantIdsWithLease = new Set(
      agreementRows
        .filter((r) => ["draft", "pending_signature", "active"].includes(r.status))
        .map((r) => r.tenantId)
    );
    return (Array.isArray(tenants) ? tenants : [])
      .filter((t) => isActiveTenant(t) && !tenantIdsWithLease.has(normalizeId(t._id)))
      .length;
  }, [agreementRows, tenants]);

  const handleBackfillLeases = async () => {
    if (!currentCompany?._id) return;
    setBackfilling(true);
    try {
      const res = await adminRequests.post("/tenants/backfill-leases", { business: currentCompany._id });
      const { created = 0, failed = 0 } = res.data || {};
      if (created > 0) {
        toast.success(`Created ${created} missing agreement${created !== 1 ? "s" : ""}${failed > 0 ? ` (${failed} failed — check unit assignments)` : ""}.`);
        await loadData();
      } else if (failed > 0) {
        toast.warning(`${failed} tenant${failed !== 1 ? "s" : ""} still have no agreement — they may not have a unit assigned.`);
      } else {
        toast.info("No missing agreements found — all active tenants already have one.");
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Backfill failed.");
    } finally {
      setBackfilling(false);
    }
  };

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

  const totalPages = Math.max(1, Math.ceil(sortedFilteredRows.length / pageSize));
  const pageNumbers = useMemo(() => [...Array(totalPages)].map((_, i) => i + 1), [totalPages]);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
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
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to terminate agreement.");
    }
  };

  const handleRenew = (row) => {
    setRenewModal({ open: true, row, newEndDate: formatDateInput(row.endDate), loading: false });
  };

  const handleRenewConfirm = async () => {
    const { row, newEndDate } = renewModal;
    if (!newEndDate) { toast.warning("Please select a new end date"); return; }
    setRenewModal((prev) => ({ ...prev, loading: true }));
    try {
      await renewLease(dispatch, row.id, {
        business: currentCompany?._id,
        newStartDate: formatDateInput(new Date()),
        newEndDate,
        newRentAmount: row.rentAmount,
      });
      toast.success("Agreement renewed successfully.");
      setRenewModal({ open: false, row: null, newEndDate: "", loading: false });
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to renew agreement.");
      setRenewModal((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleDelete = async (row) => {
    const isAutoCreated = Boolean(row.raw?.autoCreatedFromTenant);
    const message = isAutoCreated
      ? `Delete the auto-generated agreement ${row.agreementNumber} for ${row.tenantName}? Once deleted, the tenant record can be permanently removed.`
      : `Delete agreement ${row.agreementNumber}? This action cannot be undone.`;
    const confirmed = await confirm({ title: "Delete Agreement", message, confirmText: "Delete", isDangerous: true });
    if (!confirmed) return;

    try {
      await deleteLease(dispatch, row.id);
      toast.success("Agreement deleted. You may now delete the tenant record.");
      setSelectedAgreements((prev) => prev.filter((id) => id !== row.id));
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to delete agreement.");
    }
  };

  const handleBulkDelete = async () => {
    const selectedRows = agreementRows.filter((r) => selectedAgreements.includes(r.id));
    const deletableRows = selectedRows.filter((r) => {
      const st = String(r.status || "").toLowerCase();
      const isAutoCreated = Boolean(r.raw?.autoCreatedFromTenant);
      return (["draft", "cancelled"].includes(st) && !r.signedByTenant && !r.signedByLandlord) || isAutoCreated;
    });

    if (deletableRows.length === 0) {
      toast.warning("None of the selected agreements can be deleted. Only unsigned draft or cancelled agreements are eligible.");
      return;
    }

    const skipped = selectedRows.length - deletableRows.length;
    const message = skipped > 0
      ? `Delete ${deletableRows.length} of ${selectedRows.length} selected agreements? ${skipped} will be skipped (active or signed). This cannot be undone.`
      : `Delete ${deletableRows.length} agreement${deletableRows.length !== 1 ? "s" : ""}? This cannot be undone.`;

    const confirmed = await confirm({ title: "Bulk Delete Agreements", message, confirmText: `Delete ${deletableRows.length}`, isDangerous: true });
    if (!confirmed) return;

    const results = await Promise.allSettled(deletableRows.map((r) => deleteLease(dispatch, r.id)));
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    if (failed > 0) toast.warning(`${succeeded} deleted, ${failed} failed.`);
    else toast.success(`${succeeded} agreement${succeeded !== 1 ? "s" : ""} deleted.`);

    setSelectedAgreements([]);
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50 p-0">
        <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
          <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
            <span className="shrink-0 text-[10px] font-bold text-gray-500">Total <span className="text-gray-900">{summary.total}</span></span>
            <span className="shrink-0 border border-green-200 bg-green-50 px-1 py-0.5 text-[8px] font-bold text-green-700">Active: {summary.active}</span>
            <span className="shrink-0 border border-amber-200 bg-amber-50 px-1 py-0.5 text-[8px] font-bold text-amber-700">Expiring: {summary.expiring}</span>
            <span className="shrink-0 border border-slate-200 bg-slate-50 px-1 py-0.5 text-[8px] font-bold text-slate-600">Pending: {summary.pending}</span>
            {missingCount > 0 && (
              <span className="shrink-0 border border-red-300 bg-red-50 px-1 py-0.5 text-[8px] font-bold text-red-700">
                {missingCount} tenant{missingCount !== 1 ? "s" : ""} missing agreement
              </span>
            )}
            {selectedAgreements.length > 0 && (
              <>
                <span className="shrink-0 border border-blue-200 bg-blue-50 px-1 py-0.5 text-[8px] font-bold text-blue-700">{selectedAgreements.length} selected</span>
                <button onClick={handleBulkDelete} className="h-[20px] shrink-0 flex items-center gap-0.5 bg-red-600 px-1.5 text-[9px] font-medium text-white shadow-sm hover:bg-red-700">
                  <FaTrash size={7} /> Delete ({selectedAgreements.length})
                </button>
              </>
            )}
            <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
            <button onClick={expandAllAgreements} className="h-[20px] shrink-0 flex items-center gap-0.5 p-1 text-[9px] text-gray-700 hover:bg-gray-200" title="Expand all"><FaExpandAlt size={7} /> Expand</button>
            <button onClick={collapseAllAgreements} className="h-[20px] shrink-0 flex items-center gap-0.5 p-1 text-[9px] text-gray-700 hover:bg-gray-200" title="Collapse all"><FaCompressAlt size={7} /> Collapse</button>
            <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
            <AppSelect
              compact
              clearable
              placeholder="Property"
              value={draftFilters.property}
              onChange={(v) => setDraftFilters((prev) => ({ ...prev, property: v ?? "any" }))}
              options={uniqueProperties.filter((n) => n !== "any").map((n) => ({ value: n, label: toListingCaps(n) }))}
            />
            <AppSelect
              compact
              clearable
              placeholder="Status"
              value={draftFilters.status}
              onChange={(v) => setDraftFilters((prev) => ({ ...prev, status: v ?? "any" }))}
              options={AGREEMENT_STATUS_OPTIONS.map((s) => ({ value: s, label: getStatusLabel(s) }))}
            />
            <label className="h-[20px] shrink-0 inline-flex items-center gap-1.5 border border-slate-200 bg-white px-1.5 text-[9px] text-gray-800 hover:bg-white cursor-pointer">
              <input type="checkbox" checked={draftFilters.expiringOnly} onChange={(event) => setDraftFilters((prev) => ({ ...prev, expiringOnly: event.target.checked }))} className="rounded border-gray-300 text-orange-600 focus:ring-[#0B3B2E]/20" />
              Expiring 30d
            </label>
            <input type="text" value={draftFilters.search} onChange={(event) => setDraftFilters((prev) => ({ ...prev, search: normalizeUppercaseInput(event.target.value) }))} placeholder="Search…" className="h-[20px] w-32 shrink-0 border border-gray-300 bg-white px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
            <button onClick={handleSearchFilters} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-medium text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaSearch size={7} /> Search</button>
            <button onClick={handleResetFilters} className="h-[20px] shrink-0 flex items-center gap-0.5 bg-gray-500 px-1.5 text-[9px] font-medium text-white shadow-sm hover:bg-gray-600"><FaRedoAlt size={7} /> Reset</button>
            <button onClick={() => loadData()} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-medium text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaSyncAlt size={7} /> Refresh</button>
            {missingCount > 0 && (
              <button
                onClick={handleBackfillLeases}
                disabled={backfilling}
                title={`Create agreements for ${missingCount} tenant${missingCount !== 1 ? "s" : ""} that don't have one`}
                className="h-[20px] shrink-0 flex items-center gap-0.5 bg-red-600 px-1.5 text-[9px] font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
              >
                {backfilling ? <FaSyncAlt size={7} className="animate-spin" /> : <FaWrench size={7} />}
                Fix {missingCount} missing
              </button>
            )}
            <button onClick={() => selectedAgreements.length === 1 && openEditModal(sortedFilteredRows.find((row) => row.id === selectedAgreements[0]))} disabled={selectedAgreements.length !== 1} className="h-[20px] shrink-0 flex items-center gap-0.5 bg-blue-500 px-1.5 text-[9px] font-medium text-white shadow-sm hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"><FaEdit size={7} /> Edit</button>
          </div>
        </div>

        <MilikTable
              columns={[
                { label: "Agreement" },
                { label: "Tenant" },
                { label: "Property" },
                { label: "Unit" },
                { label: "Status", align: "center" },
                { label: "Start" },
                { label: "End" },
                { label: "Rent", align: "right" },
                { label: "Deposit", align: "right" },
                { label: "Signatures" },
              ]}
              rows={pagedRows}
              rowKey="id"
              loading={isFetchingLeases && pagedRows.length === 0}
              empty="No tenant agreements found for the selected filters."
              minWidth={1320}
              groupBy={(row) => toListingCaps(row.propertyName)}
              checkboxes
              allChecked={pagedRows.length > 0 && pagedRows.every((r) => selectedAgreements.includes(r.id))}
              someChecked={pagedRows.some((r) => selectedAgreements.includes(r.id))}
              onCheckAll={toggleSelectAllAgreements}
              isChecked={(row) => selectedAgreements.includes(row.id)}
              onCheckRow={(row) => toggleAgreementSelect(row.id)}
              onRowClick={(row) => toggleAgreementSelect(row.id)}
              isSelected={(row) => selectedAgreements.includes(row.id)}
              renderRow={(row) => {
                const normalizedStatus = String(row.status || "").toLowerCase();
                const hasDocument = Boolean(String(row.raw?.documentUrl || "").trim());
                return (
                  <>
                    <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-bold text-[#0B3B2E]">
                      <div>{toListingCaps(row.agreementNumber)}</div>
                      <div className="font-sans font-normal text-gray-500">{getStatusLabel(row.leaseType)}</div>
                      {row.isExpiring && <div className="text-[10px] font-semibold text-red-700">Expires in {row.daysToExpiry} day{row.daysToExpiry === 1 ? "" : "s"}</div>}
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100">
                      <div className="font-bold text-gray-900">{toListingCaps(row.tenantName)}</div>
                      <div className="text-[10px] text-gray-500">{toListingCaps(row.tenantCode || "No code")}</div>
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-gray-900">
                      <div className="font-semibold text-gray-900">{row.propertyCode ? `${row.propertyCode} • ${row.propertyName}` : row.propertyName}</div>
                      {hasDocument && <a href={row.raw.documentUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-700 hover:bg-slate-200">Document Link</a>}
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-gray-900">{toListingCaps(row.unitLabel !== "-" ? row.unitLabel : "No unit linked")}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${getStatusTone(row.status)}`}>{getStatusLabel(row.status)}</span>
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-gray-900">{formatDateLabel(row.startDate)}</td>
                    <td className={`px-3 py-1.5 border-r border-gray-100 font-bold ${row.isExpiring ? "text-red-700" : "text-gray-900"}`}>{formatDateLabel(row.endDate)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold text-gray-900">{formatCurrency(row.rentAmount)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold text-gray-900">{formatCurrency(row.depositAmount)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100">
                      <div className="flex flex-col gap-0.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.signedByTenant ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${row.signedByTenant ? "bg-emerald-500" : "bg-slate-400"}`} />
                          T: {row.signedByTenant ? "Signed" : "Pending"}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.signedByLandlord ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${row.signedByLandlord ? "bg-emerald-500" : "bg-slate-400"}`} />
                          L: {row.signedByLandlord ? "Signed" : "Pending"}
                        </span>
                      </div>
                    </td>
                  </>
                );
              }}
              renderExpanded={(row) => (
                <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-4">
                  <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Lease period</span><p className="font-semibold text-slate-900">{formatDateLabel(row.startDate)} → {formatDateLabel(row.endDate)}</p></div>
                  <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Rent</span><p className="font-semibold text-slate-900">{formatCurrency(row.rentAmount)}</p></div>
                  <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Deposit</span><p className="font-semibold text-slate-900">{formatCurrency(row.depositAmount)}</p></div>
                  <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Signature status</span><p className="font-semibold text-slate-900">Tenant: {row.signedByTenant ? "Signed" : "Pending"} · Landlord: {row.signedByLandlord ? "Signed" : "Pending"}</p></div>
                </div>
              )}
              renderActions={(row) => {
                const normalizedStatus = String(row.status || "").toLowerCase();
                const tenantPending = !row.signedByTenant;
                const landlordPending = !row.signedByLandlord;
                const isAutoCreated = Boolean(row.raw?.autoCreatedFromTenant);
                const hasDocument = Boolean(String(row.raw?.documentUrl || "").trim());
                const canEdit = !["renewed", "terminated", "cancelled"].includes(normalizedStatus);
                const canSign = !["renewed", "terminated", "cancelled", "expired"].includes(normalizedStatus);
                const canRenew = ["active", "expired"].includes(normalizedStatus);
                const canTerminate = ["draft", "pending_signature", "active", "expired"].includes(normalizedStatus);
                const canDelete = (["draft", "cancelled"].includes(normalizedStatus) && tenantPending && landlordPending) || isAutoCreated;
                return (
                  <div className="flex items-center gap-1.5">
                    {canEdit && (
                      <button onClick={() => openEditModal(row)} className="inline-flex items-center gap-1 rounded-lg border border-[#0B3B2E]/15 bg-[#0B3B2E]/5 px-2 py-1 text-[11px] font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E]/10">
                        <FaEdit size={10} /> Edit
                      </button>
                    )}
                    <div className="relative">
                      <button onClick={() => setOpenDropdownId((prev) => (prev === row.id ? null : row.id))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 transition hover:bg-slate-50">
                        <FaEllipsisV size={10} />
                      </button>
                      {openDropdownId === row.id && (
                        <div className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => { handleGenerateDocument(row); setOpenDropdownId(null); }} disabled={generatingDocId === row.id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-orange-700 transition hover:bg-orange-50 disabled:opacity-60">
                            <FaFilePdf size={11} /> {generatingDocId === row.id ? "Generating…" : hasDocument ? "Regenerate Doc" : "Generate Doc"}
                          </button>
                          {canSign && tenantPending && <button onClick={() => { handleSign(row, "tenant"); setOpenDropdownId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-blue-700 transition hover:bg-blue-50"><FaFileSignature size={11} /> Tenant Sign</button>}
                          {canSign && landlordPending && <button onClick={() => { handleSign(row, "landlord"); setOpenDropdownId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-violet-700 transition hover:bg-violet-50"><FaCheck size={11} /> Landlord Sign</button>}
                          {canRenew && <button onClick={() => { handleRenew(row); setOpenDropdownId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-amber-700 transition hover:bg-amber-50"><FaClock size={11} /> Renew</button>}
                          <button onClick={() => { navigate(`/tenant/${row.tenantId}/statement`, { state: { tabTitle: `${row.tenantName} Statement` } }); setOpenDropdownId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"><FaFileContract size={11} /> Statement</button>
                          {canTerminate && <button onClick={() => { handleTerminate(row); setOpenDropdownId(null); }} className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-xs font-semibold text-red-700 transition hover:bg-red-50"><FaTimes size={11} /> Terminate</button>}
                          {canDelete && <button onClick={() => { handleDelete(row); setOpenDropdownId(null); }} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold transition ${isAutoCreated ? "text-red-700 hover:bg-red-50 border-t border-slate-100" : "text-slate-600 hover:bg-slate-50"}`}><FaTrash size={11} /> {isAutoCreated ? "Delete (Wrong Add)" : "Delete"}</button>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />

            <PaginationBar
              page={safeCurrentPage}
              pages={totalPages}
              total={sortedFilteredRows.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={isFetchingLeases}
              label="agreements"
            />

        {modalOpen && (
          <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
            <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
              {/* Modal header */}
              <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
                <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
                  <FaEdit size={13} />
                  {form._id ? "Edit Agreement" : "New Agreement"}
                </h2>
                <button onClick={closeModal} className="text-white/70 transition-colors hover:text-white">
                  <FaTimes size={18} />
                </button>
              </div>

              <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 overflow-y-auto bg-white px-5 py-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {[
                      { label: "Tenant", content: (
                        <>
                          <AppSelect
                            size="md"
                            searchable
                            placeholder="Select tenant"
                            value={form.tenant}
                            onChange={(v) => handleTenantChange(v ?? "")}
                            options={tenantSelectOptions}
                          />
                          <label className="mt-1.5 inline-flex cursor-pointer items-center gap-2 text-[10px] text-slate-500">
                            <input type="checkbox" checked={includeTerminatedTenants} onChange={(e) => setIncludeTerminatedTenants(e.target.checked)} className="border-slate-300" />
                            Include terminated tenants
                          </label>
                        </>
                      )},
                      { label: "Unit", content: (
                        <AppSelect
                          size="md"
                          placeholder="Select unit"
                          value={form.unit}
                          onChange={(v) => setForm((p) => ({ ...p, unit: v ?? "" }))}
                          options={(Array.isArray(units) ? units : []).map((u) => ({ value: u._id, label: u.unitNumber || u.unitName || u.name }))}
                        />
                      )},
                      { label: "Status", content: (
                        <AppSelect
                          size="md"
                          value={form.status}
                          onChange={(v) => setForm((p) => ({ ...p, status: v ?? "active" }))}
                          options={AGREEMENT_STATUS_OPTIONS.map((s) => ({ value: s, label: getStatusLabel(s) }))}
                        />
                      )},
                      { label: "Start Date", content: <input type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0B3B2E]" /> },
                      { label: "End Date", content: <input type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0B3B2E]" /> },
                      { label: "Lease Type", content: (
                        <AppSelect
                          size="md"
                          value={form.leaseType}
                          onChange={(v) => setForm((p) => ({ ...p, leaseType: v ?? "fixed" }))}
                          options={[
                            { value: "fixed", label: "Fixed Term" },
                            { value: "at_will", label: "At Will" },
                          ]}
                        />
                      )},
                      { label: "Monthly Rent", content: <input type="number" min="0" step="0.01" value={form.rentAmount} onChange={(e) => setForm((p) => ({ ...p, rentAmount: e.target.value }))} className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0B3B2E]" /> },
                      { label: "Deposit Amount", content: <input type="number" min="0" step="0.01" value={form.depositAmount} onChange={(e) => setForm((p) => ({ ...p, depositAmount: e.target.value }))} className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0B3B2E]" /> },
                      { label: "Payment Due Day", content: <input type="number" min="1" max="28" value={form.paymentDueDay} onChange={(e) => setForm((p) => ({ ...p, paymentDueDay: e.target.value }))} className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0B3B2E]" /> },
                      { label: "Notice Period (Days)", content: <input type="number" min="0" value={form.noticePeriodDays} onChange={(e) => setForm((p) => ({ ...p, noticePeriodDays: e.target.value }))} className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0B3B2E]" /> },
                      { label: "Late Fee", content: <input type="number" min="0" step="0.01" value={form.lateFee} onChange={(e) => setForm((p) => ({ ...p, lateFee: e.target.value }))} className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0B3B2E]" /> },
                      { label: "Document URL", content: <input type="text" value={form.documentUrl} onChange={(e) => setForm((p) => ({ ...p, documentUrl: e.target.value }))} placeholder="Optional link to signed PDF" className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0B3B2E]" /> },
                    ].map(({ label, content }) => (
                      <div key={label}>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</label>
                        {content}
                      </div>
                    ))}
                  </div>

                  <div className="mt-4">
                    <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Terms / Notes</label>
                    <textarea
                      rows={3}
                      value={form.terms}
                      onChange={(e) => setForm((p) => ({ ...p, terms: e.target.value }))}
                      className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0B3B2E] resize-none"
                      placeholder="Capture notice terms, utility arrangement, renewal notes, or special clauses."
                    />
                  </div>
                </div>

                <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
                  <button type="button" onClick={closeModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 transition-colors hover:bg-slate-100">
                    Cancel
                  </button>
                  <button type="submit" disabled={submitting} className={`px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition-colors ${MILIK_GREEN} ${MILIK_GREEN_HOVER} ${submitting ? "cursor-not-allowed opacity-70" : ""}`}>
                    {submitting ? "Saving…" : form._id ? "Update Agreement" : "Save Agreement"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {renewModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-[#0B3B2E] px-6 py-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                <FaRedoAlt className="text-white text-sm" />
              </div>
              <div>
                <h2 className="text-white font-semibold text-base leading-tight">Renew Agreement</h2>
                <p className="text-white/60 text-xs mt-0.5">{renewModal.row?.tenantName || ""} — {renewModal.row?.agreementNumber || ""}</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
                <FaSyncAlt className="text-blue-500 mt-0.5 shrink-0" />
                <p className="text-sm text-blue-800">Set the new end date for the renewed agreement. The start date will be updated to today.</p>
              </div>
              <div className="space-y-1.5">
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">New End Date <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  autoFocus
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 disabled:bg-slate-50 disabled:cursor-not-allowed"
                  value={renewModal.newEndDate}
                  onChange={(e) => setRenewModal((prev) => ({ ...prev, newEndDate: e.target.value }))}
                  disabled={renewModal.loading}
                />
              </div>
            </div>
            <div className="px-6 pb-5 flex justify-end gap-3">
              <button onClick={() => setRenewModal({ open: false, row: null, newEndDate: "", loading: false })} disabled={renewModal.loading} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button onClick={handleRenewConfirm} disabled={renewModal.loading || !renewModal.newEndDate} className="inline-flex items-center gap-2 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                {renewModal.loading ? <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>Renewing…</> : <><FaRedoAlt className="text-xs" />Confirm Renewal</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default TenantAgreements;

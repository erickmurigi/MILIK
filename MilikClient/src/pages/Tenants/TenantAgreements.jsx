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
import { normalizeUppercaseInput, toListingCaps } from "../../utils/listingPageUtils";
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
import ListToolbar from "../../components/common/ListToolbar";
import { useConfirm } from "../../context/ConfirmContext";
import { adminRequests } from "../../utils/requestMethods";
import { getTenants } from "../../redux/tenantsRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getUnits } from "../../redux/unitRedux";
import { useTabState } from "../../hooks/useTabState";
import { useTerms } from '../../hooks/useTerm';
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

// Module-scope — stable reference avoids busting AppSelect's internal useMemo every render
const AGREEMENT_STATUS_SELECT_OPTIONS = AGREEMENT_STATUS_OPTIONS.map((s) => ({ value: s, label: getStatusLabel(s) }));

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
  const { tenant: termTenant, tenants: termTenants, unit: termUnit, property: termProperty, landlord: termLandlord, rent: termRent, lease: termLease } = useTerms("tenant", "tenants", "unit", "property", "landlord", "rent", "lease");

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
  const selectedAgreementsSet = useMemo(() => new Set(selectedAgreements), [selectedAgreements]);
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
  // Stable option array — avoids busting AppSelect's internal useMemo on every render
  const unitSelectOptions = useMemo(() => (Array.isArray(units) ? units : []).map((u) => ({ value: u._id, label: u.unitNumber || u.unitName || u.name })), [units]);

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

  // Counts missing (tenant, unit) pairs, not just tenants with zero leases — a
  // multi-unit tenant can already have a lease for their primary unit while their
  // additional units have none, which a tenant-only check would never surface.
  // Matches what the backend backfill endpoint actually repairs.
  const missingCount = useMemo(() => {
    const leasedPairs = new Set(
      agreementRows
        .filter((r) => ["draft", "pending_signature", "active"].includes(r.status))
        .map((r) => `${r.tenantId}|${r.unitId}`)
    );

    let count = 0;
    for (const tenant of Array.isArray(tenants) ? tenants : []) {
      if (!isActiveTenant(tenant)) continue;
      const tenantId = normalizeId(tenant._id);
      const assignedUnitIds = [
        normalizeId(tenant?.unit?._id || tenant?.unit),
        ...(Array.isArray(tenant?.additionalUnits) ? tenant.additionalUnits.map((u) => normalizeId(u?._id || u)) : []),
      ].filter(Boolean);

      for (const unitId of assignedUnitIds) {
        if (!leasedPairs.has(`${tenantId}|${unitId}`)) count += 1;
      }
    }
    return count;
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
        toast.warning(`${failed} unit${failed !== 1 ? "s" : ""} still have no agreement — check the ${termUnit.toLowerCase()} assignment.`);
      } else {
        toast.info(`No missing agreements found — all active ${termTenants.toLowerCase()} already have one.`);
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
  // Stable option array — avoids busting AppSelect's internal useMemo on every render
  const uniquePropertyOptions = useMemo(() => uniqueProperties.filter((n) => n !== "any").map((n) => ({ value: n, label: toListingCaps(n) })), [uniqueProperties]);

  const toggleAgreementSelect = (id) => {
    setSelectedAgreements((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const toggleSelectAllAgreements = () => {
    const allIds = pagedRows.map((r) => r.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedAgreementsSet.has(id));
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
    if (!form.tenant) return `${termTenant} is required.`;
    if (!form.unit) return `${termUnit} is required.`;
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
        toast.success(`${termTenant} agreement updated successfully.`);
      } else {
        await createLease(dispatch, payload);
        toast.success(`${termTenant} agreement created successfully.`);
      }
      closeModal();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || `Failed to save ${termTenant.toLowerCase()} agreement.`);
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
      toast.success(`${signedBy === "tenant" ? termTenant : termLandlord} signature recorded.`);
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
        <ListToolbar>
          <span className="shrink-0 text-[10px] font-bold text-slate-500">Total <span className="text-slate-900">{summary.total}</span></span>
          <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Active: {summary.active}</span>
          <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Expiring: {summary.expiring}</span>
          <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Pending: {summary.pending}</span>
          {missingCount > 0 && (
            <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-red-700">
              {missingCount} missing agreement{missingCount !== 1 ? "s" : ""}
            </span>
          )}
          {selectedAgreements.length > 0 && (
            <>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">{selectedAgreements.length} selected</span>
              <ListToolbar.Button icon={FaTrash} variant="danger" onClick={handleBulkDelete}>
                Delete ({selectedAgreements.length})
              </ListToolbar.Button>
            </>
          )}
          <ListToolbar.Divider />
          <ListToolbar.Button icon={FaExpandAlt} variant="outline" onClick={expandAllAgreements} title="Expand all">Expand</ListToolbar.Button>
          <ListToolbar.Button icon={FaCompressAlt} variant="outline" onClick={collapseAllAgreements} title="Collapse all">Collapse</ListToolbar.Button>
          <ListToolbar.Divider />
          <AppSelect
            compact
            clearable
            placeholder={termProperty}
            value={draftFilters.property}
            onChange={(v) => setDraftFilters((prev) => ({ ...prev, property: v ?? "any" }))}
            options={uniquePropertyOptions}
          />
          <AppSelect
            compact
            clearable
            placeholder="Status"
            value={draftFilters.status}
            onChange={(v) => setDraftFilters((prev) => ({ ...prev, status: v ?? "any" }))}
            options={AGREEMENT_STATUS_SELECT_OPTIONS}
          />
          <label className="h-[20px] shrink-0 inline-flex items-center gap-1.5 border border-slate-200 bg-white px-1.5 text-[9px] text-gray-800 hover:bg-white cursor-pointer">
            <input type="checkbox" checked={draftFilters.expiringOnly} onChange={(event) => setDraftFilters((prev) => ({ ...prev, expiringOnly: event.target.checked }))} className="rounded border-gray-300 text-orange-600 focus:ring-[#0B3B2E]/20" />
            Expiring 30d
          </label>
          <ListToolbar.Input width="w-32" type="text" value={draftFilters.search} onChange={(event) => setDraftFilters((prev) => ({ ...prev, search: normalizeUppercaseInput(event.target.value) }))} placeholder="Search…" />
          <ListToolbar.Button icon={FaSearch} onClick={handleSearchFilters}>Search</ListToolbar.Button>
          <ListToolbar.Button icon={FaRedoAlt} variant="dark" onClick={handleResetFilters}>Reset</ListToolbar.Button>
          <ListToolbar.Button icon={FaSyncAlt} onClick={() => loadData()}>Refresh</ListToolbar.Button>
          {missingCount > 0 && (
            <ListToolbar.Button
              variant="danger"
              onClick={handleBackfillLeases}
              disabled={backfilling}
              title={`Create ${missingCount} missing agreement${missingCount !== 1 ? "s" : ""} — covers every unit a ${termTenant.toLowerCase()} occupies that doesn't have one yet`}
            >
              {backfilling ? <FaSyncAlt size={7} className="animate-spin" /> : <FaWrench size={7} />}
              Fix {missingCount} missing
            </ListToolbar.Button>
          )}
          <ListToolbar.Button
            icon={FaEdit}
            variant="outline"
            onClick={() => selectedAgreements.length === 1 && openEditModal(sortedFilteredRows.find((row) => row.id === selectedAgreements[0]))}
            disabled={selectedAgreements.length !== 1}
          >Edit</ListToolbar.Button>
        </ListToolbar>

        <MilikTable
              columns={[
                { label: "Agreement", width: "15%" },
                { label: termTenant, width: "15%" },
                { label: termProperty, width: "12%" },
                { label: termUnit, width: "5%" },
                { label: "Status", align: "center", width: "12%" },
                { label: "Start", width: "8%" },
                { label: "End", width: "8%" },
                { label: "Rent", align: "right", width: "9%" },
                { label: "Deposit", align: "right", width: "9%" },
              ]}
              rows={pagedRows}
              rowKey="id"
              loading={isFetchingLeases && pagedRows.length === 0}
              empty="No tenant agreements found for the selected filters."
              groupBy={(row) => toListingCaps(row.propertyName)}
              checkboxes
              allChecked={pagedRows.length > 0 && pagedRows.every((r) => selectedAgreementsSet.has(r.id))}
              someChecked={pagedRows.some((r) => selectedAgreementsSet.has(r.id))}
              onCheckAll={toggleSelectAllAgreements}
              isChecked={(row) => selectedAgreementsSet.has(row.id)}
              onCheckRow={(row) => toggleAgreementSelect(row.id)}
              onRowClick={(row) => toggleAgreementSelect(row.id)}
              isSelected={(row) => selectedAgreementsSet.has(row.id)}
              renderRow={(row) => {
                const normalizedStatus = String(row.status || "").toLowerCase();
                const hasDocument = Boolean(String(row.raw?.documentUrl || "").trim());
                return (
                  <>
                    <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap font-mono font-bold text-[#0B3B2E]">
                      {toListingCaps(row.agreementNumber)}
                      <span className="ml-2 font-sans font-normal text-gray-500">{getStatusLabel(row.leaseType)}</span>
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap">
                      <span className="font-bold text-gray-900">{toListingCaps(row.tenantName)}</span>
                      <span className="ml-2 text-[10px] text-gray-500">{toListingCaps(row.tenantCode || "No code")}</span>
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap font-semibold text-gray-900">
                      {row.propertyCode ? `${row.propertyCode} • ${row.propertyName}` : row.propertyName}
                      {hasDocument && <a href={row.raw.documentUrl} target="_blank" rel="noreferrer" className="ml-2 text-[10px] font-bold uppercase tracking-wide text-[#0B3B2E] underline">Document</a>}
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-gray-900">{toListingCaps(row.unitLabel !== "-" ? row.unitLabel : "No unit linked")}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-center">
                      <div className="flex items-center justify-center gap-1.5 whitespace-nowrap" title={[!row.signedByTenant && `${termTenant} unsigned`, !row.signedByLandlord && `${termLandlord} unsigned`].filter(Boolean).join(" · ") || "All parties signed"}>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${getStatusTone(row.status)}`}>{getStatusLabel(row.status)}</span>
                        <span className={`text-[10px] font-bold ${(row.signedByTenant ? 1 : 0) + (row.signedByLandlord ? 1 : 0) === 2 ? "text-slate-900" : "text-slate-500"}`}>{(row.signedByTenant ? 1 : 0) + (row.signedByLandlord ? 1 : 0)}/2 signed</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-gray-900">{formatDateLabel(row.startDate)}</td>
                    <td className={`px-3 py-1.5 border-r border-gray-100 whitespace-nowrap font-bold ${row.isExpiring ? "text-red-700" : "text-gray-900"}`}>
                      {formatDateLabel(row.endDate)}
                      {row.isExpiring && <span className="ml-2 text-[10px] font-semibold">{row.daysToExpiry} day{row.daysToExpiry === 1 ? "" : "s"} left</span>}
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold text-gray-900">{formatCurrency(row.rentAmount)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold text-gray-900">{formatCurrency(row.depositAmount)}</td>
                  </>
                );
              }}
              renderExpanded={(row) => (
                <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-4">
                  <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">{termLease} period</span><p className="font-semibold text-slate-900">{formatDateLabel(row.startDate)} → {formatDateLabel(row.endDate)}</p></div>
                  <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">{termRent}</span><p className="font-semibold text-slate-900">{formatCurrency(row.rentAmount)}</p></div>
                  <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Deposit</span><p className="font-semibold text-slate-900">{formatCurrency(row.depositAmount)}</p></div>
                  <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Signature status</span><p className="font-semibold text-slate-900">{termTenant}: {row.signedByTenant ? "Signed" : "Pending"} · {termLandlord}: {row.signedByLandlord ? "Signed" : "Pending"}</p></div>
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
                      <button onClick={() => openEditModal(row)} className="inline-flex items-center gap-1 h-6 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50">
                        <FaEdit size={10} /> Edit
                      </button>
                    )}
                    <div className="relative">
                      <button onClick={() => setOpenDropdownId((prev) => (prev === row.id ? null : row.id))} className="inline-flex items-center gap-1 h-6 border border-slate-300 bg-white px-2 text-slate-700 hover:bg-slate-50">
                        <FaEllipsisV size={10} />
                      </button>
                      {openDropdownId === row.id && (
                        <div className="absolute right-0 z-50 mt-1 w-44 overflow-hidden border border-slate-300 bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => { handleGenerateDocument(row); setOpenDropdownId(null); }} disabled={generatingDocId === row.id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60">
                            <FaFilePdf size={11} /> {generatingDocId === row.id ? "Generating…" : hasDocument ? "Regenerate Doc" : "Generate Doc"}
                          </button>
                          {canSign && tenantPending && <button onClick={() => { handleSign(row, "tenant"); setOpenDropdownId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50"><FaFileSignature size={11} /> {termTenant} Sign</button>}
                          {canSign && landlordPending && <button onClick={() => { handleSign(row, "landlord"); setOpenDropdownId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50"><FaCheck size={11} /> {termLandlord} Sign</button>}
                          {canRenew && <button onClick={() => { handleRenew(row); setOpenDropdownId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50"><FaClock size={11} /> Renew</button>}
                          <button onClick={() => { navigate(`/tenant/${row.tenantId}/statement`, { state: { tabTitle: `${row.tenantName} Statement` } }); setOpenDropdownId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50"><FaFileContract size={11} /> Statement</button>
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
                      { label: termTenant, content: (
                        <>
                          <AppSelect
                            size="md"
                            searchable
                            placeholder={`Select ${termTenant.toLowerCase()}`}
                            value={form.tenant}
                            onChange={(v) => handleTenantChange(v ?? "")}
                            options={tenantSelectOptions}
                          />
                          <label className="mt-1.5 inline-flex cursor-pointer items-center gap-2 text-[10px] text-slate-500">
                            <input type="checkbox" checked={includeTerminatedTenants} onChange={(e) => setIncludeTerminatedTenants(e.target.checked)} className="border-slate-300" />
                            Include terminated {termTenants.toLowerCase()}
                          </label>
                        </>
                      )},
                      { label: termUnit, content: (
                        <AppSelect
                          size="md"
                          placeholder={`Select ${termUnit.toLowerCase()}`}
                          value={form.unit}
                          onChange={(v) => setForm((p) => ({ ...p, unit: v ?? "" }))}
                          options={unitSelectOptions}
                        />
                      )},
                      { label: "Status", content: (
                        <AppSelect
                          size="md"
                          value={form.status}
                          onChange={(v) => setForm((p) => ({ ...p, status: v ?? "active" }))}
                          options={AGREEMENT_STATUS_SELECT_OPTIONS}
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
          <div className="bg-white border border-slate-300 shadow-xl w-full max-w-md overflow-hidden">
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
              <div className="flex items-start gap-3 bg-slate-50 border border-slate-200 px-4 py-3">
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

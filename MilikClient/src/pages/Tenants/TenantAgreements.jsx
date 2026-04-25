import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaCheck,
  FaClock,
  FaEdit,
  FaFileSignature,
  FaFilter,
  FaPlus,
  FaRedoAlt,
  FaSearch,
  FaSyncAlt,
  FaTimes,
  FaTrash,
  FaUser,
  FaFileContract,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenants } from "../../redux/tenantsRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getUnits } from "../../redux/unitRedux";
import {
  createLease,
  deleteLease,
  getLeases,
  renewLease,
  signLease,
  updateLease,
} from "../../redux/apiCalls";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";
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
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedAgreementId, setExpandedAgreementId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(buildInitialForm());
  const [submitting, setSubmitting] = useState(false);

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
      if (filters.property !== "any" && row.propertyId !== filters.property) return false;
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

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pagedRows = filteredRows.slice((safeCurrentPage - 1) * ITEMS_PER_PAGE, safeCurrentPage * ITEMS_PER_PAGE);

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
      setModalOpen(false);
      setForm(buildInitialForm());
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to save tenant agreement.");
    } finally {
      setSubmitting(false);
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
    const confirmed = window.confirm(`Terminate agreement ${row.agreementNumber}?`);
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
    const confirmed = window.confirm(`Delete agreement ${row.agreementNumber}?`);
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
        <div className="sticky top-0 z-20 bg-gray-50 px-2 pt-2">
          <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="grid grid-cols-5 gap-1">
              {[
                { label: "Total", value: summary.total, tone: "bg-slate-50 border-slate-200 text-slate-800" },
                { label: "Active", value: summary.active, tone: "bg-emerald-50 border-emerald-200 text-emerald-800" },
                { label: "Pending", value: summary.pending, tone: "bg-blue-50 border-blue-200 text-blue-800" },
                { label: "Expiring Soon", value: summary.expiring, tone: "bg-amber-50 border-amber-200 text-amber-800" },
                { label: "Terminated", value: summary.terminated, tone: "bg-red-50 border-red-200 text-red-700" },
              ].map((card) => (
                <div key={card.label} className={`rounded-md border px-2 py-1 ${card.tone}`}>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em]">{card.label}</div>
                  <div className="mt-1 text-[11px] font-black">{card.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-2 pt-2">
          <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 px-1.5 py-1 text-[11px] text-gray-800 shadow-sm">
                <FaSearch className="text-[11px]" />
                <input
                  value={filters.search}
                  onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                  placeholder="Search agreement, tenant, property or unit"
                  className="w-full bg-transparent text-[11px] outline-none"
                />
              </div>

              <select
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                className="rounded border border-orange-300 bg-orange-50 px-2 py-1 text-[11px] text-gray-800 shadow-sm focus:outline-none"
              >
                <option value="any">All Statuses</option>
                {AGREEMENT_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{getStatusLabel(status)}</option>
                ))}
              </select>

              <select
                value={filters.property}
                onChange={(event) => setFilters((prev) => ({ ...prev, property: event.target.value }))}
                className="rounded border border-orange-300 bg-orange-50 px-2 py-1 text-[11px] text-gray-800 shadow-sm focus:outline-none"
              >
                <option value="any">All Properties</option>
                {[...(Array.isArray(properties) ? properties : [])]
                  .sort((a, b) => String(a?.propertyName || a?.name || "").localeCompare(String(b?.propertyName || b?.name || ""), undefined, { sensitivity: "base" }))
                  .map((property) => (
                    <option key={property._id} value={property._id}>
                      {property.propertyCode ? `${property.propertyCode} - ${property.propertyName || property.name}` : property.propertyName || property.name}
                    </option>
                  ))}
              </select>

              <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 shadow-sm">
                <input
                  type="checkbox"
                  checked={filters.expiringOnly}
                  onChange={(event) => setFilters((prev) => ({ ...prev, expiringOnly: event.target.checked }))}
                />
                Expiring in 30 days
              </label>

              <button
                onClick={() => setFilters({ status: "any", property: "any", search: "", expiringOnly: false })}
                className={`flex items-center gap-2 rounded-md px-3 py-1 text-[11px] text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
              >
                <FaRedoAlt className="text-[11px]" />
                Reset
              </button>


              <button
                onClick={() => loadData()}
                className={`flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-black text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
              >
                <FaSyncAlt className="text-[11px]" /> Refresh
              </button>

              <button
                onClick={() => openNewModal()}
                className={`flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-black text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
              >
                <FaPlus className="text-[11px]" /> New Agreement
              </button>            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
          <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1180px] table-fixed border-collapse text-[11px]" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "90px" }} />
                  <col style={{ width: "130px" }} />
                  <col style={{ width: "145px" }} />
                  <col style={{ width: "90px" }} />
                  <col style={{ width: "88px" }} />
                  <col style={{ width: "82px" }} />
                  <col style={{ width: "82px" }} />
                  <col style={{ width: "82px" }} />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "255px" }} />
                </colgroup>
                <thead>
                  <tr className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                    <th className="px-1.5 py-1 text-left font-bold">Agreement</th>
                    <th className="px-1.5 py-1 text-left font-bold">Tenant</th>
                    <th className="px-1.5 py-1 text-left font-bold">Property / Unit</th>
                    <th className="px-1.5 py-1 text-left font-bold">Status</th>
                    <th className="px-1.5 py-1 text-left font-bold">Start</th>
                    <th className="px-1.5 py-1 text-left font-bold">End</th>
                    <th className="px-1.5 py-1 text-right font-bold">Rent</th>
                    <th className="px-1.5 py-1 text-right font-bold">Deposit</th>
                    <th className="px-1.5 py-1 text-left font-bold">Signatures</th>
                    <th className="px-1.5 py-1 text-left font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-[11px] text-gray-500">
                        {isFetchingLeases ? "Loading agreements..." : "No tenant agreements found for the selected filters."}
                      </td>
                    </tr>
                  ) : (
                    pagedRows.map((row) => {
                      const normalizedStatus = String(row.status || "").toLowerCase();
                      const tenantPending = !row.signedByTenant;
                      const landlordPending = !row.signedByLandlord;
                      const canEdit = !["renewed", "terminated", "cancelled"].includes(normalizedStatus);
                      const canSign = !["renewed", "terminated", "cancelled", "expired"].includes(normalizedStatus);
                      const canRenew = ["active", "expired"].includes(normalizedStatus);
                      const canTerminate = ["draft", "pending_signature", "active", "expired"].includes(normalizedStatus);
                      const canDelete = ["draft", "cancelled"].includes(normalizedStatus) && tenantPending && landlordPending;
                      const hasDocument = Boolean(String(row.raw?.documentUrl || "").trim());

                      return (
                      <React.Fragment key={row.id}>
                      <tr onClick={() => setExpandedAgreementId((prev) => (prev === row.id ? null : row.id))} className="cursor-pointer border-b border-gray-200 transition hover:bg-[#f9fbfa]">
                        <td className="px-1.5 py-1 align-top">
                          <div className="font-black text-[#0B3B2E]">{row.agreementNumber}</div>
                          <div className="mt-1 text-[11px] text-slate-500">{getStatusLabel(row.leaseType)}</div>
                          {row.isExpiring && (
                            <div className="mt-2 inline-flex rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-800">
                              Expires in {row.daysToExpiry} day{row.daysToExpiry === 1 ? "" : "s"}
                            </div>
                          )}
                        </td>
                        <td className="px-1.5 py-1 align-top">
                          <div className="font-bold text-gray-900">{row.tenantName}</div>
                          <div className="mt-1 text-[11px] text-slate-500">{row.tenantCode || "No code"}</div>
                        </td>
                        <td className="px-1.5 py-1 align-top">
                          <div className="font-semibold text-gray-900">{row.propertyCode ? `${row.propertyCode} • ${row.propertyName}` : row.propertyName}</div>
                          <div className="mt-1 text-[11px] text-slate-500">{row.unitLabel !== "-" ? row.unitLabel : "No unit linked"}</div>
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
                        <td className="px-1.5 py-1 align-top">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${getStatusTone(row.status)}`}>
                            {getStatusLabel(row.status)}
                          </span>
                        </td>
                        <td className="px-1.5 py-1 align-top whitespace-nowrap">{formatDateLabel(row.startDate)}</td>
                        <td className="px-1.5 py-1 align-top whitespace-nowrap">{formatDateLabel(row.endDate)}</td>
                        <td className="px-1.5 py-1 text-right align-top whitespace-nowrap font-bold">{formatCurrency(row.rentAmount)}</td>
                        <td className="px-1.5 py-1 text-right align-top whitespace-nowrap font-bold">{formatCurrency(row.depositAmount)}</td>
                        <td className="px-1.5 py-1 align-top">
                          <div className="space-y-1 text-[11px]">
                            <div className={row.signedByTenant ? "text-emerald-700 font-semibold" : "text-slate-500"}>
                              Tenant: {row.signedByTenant ? "Signed" : "Pending"}
                            </div>
                            <div className={row.signedByLandlord ? "text-emerald-700 font-semibold" : "text-slate-500"}>
                              Landlord: {row.signedByLandlord ? "Signed" : "Pending"}
                            </div>
                          </div>
                        </td>
                        <td className="px-1.5 py-1 align-top">
                          <div className="flex flex-wrap gap-1.5">
                            {canEdit && (
                              <button
                                onClick={(event) => { event.stopPropagation(); openEditModal(row); }}
                                className="rounded-lg border border-[#0B3B2E]/15 bg-[#0B3B2E]/5 px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E]/10"
                              >
                                <FaEdit className="inline mr-1" /> Edit
                              </button>
                            )}
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
                        {expandedAgreementId === row.id && (
                          <tr className="border-b border-gray-200 bg-slate-50">
                            <td colSpan={10} className="px-1.5 py-1">
                              <div className="grid gap-2 text-[11px] md:grid-cols-4">
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

            <div className="flex items-center justify-between border-t border-gray-200 px-1.5 py-1 text-[11px] text-slate-600">
              <div>
                Showing {pagedRows.length ? (safeCurrentPage - 1) * ITEMS_PER_PAGE + 1 : 0} to {Math.min(safeCurrentPage * ITEMS_PER_PAGE, filteredRows.length)} of {filteredRows.length} agreement(s)
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={safeCurrentPage === 1}
                  className="rounded border border-gray-300 px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Prev
                </button>
                <span>Page {safeCurrentPage} of {totalPages}</span>
                <button
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={safeCurrentPage === totalPages}
                  className="rounded border border-gray-300 px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
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
                <button onClick={() => { setModalOpen(false); setForm(buildInitialForm()); }} className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700">
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
                      {(Array.isArray(tenants) ? tenants : []).map((tenant) => (
                        <option key={tenant._id} value={tenant._id}>{tenant.name} {tenant.tenantCode ? `(${tenant.tenantCode})` : ""}</option>
                      ))}
                    </select>
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
                    onClick={() => { setModalOpen(false); setForm(buildInitialForm()); }}
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

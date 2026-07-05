import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDebounce from "../../hooks/useDebounce";
import { useSelector } from "react-redux";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import {
  FaCheckCircle,
  FaClock,
  FaDownload,
  FaEdit,
  FaExclamationTriangle,
  FaFilter,
  FaPlus,
  FaRedoAlt,
  FaSearch,
  FaTimes,
  FaTools,
  FaTrash,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import { adminRequests } from "../../utils/requestMethods";
import { hasCompanyPermission } from "../../utils/permissions";
import { useConfirm } from "../../context/ConfirmContext";

const DEFAULT_PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const PRIORITY_OPTIONS = [
  { value: "all", label: "All priorities" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "emergency", label: "Emergency" },
];

const EMPTY_FORM = {
  property: "",
  unit: "",
  tenant: "",
  title: "",
  description: "",
  priority: "medium",
  status: "pending",
  assignedTo: "",
  scheduledDate: "",
  estimatedCost: "",
  actualCost: "",
  completedDate: "",
};

const toList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.units)) return payload.units;
  if (Array.isArray(payload?.tenants)) return payload.tenants;
  if (Array.isArray(payload?.properties)) return payload.properties;
  return [];
};

const money = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const toInputDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const getPropertyName = (property) =>
  property?.propertyName || property?.name || property?.title || "Unnamed";

const getUnitPropertyId = (unit) => String(unit?.property?._id || unit?.property || "");
const getRequestPropertyName = (item) => getPropertyName(item?.unit?.property);

const STATUS_BADGE = {
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
};

const PRIORITY_BADGE = {
  emergency: "bg-rose-100 text-rose-700 border-rose-300",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  medium: "bg-violet-50 text-violet-700 border-violet-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
};

const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const Maintenances = () => {
  const confirm = useConfirm();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const isDemoUser = Boolean(currentUser?.isDemoUser);
  const canCreate = hasCompanyPermission(currentUser, currentCompany, "maintenances", "create", "propertyManagement");
  const canUpdate = hasCompanyPermission(currentUser, currentCompany, "maintenances", "update", "propertyManagement");
  const canDelete = hasCompanyPermission(currentUser, currentCompany, "maintenances", "delete", "propertyManagement");

  const [requests, setRequests] = useState([]);
  const [properties, setProperties] = useState([]);
  const [units, setUnits] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverPages, setServerPages] = useState(1);
  const [updatingId, setUpdatingId] = useState("");

  const debouncedSearch = useDebounce(searchTerm, 400);

  // Draft persistence — survives tab switches for new-record modal only
  const _mDraftKey = (currentCompany?._id && (currentUser?._id || currentUser?.id))
    ? `milik:draft:maint-modal:${currentCompany._id}:${currentUser?._id || currentUser?.id || "u"}`
    : null;
  const _mDraftRestored = useRef(false);

  useEffect(() => {
    if (!_mDraftKey || _mDraftRestored.current) return;
    _mDraftRestored.current = true;
    try {
      const raw = window.sessionStorage.getItem(_mDraftKey);
      if (raw) {
        const { form: saved } = JSON.parse(raw);
        if (saved) { setForm(saved); setIsModalOpen(true); }
      }
    } catch {}
  }, [_mDraftKey]);

  useEffect(() => {
    if (!_mDraftKey || !_mDraftRestored.current || !isModalOpen || editingRequest) return;
    try { window.sessionStorage.setItem(_mDraftKey, JSON.stringify({ form })); } catch {}
  }, [_mDraftKey, form, isModalOpen, editingRequest]);

  const loadRequests = useCallback(async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business: currentCompany._id,
        page: currentPage,
        limit: pageSize,
      });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());

      const res = await adminRequests.get(`/maintenances?${params}`);
      setRequests(toList(res.data?.data ?? res.data));
      setServerTotal(res.data?.total ?? 0);
      setServerPages(res.data?.pages ?? 1);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load maintenance requests");
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id, currentPage, pageSize, statusFilter, priorityFilter, debouncedSearch]);

  const loadFormData = useCallback(async () => {
    if (!currentCompany?._id) return;
    try {
      const business = currentCompany._id;
      const [unitsRes, tenantsRes, propertiesRes] = await Promise.all([
        adminRequests.get(`/units?business=${business}&limit=1000`),
        adminRequests.get(`/tenants?business=${business}&limit=1000`),
        adminRequests.get(`/properties?business=${business}&limit=1000`),
      ]);
      setUnits(toList(unitsRes.data));
      setTenants(toList(tenantsRes.data));
      setProperties(toList(propertiesRes.data));
    } catch { /* non-critical */ }
  }, [currentCompany?._id]);

  useEffect(() => { loadRequests(); }, [loadRequests]);
  useEffect(() => { loadFormData(); }, [loadFormData]);

  useEffect(() => { setCurrentPage(1); }, [statusFilter, priorityFilter, debouncedSearch, pageSize]);

  const availableTenants = useMemo(() => {
    if (!form.unit) return tenants;
    return tenants.filter((t) => String(t?.unit?._id || t?.unit || "") === String(form.unit));
  }, [form.unit, tenants]);

  const selectedPropertyId = useMemo(() => {
    const unitMatch = units.find((u) => String(u?._id) === String(form.unit));
    return String(unitMatch?.property?._id || unitMatch?.property || form.property || "");
  }, [form.property, form.unit, units]);

  const availableUnits = useMemo(() => {
    if (!selectedPropertyId) return units;
    return units.filter((u) => getUnitPropertyId(u) === selectedPropertyId);
  }, [selectedPropertyId, units]);

  useEffect(() => {
    if (!form.unit) return;
    if (!availableTenants.some((t) => String(t?._id) === String(form.tenant))) {
      setForm((prev) => ({ ...prev, tenant: "" }));
    }
  }, [availableTenants, form.tenant, form.unit]);

  const filteredRequests = useMemo(() => {
    // Server-side filtering is active; client-side pass-through for display only.
    const query = ""; // search already sent to server
    return requests.filter((item) => {
      if (query) {
        const haystack = [item?.title, item?.description, item?.assignedTo, item?.tenant?.name, item?.unit?.unitNumber, getRequestPropertyName(item)]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [priorityFilter, requests, searchTerm, statusFilter]);

  const stats = useMemo(() => {
    const acc = { total: serverTotal, pending: 0, inProgress: 0, completed: 0, cancelled: 0, emergency: 0 };
    requests.forEach(r => {
      if (r?.status === "pending") acc.pending++;
      if (r?.status === "in_progress") acc.inProgress++;
      if (r?.status === "completed") acc.completed++;
      if (r?.status === "cancelled") acc.cancelled++;
      if (r?.priority === "emergency") acc.emergency++;
    });
    return acc;
  }, [requests, serverTotal]);

  const SUMMARY_CHIPS = useMemo(() => [
    { key: "pending",     label: "Pending",     count: stats.pending,    dot: "bg-amber-400",   text: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200",   filterType: "status"   },
    { key: "in_progress", label: "In Progress", count: stats.inProgress, dot: "bg-blue-400",    text: "text-blue-700",    bg: "bg-blue-50",    border: "border-blue-200",    filterType: "status"   },
    { key: "completed",   label: "Completed",   count: stats.completed,  dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", filterType: "status"   },
    { key: "cancelled",   label: "Cancelled",   count: stats.cancelled,  dot: "bg-slate-400",   text: "text-slate-600",   bg: "bg-slate-50",   border: "border-slate-200",   filterType: "status"   },
    { key: "emergency",   label: "Emergency",   count: stats.emergency,  dot: "bg-rose-500",    text: "text-rose-700",    bg: "bg-rose-50",    border: "border-rose-200",    filterType: "priority" },
  ], [stats]);

  const totalPages = Math.max(1, serverPages);
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = requests; // server already returns the correct page slice

  const openCreateModal = () => {
    if (isDemoUser) { toast.info("Demo mode is read-only."); return; }
    if (!canCreate) { toast.warning("You do not have permission to create maintenance requests."); return; }
    setEditingRequest(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (item) => {
    if (isDemoUser) { toast.info("Demo mode is read-only."); return; }
    if (!canUpdate) { toast.warning("You do not have permission to edit maintenance requests."); return; }
    if (_mDraftKey) { try { window.sessionStorage.removeItem(_mDraftKey); } catch {} }
    setEditingRequest(item);
    setForm({
      property: String(item?.unit?.property?._id || item?.unit?.property || ""),
      unit: String(item?.unit?._id || item?.unit || ""),
      tenant: String(item?.tenant?._id || item?.tenant || ""),
      title: item?.title || "",
      description: item?.description || "",
      priority: item?.priority || "medium",
      status: item?.status || "pending",
      assignedTo: item?.assignedTo || "",
      scheduledDate: toInputDate(item?.scheduledDate),
      estimatedCost: item?.estimatedCost ? String(item.estimatedCost) : "",
      actualCost: item?.actualCost ? String(item.actualCost) : "",
      completedDate: toInputDate(item?.completedDate),
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    if (_mDraftKey) { try { window.sessionStorage.removeItem(_mDraftKey); } catch {} }
    setIsModalOpen(false);
    setEditingRequest(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!currentCompany?._id) { toast.error("Select a company first"); return; }
    if (!form.unit) { toast.error("Unit is required"); return; }
    if (!form.title.trim()) { toast.error("Issue title is required"); return; }
    if (!form.description.trim()) { toast.error("Description is required"); return; }

    setSubmitting(true);
    try {
      const payload = {
        business: currentCompany._id,
        unit: form.unit,
        tenant: form.tenant || undefined,
        title: form.title.trim(),
        description: form.description.trim(),
        priority: form.priority,
        status: form.status,
        assignedTo: form.assignedTo.trim(),
        scheduledDate: form.scheduledDate || undefined,
        estimatedCost: form.estimatedCost === "" ? 0 : Number(form.estimatedCost),
        actualCost: form.actualCost === "" ? 0 : Number(form.actualCost),
        completedDate: form.completedDate || undefined,
      };
      if (editingRequest?._id) {
        await adminRequests.put(`/maintenances/${editingRequest._id}`, payload);
        toast.success("Maintenance request updated");
      } else {
        await adminRequests.post("/maintenances", payload);
        toast.success("Maintenance request created");
      }
      await loadRequests();
      closeModal();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save maintenance request");
    } finally {
      setSubmitting(false);
    }
  };

  const quickUpdateStatus = async (item, newStatus) => {
    if (isDemoUser) { toast.info("Demo mode is read-only."); return; }
    if (!canUpdate) { toast.warning("You do not have permission to update maintenance requests."); return; }
    setUpdatingId(`${item._id}:${newStatus}`);
    try {
      await adminRequests.put(`/maintenances/${item._id}`, {
        business: currentCompany._id,
        status: newStatus,
        ...(newStatus === "completed" ? { completedDate: new Date().toISOString().slice(0, 10) } : {}),
      });
      toast.success(`Marked as ${newStatus.replace("_", " ")}`);
      await loadRequests();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update status");
    } finally {
      setUpdatingId("");
    }
  };

  const handleDelete = async (item) => {
    if (isDemoUser) { toast.info("Demo mode is read-only."); return; }
    if (!canDelete) { toast.warning("You do not have permission to delete maintenance requests."); return; }
    if (!await confirm({ title: "Delete Maintenance Request", message: `Delete "${item?.title || "this request"}"?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      await adminRequests.delete(`/maintenances/${item._id}`);
      toast.success("Deleted");
      await loadRequests();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete");
    }
  };

  const exportCsv = () => {
    const rows = filteredRequests.map((item) => [
      item?.title || "", getRequestPropertyName(item), item?.unit?.unitNumber || "",
      item?.tenant?.name || "", item?.priority || "", item?.status || "",
      item?.assignedTo || "", item?.scheduledDate ? formatDate(item.scheduledDate) : "",
      item?.estimatedCost || 0, item?.actualCost || 0, item?.description || "",
    ]);
    const csv = [["Title", "Property", "Unit", "Tenant", "Priority", "Status", "Assigned To", "Scheduled Date", "Estimated Cost", "Actual Cost", "Description"], ...rows]
      .map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `maintenance_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden bg-slate-50">

        {/* Summary chips */}
        <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          {SUMMARY_CHIPS.map(({ key, label, count, dot, text, bg, border, filterType }) => {
            const active = filterType === "status" ? statusFilter === key : priorityFilter === key;
            const toggle = () => filterType === "status" ? setStatusFilter(active ? "all" : key) : setPriorityFilter(active ? "all" : key);
            return (
              <button key={key} type="button" onClick={toggle}
                className={`inline-flex items-center gap-2 border px-3 py-1.5 transition-all ${bg} ${border} ${active ? "ring-2 ring-offset-1 ring-[#0B3B2E]" : "hover:opacity-80"}`}>
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</span>
                <span className={`text-sm font-black ${text}`}>{count}</span>
                {active && <FaTimes size={8} className="ml-1 text-slate-500" />}
              </button>
            );
          })}
          <div className="inline-flex items-center gap-2 border border-slate-200 bg-white px-3 py-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Total</span>
            <span className="text-sm font-black text-slate-700">{stats.total}</span>
          </div>
        </div>

        {/* Filter bar */}
        <div className="shrink-0 flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-2">
          <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search requests…" className="h-7 w-48 shrink-0 border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:border-[#0B3B2E]" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 appearance-none outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20">
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 appearance-none outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20">
            {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={() => { setSearchTerm(""); setStatusFilter("all"); setPriorityFilter("all"); }} className="inline-flex h-7 items-center gap-1 border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><FaFilter size={9} /> Reset</button>
          <button onClick={loadRequests} className="inline-flex h-7 items-center gap-1 border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50"><FaRedoAlt size={9} /></button>
          <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
          <button onClick={exportCsv} className="inline-flex h-7 items-center gap-1 border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><FaDownload size={9} /> CSV</button>
          {canCreate && !isDemoUser && (
            <button onClick={openCreateModal} className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-2 text-xs font-black text-white hover:bg-[#0A3127]"><FaPlus size={9} /> New Request</button>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[900px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="bg-[#0B3B2E] text-white">
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Request</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Location</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Assigned To</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Costs</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Dates</th>
                    <th className="px-3 py-1 border-r border-gray-100 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">Loading maintenance requests…</td></tr>
                  ) : requests.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <div className="mx-auto flex w-fit flex-col items-center gap-2 text-slate-400">
                          <FaTools className="text-3xl opacity-30" />
                          <p className="text-sm font-semibold">No maintenance requests found</p>
                          <p className="text-xs">Try adjusting your filters or create a new request.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((item, idx) => {
                      const isEmergency = item?.priority === "emergency";
                      const rowBg = isEmergency
                        ? "bg-rose-50/60"
                        : idx % 2 === 0 ? "bg-white" : "bg-slate-50/50";
                      const busy = updatingId.startsWith(item._id);

                      return (
                        <tr key={item._id} className={`border-b border-gray-100 ${rowBg} hover:bg-blue-50/40 align-top`}>
                          <td className="px-3 py-1 border-r border-gray-100 max-w-[240px]">
                            <div className="flex items-start gap-2">
                              <div className={`mt-0.5 flex-shrink-0 rounded-lg p-2 text-xs ${isEmergency ? "bg-rose-100 text-rose-600" : "bg-slate-100 text-slate-500"}`}>
                                {isEmergency ? <FaExclamationTriangle /> : <FaTools />}
                              </div>
                              <div className="min-w-0">
                                <p className="font-black text-slate-900 truncate">{item?.title || "Untitled"}</p>
                                <p className="mt-0.5 text-[10px] leading-4 text-slate-500 line-clamp-2">{item?.description || "—"}</p>
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE[item?.status] || STATUS_BADGE.pending}`}>
                                    {String(item?.status || "pending").replace(/_/g, " ")}
                                  </span>
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PRIORITY_BADGE[item?.priority] || PRIORITY_BADGE.medium}`}>
                                    {item?.priority || "medium"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <p className="font-semibold text-slate-900">{getRequestPropertyName(item) || "—"}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Unit {item?.unit?.unitNumber || "—"}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{item?.tenant?.name || "No tenant"}</p>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <p className="font-semibold text-slate-900">{item?.assignedTo || <span className="text-slate-400 italic">Unassigned</span>}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Created {formatDate(item?.createdAt)}</p>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <p className="font-semibold text-slate-900">Est {money(item?.estimatedCost)}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Actual {money(item?.actualCost)}</p>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <p className="font-semibold text-slate-900">Sched. {formatDate(item?.scheduledDate)}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Done {formatDate(item?.completedDate)}</p>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right">
                            <div className="inline-flex flex-wrap justify-end gap-1.5">
                              {canUpdate && !isDemoUser && item?.status === "pending" && (
                                <button
                                  onClick={() => quickUpdateStatus(item, "in_progress")}
                                  disabled={busy}
                                  className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                                >
                                  Start
                                </button>
                              )}
                              {canUpdate && !isDemoUser && (item?.status === "pending" || item?.status === "in_progress") && (
                                <button
                                  onClick={() => quickUpdateStatus(item, "completed")}
                                  disabled={busy}
                                  className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                >
                                  Complete
                                </button>
                              )}
                              {canUpdate && !isDemoUser && (
                                <button
                                  onClick={() => openEditModal(item)}
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-black text-slate-700 hover:bg-slate-50"
                                >
                                  <FaEdit />
                                </button>
                              )}
                              {canDelete && !isDemoUser && (
                                <button
                                  onClick={() => handleDelete(item)}
                                  className="rounded border border-rose-300 bg-white px-2 py-1 text-[10px] font-black text-rose-600 hover:bg-rose-50"
                                >
                                  <FaTrash />
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

            {/* Pagination */}
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
              <div className="font-semibold">
                Showing <span className="font-bold text-slate-900">{serverTotal === 0 ? 0 : (safePage - 1) * pageSize + 1}</span> to <span className="font-bold text-slate-900">{Math.min(safePage * pageSize, serverTotal)}</span> of <span className="font-bold text-slate-900">{serverTotal}</span> request(s)
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-500">Per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                    className="h-7 rounded border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 focus:border-[#0B3B2E] focus:outline-none transition"
                  >
                    {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                <span className="font-semibold text-slate-700">Page {safePage} of {totalPages}</span>
                <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
              </div>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-black uppercase tracking-wide">{editingRequest?._id ? "Edit Request" : "New Maintenance Request"}</h2>
              <button onClick={closeModal} className="text-white/70 transition-colors hover:text-white"><FaTimes /></button>
            </div>

            <form onSubmit={handleSave} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Property</span>
                  <AppSelect
                    value={selectedPropertyId}
                    onChange={(v) => setForm((prev) => ({ ...prev, unit: "", tenant: "", property: v ?? "" }))}
                    options={properties.map((p) => ({ value: p._id, label: getPropertyName(p) }))}
                    placeholder="Select property…"
                    searchable
                    size="sm"
                  />
                </div>
                <div>
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Unit <span className="text-red-500">*</span></span>
                  <AppSelect
                    value={form.unit}
                    onChange={(v) => setForm((prev) => ({ ...prev, unit: v ?? "", tenant: "" }))}
                    options={availableUnits.map((u) => ({ value: u._id, label: `${getPropertyName(u?.property)} · Unit ${u?.unitNumber || "—"}` }))}
                    placeholder="Select unit…"
                    searchable
                    size="sm"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tenant</span>
                  <AppSelect
                    value={form.tenant}
                    onChange={(v) => setForm((prev) => ({ ...prev, tenant: v ?? "" }))}
                    options={availableTenants.map((t) => ({ value: t._id, label: t?.name || "Unnamed" }))}
                    placeholder="No linked tenant"
                    searchable
                    clearable
                    size="sm"
                  />
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Assigned to</span>
                  <input
                    value={form.assignedTo}
                    onChange={(e) => setForm((prev) => ({ ...prev, assignedTo: e.target.value }))}
                    placeholder="Technician or service provider"
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Issue title <span className="text-red-500">*</span></span>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="e.g. Water leak in kitchen"
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Priority</span>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  >
                    {PRIORITY_OPTIONS.filter((o) => o.value !== "all").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Status</span>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  >
                    {STATUS_OPTIONS.filter((o) => o.value !== "all").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Description <span className="text-red-500">*</span></span>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Describe the issue clearly so a technician can act on it."
                  className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                {[
                  { label: "Scheduled date", key: "scheduledDate", type: "date" },
                  { label: "Completed date", key: "completedDate", type: "date" },
                  { label: "Estimated cost", key: "estimatedCost", type: "number" },
                  { label: "Actual cost", key: "actualCost", type: "number" },
                ].map(({ label, key, type }) => (
                  <label key={key} className="block">
                    <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</span>
                    <input
                      type={type}
                      min={type === "number" ? "0" : undefined}
                      value={form[key]}
                      onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                      className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                    />
                  </label>
                ))}
              </div>

              </div>
              <div className="flex-shrink-0 flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
                <button type="button" onClick={closeModal} className="border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                  {submitting ? "Saving…" : editingRequest?._id ? "Save Changes" : "Create Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default Maintenances;

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import { useDispatch, useSelector } from "react-redux";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import { getProperties } from "../../redux/propertyRedux";
import { getUnits, getTenants } from "../../redux/apiCalls";
import {
  FaCalendarAlt,
  FaCheckCircle,
  FaClipboardCheck,
  FaDownload,
  FaEdit,
  FaExclamationTriangle,
  FaFilter,
  FaPlus,
  FaRedoAlt,
  FaSearch,
  FaTimes,
  FaTrash,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import { adminRequests } from "../../utils/requestMethods";
import { hasCompanyPermission } from "../../utils/permissions";
import { buildTenantOptions } from "../../utils/tenantUtils";
import { useConfirm } from "../../context/ConfirmContext";

const DEFAULT_PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const TYPE_OPTIONS = [
  { value: "routine", label: "Routine" },
  { value: "move_in", label: "Move In" },
  { value: "move_out", label: "Move Out" },
  { value: "safety", label: "Safety" },
  { value: "emergency", label: "Emergency" },
  { value: "custom", label: "Custom" },
];

const EMPTY_FORM = {
  property: "",
  unit: "",
  tenant: "",
  type: "routine",
  status: "scheduled",
  inspectorName: "",
  scheduledDate: "",
  completedDate: "",
  nextInspectionDate: "",
  score: "",
  issuesFound: "0",
  photosCount: "0",
  tenantPresent: false,
  recommendations: "",
  notes: "",
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

const formatDate = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const toInputDate = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
};

const getPropertyName = (property) =>
  property?.propertyName || property?.name || property?.title || "Unnamed";

const getUnitPropertyId = (unit) => String(unit?.property?._id || unit?.property || "");
const getInspectionPropertyName = (item) => getPropertyName(item?.property || item?.unit?.property);

const formatTypeLabel = (type) =>
  String(type || "routine").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const STATUS_BADGE = {
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
  scheduled: "bg-amber-50 text-amber-700 border-amber-200",
};

const TYPE_BADGE = {
  move_in: "bg-sky-50 text-sky-700 border-sky-200",
  move_out: "bg-violet-50 text-violet-700 border-violet-200",
  safety: "bg-amber-50 text-amber-700 border-amber-200",
  emergency: "bg-rose-100 text-rose-700 border-rose-300",
  custom: "bg-slate-100 text-slate-600 border-slate-200",
  routine: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const scoreColor = (score) => {
  if (!Number.isFinite(Number(score))) return "bg-slate-100 text-slate-600 border-slate-200";
  if (Number(score) >= 90) return "bg-emerald-100 text-emerald-700 border-emerald-300";
  if (Number(score) >= 70) return "bg-amber-100 text-amber-700 border-amber-300";
  return "bg-rose-100 text-rose-700 border-rose-300";
};

const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const Inspections = () => {
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);

  const reduxProperties = useSelector((s) => s.property?.properties || []);
  const reduxUnits = useSelector((s) => s.unit?.units || []);
  const reduxTenants = useSelector((s) => s.tenant?.tenants || []);
  const canCreate = hasCompanyPermission(currentUser, currentCompany, "inspections", "create", "propertyManagement");
  const canUpdate = hasCompanyPermission(currentUser, currentCompany, "inspections", "update", "propertyManagement");
  const canDelete = hasCompanyPermission(currentUser, currentCompany, "inspections", "delete", "propertyManagement");

  const [inspections, setInspections] = useState([]);
  const [properties, setProperties] = useState([]);
  const [units, setUnits] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useTabState("/inspections:searchTerm", "");
  const [statusFilter, setStatusFilter] = useTabState("/inspections:statusFilter", "");
  const [typeFilter, setTypeFilter] = useTabState("/inspections:typeFilter", "");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInspection, setEditingInspection] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pageSize, setPageSize] = useTabState("/inspections:pageSize", DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useTabState("/inspections:currentPage", 1);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverPages, setServerPages] = useState(1);

  const debouncedSearch = useDebounce(searchTerm, 400);

  // Draft persistence — survives tab switches for new-record modal only
  const _iDraftKey = (currentCompany?._id && (currentUser?._id || currentUser?.id))
    ? `milik:draft:insp-modal:${currentCompany._id}:${currentUser?._id || currentUser?.id || "u"}`
    : null;
  const _iDraftRestored = useRef(false);

  useEffect(() => {
    if (!_iDraftKey || _iDraftRestored.current) return;
    _iDraftRestored.current = true;
    try {
      const raw = window.sessionStorage.getItem(_iDraftKey);
      if (raw) {
        const { form: saved } = JSON.parse(raw);
        if (saved) { setForm(saved); setIsModalOpen(true); }
      }
    } catch {}
  }, [_iDraftKey]);

  useEffect(() => {
    if (!_iDraftKey || !_iDraftRestored.current || !isModalOpen || editingInspection) return;
    try { window.sessionStorage.setItem(_iDraftKey, JSON.stringify({ form })); } catch {}
  }, [_iDraftKey, form, isModalOpen, editingInspection]);

  const loadInspections = useCallback(async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business: currentCompany._id,
        page: currentPage,
        limit: pageSize,
      });
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter) params.set("type", typeFilter);
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());

      const res = await adminRequests.get(`/inspections?${params}`);
      setInspections(toList(res.data?.data ?? res.data));
      setServerTotal(res.data?.total ?? 0);
      setServerPages(res.data?.pages ?? 1);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load inspections");
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id, currentPage, pageSize, statusFilter, typeFilter, debouncedSearch]);

  // Sync Redux data into local state so existing JSX references work unchanged
  useEffect(() => { if (reduxProperties.length) setProperties(reduxProperties); }, [reduxProperties]);
  useEffect(() => { if (reduxUnits.length) setUnits(reduxUnits); }, [reduxUnits]);
  useEffect(() => { if (reduxTenants.length) setTenants(reduxTenants); }, [reduxTenants]);

  // Trigger Redux loads for shared form-dropdown data
  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getProperties({ business: currentCompany._id }));
    getUnits(dispatch, currentCompany._id);
    getTenants(dispatch, currentCompany._id);
  }, [currentCompany?._id, dispatch]);

  useEffect(() => { loadInspections(); }, [loadInspections]);
  useEffect(() => { setCurrentPage(1); }, [statusFilter, typeFilter, debouncedSearch, pageSize]);

  const selectedPropertyId = useMemo(() => {
    const unitMatch = units.find((u) => String(u?._id) === String(form.unit));
    return String(unitMatch?.property?._id || unitMatch?.property || form.property || "");
  }, [form.property, form.unit, units]);

  const availableUnits = useMemo(() => {
    if (!selectedPropertyId) return units;
    return units.filter((u) => getUnitPropertyId(u) === selectedPropertyId);
  }, [selectedPropertyId, units]);

  const availableTenants = useMemo(() => {
    if (!form.unit) return [];
    return tenants.filter((t) => String(t?.unit?._id || t?.unit || "") === String(form.unit));
  }, [form.unit, tenants]);

  useEffect(() => {
    if (!form.unit && form.tenant) { setForm((prev) => ({ ...prev, tenant: "" })); return; }
    if (form.unit && !availableTenants.some((t) => String(t?._id) === String(form.tenant))) {
      setForm((prev) => ({ ...prev, tenant: "" }));
    }
  }, [availableTenants, form.tenant, form.unit]);

  // Server handles filtering; client-side pass-through only
  const filteredInspections = inspections;

  const stats = useMemo(() => {
    let scheduled = 0, inProgress = 0, completed = 0, cancelled = 0, totalIssues = 0, scoreSum = 0, scoreCount = 0;
    inspections.forEach(i => {
      if (i?.status === "scheduled") scheduled++;
      if (i?.status === "in_progress") inProgress++;
      if (i?.status === "completed") completed++;
      if (i?.status === "cancelled") cancelled++;
      totalIssues += Number(i?.issuesFound || 0);
      const s = Number(i?.score);
      if (Number.isFinite(s)) { scoreSum += s; scoreCount++; }
    });
    return { total: serverTotal, scheduled, inProgress, completed, cancelled, totalIssues, avgScore: scoreCount > 0 ? (scoreSum / scoreCount).toFixed(1) : "—" };
  }, [inspections, serverTotal]);

  const SUMMARY_CHIPS = useMemo(() => [
    { key: "scheduled",   label: "Scheduled",   count: stats.scheduled,  dot: "bg-amber-400",   text: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200",   filterType: "status" },
    { key: "in_progress", label: "In Progress", count: stats.inProgress, dot: "bg-blue-400",    text: "text-blue-700",    bg: "bg-blue-50",    border: "border-blue-200",    filterType: "status" },
    { key: "completed",   label: "Completed",   count: stats.completed,  dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", filterType: "status" },
    { key: "cancelled",   label: "Cancelled",   count: stats.cancelled,  dot: "bg-slate-400",   text: "text-slate-600",   bg: "bg-slate-50",   border: "border-slate-200",   filterType: "status" },
  ], [stats]);

  const totalPages = Math.max(1, serverPages);
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = inspections; // server returns the correct slice already

  const openCreateModal = () => {
    if (!canCreate) { toast.warning("You do not have permission to create inspections."); return; }
    setEditingInspection(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (item) => {
    if (!canUpdate) { toast.warning("You do not have permission to edit inspections."); return; }
    if (_iDraftKey) { try { window.sessionStorage.removeItem(_iDraftKey); } catch {} }
    setEditingInspection(item);
    setForm({
      property: String(item?.property?._id || item?.property || item?.unit?.property?._id || item?.unit?.property || ""),
      unit: String(item?.unit?._id || item?.unit || ""),
      tenant: String(item?.tenant?._id || item?.tenant || ""),
      type: item?.type || "routine",
      status: item?.status || "scheduled",
      inspectorName: item?.inspectorName || "",
      scheduledDate: toInputDate(item?.scheduledDate),
      completedDate: toInputDate(item?.completedDate),
      nextInspectionDate: toInputDate(item?.nextInspectionDate),
      score: Number.isFinite(Number(item?.score)) ? String(item.score) : "",
      issuesFound: String(Number(item?.issuesFound) || 0),
      photosCount: String(Number(item?.photosCount) || 0),
      tenantPresent: Boolean(item?.tenantPresent),
      recommendations: item?.recommendations || "",
      notes: item?.notes || "",
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    if (_iDraftKey) { try { window.sessionStorage.removeItem(_iDraftKey); } catch {} }
    setIsModalOpen(false);
    setEditingInspection(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!currentCompany?._id) { toast.error("Select a company first"); return; }
    if (!selectedPropertyId) { toast.error("Property is required"); return; }
    if (!form.inspectorName.trim()) { toast.error("Inspector name is required"); return; }
    if (!form.scheduledDate) { toast.error("Scheduled date is required"); return; }

    setSubmitting(true);
    try {
      const payload = {
        business: currentCompany._id,
        property: selectedPropertyId,
        unit: form.unit || undefined,
        tenant: form.tenant || undefined,
        type: form.type,
        status: form.status,
        inspectorName: form.inspectorName.trim(),
        scheduledDate: form.scheduledDate,
        completedDate: form.completedDate || undefined,
        nextInspectionDate: form.nextInspectionDate || undefined,
        score: form.score === "" ? undefined : Number(form.score),
        issuesFound: form.issuesFound === "" ? 0 : Number(form.issuesFound),
        photosCount: form.photosCount === "" ? 0 : Number(form.photosCount),
        tenantPresent: Boolean(form.tenantPresent),
        recommendations: form.recommendations.trim(),
        notes: form.notes.trim(),
      };
      if (editingInspection?._id) {
        await adminRequests.put(`/inspections/${editingInspection._id}`, payload);
        toast.success("Inspection updated");
      } else {
        await adminRequests.post("/inspections", payload);
        toast.success("Inspection created");
      }
      await loadInspections();
      closeModal();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save inspection");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item) => {
    if (!canDelete) { toast.warning("You do not have permission to delete inspections."); return; }
    if (!await confirm({ title: "Delete Inspection", message: `Delete inspection "${item?.inspectionNumber || "this inspection"}"?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      await adminRequests.delete(`/inspections/${item._id}`);
      toast.success("Inspection deleted");
      await loadInspections();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete");
    }
  };

  const exportCsv = () => {
    const rows = filteredInspections.map((item) => [
      item?.inspectionNumber || "", formatTypeLabel(item?.type), item?.status || "",
      getInspectionPropertyName(item), item?.unit?.unitNumber || "", item?.tenant?.name || "",
      item?.inspectorName || "", item?.scheduledDate ? formatDate(item.scheduledDate) : "",
      item?.completedDate ? formatDate(item.completedDate) : "",
      Number.isFinite(Number(item?.score)) ? Number(item.score) : "",
      Number(item?.issuesFound || 0), item?.recommendations || "", item?.notes || "",
    ]);
    const csv = [["Inspection #", "Type", "Status", "Property", "Unit", "Tenant", "Inspector", "Scheduled", "Completed", "Score", "Issues", "Recommendations", "Notes"], ...rows]
      .map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `inspections_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden bg-slate-50">

        {/* Summary chips */}
        <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          {SUMMARY_CHIPS.map(({ key, label, count, dot, text, bg, border }) => {
            const active = statusFilter === key;
            return (
              <button key={key} type="button" onClick={() => setStatusFilter(active ? "all" : key)}
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
          <div className="inline-flex items-center gap-2 border border-blue-100 bg-blue-50 px-3 py-1.5">
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Avg Score</span>
            <span className="text-sm font-black text-blue-700">{stats.avgScore}</span>
          </div>
          <div className="inline-flex items-center gap-2 border border-rose-100 bg-rose-50 px-3 py-1.5">
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Issues</span>
            <span className="text-sm font-black text-rose-700">{stats.totalIssues}</span>
          </div>
        </div>

        {/* Filter bar */}
        <div className="shrink-0 flex items-center gap-0.5 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1">
          <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search inspections…" className="h-[20px] w-40 shrink-0 border border-slate-200 bg-white px-1.5 text-[9px] focus:outline-none focus:border-[#0B3B2E]" />
          <AppSelect value={statusFilter} onChange={(v) => setStatusFilter(v ?? "")} options={STATUS_OPTIONS} placeholder="All statuses" clearable compact />
          <AppSelect value={typeFilter} onChange={(v) => setTypeFilter(v ?? "")} options={TYPE_OPTIONS} placeholder="All types" clearable compact />
          <button onClick={() => { setSearchTerm(""); setStatusFilter(""); setTypeFilter(""); }} className="inline-flex h-[20px] items-center gap-0.5 border border-slate-200 bg-white px-1.5 text-[9px] font-semibold text-slate-600 hover:bg-slate-50"><FaFilter size={7} /> Reset</button>
          <button onClick={loadInspections} className="inline-flex h-[20px] items-center gap-0.5 border border-slate-200 bg-white px-1.5 text-[9px] text-slate-600 hover:bg-slate-50"><FaRedoAlt size={7} /> Refresh</button>
          <div className="mx-1 h-3 w-px shrink-0 bg-slate-200" />
          <button onClick={exportCsv} className="inline-flex h-[20px] items-center gap-0.5 border border-slate-200 bg-white px-1.5 text-[9px] font-semibold text-slate-700 hover:bg-slate-50"><FaDownload size={7} /> CSV</button>
          {canCreate && (
            <button onClick={openCreateModal} className="inline-flex h-[20px] items-center gap-0.5 bg-[#0B3B2E] px-1.5 text-[9px] font-black text-white hover:bg-[#0A3127]"><FaPlus size={7} /> Schedule Inspection</button>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[960px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="bg-[#0B3B2E] text-white">
                    {["Inspection", "Location", "Schedule", "Score & Findings", "Next Inspection", "Actions"].map((h, i) => (
                      <th key={h} className={`px-3 py-1 font-bold ${i === 5 ? "text-right" : "text-left border-r border-white/10"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">Loading inspections…</td></tr>
                  ) : inspections.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <div className="mx-auto flex w-fit flex-col items-center gap-2 text-slate-400">
                          <FaClipboardCheck className="text-3xl opacity-30" />
                          <p className="text-sm font-semibold">No inspections found</p>
                          <p className="text-xs">Try adjusting filters or schedule a new inspection.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((item, idx) => {
                      const isEmergency = item?.type === "emergency";
                      const rowBg = isEmergency
                        ? "bg-rose-50/60"
                        : idx % 2 === 0 ? "bg-white" : "bg-slate-50/50";
                      const scoreNum = Number.isFinite(Number(item?.score)) ? Number(item.score) : null;

                      return (
                        <tr key={item._id} className={`border-b border-gray-100 ${rowBg} hover:bg-blue-50/40 align-top`}>
                          <td className="px-3 py-1 border-r border-gray-100 max-w-[220px]">
                            <div className="flex items-start gap-2">
                              <div className={`mt-0.5 flex-shrink-0 rounded-lg p-2 text-xs ${item?.status === "completed" ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                                {item?.status === "completed" ? <FaCheckCircle /> : <FaClipboardCheck />}
                              </div>
                              <div className="min-w-0">
                                <p className="font-black text-slate-900 truncate">{item?.inspectionNumber || "—"}</p>
                                <p className="text-[10px] text-slate-500 mt-0.5 truncate">Inspector: {item?.inspectorName || "—"}</p>
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE[item?.status] || STATUS_BADGE.scheduled}`}>
                                    {String(item?.status || "scheduled").replace(/_/g, " ")}
                                  </span>
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TYPE_BADGE[item?.type] || TYPE_BADGE.routine}`}>
                                    {formatTypeLabel(item?.type)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <p className="font-semibold text-slate-900">{getInspectionPropertyName(item) || "—"}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Unit {item?.unit?.unitNumber || "Common / Property"}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{item?.tenant?.name || "No tenant"}</p>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <p className="font-semibold text-slate-900">{formatDate(item?.scheduledDate)}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Completed {formatDate(item?.completedDate)}</p>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <div className="flex items-center gap-2">
                              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${scoreColor(item?.score)}`}>
                                {scoreNum !== null ? `${scoreNum}/100` : "N/A"}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-1.5">{Number(item?.issuesFound || 0)} issue(s) · {Number(item?.photosCount || 0)} photo(s)</p>
                            {item?.recommendations && (
                              <p className="text-[10px] text-slate-400 mt-1 line-clamp-2 leading-4">{item.recommendations}</p>
                            )}
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100">
                            <p className="font-semibold text-slate-900">{formatDate(item?.nextInspectionDate)}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Tenant present: {item?.tenantPresent ? "Yes" : "No"}</p>
                          </td>
                          <td className="px-3 py-1 border-r border-gray-100 text-right">
                            <div className="inline-flex flex-wrap justify-end gap-1.5">
                              {canUpdate && (
                                <button
                                  onClick={() => openEditModal(item)}
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-black text-slate-700 hover:bg-slate-50"
                                >
                                  <FaEdit />
                                </button>
                              )}
                              {canDelete && (
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
                Showing <span className="font-bold text-slate-900">{serverTotal === 0 ? 0 : (safePage - 1) * pageSize + 1}</span> to <span className="font-bold text-slate-900">{Math.min(safePage * pageSize, serverTotal)}</span> of <span className="font-bold text-slate-900">{serverTotal}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-500">Per page:</span>
                  <AppSelect value={pageSize} onChange={(v) => { setPageSize(Number(v ?? DEFAULT_PAGE_SIZE)); setCurrentPage(1); }} options={[25, 50, 100, 200].map((n) => ({ value: n, label: String(n) }))} size="sm" />
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
          <div className="w-full max-w-4xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-black uppercase tracking-wide">{editingInspection?._id ? "Edit Inspection" : "Schedule Inspection"}</h2>
              <button onClick={closeModal} className="text-white/70 transition-colors hover:text-white"><FaTimes /></button>
            </div>

            <form onSubmit={handleSave} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Property <span className="text-red-500">*</span></span>
                  <AppSelect
                    value={selectedPropertyId}
                    onChange={(v) => setForm((prev) => ({ ...prev, property: v ?? "", unit: "", tenant: "" }))}
                    options={properties.map((p) => ({ value: p._id, label: getPropertyName(p) }))}
                    placeholder="Select property…"
                    searchable
                    size="md"
                  />
                </div>
                <div>
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Unit</span>
                  <AppSelect
                    value={form.unit}
                    onChange={(v) => setForm((prev) => ({ ...prev, unit: v ?? "", tenant: "" }))}
                    options={availableUnits.map((u) => ({ value: u._id, label: `${getPropertyName(u?.property)} · Unit ${u?.unitNumber || "—"}` }))}
                    placeholder="Property-level / common area"
                    searchable
                    clearable
                    size="md"
                  />
                </div>
                <div>
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tenant</span>
                  <AppSelect
                    value={form.tenant}
                    onChange={(v) => setForm((prev) => ({ ...prev, tenant: v ?? "" }))}
                    options={buildTenantOptions(availableTenants)}
                    placeholder="No linked tenant"
                    searchable
                    clearable
                    disabled={!form.unit}
                    size="md"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <AppSelect
                  label="Type"
                  value={form.type}
                  onChange={(v) => setForm((prev) => ({ ...prev, type: v ?? "" }))}
                  options={TYPE_OPTIONS}
                  size="md"
                />
                <AppSelect
                  label="Status"
                  value={form.status}
                  onChange={(v) => setForm((prev) => ({ ...prev, status: v ?? "" }))}
                  options={STATUS_OPTIONS}
                  size="md"
                />
                <label className="block md:col-span-2">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Inspector name <span className="text-red-500">*</span></span>
                  <input
                    value={form.inspectorName}
                    onChange={(e) => setForm((prev) => ({ ...prev, inspectorName: e.target.value }))}
                    placeholder="Inspector, staff or service provider"
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Scheduled <span className="text-red-500">*</span></span>
                  <input type="date" value={form.scheduledDate} onChange={(e) => setForm((prev) => ({ ...prev, scheduledDate: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Completed</span>
                  <input type="date" value={form.completedDate} onChange={(e) => setForm((prev) => ({ ...prev, completedDate: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Next inspection</span>
                  <input type="date" value={form.nextInspectionDate} onChange={(e) => setForm((prev) => ({ ...prev, nextInspectionDate: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </label>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 md:mt-6">
                  <input
                    type="checkbox"
                    checked={form.tenantPresent}
                    onChange={(e) => setForm((prev) => ({ ...prev, tenantPresent: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
                  />
                  Tenant present
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Score (0–100)</span>
                  <input type="number" min="0" max="100" value={form.score} onChange={(e) => setForm((prev) => ({ ...prev, score: e.target.value }))} placeholder="e.g. 92" className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Issues found</span>
                  <input type="number" min="0" value={form.issuesFound} onChange={(e) => setForm((prev) => ({ ...prev, issuesFound: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Photos count</span>
                  <input type="number" min="0" value={form.photosCount} onChange={(e) => setForm((prev) => ({ ...prev, photosCount: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Recommendations</span>
                <textarea rows={2} value={form.recommendations} onChange={(e) => setForm((prev) => ({ ...prev, recommendations: e.target.value }))} placeholder="Recommended repairs, deductions, compliance actions…" className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Notes</span>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Observations for the property manager or next inspection cycle." className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
              </label>

              </div>
              <div className="flex-shrink-0 flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
                <button type="button" onClick={closeModal} className="border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                  {submitting ? "Saving…" : editingInspection?._id ? "Save Changes" : "Create Inspection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default Inspections;

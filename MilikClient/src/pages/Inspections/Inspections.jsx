import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
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
import { adminRequests } from "../../utils/requestMethods";
import { hasCompanyPermission } from "../../utils/permissions";
import { useConfirm } from "../../context/ConfirmContext";

const ITEMS_PER_PAGE = 25;

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const TYPE_OPTIONS = [
  { value: "all", label: "All types" },
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
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const isDemoUser = Boolean(currentUser?.isDemoUser);
  const canCreate = hasCompanyPermission(currentUser, currentCompany, "inspections", "create", "propertyManagement");
  const canUpdate = hasCompanyPermission(currentUser, currentCompany, "inspections", "update", "propertyManagement");
  const canDelete = hasCompanyPermission(currentUser, currentCompany, "inspections", "delete", "propertyManagement");

  const [inspections, setInspections] = useState([]);
  const [properties, setProperties] = useState([]);
  const [units, setUnits] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInspection, setEditingInspection] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [currentPage, setCurrentPage] = useState(1);

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

  const loadData = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const business = currentCompany._id;
      const [inspRes, unitsRes, tenantsRes, propsRes] = await Promise.all([
        adminRequests.get(`/inspections?business=${business}`),
        adminRequests.get(`/units?business=${business}&limit=1000`),
        adminRequests.get(`/tenants?business=${business}&limit=1000`),
        adminRequests.get(`/properties?business=${business}&limit=1000`),
      ]);
      setInspections(toList(inspRes.data));
      setUnits(toList(unitsRes.data));
      setTenants(toList(tenantsRes.data));
      setProperties(toList(propsRes.data));
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load inspection data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [currentCompany?._id]);

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

  const filteredInspections = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return inspections.filter((item) => {
      if (statusFilter !== "all" && item?.status !== statusFilter) return false;
      if (typeFilter !== "all" && item?.type !== typeFilter) return false;
      if (query) {
        const haystack = [item?.inspectionNumber, item?.inspectorName, item?.tenant?.name, item?.unit?.unitNumber, getInspectionPropertyName(item), item?.notes, item?.recommendations]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [inspections, searchTerm, statusFilter, typeFilter]);

  const stats = useMemo(() => {
    const total = inspections.length;
    const scheduled = inspections.filter((i) => i?.status === "scheduled").length;
    const completed = inspections.filter((i) => i?.status === "completed").length;
    const withScores = inspections.filter((i) => Number.isFinite(Number(i?.score)));
    const avgScore = withScores.length > 0
      ? (withScores.reduce((s, i) => s + Number(i.score), 0) / withScores.length).toFixed(1)
      : "—";
    const totalIssues = inspections.reduce((s, i) => s + Number(i?.issuesFound || 0), 0);
    return { total, scheduled, completed, avgScore, totalIssues };
  }, [inspections]);

  const totalPages = Math.max(1, Math.ceil(filteredInspections.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = filteredInspections.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, statusFilter, typeFilter]);

  const openCreateModal = () => {
    if (isDemoUser) { toast.info("Demo mode is read-only."); return; }
    if (!canCreate) { toast.warning("You do not have permission to create inspections."); return; }
    setEditingInspection(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (item) => {
    if (isDemoUser) { toast.info("Demo mode is read-only."); return; }
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
      await loadData();
      closeModal();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save inspection");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item) => {
    if (isDemoUser) { toast.info("Demo mode is read-only."); return; }
    if (!canDelete) { toast.warning("You do not have permission to delete inspections."); return; }
    if (!await confirm({ title: "Delete Inspection", message: `Delete inspection "${item?.inspectionNumber || "this inspection"}"?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      await adminRequests.delete(`/inspections/${item._id}`);
      toast.success("Inspection deleted");
      await loadData();
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
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="mx-auto flex h-full w-full max-w-full min-h-0 flex-1 flex-col gap-2">

          {/* KPI Strip */}
          <div className="grid flex-shrink-0 grid-cols-2 gap-2 md:grid-cols-5">
            {[
              { label: "Total", value: stats.total, cls: "bg-slate-900 text-white", icon: <FaClipboardCheck /> },
              { label: "Scheduled", value: stats.scheduled, cls: "bg-amber-50 text-amber-800 border border-amber-200", icon: <FaCalendarAlt /> },
              { label: "Completed", value: stats.completed, cls: "bg-emerald-50 text-emerald-800 border border-emerald-200", icon: <FaCheckCircle /> },
              { label: "Avg Score", value: stats.avgScore, cls: "bg-blue-50 text-blue-800 border border-blue-200", icon: <FaClipboardCheck /> },
              { label: "Total Issues", value: stats.totalIssues, cls: "bg-rose-50 text-rose-800 border border-rose-200", icon: <FaExclamationTriangle /> },
            ].map((card) => (
              <div key={card.label} className={`flex items-center gap-2 rounded-lg px-3 py-2 shadow-sm ${card.cls}`}>
                <span className="text-base opacity-35">{card.icon}</span>
                <div className="flex flex-1 items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-75">{card.label}</span>
                  <span className="text-sm font-black">{card.value}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Main card */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

            {/* Toolbar */}
            <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/95 px-3 py-2 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-1 text-sm font-black text-slate-800">Inspections</p>
                <div className="relative flex-1 min-w-[200px]">
                  <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search no., property, inspector, tenant…"
                    className="h-8 w-full rounded border border-slate-300 bg-[#DDEFE1] py-1.5 pl-8 pr-3 text-xs shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm focus:border-[#0B3B2E] focus:outline-none"
                >
                  {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="h-8 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm focus:border-[#0B3B2E] focus:outline-none"
                >
                  {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <button
                  onClick={() => { setSearchTerm(""); setStatusFilter("all"); setTypeFilter("all"); }}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <FaFilter size={9} /> Reset
                </button>
                <button onClick={loadData} className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  <FaRedoAlt size={9} /> Refresh
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={exportCsv} className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    <FaDownload size={9} /> CSV
                  </button>
                  <button
                    onClick={openCreateModal}
                    disabled={isDemoUser || !canCreate}
                    className="inline-flex h-8 items-center gap-1.5 rounded bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60"
                  >
                    <FaPlus size={9} /> Schedule Inspection
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[960px] text-xs">
                <thead>
                  <tr className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                    {["Inspection", "Location", "Schedule", "Score & Findings", "Next Inspection", "Actions"].map((h, i) => (
                      <th key={h} className={`px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] ${i === 5 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">Loading inspections…</td></tr>
                  ) : filteredInspections.length === 0 ? (
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
                        <tr key={item._id} className={`border-t border-slate-100 ${rowBg} hover:bg-slate-50 align-top`}>
                          <td className="px-3 py-2 max-w-[220px]">
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
                          <td className="px-3 py-2">
                            <p className="font-semibold text-slate-900">{getInspectionPropertyName(item) || "—"}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Unit {item?.unit?.unitNumber || "Common / Property"}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{item?.tenant?.name || "No tenant"}</p>
                          </td>
                          <td className="px-3 py-2">
                            <p className="font-semibold text-slate-900">{formatDate(item?.scheduledDate)}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Completed {formatDate(item?.completedDate)}</p>
                          </td>
                          <td className="px-3 py-2">
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
                          <td className="px-3 py-2">
                            <p className="font-semibold text-slate-900">{formatDate(item?.nextInspectionDate)}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Tenant present: {item?.tenantPresent ? "Yes" : "No"}</p>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex flex-wrap justify-end gap-1.5">
                              <button
                                onClick={() => openEditModal(item)}
                                disabled={isDemoUser || !canUpdate}
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              >
                                <FaEdit />
                              </button>
                              <button
                                onClick={() => handleDelete(item)}
                                disabled={isDemoUser || !canDelete}
                                className="rounded border border-rose-300 bg-white px-2 py-1 text-[10px] font-black text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                              >
                                <FaTrash />
                              </button>
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
                Showing <span className="font-bold text-slate-900">{filteredInspections.length === 0 ? 0 : (safePage - 1) * ITEMS_PER_PAGE + 1}</span> to <span className="font-bold text-slate-900">{Math.min(safePage * ITEMS_PER_PAGE, filteredInspections.length)}</span> of <span className="font-bold text-slate-900">{filteredInspections.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                <span className="font-semibold text-slate-700">Page {safePage} of {totalPages}</span>
                <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-4 backdrop-blur-sm sm:items-center sm:py-6">
          <div className="w-full max-w-4xl max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain rounded-[28px] border border-slate-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-20 flex items-center justify-between bg-[#0B3B2E] px-6 py-4 text-white rounded-t-[28px]">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">Inspections</p>
                <h2 className="text-xl font-black">{editingInspection?._id ? "Edit Inspection" : "Schedule Inspection"}</h2>
              </div>
              <button onClick={closeModal} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 px-6 py-5">
              <div className="grid gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">Property *</span>
                  <select
                    value={selectedPropertyId}
                    onChange={(e) => setForm((prev) => ({ ...prev, property: e.target.value, unit: "", tenant: "" }))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                  >
                    <option value="">Select property</option>
                    {properties.map((p) => <option key={p._id} value={p._id}>{getPropertyName(p)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">Unit</span>
                  <select
                    value={form.unit}
                    onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value, tenant: "" }))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                  >
                    <option value="">Property-level / common area</option>
                    {availableUnits.map((u) => <option key={u._id} value={u._id}>{getPropertyName(u?.property)} · Unit {u?.unitNumber || "—"}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">Tenant</span>
                  <select
                    value={form.tenant}
                    onChange={(e) => setForm((prev) => ({ ...prev, tenant: e.target.value }))}
                    disabled={!form.unit}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10 disabled:bg-slate-100"
                  >
                    <option value="">No linked tenant</option>
                    {availableTenants.map((t) => <option key={t._id} value={t._id}>{t?.name || "Unnamed"}</option>)}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">Type</span>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                  >
                    {TYPE_OPTIONS.filter((o) => o.value !== "all").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">Status</span>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                  >
                    {STATUS_OPTIONS.filter((o) => o.value !== "all").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">Inspector name *</span>
                  <input
                    value={form.inspectorName}
                    onChange={(e) => setForm((prev) => ({ ...prev, inspectorName: e.target.value }))}
                    placeholder="Inspector, staff or service provider"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">Scheduled *</span>
                  <input type="date" value={form.scheduledDate} onChange={(e) => setForm((prev) => ({ ...prev, scheduledDate: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">Completed</span>
                  <input type="date" value={form.completedDate} onChange={(e) => setForm((prev) => ({ ...prev, completedDate: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">Next inspection</span>
                  <input type="date" value={form.nextInspectionDate} onChange={(e) => setForm((prev) => ({ ...prev, nextInspectionDate: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10" />
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
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">Score (0–100)</span>
                  <input type="number" min="0" max="100" value={form.score} onChange={(e) => setForm((prev) => ({ ...prev, score: e.target.value }))} placeholder="e.g. 92" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">Issues found</span>
                  <input type="number" min="0" value={form.issuesFound} onChange={(e) => setForm((prev) => ({ ...prev, issuesFound: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">Photos count</span>
                  <input type="number" min="0" value={form.photosCount} onChange={(e) => setForm((prev) => ({ ...prev, photosCount: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10" />
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-slate-700">Recommendations</span>
                <textarea rows={2} value={form.recommendations} onChange={(e) => setForm((prev) => ({ ...prev, recommendations: e.target.value }))} placeholder="Recommended repairs, deductions, compliance actions…" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10" />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-slate-700">Notes</span>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Observations for the property manager or next inspection cycle." className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10" />
              </label>

              <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-white/95 pt-4 backdrop-blur-sm">
                <button type="button" onClick={closeModal} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="rounded-xl bg-[#0B3B2E] px-4 py-2 text-sm font-bold text-white hover:bg-[#0A3127] disabled:opacity-60">
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

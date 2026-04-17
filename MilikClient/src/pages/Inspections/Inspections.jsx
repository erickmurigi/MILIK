import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  FaCalendarAlt,
  FaCheckCircle,
  FaClipboardCheck,
  FaDownload,
  FaEdit,
  FaExclamationTriangle,
  FaEye,
  FaPlus,
  FaSearch,
  FaTimes,
  FaTrash,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const TYPE_OPTIONS = [
  { value: "all", label: "All inspection types" },
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const toInputDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const getPropertyName = (property) =>
  property?.propertyName || property?.name || property?.title || "Unnamed Property";

const getUnitPropertyId = (unit) => String(unit?.property?._id || unit?.property || "");

const getInspectionPropertyName = (item) => getPropertyName(item?.property || item?.unit?.property);

const formatTypeLabel = (type) =>
  String(type || "routine")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const statusBadgeClass = (status) => {
  switch (status) {
    case "completed":
      return "bg-emerald-50 text-emerald-700 border border-emerald-200";
    case "in_progress":
      return "bg-blue-50 text-blue-700 border border-blue-200";
    case "cancelled":
      return "bg-rose-50 text-rose-700 border border-rose-200";
    default:
      return "bg-amber-50 text-amber-700 border border-amber-200";
  }
};

const typeBadgeClass = (type) => {
  switch (type) {
    case "move_in":
      return "bg-sky-50 text-sky-700 border border-sky-200";
    case "move_out":
      return "bg-violet-50 text-violet-700 border border-violet-200";
    case "safety":
      return "bg-amber-50 text-amber-700 border border-amber-200";
    case "emergency":
      return "bg-rose-50 text-rose-700 border border-rose-200";
    case "custom":
      return "bg-slate-100 text-slate-700 border border-slate-200";
    default:
      return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  }
};

const scoreBadgeClass = (score) => {
  if (!Number.isFinite(Number(score))) return "bg-slate-100 text-slate-700 border border-slate-200";
  if (Number(score) >= 90) return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (Number(score) >= 70) return "bg-amber-50 text-amber-700 border border-amber-200";
  return "bg-rose-50 text-rose-700 border border-rose-200";
};

const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const Inspections = () => {
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const isDemoUser = Boolean(currentUser?.isDemoUser);

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

  const loadData = async () => {
    if (!currentCompany?._id) return;

    setLoading(true);
    try {
      const business = currentCompany._id;
      const [inspectionsRes, unitsRes, tenantsRes, propertiesRes] = await Promise.all([
        adminRequests.get(`/inspections?business=${business}`),
        adminRequests.get(`/units?business=${business}&limit=1000`),
        adminRequests.get(`/tenants?business=${business}&limit=1000`),
        adminRequests.get(`/properties?business=${business}&limit=1000`),
      ]);

      setInspections(toList(inspectionsRes.data));
      setUnits(toList(unitsRes.data));
      setTenants(toList(tenantsRes.data));
      setProperties(toList(propertiesRes.data));
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load inspection data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentCompany?._id]);

  const selectedPropertyId = useMemo(() => {
    const unitMatch = units.find((unit) => String(unit?._id) === String(form.unit));
    return String(unitMatch?.property?._id || unitMatch?.property || form.property || "");
  }, [form.property, form.unit, units]);

  const availableUnits = useMemo(() => {
    if (!selectedPropertyId) return units;
    return units.filter((unit) => getUnitPropertyId(unit) === selectedPropertyId);
  }, [selectedPropertyId, units]);

  const availableTenants = useMemo(() => {
    if (!form.unit) return [];
    return tenants.filter((tenant) => String(tenant?.unit?._id || tenant?.unit || "") === String(form.unit));
  }, [form.unit, tenants]);

  useEffect(() => {
    if (!form.unit) {
      if (form.tenant) {
        setForm((prev) => ({ ...prev, tenant: "" }));
      }
      return;
    }

    if (!availableTenants.some((tenant) => String(tenant?._id) === String(form.tenant))) {
      setForm((prev) => ({ ...prev, tenant: "" }));
    }
  }, [availableTenants, form.tenant, form.unit]);

  const filteredInspections = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return inspections.filter((item) => {
      const matchesStatus = statusFilter === "all" ? true : item?.status === statusFilter;
      const matchesType = typeFilter === "all" ? true : item?.type === typeFilter;
      const haystack = [
        item?.inspectionNumber,
        item?.inspectorName,
        item?.tenant?.name,
        item?.unit?.unitNumber,
        getInspectionPropertyName(item),
        item?.notes,
        item?.recommendations,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = query ? haystack.includes(query) : true;
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [inspections, searchTerm, statusFilter, typeFilter]);

  const stats = useMemo(() => {
    const total = inspections.length;
    const scheduled = inspections.filter((item) => item?.status === "scheduled").length;
    const completed = inspections.filter((item) => item?.status === "completed").length;
    const averageScoreRaw = inspections
      .filter((item) => Number.isFinite(Number(item?.score)))
      .reduce((sum, item, _index, arr) => sum + Number(item?.score || 0) / (arr.length || 1), 0);

    return {
      total,
      scheduled,
      completed,
      averageScore: Number.isFinite(averageScoreRaw) ? averageScoreRaw.toFixed(1) : "0.0",
    };
  }, [inspections]);

  const openCreateModal = () => {
    if (isDemoUser) {
      toast.info("Demo mode is read-only. Inspection records cannot be changed here.");
      return;
    }
    setEditingInspection(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (item) => {
    if (isDemoUser) {
      toast.info("Demo mode is read-only. Inspection records cannot be changed here.");
      return;
    }

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
      issuesFound: Number.isFinite(Number(item?.issuesFound)) ? String(item.issuesFound) : "0",
      photosCount: Number.isFinite(Number(item?.photosCount)) ? String(item.photosCount) : "0",
      tenantPresent: Boolean(item?.tenantPresent),
      recommendations: item?.recommendations || "",
      notes: item?.notes || "",
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setIsModalOpen(false);
    setEditingInspection(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async (event) => {
    event.preventDefault();

    if (!currentCompany?._id) {
      toast.error("Select a company first");
      return;
    }
    if (!selectedPropertyId) {
      toast.error("Property is required");
      return;
    }
    if (!form.inspectorName.trim()) {
      toast.error("Inspector name is required");
      return;
    }
    if (!form.scheduledDate) {
      toast.error("Scheduled date is required");
      return;
    }

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
      setIsModalOpen(false);
      setEditingInspection(null);
      setForm(EMPTY_FORM);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save inspection");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item) => {
    if (isDemoUser) {
      toast.info("Demo mode is read-only. Inspection records cannot be changed here.");
      return;
    }

    const confirmed = window.confirm(`Delete inspection "${item?.inspectionNumber || "this inspection"}"?`);
    if (!confirmed) return;

    try {
      await adminRequests.delete(`/inspections/${item._id}`);
      toast.success("Inspection deleted");
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete inspection");
    }
  };

  const exportCsv = () => {
    const rows = filteredInspections.map((item) => [
      item?.inspectionNumber || "",
      formatTypeLabel(item?.type),
      item?.status || "",
      getInspectionPropertyName(item),
      item?.unit?.unitNumber || "",
      item?.tenant?.name || "",
      item?.inspectorName || "",
      item?.scheduledDate ? formatDate(item.scheduledDate) : "",
      item?.completedDate ? formatDate(item.completedDate) : "",
      Number.isFinite(Number(item?.score)) ? Number(item.score) : "",
      Number.isFinite(Number(item?.issuesFound)) ? Number(item.issuesFound) : 0,
      item?.recommendations || "",
      item?.notes || "",
    ]);

    const csv = [
      [
        "Inspection Number",
        "Type",
        "Status",
        "Property",
        "Unit",
        "Tenant",
        "Inspector",
        "Scheduled Date",
        "Completed Date",
        "Score",
        "Issues Found",
        "Recommendations",
        "Notes",
      ],
      ...rows,
    ]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `inspections_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 px-3 py-5 sm:px-4 lg:px-5">
        <div className="mx-auto w-full max-w-[98%] space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#FF8C00]">Tools</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Inspections</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Schedule and track unit, move-in, move-out and safety inspections from one clean operational page.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={exportCsv}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <FaDownload /> Export CSV
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                disabled={isDemoUser}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FaPlus /> Schedule Inspection
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Total Inspections", value: stats.total, tone: "bg-slate-900 text-white", icon: <FaClipboardCheck /> },
              { label: "Scheduled", value: stats.scheduled, tone: "bg-amber-50 text-amber-800 border border-amber-200", icon: <FaCalendarAlt /> },
              { label: "Completed", value: stats.completed, tone: "bg-emerald-50 text-emerald-800 border border-emerald-200", icon: <FaCheckCircle /> },
              { label: "Average Score", value: stats.averageScore, tone: "bg-blue-50 text-blue-800 border border-blue-200", icon: <FaEye /> },
            ].map((card) => (
              <div key={card.label} className={`rounded-2xl p-5 shadow-sm ${card.tone}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] opacity-80">{card.label}</p>
                    <p className="mt-3 text-3xl font-extrabold tracking-tight">{card.value}</p>
                  </div>
                  <div className="rounded-2xl bg-white/15 p-3 text-xl">{card.icon}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-3 border-b border-slate-200 px-5 py-4 lg:grid-cols-[1.4fr_0.8fr_0.8fr]">
              <label className="relative block">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
                  <FaSearch />
                </span>
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by inspection no., property, unit, tenant or inspector"
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                />
              </label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-xs font-extrabold uppercase tracking-[0.16em] text-slate-500">
                    <th className="px-5 py-3">Inspection</th>
                    <th className="px-5 py-3">Location</th>
                    <th className="px-5 py-3">Schedule</th>
                    <th className="px-5 py-3">Findings</th>
                    <th className="px-5 py-3">Next</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-sm font-semibold text-slate-500">
                        Loading inspections...
                      </td>
                    </tr>
                  ) : filteredInspections.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-sm font-semibold text-slate-500">
                        No inspections found for the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredInspections.map((item) => (
                      <tr key={item._id} className="align-top">
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
                              {item?.status === "completed" ? <FaCheckCircle /> : <FaClipboardCheck />}
                            </div>
                            <div>
                              <p className="font-extrabold text-slate-900">{item?.inspectionNumber || "Pending number"}</p>
                              <p className="mt-1 text-xs font-semibold text-slate-600">Inspector: {item?.inspectorName || "—"}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${statusBadgeClass(item?.status)}`}>
                                  {String(item?.status || "scheduled").replace(/_/g, " ")}
                                </span>
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${typeBadgeClass(item?.type)}`}>
                                  {formatTypeLabel(item?.type)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          <p className="font-semibold text-slate-900">{getInspectionPropertyName(item) || "Unassigned property"}</p>
                          <p className="mt-1 text-xs text-slate-500">Unit {item?.unit?.unitNumber || "Common area / property level"}</p>
                          <p className="mt-2 text-xs text-slate-500">Tenant: {item?.tenant?.name || "Not linked"}</p>
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          <p className="font-semibold text-slate-900">Scheduled {formatDate(item?.scheduledDate)}</p>
                          <p className="mt-2 text-xs text-slate-500">Completed {formatDate(item?.completedDate)}</p>
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          <div className="flex flex-wrap gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${scoreBadgeClass(item?.score)}`}>
                              Score {Number.isFinite(Number(item?.score)) ? Number(item.score) : "N/A"}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">Issues found: {Number(item?.issuesFound || 0)}</p>
                          <p className="mt-2 max-w-md text-xs leading-6 text-slate-500">{item?.recommendations || "No recommendations recorded yet."}</p>
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          <p className="font-semibold text-slate-900">{formatDate(item?.nextInspectionDate)}</p>
                          <p className="mt-2 text-xs text-slate-500">
                            Tenant present: {item?.tenantPresent ? "Yes" : "No"}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(item)}
                              disabled={isDemoUser}
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <FaEdit /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(item)}
                              disabled={isDemoUser}
                              className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <FaTrash /> Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {isModalOpen ? (
          <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-4 backdrop-blur-sm sm:items-center sm:py-6">
            <div className="w-full max-w-4xl max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain rounded-[28px] border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
              <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur-sm">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#FF8C00]">Inspections</p>
                  <h2 className="mt-1 text-xl font-extrabold text-slate-950">
                    {editingInspection?._id ? "Edit Inspection" : "Schedule Inspection"}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                >
                  <FaTimes />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-5 px-6 py-5">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Property *</span>
                    <select
                      value={selectedPropertyId}
                      onChange={(event) => {
                        const propertyId = event.target.value;
                        setForm((prev) => ({
                          ...prev,
                          property: propertyId,
                          unit: "",
                          tenant: "",
                        }));
                      }}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    >
                      <option value="">Select property</option>
                      {properties.map((property) => (
                        <option key={property._id} value={property._id}>
                          {getPropertyName(property)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Unit</span>
                    <select
                      value={form.unit}
                      onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value, tenant: "" }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    >
                      <option value="">Property-level / common area</option>
                      {availableUnits.map((unit) => (
                        <option key={unit._id} value={unit._id}>
                          {getPropertyName(unit?.property)} • Unit {unit?.unitNumber || "—"}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Tenant</span>
                    <select
                      value={form.tenant}
                      onChange={(event) => setForm((prev) => ({ ...prev, tenant: event.target.value }))}
                      disabled={!form.unit}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10 disabled:cursor-not-allowed disabled:bg-slate-100"
                    >
                      <option value="">No linked tenant</option>
                      {availableTenants.map((tenant) => (
                        <option key={tenant._id} value={tenant._id}>
                          {tenant?.name || "Unnamed Tenant"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Inspection type</span>
                    <select
                      value={form.type}
                      onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    >
                      {TYPE_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Status</span>
                    <select
                      value={form.status}
                      onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    >
                      {STATUS_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block md:col-span-2">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Inspector name *</span>
                    <input
                      value={form.inspectorName}
                      onChange={(event) => setForm((prev) => ({ ...prev, inspectorName: event.target.value }))}
                      placeholder="Inspector, staff member or service provider"
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    />
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Scheduled date *</span>
                    <input
                      type="date"
                      value={form.scheduledDate}
                      onChange={(event) => setForm((prev) => ({ ...prev, scheduledDate: event.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Completed date</span>
                    <input
                      type="date"
                      value={form.completedDate}
                      onChange={(event) => setForm((prev) => ({ ...prev, completedDate: event.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Next inspection</span>
                    <input
                      type="date"
                      value={form.nextInspectionDate}
                      onChange={(event) => setForm((prev) => ({ ...prev, nextInspectionDate: event.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    />
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 lg:mt-8">
                    <input
                      type="checkbox"
                      checked={form.tenantPresent}
                      onChange={(event) => setForm((prev) => ({ ...prev, tenantPresent: event.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
                    />
                    Tenant present during inspection
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Score (0-100)</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={form.score}
                      onChange={(event) => setForm((prev) => ({ ...prev, score: event.target.value }))}
                      placeholder="92"
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Issues found</span>
                    <input
                      type="number"
                      min="0"
                      value={form.issuesFound}
                      onChange={(event) => setForm((prev) => ({ ...prev, issuesFound: event.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Photos count</span>
                    <input
                      type="number"
                      min="0"
                      value={form.photosCount}
                      onChange={(event) => setForm((prev) => ({ ...prev, photosCount: event.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Recommendations</span>
                  <textarea
                    rows={3}
                    value={form.recommendations}
                    onChange={(event) => setForm((prev) => ({ ...prev, recommendations: event.target.value }))}
                    placeholder="Recommended repairs, deductions, compliance action or next operational step"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Notes</span>
                  <textarea
                    rows={4}
                    value={form.notes}
                    onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                    placeholder="Record observations that matter to the property manager, owner statement follow-up or next inspection cycle."
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                  />
                </label>

                <div className="sticky bottom-0 z-20 flex flex-col gap-3 border-t border-slate-200 bg-white/95 pt-4 backdrop-blur-sm sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                  >
                    <FaTimes /> Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? "Saving..." : editingInspection?._id ? "Save Changes" : "Create Inspection"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
};

export default Inspections;

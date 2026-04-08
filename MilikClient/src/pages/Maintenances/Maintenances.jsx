import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  FaCheckCircle,
  FaClock,
  FaDownload,
  FaEdit,
  FaExclamationTriangle,
  FaPlus,
  FaSearch,
  FaTimes,
  FaTools,
  FaTrash,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { adminRequests } from "../../utils/requestMethods";

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

const getRequestPropertyName = (item) =>
  getPropertyName(item?.unit?.property);

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

const priorityBadgeClass = (priority) => {
  switch (priority) {
    case "emergency":
      return "bg-rose-50 text-rose-700 border border-rose-200";
    case "high":
      return "bg-orange-50 text-orange-700 border border-orange-200";
    case "low":
      return "bg-slate-100 text-slate-700 border border-slate-200";
    default:
      return "bg-violet-50 text-violet-700 border border-violet-200";
  }
};

const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const Maintenances = () => {
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const isDemoUser = Boolean(currentUser?.isDemoUser);

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

  const loadData = async () => {
    if (!currentCompany?._id) return;

    setLoading(true);
    try {
      const business = currentCompany._id;
      const [maintenanceRes, unitsRes, tenantsRes, propertiesRes] = await Promise.all([
        adminRequests.get(`/maintenances?business=${business}`),
        adminRequests.get(`/units?business=${business}&limit=1000`),
        adminRequests.get(`/tenants?business=${business}&limit=1000`),
        adminRequests.get(`/properties?business=${business}&limit=1000`),
      ]);

      setRequests(toList(maintenanceRes.data));
      setUnits(toList(unitsRes.data));
      setTenants(toList(tenantsRes.data));
      setProperties(toList(propertiesRes.data));
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load maintenance data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentCompany?._id]);

  const availableTenants = useMemo(() => {
    if (!form.unit) return tenants;
    return tenants.filter((tenant) => String(tenant?.unit?._id || tenant?.unit || "") === String(form.unit));
  }, [form.unit, tenants]);

  const selectedPropertyId = useMemo(() => {
    const unitMatch = units.find((unit) => String(unit?._id) === String(form.unit));
    return String(unitMatch?.property?._id || unitMatch?.property || form.property || "");
  }, [form.property, form.unit, units]);

  const availableUnits = useMemo(() => {
    if (!selectedPropertyId) return units;
    return units.filter((unit) => getUnitPropertyId(unit) === selectedPropertyId);
  }, [selectedPropertyId, units]);

  useEffect(() => {
    if (!form.unit) return;
    if (!availableTenants.some((tenant) => String(tenant?._id) === String(form.tenant))) {
      setForm((prev) => ({ ...prev, tenant: "" }));
    }
  }, [availableTenants, form.tenant, form.unit]);

  const filteredRequests = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return requests.filter((item) => {
      const matchesStatus = statusFilter === "all" ? true : item?.status === statusFilter;
      const matchesPriority = priorityFilter === "all" ? true : item?.priority === priorityFilter;
      const haystack = [
        item?.title,
        item?.description,
        item?.assignedTo,
        item?.tenant?.name,
        item?.unit?.unitNumber,
        getRequestPropertyName(item),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = query ? haystack.includes(query) : true;
      return matchesStatus && matchesPriority && matchesSearch;
    });
  }, [priorityFilter, requests, searchTerm, statusFilter]);

  const stats = useMemo(() => {
    const total = requests.length;
    const pending = requests.filter((item) => item?.status === "pending").length;
    const inProgress = requests.filter((item) => item?.status === "in_progress").length;
    const completed = requests.filter((item) => item?.status === "completed").length;
    return { total, pending, inProgress, completed };
  }, [requests]);

  const openCreateModal = () => {
    if (isDemoUser) {
      toast.info("Demo mode is read-only. Maintenance records cannot be changed here.");
      return;
    }
    setEditingRequest(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (item) => {
    if (isDemoUser) {
      toast.info("Demo mode is read-only. Maintenance records cannot be changed here.");
      return;
    }
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
    setIsModalOpen(false);
    setEditingRequest(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!currentCompany?._id) {
      toast.error("Select a company first");
      return;
    }
    if (!form.unit) {
      toast.error("Unit is required");
      return;
    }
    if (!form.title.trim()) {
      toast.error("Issue title is required");
      return;
    }
    if (!form.description.trim()) {
      toast.error("Description is required");
      return;
    }

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

      await loadData();
      setIsModalOpen(false);
      setEditingRequest(null);
      setForm(EMPTY_FORM);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save maintenance request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item) => {
    if (isDemoUser) {
      toast.info("Demo mode is read-only. Maintenance records cannot be changed here.");
      return;
    }
    const confirmed = window.confirm(`Delete maintenance request \"${item?.title || "this request"}\"?`);
    if (!confirmed) return;

    try {
      await adminRequests.delete(`/maintenances/${item._id}`);
      toast.success("Maintenance request deleted");
      await loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete maintenance request");
    }
  };

  const exportCsv = () => {
    const rows = filteredRequests.map((item) => [
      item?.title || "",
      getRequestPropertyName(item) || "",
      item?.unit?.unitNumber || "",
      item?.tenant?.name || "",
      item?.priority || "",
      item?.status || "",
      item?.assignedTo || "",
      item?.scheduledDate ? formatDate(item.scheduledDate) : "",
      item?.estimatedCost || 0,
      item?.actualCost || 0,
      item?.description || "",
    ]);

    const csv = [
      [
        "Title",
        "Property",
        "Unit",
        "Tenant",
        "Priority",
        "Status",
        "Assigned To",
        "Scheduled Date",
        "Estimated Cost",
        "Actual Cost",
        "Description",
      ],
      ...rows,
    ]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `maintenance_requests_${new Date().toISOString().slice(0, 10)}.csv`;
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
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Maintenance Management</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Track maintenance work from issue reporting to completion without leaving the Milik workspace.
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
                <FaPlus /> New Request
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Total Requests", value: stats.total, tone: "bg-slate-900 text-white", icon: <FaTools /> },
              { label: "Pending", value: stats.pending, tone: "bg-amber-50 text-amber-800 border border-amber-200", icon: <FaClock /> },
              { label: "In Progress", value: stats.inProgress, tone: "bg-blue-50 text-blue-800 border border-blue-200", icon: <FaTools /> },
              { label: "Completed", value: stats.completed, tone: "bg-emerald-50 text-emerald-800 border border-emerald-200", icon: <FaCheckCircle /> },
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
                  placeholder="Search by issue, unit, tenant, property or assignee"
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
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
              >
                {PRIORITY_OPTIONS.map((option) => (
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
                    <th className="px-5 py-3">Request</th>
                    <th className="px-5 py-3">Location</th>
                    <th className="px-5 py-3">Assigned</th>
                    <th className="px-5 py-3">Costs</th>
                    <th className="px-5 py-3">Dates</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-sm font-semibold text-slate-500">
                        Loading maintenance requests...
                      </td>
                    </tr>
                  ) : filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-sm font-semibold text-slate-500">
                        No maintenance requests found for the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredRequests.map((item) => (
                      <tr key={item._id} className="align-top">
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
                              {item?.priority === "emergency" ? <FaExclamationTriangle /> : <FaTools />}
                            </div>
                            <div>
                              <p className="font-extrabold text-slate-900">{item?.title || "Untitled issue"}</p>
                              <p className="mt-1 max-w-md text-xs leading-6 text-slate-600">{item?.description || "—"}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${statusBadgeClass(item?.status)}`}>
                                  {String(item?.status || "pending").replace(/_/g, " ")}
                                </span>
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${priorityBadgeClass(item?.priority)}`}>
                                  {item?.priority || "medium"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          <p className="font-semibold text-slate-900">{getRequestPropertyName(item) || "Unassigned property"}</p>
                          <p className="mt-1 text-xs text-slate-500">Unit {item?.unit?.unitNumber || "—"}</p>
                          <p className="mt-2 text-xs text-slate-500">Tenant: {item?.tenant?.name || "Not linked"}</p>
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          <p className="font-semibold text-slate-900">{item?.assignedTo || "Not assigned"}</p>
                          <p className="mt-2 text-xs text-slate-500">Created {formatDate(item?.createdAt)}</p>
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          <p className="font-semibold text-slate-900">Est. {money(item?.estimatedCost || 0)}</p>
                          <p className="mt-2 text-xs text-slate-500">Actual {money(item?.actualCost || 0)}</p>
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          <p className="font-semibold text-slate-900">Scheduled {formatDate(item?.scheduledDate)}</p>
                          <p className="mt-2 text-xs text-slate-500">Completed {formatDate(item?.completedDate)}</p>
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
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
            <div className="w-full max-w-3xl rounded-[28px] border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#FF8C00]">Maintenance</p>
                  <h2 className="mt-1 text-xl font-extrabold text-slate-950">
                    {editingRequest?._id ? "Edit Maintenance Request" : "New Maintenance Request"}
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
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Property</span>
                    <select
                      value={selectedPropertyId}
                      onChange={(event) => {
                        const propertyId = event.target.value;
                        setForm((prev) => ({
                          ...prev,
                          unit: "",
                          tenant: "",
                          property: propertyId,
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
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Unit *</span>
                    <select
                      value={form.unit}
                      onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value, tenant: "" }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    >
                      <option value="">Select unit</option>
                      {availableUnits.map((unit) => (
                          <option key={unit._id} value={unit._id}>
                            {getPropertyName(unit?.property)} • Unit {unit?.unitNumber || "—"}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Tenant</span>
                    <select
                      value={form.tenant}
                      onChange={(event) => setForm((prev) => ({ ...prev, tenant: event.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    >
                      <option value="">No linked tenant</option>
                      {availableTenants.map((tenant) => (
                        <option key={tenant._id} value={tenant._id}>
                          {tenant?.name || "Unnamed Tenant"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Assigned to</span>
                    <input
                      value={form.assignedTo}
                      onChange={(event) => setForm((prev) => ({ ...prev, assignedTo: event.target.value }))}
                      placeholder="Technician or service provider"
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    />
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Issue title *</span>
                    <input
                      value={form.title}
                      onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                      placeholder="Example: Water leak in kitchen"
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">Priority</span>
                      <select
                        value={form.priority}
                        onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                      >
                        {PRIORITY_OPTIONS.filter((option) => option.value !== "all").map((option) => (
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
                  </div>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Description *</span>
                  <textarea
                    rows={4}
                    value={form.description}
                    onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                    placeholder="Describe the issue clearly so a property manager or technician can act on it."
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Scheduled date</span>
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
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Estimated cost</span>
                    <input
                      type="number"
                      min="0"
                      value={form.estimatedCost}
                      onChange={(event) => setForm((prev) => ({ ...prev, estimatedCost: event.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Actual cost</span>
                    <input
                      type="number"
                      min="0"
                      value={form.actualCost}
                      onChange={(event) => setForm((prev) => ({ ...prev, actualCost: event.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-5">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-xl bg-[#0B3B2E] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? "Saving..." : editingRequest?._id ? "Save Changes" : "Create Request"}
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

export default Maintenances;
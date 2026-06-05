import React, { useEffect, useMemo, useState } from "react";
import { clearDraft, readDraft, writeDraft } from "../../hooks/useFormDraft";
import { FaChevronDown, FaChevronRight, FaEdit, FaMinus, FaPlus, FaRedoAlt, FaSearch, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload, VEHICLE_TYPES } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";

const emptyForm = { name: "", category: "", jobType: "both", pricingType: "flat", defaultPrice: "", pricingTiers: [], active: true };
const inputClass  = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass  = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const selectClass = "h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const PAGE_SIZE   = 30;
const NEW_CATEGORY_SENTINEL = "__new__";

const Modal = ({ title, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
      </div>
      <div className="max-h-[80vh] overflow-y-auto p-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

const CarWashServices = () => {
  const [rows, setRows]               = useState([]);
  const [form, setForm]               = useState(emptyForm);
  const [editingId, setEditingId]     = useState("");
  const [filters, setFilters]         = useState({ search: "", status: "" });
  const [appliedFilters, setApplied]  = useState({ search: "", status: "" });
  const [expandedIds, setExpandedIds] = useState([]);
  const [page, setPage]               = useState(1);
  const [pagination, setPagination]   = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [showModal, setShowModal]     = useState(false);
  const [loading, setLoading]         = useState(false);
  const [categories, setCategories]   = useState([]);
  const [categoryMode, setCategoryMode] = useState("select");
  const canManage = useCarWashPermission("carwash-services", "manage");

  const rowStats = useMemo(() => {
    let active = 0, inactive = 0;
    rows.forEach((r) => { if (r.active !== false) active++; else inactive++; });
    return { active, inactive };
  }, [rows]);

  const usedVehicleTypes = useMemo(
    () => new Set((form.pricingTiers || []).map((t) => t.vehicleType)),
    [form.pricingTiers]
  );

  const loadCategories = async () => {
    try {
      const result = await carWashApi.listServiceCategories();
      setCategories(Array.isArray(result) ? result : Array.isArray(result?.categories) ? result.categories : []);
    } catch { setCategories([]); }
  };

  const load = async () => {
    setLoading(true);
    try {
      const payload = await carWashApi.listServices({
        limit: PAGE_SIZE, page,
        search: appliedFilters.search || undefined,
        active: appliedFilters.status === "active" ? true : appliedFilters.status === "inactive" ? false : undefined,
      });
      const services = normalizeListPayload(payload, "services");
      setRows(services);
      setPagination(payload?.pagination || { page, limit: PAGE_SIZE, total: services.length, pages: 1 });
      setExpandedIds([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { load().catch(() => toast.error("Failed to load services")); }, [appliedFilters, page]); // eslint-disable-line
  useEffect(() => { loadCategories(); }, []);

  // Auto-save service form draft while modal is open
  useEffect(() => {
    if (!showModal || !form.name) return;
    const key = editingId ? `cw-service-edit-${editingId}` : "cw-service-create";
    const t = setTimeout(() => writeDraft(key, { form, categoryMode }), 400);
    return () => clearTimeout(t);
  }, [form, categoryMode, showModal, editingId]);

  const closeModal = () => {
    const key = editingId ? `cw-service-edit-${editingId}` : "cw-service-create";
    clearDraft(key);
    setShowModal(false); setEditingId(""); setForm(emptyForm); setCategoryMode("select");
  };

  const openCreate = () => {
    const draft = readDraft("cw-service-create");
    setEditingId("");
    setForm(draft?.form ?? emptyForm);
    setCategoryMode(draft?.categoryMode ?? "select");
    setShowModal(true);
  };

  const openEdit = (row) => {
    const draft = readDraft(`cw-service-edit-${row._id}`);
    setEditingId(row._id);
    const fromRow = {
      name:         row.name || "",
      category:     row.category || "",
      jobType:      row.jobType || "both",
      pricingType:  row.pricingType || "flat",
      defaultPrice: row.defaultPrice ?? "",
      pricingTiers: Array.isArray(row.pricingTiers)
        ? row.pricingTiers.map((t) => ({ vehicleType: t.vehicleType, price: String(t.price) }))
        : [],
      active: row.active !== false,
    };
    const catExists = categories.includes((draft?.form ?? fromRow).category || "");
    setForm(draft?.form ?? fromRow);
    setCategoryMode(draft?.categoryMode ?? ((row.category && !catExists) ? "new" : "select"));
    setShowModal(true);
  };

  // ── Pricing tier helpers ──────────────────────────────────────────────────
  const addTier = () =>
    setForm((p) => ({ ...p, pricingTiers: [...p.pricingTiers, { vehicleType: "", price: "" }] }));

  const removeTier = (i) =>
    setForm((p) => ({ ...p, pricingTiers: p.pricingTiers.filter((_, idx) => idx !== i) }));

  const updateTier = (i, field, value) =>
    setForm((p) => ({
      ...p,
      pricingTiers: p.pricingTiers.map((t, idx) => idx === i ? { ...t, [field]: value } : t),
    }));

  const submit = async (e) => {
    e.preventDefault();
    const hasDuplicateTiers = form.pricingTiers.some(
      (t, i) => t.vehicleType && form.pricingTiers.findIndex((x, j) => j !== i && x.vehicleType === t.vehicleType) !== -1
    );
    if (hasDuplicateTiers) { toast.error("Each vehicle type can only appear once in the pricing table"); return; }

    const payload = {
      ...form,
      defaultPrice: Number(form.defaultPrice || 0),
      pricingTiers: form.pricingTiers
        .filter((t) => t.vehicleType && t.price !== "")
        .map((t) => ({ vehicleType: t.vehicleType, price: Number(t.price) })),
    };
    try {
      if (editingId) await carWashApi.updateService(editingId, payload);
      else await carWashApi.createService(payload);
      closeModal();
      await Promise.all([load(), loadCategories()]);
      toast.success("Service saved");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Unable to save service");
    }
  };

  const applyFilters = (e) => { e.preventDefault(); setPage(1); setApplied({ ...filters }); };
  const resetFilters = () => { setFilters({ search: "", status: "" }); setPage(1); setApplied({ search: "", status: "" }); };
  const toggleExpanded = (id) =>
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <CarWashShell
      title="Services Register"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          {canManage && (
            <button type="button" onClick={openCreate} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#0A3127]">
              <FaPlus /> New Service
            </button>
          )}
        </>
      }
    >
      <form onSubmit={applyFilters} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 md:grid-cols-[1fr_220px_auto_auto]">
        <input
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          placeholder="Search service / category"
          value={filters.search}
          onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
        />
        <select
          className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.status}
          onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
        >
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch /> Search
        </button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]">
          <FaRedoAlt /> Reset
        </button>
      </form>

      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap min-h-8 items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{rows.length}</strong> / {pagination.total}</span>
          <span>Page: <strong className="text-[#0B3B2E]">{pagination.page}</strong> / {pagination.pages}</span>
          <span>Active: <strong className="text-[#0B3B2E]">{rowStats.active}</strong></span>
          <span>Inactive: <strong className="text-[#FF8C00]">{rowStats.inactive}</strong></span>
        </div>
        <table className="w-full min-w-[800px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="w-8 px-2 py-1.5 text-left" />
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Service</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Category</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Vehicle Pricing</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Base / Default Price</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => {
                const expanded = expandedIds.includes(row._id);
                const tiers = Array.isArray(row.pricingTiers) ? row.pricingTiers : [];
                return (
                  <React.Fragment key={row._id}>
                    <tr className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-2 py-1">
                        <button type="button" onClick={() => toggleExpanded(row._id)} className="text-[#0B3B2E] hover:text-[#FF8C00]">
                          {expanded ? <FaChevronDown /> : <FaChevronRight />}
                        </button>
                      </td>
                      <td className="px-2 py-1 font-extrabold text-slate-900">{row.name}</td>
                      <td className="px-2 py-1 text-slate-700">{row.category || "—"}</td>
                      <td className="px-2 py-1">
                        {row.pricingType === "per_sqft" ? (
                          <span className="inline-flex border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                            KES {row.defaultPrice}/sqft
                          </span>
                        ) : tiers.length > 0 ? (
                          <span className="inline-flex border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                            {tiers.length} vehicle type{tiers.length !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-slate-400">Flat rate</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right font-extrabold text-slate-900">
                        {row.pricingType === "per_sqft" ? <span className="text-slate-400 font-normal text-[10px]">calculated</span> : formatMoney(row.defaultPrice)}
                      </td>
                      <td className="px-2 py-1">
                        <span className={`inline-flex border px-2 py-0.5 text-[11px] font-bold uppercase ${row.active === false ? "border-orange-200 bg-orange-50 text-orange-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                          {row.active === false ? "Inactive" : "Active"}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right">
                        {canManage && (
                          <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                            <FaEdit /> Edit
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-slate-200 bg-[#F8FBF9]">
                        <td colSpan={7} className="px-10 py-3 text-[11px] text-slate-600">
                          {tiers.length > 0 ? (
                            <div className="max-w-sm">
                              <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-400">Vehicle Type Pricing</p>
                              <table className="w-full border border-slate-200 text-xs">
                                <thead className="bg-slate-100">
                                  <tr>
                                    <th className="px-3 py-1.5 text-left font-bold text-slate-600">Vehicle Type</th>
                                    <th className="px-3 py-1.5 text-right font-bold text-slate-600">Price</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {tiers.map((t, i) => (
                                    <tr key={i} className="border-t border-slate-200">
                                      <td className="px-3 py-1.5 font-semibold text-slate-800">{t.vehicleType}</td>
                                      <td className="px-3 py-1.5 text-right font-extrabold text-slate-900">{formatMoney(t.price)}</td>
                                    </tr>
                                  ))}
                                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                                    <td className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-500">Default / Other</td>
                                    <td className="px-3 py-1.5 text-right font-extrabold text-slate-700">{formatMoney(row.defaultPrice)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="grid gap-3 md:grid-cols-3">
                              <div><span className="font-extrabold uppercase text-slate-500">Price:</span> {formatMoney(row.defaultPrice)}</div>
                              <div><span className="font-extrabold uppercase text-slate-500">Created:</span> {row.createdAt ? new Date(row.createdAt).toLocaleDateString("en-KE") : "—"}</div>
                              <div><span className="font-extrabold uppercase text-slate-500">Service ID:</span> {row._id}</div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">No Car Wash services found.</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex min-h-9 items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Rows per page: {PAGE_SIZE}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1 || loading} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">Previous</button>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(p + 1, pagination.pages))} disabled={page >= pagination.pages || loading} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">Next</button>
          </div>
        </div>
      </div>

      {showModal && (
        <Modal
          title={editingId ? "Edit Service" : "Create Service"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              {canManage && <button type="submit" form="carwash-service-form" className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">Save Service</button>}
            </>
          }
        >
          <form id="carwash-service-form" onSubmit={submit} className="space-y-4">

            {/* Basic fields */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className={labelClass}>Service Name *</label>
                <input className={inputClass} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required autoFocus />
              </div>
              <div>
                <label className={labelClass}>Category</label>
                {categoryMode === "new" ? (
                  <div className="flex gap-1">
                    <input className={inputClass} value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} placeholder="Type new category…" autoFocus />
                    <button type="button" title="Pick from existing" onClick={() => { setCategoryMode("select"); setForm((p) => ({ ...p, category: "" })); }} className="border border-slate-300 bg-slate-50 px-2 text-xs font-bold text-slate-600 hover:bg-slate-100">↩</button>
                  </div>
                ) : (
                  <select
                    className={inputClass}
                    value={categories.includes(form.category) ? form.category : form.category ? NEW_CATEGORY_SENTINEL : ""}
                    onChange={(e) => {
                      if (e.target.value === NEW_CATEGORY_SENTINEL) { setCategoryMode("new"); setForm((p) => ({ ...p, category: "" })); }
                      else setForm((p) => ({ ...p, category: e.target.value }));
                    }}
                  >
                    <option value="">— No category —</option>
                    {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                    <option value={NEW_CATEGORY_SENTINEL}>+ Add new category…</option>
                  </select>
                )}
              </div>

              <div>
                <label className={labelClass}>Applies To</label>
                <select
                  className={inputClass}
                  value={form.jobType}
                  onChange={(e) => setForm((p) => ({ ...p, jobType: e.target.value }))}
                >
                  <option value="both">Both (Vehicle &amp; Carpet)</option>
                  <option value="vehicle">Vehicle Wash only</option>
                  <option value="carpet">Carpet / Textile only</option>
                </select>
              </div>

              {/* Pricing type toggle */}
              <div className="md:col-span-2">
                <label className={labelClass}>Pricing Type</label>
                <div className="flex overflow-hidden border border-slate-300">
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, pricingType: "flat", pricingTiers: p.pricingType === "flat" ? p.pricingTiers : [] }))}
                    className={`flex-1 py-2 text-xs font-bold ${form.pricingType === "flat" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    Flat Rate / Vehicle Tiers
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, pricingType: "per_sqft", pricingTiers: [] }))}
                    className={`flex-1 border-l border-slate-300 py-2 text-xs font-bold ${form.pricingType === "per_sqft" ? "bg-[#0B3B2E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    Per Square Foot (Carpet / Textile)
                  </button>
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  {form.pricingType === "per_sqft" ? "Rate per sq ft (KES) *" : "Default / Fallback Price (KES) *"}
                </label>
                <input className={inputClass} type="number" min="0" value={form.defaultPrice} onChange={(e) => setForm((p) => ({ ...p, defaultPrice: e.target.value }))} required />
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {form.pricingType === "per_sqft"
                    ? "Price = area (sq ft) × this rate. Staff enters dimensions when creating a job."
                    : "Used when no vehicle type tier matches, or for carpet/flat-rate jobs."}
                </p>
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} />
                  Active
                </label>
              </div>
            </div>

            {/* Pricing tiers — only for flat-rate services */}
            {form.pricingType === "per_sqft" && (
              <div className="flex items-start gap-2 border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-800">
                <span className="mt-0.5 text-base leading-none">📐</span>
                <div>
                  <p className="font-bold">Area-based pricing active.</p>
                  <p className="mt-0.5 text-blue-700">When adding a job, staff will enter the carpet dimensions (rectangle or circle). Price is calculated automatically as: <strong>area × KES {form.defaultPrice || "?"}/sqft</strong>.</p>
                </div>
              </div>
            )}
            <div className={`border border-slate-200 ${form.pricingType === "per_sqft" ? "hidden" : ""}`}>
              <div className="flex items-center justify-between border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#0B3B2E]">Vehicle Type Pricing</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    Set different prices per vehicle size. Leave empty for carpet/flat-rate services.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addTier}
                  disabled={form.pricingTiers.length >= VEHICLE_TYPES.length}
                  className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-40"
                >
                  <FaPlus size={8} /> Add Vehicle Type
                </button>
              </div>

              {form.pricingTiers.length === 0 ? (
                <p className="px-4 py-3 text-[11px] text-slate-400">
                  No vehicle type pricing — this service charges the default price above for all vehicles.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-slate-500">Vehicle Type</th>
                      <th className="px-3 py-2 text-right font-bold uppercase tracking-wide text-slate-500">Price (KES)</th>
                      <th className="w-8 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.pricingTiers.map((tier, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="px-3 py-1.5">
                          <select
                            className={selectClass}
                            value={tier.vehicleType}
                            onChange={(e) => updateTier(i, "vehicleType", e.target.value)}
                            required
                          >
                            <option value="">— Select vehicle type —</option>
                            {VEHICLE_TYPES.map((vt) => (
                              <option key={vt} value={vt} disabled={usedVehicleTypes.has(vt) && vt !== tier.vehicleType}>
                                {vt}{usedVehicleTypes.has(vt) && vt !== tier.vehicleType ? " (already added)" : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            className="h-9 w-full border border-slate-300 px-2 text-right text-sm font-bold text-slate-900 focus:border-[#0B3B2E] focus:outline-none"
                            type="number"
                            min="0"
                            step="1"
                            value={tier.price}
                            onChange={(e) => updateTier(i, "price", e.target.value)}
                            placeholder="Enter price"
                            required
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button type="button" onClick={() => removeTier(i)} className="p-1 text-red-400 hover:text-red-600" title="Remove">
                            <FaMinus size={10} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashServices;

import React, { useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clearDraft, readDraft, writeDraft } from "../../hooks/useFormDraft";
import { FaChevronDown, FaChevronRight, FaCopy, FaEdit, FaMinus, FaPlus, FaRedoAlt, FaSearch } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload, VEHICLE_TYPES } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from "../../components/PaginationBar";
import { inputClass, labelClass } from "../../utils/formStyles";

import Modal from "../../components/common/Modal";

const emptyForm = { name: "", category: "", jobType: "both", pricingType: "flat", defaultPrice: "", pricingTiers: [], active: true, isTaxable: false, taxRate: "", isCombo: false, comboDescription: "" };
const normalizeForm = (f) => ({ ...emptyForm, ...f, pricingTiers: Array.isArray(f?.pricingTiers) ? f.pricingTiers : [], isTaxable: Boolean(f?.isTaxable), taxRate: f?.taxRate !== undefined ? String(f.taxRate) : "", isCombo: Boolean(f?.isCombo), comboDescription: String(f?.comboDescription || "") });
const selectClass = "h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const DEFAULT_PAGE_SIZE = 25;
const NEW_CATEGORY_SENTINEL = "__new__";

const CarWashServices = () => {
  const queryClient = useQueryClient();
  const [form, setForm]               = useState(emptyForm);
  const [editingId, setEditingId]     = useState("");
  const [filters, setFilters]         = useTabState("/carwash/services:filters", { search: "", status: "" });
  const [appliedFilters, setApplied]  = useTabState("/carwash/services:appliedFilters", { search: "", status: "" });
  const [expandedIds, setExpandedIds] = useState([]);
  const [page, setPage]               = useTabState("/carwash/services:page", 1);
  const [pageSize, setPageSize]       = useTabState("/carwash/services:pageSize", DEFAULT_PAGE_SIZE);
  const [showModal, setShowModal]     = useState(false);
  const [categoryMode, setCategoryMode] = useState("select");
  const addAnotherRef = React.useRef(false);
  const canManage = useCarWashPermission("carwash-services", "manage");

  const servicesQueryKey = ["cw-services", appliedFilters, page, pageSize];

  const { data: servicesData, isLoading: loading, error, refetch } = useQuery({
    queryKey: servicesQueryKey,
    queryFn: () => carWashApi.listServices({
      limit: pageSize, page,
      search: appliedFilters.search || undefined,
      active: appliedFilters.status === "active" ? true : appliedFilters.status === "inactive" ? false : undefined,
    }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const { data: categoriesData } = useQuery({
    queryKey: ["cw-service-categories"],
    queryFn: () => carWashApi.listServiceCategories(),
    staleTime: 5 * 60_000,
  });

  useEffect(() => { if (error) toast.error("Failed to load services"); }, [error]);
  useEffect(() => { setExpandedIds([]); }, [servicesData]);

  const rows = normalizeListPayload(servicesData, "services");
  const pagination = servicesData?.pagination || { page, limit: pageSize, total: rows.length, pages: 1 };
  const categories = Array.isArray(categoriesData) ? categoriesData : Array.isArray(categoriesData?.categories) ? categoriesData.categories : [];

  const rowStats = useMemo(() => {
    let active = 0, inactive = 0;
    rows.forEach((r) => { if (r.active !== false) active++; else inactive++; });
    return { active, inactive };
  }, [rows]);

  const usedVehicleTypes = useMemo(
    () => new Set((form.pricingTiers || []).map((t) => t.vehicleType)),
    [form.pricingTiers]
  );

  // Auto-save draft only during create — editing always loads fresh from DB
  useEffect(() => {
    if (!showModal || editingId || !form.name) return;
    const t = setTimeout(() => writeDraft("cw-service-create", { form, categoryMode }), 400);
    return () => clearTimeout(t);
  }, [form, categoryMode, showModal, editingId]);

  const closeModal = () => {
    clearDraft("cw-service-create");
    if (editingId) clearDraft(`cw-service-edit-${editingId}`);
    setShowModal(false); setEditingId(""); setForm(emptyForm); setCategoryMode("select");
  };

  const openCreate = (prefill = null) => {
    const draft = !prefill && readDraft("cw-service-create");
    setEditingId("");
    setForm(normalizeForm(draft?.form ?? prefill ?? emptyForm));
    setCategoryMode(draft?.categoryMode ?? "select");
    setShowModal(true);
  };

  const openEdit = (row) => {
    setEditingId(row._id);
    const fromRow = {
      name:         row.name || "",
      category:     row.category || "",
      jobType:      row.jobType || "both",
      pricingType:  row.pricingType || "flat",
      defaultPrice: row.defaultPrice ?? "",
      pricingTiers: Array.isArray(row.pricingTiers)
        ? row.pricingTiers
            .filter((t) => t.vehicleType && String(t.vehicleType).trim())
            .map((t) => {
              const upper = String(t.vehicleType).toUpperCase();
              const match = VEHICLE_TYPES.find((vt) => vt.toUpperCase() === upper);
              return { vehicleType: match ?? t.vehicleType, price: String(t.price) };
            })
        : [],
      active:           row.active !== false,
      isTaxable:        Boolean(row.isTaxable),
      taxRate:          row.taxRate !== undefined ? String(row.taxRate) : "",
      isCombo:          Boolean(row.isCombo),
      comboDescription: String(row.comboDescription || ""),
    };
    const catExists = categories.includes(fromRow.category || "");
    setForm(normalizeForm(fromRow));
    setCategoryMode((row.category && !catExists) ? "new" : "select");
    setShowModal(true);
  };

  const openDuplicate = (row) => {
    openCreate({
      name:             `${row.name || ""} (Copy)`,
      category:         row.category || "",
      jobType:          row.jobType || "both",
      pricingType:      row.pricingType || "flat",
      defaultPrice:     String(row.defaultPrice ?? ""),
      pricingTiers:     Array.isArray(row.pricingTiers)
        ? row.pricingTiers.map((t) => ({ vehicleType: t.vehicleType, price: String(t.price) }))
        : [],
      isCombo:          Boolean(row.isCombo),
      comboDescription: String(row.comboDescription || ""),
      active: true,
    });
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
    const addAnother = addAnotherRef.current;
    addAnotherRef.current = false;
    e.preventDefault();
    const hasDuplicateTiers = form.pricingTiers.some(
      (t, i) => t.vehicleType && form.pricingTiers.findIndex((x, j) => j !== i && x.vehicleType === t.vehicleType) !== -1
    );
    if (hasDuplicateTiers) { toast.error("Each vehicle type can only appear once in the pricing table"); return; }

    const payload = {
      name:             String(form.name || "").trim(),
      category:         String(form.category || "").trim(),
      jobType:          String(form.jobType || "both"),
      pricingType:      String(form.pricingType || "flat"),
      defaultPrice:     Number(form.defaultPrice || 0),
      active:           Boolean(form.active),
      isTaxable:        Boolean(form.isTaxable),
      taxRate:          Number(form.taxRate || 0),
      isCombo:          Boolean(form.isCombo),
      comboDescription: String(form.comboDescription || "").trim(),
      pricingTiers: (form.pricingTiers || [])
        .filter((t) => t.vehicleType && t.price !== "")
        .map((t) => ({ vehicleType: String(t.vehicleType), price: Number(t.price) })),
    };
    try {
      if (editingId) await carWashApi.updateService(editingId, payload);
      else await carWashApi.createService(payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cw-services"] }),
        queryClient.invalidateQueries({ queryKey: ["cw-service-categories"] }),
      ]);
      if (addAnother && !editingId) {
        // Keep category + jobType + pricingType + tiers — clear only name & prices so staff can quickly enter the next variant
        const keepCategory = form.category;
        const keepCategoryMode = categoryMode;
        clearDraft("cw-service-create");
        setEditingId("");
        setForm({ ...emptyForm, category: keepCategory, jobType: form.jobType, pricingType: form.pricingType, pricingTiers: form.pricingTiers.map((t) => ({ vehicleType: t.vehicleType, price: "" })) });
        setCategoryMode(keepCategoryMode);
        toast.success("Service saved — add the next one");
      } else {
        closeModal();
        toast.success("Service saved");
      }
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
          <button type="button" onClick={() => refetch()} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
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
      <form onSubmit={applyFilters} className="mb-2 flex-shrink-0 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 md:grid-cols-[1fr_220px_auto_auto]">
        <input
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          placeholder="Search service / category"
          value={filters.search}
          onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
        />
        <AppSelect
          size="sm"
          clearable
          placeholder="All status"
          value={filters.status}
          onChange={(v) => setFilters((p) => ({ ...p, status: v ?? "" }))}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
        />
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch /> Search
        </button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]">
          <FaRedoAlt /> Reset
        </button>
      </form>

      <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
        <div className="flex-shrink-0 flex flex-wrap min-h-8 items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{rows.length}</strong> / {pagination.total}</span>
          <span>Page: <strong className="text-[#0B3B2E]">{pagination.page}</strong> / {pagination.pages}</span>
          <span>Active: <strong className="text-[#0B3B2E]">{rowStats.active}</strong></span>
          <span>Inactive: <strong className="text-[#FF8C00]">{rowStats.inactive}</strong></span>
        </div>
        {/* Mobile card list */}
        <div className="sm:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-200">
          {rows.length ? rows.map((row) => {
            const tiers = Array.isArray(row.pricingTiers) ? row.pricingTiers : [];
            const expanded = expandedIds.includes(row._id);
            return (
              <div key={row._id} className="p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-extrabold text-slate-900">{row.name}</p>
                      {row.isCombo && <span className="inline-flex border border-purple-300 bg-purple-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-purple-700">Combo</span>}
                    </div>
                    {row.category && <p className="text-xs text-slate-500">{row.category}</p>}
                  </div>
                  <span className={`inline-flex border px-2 py-0.5 text-[11px] font-bold uppercase ${row.active === false ? "border-orange-200 bg-orange-50 text-orange-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                    {row.active === false ? "Inactive" : "Active"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  {row.pricingType === "per_sqft" ? (
                    <span className="inline-flex border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">KES {row.defaultPrice}/sqft</span>
                  ) : tiers.length > 0 ? (
                    <span className="inline-flex border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">{tiers.length} vehicle type{tiers.length !== 1 ? "s" : ""}</span>
                  ) : (
                    <span className="font-extrabold text-slate-900">{formatMoney(row.defaultPrice)}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {tiers.length > 0 && (
                    <button type="button" onClick={() => toggleExpanded(row._id)} className="inline-flex items-center gap-1 border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                      {expanded ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />} Tiers
                    </button>
                  )}
                  {canManage && (
                    <button type="button" onClick={() => openDuplicate(row)} title="Duplicate this service" className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-50">
                      <FaCopy size={9} /> Duplicate
                    </button>
                  )}
                  {canManage && (
                    <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                      <FaEdit /> Edit
                    </button>
                  )}
                </div>
                {expanded && tiers.length > 0 && (
                  <div className="rounded border border-slate-200 bg-slate-50 divide-y divide-slate-200">
                    {tiers.map((t, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <span className="font-semibold text-slate-700">{t.vehicleType}</span>
                        <span className="font-extrabold text-slate-900">{formatMoney(t.price)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-1.5 text-xs border-t-2 border-slate-300 bg-white">
                      <span className="text-[10px] font-bold uppercase text-slate-500">Default / Other</span>
                      <span className="font-extrabold text-slate-700">{formatMoney(row.defaultPrice)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          }) : (
            <p className="px-3 py-10 text-center text-xs font-semibold text-slate-500">No Car Wash services found.</p>
          )}
        </div>
        <div className="hidden sm:flex sm:flex-col sm:flex-1 sm:min-h-0 sm:overflow-hidden">
        <div className="flex-1 overflow-y-auto overflow-x-auto">
        <table className="w-full min-w-[800px] text-xs">
          <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
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
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold text-slate-900">{row.name}</span>
                          {row.isCombo && <span className="inline-flex border border-purple-300 bg-purple-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-purple-700">Combo</span>}
                        </div>
                      </td>
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
                          <div className="inline-flex items-center gap-1">
                            <button type="button" onClick={() => openDuplicate(row)} title="Duplicate" className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50">
                              <FaCopy size={9} /> Duplicate
                            </button>
                            <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                              <FaEdit /> Edit
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-slate-200 bg-[#F8FBF9]">
                        <td colSpan={7} className="px-10 py-3 text-[11px] text-slate-600">
                          {row.isCombo && row.comboDescription && (
                            <div className="mb-3 border border-purple-200 bg-purple-50 px-3 py-2">
                              <p className="text-[9px] font-black uppercase tracking-wide text-purple-500 mb-1">Includes</p>
                              <p className="text-[11px] text-purple-900 leading-relaxed">{row.comboDescription}</p>
                            </div>
                          )}
                          {tiers.length > 0 ? (
                            <div className="max-w-sm">
                              <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-400">Vehicle Type Pricing</p>
                              <table className="w-full border border-slate-200 text-xs">
                                <thead className="bg-[#0B3B2E]">
                                  <tr>
                                    <th className="px-3 py-1.5 text-left text-[10px] font-black uppercase tracking-widest text-white">Vehicle Type</th>
                                    <th className="px-3 py-1.5 text-right text-[10px] font-black uppercase tracking-widest text-white">Price</th>
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
        </div>{/* end scroll */}
        </div>{/* end desktop table */}
        <PaginationBar
          page={pagination.page}
          pages={pagination.pages}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          loading={loading}
        />
      </div>

      {showModal && (
        <Modal
          title={editingId ? "Edit Service" : "Create Service"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              {canManage && !editingId && (
                <button
                  type="submit"
                  form="carwash-service-form"
                  onClick={() => { addAnotherRef.current = true; }}
                  className="border border-[#0B3B2E] bg-white px-4 py-2 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
                >
                  Save &amp; Add Another
                </button>
              )}
              {canManage && (
                <button
                  type="submit"
                  form="carwash-service-form"
                  onClick={() => { addAnotherRef.current = false; }}
                  className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]"
                >
                  {editingId ? "Update Service" : "Save Service"}
                </button>
              )}
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
                  <AppSelect
                    size="md"
                    placeholder="— No category —"
                    value={categories.includes(form.category) ? form.category : form.category ? NEW_CATEGORY_SENTINEL : ""}
                    onChange={(v) => {
                      if (v === NEW_CATEGORY_SENTINEL) { setCategoryMode("new"); setForm((p) => ({ ...p, category: "" })); }
                      else setForm((p) => ({ ...p, category: v ?? "" }));
                    }}
                    options={[
                      ...categories.map((cat) => ({ value: cat, label: cat })),
                      { value: NEW_CATEGORY_SENTINEL, label: "+ Add new category…" },
                    ]}
                  />
                )}
              </div>

              <div>
                <AppSelect
                  size="md"
                  label="Applies To"
                  value={form.jobType}
                  onChange={(v) => setForm((p) => ({ ...p, jobType: v ?? "both" }))}
                  options={[
                    { value: "both", label: "Both (Vehicle & Carpet)" },
                    { value: "vehicle", label: "Vehicle Wash only" },
                    { value: "carpet", label: "Carpet / Textile only" },
                  ]}
                />
              </div>

              {/* Combo toggle */}
              <div className="md:col-span-2">
                <div className="border border-slate-200">
                  <div className="flex items-center gap-3 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
                    <input
                      id="svc-iscombo"
                      type="checkbox"
                      checked={form.isCombo}
                      onChange={(e) => setForm((p) => ({ ...p, isCombo: e.target.checked }))}
                      className="h-4 w-4"
                    />
                    <label htmlFor="svc-iscombo" className="text-[11px] font-extrabold uppercase tracking-wide text-[#0B3B2E] cursor-pointer select-none">
                      This is a Service Combo
                    </label>
                  </div>
                  {form.isCombo && (
                    <div className="p-3">
                      <label className={labelClass}>What's Included <span className="font-normal normal-case text-slate-400">(shown to staff when selecting this combo)</span></label>
                      <textarea
                        className="w-full border border-slate-300 px-2 py-1.5 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none resize-none"
                        rows={3}
                        value={form.comboDescription}
                        onChange={(e) => setForm((p) => ({ ...p, comboDescription: e.target.value }))}
                        placeholder="e.g. Full body wash, Vacuum, Engine wash, Wet shampoo of Seatbelt, Roof, Floor, Carpet, Mats, Interior & Exterior Polish, Tyre Shine"
                      />
                    </div>
                  )}
                </div>
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
              <div className="md:col-span-2">
                <div className="border border-slate-200">
                  <div className="flex items-center gap-3 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
                    <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#0B3B2E]">VAT / Tax Settings</p>
                  </div>
                  <div className="grid gap-3 p-3 md:grid-cols-2">
                    <div className="flex items-center gap-2">
                      <input
                        id="svc-taxable"
                        type="checkbox"
                        checked={form.isTaxable}
                        onChange={(e) => setForm((p) => ({ ...p, isTaxable: e.target.checked, taxRate: e.target.checked ? (p.taxRate || "16") : "" }))}
                        className="h-4 w-4"
                      />
                      <label htmlFor="svc-taxable" className="text-sm font-bold text-slate-700">Subject to VAT (Inclusive)</label>
                    </div>
                    {form.isTaxable && (
                      <div>
                        <label className={labelClass}>VAT Rate (%)</label>
                        <input
                          className={inputClass}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={form.taxRate}
                          onChange={(e) => setForm((p) => ({ ...p, taxRate: e.target.value }))}
                          placeholder="16"
                        />
                        <p className="mt-0.5 text-[10px] text-slate-400">VAT is inclusive — price already includes tax. VAT = price × rate/(100+rate)</p>
                      </div>
                    )}
                  </div>
                </div>
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
                  <thead className="bg-[#0B3B2E]">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Vehicle Type</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Price (KES)</th>
                      <th className="w-8 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.pricingTiers.map((tier, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="px-3 py-1.5">
                          <AppSelect
                            value={tier.vehicleType}
                            onChange={(v) => updateTier(i, "vehicleType", v ?? "")}
                            options={VEHICLE_TYPES.map((vt) => ({
                              value: vt,
                              label: usedVehicleTypes.has(vt) && vt !== tier.vehicleType ? `${vt} (already added)` : vt,
                              disabled: usedVehicleTypes.has(vt) && vt !== tier.vehicleType,
                            }))}
                            placeholder="— Select vehicle type —"
                            searchable
                            size="md"
                          />
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

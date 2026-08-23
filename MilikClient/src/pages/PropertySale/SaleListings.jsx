import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import {
  FaCamera, FaChevronLeft, FaChevronRight,
  FaEdit, FaFileImport, FaPlus, FaPrint, FaRedoAlt,
  FaTimes, FaTrash,
} from "react-icons/fa";
import SaleImportModal from "../../components/Modals/SaleImportModal";
import { parseSaleListingsExcel, downloadSaleListingsTemplate } from "../../utils/excelTemplates";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { saleApi, fmtKES, todayISO } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import AmountInput from "./AmountInput";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";
import { inputClass, labelClass } from "../../utils/formStyles";
import StatusBadge from "../../components/common/StatusBadge";
import MilikTable from "../../components/common/MilikTable";

// Normalise image URLs — strips absolute origin from legacy URLs so relative
// path proxy (/uploads/...) works in both dev and production.
const imgSrc = (url) => {
  if (!url || url.startsWith("/")) return url;
  try { return new URL(url).pathname; } catch { return url; }
};

const FALLBACK_PROPERTY_TYPES = ["plot", "house", "apartment", "commercial", "land", "other"];
const SIZE_UNITS     = ["sqm", "sqft", "acres", "hectares"];
const STATUSES       = ["available", "reserved", "under_contract", "sold", "withdrawn"];
const PAGE_SIZE      = 50;

const SIZE_UNIT_OPTIONS = SIZE_UNITS.map((u) => ({ value: u, label: u }));
const STATUS_OPTIONS    = STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }));

const LISTING_TABLE_COLS = [
  { label: "Listing No." },
  { label: "Title" },
  { label: "Type" },
  { label: "Location" },
  { label: "Asking Price", align: "right" },
  { label: "Agent" },
  { label: "Status" },
];

const LISTING_STATUS_MAP = {
  available:      "border-emerald-200 bg-emerald-50 text-emerald-700",
  reserved:       "border-amber-200 bg-amber-50 text-amber-700",
  under_contract: "border-[#B7C9C0] bg-[#F1F6F3] text-[#0B3B2E]",
  sold:           "border-slate-600 bg-slate-800 text-white",
  withdrawn:      "border-rose-200 bg-rose-50 text-rose-700",
};

const blankForm = {
  title: "", propertyType: "plot", description: "", size: "", sizeUnit: "sqm",
  location: "", town: "", county: "", country: "Kenya", askingPrice: "",
  negotiable: true, titleDeedAvailable: false, titleDeedNumber: "",
  assignedAgent: "", listedDate: todayISO(), amenities: "", notes: "",
};


const SaleListings = () => {
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const fileInputRef   = useRef(null);
  const modalFileRef   = useRef(null);

  const [saving,         setSaving]         = useState(false);
  const [showModal,      setShowModal]      = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingId,      setEditingId]      = useState("");
  const [justCreated,    setJustCreated]    = useState(false);
  const [form,           setForm]           = useState(blankForm);
  const [modalUploading, setModalUploading] = useState(false);
  const [stagedFiles,    setStagedFiles]    = useState([]); // Array<{ file: File, preview: string }>
  const [search,     setSearch]     = useTabState("/sale/listings:search", "");
  const [statusFilt, setStatusFilt] = useTabState("/sale/listings:statusFilt", "");
  const [typeFilt,   setTypeFilt]   = useTabState("/sale/listings:typeFilt", "");
  const [agentFilt,  setAgentFilt]  = useTabState("/sale/listings:agentFilt", "");
  const [page,       setPage]       = useTabState("/sale/listings:page", 1);
  const [pageSize,   setPageSize]   = useTabState("/sale/listings:pageSize", PAGE_SIZE);
  const [selected,   setSelected]   = useTabState("/sale/listings:selected", null);
  const [uploading,  setUploading]  = useState(false);
  const [lightbox,   setLightbox]   = useState({ open: false, index: 0 });

  const debouncedSearch = useDebounce(search, 400);
  const biz = currentCompany?._id;

  const { data: listingsData, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-listings", biz, debouncedSearch, statusFilt, typeFilt, agentFilt, page, pageSize],
    queryFn:  () => saleApi.listListings({ business: biz, search: debouncedSearch, status: statusFilt, propertyType: typeFilt, agentId: agentFilt, page, limit: pageSize }),
    enabled:  !!biz,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const { data: saleSettings } = useQuery({
    queryKey: ["sale-settings", biz],
    queryFn:  () => saleApi.getSettings(),
    enabled:  !!biz,
    staleTime: 10 * 60_000,
  });

  const activePropertyTypes = (saleSettings?.propertyTypes ?? []).filter((t) => t.isActive !== false);
  const PROPERTY_TYPE_OPTIONS = activePropertyTypes.length
    ? activePropertyTypes.map((t) => ({ value: t.name.toLowerCase(), label: t.name }))
    : FALLBACK_PROPERTY_TYPES.map((t) => ({ value: t, label: t }));

  const { data: agentsData } = useQuery({
    queryKey: ["sale-agents-ref", biz],
    queryFn:  () => saleApi.listAgents({ business: biz, status: "active", limit: 500 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });

  const listings   = useMemo(() => listingsData?.data ?? [], [listingsData?.data]);
  const total      = listingsData?.total ?? 0;
  const agents     = agentsData?.data ?? [];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const modalSavedImgs = useMemo(
    () => (editingId ? (listings.find((l) => l._id === editingId)?.images ?? []) : []),
    [editingId, listings],
  );

  // sync panel with fresh data after mutations
  useEffect(() => {
    if (!selected) return;
    const updated = listings.find((l) => l._id === selected._id);
    if (updated) setSelected(updated);
  }, [listings]); // eslint-disable-line react-hooks/exhaustive-deps

  // clamp/close lightbox when images are deleted while it's open
  useEffect(() => {
    if (!lightbox.open) return;
    const len = selected?.images?.length ?? 0;
    if (len === 0) setLightbox({ open: false, index: 0 });
    else if (lightbox.index >= len) setLightbox((p) => ({ ...p, index: len - 1 }));
  }, [selected?.images?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard navigation for lightbox
  const closeLightbox = useCallback(() => setLightbox({ open: false, index: 0 }), []);
  useEffect(() => {
    if (!lightbox.open) return;
    const len = selected?.images?.length ?? 0;
    const handler = (e) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft")  setLightbox((p) => ({ ...p, index: Math.max(0, p.index - 1) }));
      if (e.key === "ArrowRight") setLightbox((p) => ({ ...p, index: Math.min(len - 1, p.index + 1) }));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox.open, selected?.images?.length, closeLightbox]);

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] }),
  ]);

  const openCreate = () => {
    const firstType = PROPERTY_TYPE_OPTIONS[0]?.value ?? "plot";
    setEditingId("");
    setJustCreated(false);
    setStagedFiles([]);
    setForm({ ...blankForm, propertyType: firstType });
    setShowModal(true);
  };
  const openEdit = (row) => {
    setEditingId(row._id);
    setJustCreated(false);
    setStagedFiles([]);
    setForm({
      title: row.title || "", propertyType: row.propertyType || "plot",
      description: row.description || "", size: row.size || "",
      sizeUnit: row.sizeUnit || "sqm", location: row.location || "",
      town: row.town || "", county: row.county || "", country: row.country || "Kenya",
      askingPrice: row.askingPrice || "", negotiable: row.negotiable !== false,
      titleDeedAvailable: row.titleDeedAvailable || false,
      titleDeedNumber: row.titleDeedNumber || "",
      assignedAgent: row.assignedAgent?._id || row.assignedAgent || "",
      listedDate: row.listedDate ? new Date(row.listedDate).toISOString().split("T")[0] : todayISO(),
      amenities: Array.isArray(row.amenities) ? row.amenities.join(", ") : "",
      notes: row.notes || "",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return toast.warning("Title is required");
    if (!form.askingPrice || Number(form.askingPrice) <= 0) return toast.warning("Valid asking price is required");
    setSaving(true);
    try {
      const payload = {
        ...form, business: biz,
        askingPrice: Number(form.askingPrice),
        size: form.size ? Number(form.size) : null,
        amenities: form.amenities ? form.amenities.split(",").map((s) => s.trim()).filter(Boolean) : [],
        assignedAgent: form.assignedAgent || undefined,
      };
      if (editingId) {
        await saleApi.updateListing(editingId, payload);
        await invalidate();
        setShowModal(false);
        toast.success("Listing updated");
      } else {
        const created = await saleApi.createListing(payload);
        const newId = created?._id || "";
        // Upload any staged photos immediately
        if (stagedFiles.length && newId) {
          const fd = new FormData();
          stagedFiles.forEach(({ file }) => fd.append("images", file));
          try { await saleApi.uploadListingImages(newId, fd); } catch { /* non-fatal */ }
          stagedFiles.forEach(({ preview }) => URL.revokeObjectURL(preview));
          setStagedFiles([]);
        }
        await invalidate();
        setEditingId(newId);
        setJustCreated(true);
        toast.success("Listing saved — add more photos below or click Done");
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save listing");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!await confirm({ title: "Delete Listing", message: `Delete "${row.title}"?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      await saleApi.deleteListing(row._id);
      if (selected?._id === row._id) setSelected(null);
      await invalidate();
      toast.success("Listing deleted");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Cannot delete this listing");
    }
  };

  const handleStatusChange = async (row, status) => {
    try {
      await saleApi.updateListingStatus(row._id, status);
      await invalidate();
      toast.success(`Listing marked ${status.replace(/_/g, " ")}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update status");
    }
  };

  const handleUploadImages = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !selected) return;
    e.target.value = "";
    const invalidImages = files.filter((f) => f.size > 10 * 1024 * 1024);
    if (invalidImages.length) return toast.warning(`${invalidImages.length} file(s) exceed 10 MB and were skipped`);
    setUploading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("images", f));
      await saleApi.uploadListingImages(selected._id, fd);
      await queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] });
      toast.success(`${files.length} photo${files.length > 1 ? "s" : ""} uploaded`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImage = async (url) => {
    if (!selected || uploading) return;
    setUploading(true);
    try {
      await saleApi.deleteListingImage(selected._id, url);
      await queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] });
      toast.success("Photo removed");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to remove photo");
    } finally {
      setUploading(false);
    }
  };

  // Single handler for both Add (stage locally) and Edit (upload immediately)
  const handleModalFileChange = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const oversized = files.filter((f) => f.size > 10 * 1024 * 1024);
    if (oversized.length) toast.warning(`${oversized.length} file(s) exceed 10 MB and were skipped`);
    const valid = files.filter((f) => f.size <= 10 * 1024 * 1024);
    if (!valid.length) return;
    if (editingId) {
      setModalUploading(true);
      try {
        const fd = new FormData();
        valid.forEach((f) => fd.append("images", f));
        await saleApi.uploadListingImages(editingId, fd);
        await queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] });
        toast.success(`${valid.length} photo${valid.length > 1 ? "s" : ""} uploaded`);
      } catch (err) {
        toast.error(err?.response?.data?.message || "Upload failed");
      } finally {
        setModalUploading(false);
      }
    } else {
      setStagedFiles((prev) => [...prev, ...valid.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))]);
    }
  }, [editingId, biz, queryClient]);

  const handleModalDeleteImage = useCallback(async (url) => {
    setModalUploading(true);
    try {
      await saleApi.deleteListingImage(editingId, url);
      await queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] });
      toast.success("Photo removed");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to remove photo");
    } finally {
      setModalUploading(false);
    }
  }, [editingId, biz, queryClient]);

  const removeStagedFile = useCallback((preview) => {
    URL.revokeObjectURL(preview);
    setStagedFiles((prev) => prev.filter((f) => f.preview !== preview));
  }, []);

  const printListing = (row) => {
    const co = currentCompany || {};
    const coName = co.companyName || co.name || "MILIK";
    const coInfo = [co.phone || co.phoneNumber, co.email || co.companyEmail, co.address || co.location].filter(Boolean).join(" • ");
    const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" }) : "—";
    const statusLabel = String(row.status || "").replace(/_/g, " ").toUpperCase();
    const statusC  = { available: "#166534", reserved: "#92400e", under_contract: "#1e40af", sold: "#0f172a", withdrawn: "#9f1239" }[row.status] || "#334155";
    const statusBg = { available: "#dcfce7", reserved: "#fef3c7", under_contract: "#dbeafe", sold: "#f1f5f9", withdrawn: "#ffe4e6" }[row.status] || "#f1f5f9";
    const win = window.open("", "_blank", "width=900,height=720");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Sale Listing &ndash; ${esc(row.listingNumber)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:28px 32px;font-size:12px}
.hdr{display:grid;grid-template-columns:1fr 180px;align-items:start;border-bottom:3px solid #0B3B2E;padding-bottom:14px;margin-bottom:18px}
.co-name{font-size:18px;font-weight:900;color:#0B3B2E;margin-bottom:3px}.co-sub{font-size:9px;color:#64748b;line-height:1.5}
.doc-block{text-align:right}.doc-type{font-size:13px;font-weight:900;color:#0B3B2E;text-transform:uppercase;letter-spacing:.05em}
.doc-no{font-family:monospace;font-size:15px;font-weight:700;margin-top:3px}
.status-badge{display:inline-block;padding:3px 12px;font-size:10px;font-weight:800;margin-top:6px;background:${statusBg};color:${statusC}}
.price-box{border:2px solid #0B3B2E;padding:12px 16px;margin-bottom:16px;background:#f0faf5;display:flex;align-items:center;justify-content:space-between}
.price-label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#64748b}
.price-val{font-size:28px;font-weight:900;color:#0B3B2E;font-family:monospace}.price-note{font-size:9px;font-weight:700;color:#64748b;margin-top:3px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:14px}
.field{background:#fff;padding:9px 12px}.fl{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:2px}
.fv{font-size:11px;font-weight:600;color:#1e293b}.section-title{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#0B3B2E;margin:14px 0 6px}
.desc-box{border:1px solid #e2e8f0;padding:10px 14px;margin-bottom:14px;font-size:11px;color:#334155;line-height:1.6}
.notice{font-size:9px;color:#94a3b8;text-align:center;margin-top:20px;border-top:1px solid #f1f5f9;padding-top:10px;line-height:1.6}
@media print{body{padding:14px 16px}@page{size:A4 portrait;margin:10mm}}</style></head><body>
<div class="hdr"><div><div class="co-name">${esc(coName)}</div>${coInfo ? `<div class="co-sub">${esc(coInfo)}</div>` : ""}</div>
<div class="doc-block"><div class="doc-type">Sale Listing</div><div class="doc-no">${esc(row.listingNumber)}</div><div class="status-badge">${esc(statusLabel)}</div></div></div>
<div class="price-box"><div><div class="price-label">Asking Price</div><div class="price-val">${esc(fmtKES(row.askingPrice))}</div><div class="price-note">${row.negotiable ? "Price is negotiable" : "Fixed price – not negotiable"}</div></div>
<div style="text-align:right"><div class="price-label">Property Type</div><div style="font-size:15px;font-weight:900;color:#0f172a;text-transform:capitalize;margin-top:4px">${esc(row.propertyType)}</div></div></div>
<div class="section-title">Property Details</div><div class="grid">
<div class="field"><div class="fl">Listing No.</div><div class="fv">${esc(row.listingNumber)}</div></div>
<div class="field"><div class="fl">Title</div><div class="fv">${esc(row.title)}</div></div>
<div class="field"><div class="fl">Listed Date</div><div class="fv">${esc(fmtD(row.listedDate))}</div></div>
<div class="field"><div class="fl">Size</div><div class="fv">${row.size ? `${row.size} ${row.sizeUnit}` : "Not specified"}</div></div>
<div class="field"><div class="fl">Title Deed</div><div class="fv">${row.titleDeedAvailable ? `Yes &ndash; ${row.titleDeedNumber || "N/A"}` : "Not available"}</div></div>
<div class="field"><div class="fl">Assigned Agent</div><div class="fv">${esc(row.assignedAgent?.fullName || "Unassigned")}</div></div></div>
<div class="section-title">Location</div><div class="grid">
<div class="field"><div class="fl">Location / Address</div><div class="fv">${esc(row.location || "—")}</div></div>
<div class="field"><div class="fl">Town / City</div><div class="fv">${esc(row.town || "—")}</div></div>
<div class="field"><div class="fl">County</div><div class="fv">${esc(row.county || "—")}</div></div></div>
${row.description ? `<div class="section-title">Description</div><div class="desc-box">${esc(row.description)}</div>` : ""}
${row.amenities?.length ? `<div class="section-title">Amenities</div><div class="desc-box">${row.amenities.map(esc).join(" &bull; ")}</div>` : ""}
<div class="notice">Official property sale listing issued by ${esc(coName)} &bull; Printed: ${new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" })} &bull; All prices in KES</div>
</body></html>`);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 400);
  };

  const resetFilters = () => { setSearch(""); setStatusFilt(""); setTypeFilt(""); setAgentFilt(""); setPage(1); };

  return (
    <PropertySaleShell>
      {/* Filter bar */}
      <SaleFilterBar
        leading={<span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{total} listing{total !== 1 ? "s" : ""}</span>}
        onReset={resetFilters}
        activeCount={[search, statusFilt, typeFilt, agentFilt].filter(Boolean).length}
        trailing={
          <>
            <button
              type="button"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] })}
              className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
            >
              <FaRedoAlt size={9} className={isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
            >
              <FaFileImport size={9} /> Import
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
            >
              <FaPlus size={9} /> New Listing
            </button>
          </>
        }
      >
        <FilterSearch
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search listings..."
        />
        <AppSelect value={statusFilt} onChange={(v) => { setStatusFilt(v ?? ""); setPage(1); }} options={STATUS_OPTIONS} placeholder="All Statuses" clearable size="sm" />
        <AppSelect value={typeFilt} onChange={(v) => { setTypeFilt(v ?? ""); setPage(1); }} options={PROPERTY_TYPE_OPTIONS} placeholder="All Types" clearable size="sm" />
        <AppSelect value={agentFilt} onChange={(v) => { setAgentFilt(v ?? ""); setPage(1); }} options={agents.map((a) => ({ value: a._id, label: a.fullName }))} placeholder="All Agents" clearable size="sm" searchable />
      </SaleFilterBar>

      {/* Table + images panel */}
      <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className={`flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm transition-[margin] duration-200 ${selected ? "mr-[360px]" : ""}`}>
          <MilikTable
            columns={LISTING_TABLE_COLS}
            rows={listings}
            loading={loading}
            empty="No listings found. Create your first listing."
            minWidth={720}
            onRowClick={(row) => setSelected(selected?._id === row._id ? null : row)}
            isSelected={(row) => selected?._id === row._id}
            renderRow={(row) => (
              <>
                <td className="px-3 py-1.5 font-mono font-bold text-[#0B3B2E] border-r border-gray-100">{row.listingNumber}</td>
                <td className="px-3 py-1.5 border-r border-gray-100">
                  <div className="flex items-center gap-1.5 max-w-[200px]">
                    <span className="truncate font-semibold text-slate-900">{row.title}</span>
                    {row.images?.length > 0 && (
                      <span className="flex-shrink-0 inline-flex items-center gap-0.5 border border-[#B7C9C0] bg-[#F1F6F3] px-1 py-0 text-[9px] font-bold text-[#0B3B2E]">
                        <FaCamera size={7} /> {row.images.length}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-1.5 border-r border-gray-100">
                  <span className="capitalize text-slate-500">{(row.propertyType || "—").replace(/_/g, " ")}</span>
                </td>
                <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600 max-w-[140px] truncate">
                  {[row.town, row.county].filter(Boolean).join(", ") || row.location || "—"}
                </td>
                <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold tabular-nums text-slate-900">{fmtKES(row.askingPrice)}</td>
                <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">
                  {row.assignedAgent?.fullName || <span className="italic text-slate-400">Unassigned</span>}
                </td>
                <td className="px-3 py-1.5">
                  <StatusBadge status={row.status} map={LISTING_STATUS_MAP} />
                </td>
              </>
            )}
            renderActions={(row) => (
              <div className="inline-flex items-center gap-1">
                <button type="button" onClick={() => printListing(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                  <FaPrint className="text-[9px]" /> Print
                </button>
                <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                  <FaEdit className="text-[9px]" /> Edit
                </button>
                {row.status === "available" && (
                  <button type="button" onClick={() => handleStatusChange(row, "reserved")} className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-100">
                    Reserve
                  </button>
                )}
                {row.status === "reserved" && (
                  <button type="button" onClick={() => handleStatusChange(row, "available")} className="border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100">
                    Release
                  </button>
                )}
                <button type="button" onClick={() => handleDelete(row)} className="border border-red-200 bg-white px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-50">
                  <FaTrash className="text-[9px]" />
                </button>
              </div>
            )}
          />

          <PaginationBar page={page} pages={totalPages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} />
        </div>

        {/* Dismiss overlay — clicking outside the panel closes it */}
        {selected && (
          <div className="absolute inset-0 z-[5]" onClick={() => setSelected(null)} />
        )}

        {/* Images Detail Panel */}
        {selected && (
          <div className="absolute right-0 top-0 bottom-0 w-full sm:w-[360px] flex flex-col bg-white border-l border-slate-200 shadow-xl z-10 overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-3 text-white">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wider text-white/60">{selected.listingNumber}</div>
                  <div className="mt-0.5 text-sm font-black leading-tight truncate">{selected.title}</div>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="flex-shrink-0 p-1 text-white/70 hover:bg-white/10"><FaTimes size={12} /></button>
              </div>
              <div className="mt-2">
                <StatusBadge status={selected.status} map={LISTING_STATUS_MAP} />
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto">

              {/* Listing summary */}
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Property Details</div>
                <div className="space-y-1.5">
                  {[
                    ["Type",    String(selected.propertyType || "").replace(/_/g, " ")],
                    ["Price",   fmtKES(selected.askingPrice)],
                    ["Size",    selected.size ? `${selected.size} ${selected.sizeUnit}` : null],
                    ["Location",[selected.town, selected.county].filter(Boolean).join(", ") || selected.location],
                    ["Agent",   selected.assignedAgent?.fullName],
                  ].filter(([, v]) => v).map(([label, val]) => (
                    <div key={label} className="flex items-baseline gap-2">
                      <span className="w-[80px] flex-shrink-0 text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</span>
                      <span className="text-xs text-slate-800 capitalize">{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Photos section */}
              <div className="px-4 py-3">
                <div className="mb-3 flex items-baseline gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Photos</span>
                  <span className="text-[10px] font-bold text-slate-500">({(selected.images || []).length})</span>
                </div>

                {(selected.images || []).length > 0 ? (
                  <div className="mb-3 grid grid-cols-2 gap-1.5">
                    {selected.images.map((url, idx) => (
                      <div
                        key={idx}
                        className="group relative aspect-[4/3] cursor-zoom-in overflow-hidden border border-slate-200 bg-slate-100"
                        onClick={() => setLightbox({ open: true, index: idx })}
                      >
                        <img
                          src={imgSrc(url)}
                          alt={`Photo ${idx + 1}`}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                        />
                        {/* dark hover overlay */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200" />
                        {/* photo index */}
                        <div className="absolute bottom-1 left-1.5 text-[9px] font-black text-white/90 opacity-0 group-hover:opacity-100 transition-opacity">
                          {idx + 1} / {selected.images.length}
                        </div>
                        {/* delete */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteImage(url); }}
                          disabled={uploading}
                          className="absolute right-1 top-1 bg-black/55 p-1 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 disabled:cursor-not-allowed transition-opacity"
                        >
                          <FaTimes size={9} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mb-3 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 bg-slate-50/60 py-10">
                    <FaCamera size={28} className="text-slate-200" />
                    <div className="text-xs font-semibold text-slate-400">No photos yet</div>
                    <div className="text-[9px] text-slate-300 text-center px-4">Upload photos to showcase this property to buyers</div>
                  </div>
                )}

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={handleUploadImages}
                />

                {/* Upload zone */}
                <div
                  className={`flex flex-col items-center justify-center gap-1.5 border-2 border-dashed py-4 transition-colors cursor-pointer ${uploading ? "border-slate-200 bg-slate-50 cursor-wait" : "border-[#B7C9C0] bg-[#F1F6F3]/60 hover:bg-[#F1F6F3] hover:border-[#0B3B2E]/30"}`}
                  onClick={() => !uploading && fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <>
                      <div className="h-5 w-5 border-2 border-[#0B3B2E] border-t-transparent rounded-full animate-spin" />
                      <div className="text-[11px] font-bold text-[#0B3B2E]">Uploading…</div>
                    </>
                  ) : (
                    <>
                      <FaCamera size={18} className="text-[#0B3B2E]/40" />
                      <div className="text-[11px] font-bold text-[#0B3B2E]">Upload Photos</div>
                      <div className="text-[9px] text-slate-400">Click to select &bull; JPEG, PNG, WebP &bull; 10 MB each</div>
                    </>
                  )}
                </div>
              </div>

            </div>

            {/* Panel footer */}
            <div className="flex-shrink-0 flex items-center justify-between gap-1 border-t border-slate-200 bg-slate-50 px-3 py-2">
              <button
                type="button"
                onClick={() => printListing(selected)}
                className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
              >
                <FaPrint size={9} /> Print
              </button>
              <button
                type="button"
                onClick={() => openEdit(selected)}
                className="inline-flex items-center gap-1 bg-[#0B3B2E] px-3 py-1 text-[11px] font-black text-white hover:bg-[#07271e]"
              >
                <FaEdit size={9} /> Edit Listing
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox.open && selected?.images?.length > 0 && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/92"
          onClick={closeLightbox}
        >
          {lightbox.index > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightbox((p) => ({ ...p, index: p.index - 1 })); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/70 hover:text-white hover:bg-white/10"
            >
              <FaChevronLeft size={22} />
            </button>
          )}
          <img
            src={imgSrc(selected.images[lightbox.index])}
            alt={`Photo ${lightbox.index + 1}`}
            className="max-h-[85vh] max-w-[calc(100vw-140px)] object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {lightbox.index < selected.images.length - 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightbox((p) => ({ ...p, index: p.index + 1 })); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/70 hover:text-white hover:bg-white/10"
            >
              <FaChevronRight size={22} />
            </button>
          )}
          <button
            type="button"
            onClick={closeLightbox}
            className="absolute right-5 top-5 p-2 text-white/70 hover:text-white hover:bg-white/10"
          >
            <FaTimes size={16} />
          </button>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/50 text-xs font-semibold tracking-widest">
            {lightbox.index + 1} / {selected.images.length}
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <Modal
          title={editingId ? "Edit Sale Listing" : "New Sale Listing"}
          extraWide
          onClose={() => {
            stagedFiles.forEach(({ preview }) => URL.revokeObjectURL(preview));
            setStagedFiles([]);
            setShowModal(false);
          }}
          footer={
            <>
              <button type="button" onClick={() => setShowModal(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                {justCreated ? "Done" : "Cancel"}
              </button>
              {!justCreated && (
                <button type="button" onClick={handleSave} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                  {saving ? "Saving…" : editingId ? "Update Listing" : "Save Listing"}
                </button>
              )}
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="md:col-span-2 xl:col-span-2">
              <label className={labelClass}>Title / Property Name</label>
              <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <AppSelect label="Property Type" value={form.propertyType} onChange={(v) => setForm((p) => ({ ...p, propertyType: v ?? "" }))} options={PROPERTY_TYPE_OPTIONS} size="md" />
            </div>
            <div>
              <label className={labelClass}>Asking Price (KES)</label>
              <AmountInput value={form.askingPrice} onChange={(v) => setForm((p) => ({ ...p, askingPrice: v }))} className={inputClass} placeholder="e.g. 8,500,000" />
            </div>
            <div>
              <label className={labelClass}>Size</label>
              <div className="flex gap-1.5">
                <input type="number" value={form.size} onChange={(e) => setForm((p) => ({ ...p, size: e.target.value }))} className="h-8 flex-1 border border-slate-200 bg-white px-3 text-xs focus:border-[#0B3B2E] focus:outline-none" placeholder="e.g. 50" />
                <AppSelect value={form.sizeUnit} onChange={(v) => setForm((p) => ({ ...p, sizeUnit: v ?? "" }))} options={SIZE_UNIT_OPTIONS} size="md" />
              </div>
            </div>
            <div>
              <AppSelect label="Assigned Agent" value={form.assignedAgent} onChange={(v) => setForm((p) => ({ ...p, assignedAgent: v ?? "" }))} options={agents.map((a) => ({ value: a._id, label: `${a.fullName} (${a.agentNumber})` }))} placeholder="Unassigned" size="md" searchable clearable />
            </div>
            <div>
              <label className={labelClass}>Location / Address</label>
              <input value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Town / City</label>
              <input value={form.town} onChange={(e) => setForm((p) => ({ ...p, town: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>County</label>
              <input value={form.county} onChange={(e) => setForm((p) => ({ ...p, county: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Listed Date</label>
              <input type="date" value={form.listedDate} onChange={(e) => setForm((p) => ({ ...p, listedDate: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Title Deed No.</label>
              <input value={form.titleDeedNumber} onChange={(e) => setForm((p) => ({ ...p, titleDeedNumber: e.target.value }))} className={inputClass} />
            </div>
            <div className="flex items-center gap-4 pt-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={form.negotiable} onChange={(e) => setForm((p) => ({ ...p, negotiable: e.target.checked }))} className="accent-[#0B3B2E]" />
                <span className="text-xs font-semibold text-slate-700">Negotiable</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={form.titleDeedAvailable} onChange={(e) => setForm((p) => ({ ...p, titleDeedAvailable: e.target.checked }))} className="accent-[#0B3B2E]" />
                <span className="text-xs font-semibold text-slate-700">Title Deed Available</span>
              </label>
            </div>
            <div className="md:col-span-2 xl:col-span-3">
              <label className={labelClass}>Amenities (comma-separated)</label>
              <input value={form.amenities} onChange={(e) => setForm((p) => ({ ...p, amenities: e.target.value }))} className={inputClass} placeholder="Borehole, Power, Road access…" />
            </div>
            <div className="md:col-span-2 xl:col-span-3">
              <label className={labelClass}>Description</label>
              <textarea rows={3} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
            </div>
            <div className="md:col-span-2 xl:col-span-3">
              <label className={labelClass}>Internal Notes</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
            </div>
            {/* ── Photos section — shown for both Add and Edit ── */}
            <div className="md:col-span-2 xl:col-span-3">
              {justCreated && (
                <div className="mb-2 flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
                  ✓ Listing saved — add more photos below (optional), then click Done.
                </div>
              )}
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelClass}>Photos</label>
                <button
                  type="button"
                  onClick={() => modalFileRef.current?.click()}
                  disabled={modalUploading}
                  className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50"
                >
                  <FaCamera size={9} /> {modalUploading ? "Uploading…" : "Add Photos"}
                </button>
                <input ref={modalFileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleModalFileChange} />
              </div>
              {(modalSavedImgs.length > 0 || stagedFiles.length > 0) ? (
                <div className="flex flex-wrap gap-2">
                  {modalSavedImgs.map((url) => (
                    <div key={url} className="group relative h-20 w-20 shrink-0">
                      <img src={imgSrc(url)} alt="" className="h-full w-full object-cover border border-slate-200" />
                      <button type="button" onClick={() => handleModalDeleteImage(url)} disabled={modalUploading}
                        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 disabled:cursor-not-allowed transition-opacity">
                        <FaTimes size={7} />
                      </button>
                    </div>
                  ))}
                  {stagedFiles.map(({ file, preview }) => (
                    <div key={preview} className="group relative h-20 w-20 shrink-0">
                      <img src={preview} alt={file.name} className="h-full w-full object-cover border border-slate-200 opacity-80" />
                      <div className="absolute inset-0 flex items-end justify-center pb-1">
                        <span className="bg-black/50 px-1 text-[8px] text-white">pending</span>
                      </div>
                      <button type="button" onClick={() => removeStagedFile(preview)}
                        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-opacity">
                        <FaTimes size={7} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 border border-dashed border-slate-200 px-3 py-2 bg-slate-50">
                  {editingId ? "No photos yet — click Add Photos to upload" : "Optional — select photos now and they will upload when you save"}
                </p>
              )}
            </div>
          </div>
        </Modal>
      )}

      <SaleImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        title="Import Sale Listings"
        entityName="listing"
        parseFile={parseSaleListingsExcel}
        downloadTemplate={downloadSaleListingsTemplate}
        onImport={async (rows) => {
          const res = await saleApi.bulkImportListings(rows);
          await queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] });
          return res;
        }}
        previewCols={[
          { header: "Title",        render: (r) => <span className="font-semibold">{r.title}</span> },
          { header: "Type",         render: (r) => r.propertyType },
          { header: "Location",     render: (r) => [r.town, r.county].filter(Boolean).join(", ") || "—" },
          { header: "Asking Price", render: (r) => <span className="font-mono">{Number(r.askingPrice).toLocaleString()}</span> },
          { header: "Status",       render: (r) => r.status },
        ]}
      />
    </PropertySaleShell>
  );
};

export default SaleListings;

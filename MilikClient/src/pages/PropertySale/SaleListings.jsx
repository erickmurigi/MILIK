import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import {
  FaCamera, FaChevronLeft, FaChevronRight,
  FaEdit, FaFileImport, FaPlus, FaPrint, FaRedoAlt,
  FaTimes, FaTrash,
} from "react-icons/fa";
import ImportModal from "../../components/Modals/ImportModal";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTerms } from "../../hooks/useTerm";
import { useTabState } from "../../hooks/useTabState";
import AmountInput from "./AmountInput";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";
import StatusBadge from "../../components/common/StatusBadge";
import MilikTable from "../../components/common/MilikTable";
import SaleListingFormModal from "./SaleListingFormModal";
import SalePhotoGallery from "./SalePhotoGallery";
import SaleListingAgent from "./SaleListingAgent";
import { listingAgentText } from "../../utils/saleAgent";
import { blankListingForm, listingFormFromRow } from "../../utils/saleListingForm";

// Lazy-load the xlsx-backed helpers only when the Import modal is actually used.
const parseSaleListingsExcel = (file) => import("../../utils/excelTemplates").then((m) => m.parseSaleListingsExcel(file));
const downloadSaleListingsTemplate = () => import("../../utils/excelTemplates").then((m) => m.downloadSaleListingsTemplate());


const FALLBACK_PROPERTY_TYPES = ["plot", "house", "apartment", "commercial", "land", "other"];
const STATUSES       = ["available", "reserved", "under_contract", "sold", "withdrawn"];
const PAGE_SIZE      = 50;

const STATUS_OPTIONS    = STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }));

const listingTableCols = (T) => [
  { label: `${T.saleListing} No.` },
  { label: "Title" },
  { label: "Type" },
  { label: "Location" },
  { label: "Asking Price", align: "right" },
  { label: T.saleAgent },
  { label: "Status" },
];

const LISTING_STATUS_MAP = {
  available:      "border-emerald-200 bg-emerald-50 text-emerald-700",
  reserved:       "border-amber-200 bg-amber-50 text-amber-700",
  under_contract: "border-[#B7C9C0] bg-[#F1F6F3] text-[#0B3B2E]",
  sold:           "border-slate-600 bg-slate-800 text-white",
  withdrawn:      "border-rose-200 bg-rose-50 text-rose-700",
};


// Module scope so MilikTable's React.memo isn't defeated by a fresh function identity each parent render.
const renderListingRow = (row) => (
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
      <SaleListingAgent row={row} />
    </td>
    <td className="px-3 py-1.5">
      <StatusBadge status={row.status} map={LISTING_STATUS_MAP} />
    </td>
  </>
);


const SaleListings = () => {
  const T = useTerms("saleListing", "saleListings", "saleAgent", "saleAgents", "saleUnits", "saleProject");
  const LISTING_TABLE_COLS = useMemo(() => listingTableCols(T), [T]);
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);

  const [listingModal,   setListingModal]   = useState(null);   // { editingId, initial } while the create/edit modal is open
  const [showImportModal, setShowImportModal] = useState(false);
  const [search,     setSearch]     = useTabState("/sale/listings:search", "");
  const [statusFilt, setStatusFilt] = useTabState("/sale/listings:statusFilt", "");
  const [typeFilt,   setTypeFilt]   = useTabState("/sale/listings:typeFilt", "");
  const [agentFilt,  setAgentFilt]  = useTabState("/sale/listings:agentFilt", "");
  const [page,       setPage]       = useTabState("/sale/listings:page", 1);
  const [pageSize,   setPageSize]   = useTabState("/sale/listings:pageSize", PAGE_SIZE);
  const [selected,   setSelected]   = useTabState("/sale/listings:selected", null);
  const [uploading,  setUploading]  = useState(false);
  const [statusBusy, setStatusBusy] = useState({}); // { [listingId]: true } while a Reserve/Release call is in flight
  const statusInFlight = useRef(new Set());

  const debouncedSearch = useDebounce(search, 400);
  const biz = currentCompany?._id;

  const { data: saleSettings, isPending: settingsPending } = useQuery({
    queryKey: ["sale-settings", biz],
    queryFn:  () => saleApi.getSettings(),
    enabled:  !!biz,
    staleTime: 10 * 60_000,
  });

  // When the company sells in projects, items that belong to a project are listed on the units page instead
  const standaloneOnly = !!saleSettings?.useProjects;

  // Wait for the settings so a company that sells in projects never briefly sees its units in this list
  const { data: listingsData, isLoading: listingsLoading, isFetching } = useQuery({
    queryKey: ["sale-listings", biz, debouncedSearch, statusFilt, typeFilt, agentFilt, page, pageSize, standaloneOnly],
    queryFn:  () => saleApi.listListings({ business: biz, search: debouncedSearch, status: statusFilt, propertyType: typeFilt, agentId: agentFilt, page, limit: pageSize, ...(standaloneOnly && { project: "none" }) }),
    enabled:  !!biz && !settingsPending,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  const loading = listingsLoading || settingsPending;

  const activePropertyTypes = useMemo(() => (saleSettings?.propertyTypes ?? []).filter((t) => t.isActive !== false), [saleSettings]);
  const PROPERTY_TYPE_OPTIONS = useMemo(() => activePropertyTypes.length
    ? activePropertyTypes.map((t) => ({ value: t.name.toLowerCase(), label: t.name }))
    : FALLBACK_PROPERTY_TYPES.map((t) => ({ value: t, label: t })), [activePropertyTypes]);

  const { data: agentsData } = useQuery({
    queryKey: ["sale-agents-ref", biz, "active"],
    queryFn:  () => saleApi.listAgents({ business: biz, status: "active", limit: 200 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });

  const listings   = useMemo(() => listingsData?.data ?? [], [listingsData?.data]);
  const total      = listingsData?.total ?? 0;
  const agents     = useMemo(() => agentsData?.data ?? [], [agentsData]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const agentFilterOptions = useMemo(() => agents.map((a) => ({ value: a._id, label: a.fullName })), [agents]);
  const agentFormOptions   = useMemo(() => agents.map((a) => ({ value: a._id, label: `${a.fullName} (${a.agentNumber})` })), [agents]);

  // sync panel with fresh data after mutations
  useEffect(() => {
    if (!selected) return;
    const updated = listings.find((l) => l._id === selected._id);
    if (updated) setSelected(updated);
  }, [listings]); // eslint-disable-line react-hooks/exhaustive-deps


  const invalidate = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-listings-ref", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] }),
  ]), [queryClient, biz]);

  const openCreate = () => {
    const firstType = PROPERTY_TYPE_OPTIONS[0]?.value ?? "plot";
    setListingModal({ editingId: "", initial: blankListingForm(firstType) });
  };
  const openEdit = useCallback((row) => {
    setListingModal({ editingId: row._id, initial: listingFormFromRow(row), project: row.project || null });
  }, []);

  const handleDelete = useCallback(async (row) => {
    if (!await confirm({ title: `Delete ${T.saleListing}`, message: `Delete "${row.title}"?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      await saleApi.deleteListing(row._id);
      setSelected((prev) => (prev?._id === row._id ? null : prev));
      await invalidate();
      toast.success(`${T.saleListing} deleted`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Cannot delete this listing");
    }
  }, [confirm, invalidate, setSelected, T.saleListing]);

  const handleStatusChange = useCallback(async (row, status) => {
    if (statusInFlight.current.has(row._id)) return;
    statusInFlight.current.add(row._id);
    setStatusBusy((m) => ({ ...m, [row._id]: true }));
    try {
      await saleApi.updateListingStatus(row._id, status);
      await invalidate();
      toast.success(`${T.saleListing} marked ${status.replace(/_/g, " ")}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update status");
    } finally {
      statusInFlight.current.delete(row._id);
      setStatusBusy((m) => { const { [row._id]: _done, ...rest } = m; return rest; });
    }
  }, [invalidate, T.saleListing]);

  const handleUploadFiles = async (files) => {
    if (!files.length || !selected) return;
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

  const printListing = useCallback((row) => {
    const co = currentCompany || {};
    const coName = co.companyName || co.name || "MILIK";
    const coInfo = [co.phone || co.phoneNumber, co.email || co.companyEmail, co.address || co.location].filter(Boolean).join(" • ");
    const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" }) : "—";
    const statusLabel = String(row.status || "").replace(/_/g, " ").toUpperCase();
    const statusC  = { available: "#166534", reserved: "#92400e", under_contract: "#1e40af", sold: "#0f172a", withdrawn: "#9f1239" }[row.status] || "#334155";
    const statusBg = { available: "#dcfce7", reserved: "#fef3c7", under_contract: "#dbeafe", sold: "#f1f5f9", withdrawn: "#ffe4e6" }[row.status] || "#f1f5f9";
    const win = window.open("", "_blank", "width=900,height=720");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${esc(T.saleListing)} &ndash; ${esc(row.listingNumber)}</title>
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
<div class="doc-block"><div class="doc-type">${esc(T.saleListing)}</div><div class="doc-no">${esc(row.listingNumber)}</div><div class="status-badge">${esc(statusLabel)}</div></div></div>
<div class="price-box"><div><div class="price-label">Asking Price</div><div class="price-val">${esc(fmtKES(row.askingPrice))}</div><div class="price-note">${row.negotiable ? "Price is negotiable" : "Fixed price – not negotiable"}</div></div>
<div style="text-align:right"><div class="price-label">Property Type</div><div style="font-size:15px;font-weight:900;color:#0f172a;text-transform:capitalize;margin-top:4px">${esc(row.propertyType)}</div></div></div>
<div class="section-title">Property Details</div><div class="grid">
<div class="field"><div class="fl">${esc(T.saleListing)} No.</div><div class="fv">${esc(row.listingNumber)}</div></div>
<div class="field"><div class="fl">Title</div><div class="fv">${esc(row.title)}</div></div>
<div class="field"><div class="fl">Listed Date</div><div class="fv">${esc(fmtD(row.listedDate))}</div></div>
<div class="field"><div class="fl">Size</div><div class="fv">${row.size ? esc(`${row.size} ${row.sizeUnit ?? ""}`.trim()) : "Not specified"}</div></div>
<div class="field"><div class="fl">Title Deed</div><div class="fv">${row.titleDeedAvailable ? `Yes &ndash; ${esc(row.titleDeedNumber || "N/A")}` : "Not available"}</div></div>
<div class="field"><div class="fl">Assigned ${esc(T.saleAgent)}</div><div class="fv">${esc(listingAgentText(row, T.saleProject.toLowerCase()) || "Unassigned")}</div></div></div>
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
  }, [currentCompany, T.saleListing, T.saleAgent, T.saleProject]);

  const handleRowClick = useCallback((row) => setSelected((prev) => (prev?._id === row._id ? null : row)), [setSelected]);
  const selectedId = selected?._id;
  const isRowSelected = useCallback((row) => selectedId === row._id, [selectedId]);

  const renderListingActions = useCallback((row) => (
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={() => printListing(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
        <FaPrint className="text-[9px]" /> Print
      </button>
      <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
        <FaEdit className="text-[9px]" /> Edit
      </button>
      {row.status === "available" && (
        <button type="button" disabled={!!statusBusy[row._id]} onClick={() => handleStatusChange(row, "reserved")} className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed">
          Reserve
        </button>
      )}
      {row.status === "reserved" && (
        <button type="button" disabled={!!statusBusy[row._id]} onClick={() => handleStatusChange(row, "available")} className="border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed">
          Release
        </button>
      )}
      <button type="button" onClick={() => handleDelete(row)} className="border border-red-200 bg-white px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-50">
        <FaTrash className="text-[9px]" />
      </button>
    </div>
  ), [printListing, openEdit, statusBusy, handleStatusChange, handleDelete]);

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
              <FaPlus size={9} /> New {T.saleListing}
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
        <AppSelect value={agentFilt} onChange={(v) => { setAgentFilt(v ?? ""); setPage(1); }} options={agentFilterOptions} placeholder={`All ${T.saleAgents}`} clearable size="sm" searchable />
      </SaleFilterBar>
      {standaloneOnly && (
        <div className="shrink-0 px-1 text-[10px] text-slate-400">Items that belong to a {T.saleProject.toLowerCase()} are listed under {T.saleUnits}.</div>
      )}

      {/* Table + images panel */}
      <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className={`flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm transition-[margin] duration-200 ${selected ? "mr-[360px]" : ""}`}>
          <MilikTable
            columns={LISTING_TABLE_COLS}
            rows={listings}
            loading={loading}
            empty="No listings found. Create your first listing."
            minWidth={720}
            onRowClick={handleRowClick}
            isSelected={isRowSelected}
            renderRow={renderListingRow}
            renderActions={renderListingActions}
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
                    [T.saleAgent,   listingAgentText(selected, T.saleProject.toLowerCase())],
                  ].filter(([, v]) => v).map(([label, val]) => (
                    <div key={label} className="flex items-baseline gap-2">
                      <span className="w-[80px] flex-shrink-0 text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</span>
                      <span className="text-xs text-slate-800 capitalize">{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              <SalePhotoGallery
                images={selected.images || []}
                busy={uploading}
                onUpload={handleUploadFiles}
                onDelete={handleDeleteImage}
                emptyHint="Upload photos to showcase this property to buyers"
              />

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
                <FaEdit size={9} /> Edit {T.saleListing}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {listingModal && (
        <SaleListingFormModal
          project={listingModal.project || null}
          initialEditingId={listingModal.editingId}
          initialForm={listingModal.initial}
          listings={listings}
          biz={biz}
          propertyTypeOptions={PROPERTY_TYPE_OPTIONS}
          agentFormOptions={agentFormOptions}
          invalidate={invalidate}
          onClose={() => setListingModal(null)}
        />
      )}

      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        title={`Import ${T.saleListings}`}
        entityName="listing"
        parseFile={parseSaleListingsExcel}
        downloadTemplate={downloadSaleListingsTemplate}
        onImport={async (rows) => {
          const res = await saleApi.bulkImportListings(rows);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] }),
            queryClient.invalidateQueries({ queryKey: ["sale-listings-ref", biz] }),
          ]);
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

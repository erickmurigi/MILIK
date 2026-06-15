import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { FaBuilding, FaCheck, FaEdit, FaPlus, FaPrint, FaSearch, FaSquare, FaTimes, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import { saleApi, fmtKES, todayISO } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import AmountInput from "./AmountInput";

const PROPERTY_TYPES = ["plot", "house", "apartment", "commercial", "land", "other"];
const SIZE_UNITS = ["sqm", "sqft", "acres", "hectares"];
const STATUSES = ["available", "reserved", "under_contract", "sold", "withdrawn"];
const ITEMS_PER_PAGE = 50;

const statusColors = {
  available: "bg-emerald-100 text-emerald-700 border-emerald-200",
  reserved: "bg-amber-100 text-amber-700 border-amber-200",
  under_contract: "bg-blue-100 text-blue-700 border-blue-200",
  sold: "bg-slate-800 text-white border-slate-700",
  withdrawn: "bg-rose-100 text-rose-700 border-rose-200",
};

const blankForm = {
  title: "", propertyType: "plot", description: "", size: "", sizeUnit: "sqm",
  location: "", town: "", county: "", country: "Kenya", askingPrice: "",
  negotiable: true, titleDeedAvailable: false, titleDeedNumber: "",
  assignedAgent: "", listedDate: todayISO(), amenities: "", notes: "",
};

const SaleListings = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(blankForm);
  const [filters, setFilters] = useState({ search: "", status: "", propertyType: "" });
  const debouncedSearch = useDebounce(filters.search, 400);
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(1);

  const biz = currentCompany?._id;

  const { data: listingsData, isLoading: loading, error } = useQuery({
    queryKey: ["sale-listings", biz, debouncedSearch, filters.status, filters.propertyType, page],
    queryFn: () => saleApi.listListings({ business: biz, ...filters, search: debouncedSearch, page, limit: ITEMS_PER_PAGE }),
    enabled: !!biz,
    placeholderData: (prev) => prev,
  });

  const { data: agentsData } = useQuery({
    queryKey: ["sale-agents-ref", biz],
    queryFn: () => saleApi.listAgents({ business: biz, status: "active", limit: 500 }),
    enabled: !!biz,
    staleTime: 5 * 60_000,
  });

  useEffect(() => { if (error) toast.error("Failed to load listings"); }, [error]);
  useEffect(() => setPage(1), [debouncedSearch, filters.status, filters.propertyType]);

  const listings = listingsData?.data ?? [];
  const serverTotal = listingsData?.total ?? 0;
  const backendStats = listingsData?.stats ?? null;
  const agents = agentsData?.data ?? [];
  const totalPages = Math.max(1, Math.ceil(serverTotal / ITEMS_PER_PAGE));
  const safePage = page;
  const pageRows = listings;
  const filtered = listings;

  const stats = useMemo(() => ({
    total: serverTotal,
    available: backendStats?.available?.count ?? listings.filter((l) => l.status === "available").length,
    sold: backendStats?.sold?.count ?? listings.filter((l) => l.status === "sold").length,
    totalValue: (backendStats?.available?.totalValue ?? 0) + (backendStats?.reserved?.totalValue ?? 0) + (backendStats?.under_contract?.totalValue ?? 0),
  }), [listings, serverTotal, backendStats]);

  const openCreate = () => { setEditingId(""); setForm(blankForm); setShowModal(true); };
  const openEdit = (row) => {
    setEditingId(row._id);
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
        ...form,
        business: biz,
        askingPrice: Number(form.askingPrice),
        size: form.size ? Number(form.size) : null,
        amenities: form.amenities ? form.amenities.split(",").map((s) => s.trim()).filter(Boolean) : [],
        assignedAgent: form.assignedAgent || undefined,
      };
      if (editingId) await saleApi.updateListing(editingId, payload);
      else await saleApi.createListing(payload);
      await queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] });
      setShowModal(false);
      toast.success(`Listing ${editingId ? "updated" : "created"} successfully`);
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
      await queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] });
      toast.success("Listing deleted");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Cannot delete this listing");
    }
  };

  const handleStatusChange = async (row, status) => {
    try {
      await saleApi.updateListingStatus(row._id, status);
      await queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] });
      toast.success(`Listing marked ${status}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update status");
    }
  };

  const printListing = (row) => {
    const co = currentCompany || {};
    const coName = co.companyName || co.name || "MILIK";
    const coInfo = [co.phone || co.phoneNumber, co.email || co.companyEmail, co.address || co.location].filter(Boolean).join(" • ");
    const logoHtml = co.logo
      ? `<img src="${co.logo}" alt="logo" style="width:72px;height:72px;object-fit:contain;border-radius:10px;border:1px solid #cbd5e1;" />`
      : `<div style="width:72px;height:72px;background:#027333;color:#fff;font-size:26px;font-weight:900;display:flex;align-items:center;justify-content:center;border-radius:10px;">${coName.slice(0,1).toUpperCase()}</div>`;
    const esc = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"}) : "—";
    const statusLabel = String(row.status || "").replace(/_/g, " ").toUpperCase();
    const statusC = { available:"#166534", reserved:"#92400e", under_contract:"#1e40af", sold:"#0f172a", withdrawn:"#9f1239" }[row.status] || "#334155";
    const statusBg = { available:"#dcfce7", reserved:"#fef3c7", under_contract:"#dbeafe", sold:"#f1f5f9", withdrawn:"#ffe4e6" }[row.status] || "#f1f5f9";
    const printedOn = new Date().toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"});

    const field = (label, value) => `<div class="field"><div class="fl">${esc(label)}</div><div class="fv">${esc(value || "—")}</div></div>`;

    const win = window.open("", "_blank", "width=900,height=720");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Sale Listing — ${esc(row.listingNumber)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:28px 32px;font-size:12px}
.hdr{display:grid;grid-template-columns:80px 1fr 170px;align-items:start;border-bottom:3px solid #027333;padding-bottom:14px;margin-bottom:18px;gap:12px}
.co-name{font-size:18px;font-weight:900;color:#027333;margin-bottom:3px}
.co-sub{font-size:9px;color:#64748b;line-height:1.5}
.doc-block{text-align:right}
.doc-type{font-size:13px;font-weight:900;color:#027333;text-transform:uppercase;letter-spacing:.05em}
.doc-no{font-family:monospace;font-size:15px;font-weight:700;margin-top:3px}
.status-badge{display:inline-block;padding:3px 12px;border-radius:999px;font-size:10px;font-weight:800;margin-top:6px;background:${statusBg};color:${statusC}}
.price-box{border:2px solid #027333;border-radius:8px;padding:12px 16px;margin-bottom:16px;background:#f0faf5;display:flex;align-items:center;justify-content:space-between}
.price-label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#64748b}
.price-val{font-size:28px;font-weight:900;color:#027333;font-family:monospace}
.price-note{font-size:9px;font-weight:700;color:#64748b;margin-top:3px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:14px}
.field{background:#fff;padding:9px 12px}
.fl{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:2px}
.fv{font-size:11px;font-weight:600;color:#1e293b}
.section-title{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#027333;margin:14px 0 6px}
.desc-box{border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:11px;color:#334155;line-height:1.6}
.notice{font-size:9px;color:#94a3b8;text-align:center;margin-top:20px;border-top:1px solid #f1f5f9;padding-top:10px;line-height:1.6}
@media print{body{padding:14px 16px}@page{size:A4 portrait;margin:10mm}}
</style></head><body>
<div class="hdr">
  <div>${logoHtml}</div>
  <div><div class="co-name">${esc(coName)}</div>${coInfo?`<div class="co-sub">${esc(coInfo)}</div>`:""}</div>
  <div class="doc-block">
    <div class="doc-type">Sale Listing</div>
    <div class="doc-no">${esc(row.listingNumber)}</div>
    <div class="status-badge">${esc(statusLabel)}</div>
  </div>
</div>

<div class="price-box">
  <div><div class="price-label">Asking Price</div><div class="price-val">${esc(fmtKES(row.askingPrice))}</div><div class="price-note">${row.negotiable?"Price is negotiable":"Fixed price — not negotiable"}</div></div>
  <div style="text-align:right"><div class="price-label">Property Type</div><div style="font-size:15px;font-weight:900;color:#0f172a;text-transform:capitalize;margin-top:4px">${esc(row.propertyType)}</div></div>
</div>

<div class="section-title">Property Details</div>
<div class="grid">
  ${field("Listing No.", row.listingNumber)}
  ${field("Title", row.title)}
  ${field("Listed Date", fmtD(row.listedDate))}
  ${field("Size", row.size ? `${row.size} ${row.sizeUnit}` : "Not specified")}
  ${field("Title Deed", row.titleDeedAvailable ? `Yes — ${row.titleDeedNumber || "Number N/A"}` : "Not available")}
  ${field("Assigned Agent", row.assignedAgent?.fullName || "Unassigned")}
</div>

<div class="section-title">Location</div>
<div class="grid">
  ${field("Location / Address", row.location)}
  ${field("Town / City", row.town)}
  ${field("County", row.county)}
  ${field("Country", row.country || "Kenya")}
</div>

${row.description?`<div class="section-title">Description</div><div class="desc-box">${esc(row.description)}</div>`:""}
${row.amenities?.length?`<div class="section-title">Amenities</div><div class="desc-box">${row.amenities.map(esc).join(" • ")}</div>`:""}
${row.notes?`<div class="section-title">Notes</div><div class="desc-box">${esc(row.notes)}</div>`:""}

<div class="notice">Official property sale listing issued by ${esc(coName)} • Printed: ${esc(printedOn)} • All prices in KES unless otherwise stated</div>
</body></html>`);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 400);
  };

  const toggleSelect = (id) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const toggleAll = () => setSelectedIds((p) => p.length === filtered.length ? [] : filtered.map((r) => r._id));

  const f = (key, val) => setFilters((p) => ({ ...p, [key]: val }));

  return (
    <PropertySaleShell
      title="Sale Listings"
      subtitle={`${stats.total} listing(s)`}
      action={<button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-[#027333] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0c5d2b]"><FaPlus /> New Listing</button>}
    >
      <div className="flex h-full flex-col gap-2">
        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Total", value: stats.total, cls: "bg-slate-900 text-white" },
            { label: "Available", value: stats.available, cls: "bg-emerald-50 border border-emerald-200 text-emerald-800" },
            { label: "Sold", value: stats.sold, cls: "bg-slate-100 border border-slate-200 text-slate-700" },
            { label: "Total Value", value: fmtKES(stats.totalValue), cls: "bg-[#027333] text-white" },
          ].map((c) => (
            <div key={c.label} className={`rounded-lg px-3 py-2 ${c.cls}`}>
              <div className="text-[10px] font-black uppercase tracking-wider opacity-70">{c.label}</div>
              <div className="mt-0.5 text-sm font-black">{c.value}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="relative flex-1 min-w-[180px]">
            <FaSearch className="absolute left-3 top-2.5 text-[10px] text-slate-400" />
            <input value={filters.search} onChange={(e) => f("search", e.target.value)} placeholder="Search listings..." className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs focus:border-[#027333] focus:outline-none focus:ring-1 focus:ring-[#027333]" />
          </div>
          <select value={filters.status} onChange={(e) => f("status", e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs focus:border-[#027333] focus:outline-none">
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <select value={filters.propertyType} onChange={(e) => f("propertyType", e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs focus:border-[#027333] focus:outline-none">
            <option value="">All Types</option>
            {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={() => setFilters({ search: "", status: "", propertyType: "" })} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-600 hover:bg-slate-100">Reset</button>
        </div>

        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10 bg-[#027333] text-white">
                <tr>
                  <th className="px-3 py-2.5 text-left"><button onClick={toggleAll}>{selectedIds.length === filtered.length && filtered.length > 0 ? <FaCheck className="text-xs" /> : <FaSquare className="text-xs opacity-60" />}</button></th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Listing</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Type</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Location</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Asking Price</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Agent</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Status</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Loading listings...</td></tr>
                ) : pageRows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No listings found.</td></tr>
                ) : pageRows.map((row, i) => (
                  <tr key={row._id} className={`border-t border-slate-100 transition ${selectedIds.includes(row._id) ? "bg-emerald-50/80 shadow-[inset_4px_0_0_0_#027333]" : i % 2 === 0 ? "bg-white hover:bg-slate-50" : "bg-slate-50/60 hover:bg-slate-100/40"}`}>
                    <td className="px-3 py-2"><button onClick={() => toggleSelect(row._id)}>{selectedIds.includes(row._id) ? <FaCheck className="text-[#027333] text-xs" /> : <FaSquare className="text-xs text-slate-300" />}</button></td>
                    <td className="px-3 py-2">
                      <div className="font-black text-slate-900">{row.listingNumber}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[160px]">{row.title}</div>
                    </td>
                    <td className="px-3 py-2 capitalize text-slate-600">{row.propertyType}</td>
                    <td className="px-3 py-2 text-slate-600">{[row.town, row.county].filter(Boolean).join(", ") || row.location || "—"}</td>
                    <td className="px-3 py-2 text-right font-black text-slate-900">{fmtKES(row.askingPrice)}</td>
                    <td className="px-3 py-2 text-slate-600">{row.assignedAgent?.fullName || <span className="text-slate-400 italic">Unassigned</span>}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-black ${statusColors[row.status] || ""}`}>
                        {String(row.status || "").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        <button onClick={() => printListing(row)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50"><FaPrint /> Print</button>
                        <button onClick={() => openEdit(row)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-700"><FaEdit /> Edit</button>
                        {row.status === "available" && <button onClick={() => handleStatusChange(row, "reserved")} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold text-amber-700">Reserve</button>}
                        {row.status === "reserved" && <button onClick={() => handleStatusChange(row, "available")} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] font-bold text-slate-600">Release</button>}
                        <button onClick={() => handleDelete(row)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700"><FaTrash /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-2 text-xs text-slate-500">
            <span>Showing <strong className="text-slate-900">{serverTotal === 0 ? 0 : (safePage - 1) * ITEMS_PER_PAGE + 1}</strong>–<strong className="text-slate-900">{Math.min(safePage * ITEMS_PER_PAGE, serverTotal)}</strong> of <strong className="text-slate-900">{serverTotal}</strong></span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="rounded-lg border border-slate-200 px-3 py-1 font-semibold disabled:opacity-40">Prev</button>
              <span>Page {safePage} of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="rounded-lg border border-slate-200 px-3 py-1 font-semibold disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
          <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-[#027333] px-6 py-4 text-white">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100">Property Sale</p>
                <h3 className="text-lg font-black">{editingId ? "Edit Listing" : "New Sale Listing"}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-6 md:grid-cols-2 xl:grid-cols-3">
              <label className="block xl:col-span-2"><span className="text-xs font-bold text-slate-700">Title / Property Name</span><input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none focus:ring-2 focus:ring-[#027333]/20" /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Property Type</span><select value={form.propertyType} onChange={(e) => setForm((p) => ({ ...p, propertyType: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none focus:ring-2 focus:ring-[#027333]/20">{PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Asking Price (KES)</span><AmountInput value={form.askingPrice} onChange={(v) => setForm((p) => ({ ...p, askingPrice: v }))} placeholder="e.g. 8,500,000" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none focus:ring-2 focus:ring-[#027333]/20" /></label>
              <div className="block"><span className="text-xs font-bold text-slate-700">Size</span><div className="mt-1 flex gap-2"><input type="number" value={form.size} onChange={(e) => setForm((p) => ({ ...p, size: e.target.value }))} placeholder="e.g. 50" className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" /><select value={form.sizeUnit} onChange={(e) => setForm((p) => ({ ...p, sizeUnit: e.target.value }))} className="rounded-xl border border-slate-300 px-2 py-2 text-sm focus:border-[#027333] focus:outline-none">{SIZE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select></div></div>
              <label className="block"><span className="text-xs font-bold text-slate-700">Assigned Agent</span><select value={form.assignedAgent} onChange={(e) => setForm((p) => ({ ...p, assignedAgent: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none focus:ring-2 focus:ring-[#027333]/20"><option value="">Unassigned</option>{agents.map((a) => <option key={a._id} value={a._id}>{a.fullName} ({a.agentNumber})</option>)}</select></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Location / Address</span><input value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Town / City</span><input value={form.town} onChange={(e) => setForm((p) => ({ ...p, town: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">County</span><input value={form.county} onChange={(e) => setForm((p) => ({ ...p, county: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Listed Date</span><input type="date" value={form.listedDate} onChange={(e) => setForm((p) => ({ ...p, listedDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Title Deed No.</span><input value={form.titleDeedNumber} onChange={(e) => setForm((p) => ({ ...p, titleDeedNumber: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" /></label>
              <div className="flex items-center gap-4 pt-5">
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.negotiable} onChange={(e) => setForm((p) => ({ ...p, negotiable: e.target.checked }))} className="accent-[#027333]" /><span className="text-xs font-bold text-slate-700">Negotiable</span></label>
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.titleDeedAvailable} onChange={(e) => setForm((p) => ({ ...p, titleDeedAvailable: e.target.checked }))} className="accent-[#027333]" /><span className="text-xs font-bold text-slate-700">Title Deed Available</span></label>
              </div>
              <label className="block md:col-span-2 xl:col-span-3"><span className="text-xs font-bold text-slate-700">Amenities (comma-separated)</span><input value={form.amenities} onChange={(e) => setForm((p) => ({ ...p, amenities: e.target.value }))} placeholder="Borehole, Power, Road access, ..." className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" /></label>
              <label className="block md:col-span-2 xl:col-span-3"><span className="text-xs font-bold text-slate-700">Description</span><textarea rows={3} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" /></label>
              <label className="block md:col-span-2 xl:col-span-3"><span className="text-xs font-bold text-slate-700">Internal Notes</span><textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" /></label>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
              <button onClick={() => setShowModal(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#027333] px-4 py-2 text-sm font-black text-white hover:bg-[#0c5d2b] disabled:opacity-60">{saving ? "Saving..." : editingId ? "Update Listing" : "Save Listing"}</button>
            </div>
          </div>
        </div>
      )}
    </PropertySaleShell>
  );
};

export default SaleListings;

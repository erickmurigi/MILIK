import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { FaBan, FaCheck, FaEdit, FaFileAlt, FaPlus, FaPrint, FaRedoAlt, FaSearch, FaSms, FaTimes, FaTrash } from "react-icons/fa";
import CwSmsModal from "../CarWash/CwSmsModal";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import PaginationBar from "../../components/PaginationBar";
import { saleApi } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";

const SOURCES      = ["walk_in", "referral", "online", "agent", "other"];
const KYC_STATUSES = ["pending", "verified", "rejected"];
const PAGE_SIZE    = 50;

const kycBadge = (s) => ({
  pending:  "border-amber-200 bg-amber-50 text-amber-700",
  verified: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
}[s] || "border-slate-200 bg-slate-50 text-slate-600");

const blankForm = {
  fullName: "", idNumber: "", phone: "", email: "",
  address: "", nationality: "Kenyan", source: "walk_in",
  kycStatus: "pending", kycDocuments: [], notes: "",
};

const Modal = ({ title, subtitle, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
    <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-2xl sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
      <div className="flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-semibold text-white/70">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
      {footer && <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
    </div>
  </div>
);

const inputCls = "h-8 w-full border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-[#0B3B2E] focus:outline-none";
const labelCls = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

const SaleBuyers = () => {
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);

  const [saving,        setSaving]        = useState(false);
  const [showModal,     setShowModal]     = useState(false);
  const [editingId,     setEditingId]     = useState("");
  const [form,          setForm]          = useState(blankForm);
  const [docModalInput, setDocModalInput] = useState("");
  const [selected,      setSelected]      = useState(null);
  const [docInput,      setDocInput]      = useState("");
  const [kycSaving,     setKycSaving]     = useState(false);
  const [smsTarget,     setSmsTarget]     = useState(null);
  const [smsSending,    setSmsSending]    = useState(false);
  const [search,        setSearch]        = useState("");
  const debouncedSearch = useDebounce(search, 400);
  const [kycFilter,     setKycFilter]     = useState("");
  const [page,          setPage]          = useState(1);
  const [pageSize,      setPageSize]      = useState(PAGE_SIZE);

  const biz = currentCompany?._id;

  useEffect(() => setPage(1), [debouncedSearch, kycFilter]);

  const { data: buyersData, isLoading: loading, isFetching, error } = useQuery({
    queryKey: ["sale-buyers", biz, debouncedSearch, kycFilter, page, pageSize],
    queryFn:  () => saleApi.listBuyers({ business: biz, search: debouncedSearch, kycStatus: kycFilter, page, limit: pageSize }),
    enabled:  !!biz,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  useEffect(() => { if (error) toast.error("Failed to load buyers"); }, [error]);

  const buyers     = buyersData?.data  ?? [];
  const total      = buyersData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // sync panel with fresh data after mutations
  useEffect(() => {
    if (!selected) return;
    const updated = buyers.find((b) => b._id === selected._id);
    if (updated) setSelected(updated);
  }, [buyers]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["sale-buyers", biz] });

  const openCreate = () => { setEditingId(""); setForm(blankForm); setDocModalInput(""); setShowModal(true); };
  const openEdit   = (row) => {
    setEditingId(row._id);
    setForm({
      fullName:     row.fullName     || "",
      idNumber:     row.idNumber     || "",
      phone:        row.phone        || "",
      email:        row.email        || "",
      address:      row.address      || "",
      nationality:  row.nationality  || "Kenyan",
      source:       row.source       || "walk_in",
      kycStatus:    row.kycStatus    || "pending",
      kycDocuments: Array.isArray(row.kycDocuments) ? [...row.kycDocuments] : [],
      notes:        row.notes        || "",
    });
    setDocModalInput("");
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.fullName.trim()) return toast.warning("Full name is required");
    setSaving(true);
    try {
      const payload = { ...form, business: biz };
      if (editingId) await saleApi.updateBuyer(editingId, payload);
      else await saleApi.createBuyer(payload);
      invalidate();
      setShowModal(false);
      toast.success(`Buyer ${editingId ? "updated" : "registered"}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save buyer");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!await confirm({ title: "Remove Buyer", message: `Remove "${row.fullName}"?`, confirmText: "Remove", isDangerous: true })) return;
    try {
      await saleApi.deleteBuyer(row._id);
      if (selected?._id === row._id) setSelected(null);
      invalidate();
      toast.success("Buyer removed");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Cannot delete this buyer");
    }
  };

  const handleKycAction = async (buyer, newStatus) => {
    setKycSaving(true);
    try {
      await saleApi.updateBuyer(buyer._id, { kycStatus: newStatus, business: biz });
      invalidate();
      toast.success(`KYC set to ${newStatus}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update KYC status");
    } finally {
      setKycSaving(false);
    }
  };

  const handleAddDoc = async (buyer) => {
    const label = docInput.trim();
    if (!label) return;
    setKycSaving(true);
    try {
      const docs = [...(buyer.kycDocuments || []), label];
      await saleApi.updateBuyer(buyer._id, { kycDocuments: docs, business: biz });
      setDocInput("");
      invalidate();
      toast.success("Document added");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to add document");
    } finally {
      setKycSaving(false);
    }
  };

  const handleRemoveDoc = async (buyer, idx) => {
    setKycSaving(true);
    try {
      const docs = (buyer.kycDocuments || []).filter((_, i) => i !== idx);
      await saleApi.updateBuyer(buyer._id, { kycDocuments: docs, business: biz });
      invalidate();
      toast.success("Document removed");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to remove document");
    } finally {
      setKycSaving(false);
    }
  };

  const handleSendSms = async (phone, body) => {
    if (!smsTarget) return;
    setSmsSending(true);
    try {
      await saleApi.sendBuyerSms(smsTarget._id, { phone, body });
      toast.success("SMS sent");
      setSmsTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send SMS");
    } finally {
      setSmsSending(false);
    }
  };

  const printBuyer = (row) => {
    const co       = currentCompany || {};
    const coName   = co.companyName || co.name || "MILIK";
    const esc      = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const logoHtml = co.logo
      ? `<img src="${co.logo}" alt="logo" style="width:72px;height:72px;object-fit:contain;border:1px solid #cbd5e1;" />`
      : `<div style="width:72px;height:72px;background:#0B3B2E;color:#fff;font-size:26px;font-weight:900;display:flex;align-items:center;justify-content:center;">${coName.slice(0, 1)}</div>`;
    const coInfo   = [co.phone || co.phoneNumber, co.email || co.companyEmail].filter(Boolean).join(" • ");
    const kycC     = { pending: "#92400e", verified: "#166534", rejected: "#9f1239" }[row.kycStatus] || "#334155";
    const kycBg2   = { pending: "#fef3c7", verified: "#dcfce7", rejected: "#ffe4e6" }[row.kycStatus] || "#f1f5f9";
    const printedOn= new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" });
    const field    = (label, value) => `<div class="field"><div class="fl">${esc(label)}</div><div class="fv">${esc(value || "—")}</div></div>`;
    const docsHtml = Array.isArray(row.kycDocuments) && row.kycDocuments.length
      ? `<div style="border:1px solid #e2e8f0;padding:10px 14px;margin-bottom:14px"><div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:6px">KYC Documents (${row.kycDocuments.length})</div>${row.kycDocuments.map((d) => `<div style="font-size:11px;color:#1e293b;padding:2px 0">&bull; ${esc(d)}</div>`).join("")}</div>`
      : "";
    const win = window.open("", "_blank", "width=900,height=720");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Buyer Profile &mdash; ${esc(row.buyerNumber)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:28px 32px;font-size:12px}
.hdr{display:grid;grid-template-columns:80px 1fr 170px;align-items:start;border-bottom:3px solid #0B3B2E;padding-bottom:14px;margin-bottom:18px;gap:12px}
.co-name{font-size:18px;font-weight:900;color:#0B3B2E}.co-sub{font-size:9px;color:#64748b;line-height:1.5}
.doc-type{font-size:13px;font-weight:900;color:#0B3B2E;text-transform:uppercase;letter-spacing:.05em;text-align:right}
.doc-no{font-family:monospace;font-size:15px;font-weight:700;text-align:right;margin-top:3px}
.badge{display:inline-block;padding:3px 12px;font-size:10px;font-weight:800;float:right;margin-top:6px;background:${kycBg2};color:${kycC}}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:14px}
.field{background:#fff;padding:9px 12px}.fl{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:2px}
.fv{font-size:11px;font-weight:600;color:#1e293b}
.notice{font-size:9px;color:#94a3b8;text-align:center;margin-top:20px;border-top:1px solid #f1f5f9;padding-top:10px}
@media print{body{padding:14px 16px}@page{size:A4 portrait;margin:10mm}}
</style></head><body>
<div class="hdr">
  <div>${logoHtml}</div>
  <div><div class="co-name">${esc(coName)}</div>${coInfo ? `<div class="co-sub">${esc(coInfo)}</div>` : ""}</div>
  <div>
    <div class="doc-type">Buyer Profile</div>
    <div class="doc-no">${esc(row.buyerNumber)}</div>
    <div class="badge">KYC: ${esc(String(row.kycStatus || "").toUpperCase())}</div>
  </div>
</div>
<div class="grid">
  ${field("Buyer No.", row.buyerNumber)}
  ${field("Full Name", row.fullName)}
  ${field("ID / Passport", row.idNumber)}
  ${field("Phone", row.phone)}
  ${field("Email", row.email)}
  ${field("Nationality", row.nationality)}
  ${field("Source", String(row.source || "").replace(/_/g, " "))}
  ${field("KYC Status", row.kycStatus)}
  ${field("Address", row.address)}
</div>
${docsHtml}
${row.notes ? `<div style="border:1px solid #e2e8f0;padding:10px 14px;font-size:11px;color:#334155;line-height:1.6"><div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:4px">Notes</div>${esc(row.notes)}</div>` : ""}
<div class="notice">Buyer profile issued by ${esc(coName)} &bull; Printed: ${esc(printedOn)}</div>
</body></html>`);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 400);
  };

  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  const addDocToForm = () => {
    const t = docModalInput.trim();
    if (!t) return;
    setForm((p) => ({ ...p, kycDocuments: [...p.kycDocuments, t] }));
    setDocModalInput("");
  };

  return (
    <PropertySaleShell
      title="Buyers / Clients"
      subtitle={`${total} registered`}
      action={
        <>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-buyers", biz] })}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
          >
            <FaPlus size={9} /> New Buyer
          </button>
        </>
      }
    >
      {/* Filter bar */}
      <div className="flex-shrink-0 mb-1 flex flex-wrap items-center gap-1 border border-slate-200 bg-white px-2 py-1 shadow-sm">
        <div className="relative min-w-[180px] flex-1">
          <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, phone, ID…"
            className="h-7 w-full border border-slate-300 pl-7 pr-2 text-xs placeholder:text-slate-400 focus:border-[#0B3B2E] focus:outline-none"
          />
        </div>
        <select
          value={kycFilter}
          onChange={(e) => setKycFilter(e.target.value)}
          className="h-7 border border-[#B7C9C0] bg-[#F1F6F3] px-1.5 text-xs font-semibold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
        >
          <option value="">All KYC Statuses</option>
          {KYC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(search || kycFilter) && (
          <button type="button" onClick={() => { setSearch(""); setKycFilter(""); }} className="h-7 border border-rose-200 bg-rose-50 px-2.5 text-xs font-bold text-rose-600 hover:bg-rose-100">Clear</button>
        )}
      </div>

      {/* Table + KYC detail panel */}
      <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className={`flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm transition-[margin] duration-200 ${selected ? "mr-[360px]" : ""}`}>
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full min-w-[640px] text-xs border-collapse">
              <thead>
                <tr className="bg-[#0B3B2E]">
                  {["Buyer No.", "Name", "Phone", "Email", "Source", "KYC", "Actions"].map((h) => (
                    <th key={h} className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white ${h === "Actions" ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-xs text-slate-400">Loading buyers…</td></tr>
                ) : buyers.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-xs text-slate-400">No buyers found.</td></tr>
                ) : buyers.map((row) => {
                  const isSelected = selected?._id === row._id;
                  return (
                    <tr
                      key={row._id}
                      onClick={() => setSelected(isSelected ? null : row)}
                      className={`border-b border-slate-100 cursor-pointer ${isSelected ? "bg-[#F1F6F3]" : "hover:bg-slate-50"}`}
                    >
                      <td className="px-3 py-2 font-mono font-black text-[#0B3B2E]">{row.buyerNumber}</td>
                      <td className="px-3 py-2">
                        <div className="font-bold text-slate-900">{row.fullName}</div>
                        {row.idNumber && <div className="text-[10px] text-slate-400">ID: {row.idNumber}</div>}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.phone || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{row.email || "—"}</td>
                      <td className="px-3 py-2 capitalize text-slate-600">{String(row.source || "").replace(/_/g, " ")}</td>
                      <td className="px-3 py-2">
                        <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${kycBadge(row.kycStatus)}`}>{row.kycStatus}</span>
                      </td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex gap-1">
                          <button type="button" onClick={() => printBuyer(row)} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaPrint className="text-[9px]" /></button>
                          <button type="button" onClick={() => openEdit(row)} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaEdit className="text-[9px]" /></button>
                          <button type="button" onClick={() => handleDelete(row)} className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100"><FaTrash className="text-[9px]" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <PaginationBar page={page} pages={totalPages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} />
        </div>

        {/* KYC Detail Panel */}
        {selected && (
          <div className="absolute right-0 top-0 bottom-0 w-[360px] flex flex-col bg-white border-l border-slate-200 shadow-xl z-10 overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-3 text-white">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wider text-white/60">{selected.buyerNumber}</div>
                  <div className="mt-0.5 text-sm font-black leading-tight">{selected.fullName}</div>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="flex-shrink-0 p-1 text-white/70 hover:bg-white/10"><FaTimes size={12} /></button>
              </div>
              <div className="mt-2">
                <span className={`border px-1.5 py-0.5 text-[9px] font-black uppercase ${kycBadge(selected.kycStatus)}`}>{selected.kycStatus}</span>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto">

              {/* Profile */}
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Profile</div>
                <div className="space-y-1.5">
                  {[
                    ["ID / Passport", selected.idNumber],
                    ["Phone",         selected.phone],
                    ["Email",         selected.email],
                    ["Nationality",   selected.nationality],
                    ["Source",        String(selected.source || "").replace(/_/g, " ")],
                    ["Address",       selected.address],
                  ].filter(([, v]) => v).map(([label, val]) => (
                    <div key={label} className="flex items-baseline gap-2">
                      <span className="w-[100px] flex-shrink-0 text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</span>
                      <span className="text-xs text-slate-800 break-all">{val}</span>
                    </div>
                  ))}
                </div>
                {selected.notes && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Notes</div>
                    <div className="text-xs leading-relaxed text-slate-600">{selected.notes}</div>
                  </div>
                )}
              </div>

              {/* KYC quick actions */}
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">KYC Status</div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.kycStatus !== "verified" && (
                    <button
                      type="button"
                      disabled={kycSaving}
                      onClick={() => handleKycAction(selected, "verified")}
                      className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                    >
                      <FaCheck size={9} /> Verify
                    </button>
                  )}
                  {selected.kycStatus !== "rejected" && (
                    <button
                      type="button"
                      disabled={kycSaving}
                      onClick={() => handleKycAction(selected, "rejected")}
                      className="inline-flex items-center gap-1 border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                    >
                      <FaBan size={9} /> Reject
                    </button>
                  )}
                  {selected.kycStatus !== "pending" && (
                    <button
                      type="button"
                      disabled={kycSaving}
                      onClick={() => handleKycAction(selected, "pending")}
                      className="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                    >
                      Reset to Pending
                    </button>
                  )}
                </div>
              </div>

              {/* KYC Documents */}
              <div className="px-4 py-3">
                <div className="mb-2 flex items-baseline gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">KYC Documents</span>
                  <span className="text-[10px] font-bold text-slate-500">({(selected.kycDocuments || []).length})</span>
                </div>
                {(selected.kycDocuments || []).length > 0 ? (
                  <div className="mb-2 space-y-1">
                    {selected.kycDocuments.map((doc, idx) => (
                      <div key={idx} className="flex items-center gap-2 border border-slate-200 bg-[#F1F6F3] px-2.5 py-1.5">
                        <FaFileAlt size={9} className="flex-shrink-0 text-[#0B3B2E]" />
                        <span className="flex-1 min-w-0 truncate text-xs text-slate-800" title={doc}>{doc}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveDoc(selected, idx)}
                          disabled={kycSaving}
                          className="flex-shrink-0 p-0.5 text-rose-400 hover:text-rose-600 disabled:opacity-40"
                        >
                          <FaTimes size={9} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mb-2 text-[11px] text-slate-400">No documents recorded.</div>
                )}
                <div className="flex gap-1">
                  <input
                    value={docInput}
                    onChange={(e) => setDocInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddDoc(selected)}
                    placeholder="e.g. National ID copy"
                    className="h-7 flex-1 border border-slate-200 bg-white px-2.5 text-xs focus:border-[#0B3B2E] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddDoc(selected)}
                    disabled={kycSaving || !docInput.trim()}
                    className="h-7 border border-[#B7C9C0] bg-[#F1F6F3] px-2.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#B7C9C0]/30 disabled:opacity-50"
                  >
                    <FaPlus size={9} />
                  </button>
                </div>
              </div>

            </div>

            {/* Panel footer */}
            <div className="flex-shrink-0 flex items-center justify-between gap-1 border-t border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => printBuyer(selected)}
                  className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
                >
                  <FaPrint size={9} /> Print
                </button>
                {selected.phone && (
                  <button
                    type="button"
                    onClick={() => setSmsTarget(selected)}
                    className="inline-flex items-center gap-1 border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-700 hover:bg-teal-100"
                  >
                    <FaSms size={9} /> SMS
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => openEdit(selected)}
                className="inline-flex items-center gap-1 bg-[#0B3B2E] px-3 py-1 text-[11px] font-black text-white hover:bg-[#07271e]"
              >
                <FaEdit size={9} /> Edit Profile
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SMS Modal */}
      {smsTarget && (
        <CwSmsModal
          target={{ name: smsTarget.fullName, phone: smsTarget.phone }}
          context={smsTarget.buyerNumber}
          defaultBody={`Dear ${smsTarget.fullName}, `}
          templates={[
            { label: "KYC Verified",      color: "green",  body: `Dear ${smsTarget.fullName}, your KYC verification is complete. You are now cleared to proceed with property transactions. Contact us for next steps.` },
            { label: "Document Request",  color: "amber",  body: `Dear ${smsTarget.fullName}, please submit your outstanding KYC documents at your earliest convenience. Contact us for assistance.` },
            { label: "Payment Reminder",  color: "violet", body: `Dear ${smsTarget.fullName}, this is a friendly payment reminder. Kindly ensure your outstanding balance is settled to avoid delays. Contact us for details.` },
            { label: "Welcome",           color: "slate",  body: `Welcome to MILIK Property Sales, ${smsTarget.fullName}! We are delighted to have you as a client. Our team is ready to assist you. Contact us anytime.` },
          ]}
          onSend={handleSendSms}
          onClose={() => setSmsTarget(null)}
          sending={smsSending}
        />
      )}

      {/* New / Edit Buyer Modal */}
      {showModal && (
        <Modal
          title={editingId ? "Edit Buyer" : "Register Buyer"}
          subtitle="Property Sale Module"
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowModal(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleSave} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {saving ? "Saving…" : editingId ? "Update Buyer" : "Register Buyer"}
              </button>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelCls}>Full Name</label>
              <input value={form.fullName} onChange={f("fullName")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>National ID / Passport</label>
              <input value={form.idNumber} onChange={f("idNumber")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input value={form.phone} onChange={f("phone")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" value={form.email} onChange={f("email")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Nationality</label>
              <input value={form.nationality} onChange={f("nationality")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Source</label>
              <select value={form.source} onChange={f("source")} className={inputCls}>
                {SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>KYC Status</label>
              <select value={form.kycStatus} onChange={f("kycStatus")} className={inputCls}>
                {KYC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>Address</label>
              <input value={form.address} onChange={f("address")} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>KYC Documents</label>
              {form.kycDocuments.length > 0 && (
                <div className="mb-1 space-y-1">
                  {form.kycDocuments.map((doc, idx) => (
                    <div key={idx} className="flex items-center gap-2 border border-slate-200 bg-[#F1F6F3] px-2.5 py-1.5">
                      <FaFileAlt size={9} className="flex-shrink-0 text-[#0B3B2E]" />
                      <span className="flex-1 min-w-0 truncate text-xs text-slate-700">{doc}</span>
                      <button
                        type="button"
                        onClick={() => setForm((p) => ({ ...p, kycDocuments: p.kycDocuments.filter((_, i) => i !== idx) }))}
                        className="text-rose-400 hover:text-rose-600"
                      >
                        <FaTimes size={9} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-1">
                <input
                  value={docModalInput}
                  onChange={(e) => setDocModalInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addDocToForm()}
                  placeholder="Document reference, e.g. National ID copy"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={addDocToForm}
                  className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#B7C9C0]/30"
                >
                  <FaPlus size={9} />
                </button>
              </div>
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea rows={2} value={form.notes} onChange={f("notes")} className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
            </div>
          </div>
        </Modal>
      )}
    </PropertySaleShell>
  );
};

export default SaleBuyers;

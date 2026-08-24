import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { FaBan, FaCheck, FaEdit, FaEnvelope, FaFileAlt, FaFileImport, FaHandshake, FaHistory, FaMoneyBillWave, FaPlus, FaPrint, FaRedoAlt, FaSms, FaTimes, FaTrash } from "react-icons/fa";
import SaleImportModal from "../../components/Modals/SaleImportModal";
import { parseSaleBuyersExcel, downloadSaleBuyersTemplate } from "../../utils/excelTemplates";
import CwSmsModal from "../CarWash/CwSmsModal";
import SaleEmailModal from "./SaleEmailModal";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { saleApi } from "../../services/propertySaleApi";
import { fmtDate } from "../../utils/dates";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";
import { inputClass, labelClass } from "../../utils/formStyles";

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


const SaleBuyers = () => {
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);

  const [saving,        setSaving]        = useState(false);
  const [showModal,     setShowModal]     = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingId,     setEditingId]     = useState("");
  const [form,          setForm]          = useState(blankForm);
  const [docModalInput, setDocModalInput] = useState("");
  const [selected,      setSelected]      = useTabState("/sale/buyers:selected", null);
  const [docInput,      setDocInput]      = useState("");
  const [kycSaving,     setKycSaving]     = useState(false);
  const [smsTarget,     setSmsTarget]     = useState(null);
  const [smsSending,    setSmsSending]    = useState(false);
  const [emailTarget,   setEmailTarget]   = useState(null);
  const [emailForm,     setEmailForm]     = useState({ subject: "", body: "" });
  const [emailSending,  setEmailSending]  = useState(false);
  const [search,        setSearch]        = useTabState("/sale/buyers:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [kycFilter,     setKycFilter]     = useTabState("/sale/buyers:kycFilter", "");
  const [sourceFilter,  setSourceFilter]  = useTabState("/sale/buyers:sourceFilter", "");
  const [page,          setPage]          = useTabState("/sale/buyers:page", 1);
  const [pageSize,      setPageSize]      = useTabState("/sale/buyers:pageSize", PAGE_SIZE);
  const [panelTab,      setPanelTab]      = useState("profile");

  const biz = currentCompany?._id;

  useEffect(() => setPage(1), [debouncedSearch, kycFilter, sourceFilter]);

  const { data: buyersData, isLoading: loading, isFetching, error } = useQuery({
    queryKey: ["sale-buyers", biz, debouncedSearch, kycFilter, sourceFilter, page, pageSize],
    queryFn:  () => saleApi.listBuyers({ business: biz, search: debouncedSearch, kycStatus: kycFilter, source: sourceFilter, page, limit: pageSize }),
    enabled:  !!biz,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  useEffect(() => { if (error) toast.error("Failed to load buyers"); }, [error]);

  const buyers     = buyersData?.data  ?? [];
  const total      = buyersData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const selectedId = selected?._id;

  const { data: buyerOffersData }    = useQuery({ queryKey: ["sale-buyer-offers",    biz, selectedId], queryFn: () => saleApi.listOffers({ business: biz, buyerId: selectedId, limit: 100 }), enabled: !!biz && !!selectedId, staleTime: 30_000 });
  const { data: buyerDealsData }     = useQuery({ queryKey: ["sale-buyer-deals",     biz, selectedId], queryFn: () => saleApi.listDeals({ business: biz, buyerId: selectedId, limit: 100 }), enabled: !!biz && !!selectedId, staleTime: 30_000 });
  const { data: buyerPaymentsData }  = useQuery({ queryKey: ["sale-buyer-payments",  biz, selectedId], queryFn: () => saleApi.listPayments({ business: biz, buyer: selectedId, limit: 100 }), enabled: !!biz && !!selectedId, staleTime: 30_000 });
  const { data: buyerActivitiesData }= useQuery({ queryKey: ["sale-buyer-activities",biz, selectedId], queryFn: () => saleApi.listActivities({ business: biz, relatedBuyer: selectedId, limit: 100 }), enabled: !!biz && !!selectedId, staleTime: 30_000 });

  const buyerOffers     = buyerOffersData?.data     ?? [];
  const buyerDeals      = buyerDealsData?.data      ?? [];
  const buyerPayments   = buyerPaymentsData?.data   ?? [];
  const buyerActivities = buyerActivitiesData?.data ?? [];

  const fmtKES  = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 0 });

  // sync panel with fresh data after mutations; reset tab when buyer changes
  useEffect(() => {
    if (!selected) return;
    const updated = buyers.find((b) => b._id === selected._id);
    if (updated) setSelected(updated);
  }, [buyers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPanelTab("profile"); }, [selectedId]);

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

  const handleSendEmail = async () => {
    if (!emailTarget?.email) { toast.warn("Buyer has no email address"); return; }
    if (!emailForm.subject.trim() || !emailForm.body.trim()) { toast.warn("Subject and message are required"); return; }
    setEmailSending(true);
    try {
      await saleApi.sendBuyerEmail(emailTarget._id, { to: emailTarget.email, ...emailForm });
      toast.success("Email sent");
      setEmailTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send email");
    } finally {
      setEmailSending(false);
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
    <PropertySaleShell>
      <SaleFilterBar
        leading={<span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{total} buyer{total !== 1 ? "s" : ""}</span>}
        onReset={() => { setSearch(""); setKycFilter(""); setSourceFilter(""); setPage(1); }}
        activeCount={[search, kycFilter, sourceFilter].filter(Boolean).length}
        trailing={
          <>
            <button type="button" onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-buyers", biz] })} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
              <FaRedoAlt size={8} className={isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <button type="button" onClick={() => setShowImportModal(true)} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
              <FaFileImport size={9} /> Import
            </button>
            <button type="button" onClick={openCreate} className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]">
              <FaPlus size={8} /> New Buyer
            </button>
          </>
        }
      >
        <FilterSearch value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, ID…" />
        <AppSelect value={kycFilter} onChange={(v) => setKycFilter(v ?? "")} options={KYC_STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))} placeholder="All KYC" clearable size="sm" />
        <AppSelect value={sourceFilter} onChange={(v) => setSourceFilter(v ?? "")} options={SOURCES.map((s) => ({ value: s, label: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }))} placeholder="All Sources" clearable size="sm" />
      </SaleFilterBar>

      {/* Table + KYC detail panel */}
      <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className={`flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm transition-[margin] duration-200 ${selected ? "mr-[380px]" : ""}`}>
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

        {selected && (
          <div className="absolute inset-0 z-[5]" onClick={() => setSelected(null)} />
        )}

        {/* Buyer Detail Panel */}
        {selected && (
          <div className="absolute right-0 top-0 bottom-0 w-full sm:w-[380px] flex flex-col bg-white border-l border-slate-200 shadow-xl z-10 overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-3 text-white">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wider text-white/60">{selected.buyerNumber}</div>
                  <div className="mt-0.5 text-sm font-black leading-tight">{selected.fullName}</div>
                  {selected.phone && <div className="text-[10px] text-white/60 mt-0.5">{selected.phone}{selected.email ? ` · ${selected.email}` : ""}</div>}
                </div>
                <button type="button" onClick={() => setSelected(null)} className="flex-shrink-0 p-1 text-white/70 hover:bg-white/10"><FaTimes size={12} /></button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`border px-1.5 py-0.5 text-[9px] font-black uppercase ${kycBadge(selected.kycStatus)}`}>{selected.kycStatus}</span>
                <span className="text-[10px] text-white/50">{buyerDeals.length} deal{buyerDeals.length !== 1 ? "s" : ""} · {buyerOffers.length} offer{buyerOffers.length !== 1 ? "s" : ""}</span>
              </div>
            </div>

            {/* Tab nav */}
            <div className="flex-shrink-0 flex border-b border-slate-200 bg-slate-50 overflow-x-auto">
              {[
                { id: "profile",    label: "Profile / KYC" },
                { id: "offers",     label: `Offers (${buyerOffers.length})` },
                { id: "deals",      label: `Deals (${buyerDeals.length})` },
                { id: "payments",   label: `Payments (${buyerPayments.length})` },
                { id: "activities", label: `Log (${buyerActivities.length})` },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPanelTab(t.id)}
                  className={`flex-shrink-0 px-3 py-2 text-[10px] font-black uppercase tracking-wide whitespace-nowrap border-b-2 transition-colors ${panelTab === t.id ? "border-[#0B3B2E] text-[#0B3B2E] bg-white" : "border-transparent text-slate-400 hover:text-slate-700"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto">

              {/* ── Profile / KYC tab ── */}
              {panelTab === "profile" && (
                <>
                  <div className="border-b border-slate-100 px-4 py-3">
                    <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Contact Details</div>
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
                  <div className="border-b border-slate-100 px-4 py-3">
                    <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">KYC Status</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.kycStatus !== "verified" && (
                        <button type="button" disabled={kycSaving} onClick={() => handleKycAction(selected, "verified")}
                          className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
                          <FaCheck size={9} /> Verify
                        </button>
                      )}
                      {selected.kycStatus !== "rejected" && (
                        <button type="button" disabled={kycSaving} onClick={() => handleKycAction(selected, "rejected")}
                          className="inline-flex items-center gap-1 border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60">
                          <FaBan size={9} /> Reject
                        </button>
                      )}
                      {selected.kycStatus !== "pending" && (
                        <button type="button" disabled={kycSaving} onClick={() => handleKycAction(selected, "pending")}
                          className="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-60">
                          Reset to Pending
                        </button>
                      )}
                    </div>
                  </div>
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
                            <button type="button" onClick={() => handleRemoveDoc(selected, idx)} disabled={kycSaving} className="flex-shrink-0 p-0.5 text-rose-400 hover:text-rose-600 disabled:opacity-40">
                              <FaTimes size={9} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mb-2 text-[11px] text-slate-400">No documents recorded.</div>
                    )}
                    <div className="flex gap-1">
                      <input value={docInput} onChange={(e) => setDocInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddDoc(selected)}
                        placeholder="e.g. National ID copy" className="h-7 flex-1 border border-slate-200 bg-white px-2.5 text-xs focus:border-[#0B3B2E] focus:outline-none" />
                      <button type="button" onClick={() => handleAddDoc(selected)} disabled={kycSaving || !docInput.trim()}
                        className="h-7 border border-[#B7C9C0] bg-[#F1F6F3] px-2.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#B7C9C0]/30 disabled:opacity-50">
                        <FaPlus size={9} />
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* ── Offers tab ── */}
              {panelTab === "offers" && (
                <div className="px-4 py-3">
                  {buyerOffers.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">No offers found for this buyer.</div>
                  ) : (
                    <div className="space-y-2">
                      {buyerOffers.map((o) => (
                        <div key={o._id} className="border border-slate-200 px-3 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-mono text-[10px] font-black text-[#0B3B2E]">{o.offerNumber}</div>
                              <div className="text-xs font-semibold text-slate-800 mt-0.5">{o.listing?.title || o.listing?.listingNumber || "—"}</div>
                            </div>
                            <span className={`flex-shrink-0 border px-1.5 py-0.5 text-[9px] font-black uppercase ${
                              o.status === "accepted" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : o.status === "rejected" || o.status === "withdrawn" ? "border-rose-200 bg-rose-50 text-rose-700"
                              : o.status === "expired" ? "border-slate-200 bg-slate-50 text-slate-500"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                            }`}>{o.status}</span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-500">
                            <span>KES {fmtKES(o.offerAmount)}</span>
                            <span>{fmtDate(o.offerDate)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Deals tab ── */}
              {panelTab === "deals" && (
                <div className="px-4 py-3">
                  {buyerDeals.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">No deals found for this buyer.</div>
                  ) : (
                    <div className="space-y-2">
                      {buyerDeals.map((d) => {
                        const pct = d.agreedPrice ? Math.min(100, Math.round((d.totalPaid / d.agreedPrice) * 100)) : 0;
                        return (
                          <div key={d._id} className="border border-slate-200 px-3 py-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-mono text-[10px] font-black text-[#0B3B2E]">{d.dealNumber}</div>
                                <div className="text-xs font-semibold text-slate-800 mt-0.5">{d.listing?.title || d.listing?.listingNumber || "—"}</div>
                              </div>
                              <span className={`flex-shrink-0 border px-1.5 py-0.5 text-[9px] font-black uppercase ${
                                d.status === "closed" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : d.status === "cancelled" ? "border-slate-200 bg-slate-50 text-slate-500"
                                : "border-[#B7C9C0] bg-[#F1F6F3] text-[#0B3B2E]"
                              }`}>{d.status}</span>
                            </div>
                            <div className="mt-1.5 text-[11px] text-slate-500">
                              <span>KES {fmtKES(d.agreedPrice)}</span>
                              <span className="mx-2 text-slate-300">·</span>
                              <span className="text-slate-700 font-semibold">Paid: KES {fmtKES(d.totalPaid)}</span>
                              <span className="mx-2 text-slate-300">·</span>
                              <span>Bal: KES {fmtKES(d.balance)}</span>
                            </div>
                            <div className="mt-1.5">
                              <div className="flex items-center gap-1.5">
                                <div className="h-1.5 flex-1 bg-slate-100 overflow-hidden">
                                  <div className="h-full bg-[#0B3B2E] transition-all" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-[10px] font-black text-slate-500">{pct}%</span>
                              </div>
                            </div>
                            <div className="mt-1 text-[10px] text-slate-400">{fmtDate(d.dealDate)}{d.agent ? ` · Agent: ${d.agent.fullName}` : ""}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Payments tab ── */}
              {panelTab === "payments" && (
                <div className="px-4 py-3">
                  {buyerPayments.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">No payments found for this buyer.</div>
                  ) : (
                    <>
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{buyerPayments.length} payment{buyerPayments.length !== 1 ? "s" : ""}</span>
                        <span className="text-xs font-black text-[#0B3B2E]">Total: KES {fmtKES(buyerPayments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0))}</span>
                      </div>
                      <div className="space-y-1.5">
                        {buyerPayments.map((p) => (
                          <div key={p._id} className="flex items-start gap-2 border border-slate-200 px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10px] font-black text-[#0B3B2E]">{p.paymentNumber}</span>
                                <span className={`border px-1 py-0.5 text-[8px] font-black uppercase ${p.status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{p.status}</span>
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-600">{String(p.paymentType || "").replace(/_/g, " ")} · {String(p.paymentMethod || "").replace(/_/g, " ")}</div>
                              <div className="text-[10px] text-slate-400">{fmtDate(p.paymentDate)} · {p.deal?.dealNumber || "—"}</div>
                            </div>
                            <div className="flex-shrink-0 text-right">
                              <div className="text-xs font-black text-slate-900">KES {fmtKES(p.amount)}</div>
                              {p.reference && <div className="text-[10px] text-slate-400">Ref: {p.reference}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Activities tab ── */}
              {panelTab === "activities" && (
                <div className="px-4 py-3">
                  {buyerActivities.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">No activity log for this buyer.</div>
                  ) : (
                    <div className="relative">
                      <div className="absolute left-[7px] top-0 bottom-0 w-px bg-slate-200" />
                      <div className="space-y-3 pl-5">
                        {buyerActivities.map((a) => (
                          <div key={a._id} className="relative">
                            <div className="absolute -left-5 top-1 h-2 w-2 border border-[#B7C9C0] bg-[#F1F6F3]" />
                            <div className="border border-slate-200 px-3 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-[10px] font-black uppercase tracking-wide text-[#0B3B2E]">{String(a.type || "").replace(/_/g, " ")}</span>
                                {a.outcome && (
                                  <span className={`text-[9px] font-black uppercase px-1 py-0.5 ${a.outcome === "positive" ? "bg-emerald-50 text-emerald-700" : a.outcome === "negative" ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-500"}`}>{a.outcome}</span>
                                )}
                              </div>
                              {a.notes && <div className="mt-1 text-[11px] text-slate-700 leading-relaxed">{a.notes}</div>}
                              <div className="mt-1 text-[10px] text-slate-400">
                                {fmtDate(a.date)}{a.createdBy?.name || a.createdBy?.fullName ? ` · ${a.createdBy.name || a.createdBy.fullName}` : ""}
                                {a.relatedDeal?.dealNumber ? ` · ${a.relatedDeal.dealNumber}` : ""}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Panel footer */}
            <div className="flex-shrink-0 flex items-center justify-between gap-1 border-t border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => printBuyer(selected)}
                  className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                  <FaPrint size={9} /> Print
                </button>
                {selected.phone && (
                  <button type="button" onClick={() => setSmsTarget(selected)}
                    className="inline-flex items-center gap-1 border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-700 hover:bg-teal-100">
                    <FaSms size={9} /> SMS
                  </button>
                )}
                {selected.email && (
                  <button type="button" onClick={() => { setEmailTarget(selected); setEmailForm({ subject: "", body: "" }); }}
                    className="inline-flex items-center gap-1 border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100">
                    <FaEnvelope size={9} /> Email
                  </button>
                )}
              </div>
              <button type="button" onClick={() => openEdit(selected)}
                className="inline-flex items-center gap-1 bg-[#0B3B2E] px-3 py-1 text-[11px] font-black text-white hover:bg-[#07271e]">
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

      {/* Email Modal */}
      {emailTarget && (
        <SaleEmailModal
          title="Send Email"
          subtitle={`To: ${emailTarget.email}`}
          emailForm={emailForm}
          setEmailForm={setEmailForm}
          sending={emailSending}
          onSend={handleSendEmail}
          onClose={() => setEmailTarget(null)}
          context="buyer"
          vars={{
            buyerName:   emailTarget.fullName    || "",
            buyerNumber: emailTarget.buyerNumber || "",
            phone:       emailTarget.phone       || "",
            email:       emailTarget.email       || "",
            companyName: currentCompany?.companyName || currentCompany?.name || "",
          }}
        />
      )}

      {/* New / Edit Buyer Modal */}
      {showModal && (
        <Modal
          title={editingId ? "Edit Buyer" : "Register Buyer"}
          wide
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
              <label className={labelClass}>Full Name</label>
              <input value={form.fullName} onChange={f("fullName")} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>National ID / Passport</label>
              <input value={form.idNumber} onChange={f("idNumber")} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input value={form.phone} onChange={f("phone")} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" value={form.email} onChange={f("email")} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Nationality</label>
              <input value={form.nationality} onChange={f("nationality")} className={inputClass} />
            </div>
            <div>
              <AppSelect label="Source" value={form.source} onChange={(v) => setForm((p) => ({ ...p, source: v ?? "" }))} options={SOURCES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} size="md" />
            </div>
            <div>
              <AppSelect label="KYC Status" value={form.kycStatus} onChange={(v) => setForm((p) => ({ ...p, kycStatus: v ?? "" }))} options={KYC_STATUSES.map((s) => ({ value: s, label: s }))} size="md" />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Address</label>
              <input value={form.address} onChange={f("address")} className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>KYC Documents</label>
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
                  className={inputClass}
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
              <label className={labelClass}>Notes</label>
              <textarea rows={2} value={form.notes} onChange={f("notes")} className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
            </div>
          </div>
        </Modal>
      )}

      <SaleImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        title="Import Buyers"
        entityName="buyer"
        parseFile={parseSaleBuyersExcel}
        downloadTemplate={downloadSaleBuyersTemplate}
        onImport={async (rows) => {
          const res = await saleApi.bulkImportBuyers(rows);
          await queryClient.invalidateQueries({ queryKey: ["sale-buyers", biz] });
          return res;
        }}
        previewCols={[
          { header: "Full Name",   render: (r) => <span className="font-semibold">{r.fullName}</span> },
          { header: "Phone",       render: (r) => r.phone || "—" },
          { header: "ID / Passport", render: (r) => r.idNumber || "—" },
          { header: "Source",      render: (r) => r.source },
          { header: "KYC Status",  render: (r) => r.kycStatus },
        ]}
      />
    </PropertySaleShell>
  );
};

export default SaleBuyers;

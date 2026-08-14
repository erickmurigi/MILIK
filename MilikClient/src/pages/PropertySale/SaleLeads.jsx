import React, { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import {
  FaCalendarAlt, FaClipboardList, FaEdit, FaEnvelope, FaExchangeAlt,
  FaPhone, FaPlus, FaTimes, FaTrash, FaUserFriends,
} from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import SaleFilterBar, { FilterSearch } from "./SaleFilterBar";
import MilikTable from "../../components/common/MilikTable";
import { labelClass } from "../../utils/formStyles";

const LEAD_STATUSES  = ["new", "contacted", "qualified", "site_visited", "proposal_sent", "negotiating", "converted", "lost"];
const LEAD_SOURCES   = ["walk_in", "referral", "online", "social_media", "agent", "cold_call", "other"];
const ACTIVITY_TYPES = ["call", "email", "meeting", "site_visit", "whatsapp", "note", "follow_up"];
const OUTCOMES       = ["positive", "neutral", "negative", "no_answer", "not_applicable"];

const LEAD_STATUS_OPTIONS      = LEAD_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }));
const LEAD_STATUS_FORM_OPTIONS = LEAD_STATUSES.filter((s) => s !== "converted").map((s) => ({ value: s, label: s.replace(/_/g, " ") }));
const LEAD_SOURCE_OPTIONS      = LEAD_SOURCES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }));
const ACTIVITY_TYPE_OPTIONS    = ACTIVITY_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }));
const OUTCOME_OPTIONS          = OUTCOMES.map((o) => ({ value: o, label: o.replace(/_/g, " ") }));

const STATUS_COLORS = {
  new:           "border-blue-200 bg-blue-50 text-blue-700",
  contacted:     "border-sky-200 bg-sky-50 text-sky-700",
  qualified:     "border-violet-200 bg-violet-50 text-violet-700",
  site_visited:  "border-indigo-200 bg-indigo-50 text-indigo-700",
  proposal_sent: "border-amber-200 bg-amber-50 text-amber-700",
  negotiating:   "border-orange-200 bg-orange-50 text-orange-700",
  converted:     "border-emerald-200 bg-emerald-50 text-emerald-700",
  lost:          "border-rose-200 bg-rose-50 text-rose-700",
};
const OUTCOME_COLORS = {
  positive:       "text-emerald-600",
  neutral:        "text-slate-500",
  negative:       "text-rose-600",
  no_answer:      "text-amber-600",
  not_applicable: "text-slate-400",
};
const ACT_ICONS = { call: "📞", email: "✉️", meeting: "🤝", site_visit: "🏠", whatsapp: "💬", note: "📝", follow_up: "🔔" };

const blankLead      = { fullName: "", phone: "", email: "", source: "walk_in", status: "new", assignedAgent: "", budgetMin: "", budgetMax: "", notes: "", lostReason: "", nextFollowUpDate: "" };
const blankAct       = { type: "call", subject: "", notes: "", date: "", durationMinutes: "", outcome: "not_applicable", nextAction: "", nextActionDate: "" };
const blankOfferForm = { listing: "", offerAmount: "", validityDate: "", agent: "", notes: "" };

const fmt   = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const isOld = (date, status) => date && !["converted", "lost"].includes(status) && new Date(date) < new Date();
const LIMIT = 50;

const LEAD_TABLE_COLS = [
  { label: "#", width: 36 },
  { label: "Lead #" },
  { label: "Name" },
  { label: "Contact" },
  { label: "Source" },
  { label: "Status" },
  { label: "Agent" },
  { label: "Budget" },
  { label: "Next Follow-up" },
];

const selectCls = "h-7 border border-slate-200 bg-white px-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none";
const modalInputCls = "w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0B3B2E] focus:outline-none";

export default function SaleLeads() {
  const confirm = useConfirm();
  const qc      = useQueryClient();
  const biz     = useSelector((s) => s.company?.currentCompany?._id);

  const [search, setSearch]           = useTabState("/sale/crm/leads:search", "");
  const debSearch                     = useDebounce(search, 400);
  const [statusFilter, setStatus]     = useTabState("/sale/crm/leads:statusFilter", "");
  const [sourceFilter, setSource]     = useTabState("/sale/crm/leads:sourceFilter", "");
  const [agentFilter,  setAgent]      = useTabState("/sale/crm/leads:agentFilter", "");
  const [overdueOnly,  setOverdue]    = useTabState("/sale/crm/leads:overdueOnly", false);
  const [page,         setPage]       = useTabState("/sale/crm/leads:page", 1);
  const [pageSize,     setPageSize]   = useTabState("/sale/crm/leads:pageSize", LIMIT);

  const [showModal,    setShowModal]  = useState(false);
  const [editingId,    setEditingId]  = useState("");
  const [form,         setForm]       = useState(blankLead);
  const [saving,       setSaving]     = useState(false);

  const [selected,     setSelected]   = useTabState("/sale/crm/leads:selected", null);
  const [showActModal, setActModal]   = useState(false);
  const [editingAct,   setEditingAct] = useState(null);
  const [actForm,      setActForm]    = useState(blankAct);
  const [savingAct,    setSavingAct]  = useState(false);

  const [showConvert,      setShowConvert]      = useState(false);
  const [convertId,        setConvertId]        = useState("");
  const [converting,       setConverting]       = useState(false);

  const [showConvertOffer, setShowConvertOffer] = useState(false);
  const [offerForm,        setOfferForm]        = useState(blankOfferForm);
  const [convertingOffer,  setConvertingOffer]  = useState(false);

  useEffect(() => setPage(1), [debSearch, statusFilter, sourceFilter, agentFilter, overdueOnly]);

  const { data: leadsData, isLoading, isFetching } = useQuery({
    queryKey: ["sale-leads", biz, debSearch, statusFilter, sourceFilter, agentFilter, overdueOnly, page, pageSize],
    queryFn:  () => saleApi.listLeads({ business: biz, search: debSearch, status: statusFilter, source: sourceFilter, agent: agentFilter, overdueOnly: overdueOnly ? "1" : "", page, limit: pageSize }),
    enabled:  !!biz,
    placeholderData: (p) => p,
    staleTime: 30_000,
  });

  const { data: agentsData } = useQuery({
    queryKey: ["sale-agents-ref", biz],
    queryFn:  () => saleApi.listAgents({ business: biz, limit: 500 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });
  const agents = agentsData?.data ?? [];

  const { data: pipelineData } = useQuery({
    queryKey: ["sale-leads-pipeline", biz],
    queryFn:  () => saleApi.getLeadsPipeline({ business: biz }),
    enabled:  !!biz,
    staleTime: 30_000,
  });

  const { data: activitiesData, isLoading: loadingActs } = useQuery({
    queryKey: ["sale-activities-lead", biz, selected?._id],
    queryFn:  () => saleApi.listActivities({ business: biz, relatedLead: selected._id, limit: 100 }),
    enabled:  !!biz && !!selected?._id,
    staleTime: 30_000,
  });

  const { data: leadDetail, refetch: refetchDetail } = useQuery({
    queryKey: ["sale-lead-detail", biz, selected?._id],
    queryFn:  () => saleApi.getLead(selected._id, { business: biz }),
    enabled:  !!biz && !!selected?._id,
    staleTime: 30_000,
  });

  const { data: listingsRef } = useQuery({
    queryKey: ["sale-listings-ref", biz],
    queryFn:  () => saleApi.listListings({ business: biz, limit: 200 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });

  const allListings       = listingsRef?.data ?? [];
  const interestedListings = leadDetail?.interestedListings ?? [];

  const leads      = leadsData?.data ?? [];
  const total      = leadsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pipeline   = pipelineData?.pipeline ?? [];
  const leadActs   = activitiesData?.data ?? [];

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["sale-leads", biz] });
    qc.invalidateQueries({ queryKey: ["sale-leads-pipeline", biz] });
  }, [qc, biz]);

  // ── Lead CRUD ─────────────────────────────────────────────────────────────
  const openCreate = () => { setEditingId(""); setForm(blankLead); setShowModal(true); };
  const openEdit   = (lead) => {
    setEditingId(lead._id);
    setForm({
      fullName: lead.fullName || "", phone: lead.phone || "", email: lead.email || "",
      source: lead.source || "walk_in", status: lead.status || "new",
      assignedAgent: lead.assignedAgent?._id || lead.assignedAgent || "",
      budgetMin: lead.budgetMin || "", budgetMax: lead.budgetMax || "",
      notes: lead.notes || "", lostReason: lead.lostReason || "",
      nextFollowUpDate: lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate).toISOString().slice(0, 10) : "",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.fullName.trim()) return toast.warning("Full name is required");
    setSaving(true);
    try {
      const payload = { ...form, business: biz };
      if (editingId) {
        const updated = await saleApi.updateLead(editingId, payload);
        if (selected?._id === editingId) setSelected(updated);
      } else {
        await saleApi.createLead(payload);
      }
      invalidate();
      setShowModal(false);
      toast.success(`Lead ${editingId ? "updated" : "created"}`);
    } catch (err) { toast.error(err?.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (lead) => {
    if (!await confirm({ title: "Delete Lead", message: `Delete "${lead.fullName}"?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      await saleApi.deleteLead(lead._id);
      invalidate();
      if (selected?._id === lead._id) setSelected(null);
      toast.success("Lead deleted");
    } catch (err) { toast.error(err?.response?.data?.message || "Delete failed"); }
  };

  // ── Activities ─────────────────────────────────────────────────────────────
  const openLogAct = (lead) => {
    setSelected(lead);
    setEditingAct(null);
    setActForm({ ...blankAct, date: new Date().toISOString().slice(0, 16) });
    setActModal(true);
  };
  const openEditAct = (act) => {
    setEditingAct(act);
    setActForm({
      type: act.type, subject: act.subject || "", notes: act.notes || "",
      date: new Date(act.date).toISOString().slice(0, 16),
      durationMinutes: act.durationMinutes || "", outcome: act.outcome || "not_applicable",
      nextAction: act.nextAction || "",
      nextActionDate: act.nextActionDate ? new Date(act.nextActionDate).toISOString().slice(0, 10) : "",
    });
    setActModal(true);
  };

  const handleSaveAct = async () => {
    if (!actForm.type) return toast.warning("Activity type is required");
    setSavingAct(true);
    try {
      const payload = { ...actForm, business: biz, relatedLead: selected._id };
      if (editingAct) await saleApi.updateActivity(editingAct._id, payload);
      else await saleApi.createActivity(payload);
      qc.invalidateQueries({ queryKey: ["sale-activities-lead", biz, selected._id] });
      invalidate();
      setActModal(false);
      toast.success(`Activity ${editingAct ? "updated" : "logged"}`);
    } catch (err) { toast.error(err?.response?.data?.message || "Save failed"); }
    finally { setSavingAct(false); }
  };

  const handleDeleteAct = async (act) => {
    if (!await confirm({ title: "Delete Activity", message: "Remove this activity?", confirmText: "Remove", isDangerous: true })) return;
    try {
      await saleApi.deleteActivity(act._id);
      qc.invalidateQueries({ queryKey: ["sale-activities-lead", biz, selected._id] });
      toast.success("Activity removed");
    } catch (err) { toast.error("Delete failed"); }
  };

  // ── Conversion ─────────────────────────────────────────────────────────────
  const handleConvert = async () => {
    setConverting(true);
    try {
      const res = await saleApi.convertLead(selected._id, { business: biz, idNumber: convertId });
      invalidate();
      setSelected((p) => ({ ...p, status: "converted", convertedBuyer: res.buyer }));
      setShowConvert(false);
      toast.success("Lead converted to buyer");
    } catch (err) { toast.error(err?.response?.data?.message || "Conversion failed"); }
    finally { setConverting(false); }
  };

  const handleConvertToOffer = async (e) => {
    e.preventDefault();
    if (!offerForm.listing)     return toast.warning("Select a listing");
    if (!offerForm.offerAmount) return toast.warning("Offer amount is required");
    setConvertingOffer(true);
    try {
      await saleApi.convertLeadToOffer(selected._id, { ...offerForm, business: biz });
      toast.success("Offer created from lead");
      setShowConvertOffer(false);
      setOfferForm(blankOfferForm);
      invalidate();
      qc.invalidateQueries({ queryKey: ["sale-offers", biz] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to create offer");
    } finally {
      setConvertingOffer(false);
    }
  };

  // ── Interested Listings ───────────────────────────────────────────────────
  const handleToggleListing = async (listingId, add) => {
    const current = interestedListings.map((l) => l._id || l);
    const updated = add
      ? [...current, listingId]
      : current.filter((id) => String(id) !== String(listingId));
    try {
      await saleApi.updateLead(selected._id, { interestedListings: updated, business: biz });
      qc.invalidateQueries({ queryKey: ["sale-lead-detail", biz, selected._id] });
      toast.success(add ? "Listing linked" : "Listing removed");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update listings");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PropertySaleShell>
      <div className="flex h-full relative">

        {/* ── Main panel ──────────────────────────────────────────────────────── */}
        <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${selected ? "mr-[352px]" : ""}`}>

          {/* Pipeline funnel */}
          {pipeline.length > 0 && (
            <div className="flex flex-shrink-0 gap-1 px-2 py-1.5 bg-white border-b border-slate-200 overflow-x-auto">
              {LEAD_STATUSES.map((s) => {
                const count = pipeline.find((p) => p._id === s)?.count ?? 0;
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(statusFilter === s ? "" : s)}
                    className={`flex-shrink-0 text-center border px-3 py-1 text-xs transition-colors ${
                      statusFilter === s
                        ? `${STATUS_COLORS[s]} font-black`
                        : "border-slate-200 bg-white text-slate-600 hover:bg-[#F1F6F3] hover:border-[#B7C9C0]"
                    }`}
                  >
                    <div className="font-black text-sm leading-tight">{count}</div>
                    <div className="text-[9px] capitalize leading-tight">{s.replace(/_/g, " ")}</div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Filter bar */}
          <SaleFilterBar
            leading={<span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{total} lead{total !== 1 ? "s" : ""}</span>}
            onReset={() => { setSearch(""); setStatus(""); setSource(""); setAgent(""); setOverdue(false); setPage(1); }}
            activeCount={[search, statusFilter, sourceFilter, agentFilter, overdueOnly ? "1" : ""].filter(Boolean).length}
            trailing={
              <button
                onClick={openCreate}
                className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
              >
                <FaPlus size={9} /> Add Lead
              </button>
            }
          >
            <FilterSearch
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads…"
            />
            <AppSelect value={statusFilter} onChange={(v) => setStatus(v ?? "")} options={LEAD_STATUS_OPTIONS} placeholder="All Statuses" clearable size="sm" />
            <AppSelect value={sourceFilter} onChange={(v) => setSource(v ?? "")} options={LEAD_SOURCE_OPTIONS} placeholder="All Sources" clearable size="sm" />
            <AppSelect value={agentFilter} onChange={(v) => setAgent(v ?? "")} options={agents.map((a) => ({ value: a._id, label: a.fullName }))} placeholder="All Agents" searchable clearable size="sm" />
            <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none whitespace-nowrap">
              <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdue(e.target.checked)} className="accent-[#0B3B2E]" />
              Overdue
            </label>
          </SaleFilterBar>

          {/* Table container */}
          <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
            <MilikTable
              columns={LEAD_TABLE_COLS}
              rows={leads}
              loading={isLoading}
              empty="No leads found."
              minWidth={860}
              onRowClick={(row) => setSelected(selected?._id === row._id ? null : row)}
              isSelected={(row) => selected?._id === row._id}
              rowClassName={(row) => isOld(row.nextFollowUpDate, row.status) ? "border-l-2 border-l-rose-400" : ""}
              renderRow={(row, i) => {
                const overdue = isOld(row.nextFollowUpDate, row.status);
                return (
                  <>
                    <td className="px-3 py-1.5 text-slate-400 text-[10px] border-r border-gray-100">{(page - 1) * pageSize + i + 1}</td>
                    <td className="px-3 py-1.5 font-mono font-bold text-[#0B3B2E] whitespace-nowrap border-r border-gray-100">{row.leadNumber}</td>
                    <td className="px-3 py-1.5 font-semibold text-slate-800 whitespace-nowrap border-r border-gray-100">{row.fullName}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100">
                      {row.phone && <div className="flex items-center gap-1 text-slate-600"><FaPhone size={8} />{row.phone}</div>}
                      {row.email && <div className="flex items-center gap-1 text-slate-400 text-[10px]"><FaEnvelope size={8} />{row.email}</div>}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500 capitalize whitespace-nowrap border-r border-gray-100">{(row.source || "").replace(/_/g, " ")}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap border-r border-gray-100">
                      <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_COLORS[row.status] || "border-slate-200 bg-slate-50 text-slate-500"}`}>
                        {(row.status || "").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap border-r border-gray-100">{row.assignedAgent?.fullName || "—"}</td>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap border-r border-gray-100">
                      {row.budgetMin || row.budgetMax
                        ? `${row.budgetMin ? fmtKES(row.budgetMin) : "?"} – ${row.budgetMax ? fmtKES(row.budgetMax) : "?"}`
                        : "—"}
                    </td>
                    <td className={`px-3 py-1.5 whitespace-nowrap ${overdue ? "text-rose-600 font-semibold" : "text-slate-500"}`}>
                      {row.nextFollowUpDate
                        ? <span className="flex items-center gap-1"><FaCalendarAlt size={9} />{fmt(row.nextFollowUpDate)}{overdue ? " !" : ""}</span>
                        : "—"}
                    </td>
                  </>
                );
              }}
              renderActions={(row) => (
                <div className="inline-flex items-center gap-1">
                  <button onClick={() => openLogAct(row)} title="Log Activity" className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                    <FaClipboardList size={9} />
                  </button>
                  <button onClick={() => openEdit(row)} title="Edit" className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                    <FaEdit size={9} />
                  </button>
                  {row.status !== "converted" && (
                    <button onClick={() => handleDelete(row)} title="Delete" className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600 hover:bg-rose-100">
                      <FaTrash size={9} />
                    </button>
                  )}
                </div>
              )}
            />

            <PaginationBar
              page={page}
              pages={totalPages}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
              loading={isFetching}
            />
          </div>
        </div>

        {selected && (
          <div className="absolute inset-0 z-[5]" onClick={() => setSelected(null)} />
        )}

        {/* ── Lead Detail Panel ─────────────────────────────────────────────── */}
        {selected && (
          <div className="absolute right-0 top-0 bottom-0 w-full sm:w-[352px] bg-white border-l border-slate-200 shadow-xl flex flex-col overflow-hidden z-10">
            {/* Panel header */}
            <div className="flex flex-shrink-0 items-start justify-between gap-2 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <div className="min-w-0">
                <div className="font-extrabold text-sm leading-tight truncate">{selected.fullName}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_COLORS[selected.status] || "border-white/30 text-white"}`}>
                    {(selected.status || "").replace(/_/g, " ")}
                  </span>
                  <span className="text-[10px] font-mono text-white/60">{selected.leadNumber}</span>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="flex-shrink-0 p-1 text-white/70 hover:bg-white/10 hover:text-white">
                <FaTimes size={13} />
              </button>
            </div>

            {/* Info */}
            <div className="flex-shrink-0 border-b border-slate-100 px-4 py-3 space-y-1.5 text-xs">
              {selected.phone && <div className="flex items-center gap-2 text-slate-600"><FaPhone size={9} className="text-slate-400 flex-shrink-0" />{selected.phone}</div>}
              {selected.email && <div className="flex items-center gap-2 text-slate-500"><FaEnvelope size={9} className="text-slate-400 flex-shrink-0" />{selected.email}</div>}
              {selected.assignedAgent && <div className="text-slate-500">Agent: <span className="font-semibold text-slate-700">{selected.assignedAgent?.fullName || selected.assignedAgent}</span></div>}
              {(selected.budgetMin || selected.budgetMax) && (
                <div className="text-slate-500">Budget: <span className="font-semibold text-slate-700">{selected.budgetMin ? fmtKES(selected.budgetMin) : "?"} – {selected.budgetMax ? fmtKES(selected.budgetMax) : "?"}</span></div>
              )}
              {selected.nextFollowUpDate && (
                <div className={`flex items-center gap-1 ${isOld(selected.nextFollowUpDate, selected.status) ? "text-rose-600 font-semibold" : "text-slate-500"}`}>
                  <FaCalendarAlt size={9} />Next follow-up: {fmt(selected.nextFollowUpDate)}{isOld(selected.nextFollowUpDate, selected.status) ? " — overdue!" : ""}
                </div>
              )}
              {selected.lastContactDate && <div className="text-slate-400">Last contact: {fmt(selected.lastContactDate)}</div>}
              {selected.notes && <div className="italic text-slate-500">{selected.notes}</div>}
              {selected.lostReason && <div className="text-rose-500">Lost: {selected.lostReason}</div>}
            </div>

            {/* Interested Listings */}
            <div className="flex-shrink-0 border-b border-slate-100 px-4 py-3">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Interested Listings</div>
              {interestedListings.length > 0 ? (
                <div className="mb-2 space-y-1">
                  {interestedListings.map((l) => (
                    <div key={l._id} className="flex items-center gap-2 border border-slate-200 bg-[#F1F6F3] px-2.5 py-1.5">
                      <span className="flex-1 min-w-0 truncate text-xs text-slate-800">{l.listingNumber} — {l.title}</span>
                      <button type="button" onClick={() => handleToggleListing(l._id, false)} className="flex-shrink-0 p-0.5 text-rose-400 hover:text-rose-600">
                        <FaTimes size={9} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mb-2 text-[11px] text-slate-400">No listings linked yet.</div>
              )}
              <AppSelect
                value=""
                onChange={(v) => { if (v) handleToggleListing(v, true); }}
                options={allListings
                  .filter((l) => !interestedListings.some((il) => String(il._id) === String(l._id)))
                  .map((l) => ({ value: l._id, label: `${l.listingNumber} — ${l.title}` }))}
                placeholder="+ Link a listing…"
                searchable
                size="sm"
              />
            </div>

            {/* Actions */}
            <div className="flex flex-shrink-0 gap-1.5 border-b border-slate-100 px-4 py-2">
              <button onClick={() => openEdit(selected)} className="flex-1 inline-flex items-center justify-center gap-1 border border-[#B7C9C0] bg-white px-3 py-1.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaEdit size={9} /> Edit
              </button>
              {selected.status !== "converted" && selected.status !== "lost" ? (
                <>
                  <button onClick={() => { setConvertId(""); setShowConvert(true); }} className="flex-1 inline-flex items-center justify-center gap-1 border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100">
                    <FaExchangeAlt size={9} /> Buyer
                  </button>
                  <button onClick={() => { setOfferForm(blankOfferForm); setShowConvertOffer(true); }} className="flex-1 inline-flex items-center justify-center gap-1 border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100">
                    <FaExchangeAlt size={9} /> → Offer
                  </button>
                </>
              ) : selected.convertedBuyer ? (
                <span className="flex-1 border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-center text-emerald-700">✓ Buyer Created</span>
              ) : null}
            </div>

            {/* Activity log header */}
            <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2">
              <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">Activity Log</span>
              <button onClick={() => openLogAct(selected)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                <FaPlus size={8} /> Log
              </button>
            </div>

            {/* Activity list */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
              {loadingActs && <div className="text-xs text-slate-400 text-center py-4">Loading…</div>}
              {!loadingActs && leadActs.length === 0 && (
                <div className="text-xs text-slate-400 text-center py-6">
                  No activities yet.<br />Track calls, meetings, site visits…
                </div>
              )}
              {leadActs.map((act) => (
                <div key={act._id} className="flex gap-2.5 group">
                  <div className="text-base mt-0.5 flex-shrink-0">{ACT_ICONS[act.type] || "📋"}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-xs font-semibold text-slate-700 capitalize leading-tight">
                        {(act.type || "").replace(/_/g, " ")}{act.subject ? ` — ${act.subject}` : ""}
                      </span>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
                        <button onClick={() => openEditAct(act)} className="border border-[#B7C9C0] bg-white p-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaEdit size={9} /></button>
                        <button onClick={() => handleDeleteAct(act)} className="border border-rose-200 bg-rose-50 p-0.5 text-[10px] font-bold text-rose-600 hover:bg-rose-100"><FaTrash size={9} /></button>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{fmt(act.date)}{act.durationMinutes ? ` · ${act.durationMinutes} min` : ""}</div>
                    {act.outcome && act.outcome !== "not_applicable" && (
                      <div className={`text-[10px] capitalize mt-0.5 ${OUTCOME_COLORS[act.outcome]}`}>
                        Outcome: {act.outcome.replace(/_/g, " ")}
                      </div>
                    )}
                    {act.notes && <div className="text-[10px] text-slate-500 mt-0.5">{act.notes}</div>}
                    {act.nextAction && (
                      <div className="text-[10px] text-[#0B3B2E] mt-0.5 font-semibold">
                        → {act.nextAction}{act.nextActionDate ? ` (${fmt(act.nextActionDate)})` : ""}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Add / Edit Lead Modal ─────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
          <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-lg sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
                <FaUserFriends />{editingId ? "Edit Lead" : "Add Lead"}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes /></button>
            </div>
            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelClass}>Full Name *</label>
                <input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              <div>
                <label className={labelClass}>Source</label>
                <AppSelect
                  value={form.source}
                  onChange={(v) => setForm((f) => ({ ...f, source: v ?? "" }))}
                  options={LEAD_SOURCE_OPTIONS}
                  size="md"
                />
              </div>
              <div>
                <label className={labelClass}>Status</label>
                <AppSelect
                  value={form.status}
                  onChange={(v) => setForm((f) => ({ ...f, status: v ?? "" }))}
                  options={LEAD_STATUS_FORM_OPTIONS}
                  size="md"
                />
              </div>
              <div>
                <label className={labelClass}>Assigned Agent</label>
                <AppSelect
                  value={form.assignedAgent}
                  onChange={(v) => setForm((f) => ({ ...f, assignedAgent: v ?? "" }))}
                  options={agents.map((a) => ({ value: a._id, label: a.fullName }))}
                  placeholder="— Unassigned —"
                  searchable
                  clearable
                  size="md"
                />
              </div>
              <div>
                <label className={labelClass}>Next Follow-up</label>
                <input type="date" value={form.nextFollowUpDate} onChange={(e) => setForm((f) => ({ ...f, nextFollowUpDate: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              <div>
                <label className={labelClass}>Budget Min (KES)</label>
                <input type="number" value={form.budgetMin} onChange={(e) => setForm((f) => ({ ...f, budgetMin: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              <div>
                <label className={labelClass}>Budget Max (KES)</label>
                <input type="number" value={form.budgetMax} onChange={(e) => setForm((f) => ({ ...f, budgetMax: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              {form.status === "lost" && (
                <div className="col-span-2">
                  <label className={labelClass}>Lost Reason</label>
                  <input value={form.lostReason} onChange={(e) => setForm((f) => ({ ...f, lostReason: e.target.value }))} className={`${modalInputCls} h-8`} />
                </div>
              )}
              <div className="col-span-2">
                <label className={labelClass}>Notes</label>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={`${modalInputCls} resize-none`} />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button onClick={() => setShowModal(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {saving ? "Saving…" : editingId ? "Update Lead" : "Create Lead"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Log / Edit Activity Modal ─────────────────────────────────────────── */}
      {showActModal && selected && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
          <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-md sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
            <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
                  <FaCalendarAlt />{editingAct ? "Edit Activity" : "Log Activity"}
                </h3>
                <div className="text-[10px] text-white/60 mt-0.5">for {selected.fullName}</div>
              </div>
              <button onClick={() => setActModal(false)} className="p-1 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes /></button>
            </div>
            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Type *</label>
                <AppSelect
                  value={actForm.type}
                  onChange={(v) => setActForm((f) => ({ ...f, type: v ?? "" }))}
                  options={ACTIVITY_TYPE_OPTIONS}
                  size="md"
                />
              </div>
              <div>
                <label className={labelClass}>Date & Time</label>
                <input type="datetime-local" value={actForm.date} onChange={(e) => setActForm((f) => ({ ...f, date: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Subject</label>
                <input value={actForm.subject} onChange={(e) => setActForm((f) => ({ ...f, subject: e.target.value }))} placeholder="e.g. Site visit — Westlands plot" className={`${modalInputCls} h-8`} />
              </div>
              <div>
                <label className={labelClass}>Duration (min)</label>
                <input type="number" value={actForm.durationMinutes} onChange={(e) => setActForm((f) => ({ ...f, durationMinutes: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              <div>
                <label className={labelClass}>Outcome</label>
                <AppSelect
                  value={actForm.outcome}
                  onChange={(v) => setActForm((f) => ({ ...f, outcome: v ?? "" }))}
                  options={OUTCOME_OPTIONS}
                  size="md"
                />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Notes</label>
                <textarea rows={3} value={actForm.notes} onChange={(e) => setActForm((f) => ({ ...f, notes: e.target.value }))} className={`${modalInputCls} resize-none`} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Next Action</label>
                <input value={actForm.nextAction} onChange={(e) => setActForm((f) => ({ ...f, nextAction: e.target.value }))} placeholder="e.g. Send site plan brochure" className={`${modalInputCls} h-8`} />
              </div>
              <div>
                <label className={labelClass}>Next Action Date</label>
                <input type="date" value={actForm.nextActionDate} onChange={(e) => setActForm((f) => ({ ...f, nextActionDate: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button onClick={() => setActModal(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleSaveAct} disabled={savingAct} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {savingAct ? "Saving…" : editingAct ? "Update" : "Log Activity"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Convert to Buyer Modal ─────────────────────────────────────────────── */}
      {showConvert && selected && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
          <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-sm sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
                <FaExchangeAlt />Convert to Buyer
              </h3>
              <button onClick={() => setShowConvert(false)} className="p-1 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes /></button>
            </div>
            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
              <p className="text-xs text-slate-600">
                Convert <strong>{selected.fullName}</strong> to a registered buyer. A buyer profile will be created automatically.
              </p>
              <div>
                <label className={labelClass}>ID / Passport Number</label>
                <input value={convertId} onChange={(e) => setConvertId(e.target.value)} placeholder="National ID or Passport No." className={`${modalInputCls} h-8`} />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button onClick={() => setShowConvert(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleConvert} disabled={converting} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {converting ? "Converting…" : "Convert to Buyer"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Convert to Offer Modal ───────────────────────────────────────────── */}
      {showConvertOffer && selected && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
          <form onSubmit={handleConvertToOffer} className="flex w-full flex-col bg-white shadow-2xl sm:max-w-md sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
            <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
                  <FaExchangeAlt />Convert Lead → Offer
                </h3>
                <div className="text-[10px] text-white/60 mt-0.5">{selected.fullName}</div>
              </div>
              <button type="button" onClick={() => setShowConvertOffer(false)} className="p-1 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes /></button>
            </div>
            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelClass}>Listing *</label>
                <AppSelect
                  value={offerForm.listing}
                  onChange={(v) => setOfferForm((f) => ({ ...f, listing: v ?? "" }))}
                  options={allListings.map((l) => ({ value: l._id, label: `${l.listingNumber} — ${l.title}` }))}
                  placeholder="Select listing…"
                  searchable
                  size="md"
                />
              </div>
              <div>
                <label className={labelClass}>Offer Amount (KES) *</label>
                <input type="number" min="0" step="1" value={offerForm.offerAmount} onChange={(e) => setOfferForm((f) => ({ ...f, offerAmount: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              <div>
                <label className={labelClass}>Valid Until</label>
                <input type="date" value={offerForm.validityDate} onChange={(e) => setOfferForm((f) => ({ ...f, validityDate: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Assigned Agent</label>
                <AppSelect
                  value={offerForm.agent}
                  onChange={(v) => setOfferForm((f) => ({ ...f, agent: v ?? "" }))}
                  options={agents.map((a) => ({ value: a._id, label: a.name }))}
                  placeholder="Select agent…"
                  size="md"
                />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Notes</label>
                <textarea rows={2} value={offerForm.notes} onChange={(e) => setOfferForm((f) => ({ ...f, notes: e.target.value }))} className={`${modalInputCls} resize-none`} />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setShowConvertOffer(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={convertingOffer} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {convertingOffer ? "Creating…" : "Create Offer"}
              </button>
            </div>
          </form>
        </div>
      )}
    </PropertySaleShell>
  );
}

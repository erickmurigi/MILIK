import React, { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import {
  FaCalendarAlt, FaClipboardList, FaEdit, FaEnvelope, FaExchangeAlt,
  FaPhone, FaPlus, FaSearch, FaTimes, FaTrash, FaUserFriends,
} from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import { fmtKES, saleApi } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";

const LEAD_STATUSES   = ["new", "contacted", "qualified", "site_visited", "proposal_sent", "negotiating", "converted", "lost"];
const LEAD_SOURCES    = ["walk_in", "referral", "online", "social_media", "agent", "cold_call", "other"];
const ACTIVITY_TYPES  = ["call", "email", "meeting", "site_visit", "whatsapp", "note", "follow_up"];
const OUTCOMES        = ["positive", "neutral", "negative", "no_answer", "not_applicable"];

const STATUS_COLORS = {
  new:           "bg-blue-50 border-blue-200 text-blue-700",
  contacted:     "bg-sky-50 border-sky-200 text-sky-700",
  qualified:     "bg-violet-50 border-violet-200 text-violet-700",
  site_visited:  "bg-indigo-50 border-indigo-200 text-indigo-700",
  proposal_sent: "bg-amber-50 border-amber-200 text-amber-700",
  negotiating:   "bg-orange-50 border-orange-200 text-orange-700",
  converted:     "bg-emerald-50 border-emerald-200 text-emerald-700",
  lost:          "bg-rose-50 border-rose-200 text-rose-700",
};
const OUTCOME_COLORS = {
  positive:       "text-emerald-600",
  neutral:        "text-slate-500",
  negative:       "text-rose-600",
  no_answer:      "text-amber-600",
  not_applicable: "text-slate-400",
};
const ACT_ICONS = { call: "📞", email: "✉️", meeting: "🤝", site_visit: "🏠", whatsapp: "💬", note: "📝", follow_up: "🔔" };

const blankLead = { fullName: "", phone: "", email: "", source: "walk_in", status: "new", assignedAgent: "", budgetMin: "", budgetMax: "", notes: "", lostReason: "", nextFollowUpDate: "" };
const blankAct  = { type: "call", subject: "", notes: "", date: "", durationMinutes: "", outcome: "not_applicable", nextAction: "", nextActionDate: "" };

const fmt    = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const isOld  = (date, status) => date && ["converted","lost"].indexOf(status) === -1 && new Date(date) < new Date();
const LIMIT  = 50;

export default function SaleLeads() {
  const confirm = useConfirm();
  const qc      = useQueryClient();
  const biz     = useSelector((s) => s.company?.currentCompany?._id);

  const [search, setSearch]           = useState("");
  const debSearch                     = useDebounce(search, 400);
  const [statusFilter, setStatus]     = useState("");
  const [sourceFilter, setSource]     = useState("");
  const [agentFilter,  setAgent]      = useState("");
  const [overdueOnly,  setOverdue]    = useState(false);
  const [page, setPage]               = useState(1);

  const [showModal,   setShowModal]   = useState(false);
  const [editingId,   setEditingId]   = useState("");
  const [form,        setForm]        = useState(blankLead);
  const [saving,      setSaving]      = useState(false);

  const [selected,    setSelected]    = useState(null);
  const [showActModal, setActModal]   = useState(false);
  const [editingAct,  setEditingAct]  = useState(null);
  const [actForm,     setActForm]     = useState(blankAct);
  const [savingAct,   setSavingAct]   = useState(false);

  const [showConvert, setShowConvert] = useState(false);
  const [convertId,   setConvertId]   = useState("");
  const [converting,  setConverting]  = useState(false);

  useEffect(() => setPage(1), [debSearch, statusFilter, sourceFilter, agentFilter, overdueOnly]);

  const { data: leadsData, isLoading } = useQuery({
    queryKey: ["sale-leads", biz, debSearch, statusFilter, sourceFilter, agentFilter, overdueOnly, page],
    queryFn:  () => saleApi.listLeads({ business: biz, search: debSearch, status: statusFilter, source: sourceFilter, agent: agentFilter, overdueOnly: overdueOnly ? "1" : "", page, limit: LIMIT }),
    enabled:  !!biz,
    placeholderData: (p) => p,
  });

  const { data: agentsData } = useQuery({
    queryKey: ["sale-agents-ref", biz],
    queryFn:  () => saleApi.listAgents({ business: biz, limit: 500 }),
    enabled:  !!biz,
  });
  const agents = agentsData?.data ?? [];

  const { data: pipelineData } = useQuery({
    queryKey: ["sale-leads-pipeline", biz],
    queryFn:  () => saleApi.getLeadsPipeline({ business: biz }),
    enabled:  !!biz,
  });

  const { data: activitiesData, isLoading: loadingActs } = useQuery({
    queryKey: ["sale-activities-lead", biz, selected?._id],
    queryFn:  () => saleApi.listActivities({ business: biz, relatedLead: selected._id, limit: 100 }),
    enabled:  !!biz && !!selected?._id,
  });

  const leads      = leadsData?.data ?? [];
  const total      = leadsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const pipeline   = pipelineData?.pipeline ?? [];
  const leadActs   = activitiesData?.data ?? [];

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["sale-leads", biz] });
    qc.invalidateQueries({ queryKey: ["sale-leads-pipeline", biz] });
  }, [qc, biz]);

  // ── Lead CRUD ──────────────────────────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PropertySaleShell activeKey="sale-crm-leads">
      <div className="flex h-full relative">

        {/* ── Main panel ────────────────────────────────────────────────────── */}
        <div className={`flex-1 flex flex-col overflow-hidden ${selected ? "mr-[22rem]" : ""}`}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white flex-shrink-0">
            <div className="flex items-center gap-2">
              <FaUserFriends className="text-indigo-500" />
              <h2 className="font-semibold text-slate-700 text-sm">CRM — Leads Pipeline</h2>
              {total > 0 && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{total}</span>}
            </div>
            <button onClick={openCreate} className="flex items-center gap-1.5 bg-indigo-600 text-white text-xs px-3 py-1.5 rounded hover:bg-indigo-700 transition-colors">
              <FaPlus size={10} /> Add Lead
            </button>
          </div>

          {/* Pipeline funnel */}
          {pipeline.length > 0 && (
            <div className="flex gap-1 px-4 py-2 bg-slate-50 border-b border-slate-200 overflow-x-auto flex-shrink-0">
              {LEAD_STATUSES.map((s) => {
                const count = pipeline.find((p) => p._id === s)?.count ?? 0;
                return (
                  <button key={s} onClick={() => setStatus(statusFilter === s ? "" : s)}
                    className={`flex-shrink-0 text-center px-3 py-1.5 rounded border text-xs transition-all ${statusFilter === s ? STATUS_COLORS[s] + " font-semibold" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                    <div className="font-bold text-sm">{count}</div>
                    <div className="capitalize leading-tight">{s.replace(/_/g, " ")}</div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-white border-b border-slate-200 flex-shrink-0">
            <div className="relative flex-1 min-w-36">
              <FaSearch size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads…"
                className="w-full pl-7 pr-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-[#0B3B2E]" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatus(e.target.value)} className="border border-slate-300 rounded text-xs px-2 py-1.5 focus:outline-none">
              <option value="">All Statuses</option>
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
            <select value={sourceFilter} onChange={(e) => setSource(e.target.value)} className="border border-slate-300 rounded text-xs px-2 py-1.5 focus:outline-none">
              <option value="">All Sources</option>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
            <select value={agentFilter} onChange={(e) => setAgent(e.target.value)} className="border border-slate-300 rounded text-xs px-2 py-1.5 focus:outline-none">
              <option value="">All Agents</option>
              {agents.map((a) => <option key={a._id} value={a._id}>{a.fullName}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none whitespace-nowrap">
              <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdue(e.target.checked)} className="rounded" />
              Overdue only
            </label>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="p-10 text-center text-slate-400 text-sm">Loading…</div>
            ) : leads.length === 0 ? (
              <div className="p-10 text-center text-slate-400 text-sm">No leads found</div>
            ) : (
              <table className="w-full text-[11px] border-collapse">
                <thead className="bg-[#027333] text-white sticky top-0 z-10">
                  <tr>
                    {["#","Lead #","Name","Contact","Source","Status","Agent","Budget","Next Follow-up",""].map((h, i, arr) => (
                      <th key={h} className={`text-left px-3 py-1 font-bold whitespace-nowrap ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead, i) => {
                    const overdue  = isOld(lead.nextFollowUpDate, lead.status);
                    const isSel    = selected?._id === lead._id;
                    return (
                      <tr key={lead._id} onClick={() => setSelected(isSel ? null : lead)}
                        className={`border-b border-gray-100 cursor-pointer transition-colors ${isSel ? "bg-indigo-50" : i % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"} ${overdue ? "border-l-2 border-l-rose-400" : ""}`}>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-400">{(page - 1) * LIMIT + i + 1}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-500 font-mono">{lead.leadNumber}</td>
                        <td className="px-3 py-1 border-r border-gray-100 font-medium text-slate-700 whitespace-nowrap">{lead.fullName}</td>
                        <td className="px-3 py-1 border-r border-gray-100">
                          <div className="flex flex-col gap-0.5">
                            {lead.phone && <span className="flex items-center gap-1 text-slate-600"><FaPhone size={9} />{lead.phone}</span>}
                            {lead.email && <span className="flex items-center gap-1 text-slate-400"><FaEnvelope size={9} />{lead.email}</span>}
                          </div>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-500 capitalize whitespace-nowrap">{(lead.source || "").replace(/_/g, " ")}</td>
                        <td className="px-3 py-1 border-r border-gray-100 whitespace-nowrap">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black capitalize ${STATUS_COLORS[lead.status] || ""}`}>
                            {(lead.status || "").replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-500 whitespace-nowrap">{lead.assignedAgent?.fullName || "—"}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-500 whitespace-nowrap">
                          {lead.budgetMin || lead.budgetMax
                            ? `${lead.budgetMin ? fmtKES(lead.budgetMin) : "?"} – ${lead.budgetMax ? fmtKES(lead.budgetMax) : "?"}`
                            : "—"}
                        </td>
                        <td className={`px-3 py-1 border-r border-gray-100 whitespace-nowrap ${overdue ? "text-rose-600 font-medium" : "text-slate-500"}`}>
                          {lead.nextFollowUpDate
                            ? <span className="flex items-center gap-1"><FaCalendarAlt size={9} />{fmt(lead.nextFollowUpDate)}{overdue ? " !" : ""}</span>
                            : "—"}
                        </td>
                        <td className="px-3 py-1" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-0.5">
                            <button onClick={() => openLogAct(lead)} title="Log Activity" className="p-1.5 text-indigo-500 hover:text-indigo-700 rounded hover:bg-indigo-50"><FaClipboardList size={11} /></button>
                            <button onClick={() => openEdit(lead)} title="Edit" className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100"><FaEdit size={11} /></button>
                            {lead.status !== "converted" && (
                              <button onClick={() => handleDelete(lead)} title="Delete" className="p-1.5 text-rose-400 hover:text-rose-600 rounded hover:bg-rose-50"><FaTrash size={11} /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 bg-white flex-shrink-0">
              <span className="text-xs text-slate-500">{total} leads · Page {page} of {totalPages}</span>
              <div className="flex gap-1">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="text-xs px-2.5 py-1 border rounded disabled:opacity-40 hover:bg-slate-50">‹</button>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="text-xs px-2.5 py-1 border rounded disabled:opacity-40 hover:bg-slate-50">›</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Lead Detail Panel ──────────────────────────────────────────────── */}
        {selected && (
          <div className="absolute right-0 top-0 bottom-0 w-88 bg-white border-l border-slate-200 shadow-xl flex flex-col overflow-hidden" style={{ width: "22rem" }}>
            <div className="flex items-start justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
              <div>
                <div className="font-semibold text-slate-700 text-sm leading-tight">{selected.fullName}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex px-1.5 py-0.5 rounded border text-xs capitalize ${STATUS_COLORS[selected.status] || ""}`}>
                    {(selected.status || "").replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">{selected.leadNumber}</span>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 p-1 mt-0.5"><FaTimes size={14} /></button>
            </div>

            {/* Info */}
            <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0 space-y-1.5 text-xs">
              {selected.phone && <div className="flex items-center gap-2 text-slate-600"><FaPhone size={9} className="text-slate-400 flex-shrink-0" />{selected.phone}</div>}
              {selected.email && <div className="flex items-center gap-2 text-slate-500"><FaEnvelope size={9} className="text-slate-400 flex-shrink-0" />{selected.email}</div>}
              {selected.assignedAgent && <div className="text-slate-500">Agent: <span className="text-slate-700">{selected.assignedAgent?.fullName || selected.assignedAgent}</span></div>}
              {(selected.budgetMin || selected.budgetMax) && (
                <div className="text-slate-500">Budget: <span className="text-slate-700">{selected.budgetMin ? fmtKES(selected.budgetMin) : "?"} – {selected.budgetMax ? fmtKES(selected.budgetMax) : "?"}</span></div>
              )}
              {selected.nextFollowUpDate && (
                <div className={`flex items-center gap-1 ${isOld(selected.nextFollowUpDate, selected.status) ? "text-rose-600 font-medium" : "text-slate-500"}`}>
                  <FaCalendarAlt size={9} />Next follow-up: {fmt(selected.nextFollowUpDate)}{isOld(selected.nextFollowUpDate, selected.status) ? " — overdue!" : ""}
                </div>
              )}
              {selected.lastContactDate && <div className="text-slate-400">Last contact: {fmt(selected.lastContactDate)}</div>}
              {selected.notes && <div className="text-slate-500 italic">{selected.notes}</div>}
              {selected.lostReason && <div className="text-rose-500">Lost: {selected.lostReason}</div>}
            </div>

            {/* Actions */}
            <div className="flex gap-2 px-4 py-2 border-b border-slate-100 flex-shrink-0">
              <button onClick={() => openEdit(selected)} className="flex-1 text-xs py-1.5 border border-slate-300 rounded text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-1">
                <FaEdit size={10} /> Edit
              </button>
              {selected.status !== "converted" && selected.status !== "lost" ? (
                <button onClick={() => { setConvertId(""); setShowConvert(true); }} className="flex-1 text-xs py-1.5 border border-emerald-300 rounded text-emerald-700 hover:bg-emerald-50 flex items-center justify-center gap-1">
                  <FaExchangeAlt size={10} /> Convert
                </button>
              ) : selected.convertedBuyer ? (
                <span className="flex-1 text-xs py-1.5 text-center text-emerald-600 bg-emerald-50 rounded border border-emerald-200">✓ Buyer created</span>
              ) : null}
            </div>

            {/* Activity log */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 flex-shrink-0">
              <span className="text-xs font-semibold text-slate-600">Activity Log</span>
              <button onClick={() => openLogAct(selected)} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                <FaPlus size={9} /> Log
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
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
                      <span className="text-xs font-medium text-slate-700 capitalize leading-tight">
                        {(act.type || "").replace(/_/g, " ")}{act.subject ? ` — ${act.subject}` : ""}
                      </span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button onClick={() => openEditAct(act)} className="text-slate-400 hover:text-slate-600 p-0.5"><FaEdit size={10} /></button>
                        <button onClick={() => handleDeleteAct(act)} className="text-slate-400 hover:text-rose-600 p-0.5"><FaTrash size={10} /></button>
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">{fmt(act.date)}{act.durationMinutes ? ` · ${act.durationMinutes} min` : ""}</div>
                    {act.outcome && act.outcome !== "not_applicable" && (
                      <div className={`text-xs capitalize mt-0.5 ${OUTCOME_COLORS[act.outcome]}`}>
                        Outcome: {act.outcome.replace(/_/g, " ")}
                      </div>
                    )}
                    {act.notes && <div className="text-xs text-slate-500 mt-0.5">{act.notes}</div>}
                    {act.nextAction && (
                      <div className="text-xs text-indigo-600 mt-0.5">
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

      {/* ── Add / Edit Lead Modal ──────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide"><FaUserFriends />{editingId ? "Edit Lead" : "Add Lead"}</h3>
              <button onClick={() => setShowModal(false)} className="text-white/70 transition-colors hover:text-white"><FaTimes /></button>
            </div>
            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Full Name *</label>
                <input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Phone</label>
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Source</label>
                <select value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none">
                  {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Status</label>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none">
                  {LEAD_STATUSES.filter((s) => s !== "converted").map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Assigned Agent</label>
                <select value={form.assignedAgent} onChange={(e) => setForm((f) => ({ ...f, assignedAgent: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none">
                  <option value="">— Unassigned —</option>
                  {agents.map((a) => <option key={a._id} value={a._id}>{a.fullName}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Next Follow-up</label>
                <input type="date" value={form.nextFollowUpDate} onChange={(e) => setForm((f) => ({ ...f, nextFollowUpDate: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Budget Min (KES)</label>
                <input type="number" value={form.budgetMin} onChange={(e) => setForm((f) => ({ ...f, budgetMin: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Budget Max (KES)</label>
                <input type="number" value={form.budgetMax} onChange={(e) => setForm((f) => ({ ...f, budgetMax: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              {form.status === "lost" && (
                <div className="col-span-2">
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Lost Reason</label>
                  <input value={form.lostReason} onChange={(e) => setForm((f) => ({ ...f, lostReason: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
                </div>
              )}
              <div className="col-span-2">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Notes</label>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none resize-none" />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button onClick={() => setShowModal(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-100">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0d5442] disabled:opacity-50">
                {saving ? "Saving…" : editingId ? "Update" : "Create Lead"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Log Activity Modal ─────────────────────────────────────────────────── */}
      {showActModal && selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide"><FaCalendarAlt />{editingAct ? "Edit Activity" : "Log Activity"}</h3>
                <div className="text-[10px] text-white/60 mt-0.5">for {selected.fullName}</div>
              </div>
              <button onClick={() => setActModal(false)} className="text-white/70 transition-colors hover:text-white"><FaTimes /></button>
            </div>
            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Type *</label>
                <select value={actForm.type} onChange={(e) => setActForm((f) => ({ ...f, type: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none">
                  {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Date & Time</label>
                <input type="datetime-local" value={actForm.date} onChange={(e) => setActForm((f) => ({ ...f, date: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Subject</label>
                <input value={actForm.subject} onChange={(e) => setActForm((f) => ({ ...f, subject: e.target.value }))} placeholder="e.g. Site visit — Westlands plot" className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Duration (min)</label>
                <input type="number" value={actForm.durationMinutes} onChange={(e) => setActForm((f) => ({ ...f, durationMinutes: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Outcome</label>
                <select value={actForm.outcome} onChange={(e) => setActForm((f) => ({ ...f, outcome: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none">
                  {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Notes</label>
                <textarea rows={3} value={actForm.notes} onChange={(e) => setActForm((f) => ({ ...f, notes: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none resize-none" />
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Next Action</label>
                <input value={actForm.nextAction} onChange={(e) => setActForm((f) => ({ ...f, nextAction: e.target.value }))} placeholder="e.g. Send site plan brochure" className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Next Action Date</label>
                <input type="date" value={actForm.nextActionDate} onChange={(e) => setActForm((f) => ({ ...f, nextActionDate: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button onClick={() => setActModal(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-100">Cancel</button>
              <button onClick={handleSaveAct} disabled={savingAct} className="flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0d5442] disabled:opacity-50">
                {savingAct ? "Saving…" : editingAct ? "Update" : "Log Activity"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Convert to Buyer Modal ─────────────────────────────────────────────── */}
      {showConvert && selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide"><FaExchangeAlt />Convert to Buyer</h3>
              <button onClick={() => setShowConvert(false)} className="text-white/70 transition-colors hover:text-white"><FaTimes /></button>
            </div>
            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
              <p className="text-sm text-slate-600">
                Convert <strong>{selected.fullName}</strong> to a registered buyer. A buyer profile will be created automatically.
              </p>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">ID / Passport Number</label>
                <input value={convertId} onChange={(e) => setConvertId(e.target.value)} placeholder="National ID or Passport No." className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button onClick={() => setShowConvert(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-100">Cancel</button>
              <button onClick={handleConvert} disabled={converting} className="flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0d5442] disabled:opacity-50">
                {converting ? "Converting…" : "Convert to Buyer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PropertySaleShell>
  );
}

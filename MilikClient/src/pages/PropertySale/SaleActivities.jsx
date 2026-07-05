import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { FaCalendarAlt, FaEdit, FaFilter, FaPlus, FaTimes, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import { saleApi } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";

const ACTIVITY_TYPES = ["call", "email", "meeting", "site_visit", "whatsapp", "note", "follow_up"];
const OUTCOMES       = ["positive", "neutral", "negative", "no_answer", "not_applicable"];
const ACT_ICONS      = { call: "ðŸ“ž", email: "âœ‰ï¸", meeting: "ðŸ¤", site_visit: "ðŸ ", whatsapp: "ðŸ’¬", note: "ðŸ“", follow_up: "ðŸ””" };
const OUTCOME_COLORS = { positive: "text-emerald-600", neutral: "text-slate-500", negative: "text-rose-600", no_answer: "text-amber-600", not_applicable: "text-slate-400" };
const TYPE_COLORS    = { call: "bg-blue-100 text-blue-700", email: "bg-indigo-100 text-indigo-700", meeting: "bg-violet-100 text-violet-700", site_visit: "bg-emerald-100 text-emerald-700", whatsapp: "bg-green-100 text-green-700", note: "bg-slate-100 text-slate-600", follow_up: "bg-amber-100 text-amber-700" };

const blankForm = { type: "call", subject: "", notes: "", date: "", durationMinutes: "", outcome: "not_applicable", nextAction: "", nextActionDate: "", relatedLead: "", relatedBuyer: "", relatedDeal: "" };

const fmt    = (v) => v ? new Date(v).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "â€”";
const fmtDay = (v) => v ? new Date(v).toLocaleDateString("en-KE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) : "";
const LIMIT  = 50;

function groupByDay(activities) {
  const groups = new Map();
  for (const a of activities) {
    const day = new Date(a.date).toDateString();
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(a);
  }
  return groups;
}

export default function SaleActivities() {
  const confirm = useConfirm();
  const qc      = useQueryClient();
  const biz     = useSelector((s) => s.company?.currentCompany?._id);

  const [typeFilter,    setType]    = useState("");
  const [outcomeFilter, setOutcome] = useState("");
  const [from,          setFrom]    = useState("");
  const [to,            setTo]      = useState("");
  const [page,          setPage]    = useState(1);

  const [showModal, setShowModal]   = useState(false);
  const [editingId, setEditingId]   = useState("");
  const [form,      setForm]        = useState(blankForm);
  const [saving,    setSaving]      = useState(false);

  useEffect(() => setPage(1), [typeFilter, outcomeFilter, from, to]);

  const { data: activitiesData, isLoading } = useQuery({
    queryKey: ["sale-activities-all", biz, typeFilter, outcomeFilter, from, to, page],
    queryFn:  () => saleApi.listActivities({ business: biz, type: typeFilter, outcome: outcomeFilter, from, to, page, limit: LIMIT }),
    enabled:  !!biz,
    placeholderData: (p) => p,
  });

  const { data: leadsData }  = useQuery({ queryKey: ["sale-leads-ref", biz],  queryFn: () => saleApi.listLeads({ business: biz, limit: 500 }),  enabled: !!biz });
  const { data: buyersData } = useQuery({ queryKey: ["sale-buyers-ref", biz], queryFn: () => saleApi.listBuyers({ business: biz, limit: 500 }), enabled: !!biz });
  const { data: dealsData }  = useQuery({ queryKey: ["sale-deals-ref", biz],  queryFn: () => saleApi.listDeals({ business: biz, limit: 500 }),  enabled: !!biz });

  const activities = activitiesData?.data ?? [];
  const total      = activitiesData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const grouped    = groupByDay(activities);

  const leads  = leadsData?.data  ?? [];
  const buyers = buyersData?.data ?? [];
  const deals  = dealsData?.data  ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sale-activities-all", biz] });
    qc.invalidateQueries({ queryKey: ["sale-activities-lead", biz] });
    qc.invalidateQueries({ queryKey: ["sale-leads", biz] });
  };

  const openCreate = () => {
    setEditingId("");
    setForm({ ...blankForm, date: new Date().toISOString().slice(0, 16) });
    setShowModal(true);
  };
  const openEdit = (act) => {
    setEditingId(act._id);
    setForm({
      type: act.type, subject: act.subject || "", notes: act.notes || "",
      date: new Date(act.date).toISOString().slice(0, 16),
      durationMinutes: act.durationMinutes || "",
      outcome: act.outcome || "not_applicable",
      nextAction: act.nextAction || "",
      nextActionDate: act.nextActionDate ? new Date(act.nextActionDate).toISOString().slice(0, 10) : "",
      relatedLead:  act.relatedLead?._id  || act.relatedLead  || "",
      relatedBuyer: act.relatedBuyer?._id || act.relatedBuyer || "",
      relatedDeal:  act.relatedDeal?._id  || act.relatedDeal  || "",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.type) return toast.warning("Activity type is required");
    if (!form.date) return toast.warning("Date is required");
    setSaving(true);
    try {
      const payload = { ...form, business: biz };
      if (editingId) await saleApi.updateActivity(editingId, payload);
      else await saleApi.createActivity(payload);
      invalidate();
      setShowModal(false);
      toast.success(`Activity ${editingId ? "updated" : "logged"}`);
    } catch (err) { toast.error(err?.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (act) => {
    if (!await confirm({ title: "Delete Activity", message: "Remove this activity record?", confirmText: "Remove", isDangerous: true })) return;
    try {
      await saleApi.deleteActivity(act._id);
      invalidate();
      toast.success("Activity removed");
    } catch (err) { toast.error("Delete failed"); }
  };

  const entityLabel = (act) => {
    if (act.relatedLead)    return `Lead: ${act.relatedLead.fullName || act.relatedLead.leadNumber}`;
    if (act.relatedBuyer)   return `Buyer: ${act.relatedBuyer.fullName || act.relatedBuyer.buyerNumber}`;
    if (act.relatedDeal)    return `Deal: ${act.relatedDeal.dealNumber}`;
    if (act.relatedListing) return `Listing: ${act.relatedListing.title || act.relatedListing.listingNumber}`;
    return null;
  };

  return (
    <PropertySaleShell activeKey="sale-crm-activities">
      <div className="flex flex-col h-full">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white flex-shrink-0">
          <div className="flex items-center gap-2">
            <FaFilter className="text-indigo-400" size={13} />
            <h2 className="font-semibold text-slate-700 text-sm">CRM â€” Activity Log</h2>
            {total > 0 && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{total}</span>}
          </div>
          <button onClick={openCreate} className="flex items-center gap-1.5 bg-indigo-600 text-white text-xs px-3 py-1.5 rounded hover:bg-indigo-700 transition-colors">
            <FaPlus size={10} /> Log Activity
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-white border-b border-slate-200 flex-shrink-0">
          <select value={typeFilter} onChange={(e) => setType(e.target.value)} className="border border-slate-300 rounded text-xs px-2 py-1.5 focus:outline-none">
            <option value="">All Types</option>
            {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          <select value={outcomeFilter} onChange={(e) => setOutcome(e.target.value)} className="border border-slate-300 rounded text-xs px-2 py-1.5 focus:outline-none">
            <option value="">All Outcomes</option>
            {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 rounded text-xs px-2 py-1.5 focus:outline-none" />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 rounded text-xs px-2 py-1.5 focus:outline-none" />
          </div>
          {(typeFilter || outcomeFilter || from || to) && (
            <button onClick={() => { setType(""); setOutcome(""); setFrom(""); setTo(""); }} className="text-xs text-slate-500 hover:text-slate-700 underline">Clear</button>
          )}
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-auto px-4 py-4 space-y-6">
          {isLoading && <div className="text-center text-slate-400 text-sm py-10">Loadingâ€¦</div>}
          {!isLoading && activities.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-10">No activities found</div>
          )}
          {[...grouped.entries()].map(([day, dayActs]) => (
            <div key={day}>
              <div className="text-xs font-semibold text-slate-500 mb-3 flex items-center gap-2">
                <span>{fmtDay(dayActs[0].date)}</span>
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-slate-400">{dayActs.length}</span>
              </div>
              <div className="space-y-2">
                {dayActs.map((act) => (
                  <div key={act._id} className="flex gap-3 group bg-white border border-slate-100 rounded-lg px-4 py-3 hover:border-slate-200 transition-colors">
                    <div className="text-xl flex-shrink-0 mt-0.5">{ACT_ICONS[act.type] || "ðŸ“‹"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${TYPE_COLORS[act.type] || "bg-slate-100 text-slate-600"}`}>
                            {(act.type || "").replace(/_/g, " ")}
                          </span>
                          {act.subject && <span className="text-xs font-medium text-slate-700">{act.subject}</span>}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button onClick={() => openEdit(act)} className="p-1 text-slate-400 hover:text-slate-600 rounded"><FaEdit size={11} /></button>
                          <button onClick={() => handleDelete(act)} className="p-1 text-slate-400 hover:text-rose-600 rounded"><FaTrash size={11} /></button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-400">
                        <span>{fmt(act.date)}</span>
                        {act.durationMinutes > 0 && <span>{act.durationMinutes} min</span>}
                        {act.outcome && act.outcome !== "not_applicable" && (
                          <span className={`capitalize ${OUTCOME_COLORS[act.outcome]}`}>{act.outcome.replace(/_/g, " ")}</span>
                        )}
                        {entityLabel(act) && <span className="text-indigo-500">{entityLabel(act)}</span>}
                        {act.createdBy && <span>by {act.createdBy.name || act.createdBy.fullName}</span>}
                      </div>
                      {act.notes && <p className="text-xs text-slate-500 mt-1.5">{act.notes}</p>}
                      {act.nextAction && (
                        <p className="text-xs text-indigo-600 mt-1">
                          â†’ {act.nextAction}{act.nextActionDate ? ` Â· ${new Date(act.nextActionDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short" })}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 bg-white flex-shrink-0">
            <span className="text-xs text-slate-500">{total} activities Â· Page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="text-xs px-2.5 py-1 border rounded disabled:opacity-40 hover:bg-slate-50">â€¹</button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="text-xs px-2.5 py-1 border rounded disabled:opacity-40 hover:bg-slate-50">â€º</button>
            </div>
          </div>
        )}
      </div>

      {/* â”€â”€ Log / Edit Activity Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide"><FaCalendarAlt />{editingId ? "Edit Activity" : "Log Activity"}</h3>
              <button onClick={() => setShowModal(false)} className="text-white/70 transition-colors hover:text-white"><FaTimes /></button>
            </div>
            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Type *</label>
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none">
                  {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Date & Time *</label>
                <input type="datetime-local" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Subject</label>
                <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Outcome</label>
                <select value={form.outcome} onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none">
                  {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Duration (min)</label>
                <input type="number" value={form.durationMinutes} onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>

              {/* Linking â€” at most one entity */}
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Link to Lead</label>
                <select value={form.relatedLead} onChange={(e) => setForm((f) => ({ ...f, relatedLead: e.target.value, relatedBuyer: "", relatedDeal: "" }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none">
                  <option value="">â€” None â€”</option>
                  {leads.map((l) => <option key={l._id} value={l._id}>{l.fullName} ({l.leadNumber})</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Link to Buyer</label>
                <select value={form.relatedBuyer} onChange={(e) => setForm((f) => ({ ...f, relatedBuyer: e.target.value, relatedLead: "", relatedDeal: "" }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" disabled={!!form.relatedLead}>
                  <option value="">â€” None â€”</option>
                  {buyers.map((b) => <option key={b._id} value={b._id}>{b.fullName} ({b.buyerNumber})</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Link to Deal</label>
                <select value={form.relatedDeal} onChange={(e) => setForm((f) => ({ ...f, relatedDeal: e.target.value, relatedLead: "", relatedBuyer: "" }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" disabled={!!(form.relatedLead || form.relatedBuyer)}>
                  <option value="">â€” None â€”</option>
                  {deals.map((d) => <option key={d._id} value={d._id}>{d.dealNumber}{d.buyer?.fullName ? ` â€” ${d.buyer.fullName}` : ""}</option>)}
                </select>
              </div>

              <div className="col-span-2">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Notes</label>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none resize-none" />
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Next Action</label>
                <input value={form.nextAction} onChange={(e) => setForm((f) => ({ ...f, nextAction: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Next Action Date</label>
                <input type="date" value={form.nextActionDate} onChange={(e) => setForm((f) => ({ ...f, nextActionDate: e.target.value }))} className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:outline-none" />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button onClick={() => setShowModal(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-100">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0d5442] disabled:opacity-50">
                {saving ? "Savingâ€¦" : editingId ? "Update" : "Log Activity"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PropertySaleShell>
  );
}

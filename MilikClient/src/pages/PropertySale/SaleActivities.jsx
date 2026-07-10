import React, { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { FaCalendarAlt, FaEdit, FaPlus, FaTimes, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import PaginationBar from "../../components/PaginationBar";
import { saleApi } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import { useTabState } from "../../hooks/useTabState";

const ACTIVITY_TYPES = ["call", "email", "meeting", "site_visit", "whatsapp", "note", "follow_up"];
const OUTCOMES       = ["positive", "neutral", "negative", "no_answer", "not_applicable"];
const ACT_ICONS      = { call: "📞", email: "✉️", meeting: "🤝", site_visit: "🏠", whatsapp: "💬", note: "📝", follow_up: "🔔" };
const OUTCOME_COLORS = { positive: "text-emerald-600", neutral: "text-slate-500", negative: "text-rose-600", no_answer: "text-amber-600", not_applicable: "text-slate-400" };
const G = "bg-[#F1F6F3] border-[#B7C9C0] text-[#0B3B2E]";
const O = "bg-orange-50 border-orange-200 text-orange-700";
const TYPE_COLORS    = { call: G, email: O, meeting: G, site_visit: O, whatsapp: G, note: O, follow_up: G };

const blankForm = { type: "call", subject: "", notes: "", date: "", durationMinutes: "", outcome: "not_applicable", nextAction: "", nextActionDate: "", relatedLead: "", relatedBuyer: "", relatedDeal: "" };

const fmt    = (v) => v ? new Date(v).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDay = (v) => v ? new Date(v).toLocaleDateString("en-KE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) : "";
const fmtShort = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short" }) : "";
const LIMIT  = 50;

const inputCls  = "h-7 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none";
const selectCls = "h-7 border border-slate-200 bg-white px-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none";
const labelCls  = "mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500";
const modalInputCls = "w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0B3B2E] focus:outline-none";

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

  const [typeFilter,    setType]      = useState("");
  const [outcomeFilter, setOutcome]   = useState("");
  const [from,          setFrom]      = useState("");
  const [to,            setTo]        = useState("");
  const [page,          setPage]      = useState(1);
  const [pageSize,      setPageSize]  = useState(LIMIT);

  const [showModal, setShowModal]     = useState(false);
  const [editingId, setEditingId]     = useState("");
  const [form,      setForm]          = useState(blankForm);
  const [saving,    setSaving]        = useState(false);

  useEffect(() => setPage(1), [typeFilter, outcomeFilter, from, to]);

  const { data: activitiesData, isLoading, isFetching } = useQuery({
    queryKey: ["sale-activities-all", biz, typeFilter, outcomeFilter, from, to, page, pageSize],
    queryFn:  () => saleApi.listActivities({ business: biz, type: typeFilter, outcome: outcomeFilter, from, to, page, limit: pageSize }),
    enabled:  !!biz,
    placeholderData: (p) => p,
    staleTime: 30_000,
  });

  const { data: leadsData }  = useQuery({ queryKey: ["sale-leads-ref",  biz], queryFn: () => saleApi.listLeads({ business: biz, limit: 500 }),  enabled: !!biz, staleTime: 5 * 60_000 });
  const { data: buyersData } = useQuery({ queryKey: ["sale-buyers-ref", biz], queryFn: () => saleApi.listBuyers({ business: biz, limit: 500 }), enabled: !!biz, staleTime: 5 * 60_000 });
  const { data: dealsData }  = useQuery({ queryKey: ["sale-deals-ref",  biz], queryFn: () => saleApi.listDeals({ business: biz, limit: 500 }),  enabled: !!biz, staleTime: 5 * 60_000 });

  const activities = activitiesData?.data ?? [];
  const total      = activitiesData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const grouped    = groupByDay(activities);

  const leads  = leadsData?.data  ?? [];
  const buyers = buyersData?.data ?? [];
  const deals  = dealsData?.data  ?? [];

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["sale-activities-all", biz] });
    qc.invalidateQueries({ queryKey: ["sale-activities-lead", biz] });
    qc.invalidateQueries({ queryKey: ["sale-leads", biz] });
  }, [qc, biz]);

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

  const hasFilters = !!(typeFilter || outcomeFilter || from || to);

  return (
    <PropertySaleShell
      title="CRM — Activity Log"
      subtitle={total > 0 ? `${total} activit${total === 1 ? "y" : "ies"}` : undefined}
      action={
        <button
          onClick={openCreate}
          className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
        >
          <FaPlus size={9} /> Log Activity
        </button>
      }
    >
      <div className="flex flex-col h-full">

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-1.5 flex-shrink-0">
          <select value={typeFilter} onChange={(e) => setType(e.target.value)} className={`${selectCls} w-[120px]`}>
            <option value="">All Types</option>
            {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          <select value={outcomeFilter} onChange={(e) => setOutcome(e.target.value)} className={`${selectCls} w-[130px]`}>
            <option value="">All Outcomes</option>
            {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-semibold text-slate-500">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} w-[130px]`} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-semibold text-slate-500">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} w-[130px]`} />
          </div>
          {hasFilters && (
            <button
              onClick={() => { setType(""); setOutcome(""); setFrom(""); setTo(""); }}
              className="border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            >
              Clear
            </button>
          )}
        </div>

        {/* Timeline + PaginationBar */}
        <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
          <div className="flex-1 min-h-0 overflow-auto px-4 py-4 space-y-6">
            {isLoading && <div className="text-center text-slate-400 text-xs py-10">Loading…</div>}
            {!isLoading && activities.length === 0 && (
              <div className="text-center text-slate-400 text-xs py-10">No activities found</div>
            )}
            {[...grouped.entries()].map(([day, dayActs]) => (
              <div key={day}>
                <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <span>{fmtDay(dayActs[0].date)}</span>
                  <span className="h-px flex-1 bg-slate-200" />
                  <span className="border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-400">{dayActs.length}</span>
                </div>
                <div className="space-y-1.5">
                  {dayActs.map((act) => {
                    const entity = entityLabel(act);
                    return (
                      <div key={act._id} className="group flex gap-3 border border-slate-100 bg-white px-4 py-3 hover:border-[#B7C9C0] hover:bg-[#F1F6F3]">
                        <div className="mt-0.5 flex-shrink-0 text-base">{ACT_ICONS[act.type] || "📋"}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${TYPE_COLORS[act.type] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
                                {(act.type || "").replace(/_/g, " ")}
                              </span>
                              {act.subject && <span className="text-xs font-semibold text-slate-700">{act.subject}</span>}
                            </div>
                            <div className="flex flex-shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <button onClick={() => openEdit(act)} className="border border-[#B7C9C0] bg-white p-1 text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaEdit size={9} /></button>
                              <button onClick={() => handleDelete(act)} className="border border-rose-200 bg-rose-50 p-1 text-rose-600 hover:bg-rose-100"><FaTrash size={9} /></button>
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
                            <span>{fmt(act.date)}</span>
                            {act.durationMinutes > 0 && <span>{act.durationMinutes} min</span>}
                            {act.outcome && act.outcome !== "not_applicable" && (
                              <span className={`capitalize ${OUTCOME_COLORS[act.outcome]}`}>{act.outcome.replace(/_/g, " ")}</span>
                            )}
                            {entity && <span className="font-semibold text-[#0B3B2E]">{entity}</span>}
                            {act.createdBy && <span>by {act.createdBy.name || act.createdBy.fullName}</span>}
                          </div>
                          {act.notes && <p className="mt-1 text-[11px] text-slate-500">{act.notes}</p>}
                          {act.nextAction && (
                            <p className="mt-1 text-[11px] font-semibold text-[#0B3B2E]">
                              → {act.nextAction}{act.nextActionDate ? ` · ${fmtShort(act.nextActionDate)}` : ""}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

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

      {/* ── Log / Edit Activity Modal ──────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
          <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-lg sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
                <FaCalendarAlt />{editingId ? "Edit Activity" : "Log Activity"}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes /></button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Type *</label>
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className={`${modalInputCls} h-8`}>
                  {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Date & Time *</label>
                <input type="datetime-local" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Subject</label>
                <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              <div>
                <label className={labelCls}>Outcome</label>
                <select value={form.outcome} onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))} className={`${modalInputCls} h-8`}>
                  {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Duration (min)</label>
                <input type="number" value={form.durationMinutes} onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>

              <div>
                <label className={labelCls}>Link to Lead</label>
                <select value={form.relatedLead} onChange={(e) => setForm((f) => ({ ...f, relatedLead: e.target.value, relatedBuyer: "", relatedDeal: "" }))} className={`${modalInputCls} h-8`}>
                  <option value="">— None —</option>
                  {leads.map((l) => <option key={l._id} value={l._id}>{l.fullName} ({l.leadNumber})</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Link to Buyer</label>
                <select value={form.relatedBuyer} onChange={(e) => setForm((f) => ({ ...f, relatedBuyer: e.target.value, relatedLead: "", relatedDeal: "" }))} className={`${modalInputCls} h-8`} disabled={!!form.relatedLead}>
                  <option value="">— None —</option>
                  {buyers.map((b) => <option key={b._id} value={b._id}>{b.fullName} ({b.buyerNumber})</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Link to Deal</label>
                <select value={form.relatedDeal} onChange={(e) => setForm((f) => ({ ...f, relatedDeal: e.target.value, relatedLead: "", relatedBuyer: "" }))} className={`${modalInputCls} h-8`} disabled={!!(form.relatedLead || form.relatedBuyer)}>
                  <option value="">— None —</option>
                  {deals.map((d) => <option key={d._id} value={d._id}>{d.dealNumber}{d.buyer?.fullName ? ` — ${d.buyer.fullName}` : ""}</option>)}
                </select>
              </div>

              <div className="col-span-2">
                <label className={labelCls}>Notes</label>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={`${modalInputCls} resize-none`} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Next Action</label>
                <input value={form.nextAction} onChange={(e) => setForm((f) => ({ ...f, nextAction: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
              <div>
                <label className={labelCls}>Next Action Date</label>
                <input type="date" value={form.nextActionDate} onChange={(e) => setForm((f) => ({ ...f, nextActionDate: e.target.value }))} className={`${modalInputCls} h-8`} />
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button onClick={() => setShowModal(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {saving ? "Saving…" : editingId ? "Update" : "Log Activity"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PropertySaleShell>
  );
}

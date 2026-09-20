import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import {
  FaCalendarAlt, FaClipboardList, FaCommentAlt, FaEdit, FaEnvelope, FaExchangeAlt,
  FaPhone, FaPlus, FaTimes, FaTrash, FaUserFriends,
} from "react-icons/fa";
import CwSmsModal from "../CarWash/CwSmsModal";
import SaleEmailModal from "./SaleEmailModal";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import SaleFilterBar, { FilterSearch, FilterDateRange } from "./SaleFilterBar";
import MilikTable from "../../components/common/MilikTable";
import { labelClass } from "../../utils/formStyles";
import { useTerms } from "../../hooks/useTerm";

const ACTIVITY_TYPES = ["call", "email", "meeting", "site_visit", "whatsapp", "note", "follow_up"];
const OUTCOMES       = ["positive", "neutral", "negative", "no_answer", "not_applicable"];
const ACTIVITY_TYPE_OPTIONS = ACTIVITY_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }));
const OUTCOME_OPTIONS       = OUTCOMES.map((o) => ({ value: o, label: o.replace(/_/g, " ") }));

const nameToValue = (name) => String(name || "").toLowerCase().replace(/\s+/g, "_");

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

// "walk_in" -> "Walk In" (matches the placeholder catalog's examples)
const humanize = (v) => String(v ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const fmt   = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const isOld = (date, status) => date && !["converted", "lost"].includes(status) && new Date(date) < new Date();
const LIMIT = 50;

const leadTableCols = (T) => [
  { label: "#", width: 36 },
  { label: `${T.saleLead} #` },
  { label: "Name" },
  { label: "Contact" },
  { label: "Source" },
  { label: "Status" },
  { label: T.saleAgent },
  { label: "Budget" },
  { label: "Next Follow-up" },
];

const selectCls = "h-7 border border-slate-200 bg-white px-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none";
const modalInputCls = "w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0B3B2E] focus:outline-none";

const rowClassName = (row) => isOld(row.nextFollowUpDate, row.status) ? "border-l-2 border-l-rose-400" : "";

// Modals below own their form state so keystrokes never re-render the page, table or detail panel.
// Submit handlers stay in the page (they own the in-flight `saving` guards); each modal hands its current form up on submit.

function LeadFormModal({ editingId, initial, saving, sourceOptions, statusOptions, agentOptions, onClose, onSubmit }) {
  const T = useTerms("saleLead", "saleAgent");
  const [form, setForm] = useState(initial);
  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-lg sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
            <FaUserFriends />{editingId ? `Edit ${T.saleLead}` : `Add ${T.saleLead}`}
          </h3>
          <button onClick={onClose} className="p-1 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes /></button>
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
              options={sourceOptions}
              size="md"
            />
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <AppSelect
              value={form.status}
              onChange={(v) => setForm((f) => ({ ...f, status: v ?? "" }))}
              options={statusOptions}
              size="md"
            />
          </div>
          <div>
            <label className={labelClass}>Assigned {T.saleAgent}</label>
            <AppSelect
              value={form.assignedAgent}
              onChange={(v) => setForm((f) => ({ ...f, assignedAgent: v ?? "" }))}
              options={agentOptions}
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
          <button onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={() => onSubmit(form)} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
            {saving ? "Saving…" : editingId ? `Update ${T.saleLead}` : `Create ${T.saleLead}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActivityModal({ leadName, editingAct, initial, saving, onClose, onSubmit }) {
  const [actForm, setActForm] = useState(initial);
  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-md sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
        <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
              <FaCalendarAlt />{editingAct ? "Edit Activity" : "Log Activity"}
            </h3>
            <div className="text-[10px] text-white/60 mt-0.5">for {leadName}</div>
          </div>
          <button onClick={onClose} className="p-1 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes /></button>
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
          <button onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={() => onSubmit(actForm)} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
            {saving ? "Saving…" : editingAct ? "Update" : "Log Activity"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConvertBuyerModal({ leadName, converting, onClose, onConfirm }) {
  const T = useTerms("saleBuyer");
  const [convertId, setConvertId] = useState("");
  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-sm sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
            <FaExchangeAlt />Convert to {T.saleBuyer}
          </h3>
          <button onClick={onClose} className="p-1 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes /></button>
        </div>
        <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
          <p className="text-xs text-slate-600">
            Convert <strong>{leadName}</strong> to registered {T.saleBuyer.toLowerCase()}. The {T.saleBuyer.toLowerCase()} profile will be created automatically.
          </p>
          <div>
            <label className={labelClass}>ID / Passport Number</label>
            <input value={convertId} onChange={(e) => setConvertId(e.target.value)} placeholder="National ID or Passport No." className={`${modalInputCls} h-8`} />
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={() => onConfirm(convertId)} disabled={converting} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
            {converting ? "Converting…" : `Convert to ${T.saleBuyer}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConvertOfferModal({ leadName, listingOptions, agentOptions, converting, onClose, onSubmit }) {
  const T = useTerms("saleLead", "saleOffer", "saleListing", "saleAgent");
  const [offerForm, setOfferForm] = useState(blankOfferForm);
  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(offerForm); }} className="flex w-full flex-col bg-white shadow-2xl sm:max-w-md sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
        <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
              <FaExchangeAlt />Convert {T.saleLead} → {T.saleOffer}
            </h3>
            <div className="text-[10px] text-white/60 mt-0.5">{leadName}</div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes /></button>
        </div>
        <div className="flex-1 overflow-y-auto bg-white px-5 py-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={labelClass}>{T.saleListing} *</label>
            <AppSelect
              value={offerForm.listing}
              onChange={(v) => setOfferForm((f) => ({ ...f, listing: v ?? "" }))}
              options={listingOptions}
              placeholder={`Select ${T.saleListing.toLowerCase()}…`}
              searchable
              size="md"
            />
          </div>
          <div>
            <label className={labelClass}>{T.saleOffer} Amount (KES) *</label>
            <input type="number" min="0" step="1" value={offerForm.offerAmount} onChange={(e) => setOfferForm((f) => ({ ...f, offerAmount: e.target.value }))} className={`${modalInputCls} h-8`} />
          </div>
          <div>
            <label className={labelClass}>Valid Until</label>
            <input type="date" value={offerForm.validityDate} onChange={(e) => setOfferForm((f) => ({ ...f, validityDate: e.target.value }))} className={`${modalInputCls} h-8`} />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Assigned {T.saleAgent}</label>
            <AppSelect
              value={offerForm.agent}
              onChange={(v) => setOfferForm((f) => ({ ...f, agent: v ?? "" }))}
              options={agentOptions}
              placeholder={`Select ${T.saleAgent.toLowerCase()}…`}
              size="md"
            />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Notes</label>
            <textarea rows={2} value={offerForm.notes} onChange={(e) => setOfferForm((f) => ({ ...f, notes: e.target.value }))} className={`${modalInputCls} resize-none`} />
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={converting} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
            {converting ? "Creating…" : `Create ${T.saleOffer}`}
          </button>
        </div>
      </form>
    </div>
  );
}

function LeadEmailModal({ target, company, sending, onSend, onClose }) {
  const [emailForm, setEmailForm] = useState(() => ({ to: target.email || "", subject: "", body: "" }));
  const vars = useMemo(() => ({
    leadName:     target.fullName    || "",
    leadNumber:   target.leadNumber  || "",
    phone:        target.phone       || "",
    email:        target.email       || "",
    source:       humanize(target.source),
    status:       humanize(target.status),
    budgetMin:    target.budgetMin   ? Number(target.budgetMin).toLocaleString()  : "",
    budgetMax:    target.budgetMax   ? Number(target.budgetMax).toLocaleString()  : "",
    assignedAgent: target.assignedAgent?.fullName || "",
    lastContactDate:  target.lastContactDate  ? fmt(target.lastContactDate)  : "",
    nextFollowUpDate: target.nextFollowUpDate ? fmt(target.nextFollowUpDate) : "",
    companyName:  company?.companyName || company?.name || "",
    companyPhone: company?.phoneNo || company?.phone || company?.telephone || "",
    companyEmail: company?.email || company?.companyEmail || "",
  }), [target, company]);
  return (
    <SaleEmailModal
      title={`Email to ${target.fullName}`}
      subtitle={target.leadNumber}
      emailForm={emailForm}
      setEmailForm={setEmailForm}
      sending={sending}
      onSend={() => onSend(emailForm)}
      onClose={onClose}
      context="lead"
      vars={vars}
    />
  );
}

export default function SaleLeads() {
  const T       = useTerms("saleLead", "saleLeads", "saleBuyer", "saleOffer", "saleListing", "saleListings", "saleAgent", "saleAgents");
  const confirm = useConfirm();
  const qc      = useQueryClient();
  const biz     = useSelector((s) => s.company?.currentCompany?._id);
  const currentCompany = useSelector((s) => s.company?.currentCompany);

  const [search, setSearch]           = useTabState("/sale/crm/leads:search", "");
  const debSearch                     = useDebounce(search, 400);
  const [statusFilter, setStatus]     = useTabState("/sale/crm/leads:statusFilter", "");
  const [sourceFilter, setSource]     = useTabState("/sale/crm/leads:sourceFilter", "");
  const [agentFilter,  setAgent]      = useTabState("/sale/crm/leads:agentFilter", "");
  const [overdueOnly,  setOverdue]    = useTabState("/sale/crm/leads:overdueOnly", false);
  const [createdFrom,  setCreatedFrom] = useTabState("/sale/crm/leads:createdFrom", "");
  const [createdTo,    setCreatedTo]   = useTabState("/sale/crm/leads:createdTo", "");
  const [page,         setPage]       = useTabState("/sale/crm/leads:page", 1);
  const [pageSize,     setPageSize]   = useTabState("/sale/crm/leads:pageSize", LIMIT);

  const [leadModal,    setLeadModal]  = useState(null);   // { editingId, initial } while the lead form is open
  const [saving,       setSaving]     = useState(false);

  const [selected,     setSelected]   = useTabState("/sale/crm/leads:selected", null);
  const [actModal,     setActModal]   = useState(null);   // { editing, initial } while the activity form is open
  const [savingAct,    setSavingAct]  = useState(false);

  const [showConvert,      setShowConvert]      = useState(false);
  const [converting,       setConverting]       = useState(false);

  const [showConvertOffer, setShowConvertOffer] = useState(false);
  const [convertingOffer,  setConvertingOffer]  = useState(false);

  const [smsTarget,   setSmsTarget]   = useState(null);
  const [emailTarget, setEmailTarget] = useState(null);
  const [sendingSms,  setSendingSms]  = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  const { data: leadsData, isLoading, isFetching } = useQuery({
    queryKey: ["sale-leads", biz, debSearch, statusFilter, sourceFilter, agentFilter, overdueOnly, createdFrom, createdTo, page, pageSize],
    queryFn:  () => saleApi.listLeads({ business: biz, search: debSearch, status: statusFilter, source: sourceFilter, agent: agentFilter, overdueOnly: overdueOnly ? "1" : "", createdFrom, createdTo, page, limit: pageSize }),
    enabled:  !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  const { data: saleSettings } = useQuery({
    queryKey: ["sale-settings", biz],
    queryFn:  () => saleApi.getSettings(),
    enabled:  !!biz,
    staleTime: 10 * 60_000,
  });

  const LEAD_TABLE_COLS = useMemo(() => leadTableCols(T), [T]);

  const settingStages  = useMemo(() => (saleSettings?.pipelineStages ?? []).filter((s) => s.isActive !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [saleSettings]);
  const settingSources = useMemo(() => (saleSettings?.leadSources    ?? []).filter((s) => s.isActive !== false), [saleSettings]);

  const LEAD_STATUS_OPTIONS = useMemo(() => settingStages.length
    ? settingStages.map((s) => ({ value: nameToValue(s.name), label: s.name }))
    : ["new","contacted","qualified","site_visited","proposal_sent","negotiating","converted","lost"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })), [settingStages]);
  const LEAD_STATUS_FORM_OPTIONS = useMemo(() => LEAD_STATUS_OPTIONS.filter((o) => o.value !== "converted"), [LEAD_STATUS_OPTIONS]);
  const LEAD_SOURCE_OPTIONS = useMemo(() => settingSources.length
    ? settingSources.map((s) => ({ value: nameToValue(s.name), label: s.name }))
    : ["walk_in","referral","online","social_media","agent","cold_call","other"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })), [settingSources]);

  const { data: agentsData } = useQuery({
    queryKey: ["sale-agents-ref", biz, "all"],
    queryFn:  () => saleApi.listAgents({ business: biz, limit: 200 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });
  const agents = useMemo(() => agentsData?.data ?? [], [agentsData]);
  const agentOptions = useMemo(() => agents.map((a) => ({ value: a._id, label: a.fullName })), [agents]);

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
    enabled:  !!biz && !!selected,   // only the detail panel / convert-to-offer modal use it
    staleTime: 5 * 60_000,
  });

  const allListings       = useMemo(() => listingsRef?.data ?? [], [listingsRef]);
  const interestedListings = useMemo(() => leadDetail?.interestedListings ?? [], [leadDetail]);
  const listingOptions    = useMemo(() => allListings.map((l) => ({ value: l._id, label: `${l.listingNumber} — ${l.title}` })), [allListings]);
  const linkableListingOptions = useMemo(
    () => listingOptions.filter((o) => !interestedListings.some((il) => String(il._id) === String(o.value))),
    [listingOptions, interestedListings],
  );

  const leads      = useMemo(() => leadsData?.data ?? [], [leadsData]);
  const total      = leadsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pipeline   = pipelineData?.pipeline ?? [];
  const leadActs   = activitiesData?.data ?? [];

  // Any lead mutation can move funnel counts; pass the lead id to also refresh the open panel's detail query.
  const invalidate = useCallback((leadId) => {
    qc.invalidateQueries({ queryKey: ["sale-leads", biz] });
    qc.invalidateQueries({ queryKey: ["sale-leads-ref", biz] });
    qc.invalidateQueries({ queryKey: ["sale-leads-pipeline", biz] });
    qc.invalidateQueries({ queryKey: ["sale-funnel", biz] });
    if (leadId) qc.invalidateQueries({ queryKey: ["sale-lead-detail", biz, leadId] });
  }, [qc, biz]);

  // ── Lead CRUD ─────────────────────────────────────────────────────────────
  const editingId = leadModal?.editingId || "";
  const openCreate = () => {
    const firstSource = LEAD_SOURCE_OPTIONS[0]?.value ?? "walk_in";
    const firstStatus = LEAD_STATUS_OPTIONS[0]?.value ?? "new";
    setLeadModal({ editingId: "", initial: { ...blankLead, source: firstSource, status: firstStatus } });
  };
  const openEdit   = useCallback((lead) => {
    setLeadModal({
      editingId: lead._id,
      initial: {
        fullName: lead.fullName || "", phone: lead.phone || "", email: lead.email || "",
        source: lead.source || "walk_in", status: lead.status || "new",
        assignedAgent: lead.assignedAgent?._id || lead.assignedAgent || "",
        budgetMin: lead.budgetMin || "", budgetMax: lead.budgetMax || "",
        notes: lead.notes || "", lostReason: lead.lostReason || "",
        nextFollowUpDate: lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate).toISOString().slice(0, 10) : "",
      },
    });
  }, []);

  const handleSave = async (form) => {
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
      invalidate(editingId);
      setLeadModal(null);
      toast.success(`${T.saleLead} ${editingId ? "updated" : "created"}`);
    } catch (err) { toast.error(err?.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handleDelete = useCallback(async (lead) => {
    if (!await confirm({ title: `Delete ${T.saleLead}`, message: `Delete "${lead.fullName}"?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      await saleApi.deleteLead(lead._id);
      invalidate();
      setSelected((prev) => (prev?._id === lead._id ? null : prev));
      toast.success(`${T.saleLead} deleted`);
    } catch (err) { toast.error(err?.response?.data?.message || "Delete failed"); }
  }, [confirm, invalidate, setSelected, T.saleLead]);

  // ── Activities ─────────────────────────────────────────────────────────────
  const editingAct = actModal?.editing ?? null;
  const openLogAct = useCallback((lead) => {
    setSelected(lead);
    setActModal({ editing: null, initial: { ...blankAct, date: new Date().toISOString().slice(0, 16) } });
  }, [setSelected]);
  const openEditAct = (act) => {
    setActModal({
      editing: act,
      initial: {
        type: act.type, subject: act.subject || "", notes: act.notes || "",
        date: new Date(act.date).toISOString().slice(0, 16),
        durationMinutes: act.durationMinutes || "", outcome: act.outcome || "not_applicable",
        nextAction: act.nextAction || "",
        nextActionDate: act.nextActionDate ? new Date(act.nextActionDate).toISOString().slice(0, 10) : "",
      },
    });
  };

  const handleSaveAct = async (actForm) => {
    if (!actForm.type) return toast.warning("Activity type is required");
    setSavingAct(true);
    try {
      const payload = { ...actForm, business: biz, relatedLead: selected._id };
      if (editingAct) await saleApi.updateActivity(editingAct._id, payload);
      else await saleApi.createActivity(payload);
      qc.invalidateQueries({ queryKey: ["sale-activities-lead", biz, selected._id] });
      invalidate(selected._id);
      setActModal(null);
      toast.success(`Activity ${editingAct ? "updated" : "logged"}`);
    } catch (err) { toast.error(err?.response?.data?.message || "Save failed"); }
    finally { setSavingAct(false); }
  };

  const handleDeleteAct = async (act) => {
    if (!await confirm({ title: "Delete Activity", message: "Remove this activity?", confirmText: "Remove", isDangerous: true })) return;
    try {
      await saleApi.deleteActivity(act._id);
      qc.invalidateQueries({ queryKey: ["sale-activities-lead", biz, selected._id] });
      qc.invalidateQueries({ queryKey: ["sale-lead-detail", biz, selected._id] });
      toast.success("Activity removed");
    } catch (err) { toast.error("Delete failed"); }
  };

  // ── Communication ──────────────────────────────────────────────────────────
  const openSms = useCallback((lead) => setSmsTarget(lead), []);
  const handleSendSms = async (phone, body) => {
    if (!smsTarget) return;
    setSendingSms(true);
    try {
      await saleApi.sendLeadSms(smsTarget._id, { phone, body });
      toast.success("SMS sent");
      setSmsTarget(null);
    } catch (err) { toast.error(err?.response?.data?.message || "Failed to send SMS"); }
    finally { setSendingSms(false); }
  };
  const handleSendEmail = async (emailForm) => {
    setSendingEmail(true);
    try {
      await saleApi.sendLeadEmail(emailTarget._id, emailForm);
      toast.success("Email sent");
      setEmailTarget(null);
    } catch (err) { toast.error(err?.response?.data?.message || "Failed to send email"); }
    finally { setSendingEmail(false); }
  };

  // ── Conversion ─────────────────────────────────────────────────────────────
  const handleConvert = async (convertId) => {
    setConverting(true);
    const leadId = selected._id;
    try {
      const res = await saleApi.convertLead(leadId, { business: biz, idNumber: convertId });
      invalidate(leadId);
      qc.invalidateQueries({ queryKey: ["sale-buyers", biz] });
      qc.invalidateQueries({ queryKey: ["sale-buyers-ref", biz] });
      setSelected((p) => ({ ...p, status: "converted", convertedBuyer: res.buyer }));
      setShowConvert(false);
      toast.success(`${T.saleLead} converted to ${T.saleBuyer.toLowerCase()}`);
    } catch (err) { toast.error(err?.response?.data?.message || "Conversion failed"); }
    finally { setConverting(false); }
  };

  const handleConvertToOffer = async (offerForm) => {
    if (!offerForm.listing)     return toast.warning(`Select ${T.saleListing.toLowerCase()}`);
    if (!offerForm.offerAmount) return toast.warning(`${T.saleOffer} amount is required`);
    setConvertingOffer(true);
    const leadId = selected._id;
    try {
      await saleApi.convertLeadToOffer(leadId, { ...offerForm, business: biz });
      toast.success(`${T.saleOffer} created from ${T.saleLead.toLowerCase()}`);
      setShowConvertOffer(false);
      invalidate(leadId);
      qc.invalidateQueries({ queryKey: ["sale-offers", biz] });
      // creating the offer reserves the listing and converts the lead server-side
      qc.invalidateQueries({ queryKey: ["sale-listings", biz] });
      qc.invalidateQueries({ queryKey: ["sale-listings-ref", biz] });
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to create ${T.saleOffer.toLowerCase()}`);
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
      toast.success(add ? `${T.saleListing} linked` : `${T.saleListing} removed`);
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to update ${T.saleListings.toLowerCase()}`);
    }
  };

  const panelLead = leadDetail ?? selected;

  const handleRowClick = useCallback((row) => setSelected((prev) => (prev?._id === row._id ? null : row)), [setSelected]);
  const selectedId = selected?._id;
  const isRowSelected = useCallback((row) => selectedId === row._id, [selectedId]);

  const renderLeadRow = useCallback((row, i) => {
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
  }, [page, pageSize]);

  const renderLeadActions = useCallback((row) => (
    <div className="inline-flex items-center gap-1">
      {row.phone && (
        <button onClick={() => openSms(row)} title="Send SMS" className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
          <FaCommentAlt size={9} />
        </button>
      )}
      {row.email && (
        <button onClick={() => setEmailTarget(row)} title="Send Email" className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
          <FaEnvelope size={9} />
        </button>
      )}
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
  ), [openSms, openLogAct, openEdit, handleDelete]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PropertySaleShell>
      <div className="flex h-full relative">

        {/* ── Main panel ──────────────────────────────────────────────────────── */}
        <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${selected ? "mr-[352px]" : ""}`}>

          {/* Pipeline funnel */}
          {pipeline.length > 0 && (
            <div className="flex flex-shrink-0 gap-1 px-2 py-1.5 bg-white border-b border-slate-200 overflow-x-auto">
              {LEAD_STATUS_OPTIONS.map(({ value: s, label: stageLabel }) => {
                const count = pipeline.find((p) => p._id === s)?.count ?? 0;
                return (
                  <button
                    key={s}
                    onClick={() => { setStatus(statusFilter === s ? "" : s); setPage(1); }}
                    className={`flex-shrink-0 text-center border px-3 py-1 text-xs transition-colors ${
                      statusFilter === s
                        ? `${STATUS_COLORS[s] ?? "border-[#0B3B2E] bg-[#0B3B2E] text-white"} font-black`
                        : "border-slate-200 bg-white text-slate-600 hover:bg-[#F1F6F3] hover:border-[#B7C9C0]"
                    }`}
                  >
                    <div className="font-black text-sm leading-tight">{count}</div>
                    <div className="text-[9px] capitalize leading-tight">{stageLabel}</div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Filter bar */}
          <SaleFilterBar
            leading={<span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{total} {(total === 1 ? T.saleLead : T.saleLeads).toLowerCase()}</span>}
            onReset={() => { setSearch(""); setStatus(""); setSource(""); setAgent(""); setOverdue(false); setCreatedFrom(""); setCreatedTo(""); setPage(1); }}
            activeCount={[search, statusFilter, sourceFilter, agentFilter, overdueOnly ? "1" : "", createdFrom, createdTo].filter(Boolean).length}
            trailing={
              <button
                onClick={openCreate}
                className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
              >
                <FaPlus size={9} /> Add {T.saleLead}
              </button>
            }
          >
            <FilterSearch
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={`Search ${T.saleLeads.toLowerCase()}…`}
            />
            <AppSelect value={statusFilter} onChange={(v) => { setStatus(v ?? ""); setPage(1); }} options={LEAD_STATUS_OPTIONS} placeholder="All Statuses" clearable size="sm" />
            <AppSelect value={sourceFilter} onChange={(v) => { setSource(v ?? ""); setPage(1); }} options={LEAD_SOURCE_OPTIONS} placeholder="All Sources" clearable size="sm" />
            <AppSelect value={agentFilter} onChange={(v) => { setAgent(v ?? ""); setPage(1); }} options={agentOptions} placeholder={`All ${T.saleAgents}`} searchable clearable size="sm" />
            <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none whitespace-nowrap">
              <input type="checkbox" checked={overdueOnly} onChange={(e) => { setOverdue(e.target.checked); setPage(1); }} className="accent-[#0B3B2E]" />
              Overdue
            </label>
            <FilterDateRange
              from={createdFrom} to={createdTo}
              onFromChange={(e) => { setCreatedFrom(e.target.value); setPage(1); }}
              onToChange={(e) => { setCreatedTo(e.target.value); setPage(1); }}
            />
          </SaleFilterBar>

          {/* Table container */}
          <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
            <MilikTable
              columns={LEAD_TABLE_COLS}
              rows={leads}
              loading={isLoading}
              empty={`No ${T.saleLeads.toLowerCase()} found.`}
              minWidth={860}
              onRowClick={handleRowClick}
              isSelected={isRowSelected}
              rowClassName={rowClassName}
              renderRow={renderLeadRow}
              renderActions={renderLeadActions}
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
                <div className="font-extrabold text-sm leading-tight truncate">{panelLead.fullName}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_COLORS[panelLead.status] || "border-white/30 text-white"}`}>
                    {(panelLead.status || "").replace(/_/g, " ")}
                  </span>
                  <span className="text-[10px] font-mono text-white/60">{panelLead.leadNumber}</span>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="flex-shrink-0 p-1 text-white/70 hover:bg-white/10 hover:text-white">
                <FaTimes size={13} />
              </button>
            </div>

            {/* Info */}
            <div className="flex-shrink-0 border-b border-slate-100 px-4 py-3 space-y-1.5 text-xs">
              {panelLead.phone && <div className="flex items-center gap-2 text-slate-600"><FaPhone size={9} className="text-slate-400 flex-shrink-0" />{panelLead.phone}</div>}
              {panelLead.email && <div className="flex items-center gap-2 text-slate-500"><FaEnvelope size={9} className="text-slate-400 flex-shrink-0" />{panelLead.email}</div>}
              {panelLead.assignedAgent && <div className="text-slate-500">{T.saleAgent}: <span className="font-semibold text-slate-700">{panelLead.assignedAgent?.fullName || panelLead.assignedAgent}</span></div>}
              {(panelLead.budgetMin || panelLead.budgetMax) && (
                <div className="text-slate-500">Budget: <span className="font-semibold text-slate-700">{panelLead.budgetMin ? fmtKES(panelLead.budgetMin) : "?"} – {panelLead.budgetMax ? fmtKES(panelLead.budgetMax) : "?"}</span></div>
              )}
              {panelLead.nextFollowUpDate && (
                <div className={`flex items-center gap-1 ${isOld(panelLead.nextFollowUpDate, panelLead.status) ? "text-rose-600 font-semibold" : "text-slate-500"}`}>
                  <FaCalendarAlt size={9} />Next follow-up: {fmt(panelLead.nextFollowUpDate)}{isOld(panelLead.nextFollowUpDate, panelLead.status) ? " — overdue!" : ""}
                </div>
              )}
              {panelLead.lastContactDate && <div className="text-slate-400">Last contact: {fmt(panelLead.lastContactDate)}</div>}
              {panelLead.notes && <div className="italic text-slate-500">{panelLead.notes}</div>}
              {panelLead.lostReason && <div className="text-rose-500">Lost: {panelLead.lostReason}</div>}
            </div>

            {/* Interested Listings */}
            <div className="flex-shrink-0 border-b border-slate-100 px-4 py-3">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Interested {T.saleListings}</div>
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
                <div className="mb-2 text-[11px] text-slate-400">No {T.saleListings.toLowerCase()} linked yet.</div>
              )}
              <AppSelect
                value=""
                onChange={(v) => { if (v) handleToggleListing(v, true); }}
                options={linkableListingOptions}
                placeholder={`+ Link ${T.saleListing.toLowerCase()}…`}
                searchable
                size="sm"
              />
            </div>

            {/* Actions */}
            <div className="flex-shrink-0 border-b border-slate-100 px-4 py-2 space-y-1.5">
              <div className="flex gap-1.5">
                <button onClick={() => openEdit(panelLead)} className="flex-1 inline-flex items-center justify-center gap-1 border border-[#B7C9C0] bg-white px-3 py-1.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                  <FaEdit size={9} /> Edit
                </button>
                {panelLead.status !== "converted" && panelLead.status !== "lost" ? (
                  <>
                    <button onClick={() => setShowConvert(true)} className="flex-1 inline-flex items-center justify-center gap-1 border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100">
                      <FaExchangeAlt size={9} /> {T.saleBuyer}
                    </button>
                    <button onClick={() => setShowConvertOffer(true)} className="flex-1 inline-flex items-center justify-center gap-1 border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100">
                      <FaExchangeAlt size={9} /> → {T.saleOffer}
                    </button>
                  </>
                ) : panelLead.convertedBuyer ? (
                  <span className="flex-1 border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-center text-emerald-700">✓ {T.saleBuyer} Created</span>
                ) : null}
              </div>
              <div className="flex gap-1.5">
                {panelLead.phone && (
                  <button onClick={() => openSms(panelLead)} className="flex-1 inline-flex items-center justify-center gap-1 border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100">
                    <FaCommentAlt size={9} /> SMS
                  </button>
                )}
                {panelLead.email && (
                  <button onClick={() => setEmailTarget(panelLead)} className="flex-1 inline-flex items-center justify-center gap-1 border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    <FaEnvelope size={9} /> Email
                  </button>
                )}
              </div>
            </div>

            {/* Activity log header */}
            <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2">
              <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">Activity Log</span>
              <button onClick={() => openLogAct(panelLead)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
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
      {leadModal && (
        <LeadFormModal
          editingId={leadModal.editingId}
          initial={leadModal.initial}
          saving={saving}
          sourceOptions={LEAD_SOURCE_OPTIONS}
          statusOptions={LEAD_STATUS_FORM_OPTIONS}
          agentOptions={agentOptions}
          onClose={() => setLeadModal(null)}
          onSubmit={handleSave}
        />
      )}

      {/* ── Log / Edit Activity Modal ─────────────────────────────────────────── */}
      {actModal && selected && (
        <ActivityModal leadName={selected.fullName} editingAct={actModal.editing} initial={actModal.initial} saving={savingAct} onClose={() => setActModal(null)} onSubmit={handleSaveAct} />
      )}

      {/* ── Convert to Buyer Modal ─────────────────────────────────────────────── */}
      {showConvert && selected && (
        <ConvertBuyerModal leadName={selected.fullName} converting={converting} onClose={() => setShowConvert(false)} onConfirm={handleConvert} />
      )}
      {/* ── Convert to Offer Modal ───────────────────────────────────────────── */}
      {showConvertOffer && selected && (
        <ConvertOfferModal leadName={selected.fullName} listingOptions={listingOptions} agentOptions={agentOptions} converting={convertingOffer} onClose={() => setShowConvertOffer(false)} onSubmit={handleConvertToOffer} />
      )}

      {/* ── SMS Modal ─────────────────────────────────────────────────────────── */}
      {smsTarget && (
        <CwSmsModal
          target={{ name: smsTarget.fullName, phone: smsTarget.phone }}
          context={smsTarget.leadNumber}
          defaultBody={`Dear ${smsTarget.fullName}, `}
          onSend={handleSendSms}
          onClose={() => setSmsTarget(null)}
          sending={sendingSms}
        />
      )}

      {/* ── Email Modal ───────────────────────────────────────────────────────── */}
      {emailTarget && (
        <LeadEmailModal target={emailTarget} company={currentCompany} sending={sendingEmail} onSend={handleSendEmail} onClose={() => setEmailTarget(null)} />
      )}
    </PropertySaleShell>
  );
}

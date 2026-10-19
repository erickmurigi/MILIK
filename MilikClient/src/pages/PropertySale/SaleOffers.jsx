import React, { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { FaCheck, FaEdit, FaHandshake, FaPlus, FaPrint, FaRedoAlt, FaTimes } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch } from "./SaleFilterBar";
import ListToolbar from "../../components/common/ListToolbar";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi, todayISO } from "../../services/propertySaleApi";
import AmountInput from "./AmountInput";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTerms, prefixedTerm } from "../../hooks/useTerm";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";
import { printDocument } from "../../utils/printKit";
import { exportAfterFetch, fetchAllPages, money, printAfterFetch, shortDate } from "./salePrint";
import SalePrintButton from "./SalePrintButton";
import SaleExportButton from "./SaleExportButton";
import DealFormModal from "./SaleDealFormModal";
import { blankScheduleGeneratorFields } from "./SaleScheduleGenerator";

// Local override, not the shared utils/formStyles.js — that file's labelClass/inputClass predate the
// bold-value-matches-label-weight convention now standard across PropertySale forms (see
// SaleActivityFormModal.jsx / AppSelect.jsx's label and selected-value weight).
const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "h-7 w-full border border-slate-200 bg-white px-2.5 text-sm font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const textareaClass = "w-full border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const STATUS_BADGE = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  negotiating: "bg-violet-100 text-violet-700 border-violet-200",
  accepted: "bg-emerald-100 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-100 text-rose-700 border-rose-200",
  expired: "bg-slate-100 text-slate-500 border-slate-200",
  withdrawn: "bg-slate-100 text-slate-500 border-slate-200",
};

const EMPTY_FORM = { listing: "", buyer: "", agent: "", offerAmount: "", validityDate: "", notes: "" };
const EMPTY_STATUS = { status: "", counterOfferAmount: "", negotiationNotes: "" };
const LIMIT = 50;

const OFFER_STATUS_FILTER_OPTIONS = ["pending", "negotiating", "accepted", "rejected", "expired", "withdrawn"].map((s) => ({
  value: s,
  label: s === "negotiating" ? "Counter Active" : s.charAt(0).toUpperCase() + s.slice(1),
}));
const offerStatusUpdateOptions = (T) => [
  { value: "negotiating", label: `Send Counter ${T.saleOffer}` },
  { value: "accepted",    label: `Accept ${T.saleOffer} / Counter` },
  { value: "rejected",    label: "Reject" },
  { value: "expired",     label: "Mark as Expired" },
  { value: "withdrawn",   label: `Withdrawn by ${T.saleBuyer}` },
];

const offerTableCols = (T) => [
  { label: `${T.saleOffer} No.`, width: "9%" },
  { label: "Property", width: "17%" },
  { label: T.saleBuyer, width: "14%" },
  { label: T.saleAgent, width: "12%" },
  { label: `${T.saleOffer} Amount`, align: "right", width: "12%" },
  { label: "Counter / Final", align: "right", width: "12%" },
  { label: "Validity", width: "9%" },
  { label: "Status", width: "9%" },
];

// A validity date in the past is a visual nudge only — same pattern as Leads' overdue follow-up date.
// It never auto-expires the offer (that stays a deliberate, manual status change): a validity date in
// real estate is often soft, and auto-releasing the listing back to "available" behind an agent's back
// mid-negotiation would be worse than a stale date sitting unnoticed.
const isOfferOverdue = (validityDate, status) => validityDate && !["accepted", "rejected", "expired", "withdrawn"].includes(status) && new Date(validityDate) < new Date();

// Module scope so MilikTable's React.memo isn't defeated by a fresh function identity each parent render.
const offerRowClassName = (o) => {
  const isCounterActive = o.status === "negotiating" && !!o.counterOfferAmount;
  return isCounterActive ? "!bg-[#F1F6F3]" : "";
};

// Built once per terminology (memoized in the page) so MilikTable's React.memo still holds.
// Every cell is single-line — the vs-asking / vs-offer deltas and the counter/final badge (already
// redundant with the Status column's own "Counter Active" / "Accepted" badge) moved to renderExpanded.
const offerRowRenderer = (T) => (o) => {
  const hasCounter = !!o.counterOfferAmount;
  const isCounterActive = o.status === "negotiating" && hasCounter;
  const isAccepted = o.status === "accepted";
  const overdue = isOfferOverdue(o.validityDate, o.status);
  return (
    <>
      <td className="px-3 py-1.5 border-r border-gray-100 font-black text-slate-900">{o.offerNumber}</td>
      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700">{o.listing?.title || o.listing?.listingNumber || "—"}</td>
      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700">{o.buyer?.fullName || "—"}</td>
      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">{o.agent?.fullName || <span className="italic text-slate-300">—</span>}</td>
      <td className="px-3 py-1.5 border-r border-gray-100 text-right font-black tabular-nums text-slate-900">{fmtKES(o.offerAmount)}</td>
      <td className="px-3 py-1.5 border-r border-gray-100 text-right font-black tabular-nums">
        {hasCounter
          ? <span className={isAccepted ? "text-emerald-700" : "text-violet-700"}>{fmtKES(o.counterOfferAmount)}</span>
          : isAccepted
            ? <span className="text-emerald-700">{fmtKES(o.offerAmount)}</span>
            : <span className="font-normal text-slate-300">—</span>}
      </td>
      <td className={`px-3 py-1.5 border-r border-gray-100 ${overdue ? "font-semibold text-rose-600" : "text-slate-500"}`}>
        {o.validityDate ? <>{new Date(o.validityDate).toLocaleDateString("en-KE")}{overdue ? " !" : ""}</> : "—"}
      </td>
      <td className="px-3 py-1.5">
        <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_BADGE[o.status] || "border-slate-200 bg-slate-100 text-slate-600"}`}>
          {isCounterActive ? "Counter Active" : o.status}
        </span>
      </td>
    </>
  );
};

// Secondary detail for the row above: the vs-asking / vs-offer % deltas, shown only when there's
// something to say (an asking price to compare against, or a counter on the table).
const offerExpandedRenderer = (T) => (o) => {
  const hasCounter = !!o.counterOfferAmount;
  const isAccepted = o.status === "accepted";
  const askingDelta = o.listing?.askingPrice > 0 ? Math.round(((o.offerAmount - o.listing.askingPrice) / o.listing.askingPrice) * 100) : null;
  const counterDelta = hasCounter ? Math.round(((o.counterOfferAmount - o.offerAmount) / o.offerAmount) * 100) : null;
  if (askingDelta === null && counterDelta === null) {
    return <div className="text-[10px] text-slate-400">No asking price or counter {T.saleOffer.toLowerCase()} to compare against.</div>;
  }
  return (
    <div className="flex flex-wrap gap-4 text-[11px]">
      {askingDelta !== null && (
        <div>
          <span className="text-slate-400">{T.saleOffer} vs asking price: </span>
          <span className={`font-bold ${askingDelta < 0 ? "text-rose-600" : askingDelta > 0 ? "text-emerald-600" : "text-slate-600"}`}>
            {askingDelta >= 0 ? "+" : ""}{askingDelta}%
          </span>
        </div>
      )}
      {counterDelta !== null && (
        <div>
          <span className="text-slate-400">Counter vs {T.saleBuyer.toLowerCase()}'s {T.saleOffer.toLowerCase()}: </span>
          <span className={`font-bold ${counterDelta > 0 ? "text-rose-600" : "text-emerald-600"}`}>{counterDelta >= 0 ? "+" : ""}{counterDelta}%</span>
          {isAccepted && <span className="ml-2 border border-emerald-300 bg-emerald-100 px-1.5 py-0 text-[9px] font-black uppercase tracking-wider text-emerald-700">final</span>}
        </div>
      )}
    </div>
  );
};

// Modals below own their form state so keystrokes never re-render the page or its table.
// Submit handlers stay in the page (they own the shared `saving`/`converting` in-flight guards).

function CreateOfferModal({ saving, listingFormOptions, buyerFormOptions, activeAgentOptions, onClose, onSubmit }) {
  const T = useTerms("saleOffer", "saleListing", "saleBuyer", "saleAgent");
  const [form, setForm] = useState(EMPTY_FORM);
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} onClick={(e) => e.stopPropagation()} className="flex w-full max-w-lg flex-col bg-white shadow-2xl sm:border sm:border-slate-200 max-h-[92dvh] rounded-t-2xl sm:rounded-none">
        <div className="flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
          <div>
            <div className="text-sm font-extrabold uppercase tracking-wide">Record New {T.saleOffer}</div>
            <div className="text-xs font-semibold text-white/70">Formal purchase {T.saleOffer.toLowerCase()} against the {T.saleListing.toLowerCase()}</div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
        </div>
        <div className="grid gap-4 overflow-y-auto p-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <AppSelect label={T.saleListing} required value={form.listing} onChange={(v) => setForm((f) => {
              // A new offer starts with the agent of the chosen item (its own, or its project's) unless one was already picked
              const suggested = listingFormOptions.find((o) => o.value === v)?.agent;
              const usable = suggested && activeAgentOptions.some((o) => o.value === suggested);
              return { ...f, listing: v ?? "", ...(!f.agent && usable && { agent: suggested }) };
            })} options={listingFormOptions} placeholder={`Select ${T.saleListing.toLowerCase()}`} size="sm" searchable />
          </div>
          <div>
            <AppSelect label={T.saleBuyer} required value={form.buyer} onChange={(v) => setForm((f) => ({ ...f, buyer: v ?? "" }))} options={buyerFormOptions} placeholder={`Select ${T.saleBuyer.toLowerCase()}`} size="sm" searchable />
          </div>
          <div>
            <AppSelect label={prefixedTerm("Sales", T.saleAgent, "saleAgent")} value={form.agent} onChange={(v) => setForm((f) => ({ ...f, agent: v ?? "" }))} options={activeAgentOptions} placeholder="Unassigned" size="sm" searchable clearable />
          </div>
          <div>
            <label className={labelClass}>{T.saleOffer} Amount (KES)<Required /></label>
            <AmountInput
              value={form.offerAmount}
              onChange={(v) => setForm((f) => ({ ...f, offerAmount: v }))}
              className={inputClass}
              placeholder="e.g. 5,000,000"
              required
            />
          </div>
          <div>
            <label className={labelClass}>Validity Date</label>
            <input type="date" value={form.validityDate}
              onChange={(e) => setForm((f) => ({ ...f, validityDate: e.target.value }))}
              className={inputClass} />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Notes</label>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className={textareaClass} />
          </div>
        </div>
        <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
            {saving ? "Saving…" : `Record ${T.saleOffer}`}
          </button>
        </div>
      </form>
    </div>
  );
}

function OfferStatusModal({ offer, saving, onClose, onSubmit }) {
  const T = useTerms("saleOffer", "saleBuyer", "saleDeal");
  const statusUpdateOptions = useMemo(() => offerStatusUpdateOptions(T), [T]);
  const [statusForm, setStatusForm] = useState(() => ({ ...EMPTY_STATUS, counterOfferAmount: offer.counterOfferAmount || "" }));
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(statusForm); }} onClick={(e) => e.stopPropagation()} className="flex w-full max-w-md flex-col bg-white shadow-2xl sm:border sm:border-slate-200 max-h-[92dvh] rounded-t-2xl sm:rounded-none">
        <div className="flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-800 px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
          <div>
            <div className="text-sm font-extrabold uppercase tracking-wide">Update {T.saleOffer} Status</div>
            <div className="text-xs font-semibold text-white/70">{offer.offerNumber} — {offer.listing?.title || ""}</div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
        </div>
        <div className="grid gap-4 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{T.saleBuyer}'s {T.saleOffer}</div>
              <div className="font-black text-slate-900">{fmtKES(offer.offerAmount)}</div>
            </div>
            {offer.counterOfferAmount ? (
              <div className="border border-violet-200 bg-violet-50 px-3 py-2 text-xs">
                <div className="text-[10px] font-black uppercase tracking-wider text-violet-500">Current Counter</div>
                <div className="font-black text-violet-800">{fmtKES(offer.counterOfferAmount)}</div>
              </div>
            ) : (
              <div className="border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Asking Price</div>
                <div className="font-black text-slate-900">{fmtKES(offer.listing?.askingPrice)}</div>
              </div>
            )}
          </div>

          <div>
            <AppSelect label="New Status *" value={statusForm.status} onChange={(v) => setStatusForm((f) => ({ ...f, status: v ?? "" }))} options={statusUpdateOptions} placeholder="Select status" size="md" />
          </div>

          {statusForm.status === "negotiating" && (
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">Counter-{T.saleOffer} Amount (KES) *</label>
              <AmountInput
                value={statusForm.counterOfferAmount}
                onChange={(v) => setStatusForm((f) => ({ ...f, counterOfferAmount: v }))}
                className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none"
                placeholder="e.g. 5,500,000"
              />
              {statusForm.counterOfferAmount && offer.offerAmount && (
                <div className={`mt-1 text-[10px] font-bold ${Number(statusForm.counterOfferAmount) > Number(offer.offerAmount) ? "text-rose-500" : "text-emerald-500"}`}>
                  {Number(statusForm.counterOfferAmount) > Number(offer.offerAmount) ? "+" : ""}
                  {Math.round(((Number(statusForm.counterOfferAmount) - Number(offer.offerAmount)) / Number(offer.offerAmount)) * 100)}% vs {T.saleBuyer.toLowerCase()}'s {T.saleOffer.toLowerCase()}
                </div>
              )}
            </div>
          )}

          {statusForm.status === "accepted" && (
            <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] text-emerald-800">
              <span className="font-black">Accepted price: </span>
              <span className="font-bold">{fmtKES(offer.counterOfferAmount || offer.offerAmount)}</span>
              {offer.counterOfferAmount && <span className="ml-1 opacity-70">(counter {T.saleOffer.toLowerCase()})</span>}
              <div className="mt-1 opacity-80">After accepting, use the <strong>{T.saleDeal}</strong> button to convert this {T.saleOffer.toLowerCase()} into a transaction.</div>
            </div>
          )}

          <div>
            <label className="mb-0.5 block text-xs font-semibold text-slate-700">Notes</label>
            <textarea rows={2} value={statusForm.negotiationNotes}
              onChange={(e) => setStatusForm((f) => ({ ...f, negotiationNotes: e.target.value }))}
              className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0B3B2E] focus:outline-none" />
          </div>
        </div>
        <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
            {saving ? "Saving…" : "Update Status"}
          </button>
        </div>
      </form>
    </div>
  );
}

const SaleOffers = () => {
  const T = useTerms("saleOffer", "saleOffers", "saleListing", "saleListings", "saleBuyer", "saleBuyers", "saleAgent", "saleDeal", "saleDeals", "saleModule");
  const offerCols = useMemo(() => offerTableCols(T), [T]);
  const renderOfferRow = useMemo(() => offerRowRenderer(T), [T]);
  const renderOfferExpanded = useMemo(() => offerExpandedRenderer(T), [T]);
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const [search, setSearch] = useTabState("/sale/offers:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [statusFilter, setStatusFilter] = useTabState("/sale/offers:statusFilter", "");
  const [listingFilt, setListingFilt] = useTabState("/sale/offers:listingFilt", "");
  const [buyerFilt,   setBuyerFilt]   = useTabState("/sale/offers:buyerFilt", "");
  const [page, setPage] = useTabState("/sale/offers:page", 1);
  const [pageSize, setPageSize] = useTabState("/sale/offers:pageSize", LIMIT);

  const [showCreate, setShowCreate] = useState(false);
  const [showStatus, setShowStatus] = useState(null);
  const [showConvertDeal, setShowConvertDeal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: offersPage, isFetching } = useQuery({
    queryKey: ["sale-offers", biz, debouncedSearch, statusFilter, listingFilt, buyerFilt, page, pageSize],
    queryFn: () => saleApi.listOffers({
      business: biz, limit: pageSize, page,
      ...(statusFilter     && { status:    statusFilter }),
      ...(debouncedSearch  && { search:    debouncedSearch }),
      ...(listingFilt      && { listingId: listingFilt }),
      ...(buyerFilt        && { buyerId:   buyerFilt }),
    }),
    enabled: !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });
  const offers = useMemo(() => offersPage?.data ?? [], [offersPage]);
  const total = offersPage?.total ?? 0;

  const { data: listingsPage } = useQuery({
    queryKey: ["sale-listings-ref", biz],
    queryFn: () => saleApi.listListings({ business: biz, limit: 200 }),
    enabled: !!biz,
    staleTime: 60_000,
  });
  const listings = useMemo(() => listingsPage?.data ?? [], [listingsPage]);

  const { data: buyersPage } = useQuery({
    queryKey: ["sale-buyers-ref", biz],
    queryFn: () => saleApi.listBuyers({ business: biz, limit: 200 }),
    enabled: !!biz,
    staleTime: 60_000,
  });
  const buyers = useMemo(() => buyersPage?.data ?? [], [buyersPage]);

  const { data: agentsPage } = useQuery({
    queryKey: ["sale-agents-ref", biz, "all"],
    queryFn: () => saleApi.listAgents({ business: biz, limit: 200 }),
    enabled: !!biz,
    staleTime: 60_000,
  });
  const agents = useMemo(() => agentsPage?.data ?? [], [agentsPage]);

  const { data: advocatesPage } = useQuery({
    queryKey: ["sale-advocates-ref", biz, "active"],
    queryFn: () => saleApi.listAdvocates({ business: biz, status: "active", limit: 200 }),
    enabled: !!biz,
    staleTime: 60_000,
  });
  const advocates = useMemo(() => advocatesPage?.data ?? [], [advocatesPage]);
  const advocateFormOptions = useMemo(() => advocates.map((a) => ({ value: a._id, label: a.firm ? `${a.fullName} (${a.firm})` : a.fullName })), [advocates]);

  const activeAgentOptions  = useMemo(() => agents.filter((a) => a.status === "active").map((a) => ({ value: a._id, label: `${a.agentNumber} — ${a.fullName}` })), [agents]);
  const listingFilterOptions= useMemo(() => listings.map((l) => ({ value: l._id, label: `${l.listingNumber} — ${l.title}` })), [listings]);
  const listingFormOptions  = useMemo(() => listings.filter((l) => ["available", "reserved", "under_contract"].includes(l.status)).map((l) => ({ value: l._id, label: `${l.listingNumber} — ${l.title}`, agent: l.effectiveAgent?._id ?? null, advocate: l.effectiveAdvocate?._id ?? null })), [listings]);
  const buyerFilterOptions  = useMemo(() => buyers.map((b) => ({ value: b._id, label: `${b.fullName}${b.buyerNumber ? ` (${b.buyerNumber})` : ""}` })), [buyers]);
  const buyerFormOptions    = useMemo(() => buyers.map((b) => ({ value: b._id, label: `${b.buyerNumber} — ${b.fullName}` })), [buyers]);

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ["sale-offers", biz] }), [queryClient, biz]);
  // Offer create/accept/reject/withdraw/delete/convert change the listing status server-side
  // (available <-> reserved <-> under_contract) and move the conversion-funnel counts.
  const invalidateWithListings = useCallback(() => {
    invalidate();
    queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] });
    queryClient.invalidateQueries({ queryKey: ["sale-listings-ref", biz] });
    queryClient.invalidateQueries({ queryKey: ["sale-funnel", biz] });
  }, [invalidate, queryClient, biz]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCreate = async (form) => {
    if (!form.listing || !form.buyer || !form.offerAmount) {
      toast.warn(`${T.saleListing}, ${T.saleBuyer.toLowerCase()} and ${T.saleOffer.toLowerCase()} amount are required`);
      return;
    }
    setSaving(true);
    try {
      await saleApi.createOffer({ ...form, business: biz });
      toast.success(`${T.saleOffer} recorded`);
      setShowCreate(false);
      invalidateWithListings();
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to record ${T.saleOffer.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusUpdate = async (statusForm) => {
    if (!statusForm.status) { toast.warn("Select a status"); return; }
    setSaving(true);
    try {
      await saleApi.updateOfferStatus(showStatus._id, { ...statusForm, business: biz });
      toast.success(`${T.saleOffer} status updated`);
      setShowStatus(null);
      invalidateWithListings();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  const handleAcceptCounter = useCallback(async (offer) => {
    if (!await confirm({
      title: `Accept Counter ${T.saleOffer}`,
      message: `Accept the counter ${T.saleOffer.toLowerCase()} of ${fmtKES(offer.counterOfferAmount)} for ${offer.offerNumber}? The original ${T.saleOffer.toLowerCase()} was ${fmtKES(offer.offerAmount)}.`,
      confirmText: "Accept Counter",
    })) return;
    setSaving(true);
    try {
      await saleApi.updateOfferStatus(offer._id, {
        status: "accepted",
        negotiationNotes: "Counter offer accepted by buyer",
        business: biz,
      });
      toast.success(`Counter ${T.saleOffer.toLowerCase()} accepted — ${T.saleOffer.toLowerCase()} is now Accepted`);
      invalidateWithListings();
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to accept counter ${T.saleOffer.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  }, [confirm, biz, invalidateWithListings, T.saleOffer]);

  const handleRejectCounter = useCallback(async (offer) => {
    if (!await confirm({
      title: `Reject Counter ${T.saleOffer}`,
      message: `Reject the counter ${T.saleOffer.toLowerCase()} for ${offer.offerNumber}? The ${T.saleOffer.toLowerCase()} status will be marked as rejected.`,
      confirmText: "Reject",
      isDangerous: true,
    })) return;
    setSaving(true);
    try {
      await saleApi.updateOfferStatus(offer._id, {
        status: "rejected",
        negotiationNotes: "Counter offer rejected by buyer",
        business: biz,
      });
      toast.success(`${T.saleOffer} rejected`);
      invalidateWithListings();
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to reject ${T.saleOffer.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  }, [confirm, biz, invalidateWithListings, T.saleOffer]);

  const handleConvertDeal = async (dealForm) => {
    if (!dealForm.agreedPrice) { toast.warn("Agreed price is required"); return; }
    setConverting(true);
    try {
      // Same shape as SaleDeals.jsx's own handleSave — depositMode/depositValue/installmentCount/
      // frequency/firstInstallmentDate/scheduleRows only drive the generator in the shared
      // DealFormModal, never sent to the API directly; scheduleRows is saved separately via
      // setSchedule once the new deal's id exists. listing/buyer are harmless to include —
      // createDealFromOffer always uses the offer's own listing/buyer regardless.
      const {
        commOverrideEnabled, commissionRateOverride, commissionTypeOverride, commissionAmountOverride,
        depositMode, depositValue, installmentCount, frequency, firstInstallmentDate, scheduleRows,
        ...baseForm
      } = dealForm;
      const payload = { ...baseForm, agreedPrice: Number(dealForm.agreedPrice), agent: dealForm.agent || undefined, advocate: dealForm.advocate || undefined, expectedClosingDate: dealForm.expectedClosingDate || undefined };
      if (dealForm.agent && commOverrideEnabled) {
        if (commissionRateOverride !== "") payload.commissionRateOverride = Number(commissionRateOverride);
        if (commissionTypeOverride !== "") payload.commissionTypeOverride = commissionTypeOverride;
        if (commissionAmountOverride !== "") payload.commissionAmountOverride = Number(commissionAmountOverride);
      }

      const newDeal = await saleApi.createDealFromOffer(showConvertDeal._id, payload);
      if (scheduleRows?.length) {
        try {
          await saleApi.setSchedule({ dealId: newDeal._id, items: scheduleRows });
        } catch (scheduleErr) {
          toast.warn(scheduleErr?.response?.data?.message || `${T.saleDeal} created, but the payment schedule couldn't be saved — set it up from the ${T.saleDeal.toLowerCase()}'s Schedule tab.`);
        }
      }
      toast.success(`${T.saleDeal} created! View it in the ${T.saleDeals} section.`);
      setShowConvertDeal(null);
      invalidateWithListings();
      queryClient.invalidateQueries({ queryKey: ["sale-deals", biz] });
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to create ${T.saleDeal.toLowerCase()}`);
    } finally {
      setConverting(false);
    }
  };

  const handleDelete = useCallback(async (offer) => {
    if (!await confirm({
      title: `Delete ${T.saleOffer}`,
      message: `Permanently delete ${T.saleOffer.toLowerCase()} ${offer.offerNumber}? This cannot be undone.`,
      confirmText: "Delete",
      isDangerous: true,
    })) return;
    try {
      await saleApi.deleteOffer(offer._id);
      toast.success(`${T.saleOffer} deleted`);
      invalidateWithListings();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to delete");
    }
  }, [confirm, invalidateWithListings, T.saleOffer]);

  const printOffer = useCallback((offer) => {
    const co = currentCompany || {};
    const listing = offer.listing || {};
    const buyer = offer.buyer || {};
    const agent = offer.agent || null;
    const kes = (v) => `KES ${money(v)}`;
    const status = offer.status || "pending";
    const printed = printDocument({
      company: co,
      docType: `Purchase ${T.saleOffer} Document`,
      docNumber: offer.offerNumber || "",
      status: { label: status, tone: { accepted: "success", rejected: "danger", negotiating: "info", pending: "warning" }[status] || "neutral" },
      meta: [["Dated", shortDate(offer.createdAt || Date.now())], ["Valid until", offer.validityDate ? shortDate(offer.validityDate) : "—"]],
      parties: [
        { heading: `${T.saleBuyer} information`, name: buyer.fullName || "—", lines: [buyer.buyerNumber ? `${T.saleBuyer} No.: ${buyer.buyerNumber}` : "", buyer.phone, buyer.email, buyer.idNumber ? `ID / Passport: ${buyer.idNumber}` : ""] },
        { heading: "Property details", name: listing.title || "—", lines: [listing.listingNumber ? `${T.saleListing} No.: ${listing.listingNumber}` : "", listing.propertyType, [listing.location?.area, listing.location?.city].filter(Boolean).join(", ")] },
        ...(agent ? [{ heading: `Sales ${T.saleAgent}`, name: agent.fullName || "—", lines: [agent.agentNumber ? `${T.saleAgent} No.: ${agent.agentNumber}` : "", `Commission: ${agent.commissionRate || 0}${agent.commissionType === "percentage" ? "%" : " KES (Flat)"}`] }] : []),
      ],
      totals: [
        { label: "Asking price", value: kes(listing.askingPrice) },
        ...(offer.counterOfferAmount ? [{ label: `Counter ${T.saleOffer} (seller)`, value: kes(offer.counterOfferAmount), strong: true }] : []),
        { label: `${T.saleBuyer}'s ${T.saleOffer} price`, value: kes(offer.offerAmount), hero: true },
      ],
      amountWords: { amount: offer.offerAmount, currency: "KES" },
      notes: [
        ...(offer.negotiationNotes ? [{ heading: "Negotiation notes", text: offer.negotiationNotes }] : []),
        ...(offer.notes ? [{ heading: "Additional notes", text: offer.notes }] : []),
        { heading: "Disclaimer", text: "This document is a formal expression of interest and does not constitute a binding sale agreement until countersigned by all parties and a formal Sale Agreement is executed." },
      ],
      signatures: [
        { label: `${T.saleBuyer} signature`, name: buyer.fullName || "" },
        { label: `Sales ${T.saleAgent}`, name: agent?.fullName || "Unassigned" },
        { label: "Authorised officer", name: co.companyName || co.name || "" },
      ],
      stamp: true,
    });
    if (!printed) toast.warn(`Allow pop-ups to print the ${T.saleOffer.toLowerCase()}`);
  }, [currentCompany, T.saleOffer, T.saleBuyer, T.saleListing, T.saleAgent]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const overdueCount = useMemo(() => offers.filter((o) => isOfferOverdue(o.validityDate, o.status)).length, [offers]);

  const renderOfferActions = useCallback((o) => {
    const hasCounter = !!o.counterOfferAmount;
    const isCounterActive = o.status === "negotiating" && hasCounter;
    const isAccepted = o.status === "accepted";
    return (
      <div className="inline-flex flex-wrap justify-end gap-1">
        <button onClick={() => printOffer(o)} title="Print" className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
          <FaPrint size={9} />
        </button>
        {isCounterActive && (
          <>
            <button onClick={() => handleAcceptCounter(o)} disabled={saving} title={`Accept Counter ${T.saleOffer}`} className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
              <FaCheck size={9} /> Accept
            </button>
            <button onClick={() => handleRejectCounter(o)} disabled={saving} title={`Reject Counter ${T.saleOffer}`} className="inline-flex items-center gap-1 border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-40">
              <FaTimes size={9} /> Reject
            </button>
          </>
        )}
        {isAccepted && (
          <button onClick={() => setShowConvertDeal(o)} title={`Convert to ${T.saleDeal}`} className="border border-[#B7C9C0] bg-[#F1F6F3] px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#B7C9C0]/40">
            <FaHandshake size={9} />
          </button>
        )}
        {["pending", "negotiating"].includes(o.status) && (
          <button title={isCounterActive ? "Edit Counter / Change Status" : "Update Status"} onClick={() => setShowStatus(o)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaEdit />
          </button>
        )}
        {["pending", "rejected", "expired", "withdrawn"].includes(o.status) && (
          <button onClick={() => handleDelete(o)} title="Delete" className="border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50">
            <FaTimes />
          </button>
        )}
      </div>
    );
  }, [printOffer, saving, handleAcceptCounter, handleRejectCounter, handleDelete, T.saleOffer, T.saleDeal]);

  const buildReportFilters = () => ({
    business: biz,
    ...(statusFilter    && { status:    statusFilter }),
    ...(debouncedSearch && { search:    debouncedSearch }),
    ...(listingFilt     && { listingId: listingFilt }),
    ...(buyerFilt       && { buyerId:   buyerFilt }),
  });
  const reportColumns = [
    { label: `${T.saleOffer} No.`, value: (o) => o.offerNumber },
    { label: "Property", value: (o) => o.listing?.title || o.listing?.listingNumber || "—" },
    { label: T.saleBuyer, value: (o) => o.buyer?.fullName || "—" },
    { label: T.saleAgent, value: (o) => o.agent?.fullName || "—" },
    { label: `${T.saleOffer} Amount (KES)`, align: "right", value: (o) => money(o.offerAmount) },
    { label: "Counter / Final (KES)", align: "right", value: (o) => (o.counterOfferAmount ? money(o.counterOfferAmount) : "—") },
    { label: "Validity", value: (o) => (o.validityDate ? shortDate(o.validityDate) : "—") },
    { label: "Status", value: (o) => o.status },
  ];

  const [printing, setPrinting] = useState(false);
  const printReport = async () => {
    setPrinting(true);
    const described = [
      statusFilter && `Status: ${statusFilter}`,
      listingFilt && listings.find((l) => l._id === listingFilt)?.title,
      buyerFilt && buyers.find((b) => b._id === buyerFilt)?.fullName,
      debouncedSearch && `Search: ${debouncedSearch}`,
    ].filter(Boolean);
    await printAfterFetch(() => fetchAllPages(saleApi.listOffers, buildReportFilters()), ({ rows }) => ({
      title: T.saleOffers,
      subtitle: described.join(" · ") || `All ${T.saleOffers.toLowerCase()}`,
      company: currentCompany,
      columns: reportColumns,
      rows,
      totalsRow: ["TOTAL", "", "", "", money(rows.reduce((s, o) => s + Number(o.offerAmount || 0), 0)), "", "", ""],
    }));
    setPrinting(false);
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    await exportAfterFetch(() => fetchAllPages(saleApi.listOffers, buildReportFilters()), ({ rows }) => ({
      filename: "offers",
      columns: reportColumns,
      rows,
    }));
    setExporting(false);
  };

  return (
    <PropertySaleShell>
      <div className="flex-1 min-h-0 flex flex-col gap-1">
        {/* Filter bar */}
        <SaleFilterBar
          leading={overdueCount > 0 ? <span className="shrink-0 font-mono text-[9px] font-black text-rose-600">{overdueCount} past validity</span> : null}
          onReset={() => { setSearch(""); setStatusFilter(""); setListingFilt(""); setBuyerFilt(""); setPage(1); }}
          activeCount={[search, statusFilter, listingFilt, buyerFilt].filter(Boolean).length}
          trailing={
            <>
              <SalePrintButton onClick={printReport} busy={printing} disabled={isFetching || total === 0} />
              <SaleExportButton onClick={exportReport} busy={exporting} disabled={isFetching || total === 0} />
              <ListToolbar.Button variant="outline" onClick={invalidate}>
                <FaRedoAlt size={7} className={isFetching ? "animate-spin" : ""} /> Refresh
              </ListToolbar.Button>
              <ListToolbar.Button icon={FaPlus} onClick={() => setShowCreate(true)}>
                New {T.saleOffer}
              </ListToolbar.Button>
            </>
          }
        >
          <FilterSearch
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={`${T.saleOffer} no. / ${T.saleListing.toLowerCase()} / ${T.saleBuyer.toLowerCase()}…`}
          />
          <AppSelect value={statusFilter} onChange={(v) => { setStatusFilter(v ?? ""); setPage(1); }} options={OFFER_STATUS_FILTER_OPTIONS} placeholder="All Statuses" clearable compact />
          <AppSelect value={listingFilt} onChange={(v) => { setListingFilt(v ?? ""); setPage(1); }} options={listingFilterOptions} placeholder={`All ${T.saleListings}`} clearable compact searchable />
          <AppSelect value={buyerFilt} onChange={(v) => { setBuyerFilt(v ?? ""); setPage(1); }} options={buyerFilterOptions} placeholder={`All ${T.saleBuyers}`} clearable compact searchable />
        </SaleFilterBar>

        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
          <MilikTable
            columns={offerCols}
            rows={offers}
            loading={isFetching && offers.length === 0}
            empty={`No ${T.saleOffers.toLowerCase()} found.`}
            rowClassName={offerRowClassName}
            renderRow={renderOfferRow}
            renderExpanded={renderOfferExpanded}
            renderActions={renderOfferActions}
          />
          <PaginationBar page={page} pages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} label={T.saleOffers.toLowerCase()} />
        </div>
      </div>

      {/* Create Offer Modal */}
      {showCreate && (
        <CreateOfferModal saving={saving} listingFormOptions={listingFormOptions} buyerFormOptions={buyerFormOptions} activeAgentOptions={activeAgentOptions} onClose={() => setShowCreate(false)} onSubmit={handleCreate} />
      )}

      {/* Status Update Modal */}
      {showStatus && (
        <OfferStatusModal offer={showStatus} saving={saving} onClose={() => setShowStatus(null)} onSubmit={handleStatusUpdate} />
      )}

      {/* Convert to Deal — the same DealFormModal the Deals page itself uses, just pre-filled from the
          offer (listing/buyer locked read-only, agreed price seeded from the accepted/countered amount,
          the offer's own comparison tiles shown at top) via the `offer` prop. */}
      {showConvertDeal && (
        <DealFormModal
          editingId=""
          offer={showConvertDeal}
          initial={{
            listing: showConvertDeal.listing?._id || showConvertDeal.listing || "",
            buyer: showConvertDeal.buyer?._id || showConvertDeal.buyer || "",
            agent: showConvertDeal.agent?._id || showConvertDeal.agent || "",
            advocate: (() => {
              const listingId = showConvertDeal.listing?._id || showConvertDeal.listing || "";
              const suggested = listingFormOptions.find((o) => o.value === listingId)?.advocate;
              return suggested && advocateFormOptions.some((o) => o.value === suggested) ? suggested : "";
            })(),
            agreedPrice: String(showConvertDeal.counterOfferAmount || showConvertDeal.offerAmount || ""),
            paymentPlan: "installment",
            dealDate: todayISO(),
            expectedClosingDate: "",
            notes: `Converted from ${T.saleOffer.toLowerCase()} ${showConvertDeal.offerNumber}`,
            commOverrideEnabled: false, commissionRateOverride: "", commissionTypeOverride: "", commissionAmountOverride: "",
            ...blankScheduleGeneratorFields,
          }}
          saving={converting}
          listingFormOptions={listingFormOptions}
          buyerOptions={buyerFormOptions}
          agentFormOptions={activeAgentOptions}
          agents={agents}
          advocateFormOptions={advocateFormOptions}
          onClose={() => setShowConvertDeal(null)}
          onSubmit={handleConvertDeal}
        />
      )}
    </PropertySaleShell>
  );
};

export default SaleOffers;

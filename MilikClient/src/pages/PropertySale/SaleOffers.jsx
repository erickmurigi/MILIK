import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { FaCheck, FaEdit, FaHandshake, FaPlus, FaPrint, FaRedoAlt, FaTimes } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi, todayISO } from "../../services/propertySaleApi";
import AmountInput from "./AmountInput";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";

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
const EMPTY_DEAL = { listing: "", buyer: "", agent: "", agreedPrice: "", dealDate: todayISO(), notes: "" };
const LIMIT = 50;

const OFFER_STATUS_FILTER_OPTIONS = ["pending", "negotiating", "accepted", "rejected", "expired", "withdrawn"].map((s) => ({
  value: s,
  label: s === "negotiating" ? "Counter Active" : s.charAt(0).toUpperCase() + s.slice(1),
}));
const OFFER_STATUS_UPDATE_OPTIONS = [
  { value: "negotiating", label: "Send Counter Offer" },
  { value: "accepted",    label: "Accept Offer / Counter" },
  { value: "rejected",    label: "Reject" },
  { value: "expired",     label: "Mark as Expired" },
  { value: "withdrawn",   label: "Withdrawn by Buyer" },
];

const OFFER_TABLE_COLS = [
  { label: "Offer No." },
  { label: "Property" },
  { label: "Buyer" },
  { label: "Agent" },
  { label: "Offer Amount",      align: "right" },
  { label: "Counter / Final",   align: "right" },
  { label: "Validity" },
  { label: "Status" },
];

const SaleOffers = () => {
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
  const [form, setForm] = useState(EMPTY_FORM);
  const [statusForm, setStatusForm] = useState(EMPTY_STATUS);
  const [dealForm, setDealForm] = useState(EMPTY_DEAL);
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
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const offers = offersPage?.data ?? [];
  const total = offersPage?.total ?? 0;

  const { data: listingsPage } = useQuery({
    queryKey: ["sale-listings-ref", biz],
    queryFn: () => saleApi.listListings({ business: biz, limit: 200 }),
    enabled: !!biz,
    staleTime: 60_000,
  });
  const listings = listingsPage?.data ?? [];

  const { data: buyersPage } = useQuery({
    queryKey: ["sale-buyers-ref", biz],
    queryFn: () => saleApi.listBuyers({ business: biz, limit: 200 }),
    enabled: !!biz,
    staleTime: 60_000,
  });
  const buyers = buyersPage?.data ?? [];

  const { data: agentsPage } = useQuery({
    queryKey: ["sale-agents-ref", biz],
    queryFn: () => saleApi.listAgents({ business: biz, limit: 200 }),
    enabled: !!biz,
    staleTime: 60_000,
  });
  const agents = agentsPage?.data ?? [];

  const activeAgentOptions  = useMemo(() => agents.filter((a) => a.status === "active").map((a) => ({ value: a._id, label: `${a.agentNumber} — ${a.fullName}` })), [agents]);
  const listingFilterOptions= useMemo(() => listings.map((l) => ({ value: l._id, label: `${l.listingNumber} — ${l.title}` })), [listings]);
  const listingFormOptions  = useMemo(() => listings.filter((l) => ["available", "reserved", "under_contract"].includes(l.status)).map((l) => ({ value: l._id, label: `${l.listingNumber} — ${l.title}` })), [listings]);
  const buyerFilterOptions  = useMemo(() => buyers.map((b) => ({ value: b._id, label: `${b.fullName}${b.buyerNumber ? ` (${b.buyerNumber})` : ""}` })), [buyers]);
  const buyerFormOptions    = useMemo(() => buyers.map((b) => ({ value: b._id, label: `${b.buyerNumber} — ${b.fullName}` })), [buyers]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["sale-offers", biz] });

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.listing || !form.buyer || !form.offerAmount) {
      toast.warn("Listing, buyer and offer amount are required");
      return;
    }
    setSaving(true);
    try {
      await saleApi.createOffer({ ...form, business: biz });
      toast.success("Offer recorded");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      invalidate();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record offer");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusUpdate = async (e) => {
    e.preventDefault();
    if (!statusForm.status) { toast.warn("Select a status"); return; }
    setSaving(true);
    try {
      await saleApi.updateOfferStatus(showStatus._id, { ...statusForm, business: biz });
      toast.success("Offer status updated");
      setShowStatus(null);
      setStatusForm(EMPTY_STATUS);
      invalidate();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  const handleAcceptCounter = async (offer) => {
    if (!await confirm({
      title: "Accept Counter Offer",
      message: `Accept the counter offer of ${fmtKES(offer.counterOfferAmount)} for ${offer.offerNumber}? The original offer was ${fmtKES(offer.offerAmount)}.`,
      confirmText: "Accept Counter",
    })) return;
    setSaving(true);
    try {
      await saleApi.updateOfferStatus(offer._id, {
        status: "accepted",
        negotiationNotes: "Counter offer accepted by buyer",
        business: biz,
      });
      toast.success("Counter offer accepted — offer is now Accepted");
      invalidate();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to accept counter offer");
    } finally {
      setSaving(false);
    }
  };

  const handleRejectCounter = async (offer) => {
    if (!await confirm({
      title: "Reject Counter Offer",
      message: `Reject the counter offer for ${offer.offerNumber}? The offer status will be marked as rejected.`,
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
      toast.success("Offer rejected");
      invalidate();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to reject offer");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenConvertDeal = (offer) => {
    const agreedPrice = String(offer.counterOfferAmount || offer.offerAmount || "");
    setDealForm({
      listing: offer.listing?._id || offer.listing || "",
      buyer: offer.buyer?._id || offer.buyer || "",
      agent: offer.agent?._id || offer.agent || "",
      agreedPrice,
      dealDate: todayISO(),
      notes: `Converted from offer ${offer.offerNumber}`,
    });
    setShowConvertDeal(offer);
  };

  const handleConvertDeal = async (e) => {
    e.preventDefault();
    if (!dealForm.agreedPrice) { toast.warn("Agreed price is required"); return; }
    setConverting(true);
    try {
      await saleApi.createDealFromOffer(showConvertDeal._id, {
        agreedPrice:         dealForm.agreedPrice,
        dealDate:            dealForm.dealDate,
        expectedClosingDate: dealForm.expectedClosingDate,
        notes:               dealForm.notes,
      });
      toast.success("Deal created! View it in the Deals section.");
      setShowConvertDeal(null);
      setDealForm(EMPTY_DEAL);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-deals", biz] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to create deal");
    } finally {
      setConverting(false);
    }
  };

  const handleDelete = async (offer) => {
    if (!await confirm({
      title: "Delete Offer",
      message: `Permanently delete offer ${offer.offerNumber}? This cannot be undone.`,
      confirmText: "Delete",
      isDangerous: true,
    })) return;
    try {
      await saleApi.deleteOffer(offer._id);
      toast.success("Offer deleted");
      invalidate();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to delete");
    }
  };

  const printOffer = (offer) => {
    const co = currentCompany || {};
    const html = `<!DOCTYPE html><html><head><title>Offer — ${offer.offerNumber}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;background:#fff}
.page{max-width:210mm;margin:0 auto;padding:18mm 18mm 14mm}
.hdr{border-bottom:3px solid #0B3B2E;padding-bottom:10px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-start}
.brand{font-size:22px;font-weight:900;color:#0B3B2E;letter-spacing:2px}
.brand img{height:52px;object-fit:contain}
.co-info{text-align:right;font-size:9.5px;color:#444;line-height:1.7}
.doc-title{text-align:center;margin:16px 0 18px}
.doc-title h1{font-size:18px;font-weight:900;letter-spacing:3px;color:#0B3B2E;text-transform:uppercase}
.doc-title p{font-size:10px;color:#555;margin-top:3px}
.ref-bar{display:flex;justify-content:space-between;background:#f8fafb;border:1px solid #e0e7ef;border-radius:6px;padding:10px 14px;margin-bottom:18px;font-size:10px}
.ref-bar span{font-weight:700;color:#0B3B2E}
.sec{font-size:9px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#0B3B2E;border-bottom:1.5px solid #0B3B2E;padding-bottom:4px;margin:16px 0 10px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 14px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}
.f label{font-size:8.5px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:2px}
.f span{font-size:11px;font-weight:600;color:#111;display:block;padding:5px 8px;border:1px solid #e5e7eb;border-radius:4px;background:#fafafa;min-height:26px}
.price-box{background:#0B3B2E;color:#fff;border-radius:8px;padding:14px 20px;margin:16px 0;display:flex;justify-content:space-between;align-items:center}
.price-box .lbl{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.8}
.price-box .amt{font-size:22px;font-weight:900;font-family:monospace}
.counter-box{background:#5b21b6;color:#fff;border-radius:8px;padding:10px 20px;margin:-8px 0 16px;display:flex;justify-content:space-between;align-items:center}
.notes{border:1px solid #e5e7eb;border-radius:6px;padding:10px;background:#fafafa;font-size:10.5px;line-height:1.6;min-height:40px}
.sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:32px}
.sig{border-top:1.5px solid #333;padding-top:6px}
.sig p{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#555;margin-top:2px}
.footer{margin-top:24px;padding-top:10px;border-top:1.5px solid #0B3B2E;font-size:8.5px;color:#777;text-align:center}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="page">
<div class="hdr">
  <div class="brand">${co.logo ? `<img src="${co.logo}" alt="logo"/>` : (co.companyName || "MILIK")}</div>
  <div class="co-info"><strong>${co.companyName || ""}</strong><br/>${co.physicalAddress || co.postalAddress || ""}<br/>${[co.telephone, co.email].filter(Boolean).join(" | ")}<br/>${co.pinNumber ? "PIN: " + co.pinNumber : ""}</div>
</div>
<div class="doc-title"><h1>Purchase Offer Document</h1><p>Formal Expression of Interest / Offer to Purchase</p></div>
<div class="ref-bar">
  <div>Offer Ref: <span>${offer.offerNumber}</span></div>
  <div>Status: <span>${(offer.status || "pending").toUpperCase()}</span></div>
  <div>Dated: <span>${offer.createdAt ? new Date(offer.createdAt).toLocaleDateString("en-KE") : new Date().toLocaleDateString("en-KE")}</span></div>
</div>
<div class="price-box">
  <div><div class="lbl">Buyer's Offer Price</div><div class="amt">${fmtKES(offer.offerAmount)}</div></div>
  <div style="text-align:right;font-size:10px;opacity:.8">Asking: ${fmtKES(offer.listing?.askingPrice)}</div>
</div>
${offer.counterOfferAmount ? `<div class="counter-box">
  <div><div class="lbl">Counter Offer (Seller)</div><div class="amt">${fmtKES(offer.counterOfferAmount)}</div></div>
  <div style="text-align:right;font-size:10px;opacity:.8">Delta vs offer: ${offer.counterOfferAmount > offer.offerAmount ? "+" : ""}${Math.round(((offer.counterOfferAmount - offer.offerAmount) / offer.offerAmount) * 100)}%</div>
</div>` : ""}
<div class="sec">Property Details</div>
<div class="g3">
  <div class="f"><label>Listing No.</label><span>${offer.listing?.listingNumber || "-"}</span></div>
  <div class="f"><label>Property Title</label><span>${offer.listing?.title || "-"}</span></div>
  <div class="f"><label>Asking Price</label><span>${fmtKES(offer.listing?.askingPrice)}</span></div>
  <div class="f"><label>Type</label><span style="text-transform:capitalize">${offer.listing?.propertyType || "-"}</span></div>
  <div class="f"><label>Location</label><span>${[offer.listing?.location?.area, offer.listing?.location?.city].filter(Boolean).join(", ") || "-"}</span></div>
</div>
<div class="sec">Buyer Information</div>
<div class="g3">
  <div class="f"><label>Buyer No.</label><span>${offer.buyer?.buyerNumber || "-"}</span></div>
  <div class="f"><label>Full Name</label><span>${offer.buyer?.fullName || "-"}</span></div>
  <div class="f"><label>Phone</label><span>${offer.buyer?.phone || "-"}</span></div>
  <div class="f"><label>Email</label><span>${offer.buyer?.email || "-"}</span></div>
  <div class="f"><label>ID / Passport</label><span>${offer.buyer?.idNumber || "-"}</span></div>
</div>
${offer.agent ? `<div class="sec">Sales Agent</div><div class="g3">
  <div class="f"><label>Agent No.</label><span>${offer.agent?.agentNumber || "-"}</span></div>
  <div class="f"><label>Name</label><span>${offer.agent?.fullName || "-"}</span></div>
  <div class="f"><label>Commission</label><span>${offer.agent?.commissionRate || 0}${offer.agent?.commissionType === "percentage" ? "%" : " KES (Flat)"}</span></div>
</div>` : ""}
<div class="sec">Terms</div>
<div class="g2">
  <div class="f"><label>Validity Date</label><span>${offer.validityDate ? new Date(offer.validityDate).toLocaleDateString("en-KE") : "-"}</span></div>
  <div class="f"><label>Current Status</label><span style="text-transform:capitalize">${offer.status || "pending"}</span></div>
</div>
${offer.negotiationNotes ? `<div class="sec">Negotiation Notes</div><div class="notes">${offer.negotiationNotes}</div>` : ""}
${offer.notes ? `<div class="sec">Additional Notes</div><div class="notes">${offer.notes}</div>` : ""}
<div class="sigs">
  <div class="sig"><br/><p>Buyer Signature</p><p style="color:#111">${offer.buyer?.fullName || ""}</p></div>
  <div class="sig"><br/><p>Sales Agent</p><p style="color:#111">${offer.agent?.fullName || "Unassigned"}</p></div>
  <div class="sig"><br/><p>Authorized Officer</p><p style="color:#111">${co.companyName || ""}</p></div>
</div>
<div class="footer">
  This document is a formal expression of interest and does not constitute a binding sale agreement until countersigned by all parties and a formal Sale Agreement is executed.
  &nbsp;|&nbsp; Generated: ${new Date().toLocaleString("en-KE")} &nbsp;|&nbsp; MILIK Property Sales System
</div>
</div></body></html>`;
    const w = window.open("", "_blank", "width=900,height=700");
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <PropertySaleShell>
      <div className="flex-1 min-h-0 flex flex-col gap-1">
        {/* Filter bar */}
        <SaleFilterBar
          leading={<span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{total} offer{total !== 1 ? "s" : ""}</span>}
          onReset={() => { setSearch(""); setStatusFilter(""); setListingFilt(""); setBuyerFilt(""); setPage(1); }}
          activeCount={[search, statusFilter, listingFilt, buyerFilt].filter(Boolean).length}
          trailing={
            <>
              <button
                type="button"
                onClick={invalidate}
                className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
              >
                <FaRedoAlt size={9} className={isFetching ? "animate-spin" : ""} /> Refresh
              </button>
              <button
                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }}
                className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
              >
                <FaPlus size={9} /> New Offer
              </button>
            </>
          }
        >
          <FilterSearch
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Offer no. / listing / buyer…"
          />
          <AppSelect value={statusFilter} onChange={(v) => { setStatusFilter(v ?? ""); setPage(1); }} options={OFFER_STATUS_FILTER_OPTIONS} placeholder="All Statuses" clearable size="sm" />
          <AppSelect value={listingFilt} onChange={(v) => { setListingFilt(v ?? ""); setPage(1); }} options={listingFilterOptions} placeholder="All Listings" clearable size="sm" searchable />
          <AppSelect value={buyerFilt} onChange={(v) => { setBuyerFilt(v ?? ""); setPage(1); }} options={buyerFilterOptions} placeholder="All Buyers" clearable size="sm" searchable />
        </SaleFilterBar>

        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
          <MilikTable
            columns={OFFER_TABLE_COLS}
            rows={offers}
            loading={isFetching && offers.length === 0}
            empty="No offers found."
            rowClassName={(o) => {
              const isCounterActive = o.status === "negotiating" && !!o.counterOfferAmount;
              return isCounterActive ? "!bg-[#F1F6F3]" : "";
            }}
            renderRow={(o) => {
              const hasCounter = !!o.counterOfferAmount;
              const isCounterActive = o.status === "negotiating" && hasCounter;
              const isAccepted = o.status === "accepted";
              const counterDelta = hasCounter ? Math.round(((o.counterOfferAmount - o.offerAmount) / o.offerAmount) * 100) : null;
              return (
                <>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-black text-slate-900">{o.offerNumber}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700">{o.listing?.title || o.listing?.listingNumber || "—"}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700">{o.buyer?.fullName || "—"}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">{o.agent?.fullName || <span className="italic text-slate-300">—</span>}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right">
                    <div className="font-black text-slate-900">{fmtKES(o.offerAmount)}</div>
                    {o.listing?.askingPrice > 0 && (
                      <div className={`text-[10px] font-bold ${o.offerAmount < o.listing.askingPrice ? "text-rose-500" : o.offerAmount > o.listing.askingPrice ? "text-emerald-500" : "text-slate-400"}`}>
                        {o.offerAmount >= o.listing.askingPrice ? "+" : ""}{Math.round(((o.offerAmount - o.listing.askingPrice) / o.listing.askingPrice) * 100)}% vs asking
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right">
                    {hasCounter ? (
                      <div>
                        <div className={`font-black ${isAccepted ? "text-emerald-700" : "text-violet-700"}`}>{fmtKES(o.counterOfferAmount)}</div>
                        <div className="mt-0.5 flex items-center justify-end gap-1">
                          {isCounterActive && <span className="inline-flex border border-violet-300 bg-violet-100 px-1.5 py-0 text-[9px] font-black uppercase tracking-wider text-violet-700">counter</span>}
                          {isAccepted && <span className="inline-flex border border-emerald-300 bg-emerald-100 px-1.5 py-0 text-[9px] font-black uppercase tracking-wider text-emerald-700">final</span>}
                        </div>
                        {counterDelta !== null && <div className={`text-[10px] font-bold ${counterDelta > 0 ? "text-rose-500" : "text-emerald-500"}`}>{counterDelta > 0 ? "+" : ""}{counterDelta}% vs offer</div>}
                      </div>
                    ) : isAccepted ? (
                      <div>
                        <div className="font-black text-emerald-700">{fmtKES(o.offerAmount)}</div>
                        <span className="inline-flex border border-emerald-300 bg-emerald-100 px-1.5 py-0 text-[9px] font-black uppercase tracking-wider text-emerald-700">final</span>
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">{o.validityDate ? new Date(o.validityDate).toLocaleDateString("en-KE") : "—"}</td>
                  <td className="px-3 py-1.5">
                    <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_BADGE[o.status] || "border-slate-200 bg-slate-100 text-slate-600"}`}>
                      {isCounterActive ? "Counter Active" : o.status}
                    </span>
                  </td>
                </>
              );
            }}
            renderActions={(o) => {
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
                      <button onClick={() => handleAcceptCounter(o)} disabled={saving} title="Accept Counter Offer" className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                        <FaCheck size={9} /> Accept
                      </button>
                      <button onClick={() => handleRejectCounter(o)} disabled={saving} title="Reject Counter Offer" className="inline-flex items-center gap-1 border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-40">
                        <FaTimes size={9} /> Reject
                      </button>
                    </>
                  )}
                  {isAccepted && (
                    <button onClick={() => handleOpenConvertDeal(o)} title="Convert to Deal" className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-[#F1F6F3] px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#B7C9C0]/40">
                      <FaHandshake size={9} /> Deal
                    </button>
                  )}
                  {["pending", "negotiating"].includes(o.status) && (
                    <button title={isCounterActive ? "Edit Counter / Change Status" : "Update Status"} onClick={() => { setShowStatus(o); setStatusForm({ ...EMPTY_STATUS, counterOfferAmount: o.counterOfferAmount || "" }); }} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                      <FaEdit />
                    </button>
                  )}
                  {["pending", "rejected", "expired", "withdrawn"].includes(o.status) && (
                    <button onClick={() => handleDelete(o)} title="Delete" className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600 hover:bg-rose-100">
                      <FaTimes />
                    </button>
                  )}
                </div>
              );
            }}
          />
          <PaginationBar page={page} pages={totalPages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} />
        </div>
      </div>

      {/* Create Offer Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
          <form onSubmit={handleCreate} className="flex w-full max-w-lg flex-col bg-white shadow-2xl sm:border sm:border-slate-200 max-h-[92dvh] rounded-t-2xl sm:rounded-none">
            <div className="flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
              <div>
                <div className="text-sm font-extrabold uppercase tracking-wide">Record New Offer</div>
                <div className="text-xs font-semibold text-white/70">Formal purchase offer against a listing</div>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <AppSelect label="Listing *" value={form.listing} onChange={(v) => setForm((f) => ({ ...f, listing: v ?? "" }))} options={listingFormOptions} placeholder="Select listing" size="md" searchable />
              </div>
              <div>
                <AppSelect label="Buyer *" value={form.buyer} onChange={(v) => setForm((f) => ({ ...f, buyer: v ?? "" }))} options={buyerFormOptions} placeholder="Select buyer" size="md" searchable />
              </div>
              <div>
                <AppSelect label="Sales Agent" value={form.agent} onChange={(v) => setForm((f) => ({ ...f, agent: v ?? "" }))} options={activeAgentOptions} placeholder="Unassigned" size="md" searchable clearable />
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">Offer Amount (KES) *</label>
                <AmountInput
                  value={form.offerAmount}
                  onChange={(v) => setForm((f) => ({ ...f, offerAmount: v }))}
                  className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none"
                  placeholder="e.g. 5,000,000"
                  required
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">Validity Date</label>
                <input type="date" value={form.validityDate}
                  onChange={(e) => setForm((f) => ({ ...f, validityDate: e.target.value }))}
                  className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div className="md:col-span-2">
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">Notes</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0B3B2E] focus:outline-none" />
              </div>
            </div>
            <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setShowCreate(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {saving ? "Saving…" : "Record Offer"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Status Update Modal */}
      {showStatus && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
          <form onSubmit={handleStatusUpdate} className="flex w-full max-w-md flex-col bg-white shadow-2xl sm:border sm:border-slate-200 max-h-[92dvh] rounded-t-2xl sm:rounded-none">
            <div className="flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-800 px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
              <div>
                <div className="text-sm font-extrabold uppercase tracking-wide">Update Offer Status</div>
                <div className="text-xs font-semibold text-white/70">{showStatus.offerNumber} — {showStatus.listing?.title || ""}</div>
              </div>
              <button type="button" onClick={() => setShowStatus(null)} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-2">
                <div className="border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Buyer's Offer</div>
                  <div className="font-black text-slate-900">{fmtKES(showStatus.offerAmount)}</div>
                </div>
                {showStatus.counterOfferAmount ? (
                  <div className="border border-violet-200 bg-violet-50 px-3 py-2 text-xs">
                    <div className="text-[10px] font-black uppercase tracking-wider text-violet-500">Current Counter</div>
                    <div className="font-black text-violet-800">{fmtKES(showStatus.counterOfferAmount)}</div>
                  </div>
                ) : (
                  <div className="border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Asking Price</div>
                    <div className="font-black text-slate-900">{fmtKES(showStatus.listing?.askingPrice)}</div>
                  </div>
                )}
              </div>

              <div>
                <AppSelect label="New Status *" value={statusForm.status} onChange={(v) => setStatusForm((f) => ({ ...f, status: v ?? "" }))} options={OFFER_STATUS_UPDATE_OPTIONS} placeholder="Select status" size="md" />
              </div>

              {statusForm.status === "negotiating" && (
                <div>
                  <label className="mb-0.5 block text-xs font-semibold text-slate-700">Counter-Offer Amount (KES) *</label>
                  <AmountInput
                    value={statusForm.counterOfferAmount}
                    onChange={(v) => setStatusForm((f) => ({ ...f, counterOfferAmount: v }))}
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none"
                    placeholder="e.g. 5,500,000"
                  />
                  {statusForm.counterOfferAmount && showStatus.offerAmount && (
                    <div className={`mt-1 text-[10px] font-bold ${Number(statusForm.counterOfferAmount) > Number(showStatus.offerAmount) ? "text-rose-500" : "text-emerald-500"}`}>
                      {Number(statusForm.counterOfferAmount) > Number(showStatus.offerAmount) ? "+" : ""}
                      {Math.round(((Number(statusForm.counterOfferAmount) - Number(showStatus.offerAmount)) / Number(showStatus.offerAmount)) * 100)}% vs buyer's offer
                    </div>
                  )}
                </div>
              )}

              {statusForm.status === "accepted" && (
                <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] text-emerald-800">
                  <span className="font-black">Accepted price: </span>
                  <span className="font-bold">{fmtKES(showStatus.counterOfferAmount || showStatus.offerAmount)}</span>
                  {showStatus.counterOfferAmount && <span className="ml-1 opacity-70">(counter offer)</span>}
                  <div className="mt-1 opacity-80">After accepting, use the <strong>Deal</strong> button to convert this offer into a transaction.</div>
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
              <button type="button" onClick={() => setShowStatus(null)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {saving ? "Saving…" : "Update Status"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Convert to Deal Modal */}
      {showConvertDeal && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
          <form onSubmit={handleConvertDeal} className="flex w-full max-w-lg flex-col bg-white shadow-2xl sm:border sm:border-slate-200 max-h-[92dvh] rounded-t-2xl sm:rounded-none">
            <div className="flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
              <div>
                <div className="text-sm font-extrabold uppercase tracking-wide">Convert Offer to Deal</div>
                <div className="text-xs font-semibold text-white/70">{showConvertDeal.offerNumber} — {showConvertDeal.buyer?.fullName || ""}</div>
              </div>
              <button type="button" onClick={() => setShowConvertDeal(null)} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <div className="grid grid-cols-3 gap-2 border border-emerald-200 bg-emerald-50 p-3">
                  <div className="text-center">
                    <div className="text-[10px] font-black uppercase tracking-wider text-emerald-500">Asking</div>
                    <div className="font-black text-emerald-900">{fmtKES(showConvertDeal.listing?.askingPrice)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] font-black uppercase tracking-wider text-emerald-500">Buyer Offered</div>
                    <div className="font-black text-emerald-900">{fmtKES(showConvertDeal.offerAmount)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] font-black uppercase tracking-wider text-emerald-500">
                      {showConvertDeal.counterOfferAmount ? "Countered At" : "Agreed"}
                    </div>
                    <div className="font-black text-emerald-900">
                      {fmtKES(showConvertDeal.counterOfferAmount || showConvertDeal.offerAmount)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">Final Agreed Price (KES) *</label>
                <AmountInput
                  value={dealForm.agreedPrice}
                  onChange={(v) => setDealForm((f) => ({ ...f, agreedPrice: v }))}
                  className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0B3B2E] focus:outline-none"
                  placeholder="Confirmed sale price"
                  required
                />
                <div className="mt-1 text-[10px] text-slate-400">Pre-filled from accepted price. Adjust if a final verbal agreement was reached.</div>
              </div>

              <div>
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">Deal Date *</label>
                <input type="date" value={dealForm.dealDate}
                  onChange={(e) => setDealForm((f) => ({ ...f, dealDate: e.target.value }))}
                  className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0B3B2E] focus:outline-none" required />
              </div>
              <div>
                <AppSelect label="Assign Agent" value={dealForm.agent} onChange={(v) => setDealForm((f) => ({ ...f, agent: v ?? "" }))} options={activeAgentOptions} placeholder="Unassigned" size="md" searchable clearable />
              </div>
              <div className="md:col-span-2">
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">Deal Notes</label>
                <textarea rows={2} value={dealForm.notes}
                  onChange={(e) => setDealForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0B3B2E] focus:outline-none" />
              </div>
            </div>
            <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setShowConvertDeal(null)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={converting} className="inline-flex items-center gap-1 bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                <FaHandshake className="text-[9px]" /> {converting ? "Creating…" : "Create Deal"}
              </button>
            </div>
          </form>
        </div>
      )}
    </PropertySaleShell>
  );
};

export default SaleOffers;

import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaCheck, FaEdit, FaHandshake, FaPlus, FaPrint, FaTimes } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import { fmtKES, saleApi, todayISO } from "../../services/propertySaleApi";
import AmountInput from "./AmountInput";
import { useConfirm } from "../../context/ConfirmContext";

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

const SaleOffers = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;
  const confirm = useConfirm();

  const [offers, setOffers] = useState([]);
  const [listings, setListings] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showStatus, setShowStatus] = useState(null);
  const [showConvertDeal, setShowConvertDeal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [statusForm, setStatusForm] = useState(EMPTY_STATUS);
  const [dealForm, setDealForm] = useState(EMPTY_DEAL);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);

  const load = useCallback(async () => {
    if (!biz) return;
    setLoading(true);
    try {
      const res = await saleApi.listOffers({
        business: biz, limit: LIMIT, page,
        ...(statusFilter && { status: statusFilter }),
        ...(search && { search }),
      });
      const items = Array.isArray(res) ? res : (res?.offers ?? []);
      setOffers(items);
      setTotal(res?.total ?? items.length);
    } catch {
      toast.error("Failed to load offers");
    } finally {
      setLoading(false);
    }
  }, [biz, page, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!biz) return;
    const p = { business: biz, limit: 200 };
    Promise.all([saleApi.listListings(p), saleApi.listBuyers(p), saleApi.listAgents(p)])
      .then(([l, b, a]) => {
        setListings(Array.isArray(l) ? l : (l?.listings ?? []));
        setBuyers(Array.isArray(b) ? b : (b?.buyers ?? []));
        setAgents(Array.isArray(a) ? a : (a?.agents ?? []));
      })
      .catch(() => {});
  }, [biz]);

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
      load();
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
      load();
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
      load();
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
      load();
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
      await saleApi.createDeal({ ...dealForm, business: biz, sourceOffer: showConvertDeal._id });
      toast.success("Deal created successfully! View it in the Deals section.");
      setShowConvertDeal(null);
      setDealForm(EMPTY_DEAL);
      load();
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
      load();
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
.hdr{border-bottom:3px solid #027333;padding-bottom:10px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-start}
.brand{font-size:22px;font-weight:900;color:#027333;letter-spacing:2px}
.brand img{height:52px;object-fit:contain}
.co-info{text-align:right;font-size:9.5px;color:#444;line-height:1.7}
.doc-title{text-align:center;margin:16px 0 18px}
.doc-title h1{font-size:18px;font-weight:900;letter-spacing:3px;color:#027333;text-transform:uppercase}
.doc-title p{font-size:10px;color:#555;margin-top:3px}
.ref-bar{display:flex;justify-content:space-between;background:#f8fafb;border:1px solid #e0e7ef;border-radius:6px;padding:10px 14px;margin-bottom:18px;font-size:10px}
.ref-bar span{font-weight:700;color:#027333}
.sec{font-size:9px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#027333;border-bottom:1.5px solid #027333;padding-bottom:4px;margin:16px 0 10px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 14px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}
.f label{font-size:8.5px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:2px}
.f span{font-size:11px;font-weight:600;color:#111;display:block;padding:5px 8px;border:1px solid #e5e7eb;border-radius:4px;background:#fafafa;min-height:26px}
.price-box{background:#027333;color:#fff;border-radius:8px;padding:14px 20px;margin:16px 0;display:flex;justify-content:space-between;align-items:center}
.price-box .lbl{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.8}
.price-box .amt{font-size:22px;font-weight:900;font-family:monospace}
.counter-box{background:#5b21b6;color:#fff;border-radius:8px;padding:10px 20px;margin:-8px 0 16px;display:flex;justify-content:space-between;align-items:center}
.notes{border:1px solid #e5e7eb;border-radius:6px;padding:10px;background:#fafafa;font-size:10.5px;line-height:1.6;min-height:40px}
.sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:32px}
.sig{border-top:1.5px solid #333;padding-top:6px}
.sig p{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#555;margin-top:2px}
.footer{margin-top:24px;padding-top:10px;border-top:1.5px solid #027333;font-size:8.5px;color:#777;text-align:center}
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

  const pending = offers.filter((o) => o.status === "pending").length;
  const countered = offers.filter((o) => o.status === "negotiating").length;
  const accepted = offers.filter((o) => o.status === "accepted").length;
  const totalPages = Math.ceil(total / LIMIT);

  return (
    <PropertySaleShell
      title="Offers"
      subtitle={`${total} offer(s)`}
      action={
        <button
          onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#027333] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0c5d2b]"
        >
          <FaPlus /> New Offer
        </button>
      }
    >
      <div className="flex h-full flex-col gap-2">
        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Total", value: loading ? "—" : total, cls: "bg-slate-900 text-white" },
            { label: "Pending", value: loading ? "—" : pending, cls: "bg-amber-50 border border-amber-200 text-amber-800" },
            { label: "Counter Active", value: loading ? "—" : countered, cls: "bg-violet-50 border border-violet-200 text-violet-800" },
            { label: "Accepted", value: loading ? "—" : accepted, cls: "bg-emerald-50 border border-emerald-200 text-emerald-800" },
          ].map((c) => (
            <div key={c.label} className={`rounded-lg px-3 py-2 ${c.cls}`}>
              <div className="text-[10px] font-black uppercase tracking-wider opacity-70">{c.label}</div>
              <div className="mt-0.5 text-sm font-black">{c.value}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search offer / listing / buyer..."
            className="h-8 min-w-[180px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs focus:border-[#027333] focus:outline-none focus:ring-1 focus:ring-[#027333]"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs focus:border-[#027333] focus:outline-none"
          >
            <option value="">All Statuses</option>
            {["pending", "negotiating", "accepted", "rejected", "expired", "withdrawn"].map((s) => (
              <option key={s} value={s}>{s === "negotiating" ? "Counter Active" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <button onClick={load} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-600 hover:bg-slate-100">
            Refresh
          </button>
        </div>

        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10 bg-[#027333] text-white">
                <tr>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Offer No.</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Property</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Buyer</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Agent</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Offer Amount</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Counter / Final</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Validity</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Status</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Loading offers...</td></tr>
                ) : offers.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No offers found.</td></tr>
                ) : offers.map((o, i) => {
                  const hasCounter = !!o.counterOfferAmount;
                  const isCounterActive = o.status === "negotiating" && hasCounter;
                  const isAccepted = o.status === "accepted";
                  const finalPrice = hasCounter ? o.counterOfferAmount : o.offerAmount;
                  const counterDelta = hasCounter
                    ? Math.round(((o.counterOfferAmount - o.offerAmount) / o.offerAmount) * 100)
                    : null;

                  return (
                    <tr key={o._id} className={`border-t border-slate-100 transition ${isCounterActive ? "bg-violet-50/40" : i % 2 === 0 ? "bg-white hover:bg-slate-50" : "bg-slate-50/60 hover:bg-slate-100/40"}`}>
                      <td className="px-3 py-2 font-black text-slate-900">{o.offerNumber}</td>
                      <td className="px-3 py-2 text-slate-700">{o.listing?.title || o.listing?.listingNumber || "—"}</td>
                      <td className="px-3 py-2 text-slate-700">{o.buyer?.fullName || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{o.agent?.fullName || <span className="italic text-slate-300">—</span>}</td>

                      {/* Offer Amount */}
                      <td className="px-3 py-2 text-right">
                        <div className="font-black text-slate-900">{fmtKES(o.offerAmount)}</div>
                        {o.listing?.askingPrice > 0 && (
                          <div className={`text-[10px] font-bold ${o.offerAmount < o.listing.askingPrice ? "text-rose-500" : o.offerAmount > o.listing.askingPrice ? "text-emerald-500" : "text-slate-400"}`}>
                            {o.offerAmount >= o.listing.askingPrice ? "+" : ""}
                            {Math.round(((o.offerAmount - o.listing.askingPrice) / o.listing.askingPrice) * 100)}% vs asking
                          </div>
                        )}
                      </td>

                      {/* Counter / Final Price */}
                      <td className="px-3 py-2 text-right">
                        {hasCounter ? (
                          <div>
                            <div className={`font-black ${isAccepted ? "text-emerald-700" : "text-violet-700"}`}>
                              {fmtKES(o.counterOfferAmount)}
                            </div>
                            <div className="mt-0.5 flex items-center justify-end gap-1">
                              {isCounterActive && (
                                <span className="inline-flex rounded-full border border-violet-300 bg-violet-100 px-1.5 py-0 text-[9px] font-black uppercase tracking-wider text-violet-700">
                                  counter
                                </span>
                              )}
                              {isAccepted && (
                                <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-0 text-[9px] font-black uppercase tracking-wider text-emerald-700">
                                  final
                                </span>
                              )}
                            </div>
                            {counterDelta !== null && (
                              <div className={`text-[10px] font-bold ${counterDelta > 0 ? "text-rose-500" : "text-emerald-500"}`}>
                                {counterDelta > 0 ? "+" : ""}{counterDelta}% vs offer
                              </div>
                            )}
                          </div>
                        ) : isAccepted ? (
                          <div>
                            <div className="font-black text-emerald-700">{fmtKES(o.offerAmount)}</div>
                            <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-0 text-[9px] font-black uppercase tracking-wider text-emerald-700">final</span>
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      <td className="px-3 py-2 text-slate-500">{o.validityDate ? new Date(o.validityDate).toLocaleDateString("en-KE") : "—"}</td>

                      {/* Status badge */}
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-black ${STATUS_BADGE[o.status] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                          {isCounterActive ? "Counter Active" : o.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          <button onClick={() => printOffer(o)} title="Print" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50">
                            <FaPrint />
                          </button>

                          {/* Counter active: Accept / Reject quick actions */}
                          {isCounterActive && (
                            <>
                              <button
                                onClick={() => handleAcceptCounter(o)}
                                disabled={saving}
                                title="Accept Counter Offer"
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                              >
                                <FaCheck /> Accept
                              </button>
                              <button
                                onClick={() => handleRejectCounter(o)}
                                disabled={saving}
                                title="Reject Counter Offer"
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-40"
                              >
                                <FaTimes /> Reject
                              </button>
                            </>
                          )}

                          {/* Accepted: Convert to Deal */}
                          {isAccepted && (
                            <button
                              onClick={() => handleOpenConvertDeal(o)}
                              title="Convert to Deal"
                              className="inline-flex items-center gap-1 rounded-lg border border-[#027333]/30 bg-[#027333]/10 px-2.5 py-1.5 text-[10px] font-bold text-[#027333] hover:bg-[#027333]/20"
                            >
                              <FaHandshake /> Deal
                            </button>
                          )}

                          {/* Edit status — available for pending and negotiating */}
                          {["pending", "negotiating"].includes(o.status) && (
                            <button
                              title={isCounterActive ? "Edit Counter / Change Status" : "Update Status"}
                              onClick={() => { setShowStatus(o); setStatusForm({ ...EMPTY_STATUS, counterOfferAmount: o.counterOfferAmount || "" }); }}
                              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                            >
                              <FaEdit />
                            </button>
                          )}

                          {/* Delete — only when terminal or not yet active */}
                          {["pending", "rejected", "expired", "withdrawn"].includes(o.status) && (
                            <button onClick={() => handleDelete(o)} title="Delete" className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100">
                              <FaTimes />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-2 text-xs text-slate-500">
            <span>{total} offer(s)</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-slate-200 px-3 py-1 font-semibold disabled:opacity-40">Prev</button>
              <span>Page {page} of {Math.max(1, totalPages)}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-lg border border-slate-200 px-3 py-1 font-semibold disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      </div>

      {/* Create Offer Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
          <form onSubmit={handleCreate} className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-[#027333] px-5 py-4 text-white">
              <div>
                <div className="text-sm font-black tracking-wide">Record New Offer</div>
                <div className="text-[10px] opacity-75">Formal purchase offer against a listing</div>
              </div>
              <button type="button" onClick={() => setShowCreate(false)}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10">Close</button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Listing *</label>
                <select value={form.listing} onChange={(e) => setForm((f) => ({ ...f, listing: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#027333]" required>
                  <option value="">Select listing</option>
                  {listings.filter((l) => ["available", "reserved"].includes(l.status)).map((l) => (
                    <option key={l._id} value={l._id}>{l.listingNumber} — {l.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Buyer *</label>
                <select value={form.buyer} onChange={(e) => setForm((f) => ({ ...f, buyer: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#027333]" required>
                  <option value="">Select buyer</option>
                  {buyers.map((b) => <option key={b._id} value={b._id}>{b.buyerNumber} — {b.fullName}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Sales Agent</label>
                <select value={form.agent} onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#027333]">
                  <option value="">Unassigned</option>
                  {agents.filter((a) => a.status === "active").map((a) => (
                    <option key={a._id} value={a._id}>{a.agentNumber} — {a.fullName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Offer Amount (KES) *</label>
                <AmountInput
                  value={form.offerAmount}
                  onChange={(v) => setForm((f) => ({ ...f, offerAmount: v }))}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#027333]"
                  placeholder="e.g. 5,000,000"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Validity Date</label>
                <input type="date" value={form.validityDate}
                  onChange={(e) => setForm((f) => ({ ...f, validityDate: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#027333]" />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Notes</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#027333]" />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4">
              <button type="button" onClick={() => setShowCreate(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving}
                className="rounded-lg bg-[#027333] px-5 py-2 text-xs font-bold text-white hover:bg-[#0c5d2b] disabled:opacity-50">
                {saving ? "Saving..." : "Record Offer"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Status Update Modal */}
      {showStatus && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
          <form onSubmit={handleStatusUpdate} className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-slate-800 px-5 py-4 text-white">
              <div>
                <div className="text-sm font-black tracking-wide">Update Offer Status</div>
                <div className="text-[10px] opacity-75">{showStatus.offerNumber} — {showStatus.listing?.title || ""}</div>
              </div>
              <button type="button" onClick={() => setShowStatus(null)}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10">Close</button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-5">
              {/* Price context */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Buyer's Offer</div>
                  <div className="font-black text-slate-900">{fmtKES(showStatus.offerAmount)}</div>
                </div>
                {showStatus.counterOfferAmount ? (
                  <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs">
                    <div className="text-[10px] font-black uppercase tracking-wider text-violet-500">Current Counter</div>
                    <div className="font-black text-violet-800">{fmtKES(showStatus.counterOfferAmount)}</div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Asking Price</div>
                    <div className="font-black text-slate-900">{fmtKES(showStatus.listing?.askingPrice)}</div>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">New Status *</label>
                <select value={statusForm.status} onChange={(e) => setStatusForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#027333]" required>
                  <option value="">Select status</option>
                  <option value="negotiating">Send Counter Offer</option>
                  <option value="accepted">Accept Offer / Counter</option>
                  <option value="rejected">Reject</option>
                  <option value="expired">Mark as Expired</option>
                  <option value="withdrawn">Withdrawn by Buyer</option>
                </select>
              </div>

              {statusForm.status === "negotiating" && (
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Counter-Offer Amount (KES) *
                  </label>
                  <AmountInput
                    value={statusForm.counterOfferAmount}
                    onChange={(v) => setStatusForm((f) => ({ ...f, counterOfferAmount: v }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#027333]"
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
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] text-emerald-800">
                  <span className="font-black">Accepted price: </span>
                  <span className="font-bold">
                    {fmtKES(showStatus.counterOfferAmount || showStatus.offerAmount)}
                  </span>
                  {showStatus.counterOfferAmount && (
                    <span className="ml-1 opacity-70">(counter offer)</span>
                  )}
                  <div className="mt-1 opacity-80">After accepting, use the <strong>Deal</strong> button to convert this offer into a transaction.</div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Notes</label>
                <textarea rows={2} value={statusForm.negotiationNotes}
                  onChange={(e) => setStatusForm((f) => ({ ...f, negotiationNotes: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#027333]" />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4">
              <button type="button" onClick={() => setShowStatus(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving}
                className="rounded-lg bg-[#027333] px-5 py-2 text-xs font-bold text-white hover:bg-[#0c5d2b] disabled:opacity-50">
                {saving ? "Saving..." : "Update Status"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Convert to Deal Modal */}
      {showConvertDeal && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
          <form onSubmit={handleConvertDeal} className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-[#027333] px-5 py-4 text-white">
              <div>
                <div className="text-sm font-black tracking-wide">Convert Offer to Deal</div>
                <div className="text-[10px] opacity-75">{showConvertDeal.offerNumber} — {showConvertDeal.buyer?.fullName || ""}</div>
              </div>
              <button type="button" onClick={() => setShowConvertDeal(null)}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10">Close</button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-5 md:grid-cols-2">
              {/* Price summary */}
              <div className="md:col-span-2">
                <div className="grid grid-cols-3 gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
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
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Final Agreed Price (KES) *</label>
                <AmountInput
                  value={dealForm.agreedPrice}
                  onChange={(v) => setDealForm((f) => ({ ...f, agreedPrice: v }))}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black outline-none focus:border-[#027333]"
                  placeholder="Confirmed sale price"
                  required
                />
                <div className="mt-1 text-[10px] text-slate-400">Pre-filled from accepted price. Adjust if a final verbal agreement was reached.</div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Deal Date *</label>
                <input type="date" value={dealForm.dealDate}
                  onChange={(e) => setDealForm((f) => ({ ...f, dealDate: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#027333]" required />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Assign Agent</label>
                <select value={dealForm.agent} onChange={(e) => setDealForm((f) => ({ ...f, agent: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#027333]">
                  <option value="">Unassigned</option>
                  {agents.filter((a) => a.status === "active").map((a) => (
                    <option key={a._id} value={a._id}>{a.agentNumber} — {a.fullName}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Deal Notes</label>
                <textarea rows={2} value={dealForm.notes}
                  onChange={(e) => setDealForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#027333]" />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4">
              <button type="button" onClick={() => setShowConvertDeal(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={converting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#027333] px-5 py-2 text-xs font-bold text-white hover:bg-[#0c5d2b] disabled:opacity-50">
                <FaHandshake /> {converting ? "Creating Deal..." : "Create Deal"}
              </button>
            </div>
          </form>
        </div>
      )}
    </PropertySaleShell>
  );
};

export default SaleOffers;

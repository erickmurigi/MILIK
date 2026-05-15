import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { FaBan, FaCheck, FaEdit, FaHandshake, FaPlus, FaPrint, FaSearch, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import { saleApi, fmtKES, todayISO } from "../../services/propertySaleApi";
import AmountInput from "./AmountInput";
import { useConfirm } from "../../context/ConfirmContext";

const ITEMS_PER_PAGE = 50;

const statusColors = {
  active: "bg-blue-100 border-blue-200 text-blue-700",
  closed: "bg-emerald-100 border-emerald-200 text-emerald-700",
  cancelled: "bg-rose-100 border-rose-200 text-rose-700",
};

const blankForm = {
  listing: "", buyer: "", agent: "", agreedPrice: "",
  dealDate: todayISO(), expectedClosingDate: "", notes: "",
};

const SaleDeals = () => {
  const confirm = useConfirm();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const [deals, setDeals] = useState([]);
  const [listings, setListings] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionKey, setActionKey] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancellingDeal, setCancellingDeal] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [closingDeal, setClosingDeal] = useState(null);
  const [closeForm, setCloseForm] = useState({ actualClosingDate: todayISO(), titleTransferDate: "", handoverNotes: "" });
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(blankForm);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const biz = currentCompany?._id;

  const load = async () => {
    if (!biz) return;
    setLoading(true);
    try {
      const [rows, listingRows, buyerRows, agentRows] = await Promise.all([
        saleApi.listDeals({ business: biz, status: statusFilter }),
        saleApi.listListings({ business: biz }),
        saleApi.listBuyers({ business: biz }),
        saleApi.listAgents({ business: biz, status: "active" }),
      ]);
      setDeals(Array.isArray(rows) ? rows : []);
      setListings(Array.isArray(listingRows) ? listingRows : []);
      setBuyers(Array.isArray(buyerRows) ? buyerRows : []);
      setAgents(Array.isArray(agentRows) ? agentRows : []);
    } catch { toast.error("Failed to load deals"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [biz, statusFilter]);
  useEffect(() => setPage(1), [statusFilter, search]);

  const filtered = useMemo(() => {
    if (!search.trim()) return deals;
    const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    return deals.filter((d) => rx.test(d.dealNumber) || rx.test(d.listing?.title) || rx.test(d.buyer?.fullName));
  }, [deals, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  const stats = useMemo(() => ({
    active: deals.filter((d) => d.status === "active").length,
    closed: deals.filter((d) => d.status === "closed").length,
    activeValue: deals.filter((d) => d.status === "active").reduce((a, d) => a + d.agreedPrice, 0),
    closedValue: deals.filter((d) => d.status === "closed").reduce((a, d) => a + d.agreedPrice, 0),
  }), [deals]);

  const openCreate = () => { setEditingId(""); setForm(blankForm); setShowModal(true); };
  const openEdit = (row) => {
    setEditingId(row._id);
    setForm({
      listing: row.listing?._id || row.listing || "",
      buyer: row.buyer?._id || row.buyer || "",
      agent: row.agent?._id || row.agent || "",
      agreedPrice: row.agreedPrice || "",
      dealDate: row.dealDate ? new Date(row.dealDate).toISOString().split("T")[0] : todayISO(),
      expectedClosingDate: row.expectedClosingDate ? new Date(row.expectedClosingDate).toISOString().split("T")[0] : "",
      notes: row.notes || "",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.listing) return toast.warning("Select a listing");
    if (!form.buyer) return toast.warning("Select a buyer");
    if (!form.agreedPrice || Number(form.agreedPrice) <= 0) return toast.warning("Valid agreed price required");
    setSaving(true);
    try {
      const payload = { ...form, business: biz, agreedPrice: Number(form.agreedPrice), agent: form.agent || undefined, expectedClosingDate: form.expectedClosingDate || undefined };
      const saved = editingId ? await saleApi.updateDeal(editingId, payload) : await saleApi.createDeal(payload);
      setDeals((prev) => editingId ? prev.map((r) => r._id === editingId ? saved : r) : [saved, ...prev]);
      setShowModal(false);
      toast.success(`Deal ${editingId ? "updated" : "created"} successfully`);
    } catch (err) { toast.error(err?.response?.data?.message || "Failed to save deal"); }
    finally { setSaving(false); }
  };

  const handleClose = async () => {
    if (!closingDeal) return;
    setActionKey(`${closingDeal._id}:close`);
    try {
      const updated = await saleApi.closeDeal(closingDeal._id, { ...closeForm, business: biz });
      setDeals((prev) => prev.map((d) => d._id === closingDeal._id ? { ...d, ...updated } : d));
      setShowCloseModal(false);
      setClosingDeal(null);
      toast.success("Deal closed successfully");
    } catch (err) { toast.error(err?.response?.data?.message || "Failed to close deal"); }
    finally { setActionKey(""); }
  };

  const openCancelModal = (row) => {
    setCancellingDeal(row);
    setCancelReason("");
    setShowCancelModal(true);
  };

  const handleCancel = async () => {
    if (!cancellingDeal) return;
    setActionKey(`${cancellingDeal._id}:cancel`);
    try {
      const updated = await saleApi.cancelDeal(cancellingDeal._id, { cancellationReason: cancelReason, business: biz });
      setDeals((prev) => prev.map((d) => d._id === cancellingDeal._id ? { ...d, ...updated } : d));
      setShowCancelModal(false);
      setCancellingDeal(null);
      toast.success("Deal cancelled");
    } catch (err) { toast.error(err?.response?.data?.message || "Failed to cancel deal"); }
    finally { setActionKey(""); }
  };

  const handleDelete = async (row) => {
    if (!await confirm({
      title: "Delete Deal",
      message: `Permanently delete deal ${row.dealNumber}? All associated pending payments and commissions will also be removed. This cannot be undone.`,
      confirmText: "Delete",
      isDangerous: true,
    })) return;
    setActionKey(`${row._id}:delete`);
    try {
      await saleApi.deleteDeal(row._id);
      setDeals((prev) => prev.filter((d) => d._id !== row._id));
      toast.success("Deal deleted");
    } catch (err) { toast.error(err?.response?.data?.message || "Failed to delete deal"); }
    finally { setActionKey(""); }
  };

  const printDeal = (row) => {
    const co = currentCompany || {};
    const coName = co.companyName || co.name || "MILIK";
    const esc = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"}) : "—";
    const logoHtml = co.logo ? `<img src="${co.logo}" alt="logo" style="width:72px;height:72px;object-fit:contain;border-radius:10px;border:1px solid #cbd5e1;" />` : `<div style="width:72px;height:72px;background:#027333;color:#fff;font-size:26px;font-weight:900;display:flex;align-items:center;justify-content:center;border-radius:10px;">${coName.slice(0,1)}</div>`;
    const coInfo = [co.phone||co.phoneNumber, co.email||co.companyEmail].filter(Boolean).join(" • ");
    const statusC = {active:"#1e40af",closed:"#166534",cancelled:"#9f1239"}[row.status]||"#334155";
    const statusBg = {active:"#dbeafe",closed:"#dcfce7",cancelled:"#ffe4e6"}[row.status]||"#f1f5f9";
    const balance = row.agreedPrice - (row.totalPaid || 0);
    const printedOn = new Date().toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"});
    const field = (label, value) => `<div class="field"><div class="fl">${esc(label)}</div><div class="fv">${esc(value||"—")}</div></div>`;

    const win = window.open("","_blank","width=900,height=760");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Sale Agreement — ${esc(row.dealNumber)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:28px 32px;font-size:12px}
.hdr{display:grid;grid-template-columns:80px 1fr 170px;align-items:start;border-bottom:3px solid #027333;padding-bottom:14px;margin-bottom:18px;gap:12px}
.co-name{font-size:18px;font-weight:900;color:#027333}
.co-sub{font-size:9px;color:#64748b;line-height:1.5}
.doc-type{font-size:13px;font-weight:900;color:#027333;text-transform:uppercase;letter-spacing:.05em;text-align:right}
.doc-no{font-family:monospace;font-size:15px;font-weight:700;text-align:right;margin-top:3px}
.badge{display:inline-block;padding:3px 12px;border-radius:999px;font-size:10px;font-weight:800;float:right;margin-top:6px;background:${statusBg};color:${statusC}}
.price-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px}
.price-box{border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 14px}
.price-box.main{border-color:#027333;background:#f0faf5}
.pl{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:3px}
.pv{font-size:18px;font-weight:900;color:#0f172a;font-family:monospace}
.pv.green{color:#027333}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:14px}
.field{background:#fff;padding:9px 12px}
.fl{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:2px}
.fv{font-size:11px;font-weight:600;color:#1e293b}
.sig-section{border-top:2px solid #027333;padding-top:18px;margin-top:24px}
.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px}
.sig-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#027333;margin-bottom:14px}
.sig-line{border-bottom:1.5px solid #94a3b8;height:28px;margin-bottom:4px}
.sig-sub{font-size:9px;color:#94a3b8;margin-bottom:10px}
.notice{font-size:9px;color:#94a3b8;text-align:center;margin-top:18px;border-top:1px solid #f1f5f9;padding-top:10px;line-height:1.6}
@media print{body{padding:14px 16px}@page{size:A4 portrait;margin:10mm}}
</style></head><body>
<div class="hdr">
  <div>${logoHtml}</div>
  <div><div class="co-name">${esc(coName)}</div>${coInfo?`<div class="co-sub">${esc(coInfo)}</div>`:""}<div style="margin-top:4px;font-size:11px;font-weight:700;color:#334155">Property Sale Transaction</div></div>
  <div>
    <div class="doc-type">Sale Agreement</div>
    <div class="doc-no">${esc(row.dealNumber)}</div>
    <div class="badge">${esc(String(row.status||"").toUpperCase())}</div>
  </div>
</div>

<div class="price-row">
  <div class="price-box main"><div class="pl">Agreed Sale Price</div><div class="pv green">${esc(fmtKES(row.agreedPrice))}</div></div>
  <div class="price-box"><div class="pl">Amount Paid</div><div class="pv">${esc(fmtKES(row.totalPaid||0))}</div></div>
  <div class="price-box${balance > 0?' ':''}"><div class="pl">Outstanding Balance</div><div class="pv${balance > 0?' pv':''}${balance > 0?' ':'green'}">${esc(fmtKES(balance))}</div></div>
</div>

<div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#027333;margin:14px 0 6px">Transaction Details</div>
<div class="grid">
  ${field("Deal No.", row.dealNumber)}
  ${field("Deal Date", fmtD(row.dealDate))}
  ${field("Expected Closing", fmtD(row.expectedClosingDate))}
  ${field("Actual Closing", fmtD(row.actualClosingDate))}
  ${field("Title Transfer", fmtD(row.titleTransferDate))}
</div>

<div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#027333;margin:14px 0 6px">Property</div>
<div class="grid">
  ${field("Listing No.", row.listing?.listingNumber)}
  ${field("Property Title", row.listing?.title)}
  ${field("Property Type", row.listing?.propertyType)}
  ${field("Location", row.listing?.location||row.listing?.town)}
</div>

<div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#027333;margin:14px 0 6px">Parties</div>
<div class="grid">
  ${field("Buyer", row.buyer?.fullName)}
  ${field("Buyer Code", row.buyer?.buyerNumber)}
  ${field("Buyer Phone", row.buyer?.phone)}
  ${field("Sales Agent", row.agent?.fullName||"N/A")}
  ${field("Agent Code", row.agent?.agentNumber||"N/A")}
</div>

${row.notes?`<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-size:11px;color:#334155;line-height:1.6;margin-bottom:14px"><div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:4px">Notes / Handover</div>${esc(row.notes||row.handoverNotes||"")}</div>`:""}

<div class="sig-section">
  <div class="sig-grid">
    <div><div class="sig-title">Buyer</div><div class="sig-line"></div><div class="sig-sub">Signature &amp; Date</div><div class="sig-line"></div><div class="sig-sub">Full Name</div></div>
    <div><div class="sig-title">Sales Agent</div><div class="sig-line"></div><div class="sig-sub">Signature &amp; Date</div><div class="sig-line"></div><div class="sig-sub">Full Name</div></div>
    <div><div class="sig-title">Authorized Officer</div><div class="sig-line"></div><div class="sig-sub">Signature &amp; Date</div><div class="sig-line"></div><div class="sig-sub">Name &amp; Stamp</div></div>
  </div>
</div>

<div class="notice">Official sale agreement record issued by ${esc(coName)} • Printed: ${esc(printedOn)} • This document does not substitute a formal legal sale agreement</div>
</body></html>`);
    win.document.close();
    setTimeout(()=>{win.focus();win.print();},400);
  };

  const inputCls = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none focus:ring-2 focus:ring-[#027333]/20";

  return (
    <PropertySaleShell
      title="Deals & Transactions"
      subtitle={`${deals.length} deal(s)`}
      action={<button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-[#027333] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0c5d2b]"><FaPlus /> New Deal</button>}
    >
      <div className="flex h-full flex-col gap-2">
        {/* KPI */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Active Deals", value: stats.active, sub: fmtKES(stats.activeValue), cls: "bg-blue-600 text-white" },
            { label: "Closed Deals", value: stats.closed, sub: fmtKES(stats.closedValue), cls: "bg-[#027333] text-white" },
            { label: "Total Listed", value: deals.length, cls: "bg-slate-900 text-white" },
            { label: "Total Deal Value", value: fmtKES(deals.reduce((a, d) => a + d.agreedPrice, 0)), cls: "bg-emerald-50 border border-emerald-200 text-emerald-900" },
          ].map((c) => (
            <div key={c.label} className={`rounded-lg px-3 py-2 ${c.cls}`}>
              <div className="text-[10px] font-black uppercase tracking-wider opacity-70">{c.label}</div>
              <div className="mt-0.5 text-sm font-black">{c.value}</div>
              {c.sub && <div className="text-[10px] opacity-60">{c.sub}</div>}
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="relative flex-1 min-w-[180px]">
            <FaSearch className="absolute left-3 top-2.5 text-[10px] text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deals..." className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs focus:border-[#027333] focus:outline-none" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs focus:border-[#027333] focus:outline-none">
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10 bg-[#027333] text-white">
                <tr>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Deal No.</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Property</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Buyer</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Agent</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Agreed Price</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Paid</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Balance</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Status</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Loading deals...</td></tr>
                : pageRows.length === 0 ? <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No deals found.</td></tr>
                : pageRows.map((row, i) => {
                  const balance = row.agreedPrice - (row.totalPaid || 0);
                  const pct = row.agreedPrice > 0
                    ? Math.min(100, Math.round(((row.totalPaid || 0) / row.agreedPrice) * 100))
                    : 0;
                  return (
                    <tr key={row._id} className={`border-t border-slate-100 transition ${i % 2 === 0 ? "bg-white hover:bg-slate-50" : "bg-slate-50/60 hover:bg-slate-100/40"}`}>
                      <td className="px-3 py-2 font-black text-slate-900">{row.dealNumber}</td>
                      <td className="px-3 py-2">
                        <div className="max-w-[140px] truncate font-bold text-slate-900">{row.listing?.title || "—"}</div>
                        <div className="text-[11px] text-slate-400">{row.listing?.listingNumber}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-bold text-slate-900">{row.buyer?.fullName || "—"}</div>
                        <div className="text-[11px] text-slate-400">{row.buyer?.buyerNumber}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.agent?.fullName || <span className="italic text-slate-400">None</span>}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="font-black text-slate-900">{fmtKES(row.agreedPrice)}</div>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100" title={`${pct}% paid`}>
                          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-emerald-700">{fmtKES(row.totalPaid || 0)}</td>
                      <td className={`px-3 py-2 text-right font-black ${balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>{fmtKES(balance)}</td>
                      <td className="px-3 py-2"><span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-black ${statusColors[row.status] || ""}`}>{row.status}</span></td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          <button onClick={() => printDeal(row)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-600"><FaPrint /></button>
                          {row.status === "active" && <button onClick={() => openEdit(row)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-700"><FaEdit /></button>}
                          {row.status === "active" && (
                            <button onClick={() => { setClosingDeal(row); setCloseForm({ actualClosingDate: todayISO(), titleTransferDate: "", handoverNotes: "" }); setShowCloseModal(true); }} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700">
                              <FaCheck /> Close
                            </button>
                          )}
                          {row.status === "active" && (
                            <button onClick={() => openCancelModal(row)} disabled={actionKey === `${row._id}:cancel`} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700 disabled:opacity-50">
                              <FaBan /> Cancel
                            </button>
                          )}
                          {row.status === "cancelled" && (
                            <button onClick={() => handleDelete(row)} disabled={actionKey === `${row._id}:delete`} title="Delete cancelled deal" className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700 disabled:opacity-50">
                              <FaTimes /> Delete
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
          <div className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-2 text-xs text-slate-500">
            <span>Showing <strong className="text-slate-900">{filtered.length === 0 ? 0 : (safePage - 1) * ITEMS_PER_PAGE + 1}</strong>–<strong className="text-slate-900">{Math.min(safePage * ITEMS_PER_PAGE, filtered.length)}</strong> of <strong className="text-slate-900">{filtered.length}</strong></span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="rounded-lg border border-slate-200 px-3 py-1 font-semibold disabled:opacity-40">Prev</button>
              <span>Page {safePage} of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="rounded-lg border border-slate-200 px-3 py-1 font-semibold disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      </div>

      {/* New Deal Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
          <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-[#027333] px-6 py-4 text-white">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100">Property Sale</p>
                <h3 className="text-lg font-black">{editingId ? "Edit Deal" : "New Sale Deal"}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-6 md:grid-cols-2">
              <label className="block"><span className="text-xs font-bold text-slate-700">Listing / Property</span>
                <select value={form.listing} onChange={(e) => setForm((p) => ({ ...p, listing: e.target.value }))} className={`mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none focus:ring-2 focus:ring-[#027333]/20`}>
                  <option value="">Select listing...</option>
                  {listings.filter((l) => ["available","reserved","under_contract"].includes(l.status)).map((l) => <option key={l._id} value={l._id}>{l.listingNumber} — {l.title}</option>)}
                </select>
              </label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Buyer</span>
                <select value={form.buyer} onChange={(e) => setForm((p) => ({ ...p, buyer: e.target.value }))} className={`mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none focus:ring-2 focus:ring-[#027333]/20`}>
                  <option value="">Select buyer...</option>
                  {buyers.map((b) => <option key={b._id} value={b._id}>{b.fullName} ({b.buyerNumber})</option>)}
                </select>
              </label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Sales Agent (Optional)</span>
                <select value={form.agent} onChange={(e) => setForm((p) => ({ ...p, agent: e.target.value }))} className={`mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none focus:ring-2 focus:ring-[#027333]/20`}>
                  <option value="">No agent</option>
                  {agents.map((a) => <option key={a._id} value={a._id}>{a.fullName} ({a.agentNumber})</option>)}
                </select>
              </label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Agreed Price (KES)</span>
                <AmountInput value={form.agreedPrice} onChange={(v) => setForm((p) => ({ ...p, agreedPrice: v }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" placeholder="e.g. 8,500,000" required />
              </label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Deal Date</span><input type="date" value={form.dealDate} onChange={(e) => setForm((p) => ({ ...p, dealDate: e.target.value }))} className={`mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none`} /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Expected Closing Date</span><input type="date" value={form.expectedClosingDate} onChange={(e) => setForm((p) => ({ ...p, expectedClosingDate: e.target.value }))} className={`mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none`} /></label>
              <label className="block md:col-span-2"><span className="text-xs font-bold text-slate-700">Notes</span><textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={`mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none`} /></label>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
              <button onClick={() => setShowModal(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#027333] px-4 py-2 text-sm font-black text-white disabled:opacity-60">{saving ? "Saving..." : editingId ? "Update Deal" : "Create Deal"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Deal Modal */}
      {showCancelModal && cancellingDeal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between rounded-t-2xl bg-rose-600 px-5 py-4 text-white">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-100">Cancel Deal</p>
                <h3 className="text-lg font-black">{cancellingDeal.dealNumber}</h3>
              </div>
              <button onClick={() => setShowCancelModal(false)} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="space-y-3 p-5">
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
                Cancelling will revert the listing to <strong>Available</strong> and cancel any pending commissions.
              </div>
              <label className="block">
                <span className="text-xs font-bold text-slate-700">Reason for Cancellation</span>
                <textarea
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Optional — e.g. buyer withdrew, financing fell through..."
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button onClick={() => setShowCancelModal(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700">Back</button>
              <button onClick={handleCancel} disabled={!!actionKey} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-black text-white hover:bg-rose-700 disabled:opacity-60">
                <FaBan /> {actionKey ? "Cancelling..." : "Cancel Deal"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Deal Modal */}
      {showCloseModal && closingDeal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#027333] px-5 py-4 text-white rounded-t-2xl">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100">Close Deal</p>
                <h3 className="text-lg font-black">{closingDeal.dealNumber}</h3>
              </div>
              <button onClick={() => setShowCloseModal(false)} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="space-y-3 p-5">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-xs font-bold text-emerald-800">Balance: <span className="text-sm font-black">{fmtKES(closingDeal.agreedPrice - (closingDeal.totalPaid || 0))}</span></p>
                <p className="mt-1 text-[11px] text-emerald-700">Closing requires full payment to be cleared.</p>
              </div>
              <label className="block"><span className="text-xs font-bold text-slate-700">Actual Closing Date</span><input type="date" value={closeForm.actualClosingDate} onChange={(e) => setCloseForm((p) => ({ ...p, actualClosingDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Title Transfer Date</span><input type="date" value={closeForm.titleTransferDate} onChange={(e) => setCloseForm((p) => ({ ...p, titleTransferDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Handover Notes</span><textarea rows={3} value={closeForm.handoverNotes} onChange={(e) => setCloseForm((p) => ({ ...p, handoverNotes: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none" /></label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button onClick={() => setShowCloseModal(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700">Cancel</button>
              <button onClick={handleClose} disabled={!!actionKey} className="inline-flex items-center gap-2 rounded-xl bg-[#027333] px-4 py-2 text-sm font-black text-white disabled:opacity-60"><FaCheck /> {actionKey ? "Closing..." : "Confirm Close"}</button>
            </div>
          </div>
        </div>
      )}
    </PropertySaleShell>
  );
};

export default SaleDeals;

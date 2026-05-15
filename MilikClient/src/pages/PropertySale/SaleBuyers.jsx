import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { FaCheck, FaEdit, FaPlus, FaPrint, FaSearch, FaSquare, FaTimes, FaTrash, FaUsers } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";

const SOURCES = ["walk_in", "referral", "online", "agent", "other"];
const KYC_STATUSES = ["pending", "verified", "rejected"];
const ITEMS_PER_PAGE = 50;

const kycColors = {
  pending: "bg-amber-50 border-amber-200 text-amber-700",
  verified: "bg-emerald-50 border-emerald-200 text-emerald-700",
  rejected: "bg-rose-50 border-rose-200 text-rose-700",
};

const blankForm = {
  fullName: "", idNumber: "", phone: "", email: "",
  address: "", nationality: "Kenyan", source: "walk_in", kycStatus: "pending", notes: "",
};

const SaleBuyers = () => {
  const confirm = useConfirm();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const [buyers, setBuyers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(blankForm);
  const [search, setSearch] = useState("");
  const [kycFilter, setKycFilter] = useState("");
  const [page, setPage] = useState(1);

  const biz = currentCompany?._id;

  const load = async () => {
    if (!biz) return;
    setLoading(true);
    try {
      const rows = await saleApi.listBuyers({ business: biz, search, kycStatus: kycFilter });
      setBuyers(Array.isArray(rows) ? rows : []);
    } catch { toast.error("Failed to load buyers"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [biz, search, kycFilter]);

  const totalPages = Math.max(1, Math.ceil(buyers.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = buyers.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  useEffect(() => setPage(1), [search, kycFilter]);

  const openCreate = () => { setEditingId(""); setForm(blankForm); setShowModal(true); };
  const openEdit = (row) => {
    setEditingId(row._id);
    setForm({ fullName: row.fullName || "", idNumber: row.idNumber || "", phone: row.phone || "", email: row.email || "", address: row.address || "", nationality: row.nationality || "Kenyan", source: row.source || "walk_in", kycStatus: row.kycStatus || "pending", notes: row.notes || "" });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.fullName.trim()) return toast.warning("Full name is required");
    setSaving(true);
    try {
      const payload = { ...form, business: biz };
      const saved = editingId ? await saleApi.updateBuyer(editingId, payload) : await saleApi.createBuyer(payload);
      setBuyers((prev) => editingId ? prev.map((r) => r._id === editingId ? saved : r) : [saved, ...prev]);
      setShowModal(false);
      toast.success(`Buyer ${editingId ? "updated" : "registered"} successfully`);
    } catch (err) { toast.error(err?.response?.data?.message || "Failed to save buyer"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (row) => {
    if (!await confirm({ title: "Remove Buyer", message: `Remove "${row.fullName}" from the system?`, confirmText: "Remove", isDangerous: true })) return;
    try {
      await saleApi.deleteBuyer(row._id);
      setBuyers((prev) => prev.filter((r) => r._id !== row._id));
      toast.success("Buyer removed");
    } catch (err) { toast.error(err?.response?.data?.message || "Cannot delete this buyer"); }
  };

  const printBuyer = (row) => {
    const co = currentCompany || {};
    const coName = co.companyName || co.name || "MILIK";
    const esc = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const logoHtml = co.logo ? `<img src="${co.logo}" alt="logo" style="width:72px;height:72px;object-fit:contain;border-radius:10px;border:1px solid #cbd5e1;" />` : `<div style="width:72px;height:72px;background:#027333;color:#fff;font-size:26px;font-weight:900;display:flex;align-items:center;justify-content:center;border-radius:10px;">${coName.slice(0,1)}</div>`;
    const coInfo = [co.phone||co.phoneNumber, co.email||co.companyEmail].filter(Boolean).join(" • ");
    const kycC = { pending:"#92400e",verified:"#166534",rejected:"#9f1239" }[row.kycStatus]||"#334155";
    const kycBg = { pending:"#fef3c7",verified:"#dcfce7",rejected:"#ffe4e6" }[row.kycStatus]||"#f1f5f9";
    const printedOn = new Date().toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"});
    const field = (label, value) => `<div class="field"><div class="fl">${esc(label)}</div><div class="fv">${esc(value||"—")}</div></div>`;

    const win = window.open("","_blank","width=900,height=720");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Buyer Profile — ${esc(row.buyerNumber)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:28px 32px;font-size:12px}
.hdr{display:grid;grid-template-columns:80px 1fr 170px;align-items:start;border-bottom:3px solid #027333;padding-bottom:14px;margin-bottom:18px;gap:12px}
.co-name{font-size:18px;font-weight:900;color:#027333}
.co-sub{font-size:9px;color:#64748b;line-height:1.5}
.doc-type{font-size:13px;font-weight:900;color:#027333;text-transform:uppercase;letter-spacing:.05em;text-align:right}
.doc-no{font-family:monospace;font-size:15px;font-weight:700;text-align:right;margin-top:3px}
.badge{display:inline-block;padding:3px 12px;border-radius:999px;font-size:10px;font-weight:800;float:right;margin-top:6px;background:${kycBg};color:${kycC}}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:14px}
.field{background:#fff;padding:9px 12px}
.fl{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:2px}
.fv{font-size:11px;font-weight:600;color:#1e293b}
.notice{font-size:9px;color:#94a3b8;text-align:center;margin-top:20px;border-top:1px solid #f1f5f9;padding-top:10px}
@media print{body{padding:14px 16px}@page{size:A4 portrait;margin:10mm}}
</style></head><body>
<div class="hdr">
  <div>${logoHtml}</div>
  <div><div class="co-name">${esc(coName)}</div>${coInfo?`<div class="co-sub">${esc(coInfo)}</div>`:""}</div>
  <div>
    <div class="doc-type">Buyer Profile</div>
    <div class="doc-no">${esc(row.buyerNumber)}</div>
    <div class="badge">KYC: ${esc(String(row.kycStatus||"").toUpperCase())}</div>
  </div>
</div>
<div class="grid">
  ${field("Buyer No.",row.buyerNumber)}
  ${field("Full Name",row.fullName)}
  ${field("ID / Passport",row.idNumber)}
  ${field("Phone",row.phone)}
  ${field("Email",row.email)}
  ${field("Nationality",row.nationality)}
  ${field("Source",String(row.source||"").replace(/_/g," "))}
  ${field("KYC Status",row.kycStatus)}
  ${field("Address",row.address)}
</div>
${row.notes?`<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-size:11px;color:#334155;line-height:1.6"><div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:4px">Notes</div>${esc(row.notes)}</div>`:""}
<div class="notice">Buyer profile issued by ${esc(coName)} • Printed: ${esc(printedOn)}</div>
</body></html>`);
    win.document.close();
    setTimeout(()=>{win.focus();win.print();},400);
  };

  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));
  const inputCls = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none focus:ring-2 focus:ring-[#027333]/20";

  return (
    <PropertySaleShell
      title="Buyers / Clients"
      subtitle={`${buyers.length} registered`}
      action={<button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-[#027333] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0c5d2b]"><FaPlus /> New Buyer</button>}
    >
      <div className="flex h-full flex-col gap-2">
        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Total Buyers", value: buyers.length, cls: "bg-slate-900 text-white" },
            { label: "Verified KYC", value: buyers.filter((b) => b.kycStatus === "verified").length, cls: "bg-emerald-50 border border-emerald-200 text-emerald-900" },
            { label: "Pending KYC", value: buyers.filter((b) => b.kycStatus === "pending").length, cls: "bg-amber-50 border border-amber-200 text-amber-900" },
            { label: "KYC Rejected", value: buyers.filter((b) => b.kycStatus === "rejected").length, cls: "bg-rose-50 border border-rose-200 text-rose-900" },
          ].map((c) => (
            <div key={c.label} className={`rounded-lg px-3 py-2 ${c.cls}`}>
              <div className="text-[10px] font-black uppercase tracking-wider opacity-70">{c.label}</div>
              <div className="mt-0.5 text-sm font-black">{c.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="relative flex-1 min-w-[180px]">
            <FaSearch className="absolute left-3 top-2.5 text-[10px] text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search buyers by name, phone, ID..." className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs focus:border-[#027333] focus:outline-none" />
          </div>
          <select value={kycFilter} onChange={(e) => setKycFilter(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs focus:border-[#027333] focus:outline-none">
            <option value="">All KYC Statuses</option>
            {KYC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10 bg-[#027333] text-white">
                <tr>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Buyer No.</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Name</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Phone</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Email</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Source</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">KYC</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading buyers...</td></tr>
                : pageRows.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No buyers found.</td></tr>
                : pageRows.map((row, i) => (
                  <tr key={row._id} className={`border-t border-slate-100 transition ${i % 2 === 0 ? "bg-white hover:bg-slate-50" : "bg-slate-50/60 hover:bg-slate-100/40"}`}>
                    <td className="px-3 py-2 font-black text-slate-900">{row.buyerNumber}</td>
                    <td className="px-3 py-2">
                      <div className="font-bold text-slate-900">{row.fullName}</div>
                      {row.idNumber && <div className="text-[11px] text-slate-500">ID: {row.idNumber}</div>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{row.phone || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{row.email || "—"}</td>
                    <td className="px-3 py-2 capitalize text-slate-600">{String(row.source || "").replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-black ${kycColors[row.kycStatus] || ""}`}>{row.kycStatus}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1.5">
                        <button onClick={() => printBuyer(row)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-600"><FaPrint /></button>
                        <button onClick={() => openEdit(row)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-700"><FaEdit /></button>
                        <button onClick={() => handleDelete(row)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700"><FaTrash /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-2 text-xs text-slate-500">
            <span>Showing <strong className="text-slate-900">{buyers.length === 0 ? 0 : (safePage - 1) * ITEMS_PER_PAGE + 1}</strong>–<strong className="text-slate-900">{Math.min(safePage * ITEMS_PER_PAGE, buyers.length)}</strong> of <strong className="text-slate-900">{buyers.length}</strong></span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="rounded-lg border border-slate-200 px-3 py-1 font-semibold disabled:opacity-40">Prev</button>
              <span>Page {safePage} of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="rounded-lg border border-slate-200 px-3 py-1 font-semibold disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
          <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-[#027333] px-6 py-4 text-white">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100">Property Sale</p>
                <h3 className="text-lg font-black">{editingId ? "Edit Buyer" : "Register Buyer"}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-6 md:grid-cols-2">
              <label className="block md:col-span-2"><span className="text-xs font-bold text-slate-700">Full Name</span><input value={form.fullName} onChange={f("fullName")} className={inputCls} /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">National ID / Passport</span><input value={form.idNumber} onChange={f("idNumber")} className={inputCls} /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Phone</span><input value={form.phone} onChange={f("phone")} className={inputCls} /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Email</span><input type="email" value={form.email} onChange={f("email")} className={inputCls} /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Nationality</span><input value={form.nationality} onChange={f("nationality")} className={inputCls} /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Source</span><select value={form.source} onChange={f("source")} className={inputCls}>{SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g," ")}</option>)}</select></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">KYC Status</span><select value={form.kycStatus} onChange={f("kycStatus")} className={inputCls}>{KYC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className="block md:col-span-2"><span className="text-xs font-bold text-slate-700">Address</span><input value={form.address} onChange={f("address")} className={inputCls} /></label>
              <label className="block md:col-span-2"><span className="text-xs font-bold text-slate-700">Notes</span><textarea rows={2} value={form.notes} onChange={f("notes")} className={inputCls} /></label>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
              <button onClick={() => setShowModal(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#027333] px-4 py-2 text-sm font-black text-white disabled:opacity-60">{saving ? "Saving..." : editingId ? "Update Buyer" : "Register Buyer"}</button>
            </div>
          </div>
        </div>
      )}
    </PropertySaleShell>
  );
};

export default SaleBuyers;

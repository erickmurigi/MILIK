import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { FaEdit, FaPlus, FaPrint, FaSearch, FaTimes, FaTrash, FaUserTie } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";

const ITEMS_PER_PAGE = 50;

const blankForm = {
  fullName: "", phone: "", email: "", idNumber: "",
  commissionRate: 3, commissionType: "percentage", status: "active", notes: "",
};

const SaleAgents = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(blankForm);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 400);
  const [page, setPage] = useState(1);

  const biz = currentCompany?._id;

  const queryKey = ["sale-agents", biz, debouncedSearch, page];
  const { data: agentsData, isLoading: loading, error } = useQuery({
    queryKey,
    queryFn: () => saleApi.listAgents({ business: biz, search: debouncedSearch, page, limit: ITEMS_PER_PAGE }),
    enabled: !!biz,
    placeholderData: (prev) => prev,
  });

  useEffect(() => { if (error) toast.error("Failed to load agents"); }, [error]);
  useEffect(() => setPage(1), [debouncedSearch]);

  const agents = agentsData?.data ?? [];
  const serverTotal = agentsData?.total ?? 0;
  const backendStats = agentsData?.stats ?? null;
  const totalPages = Math.max(1, Math.ceil(serverTotal / ITEMS_PER_PAGE));
  const safePage = page;
  const pageRows = agents;

  const openCreate = () => { setEditingId(""); setForm(blankForm); setShowModal(true); };
  const openEdit = (row) => {
    setEditingId(row._id);
    setForm({ fullName: row.fullName || "", phone: row.phone || "", email: row.email || "", idNumber: row.idNumber || "", commissionRate: row.commissionRate ?? 3, commissionType: row.commissionType || "percentage", status: row.status || "active", notes: row.notes || "" });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.fullName.trim()) return toast.warning("Full name is required");
    if (Number(form.commissionRate) < 0) return toast.warning("Commission rate cannot be negative");
    setSaving(true);
    try {
      const payload = { ...form, business: biz, commissionRate: Number(form.commissionRate) };
      if (editingId) await saleApi.updateAgent(editingId, payload);
      else await saleApi.createAgent(payload);
      await queryClient.invalidateQueries({ queryKey: ["sale-agents", biz] });
      setShowModal(false);
      toast.success(`Agent ${editingId ? "updated" : "registered"}`);
    } catch (err) { toast.error(err?.response?.data?.message || "Failed to save agent"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (row) => {
    if (!await confirm({ title: "Remove Agent", message: `Remove agent "${row.fullName}"?`, confirmText: "Remove", isDangerous: true })) return;
    try {
      await saleApi.deleteAgent(row._id);
      await queryClient.invalidateQueries({ queryKey: ["sale-agents", biz] });
      toast.success("Agent removed");
    } catch (err) { toast.error(err?.response?.data?.message || "Cannot remove this agent"); }
  };

  const printAgent = (row) => {
    const co = currentCompany || {};
    const coName = co.companyName || co.name || "MILIK";
    const esc = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const logoHtml = co.logo ? `<img src="${co.logo}" alt="logo" style="width:72px;height:72px;object-fit:contain;border-radius:10px;border:1px solid #cbd5e1;" />` : `<div style="width:72px;height:72px;background:#027333;color:#fff;font-size:26px;font-weight:900;display:flex;align-items:center;justify-content:center;border-radius:10px;">${coName.slice(0,1)}</div>`;
    const coInfo = [co.phone||co.phoneNumber, co.email||co.companyEmail].filter(Boolean).join(" • ");
    const printedOn = new Date().toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"});
    const statusBg = row.status === "active" ? "#dcfce7" : "#f1f5f9";
    const statusC = row.status === "active" ? "#166534" : "#64748b";
    const commDisplay = row.commissionType === "percentage" ? `${row.commissionRate}%` : fmtKES(row.commissionRate) + " flat";

    const win = window.open("","_blank","width=900,height=680");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Agent Profile — ${esc(row.agentNumber)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:28px 32px;font-size:12px}
.hdr{display:grid;grid-template-columns:80px 1fr 170px;align-items:start;border-bottom:3px solid #027333;padding-bottom:14px;margin-bottom:18px;gap:12px}
.co-name{font-size:18px;font-weight:900;color:#027333}
.co-sub{font-size:9px;color:#64748b;line-height:1.5}
.doc-type{font-size:13px;font-weight:900;color:#027333;text-transform:uppercase;letter-spacing:.05em;text-align:right}
.doc-no{font-family:monospace;font-size:15px;font-weight:700;text-align:right;margin-top:3px}
.badge{display:inline-block;padding:3px 12px;border-radius:999px;font-size:10px;font-weight:800;float:right;margin-top:6px;background:${statusBg};color:${statusC}}
.comm-box{border:2px solid #027333;border-radius:8px;padding:12px 16px;margin-bottom:16px;background:#f0faf5;display:flex;align-items:center;justify-content:space-between}
.comm-label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#64748b}
.comm-val{font-size:24px;font-weight:900;color:#027333;font-family:monospace}
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
    <div class="doc-type">Sales Agent</div>
    <div class="doc-no">${esc(row.agentNumber)}</div>
    <div class="badge">${esc(String(row.status||"").toUpperCase())}</div>
  </div>
</div>
<div class="comm-box">
  <div><div class="comm-label">Commission Rate</div><div class="comm-val">${esc(commDisplay)}</div><div class="comm-label" style="margin-top:4px">Type: ${esc(row.commissionType)}</div></div>
  <div style="text-align:right"><div class="comm-label">Agent Code</div><div style="font-size:18px;font-weight:900;font-family:monospace;color:#0f172a;margin-top:4px">${esc(row.agentNumber)}</div></div>
</div>
<div class="grid">
  <div class="field"><div class="fl">Full Name</div><div class="fv">${esc(row.fullName)}</div></div>
  <div class="field"><div class="fl">Phone</div><div class="fv">${esc(row.phone||"—")}</div></div>
  <div class="field"><div class="fl">Email</div><div class="fv">${esc(row.email||"—")}</div></div>
  <div class="field"><div class="fl">ID Number</div><div class="fv">${esc(row.idNumber||"—")}</div></div>
  <div class="field"><div class="fl">Status</div><div class="fv">${esc(row.status)}</div></div>
</div>
${row.notes?`<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-size:11px;color:#334155;line-height:1.6"><div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:4px">Notes</div>${esc(row.notes)}</div>`:""}
<div class="notice">Agent profile issued by ${esc(coName)} • Printed: ${esc(printedOn)}</div>
</body></html>`);
    win.document.close();
    setTimeout(()=>{win.focus();win.print();},400);
  };

  const inputCls = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#027333] focus:outline-none focus:ring-2 focus:ring-[#027333]/20";
  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  return (
    <PropertySaleShell
      title="Sales Agents"
      subtitle={`${serverTotal} agent(s)`}
      action={<button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-[#027333] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0c5d2b]"><FaPlus /> New Agent</button>}
    >
      <div className="flex h-full flex-col gap-2">
        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Total Agents", value: serverTotal, cls: "bg-slate-900 text-white" },
            { label: "Active", value: backendStats?.active?.count ?? agents.filter((a) => a.status === "active").length, cls: "bg-[#027333] text-white" },
            { label: "Inactive", value: backendStats?.inactive?.count ?? agents.filter((a) => a.status !== "active").length, cls: "bg-slate-100 border border-slate-200 text-slate-700" },
            {
              label: "Avg Commission",
              value: backendStats?.active?.avgRate != null
                ? `${Number(backendStats.active.avgRate).toFixed(1)}%`
                : agents.length > 0
                  ? `${(agents.reduce((s, a) => s + Number(a.commissionRate || 0), 0) / agents.length).toFixed(1)}%`
                  : "—",
              cls: "bg-emerald-50 border border-emerald-200 text-emerald-900",
            },
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
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agents..." className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs focus:border-[#027333] focus:outline-none" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-[#027333] text-white">
                <tr>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Agent No.</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Name</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Phone</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Email</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Commission</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Status</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading agents...</td></tr>
                : pageRows.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No agents found.</td></tr>
                : pageRows.map((row, i) => (
                  <tr key={row._id} className={`border-t border-slate-100 transition ${i % 2 === 0 ? "bg-white hover:bg-slate-50" : "bg-slate-50/60 hover:bg-slate-100/40"}`}>
                    <td className="px-3 py-2 font-black text-slate-900">{row.agentNumber}</td>
                    <td className="px-3 py-2 font-bold text-slate-900">{row.fullName}</td>
                    <td className="px-3 py-2 text-slate-600">{row.phone || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{row.email || "—"}</td>
                    <td className="px-3 py-2 font-black text-[#027333]">
                      {row.commissionType === "percentage" ? `${row.commissionRate}%` : fmtKES(row.commissionRate)}
                      <span className="ml-1 text-[10px] font-normal text-slate-400">({row.commissionType})</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-black ${row.status === "active" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-50 border-slate-200 text-slate-600"}`}>{row.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1.5">
                        <button onClick={() => printAgent(row)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-600"><FaPrint /></button>
                        <button onClick={() => openEdit(row)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-700"><FaEdit /></button>
                        <button onClick={() => handleDelete(row)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700"><FaTrash /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-2 text-xs text-slate-500">
            <span><strong className="text-slate-900">{serverTotal}</strong> agent(s)</span>
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
          <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-[#027333] px-6 py-4 text-white">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100">Property Sale</p>
                <h3 className="text-lg font-black">{editingId ? "Edit Agent" : "New Sales Agent"}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-6 md:grid-cols-2">
              <label className="block md:col-span-2"><span className="text-xs font-bold text-slate-700">Full Name</span><input value={form.fullName} onChange={f("fullName")} className={inputCls} /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Phone</span><input value={form.phone} onChange={f("phone")} className={inputCls} /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Email</span><input type="email" value={form.email} onChange={f("email")} className={inputCls} /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">National ID</span><input value={form.idNumber} onChange={f("idNumber")} className={inputCls} /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Status</span><select value={form.status} onChange={f("status")} className={inputCls}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Commission Type</span><select value={form.commissionType} onChange={f("commissionType")} className={inputCls}><option value="percentage">Percentage (%)</option><option value="flat">Flat Amount (KES)</option></select></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Commission Rate {form.commissionType === "percentage" ? "(%)" : "(KES)"}</span><input type="number" value={form.commissionRate} onChange={f("commissionRate")} className={inputCls} /></label>
              <label className="block md:col-span-2"><span className="text-xs font-bold text-slate-700">Notes</span><textarea rows={2} value={form.notes} onChange={f("notes")} className={inputCls} /></label>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
              <button onClick={() => setShowModal(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#027333] px-4 py-2 text-sm font-black text-white disabled:opacity-60">{saving ? "Saving..." : editingId ? "Update Agent" : "Save Agent"}</button>
            </div>
          </div>
        </div>
      )}
    </PropertySaleShell>
  );
};

export default SaleAgents;

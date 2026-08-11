import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { FaChartLine, FaEdit, FaPlus, FaPrint, FaRedoAlt, FaTimes, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";
import { inputClass, labelClass } from "../../utils/formStyles";

const PAGE_SIZE = 50;

const blankForm = {
  fullName: "", phone: "", email: "", idNumber: "",
  commissionRate: 3, commissionType: "percentage", status: "active", notes: "",
};


const SaleAgents = () => {
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const navigate       = useNavigate();
  const [saving,    setSaving]    = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form,      setForm]      = useState(blankForm);
  const [search,       setSearch]       = useTabState("/sale/agents:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [statusFilter, setStatusFilter] = useTabState("/sale/agents:statusFilter", "");
  const [commTypeFilt, setCommTypeFilt] = useTabState("/sale/agents:commTypeFilt", "");
  const [page,         setPage]         = useTabState("/sale/agents:page", 1);
  const [pageSize,     setPageSize]     = useTabState("/sale/agents:pageSize", PAGE_SIZE);

  const biz = currentCompany?._id;

  useEffect(() => setPage(1), [debouncedSearch, statusFilter, commTypeFilt]);

  const { data: agentsData, isLoading: loading, isFetching, error } = useQuery({
    queryKey: ["sale-agents", biz, debouncedSearch, statusFilter, commTypeFilt, page, pageSize],
    queryFn:  () => saleApi.listAgents({ business: biz, search: debouncedSearch, status: statusFilter || undefined, commissionType: commTypeFilt, page, limit: pageSize }),
    enabled:  !!biz,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  useEffect(() => { if (error) toast.error("Failed to load agents"); }, [error]);

  const agents     = agentsData?.data   ?? [];
  const total      = agentsData?.total  ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["sale-agents", biz] });

  const openCreate = () => { setEditingId(""); setForm(blankForm); setShowModal(true); };
  const openEdit   = (row) => {
    setEditingId(row._id);
    setForm({
      fullName: row.fullName || "", phone: row.phone || "", email: row.email || "",
      idNumber: row.idNumber || "", commissionRate: row.commissionRate ?? 3,
      commissionType: row.commissionType || "percentage", status: row.status || "active", notes: row.notes || "",
    });
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
      invalidate();
      setShowModal(false);
      toast.success(`Agent ${editingId ? "updated" : "registered"}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save agent");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!await confirm({ title: "Remove Agent", message: `Remove agent "${row.fullName}"?`, confirmText: "Remove", isDangerous: true })) return;
    try {
      await saleApi.deleteAgent(row._id);
      invalidate();
      toast.success("Agent removed");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Cannot remove this agent");
    }
  };

  const printAgent = (row) => {
    const co        = currentCompany || {};
    const coName    = co.companyName || co.name || "MILIK";
    const esc       = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const logoHtml  = co.logo
      ? `<img src="${co.logo}" alt="logo" style="width:72px;height:72px;object-fit:contain;border:1px solid #cbd5e1;" />`
      : `<div style="width:72px;height:72px;background:#0B3B2E;color:#fff;font-size:26px;font-weight:900;display:flex;align-items:center;justify-content:center;">${coName.slice(0, 1)}</div>`;
    const coInfo    = [co.phone || co.phoneNumber, co.email || co.companyEmail].filter(Boolean).join(" • ");
    const statusBg  = row.status === "active" ? "#dcfce7" : "#f1f5f9";
    const statusC   = row.status === "active" ? "#166534" : "#64748b";
    const commDisplay = row.commissionType === "percentage" ? `${row.commissionRate}%` : `${fmtKES(row.commissionRate)} flat`;
    const printedOn = new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" });
    const win = window.open("", "_blank", "width=900,height=680");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Agent Profile — ${esc(row.agentNumber)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:28px 32px;font-size:12px}
.hdr{display:grid;grid-template-columns:80px 1fr 170px;align-items:start;border-bottom:3px solid #0B3B2E;padding-bottom:14px;margin-bottom:18px;gap:12px}
.co-name{font-size:18px;font-weight:900;color:#0B3B2E}.co-sub{font-size:9px;color:#64748b;line-height:1.5}
.doc-type{font-size:13px;font-weight:900;color:#0B3B2E;text-transform:uppercase;letter-spacing:.05em;text-align:right}
.doc-no{font-family:monospace;font-size:15px;font-weight:700;text-align:right;margin-top:3px}
.badge{display:inline-block;padding:3px 12px;font-size:10px;font-weight:800;float:right;margin-top:6px;background:${statusBg};color:${statusC}}
.comm-box{border:2px solid #0B3B2E;padding:12px 16px;margin-bottom:16px;background:#f0fdf4;display:flex;align-items:center;justify-content:space-between}
.comm-label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#64748b}
.comm-val{font-size:24px;font-weight:900;color:#0B3B2E;font-family:monospace}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:14px}
.field{background:#fff;padding:9px 12px}.fl{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:2px}
.fv{font-size:11px;font-weight:600;color:#1e293b}
.notice{font-size:9px;color:#94a3b8;text-align:center;margin-top:20px;border-top:1px solid #f1f5f9;padding-top:10px}
@media print{body{padding:14px 16px}@page{size:A4 portrait;margin:10mm}}
</style></head><body>
<div class="hdr">
  <div>${logoHtml}</div>
  <div><div class="co-name">${esc(coName)}</div>${coInfo ? `<div class="co-sub">${esc(coInfo)}</div>` : ""}</div>
  <div>
    <div class="doc-type">Sales Agent</div>
    <div class="doc-no">${esc(row.agentNumber)}</div>
    <div class="badge">${esc(String(row.status || "").toUpperCase())}</div>
  </div>
</div>
<div class="comm-box">
  <div><div class="comm-label">Commission Rate</div><div class="comm-val">${esc(commDisplay)}</div><div class="comm-label" style="margin-top:4px">Type: ${esc(row.commissionType)}</div></div>
  <div style="text-align:right"><div class="comm-label">Agent Code</div><div style="font-size:18px;font-weight:900;font-family:monospace;color:#0f172a;margin-top:4px">${esc(row.agentNumber)}</div></div>
</div>
<div class="grid">
  <div class="field"><div class="fl">Full Name</div><div class="fv">${esc(row.fullName)}</div></div>
  <div class="field"><div class="fl">Phone</div><div class="fv">${esc(row.phone || "—")}</div></div>
  <div class="field"><div class="fl">Email</div><div class="fv">${esc(row.email || "—")}</div></div>
  <div class="field"><div class="fl">ID Number</div><div class="fv">${esc(row.idNumber || "—")}</div></div>
  <div class="field"><div class="fl">Status</div><div class="fv">${esc(row.status)}</div></div>
</div>
${row.notes ? `<div style="border:1px solid #e2e8f0;padding:10px 14px;font-size:11px;color:#334155;line-height:1.6"><div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:4px">Notes</div>${esc(row.notes)}</div>` : ""}
<div class="notice">Agent profile issued by ${esc(coName)} • Printed: ${esc(printedOn)}</div>
</body></html>`);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 400);
  };

  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  return (
    <PropertySaleShell
      title="Sales Agents"
      subtitle={`${total} agent(s)`}
      action={
        <>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-agents", biz] })}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
          >
            <FaPlus size={9} /> New Agent
          </button>
        </>
      }
    >
      {/* Filter bar */}
      <SaleFilterBar
        onReset={() => { setSearch(""); setStatusFilter(""); setCommTypeFilt(""); setPage(1); }}
        activeCount={[search, statusFilter, commTypeFilt].filter(Boolean).length}
      >
        <FilterSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents…"
        />
        <AppSelect value={statusFilter} onChange={(v) => setStatusFilter(v ?? "")} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} placeholder="All Statuses" clearable size="sm" />
        <AppSelect value={commTypeFilt} onChange={(v) => setCommTypeFilt(v ?? "")} options={[{ value: "percentage", label: "Percentage" }, { value: "flat", label: "Flat" }]} placeholder="All Commission Types" clearable size="sm" />
      </SaleFilterBar>

      {/* Table */}
      <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full min-w-[640px] text-xs border-collapse">
            <thead>
              <tr className="bg-[#0B3B2E]">
                {["Agent No.", "Name", "Phone", "Email", "Commission", "Deals", "Status", "Actions"].map((h) => (
                  <th key={h} className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white ${h === "Actions" || h === "Deals" ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-xs text-slate-400">Loading agents…</td></tr>
              ) : agents.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-xs text-slate-400">No agents found.</td></tr>
              ) : agents.map((row) => (
                <tr key={row._id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono font-black text-[#0B3B2E]">{row.agentNumber}</td>
                  <td className="px-3 py-2 font-bold text-slate-900">{row.fullName}</td>
                  <td className="px-3 py-2 text-slate-600">{row.phone || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{row.email || "—"}</td>
                  <td className="px-3 py-2 font-black text-[#0B3B2E]">
                    {row.commissionType === "percentage" ? `${row.commissionRate}%` : fmtKES(row.commissionRate)}
                    <span className="ml-1 text-[10px] font-normal text-slate-400">({row.commissionType})</span>
                  </td>
                  <td className="px-3 py-2 text-right font-black text-slate-700">{row.dealCount ?? 0}</td>
                  <td className="px-3 py-2">
                    <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${row.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button type="button" onClick={() => navigate(`/sale/agents/${row._id}/performance`)} title="Performance" className="border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100"><FaChartLine className="text-[9px]" /></button>
                      <button type="button" onClick={() => printAgent(row)} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaPrint className="text-[9px]" /></button>
                      <button type="button" onClick={() => openEdit(row)} className="border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100"><FaEdit className="text-[9px]" /></button>
                      <button type="button" onClick={() => handleDelete(row)} className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100"><FaTrash className="text-[9px]" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <PaginationBar page={page} pages={totalPages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} />
      </div>

      {/* New / Edit Agent Modal */}
      {showModal && (
        <Modal
          title={editingId ? "Edit Agent" : "New Sales Agent"}
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowModal(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleSave} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {saving ? "Saving…" : editingId ? "Update Agent" : "Save Agent"}
              </button>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClass}>Full Name</label>
              <input value={form.fullName} onChange={f("fullName")} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input value={form.phone} onChange={f("phone")} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" value={form.email} onChange={f("email")} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>National ID</label>
              <input value={form.idNumber} onChange={f("idNumber")} className={inputClass} />
            </div>
            <div>
              <AppSelect label="Status" value={form.status} onChange={(v) => setForm((p) => ({ ...p, status: v ?? "" }))} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} size="md" />
            </div>
            <div>
              <AppSelect label="Commission Type" value={form.commissionType} onChange={(v) => setForm((p) => ({ ...p, commissionType: v ?? "" }))} options={[{ value: "percentage", label: "Percentage (%)" }, { value: "flat", label: "Flat Amount (KES)" }]} size="md" />
            </div>
            <div>
              <label className={labelClass}>Rate {form.commissionType === "percentage" ? "(%)" : "(KES)"}</label>
              <input type="number" value={form.commissionRate} onChange={f("commissionRate")} className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea rows={2} value={form.notes} onChange={f("notes")} className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
            </div>
          </div>
        </Modal>
      )}
    </PropertySaleShell>
  );
};

export default SaleAgents;

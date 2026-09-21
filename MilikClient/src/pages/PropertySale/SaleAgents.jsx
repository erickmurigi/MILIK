import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { FaChartLine, FaEdit, FaPlus, FaPrint, FaRedoAlt, FaTimes, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import { printDocument } from "../../utils/printKit";
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
import { useTerms, TERM_DEFAULTS } from "../../hooks/useTerm";

const PAGE_SIZE = 50;

const blankForm = {
  fullName: "", phone: "", email: "", idNumber: "",
  commissionRate: 3, commissionType: "percentage", status: "active", notes: "",
};


const STATUS_OPTIONS         = [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }];
const COMM_TYPE_FILTER_OPTIONS = [{ value: "percentage", label: "Percentage" }, { value: "flat", label: "Flat" }];
const COMM_TYPE_FORM_OPTIONS = [{ value: "percentage", label: "Percentage (%)" }, { value: "flat", label: "Flat Amount (KES)" }];
const agentHeaders = (T) => [`${T.saleAgent} No.`, "Name", "Phone", "Email", "Commission", T.saleDeals, "Status", "Actions"];
// The stock word keeps its "Sales" prefix ("Sales Agent"); a renamed word stands on its own.
const salesAgentLabel = (agent) => (agent === TERM_DEFAULTS.saleAgent ? `Sales ${agent}` : agent);

// One table row — memoised so unrelated page state (search text, modal open/close, ...) doesn't re-render every row.
const AgentRow = React.memo(function AgentRow({ row, onPerformance, onPrint, onEdit, onDelete }) {
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
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
          <button type="button" onClick={() => onPerformance(row._id)} title="Performance" className="border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100"><FaChartLine className="text-[9px]" /></button>
          <button type="button" onClick={() => onPrint(row)} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaPrint className="text-[9px]" /></button>
          <button type="button" onClick={() => onEdit(row)} className="border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100"><FaEdit className="text-[9px]" /></button>
          <button type="button" onClick={() => onDelete(row)} className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100"><FaTrash className="text-[9px]" /></button>
        </div>
      </td>
    </tr>
  );
});

// Modal owns its form state so keystrokes never re-render the page or its rows.
function AgentFormModal({ editingId, initial, saving, onClose, onSubmit }) {
  const T = useTerms("saleAgent");
  const [form, setForm] = useState(initial);
  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));
  return (
    <Modal
      title={editingId ? `Edit ${T.saleAgent}` : `New ${salesAgentLabel(T.saleAgent)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onSubmit(form)} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
            {saving ? "Saving…" : editingId ? `Update ${T.saleAgent}` : `Save ${T.saleAgent}`}
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
          <AppSelect label="Status" value={form.status} onChange={(v) => setForm((p) => ({ ...p, status: v ?? "" }))} options={STATUS_OPTIONS} size="md" />
        </div>
        <div>
          <AppSelect label="Commission Type" value={form.commissionType} onChange={(v) => setForm((p) => ({ ...p, commissionType: v ?? "" }))} options={COMM_TYPE_FORM_OPTIONS} size="md" />
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
  );
}

const SaleAgents = () => {
  const T              = useTerms("saleAgent", "saleAgents", "saleDeals");
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const navigate       = useNavigate();
  const [saving,    setSaving]    = useState(false);
  const [agentModal, setAgentModal] = useState(null);   // { editingId, initial } while the form is open
  const [search,       setSearch]       = useTabState("/sale/agents:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [statusFilter, setStatusFilter] = useTabState("/sale/agents:statusFilter", "");
  const [commTypeFilt, setCommTypeFilt] = useTabState("/sale/agents:commTypeFilt", "");
  const [page,         setPage]         = useTabState("/sale/agents:page", 1);
  const [pageSize,     setPageSize]     = useTabState("/sale/agents:pageSize", PAGE_SIZE);

  const biz = currentCompany?._id;
  const AGENT_HEADERS = useMemo(() => agentHeaders(T), [T]);

  const { data: agentsData, isLoading: loading, isFetching, error } = useQuery({
    queryKey: ["sale-agents", biz, debouncedSearch, statusFilter, commTypeFilt, page, pageSize],
    queryFn:  () => saleApi.listAgents({ business: biz, search: debouncedSearch, status: statusFilter || undefined, commissionType: commTypeFilt, page, limit: pageSize }),
    enabled:  !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  useEffect(() => { if (error) toast.error(`Failed to load ${T.saleAgents.toLowerCase()}`); }, [error, T.saleAgents]);

  const { data: saleSettings } = useQuery({
    queryKey: ["sale-settings", biz],
    queryFn:  () => saleApi.getSettings(),
    enabled:  !!biz,
    staleTime: 10 * 60_000,
  });

  const agents     = useMemo(() => agentsData?.data ?? [], [agentsData]);
  const total      = agentsData?.total  ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const invalidate = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["sale-agents", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-agents-ref", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-agents-perf-list", biz] }),
  ]), [queryClient, biz]);

  const editingId = agentModal?.editingId || "";
  const openCreate = () => {
    const def = saleSettings?.commissionDefaults;
    setAgentModal({ editingId: "", initial: { ...blankForm, commissionRate: def?.rate ?? 3, commissionType: def?.commissionType ?? "percentage" } });
  };
  const openEdit   = useCallback((row) => {
    setAgentModal({
      editingId: row._id,
      initial: {
        fullName: row.fullName || "", phone: row.phone || "", email: row.email || "",
        idNumber: row.idNumber || "", commissionRate: row.commissionRate ?? 3,
        commissionType: row.commissionType || "percentage", status: row.status || "active", notes: row.notes || "",
      },
    });
  }, []);

  const handleSave = async (form) => {
    if (!form.fullName.trim()) return toast.warning("Full name is required");
    if (Number(form.commissionRate) < 0) return toast.warning("Commission rate cannot be negative");
    setSaving(true);
    try {
      const payload = { ...form, business: biz, commissionRate: Number(form.commissionRate) };
      if (editingId) await saleApi.updateAgent(editingId, payload);
      else await saleApi.createAgent(payload);
      invalidate();
      setAgentModal(null);
      toast.success(`${T.saleAgent} ${editingId ? "updated" : "registered"}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to save ${T.saleAgent.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback(async (row) => {
    if (!await confirm({ title: `Remove ${T.saleAgent}`, message: `Remove ${T.saleAgent.toLowerCase()} "${row.fullName}"?`, confirmText: "Remove", isDangerous: true })) return;
    try {
      await saleApi.deleteAgent(row._id);
      invalidate();
      toast.success(`${T.saleAgent} removed`);
    } catch (err) {
      toast.error(err?.response?.data?.message || `Cannot remove this ${T.saleAgent.toLowerCase()}`);
    }
  }, [confirm, invalidate, T.saleAgent]);

  const printAgent = useCallback((row) => {
    const commDisplay = row.commissionType === "percentage" ? `${row.commissionRate}%` : `${fmtKES(row.commissionRate)} flat`;
    const printed = printDocument({
      company: currentCompany,
      docType: `${salesAgentLabel(T.saleAgent)} Profile`,
      docNumber: row.agentNumber || "",
      status: { label: row.status || "", tone: row.status === "active" ? "success" : "neutral" },
      parties: [{ heading: `${T.saleAgent} details`, name: row.fullName, lines: [row.phone, row.email, row.idNumber ? `ID: ${row.idNumber}` : ""] }],
      details: { heading: "Commission", rows: [["Rate", commDisplay], ["Type", row.commissionType || "—"], [`${T.saleAgent} code`, row.agentNumber || "—"], ["Status", row.status || "—"]] },
      notes: row.notes ? [{ heading: "Notes", text: row.notes }] : [],
    });
    if (!printed) toast.warn(`Allow pop-ups to print the ${T.saleAgent.toLowerCase()} profile`);
  }, [currentCompany, T.saleAgent]);

  const handlePerformance = useCallback((id) => navigate(`/sale/agents/${id}/performance`), [navigate]);

  return (
    <PropertySaleShell>
      <SaleFilterBar
        leading={<span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{total} {(total === 1 ? T.saleAgent : T.saleAgents).toLowerCase()}</span>}
        onReset={() => { setSearch(""); setStatusFilter(""); setCommTypeFilt(""); setPage(1); }}
        activeCount={[search, statusFilter, commTypeFilt].filter(Boolean).length}
        trailing={
          <>
            <button type="button" onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-agents", biz] })} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
              <FaRedoAlt size={8} className={isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <button type="button" onClick={openCreate} className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]">
              <FaPlus size={8} /> New {T.saleAgent}
            </button>
          </>
        }
      >
        <FilterSearch value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={`Search ${T.saleAgents.toLowerCase()}…`} />
        <AppSelect value={statusFilter} onChange={(v) => { setStatusFilter(v ?? ""); setPage(1); }} options={STATUS_OPTIONS} placeholder="All Statuses" clearable size="sm" />
        <AppSelect value={commTypeFilt} onChange={(v) => { setCommTypeFilt(v ?? ""); setPage(1); }} options={COMM_TYPE_FILTER_OPTIONS} placeholder="All Comm. Types" clearable size="sm" />
      </SaleFilterBar>

      {/* Table */}
      <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full min-w-[640px] text-xs border-collapse">
            <thead>
              <tr className="bg-[#0B3B2E]">
                {AGENT_HEADERS.map((h, i) => (
                  <th key={h} className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white ${i === 5 || i === 7 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-xs text-slate-400">Loading {T.saleAgents.toLowerCase()}…</td></tr>
              ) : agents.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-xs text-slate-400">No {T.saleAgents.toLowerCase()} found.</td></tr>
              ) : agents.map((row) => (
                <AgentRow key={row._id} row={row} onPerformance={handlePerformance} onPrint={printAgent} onEdit={openEdit} onDelete={handleDelete} />
              ))}
            </tbody>
          </table>
        </div>

        <PaginationBar page={page} pages={totalPages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} />
      </div>

      {/* New / Edit Agent Modal */}
      {agentModal && (
        <AgentFormModal editingId={agentModal.editingId} initial={agentModal.initial} saving={saving} onClose={() => setAgentModal(null)} onSubmit={handleSave} />
      )}
    </PropertySaleShell>
  );
};

export default SaleAgents;

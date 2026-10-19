import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
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
import MilikTable from "../../components/common/MilikTable";
import { inputClass, labelClass } from "../../utils/formStyles";
import { useTerms, TERM_DEFAULTS } from "../../hooks/useTerm";
import { getUsers } from "../../redux/apiCalls";
import { selectAllUsers } from "../../redux/selectors";
import SalePrintButton from "./SalePrintButton";
import SaleExportButton from "./SaleExportButton";
import { exportAfterFetch, fetchAllPages, printAfterFetch } from "./salePrint";

const PAGE_SIZE = 50;

const blankForm = {
  fullName: "", phone: "", email: "", idNumber: "", userId: "",
  commissionRate: 3, commissionType: "percentage", status: "active", notes: "",
};


const STATUS_OPTIONS         = [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }];
const COMM_TYPE_FILTER_OPTIONS = [{ value: "percentage", label: "Percentage" }, { value: "flat", label: "Flat" }];
const COMM_TYPE_FORM_OPTIONS = [{ value: "percentage", label: "Percentage (%)" }, { value: "flat", label: "Flat Amount (KES)" }];
const agentColumns = (T) => [{ label: `${T.saleAgent} No.` }, { label: "Name" }, { label: "Phone" }, { label: "Email" }, { label: "Commission" }, { label: T.saleDeals, align: "right" }, { label: "Status" }];
// The stock word keeps its "Sales" prefix ("Sales Agent"); a renamed word stands on its own.
const salesAgentLabel = (agent) => (agent === TERM_DEFAULTS.saleAgent ? `Sales ${agent}` : agent);

// Module scope so MilikTable's React.memo isn't defeated by a fresh function identity each parent render.
const renderAgentRow = (row) => (
  <>
    <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-black text-[#0B3B2E]">{row.agentNumber}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-slate-900">{row.fullName}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.phone || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.email || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 font-black text-[#0B3B2E]">
      {row.commissionType === "percentage" ? `${row.commissionRate}%` : fmtKES(row.commissionRate)}
      <span className="ml-1 text-[10px] font-normal text-slate-400">({row.commissionType})</span>
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-black text-slate-700 tabular-nums">{row.dealCount ?? 0}</td>
    <td className="px-3 py-1.5">
      <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${row.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
        {row.status}
      </span>
    </td>
  </>
);

// Modal owns its form state so keystrokes never re-render the page or its rows.
function AgentFormModal({ editingId, initial, saving, onClose, onSubmit, companyId }) {
  const T = useTerms("saleAgent");
  const dispatch = useDispatch();
  const users = useSelector(selectAllUsers);
  const [form, setForm] = useState(initial);
  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  useEffect(() => { if (companyId) dispatch(getUsers(companyId)); }, [companyId, dispatch]);
  const userOptions = useMemo(
    () => (Array.isArray(users) ? users : []).map((u) => ({ value: u._id, label: `${u.otherNames || ""} ${u.surname || ""}`.trim() || u.email || u._id })),
    [users]
  );
  return (
    <Modal
      title={editingId ? `Edit ${T.saleAgent}` : `New ${salesAgentLabel(T.saleAgent)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onSubmit(form)} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
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
          <AppSelect label="Link to user account" value={form.userId} onChange={(v) => setForm((p) => ({ ...p, userId: v ?? "" }))} options={userOptions} size="md" clearable placeholder="Not linked" />
          <p className="mt-1 text-[10px] text-slate-400">Optional — link this record to a user's login so they can sign in and see only their own assigned work.</p>
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
  const AGENT_COLUMNS = useMemo(() => agentColumns(T), [T]);

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
        userId: row.userId || row.user?._id || "",
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

  const renderAgentActions = useCallback((row) => (
    <div className="inline-flex gap-1">
      <button type="button" onClick={() => handlePerformance(row._id)} title="Performance" className="border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100"><FaChartLine className="text-[9px]" /></button>
      <button type="button" onClick={() => printAgent(row)} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaPrint className="text-[9px]" /></button>
      <button type="button" onClick={() => openEdit(row)} className="border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100"><FaEdit className="text-[9px]" /></button>
      <button type="button" onClick={() => handleDelete(row)} className="border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50"><FaTrash className="text-[9px]" /></button>
    </div>
  ), [handlePerformance, printAgent, openEdit, handleDelete]);

  const reportColumns = [
    { label: `${T.saleAgent} No.`, value: (r) => r.agentNumber },
    { label: "Name", value: (r) => r.fullName },
    { label: "Phone", value: (r) => r.phone || "—" },
    { label: "Email", value: (r) => r.email || "—" },
    { label: "Commission", value: (r) => (r.commissionType === "percentage" ? `${r.commissionRate}%` : fmtKES(r.commissionRate)) },
    { label: T.saleDeals, value: (r) => r.dealCount ?? 0 },
    { label: "Status", value: (r) => r.status },
  ];

  const [printing, setPrinting] = useState(false);
  const printReport = async () => {
    setPrinting(true);
    const described = [
      statusFilter && `Status: ${statusFilter}`,
      commTypeFilt && `Commission: ${commTypeFilt}`,
      debouncedSearch && `Search: ${debouncedSearch}`,
    ].filter(Boolean);
    await printAfterFetch(() => fetchAllPages(saleApi.listAgents, { business: biz, search: debouncedSearch, status: statusFilter || undefined, commissionType: commTypeFilt }), ({ rows }) => ({
      title: T.saleAgents,
      subtitle: described.join(" · ") || `All ${T.saleAgents.toLowerCase()}`,
      company: currentCompany,
      columns: reportColumns,
      rows,
    }));
    setPrinting(false);
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    await exportAfterFetch(() => fetchAllPages(saleApi.listAgents, { business: biz, search: debouncedSearch, status: statusFilter || undefined, commissionType: commTypeFilt }), ({ rows }) => ({
      filename: "agents",
      columns: reportColumns,
      rows,
    }));
    setExporting(false);
  };

  return (
    <PropertySaleShell>
      <SaleFilterBar
        leading={<span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{total} {(total === 1 ? T.saleAgent : T.saleAgents).toLowerCase()}</span>}
        onReset={() => { setSearch(""); setStatusFilter(""); setCommTypeFilt(""); setPage(1); }}
        activeCount={[search, statusFilter, commTypeFilt].filter(Boolean).length}
        trailing={
          <>
            <SalePrintButton onClick={printReport} busy={printing} disabled={loading || total === 0} />
            <SaleExportButton onClick={exportReport} busy={exporting} disabled={loading || total === 0} />
            <button type="button" onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-agents", biz] })} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
              <FaRedoAlt size={8} className={isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <button type="button" onClick={openCreate} className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
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
        <MilikTable
          columns={AGENT_COLUMNS}
          rows={agents}
          rowKey="_id"
          loading={loading}
          empty={`No ${T.saleAgents.toLowerCase()} found.`}
          minWidth={640}
          renderRow={renderAgentRow}
          renderActions={renderAgentActions}
        />

        <PaginationBar page={page} pages={totalPages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} />
      </div>

      {/* New / Edit Agent Modal */}
      {agentModal && (
        <AgentFormModal editingId={agentModal.editingId} initial={agentModal.initial} saving={saving} onClose={() => setAgentModal(null)} onSubmit={handleSave} companyId={biz} />
      )}
    </PropertySaleShell>
  );
};

export default SaleAgents;

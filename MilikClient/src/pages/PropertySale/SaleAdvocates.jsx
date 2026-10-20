import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { FaArrowRight, FaEdit, FaPlus, FaPrint, FaRedoAlt, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import { printDocument } from "../../utils/printKit";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { saleApi } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";
import MilikTable from "../../components/common/MilikTable";
import { inputClass, labelClass } from "../../utils/formStyles";
import { useTerms } from "../../hooks/useTerm";
import SalePrintButton from "./SalePrintButton";
import SaleExportButton from "./SaleExportButton";
import { exportAfterFetch, fetchAllPages, printAfterFetch } from "./salePrint";

const PAGE_SIZE = 50;

// No payeeBank block here, deliberately — unlike SaleOwner, an advocate is never paid a recharge through
// this record: the buyer pays their own legal fee directly (see SaleAdvocate.js model comment).
const blankForm = { fullName: "", firm: "", phone: "", email: "", idNumber: "", status: "active", notes: "" };

const STATUS_OPTIONS = [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }];
const advocateColumns = (T) => [{ label: `${T.saleAdvocate} No.` }, { label: "Name" }, { label: "Firm" }, { label: "Phone" }, { label: T.saleProjects, align: "right" }, { label: "Status" }];

// Module scope so MilikTable's React.memo isn't defeated by a fresh function identity each parent render.
const renderAdvocateRow = (row) => (
  <>
    <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-black text-[#0B3B2E]">{row.advocateNumber}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 font-bold text-slate-900">{row.fullName}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.firm || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.phone || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-black text-slate-700 tabular-nums">{row.projectCount ?? 0}</td>
    <td className="px-3 py-1.5">
      <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${row.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
        {row.status}
      </span>
    </td>
  </>
);

// Modal owns its form state so keystrokes never re-render the page or its rows.
function AdvocateFormModal({ editingId, initial, saving, onClose, onSubmit }) {
  const T = useTerms("saleAdvocate");
  const navigate = useNavigate();
  const [form, setForm] = useState(initial);
  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  return (
    <Modal
      title={editingId ? `Edit ${T.saleAdvocate}` : `New ${T.saleAdvocate}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onSubmit(form)} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
            {saving ? "Saving…" : editingId ? `Update ${T.saleAdvocate}` : `Save ${T.saleAdvocate}`}
          </button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={labelClass}>Full Name</label>
          <input value={form.fullName} onChange={f("fullName")} className={inputClass} />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>Firm</label>
          <input value={form.firm} onChange={f("firm")} className={inputClass} />
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

        {editingId && (
          <div className="md:col-span-2">
            <label className={labelClass}>Portal Access</label>
            <button
              type="button"
              onClick={() => navigate("/portal-users/advocates")}
              className="flex w-full items-center justify-between border border-[#B7C9C0] bg-[#F1F6F3] px-3 py-2 text-xs font-bold text-[#0B3B2E] hover:bg-[#E3EDE8]"
            >
              Manage portal users for this firm
              <FaArrowRight size={10} />
            </button>
            <p className="mt-1 text-[10px] text-slate-400">
              A firm can have several people with their own logins — invite, reset or lock their access from the Advocates Portal page.
            </p>
          </div>
        )}

        <div className="md:col-span-2">
          <label className={labelClass}>Notes</label>
          <textarea rows={2} value={form.notes} onChange={f("notes")} className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
        </div>
      </div>
    </Modal>
  );
}

const SaleAdvocates = () => {
  const T              = useTerms("saleAdvocate", "saleAdvocates", "saleProjects");
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const [saving,    setSaving]    = useState(false);
  const [advocateModal, setAdvocateModal] = useState(null);   // { editingId, initial } while the form is open
  const [search,       setSearch]       = useTabState("/sale/advocates:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [statusFilter, setStatusFilter] = useTabState("/sale/advocates:statusFilter", "");
  const [page,         setPage]         = useTabState("/sale/advocates:page", 1);
  const [pageSize,     setPageSize]     = useTabState("/sale/advocates:pageSize", PAGE_SIZE);

  const biz = currentCompany?._id;
  const ADVOCATE_COLUMNS = useMemo(() => advocateColumns(T), [T]);

  const { data: advocatesData, isLoading: loading, isFetching, error } = useQuery({
    queryKey: ["sale-advocates", biz, debouncedSearch, statusFilter, page, pageSize],
    queryFn:  () => saleApi.listAdvocates({ business: biz, search: debouncedSearch, status: statusFilter || undefined, page, limit: pageSize }),
    enabled:  !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  useEffect(() => { if (error) toast.error(`Failed to load ${T.saleAdvocates.toLowerCase()}`); }, [error, T.saleAdvocates]);

  const advocates  = useMemo(() => advocatesData?.data ?? [], [advocatesData]);
  const total      = advocatesData?.total  ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const invalidate = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["sale-advocates", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-advocates-ref", biz] }),
  ]), [queryClient, biz]);

  const editingId = advocateModal?.editingId || "";
  const openCreate = () => setAdvocateModal({ editingId: "", initial: { ...blankForm } });
  const openEdit   = useCallback((row) => {
    setAdvocateModal({
      editingId: row._id,
      initial: {
        fullName: row.fullName || "", firm: row.firm || "", phone: row.phone || "", email: row.email || "",
        idNumber: row.idNumber || "", status: row.status || "active", notes: row.notes || "",
      },
    });
  }, []);

  const handleSave = async (form) => {
    if (!form.fullName.trim()) return toast.warning("Full name is required");
    setSaving(true);
    try {
      const payload = { ...form, business: biz };
      if (editingId) await saleApi.updateAdvocate(editingId, payload);
      else await saleApi.createAdvocate(payload);
      invalidate();
      setAdvocateModal(null);
      toast.success(`${T.saleAdvocate} ${editingId ? "updated" : "registered"}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to save ${T.saleAdvocate.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback(async (row) => {
    if (!await confirm({ title: `Remove ${T.saleAdvocate}`, message: `Remove ${T.saleAdvocate.toLowerCase()} "${row.fullName}"?`, confirmText: "Remove", isDangerous: true })) return;
    try {
      await saleApi.deleteAdvocate(row._id);
      invalidate();
      toast.success(`${T.saleAdvocate} removed`);
    } catch (err) {
      toast.error(err?.response?.data?.message || `Cannot remove this ${T.saleAdvocate.toLowerCase()}`);
    }
  }, [confirm, invalidate, T.saleAdvocate]);

  const printAdvocate = useCallback((row) => {
    const printed = printDocument({
      company: currentCompany,
      docType: `${T.saleAdvocate} Profile`,
      docNumber: row.advocateNumber || "",
      status: { label: row.status || "", tone: row.status === "active" ? "success" : "neutral" },
      parties: [{ heading: `${T.saleAdvocate} details`, name: row.fullName, lines: [row.firm, row.phone, row.email, row.idNumber ? `ID: ${row.idNumber}` : ""] }],
      notes: row.notes ? [{ heading: "Notes", text: row.notes }] : [],
    });
    if (!printed) toast.warn(`Allow pop-ups to print the ${T.saleAdvocate.toLowerCase()} profile`);
  }, [currentCompany, T.saleAdvocate]);

  const renderAdvocateActions = useCallback((row) => (
    <div className="inline-flex gap-1">
      <button type="button" onClick={() => printAdvocate(row)} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaPrint className="text-[9px]" /></button>
      <button type="button" onClick={() => openEdit(row)} className="border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100"><FaEdit className="text-[9px]" /></button>
      <button type="button" onClick={() => handleDelete(row)} className="border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50"><FaTrash className="text-[9px]" /></button>
    </div>
  ), [printAdvocate, openEdit, handleDelete]);

  const reportColumns = [
    { label: `${T.saleAdvocate} No.`, value: (r) => r.advocateNumber },
    { label: "Name", value: (r) => r.fullName },
    { label: "Firm", value: (r) => r.firm || "—" },
    { label: "Phone", value: (r) => r.phone || "—" },
    { label: T.saleProjects, value: (r) => r.projectCount ?? 0 },
    { label: "Status", value: (r) => r.status },
  ];

  const [printing, setPrinting] = useState(false);
  const printReport = async () => {
    setPrinting(true);
    const described = [
      statusFilter && `Status: ${statusFilter}`,
      debouncedSearch && `Search: ${debouncedSearch}`,
    ].filter(Boolean);
    await printAfterFetch(() => fetchAllPages(saleApi.listAdvocates, { business: biz, search: debouncedSearch, status: statusFilter || undefined }), ({ rows }) => ({
      title: T.saleAdvocates,
      subtitle: described.join(" · ") || `All ${T.saleAdvocates.toLowerCase()}`,
      company: currentCompany,
      columns: reportColumns,
      rows,
    }));
    setPrinting(false);
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    await exportAfterFetch(() => fetchAllPages(saleApi.listAdvocates, { business: biz, search: debouncedSearch, status: statusFilter || undefined }), ({ rows }) => ({
      filename: "advocates",
      columns: reportColumns,
      rows,
    }));
    setExporting(false);
  };

  return (
    <PropertySaleShell>
      <SaleFilterBar
        leading={<span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{total} {(total === 1 ? T.saleAdvocate : T.saleAdvocates).toLowerCase()}</span>}
        onReset={() => { setSearch(""); setStatusFilter(""); setPage(1); }}
        activeCount={[search, statusFilter].filter(Boolean).length}
        trailing={
          <>
            <SalePrintButton onClick={printReport} busy={printing} disabled={loading || total === 0} />
            <SaleExportButton onClick={exportReport} busy={exporting} disabled={loading || total === 0} />
            <button type="button" onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-advocates", biz] })} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
              <FaRedoAlt size={8} className={isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <button type="button" onClick={openCreate} className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
              <FaPlus size={8} /> New {T.saleAdvocate}
            </button>
          </>
        }
      >
        <FilterSearch value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={`Search ${T.saleAdvocates.toLowerCase()}…`} />
        <AppSelect value={statusFilter} onChange={(v) => { setStatusFilter(v ?? ""); setPage(1); }} options={STATUS_OPTIONS} placeholder="All Statuses" clearable size="sm" />
      </SaleFilterBar>

      {/* Table */}
      <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
        <MilikTable
          columns={ADVOCATE_COLUMNS}
          rows={advocates}
          rowKey="_id"
          loading={loading}
          empty={`No ${T.saleAdvocates.toLowerCase()} found.`}
          minWidth={640}
          renderRow={renderAdvocateRow}
          renderActions={renderAdvocateActions}
        />

        <PaginationBar page={page} pages={totalPages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} />
      </div>

      {/* New / Edit Advocate Modal */}
      {advocateModal && (
        <AdvocateFormModal
          editingId={advocateModal.editingId}
          initial={advocateModal.initial}
          saving={saving}
          onClose={() => setAdvocateModal(null)}
          onSubmit={handleSave}
        />
      )}
    </PropertySaleShell>
  );
};

export default SaleAdvocates;

import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { FaArchive, FaEdit, FaExternalLinkAlt, FaLayerGroup, FaPlus, FaRedoAlt, FaTrash, FaUndo } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";
import StatusBadge from "../../components/common/StatusBadge";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTerms } from "../../hooks/useTerm";
import SalePrintButton from "./SalePrintButton";
import { fetchAllPages, money, printAfterFetch } from "./salePrint";
import { useTabState } from "../../hooks/useTabState";
import SaleProjectFormModal from "./SaleProjectFormModal";
import SaleProjectPanel from "./SaleProjectPanel";
import SaleProjectProgressBar from "./SaleProjectProgressBar";
import { PROJECT_STATUS_MAP, errorMessage, fmtPct } from "./SaleProjectShared";

const PAGE_SIZE = 50;
const DEFAULT_STATUS = "active";
const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const projectTableCols = (T) => [
  { label: `${T.saleProject} No.` },
  { label: "Name" },
  { label: "Location" },
  { label: "Progress", width: 190 },
  { label: "Sell-through", align: "right" },
  { label: T.saleUnits, align: "right" },
  { label: "Total Value", align: "right" },
  { label: "Status" },
];

// Module scope so MilikTable's React.memo isn't defeated by a fresh function identity each parent render.
const renderProjectRow = (row) => (
  <>
    <td className="px-3 py-1.5 font-mono font-bold text-[#0B3B2E] border-r border-gray-100">{row.projectNumber}</td>
    <td className="px-3 py-1.5 border-r border-gray-100">
      <span className="block max-w-[220px] truncate font-semibold text-slate-900">{row.name}</span>
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600 max-w-[160px] truncate">
      {[row.town, row.county].filter(Boolean).join(", ") || row.location || "—"}
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100">
      <SaleProjectProgressBar units={row.units} />
      <div className="mt-0.5 text-[9px] font-semibold normal-case text-slate-400">
        {row.units?.sold || 0} sold · {row.units?.under_contract || 0} contract · {row.units?.reserved || 0} reserved · {row.units?.available || 0} available
      </div>
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold tabular-nums text-slate-900">{fmtPct(row.sellThrough)}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right tabular-nums text-slate-700">{row.units?.total || 0}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold tabular-nums text-slate-900">{fmtKES(row.value?.total || 0)}</td>
    <td className="px-3 py-1.5">
      <StatusBadge status={row.status} map={PROJECT_STATUS_MAP} />
    </td>
  </>
);

const actionBtn = "inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]";

const SaleProjects = () => {
  const T = useTerms("saleProject", "saleProjects", "saleUnits");
  const PROJECT_TABLE_COLS = useMemo(() => projectTableCols(T), [T]);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const biz = useSelector((s) => s.company?.currentCompany?._id);

  const [search, setSearch] = useTabState("/sale/projects:search", "");
  const [statusFilt, setStatusFilt] = useTabState("/sale/projects:statusFilt", DEFAULT_STATUS);
  const [page, setPage] = useTabState("/sale/projects:page", 1);
  const [pageSize, setPageSize] = useTabState("/sale/projects:pageSize", PAGE_SIZE);
  const [formModal, setFormModal] = useState(null); // { project } while the create/edit modal is open
  const [busyId, setBusyId] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const debouncedSearch = useDebounce(search, 400);

  const { data, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-projects", biz, debouncedSearch, statusFilt, page, pageSize],
    queryFn: () => saleApi.listProjects({ search: debouncedSearch, status: statusFilt, page, limit: pageSize }),
    enabled: !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  const company = useSelector((s) => s.company?.currentCompany);
  const [printing, setPrinting] = useState(false);
  const printReport = async () => {
    setPrinting(true);
    await printAfterFetch(() => fetchAllPages(saleApi.listProjects, { search: debouncedSearch, status: statusFilt }), ({ rows }) => {
      const units = (r, k) => Number(r.units?.[k] || 0);
      const sum = (fn) => rows.reduce((s, r) => s + fn(r), 0);
      const totalUnits = sum((r) => units(r, "total"));
      const soldUnits = sum((r) => units(r, "sold"));
      return {
        title: `${T.saleProject} Summary`,
        subtitle: [statusFilt === "archived" ? "Archived" : "Active", debouncedSearch && `Search: ${debouncedSearch}`].filter(Boolean).join(" · "),
        company,
        summaryItems: [
          [T.saleProjects, String(rows.length)],
          [T.saleUnits, String(totalUnits)],
          ["Sold", String(soldUnits)],
          ["Available", String(sum((r) => units(r, "available")))],
          ["Total value", money(sum((r) => Number(r.value?.total || 0)))],
        ],
        columns: [
          { label: `${T.saleProject} No.`, value: (r) => r.projectNumber },
          { label: "Name", value: (r) => r.name },
          { label: "Location", value: (r) => [r.town, r.county].filter(Boolean).join(", ") || r.location || "—" },
          { label: "Sold", align: "right", value: (r) => units(r, "sold") },
          { label: "Contract", align: "right", value: (r) => units(r, "under_contract") },
          { label: "Reserved", align: "right", value: (r) => units(r, "reserved") },
          { label: "Available", align: "right", value: (r) => units(r, "available") },
          { label: T.saleUnits, align: "right", value: (r) => units(r, "total") },
          { label: "Sell-through", align: "right", value: (r) => fmtPct(r.sellThrough) },
          { label: "Total Value (KES)", align: "right", value: (r) => money(r.value?.total || 0) },
          { label: "Status", value: (r) => r.status },
        ],
        rows,
        totalsRow: ["TOTAL", `${rows.length} ${T.saleProjects.toLowerCase()}`, "", String(soldUnits), String(sum((r) => units(r, "under_contract"))), String(sum((r) => units(r, "reserved"))), String(sum((r) => units(r, "available"))), String(totalUnits), totalUnits ? fmtPct((soldUnits / totalUnits) * 100) : "—", money(sum((r) => Number(r.value?.total || 0))), ""],
      };
    });
    setPrinting(false);
  };

  const projects = useMemo(() => data?.data ?? [], [data?.data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, data?.pages ?? Math.ceil(total / pageSize));
  // The panel shows the row from the current page, so it always reflects fresh data (photos, counts) after a refetch
  const selected = useMemo(() => projects.find((p) => p._id === selectedId) ?? null, [projects, selectedId]);

  const invalidate = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["sale-projects", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-project", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-project-units", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-listings-ref", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] }),
  ]), [queryClient, biz]);

  const handleRowClick = useCallback((row) => setSelectedId((prev) => (prev === row._id ? null : row._id)), []);
  const isRowSelected = useCallback((row) => selectedId === row._id, [selectedId]);
  const openProject = useCallback((row) => navigate(`/sale/projects/${row._id}`), [navigate]);
  const editProject = useCallback((row) => setFormModal({ project: row }), []);

  const handleArchive = useCallback(async (row) => {
    const archive = row.status !== "archived";
    if (archive && !await confirm({
      title: `Archive ${T.saleProject}`,
      message: `Archive "${row.name}"? You can restore it later. No new ${T.saleUnits.toLowerCase()} can be added while it is archived.`,
      confirmText: "Archive",
    })) return;
    setBusyId(row._id);
    try {
      await saleApi.archiveProject(row._id, archive);
      await invalidate();
      toast.success(`${T.saleProject} ${archive ? "archived" : "restored"}`);
    } catch (err) {
      toast.error(errorMessage(err, `Failed to update ${T.saleProject.toLowerCase()}`));
    } finally {
      setBusyId("");
    }
  }, [confirm, invalidate, T.saleProject, T.saleUnits]);

  const handleDelete = useCallback(async (row) => {
    const count = row.units?.total || 0;
    const message = count
      ? `Delete "${row.name}" and its ${count} ${T.saleUnits.toLowerCase()}? This cannot be undone.`
      : `Delete "${row.name}"?`;
    if (!await confirm({ title: `Delete ${T.saleProject}`, message, confirmText: "Delete", isDangerous: true })) return;
    setBusyId(row._id);
    try {
      await saleApi.deleteProject(row._id);
      await invalidate();
      toast.success(`${T.saleProject} deleted`);
    } catch (err) {
      toast.error(errorMessage(err, `Cannot delete this ${T.saleProject.toLowerCase()}`));
    } finally {
      setBusyId("");
    }
  }, [confirm, invalidate, T.saleProject, T.saleUnits]);

  const renderProjectActions = useCallback((row) => (
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={() => openProject(row)} className={actionBtn}>
        <FaExternalLinkAlt className="text-[9px]" /> Open
      </button>
      <button type="button" onClick={() => setFormModal({ project: row })} className={actionBtn}>
        <FaEdit className="text-[9px]" /> Edit
      </button>
      <button type="button" disabled={busyId === row._id} onClick={() => handleArchive(row)} className={`${actionBtn} disabled:opacity-50`}>
        {row.status === "archived" ? <><FaUndo className="text-[9px]" /> Restore</> : <><FaArchive className="text-[9px]" /> Archive</>}
      </button>
      <button type="button" disabled={busyId === row._id} onClick={() => handleDelete(row)} className="border border-red-200 bg-white px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">
        <FaTrash className="text-[9px]" />
      </button>
    </div>
  ), [busyId, handleArchive, handleDelete, openProject]);

  const resetFilters = () => { setSearch(""); setStatusFilt(DEFAULT_STATUS); setPage(1); };
  const activeCount = [search, statusFilt !== DEFAULT_STATUS].filter(Boolean).length;
  const showIntro = !loading && projects.length === 0 && !debouncedSearch && statusFilt !== "archived";

  return (
    <PropertySaleShell>
      <SaleFilterBar
        leading={<span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{total} {(total === 1 ? T.saleProject : T.saleProjects).toLowerCase()}</span>}
        onReset={resetFilters}
        activeCount={activeCount}
        trailing={
          <>
            <SalePrintButton onClick={printReport} busy={printing} disabled={loading || total === 0} />
            <button
              type="button"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-projects", biz] })}
              className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
            >
              <FaRedoAlt size={9} className={isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              type="button"
              onClick={() => setFormModal({ project: null })}
              className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]"
            >
              <FaPlus size={9} /> New {T.saleProject}
            </button>
          </>
        }
      >
        <FilterSearch
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder={`Search ${T.saleProjects.toLowerCase()}...`}
        />
        <AppSelect value={statusFilt} onChange={(v) => { setStatusFilt(v ?? ""); setPage(1); }} options={STATUS_OPTIONS} placeholder="All Statuses" clearable size="sm" />
      </SaleFilterBar>

      <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden border border-slate-200 bg-white shadow-sm">
        {showIntro ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <FaLayerGroup size={30} className="text-[#0B3B2E]/30" />
            <div className="text-sm font-extrabold text-slate-800">No {T.saleProjects.toLowerCase()} yet</div>
            <p className="max-w-md text-xs leading-relaxed text-slate-500">
              A {T.saleProject.toLowerCase()} groups many {T.saleUnits.toLowerCase()} that are sold one by one, such as the plots of an estate or the
              flats of a development. Create one, generate its {T.saleUnits.toLowerCase()} in bulk, then track how quickly they sell.
            </p>
            <button
              type="button"
              onClick={() => setFormModal({ project: null })}
              className="mt-1 inline-flex items-center gap-1 bg-[#0B3B2E] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#0A3127]"
            >
              <FaPlus size={9} /> New {T.saleProject}
            </button>
          </div>
        ) : (
          <>
            <MilikTable
              columns={PROJECT_TABLE_COLS}
              rows={projects}
              loading={loading}
              empty={`No ${T.saleProjects.toLowerCase()} match these filters.`}
              minWidth={900}
              onRowClick={handleRowClick}
              isSelected={isRowSelected}
              renderRow={renderProjectRow}
              renderActions={renderProjectActions}
            />
            <PaginationBar page={page} pages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} label={T.saleProjects.toLowerCase()} />
          </>
        )}
      </div>

      {/* Dismiss overlay — clicking outside the panel closes it */}
      {selected && <div className="absolute inset-0 z-[5]" onClick={() => setSelectedId(null)} />}
      {selected && (
        <SaleProjectPanel
          project={selected}
          onClose={() => setSelectedId(null)}
          onOpen={openProject}
          onEdit={editProject}
          onChanged={invalidate}
        />
      )}
      </div>

      {formModal && (
        <SaleProjectFormModal
          project={formModal.project}
          onSaved={invalidate}
          onClose={() => setFormModal(null)}
        />
      )}
    </PropertySaleShell>
  );
};

export default SaleProjects;

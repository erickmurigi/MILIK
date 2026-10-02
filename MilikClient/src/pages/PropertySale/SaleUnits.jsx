import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { FaEdit, FaRedoAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch } from "./SaleFilterBar";
import ListToolbar from "../../components/common/ListToolbar";
import SaleListingFormModal from "./SaleListingFormModal";
import SaleListingAgent from "./SaleListingAgent";
import SaleListingPanel from "./SaleListingPanel";
import { printSaleListing } from "../../utils/printSaleListing";
import { listingAgentText } from "../../utils/saleAgent";
import { errorMessage } from "./SaleProjectShared";
import { LISTING_STATUS_MAP, UNIT_STATUSES, STATUS_LABEL } from "../../utils/saleListingConstants";
import useSaleFormOptions from "../../hooks/useSaleFormOptions";
import PaginationBar from "../../components/PaginationBar";
import AppSelect from "../../components/common/AppSelect";
import StatusBadge from "../../components/common/StatusBadge";
import MilikTable from "../../components/common/MilikTable";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { customFieldRows, listingFormFromRow, typeDefOf } from "../../utils/saleListingForm";
import useDebounce from "../../hooks/useDebounce";
import { useTerms } from "../../hooks/useTerm";
import { useTabState } from "../../hooks/useTabState";

const PAGE_SIZE = 50;

const STATUS_OPTIONS = UNIT_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }));

// Stats strip: the statuses shown in the toolbar, with their text tone
const STAT_TONES = [
  { key: "available",      tone: "text-emerald-700" },
  { key: "reserved",       tone: "text-amber-700" },
  { key: "under_contract", tone: "text-[#0B3B2E]" },
  { key: "sold",           tone: "text-slate-700" },
];

const unitTableCols = (T) => [
  { label: `${T.saleUnit} No.` },
  { label: T.saleProject },
  { label: "Block" },
  { label: "Type" },
  { label: "Size" },
  { label: "Asking Price", align: "right" },
  { label: T.saleAgent },
  { label: "Status" },
];

// The link must not select the row underneath it
const stopRowClick = (e) => e.stopPropagation();

// Module scope so MilikTable's React.memo isn't defeated by a fresh function identity each parent render.
const renderUnitRow = (row) => (
  <>
    <td className="px-3 py-1.5 font-mono font-bold text-[#0B3B2E] border-r border-gray-100">{row.unitNumber || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 max-w-[180px]">
      {row.project?._id ? (
        <Link
          to={`/sale/projects/${row.project._id}`}
          onClick={stopRowClick}
          className="block truncate font-semibold text-[#0B3B2E] hover:underline"
        >
          {row.project.name}
        </Link>
      ) : "—"}
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.block || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100">
      <span className="capitalize text-slate-500">{(row.propertyType || "—").replace(/_/g, " ")}</span>
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600 whitespace-nowrap">
      {row.size ? `${row.size} ${row.sizeUnit ?? ""}`.trim() : "—"}
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold tabular-nums text-slate-900">{fmtKES(row.askingPrice)}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">
      <SaleListingAgent row={row} />
    </td>
    <td className="px-3 py-1.5">
      <StatusBadge status={row.status} map={LISTING_STATUS_MAP} />
    </td>
  </>
);

const SaleUnits = () => {
  const T = useTerms("saleListing", "saleProject", "saleProjects", "saleUnit", "saleUnits", "saleAgent", "saleAgents");
  const UNIT_TABLE_COLS = useMemo(() => unitTableCols(T), [T]);
  const queryClient = useQueryClient();
  const navigate    = useNavigate();
  const biz         = useSelector((s) => s.company?.currentCompany?._id);

  const [search,      setSearch]      = useTabState("/sale/units:search", "");
  const [projectFilt, setProjectFilt] = useTabState("/sale/units:projectFilt", "");
  const [statusFilt,  setStatusFilt]  = useTabState("/sale/units:statusFilt", "");
  const [blockFilt,   setBlockFilt]   = useTabState("/sale/units:blockFilt", "");
  const [agentFilt,   setAgentFilt]   = useTabState("/sale/units:agentFilt", "");
  const [page,        setPage]        = useTabState("/sale/units:page", 1);
  const [pageSize,    setPageSize]    = useTabState("/sale/units:pageSize", PAGE_SIZE);
  const [selected,    setSelected]    = useTabState("/sale/units:selected", null);
  const [unitModal,   setUnitModal]   = useState(null); // { editingId, initial, project } while the edit modal is open
  const [statusBusy,  setStatusBusy]  = useState({});   // { [unitId]: true } while a Reserve/Release call is in flight
  const statusInFlight = useRef(new Set());

  const debouncedSearch = useDebounce(search, 400);
  const debouncedBlock  = useDebounce(blockFilt, 400);

  const { data: unitsData, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-listings", biz, "units", debouncedSearch, projectFilt, statusFilt, debouncedBlock, agentFilt, page, pageSize],
    queryFn: () => saleApi.listListings({
      project: projectFilt ? undefined : "any",
      projectId: projectFilt || undefined,
      status: statusFilt || undefined,
      block: (projectFilt && debouncedBlock) || undefined,
      search: debouncedSearch || undefined,
      agentId: agentFilt || undefined,
      page,
      limit: pageSize,
    }),
    enabled: !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  const { data: projectsData } = useQuery({
    queryKey: ["sale-projects-ref", biz, "unit-filter"],
    queryFn: () => saleApi.listProjects({ limit: 200 }),
    enabled: !!biz,
    staleTime: 5 * 60_000,
  });

  const { propertyTypeOptions, propertyTypeDefs, agentFormOptions, agentFilterOptions } = useSaleFormOptions(biz);

  const units      = useMemo(() => unitsData?.data ?? [], [unitsData?.data]);
  const total      = unitsData?.total ?? 0;
  const stats      = unitsData?.stats;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const projectOptions     = useMemo(() => (projectsData?.data ?? []).map((p) => ({ value: p._id, label: p.name })), [projectsData]);

  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const printListing = useCallback((row) => printSaleListing(row, { company: currentCompany, T, typeDef: typeDefOf(propertyTypeDefs, row) }), [currentCompany, T, propertyTypeDefs]);

  // sync panel with fresh data after mutations
  useEffect(() => {
    if (!selected) return;
    const updated = units.find((u) => u._id === selected._id);
    if (updated) setSelected(updated);
  }, [units]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-listings-ref", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-projects", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-project", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-project-units", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] }),
  ]), [queryClient, biz]);

  const openEdit = useCallback((row) => {
    setUnitModal({ editingId: row._id, initial: listingFormFromRow(row), project: row.project || null });
  }, []);

  const handleStatusChange = useCallback(async (row, status) => {
    if (statusInFlight.current.has(row._id)) return;
    statusInFlight.current.add(row._id);
    setStatusBusy((m) => ({ ...m, [row._id]: true }));
    try {
      await saleApi.updateListingStatus(row._id, status);
      await invalidate();
      toast.success(`${T.saleUnit} marked ${status.replace(/_/g, " ")}`);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update status"));
    } finally {
      statusInFlight.current.delete(row._id);
      setStatusBusy((m) => { const { [row._id]: _done, ...rest } = m; return rest; });
    }
  }, [invalidate, T.saleUnit]);

  const handleRowClick = useCallback((row) => setSelected((prev) => (prev?._id === row._id ? null : row)), [setSelected]);
  const selectedId = selected?._id;
  const isRowSelected = useCallback((row) => selectedId === row._id, [selectedId]);

  const renderUnitActions = useCallback((row) => (
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
        <FaEdit className="text-[9px]" /> Edit
      </button>
      {row.status === "available" && (
        <button type="button" disabled={!!statusBusy[row._id]} onClick={() => handleStatusChange(row, "reserved")} className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed">
          Reserve
        </button>
      )}
      {row.status === "reserved" && (
        <button type="button" disabled={!!statusBusy[row._id]} onClick={() => handleStatusChange(row, "available")} className="border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed">
          Release
        </button>
      )}
    </div>
  ), [openEdit, statusBusy, handleStatusChange]);

  const emptyState = useMemo(() => (
    <span>
      No {T.saleUnits.toLowerCase()} found. {T.saleUnits} are added from a{" "}
      <Link to="/sale/projects" className="font-bold text-[#0B3B2E] hover:underline">{T.saleProject.toLowerCase()} page</Link>.
    </span>
  ), [T.saleUnits, T.saleProject]);

  const statsStrip = useMemo(() => (
    <div className="flex shrink-0 items-baseline gap-2">
      <span className="font-mono text-[9px] font-black text-slate-500">{total} {(total === 1 ? T.saleUnit : T.saleUnits).toLowerCase()}</span>
      {STAT_TONES.map(({ key, tone }) => (
        <div key={key} className="flex shrink-0 items-baseline gap-1">
          <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">{STATUS_LABEL[key]}</span>
          <span className={`font-mono text-[10px] font-black tabular-nums ${tone}`}>{stats?.[key]?.count ?? 0}</span>
          <span className="text-[9px] text-slate-400">{fmtKES(stats?.[key]?.totalValue ?? 0)}</span>
        </div>
      ))}
    </div>
  ), [total, stats, T.saleUnit, T.saleUnits]);

  const resetFilters = () => { setSearch(""); setProjectFilt(""); setStatusFilt(""); setBlockFilt(""); setAgentFilt(""); setPage(1); };

  return (
    <PropertySaleShell>
      <SaleFilterBar
        leading={statsStrip}
        onReset={resetFilters}
        activeCount={[search, projectFilt, statusFilt, blockFilt, agentFilt].filter(Boolean).length}
        trailing={
          <ListToolbar.Button
            variant="outline"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] })}
          >
            <FaRedoAlt size={7} className={isFetching ? "animate-spin" : ""} /> Refresh
          </ListToolbar.Button>
        }
      >
        <FilterSearch
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder={`Search ${T.saleUnits.toLowerCase()}...`}
        />
        <AppSelect
          value={projectFilt}
          onChange={(v) => { setProjectFilt(v ?? ""); setBlockFilt(""); setPage(1); }}
          options={projectOptions}
          placeholder={`All ${T.saleProjects}`}
          clearable compact searchable
        />
        <AppSelect value={statusFilt} onChange={(v) => { setStatusFilt(v ?? ""); setPage(1); }} options={STATUS_OPTIONS} placeholder="All Statuses" clearable compact />
        <ListToolbar.Input
          width="w-[90px]"
          value={blockFilt}
          disabled={!projectFilt}
          onChange={(e) => { setBlockFilt(e.target.value); setPage(1); }}
          placeholder="Block"
          title={projectFilt ? undefined : `Choose a ${T.saleProject.toLowerCase()} to filter by block`}
          className="disabled:cursor-not-allowed disabled:bg-slate-50"
        />
        <AppSelect value={agentFilt} onChange={(v) => { setAgentFilt(v ?? ""); setPage(1); }} options={agentFilterOptions} placeholder={`All ${T.saleAgents}`} clearable compact searchable />
      </SaleFilterBar>

      {/* Table + detail panel */}
      <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className={`flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm transition-[margin] duration-200 ${selected ? "mr-[360px]" : ""}`}>
          <MilikTable
            columns={UNIT_TABLE_COLS}
            rows={units}
            loading={loading}
            empty={emptyState}
            minWidth={820}
            onRowClick={handleRowClick}
            isSelected={isRowSelected}
            renderRow={renderUnitRow}
            renderActions={renderUnitActions}
          />

          <PaginationBar page={page} pages={totalPages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} />
        </div>

        {/* Dismiss overlay — clicking outside the panel closes it */}
        {selected && (
          <div className="absolute inset-0 z-[5]" onClick={() => setSelected(null)} />
        )}

        {selected && (
          <SaleListingPanel
            row={selected}
            detailsTitle={`${T.saleUnit} Details`}
            detailRows={[
              [`${T.saleUnit} No.`, selected.unitNumber],
              [T.saleProject, selected.project?._id ? (
                <button key="project" type="button" onClick={() => navigate(`/sale/projects/${selected.project._id}`)} className="font-semibold text-[#0B3B2E] hover:underline text-left">
                  {selected.project.name}
                </button>
              ) : null],
              ["Block", selected.block],
              ["Type", String(selected.propertyType || "").replace(/_/g, " ")],
              ["Price", fmtKES(selected.askingPrice)],
              ["Size", selected.size ? `${selected.size} ${selected.sizeUnit ?? ""}`.trim() : null],
              ["Location", [selected.town, selected.county].filter(Boolean).join(", ") || selected.location],
              [T.saleAgent, listingAgentText(selected, T.saleProject.toLowerCase())],
              ...customFieldRows(selected, typeDefOf(propertyTypeDefs, selected).fields),
            ]}
            editLabel={`Edit ${T.saleUnit}`}
            onClose={() => setSelected(null)}
            onEdit={openEdit}
            onPrint={printListing}
            onChanged={invalidate}
            statusBusy={statusBusy}
            onStatusChange={handleStatusChange}
            emptyHint={`Upload photos to showcase this ${T.saleUnit.toLowerCase()} to buyers`}
          />
        )}
      </div>

      {unitModal && (
        <SaleListingFormModal
          project={unitModal.project}
          initialEditingId={unitModal.editingId}
          initialForm={unitModal.initial}
          listings={units}
          biz={biz}
          propertyTypeOptions={propertyTypeOptions}
          agentFormOptions={agentFormOptions}
          invalidate={invalidate}
          onClose={() => setUnitModal(null)}
        />
      )}
    </PropertySaleShell>
  );
};

export default SaleUnits;

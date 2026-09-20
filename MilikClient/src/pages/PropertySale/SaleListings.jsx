import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import {
  FaCamera, FaChevronLeft, FaChevronRight,
  FaEdit, FaFileImport, FaPlus, FaPrint, FaRedoAlt,
  FaTimes, FaTrash,
} from "react-icons/fa";
import ImportModal from "../../components/Modals/ImportModal";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTerms } from "../../hooks/useTerm";
import { useTabState } from "../../hooks/useTabState";
import AmountInput from "./AmountInput";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";
import StatusBadge from "../../components/common/StatusBadge";
import MilikTable from "../../components/common/MilikTable";
import SaleListingFormModal from "./SaleListingFormModal";
import SaleListingPanel from "./SaleListingPanel";
import { printSaleListing } from "../../utils/printSaleListing";
import { LISTING_STATUS_MAP } from "../../utils/saleListingConstants";
import useSaleFormOptions from "../../hooks/useSaleFormOptions";
import SaleListingAgent from "./SaleListingAgent";
import { listingAgentText } from "../../utils/saleAgent";
import { blankListingForm, customFieldRows, listingFormFromRow, typeDefOf } from "../../utils/saleListingForm";

// Lazy-load the xlsx-backed helpers only when the Import modal is actually used.
const parseSaleListingsExcel = (file) => import("../../utils/excelTemplates").then((m) => m.parseSaleListingsExcel(file));
const downloadSaleListingsTemplate = () => import("../../utils/excelTemplates").then((m) => m.downloadSaleListingsTemplate());


const STATUSES       = ["available", "reserved", "under_contract", "sold", "withdrawn"];
const PAGE_SIZE      = 50;

const STATUS_OPTIONS    = STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }));

const listingTableCols = (T, withProject) => [
  { label: `${T.saleListing} No.` },
  { label: "Title" },
  ...(withProject ? [{ label: `${T.saleProject} / ${T.saleUnit}` }] : []),
  { label: "Type" },
  { label: "Location" },
  { label: "Asking Price", align: "right" },
  { label: T.saleAgent },
  { label: "Status" },
];


// Module scope so MilikTable's React.memo isn't defeated by a fresh function identity each parent render.
const renderListingHead = (row) => (
  <>
    <td className="px-3 py-1.5 font-mono font-bold text-[#0B3B2E] border-r border-gray-100">{row.listingNumber}</td>
    <td className="px-3 py-1.5 border-r border-gray-100">
      <div className="flex items-center gap-1.5 max-w-[200px]">
        <span className="truncate font-semibold text-slate-900">{row.title}</span>
        {row.images?.length > 0 && (
          <span className="flex-shrink-0 inline-flex items-center gap-0.5 border border-[#B7C9C0] bg-[#F1F6F3] px-1 py-0 text-[9px] font-bold text-[#0B3B2E]">
            <FaCamera size={7} /> {row.images.length}
          </span>
        )}
      </div>
    </td>
  </>
);

const renderListingTail = (row) => (
  <>
    <td className="px-3 py-1.5 border-r border-gray-100">
      <span className="capitalize text-slate-500">{(row.propertyType || "—").replace(/_/g, " ")}</span>
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600 max-w-[140px] truncate">
      {[row.town, row.county].filter(Boolean).join(", ") || row.location || "—"}
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

// The link must not select the row underneath it
const stopRowClick = (e) => e.stopPropagation();

const renderListingRow = (row) => <>{renderListingHead(row)}{renderListingTail(row)}</>;

// Same row with a Project / Unit cell (companies that sell in projects)
const renderListingRowWithProject = (row) => (
  <>
    {renderListingHead(row)}
    <td className="px-3 py-1.5 border-r border-gray-100 max-w-[180px]">
      {row.project?._id ? (
        <Link
          to={`/sale/projects/${row.project._id}`}
          onClick={stopRowClick}
          className="block truncate font-semibold text-[#0B3B2E] hover:underline"
        >
          {row.project.name}{row.unitNumber ? ` · ${row.unitNumber}` : ""}
        </Link>
      ) : <span className="text-slate-300">—</span>}
    </td>
    {renderListingTail(row)}
  </>
);


const SaleListings = () => {
  const T = useTerms("saleListing", "saleListings", "saleAgent", "saleAgents", "saleUnit", "saleProject", "saleProjects");
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);

  const [listingModal,   setListingModal]   = useState(null);   // { editingId, initial } while the create/edit modal is open
  const [showImportModal, setShowImportModal] = useState(false);
  const [search,     setSearch]     = useTabState("/sale/listings:search", "");
  const [statusFilt, setStatusFilt] = useTabState("/sale/listings:statusFilt", "");
  const [typeFilt,   setTypeFilt]   = useTabState("/sale/listings:typeFilt", "");
  const [scopeFilt,  setScopeFilt]  = useTabState("/sale/listings:scopeFilt", ""); // "" all | "none" standalone | "any" in a project
  const [agentFilt,  setAgentFilt]  = useTabState("/sale/listings:agentFilt", "");
  const [page,       setPage]       = useTabState("/sale/listings:page", 1);
  const [pageSize,   setPageSize]   = useTabState("/sale/listings:pageSize", PAGE_SIZE);
  const [selected,   setSelected]   = useTabState("/sale/listings:selected", null);
  const [statusBusy, setStatusBusy] = useState({}); // { [listingId]: true } while a Reserve/Release call is in flight
  const statusInFlight = useRef(new Set());

  const debouncedSearch = useDebounce(search, 400);
  const biz = currentCompany?._id;

  const { saleSettings, propertyTypeOptions: PROPERTY_TYPE_OPTIONS, propertyTypeDefs, agentFormOptions, agentFilterOptions } = useSaleFormOptions(biz);

  // Companies that sell in projects see units in this list too (with a Project / Unit column) and can narrow it
  const usesProjects = !!saleSettings?.useProjects;
  const scope = usesProjects ? scopeFilt : "";
  const LISTING_TABLE_COLS = useMemo(() => listingTableCols(T, usesProjects), [T, usesProjects]);
  const SCOPE_OPTIONS = useMemo(() => [
    { value: "none", label: "Standalone only" },
    { value: "any", label: `In ${T.saleProjects.toLowerCase()} only` },
  ], [T.saleProjects]);

  const { data: listingsData, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-listings", biz, debouncedSearch, statusFilt, typeFilt, agentFilt, page, pageSize, scope],
    queryFn:  () => saleApi.listListings({ business: biz, search: debouncedSearch, status: statusFilt, propertyType: typeFilt, agentId: agentFilt, page, limit: pageSize, ...(scope && { project: scope }) }),
    enabled:  !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  const listings   = useMemo(() => listingsData?.data ?? [], [listingsData?.data]);
  const total      = listingsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));


  // sync panel with fresh data after mutations
  useEffect(() => {
    if (!selected) return;
    const updated = listings.find((l) => l._id === selected._id);
    if (updated) setSelected(updated);
  }, [listings]); // eslint-disable-line react-hooks/exhaustive-deps


  const invalidate = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-listings-ref", biz] }),
    queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] }),
  ]), [queryClient, biz]);

  const openCreate = () => {
    const firstType = PROPERTY_TYPE_OPTIONS[0]?.value ?? "plot";
    setListingModal({ editingId: "", initial: blankListingForm(firstType) });
  };
  const openEdit = useCallback((row) => {
    setListingModal({ editingId: row._id, initial: listingFormFromRow(row), project: row.project || null });
  }, []);

  const handleDelete = useCallback(async (row) => {
    if (!await confirm({ title: `Delete ${T.saleListing}`, message: `Delete "${row.title}"?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      await saleApi.deleteListing(row._id);
      setSelected((prev) => (prev?._id === row._id ? null : prev));
      await invalidate();
      toast.success(`${T.saleListing} deleted`);
    } catch (err) {
      toast.error(err?.response?.data?.message || `Cannot delete this ${T.saleListing.toLowerCase()}`);
    }
  }, [confirm, invalidate, setSelected, T.saleListing]);

  const handleStatusChange = useCallback(async (row, status) => {
    if (statusInFlight.current.has(row._id)) return;
    statusInFlight.current.add(row._id);
    setStatusBusy((m) => ({ ...m, [row._id]: true }));
    try {
      await saleApi.updateListingStatus(row._id, status);
      await invalidate();
      toast.success(`${T.saleListing} marked ${status.replace(/_/g, " ")}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update status");
    } finally {
      statusInFlight.current.delete(row._id);
      setStatusBusy((m) => { const { [row._id]: _done, ...rest } = m; return rest; });
    }
  }, [invalidate, T.saleListing]);

  const printListing = useCallback((row) => printSaleListing(row, { company: currentCompany, T, typeDef: typeDefOf(propertyTypeDefs, row) }), [currentCompany, T, propertyTypeDefs]);

  const handleRowClick = useCallback((row) => setSelected((prev) => (prev?._id === row._id ? null : row)), [setSelected]);
  const selectedId = selected?._id;
  const isRowSelected = useCallback((row) => selectedId === row._id, [selectedId]);

  const renderListingActions = useCallback((row) => (
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={() => printListing(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
        <FaPrint className="text-[9px]" /> Print
      </button>
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
      <button type="button" onClick={() => handleDelete(row)} className="border border-red-200 bg-white px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-50">
        <FaTrash className="text-[9px]" />
      </button>
    </div>
  ), [printListing, openEdit, statusBusy, handleStatusChange, handleDelete]);

  const resetFilters = () => { setSearch(""); setStatusFilt(""); setTypeFilt(""); setAgentFilt(""); setScopeFilt(""); setPage(1); };

  return (
    <PropertySaleShell>
      {/* Filter bar */}
      <SaleFilterBar
        leading={<span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{total} listing{total !== 1 ? "s" : ""}</span>}
        onReset={resetFilters}
        activeCount={[search, statusFilt, typeFilt, agentFilt, scope].filter(Boolean).length}
        trailing={
          <>
            <button
              type="button"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] })}
              className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
            >
              <FaRedoAlt size={9} className={isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
            >
              <FaFileImport size={9} /> Import
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
            >
              <FaPlus size={9} /> New {T.saleListing}
            </button>
          </>
        }
      >
        <FilterSearch
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder={`Search ${T.saleListings.toLowerCase()}...`}
        />
        <AppSelect value={statusFilt} onChange={(v) => { setStatusFilt(v ?? ""); setPage(1); }} options={STATUS_OPTIONS} placeholder="All Statuses" clearable size="sm" />
        <AppSelect value={typeFilt} onChange={(v) => { setTypeFilt(v ?? ""); setPage(1); }} options={PROPERTY_TYPE_OPTIONS} placeholder="All Types" clearable size="sm" />
        <AppSelect value={agentFilt} onChange={(v) => { setAgentFilt(v ?? ""); setPage(1); }} options={agentFilterOptions} placeholder={`All ${T.saleAgents}`} clearable size="sm" searchable />
        {usesProjects && (
          <AppSelect value={scopeFilt} onChange={(v) => { setScopeFilt(v ?? ""); setPage(1); }} options={SCOPE_OPTIONS} placeholder="All items" clearable size="sm" />
        )}
      </SaleFilterBar>

      {/* Table + images panel */}
      <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className={`flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm transition-[margin] duration-200 ${selected ? "mr-[360px]" : ""}`}>
          <MilikTable
            columns={LISTING_TABLE_COLS}
            rows={listings}
            loading={loading}
            empty={`No ${T.saleListings.toLowerCase()} found. Create your first ${T.saleListing.toLowerCase()}.`}
            minWidth={720}
            onRowClick={handleRowClick}
            isSelected={isRowSelected}
            renderRow={usesProjects ? renderListingRowWithProject : renderListingRow}
            renderActions={renderListingActions}
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
            detailsTitle="Property Details"
            detailRows={[
              ["Type", String(selected.propertyType || "").replace(/_/g, " ")],
              ["Price", fmtKES(selected.askingPrice)],
              ["Size", selected.size ? `${selected.size} ${selected.sizeUnit}` : null],
              ["Location", [selected.town, selected.county].filter(Boolean).join(", ") || selected.location],
              [T.saleAgent, listingAgentText(selected, T.saleProject.toLowerCase())],
              ...customFieldRows(selected, typeDefOf(propertyTypeDefs, selected).fields),
            ]}
            editLabel={`Edit ${T.saleListing}`}
            onClose={() => setSelected(null)}
            onEdit={openEdit}
            onPrint={printListing}
            onChanged={invalidate}
          />
        )}
      </div>

      {/* Create/Edit Modal */}
      {listingModal && (
        <SaleListingFormModal
          project={listingModal.project || null}
          initialEditingId={listingModal.editingId}
          initialForm={listingModal.initial}
          listings={listings}
          biz={biz}
          propertyTypeOptions={PROPERTY_TYPE_OPTIONS}
          agentFormOptions={agentFormOptions}
          invalidate={invalidate}
          onClose={() => setListingModal(null)}
        />
      )}

      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        title={`Import ${T.saleListings}`}
        entityName={T.saleListing.toLowerCase()}
        parseFile={parseSaleListingsExcel}
        downloadTemplate={downloadSaleListingsTemplate}
        onImport={async (rows) => {
          const res = await saleApi.bulkImportListings(rows);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["sale-listings", biz] }),
            queryClient.invalidateQueries({ queryKey: ["sale-listings-ref", biz] }),
          ]);
          return res;
        }}
        previewCols={[
          { header: "Title",        render: (r) => <span className="font-semibold">{r.title}</span> },
          { header: "Type",         render: (r) => r.propertyType },
          { header: "Location",     render: (r) => [r.town, r.county].filter(Boolean).join(", ") || "—" },
          { header: "Asking Price", render: (r) => <span className="font-mono">{Number(r.askingPrice).toLocaleString()}</span> },
          { header: "Status",       render: (r) => r.status },
        ]}
      />
    </PropertySaleShell>
  );
};

export default SaleListings;

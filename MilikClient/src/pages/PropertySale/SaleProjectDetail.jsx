import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { Link, useParams } from "react-router-dom";
import {
  FaArchive, FaArrowLeft, FaBorderAll, FaEdit, FaLayerGroup, FaListUl,
  FaMagic, FaPlus, FaRedoAlt, FaSyncAlt, FaTags, FaUndo,
} from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import { FilterSearch } from "./SaleFilterBar";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";
import Spinner from "../../components/common/Spinner";
import StatusBadge from "../../components/common/StatusBadge";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import { useTerms } from "../../hooks/useTerm";
import { blankListingForm, listingFormFromRow } from "../../utils/saleListingForm";
import SaleListingFormModal from "./SaleListingFormModal";
import SaleProjectFormModal from "./SaleProjectFormModal";
import SaleGenerateUnitsModal from "./SaleGenerateUnitsModal";
import SaleBulkPriceModal from "./SaleBulkPriceModal";
import SaleAssignListingsModal from "./SaleAssignListingsModal";
import SaleProjectUnitGrid from "./SaleProjectUnitGrid";
import SaleProjectUnitPanel from "./SaleProjectUnitPanel";
import SaleProjectPerformance from "./SaleProjectPerformance";
import SalePhotoGallery from "./SalePhotoGallery";
import SaleListingAgent from "./SaleListingAgent";
import SaleProjectProgressBar from "./SaleProjectProgressBar";
import { PROJECT_STATUS_MAP, STATUS_SWATCH, errorMessage, fmtPct, useProjectInvalidate } from "./SaleProjectShared";
import { LISTING_STATUS_MAP, STATUS_LABEL, UNIT_STATUSES } from "../../utils/saleListingConstants";
import useSaleFormOptions from "../../hooks/useSaleFormOptions";

const TERM_KEYS = ["saleProject", "saleProjects", "saleUnit", "saleUnits", "saleListing", "saleListings", "saleAgent", "saleAgents", "saleDeal", "saleDeals", "saleOffers"];

const unitTableCols = (T) => [
  { label: `${T.saleUnit} No.` },
  { label: "Block" },
  { label: "Type" },
  { label: "Size" },
  { label: "Asking Price", align: "right" },
  { label: T.saleAgent },
  { label: "Status" },
];

// Module scope so MilikTable's React.memo isn't defeated by a fresh function identity each parent render.
const renderUnitRow = (row) => (
  <>
    <td className="px-3 py-1.5 font-mono font-bold text-[#0B3B2E] border-r border-gray-100">{row.unitNumber || row.listingNumber}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.block || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100"><span className="capitalize text-slate-500">{(row.propertyType || "—").replace(/_/g, " ")}</span></td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.size ? `${row.size} ${row.sizeUnit || ""}` : "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-bold tabular-nums text-slate-900">{fmtKES(row.askingPrice)}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600"><SaleListingAgent row={row} /></td>
    <td className="px-3 py-1.5"><StatusBadge status={row.status} map={LISTING_STATUS_MAP} /></td>
  </>
);

const Kpi = ({ label, value, sub, tone = "" }) => (
  <div className="min-w-0 border border-slate-200 bg-white px-3 py-1.5">
    <div className="truncate text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</div>
    <div className={`truncate text-sm font-black tabular-nums ${tone || "text-slate-900"}`}>{value}</div>
    {sub && <div className="truncate text-[10px] text-slate-400">{sub}</div>}
  </div>
);

const TargetBar = ({ label, actual, target, format }) => {
  const pct = target > 0 ? Math.min(100, (actual / target) * 100) : 0;
  return (
    <div className="min-w-[200px] flex-1">
      <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[10px] font-semibold text-slate-500">
        <span>{label}</span>
        <span className="tabular-nums">{format(actual)} of {format(target)} ({Math.round((actual / target) * 100)}%)</span>
      </div>
      <div className="h-1.5 bg-slate-100"><div className="h-full bg-[#0B3B2E]" style={{ width: `${pct}%` }} /></div>
    </div>
  );
};

const btn = "inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50 disabled:cursor-not-allowed";
const btnPrimary = "inline-flex items-center gap-1 bg-[#0B3B2E] px-3 py-1 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-50 disabled:cursor-not-allowed";

const SaleProjectDetail = () => {
  const { id } = useParams();
  const T = useTerms(...TERM_KEYS);
  const UNIT_COLS = useMemo(() => unitTableCols(T), [T]);
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const biz = useSelector((s) => s.company?.currentCompany?._id);
  const invalidate = useProjectInvalidate(biz, id);
  const { propertyTypeOptions, agentFormOptions } = useSaleFormOptions(biz);

  const [tab, setTab] = useState("units");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [view, setView] = useState("grid");
  const [statusFilt, setStatusFilt] = useState("");
  const [blockFilt, setBlockFilt] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null); // "project" | "generate" | "bulk" | "assign"
  const [unitModal, setUnitModal] = useState(null); // { editingId, initial } while the create/edit unit modal is open
  const [busy, setBusy] = useState(false);

  const { data: project, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["sale-project", biz, id],
    queryFn: () => saleApi.getProject(id),
    enabled: !!biz && !!id,
    staleTime: 30_000,
    retry: (count, err) => err?.response?.status !== 404 && count < 1,
  });

  const { data: unitsData, isLoading: unitsLoading } = useQuery({
    queryKey: ["sale-project-units", biz, id],
    queryFn: () => saleApi.listProjectUnits(id),
    enabled: !!biz && !!id,
    staleTime: 30_000,
    retry: (count, err) => err?.response?.status !== 404 && count < 1,
  });
  const units = useMemo(() => unitsData?.data ?? [], [unitsData?.data]);

  // Full record of the unit being edited: the list omits fields (notes, title deed no., photos) the form needs
  const editingId = unitModal?.editingId;
  const { data: editRow } = useQuery({
    queryKey: ["sale-listings", biz, "one", editingId],
    queryFn: () => saleApi.getListing(editingId),
    enabled: !!biz && !!editingId,
    staleTime: 30_000,
  });
  const formListings = useMemo(() => (editRow ? [editRow] : units), [editRow, units]);

  const blockOptions = useMemo(() => [...new Set(units.map((u) => u.block).filter(Boolean))].map((b) => ({ value: b, label: b })), [units]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return units.filter((u) => (
      (!statusFilt || u.status === statusFilt)
      && (!blockFilt || u.block === blockFilt)
      && (!q || `${u.unitNumber} ${u.title} ${u.listingNumber}`.toLowerCase().includes(q))
    ));
  }, [units, statusFilt, blockFilt, search]);

  const selected = useMemo(() => (selectedId ? units.find((u) => u._id === selectedId) || null : null), [units, selectedId]);
  const isSelected = useCallback((row) => row._id === selectedId, [selectedId]);
  const handleSelect = useCallback((uid) => setSelectedId((prev) => (prev === uid ? null : uid)), []);
  const handleRowClick = useCallback((row) => setSelectedId((prev) => (prev === row._id ? null : row._id)), []);
  const closeModal = useCallback(() => setModal(null), []);

  const archived = project?.status === "archived";
  // assignedAgent lets the unit form show "Inherited: <agent>" as its placeholder
  const projectRef = useMemo(() => (project ? { _id: project._id, name: project.name, assignedAgent: project.assignedAgent || null } : null), [project]);

  const handleUploadPhotos = async (files) => {
    setPhotoBusy(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("images", f));
      await saleApi.uploadProjectImages(id, fd);
      await invalidate();
      toast.success(`${files.length} photo${files.length > 1 ? "s" : ""} uploaded`);
    } catch (err) {
      toast.error(errorMessage(err, "Upload failed"));
    } finally {
      setPhotoBusy(false);
    }
  };
  const handleDeletePhoto = async (url) => {
    setPhotoBusy(true);
    try {
      await saleApi.deleteProjectImage(id, url);
      await invalidate();
      toast.success("Photo removed");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to remove photo"));
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleArchive = async () => {
    const archive = !archived;
    if (archive && !await confirm({
      title: `Archive ${T.saleProject}`,
      message: `Archive "${project.name}"? You can restore it later. No new ${T.saleUnits.toLowerCase()} can be added while it is archived.`,
      confirmText: "Archive",
    })) return;
    setBusy(true);
    try {
      await saleApi.archiveProject(id, archive);
      await invalidate();
      toast.success(`${T.saleProject} ${archive ? "archived" : "restored"}`);
    } catch (err) {
      toast.error(errorMessage(err, `Failed to update ${T.saleProject.toLowerCase()}`));
    } finally {
      setBusy(false);
    }
  };

  const handleApplyDetails = async () => {
    if (!await confirm({
      title: "Apply details to unsold units",
      message: `Copy this ${T.saleProject.toLowerCase()}'s location (address, town, county, country) onto every available or withdrawn ${T.saleUnit.toLowerCase()}? Their current location details will be replaced.`,
      confirmText: "Apply",
    })) return;
    setBusy(true);
    try {
      const res = await saleApi.applyProjectDetails(id);
      await invalidate();
      toast.success(`${res?.updated ?? 0} ${T.saleUnits.toLowerCase()} updated`);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to apply details"));
    } finally {
      setBusy(false);
    }
  };

  const openNewUnit = () => {
    setUnitModal({
      editingId: "",
      initial: {
        ...blankListingForm(propertyTypeOptions[0]?.value ?? "plot"),
        location: project.location || "", town: project.town || "", county: project.county || "", country: project.country || "Kenya",
      },
    });
  };

  const openEditUnit = useCallback(async (unit) => {
    try {
      const full = await queryClient.fetchQuery({ queryKey: ["sale-listings", biz, "one", unit._id], queryFn: () => saleApi.getListing(unit._id), staleTime: 0 });
      setUnitModal({ editingId: unit._id, initial: listingFormFromRow(full) });
    } catch (err) {
      toast.error(errorMessage(err, `Could not load this ${T.saleUnit.toLowerCase()}`));
    }
  }, [queryClient, biz, T.saleUnit]);

  const handleDetach = useCallback(async (unit) => {
    if (!await confirm({
      title: `Remove ${T.saleUnit} from ${T.saleProject}`,
      message: `Remove ${unit.unitNumber || unit.listingNumber} from this ${T.saleProject.toLowerCase()}? It becomes an ordinary ${T.saleListing.toLowerCase()} again. This is refused if it has ${T.saleOffers.toLowerCase()} or ${T.saleDeals.toLowerCase()}.`,
      confirmText: "Remove",
      isDangerous: true,
    })) return;
    setBusy(true);
    try {
      await saleApi.detachProjectUnit(id, unit._id);
      setSelectedId(null);
      await invalidate();
      toast.success(`${T.saleUnit} removed from the ${T.saleProject.toLowerCase()}`);
    } catch (err) {
      toast.error(errorMessage(err, `Cannot remove this ${T.saleUnit.toLowerCase()}`));
    } finally {
      setBusy(false);
    }
  }, [confirm, invalidate, id, T.saleUnit, T.saleProject, T.saleListing, T.saleOffers, T.saleDeals]);

  const backLink = (
    <Link to="/sale/projects" className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">
      <FaArrowLeft size={9} /> Back to {T.saleProjects}
    </Link>
  );

  if (isLoading || !biz) {
    return (
      <PropertySaleShell>
        <div className="flex flex-1 items-center justify-center gap-2 text-slate-400"><Spinner size="md" /><span className="text-xs font-semibold">Loading…</span></div>
      </PropertySaleShell>
    );
  }

  if (isError || !project) {
    const notFound = error?.response?.status === 404;
    return (
      <PropertySaleShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 border border-slate-200 bg-white px-6 text-center">
          <FaLayerGroup size={28} className="text-[#0B3B2E]/30" />
          <div className="text-sm font-extrabold text-slate-800">{notFound ? `${T.saleProject} not found` : `Could not load this ${T.saleProject.toLowerCase()}`}</div>
          <p className="text-xs text-slate-500">{notFound ? `It may have been deleted, or the link is wrong.` : errorMessage(error, "Please try again.")}</p>
          {backLink}
        </div>
      </PropertySaleShell>
    );
  }

  const u = project.units || {};
  const perf = project.performance;
  const location = [project.location, project.town, project.county].filter(Boolean).join(", ");
  const hasTargets = project.targetUnits > 0 || project.targetValue > 0;

  return (
    <PropertySaleShell>
      <div className="flex flex-1 min-h-0 flex-col gap-1.5 overflow-y-auto">
        {/* Header */}
        <div className="shrink-0 border border-slate-200 bg-white px-3 py-2" style={{ borderLeft: "3px solid #0B3B2E" }}>
          <div className="mb-1">{backLink}</div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base font-black text-slate-900">{project.name}</h1>
                <span className="font-mono text-[11px] font-bold text-[#0B3B2E]">{project.projectNumber}</span>
                <StatusBadge status={project.status} map={PROJECT_STATUS_MAP} />
                {isFetching && <FaRedoAlt size={9} className="animate-spin text-slate-400" />}
              </div>
              {location && <div className="mt-0.5 text-xs text-slate-500">{location}</div>}
              {project.assignedAgent?.fullName && (
                <div className="mt-0.5 text-[11px] text-slate-500">{T.saleAgent}: <span className="font-semibold text-slate-700">{project.assignedAgent.fullName}</span></div>
              )}
              {project.description && <div className="mt-0.5 max-w-3xl text-[11px] text-slate-400">{project.description}</div>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setModal("generate")} disabled={archived} className={btnPrimary}><FaMagic size={9} /> Generate {T.saleUnits}</button>
              <button type="button" onClick={() => setModal("assign")} disabled={archived} className={btn}><FaLayerGroup size={9} /> Add existing {T.saleListings}</button>
              <button type="button" onClick={openNewUnit} disabled={archived} className={btn}><FaPlus size={9} /> Add single {T.saleUnit}</button>
              <button type="button" onClick={() => setModal("bulk")} className={btn}><FaTags size={9} /> Bulk price</button>
              <button type="button" onClick={handleApplyDetails} disabled={busy} className={btn} title={`Copy this ${T.saleProject.toLowerCase()}'s location to unsold ${T.saleUnits.toLowerCase()}`}><FaSyncAlt size={9} /> Apply details to unsold</button>
              <button type="button" onClick={() => setModal("project")} className={btn}><FaEdit size={9} /> Edit {T.saleProject}</button>
              <button type="button" onClick={handleArchive} disabled={busy} className={btn}>
                {archived ? <><FaUndo size={9} /> Restore</> : <><FaArchive size={9} /> Archive</>}
              </button>
            </div>
          </div>
          {archived && (
            <div className="mt-1.5 border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
              This {T.saleProject.toLowerCase()} is archived. Restore it to add {T.saleUnits.toLowerCase()}.
            </div>
          )}
        </div>

        {/* KPI strip */}
        <div className="shrink-0 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label={`Total ${T.saleUnits}`} value={u.total || 0} />
            <Kpi label="Available" value={u.available || 0} tone="text-emerald-700" />
            <Kpi label="Reserved" value={u.reserved || 0} tone="text-amber-600" />
            <Kpi label="Under contract" value={u.under_contract || 0} tone="text-[#0B3B2E]" />
            <Kpi label="Sold" value={u.sold || 0} />
            <Kpi label="Withdrawn" value={u.withdrawn || 0} tone="text-rose-600" />
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Sell-through" value={fmtPct(project.sellThrough)} sub="Sold, excl. withdrawn" />
            <Kpi label="Total value" value={fmtKES(project.value?.total || 0)} />
            <Kpi label="Sold value" value={fmtKES(project.value?.sold || 0)} />
            <Kpi label={perf?.scoped ? "Booked (your figures)" : "Booked"} value={fmtKES(perf?.booked || 0)} />
            <Kpi label={perf?.scoped ? "Collected (your figures)" : "Collected"} value={fmtKES(perf?.collected || 0)} tone="text-emerald-700" />
            <Kpi label={perf?.scoped ? "Outstanding (your figures)" : "Outstanding"} value={fmtKES(perf?.outstanding || 0)} tone="text-amber-600" />
          </div>
          <div className="border border-slate-200 bg-white px-3 py-1.5">
            <SaleProjectProgressBar units={u} />
            {hasTargets && (
              <div className="mt-1.5 flex flex-wrap gap-4">
                {project.targetUnits > 0 && <TargetBar label={`${T.saleUnits} sold vs target`} actual={u.sold || 0} target={project.targetUnits} format={(n) => Number(n).toLocaleString("en-KE")} />}
                {project.targetValue > 0 && <TargetBar label="Sold value vs target" actual={project.value?.sold || 0} target={project.targetValue} format={fmtKES} />}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 gap-0.5 border-b border-slate-200">
          {[["units", T.saleUnits], ["performance", "Performance"], ["photos", `Photos (${project.images?.length || 0})`]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px border border-b-0 px-4 py-1.5 text-xs font-bold ${tab === key ? "border-slate-200 bg-white text-[#0B3B2E]" : "border-transparent text-slate-500 hover:text-[#0B3B2E]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "performance" ? (
          <div className="min-h-[300px] shrink-0 border border-slate-200 bg-slate-50">
            <SaleProjectPerformance performance={perf} terms={T} />
          </div>
        ) : tab === "photos" ? (
          <div className="max-w-3xl shrink-0 border border-slate-200 bg-white">
            <SalePhotoGallery
              images={project.images || []}
              busy={photoBusy}
              onUpload={handleUploadPhotos}
              onDelete={handleDeletePhoto}
              emptyHint={`Upload photos to showcase this ${T.saleProject.toLowerCase()} to buyers`}
            />
          </div>
        ) : (
          <div className="relative flex min-h-[420px] flex-1 flex-col">
            <div className={`flex flex-1 min-h-0 flex-col border border-slate-200 bg-white shadow-sm transition-[margin] duration-200 ${selected ? "sm:mr-[320px]" : ""}`}>
              {/* Filters + legend */}
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => setStatusFilt("")}
                  className={`inline-flex h-[20px] items-center gap-1 border px-2 text-[9px] font-bold ${statusFilt === "" ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                >
                  All <span className="tabular-nums opacity-70">{u.total || 0}</span>
                </button>
                {UNIT_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilt((prev) => (prev === s ? "" : s))}
                    className={`inline-flex h-[20px] items-center gap-1 border px-2 text-[9px] font-bold ${statusFilt === s ? "border-[#0B3B2E] bg-[#F1F6F3] text-[#0B3B2E]" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    <span className={`h-2 w-2 ${STATUS_SWATCH[s]}`} /> {STATUS_LABEL[s]} <span className="tabular-nums text-slate-400">{u[s] || 0}</span>
                  </button>
                ))}
                <span className="mx-1 hidden text-slate-200 sm:inline">·</span>
                {blockOptions.length > 0 && (
                  <AppSelect value={blockFilt} onChange={(v) => setBlockFilt(v ?? "")} options={blockOptions} placeholder="All blocks" clearable compact />
                )}
                <FilterSearch value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${T.saleUnit.toLowerCase()} no...`} />
                <div className="ml-auto flex">
                  <button type="button" onClick={() => setView("grid")} title="Grid view" className={`border px-2 py-1 ${view === "grid" ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}><FaBorderAll size={10} /></button>
                  <button type="button" onClick={() => setView("table")} title="Table view" className={`border border-l-0 px-2 py-1 ${view === "table" ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}><FaListUl size={10} /></button>
                </div>
              </div>

              {unitsData?.truncated && (
                <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-semibold text-amber-700">
                  Only the first {units.length.toLocaleString("en-KE")} of {unitsData.total.toLocaleString("en-KE")} {T.saleUnits.toLowerCase()} are shown.
                </div>
              )}

              {unitsLoading ? (
                <div className="flex flex-1 items-center justify-center gap-2 py-10 text-slate-400"><Spinner size="sm" /><span className="text-xs font-semibold">Loading…</span></div>
              ) : units.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                  <FaLayerGroup size={26} className="text-[#0B3B2E]/30" />
                  <div className="text-sm font-extrabold text-slate-800">No {T.saleUnits.toLowerCase()} in this {T.saleProject.toLowerCase()} yet</div>
                  <p className="max-w-md text-xs text-slate-500">
                    Generate a numbered range in one go, move in existing {T.saleListings.toLowerCase()}, or add them one at a time.
                  </p>
                  {!archived && (
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => setModal("generate")} className={btnPrimary}><FaMagic size={9} /> Generate {T.saleUnits}</button>
                      <button type="button" onClick={() => setModal("assign")} className={btn}>Add existing {T.saleListings}</button>
                    </div>
                  )}
                </div>
              ) : view === "grid" ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <SaleProjectUnitGrid units={filtered} selectedId={selectedId} onSelect={handleSelect} unitsLabel={T.saleUnits} />
                </div>
              ) : (
                <MilikTable
                  columns={UNIT_COLS}
                  rows={filtered}
                  empty={`No ${T.saleUnits.toLowerCase()} match these filters.`}
                  minWidth={720}
                  onRowClick={handleRowClick}
                  isSelected={isSelected}
                  renderRow={renderUnitRow}
                />
              )}
            </div>

            {selected && (
              <SaleProjectUnitPanel unit={selected} terms={T} busy={busy} onClose={() => setSelectedId(null)} onEdit={openEditUnit} onDetach={handleDetach} />
            )}
          </div>
        )}
      </div>

      {modal === "project" && <SaleProjectFormModal project={project} onSaved={invalidate} onClose={closeModal} />}
      {modal === "generate" && (
        <SaleGenerateUnitsModal project={project} propertyTypeOptions={propertyTypeOptions} agentFormOptions={agentFormOptions} onDone={invalidate} onClose={closeModal} />
      )}
      {modal === "bulk" && <SaleBulkPriceModal project={project} units={units} onDone={invalidate} onClose={closeModal} />}
      {modal === "assign" && <SaleAssignListingsModal project={project} biz={biz} onDone={invalidate} onClose={closeModal} />}
      {unitModal && (
        <SaleListingFormModal
          project={projectRef}
          initialEditingId={unitModal.editingId}
          initialForm={unitModal.initial}
          listings={formListings}
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

export default SaleProjectDetail;
